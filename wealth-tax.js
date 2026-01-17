// Wealth Tax System for Chat-Stock
// Collects periodic taxes on total net worth and adds to lottery jackpot

const { getDb } = require('./database');
const { getBalance, removeFromBank, getAllBalances, applyFine } = require('./economy');
const { getPortfolio, calculateStockPrice } = require('./database');
const { getUserProperties, getTotalPropertyValue } = require('./property');
const { getLotteryInfo, setJackpot } = require('./gambling');

let db = null;

// Default tier configuration
const DEFAULT_TIERS = [
  { threshold: 0, rate: 0 },           // Tier 1: 0-100k = exempt
  { threshold: 100000, rate: 0.5 },    // Tier 2: 100k-500k = 0.5%
  { threshold: 500000, rate: 1.0 },    // Tier 3: 500k-2M = 1.0%
  { threshold: 2000000, rate: 1.5 }    // Tier 4: 2M+ = 1.5%
];

// Default settings
const DEFAULT_SETTINGS = {
  enabled: false,
  collectionDay: 0,        // 0 = Sunday, 1 = Monday, etc.
  collectionHour: 12,      // Hour of day (0-23)
  announcementChannelId: null, // Channel to announce collections
  tiers: DEFAULT_TIERS,
  lastCollection: null,
  lastCollectionAmount: 0,
  lastCollectionDetails: null
};

// Cache for settings per guild
const guildWealthTaxSettings = new Map();

