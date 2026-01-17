// Dividends & Stock Splits module for Chat-Stock
// Handles dividend payouts and user-controlled stock splits

let db = null;

const DEFAULT_SETTINGS = {
  // Dividends
  enabled: false,
  dividendRate: 0.5,           // % of stock price per payout
  payoutFrequency: 'daily',    // 'daily', 'weekly', or 'biweekly'
  dividendPayoutHour: 12,      // Hour of day to pay dividends (0-23, server time)
  minSharesForDividend: 1,     // Minimum shares to receive dividends
  minPriceForDividend: 100,    // Minimum stock price to pay dividends
  announcementChannelId: null, // Channel to announce dividend payouts
  
  // Self-Dividend Bonus (CEO bonus for stock owners)
  selfDividendEnabled: true,
  selfDividendRate: 5,         // % of total dividends paid out that goes to stock owner
  
  // Passive Income (collectible every X hours based on stock price)
  passiveIncomeEnabled: true,
  passiveIncomeRate: 0.1,      // % of stock price per collection
  passiveIncomeCooldown: 2,    // Hours between collections
  
  // Stock Splits
  splitsEnabled: true,
  splitMinPrice: 5000,         // Minimum price to allow split
  reverseSplitMaxPrice: 50,    // Maximum price to allow reverse split (0 = disabled)
  splitCooldownHours: 168      // 7 days between splits for same stock
};

// Cache for settings per guild
const guildDividendSettings = new Map();

