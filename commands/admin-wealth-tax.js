// Admin Wealth Tax Panel - Wealth Tax settings (Fully Modular)
const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { getWealthTaxSettings, updateWealthTaxSettings, previewWealthTaxCollection, getDayName } = require('../wealth-tax');
const { getLotteryInfo } = require('../gambling');
const { logAdminAction } = require('../admin');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'wealth_tax_toggle', 'wealth_tax_schedule', 'wealth_tax_channel', 'wealth_tax_tiers', 'wealth_tax_preview',
  'wealth_tax_reset_tiers', 'wealth_tax_back', 'wealth_tax_last_collection'
];

// Dynamic button IDs (start with these prefixes)
const BUTTON_PREFIXES = [
  'wealth_tax_edit_tier_', 'wealth_tax_remove_tier_'
];

const MODAL_IDS = [
  'wealth_tax_schedule_modal', 'wealth_tax_channel_modal', 'wealth_tax_add_tier_modal'
];

// Dynamic modal IDs
const MODAL_PREFIXES = [
  'wealth_tax_tier_modal_'
];

const SELECT_IDS = [
  'wealth_tax_tier_select'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  console.log('[Wealth Tax] handleInteraction called with:', customId, 'isButton:', interaction.isButton());
  
  // Handle button interactions
  if (interaction.isButton()) {
    // Check static button IDs
    if (BUTTON_IDS.includes(customId)) {
      console.log('[Wealth Tax] Button ID matched in BUTTON_IDS');
      return await handleButton(interaction, guildId, customId);
    }
    // Check dynamic button IDs (prefixes)
    for (const prefix of BUTTON_PREFIXES) {
      if (customId.startsWith(prefix)) {
        return await handleButton(interaction, guildId, customId);
      }
    }
    return false;
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    // Check static modal IDs
    if (MODAL_IDS.includes(customId)) {
      return await handleModal(interaction, guildId, customId);
    }
    // Check dynamic modal IDs (prefixes)
    for (const prefix of MODAL_PREFIXES) {
      if (customId.startsWith(prefix)) {
        return await handleModal(interaction, guildId, customId);
      }
    }
    return false;
  }
  
  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
    if (SELECT_IDS.includes(customId)) {
      return await handleSelect(interaction, guildId, customId);
    }
    return false;
  }
  
  return false;
}

async function handleButton(interaction, guildId, customId) {
  console.log('[Wealth Tax] Button clicked:', customId);
  switch (customId) {
    case 'wealth_tax_toggle':
      await handleWealthTaxToggle(interaction, guildId);
      return true;
    case 'wealth_tax_schedule':
      await showWealthTaxScheduleModal(interaction, guildId);
      return true;
    case 'wealth_tax_channel':
      console.log('[Wealth Tax] Showing channel modal');
      await showWealthTaxChannelModal(interaction, guildId);
      console.log('[Wealth Tax] Channel modal shown successfully');
      return true;
    case 'wealth_tax_tiers':
      await interaction.deferUpdate();
      await showWealthTaxTiersPanel(interaction, guildId);
      return true;
    case 'wealth_tax_preview':
      await interaction.deferUpdate();
      await showWealthTaxPreviewPanel(interaction, guildId);
      return true;
    case 'wealth_tax_reset_tiers':
      await handleResetTiers(interaction, guildId);
      return true;
    case 'wealth_tax_back':
      await interaction.deferUpdate();
      await showWealthTaxPanel(interaction, guildId, true);
      return true;
    case 'wealth_tax_add_tier':
      await showWealthTaxAddTierModal(interaction, guildId);
      return true;
    case 'wealth_tax_last_collection':
      await interaction.deferUpdate();
      await showLastCollectionPanel(interaction, guildId);
      return true;
  }
  
  // Handle dynamic button IDs
  if (customId.startsWith('wealth_tax_edit_tier_')) {
    const tierIndex = parseInt(customId.replace('wealth_tax_edit_tier_', ''));
    await showWealthTaxEditTierModal(interaction, guildId, tierIndex);
    return true;
  }
  
  if (customId.startsWith('wealth_tax_remove_tier_')) {
    const tierIndex = parseInt(customId.replace('wealth_tax_remove_tier_', ''));
    await handleRemoveTier(interaction, guildId, tierIndex);
    return true;
  }
  
  return false;
}

