// /pets — Main pet panel command
// All pet interactions go through this single panel

const path = require('path');
const fs = require('fs');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
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
} = require('../pets');
const { getBalance, removeFromTotal, addMoney } = require('../economy');
const { getCurrency } = require('../admin');

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
  },

  async handleSelectMenu(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getSettings(guildId);

    if (customId.startsWith('pet_select_view_')) return handleSelectPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_shop_select_')) return handleShopSelectPet(interaction, guildId, userId, settings);
  },

  async handleModal(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getSettings(guildId);

    if (customId.startsWith('modal_pet_name_')) return handleNameModal(interaction, guildId, userId, settings);
    if (customId.startsWith('modal_pet_rename_')) return handleRenameModal(interaction, guildId, userId, settings);
    if (customId.startsWith('modal_egg_name_')) return handleEggNameModal(interaction, guildId, userId, settings);
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

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🐾 Pet Panel')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  const usedSlots = pets.length + eggs.length;
  let desc = `Welcome, **${interaction.user.displayName}**!\n\n`;
  desc += `🐾 **Pets:** ${pets.length}/${maxSlots} slots`;
  if (eggs.length > 0) desc += ` (🥚 ${eggs.length} incubating)`;
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

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_shop_u_${userId}`).setLabel('Pet Shop').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Primary).setDisabled(pets.length === 0),
    new ButtonBuilder().setCustomId(`pet_myeggs_u_${userId}`).setLabel('My Eggs').setEmoji('🥚').setStyle(ButtonStyle.Primary).setDisabled(eggs.length === 0),
    new ButtonBuilder().setCustomId(`pet_panel_kennel_u_${userId}`).setLabel('Kennel').setEmoji('🏠').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pet_dismiss_u_${userId}`).setLabel('Dismiss').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

  const options = { embeds: [embed], components: [row1] };
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
  const maxSlots = getMaxPetSlots(guildId, userId);

  const ITEMS_PER_PAGE = 9;
  const totalPages = Math.ceil(stock.length / ITEMS_PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = stock.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🛒 Pet Shop')
    .setDescription(
      `💰 **Balance:** ${Math.round(balance.total).toLocaleString()} ${currency}\n` +
      `🐾 **Pets:** ${petCount}/${maxSlots} slots\n` +
      `⏰ **Restocks:** <t:${Math.floor(restockTime / 1000)}:R>\n\n` +
      `Select a pet below to adopt it!`
    )
    .setTimestamp();

  if (pageItems.length === 0) {
    embed.addFields({ name: 'Shop Empty', value: 'The shop is currently empty. Wait for the next restock!' });
  } else {
    let listText = '';
    for (const item of pageItems) {
      const display = formatShopEntry(item);
      const shinyTag = item.shiny ? ' ✨**SHINY!**' : '';
      listText += `**#${item.slot_number}** ${display}${shinyTag} — **${item.price.toLocaleString()}** ${currency}\n`;
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
      return {
        label: `#${item.slot_number} ${shinyStr}${rarityData.name} ${speciesData.name} ${sexStr}`,
        description: `${item.price.toLocaleString()} ${currency.replace(/<:[^:]+:\d+>/g, '').trim() || 'coins'}`,
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

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`${speciesData.emoji} Meet Your New Pet!`)
    .setDescription(
      `${shinyStr}${sexEmoji} **${rarityData.name} ${speciesData.name}**\n` +
      `${PHASES.baby.emoji} Baby — Level 1\n\n` +
      `**Specialty:** ${getSpecialtyDisplay(item.species)}\n` +
      `💰 Cost: **${item.price.toLocaleString()}** ${getCurrency(guildId)}\n\n` +
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

  // Deduct and adopt
  await removeFromTotal(guildId, userId, item.price, `Adopted pet: ${petName}`);
  const pet = adoptPet(guildId, userId, item.species, petName, item.rarity, item.sex, item.shiny, 'shop', variant);
  removeShopSlot(guildId, slotNumber);

  const speciesData = SPECIES[item.species];
  const rarityData = RARITIES[item.rarity];
  const sexEmoji = item.sex === 'M' ? '♂️' : '♀️';
  const shinyStr = item.shiny ? '✨ **SHINY!** ' : '';

  const embed = new EmbedBuilder()
    .setColor(rarityData.color)
    .setTitle(`${speciesData.emoji} New Pet Adopted!`)
    .setDescription(
      `${shinyStr}You adopted **${petName}**!\n\n` +
      `${sexEmoji} **${rarityData.name} ${speciesData.name}**\n` +
      `Level 1 ${PHASES.baby.emoji} Baby\n\n` +
      `**Specialty:** ${getSpecialtyDisplay(item.species)}\n\n` +
      `💰 Paid **${item.price.toLocaleString()}** ${getCurrency(guildId)}`
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
  desc += `📅 Age: ${ageDays} day${ageDays !== 1 ? 's' : ''} | Source: ${pet.source}`;

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

  return interaction.update({ embeds: [embed], components: [row1, row2], files });
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
    .setTitle(`Rename ${pet.name} (${settings.renameCost.toLocaleString()} coins)`);

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

  const embed = new EmbedBuilder()
    .setColor(0x8B4513)
    .setTitle('🏠 Pet Kennel')
    .setDescription(
      `Your kennel provides extra pet slots!\n\n` +
      `**Current Level:** ${kennel.level > 0 ? `Level ${kennel.level} (+${kennel.level} slots)` : 'None'}\n` +
      `**Pet Slots:** ${petCount}/${maxSlots}\n` +
      `💰 **Balance:** ${Math.round(balance.total).toLocaleString()} ${currency}`
    )
    .setTimestamp();

  if (kennel.level < 3) {
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
  const levelInfo = [
    { level: 1, cost: settings.kennelL1Price, status: kennel.level >= 1 ? '✅' : '❌' },
    { level: 2, cost: settings.kennelL2Price, status: kennel.level >= 2 ? '✅' : '❌' },
    { level: 3, cost: settings.kennelL3Price, status: kennel.level >= 3 ? '✅' : '❌' },
  ];
  const infoText = levelInfo.map(l => `${l.status} Level ${l.level} — ${l.cost.toLocaleString()} ${currency} (+1 slot)`).join('\n');
  embed.addFields({ name: 'Upgrade Tiers', value: infoText });

  const components = [];
  if (kennel.level < 3) {
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

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🥚 Egg Shop')
    .setDescription(
      `💰 **Balance:** ${Math.round(balance.total).toLocaleString()} ${currency}\n` +
      `🐾 **Slots:** ${usedSlots}/${maxSlots} used (${petCount} pets, ${eggCount} eggs)\n\n` +
      `Purchase an egg to hatch a random pet!\nEggs take **72 hours** to hatch. Use **Warm** to speed it up!\n` +
      `Eggs occupy a pet slot while incubating.`
    )
    .setTimestamp();

  const eggTypes = ['mystery', 'golden', 'prismatic'];
  for (const type of eggTypes) {
    const eggData = EGG_TYPES[type];
    const price = getEggPrice(guildId, type);
    let speciesInfo;
    if (type === 'mystery') {
      speciesInfo = '🐺 Wolf · 👽 Alien · 🐱 Cat · 🐶 Dog · 🐦 Bird · 🕷️ Spider · 🐻 Bear · 🐼 Panda';
    } else if (type === 'golden') {
      speciesInfo = '🐺 Wolf · 👽 Alien · 🐉 Dragon · 🦄 Unicorn · 🐱 Cat · 🐶 Dog · 🐦 Bird · 🕷️ Spider · 🐻 Bear · 🐼 Panda';
    } else {
      speciesInfo = '🐺 Wolf · 👽 Alien · 🐉 Dragon · 🦄 Unicorn';
    }
    embed.addFields({
      name: `${eggData.emoji} ${eggData.name} — ${price.toLocaleString()} ${currency}`,
      value: `${speciesInfo}\n🌡️ Warm cost: **${eggData.warmCost.toLocaleString()}** · ✨ Shiny: **${Math.round(eggData.shinyChance * 100)}%**`,
    });
  }

  const slotsAvailable = usedSlots < maxSlots;
  const components = [];
  const buyRow = new ActionRowBuilder().addComponents(
    ...eggTypes.map(type => {
      const eggData = EGG_TYPES[type];
      const price = getEggPrice(guildId, type);
      const canAfford = balance.total >= price && slotsAvailable;
      return new ButtonBuilder()
        .setCustomId(`pet_egg_buy_${type}_u_${userId}`)
        .setLabel(`${eggData.name} (${abbreviateNumber(price)})`)
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
  if (balance.total < price) {
    return interaction.reply({ content: `❌ You need **${price.toLocaleString()}** ${getCurrency(guildId)} to buy a ${eggData.name}.`, flags: 64 });
  }

  const petCount = getUserPetCount(guildId, userId);
  const eggCount = getUserEggCount(guildId, userId);
  const maxSlots = getMaxPetSlots(guildId, userId);
  if (petCount + eggCount >= maxSlots) {
    return interaction.reply({ content: `❌ No available slots! You have **${petCount} pets + ${eggCount} eggs** using **${petCount + eggCount}/${maxSlots}** slots.`, flags: 64 });
  }

  await removeFromTotal(guildId, userId, price, `Bought ${eggData.name}`);
  const egg = buyEgg(guildId, userId, eggType);

  const currency = getCurrency(guildId);
  const embed = new EmbedBuilder()
    .setColor(eggData.color)
    .setTitle(`${eggData.emoji} Egg Purchased!`)
    .setDescription(
      `You bought a **${eggData.name}** for **${price.toLocaleString()}** ${currency}!\n\n` +
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

  await interaction.deferReply();

  const speciesData = SPECIES[species];
  if (!speciesData) return interaction.editReply({ content: '❌ Invalid pet data.' });

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
      `**${petName}** has joined your family! Use **/pets** to manage them.`
    )
    .setTimestamp();

  const petImage = await getPetImage(species, 'baby', variant, shiny);
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.data, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  // Check if server announcement needed (legendary or shiny)
  let announcement = null;
  if (rarity === 'legendary' || shiny) {
    const announceEmoji = shiny ? '✨🐣' : '🐣🟡';
    announcement = `${announceEmoji} **${interaction.user.displayName}** hatched a ${shiny ? '✨ **SHINY** ' : ''}**${rarityData.name} ${speciesData.name}** named **${petName}**!`;
  }

  await interaction.editReply({ embeds: [embed], files });

  // Send announcement in same channel if applicable
  if (announcement) {
    try {
      await interaction.channel.send({ content: announcement });
    } catch (e) {
      // Can't send announcement, ignore
    }
  }
}
