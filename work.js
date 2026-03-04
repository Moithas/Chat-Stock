// Work module for Chat-Stock
// Handles /work command with configurable rewards and flavor texts

let db = null;

const DEFAULT_FLAVOR_TEXTS = [
  "You spent the day flipping burgers at McStonks. 🍔",
  "You delivered packages for Bezos Prime. 📦",
  "You drove for Über Eats and only got lost twice. 🚗",
  "You walked dogs in the park and stepped in something... 🐕",
  "You mowed lawns and found $5 in the grass! 🌿",
  "You babysat the neighbor's demon children. 👶",
  "You did some freelance graphic design (MS Paint). 🎨",
  "You sold lemonade on a hot day. 🍋",
  "You busked on the street corner with a kazoo. 🎵",
  "You participated in a medical study. What could go wrong? 💊",
  "You were an extra in a low-budget movie. 🎬",
  "You did tech support for your grandma. Again. 👵",
  "You streamed to 3 whole viewers! 📺",
  "You sold feet pics. No judgment here. 🦶",
  "You won a hot dog eating contest. 🌭",
  "You found change in vending machines all day. 🪙",
  "You became a professional line-stander. 🧍",
  "You taste-tested expired food for science. 🧪",
  "You worked as a shopping cart wrangler. 🛒",
  "You were a human billboard. How dignified. 🪧",
  "You cleaned pools and found a wedding ring! 🏊",
  "You did data entry until your eyes crossed. ⌨️",
  "You tutored kids in math you barely understand. 📐",
  "You worked the night shift at 7-Eleven. 🏪",
  "You delivered newspapers like it's 1995. 📰",
  "You were a mystery shopper at the dollar store. 🛍️",
  "You sold your plasma. Twice. 🩸",
  "You DJ'd a kid's birthday party. 🎉",
  "You worked as a parking lot attendant. 🅿️",
  "You assembled IKEA furniture for people. 🪑",
  "You did some questionable telemarketing. 📞",
  "You were a mall Santa in July. 🎅",
  "You tested mattresses professionally. 🛏️",
  "You worked as a professional cuddler. 🤗",
  "You sold homemade jewelry on Etsy. 💍",
  "You did yard work for the whole neighborhood. 🍂",
  "You drove a food truck and only one fire! 🔥",
  "You worked as a mascot. The suit smelled weird. 🐻",
  "You did voice work for an ad. Meow Mix! 🐱",
  "You fixed computers at the retirement home. 💻",
  "You worked as a lifeguard (nothing happened). 🏖️",
  "You cleaned out someone's garage. Found treasure! 🗑️",
  "You did odd jobs on TaskRabbit. 🐰",
  "You were a wedding singer. Only slightly off-key. 💒",
  "You wrote product reviews for $0.10 each. ⭐",
  "You moderated a Discord server. For pay! 🎮",
  "You worked as a tour guide for tourists. 🗺️",
  "You organized someone's closet by color. 👔",
  "You were a focus group participant. 🗣️",
  "You sold handmade candles at a craft fair. 🕯️"
];

const DEFAULT_SETTINGS = {
  enabled: true,
  minReward: 50,
  maxReward: 200,
  cooldownHours: 2,  // Same as passive income by default
  flavorTexts: DEFAULT_FLAVOR_TEXTS
};

// Cache for settings per guild
const guildWorkSettings = new Map();

function initWork(database) {
  db = database;
  
  // Create work settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS work_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      min_reward INTEGER DEFAULT 50,
      max_reward INTEGER DEFAULT 200,
      cooldown_hours INTEGER DEFAULT 2,
      flavor_texts TEXT
    )
  `);
  
  // Create work tracker table
  db.run(`
    CREATE TABLE IF NOT EXISTS work_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_work_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create work history table
  db.run(`
    CREATE TABLE IF NOT EXISTS work_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      flavor_text TEXT,
      work_time INTEGER NOT NULL
    )
  `);
  
  // Create indexes for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_work_tracker_guild_user ON work_tracker(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_work_history_guild_user ON work_history(guild_id, user_id)`);
  
  console.log('💼 Work system initialized');
}

