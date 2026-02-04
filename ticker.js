const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { calculateStockPrice, getUser, getAllUsers, getPriceHistoryByTimeRange, getStreakInfo, getDb, saveDatabase, getActivityTierSettings } = require('./database');
const { getRecentSplitters } = require('./dividends');
const QuickChart = require('quickchart-js');

const CURRENCY = '<:babybel:1418824333664452608>';

// Store reference to Discord client and channel ID
let discordClient = null;
let tickerChannelId = process.env.TICKER_CHANNEL_ID || null;
let dashboardChannelId = process.env.DASHBOARD_CHANNEL_ID || null; // Separate channel for dashboard

// Store the dashboard message ID so we can edit it (per guild)
const dashboardMessages = new Map(); // guildId -> messageId

// Dashboard settings cache
let dashboardSettings = {
  enabled: true,
  updateIntervalMinutes: 3,
  deleteAndRepost: true, // If true, deletes old message and posts new one to stay at bottom
  showChart: true,
  topStocksCount: 10,
  topMoversCount: 5
};

// Track last known prices for comparison
const lastKnownPrices = new Map();

// Threshold for significant price movement (percentage)
const PRICE_CHANGE_THRESHOLD = 10; // 10% change triggers alert

// Dashboard update interval reference (so we can change it)
let dashboardIntervalId = null;

// Initialize dashboard settings table
function initDashboardSettings() {
  const db = getDb();
  if (!db) return;
  
  db.run(`
    CREATE TABLE IF NOT EXISTS dashboard_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 1,
      update_interval_minutes INTEGER DEFAULT 3,
      delete_and_repost INTEGER DEFAULT 1,
      show_chart INTEGER DEFAULT 1,
      top_stocks_count INTEGER DEFAULT 10,
      top_movers_count INTEGER DEFAULT 5,
      dashboard_channel_id TEXT
    )
  `);
  
  // Insert default if not exists
  db.run(`INSERT OR IGNORE INTO dashboard_settings (id) VALUES (1)`);
  
  // Load settings
  loadDashboardSettings();
}

function loadDashboardSettings() {
  const db = getDb();
  if (!db) return;
  
  const result = db.exec(`SELECT * FROM dashboard_settings WHERE id = 1`);
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    const cols = result[0].columns;
    const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
    
    dashboardSettings = {
      enabled: data.enabled === 1,
      updateIntervalMinutes: data.update_interval_minutes || 3,
      deleteAndRepost: data.delete_and_repost === 1,
      showChart: data.show_chart === 1,
      topStocksCount: data.top_stocks_count || 10,
      topMoversCount: data.top_movers_count || 5
    };
    
    // Override channel if set in database
    if (data.dashboard_channel_id) {
      dashboardChannelId = data.dashboard_channel_id;
    }
  }
}

function saveDashboardSettings() {
  const db = getDb();
  if (!db) return;
  
  db.run(`
    UPDATE dashboard_settings SET
      enabled = ?,
      update_interval_minutes = ?,
      delete_and_repost = ?,
      show_chart = ?,
      top_stocks_count = ?,
      top_movers_count = ?,
      dashboard_channel_id = ?
    WHERE id = 1
  `, [
    dashboardSettings.enabled ? 1 : 0,
    dashboardSettings.updateIntervalMinutes,
    dashboardSettings.deleteAndRepost ? 1 : 0,
    dashboardSettings.showChart ? 1 : 0,
    dashboardSettings.topStocksCount,
    dashboardSettings.topMoversCount,
    dashboardChannelId
  ]);
  
  saveDatabase();
}

function getDashboardSettings() {
  return { ...dashboardSettings, dashboardChannelId };
}

function updateDashboardSettings(newSettings) {
  if (newSettings.enabled !== undefined) dashboardSettings.enabled = newSettings.enabled;
  if (newSettings.updateIntervalMinutes !== undefined) dashboardSettings.updateIntervalMinutes = newSettings.updateIntervalMinutes;
  if (newSettings.deleteAndRepost !== undefined) dashboardSettings.deleteAndRepost = newSettings.deleteAndRepost;
  if (newSettings.showChart !== undefined) dashboardSettings.showChart = newSettings.showChart;
  if (newSettings.topStocksCount !== undefined) dashboardSettings.topStocksCount = newSettings.topStocksCount;
  if (newSettings.topMoversCount !== undefined) dashboardSettings.topMoversCount = newSettings.topMoversCount;
  if (newSettings.dashboardChannelId !== undefined) dashboardChannelId = newSettings.dashboardChannelId;
  
  saveDashboardSettings();
  
  // Restart the dashboard interval if interval changed
  if (newSettings.updateIntervalMinutes !== undefined) {
    restartDashboardInterval();
  }
}

