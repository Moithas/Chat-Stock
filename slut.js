// Slut module for Chat-Stock
// Handles /slut command with risk/reward mechanics (adult themed)

let db = null;

const DEFAULT_FLAVOR_TEXTS_SUCCESS = [
  "You spent a steamy night with a wealthy politician. They tipped generously! 💋",
  "A CEO paid for your 'consulting services' at the business conference. 💼",
  "You worked the VIP section at the club and came home loaded. 🥂",
  "A bachelor party hired you as their 'entertainment coordinator'. 🎉",
  "You sold feet pics to a very enthusiastic collector. 🦶",
  "A movie producer needed a 'personal assistant' for the weekend. 🎬",
  "You became a sugar baby for a tech billionaire. Sweet deal! 🍬",
  "An influencer paid you to be in their spicy content. 📸",
  "You worked as a 'dancer' at an exclusive gentleman's club. 💃",
  "A lonely oil tycoon flew you out on their private jet. ✈️",
  "You sold your bathwater online. It sold out instantly. 🛁",
  "A famous athlete paid for your 'companionship'. 🏆",
  "You hosted a very lucrative OnlyFans livestream. 📱",
  "A wealthy widow needed 'comfort' and paid handsomely. 💀",
  "You worked the champagne room and made bank. 🍾",
  "A crypto bro paid you in actual money for once. 🪙",
  "You were hired as arm candy at a red carpet event. 🌟",
  "A bored housewife paid for your 'pool cleaning services'. 🏊",
  "You modeled for an 'artistic' photoshoot. Very tasteful. 📷",
  "A divorce lawyer hired you to 'gather evidence'. 🕵️",
  "You won the 'bikini contest' at the beach bar. 👙",
  "A rock star invited you backstage. The afterparty paid well. 🎸",
  "You became someone's 'tennis instructor'. No tennis was played. 🎾",
  "A Wall Street banker needed stress relief. Cha-ching! 💰",
  "You got paid to be someone's fake girlfriend at a wedding. 💒",
  "An art collector hired you as a 'muse'. Very inspiring. 🎨",
  "You worked at a masquerade ball. What happens there, stays there. 🎭",
  "A famous chef needed someone to 'taste test' their desserts. 🍰",
  "You became a yacht girl for the weekend. Smooth sailing! ⛵",
  "A billionaire paid you to pretend to be their ex at a party. 🎭",
  "You sold 'premium' Snapchat access to desperate simps. 📲",
  "A Saudi prince needed a 'tour guide' in Monaco. 🇲🇨",
  "You worked as a 'booth babe' at a car show. Vroom vroom! 🏎️",
  "A retired athlete paid for your 'physical therapy'. 💆",
  "You hosted a very exclusive webcam show for whales. 🐋",
  "A music video needed 'background dancers'. You were front and center. 🎵",
  "You got sponsored by an energy drink for your 'content'. ⚡",
  "A reality TV producer paid for 'exclusive access'. 📺",
  "You became a professional cuddler. Big spoon energy! 🥄",
  "A lonely programmer paid you to watch them code. Easy money. 💻",
  "You worked the after-hours scene at a casino. High rollers tip well. 🎰",
  "A fashion designer needed a 'fit model'. Emphasis on fit. 👗",
  "You sold your worn socks online. Don't ask. 🧦",
  "A bored millionaire paid you to just exist near them. 🤷",
  "You were hired for a 'massage' at a five-star hotel. ✨",
  "A diplomat needed 'translation services'. Wink wink. 🌍",
  "You modeled lingerie for a 'catalog'. Very exclusive catalog. 👙",
  "A hedge fund manager needed a 'date' for the gala. 🎩",
  "You got paid to ghost write someone's Tinder bio. 💘",
  "A bachelorette party got wild. You profited. 👰",
  "You sold your hair to a wig maker. It was expensive hair. 💇",
  "A lonely CEO paid you to eat dinner with them. Just dinner. 🍝",
  "You became someone's 'assistant' at Coachella. 🏜️",
  "A pharmaceutical exec needed a 'test subject'. Clinical indeed. 💊",
  "You worked at a 'gentlemen's spa'. Very relaxing. 🧖",
  "A movie star paid for your discretion. Lips sealed! 🤐",
  "You sold voice notes of you saying nice things. ASMR money! 🎧",
  "A politician needed a 'campaign volunteer'. Special volunteering. 🗳️",
  "You were a professional third wheel for awkward dates. 🚲",
  "A famous DJ flew you out for 'the vibes'. Good vibes paid well. 🎧",
  "You got paid to be someone's gym 'spotter'. Very hands-on. 💪",
  "A wealthy tourist needed a 'local guide'. Very thorough tour. 🗺️",
  "You became a premium Twitch streamer's 'mod'. Special modding. 🎮",
  "A lonely astronomer paid you to 'stargaze' with them. 🌟",
  "You worked at an 'exclusive' car wash. Hand wash only. 🚿",
  "A celebrity chef paid for your 'company' at the restaurant. 👨‍🍳",
  "You sold personalized video messages. Very personalized. 🎥",
  "A retired boxer paid for 'sparring practice'. 🥊",
  "You became a yacht captain's 'first mate'. Aye aye! ⚓",
  "A tech investor funded your 'startup'. It's called OnlyYou. 📈",
  "You worked the high-roller poker tables. Not playing cards. 🃏",
  "A soap opera star hired you as their 'acting coach'. 🎭",
  "You sold mystery boxes of your 'personal items'. 📦",
  "A wine connoisseur paid for your 'tasting notes'. 🍷",
  "You became a professional 'dog walker'. The dogs stayed home. 🐕",
  "A real estate mogul needed help 'staging' their mansion. 🏠",
  "You hosted a 'book club'. No books were read. 📚",
  "A reclusive author needed 'inspiration' for their novel. ✍️",
  "You were hired as a 'life coach'. Very personal coaching. 🧘",
  "A famous painter wanted to capture your 'essence'. 🖼️",
  "You sold used gym clothes to weirdos online. Ka-ching! 👟",
  "A sports team owner needed a 'good luck charm'. 🍀",
  "You became a professional 'picnic planner'. Intimate picnics. 🧺",
  "A lonely venture capitalist invested in 'you'. Great ROI! 📊",
  "You worked the after-party at the Oscars. Awards were given. 🏆",
  "A famous architect needed help with their 'blueprints'. 📐",
  "You sold exclusive voice memos. Your voice is expensive. 🗣️",
  "A count from Monaco needed a 'plus one'. Very royal. 👑",
  "You became someone's 'personal shopper'. Very personal fitting room. 🛍️",
  "A pharmaceutical heir needed 'emotional support'. 💝",
  "You worked at a 'cat cafe'. There were no cats. 🐱",
  "A famous magician needed an 'assistant'. You disappeared... into their wallet. 🪄",
  "You sold custom playlists for 'special moments'. 🎵",
  "A tech mogul paid you to delete their browser history. 🗑️",
  "You became a professional 'house sitter'. The house was occupied. 🏡",
  "A billionaire's kid rebelled by hiring you. Thanks, daddy issues! 🙏",
  "You worked at an 'underground' massage parlor. Deep tissue. 💆",
  "A race car driver needed help with their 'pit stop'. 🏁",
  "You sold your old love letters. Vintage romance is pricey! 💌",
  "A famous sculptor needed a 'model'. You're now immortalized. 🗿",
  "You became a professional 'Netflix and chiller'. 📺"
];

