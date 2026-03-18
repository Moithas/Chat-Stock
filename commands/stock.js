const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { 
  calculateStockPrice, 
  getPortfolio, 
  getUser, 
  getStockRank, 
  getPortfolioRank,
  getAllStockHolders,
  createUser,
  buyStock,
  logTransaction,
  getStock,
  sellStock,
  deleteStock,
  getPriceHistoryByTimeRange,
  setShares,
  setPriceModifier,
  getPriceModifier,
  adjustAvgBuyPrice,
  calculateStreakInfo
} = require('../database');
const QuickChart = require('quickchart-js');
const { 
  getDividendSettings, 
  getDividendHistory, 
  getTotalDividendsReceived,
  getSelfDividendHistory,
  getTotalSelfDividendsReceived,
  canSplit,
  getLastSplitTime,
  executeSplit
} = require('../dividends');
const { sendSplitAnnouncement } = require('../ticker');
const { isEnabled, hasEnoughMoney, hasEnoughInBank, removeMoney, removeFromBank, addMoney, getBalance } = require('../economy');
const { calculateBuyFee, calculateSellFee, getGuildSettings } = require('../fees');
const { recordPurchase, recordPriceImpact, getMarketSettings, checkSellCooldown, consumePurchaseShares, calculateCapitalGainsTax, previewCapitalGainsTax } = require('../market');
const { getActiveMarketEvent } = require('../events');
const { getLuckyPennyEffect, LP_EFFECT_TYPES } = require('../luckypenny');
const { getCurrency } = require('../admin');



// Time range options for price charts
const TIME_RANGES = {
  '1d': { ms: 24 * 60 * 60 * 1000, label: '1 Day' },
  '3d': { ms: 3 * 24 * 60 * 60 * 1000, label: '3 Days' },
  '1w': { ms: 7 * 24 * 60 * 60 * 1000, label: '1 Week' }
};

// Generate price chart
async function generatePriceChart(userId, username, timeRange, currentPrice) {
  const range = TIME_RANGES[timeRange];
  const startTime = Date.now() - range.ms;
  let priceData = getPriceHistoryByTimeRange(userId, startTime);
  
  if (priceData.length < 1) {
    return null; // Not enough data for a chart
  }

  // Scale historical prices to match current actual price
  // Stored prices may have been logged with different calculation parameters
  const lastStoredPrice = priceData[priceData.length - 1].price;
  if (lastStoredPrice > 0 && currentPrice > 0) {
    const scaleFactor = currentPrice / lastStoredPrice;
    priceData = priceData.map(p => ({ ...p, price: p.price * scaleFactor }));
  }

  // Add current price as the latest data point
  let allPrices = [...priceData, { price: currentPrice, timestamp: Date.now() }];
  
  if (allPrices.length < 2) {
    return null; // Not enough data for a chart
  }

  // Limit data points to prevent URL from exceeding Discord's 2048 char limit
  const maxDataPoints = 25;
  if (allPrices.length > maxDataPoints) {
    const step = Math.ceil(allPrices.length / maxDataPoints);
    const sampled = [];
    for (let i = 0; i < allPrices.length - 1; i += step) {
      sampled.push(allPrices[i]);
    }
    sampled.push(allPrices[allPrices.length - 1]);
    allPrices = sampled;
  }

  // Format timestamps for labels
  const labels = allPrices.map(p => {
    const date = new Date(p.timestamp);
    if (timeRange === '1d') {
      return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const prices = allPrices.map(p => Math.round(p.price));
  
  // Determine color based on price trend
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];
  const isPositive = endPrice >= startPrice;
  const lineColor = isPositive ? 'rgb(0,200,83)' : 'rgb(255,82,82)';
  const fillColor = isPositive ? 'rgba(0,200,83,0.2)' : 'rgba(255,82,82,0.2)';

  const shortName = username.length > 15 ? username.substring(0, 12) + '...' : username;

  const chart = new QuickChart();
  chart.setConfig({
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: prices,
        borderColor: lineColor,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: `${shortName} - ${range.label}`,
          color: '#fff'
        },
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: '#aaa', maxTicksLimit: 6 },
          grid: { color: '#333' }
        },
        y: {
          ticks: { color: '#aaa' },
          grid: { color: '#333' }
        }
      }
    }
  });
  
  chart.setWidth(500);
  chart.setHeight(250);
  chart.setBackgroundColor('#2f3136');

  return await chart.getShortUrl();
}