async function handleModal(interaction, guildId, customId) {
  if (customId === 'wealth_tax_schedule_modal') {
    await handleScheduleModal(interaction, guildId);
    return true;
  }
  
  if (customId === 'wealth_tax_channel_modal') {
    await handleChannelModal(interaction, guildId);
    return true;
  }
  
  if (customId === 'wealth_tax_add_tier_modal') {
    await handleAddTierModal(interaction, guildId);
    return true;
  }
  
  if (customId.startsWith('wealth_tax_tier_modal_')) {
    const tierIndex = parseInt(customId.replace('wealth_tax_tier_modal_', ''));
    await handleEditTierModal(interaction, guildId, tierIndex);
    return true;
  }
  
  return false;
}

async function handleSelect(interaction, guildId, customId) {
  if (customId === 'wealth_tax_tier_select') {
    const selectedTier = parseInt(interaction.values[0]);
    await interaction.deferUpdate();
    await showWealthTaxTiersPanel(interaction, guildId, selectedTier);
    return true;
  }
  
  return false;
}

// ==================== WEALTH TAX PANEL ====================
async function showWealthTaxPanel(interaction, guildId, useEditReply = false) {
  const settings = getWealthTaxSettings(guildId);
  const preview = previewWealthTaxCollection(guildId);
  const lotteryInfo = getLotteryInfo(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🏛️ Wealth Tax Settings')
    .setDescription(settings.enabled ? '✅ **Wealth Tax is ENABLED**' : '❌ **Wealth Tax is DISABLED**')
    .addFields(
      { name: '📅 Collection Day', value: getDayName(settings.collectionDay), inline: true },
      { name: '🕐 Collection Hour', value: `${settings.collectionHour}:00`, inline: true },
      { name: '📢 Announcement Channel', value: settings.announcementChannelId ? `<#${settings.announcementChannelId}>` : 'Not set', inline: true }
    );
  
  // Show tier configuration
  let tierText = '';
  for (let i = 0; i < settings.tiers.length; i++) {
    const tier = settings.tiers[i];
    const nextTier = settings.tiers[i + 1];
    const rangeEnd = nextTier ? (nextTier.threshold - 1).toLocaleString() : '∞';
    tierText += `**Tier ${i + 1}:** ${tier.threshold.toLocaleString()} - ${rangeEnd} → ${tier.rate}%\n`;
  }
  embed.addFields({ name: '📊 Tax Tiers', value: tierText || 'Default tiers', inline: false });
  
  // Show collection preview
  embed.addFields(
    { name: '👥 Taxable Users', value: `${preview.taxableUsers} / ${preview.totalUsers}`, inline: true },
    { name: '💰 Projected Collection', value: `${preview.totalTax.toLocaleString()} ${CURRENCY}`, inline: true },
    { name: '🎰 Projected Jackpot', value: `${preview.projectedJackpot.toLocaleString()} ${CURRENCY}`, inline: true }
  );
  
  // Show last collection info
  if (settings.lastCollection) {
    const lastDate = new Date(settings.lastCollection);
    embed.addFields({
      name: '📜 Last Collection',
      value: `${lastDate.toLocaleDateString()} ${lastDate.toLocaleTimeString()} - **${settings.lastCollectionAmount.toLocaleString()}** ${CURRENCY}`,
      inline: false
    });
  }
  
  // Row 1: Enable/Disable + Schedule
  const toggleBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_toggle')
    .setLabel(settings.enabled ? 'Disable Tax' : 'Enable Tax')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);
  
  const scheduleBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_schedule')
    .setLabel('📅 Set Schedule')
    .setStyle(ButtonStyle.Primary);
  
  const channelBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_channel')
    .setLabel('📢 Set Channel')
    .setStyle(ButtonStyle.Primary);
  
  const tiersBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_tiers')
    .setLabel('📊 Edit Tiers')
    .setStyle(ButtonStyle.Primary);
  
  const previewBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_preview')
    .setLabel('👁️ Preview')
    .setStyle(ButtonStyle.Secondary);
  
  const resetTiersBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_reset_tiers')
    .setLabel('🔄 Reset Tiers')
    .setStyle(ButtonStyle.Secondary);
  
  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);
  
  const lastCollectionBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_last_collection')
    .setLabel('📜 Last Collection')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!settings.lastCollection);
  
  const row1 = new ActionRowBuilder().addComponents(toggleBtn, scheduleBtn, channelBtn, tiersBtn);
  
  // Row 2: Preview + Last Collection + Reset Tiers + Back
  const row2 = new ActionRowBuilder().addComponents(previewBtn, lastCollectionBtn, resetTiersBtn, backBtn);
  
  console.log('[Wealth Tax Panel] Row1 button IDs:', row1.components.map(c => c.data.custom_id));
  console.log('[Wealth Tax Panel] Row2 button IDs:', row2.components.map(c => c.data.custom_id));
  
  if (useEditReply) {
    await interaction.editReply({ embeds: [embed], components: [row1, row2] });
  } else {
    await interaction.update({ embeds: [embed], components: [row1, row2] });
  }
}