function initDividends(database) {
  db = database;
  
  // Create dividend settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS dividend_settings (
      guild_id TEXT PRIMARY KEY,
      dividends_enabled INTEGER DEFAULT 0,
      dividend_rate REAL DEFAULT 0.5,
      dividend_frequency TEXT DEFAULT 'daily',
      dividend_payout_hour INTEGER DEFAULT 12,
      dividend_min_shares INTEGER DEFAULT 1,
      dividend_min_price INTEGER DEFAULT 100,
      announcement_channel_id TEXT,
      self_dividend_enabled INTEGER DEFAULT 1,
      self_dividend_rate REAL DEFAULT 5,
      passive_income_enabled INTEGER DEFAULT 1,
      passive_income_rate REAL DEFAULT 0.1,
      passive_income_cooldown INTEGER DEFAULT 2,
      splits_enabled INTEGER DEFAULT 1,
      split_min_price INTEGER DEFAULT 5000,
      reverse_split_max_price INTEGER DEFAULT 50,
      split_cooldown_hours INTEGER DEFAULT 168
    )
  `);
  
  // Migration: Add dividend_min_price column if it doesn't exist
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN dividend_min_price INTEGER DEFAULT 100`);
  } catch (e) {
    // Column already exists, ignore error
  }
  
  // Migration: Add self-dividend columns
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN self_dividend_enabled INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN self_dividend_rate REAL DEFAULT 5`);
  } catch (e) {}
  
  // Migration: Add passive income columns
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN passive_income_enabled INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN passive_income_rate REAL DEFAULT 0.1`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN passive_income_cooldown INTEGER DEFAULT 2`);
  } catch (e) {}
  
  // Migration: Add dividend payout hour
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN dividend_payout_hour INTEGER DEFAULT 12`);
  } catch (e) {}
  
  // Migration: Add announcement channel
  try {
    db.run(`ALTER TABLE dividend_settings ADD COLUMN announcement_channel_id TEXT`);
  } catch (e) {}
  
  // Create dividend history table
  db.run(`
    CREATE TABLE IF NOT EXISTS dividend_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      shareholder_id TEXT NOT NULL,
      shares INTEGER NOT NULL,
      stock_price REAL NOT NULL,
      dividend_amount INTEGER NOT NULL,
      payout_time INTEGER NOT NULL
    )
  `);
  
  // Create stock split history table
  db.run(`
    CREATE TABLE IF NOT EXISTS split_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      split_ratio TEXT NOT NULL,
      price_before REAL NOT NULL,
      price_after REAL NOT NULL,
      split_time INTEGER NOT NULL
    )
  `);
  
  // Create last dividend payout tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS dividend_tracker (
      guild_id TEXT PRIMARY KEY,
      last_payout_time INTEGER DEFAULT 0
    )
  `);
  
  // Create passive income collection tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS passive_income_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_collection_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create self-dividend history
  db.run(`
    CREATE TABLE IF NOT EXISTS self_dividend_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      total_dividends_paid INTEGER NOT NULL,
      bonus_amount INTEGER NOT NULL,
      payout_time INTEGER NOT NULL
    )
  `);
  
  // Create passive income history
  db.run(`
    CREATE TABLE IF NOT EXISTS passive_income_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      stock_price REAL NOT NULL,
      amount INTEGER NOT NULL,
      collection_time INTEGER NOT NULL
    )
  `);
  
  // Create role income settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS role_income_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 100,
      cooldown_hours INTEGER NOT NULL DEFAULT 24,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(guild_id, role_id)
    )
  `);
  
  // Create role income collection tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS role_income_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      last_collection_time INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, role_id)
    )
  `);
  
  // Create role income history
  db.run(`
    CREATE TABLE IF NOT EXISTS role_income_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      collection_time INTEGER NOT NULL
    )
  `);
  
  console.log('💰 Dividends & Splits system initialized');
}

// ============ SETTINGS ============

function getDividendSettings(guildId) {
  if (guildDividendSettings.has(guildId)) {
    return guildDividendSettings.get(guildId);
  }
  
  if (db) {
    const result = db.exec('SELECT * FROM dividend_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const settings = {
        enabled: row.dividends_enabled === 1,
        dividendRate: row.dividend_rate,
        payoutFrequency: row.dividend_frequency,
        dividendPayoutHour: row.dividend_payout_hour ?? 12,
        minSharesForDividend: row.dividend_min_shares,
        minPriceForDividend: row.dividend_min_price || 100,
        announcementChannelId: row.announcement_channel_id || null,
        selfDividendEnabled: row.self_dividend_enabled !== 0,
        selfDividendRate: row.self_dividend_rate ?? 5,
        passiveIncomeEnabled: row.passive_income_enabled !== 0,
        passiveIncomeRate: row.passive_income_rate ?? 0.1,
        passiveIncomeCooldown: row.passive_income_cooldown ?? 2,
        splitsEnabled: row.splits_enabled === 1,
        splitMinPrice: row.split_min_price,
        reverseSplitMaxPrice: row.reverse_split_max_price,
        splitCooldownHours: row.split_cooldown_hours
      };
      guildDividendSettings.set(guildId, settings);
      return settings;
    }
  }
  
  return { ...DEFAULT_SETTINGS };
}

function updateDividendSettings(guildId, updates) {
  if (!db) return;
  
  const current = getDividendSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO dividend_settings 
    (guild_id, dividends_enabled, dividend_rate, dividend_frequency, dividend_payout_hour, dividend_min_shares, dividend_min_price, announcement_channel_id,
     self_dividend_enabled, self_dividend_rate, passive_income_enabled, passive_income_rate, passive_income_cooldown,
     splits_enabled, split_min_price, reverse_split_max_price, split_cooldown_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.dividendRate,
    settings.payoutFrequency,
    settings.dividendPayoutHour,
    settings.minSharesForDividend,
    settings.minPriceForDividend,
    settings.announcementChannelId || null,
    settings.selfDividendEnabled ? 1 : 0,
    settings.selfDividendRate,
    settings.passiveIncomeEnabled ? 1 : 0,
    settings.passiveIncomeRate,
    settings.passiveIncomeCooldown,
    settings.splitsEnabled ? 1 : 0,
    settings.splitMinPrice,
    settings.reverseSplitMaxPrice,
    settings.splitCooldownHours
  ]);
  
  guildDividendSettings.set(guildId, settings);
}

// ============ DIVIDENDS ============

function getLastPayoutTime(guildId) {
  if (!db) return 0;
  
  const result = db.exec('SELECT last_payout_time FROM dividend_tracker WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  
  return 0;
}

function setLastPayoutTime(guildId, time) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO dividend_tracker (guild_id, last_payout_time)
    VALUES (?, ?)
  `, [guildId, time]);
}

function resetLastPayoutTime(guildId) {
  if (!db) return;
  
  // Set to 0 to allow immediate payout on next check
  db.run(`DELETE FROM dividend_tracker WHERE guild_id = ?`, [guildId]);
  console.log(`💰 Reset dividend payout timer for guild ${guildId}`);
}

