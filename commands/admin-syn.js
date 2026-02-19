// Admin SYN Panel - Screw Your Neighbor settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getSYNSettings, updateSYNSettings } = require('../screwyourneighbor');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_syn',
  'syn_toggle', 'syn_edit_settings', 'syn_edit_timing',
  'back_syn'
];

const MODAL_IDS = [
  'modal_syn_settings',
  'modal_syn_timing'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;

  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;

    switch (customId) {
      case 'admin_syn':
        await interaction.deferUpdate();
        await showSYNPanel(interaction, guildId);
        return true;
      case 'syn_toggle':
        await interaction.deferUpdate();
        await handleSYNToggle(interaction, guildId);
        return true;
      case 'syn_edit_settings':
        await handleEditSettings(interaction, guildId);
        return true;
      case 'syn_edit_timing':
        await handleEditTiming(interaction, guildId);
        return true;
      case 'back_syn':
        await interaction.deferUpdate();
        await showSYNPanel(interaction, guildId);
        return true;
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;

    switch (customId) {
      case 'modal_syn_settings':
        await handleSettingsModal(interaction, guildId);
        return true;
      case 'modal_syn_timing':
        await handleTimingModal(interaction, guildId);
        return true;
    }
  }

  return false;
}

// ==================== SYN PANEL ====================
async function showSYNPanel(interaction, guildId) {
  const settings = getSYNSettings(guildId);

  const maxBetDisplay = settings.maxBet > 0 ? `${settings.maxBet.toLocaleString()} ${CURRENCY}` : 'No limit';

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🃏 Screw Your Neighbor Settings')
    .setDescription('Configure the SYN card game system')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '❤️ Starting Lives', value: String(settings.startingLives), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '👥 Min Players', value: String(settings.minPlayers), inline: true },
      { name: '👥 Max Players', value: String(settings.maxPlayers), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💰 Min Bet', value: `${settings.minBet.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '💰 Max Bet', value: maxBetDisplay, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '⏱️ Turn Timer', value: `${settings.turnTimeSeconds}s`, inline: true },
      { name: '🃏 Deal Delay', value: `${settings.dealDelaySeconds}s`, inline: true },
      { name: '⏱️ Lobby Timeout', value: `${settings.lobbyTimeoutSeconds}s`, inline: true },
      { name: '🎴 Reveal Delay', value: `${settings.revealDelaySeconds}s`, inline: true },
      { name: '💀 Elimination Delay', value: `${settings.eliminationDelaySeconds}s`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('syn_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('syn_edit_settings')
    .setLabel('⚙️ Game Settings')
    .setStyle(ButtonStyle.Primary);

  const timingBtn = new ButtonBuilder()
    .setCustomId('syn_edit_timing')
    .setLabel('⏱️ Timing')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, timingBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== TOGGLE ====================
async function handleSYNToggle(interaction, guildId) {
  const settings = getSYNSettings(guildId);
  updateSYNSettings(guildId, { enabled: !settings.enabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled SYN ${!settings.enabled ? 'ON' : 'OFF'}`);
  await showSYNPanel(interaction, guildId);
}

// ==================== EDIT GAME SETTINGS ====================
async function handleEditSettings(interaction, guildId) {
  const settings = getSYNSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_syn_settings')
    .setTitle('SYN Game Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('starting_lives')
          .setLabel('Starting Lives')
          .setPlaceholder('3')
          .setValue(String(settings.startingLives))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('players')
          .setLabel('Min Players, Max Players (comma sep)')
          .setPlaceholder('3,8')
          .setValue(`${settings.minPlayers},${settings.maxPlayers}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_bet')
          .setLabel('Minimum Bet')
          .setPlaceholder('100')
          .setValue(String(settings.minBet))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_bet')
          .setLabel('Maximum Bet (0 = no limit)')
          .setPlaceholder('0')
          .setValue(String(settings.maxBet))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
}

// ==================== EDIT TIMING ====================
async function handleEditTiming(interaction, guildId) {
  const settings = getSYNSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_syn_timing')
    .setTitle('SYN Timing Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('turn_time')
          .setLabel('Turn Timer (seconds)')
          .setPlaceholder('20')
          .setValue(String(settings.turnTimeSeconds))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deal_delay')
          .setLabel('Deal Delay — strategy time (seconds)')
          .setPlaceholder('5')
          .setValue(String(settings.dealDelaySeconds))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('lobby_timeout')
          .setLabel('Lobby Timeout (seconds)')
          .setPlaceholder('120')
          .setValue(String(settings.lobbyTimeoutSeconds))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reveal_delay')
          .setLabel('Reveal Delay (seconds)')
          .setPlaceholder('6')
          .setValue(String(settings.revealDelaySeconds))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('elimination_delay')
          .setLabel('Elimination Delay (seconds)')
          .setPlaceholder('4')
          .setValue(String(settings.eliminationDelaySeconds))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
}

// ==================== MODAL HANDLERS ====================
async function handleSettingsModal(interaction, guildId) {
  try {
    const startingLives = parseInt(interaction.fields.getTextInputValue('starting_lives'));

    const playerParts = interaction.fields.getTextInputValue('players').split(',').map(v => parseInt(v.trim()));
    const minPlayers = playerParts[0];
    const maxPlayers = playerParts[1];

    const minBet = parseInt(interaction.fields.getTextInputValue('min_bet'));
    const maxBet = parseInt(interaction.fields.getTextInputValue('max_bet'));

    // Validate
    const allValues = [startingLives, minPlayers, maxPlayers, minBet, maxBet];
    if (allValues.some(isNaN)) {
      await interaction.reply({ content: '❌ All values must be valid numbers.', flags: 64 });
      return;
    }

    if (startingLives < 1 || startingLives > 10) {
      await interaction.reply({ content: '❌ Starting lives must be between 1 and 10.', flags: 64 });
      return;
    }

    if (minPlayers < 2 || minPlayers > 8) {
      await interaction.reply({ content: '❌ Min players must be between 2 and 8.', flags: 64 });
      return;
    }

    if (maxPlayers < minPlayers || maxPlayers > 12) {
      await interaction.reply({ content: `❌ Max players must be between ${minPlayers} and 12.`, flags: 64 });
      return;
    }

    if (minBet < 0) {
      await interaction.reply({ content: '❌ Min bet cannot be negative.', flags: 64 });
      return;
    }

    if (maxBet < 0) {
      await interaction.reply({ content: '❌ Max bet cannot be negative.', flags: 64 });
      return;
    }

    if (maxBet > 0 && maxBet < minBet) {
      await interaction.reply({ content: '❌ Max bet must be greater than min bet (or 0 for no limit).', flags: 64 });
      return;
    }

    updateSYNSettings(guildId, { startingLives, minPlayers, maxPlayers, minBet, maxBet });

    logAdminAction(guildId, interaction.user.id, interaction.user.username,
      `Updated SYN settings: ${startingLives} lives, ${minPlayers}-${maxPlayers} players, bet ${minBet}-${maxBet || '∞'}`);

    await interaction.reply({ content: '✅ SYN game settings updated!', flags: 64 });
  } catch (err) {
    console.error('[Admin-SYN] Settings modal error:', err);
    await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
  }
}

async function handleTimingModal(interaction, guildId) {
  try {
    const turnTimeSeconds = parseInt(interaction.fields.getTextInputValue('turn_time'));
    const dealDelaySeconds = parseInt(interaction.fields.getTextInputValue('deal_delay'));
    const lobbyTimeoutSeconds = parseInt(interaction.fields.getTextInputValue('lobby_timeout'));
    const revealDelaySeconds = parseInt(interaction.fields.getTextInputValue('reveal_delay'));
    const eliminationDelaySeconds = parseInt(interaction.fields.getTextInputValue('elimination_delay'));

    // Validate
    const allValues = [turnTimeSeconds, dealDelaySeconds, lobbyTimeoutSeconds, revealDelaySeconds, eliminationDelaySeconds];
    if (allValues.some(isNaN)) {
      await interaction.reply({ content: '❌ All values must be valid numbers.', flags: 64 });
      return;
    }

    if (turnTimeSeconds < 5 || turnTimeSeconds > 120) {
      await interaction.reply({ content: '❌ Turn timer must be between 5 and 120 seconds.', flags: 64 });
      return;
    }

    if (dealDelaySeconds < 2 || dealDelaySeconds > 60) {
      await interaction.reply({ content: '❌ Deal delay must be between 2 and 30 seconds.', flags: 64 });
      return;
    }

    if (lobbyTimeoutSeconds < 30 || lobbyTimeoutSeconds > 600) {
      await interaction.reply({ content: '❌ Lobby timeout must be between 30 and 600 seconds.', flags: 64 });
      return;
    }

    if (revealDelaySeconds < 2 || revealDelaySeconds > 30) {
      await interaction.reply({ content: '❌ Reveal delay must be between 2 and 30 seconds.', flags: 64 });
      return;
    }

    if (eliminationDelaySeconds < 1 || eliminationDelaySeconds > 15) {
      await interaction.reply({ content: '❌ Elimination delay must be between 1 and 15 seconds.', flags: 64 });
      return;
    }

    updateSYNSettings(guildId, { turnTimeSeconds, dealDelaySeconds, lobbyTimeoutSeconds, revealDelaySeconds, eliminationDelaySeconds });

    logAdminAction(guildId, interaction.user.id, interaction.user.username,
      `Updated SYN timing: ${turnTimeSeconds}s turn, ${dealDelaySeconds}s deal, ${lobbyTimeoutSeconds}s lobby, ${revealDelaySeconds}s reveal, ${eliminationDelaySeconds}s elim`);

    await interaction.reply({ content: '✅ SYN timing settings updated!', flags: 64 });
  } catch (err) {
    console.error('[Admin-SYN] Timing modal error:', err);
    await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
  }
}

module.exports = {
  handleInteraction,
  showSYNPanel
};
