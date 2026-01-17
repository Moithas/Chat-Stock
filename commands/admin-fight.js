// Admin Fight Panel - Fight settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getFightSettings, updateFightSettings, getTopFighters, getFightHistory, resetAllFighterStats } = require('../fight');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_fight',
  'fight_toggle', 'fight_edit_settings', 'fight_view_leaderboard', 'fight_view_history',
  'fight_reset_stats', 'fight_reset_confirm',
  'back_fight'
];

const MODAL_IDS = [
  'modal_fight_settings'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'admin_fight':
        await interaction.deferUpdate();
        await showFightPanel(interaction, guildId);
        return true;
      case 'fight_toggle':
        await interaction.deferUpdate();
        await handleFightToggle(interaction, guildId);
        return true;
      case 'fight_edit_settings':
        await handleFightEditSettings(interaction, guildId);
        return true;
      case 'fight_view_leaderboard':
        await interaction.deferUpdate();
        await showFightLeaderboard(interaction, guildId);
        return true;
      case 'fight_view_history':
        await interaction.deferUpdate();
        await showFightHistory(interaction, guildId);
        return true;
      case 'fight_reset_stats':
        await interaction.deferUpdate();
        await showResetConfirm(interaction, guildId);
        return true;
      case 'fight_reset_confirm':
        await interaction.deferUpdate();
        await handleResetStats(interaction, guildId);
        return true;
      case 'back_fight':
        await interaction.deferUpdate();
        await showFightPanel(interaction, guildId);
        return true;
    }
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'modal_fight_settings':
        await handleFightSettingsModal(interaction, guildId);
        return true;
    }
  }
  
  return false;
}

// ==================== FIGHT PANEL ====================
async function showFightPanel(interaction, guildId) {
  const settings = getFightSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('🥊 Fight Settings')
    .setDescription('Configure the /fight command - PvP cage fighting with betting')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💰 House Cut', value: `${settings.houseCutPercent}%`, inline: true },
      { name: '🔄 Rematch Requirement', value: `${settings.rematchFightsRequired} unique opponents`, inline: true },
      { name: '⏱️ Challenge Timeout', value: `${settings.challengeTimeoutSeconds} seconds`, inline: true },
      { name: '🎰 Betting Window', value: `${settings.spectatorBetWindowSeconds} seconds`, inline: true },
      { name: '⚡ Round Time', value: `${settings.roundTimeSeconds} seconds`, inline: true },
      { name: '🔢 Max Rounds', value: `${settings.maxRounds}`, inline: true },
      { name: '💚 Grapple Cooldown', value: `${settings.grappleCooldown} round(s)`, inline: true },
      { name: '🎯 Odds Min Fights', value: `${settings.oddsMinFights}`, inline: true },
      { name: '🛑 TKO Threshold', value: `${settings.tkoRounds} consecutive AFK rounds`, inline: true },
      { name: '🤝 Draw AFK Threshold', value: `${settings.drawAfkRounds} consecutive double-AFK`, inline: true }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fight_toggle')
      .setLabel(settings.enabled ? 'Disable Fighting' : 'Enable Fighting')
      .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(settings.enabled ? '🔴' : '🟢'),
    new ButtonBuilder()
      .setCustomId('fight_edit_settings')
      .setLabel('Edit Settings')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⚙️')
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fight_view_leaderboard')
      .setLabel('View Leaderboard')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🏆'),
    new ButtonBuilder()
      .setCustomId('fight_view_history')
      .setLabel('View History')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📜'),
    new ButtonBuilder()
      .setCustomId('fight_reset_stats')
      .setLabel('Reset All Stats')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId('back_dashboard')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
  );

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== TOGGLE HANDLER ====================
async function handleFightToggle(interaction, guildId) {
  const settings = getFightSettings(guildId);
  settings.enabled = !settings.enabled;
  updateFightSettings(guildId, settings);
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `${settings.enabled ? 'Enabled' : 'Disabled'} fighting`);
  
  await showFightPanel(interaction, guildId);
}

