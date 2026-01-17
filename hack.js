// Hack module for Chat-Stock
// Allows users to hack other players' bank balances

let db = null;

const DEFAULT_SETTINGS = {
  enabled: true,
  hackerCooldownMinutes: 60,      // 1 hour cooldown for hacker
  targetCooldownMinutes: 720,     // 12 hours cooldown for target (only if hack succeeds)
  minStealPercent: 2,             // Minimum % of target's bank that can be stolen
  maxStealPercent: 5,             // Maximum % of target's bank that can be stolen
  minFinePercent: 15,             // Minimum fine as % of potential steal
  maxFinePercent: 20              // Maximum fine as % of potential steal
};

// Cache for settings per guild
const guildHackSettings = new Map();

// Track active hacks to prevent concurrent targeting
const activeHacks = new Map(); // guildId_targetId -> hackerId

function initHack(database) {
  db = database;
  
  // Create hack settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS hack_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      hacker_cooldown_minutes INTEGER DEFAULT 60,
      target_cooldown_minutes INTEGER DEFAULT 720,
      min_steal_percent INTEGER DEFAULT 2,
      max_steal_percent INTEGER DEFAULT 5,
      min_fine_percent INTEGER DEFAULT 15,
      max_fine_percent INTEGER DEFAULT 20
    )
  `);
  
  // Create hacker cooldown tracker table
  db.run(`
    CREATE TABLE IF NOT EXISTS hack_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_hack_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create target cooldown tracker table
  db.run(`
    CREATE TABLE IF NOT EXISTS hack_target_tracker (
      guild_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      last_hacked_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, target_id)
    )
  `);
  
  // Create hack immune roles table
  db.run(`
    CREATE TABLE IF NOT EXISTS hack_immune_roles (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    )
  `);
  
  // Create hack history table
  db.run(`
    CREATE TABLE IF NOT EXISTS hack_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      hacker_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      hack_time INTEGER NOT NULL,
      defended INTEGER DEFAULT 0
    )
  `);
  
  console.log('💻 Hack system initialized');
}

function getHackSettings(guildId) {
  if (guildHackSettings.has(guildId)) {
    return guildHackSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const stmt = db.prepare(`SELECT * FROM hack_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    const settings = {
      enabled: row.enabled === 1,
      hackerCooldownMinutes: row.hacker_cooldown_minutes || 60,
      targetCooldownMinutes: row.target_cooldown_minutes || 720,
      minStealPercent: row.min_steal_percent || 2,
      maxStealPercent: row.max_steal_percent || 5,
      minFinePercent: row.min_fine_percent || 15,
      maxFinePercent: row.max_fine_percent || 20
    };
    stmt.free();
    guildHackSettings.set(guildId, settings);
    return settings;
  }
  
  stmt.free();
  guildHackSettings.set(guildId, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

function updateHackSettings(guildId, updates) {
  if (!db) return;
  
  const current = getHackSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO hack_settings (guild_id, enabled, hacker_cooldown_minutes, target_cooldown_minutes, min_steal_percent, max_steal_percent, min_fine_percent, max_fine_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.hackerCooldownMinutes,
    settings.targetCooldownMinutes,
    settings.minStealPercent,
    settings.maxStealPercent,
    settings.minFinePercent,
    settings.maxFinePercent
  ]);
  
  guildHackSettings.set(guildId, settings);
}

function canHack(guildId, userId, cooldownReduction = 0) {
  if (!db) return { canHack: false, reason: 'Database not initialized' };
  
  const settings = getHackSettings(guildId);
  
  if (!settings.enabled) {
    return { canHack: false, reason: 'Hacking is currently disabled on this server.' };
  }
  
  const stmt = db.prepare(`SELECT last_hack_time FROM hack_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);
  
  let lastHackTime = 0;
  if (stmt.step()) {
    lastHackTime = stmt.getAsObject().last_hack_time;
  }
  stmt.free();
  
  const now = Date.now();
  // Apply cooldown reduction from skills
  const reducedCooldownMinutes = settings.hackerCooldownMinutes * (1 - cooldownReduction / 100);
  const cooldownMs = reducedCooldownMinutes * 60 * 1000;
  const timeSinceHack = now - lastHackTime;
  
  if (timeSinceHack < cooldownMs) {
    const remainingMs = cooldownMs - timeSinceHack;
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remainingMs % (60 * 1000)) / 1000);
    
    let timeStr = '';
    if (hours > 0) timeStr += `${hours}h `;
    if (minutes > 0) timeStr += `${minutes}m `;
    if (seconds > 0 && hours === 0) timeStr += `${seconds}s`;
    
    return {
      canHack: false,
      reason: `You must wait **${timeStr.trim()}** before hacking again.`,
      timeRemaining: remainingMs
    };
  }
  
  return { canHack: true };
}

