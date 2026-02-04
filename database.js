const initSqlJs = require('sql.js');
const fs = require('fs');

let db;
const dbPath = './chatstock.db';

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      total_messages INTEGER DEFAULT 0,
      base_value REAL DEFAULT 100.0,
      last_message_time INTEGER,
      price_modifier REAL DEFAULT 1.0
    );
  `);

  // Migration: Add price_modifier column if it doesn't exist
  try {
    db.run(`ALTER TABLE users ADD COLUMN price_modifier REAL DEFAULT 1.0`);
  } catch (e) {
    // Column already exists
  }

  // Migration: Add streak tracking columns
  try {
    db.run(`ALTER TABLE users ADD COLUMN streak_tier INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE users ADD COLUMN streak_tier_reached INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS stocks (
      owner_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      shares INTEGER NOT NULL,
      avg_buy_price REAL NOT NULL,
      PRIMARY KEY (owner_id, stock_user_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      shares INTEGER NOT NULL,
      price REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      user_id TEXT NOT NULL,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);

  // Economy tables (replacing UBB)
  db.run(`
    CREATE TABLE IF NOT EXISTS balances (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      cash INTEGER DEFAULT 0,
      bank INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS economy_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_type TEXT NOT NULL,
      reason TEXT,
      timestamp INTEGER NOT NULL
    );
  `);

  // Create indexes for frequently queried columns
  db.run(`CREATE INDEX IF NOT EXISTS idx_balances_guild_user ON balances(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_stocks_owner ON stocks(owner_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_stocks_stock_user ON stocks(stock_user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_buyer ON transactions(buyer_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_user ON price_history(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_economy_transactions_guild_user ON economy_transactions(guild_id, user_id)`);

  // Activity tier settings for diminishing returns
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_tier_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      tier1_threshold INTEGER DEFAULT 20,
      tier1_rate REAL DEFAULT 0.15,
      tier2_threshold INTEGER DEFAULT 50,
      tier2_rate REAL DEFAULT 0.05,
      tier3_threshold INTEGER DEFAULT 100,
      tier3_rate REAL DEFAULT 0.02,
      tier4_rate REAL DEFAULT 0.005,
      window_days INTEGER DEFAULT 15
    )
  `);

  console.log('✅ Database initialized');
}

// Save database to file
function saveDatabase() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(dbPath, data);
  }
}

// Save every 30 seconds
setInterval(saveDatabase, 30000);

// Save on exit
process.on('exit', saveDatabase);
process.on('SIGINT', () => {
  saveDatabase();
  process.exit();
});

// User functions
function getUser(userId) {
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

// Get all users
function getAllUsers() {
  const result = db.exec('SELECT * FROM users');
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function createUser(userId, username) {
  if (!db) return; // Database not ready yet
  try {
    // First try to insert the user
    db.run('INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)', [userId, username]);
    
    // If user exists with "Unknown User" or just their ID as username, update it
    if (username && username !== 'Unknown User' && username !== userId) {
      db.run('UPDATE users SET username = ? WHERE user_id = ? AND (username = "Unknown User" OR username = user_id)', [username, userId]);
    }
    
    saveDatabase();
  } catch (error) {
    console.error('Error creating user:', error);
  }
}

function updateMessageCount(timestamp, userId) {
  if (!db) return; // Database not ready yet
  // Increment message count and update last message time
  db.run('UPDATE users SET total_messages = total_messages + 1, last_message_time = ? WHERE user_id = ?', [timestamp, userId]);
  // Also log as a transaction for 15-day window tracking
  db.run('INSERT INTO transactions (buyer_id, stock_user_id, shares, price, transaction_type, timestamp) VALUES (?, ?, 0, 0, "MESSAGE", ?)',
    [userId, userId, timestamp]);
  saveDatabase();
}

// Stock functions
function getPortfolio(ownerId) {
  const result = db.exec('SELECT * FROM stocks WHERE owner_id = ?', [ownerId]);
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getStock(ownerId, stockUserId) {
  const result = db.exec('SELECT * FROM stocks WHERE owner_id = ? AND stock_user_id = ?', [ownerId, stockUserId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

function buyStock(ownerId, stockUserId, shares, price) {
  const existing = getStock(ownerId, stockUserId);
  
  if (existing) {
    const newShares = existing.shares + shares;
    const newAvgPrice = ((existing.shares * existing.avg_buy_price) + (shares * price)) / newShares;
    db.run('UPDATE stocks SET shares = ?, avg_buy_price = ? WHERE owner_id = ? AND stock_user_id = ?', 
      [newShares, newAvgPrice, ownerId, stockUserId]);
  } else {
    db.run('INSERT INTO stocks (owner_id, stock_user_id, shares, avg_buy_price) VALUES (?, ?, ?, ?)',
      [ownerId, stockUserId, shares, price]);
  }
  saveDatabase();
}

function sellStock(shares, ownerId, stockUserId) {
  db.run('UPDATE stocks SET shares = shares - ? WHERE owner_id = ? AND stock_user_id = ?', 
    [shares, ownerId, stockUserId]);
  saveDatabase();
}

function deleteStock(ownerId, stockUserId) {
  db.run('DELETE FROM stocks WHERE owner_id = ? AND stock_user_id = ? AND shares <= 0', 
    [ownerId, stockUserId]);
  saveDatabase();
}

// Transaction logging
function logTransaction(buyerId, stockUserId, shares, price, type, timestamp) {
  db.run('INSERT INTO transactions (buyer_id, stock_user_id, shares, price, transaction_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    [buyerId, stockUserId, shares, price, type, timestamp]);
  saveDatabase();
}

// Price history
function logPrice(userId, price, timestamp) {
  db.run('INSERT INTO price_history (user_id, price, timestamp) VALUES (?, ?, ?)', 
    [userId, price, timestamp]);
  saveDatabase();
}

function getPriceHistory(userId) {
  const result = db.exec('SELECT * FROM price_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20', [userId]);
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get price history within a time range for charting
function getPriceHistoryByTimeRange(userId, startTime) {
  const result = db.exec(
    'SELECT * FROM price_history WHERE user_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
    [userId, startTime]
  );
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Calculate activity streak and bonus (with 7-day expiration at max tier)
function getStreakInfo(userId) {
  const user = getUser(userId);
  if (!user) return { days: 0, tier: 0, bonus: 0, newTier: false };
  
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * oneDayMs;
  const now = Date.now();
  const sixtyDaysAgo = now - (60 * oneDayMs);
  
  // Get all message timestamps from last 60 days in a single query
  const messagesResult = db.exec(
    'SELECT timestamp FROM transactions WHERE buyer_id = ? AND timestamp > ? AND transaction_type = "MESSAGE" ORDER BY timestamp DESC',
    [userId, sixtyDaysAgo]
  );
  
  // Build a set of days (as day numbers from epoch) that have activity
  const activeDays = new Set();
  if (messagesResult.length > 0 && messagesResult[0].values.length > 0) {
    for (const row of messagesResult[0].values) {
      const dayNum = Math.floor(row[0] / oneDayMs);
      activeDays.add(dayNum);
    }
  }
  
  // Count consecutive days going backwards from today
  let streakDays = 0;
  const todayNum = Math.floor(now / oneDayMs);
  
  for (let daysAgo = 0; daysAgo < 60; daysAgo++) {
    const dayNum = todayNum - daysAgo;
    if (activeDays.has(dayNum)) {
      streakDays++;
    } else if (daysAgo > 0) {
      // Allow today to be empty (they might not have posted yet today)
      break;
    }
  }
  
  // Determine current tier (0=none, 1=7day, 2=14day, 3=30day)
  let currentTier = 0;
  let bonus = 0;
  if (streakDays >= 30) {
    currentTier = 3;
    bonus = 0.07; // +7%
  } else if (streakDays >= 14) {
    currentTier = 2;
    bonus = 0.04; // +4%
  } else if (streakDays >= 7) {
    currentTier = 1;
    bonus = 0.02; // +2%
  }
  
  // Check for max tier expiration (7 days at tier 3)
  const storedTier = user.streak_tier || 0;
  const tierReachedTime = user.streak_tier_reached || 0;
  
  if (currentTier === 3 && storedTier === 3 && tierReachedTime > 0) {
    // Check if 7 days have passed since reaching max tier
    if (now - tierReachedTime >= sevenDaysMs) {
      // Reset streak bonus - they've had it for 7 days
      bonus = 0;
      currentTier = 0;
      // Reset the stored tier
      db.run('UPDATE users SET streak_tier = 0, streak_tier_reached = 0 WHERE user_id = ?', [userId]);
      saveDatabase();
      return { days: streakDays, tier: 0, bonus: 0, expired: true, newTier: false };
    }
  }
  
  // Check if this is a new tier achievement
  let newTier = false;
  if (currentTier > storedTier) {
    newTier = true;
    const reachedTime = currentTier === 3 ? now : 0; // Only track time for max tier
    db.run('UPDATE users SET streak_tier = ?, streak_tier_reached = ? WHERE user_id = ?', 
      [currentTier, reachedTime, userId]);
    saveDatabase();
  } else if (currentTier < storedTier) {
    // User lost their streak, update stored tier
    db.run('UPDATE users SET streak_tier = ?, streak_tier_reached = 0 WHERE user_id = ?', 
      [currentTier, userId]);
    saveDatabase();
  }
  
  return { days: streakDays, tier: currentTier, bonus, newTier };
}

// Get activity tier settings for a guild
function getActivityTierSettings(guildId) {
  const defaults = {
    enabled: true,
    tier1Threshold: 20,   // First 20 messages
    tier1Rate: 0.5,       // 0.5% each = 10% max
    tier2Threshold: 50,   // Messages 21-50
    tier2Rate: 0.25,      // 0.25% each = 7.5% max
    tier3Threshold: 100,  // Messages 51-100
    tier3Rate: 0.15,      // 0.15% each = 7.5% max
    tier4Rate: 0.05,      // Messages 101+ = 0.05% each (no cap!)
    windowDays: 15
  };
  
  if (!guildId) return defaults;
  
  const result = db.exec('SELECT * FROM activity_tier_settings WHERE guild_id = ?', [guildId]);
  if (result.length === 0 || result[0].values.length === 0) return defaults;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  
  return {
    enabled: row.enabled === 1,
    tier1Threshold: row.tier1_threshold,
    tier1Rate: row.tier1_rate,
    tier2Threshold: row.tier2_threshold,
    tier2Rate: row.tier2_rate,
    tier3Threshold: row.tier3_threshold,
    tier3Rate: row.tier3_rate,
    tier4Rate: row.tier4_rate,
    windowDays: row.window_days
  };
}

// Update activity tier settings
function updateActivityTierSettings(guildId, settings) {
  db.run(`
    INSERT OR REPLACE INTO activity_tier_settings 
    (guild_id, enabled, tier1_threshold, tier1_rate, tier2_threshold, tier2_rate, tier3_threshold, tier3_rate, tier4_rate, window_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.tier1Threshold,
    settings.tier1Rate,
    settings.tier2Threshold,
    settings.tier2Rate,
    settings.tier3Threshold,
    settings.tier3Rate,
    settings.tier4Rate,
    settings.windowDays
  ]);
  saveDatabase();
}

