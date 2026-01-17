// Trading fee configuration and calculation module

// In-memory cache for guild settings (loaded from database)
const guildSettings = new Map();

// Default fee settings
const DEFAULT_SETTINGS = {
  buyFeeType: 'percent',    // 'percent' or 'fixed'
  buyFeeValue: 2,           // 2% or 2 coins depending on type
  sellFeeType: 'percent',   // 'percent' or 'fixed'
  sellFeeValue: 2,          // 2% or 2 coins depending on type
  feesEnabled: true
};

let db = null;

function initFees(database) {
  db = database;
  
  // Create settings table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      buy_fee_type TEXT DEFAULT 'percent',
      buy_fee_value REAL DEFAULT 2,
      sell_fee_type TEXT DEFAULT 'percent',
      sell_fee_value REAL DEFAULT 2,
      fees_enabled INTEGER DEFAULT 1
    );
  `);
  
  console.log('💰 Trading fees system initialized');
}

function getGuildSettings(guildId) {
  // Check cache first
  if (guildSettings.has(guildId)) {
    return guildSettings.get(guildId);
  }
  
  // Load from database
  if (db) {
    const result = db.exec('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const settings = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const parsed = {
        buyFeeType: settings.buy_fee_type,
        buyFeeValue: settings.buy_fee_value,
        sellFeeType: settings.sell_fee_type,
        sellFeeValue: settings.sell_fee_value,
        feesEnabled: settings.fees_enabled === 1
      };
      
      guildSettings.set(guildId, parsed);
      return parsed;
    }
  }
  
  // Return defaults if no settings found
  return { ...DEFAULT_SETTINGS };
}

function saveGuildSettings(guildId, settings) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO guild_settings 
    (guild_id, buy_fee_type, buy_fee_value, sell_fee_type, sell_fee_value, fees_enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.buyFeeType,
    settings.buyFeeValue,
    settings.sellFeeType,
    settings.sellFeeValue,
    settings.feesEnabled ? 1 : 0
  ]);
  
  // Update cache
  guildSettings.set(guildId, settings);
}

function calculateBuyFee(guildId, totalCost) {
  const settings = getGuildSettings(guildId);
  
  if (!settings.feesEnabled) {
    return 0;
  }
  
  if (settings.buyFeeType === 'percent') {
    return Math.round(totalCost * (settings.buyFeeValue / 100));
  } else {
    return Math.round(settings.buyFeeValue);
  }
}

function calculateSellFee(guildId, totalValue) {
  const settings = getGuildSettings(guildId);
  
  if (!settings.feesEnabled) {
    return 0;
  }
  
  if (settings.sellFeeType === 'percent') {
    return Math.round(totalValue * (settings.sellFeeValue / 100));
  } else {
    return Math.round(settings.sellFeeValue);
  }
}

function formatFee(type, value) {
  if (type === 'percent') {
    return `${value}%`;
  } else {
    return `${value} (fixed)`;
  }
}

function updateBuyFee(guildId, type, value) {
  const settings = getGuildSettings(guildId);
  settings.buyFeeType = type;
  settings.buyFeeValue = value;
  saveGuildSettings(guildId, settings);
}

function updateSellFee(guildId, type, value) {
  const settings = getGuildSettings(guildId);
  settings.sellFeeType = type;
  settings.sellFeeValue = value;
  saveGuildSettings(guildId, settings);
}

function setFeesEnabled(guildId, enabled) {
  const settings = getGuildSettings(guildId);
  settings.feesEnabled = enabled;
  saveGuildSettings(guildId, settings);
}

module.exports = {
  initFees,
  getGuildSettings,
  saveGuildSettings,
  calculateBuyFee,
  calculateSellFee,
  formatFee,
  updateBuyFee,
  updateSellFee,
  setFeesEnabled
};
