// Admin Gambling Panel - Fully Modular
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder } = require('discord.js');
const { logAdminAction } = require('../admin');

const CURRENCY = '<:babybel:1418824333664452608>';

// IDs this module handles
const BUTTON_IDS = [
  'gambling_edit_blackjack', 'gambling_lottery_settings', 'gambling_toggle_scratch', 'gambling_scratch_config',
  'gambling_scratch_stats',
  'lottery_toggle_auto', 'lottery_edit_schedule', 'lottery_edit_prizes', 'lottery_edit_ticket_price', 'lottery_set_channel',
  'vault_toggle', 'vault_spawn', 'vault_reward', 'vault_channel', 'vault_force_spawn',
  'back_gambling'
];
const MODAL_IDS = ['modal_blackjack_settings', 'modal_lottery_schedule', 'modal_lottery_prizes', 'modal_lottery_ticket_price', 'modal_vault_spawn', 'modal_vault_reward'];
const SELECT_IDS = ['scratch_select_card', 'lottery_channel_select', 'vault_channel_select'];

// Scratch card modal IDs are dynamic: modal_scratch_cheese, modal_scratch_cash, etc.
function isScratchModal(customId) {
  return customId.startsWith('modal_scratch_');
}

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle buttons
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;
    
    try {
      // Gambling panel buttons
      if (customId === 'gambling_edit_blackjack') {
        const { getGamblingSettings } = require('../gambling');
        const settings = getGamblingSettings(guildId);
        const modal = createBlackjackSettingsModal(settings);
        await interaction.showModal(modal);
      }
      else if (customId === 'gambling_lottery_settings') {
        await interaction.deferUpdate();
        await showLotteryPanel(interaction, guildId);
      }
      else if (customId === 'gambling_toggle_scratch') {
        const { getGamblingSettings, updateGamblingSettings } = require('../gambling');
        const settings = getGamblingSettings(guildId);
        updateGamblingSettings(guildId, { scratch_enabled: !settings.scratch_enabled });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled scratch cards ${!settings.scratch_enabled ? 'ON' : 'OFF'}`);
        await interaction.deferUpdate();
        await showGamblingPanel(interaction, guildId);
      }
      else if (customId === 'gambling_scratch_config') {
        await interaction.deferUpdate();
        await showScratchConfigPanel(interaction, guildId);
      }
      else if (customId === 'gambling_scratch_stats') {
        await interaction.deferUpdate();
        await showScratchStatsPanel(interaction, guildId);
      }
      // Lottery panel buttons
      else if (customId === 'lottery_toggle_auto') {
        const { getGamblingSettings, updateGamblingSettings } = require('../gambling');
        const settings = getGamblingSettings(guildId);
        updateGamblingSettings(guildId, { lottery_auto_draw: !settings.lottery_auto_draw });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled lottery auto-draw ${!settings.lottery_auto_draw ? 'ON' : 'OFF'}`);
        await interaction.deferUpdate();
        await showLotteryPanel(interaction, guildId);
      }
      else if (customId === 'lottery_edit_schedule') {
        const { getGamblingSettings } = require('../gambling');
        const settings = getGamblingSettings(guildId);
        const modal = createLotteryScheduleModal(settings);
        await interaction.showModal(modal);
      }
      else if (customId === 'lottery_edit_prizes') {
        const { getGamblingSettings } = require('../gambling');
        const settings = getGamblingSettings(guildId);
        const modal = createLotteryPrizesModal(settings);
        await interaction.showModal(modal);
      }
      else if (customId === 'lottery_edit_ticket_price') {
        const { getGamblingSettings } = require('../gambling');
        const settings = getGamblingSettings(guildId);
        const modal = createLotteryTicketPriceModal(settings);
        await interaction.showModal(modal);
      }
      else if (customId === 'lottery_set_channel') {
        const channelSelect = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('lottery_channel_select')
            .setPlaceholder('Select lottery announcement channel')
            .setMinValues(1)
            .setMaxValues(1)
        );
        await interaction.reply({
          content: '📢 Select the channel for lottery announcements:',
          components: [channelSelect],
          flags: 64
        });
      }
      // Vault panel buttons
      else if (customId === 'vault_toggle') {
        const { getVaultSettings, updateVaultSettings } = require('../events');
        const settings = getVaultSettings(guildId);
        updateVaultSettings(guildId, { enabled: !settings.enabled });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled vault event ${!settings.enabled ? 'ON' : 'OFF'}`);
        await interaction.deferUpdate();
        await showVaultPanel(interaction, guildId);
      }
      else if (customId === 'vault_spawn') {
        const { getVaultSettings } = require('../events');
        const settings = getVaultSettings(guildId);
        const modal = createVaultSpawnModal(settings);
        await interaction.showModal(modal);
      }
      else if (customId === 'vault_reward') {
        const { getVaultSettings } = require('../events');
        const settings = getVaultSettings(guildId);
        const modal = createVaultRewardModal(settings);
        await interaction.showModal(modal);
      }
      else if (customId === 'vault_channel') {
        const channelSelect = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('vault_channel_select')
            .setPlaceholder('Select vault event channel')
            .setMinValues(1)
            .setMaxValues(1)
        );
        await interaction.reply({
          content: '🏦 Select the channel where vault events will spawn:',
          components: [channelSelect],
          flags: 64
        });
      }
      else if (customId === 'vault_force_spawn') {
        await handleForceVaultSpawn(interaction, guildId);
      }
      // Back button
      else if (customId === 'back_gambling') {
        await interaction.deferUpdate();
        await showGamblingPanel(interaction, guildId);
      }
      return true;
    } catch (err) {
      console.error('[Admin-Gambling] Button error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  // Handle channel select menu
  if (interaction.isChannelSelectMenu()) {
    if (customId !== 'lottery_channel_select' && customId !== 'vault_channel_select') return false;
    
    try {
      const channelId = interaction.values[0];
      
      if (customId === 'lottery_channel_select') {
        const { updateGamblingSettings } = require('../gambling');
        updateGamblingSettings(guildId, { lottery_channel_id: channelId });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set lottery channel to <#${channelId}>`);
        await interaction.update({
          content: `✅ Lottery announcements will be posted in <#${channelId}>`,
          components: []
        });
      } else if (customId === 'vault_channel_select') {
        const { updateVaultSettings } = require('../events');
        updateVaultSettings(guildId, { channelId });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set vault event channel to <#${channelId}>`);
        await interaction.update({
          content: `✅ Vault events will spawn in <#${channelId}>`,
          components: []
        });
      }
      return true;
    } catch (err) {
      console.error('[Admin-Gambling] Channel select error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  // Handle string select menu (scratch card type)
  if (interaction.isStringSelectMenu()) {
    if (customId !== 'scratch_select_card') return false;
    
    try {
      const cardType = interaction.values[0];
      const { getScratchCardSettings } = require('../gambling');
      let settings;
      try {
        settings = getScratchCardSettings(guildId, cardType);
      } catch {
        settings = { price: 500, match3_multiplier: 10, jackpot_multiplier: 50, jackpot_chance: 1, win_symbol_chance: 14 };
      }
      const modal = createScratchCardModal(cardType, settings);
      await interaction.showModal(modal);
      return true;
    } catch (err) {
      console.error('[Admin-Gambling] Scratch select error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  // Handle modals
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId) && !isScratchModal(customId)) return false;
    
    try {
      // Blackjack settings modal
      if (customId === 'modal_blackjack_settings') {
        const { updateGamblingSettings } = require('../gambling');
        const decks = parseInt(interaction.fields.getTextInputValue('decks'));
        
        if (isNaN(decks) || decks < 1 || decks > 8) {
          await interaction.reply({ content: '❌ Decks must be between 1 and 8.', flags: 64 });
          return true;
        }
        
        updateGamblingSettings(guildId, { blackjack_decks: decks });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set blackjack to ${decks} decks`);
        await interaction.reply({ content: `✅ Blackjack now uses ${decks} deck(s)!`, flags: 64 });
      }
      // Lottery schedule modal
      else if (customId === 'modal_lottery_schedule') {
        const { updateGamblingSettings } = require('../gambling');
        const drawDay = parseInt(interaction.fields.getTextInputValue('draw_day'));
        const drawHour = parseInt(interaction.fields.getTextInputValue('draw_hour'));
        const drawMinute = parseInt(interaction.fields.getTextInputValue('draw_minute'));
        
        if (isNaN(drawDay) || drawDay < 0 || drawDay > 6) {
          await interaction.reply({ content: '❌ Draw day must be 0-6 (Sun-Sat).', flags: 64 });
          return true;
        }
        if (isNaN(drawHour) || drawHour < 0 || drawHour > 23) {
          await interaction.reply({ content: '❌ Draw hour must be 0-23.', flags: 64 });
          return true;
        }
        if (isNaN(drawMinute) || drawMinute < 0 || drawMinute > 59) {
          await interaction.reply({ content: '❌ Draw minute must be 0-59.', flags: 64 });
          return true;
        }
        
        updateGamblingSettings(guildId, { lottery_draw_day: drawDay, lottery_draw_hour: drawHour, lottery_draw_minute: drawMinute });
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set lottery draw to ${days[drawDay]} at ${drawHour}:${String(drawMinute).padStart(2, '0')}`);
        await interaction.reply({ content: `✅ Lottery draw set to ${days[drawDay]} at ${String(drawHour).padStart(2, '0')}:${String(drawMinute).padStart(2, '0')} UTC!`, flags: 64 });
      }
      // Lottery prizes modal
      else if (customId === 'modal_lottery_prizes') {
        const { updateGamblingSettings } = require('../gambling');
        const prize2 = parseInt(interaction.fields.getTextInputValue('prize_2match'));
        const prize3 = parseInt(interaction.fields.getTextInputValue('prize_3match'));
        
        if (isNaN(prize2) || isNaN(prize3)) {
          await interaction.reply({ content: '❌ Prize amounts must be valid numbers.', flags: 64 });
          return true;
        }
        
        updateGamblingSettings(guildId, { lottery_prize_2match: prize2, lottery_prize_3match: prize3 });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set lottery prizes: 2-match=${prize2}, 3-match=${prize3}`);
        await interaction.reply({ content: `✅ Lottery prizes updated!\n🥈 2-Match: ${prize2.toLocaleString()} ${CURRENCY}\n🥉 3-Match: ${prize3.toLocaleString()} ${CURRENCY}`, flags: 64 });
      }
      // Lottery ticket price modal
      else if (customId === 'modal_lottery_ticket_price') {
        const { updateGamblingSettings } = require('../gambling');
        const price = parseInt(interaction.fields.getTextInputValue('ticket_price'));
        
        if (isNaN(price) || price < 1) {
          await interaction.reply({ content: '❌ Ticket price must be a positive number.', flags: 64 });
          return true;
        }
        
        updateGamblingSettings(guildId, { lottery_ticket_price: price });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set lottery ticket price to ${price}`);
        await interaction.reply({ content: `✅ Lottery ticket price set to **${price.toLocaleString()}** ${CURRENCY}!`, flags: 64 });
      }
      // Vault spawn modal (message trigger range)
      else if (customId === 'modal_vault_spawn') {
        const { updateVaultSettings } = require('../events');
        const minMessages = parseInt(interaction.fields.getTextInputValue('min_messages'));
        const maxMessages = parseInt(interaction.fields.getTextInputValue('max_messages'));
        
        if (isNaN(minMessages) || isNaN(maxMessages) || minMessages < 1 || maxMessages < minMessages) {
          await interaction.reply({ content: '❌ Invalid values. Min must be at least 1 and max must be >= min.', flags: 64 });
          return true;
        }
        
        updateVaultSettings(guildId, { minMessages, maxMessages });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set vault spawn range: ${minMessages}-${maxMessages} messages`);
        await interaction.reply({ content: `✅ Vault will spawn after ${minMessages}-${maxMessages} messages!`, flags: 64 });
      }
      // Vault reward modal (reward range)
      else if (customId === 'modal_vault_reward') {
        const { updateVaultSettings } = require('../events');
        const minReward = parseInt(interaction.fields.getTextInputValue('min_reward'));
        const maxReward = parseInt(interaction.fields.getTextInputValue('max_reward'));
        
        if (isNaN(minReward) || isNaN(maxReward) || minReward < 1 || maxReward < minReward) {
          await interaction.reply({ content: '❌ Invalid values. Min must be at least 1 and max must be >= min.', flags: 64 });
          return true;
        }
        
        updateVaultSettings(guildId, { minReward, maxReward });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set vault rewards: ${minReward.toLocaleString()}-${maxReward.toLocaleString()}`);
        await interaction.reply({ content: `✅ Vault rewards set to ${minReward.toLocaleString()}-${maxReward.toLocaleString()}!`, flags: 64 });
      }
      // Scratch card settings modal (dynamic)
      else if (isScratchModal(customId)) {
        const cardType = customId.replace('modal_scratch_', '');
        const { updateScratchCardSettings } = require('../gambling');
        
        const price = parseInt(interaction.fields.getTextInputValue('price'));
        const match3Mult = parseFloat(interaction.fields.getTextInputValue('match3_multiplier'));
        const jackpotMult = parseFloat(interaction.fields.getTextInputValue('jackpot_multiplier'));
        const jackpotChance = parseFloat(interaction.fields.getTextInputValue('jackpot_chance'));
        const winSymbolChance = parseFloat(interaction.fields.getTextInputValue('win_symbol_chance'));
        
        if ([price, match3Mult, jackpotMult, jackpotChance, winSymbolChance].some(isNaN)) {
          await interaction.reply({ content: '❌ Invalid values.', flags: 64 });
          return true;
        }
        
        updateScratchCardSettings(guildId, cardType, {
          price,
          match3_multiplier: match3Mult,
          jackpot_multiplier: jackpotMult,
          jackpot_chance: jackpotChance,
          win_symbol_chance: winSymbolChance
        });
        
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated ${cardType} scratch card settings`);
        await interaction.reply({ content: `✅ ${cardType} scratch card settings updated!`, flags: 64 });
      }
      return true;
    } catch (err) {
      console.error('[Admin-Gambling] Modal error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  return false;
}

// ==================== GAMBLING PANEL ====================
async function showGamblingPanel(interaction, guildId) {
  const { getGamblingSettings } = require('../gambling');
  let settings;
  try {
    settings = getGamblingSettings(guildId);
  } catch {
    settings = { blackjack_decks: 1, scratch_enabled: 1 };
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎰 Gambling Settings')
    .setDescription('Configure blackjack, lottery, and gambling features')
    .addFields(
      { name: '🃏 Blackjack Decks', value: String(settings.blackjack_decks || 1), inline: true },
      { name: '🎫 Scratch Cards', value: settings.scratch_enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );

  if (settings.lottery_auto_draw) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const drawDay = days[settings.lottery_draw_day] || 'Not Set';
    const drawTime = `${String(settings.lottery_draw_hour || 0).padStart(2, '0')}:${String(settings.lottery_draw_minute || 0).padStart(2, '0')}`;
    embed.addFields(
      { name: '🎟️ Lottery Auto-Draw', value: '✅ Enabled', inline: true },
      { name: '📅 Draw Day', value: drawDay, inline: true },
      { name: '⏰ Draw Time', value: drawTime, inline: true }
    );
  } else {
    embed.addFields({ name: '🎟️ Lottery Auto-Draw', value: '❌ Disabled', inline: true });
  }

  const blackjackBtn = new ButtonBuilder()
    .setCustomId('gambling_edit_blackjack')
    .setLabel('🃏 Blackjack')
    .setStyle(ButtonStyle.Primary);

  const lotteryBtn = new ButtonBuilder()
    .setCustomId('gambling_lottery_settings')
    .setLabel('🎟️ Lottery')
    .setStyle(ButtonStyle.Primary);

  const scratchToggleBtn = new ButtonBuilder()
    .setCustomId('gambling_toggle_scratch')
    .setLabel(settings.scratch_enabled ? 'Disable Scratch' : 'Enable Scratch')
    .setStyle(settings.scratch_enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const scratchConfigBtn = new ButtonBuilder()
    .setCustomId('gambling_scratch_config')
    .setLabel('🎫 Configure')
    .setStyle(ButtonStyle.Secondary);

  const scratchStatsBtn = new ButtonBuilder()
    .setCustomId('gambling_scratch_stats')
    .setLabel('📊 Stats')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(blackjackBtn, lotteryBtn, scratchToggleBtn);
  const row2 = new ActionRowBuilder().addComponents(scratchConfigBtn, scratchStatsBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== LOTTERY PANEL ====================
async function showLotteryPanel(interaction, guildId) {
  const { getGamblingSettings, getLotteryInfo } = require('../gambling');
  let settings;
  try {
    settings = getGamblingSettings(guildId);
  } catch {
    settings = {};
  }
  
  let lotteryInfo;
  try {
    lotteryInfo = getLotteryInfo(guildId);
  } catch {
    lotteryInfo = { jackpot: 10000, total_tickets_sold: 0 };
  }
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const drawDay = settings.lottery_draw_day != null ? days[settings.lottery_draw_day] : 'Not Set';
  const drawTime = settings.lottery_draw_hour != null 
    ? `${String(settings.lottery_draw_hour).padStart(2, '0')}:${String(settings.lottery_draw_minute || 0).padStart(2, '0')}`
    : 'Not Set';
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎟️ Lottery Settings')
    .setDescription('Configure automatic lottery draws and prizes')
    .addFields(
      { name: '🏆 Current Jackpot', value: `${CURRENCY} ${lotteryInfo.jackpot?.toLocaleString() || 10000}`, inline: true },
      { name: '🎫 Tickets Sold', value: String(lotteryInfo.total_tickets_sold || 0), inline: true },
      { name: '💵 Ticket Price', value: `${CURRENCY} ${(settings.lottery_ticket_price || 1000).toLocaleString()}`, inline: true },
      { name: '🔄 Auto-Draw', value: settings.lottery_auto_draw ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📅 Draw Day', value: drawDay, inline: true },
      { name: '⏰ Draw Time', value: drawTime, inline: true },
      { name: '📢 Draw Channel', value: settings.lottery_channel_id ? `<#${settings.lottery_channel_id}>` : 'Not Set', inline: true },
      { name: '🥈 2-Match Prize', value: `${CURRENCY} ${settings.lottery_prize_2match?.toLocaleString() || 1000}`, inline: true },
      { name: '🥉 3-Match Prize', value: `${CURRENCY} ${settings.lottery_prize_3match?.toLocaleString() || 5000}`, inline: true }
    );

  const toggleAutoBtn = new ButtonBuilder()
    .setCustomId('lottery_toggle_auto')
    .setLabel(settings.lottery_auto_draw ? 'Disable Auto' : 'Enable Auto')
    .setStyle(settings.lottery_auto_draw ? ButtonStyle.Danger : ButtonStyle.Success);

  const scheduleBtn = new ButtonBuilder()
    .setCustomId('lottery_edit_schedule')
    .setLabel('📅 Schedule')
    .setStyle(ButtonStyle.Primary);

  const prizesBtn = new ButtonBuilder()
    .setCustomId('lottery_edit_prizes')
    .setLabel('🏆 Prizes')
    .setStyle(ButtonStyle.Primary);

  const ticketPriceBtn = new ButtonBuilder()
    .setCustomId('lottery_edit_ticket_price')
    .setLabel('💵 Ticket Price')
    .setStyle(ButtonStyle.Primary);

  const channelBtn = new ButtonBuilder()
    .setCustomId('lottery_set_channel')
    .setLabel('📢 Channel')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_gambling')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(toggleAutoBtn, scheduleBtn, prizesBtn, ticketPriceBtn);
  const row2 = new ActionRowBuilder().addComponents(channelBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== SCRATCH CARD CONFIG PANEL ====================
async function showScratchConfigPanel(interaction, guildId) {
  const { getScratchCardSettings } = require('../gambling');
  
  const cardTypes = ['cheese', 'cash', 'stocks', 'lucky7s'];
  const cardNames = {
    cheese: '🧀 Cheese Frenzy',
    cash: '💰 Cash Grab',
    stocks: '📈 Stock Picks',
    lucky7s: '🎰 Lucky 7s'
  };
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎫 Scratch Card Configuration')
    .setDescription('Configure prices and multipliers for each scratch card type');

  for (const cardType of cardTypes) {
    let settings;
    try {
      settings = getScratchCardSettings(guildId, cardType);
    } catch {
      settings = { price: 500, match3_multiplier: 10, jackpot_multiplier: 50 };
    }
    
    const value = [
      `💵 Price: ${settings.price?.toLocaleString() || 'Default'}`,
      `🎯 3-Match: ${settings.match3_multiplier || 'Default'}x`,
      `💎 Jackpot: ${settings.jackpot_multiplier || 'Default'}x`
    ].join('\n');
    
    embed.addFields({ name: cardNames[cardType], value, inline: true });
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('scratch_select_card')
    .setPlaceholder('Select a card type to configure')
    .addOptions(
      cardTypes.map(ct => ({
        label: cardNames[ct].replace(/[^\w\s]/g, '').trim(),
        description: `Configure ${ct} scratch card`,
        value: ct,
        emoji: cardNames[ct].split(' ')[0]
      }))
    );

  const backBtn = new ButtonBuilder()
    .setCustomId('back_gambling')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const menuRow = new ActionRowBuilder().addComponents(selectMenu);
  const buttonRow = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [menuRow, buttonRow] });
}

// ==================== SCRATCH STATS PANEL ====================
async function showScratchStatsPanel(interaction, guildId) {
  const { getServerScratchStats } = require('../gambling');
  
  let stats;
  try {
    stats = getServerScratchStats(guildId);
  } catch {
    stats = null;
  }

  const cardNames = {
    cheese: '🧀 Cheese Frenzy',
    cash: '💰 Cash Grab',
    stocks: '📈 Stock Picks',
    lucky7s: '🎰 Lucky 7s'
  };

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Scratch Card Statistics')
    .setDescription('Server-wide scratch card purchase and payout data');

  if (!stats || !stats.grandTotal || stats.grandTotal.cards === 0) {
    embed.addFields({ name: 'No Data', value: '*No scratch cards have been purchased yet.*' });
  } else {
    // Show by card type
    for (const [cardType, data] of Object.entries(stats.byType || {})) {
      const profit = data.spent - data.won;
      const profitStr = profit >= 0 ? `+${profit.toLocaleString()}` : profit.toLocaleString();
      const profitEmoji = profit >= 0 ? '📈' : '📉';
      
      embed.addFields({
        name: cardNames[cardType] || cardType,
        value: [
          `🎫 Purchased: **${data.cards.toLocaleString()}**`,
          `💵 Spent: **${data.spent.toLocaleString()}**`,
          `🏆 Won: **${data.won.toLocaleString()}**`,
          `${profitEmoji} Profit: **${profitStr}**`,
          `🎰 Jackpots: **${data.jackpots}**`
        ].join('\n'),
        inline: true
      });
    }

    // Grand totals
    const totalProfit = stats.grandTotal.spent - stats.grandTotal.won;
    const totalProfitStr = totalProfit >= 0 ? `+${totalProfit.toLocaleString()}` : totalProfit.toLocaleString();
    const totalProfitEmoji = totalProfit >= 0 ? '📈' : '📉';

    embed.addFields({
      name: '📊 Grand Total',
      value: [
        `🎫 Total Cards: **${stats.grandTotal.cards.toLocaleString()}**`,
        `💵 Total Spent: **${stats.grandTotal.spent.toLocaleString()}**`,
        `🏆 Total Won: **${stats.grandTotal.won.toLocaleString()}**`,
        `${totalProfitEmoji} Net Profit: **${totalProfitStr}**`,
        `🎰 Total Jackpots: **${stats.grandTotal.jackpots}**`,
        `👥 Unique Players: **${stats.grandTotal.players}**`
      ].join('\n'),
      inline: false
    });
  }

  const backBtn = new ButtonBuilder()
    .setCustomId('back_gambling')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== VAULT PANEL ====================
async function handleForceVaultSpawn(interaction, guildId) {
  const { spawnVault } = require('../events');
  
  await interaction.deferReply({ flags: 64 });
  
  try {
    const result = await spawnVault(guildId);
    
    if (result && result.success) {
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Force spawned vault: ${result.amount} coins`);
      await interaction.editReply({ 
        content: `💰 **Vault Spawned!**\n\n💵 Amount: ${result.amount?.toLocaleString() || 'Unknown'}\n📢 Channel: <#${result.channelId || 'Unknown'}>`
      });
    } else {
      await interaction.editReply({ content: '❌ Failed to spawn vault. Check if vault channel is set.' });
    }
  } catch (error) {
    console.error('Force vault error:', error);
    await interaction.editReply({ content: `❌ Error: ${error.message}` });
  }
}

