// Admin Pets Panel — Toggle, settings, restock
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction, getCurrency } = require('../admin');
const { getSettings, updateSettings, generateShopStock } = require('../pets');

const BUTTON_IDS = [
  'admin_pets_toggle', 'admin_pets_settings', 'admin_pets_restock',
  'admin_pets_economy', 'admin_pets_kennel', 'admin_pets_breeding', 'admin_pets_transfer',
  'back_admin_pets',
];

const MODAL_IDS = [
  'modal_admin_pets_settings',
  'modal_admin_pets_economy',
  'modal_admin_pets_kennel',
  'modal_admin_pets_breeding',
  'modal_admin_pets_transfer',
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;

  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;

    switch (customId) {
      case 'admin_pets_toggle':
        await handleToggle(interaction, guildId);
        return true;
      case 'admin_pets_settings':
        await handleSettingsModal(interaction, guildId);
        return true;
      case 'admin_pets_economy':
        await handleEconomyModal(interaction, guildId);
        return true;
      case 'admin_pets_kennel':
        await handleKennelModal(interaction, guildId);
        return true;
      case 'admin_pets_breeding':
        await handleBreedingModal(interaction, guildId);
        return true;
      case 'admin_pets_transfer':
        await handleTransferModal(interaction, guildId);
        return true;
      case 'admin_pets_restock':
        await handleForceRestock(interaction, guildId);
        return true;
      case 'back_admin_pets':
        await interaction.deferUpdate();
        await showPetsAdminPanel(interaction, guildId);
        return true;
    }
    return false;
  }

  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;

    switch (customId) {
      case 'modal_admin_pets_settings':
        await handleSettingsSubmit(interaction, guildId);
        return true;
      case 'modal_admin_pets_economy':
        await handleEconomySubmit(interaction, guildId);
        return true;
      case 'modal_admin_pets_kennel':
        await handleKennelSubmit(interaction, guildId);
        return true;
      case 'modal_admin_pets_breeding':
        await handleBreedingSubmit(interaction, guildId);
        return true;
      case 'modal_admin_pets_transfer':
        await handleTransferSubmit(interaction, guildId);
        return true;
    }
    return false;
  }

  return false;
}

// ==================== MAIN PANEL ====================
async function showPetsAdminPanel(interaction, guildId) {
  const settings = getSettings(guildId);
  const currency = getCurrency(guildId);

  // Format kennel prices - handle both array and old individual settings
  const kennelPrices = settings.kennelPrices || [settings.kennelL1Price, settings.kennelL2Price, settings.kennelL3Price];
  const kennelDisplay = kennelPrices.map((p, i) => `L${i + 1}: ${p?.toLocaleString() || 'N/A'}`).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🐾 Pet System — Admin Panel')
    .setDescription('Manage pet system settings for this server.')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🛒 Shop Restock', value: `Every ${Math.round(settings.shopRestockInterval / 3600)}h`, inline: true },
      { name: '✨ Shiny Chance', value: `${(settings.shinyChance * 100).toFixed(1)}%`, inline: true },
      { name: '🍖 Base Food Cost', value: `${settings.baseFoodCost.toLocaleString()} ${currency}\nPremium: ×${settings.foodPremiumMult} • Treat: ×${settings.foodTreatMult}`, inline: true },
      { name: '✏️ Rename Cost', value: `${settings.renameCost.toLocaleString()} ${currency}`, inline: true },
      { name: '📈 Base Bonus %', value: `${settings.baseBonusPercent}%`, inline: true },
      { name: '🎮 Play Cooldown', value: `${Math.round(settings.playCooldown / 3600)}h`, inline: true },
      { name: '📚 Train Cooldown', value: `${Math.round(settings.trainCooldown / 3600)}h`, inline: true },
      { name: '🐾 Base Slots', value: `${settings.basePetSlots}`, inline: true },
      { name: '💕 Breeding', value: settings.breedingEnabled ? `✅ Enabled\nCooldown: ${settings.breedingCooldownHours}h\nGestation: ${settings.gestationHours}h` : '❌ Disabled', inline: true },
      { name: '🔄 Transfers', value: settings.transferEnabled ? `✅ Enabled\nMin Happiness: ${settings.transferMinHappiness}\nPenalty: -${settings.transferHappinessPenalty}` : '❌ Disabled', inline: true },
      { name: '🥚 Egg Prices', value: `Mystery: ${settings.eggMysteryPrice.toLocaleString()}\nGolden: ${settings.eggGoldenPrice.toLocaleString()}\nPrismatic: ${settings.eggPrismaticPrice.toLocaleString()}`, inline: true },
      { name: '🏠 Kennel Prices', value: kennelDisplay, inline: false },
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_pets_toggle').setLabel(settings.enabled ? 'Disable' : 'Enable').setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_pets_settings').setLabel('Core Settings').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_pets_economy').setLabel('Economy').setEmoji('💰').setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_pets_kennel').setLabel('Kennel/Egg').setEmoji('🏠').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_pets_breeding').setLabel('Breeding').setEmoji('💕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_pets_transfer').setLabel('Transfers').setEmoji('🔄').setStyle(ButtonStyle.Primary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_pets_restock').setLabel('Force Restock').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('back_dashboard').setLabel('◀️ Back').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row1, row2, row3] });
}

