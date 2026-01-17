// Admin Hack Panel - Hack settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getHackSettings, updateHackSettings, getHackImmuneRoles, addHackImmuneRole, clearHackImmuneRoles } = require('../hack');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_hack',
  'hack_toggle', 'hack_edit_settings', 'hack_immunity_settings',
  'hack_add_immune_role', 'hack_clear_immune_roles',
  'back_hack'
];

const MODAL_IDS = [
  'modal_hack_settings'
];

const SELECT_IDS = [
  'hack_immunity_role_select'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'admin_hack':
        await interaction.deferUpdate();
        await showHackPanel(interaction, guildId);
        return true;
      case 'hack_toggle':
        await interaction.deferUpdate();
        await handleHackToggle(interaction, guildId);
        return true;
      case 'hack_edit_settings':
        await handleHackEditSettings(interaction, guildId);
        return true;
      case 'hack_immunity_settings':
        await interaction.deferUpdate();
        await showHackImmunityPanel(interaction, guildId);
        return true;
      case 'hack_add_immune_role':
        await interaction.deferUpdate();
        await showHackAddImmunityRole(interaction, guildId);
        return true;
      case 'hack_clear_immune_roles':
        await interaction.deferUpdate();
        await handleClearImmuneRoles(interaction, guildId);
        return true;
      case 'back_hack':
        await interaction.deferUpdate();
        await showHackPanel(interaction, guildId);
        return true;
    }
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'modal_hack_settings':
        await handleHackSettingsModal(interaction, guildId);
        return true;
    }
  }
  
  // Handle select menu interactions
  if (interaction.isRoleSelectMenu()) {
    if (!SELECT_IDS.includes(customId)) return false;
    
    if (customId === 'hack_immunity_role_select') {
      await handleHackImmunityRoleSelect(interaction, guildId);
      return true;
    }
  }
  
  return false;
}

// ==================== HACK PANEL ====================
async function showHackPanel(interaction, guildId) {
  const settings = getHackSettings(guildId);
  const immuneRoles = getHackImmuneRoles(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('💻 Hack Settings')
    .setDescription('Configure the /hack command - allows players to hack each other\'s bank accounts')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '⏱️ Hacker Cooldown', value: `${settings.hackerCooldownMinutes} minutes`, inline: true },
      { name: '🎯 Target Cooldown', value: `${settings.targetCooldownMinutes} minutes (${(settings.targetCooldownMinutes / 60).toFixed(1)} hours)`, inline: true },
      { name: '💰 Steal Range', value: `${settings.minStealPercent}% - ${settings.maxStealPercent}%`, inline: true },
      { name: '💸 Fine Range', value: `${settings.minFinePercent}% - ${settings.maxFinePercent}% of potential steal`, inline: true },
      { name: '🛡️ Immune Roles', value: immuneRoles.length > 0 ? immuneRoles.map(r => `<@&${r}>`).join(', ') : 'None', inline: false }
    )
    .setFooter({ text: 'Hack targets bank balances with a progress-based defense system' });

  const toggleBtn = new ButtonBuilder()
    .setCustomId('hack_toggle')
    .setLabel(settings.enabled ? 'Disable Hacking' : 'Enable Hacking')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(settings.enabled ? '🔴' : '🟢');

  const editBtn = new ButtonBuilder()
    .setCustomId('hack_edit_settings')
    .setLabel('Edit Settings')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('⚙️');

  const immunityBtn = new ButtonBuilder()
    .setCustomId('hack_immunity_settings')
    .setLabel('Immunity Settings')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🛡️');

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('Back to Dashboard')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row1 = new ActionRowBuilder().addComponents(toggleBtn, editBtn, immunityBtn);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== TOGGLE ====================
async function handleHackToggle(interaction, guildId) {
  const settings = getHackSettings(guildId);
  const newEnabled = !settings.enabled;
  
  updateHackSettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `${newEnabled ? 'Enabled' : 'Disabled'} hacking`);
  
  await showHackPanel(interaction, guildId);
}

// ==================== EDIT SETTINGS ====================
async function handleHackEditSettings(interaction, guildId) {
  const settings = getHackSettings(guildId);
  const modal = createHackSettingsModal(settings);
  await interaction.showModal(modal);
}

function createHackSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_hack_settings')
    .setTitle('Hack Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('hacker_cooldown')
          .setLabel('Hacker Cooldown (minutes)')
          .setPlaceholder('60')
          .setValue(String(settings.hackerCooldownMinutes))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_cooldown')
          .setLabel('Target Cooldown (minutes)')
          .setPlaceholder('720')
          .setValue(String(settings.targetCooldownMinutes))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('steal_range')
          .setLabel('Steal % Range (min-max)')
          .setPlaceholder('2-5')
          .setValue(`${settings.minStealPercent}-${settings.maxStealPercent}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fine_range')
          .setLabel('Fine % Range (min-max)')
          .setPlaceholder('15-20')
          .setValue(`${settings.minFinePercent}-${settings.maxFinePercent}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

async function handleHackSettingsModal(interaction, guildId) {
  const hackerCooldown = parseInt(interaction.fields.getTextInputValue('hacker_cooldown')) || 60;
  const targetCooldown = parseInt(interaction.fields.getTextInputValue('target_cooldown')) || 720;
  const stealRange = interaction.fields.getTextInputValue('steal_range');
  const fineRange = interaction.fields.getTextInputValue('fine_range');
  
  // Parse ranges
  const stealParts = stealRange.split('-').map(s => parseInt(s.trim()));
  const fineParts = fineRange.split('-').map(s => parseInt(s.trim()));
  
  const updates = {
    hackerCooldownMinutes: Math.max(1, hackerCooldown),
    targetCooldownMinutes: Math.max(1, targetCooldown),
    minStealPercent: Math.max(1, Math.min(100, stealParts[0] || 2)),
    maxStealPercent: Math.max(1, Math.min(100, stealParts[1] || stealParts[0] || 5)),
    minFinePercent: Math.max(1, Math.min(100, fineParts[0] || 15)),
    maxFinePercent: Math.max(1, Math.min(100, fineParts[1] || fineParts[0] || 20))
  };
  
  // Ensure min <= max
  if (updates.minStealPercent > updates.maxStealPercent) {
    [updates.minStealPercent, updates.maxStealPercent] = [updates.maxStealPercent, updates.minStealPercent];
  }
  if (updates.minFinePercent > updates.maxFinePercent) {
    [updates.minFinePercent, updates.maxFinePercent] = [updates.maxFinePercent, updates.minFinePercent];
  }
  
  updateHackSettings(guildId, updates);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated hack settings`);
  
  await interaction.reply({ content: '✅ Hack settings updated!', flags: 64 });
  await showHackPanel(interaction, guildId);
}

// ==================== IMMUNITY SETTINGS ====================
async function showHackImmunityPanel(interaction, guildId) {
  const immuneRoles = getHackImmuneRoles(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🛡️ Hack Immunity Settings')
    .setDescription('Configure which roles are immune to being hacked')
    .addFields(
      { name: 'Immune Roles', value: immuneRoles.length > 0 ? immuneRoles.map(r => `<@&${r}>`).join('\n') : 'No roles have hack immunity', inline: false }
    );

  const addRoleBtn = new ButtonBuilder()
    .setCustomId('hack_add_immune_role')
    .setLabel('Add Immune Role')
    .setStyle(ButtonStyle.Success)
    .setEmoji('➕');

  const clearRolesBtn = new ButtonBuilder()
    .setCustomId('hack_clear_immune_roles')
    .setLabel('Clear All')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🗑️')
    .setDisabled(immuneRoles.length === 0);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_hack')
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row1 = new ActionRowBuilder().addComponents(addRoleBtn, clearRolesBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1] });
}

async function showHackAddImmunityRole(interaction, guildId) {
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('hack_immunity_role_select')
    .setPlaceholder('Select a role to add immunity')
    .setMinValues(1)
    .setMaxValues(1);

  const backBtn = new ButtonBuilder()
    .setCustomId('hack_immunity_settings')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row1 = new ActionRowBuilder().addComponents(roleSelect);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('➕ Add Immune Role')
    .setDescription('Select a role to grant hack immunity');

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function handleHackImmunityRoleSelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const roleId = interaction.values[0];
  const role = interaction.guild.roles.cache.get(roleId);
  
  addHackImmuneRole(guildId, roleId);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Added hack immunity to role: ${role?.name || roleId}`);
  
  await showHackImmunityPanel(interaction, guildId);
}

async function handleClearImmuneRoles(interaction, guildId) {
  clearHackImmuneRoles(guildId);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Cleared all hack immune roles`);
  
  await showHackImmunityPanel(interaction, guildId);
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showHackPanel,
  createHackSettingsModal
};