// Calculate daily contribution with diminishing returns
function calculateDailyContribution(messageCount, settings) {
  let contribution = 0;
  let remaining = messageCount;
  
  // Tier 1: First N messages at highest rate
  const tier1Count = Math.min(remaining, settings.tier1Threshold);
  contribution += tier1Count * settings.tier1Rate;
  remaining -= tier1Count;
  
  // Tier 2: Next batch at medium rate
  if (remaining > 0) {
    const tier2Count = Math.min(remaining, settings.tier2Threshold - settings.tier1Threshold);
    contribution += tier2Count * settings.tier2Rate;
    remaining -= tier2Count;
  }
  
  // Tier 3: Next batch at lower rate
  if (remaining > 0) {
    const tier3Count = Math.min(remaining, settings.tier3Threshold - settings.tier2Threshold);
    contribution += tier3Count * settings.tier3Rate;
    remaining -= tier3Count;
  }
  
  // Tier 4: Everything beyond at lowest rate
  if (remaining > 0) {
    contribution += remaining * settings.tier4Rate;
  }
  
  return contribution;
}

// Calculate stock price (guildId optional - for price impact delay and market events)
function calculateStockPrice(userId, guildId = null) {
  const user = getUser(userId);
  if (!user) return 100.0;

  // Get activity tier settings
  const tierSettings = getActivityTierSettings(guildId);
  const windowDays = tierSettings.windowDays;
  const windowAgo = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
  
  let recentActivityMultiplier = 1.0;
  
  if (tierSettings.enabled) {
    // Get messages grouped by day within the window
    const messagesResult = db.exec(
      'SELECT timestamp FROM transactions WHERE buyer_id = ? AND timestamp > ? AND transaction_type = "MESSAGE" ORDER BY timestamp ASC',
      [userId, windowAgo]
    );
    
    if (messagesResult.length > 0 && messagesResult[0].values.length > 0) {
      // Group messages by day (using local date)
      const dayBuckets = {};
      for (const row of messagesResult[0].values) {
        const timestamp = row[0];
        const date = new Date(timestamp);
        const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        dayBuckets[dayKey] = (dayBuckets[dayKey] || 0) + 1;
      }
      
      // Calculate total contribution from all days with diminishing returns per day
      let totalContribution = 0;
      for (const dayKey in dayBuckets) {
        const dailyMessages = dayBuckets[dayKey];
        totalContribution += calculateDailyContribution(dailyMessages, tierSettings);
      }
      
      // Convert percentage to multiplier (e.g., 45% -> 1.45)
      recentActivityMultiplier = 1 + (totalContribution / 100);
    }
  } else {
    // Legacy flat rate system (disabled diminishing returns)
    const recentMessagesResult = db.exec(
      'SELECT COUNT(*) as count FROM transactions WHERE buyer_id = ? AND timestamp > ? AND transaction_type = "MESSAGE"',
      [userId, windowAgo]
    );
    
    let recentMessages = user.total_messages;
    if (recentMessagesResult.length > 0 && recentMessagesResult[0].values.length > 0) {
      recentMessages = recentMessagesResult[0].values[0][0] || user.total_messages;
    }
    
    // Old system: 0.2% per message, capped at 60%
    recentActivityMultiplier = 1 + Math.min(recentMessages * 0.002, 0.60);
  }
  
  // Get streak info (includes expiration logic)
  const streakInfo = getStreakInfo(userId);
  const streakBonus = streakInfo.bonus;
  
  // Base value grows permanently by +0.01 per message (handled in updateMessageCount)
  let price = user.base_value * recentActivityMultiplier * (1 + streakBonus);

  // Apply inactivity penalty if no chat in 3+ days
  if (user.last_message_time) {
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const daysSinceLastMessage = (Date.now() - user.last_message_time) / (24 * 60 * 60 * 1000);
    
    if (user.last_message_time < threeDaysAgo) {
      // Decay: -3% per day after 3 days of inactivity (max -30%)
      const inactiveDays = Math.floor(daysSinceLastMessage - 3);
      const decayPercent = Math.min(inactiveDays * 0.03, 0.30); // Max 30% decay
      price *= (1 - decayPercent);
    }
  }

  // Apply market pressure (supply and demand)
  const result = db.exec('SELECT SUM(shares) as total FROM stocks WHERE stock_user_id = ?', [userId]);
  let totalShares = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
  
  // Apply price impact delay if guildId provided
  if (guildId && totalShares > 0) {
    try {
      const { getEffectiveShareCount } = require('./market');
      totalShares = getEffectiveShareCount(guildId, userId, totalShares);
    } catch (e) {
      // Market module not loaded yet, use actual shares
    }
  }
  
  if (totalShares > 0) {
    const demandMultiplier = 1 + Math.min(totalShares * 0.003, 0.30);
    price *= demandMultiplier;
  }

  // Apply price modifier from splits
  const priceModifier = user.price_modifier || 1.0;
  price *= priceModifier;

  // Apply market event multiplier if active
  if (guildId) {
    try {
      const { getMarketEventMultiplier } = require('./events');
      const eventMultiplier = getMarketEventMultiplier(guildId);
      price *= eventMultiplier;
    } catch (e) {
      // Events module not loaded yet, skip market event
    }
  }

  return Math.round(price * 100) / 100;
}

