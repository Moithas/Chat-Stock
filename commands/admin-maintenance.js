// Admin Maintenance Panel - Database cleanup, error logs, rate limiting
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { logAdminAction } = require('../admin');
const { 
  cleanupOldHistory, 
  getDatabaseStats, 
  getRecentErrors, 
  getErrorsFromDb,
  getCommandCooldownSettings,
  setCommandCooldown,
  HISTORY_RETENTION_DAYS,
  DEFAULT_COMMAND_COOLDOWNS
} = require('../maintenance');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'maint_cleanup', 'maint_view_errors', 'maint_db_stats',
  'maint_rate_limits', 'maint_edit_cooldown', 'maint_back'
];

const MODAL_IDS = [
  'modal_command_cooldown'
];

const SELECT_IDS = [
  'maint_command_select'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-maintenance')
    .setDescription('🔧 Manage database maintenance, error logs, and rate limiting'),
  
  async execute(interaction) {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ You need Administrator permission to use this command.',
        flags: 64
      });
    }
    
    await showMaintenancePanel(interaction, interaction.guildId);
  },
  
  // Handle all interactions for this module
  async handleInteraction(interaction, guildId) {
    const customId = interaction.customId;
    
    // Handle button interactions
    if (interaction.isButton()) {
      if (!BUTTON_IDS.includes(customId)) return false;
      
      switch (customId) {
        case 'maint_cleanup':
          await handleCleanup(interaction, guildId);
          return true;
        case 'maint_view_errors':
          await handleViewErrors(interaction, guildId);
          return true;
        case 'maint_db_stats':
          await handleDbStats(interaction, guildId);
          return true;
        case 'maint_rate_limits':
          await handleRateLimits(interaction, guildId);
          return true;
        case 'maint_edit_cooldown':
          await showCooldownSelect(interaction, guildId);
          return true;
        case 'maint_back':
          await showMaintenancePanel(interaction, guildId);
          return true;
      }
    }
    
    // Handle select menu interactions
    if (interaction.isStringSelectMenu()) {
      if (customId === 'maint_command_select') {
        await showCooldownModal(interaction, guildId);
        return true;
      }
    }
    
    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      if (customId === 'modal_command_cooldown') {
        await handleCooldownModalSubmit(interaction, guildId);
        return true;
      }
    }
    
    return false;
  }
};

// ==================== MAIN PANEL ====================
async function showMaintenancePanel(interaction, guildId) {
  const stats = getDatabaseStats();
  const recentErrors = getRecentErrors(5);
  const cooldownSettings = getCommandCooldownSettings(guildId);
  
  // Calculate total rows
  let totalRows = 0;
  if (stats.tables) {
    for (const count of Object.values(stats.tables)) {
      if (typeof count === 'number') totalRows += count;
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🔧 Maintenance Panel')
    .setDescription('Manage database health, error monitoring, and command rate limits.')
    .addFields(
      { 
        name: '💾 Database Status', 
        value: `**Tables:** ${Object.keys(stats.tables || {}).length}\n**Total Rows:** ${totalRows.toLocaleString()}\n**Retention:** ${HISTORY_RETENTION_DAYS} days`, 
        inline: true 
      },
      { 
        name: '❌ Recent Errors', 
        value: recentErrors.length > 0 
          ? `**${recentErrors.length}** errors in memory\nLatest: ${recentErrors[0]?.command || 'system'}` 
          : '✅ No recent errors', 
        inline: true 
      },
      {
        name: '⏱️ Rate Limiting',
        value: `**Active:** ${Object.keys(cooldownSettings).filter(k => k !== '_default' && cooldownSettings[k] > 0).length} commands\n**Default:** ${cooldownSettings._default || 2}s`,
        inline: true
      }
    )
    .setFooter({ text: 'Auto-cleanup runs daily at 4 AM' })
    .setTimestamp();
  
  // Add top 5 largest tables if available
  if (stats.tablesBySize && stats.tablesBySize.length > 0) {
    const topTables = stats.tablesBySize.slice(0, 5)
      .map(([table, count]) => `\`${table}\`: ${count.toLocaleString()}`)
      .join('\n');
    embed.addFields({ name: '📊 Largest Tables', value: topTables, inline: false });
  }
  
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('maint_cleanup')
      .setLabel('🧹 Run Cleanup')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('maint_db_stats')
      .setLabel('📊 Full Stats')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('maint_view_errors')
      .setLabel('❌ View Errors')
      .setStyle(ButtonStyle.Secondary)
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('maint_rate_limits')
      .setLabel('⏱️ Rate Limits')
      .setStyle(ButtonStyle.Primary)
  );
  
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components: [row1, row2] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row1, row2], flags: 64 });
  }
}