// Pending transactions to prevent duplicates
const pendingTransactions = new Set();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Stock management panel - buy, sell, view portfolio and more'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await interaction.deferReply({ flags: 64 });
    await showStockPanel(interaction, guildId, userId, false, true);
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (customId === 'stock_panel_back') {
      return showStockPanel(interaction, guildId, userId, true);
    }

    if (customId === 'stock_panel_price') {
      return showPriceUserSelect(interaction, guildId, userId);
    }

    // Handle price view for specific user from button
    if (customId.startsWith('stock_price_user_')) {
      const targetUserId = customId.replace('stock_price_user_', '');
      return showPriceView(interaction, guildId, targetUserId);
    }

    // Handle price chart buttons (1d, 3d, 1w)
    if (customId.startsWith('stock_price_chart_')) {
      const parts = customId.split('_');
      const chartRange = parts[3]; // 1d, 3d, or 1w
      const targetUserId = parts[4];
      return showPriceView(interaction, guildId, targetUserId, chartRange);
    }

    if (customId === 'stock_panel_buy') {
      return showBuyView(interaction, guildId, userId);
    }

    if (customId === 'stock_panel_sell') {
      return showSellView(interaction, guildId, userId);
    }

    if (customId === 'stock_panel_split') {
      return showSplitView(interaction, guildId, userId);
    }

    if (customId === 'stock_panel_portfolio') {
      return showPortfolioUserSelect(interaction, guildId, userId);
    }

    if (customId.startsWith('stock_portfolio_page_')) {
      const parts = customId.split('_');
      const page = parseInt(parts[3]);
      const targetUserId = parts[4];
      return showPortfolioView(interaction, guildId, targetUserId, false, page);
    }

    if (customId === 'stock_panel_history') {
      return showHistoryView(interaction, guildId, userId);
    }

    if (customId === 'stock_panel_shareholders') {
      return showShareholdersUserSelect(interaction, guildId, userId);
    }

    // Handle buy amount buttons - show confirmation first
    if (customId.startsWith('stock_buy_')) {
      const parts = customId.split('_');
      const amount = parts[2];
      const targetUserId = parts[3];
      return showBuyConfirmation(interaction, guildId, userId, targetUserId, amount);
    }

    // Handle sell amount buttons - show confirmation first
    if (customId.startsWith('stock_sell_')) {
      const parts = customId.split('_');
      const amount = parts[2];
      const targetUserId = parts[3];
      return showSellConfirmation(interaction, guildId, userId, targetUserId, amount);
    }

    // Handle confirmed buy
    if (customId.startsWith('stock_confirm_buy_')) {
      const parts = customId.split('_');
      const amount = parts[3];
      const targetUserId = parts[4];
      return executeBuy(interaction, guildId, userId, targetUserId, amount);
    }

    // Handle confirmed sell
    if (customId.startsWith('stock_confirm_sell_')) {
      const parts = customId.split('_');
      const amount = parts[3];
      const targetUserId = parts[4];
      return executeSell(interaction, guildId, userId, targetUserId, amount);
    }

    // Handle cancelled buy
    if (customId.startsWith('stock_cancel_buy_')) {
      const targetUserId = customId.replace('stock_cancel_buy_', '');
      return showBuyAmountButtons(interaction, guildId, userId, targetUserId, true);
    }

    // Handle cancelled sell
    if (customId.startsWith('stock_cancel_sell_')) {
      const targetUserId = customId.replace('stock_cancel_sell_', '');
      return showSellAmountButtons(interaction, guildId, userId, targetUserId, true);
    }

    // Handle confirmed buy from modal
    if (customId.startsWith('stock_modal_confirm_buy_')) {
      const parts = customId.split('_');
      const amount = parts[4];
      const targetUserId = parts[5];
      return executeBuy(interaction, guildId, userId, targetUserId, amount, true);
    }

    // Handle confirmed sell from modal
    if (customId.startsWith('stock_modal_confirm_sell_')) {
      const parts = customId.split('_');
      const amount = parts[4];
      const targetUserId = parts[5];
      return executeSell(interaction, guildId, userId, targetUserId, amount, true);
    }

    // Handle cancelled buy from modal (just dismiss)
    if (customId === 'stock_modal_cancel_buy' || customId === 'stock_modal_cancel_sell') {
      return interaction.update({ content: '❌ Transaction cancelled.', embeds: [], components: [] });
    }

    // Handle custom buy modal button
    if (customId.startsWith('stock_buycustom_')) {
      const targetUserId = customId.replace('stock_buycustom_', '');
      return showCustomBuyModal(interaction, targetUserId);
    }

    // Handle custom sell modal button
    if (customId.startsWith('stock_sellcustom_')) {
      const targetUserId = customId.replace('stock_sellcustom_', '');
      return showCustomSellModal(interaction, targetUserId);
    }

    // Handle split ratio buttons
    if (customId.startsWith('stock_split_')) {
      const parts = customId.split('_');
      const ratio = parts[2]; // "2:1", "3:1", or "4:1"
      return executeStockSplit(interaction, guildId, userId, ratio);
    }

    // Handle search buttons - show username search modal
    if (customId === 'stock_search_price') {
      return showUsernameSearchModal(interaction, 'price');
    }
    if (customId === 'stock_search_buy') {
      return showUsernameSearchModal(interaction, 'buy');
    }
    if (customId === 'stock_search_portfolio') {
      return showUsernameSearchModal(interaction, 'portfolio');
    }
    if (customId === 'stock_search_shareholders') {
      return showUsernameSearchModal(interaction, 'shareholders');
    }

    // Fallback for unhandled stock buttons
    console.log(`[STOCK] Unhandled button: ${customId}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Unknown button action.', flags: 64 });
    }
  },

  async handleSelectMenu(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (customId === 'stock_buy_select') {
      const targetUserId = interaction.values[0];
      return showBuyAmountButtons(interaction, guildId, userId, targetUserId);
    }

    if (customId === 'stock_sell_select') {
      const targetUserId = interaction.values[0];
      return showSellAmountButtons(interaction, guildId, userId, targetUserId);
    }

    if (customId === 'stock_price_select_user') {
      const targetUserId = interaction.values[0];
      return showPriceView(interaction, guildId, targetUserId);
    }

    if (customId === 'stock_shareholders_select_user') {
      const targetUserId = interaction.values[0];
      return showShareholdersView(interaction, guildId, targetUserId);
    }

    if (customId === 'stock_portfolio_select_user') {
      const targetUserId = interaction.values[0];
      return showPortfolioView(interaction, guildId, targetUserId);
    }

    // Handle search result selection
    if (customId.startsWith('stock_search_result_')) {
      const searchType = customId.replace('stock_search_result_', '');
      const targetUserId = interaction.values[0];
      
      switch (searchType) {
        case 'price':
          return showPriceView(interaction, guildId, targetUserId);
        case 'buy':
          return showBuyAmountButtons(interaction, guildId, userId, targetUserId);
        case 'portfolio':
          return showPortfolioView(interaction, guildId, targetUserId);
        case 'shareholders':
          return showShareholdersView(interaction, guildId, targetUserId);
      }
    }
  },

  async handleModal(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (customId.startsWith('modal_stock_buy_')) {
      const targetUserId = customId.replace('modal_stock_buy_', '');
      const amount = interaction.fields.getTextInputValue('buy_amount');
      return showBuyConfirmationFromModal(interaction, guildId, userId, targetUserId, amount);
    }

    if (customId.startsWith('modal_stock_sell_')) {
      const targetUserId = customId.replace('modal_stock_sell_', '');
      const amount = interaction.fields.getTextInputValue('sell_amount');
      return showSellConfirmation(interaction, guildId, userId, targetUserId, amount, true);
    }

    // Handle username search modals
    if (customId.startsWith('modal_stock_search_')) {
      const searchType = customId.replace('modal_stock_search_', '');
      const searchQuery = interaction.fields.getTextInputValue('username_search').trim().toLowerCase();
      return handleUsernameSearch(interaction, guildId, searchType, searchQuery);
    }
  }
};

// Helper function for rank emoji
function getRankEmoji(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

async function showStockPanel(interaction, guildId, userId, isUpdate = false, isDeferred = false) {
  const user = getUser(userId);
  const stockPrice = calculateStockPrice(userId, guildId);
  const portfolio = getPortfolio(userId);
  const settings = getDividendSettings(guildId);
  
  // Calculate portfolio stats
  let totalValue = 0;
  let totalInvested = 0;
  
  for (const stock of portfolio) {
    const currentPrice = calculateStockPrice(stock.stock_user_id, guildId);
    totalValue += currentPrice * stock.shares;
    totalInvested += stock.avg_buy_price * stock.shares;
  }
  
  const totalProfit = totalValue - totalInvested;
  const profitPercentage = totalInvested > 0 ? ((totalProfit / totalInvested) * 100).toFixed(2) : '0.00';
  
  // Get ranks
  const stockRank = getStockRank(userId, guildId);
  const portfolioRank = getPortfolioRank(userId, guildId);
  
  const stockRankText = stockRank ? `${getRankEmoji(stockRank.rank)} of ${stockRank.total}` : 'Unranked';
  const portfolioRankText = portfolioRank ? `${getRankEmoji(portfolioRank.rank)} of ${portfolioRank.total}` : 'Unranked';
  
  // Calculate expected dividends
  const frequencyText = { 'daily': 'Daily', 'weekly': 'Weekly', 'biweekly': 'Bi-Weekly' };
  let totalExpectedDividend = 0;
  const dividendDetails = [];
  
  for (const holding of portfolio) {
    if (holding.shares < settings.minSharesForDividend) continue;
    const holdingPrice = calculateStockPrice(holding.stock_user_id, guildId);
    if (holdingPrice < settings.minPriceForDividend) continue;
    
    const dividendPerShare = holdingPrice * (settings.dividendRate / 100);
    const totalDividend = Math.floor(dividendPerShare * holding.shares);
    totalExpectedDividend += totalDividend;
    
    dividendDetails.push({
      stockUserId: holding.stock_user_id,
      shares: holding.shares,
      dividend: totalDividend
    });
  }
  
  dividendDetails.sort((a, b) => b.dividend - a.dividend);
  
  // Check if can split
  const splitCheck = canSplit(guildId, userId, stockPrice);
  
  // Build embed
  const embed = new EmbedBuilder()
    .setColor(totalProfit >= 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`📈 ${interaction.user.username}'s Stock Panel`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  
  // Stock price header
  embed.setDescription(`**Your Stock Price:** ${Math.round(stockPrice).toLocaleString()} ${getCurrency(guildId)}`);
  
  // Portfolio summary (like /portfolio)
  embed.addFields(
    { name: '💰 Total Value', value: `${Math.round(totalValue).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
    { name: '💵 Total Invested', value: `${Math.round(totalInvested).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
    { name: `${totalProfit >= 0 ? '📈' : '📉'} Profit/Loss`, value: `${totalProfit >= 0 ? '+' : ''}${Math.round(totalProfit).toLocaleString()} ${getCurrency(guildId)} (${profitPercentage}%)`, inline: true },
    { name: '🏆 Stock Rank', value: stockRankText, inline: true },
    { name: '💼 Investor Rank', value: portfolioRankText, inline: true },
    { name: '📊 Holdings', value: `${portfolio.length} stocks`, inline: true }
  );
  
  // Dividend portfolio section (without requirements)
  if (settings.enabled && dividendDetails.length > 0) {
    const topDividends = dividendDetails.slice(0, 5).map(async d => {
      let username = d.stockUserId;
      try {
        const user = await interaction.client.users.fetch(d.stockUserId);
        username = user.username;
      } catch (e) {}
      return `${username}: **${d.shares}** shares → **${d.dividend.toLocaleString()}** ${getCurrency(guildId)}`;
    });
    
    const resolvedDividends = await Promise.all(topDividends);
    
    embed.addFields({
      name: `💰 Expected ${frequencyText[settings.payoutFrequency] || 'Periodic'} Dividend`,
      value: `**${totalExpectedDividend.toLocaleString()}** ${getCurrency(guildId)}`,
      inline: false
    });
    
    if (resolvedDividends.length > 0) {
      embed.addFields({
        name: `📊 Top Dividend Sources`,
        value: resolvedDividends.join('\n'),
        inline: false
      });
    }
  } else if (settings.enabled) {
    embed.addFields({
      name: '💰 Expected Dividend',
      value: 'No qualifying holdings yet',
      inline: false
    });
  }
  
  // Check for active market event
  const activeEvent = getActiveMarketEvent(guildId);
  if (activeEvent) {
    const eventEmoji = activeEvent.percentChange > 0 ? '📈' : '📉';
    const changeText = activeEvent.percentChange > 0 ? `+${activeEvent.percentChange}%` : `${activeEvent.percentChange}%`;
    const remainingMinutes = Math.ceil((activeEvent.expiresAt - Date.now()) / 60000);
    embed.addFields({
      name: `${eventEmoji} Market Event: ${activeEvent.name}`,
      value: `All prices ${changeText} for **${remainingMinutes}** more minutes`,
      inline: false
    });
  }
  
  // Show split status/cooldown
  if (settings.splitsEnabled) {
    const lastSplit = getLastSplitTime(guildId, userId);
    const cooldownMs = settings.splitCooldownHours * 60 * 60 * 1000;
    const timeSinceLastSplit = Date.now() - lastSplit;
    
    let splitStatusText;
    if (!splitCheck.canSplit && lastSplit > 0 && timeSinceLastSplit < cooldownMs) {
      // On cooldown
      const cooldownEnds = lastSplit + cooldownMs;
      splitStatusText = `⏳ Cooldown ends <t:${Math.floor(cooldownEnds / 1000)}:R>`;
    } else if (!splitCheck.canSplit && stockPrice < settings.splitMinPrice) {
      // Price too low
      splitStatusText = `📉 Need **${settings.splitMinPrice.toLocaleString()}** ${getCurrency(guildId)} (currently ${Math.round(stockPrice).toLocaleString()})`;
    } else if (splitCheck.canSplit) {
      splitStatusText = `✅ Ready to split!`;
    } else {
      splitStatusText = splitCheck.reason || 'Not available';
    }
    
    embed.addFields({
      name: '✂️ Stock Split',
      value: splitStatusText,
      inline: false
    });
  }
  
  // Build button rows
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_price')
      .setLabel('Price')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stock_panel_buy')
      .setLabel('Buy')
      .setEmoji('💵')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('stock_panel_sell')
      .setLabel('Sell')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('stock_panel_split')
      .setLabel('Split')
      .setEmoji('✂️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!splitCheck.canSplit)
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_portfolio')
      .setLabel('Portfolio')
      .setEmoji('💼')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stock_panel_history')
      .setLabel('History')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stock_panel_shareholders')
      .setLabel('Shareholders')
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary)
  );
  
  if (isDeferred) {
    await interaction.editReply({ embeds: [embed], components: [row1, row2] });
  } else if (isUpdate) {
    await interaction.update({ embeds: [embed], components: [row1, row2] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row1, row2], flags: 64 });
  }
}