function shouldPayDividends(guildId) {
  const settings = getDividendSettings(guildId);
  
  if (!settings.enabled) {
    return false;
  }
  
  const lastPayout = getLastPayoutTime(guildId);
  const now = new Date();
  const currentHour = now.getHours();
  
  // Debug: Show what hour we're checking
  console.log(`💰 Dividend check for guild ${guildId}: Current hour=${currentHour}, Payout hour=${settings.dividendPayoutHour}`);
  
  // Only pay during the configured payout hour
  if (currentHour !== settings.dividendPayoutHour) {
    return false;
  }
  
  // Check if enough time has passed since last payout
  let intervalMs;
  switch (settings.payoutFrequency) {
    case 'weekly':
      intervalMs = 7 * 24 * 60 * 60 * 1000;  // 7 days
      break;
    case 'biweekly':
      intervalMs = 14 * 24 * 60 * 60 * 1000; // 14 days
      break;
    default: // daily
      intervalMs = 24 * 60 * 60 * 1000;      // 1 day
  }
  
  // Use a slightly shorter interval (23 hours for daily) to account for timing drift
  const checkInterval = intervalMs - (60 * 60 * 1000); // 1 hour buffer
  const timeSinceLastPayout = now.getTime() - lastPayout;
  const shouldPay = timeSinceLastPayout >= checkInterval;
  
  // Debug: Show last payout info
  const lastPayoutDate = lastPayout > 0 ? new Date(lastPayout).toLocaleString() : 'Never';
  console.log(`💰 Last payout: ${lastPayoutDate}, Time since: ${Math.floor(timeSinceLastPayout / (60 * 60 * 1000))} hours`);
  
  if (!shouldPay) {
    const hoursUntilNext = Math.ceil((checkInterval - timeSinceLastPayout) / (60 * 60 * 1000));
    console.log(`💰 Dividend check: Not ready yet. ${hoursUntilNext} hours until next payout.`);
  } else {
    console.log(`💰 Dividend check: Ready to pay! Last payout was ${Math.floor(timeSinceLastPayout / (60 * 60 * 1000))} hours ago.`);
  }
  
  return shouldPay;
}

function calculateDividendPayout(stockPrice, shares, rate) {
  // rate is percentage (e.g., 0.5 = 0.5%)
  const dividendPerShare = stockPrice * (rate / 100);
  return Math.floor(dividendPerShare * shares);
}

function recordDividendPayout(guildId, stockUserId, shareholderId, shares, stockPrice, amount) {
  if (!db) return;
  
  db.run(`
    INSERT INTO dividend_history (guild_id, stock_user_id, shareholder_id, shares, stock_price, dividend_amount, payout_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guildId, stockUserId, shareholderId, shares, stockPrice, amount, Date.now()]);
}

function getDividendHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM dividend_history 
    WHERE guild_id = ? AND shareholder_id = ?
    ORDER BY payout_time DESC
    LIMIT ?
  `, [guildId, userId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getTotalDividendsReceived(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(`
    SELECT SUM(dividend_amount) as total FROM dividend_history 
    WHERE guild_id = ? AND shareholder_id = ?
  `, [guildId, userId]);
  
  if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]) {
    return result[0].values[0][0];
  }
  
  return 0;
}

function getStockDividendYield(stockPrice, rate) {
  // Annual yield for display (daily rate * 365 or weekly * 52)
  return rate; // Just return the configured rate per payout period
}

// ============ PASSIVE INCOME ============

function getLastPassiveIncomeCollection(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(
    'SELECT last_collection_time FROM passive_income_tracker WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  
  return 0;
}

function setLastPassiveIncomeCollection(guildId, userId, time) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO passive_income_tracker (guild_id, user_id, last_collection_time)
    VALUES (?, ?, ?)
  `, [guildId, userId, time]);
}

function canCollectPassiveIncome(guildId, userId) {
  const settings = getDividendSettings(guildId);
  
  if (!settings.passiveIncomeEnabled) {
    return { canCollect: false, reason: 'Stock Bonus is disabled on this server.', timeRemaining: 0 };
  }
  
  const lastCollection = getLastPassiveIncomeCollection(guildId, userId);
  const now = Date.now();
  const cooldownMs = settings.passiveIncomeCooldown * 60 * 60 * 1000;
  const timeSinceLastCollection = now - lastCollection;
  
  if (lastCollection > 0 && timeSinceLastCollection < cooldownMs) {
    const msRemaining = cooldownMs - timeSinceLastCollection;
    return { 
      canCollect: false, 
      reason: formatTimeRemaining(msRemaining),
      timeRemaining: msRemaining
    };
  }
  
  return { canCollect: true, reason: null, timeRemaining: 0 };
}

function formatTimeRemaining(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function calculatePassiveIncome(stockPrice, rate, totalSharesOwned = 0) {
  // rate is percentage (e.g., 0.1 = 0.1% of stock price)
  // Multiply by total shares owned by others (minimum 1 so you still get base income)
  const sharesMultiplier = Math.max(1, totalSharesOwned);
  return Math.floor(stockPrice * (rate / 100) * sharesMultiplier);
}

function recordPassiveIncomeCollection(guildId, userId, stockPrice, amount) {
  if (!db) return;
  
  db.run(`
    INSERT INTO passive_income_history (guild_id, user_id, stock_price, amount, collection_time)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, userId, stockPrice, amount, Date.now()]);
  
  setLastPassiveIncomeCollection(guildId, userId, Date.now());
}

function getPassiveIncomeHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM passive_income_history 
    WHERE guild_id = ? AND user_id = ?
    ORDER BY collection_time DESC
    LIMIT ?
  `, [guildId, userId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getTotalPassiveIncomeCollected(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(`
    SELECT SUM(amount) as total FROM passive_income_history 
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, userId]);
  
  if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]) {
    return result[0].values[0][0];
  }
  
  return 0;
}

