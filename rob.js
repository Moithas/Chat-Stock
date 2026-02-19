// Rob module for Chat-Stock
// Allows users to rob other players' cash

let db = null;

const DEFAULT_SETTINGS = {
  enabled: true,
  minStealPercent: 20,      // Minimum % of target's cash that can be stolen
  maxStealPercent: 80,      // Maximum % of target's cash that can be stolen
  cooldownMinutes: 240,     // Minutes between rob attempts (default 4 hours = 240 minutes)
  targetCooldownSeconds: 60, // Seconds a target is protected after being robbed (default 1 minute)
  fineMinPercent: 10,       // Minimum fine as % of robber's total balance
  fineMaxPercent: 25,       // Maximum fine as % of robber's total balance
  defensesEnabled: true,    // Whether defense mechanics are enabled
  defenseWindowSeconds: 10, // Seconds a target has to choose a defense
  hidecashSuccessRate: 70,  // Hide cash success %
  dodgeSuccessRate: 60,     // Dodge success %
  fightBackSuccessRate: 50  // Fight back success %
};

// Cache for settings per guild
const guildRobSettings = new Map();

function initRob(database) {
  db = database;
  
  // Create rob settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      min_steal_percent INTEGER DEFAULT 20,
      max_steal_percent INTEGER DEFAULT 80,
      cooldown_minutes INTEGER DEFAULT 240,
      target_cooldown_seconds INTEGER DEFAULT 60,
      fine_min_percent INTEGER DEFAULT 10,
      fine_max_percent INTEGER DEFAULT 25,
      defenses_enabled INTEGER DEFAULT 1,
      hidecash_success_rate INTEGER DEFAULT 70,
      dodge_success_rate INTEGER DEFAULT 60,
      fightback_success_rate INTEGER DEFAULT 50
    )
  `);
  
  // Add cooldown_minutes column if it doesn't exist (migration for existing databases)
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN cooldown_minutes INTEGER DEFAULT 240`);
  } catch (e) {
    // Column already exists
  }
  
  // Add target_cooldown_seconds column if it doesn't exist (migration)
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN target_cooldown_seconds INTEGER DEFAULT 60`);
  } catch (e) {
    // Column already exists
  }
  
  // Migrate from cooldown_hours to cooldown_minutes if needed
  try {
    const stmt = db.prepare(`SELECT cooldown_hours FROM rob_settings LIMIT 1`);
    if (stmt.step()) {
      // Old column exists, migrate data
      db.run(`UPDATE rob_settings SET cooldown_minutes = cooldown_hours * 60 WHERE cooldown_minutes IS NULL`);
    }
    stmt.free();
  } catch (e) {
    // New column structure, no migration needed
  }
  
  // Add unique_targets_required column if it doesn't exist (migration)
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN unique_targets_required INTEGER DEFAULT 3`);
  } catch (e) {
    // Column already exists
  }
  
  // Add defense columns if they don't exist (migration for existing databases)
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN defenses_enabled INTEGER DEFAULT 1`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN hidecash_success_rate INTEGER DEFAULT 70`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN dodge_success_rate INTEGER DEFAULT 60`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN fightback_success_rate INTEGER DEFAULT 50`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE rob_settings ADD COLUMN defense_window_seconds INTEGER DEFAULT 10`);
  } catch (e) {
    // Column already exists
  }
  
  // Create rob tracker table (for robber cooldowns)
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_rob_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create target tracker table (for target cooldowns)
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_target_tracker (
      guild_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      last_targeted_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, target_id)
    )
  `);
  
  // Create gift protection table (prevents robbing after recent gifts)
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_gift_protection (
      guild_id TEXT NOT NULL,
      giver_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      gift_time INTEGER NOT NULL,
      PRIMARY KEY (guild_id, giver_id, recipient_id)
    )
  `);
  
  // Create rob history table
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      robber_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      rob_time INTEGER NOT NULL
    )
  `);
  
  // Create rob immune roles table
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_immune_roles (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    )
  `);
  
  // Create immunity tiers table (purchasable immunity)
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_immunity_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      role_id TEXT,
      enabled INTEGER DEFAULT 1
    )
  `);
  
  // Add role_id column if it doesn't exist (migration)
  try {
    db.run(`ALTER TABLE rob_immunity_tiers ADD COLUMN role_id TEXT`);
  } catch (e) { /* Column may already exist */ }
  
  // Add role_id to user immunity table for tracking
  try {
    db.run(`ALTER TABLE rob_user_immunity ADD COLUMN role_id TEXT`);
  } catch (e) { /* Column may already exist */ }
  
  // Create user purchased immunity table
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_user_immunity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tier_name TEXT NOT NULL,
      purchased_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      price_paid INTEGER NOT NULL
    )
  `);
  
  // Create immunity history table
  db.run(`
    CREATE TABLE IF NOT EXISTS rob_immunity_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tier_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      purchased_at INTEGER NOT NULL
    )
  `);
  
  // Create indexes for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_rob_tracker_guild_user ON rob_tracker(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_rob_target_tracker_guild_target ON rob_target_tracker(guild_id, target_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_rob_history_guild_time ON rob_history(guild_id, rob_time)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_rob_gift_protection ON rob_gift_protection(guild_id, giver_id, recipient_id)`);
  
  console.log('💰 Rob system initialized');
}