async function handleWealthTaxToggle(interaction, guildId) {
  const settings = getWealthTaxSettings(guildId);
  const newEnabled = !settings.enabled;
  updateWealthTaxSettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} wealth tax`);
  await interaction.deferUpdate();
  await showWealthTaxPanel(interaction, guildId, true);
}

async function handleResetTiers(interaction, guildId) {
  const defaultTiers = [
    { threshold: 0, rate: 0 },
    { threshold: 100000, rate: 0.5 },
    { threshold: 500000, rate: 1 },
    { threshold: 1000000, rate: 2 },
    { threshold: 5000000, rate: 3 }
  ];
  updateWealthTaxSettings(guildId, { tiers: defaultTiers });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Reset wealth tax tiers to defaults`);
  await interaction.deferUpdate();
  await showWealthTaxPanel(interaction, guildId, true);
}

// ==================== SCHEDULE MODAL ====================
async function showWealthTaxScheduleModal(interaction, guildId) {
  const settings = getWealthTaxSettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('wealth_tax_schedule_modal')
    .setTitle('Set Wealth Tax Collection Schedule');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('collection_day')
        .setLabel('Collection Day (0=Sun, 1=Mon, ..., 6=Sat)')
        .setPlaceholder('0')
        .setValue(String(settings.collectionDay))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(1)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('collection_hour')
        .setLabel('Collection Hour (0-23)')
        .setPlaceholder('12')
        .setValue(String(settings.collectionHour))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2)
    )
  );
  
  await interaction.showModal(modal);
}

async function handleScheduleModal(interaction, guildId) {
  const day = parseInt(interaction.fields.getTextInputValue('collection_day'));
  const hour = parseInt(interaction.fields.getTextInputValue('collection_hour'));
  
  if (isNaN(day) || day < 0 || day > 6 || isNaN(hour) || hour < 0 || hour > 23) {
    await interaction.reply({ content: '❌ Invalid day (0-6) or hour (0-23).', flags: 64 });
    return;
  }
  
  updateWealthTaxSettings(guildId, { collectionDay: day, collectionHour: hour });
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set wealth tax collection to ${dayNames[day]} at ${hour}:00`);
  await interaction.reply({ content: `✅ Wealth tax collection set to ${dayNames[day]} at ${hour}:00`, flags: 64 });
  await showWealthTaxPanel(interaction, guildId, true);
}

async function showWealthTaxChannelModal(interaction, guildId) {
  try {
    const settings = getWealthTaxSettings(guildId);
    
    const modal = new ModalBuilder()
      .setCustomId('wealth_tax_channel_modal')
      .setTitle('Set Wealth Tax Announcement Channel');
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('channel_id')
          .setLabel('Channel ID')
          .setPlaceholder('Paste the channel ID here')
          .setValue(settings.announcementChannelId ? String(settings.announcementChannelId) : '')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
    
    await interaction.showModal(modal);
  } catch (error) {
    console.error('Error in showWealthTaxChannelModal:', error);
    throw error;
  }
}

async function handleChannelModal(interaction, guildId) {
  const channelId = interaction.fields.getTextInputValue('channel_id').trim();
  
  if (channelId === '') {
    updateWealthTaxSettings(guildId, { announcementChannelId: null });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Disabled wealth tax announcements');
    await interaction.reply({ content: '✅ Wealth tax announcements disabled', flags: 64 });
    await showWealthTaxPanel(interaction, guildId, true);
    return;
  }
  
  // Validate channel exists
  try {
    const channel = await interaction.guild.channels.fetch(channelId);
    if (!channel) {
      await interaction.reply({ content: '❌ Channel not found', flags: 64 });
      return;
    }
    
    updateWealthTaxSettings(guildId, { announcementChannelId: channelId });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set wealth tax announcements to <#${channelId}>`);
    await interaction.reply({ content: `✅ Wealth tax announcements will be sent to <#${channelId}>`, flags: 64 });
    await showWealthTaxPanel(interaction, guildId, true);
  } catch (e) {
    console.error('Error setting wealth tax channel:', e);
    await interaction.reply({ content: '❌ Invalid channel ID or failed to verify channel', flags: 64 });
  }
}

