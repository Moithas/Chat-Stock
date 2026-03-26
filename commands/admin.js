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
const adminDungeon = require('./admin-dungeon');
const adminSYN = require('./admin-syn');
const adminInfamy = require('./admin-infamy');
const adminSettings = require('./admin-settings');
const adminPrestige = require('./admin-prestige');

// ==================== MAIN DASHBOARD ====================
async function showDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('⚙️ Chat-Stock Admin Dashboard')
    .setDescription('Manage all bot systems from one place. Select a module below.')
    .addFields(
      { name: '💰 Economy',    value: 'Wealth tax, bank & dividends',    inline: true },
      { name: '💵 Income',     value: 'Work, Hunt & Lucky Penny',        inline: true },
      { name: '🎰 Gambling',   value: 'Lottery, scratch, SYN & vault',   inline: true },
      { name: '⚔️ Combat',     value: 'Fight, dungeon, rob & hack',      inline: true },
      { name: '🏴‍☠️ Infamy',     value: 'Criminal reputation & bounties',  inline: true },
      { name: '�️ Prestige',    value: 'Tiers, multipliers & resets',     inline: true },
      { name: '�🎓 Skills',     value: 'XP, training & level bonuses',    inline: true },
      { name: '🛒 Items',      value: 'Shop items, prices & effects',    inline: true },
      { name: '🏠 Properties', value: 'Wealth cards, tiers & upgrades',  inline: true },
      { name: '⚙️ System',     value: 'Market, ticker, events & spam',   inline: true },
      { name: '🔧 Tools',      value: 'Tracker & bump rewards',         inline: true },
      { name: '⚙️ Settings',    value: 'Admin role, currency & logs',     inline: true }
    )
    .setFooter({ text: 'Chat-Stock Admin • 23 configurable modules' });

  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_select')
      .setPlaceholder('Select a module to configure...')
      .setMaxValues(1)
      .addOptions(
        // — Economy —
        { label: 'Wealth Tax',      value: 'wealth_tax', emoji: '💰', description: 'Progressive tax brackets & rates' },
        { label: 'Bank',            value: 'bank',       emoji: '🏦', description: 'Loans, bonds & credit scores' },
        { label: 'Dividends',       value: 'dividends',  emoji: '📈', description: 'Shareholder payout schedule & rates' },

        // — Income —
        { label: 'Income',          value: 'income',     emoji: '💵', description: 'Work, Hunt & Lucky Penny settings' },

        // — Gambling —
        { label: 'Gambling',        value: 'gambling',   emoji: '🎰', description: 'Lottery, scratch cards & table games' },
        { label: 'Vault',           value: 'vault',      emoji: '💎', description: 'Random vault spawning & rewards' },
        { label: 'SYN',             value: 'syn',        emoji: '🃏', description: 'Screw Your Neighbor card game' },

        // — Combat —
        { label: 'Fight',           value: 'fight',      emoji: '🥊', description: 'PvP cage fighting & wagers' },
        { label: 'Dungeon',         value: 'dungeon',    emoji: '🏰', description: 'Solo PvE dungeon crawl' },
        { label: 'Rob',             value: 'rob',        emoji: '🔓', description: 'Rob system & immunity tiers' },
        { label: 'Hack',            value: 'hack',       emoji: '💻', description: 'Bank hacking & defenses' },
        { label: 'Skills',          value: 'skills',     emoji: '🎓', description: 'XP, training & level bonuses' },
        { label: 'Infamy',          value: 'infamy',     emoji: '🏴‍☠️', description: 'Criminal reputation & bounty system' },
        { label: 'Prestige',        value: 'prestige',   emoji: '🎖️', description: 'Prestige tiers & permanent bonuses' },

        // — Assets —
        { label: 'Properties',      value: 'property',   emoji: '🏠', description: 'Wealth cards, tiers & upgrades' },
        { label: 'Item Shop',       value: 'items',      emoji: '🛒', description: 'Shop items, prices & effects' },

        // — System —
        { label: 'Anti-Spam',       value: 'antispam',   emoji: '🛡️', description: 'Message rate limiting' },
        { label: 'Market',          value: 'market',     emoji: '📊', description: 'Fees, taxes & trade settings' },
        { label: 'Ticker',          value: 'ticker',     emoji: '📰', description: 'Stock ticker channel setup' },
        { label: 'Events',          value: 'events',     emoji: '📅', description: 'Market events & triggers' },
        { label: 'Cooldown Tracker',value: 'tracker',    emoji: '⏱️', description: 'Live cooldown display panel' },
        { label: 'Bump Rewards',    value: 'bump',       emoji: '📣', description: 'Disboard bump reward settings' },

        // — Settings —
        { label: 'Settings',         value: 'settings',   emoji: '🔧', description: 'Admin role, currency, logs & reset' }
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
        case 'bump': await adminSystem.showBumpPanel(interaction, guildId); break;
        case 'income': await adminWork.showIncomePanel(interaction, guildId); break;
        case 'rob': await adminWork.showRobPanel(interaction, guildId); break;
        case 'hack': await adminHack.showHackPanel(interaction, guildId); break;
        case 'fight': await adminFight.showFightPanel(interaction, guildId); break;
        case 'skills': await adminSkills.showSkillsPanel(interaction, guildId); break;
        case 'items': await adminItems.showItemsPanel(interaction, guildId); break;
        case 'dungeon': await adminDungeon.showDungeonPanel(interaction, guildId); break;
        case 'syn': await adminSYN.showSYNPanel(interaction, guildId); break;
        case 'infamy': await adminInfamy.showInfamyPanel(interaction, guildId); break;
        case 'prestige': await adminPrestige.showPrestigePanel(interaction, guildId); break;
        case 'settings': await adminSettings.showSettingsPanel(interaction, guildId); break;
        case 'reset_game': await adminSettings.showSettingsPanel(interaction, guildId); break;
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
    if (await adminDungeon.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Dungeon'); return; }
    if (await adminSYN.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by SYN'); return; }
    if (await adminInfamy.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Infamy'); return; }
    if (await adminPrestige.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Prestige'); return; }
    if (await adminSettings.handleInteraction(interaction, guildId)) { console.log('[Admin] Handled by Settings'); return; }
    console.log('[Admin] No handler matched for:', interaction.customId);

    // Back to dashboard button
    if (interaction.isButton() && interaction.customId === 'back_dashboard') {
      await interaction.deferUpdate();
      await showDashboard(interaction);
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