function getRobSettings(guildId) {
  if (guildRobSettings.has(guildId)) {
    return guildRobSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const stmt = db.prepare(`SELECT * FROM rob_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    const settings = {
      enabled: row.enabled === 1,
      minStealPercent: row.min_steal_percent,
      maxStealPercent: row.max_steal_percent,
      cooldownMinutes: row.cooldown_minutes || 240,
      targetCooldownSeconds: row.target_cooldown_seconds !== undefined ? row.target_cooldown_seconds : 60,
      uniqueTargetsRequired: row.unique_targets_required !== undefined ? row.unique_targets_required : 3,
      fineMinPercent: row.fine_min_percent || 10,
      fineMaxPercent: row.fine_max_percent || 25,
      defensesEnabled: row.defenses_enabled === 1,
      defenseWindowSeconds: row.defense_window_seconds || 10,
      hidecashSuccessRate: row.hidecash_success_rate || 70,
      dodgeSuccessRate: row.dodge_success_rate || 60,
      fightBackSuccessRate: row.fightback_success_rate || 50
    };
    stmt.free();
    guildRobSettings.set(guildId, settings);
    return settings;
  }
  
  stmt.free();
  guildRobSettings.set(guildId, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

function updateRobSettings(guildId, updates) {
  if (!db) return;
  
  const current = getRobSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO rob_settings (guild_id, enabled, min_steal_percent, max_steal_percent, cooldown_minutes, target_cooldown_seconds, unique_targets_required, fine_min_percent, fine_max_percent, defenses_enabled, defense_window_seconds, hidecash_success_rate, dodge_success_rate, fightback_success_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.minStealPercent,
    settings.maxStealPercent,
    settings.cooldownMinutes,
    settings.targetCooldownSeconds,
    settings.uniqueTargetsRequired !== undefined ? settings.uniqueTargetsRequired : 3,
    settings.fineMinPercent,
    settings.fineMaxPercent,
    settings.defensesEnabled ? 1 : 0,
    settings.defenseWindowSeconds || 10,
    settings.hidecashSuccessRate,
    settings.dodgeSuccessRate,
    settings.fightBackSuccessRate
  ]);
  
  guildRobSettings.set(guildId, settings);
}

function canRob(guildId, userId, cooldownReduction = 0) {
  if (!db) return { canRob: false, reason: 'Database not initialized' };
  
  const settings = getRobSettings(guildId);
  
  if (!settings.enabled) {
    return { canRob: false, reason: 'Robbing is currently disabled on this server.' };
  }
  
  const stmt = db.prepare(`SELECT last_rob_time FROM rob_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);
  
  let lastRobTime = 0;
  if (stmt.step()) {
    lastRobTime = stmt.getAsObject().last_rob_time;
  }
  stmt.free();
  
  const now = Date.now();
  // Apply cooldown reduction from skills
  const reducedCooldownMinutes = settings.cooldownMinutes * (1 - cooldownReduction / 100);
  const cooldownMs = reducedCooldownMinutes * 60 * 1000;
  const timeSinceRob = now - lastRobTime;
  
  if (timeSinceRob < cooldownMs) {
    const remainingMs = cooldownMs - timeSinceRob;
    const minutes = Math.floor(remainingMs / (60 * 1000));
    const seconds = Math.floor((remainingMs % (60 * 1000)) / 1000);
    
    return {
      canRob: false,
      reason: `You need to lay low! Come back in **${minutes}m ${seconds}s**.`,
      timeRemaining: remainingMs
    };
  }
  
  return { canRob: true };
}

// Check if target can be robbed (target cooldown)
function canBeRobbed(guildId, targetId) {
  if (!db) return { canBeRobbed: false, reason: 'Database not initialized' };
  
  const settings = getRobSettings(guildId);
  
  // If target cooldown is 0, no protection
  if (settings.targetCooldownSeconds === 0) {
    return { canBeRobbed: true };
  }
  
  const stmt = db.prepare(`SELECT last_targeted_time FROM rob_target_tracker WHERE guild_id = ? AND target_id = ?`);
  stmt.bind([guildId, targetId]);
  
  let lastTargetedTime = 0;
  if (stmt.step()) {
    lastTargetedTime = stmt.getAsObject().last_targeted_time;
  }
  stmt.free();
  
  const now = Date.now();
  const cooldownMs = settings.targetCooldownSeconds * 1000;
  const timeSinceTargeted = now - lastTargetedTime;
  
  if (timeSinceTargeted < cooldownMs) {
    const remainingMs = cooldownMs - timeSinceTargeted;
    const minutes = Math.floor(remainingMs / (60 * 1000));
    const seconds = Math.floor((remainingMs % (60 * 1000)) / 1000);
    
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    
    return {
      canBeRobbed: false,
      reason: `This user was recently targeted! They're protected for **${timeStr}**.`,
      timeRemaining: remainingMs
    };
  }
  
  return { canBeRobbed: true };
}

// Check if robber can target this specific person (unique targets requirement)
function canRobTarget(guildId, robberId, targetId) {
  if (!db) return { canRob: true, targetsNeeded: 0 };
  
  const settings = getRobSettings(guildId);
  
  // If unique targets requirement is 0, no restriction
  if (!settings.uniqueTargetsRequired || settings.uniqueTargetsRequired === 0) {
    return { canRob: true, targetsNeeded: 0 };
  }
  
  // Get the last time this robber targeted this specific person
  const lastRobResult = db.exec(`
    SELECT MAX(rob_time) as last_rob FROM rob_history
    WHERE guild_id = ? AND robber_id = ? AND target_id = ?
  `, [guildId, robberId, targetId]);
  
  if (lastRobResult.length === 0 || !lastRobResult[0].values[0][0]) {
    // Never robbed this person before
    return { canRob: true, targetsNeeded: 0 };
  }
  
  const lastRobTime = lastRobResult[0].values[0][0];
  
  // Count unique targets robbed since last rob of this person
  const uniqueTargetsResult = db.exec(`
    SELECT COUNT(DISTINCT target_id) as count FROM rob_history
    WHERE guild_id = ? AND robber_id = ? AND target_id != ? AND rob_time > ?
  `, [guildId, robberId, targetId, lastRobTime]);
  
  const uniqueTargets = uniqueTargetsResult[0]?.values[0][0] || 0;
  
  if (uniqueTargets >= settings.uniqueTargetsRequired) {
    return { canRob: true, targetsNeeded: 0 };
  }
  
  return {
    canRob: false,
    targetsNeeded: settings.uniqueTargetsRequired - uniqueTargets,
    reason: `You must rob **${settings.uniqueTargetsRequired - uniqueTargets}** other unique target(s) before robbing this person again!`
  };
}

// Record that a target was robbed/targeted
function recordTargetRobbed(guildId, targetId) {
  if (!db) return;
  
  const now = Date.now();
  db.run(`
    INSERT OR REPLACE INTO rob_target_tracker (guild_id, target_id, last_targeted_time)
    VALUES (?, ?, ?)
  `, [guildId, targetId, now]);
}

// Record a gift to prevent immediate rob exploitation
function recordGiftProtection(guildId, giverId, recipientId) {
  if (!db) return;
  
  const now = Date.now();
  db.run(
    'INSERT OR REPLACE INTO rob_gift_protection (guild_id, giver_id, recipient_id, gift_time) VALUES (?, ?, ?, ?)',
    [guildId, giverId, recipientId, now]
  );
}

// Check if robbing is prevented due to recent gift (24 hour protection)
function checkGiftProtection(guildId, robberId, targetId) {
  if (!db) return { canRob: true };
  
  const protectionHours = 24; // 24 hour protection after giving money
  const protectionMs = protectionHours * 60 * 60 * 1000;
  const cutoffTime = Date.now() - protectionMs;
  
  // Check if robber recently gave money to target
  const stmt = db.prepare(
    'SELECT gift_time FROM rob_gift_protection WHERE guild_id = ? AND giver_id = ? AND recipient_id = ? AND gift_time > ?'
  );
  stmt.bind([guildId, robberId, targetId, cutoffTime]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    
    if (row && row.gift_time) {
      const timeLeft = row.gift_time + protectionMs - Date.now();
      const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
      return { 
        canRob: false, 
        reason: `You recently gave money to this user. Wait ${hoursLeft} more hour(s) before robbing them.`
      };
    }
  } else {
    stmt.free();
  }
  
  return { canRob: true };
}

// Calculate success rate based on formula: target's cash / (target's cash + robber's total balance)
function calculateSuccessRate(targetCash, robberTotal, skillBonus = 0) {
  if (targetCash === 0) {
    return 0; // Can't rob someone with no cash
  }
  
  const denominator = targetCash + robberTotal;
  if (denominator === 0) {
    return 0;
  }
  
  const baseRate = (targetCash / denominator) * 100;
  const successRate = baseRate + skillBonus;
  return Math.min(100, Math.max(0, successRate)); // Clamp between 0 and 100
}

function attemptRob(successRate) {
  const roll = Math.random() * 100;
  return roll < successRate;
}

function calculateStolenAmount(targetCash, settings, minStealBonus = 0, maxStealBonus = 0) {
  const minPercent = settings.minStealPercent + minStealBonus;
  const maxPercent = Math.min(100, settings.maxStealPercent + maxStealBonus); // Cap at 100%
  
  // Random percentage between min and max
  const stealPercent = Math.floor(Math.random() * (maxPercent - minPercent + 1)) + minPercent;
  
  // Calculate stolen amount
  const stolen = Math.floor(targetCash * (stealPercent / 100));
  return stolen;
}

function calculateFine(robberTotal, settings, fineReduction = 0) {
  const minFine = Math.floor(robberTotal * (settings.fineMinPercent / 100));
  const maxFine = Math.floor(robberTotal * (settings.fineMaxPercent / 100));
  // Random fine between min and max
  const baseFine = Math.floor(Math.random() * (maxFine - minFine + 1)) + minFine;
  // Apply skill reduction
  const fine = Math.floor(baseFine * (1 - fineReduction / 100));
  return Math.max(fine, robberTotal > 0 ? 1 : 0);
}

function recordRob(guildId, robberId, targetId, success, amount) {
  if (!db) return;
  
  const now = Date.now();
  
  // Update cooldown tracker
  db.run(`
    INSERT OR REPLACE INTO rob_tracker (guild_id, user_id, last_rob_time)
    VALUES (?, ?, ?)
  `, [guildId, robberId, now]);
  
  // Record in history
  db.run(`
    INSERT INTO rob_history (guild_id, robber_id, target_id, success, amount, rob_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, robberId, targetId, success ? 1 : 0, amount, now]);
}

function getRobHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const stmt = db.prepare(`
    SELECT * FROM rob_history 
    WHERE guild_id = ? AND (robber_id = ? OR target_id = ?)
    ORDER BY rob_time DESC 
    LIMIT ?
  `);
  stmt.bind([guildId, userId, userId, limit]);
  
  const history = [];
  while (stmt.step()) {
    history.push(stmt.getAsObject());
  }
  stmt.free();
  
  return history;
}

function getRobStats(guildId, userId) {
  if (!db) return { attempts: 0, successes: 0, totalStolen: 0, totalLost: 0 };
  
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as attempts,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 1 THEN amount ELSE 0 END) as total_stolen,
      SUM(CASE WHEN success = 0 THEN amount ELSE 0 END) as total_lost
    FROM rob_history
    WHERE guild_id = ? AND robber_id = ?
  `);
  stmt.bind([guildId, userId]);
  
  let stats = { attempts: 0, successes: 0, totalStolen: 0, totalLost: 0 };
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stats = {
      attempts: row.attempts || 0,
      successes: row.successes || 0,
      totalStolen: row.total_stolen || 0,
      totalLost: row.total_lost || 0
    };
  }
  stmt.free();
  
  return stats;
}

