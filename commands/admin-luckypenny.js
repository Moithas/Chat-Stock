// Admin Lucky Penny Panel - Buff/Debuff/Currency Settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getLuckyPennySettings, updateLuckyPennySettings, DEFAULT_SETTINGS } = require('../luckypenny');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_luckypenny',
  'admin_lp_toggle',
  'admin_lp_edit_general',
  'admin_lp_edit_buffs',
  'admin_lp_edit_currency',
  'back_admin_lp'
];

const MODAL_IDS = [
  'modal_admin_lp_general',
  'modal_admin_lp_buffs',
  'modal_admin_lp_currency'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'admin_luckypenny':
        await interaction.deferUpdate();
        await showLuckyPennyPanel(interaction, guildId);
        return true;
      case 'admin_lp_toggle':
        await interaction.deferUpdate();
        await handleToggle(interaction, guildId);
        return true;
      case 'admin_lp_edit_general':
        await handleEditGeneral(interaction, guildId);
        return true;
      case 'admin_lp_edit_buffs':
        await handleEditBuffs(interaction, guildId);
        return true;
      case 'admin_lp_edit_currency':
        await handleEditCurrency(interaction, guildId);
        return true;
      case 'back_admin_lp':
        await interaction.deferUpdate();
        await showLuckyPennyPanel(interaction, guildId);
        return true;
    }
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'modal_admin_lp_general':
        await handleGeneralModal(interaction, guildId);
        return true;
      case 'modal_admin_lp_buffs':
        await handleBuffsModal(interaction, guildId);
        return true;
      case 'modal_admin_lp_currency':
        await handleCurrencyModal(interaction, guildId);
        return true;
    }
  }
  
  return false;
}

// ==================== LUCKY PENNY PANEL ====================
async function showLuckyPennyPanel(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(settings.enabled ? 0xf1c40f : 0x95a5a6)
    .setTitle('🪙 Lucky Penny Settings')
    .setDescription('Configure the Lucky Penny buff/debuff/currency roller')
    .addFields(
      { name: '⚙️ General', value: 
        `Status: **${settings.enabled ? '✅ Enabled' : '❌ Disabled'}**\n` +
        `Cooldown: **${settings.cooldownHours}** hours\n` +
        `Nothing Cooldown: **${settings.nothingCooldownHours}** hours`,
        inline: true 
      },
      { name: '🎲 Buff/Debuff Range', value: 
        `Strength: **${settings.minBuffPercent}%** - **${settings.maxBuffPercent}%**\n` +
        `Duration: **${settings.minDurationHours}h** - **${settings.maxDurationHours}h**`,
        inline: true 
      },
      { name: `💰 Currency Range`, value: 
        `Min: **${settings.minCurrency.toLocaleString()}** ${CURRENCY}\n` +
        `Max: **${settings.maxCurrency.toLocaleString()}** ${CURRENCY}`,
        inline: true 
      },
      { name: '📊 Outcome Odds', value: 
        `🎲 Buff or Debuff: **33.3%**\n` +
        `💰 Currency: **33.3%**\n` +
        `💨 Nothing: **33.3%**\n` +
        `_(Buff vs Debuff is 50/50 within the buff outcome)_`,
        inline: false 
      }
    )
    .setFooter({ text: 'Lucky Penny buffs stack with item effects • Stored in active_effects table' });

  const toggleBtn = new ButtonBuilder()
    .setCustomId('admin_lp_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(settings.enabled ? '❌' : '✅');

  const editGeneralBtn = new ButtonBuilder()
    .setCustomId('admin_lp_edit_general')
    .setLabel('Cooldown')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('⏱️');

  const editBuffsBtn = new ButtonBuilder()
    .setCustomId('admin_lp_edit_buffs')
    .setLabel('Buff Settings')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🎲');

  const editCurrencyBtn = new ButtonBuilder()
    .setCustomId('admin_lp_edit_currency')
    .setLabel('Currency Settings')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('💰');

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('Back to Dashboard')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row1 = new ActionRowBuilder().addComponents(toggleBtn, editGeneralBtn, editBuffsBtn, editCurrencyBtn);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== TOGGLE ====================
async function handleToggle(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  const newEnabled = !settings.enabled;
  
  updateLuckyPennySettings(guildId, { enabled: newEnabled });
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `${newEnabled ? 'Enabled' : 'Disabled'} Lucky Penny system`);

  await showLuckyPennyPanel(interaction, guildId);
}

// ==================== EDIT GENERAL (COOLDOWN) ====================
async function handleEditGeneral(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_lp_general')
    .setTitle('Edit Lucky Penny Cooldown');

  const cooldownInput = new TextInputBuilder()
    .setCustomId('cooldown_hours')
    .setLabel('Cooldown (hours)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.cooldownHours))
    .setPlaceholder('8')
    .setRequired(true);

  const nothingCooldownInput = new TextInputBuilder()
    .setCustomId('nothing_cooldown_hours')
    .setLabel('Nothing Cooldown (hours) — reduced CD')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.nothingCooldownHours))
    .setPlaceholder('2')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(cooldownInput),
    new ActionRowBuilder().addComponents(nothingCooldownInput)
  );

  await interaction.showModal(modal);
}