function setDashboardChannel(channelId) {
  dashboardChannelId = channelId;
  saveDashboardSettings();
}

// Generate a sparkline chart URL for a single stock
async function generateSparkline(userId, username, priceChange) {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  let priceData = getPriceHistoryByTimeRange(userId, oneDayAgo);
  const currentPrice = calculateStockPrice(userId);
  
  // Add current price
  let allPrices = [...priceData, { price: currentPrice, timestamp: Date.now() }];
  
  if (allPrices.length < 2) {
    return null;
  }

  // Sample down to ~12 points for a clean sparkline
  const maxPoints = 12;
  if (allPrices.length > maxPoints) {
    const step = Math.ceil(allPrices.length / maxPoints);
    const sampled = [];
    for (let i = 0; i < allPrices.length - 1; i += step) {
      sampled.push(allPrices[i]);
    }
    sampled.push(allPrices[allPrices.length - 1]);
    allPrices = sampled;
  }

  const prices = allPrices.map(p => Math.round(p.price));
  const isPositive = priceChange >= 0;
  const lineColor = isPositive ? 'rgb(0,200,83)' : 'rgb(255,82,82)';

  const chart = new QuickChart();
  chart.setConfig({
    type: 'sparkline',
    data: {
      datasets: [{
        data: prices,
        borderColor: lineColor,
        borderWidth: 2,
        fill: false
      }]
    }
  });
  
  chart.setWidth(100);
  chart.setHeight(30);
  chart.setBackgroundColor('transparent');

  return chart.getUrl();
}

// Calculate what a user's stock price would have been at a specific point in time
// This recalculates based on message activity up to that timestamp
function calculateHistoricalPrice(userId, asOfTimestamp, guildId = null) {
  const db = getDb();
  const user = getUser(userId);
  if (!user) return 100.0;
  
  // Get activity tier settings
  const tierSettings = getActivityTierSettings(guildId);
  const windowDays = tierSettings.windowDays;
  const windowAgo = asOfTimestamp - (windowDays * 24 * 60 * 60 * 1000);
  
  let recentActivityMultiplier = 1.0;
  
  if (tierSettings.enabled) {
    // Get messages within the window AS OF the target timestamp
    const messagesResult = db.exec(
      'SELECT timestamp FROM transactions WHERE buyer_id = ? AND timestamp > ? AND timestamp <= ? AND transaction_type = "MESSAGE" ORDER BY timestamp ASC',
      [userId, windowAgo, asOfTimestamp]
    );
    
    if (messagesResult.length > 0 && messagesResult[0].values.length > 0) {
      // Group messages by day
      const dayBuckets = {};
      for (const row of messagesResult[0].values) {
        const timestamp = row[0];
        const date = new Date(timestamp);
        const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        dayBuckets[dayKey] = (dayBuckets[dayKey] || 0) + 1;
      }
      
      // Calculate contribution using tier system
      let totalContribution = 0;
      for (const dayKey in dayBuckets) {
        const dailyMessages = dayBuckets[dayKey];
        let remaining = dailyMessages;
        let dayContribution = 0;
        
        // Tier 1
        const t1Count = Math.min(remaining, tierSettings.tier1Threshold);
        dayContribution += t1Count * tierSettings.tier1Rate;
        remaining -= t1Count;
        
        // Tier 2
        if (remaining > 0) {
          const t2Count = Math.min(remaining, tierSettings.tier2Threshold - tierSettings.tier1Threshold);
          dayContribution += t2Count * tierSettings.tier2Rate;
          remaining -= t2Count;
        }
        
        // Tier 3
        if (remaining > 0) {
          const t3Count = Math.min(remaining, tierSettings.tier3Threshold - tierSettings.tier2Threshold);
          dayContribution += t3Count * tierSettings.tier3Rate;
          remaining -= t3Count;
        }
        
        // Tier 4 (unlimited)
        if (remaining > 0) {
          dayContribution += remaining * tierSettings.tier4Rate;
        }
        
        totalContribution += dayContribution;
      }
      
      recentActivityMultiplier = 1 + (totalContribution / 100);
    }
  } else {
    // Legacy flat rate system
    const recentMessagesResult = db.exec(
      'SELECT COUNT(*) as count FROM transactions WHERE buyer_id = ? AND timestamp > ? AND timestamp <= ? AND transaction_type = "MESSAGE"',
      [userId, windowAgo, asOfTimestamp]
    );
    
    let recentMessages = 0;
    if (recentMessagesResult.length > 0 && recentMessagesResult[0].values.length > 0) {
      recentMessages = recentMessagesResult[0].values[0][0] || 0;
    }
    
    recentActivityMultiplier = 1 + Math.min(recentMessages * 0.002, 0.60);
  }
  
  // Note: We skip streak bonus for historical calculations as it's complex to recalculate
  // The activity multiplier is the main driver of price changes
  
  let price = user.base_value * recentActivityMultiplier;
  
  return Math.max(100, price);
}

