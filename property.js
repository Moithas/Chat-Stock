// Property Management System

let db = null;

const CURRENCY = '<:babybel:1418824333664452608>';

// Default property names by tier
const DEFAULT_PROPERTIES = [
  // Tier 1 - Common (value: 1000-2500, 1 card/day)
  { id: 1, name: 'Rusty Trailer', tier: 1, value: 1500 },
  { id: 2, name: 'Studio Apartment', tier: 1, value: 2000 },
  { id: 3, name: 'Storage Unit', tier: 1, value: 2500 },
  // Tier 2 - Uncommon (value: 5000-7500, 2 cards/day)
  { id: 4, name: 'Suburban Duplex', tier: 2, value: 5000 },
  { id: 5, name: 'Downtown Condo', tier: 2, value: 6000 },
  { id: 6, name: 'Beach Bungalow', tier: 2, value: 7500 },
  // Tier 3 - Rare (value: 10000-15000, 3 cards/day)
  { id: 7, name: 'Victorian House', tier: 3, value: 10000 },
  { id: 8, name: 'Mountain Cabin', tier: 3, value: 12500 },
  { id: 9, name: 'City Townhouse', tier: 3, value: 15000 },
  // Tier 4 - Epic (value: 25000-35000, 4 cards/day)
  { id: 10, name: 'Lakefront Estate', tier: 4, value: 25000 },
  { id: 11, name: 'Penthouse Suite', tier: 4, value: 30000 },
  { id: 12, name: 'Historic Mansion', tier: 4, value: 35000 },
  // Tier 5 - Legendary (value: 50000-75000, 5 cards/day)
  { id: 13, name: 'Private Island', tier: 5, value: 50000 },
  { id: 14, name: 'Mega Yacht', tier: 5, value: 62500 },
  { id: 15, name: 'Space Station Module', tier: 5, value: 75000 }
];

// Tier drop weights (must sum to 100)
const TIER_WEIGHTS = {
  1: 35,  // 35% chance
  2: 25,  // 25% chance
  3: 20,  // 20% chance
  4: 12,  // 12% chance
  5: 8    // 8% chance
};