async function handleGeneralModal(interaction, guildId) {
  const cooldownHours = parseFloat(interaction.fields.getTextInputValue('cooldown_hours')) || DEFAULT_SETTINGS.cooldownHours;
  const nothingCooldownHours = parseFloat(interaction.fields.getTextInputValue('nothing_cooldown_hours')) || DEFAULT_SETTINGS.nothingCooldownHours;

  updateLuckyPennySettings(guildId, {
    cooldownHours: Math.max(0.5, cooldownHours),
    nothingCooldownHours: Math.max(0, Math.min(nothingCooldownHours, cooldownHours))
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `Updated Lucky Penny cooldown: ${cooldownHours}h (nothing: ${nothingCooldownHours}h)`);

  await interaction.deferUpdate();
  await showLuckyPennyPanel(interaction, guildId);
}

// ==================== EDIT BUFF SETTINGS ====================
async function handleEditBuffs(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_lp_buffs')
    .setTitle('Edit Buff/Debuff Settings');

  const minPercentInput = new TextInputBuilder()
    .setCustomId('min_percent')
    .setLabel('Min Buff/Debuff % (strength)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.minBuffPercent))
    .setPlaceholder('10')
    .setRequired(true);

  const maxPercentInput = new TextInputBuilder()
    .setCustomId('max_percent')
    .setLabel('Max Buff/Debuff % (strength)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.maxBuffPercent))
    .setPlaceholder('30')
    .setRequired(true);

  const minDurationInput = new TextInputBuilder()
    .setCustomId('min_duration')
    .setLabel('Min Duration (hours)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.minDurationHours))
    .setPlaceholder('2')
    .setRequired(true);

  const maxDurationInput = new TextInputBuilder()
    .setCustomId('max_duration')
    .setLabel('Max Duration (hours)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.maxDurationHours))
    .setPlaceholder('8')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(minPercentInput),
    new ActionRowBuilder().addComponents(maxPercentInput),
    new ActionRowBuilder().addComponents(minDurationInput),
    new ActionRowBuilder().addComponents(maxDurationInput)
  );

  await interaction.showModal(modal);
}

async function handleBuffsModal(interaction, guildId) {
  const minPercent = parseInt(interaction.fields.getTextInputValue('min_percent')) || DEFAULT_SETTINGS.minBuffPercent;
  const maxPercent = parseInt(interaction.fields.getTextInputValue('max_percent')) || DEFAULT_SETTINGS.maxBuffPercent;
  const minDuration = parseInt(interaction.fields.getTextInputValue('min_duration')) || DEFAULT_SETTINGS.minDurationHours;
  const maxDuration = parseInt(interaction.fields.getTextInputValue('max_duration')) || DEFAULT_SETTINGS.maxDurationHours;

  updateLuckyPennySettings(guildId, {
    minBuffPercent: Math.max(1, Math.min(minPercent, 100)),
    maxBuffPercent: Math.max(1, Math.min(Math.max(maxPercent, minPercent), 100)),
    minDurationHours: Math.max(1, minDuration),
    maxDurationHours: Math.max(Math.max(1, minDuration), maxDuration)
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `Updated Lucky Penny buffs: ${minPercent}-${maxPercent}% strength, ${minDuration}-${maxDuration}h duration`);

  await interaction.deferUpdate();
  await showLuckyPennyPanel(interaction, guildId);
}

// ==================== EDIT CURRENCY SETTINGS ====================
async function handleEditCurrency(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_lp_currency')
    .setTitle('Edit Currency Reward Range');

  const minCurrencyInput = new TextInputBuilder()
    .setCustomId('min_currency')
    .setLabel('Min Currency Reward')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.minCurrency))
    .setPlaceholder('500')
    .setRequired(true);

  const maxCurrencyInput = new TextInputBuilder()
    .setCustomId('max_currency')
    .setLabel('Max Currency Reward')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.maxCurrency))
    .setPlaceholder('1500')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(minCurrencyInput),
    new ActionRowBuilder().addComponents(maxCurrencyInput)
  );

  await interaction.showModal(modal);
}

async function handleCurrencyModal(interaction, guildId) {
  const minCurrency = parseInt(interaction.fields.getTextInputValue('min_currency')) || DEFAULT_SETTINGS.minCurrency;
  const maxCurrency = parseInt(interaction.fields.getTextInputValue('max_currency')) || DEFAULT_SETTINGS.maxCurrency;

  updateLuckyPennySettings(guildId, {
    minCurrency: Math.max(0, minCurrency),
    maxCurrency: Math.max(minCurrency, maxCurrency)
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `Updated Lucky Penny currency range: ${minCurrency.toLocaleString()} - ${maxCurrency.toLocaleString()}`);

  await interaction.deferUpdate();
  await showLuckyPennyPanel(interaction, guildId);
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showLuckyPennyPanel,
  BUTTON_IDS,
  MODAL_IDS
};