// ==================== TIERS PANEL ====================
async function showWealthTaxTiersPanel(interaction, guildId, selectedTier = null) {
  const settings = getWealthTaxSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('📊 Wealth Tax Tiers')
    .setDescription('Configure progressive tax brackets. Higher wealth = higher tax rate.');
  
  // Show current tiers
  let tierText = '';
  for (let i = 0; i < settings.tiers.length; i++) {
    const tier = settings.tiers[i];
    const nextTier = settings.tiers[i + 1];
    const rangeEnd = nextTier ? (nextTier.threshold - 1).toLocaleString() : '∞';
    const isSelected = selectedTier === i;
    tierText += `${isSelected ? '➡️ ' : ''}**Tier ${i + 1}:** ${tier.threshold.toLocaleString()} - ${rangeEnd} → **${tier.rate}%**\n`;
  }
  embed.addFields({ name: 'Current Tiers', value: tierText || 'No tiers configured' });
  
  if (selectedTier !== null && selectedTier < settings.tiers.length) {
    const tier = settings.tiers[selectedTier];
    embed.addFields({
      name: `Editing Tier ${selectedTier + 1}`,
      value: `Threshold: ${tier.threshold.toLocaleString()}\nRate: ${tier.rate}%`,
      inline: false
    });
  }
  
  embed.setFooter({ text: 'Select a tier to edit, or add/remove tiers' });
  
  // Tier selection menu
  const tierOptions = settings.tiers.map((tier, i) => ({
    label: `Tier ${i + 1}: ${tier.threshold.toLocaleString()} (${tier.rate}%)`,
    value: String(i),
    default: selectedTier === i
  }));
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('wealth_tax_tier_select')
    .setPlaceholder('Select a tier to edit...')
    .addOptions(tierOptions);
  
  const row1 = new ActionRowBuilder().addComponents(selectMenu);
  
  // Edit/Add/Remove buttons
  const editBtn = new ButtonBuilder()
    .setCustomId(`wealth_tax_edit_tier_${selectedTier ?? 0}`)
    .setLabel('✏️ Edit Tier')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(selectedTier === null);
  
  const addBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_add_tier')
    .setLabel('➕ Add Tier')
    .setStyle(ButtonStyle.Success)
    .setDisabled(settings.tiers.length >= 6);
  
  const removeBtn = new ButtonBuilder()
    .setCustomId(`wealth_tax_remove_tier_${selectedTier ?? 0}`)
    .setLabel('🗑️ Remove Tier')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(selectedTier === null || settings.tiers.length <= 1);
  
  const backBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_back')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);
  
  const row2 = new ActionRowBuilder().addComponents(editBtn, addBtn, removeBtn, backBtn);
  
  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showWealthTaxEditTierModal(interaction, guildId, tierIndex) {
  const settings = getWealthTaxSettings(guildId);
  const tier = settings.tiers[tierIndex] || { threshold: 0, rate: 0 };
  
  const modal = new ModalBuilder()
    .setCustomId(`wealth_tax_tier_modal_${tierIndex}`)
    .setTitle(`Edit Tax Tier ${tierIndex + 1}`);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tier_threshold')
        .setLabel('Wealth Threshold (minimum for this tier)')
        .setPlaceholder('100000')
        .setValue(String(tier.threshold))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tier_rate')
        .setLabel('Tax Rate (percentage)')
        .setPlaceholder('0.5')
        .setValue(String(tier.rate))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );
  
  await interaction.showModal(modal);
}

