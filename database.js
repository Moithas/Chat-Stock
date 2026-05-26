const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

// Compatibility wrapper: makes better-sqlite3 look like sql.js to the rest of the codebase
class SqlJsCompat {
  constructor(filePath) {
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
  }

  // Mimics sql.js db.exec(sql, params) → returns [{ columns, values }] or []
  exec(sql, params = []) {
    const trimmed = sql.trimStart().toUpperCase();
    const isQuery = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH');

    if (isQuery) {
      const stmt = this.db.prepare(sql);
      const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
      if (rows.length === 0) return [];
      const columns = Object.keys(rows[0]);
      const values = rows.map(row => columns.map(col => row[col]));
      return [{ columns, values }];
    } else {
      if (params.length > 0) {
        this.db.prepare(sql).run(...params);
      } else {
        this.db.exec(sql);
      }
      return [];
    }
  }

  // Mimics sql.js db.run(sql, params) — executes without returning results
  run(sql, params = []) {
    if (params.length > 0) {
      return this.db.prepare(sql).run(...params);
    } else {
      this.db.exec(sql);
    }
  }

  // Mimics sql.js db.prepare(sql) → returns a statement compatibility object
  prepare(sql) {
    const betterStmt = this.db.prepare(sql);
    return new SqlJsStmtCompat(betterStmt);
  }

  close() {
    this.db.close();
  }

  // Expose better-sqlite3 transaction support
  // Usage: db.transaction(fn)() where fn receives no args and uses db.run/exec inside
  transaction(fn) {
    return this.db.transaction(fn);
  }
}

// Compatibility wrapper for sql.js statement API (bind/step/getAsObject/free)
class SqlJsStmtCompat {
  constructor(betterStmt) {
    this.stmt = betterStmt;
    this.rows = null;
    this.rowIndex = -1;
  }

  bind(params = []) {
    this.rows = this.stmt.all(...params);
    this.rowIndex = -1;
  }

  step() {
    if (this.rows === null) {
      // Called without bind() — run with no params
      this.rows = this.stmt.all();
      this.rowIndex = -1;
    }
    this.rowIndex++;
    return this.rowIndex < this.rows.length;
  }

  getAsObject() {
    if (this.rows && this.rowIndex >= 0 && this.rowIndex < this.rows.length) {
      return this.rows[this.rowIndex];
    }
    return {};
  }

  free() {
    // No-op — better-sqlite3 handles cleanup automatically
  }
}

let db;
const dbPath = './chatstock.db';
const backupDir = './backups';
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

// Price cache — avoids recalculating the same stock price hundreds of times during leaderboard builds
const priceCache = new Map();
const PRICE_CACHE_TTL = 10_000; // 10 seconds

// Initialize database
async function initDatabase() {
  db = new SqlJsCompat(dbPath);

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
  migrateAddColumn(db, 'users', 'price_modifier REAL DEFAULT 1.0');

  // Migration: Add streak tracking columns
  migrateAddColumn(db, 'users', 'streak_tier INTEGER DEFAULT 0');
  migrateAddColumn(db, 'users', 'streak_tier_reached INTEGER DEFAULT 0');
  migrateAddColumn(db, 'users', 'streak_reset_time INTEGER DEFAULT 0');

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

  // Migration: add created_at column to balances for new player immunity tracking
  migrateAddColumn(db, 'balances', 'created_at INTEGER DEFAULT 0');

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

  // Clean up any orphaned 0-share rows from wealth tax seizures
  db.run(`DELETE FROM stocks WHERE shares <= 0`);
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

  log.info('Database initialized');
}

// Checkpoint WAL to main database file (better-sqlite3 auto-saves, but this ensures recoverability)
function saveDatabase() {
  if (db) {
    try {
      db.db.pragma('wal_checkpoint(PASSIVE)');
    } catch (e) {
      // Ignore checkpoint errors
    }
  }
}

// Checkpoint periodically
setInterval(saveDatabase, 60000);