async function showPriceUserSelect(interaction, guildId, userId) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 View Stock Price')
    .setDescription('Select a user from the dropdown, or search by their Discord username if you can\'t find them.');
  
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('stock_price_select_user')
    .setPlaceholder('Select a user to view their stock...');
  
  const selectRow = new ActionRowBuilder().addComponents(userSelect);
  
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_search_price')
      .setLabel('Search by Username')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function showPriceView(interaction, guildId, targetUserId, chartRange = null, isDeferred = false) {
  // Helper to respond correctly based on deferred state
  const respond = (data) => isDeferred ? interaction.editReply(data) : interaction.update(data);
  
  // Fetch the target user's info
  let targetUser;
  try {
    targetUser = await interaction.client.users.fetch(targetUserId);
  } catch (e) {
    targetUser = { username: 'Unknown User', displayAvatarURL: () => null };
  }
  
  const stockPrice = calculateStockPrice(targetUserId, guildId);
  const shareholders = getAllStockHolders(targetUserId);
  const stockRank = getStockRank(targetUserId, guildId);
  const streakInfo = calculateStreakInfo(targetUserId);
  
  let totalShares = 0;
  for (const holder of shareholders) {
    totalShares += holder.shares;
  }
  const marketCap = totalShares * stockPrice;
  
  // Build streak display
  let streakText = 'No active streak';
  if (streakInfo.days > 0) {
    const tierInfo = {
      0: { emoji: '', name: '' },
      1: { emoji: '🔥', name: 'Bronze' },
      2: { emoji: '🔥🔥', name: 'Silver' },
      3: { emoji: '🔥🔥🔥', name: 'Gold' }
    };
    const ti = tierInfo[streakInfo.tier];
    if (streakInfo.tier > 0) {
      streakText = `${ti.emoji} **${streakInfo.days} days** — ${ti.name} (+${Math.round(streakInfo.bonus * 100)}%)`;
    } else {
      streakText = `**${streakInfo.days} days** (next tier at 7)`;
    }
  }
  
  // Check for active market event
  const activeEvent = getActiveMarketEvent(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📊 ${targetUser.username}'s Stock`)
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .setDescription(`📅 **Chat Streak:** ${streakText}`)
    .addFields(
      { name: '💰 Current Price', value: `**${Math.round(stockPrice).toLocaleString()}** ${getCurrency(guildId)}`, inline: true },
      { name: '📈 Total Shares', value: `**${totalShares.toLocaleString()}**`, inline: true },
      { name: '🏦 Market Cap', value: `**${Math.round(marketCap).toLocaleString()}** ${getCurrency(guildId)}`, inline: true },
      { name: '👥 Shareholders', value: `**${shareholders.length}**`, inline: true },
      { name: '🏆 Stock Rank', value: stockRank ? `${getRankEmoji(stockRank.rank)} of ${stockRank.total}` : 'Unranked', inline: true }
    )
    .setTimestamp();
  
  // Add market event indicator if active
  if (activeEvent) {
    const eventEmoji = activeEvent.percentChange > 0 ? '📈' : '📉';
    const changeText = activeEvent.percentChange > 0 ? `+${activeEvent.percentChange}%` : `${activeEvent.percentChange}%`;
    const remainingMinutes = Math.ceil((activeEvent.expiresAt - Date.now()) / 60000);
    embed.addFields({
      name: `${eventEmoji} Market Event Active`,
      value: `**${activeEvent.name}**\n${changeText} for ${remainingMinutes} more minutes`,
      inline: false
    });
  }
  
  // Generate chart if requested
  if (chartRange) {
    const chartUrl = await generatePriceChart(targetUserId, targetUser.username, chartRange, stockPrice);
    if (chartUrl) {
      embed.setImage(chartUrl);
      embed.addFields({ 
        name: '📈 Chart', 
        value: `Showing price history for the last **${TIME_RANGES[chartRange].label}**`, 
        inline: false 
      });
    } else {
      embed.addFields({ 
        name: '📈 Chart', 
        value: '⚠️ Not enough price data for this time range yet.', 
        inline: false 
      });
    }
  }
  
  // Chart buttons row
  const chartRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stock_price_chart_1d_${targetUserId}`)
      .setLabel('1 Day')
      .setEmoji('📊')
      .setStyle(chartRange === '1d' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stock_price_chart_3d_${targetUserId}`)
      .setLabel('3 Days')
      .setEmoji('📊')
      .setStyle(chartRange === '3d' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stock_price_chart_1w_${targetUserId}`)
      .setLabel('1 Week')
      .setEmoji('📊')
      .setStyle(chartRange === '1w' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await respond({ embeds: [embed], components: [chartRow, backButton] });
}

async function showBuyView(interaction, guildId, userId) {
  let balance = 0;
  if (isEnabled()) {
    const balanceData = await getBalance(guildId, userId);
    balance = balanceData.bank;
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('💵 Buy Stocks')
    .setDescription(`**Your Bank:** ${Math.round(balance).toLocaleString()} ${getCurrency(guildId)}\n\nSelect a user from the dropdown, or search by their Discord username if you can't find them.`);
  
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('stock_buy_select')
    .setPlaceholder('Select a user to buy their stock...');
  
  const selectRow = new ActionRowBuilder().addComponents(userSelect);
  
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_search_buy')
      .setLabel('Search by Username')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function showBuyAmountButtons(interaction, guildId, userId, targetUserId, isDeferred = false) {
  // If coming from cancel button, defer the update (search already defers)
  if (isDeferred && !interaction.deferred) {
    await interaction.deferUpdate();
  }
  
  // Helper to respond correctly based on deferred state
  const respond = (data) => isDeferred ? interaction.editReply(data) : interaction.update(data);
  
  // Can't buy your own stock
  if (targetUserId === userId) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ Cannot Buy')
      .setDescription('You cannot buy your own stock!');
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_panel_buy')
        .setLabel('Back')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return respond({ embeds: [embed], components: [backButton] });
  }
  
  let username = targetUserId;
  let targetAvatar = null;
  try {
    const user = await interaction.client.users.fetch(targetUserId);
    username = user.username;
    targetAvatar = user.displayAvatarURL({ dynamic: true });
  } catch (e) {}
  
  // Ensure target user exists in database
  createUser(targetUserId, username);
  
  const basePrice = calculateStockPrice(targetUserId, guildId);
  const lpBuyMod = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.STOCK_PRICES);
  const currentPrice = lpBuyMod !== 0
    ? Math.max(0.01, Math.round(basePrice * (1 + lpBuyMod / 100) * 100) / 100)
    : basePrice;
  
  let balance = 0;
  if (isEnabled()) {
    const balanceData = await getBalance(guildId, userId);
    balance = balanceData.bank;
  }
  
  // Calculate max shares user can buy
  const settings = getGuildSettings(guildId);
  const feePercent = settings.buyFeeType === 'percent' ? settings.buyFeeValue / 100 : 0;
  const fixedFee = settings.buyFeeType === 'fixed' ? settings.buyFeeValue : 0;
  
  // Max shares = (balance - fixedFee) / (price * (1 + feePercent))
  const maxShares = Math.floor((balance - fixedFee) / (currentPrice * (1 + feePercent)));
  
  const lpNote = lpBuyMod !== 0 ? ` (${lpBuyMod > 0 ? '+' : ''}${lpBuyMod}% LP)` : '';
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`💵 Buy ${username}`)
    .setDescription(`**Your Bank:** ${Math.round(balance).toLocaleString()} ${getCurrency(guildId)}`)
    .addFields(
      { name: 'Price/Share', value: `${Math.round(currentPrice).toLocaleString()} ${getCurrency(guildId)}${lpNote}`, inline: true },
      { name: 'Max Buyable', value: `${Math.max(0, maxShares).toLocaleString()} shares`, inline: true }
    );
  
  if (targetAvatar) {
    embed.setThumbnail(targetAvatar);
  }
  
  if (maxShares < 1) {
    embed.addFields({ name: '❌ Insufficient Funds', value: 'You cannot afford any shares of this stock.', inline: false });
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_panel_buy')
        .setLabel('Back')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return respond({ embeds: [embed], components: [backButton] });
  }
  
  // Create amount buttons - Row 1: 1, 5, 10, 25
  const row1Buttons = [];
  if (maxShares >= 1) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_1_${targetUserId}`).setLabel('1').setStyle(ButtonStyle.Success));
  if (maxShares >= 5) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_5_${targetUserId}`).setLabel('5').setStyle(ButtonStyle.Success));
  if (maxShares >= 10) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_10_${targetUserId}`).setLabel('10').setStyle(ButtonStyle.Success));
  if (maxShares >= 25) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_25_${targetUserId}`).setLabel('25').setStyle(ButtonStyle.Success));
  
  // Row 2: 50, 100, 500
  const row2Buttons = [];
  if (maxShares >= 50) row2Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_50_${targetUserId}`).setLabel('50').setStyle(ButtonStyle.Success));
  if (maxShares >= 100) row2Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_100_${targetUserId}`).setLabel('100').setStyle(ButtonStyle.Success));
  if (maxShares >= 500) row2Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_500_${targetUserId}`).setLabel('500').setStyle(ButtonStyle.Success));
  
  // Row 3: 1000, Max, Custom
  const row3Buttons = [];
  if (maxShares >= 1000) row3Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_1000_${targetUserId}`).setLabel('1000').setStyle(ButtonStyle.Success));
  row3Buttons.push(new ButtonBuilder().setCustomId(`stock_buy_max_${targetUserId}`).setLabel(`Max (${maxShares})`).setStyle(ButtonStyle.Success));
  row3Buttons.push(new ButtonBuilder().setCustomId(`stock_buycustom_${targetUserId}`).setLabel('Custom').setStyle(ButtonStyle.Primary));
  
  const components = [];
  if (row1Buttons.length > 0) components.push(new ActionRowBuilder().addComponents(row1Buttons));
  if (row2Buttons.length > 0) components.push(new ActionRowBuilder().addComponents(row2Buttons));
  if (row3Buttons.length > 0) components.push(new ActionRowBuilder().addComponents(row3Buttons));
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_buy')
      .setLabel('Back')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  components.push(backButton);
  
  await respond({ embeds: [embed], components });
}

