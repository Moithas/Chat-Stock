// Market protection system - Anti-gaming measures
// Includes: Sell Cooldown, Price Impact Delay, Capital Gains Tax

const { TTLCache } = require('./cache');

let db = null;

// In-memory cache for guild settings
const guildMarketSettings = new TTLCache();

// Default market protection settings
const DEFAULT_SETTINGS = {
  // Sell Cooldown
  sellCooldownMinutes: 60,           // Must hold for 1 hour before selling
  sellCooldownEnabled: true,
  
  // Price Impact Delay
  priceImpactDelayMinutes: 120,      // Full impact takes 2 hours
  priceImpactEnabled: true,
  
  // Capital Gains Tax
  shortTermThresholdHours: 24,       // Under 24h = short term
  shortTermTaxPercent: 25,           // 25% tax on short-term gains
  longTermTaxPercent: 0,             // 0% tax on long-term gains
  capitalGainsTaxEnabled: true
};

function initMarketProtection(database) {
  db = database;
  
  // Create market settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS market_settings (
      guild_id TEXT PRIMARY KEY,
      sell_cooldown_minutes INTEGER DEFAULT 60,
      sell_cooldown_enabled INTEGER DEFAULT 1,
      price_impact_delay_minutes INTEGER DEFAULT 120,
      price_impact_enabled INTEGER DEFAULT 1,
      short_term_threshold_hours INTEGER DEFAULT 24,
      short_term_tax_percent REAL DEFAULT 25,
      long_term_tax_percent REAL DEFAULT 0,
      capital_gains_tax_enabled INTEGER DEFAULT 1
    );
  `);
  
  // Create purchase tracking table for cooldowns and tax calculation
  db.run(`
    CREATE TABLE IF NOT EXISTS stock_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      shares INTEGER NOT NULL,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
  
  // Migration: add guild_id to stock_purchases if missing
  try {
    const spCols = db.exec("PRAGMA table_info(stock_purchases)");
    const spHasGuild = spCols.length > 0 && spCols[0].values.some(r => r[1] === 'guild_id');
    if (!spHasGuild) {
      db.run(`ALTER TABLE stock_purchases ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''`);
      console.log('📊 Added guild_id column to stock_purchases');
    }
  } catch (e) {}

  // Create pending price impacts table
  db.run(`
    CREATE TABLE IF NOT EXISTS pending_impacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL DEFAULT '',
      stock_user_id TEXT NOT NULL,
      shares_delta INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      fully_applied INTEGER DEFAULT 0
    );
  `);

  // Migration: add guild_id to pending_impacts if missing
  try {
    const piCols = db.exec("PRAGMA table_info(pending_impacts)");
    const piHasGuild = piCols.length > 0 && piCols[0].values.some(r => r[1] === 'guild_id');
    if (!piHasGuild) {
      db.run(`ALTER TABLE pending_impacts ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''`);
      console.log('📊 Added guild_id column to pending_impacts');
    }
  } catch (e) {}

  // Indexes for query performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_stock_purchases_guild_owner ON stock_purchases(guild_id, owner_id, stock_user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pending_impacts_guild_stock ON pending_impacts(guild_id, stock_user_id)`);
  
  console.log('🛡️ Market protection system initialized');
}

// ============ Settings Management ============

function getMarketSettings(guildId) {
  if (guildMarketSettings.has(guildId)) {
    return guildMarketSettings.get(guildId);
  }
  
  if (db) {
    const result = db.exec('SELECT * FROM market_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const settings = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const parsed = {
        sellCooldownMinutes: settings.sell_cooldown_minutes,
        sellCooldownEnabled: settings.sell_cooldown_enabled === 1,
        priceImpactDelayMinutes: settings.price_impact_delay_minutes,
        priceImpactEnabled: settings.price_impact_enabled === 1,
        shortTermThresholdHours: settings.short_term_threshold_hours,
        shortTermTaxPercent: settings.short_term_tax_percent,
        longTermTaxPercent: settings.long_term_tax_percent,
        capitalGainsTaxEnabled: settings.capital_gains_tax_enabled === 1
      };
      
      guildMarketSettings.set(guildId, parsed);
      return parsed;
    }
  }
  
  return { ...DEFAULT_SETTINGS };
}