async function showVaultPanel(interaction, guildId) {
  const { getVaultSettings } = require('../events');
  const settings = getVaultSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🏦 Vault Event Settings')
    .setDescription('Configure the vault event that spawns for users to claim rewards.\n\nThe vault will appear after a random number of messages in the selected channel. First 3 users to click get rewards!')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📢 Channel', value: settings.channelId ? `<#${settings.channelId}>` : '*Not Set*', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💬 Message Trigger', value: `${settings.minMessages.toLocaleString()} - ${settings.maxMessages.toLocaleString()} messages`, inline: true },
      { name: '💰 Reward Range', value: `${settings.minReward.toLocaleString()} - ${settings.maxReward.toLocaleString()}`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('vault_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const spawnBtn = new ButtonBuilder()
    .setCustomId('vault_spawn')
    .setLabel('💬 Spawn Rate')
    .setStyle(ButtonStyle.Primary);

  const rewardBtn = new ButtonBuilder()
    .setCustomId('vault_reward')
    .setLabel('💰 Rewards')
    .setStyle(ButtonStyle.Primary);

  const channelBtn = new ButtonBuilder()
    .setCustomId('vault_channel')
    .setLabel('📢 Channel')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(toggleBtn, spawnBtn, rewardBtn, channelBtn, backBtn);

  const forceSpawnBtn = new ButtonBuilder()
    .setCustomId('vault_force_spawn')
    .setLabel('⚡ Force Spawn Vault')
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(forceSpawnBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== MODAL BUILDERS ====================
function createBlackjackSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_blackjack_settings')
    .setTitle('Blackjack Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('decks')
          .setLabel('Number of Decks (1-8)')
          .setPlaceholder('1')
          .setValue(String(settings.blackjack_decks || 1))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createLotteryScheduleModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_lottery_schedule')
    .setTitle('Lottery Draw Schedule')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('draw_day')
          .setLabel('Draw Day (0=Sun, 1=Mon, ..., 6=Sat)')
          .setPlaceholder('6')
          .setValue(String(settings.lottery_draw_day ?? ''))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('draw_hour')
          .setLabel('Draw Hour (0-23, UTC)')
          .setPlaceholder('18')
          .setValue(String(settings.lottery_draw_hour ?? ''))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('draw_minute')
          .setLabel('Draw Minute (0-59)')
          .setPlaceholder('0')
          .setValue(String(settings.lottery_draw_minute || 0))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createLotteryPrizesModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_lottery_prizes')
    .setTitle('Lottery Prize Amounts')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prize_2match')
          .setLabel('2-Match Prize')
          .setPlaceholder('1000')
          .setValue(String(settings.lottery_prize_2match || 1000))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prize_3match')
          .setLabel('3-Match Prize')
          .setPlaceholder('5000')
          .setValue(String(settings.lottery_prize_3match || 5000))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createLotteryTicketPriceModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_lottery_ticket_price')
    .setTitle('Lottery Ticket Price')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ticket_price')
          .setLabel('Ticket Price')
          .setPlaceholder('1000')
          .setValue(String(settings.lottery_ticket_price || 1000))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createScratchCardModal(cardType, settings) {
  const cardNames = {
    cheese: 'Cheese Frenzy',
    cash: 'Cash Grab',
    stocks: 'Stock Picks',
    lucky7s: 'Lucky 7s'
  };
  
  return new ModalBuilder()
    .setCustomId(`modal_scratch_${cardType}`)
    .setTitle(`${cardNames[cardType]} Settings`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('price')
          .setLabel('Card Price')
          .setPlaceholder('500')
          .setValue(String(settings.price || 500))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('match3_multiplier')
          .setLabel('3-Match Multiplier')
          .setPlaceholder('10')
          .setValue(String(settings.match3_multiplier || 10))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('jackpot_multiplier')
          .setLabel('Jackpot Multiplier')
          .setPlaceholder('50')
          .setValue(String(settings.jackpot_multiplier || 50))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('jackpot_chance')
          .setLabel('Jackpot Chance % (0-100)')
          .setPlaceholder('1')
          .setValue(String(settings.jackpot_chance || 1))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('win_symbol_chance')
          .setLabel('Win Symbol Chance % (0-100)')
          .setPlaceholder('14')
          .setValue(String(settings.win_symbol_chance || 14))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createVaultSpawnModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_vault_spawn')
    .setTitle('Vault Spawn Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_messages')
          .setLabel('Minimum Messages Before Spawn')
          .setPlaceholder('200')
          .setValue(String(settings.minMessages || 200))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_messages')
          .setLabel('Maximum Messages Before Spawn')
          .setPlaceholder('1000')
          .setValue(String(settings.maxMessages || 1000))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createVaultRewardModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_vault_reward')
    .setTitle('Vault Reward Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_reward')
          .setLabel('Minimum Reward')
          .setPlaceholder('100')
          .setValue(String(settings.minReward || 100))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_reward')
          .setLabel('Maximum Reward')
          .setPlaceholder('10000')
          .setValue(String(settings.maxReward || 10000))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

module.exports = {
  handleInteraction,
  showGamblingPanel,
  showLotteryPanel,
  showScratchConfigPanel,
  showScratchStatsPanel,
  showVaultPanel
};
