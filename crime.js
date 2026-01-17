// Crime module for Chat-Stock
// Handles /crime command with risk/reward mechanics

let db = null;

const DEFAULT_FLAVOR_TEXTS_SUCCESS = [
  "You successfully robbed a bank vault. The guards never saw you coming! 🏦",
  "You hacked into a crypto exchange and transferred some coins. 💻",
  "You ran an underground poker game and skimmed the pot. 🃏",
  "You sold 'designer' handbags that fell off a truck. 👜",
  "You pickpocketed a rich tourist in Times Square. 🎭",
  "You ran a fake charity and kept the donations. 💝",
  "You counterfeited concert tickets and sold them outside the venue. 🎫",
  "You siphoned gas from parked cars all night. ⛽",
  "You broke into a vending machine and took the coins. 🪙",
  "You sold fake IDs to college freshmen. 🪪",
  "You ran a pyramid scheme... successfully! 📐",
  "You stole copper wire from a construction site. 🔌",
  "You dined and dashed at a fancy restaurant. 🍽️",
  "You scammed people with a fake tech support call. 📞",
  "You shoplifted an entire shopping cart of goods. 🛒",
  "You ran an illegal street race and won the pot. 🏎️",
  "You sold 'premium' bottled tap water. 💧",
  "You stole packages off porches all day. 📦",
  "You hacked parking meters and collected the coins. 🅿️",
  "You ran a fake fundraiser car wash. 🚗",
  "You scalped tickets outside the stadium. 🎟️",
  "You stole lawn ornaments and held them for ransom. 🎅",
  "You ran an illegal gambling den in your basement. 🎰",
  "You cloned credit cards at an ATM. 💳",
  "You smuggled exotic animals across the border. 🦜",
  "You sold fake autographs on the internet. ✍️",
  "You ran a bootleg movie operation. 🎬",
  "You insider traded on a hot stock tip. 📈",
  "You broke into a car wash and stole quarters. 🧼",
  "You sold 'magic beans' to gullible tourists. 🫘"
];

const DEFAULT_FLAVOR_TEXTS_FAIL = [
  "You got caught red-handed robbing a store! 🚔",
  "The cops were waiting for you. It was a sting operation! 👮",
  "Your getaway car wouldn't start. Awkward. 🚗",
  "You tripped the silent alarm and got tackled by security. 🚨",
  "Your accomplice ratted you out for a plea deal. 🐀",
  "A witness recorded everything on their phone. 📱",
  "You accidentally robbed an undercover cop. 😬",
  "The dye pack exploded in your face. 💥",
  "You got caught on 47 different security cameras. 📹",
  "Your mask fell off mid-heist. Everyone saw your face. 🎭",
  "You left your wallet at the crime scene. Rookie mistake. 👛",
  "The dog you tried to bribe bit you instead. 🐕",
  "Your fake ID said 'McLovin'. They didn't buy it. 🪪",
  "You tried to hack a computer but it was a toaster. 🍞",
  "The vault was empty. Someone beat you to it. 📭",
  "You got stuck in the air vent. For 6 hours. 🕳️",
  "Your getaway driver left without you. 🚐",
  "You tried to pick a pocket but it was a fanny pack. 👜",
  "The 'sleeping' security guard was just resting his eyes. 👀",
  "You accidentally confessed on a hot mic. 🎤"
];

const DEFAULT_SETTINGS = {
  enabled: true,
  minReward: 100,
  maxReward: 500,
  cooldownHours: 2,
  successRate: 60,          // % chance of success
  fineMinPercent: 10,       // Minimum fine as % of reward range max
  fineMaxPercent: 30,       // Maximum fine as % of reward range max
  flavorTextsSuccess: DEFAULT_FLAVOR_TEXTS_SUCCESS,
  flavorTextsFail: DEFAULT_FLAVOR_TEXTS_FAIL
};

// Cache for settings per guild
const guildCrimeSettings = new Map();