// Get top stocks by value
function getLeaderboard(limit = 10, guildId = null) {
  const usersResult = db.exec('SELECT * FROM users');
  
  if (usersResult.length === 0 || usersResult[0].values.length === 0) return [];
  
  const cols = usersResult[0].columns;
  const users = usersResult[0].values.map(row => {
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });

  // Calculate prices and get share counts for all users
  const usersWithPrices = users.map(user => {
    const currentPrice = calculateStockPrice(user.user_id, guildId);
    
    // Get total shares owned by others (only count shares > 0)
    const sharesResult = db.exec('SELECT SUM(shares) as total FROM stocks WHERE stock_user_id = ? AND shares > 0', [user.user_id]);
    const totalShares = sharesResult.length > 0 && sharesResult[0].values.length > 0 && sharesResult[0].values[0][0] 
      ? sharesResult[0].values[0][0] 
      : 0;
    
    return {
      ...user,
      currentPrice: parseFloat(currentPrice),
      totalShares: totalShares || 0
    };
  });

  // Debug logging
  console.log('Before sort:', usersWithPrices.map(u => `${u.username}: ${u.currentPrice}`));

  // Sort by price (highest first)
  const sorted = usersWithPrices.sort((a, b) => b.currentPrice - a.currentPrice);

  console.log('After sort:', sorted.slice(0, limit).map(u => `${u.username}: ${u.currentPrice}`));

  return sorted.slice(0, limit);
}

