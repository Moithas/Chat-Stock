// Admin Prestige Panel (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction, getCurrency } = require('../admin');
const { getPrestigeSettings, updatePrestigeSettings, getPrestigeLeaderboard, PRESTIGE_TIERS, adminSetPrestige, adminResetPrestige } = require('../prestige');

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_prestige',
  'prestige_toggle',
  'prestige_edit_settings',
  'prestige_view_leaderboard',
  'back_prestige'
];

const MODAL_IDS = [
  'modal_prestige_settings'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;

  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;

    switch (customId) {
      case 'admin_prestige':
        await interaction.deferUpdate();
        await showPrestigePanel(interaction, guildId);
        return true;
      case 'prestige_toggle':
        await handleToggle(interaction, guildId);
        return true;
      case 'prestige_edit_settings':
        await handleEditSettings(interaction, guildId);
        return true;
      case 'prestige_view_leaderboard':
        await interaction.deferUpdate();
        await showPrestigeLeaderboard(interaction, guildId);
        return true;
      case 'back_prestige':
        await interaction.deferUpdate();
        await showPrestigePanel(interaction, guildId);
        return true;
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;

    switch (customId) {
      case 'modal_prestige_settings':
        await handleSettingsModal(interaction, guildId);
        return true;
    }
  }

  return false;
}

// ==================== PRESTIGE PANEL ====================
async function showPrestigePanel(interaction, guildId) {
  const settings = getPrestigeSettings(guildId);
  const leaderboard = getPrestigeLeaderboard(guildId);
  const currency = getCurrency(guildId);

  const tierList = PRESTIGE_TIERS.map(t => 
    `${t.emoji} **${t.name}** — ${t.cost.toLocaleString()} ${currency} (Start: ${t.startingBonus.toLocaleString()})`
  ).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🎖️ Prestige System Settings')
    .setDescription(`Status: ${settings.enabled ? '✅ Enabled' : '❌ Disabled'}`)
    .addFields(
      { name: '📊 Multipliers (per tier)', value:
        `Income: **+${(settings.incomeMultiplierPerTier * 100).toFixed(0)}%**\n` +
        `XP: **+${(settings.xpMultiplierPerTier * 100).toFixed(0)}%**\n` +
        `Borrow Limit: **+${(settings.borrowMultiplierPerTier * 100).toFixed(0)}%**`,
        inline: true
      },
      { name: '⏱️ Cooldown', value: `**${settings.cooldownDays}** days`, inline: true },
      { name: '👑 Prestiged Players', value: `**${leaderboard.length}**`, inline: true },
      { name: '🏆 Tiers', value: tierList, inline: false }
    )
    .setFooter({ text: 'Prestige resets cash, stocks, properties, items, loans, cooldowns & skills XP' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('prestige_toggle')
      .setLabel(settings.enabled ? 'Disable Prestige' : 'Enable Prestige')
      .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('prestige_edit_settings')
      .setLabel('Edit Settings')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('prestige_view_leaderboard')
      .setLabel('View Leaderboard')
      .setEmoji('👑')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('back_dashboard')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row1] });
}

// ==================== TOGGLE ====================
async function handleToggle(interaction, guildId) {
  await interaction.deferUpdate();
  const settings = getPrestigeSettings(guildId);
  settings.enabled = !settings.enabled;
  updatePrestigeSettings(guildId, settings);
  logAdminAction(guildId, interaction.user.id, `${settings.enabled ? 'Enabled' : 'Disabled'} prestige system`);
  await showPrestigePanel(interaction, guildId);
}

// ==================== EDIT SETTINGS ====================
async function handleEditSettings(interaction, guildId) {
  const settings = getPrestigeSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_prestige_settings')
    .setTitle('Prestige Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cooldown_days')
        .setLabel('Cooldown between prestiges (days)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.cooldownDays))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('income_mult')
        .setLabel('Income multiplier per tier (%)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.incomeMultiplierPerTier * 100))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('xp_mult')
        .setLabel('XP multiplier per tier (%)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.xpMultiplierPerTier * 100))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('borrow_mult')
        .setLabel('Borrow limit multiplier per tier (%)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.borrowMultiplierPerTier * 100))
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleSettingsModal(interaction, guildId) {
  await interaction.deferUpdate();

  const cooldownDays = parseInt(interaction.fields.getTextInputValue('cooldown_days'));
  const incomeMult = parseFloat(interaction.fields.getTextInputValue('income_mult'));
  const xpMult = parseFloat(interaction.fields.getTextInputValue('xp_mult'));
  const borrowMult = parseFloat(interaction.fields.getTextInputValue('borrow_mult'));

  if (isNaN(cooldownDays) || cooldownDays < 0 || isNaN(incomeMult) || isNaN(xpMult) || isNaN(borrowMult)) {
    return interaction.followUp({ content: '❌ Invalid input. Please enter valid numbers.', flags: 64 });
  }

  const settings = getPrestigeSettings(guildId);
  settings.cooldownDays = cooldownDays;
  settings.incomeMultiplierPerTier = incomeMult / 100;
  settings.xpMultiplierPerTier = xpMult / 100;
  settings.borrowMultiplierPerTier = borrowMult / 100;

  updatePrestigeSettings(guildId, settings);
  logAdminAction(guildId, interaction.user.id, `Updated prestige settings: cooldown=${cooldownDays}d, income=+${incomeMult}%, xp=+${xpMult}%, borrow=+${borrowMult}%`);
  await showPrestigePanel(interaction, guildId);
}

// ==================== LEADERBOARD ====================
async function showPrestigeLeaderboard(interaction, guildId) {
  const leaderboard = getPrestigeLeaderboard(guildId);

  if (leaderboard.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('🎖️ Prestige Leaderboard')
      .setDescription('No players have prestiged yet.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('back_prestige')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  }

  let description = '';
  for (let i = 0; i < Math.min(leaderboard.length, 15); i++) {
    const entry = leaderboard[i];
    const tier = PRESTIGE_TIERS.find(t => t.level === entry.prestige_level);
    const badge = tier ? `${tier.emoji} ${tier.name}` : 'Unknown';
    const timeStr = entry.prestige_time ? `<t:${Math.floor(entry.prestige_time / 1000)}:R>` : 'N/A';
    description += `**${i + 1}.** <@${entry.user_id}> — ${badge} (×${entry.total_prestiges}) — ${timeStr}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🎖️ Prestige Leaderboard')
    .setDescription(description)
    .setFooter({ text: `${leaderboard.length} players prestiged` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('back_prestige')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

module.exports = {
  showPrestigePanel,
  handleInteraction,
  BUTTON_IDS,
  MODAL_IDS
};