// Clean shutdown helper — exported so bot.js can orchestrate full shutdown
function shutdownDatabase() {
  if (db) {
    try { db.db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
    try { db.close(); } catch (e) {}
    db = null;
  }
}

// Clean shutdown on process exit
process.on('exit', shutdownDatabase);

// === Database Backup System ===
function createBackup() {
  try {
    if (!db) return;

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Checkpoint WAL before backup so the main file is complete
    db.db.pragma('wal_checkpoint(TRUNCATE)');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `chatstock-${timestamp}.db`);
    fs.copyFileSync(dbPath, backupPath);

    // Prune old backups — keep only the most recent MAX_BACKUPS
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('chatstock-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (let i = MAX_BACKUPS; i < files.length; i++) {
      fs.unlinkSync(path.join(backupDir, files[i]));
    }

    const sizeMB = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
    log.info(`Database backup created: ${backupPath} (${sizeMB} MB) — ${files.length > MAX_BACKUPS ? files.length - MAX_BACKUPS : 0} old backup(s) pruned`);
  } catch (error) {
    log.error(`Database backup failed: ${error.message}`);
  }
}

// Create backup on startup (after a short delay), then every 6 hours
setTimeout(() => {
  createBackup();
  setInterval(createBackup, BACKUP_INTERVAL);
}, 30000); // Wait 30s for DB to fully initialize

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
      db.run("UPDATE users SET username = ? WHERE user_id = ? AND (username = 'Unknown User' OR username = user_id)", [username, userId]);
    }
    
    saveDatabase();
  } catch (error) {
    log.error('Error creating user', { error: error.message });
  }
}

function updateMessageCount(timestamp, userId, baseValueGrowth = 0.075) {
  if (!db) return; // Database not ready yet
  // Increment message count, update last message time, and grow base_value permanently
  db.run('UPDATE users SET total_messages = total_messages + 1, last_message_time = ?, base_value = base_value + ? WHERE user_id = ?', [timestamp, baseValueGrowth, userId]);
  // Also log as a transaction for 15-day window tracking
  db.run("INSERT INTO transactions (buyer_id, stock_user_id, shares, price, transaction_type, timestamp) VALUES (?, ?, 0, 0, 'MESSAGE', ?)",
    [userId, userId, timestamp]);
  saveDatabase();
}