function canBeHacked(guildId, targetId) {
  if (!db) return { canBeHacked: false, reason: 'Database not initialized' };
  
  // Check if target is currently being hacked
  const hackKey = `${guildId}_${targetId}`;
  if (activeHacks.has(hackKey)) {
    return { canBeHacked: false, reason: 'This user is already being hacked!' };
  }
  
  const settings = getHackSettings(guildId);
  
  const stmt = db.prepare(`SELECT last_hacked_time FROM hack_target_tracker WHERE guild_id = ? AND target_id = ?`);
  stmt.bind([guildId, targetId]);
  
  let lastHackedTime = 0;
  if (stmt.step()) {
    lastHackedTime = stmt.getAsObject().last_hacked_time;
  }
  stmt.free();
  
  const now = Date.now();
  const cooldownMs = settings.targetCooldownMinutes * 60 * 1000;
  const timeSinceHacked = now - lastHackedTime;
  
  if (timeSinceHacked < cooldownMs) {
    const remainingMs = cooldownMs - timeSinceHacked;
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    
    let timeStr = '';
    if (hours > 0) timeStr += `${hours}h `;
    if (minutes > 0) timeStr += `${minutes}m`;
    
    return {
      canBeHacked: false,
      reason: `This user was recently hacked! They're protected for **${timeStr.trim()}**.`,
      timeRemaining: remainingMs
    };
  }
  
  return { canBeHacked: true };
}

// Start tracking an active hack
function startActiveHack(guildId, targetId, hackerId) {
  const hackKey = `${guildId}_${targetId}`;
  activeHacks.set(hackKey, hackerId);
}

// End tracking an active hack
function endActiveHack(guildId, targetId) {
  const hackKey = `${guildId}_${targetId}`;
  activeHacks.delete(hackKey);
}

// Record hacker's cooldown (called when hack starts)
function recordHackerCooldown(guildId, hackerId) {
  if (!db) return;
  
  const now = Date.now();
  db.run(`
    INSERT OR REPLACE INTO hack_tracker (guild_id, user_id, last_hack_time)
    VALUES (?, ?, ?)
  `, [guildId, hackerId, now]);
}

// Record target's cooldown (called only on successful hack)
function recordTargetHacked(guildId, targetId) {
  if (!db) return;
  
  const now = Date.now();
  db.run(`
    INSERT OR REPLACE INTO hack_target_tracker (guild_id, target_id, last_hacked_time)
    VALUES (?, ?, ?)
  `, [guildId, targetId, now]);
}

// Clear target's cooldown (called when hack fails)
function clearTargetCooldown(guildId, targetId) {
  if (!db) return;
  
  db.run(`
    DELETE FROM hack_target_tracker WHERE guild_id = ? AND target_id = ?
  `, [guildId, targetId]);
}

// Calculate success rate: (target's bank / 2.5) / (hacker's bank + target's bank)
// skillBonus is added as a flat percentage
function calculateSuccessRate(targetBank, hackerBank, skillBonus = 0) {
  if (targetBank === 0) return 0;
  
  const adjustedTargetBank = targetBank / 2.5;
  const totalBank = hackerBank + targetBank;
  
  if (totalBank === 0) return 0;
  
  const baseRate = (adjustedTargetBank / totalBank) * 100;
  const rate = baseRate + skillBonus;
  return Math.min(100, Math.max(0, rate));
}

