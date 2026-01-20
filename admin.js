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
      log_channel_id TEXT
    );
  `);
  
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
        logChannelId: settings.log_channel_id
      };
      
      guildAdminSettings.set(guildId, parsed);
      return parsed;
    }
  }
  
  // Return defaults if no settings found
  return { adminRoleId: null, logChannelId: null };
}

function saveAdminSettings(guildId, settings) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO admin_settings 
    (guild_id, admin_role_id, log_channel_id)
    VALUES (?, ?, ?)
  `, [
    guildId,
    settings.adminRoleId,
    settings.logChannelId
  ]);
  
  // Update cache
  guildAdminSettings.set(guildId, settings);
}

function setAdminRole(guildId, roleId) {
  const settings = getAdminSettings(guildId);
  settings.adminRoleId = roleId;
  saveAdminSettings(guildId, settings);
}

function setLogChannel(guildId, channelId) {
  const settings = getAdminSettings(guildId);
  settings.logChannelId = channelId;
  saveAdminSettings(guildId, settings);
}

// Check if user has admin permission (Server Admin OR Stock Admin role)
function hasAdminPermission(member, guildId) {
  // Server administrators always have permission
  if (member.permissions.has('Administrator')) {
    return true;
  }
  
  // Check for Stock Admin role
  const settings = getAdminSettings(guildId);
  if (settings.adminRoleId && member.roles.cache.has(settings.adminRoleId)) {
    return true;
  }
  
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
  return settings.adminRoleId || null;
}

// Convenience function to check if a user is an admin
function isAdmin(guildId, userId, member) {
  if (!member) return false;
  return hasAdminPermission(member, guildId);
}

module.exports = {
  initAdmin,
  getAdminSettings,
  getAdminRole,
  setAdminRole,
  hasAdminPermission,
  isAdmin,
  logAdminAction,
  getAdminLogs
};