async function showCustomBuyModal(interaction, targetUserId) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_stock_buy_${targetUserId}`)
    .setTitle('Custom Buy Amount')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('buy_amount')
          .setLabel('How many shares do you want to buy?')
          .setPlaceholder('Enter a number...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(10)
      )
    );
  
  await interaction.showModal(modal);
}

async function showCustomSellModal(interaction, targetUserId) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_stock_sell_${targetUserId}`)
    .setTitle('Custom Sell Amount')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sell_amount')
          .setLabel('How many shares do you want to sell?')
          .setPlaceholder('Enter a number...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(10)
      )
    );
  
  await interaction.showModal(modal);
}

// Show buy confirmation embed
async function showBuyConfirmation(interaction, guildId, userId, targetUserId, amount) {
  await interaction.deferUpdate();
  
  let username = targetUserId;
  try {
    const user = await interaction.client.users.fetch(targetUserId);
    username = user.username;
  } catch (e) {}
  
  const basePrice = calculateStockPrice(targetUserId, guildId);
  const lpBuyMod = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.STOCK_PRICES);
  const currentPrice = lpBuyMod !== 0
    ? Math.max(0.01, Math.round(basePrice * (1 + lpBuyMod / 100) * 100) / 100)
    : basePrice;
  
  // Get balance and calculate max shares
  let balance = 0;
  if (isEnabled()) {
    const balanceData = await getBalance(guildId, userId);
    balance = balanceData.bank;
  }
  
  const settings = getGuildSettings(guildId);
  const feePercent = settings.buyFeeType === 'percent' ? settings.buyFeeValue / 100 : 0;
  const fixedFee = settings.buyFeeType === 'fixed' ? settings.buyFeeValue : 0;
  const maxShares = Math.floor((balance - fixedFee) / (currentPrice * (1 + feePercent)));
  
  const shares = amount === 'max' ? maxShares : parseInt(amount);
  
  if (isNaN(shares) || shares < 1) {
    return interaction.editReply({ content: `❌ Invalid amount. Please enter a valid number.`, embeds: [], components: [] });
  }
  
  if (shares > maxShares) {
    return interaction.editReply({ content: `❌ Cannot buy ${shares} shares. Max: ${maxShares}`, embeds: [], components: [] });
  }
  
  const subtotal = Math.round(currentPrice * shares);
  const fee = calculateBuyFee(guildId, subtotal, userId);
  const totalCost = subtotal + fee;
  
  // Check if user has enough
  if (isEnabled()) {
    const hasEnough = await hasEnoughInBank(guildId, userId, totalCost);
    if (!hasEnough) {
      return interaction.editReply({ 
        content: `❌ Insufficient funds! Need **${totalCost.toLocaleString()}** ${getCurrency(guildId)}`, 
        embeds: [], 
        components: [] 
      });
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📋 Confirm Purchase')
    .setDescription(`You are about to buy shares of **${username}**`)
    .addFields(
      { name: '📊 Shares', value: `${shares.toLocaleString()}`, inline: true },
      { name: '💵 Price/Share', value: `${Math.round(currentPrice).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📝 Subtotal', value: `${subtotal.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Trading Fee', value: `${fee.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💳 Total Cost', value: `**${totalCost.toLocaleString()}** ${getCurrency(guildId)}`, inline: false }
    );
  
  // Add Lucky Penny modifier line if active
  if (lpBuyMod !== 0) {
    const lpDiff = subtotal - Math.round(basePrice * shares);
    const lpSign = lpDiff >= 0 ? '+' : '';
    embed.spliceFields(3, 0,
      { name: `🪙 Lucky Penny (${lpBuyMod > 0 ? '+' : ''}${lpBuyMod}%)`, value: `${lpSign}${lpDiff.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
    );
  }
  
  embed.setFooter({ text: 'Do you want to proceed with this purchase?' });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stock_confirm_buy_${shares}_${targetUserId}`)
      .setLabel('Yes, Buy')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`stock_cancel_buy_${targetUserId}`)
      .setLabel('No, Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
  
  return interaction.editReply({ embeds: [embed], components: [row] });
}

// Show buy confirmation from modal (uses deferReply instead of deferUpdate)
async function showBuyConfirmationFromModal(interaction, guildId, userId, targetUserId, amount) {
  await interaction.deferReply({ flags: 64 });
  
  let username = targetUserId;
  try {
    const user = await interaction.client.users.fetch(targetUserId);
    username = user.username;
  } catch (e) {}
  
  const basePrice = calculateStockPrice(targetUserId, guildId);
  const lpBuyMod = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.STOCK_PRICES);
  const currentPrice = lpBuyMod !== 0
    ? Math.max(0.01, Math.round(basePrice * (1 + lpBuyMod / 100) * 100) / 100)
    : basePrice;
  
  // Get balance and calculate max shares
  let balance = 0;
  if (isEnabled()) {
    const balanceData = await getBalance(guildId, userId);
    balance = balanceData.bank;
  }
  
  const settings = getGuildSettings(guildId);
  const feePercent = settings.buyFeeType === 'percent' ? settings.buyFeeValue / 100 : 0;
  const fixedFee = settings.buyFeeType === 'fixed' ? settings.buyFeeValue : 0;
  const maxShares = Math.floor((balance - fixedFee) / (currentPrice * (1 + feePercent)));
  
  const shares = parseInt(amount);
  
  if (isNaN(shares) || shares < 1) {
    return interaction.editReply({ content: `❌ Invalid amount. Please enter a valid number.`, embeds: [], components: [] });
  }
  
  if (shares > maxShares) {
    return interaction.editReply({ content: `❌ Cannot buy ${shares} shares. Max: ${maxShares}`, embeds: [], components: [] });
  }
  
  const subtotal = Math.round(currentPrice * shares);
  const fee = calculateBuyFee(guildId, subtotal, userId);
  const totalCost = subtotal + fee;
  
  // Check if user has enough
  if (isEnabled()) {
    const hasEnough = await hasEnoughInBank(guildId, userId, totalCost);
    if (!hasEnough) {
      return interaction.editReply({ 
        content: `❌ Insufficient funds! Need **${totalCost.toLocaleString()}** ${getCurrency(guildId)}`, 
        embeds: [], 
        components: [] 
      });
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📋 Confirm Purchase')
    .setDescription(`You are about to buy shares of **${username}**`)
    .addFields(
      { name: '📊 Shares', value: `${shares.toLocaleString()}`, inline: true },
      { name: '💵 Price/Share', value: `${Math.round(currentPrice).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📝 Subtotal', value: `${subtotal.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Trading Fee', value: `${fee.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💳 Total Cost', value: `**${totalCost.toLocaleString()}** ${getCurrency(guildId)}`, inline: false }
    );
  
  // Add Lucky Penny modifier line if active
  if (lpBuyMod !== 0) {
    const lpDiff = subtotal - Math.round(basePrice * shares);
    const lpSign = lpDiff >= 0 ? '+' : '';
    embed.spliceFields(3, 0,
      { name: `🪙 Lucky Penny (${lpBuyMod > 0 ? '+' : ''}${lpBuyMod}%)`, value: `${lpSign}${lpDiff.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
    );
  }
  
  embed.setFooter({ text: 'Do you want to proceed with this purchase?' });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stock_modal_confirm_buy_${shares}_${targetUserId}`)
      .setLabel('Yes, Buy')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`stock_modal_cancel_buy`)
      .setLabel('No, Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
  
  return interaction.editReply({ embeds: [embed], components: [row] });
}

// Show sell confirmation embed with detailed fee/tax breakdown
async function showSellConfirmation(interaction, guildId, userId, targetUserId, amount, fromModal = false) {
  const stock = getStock(userId, targetUserId);
  
  if (!stock) {
    const msg = { content: '❌ You don\'t own this stock!', embeds: [], components: [] };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  const shares = amount === 'all' ? stock.shares : parseInt(amount);
  
  if (isNaN(shares) || shares < 1) {
    const msg = { content: '❌ Invalid amount. Please enter a valid number.', embeds: [], components: [] };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  if (shares > stock.shares) {
    const msg = { content: `❌ You only own **${stock.shares}** shares!`, embeds: [], components: [] };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  // Check sell cooldown
  const cooldownCheck = checkSellCooldown(guildId, userId, targetUserId, shares, stock.shares);
  if (!cooldownCheck.canSell) {
    const msg = { 
      content: `❌ ${cooldownCheck.reason}\n⏱️ Wait **${cooldownCheck.waitMinutes} minutes**.`, 
      embeds: [], 
      components: [] 
    };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  if (fromModal) {
    await interaction.deferReply({ flags: 64 });
  } else {
    await interaction.deferUpdate();
  }
  
  let username = targetUserId;
  try {
    const user = await interaction.client.users.fetch(targetUserId);
    username = user.username;
  } catch (e) {}
  
  const baseSellPrice = calculateStockPrice(targetUserId, guildId);
  const lpSellMod = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.STOCK_PRICES);
  const currentPrice = lpSellMod !== 0
    ? Math.max(0.01, Math.round(baseSellPrice * (1 + lpSellMod / 100) * 100) / 100)
    : baseSellPrice;
  const grossValue = Math.round(currentPrice * shares);
  const fee = calculateSellFee(guildId, grossValue, userId);
  
  // Preview capital gains tax without modifying database
  const { totalTax, breakdown } = previewCapitalGainsTax(guildId, userId, targetUserId, shares, currentPrice);
  
  const totalDeductions = fee + totalTax;
  const netValue = Math.max(0, grossValue - totalDeductions);
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('📋 Confirm Sale')
    .setDescription(`You are about to sell shares of **${username}**`)
    .addFields(
      { name: '📊 Shares', value: `${shares.toLocaleString()}`, inline: true },
      { name: '💵 Price/Share', value: `${Math.round(currentPrice).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📝 Gross Sale', value: `${grossValue.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Trading Fee', value: `-${fee.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );
  
  // Add Lucky Penny modifier line if active
  if (lpSellMod !== 0) {
    const lpDiff = grossValue - Math.round(baseSellPrice * shares);
    const lpSign = lpDiff >= 0 ? '+' : '';
    embed.addFields(
      { name: `🪙 Lucky Penny (${lpSellMod > 0 ? '+' : ''}${lpSellMod}%)`, value: `${lpSign}${lpDiff.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
    );
  }
  
  // Add capital gains tax breakdown if applicable
  if (totalTax > 0) {
    let taxDetails = '';
    const marketSettings = getMarketSettings(guildId);
    
    // Summarize short-term vs long-term
    const shortTermTax = breakdown.filter(b => b.isShortTerm).reduce((sum, b) => sum + b.tax, 0);
    const longTermTax = breakdown.filter(b => !b.isShortTerm).reduce((sum, b) => sum + b.tax, 0);
    
    if (shortTermTax > 0) {
      taxDetails += `Short-term (${marketSettings.shortTermTaxPercent}%): -${shortTermTax.toLocaleString()} ${getCurrency(guildId)}\n`;
    }
    if (longTermTax > 0) {
      taxDetails += `Long-term (${marketSettings.longTermTaxPercent}%): -${longTermTax.toLocaleString()} ${getCurrency(guildId)}\n`;
    }
    
    embed.addFields(
      { name: '📈 Capital Gains Tax', value: taxDetails || 'None', inline: false }
    );
  }
  
  embed.addFields(
    { name: '💳 You Will Receive', value: `**${netValue.toLocaleString()}** ${getCurrency(guildId)}`, inline: false }
  );
  
  embed.setFooter({ text: 'Do you want to proceed with this sale?' });
  
  // Use different button IDs for modal vs regular flow
  const confirmId = fromModal ? `stock_modal_confirm_sell_${shares}_${targetUserId}` : `stock_confirm_sell_${shares}_${targetUserId}`;
  const cancelId = fromModal ? `stock_modal_cancel_sell` : `stock_cancel_sell_${targetUserId}`;
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel('Yes, Sell')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel('No, Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
  
  return interaction.editReply({ embeds: [embed], components: [row] });
}

async function executeBuy(interaction, guildId, userId, targetUserId, amount, fromModal = false) {
  const transactionKey = `${userId}-buy-${targetUserId}`;
  if (pendingTransactions.has(transactionKey)) {
    return interaction.reply({ content: '⏳ Transaction in progress...', flags: 64 });
  }
  pendingTransactions.add(transactionKey);
  
  let moneyDeducted = false;
  let totalCost = 0;
  try {
  // Always use deferUpdate for button clicks (even from modal confirmation flow)
  await interaction.deferUpdate();
  
  let username = targetUserId;
  try {
    const user = await interaction.client.users.fetch(targetUserId);
    username = user.username;
  } catch (e) {}
  
  // Ensure users exist in database
  createUser(userId, interaction.user.username);
  createUser(targetUserId, username);
  
  const baseBuyPrice = calculateStockPrice(targetUserId, guildId);
  // Apply Lucky Penny stock price modifier (personal to the buyer)
  const lpBuyStockMod = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.STOCK_PRICES);
  const currentPrice = lpBuyStockMod !== 0 
    ? Math.max(0.01, Math.round(baseBuyPrice * (1 + lpBuyStockMod / 100) * 100) / 100)
    : baseBuyPrice;
  
  // Get balance and calculate max shares
  let balance = 0;
  if (isEnabled()) {
    const balanceData = await getBalance(guildId, userId);
    balance = balanceData.bank;
  }
  
  const settings = getGuildSettings(guildId);
  const feePercent = settings.buyFeeType === 'percent' ? settings.buyFeeValue / 100 : 0;
  const fixedFee = settings.buyFeeType === 'fixed' ? settings.buyFeeValue : 0;
  const maxShares = Math.floor((balance - fixedFee) / (currentPrice * (1 + feePercent)));
  
  const shares = amount === 'max' ? maxShares : parseInt(amount);
  
  if (isNaN(shares) || shares < 1) {
    const msg = { content: `❌ Invalid amount. Please enter a valid number.`, embeds: [], components: [] };
    return fromModal ? interaction.editReply(msg) : interaction.editReply(msg);
  }
  
  if (shares > maxShares) {
    const msg = { content: `❌ Cannot buy ${shares} shares. Max: ${maxShares}`, embeds: [], components: [] };
    return fromModal ? interaction.editReply(msg) : interaction.editReply(msg);
  }
  
  const subtotal = Math.round(currentPrice * shares);
  const fee = calculateBuyFee(guildId, subtotal, userId);
  totalCost = subtotal + fee;
  
  // Check and deduct balance
  if (isEnabled()) {
    const hasEnough = await hasEnoughInBank(guildId, userId, totalCost);
    
    if (!hasEnough) {
      return interaction.editReply({ 
        content: `❌ Insufficient funds! Need **${totalCost.toLocaleString()}** ${getCurrency(guildId)}`, 
        embeds: [], 
        components: [] 
      });
    }
    
    await removeFromBank(guildId, userId, totalCost, `Bought ${shares} shares of ${username} (fee: ${fee})`);
    moneyDeducted = true;
  }
  
  buyStock(userId, targetUserId, shares, currentPrice);
  logTransaction(userId, targetUserId, shares, currentPrice, 'BUY', Date.now());
  recordPurchase(guildId, userId, targetUserId, shares, currentPrice);
  recordPriceImpact(guildId, targetUserId, shares);
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Purchase Successful!')
    .setDescription(`**${interaction.user.displayName}** bought **${shares}** shares of **${username}**`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Price/Share', value: `${Math.round(currentPrice).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: 'Subtotal', value: `${subtotal.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: 'Fee', value: `${fee.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: 'Total Paid', value: `**${totalCost.toLocaleString()}** ${getCurrency(guildId)}`, inline: true }
    );
  
  // Show market protection info
  const marketSettings = getMarketSettings(guildId);
  const notices = [];
  if (marketSettings.sellCooldownEnabled) {
    notices.push(`⏱️ Hold for ${marketSettings.sellCooldownMinutes}min before selling`);
  }
  if (marketSettings.priceImpactEnabled) {
    notices.push(`📈 Price impact applies over ${marketSettings.priceImpactDelayMinutes}min`);
  }
  if (notices.length > 0) {
    embed.addFields({ name: '📋 Market Rules', value: notices.join('\n'), inline: false });
  }
  
  // For modal confirmations, clear the ephemeral confirmation message
  // For regular flow, update the panel
  if (fromModal) {
    await interaction.editReply({ content: '✅ Purchase complete!', embeds: [], components: [] });
  } else {
    await showStockPanel(interaction, guildId, userId, true, true);
  }
  
  try {
    await interaction.channel.send({ embeds: [embed] });
  } catch (e) {
    // Channel send failed (missing permissions), but purchase succeeded
  }

  } catch (error) {
    console.error('Error buying stock:', error);
    // Refund money if it was already deducted but shares weren't recorded
    if (moneyDeducted) {
      try { await addMoney(guildId, userId, totalCost, 'Buy refund - transaction error'); } catch (e) { console.error('Failed to refund buy:', e); }
    }
    try {
      await interaction.editReply({ content: '❌ Error processing purchase.', embeds: [], components: [] });
    } catch (e) {}
  } finally {
    pendingTransactions.delete(transactionKey);
  }
}

async function showSellView(interaction, guildId, userId) {
  const portfolio = getPortfolio(userId);
  
  if (portfolio.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('💰 Sell Stocks')
      .setDescription('You don\'t own any stocks to sell!');
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return interaction.update({ embeds: [embed], components: [backButton] });
  }
  
  // Build select menu with owned stocks
  const options = [];
  for (const stock of portfolio.slice(0, 25)) {
    let username = stock.stock_user_id;
    try {
      const user = await interaction.client.users.fetch(stock.stock_user_id);
      username = user.username;
    } catch (e) {}
    
    const currentPrice = calculateStockPrice(stock.stock_user_id, guildId);
    const value = Math.round(currentPrice * stock.shares);
    
    options.push({
      label: username,
      description: `${stock.shares} shares (${value.toLocaleString()} ${getCurrency(guildId)})`,
      value: stock.stock_user_id
    });
  }
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('💰 Sell Stocks')
    .setDescription('Select a stock to sell:');
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('stock_sell_select')
    .setPlaceholder('Choose a stock to sell...')
    .addOptions(options);
  
  const selectRow = new ActionRowBuilder().addComponents(selectMenu);
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [selectRow, backButton] });
}

async function showSellAmountButtons(interaction, guildId, userId, targetUserId, isCancel = false) {
  // If coming from cancel, defer the update
  if (isCancel) {
    await interaction.deferUpdate();
  }
  
  const stock = getStock(userId, targetUserId);
  
  if (!stock) {
    return interaction.update({ content: '❌ You don\'t own this stock anymore!', embeds: [], components: [] });
  }
  
  let username = targetUserId;
  try {
    const user = await interaction.client.users.fetch(targetUserId);
    username = user.username;
  } catch (e) {}
  
  const basePrice = calculateStockPrice(targetUserId, guildId);
  const lpSellMod = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.STOCK_PRICES);
  const currentPrice = lpSellMod !== 0
    ? Math.max(0.01, Math.round(basePrice * (1 + lpSellMod / 100) * 100) / 100)
    : basePrice;
  const totalValue = Math.round(currentPrice * stock.shares);
  
  const lpNote = lpSellMod !== 0 ? ` (${lpSellMod > 0 ? '+' : ''}${lpSellMod}% LP)` : '';
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`💰 Sell ${username}`)
    .setDescription(`You own **${stock.shares}** shares\nCurrent value: **${totalValue.toLocaleString()}** ${getCurrency(guildId)}`)
    .addFields(
      { name: 'Price/Share', value: `${Math.round(currentPrice).toLocaleString()} ${getCurrency(guildId)}${lpNote}`, inline: true }
    );
  
  // Create amount buttons based on shares owned
  const shares = stock.shares;
  
  // Create amount buttons - Row 1: 1, 5, 10, 25
  const row1Buttons = [];
  if (shares >= 1) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_1_${targetUserId}`).setLabel('1').setStyle(ButtonStyle.Danger));
  if (shares >= 5) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_5_${targetUserId}`).setLabel('5').setStyle(ButtonStyle.Danger));
  if (shares >= 10) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_10_${targetUserId}`).setLabel('10').setStyle(ButtonStyle.Danger));
  if (shares >= 25) row1Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_25_${targetUserId}`).setLabel('25').setStyle(ButtonStyle.Danger));
  
  // Row 2: 50, 100, 500
  const row2Buttons = [];
  if (shares >= 50) row2Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_50_${targetUserId}`).setLabel('50').setStyle(ButtonStyle.Danger));
  if (shares >= 100) row2Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_100_${targetUserId}`).setLabel('100').setStyle(ButtonStyle.Danger));
  if (shares >= 500) row2Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_500_${targetUserId}`).setLabel('500').setStyle(ButtonStyle.Danger));
  
  // Row 3: 1000, Max, Custom
  const row3Buttons = [];
  if (shares >= 1000) row3Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_1000_${targetUserId}`).setLabel('1000').setStyle(ButtonStyle.Danger));
  row3Buttons.push(new ButtonBuilder().setCustomId(`stock_sell_all_${targetUserId}`).setLabel(`Max (${shares})`).setStyle(ButtonStyle.Danger));
  row3Buttons.push(new ButtonBuilder().setCustomId(`stock_sellcustom_${targetUserId}`).setLabel('Custom').setStyle(ButtonStyle.Primary));
  
  const components = [];
  if (row1Buttons.length > 0) components.push(new ActionRowBuilder().addComponents(row1Buttons));
  if (row2Buttons.length > 0) components.push(new ActionRowBuilder().addComponents(row2Buttons));
  if (row3Buttons.length > 0) components.push(new ActionRowBuilder().addComponents(row3Buttons));
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_sell')
      .setLabel('Back')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  components.push(backButton);
  
  if (isCancel) {
    await interaction.editReply({ embeds: [embed], components });
  } else {
    await interaction.update({ embeds: [embed], components });
  }
}

async function executeSell(interaction, guildId, userId, targetUserId, amount, fromModal = false) {
  const transactionKey = `${userId}-sell-${targetUserId}`;
  if (pendingTransactions.has(transactionKey)) {
    return interaction.reply({ content: '⏳ Transaction in progress...', flags: 64 });
  }
  pendingTransactions.add(transactionKey);
  
  let sharesSold = false;
  let soldShares = 0;
  let soldPrice = 0;
  try {
  const stock = getStock(userId, targetUserId);
  
  if (!stock) {
    const msg = { content: '❌ You don\'t own this stock!', embeds: [], components: [] };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  const shares = amount === 'all' ? stock.shares : parseInt(amount);
  
  if (isNaN(shares) || shares < 1) {
    const msg = { content: '❌ Invalid amount. Please enter a valid number.', embeds: [], components: [] };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  if (shares > stock.shares) {
    const msg = { content: `❌ You only own **${stock.shares}** shares!`, embeds: [], components: [] };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  // Check sell cooldown
  const cooldownCheck = checkSellCooldown(guildId, userId, targetUserId, shares, stock.shares);
  if (!cooldownCheck.canSell) {
    const msg = { 
      content: `❌ ${cooldownCheck.reason}\n⏱️ Wait **${cooldownCheck.waitMinutes} minutes**.`, 
      embeds: [], 
      components: [] 
    };
    return fromModal ? interaction.reply({ ...msg, flags: 64 }) : interaction.update(msg);
  }
  
  // Always use deferUpdate for button clicks (even from modal confirmation flow)
  await interaction.deferUpdate();
  
  let username = targetUserId;
  try {
    const user = await interaction.client.users.fetch(targetUserId);
    username = user.username;
  } catch (e) {}
  
  const baseSellPrice = calculateStockPrice(targetUserId, guildId);
  // Apply Lucky Penny stock price modifier (personal to the seller)
  const lpSellStockMod = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.STOCK_PRICES);
  const currentPrice = lpSellStockMod !== 0 
    ? Math.max(0.01, Math.round(baseSellPrice * (1 + lpSellStockMod / 100) * 100) / 100)
    : baseSellPrice;
  const grossValue = Math.round(currentPrice * shares);
  const fee = calculateSellFee(guildId, grossValue, userId);
  
  const consumedPurchases = consumePurchaseShares(guildId, userId, targetUserId, shares);
  const { totalTax } = calculateCapitalGainsTax(guildId, consumedPurchases, currentPrice);
  
  const netValue = Math.max(0, grossValue - fee - totalTax);
  
  sellStock(shares, userId, targetUserId);
  deleteStock(userId, targetUserId);
  soldShares = shares;
  soldPrice = currentPrice;
  sharesSold = true;
  logTransaction(userId, targetUserId, shares, currentPrice, 'SELL', Date.now());
  recordPriceImpact(guildId, targetUserId, -shares);
  
  if (isEnabled() && netValue > 0) {
    await addMoney(guildId, userId, netValue, `Sold ${shares} shares of ${username}`);
  }

  // --- Insider Trading Check ---
  try {
    const { checkInsiderTrading, addInfamy, announceInsiderTrading, getInfamySettings } = require('../infamy');
    const infSettings = getInfamySettings(guildId);
    if (infSettings && infSettings.enabled) {
      const insiderResult = checkInsiderTrading(guildId, userId, targetUserId, currentPrice, shares);
      if (insiderResult && insiderResult.detected) {
        await addInfamy(guildId, userId, insiderResult.infamyGain, 'insider');
        await announceInsiderTrading(interaction.client, guildId, userId, targetUserId, insiderResult.profitPercent, insiderResult.infamyGain);
      }
    }
  } catch (e) {
    console.error('[Infamy] Insider trading check error:', e);
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Sold!')
    .setDescription(`**${interaction.user.displayName}** sold **${shares}** shares of **${username}**`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Gross Value', value: `${grossValue.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: 'Fees/Tax', value: `-${(fee + totalTax).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: 'You Received', value: `**${netValue.toLocaleString()}** ${getCurrency(guildId)}`, inline: true }
    );
  
  // For modal confirmations, clear the ephemeral confirmation message
  // For regular flow, update the panel
  if (fromModal) {
    await interaction.editReply({ content: '✅ Sale complete!', embeds: [], components: [] });
  } else {
    await showStockPanel(interaction, guildId, userId, true, true);
  }
  
  try {
    await interaction.channel.send({ embeds: [embed] });
  } catch (e) {
    // Channel send failed (missing permissions), but sale succeeded
  }

  } catch (error) {
    console.error('Error selling stock:', error);
    // Rollback: re-add shares if they were already removed but payment failed
    if (sharesSold) {
      try { buyStock(userId, targetUserId, soldShares, soldPrice); } catch (e) { console.error('Failed to rollback sell:', e); }
    }
    try {
      await interaction.editReply({ content: '❌ Error selling stock.', embeds: [], components: [] });
    } catch (e) {}
  } finally {
    pendingTransactions.delete(transactionKey);
  }
}

async function showSplitView(interaction, guildId, userId) {
  const stockPrice = calculateStockPrice(userId, guildId);
  const settings = getDividendSettings(guildId);
  const splitCheck = canSplit(guildId, userId, stockPrice);
  
  const embed = new EmbedBuilder()
    .setColor(splitCheck.canSplit ? 0x9b59b6 : 0xe74c3c)
    .setTitle('✂️ Stock Split')
    .setDescription(`**Your Stock Price:** ${Math.round(stockPrice).toLocaleString()} ${getCurrency(guildId)}`);
  
  // Add requirements info
  embed.addFields(
    { name: '📈 Min Price Required', value: `${settings.splitMinPrice.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
    { name: '⏱️ Cooldown', value: `${settings.splitCooldownHours} hours`, inline: true }
  );
  
  // Show what each split would result in
  if (splitCheck.canSplit) {
    const price2to1 = Math.round(stockPrice / 2);
    const price3to1 = Math.round(stockPrice / 3);
    const price4to1 = Math.round(stockPrice / 4);
    
    embed.addFields({
      name: '📊 Split Results',
      value: `**2:1** → ${price2to1.toLocaleString()} ${getCurrency(guildId)} (shares x2)\n` +
             `**3:1** → ${price3to1.toLocaleString()} ${getCurrency(guildId)} (shares x3)\n` +
             `**4:1** → ${price4to1.toLocaleString()} ${getCurrency(guildId)} (shares x4)`,
      inline: false
    });
    
    embed.setFooter({ text: 'Splitting lowers your price but multiplies all shareholders\' shares!' });
  } else {
    embed.addFields({
      name: '❌ Cannot Split',
      value: splitCheck.reason,
      inline: false
    });
  }
  
  const components = [];
  
  if (splitCheck.canSplit) {
    const splitRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_split_2:1')
        .setLabel('2:1 Split')
        .setEmoji('✂️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('stock_split_3:1')
        .setLabel('3:1 Split')
        .setEmoji('✂️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('stock_split_4:1')
        .setLabel('4:1 Split')
        .setEmoji('✂️')
        .setStyle(ButtonStyle.Primary)
    );
    components.push(splitRow);
  }
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  components.push(backButton);
  
  await interaction.update({ embeds: [embed], components });
}

async function executeStockSplit(interaction, guildId, userId, ratio) {
  await interaction.deferUpdate();
  
  const stockPrice = calculateStockPrice(userId, guildId);
  const splitCheck = canSplit(guildId, userId, stockPrice);
  
  if (!splitCheck.canSplit) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ Cannot Split')
      .setDescription(splitCheck.reason);
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return interaction.editReply({ embeds: [embed], components: [backButton] });
  }
  
  // Execute the split using the function from dividends.js
  // It needs a function to update shares - we'll use setShares from database
  const updateSharesFunc = (ownerId, stockUserId, newShareCount) => {
    setShares(ownerId, stockUserId, newShareCount);
  };
  
  const result = executeSplit(guildId, userId, ratio, stockPrice, getAllStockHolders, updateSharesFunc, adjustAvgBuyPrice);
  
  // Apply price modifier to reduce the stock price
  // For a 2:1 split, we multiply price by 0.5 (1/2)
  // For a 3:1 split, we multiply price by 0.333 (1/3)
  // For a 4:1 split, we multiply price by 0.25 (1/4)
  const currentModifier = getPriceModifier(userId);
  const newModifier = currentModifier / result.multiplier;
  setPriceModifier(userId, newModifier);
  
  // Get the actual new price after modifier applied
  const newPrice = calculateStockPrice(userId, guildId);
  
  // Update ticker's lastKnownPrices to prevent false price drop alert
  await sendSplitAnnouncement(userId, interaction.user.username, ratio, result.priceBefore, newPrice, result.shareholdersAffected);
  
  // Announce the split in the configured channel
  const settings = getDividendSettings(guildId);
  if (settings.announcementChannelId) {
    try {
      const channel = await interaction.client.channels.fetch(settings.announcementChannelId);
      if (channel && channel.isTextBased()) {
        const announceEmbed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('✂️ Stock Split!')
          .setDescription(`**${interaction.user.username}** just performed a **${ratio}** stock split!`)
          .addFields(
            { name: '💰 Price Before', value: `${Math.round(result.priceBefore).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
            { name: '💰 Price After', value: `${Math.round(newPrice).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
            { name: '📈 Share Multiplier', value: `x${result.multiplier}`, inline: true },
            { name: '👥 Shareholders', value: `${result.shareholdersAffected} shareholders received additional shares`, inline: false }
          )
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        await channel.send({ embeds: [announceEmbed] });
      }
    } catch (e) {
      console.error('Failed to announce split:', e);
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✂️ Stock Split Complete!')
    .setDescription(`You performed a **${ratio}** stock split!`)
    .addFields(
      { name: '💰 Price Before', value: `${Math.round(result.priceBefore).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Price After', value: `${Math.round(newPrice).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '👥 Shareholders Affected', value: `${result.shareholdersAffected}`, inline: true },
      { name: '📈 Share Multiplier', value: `x${result.multiplier}`, inline: true }
    )
    .setFooter({ text: 'All shareholders now have more shares at the new lower price!' })
    .setTimestamp();
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.editReply({ embeds: [embed], components: [backButton] });
}

async function showPortfolioUserSelect(interaction, guildId, userId) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💼 View Portfolio')
    .setDescription('Select a user from the dropdown, or search by their Discord username if you can\'t find them.');
  
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('stock_portfolio_select_user')
    .setPlaceholder('Select a user to view their portfolio...');
  
  const selectRow = new ActionRowBuilder().addComponents(userSelect);
  
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_search_portfolio')
      .setLabel('Search by Username')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function showPortfolioView(interaction, guildId, targetUserId, isDeferred = false, page = 0) {
  // Helper to respond correctly based on deferred state
  const respond = (data) => isDeferred ? interaction.editReply(data) : interaction.update(data);
  
  // Fetch target user info
  let targetUser;
  try {
    targetUser = await interaction.client.users.fetch(targetUserId);
  } catch (e) {
    targetUser = { username: 'Unknown User', displayAvatarURL: () => null };
  }
  
  const portfolio = getPortfolio(targetUserId);
  const isOwnPortfolio = targetUserId === interaction.user.id;
  
  if (portfolio.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle(`💼 ${targetUser.username}'s Portfolio`)
      .setDescription(isOwnPortfolio ? 'You don\'t own any stocks yet!' : `${targetUser.username} doesn't own any stocks yet!`);
    
    if (targetUser.displayAvatarURL()) {
      embed.setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));
    }
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return respond({ embeds: [embed], components: [backButton] });
  }
  
  const holdings = [];
  let totalValue = 0;
  let totalProfit = 0;
  
  for (const stock of portfolio) {
    const currentPrice = calculateStockPrice(stock.stock_user_id, guildId);
    const currentValue = currentPrice * stock.shares;
    const invested = stock.avg_buy_price * stock.shares;
    const profit = currentValue - invested;
    
    totalValue += currentValue;
    totalProfit += profit;
    
    let username = stock.stock_user_id;
    try {
      const user = await interaction.client.users.fetch(stock.stock_user_id);
      username = user.username;
    } catch (e) {}
    
    holdings.push({ username, shares: stock.shares, currentPrice, currentValue, profit, avgBuyPrice: stock.avg_buy_price });
  }
  
  holdings.sort((a, b) => b.currentValue - a.currentValue);
  
  const perPage = 10;
  const totalPages = Math.ceil(holdings.length / perPage);
  if (page < 0) page = 0;
  if (page >= totalPages) page = totalPages - 1;
  const start = page * perPage;
  const pageHoldings = holdings.slice(start, start + perPage);
  
  const holdingsList = pageHoldings.map((h, i) => {
    const profitSign = h.profit >= 0 ? '+' : '';
    const profitEmoji = h.profit >= 0 ? '📈' : '📉';
    return `**${start + i + 1}. ${h.username}** (${h.shares} shares @ ${Math.round(h.currentPrice).toLocaleString()} ${getCurrency(guildId)})\n` +
           `   💵 Avg: ${Math.round(h.avgBuyPrice).toLocaleString()} | 💰 ${Math.round(h.currentValue).toLocaleString()} ${getCurrency(guildId)} ${profitEmoji} ${profitSign}${Math.round(h.profit).toLocaleString()}`;
  }).join('\n\n');
  
  const totalProfitSign = totalProfit >= 0 ? '+' : '';
  const totalProfitEmoji = totalProfit >= 0 ? '📈' : '📉';
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`💼 ${targetUser.username}'s Portfolio`)
    .setDescription(holdingsList || 'No holdings')
    .addFields(
      { name: '💰 Total Value', value: `${Math.round(totalValue).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: `${totalProfitEmoji} Total P/L`, value: `${totalProfitSign}${Math.round(totalProfit).toLocaleString()} ${getCurrency(guildId)}`, inline: true }
    )
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${portfolio.length} total holdings` });
  
  if (targetUser.displayAvatarURL()) {
    embed.setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));
  }
  
  const buttons = []
  if (totalPages > 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`stock_portfolio_page_${page - 1}_${targetUserId}`)
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`stock_portfolio_page_${page + 1}_${targetUserId}`)
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages - 1)
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  const buttonRow = new ActionRowBuilder().addComponents(buttons);
  
  await respond({ embeds: [embed], components: [buttonRow] });
}

async function showHistoryView(interaction, guildId, userId) {
  const settings = getDividendSettings(guildId);
  const history = getDividendHistory(guildId, userId, 15);
  const totalReceived = getTotalDividendsReceived(guildId, userId);
  const ceoHistory = getSelfDividendHistory(guildId, userId, 5);
  const totalCeoReceived = getTotalSelfDividendsReceived(guildId, userId);
  
  const grandTotal = totalReceived + totalCeoReceived;
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('📜 Dividend & CEO Bonus History')
    .setDescription(`**Combined Total Earnings:** ${grandTotal.toLocaleString()} ${getCurrency(guildId)}`);
  
  embed.addFields({
    name: '💰 Total Dividends',
    value: `**${totalReceived.toLocaleString()}** ${getCurrency(guildId)}`,
    inline: true
  });
  
  if (settings.selfDividendEnabled) {
    embed.addFields({
      name: '🎩 Total CEO Bonuses',
      value: `**${totalCeoReceived.toLocaleString()}** ${getCurrency(guildId)}`,
      inline: true
    });
  }
  
  if (history.length > 0) {
    const grouped = {};
    for (const h of history) {
      const dateKey = new Date(h.payout_time).toLocaleDateString();
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(h);
    }
    
    let historyText = '';
    for (const [date, payouts] of Object.entries(grouped).slice(0, 5)) {
      const totalForDay = payouts.reduce((sum, p) => sum + p.dividend_amount, 0);
      historyText += `**${date}** - ${totalForDay.toLocaleString()} ${getCurrency(guildId)} (${payouts.length} stocks)\n`;
    }
    
    embed.addFields({
      name: '📊 Recent Dividends',
      value: historyText || 'No recent history'
    });
  }
  
  if (ceoHistory.length > 0) {
    const ceoText = ceoHistory.map(h => {
      const date = new Date(h.payout_time).toLocaleDateString();
      return `**${date}** - ${h.bonus_amount.toLocaleString()} ${getCurrency(guildId)}`;
    }).join('\n');
    
    embed.addFields({
      name: '👑 Recent CEO Bonuses',
      value: ceoText
    });
  }
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [backButton] });
}

async function showShareholdersUserSelect(interaction, guildId, userId) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('👥 View Shareholders')
    .setDescription('Select a user from the dropdown, or search by their Discord username if you can\'t find them.');
  
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('stock_shareholders_select_user')
    .setPlaceholder('Select a user to view their shareholders...');
  
  const selectRow = new ActionRowBuilder().addComponents(userSelect);
  
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_search_shareholders')
      .setLabel('Search by Username')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [selectRow, buttonRow] });
}