// Default Wealth Cards
const DEFAULT_CARDS = [
  // Positive Cards (1-20)
  { id: 1, name: 'Windfall', flavor: 'A mysterious benefactor left you a gift!', type: 'positive', effectType: 'rent_bonus', minPercent: 25, maxPercent: 50 },
  { id: 2, name: 'Tax Refund', flavor: 'The IRS actually owed YOU money for once.', type: 'positive', effectType: 'balance', minPercent: 3, maxPercent: 5 },
  { id: 3, name: 'Inheritance', flavor: 'Great Aunt Mildred remembered you in her will.', type: 'positive', effectType: 'flat', minValue: 400, maxValue: 600 },
  { id: 4, name: 'Market Boom', flavor: 'Your stocks are going to the moon! 🚀', type: 'positive', effectType: 'portfolio', minPercent: 0.3, maxPercent: 0.4 },
  { id: 5, name: 'Lucky Day', flavor: 'You found a four-leaf clover AND a penny heads-up.', type: 'positive', effectType: 'rent_bonus', minPercent: 20, maxPercent: 30 },
  { id: 6, name: 'Property Appreciation', flavor: 'Your neighborhood just got a Whole Foods.', type: 'positive', effectType: 'property_value', minPercent: 2, maxPercent: 5 },
  { id: 7, name: 'Dividend Payout', flavor: 'Turns out those boring index funds paid off.', type: 'positive', effectType: 'portfolio', minPercent: 0.1, maxPercent: 0.2 },
  { id: 8, name: 'Bonus Check', flavor: 'Your boss finally noticed your hard work!', type: 'positive', effectType: 'flat', minValue: 800, maxValue: 1200 },
  { id: 9, name: 'Insurance Payout', flavor: "That 'act of God' actually worked in your favor.", type: 'positive', effectType: 'property_value', minPercent: 6, maxPercent: 10 },
  { id: 10, name: 'Found Money', flavor: 'You checked your old jacket pockets.', type: 'positive', effectType: 'balance', minPercent: 1, maxPercent: 3 },
  { id: 11, name: 'Tenant Tip', flavor: 'Your tenant is apparently a very generous tipper.', type: 'positive', effectType: 'rent_bonus', minPercent: 40, maxPercent: 60 },
  { id: 12, name: 'Renovation Complete', flavor: 'HGTV would be proud of this flip.', type: 'positive', effectType: 'property_value', minPercent: 4, maxPercent: 7 },
  { id: 13, name: 'Stock Split', flavor: 'Your shares just multiplied like rabbits.', type: 'positive', effectType: 'portfolio', minPercent: 0.4, maxPercent: 0.5 },
  { id: 14, name: 'Golden Ticket', flavor: "You've won a tour of the chocolate factory!", type: 'positive', effectType: 'flat', minValue: 1500, maxValue: 2500 },
  { id: 15, name: 'Double Rent', flavor: 'Your tenant paid this month AND next month early.', type: 'positive', effectType: 'rent_bonus', minPercent: 100, maxPercent: 100 },
  { id: 16, name: 'Business Deal', flavor: 'That handshake deal actually worked out.', type: 'positive', effectType: 'balance', minPercent: 1, maxPercent: 10 },
  { id: 17, name: 'Silent Partner', flavor: 'Your mysterious investor came through.', type: 'positive', effectType: 'portfolio', minPercent: 0.2, maxPercent: 0.3 },
  { id: 18, name: 'Land Grant', flavor: 'The city rezoned in your favor!', type: 'positive', effectType: 'property_value', minPercent: 3, maxPercent: 6 },
  { id: 19, name: 'Community Chest', flavor: 'Monopoly taught you well.', type: 'positive', effectType: 'flat', minValue: 500, maxValue: 1000 },
  { id: 20, name: 'Jackpot', flavor: 'You hit it big at the casino... for once.', type: 'positive', effectType: 'balance', minPercent: 12, maxPercent: 18 },
  // Negative Cards (21-40)
  { id: 21, name: 'Property Tax', flavor: "The assessor 'reassessed' your property value.", type: 'negative', effectType: 'property_value', minPercent: 3, maxPercent: 7 },
  { id: 22, name: 'Market Crash', flavor: "Should've sold yesterday... 📉", type: 'negative', effectType: 'portfolio', minPercent: 0.4, maxPercent: 0.5 },
  { id: 23, name: 'Emergency Repair', flavor: 'The water heater chose violence today.', type: 'negative', effectType: 'balance', minPercent: 2, maxPercent: 5 },
  { id: 24, name: 'Lawsuit', flavor: "Your tenant's lawyer is VERY expensive.", type: 'negative', effectType: 'property_value', minPercent: 6, maxPercent: 10 },
  { id: 25, name: 'Bad Investment', flavor: 'That crypto your cousin recommended tanked.', type: 'negative', effectType: 'portfolio', minPercent: 0.3, maxPercent: 0.4 },
  { id: 26, name: 'Fines & Fees', flavor: 'Parking tickets from 2019 finally caught up.', type: 'negative', effectType: 'flat', minValue: 400, maxValue: 600 },
  { id: 27, name: 'Tenant Damage', flavor: "They said the hole in the wall was 'already there.'", type: 'negative', effectType: 'balance', minPercent: 1, maxPercent: 3 },
  { id: 28, name: 'Stock Dump', flavor: 'Insider trading... against you.', type: 'negative', effectType: 'portfolio', minPercent: 0.2, maxPercent: 0.3 },
  { id: 29, name: 'City Assessment', flavor: 'Surprise! The city needs a new sidewalk.', type: 'negative', effectType: 'property_value', minPercent: 4, maxPercent: 8 },
  { id: 30, name: 'IRS Audit', flavor: "They're going through EVERYTHING.", type: 'negative', effectType: 'balance', minPercent: 1, maxPercent: 10 },
  { id: 31, name: 'Burst Pipe', flavor: 'Water, water everywhere... especially in the basement.', type: 'negative', effectType: 'flat', minValue: 800, maxValue: 1200 },
  { id: 32, name: 'Eviction Costs', flavor: 'Getting them out cost more than keeping them.', type: 'negative', effectType: 'property_value', minPercent: 3, maxPercent: 6 },
  { id: 33, name: 'Margin Call', flavor: 'Your broker is NOT happy with you right now.', type: 'negative', effectType: 'portfolio', minPercent: 0.2, maxPercent: 0.3 },
  { id: 34, name: 'Legal Fees', flavor: 'Lawyers charge HOW MUCH per hour?!', type: 'negative', effectType: 'balance', minPercent: 2, maxPercent: 4 },
  { id: 35, name: 'Foundation Crack', flavor: "That's not supposed to move like that...", type: 'negative', effectType: 'property_value', minPercent: 7, maxPercent: 11 },
  { id: 36, name: 'Ponzi Scheme', flavor: 'It was NOT a legitimate investment opportunity.', type: 'negative', effectType: 'portfolio', minPercent: 0.1, maxPercent: 0.2 },
  { id: 37, name: 'HOA Fine', flavor: 'Your grass was 0.5 inches too tall.', type: 'negative', effectType: 'flat', minValue: 200, maxValue: 350 },
  { id: 38, name: 'Recession', flavor: 'The economy decided to take a nap.', type: 'negative', effectType: 'balance', minPercent: 2, maxPercent: 3 },
  { id: 39, name: 'Vandalism', flavor: 'Local teens discovered your property.', type: 'negative', effectType: 'flat', minValue: 1200, maxValue: 1800 },
  { id: 40, name: 'Tax Lien', flavor: 'The government wants their cut. ALL of it.', type: 'negative', effectType: 'property_value', minPercent: 12, maxPercent: 18 },
  // Neutral Cards (41-50)
  { id: 41, name: 'Quiet Day', flavor: 'Nothing happened. Enjoy the peace while it lasts.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 42, name: 'Mail Call', flavor: 'Just ads and a pizza coupon. Maybe next time.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 43, name: 'Window Shopping', flavor: 'You looked at boats you can\'t afford. Classic.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 44, name: 'Dream Big', flavor: 'You imagined owning a private island. Someday...', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 45, name: 'Coffee Break', flavor: 'You took a well-deserved break. Productivity? Never heard of her.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 46, name: 'Déjà Vu', flavor: 'Didn\'t this happen yesterday? Weird.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 47, name: 'Lost in Thought', flavor: 'You spent an hour wondering if fish get thirsty.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 48, name: 'False Alarm', flavor: 'That noise? Just the house settling. Probably.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 49, name: 'Status Quo', flavor: 'Everything stayed exactly the same. How thrilling.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 },
  { id: 50, name: 'Plot Armor', flavor: 'Something almost happened, but then it didn\'t.', type: 'neutral', effectType: 'none', minValue: 0, maxValue: 0 }
];

