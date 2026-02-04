// Cooldown Tracker Dashboard
// Shows who is on cooldown for rob and hack

const { EmbedBuilder } = require('discord.js');
const { getHackBonuses, getRobBonuses } = require('./skills');

let db = null;
let discordClient = null;

// Dashboard state
let trackerChannelId = null;
let trackerMessageId = null;
let trackerIntervalId = null;
let trackerSettings = {
  enabled: false,
  updateIntervalSeconds: 30,
  showRobCooldowns: true,
  showHackCooldowns: true,
  showTargetCooldowns: true
};

// Guild settings cache
const guildTrackerSettings = new Map();

function initCooldownTracker(database, client) {
  db = database;
  discordClient = client;
  
  // Create settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS cooldown_tracker_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      channel_id TEXT,
      message_id TEXT,
      update_interval_seconds INTEGER DEFAULT 30,
      show_rob_cooldowns INTEGER DEFAULT 1,
      show_hack_cooldowns INTEGER DEFAULT 1,
      show_target_cooldowns INTEGER DEFAULT 1
    )
  `);
  
  console.log('⏱️ Witness Protection initialized');
}

// Get tracker settings for a guild
function getTrackerSettings(guildId) {
  if (guildTrackerSettings.has(guildId)) {
    return guildTrackerSettings.get(guildId);
  }
  
  if (!db) return { ...trackerSettings, channelId: null, messageId: null };
  
  const result = db.exec('SELECT * FROM cooldown_tracker_settings WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
    
    const settings = {
      enabled: row.enabled === 1,
      channelId: row.channel_id,
      messageId: row.message_id,
      updateIntervalSeconds: row.update_interval_seconds || 30,
      showRobCooldowns: row.show_rob_cooldowns === 1,
      showHackCooldowns: row.show_hack_cooldowns === 1,
      showTargetCooldowns: row.show_target_cooldowns === 1
    };
    
    guildTrackerSettings.set(guildId, settings);
    return settings;
  }
  
  return { ...trackerSettings, channelId: null, messageId: null };
}

// Save tracker settings for a guild (merge with existing, handle both camelCase and snake_case)
function saveTrackerSettings(guildId, newSettings) {
  if (!db) return;
  
  // Get current settings
  const current = getTrackerSettings(guildId);
  
  // Merge settings, handling both naming conventions
  const settings = {
    enabled: newSettings.enabled !== undefined ? newSettings.enabled : current.enabled,
    channelId: newSettings.channelId || newSettings.channel_id || current.channelId,
    messageId: newSettings.messageId || newSettings.message_id || current.messageId,
    updateIntervalSeconds: newSettings.updateIntervalSeconds || newSettings.update_interval_seconds || current.updateIntervalSeconds || 30,
    showRobCooldowns: newSettings.showRobCooldowns !== undefined ? newSettings.showRobCooldowns : current.showRobCooldowns,
    showHackCooldowns: newSettings.showHackCooldowns !== undefined ? newSettings.showHackCooldowns : current.showHackCooldowns,
    showTargetCooldowns: newSettings.showTargetCooldowns !== undefined ? newSettings.showTargetCooldowns : current.showTargetCooldowns
  };
  
  db.run(`
    INSERT OR REPLACE INTO cooldown_tracker_settings 
    (guild_id, enabled, channel_id, message_id, update_interval_seconds, show_rob_cooldowns, show_hack_cooldowns, show_target_cooldowns)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.channelId || null,
    settings.messageId || null,
    settings.updateIntervalSeconds || 30,
    settings.showRobCooldowns !== false ? 1 : 0,
    settings.showHackCooldowns !== false ? 1 : 0,
    settings.showTargetCooldowns !== false ? 1 : 0
  ]);
  
  guildTrackerSettings.set(guildId, settings);
}

// Update tracker settings
function updateTrackerSettings(guildId, newSettings) {
  const current = getTrackerSettings(guildId);
  const updated = { ...current, ...newSettings };
  saveTrackerSettings(guildId, updated);
  return updated;
}

// Get rob settings for cooldown calculation
function getRobSettings(guildId) {
  if (!db) return { cooldownMinutes: 10, targetCooldownSeconds: 300 };
  
  const result = db.exec('SELECT cooldown_minutes, target_cooldown_seconds FROM rob_settings WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    return {
      cooldownMinutes: result[0].values[0][0] || 10,
      targetCooldownSeconds: result[0].values[0][1] || 300
    };
  }
  
  return { cooldownMinutes: 10, targetCooldownSeconds: 300 };
}