// Stock functions
function getPortfolio(ownerId) {
  const result = db.exec('SELECT * FROM stocks WHERE owner_id = ? AND shares > 0', [ownerId]);
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
  const doBuy = db.transaction(() => {
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
  });
  doBuy();
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
// Pure streak calculation — NO side effects, safe to call from anywhere
// Used by calculateStockPrice, stock panel display, etc.
function calculateStreakInfo(userId) {
  const user = getUser(userId);
  if (!user) return { days: 0, tier: 0, bonus: 0 };
  
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * oneDayMs;
  const now = Date.now();
  const sixtyDaysAgo = now - (60 * oneDayMs);
  
  // Respect streak_reset_time — only count activity AFTER reset
  const resetTime = user.streak_reset_time || 0;
  const cutoffTime = Math.max(sixtyDaysAgo, resetTime);
  
  // Get all message timestamps since cutoff
  const messagesResult = db.exec(
    "SELECT timestamp FROM transactions WHERE buyer_id = ? AND timestamp > ? AND transaction_type IN ('MESSAGE', 'MC_BLOCK') ORDER BY timestamp DESC",
    [userId, cutoffTime]
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
  
  // Check for max tier expiration (7 days at tier 3) — read-only check
  const storedTier = user.streak_tier || 0;
  const tierReachedTime = user.streak_tier_reached || 0;
  
  if (currentTier === 3 && storedTier === 3 && tierReachedTime > 0) {
    if (now - tierReachedTime >= sevenDaysMs) {
      // Gold has expired — show no bonus (actual reset happens in getStreakInfo)
      return { days: streakDays, tier: 0, bonus: 0 };
    }
  }
  
  return { days: streakDays, tier: currentTier, bonus };
}

// Full streak info with side effects — ONLY call from message handler in bot.js
// Handles DB writes for tier tracking, expiration, and announcements
function getStreakInfo(userId) {
  const user = getUser(userId);
  if (!user) return { days: 0, tier: 0, bonus: 0, newTier: false };
  
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * oneDayMs;
  const now = Date.now();
  
  // Get the pure calculation first
  const info = calculateStreakInfo(userId);
  const streakDays = info.days;
  
  // Recalculate currentTier from days (need the raw tier before expiration check)
  let currentTier = 0;
  if (streakDays >= 30) currentTier = 3;
  else if (streakDays >= 14) currentTier = 2;
  else if (streakDays >= 7) currentTier = 1;
  
  const storedTier = user.streak_tier || 0;
  const tierReachedTime = user.streak_tier_reached || 0;
  
  // Check for Gold expiration (7 days at tier 3) → FULL STREAK RESET
  if (currentTier === 3 && storedTier === 3 && tierReachedTime > 0) {
    if (now - tierReachedTime >= sevenDaysMs) {
      // Gold expired — reset entire streak
      db.run('UPDATE users SET streak_tier = 0, streak_tier_reached = 0, streak_reset_time = ? WHERE user_id = ?', 
        [now, userId]);
      saveDatabase();
      return { days: 0, tier: 0, bonus: 0, expired: true, newTier: false };
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
  
  return { days: streakDays, tier: currentTier, bonus: info.bonus, newTier };
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
function calculateStockPrice(userId, guildId = null, excludeBuyerId = null, excludeEvents = false, lpModifier = 0) {
  // Check price cache first
  const cacheKey = `${userId}:${guildId || 'null'}${excludeBuyerId ? `:ex${excludeBuyerId}` : ''}${excludeEvents ? ':noev' : ''}${lpModifier ? `:lp${lpModifier}` : ''}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.time < PRICE_CACHE_TTL) {
    return cached.price;
  }

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
      "SELECT timestamp FROM transactions WHERE buyer_id = ? AND timestamp > ? AND transaction_type IN ('MESSAGE', 'MC_BLOCK') ORDER BY timestamp ASC",
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
      "SELECT COUNT(*) as count FROM transactions WHERE buyer_id = ? AND timestamp > ? AND transaction_type IN ('MESSAGE', 'MC_BLOCK')",
      [userId, windowAgo]
    );
    
    let recentMessages = user.total_messages;
    if (recentMessagesResult.length > 0 && recentMessagesResult[0].values.length > 0) {
      recentMessages = recentMessagesResult[0].values[0][0] || user.total_messages;
    }
    
    // Old system: 0.2% per message, capped at 60%
    recentActivityMultiplier = 1 + Math.min(recentMessages * 0.002, 0.60);
  }
  
  // Get streak info (pure calculation — no side effects)
  const streakInfo = calculateStreakInfo(userId);
  const streakBonus = streakInfo.bonus;
  
  // Base value grows permanently per message (rate configurable via admin panel, default 0.075)
  let price = user.base_value * recentActivityMultiplier * (1 + streakBonus);

  // Apply inactivity penalty if no chat in 3+ days
  if (user.last_message_time) {
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const daysSinceLastMessage = (Date.now() - user.last_message_time) / (24 * 60 * 60 * 1000);
    
    if (user.last_message_time < threeDaysAgo) {
      // Decay: -5% per day after 3 days of inactivity (max -50%), scales smoothly
      const inactiveDaysPast3 = daysSinceLastMessage - 3;
      const decayPercent = Math.min(inactiveDaysPast3 * 0.05, 0.50);
      price *= (1 - decayPercent);
    }
  }

  // Apply market pressure (supply and demand)
  let shareQuery, shareParams;
  if (excludeBuyerId) {
    // Exclude a specific buyer's shares from demand calculation (prevents self-pump-and-dump)
    shareQuery = 'SELECT SUM(shares) as total FROM stocks WHERE stock_user_id = ? AND owner_id != ?';
    shareParams = [userId, excludeBuyerId];
  } else {
    shareQuery = 'SELECT SUM(shares) as total FROM stocks WHERE stock_user_id = ?';
    shareParams = [userId];
  }
  const result = db.exec(shareQuery, shareParams);
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

  // Apply temporary demand momentum from fresh net buys/sells.
  if (guildId) {
    try {
      const { getPendingDemandMomentum } = require('./market');
      const demandMomentum = getPendingDemandMomentum(guildId, userId);
      if (demandMomentum !== 0) {
        price *= (1 + demandMomentum);
      }
    } catch (e) {
      // Market module not loaded yet, skip momentum bonus
    }
  }

  // Apply price modifier from splits
  const priceModifier = user.price_modifier || 1.0;
  price *= priceModifier;

  // Apply market event multiplier and LP modifier additively
  let eventMod = 0;
  if (guildId && !excludeEvents) {
    try {
      const { getMarketEventMultiplier } = require('./events');
      eventMod = getMarketEventMultiplier(guildId) - 1; // e.g., 0.20 for +20%
    } catch (e) {
      // Events module not loaded yet, skip market event
    }
  }
  const lpMod = lpModifier / 100; // e.g., 0.18 for +18%
  if (eventMod !== 0 || lpMod !== 0) {
    price *= (1 + eventMod + lpMod);
  }

  // Cap stock price to prevent runaway values from compounding multipliers
  const MAX_STOCK_PRICE = 1_000_000_000; // 1 billion
  const finalPrice = Math.min(MAX_STOCK_PRICE, Math.max(0.01, Math.round(price * 100) / 100));
  priceCache.set(cacheKey, { price: finalPrice, time: Date.now() });
  return finalPrice;
}

// Get top stocks by value
function getLeaderboard(limit = 10, guildId = null) {
  const usersResult = db.exec('SELECT * FROM users');
  
  if (usersResult.length === 0 || usersResult[0].values.length === 0) return [];
  
  const cols = usersResult[0].columns;
  const users = usersResult[0].values.map(row => {
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });

  // Batch-fetch all share counts in one query
  const allSharesResult = db.exec('SELECT stock_user_id, SUM(shares) as total FROM stocks WHERE shares > 0 GROUP BY stock_user_id');
  const sharesMap = new Map();
  if (allSharesResult.length > 0) {
    for (const row of allSharesResult[0].values) {
      sharesMap.set(row[0], row[1] || 0);
    }
  }

  // Calculate prices (price cache prevents redundant computation)
  const usersWithPrices = users.map(user => {
    const currentPrice = calculateStockPrice(user.user_id, guildId);
    
    return {
      ...user,
      currentPrice: parseFloat(currentPrice),
      totalShares: sharesMap.get(user.user_id) || 0
    };
  });

  // Debug logging
  log.debug('Before sort:', usersWithPrices.map(u => `${u.username}: ${u.currentPrice}`));

  // Sort by price (highest first)
  const sorted = usersWithPrices.sort((a, b) => b.currentPrice - a.currentPrice);

  log.debug('After sort:', sorted.slice(0, limit).map(u => `${u.username}: ${u.currentPrice}`));

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
function getPortfolioRank(userId, guildId = null) {
  // Batch-fetch all holdings in one query
  const allStocksResult = db.exec('SELECT owner_id, stock_user_id, shares FROM stocks WHERE shares > 0');
  if (!allStocksResult.length || !allStocksResult[0].values.length) return null;

  // Group by owner
  const ownerMap = new Map();
  for (const row of allStocksResult[0].values) {
    const ownerId = row[0];
    if (!ownerMap.has(ownerId)) ownerMap.set(ownerId, []);
    ownerMap.get(ownerId).push({ stock_user_id: row[1], shares: row[2] });
  }

  const portfolioValues = [];

  for (const [ownerId, holdings] of ownerMap) {
    let totalValue = 0;
    for (const stock of holdings) {
      const currentPrice = calculateStockPrice(stock.stock_user_id, guildId);
      totalValue += currentPrice * stock.shares;
    }

    if (totalValue > 0) {
      portfolioValues.push({ userId: ownerId, totalValue });
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
// Clamped to [0.0001, 10000] to prevent runaway values from repeated splits
function setPriceModifier(userId, modifier) {
  modifier = Math.max(0.0001, Math.min(10000, modifier));
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

// Safe migration helper: only swallows "duplicate column name" errors
function migrateAddColumn(db, table, columnDef) {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    if (!e.message || !e.message.includes('duplicate column name')) {
      console.error(`[Migration Error] Failed to add column to ${table}: ${e.message}`);
    }
  }
}

module.exports = {
  initDatabase,
  saveDatabase,
  createBackup,
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
  calculateStreakInfo,
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
  calculateDailyContribution,
  migrateAddColumn,
  shutdownDatabase
};