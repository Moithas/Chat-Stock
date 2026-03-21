// Admin Settings Panel — Admin Role, Currency Symbol, Logs, Reset Game
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder } = require('discord.js');
const { getAdminSettings, saveAdminSettings, getAdminRole, setAdminRole, logAdminAction, getAdminLogs, getCurrency, setCurrency, getSupportServerUrl, setSupportServerUrl } = require('../admin');
const { getDb, saveDatabase } = require('../database');

const BUTTON_IDS = [
  'settings_set_role', 'settings_clear_role',
  'settings_edit_currency', 'settings_reset_currency',
  'settings_edit_starting_bal', 'settings_edit_immunity',
  'settings_edit_support_url',
  'settings_view_logs',
  'settings_reset_game', 'reset_game_confirm', 'reset_game_cancel',
  'settings_back_main'
];

const MODAL_IDS = [
  'modal_settings_currency',
  'modal_settings_starting_bal',
  'modal_settings_immunity',
  'modal_settings_support_url',
  'modal_reset_game_confirm'
];

const SELECT_IDS = [
  'settings_role_select'
];

async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;

  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;

    switch (customId) {
      case 'settings_set_role':
        await showRoleSelect(interaction, guildId);
        return true;
      case 'settings_clear_role':
        await handleClearRole(interaction, guildId);
        return true;
      case 'settings_edit_currency':
        await showCurrencyModal(interaction, guildId);
        return true;
      case 'settings_reset_currency':
        await handleResetCurrency(interaction, guildId);
        return true;
      case 'settings_edit_starting_bal':
        await showStartingBalanceModal(interaction, guildId);
        return true;
      case 'settings_edit_immunity':
        await showImmunityModal(interaction, guildId);
        return true;
      case 'settings_edit_support_url':
        await showSupportUrlModal(interaction, guildId);
        return true;
      case 'settings_view_logs':
        await showLogsPanel(interaction, guildId);
        return true;
      case 'settings_back_main':
        await interaction.deferUpdate();
        await showSettingsPanel(interaction, guildId);
        return true;
      case 'settings_reset_game':
        await showResetGamePanel(interaction, guildId);
        return true;
      case 'reset_game_confirm':
        await showResetConfirmModal(interaction);
        return true;
      case 'reset_game_cancel':
        await interaction.deferUpdate();
        await showSettingsPanel(interaction, guildId);
        return true;
    }
    return false;
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;

    switch (customId) {
      case 'modal_settings_currency':
        await handleCurrencyModal(interaction, guildId);
        return true;
      case 'modal_settings_starting_bal':
        await handleStartingBalanceModal(interaction, guildId);
        return true;
      case 'modal_settings_immunity':
        await handleImmunityModal(interaction, guildId);
        return true;
      case 'modal_settings_support_url':
        await handleSupportUrlModal(interaction, guildId);
        return true;
      case 'modal_reset_game_confirm':
        await handleResetGameConfirm(interaction, guildId);
        return true;
    }
    return false;
  }

  // Handle role select
  if (interaction.isRoleSelectMenu()) {
    if (!SELECT_IDS.includes(customId)) return false;

    if (customId === 'settings_role_select') {
      await handleRoleSelect(interaction, guildId);
      return true;
    }
  }

  return false;
}