// In-memory cache
const guildPropertySettings = new Map();

function initProperty(database) {
  db = database;
  
  // Create property settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS property_settings (
      guild_id TEXT PRIMARY KEY,
      purchase_fee INTEGER DEFAULT 5000,
      property_limit INTEGER DEFAULT 3,
      rent_percent REAL DEFAULT 1.0,
      card_cooldown_minutes INTEGER DEFAULT 120,
      negative_card_odds INTEGER DEFAULT 50,
      enabled INTEGER DEFAULT 1,
      required_role TEXT DEFAULT NULL,
      register_price INTEGER DEFAULT 10000
    );
  `);
  
  // Add required_role column if it doesn't exist (migration)
  try {
    db.run(`ALTER TABLE property_settings ADD COLUMN required_role TEXT DEFAULT NULL`);
  } catch (e) {
    // Column already exists
  }

  // Add register_price column if it doesn't exist (migration)
  try {
    db.run(`ALTER TABLE property_settings ADD COLUMN register_price INTEGER DEFAULT 10000`);
  } catch (e) {
    // Column already exists
  }
  
  // Create properties table (customizable per guild)
  db.run(`
    CREATE TABLE IF NOT EXISTS properties (
      guild_id TEXT NOT NULL,
      property_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      tier INTEGER NOT NULL,
      value INTEGER NOT NULL,
      PRIMARY KEY (guild_id, property_id)
    );
  `);
  
  // Create owned properties table
  db.run(`
    CREATE TABLE IF NOT EXISTS owned_properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      property_id INTEGER NOT NULL,
      purchased_at INTEGER NOT NULL
    );
  `);
  
  // Create wealth cards table (customizable per guild)
  db.run(`
    CREATE TABLE IF NOT EXISTS wealth_cards (
      guild_id TEXT NOT NULL,
      card_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      flavor TEXT NOT NULL,
      type TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      min_value REAL NOT NULL,
      max_value REAL NOT NULL,
      PRIMARY KEY (guild_id, card_id)
    );
  `);
  
  // Create user cards table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      card_id INTEGER NOT NULL,
      granted_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0
    );
  `);
  
  // Migrate card_cooldowns table to support per-property cooldowns
  // Check if property_id column exists
  const tableInfo = db.exec("PRAGMA table_info(card_cooldowns)");
  const hasPropertyId = tableInfo.length > 0 && 
    tableInfo[0].values.some(col => col[1] === 'property_id');
  
  if (!hasPropertyId) {
    // Drop old table and recreate with property_id
    console.log('🔄 Migrating card_cooldowns table for per-property cooldowns...');
    db.run('DROP TABLE IF EXISTS card_cooldowns');
  }
  
  // Create card cooldown table (per property)
  db.run(`
    CREATE TABLE IF NOT EXISTS card_cooldowns (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      property_id INTEGER NOT NULL,
      last_played INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, property_id)
    );
  `);
  
  console.log('🏠 Property system initialized');
}

