// Skills module for Chat-Stock
// Manages XP, levels, and training for /hack and /rob

let db = null;

const CURRENCY = '<:babybel:1418824333664452608>';

// Lazy-load items module to avoid circular dependency
function getXpBoostValue(guildId, userId) {
  try {
    const { getEffectValue } = require('./items');
    return getEffectValue(guildId, userId, 'xp_boost') || 0;
  } catch (e) {
    return 0;
  }
}

// Level thresholds (XP needed to reach each level)
const LEVEL_THRESHOLDS = [
  0,       // Level 0: 0 XP
  100,     // Level 1: 100 XP
  350,     // Level 2: 350 XP (250 more)
  850,     // Level 3: 850 XP (500 more)
  1850,    // Level 4: 1,850 XP (1,000 more)
  3850,    // Level 5: 3,850 XP (2,000 more)
  7850,    // Level 6: 7,850 XP (4,000 more)
  15350,   // Level 7: 15,350 XP (7,500 more)
  27850,   // Level 8: 27,850 XP (12,500 more)
  47850,   // Level 9: 47,850 XP (20,000 more)
  Infinity // Level 10: Max level
];

// XP needed for each level (used for training calculations)
const XP_PER_LEVEL = [
  100,     // To reach Level 1
  250,     // To reach Level 2
  500,     // To reach Level 3
  1000,    // To reach Level 4
  2000,    // To reach Level 5
  4000,    // To reach Level 6
  7500,    // To reach Level 7
  12500,   // To reach Level 8
  20000,   // To reach Level 9
  0        // Level 10 is max
];

// Training costs per level (to train TO that level)
const TRAINING_COSTS = [
  0,         // Can't train to level 0
  10000,     // To Level 1: 10,000
  25000,     // To Level 2: 25,000
  50000,     // To Level 3: 50,000
  100000,    // To Level 4: 100,000
  175000,    // To Level 5: 175,000
  300000,    // To Level 6: 300,000
  500000,    // To Level 7: 500,000
  750000,    // To Level 8: 750,000
  1000000    // To Level 9: 1,000,000
];

// Training times in milliseconds (to train TO that level)
const TRAINING_TIMES = [
  0,                    // Can't train to level 0
  1 * 60 * 60 * 1000,   // To Level 1: 1 hour
  2 * 60 * 60 * 1000,   // To Level 2: 2 hours
  4 * 60 * 60 * 1000,   // To Level 3: 4 hours
  8 * 60 * 60 * 1000,   // To Level 4: 8 hours
  12 * 60 * 60 * 1000,  // To Level 5: 12 hours
  24 * 60 * 60 * 1000,  // To Level 6: 24 hours
  48 * 60 * 60 * 1000,  // To Level 7: 48 hours
  72 * 60 * 60 * 1000,  // To Level 8: 72 hours
  96 * 60 * 60 * 1000   // To Level 9: 96 hours
];

// Default settings
const DEFAULT_SETTINGS = {
  // XP Settings
  successXpBase: 20,
  successXpPerThousand: 1,
  successXpBonusCap: 30,
  failureXp: 8,
  trainingXpPercent: 75,  // Training gives 75% of XP needed for next level
  
  // Hack benefits per level
  hackSuccessRatePerLevel: 4,
  hackMaxStealPerLevel: 1.5,
  hackCooldownReductionPerLevel: 2,
  hackTraceReductionPerLevel: 4,
  
  // Rob benefits per level
  robSuccessRatePerLevel: 2,
  robMinStealPerLevel: 1.5,
  robMaxStealPerLevel: 1.5,
  robCooldownReductionPerLevel: 1.5,
  robFineReductionPerLevel: 3,
  
  // Level decay
  levelDecayEnabled: false,
  levelDecayDays: 7,
  levelDecayXpPercent: 5
};

// Cache for settings per guild
const guildSkillSettings = new Map();

// Cache for pending training notifications
const pendingNotifications = new Map(); // `${guildId}_${userId}` -> { hack: message, rob: message }