const DEFAULT_FLAVOR_TEXTS_FAIL = [
  "Your client's spouse came home early. You escaped through the window! 🪟",
  "An undercover cop busted your street corner operation. 🚔",
  "Your OnlyFans got hacked and you had to pay for 'damage control'. 😰",
  "A jealous ex exposed your side hustle on social media. 📱",
  "The 'wealthy businessman' paid with a bounced check. 💸",
  "You got catfished by a reporter doing an exposé. 📰",
  "Your client turned out to be a politician... during an election. 🗳️",
  "The hotel security caught you and demanded 'hush money'. 🤫",
  "A rival escort sabotaged your reputation. Drama! 🎭",
  "Your sugar daddy's accountant flagged the payments. Audit time! 📋",
  "The paparazzi caught you with a celebrity. Damage control needed. 📸",
  "Your client's bodyguard caught you stealing from the minibar. 🥃",
  "A streaming 'accident' exposed more than intended. 😳",
  "Your fake profile got reported and you had to start over. 🚫",
  "A client's wife hired a PI who got photos. Blackmail incoming! 🕵️",
  "You got banned from the club for 'excessive entrepreneurship'. 🚷",
  "The yacht party was actually a police sting. Swim away! 🏊",
  "Your Venmo got frozen for 'suspicious activity'. 🧊",
  "A client left a terrible review on your... services. ⭐",
  "You got kicked out of the casino for 'solicitation'. 🎰",
  "The masseuse license inspector showed up unexpectedly. 📜",
  "Your 'manager' took a bigger cut than agreed. Pimped! 😤",
  "The 'modeling agency' was actually a pyramid scheme. 📐",
  "You caught feelings and gave a refund. Rookie mistake! 💔",
  "A client's credit card got declined... after services rendered. 💳",
  "The bachelor party Venmo'd you with a memo. Now it's evidence. 📝",
  "Your FaceTime 'show' was recorded and used as blackmail. 📹",
  "You got locked out of your apartment and lost a whole night's work. 🔐",
  "The 'movie producer' was actually just a weird guy with a camera. 🎥",
  "Your crypto payment went to the wrong wallet. Gone forever! 🪙",
  "A rival created a fake profile of you and took your clients. 👥",
  "The 'exclusive club' was a police sting operation. 🚨",
  "You got food poisoning at the fancy dinner. Bad timing! 🤢",
  "Your Uber driver recognized you and told everyone. 🚗",
  "The 'art collector' wanted to pay in exposure. 🎨",
  "A client's kid walked in at the worst possible moment. 👶",
  "Your ring light died during a premium show. Refunds issued. 💡",
  "The hotel concierge demanded a bigger 'tip'. 🛎️",
  "You got stood up by a whale after turning down other clients. 🐋",
  "A 'regular' ghosted you after you bought new lingerie. 👻",
  "The champagne room had hidden cameras. Evidence destroyed... expensively. 📼",
  "Your LLC got flagged by the IRS. Creative accounting needed! 📊",
  "A jealous admirer slashed your car tires. Insurance doesn't cover that. 🚗",
  "The 'billionaire' was actually three kids in a trenchcoat. 🧥",
  "Your professional photos got leaked to your hometown Facebook group. 😱",
  "A client wanted a refund for 'not meeting expectations'. 📉",
  "The 'exclusive party' was a timeshare presentation. 🏨",
  "Your burner phone got confiscated during a traffic stop. 📱",
  "A client paid in gift cards. They were all used. 🎁",
  "You got recognized at church the next morning. Awkward. ⛪"
];