// ==================== MAIN SETTINGS PANEL ====================
async function showSettingsPanel(interaction, guildId) {
  const settings = getAdminSettings(guildId);
  const currency = getCurrency(guildId);
  const adminRole = settings.adminRoleId ? `<@&${settings.adminRoleId}>` : '*Not set (server admins only)*';
  const startingBal = settings.startingBalance > 0 ? `${settings.startingBalance.toLocaleString()} ${currency}` : '*Disabled (0)*';
  const immunityDays = settings.newPlayerImmunityDays > 0 ? `${settings.newPlayerImmunityDays} day${settings.newPlayerImmunityDays !== 1 ? 's' : ''}` : '*Disabled*';
  const supportUrl = getSupportServerUrl(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('🔧 Server Settings')
    .setDescription('Configure core bot settings for this server.')
    .addFields(
      { name: '👑 Admin Role', value: adminRole, inline: true },
      { name: '💰 Currency Symbol', value: `${currency} (preview)`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🎁 Starting Balance', value: startingBal, inline: true },
      { name: '🛡️ New Player Immunity', value: immunityDays, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '� Support Server', value: supportUrl || '*Not set*', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '�📋 Admin Logs', value: 'View recent admin action history', inline: true },
      { name: '⚠️ Reset Game', value: 'Wipe all player data', inline: true }
    )
    .setFooter({ text: 'Admin role grants /admin access without needing Administrator permission' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('settings_set_role')
      .setLabel('Set Admin Role')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👑'),
    new ButtonBuilder()
      .setCustomId('settings_clear_role')
      .setLabel('Clear Role')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!settings.adminRoleId),
    new ButtonBuilder()
      .setCustomId('settings_edit_currency')
      .setLabel('Edit Currency')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💰'),
    new ButtonBuilder()
      .setCustomId('settings_reset_currency')
      .setLabel('Reset Currency')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!settings.currencySymbol)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('settings_edit_starting_bal')
      .setLabel('Starting Balance')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎁'),
    new ButtonBuilder()
      .setCustomId('settings_edit_immunity')
      .setLabel('Player Immunity')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🛡️'),
    new ButtonBuilder()
      .setCustomId('settings_edit_support_url')
      .setLabel('Support URL')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔗')
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('settings_view_logs')
      .setLabel('View Logs')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋'),
    new ButtonBuilder()
      .setCustomId('settings_reset_game')
      .setLabel('⚠️ Reset Game')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('back_dashboard')
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row1, row2, row3] });
}

