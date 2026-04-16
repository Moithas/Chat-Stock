// /pets — Main pet panel command
// All pet interactions go through this single panel

const path = require('path');
const fs = require('fs');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const {
  getSettings, SPECIES, SHOP_SPECIES, RARITIES, PHASES, FOOD_TYPES,
  getShopStock, getShopRestockTime, removeShopSlot,
  adoptPet, getPet, getUserPets, getUserPetCount, deletePet, renamePet,
  getEffectiveStats, processDecay, calculateFoodCost, feedPet,
  precheckPlay, precheckTrain, playWithPet, trainPet, getTrainCost, getBondMultiplier,
  xpToNextLevel, getPhase, formatPetName, formatPetSummary, formatShopEntry,
  formatBonusType, getSpecialtyDisplay, getSinglePetBonus,
  getKennel, upgradeKennel, getKennelUpgradeCost, getMaxPetSlots,
  generateShopStock, getPetImagePath, getPetImage, setActivePet, getActivePet,
  EGG_TYPES, getEggPrice, getUserEggs, getUserEggCount, getEgg, buyEgg, warmEgg, hatchEgg, deleteEgg,
  // Breeding
  getBreedingFee, canBreed, canBreedTogether, startGestation,
  getGestatingPets, getMyGestatingPets, giveBirth,
  createBreedingRequest, getBreedingRequest, getPendingBreedingRequests,
  getOutgoingBreedingRequests, updateBreedingRequestStatus, updateBreedingRequestStudFee, deleteBreedingRequest,
  cleanupExpiredBreedingRequests, RARITY_ORDER,
  // Transfer
  canTransferPet, transferPet,
  // Trading
  createTradeRequest, getTradeRequest, updateTradeRequestPet,
  updateTradeRequestStatus, deleteTradeRequest, cleanupExpiredTradeRequests, executeTrade,
} = require('../pets');
const { getBalance, removeFromTotal, addMoney } = require('../economy');
const { getCurrency } = require('../admin');
const { getLuckyPennyEffect, LP_EFFECT_TYPES } = require('../luckypenny');
const { EFFECT_TYPES, getEffectValue: getItemEffectValue, consumeEffect } = require('../items');

// Calculate total pet/egg discount from Lucky Penny + coupon
function getPetDiscount(guildId, userId) {
  let discount = 0;
  // Lucky Penny pet price buff (stored as negative value since it's inverse)
  const lpEffect = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.PET_PRICES);
  if (lpEffect < 0) discount += Math.abs(lpEffect); // negative = discount
  // Single-use coupon
  const couponValue = getItemEffectValue(guildId, userId, EFFECT_TYPES.PET_DISCOUNT);
  if (couponValue > 0) discount += couponValue;
  return Math.min(discount, 15); // Cap at 15% off
}

// Apply discount and consume coupon if used
function applyPetDiscount(guildId, userId, basePrice) {
  const discount = getPetDiscount(guildId, userId);
  if (discount <= 0) return { finalPrice: basePrice, discount: 0, hasCoupon: false, hasLP: false };
  const lpEffect = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.PET_PRICES);
  const couponValue = getItemEffectValue(guildId, userId, EFFECT_TYPES.PET_DISCOUNT);
  const hasCoupon = couponValue > 0;
  const hasLP = lpEffect < 0;
  const finalPrice = Math.round(basePrice * (1 - discount / 100));
  // Consume the coupon (LP buff stays for its duration)
  if (hasCoupon) consumeEffect(guildId, userId, EFFECT_TYPES.PET_DISCOUNT);
  return { finalPrice, discount, hasCoupon, hasLP };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pets')
    .setDescription('Pet panel — adopt, care for, and manage your pets'),

  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getSettings(guildId);

    if (!settings.enabled) {
      return interaction.editReply({ content: '❌ The pet system is not enabled on this server.' });
    }

    // Process any runaways before showing panel
    const ranAway = processDecay(guildId, userId);
    let ranAwayMsg = '';
    if (ranAway.length > 0) {
      const names = ranAway.map(p => `**${p.name}** (${SPECIES[p.species].emoji})`).join(', ');
      ranAwayMsg = `\n\n⚠️ Oh no! ${names} ran away because you forgot to feed them!`;
    }

    await showMainPanel(interaction, guildId, userId, settings, false, true, ranAwayMsg);
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getSettings(guildId);

    if (!settings.enabled) {
      return interaction.reply({ content: '❌ The pet system is not enabled.', flags: 64 });
    }

    // Verify button ownership
    if (customId.includes('_u_')) {
      const ownerPart = customId.split('_u_')[1];
      const ownerId = ownerPart ? ownerPart.split('_')[0] : null;
      if (ownerId && ownerId !== userId) {
        return interaction.reply({ content: '❌ This is not your panel.', flags: 64 });
      }
    }

    // Route buttons
    if (customId.startsWith('pet_panel_')) {
      const action = customId.split('pet_panel_')[1];
      if (action === 'main' || action.startsWith('main_u_')) return showMainPanel(interaction, guildId, userId, settings, true);
      if (action === 'shop' || action.startsWith('shop_u_')) return showShopPanel(interaction, guildId, userId, settings);
      if (action === 'mypets' || action.startsWith('mypets_u_')) return showMyPetsPanel(interaction, guildId, userId, settings);
      if (action === 'kennel' || action.startsWith('kennel_u_')) return showKennelPanel(interaction, guildId, userId, settings);
    }

    // Pet action buttons: pet_feed_<type>_<petId>_u_<userId>, pet_play_<petId>_u_<userId>, etc.
    if (customId.startsWith('pet_feedmenu_')) return handleFeedMenu(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_feed_')) return handleFeed(interaction, guildId, userId, settings);

    if (customId.startsWith('pet_play_')) return handlePlay(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_train_')) return handleTrain(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_active_')) return handleSetActive(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_dismiss_')) { await interaction.update({ content: '✅ Dismissed', embeds: [], components: [], files: [] }).catch(() => {}); await interaction.deleteReply().catch(() => {}); return; }
    if (customId.startsWith('pet_view_')) return handleViewPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_release_yes_')) return handleReleaseExecute(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_release_no_')) return showMyPetsPanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_release_')) return handleReleaseConfirm(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_rename_')) return handleRenameButton(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_namebuy_')) return handleNameBuyButton(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_buy_')) return handleBuyFromShop(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_kennel_buy_')) return handleKennelUpgrade(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_shop_page_')) return handleShopPage(interaction, guildId, userId, settings);
    // Egg buttons
    if (customId.startsWith('pet_egg_shop_')) return showEggShopPanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_egg_buy_')) return handleEggBuy(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_egg_warm_')) return handleEggWarm(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_egg_hatch_')) return handleEggHatch(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_egg_name_')) return handleEggNameButton(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_myeggs_')) return showMyEggsPanel(interaction, guildId, userId, settings);
    // Breeding buttons
    if (customId.startsWith('pet_breed_menu_')) return showBreedingPanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_breed_') && !customId.includes('_confirm_') && !customId.includes('_cancel_') && !customId.includes('_select_') && !customId.includes('_request_') && !customId.includes('_partner_'))
      return showBreedingPanel(interaction, guildId, userId, settings, parsePetIdFromCustomId(customId));
    if (customId.startsWith('pet_breed_confirm_')) return handleBreedConfirm(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_breed_cancel_')) return showMyPetsPanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_birth_')) return handleGiveBirth(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_birth_name_')) return handleBirthName(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_gestating_')) return showGestatingPanel(interaction, guildId, userId, settings);
    // Cross-player breeding
    if (customId.startsWith('pet_stud_request_')) return showStudRequestPanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_select_')) return handleStudSelectPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_accept_')) return handleStudAccept(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_decline_')) return handleStudDecline(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_feeaccept_')) return handleStudFeeAccept(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_feedecline_')) return handleStudFeeDecline(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_fee_')) return handleStudFeeModal(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_breed_request_')) return handleBreedRequest(interaction, guildId, userId, settings);
    // Transfer buttons
    if (customId.startsWith('pet_transfer_menu_')) return showTransferPanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_transfer_') && !customId.includes('_confirm_') && !customId.includes('_accept_') && !customId.includes('_decline_') && !customId.includes('_target_') && !customId.includes('_userselect_'))
      return showTransferPanel(interaction, guildId, userId, settings, parsePetIdFromCustomId(customId));
    if (customId.startsWith('pet_transfer_confirm_')) return handleTransferConfirm(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_transfer_accept_')) return handleTransferAccept(interaction, guildId, settings);
    if (customId.startsWith('pet_transfer_decline_')) return handleTransferDecline(interaction, guildId, settings);
    // Trade buttons
    if (customId.startsWith('pet_trade_menu_')) return showTradePanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_trade_accept_')) return handleTradeAccept(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_trade_decline_')) return handleTradeDecline(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_trade_confirm_')) return handleTradeConfirm(interaction, guildId, userId, settings);
    // Lineage button
    if (customId.startsWith('pet_lineage_')) return handleLineageView(interaction, guildId, userId, settings);
  },

  async handleSelectMenu(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getSettings(guildId);

    if (customId.startsWith('pet_select_view_')) return handleSelectPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_shop_select_')) return handleShopSelectPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_breed_select_')) return handleBreedSelectPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_breed_partner_select_')) return handleBreedPartnerSelect(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_mypet_')) return handleStudMyPetSelect(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_stud_partner_')) return handleStudPartnerSelect(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_transfer_target_')) return handleTransferTargetSelect(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_trade_select_')) return handleTradeSelectPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_trade_partner_')) return handleTradePartnerSelectPet(interaction, guildId, userId, settings);
  },

  async handleUserSelectMenu(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getSettings(guildId);

    if (customId.startsWith('pet_stud_targetuser_')) return handleStudTargetUserSelect(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_transfer_userselect_')) return handleTransferUserSelect(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_trade_userselect_')) return handleTradeUserSelect(interaction, guildId, userId, settings);
  },

  async handleModal(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getSettings(guildId);

    if (customId.startsWith('modal_pet_name_')) return handleNameModal(interaction, guildId, userId, settings);
    if (customId.startsWith('modal_pet_rename_')) return handleRenameModal(interaction, guildId, userId, settings);
    if (customId.startsWith('modal_egg_name_')) return handleEggNameModal(interaction, guildId, userId, settings);
    if (customId.startsWith('modal_birth_name_')) return handleBirthNameModal(interaction, guildId, userId, settings);
    if (customId.startsWith('modal_stud_accept_')) return handleStudAcceptSubmit(interaction, guildId, userId, settings);
    if (customId.startsWith('modal_transfer_price_')) return handleTransferPriceSubmit(interaction, guildId, userId, settings);
  },
};

// ================== HELPER ==================