// ==================== TOGGLE ====================
async function handleToggle(interaction, guildId) {
  const settings = getSettings(guildId);
  updateSettings(guildId, { enabled: !settings.enabled });
  await interaction.deferUpdate();
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Pet system ${!settings.enabled ? 'enabled' : 'disabled'}`);
  await showPetsAdminPanel(interaction, guildId);
}

// ==================== CORE SETTINGS MODAL ====================
async function handleSettingsModal(interaction, guildId) {
  const settings = getSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_admin_pets_settings')
    .setTitle('Pet Core Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('restock_hours').setLabel('Shop restock interval (hours)').setStyle(TextInputStyle.Short).setValue(`${Math.round(settings.shopRestockInterval / 3600)}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('shiny_chance').setLabel('Shiny chance (e.g. 0.01 = 1%)').setStyle(TextInputStyle.Short).setValue(`${settings.shinyChance}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('base_bonus').setLabel('Base bonus % (e.g. 5.0)').setStyle(TextInputStyle.Short).setValue(`${settings.baseBonusPercent}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('base_slots').setLabel('Base pet slots (default 2)').setStyle(TextInputStyle.Short).setValue(`${settings.basePetSlots}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('cooldowns').setLabel('Play/Train cooldown hours (e.g. 2)').setStyle(TextInputStyle.Short).setValue(`${Math.round(settings.playCooldown / 3600)}`).setRequired(true)
    ),
  );

  await interaction.showModal(modal);
}

async function handleSettingsSubmit(interaction, guildId) {
  await interaction.deferUpdate();

  const restockHours = parseFloat(interaction.fields.getTextInputValue('restock_hours'));
  const shinyChance = parseFloat(interaction.fields.getTextInputValue('shiny_chance'));
  const baseBonus = parseFloat(interaction.fields.getTextInputValue('base_bonus'));
  const baseSlots = parseInt(interaction.fields.getTextInputValue('base_slots'));
  const cooldownHours = parseFloat(interaction.fields.getTextInputValue('cooldowns'));

  if (isNaN(restockHours) || isNaN(shinyChance) || isNaN(baseBonus) || isNaN(baseSlots) || isNaN(cooldownHours)) {
    return interaction.followUp({ content: '❌ Invalid numbers provided.', flags: 64 });
  }

  updateSettings(guildId, {
    shopRestockInterval: Math.round(restockHours * 3600),
    shinyChance: Math.max(0, Math.min(1, shinyChance)),
    baseBonusPercent: Math.max(0, baseBonus),
    basePetSlots: Math.max(1, Math.min(10, baseSlots)),
    playCooldown: Math.round(cooldownHours * 3600),
    trainCooldown: Math.round(cooldownHours * 3600),
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Updated pet core settings');
  await showPetsAdminPanel(interaction, guildId);
}

// ==================== ECONOMY MODAL ====================
async function handleEconomyModal(interaction, guildId) {
  const settings = getSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_admin_pets_economy')
    .setTitle('Pet Economy Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('food_cost')
        .setLabel('Food: base, premium×, treat× (basic=1×)')
        .setStyle(TextInputStyle.Short)
        .setValue(`${settings.baseFoodCost}, ${settings.foodPremiumMult}, ${settings.foodTreatMult}`)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('rename_cost').setLabel('Rename cost').setStyle(TextInputStyle.Short).setValue(`${settings.renameCost}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('play_xp').setLabel('Play XP / Train XP (comma separated)').setStyle(TextInputStyle.Short).setValue(`${settings.playXp}, ${settings.trainXp}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('happiness_gain').setLabel('Play happiness / Train happiness (comma)').setStyle(TextInputStyle.Short).setValue(`${settings.playHappinessGain}, ${settings.trainHappinessGain}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('decay').setLabel('Hunger decay/day, Happiness decay/day (comma)').setStyle(TextInputStyle.Short).setValue(`${settings.hungerDecayPerDay}, ${settings.happinessDecayPerDay}`).setRequired(true)
    ),
  );

  await interaction.showModal(modal);
}

async function handleEconomySubmit(interaction, guildId) {
  await interaction.deferUpdate();

  const foodParts = interaction.fields.getTextInputValue('food_cost').split(',').map(s => parseFloat(s.trim()));
  const foodCost = foodParts[0];
  const foodPremiumMult = foodParts[1];
  const foodTreatMult = foodParts[2];
  const renameCost = parseInt(interaction.fields.getTextInputValue('rename_cost'));

  const xpParts = interaction.fields.getTextInputValue('play_xp').split(',').map(s => parseInt(s.trim()));
  const happParts = interaction.fields.getTextInputValue('happiness_gain').split(',').map(s => parseInt(s.trim()));
  const decayParts = interaction.fields.getTextInputValue('decay').split(',').map(s => parseInt(s.trim()));

  if ([foodCost, foodPremiumMult, foodTreatMult, renameCost, ...xpParts, ...happParts, ...decayParts].some(v => isNaN(v))) {
    return interaction.followUp({ content: '❌ Invalid numbers provided.', flags: 64 });
  }

  updateSettings(guildId, {
    baseFoodCost: Math.max(0, Math.round(foodCost)),
    foodBasicMult: 1.0,
    foodPremiumMult: Math.max(0, foodPremiumMult),
    foodTreatMult: Math.max(0, foodTreatMult),
    renameCost: Math.max(0, renameCost),
    playXp: Math.max(1, xpParts[0]),
    trainXp: Math.max(1, xpParts[1] || xpParts[0]),
    playHappinessGain: Math.max(1, happParts[0]),
    trainHappinessGain: Math.max(1, happParts[1] || happParts[0]),
    hungerDecayPerDay: Math.max(1, decayParts[0]),
    happinessDecayPerDay: Math.max(1, decayParts[1] || decayParts[0]),
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Updated pet economy settings');
  await showPetsAdminPanel(interaction, guildId);
}

// ==================== KENNEL/EGG PRICES MODAL ====================
async function handleKennelModal(interaction, guildId) {
  const settings = getSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_admin_pets_kennel')
    .setTitle('Kennel & Egg Prices');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('kennel_prices').setLabel('Kennel prices (comma sep., any count)').setStyle(TextInputStyle.Short).setValue(settings.kennelPrices.join(', ')).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('egg_prices').setLabel('Mystery, Golden, Prismatic prices').setStyle(TextInputStyle.Short).setValue(`${settings.eggMysteryPrice}, ${settings.eggGoldenPrice}, ${settings.eggPrismaticPrice}`).setRequired(true)
    ),
  );

  await interaction.showModal(modal);
}

async function handleKennelSubmit(interaction, guildId) {
  await interaction.deferUpdate();

  const kennelParts = interaction.fields.getTextInputValue('kennel_prices').split(',').map(s => parseInt(s.trim())).filter(v => !isNaN(v) && v >= 0);
  const eggParts = interaction.fields.getTextInputValue('egg_prices').split(',').map(s => parseInt(s.trim()));

  if (kennelParts.length < 1 || eggParts.some(v => isNaN(v)) || eggParts.length < 3) {
    return interaction.followUp({ content: '❌ Need at least 1 kennel price and 3 egg prices (comma-separated).', flags: 64 });
  }

  updateSettings(guildId, {
    kennelPrices: kennelParts,
    eggMysteryPrice: Math.max(0, eggParts[0]),
    eggGoldenPrice: Math.max(0, eggParts[1]),
    eggPrismaticPrice: Math.max(0, eggParts[2]),
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Updated kennel & egg prices');
  await showPetsAdminPanel(interaction, guildId);
}

// ==================== FORCE RESTOCK ====================
async function handleForceRestock(interaction, guildId) {
  await interaction.deferUpdate();
  generateShopStock(guildId);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Force restocked pet shop');
  await showPetsAdminPanel(interaction, guildId);
}

// ==================== BREEDING MODAL ====================
async function handleBreedingModal(interaction, guildId) {
  const settings = getSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_admin_pets_breeding')
    .setTitle('Breeding Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('breeding_enabled').setLabel('Enabled? (yes/no)').setStyle(TextInputStyle.Short).setValue(settings.breedingEnabled ? 'yes' : 'no').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('breeding_fees').setLabel('Fees: Common, Uncommon, Rare, Epic, Legend').setStyle(TextInputStyle.Short).setValue(`${settings.breedingFeeCommon}, ${settings.breedingFeeUncommon}, ${settings.breedingFeeRare}, ${settings.breedingFeeEpic}, ${settings.breedingFeeLegendary}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('breeding_exotic_mult').setLabel('Exotic fee multiplier (e.g. 3.0)').setStyle(TextInputStyle.Short).setValue(`${settings.breedingExoticMultiplier}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('breeding_times').setLabel('Cooldown hours, Gestation hours').setStyle(TextInputStyle.Short).setValue(`${settings.breedingCooldownHours}, ${settings.gestationHours}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('max_stud_fee').setLabel('Max stud fee (0 = unlimited)').setStyle(TextInputStyle.Short).setValue(`${settings.maxStudFee}`).setRequired(true)
    ),
  );

  await interaction.showModal(modal);
}

async function handleBreedingSubmit(interaction, guildId) {
  await interaction.deferUpdate();

  const enabledStr = interaction.fields.getTextInputValue('breeding_enabled').toLowerCase();
  const enabled = enabledStr === 'yes' || enabledStr === 'true' || enabledStr === '1';

  const feeParts = interaction.fields.getTextInputValue('breeding_fees').split(',').map(s => parseInt(s.trim()));
  const exoticMult = parseFloat(interaction.fields.getTextInputValue('breeding_exotic_mult'));
  const timeParts = interaction.fields.getTextInputValue('breeding_times').split(',').map(s => parseInt(s.trim()));
  const maxStudFee = parseInt(interaction.fields.getTextInputValue('max_stud_fee'));

  if (feeParts.length < 5 || feeParts.some(v => isNaN(v)) || isNaN(exoticMult) || timeParts.length < 2 || timeParts.some(v => isNaN(v)) || isNaN(maxStudFee)) {
    return interaction.followUp({ content: '❌ Invalid values. Need 5 fees, exotic multiplier, 2 times, and max stud fee.', flags: 64 });
  }

  updateSettings(guildId, {
    breedingEnabled: enabled,
    breedingFeeCommon: Math.max(0, feeParts[0]),
    breedingFeeUncommon: Math.max(0, feeParts[1]),
    breedingFeeRare: Math.max(0, feeParts[2]),
    breedingFeeEpic: Math.max(0, feeParts[3]),
    breedingFeeLegendary: Math.max(0, feeParts[4]),
    breedingExoticMultiplier: Math.max(1, exoticMult),
    breedingCooldownHours: Math.max(1, timeParts[0]),
    gestationHours: Math.max(1, timeParts[1]),
    maxStudFee: Math.max(0, maxStudFee),
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated breeding settings (${enabled ? 'enabled' : 'disabled'})`);
  await showPetsAdminPanel(interaction, guildId);
}

// ==================== TRANSFER MODAL ====================
async function handleTransferModal(interaction, guildId) {
  const settings = getSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_admin_pets_transfer')
    .setTitle('Transfer (Give/Sell) Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('transfer_enabled').setLabel('Enabled? (yes/no)').setStyle(TextInputStyle.Short).setValue(settings.transferEnabled ? 'yes' : 'no').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('min_happiness').setLabel('Min happiness to transfer').setStyle(TextInputStyle.Short).setValue(`${settings.transferMinHappiness}`).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('happiness_penalty').setLabel('Happiness penalty on transfer').setStyle(TextInputStyle.Short).setValue(`${settings.transferHappinessPenalty}`).setRequired(true)
    ),
  );

  await interaction.showModal(modal);
}

async function handleTransferSubmit(interaction, guildId) {
  await interaction.deferUpdate();

  const enabledStr = interaction.fields.getTextInputValue('transfer_enabled').toLowerCase();
  const enabled = enabledStr === 'yes' || enabledStr === 'true' || enabledStr === '1';
  const minHappiness = parseInt(interaction.fields.getTextInputValue('min_happiness'));
  const penalty = parseInt(interaction.fields.getTextInputValue('happiness_penalty'));

  if (isNaN(minHappiness) || isNaN(penalty)) {
    return interaction.followUp({ content: '❌ Invalid numbers.', flags: 64 });
  }

  updateSettings(guildId, {
    transferEnabled: enabled,
    transferMinHappiness: Math.max(0, Math.min(100, minHappiness)),
    transferHappinessPenalty: Math.max(0, Math.min(100, penalty)),
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated transfer settings (${enabled ? 'enabled' : 'disabled'})`);
  await showPetsAdminPanel(interaction, guildId);
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showPetsAdminPanel,
};