// ============ ROLE INCOME ============

function getRoleIncomes(guildId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM role_income_settings 
    WHERE guild_id = ?
    ORDER BY created_at ASC
  `, [guildId]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getRoleIncome(guildId, roleId) {
  if (!db) return null;
  
  const result = db.exec(`
    SELECT * FROM role_income_settings 
    WHERE guild_id = ? AND role_id = ?
  `, [guildId, roleId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

function addRoleIncome(guildId, roleId, roleName, amount, cooldownHours) {
  if (!db) return false;
  
  try {
    db.run(`
      INSERT OR REPLACE INTO role_income_settings (guild_id, role_id, role_name, amount, cooldown_hours, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `, [guildId, roleId, roleName, amount, cooldownHours, Date.now()]);
    return true;
  } catch (err) {
    console.error('Failed to add role income:', err);
    return false;
  }
}

function updateRoleIncome(guildId, roleId, updates) {
  if (!db) return false;
  
  const current = getRoleIncome(guildId, roleId);
  if (!current) return false;
  
  const amount = updates.amount ?? current.amount;
  const cooldownHours = updates.cooldown_hours ?? current.cooldown_hours;
  const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : current.enabled;
  const roleName = updates.role_name ?? current.role_name;
  
  try {
    db.run(`
      UPDATE role_income_settings 
      SET amount = ?, cooldown_hours = ?, enabled = ?, role_name = ?
      WHERE guild_id = ? AND role_id = ?
    `, [amount, cooldownHours, enabled, roleName, guildId, roleId]);
    return true;
  } catch (err) {
    console.error('Failed to update role income:', err);
    return false;
  }
}

function removeRoleIncome(guildId, roleId) {
  if (!db) return false;
  
  try {
    db.run(`DELETE FROM role_income_settings WHERE guild_id = ? AND role_id = ?`, [guildId, roleId]);
    db.run(`DELETE FROM role_income_tracker WHERE guild_id = ? AND role_id = ?`, [guildId, roleId]);
    return true;
  } catch (err) {
    console.error('Failed to remove role income:', err);
    return false;
  }
}

function toggleRoleIncome(guildId, roleId) {
  if (!db) return false;
  
  const current = getRoleIncome(guildId, roleId);
  if (!current) return false;
  
  const newEnabled = current.enabled === 1 ? 0 : 1;
  
  try {
    db.run(`
      UPDATE role_income_settings SET enabled = ?
      WHERE guild_id = ? AND role_id = ?
    `, [newEnabled, guildId, roleId]);
    return newEnabled === 1;
  } catch (err) {
    console.error('Failed to toggle role income:', err);
    return false;
  }
}

function getLastRoleIncomeCollection(guildId, userId, roleId) {
  if (!db) return 0;
  
  const result = db.exec(
    'SELECT last_collection_time FROM role_income_tracker WHERE guild_id = ? AND user_id = ? AND role_id = ?',
    [guildId, userId, roleId]
  );
  
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  
  return 0;
}

function canCollectRoleIncome(guildId, userId, roleId) {
  const roleIncome = getRoleIncome(guildId, roleId);
  
  if (!roleIncome || roleIncome.enabled !== 1) {
    return { canCollect: false, reason: 'This role income is disabled.', timeRemaining: 0 };
  }
  
  const lastCollection = getLastRoleIncomeCollection(guildId, userId, roleId);
  const now = Date.now();
  const cooldownMs = roleIncome.cooldown_hours * 60 * 60 * 1000;
  const timeSinceLastCollection = now - lastCollection;
  
  if (lastCollection > 0 && timeSinceLastCollection < cooldownMs) {
    const msRemaining = cooldownMs - timeSinceLastCollection;
    return { 
      canCollect: false, 
      reason: `You can collect again in **${formatTimeRemaining(msRemaining)}**`,
      timeRemaining: msRemaining
    };
  }
  
  return { canCollect: true, reason: null, timeRemaining: 0, roleIncome };
}

function recordRoleIncomeCollection(guildId, userId, roleId, roleName, amount) {
  if (!db) return;
  
  const now = Date.now();
  
  db.run(`
    INSERT OR REPLACE INTO role_income_tracker (guild_id, user_id, role_id, last_collection_time)
    VALUES (?, ?, ?, ?)
  `, [guildId, userId, roleId, now]);
  
  db.run(`
    INSERT INTO role_income_history (guild_id, user_id, role_id, role_name, amount, collection_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, userId, roleId, roleName, amount, now]);
}

function getRoleIncomeHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM role_income_history 
    WHERE guild_id = ? AND user_id = ?
    ORDER BY collection_time DESC
    LIMIT ?
  `, [guildId, userId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getTotalRoleIncomeCollected(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(`
    SELECT SUM(amount) as total FROM role_income_history 
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, userId]);
  
  if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]) {
    return result[0].values[0][0];
  }
  
  return 0;
}

function getCollectableRoleIncomes(guildId, userId, userRoleIds) {
  // Get all role incomes for this guild that the user has
  const allRoleIncomes = getRoleIncomes(guildId);
  const collectableIncomes = [];
  const notReadyIncomes = [];
  
  for (const roleIncome of allRoleIncomes) {
    if (roleIncome.enabled !== 1) continue;
    if (!userRoleIds.includes(roleIncome.role_id)) continue;
    
    const { canCollect, timeRemaining } = canCollectRoleIncome(guildId, userId, roleIncome.role_id);
    
    if (canCollect) {
      collectableIncomes.push({
        roleId: roleIncome.role_id,
        roleName: roleIncome.role_name,
        amount: roleIncome.amount,
        cooldownHours: roleIncome.cooldown_hours
      });
    } else {
      notReadyIncomes.push({
        roleId: roleIncome.role_id,
        roleName: roleIncome.role_name,
        amount: roleIncome.amount,
        timeRemaining
      });
    }
  }
  
  return { collectableIncomes, notReadyIncomes };
}

// ============ SELF-DIVIDEND BONUS ============

function calculateSelfDividendBonus(totalDividendsPaid, totalSharesOwned, rate) {
  // rate is percentage (e.g., 5 = 5% of total dividends paid out)
  // Also factor in total shares owned - more shares = bigger bonus
  const baseBonus = totalDividendsPaid * (rate / 100);
  // Add 0.5% bonus per 100 shares owned (capped at double)
  const sharesMultiplier = Math.min(1 + (totalSharesOwned / 100) * 0.005, 2);
  return Math.floor(baseBonus * sharesMultiplier);
}