function formatCooldown(ms) {
  if (ms <= 0) return 'Ready!';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTimeUntil(timestamp) {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'Now';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function parsePetIdFromCustomId(customId) {
  // Format: pet_action_<petId>_u_<userId>
  const parts = customId.split('_');
  // Find the petId (the part after the action name and before 'u')
  const uIndex = parts.indexOf('u');
  if (uIndex >= 3) return parseInt(parts[uIndex - 1]);
  return parseInt(parts[2]);
}

function makeXpBar(pet) {
  if (pet.level >= 50) return '`MAX LEVEL`';
  const needed = xpToNextLevel(pet.level);
  const filled = Math.round((pet.xp / needed) * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `\`${bar}\` ${pet.xp}/${needed} XP`;
}

function makeMeter(value, max, emoji) {
  const filled = Math.round((value / max) * 5);
  const empty = 5 - filled;
  return `${emoji} ${'▓'.repeat(filled)}${'░'.repeat(empty)} ${value}/${max}`;
}

// ================== MAIN PANEL ==================

async function showMainPanel(interaction, guildId, userId, settings, isUpdate = false, isDeferred = false, extraMsg = '') {
  const pets = getUserPets(guildId, userId);
  const maxSlots = getMaxPetSlots(guildId, userId);
  const kennel = getKennel(guildId, userId);
  const balance = await getBalance(guildId, userId);
  const currency = getCurrency(guildId);
  const eggs = getUserEggs(guildId, userId);
  const gestating = getMyGestatingPets(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🐾 Pet Panel')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  const usedSlots = pets.length + eggs.length + gestating.length;
  let desc = `Welcome, **${interaction.user.displayName}**!\n\n`;
  desc += `🐾 **Slots:** ${usedSlots}/${maxSlots}`;
  if (eggs.length > 0 || gestating.length > 0) {
    const parts = [`${pets.length} pets`];
    if (eggs.length > 0) parts.push(`${eggs.length} eggs`);
    if (gestating.length > 0) parts.push(`${gestating.length} gestating`);
    desc += ` (${parts.join(', ')})`;
  }
  desc += `\n`;
  desc += `🏠 **Kennel:** ${kennel.level > 0 ? `Level ${kennel.level}` : 'None'}\n`;
  desc += `💰 **Balance:** ${Math.round(balance.total).toLocaleString()} ${currency}\n`;

  if (pets.length > 0) {
    desc += '\n**Your Pets:**\n';
    for (const pet of pets) {
      const effective = getEffectiveStats(pet, settings);
      const phase = getPhase(pet.level);
      const speciesData = SPECIES[pet.species];
      const rarityData = RARITIES[pet.rarity];
      const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';
      const shinyStr = pet.shiny ? '✨' : '';
      desc += `${shinyStr}${speciesData.emoji} **${pet.name}** — ${sexEmoji} ${rarityData.name} — Lv.${pet.level} ${phase.emoji} — ❤️${effective.happiness} 🍖${effective.hunger}\n`;
    }
  } else {
    desc += '\n*You have no pets yet! Visit the shop to adopt one.*';
  }

  if (eggs.length > 0) {
    desc += '\n**Your Eggs:**\n';
    for (const egg of eggs) {
      const eggData = EGG_TYPES[egg.egg_type];
      const now = Date.now();
      const ready = now >= egg.hatch_time;
      const timeStr = ready ? '✅ Ready to hatch!' : `⏳ <t:${Math.floor(egg.hatch_time / 1000)}:R>`;
      desc += `${eggData.emoji} **${eggData.name}** — ${timeStr}\n`;
    }
  }

  desc += extraMsg;
  embed.setDescription(desc);

  // Check for births ready
  const birthsReady = gestating.filter(p => p.gestation_end <= Date.now()).length;
  const breedingLabel = birthsReady > 0 ? `Breeding (${birthsReady} ready!)` : 'Breeding';
  const breedingStyle = birthsReady > 0 ? ButtonStyle.Success : ButtonStyle.Secondary;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_shop_u_${userId}`).setLabel('Pet Shop').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Primary).setDisabled(pets.length === 0),
    new ButtonBuilder().setCustomId(`pet_myeggs_u_${userId}`).setLabel('My Eggs').setEmoji('🥚').setStyle(ButtonStyle.Primary).setDisabled(eggs.length === 0),
    new ButtonBuilder().setCustomId(`pet_panel_kennel_u_${userId}`).setLabel('Kennel').setEmoji('🏠').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_breed_menu_u_${userId}`).setLabel(breedingLabel).setEmoji('💕').setStyle(breedingStyle).setDisabled(!settings.breedingEnabled),
    new ButtonBuilder().setCustomId(`pet_transfer_menu_u_${userId}`).setLabel('Give/Sell').setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(!settings.transferEnabled || pets.length === 0),
    new ButtonBuilder().setCustomId(`pet_trade_menu_u_${userId}`).setLabel('Trade').setEmoji('🤝').setStyle(ButtonStyle.Secondary).setDisabled(!settings.transferEnabled || pets.length === 0),
    new ButtonBuilder().setCustomId(`pet_dismiss_u_${userId}`).setLabel('Dismiss').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

  const options = { embeds: [embed], components: [row1, row2] };
  if (isDeferred) return interaction.editReply(options);
  if (isUpdate) return interaction.update(options);
  return interaction.reply(options);
}

// ================== SHOP PANEL ==================

async function showShopPanel(interaction, guildId, userId, settings, page = 0) {
  const stock = getShopStock(guildId);
  const restockTime = getShopRestockTime(guildId);
  const balance = await getBalance(guildId, userId);
  const currency = getCurrency(guildId);
  const petCount = getUserPetCount(guildId, userId);
  const eggCount = getUserEggCount(guildId, userId);
  const gestatingCount = getMyGestatingPets(guildId, userId).length;
  const maxSlots = getMaxPetSlots(guildId, userId);
  const usedSlots = petCount + eggCount + gestatingCount;

  const ITEMS_PER_PAGE = 9;
  const totalPages = Math.ceil(stock.length / ITEMS_PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = stock.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const discount = getPetDiscount(guildId, userId);

  let shopDesc = `💰 **Balance:** ${Math.round(balance.total).toLocaleString()} ${currency}\n` +
    `🐾 **Slots:** ${usedSlots}/${maxSlots}\n` +
    `⏰ **Restocks:** <t:${Math.floor(restockTime / 1000)}:R>\n\n` +
    `Select a pet below to adopt it!`;
  if (discount > 0) shopDesc += `\n🏷️ **Active discount: ${discount}% off!**`;

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🛒 Pet Shop')
    .setDescription(shopDesc)
    .setTimestamp();

  if (pageItems.length === 0) {
    embed.addFields({ name: 'Shop Empty', value: 'The shop is currently empty. Wait for the next restock!' });
  } else {
    let listText = '';
    for (const item of pageItems) {
      const display = formatShopEntry(item);
      const shinyTag = item.shiny ? ' ✨**SHINY!**' : '';
      if (discount > 0) {
        const discPrice = Math.round(item.price * (1 - discount / 100));
        listText += `**#${item.slot_number}** ${display}${shinyTag} — **${discPrice.toLocaleString()}** ~~${item.price.toLocaleString()}~~ ${currency}\n`;
      } else {
        listText += `**#${item.slot_number}** ${display}${shinyTag} — **${item.price.toLocaleString()}** ${currency}\n`;
      }
    }
    embed.addFields({ name: `Available (Page ${page + 1}/${totalPages})`, value: listText });
  }

  // Select menu for buying
  const components = [];
  if (pageItems.length > 0) {
    const selectOptions = pageItems.map(item => {
      const speciesData = SPECIES[item.species];
      const rarityData = RARITIES[item.rarity];
      const sexStr = item.sex === 'M' ? '♂' : '♀';
      const shinyStr = item.shiny ? '✨ ' : '';
      const displayPrice = discount > 0 ? Math.round(item.price * (1 - discount / 100)) : item.price;
      return {
        label: `#${item.slot_number} ${shinyStr}${rarityData.name} ${speciesData.name} ${sexStr}`,
        description: `${displayPrice.toLocaleString()} ${currency.replace(/<:[^:]+:\d+>/g, '').trim() || 'coins'}`,
        value: `${item.slot_number}`,
        emoji: speciesData.emoji,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`pet_shop_select_u_${userId}`)
      .setPlaceholder('Select a pet to adopt...')
      .addOptions(selectOptions);
    components.push(new ActionRowBuilder().addComponents(select));
  }

  // Pagination + back
  const navRow = new ActionRowBuilder();
  if (totalPages > 1) {
    navRow.addComponents(
      new ButtonBuilder().setCustomId(`pet_shop_page_${page - 1}_u_${userId}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`pet_shop_page_${page + 1}_u_${userId}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
    );
  }
  navRow.addComponents(
    new ButtonBuilder().setCustomId(`pet_egg_shop_u_${userId}`).setLabel('Eggs').setEmoji('🥚').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );
  components.push(navRow);

  return interaction.update({ embeds: [embed], components });
}

function handleShopPage(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // pet_shop_page_<page>_u_<userId>
  const pageIdx = parts.indexOf('page');
  const page = parseInt(parts[pageIdx + 1]);
  return showShopPanel(interaction, guildId, userId, settings, page);
}

async function handleShopSelectPet(interaction, guildId, userId, settings) {
  const slotNumber = parseInt(interaction.values[0]);
  const stock = getShopStock(guildId);
  const item = stock.find(s => s.slot_number === slotNumber);

  if (!item) {
    return interaction.update({ content: '❌ That pet was already adopted!', embeds: [], components: [] });
  }

  const balance = await getBalance(guildId, userId);
  if (balance.total < item.price) {
    return interaction.reply({ content: `❌ You need **${item.price.toLocaleString()}** ${getCurrency(guildId)} but only have **${Math.round(balance.total).toLocaleString()}**.`, flags: 64 });
  }

  const petCount = getUserPetCount(guildId, userId);
  const eggCount = getUserEggCount(guildId, userId);
  const maxSlots = getMaxPetSlots(guildId, userId);
  if (petCount + eggCount >= maxSlots) {
    return interaction.reply({ content: `❌ You already have **${petCount} pets + ${eggCount} eggs** using **${petCount + eggCount}/${maxSlots}** slots! Upgrade your kennel or release a pet.`, flags: 64 });
  }

  // Show preview with variant image before naming
  const speciesData = SPECIES[item.species];
  const variant = Math.ceil(Math.random() * (speciesData.variants || 1));
  const rarityData = RARITIES[item.rarity];
  const sexEmoji = item.sex === 'M' ? '♂️' : '♀️';
  const shinyStr = item.shiny ? '✨ **SHINY!** ' : '';

  const discount = getPetDiscount(guildId, userId);
  let costLine = `💰 Cost: **${item.price.toLocaleString()}** ${getCurrency(guildId)}`;
  if (discount > 0) {
    const discounted = Math.round(item.price * (1 - discount / 100));
    costLine = `💰 Cost: **${discounted.toLocaleString()}** ~~${item.price.toLocaleString()}~~ ${getCurrency(guildId)} (${discount}% off!)`;
  }

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`${speciesData.emoji} Meet Your New Pet!`)
    .setDescription(
      `${shinyStr}${sexEmoji} **${rarityData.name} ${speciesData.name}**\n` +
      `${PHASES.baby.emoji} Baby — Level 1\n\n` +
      `**Specialty:** ${getSpecialtyDisplay(item.species)}\n` +
      `${costLine}\n\n` +
      `*Give them a name to bring them home!*`
    )
    .setTimestamp();

  const petImage = await getPetImage(item.species, 'baby', variant, item.shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_namebuy_${slotNumber}_v_${variant}_u_${userId}`).setLabel('Name This Pet').setEmoji('✏️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pet_shop_page_0_u_${userId}`).setLabel('Back to Shop').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );

  return interaction.update({ embeds: [embed], components: [row], files });
}

async function handleNameBuyButton(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // pet_namebuy_<slotNumber>_v_<variant>_u_<userId>
  const slotNumber = parseInt(parts[2]);
  const vIdx = parts.indexOf('v');
  const variant = parseInt(parts[vIdx + 1]);

  const stock = getShopStock(guildId);
  const item = stock.find(s => s.slot_number === slotNumber);
  if (!item) {
    return interaction.update({ content: '❌ That pet was already adopted!', embeds: [], components: [], files: [] });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_pet_name_${slotNumber}_v_${variant}_u_${userId}`)
    .setTitle('Name Your New Pet');

  const nameInput = new TextInputBuilder()
    .setCustomId('pet_name')
    .setLabel(`Name your ${SPECIES[item.species].name}`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(24)
    .setRequired(true)
    .setPlaceholder('Enter a name...');

  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return interaction.showModal(modal);
}

async function handleNameModal(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // modal_pet_name_<slotNumber>_v_<variant>_u_<userId>
  const nameIdx = parts.indexOf('name');
  const slotNumber = parseInt(parts[nameIdx + 1]);
  const vIdx = parts.indexOf('v');
  const variant = vIdx !== -1 ? parseInt(parts[vIdx + 1]) : null;
  const petName = interaction.fields.getTextInputValue('pet_name').trim();

  if (!petName || petName.length > 24) {
    return interaction.reply({ content: '❌ Pet name must be 1-24 characters.', flags: 64 });
  }

  await interaction.deferReply();

  const stock = getShopStock(guildId);
  const item = stock.find(s => s.slot_number === slotNumber);
  if (!item) {
    return interaction.editReply({ content: '❌ That pet was already adopted!' });
  }

  const balance = await getBalance(guildId, userId);
  if (balance.total < item.price) {
    return interaction.editReply({ content: `❌ You can't afford this pet!` });
  }

  const petCount = getUserPetCount(guildId, userId);
  const eggCount2 = getUserEggCount(guildId, userId);
  const maxSlots = getMaxPetSlots(guildId, userId);
  if (petCount + eggCount2 >= maxSlots) {
    return interaction.editReply({ content: '❌ You have no pet slots available!' });
  }

  // Apply discount
  const { finalPrice, discount, hasCoupon, hasLP } = applyPetDiscount(guildId, userId, item.price);
  if (balance.total < finalPrice) {
    return interaction.editReply({ content: `❌ You can't afford this pet!` });
  }

  // Deduct and adopt
  await removeFromTotal(guildId, userId, finalPrice, `Adopted pet: ${petName}`);
  const pet = adoptPet(guildId, userId, item.species, petName, item.rarity, item.sex, item.shiny, 'shop', variant);
  removeShopSlot(guildId, slotNumber);

  const speciesData = SPECIES[item.species];
  const rarityData = RARITIES[item.rarity];
  const sexEmoji = item.sex === 'M' ? '♂️' : '♀️';
  const shinyStr = item.shiny ? '✨ **SHINY!** ' : '';

  let paidText = `💰 Paid **${finalPrice.toLocaleString()}** ${getCurrency(guildId)}`;
  if (discount > 0) {
    paidText += ` ~~${item.price.toLocaleString()}~~ (${discount}% off`;
    if (hasCoupon && hasLP) paidText += ' — 🎟️ coupon + 🪙 Lucky Penny';
    else if (hasCoupon) paidText += ' — 🎟️ coupon';
    else if (hasLP) paidText += ' — 🪙 Lucky Penny';
    paidText += ')';
  }

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`${speciesData.emoji} New Pet Adopted!`)
    .setDescription(
      `${shinyStr}You adopted **${petName}**!\n\n` +
      `${sexEmoji} **${rarityData.name} ${speciesData.name}**\n` +
      `Level 1 ${PHASES.baby.emoji} Baby\n\n` +
      `**Specialty:** ${getSpecialtyDisplay(item.species)}\n\n` +
      paidText
    )
    .setFooter({ text: 'Use /pets to manage your new companion!' })
    .setTimestamp();

  const petImage = await getPetImage(item.species, 'baby', pet?.variant || 1, item.shiny);
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    return interaction.editReply({ embeds: [embed], files: [attachment] });
  }

  return interaction.editReply({ embeds: [embed] });
}

// ================== MY PETS ==================

async function showMyPetsPanel(interaction, guildId, userId, settings) {
  // Process runaways
  const ranAway = processDecay(guildId, userId);
  const pets = getUserPets(guildId, userId);
  const currency = getCurrency(guildId);

  if (pets.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('🐾 My Pets')
      .setDescription('You have no pets! Visit the shop to adopt one.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pet_panel_shop_u_${userId}`).setLabel('Pet Shop').setEmoji('🛒').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
    );

    return interaction.update({ embeds: [embed], components: [row] });
  }

  // If 1 pet, show directly. Otherwise show select menu.
  if (pets.length === 1) {
    return showPetDetail(interaction, guildId, userId, settings, pets[0]);
  }

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🐾 My Pets')
    .setDescription('Select a pet to view details and actions.');

  let desc = '';
  for (const pet of pets) {
    desc += formatPetSummary(pet, settings) + '\n';
  }
  embed.addFields({ name: 'Your Companions', value: desc });

  let ranAwayNote = '';
  if (ranAway.length > 0) {
    ranAwayNote = '\n⚠️ ' + ranAway.map(p => `**${p.name}** ran away!`).join(', ');
    embed.addFields({ name: '⚠️ Runaways', value: ranAwayNote });
  }

  const selectOptions = pets.map(pet => {
    const speciesData = SPECIES[pet.species];
    const rarityData = RARITIES[pet.rarity];
    const phase = getPhase(pet.level);
    return {
      label: `${pet.name} — Lv.${pet.level} ${rarityData.name} ${speciesData.name}`,
      description: `${phase.name} | ${pet.sex === 'M' ? '♂' : '♀'}${pet.shiny ? ' ✨ Shiny' : ''}`,
      value: `${pet.id}`,
      emoji: speciesData.emoji,
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`pet_select_view_u_${userId}`)
    .setPlaceholder('Select a pet...')
    .addOptions(selectOptions);

  const components = [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
    ),
  ];

  return interaction.update({ embeds: [embed], components });
}

async function handleSelectPet(interaction, guildId, userId, settings) {
  const petId = parseInt(interaction.values[0]);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId || pet.guild_id !== guildId) {
    return interaction.reply({ content: '❌ Pet not found.', flags: 64 });
  }
  return showPetDetail(interaction, guildId, userId, settings, pet);
}

async function showPetDetail(interaction, guildId, userId, settings, pet) {
  const effective = getEffectiveStats(pet, settings);
  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const phase = getPhase(pet.level);
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';
  const shinyStr = pet.shiny ? '✨ ' : '';
  const isActive = pet.is_active === 1;
  const currency = getCurrency(guildId);
  const now = Date.now();

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`${shinyStr}${speciesData.emoji} ${pet.name}${isActive ? ' ⚔️ ACTIVE' : ''}`)
    .setTimestamp();

  let desc = '';
  desc += `${sexEmoji} **${rarityData.name} ${speciesData.name}** ${pet.shiny ? '✨ **Shiny**' : ''}\n`;
  desc += `${phase.emoji} **${phase.name}** — Level **${pet.level}**/50\n`;
  desc += makeXpBar(pet) + '\n\n';

  desc += makeMeter(effective.happiness, 100, '❤️') + '\n';
  desc += makeMeter(effective.hunger, 100, '🍖') + '\n';

  // Bond
  const bondStreak = pet.bond_streak || 0;
  const bondMult = getBondMultiplier(bondStreak);
  desc += `🤝 Bond: **${bondStreak}** day streak (${bondMult.toFixed(2)}× bonus)\n\n`;

  // Bonuses
  const bonusTypes = Object.keys(speciesData.specialties);
  if (phase.bonusMult > 0) {
    const bonusLines = bonusTypes.map(bt => {
      const bonus = getSinglePetBonus(pet, bt, settings);
      return `${formatBonusType(bt)}: **+${bonus.toFixed(1)}%**`;
    });
    desc += '**Active Bonuses:**\n' + bonusLines.join('\n') + '\n\n';
  } else {
    desc += `*Bonuses unlock at ${PHASES.adult.emoji} Adult (Level 26)*\n\n`;
  }

  if (phase.canTrain) {
    const trainCost = getTrainCost(pet.level, settings);
    desc += `📚 Train Cost: **${trainCost.toLocaleString()}** ${currency}\n`;
  }

  // Cooldown info
  const playCd = pet.last_played ? Math.max(0, (pet.last_played + settings.playCooldown * 1000) - now) : 0;
  const trainCd = pet.last_trained ? Math.max(0, (pet.last_trained + settings.trainCooldown * 1000) - now) : 0;
  desc += `🎮 Play: ${playCd > 0 ? formatCooldown(playCd) : '✅ Ready'} | 📚 Train: ${!phase.canTrain ? '🔒 Locked' : (trainCd > 0 ? formatCooldown(trainCd) : '✅ Ready')}\n`;

  // Source / age
  const ageMs = now - pet.born_at;
  const ageDays = Math.floor(ageMs / 86400000);
  desc += `📅 Age: ${ageDays} day${ageDays !== 1 ? 's' : ''} | Source: ${pet.source}\n`;

  // Lineage info
  if (pet.source === 'bred' && (pet.mother_id || pet.father_id)) {
    // Use stored names (persist even if parents are deleted), fallback to lookup for older pets
    let motherName = pet.mother_name;
    let fatherName = pet.father_name;
    if (!motherName && pet.mother_id) {
      const mother = getPet(pet.mother_id);
      motherName = mother ? mother.name : '(unknown)';
    }
    if (!fatherName && pet.father_id) {
      const father = getPet(pet.father_id);
      fatherName = father ? father.name : '(unknown)';
    }
    desc += `🧬 Parents: **${motherName || '(unknown)'}** × **${fatherName || '(unknown)'}**`;
  } else if (pet.source === 'shop') {
    desc += `🏠 Origin: Adopted from Shop`;
  } else if (pet.source === 'egg') {
    desc += `🥚 Origin: Hatched from Egg`;
  }

  embed.setDescription(desc);

  // Attach pet phase image if available
  const petImage = await getPetImage(pet.species, phase.name.toLowerCase(), pet.variant || 1, pet.shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  // Action buttons
  const canPlay = phase.canPlay && playCd <= 0;
  const canTrain = phase.canTrain && trainCd <= 0;
  const isFull = effective.hunger >= 100 && effective.happiness >= 100;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_feedmenu_${pet.id}_u_${userId}`).setLabel('Feed').setEmoji('🍖').setStyle(ButtonStyle.Success).setDisabled(isFull),
    new ButtonBuilder().setCustomId(`pet_play_${pet.id}_u_${userId}`).setLabel('Play').setEmoji('🎮').setStyle(ButtonStyle.Primary).setDisabled(!canPlay),
    new ButtonBuilder().setCustomId(`pet_train_${pet.id}_u_${userId}`).setLabel('Train').setEmoji('📚').setStyle(ButtonStyle.Primary).setDisabled(!canTrain),
    new ButtonBuilder().setCustomId(`pet_active_${pet.id}_u_${userId}`).setLabel(isActive ? 'Active' : 'Set Active').setEmoji('⚔️').setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(isActive),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_rename_${pet.id}_u_${userId}`).setLabel('Rename').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_release_${pet.id}_u_${userId}`).setLabel('Release').setEmoji('🔓').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('All Pets').setEmoji('🐾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );

  // Row 3: Breeding, Transfer, and Lineage buttons
  const breedCheck = canBreed(pet, guildId);
  const transferCheck = canTransferPet(pet, guildId);
  const hasLineage = pet.source === 'bred' && (pet.mother_id || pet.father_id);
  
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_breed_${pet.id}_u_${userId}`)
      .setLabel('Breed')
      .setEmoji('💕')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!settings.breedingEnabled || !breedCheck.canBreed),
    new ButtonBuilder()
      .setCustomId(`pet_transfer_${pet.id}_u_${userId}`)
      .setLabel('Give/Sell')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!settings.transferEnabled || !transferCheck.canTransfer),
    new ButtonBuilder()
      .setCustomId(`pet_lineage_${pet.id}_u_${userId}`)
      .setLabel('Family Tree')
      .setEmoji('🧬')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasLineage),
  );

  return interaction.update({ embeds: [embed], components: [row1, row2, row3], files });
}

// ================== PET ACTIONS ==================

async function handleFeedMenu(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Not your pet.', flags: 64 });

  const effective = getEffectiveStats(pet, settings);
  if (effective.ranAway) {
    deletePet(petId);
    return interaction.update({ content: `😢 **${pet.name}** ran away!`, embeds: [], components: [] });
  }

  const currency = getCurrency(guildId);
  const basicCost = calculateFoodCost(pet, settings, 'basic');
  const premiumCost = calculateFoodCost(pet, settings, 'premium');
  const treatCost = calculateFoodCost(pet, settings, 'treat');

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle(`🍖 Feed ${pet.name}`)
    .setDescription(
      `🍖 **Basic Food** — **${basicCost.toLocaleString()}** ${currency}\n` +
      `+10 hunger\n\n` +
      `🥩 **Premium Food** — **${premiumCost.toLocaleString()}** ${currency}\n` +
      `+20 hunger, +5 happiness\n\n` +
      `🍰 **Treat** — **${treatCost.toLocaleString()}** ${currency}\n` +
      `+2 hunger, +8 happiness\n\n` +
      `Current: ❤️ ${effective.happiness}/100 | 🍖 ${effective.hunger}/100`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_feed_basic_${pet.id}_u_${userId}`).setLabel('Basic').setEmoji('🍖').setStyle(ButtonStyle.Success).setDisabled(effective.hunger >= 100),
    new ButtonBuilder().setCustomId(`pet_feed_premium_${pet.id}_u_${userId}`).setLabel('Premium').setEmoji('🥩').setStyle(ButtonStyle.Success).setDisabled(effective.hunger >= 100 && effective.happiness >= 100),
    new ButtonBuilder().setCustomId(`pet_feed_treat_${pet.id}_u_${userId}`).setLabel('Treat').setEmoji('🍰').setStyle(ButtonStyle.Success).setDisabled(effective.happiness >= 100),
    new ButtonBuilder().setCustomId(`pet_view_${pet.id}_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );

  return interaction.update({ embeds: [embed], components: [row], files: [] });
}