// Get hack settings for cooldown calculation
function getHackSettings(guildId) {
  if (!db) return { cooldownMinutes: 60, targetCooldownMinutes: 720 };
  
  const result = db.exec('SELECT hacker_cooldown_minutes, target_cooldown_minutes FROM hack_settings WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    return {
      cooldownMinutes: result[0].values[0][0] || 60,
      targetCooldownMinutes: result[0].values[0][1] || 720
    };
  }
  
  return { cooldownMinutes: 60, targetCooldownMinutes: 720 };
}

// Get all active rob cooldowns
function getActiveRobCooldowns(guildId) {
  if (!db) return { robbers: [], targets: [] };
  
  const robSettings = getRobSettings(guildId);
  const now = Date.now();
  
  // Base robber cooldown
  const baseRobberCooldownMs = robSettings.cooldownMinutes * 60 * 1000;
  // Query with base cooldown to catch all potentially active cooldowns
  const robberCutoff = now - baseRobberCooldownMs;
  
  const robbersResult = db.exec(
    'SELECT user_id, last_rob_time FROM rob_tracker WHERE guild_id = ? AND last_rob_time > ?',
    [guildId, robberCutoff]
  );
  
  const robbers = [];
  if (robbersResult.length > 0 && robbersResult[0].values.length > 0) {
    for (const row of robbersResult[0].values) {
      const userId = row[0];
      const lastRobTime = row[1];
      
      // Get user's skill-based cooldown reduction
      const robBonuses = getRobBonuses(guildId, userId);
      const reducedCooldownMs = baseRobberCooldownMs * (1 - robBonuses.cooldownReduction / 100);
      const expiresAt = lastRobTime + reducedCooldownMs;
      
      // Only include if still on cooldown with reduced time
      if (expiresAt > now) {
        robbers.push({ userId, expiresAt, type: 'robber' });
      }
    }
  }
  
  // Target cooldowns
  const targetCooldownMs = robSettings.targetCooldownSeconds * 1000;
  const targetCutoff = now - targetCooldownMs;
  
  const targetsResult = db.exec(
    'SELECT target_id, last_targeted_time FROM rob_target_tracker WHERE guild_id = ? AND last_targeted_time > ?',
    [guildId, targetCutoff]
  );
  
  const targets = [];
  if (targetsResult.length > 0 && targetsResult[0].values.length > 0) {
    for (const row of targetsResult[0].values) {
      const userId = row[0];
      const lastTargetedTime = row[1];
      const expiresAt = lastTargetedTime + targetCooldownMs;
      targets.push({ userId, expiresAt, type: 'target' });
    }
  }
  
  return { robbers, targets };
}

// Get all active hack cooldowns
function getActiveHackCooldowns(guildId) {
  if (!db) return { hackers: [], targets: [] };
  
  const hackSettings = getHackSettings(guildId);
  const now = Date.now();
  
  // Base hacker cooldown
  const baseHackerCooldownMs = hackSettings.cooldownMinutes * 60 * 1000;
  // Query with base cooldown to catch all potentially active cooldowns
  const hackerCutoff = now - baseHackerCooldownMs;
  
  const hackersResult = db.exec(
    'SELECT user_id, last_hack_time FROM hack_tracker WHERE guild_id = ? AND last_hack_time > ?',
    [guildId, hackerCutoff]
  );
  
  const hackers = [];
  if (hackersResult.length > 0 && hackersResult[0].values.length > 0) {
    for (const row of hackersResult[0].values) {
      const userId = row[0];
      const lastHackTime = row[1];
      
      // Get user's skill-based cooldown reduction
      const hackBonuses = getHackBonuses(guildId, userId);
      const reducedCooldownMs = baseHackerCooldownMs * (1 - hackBonuses.cooldownReduction / 100);
      const expiresAt = lastHackTime + reducedCooldownMs;
      
      // Only include if still on cooldown with reduced time
      if (expiresAt > now) {
        hackers.push({ userId, expiresAt, type: 'hacker' });
      }
    }
  }
  
  // Target cooldowns
  const targetCooldownMs = hackSettings.targetCooldownMinutes * 60 * 1000;
  const targetCutoff = now - targetCooldownMs;
  
  const targetsResult = db.exec(
    'SELECT target_id, last_hacked_time FROM hack_target_tracker WHERE guild_id = ? AND last_hacked_time > ?',
    [guildId, targetCutoff]
  );
  
  const targets = [];
  if (targetsResult.length > 0 && targetsResult[0].values.length > 0) {
    for (const row of targetsResult[0].values) {
      const userId = row[0];
      const lastHackedTime = row[1];
      const expiresAt = lastHackedTime + targetCooldownMs;
      targets.push({ userId, expiresAt, type: 'target' });
    }
  }
  
  return { hackers, targets };
}

