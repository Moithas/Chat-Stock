// /pets — Main pet panel command
// All pet interactions go through this single panel

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const {
  getSettings, SPECIES, SHOP_SPECIES, RARITIES, PHASES,
  getShopStock, getShopRestockTime, removeShopSlot,
  adoptPet, getPet, getUserPets, getUserPetCount, deletePet, renamePet,
  getEffectiveStats, processDecay, calculateFoodCost, feedPet, playWithPet, trainPet,
  xpToNextLevel, getPhase, formatPetName, formatPetSummary, formatShopEntry,
  formatBonusType, getSpecialtyDisplay, getSinglePetBonus,
  getKennel, upgradeKennel, getKennelUpgradeCost, getMaxPetSlots,
  generateShopStock, getPetImagePath, setActivePet, getActivePet,
} = require('../pets');
const { getBalance, removeFromTotal, addMoney } = require('../economy');
const { getCurrency } = require('../admin');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pets')
    .setDescription('Pet panel — adopt, care for, and manage your pets'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
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

    // Pet action buttons: pet_feed_<petId>_u_<userId>, pet_play_<petId>_u_<userId>, etc.
    if (customId.startsWith('pet_feed_')) return handleFeed(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_play_')) return handlePlay(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_train_')) return handleTrain(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_active_')) return handleSetActive(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_view_')) return handleViewPet(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_release_')) return handleReleaseConfirm(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_release_yes_')) return handleReleaseExecute(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_release_no_')) return showMyPetsPanel(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_rename_')) return handleRenameButton(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_buy_')) return handleBuyFromShop(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_kennel_buy_')) return handleKennelUpgrade(interaction, guildId, userId, settings);
    if (customId.startsWith('pet_shop_page_')) return handleShopPage(interaction, guildId, userId, settings);
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

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🐾 Pet Panel')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  let desc = `Welcome, **${interaction.user.displayName}**!\n\n`;
  desc += `🐾 **Pets:** ${pets.length}/${maxSlots} slots\n`;
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

  desc += extraMsg;
  embed.setDescription(desc);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_panel_shop_u_${userId}`).setLabel('Pet Shop').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_mypets_u_${userId}`).setLabel('My Pets').setEmoji('🐾').setStyle(ButtonStyle.Primary).setDisabled(pets.length === 0),
    new ButtonBuilder().setCustomId(`pet_panel_kennel_u_${userId}`).setLabel('Kennel').setEmoji('🏠').setStyle(ButtonStyle.Secondary),
  );

  const options = { embeds: [embed], components: [row1] };
  if (isDeferred) return interaction.editReply(options);
  if (isUpdate) return interaction.update(options);
  return interaction.reply({ ...options, flags: 64 });
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
  const maxSlots = getMaxPetSlots(guildId, userId);
  if (petCount >= maxSlots) {
    return interaction.reply({ content: `❌ You already have **${petCount}/${maxSlots}** pets! Upgrade your kennel or release a pet.`, flags: 64 });
  }

  // Show naming modal
  const modal = new ModalBuilder()
    .setCustomId(`modal_pet_name_${slotNumber}_u_${userId}`)
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
  // modal_pet_name_<slotNumber>_u_<userId>
  const nameIdx = parts.indexOf('name');
  const slotNumber = parseInt(parts[nameIdx + 1]);
  const petName = interaction.fields.getTextInputValue('pet_name').trim();

  if (!petName || petName.length > 24) {
    return interaction.reply({ content: '❌ Pet name must be 1-24 characters.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });

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
  const maxSlots = getMaxPetSlots(guildId, userId);
  if (petCount >= maxSlots) {
    return interaction.editReply({ content: '❌ You have no pet slots available!' });
  }

  // Deduct and adopt
  await removeFromTotal(guildId, userId, item.price, `Adopted pet: ${petName}`);
  const pet = adoptPet(guildId, userId, item.species, petName, item.rarity, item.sex, item.shiny, 'shop');
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
  desc += makeMeter(effective.hunger, 100, '🍖') + '\n\n';

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

  // Food cost
  const foodCost = calculateFoodCost(pet, settings);
  desc += `🍖 Feed Cost: **${foodCost.toLocaleString()}** ${currency}\n`;

  // Cooldown info
  const playCd = pet.last_played ? Math.max(0, (pet.last_played + settings.playCooldown * 1000) - now) : 0;
  const trainCd = pet.last_trained ? Math.max(0, (pet.last_trained + settings.trainCooldown * 1000) - now) : 0;
  desc += `🎮 Play: ${playCd > 0 ? formatCooldown(playCd) : '✅ Ready'} | 📚 Train: ${trainCd > 0 ? formatCooldown(trainCd) : '✅ Ready'}\n`;

  // Source / age
  const ageMs = now - pet.born_at;
  const ageDays = Math.floor(ageMs / 86400000);
  desc += `📅 Age: ${ageDays} day${ageDays !== 1 ? 's' : ''} | Source: ${pet.source}`;

  embed.setDescription(desc);

  // Attach pet phase image if available
  const petImage = getPetImagePath(pet.species, phase.name.toLowerCase());
  let files = [];
  if (petImage) {
    const attachment = new AttachmentBuilder(petImage.filePath, { name: petImage.fileName });
    embed.setImage(`attachment://${petImage.fileName}`);
    files.push(attachment);
  }

  // Action buttons
  const canPlay = phase.canPlay && playCd <= 0;
  const canTrain = phase.canTrain && trainCd <= 0;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_feed_${pet.id}_u_${userId}`).setLabel('Feed').setEmoji('🍖').setStyle(ButtonStyle.Success).setDisabled(effective.hunger >= 100),
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

async function handleFeed(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const pet = getPet(petId);
  if (!pet || pet.owner_id !== userId) return interaction.reply({ content: '❌ Not your pet.', flags: 64 });

  const cost = calculateFoodCost(pet, settings);
  const balance = await getBalance(guildId, userId);
  if (balance.total < cost) {
    return interaction.reply({
      content: `❌ Feeding costs **${cost.toLocaleString()}** ${getCurrency(guildId)} but you only have **${Math.round(balance.total).toLocaleString()}**.`,
      flags: 64,
    });
  }

  const result = feedPet(petId, settings);
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
    return interaction.reply({ content: '❌ ' + result.error, flags: 64 });
  }

  await removeFromTotal(guildId, userId, cost, `Fed pet: ${pet.name}`);

  // Refresh the pet detail view
  const updatedPet = getPet(petId);
  if (!updatedPet) return interaction.update({ content: 'Pet not found after feeding.', embeds: [], components: [] });

  // Quick feedback then show updated detail
  return showPetDetail(interaction, guildId, userId, settings, updatedPet);
}

async function handlePlay(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const result = playWithPet(petId, settings);

  if (!result.success) {
    if (result.error === 'ran_away') {
      return interaction.update({ content: `😢 **${result.pet?.name}** ran away!`, embeds: [], components: [] });
    }
    if (result.error === 'cooldown') {
      return interaction.reply({ content: `⏳ Play available <t:${Math.floor(result.readyAt / 1000)}:R>.`, flags: 64 });
    }
    if (result.error === 'phase_locked') {
      return interaction.reply({ content: `❌ This pet can't play yet.`, flags: 64 });
    }
    return interaction.reply({ content: '❌ ' + result.error, flags: 64 });
  }

  const pet = getPet(petId);
  if (!pet) return;

  // Build a quick embed showing the play result
  const speciesData = SPECIES[pet.species];
  let desc = `${speciesData.emoji} **${pet.name}** ${result.message}\n\n`;
  desc += `+${result.xpGain} XP | ❤️ ${result.happinessBefore} → ${result.happinessAfter}`;
  if (result.leveledUp) {
    desc += `\n🎉 **Leveled up to ${result.newLevel}!**`;
    if (result.newPhase) desc += ` Now a **${result.newPhase.emoji} ${result.newPhase.name}**!`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('🎮 Play Time!')
    .setDescription(desc)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_view_${petId}_u_${userId}`).setLabel('Back to Pet').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );

  return interaction.update({ embeds: [embed], components: [row] });
}

async function handleTrain(interaction, guildId, userId, settings) {
  const petId = parsePetIdFromCustomId(interaction.customId);
  const result = trainPet(petId, settings);

  if (!result.success) {
    if (result.error === 'ran_away') {
      return interaction.update({ content: `😢 **${result.pet?.name}** ran away!`, embeds: [], components: [] });
    }
    if (result.error === 'cooldown') {
      return interaction.reply({ content: `⏳ Training available <t:${Math.floor(result.readyAt / 1000)}:R>.`, flags: 64 });
    }
    if (result.error === 'phase_locked') {
      return interaction.reply({ content: `❌ Training unlocks at 🌱 Juvenile (Level 11).`, flags: 64 });
    }
    return interaction.reply({ content: '❌ ' + result.error, flags: 64 });
  }

  const pet = getPet(petId);
  if (!pet) return;

  const speciesData = SPECIES[pet.species];
  let desc = `${speciesData.emoji} **${pet.name}** ${result.message}\n\n`;
  desc += `+${result.xpGain} XP | ❤️ ${result.happinessBefore} → ${result.happinessAfter}`;
  if (result.leveledUp) {
    desc += `\n🎉 **Leveled up to ${result.newLevel}!**`;
    if (result.newPhase) desc += ` Now a **${result.newPhase.emoji} ${result.newPhase.name}**!`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('📚 Training Session')
    .setDescription(desc)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pet_view_${petId}_u_${userId}`).setLabel('Back to Pet').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pet_panel_main_u_${userId}`).setLabel('Main Panel').setEmoji('◀️').setStyle(ButtonStyle.Danger),
  );

  return interaction.update({ embeds: [embed], components: [row] });
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
