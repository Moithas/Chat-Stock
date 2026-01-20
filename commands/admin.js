// Admin Dashboard - Main Router (Modular Design)
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { hasAdminPermission, logAdminAction } = require('../admin');

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
        { label: 'Income', value: 'income', emoji: '💵', description: 'Work, crime, slut settings' },
        { label: 'Rob', value: 'rob', emoji: '🔓', description: 'Rob & immunity settings' },
        { label: 'Hack', value: 'hack', emoji: '💻', description: 'Bank hacking settings' },
        { label: 'Fight', value: 'fight', emoji: '🥊', description: 'PvP cage fighting' },
        { label: 'Skills', value: 'skills', emoji: '🎓', description: 'XP, training & level bonuses' },
        { label: 'Item Shop', value: 'items', emoji: '🛒', description: 'Shop items & effects' }
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
        case 'income': await adminWork.showIncomePanel(interaction, guildId); break;
        case 'rob': await adminWork.showRobPanel(interaction, guildId); break;
        case 'hack': await adminHack.showHackPanel(interaction, guildId); break;
        case 'fight': await adminFight.showFightPanel(interaction, guildId); break;
        case 'skills': await adminSkills.showSkillsPanel(interaction, guildId); break;
        case 'items': await adminItems.showItemsPanel(interaction, guildId); break;
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

  } catch (error) {
    console.error('[Admin] Interaction error:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${error.message}`, flags: 64 });
      }
    } catch {}
  }
};
