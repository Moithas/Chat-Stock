// Items module for Chat-Stock
// Manages shop items, user inventory, and active effects

const { migrateAddColumn } = require('./database');
const { TTLCache } = require('./cache');

let db = null;

// Effect types that items can have
const EFFECT_TYPES = {
  // Protection effects
  ROB_PROTECTION: 'rob_protection',       // Prevents being robbed
  HACK_PROTECTION: 'hack_protection',     // Prevents being hacked
  
  // Defense effects (reduce attacker's success rate)
  ROB_DEFENSE: 'rob_defense',               // Reduces rob success rate for attackers
  HACK_DEFENSE: 'hack_defense',             // Reduces hack success rate for attackers
  
  // Boost effects
  ROB_SUCCESS_BOOST: 'rob_success_boost', // Increases rob success rate
  HACK_SUCCESS_BOOST: 'hack_success_boost', // Increases hack success rate
  WORK_BOOST: 'work_boost',               // Increases work earnings
  CRIME_BOOST: 'crime_boost',             // Increases crime earnings
  SLUT_BOOST: 'slut_boost',               // Increases slut earnings
  XP_BOOST: 'xp_boost',                   // Increases XP gains
  
  // Risk reduction
  ROB_FINE_REDUCTION: 'rob_fine_reduction', // Reduces fines when caught robbing
  HACK_FINE_REDUCTION: 'hack_fine_reduction', // Reduces fines when caught hacking
  CRIME_FINE_REDUCTION: 'crime_fine_reduction', // Reduces fines when caught
  
  // Special effects
  LOTTERY_BOOST: 'lottery_boost',         // Extra lottery ticket or bonus
  LOTTERY_FREE_TICKET: 'lottery_free_ticket', // Gives a free lottery ticket with random numbers
  BANK_INTEREST_BOOST: 'bank_interest_boost', // Increased bank interest
  COOLDOWN_REDUCTION: 'cooldown_reduction', // Reduces cooldowns
  
  // Debuff effects (for cursed items or penalties)
  EARNINGS_PENALTY: 'earnings_penalty',   // Reduces all earnings
  ROBBERY_VULNERABILITY: 'robbery_vulnerability', // Increases chance of being robbed
  
  // Role grant (automatic - grants a Discord role)
  ROLE_GRANT: 'role_grant',               // Grants a Discord role (effect_value = role ID, duration_hours = 0 for permanent)
  
  // Cosmetic/Service items (require admin fulfillment)
  SERVICE_CUSTOM_EMOJI: 'service_custom_emoji',     // Admin adds a custom emoji for the user
  SERVICE_NICKNAME: 'service_nickname',              // Admin changes user's nickname
  SERVICE_CUSTOM_ROLE: 'service_custom_role',        // Admin creates a custom role for user
  SERVICE_CUSTOM_COLOR: 'service_custom_color',      // Admin gives user a custom role color
  SERVICE_OTHER: 'service_other',                    // Generic service item (use description)
  
  // Access keys (consumed on use, grants entry)
  DUNGEON_KEY: 'dungeon_key',             // Required to enter dungeon (effect_value = tier level)
  
  // Pet discount (consumed on next pet/egg purchase)
  PET_DISCOUNT: 'pet_discount',           // % discount on next pet or egg purchase (single-use coupon)
  
  // VIP gambling room (creates a private channel for the buyer)
  GAMBLING_ROOM: 'gambling_room',                 // Rents a private gambling channel for duration_hours
  GAMBLING_ROOM_INVITE: 'gambling_room_invite',   // Invite one guest to your active gambling room
  
  // Cosmetic (no effect, just collectible)
  COSMETIC: 'cosmetic',                   // No effect, just a collectible/trophy
};

// Human-readable names for effect types (for cooldown messages)
const EFFECT_TYPE_NAMES = {
  [EFFECT_TYPES.ROB_PROTECTION]: 'Rob Protection',
  [EFFECT_TYPES.HACK_PROTECTION]: 'Hack Protection',
  [EFFECT_TYPES.ROB_DEFENSE]: 'Rob Defense',
  [EFFECT_TYPES.HACK_DEFENSE]: 'Hack Defense',
  [EFFECT_TYPES.ROB_SUCCESS_BOOST]: 'Rob Success Boost',
  [EFFECT_TYPES.HACK_SUCCESS_BOOST]: 'Hack Success Boost',
  [EFFECT_TYPES.WORK_BOOST]: 'Work Boost',
  [EFFECT_TYPES.CRIME_BOOST]: 'Crime Boost',
  [EFFECT_TYPES.SLUT_BOOST]: 'Slut Boost',
  [EFFECT_TYPES.XP_BOOST]: 'XP Boost',
  [EFFECT_TYPES.ROB_FINE_REDUCTION]: 'Rob Fine Reduction',
  [EFFECT_TYPES.HACK_FINE_REDUCTION]: 'Hack Fine Reduction',
  [EFFECT_TYPES.CRIME_FINE_REDUCTION]: 'Crime Fine Reduction',
  [EFFECT_TYPES.LOTTERY_BOOST]: 'Lottery Boost',
  [EFFECT_TYPES.LOTTERY_FREE_TICKET]: 'Lottery Free Ticket',
  [EFFECT_TYPES.BANK_INTEREST_BOOST]: 'Bank Interest Boost',
  [EFFECT_TYPES.COOLDOWN_REDUCTION]: 'Cooldown Reduction',
  [EFFECT_TYPES.EARNINGS_PENALTY]: 'Earnings Penalty',
  [EFFECT_TYPES.ROBBERY_VULNERABILITY]: 'Robbery Vulnerability',
  [EFFECT_TYPES.ROLE_GRANT]: 'Role Grant',
  [EFFECT_TYPES.DUNGEON_KEY]: 'Dungeon Key',
  [EFFECT_TYPES.GAMBLING_ROOM]: 'VIP Gambling Room',
  [EFFECT_TYPES.GAMBLING_ROOM_INVITE]: 'VIP Room Guest Pass',
  [EFFECT_TYPES.COSMETIC]: 'Cosmetic',
};

// Item categories for organization
const ITEM_CATEGORIES = {
  PROTECTION: 'protection',
  BOOST: 'boost',
  UTILITY: 'utility',
  CONSUMABLE: 'consumable',
  SPECIAL: 'special'
};