// ============ SETTINGS ============

function getPropertySettings(guildId) {
  if (guildPropertySettings.has(guildId)) {
    return guildPropertySettings.get(guildId);
  }
  
  if (db) {
    const result = db.exec('SELECT * FROM property_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const settings = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const parsed = {
        purchaseFee: settings.purchase_fee,
        propertyLimit: settings.property_limit,
        rentPercent: settings.rent_percent,
        cardCooldownMinutes: settings.card_cooldown_minutes,
        negativeCardOdds: settings.negative_card_odds || 50,
        enabled: settings.enabled === 1,
        requiredRole: settings.required_role || null,
        registerPrice: settings.register_price || 10000
      };
      
      guildPropertySettings.set(guildId, parsed);
      return parsed;
    }
  }
  
  // Return defaults
  return {
    purchaseFee: 5000,
    propertyLimit: 3,
    rentPercent: 1.0,
    cardCooldownMinutes: 120,
    negativeCardOdds: 50,
    enabled: true,
    requiredRole: null,
    registerPrice: 10000
  };
}

function updatePropertySettings(guildId, updates) {
  if (!db) return;
  
  // Merge updates with existing settings
  const current = getPropertySettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO property_settings 
    (guild_id, purchase_fee, property_limit, rent_percent, card_cooldown_minutes, negative_card_odds, enabled, required_role, register_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.purchaseFee,
    settings.propertyLimit,
    settings.rentPercent,
    settings.cardCooldownMinutes,
    settings.negativeCardOdds || 50,
    settings.enabled ? 1 : 0,
    settings.requiredRole || null,
    settings.registerPrice || 10000
  ]);
  
  guildPropertySettings.set(guildId, settings);
}

// ============ PROPERTIES ============

function getProperties(guildId) {
  if (!db) return DEFAULT_PROPERTIES;
  
  const result = db.exec('SELECT * FROM properties WHERE guild_id = ? ORDER BY property_id', [guildId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    // Initialize with defaults
    initializeDefaultProperties(guildId);
    return DEFAULT_PROPERTIES;
  }
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    const obj = cols.reduce((o, col, i) => ({ ...o, [col]: row[i] }), {});
    return {
      id: obj.property_id,
      name: obj.name,
      tier: obj.tier,
      value: obj.value
    };
  });
}

function initializeDefaultProperties(guildId) {
  if (!db) return;
  
  for (const prop of DEFAULT_PROPERTIES) {
    db.run(`
      INSERT OR IGNORE INTO properties (guild_id, property_id, name, tier, value)
      VALUES (?, ?, ?, ?, ?)
    `, [guildId, prop.id, prop.name, prop.tier, prop.value]);
  }
}

function updateProperty(guildId, propertyId, updates) {
  if (!db) return;
  
  // Make sure properties are initialized for this guild first
  getProperties(guildId);
  
  // Get current property data from database
  const result = db.exec('SELECT * FROM properties WHERE guild_id = ? AND property_id = ?', [guildId, propertyId]);
  if (result.length === 0 || result[0].values.length === 0) return;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const prop = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  
  // Merge updates with existing values
  const name = updates.name !== undefined ? updates.name : prop.name;
  const tier = updates.tier !== undefined ? updates.tier : prop.tier;
  const value = updates.value !== undefined ? updates.value : prop.value;
  
  db.run(`
    UPDATE properties SET name = ?, tier = ?, value = ? WHERE guild_id = ? AND property_id = ?
  `, [
    name, 
    tier,
    value, 
    guildId, 
    propertyId
  ]);
}

function getProperty(guildId, propertyId) {
  const properties = getProperties(guildId);
  return properties.find(p => p.id === propertyId);
}

// ============ OWNED PROPERTIES ============