// Calculate steal amount based on progress
// NEW: Linear scaling from 0% to maxSteal based on progress
// maxStealBonus is added to the base maxStealPercent
function calculateStealPercent(progress, settings, maxStealBonus = 0) {
  const maxSteal = settings.maxStealPercent + maxStealBonus;
  // Linear: at 0% progress = 0%, at 100% progress = maxSteal
  return maxSteal * (progress / 100);
}

// Calculate actual steal amount
function calculateStealAmount(targetBank, progress, settings, maxStealBonus = 0) {
  const stealPercent = calculateStealPercent(progress, settings, maxStealBonus);
  return Math.floor(targetBank * (stealPercent / 100));
}

// Calculate fine amount (% of potential steal)
function calculateFine(potentialSteal, settings) {
  const finePercent = settings.minFinePercent + Math.random() * (settings.maxFinePercent - settings.minFinePercent);
  return Math.floor(potentialSteal * (finePercent / 100));
}

// Get defense chance based on progress
function getDefenseChance(progress) {
  if (progress >= 80) return 0;
  if (progress >= 60) return 20;
  if (progress >= 40) return 40;
  if (progress >= 20) return 60;
  return 80;
}

// Check if user has immune role
function isUserImmuneToHack(guildId, userRoles) {
  if (!db) return false;
  
  const stmt = db.prepare(`SELECT role_id FROM hack_immune_roles WHERE guild_id = ?`);
  stmt.bind([guildId]);
  
  const immuneRoles = [];
  while (stmt.step()) {
    immuneRoles.push(stmt.getAsObject().role_id);
  }
  stmt.free();
  
  return userRoles.some(roleId => immuneRoles.includes(roleId));
}

// Get all immune roles for a guild
function getHackImmuneRoles(guildId) {
  if (!db) return [];
  
  const stmt = db.prepare(`SELECT role_id FROM hack_immune_roles WHERE guild_id = ?`);
  stmt.bind([guildId]);
  
  const roles = [];
  while (stmt.step()) {
    roles.push(stmt.getAsObject().role_id);
  }
  stmt.free();
  
  return roles;
}

// Add immune role
function addHackImmuneRole(guildId, roleId) {
  if (!db) return;
  
  db.run(`
    INSERT OR IGNORE INTO hack_immune_roles (guild_id, role_id)
    VALUES (?, ?)
  `, [guildId, roleId]);
}

// Remove immune role
function removeHackImmuneRole(guildId, roleId) {
  if (!db) return;
  
  db.run(`
    DELETE FROM hack_immune_roles WHERE guild_id = ? AND role_id = ?
  `, [guildId, roleId]);
}

// Clear all immune roles
function clearHackImmuneRoles(guildId) {
  if (!db) return;
  
  db.run(`DELETE FROM hack_immune_roles WHERE guild_id = ?`, [guildId]);
}

// Record hack in history
function recordHack(guildId, hackerId, targetId, success, amount, defended = false) {
  if (!db) return;
  
  db.run(`
    INSERT INTO hack_history (guild_id, hacker_id, target_id, success, amount, hack_time, defended)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guildId, hackerId, targetId, success ? 1 : 0, amount, Date.now(), defended ? 1 : 0]);
}

module.exports = {
  initHack,
  getHackSettings,
  updateHackSettings,
  canHack,
  canBeHacked,
  startActiveHack,
  endActiveHack,
  recordHackerCooldown,
  recordTargetHacked,
  clearTargetCooldown,
  calculateSuccessRate,
  calculateStealPercent,
  calculateStealAmount,
  calculateFine,
  getDefenseChance,
  isUserImmuneToHack,
  getHackImmuneRoles,
  addHackImmuneRole,
  removeHackImmuneRole,
  clearHackImmuneRoles,
  recordHack
};