// Get a user's rank on the stock price leaderboard
function getStockRank(userId, guildId = null) {
  const usersResult = db.exec('SELECT * FROM users');
  
  if (usersResult.length === 0 || usersResult[0].values.length === 0) return null;
  
  const cols = usersResult[0].columns;
  const users = usersResult[0].values.map(row => {
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });

  // Calculate prices for all users
  const usersWithPrices = users.map(user => ({
    userId: user.user_id,
    currentPrice: calculateStockPrice(user.user_id, guildId)
  }));

  // Sort by price (highest first)
  usersWithPrices.sort((a, b) => b.currentPrice - a.currentPrice);

  // Find rank
  const rank = usersWithPrices.findIndex(u => u.userId === userId) + 1;
  return rank > 0 ? { rank, total: usersWithPrices.length } : null;
}

// Get a user's rank on the portfolio value leaderboard
function getPortfolioRank(userId) {
  const allUsers = getAllUsers();
  
  if (allUsers.length === 0) return null;

  const portfolioValues = [];

  for (const user of allUsers) {
    const portfolio = getPortfolio(user.user_id);
    
    let totalValue = 0;
    for (const stock of portfolio) {
      const currentPrice = calculateStockPrice(stock.stock_user_id);
      totalValue += currentPrice * stock.shares;
    }

    // Only include users who have invested
    if (totalValue > 0) {
      portfolioValues.push({
        userId: user.user_id,
        totalValue: totalValue
      });
    }
  }

  if (portfolioValues.length === 0) return null;

  // Sort by total portfolio value (highest first)
  portfolioValues.sort((a, b) => b.totalValue - a.totalValue);

  // Find rank
  const rank = portfolioValues.findIndex(u => u.userId === userId) + 1;
  return rank > 0 ? { rank, total: portfolioValues.length } : null;
}