async function handleFeed(interaction, guildId, userId, settings) {
  const customId = interaction.customId;
  const petId = parsePetIdFromCustomId(customId);
  // Parse food type: pet_feed_<type>_<petId>_u_<userId>
  const foodType = customId.split('_')[2] || 'basic';
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Not your pet.', flags: 64 });

  const food = FOOD_TYPES[foodType] || FOOD_TYPES.basic;
  const cost = calculateFoodCost(pet, settings, foodType);
  const currency = getCurrency(guildId);
  const balance = await getBalance(guildId, userId);
  if (balance.total < cost) {
    return interaction.reply({
      content: `❌ ${food.emoji} ${food.name} costs **${cost.toLocaleString()}** ${currency} but you only have **${Math.round(balance.total).toLocaleString()}**.`,
      flags: 64,
    });
  }

  const result = feedPet(petId, settings, foodType);
  if (!result.success) {
    if (result.error === 'ran_away') {
      return interaction.update({
        content: `😢 **${pet.name}** ran away because it was starving!`,
        embeds: [], components: [],
      });
    }
    if (result.error === 'not_hungry') {
      return interaction.reply({ content: `❌ **${pet.name}** is already full!`, flags: 64 });
    }
    if (result.error === 'already_happy') {
      return interaction.reply({ content: `❌ **${pet.name}** is already at max happiness!`, flags: 64 });
    }
    return interaction.reply({ content: '❌ ' + result.error, flags: 64 });
  }

  await removeFromTotal(guildId, userId, cost, `Fed pet ${food.name}: ${pet.name}`);

  // Refresh the pet detail view
  const updatedPet = getPet(petId);
  if (!updatedPet) return interaction.update({ content: 'Pet not found after feeding.', embeds: [], components: [] });

  return showPetDetail(interaction, guildId, userId, settings, updatedPet);
}

async function handlePlay(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const check = precheckPlay(petId, settings);

  if (!check.success) {
    if (check.error === 'ran_away') {
      return interaction.update({ content: `😢 **${check.pet?.name}** ran away!`, embeds: [], components: [] });
    }
    if (check.error === 'cooldown') {
      return interaction.reply({ content: `⏳ Play available <t:${Math.floor(check.readyAt / 1000)}:R>.`, flags: 64 });
    }
    if (check.error === 'phase_locked') {
      return interaction.reply({ content: `❌ This pet can't play yet.`, flags: 64 });
    }
    return interaction.reply({ content: '❌ ' + check.error, flags: 64 });
  }

  const pet = check.pet;
  const speciesData = SPECIES[pet.species];

  // Pick a random play mini-game
  const games = ['fetch', 'hotcold', 'trick'];
  const game = games[Math.floor(Math.random() * games.length)];

  await interaction.deferUpdate();

  let won = false;
  if (game === 'fetch') won = await runFetchGame(interaction, pet, speciesData, userId, petId);
  else if (game === 'hotcold') won = await runHotColdGame(interaction, pet, speciesData, userId, petId);
  else won = await runTrickGame(interaction, pet, speciesData, userId, petId);

  // Apply result
  const result = playWithPet(petId, settings, won);
  if (!result.success) return;

  let desc = won
    ? `${speciesData.emoji} **${pet.name}** had a blast! 🎉\n\n`
    : `${speciesData.emoji} **${pet.name}** still had fun trying! 😊\n\n`;
  desc += `+${result.xpGain} XP | ❤️ ${result.happinessBefore} → ${result.happinessAfter}`;
  if (result.leveledUp) {
    desc += `\n🎉 **Leveled up to ${result.newLevel}!**`;
    if (result.newPhase) desc += ` Now a **${result.newPhase.emoji} ${result.newPhase.name}**!`;
  }

  const embed = new EmbedBuilder()
    .setColor(won ? 0x2ECC71 : 0xF39C12)
    .setTitle(won ? '🎮 Great Play!' : '🎮 Nice Try!')
    .setDescription(desc)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_view_${petId}_u_${userId}`).setLabel('Back to Pet').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );

  return interaction.editReply({ embeds: [embed], components: [row], files: [] });
}

async function handleTrain(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const check = precheckTrain(petId, settings);

  if (!check.success) {
    if (check.error === 'ran_away') {
      return interaction.update({ content: `😢 **${check.pet?.name}** ran away!`, embeds: [], components: [] });
    }
    if (check.error === 'cooldown') {
      return interaction.reply({ content: `⏳ Training available <t:${Math.floor(check.readyAt / 1000)}:R>.`, flags: 64 });
    }
    if (check.error === 'phase_locked') {
      return interaction.reply({ content: `❌ Training unlocks at 🌱 Juvenile (Level 11).`, flags: 64 });
    }
    return interaction.reply({ content: '❌ ' + check.error, flags: 64 });
  }

  const pet = check.pet;
  const speciesData = SPECIES[pet.species];
  const currency = getCurrency(guildId);
  const cost = check.cost;

  // Check balance
  const bal = getBalance(guildId, userId);
  if (bal < cost) {
    return interaction.reply({ content: `❌ Training costs **${cost.toLocaleString()}** ${currency} but you only have **${bal.toLocaleString()}** ${currency}.`, flags: 64 });
  }

  // Pick a random training mini-game (harder than play games)
  const games = ['catchpet', 'copycat', 'spotdiff'];
  const game = games[Math.floor(Math.random() * games.length)];

  await interaction.deferUpdate();

  let won = false;
  if (game === 'catchpet') won = await runCatchPetGame(interaction, pet, speciesData, userId, petId);
  else if (game === 'copycat') won = await runCopyCatGame(interaction, pet, speciesData, userId, petId);
  else won = await runSpotDiffGame(interaction, pet, speciesData, userId, petId);

  // Deduct cost
  await removeFromTotal(guildId, userId, cost);

  // Apply result
  const result = trainPet(petId, settings, won);
  if (!result.success) return;

  let desc = won
    ? `${speciesData.emoji} **${pet.name}** nailed it! Perfect training! 💪\n\n`
    : `${speciesData.emoji} **${pet.name}** learned from the attempt! 📖\n\n`;
  desc += `+${result.xpGain} XP${won ? ' *(+50% bonus!)*' : ''} | ❤️ ${result.happinessBefore} → ${result.happinessAfter}`;
  desc += `\n💰 Cost: **${cost.toLocaleString()}** ${currency}`;
  if (result.leveledUp) {
    desc += `\n🎉 **Leveled up to ${result.newLevel}!**`;
    if (result.newPhase) desc += ` Now a **${result.newPhase.emoji} ${result.newPhase.name}**!`;
  }

  const embed = new EmbedBuilder()
    .setColor(won ? 0x9B59B6 : 0xF39C12)
    .setTitle(won ? '📚 Perfect Training!' : '📚 Training Complete')
    .setDescription(desc)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_view_${petId}_u_${userId}`).setLabel('Back to Pet').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );

  return interaction.editReply({ embeds: [embed], components: [row], files: [] });
}

// ================== MINI-GAMES ==================

const TRICK_EMOJIS = ['🐾', '🎵', '💫', '🔥', '❄️', '⚡', '🌙', '🎪', '🎯', '💎'];

async function runFetchGame(interaction, pet, speciesData, userId, petId) {
  // Phase 1: "Get ready..."
  const readyEmbed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🎾 Fetch!')
    .setDescription(`${speciesData.emoji} **${pet.name}** wiggles excitedly...\n\n*Get ready to catch the ball!*`);

  await interaction.editReply({ embeds: [readyEmbed], components: [], files: [] });

  // Random delay 2-4 seconds
  const delay = 2000 + Math.floor(Math.random() * 2000);
  await new Promise(r => setTimeout(r, delay));

  // Phase 2: Show catch button
  const ts = Date.now();
  const catchEmbed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🎾 CATCH!')
    .setDescription(`${speciesData.emoji} **${pet.name}** threw the ball!\n\n**Quick, press Catch!** ⏱️ *5 seconds!*`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mg_catch_${petId}_${ts}`).setLabel('Catch!').setEmoji('🎾').setStyle(ButtonStyle.Success),
  );

  const msg = await interaction.editReply({ embeds: [catchEmbed], components: [row] });

  try {
    const resp = await msg.awaitMessageComponent({
      filter: i => i.user.id === userId && i.customId.startsWith(`mg_catch_${petId}_`),
      time: 5000,
    });
    await resp.deferUpdate();
    return true;
  } catch {
    return false;
  }
}

async function runHotColdGame(interaction, pet, speciesData, userId, petId) {
  const spots = [
    { emoji: '🌳', label: 'Tree', id: 'tree' },
    { emoji: '🪨', label: 'Rock', id: 'rock' },
    { emoji: '🌺', label: 'Flowers', id: 'flowers' },
    { emoji: '🏠', label: 'House', id: 'house' },
    { emoji: '🌊', label: 'Pond', id: 'pond' },
  ];
  const correctIdx = Math.floor(Math.random() * 5);
  const ts = Date.now();

  // Round 1: pick from 5 spots
  const embed1 = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🔥 Hot & Cold!')
    .setDescription(`${speciesData.emoji} **${pet.name}** scurries off and hides!\n\n🔍 *Where should you search first?*`);

  const row1 = new ActionRowBuilder().addComponents(
    spots.map(spot =>
      new ButtonBuilder()
        .setCustomId(`mg_hc1_${petId}_${spot.id}_${ts}`)
        .setLabel(spot.label)
        .setEmoji(spot.emoji)
        .setStyle(ButtonStyle.Primary)
    )
  );

  const msg = await interaction.editReply({ embeds: [embed1], components: [row1], files: [] });

  let firstPick;
  try {
    const resp = await msg.awaitMessageComponent({
      filter: i => i.user.id === userId && i.customId.startsWith(`mg_hc1_${petId}_`),
      time: 15000,
    });
    await resp.deferUpdate();
    firstPick = resp.customId.split('_')[3];
  } catch {
    return false;
  }

  const firstIdx = spots.findIndex(s => s.id === firstPick);
  const dist = Math.abs(firstIdx - correctIdx);

  // Determine hint
  let hint, hintColor;
  if (dist === 0) return true; // Found on first try!
  if (dist === 1) { hint = '🔥 **Burning hot!** They\'re RIGHT next to you!'; hintColor = 0xE74C3C; }
  else if (dist === 2) { hint = '🌡️ **Warm...** Getting closer!'; hintColor = 0xE67E22; }
  else { hint = '❄️ **Cold!** Try somewhere else!'; hintColor = 0x3498DB; }

  // Round 2: pick again (excluding first pick)
  const remaining = spots.filter(s => s.id !== firstPick);
  const embed2 = new EmbedBuilder()
    .setColor(hintColor)
    .setTitle('🔥 Hot & Cold!')
    .setDescription(`You checked the ${spots[firstIdx].emoji} ${spots[firstIdx].label}...\n\n${hint}\n\n🔍 *Try again!*`);

  const row2 = new ActionRowBuilder().addComponents(
    remaining.map(spot =>
      new ButtonBuilder()
        .setCustomId(`mg_hc2_${petId}_${spot.id}_${ts}`)
        .setLabel(spot.label)
        .setEmoji(spot.emoji)
        .setStyle(ButtonStyle.Primary)
    )
  );

  await interaction.editReply({ embeds: [embed2], components: [row2] });

  try {
    const resp2 = await msg.awaitMessageComponent({
      filter: i => i.user.id === userId && i.customId.startsWith(`mg_hc2_${petId}_`),
      time: 15000,
    });
    await resp2.deferUpdate();
    const secondPick = resp2.customId.split('_')[3];
    return secondPick === spots[correctIdx].id;
  } catch {
    return false;
  }
}

async function runTrickGame(interaction, pet, speciesData, userId, petId) {
  // Pick 3 random emojis for the sequence
  const shuffled = [...TRICK_EMOJIS].sort(() => Math.random() - 0.5);
  const sequence = shuffled.slice(0, 3);
  const sequenceStr = sequence.join(' ');

  // Show the sequence to memorize
  const showEmbed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🎪 Trick Time!')
    .setDescription(`${speciesData.emoji} **${pet.name}** performs a trick!\n\n**Memorize this:** ${sequenceStr}\n\n⏱️ *You have 4 seconds...*`);

  await interaction.editReply({ embeds: [showEmbed], components: [], files: [] });

  // Wait for memorizing
  await new Promise(r => setTimeout(r, 4000));

  // Generate 3 wrong answers
  const options = [sequenceStr];
  while (options.length < 4) {
    const wrong = [
      TRICK_EMOJIS[Math.floor(Math.random() * TRICK_EMOJIS.length)],
      TRICK_EMOJIS[Math.floor(Math.random() * TRICK_EMOJIS.length)],
      TRICK_EMOJIS[Math.floor(Math.random() * TRICK_EMOJIS.length)],
    ].join(' ');
    if (!options.includes(wrong)) options.push(wrong);
  }

  // Shuffle options, track correct index
  const shuffledOpts = options.sort(() => Math.random() - 0.5);
  const correctValue = shuffledOpts.indexOf(sequenceStr).toString();

  const hiddenEmbed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🎪 What was the trick?')
    .setDescription(`${speciesData.emoji} **${pet.name}** looks at you expectantly...\n\n**What was the sequence?**`);

  const ts = Date.now();
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`mg_trick_${petId}_${ts}`)
      .setPlaceholder('Pick the correct sequence...')
      .addOptions(shuffledOpts.map((opt, i) => ({
        label: opt,
        value: i.toString(),
      })))
  );

  const msg = await interaction.editReply({ embeds: [hiddenEmbed], components: [selectRow] });

  try {
    const resp = await msg.awaitMessageComponent({
      filter: i => i.user.id === userId && i.customId.startsWith(`mg_trick_${petId}_`),
      time: 15000,
    });
    await resp.deferUpdate();
    return resp.values[0] === correctValue;
  } catch {
    return false;
  }
}

// ================== TRAINING MINI-GAMES ==================

async function runCatchPetGame(interaction, pet, speciesData, userId, petId) {
  const grid = ['⬜','⬜','⬜','⬜','⬜','⬜','⬜','⬜','⬜'];
  const correctIdx = Math.floor(Math.random() * 9);
  const showGrid = [...grid];
  showGrid[correctIdx] = speciesData.emoji;

  // Flash the pet's position
  const flashEmbed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🎯 Catch the Pet!')
    .setDescription(`${speciesData.emoji} **${pet.name}** is darting around!\n\n**Spot them!**\n${showGrid.slice(0,3).join(' ')}\n${showGrid.slice(3,6).join(' ')}\n${showGrid.slice(6,9).join(' ')}`);

  await interaction.editReply({ embeds: [flashEmbed], components: [], files: [] });

  // Show for 1.5s then hide
  await new Promise(r => setTimeout(r, 1500));

  const ts = Date.now();
  const hiddenEmbed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🎯 Where were they?')
    .setDescription(`${speciesData.emoji} **${pet.name}** vanished! **Click where they were!**`);

  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`mg_catch_g_${petId}_${idx}_${ts}`)
          .setLabel('⬜')
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }

  const msg = await interaction.editReply({ embeds: [hiddenEmbed], components: rows });

  try {
    const resp = await msg.awaitMessageComponent({
      filter: i => i.user.id === userId && i.customId.startsWith(`mg_catch_g_${petId}_`),
      time: 10000,
    });
    await resp.deferUpdate();
    const picked = parseInt(resp.customId.split('_')[4]);
    return picked === correctIdx;
  } catch {
    return false;
  }
}

async function runCopyCatGame(interaction, pet, speciesData, userId, petId) {
  const actions = [
    { emoji: '🐾', label: 'Paw' },
    { emoji: '🎵', label: 'Sing' },
    { emoji: '💫', label: 'Spin' },
    { emoji: '🔥', label: 'Roar' },
    { emoji: '❄️', label: 'Shake' },
  ];

  // Pick 3 random actions for the sequence
  const shuffled = [...actions].sort(() => Math.random() - 0.5);
  const sequence = shuffled.slice(0, 3);
  const seqDisplay = sequence.map(a => a.emoji).join(' → ');

  // Show the sequence
  const showEmbed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🐾 Copy Cat!')
    .setDescription(`${speciesData.emoji} **${pet.name}** performs a routine!\n\n**Memorize the order:** ${seqDisplay}\n\n⏱️ *You have 3 seconds...*`);

  await interaction.editReply({ embeds: [showEmbed], components: [], files: [] });
  await new Promise(r => setTimeout(r, 3000));

  const ts = Date.now();
  const picks = [];

  // Collect 3 picks one at a time
  for (let step = 0; step < 3; step++) {
    const promptEmbed = new EmbedBuilder()
      .setColor(0xE67E22)
      .setTitle('🐾 Copy Cat!')
      .setDescription(`**Step ${step + 1}/3:** What comes next?\n\n${picks.map(p => p.emoji).join(' → ')}${picks.length ? ' → ❓' : '❓'}`);

    const row = new ActionRowBuilder().addComponents(
      actions.map(a =>
        new ButtonBuilder()
          .setCustomId(`mg_cc_${petId}_${a.label}_${step}_${ts}`)
          .setLabel(a.label)
          .setEmoji(a.emoji)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const msg = await interaction.editReply({ embeds: [promptEmbed], components: [row] });

    try {
      const resp = await msg.awaitMessageComponent({
        filter: i => i.user.id === userId && i.customId.startsWith(`mg_cc_${petId}_`) && i.customId.includes(`_${step}_`),
        time: 10000,
      });
      await resp.deferUpdate();
      const picked = resp.customId.split('_')[3];
      const pickedAction = actions.find(a => a.label === picked);
      picks.push(pickedAction);

      // Wrong pick = immediate fail
      if (picked !== sequence[step].label) return false;
    } catch {
      return false;
    }
  }

  return true; // All 3 correct
}

async function runSpotDiffGame(interaction, pet, speciesData, userId, petId) {
  const pool = ['🍎','🍊','🍋','🍇','🍓','🍑','🍒','🥝','🍌','🫐'];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const baseRow = shuffled.slice(0, 5);

  // Pick which position changes and what it changes to
  const changeIdx = Math.floor(Math.random() * 5);
  const remaining = pool.filter(e => !baseRow.includes(e));
  const replacement = remaining[Math.floor(Math.random() * remaining.length)];

  const changedRow = [...baseRow];
  changedRow[changeIdx] = replacement;

  const ts = Date.now();
  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('🔎 Spot the Difference!')
    .setDescription(`${speciesData.emoji} **${pet.name}** swapped a fruit! Which one changed?\n\n**Before:** ${baseRow.join('  ')}\n**After:**  ${changedRow.join('  ')}`);

  const row = new ActionRowBuilder().addComponents(
    changedRow.map((emoji, i) =>
      new ButtonBuilder()
        .setCustomId(`mg_spot_${petId}_${i}_${ts}`)
        .setLabel(`${i + 1}`)
        .setEmoji(emoji)
        .setStyle(ButtonStyle.Primary)
    )
  );

  const msg = await interaction.editReply({ embeds: [embed], components: [row], files: [] });

  try {
    const resp = await msg.awaitMessageComponent({
      filter: i => i.user.id === userId && i.customId.startsWith(`mg_spot_${petId}_`),
      time: 15000,
    });
    await resp.deferUpdate();
    const picked = parseInt(resp.customId.split('_')[3]);
    return picked === changeIdx;
  } catch {
    return false;
  }
}

async function handleSetActive(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Pet not found.', flags: 64 });

  setActivePet(guildId, userId, petId);

  // Refresh detail view with updated active state
  const updatedPet = getPet(petId);
  return showPetDetail(interaction, guildId, userId, settings, updatedPet);
}

async function handleViewPet(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Pet not found.', flags: 64 });
  return showPetDetail(interaction, guildId, userId, settings, pet);
}

// ================== RELEASE ==================

async function handleReleaseConfirm(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Pet not found.', flags: 64 });

  const speciesData = SPECIES[pet.species];
  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('⚠️ Release Pet?')
    .setDescription(
      `Are you sure you want to release **${pet.name}** (${speciesData.emoji} ${RARITIES[pet.rarity].name} ${speciesData.name})?\n\n` +
      `**This is permanent. Your pet will be gone forever.**`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_release_yes_${petId}_u_${userId}`).setLabel('Yes, Release').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`pet_release_no_${petId}_u_${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return interaction.update({ embeds: [embed], components: [row] });
}

async function handleReleaseExecute(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Pet not found.', flags: 64 });

  const speciesData = SPECIES[pet.species];
  deletePet(petId);

  const embed = new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle(`${speciesData.emoji} Goodbye, ${pet.name}...`)
    .setDescription(`You released **${pet.name}** into the wild. They looked back once before disappearing.`)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back to Panel').setEmoji('◀️').setStyle(ButtonStyle.Primary),
  );

  return interaction.update({ embeds: [embed], components: [row] });
}

// ================== RENAME ==================

async function handleRenameButton(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Pet not found.', flags: 64 });

  const modal = new ModalBuilder()
    .setCustomId(`modal_pet_rename_${petId}_u_${userId}`)
    .setTitle(`Rename ${pet.name} (${settings.renameCost.toLocaleString()} ${getCurrency(guildId)})`);

  const nameInput = new TextInputBuilder()
    .setCustomId('pet_rename_name')
    .setLabel('New name')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(24)
    .setRequired(true)
    .setValue(pet.name);

  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return interaction.showModal(modal);
}

async function handleRenameModal(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // modal_pet_rename_<petId>_u_<userId>
  const renameIdx = parts.indexOf('rename');
  const petId = parseInt(parts[renameIdx + 1]);
  const newName = interaction.fields.getTextInputValue('pet_rename_name').trim();

  if (!newName || newName.length > 24) {
    return interaction.reply({ content: '❌ Name must be 1-24 characters.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });

  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.editReply({ content: '❌ Pet not found.' });

  const balance = await getBalance(guildId, userId);
  if (balance.total < settings.renameCost) {
    return interaction.editReply({
      content: `❌ Renaming costs **${settings.renameCost.toLocaleString()}** ${getCurrency(guildId)} but you only have **${Math.round(balance.total).toLocaleString()}**.`,
    });
  }

  await removeFromTotal(guildId, userId, settings.renameCost, `Pet rename: ${pet.name} → ${newName}`);
  const oldName = pet.name;
  renamePet(petId, newName);

  return interaction.editReply({
    content: `✅ Renamed **${oldName}** → **${newName}** for **${settings.renameCost.toLocaleString()}** ${getCurrency(guildId)}`,
  });
}

// ================== KENNEL ==================

async function showKennelPanel(interaction, guildId, userId, settings) {
  const kennel = getKennel(guildId, userId);
  const balance = await getBalance(guildId, userId);
  const currency = getCurrency(guildId);
  const maxSlots = getMaxPetSlots(guildId, userId);
  const petCount = getUserPetCount(guildId, userId);
  const eggCount = getUserEggCount(guildId, userId);
  const gestatingCount = getMyGestatingPets(guildId, userId).length;
  const usedSlots = petCount + eggCount + gestatingCount;

  const embed = new EmbedBuilder()
    .setColor(0x8B4513)
    .setTitle('🏠 Pet Kennel')
    .setDescription(
      `Your kennel provides extra pet slots!\n\n` +
      `**Current Level:** ${kennel.level > 0 ? `Level ${kennel.level} (+${kennel.level} slots)` : 'None'}\n` +
      `**Slots:** ${usedSlots}/${maxSlots}\n` +
      `💰 **Balance:** ${Math.round(balance.total).toLocaleString()} ${currency}`
    )
    .setTimestamp();

  const maxLevel = settings.kennelPrices.length;

  if (kennel.level < maxLevel) {
    const nextCost = getKennelUpgradeCost(guildId, kennel.level);
    const nextLevel = kennel.level + 1;
    embed.addFields({
      name: `Upgrade to Level ${nextLevel}`,
      value: `**Cost:** ${nextCost.toLocaleString()} ${currency}\n+1 pet slot`,
    });
  } else {
    embed.addFields({ name: 'Max Level!', value: 'Your kennel is fully upgraded.' });
  }

  // Show all levels
  const levelInfo = settings.kennelPrices.map((cost, i) => {
    const level = i + 1;
    const status = kennel.level >= level ? '✅' : '❌';
    return `${status} Level ${level} — ${cost.toLocaleString()} ${currency} (+1 slot)`;
  });
  embed.addFields({ name: 'Upgrade Tiers', value: levelInfo.join('\n') });

  const components = [];
  if (kennel.level < maxLevel) {
    const nextCost = getKennelUpgradeCost(guildId, kennel.level);
    const canAfford = balance.total >= nextCost;
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pet_kennel_buy_${kennel.level + 1}_u_${userId}`)
        .setLabel(`Upgrade (${nextCost.toLocaleString()})`)
        .setEmoji('⬆️')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canAfford),
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  ));

  return interaction.update({ embeds: [embed], components });
}