function getWorkSettings(guildId) {
  if (guildWorkSettings.has(guildId)) {
    return guildWorkSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const stmt = db.prepare(`SELECT * FROM work_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    const settings = {
      enabled: row.enabled === 1,
      minReward: row.min_reward,
      maxReward: row.max_reward,
      cooldownHours: row.cooldown_hours,
      flavorTexts: row.flavor_texts ? JSON.parse(row.flavor_texts) : DEFAULT_FLAVOR_TEXTS
    };
    stmt.free();
    guildWorkSettings.set(guildId, settings);
    return settings;
  }
  
  stmt.free();
  guildWorkSettings.set(guildId, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

function updateWorkSettings(guildId, updates) {
  if (!db) return;
  
  const current = getWorkSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO work_settings 
    (guild_id, enabled, min_reward, max_reward, cooldown_hours, flavor_texts)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.minReward,
    settings.maxReward,
    settings.cooldownHours,
    JSON.stringify(settings.flavorTexts)
  ]);
  
  guildWorkSettings.set(guildId, settings);
}

function canWork(guildId, userId, cooldownReduction = 0) {
  if (!db) return { canWork: false, reason: 'Database not initialized' };
  
  const settings = getWorkSettings(guildId);
  
  if (!settings.enabled) {
    return { canWork: false, reason: 'Work is currently disabled on this server.' };
  }
  
  const stmt = db.prepare(`SELECT last_work_time FROM work_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);
  
  let lastWorkTime = 0;
  if (stmt.step()) {
    lastWorkTime = stmt.getAsObject().last_work_time;
  }
  stmt.free();
  
  const now = Date.now();
  const baseCooldownMs = settings.cooldownHours * 60 * 60 * 1000;
  const cooldownMs = baseCooldownMs * (1 - cooldownReduction / 100);
  const timeSinceWork = now - lastWorkTime;
  
  if (timeSinceWork < cooldownMs) {
    const remainingMs = cooldownMs - timeSinceWork;
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    
    return {
      canWork: false,
      reason: `You need to rest! Come back in **${hours}h ${minutes}m**.`,
      timeRemaining: remainingMs
    };
  }
  
  return { canWork: true };
}

function calculateWorkReward(settings) {
  const min = settings.minReward;
  const max = settings.maxReward;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFlavorText(settings) {
  const texts = settings.flavorTexts || DEFAULT_FLAVOR_TEXTS;
  return texts[Math.floor(Math.random() * texts.length)];
}

function recordWork(guildId, userId, amount, flavorText) {
  if (!db) return;
  
  const now = Date.now();
  
  // Update tracker
  db.run(`
    INSERT OR REPLACE INTO work_tracker (guild_id, user_id, last_work_time)
    VALUES (?, ?, ?)
  `, [guildId, userId, now]);
  
  // Record history
  db.run(`
    INSERT INTO work_history (guild_id, user_id, amount, flavor_text, work_time)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, userId, amount, flavorText, now]);
}

function getWorkHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const stmt = db.prepare(`
    SELECT * FROM work_history 
    WHERE guild_id = ? AND user_id = ?
    ORDER BY work_time DESC
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

function getTotalWorked(guildId, userId) {
  if (!db) return 0;
  
  const stmt = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM work_history 
    WHERE guild_id = ? AND user_id = ?
  `);
  stmt.bind([guildId, userId]);
  
  let total = 0;
  if (stmt.step()) {
    total = stmt.getAsObject().total;
  }
  stmt.free();
  
  return total;
}

function getWorkCount(guildId, userId) {
  if (!db) return 0;
  
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM work_history 
    WHERE guild_id = ? AND user_id = ?
  `);
  stmt.bind([guildId, userId]);
  
  let count = 0;
  if (stmt.step()) {
    count = stmt.getAsObject().count;
  }
  stmt.free();
  
  return count;
}

function getLastWorkTime(guildId, userId) {
  if (!db) return 0;
  
  const stmt = db.prepare(`SELECT last_work_time FROM work_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);
  
  let lastTime = 0;
  if (stmt.step()) {
    lastTime = stmt.getAsObject().last_work_time;
  }
  stmt.free();
  
  return lastTime;
}

function addFlavorText(guildId, text) {
  const settings = getWorkSettings(guildId);
  const texts = [...settings.flavorTexts, text];
  updateWorkSettings(guildId, { flavorTexts: texts });
  return texts.length;
}

function removeFlavorText(guildId, index) {
  const settings = getWorkSettings(guildId);
  if (index < 0 || index >= settings.flavorTexts.length) return false;
  
  const texts = [...settings.flavorTexts];
  texts.splice(index, 1);
  updateWorkSettings(guildId, { flavorTexts: texts });
  return true;
}

function resetFlavorTexts(guildId) {
  updateWorkSettings(guildId, { flavorTexts: DEFAULT_FLAVOR_TEXTS });
}

module.exports = {
  initWork,
  getWorkSettings,
  updateWorkSettings,
  canWork,
  calculateWorkReward,
  getRandomFlavorText,
  recordWork,
  getWorkHistory,
  getTotalWorked,
  getWorkCount,
  getLastWorkTime,
  addFlavorText,
  removeFlavorText,
  resetFlavorTexts,
  DEFAULT_FLAVOR_TEXTS
};
