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
const dbPath = process.env.DB_PATH || './chatstock.db';
const backupDir = './backups';
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

// Price cache — avoids recalculating the same stock price hundreds of times during leaderboard builds
const priceCache = new Map();
const PRICE_CACHE_TTL = 10_000; // 10 seconds

// Guard: every stock-market function is per-guild. Fail loudly if a caller
// forgets to pass a guildId rather than silently reading/writing global data.
function assertGuild(guildId, fnName) {
  if (!guildId || typeof guildId !== 'string') {
    throw new Error(`[market] ${fnName}() called without a valid guildId — per-guild isolation requires a guild context`);
  }
}

/**
 * One-time migration: convert the global stock-market tables (users, stocks,
 * transactions, price_history) to per-guild tables keyed by guild_id. Existing
 * rows are stamped with LEGACY_GUILD_ID. Idempotent — skips if already migrated.
 */
function migratePerGuildMarket(db) {
  const raw = db.db;

  // Already migrated if users has a guild_id column
  const userCols = raw.prepare('PRAGMA table_info(users)').all();
  if (userCols.some(c => c.name === 'guild_id')) return;

  const existingUsers = raw.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const legacyGuildId = (process.env.LEGACY_GUILD_ID || '').trim();

  if (existingUsers > 0 && !legacyGuildId) {
    throw new Error(
      'Per-guild market migration requires LEGACY_GUILD_ID. Set LEGACY_GUILD_ID in ' +
      'your .env to the Discord server ID that owns the existing stock-market data, ' +
      'then restart.'
    );
  }

  // Safety: take a full backup of the database file immediately before the
  // destructive table rebuild (the scheduled 6-hourly backup may be stale and
  // runs after startup, so it cannot protect this migration).
  if (existingUsers > 0) {
    try {
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      raw.pragma('wal_checkpoint(TRUNCATE)');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const preMigrationPath = path.join(backupDir, `pre-per-guild-migration-${stamp}.db`);
      fs.copyFileSync(dbPath, preMigrationPath);
      log.warn(`Pre-migration backup written: ${preMigrationPath}`);
    } catch (e) {
      throw new Error(`Aborting per-guild market migration — failed to write a pre-migration backup: ${e.message}`);
    }
  }

  log.warn(`Migrating stock market to per-guild schema (stamping existing data with guild ${legacyGuildId || 'N/A'})...`);

  const migrate = raw.transaction(() => {
    // users
    raw.exec(`
      CREATE TABLE users_new (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        total_messages INTEGER DEFAULT 0,
        base_value REAL DEFAULT 100.0,
        last_message_time INTEGER,
        price_modifier REAL DEFAULT 1.0,
        streak_tier INTEGER DEFAULT 0,
        streak_tier_reached INTEGER DEFAULT 0,
        streak_reset_time INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
    raw.prepare(`
      INSERT INTO users_new (guild_id, user_id, username, total_messages, base_value, last_message_time, price_modifier, streak_tier, streak_tier_reached, streak_reset_time)
      SELECT ?, user_id, username, total_messages, base_value, last_message_time,
             COALESCE(price_modifier, 1.0), COALESCE(streak_tier, 0), COALESCE(streak_tier_reached, 0), COALESCE(streak_reset_time, 0)
      FROM users
    `).run(legacyGuildId);
    raw.exec('DROP TABLE users');
    raw.exec('ALTER TABLE users_new RENAME TO users');

    // stocks
    raw.exec(`
      CREATE TABLE stocks_new (
        guild_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        stock_user_id TEXT NOT NULL,
        shares INTEGER NOT NULL,
        avg_buy_price REAL NOT NULL,
        PRIMARY KEY (guild_id, owner_id, stock_user_id)
      );
    `);
    raw.prepare(`
      INSERT INTO stocks_new (guild_id, owner_id, stock_user_id, shares, avg_buy_price)
      SELECT ?, owner_id, stock_user_id, shares, avg_buy_price FROM stocks
    `).run(legacyGuildId);
    raw.exec('DROP TABLE stocks');
    raw.exec('ALTER TABLE stocks_new RENAME TO stocks');

    // transactions
    raw.exec(`
      CREATE TABLE transactions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        stock_user_id TEXT NOT NULL,
        shares INTEGER NOT NULL,
        price REAL NOT NULL,
        transaction_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);
    raw.prepare(`
      INSERT INTO transactions_new (id, guild_id, buyer_id, stock_user_id, shares, price, transaction_type, timestamp)
      SELECT id, ?, buyer_id, stock_user_id, shares, price, transaction_type, timestamp FROM transactions
    `).run(legacyGuildId);
    raw.exec('DROP TABLE transactions');
    raw.exec('ALTER TABLE transactions_new RENAME TO transactions');

    // price_history
    raw.exec(`
      CREATE TABLE price_history_new (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);
    raw.prepare(`
      INSERT INTO price_history_new (guild_id, user_id, price, timestamp)
      SELECT ?, user_id, price, timestamp FROM price_history
    `).run(legacyGuildId);
    raw.exec('DROP TABLE price_history');
    raw.exec('ALTER TABLE price_history_new RENAME TO price_history');
  });

  migrate();

  const integrity = raw.prepare('PRAGMA integrity_check').get().integrity_check;
  log.warn(`Per-guild market migration complete (${existingUsers} user rows). Integrity: ${integrity}`);
}

// Initialize database
async function initDatabase() {
  db = new SqlJsCompat(dbPath);

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      total_messages INTEGER DEFAULT 0,
      base_value REAL DEFAULT 100.0,
      last_message_time INTEGER,
      price_modifier REAL DEFAULT 1.0,
      streak_tier INTEGER DEFAULT 0,
      streak_tier_reached INTEGER DEFAULT 0,
      streak_reset_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
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
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      shares INTEGER NOT NULL,
      avg_buy_price REAL NOT NULL,
      PRIMARY KEY (guild_id, owner_id, stock_user_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
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
      guild_id TEXT NOT NULL,
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

  // Migration: track when a player forfeited their new-player immunity (0 = still immune-eligible)
  migrateAddColumn(db, 'balances', 'immunity_waived_at INTEGER DEFAULT 0');

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

  // Migrate the stock-market tables to the per-guild schema (idempotent; only
  // runs once on databases created before per-guild isolation).
  migratePerGuildMarket(db);

  // Create indexes for frequently queried columns
  db.run(`CREATE INDEX IF NOT EXISTS idx_balances_guild_user ON balances(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_stocks_owner ON stocks(guild_id, owner_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_stocks_stock_user ON stocks(guild_id, stock_user_id)`);

  // Clean up any orphaned 0-share rows from wealth tax seizures
  db.run(`DELETE FROM stocks WHERE shares <= 0`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(guild_id, timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_buyer ON transactions(guild_id, buyer_id, timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_user ON price_history(guild_id, user_id, timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(guild_id, timestamp)`);
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

    // Optional off-host backup: if BACKUP_SYNC_CMD is set, run it after each
    // backup to copy the backups directory to remote/off-host storage so a disk
    // failure can't lose both the database and its backups. For example:
    //   rclone copy ./backups remote:black-ledger-backups
    //   aws s3 sync ./backups s3://your-bucket/black-ledger
    const syncCmd = process.env.BACKUP_SYNC_CMD;
    if (syncCmd) {
      require('child_process').exec(syncCmd, (err) => {
        if (err) {
          log.error(`Off-host backup sync failed: ${err.message}`);
        } else {
          log.info('Off-host backup sync completed');
        }
      });
    }
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
function getUser(guildId, userId) {
  assertGuild(guildId, 'getUser');
  const result = db.exec('SELECT * FROM users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

// Get all users
function getAllUsers(guildId) {
  assertGuild(guildId, 'getAllUsers');
  const result = db.exec('SELECT * FROM users WHERE guild_id = ?', [guildId]);
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function createUser(guildId, userId, username) {
  if (!db) return; // Database not ready yet
  assertGuild(guildId, 'createUser');
  try {
    // First try to insert the user
    db.run('INSERT OR IGNORE INTO users (guild_id, user_id, username) VALUES (?, ?, ?)', [guildId, userId, username]);
    
    // If user exists with "Unknown User" or just their ID as username, update it
    if (username && username !== 'Unknown User' && username !== userId) {
      db.run("UPDATE users SET username = ? WHERE guild_id = ? AND user_id = ? AND (username = 'Unknown User' OR username = user_id)", [username, guildId, userId]);
    }
    
    saveDatabase();
  } catch (error) {
    log.error('Error creating user', { error: error.message });
  }
}

function updateMessageCount(guildId, timestamp, userId, baseValueGrowth = 0.075) {
  if (!db) return; // Database not ready yet
  assertGuild(guildId, 'updateMessageCount');
  // Increment message count, update last message time, and grow base_value permanently
  db.run('UPDATE users SET total_messages = total_messages + 1, last_message_time = ?, base_value = base_value + ? WHERE guild_id = ? AND user_id = ?', [timestamp, baseValueGrowth, guildId, userId]);
  // Also log as a transaction for 15-day window tracking
  db.run("INSERT INTO transactions (guild_id, buyer_id, stock_user_id, shares, price, transaction_type, timestamp) VALUES (?, ?, ?, 0, 0, 'MESSAGE', ?)",
    [guildId, userId, userId, timestamp]);
  saveDatabase();
}

// Stock functions
function getPortfolio(guildId, ownerId) {
  assertGuild(guildId, 'getPortfolio');
  const result = db.exec('SELECT * FROM stocks WHERE guild_id = ? AND owner_id = ? AND shares > 0', [guildId, ownerId]);
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getStock(guildId, ownerId, stockUserId) {
  assertGuild(guildId, 'getStock');
  const result = db.exec('SELECT * FROM stocks WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?', [guildId, ownerId, stockUserId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

function buyStock(guildId, ownerId, stockUserId, shares, price) {
  assertGuild(guildId, 'buyStock');
  const doBuy = db.transaction(() => {
    const existing = getStock(guildId, ownerId, stockUserId);
    
    if (existing) {
      const newShares = existing.shares + shares;
      const newAvgPrice = ((existing.shares * existing.avg_buy_price) + (shares * price)) / newShares;
      db.run('UPDATE stocks SET shares = ?, avg_buy_price = ? WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?', 
        [newShares, newAvgPrice, guildId, ownerId, stockUserId]);
    } else {
      db.run('INSERT INTO stocks (guild_id, owner_id, stock_user_id, shares, avg_buy_price) VALUES (?, ?, ?, ?, ?)',
        [guildId, ownerId, stockUserId, shares, price]);
    }
  });
  doBuy();
  saveDatabase();
}

function sellStock(guildId, shares, ownerId, stockUserId) {
  assertGuild(guildId, 'sellStock');
  db.run('UPDATE stocks SET shares = shares - ? WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?', 
    [shares, guildId, ownerId, stockUserId]);
  saveDatabase();
}

function deleteStock(guildId, ownerId, stockUserId) {
  assertGuild(guildId, 'deleteStock');
  db.run('DELETE FROM stocks WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ? AND shares <= 0', 
    [guildId, ownerId, stockUserId]);
  saveDatabase();
}

// Transaction logging
function logTransaction(guildId, buyerId, stockUserId, shares, price, type, timestamp) {
  assertGuild(guildId, 'logTransaction');
  db.run('INSERT INTO transactions (guild_id, buyer_id, stock_user_id, shares, price, transaction_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [guildId, buyerId, stockUserId, shares, price, type, timestamp]);
  saveDatabase();
}

// Price history
function logPrice(guildId, userId, price, timestamp) {
  assertGuild(guildId, 'logPrice');
  db.run('INSERT INTO price_history (guild_id, user_id, price, timestamp) VALUES (?, ?, ?, ?)', 
    [guildId, userId, price, timestamp]);
  // WAL is checkpointed by the 60s saveDatabase() interval; no sync checkpoint here.
}

function getPriceHistory(guildId, userId) {
  assertGuild(guildId, 'getPriceHistory');
  const result = db.exec('SELECT * FROM price_history WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 20', [guildId, userId]);
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get price history within a time range for charting
function getPriceHistoryByTimeRange(guildId, userId, startTime) {
  assertGuild(guildId, 'getPriceHistoryByTimeRange');
  const result = db.exec(
    'SELECT * FROM price_history WHERE guild_id = ? AND user_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
    [guildId, userId, startTime]
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
function calculateStreakInfo(guildId, userId) {
  assertGuild(guildId, 'calculateStreakInfo');
  const user = getUser(guildId, userId);
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
    "SELECT timestamp FROM transactions WHERE guild_id = ? AND buyer_id = ? AND timestamp > ? AND transaction_type IN ('MESSAGE', 'MC_BLOCK') ORDER BY timestamp DESC",
    [guildId, userId, cutoffTime]
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
function getStreakInfo(guildId, userId) {
  assertGuild(guildId, 'getStreakInfo');
  const user = getUser(guildId, userId);
  if (!user) return { days: 0, tier: 0, bonus: 0, newTier: false };
  
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * oneDayMs;
  const now = Date.now();
  
  // Get the pure calculation first
  const info = calculateStreakInfo(guildId, userId);
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
      db.run('UPDATE users SET streak_tier = 0, streak_tier_reached = 0, streak_reset_time = ? WHERE guild_id = ? AND user_id = ?', 
        [now, guildId, userId]);
      saveDatabase();
      return { days: 0, tier: 0, bonus: 0, expired: true, newTier: false };
    }
  }
  
  // Check if this is a new tier achievement
  let newTier = false;
  if (currentTier > storedTier) {
    newTier = true;
    const reachedTime = currentTier === 3 ? now : 0; // Only track time for max tier
    db.run('UPDATE users SET streak_tier = ?, streak_tier_reached = ? WHERE guild_id = ? AND user_id = ?', 
      [currentTier, reachedTime, guildId, userId]);
    saveDatabase();
  } else if (currentTier < storedTier) {
    // User lost their streak, update stored tier
    db.run('UPDATE users SET streak_tier = ?, streak_tier_reached = 0 WHERE guild_id = ? AND user_id = ?', 
      [currentTier, guildId, userId]);
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
function calculateStockPrice(userId, guildId, excludeBuyerId = null, excludeEvents = false, lpModifier = 0) {
  assertGuild(guildId, 'calculateStockPrice');
  // Check price cache first
  const cacheKey = `${userId}:${guildId || 'null'}${excludeBuyerId ? `:ex${excludeBuyerId}` : ''}${excludeEvents ? ':noev' : ''}${lpModifier ? `:lp${lpModifier}` : ''}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.time < PRICE_CACHE_TTL) {
    return cached.price;
  }

  const user = getUser(guildId, userId);
  if (!user) return 100.0;

  // Get activity tier settings
  const tierSettings = getActivityTierSettings(guildId);
  const windowDays = tierSettings.windowDays;
  const windowAgo = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
  
  let recentActivityMultiplier = 1.0;
  
  if (tierSettings.enabled) {
    // Get messages grouped by day within the window
    const messagesResult = db.exec(
      "SELECT timestamp FROM transactions WHERE guild_id = ? AND buyer_id = ? AND timestamp > ? AND transaction_type IN ('MESSAGE', 'MC_BLOCK') ORDER BY timestamp ASC",
      [guildId, userId, windowAgo]
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
      "SELECT COUNT(*) as count FROM transactions WHERE guild_id = ? AND buyer_id = ? AND timestamp > ? AND transaction_type IN ('MESSAGE', 'MC_BLOCK')",
      [guildId, userId, windowAgo]
    );
    
    let recentMessages = user.total_messages;
    if (recentMessagesResult.length > 0 && recentMessagesResult[0].values.length > 0) {
      recentMessages = recentMessagesResult[0].values[0][0] || user.total_messages;
    }
    
    // Old system: 0.2% per message, capped at 60%
    recentActivityMultiplier = 1 + Math.min(recentMessages * 0.002, 0.60);
  }
  
  // Get streak info (pure calculation — no side effects)
  const streakInfo = calculateStreakInfo(guildId, userId);
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
    shareQuery = 'SELECT SUM(shares) as total FROM stocks WHERE guild_id = ? AND stock_user_id = ? AND owner_id != ?';
    shareParams = [guildId, userId, excludeBuyerId];
  } else {
    shareQuery = 'SELECT SUM(shares) as total FROM stocks WHERE guild_id = ? AND stock_user_id = ?';
    shareParams = [guildId, userId];
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
    // Supply & demand: more shares outstanding => permanently higher price.
    // At/below 100 shares this matches the original linear curve (0 -> +30%).
    // Above 100 shares the price keeps climbing with DIMINISHING marginal impact
    // (square root), so a single large purchase can't dominate. Combined with the
    // price-impact delay (getEffectiveShareCount phases new shares in over the
    // impact window), a buy's effect trickles in gradually and then STAYS -
    // driven purely by shares outstanding, with no decay timer.
    // Continuous at 100 shares: sqrt(0) = 0, so both branches meet at +30%.
    const DEMAND_GROWTH_COEFF = 0.0004; // marginal demand above 100 shares; higher = steeper
    const DEMAND_BONUS_CAP = 1.50;      // hard safety ceiling (+150%) to prevent runaway
    let demandBonus;
    if (totalShares <= 100) {
      demandBonus = totalShares * 0.003;
    } else {
      demandBonus = 0.30 + DEMAND_GROWTH_COEFF * Math.sqrt(totalShares - 100);
    }
    demandBonus = Math.min(demandBonus, DEMAND_BONUS_CAP);
    price *= (1 + demandBonus);
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
  assertGuild(guildId, 'getLeaderboard');
  const usersResult = db.exec('SELECT * FROM users WHERE guild_id = ?', [guildId]);
  
  if (usersResult.length === 0 || usersResult[0].values.length === 0) return [];
  
  const cols = usersResult[0].columns;
  const users = usersResult[0].values.map(row => {
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });

  // Batch-fetch all share counts in one query
  const allSharesResult = db.exec('SELECT stock_user_id, SUM(shares) as total FROM stocks WHERE guild_id = ? AND shares > 0 GROUP BY stock_user_id', [guildId]);
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
  assertGuild(guildId, 'getStockRank');
  const usersResult = db.exec('SELECT * FROM users WHERE guild_id = ?', [guildId]);
  
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
  assertGuild(guildId, 'getPortfolioRank');
  // Batch-fetch all holdings in one query
  const allStocksResult = db.exec('SELECT owner_id, stock_user_id, shares FROM stocks WHERE guild_id = ? AND shares > 0', [guildId]);
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
function getAllStockHolders(guildId, stockUserId) {
  assertGuild(guildId, 'getAllStockHolders');
  const result = db.exec(
    'SELECT owner_id, shares, avg_buy_price FROM stocks WHERE guild_id = ? AND stock_user_id = ? AND shares > 0',
    [guildId, stockUserId]
  );
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => ({
    ownerId: row[0],
    shares: row[1],
    avgBuyPrice: row[2]
  }));
}

// Set exact share count (for splits)
function setShares(guildId, ownerId, stockUserId, newShares) {
  assertGuild(guildId, 'setShares');
  if (newShares <= 0) {
    db.run('DELETE FROM stocks WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?', [guildId, ownerId, stockUserId]);
  } else {
    db.run('UPDATE stocks SET shares = ? WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?', 
      [newShares, guildId, ownerId, stockUserId]);
  }
  saveDatabase();
}

// Adjust avg_buy_price after split (price / multiplier)
function adjustAvgBuyPrice(guildId, stockUserId, multiplier) {
  assertGuild(guildId, 'adjustAvgBuyPrice');
  db.run('UPDATE stocks SET avg_buy_price = avg_buy_price / ? WHERE guild_id = ? AND stock_user_id = ?',
    [multiplier, guildId, stockUserId]);
  saveDatabase();
}

// Update price modifier for a user (used by splits)
// Clamped to [0.0001, 10000] to prevent runaway values from repeated splits
function setPriceModifier(guildId, userId, modifier) {
  assertGuild(guildId, 'setPriceModifier');
  modifier = Math.max(0.0001, Math.min(10000, modifier));
  db.run('UPDATE users SET price_modifier = ? WHERE guild_id = ? AND user_id = ?', [modifier, guildId, userId]);
  saveDatabase();
}

// Get current price modifier
function getPriceModifier(guildId, userId) {
  assertGuild(guildId, 'getPriceModifier');
  const user = getUser(guildId, userId);
  return user ? (user.price_modifier || 1.0) : 1.0;
}

// Admin: Add shares to a user's portfolio
function adminAddShares(guildId, ownerId, stockUserId, shares, avgPrice) {
  assertGuild(guildId, 'adminAddShares');
  const existing = getStock(guildId, ownerId, stockUserId);
  
  if (existing) {
    // Calculate new average price
    const totalShares = existing.shares + shares;
    const totalValue = (existing.shares * existing.avg_buy_price) + (shares * avgPrice);
    const newAvgPrice = totalValue / totalShares;
    
    db.run('UPDATE stocks SET shares = ?, avg_buy_price = ? WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?',
      [totalShares, newAvgPrice, guildId, ownerId, stockUserId]);
  } else {
    db.run('INSERT INTO stocks (guild_id, owner_id, stock_user_id, shares, avg_buy_price) VALUES (?, ?, ?, ?, ?)',
      [guildId, ownerId, stockUserId, shares, avgPrice]);
  }
  saveDatabase();
  return true;
}

// Admin: Remove shares from a user's portfolio
function adminRemoveShares(guildId, ownerId, stockUserId, shares) {
  assertGuild(guildId, 'adminRemoveShares');
  const existing = getStock(guildId, ownerId, stockUserId);
  
  if (!existing) return { success: false, reason: 'User does not own this stock' };
  if (existing.shares < shares) return { success: false, reason: `User only has ${existing.shares} shares` };
  
  const newShares = existing.shares - shares;
  
  if (newShares <= 0) {
    db.run('DELETE FROM stocks WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?', [guildId, ownerId, stockUserId]);
  } else {
    db.run('UPDATE stocks SET shares = ? WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ?',
      [newShares, guildId, ownerId, stockUserId]);
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
  migratePerGuildMarket,
  shutdownDatabase
};