// Lucky Penny System - Random buff/debuff/currency/nothing roller
// Uses the items.js active_effects table for buff storage

const { saveDatabase, migrateAddColumn } = require('./database');

let db = null;

// Lucky Penny-specific effect types (added to items.js EFFECT_TYPES too)
const LP_EFFECT_TYPES = {
  WORK_PAYOUT: 'lp_work_payout',           // +/- % work payout
  HACK_SUCCESS: 'lp_hack_success',         // +/- % hack success rate
  ROB_SUCCESS: 'lp_rob_success',           // +/- % rob success rate
  WORK_COOLDOWN: 'lp_work_cooldown',       // +/- % work cooldown
  HACK_COOLDOWN: 'lp_hack_cooldown',       // +/- % hack cooldown
  ROB_COOLDOWN: 'lp_rob_cooldown',         // +/- % rob cooldown
  HACK_FINES: 'lp_hack_fines',             // +/- % hack fines
  ROB_FINES: 'lp_rob_fines',               // +/- % rob fines
  HACK_XP: 'lp_hack_xp',                   // +/- % hack XP earned
  ROB_XP: 'lp_rob_xp',                     // +/- % rob XP earned
  STOCK_PRICES: 'lp_stock_prices'           // +/- % personal stock price modifier
};

// Human-readable names for each effect
const LP_EFFECT_NAMES = {
  [LP_EFFECT_TYPES.WORK_PAYOUT]: 'Work Payout',
  [LP_EFFECT_TYPES.HACK_SUCCESS]: 'Hack Success Rate',
  [LP_EFFECT_TYPES.ROB_SUCCESS]: 'Rob Success Rate',
  [LP_EFFECT_TYPES.WORK_COOLDOWN]: 'Work Cooldown',
  [LP_EFFECT_TYPES.HACK_COOLDOWN]: 'Hack Cooldown',
  [LP_EFFECT_TYPES.ROB_COOLDOWN]: 'Rob Cooldown',
  [LP_EFFECT_TYPES.HACK_FINES]: 'Hack Fines',
  [LP_EFFECT_TYPES.ROB_FINES]: 'Rob Fines',
  [LP_EFFECT_TYPES.HACK_XP]: 'Hack XP',
  [LP_EFFECT_TYPES.ROB_XP]: 'Rob XP',
  [LP_EFFECT_TYPES.STOCK_PRICES]: 'Stock Prices'
};

// Emoji for buff vs debuff descriptions
const LP_EFFECT_EMOJI = {
  [LP_EFFECT_TYPES.WORK_PAYOUT]: { buff: '💰', debuff: '📉' },
  [LP_EFFECT_TYPES.HACK_SUCCESS]: { buff: '🎯', debuff: '🚫' },
  [LP_EFFECT_TYPES.ROB_SUCCESS]: { buff: '🎯', debuff: '🚫' },
  [LP_EFFECT_TYPES.WORK_COOLDOWN]: { buff: '⏩', debuff: '🐌' },
  [LP_EFFECT_TYPES.HACK_COOLDOWN]: { buff: '⏩', debuff: '🐌' },
  [LP_EFFECT_TYPES.ROB_COOLDOWN]: { buff: '⏩', debuff: '🐌' },
  [LP_EFFECT_TYPES.HACK_FINES]: { buff: '🛡️', debuff: '💸' },
  [LP_EFFECT_TYPES.ROB_FINES]: { buff: '🛡️', debuff: '💸' },
  [LP_EFFECT_TYPES.HACK_XP]: { buff: '⬆️', debuff: '⬇️' },
  [LP_EFFECT_TYPES.ROB_XP]: { buff: '⬆️', debuff: '⬇️' },
  [LP_EFFECT_TYPES.STOCK_PRICES]: { buff: '📈', debuff: '📉' }
};

// For cooldown and fines: negative value = buff (less time / less fines)
// So we need to describe them inversely
const INVERSE_EFFECTS = new Set([
  LP_EFFECT_TYPES.WORK_COOLDOWN,
  LP_EFFECT_TYPES.HACK_COOLDOWN,
  LP_EFFECT_TYPES.ROB_COOLDOWN,
  LP_EFFECT_TYPES.HACK_FINES,
  LP_EFFECT_TYPES.ROB_FINES
]);