function initWealthTax(database) {
  db = database;
  
  // Create wealth tax settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS wealth_tax_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      collection_day INTEGER DEFAULT 0,
      collection_hour INTEGER DEFAULT 12,
      announcement_channel_id TEXT DEFAULT NULL,
      tiers TEXT DEFAULT '${JSON.stringify(DEFAULT_TIERS)}',
      last_collection INTEGER DEFAULT NULL,
      last_collection_amount INTEGER DEFAULT 0,
      last_collection_details TEXT DEFAULT NULL
    )
  `);
  
  // Migration: Add announcement_channel_id column if it doesn't exist
  try {
    db.run(`ALTER TABLE wealth_tax_settings ADD COLUMN announcement_channel_id TEXT DEFAULT NULL`);
    console.log('💰 Added announcement_channel_id column to wealth_tax_settings');
  } catch (e) {
    // Column already exists, ignore error
  }
  
  // Create wealth tax history table
  db.run(`
    CREATE TABLE IF NOT EXISTS wealth_tax_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      total_wealth INTEGER NOT NULL,
      cash_wealth INTEGER NOT NULL,
      stock_wealth INTEGER NOT NULL,
      property_wealth INTEGER NOT NULL,
      tax_amount INTEGER NOT NULL,
      collection_time INTEGER NOT NULL
    )
  `);
  
  console.log('💰 Wealth tax system initialized');
}

// ============ SETTINGS ============

function getWealthTaxSettings(guildId) {
  // Check cache first
  if (guildWealthTaxSettings.has(guildId)) {
    return guildWealthTaxSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const result = db.exec('SELECT * FROM wealth_tax_settings WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    const cols = result[0].columns;
    const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
    
    const settings = {
      enabled: data.enabled === 1,
      collectionDay: data.collection_day,
      collectionHour: data.collection_hour,
      announcementChannelId: data.announcement_channel_id || null,
      tiers: JSON.parse(data.tiers || JSON.stringify(DEFAULT_TIERS)),
      lastCollection: data.last_collection,
      lastCollectionAmount: data.last_collection_amount || 0,
      lastCollectionDetails: data.last_collection_details ? JSON.parse(data.last_collection_details) : null
    };
    
    guildWealthTaxSettings.set(guildId, settings);
    return settings;
  }
  
  // Return defaults
  return { ...DEFAULT_SETTINGS };
}

function updateWealthTaxSettings(guildId, updates) {
  if (!db) return;
  
  const current = getWealthTaxSettings(guildId);
  const newSettings = { ...current, ...updates };
  
  // Ensure guild has a record
  db.run('INSERT OR IGNORE INTO wealth_tax_settings (guild_id) VALUES (?)', [guildId]);
  
  // Update settings
  db.run(`
    UPDATE wealth_tax_settings 
    SET enabled = ?, 
        collection_day = ?, 
        collection_hour = ?,
        announcement_channel_id = ?,
        tiers = ?,
        last_collection = ?,
        last_collection_amount = ?,
        last_collection_details = ?
    WHERE guild_id = ?
  `, [
    newSettings.enabled ? 1 : 0,
    newSettings.collectionDay,
    newSettings.collectionHour,
    newSettings.announcementChannelId || null,
    JSON.stringify(newSettings.tiers),
    newSettings.lastCollection,
    newSettings.lastCollectionAmount,
    newSettings.lastCollectionDetails ? JSON.stringify(newSettings.lastCollectionDetails) : null,
    guildId
  ]);
  
  // Update cache
  guildWealthTaxSettings.set(guildId, newSettings);
  
  return newSettings;
}

// ============ WEALTH CALCULATION ============

function calculateUserWealth(guildId, userId) {
  // Cash + Bank balance
  const balance = getBalance(guildId, userId);
  const cashWealth = balance.total;
  
  // Stock portfolio value
  const portfolio = getPortfolio(userId);
  let stockWealth = 0;
  for (const stock of portfolio) {
    const price = calculateStockPrice(stock.stock_user_id, guildId);
    stockWealth += price * stock.shares;
  }
  
  // Property value
  const propertyWealth = getTotalPropertyValue(guildId, userId);
  
  return {
    cash: cashWealth,
    stocks: stockWealth,
    properties: propertyWealth,
    total: cashWealth + stockWealth + propertyWealth
  };
}

function calculateTaxForWealth(wealth, tiers) {
  // Sort tiers by threshold ascending
  const sortedTiers = [...tiers].sort((a, b) => a.threshold - b.threshold);
  
  // Find which bracket the wealth falls into
  let applicableTier = sortedTiers[0]; // Default to first tier
  
  for (let i = sortedTiers.length - 1; i >= 0; i--) {
    if (wealth >= sortedTiers[i].threshold) {
      applicableTier = sortedTiers[i];
      break;
    }
  }
  
  // Apply the rate to entire wealth (flat by bracket system)
  const totalTax = Math.floor(wealth * (applicableTier.rate / 100));
  
  const breakdown = [
    {
      tier: sortedTiers.indexOf(applicableTier) + 1,
      threshold: applicableTier.threshold,
      rate: applicableTier.rate,
      taxableAmount: wealth,
      taxAmount: totalTax
    }
  ];
  
  return {
    totalTax,
    breakdown
  };
}

// ============ COLLECTION ============

function previewWealthTaxCollection(guildId) {
  const settings = getWealthTaxSettings(guildId);
  const balances = getAllBalances(guildId);
  
  let totalTaxToCollect = 0;
  const userBreakdowns = [];
  
  for (const user of balances) {
    const wealth = calculateUserWealth(guildId, user.userId);
    const { totalTax, breakdown } = calculateTaxForWealth(wealth.total, settings.tiers);
    
    if (totalTax > 0) {
      userBreakdowns.push({
        userId: user.userId,
        username: user.username,
        wealth: wealth,
        tax: totalTax,
        breakdown: breakdown
      });
      totalTaxToCollect += totalTax;
    }
  }
  
  // Sort by tax amount descending
  userBreakdowns.sort((a, b) => b.tax - a.tax);
  
  return {
    totalTax: totalTaxToCollect,
    taxableUsers: userBreakdowns.length,
    totalUsers: balances.length,
    users: userBreakdowns,
    currentJackpot: getLotteryInfo(guildId)?.jackpot || 10000,
    projectedJackpot: (getLotteryInfo(guildId)?.jackpot || 10000) + totalTaxToCollect
  };
}

async function collectWealthTax(guildId) {
  const settings = getWealthTaxSettings(guildId);
  
  if (!settings.enabled) {
    return { success: false, reason: 'Wealth tax is not enabled' };
  }
  
  const balances = getAllBalances(guildId);
  
  let totalCollected = 0;
  const collections = [];
  
  for (const user of balances) {
    const wealth = calculateUserWealth(guildId, user.userId);
    const { totalTax } = calculateTaxForWealth(wealth.total, settings.tiers);
    
    if (totalTax > 0) {
      // Deduct from bank first, then cash, then put into debt
      const balance = getBalance(guildId, user.userId);
      
      let remaining = totalTax;
      
      // Try to take from bank first
      if (balance.bank > 0) {
        const fromBank = Math.min(balance.bank, remaining);
        if (fromBank > 0) {
          await removeFromBank(guildId, user.userId, fromBank, 'Wealth Tax');
          remaining -= fromBank;
        }
      }
      
      // Take rest from cash (only what they have)
      if (remaining > 0 && balance.cash > 0) {
        const fromCash = Math.min(balance.cash, remaining);
        if (fromCash > 0) {
          const { removeMoney } = require('./economy');
          await removeMoney(guildId, user.userId, fromCash, 'Wealth Tax');
          remaining -= fromCash;
        }
      }
      
      // Force-liquidate stocks if still owing (start with lowest price)
      let stocksSold = [];
      if (remaining > 0) {
        const portfolio = getPortfolio(user.userId);
        
        // Create sortable portfolio with prices
        const portfolioWithPrices = portfolio.map(stock => ({
          ...stock,
          currentPrice: calculateStockPrice(stock.stock_user_id, guildId)
        }));
        
        // Sort by price ascending (lowest first)
        portfolioWithPrices.sort((a, b) => a.currentPrice - b.currentPrice);
        
        // Sell shares starting from lowest price
        for (const stock of portfolioWithPrices) {
          if (remaining <= 0) break;
          
          const revenue = stock.currentPrice * stock.shares;
          const amountTaken = Math.min(revenue, remaining);
          const sharesToSell = Math.floor(amountTaken / stock.currentPrice);
          
          if (sharesToSell > 0) {
            // Remove shares from portfolio
            const db = require('./database').getDb();
            db.run(
              'UPDATE portfolio SET shares = shares - ? WHERE user_id = ? AND stock_user_id = ?',
              [sharesToSell, user.userId, stock.stock_user_id]
            );
            
            // Add proceeds to cash
            const proceeds = sharesToSell * stock.currentPrice;
            const { addMoney } = require('./economy');
            await addMoney(guildId, user.userId, proceeds, 'Forced Stock Liquidation (Tax Debt)');
            
            remaining -= proceeds;
            
            stocksSold.push({
              username: stock.username || `<@${stock.stock_user_id}>`,
              shares: sharesToSell,
              price: stock.currentPrice,
              revenue: proceeds
            });
          }
        }
      }
      
      // If they still owe money after liquidation, put them into debt
      if (remaining > 0) {
        await applyFine(guildId, user.userId, remaining, 'Wealth Tax (Debt)');
      }
      
      // Record in history - always record the full tax amount
      db.run(`
        INSERT INTO wealth_tax_history 
        (guild_id, user_id, total_wealth, cash_wealth, stock_wealth, property_wealth, tax_amount, collection_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [guildId, user.userId, wealth.total, wealth.cash, wealth.stocks, wealth.properties, totalTax, Date.now()]);
      
      collections.push({
        userId: user.userId,
        username: user.username,
        wealth: wealth.total,
        taxOwed: totalTax,
        taxCollected: totalTax,
        stocksSold: stocksSold,
        wentIntoDebt: remaining > 0,
        debtAmount: remaining
      });
      
      totalCollected += totalTax;
    }
  }
  
  // Add to lottery jackpot
  const currentJackpot = getLotteryInfo(guildId)?.jackpot || 10000;
  const newJackpot = currentJackpot + totalCollected;
  setJackpot(guildId, newJackpot);
  
  // Update last collection info
  const collectionDetails = {
    usersAffected: collections.length,
    totalUsers: balances.length,
    topPayers: collections.slice(0, 5).map(c => ({
      userId: c.userId,
      username: c.username,
      amount: c.taxCollected
    }))
  };
  
  updateWealthTaxSettings(guildId, {
    lastCollection: Date.now(),
    lastCollectionAmount: totalCollected,
    lastCollectionDetails: collectionDetails
  });
  
  return {
    success: true,
    totalCollected,
    usersAffected: collections.length,
    collections,
    previousJackpot: currentJackpot,
    newJackpot
  };
}