// Default starter items
const DEFAULT_ITEMS = [
  {
    name: 'Bodyguard',
    description: 'Hire a bodyguard to protect you from robbers for 24 hours.',
    price: 50000,
    category: 'protection',
    effect_type: 'rob_protection',
    effect_value: 100, // 100% protection
    duration_hours: 24,
    max_stack: 1,
    enabled: true,
    emoji: '🛡️'
  },
  {
    name: 'Firewall',
    description: 'Install a firewall to protect against hackers for 24 hours.',
    price: 50000,
    category: 'protection',
    effect_type: 'hack_protection',
    effect_value: 100, // 100% protection
    duration_hours: 24,
    max_stack: 1,
    enabled: true,
    emoji: '🔥'
  },
  {
    name: 'Lucky Charm',
    description: 'A lucky charm that boosts your rob success rate by 15% for 12 hours.',
    price: 25000,
    category: 'boost',
    effect_type: 'rob_success_boost',
    effect_value: 15, // +15% success
    duration_hours: 12,
    max_stack: 1,
    enabled: true,
    emoji: '🍀'
  },
  {
    name: 'Energy Drink',
    description: 'Doubles your work earnings for the next 6 hours!',
    price: 15000,
    category: 'boost',
    effect_type: 'work_boost',
    effect_value: 100, // +100% earnings
    duration_hours: 6,
    max_stack: 1,
    enabled: true,
    emoji: '⚡'
  },
  {
    name: 'Hacking Tools',
    description: 'Advanced hacking tools that boost your hack success rate by 20% for 8 hours.',
    price: 40000,
    category: 'boost',
    effect_type: 'hack_success_boost',
    effect_value: 20, // +20% success
    duration_hours: 8,
    max_stack: 1,
    enabled: true,
    emoji: '💻'
  },
  {
    name: 'Lawyer on Retainer',
    description: 'Reduces fines by 50% when caught committing crimes for 24 hours.',
    price: 75000,
    category: 'utility',
    effect_type: 'crime_fine_reduction',
    effect_value: 50, // -50% fines
    duration_hours: 24,
    max_stack: 1,
    enabled: true,
    emoji: '⚖️'
  },
  {
    name: 'Lockpick Kit',
    description: 'A quality lockpick set that reduces rob fines by 30% for 12 hours.',
    price: 35000,
    category: 'utility',
    effect_type: 'rob_fine_reduction',
    effect_value: 30, // -30% rob fines
    duration_hours: 12,
    max_stack: 1,
    enabled: true,
    emoji: '🔓'
  },
  {
    name: 'Proxy Server',
    description: 'Route through proxies to reduce hack fines by 30% for 12 hours.',
    price: 45000,
    category: 'utility',
    effect_type: 'hack_fine_reduction',
    effect_value: 30, // -30% hack fines
    duration_hours: 12,
    max_stack: 1,
    enabled: true,
    emoji: '🛡️'
  },
  {
    name: 'XP Booster',
    description: 'Gain 50% more XP from all activities for 12 hours.',
    price: 30000,
    category: 'boost',
    effect_type: 'xp_boost',
    effect_value: 50, // +50% XP
    duration_hours: 12,
    max_stack: 1,
    enabled: true,
    emoji: '📈'
  },
  {
    name: 'VIP Gambling Room',
    description: 'Rent a private gambling channel for 1 week. Only you can post or use commands; everyone else can watch. Allowed games: blackjack, roulette, scratcher, videopoker, three-card-poker, letitride, lottery, plus deposit/withdraw/give/balance.',
    price: 500000,
    category: 'special',
    effect_type: 'gambling_room',
    effect_value: 0,
    duration_hours: 168, // 7 days
    max_stack: 1,
    enabled: true,
    emoji: '🎰'
  },
  {
    name: 'VIP Room Guest Pass',
    description: 'Invite one guest into your VIP Gambling Room. The guest gets the same access as you for the remainder of the room\'s rental. Requires you to own an active VIP Gambling Room.',
    price: 75000,
    category: 'special',
    effect_type: 'gambling_room_invite',
    effect_value: 0,
    duration_hours: 0, // duration follows the room
    max_stack: 10,
    enabled: true,
    emoji: '🎟️'
  }
];

// Cache for settings per guild
const guildItemSettings = new TTLCache();

function initItems(database) {
  db = database;
  
  // Create shop items table
  db.run(`
    CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL DEFAULT 1000,
      category TEXT DEFAULT 'utility',
      effect_type TEXT,
      effect_value INTEGER DEFAULT 0,
      duration_hours INTEGER DEFAULT 24,
      max_stack INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      usable INTEGER DEFAULT 1,
      emoji TEXT DEFAULT '📦',
      created_at INTEGER NOT NULL,
      UNIQUE(guild_id, name)
    )
  `);
  
  // Add usable column if it doesn't exist (migration for existing DBs)
  migrateAddColumn(db, 'shop_items', 'usable INTEGER DEFAULT 1');
  
  // Add use_cooldown_hours column if it doesn't exist (cooldown between uses of same effect type)
  migrateAddColumn(db, 'shop_items', 'use_cooldown_hours INTEGER DEFAULT 0');
  
  // Add effect_value_text column for storing large IDs like Discord snowflakes (role IDs)
  migrateAddColumn(db, 'shop_items', 'effect_value_text TEXT');

  // Add hunt_eligible column (whether item can drop from /hunt)
  migrateAddColumn(db, 'shop_items', 'hunt_eligible INTEGER DEFAULT 0');
  
  // Create user inventory table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      purchased_at INTEGER NOT NULL,
      FOREIGN KEY (item_id) REFERENCES shop_items(id)
    )
  `);
  
  // Create active effects table
  db.run(`
    CREATE TABLE IF NOT EXISTS active_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      effect_value INTEGER DEFAULT 0,
      source_item_id INTEGER,
      source_item_name TEXT,
      activated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  
  // Create purchase history table
  db.run(`
    CREATE TABLE IF NOT EXISTS item_purchase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      price_paid INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      purchased_at INTEGER NOT NULL
    )
  `);
  
  // Create item settings table (for guild-specific shop settings)
  db.run(`
    CREATE TABLE IF NOT EXISTS item_settings (
      guild_id TEXT PRIMARY KEY,
      shop_enabled INTEGER DEFAULT 1,
      shop_channel_id TEXT,
      announcement_channel_id TEXT,
      ticket_category_id TEXT,
      ticket_log_channel_id TEXT
    )
  `);
  
  // Add ticket columns if they don't exist (migration for existing databases)
  migrateAddColumn(db, 'item_settings', 'ticket_category_id TEXT');
  migrateAddColumn(db, 'item_settings', 'ticket_log_channel_id TEXT');
  migrateAddColumn(db, 'item_settings', 'casino_category_id TEXT');
  
  // Create fulfillment requests table (for service/cosmetic items that need admin action)
  db.run(`
    CREATE TABLE IF NOT EXISTS item_fulfillment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      effect_type TEXT,
      user_notes TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      fulfilled_by TEXT,
      created_at INTEGER NOT NULL,
      fulfilled_at INTEGER,
      ticket_channel_id TEXT,
      FOREIGN KEY (item_id) REFERENCES shop_items(id)
    )
  `);
  
  // Add ticket_channel_id column if it doesn't exist (migration for existing databases)
  migrateAddColumn(db, 'item_fulfillment_requests', 'ticket_channel_id TEXT');
  
  // Create indexes for better performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_inventory_guild_user ON user_inventory(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_active_effects_guild_user ON active_effects(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_active_effects_expires ON active_effects(expires_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_shop_items_guild ON shop_items(guild_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_fulfillment_guild_status ON item_fulfillment_requests(guild_id, status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_fulfillment_ticket ON item_fulfillment_requests(ticket_channel_id)`);
  
  // Create effect cooldowns table (tracks when users can next use items of a specific effect type)
  db.run(`
    CREATE TABLE IF NOT EXISTS effect_use_cooldowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      last_used_at INTEGER NOT NULL,
      cooldown_expires_at INTEGER NOT NULL,
      UNIQUE(guild_id, user_id, effect_type)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_effect_cooldowns_guild_user ON effect_use_cooldowns(guild_id, user_id)`);
  
  // Create temporary role grants table (tracks roles granted by items that need to be removed later)
  db.run(`
    CREATE TABLE IF NOT EXISTS temporary_role_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      source_item_id INTEGER,
      source_item_name TEXT,
      granted_at INTEGER NOT NULL,
      expires_at INTEGER,
      is_permanent INTEGER DEFAULT 0,
      UNIQUE(guild_id, user_id, role_id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_temp_roles_guild ON temporary_role_grants(guild_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_temp_roles_expires ON temporary_role_grants(expires_at)`);
  
  // Create item-specific use cooldowns table (tracks when users last used each specific item)
  db.run(`
    CREATE TABLE IF NOT EXISTS item_use_cooldowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      cooldown_expires_at INTEGER NOT NULL,
      UNIQUE(guild_id, user_id, item_id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_item_cooldowns_guild_user ON item_use_cooldowns(guild_id, user_id)`);
  
  // Create VIP gambling rooms table (private channels rented via the shop)
  db.run(`
    CREATE TABLE IF NOT EXISTS gambling_rooms (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gambling_rooms_owner ON gambling_rooms(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gambling_rooms_expires ON gambling_rooms(expires_at)`);

  // Create gambling room guests table (one row per invited guest per room)
  db.run(`
    CREATE TABLE IF NOT EXISTS gambling_room_guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      invited_at INTEGER NOT NULL,
      UNIQUE(channel_id, user_id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gambling_room_guests_channel ON gambling_room_guests(channel_id)`);

  // Populate in-memory cache of active VIP room channel IDs
  loadVipRoomChannelCache();

  console.log('🛒 Item shop system initialized');
}

