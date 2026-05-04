// Admin Work Panel - Work, Hunt, Lucky Penny, Rob settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder } = require('discord.js');
const { logAdminAction, getCurrency } = require('../admin');
const { getWorkSettings, updateWorkSettings } = require('../work');
const { getHuntSettings, updateHuntSettings } = require('../hunt');
const { getShopItems, getShopItem, updateShopItem } = require('../items');
const { getLuckyPennySettings, updateLuckyPennySettings, DEFAULT_SETTINGS: LP_DEFAULTS } = require('../luckypenny');
const { getRobSettings, updateRobSettings, getImmuneRoles, addImmuneRole, removeImmuneRole } = require('../rob');



// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_income_work', 'admin_income_hunt', 'admin_income_lp',
  'work_toggle', 'work_edit_settings',
  'hunt_toggle', 'hunt_edit_settings',
  'hunt_manage_items', 'hunt_items_prev', 'hunt_items_next',
  'back_hunt',
  'admin_lp_toggle', 'admin_lp_edit_general', 'admin_lp_edit_buffs', 'admin_lp_edit_currency',
  'rob_toggle', 'rob_edit_settings', 'rob_immunity_settings', 'rob_add_immune_role', 'rob_clear_immune_roles', 'rob_defense_settings',
  'rob_defense_toggle', 'rob_defense_edit', 'back_rob_defense',
  'rob_target_cooldown',
  'back_income', 'back_work' // Back to income panel, back from rob immunity
];

const MODAL_IDS = [
  'modal_work_settings',
  'modal_hunt_settings',
  'modal_admin_lp_general', 'modal_admin_lp_buffs', 'modal_admin_lp_currency',
  'modal_rob_settings',
  'modal_rob_defense_settings',
  'modal_rob_target_cooldown'
];

const SELECT_IDS = [
  'rob_immunity_role_select'
];

const HUNT_ITEMS_PER_PAGE = 8;
const huntPagination = new Map();

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    // Dynamic hunt item toggle buttons
    if (customId.startsWith('hunt_item_toggle_')) {
      const itemId = parseInt(customId.split('hunt_item_toggle_')[1]);
      await handleToggleHuntItem(interaction, guildId, itemId);
      return true;
    }

    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      // Income panel navigation
      case 'admin_income_work':
        await interaction.deferUpdate();
        await showWorkPanel(interaction, guildId);
        return true;
      case 'admin_income_hunt':
        await interaction.deferUpdate();
        await showHuntPanel(interaction, guildId);
        return true;
      case 'admin_income_lp':
        await interaction.deferUpdate();
        await showLuckyPennyPanel(interaction, guildId);
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
        
      // Hunt buttons
      case 'hunt_toggle':
        await handleHuntToggle(interaction, guildId);
        return true;
      case 'hunt_edit_settings':
        await handleHuntEditSettings(interaction, guildId);
        return true;
      case 'hunt_manage_items':
        await interaction.deferUpdate();
        await showHuntItemsPanel(interaction, guildId, 0);
        return true;
      case 'hunt_items_prev': {
        await interaction.deferUpdate();
        const stateKey = `${guildId}-${interaction.user.id}`;
        const state = huntPagination.get(stateKey) || { page: 0 };
        await showHuntItemsPanel(interaction, guildId, Math.max(0, state.page - 1));
        return true;
      }
      case 'hunt_items_next': {
        await interaction.deferUpdate();
        const stateKey = `${guildId}-${interaction.user.id}`;
        const state = huntPagination.get(stateKey) || { page: 0 };
        await showHuntItemsPanel(interaction, guildId, state.page + 1);
        return true;
      }
      case 'back_hunt':
        await interaction.deferUpdate();
        await showHuntPanel(interaction, guildId);
        return true;
        
      // Lucky Penny buttons
      case 'admin_lp_toggle':
        await interaction.deferUpdate();
        await handleLpToggle(interaction, guildId);
        return true;
      case 'admin_lp_edit_general':
        await handleLpEditGeneral(interaction, guildId);
        return true;
      case 'admin_lp_edit_buffs':
        await handleLpEditBuffs(interaction, guildId);
        return true;
      case 'admin_lp_edit_currency':
        await handleLpEditCurrency(interaction, guildId);
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
      case 'modal_hunt_settings':
        await handleHuntSettingsModal(interaction, guildId);
        return true;
      case 'modal_admin_lp_general':
        await handleLpGeneralModal(interaction, guildId);
        return true;
      case 'modal_admin_lp_buffs':
        await handleLpBuffsModal(interaction, guildId);
        return true;
      case 'modal_admin_lp_currency':
        await handleLpCurrencyModal(interaction, guildId);
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
  let workSettings, huntSettings, lpSettings;
  try { workSettings = getWorkSettings(guildId); } catch { workSettings = { enabled: false }; }
  try { huntSettings = getHuntSettings(guildId); } catch { huntSettings = { enabled: false }; }
  try { lpSettings = getLuckyPennySettings(guildId); } catch { lpSettings = { enabled: false }; }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💵 Income Settings')
    .setDescription('Configure income commands - safe and risky ways to earn money')
    .addFields(
      { name: '💼 Work', value: workSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🏹 Hunt', value: huntSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🪙 Lucky Penny', value: lpSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true }
    );

  const workBtn = new ButtonBuilder()
    .setCustomId('admin_income_work')
    .setLabel('💼 Work')
    .setStyle(ButtonStyle.Primary);

  const huntBtn = new ButtonBuilder()
    .setCustomId('admin_income_hunt')
    .setLabel('🏹 Hunt')
    .setStyle(ButtonStyle.Primary);

  const lpBtn = new ButtonBuilder()
    .setCustomId('admin_income_lp')
    .setLabel('🪙 Lucky Penny')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(workBtn, huntBtn, lpBtn, backBtn);

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