function saveMarketSettings(guildId, settings) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO market_settings 
    (guild_id, sell_cooldown_minutes, sell_cooldown_enabled, price_impact_delay_minutes, 
     price_impact_enabled, short_term_threshold_hours, short_term_tax_percent, 
     long_term_tax_percent, capital_gains_tax_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.sellCooldownMinutes,
    settings.sellCooldownEnabled ? 1 : 0,
    settings.priceImpactDelayMinutes,
    settings.priceImpactEnabled ? 1 : 0,
    settings.shortTermThresholdHours,
    settings.shortTermTaxPercent,
    settings.longTermTaxPercent,
    settings.capitalGainsTaxEnabled ? 1 : 0
  ]);
  
  guildMarketSettings.set(guildId, settings);
}

// ============ Purchase Tracking ============

function recordPurchase(guildId, ownerId, stockUserId, shares, price) {
  if (!db) return;
  
  db.run(`
    INSERT INTO stock_purchases (guild_id, owner_id, stock_user_id, shares, price, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, ownerId, stockUserId, shares, price, Date.now()]);
}

function getPurchaseHistory(guildId, ownerId, stockUserId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM stock_purchases 
    WHERE guild_id = ? AND owner_id = ? AND stock_user_id = ? AND shares > 0
    ORDER BY timestamp ASC
  `, [guildId, ownerId, stockUserId]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Reduce shares from purchase history (FIFO - first in, first out)
function consumePurchaseShares(guildId, ownerId, stockUserId, sharesToSell) {
  if (!db) return [];
  
  const purchases = getPurchaseHistory(guildId, ownerId, stockUserId);
  const consumed = [];
  let remaining = sharesToSell;
  
  for (const purchase of purchases) {
    if (remaining <= 0) break;
    
    const takeFromThis = Math.min(purchase.shares, remaining);
    consumed.push({
      shares: takeFromThis,
      price: purchase.price,
      timestamp: purchase.timestamp,
      purchaseId: purchase.id
    });
    
    remaining -= takeFromThis;
    
    // Update the purchase record
    const newShares = purchase.shares - takeFromThis;
    if (newShares <= 0) {
      db.run('DELETE FROM stock_purchases WHERE id = ?', [purchase.id]);
    } else {
      db.run('UPDATE stock_purchases SET shares = ? WHERE id = ?', [newShares, purchase.id]);
    }
  }
  
  return consumed;
}

// ============ Sell Cooldown ============

function checkSellCooldown(guildId, ownerId, stockUserId, sharesToSell, totalOwnedShares) {
  const settings = getMarketSettings(guildId);
  
  if (!settings.sellCooldownEnabled) {
    return { canSell: true, reason: null, waitMinutes: 0 };
  }
  
  const purchases = getPurchaseHistory(guildId, ownerId, stockUserId);
  const cooldownMs = settings.sellCooldownMinutes * 60 * 1000;
  const now = Date.now();
  
  // Calculate tracked shares (shares with purchase records)
  let trackedShares = 0;
  for (const purchase of purchases) {
    trackedShares += purchase.shares;
  }
  
  // Legacy shares = shares owned but not tracked (purchased before tracking system)
  // These are grandfathered in and have no cooldown
  const legacyShares = totalOwnedShares !== undefined ? Math.max(0, totalOwnedShares - trackedShares) : 0;
  
  let availableShares = legacyShares; // Legacy shares are always available
  let earliestLockedTime = null;
  
  for (const purchase of purchases) {
    const timeSincePurchase = now - purchase.timestamp;
    
    if (timeSincePurchase >= cooldownMs) {
      availableShares += purchase.shares;
    } else if (earliestLockedTime === null) {
      earliestLockedTime = purchase.timestamp + cooldownMs;
    }
  }
  
  if (availableShares >= sharesToSell) {
    return { canSell: true, reason: null, waitMinutes: 0, availableShares };
  }
  
  const waitMs = earliestLockedTime ? earliestLockedTime - now : cooldownMs;
  const waitMinutes = Math.ceil(waitMs / 60000);
  
  return {
    canSell: false,
    reason: `You must hold shares for ${settings.sellCooldownMinutes} minutes before selling.`,
    waitMinutes,
    availableShares
  };
}

// ============ Price Impact Delay ============

function recordPriceImpact(guildId, stockUserId, sharesDelta) {
  if (!db) return;
  
  db.run(`
    INSERT INTO pending_impacts (guild_id, stock_user_id, shares_delta, timestamp, fully_applied)
    VALUES (?, ?, ?, ?, 0)
  `, [guildId, stockUserId, sharesDelta, Date.now()]);
}

function getEffectiveShareCount(guildId, stockUserId, actualShares) {
  const settings = getMarketSettings(guildId);
  
  if (!settings.priceImpactEnabled || !db) {
    return actualShares;
  }
  
  const delayMs = settings.priceImpactDelayMinutes * 60 * 1000;
  const now = Date.now();
  
  // Get all pending impacts for this stock in this guild
  const result = db.exec(`
    SELECT * FROM pending_impacts 
    WHERE guild_id = ? AND stock_user_id = ? AND fully_applied = 0
  `, [guildId, stockUserId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return actualShares;
  }
  
  let pendingImpact = 0;
  
  for (const row of result[0].values) {
    const cols = result[0].columns;
    const impact = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
    
    const elapsed = now - impact.timestamp;
    const progress = Math.min(elapsed / delayMs, 1);
    
    // Calculate how much of this impact is NOT yet applied
    const unappliedRatio = 1 - progress;
    pendingImpact += impact.shares_delta * unappliedRatio;
    
    // Mark as fully applied if complete
    if (progress >= 1) {
      db.run('UPDATE pending_impacts SET fully_applied = 1 WHERE id = ?', [impact.id]);
    }
  }
  
  // Return actual shares minus pending (not yet realized) impact
  return Math.max(0, actualShares - pendingImpact);
}

// Temporary demand momentum from recent net buy/sell pressure.
// This lets fresh buying matter even when long-term demand cap is already reached.
function getPendingDemandMomentum(guildId, stockUserId) {
  const settings = getMarketSettings(guildId);

  if (!settings.priceImpactEnabled || !db) {
    return 0;
  }

  const delayMs = settings.priceImpactDelayMinutes * 60 * 1000;
  const now = Date.now();

  const result = db.exec(`
    SELECT * FROM pending_impacts
    WHERE guild_id = ? AND stock_user_id = ? AND fully_applied = 0
  `, [guildId, stockUserId]);

  if (result.length === 0 || result[0].values.length === 0) {
    return 0;
  }

  let netPendingShares = 0;

  for (const row of result[0].values) {
    const cols = result[0].columns;
    const impact = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});

    const elapsed = now - impact.timestamp;
    const progress = Math.min(elapsed / delayMs, 1);
    const unappliedRatio = 1 - progress;
    netPendingShares += impact.shares_delta * unappliedRatio;
  }

  // 1000 net pending shares => +/-2% momentum; capped to +/-8% for safety.
  return Math.max(-0.08, Math.min(netPendingShares * 0.00002, 0.08));
}

// Clean up old fully applied impacts periodically
function cleanupOldImpacts() {
  if (!db) return;
  
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  db.run('DELETE FROM pending_impacts WHERE fully_applied = 1 AND timestamp < ?', [oneDayAgo]);
}

// Run cleanup every hour
setInterval(cleanupOldImpacts, 60 * 60 * 1000);

// ============ Capital Gains Tax ============

function calculateCapitalGainsTax(guildId, consumedPurchases, currentPrice) {
  const settings = getMarketSettings(guildId);
  
  if (!settings.capitalGainsTaxEnabled) {
    return { totalTax: 0, breakdown: [] };
  }
  
  const now = Date.now();
  const shortTermMs = settings.shortTermThresholdHours * 60 * 60 * 1000;
  
  let totalTax = 0;
  const breakdown = [];
  
  for (const purchase of consumedPurchases) {
    const holdTime = now - purchase.timestamp;
    const isShortTerm = holdTime < shortTermMs;
    const taxRate = isShortTerm ? settings.shortTermTaxPercent : settings.longTermTaxPercent;
    
    const profit = (currentPrice - purchase.price) * purchase.shares;
    
    // Only tax profits, not losses
    if (profit > 0 && taxRate > 0) {
      const tax = Math.round(profit * (taxRate / 100));
      totalTax += tax;
      
      breakdown.push({
        shares: purchase.shares,
        buyPrice: purchase.price,
        profit: profit,
        holdTimeHours: Math.floor(holdTime / (60 * 60 * 1000)),
        isShortTerm,
        taxRate,
        tax
      });
    }
  }
  
  return { totalTax, breakdown };
}

// ============ Purchase History Split Adjustment ============

// Adjust all purchase records when a stock splits
// Shares get multiplied, price gets divided (to keep total cost basis the same)
function adjustPurchaseHistoryForSplit(guildId, stockUserId, multiplier) {
  if (!db) return;
  
  // For a 2:1 split: shares * 2, price / 2
  // For a 1:2 reverse split: shares * 0.5, price / 0.5 (= price * 2)
  db.run(`
    UPDATE stock_purchases 
    SET shares = MAX(1, CAST(shares * ? AS INTEGER)), 
        price = price / ?
    WHERE guild_id = ? AND stock_user_id = ? AND shares > 0
  `, [multiplier, multiplier, guildId, stockUserId]);
}

// ============ Setting Update Functions ============

function updateSellCooldown(guildId, minutes, enabled) {
  const settings = getMarketSettings(guildId);
  if (minutes !== undefined) settings.sellCooldownMinutes = minutes;
  if (enabled !== undefined) settings.sellCooldownEnabled = enabled;
  saveMarketSettings(guildId, settings);
}

function updatePriceImpactDelay(guildId, minutes, enabled) {
  const settings = getMarketSettings(guildId);
  if (minutes !== undefined) settings.priceImpactDelayMinutes = minutes;
  if (enabled !== undefined) settings.priceImpactEnabled = enabled;
  saveMarketSettings(guildId, settings);
}

function updateCapitalGainsTax(guildId, shortTermHours, shortTermPercent, longTermPercent, enabled) {
  const settings = getMarketSettings(guildId);
  if (shortTermHours !== undefined) settings.shortTermThresholdHours = shortTermHours;
  if (shortTermPercent !== undefined) settings.shortTermTaxPercent = shortTermPercent;
  if (longTermPercent !== undefined) settings.longTermTaxPercent = longTermPercent;
  if (enabled !== undefined) settings.capitalGainsTaxEnabled = enabled;
  saveMarketSettings(guildId, settings);
}

// Preview capital gains tax without modifying database (for confirmation screen)
function previewCapitalGainsTax(guildId, ownerId, stockUserId, sharesToSell, currentPrice) {
  const purchases = getPurchaseHistory(guildId, ownerId, stockUserId);
  const settings = getMarketSettings(guildId);
  
  if (!settings.capitalGainsTaxEnabled) {
    return { totalTax: 0, breakdown: [] };
  }
  
  const now = Date.now();
  const shortTermMs = settings.shortTermThresholdHours * 60 * 60 * 1000;
  
  // Simulate FIFO consumption without modifying DB
  const simulatedConsumed = [];
  let remaining = sharesToSell;
  
  for (const purchase of purchases) {
    if (remaining <= 0) break;
    
    const takeFromThis = Math.min(purchase.shares, remaining);
    simulatedConsumed.push({
      shares: takeFromThis,
      price: purchase.price,
      timestamp: purchase.timestamp
    });
    remaining -= takeFromThis;
  }
  
  // Calculate tax on simulated consumption
  let totalTax = 0;
  const breakdown = [];
  
  for (const purchase of simulatedConsumed) {
    const holdTime = now - purchase.timestamp;
    const isShortTerm = holdTime < shortTermMs;
    const taxRate = isShortTerm ? settings.shortTermTaxPercent : settings.longTermTaxPercent;
    
    const profit = (currentPrice - purchase.price) * purchase.shares;
    
    if (profit > 0 && taxRate > 0) {
      const tax = Math.round(profit * (taxRate / 100));
      totalTax += tax;
      
      breakdown.push({
        shares: purchase.shares,
        buyPrice: purchase.price,
        profit: profit,
        holdTimeHours: Math.floor(holdTime / (60 * 60 * 1000)),
        isShortTerm,
        taxRate,
        tax
      });
    }
  }
  
  return { totalTax, breakdown };
}

module.exports = {
  initMarketProtection,
  getMarketSettings,
  recordPurchase,
  getPurchaseHistory,
  consumePurchaseShares,
  checkSellCooldown,
  recordPriceImpact,
  getEffectiveShareCount,
  getPendingDemandMomentum,
  calculateCapitalGainsTax,
  previewCapitalGainsTax,
  updateSellCooldown,
  updatePriceImpactDelay,
  updateCapitalGainsTax,
  adjustPurchaseHistoryForSplit
};