// Generate the full market dashboard chart
async function generateDashboardChart(topStocks, gainers, losers) {
  // Create a combined chart with multiple sections
  const chart = new QuickChart();
  
  // Get 24h data for top 5 stocks
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const datasets = [];
  const allLabels = [];
  
  // Generate 12 time points spanning from 24h ago to now
  const timePoints = [];
  for (let i = 0; i < 12; i++) {
    const timestamp = oneDayAgo + (i * (24 * 60 * 60 * 1000) / 11);
    timePoints.push(timestamp);
    const time = new Date(timestamp);
    allLabels.push(`${time.getHours()}:00`);
  }
  
  const colors = [
    'rgb(255, 99, 132)',   // red
    'rgb(54, 162, 235)',   // blue
    'rgb(255, 206, 86)',   // yellow
    'rgb(75, 192, 192)',   // teal
    'rgb(153, 102, 255)',  // purple
  ];
  
  for (let i = 0; i < Math.min(5, topStocks.length); i++) {
    const stock = topStocks[i];
    const currentPrice = stock.currentPrice;
    
    // Calculate prices at each time point based on message activity at that time
    // This gives a more accurate picture of price progression
    const sampled = [];
    for (let j = 0; j < 12; j++) {
      const targetTime = timePoints[j];
      
      // Calculate what the price would have been at this point in time
      // by simulating the price calculation with messages only up to that time
      const historicalPrice = calculateHistoricalPrice(stock.userId, targetTime);
      sampled.push(Math.round(historicalPrice || currentPrice));
    }
    
    // Last point is always current price
    sampled[11] = Math.round(currentPrice);
    
    const shortName = stock.username.length > 10 ? stock.username.substring(0, 8) + '..' : stock.username;
    
    datasets.push({
      label: shortName,
      data: sampled,
      borderColor: colors[i],
      backgroundColor: colors[i].replace('rgb', 'rgba').replace(')', ', 0.1)'),
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2
    });
  }

  // Calculate the max value across all datasets for proper y-axis scaling
  let maxPrice = 0;
  for (const dataset of datasets) {
    const datasetMax = Math.max(...dataset.data);
    if (datasetMax > maxPrice) maxPrice = datasetMax;
  }
  // Add 10% padding to the top
  const yAxisMax = Math.ceil(maxPrice * 1.1);

  chart.setConfig({
    type: 'line',
    data: {
      labels: allLabels,
      datasets: datasets
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: 'TOP 5 STOCKS - 24H PERFORMANCE',
          color: '#fff',
          font: { size: 16, weight: 'bold' }
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#fff', boxWidth: 12, padding: 8 }
        }
      },
      scales: {
        x: {
          ticks: { color: '#aaa', maxTicksLimit: 6 },
          grid: { color: '#333' }
        },
        y: {
          min: 0,
          max: yAxisMax,
          ticks: { color: '#aaa' },
          grid: { color: '#333' }
        }
      }
    }
  });
  
  chart.setWidth(600);
  chart.setHeight(300);
  chart.setBackgroundColor('#2f3136');

  // Use short URL to avoid Discord's 2048 char limit
  try {
    return await chart.getShortUrl();
  } catch (e) {
    console.error('Error getting short chart URL:', e);
    return null;
  }
}