function getUserProperties(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT op.*, p.name, p.tier, p.value 
    FROM owned_properties op
    JOIN properties p ON op.guild_id = p.guild_id AND op.property_id = p.property_id
    WHERE op.guild_id = ? AND op.user_id = ?
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getUserPropertyCount(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(
    'SELECT COUNT(*) as count FROM owned_properties WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0];
}

function getTotalPropertyValue(guildId, userId) {
  const properties = getUserProperties(guildId, userId);
  return properties.reduce((sum, p) => sum + p.value, 0);
}

function buyRandomProperty(guildId, userId) {
  if (!db) return null;
  
  const properties = getProperties(guildId);
  
  // Weighted random selection by tier
  const roll = Math.random() * 100;
  let cumulative = 0;
  let selectedTier = 1;
  
  for (const [tier, weight] of Object.entries(TIER_WEIGHTS)) {
    cumulative += weight;
    if (roll < cumulative) {
      selectedTier = parseInt(tier);
      break;
    }
  }
  
  // Get properties in selected tier
  const tierProperties = properties.filter(p => p.tier === selectedTier);
  if (tierProperties.length === 0) return null;
  
  // Random property from tier
  const property = tierProperties[Math.floor(Math.random() * tierProperties.length)];
  
  // Add to owned
  db.run(`
    INSERT INTO owned_properties (guild_id, user_id, property_id, purchased_at)
    VALUES (?, ?, ?, ?)
  `, [guildId, userId, property.id, Date.now()]);
  
  return property;
}

function sellProperty(guildId, userId, ownedPropertyId) {
  if (!db) return null;
  
  // Get the owned property
  const result = db.exec(`
    SELECT op.*, p.name, p.tier, p.value 
    FROM owned_properties op
    JOIN properties p ON op.guild_id = p.guild_id AND op.property_id = p.property_id
    WHERE op.id = ? AND op.guild_id = ? AND op.user_id = ?
  `, [ownedPropertyId, guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const property = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
  
  // Remove from owned
  db.run('DELETE FROM owned_properties WHERE id = ?', [ownedPropertyId]);
  
  return property;
}

// Seize a property from a user (used for loan default collateral)
function seizePropertyFromUser(guildId, userId) {
  if (!db) return null;
  
  // Get user's properties, ordered by value (seize lowest value first)
  const result = db.exec(`
    SELECT op.*, p.name, p.tier, p.value 
    FROM owned_properties op
    JOIN properties p ON op.guild_id = p.guild_id AND op.property_id = p.property_id
    WHERE op.guild_id = ? AND op.user_id = ?
    ORDER BY p.value ASC
    LIMIT 1
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const property = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
  
  // Remove from owned (returns to market)
  db.run('DELETE FROM owned_properties WHERE id = ?', [property.id]);
  
  return property;
}

// ============ WEALTH CARDS ============

function getCards(guildId) {
  if (!db) {
    // Return DEFAULT_CARDS with consistent field names
    return DEFAULT_CARDS.map(c => ({
      id: c.id,
      name: c.name,
      flavor: c.flavor,
      type: c.type,
      effect_type: c.effectType,
      min_value: (c.effectType === 'flat' || c.effectType === 'none') ? c.minValue : c.minPercent,
      max_value: (c.effectType === 'flat' || c.effectType === 'none') ? c.maxValue : c.maxPercent
    }));
  }
  
  const result = db.exec('SELECT * FROM wealth_cards WHERE guild_id = ? ORDER BY card_id', [guildId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    initializeDefaultCards(guildId);
    // Return DEFAULT_CARDS with consistent field names
    return DEFAULT_CARDS.map(c => ({
      id: c.id,
      name: c.name,
      flavor: c.flavor,
      type: c.type,
      effect_type: c.effectType,
      min_value: (c.effectType === 'flat' || c.effectType === 'none') ? c.minValue : c.minPercent,
      max_value: (c.effectType === 'flat' || c.effectType === 'none') ? c.maxValue : c.maxPercent
    }));
  }
  
  // Check if we have all 50 cards - if not, add missing ones
  if (result[0].values.length < DEFAULT_CARDS.length) {
    initializeDefaultCards(guildId);
    // Re-fetch after initialization
    const refreshed = db.exec('SELECT * FROM wealth_cards WHERE guild_id = ? ORDER BY card_id', [guildId]);
    if (refreshed.length > 0 && refreshed[0].values.length > 0) {
      return refreshed[0].values.map(row => {
        const cols = refreshed[0].columns;
        const obj = cols.reduce((o, col, i) => ({ ...o, [col]: row[i] }), {});
        return {
          id: obj.card_id,
          name: obj.name,
          flavor: obj.flavor,
          type: obj.type,
          effect_type: obj.effect_type,
          min_value: obj.min_value,
          max_value: obj.max_value
        };
      });
    }
  }
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    const obj = cols.reduce((o, col, i) => ({ ...o, [col]: row[i] }), {});
    return {
      id: obj.card_id,
      name: obj.name,
      flavor: obj.flavor,
      type: obj.type,
      effect_type: obj.effect_type,
      min_value: obj.min_value,
      max_value: obj.max_value
    };
  });
}

function initializeDefaultCards(guildId) {
  if (!db) return;
  
  for (const card of DEFAULT_CARDS) {
    // For flat and none effect types, use minValue/maxValue; otherwise use minPercent/maxPercent
    const minVal = (card.effectType === 'flat' || card.effectType === 'none') ? card.minValue : card.minPercent;
    const maxVal = (card.effectType === 'flat' || card.effectType === 'none') ? card.maxValue : card.maxPercent;
    
    db.run(`
      INSERT OR IGNORE INTO wealth_cards (guild_id, card_id, name, flavor, type, effect_type, min_value, max_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [guildId, card.id, card.name, card.flavor, card.type, card.effectType, minVal, maxVal]);
  }
  
  // Fix any corrupted neutral cards (they may have NULL values from a previous bug)
  for (const card of DEFAULT_CARDS.filter(c => c.type === 'neutral')) {
    db.run(`
      UPDATE wealth_cards 
      SET min_value = ?, max_value = ?, effect_type = ?
      WHERE guild_id = ? AND card_id = ? AND (min_value IS NULL OR max_value IS NULL OR effect_type IS NULL)
    `, [card.minValue, card.maxValue, card.effectType, guildId, card.id]);
  }
}

function updateCard(guildId, cardId, updates) {
  if (!db) return;
  
  // Make sure cards are initialized for this guild first
  getCards(guildId);
  
  // Get current card data from database
  const result = db.exec('SELECT * FROM wealth_cards WHERE guild_id = ? AND card_id = ?', [guildId, cardId]);
  if (result.length === 0 || result[0].values.length === 0) return;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const card = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  
  // Merge updates with existing values
  const name = updates.name !== undefined ? updates.name : card.name;
  const flavor = updates.flavor !== undefined ? updates.flavor : card.flavor;
  const type = updates.type !== undefined ? updates.type : card.type;
  const effectType = updates.effectType !== undefined ? updates.effectType : card.effect_type;
  const minValue = updates.minValue !== undefined ? updates.minValue : card.min_value;
  const maxValue = updates.maxValue !== undefined ? updates.maxValue : card.max_value;
  
  db.run(`
    UPDATE wealth_cards 
    SET name = ?, flavor = ?, type = ?, effect_type = ?, min_value = ?, max_value = ?
    WHERE guild_id = ? AND card_id = ?
  `, [
    name,
    flavor,
    type,
    effectType,
    minValue,
    maxValue,
    guildId,
    cardId
  ]);
}

function createCard(guildId, cardData) {
  if (!db) return null;
  
  // Find the next available card_id for this guild
  const result = db.exec('SELECT MAX(card_id) as max_id FROM wealth_cards WHERE guild_id = ?', [guildId]);
  const maxId = result.length > 0 && result[0].values.length > 0 && result[0].values[0][0] 
    ? result[0].values[0][0] 
    : 0;
  const newId = maxId + 1;
  
  const { name, flavor, type, effectType, minValue, maxValue } = cardData;
  
  db.run(`
    INSERT INTO wealth_cards (guild_id, card_id, name, flavor, type, effect_type, min_value, max_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [guildId, newId, name, flavor, type, effectType, minValue, maxValue]);
  
  return newId;
}

function deleteCard(guildId, cardId) {
  if (!db) return false;
  
  // First remove any user cards referencing this card
  db.run('DELETE FROM user_cards WHERE guild_id = ? AND card_id = ?', [guildId, cardId]);
  
  // Then remove the card definition
  db.run('DELETE FROM wealth_cards WHERE guild_id = ? AND card_id = ?', [guildId, cardId]);
  
  return true;
}

// ============ USER CARDS ============

function getUserCards(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT uc.*, wc.name, wc.flavor, wc.type, wc.effect_type, wc.min_value, wc.max_value
    FROM user_cards uc
    JOIN wealth_cards wc ON uc.guild_id = wc.guild_id AND uc.card_id = wc.card_id
    WHERE uc.guild_id = ? AND uc.user_id = ? AND uc.used = 0
    ORDER BY uc.granted_at
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function grantCard(guildId, userId, cardId) {
  if (!db) return;
  
  db.run(`
    INSERT INTO user_cards (guild_id, user_id, card_id, granted_at)
    VALUES (?, ?, ?, ?)
  `, [guildId, userId, cardId, Date.now()]);
}

function useCard(userCardId) {
  if (!db) return;
  
  db.run('UPDATE user_cards SET used = 1 WHERE id = ?', [userCardId]);
}

function removeCard(userCardId) {
  if (!db) return;
  
  db.run('DELETE FROM user_cards WHERE id = ?', [userCardId]);
}

function getUsersWithCards(guildId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT DISTINCT user_id, COUNT(*) as card_count
    FROM user_cards
    WHERE guild_id = ? AND used = 0
    GROUP BY user_id
  `, [guildId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => ({
    userId: row[0],
    cardCount: row[1]
  }));
}

function drawRandomCard(guildId, userId) {
  const cards = getCards(guildId);
  
  if (cards.length === 0) return null;
  
  // Pick a truly random card from ALL cards
  return cards[Math.floor(Math.random() * cards.length)];
}

// ============ COOLDOWN ============

function getCardCooldown(guildId, userId, propertyId) {
  if (!db) return null;
  
  const result = db.exec(
    'SELECT last_played FROM card_cooldowns WHERE guild_id = ? AND user_id = ? AND property_id = ?',
    [guildId, userId, propertyId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0];
}

function setCardCooldown(guildId, userId, propertyId) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO card_cooldowns (guild_id, user_id, property_id, last_played)
    VALUES (?, ?, ?, ?)
  `, [guildId, userId, propertyId, Date.now()]);
}

function canPlayCard(guildId, userId, propertyId) {
  const settings = getPropertySettings(guildId);
  const lastPlayed = getCardCooldown(guildId, userId, propertyId);
  
  if (!lastPlayed) return { canPlay: true, remainingMs: 0 };
  
  const cooldownMs = settings.cardCooldownMinutes * 60 * 1000;
  const elapsed = Date.now() - lastPlayed;
  
  if (elapsed >= cooldownMs) {
    return { canPlay: true, remainingMs: 0 };
  }
  
  return { canPlay: false, remainingMs: cooldownMs - elapsed };
}

// Get cooldown status for all user's properties
function getAllPropertyCooldowns(guildId, userId) {
  const properties = getUserProperties(guildId, userId);
  const settings = getPropertySettings(guildId);
  const cooldownMs = settings.cardCooldownMinutes * 60 * 1000;
  
  return properties.map(prop => {
    const lastPlayed = getCardCooldown(guildId, userId, prop.id);
    if (!lastPlayed) {
      return { property: prop, canPlay: true, remainingMs: 0 };
    }
    const elapsed = Date.now() - lastPlayed;
    if (elapsed >= cooldownMs) {
      return { property: prop, canPlay: true, remainingMs: 0 };
    }
    return { property: prop, canPlay: false, remainingMs: cooldownMs - elapsed };
  });
}

// ============ DAILY CARD DISTRIBUTION ============

function distributeCardsForUser(guildId, userId) {
  const properties = getUserProperties(guildId, userId);
  if (properties.length === 0) return 0;
  
  // Calculate total cards based on property tiers
  const cardsPerTier = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
  let totalCards = 0;
  
  for (const prop of properties) {
    totalCards += cardsPerTier[prop.tier] || 1;
  }
  
  // Grant random cards (truly random from all cards)
  const cards = getCards(guildId);
  
  for (let i = 0; i < totalCards; i++) {
    if (cards.length > 0) {
      const card = cards[Math.floor(Math.random() * cards.length)];
      grantCard(guildId, userId, card.id);
    }
  }
  
  return totalCards;
}

function getAllPropertyOwners(guildId) {
  if (!db) return [];
  
  const result = db.exec(
    'SELECT DISTINCT user_id FROM owned_properties WHERE guild_id = ?',
    [guildId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  return result[0].values.map(row => row[0]);
}

// ============ CARD EFFECT CALCULATION ============

function calculateCardEffect(card, rentAmount, userBalance, portfolioValue, propertyValue) {
  // Neutral cards have no effect
  if (card.type === 'neutral' || card.effect_type === 'none') {
    return { amount: 0, description: 'No effect', roll: 0 };
  }
  
  const min = card.min_value;
  const max = card.max_value;
  const roll = min + Math.random() * (max - min);
  
  let amount = 0;
  let description = '';
  
  switch (card.effect_type) {
    case 'flat':
      amount = Math.round(roll);
      description = `${amount} ${CURRENCY}`;
      break;
    case 'rent_bonus':
      amount = Math.round(rentAmount * (roll / 100));
      description = `${roll.toFixed(1)}% of rent (${amount} ${CURRENCY})`;
      break;
    case 'balance':
    case 'ubb_balance': // Legacy support for existing database records
      amount = Math.round(userBalance * (roll / 100));
      description = `${roll.toFixed(1)}% of bank balance (${amount} ${CURRENCY})`;
      break;
    case 'portfolio':
      amount = Math.round(portfolioValue * (roll / 100));
      description = `${roll.toFixed(1)}% of portfolio (${amount} ${CURRENCY})`;
      break;
    case 'property_value':
      amount = Math.round(propertyValue * (roll / 100));
      description = `${roll.toFixed(1)}% of property value (${amount} ${CURRENCY})`;
      break;
  }
  
  // Apply sign based on card type
  if (card.type === 'negative') {
    amount = -Math.abs(amount);
  }
  
  return { amount, description, roll };
}

// ============ TIER HELPERS ============

function getTierName(tier) {
  const names = {
    1: 'Common',
    2: 'Uncommon',
    3: 'Rare',
    4: 'Epic',
    5: 'Legendary'
  };
  return names[tier] || 'Unknown';
}

function getTierEmoji(tier) {
  const emojis = {
    1: '🛖',
    2: '🏚️',
    3: '🏠',
    4: '🏡',
    5: '🏦'
  };
  return emojis[tier] || '🏠';
}

// ============ CARD DISTRIBUTION SCHEDULER ============

function scheduleCardDistribution(database) {
  db = database;
  
  // Calculate time until next midnight
  function getTimeUntilMidnight() {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    return midnight - now;
  }
  
  // Distribute cards to all property owners
  function distributeAllCards() {
    try {
      console.log('🃏 Running daily card distribution...');
      
      // Get all guilds with property settings
      const guildsResult = db.exec('SELECT DISTINCT guild_id FROM owned_properties');
      
      if (guildsResult.length === 0 || !guildsResult[0].values || guildsResult[0].values.length === 0) {
        console.log('🃏 No property owners found for card distribution');
        return;
      }
      
      const guildIds = guildsResult[0].values.map(row => row[0]);
      let totalCardsDistributed = 0;
      
      for (const guildId of guildIds) {
        try {
          const settings = getPropertySettings(guildId);
          if (!settings.enabled) continue;
          
          const owners = getAllPropertyOwners(guildId);
          
          for (const ownerId of owners) {
            try {
              const cardsGranted = distributeCardsForUser(guildId, ownerId);
              totalCardsDistributed += cardsGranted;
            } catch (userError) {
              console.error(`🃏 Error distributing cards to user ${ownerId}:`, userError.message);
            }
          }
        } catch (guildError) {
          console.error(`🃏 Error processing guild ${guildId}:`, guildError.message);
        }
      }
      
      console.log(`🃏 Daily distribution complete: ${totalCardsDistributed} cards distributed`);
    } catch (error) {
      console.error('🃏 Error during card distribution:', error.message);
    }
  }
  
  // Schedule first run at midnight
  const msUntilMidnight = getTimeUntilMidnight();
  console.log(`🃏 Card distribution scheduled for midnight (${Math.round(msUntilMidnight / 1000 / 60)} minutes)`);
  
  setTimeout(() => {
    distributeAllCards();
    
    // Then run every 24 hours
    setInterval(distributeAllCards, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

module.exports = {
  initProperty,
  scheduleCardDistribution,
  getPropertySettings,
  updatePropertySettings,
  getProperties,
  getProperty,
  updateProperty,
  getUserProperties,
  getUserPropertyCount,
  getTotalPropertyValue,
  buyRandomProperty,
  sellProperty,
  seizePropertyFromUser,
  getCards,
  updateCard,
  createCard,
  deleteCard,
  getUserCards,
  getUsersWithCards,
  grantCard,
  useCard,
  removeCard,
  drawRandomCard,
  canPlayCard,
  setCardCooldown,
  getAllPropertyCooldowns,
  distributeCardsForUser,
  getAllPropertyOwners,
  calculateCardEffect,
  getTierName,
  getTierEmoji,
  TIER_WEIGHTS,
  DEFAULT_PROPERTIES,
  DEFAULT_CARDS
};