// ============ HISTORY ============

function getWealthTaxHistory(guildId, userId = null, limit = 10) {
  if (!db) return [];
  
  let query = `
    SELECT * FROM wealth_tax_history 
    WHERE guild_id = ?
  `;
  const params = [guildId];
  
  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }
  
  query += ' ORDER BY collection_time DESC LIMIT ?';
  params.push(limit);
  
  const result = db.exec(query, params);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getUserTotalTaxPaid(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(
    'SELECT SUM(tax_amount) as total FROM wealth_tax_history WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] || 0;
}

// ============ UTILITY ============

function getDayName(day) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[day] || 'Unknown';
}

function formatTiers(tiers) {
  return tiers.map((tier, i) => {
    const nextTier = tiers[i + 1];
    const rangeEnd = nextTier ? nextTier.threshold - 1 : '∞';
    return {
      tier: i + 1,
      range: `${tier.threshold.toLocaleString()} - ${typeof rangeEnd === 'number' ? rangeEnd.toLocaleString() : rangeEnd}`,
      rate: `${tier.rate}%`
    };
  });
}

module.exports = {
  initWealthTax,
  getDb: () => db,
  // Settings
  getWealthTaxSettings,
  updateWealthTaxSettings,
  DEFAULT_TIERS,
  DEFAULT_SETTINGS,
  // Calculation
  calculateUserWealth,
  calculateTaxForWealth,
  // Collection
  previewWealthTaxCollection,
  collectWealthTax,
  // History
  getWealthTaxHistory,
  getUserTotalTaxPaid,
  // Utility
  getDayName,
  formatTiers
};
