// Admin System Panel - Fees, Anti-Spam, Market, Ticker, Events settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getGuildSettings, setFeesEnabled, updateBuyFee, updateSellFee } = require('../fees');
const { getSpamSettings, setAntiSpamEnabled, updateCooldown, updateMinLength, updateButtonCooldown } = require('../antispam');
const { getMarketSettings, updateSellCooldown, updatePriceImpactDelay, updateCapitalGainsTax } = require('../market');
const { getTickerChannel, setTickerChannel, getDashboardSettings, updateDashboardSettings, setDashboardChannel, updateDashboard } = require('../ticker');
const { getEventSettings, updateEventSettings, triggerEvent } = require('../events');
const { getTrackerSettings, saveTrackerSettings, updateTrackerSettings, setTrackerChannel, setTrackerEnabled, startCooldownTracker, stopCooldownTracker, updateCooldownTracker } = require('../cooldown-tracker');
const { getActivityTierSettings, updateActivityTierSettings, calculateDailyContribution } = require('../database');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  // Fees
  'fees_toggle', 'fees_edit_buy', 'fees_edit_sell',
  // Anti-Spam
  'antispam_toggle', 'antispam_edit_settings',
  // Market
  'market_edit_cooldown', 'market_edit_tax',
  // Activity Tiers
  'activity_tiers_panel', 'activity_tiers_toggle', 'activity_tiers_edit', 'activity_tiers_back',
  // Ticker
  'ticker_edit_threshold', 'ticker_toggle_weekly', 'ticker_manage_channels', 'ticker_set_channel',
  // Dashboard
  'dashboard_toggle', 'dashboard_edit_settings', 'dashboard_set_channel', 'dashboard_refresh',
  // Events
  'events_toggle', 'events_edit_settings', 'events_edit_weights', 'events_set_channel',
  'events_force_spawn',
  // Cooldown Tracker
  'tracker_toggle', 'tracker_edit_settings', 'tracker_set_channel', 'tracker_refresh',
  // Back buttons
  'back_ticker'
];

const MODAL_IDS = [
  'modal_buy_fee', 'modal_sell_fee',
  'modal_antispam_settings',
  'modal_market_cooldown', 'modal_market_capital_gains',
  'modal_activity_tiers',
  'modal_ticker_threshold',
  'modal_dashboard_settings',
  'modal_events_settings', 'modal_events_weights',
  'modal_tracker_settings'
];

const SELECT_IDS = [
  'ticker_channel_select', 'events_channel_select', 'dashboard_channel_select', 'tracker_channel_select'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      // Fees buttons
      case 'fees_toggle':
        await handleFeesToggle(interaction, guildId);
        return true;
      case 'fees_edit_buy':
        await handleFeesEditBuy(interaction, guildId);
        return true;
      case 'fees_edit_sell':
        await handleFeesEditSell(interaction, guildId);
        return true;
        
      // Anti-Spam buttons
      case 'antispam_toggle':
        await handleAntiSpamToggle(interaction, guildId);
        return true;
      case 'antispam_edit_settings':
        await handleAntiSpamEditSettings(interaction, guildId);
        return true;
        
      // Market buttons
      case 'market_edit_cooldown':
        await handleMarketEditCooldown(interaction, guildId);
        return true;
      case 'market_edit_tax':
        await handleMarketEditTax(interaction, guildId);
        return true;
        
      // Activity Tiers buttons
      case 'activity_tiers_panel':
        await showActivityTiersPanel(interaction, guildId);
        return true;
      case 'activity_tiers_toggle':
        await handleActivityTiersToggle(interaction, guildId);
        return true;
      case 'activity_tiers_edit':
        await handleActivityTiersEdit(interaction, guildId);
        return true;
      case 'activity_tiers_back':
        await interaction.deferUpdate();
        await showMarketPanel(interaction, guildId);
        return true;
        
      // Ticker buttons
      case 'ticker_edit_threshold':
        await handleTickerEditThreshold(interaction, guildId);
        return true;
      case 'ticker_toggle_weekly':
        await handleTickerToggleWeekly(interaction, guildId);
        return true;
      case 'ticker_manage_channels':
      case 'ticker_set_channel':
        await showTickerChannelSelect(interaction, guildId);
        return true;
      case 'back_ticker':
        await showTickerPanel(interaction, guildId);
        return true;
        
      // Dashboard buttons
      case 'dashboard_toggle':
        await handleDashboardToggle(interaction, guildId);
        return true;
      case 'dashboard_edit_settings':
        await handleDashboardEditSettings(interaction, guildId);
        return true;
      case 'dashboard_set_channel':
        await showDashboardChannelSelect(interaction, guildId);
        return true;
      case 'dashboard_refresh':
        await handleDashboardRefresh(interaction, guildId);
        return true;
        
      // Events buttons
      case 'events_toggle':
        await handleEventsToggle(interaction, guildId);
        return true;
      case 'events_edit_settings':
        await handleEventsEditSettings(interaction, guildId);
        return true;
      case 'events_edit_weights':
        await handleEventsEditWeights(interaction, guildId);
        return true;
      case 'events_set_channel':
        await showEventsChannelSelect(interaction, guildId);
        return true;
      case 'events_force_spawn':
        await handleForceMarketEvent(interaction, guildId);
        return true;
        
      // Cooldown Tracker buttons
      case 'tracker_toggle':
        await handleTrackerToggle(interaction, guildId);
        return true;
      case 'tracker_edit_settings':
        await handleTrackerEditSettings(interaction, guildId);
        return true;
      case 'tracker_set_channel':
        await showTrackerChannelSelect(interaction, guildId);
        return true;
      case 'tracker_refresh':
        await handleTrackerRefresh(interaction, guildId);
        return true;
    }
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'modal_buy_fee':
        await handleBuyFeeModal(interaction, guildId);
        return true;
      case 'modal_sell_fee':
        await handleSellFeeModal(interaction, guildId);
        return true;
      case 'modal_antispam_settings':
        await handleAntiSpamModal(interaction, guildId);
        return true;
      case 'modal_market_cooldown':
        await handleMarketCooldownModal(interaction, guildId);
        return true;
      case 'modal_market_capital_gains':
        await handleCapitalGainsModal(interaction, guildId);
        return true;
      case 'modal_activity_tiers':
        await handleActivityTiersModal(interaction, guildId);
        return true;
      case 'modal_ticker_threshold':
        await handleTickerThresholdModal(interaction, guildId);
        return true;
      case 'modal_dashboard_settings':
        await handleDashboardSettingsModal(interaction, guildId);
        return true;
      case 'modal_events_settings':
        await handleEventsSettingsModal(interaction, guildId);
        return true;
      case 'modal_events_weights':
        await handleEventsWeightsModal(interaction, guildId);
        return true;
      case 'modal_tracker_settings':
        await handleTrackerSettingsModal(interaction, guildId);
        return true;
    }
  }
  
  // Handle channel select menus
  if (interaction.isChannelSelectMenu()) {
    if (!SELECT_IDS.includes(customId)) return false;
    
    if (customId === 'ticker_channel_select') {
      await handleTickerChannelSelect(interaction, guildId);
      return true;
    }
    if (customId === 'dashboard_channel_select') {
      await handleDashboardChannelSelect(interaction, guildId);
      return true;
    }
    if (customId === 'events_channel_select') {
      await handleEventsChannelSelect(interaction, guildId);
      return true;
    }
  }
  
  // Handle string select menus (tracker uses StringSelectMenu for channels)
  if (interaction.isStringSelectMenu()) {
    if (customId === 'tracker_channel_select') {
      await handleTrackerChannelSelect(interaction, guildId);
      return true;
    }
  }
  
  return false;
}