// Build the market dashboard
async function buildMarketDashboard(guildId = null) {
  const users = getAllUsers();
  if (!users || users.length === 0) return null;

  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const stockData = [];

  // Get users who split in the last 24 hours (exclude from losers since splits aren't negative)
  const recentSplitters = getRecentSplitters(oneDayAgo);

  for (const user of users) {
    const currentPrice = calculateStockPrice(user.user_id, guildId);
    const dayHistory = getPriceHistoryByTimeRange(user.user_id, oneDayAgo);
    
    let dayAgoPrice = currentPrice;
    if (dayHistory.length > 0) {
      dayAgoPrice = dayHistory[0].price;
    }
    
    const changePercent = dayAgoPrice > 0 ? ((currentPrice - dayAgoPrice) / dayAgoPrice) * 100 : 0;
    
    stockData.push({
      userId: user.user_id,
      username: user.username,
      currentPrice: currentPrice,
      dayAgoPrice: dayAgoPrice,
      changePercent: changePercent,
      recentlySplit: recentSplitters.has(user.user_id)
    });
  }

  // Sort for different categories
  const topByPrice = [...stockData].sort((a, b) => b.currentPrice - a.currentPrice).slice(0, dashboardSettings.topStocksCount);
  const gainers = [...stockData].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, dashboardSettings.topMoversCount);
  // Exclude recent splitters from losers - splits cause price drops but aren't negative events
  const losers = [...stockData].filter(s => s.changePercent < 0 && !s.recentlySplit).sort((a, b) => a.changePercent - b.changePercent).slice(0, dashboardSettings.topMoversCount);

  // Market summary
  const totalMarketCap = stockData.reduce((sum, s) => sum + s.currentPrice, 0);
  const avgChange = stockData.length > 0 ? stockData.reduce((sum, s) => sum + s.changePercent, 0) / stockData.length : 0;
  const marketTrend = avgChange > 1 ? '📈 Bullish' : avgChange < -1 ? '📉 Bearish' : '➡️ Stable';

  // Generate the chart (if enabled)
  let chartUrl = null;
  if (dashboardSettings.showChart) {
    chartUrl = await generateDashboardChart(topByPrice, gainers, losers);
  }

  // Build embed
  const embed = new EmbedBuilder()
    .setColor(avgChange >= 0 ? 0x00c853 : 0xff5252)
    .setTitle('📊 CHAT-STOCK MARKET DASHBOARD')
    .setDescription(`**Live Market Data** • Updates every ${dashboardSettings.updateIntervalMinutes} minute${dashboardSettings.updateIntervalMinutes !== 1 ? 's' : ''}`)
    .setTimestamp()
    .setFooter({ text: 'Chat-Stock Market Dashboard' });

  if (chartUrl) {
    embed.setImage(chartUrl);
  }

  // Top stocks by price
  const topStocksText = topByPrice.map((s, i) => {
    const medal = i === 0 ? '👑' : i === 1 ? '💎' : i === 2 ? '⭐' : `${i + 1}.`;
    const changeStr = s.changePercent >= 0 ? `+${s.changePercent.toFixed(1)}%` : `${s.changePercent.toFixed(1)}%`;
    // Show split indicator instead of red dot for users who recently split
    const changeEmoji = s.recentlySplit ? '🔀' : (s.changePercent >= 0 ? '🟢' : '🔴');
    return `${medal} **${s.username}** • ${Math.round(s.currentPrice).toLocaleString()} ${CURRENCY} ${changeEmoji} ${changeStr}`;
  }).join('\n');

  embed.addFields({ name: `💰 Top ${dashboardSettings.topStocksCount} Stocks`, value: topStocksText || 'No data', inline: false });

  // Gainers & Losers side by side
  const gainersText = gainers.length > 0 
    ? gainers.map((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📈';
        return `${medal} **${s.username}**\n+${s.changePercent.toFixed(1)}% • ${Math.round(s.currentPrice).toLocaleString()}`;
      }).join('\n\n')
    : 'No gainers';

  const losersText = losers.length > 0
    ? losers.map((s, i) => {
        return `📉 **${s.username}**\n${s.changePercent.toFixed(1)}% • ${Math.round(s.currentPrice).toLocaleString()}`;
      }).join('\n\n')
    : 'No losers';

  embed.addFields(
    { name: '🚀 Top Gainers (24h)', value: gainersText, inline: true },
    { name: '💔 Top Losers (24h)', value: losersText, inline: true }
  );

  // Market summary
  embed.addFields({
    name: '📈 Market Summary',
    value: `**Trend:** ${marketTrend}\n**Avg Change:** ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%\n**Total Stocks:** ${stockData.length}\n**Total Market Cap:** ${Math.round(totalMarketCap).toLocaleString()} ${CURRENCY}`,
    inline: false
  });

  return embed;
}

