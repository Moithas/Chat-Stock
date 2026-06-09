// Prestige System — Core Module
// Handles tiers, multipliers, resets, and prestige execution

const { saveDatabase } = require('./database');

let db = null;

// ============ TIER DEFINITIONS ============
const PRESTIGE_TIERS = [
  { level: 1, name: 'Bronze',   emoji: '<:BronzeStar:1486777990292570205>',   color: 0xCD7F32, cost: 100_000_000,       startingBonus: 25_000 },
  { level: 2, name: 'Silver',   emoji: '<:SilverStar:1486778060312281350>',   color: 0xC0C0C0, cost: 500_000_000,       startingBonus: 50_000 },
  { level: 3, name: 'Gold',     emoji: '<:GoldStar:1486778119162691825>',     color: 0xFFD700, cost: 1_500_000_000,     startingBonus: 100_000 },
  { level: 4, name: 'Platinum', emoji: '<:PlatinumStar:1486778158094221403>', color: 0xE5E4E2, cost: 5_000_000_000,     startingBonus: 250_000 },
  { level: 5, name: 'Diamond',  emoji: '<:DiamondStar:1486778188024774866>',  color: 0xB9F2FF, cost: 150_000_000_000,   startingBonus: 500_000 }
];

const INCOME_MULTIPLIER_PER_TIER = 0.05;  // +5% per tier
const XP_MULTIPLIER_PER_TIER = 0.10;      // +10% per tier
const BORROW_MULTIPLIER_PER_TIER = 1.00;  // +100% per tier (2x/3x/4x/5x/6x)
const PRESTIGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

// ============ INITIALIZATION ============
function initPrestige(database) {
  db = database;

  db.run(`
    CREATE TABLE IF NOT EXISTS prestige (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      prestige_level INTEGER DEFAULT 0,
      prestige_time INTEGER DEFAULT 0,
      total_prestiges INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prestige_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      from_level INTEGER NOT NULL,
      to_level INTEGER NOT NULL,
      total_wealth_at_prestige INTEGER NOT NULL,
      prestige_time INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_prestige_guild_user ON prestige(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_prestige_history_guild ON prestige_history(guild_id, user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS prestige_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      cooldown_days INTEGER DEFAULT 7,
      income_multiplier_per_tier REAL DEFAULT 0.05,
      xp_multiplier_per_tier REAL DEFAULT 0.10,
      borrow_multiplier_per_tier REAL DEFAULT 1.00
    )
  `);

  saveDatabase();
  console.log('🎖️ Prestige system initialized');
}

// ============ GETTERS ============
function getPrestigeLevel(guildId, userId) {
  if (!db) return 0;
  const stmt = db.prepare('SELECT prestige_level FROM prestige WHERE guild_id = ? AND user_id = ?');
  stmt.bind([guildId, userId]);
  if (stmt.step()) {
    const level = stmt.getAsObject().prestige_level || 0;
    stmt.free();
    return level;
  }
  stmt.free();
  return 0;
}

function getPrestigeData(guildId, userId) {
  if (!db) return { level: 0, time: 0, totalPrestiges: 0 };
  const stmt = db.prepare('SELECT * FROM prestige WHERE guild_id = ? AND user_id = ?');
  stmt.bind([guildId, userId]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      level: row.prestige_level || 0,
      time: row.prestige_time || 0,
      totalPrestiges: row.total_prestiges || 0
    };
  }
  stmt.free();
  return { level: 0, time: 0, totalPrestiges: 0 };
}

function getPrestigeSettings(guildId) {
  if (!db) return getDefaultSettings();
  const stmt = db.prepare('SELECT * FROM prestige_settings WHERE guild_id = ?');
  stmt.bind([guildId]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      enabled: row.enabled !== 0,
      cooldownDays: row.cooldown_days ?? 7,
      incomeMultiplierPerTier: row.income_multiplier_per_tier ?? INCOME_MULTIPLIER_PER_TIER,
      xpMultiplierPerTier: row.xp_multiplier_per_tier ?? XP_MULTIPLIER_PER_TIER,
      borrowMultiplierPerTier: row.borrow_multiplier_per_tier ?? BORROW_MULTIPLIER_PER_TIER
    };
  }
  stmt.free();
  return getDefaultSettings();
}

function getDefaultSettings() {
  return {
    enabled: true,
    cooldownDays: 7,
    incomeMultiplierPerTier: INCOME_MULTIPLIER_PER_TIER,
    xpMultiplierPerTier: XP_MULTIPLIER_PER_TIER,
    borrowMultiplierPerTier: BORROW_MULTIPLIER_PER_TIER
  };
}