async function showShareholdersView(interaction, guildId, targetUserId, isDeferred = false) {
  // Helper to respond correctly based on deferred state
  const respond = (data) => isDeferred ? interaction.editReply(data) : interaction.update(data);
  
  // Fetch target user info
  let targetUser;
  try {
    targetUser = await interaction.client.users.fetch(targetUserId);
  } catch (e) {
    targetUser = { username: 'Unknown User', displayAvatarURL: () => null };
  }
  
  const shareholders = getAllStockHolders(targetUserId);
  const currentPrice = calculateStockPrice(targetUserId, guildId);
  
  if (shareholders.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle(`👥 Shareholders of ${targetUser.username}`)
      .setDescription('No one owns shares of this stock yet!')
      .addFields({ name: '💰 Current Price', value: `**${Math.round(currentPrice).toLocaleString()}** ${getCurrency(guildId)}`, inline: true });
    
    if (targetUser.displayAvatarURL()) {
      embed.setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));
    }
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return respond({ embeds: [embed], components: [backButton] });
  }
  
  let totalShares = 0;
  let totalValue = 0;
  const holdersWithDetails = [];
  
  for (const holder of shareholders) {
    let username = holder.ownerId;
    try {
      const user = await interaction.client.users.fetch(holder.ownerId);
      username = user.username;
    } catch (e) {}
    
    const value = holder.shares * currentPrice;
    totalShares += holder.shares;
    totalValue += value;
    
    holdersWithDetails.push({ username, shares: holder.shares, value });
  }
  
  holdersWithDetails.sort((a, b) => b.shares - a.shares);
  
  const holdersList = holdersWithDetails.slice(0, 10).map((h, i) => {
    const percentage = ((h.shares / totalShares) * 100).toFixed(1);
    return `**${i + 1}. ${h.username}**\n   📈 ${h.shares} shares (${percentage}%) | 💰 ${Math.round(h.value).toLocaleString()} ${getCurrency(guildId)}`;
  }).join('\n\n');
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`👥 Shareholders of ${targetUser.username}`)
    .setDescription(holdersList)
    .addFields(
      { name: '💰 Price', value: `${Math.round(currentPrice).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '📈 Total Shares', value: `${totalShares}`, inline: true },
      { name: '🏦 Market Cap', value: `${Math.round(totalValue).toLocaleString()} ${getCurrency(guildId)}`, inline: true }
    )
    .setFooter({ text: `${shareholders.length} total shareholders` });
  
  if (targetUser.displayAvatarURL()) {
    embed.setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));
  }
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await respond({ embeds: [embed], components: [backButton] });
}

// Show modal for username search
async function showUsernameSearchModal(interaction, searchType) {
  const titles = {
    'price': 'Search User - View Stock',
    'buy': 'Search User - Buy Stock',
    'portfolio': 'Search User - View Portfolio',
    'shareholders': 'Search User - View Shareholders'
  };

  const modal = new ModalBuilder()
    .setCustomId(`modal_stock_search_${searchType}`)
    .setTitle(titles[searchType] || 'Search User');

  const usernameInput = new TextInputBuilder()
    .setCustomId('username_search')
    .setLabel('Discord Username')
    .setPlaceholder('Enter their Discord username (e.g. john_doe123)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(32);

  const row = new ActionRowBuilder().addComponents(usernameInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

// Handle username search result
async function handleUsernameSearch(interaction, guildId, searchType, searchQuery) {
  await interaction.deferUpdate();

  try {
    const guild = interaction.guild;
    
    // First, search in cache (already loaded members)
    let matchingMembers = guild.members.cache.filter(member => {
      const username = member.user.username.toLowerCase();
      return username.includes(searchQuery) || username === searchQuery;
    });

    // If no matches in cache, try a targeted search with the query
    if (matchingMembers.size === 0) {
      try {
        // Use Discord's search with the query - this is more efficient than fetching all
        const fetched = await guild.members.fetch({ query: searchQuery, limit: 25 });
        matchingMembers = fetched.filter(member => {
          const username = member.user.username.toLowerCase();
          return username.includes(searchQuery) || username === searchQuery;
        });
      } catch (fetchError) {
        // If rate limited or error, just use cache results
        console.log('Member fetch failed, using cache only:', fetchError.message);
      }
    }

    if (matchingMembers.size === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ No Users Found')
        .setDescription(`No users found with username containing "**${searchQuery}**".\n\nMake sure you're using their Discord username, not their server nickname.\n\n*Tip: The user must have been recently active for the search to find them.*`);

      const backButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('stock_panel_back')
          .setLabel('Back to Panel')
          .setEmoji('🔙')
          .setStyle(ButtonStyle.Secondary)
      );

      return interaction.editReply({ embeds: [embed], components: [backButton] });
    }

    if (matchingMembers.size === 1) {
      // Single match - go directly to the view
      const targetUserId = matchingMembers.first().id;
      
      switch (searchType) {
        case 'price':
          return showPriceView(interaction, guildId, targetUserId, null, true);
        case 'buy':
          return showBuyAmountButtons(interaction, guildId, interaction.user.id, targetUserId, true);
        case 'portfolio':
          return showPortfolioView(interaction, guildId, targetUserId, true);
        case 'shareholders':
          return showShareholdersView(interaction, guildId, targetUserId, true);
      }
    }

    // Multiple matches - show selection
    const options = matchingMembers.first(25).map(member => ({
      label: member.user.username,
      description: member.displayName !== member.user.username ? `Server name: ${member.displayName.substring(0, 50)}` : undefined,
      value: member.id
    }));

    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('🔍 Multiple Users Found')
      .setDescription(`Found ${matchingMembers.size} users matching "**${searchQuery}**". Please select one:`);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`stock_search_result_${searchType}`)
      .setPlaceholder('Select a user...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stock_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({ embeds: [embed], components: [row, backButton] });
  } catch (error) {
    console.error('Error searching for user:', error);
    return interaction.editReply({ content: '❌ An error occurred while searching. Please try again.', embeds: [], components: [] });
  }
}