// Get item settings for a guild
function getItemSettings(guildId) {
  if (guildItemSettings.has(guildId)) {
    return guildItemSettings.get(guildId);
  }
  
  if (!db) return { shopEnabled: true, shopChannelId: null, announcementChannelId: null, ticketCategoryId: null, ticketLogChannelId: null, casinoCategoryId: null };
  
  const result = db.exec('SELECT * FROM item_settings WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
    
    const settings = {
      shopEnabled: row.shop_enabled === 1,
      shopChannelId: row.shop_channel_id,
      announcementChannelId: row.announcement_channel_id,
      ticketCategoryId: row.ticket_category_id || null,
      ticketLogChannelId: row.ticket_log_channel_id || null,
      casinoCategoryId: row.casino_category_id || null
    };
    guildItemSettings.set(guildId, settings);
    return settings;
  }
  
  const defaults = { shopEnabled: true, shopChannelId: null, announcementChannelId: null, ticketCategoryId: null, ticketLogChannelId: null, casinoCategoryId: null };
  guildItemSettings.set(guildId, defaults);
  return defaults;
}

// Update item settings
function updateItemSettings(guildId, updates) {
  if (!db) return;
  
  const current = getItemSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO item_settings (guild_id, shop_enabled, shop_channel_id, announcement_channel_id, ticket_category_id, ticket_log_channel_id, casino_category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.shopEnabled ? 1 : 0,
    settings.shopChannelId,
    settings.announcementChannelId,
    settings.ticketCategoryId,
    settings.ticketLogChannelId,
    settings.casinoCategoryId
  ]);
  
  guildItemSettings.set(guildId, settings);
}

// ===== ITEM MANAGEMENT =====

