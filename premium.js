// Premium tier system — guild-level premium subscriptions
// Currently: schema + checking infrastructure. Payment integration TBD.

const { migrateAddColumn } = require('./database');
const log = require('./logger');

let db = null;

// Premium tiers and their feature limits
const TIERS = {
  free: {
    name: 'Free',
    maxCustomItems: 10,
    maxProperties: 5,
    maxMarketEvents: 3,
    earningsReportEnabled: false,
    customCurrencyEnabled: true,
    prioritySupport: false
  },
  plus: {
    name: 'Plus',
    maxCustomItems: 50,
    maxProperties: 15,
    maxMarketEvents: 10,
    earningsReportEnabled: true,
    customCurrencyEnabled: true,
    prioritySupport: false
  },
  pro: {
    name: 'Pro',
    maxCustomItems: 200,
    maxProperties: 50,
    maxMarketEvents: 25,
    earningsReportEnabled: true,
    customCurrencyEnabled: true,
    prioritySupport: true
  }
};

// Cache: guildId → { tier, expiresAt }
const premiumCache = new Map();

function initPremium(database) {
  db = database;

  db.run(`
    CREATE TABLE IF NOT EXISTS premium (
      guild_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      activated_at INTEGER,
      expires_at INTEGER,
      activated_by TEXT
    )
  `);

  console.log('⭐ Premium system initialized');
}

/**
 * Get a guild's premium tier info
 * @returns {{ tier: string, expiresAt: number|null, active: boolean }}
 */
function getPremiumInfo(guildId) {
  if (premiumCache.has(guildId)) {
    const cached = premiumCache.get(guildId);
    // Check if still valid
    if (!cached.expiresAt || cached.expiresAt > Date.now()) {
      return cached;
    }
    // Expired — fall through to re-check
    premiumCache.delete(guildId);
  }

  if (!db) return { tier: 'free', expiresAt: null, active: true };

  const result = db.exec(
    'SELECT tier, expires_at FROM premium WHERE guild_id = ?',
    [guildId]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    const info = { tier: 'free', expiresAt: null, active: true };
    premiumCache.set(guildId, info);
    return info;
  }

  const [tier, expiresAt] = result[0].values[0];
  const active = !expiresAt || expiresAt > Date.now();
  const effectiveTier = active ? (tier || 'free') : 'free';

  const info = { tier: effectiveTier, expiresAt, active };
  premiumCache.set(guildId, info);
  return info;
}

/**
 * Get the feature limits for a guild based on its premium tier
 */
function getTierLimits(guildId) {
  const { tier } = getPremiumInfo(guildId);
  return TIERS[tier] || TIERS.free;
}

/**
 * Check if a guild has at least the specified tier
 */
function hasMinTier(guildId, requiredTier) {
  const tierOrder = ['free', 'plus', 'pro'];
  const { tier } = getPremiumInfo(guildId);
  return tierOrder.indexOf(tier) >= tierOrder.indexOf(requiredTier);
}

/**
 * Set a guild's premium tier (admin/manual use for now)
 */
function setPremiumTier(guildId, tier, durationDays = null, activatedBy = null) {
  if (!TIERS[tier]) return false;
  if (!db) return false;

  const now = Date.now();
  const expiresAt = durationDays ? now + (durationDays * 24 * 60 * 60 * 1000) : null;

  db.run(`
    INSERT INTO premium (guild_id, tier, activated_at, expires_at, activated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET tier = ?, activated_at = ?, expires_at = ?, activated_by = ?
  `, [guildId, tier, now, expiresAt, activatedBy, tier, now, expiresAt, activatedBy]);

  // Update cache
  premiumCache.set(guildId, { tier, expiresAt, active: true });
  log.info(`Premium tier set: ${guildId} → ${tier}${durationDays ? ` (${durationDays} days)` : ' (permanent)'}`);
  return true;
}

module.exports = {
  initPremium,
  getPremiumInfo,
  getTierLimits,
  hasMinTier,
  setPremiumTier,
  TIERS
};
