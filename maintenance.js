// Maintenance module for Chat-Stock
// Handles database cleanup, error monitoring, and command rate limiting

let db = null;
let client = null;

// Error log buffer (keeps last 100 errors in memory)
const errorLog = [];
const MAX_ERROR_LOG = 100;

// Command cooldowns cache: Map<guildId, Map<commandName, Map<userId, timestamp>>>
const commandCooldowns = new Map();

// Default cooldowns per command (in seconds) - can be overridden by guild settings
const DEFAULT_COMMAND_COOLDOWNS = {
  // Economy commands - prevent spam
  work: 0,      // Already has built-in cooldown
  crime: 0,     // Already has built-in cooldown
  slut: 0,      // Already has built-in cooldown
  rob: 0,       // Already has built-in cooldown
  hack: 0,      // Already has built-in cooldown
  
  // Trading commands - light cooldown to prevent rapid trading
  stock: 3,
  
  // Gambling - already rate limited by game flow
  blackjack: 2,
  roulette: 2,
  scratch: 1,
  lottery: 2,
  
  // Info commands - no cooldown needed
  balance: 0,
  leaderboard: 5,
  help: 0,
  
  // Bank operations
  deposit: 2,
  withdraw: 2,
  
  // Default for unlisted commands
  _default: 2
};

// Cache for guild command cooldown settings
const guildCooldownSettings = new Map();

// History retention in days
const HISTORY_RETENTION_DAYS = 90;

function initMaintenance(database, discordClient) {
  db = database;
  client = discordClient;
  
  // Create command cooldown settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS command_cooldown_settings (
      guild_id TEXT NOT NULL,
      command_name TEXT NOT NULL,
      cooldown_seconds INTEGER DEFAULT 2,
      enabled INTEGER DEFAULT 1,
      PRIMARY KEY (guild_id, command_name)
    )
  `);
  
  // Create error log table (persistent errors for admin review)
  db.run(`
    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT,
      user_id TEXT,
      command TEXT,
      error_message TEXT NOT NULL,
      stack_trace TEXT,
      occurred_at INTEGER NOT NULL
    )
  `);
  
  // Create maintenance history table
  db.run(`
    CREATE TABLE IF NOT EXISTS maintenance_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT,
      action TEXT NOT NULL,
      records_affected INTEGER DEFAULT 0,
      executed_at INTEGER NOT NULL
    )
  `);
  
  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_error_log_guild_time ON error_log(guild_id, occurred_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_maintenance_history_time ON maintenance_history(executed_at)`);
  
  console.log('🔧 Maintenance system initialized');
}

// ============ ERROR MONITORING ============

/**
 * Log an error to both memory and database
 * @param {Object} errorInfo - Error information
 * @param {string} errorInfo.guildId - Guild ID (optional)
 * @param {string} errorInfo.userId - User ID (optional)
 * @param {string} errorInfo.command - Command that caused the error (optional)
 * @param {Error|string} errorInfo.error - The error object or message
 */