function updatePrestigeSettings(guildId, settings) {
  if (!db) return;
  db.run(`
    INSERT INTO prestige_settings (guild_id, enabled, cooldown_days, income_multiplier_per_tier, xp_multiplier_per_tier, borrow_multiplier_per_tier)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled = ?,
      cooldown_days = ?,
      income_multiplier_per_tier = ?,
      xp_multiplier_per_tier = ?,
      borrow_multiplier_per_tier = ?
  `, [
    guildId,
    settings.enabled ? 1 : 0, settings.cooldownDays,
    settings.incomeMultiplierPerTier, settings.xpMultiplierPerTier, settings.borrowMultiplierPerTier,
    settings.enabled ? 1 : 0, settings.cooldownDays,
    settings.incomeMultiplierPerTier, settings.xpMultiplierPerTier, settings.borrowMultiplierPerTier
  ]);
  saveDatabase();
}

// ============ TIER HELPERS ============
function getTierInfo(level) {
  if (level < 1 || level > PRESTIGE_TIERS.length) return null;
  return PRESTIGE_TIERS[level - 1];
}

function getNextTier(currentLevel) {
  if (currentLevel >= PRESTIGE_TIERS.length) return null;
  return PRESTIGE_TIERS[currentLevel]; // 0-indexed: currentLevel=0 → tier[0]=Bronze
}

function getPrestigeBadge(level) {
  if (level <= 0) return '';
  const tier = getTierInfo(level);
  return tier ? `${tier.emoji} ${tier.name}` : '';
}

function getPrestigeEmoji(guildId, userId) {
  const level = getPrestigeLevel(guildId, userId);
  const tier = getTierInfo(level);
  return tier ? tier.emoji : '🎖️';
}

// ============ MULTIPLIER CALCULATIONS ============
function getIncomeMultiplier(guildId, userId) {
  const level = getPrestigeLevel(guildId, userId);
  if (level <= 0) return 1.0;
  const settings = getPrestigeSettings(guildId);
  return 1 + (level * settings.incomeMultiplierPerTier);
}

function getXpMultiplier(guildId, userId) {
  const level = getPrestigeLevel(guildId, userId);
  if (level <= 0) return 1.0;
  const settings = getPrestigeSettings(guildId);
  return 1 + (level * settings.xpMultiplierPerTier);
}

function getBorrowMultiplier(guildId, userId) {
  const level = getPrestigeLevel(guildId, userId);
  if (level <= 0) return 1.0;
  const settings = getPrestigeSettings(guildId);
  return 1 + (level * settings.borrowMultiplierPerTier);
}

// Apply prestige income multiplier to an amount (positive only)
function applyIncomeMultiplier(guildId, userId, amount) {
  if (amount <= 0) return amount; // Don't multiply losses
  const multiplier = getIncomeMultiplier(guildId, userId);
  return Math.floor(amount * multiplier);
}

// Apply prestige XP multiplier
function applyXpMultiplier(guildId, userId, xpGained) {
  if (xpGained <= 0) return xpGained;
  const multiplier = getXpMultiplier(guildId, userId);
  return Math.floor(xpGained * multiplier);
}

// Apply prestige borrow limit multiplier
function applyBorrowMultiplier(guildId, userId, maxLoan) {
  const multiplier = getBorrowMultiplier(guildId, userId);
  return Math.floor(maxLoan * multiplier);
}

// ============ PRESTIGE ELIGIBILITY ============
function canPrestige(guildId, userId, totalWealth) {
  const data = getPrestigeData(guildId, userId);
  const settings = getPrestigeSettings(guildId);
  const nextTier = getNextTier(data.level);

  if (!settings.enabled) {
    return { eligible: false, reason: 'Prestige system is currently disabled.' };
  }

  if (!nextTier) {
    return { eligible: false, reason: 'You have reached the maximum prestige tier!' };
  }

  // Cooldown check
  if (data.time > 0) {
    const cooldownMs = settings.cooldownDays * 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - data.time;
    if (elapsed < cooldownMs) {
      const remaining = cooldownMs - elapsed;
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      return { eligible: false, reason: `Prestige cooldown: **${days}d ${hours}h** remaining.` };
    }
  }

  if (totalWealth < nextTier.cost) {
    const deficit = nextTier.cost - totalWealth;
    return { 
      eligible: false, 
      reason: `You need **${nextTier.cost.toLocaleString()}** total wealth for ${nextTier.emoji} ${nextTier.name}. You're **${deficit.toLocaleString()}** short.`
    };
  }

  return { eligible: true, nextTier };
}