async function handleKennelUpgrade(interaction, guildId, userId, settings) {
  const kennel = getKennel(guildId, userId);
  const cost = getKennelUpgradeCost(guildId, kennel.level);
  if (!cost) return interaction.reply({ content: '❌ Kennel is already max level!', flags: 64 });

  const balance = await getBalance(guildId, userId);
  if (balance.total < cost) {
    return interaction.reply({ content: `❌ You need **${cost.toLocaleString()}** ${getCurrency(guildId)}.`, flags: 64 });
  }

  await removeFromTotal(guildId, userId, cost, 'Kennel upgrade');
  const result = upgradeKennel(guildId, userId);
  if (!result.success) return interaction.reply({ content: '❌ ' + result.error, flags: 64 });

  // Refresh kennel panel
  return showKennelPanel(interaction, guildId, userId, settings);
}

// ================== EGG SHOP PANEL ==================

async function showEggShopPanel(interaction, guildId, userId, settings) {
  const balance = await getBalance(guildId, userId);
  const currency = getCurrency(guildId);
  const petCount = getUserPetCount(guildId, userId);
  const eggCount = getUserEggCount(guildId, userId);
  const maxSlots = getMaxPetSlots(guildId, userId);
  const usedSlots = petCount + eggCount;

  const discount = getPetDiscount(guildId, userId);

  let shopDesc = `💰 **Balance:** ${Math.round(balance.total).toLocaleString()} ${currency}\n` +
    `🐾 **Slots:** ${usedSlots}/${maxSlots} used (${petCount} pets, ${eggCount} eggs)\n\n` +
    `Purchase an egg to hatch a random pet!\nEggs take **72 hours** to hatch. Use **Warm** to speed it up!\n` +
    `Eggs occupy a pet slot while incubating.`;
  if (discount > 0) shopDesc += `\n🏷️ **Active discount: ${discount}% off!**`;

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🥚 Egg Shop')
    .setDescription(shopDesc)
    .setTimestamp();

  const eggTypes = ['mystery', 'golden', 'prismatic'];
  for (const type of eggTypes) {
    const eggData = EGG_TYPES[type];
    const price = getEggPrice(guildId, type);
    const discountedPrice = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;
    let priceDisplay = `${discountedPrice.toLocaleString()} ${currency}`;
    if (discount > 0) priceDisplay = `${discountedPrice.toLocaleString()} ~~${price.toLocaleString()}~~ ${currency}`;
    let speciesInfo;
    if (type === 'mystery') {
      speciesInfo = '🐺 Wolf · 👽 Alien · 🐱 Cat · 🐶 Dog · 🐦 Bird · 🕷️ Spider · 🐻 Bear · 🐼 Panda';
    } else if (type === 'golden') {
      speciesInfo = '🐺 Wolf · 👽 Alien · 🐉 Dragon · 🦄 Unicorn · 🐱 Cat · 🐶 Dog · 🐦 Bird · 🕷️ Spider · 🐻 Bear · 🐼 Panda';
    } else {
      speciesInfo = '🐺 Wolf · 👽 Alien · 🐉 Dragon · 🦄 Unicorn';
    }
    embed.addFields({
      name: `${eggData.emoji} ${eggData.name} — ${priceDisplay}`,
      value: `${speciesInfo}\n🌡️ Warm cost: **${eggData.warmCost.toLocaleString()}** · ✨ Shiny: **${Math.round(eggData.shinyChance * 100)}%**`,
    });
  }

  const slotsAvailable = usedSlots < maxSlots;
  const components = [];
  const buyRow = new ActionRowBuilder().addComponents(
    ...eggTypes.map(type => {
      const eggData = EGG_TYPES[type];
      const price = getEggPrice(guildId, type);
      const discPrice = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;
      const canAfford = balance.total >= discPrice && slotsAvailable;
      return new ButtonBuilder()
        .setCustomId(`pet_egg_buy_${type}_u_${userId}`)
        .setLabel(`${eggData.name} (${abbreviateNumber(discPrice)})`)
        .setEmoji(eggData.emoji)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canAfford);
    }),
  );
  components.push(buyRow);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_shop_u_${userId}`).setLabel('Pet Shop').setEmoji('🛒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_myeggs_u_${userId}`).setLabel('My Eggs').setEmoji('🥚').setStyle(ButtonStyle.Primary).setDisabled(eggCount === 0),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );
  components.push(navRow);

  return interaction.update({ embeds: [embed], components });
}

function abbreviateNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 0) + 'k';
  return n.toLocaleString();
}

async function handleEggBuy(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // pet_egg_buy_<type>_u_<userId>
  const eggType = parts[3];
  const eggData = EGG_TYPES[eggType];
  if (!eggData) return interaction.reply({ content: '❌ Invalid egg type.', flags: 64 });

  const price = getEggPrice(guildId, eggType);
  const balance = await getBalance(guildId, userId);

  // Apply discount
  const { finalPrice, discount, hasCoupon, hasLP } = applyPetDiscount(guildId, userId, price);
  if (balance.total < finalPrice) {
    return interaction.reply({ content: `❌ You need **${finalPrice.toLocaleString()}** ${getCurrency(guildId)} to buy a ${eggData.name}.`, flags: 64 });
  }

  const petCount = getUserPetCount(guildId, userId);
  const eggCount = getUserEggCount(guildId, userId);
  const maxSlots = getMaxPetSlots(guildId, userId);
  if (petCount + eggCount >= maxSlots) {
    return interaction.reply({ content: `❌ No available slots! You have **${petCount} pets + ${eggCount} eggs** using **${petCount + eggCount}/${maxSlots}** slots.`, flags: 64 });
  }

  await removeFromTotal(guildId, userId, finalPrice, `Bought ${eggData.name}`);
  const egg = buyEgg(guildId, userId, eggType);

  const currency = getCurrency(guildId);
  let paidLine = `You bought a **${eggData.name}** for **${finalPrice.toLocaleString()}** ${currency}`;
  if (discount > 0) {
    paidLine += ` ~~${price.toLocaleString()}~~ (${discount}% off`;
    if (hasCoupon && hasLP) paidLine += ' — 🎟️ coupon + 🪙 Lucky Penny';
    else if (hasCoupon) paidLine += ' — 🎟️ coupon';
    else if (hasLP) paidLine += ' — 🪙 Lucky Penny';
    paidLine += ')';
  }
  paidLine += '!';

  const embed = new EmbedBuilder()
    .setColor(eggData.color)
    .setTitle(`${eggData.emoji} Egg Purchased!`)
    .setDescription(
      `${paidLine}\n\n` +
      `⏳ **Hatches:** <t:${Math.floor(egg.hatch_time / 1000)}:F>\n` +
      `🌡️ Use **Warm** to speed up hatching (${eggData.warmCost.toLocaleString()} ${currency} per warm)\n\n` +
      `*Check your eggs from the main panel or the egg shop!*`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_myeggs_u_${userId}`).setLabel('My Eggs').setEmoji('🥚').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_egg_shop_u_${userId}`).setLabel('Buy Another').setEmoji('🛒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );

  return interaction.update({ embeds: [embed], components: [row], files: [] });
}

// ================== MY EGGS PANEL ==================

function getEggImageStage(egg) {
  const now = Date.now();
  const remaining = egg.hatch_time - now;
  if (remaining <= 24 * 3600000) return 3; // <1 day remaining (or ready)
  if (remaining <= 48 * 3600000) return 2; // <2 days remaining
  return 1; // first day
}

function getEggImagePath(eggType, stage) {
  const file = `${eggType}_egg_${stage}.png`;
  const filePath = path.join(__dirname, '..', 'assets', 'pets', file);
  if (fs.existsSync(filePath)) return { filePath, fileName: file };
  return null;
}

async function showMyEggsPanel(interaction, guildId, userId, settings, focusEggId = null) {
  const eggs = getUserEggs(guildId, userId);
  const currency = getCurrency(guildId);
  const now = Date.now();

  if (eggs.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('🥚 My Eggs')
      .setDescription('You have no eggs! Visit the egg shop to buy one.')
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pet_egg_shop_u_${userId}`).setLabel('Egg Shop').setEmoji('🥚').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
    );

    return interaction.update({ embeds: [embed], components: [row], files: [] });
  }

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🥚 My Eggs')
    .setTimestamp();

  let desc = '';
  for (const egg of eggs) {
    const eggData = EGG_TYPES[egg.egg_type];
    const ready = now >= egg.hatch_time;
    const warmCooldownDone = !egg.last_warm_time || (now - egg.last_warm_time) >= 3 * 3600000;

    desc += `${eggData.emoji} **${eggData.name}** (ID: ${egg.id})\n`;
    if (ready) {
      desc += `✅ **Ready to hatch!**\n`;
    } else {
      desc += `⏳ Hatches <t:${Math.floor(egg.hatch_time / 1000)}:R>\n`;
      desc += `🌡️ Warmed ${egg.warm_count}x`;
      if (!warmCooldownDone) {
        const remaining = (3 * 3600000) - (now - egg.last_warm_time);
        desc += ` · Next warm: ${formatCooldown(remaining)}`;
      } else {
        desc += ` · Warm ready!`;
      }
      desc += `\n`;
    }
    desc += `\n`;
  }
  embed.setDescription(desc);

  // Build action buttons for each egg (max 5 per row, max 5 rows)
  const components = [];
  for (const egg of eggs) {
    const eggData = EGG_TYPES[egg.egg_type];
    const ready = now >= egg.hatch_time;
    const warmCooldownDone = !egg.last_warm_time || (now - egg.last_warm_time) >= 3 * 3600000;

    const row = new ActionRowBuilder();
    if (ready) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`pet_egg_hatch_${egg.id}_u_${userId}`)
          .setLabel(`Hatch ${eggData.name}`)
          .setEmoji('🐣')
          .setStyle(ButtonStyle.Success),
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`pet_egg_warm_${egg.id}_u_${userId}`)
          .setLabel(`Warm (${eggData.warmCost.toLocaleString()} ${currency.replace(/<:[^:]+:\d+>/g, '').trim() || 'coins'})`)
          .setEmoji('🌡️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!warmCooldownDone),
      );
    }
    components.push(row);
    if (components.length >= 4) break; // Reserve last row for navigation
  }

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_egg_shop_u_${userId}`).setLabel('Egg Shop').setEmoji('🥚').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );
  components.push(navRow);

  // Attach egg image based on focused egg (just warmed) or first egg
  let files = [];
  const displayEgg = (focusEggId && eggs.find(e => e.id === focusEggId)) || eggs[0];
  const stage = getEggImageStage(displayEgg);
  const eggImage = getEggImagePath(displayEgg.egg_type, stage);
  if (eggImage) {
    const attachment = new AttachmentBuilder(eggImage.filePath, { name: eggImage.fileName });
    embed.setImage(`attachment://${eggImage.fileName}`);
    files.push(attachment);
  }

  return interaction.update({ embeds: [embed], components, files });
}

// ================== EGG WARM ==================