function logError(errorInfo) {
  const { guildId, userId, command, error } = errorInfo;
  const timestamp = Date.now();
  
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stackTrace = error instanceof Error ? error.stack : null;
  
  // Add to in-memory log
  const logEntry = {
    guildId,
    userId,
    command,
    errorMessage,
    stackTrace,
    timestamp
  };
  
  errorLog.push(logEntry);
  
  // Keep only last MAX_ERROR_LOG entries
  if (errorLog.length > MAX_ERROR_LOG) {
    errorLog.shift();
  }
  
  // Log to console with formatting
  const prefix = command ? `[${command}]` : '[SYSTEM]';
  console.error(`❌ ${prefix} ${errorMessage}`);
  if (stackTrace && process.env.DEBUG === 'true') {
    console.error(stackTrace);
  }
  
  // Log to database (non-blocking)
  if (db) {
    try {
      db.run(`
        INSERT INTO error_log (guild_id, user_id, command, error_message, stack_trace, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [guildId || null, userId || null, command || null, errorMessage, stackTrace || null, timestamp]);
    } catch (e) {
      console.error('Failed to log error to database:', e.message);
    }
  }
}

/**
 * Get recent errors from memory
 * @param {number} limit - Maximum number of errors to return
 * @returns {Array} Recent errors
 */
function getRecentErrors(limit = 10) {
  return errorLog.slice(-limit).reverse();
}

/**
 * Get errors from database with optional filters
 * @param {Object} filters - Filter options
 * @param {string} filters.guildId - Filter by guild
 * @param {string} filters.command - Filter by command
 * @param {number} filters.limit - Max results (default 50)
 * @param {number} filters.since - Timestamp to filter from
 * @returns {Array} Matching errors
 */
function getErrorsFromDb(filters = {}) {
  if (!db) return [];
  
  const { guildId, command, limit = 50, since } = filters;
  
  let query = 'SELECT * FROM error_log WHERE 1=1';
  const params = [];
  
  if (guildId) {
    query += ' AND guild_id = ?';
    params.push(guildId);
  }
  
  if (command) {
    query += ' AND command = ?';
    params.push(command);
  }
  
  if (since) {
    query += ' AND occurred_at >= ?';
    params.push(since);
  }
  
  query += ' ORDER BY occurred_at DESC LIMIT ?';
  params.push(limit);
  
  try {
    const stmt = db.prepare(query);
    stmt.bind(params);
    
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (e) {
    console.error('Failed to fetch errors from database:', e.message);
    return [];
  }
}

// ============ DATABASE CLEANUP ============

/**
 * Clean up old history records from all history tables
 * @param {string} guildId - Guild ID (optional, cleans all if not specified)
 * @returns {Object} Cleanup results
 */
function cleanupOldHistory(guildId = null) {
  if (!db) return { success: false, error: 'Database not initialized' };
  
  const cutoffTime = Date.now() - (HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const results = {};
  let totalCleaned = 0;
  
  // List of history tables to clean with their timestamp columns
  const historyTables = [
    { table: 'rob_history', timeColumn: 'rob_time' },
    { table: 'hack_history', timeColumn: 'hack_time' },
    { table: 'work_history', timeColumn: 'work_time' },
    { table: 'slut_history', timeColumn: 'slut_time' },
    { table: 'crime_history', timeColumn: 'crime_time' },
    { table: 'fight_history', timeColumn: 'fought_at' },
    { table: 'fight_opponent_history', timeColumn: 'fought_at' },
    { table: 'economy_transactions', timeColumn: 'timestamp' },
    { table: 'price_history', timeColumn: 'timestamp' },
    { table: 'transactions', timeColumn: 'timestamp' },
    { table: 'dividend_history', timeColumn: 'payout_time' },
    { table: 'passive_income_history', timeColumn: 'collection_time' },
    { table: 'role_income_history', timeColumn: 'collection_time' },
    { table: 'self_dividend_history', timeColumn: 'payout_time' },
    { table: 'split_history', timeColumn: 'split_time' },
    { table: 'lottery_history', timeColumn: 'draw_time' },
    { table: 'event_history', timeColumn: 'triggered_at' },
    { table: 'cheese_truck_history', timeColumn: 'triggered_at' },
    { table: 'item_purchase_history', timeColumn: 'purchased_at' },
    { table: 'bond_history', timeColumn: 'purchased_at' },
    { table: 'loan_payments', timeColumn: 'payment_time' },
    { table: 'wealth_tax_history', timeColumn: 'collected_at' },
    { table: 'rob_immunity_history', timeColumn: 'purchased_at' },
    { table: 'error_log', timeColumn: 'occurred_at' },
    { table: 'admin_logs', timeColumn: 'timestamp' }
  ];
  
  for (const { table, timeColumn } of historyTables) {
    try {
      // Check if table exists first
      const checkStmt = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`);
      checkStmt.bind([table]);
      const exists = checkStmt.step();
      checkStmt.free();
      
      if (!exists) {
        results[table] = { cleaned: 0, skipped: true };
        continue;
      }
      
      // Build delete query
      let deleteQuery = `DELETE FROM ${table} WHERE ${timeColumn} < ?`;
      const params = [cutoffTime];
      
      if (guildId && table !== 'transactions' && table !== 'price_history' && table !== 'error_log' && table !== 'admin_logs') {
        deleteQuery += ' AND guild_id = ?';
        params.push(guildId);
      }
      
      // Get count before deletion
      let countQuery = `SELECT COUNT(*) as count FROM ${table} WHERE ${timeColumn} < ?`;
      const countParams = [cutoffTime];
      if (guildId && table !== 'transactions' && table !== 'price_history' && table !== 'error_log' && table !== 'admin_logs') {
        countQuery += ' AND guild_id = ?';
        countParams.push(guildId);
      }
      
      const countStmt = db.prepare(countQuery);
      countStmt.bind(countParams);
      countStmt.step();
      const count = countStmt.getAsObject().count || 0;
      countStmt.free();
      
      // Execute deletion
      db.run(deleteQuery, params);
      
      results[table] = { cleaned: count };
      totalCleaned += count;
      
    } catch (e) {
      results[table] = { cleaned: 0, error: e.message };
    }
  }
  
  // Log the maintenance action
  try {
    db.run(`
      INSERT INTO maintenance_history (guild_id, action, records_affected, executed_at)
      VALUES (?, 'cleanup_history', ?, ?)
    `, [guildId, totalCleaned, Date.now()]);
  } catch (e) {
    // Non-critical
  }
  
  console.log(`🧹 Database cleanup completed: ${totalCleaned} records removed (retention: ${HISTORY_RETENTION_DAYS} days)`);
  
  return {
    success: true,
    totalCleaned,
    retentionDays: HISTORY_RETENTION_DAYS,
    details: results
  };
}

/**
 * Get database size statistics
 * @returns {Object} Size statistics
 */