// Get raw database instance (for modules that need direct access)
function getDb() {
  return db;
}

// Get all shareholders of a specific stock (for splits/dividends)
function getAllStockHolders(stockUserId) {
  const result = db.exec(
    'SELECT owner_id, shares, avg_buy_price FROM stocks WHERE stock_user_id = ? AND shares > 0',
    [stockUserId]
  );
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => ({
    ownerId: row[0],
    shares: row[1],
    avgBuyPrice: row[2]
  }));
}

// Set exact share count (for splits)
function setShares(ownerId, stockUserId, newShares) {
  if (newShares <= 0) {
    db.run('DELETE FROM stocks WHERE owner_id = ? AND stock_user_id = ?', [ownerId, stockUserId]);
  } else {
    db.run('UPDATE stocks SET shares = ? WHERE owner_id = ? AND stock_user_id = ?', 
      [newShares, ownerId, stockUserId]);
  }
  saveDatabase();
}

// Adjust avg_buy_price after split (price / multiplier)
function adjustAvgBuyPrice(stockUserId, multiplier) {
  db.run('UPDATE stocks SET avg_buy_price = avg_buy_price / ? WHERE stock_user_id = ?',
    [multiplier, stockUserId]);
  saveDatabase();
}

// Update price modifier for a user (used by splits)
function setPriceModifier(userId, modifier) {
  db.run('UPDATE users SET price_modifier = ? WHERE user_id = ?', [modifier, userId]);
  saveDatabase();
}