function initSkills(database) {
  db = database;
  
  // Create skill settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS skill_settings (
      guild_id TEXT PRIMARY KEY,
      success_xp_base INTEGER DEFAULT 20,
      success_xp_per_thousand INTEGER DEFAULT 1,
      success_xp_bonus_cap INTEGER DEFAULT 30,
      failure_xp INTEGER DEFAULT 8,
      training_xp_percent INTEGER DEFAULT 75,
      hack_success_rate_per_level REAL DEFAULT 4,
      hack_max_steal_per_level REAL DEFAULT 1.5,
      hack_cooldown_reduction_per_level REAL DEFAULT 2,
      hack_trace_reduction_per_level REAL DEFAULT 4,
      rob_success_rate_per_level REAL DEFAULT 2,
      rob_min_steal_per_level REAL DEFAULT 1.5,
      rob_max_steal_per_level REAL DEFAULT 1.5,
      rob_cooldown_reduction_per_level REAL DEFAULT 1.5,
      rob_fine_reduction_per_level REAL DEFAULT 3,
      level_decay_enabled INTEGER DEFAULT 0,
      level_decay_days INTEGER DEFAULT 7,
      level_decay_xp_percent INTEGER DEFAULT 5
    )
  `);
  
  // Create user skills table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_skills (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      hack_xp INTEGER DEFAULT 0,
      rob_xp INTEGER DEFAULT 0,
      hack_training_start INTEGER DEFAULT NULL,
      hack_training_end INTEGER DEFAULT NULL,
      hack_training_xp INTEGER DEFAULT 0,
      hack_trained_at_level INTEGER DEFAULT -1,
      rob_training_start INTEGER DEFAULT NULL,
      rob_training_end INTEGER DEFAULT NULL,
      rob_training_xp INTEGER DEFAULT 0,
      rob_trained_at_level INTEGER DEFAULT -1,
      last_activity INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Migration: Add trained_at_level columns if they don't exist
  try {
    db.run(`ALTER TABLE user_skills ADD COLUMN hack_trained_at_level INTEGER DEFAULT -1`);
    console.log('🎓 Added hack_trained_at_level column');
  } catch (e) { /* Column already exists */ }
  
  try {
    db.run(`ALTER TABLE user_skills ADD COLUMN rob_trained_at_level INTEGER DEFAULT -1`);
    console.log('🎓 Added rob_trained_at_level column');
  } catch (e) { /* Column already exists */ }
  
  // Migration: Add training_started_at_level columns to track what level training was initiated at
  try {
    db.run(`ALTER TABLE user_skills ADD COLUMN hack_training_started_at_level INTEGER DEFAULT -1`);
    console.log('🎓 Added hack_training_started_at_level column');
  } catch (e) { /* Column already exists */ }
  
  try {
    db.run(`ALTER TABLE user_skills ADD COLUMN rob_training_started_at_level INTEGER DEFAULT -1`);
    console.log('🎓 Added rob_training_started_at_level column');
  } catch (e) { /* Column already exists */ }
  
  console.log('🎓 Skills system initialized');
}

// Get skill settings for a guild
function getSkillSettings(guildId) {
  if (guildSkillSettings.has(guildId)) {
    return guildSkillSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const stmt = db.prepare(`SELECT * FROM skill_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    const settings = {
      successXpBase: row.success_xp_base,
      successXpPerThousand: row.success_xp_per_thousand,
      successXpBonusCap: row.success_xp_bonus_cap,
      failureXp: row.failure_xp,
      trainingXpPercent: row.training_xp_percent,
      hackSuccessRatePerLevel: row.hack_success_rate_per_level,
      hackMaxStealPerLevel: row.hack_max_steal_per_level,
      hackCooldownReductionPerLevel: row.hack_cooldown_reduction_per_level,
      hackTraceReductionPerLevel: row.hack_trace_reduction_per_level,
      robSuccessRatePerLevel: row.rob_success_rate_per_level,
      robMinStealPerLevel: row.rob_min_steal_per_level,
      robMaxStealPerLevel: row.rob_max_steal_per_level,
      robCooldownReductionPerLevel: row.rob_cooldown_reduction_per_level,
      robFineReductionPerLevel: row.rob_fine_reduction_per_level,
      levelDecayEnabled: row.level_decay_enabled === 1,
      levelDecayDays: row.level_decay_days,
      levelDecayXpPercent: row.level_decay_xp_percent
    };
    stmt.free();
    guildSkillSettings.set(guildId, settings);
    return settings;
  }
  
  stmt.free();
  return { ...DEFAULT_SETTINGS };
}