async function handleEditTierModal(interaction, guildId, tierIndex) {
  const threshold = parseInt(interaction.fields.getTextInputValue('tier_threshold'));
  const rate = parseFloat(interaction.fields.getTextInputValue('tier_rate'));
  
  if (isNaN(threshold) || threshold < 0 || isNaN(rate) || rate < 0) {
    await interaction.reply({ content: '❌ Invalid threshold or rate values.', flags: 64 });
    return;
  }
  
  const settings = getWealthTaxSettings(guildId);
  settings.tiers[tierIndex] = { threshold, rate };
  settings.tiers.sort((a, b) => a.threshold - b.threshold);
  updateWealthTaxSettings(guildId, { tiers: settings.tiers });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Edited wealth tax tier ${tierIndex + 1}`);
  await interaction.reply({ content: `✅ Tier ${tierIndex + 1} updated!`, flags: 64 });
  await showWealthTaxTiersPanel(interaction, guildId, null);
}

async function showWealthTaxAddTierModal(interaction, guildId) {
  const modal = new ModalBuilder()
    .setCustomId('wealth_tax_add_tier_modal')
    .setTitle('Add New Tax Tier');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tier_threshold')
        .setLabel('Wealth Threshold (minimum for this tier)')
        .setPlaceholder('1000000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tier_rate')
        .setLabel('Tax Rate (percentage)')
        .setPlaceholder('2.0')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );
  
  await interaction.showModal(modal);
}

async function handleAddTierModal(interaction, guildId) {
  const threshold = parseInt(interaction.fields.getTextInputValue('tier_threshold'));
  const rate = parseFloat(interaction.fields.getTextInputValue('tier_rate'));
  
  if (isNaN(threshold) || threshold < 0 || isNaN(rate) || rate < 0) {
    await interaction.reply({ content: '❌ Invalid threshold or rate values.', flags: 64 });
    return;
  }
  
  const settings = getWealthTaxSettings(guildId);
  settings.tiers.push({ threshold, rate });
  settings.tiers.sort((a, b) => a.threshold - b.threshold);
  updateWealthTaxSettings(guildId, { tiers: settings.tiers });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Added wealth tax tier`);
  await interaction.reply({ content: `✅ New tier added!`, flags: 64 });
  await showWealthTaxTiersPanel(interaction, guildId, null);
}