// Format time remaining
function formatTimeRemaining(expiresAt) {
  const now = Date.now();
  const remaining = expiresAt - now;
  
  if (remaining <= 0) return 'Ready!';
  
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
  
  // Format as hh:mm:ss
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  
  return `${hh}:${mm}:${ss}`;
}

// Build the cooldown tracker embed
async function buildCooldownEmbed(guildId) {
  const settings = getTrackerSettings(guildId);
  const robCooldowns = getActiveRobCooldowns(guildId);
  const hackCooldowns = getActiveHackCooldowns(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('⏱️ Witness Protection List')
    .setTimestamp()
    .setFooter({ text: `Updates every ${settings.updateIntervalSeconds}s • Last updated` });
  
  // Rob section
  if (settings.showRobCooldowns) {
    // Robbers on cooldown (can't rob)
    let robberList = '';
    if (robCooldowns.robbers.length > 0) {
      const sorted = robCooldowns.robbers.sort((a, b) => a.expiresAt - b.expiresAt);
      robberList = sorted.slice(0, 10).map(c => `<@${c.userId}> - ${formatTimeRemaining(c.expiresAt)}`).join('\n');
      if (robCooldowns.robbers.length > 10) {
        robberList += `\n*+${robCooldowns.robbers.length - 10} more...*`;
      }
    } else {
      robberList = '*No one on cooldown*';
    }
    embed.addFields({ name: '🔫 Rob Cooldown (Can\'t Rob)', value: robberList, inline: true });
    
    // Targets protected (can't be robbed)
    if (settings.showTargetCooldowns) {
      let targetList = '';
      if (robCooldowns.targets.length > 0) {
        const sorted = robCooldowns.targets.sort((a, b) => a.expiresAt - b.expiresAt);
        targetList = sorted.slice(0, 10).map(c => `<@${c.userId}> - ${formatTimeRemaining(c.expiresAt)}`).join('\n');
        if (robCooldowns.targets.length > 10) {
          targetList += `\n*+${robCooldowns.targets.length - 10} more...*`;
        }
      } else {
        targetList = '*No one protected*';
      }
      embed.addFields({ name: '🛡️ Rob Protected (Can\'t Be Robbed)', value: targetList, inline: true });
    }
  }
  
  // Add spacer for better formatting
  if (settings.showRobCooldowns && settings.showHackCooldowns) {
    embed.addFields({ name: '\u200b', value: '\u200b', inline: false });
  }
  
  // Hack section
  if (settings.showHackCooldowns) {
    // Hackers on cooldown (can't hack)
    let hackerList = '';
    if (hackCooldowns.hackers.length > 0) {
      const sorted = hackCooldowns.hackers.sort((a, b) => a.expiresAt - b.expiresAt);
      hackerList = sorted.slice(0, 10).map(c => `<@${c.userId}> - ${formatTimeRemaining(c.expiresAt)}`).join('\n');
      if (hackCooldowns.hackers.length > 10) {
        hackerList += `\n*+${hackCooldowns.hackers.length - 10} more...*`;
      }
    } else {
      hackerList = '*No one on cooldown*';
    }
    embed.addFields({ name: '💻 Hack Cooldown (Can\'t Hack)', value: hackerList, inline: true });
    
    // Targets protected (can't be hacked)
    if (settings.showTargetCooldowns) {
      let targetList = '';
      if (hackCooldowns.targets.length > 0) {
        const sorted = hackCooldowns.targets.sort((a, b) => a.expiresAt - b.expiresAt);
        targetList = sorted.slice(0, 10).map(c => `<@${c.userId}> - ${formatTimeRemaining(c.expiresAt)}`).join('\n');
        if (hackCooldowns.targets.length > 10) {
          targetList += `\n*+${hackCooldowns.targets.length - 10} more...*`;
        }
      } else {
        targetList = '*No one protected*';
      }
      embed.addFields({ name: '🔥 Hack Protected (Can\'t Be Hacked)', value: targetList, inline: true });
    }
  }
  
  // If nothing to show
  if (!settings.showRobCooldowns && !settings.showHackCooldowns) {
    embed.setDescription('*No cooldown tracking enabled*');
  }
  
  return embed;
}

// Update the cooldown tracker for a guild
async function updateCooldownTracker(guildId) {
  if (!discordClient || !db) return;
  
  const settings = getTrackerSettings(guildId);
  if (!settings.enabled || !settings.channelId) return;
  
  try {
    const channel = await discordClient.channels.fetch(settings.channelId);
    if (!channel) return;
    
    const embed = await buildCooldownEmbed(guildId);
    
    // Try to edit existing message
    if (settings.messageId) {
      try {
        const existingMsg = await channel.messages.fetch(settings.messageId);
        await existingMsg.edit({ embeds: [embed] });
        return;
      } catch (e) {
        // Message was deleted, create new one
      }
    }
    
    // Create new message
    const msg = await channel.send({ embeds: [embed] });
    updateTrackerSettings(guildId, { messageId: msg.id });
    
  } catch (error) {
    // Silently ignore connection timeouts - these are transient Discord API issues
    if (error.code === 'UND_ERR_CONNECT_TIMEOUT' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      // Discord is temporarily unreachable, will retry on next interval
      return;
    }
    console.error('Error updating cooldown tracker:', error);
  }
}

// Interval tracking per guild
const guildIntervals = new Map();

// Start the cooldown tracker for a guild
function startCooldownTracker(guildId) {
  const settings = getTrackerSettings(guildId);
  
  // Clear any existing interval
  if (guildIntervals.has(guildId)) {
    clearInterval(guildIntervals.get(guildId));
    guildIntervals.delete(guildId);
  }
  
  if (!settings.enabled || !settings.channelId) return;
  
  // Start interval
  const intervalMs = (settings.updateIntervalSeconds || 30) * 1000;
  const intervalId = setInterval(() => updateCooldownTracker(guildId), intervalMs);
  guildIntervals.set(guildId, intervalId);
  
  // Initial update
  setTimeout(() => updateCooldownTracker(guildId), 1000);
  
  console.log(`⏱️ Cooldown tracker started for guild ${guildId} (updates every ${settings.updateIntervalSeconds}s)`);
}

// Stop the cooldown tracker for a guild
function stopCooldownTracker(guildId) {
  if (guildIntervals.has(guildId)) {
    clearInterval(guildIntervals.get(guildId));
    guildIntervals.delete(guildId);
    console.log(`⏱️ Cooldown tracker stopped for guild ${guildId}`);
  }
}

// Start all enabled trackers (called on bot startup)
function startAllTrackers() {
  if (!db) return;
  
  const result = db.exec('SELECT guild_id FROM cooldown_tracker_settings WHERE enabled = 1');
  
  if (result.length > 0 && result[0].values.length > 0) {
    for (const row of result[0].values) {
      const guildId = row[0];
      startCooldownTracker(guildId);
    }
  }
}

// Set tracker channel
function setTrackerChannel(guildId, channelId) {
  const settings = getTrackerSettings(guildId);
  settings.channelId = channelId;
  settings.messageId = null; // Reset message ID when channel changes
  saveTrackerSettings(guildId, settings);
}

// Enable/disable tracker
function setTrackerEnabled(guildId, enabled) {
  const settings = getTrackerSettings(guildId);
  settings.enabled = enabled;
  saveTrackerSettings(guildId, settings);
  
  if (enabled) {
    startCooldownTracker(guildId);
  } else {
    stopCooldownTracker(guildId);
  }
}

module.exports = {
  initCooldownTracker,
  getTrackerSettings,
  saveTrackerSettings,
  updateTrackerSettings,
  setTrackerChannel,
  setTrackerEnabled,
  startCooldownTracker,
  stopCooldownTracker,
  startAllTrackers,
  updateCooldownTracker,
  buildCooldownEmbed,
  getActiveRobCooldowns,
  getActiveHackCooldowns
};