// Get all items for a guild
function getShopItems(guildId, category = null, enabledOnly = true) {
  if (!db) return [];
  
  let query = 'SELECT * FROM shop_items WHERE guild_id = ?';
  const params = [guildId];
  
  if (enabledOnly) {
    query += ' AND enabled = 1';
  }
  
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  
  query += ' ORDER BY category, price ASC';
  
  const result = db.exec(query, params);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get all hunt-eligible items for a guild
function getHuntEligibleItems(guildId) {
  if (!db) return [];
  const result = db.exec(
    'SELECT * FROM shop_items WHERE guild_id = ? AND hunt_eligible = 1 AND enabled = 1',
    [guildId]
  );
  if (result.length === 0 || result[0].values.length === 0) return [];
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get a specific item by ID
function getShopItem(guildId, itemId) {
  if (!db) return null;
  
  const result = db.exec(
    'SELECT * FROM shop_items WHERE guild_id = ? AND id = ?',
    [guildId, itemId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

// Get a specific item by name
function getShopItemByName(guildId, name) {
  if (!db) return null;
  
  const result = db.exec(
    'SELECT * FROM shop_items WHERE guild_id = ? AND LOWER(name) = LOWER(?)',
    [guildId, name]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

// Add a new item to the shop
function addShopItem(guildId, itemData) {
  if (!db) return null;
  
  try {
    // For role_grant items, store the role ID in effect_value_text to preserve large snowflake IDs
    console.log('[addShopItem Debug] effect_type:', itemData.effect_type, 'effect_value:', itemData.effect_value);
    const effectValueText = itemData.effect_type === 'role_grant' ? String(itemData.effect_value) : null;
    const effectValueInt = itemData.effect_type === 'role_grant' ? 0 : (itemData.effect_value || 0);
    console.log('[addShopItem Debug] effectValueText:', effectValueText, 'effectValueInt:', effectValueInt);
    
    db.run(`
      INSERT INTO shop_items 
      (guild_id, name, description, price, category, effect_type, effect_value, effect_value_text, duration_hours, max_stack, enabled, emoji, use_cooldown_hours, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      guildId,
      itemData.name,
      itemData.description || '',
      itemData.price || 1000,
      itemData.category || 'utility',
      itemData.effect_type || null,
      effectValueInt,
      effectValueText,
      itemData.duration_hours || 24,
      itemData.max_stack || 1,
      itemData.enabled !== false ? 1 : 0,
      itemData.emoji || '📦',
      itemData.use_cooldown_hours || 0,
      Date.now()
    ]);
    
    // Get the inserted item
    const result = db.exec('SELECT last_insert_rowid() as id');
    if (result.length > 0 && result[0].values.length > 0) {
      return getShopItem(guildId, result[0].values[0][0]);
    }
    return null;
  } catch (error) {
    console.error('Error adding shop item:', error);
    return null;
  }
}

// Update an existing item
function updateShopItem(guildId, itemId, updates) {
  if (!db) return false;
  
  const item = getShopItem(guildId, itemId);
  if (!item) return false;
  
  const fields = [];
  const values = [];
  
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.price !== undefined) { fields.push('price = ?'); values.push(updates.price); }
  if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
  if (updates.effect_type !== undefined) { fields.push('effect_type = ?'); values.push(updates.effect_type); }
  if (updates.effect_value !== undefined) { 
    // For role_grant, store in effect_value_text to preserve snowflake IDs
    // Check both the update's effect_type AND the existing item's effect_type
    const isRoleGrant = (updates.effect_type === 'role_grant') || (updates.effect_type === undefined && item.effect_type === 'role_grant');
    if (isRoleGrant) {
      fields.push('effect_value_text = ?'); 
      values.push(String(updates.effect_value));
      fields.push('effect_value = ?');
      values.push(0);
    } else {
      fields.push('effect_value = ?'); 
      values.push(updates.effect_value); 
    }
  }
  if (updates.duration_hours !== undefined) { fields.push('duration_hours = ?'); values.push(updates.duration_hours); }
  if (updates.max_stack !== undefined) { fields.push('max_stack = ?'); values.push(updates.max_stack); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if (updates.emoji !== undefined) { fields.push('emoji = ?'); values.push(updates.emoji); }
  if (updates.use_cooldown_hours !== undefined) { fields.push('use_cooldown_hours = ?'); values.push(updates.use_cooldown_hours); }
  if (updates.usable !== undefined) { fields.push('usable = ?'); values.push(updates.usable); }
  if (updates.hunt_eligible !== undefined) { fields.push('hunt_eligible = ?'); values.push(updates.hunt_eligible); }
  
  if (fields.length === 0) return false;
  
  values.push(guildId, itemId);
  
  try {
    db.run(`UPDATE shop_items SET ${fields.join(', ')} WHERE guild_id = ? AND id = ?`, values);
    return true;
  } catch (error) {
    console.error('Error updating shop item:', error);
    return false;
  }
}

// Delete an item from the shop
function deleteShopItem(guildId, itemId) {
  if (!db) return false;
  
  try {
    // Delete from inventory first
    db.run('DELETE FROM user_inventory WHERE guild_id = ? AND item_id = ?', [guildId, itemId]);
    // Delete the item
    db.run('DELETE FROM shop_items WHERE guild_id = ? AND id = ?', [guildId, itemId]);
    return true;
  } catch (error) {
    console.error('Error deleting shop item:', error);
    return false;
  }
}

// Initialize default items for a guild if none exist; also backfill any
// default items that are missing by name (so newly added defaults appear in
// guilds whose shop is already populated).
function initializeDefaultItems(guildId) {
  if (!db) return;

  const existingItems = getShopItems(guildId, null, false);
  const existingNames = new Set(existingItems.map(i => (i.name || '').toLowerCase()));

  for (const item of DEFAULT_ITEMS) {
    if (existingNames.has((item.name || '').toLowerCase())) continue;
    addShopItem(guildId, item);
  }
}

// ===== INVENTORY MANAGEMENT =====

// Get user's inventory
// Get all users who own a specific item and their quantities
function getItemOwners(guildId, itemId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT ui.user_id, ui.quantity, ui.purchased_at
    FROM user_inventory ui
    WHERE ui.guild_id = ? AND ui.item_id = ? AND ui.quantity > 0
    ORDER BY ui.quantity DESC
  `, [guildId, itemId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getUserInventory(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT ui.*, si.name, si.description, si.category, si.effect_type, si.effect_value, si.duration_hours, si.emoji
    FROM user_inventory ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.guild_id = ? AND ui.user_id = ?
    ORDER BY si.category, si.name
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get inventory item by effect type (returns first match with quantity > 0)
function getInventoryItemByEffect(guildId, userId, effectType) {
  if (!db) return null;
  
  const result = db.exec(`
    SELECT ui.*, si.name, si.description, si.category, si.effect_type, si.effect_value, si.duration_hours, si.emoji
    FROM user_inventory ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.guild_id = ? AND ui.user_id = ? AND si.effect_type = ? AND ui.quantity > 0
    ORDER BY si.effect_value ASC
    LIMIT 1
  `, [guildId, userId, effectType]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

// Get ALL inventory items matching a given effect type (e.g. all dungeon keys of different tiers)
function getAllInventoryItemsByEffect(guildId, userId, effectType) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT ui.*, si.name, si.description, si.category, si.effect_type, si.effect_value, si.duration_hours, si.emoji
    FROM user_inventory ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.guild_id = ? AND ui.user_id = ? AND si.effect_type = ? AND ui.quantity > 0
    ORDER BY si.effect_value ASC
  `, [guildId, userId, effectType]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(vals => cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {}));
}

// Get specific inventory item
function getInventoryItem(guildId, userId, itemId) {
  if (!db) return null;
  
  const result = db.exec(`
    SELECT ui.*, si.name, si.description, si.category, si.effect_type, si.effect_value, si.duration_hours, si.emoji
    FROM user_inventory ui
    JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.guild_id = ? AND ui.user_id = ? AND ui.item_id = ?
  `, [guildId, userId, itemId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

// Add item to user's inventory
function addToInventory(guildId, userId, itemId, quantity = 1) {
  if (!db) return { success: false, error: 'Database not available' };
  
  try {
    // Get the item to check max_stack
    const item = getShopItem(guildId, itemId);
    if (!item) return { success: false, error: 'Item not found' };
    
    const maxStack = item.max_stack || 99;
    
    // Check if user already has this item
    const existing = getInventoryItem(guildId, userId, itemId);
    const currentQty = existing ? existing.quantity : 0;
    
    // Check if adding would exceed max_stack
    if (currentQty + quantity > maxStack) {
      const canAdd = maxStack - currentQty;
      if (canAdd <= 0) {
        return { success: false, error: `You can only hold ${maxStack} of this item`, atMax: true };
      }
      return { success: false, error: `You can only hold ${maxStack} of this item (you have ${currentQty})`, canAdd };
    }
    
    if (existing) {
      // Update quantity
      db.run(
        'UPDATE user_inventory SET quantity = quantity + ? WHERE guild_id = ? AND user_id = ? AND item_id = ?',
        [quantity, guildId, userId, itemId]
      );
    } else {
      // Insert new inventory record
      db.run(
        'INSERT INTO user_inventory (guild_id, user_id, item_id, quantity, purchased_at) VALUES (?, ?, ?, ?, ?)',
        [guildId, userId, itemId, quantity, Date.now()]
      );
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error adding to inventory:', error);
    return { success: false, error: 'Database error' };
  }
}

// Remove item from inventory
function removeFromInventory(guildId, userId, itemId, quantity = 1) {
  if (!db) return false;
  
  try {
    const existing = getInventoryItem(guildId, userId, itemId);
    if (!existing) return false;
    
    if (existing.quantity <= quantity) {
      // Remove entirely
      db.run(
        'DELETE FROM user_inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?',
        [guildId, userId, itemId]
      );
    } else {
      // Reduce quantity
      db.run(
        'UPDATE user_inventory SET quantity = quantity - ? WHERE guild_id = ? AND user_id = ? AND item_id = ?',
        [quantity, guildId, userId, itemId]
      );
    }
    
    return true;
  } catch (error) {
    console.error('Error removing from inventory:', error);
    return false;
  }
}

// ===== EFFECT MANAGEMENT =====

// Get user's active effects
function getActiveEffects(guildId, userId) {
  if (!db) return [];
  
  const now = Date.now();
  
  // First, clean up expired effects
  db.run('DELETE FROM active_effects WHERE expires_at < ?', [now]);
  
  // Then get active effects
  const result = db.exec(
    'SELECT * FROM active_effects WHERE guild_id = ? AND user_id = ? AND expires_at > ? ORDER BY expires_at ASC',
    [guildId, userId, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Check if user has a specific effect type active
function hasActiveEffect(guildId, userId, effectType) {
  if (!db) return false;
  
  const now = Date.now();
  
  const result = db.exec(
    'SELECT 1 FROM active_effects WHERE guild_id = ? AND user_id = ? AND effect_type = ? AND expires_at > ?',
    [guildId, userId, effectType, now]
  );
  
  return result.length > 0 && result[0].values.length > 0;
}

// Get the value of an active effect (returns 0 if not active)
function getEffectValue(guildId, userId, effectType) {
  if (!db) return 0;
  
  const now = Date.now();
  
  const result = db.exec(
    'SELECT effect_value FROM active_effects WHERE guild_id = ? AND user_id = ? AND effect_type = ? AND expires_at > ? ORDER BY effect_value DESC LIMIT 1',
    [guildId, userId, effectType, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return 0;
  
  return result[0].values[0][0] || 0;
}

// Get total effect value (sum of all active effects of a type)
function getTotalEffectValue(guildId, userId, effectType) {
  if (!db) return 0;
  
  const now = Date.now();
  
  const result = db.exec(
    'SELECT SUM(effect_value) as total FROM active_effects WHERE guild_id = ? AND user_id = ? AND effect_type = ? AND expires_at > ?',
    [guildId, userId, effectType, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return 0;
  
  return result[0].values[0][0] || 0;
}

// Consume (delete) one active effect of a type — used for single-use coupons
function consumeEffect(guildId, userId, effectType) {
  if (!db) return false;
  
  const now = Date.now();
  
  // Get the ID of the highest-value active effect of this type
  const result = db.exec(
    'SELECT id FROM active_effects WHERE guild_id = ? AND user_id = ? AND effect_type = ? AND expires_at > ? ORDER BY effect_value DESC LIMIT 1',
    [guildId, userId, effectType, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return false;
  
  const effectId = result[0].values[0][0];
  db.run('DELETE FROM active_effects WHERE id = ?', [effectId]);
  const { saveDatabase } = require('./database');
  saveDatabase();
  return true;
}

// ===== EFFECT COOLDOWN FUNCTIONS =====

// Check if user is on cooldown for a specific effect type
function getEffectCooldown(guildId, userId, effectType) {
  if (!db) return null;
  
  const now = Date.now();
  
  const result = db.exec(
    'SELECT cooldown_expires_at FROM effect_use_cooldowns WHERE guild_id = ? AND user_id = ? AND effect_type = ? AND cooldown_expires_at > ?',
    [guildId, userId, effectType, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  return result[0].values[0][0]; // Returns the expiration timestamp
}

// Record that a user used an effect (sets cooldown)
function recordEffectUse(guildId, userId, effectType, cooldownHours) {
  if (!db || !cooldownHours || cooldownHours <= 0) return;
  
  const now = Date.now();
  const expiresAt = now + (cooldownHours * 60 * 60 * 1000);
  
  try {
    db.run(`
      INSERT OR REPLACE INTO effect_use_cooldowns 
      (guild_id, user_id, effect_type, last_used_at, cooldown_expires_at)
      VALUES (?, ?, ?, ?, ?)
    `, [guildId, userId, effectType, now, expiresAt]);
  } catch (error) {
    console.error('Error recording effect cooldown:', error);
  }
}

// Clear a user's effect cooldown (admin function)
function clearEffectCooldown(guildId, userId, effectType) {
  if (!db) return false;
  
  try {
    db.run(
      'DELETE FROM effect_use_cooldowns WHERE guild_id = ? AND user_id = ? AND effect_type = ?',
      [guildId, userId, effectType]
    );
    return true;
  } catch (error) {
    console.error('Error clearing effect cooldown:', error);
    return false;
  }
}

// Get all active cooldowns for a user
function getUserEffectCooldowns(guildId, userId) {
  if (!db) return [];
  
  const now = Date.now();
  
  const result = db.exec(
    'SELECT effect_type, cooldown_expires_at FROM effect_use_cooldowns WHERE guild_id = ? AND user_id = ? AND cooldown_expires_at > ?',
    [guildId, userId, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => ({
    effectType: row[0],
    expiresAt: row[1]
  }));
}

// ===== ITEM-SPECIFIC COOLDOWN FUNCTIONS =====

// Check if user is on cooldown for a specific item
function getItemCooldown(guildId, userId, itemId) {
  if (!db) return null;
  
  const now = Date.now();
  
  const result = db.exec(
    'SELECT cooldown_expires_at FROM item_use_cooldowns WHERE guild_id = ? AND user_id = ? AND item_id = ? AND cooldown_expires_at > ?',
    [guildId, userId, itemId, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  return result[0].values[0][0]; // Returns the expiration timestamp
}

// Record that a user used a specific item (sets cooldown)
function recordItemUse(guildId, userId, itemId, cooldownHours) {
  if (!db || !cooldownHours || cooldownHours <= 0) return;
  
  const now = Date.now();
  const expiresAt = now + (cooldownHours * 60 * 60 * 1000);
  
  try {
    db.run(`
      INSERT OR REPLACE INTO item_use_cooldowns 
      (guild_id, user_id, item_id, last_used_at, cooldown_expires_at)
      VALUES (?, ?, ?, ?, ?)
    `, [guildId, userId, itemId, now, expiresAt]);
  } catch (error) {
    console.error('Error recording item cooldown:', error);
  }
}

// Clear a user's item cooldown (admin function)
function clearItemCooldown(guildId, userId, itemId) {
  if (!db) return false;
  
  try {
    db.run(
      'DELETE FROM item_use_cooldowns WHERE guild_id = ? AND user_id = ? AND item_id = ?',
      [guildId, userId, itemId]
    );
    return true;
  } catch (error) {
    console.error('Error clearing item cooldown:', error);
    return false;
  }
}

// Get all active item cooldowns for a user
function getUserItemCooldowns(guildId, userId) {
  if (!db) return [];
  
  const now = Date.now();
  
  const result = db.exec(
    'SELECT item_id, cooldown_expires_at FROM item_use_cooldowns WHERE guild_id = ? AND user_id = ? AND cooldown_expires_at > ?',
    [guildId, userId, now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => ({
    itemId: row[0],
    expiresAt: row[1]
  }));
}

// Activate an effect (use an item)
function activateEffect(guildId, userId, item) {
  if (!db) return { success: false, error: 'Database not available' };
  
  if (!item.effect_type) {
    return { success: false, error: 'This item has no effect to activate' };
  }
  
  // Check if user already has this effect active (if max_stack is 1)
  if (item.max_stack === 1 && hasActiveEffect(guildId, userId, item.effect_type)) {
    return { success: false, error: 'You already have this effect active!' };
  }
  
  const now = Date.now();
  const durationMs = (item.duration_hours || 24) * 60 * 60 * 1000;
  const expiresAt = now + durationMs;
  
  try {
    db.run(`
      INSERT INTO active_effects 
      (guild_id, user_id, effect_type, effect_value, source_item_id, source_item_name, activated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      guildId,
      userId,
      item.effect_type,
      item.effect_value || 0,
      item.id || item.item_id,
      item.name,
      now,
      expiresAt
    ]);
    
    return { 
      success: true, 
      effect: {
        type: item.effect_type,
        value: item.effect_value,
        expiresAt,
        durationHours: item.duration_hours
      }
    };
  } catch (error) {
    console.error('Error activating effect:', error);
    return { success: false, error: 'Failed to activate effect' };
  }
}

// Use an item from inventory
function useItem(guildId, userId, itemId) {
  if (!db) return { success: false, error: 'Database not available' };
  
  // Get the inventory item
  const inventoryItem = getInventoryItem(guildId, userId, itemId);
  if (!inventoryItem) {
    return { success: false, error: "You don't have this item!" };
  }
  
  // Get the full item details
  const item = getShopItem(guildId, itemId);
  if (!item) {
    return { success: false, error: 'Item not found in shop!' };
  }
  
  // Check if item is usable (separate from enabled/for sale)
  if (item.usable === 0) {
    return { success: false, error: 'This item has been disabled and cannot be used right now.' };
  }
  
  // Check item-specific cooldown (if item has a use_cooldown_hours)
  if (item.use_cooldown_hours > 0) {
    const itemCooldownExpires = getItemCooldown(guildId, userId, item.id);
    if (itemCooldownExpires) {
      const timeLeft = itemCooldownExpires - Date.now();
      const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
      const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minsLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      
      let timeString = '';
      if (daysLeft > 0) timeString += `${daysLeft}d `;
      if (hoursLeft > 0 || daysLeft > 0) timeString += `${hoursLeft}h `;
      timeString += `${minsLeft}m`;
      
      return { 
        success: false, 
        error: `You recently used **${item.name}**! Cooldown expires in **${timeString.trim()}**.`,
        cooldown: true,
        cooldownExpires: itemCooldownExpires
      };
    }
  }
  
  // Try to activate the effect
  const activateResult = activateEffect(guildId, userId, { ...item, ...inventoryItem });
  if (!activateResult.success) {
    return activateResult;
  }
  
  // Record the item-specific cooldown (if applicable)
  if (item.use_cooldown_hours > 0) {
    recordItemUse(guildId, userId, item.id, item.use_cooldown_hours);
  }
  
  // Remove item from inventory
  removeFromInventory(guildId, userId, itemId, 1);
  
  return {
    success: true,
    item: item,
    effect: activateResult.effect
  };
}

// ===== PURCHASE FUNCTIONS =====

// Record a purchase
function recordPurchase(guildId, userId, item, quantity, pricePaid) {
  if (!db) return;
  
  db.run(`
    INSERT INTO item_purchase_history (guild_id, user_id, item_id, item_name, price_paid, quantity, purchased_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guildId, userId, item.id, item.name, pricePaid, quantity, Date.now()]);
}

// Get purchase history for a user
function getPurchaseHistory(guildId, userId, limit = 20) {
  if (!db) return [];
  
  const result = db.exec(
    'SELECT * FROM item_purchase_history WHERE guild_id = ? AND user_id = ? ORDER BY purchased_at DESC LIMIT ?',
    [guildId, userId, limit]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get shop statistics
function getShopStats(guildId) {
  if (!db) return { totalItems: 0, totalSales: 0, totalRevenue: 0 };
  
  const itemsResult = db.exec('SELECT COUNT(*) FROM shop_items WHERE guild_id = ?', [guildId]);
  const salesResult = db.exec(
    'SELECT COUNT(*) as sales, SUM(price_paid) as revenue FROM item_purchase_history WHERE guild_id = ?',
    [guildId]
  );
  
  return {
    totalItems: itemsResult.length > 0 ? itemsResult[0].values[0][0] : 0,
    totalSales: salesResult.length > 0 ? salesResult[0].values[0][0] : 0,
    totalRevenue: salesResult.length > 0 ? (salesResult[0].values[0][1] || 0) : 0
  };
}

// Format duration for display
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// Get effect type display name
function getEffectTypeName(effectType) {
  const names = {
    [EFFECT_TYPES.ROB_PROTECTION]: 'Rob Protection',
    [EFFECT_TYPES.HACK_PROTECTION]: 'Hack Protection',
    [EFFECT_TYPES.ROB_DEFENSE]: 'Rob Defense',
    [EFFECT_TYPES.HACK_DEFENSE]: 'Hack Defense',
    [EFFECT_TYPES.ROB_SUCCESS_BOOST]: 'Rob Success Boost',
    [EFFECT_TYPES.HACK_SUCCESS_BOOST]: 'Hack Success Boost',
    [EFFECT_TYPES.WORK_BOOST]: 'Work Earnings Boost',
    [EFFECT_TYPES.CRIME_BOOST]: 'Crime Earnings Boost',
    [EFFECT_TYPES.SLUT_BOOST]: 'Slut Earnings Boost',
    [EFFECT_TYPES.XP_BOOST]: 'XP Boost',
    [EFFECT_TYPES.ROB_FINE_REDUCTION]: 'Rob Fine Reduction',
    [EFFECT_TYPES.HACK_FINE_REDUCTION]: 'Hack Fine Reduction',
    [EFFECT_TYPES.CRIME_FINE_REDUCTION]: 'Crime Fine Reduction',
    [EFFECT_TYPES.LOTTERY_BOOST]: 'Lottery Boost',
    [EFFECT_TYPES.LOTTERY_FREE_TICKET]: '🎟️ Free Lottery Ticket',
    [EFFECT_TYPES.BANK_INTEREST_BOOST]: 'Bank Interest Boost',
    [EFFECT_TYPES.COOLDOWN_REDUCTION]: 'Cooldown Reduction',
    [EFFECT_TYPES.EARNINGS_PENALTY]: 'Earnings Penalty',
    [EFFECT_TYPES.ROBBERY_VULNERABILITY]: 'Robbery Vulnerability',
    // Access keys
    [EFFECT_TYPES.DUNGEON_KEY]: '🗝️ Dungeon Key',
    // Role grant
    [EFFECT_TYPES.ROLE_GRANT]: '🏷️ Role Grant',
    // VIP gambling room
    [EFFECT_TYPES.GAMBLING_ROOM]: '🎰 VIP Gambling Room',
    [EFFECT_TYPES.GAMBLING_ROOM_INVITE]: '🎟️ VIP Room Guest Pass',
    // Service/Cosmetic types
    [EFFECT_TYPES.SERVICE_CUSTOM_EMOJI]: '🎨 Custom Emoji (Service)',
    [EFFECT_TYPES.SERVICE_NICKNAME]: '📝 Nickname Change (Service)',
    [EFFECT_TYPES.SERVICE_CUSTOM_ROLE]: '🏷️ Custom Role (Service)',
    [EFFECT_TYPES.SERVICE_CUSTOM_COLOR]: '🌈 Custom Color (Service)',
    [EFFECT_TYPES.SERVICE_OTHER]: '✨ Special Service',
    [EFFECT_TYPES.COSMETIC]: '🏆 Cosmetic (Collectible)'
  };
  return names[effectType] || effectType;
}

// Check if an effect type is a service item (requires admin fulfillment)
function isServiceItem(effectType) {
  return effectType && effectType.startsWith('service_');
}

// Check if an effect type is cosmetic (no gameplay effect)
function isCosmeticItem(effectType) {
  return effectType === EFFECT_TYPES.COSMETIC || isServiceItem(effectType);
}

// Check if an effect type is a role grant item
function isRoleGrantItem(effectType) {
  return effectType === EFFECT_TYPES.ROLE_GRANT;
}

// ==================== ROLE GRANT FUNCTIONS ====================

// Record a temporary role grant in the database
function recordRoleGrant(guildId, userId, roleId, itemId, itemName, durationHours) {
  if (!db) return null;
  
  const now = Date.now();
  const isPermanent = !durationHours || durationHours <= 0;
  const expiresAt = isPermanent ? null : now + (durationHours * 60 * 60 * 1000);
  
  try {
    db.run(`
      INSERT OR REPLACE INTO temporary_role_grants 
      (guild_id, user_id, role_id, source_item_id, source_item_name, granted_at, expires_at, is_permanent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [guildId, userId, roleId, itemId, itemName, now, expiresAt, isPermanent ? 1 : 0]);
    
    return { success: true, isPermanent, expiresAt };
  } catch (error) {
    console.error('Error recording role grant:', error);
    return null;
  }
}

// Get all expired role grants that need to be removed
function getExpiredRoleGrants() {
  if (!db) return [];
  
  const now = Date.now();
  const result = db.exec(
    'SELECT * FROM temporary_role_grants WHERE is_permanent = 0 AND expires_at <= ?',
    [now]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Remove an expired role grant record from the database
function removeRoleGrantRecord(guildId, userId, roleId) {
  if (!db) return;
  
  db.run(
    'DELETE FROM temporary_role_grants WHERE guild_id = ? AND user_id = ? AND role_id = ?',
    [guildId, userId, roleId]
  );
}

// Get all active role grants for a user
function getUserRoleGrants(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(
    'SELECT * FROM temporary_role_grants WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Check if user already has a specific role grant from the shop
function hasRoleGrant(guildId, userId, roleId) {
  if (!db) return false;
  
  const result = db.exec(
    'SELECT COUNT(*) FROM temporary_role_grants WHERE guild_id = ? AND user_id = ? AND role_id = ?',
    [guildId, userId, roleId]
  );
  
  return result.length > 0 && result[0].values[0][0] > 0;
}

// Manually add a role grant record (for fixing orphaned grants)
function addManualRoleGrant(guildId, userId, roleId, itemName, durationHours) {
  if (!db) return null;
  
  const now = Date.now();
  const isPermanent = !durationHours || durationHours <= 0;
  const expiresAt = isPermanent ? null : now + (durationHours * 60 * 60 * 1000);
  
  try {
    db.run(`
      INSERT OR REPLACE INTO temporary_role_grants 
      (guild_id, user_id, role_id, source_item_id, source_item_name, granted_at, expires_at, is_permanent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [guildId, userId, roleId, 0, itemName || 'Manual Grant', now, expiresAt, isPermanent ? 1 : 0]);
    
    return { success: true, isPermanent, expiresAt };
  } catch (error) {
    console.error('Error adding manual role grant:', error);
    return null;
  }
}

// Get all temporary (non-permanent) role grants for cleanup scheduling
function getAllTemporaryRoleGrants() {
  if (!db) return [];
  
  const result = db.exec(
    'SELECT * FROM temporary_role_grants WHERE is_permanent = 0'
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// ==================== FULFILLMENT REQUEST FUNCTIONS ====================

// Create a fulfillment request when user uses a service item (creates ticket)
function createFulfillmentRequest(guildId, userId, itemId, itemName, effectType, userNotes = null, ticketChannelId = null) {
  if (!db) return null;
  
  const now = Date.now();
  db.run(
    `INSERT INTO item_fulfillment_requests 
     (guild_id, user_id, item_id, item_name, effect_type, user_notes, status, created_at, ticket_channel_id) 
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [guildId, userId, itemId, itemName, effectType, userNotes, now, ticketChannelId]
  );
  
  // Get the inserted request ID
  const result = db.exec('SELECT last_insert_rowid()');
  return result.length > 0 ? result[0].values[0][0] : null;
}

// Get fulfillment request by ticket channel ID
function getFulfillmentByTicket(ticketChannelId) {
  if (!db) return null;
  
  const result = db.exec(
    'SELECT * FROM item_fulfillment_requests WHERE ticket_channel_id = ? AND status = ?',
    [ticketChannelId, 'pending']
  );
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
}

// Update ticket channel ID for a fulfillment request
function updateFulfillmentTicket(requestId, ticketChannelId) {
  if (!db) return false;
  
  db.run(
    'UPDATE item_fulfillment_requests SET ticket_channel_id = ? WHERE id = ?',
    [ticketChannelId, requestId]
  );
  return true;
}

// Get all pending fulfillment requests for a guild
function getPendingFulfillments(guildId) {
  if (!db) return [];
  
  const result = db.exec(
    `SELECT * FROM item_fulfillment_requests 
     WHERE guild_id = ? AND status = 'pending' 
     ORDER BY created_at ASC`,
    [guildId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get fulfillment requests for a specific user
function getUserFulfillments(guildId, userId, includeCompleted = false) {
  if (!db) return [];
  
  const query = includeCompleted
    ? `SELECT * FROM item_fulfillment_requests WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM item_fulfillment_requests WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at ASC`;
  
  const result = db.exec(query, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get a specific fulfillment request by ID
function getFulfillmentRequest(requestId) {
  if (!db) return null;
  
  const result = db.exec('SELECT * FROM item_fulfillment_requests WHERE id = ?', [requestId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
}

// Mark a fulfillment request as completed
function completeFulfillment(requestId, adminId, adminNotes = null) {
  if (!db) return false;
  
  const now = Date.now();
  db.run(
    `UPDATE item_fulfillment_requests 
     SET status = 'completed', fulfilled_by = ?, admin_notes = ?, fulfilled_at = ? 
     WHERE id = ?`,
    [adminId, adminNotes, now, requestId]
  );
  
  return true;
}

// Cancel/reject a fulfillment request (refund should be handled separately)
function cancelFulfillment(requestId, adminId, reason = null) {
  if (!db) return false;
  
  const now = Date.now();
  db.run(
    `UPDATE item_fulfillment_requests 
     SET status = 'cancelled', fulfilled_by = ?, admin_notes = ?, fulfilled_at = ? 
     WHERE id = ?`,
    [adminId, reason, now, requestId]
  );
  
  return true;
}

// Get count of pending fulfillments for a guild
function getPendingFulfillmentCount(guildId) {
  if (!db) return 0;
  
  const result = db.exec(
    `SELECT COUNT(*) FROM item_fulfillment_requests WHERE guild_id = ? AND status = 'pending'`,
    [guildId]
  );
  
  return result.length > 0 ? result[0].values[0][0] : 0;
}

// ===== VIP GAMBLING ROOMS =====

// In-memory set of channel IDs that are currently VIP rooms (fast sync lookup
// from bot.js command dispatch — populated on boot via loadVipRoomChannelCache()
// and kept up-to-date by record/delete helpers below).
const vipRoomChannelIds = new Set();

function loadVipRoomChannelCache() {
  if (!db) return;
  vipRoomChannelIds.clear();
  const result = db.exec('SELECT channel_id FROM gambling_rooms');
  if (result.length > 0) {
    for (const row of result[0].values) {
      vipRoomChannelIds.add(row[0]);
    }
  }
}

function isVipRoomChannel(channelId) {
  return vipRoomChannelIds.has(channelId);
}

function recordGamblingRoom(channelId, guildId, userId, durationHours) {
  if (!db) return null;
  const now = Date.now();
  const expiresAt = now + (durationHours * 60 * 60 * 1000);
  db.run(
    `INSERT INTO gambling_rooms (channel_id, guild_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [channelId, guildId, userId, now, expiresAt]
  );
  vipRoomChannelIds.add(channelId);
  return { channelId, guildId, userId, createdAt: now, expiresAt };
}

function getActiveRoomForUser(guildId, userId) {
  if (!db) return null;
  const result = db.exec(
    `SELECT channel_id, guild_id, user_id, created_at, expires_at FROM gambling_rooms WHERE guild_id = ? AND user_id = ? LIMIT 1`,
    [guildId, userId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const v = result[0].values[0];
  return { channelId: v[0], guildId: v[1], userId: v[2], createdAt: v[3], expiresAt: v[4] };
}

function getRoomByChannelId(channelId) {
  if (!db) return null;
  const result = db.exec(
    `SELECT channel_id, guild_id, user_id, created_at, expires_at FROM gambling_rooms WHERE channel_id = ? LIMIT 1`,
    [channelId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const v = result[0].values[0];
  return { channelId: v[0], guildId: v[1], userId: v[2], createdAt: v[3], expiresAt: v[4] };
}

function getExpiredRooms(now = Date.now()) {
  if (!db) return [];
  const result = db.exec(
    `SELECT channel_id, guild_id, user_id, created_at, expires_at FROM gambling_rooms WHERE expires_at <= ?`,
    [now]
  );
  if (result.length === 0) return [];
  return result[0].values.map(v => ({
    channelId: v[0], guildId: v[1], userId: v[2], createdAt: v[3], expiresAt: v[4]
  }));
}

function deleteRoomRecord(channelId) {
  if (!db) return;
  db.run(`DELETE FROM gambling_room_guests WHERE channel_id = ?`, [channelId]);
  db.run(`DELETE FROM gambling_rooms WHERE channel_id = ?`, [channelId]);
  vipRoomChannelIds.delete(channelId);
}

function addRoomGuest(channelId, guildId, userId) {
  if (!db) return false;
  try {
    db.run(
      `INSERT OR IGNORE INTO gambling_room_guests (channel_id, guild_id, user_id, invited_at) VALUES (?, ?, ?, ?)`,
      [channelId, guildId, userId, Date.now()]
    );
    return true;
  } catch (e) {
    return false;
  }
}

function removeRoomGuest(channelId, userId) {
  if (!db) return;
  db.run(`DELETE FROM gambling_room_guests WHERE channel_id = ? AND user_id = ?`, [channelId, userId]);
}

function getRoomGuests(channelId) {
  if (!db) return [];
  const result = db.exec(
    `SELECT user_id, invited_at FROM gambling_room_guests WHERE channel_id = ? ORDER BY invited_at ASC`,
    [channelId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(v => ({ userId: v[0], invitedAt: v[1] }));
}

function isRoomGuest(channelId, userId) {
  if (!db) return false;
  const result = db.exec(
    `SELECT 1 FROM gambling_room_guests WHERE channel_id = ? AND user_id = ? LIMIT 1`,
    [channelId, userId]
  );
  return result.length > 0 && result[0].values.length > 0;
}

module.exports = {
  initItems,
  EFFECT_TYPES,
  ITEM_CATEGORIES,
  
  // Settings
  getItemSettings,
  updateItemSettings,
  
  // Item management
  getShopItems,
  getShopItem,
  getShopItemByName,
  getHuntEligibleItems,
  addShopItem,
  updateShopItem,
  deleteShopItem,
  initializeDefaultItems,
  
  // Inventory
  getUserInventory,
  getInventoryItem,
  getInventoryItemByEffect,
  getAllInventoryItemsByEffect,
  getItemOwners,
  addToInventory,
  removeFromInventory,
  
  // Effects
  getActiveEffects,
  hasActiveEffect,
  getEffectValue,
  getTotalEffectValue,
  consumeEffect,
  activateEffect,
  useItem,
  
  // Effect Cooldowns (legacy - still available but item-specific preferred)
  getEffectCooldown,
  recordEffectUse,
  clearEffectCooldown,
  getUserEffectCooldowns,
  
  // Item-Specific Cooldowns
  getItemCooldown,
  recordItemUse,
  clearItemCooldown,
  getUserItemCooldowns,
  
  // Purchases
  recordPurchase,
  getPurchaseHistory,
  getShopStats,
  
  // Fulfillment (for service/cosmetic items)
  isServiceItem,
  isCosmeticItem,
  createFulfillmentRequest,
  getPendingFulfillments,
  getUserFulfillments,
  getFulfillmentRequest,
  getFulfillmentByTicket,
  updateFulfillmentTicket,
  completeFulfillment,
  cancelFulfillment,
  getPendingFulfillmentCount,
  
  // Role grants
  isRoleGrantItem,
  recordRoleGrant,
  getExpiredRoleGrants,
  removeRoleGrantRecord,
  getUserRoleGrants,
  hasRoleGrant,
  addManualRoleGrant,
  getAllTemporaryRoleGrants,
  
  // VIP Gambling Rooms
  isVipRoomChannel,
  loadVipRoomChannelCache,
  recordGamblingRoom,
  getActiveRoomForUser,
  getRoomByChannelId,
  getExpiredRooms,
  deleteRoomRecord,
  addRoomGuest,
  removeRoomGuest,
  getRoomGuests,
  isRoomGuest,
  
  // Helpers
  formatDuration,
  getEffectTypeName,
  
  // Constants
  EFFECT_TYPES,
  EFFECT_TYPE_NAMES
};