// Clean up old dashboard messages from the bot in this channel
async function cleanupOldDashboardMessages(channel) {
  try {
    // Fetch last 50 messages from the channel
    const messages = await channel.messages.fetch({ limit: 50 });
    
    // Find all messages from the bot that look like dashboard messages
    const botMessages = messages.filter(msg => 
      msg.author.id === discordClient.user.id && 
      msg.embeds.length > 0 &&
      (msg.embeds[0].title?.includes('MARKET DASHBOARD') || 
       msg.embeds[0].title?.includes('Live Market Dashboard'))
    );
    
    // Delete all old dashboard messages
    for (const [id, msg] of botMessages) {
      try {
        await msg.delete();
        console.log('🧹 Deleted old dashboard message');
      } catch (e) {
        // Already deleted
      }
    }
  } catch (e) {
    console.error('Error cleaning up old dashboard messages:', e.message);
  }
}

// Update or create the dashboard message
async function updateDashboard() {
  if (!discordClient || !dashboardSettings.enabled) return;
  
  // Use dashboard channel if set, otherwise fall back to ticker channel
  const channelId = dashboardChannelId || tickerChannelId;
  if (!channelId) return;

  try {
    const channel = await discordClient.channels.fetch(channelId);
    if (!channel) return;

    const guildId = channel.guild?.id || 'global';
    const embed = await buildMarketDashboard(guildId);
    if (!embed) return;

    const existingMsgId = dashboardMessages.get(guildId);

    // Delete-and-repost mode: always delete old and post new to stay at bottom
    if (dashboardSettings.deleteAndRepost) {
      // Try to delete old message by ID if we have it
      if (existingMsgId) {
        try {
          const oldMsg = await channel.messages.fetch(existingMsgId);
          await oldMsg.delete();
        } catch (e) {
          // Message already deleted, that's fine
        }
      }
      
      // Also clean up any orphaned dashboard messages (from restarts)
      await cleanupOldDashboardMessages(channel);
      
      // Post new message
      const msg = await channel.send({ embeds: [embed] });
      dashboardMessages.set(guildId, msg.id);
      console.log('📊 Dashboard updated (reposted)');
      return;
    }

    // Edit mode: try to edit existing, create if not found
    if (existingMsgId) {
      try {
        const existingMsg = await channel.messages.fetch(existingMsgId);
        await existingMsg.edit({ embeds: [embed] });
        console.log('📊 Dashboard updated (edited)');
        return;
      } catch (e) {
        // Message was deleted, create new one
        dashboardMessages.delete(guildId);
      }
    }

    // Creating a new dashboard - clean up any old bot dashboard messages first
    await cleanupOldDashboardMessages(channel);

    // Create new dashboard message
    const msg = await channel.send({ embeds: [embed] });
    dashboardMessages.set(guildId, msg.id);
    console.log('📊 Dashboard created');

  } catch (error) {
    // Silently ignore connection timeouts - these are transient Discord API issues
    if (error.code === 'UND_ERR_CONNECT_TIMEOUT' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      // Discord is temporarily unreachable, will retry on next interval
      return;
    }
    console.error('Error updating dashboard:', error);
  }
}

// Start or restart the dashboard update loop
function restartDashboardInterval() {
  // Clear existing interval
  if (dashboardIntervalId) {
    clearInterval(dashboardIntervalId);
    dashboardIntervalId = null;
  }
  
  if (!dashboardSettings.enabled) {
    console.log('📊 Dashboard disabled');
    return;
  }
  
  const intervalMs = dashboardSettings.updateIntervalMinutes * 60 * 1000;
  
  // Start new interval
  dashboardIntervalId = setInterval(updateDashboard, intervalMs);
  
  console.log(`📊 Dashboard interval set to ${dashboardSettings.updateIntervalMinutes} minutes`);
}