// ==================== CLEANUP ====================
async function handleCleanup(interaction, guildId) {
  await interaction.deferUpdate();
  
  const result = cleanupOldHistory(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(result.success ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🧹 Database Cleanup Results')
    .setDescription(result.success 
      ? `Successfully cleaned **${result.totalCleaned.toLocaleString()}** old records (>${result.retentionDays} days)`
      : `❌ Cleanup failed: ${result.error}`
    )
    .setTimestamp();
  
  if (result.success && result.details) {
    // Show tables that had records cleaned
    const cleaned = Object.entries(result.details)
      .filter(([, info]) => info.cleaned > 0)
      .map(([table, info]) => `\`${table}\`: ${info.cleaned.toLocaleString()}`)
      .slice(0, 10);
    
    if (cleaned.length > 0) {
      embed.addFields({ name: '📋 Tables Cleaned', value: cleaned.join('\n'), inline: false });
    } else {
      embed.addFields({ name: '📋 Status', value: 'No old records found to clean', inline: false });
    }
  }
  
  // Log admin action
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'database_cleanup', JSON.stringify({
    recordsCleaned: result.totalCleaned,
    retentionDays: result.retentionDays
  }));
  
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('maint_back')
      .setLabel('← Back')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.editReply({ embeds: [embed], components: [backRow] });
}

// ==================== DATABASE STATS ====================
async function handleDbStats(interaction, guildId) {
  await interaction.deferUpdate();
  
  const stats = getDatabaseStats();
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Database Statistics')
    .setTimestamp();
  
  if (stats.tablesBySize && stats.tablesBySize.length > 0) {
    // Calculate total
    let total = 0;
    for (const [, count] of stats.tablesBySize) {
      total += count;
    }
    embed.setDescription(`**Total Records:** ${total.toLocaleString()}\n**Tables:** ${stats.tablesBySize.length}`);
    
    // Build columns with character limit in mind (Discord max is 1024)
    const MAX_FIELD_LENGTH = 1000;
    let col1 = '';
    let col2 = '';
    let useCol1 = true;
    
    for (const [table, count] of stats.tablesBySize) {
      const line = `\`${table}\`: ${count.toLocaleString()}\n`;
      
      if (useCol1) {
        if (col1.length + line.length < MAX_FIELD_LENGTH) {
          col1 += line;
        } else {
          useCol1 = false;
          if (col2.length + line.length < MAX_FIELD_LENGTH) {
            col2 += line;
          }
        }
      } else {
        if (col2.length + line.length < MAX_FIELD_LENGTH) {
          col2 += line;
        }
        // If col2 is also full, we just stop adding
      }
    }
    
    // Trim trailing newlines
    col1 = col1.trim() || 'None';
    col2 = col2.trim() || '\u200b';
    
    embed.addFields(
      { name: 'Tables (by size)', value: col1, inline: true },
      { name: '\u200b', value: col2, inline: true }
    );
  }
  
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('maint_back')
      .setLabel('← Back')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.editReply({ embeds: [embed], components: [backRow] });
}

// ==================== ERROR LOG ====================
async function handleViewErrors(interaction, guildId) {
  await interaction.deferUpdate();
  
  const recentErrors = getRecentErrors(10);
  const dbErrors = getErrorsFromDb({ guildId, limit: 10 });
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('❌ Error Log')
    .setTimestamp();
  
  if (recentErrors.length === 0 && dbErrors.length === 0) {
    embed.setDescription('✅ No errors recorded! Everything is running smoothly.');
    embed.setColor(0x2ecc71);
  } else {
    const errors = recentErrors.length > 0 ? recentErrors : dbErrors;
    const errorText = errors.map((e, i) => {
      const time = new Date(e.timestamp || e.occurred_at).toLocaleString();
      const cmd = e.command || 'system';
      const msg = (e.errorMessage || e.error_message || 'Unknown error').substring(0, 100);
      return `**${i + 1}.** \`${cmd}\` @ ${time}\n└ ${msg}`;
    }).join('\n\n');
    
    embed.setDescription(`**Recent Errors (${errors.length}):**\n\n${errorText}`);
  }
  
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('maint_back')
      .setLabel('← Back')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.editReply({ embeds: [embed], components: [backRow] });
}

// ==================== RATE LIMITS ====================
async function handleRateLimits(interaction, guildId) {
  await interaction.deferUpdate();
  
  const settings = getCommandCooldownSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('⏱️ Command Rate Limits')
    .setDescription('Configure cooldowns between command uses to prevent spam.\nCommands with `0s` have no additional cooldown (may have built-in cooldowns).')
    .setTimestamp();
  
  // Group commands by category
  const categories = {
    'Economy': ['work', 'crime', 'slut', 'rob', 'hack'],
    'Trading': ['stock'],
    'Gambling': ['blackjack', 'roulette', 'scratch', 'lottery'],
    'Banking': ['deposit', 'withdraw', 'balance'],
    'Info': ['leaderboard', 'help']
  };
  
  for (const [category, commands] of Object.entries(categories)) {
    const cmdText = commands
      .map(cmd => `\`/${cmd}\`: **${settings[cmd] ?? settings._default ?? 2}s**`)
      .join('\n');
    embed.addFields({ name: category, value: cmdText, inline: true });
  }
  
  embed.addFields({ name: 'Default', value: `Unlisted commands: **${settings._default ?? 2}s**`, inline: true });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('maint_edit_cooldown')
      .setLabel('✏️ Edit Cooldown')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('maint_back')
      .setLabel('← Back')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== COOLDOWN EDIT ====================
async function showCooldownSelect(interaction, guildId) {
  const settings = getCommandCooldownSettings(guildId);
  
  const options = [
    { label: 'Default (all unlisted)', value: '_default', description: `Current: ${settings._default ?? 2}s` },
    { label: '/stock', value: 'stock', description: `Current: ${settings.stock ?? 3}s` },
    { label: '/blackjack', value: 'blackjack', description: `Current: ${settings.blackjack ?? 2}s` },
    { label: '/roulette', value: 'roulette', description: `Current: ${settings.roulette ?? 2}s` },
    { label: '/scratch', value: 'scratch', description: `Current: ${settings.scratch ?? 1}s` },
    { label: '/lottery', value: 'lottery', description: `Current: ${settings.lottery ?? 2}s` },
    { label: '/deposit', value: 'deposit', description: `Current: ${settings.deposit ?? 2}s` },
    { label: '/withdraw', value: 'withdraw', description: `Current: ${settings.withdraw ?? 2}s` },
    { label: '/leaderboard', value: 'leaderboard', description: `Current: ${settings.leaderboard ?? 5}s` }
  ];
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('maint_command_select')
    .setPlaceholder('Select a command to configure...')
    .addOptions(options);
  
  const row = new ActionRowBuilder().addComponents(selectMenu);
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('maint_rate_limits')
      .setLabel('← Back')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({
    content: 'Select a command to configure its cooldown:',
    embeds: [],
    components: [row, backRow]
  });
}

async function showCooldownModal(interaction, guildId) {
  const commandName = interaction.values[0];
  const settings = getCommandCooldownSettings(guildId);
  const currentCooldown = settings[commandName] ?? settings._default ?? 2;
  
  const modal = new ModalBuilder()
    .setCustomId('modal_command_cooldown')
    .setTitle(`Edit /${commandName} Cooldown`);
  
  const cooldownInput = new TextInputBuilder()
    .setCustomId('cooldown_seconds')
    .setLabel('Cooldown (seconds, 0 to disable)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(currentCooldown))
    .setRequired(true)
    .setMaxLength(4);
  
  const commandInput = new TextInputBuilder()
    .setCustomId('command_name')
    .setLabel('Command (do not change)')
    .setStyle(TextInputStyle.Short)
    .setValue(commandName)
    .setRequired(true);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(cooldownInput),
    new ActionRowBuilder().addComponents(commandInput)
  );
  
  await interaction.showModal(modal);
}

async function handleCooldownModalSubmit(interaction, guildId) {
  const cooldownSeconds = parseInt(interaction.fields.getTextInputValue('cooldown_seconds'));
  const commandName = interaction.fields.getTextInputValue('command_name');
  
  if (isNaN(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 3600) {
    return interaction.reply({
      content: '❌ Invalid cooldown. Please enter a number between 0 and 3600 seconds.',
      flags: 64
    });
  }
  
  const success = setCommandCooldown(guildId, commandName, cooldownSeconds);
  
  if (success) {
    logAdminAction(guildId, interaction.user.id, interaction.user.username, 'set_command_cooldown', JSON.stringify({
      command: commandName,
      cooldownSeconds
    }));
    
    await interaction.reply({
      content: `✅ Set \`/${commandName}\` cooldown to **${cooldownSeconds}s**`,
      flags: 64
    });
  } else {
    await interaction.reply({
      content: '❌ Failed to save cooldown setting.',
      flags: 64
    });
  }
}