function getDatabaseStats() {
  if (!db) return { success: false, error: 'Database not initialized' };
  
  const stats = {
    tables: {}
  };
  
  try {
    // Get list of all tables
    const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    if (tablesResult.length === 0) return stats;
    
    for (const row of tablesResult[0].values) {
      const tableName = row[0];
      try {
        const countResult = db.exec(`SELECT COUNT(*) as count FROM "${tableName}"`);
        if (countResult.length > 0) {
          stats.tables[tableName] = countResult[0].values[0][0];
        }
      } catch (e) {
        stats.tables[tableName] = 'error';
      }
    }
    
    // Sort by row count descending
    stats.tablesBySize = Object.entries(stats.tables)
      .filter(([, count]) => typeof count === 'number')
      .sort(([, a], [, b]) => b - a);
    
  } catch (e) {
    stats.error = e.message;
  }
  
  return stats;
}

// ============ COMMAND RATE LIMITING ============

/**
 * Get cooldown settings for a guild
 * @param {string} guildId - Guild ID
 * @returns {Object} Cooldown settings
 */
function getCommandCooldownSettings(guildId) {
  if (guildCooldownSettings.has(guildId)) {
    return guildCooldownSettings.get(guildId);
  }
  
  const settings = { ...DEFAULT_COMMAND_COOLDOWNS };
  
  if (db) {
    try {
      const result = db.exec('SELECT * FROM command_cooldown_settings WHERE guild_id = ?', [guildId]);
      if (result.length > 0) {
        for (const row of result[0].values) {
          const cols = result[0].columns;
          const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
          if (data.enabled) {
            settings[data.command_name] = data.cooldown_seconds;
          }
        }
      }
    } catch (e) {
      // Use defaults
    }
  }
  
  guildCooldownSettings.set(guildId, settings);
  return settings;
}

/**
 * Set a custom command cooldown for a guild
 * @param {string} guildId - Guild ID
 * @param {string} commandName - Command name
 * @param {number} cooldownSeconds - Cooldown in seconds
 * @returns {boolean} Success
 */
function setCommandCooldown(guildId, commandName, cooldownSeconds) {
  if (!db) return false;
  
  try {
    db.run(`
      INSERT OR REPLACE INTO command_cooldown_settings (guild_id, command_name, cooldown_seconds, enabled)
      VALUES (?, ?, ?, 1)
    `, [guildId, commandName, cooldownSeconds]);
    
    // Clear cache
    guildCooldownSettings.delete(guildId);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if a command is on cooldown for a user
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} commandName - Command name
 * @returns {Object} { onCooldown: boolean, remainingSeconds: number }
 */
function checkCommandCooldown(guildId, userId, commandName) {
  const settings = getCommandCooldownSettings(guildId);
  const cooldownSeconds = settings[commandName] ?? settings._default ?? 2;
  
  // No cooldown configured
  if (cooldownSeconds <= 0) {
    return { onCooldown: false, remainingSeconds: 0 };
  }
  
  // Initialize guild map if needed
  if (!commandCooldowns.has(guildId)) {
    commandCooldowns.set(guildId, new Map());
  }
  
  const guildCooldowns = commandCooldowns.get(guildId);
  
  // Initialize command map if needed
  if (!guildCooldowns.has(commandName)) {
    guildCooldowns.set(commandName, new Map());
  }
  
  const commandMap = guildCooldowns.get(commandName);
  const lastUsed = commandMap.get(userId) || 0;
  const now = Date.now();
  const cooldownMs = cooldownSeconds * 1000;
  
  if (now - lastUsed < cooldownMs) {
    const remainingMs = cooldownMs - (now - lastUsed);
    return {
      onCooldown: true,
      remainingSeconds: Math.ceil(remainingMs / 1000)
    };
  }
  
  return { onCooldown: false, remainingSeconds: 0 };
}

/**
 * Update the cooldown timestamp for a command
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} commandName - Command name
 */
function updateCommandCooldown(guildId, userId, commandName) {
  if (!commandCooldowns.has(guildId)) {
    commandCooldowns.set(guildId, new Map());
  }
  
  const guildCooldowns = commandCooldowns.get(guildId);
  
  if (!guildCooldowns.has(commandName)) {
    guildCooldowns.set(commandName, new Map());
  }
  
  guildCooldowns.get(commandName).set(userId, Date.now());
}

// ============ SCHEDULED MAINTENANCE ============

/**
 * Start the automatic cleanup scheduler
 * Runs daily at 4 AM server time
 */
function startCleanupScheduler() {
  // Run cleanup check every hour
  setInterval(() => {
    const now = new Date();
    // Run at 4 AM
    if (now.getHours() === 4 && now.getMinutes() < 5) {
      console.log('🧹 Running scheduled database cleanup...');
      const result = cleanupOldHistory();
      if (result.success) {
        console.log(`🧹 Scheduled cleanup complete: ${result.totalCleaned} old records removed`);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
  
  console.log('🧹 Database cleanup scheduler started (daily at 4 AM)');
}

// Export functions
module.exports = {
  initMaintenance,
  logError,
  getRecentErrors,
  getErrorsFromDb,
  cleanupOldHistory,
  getDatabaseStats,
  getCommandCooldownSettings,
  setCommandCooldown,
  checkCommandCooldown,
  updateCommandCooldown,
  startCleanupScheduler,
  HISTORY_RETENTION_DAYS,
  DEFAULT_COMMAND_COOLDOWNS
};