// Start the dashboard update loop
function startDashboard() {
  const channelId = dashboardChannelId || tickerChannelId;
  if (!channelId || !dashboardSettings.enabled) return;
  
  // Initial update after 5s
  setTimeout(updateDashboard, 5000);
  
  // Start the interval
  restartDashboardInterval();
  
  console.log(`📊 Market dashboard started (updates every ${dashboardSettings.updateIntervalMinutes} minutes)`);
}

function initTicker(client) {
  discordClient = client;
  
  // Initialize dashboard settings from database
  initDashboardSettings();
  
  if (!tickerChannelId && !dashboardChannelId) {
    console.log('⚠️ TICKER_CHANNEL_ID not set in .env - Stock ticker disabled');
    return;
  }
  
  console.log('📈 Stock ticker initialized');
  
  // Start the live market dashboard
  startDashboard();
  
  // Check for price movements every 5 minutes
  setInterval(checkPriceMovements, 5 * 60 * 1000);
  
  // Schedule weekly earnings report (every Sunday at 12:00 PM)
  scheduleWeeklyReport();
}

function setTickerChannel(channelId) {
  tickerChannelId = channelId;
}

async function checkPriceMovements() {
  if (!discordClient || !tickerChannelId) return;
  
  const users = getAllUsers();
  if (!users || users.length === 0) return;
  
  const alerts = [];
  
  for (const user of users) {
    const currentPrice = calculateStockPrice(user.user_id);
    const lastPrice = lastKnownPrices.get(user.user_id);
    
    if (lastPrice) {
      const changePercent = ((currentPrice - lastPrice) / lastPrice) * 100;
      
      if (Math.abs(changePercent) >= PRICE_CHANGE_THRESHOLD) {
        alerts.push({
          userId: user.user_id,
          username: user.username,
          oldPrice: lastPrice,
          newPrice: currentPrice,
          changePercent: changePercent
        });
      }
    }
    
    // Update last known price
    lastKnownPrices.set(user.user_id, currentPrice);
  }
  
  // Send alerts
  for (const alert of alerts) {
    await sendPriceAlert(alert);
  }
}