function initCrime(database) {
  db = database;
  
  // Create crime settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS crime_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      min_reward INTEGER DEFAULT 100,
      max_reward INTEGER DEFAULT 500,
      cooldown_hours INTEGER DEFAULT 2,
      success_rate INTEGER DEFAULT 60,
      fine_min_percent INTEGER DEFAULT 10,
      fine_max_percent INTEGER DEFAULT 30,
      flavor_texts_success TEXT,
      flavor_texts_fail TEXT
    )
  `);
  
  // Create crime tracker table
  db.run(`
    CREATE TABLE IF NOT EXISTS crime_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_crime_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create crime history table
  db.run(`
    CREATE TABLE IF NOT EXISTS crime_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      flavor_text TEXT,
      crime_time INTEGER NOT NULL
    )
  `);
  
  console.log('🔫 Crime system initialized');
}

function getCrimeSettings(guildId) {
  if (guildCrimeSettings.has(guildId)) {
    return guildCrimeSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const stmt = db.prepare(`SELECT * FROM crime_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    const settings = {
      enabled: row.enabled === 1,
      minReward: row.min_reward,
      maxReward: row.max_reward,
      cooldownHours: row.cooldown_hours,
      successRate: row.success_rate,
      fineMinPercent: row.fine_min_percent,
      fineMaxPercent: row.fine_max_percent,
      flavorTextsSuccess: row.flavor_texts_success ? JSON.parse(row.flavor_texts_success) : DEFAULT_FLAVOR_TEXTS_SUCCESS,
      flavorTextsFail: row.flavor_texts_fail ? JSON.parse(row.flavor_texts_fail) : DEFAULT_FLAVOR_TEXTS_FAIL
    };
    stmt.free();
    guildCrimeSettings.set(guildId, settings);
    return settings;
  }
  
  stmt.free();
  guildCrimeSettings.set(guildId, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

function updateCrimeSettings(guildId, updates) {
  if (!db) return;
  
  const current = getCrimeSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO crime_settings 
    (guild_id, enabled, min_reward, max_reward, cooldown_hours, success_rate, fine_min_percent, fine_max_percent, flavor_texts_success, flavor_texts_fail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.minReward,
    settings.maxReward,
    settings.cooldownHours,
    settings.successRate,
    settings.fineMinPercent,
    settings.fineMaxPercent,
    JSON.stringify(settings.flavorTextsSuccess),
    JSON.stringify(settings.flavorTextsFail)
  ]);
  
  guildCrimeSettings.set(guildId, settings);
}

function canCrime(guildId, userId) {
  if (!db) return { canCrime: false, reason: 'Database not initialized' };
  
  const settings = getCrimeSettings(guildId);
  
  if (!settings.enabled) {
    return { canCrime: false, reason: 'Crime is currently disabled on this server.' };
  }
  
  const stmt = db.prepare(`SELECT last_crime_time FROM crime_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);
  
  let lastCrimeTime = 0;
  if (stmt.step()) {
    lastCrimeTime = stmt.getAsObject().last_crime_time;
  }
  stmt.free();
  
  const now = Date.now();
  const cooldownMs = settings.cooldownHours * 60 * 60 * 1000;
  const timeSinceCrime = now - lastCrimeTime;
  
  if (timeSinceCrime < cooldownMs) {
    const remainingMs = cooldownMs - timeSinceCrime;
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    
    return {
      canCrime: false,
      reason: `You need to lay low! Come back in **${hours}h ${minutes}m**.`,
      timeRemaining: remainingMs
    };
  }
  
  return { canCrime: true };
}

function attemptCrime(settings) {
  const roll = Math.random() * 100;
  return roll < settings.successRate;
}

function calculateCrimeReward(settings) {
  const min = settings.minReward;
  const max = settings.maxReward;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateFine(settings, totalBalance) {
  const minFine = Math.floor(totalBalance * (settings.fineMinPercent / 100));
  const maxFine = Math.floor(totalBalance * (settings.fineMaxPercent / 100));
  // Ensure minimum fine of 1 if user has any balance
  const fine = Math.floor(Math.random() * (maxFine - minFine + 1)) + minFine;
  return Math.max(fine, totalBalance > 0 ? 1 : 0);
}

function getRandomSuccessText(settings) {
  const texts = settings.flavorTextsSuccess || DEFAULT_FLAVOR_TEXTS_SUCCESS;
  return texts[Math.floor(Math.random() * texts.length)];
}

function getRandomFailText(settings) {
  const texts = settings.flavorTextsFail || DEFAULT_FLAVOR_TEXTS_FAIL;
  return texts[Math.floor(Math.random() * texts.length)];
}

function recordCrime(guildId, userId, success, amount, flavorText) {
  if (!db) return;
  
  const now = Date.now();
  
  // Update tracker
  db.run(`
    INSERT OR REPLACE INTO crime_tracker (guild_id, user_id, last_crime_time)
    VALUES (?, ?, ?)
  `, [guildId, userId, now]);
  
  // Record history
  db.run(`
    INSERT INTO crime_history (guild_id, user_id, success, amount, flavor_text, crime_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, userId, success ? 1 : 0, amount, flavorText, now]);
}

function getCrimeHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const stmt = db.prepare(`
    SELECT * FROM crime_history 
    WHERE guild_id = ? AND user_id = ?
    ORDER BY crime_time DESC
    LIMIT ?
  `);
  stmt.bind([guildId, userId, limit]);
  
  const history = [];
  while (stmt.step()) {
    history.push(stmt.getAsObject());
  }
  stmt.free();
  
  return history;
}

function getCrimeStats(guildId, userId) {
  if (!db) return { totalGained: 0, totalLost: 0, successes: 0, failures: 0 };
  
  const stmt = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN success = 1 THEN amount ELSE 0 END), 0) as total_gained,
      COALESCE(SUM(CASE WHEN success = 0 THEN amount ELSE 0 END), 0) as total_lost,
      COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) as successes,
      COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failures
    FROM crime_history 
    WHERE guild_id = ? AND user_id = ?
  `);
  stmt.bind([guildId, userId]);
  
  let stats = { totalGained: 0, totalLost: 0, successes: 0, failures: 0 };
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stats = {
      totalGained: row.total_gained,
      totalLost: row.total_lost,
      successes: row.successes,
      failures: row.failures
    };
  }
  stmt.free();
  
  return stats;
}

function addSuccessFlavorText(guildId, text) {
  const settings = getCrimeSettings(guildId);
  const texts = [...settings.flavorTextsSuccess, text];
  updateCrimeSettings(guildId, { flavorTextsSuccess: texts });
  return texts.length;
}

function addFailFlavorText(guildId, text) {
  const settings = getCrimeSettings(guildId);
  const texts = [...settings.flavorTextsFail, text];
  updateCrimeSettings(guildId, { flavorTextsFail: texts });
  return texts.length;
}

function removeSuccessFlavorText(guildId, index) {
  const settings = getCrimeSettings(guildId);
  if (index < 0 || index >= settings.flavorTextsSuccess.length) return false;
  
  const texts = [...settings.flavorTextsSuccess];
  texts.splice(index, 1);
  updateCrimeSettings(guildId, { flavorTextsSuccess: texts });
  return true;
}

function removeFailFlavorText(guildId, index) {
  const settings = getCrimeSettings(guildId);
  if (index < 0 || index >= settings.flavorTextsFail.length) return false;
  
  const texts = [...settings.flavorTextsFail];
  texts.splice(index, 1);
  updateCrimeSettings(guildId, { flavorTextsFail: texts });
  return true;
}

function resetFlavorTexts(guildId) {
  updateCrimeSettings(guildId, { 
    flavorTextsSuccess: DEFAULT_FLAVOR_TEXTS_SUCCESS,
    flavorTextsFail: DEFAULT_FLAVOR_TEXTS_FAIL
  });
}

module.exports = {
  initCrime,
  getCrimeSettings,
  updateCrimeSettings,
  canCrime,
  attemptCrime,
  calculateCrimeReward,
  calculateFine,
  getRandomSuccessText,
  getRandomFailText,
  recordCrime,
  getCrimeHistory,
  getCrimeStats,
  addSuccessFlavorText,
  addFailFlavorText,
  removeSuccessFlavorText,
  removeFailFlavorText,
  resetFlavorTexts,
  DEFAULT_FLAVOR_TEXTS_SUCCESS,
  DEFAULT_FLAVOR_TEXTS_FAIL
};
