// Admin Dashboard - Main Router (Modular Design)
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { hasAdminPermission, logAdminAction } = require('../admin');
const { getDb, saveDatabase } = require('../database');

// Import modular handlers
const adminProperty = require('./admin-property');
const adminGambling = require('./admin-gambling');
const adminWork = require('./admin-work');
const adminHack = require('./admin-hack');
const adminFight = require('./admin-fight');
const adminSystem = require('./admin-system');
const adminWealthTax = require('./admin-wealth-tax');
const adminBank = require('./admin-bank');
const adminDividends = require('./admin-dividends');
const adminSkills = require('./admin-skills');
const adminItems = require('./admin-items');

// ==================== MAIN DASHBOARD ====================
async function showDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Admin Dashboard')
    .setDescription('Select a feature to manage')
    .addFields(
      { name: '💰 Economy', value: 'Wealth tax, bank, dividends', inline: true },
      { name: '🏠 Properties', value: 'Cards, tiers, requirements', inline: true },
      { name: '🎰 Gambling', value: 'Lottery, scratch cards, vault', inline: true },
      { name: '⚙️ System', value: 'Anti-spam, market & fees', inline: true },
      { name: '📊 Events', value: 'Market events & triggers', inline: true },
      { name: '💵 Income', value: 'Work, crime, slut commands', inline: true }
    );

  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_select')
      .setPlaceholder('Choose a feature...')
      .setMaxValues(1)
      .addOptions(
        { label: 'Wealth Tax', value: 'wealth_tax', emoji: '💰', description: 'Progressive taxation system' },
        { label: 'Bank Settings', value: 'bank', emoji: '🏦', description: 'Loans and bonds' },
        { label: 'Dividends', value: 'dividends', emoji: '📈', description: 'Passive income settings' },
        { label: 'Properties', value: 'property', emoji: '🏠', description: 'Property & card management' },
        { label: 'Gambling', value: 'gambling', emoji: '🎰', description: 'Lottery, scratch cards & games' },
        { label: 'Vault', value: 'vault', emoji: '💎', description: 'Vault spawning' },
        { label: 'Anti-Spam', value: 'antispam', emoji: '🛡️', description: 'Cooldown settings' },
        { label: 'Market', value: 'market', emoji: '📊', description: 'Fees, taxes & cooldowns' },
        { label: 'Ticker', value: 'ticker', emoji: '📰', description: 'Stock ticker channel' },
        { label: 'Events', value: 'events', emoji: '📅', description: 'Market event config' },
        { label: 'Cooldown Tracker', value: 'tracker', emoji: '⏱️', description: 'Live cooldown display' },
        { label: 'Income', value: 'income', emoji: '💵', description: 'Work, crime, slut settings' },
        { label: 'Rob', value: 'rob', emoji: '🔓', description: 'Rob & immunity settings' },
        { label: 'Hack', value: 'hack', emoji: '💻', description: 'Bank hacking settings' },
        { label: 'Fight', value: 'fight', emoji: '🥊', description: 'PvP cage fighting' },
        { label: 'Skills', value: 'skills', emoji: '🎓', description: 'XP, training & level bonuses' },
        { label: 'Item Shop', value: 'items', emoji: '🛒', description: 'Shop items & effects' },
        { label: '⚠️ Reset Game', value: 'reset_game', emoji: '🔄', description: 'DANGER: Reset all player data' }
      )
  );

  await interaction.editReply({ embeds: [embed], components: [select] });
}

// ==================== SLASH COMMAND ====================
module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open the stock market admin dashboard'),

  async execute(interaction) {
    const guildId = interaction.guildId;

    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: 64 });
    }

    if (!hasAdminPermission(interaction.member, guildId)) {
      return await interaction.editReply({
        content: '❌ You need admin permissions to use this command.',
        flags: 64
      });
    }

    await showDashboard(interaction);
  }
};