const DEFAULT_SETTINGS = {
  enabled: true,
  cooldownHours: 8,
  nothingCooldownHours: 2,
  minBuffPercent: 10,
  maxBuffPercent: 30,
  minDurationHours: 2,
  maxDurationHours: 8,
  minCurrency: 500,
  maxCurrency: 1500
};

// Flavor text pools
const FLAVOR_TEXTS = {
  buff: [
    "You find a glowing penny on the ground... it pulses with energy!",
    "A mysterious coin rolls toward your feet. It hums with power.",
    "You spot a shimmering penny in a server rack crevice. Lucky find!",
    "A digital coin materializes in your wallet. Its code is favorable.",
    "The system drops a rare token. Fortune smiles on you!",
    "You stumble upon a corrupted coin — but the corruption works in your favor!",
    "A rogue process delivers a gift: a lucky algorithm.",
    "You intercept a stray packet. Inside? A stroke of luck.",
  ],
  debuff: [
    "You pick up a penny... but it's cursed with bad code.",
    "A tarnished coin clings to your hand. Something feels off...",
    "You find a penny, but it's been flagged by the system.",
    "A corrupted token latches onto your profile. Not so lucky after all.",
    "You reach for a shiny coin, but it bites back with a virus.",
    "A suspicious process attaches itself to your wallet. Uh oh.",
    "You pick up what looks like a lucky penny — it's a trojan.",
    "A penny rolls toward you. When you touch it, your screen glitches.",
  ],
  currency: [
    "You find a stash of coins hidden in an old backup drive!",
    "A generous anonymous donor drops some cash your way.",
    "You stumble into an unlocked digital wallet! Finders keepers.",
    "The system owes you a refund. Here's some pocket change.",
    "You find a bag of coins behind a corrupted firewall.",
    "A penny? No — a whole pile of coins! Today's your lucky day.",
    "An old transaction error works out in your favor. Ka-ching!",
    "You hack into... wait, you just found some loose change.",
  ],
  nothing: [
    "You find a penny... but it crumbles into digital dust.",
    "A coin appears, flickers, and vanishes. Nothing happened.",
    "You reach for a shiny penny but it was just a screen glare.",
    "The penny you found is worthless — depreciated to zero.",
    "You spot something shiny... nope, just a dead pixel.",
    "A coin rolls past you, but falls into the void before you grab it.",
    "You find a penny! ...It's actually just a bit. 1/8th of a byte.",
    "The system hiccups and shows you a penny. Then takes it back.",
  ]
};

const guildSettings = new Map();

function initLuckyPenny(database) {
  db = database;

  db.run(`
    CREATE TABLE IF NOT EXISTS luckypenny_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      cooldown_hours REAL DEFAULT 8,
      nothing_cooldown_hours REAL DEFAULT 2,
      min_buff_percent INTEGER DEFAULT 10,
      max_buff_percent INTEGER DEFAULT 30,
      min_duration_hours INTEGER DEFAULT 2,
      max_duration_hours INTEGER DEFAULT 8,
      min_currency INTEGER DEFAULT 500,
      max_currency INTEGER DEFAULT 1500
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS luckypenny_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_use_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_lp_tracker ON luckypenny_tracker(guild_id, user_id)`);

  // Migration: add nothing_cooldown_hours column if missing
  migrateAddColumn(db, 'luckypenny_settings', 'nothing_cooldown_hours REAL DEFAULT 2');

  saveDatabase();
  console.log('🪙 Lucky Penny system initialized');
}

// ==================== SETTINGS ====================

