// Anti-spam system for stock inflation prevention

// In-memory cooldown tracker
const userCooldowns = new Map();

// In-memory settings cache
const guildSpamSettings = new Map();

// Default anti-spam settings
const DEFAULT_SETTINGS = {
  cooldownSeconds: 30,      // Seconds between messages that count
  minMessageLength: 5,      // Minimum characters for message to count
  enabled: true
};

let db = null;

function initAntiSpam(database) {
  db = database;
  
  // Create settings table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS spam_settings (
      guild_id TEXT PRIMARY KEY,
      cooldown_seconds INTEGER DEFAULT 30,
      min_message_length INTEGER DEFAULT 5,
      enabled INTEGER DEFAULT 1
    );
  `);
  
  console.log('🛡️ Anti-spam system initialized');
}

function getSpamSettings(guildId) {
  // Check cache first
  if (guildSpamSettings.has(guildId)) {
    return guildSpamSettings.get(guildId);
  }
  
  // Load from database
  if (db) {
    const result = db.exec('SELECT * FROM spam_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const settings = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const parsed = {
        cooldownSeconds: settings.cooldown_seconds,
        minMessageLength: settings.min_message_length,
        enabled: settings.enabled === 1
      };
      
      guildSpamSettings.set(guildId, parsed);
      return parsed;
    }
  }
  
  // Return defaults if no settings found
  return { ...DEFAULT_SETTINGS };
}

function saveSpamSettings(guildId, settings) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO spam_settings 
    (guild_id, cooldown_seconds, min_message_length, enabled)
    VALUES (?, ?, ?, ?)
  `, [
    guildId,
    settings.cooldownSeconds,
    settings.minMessageLength,
    settings.enabled ? 1 : 0
  ]);
  
  // Update cache
  guildSpamSettings.set(guildId, settings);
}

function shouldCountMessage(guildId, userId, messageContent) {
  const settings = getSpamSettings(guildId);
  
  // If anti-spam is disabled, always count
  if (!settings.enabled) {
    return { shouldCount: true, reason: null };
  }
  
  // Check minimum message length
  const trimmedContent = messageContent.trim();
  if (trimmedContent.length < settings.minMessageLength) {
    return { 
      shouldCount: false, 
      reason: `Message too short (min ${settings.minMessageLength} chars)` 
    };
  }
  
  // Check cooldown
  const now = Date.now();
  const userKey = `${guildId}-${userId}`;
  const lastMessageTime = userCooldowns.get(userKey);
  
  if (lastMessageTime) {
    const timeSinceLastMessage = (now - lastMessageTime) / 1000;
    
    if (timeSinceLastMessage < settings.cooldownSeconds) {
      return { 
        shouldCount: false, 
        reason: `Cooldown active (${Math.ceil(settings.cooldownSeconds - timeSinceLastMessage)}s remaining)` 
      };
    }
  }
  
  // Message counts - update cooldown
  userCooldowns.set(userKey, now);
  return { shouldCount: true, reason: null };
}

function updateCooldown(guildId, seconds) {
  const settings = getSpamSettings(guildId);
  settings.cooldownSeconds = seconds;
  saveSpamSettings(guildId, settings);
}

function updateMinLength(guildId, length) {
  const settings = getSpamSettings(guildId);
  settings.minMessageLength = length;
  saveSpamSettings(guildId, settings);
}

function setAntiSpamEnabled(guildId, enabled) {
  const settings = getSpamSettings(guildId);
  settings.enabled = enabled;
  saveSpamSettings(guildId, settings);
}

// Clean up old cooldowns periodically (memory management)
setInterval(() => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  for (const [key, timestamp] of userCooldowns.entries()) {
    if (now - timestamp > maxAge) {
      userCooldowns.delete(key);
    }
  }
}, 60 * 1000); // Clean every minute

module.exports = {
  initAntiSpam,
  getSpamSettings,
  shouldCountMessage,
  updateCooldown,
  updateMinLength,
  setAntiSpamEnabled
};