// Get current price modifier
function getPriceModifier(userId) {
  const user = getUser(userId);
  return user ? (user.price_modifier || 1.0) : 1.0;
}

// Admin: Add shares to a user's portfolio
function adminAddShares(ownerId, stockUserId, shares, avgPrice) {
  const existing = getStock(ownerId, stockUserId);
  
  if (existing) {
    // Calculate new average price
    const totalShares = existing.shares + shares;
    const totalValue = (existing.shares * existing.avg_buy_price) + (shares * avgPrice);
    const newAvgPrice = totalValue / totalShares;
    
    db.run('UPDATE stocks SET shares = ?, avg_buy_price = ? WHERE owner_id = ? AND stock_user_id = ?',
      [totalShares, newAvgPrice, ownerId, stockUserId]);
  } else {
    db.run('INSERT INTO stocks (owner_id, stock_user_id, shares, avg_buy_price) VALUES (?, ?, ?, ?)',
      [ownerId, stockUserId, shares, avgPrice]);
  }
  saveDatabase();
  return true;
}

// Admin: Remove shares from a user's portfolio
function adminRemoveShares(ownerId, stockUserId, shares) {
  const existing = getStock(ownerId, stockUserId);
  
  if (!existing) return { success: false, reason: 'User does not own this stock' };
  if (existing.shares < shares) return { success: false, reason: `User only has ${existing.shares} shares` };
  
  const newShares = existing.shares - shares;
  
  if (newShares <= 0) {
    db.run('DELETE FROM stocks WHERE owner_id = ? AND stock_user_id = ?', [ownerId, stockUserId]);
  } else {
    db.run('UPDATE stocks SET shares = ? WHERE owner_id = ? AND stock_user_id = ?',
      [newShares, ownerId, stockUserId]);
  }
  saveDatabase();
  return { success: true, newShares };
}

module.exports = {
  initDatabase,
  saveDatabase,
  getUser,
  getAllUsers,
  createUser,
  updateMessageCount,
  getPortfolio,
  getStock,
  buyStock,
  sellStock,
  deleteStock,
  logTransaction,
  logPrice,
  getPriceHistory,
  getPriceHistoryByTimeRange,
  calculateStockPrice,
  getStreakInfo,
  getLeaderboard,
  getStockRank,
  getPortfolioRank,
  getDb,
  getAllStockHolders,
  setShares,
  adjustAvgBuyPrice,
  setPriceModifier,
  getPriceModifier,
  adminAddShares,
  adminRemoveShares,
  getActivityTierSettings,
  updateActivityTierSettings,
  calculateDailyContribution
};