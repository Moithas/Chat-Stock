// Per-guild, per-command channel allowlist.
//
// Replaces Discord's "Integrations → command channel restrictions" with bot-side
// enforcement so the bot can dynamically grant access to channels it creates
// (e.g. VIP gambling rooms) without requiring an OAuth2 user token to modify
// integration permissions.
//
// Semantics:
//   - If a (guild, command) has NO rows in the table, the command is unrestricted.
//   - If a (guild, command) has 1+ rows, the command is allowed ONLY in those channels.
//   - VIP gambling rooms are exempt from these restrictions (they have their own
//     allowlist enforced separately in bot.js). This module does not implement
//     that exemption itself; callers compose the two checks.
//
// All operations are synchronous (sql.js); db is supplied by bot.js at boot.

let db = null;

// In-memory cache keyed by guildId. Each value is a Map of commandName -> Set<channelId>.
// A missing commandName entry means "unrestricted". An empty Set should not be stored
// (clearing the last channel removes the commandName entry entirely).
const cacheByGuild = new Map();

function initCommandChannels(database) {
  db = database;
  db.run(`
    CREATE TABLE IF NOT EXISTS command_channel_allowlist (
      guild_id TEXT NOT NULL,
      command_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, command_name, channel_id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ccal_guild_cmd ON command_channel_allowlist(guild_id, command_name)`);
  loadCache();
  console.log('🎯 Command-channel allowlist initialized');
}

function loadCache() {
  cacheByGuild.clear();
  if (!db) return;
  const result = db.exec('SELECT guild_id, command_name, channel_id FROM command_channel_allowlist');
  if (result.length === 0) return;
  for (const [guildId, commandName, channelId] of result[0].values) {
    let g = cacheByGuild.get(guildId);
    if (!g) { g = new Map(); cacheByGuild.set(guildId, g); }
    let s = g.get(commandName);
    if (!s) { s = new Set(); g.set(commandName, s); }
    s.add(channelId);
  }
}

function isCommandRestrictedInGuild(guildId, commandName) {
  const g = cacheByGuild.get(guildId);
  if (!g) return false;
  const s = g.get(commandName);
  return !!(s && s.size > 0);
}

function isCommandAllowedInChannel(guildId, commandName, channelId) {
  const g = cacheByGuild.get(guildId);
  if (!g) return true;
  const s = g.get(commandName);
  if (!s || s.size === 0) return true;
  return s.has(channelId);
}

function getAllowedChannels(guildId, commandName) {
  const g = cacheByGuild.get(guildId);
  if (!g) return [];
  const s = g.get(commandName);
  return s ? Array.from(s) : [];
}

function listGuildRestrictions(guildId) {
  const g = cacheByGuild.get(guildId);
  if (!g) return {};
  const out = {};
  for (const [cmd, set] of g.entries()) out[cmd] = Array.from(set);
  return out;
}

function addAllowedChannel(guildId, commandName, channelId) {
  if (!db) return false;
  db.run(
    `INSERT OR IGNORE INTO command_channel_allowlist (guild_id, command_name, channel_id, created_at) VALUES (?, ?, ?, ?)`,
    [guildId, commandName, channelId, Date.now()]
  );
  let g = cacheByGuild.get(guildId);
  if (!g) { g = new Map(); cacheByGuild.set(guildId, g); }
  let s = g.get(commandName);
  if (!s) { s = new Set(); g.set(commandName, s); }
  s.add(channelId);
  return true;
}

function removeAllowedChannel(guildId, commandName, channelId) {
  if (!db) return false;
  db.run(
    `DELETE FROM command_channel_allowlist WHERE guild_id=? AND command_name=? AND channel_id=?`,
    [guildId, commandName, channelId]
  );
  const g = cacheByGuild.get(guildId);
  if (g) {
    const s = g.get(commandName);
    if (s) {
      s.delete(channelId);
      if (s.size === 0) g.delete(commandName);
    }
    if (g.size === 0) cacheByGuild.delete(guildId);
  }
  return true;
}

function clearCommandRestrictions(guildId, commandName) {
  if (!db) return false;
  db.run(`DELETE FROM command_channel_allowlist WHERE guild_id=? AND command_name=?`, [guildId, commandName]);
  const g = cacheByGuild.get(guildId);
  if (g) {
    g.delete(commandName);
    if (g.size === 0) cacheByGuild.delete(guildId);
  }
  return true;
}

// Bulk replace: for a given (guildId, commandName), set the allowlist to exactly `channelIds`.
function setAllowedChannels(guildId, commandName, channelIds) {
  if (!db) return false;
  db.run(`DELETE FROM command_channel_allowlist WHERE guild_id=? AND command_name=?`, [guildId, commandName]);
  const now = Date.now();
  for (const ch of channelIds) {
    db.run(
      `INSERT OR IGNORE INTO command_channel_allowlist (guild_id, command_name, channel_id, created_at) VALUES (?, ?, ?, ?)`,
      [guildId, commandName, ch, now]
    );
  }
  let g = cacheByGuild.get(guildId);
  if (!g) { g = new Map(); cacheByGuild.set(guildId, g); }
  if (channelIds.length === 0) {
    g.delete(commandName);
    if (g.size === 0) cacheByGuild.delete(guildId);
  } else {
    g.set(commandName, new Set(channelIds));
  }
  return true;
}

module.exports = {
  initCommandChannels,
  isCommandRestrictedInGuild,
  isCommandAllowedInChannel,
  getAllowedChannels,
  listGuildRestrictions,
  addAllowedChannel,
  removeAllowedChannel,
  clearCommandRestrictions,
  setAllowedChannels,
};
