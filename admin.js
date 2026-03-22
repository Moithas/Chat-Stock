// Admin role and logging system

let db = null;
let discordClient = null;

// In-memory cache
const guildAdminSettings = new Map();

function initAdmin(database, client) {
  db = database;
  discordClient = client;
  
  // Create admin settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      guild_id TEXT PRIMARY KEY,
      admin_role_id TEXT,
      log_channel_id TEXT,
      currency_symbol TEXT
    );
  `);

  // Migration: add currency_symbol column if missing
  try { db.run(`ALTER TABLE admin_settings ADD COLUMN currency_symbol TEXT`); } catch (e) { /* already exists */ }
  
  // Migration: add starting_balance and new_player_immunity_days columns
  try { db.run(`ALTER TABLE admin_settings ADD COLUMN starting_balance INTEGER DEFAULT 0`); } catch (e) { /* already exists */ }
  try { db.run(`ALTER TABLE admin_settings ADD COLUMN new_player_immunity_days INTEGER DEFAULT 7`); } catch (e) { /* already exists */ }
  try { db.run(`ALTER TABLE admin_settings ADD COLUMN support_server_url TEXT`); } catch (e) { /* already exists */ }
  
  // Create admin log table
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      timestamp INTEGER NOT NULL
    );
  `);
  
  console.log('👑 Admin system initialized');
}

function getAdminSettings(guildId) {
  // Check cache first
  if (guildAdminSettings.has(guildId)) {
    return guildAdminSettings.get(guildId);
  }
  
  // Load from database
  if (db) {
    const result = db.exec('SELECT * FROM admin_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const settings = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const parsed = {
        adminRoleId: settings.admin_role_id,
        logChannelId: settings.log_channel_id,
        currencySymbol: settings.currency_symbol || null,
        startingBalance: settings.starting_balance ?? 0,
        newPlayerImmunityDays: settings.new_player_immunity_days ?? 7,
        supportServerUrl: settings.support_server_url || null
      };
      
      guildAdminSettings.set(guildId, parsed);
      return parsed;
    }
  }
  
  // Return defaults if no settings found
  return { adminRoleId: null, logChannelId: null, currencySymbol: null, startingBalance: 0, newPlayerImmunityDays: 7, supportServerUrl: null };
}

function saveAdminSettings(guildId, settings) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO admin_settings 
    (guild_id, admin_role_id, log_channel_id, currency_symbol, starting_balance, new_player_immunity_days, support_server_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.adminRoleId,
    settings.logChannelId,
    settings.currencySymbol,
    settings.startingBalance ?? 0,
    settings.newPlayerImmunityDays ?? 7,
    settings.supportServerUrl || null
  ]);
  
  // Update cache
  guildAdminSettings.set(guildId, settings);
}

function setAdminRole(guildId, roleId) {
  const settings = getAdminSettings(guildId);
  // Ensure role ID is stored as string for consistent comparison
  settings.adminRoleId = roleId ? String(roleId) : null;
  saveAdminSettings(guildId, settings);
}

function setLogChannel(guildId, channelId) {
  const settings = getAdminSettings(guildId);
  settings.logChannelId = channelId;
  saveAdminSettings(guildId, settings);
}

const DEFAULT_CURRENCY = '🪙';

function getCurrency(guildId) {
  const settings = getAdminSettings(guildId);
  return settings.currencySymbol || DEFAULT_CURRENCY;
}

function setCurrency(guildId, symbol) {
  const settings = getAdminSettings(guildId);
  settings.currencySymbol = symbol || null;
  saveAdminSettings(guildId, settings);
}

const DEFAULT_SUPPORT_URL = 'https://discord.gg/3PnT5BknaP';

function getSupportServerUrl(guildId) {
  const settings = getAdminSettings(guildId);
  return settings.supportServerUrl || DEFAULT_SUPPORT_URL;
}

function setSupportServerUrl(guildId, url) {
  const settings = getAdminSettings(guildId);
  settings.supportServerUrl = url || null;
  saveAdminSettings(guildId, settings);
}

// Check if user has admin permission (Server Admin OR Stock Admin role)
function hasAdminPermission(member, guildId) {
  // Server administrators always have permission
  if (member.permissions.has('Administrator')) {
    console.log(`[Admin Check] User ${member.user?.username} has Administrator permission`);
    return true;
  }
  
  // Check for Stock Admin role
  const settings = getAdminSettings(guildId);
  const adminRoleId = settings.adminRoleId ? String(settings.adminRoleId) : null;
  console.log(`[Admin Check] User ${member.user?.username} checking for role ${adminRoleId}`);
  console.log(`[Admin Check] User roles:`, [...member.roles.cache.keys()]);
  if (adminRoleId && member.roles.cache.has(adminRoleId)) {
    console.log(`[Admin Check] User ${member.user?.username} has admin role`);
    return true;
  }
  
  console.log(`[Admin Check] User ${member.user?.username} DENIED - no admin permission`);
  return false;
}

// Log an admin action (database only)
function logAdminAction(guildId, userId, username, action, details = null) {
  const timestamp = Date.now();
  
  // Save to database
  if (db) {
    db.run(`
      INSERT INTO admin_logs (guild_id, user_id, username, action, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [guildId, visibleUserId(userId), username, action, details, timestamp]);
    
    // Keep only the last 50 entries per guild
    db.run(`
      DELETE FROM admin_logs 
      WHERE guild_id = ? AND id NOT IN (
        SELECT id FROM admin_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT 50
      )
    `, [guildId, guildId]);
  }
}

// Get recent admin logs
function getAdminLogs(guildId, limit = 20) {
  if (!db) return [];
  
  const result = db.exec(
    'SELECT * FROM admin_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?',
    [guildId, limit]
  );
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Helper to show user ID safely
function visibleUserId(userId) {
  return userId;
}

// Get the admin role ID for a guild
function getAdminRole(guildId) {
  const settings = getAdminSettings(guildId);
  // Ensure we return a string for consistent comparison
  return settings.adminRoleId ? String(settings.adminRoleId) : null;
}

// Convenience function to check if a user is an admin
function isAdmin(guildId, userId, member) {
  if (!member) return false;
  return hasAdminPermission(member, guildId);
}

module.exports = {
  initAdmin,
  getAdminSettings,
  saveAdminSettings,
  getAdminRole,
  setAdminRole,
  setLogChannel,
  hasAdminPermission,
  isAdmin,
  logAdminAction,
  getAdminLogs,
  getCurrency,
  setCurrency,
  getSupportServerUrl,
  setSupportServerUrl
};