async function handleEggWarm(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // pet_egg_warm_<eggId>_u_<userId>
  const eggId = parseInt(parts[3]);
  const egg = getEgg(eggId);
  if (!egg || egg.owner_id !== userId) {
    return interaction.reply({ content: '❌ Egg not found.', flags: 64 });
  }

  const eggData = EGG_TYPES[egg.egg_type];
  const currency = getCurrency(guildId);
  const balance = await getBalance(guildId, userId);

  if (balance.total < eggData.warmCost) {
    return interaction.reply({ content: `❌ You need **${eggData.warmCost.toLocaleString()}** ${currency} to warm this egg.`, flags: 64 });
  }

  const result = warmEgg(guildId, userId, eggId);
  if (!result.success) {
    if (result.reason === 'cooldown') {
      return interaction.reply({ content: `❌ This egg was recently warmed! Next warm: ${formatCooldown(result.remaining)}`, flags: 64 });
    }
    return interaction.reply({ content: `❌ ${result.reason}`, flags: 64 });
  }

  await removeFromTotal(guildId, userId, result.cost, `Warmed ${eggData.name}`);

  const hours = Math.floor(result.reduction / 3600000);
  const mins = Math.floor((result.reduction % 3600000) / 60000);
  const reductionStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  if (result.ready) {
    // Egg is now ready!
    return showMyEggsPanel(interaction, guildId, userId, settings, eggId);
  }

  // Refresh the eggs panel
  return showMyEggsPanel(interaction, guildId, userId, settings, eggId);
}

// ================== EGG HATCH ==================

async function handleEggHatch(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // pet_egg_hatch_<eggId>_u_<userId>
  const eggId = parseInt(parts[3]);

  const result = hatchEgg(guildId, userId, eggId);
  if (!result.success) {
    if (result.reason === 'not_ready') {
      return interaction.reply({ content: `❌ This egg isn't ready yet! Hatches <t:${Math.floor(result.hatch_time / 1000)}:R>`, flags: 64 });
    }
    return interaction.reply({ content: `❌ ${result.reason}`, flags: 64 });
  }

  const { species, rarity, sex, shiny, variant } = result.result;
  const speciesData = SPECIES[species];
  const rarityData = RARITIES[rarity];
  const sexEmoji = sex === 'M' ? '♂️' : '♀️';
  const shinyStr = shiny ? '✨ **SHINY!** ' : '';
  const eggData = result.eggData;

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`🐣 Your ${eggData.name} hatched!`)
    .setDescription(
      `${shinyStr}${speciesData.emoji} A **${rarityData.name} ${speciesData.name}** ${sexEmoji} emerged!\n\n` +
      `${PHASES.baby.emoji} Baby — Level 1\n` +
      `**Specialty:** ${getSpecialtyDisplay(species)}\n\n` +
      `*Give them a name to welcome them home!*`
    )
    .setTimestamp();

  // Show baby image
  const petImage = await getPetImage(species, 'baby', variant, shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  // Store hatch result in customId for the name button
  // pet_egg_name_<species>_<rarity>_<sex>_<shiny>_<variant>_u_<userId>
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_egg_name_${species}_${rarity}_${sex}_${shiny}_${variant}_u_${userId}`)
      .setLabel('Name This Pet')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Success),
  );

  return interaction.update({ embeds: [embed], components: [row], files });
}

async function handleEggNameButton(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // pet_egg_name_<species>_<rarity>_<sex>_<shiny>_<variant>_u_<userId>
  const species = parts[3];
  const rarity = parts[4];
  const sex = parts[5];
  const shiny = parts[6];
  const variant = parts[7];

  const speciesData = SPECIES[species];
  if (!speciesData) return interaction.reply({ content: '❌ Invalid pet data.', flags: 64 });

  const modal = new ModalBuilder()
    .setCustomId(`modal_egg_name_${species}_${rarity}_${sex}_${shiny}_${variant}_u_${userId}`)
    .setTitle('Name Your Hatched Pet');

  const nameInput = new TextInputBuilder()
    .setCustomId('pet_name')
    .setLabel(`Name your ${speciesData.name}`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(24)
    .setRequired(true)
    .setPlaceholder('Enter a name...');

  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return interaction.showModal(modal);
}

async function handleEggNameModal(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // modal_egg_name_<species>_<rarity>_<sex>_<shiny>_<variant>_u_<userId>
  const species = parts[3];
  const rarity = parts[4];
  const sex = parts[5];
  const shiny = parseInt(parts[6]);
  const variant = parseInt(parts[7]);
  const petName = interaction.fields.getTextInputValue('pet_name').trim();

  if (!petName || petName.length > 24) {
    return interaction.reply({ content: '❌ Pet name must be 1-24 characters.', flags: 64 });
  }

  await interaction.deferUpdate();

  const speciesData = SPECIES[species];
  if (!speciesData) return interaction.editReply({ content: '❌ Invalid pet data.', embeds: [], components: [], files: [] });

  // Note: egg was already deleted during hatch. The pet just needs to be created.
  const pet = adoptPet(guildId, userId, species, petName, rarity, sex, shiny, 'hatched', variant);

  const rarityData = RARITIES[rarity];
  const sexEmoji = sex === 'M' ? '♂️' : '♀️';
  const shinyStr = shiny ? '✨ **SHINY!** ' : '';

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`${speciesData.emoji} Welcome, ${petName}!`)
    .setDescription(
      `${shinyStr}${sexEmoji} **${rarityData.name} ${speciesData.name}**\n` +
      `${PHASES.baby.emoji} Baby — Level 1\n\n` +
      `**${petName}** has joined your family!`
    )
    .setTimestamp();

  const petImage = await getPetImage(species, 'baby', variant, shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Pet Panel').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_dismiss_u_${userId}`).setLabel('Dismiss').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

  // Check if server announcement needed (legendary or shiny)
  let announcement = null;
  if (rarity === 'legendary' || shiny) {
    const announceEmoji = shiny ? '✨🐣' : '🐣🟡';
    announcement = `${announceEmoji} **${interaction.user.displayName}** hatched a ${shiny ? '✨ **SHINY** ' : ''}**${rarityData.name} ${speciesData.name}** named **${petName}**!`;
  }

  await interaction.editReply({ embeds: [embed], components: [row], files });

  // Send announcement in same channel if applicable
  if (announcement) {
    try {
      await interaction.channel.send({ content: announcement });
    } catch (e) {
      // Can't send announcement, ignore
    }
  }
}

// ================== BREEDING ==================

async function showBreedingPanel(interaction, guildId, userId, settings, initialPetId = null) {
  if (!settings.breedingEnabled) {
    return interaction.reply({ content: '❌ Breeding is not enabled on this server.', flags: 64 });
  }

  await interaction.deferUpdate();
  const currency = getCurrency(guildId);
  const pets = getUserPets(guildId, userId);
  
  // Filter breedable pets (Adult/Elder, not gestating)
  const breedablePets = pets.filter(p => {
    const phase = getPhase(p.level);
    return phase.canBreed && !p.gestating;
  });

  // Check for gestating pets
  const gestatingPets = pets.filter(p => p.gestating);
  const gestatingForMe = getGestatingPets(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('💕 Breeding')
    .setDescription('Breed your Adult/Elder pets to create offspring!')
    .setTimestamp();

  // Show gestating pets
  if (gestatingPets.length > 0) {
    const gestList = gestatingPets.map(p => {
      const timeLeft = p.gestation_end - Date.now();
      const ready = timeLeft <= 0;
      const speciesData = SPECIES[p.species];
      return `${speciesData.emoji} **${p.name}** — ${ready ? '🎉 Ready to give birth!' : `⏳ ${formatCooldown(timeLeft)}`}`;
    }).join('\n');
    embed.addFields({ name: '🤰 Gestating', value: gestList });
  }

  // Show incoming babies (from cross-player breeding)
  if (gestatingForMe.length > 0) {
    const incoming = gestatingForMe.filter(p => p.owner_id !== userId);
    if (incoming.length > 0) {
      const incList = incoming.map(p => {
        const timeLeft = p.gestation_end - Date.now();
        const ready = timeLeft <= 0;
        const speciesData = SPECIES[p.species];
        return `${speciesData.emoji} ${speciesData.name} — ${ready ? '🎉 Ready!' : `⏳ ${formatCooldown(timeLeft)}`}`;
      }).join('\n');
      embed.addFields({ name: '📬 Incoming Babies', value: incList });
    }
  }

  // Show breedable pets
  if (breedablePets.length === 0) {
    embed.addFields({ name: 'Your Pets', value: 'No breedable pets. Pets must be Adult (L26+) or Elder (L41+) to breed.' });
  } else {
    const males = breedablePets.filter(p => p.sex === 'M');
    const females = breedablePets.filter(p => {
      if (p.sex !== 'F') return false;
      // Check cooldown
      const now = Date.now();
      return !p.breeding_cooldown_end || now >= p.breeding_cooldown_end;
    });

    if (males.length > 0) {
      const maleList = males.slice(0, 5).map(p => {
        const speciesData = SPECIES[p.species];
        const rarityData = RARITIES[p.rarity];
        return `${speciesData.emoji} **${p.name}** — ${rarityData.name} L${p.level}`;
      }).join('\n');
      embed.addFields({ name: '♂️ Males', value: maleList, inline: true });
    }

    if (females.length > 0) {
      const femaleList = females.slice(0, 5).map(p => {
        const speciesData = SPECIES[p.species];
        const rarityData = RARITIES[p.rarity];
        return `${speciesData.emoji} **${p.name}** — ${rarityData.name} L${p.level}`;
      }).join('\n');
      embed.addFields({ name: '♀️ Females (Available)', value: femaleList, inline: true });
    }

    // Show females on cooldown
    const cooldownFemales = breedablePets.filter(p => {
      if (p.sex !== 'F') return false;
      const now = Date.now();
      return p.breeding_cooldown_end && now < p.breeding_cooldown_end;
    });
    if (cooldownFemales.length > 0) {
      const cdList = cooldownFemales.slice(0, 3).map(p => {
        const speciesData = SPECIES[p.species];
        const remaining = p.breeding_cooldown_end - Date.now();
        return `${speciesData.emoji} **${p.name}** — ${formatCooldown(remaining)}`;
      }).join('\n');
      embed.addFields({ name: '⏳ On Cooldown', value: cdList, inline: true });
    }
  }

  const rows = [];

  // If gestating pets are ready, show birth buttons
  const readyBirths = gestatingForMe.filter(p => {
    const now = Date.now();
    return p.gestation_end <= now;
  });

  if (readyBirths.length > 0) {
    const birthRow = new ActionRowBuilder();
    readyBirths.slice(0, 5).forEach(p => {
      const speciesData = SPECIES[p.species];
      birthRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`pet_birth_${p.id}_u_${userId}`)
          .setLabel(`Birth: ${p.name}`)
          .setEmoji('🎉')
          .setStyle(ButtonStyle.Success)
      );
    });
    rows.push(birthRow);
  }

  // Create select menus for breeding if we have valid pairs
  const males = breedablePets.filter(p => p.sex === 'M');
  const availableFemales = breedablePets.filter(p => {
    if (p.sex !== 'F') return false;
    const now = Date.now();
    return !p.breeding_cooldown_end || now >= p.breeding_cooldown_end;
  });

  if (males.length > 0 && availableFemales.length > 0) {
    // Group by species for breeding pairs
    const speciesPairs = {};
    males.forEach(m => {
      if (!speciesPairs[m.species]) speciesPairs[m.species] = { males: [], females: [] };
      speciesPairs[m.species].males.push(m);
    });
    availableFemales.forEach(f => {
      if (!speciesPairs[f.species]) speciesPairs[f.species] = { males: [], females: [] };
      speciesPairs[f.species].females.push(f);
    });

    // Find valid species (have both male and female)
    const validSpecies = Object.entries(speciesPairs).filter(([_, d]) => d.males.length > 0 && d.females.length > 0);

    if (validSpecies.length > 0) {
      // Create a select menu for own-pet breeding
      const options = [];
      validSpecies.forEach(([species, data]) => {
        data.males.slice(0, 3).forEach(m => {
          data.females.slice(0, 3).forEach(f => {
            const speciesData = SPECIES[species];
            const highRarity = RARITY_ORDER.indexOf(m.rarity) >= RARITY_ORDER.indexOf(f.rarity) ? m.rarity : f.rarity;
            const isExotic = speciesData.type === 'exotic';
            const fee = getBreedingFee(guildId, highRarity, isExotic);
            options.push({
              label: `${m.name} ♂ × ${f.name} ♀`,
              description: `${speciesData.name} — Fee: ${fee.toLocaleString()} ${currency}`,
              value: `${m.id}_${f.id}`,
              emoji: speciesData.emoji,
            });
          });
        });
      });

      if (options.length > 0) {
        const selectRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`pet_breed_select_u_${userId}`)
            .setPlaceholder('Select a breeding pair...')
            .addOptions(options.slice(0, 25))
        );
        rows.push(selectRow);
      }
    }
  }

  // Cleanup expired requests
  cleanupExpiredBreedingRequests(guildId);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_stud_request_u_${userId}`).setLabel('Breed with Another Player').setEmoji('🔗').setStyle(ButtonStyle.Primary).setDisabled(breedablePets.length === 0),
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navRow);

  await interaction.editReply({ embeds: [embed], components: rows, files: [] });
}

async function handleBreedSelectPet(interaction, guildId, userId, settings) {
  await interaction.deferUpdate();
  const currency = getCurrency(guildId);

  const [maleIdStr, femaleIdStr] = interaction.values[0].split('_');
  const maleId = parseInt(maleIdStr);
  const femaleId = parseInt(femaleIdStr);

  const male = getPet(maleId);
  const female = getPet(femaleId);

  if (!male || !female) {
    return interaction.editReply({ content: '❌ Pet not found.', embeds: [], components: [] });
  }

  // Verify ownership
  if (male.owner_id !== userId || female.owner_id !== userId) {
    return interaction.editReply({ content: '❌ These are not your pets.', embeds: [], components: [] });
  }

  // Verify can breed
  const check = canBreedTogether(male, female);
  if (!check.canBreed) {
    return interaction.editReply({ content: `❌ ${check.reason}`, embeds: [], components: [] });
  }

  // Calculate fee
  const speciesData = SPECIES[male.species];
  const highRarity = RARITY_ORDER.indexOf(male.rarity) >= RARITY_ORDER.indexOf(female.rarity) ? male.rarity : female.rarity;
  const isExotic = speciesData.type === 'exotic';
  const fee = getBreedingFee(guildId, highRarity, isExotic);

  // Check balance
  const balance = getBalance(guildId, userId);
  if (balance.total < fee) {
    return interaction.editReply({ 
      content: `❌ Breeding fee: **${fee.toLocaleString()} ${currency}** — You have **${balance.total.toLocaleString()} ${currency}**`, 
      embeds: [], components: [] 
    });
  }

  // Show confirmation
  const malePhase = getPhase(male.level);
  const femalePhase = getPhase(female.level);
  const hasElder = malePhase.name === 'Elder' || femalePhase.name === 'Elder';

  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('💕 Confirm Breeding')
    .setDescription(
      `**${male.name}** ♂ × **${female.name}** ♀\n\n` +
      `Species: ${speciesData.emoji} ${speciesData.name}\n` +
      `Breeding Fee: **${fee.toLocaleString()} ${currency}**\n` +
      `Gestation: **${settings.gestationHours} hours**\n` +
      (hasElder ? '✨ Elder bonus: +1 rarity tier!\n' : '') +
      `\n⚠️ **${female.name}** will be gestating and cannot breed again until after birth + ${settings.breedingCooldownHours}h cooldown.`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_breed_confirm_${maleId}_${femaleId}_u_${userId}`)
      .setLabel(`Breed (${fee.toLocaleString()})`)
      .setEmoji('💕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pet_breed_cancel_u_${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row], files: [] });
}

async function handleBreedConfirm(interaction, guildId, userId, settings) {
  await interaction.deferUpdate();
  const currency = getCurrency(guildId);

  const parts = interaction.customId.split('_');
  // pet_breed_confirm_<maleId>_<femaleId>_u_<userId>
  const maleId = parseInt(parts[3]);
  const femaleId = parseInt(parts[4]);

  const male = getPet(maleId);
  const female = getPet(femaleId);

  if (!male || !female) {
    return interaction.editReply({ content: '❌ Pet not found.', embeds: [], components: [] });
  }

  // Re-verify everything
  if (male.owner_id !== userId || female.owner_id !== userId) {
    return interaction.editReply({ content: '❌ These are not your pets.', embeds: [], components: [] });
  }

  const check = canBreedTogether(male, female);
  if (!check.canBreed) {
    return interaction.editReply({ content: `❌ ${check.reason}`, embeds: [], components: [] });
  }

  // Check kennel slot for baby
  const maxSlots = getMaxPetSlots(guildId, userId);
  const petCount = getUserPetCount(guildId, userId);
  const eggCount = getUserEggCount(guildId, userId);
  const gestatingCount = getGestatingPets(guildId, userId).length;

  if (petCount + eggCount + gestatingCount >= maxSlots) {
    return interaction.editReply({ content: `❌ No room for baby! You have ${petCount} pets + ${eggCount} eggs + ${gestatingCount} gestating using ${petCount + eggCount + gestatingCount}/${maxSlots} slots.`, embeds: [], components: [] });
  }

  // Calculate and deduct fee
  const speciesData = SPECIES[male.species];
  const highRarity = RARITY_ORDER.indexOf(male.rarity) >= RARITY_ORDER.indexOf(female.rarity) ? male.rarity : female.rarity;
  const isExotic = speciesData.type === 'exotic';
  const fee = getBreedingFee(guildId, highRarity, isExotic);

  const removed = await removeFromTotal(guildId, userId, fee, 'Breeding fee');
  if (!removed || !removed.success) {
    return interaction.editReply({ content: `❌ Not enough ${currency}! Need **${fee.toLocaleString()}** ${currency}.`, embeds: [], components: [] });
  }

  // Start gestation
  const result = startGestation(guildId, femaleId, maleId, userId);
  if (!result.success) {
    await addMoney(guildId, userId, fee, 'wallet'); // Refund
    return interaction.editReply({ content: `❌ ${result.reason}`, embeds: [], components: [] });
  }

  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('💕 Breeding Started!')
    .setDescription(
      `**${male.name}** and **${female.name}** are now expecting!\n\n` +
      `${speciesData.emoji} **${female.name}** is gestating.\n` +
      `The baby will be ready in **${settings.gestationHours} hours**.\n\n` +
      `Fee paid: **${fee.toLocaleString()} ${currency}**`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_breed_menu_u_${userId}`).setLabel('Breeding').setEmoji('💕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row], files: [] });
}

async function handleGiveBirth(interaction, guildId, userId, settings) {
  await interaction.deferUpdate();
  const currency = getCurrency(guildId);

  const parts = interaction.customId.split('_');
  // pet_birth_<petId>_u_<userId>
  const femalePetId = parseInt(parts[2]);

  const female = getPet(femalePetId);
  if (!female) {
    return interaction.editReply({ content: '❌ Pet not found.', embeds: [], components: [] });
  }

  // Verify gestation target (could be cross-player breeding)
  if (female.gestating_for_user !== userId) {
    return interaction.editReply({ content: '❌ This baby is not for you.', embeds: [], components: [] });
  }

  // Get the male parent info if available (for variant calculation)
  // For now, we'll use female's data for simplicity since we don't store male parent
  const result = giveBirth(guildId, femalePetId, null, userId);

  if (!result.success) {
    if (result.reason === 'Not ready yet') {
      const timeLeft = result.gestation_end - Date.now();
      return interaction.editReply({ content: `❌ Not ready yet! ${formatCooldown(timeLeft)} remaining.`, embeds: [], components: [] });
    }
    return interaction.editReply({ content: `❌ ${result.reason}`, embeds: [], components: [] });
  }

  const speciesData = SPECIES[result.species];
  const rarityData = RARITIES[result.rarity];
  const sexEmoji = result.sex === 'M' ? '♂️' : '♀️';
  const shinyStr = result.shiny ? '✨ **SHINY!** ' : '';

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle('🎉 A New Pet is Born!')
    .setDescription(
      `${shinyStr}${speciesData.emoji} ${sexEmoji} **${rarityData.name} ${speciesData.name}**\n\n` +
      `Mother: **${result.motherName}**\n` +
      (result.fatherName ? `Father: **${result.fatherName}**\n` : '') +
      (result.hadElder ? '✨ Elder bonus applied!\n' : '') +
      `\nGive your new pet a name!`
    )
    .setTimestamp();

  // Show baby image
  const petImage = await getPetImage(result.species, 'baby', result.variant, result.shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  // Include mother/father IDs in the button customId
  const motherId = result.motherId || 0;
  const fatherId = result.fatherId || 0;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_birth_name_${result.species}_${result.rarity}_${result.sex}_${result.shiny}_${result.variant}_${motherId}_${fatherId}_u_${userId}`)
      .setLabel('Name This Pet')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({ embeds: [embed], components: [row], files });
}