async function sendPriceAlert(alert) {
  if (!discordClient || !tickerChannelId) return;
  
  try {
    const channel = await discordClient.channels.fetch(tickerChannelId);
    if (!channel) return;
    
    const isPositive = alert.changePercent > 0;
    const emoji = isPositive ? '🚀' : '📉';
    const direction = isPositive ? 'UP' : 'DOWN';
    const color = isPositive ? 0x00ff00 : 0xff0000;
    
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${emoji} STOCK ALERT: ${alert.username}`)
      .setDescription(`**${alert.username}**'s stock is ${direction} **${Math.abs(alert.changePercent).toFixed(1)}%**!`)
      .addFields(
        { name: 'Previous Price', value: `${Math.round(alert.oldPrice)} ${CURRENCY}`, inline: true },
        { name: 'Current Price', value: `${Math.round(alert.newPrice)} ${CURRENCY}`, inline: true },
        { name: 'Change', value: `${isPositive ? '+' : ''}${alert.changePercent.toFixed(2)}%`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Chat-Stock Ticker' });
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error sending price alert:', error);
  }
}

function scheduleWeeklyReport() {
  const now = new Date();
  const nextSunday = new Date(now);
  
  // Find next Sunday at 12:00 PM
  nextSunday.setDate(now.getDate() + (7 - now.getDay()) % 7);
  nextSunday.setHours(12, 0, 0, 0);
  
  // If it's already past Sunday noon, schedule for next week
  if (nextSunday <= now) {
    nextSunday.setDate(nextSunday.getDate() + 7);
  }
  
  const msUntilReport = nextSunday - now;
  
  console.log(`📊 Next earnings report scheduled for ${nextSunday.toLocaleString()}`);
  
  setTimeout(() => {
    sendEarningsReport();
    // Then schedule weekly
    setInterval(sendEarningsReport, 7 * 24 * 60 * 60 * 1000);
  }, msUntilReport);
}

async function sendEarningsReport() {
  if (!discordClient || !tickerChannelId) return;
  
  try {
    const channel = await discordClient.channels.fetch(tickerChannelId);
    if (!channel) return;
    
    const users = getAllUsers();
    if (!users || users.length === 0) return;
    
    // Calculate weekly changes
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const stockChanges = [];
    
    for (const user of users) {
      const currentPrice = calculateStockPrice(user.user_id);
      const weekHistory = getPriceHistoryByTimeRange(user.user_id, oneWeekAgo);
      
      let weekAgoPrice = currentPrice; // Default if no history
      if (weekHistory.length > 0) {
        weekAgoPrice = weekHistory[0].price;
      }
      
      const changePercent = ((currentPrice - weekAgoPrice) / weekAgoPrice) * 100;
      
      stockChanges.push({
        userId: user.user_id,
        username: user.username,
        currentPrice: currentPrice,
        weekAgoPrice: weekAgoPrice,
        changePercent: changePercent
      });
    }
    
    // Sort by change percent
    stockChanges.sort((a, b) => b.changePercent - a.changePercent);
    
    // Top 5 gainers
    const gainers = stockChanges.filter(s => s.changePercent > 0).slice(0, 5);
    // Top 5 losers
    const losers = stockChanges.filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
    
    // Most valuable stocks
    const mostValuable = [...stockChanges].sort((a, b) => b.currentPrice - a.currentPrice).slice(0, 5);
    
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('📊 Weekly Earnings Report')
      .setDescription(`**Week of ${new Date(oneWeekAgo).toLocaleDateString()} - ${new Date().toLocaleDateString()}**\n\nHere's how the market performed this week!`)
      .setTimestamp()
      .setFooter({ text: 'Chat-Stock Weekly Report' });
    
    // Top Gainers
    if (gainers.length > 0) {
      const gainersText = gainers.map((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📈';
        return `${medal} **${s.username}** +${s.changePercent.toFixed(1)}% (${Math.round(s.currentPrice)} ${CURRENCY})`;
      }).join('\n');
      embed.addFields({ name: '🚀 Top Gainers', value: gainersText, inline: false });
    } else {
      embed.addFields({ name: '🚀 Top Gainers', value: 'No gainers this week 😢', inline: false });
    }
    
    // Top Losers
    if (losers.length > 0) {
      const losersText = losers.map((s, i) => {
        return `📉 **${s.username}** ${s.changePercent.toFixed(1)}% (${Math.round(s.currentPrice)} ${CURRENCY})`;
      }).join('\n');
      embed.addFields({ name: '💔 Biggest Losers', value: losersText, inline: false });
    } else {
      embed.addFields({ name: '💔 Biggest Losers', value: 'No losers this week! 🎉', inline: false });
    }
    
    // Most Valuable
    if (mostValuable.length > 0) {
      const valuableText = mostValuable.map((s, i) => {
        const medal = i === 0 ? '👑' : i === 1 ? '💎' : i === 2 ? '⭐' : '💰';
        return `${medal} **${s.username}** - ${Math.round(s.currentPrice)} ${CURRENCY}`;
      }).join('\n');
      embed.addFields({ name: '💰 Most Valuable Stocks', value: valuableText, inline: false });
    }
    
    // Market summary
    const totalChange = stockChanges.reduce((sum, s) => sum + s.changePercent, 0) / stockChanges.length;
    const marketTrend = totalChange > 0 ? '📈 Bullish' : totalChange < 0 ? '📉 Bearish' : '➡️ Stable';
    
    embed.addFields({ 
      name: '📈 Market Summary', 
      value: `**Overall Trend:** ${marketTrend}\n**Average Change:** ${totalChange >= 0 ? '+' : ''}${totalChange.toFixed(2)}%\n**Total Stocks:** ${stockChanges.length}`, 
      inline: false 
    });
    
    await channel.send({ embeds: [embed] });
    console.log('📊 Weekly earnings report sent!');
  } catch (error) {
    console.error('Error sending earnings report:', error);
  }
}

// Manual trigger for testing
async function triggerEarningsReport() {
  await sendEarningsReport();
}

// Get current ticker channel ID
function getTickerChannel() {
  return tickerChannelId;
}

// Send stock split announcement (this replaces the price drop alert since split causes the drop)
async function sendSplitAnnouncement(userId, username, ratio, oldPrice, newPrice, shareholderCount) {
  if (!discordClient || !tickerChannelId) return;
  
  try {
    const channel = await discordClient.channels.fetch(tickerChannelId);
    if (!channel) return;
    
    const isReverse = ratio.startsWith('1:');
    const emoji = isReverse ? '🔄' : '📊';
    const color = isReverse ? 0xf39c12 : 0x3498db;
    const splitType = isReverse ? 'REVERSE SPLIT' : 'STOCK SPLIT';
    
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${emoji} ${splitType}: ${username}`)
      .setDescription(`**${username}** has executed a **${ratio}** ${isReverse ? 'reverse ' : ''}stock split!`)
      .addFields(
        { name: 'Previous Price', value: `${Math.round(oldPrice).toLocaleString()} ${CURRENCY}`, inline: true },
        { name: 'New Price', value: `${Math.round(newPrice).toLocaleString()} ${CURRENCY}`, inline: true },
        { name: 'Split Ratio', value: ratio, inline: true },
        { name: 'Shareholders Affected', value: `${shareholderCount}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Chat-Stock Ticker • Shareholder positions adjusted automatically' });
    
    await channel.send({ embeds: [embed] });
    
    // Update last known price to prevent a second alert from the price change
    lastKnownPrices.set(userId, newPrice);
    
  } catch (error) {
    console.error('Error sending split announcement:', error);
  }
}

// Send streak milestone announcement
async function sendStreakAnnouncement(userId, username, streakDays, tier) {
  if (!discordClient || !tickerChannelId) return;
  
  try {
    const channel = await discordClient.channels.fetch(tickerChannelId);
    if (!channel) return;
    
    const tierInfo = {
      1: { emoji: '🔥', name: 'Bronze Streak', bonus: '+2%', color: 0xcd7f32 },
      2: { emoji: '🔥🔥', name: 'Silver Streak', bonus: '+4%', color: 0xc0c0c0 },
      3: { emoji: '🔥🔥🔥', name: 'Gold Streak', bonus: '+7%', color: 0xffd700 }
    };
    
    const info = tierInfo[tier];
    if (!info) return;
    
    const currentPrice = calculateStockPrice(userId);
    
    const embed = new EmbedBuilder()
      .setColor(info.color)
      .setTitle(`${info.emoji} ${info.name} Achieved!`)
      .setDescription(`**${username}** has been active for **${streakDays} consecutive days**!`)
      .addFields(
        { name: '📅 Streak', value: `${streakDays} days`, inline: true },
        { name: '📈 Stock Bonus', value: info.bonus, inline: true },
        { name: '💰 Current Price', value: `${Math.round(currentPrice).toLocaleString()} ${CURRENCY}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: tier === 3 ? 'Chat-Stock Ticker • Gold streak expires after 7 days' : 'Chat-Stock Ticker • Keep the streak going!' });
    
    await channel.send({ embeds: [embed] });
    
  } catch (error) {
    console.error('Error sending streak announcement:', error);
  }
}

// Send streak expiration announcement
async function sendStreakExpiredAnnouncement(userId, username) {
  if (!discordClient || !tickerChannelId) return;
  
  try {
    const channel = await discordClient.channels.fetch(tickerChannelId);
    if (!channel) return;
    
    const currentPrice = calculateStockPrice(userId);
    
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle(`⏰ Gold Streak Expired`)
      .setDescription(`**${username}**'s Gold Streak bonus has expired after 7 days.`)
      .addFields(
        { name: '💰 Current Price', value: `${Math.round(currentPrice).toLocaleString()} ${CURRENCY}`, inline: true },
        { name: '📈 Bonus Lost', value: '-7%', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Chat-Stock Ticker • Start a new streak to earn bonuses again!' });
    
    await channel.send({ embeds: [embed] });
    
  } catch (error) {
    console.error('Error sending streak expired announcement:', error);
  }
}

module.exports = {
  initTicker,
  setTickerChannel,
  getTickerChannel,
  setDashboardChannel,
  getDashboardSettings,
  updateDashboardSettings,
  checkPriceMovements,
  sendEarningsReport,
  triggerEarningsReport,
  sendSplitAnnouncement,
  sendStreakAnnouncement,
  sendStreakExpiredAnnouncement,
  updateDashboard,
  buildMarketDashboard
};