// ==================== FEES PANEL ====================
async function showFeesPanel(interaction, guildId) {
  const settings = getGuildSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💸 Fee Settings')
    .setDescription('Configure transaction fees for buying and selling stocks')
    .addFields(
      { name: '📊 Fees Status', value: settings.feesEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📈 Buy Fee Type', value: settings.buyFeeType || 'flat', inline: true },
      { name: '💵 Buy Fee Value', value: settings.buyFeeType === 'percent' ? `${settings.buyFeeValue}%` : settings.buyFeeValue.toLocaleString(), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📉 Sell Fee Type', value: settings.sellFeeType || 'flat', inline: true },
      { name: '💵 Sell Fee Value', value: settings.sellFeeType === 'percent' ? `${settings.sellFeeValue}%` : settings.sellFeeValue.toLocaleString(), inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('fees_toggle')
    .setLabel(settings.feesEnabled ? 'Disable Fees' : 'Enable Fees')
    .setStyle(settings.feesEnabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const buyFeeBtn = new ButtonBuilder()
    .setCustomId('fees_edit_buy')
    .setLabel('📈 Edit Buy Fee')
    .setStyle(ButtonStyle.Primary);

  const sellFeeBtn = new ButtonBuilder()
    .setCustomId('fees_edit_sell')
    .setLabel('📉 Edit Sell Fee')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, buyFeeBtn, sellFeeBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleFeesToggle(interaction, guildId) {
  const settings = getGuildSettings(guildId);
  const newEnabled = !settings.feesEnabled;
  setFeesEnabled(guildId, newEnabled);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} trading fees`);
  await interaction.deferUpdate();
  await showMarketPanel(interaction, guildId);
}

async function handleFeesEditBuy(interaction, guildId) {
  const settings = getGuildSettings(guildId);
  const modal = createBuyFeeModal(settings);
  await interaction.showModal(modal);
}

async function handleFeesEditSell(interaction, guildId) {
  const settings = getGuildSettings(guildId);
  const modal = createSellFeeModal(settings);
  await interaction.showModal(modal);
}

async function handleBuyFeeModal(interaction, guildId) {
  const feeType = interaction.fields.getTextInputValue('fee_type').toLowerCase();
  const feeValue = parseFloat(interaction.fields.getTextInputValue('fee_value')) || 0;
  
  if (feeType !== 'flat' && feeType !== 'percent') {
    await interaction.reply({ content: '❌ Fee type must be "flat" or "percent".', flags: 64 });
    return;
  }
  
  updateBuyFee(guildId, feeType, feeValue);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set buy fee to ${feeValue} (${feeType})`);
  await interaction.reply({ content: `✅ Buy fee set to ${feeType === 'percent' ? feeValue + '%' : feeValue + ' (flat)'}`, flags: 64 });
}

async function handleSellFeeModal(interaction, guildId) {
  const feeType = interaction.fields.getTextInputValue('fee_type').toLowerCase();
  const feeValue = parseFloat(interaction.fields.getTextInputValue('fee_value')) || 0;
  
  if (feeType !== 'flat' && feeType !== 'percent') {
    await interaction.reply({ content: '❌ Fee type must be "flat" or "percent".', flags: 64 });
    return;
  }
  
  updateSellFee(guildId, feeType, feeValue);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set sell fee to ${feeValue} (${feeType})`);
  await interaction.reply({ content: `✅ Sell fee set to ${feeType === 'percent' ? feeValue + '%' : feeValue + ' (flat)'}`, flags: 64 });
}

function createBuyFeeModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_buy_fee')
    .setTitle('Edit Buy Fee')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fee_type')
          .setLabel('Fee Type (flat or percent)')
          .setPlaceholder('flat or percent')
          .setValue(settings.buyFeeType || 'flat')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fee_value')
          .setLabel('Fee Value')
          .setPlaceholder('10 (for flat) or 2.5 (for percent)')
          .setValue(String(settings.buyFeeValue || 0))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createSellFeeModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_sell_fee')
    .setTitle('Edit Sell Fee')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fee_type')
          .setLabel('Fee Type (flat or percent)')
          .setPlaceholder('flat or percent')
          .setValue(settings.sellFeeType || 'flat')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fee_value')
          .setLabel('Fee Value')
          .setPlaceholder('10 (for flat) or 2.5 (for percent)')
          .setValue(String(settings.sellFeeValue || 0))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== ANTI-SPAM PANEL ====================
async function showAntiSpamPanel(interaction, guildId) {
  const settings = getSpamSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🛡️ Anti-Spam Settings')
    .setDescription('Configure anti-spam settings for message counting (affects event/vault triggers)')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '⏱️ Message Cooldown', value: `${settings.cooldownSeconds} seconds`, inline: true },
      { name: '🖱️ Button Cooldown', value: `${settings.buttonCooldownSeconds} seconds`, inline: true },
      { name: '📝 Min Length', value: `${settings.minMessageLength} characters`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('antispam_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('antispam_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleAntiSpamToggle(interaction, guildId) {
  const settings = getSpamSettings(guildId);
  const newEnabled = !settings.enabled;
  setAntiSpamEnabled(guildId, newEnabled);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} anti-spam`);
  await interaction.deferUpdate();
  await showAntiSpamPanel(interaction, guildId);
}

async function handleAntiSpamEditSettings(interaction, guildId) {
  const settings = getSpamSettings(guildId);
  const modal = createAntiSpamModal(settings);
  await interaction.showModal(modal);
}

async function handleAntiSpamModal(interaction, guildId) {
  const cooldownSeconds = parseInt(interaction.fields.getTextInputValue('cooldown_seconds')) || 30;
  const buttonCooldownSeconds = parseInt(interaction.fields.getTextInputValue('button_cooldown_seconds')) || 3;
  const minLength = parseInt(interaction.fields.getTextInputValue('min_length')) || 5;
  
  updateCooldown(guildId, cooldownSeconds);
  updateButtonCooldown(guildId, buttonCooldownSeconds);
  updateMinLength(guildId, minLength);
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated anti-spam: cooldown=${cooldownSeconds}s, buttonCooldown=${buttonCooldownSeconds}s, minLength=${minLength}`);
  await interaction.reply({ content: '✅ Anti-spam settings updated!', flags: 64 });
}

function createAntiSpamModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_antispam_settings')
    .setTitle('Anti-Spam Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown_seconds')
          .setLabel('Message Cooldown (seconds)')
          .setPlaceholder('30')
          .setValue(String(settings.cooldownSeconds || 30))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('button_cooldown_seconds')
          .setLabel('Button Cooldown (seconds)')
          .setPlaceholder('3')
          .setValue(String(settings.buttonCooldownSeconds || 3))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_length')
          .setLabel('Minimum Message Length (characters)')
          .setPlaceholder('5')
          .setValue(String(settings.minMessageLength || 5))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== MARKET PANEL ====================
async function showMarketPanel(interaction, guildId) {
  const marketSettings = getMarketSettings(guildId);
  const feeSettings = getGuildSettings(guildId);
  const tierSettings = getActivityTierSettings(guildId);
  
  // Format fee display
  const buyFeeDisplay = feeSettings.buyFeeType === 'percent' ? `${feeSettings.buyFeeValue}%` : feeSettings.buyFeeValue.toLocaleString();
  const sellFeeDisplay = feeSettings.sellFeeType === 'percent' ? `${feeSettings.sellFeeValue}%` : feeSettings.sellFeeValue.toLocaleString();
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Market Settings')
    .setDescription('Configure trading fees, taxes, and market mechanics')
    .addFields(
      { name: '💵 Trading Fees', value: feeSettings.feesEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📈 Buy Fee', value: `${buyFeeDisplay} (${feeSettings.buyFeeType})`, inline: true },
      { name: '📉 Sell Fee', value: `${sellFeeDisplay} (${feeSettings.sellFeeType})`, inline: true },
      { name: '💰 Short-Term Tax', value: `${marketSettings.shortTermTaxPercent || 0}%`, inline: true },
      { name: '📈 Long-Term Tax', value: `${marketSettings.longTermTaxPercent || 0}%`, inline: true },
      { name: '⏰ Short-Term Threshold', value: `${marketSettings.shortTermThresholdHours || 24} hours`, inline: true },
      { name: '⏱️ Sell Cooldown', value: `${marketSettings.sellCooldownMinutes || 60} minutes`, inline: true },
      { name: '📉 Price Impact Delay', value: `${marketSettings.priceImpactDelayMinutes || 120} minutes`, inline: true },
      { name: '📈 Activity Tiers', value: tierSettings.enabled ? '✅ Diminishing Returns' : '❌ Flat Rate (Legacy)', inline: true }
    );

  // Row 1: Fees
  const feesToggleBtn = new ButtonBuilder()
    .setCustomId('fees_toggle')
    .setLabel(feeSettings.feesEnabled ? 'Disable Fees' : 'Enable Fees')
    .setStyle(feeSettings.feesEnabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const buyFeeBtn = new ButtonBuilder()
    .setCustomId('fees_edit_buy')
    .setLabel('📈 Buy Fee')
    .setStyle(ButtonStyle.Primary);

  const sellFeeBtn = new ButtonBuilder()
    .setCustomId('fees_edit_sell')
    .setLabel('📉 Sell Fee')
    .setStyle(ButtonStyle.Primary);

  const row1 = new ActionRowBuilder().addComponents(feesToggleBtn, buyFeeBtn, sellFeeBtn);

  // Row 2: Taxes & Cooldowns
  const taxBtn = new ButtonBuilder()
    .setCustomId('market_edit_tax')
    .setLabel('💰 Capital Gains Tax')
    .setStyle(ButtonStyle.Primary);

  const cooldownBtn = new ButtonBuilder()
    .setCustomId('market_edit_cooldown')
    .setLabel('⏱️ Cooldowns')
    .setStyle(ButtonStyle.Primary);

  const activityTiersBtn = new ButtonBuilder()
    .setCustomId('activity_tiers_panel')
    .setLabel('📈 Activity Tiers')
    .setStyle(ButtonStyle.Primary);

  const row2 = new ActionRowBuilder().addComponents(taxBtn, cooldownBtn, activityTiersBtn);

  // Row 3: Back
  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row3 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2, row3] });
}

async function handleMarketEditCooldown(interaction, guildId) {
  const settings = getMarketSettings(guildId);
  const modal = createMarketCooldownModal(settings);
  await interaction.showModal(modal);
}

async function handleMarketEditTax(interaction, guildId) {
  const settings = getMarketSettings(guildId);
  const modal = createCapitalGainsTaxModal(settings);
  await interaction.showModal(modal);
}

async function handleMarketCooldownModal(interaction, guildId) {
  const sellCooldown = parseInt(interaction.fields.getTextInputValue('sell_cooldown')) || 60;
  const priceImpactDelay = parseInt(interaction.fields.getTextInputValue('price_impact_delay')) || 120;
  
  updateSellCooldown(guildId, sellCooldown);
  updatePriceImpactDelay(guildId, priceImpactDelay);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated market cooldowns: sell=${sellCooldown}m, impact=${priceImpactDelay}m`);
  
  await interaction.reply({ content: '✅ Market cooldowns updated!', flags: 64 });
  await showMarketPanel(interaction, guildId);
}

async function handleCapitalGainsModal(interaction, guildId) {
  const shortTermPercent = parseFloat(interaction.fields.getTextInputValue('short_term_percent')) || 0;
  const longTermPercent = parseFloat(interaction.fields.getTextInputValue('long_term_percent')) || 0;
  const shortTermHours = parseInt(interaction.fields.getTextInputValue('short_term_hours')) || 24;
  
  // updateCapitalGainsTax(guildId, shortTermHours, shortTermPercent, longTermPercent, enabled)
  updateCapitalGainsTax(guildId, shortTermHours, shortTermPercent, longTermPercent, undefined);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated capital gains tax: short=${shortTermPercent}%, long=${longTermPercent}%, threshold=${shortTermHours}h`);
  
  await interaction.reply({ content: '✅ Capital gains tax updated!', flags: 64 });
}

function createMarketCooldownModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_market_cooldown')
    .setTitle('Market Cooldowns')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sell_cooldown')
          .setLabel('Sell Cooldown (minutes)')
          .setPlaceholder('60')
          .setValue(String(settings.sellCooldownMinutes || 60))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('price_impact_delay')
          .setLabel('Price Impact Delay (minutes)')
          .setPlaceholder('120')
          .setValue(String(settings.priceImpactDelayMinutes || 120))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createCapitalGainsTaxModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_market_capital_gains')
    .setTitle('Capital Gains Tax')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('short_term_percent')
          .setLabel('Short-Term Tax %')
          .setPlaceholder('25')
          .setValue(String(settings.shortTermTaxPercent || 0))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('long_term_percent')
          .setLabel('Long-Term Tax %')
          .setPlaceholder('0')
          .setValue(String(settings.longTermTaxPercent || 0))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('short_term_hours')
          .setLabel('Short-Term Threshold (hours)')
          .setPlaceholder('24')
          .setValue(String(settings.shortTermThresholdHours || 24))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== ACTIVITY TIERS PANEL ====================
async function showActivityTiersPanel(interaction, guildId) {
  await interaction.deferUpdate();
  
  const settings = getActivityTierSettings(guildId);
  
  // Calculate example daily contributions
  const example20 = calculateDailyContribution(20, settings).toFixed(2);
  const example50 = calculateDailyContribution(50, settings).toFixed(2);
  const example100 = calculateDailyContribution(100, settings).toFixed(2);
  const example200 = calculateDailyContribution(200, settings).toFixed(2);
  
  // Calculate max possible contribution over window
  const maxDaily = calculateDailyContribution(500, settings);
  const max15Day = (maxDaily * settings.windowDays).toFixed(1);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('📈 Activity Tiers (Diminishing Returns)')
    .setDescription(
      `Control how chat activity affects stock prices. Every message counts, but with diminishing returns per day to prevent spam and reward consistent activity.\n\n` +
      `**Status:** ${settings.enabled ? '✅ Enabled (Diminishing Returns)' : '❌ Disabled (Legacy Flat Rate)'}`
    )
    .addFields(
      { 
        name: '🎯 Current Tiers', 
        value: 
          `**Tier 1** (1-${settings.tier1Threshold}): ${settings.tier1Rate}% per message\n` +
          `**Tier 2** (${settings.tier1Threshold + 1}-${settings.tier2Threshold}): ${settings.tier2Rate}% per message\n` +
          `**Tier 3** (${settings.tier2Threshold + 1}-${settings.tier3Threshold}): ${settings.tier3Rate}% per message\n` +
          `**Tier 4** (${settings.tier3Threshold + 1}+): ${settings.tier4Rate}% per message`,
        inline: false 
      },
      { 
        name: '📊 Example Daily Contributions', 
        value: 
          `20 msgs → +${example20}%\n` +
          `50 msgs → +${example50}%\n` +
          `100 msgs → +${example100}%\n` +
          `200 msgs → +${example200}%`,
        inline: true 
      },
      { 
        name: '⏱️ Settings', 
        value: 
          `**Window:** ${settings.windowDays} days\n` +
          `**Max (15d active):** ~+${max15Day}%`,
        inline: true 
      },
      {
        name: '💡 How It Works',
        value: 
          `• First messages each day are worth the most\n` +
          `• Every message always adds something\n` +
          `• Resets daily - come back tomorrow for full value!\n` +
          `• Messages older than ${settings.windowDays} days fall off`,
        inline: false
      }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('activity_tiers_toggle')
    .setLabel(settings.enabled ? 'Disable (Use Flat Rate)' : 'Enable Diminishing Returns')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('activity_tiers_edit')
    .setLabel('✏️ Edit Tiers')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('activity_tiers_back')
    .setLabel('◀️ Back to Market')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleActivityTiersToggle(interaction, guildId) {
  const settings = getActivityTierSettings(guildId);
  settings.enabled = !settings.enabled;
  updateActivityTierSettings(guildId, settings);
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `${settings.enabled ? 'Enabled' : 'Disabled'} activity tier diminishing returns`);
  
  await showActivityTiersPanel(interaction, guildId);
}

async function handleActivityTiersEdit(interaction, guildId) {
  const settings = getActivityTierSettings(guildId);
  const modal = createActivityTiersModal(settings);
  await interaction.showModal(modal);
}

async function handleActivityTiersModal(interaction, guildId) {
  const tier1Threshold = parseInt(interaction.fields.getTextInputValue('tier1_threshold')) || 20;
  const tier1Rate = parseFloat(interaction.fields.getTextInputValue('tier1_rate')) || 0.15;
  const tier2Threshold = parseInt(interaction.fields.getTextInputValue('tier2_threshold')) || 50;
  const tier2Rate = parseFloat(interaction.fields.getTextInputValue('tier2_rate')) || 0.05;
  const tier3Threshold = parseInt(interaction.fields.getTextInputValue('tier3_threshold')) || 100;
  
  // Validate thresholds are in order
  if (tier2Threshold <= tier1Threshold || tier3Threshold <= tier2Threshold) {
    await interaction.reply({ 
      content: '❌ Tier thresholds must be in ascending order (Tier 1 < Tier 2 < Tier 3).', 
      flags: 64 
    });
    return;
  }
  
  const settings = getActivityTierSettings(guildId);
  settings.tier1Threshold = tier1Threshold;
  settings.tier1Rate = tier1Rate;
  settings.tier2Threshold = tier2Threshold;
  settings.tier2Rate = tier2Rate;
  settings.tier3Threshold = tier3Threshold;
  
  updateActivityTierSettings(guildId, settings);
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `Updated activity tiers: T1=${tier1Threshold}@${tier1Rate}%, T2=${tier2Threshold}@${tier2Rate}%, T3=${tier3Threshold}`);
  
  await interaction.reply({ content: '✅ Activity tiers updated!', flags: 64 });
}

function createActivityTiersModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_activity_tiers')
    .setTitle('Edit Activity Tiers')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier1_threshold')
          .setLabel('Tier 1 Threshold (messages)')
          .setPlaceholder('20')
          .setValue(String(settings.tier1Threshold))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier1_rate')
          .setLabel('Tier 1 Rate (% per message)')
          .setPlaceholder('0.15')
          .setValue(String(settings.tier1Rate))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier2_threshold')
          .setLabel('Tier 2 Threshold (messages)')
          .setPlaceholder('50')
          .setValue(String(settings.tier2Threshold))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier2_rate')
          .setLabel('Tier 2 Rate (% per message)')
          .setPlaceholder('0.05')
          .setValue(String(settings.tier2Rate))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier3_threshold')
          .setLabel('Tier 3 Threshold (messages)')
          .setPlaceholder('100')
          .setValue(String(settings.tier3Threshold))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== TICKER PANEL ====================
async function showTickerPanel(interaction, guildId) {
  const channelId = getTickerChannel();
  const dashSettings = getDashboardSettings();
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📺 Ticker & Dashboard Settings')
    .setDescription('Configure stock alerts and live market dashboard')
    .addFields(
      { name: '📢 Alert Channel', value: channelId ? `<#${channelId}>` : 'Not Set', inline: true },
      { name: '📊 Dashboard Channel', value: dashSettings.dashboardChannelId ? `<#${dashSettings.dashboardChannelId}>` : 'Using Alert Channel', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📊 Dashboard Status', value: dashSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '⏱️ Update Interval', value: `${dashSettings.updateIntervalMinutes} min`, inline: true },
      { name: '📈 Show Chart', value: dashSettings.showChart ? 'Yes' : 'No', inline: true },
      { name: '🔄 Repost Mode', value: dashSettings.deleteAndRepost ? 'Yes (stays at bottom)' : 'No (edits in place)', inline: true },
      { name: '📋 Top Stocks', value: `${dashSettings.topStocksCount}`, inline: true },
      { name: '📊 Top Movers', value: `${dashSettings.topMoversCount}`, inline: true }
    );

  const tickerChannelBtn = new ButtonBuilder()
    .setCustomId('ticker_set_channel')
    .setLabel('📢 Alert Channel')
    .setStyle(ButtonStyle.Primary);

  const dashboardToggleBtn = new ButtonBuilder()
    .setCustomId('dashboard_toggle')
    .setLabel(dashSettings.enabled ? '❌ Disable Dashboard' : '✅ Enable Dashboard')
    .setStyle(dashSettings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const dashboardChannelBtn = new ButtonBuilder()
    .setCustomId('dashboard_set_channel')
    .setLabel('📊 Dashboard Channel')
    .setStyle(ButtonStyle.Primary);

  const dashboardSettingsBtn = new ButtonBuilder()
    .setCustomId('dashboard_edit_settings')
    .setLabel('⚙️ Settings')
    .setStyle(ButtonStyle.Secondary);

  const refreshBtn = new ButtonBuilder()
    .setCustomId('dashboard_refresh')
    .setLabel('🔄 Refresh Now')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(tickerChannelBtn, dashboardChannelBtn, dashboardToggleBtn);
  const row2 = new ActionRowBuilder().addComponents(dashboardSettingsBtn, refreshBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showTickerChannelSelect(interaction, guildId) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📢 Set Ticker Channel')
    .setDescription('Select a channel for stock price alerts');

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('ticker_channel_select')
    .setPlaceholder('Select a channel...')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const selectRow = new ActionRowBuilder().addComponents(channelSelect);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_ticker')
    .setLabel('◀️ Cancel')
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder().addComponents(backBtn);

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function handleTickerChannelSelect(interaction, guildId) {
  const channelId = interaction.values[0];
  
  setTickerChannel(channelId);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set ticker channel to <#${channelId}>`);
  
  await interaction.reply({ content: `✅ Ticker channel set to <#${channelId}>`, flags: 64 });
  await showTickerPanel(interaction, guildId);
}

async function handleTickerEditThreshold(interaction, guildId) {
  // The ticker module uses a constant, so this would require modifying the ticker module
  await interaction.reply({ content: 'ℹ️ Threshold is currently fixed at 10%. To change it, modify PRICE_CHANGE_THRESHOLD in ticker.js', flags: 64 });
}

async function handleTickerToggleWeekly(interaction, guildId) {
  // The ticker module doesn't have a toggle for weekly reports yet
  await interaction.reply({ content: 'ℹ️ Weekly reports are automatically sent every Sunday at noon when a ticker channel is set.', flags: 64 });
}

function createTickerThresholdModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_ticker_threshold')
    .setTitle('Price Alert Threshold')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('threshold')
          .setLabel('Price Change Threshold (%)')
          .setPlaceholder('10')
          .setValue(String(settings?.priceChangeThreshold || 10))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

async function handleTickerThresholdModal(interaction, guildId) {
  await interaction.reply({ content: 'ℹ️ Threshold configuration not yet implemented in ticker module.', flags: 64 });
}

// ==================== DASHBOARD HANDLERS ====================
async function handleDashboardToggle(interaction, guildId) {
  const settings = getDashboardSettings();
  const newEnabled = !settings.enabled;
  
  updateDashboardSettings({ enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} market dashboard`);
  
  await interaction.deferUpdate();
  await showTickerPanel(interaction, guildId);
}

async function handleDashboardEditSettings(interaction, guildId) {
  const settings = getDashboardSettings();
  
  const modal = new ModalBuilder()
    .setCustomId('modal_dashboard_settings')
    .setTitle('Dashboard Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('update_interval')
          .setLabel('Update Interval (minutes)')
          .setPlaceholder('3')
          .setValue(String(settings.updateIntervalMinutes))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('top_stocks_count')
          .setLabel('Top Stocks to Show')
          .setPlaceholder('10')
          .setValue(String(settings.topStocksCount))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('top_movers_count')
          .setLabel('Top Gainers/Losers to Show')
          .setPlaceholder('5')
          .setValue(String(settings.topMoversCount))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('show_chart')
          .setLabel('Show Chart? (yes/no)')
          .setPlaceholder('yes')
          .setValue(settings.showChart ? 'yes' : 'no')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('repost_mode')
          .setLabel('Repost Mode? Stays at bottom (yes/no)')
          .setPlaceholder('yes')
          .setValue(settings.deleteAndRepost ? 'yes' : 'no')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  
  await interaction.showModal(modal);
}

async function handleDashboardSettingsModal(interaction, guildId) {
  const updateInterval = parseInt(interaction.fields.getTextInputValue('update_interval')) || 3;
  const topStocksCount = parseInt(interaction.fields.getTextInputValue('top_stocks_count')) || 10;
  const topMoversCount = parseInt(interaction.fields.getTextInputValue('top_movers_count')) || 5;
  const showChart = interaction.fields.getTextInputValue('show_chart').toLowerCase() === 'yes';
  const deleteAndRepost = interaction.fields.getTextInputValue('repost_mode').toLowerCase() === 'yes';
  
  // Validate
  if (updateInterval < 1 || updateInterval > 60) {
    return interaction.reply({ content: '❌ Update interval must be between 1 and 60 minutes', flags: 64 });
  }
  if (topStocksCount < 1 || topStocksCount > 25) {
    return interaction.reply({ content: '❌ Top stocks count must be between 1 and 25', flags: 64 });
  }
  if (topMoversCount < 1 || topMoversCount > 10) {
    return interaction.reply({ content: '❌ Top movers count must be between 1 and 10', flags: 64 });
  }
  
  updateDashboardSettings({
    updateIntervalMinutes: updateInterval,
    topStocksCount: topStocksCount,
    topMoversCount: topMoversCount,
    showChart: showChart,
    deleteAndRepost: deleteAndRepost
  });
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated dashboard settings: interval=${updateInterval}min, stocks=${topStocksCount}, movers=${topMoversCount}, chart=${showChart}, repost=${deleteAndRepost}`);
  
  await interaction.deferUpdate();
  await showTickerPanel(interaction, guildId);
}

async function showDashboardChannelSelect(interaction, guildId) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Set Dashboard Channel')
    .setDescription('Select a dedicated channel for the live market dashboard.\n\n**Tip:** Use a separate channel from alerts so the dashboard doesn\'t get lost in the scroll!');

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('dashboard_channel_select')
    .setPlaceholder('Select a channel...')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const selectRow = new ActionRowBuilder().addComponents(channelSelect);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_ticker')
    .setLabel('◀️ Cancel')
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder().addComponents(backBtn);

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function handleDashboardChannelSelect(interaction, guildId) {
  try {
    const channelId = interaction.values[0];
    
    setDashboardChannel(channelId);
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set dashboard channel to <#${channelId}>`);
    
    await interaction.deferUpdate();
    await interaction.followUp({ content: `✅ Dashboard channel set to <#${channelId}>. The dashboard will appear there on the next update.`, flags: 64 });
    await showTickerPanel(interaction, guildId);
  } catch (error) {
    console.error('Error setting dashboard channel:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⚠️ Channel saved but had trouble updating the panel. The setting was applied.', flags: 64 });
      }
    } catch (e) { /* Interaction may have timed out */ }
  }
}

async function handleDashboardRefresh(interaction, guildId) {
  try {
    await interaction.deferUpdate();
    await updateDashboard();
    await interaction.followUp({ content: '✅ Dashboard refreshed!', flags: 64 });
  } catch (error) {
    console.error('Error refreshing dashboard:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⚠️ Had trouble refreshing. Please try again.', flags: 64 });
      }
    } catch (e) { /* Interaction may have timed out */ }
  }
}