// ==================== ADMIN ROLE ====================
async function showRoleSelect(interaction, guildId) {
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('settings_role_select')
    .setPlaceholder('Select the admin role...')
    .setMinValues(1)
    .setMaxValues(1);

  const backBtn = new ButtonBuilder()
    .setCustomId('settings_back_main')
    .setLabel('◀️ Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(roleSelect);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('👑 Set Admin Role')
    .setDescription('Select a role that will grant access to `/admin` without needing server Administrator permission.');

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function handleRoleSelect(interaction, guildId) {
  const roleId = interaction.values[0];
  setAdminRole(guildId, roleId);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set admin role to <@&${roleId}>`);

  await interaction.deferUpdate();
  await showSettingsPanel(interaction, guildId);
}

async function handleClearRole(interaction, guildId) {
  setAdminRole(guildId, null);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Cleared admin role');

  await interaction.deferUpdate();
  await showSettingsPanel(interaction, guildId);
}

// ==================== CURRENCY SYMBOL ====================
async function showCurrencyModal(interaction, guildId) {
  const current = getCurrency(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_settings_currency')
    .setTitle('💰 Edit Currency Symbol');

  const input = new TextInputBuilder()
    .setCustomId('currency_value')
    .setLabel('Currency symbol (emoji or custom emoji)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('<:emoji:123456> or 💵 or $')
    .setValue(current)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleCurrencyModal(interaction, guildId) {
  const value = interaction.fields.getTextInputValue('currency_value').trim();
  if (!value) {
    return interaction.reply({ content: '❌ Currency symbol cannot be empty.', flags: 64 });
  }

  setCurrency(guildId, value);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Changed currency symbol to ${value}`);

  await interaction.reply({ content: `✅ Currency symbol updated to ${value}`, flags: 64 });
}

async function handleResetCurrency(interaction, guildId) {
  setCurrency(guildId, null);
  const defaultCurrency = getCurrency(guildId);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Reset currency symbol to default');

  await interaction.deferUpdate();
  await showSettingsPanel(interaction, guildId);
}

// ==================== ADMIN LOGS ====================
async function showLogsPanel(interaction, guildId) {
  const logs = getAdminLogs(guildId, 15);
  await interaction.deferUpdate();

  let logText = '';
  if (logs.length === 0) {
    logText = '*No admin actions recorded yet.*';
  } else {
    logText = logs.map(log => {
      const time = `<t:${Math.floor(log.timestamp / 1000)}:R>`;
      return `${time} — <@${log.user_id}> — ${log.action}`;
    }).join('\n');
  }

  // Truncate if too long for embed
  if (logText.length > 4000) {
    logText = logText.substring(0, 3997) + '...';
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📋 Admin Action Log')
    .setDescription(logText)
    .setFooter({ text: `Showing last ${logs.length} actions (max 50 stored)` });

  const backBtn = new ButtonBuilder()
    .setCustomId('settings_back_main')
    .setLabel('◀️ Back to Settings')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(backBtn);
  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== RESET GAME ====================
async function showResetGamePanel(interaction, guildId) {
  await interaction.deferUpdate();

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚠️ DANGER ZONE - Reset Game')
    .setDescription(
      '**This action will permanently delete ALL player data!**\n\n' +
      'The following will be reset:\n' +
      '• 💰 All cash and bank balances\n' +
      '• 📈 All stock holdings and transactions\n' +
      '• 🏠 All owned properties and cards\n' +
      '• 🎓 All skill levels and XP\n' +
      '• 🥊 All fight records and stats\n' +
      '• 💬 All chat history affecting stock prices\n' +
      '• 🎰 All gambling stats and lottery tickets\n' +
      '• 🔓 All rob/hack history and cooldowns\n' +
      '• 🎒 All user inventories and active effects\n' +
      '• 🏦 All loans, bonds, and bond roles\n\n' +
      '**Settings will NOT be reset** (fees, cooldowns, etc.)\n\n' +
      '⚠️ **THIS CANNOT BE UNDONE!**'
    )
    .setFooter({ text: 'Think carefully before proceeding!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('reset_game_confirm')
      .setLabel('🔴 Reset Everything')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('reset_game_cancel')
      .setLabel('◀️ Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showResetConfirmModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_reset_game_confirm')
    .setTitle('⚠️ Final Confirmation');

  const confirmInput = new TextInputBuilder()
    .setCustomId('reset_confirm_text')
    .setLabel('Type RESET to confirm')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('RESET')
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(5);

  modal.addComponents(new ActionRowBuilder().addComponents(confirmInput));
  await interaction.showModal(modal);
}

async function handleResetGameConfirm(interaction, guildId) {
  const confirmText = interaction.fields.getTextInputValue('reset_confirm_text').trim();

  if (confirmText !== 'RESET') {
    return interaction.reply({
      content: '❌ Reset cancelled. You must type "RESET" exactly to confirm.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const db = getDb();
    if (!db) {
      return interaction.editReply({ content: '❌ Database not available.' });
    }

    // Remove bond roles from all users before clearing data
    try {
      const activeBondsResult = db.exec(`SELECT DISTINCT user_id, role_id, guild_id FROM active_bonds WHERE status = 'active'`);
      if (activeBondsResult.length > 0 && activeBondsResult[0].values.length > 0) {
        const guild = interaction.guild;
        for (const [userId, roleId, bondGuildId] of activeBondsResult[0].values) {
          if (bondGuildId === guildId && roleId) {
            try {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (member) {
                await member.roles.remove(roleId).catch(() => {});
              }
            } catch (e) {
              // Continue if we can't remove a role
            }
          }
        }
      }
    } catch (e) {
      // Table might not exist, continue with reset
    }

    // Tables to DELETE all data from (player data)
    const playerDataTables = [
      'balances', 'economy_transactions',
      'users', 'stocks', 'transactions', 'price_history', 'stock_purchases', 'pending_impacts',
      'owned_properties', 'user_cards', 'card_cooldowns',
      'user_skills',
      'fighter_stats', 'fight_history', 'fight_opponent_history', 'fight_spectator_bets',
      'rob_tracker', 'rob_target_tracker', 'rob_history', 'rob_user_immunity', 'rob_immunity_history',
      'hack_tracker', 'hack_target_tracker', 'hack_history',
      'work_tracker', 'work_history', 'slut_tracker', 'slut_history',
      'gambling_stats', 'lottery_tickets', 'lottery_history', 'scratch_tickets', 'scratch_stats',
      'user_inventory', 'active_effects', 'item_purchase_history', 'item_fulfillment_requests', 'effect_use_cooldowns', 'item_use_cooldowns', 'temporary_role_grants',
      'dividend_history', 'split_history', 'dividend_tracker', 'passive_income_tracker', 'self_dividend_history', 'passive_income_history', 'role_income_tracker', 'role_income_history',
      'wealth_tax_history',
      'message_counters', 'event_history', 'cheese_truck_history', 'active_market_events',
      'loans', 'loan_payments', 'active_bonds', 'bond_history'
    ];

    let deletedCount = 0;
    let errors = [];

    for (const table of playerDataTables) {
      try {
        db.run(`DELETE FROM ${table} WHERE 1=1`);
        deletedCount++;
      } catch (e) {
        if (!e.message.includes('no such table')) {
          errors.push(`${table}: ${e.message}`);
        }
      }
    }

    // Reset lottery pool
    try {
      db.run(`UPDATE lottery SET pool = 0, last_winner_id = NULL, last_winner_amount = 0 WHERE 1=1`);
    } catch (e) {
      // Ignore if table doesn't exist
    }

    saveDatabase();

    logAdminAction(guildId, interaction.user.id, interaction.user.username, 'GAME_RESET',
      `Reset all player data. ${deletedCount} tables cleared.`);

    let resultMsg = `✅ **Game Reset Complete!**\n\n` +
      `Cleared ${deletedCount} data tables.\n` +
      `All player data has been wiped.\n\n` +
      `Settings remain intact - only player progress was reset.`;

    if (errors.length > 0) {
      resultMsg += `\n\n⚠️ Some errors occurred:\n${errors.slice(0, 5).join('\n')}`;
    }

    await interaction.editReply({ content: resultMsg });

  } catch (error) {
    console.error('Error resetting game:', error);
    await interaction.editReply({ content: `❌ Error resetting game: ${error.message}` });
  }
}

// ==================== STARTING BALANCE ====================
async function showStartingBalanceModal(interaction, guildId) {
  const settings = getAdminSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_settings_starting_bal')
    .setTitle('🎁 Starting Balance');

  const input = new TextInputBuilder()
    .setCustomId('starting_bal_value')
    .setLabel('Amount new players receive (0 to disable)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 5000')
    .setValue(String(settings.startingBalance || 0))
    .setRequired(true)
    .setMaxLength(15);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleStartingBalanceModal(interaction, guildId) {
  const raw = interaction.fields.getTextInputValue('starting_bal_value').trim();
  const amount = parseInt(raw);
  if (isNaN(amount) || amount < 0) {
    return interaction.reply({ content: '❌ Please enter a valid number (0 or greater).', flags: 64 });
  }

  const settings = getAdminSettings(guildId);
  settings.startingBalance = amount;
  saveAdminSettings(guildId, settings);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set starting balance to ${amount.toLocaleString()}`);

  await interaction.reply({ content: `✅ Starting balance set to **${amount.toLocaleString()}**. New players will receive this in their bank.`, flags: 64 });
}

// ==================== NEW PLAYER IMMUNITY ====================
async function showImmunityModal(interaction, guildId) {
  const settings = getAdminSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_settings_immunity')
    .setTitle('🛡️ New Player Immunity');

  const input = new TextInputBuilder()
    .setCustomId('immunity_days_value')
    .setLabel('Days of hack/rob immunity (0 to disable)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 7')
    .setValue(String(settings.newPlayerImmunityDays ?? 7))
    .setRequired(true)
    .setMaxLength(5);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleImmunityModal(interaction, guildId) {
  const raw = interaction.fields.getTextInputValue('immunity_days_value').trim();
  const days = parseInt(raw);
  if (isNaN(days) || days < 0) {
    return interaction.reply({ content: '❌ Please enter a valid number (0 or greater).', flags: 64 });
  }

  const settings = getAdminSettings(guildId);
  settings.newPlayerImmunityDays = days;
  saveAdminSettings(guildId, settings);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set new player immunity to ${days} day(s)`);

  const msg = days > 0 
    ? `✅ New player immunity set to **${days} day${days !== 1 ? 's' : ''}**. New players cannot be hacked or robbed during this period.`
    : `✅ New player immunity **disabled**. Players can be hacked/robbed immediately.`;
  await interaction.reply({ content: msg, flags: 64 });
}

// ==================== SUPPORT SERVER URL ====================
async function showSupportUrlModal(interaction, guildId) {
  const currentUrl = getSupportServerUrl(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_settings_support_url')
    .setTitle('🔗 Support Server URL');

  const input = new TextInputBuilder()
    .setCustomId('support_url_value')
    .setLabel('Discord invite link (leave blank to remove)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://discord.gg/example')
    .setRequired(false)
    .setMaxLength(200);

  if (currentUrl) input.setValue(currentUrl);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleSupportUrlModal(interaction, guildId) {
  const url = interaction.fields.getTextInputValue('support_url_value').trim();

  if (!url) {
    setSupportServerUrl(guildId, null);
    logAdminAction(guildId, interaction.user.id, interaction.user.username, 'Removed support server URL');
    return interaction.reply({ content: '✅ Support server URL removed.', flags: 64 });
  }

  // Basic URL validation
  if (!/^https?:\/\/.+/i.test(url)) {
    return interaction.reply({ content: '❌ Please enter a valid URL starting with https://', flags: 64 });
  }

  setSupportServerUrl(guildId, url);
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set support server URL to ${url}`);
  await interaction.reply({ content: `✅ Support server URL set to ${url}\nA link button will now appear in \`/help\`.`, flags: 64 });
}

module.exports = {
  handleInteraction,
  showSettingsPanel
};
