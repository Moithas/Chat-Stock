// Hunt System - Random chance to find items, currency, or nothing
// Configurable via admin panel: cooldown, currency range, outcome weights

const { saveDatabase } = require('./database');

let db = null;

// Default hunt settings
const defaultSettings = {
  enabled: true,
  cooldownMinutes: 60,
  minCurrency: 50,
  maxCurrency: 300,
  // Outcome weights (must total to 100)
  itemChance: 15,      // % chance to find an item
  currencyChance: 50,  // % chance to find currency
  nothingChance: 35    // % chance to find nothing
};

function initHunt(database) {
  db = database;

  // Create hunt settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS hunt_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      cooldown_minutes INTEGER DEFAULT 60,
      min_currency INTEGER DEFAULT 50,
      max_currency INTEGER DEFAULT 300,
      item_chance INTEGER DEFAULT 15,
      currency_chance INTEGER DEFAULT 50,
      nothing_chance INTEGER DEFAULT 35
    )
  `);

  // Create hunt cooldown tracker table
  db.run(`
    CREATE TABLE IF NOT EXISTS hunt_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_hunt_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  // Create hunt history table
  db.run(`
    CREATE TABLE IF NOT EXISTS hunt_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      result_type TEXT NOT NULL,
      item_id INTEGER,
      item_name TEXT,
      currency_earned INTEGER DEFAULT 0,
      hunt_time INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_hunt_tracker_guild_user ON hunt_tracker(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_hunt_history_guild_user ON hunt_history(guild_id, user_id)`);

  saveDatabase();
  console.log('🏹 Hunt system initialized');
}

// ==================== SETTINGS ====================

function getHuntSettings(guildId) {
  if (!db) return { ...defaultSettings };

  const stmt = db.prepare(`SELECT * FROM hunt_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      enabled: row.enabled === 1,
      cooldownMinutes: row.cooldown_minutes ?? defaultSettings.cooldownMinutes,
      minCurrency: row.min_currency ?? defaultSettings.minCurrency,
      maxCurrency: row.max_currency ?? defaultSettings.maxCurrency,
      itemChance: row.item_chance ?? defaultSettings.itemChance,
      currencyChance: row.currency_chance ?? defaultSettings.currencyChance,
      nothingChance: row.nothing_chance ?? defaultSettings.nothingChance
    };
  }

  stmt.free();
  return { ...defaultSettings };
}

function updateHuntSettings(guildId, newSettings) {
  if (!db) return;

  const current = getHuntSettings(guildId);
  const merged = { ...current, ...newSettings };

  db.run(`INSERT OR REPLACE INTO hunt_settings 
    (guild_id, enabled, cooldown_minutes, min_currency, max_currency, item_chance, currency_chance, nothing_chance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, merged.enabled ? 1 : 0, merged.cooldownMinutes, merged.minCurrency, merged.maxCurrency,
     merged.itemChance, merged.currencyChance, merged.nothingChance]);

  saveDatabase();
}

// ==================== COOLDOWN ====================

function canHunt(guildId, userId) {
  if (!db) return { canHunt: true };

  const settings = getHuntSettings(guildId);
  const stmt = db.prepare(`SELECT last_hunt_time FROM hunt_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);

  if (!stmt.step()) {
    stmt.free();
    return { canHunt: true };
  }

  const row = stmt.getAsObject();
  stmt.free();
  const lastTime = row.last_hunt_time;
  const cooldownMs = settings.cooldownMinutes * 60 * 1000;
  const elapsed = Date.now() - lastTime;

  if (elapsed < cooldownMs) {
    const remaining = cooldownMs - elapsed;
    const mins = Math.ceil(remaining / 60000);
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    const timeStr = hours > 0 ? `${hours}h ${remainingMins}m` : `${mins}m`;
    return { canHunt: false, reason: `You're still resting from your last hunt! Try again in **${timeStr}**.` };
  }

  return { canHunt: true };
}

function recordHuntCooldown(guildId, userId) {
  if (!db) return;

  db.run(`INSERT OR REPLACE INTO hunt_tracker (guild_id, user_id, last_hunt_time) VALUES (?, ?, ?)`,
    [guildId, userId, Date.now()]);
  saveDatabase();
}

// ==================== HISTORY ====================

function recordHuntResult(guildId, userId, resultType, itemId = null, itemName = null, currencyEarned = 0) {
  if (!db) return;

  db.run(`INSERT INTO hunt_history (guild_id, user_id, result_type, item_id, item_name, currency_earned, hunt_time) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [guildId, userId, resultType, itemId, itemName, currencyEarned, Date.now()]);
  saveDatabase();
}

function getHuntStats(guildId, userId) {
  if (!db) return { totalHunts: 0, itemsFound: 0, currencyFound: 0, nothingCount: 0, totalCurrencyEarned: 0 };

  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total_hunts,
      COALESCE(SUM(CASE WHEN result_type = 'item' THEN 1 ELSE 0 END), 0) as items_found,
      COALESCE(SUM(CASE WHEN result_type = 'currency' THEN 1 ELSE 0 END), 0) as currency_found,
      COALESCE(SUM(CASE WHEN result_type = 'nothing' THEN 1 ELSE 0 END), 0) as nothing_count,
      COALESCE(SUM(currency_earned), 0) as total_currency_earned
    FROM hunt_history 
    WHERE guild_id = ? AND user_id = ?
  `);
  stmt.bind([guildId, userId]);

  if (!stmt.step()) {
    stmt.free();
    return { totalHunts: 0, itemsFound: 0, currencyFound: 0, nothingCount: 0, totalCurrencyEarned: 0 };
  }

  const row = stmt.getAsObject();
  stmt.free();
  return {
    totalHunts: row.total_hunts,
    itemsFound: row.items_found,
    currencyFound: row.currency_found,
    nothingCount: row.nothing_count,
    totalCurrencyEarned: row.total_currency_earned
  };
}

// ==================== HUNT LOGIC ====================

/**
 * Roll the hunt outcome based on configured weights.
 * Returns 'item', 'currency', or 'nothing'.
 */
function rollHuntOutcome(settings) {
  const total = settings.itemChance + settings.currencyChance + settings.nothingChance;
  const roll = Math.random() * total;

  if (roll < settings.itemChance) return 'item';
  if (roll < settings.itemChance + settings.currencyChance) return 'currency';
  return 'nothing';
}

/**
 * Roll a random currency amount between min and max.
 */
function rollCurrencyAmount(settings) {
  return Math.floor(Math.random() * (settings.maxCurrency - settings.minCurrency + 1)) + settings.minCurrency;
}

module.exports = {
  initHunt,
  getHuntSettings,
  updateHuntSettings,
  canHunt,
  recordHuntCooldown,
  recordHuntResult,
  getHuntStats,
  rollHuntOutcome,
  rollCurrencyAmount
};
