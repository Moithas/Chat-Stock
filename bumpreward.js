// Bump Reward System - Reward users for bumping the server on Disboard
const { getDb, saveDatabase } = require('./database');

const DISBOARD_BOT_ID = '302050872383242240';

let db;

function initBumpReward(database) {
  db = database;

  db.run(`CREATE TABLE IF NOT EXISTS bump_reward_settings (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    min_reward INTEGER DEFAULT 2000,
    max_reward INTEGER DEFAULT 8000,
    channel_id TEXT DEFAULT NULL,
    announce INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bump_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reward_amount INTEGER NOT NULL,
    bumped_at INTEGER NOT NULL
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_bump_history_guild_user ON bump_history(guild_id, user_id)`);

  saveDatabase();
  console.log('📣 Bump reward system initialized');
}

function getBumpSettings(guildId) {
  // Ensure row exists
  db.run(`INSERT OR IGNORE INTO bump_reward_settings (guild_id) VALUES ('${guildId}')`);
  
  const result = db.exec(`SELECT * FROM bump_reward_settings WHERE guild_id = '${guildId}'`);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return { enabled: false, minReward: 500, maxReward: 1000, channelId: null, announce: true };
  }
  
  const cols = result[0].columns;
  const row = result[0].values[0];
  const data = {};
  cols.forEach((col, idx) => data[col] = row[idx]);
  
  return {
    enabled: !!data.enabled,
    minReward: data.min_reward,
    maxReward: data.max_reward,
    channelId: data.channel_id,
    announce: !!data.announce
  };
}

function updateBumpSettings(guildId, settings) {
  const fields = [];
  
  if (settings.enabled !== undefined) fields.push(`enabled = ${settings.enabled ? 1 : 0}`);
  if (settings.minReward !== undefined) fields.push(`min_reward = ${settings.minReward}`);
  if (settings.maxReward !== undefined) fields.push(`max_reward = ${settings.maxReward}`);
  if (settings.channelId !== undefined) fields.push(`channel_id = ${settings.channelId ? `'${settings.channelId}'` : 'NULL'}`);
  if (settings.announce !== undefined) fields.push(`announce = ${settings.announce ? 1 : 0}`);
  
  if (fields.length > 0) {
    db.run(`UPDATE bump_reward_settings SET ${fields.join(', ')} WHERE guild_id = '${guildId}'`);
    saveDatabase();
  }
}

function recordBump(guildId, userId, rewardAmount) {
  db.run(`INSERT INTO bump_history (guild_id, user_id, reward_amount, bumped_at) VALUES ('${guildId}', '${userId}', ${rewardAmount}, ${Date.now()})`);
  saveDatabase();
}

function getBumpStats(guildId, userId) {
  
  const totalResult = db.exec(`SELECT COUNT(*), COALESCE(SUM(reward_amount), 0) FROM bump_history WHERE guild_id = '${guildId}' AND user_id = '${userId}'`);
  const total = totalResult.length > 0 ? { count: totalResult[0].values[0][0], earned: totalResult[0].values[0][1] } : { count: 0, earned: 0 };
  
  const lastResult = db.exec(`SELECT bumped_at FROM bump_history WHERE guild_id = '${guildId}' AND user_id = '${userId}' ORDER BY bumped_at DESC LIMIT 1`);
  const lastBump = lastResult.length > 0 && lastResult[0].values.length > 0 ? lastResult[0].values[0][0] : null;
  
  const serverTotal = db.exec(`SELECT COUNT(*), COALESCE(SUM(reward_amount), 0) FROM bump_history WHERE guild_id = '${guildId}'`);
  const server = serverTotal.length > 0 ? { count: serverTotal[0].values[0][0], earned: serverTotal[0].values[0][1] } : { count: 0, earned: 0 };
  
  return { total, lastBump, server };
}

function rollBumpReward(minReward, maxReward) {
  return Math.floor(Math.random() * (maxReward - minReward + 1)) + minReward;
}

/**
 * Check if a message is a Disboard bump confirmation.
 * Disboard sends an embed with "Bump done!" in the description after a successful /bump.
 */
function isDisboardBump(message) {
  if (message.author.id !== DISBOARD_BOT_ID) return false;
  if (!message.embeds || message.embeds.length === 0) return false;
  
  const embed = message.embeds[0];
  const desc = (embed.description || '').toLowerCase();
  
  // Disboard's bump confirmation contains "bump done" in the embed description
  return desc.includes('bump done');
}

/**
 * Extract the user ID from a Disboard bump message.
 * Only uses message.interaction.user.id for reliable identification.
 * The fallback embed regex was unreliable as Disboard's format can vary.
 */
function extractBumperUserId(message) {
  // Disboard's /bump response includes the interaction user who triggered it
  // This is the only reliable way to identify who actually used /bump
  if (message.interaction?.user?.id) {
    console.log(`[BumpReward] Extracted bumper from interaction: ${message.interaction.user.id}`);
    return message.interaction.user.id;
  }
  
  // For message updates, interaction data may be present on interactionMetadata
  if (message.interactionMetadata?.user?.id) {
    console.log(`[BumpReward] Extracted bumper from interactionMetadata: ${message.interactionMetadata.user.id}`);
    return message.interactionMetadata.user.id;
  }
  
  // Log what we found for debugging but don't use fallback parsing
  if (message.embeds?.length > 0) {
    const desc = message.embeds[0].description || '';
    console.log(`[BumpReward] No interaction data found. Embed description: "${desc.substring(0, 150)}"`);
  }
  
  console.log(`[BumpReward] Could not extract bumper - no interaction data available`);
  return null;
}

module.exports = {
  DISBOARD_BOT_ID,
  initBumpReward,
  getBumpSettings,
  updateBumpSettings,
  recordBump,
  getBumpStats,
  rollBumpReward,
  isDisboardBump,
  extractBumperUserId
};