// Update skill settings
function updateSkillSettings(guildId, updates) {
  if (!db) return false;
  
  const current = getSkillSettings(guildId);
  const merged = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO skill_settings (
      guild_id, success_xp_base, success_xp_per_thousand, success_xp_bonus_cap,
      failure_xp, training_xp_percent, hack_success_rate_per_level, hack_max_steal_per_level,
      hack_cooldown_reduction_per_level, hack_trace_reduction_per_level,
      rob_success_rate_per_level, rob_min_steal_per_level, rob_max_steal_per_level,
      rob_cooldown_reduction_per_level, rob_fine_reduction_per_level,
      level_decay_enabled, level_decay_days, level_decay_xp_percent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId, merged.successXpBase, merged.successXpPerThousand, merged.successXpBonusCap,
    merged.failureXp, merged.trainingXpPercent, merged.hackSuccessRatePerLevel,
    merged.hackMaxStealPerLevel, merged.hackCooldownReductionPerLevel,
    merged.hackTraceReductionPerLevel, merged.robSuccessRatePerLevel,
    merged.robMinStealPerLevel, merged.robMaxStealPerLevel,
    merged.robCooldownReductionPerLevel, merged.robFineReductionPerLevel,
    merged.levelDecayEnabled ? 1 : 0, merged.levelDecayDays, merged.levelDecayXpPercent
  ]);
  
  guildSkillSettings.set(guildId, merged);
  return true;
}