async function handleBirthName(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // pet_birth_name_<species>_<rarity>_<sex>_<shiny>_<variant>_<motherId>_<fatherId>_u_<userId>
  const species = parts[3];
  const speciesData = SPECIES[species];

  const modal = new ModalBuilder()
    .setCustomId(`modal_birth_name_${parts.slice(3).join('_')}`)
    .setTitle('Name Your Newborn Pet');

  const nameInput = new TextInputBuilder()
    .setCustomId('pet_name')
    .setLabel(`Name your ${speciesData.name}`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(24)
    .setRequired(true)
    .setPlaceholder('Enter a name...');

  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return interaction.showModal(modal);
}

async function handleBirthNameModal(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // modal_birth_name_<species>_<rarity>_<sex>_<shiny>_<variant>_<motherId>_<fatherId>_u_<userId>
  const species = parts[3];
  const rarity = parts[4];
  const sex = parts[5];
  const shiny = parseInt(parts[6]);
  const variant = parseInt(parts[7]);
  const motherId = parseInt(parts[8]) || null;
  const fatherId = parseInt(parts[9]) || null;
  const petName = interaction.fields.getTextInputValue('pet_name').trim();

  if (!petName || petName.length > 24) {
    return interaction.reply({ content: '❌ Pet name must be 1-24 characters.', flags: 64 });
  }

  await interaction.deferUpdate();

  const speciesData = SPECIES[species];
  if (!speciesData) return interaction.editReply({ content: '❌ Invalid pet data.', embeds: [], components: [], files: [] });

  // Look up parents to get their names and their parents' names (grandparents)
  const mother = motherId ? getPet(motherId) : null;
  const father = fatherId ? getPet(fatherId) : null;

  // Build full lineage object with grandparent names
  const lineage = {
    motherId,
    fatherId,
    motherName: mother ? mother.name : null,
    fatherName: father ? father.name : null,
    // Grandparents from mother's side
    maternalGrandmotherName: mother ? mother.mother_name : null,
    maternalGrandfatherName: mother ? mother.father_name : null,
    // Grandparents from father's side
    paternalGrandmotherName: father ? father.mother_name : null,
    paternalGrandfatherName: father ? father.father_name : null,
  };

  // Create the pet with full lineage info
  const pet = adoptPet(guildId, userId, species, petName, rarity, sex, shiny, 'bred', variant, lineage);

  const rarityData = RARITIES[rarity];
  const sexEmoji = sex === 'M' ? '♂️' : '♀️';
  const shinyStr = shiny ? '✨ **SHINY!** ' : '';

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`${speciesData.emoji} Welcome, ${petName}!`)
    .setDescription(
      `${shinyStr}${sexEmoji} **${rarityData.name} ${speciesData.name}**\n` +
      `${PHASES.baby.emoji} Baby — Level 1\n\n` +
      `**${petName}** has joined your family!`
    )
    .setTimestamp();

  const petImage = await getPetImage(species, 'baby', variant, shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_breed_menu_u_${userId}`).setLabel('Breeding').setEmoji('💕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_dismiss_u_${userId}`).setLabel('Dismiss').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

  // Announcement for legendary or shiny
  let announcement = null;
  if (rarity === 'legendary' || shiny) {
    const announceEmoji = shiny ? '✨🍼' : '🍼🟡';
    announcement = `${announceEmoji} **${interaction.user.displayName}** bred a ${shiny ? '✨ **SHINY** ' : ''}**${rarityData.name} ${speciesData.name}** named **${petName}**!`;
  }

  await interaction.editReply({ embeds: [embed], components: [row], files });

  if (announcement) {
    try {
      await interaction.channel.send({ content: announcement });
    } catch (e) {}
  }
}

// ================== CROSS-PLAYER BREEDING (STUD SERVICE) ==================

// Step 1: Show panel to select your pet for stud request
async function showStudRequestPanel(interaction, guildId, userId, settings) {
  if (!settings.breedingEnabled) {
    return interaction.reply({ content: '❌ Breeding is not enabled on this server.', flags: 64 });
  }

  await interaction.deferUpdate();
  const currency = getCurrency(guildId);
  const pets = getUserPets(guildId, userId);
  
  // Filter breedable pets (Adult/Elder, not gestating, not on cooldown if female)
  const breedablePets = pets.filter(p => {
    const phase = getPhase(p.level);
    if (!phase.canBreed || p.gestating) return false;
    if (p.sex === 'F') {
      const now = Date.now();
      if (p.breeding_cooldown_end && now < p.breeding_cooldown_end) return false;
    }
    return true;
  });

  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('� Breed with Another Player')
    .setDescription(
      'Request to breed one of your pets with another player\'s pet.\n\n' +
      '**How it works:**\n' +
      '1. Select your pet below\n' +
      '2. Select the player you want to breed with\n' +
      '3. Select their compatible pet\n' +
      '4. A public message will be sent for them to accept/decline\n' +
      '5. They can set a stud fee when accepting\n' +
      '6. You confirm the fee and breeding begins!\n\n' +
      '*You receive the baby. You pay the stud fee (if any).*'
    )
    .setTimestamp();

  if (breedablePets.length === 0) {
    embed.addFields({ name: 'Your Pets', value: 'No breedable pets available. Need Adult/Elder pets not on cooldown.' });
  }

  const rows = [];

  if (breedablePets.length > 0) {
    const options = breedablePets.slice(0, 25).map(p => {
      const speciesData = SPECIES[p.species];
      const rarityData = RARITIES[p.rarity];
      const sexEmoji = p.sex === 'M' ? '♂' : '♀';
      return {
        label: `${p.name} ${sexEmoji}`,
        description: `${rarityData.name} ${speciesData.name} L${p.level}`,
        value: `${p.id}`,
        emoji: speciesData.emoji,
      };
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pet_stud_mypet_u_${userId}`)
        .setPlaceholder('Select your pet...')
        .addOptions(options)
    );
    rows.push(selectRow);
  }

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_breed_menu_u_${userId}`).setLabel('Back to Breeding').setEmoji('💕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navRow);

  await interaction.editReply({ embeds: [embed], components: rows, files: [] });
}

// Handle "Request Stud" button (legacy)
async function handleBreedRequest(interaction, guildId, userId, settings) {
  return showStudRequestPanel(interaction, guildId, userId, settings);
}

// Handle deprecated breed partner select
async function handleBreedPartnerSelect(interaction, guildId, userId, settings) {
  return showStudRequestPanel(interaction, guildId, userId, settings);
}

// Step 2: User selected their pet, now show user select menu to pick target
async function handleStudMyPetSelect(interaction, guildId, userId, settings) {
  const petId = parseInt(interaction.values[0]);
  const pet = getPet(petId);
  
  if (!pet || pet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Pet not found or not yours.', flags: 64 });
  }

  const check = canBreed(pet, guildId);
  if (!check.canBreed) {
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  await interaction.deferUpdate();

  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';

  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('💌 Select Target User')
    .setDescription(
      `Your pet: ${speciesData.emoji} **${pet.name}** ${sexEmoji} (${rarityData.name})\n\n` +
      `Select the user whose pet you want to breed with:\n` +
      `*They can accept and set a stud fee.*`
    )
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`pet_stud_targetuser_${petId}_u_${userId}`)
      .setPlaceholder('Select a user...')
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_stud_request_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [userSelectRow, navRow], files: [] });
}

// Step 3: User selected target user, now show their compatible pets
async function handleStudTargetUserSelect(interaction, guildId, userId, settings) {
  // pet_stud_targetuser_<petId>_u_<userId>
  const parts = interaction.customId.split('_');
  const petId = parseInt(parts[3]);
  
  const myPet = getPet(petId);
  if (!myPet || myPet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Pet not found.', flags: 64 });
  }

  const targetUserId = interaction.values[0];

  if (targetUserId === userId) {
    return interaction.reply({ content: '❌ You can\'t request to breed with yourself. Use the normal breeding panel.', flags: 64 });
  }

  await interaction.deferUpdate();
  const currency = getCurrency(guildId);

  // Get target user's pets
  const targetPets = getUserPets(guildId, targetUserId);
  
  // Find compatible pets (same species, opposite sex, breedable)
  const oppositeSex = myPet.sex === 'M' ? 'F' : 'M';
  const compatiblePets = targetPets.filter(p => {
    if (p.species !== myPet.species) return false;
    if (p.sex !== oppositeSex) return false;
    const phase = getPhase(p.level);
    if (!phase.canBreed || p.gestating) return false;
    if (p.sex === 'F') {
      const now = Date.now();
      if (p.breeding_cooldown_end && now < p.breeding_cooldown_end) return false;
    }
    return true;
  });

  if (compatiblePets.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('❌ No Compatible Pets')
      .setDescription(
        `<@${targetUserId}> has no compatible pets for breeding.\n\n` +
        `Looking for: **${SPECIES[myPet.species].name}** ${oppositeSex === 'M' ? '♂️ Male' : '♀️ Female'}\n` +
        `(Adult/Elder, not gestating or on cooldown)`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pet_breed_menu_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    );

    return interaction.editReply({ embeds: [embed], components: [row], files: [] });
  }

  // Show compatible pets to select
  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('💕 Select Partner Pet')
    .setDescription(
      `Your pet: **${myPet.name}** (${myPet.sex === 'M' ? '♂️' : '♀️'})\n` +
      `Target: <@${targetUserId}>\n\n` +
      `Select a compatible pet from their collection:\n` +
      `*They can set a stud fee when accepting.*`
    )
    .setTimestamp();

  const options = compatiblePets.slice(0, 25).map(p => {
    const speciesData = SPECIES[p.species];
    const rarityData = RARITIES[p.rarity];
    const sexEmoji = p.sex === 'M' ? '♂' : '♀';
    return {
      label: `${p.name} ${sexEmoji}`,
      description: `${rarityData.name} ${speciesData.name} L${p.level}`,
      value: `${myPet.id}_${p.id}_${targetUserId}`,
      emoji: speciesData.emoji,
    };
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pet_stud_partner_u_${userId}`)
      .setPlaceholder('Select their pet...')
      .addOptions(options)
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_stud_request_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [selectRow, navRow], files: [] });
}

// Step 4: Create the breeding request - send PUBLIC message to channel
async function handleStudPartnerSelect(interaction, guildId, userId, settings) {
  const [myPetIdStr, theirPetIdStr, targetUserId] = interaction.values[0].split('_');
  const myPetId = parseInt(myPetIdStr);
  const theirPetId = parseInt(theirPetIdStr);

  const myPet = getPet(myPetId);
  const theirPet = getPet(theirPetId);

  if (!myPet || myPet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Your pet not found.', flags: 64 });
  }

  if (!theirPet || theirPet.owner_id !== targetUserId) {
    return interaction.reply({ content: '❌ Their pet not found.', flags: 64 });
  }

  // Verify breeding compatibility
  const check = canBreedTogether(myPet, theirPet);
  if (!check.canBreed) {
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  // Check for existing pending request
  const outgoing = getOutgoingBreedingRequests(guildId, userId);
  const existingRequest = outgoing.find(r => 
    (r.requester_pet_id === myPetId && r.partner_pet_id === theirPetId) ||
    (r.partner_pet_id === myPetId && r.requester_pet_id === theirPetId)
  );
  if (existingRequest) {
    return interaction.reply({ content: '❌ You already have a pending request for this breeding pair.', flags: 64 });
  }

  // Create the request (with 0 fee - partner sets fee when accepting)
  const request = createBreedingRequest(guildId, userId, myPetId, targetUserId, theirPetId, 0);
  if (!request) {
    return interaction.reply({ content: '❌ Failed to create breeding request.', flags: 64 });
  }

  // Dismiss the panel
  await interaction.update({ content: '✅ Breeding request sent!', embeds: [], components: [] });

  const speciesData = SPECIES[myPet.species];
  const currency = getCurrency(guildId);
  const female = myPet.sex === 'F' ? myPet : theirPet;
  const male = myPet.sex === 'M' ? myPet : theirPet;
  const highRarity = RARITY_ORDER.indexOf(male.rarity) >= RARITY_ORDER.indexOf(female.rarity) ? male.rarity : female.rarity;
  const isExotic = speciesData.type === 'exotic';
  const breedingFee = getBreedingFee(guildId, highRarity, isExotic);

  // Send PUBLIC message tagging the partner
  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('💕 Breeding Request')
    .setDescription(
      `<@${userId}> wants to breed with <@${targetUserId}>!\n\n` +
      `${speciesData.emoji} **${myPet.name}** (${myPet.sex === 'M' ? '♂' : '♀'}) × **${theirPet.name}** (${theirPet.sex === 'M' ? '♂' : '♀'})\n\n` +
      `📋 **Breeding Fee:** ${breedingFee.toLocaleString()} ${currency} (paid by requester)\n\n` +
      `<@${targetUserId}>, do you accept? You can set a stud fee.\n` +
      `*Expires in 24 hours.*`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_stud_accept_${request.id}_p_${targetUserId}`)
      .setLabel('Accept')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pet_stud_decline_${request.id}_p_${targetUserId}`)
      .setLabel('Decline')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.channel.send({ content: `<@${targetUserId}>`, embeds: [embed], components: [row] });
}

// Handle partner accept button - show modal to set stud fee
async function handleStudAccept(interaction, guildId, userId, settings) {
  const customId = interaction.customId;
  // pet_stud_accept_<requestId>_p_<partnerId>
  const parts = customId.split('_');
  const requestId = parseInt(parts[3]);
  const allowedUserId = parts[5];

  // Only the tagged partner can click this
  if (userId !== allowedUserId) {
    return interaction.reply({ content: '❌ This button is not for you.', flags: 64 });
  }

  const request = getBreedingRequest(requestId);
  if (!request) {
    return interaction.reply({ content: '❌ Request not found or expired.', flags: 64 });
  }

  if (request.status !== 'pending') {
    return interaction.reply({ content: '❌ This request has already been processed.', flags: 64 });
  }

  const myPet = getPet(request.partner_pet_id);
  const theirPet = getPet(request.requester_pet_id);

  if (!myPet || !theirPet) {
    deleteBreedingRequest(requestId);
    return interaction.reply({ content: '❌ One of the pets no longer exists.', flags: 64 });
  }

  // Show modal to set stud fee
  const modal = new ModalBuilder()
    .setCustomId(`modal_stud_accept_${requestId}_u_${userId}`)
    .setTitle(`Stud Fee for ${myPet.name}`);

  const feeInput = new TextInputBuilder()
    .setCustomId('stud_fee')
    .setLabel('Stud Fee (they pay you, 0 for free)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue('0')
    .setPlaceholder('0');

  modal.addComponents(
    new ActionRowBuilder().addComponents(feeInput)
  );

  await interaction.showModal(modal);
}

// Process partner's fee submission - send PUBLIC message to requester
async function handleStudAcceptSubmit(interaction, guildId, userId, settings) {
  const customId = interaction.customId;
  // modal_stud_accept_<requestId>_u_<userId>
  const parts = customId.split('_');
  const requestId = parseInt(parts[3]);

  const request = getBreedingRequest(requestId);
  if (!request) {
    return interaction.reply({ content: '❌ Request not found or expired.', flags: 64 });
  }

  if (request.partner_id !== userId) {
    return interaction.reply({ content: '❌ This request is not for you.', flags: 64 });
  }

  if (request.status !== 'pending') {
    return interaction.reply({ content: '❌ This request has already been processed.', flags: 64 });
  }

  // Parse stud fee from modal
  const studFee = parseInt(interaction.fields.getTextInputValue('stud_fee').replace(/,/g, '')) || 0;
  const currency = getCurrency(guildId);

  if (studFee < 0) {
    return interaction.reply({ content: '❌ Stud fee cannot be negative.', flags: 64 });
  }

  if (settings.maxStudFee > 0 && studFee > settings.maxStudFee) {
    return interaction.reply({ content: `❌ Max stud fee on this server is ${settings.maxStudFee.toLocaleString()}.`, flags: 64 });
  }

  const requesterPet = getPet(request.requester_pet_id);
  const partnerPet = getPet(request.partner_pet_id);

  if (!requesterPet || !partnerPet) {
    deleteBreedingRequest(requestId);
    return interaction.reply({ content: '❌ One of the pets no longer exists.', flags: 64 });
  }

  // Verify still breedable
  const check = canBreedTogether(requesterPet, partnerPet);
  if (!check.canBreed) {
    deleteBreedingRequest(requestId);
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  // Update the request with the stud fee (store but don't transfer yet)
  updateBreedingRequestStudFee(requestId, studFee);

  // Update the original message to show it's been responded to
  await interaction.update({ 
    content: `~~<@${request.partner_id}>~~ ✅ Responded`, 
    embeds: [], 
    components: [] 
  });

  const requesterId = request.requester_id;
  const partnerId = request.partner_id;
  const speciesData = SPECIES[requesterPet.species];
  const female = requesterPet.sex === 'F' ? requesterPet : partnerPet;
  const male = requesterPet.sex === 'M' ? requesterPet : partnerPet;
  const highRarity = RARITY_ORDER.indexOf(male.rarity) >= RARITY_ORDER.indexOf(female.rarity) ? male.rarity : female.rarity;
  const isExotic = speciesData.type === 'exotic';
  const breedingFee = getBreedingFee(guildId, highRarity, isExotic);
  const totalCost = studFee + breedingFee;

  // Send PUBLIC message to requester with fee confirmation
  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('💰 Stud Fee Offer')
    .setDescription(
      `<@${partnerId}> accepts the breeding request!\n\n` +
      `${speciesData.emoji} **${requesterPet.name}** × **${partnerPet.name}**\n\n` +
      `**Costs for <@${requesterId}>:**\n` +
      `💰 Stud Fee: **${studFee.toLocaleString()}** ${currency} → <@${partnerId}>\n` +
      `💰 Breeding Fee: **${breedingFee.toLocaleString()}** ${currency}\n` +
      `📊 **Total:** **${totalCost.toLocaleString()}** ${currency}\n\n` +
      `<@${requesterId}>, do you accept these terms?`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_stud_feeaccept_${requestId}_r_${requesterId}`)
      .setLabel('Accept & Breed')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pet_stud_feedecline_${requestId}_r_${requesterId}`)
      .setLabel('Decline')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.channel.send({ content: `<@${requesterId}>`, embeds: [embed], components: [row] });
}

// Requester accepts the fee - start breeding
async function handleStudFeeAccept(interaction, guildId, userId, settings) {
  const customId = interaction.customId;
  // pet_stud_feeaccept_<requestId>_r_<requesterId>
  const parts = customId.split('_');
  const requestId = parseInt(parts[3]);
  const allowedUserId = parts[5];

  if (userId !== allowedUserId) {
    return interaction.reply({ content: '❌ This button is not for you.', flags: 64 });
  }

  const request = getBreedingRequest(requestId);
  if (!request) {
    return interaction.reply({ content: '❌ Request not found or expired.', flags: 64 });
  }

  if (request.status !== 'pending') {
    return interaction.reply({ content: '❌ This request has already been processed.', flags: 64 });
  }

  const requesterPet = getPet(request.requester_pet_id);
  const partnerPet = getPet(request.partner_pet_id);

  if (!requesterPet || !partnerPet) {
    deleteBreedingRequest(requestId);
    return interaction.reply({ content: '❌ One of the pets no longer exists.', flags: 64 });
  }

  // Verify still breedable
  const check = canBreedTogether(requesterPet, partnerPet);
  if (!check.canBreed) {
    deleteBreedingRequest(requestId);
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  const currency = getCurrency(guildId);
  const studFee = request.stud_fee;
  const requesterId = request.requester_id;
  const partnerId = request.partner_id;

  // Calculate breeding fee
  const female = requesterPet.sex === 'F' ? requesterPet : partnerPet;
  const male = requesterPet.sex === 'M' ? requesterPet : partnerPet;
  const highRarity = RARITY_ORDER.indexOf(male.rarity) >= RARITY_ORDER.indexOf(female.rarity) ? male.rarity : female.rarity;
  const speciesData = SPECIES[female.species];
  const isExotic = speciesData.type === 'exotic';
  const breedingFee = getBreedingFee(guildId, highRarity, isExotic);
  const totalCost = studFee + breedingFee;

  // Check requester can afford everything
  const requesterBalance = getBalance(guildId, requesterId);
  if (requesterBalance.total < totalCost) {
    deleteBreedingRequest(requestId);
    await interaction.update({ content: `❌ <@${requesterId}> can't afford **${totalCost.toLocaleString()}** ${currency} (have **${requesterBalance.total.toLocaleString()}**)`, embeds: [], components: [] });
    return;
  }

  // Charge breeding fee first
  const breedingResult = await removeFromTotal(guildId, requesterId, breedingFee, 'Breeding fee');
  if (!breedingResult || !breedingResult.success) {
    deleteBreedingRequest(requestId);
    await interaction.update({ content: `❌ Failed to charge breeding fee. <@${requesterId}> may not have enough ${currency}.`, embeds: [], components: [] });
    return;
  }

  // Transfer stud fee: requester → partner
  if (studFee > 0) {
    const studResult = await removeFromTotal(guildId, requesterId, studFee, 'Stud fee');
    if (!studResult || !studResult.success) {
      // Refund the breeding fee
      await addMoney(guildId, requesterId, breedingFee, 'wallet');
      deleteBreedingRequest(requestId);
      await interaction.update({ content: `❌ Failed to charge stud fee. <@${requesterId}> may not have enough ${currency}.`, embeds: [], components: [] });
      return;
    }
    await addMoney(guildId, partnerId, studFee, 'wallet');
  }

  // Start gestation - baby goes to REQUESTER
  const result = startGestation(guildId, female.id, male.id, requesterId);
  if (!result.success) {
    // Refund everything
    await addMoney(guildId, requesterId, breedingFee, 'wallet');
    if (studFee > 0) {
      await addMoney(guildId, requesterId, studFee, 'wallet');
      await removeFromTotal(guildId, partnerId, studFee, 'Stud fee refund');
    }
    deleteBreedingRequest(requestId);
    await interaction.update({ content: `❌ ${result.reason}`, embeds: [], components: [] });
    return;
  }

  // Mark request as accepted
  updateBreedingRequestStatus(requestId, 'accepted');

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('💕 Breeding Started!')
    .setDescription(
      `${speciesData.emoji} **${male.name}** ♂ × **${female.name}** ♀\n\n` +
      `🤰 **${female.name}** is now gestating!\n` +
      `⏳ Birth in: **${Math.round(settings.gestationHours)} hours**\n\n` +
      (studFee > 0 ? `💰 Stud Fee: **${studFee.toLocaleString()}** ${currency} → <@${partnerId}>\n` : '') +
      `💰 Breeding Fee: **${breedingFee.toLocaleString()}** ${currency}\n\n` +
      `🎁 Baby goes to <@${requesterId}>`
    )
    .setTimestamp();

  await interaction.update({ content: '', embeds: [embed], components: [] });
}