// ==================== RESET STATS ====================
async function showResetConfirm(interaction, guildId) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('⚠️ Reset All Fighter Stats?')
    .setDescription(
      '**This will permanently delete:**\n\n' +
      '• All fighter win/loss/draw records\n' +
      '• All fight history\n' +
      '• All opponent history (rematch cooldowns)\n' +
      '• All spectator bet records\n\n' +
      '**This cannot be undone!**'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fight_reset_confirm')
      .setLabel('Yes, Reset Everything')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId('back_fight')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleResetStats(interaction, guildId) {
  resetAllFighterStats(guildId);
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    'Reset all fighter statistics and history');

  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Stats Reset Complete')
    .setDescription('All fighter statistics, fight history, and opponent records have been cleared.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('back_fight')
      .setLabel('Back to Fight Settings')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('◀️')
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== EDIT SETTINGS ====================
async function handleFightEditSettings(interaction, guildId) {
  const settings = getFightSettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_fight_settings')
    .setTitle('Edit Fight Settings');

  const houseCutInput = new TextInputBuilder()
    .setCustomId('house_cut')
    .setLabel('House Cut % (spectator bets)')
    .setStyle(TextInputStyle.Short)
    .setValue(settings.houseCutPercent.toString())
    .setPlaceholder('5')
    .setRequired(true);

  const rematchInput = new TextInputBuilder()
    .setCustomId('rematch_fights')
    .setLabel('Unique opponents before rematch')
    .setStyle(TextInputStyle.Short)
    .setValue(settings.rematchFightsRequired.toString())
    .setPlaceholder('3')
    .setRequired(true);

  const timersInput = new TextInputBuilder()
    .setCustomId('timers')
    .setLabel('Challenge/Betting/Round timeouts (secs)')
    .setStyle(TextInputStyle.Short)
    .setValue(`${settings.challengeTimeoutSeconds},${settings.spectatorBetWindowSeconds},${settings.roundTimeSeconds}`)
    .setPlaceholder('30,60,15')
    .setRequired(true);

  const roundsInput = new TextInputBuilder()
    .setCustomId('rounds')
    .setLabel('Max rounds, Grapple cooldown, Odds min fights')
    .setStyle(TextInputStyle.Short)
    .setValue(`${settings.maxRounds},${settings.grappleCooldown},${settings.oddsMinFights}`)
    .setPlaceholder('20,1,5')
    .setRequired(true);

  const afkInput = new TextInputBuilder()
    .setCustomId('afk')
    .setLabel('TKO rounds, Draw AFK rounds')
    .setStyle(TextInputStyle.Short)
    .setValue(`${settings.tkoRounds},${settings.drawAfkRounds}`)
    .setPlaceholder('3,2')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(houseCutInput),
    new ActionRowBuilder().addComponents(rematchInput),
    new ActionRowBuilder().addComponents(timersInput),
    new ActionRowBuilder().addComponents(roundsInput),
    new ActionRowBuilder().addComponents(afkInput)
  );

  await interaction.showModal(modal);
}

async function handleFightSettingsModal(interaction, guildId) {
  const settings = getFightSettings(guildId);
  
  try {
    const houseCut = parseFloat(interaction.fields.getTextInputValue('house_cut'));
    const rematchFights = parseInt(interaction.fields.getTextInputValue('rematch_fights'));
    const timers = interaction.fields.getTextInputValue('timers').split(',').map(t => parseInt(t.trim()));
    const rounds = interaction.fields.getTextInputValue('rounds').split(',').map(r => parseInt(r.trim()));
    const afk = interaction.fields.getTextInputValue('afk').split(',').map(a => parseInt(a.trim()));

    // Validate
    if (isNaN(houseCut) || houseCut < 0 || houseCut > 50) {
      return interaction.reply({ content: '❌ House cut must be between 0 and 50%', ephemeral: true });
    }
    if (isNaN(rematchFights) || rematchFights < 0) {
      return interaction.reply({ content: '❌ Rematch fights must be 0 or more', ephemeral: true });
    }
    if (timers.length !== 3 || timers.some(isNaN) || timers.some(t => t < 5)) {
      return interaction.reply({ content: '❌ Timers must be 3 comma-separated values (min 5 seconds each)', ephemeral: true });
    }
    if (rounds.length !== 3 || rounds.some(isNaN)) {
      return interaction.reply({ content: '❌ Rounds input must be 3 comma-separated values', ephemeral: true });
    }
    if (afk.length !== 2 || afk.some(isNaN) || afk.some(a => a < 1)) {
      return interaction.reply({ content: '❌ AFK input must be 2 comma-separated values (min 1 each)', ephemeral: true });
    }

    // Update settings
    settings.houseCutPercent = houseCut;
    settings.rematchFightsRequired = rematchFights;
    settings.challengeTimeoutSeconds = timers[0];
    settings.spectatorBetWindowSeconds = timers[1];
    settings.roundTimeSeconds = timers[2];
    settings.maxRounds = rounds[0];
    settings.grappleCooldown = rounds[1];
    settings.oddsMinFights = rounds[2];
    settings.tkoRounds = afk[0];
    settings.drawAfkRounds = afk[1];

    updateFightSettings(guildId, settings);
    
    logAdminAction(guildId, interaction.user.id, interaction.user.username, 
      `Updated fight settings: House ${houseCut}%, Rematch ${rematchFights}, TKO ${afk[0]}`);

    await interaction.deferUpdate();
    await showFightPanel(interaction, guildId);
  } catch (error) {
    console.error('Error updating fight settings:', error);
    return interaction.reply({ content: '❌ Error updating settings. Check your input format.', ephemeral: true });
  }
}

// ==================== LEADERBOARD ====================
async function showFightLeaderboard(interaction, guildId) {
  const topFighters = getTopFighters(guildId, 10);
  
  let description = '';
  if (topFighters.length === 0) {
    description = 'No fights recorded yet!';
  } else {
    for (let i = 0; i < topFighters.length; i++) {
      const fighter = topFighters[i];
      const record = `${fighter.wins}-${fighter.losses}${fighter.draws > 0 ? `-${fighter.draws}` : ''}`;
      const winRate = fighter.wins + fighter.losses > 0 
        ? Math.round((fighter.wins / (fighter.wins + fighter.losses)) * 100) 
        : 0;
      
      description += `**${i + 1}.** <@${fighter.user_id}>\n`;
      description += `   Record: **${record}** (${winRate}% win rate)\n`;
      description += `   KOs: **${fighter.knockouts}** | TKOs: **${fighter.tkos}**\n`;
      description += `   Earnings: **${fighter.total_earnings.toLocaleString()}** ${CURRENCY}\n\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🏆 Fight Leaderboard')
    .setDescription(description);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('back_fight')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== FIGHT HISTORY ====================
async function showFightHistory(interaction, guildId) {
  const history = getFightHistory(guildId, 10);
  
  let description = '';
  if (history.length === 0) {
    description = 'No fights recorded yet!';
  } else {
    for (const fight of history) {
      const date = new Date(fight.fought_at).toLocaleDateString();
      const resultEmoji = fight.result_type.includes('draw') ? '🤝' : '🥊';
      
      if (fight.result_type.includes('draw')) {
        description += `${resultEmoji} **DRAW** - <@${fight.fighter1_id}> vs <@${fight.fighter2_id}>\n`;
      } else {
        description += `${resultEmoji} <@${fight.winner_id}> defeated <@${fight.loser_id}>\n`;
      }
      description += `   ${fight.result_type.toUpperCase()} | Round ${fight.rounds} | ${date}\n`;
      description += `   Wager: **${fight.bet_amount.toLocaleString()}** ${CURRENCY}`;
      if (fight.spectator_pool > 0) {
        description += ` | Spectator Pool: **${fight.spectator_pool.toLocaleString()}** ${CURRENCY}`;
      }
      description += '\n\n';
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📜 Recent Fights')
    .setDescription(description);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('back_fight')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

module.exports = {
  handleInteraction,
  showFightPanel,
  BUTTON_IDS,
  MODAL_IDS
};
