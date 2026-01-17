// Admin Work Panel - Work, Crime, Slut, Rob settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getWorkSettings, updateWorkSettings } = require('../work');
const { getCrimeSettings, updateCrimeSettings } = require('../crime');
const { getSlutSettings, updateSlutSettings } = require('../slut');
const { getRobSettings, updateRobSettings, getImmuneRoles, addImmuneRole, removeImmuneRole } = require('../rob');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_income_work', 'admin_income_crime', 'admin_income_slut',
  'work_toggle', 'work_edit_settings',
  'crime_toggle', 'crime_edit_settings',
  'slut_toggle', 'slut_edit_settings',
  'rob_toggle', 'rob_edit_settings', 'rob_immunity_settings', 'rob_add_immune_role', 'rob_clear_immune_roles', 'rob_defense_settings',
  'rob_defense_toggle', 'rob_defense_edit', 'back_rob_defense',
  'rob_target_cooldown',
  'back_income', 'back_work' // Back to income panel, back from rob immunity
];

const MODAL_IDS = [
  'modal_work_settings',
  'modal_crime_settings',
  'modal_slut_settings',
  'modal_rob_settings',
  'modal_rob_defense_settings',
  'modal_rob_target_cooldown'
];

const SELECT_IDS = [
  'rob_immunity_role_select'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      // Income panel navigation
      case 'admin_income_work':
        await interaction.deferUpdate();
        await showWorkPanel(interaction, guildId);
        return true;
      case 'admin_income_crime':
        await interaction.deferUpdate();
        await showCrimePanel(interaction, guildId);
        return true;
      case 'admin_income_slut':
        await interaction.deferUpdate();
        await showSlutPanel(interaction, guildId);
        return true;
      case 'back_income':
        await interaction.deferUpdate();
        await showIncomePanel(interaction, guildId);
        return true;
        
      // Work buttons
      case 'work_toggle':
        await handleWorkToggle(interaction, guildId);
        return true;
      case 'work_edit_settings':
        await handleWorkEditSettings(interaction, guildId);
        return true;
        
      // Crime buttons
      case 'crime_toggle':
        await handleCrimeToggle(interaction, guildId);
        return true;
      case 'crime_edit_settings':
        await handleCrimeEditSettings(interaction, guildId);
        return true;
        
      // Slut buttons
      case 'slut_toggle':
        await handleSlutToggle(interaction, guildId);
        return true;
      case 'slut_edit_settings':
        await handleSlutEditSettings(interaction, guildId);
        return true;
        
      // Rob buttons
      case 'rob_toggle':
        await handleRobToggle(interaction, guildId);
        return true;
      case 'rob_edit_settings':
        await handleRobEditSettings(interaction, guildId);
        return true;
      case 'rob_immunity_settings':
        await showRobImmunityPanel(interaction, guildId);
        return true;
      case 'rob_add_immune_role':
        await showRobAddImmunityRole(interaction, guildId);
        return true;
      case 'rob_clear_immune_roles':
        await handleClearImmuneRoles(interaction, guildId);
        return true;
      case 'rob_defense_settings':
        await interaction.deferUpdate();
        await showRobDefensePanel(interaction, guildId);
        return true;
      case 'rob_defense_toggle':
        await handleRobDefenseToggle(interaction, guildId);
        return true;
      case 'rob_defense_edit':
        await handleRobDefenseEdit(interaction, guildId);
        return true;
      case 'back_rob_defense':
        await interaction.deferUpdate();
        await showRobPanel(interaction, guildId);
        return true;
      case 'rob_target_cooldown':
        await showTargetCooldownModal(interaction, guildId);
        return true;
      case 'back_work':
        await showRobPanel(interaction, guildId);
        return true;
    }
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'modal_work_settings':
        await handleWorkSettingsModal(interaction, guildId);
        return true;
      case 'modal_crime_settings':
        await handleCrimeSettingsModal(interaction, guildId);
        return true;
      case 'modal_slut_settings':
        await handleSlutSettingsModal(interaction, guildId);
        return true;
      case 'modal_rob_settings':
        await handleRobSettingsModal(interaction, guildId);
        return true;
      case 'modal_rob_defense_settings':
        await handleRobDefenseSettingsModal(interaction, guildId);
        return true;
      case 'modal_rob_target_cooldown':
        await handleTargetCooldownModal(interaction, guildId);
        return true;
    }
  }
  
  // Handle select menu interactions
  if (interaction.isRoleSelectMenu()) {
    if (!SELECT_IDS.includes(customId)) return false;
    
    if (customId === 'rob_immunity_role_select') {
      await handleRobImmunityRoleSelect(interaction, guildId);
      return true;
    }
  }
  
  return false;
}