// Get user skills
function getUserSkills(guildId, userId) {
  if (!db) {
    return {
      hackXp: 0,
      robXp: 0,
      hackLevel: 0,
      robLevel: 0,
      hackTraining: null,
      robTraining: null,
      hackTrainedAtLevel: -1,
      robTrainedAtLevel: -1
    };
  }
  
  const stmt = db.prepare(`SELECT * FROM user_skills WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    
    const hackXp = row.hack_xp || 0;
    const robXp = row.rob_xp || 0;
    
    return {
      hackXp,
      robXp,
      hackLevel: getLevel(hackXp),
      robLevel: getLevel(robXp),
      hackTraining: row.hack_training_end ? {
        startTime: row.hack_training_start,
        endTime: row.hack_training_end,
        xpReward: row.hack_training_xp,
        startedAtLevel: row.hack_training_started_at_level ?? -1
      } : null,
      robTraining: row.rob_training_end ? {
        startTime: row.rob_training_start,
        endTime: row.rob_training_end,
        xpReward: row.rob_training_xp,
        startedAtLevel: row.rob_training_started_at_level ?? -1
      } : null,
      hackTrainedAtLevel: row.hack_trained_at_level ?? -1,
      robTrainedAtLevel: row.rob_trained_at_level ?? -1,
      lastActivity: row.last_activity || 0
    };
  }
  
  stmt.free();
  return {
    hackXp: 0,
    robXp: 0,
    hackLevel: 0,
    robLevel: 0,
    hackTraining: null,
    robTraining: null,
    hackTrainedAtLevel: -1,
    robTrainedAtLevel: -1
  };
}

// Get level from XP
function getLevel(xp) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      return i;
    }
  }
  return 0;
}

// Get XP progress to next level
function getXpProgress(xp) {
  const level = getLevel(xp);
  if (level >= 10) {
    return { current: 0, needed: 0, percent: 100 };
  }
  
  const currentLevelXp = LEVEL_THRESHOLDS[level];
  const nextLevelXp = LEVEL_THRESHOLDS[level + 1];
  const xpIntoLevel = xp - currentLevelXp;
  const xpNeeded = nextLevelXp - currentLevelXp;
  
  return {
    current: xpIntoLevel,
    needed: xpNeeded,
    percent: Math.floor((xpIntoLevel / xpNeeded) * 100)
  };
}

// Add XP to a skill
function addXp(guildId, userId, skill, amount, success, amountStolen = 0) {
  if (!db) return { xpGained: 0, levelUp: false, newLevel: 0 };
  
  const settings = getSkillSettings(guildId);
  const userSkills = getUserSkills(guildId, userId);
  
  // Calculate base XP to award
  let xpGained = 0;
  if (success) {
    xpGained = settings.successXpBase;
    const bonus = Math.min(Math.floor(amountStolen / 1000) * settings.successXpPerThousand, settings.successXpBonusCap);
    xpGained += bonus;
  } else {
    xpGained = settings.failureXp;
  }
  
  // Apply XP boost from items (if active)
  const xpBoostPercent = getXpBoostValue(guildId, userId);
  if (xpBoostPercent > 0) {
    xpGained = Math.floor(xpGained * (1 + xpBoostPercent / 100));
  }
  
  const currentXp = skill === 'hack' ? userSkills.hackXp : userSkills.robXp;
  const currentLevel = getLevel(currentXp);
  const newXp = currentXp + xpGained;
  const newLevel = getLevel(newXp);
  
  // Update database
  const column = skill === 'hack' ? 'hack_xp' : 'rob_xp';
  db.run(`
    INSERT INTO user_skills (guild_id, user_id, ${column}, last_activity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      ${column} = ?,
      last_activity = ?
  `, [guildId, userId, newXp, Date.now(), newXp, Date.now()]);
  
  return {
    xpGained,
    levelUp: newLevel > currentLevel,
    newLevel,
    totalXp: newXp,
    xpBoostPercent
  };
}

// Check and apply completed training
function checkTrainingComplete(guildId, userId, skill) {
  const userSkills = getUserSkills(guildId, userId);
  const training = skill === 'hack' ? userSkills.hackTraining : userSkills.robTraining;
  
  if (!training) return null;
  
  const now = Date.now();
  if (now < training.endTime) return null;
  
  // Training complete! Award XP
  const currentXp = skill === 'hack' ? userSkills.hackXp : userSkills.robXp;
  const currentLevel = getLevel(currentXp);
  const newXp = currentXp + training.xpReward;
  const newLevel = getLevel(newXp);
  
  // Use the level at which training was STARTED, not the current level
  // This prevents the bug where leveling up during training locks you out of training at the new level
  const trainingStartedAtLevel = training.startedAtLevel ?? currentLevel;
  
  // Update database - add XP, clear training, and mark trained at the level training was started
  const xpColumn = skill === 'hack' ? 'hack_xp' : 'rob_xp';
  const startColumn = skill === 'hack' ? 'hack_training_start' : 'rob_training_start';
  const endColumn = skill === 'hack' ? 'hack_training_end' : 'rob_training_end';
  const rewardColumn = skill === 'hack' ? 'hack_training_xp' : 'rob_training_xp';
  const trainedAtColumn = skill === 'hack' ? 'hack_trained_at_level' : 'rob_trained_at_level';
  const startedAtLevelColumn = skill === 'hack' ? 'hack_training_started_at_level' : 'rob_training_started_at_level';
  
  db.run(`
    UPDATE user_skills SET
      ${xpColumn} = ?,
      ${startColumn} = NULL,
      ${endColumn} = NULL,
      ${rewardColumn} = 0,
      ${trainedAtColumn} = ?,
      ${startedAtLevelColumn} = -1,
      last_activity = ?
    WHERE guild_id = ? AND user_id = ?
  `, [newXp, trainingStartedAtLevel, Date.now(), guildId, userId]);
  
  return {
    xpGained: training.xpReward,
    levelUp: newLevel > currentLevel,
    newLevel,
    totalXp: newXp
  };
}

// Start training for a skill
function startTraining(guildId, userId, skill) {
  if (!db) return { success: false, error: 'Database not available' };
  
  const userSkills = getUserSkills(guildId, userId);
  const settings = getSkillSettings(guildId);
  
  // Check if already training this skill
  const currentTraining = skill === 'hack' ? userSkills.hackTraining : userSkills.robTraining;
  if (currentTraining && currentTraining.endTime > Date.now()) {
    const remaining = currentTraining.endTime - Date.now();
    return { 
      success: false, 
      error: `Already training ${skill}! Complete in ${formatDuration(remaining)}`
    };
  }
  
  const currentLevel = skill === 'hack' ? userSkills.hackLevel : userSkills.robLevel;
  
  // Check if max level
  if (currentLevel >= 10) {
    return { success: false, error: `Already at max ${skill} level!` };
  }
  
  const nextLevel = currentLevel + 1;
  const cost = TRAINING_COSTS[nextLevel];
  const duration = TRAINING_TIMES[nextLevel];
  const xpReward = Math.floor(XP_PER_LEVEL[currentLevel] * (settings.trainingXpPercent / 100));
  
  const now = Date.now();
  const endTime = now + duration;
  
  // Update database - also record the level at which training was started
  const startColumn = skill === 'hack' ? 'hack_training_start' : 'rob_training_start';
  const endColumn = skill === 'hack' ? 'hack_training_end' : 'rob_training_end';
  const rewardColumn = skill === 'hack' ? 'hack_training_xp' : 'rob_training_xp';
  const startedAtLevelColumn = skill === 'hack' ? 'hack_training_started_at_level' : 'rob_training_started_at_level';
  
  db.run(`
    INSERT INTO user_skills (guild_id, user_id, ${startColumn}, ${endColumn}, ${rewardColumn}, ${startedAtLevelColumn})
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      ${startColumn} = ?,
      ${endColumn} = ?,
      ${rewardColumn} = ?,
      ${startedAtLevelColumn} = ?
  `, [guildId, userId, now, endTime, xpReward, currentLevel, now, endTime, xpReward, currentLevel]);
  
  return {
    success: true,
    cost,
    duration,
    xpReward,
    endTime,
    nextLevel
  };
}

// Get training cost for next level
function getTrainingInfo(guildId, userId, skill) {
  const userSkills = getUserSkills(guildId, userId);
  const settings = getSkillSettings(guildId);
  
  const currentLevel = skill === 'hack' ? userSkills.hackLevel : userSkills.robLevel;
  const currentTraining = skill === 'hack' ? userSkills.hackTraining : userSkills.robTraining;
  const trainedAtLevel = skill === 'hack' ? userSkills.hackTrainedAtLevel : userSkills.robTrainedAtLevel;
  
  if (currentLevel >= 10) {
    return { maxLevel: true };
  }
  
  // Check if already trained at this level - must level up before training again
  const alreadyTrainedAtLevel = trainedAtLevel === currentLevel;
  
  const nextLevel = currentLevel + 1;
  const cost = TRAINING_COSTS[nextLevel];
  const duration = TRAINING_TIMES[nextLevel];
  const xpReward = Math.floor(XP_PER_LEVEL[currentLevel] * (settings.trainingXpPercent / 100));
  
  return {
    maxLevel: false,
    currentLevel,
    nextLevel,
    cost,
    duration,
    xpReward,
    activeTraining: currentTraining && currentTraining.endTime > Date.now() ? currentTraining : null,
    alreadyTrainedAtLevel
  };
}

// Get level bonuses for hack
function getHackBonuses(guildId, userId) {
  const userSkills = getUserSkills(guildId, userId);
  const settings = getSkillSettings(guildId);
  const level = userSkills.hackLevel;
  
  return {
    level,
    successRateBonus: level * settings.hackSuccessRatePerLevel,
    maxStealBonus: level * settings.hackMaxStealPerLevel,
    cooldownReduction: level * settings.hackCooldownReductionPerLevel,
    traceReduction: level * settings.hackTraceReductionPerLevel
  };
}

// Get level bonuses for rob
function getRobBonuses(guildId, userId) {
  const userSkills = getUserSkills(guildId, userId);
  const settings = getSkillSettings(guildId);
  const level = userSkills.robLevel;
  
  return {
    level,
    successRateBonus: level * settings.robSuccessRatePerLevel,
    minStealBonus: level * settings.robMinStealPerLevel,
    maxStealBonus: level * settings.robMaxStealPerLevel,
    cooldownReduction: level * settings.robCooldownReductionPerLevel,
    fineReduction: level * settings.robFineReductionPerLevel
  };
}

// Format duration in human readable format
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// Create a progress bar
function createProgressBar(percent, length = 10) {
  const filled = Math.floor((percent / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// Apply level decay (called periodically)
function applyLevelDecay(guildId) {
  const settings = getSkillSettings(guildId);
  if (!settings.levelDecayEnabled) return;
  
  const cutoffTime = Date.now() - (settings.levelDecayDays * 24 * 60 * 60 * 1000);
  const decayPercent = settings.levelDecayXpPercent / 100;
  
  // Get all users who haven't been active
  const stmt = db.prepare(`
    SELECT user_id, hack_xp, rob_xp FROM user_skills 
    WHERE guild_id = ? AND last_activity < ? AND (hack_xp > 0 OR rob_xp > 0)
  `);
  stmt.bind([guildId, cutoffTime]);
  
  const updates = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const newHackXp = Math.floor(row.hack_xp * (1 - decayPercent));
    const newRobXp = Math.floor(row.rob_xp * (1 - decayPercent));
    updates.push({ userId: row.user_id, hackXp: newHackXp, robXp: newRobXp });
  }
  stmt.free();
  
  // Apply updates
  for (const update of updates) {
    db.run(`
      UPDATE user_skills SET hack_xp = ?, rob_xp = ?
      WHERE guild_id = ? AND user_id = ?
    `, [update.hackXp, update.robXp, guildId, update.userId]);
  }
  
  return updates.length;
}

module.exports = {
  initSkills,
  getSkillSettings,
  updateSkillSettings,
  getUserSkills,
  getLevel,
  getXpProgress,
  addXp,
  checkTrainingComplete,
  startTraining,
  getTrainingInfo,
  getHackBonuses,
  getRobBonuses,
  formatDuration,
  createProgressBar,
  applyLevelDecay,
  LEVEL_THRESHOLDS,
  XP_PER_LEVEL,
  TRAINING_COSTS,
  TRAINING_TIMES
};