async function handleRemoveTier(interaction, guildId, tierIndex) {
  const settings = getWealthTaxSettings(guildId);
  
  if (settings.tiers.length <= 1) {
    await interaction.reply({ content: '❌ Cannot remove the last tier.', flags: 64 });
    return;
  }
  
  settings.tiers.splice(tierIndex, 1);
  updateWealthTaxSettings(guildId, { tiers: settings.tiers });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Removed wealth tax tier ${tierIndex + 1}`);
  await interaction.deferUpdate();
  await showWealthTaxTiersPanel(interaction, guildId, null);
}

// ==================== PREVIEW PANEL ====================
async function showWealthTaxPreviewPanel(interaction, guildId) {
  const settings = getWealthTaxSettings(guildId);
  const preview = previewWealthTaxCollection(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('👁️ Wealth Tax Collection Preview')
    .setDescription('Preview of what would be collected if tax ran now.')
    .addFields(
      { name: '👥 Users to Tax', value: `${preview.taxableUsers} / ${preview.totalUsers}`, inline: true },
      { name: '💰 Total to Collect', value: `${preview.totalTax.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '🎰 Current Jackpot', value: `${preview.currentJackpot.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '🎰 After Collection', value: `${preview.projectedJackpot.toLocaleString()} ${CURRENCY}`, inline: false }
    );
  
  // Show top taxpayers - split into chunks to avoid 1024 char limit
  if (preview.users && preview.users.length > 0) {
    const topUsers = preview.users.slice(0, 10);
    let topText = '';
    let fieldCount = 0;
    
    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const userLine = `${medal} <@${user.userId}>: **${user.tax.toLocaleString()}** ${CURRENCY}\n   Wealth: ${user.wealth.total.toLocaleString()} (💵${user.wealth.cash.toLocaleString()} + 📈${user.wealth.stocks.toLocaleString()} + 🏠${user.wealth.properties.toLocaleString()})\n`;
      
      // If adding this user would exceed limit, start a new field
      if ((topText + userLine).length > 900) {
        const fieldName = fieldCount === 0 ? '🏆 Top Taxpayers' : `🏆 Top Taxpayers (cont.)`;
        embed.addFields({ name: fieldName, value: topText });
        topText = userLine;
        fieldCount++;
      } else {
        topText += userLine;
      }
    }
    
    // Add remaining text
    if (topText) {
      const fieldName = fieldCount === 0 ? '🏆 Top Taxpayers' : `🏆 Top Taxpayers (cont.)`;
      embed.addFields({ name: fieldName, value: topText });
    }
  } else {
    embed.addFields({ name: 'ℹ️ No Taxpayers', value: 'No users meet the wealth threshold for taxation.' });
  }
  
  const backBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_back')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);
  
  const row = new ActionRowBuilder().addComponents(backBtn);
  
  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== LAST COLLECTION PANEL ====================
async function showLastCollectionPanel(interaction, guildId) {
  const settings = getWealthTaxSettings(guildId);
  
  if (!settings.lastCollection || !settings.lastCollectionDetails) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('📜 Last Wealth Tax Collection')
      .setDescription('No wealth tax has been collected yet.');
    
    const backBtn = new ButtonBuilder()
      .setCustomId('wealth_tax_back')
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder().addComponents(backBtn);
    await interaction.editReply({ embeds: [embed], components: [row] });
    return;
  }
  
  const lastDate = new Date(settings.lastCollection);
  const details = settings.lastCollectionDetails;
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('📜 Last Wealth Tax Collection')
    .setDescription(`Collection ran on ${lastDate.toLocaleDateString()} at ${lastDate.toLocaleTimeString()}`)
    .addFields(
      { name: '💰 Total Collected', value: `${settings.lastCollectionAmount.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '👥 Users Taxed', value: `${details.usersAffected} / ${details.totalUsers}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );
  
  // Show top taxpayers
  if (details.topPayers && details.topPayers.length > 0) {
    const topText = details.topPayers.map((p, i) => 
      `${i + 1}. <@${p.userId}>: ${p.amount.toLocaleString()} ${CURRENCY}`
    ).join('\n');
    embed.addFields({ name: '🏆 Top Taxpayers', value: topText });
  }
  
  // Check for forced liquidations in the full collections data stored separately
  // Since lastCollectionDetails doesn't store liquidation info, we need to query it
  const { getDb } = require('../wealth-tax');
  const db = getDb();
  
  // Get users who might have had liquidations (those with high tax relative to cash)
  const result = db.exec(`
    SELECT user_id, total_wealth, cash_wealth, stock_wealth, tax_amount, collection_time
    FROM wealth_tax_history 
    WHERE guild_id = ? AND collection_time = ?
    ORDER BY tax_amount DESC
  `, [guildId, settings.lastCollection]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const rows = result[0].values;
    const cols = result[0].columns;
    
    let liquidationUsers = [];
    for (const row of rows) {
      const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
      
      // If tax amount was greater than cash wealth, they likely had liquidations
      if (data.tax_amount > data.cash_wealth) {
        liquidationUsers.push({
          userId: data.user_id,
          taxAmount: data.tax_amount,
          cashWealth: data.cash_wealth,
          stockWealth: data.stock_wealth,
          deficit: data.tax_amount - data.cash_wealth
        });
      }
    }
    
    if (liquidationUsers.length > 0) {
      const liquidationText = liquidationUsers.map(u => 
        `<@${u.userId}>: Owed ${u.taxAmount.toLocaleString()} ${CURRENCY}, had ${u.cashWealth.toLocaleString()} ${CURRENCY} cash\n` +
        `└─ Deficit: ${u.deficit.toLocaleString()} ${CURRENCY} (likely liquidated stocks)`
      ).join('\n\n');
      
      embed.addFields({ 
        name: '📉 Likely Forced Liquidations', 
        value: liquidationText.length > 1024 ? liquidationText.substring(0, 1021) + '...' : liquidationText
      });
    } else {
      embed.addFields({ name: '✅ No Forced Liquidations', value: 'All users had sufficient cash/bank balance to pay their taxes.' });
    }
  }
  
  const backBtn = new ButtonBuilder()
    .setCustomId('wealth_tax_back')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);
  
  const row = new ActionRowBuilder().addComponents(backBtn);
  
  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showWealthTaxPanel,
  showWealthTaxScheduleModal,
  showWealthTaxTiersPanel,
  showWealthTaxEditTierModal,
  showWealthTaxAddTierModal,
  showWealthTaxPreviewPanel
};