// Requester declines the fee
async function handleStudFeeDecline(interaction, guildId, userId, settings) {
  const customId = interaction.customId;
  // pet_stud_feedecline_<requestId>_r_<requesterId>
  const parts = customId.split('_');
  const requestId = parseInt(parts[3]);
  const allowedUserId = parts[5];

  if (userId !== allowedUserId) {
    return interaction.reply({ content: '❌ This button is not for you.', flags: 64 });
  }

  const request = getBreedingRequest(requestId);
  if (!request) {
    return interaction.reply({ content: '❌ Request not found or expired.', flags: 64 });
  }

  deleteBreedingRequest(requestId);

  const requesterPet = getPet(request.requester_pet_id);
  const partnerPet = getPet(request.partner_pet_id);

  await interaction.update({ 
    content: `❌ <@${userId}> declined the stud fee for **${requesterPet?.name || 'Unknown'}** × **${partnerPet?.name || 'Unknown'}**.`, 
    embeds: [], 
    components: [] 
  });
}

// Partner declines the initial request
async function handleStudDecline(interaction, guildId, userId, settings) {
  const customId = interaction.customId;
  // pet_stud_decline_<requestId>_p_<partnerId>
  const parts = customId.split('_');
  const requestId = parseInt(parts[3]);
  const allowedUserId = parts[5];

  if (userId !== allowedUserId) {
    return interaction.reply({ content: '❌ This button is not for you.', flags: 64 });
  }

  const request = getBreedingRequest(requestId);
  if (!request) {
    return interaction.reply({ content: '❌ Request not found or expired.', flags: 64 });
  }

  deleteBreedingRequest(requestId);

  const requesterPet = getPet(request.requester_pet_id);
  const partnerPet = getPet(request.partner_pet_id);

  await interaction.update({ 
    content: `❌ <@${userId}> declined the breeding request for **${requesterPet?.name || 'Unknown'}** × **${partnerPet?.name || 'Unknown'}**.`, 
    embeds: [], 
    components: [] 
  });
}

// Legacy stub handlers
async function handleStudFeeModal(interaction, guildId, userId, settings) {
  return showStudRequestPanel(interaction, guildId, userId, settings);
}

async function handleStudSelectPet(interaction, guildId, userId, settings) {
  return showStudRequestPanel(interaction, guildId, userId, settings);
}

async function showGestatingPanel(interaction, guildId, userId, settings) {
  return showBreedingPanel(interaction, guildId, userId, settings);
}

// ================== TRANSFER (GIVE/SELL) ==================

async function showTransferPanel(interaction, guildId, userId, settings, initialPetId = null) {
  if (!settings.transferEnabled) {
    return interaction.reply({ content: '❌ Pet transfers are not enabled on this server.', flags: 64 });
  }

  await interaction.deferUpdate();
  const currency = getCurrency(guildId);
  const pets = getUserPets(guildId, userId);

  // Filter transferable pets
  const transferablePets = pets.filter(p => {
    const check = canTransferPet(p, guildId);
    return check.canTransfer;
  });

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🔄 Pet Transfer')
    .setDescription(
      `Transfer (give or sell) your pets to other players.\n\n` +
      `**Requirements:**\n` +
      `• Pet must have ${settings.transferMinHappiness}+ happiness\n` +
      `• Cannot transfer eggs or gestating pets\n` +
      `• Pet loses ${settings.transferHappinessPenalty} happiness on transfer`
    )
    .setTimestamp();

  if (transferablePets.length === 0) {
    embed.addFields({ name: 'Your Pets', value: 'No pets available for transfer. Make sure they have enough happiness!' });
  } else {
    const petList = transferablePets.slice(0, 10).map(p => {
      const speciesData = SPECIES[p.species];
      const rarityData = RARITIES[p.rarity];
      const stats = getEffectiveStats(p);
      const sexEmoji = p.sex === 'M' ? '♂️' : '♀️';
      return `${speciesData.emoji} **${p.name}** — ${rarityData.name} ${sexEmoji} L${p.level} (😊 ${Math.round(stats.happiness)})`;
    }).join('\n');
    embed.addFields({ name: 'Available for Transfer', value: petList });
  }

  const rows = [];

  if (transferablePets.length > 0) {
    const options = transferablePets.slice(0, 25).map(p => {
      const speciesData = SPECIES[p.species];
      const rarityData = RARITIES[p.rarity];
      const stats = getEffectiveStats(p);
      return {
        label: p.name,
        description: `${rarityData.name} ${speciesData.name} L${p.level} — 😊 ${Math.round(stats.happiness)}`,
        value: `${p.id}`,
        emoji: speciesData.emoji,
      };
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pet_transfer_target_u_${userId}`)
        .setPlaceholder('Select a pet to transfer...')
        .addOptions(options)
    );
    rows.push(selectRow);
  }

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navRow);

  await interaction.editReply({ embeds: [embed], components: rows, files: [] });
}

async function handleTransferTargetSelect(interaction, guildId, userId, settings) {
  const petId = parseInt(interaction.values[0]);
  const pet = getPet(petId);

  if (!pet || pet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Pet not found or not yours.', flags: 64 });
  }

  const check = canTransferPet(pet, guildId);
  if (!check.canTransfer) {
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  await interaction.deferUpdate();

  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';
  const stats = getEffectiveStats(pet);

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🔄 Transfer Pet')
    .setDescription(
      `You selected:\n` +
      `${speciesData.emoji} **${pet.name}**\n` +
      `${rarityData.name} ${speciesData.name} ${sexEmoji} Level ${pet.level}\n` +
      `😊 Happiness: ${Math.round(stats.happiness)}\n\n` +
      `**Select a user to transfer this pet to:**`
    )
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`pet_transfer_userselect_${petId}_u_${userId}`)
      .setPlaceholder('Select a user...')
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_transfer_menu_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [userSelectRow, navRow], files: [] });
}

async function handleTransferUserSelect(interaction, guildId, userId, settings) {
  // pet_transfer_userselect_<petId>_u_<userId>
  const parts = interaction.customId.split('_');
  const petId = parseInt(parts[3]);
  const targetUser = interaction.users.first();

  if (!targetUser) {
    return interaction.reply({ content: '❌ No user selected.', flags: 64 });
  }

  if (targetUser.id === userId) {
    return interaction.reply({ content: '❌ Cannot transfer to yourself.', flags: 64 });
  }

  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Pet not found or not yours.', flags: 64 });
  }

  const check = canTransferPet(pet, guildId);
  if (!check.canTransfer) {
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  // Show modal to enter price only
  const modal = new ModalBuilder()
    .setCustomId(`modal_transfer_price_${petId}_t_${targetUser.id}_u_${userId}`)
    .setTitle(`Transfer ${pet.name}`);

  const priceInput = new TextInputBuilder()
    .setCustomId('price')
    .setLabel('Sale Price (0 = free gift)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue('0')
    .setPlaceholder('0');

  modal.addComponents(
    new ActionRowBuilder().addComponents(priceInput)
  );

  return interaction.showModal(modal);
}

async function handleTransferPriceSubmit(interaction, guildId, userId, settings) {
  const parts = interaction.customId.split('_');
  // modal_transfer_price_<petId>_t_<targetUserId>_u_<userId>
  const petId = parseInt(parts[3]);
  const targetUserId = parts[5];

  const priceStr = interaction.fields.getTextInputValue('price').trim();
  const price = parseInt(priceStr) || 0;

  if (price < 0) {
    return interaction.reply({ content: '❌ Price cannot be negative.', flags: 64 });
  }

  await interaction.deferReply();
  const currency = getCurrency(guildId);

  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) {
    return interaction.editReply({ content: '❌ Pet not found or not yours.' });
  }

  const check = canTransferPet(pet, guildId);
  if (!check.canTransfer) {
    return interaction.editReply({ content: `❌ ${check.reason}` });
  }

  // Check target has room
  const targetMaxSlots = getMaxPetSlots(guildId, targetUserId);
  const targetPetCount = getUserPetCount(guildId, targetUserId);
  const targetEggCount = getUserEggCount(guildId, targetUserId);
  const targetGestatingCount = getGestatingPets(guildId, targetUserId).length;

  if (targetPetCount + targetEggCount + targetGestatingCount >= targetMaxSlots) {
    return interaction.editReply({ content: `❌ Target user has no room for this pet!` });
  }

  // Verify target user exists in guild
  let targetMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUserId);
  } catch (e) {
    return interaction.editReply({ content: '❌ User not found in this server.' });
  }

  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🔄 Pet Transfer Offer')
    .setDescription(
      `**${interaction.user.displayName}** wants to transfer a pet to you!\n\n` +
      `${speciesData.emoji} **${pet.name}**\n` +
      `${rarityData.name} ${speciesData.name} ${sexEmoji} Level ${pet.level}\n\n` +
      (price > 0 ? `**Price:** ${price.toLocaleString()} ${currency}\n` : '**FREE GIFT!**\n') +
      `\n⚠️ Pet will lose ${settings.transferHappinessPenalty} happiness on transfer.`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_transfer_accept_${petId}_${userId}_${targetUserId}_${price}`)
      .setLabel(price > 0 ? `Accept (${price.toLocaleString()})` : 'Accept Gift')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pet_transfer_decline_${petId}_${userId}_${targetUserId}`)
      .setLabel('Decline')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );

  // Send offer to target user via mention
  await interaction.editReply({
    content: `<@${targetUserId}>`,
    embeds: [embed],
    components: [row],
  });
}

async function handleTransferAccept(interaction, guildId, settings) {
  const parts = interaction.customId.split('_');
  // pet_transfer_accept_<petId>_<fromUserId>_<toUserId>_<price>
  const petId = parseInt(parts[3]);
  const fromUserId = parts[4];
  const toUserId = parts[5];
  const price = parseInt(parts[6]) || 0;

  // Only target user can accept
  if (interaction.user.id !== toUserId) {
    return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
  }

  await interaction.deferUpdate();
  const currency = getCurrency(guildId);

  const pet = getPet(petId);
  if (!pet || pet.owner_id !== fromUserId) {
    return interaction.editReply({ content: '❌ Pet no longer available.', embeds: [], components: [] });
  }

  const check = canTransferPet(pet, guildId);
  if (!check.canTransfer) {
    return interaction.editReply({ content: `❌ ${check.reason}`, embeds: [], components: [] });
  }

  // Check price payment
  if (price > 0) {
    const balance = getBalance(guildId, toUserId);
    if (balance.total < price) {
      return interaction.editReply({ content: `❌ Not enough ${currency}! You need ${price.toLocaleString()}.`, embeds: [], components: [] });
    }

    // Deduct from buyer, add to seller
    const removed = removeFromTotal(guildId, toUserId, price);
    if (!removed) {
      return interaction.editReply({ content: `❌ Failed to process payment.`, embeds: [], components: [] });
    }
    addMoney(guildId, fromUserId, price, 'wallet');
  }

  // Transfer the pet
  const result = transferPet(guildId, petId, fromUserId, toUserId);
  if (!result.success) {
    // Refund if transfer failed
    if (price > 0) {
      addMoney(guildId, toUserId, price, 'wallet');
      removeFromTotal(guildId, fromUserId, price);
    }
    return interaction.editReply({ content: `❌ ${result.reason}`, embeds: [], components: [] });
  }

  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('✅ Transfer Complete!')
    .setDescription(
      `${speciesData.emoji} **${pet.name}** now belongs to **${interaction.user.displayName}**!\n\n` +
      (price > 0 ? `💰 **${price.toLocaleString()} ${currency}** paid.\n` : '') +
      `😊 Happiness: ${result.newHappiness} (-${result.happinessPenalty})`
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleTransferDecline(interaction, guildId, settings) {
  const parts = interaction.customId.split('_');
  // pet_transfer_decline_<petId>_<fromUserId>_<toUserId>
  const toUserId = parts[5];

  // Only target user or sender can decline
  if (interaction.user.id !== toUserId && interaction.user.id !== parts[4]) {
    return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
  }

  await interaction.deferUpdate();

  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('❌ Transfer Declined')
    .setDescription('The pet transfer offer was declined.')
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleTransferConfirm(interaction, guildId, userId, settings) {
  return showTransferPanel(interaction, guildId, userId, settings);
}

// ================== PET TRADING (SWAP) ==================

async function showTradePanel(interaction, guildId, userId, settings) {
  if (!settings.transferEnabled) {
    return interaction.reply({ content: '❌ Pet transfers/trades are not enabled on this server.', flags: 64 });
  }

  await interaction.deferUpdate();
  const pets = getUserPets(guildId, userId);

  // Filter tradeable pets (same requirements as transfer)
  const tradeablePets = pets.filter(p => {
    const check = canTransferPet(p, guildId);
    return check.canTransfer;
  });

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🤝 Pet Trade')
    .setDescription(
      `Trade pets with another player — no spare slots needed!\n\n` +
      `**How it works:**\n` +
      `1. Select a pet you want to trade\n` +
      `2. Select the player you want to trade with\n` +
      `3. They choose which pet to trade for yours\n` +
      `4. You both confirm, and pets swap instantly!\n\n` +
      `**Requirements:**\n` +
      `• Pet must have ${settings.transferMinHappiness}+ happiness\n` +
      `• Cannot trade eggs or gestating pets\n` +
      `• Both pets lose ${settings.transferHappinessPenalty} happiness on trade`
    )
    .setTimestamp();

  if (tradeablePets.length === 0) {
    embed.addFields({ name: 'Your Pets', value: 'No pets available for trade. Make sure they have enough happiness!' });
  } else {
    const petList = tradeablePets.slice(0, 10).map(p => {
      const speciesData = SPECIES[p.species];
      const rarityData = RARITIES[p.rarity];
      const stats = getEffectiveStats(p);
      const sexEmoji = p.sex === 'M' ? '♂️' : '♀️';
      return `${speciesData.emoji} **${p.name}** — ${rarityData.name} ${sexEmoji} L${p.level} (😊 ${Math.round(stats.happiness)})`;
    }).join('\n');
    embed.addFields({ name: 'Available for Trade', value: petList });
  }

  const rows = [];

  if (tradeablePets.length > 0) {
    const options = tradeablePets.slice(0, 25).map(p => {
      const speciesData = SPECIES[p.species];
      const rarityData = RARITIES[p.rarity];
      const stats = getEffectiveStats(p);
      return {
        label: p.name,
        description: `${rarityData.name} ${speciesData.name} L${p.level} — 😊 ${Math.round(stats.happiness)}`,
        value: `${p.id}`,
        emoji: speciesData.emoji,
      };
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pet_trade_select_u_${userId}`)
        .setPlaceholder('Select a pet to trade...')
        .addOptions(options)
    );
    rows.push(selectRow);
  }

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navRow);

  await interaction.editReply({ embeds: [embed], components: rows, files: [] });
}