// ==================== HUNT PANEL ====================
async function showHuntPanel(interaction, guildId) {
  const settings = getHuntSettings(guildId);
  const totalWeight = settings.itemChance + settings.currencyChance + settings.nothingChance;

  const embed = new EmbedBuilder()
    .setColor(settings.enabled ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🏹 Hunt Settings')
    .setDescription('Configure the hunt (random item/currency drops from the income panel)')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '⏱️ Cooldown', value: `${settings.cooldownMinutes} minutes`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💰 Currency Range', value: `${settings.minCurrency.toLocaleString()} - ${settings.maxCurrency.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🎁 Item Chance', value: `${settings.itemChance}/${totalWeight} (${Math.round(settings.itemChance / totalWeight * 100)}%)`, inline: true },
      { name: '💵 Currency Chance', value: `${settings.currencyChance}/${totalWeight} (${Math.round(settings.currencyChance / totalWeight * 100)}%)`, inline: true },
      { name: '❌ Nothing Chance', value: `${settings.nothingChance}/${totalWeight} (${Math.round(settings.nothingChance / totalWeight * 100)}%)`, inline: true }
    );

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('hunt_toggle')
        .setLabel(settings.enabled ? 'Disable' : 'Enable')
        .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(settings.enabled ? '❌' : '✅'),
      new ButtonBuilder()
        .setCustomId('hunt_edit_settings')
        .setLabel('Edit Settings')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⚙️'),
      new ButtonBuilder()
        .setCustomId('hunt_manage_items')
        .setLabel('Manage Eligible Items')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🎁'),
      new ButtonBuilder()
        .setCustomId('back_income')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleHuntToggle(interaction, guildId) {
  const settings = getHuntSettings(guildId);
  updateHuntSettings(guildId, { enabled: !settings.enabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'HUNT_TOGGLE',
    `Hunt ${!settings.enabled ? 'enabled' : 'disabled'}`);
  await interaction.deferUpdate();
  await showHuntPanel(interaction, guildId);
}

async function handleHuntEditSettings(interaction, guildId) {
  const settings = getHuntSettings(guildId);
  const modal = createHuntSettingsModal(settings);
  await interaction.showModal(modal);
}

async function handleHuntSettingsModal(interaction, guildId) {
  const cooldownMinutes = parseInt(interaction.fields.getTextInputValue('cooldown_minutes')) || 60;
  const minCurrency = parseInt(interaction.fields.getTextInputValue('min_currency')) || 50;
  const maxCurrency = parseInt(interaction.fields.getTextInputValue('max_currency')) || 300;

  const chancesRaw = interaction.fields.getTextInputValue('chances');
  const chanceParts = chancesRaw.split('/').map(s => parseInt(s.trim()));

  let itemChance = 15, currencyChance = 50, nothingChance = 35;
  if (chanceParts.length === 3 && chanceParts.every(n => !isNaN(n) && n >= 0)) {
    itemChance = chanceParts[0];
    currencyChance = chanceParts[1];
    nothingChance = chanceParts[2];
  }

  if (minCurrency > maxCurrency) {
    return interaction.reply({ content: '❌ Minimum currency cannot be greater than maximum!', flags: 64 });
  }

  const totalChance = itemChance + currencyChance + nothingChance;
  if (totalChance <= 0) {
    return interaction.reply({ content: '❌ At least one chance value must be greater than 0!', flags: 64 });
  }

  updateHuntSettings(guildId, {
    cooldownMinutes: Math.max(1, cooldownMinutes),
    minCurrency: Math.max(0, minCurrency),
    maxCurrency: Math.max(1, maxCurrency),
    itemChance,
    currencyChance,
    nothingChance
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'HUNT_SETTINGS',
    `Updated hunt: cooldown=${cooldownMinutes}m, currency=${minCurrency}-${maxCurrency}, chances=${itemChance}/${currencyChance}/${nothingChance}`);

  await interaction.reply({ content: '✅ Hunt settings updated!', flags: 64 });
  await showHuntPanel(interaction, guildId);
}

function createHuntSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_hunt_settings')
    .setTitle('Hunt Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown_minutes')
          .setLabel('Cooldown (minutes)')
          .setPlaceholder('60')
          .setValue(String(settings.cooldownMinutes))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_currency')
          .setLabel('Minimum Currency Reward')
          .setPlaceholder('50')
          .setValue(String(settings.minCurrency))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_currency')
          .setLabel('Maximum Currency Reward')
          .setPlaceholder('300')
          .setValue(String(settings.maxCurrency))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('chances')
          .setLabel('Chances: Item / Currency / Nothing')
          .setPlaceholder('15 / 50 / 35')
          .setValue(`${settings.itemChance} / ${settings.currencyChance} / ${settings.nothingChance}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== HUNT ITEM ELIGIBILITY ====================
async function showHuntItemsPanel(interaction, guildId, page = 0) {
  const allItems = getShopItems(guildId, null, false);
  const totalPages = Math.max(1, Math.ceil(allItems.length / HUNT_ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const startIndex = currentPage * HUNT_ITEMS_PER_PAGE;
  const pageItems = allItems.slice(startIndex, startIndex + HUNT_ITEMS_PER_PAGE);

  const stateKey = `${guildId}-${interaction.user.id}`;
  huntPagination.set(stateKey, { page: currentPage });

  const eligibleCount = allItems.filter(i => i.hunt_eligible === 1).length;

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🏹 Hunt-Eligible Items')
    .setDescription(`Toggle which items can drop from hunt.\n**${eligibleCount}** of **${allItems.length}** items are eligible.`)
    .setFooter({ text: `Page ${currentPage + 1}/${totalPages}` });

  if (pageItems.length === 0) {
    embed.setDescription(embed.data.description + '\n\nNo shop items exist yet. Create items in the Item Shop admin panel first.');
  } else {
    let desc = embed.data.description + '\n\n';
    for (const item of pageItems) {
      const eligible = item.hunt_eligible === 1;
      const status = eligible ? '🏹' : '⬛';
      const shopStatus = item.enabled === 1 ? '' : ' *(not in shop)*';
      desc += `${status} ${item.emoji} **${item.name}**${shopStatus}\n`;
    }
    embed.setDescription(desc);
  }

  const components = [];

  if (pageItems.length > 0) {
    const row1Items = pageItems.slice(0, 4);
    const row2Items = pageItems.slice(4, 8);

    if (row1Items.length > 0) {
      const row1 = new ActionRowBuilder();
      for (const item of row1Items) {
        const eligible = item.hunt_eligible === 1;
        row1.addComponents(
          new ButtonBuilder()
            .setCustomId(`hunt_item_toggle_${item.id}`)
            .setLabel(item.name.substring(0, 20))
            .setStyle(eligible ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(eligible ? '🏹' : '⬛')
        );
      }
      components.push(row1);
    }

    if (row2Items.length > 0) {
      const row2 = new ActionRowBuilder();
      for (const item of row2Items) {
        const eligible = item.hunt_eligible === 1;
        row2.addComponents(
          new ButtonBuilder()
            .setCustomId(`hunt_item_toggle_${item.id}`)
            .setLabel(item.name.substring(0, 20))
            .setStyle(eligible ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(eligible ? '🏹' : '⬛')
        );
      }
      components.push(row2);
    }
  }

  const navRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('hunt_items_prev')
        .setLabel('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('hunt_items_next')
        .setLabel('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('back_hunt')
        .setLabel('Back to Hunt')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  components.push(navRow);

  await interaction.editReply({ embeds: [embed], components });
}

async function handleToggleHuntItem(interaction, guildId, itemId) {
  const item = getShopItem(guildId, itemId);
  if (!item) {
    return interaction.reply({ content: '❌ Item not found!', flags: 64 });
  }

  const currentEligible = item.hunt_eligible === 1;
  updateShopItem(guildId, itemId, { hunt_eligible: currentEligible ? 0 : 1 });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'HUNT_ITEM_TOGGLE',
    `${currentEligible ? 'Removed from' : 'Added to'} hunt pool: ${item.name}`);

  await interaction.deferUpdate();
  const stateKey = `${guildId}-${interaction.user.id}`;
  const state = huntPagination.get(stateKey) || { page: 0 };
  await showHuntItemsPanel(interaction, guildId, state.page);
}

// ==================== LUCKY PENNY PANEL ====================
async function showLuckyPennyPanel(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(settings.enabled ? 0xf1c40f : 0x95a5a6)
    .setTitle('🪙 Lucky Penny Settings')
    .setDescription('Configure the Lucky Penny buff/debuff/currency roller')
    .addFields(
      { name: '⚙️ General', value: 
        `Status: **${settings.enabled ? '✅ Enabled' : '❌ Disabled'}**\n` +
        `Cooldown: **${settings.cooldownHours}** hours\n` +
        `Nothing Cooldown: **${settings.nothingCooldownHours}** hours`,
        inline: true 
      },
      { name: '🎲 Buff/Debuff Range', value: 
        `Strength: **${settings.minBuffPercent}%** - **${settings.maxBuffPercent}%**\n` +
        `Duration: **${settings.minDurationHours}h** - **${settings.maxDurationHours}h**`,
        inline: true 
      },
      { name: `💰 Currency Range`, value: 
        `Min: **${settings.minCurrency.toLocaleString()}** ${getCurrency(guildId)}\n` +
        `Max: **${settings.maxCurrency.toLocaleString()}** ${getCurrency(guildId)}`,
        inline: true 
      },
      { name: '📊 Outcome Odds', value: 
        `🎲 Buff or Debuff: **33.3%**\n` +
        `💰 Currency: **33.3%**\n` +
        `💨 Nothing: **33.3%**\n` +
        `_(Buff vs Debuff is 50/50 within the buff outcome)_`,
        inline: false 
      }
    )
    .setFooter({ text: 'Lucky Penny buffs stack with item effects • Stored in active_effects table' });

  const toggleBtn = new ButtonBuilder()
    .setCustomId('admin_lp_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(settings.enabled ? '❌' : '✅');

  const editGeneralBtn = new ButtonBuilder()
    .setCustomId('admin_lp_edit_general')
    .setLabel('Cooldown')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('⏱️');

  const editBuffsBtn = new ButtonBuilder()
    .setCustomId('admin_lp_edit_buffs')
    .setLabel('Buff Settings')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🎲');

  const editCurrencyBtn = new ButtonBuilder()
    .setCustomId('admin_lp_edit_currency')
    .setLabel('Currency Settings')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('💰');

  const backBtn = new ButtonBuilder()
    .setCustomId('back_income')
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('◀️');

  const row1 = new ActionRowBuilder().addComponents(toggleBtn, editGeneralBtn, editBuffsBtn, editCurrencyBtn);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function handleLpToggle(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  const newEnabled = !settings.enabled;
  updateLuckyPennySettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username,
    `${newEnabled ? 'Enabled' : 'Disabled'} Lucky Penny system`);
  await showLuckyPennyPanel(interaction, guildId);
}

async function handleLpEditGeneral(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_lp_general')
    .setTitle('Edit Lucky Penny Cooldown');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cooldown_hours')
        .setLabel('Cooldown (hours)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.cooldownHours))
        .setPlaceholder('8')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nothing_cooldown_hours')
        .setLabel('Nothing Cooldown (hours) — reduced CD')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.nothingCooldownHours))
        .setPlaceholder('2')
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleLpGeneralModal(interaction, guildId) {
  const cooldownHours = parseFloat(interaction.fields.getTextInputValue('cooldown_hours')) || LP_DEFAULTS.cooldownHours;
  const nothingCooldownHours = parseFloat(interaction.fields.getTextInputValue('nothing_cooldown_hours')) || LP_DEFAULTS.nothingCooldownHours;

  updateLuckyPennySettings(guildId, {
    cooldownHours: Math.max(0.5, cooldownHours),
    nothingCooldownHours: Math.max(0, Math.min(nothingCooldownHours, cooldownHours))
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username,
    `Updated Lucky Penny cooldown: ${cooldownHours}h (nothing: ${nothingCooldownHours}h)`);

  await interaction.deferUpdate();
  await showLuckyPennyPanel(interaction, guildId);
}

async function handleLpEditBuffs(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_lp_buffs')
    .setTitle('Edit Buff/Debuff Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('min_percent')
        .setLabel('Min Buff/Debuff % (strength)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.minBuffPercent))
        .setPlaceholder('10')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('max_percent')
        .setLabel('Max Buff/Debuff % (strength)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.maxBuffPercent))
        .setPlaceholder('30')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('min_duration')
        .setLabel('Min Duration (hours)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.minDurationHours))
        .setPlaceholder('2')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('max_duration')
        .setLabel('Max Duration (hours)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.maxDurationHours))
        .setPlaceholder('8')
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleLpBuffsModal(interaction, guildId) {
  const minPercent = parseInt(interaction.fields.getTextInputValue('min_percent')) || LP_DEFAULTS.minBuffPercent;
  const maxPercent = parseInt(interaction.fields.getTextInputValue('max_percent')) || LP_DEFAULTS.maxBuffPercent;
  const minDuration = parseInt(interaction.fields.getTextInputValue('min_duration')) || LP_DEFAULTS.minDurationHours;
  const maxDuration = parseInt(interaction.fields.getTextInputValue('max_duration')) || LP_DEFAULTS.maxDurationHours;

  updateLuckyPennySettings(guildId, {
    minBuffPercent: Math.max(1, Math.min(minPercent, 100)),
    maxBuffPercent: Math.max(1, Math.min(Math.max(maxPercent, minPercent), 100)),
    minDurationHours: Math.max(1, minDuration),
    maxDurationHours: Math.max(Math.max(1, minDuration), maxDuration)
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username,
    `Updated Lucky Penny buffs: ${minPercent}-${maxPercent}% strength, ${minDuration}-${maxDuration}h duration`);

  await interaction.deferUpdate();
  await showLuckyPennyPanel(interaction, guildId);
}

async function handleLpEditCurrency(interaction, guildId) {
  const settings = getLuckyPennySettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_lp_currency')
    .setTitle('Edit Currency Reward Range');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('min_currency')
        .setLabel('Min Currency Reward')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.minCurrency))
        .setPlaceholder('500')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('max_currency')
        .setLabel('Max Currency Reward')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.maxCurrency))
        .setPlaceholder('1500')
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleLpCurrencyModal(interaction, guildId) {
  const minCurrency = parseInt(interaction.fields.getTextInputValue('min_currency')) || LP_DEFAULTS.minCurrency;
  const maxCurrency = parseInt(interaction.fields.getTextInputValue('max_currency')) || LP_DEFAULTS.maxCurrency;

  updateLuckyPennySettings(guildId, {
    minCurrency: Math.max(0, minCurrency),
    maxCurrency: Math.max(minCurrency, maxCurrency)
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username,
    `Updated Lucky Penny currency range: ${minCurrency.toLocaleString()} - ${maxCurrency.toLocaleString()}`);

  await interaction.deferUpdate();
  await showLuckyPennyPanel(interaction, guildId);
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
  
  // Format unique targets display
  const uniqueTargets = settings.uniqueTargetsRequired || 0;
  const uniqueTargetsStr = uniqueTargets > 0 
    ? `${uniqueTargets} unique targets` 
    : 'Disabled';

  // Format gift protection display
  const giftProtectionHours = settings.giftProtectionHours !== undefined ? settings.giftProtectionHours : 24;
  const giftProtectionStr = giftProtectionHours > 0
    ? `${giftProtectionHours} hour${giftProtectionHours === 1 ? '' : 's'}`
    : 'Disabled';
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🔓 Rob Settings')
    .setDescription('Configure the /rob command for stealing from other players')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💰 Steal Range', value: `${settings.minStealPercent}% - ${settings.maxStealPercent}%`, inline: true },
      { name: '⏱️ Robber Cooldown', value: `${settings.cooldownMinutes} minutes`, inline: true },
      { name: '🎯 Target Protection', value: targetCooldownStr, inline: true },
      { name: '🔄 XP Farm Protection', value: uniqueTargetsStr, inline: true },
      { name: '🎁 Gift→Rob Lock', value: giftProtectionStr, inline: true },
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
      { name: '⏱️ Defense Window', value: `${settings.defenseWindowSeconds || 10}s`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
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
  const defenseWindow = parseInt(interaction.fields.getTextInputValue('defense_window')) || 10;
  const hidecashRate = parseInt(interaction.fields.getTextInputValue('hidecash_rate')) || 70;
  const dodgeRate = parseInt(interaction.fields.getTextInputValue('dodge_rate')) || 60;
  const fightBackRate = parseInt(interaction.fields.getTextInputValue('fightback_rate')) || 50;
  
  // Validate defense window
  if (defenseWindow < 5 || defenseWindow > 60) {
    return interaction.reply({ content: '❌ Defense window must be between 5 and 60 seconds.', flags: 64 });
  }
  
  // Validate rates are between 0-100
  const validatedRates = {
    defenseWindowSeconds: defenseWindow,
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
    .setTitle('Defense Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('defense_window')
          .setLabel('Defense Window (seconds)')
          .setPlaceholder('10')
          .setValue(String(settings.defenseWindowSeconds || 10))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
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
    .setTitle('Target Protection Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_cooldown')
          .setLabel('Target Protection (seconds)')
          .setPlaceholder('60')
          .setValue(String(settings.targetCooldownSeconds || 60))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('unique_targets')
          .setLabel('Unique Targets Required (anti-farm, 0=off)')
          .setPlaceholder('3')
          .setValue(String(settings.uniqueTargetsRequired || 0))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('gift_protection_hours')
          .setLabel('Gift Protection (hours, 0=off)')
          .setPlaceholder('24')
          .setValue(String(settings.giftProtectionHours !== undefined ? settings.giftProtectionHours : 24))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function handleTargetCooldownModal(interaction, guildId) {
  const cooldownSeconds = parseInt(interaction.fields.getTextInputValue('target_cooldown')) || 60;
  const uniqueTargets = parseInt(interaction.fields.getTextInputValue('unique_targets')) || 0;
  const giftProtectionHours = parseInt(interaction.fields.getTextInputValue('gift_protection_hours')) || 0;
  
  // Validate: minimum 0 (no protection), maximum 3600 (1 hour)
  const validatedCooldown = Math.max(0, Math.min(3600, cooldownSeconds));
  // Validate: minimum 0 (disabled), maximum 10
  const validatedUnique = Math.max(0, Math.min(10, uniqueTargets));
  // Validate: minimum 0 (disabled), maximum 168 (7 days)
  const validatedGiftProtection = Math.max(0, Math.min(168, giftProtectionHours));
  
  updateRobSettings(guildId, { 
    targetCooldownSeconds: validatedCooldown,
    uniqueTargetsRequired: validatedUnique,
    giftProtectionHours: validatedGiftProtection
  });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated rob target protection: ${validatedCooldown}s cooldown, ${validatedUnique} unique targets required, ${validatedGiftProtection}h gift protection`);
  
  const uniqueMsg = validatedUnique > 0 
    ? `\n🔄 Anti-farm: Must rob ${validatedUnique} unique targets before re-robbing same person` 
    : '\n🔄 Anti-farm: Disabled';
  const giftMsg = validatedGiftProtection > 0
    ? `\n🎁 Gift lock: Cannot rob users you gave money to for ${validatedGiftProtection} hour(s)`
    : '\n🎁 Gift lock: Disabled';
  await interaction.reply({ content: `✅ Target protection updated to ${validatedCooldown} seconds!${uniqueMsg}${giftMsg}`, flags: 64 });
  await showRobPanel(interaction, guildId);
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showIncomePanel,
  showWorkPanel,
  showHuntPanel,
  showLuckyPennyPanel,
  showRobPanel,
  createWorkSettingsModal,
  createHuntSettingsModal,
  createRobSettingsModal
};