// ============ IMMUNE ROLES ============

function getImmuneRoles(guildId) {
  if (!db) return [];
  
  const result = db.exec(
    `SELECT role_id FROM rob_immune_roles WHERE guild_id = ?`,
    [guildId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    return [];
  }
  
  return result[0].values.map(row => row[0]);
}

function addImmuneRole(guildId, roleId) {
  if (!db) return false;
  
  try {
    db.run(
      `INSERT OR IGNORE INTO rob_immune_roles (guild_id, role_id) VALUES (?, ?)`,
      [guildId, roleId]
    );
    return true;
  } catch (error) {
    console.error('Error adding immune role:', error);
    return false;
  }
}

function removeImmuneRole(guildId, roleId) {
  if (!db) return false;
  
  try {
    db.run(
      `DELETE FROM rob_immune_roles WHERE guild_id = ? AND role_id = ?`,
      [guildId, roleId]
    );
    return true;
  } catch (error) {
    console.error('Error removing immune role:', error);
    return false;
  }
}

function isUserImmune(guildId, userRoles) {
  const immuneRoles = getImmuneRoles(guildId);
  if (immuneRoles.length === 0) return false;
  
  // Check if user has any immune role
  for (const roleId of immuneRoles) {
    if (userRoles.includes(roleId)) {
      return true;
    }
  }
  return false;
}

// ============ PURCHASABLE IMMUNITY TIERS ============

function getImmunityTiers(guildId) {
  if (!db) return [];
  
  const result = db.exec(
    `SELECT * FROM rob_immunity_tiers WHERE guild_id = ? ORDER BY price ASC`,
    [guildId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    return [];
  }
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getImmunityTier(guildId, tierId) {
  if (!db) return null;
  
  const stmt = db.prepare(`SELECT * FROM rob_immunity_tiers WHERE guild_id = ? AND id = ?`);
  stmt.bind([guildId, tierId]);
  
  if (stmt.step()) {
    const tier = stmt.getAsObject();
    stmt.free();
    return tier;
  }
  
  stmt.free();
  return null;
}

function createImmunityTier(guildId, name, price, durationDays, roleId = null) {
  if (!db) return null;
  
  db.run(`
    INSERT INTO rob_immunity_tiers (guild_id, name, price, duration_days, role_id, enabled)
    VALUES (?, ?, ?, ?, ?, 1)
  `, [guildId, name, price, durationDays, roleId]);
  
  const result = db.exec(`SELECT last_insert_rowid() as id`);
  return result[0].values[0][0];
}

function updateImmunityTier(guildId, tierId, updates) {
  if (!db) return false;
  
  const tier = getImmunityTier(guildId, tierId);
  if (!tier) return false;
  
  const name = updates.name !== undefined ? updates.name : tier.name;
  const price = updates.price !== undefined ? updates.price : tier.price;
  const durationDays = updates.duration_days !== undefined ? updates.duration_days : tier.duration_days;
  const roleId = updates.role_id !== undefined ? updates.role_id : tier.role_id;
  const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : tier.enabled;
  
  db.run(`
    UPDATE rob_immunity_tiers 
    SET name = ?, price = ?, duration_days = ?, role_id = ?, enabled = ?
    WHERE guild_id = ? AND id = ?
  `, [name, price, durationDays, roleId, enabled, guildId, tierId]);
  
  return true;
}

function deleteImmunityTier(guildId, tierId) {
  if (!db) return false;
  
  db.run(`DELETE FROM rob_immunity_tiers WHERE guild_id = ? AND id = ?`, [guildId, tierId]);
  return true;
}

// ============ USER PURCHASED IMMUNITY ============

function getUserActiveImmunity(guildId, userId) {
  if (!db) return null;
  
  const now = Date.now();
  const stmt = db.prepare(`
    SELECT * FROM rob_user_immunity 
    WHERE guild_id = ? AND user_id = ? AND expires_at > ?
    ORDER BY expires_at DESC
    LIMIT 1
  `);
  stmt.bind([guildId, userId, now]);
  
  if (stmt.step()) {
    const immunity = stmt.getAsObject();
    stmt.free();
    return immunity;
  }
  
  stmt.free();
  return null;
}

function purchaseImmunity(guildId, userId, tierId) {
  if (!db) return null;
  
  const tier = getImmunityTier(guildId, tierId);
  if (!tier) return null;
  
  const now = Date.now();
  const expiresAt = now + (tier.duration_days * 24 * 60 * 60 * 1000);
  
  db.run(`
    INSERT INTO rob_user_immunity (guild_id, user_id, tier_name, purchased_at, expires_at, price_paid, role_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guildId, userId, tier.name, now, expiresAt, tier.price, tier.role_id || null]);
  
  // Record in history
  db.run(`
    INSERT INTO rob_immunity_history (guild_id, user_id, tier_name, price, duration_days, purchased_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, userId, tier.name, tier.price, tier.duration_days, now]);
  
  return {
    tierName: tier.name,
    price: tier.price,
    durationDays: tier.duration_days,
    roleId: tier.role_id,
    purchasedAt: now,
    expiresAt: expiresAt
  };
}

function hasActiveImmunity(guildId, userId) {
  const immunity = getUserActiveImmunity(guildId, userId);
  return immunity !== null;
}

function getImmunityHistory(guildId, userId, limit = 5) {
  if (!db) return [];
  
  const result = db.exec(
    `SELECT * FROM rob_immunity_history WHERE guild_id = ? AND user_id = ? ORDER BY purchased_at DESC LIMIT ?`,
    [guildId, userId, limit]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    return [];
  }
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getExpiredImmunities() {
  if (!db) return [];
  
  const now = Date.now();
  const result = db.exec(
    `SELECT * FROM rob_user_immunity WHERE expires_at <= ?`,
    [now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    return [];
  }
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function removeExpiredImmunity(immunityId) {
  if (!db) return false;
  
  db.run(`DELETE FROM rob_user_immunity WHERE id = ?`, [immunityId]);
  return true;
}

let schedulerClient = null;

function startImmunityScheduler(client) {
  schedulerClient = client;
  
  // Check every minute for expired immunities
  setInterval(async () => {
    await processExpiredImmunities();
  }, 60000);
  
  console.log('🛡️ Immunity expiration scheduler started');
}

async function processExpiredImmunities() {
  if (!db || !schedulerClient) return;
  
  const expiredImmunities = getExpiredImmunities();
  
  for (const immunity of expiredImmunities) {
    try {
      const guild = await schedulerClient.guilds.fetch(immunity.guild_id);
      if (!guild) {
        // Guild not accessible, just remove the record
        removeExpiredImmunity(immunity.id);
        continue;
      }
      
      // Remove the role if one was assigned
      if (immunity.role_id) {
        const member = await guild.members.fetch(immunity.user_id).catch(() => null);
        if (member) {
          await member.roles.remove(immunity.role_id).catch(console.error);
        }
      }
      
      removeExpiredImmunity(immunity.id);
      console.log(`🛡️ Immunity ${immunity.id} expired for user ${immunity.user_id} (${immunity.tier_name})`);
      
    } catch (error) {
      console.error(`Error processing expired immunity ${immunity.id}:`, error);
    }
  }
}

module.exports = {
  initRob,
  getRobSettings,
  updateRobSettings,
  canRob,
  canBeRobbed,
  canRobTarget,
  recordTargetRobbed,
  recordGiftProtection,
  checkGiftProtection,
  calculateSuccessRate,
  attemptRob,
  calculateStolenAmount,
  calculateFine,
  recordRob,
  getRobHistory,
  getRobStats,
  getImmuneRoles,
  addImmuneRole,
  removeImmuneRole,
  isUserImmune,
  // Purchasable immunity
  getImmunityTiers,
  getImmunityTier,
  createImmunityTier,
  updateImmunityTier,
  deleteImmunityTier,
  getUserActiveImmunity,
  purchaseImmunity,
  hasActiveImmunity,
  getImmunityHistory,
  getExpiredImmunities,
  removeExpiredImmunity,
  startImmunityScheduler
};