async function handleTradeSelectPet(interaction, guildId, userId, settings) {
  const petId = parseInt(interaction.values[0]);
  const pet = getPet(petId);

  if (!pet || pet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Pet not found or not yours.', flags: 64 });
  }

  const check = canTransferPet(pet, guildId);
  if (!check.canTransfer) {
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  await interaction.deferUpdate();

  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';
  const stats = getEffectiveStats(pet);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🤝 Trade Pet')
    .setDescription(
      `You selected:\n` +
      `${speciesData.emoji} **${pet.name}**\n` +
      `${rarityData.name} ${speciesData.name} ${sexEmoji} Level ${pet.level}\n` +
      `😊 Happiness: ${Math.round(stats.happiness)}\n\n` +
      `**Select a user to trade with:**`
    )
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`pet_trade_userselect_${petId}_u_${userId}`)
      .setPlaceholder('Select a user...')
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_trade_menu_u_${userId}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [userSelectRow, navRow], files: [] });
}

async function handleTradeUserSelect(interaction, guildId, userId, settings) {
  // pet_trade_userselect_<petId>_u_<userId>
  const parts = interaction.customId.split('_');
  const petId = parseInt(parts[3]);
  const targetUser = interaction.users.first();

  if (!targetUser) {
    return interaction.reply({ content: '❌ No user selected.', flags: 64 });
  }

  if (targetUser.id === userId) {
    return interaction.reply({ content: '❌ Cannot trade with yourself.', flags: 64 });
  }

  if (targetUser.bot) {
    return interaction.reply({ content: '❌ Cannot trade with a bot.', flags: 64 });
  }

  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Pet not found or not yours.', flags: 64 });
  }

  const check = canTransferPet(pet, guildId);
  if (!check.canTransfer) {
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  // Create trade request
  const request = createTradeRequest(guildId, userId, petId, targetUser.id, null);
  if (!request) {
    return interaction.reply({ content: '❌ Failed to create trade request.', flags: 64 });
  }

  await interaction.deferReply();

  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';
  const shinyStr = pet.shiny ? '✨ ' : '';
  const stats = getEffectiveStats(pet);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🤝 Pet Trade Request')
    .setDescription(
      `**${interaction.user.displayName}** wants to trade with you!\n\n` +
      `**Their pet:**\n` +
      `${speciesData.emoji} ${shinyStr}**${pet.name}**\n` +
      `${rarityData.name} ${speciesData.name} ${sexEmoji} Level ${pet.level}\n` +
      `😊 Happiness: ${Math.round(stats.happiness)}\n\n` +
      `**Select one of your pets to trade:**`
    )
    .setFooter({ text: 'Expires in 24 hours' })
    .setTimestamp();

  // Get partner's tradeable pets
  const partnerPets = getUserPets(guildId, targetUser.id);
  const tradeablePartnerPets = partnerPets.filter(p => {
    const c = canTransferPet(p, guildId);
    return c.canTransfer;
  });

  const rows = [];

  if (tradeablePartnerPets.length > 0) {
    const options = tradeablePartnerPets.slice(0, 25).map(p => {
      const sp = SPECIES[p.species];
      const rr = RARITIES[p.rarity];
      const st = getEffectiveStats(p);
      return {
        label: p.name,
        description: `${rr.name} ${sp.name} L${p.level} — 😊 ${Math.round(st.happiness)}`,
        value: `${p.id}`,
        emoji: sp.emoji,
      };
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pet_trade_partner_${request.id}_u_${targetUser.id}`)
        .setPlaceholder('Select your pet to trade...')
        .addOptions(options)
    );
    rows.push(selectRow);
  }

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_trade_decline_${request.id}_${userId}`)
      .setLabel('Decline')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );
  rows.push(buttonRow);

  // Send public message tagging partner
  await interaction.editReply({
    content: `<@${targetUser.id}>`,
    embeds: [embed],
    components: rows,
  });
}

async function handleTradePartnerSelectPet(interaction, guildId, userId, settings) {
  // pet_trade_partner_<requestId>_u_<partnerId>
  const parts = interaction.customId.split('_');
  const requestId = parseInt(parts[3]);
  const partnerId = parts[5];

  if (userId !== partnerId) {
    return interaction.reply({ content: '❌ This trade is not for you.', flags: 64 });
  }

  const request = getTradeRequest(requestId);
  if (!request || request.status !== 'pending') {
    return interaction.reply({ content: '❌ Trade request not found or already processed.', flags: 64 });
  }

  const partnerPetId = parseInt(interaction.values[0]);
  const partnerPet = getPet(partnerPetId);

  if (!partnerPet || partnerPet.owner_id !== userId) {
    return interaction.reply({ content: '❌ Pet not found or not yours.', flags: 64 });
  }

  const check = canTransferPet(partnerPet, guildId);
  if (!check.canTransfer) {
    return interaction.reply({ content: `❌ ${check.reason}`, flags: 64 });
  }

  // Update request with partner's pet
  updateTradeRequestPet(requestId, partnerPetId);

  await interaction.deferUpdate();

  const requesterPet = getPet(request.requester_pet_id);
  if (!requesterPet) {
    deleteTradeRequest(requestId);
    return interaction.editReply({ content: '❌ Requester\'s pet is no longer available.', embeds: [], components: [] });
  }

  const reqSpecies = SPECIES[requesterPet.species];
  const reqRarity = RARITIES[requesterPet.rarity];
  const reqSex = requesterPet.sex === 'M' ? '♂️' : '♀️';
  const reqShiny = requesterPet.shiny ? '✨ ' : '';
  const reqStats = getEffectiveStats(requesterPet);

  const partnerSpecies = SPECIES[partnerPet.species];
  const partnerRarity = RARITIES[partnerPet.rarity];
  const partnerSex = partnerPet.sex === 'M' ? '♂️' : '♀️';
  const partnerShiny = partnerPet.shiny ? '✨ ' : '';
  const partnerStats = getEffectiveStats(partnerPet);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🤝 Confirm Trade')
    .setDescription(
      `**${interaction.user.displayName}** wants to trade!\n\n` +
      `**You get:**\n` +
      `${reqSpecies.emoji} ${reqShiny}**${requesterPet.name}**\n` +
      `${reqRarity.name} ${reqSpecies.name} ${reqSex} Level ${requesterPet.level}\n` +
      `😊 Happiness: ${Math.round(reqStats.happiness)}\n\n` +
      `**You give:**\n` +
      `${partnerSpecies.emoji} ${partnerShiny}**${partnerPet.name}**\n` +
      `${partnerRarity.name} ${partnerSpecies.name} ${partnerSex} Level ${partnerPet.level}\n` +
      `😊 Happiness: ${Math.round(partnerStats.happiness)}\n\n` +
      `⚠️ Both pets lose ${settings.transferHappinessPenalty} happiness.`
    )
    .setFooter({ text: `<@${request.requester_id}> must also confirm` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_trade_confirm_${requestId}_p_${userId}`)
      .setLabel('Confirm Trade')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pet_trade_decline_${requestId}_${request.requester_id}`)
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );

  // Tag the requester to confirm
  await interaction.editReply({
    content: `<@${request.requester_id}> — **${interaction.user.displayName}** selected their pet! Review and confirm the trade:`,
    embeds: [embed],
    components: [row],
  });
}

async function handleTradeConfirm(interaction, guildId, userId, settings) {
  // pet_trade_confirm_<requestId>_p_<partnerId>
  const parts = interaction.customId.split('_');
  const requestId = parseInt(parts[3]);
  const partnerId = parts[5];

  const request = getTradeRequest(requestId);
  if (!request || request.status !== 'pending') {
    return interaction.reply({ content: '❌ Trade request not found or already processed.', flags: 64 });
  }

  // Either requester or partner can confirm
  if (userId !== request.requester_id && userId !== partnerId) {
    return interaction.reply({ content: '❌ This trade is not for you.', flags: 64 });
  }

  // Validate both pets still exist and are transferable
  const requesterPet = getPet(request.requester_pet_id);
  const partnerPet = getPet(request.partner_pet_id);

  if (!requesterPet || requesterPet.owner_id !== request.requester_id) {
    deleteTradeRequest(requestId);
    return interaction.reply({ content: '❌ Requester\'s pet is no longer available.', flags: 64 });
  }

  if (!partnerPet || partnerPet.owner_id !== request.partner_id) {
    deleteTradeRequest(requestId);
    return interaction.reply({ content: '❌ Partner\'s pet is no longer available.', flags: 64 });
  }

  const check1 = canTransferPet(requesterPet, guildId);
  const check2 = canTransferPet(partnerPet, guildId);

  if (!check1.canTransfer) {
    return interaction.reply({ content: `❌ Requester's pet: ${check1.reason}`, flags: 64 });
  }

  if (!check2.canTransfer) {
    return interaction.reply({ content: `❌ Partner's pet: ${check2.reason}`, flags: 64 });
  }

  await interaction.deferUpdate();

  // Execute the trade
  const result = executeTrade(guildId, request.requester_pet_id, request.requester_id, request.partner_pet_id, request.partner_id);

  if (!result.success) {
    return interaction.editReply({ content: `❌ Trade failed: ${result.reason}`, embeds: [], components: [] });
  }

  // Mark request as completed
  updateTradeRequestStatus(requestId, 'completed');

  const pet1Species = SPECIES[result.pet1.species];
  const pet2Species = SPECIES[result.pet2.species];

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('✅ Trade Complete!')
    .setDescription(
      `🎉 The trade was successful!\n\n` +
      `**<@${request.requester_id}>** received:\n` +
      `${pet2Species.emoji} **${result.pet2.name}** (😊 ${result.pet2.newHappiness})\n\n` +
      `**<@${request.partner_id}>** received:\n` +
      `${pet1Species.emoji} **${result.pet1.name}** (😊 ${result.pet1.newHappiness})\n\n` +
      `Both pets lost ${result.happinessPenalty} happiness.`
    )
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed], components: [] });
}

async function handleTradeAccept(interaction, guildId, userId, settings) {
  // This is no longer used - partner selects pet directly
  return interaction.reply({ content: '❌ Please select a pet from the dropdown.', flags: 64 });
}

async function handleTradeDecline(interaction, guildId, userId, settings) {
  // pet_trade_decline_<requestId>_<requesterId>
  const parts = interaction.customId.split('_');
  const requestId = parseInt(parts[3]);
  const requesterId = parts[4];

  const request = getTradeRequest(requestId);
  if (!request) {
    return interaction.reply({ content: '❌ Trade request not found.', flags: 64 });
  }

  // Only requester or partner can decline
  if (userId !== request.requester_id && userId !== request.partner_id) {
    return interaction.reply({ content: '❌ This trade is not for you.', flags: 64 });
  }

  await interaction.deferUpdate();

  deleteTradeRequest(requestId);

  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('❌ Trade Cancelled')
    .setDescription('The pet trade was cancelled.')
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed], components: [] });
}

// ================== LINEAGE / FAMILY TREE ==================

async function handleLineageView(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);

  if (!pet) {
    return interaction.reply({ content: '❌ Pet not found.', flags: 64 });
  }

  await interaction.deferUpdate();

  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];

  // Build the family tree
  let treeDesc = '';

  // The pet itself
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';
  const shinyStr = pet.shiny ? '✨ ' : '';
  treeDesc += `**${shinyStr}${speciesData.emoji} ${pet.name}** ${sexEmoji}\n`;
  treeDesc += `${rarityData.name} ${speciesData.name}\n\n`;

  // Parents
  treeDesc += '**─── Parents ───**\n';
  const motherName = pet.mother_name || '(unknown)';
  const fatherName = pet.father_name || '(unknown)';
  
  // Try to get parent species if they still exist
  const mother = pet.mother_id ? getPet(pet.mother_id) : null;
  const father = pet.father_id ? getPet(pet.father_id) : null;
  
  const motherSpecies = mother ? SPECIES[mother.species] : null;
  const fatherSpecies = father ? SPECIES[father.species] : null;
  
  treeDesc += `👩 Mother: **${motherName}**`;
  if (motherSpecies) treeDesc += ` ${motherSpecies.emoji}`;
  treeDesc += '\n';
  
  treeDesc += `👨 Father: **${fatherName}**`;
  if (fatherSpecies) treeDesc += ` ${fatherSpecies.emoji}`;
  treeDesc += '\n\n';

  // Grandparents (maternal side)
  const hasMaternalGrandparents = pet.maternal_grandmother_name || pet.maternal_grandfather_name;
  const hasPaternalGrandparents = pet.paternal_grandmother_name || pet.paternal_grandfather_name;

  if (hasMaternalGrandparents || hasPaternalGrandparents) {
    treeDesc += '**─── Grandparents ───**\n';
    
    if (hasMaternalGrandparents) {
      treeDesc += `*Maternal side (${motherName}):*\n`;
      if (pet.maternal_grandmother_name) {
        treeDesc += `  👵 Grandmother: **${pet.maternal_grandmother_name}**\n`;
      }
      if (pet.maternal_grandfather_name) {
        treeDesc += `  👴 Grandfather: **${pet.maternal_grandfather_name}**\n`;
      }
    }
    
    if (hasPaternalGrandparents) {
      treeDesc += `*Paternal side (${fatherName}):*\n`;
      if (pet.paternal_grandmother_name) {
        treeDesc += `  👵 Grandmother: **${pet.paternal_grandmother_name}**\n`;
      }
      if (pet.paternal_grandfather_name) {
        treeDesc += `  👴 Grandfather: **${pet.paternal_grandfather_name}**\n`;
      }
    }
  }

  // Count generations
  let generations = 1;
  if (pet.mother_name || pet.father_name) generations = 2;
  if (hasMaternalGrandparents || hasPaternalGrandparents) generations = 3;

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`🧬 Family Tree: ${pet.name}`)
    .setDescription(treeDesc)
    .setFooter({ text: `${generations} generation${generations !== 1 ? 's' : ''} of lineage recorded` })
    .setTimestamp();

  // Attach pet image
  const phase = getPhase(pet.level);
  const petImage = await getPetImage(pet.species, phase.name.toLowerCase(), pet.variant || 1, pet.shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setThumbnail(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pet_view_${pet.id}_u_${userId}`)
      .setLabel('Back to Pet')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pet_panel_mypets_u_${userId}`)
      .setLabel('All Pets')
      .setEmoji('🐾')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pet_dismiss_u_${userId}`)
      .setLabel('Dismiss')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row], files });
}