const DEFAULT_SETTINGS = {
  enabled: false,  // Disabled by default since it's adult content
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
const guildSlutSettings = new Map();

function initSlut(database) {
  db = database;
  
  // Create slut settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS slut_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
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
  
  // Create slut tracker table
  db.run(`
    CREATE TABLE IF NOT EXISTS slut_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_slut_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create slut history table
  db.run(`
    CREATE TABLE IF NOT EXISTS slut_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      flavor_text TEXT,
      slut_time INTEGER NOT NULL
    )
  `);
  
  // Create indexes for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_slut_tracker_guild_user ON slut_tracker(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_slut_history_guild_user ON slut_history(guild_id, user_id)`);
  
  console.log('💋 Slut system initialized');
}

function getSlutSettings(guildId) {
  if (guildSlutSettings.has(guildId)) {
    return guildSlutSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const stmt = db.prepare(`SELECT * FROM slut_settings WHERE guild_id = ?`);
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
    guildSlutSettings.set(guildId, settings);
    return settings;
  }
  
  stmt.free();
  guildSlutSettings.set(guildId, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

function updateSlutSettings(guildId, updates) {
  if (!db) return;
  
  const current = getSlutSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO slut_settings 
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
  
  guildSlutSettings.set(guildId, settings);
}

function canSlut(guildId, userId) {
  if (!db) return { canSlut: false, reason: 'Database not initialized' };
  
  const settings = getSlutSettings(guildId);
  
  if (!settings.enabled) {
    return { canSlut: false, reason: 'This command is currently disabled on this server.' };
  }
  
  const stmt = db.prepare(`SELECT last_slut_time FROM slut_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);
  
  let lastSlutTime = 0;
  if (stmt.step()) {
    lastSlutTime = stmt.getAsObject().last_slut_time;
  }
  stmt.free();
  
  const now = Date.now();
  const cooldownMs = settings.cooldownHours * 60 * 60 * 1000;
  const timeSince = Math.max(0, now - lastSlutTime);
  
  if (timeSince < cooldownMs) {
    const remaining = cooldownMs - timeSince;
    const minutes = Math.ceil(remaining / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    let timeStr;
    if (hours > 0) {
      timeStr = `${hours}h ${mins}m`;
    } else {
      timeStr = `${mins} minutes`;
    }
    
    return { canSlut: false, reason: `You need to rest! Try again in **${timeStr}**.`, timeRemaining: remaining };
  }
  
  return { canSlut: true };
}

function attemptSlut(settings) {
  const roll = Math.random() * 100;
  return roll < settings.successRate;
}

function calculateSlutReward(settings) {
  return Math.floor(Math.random() * (settings.maxReward - settings.minReward + 1)) + settings.minReward;
}

function calculateFine(settings, totalBalance) {
  // Fine is a percentage of the user's total balance (same as crime)
  const minFine = Math.floor(totalBalance * (settings.fineMinPercent / 100));
  const maxFine = Math.floor(totalBalance * (settings.fineMaxPercent / 100));
  const fine = Math.floor(Math.random() * (maxFine - minFine + 1)) + minFine;
  // Ensure minimum fine of 1 if user has any balance
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

function recordSlut(guildId, userId, success, amount, flavorText) {
  if (!db) return;
  
  // Update tracker
  db.run(`
    INSERT OR REPLACE INTO slut_tracker (guild_id, user_id, last_slut_time)
    VALUES (?, ?, ?)
  `, [guildId, userId, Date.now()]);
  
  // Record history
  db.run(`
    INSERT INTO slut_history (guild_id, user_id, success, amount, flavor_text, slut_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, userId, success ? 1 : 0, amount, flavorText, Date.now()]);
}

function getSlutStats(guildId, userId) {
  if (!db) return { successes: 0, failures: 0, totalGained: 0, totalLost: 0 };
  
  const result = db.exec(`
    SELECT 
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      SUM(CASE WHEN success = 1 THEN amount ELSE 0 END) as total_gained,
      SUM(CASE WHEN success = 0 THEN amount ELSE 0 END) as total_lost
    FROM slut_history
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, userId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const [successes, failures, totalGained, totalLost] = result[0].values[0];
    return {
      successes: successes || 0,
      failures: failures || 0,
      totalGained: totalGained || 0,
      totalLost: totalLost || 0
    };
  }
  
  return { successes: 0, failures: 0, totalGained: 0, totalLost: 0 };
}

function resetSlutMessages(guildId) {
  if (!db) return;
  
  updateSlutSettings(guildId, {
    flavorTextsSuccess: DEFAULT_FLAVOR_TEXTS_SUCCESS,
    flavorTextsFail: DEFAULT_FLAVOR_TEXTS_FAIL
  });
}

function addSlutSuccessFlavorText(guildId, text) {
  const settings = getSlutSettings(guildId);
  const texts = [...settings.flavorTextsSuccess, text];
  updateSlutSettings(guildId, { flavorTextsSuccess: texts });
  return texts.length;
}

function addSlutFailFlavorText(guildId, text) {
  const settings = getSlutSettings(guildId);
  const texts = [...settings.flavorTextsFail, text];
  updateSlutSettings(guildId, { flavorTextsFail: texts });
  return texts.length;
}

function removeSlutSuccessFlavorText(guildId, index) {
  const settings = getSlutSettings(guildId);
  const texts = settings.flavorTextsSuccess.filter((_, i) => i !== index);
  updateSlutSettings(guildId, { flavorTextsSuccess: texts });
  return texts.length;
}

function removeSlutFailFlavorText(guildId, index) {
  const settings = getSlutSettings(guildId);
  const texts = settings.flavorTextsFail.filter((_, i) => i !== index);
  updateSlutSettings(guildId, { flavorTextsFail: texts });
  return texts.length;
}

module.exports = {
  initSlut,
  getSlutSettings,
  updateSlutSettings,
  canSlut,
  attemptSlut,
  calculateSlutReward,
  calculateFine,
  getRandomSuccessText,
  getRandomFailText,
  recordSlut,
  getSlutStats,
  resetSlutMessages,
  addSlutSuccessFlavorText,
  addSlutFailFlavorText,
  removeSlutSuccessFlavorText,
  removeSlutFailFlavorText,
  DEFAULT_FLAVOR_TEXTS_SUCCESS,
  DEFAULT_FLAVOR_TEXTS_FAIL
};