function recordSelfDividendBonus(guildId, stockUserId, totalDividendsPaid, bonusAmount) {
  if (!db) return;
  
  db.run(`
    INSERT INTO self_dividend_history (guild_id, stock_user_id, total_dividends_paid, bonus_amount, payout_time)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, stockUserId, totalDividendsPaid, bonusAmount, Date.now()]);
}

function getSelfDividendHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM self_dividend_history 
    WHERE guild_id = ? AND stock_user_id = ?
    ORDER BY payout_time DESC
    LIMIT ?
  `, [guildId, userId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getTotalSelfDividendsReceived(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(`
    SELECT SUM(bonus_amount) as total FROM self_dividend_history 
    WHERE guild_id = ? AND stock_user_id = ?
  `, [guildId, userId]);
  
  if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]) {
    return result[0].values[0][0];
  }
  
  return 0;
}

// ============ STOCK SPLITS ============

function getLastSplitTime(guildId, stockUserId) {
  if (!db) return 0;
  
  const result = db.exec(`
    SELECT split_time FROM split_history 
    WHERE guild_id = ? AND stock_user_id = ?
    ORDER BY split_time DESC
    LIMIT 1
  `, [guildId, stockUserId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  
  return 0;
}

function canSplit(guildId, stockUserId, currentPrice) {
  const settings = getDividendSettings(guildId);
  
  if (!settings.splitsEnabled) {
    return { canSplit: false, reason: 'Stock splits are disabled on this server.' };
  }
  
  if (currentPrice < settings.splitMinPrice) {
    return { 
      canSplit: false, 
      reason: `Stock price must be at least **${settings.splitMinPrice.toLocaleString()}** to split. Current: **${Math.round(currentPrice).toLocaleString()}**`
    };
  }
  
  // Check cooldown
  const lastSplit = getLastSplitTime(guildId, stockUserId);
  const cooldownMs = settings.splitCooldownHours * 60 * 60 * 1000;
  const timeSinceLastSplit = Date.now() - lastSplit;
  
  if (lastSplit > 0 && timeSinceLastSplit < cooldownMs) {
    const hoursRemaining = Math.ceil((cooldownMs - timeSinceLastSplit) / (60 * 60 * 1000));
    return { 
      canSplit: false, 
      reason: `You must wait **${hoursRemaining} hours** before splitting again.`
    };
  }
  
  return { canSplit: true, reason: null };
}

function canReverseSplit(guildId, stockUserId, currentPrice) {
  const settings = getDividendSettings(guildId);
  
  if (!settings.splitsEnabled) {
    return { canSplit: false, reason: 'Stock splits are disabled on this server.' };
  }
  
  if (settings.reverseSplitMaxPrice === 0) {
    return { canSplit: false, reason: 'Reverse splits are disabled on this server.' };
  }
  
  if (currentPrice > settings.reverseSplitMaxPrice) {
    return { 
      canSplit: false, 
      reason: `Stock price must be below **${settings.reverseSplitMaxPrice}** for reverse split. Current: **${Math.round(currentPrice).toLocaleString()}**`
    };
  }
  
  // Check cooldown
  const lastSplit = getLastSplitTime(guildId, stockUserId);
  const cooldownMs = settings.splitCooldownHours * 60 * 60 * 1000;
  const timeSinceLastSplit = Date.now() - lastSplit;
  
  if (lastSplit > 0 && timeSinceLastSplit < cooldownMs) {
    const hoursRemaining = Math.ceil((cooldownMs - timeSinceLastSplit) / (60 * 60 * 1000));
    return { 
      canSplit: false, 
      reason: `You must wait **${hoursRemaining} hours** before splitting again.`
    };
  }
  
  return { canSplit: true, reason: null };
}

function executeSplit(guildId, stockUserId, ratio, currentPrice, getAllStockHolders, updateShares, adjustAvgBuyPrice = null) {
  // ratio is like "2:1" meaning 2 new shares for every 1 old share
  const [newShares, oldShares] = ratio.split(':').map(Number);
  const multiplier = newShares / oldShares;
  
  // Get all shareholders of this stock
  const shareholders = getAllStockHolders(stockUserId);
  
  // Update each shareholder's shares
  for (const holder of shareholders) {
    const newShareCount = Math.floor(holder.shares * multiplier);
    updateShares(holder.ownerId, stockUserId, newShareCount);
  }
  
  // Adjust avg_buy_price for all holders (divide by multiplier to keep P/L accurate)
  // When shares multiply, the cost basis per share should decrease proportionally
  if (adjustAvgBuyPrice) {
    adjustAvgBuyPrice(stockUserId, multiplier);
  }
  
  // Calculate new price (inverse of share multiplier)
  const newPrice = currentPrice / multiplier;
  
  // Record the split
  db.run(`
    INSERT INTO split_history (guild_id, stock_user_id, split_ratio, price_before, price_after, split_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, stockUserId, ratio, currentPrice, newPrice, Date.now()]);
  
  return {
    ratio,
    multiplier,
    priceBefore: currentPrice,
    priceAfter: newPrice,
    shareholdersAffected: shareholders.length
  };
}

function executeReverseSplit(guildId, stockUserId, ratio, currentPrice, getAllStockHolders, updateShares, adjustAvgBuyPrice = null) {
  // ratio is like "1:2" meaning 1 new share for every 2 old shares
  const [newShares, oldShares] = ratio.split(':').map(Number);
  const multiplier = newShares / oldShares;
  
  // Get all shareholders of this stock
  const shareholders = getAllStockHolders(stockUserId);
  
  // Update each shareholder's shares (rounding down)
  for (const holder of shareholders) {
    const newShareCount = Math.floor(holder.shares * multiplier);
    if (newShareCount > 0) {
      updateShares(holder.ownerId, stockUserId, newShareCount);
    } else {
      // If they'd have 0 shares, remove their holding entirely
      updateShares(holder.ownerId, stockUserId, 0);
    }
  }
  
  // Adjust avg_buy_price for all holders (divide by multiplier to keep P/L accurate)
  // When shares decrease, the cost basis per share should increase proportionally
  if (adjustAvgBuyPrice) {
    adjustAvgBuyPrice(stockUserId, multiplier);
  }
  
  // Calculate new price (inverse of share multiplier)
  const newPrice = currentPrice / multiplier;
  
  // Record the split
  db.run(`
    INSERT INTO split_history (guild_id, stock_user_id, split_ratio, price_before, price_after, split_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, stockUserId, ratio, currentPrice, newPrice, Date.now()]);
  
  return {
    ratio,
    multiplier,
    priceBefore: currentPrice,
    priceAfter: newPrice,
    shareholdersAffected: shareholders.length
  };
}

function getSplitHistory(guildId, stockUserId, limit = 5) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM split_history 
    WHERE guild_id = ? AND stock_user_id = ?
    ORDER BY split_time DESC
    LIMIT ?
  `, [guildId, stockUserId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get all users who split within a time range (for excluding from dashboard losers)
function getRecentSplitters(sinceTimestamp) {
  if (!db) return new Set();
  
  const result = db.exec(`
    SELECT DISTINCT stock_user_id FROM split_history 
    WHERE split_time >= ?
  `, [sinceTimestamp]);
  
  if (result.length === 0) return new Set();
  
  return new Set(result[0].values.map(row => row[0]));
}

// ============ DIVIDEND SCHEDULER ============

let dividendSchedulerInterval = null;

function startDividendScheduler(client) {
  // Clear any existing scheduler
  if (dividendSchedulerInterval) {
    clearInterval(dividendSchedulerInterval);
  }
  
  // Function to process dividends
  const processDividends = async () => {
    if (!client || !client.guilds) return;
    
    for (const guild of client.guilds.cache.values()) {
      try {
        const guildId = guild.id;
        
        if (!shouldPayDividends(guildId)) continue;
        
        const settings = getDividendSettings(guildId);
        if (!settings.enabled) continue;
        
        console.log(`💰 Processing dividend payouts for guild ${guild.name}`);
        
        // Import required database functions
        const { getAllUsers, getAllStockHolders, calculateStockPrice } = require('./database');
        const { addToBank } = require('./economy');
        
        // Helper function to delay between API calls
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        // Get all unique stock users
        const allUsers = getAllUsers();
        if (!allUsers || allUsers.length === 0) {
          console.log(`💰 No users found for dividend payouts in ${guild.name}`);
          setLastPayoutTime(guildId, Date.now());
          continue;
        }
        
        let totalPaid = 0;
        let payoutsCount = 0;
        let failedPayouts = 0;
        
        // Track dividends per stock for self-dividend bonus
        const stockDividendTotals = new Map(); // stockUserId -> { totalPaid, totalShares }
        
        for (const stockUser of allUsers) {
          try {
            // Defensive check - ensure stockUser has required properties
            if (!stockUser || !stockUser.user_id) {
              console.error('Invalid stockUser object:', stockUser);
              continue;
            }
            
            const stockPrice = calculateStockPrice(stockUser.user_id, guildId);
            
            // Skip stocks below minimum price threshold
            if (stockPrice < settings.minPriceForDividend) continue;
            
            const shareholders = getAllStockHolders(stockUser.user_id);
            if (!shareholders || shareholders.length === 0) continue;
            
            for (const holder of shareholders) {
              try {
                // Defensive check - ensure holder has required properties
                if (!holder || !holder.ownerId || typeof holder.shares !== 'number') {
                  console.error('Invalid holder object:', holder);
                  continue;
                }
                
                if (holder.shares < settings.minSharesForDividend) continue;
                
                const payout = calculateDividendPayout(stockPrice, holder.shares, settings.dividendRate);
                if (payout <= 0) continue;
                
                // Add delay between API calls to avoid rate limiting (500ms)
                await delay(500);
                
                // Try to pay with retry on rate limit
                let retries = 3;
                let success = false;
                while (retries > 0 && !success) {
                  try {
                    await addToBank(guildId, holder.ownerId, payout, `Dividend from ${stockUser.username || 'Unknown'}'s stock`);
                    success = true;
                  } catch (apiError) {
                    if (apiError.status === 429 && retries > 1) {
                      // Rate limited - wait and retry
                      const retryAfter = apiError.response?.data?.retry_after || 2000;
                      console.log(`Rate limited, waiting ${retryAfter}ms before retry...`);
                      await delay(retryAfter);
                      retries--;
                    } else {
                      throw apiError;
                    }
                  }
                }
                
                if (success) {
                  recordDividendPayout(guildId, stockUser.user_id, holder.ownerId, holder.shares, stockPrice, payout);
                  totalPaid += payout;
                  payoutsCount++;
                  
                  // Track for self-dividend bonus
                  if (!stockDividendTotals.has(stockUser.user_id)) {
                    stockDividendTotals.set(stockUser.user_id, { totalPaid: 0, totalShares: 0 });
                  }
                  const stockData = stockDividendTotals.get(stockUser.user_id);
                  stockData.totalPaid += payout;
                  stockData.totalShares += holder.shares;
                }
              } catch (holderError) {
                failedPayouts++;
                console.error(`Failed to pay dividend to ${holder?.ownerId || 'unknown'}:`, holderError.message);
              }
            }
          } catch (stockError) {
            console.error(`Error processing stock ${stockUser?.user_id || 'unknown'}:`, stockError.message);
          }
        }
        
        if (payoutsCount > 0 || failedPayouts > 0) {
          console.log(`💰 Paid ${totalPaid.toLocaleString()} in dividends to ${payoutsCount} shareholders in ${guild.name}${failedPayouts > 0 ? ` (${failedPayouts} failed)` : ''}`);
        }
        
        // Pay self-dividend bonuses to stock owners (CEO bonus)
        let selfDividendsPaid = 0;
        let selfDividendsCount = 0;
        
        if (settings.selfDividendEnabled && stockDividendTotals.size > 0) {
          for (const [stockUserId, data] of stockDividendTotals) {
            try {
              if (data.totalPaid <= 0) continue;
              
              const bonus = calculateSelfDividendBonus(data.totalPaid, data.totalShares, settings.selfDividendRate);
              if (bonus <= 0) continue;
              
              await delay(500);
              
              let retries = 3;
              let success = false;
              while (retries > 0 && !success) {
                try {
                  await addToBank(guildId, stockUserId, bonus, `CEO Bonus: ${settings.selfDividendRate}% of dividends paid on your stock`);
                  success = true;
                } catch (apiError) {
                  if (apiError.status === 429 && retries > 1) {
                    const retryAfter = apiError.response?.data?.retry_after || 2000;
                    await delay(retryAfter);
                    retries--;
                  } else {
                    throw apiError;
                  }
                }
              }
              
              if (success) {
                recordSelfDividendBonus(guildId, stockUserId, data.totalPaid, bonus);
                selfDividendsPaid += bonus;
                selfDividendsCount++;
              }
            } catch (err) {
              console.error(`Failed to pay self-dividend to ${stockUserId}:`, err.message);
            }
          }
          
          if (selfDividendsCount > 0) {
            console.log(`🎩 Paid ${selfDividendsPaid.toLocaleString()} in CEO bonuses to ${selfDividendsCount} stock owners in ${guild.name}`);
          }
        }
        
        // Send announcement if channel is configured
        if ((payoutsCount > 0 || selfDividendsCount > 0) && settings.announcementChannelId) {
          try {
            const channel = await client.channels.fetch(settings.announcementChannelId);
            if (channel && channel.isTextBased()) {
              const { EmbedBuilder } = require('discord.js');
              
              const summaryText = [];
              if (payoutsCount > 0) {
                summaryText.push(`💰 **${totalPaid.toLocaleString()}** paid to **${payoutsCount}** shareholders`);
              }
              if (failedPayouts > 0) {
                summaryText.push(`⚠️ **${failedPayouts}** failed payouts`);
              }
              if (selfDividendsCount > 0) {
                summaryText.push(`🎩 **${selfDividendsPaid.toLocaleString()}** in CEO bonuses to **${selfDividendsCount}** stock owners`);
              }
              
              const embed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('📈 Dividend Payout Complete!')
                .setDescription(summaryText.join('\n'))
                .addFields(
                  { name: '📊 Dividend Rate', value: `${settings.dividendRate}%`, inline: true },
                  { name: '⏰ Frequency', value: settings.payoutFrequency.charAt(0).toUpperCase() + settings.payoutFrequency.slice(1), inline: true },
                  { name: '🏢 Server', value: guild.name, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Chat Stock Dividend System' });
              
              await channel.send({ embeds: [embed] });
            }
          } catch (announcementError) {
            console.error(`Failed to send dividend announcement:`, announcementError.message);
          }
        }
        
        setLastPayoutTime(guildId, Date.now());
        
      } catch (error) {
        console.error(`Error processing dividends for guild ${guild.id}:`, error);
      }
    }
  };
  
  // Run immediately on startup (in case we're in the payout hour)
  setTimeout(() => {
    const now = new Date();
    console.log(`💰 Running initial dividend check...`);
    console.log(`💰 Server time: ${now.toLocaleString()} (Hour: ${now.getHours()})`);
    console.log(`💰 Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    processDividends();
  }, 5000); // Wait 5 seconds for bot to fully initialize
  
  // Check every 5 minutes to ensure we don't miss the payout hour window
  dividendSchedulerInterval = setInterval(processDividends, 5 * 60 * 1000);
  
  console.log('💰 Dividend scheduler started (checks every 5 minutes)');
}

module.exports = {
  initDividends,
  getDividendSettings,
  updateDividendSettings,
  // Dividends
  shouldPayDividends,
  calculateDividendPayout,
  recordDividendPayout,
  getDividendHistory,
  getTotalDividendsReceived,
  getStockDividendYield,
  getLastPayoutTime,
  setLastPayoutTime,
  resetLastPayoutTime,
  // Passive Income
  canCollectPassiveIncome,
  calculatePassiveIncome,
  recordPassiveIncomeCollection,
  getPassiveIncomeHistory,
  getTotalPassiveIncomeCollected,
  getLastPassiveIncomeCollection,
  // Role Income
  getRoleIncomes,
  getRoleIncome,
  addRoleIncome,
  updateRoleIncome,
  removeRoleIncome,
  toggleRoleIncome,
  canCollectRoleIncome,
  recordRoleIncomeCollection,
  getRoleIncomeHistory,
  getTotalRoleIncomeCollected,
  getCollectableRoleIncomes,
  // Self-Dividend Bonus
  calculateSelfDividendBonus,
  getSelfDividendHistory,
  getTotalSelfDividendsReceived,
  // Splits
  canSplit,
  canReverseSplit,
  executeSplit,
  executeReverseSplit,
  getSplitHistory,
  getLastSplitTime,
  getRecentSplitters,
  // Scheduler
  startDividendScheduler
};