function getLuckyPennySettings(guildId) {
  if (guildSettings.has(guildId)) return guildSettings.get(guildId);
  if (!db) return { ...DEFAULT_SETTINGS };

  const stmt = db.prepare(`SELECT * FROM luckypenny_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    const settings = {
      enabled: row.enabled === 1,
      cooldownHours: row.cooldown_hours ?? DEFAULT_SETTINGS.cooldownHours,
      nothingCooldownHours: row.nothing_cooldown_hours ?? DEFAULT_SETTINGS.nothingCooldownHours,
      minBuffPercent: row.min_buff_percent ?? DEFAULT_SETTINGS.minBuffPercent,
      maxBuffPercent: row.max_buff_percent ?? DEFAULT_SETTINGS.maxBuffPercent,
      minDurationHours: row.min_duration_hours ?? DEFAULT_SETTINGS.minDurationHours,
      maxDurationHours: row.max_duration_hours ?? DEFAULT_SETTINGS.maxDurationHours,
      minCurrency: row.min_currency ?? DEFAULT_SETTINGS.minCurrency,
      maxCurrency: row.max_currency ?? DEFAULT_SETTINGS.maxCurrency
    };
    guildSettings.set(guildId, settings);
    return settings;
  }

  stmt.free();
  guildSettings.set(guildId, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

function updateLuckyPennySettings(guildId, updates) {
  if (!db) return;

  const current = getLuckyPennySettings(guildId);
  const merged = { ...current, ...updates };

  db.run(`INSERT OR REPLACE INTO luckypenny_settings 
    (guild_id, enabled, cooldown_hours, nothing_cooldown_hours, min_buff_percent, max_buff_percent, min_duration_hours, max_duration_hours, min_currency, max_currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, merged.enabled ? 1 : 0, merged.cooldownHours, merged.nothingCooldownHours, merged.minBuffPercent, merged.maxBuffPercent,
     merged.minDurationHours, merged.maxDurationHours, merged.minCurrency, merged.maxCurrency]);

  guildSettings.set(guildId, merged);
  saveDatabase();
}

// ==================== COOLDOWN ====================

function canUseLuckyPenny(guildId, userId) {
  if (!db) return { canUse: true };

  const settings = getLuckyPennySettings(guildId);
  const stmt = db.prepare(`SELECT last_use_time FROM luckypenny_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);

  if (!stmt.step()) {
    stmt.free();
    return { canUse: true };
  }

  const row = stmt.getAsObject();
  stmt.free();
  const lastTime = row.last_use_time;
  const cooldownMs = settings.cooldownHours * 60 * 60 * 1000;
  const elapsed = Date.now() - lastTime;

  if (elapsed < cooldownMs) {
    const remaining = cooldownMs - elapsed;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.ceil((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return { canUse: false, timeRemaining: remaining, reason: `Your luck is recharging! Try again in **${timeStr}**.` };
  }

  return { canUse: true };
}

function recordLuckyPennyUse(guildId, userId, cooldownHoursOverride = null) {
  if (!db) return;
  if (cooldownHoursOverride !== null) {
    // Record a fake timestamp so the remaining cooldown equals cooldownHoursOverride from now
    const settings = getLuckyPennySettings(guildId);
    const fullCooldownMs = settings.cooldownHours * 60 * 60 * 1000;
    const reducedCooldownMs = cooldownHoursOverride * 60 * 60 * 1000;
    // Set last_use_time such that (now - last_use_time) = fullCooldownMs - reducedCooldownMs
    const fakeLastUse = Date.now() - (fullCooldownMs - reducedCooldownMs);
    db.run(`INSERT OR REPLACE INTO luckypenny_tracker (guild_id, user_id, last_use_time) VALUES (?, ?, ?)`,
      [guildId, userId, fakeLastUse]);
  } else {
    db.run(`INSERT OR REPLACE INTO luckypenny_tracker (guild_id, user_id, last_use_time) VALUES (?, ?, ?)`,
      [guildId, userId, Date.now()]);
  }
  saveDatabase();
}

// ==================== ROLL LOGIC ====================

function rollLuckyPenny(guildId, userId, settings) {
  const roll = Math.random() * 100;

  if (roll < 33.33) {
    // BUFF or DEBUFF
    return rollBuffDebuff(settings);
  } else if (roll < 66.66) {
    // CURRENCY
    return rollCurrency(settings);
  } else {
    // NOTHING
    return rollNothing();
  }
}

function rollBuffDebuff(settings) {
  // Pick a random effect type
  const effectKeys = Object.values(LP_EFFECT_TYPES);
  const effectType = effectKeys[Math.floor(Math.random() * effectKeys.length)];

  // 50/50 buff or debuff
  const isBuff = Math.random() < 0.5;

  // Random percentage within range
  const percent = Math.floor(Math.random() * (settings.maxBuffPercent - settings.minBuffPercent + 1)) + settings.minBuffPercent;

  // Random duration within range
  const durationHours = Math.floor(Math.random() * (settings.maxDurationHours - settings.minDurationHours + 1)) + settings.minDurationHours;

  // For inverse effects (cooldowns, fines): a "buff" means REDUCING them (negative value)
  // For normal effects (payout, success, xp, stock): a "buff" means INCREASING them (positive value)
  const isInverse = INVERSE_EFFECTS.has(effectType);
  let value;
  if (isInverse) {
    // Buff = reduce (negative stored value feels like a buff to the player)
    // Debuff = increase (positive stored value feels like a debuff)
    value = isBuff ? -percent : percent;
  } else {
    // Buff = increase (positive)
    // Debuff = decrease (negative)
    value = isBuff ? percent : -percent;
  }

  const flavorTexts = isBuff ? FLAVOR_TEXTS.buff : FLAVOR_TEXTS.debuff;
  const flavorText = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];

  return {
    type: 'buff',
    isBuff,
    effectType,
    effectName: LP_EFFECT_NAMES[effectType],
    value,
    displayPercent: percent,
    durationHours,
    flavorText
  };
}

function rollCurrency(settings) {
  const amount = Math.floor(Math.random() * (settings.maxCurrency - settings.minCurrency + 1)) + settings.minCurrency;
  const flavorText = FLAVOR_TEXTS.currency[Math.floor(Math.random() * FLAVOR_TEXTS.currency.length)];

  return {
    type: 'currency',
    amount,
    flavorText
  };
}

function rollNothing() {
  const flavorText = FLAVOR_TEXTS.nothing[Math.floor(Math.random() * FLAVOR_TEXTS.nothing.length)];
  return {
    type: 'nothing',
    flavorText
  };
}

// ==================== APPLY BUFF ====================

function applyBuff(guildId, userId, effectType, value, durationHours) {
  if (!db) return;

  const now = Date.now();
  const expiresAt = now + (durationHours * 60 * 60 * 1000);

  // Insert into active_effects (same table used by items.js)
  db.run(`INSERT INTO active_effects (guild_id, user_id, effect_type, effect_value, source_item_id, source_item_name, activated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, userId, effectType, value, -1, 'Lucky Penny', now, expiresAt]);

  saveDatabase();
}