// ============ EXECUTE PRESTIGE ============
function executePrestige(guildId, userId, totalWealth) {
  if (!db) return { success: false, error: 'Database not available' };

  const data = getPrestigeData(guildId, userId);
  const nextTier = getNextTier(data.level);
  if (!nextTier) return { success: false, error: 'Already at max prestige' };

  const newLevel = nextTier.level;
  const now = Date.now();

  // ===== RESET PHASE =====

  // 1. Reset balance (will be set to starting bonus after)
  db.run('UPDATE balances SET cash = 0, bank = 0 WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  // 2. Delete stock holdings (only stocks THIS user owns, NOT others' shares of their stock)
  db.run('DELETE FROM stocks WHERE owner_id = ?', [userId]);

  // 3. Delete properties & wealth cards
  db.run('DELETE FROM owned_properties WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM property_upgrades WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM user_cards WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  // 4. Delete loans, bonds & reset credit score
  db.run('DELETE FROM loan_payments WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM loans WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM loan_credit_scores WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM active_bonds WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM bond_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  // 5. Delete items & active effects
  db.run('DELETE FROM user_inventory WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM active_effects WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM item_use_cooldowns WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM effect_use_cooldowns WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  // 6. Reset all cooldowns & trackers
  db.run('DELETE FROM work_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM hunt_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM crime_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM rob_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM rob_target_tracker WHERE guild_id = ? AND target_id = ?', [guildId, userId]);
  db.run('DELETE FROM hack_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM hack_target_tracker WHERE guild_id = ? AND target_id = ?', [guildId, userId]);
  db.run('DELETE FROM luckypenny_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM slut_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM passive_income_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM role_income_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  db.run('DELETE FROM card_cooldowns WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  // 7. Reset skills XP
  db.run('UPDATE user_skills SET hack_xp = 0, rob_xp = 0 WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  // ===== APPLY PRESTIGE =====

  // Set starting bonus as cash
  db.run('UPDATE balances SET cash = ? WHERE guild_id = ? AND user_id = ?', 
    [nextTier.startingBonus, guildId, userId]);

  // Record prestige level
  db.run(`
    INSERT INTO prestige (guild_id, user_id, prestige_level, prestige_time, total_prestiges)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      prestige_level = ?,
      prestige_time = ?,
      total_prestiges = total_prestiges + 1
  `, [guildId, userId, newLevel, now, newLevel, now]);

  // Record history
  db.run(`
    INSERT INTO prestige_history (guild_id, user_id, from_level, to_level, total_wealth_at_prestige, prestige_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, userId, data.level, newLevel, totalWealth, now]);

  saveDatabase();

  return {
    success: true,
    fromLevel: data.level,
    toLevel: newLevel,
    tier: nextTier,
    startingBonus: nextTier.startingBonus
  };
}

// ============ LEADERBOARD ============
function getPrestigeLeaderboard(guildId) {
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT p.user_id, p.prestige_level, p.prestige_time, p.total_prestiges
    FROM prestige p
    WHERE p.guild_id = ? AND p.prestige_level > 0
    ORDER BY p.prestige_level DESC, p.prestige_time ASC
  `);
  stmt.bind([guildId]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getPrestigeHistory(guildId, userId) {
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT * FROM prestige_history
    WHERE guild_id = ? AND user_id = ?
    ORDER BY prestige_time DESC
  `);
  stmt.bind([guildId, userId]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// ============ ADMIN ============
function adminSetPrestige(guildId, userId, level) {
  if (!db) return false;
  if (level < 0 || level > PRESTIGE_TIERS.length) return false;
  db.run(`
    INSERT INTO prestige (guild_id, user_id, prestige_level, prestige_time, total_prestiges)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      prestige_level = ?
  `, [guildId, userId, level, Date.now(), level]);
  saveDatabase();
  return true;
}

function adminResetPrestige(guildId, userId) {
  if (!db) return false;
  db.run('DELETE FROM prestige WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  saveDatabase();
  return true;
}

// ============ EXPORTS ============
module.exports = {
  initPrestige,
  getPrestigeLevel,
  getPrestigeData,
  getPrestigeSettings,
  updatePrestigeSettings,
  getTierInfo,
  getNextTier,
  getPrestigeBadge,
  getIncomeMultiplier,
  getXpMultiplier,
  getBorrowMultiplier,
  applyIncomeMultiplier,
  applyXpMultiplier,
  applyBorrowMultiplier,
  canPrestige,
  executePrestige,
  getPrestigeEmoji,
  getPrestigeLeaderboard,
  getPrestigeHistory,
  adminSetPrestige,
  adminResetPrestige,
  PRESTIGE_TIERS,
  PRESTIGE_COOLDOWN_MS
};