// ==================== INTERACTION ROUTER ====================
module.exports.handleAdminInteraction = async function(interaction) {
  const guildId = interaction.guildId;
  
  try {
    // Main menu selection - handle first and defer immediately to avoid timeout
    if (interaction.isStringSelectMenu() && interaction.customId === 'admin_select') {
      const selected = interaction.values[0];
      await interaction.deferUpdate();

      switch (selected) {
        case 'wealth_tax': await adminWealthTax.showWealthTaxPanel(interaction, guildId, true); break;
        case 'bank': await adminBank.showBankPanel(interaction, guildId, true); break;
        case 'dividends': await adminDividends.showDividendPanel(interaction, guildId); break;
        case 'property': await adminProperty.showPropertyPanel(interaction, guildId); break;
        case 'gambling': await adminGambling.showGamblingPanel(interaction, guildId); break;
        case 'scratch': await adminGambling.showScratchConfigPanel(interaction, guildId); break;
        case 'vault': await adminGambling.showVaultPanel(interaction, guildId); break;
        case 'antispam': await adminSystem.showAntiSpamPanel(interaction, guildId); break;
        case 'market': await adminSystem.showMarketPanel(interaction, guildId); break;
        case 'ticker': await adminSystem.showTickerPanel(interaction, guildId); break;
        case 'events': await adminSystem.showEventsPanel(interaction, guildId); break;
        case 'tracker': await adminSystem.showTrackerPanel(interaction, guildId); break;
        case 'income': await adminWork.showIncomePanel(interaction, guildId); break;
        case 'rob': await adminWork.showRobPanel(interaction, guildId); break;
        case 'hack': await adminHack.showHackPanel(interaction, guildId); break;
        case 'fight': await adminFight.showFightPanel(interaction, guildId); break;
        case 'skills': await adminSkills.showSkillsPanel(interaction, guildId); break;
        case 'items': await adminItems.showItemsPanel(interaction, guildId); break;
        case 'reset_game': await showResetGamePanel(interaction, guildId); break;
      }
      return;
    }

    // Try fully modular handlers for other interactions
    console.log('[Admin] Checking handlers for customId:', interaction.customId);
    if (await adminProperty.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Property'); return; }
    if (await adminGambling.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Gambling'); return; }
    if (await adminWork.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Work'); return; }
    if (await adminHack.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Hack'); return; }
    if (await adminFight.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Fight'); return; }
    if (await adminSystem.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by System'); return; }
    if (await adminWealthTax.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by WealthTax'); return; }
    if (await adminDividends.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Dividends'); return; }
    if (await adminBank.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Bank'); return; }
    if (await adminSkills.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Skills'); return; }
    if (await adminItems.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Items'); return; }
    console.log('[Admin] No handler matched for:', interaction.customId);

    // Back to dashboard button
    if (interaction.isButton() && interaction.customId === 'back_dashboard') {
      await interaction.deferUpdate();
      await showDashboard(interaction);
      return;
    }
    
    // Reset game handlers
    if (interaction.isButton() && interaction.customId === 'reset_game_confirm') {
      await showResetConfirmModal(interaction);
      return;
    }
    
    if (interaction.isButton() && interaction.customId === 'reset_game_cancel') {
      await interaction.deferUpdate();
      await showDashboard(interaction);
      return;
    }
    
    if (interaction.isModalSubmit() && interaction.customId === 'modal_reset_game_confirm') {
      await handleResetGameConfirm(interaction, guildId);
      return;
    }

  } catch (error) {
    console.error('[Admin] Interaction error:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${error.message}`, flags: 64 });
      }
    } catch {}
  }
};
// ==================== RESET GAME PANEL ====================
async function showResetGamePanel(interaction, guildId) {
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
      '• 🎒 All user inventories and active effects\n\n' +
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
      .setLabel('Cancel')
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

    // Tables to DELETE all data from (player data)
    const playerDataTables = [
      // Core economy
      'balances',
      'economy_transactions',
      
      // Stocks
      'users',
      'stocks',
      'transactions',
      'price_history',
      'stock_purchases',
      'pending_impacts',
      
      // Properties
      'owned_properties',
      'user_cards',
      'card_cooldowns',
      
      // Skills
      'user_skills',
      
      // Fight
      'fighter_stats',
      'fight_history',
      'fight_opponent_history',
      'fight_spectator_bets',
      
      // Rob
      'rob_tracker',
      'rob_target_tracker',
      'rob_history',
      'rob_user_immunity',
      'rob_immunity_history',
      
      // Hack
      'hack_tracker',
      'hack_target_tracker',
      'hack_history',
      
      // Work/Slut
      'work_tracker',
      'work_history',
      'slut_tracker',
      'slut_history',
      
      // Gambling
      'gambling_stats',
      'lottery_tickets',
      'lottery_history',
      'scratch_tickets',
      'scratch_stats',
      
      // Items
      'user_inventory',
      'active_effects',
      'item_purchase_history',
      'item_fulfillment_requests',
      'effect_use_cooldowns',
      'temporary_role_grants',
      
      // Dividends/Income tracking
      'dividend_history',
      'split_history',
      'dividend_tracker',
      'passive_income_tracker',
      'self_dividend_history',
      'passive_income_history',
      'role_income_tracker',
      'role_income_history',
      
      // Wealth tax
      'wealth_tax_history',
      
      // Events
      'message_counters',
      'event_history',
      'cheese_truck_history',
      'active_market_events'
    ];

    let deletedCount = 0;
    let errors = [];

    for (const table of playerDataTables) {
      try {
        db.run(`DELETE FROM ${table} WHERE 1=1`);
        deletedCount++;
      } catch (e) {
        // Table might not exist, that's okay
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

    // Save the database
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