// ==================== READ BUFFS ====================

function getLuckyPennyEffect(guildId, userId, effectType) {
  if (!db) return 0;

  const now = Date.now();
  const stmt = db.prepare(`SELECT SUM(effect_value) as total FROM active_effects 
    WHERE guild_id = ? AND user_id = ? AND effect_type = ? AND expires_at > ?`);
  stmt.bind([guildId, userId, effectType, now]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row.total || 0;
  }
  stmt.free();
  return 0;
}

// Get all active Lucky Penny buffs for a user
function getActiveLuckyPennyBuffs(guildId, userId) {
  if (!db) return [];

  const now = Date.now();
  const buffs = [];
  const effectTypes = Object.values(LP_EFFECT_TYPES);

  for (const effectType of effectTypes) {
    const stmt = db.prepare(`SELECT effect_value, expires_at FROM active_effects 
      WHERE guild_id = ? AND user_id = ? AND effect_type = ? AND expires_at > ?
      ORDER BY expires_at DESC LIMIT 1`);
    stmt.bind([guildId, userId, effectType, now]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      const value = row.effect_value;
      const isInverse = INVERSE_EFFECTS.has(effectType);
      // Determine if this effect is beneficial to the player
      const isBeneficial = isInverse ? value < 0 : value > 0;

      buffs.push({
        effectType,
        name: LP_EFFECT_NAMES[effectType],
        value,
        displayPercent: Math.abs(value),
        isBuff: isBeneficial,
        expiresAt: row.expires_at,
        emoji: LP_EFFECT_EMOJI[effectType]?.[isBeneficial ? 'buff' : 'debuff'] || '🪙'
      });
    }
    stmt.free();
  }

  return buffs;
}

module.exports = {
  initLuckyPenny,
  getLuckyPennySettings,
  updateLuckyPennySettings,
  canUseLuckyPenny,
  recordLuckyPennyUse,
  rollLuckyPenny,
  applyBuff,
  getLuckyPennyEffect,
  getActiveLuckyPennyBuffs,
  LP_EFFECT_TYPES,
  LP_EFFECT_NAMES,
  LP_EFFECT_EMOJI,
  INVERSE_EFFECTS,
  DEFAULT_SETTINGS
};