// ==================== EVENTS PANEL ====================
async function showEventsPanel(interaction, guildId) {
  const settings = getEventSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎉 Market Event Settings')
    .setDescription('Configure random market events that affect all stock prices based on chat activity')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📢 Event Channel', value: settings.channelId ? `<#${settings.channelId}>` : 'Not Set', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💬 Min Messages', value: String(settings.minMessages || 500), inline: true },
      { name: '💬 Max Messages', value: String(settings.maxMessages || 2000), inline: true },
      { name: '⏱️ Duration', value: `${settings.minDurationMinutes || 15}-${settings.maxDurationMinutes || 60} min`, inline: true }
    );

  // Event weights (positive/negative/neutral)
  const weightText = [
    `📈 Positive (Bull Run, etc): ${settings.positiveWeight || 40}%`,
    `📉 Negative (Crash, etc): ${settings.negativeWeight || 40}%`,
    `➖ Neutral (Sideways, etc): ${settings.neutralWeight || 20}%`
  ].join('\n');
  
  embed.addFields({ name: '⚖️ Event Type Weights', value: weightText, inline: false });

  const toggleBtn = new ButtonBuilder()
    .setCustomId('events_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const settingsBtn = new ButtonBuilder()
    .setCustomId('events_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const weightsBtn = new ButtonBuilder()
    .setCustomId('events_edit_weights')
    .setLabel('⚖️ Edit Weights')
    .setStyle(ButtonStyle.Primary);

  const channelBtn = new ButtonBuilder()
    .setCustomId('events_set_channel')
    .setLabel('📢 Set Channel')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(toggleBtn, settingsBtn, weightsBtn, channelBtn, backBtn);

  // Row 2: Force spawn button
  const forceEventBtn = new ButtonBuilder()
    .setCustomId('events_force_spawn')
    .setLabel('⚡ Force Market Event')
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(forceEventBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function handleForceMarketEvent(interaction, guildId) {
  await interaction.deferReply({ flags: 64 });
  
  try {
    const result = await triggerEvent(guildId, 'admin');
    
    if (result && result.event) {
      const { event, affectedStocks, durationMinutes } = result;
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Force spawned market event: ${event.name}`);
      await interaction.editReply({ 
        content: `⚡ **Market Event Triggered!**\n\n**${event.name}**\n${event.description}\n\n📊 Affected ${affectedStocks?.length || 0} stocks\n⏱️ Duration: ${durationMinutes} minutes`
      });
    } else {
      await interaction.editReply({ content: '❌ Failed to trigger event. Check if events channel is set.' });
    }
  } catch (error) {
    console.error('Force event error:', error);
    await interaction.editReply({ content: `❌ Error: ${error.message}` });
  }
}

async function handleEventsToggle(interaction, guildId) {
  const settings = getEventSettings(guildId);
  const newEnabled = !settings.enabled;
  updateEventSettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} events`);
  await interaction.deferUpdate();
  await showEventsPanel(interaction, guildId);
}

async function handleEventsEditSettings(interaction, guildId) {
  const settings = getEventSettings(guildId);
  const modal = createEventsSettingsModal(settings);
  await interaction.showModal(modal);
}

async function handleEventsEditWeights(interaction, guildId) {
  const settings = getEventSettings(guildId);
  const modal = createEventsWeightsModal(settings);
  await interaction.showModal(modal);
}

async function showEventsChannelSelect(interaction, guildId) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📢 Set Events Channel')
    .setDescription('Select a channel for event announcements');

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('events_channel_select')
    .setPlaceholder('Select a channel...')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const selectRow = new ActionRowBuilder().addComponents(channelSelect);

  const backBtn = new ButtonBuilder()
    .setCustomId('events_toggle') // Go back to events panel via toggle (will just refresh)
    .setLabel('◀️ Cancel')
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder().addComponents(backBtn);

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function handleEventsChannelSelect(interaction, guildId) {
  const channelId = interaction.values[0];
  
  updateEventSettings(guildId, { channel_id: channelId });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set events channel to <#${channelId}>`);
  
  await interaction.reply({ content: `✅ Events channel set to <#${channelId}>`, flags: 64 });
  await showEventsPanel(interaction, guildId);
}

async function handleEventsSettingsModal(interaction, guildId) {
  const minMessages = parseInt(interaction.fields.getTextInputValue('min_messages')) || 500;
  const maxMessages = parseInt(interaction.fields.getTextInputValue('max_messages')) || 2000;
  const minDuration = parseInt(interaction.fields.getTextInputValue('min_duration')) || 15;
  const maxDuration = parseInt(interaction.fields.getTextInputValue('max_duration')) || 60;
  
  if (minMessages >= maxMessages) {
    await interaction.reply({ content: '❌ Min messages must be less than max messages.', flags: 64 });
    return;
  }
  if (minDuration >= maxDuration) {
    await interaction.reply({ content: '❌ Min duration must be less than max duration.', flags: 64 });
    return;
  }
  
  updateEventSettings(guildId, { 
    minMessages, 
    maxMessages, 
    minDurationMinutes: minDuration,
    maxDurationMinutes: maxDuration
  });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated event settings: ${minMessages}-${maxMessages} msgs, ${minDuration}-${maxDuration} min`);
  
  await interaction.reply({ content: '✅ Event settings updated!', flags: 64 });
}

async function handleEventsWeightsModal(interaction, guildId) {
  const positiveWeight = parseInt(interaction.fields.getTextInputValue('positive_weight')) || 40;
  const negativeWeight = parseInt(interaction.fields.getTextInputValue('negative_weight')) || 40;
  const neutralWeight = parseInt(interaction.fields.getTextInputValue('neutral_weight')) || 20;
  
  const total = positiveWeight + negativeWeight + neutralWeight;
  if (total !== 100) {
    await interaction.reply({ content: `❌ Weights must total 100%. Current total: ${total}%`, flags: 64 });
    return;
  }
  
  updateEventSettings(guildId, { 
    positiveWeight,
    negativeWeight,
    neutralWeight
  });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated event weights: +${positiveWeight}% -${negativeWeight}% =${neutralWeight}%`);
  
  await interaction.reply({ content: '✅ Event weights updated!', flags: 64 });
}

function createEventsSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_events_settings')
    .setTitle('Event Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_messages')
          .setLabel('Min Messages Before Event')
          .setPlaceholder('100')
          .setValue(String(settings.minMessages || 500))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_messages')
          .setLabel('Max Messages Before Event')
          .setPlaceholder('500')
          .setValue(String(settings.maxMessages || 2000))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_duration')
          .setLabel('Min Event Duration (minutes)')
          .setPlaceholder('15')
          .setValue(String(settings.minDurationMinutes || 15))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_duration')
          .setLabel('Max Event Duration (minutes)')
          .setPlaceholder('60')
          .setValue(String(settings.maxDurationMinutes || 60))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createEventsWeightsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_events_weights')
    .setTitle('Event Weights (must total 100%)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('positive_weight')
          .setLabel('📈 Positive Events % (Bull Run, etc)')
          .setPlaceholder('40')
          .setValue(String(settings.positiveWeight || 40))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('negative_weight')
          .setLabel('📉 Negative Events % (Crash, etc)')
          .setPlaceholder('40')
          .setValue(String(settings.negativeWeight || 40))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('neutral_weight')
          .setLabel('➖ Neutral Events % (Sideways, etc)')
          .setPlaceholder('20')
          .setValue(String(settings.neutralWeight || 20))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== COOLDOWN TRACKER ====================
async function showTrackerPanel(interaction, guildId) {
  const settings = getTrackerSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setTitle('⏱️ Cooldown Tracker Settings')
    .setColor(settings.enabled ? 0x00FF00 : 0xFF0000)
    .addFields(
      { name: 'Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: 'Channel', value: settings.channelId ? `<#${settings.channelId}>` : 'Not set', inline: true },
      { name: 'Update Interval', value: `${settings.updateIntervalSeconds || 30} seconds`, inline: true }
    )
    .setDescription('The cooldown tracker displays a live-updating embed showing who is currently on cooldown for rob and hack.')
    .setFooter({ text: 'Configure the tracker settings below' });
  
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tracker_toggle')
      .setLabel(settings.enabled ? 'Disable Tracker' : 'Enable Tracker')
      .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(settings.enabled ? '🔴' : '🟢'),
    new ButtonBuilder()
      .setCustomId('tracker_edit_settings')
      .setLabel('Edit Settings')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⚙️'),
    new ButtonBuilder()
      .setCustomId('tracker_set_channel')
      .setLabel('Set Channel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📺'),
    new ButtonBuilder()
      .setCustomId('tracker_refresh')
      .setLabel('Refresh Now')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄')
      .setDisabled(!settings.enabled || !settings.channelId),
    new ButtonBuilder()
      .setCustomId('back_dashboard')
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.editReply({ embeds: [embed], components: [row1] });
}

async function showTrackerChannelSelect(interaction, guildId) {
  const channels = interaction.guild.channels.cache
    .filter(c => c.type === 0)
    .map(c => ({
      label: `#${c.name}`,
      value: c.id,
      description: c.parent?.name || 'No category'
    }))
    .slice(0, 25);
  
  if (channels.length === 0) {
    await interaction.reply({ content: '❌ No text channels found.', flags: 64 });
    return;
  }
  
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tracker_channel_select')
      .setPlaceholder('Select a channel for the cooldown tracker')
      .addOptions(channels)
  );
  
  await interaction.reply({ content: 'Select a channel for the cooldown tracker:', components: [selectRow], flags: 64 });
}

async function handleTrackerToggle(interaction, guildId) {
  const settings = getTrackerSettings(guildId);
  const newEnabled = !settings.enabled;
  
  saveTrackerSettings(guildId, { enabled: newEnabled });
  
  if (newEnabled && settings.channelId) {
    startCooldownTracker(guildId);
  } else {
    stopCooldownTracker(guildId);
  }
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} cooldown tracker`);
  await interaction.deferUpdate();
  await showTrackerPanel(interaction, guildId);
}

async function handleTrackerEditSettings(interaction, guildId) {
  const settings = getTrackerSettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_tracker_settings')
    .setTitle('Cooldown Tracker Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('update_interval')
          .setLabel('Update Interval (seconds)')
          .setPlaceholder('30')
          .setValue(String(settings.updateIntervalSeconds || 30))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  
  await interaction.showModal(modal);
}

async function handleTrackerRefresh(interaction, guildId) {
  const settings = getTrackerSettings(guildId);
  
  if (!settings.enabled || !settings.channelId) {
    await interaction.reply({ content: '❌ Tracker must be enabled and have a channel set.', flags: 64 });
    return;
  }
  
  await updateCooldownTracker(guildId);
  await interaction.reply({ content: '✅ Cooldown tracker refreshed!', flags: 64 });
}

async function handleTrackerSettingsModal(interaction, guildId) {
  const updateInterval = parseInt(interaction.fields.getTextInputValue('update_interval')) || 30;
  
  if (updateInterval < 10) {
    await interaction.reply({ content: '❌ Update interval must be at least 10 seconds.', flags: 64 });
    return;
  }
  if (updateInterval > 300) {
    await interaction.reply({ content: '❌ Update interval cannot exceed 300 seconds (5 minutes).', flags: 64 });
    return;
  }
  
  saveTrackerSettings(guildId, { updateIntervalSeconds: updateInterval });
  
  // Restart tracker with new interval if enabled
  const settings = getTrackerSettings(guildId);
  if (settings.enabled && settings.channelId) {
    stopCooldownTracker(guildId);
    startCooldownTracker(guildId);
  }
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated tracker interval to ${updateInterval}s`);
  await interaction.reply({ content: `✅ Tracker update interval set to ${updateInterval} seconds.`, flags: 64 });
}

async function handleTrackerChannelSelect(interaction, guildId) {
  const channelId = interaction.values[0];
  
  saveTrackerSettings(guildId, { channelId: channelId });
  
  // Restart tracker if enabled
  const settings = getTrackerSettings(guildId);
  if (settings.enabled) {
    stopCooldownTracker(guildId);
    startCooldownTracker(guildId);
  }
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set tracker channel to <#${channelId}>`);
  await interaction.update({ content: `✅ Cooldown tracker channel set to <#${channelId}>. Refreshing panel...`, components: [] });
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showAntiSpamPanel,
  showMarketPanel,
  showTickerPanel,
  showEventsPanel,
  showTrackerPanel,
  showActivityTiersPanel,
  createBuyFeeModal,
  createSellFeeModal,
  createAntiSpamModal,
  createMarketCooldownModal,
  createCapitalGainsTaxModal,
  createActivityTiersModal,
  createTickerThresholdModal,
  createEventsSettingsModal,
  createEventsWeightsModal
};