// ==================== INCOME PANEL ====================
async function showIncomePanel(interaction, guildId) {
  let workSettings, crimeSettings, slutSettings;
  try { workSettings = getWorkSettings(guildId); } catch { workSettings = { enabled: false }; }
  try { crimeSettings = getCrimeSettings(guildId); } catch { crimeSettings = { enabled: false }; }
  try { slutSettings = getSlutSettings(guildId); } catch { slutSettings = { enabled: false }; }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💵 Income Settings')
    .setDescription('Configure income commands - safe and risky ways to earn money')
    .addFields(
      { name: '💼 Work', value: workSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🔫 Crime', value: crimeSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💋 Slut', value: slutSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true }
    );

  const workBtn = new ButtonBuilder()
    .setCustomId('admin_income_work')
    .setLabel('💼 Work')
    .setStyle(ButtonStyle.Primary);

  const crimeBtn = new ButtonBuilder()
    .setCustomId('admin_income_crime')
    .setLabel('🔫 Crime')
    .setStyle(ButtonStyle.Primary);

  const slutBtn = new ButtonBuilder()
    .setCustomId('admin_income_slut')
    .setLabel('💋 Slut')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(workBtn, crimeBtn, slutBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== WORK PANEL ====================
async function showWorkPanel(interaction, guildId) {
  const settings = getWorkSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💼 Work Settings')
    .setDescription('Configure the /work command rewards and cooldowns')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💵 Min Reward', value: settings.minReward.toLocaleString(), inline: true },
      { name: '💰 Max Reward', value: settings.maxReward.toLocaleString(), inline: true },
      { name: '⏱️ Cooldown', value: `${settings.cooldownHours} hours`, inline: true },
      { name: '📝 Flavor Texts', value: `${settings.flavorTexts?.length || 0} messages`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('work_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('work_edit_settings')
    .setLabel('⚙️ Edit Rewards')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_income')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleWorkToggle(interaction, guildId) {
  const settings = getWorkSettings(guildId);
  const newEnabled = !settings.enabled;
  updateWorkSettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} work command`);
  await interaction.deferUpdate();
  await showWorkPanel(interaction, guildId);
}

async function handleWorkEditSettings(interaction, guildId) {
  const settings = getWorkSettings(guildId);
  const modal = createWorkSettingsModal(settings);
  await interaction.showModal(modal);
}

async function handleWorkSettingsModal(interaction, guildId) {
  const minReward = parseInt(interaction.fields.getTextInputValue('min_reward')) || 50;
  const maxReward = parseInt(interaction.fields.getTextInputValue('max_reward')) || 200;
  const cooldownHours = parseFloat(interaction.fields.getTextInputValue('cooldown_hours')) || 2;
  
  updateWorkSettings(guildId, { minReward, maxReward, cooldownHours });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated work settings: min=${minReward}, max=${maxReward}, cooldown=${cooldownHours}h`);
  
  await interaction.reply({ content: '✅ Work settings updated!', flags: 64 });
  
  // Refresh the panel
  const settings = getWorkSettings(guildId);
  await showWorkPanel(interaction, guildId);
}

function createWorkSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_work_settings')
    .setTitle('Work Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_reward')
          .setLabel('Minimum Reward')
          .setPlaceholder('50')
          .setValue(String(settings.minReward || 50))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_reward')
          .setLabel('Maximum Reward')
          .setPlaceholder('200')
          .setValue(String(settings.maxReward || 200))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown_hours')
          .setLabel('Cooldown (hours)')
          .setPlaceholder('2')
          .setValue(String(settings.cooldownHours || 2))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== CRIME PANEL ====================
async function showCrimePanel(interaction, guildId) {
  let settings;
  try {
    settings = getCrimeSettings(guildId);
  } catch {
    settings = { enabled: false, minReward: 100, maxReward: 500, cooldownHours: 4, successRate: 50, fineMinPercent: 15, fineMaxPercent: 35 };
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🔫 Crime Settings')
    .setDescription('Configure the /crime command (risky income with chance of fines)')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💵 Min Reward', value: (settings.minReward || 100).toLocaleString(), inline: true },
      { name: '💰 Max Reward', value: (settings.maxReward || 500).toLocaleString(), inline: true },
      { name: '⏱️ Cooldown', value: `${settings.cooldownHours || 4} hours`, inline: true },
      { name: '🎯 Success Rate', value: `${settings.successRate || 50}%`, inline: true },
      { name: '💸 Fine Range', value: `${settings.fineMinPercent || 15}% - ${settings.fineMaxPercent || 35}%`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('crime_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('crime_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_income')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleCrimeToggle(interaction, guildId) {
  const settings = getCrimeSettings(guildId);
  const newEnabled = !settings.enabled;
  updateCrimeSettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} crime command`);
  await interaction.deferUpdate();
  await showCrimePanel(interaction, guildId);
}

async function handleCrimeEditSettings(interaction, guildId) {
  const settings = getCrimeSettings(guildId);
  const modal = createCrimeSettingsModal(settings);
  await interaction.showModal(modal);
}

async function handleCrimeSettingsModal(interaction, guildId) {
  const minReward = parseInt(interaction.fields.getTextInputValue('min_reward')) || 100;
  const maxReward = parseInt(interaction.fields.getTextInputValue('max_reward')) || 500;
  const cooldownHours = parseFloat(interaction.fields.getTextInputValue('cooldown_hours')) || 4;
  const successRate = parseInt(interaction.fields.getTextInputValue('success_rate')) || 50;
  
  // Parse fine range (format: "min-max" like "10-30")
  const fineRangeInput = interaction.fields.getTextInputValue('fine_range') || '10-30';
  const [fineMinPercent, fineMaxPercent] = fineRangeInput.split('-').map(s => parseInt(s.trim()));
  
  updateCrimeSettings(guildId, { minReward, maxReward, cooldownHours, successRate, fineMinPercent: fineMinPercent || 10, fineMaxPercent: fineMaxPercent || 30 });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated crime settings`);
  
  await interaction.reply({ content: '✅ Crime settings updated!', flags: 64 });
  await showCrimePanel(interaction, guildId);
}

function createCrimeSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_crime_settings')
    .setTitle('Crime Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_reward')
          .setLabel('Minimum Reward')
          .setPlaceholder('100')
          .setValue(String(settings.minReward || 100))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_reward')
          .setLabel('Maximum Reward')
          .setPlaceholder('500')
          .setValue(String(settings.maxReward || 500))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown_hours')
          .setLabel('Cooldown (hours)')
          .setPlaceholder('4')
          .setValue(String(settings.cooldownHours || 4))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('success_rate')
          .setLabel('Success Rate (%)')
          .setPlaceholder('50')
          .setValue(String(settings.successRate || 50))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fine_range')
          .setLabel('Fine Range (% of balance, min-max)')
          .setPlaceholder('10-30')
          .setValue(`${settings.fineMinPercent || 10}-${settings.fineMaxPercent || 30}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== SLUT PANEL ====================
async function showSlutPanel(interaction, guildId) {
  const settings = getSlutSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💋 Slut Settings')
    .setDescription('Configure the /slut command (adult content - disabled by default)')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💵 Min Reward', value: settings.minReward.toLocaleString(), inline: true },
      { name: '💰 Max Reward', value: settings.maxReward.toLocaleString(), inline: true },
      { name: '⏱️ Cooldown', value: `${settings.cooldownHours} hours`, inline: true },
      { name: '🎯 Success Rate', value: `${settings.successRate}%`, inline: true },
      { name: '💸 Fine Range', value: `${settings.fineMinPercent}% - ${settings.fineMaxPercent}%`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('slut_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('slut_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_income')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleSlutToggle(interaction, guildId) {
  const settings = getSlutSettings(guildId);
  const newEnabled = !settings.enabled;
  updateSlutSettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} slut command`);
  await interaction.deferUpdate();
  await showSlutPanel(interaction, guildId);
}

async function handleSlutEditSettings(interaction, guildId) {
  const settings = getSlutSettings(guildId);
  const modal = createSlutSettingsModal(settings);
  await interaction.showModal(modal);
}

async function handleSlutSettingsModal(interaction, guildId) {
  const minReward = parseInt(interaction.fields.getTextInputValue('min_reward')) || 100;
  const maxReward = parseInt(interaction.fields.getTextInputValue('max_reward')) || 500;
  const cooldownHours = parseFloat(interaction.fields.getTextInputValue('cooldown_hours')) || 2;
  const successRate = parseInt(interaction.fields.getTextInputValue('success_rate')) || 60;
  
  // Parse fine range (format: "min-max" like "10-30")
  const fineRangeInput = interaction.fields.getTextInputValue('fine_range') || '10-30';
  const [fineMinPercent, fineMaxPercent] = fineRangeInput.split('-').map(s => parseInt(s.trim()));
  
  updateSlutSettings(guildId, { minReward, maxReward, cooldownHours, successRate, fineMinPercent: fineMinPercent || 10, fineMaxPercent: fineMaxPercent || 30 });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated slut settings`);
  
  await interaction.reply({ content: '✅ Slut settings updated!', flags: 64 });
  await showSlutPanel(interaction, guildId);
}

function createSlutSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_slut_settings')
    .setTitle('Slut Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_reward')
          .setLabel('Minimum Reward')
          .setPlaceholder('100')
          .setValue(String(settings.minReward || 100))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_reward')
          .setLabel('Maximum Reward')
          .setPlaceholder('500')
          .setValue(String(settings.maxReward || 500))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown_hours')
          .setLabel('Cooldown (hours)')
          .setPlaceholder('2')
          .setValue(String(settings.cooldownHours || 2))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('success_rate')
          .setLabel('Success Rate (%)')
          .setPlaceholder('60')
          .setValue(String(settings.successRate || 60))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fine_range')
          .setLabel('Fine Range (% of balance, min-max)')
          .setPlaceholder('10-30')
          .setValue(`${settings.fineMinPercent || 10}-${settings.fineMaxPercent || 30}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== ROB PANEL ====================
async function showRobPanel(interaction, guildId) {
  const settings = getRobSettings(guildId);
  const immuneRoles = getImmuneRoles(guildId);
  
  // Format target cooldown display
  const targetCooldown = settings.targetCooldownSeconds || 60;
  const targetCooldownStr = targetCooldown >= 60 
    ? `${Math.floor(targetCooldown / 60)}m ${targetCooldown % 60}s`
    : `${targetCooldown}s`;
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🔓 Rob Settings')
    .setDescription('Configure the /rob command for stealing from other players')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💰 Steal Range', value: `${settings.minStealPercent}% - ${settings.maxStealPercent}%`, inline: true },
      { name: '⏱️ Robber Cooldown', value: `${settings.cooldownMinutes} minutes`, inline: true },
      { name: '🎯 Target Protection', value: targetCooldownStr, inline: true },
      { name: '💸 Fine Range', value: `${settings.fineMinPercent}% - ${settings.fineMaxPercent}%`, inline: true },
      { name: '🛡️ Defenses', value: settings.defensesEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🛡️ Immune Roles', value: immuneRoles.length > 0 ? immuneRoles.map(r => `<@&${r}>`).join(', ') : 'None', inline: false }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('rob_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('rob_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const targetCooldownBtn = new ButtonBuilder()
    .setCustomId('rob_target_cooldown')
    .setLabel('🎯 Target Protection')
    .setStyle(ButtonStyle.Primary);

  const defenseBtn = new ButtonBuilder()
    .setCustomId('rob_defense_settings')
    .setLabel('🛡️ Defense Settings')
    .setStyle(ButtonStyle.Primary);

  const immunityBtn = new ButtonBuilder()
    .setCustomId('rob_immunity_settings')
    .setLabel('🛡️ Immunity Roles')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(toggleBtn, editBtn, targetCooldownBtn, defenseBtn);
  const row2 = new ActionRowBuilder().addComponents(immunityBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function handleRobToggle(interaction, guildId) {
  const settings = getRobSettings(guildId);
  const newEnabled = !settings.enabled;
  updateRobSettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} rob command`);
  await interaction.deferUpdate();
  await showRobPanel(interaction, guildId);
}

async function handleRobEditSettings(interaction, guildId) {
  const settings = getRobSettings(guildId);
  const modal = createRobSettingsModal(settings);
  await interaction.showModal(modal);
}

async function handleRobSettingsModal(interaction, guildId) {
  const minStealPercent = parseInt(interaction.fields.getTextInputValue('min_steal_percent')) || 20;
  const maxStealPercent = parseInt(interaction.fields.getTextInputValue('max_steal_percent')) || 80;
  const cooldownMinutes = parseFloat(interaction.fields.getTextInputValue('cooldown_minutes')) || 240;
  const fineMinPercent = parseInt(interaction.fields.getTextInputValue('fine_min_percent')) || 10;
  const fineMaxPercent = parseInt(interaction.fields.getTextInputValue('fine_max_percent')) || 25;
  
  updateRobSettings(guildId, { minStealPercent, maxStealPercent, cooldownMinutes, fineMinPercent, fineMaxPercent });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated rob settings`);
  
  await interaction.reply({ content: '✅ Rob settings updated!', flags: 64 });
  await showRobPanel(interaction, guildId);
}

function createRobSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_rob_settings')
    .setTitle('Rob Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_steal_percent')
          .setLabel('Min Steal % (of target cash)')
          .setPlaceholder('20')
          .setValue(String(settings.minStealPercent || 20))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_steal_percent')
          .setLabel('Max Steal % (of target cash)')
          .setPlaceholder('80')
          .setValue(String(settings.maxStealPercent || 80))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown_minutes')
          .setLabel('Cooldown (minutes)')
          .setPlaceholder('240')
          .setValue(String(settings.cooldownMinutes || 240))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fine_min_percent')
          .setLabel('Min Fine % (on failure)')
          .setPlaceholder('10')
          .setValue(String(settings.fineMinPercent || 10))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fine_max_percent')
          .setLabel('Max Fine % (on failure)')
          .setPlaceholder('25')
          .setValue(String(settings.fineMaxPercent || 25))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== ROB IMMUNITY PANEL ====================
async function showRobImmunityPanel(interaction, guildId) {
  const immuneRoles = getImmuneRoles(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🛡️ Rob Immunity Roles')
    .setDescription('Manage roles that are immune to being robbed')
    .addFields(
      { name: '📋 Current Immune Roles', value: immuneRoles.length > 0 ? immuneRoles.map(r => `<@&${r}>`).join('\n') : 'No immune roles set', inline: false }
    );

  const addBtn = new ButtonBuilder()
    .setCustomId('rob_add_immune_role')
    .setLabel('➕ Add Role')
    .setStyle(ButtonStyle.Success);

  const clearBtn = new ButtonBuilder()
    .setCustomId('rob_clear_immune_roles')
    .setLabel('🗑️ Clear All')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(immuneRoles.length === 0);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_work')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(addBtn, clearBtn, backBtn);

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showRobAddImmunityRole(interaction, guildId) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🛡️ Add Immune Role')
    .setDescription('Select a role to add to the immunity list');

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('rob_immunity_role_select')
    .setPlaceholder('Select a role...')
    .setMinValues(1)
    .setMaxValues(1);

  const selectRow = new ActionRowBuilder().addComponents(roleSelect);

  const backBtn = new ButtonBuilder()
    .setCustomId('rob_immunity_settings')
    .setLabel('◀️ Cancel')
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder().addComponents(backBtn);

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function handleRobImmunityRoleSelect(interaction, guildId) {
  const roleId = interaction.values[0];
  
  const existingRoles = getImmuneRoles(guildId);
  if (existingRoles.includes(roleId)) {
    await interaction.reply({ content: '⚠️ This role is already in the immunity list!', flags: 64 });
    return;
  }
  
  addImmuneRole(guildId, roleId);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Added immune role <@&${roleId}>`);
  
  await interaction.reply({ content: `✅ Added <@&${roleId}> to the immunity list!`, flags: 64 });
  await showRobImmunityPanel(interaction, guildId);
}

async function handleClearImmuneRoles(interaction, guildId) {
  const immuneRoles = getImmuneRoles(guildId);
  
  for (const roleId of immuneRoles) {
    removeImmuneRole(guildId, roleId);
  }
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Cleared all immune roles`);
  
  await interaction.deferUpdate();
  await showRobImmunityPanel(interaction, guildId);
}

// ==================== ROB DEFENSE SETTINGS ====================
async function showRobDefensePanel(interaction, guildId) {
  const settings = getRobSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🛡️ Rob Defense Settings')
    .setDescription('Configure the defense mechanics for /rob')
    .addFields(
      { name: '📊 Status', value: settings.defensesEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🙈 Hide Cash Success', value: `${settings.hidecashSuccessRate}%`, inline: true },
      { name: '💨 Dodge Success', value: `${settings.dodgeSuccessRate}%`, inline: true },
      { name: '🥊 Fight Back Success', value: `${settings.fightBackSuccessRate}%`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('rob_defense_toggle')
    .setLabel(settings.defensesEnabled ? 'Disable' : 'Enable')
    .setStyle(settings.defensesEnabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('rob_defense_edit')
    .setLabel('⚙️ Edit Rates')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_rob_defense')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleRobDefenseToggle(interaction, guildId) {
  const settings = getRobSettings(guildId);
  const newEnabled = !settings.defensesEnabled;
  updateRobSettings(guildId, { defensesEnabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} rob defenses`);
  await interaction.deferUpdate();
  await showRobDefensePanel(interaction, guildId);
}

async function handleRobDefenseEdit(interaction, guildId) {
  const settings = getRobSettings(guildId);
  const modal = createRobDefenseSettingsModal(settings);
  await interaction.showModal(modal);
}

async function handleRobDefenseSettingsModal(interaction, guildId) {
  const hidecashRate = parseInt(interaction.fields.getTextInputValue('hidecash_rate')) || 70;
  const dodgeRate = parseInt(interaction.fields.getTextInputValue('dodge_rate')) || 60;
  const fightBackRate = parseInt(interaction.fields.getTextInputValue('fightback_rate')) || 50;
  
  // Validate rates are between 0-100
  const validatedRates = {
    hidecashSuccessRate: Math.max(0, Math.min(100, hidecashRate)),
    dodgeSuccessRate: Math.max(0, Math.min(100, dodgeRate)),
    fightBackSuccessRate: Math.max(0, Math.min(100, fightBackRate))
  };
  
  updateRobSettings(guildId, validatedRates);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated rob defense success rates`);
  
  await interaction.reply({ content: '✅ Rob defense rates updated!', flags: 64 });
  await showRobDefensePanel(interaction, guildId);
}

function createRobDefenseSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_rob_defense_settings')
    .setTitle('Defense Success Rates (%)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('hidecash_rate')
          .setLabel('Hide Cash Success %')
          .setPlaceholder('70')
          .setValue(String(settings.hidecashSuccessRate || 70))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dodge_rate')
          .setLabel('Dodge Success %')
          .setPlaceholder('60')
          .setValue(String(settings.dodgeSuccessRate || 60))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fightback_rate')
          .setLabel('Fight Back Success %')
          .setPlaceholder('50')
          .setValue(String(settings.fightBackSuccessRate || 50))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== TARGET COOLDOWN FUNCTIONS ====================
async function showTargetCooldownModal(interaction, guildId) {
  const settings = getRobSettings(guildId);
  const modal = new ModalBuilder()
    .setCustomId('modal_rob_target_cooldown')
    .setTitle('Target Protection Cooldown')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_cooldown')
          .setLabel('Target Protection (seconds)')
          .setPlaceholder('60')
          .setValue(String(settings.targetCooldownSeconds || 60))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function handleTargetCooldownModal(interaction, guildId) {
  const cooldownSeconds = parseInt(interaction.fields.getTextInputValue('target_cooldown')) || 60;
  
  // Validate: minimum 0 (no protection), maximum 3600 (1 hour)
  const validatedCooldown = Math.max(0, Math.min(3600, cooldownSeconds));
  
  updateRobSettings(guildId, { targetCooldownSeconds: validatedCooldown });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated rob target protection to ${validatedCooldown} seconds`);
  
  await interaction.reply({ content: `✅ Target protection updated to ${validatedCooldown} seconds!`, flags: 64 });
  await showRobPanel(interaction, guildId);
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showIncomePanel,
  showWorkPanel,
  showCrimePanel,
  showSlutPanel,
  showRobPanel,
  createWorkSettingsModal,
  createCrimeSettingsModal,
  createSlutSettingsModal,
  createRobSettingsModal
};
