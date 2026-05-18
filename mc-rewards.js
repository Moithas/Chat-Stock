// Minecraft activity rewards — console-paste verified system
//
// Admin pastes Shockbyte console output via /admin-mc sync. The bot parses
// "Player connected/disconnected" lines, pairs them into sessions, and credits
// linked Discord users with base_value growth proportional to verified
// in-game time. A per-guild last-sync timestamp watermark prevents duplicate
// crediting when overlapping pastes are submitted.
//
// Parser handles lines like:
//   [2026-05-17 19:29:07:899 INFO] Player connected: Xx B Mac xX, xuid: 25332...
//   [2026-05-17 19:57:56:341 INFO] Player disconnected: Xx B Mac xX, xuid: ...
// Inner ISO timestamps are treated as UTC.

const log = require('./logger');

let db = null;

// Defaults (tunable per-guild via settings table)
const DEFAULTS = {
  rewardPerBlock: 1,      // +1 base_value per block
  minutesPerBlock: 10,    // 10 minutes = 1 block
  dailyCap: 30,           // max +30 base_value per UTC day per user
  maxSessionHours: 12     // ignore sessions longer than this (server crash / stuck open)
};

// Strict regex — matches only the connect/disconnect lines we care about.
// Captures: date, hh, mm, ss, action, username (everything up to ", xuid:")
const LINE_REGEX = /\[(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2}):\d+ INFO\] Player (connected|disconnected): (.+?), xuid:/;

function initMcRewards(database) {
  db = database;

  db.run(`
    CREATE TABLE IF NOT EXISTS mc_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT,
      last_sync_ts INTEGER DEFAULT 0,
      reward_per_block INTEGER DEFAULT 1,
      minutes_per_block INTEGER DEFAULT 10,
      daily_cap INTEGER DEFAULT 30
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mc_links (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      mc_username_lower TEXT NOT NULL,
      mc_username_display TEXT NOT NULL,
      linked_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, discord_id)
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mc_links_name ON mc_links(guild_id, mc_username_lower)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS mc_open_sessions (
      guild_id TEXT NOT NULL,
      mc_username_lower TEXT NOT NULL,
      mc_username_display TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, mc_username_lower)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mc_daily_credit (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      date_utc TEXT NOT NULL,
      credit REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, discord_id, date_utc)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mc_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      admin_id TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      lines_total INTEGER NOT NULL,
      events_parsed INTEGER NOT NULL,
      events_new INTEGER NOT NULL,
      sessions_credited INTEGER NOT NULL,
      total_reward REAL NOT NULL,
      summary TEXT
    );
  `);

  log.info('🎮 Minecraft rewards system initialized');
}

// ---- Settings ----
function getMcSettings(guildId) {
  const result = db.exec('SELECT * FROM mc_settings WHERE guild_id = ?', [guildId]);
  if (result.length === 0 || result[0].values.length === 0) {
    return {
      channelId: null,
      lastSyncTs: 0,
      rewardPerBlock: DEFAULTS.rewardPerBlock,
      minutesPerBlock: DEFAULTS.minutesPerBlock,
      dailyCap: DEFAULTS.dailyCap
    };
  }
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const row = cols.reduce((o, c, i) => ({ ...o, [c]: vals[i] }), {});
  return {
    channelId: row.channel_id,
    lastSyncTs: row.last_sync_ts || 0,
    rewardPerBlock: row.reward_per_block ?? DEFAULTS.rewardPerBlock,
    minutesPerBlock: row.minutes_per_block ?? DEFAULTS.minutesPerBlock,
    dailyCap: row.daily_cap ?? DEFAULTS.dailyCap
  };
}

function upsertSettings(guildId, patch) {
  const cur = getMcSettings(guildId);
  const next = { ...cur, ...patch };
  db.run(`
    INSERT INTO mc_settings (guild_id, channel_id, last_sync_ts, reward_per_block, minutes_per_block, daily_cap)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      last_sync_ts = excluded.last_sync_ts,
      reward_per_block = excluded.reward_per_block,
      minutes_per_block = excluded.minutes_per_block,
      daily_cap = excluded.daily_cap
  `, [guildId, next.channelId, next.lastSyncTs, next.rewardPerBlock, next.minutesPerBlock, next.dailyCap]);
}

function setMcChannel(guildId, channelId) {
  upsertSettings(guildId, { channelId });
}

// ---- Links ----
function getLinkByDiscord(guildId, discordId) {
  const r = db.exec('SELECT * FROM mc_links WHERE guild_id = ? AND discord_id = ?', [guildId, discordId]);
  if (r.length === 0 || r[0].values.length === 0) return null;
  const cols = r[0].columns;
  const vals = r[0].values[0];
  return cols.reduce((o, c, i) => ({ ...o, [c]: vals[i] }), {});
}

function getLinkByMcName(guildId, mcUsername) {
  const r = db.exec('SELECT * FROM mc_links WHERE guild_id = ? AND mc_username_lower = ?',
    [guildId, String(mcUsername).toLowerCase()]);
  if (r.length === 0 || r[0].values.length === 0) return null;
  const cols = r[0].columns;
  const vals = r[0].values[0];
  return cols.reduce((o, c, i) => ({ ...o, [c]: vals[i] }), {});
}

function linkUser(guildId, discordId, mcUsername) {
  const trimmed = String(mcUsername).trim();
  if (!trimmed) return { success: false, error: 'Minecraft username cannot be empty.' };
  if (trimmed.length > 64) return { success: false, error: 'Minecraft username is too long.' };

  const lower = trimmed.toLowerCase();
  const existing = getLinkByMcName(guildId, lower);
  if (existing && existing.discord_id !== discordId) {
    return { success: false, error: `That Minecraft name is already linked to <@${existing.discord_id}>.` };
  }

  db.run(`
    INSERT INTO mc_links (guild_id, discord_id, mc_username_lower, mc_username_display, linked_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, discord_id) DO UPDATE SET
      mc_username_lower = excluded.mc_username_lower,
      mc_username_display = excluded.mc_username_display,
      linked_at = excluded.linked_at
  `, [guildId, discordId, lower, trimmed, Date.now()]);
  return { success: true, mcUsername: trimmed };
}

function unlinkUser(guildId, discordId) {
  const existing = getLinkByDiscord(guildId, discordId);
  if (!existing) return { success: false, error: 'No link found.' };
  db.run('DELETE FROM mc_links WHERE guild_id = ? AND discord_id = ?', [guildId, discordId]);
  return { success: true, mcUsername: existing.mc_username_display };
}

function getAllLinks(guildId) {
  const r = db.exec('SELECT * FROM mc_links WHERE guild_id = ? ORDER BY linked_at DESC', [guildId]);
  if (r.length === 0 || r[0].values.length === 0) return [];
  return r[0].values.map(row => {
    const cols = r[0].columns;
    return cols.reduce((o, c, i) => ({ ...o, [c]: row[i] }), {});
  });
}

function getOpenSessions(guildId) {
  const r = db.exec('SELECT * FROM mc_open_sessions WHERE guild_id = ? ORDER BY joined_at ASC', [guildId]);
  if (r.length === 0 || r[0].values.length === 0) return [];
  return r[0].values.map(row => {
    const cols = r[0].columns;
    return cols.reduce((o, c, i) => ({ ...o, [c]: row[i] }), {});
  });
}

function clearOpenSessions(guildId) {
  db.run('DELETE FROM mc_open_sessions WHERE guild_id = ?', [guildId]);
}

function getRecentSyncLogs(guildId, limit = 10) {
  const r = db.exec('SELECT * FROM mc_sync_log WHERE guild_id = ? ORDER BY synced_at DESC LIMIT ?',
    [guildId, limit]);
  if (r.length === 0 || r[0].values.length === 0) return [];
  return r[0].values.map(row => {
    const cols = r[0].columns;
    return cols.reduce((o, c, i) => ({ ...o, [c]: row[i] }), {});
  });
}

// ---- Parser ----
// Returns { events: [{ ts, action, username }], totalLines }
function parseLogText(text) {
  if (!text) return { events: [], totalLines: 0 };
  const lines = text.split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    const m = line.match(LINE_REGEX);
    if (!m) continue;
    const [, date, hh, mm, ss, action, rawName] = m;
    const [y, mo, d] = date.split('-').map(Number);
    // Treat the inner ISO timestamp as UTC (matches Shockbyte's UTC log timestamps)
    const ts = Date.UTC(y, mo - 1, d, Number(hh), Number(mm), Number(ss));
    if (!Number.isFinite(ts)) continue;
    events.push({ ts, action, username: rawName.trim() });
  }
  events.sort((a, b) => a.ts - b.ts);
  return { events, totalLines: lines.length };
}

// ---- Crediting ----
function getDailyCredit(guildId, discordId, dateUtc) {
  const r = db.exec(
    'SELECT credit FROM mc_daily_credit WHERE guild_id = ? AND discord_id = ? AND date_utc = ?',
    [guildId, discordId, dateUtc]
  );
  if (r.length === 0 || r[0].values.length === 0) return 0;
  return r[0].values[0][0] || 0;
}

function addDailyCredit(guildId, discordId, dateUtc, amount) {
  db.run(`
    INSERT INTO mc_daily_credit (guild_id, discord_id, date_utc, credit)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, discord_id, date_utc) DO UPDATE SET
      credit = credit + excluded.credit
  `, [guildId, discordId, dateUtc, amount]);
}

function utcDateString(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---- Sync ----
// Returns a summary object describing what happened.
function processSync(guildId, adminId, text) {
  const settings = getMcSettings(guildId);
  const { events, totalLines } = parseLogText(text);

  // Filter to events strictly newer than the watermark (avoids double-credit on overlapping paste)
  const newEvents = events.filter(e => e.ts > settings.lastSyncTs);

  // Per-user credit summary
  // key = discord_id -> { mcDisplay, sessions: [{ joinedAt, leftAt, minutes }], creditedBlocks, baseValueAwarded, cappedMinutes }
  const perUser = new Map();
  // Track unlinked players whose sessions we saw (for the admin summary)
  const unlinkedSeen = new Map(); // mc_lower -> mc_display

  let sessionsCredited = 0;
  let totalReward = 0;
  const maxSessionMs = DEFAULTS.maxSessionHours * 60 * 60 * 1000;

  for (const ev of newEvents) {
    const lower = ev.username.toLowerCase();
    if (ev.action === 'connected') {
      // Upsert open session (overwrites any stale open session for that name)
      db.run(`
        INSERT INTO mc_open_sessions (guild_id, mc_username_lower, mc_username_display, joined_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, mc_username_lower) DO UPDATE SET
          mc_username_display = excluded.mc_username_display,
          joined_at = excluded.joined_at
      `, [guildId, lower, ev.username, ev.ts]);
      continue;
    }

    // disconnected — look up the matching open session
    const openR = db.exec(
      'SELECT joined_at, mc_username_display FROM mc_open_sessions WHERE guild_id = ? AND mc_username_lower = ?',
      [guildId, lower]
    );
    if (openR.length === 0 || openR[0].values.length === 0) {
      // No matching join — ignore (likely from before bot tracked them)
      continue;
    }
    const joinedAt = openR[0].values[0][0];
    const mcDisplay = openR[0].values[0][1] || ev.username;
    db.run('DELETE FROM mc_open_sessions WHERE guild_id = ? AND mc_username_lower = ?', [guildId, lower]);

    const durationMs = ev.ts - joinedAt;
    if (durationMs <= 0 || durationMs > maxSessionMs) continue; // ignore impossible / runaway sessions

    const link = getLinkByMcName(guildId, lower);
    if (!link) {
      unlinkedSeen.set(lower, mcDisplay);
      continue;
    }

    // Credit by UTC date of the join (so a single session is billed against one day)
    const dateUtc = utcDateString(joinedAt);
    const alreadyCredited = getDailyCredit(guildId, link.discord_id, dateUtc);
    const remainingCap = Math.max(0, settings.dailyCap - alreadyCredited);
    if (remainingCap <= 0) {
      // Day is full — still record the session for the admin summary
      let u = perUser.get(link.discord_id);
      if (!u) {
        u = { mcDisplay, sessions: [], creditedBlocks: 0, baseValueAwarded: 0, cappedMinutes: 0 };
        perUser.set(link.discord_id, u);
      }
      u.sessions.push({ joinedAt, leftAt: ev.ts, minutes: durationMs / 60000, credited: 0 });
      u.cappedMinutes += durationMs / 60000;
      continue;
    }

    const minutes = durationMs / 60000;
    const blocksEarned = Math.floor(minutes / settings.minutesPerBlock);
    const blocksAfterCap = Math.min(blocksEarned * settings.rewardPerBlock, remainingCap);
    // blocksAfterCap is in base_value units (since rewardPerBlock is per block).

    if (blocksAfterCap > 0) {
      // Credit base_value
      db.run('UPDATE users SET base_value = base_value + ? WHERE user_id = ?',
        [blocksAfterCap, link.discord_id]);
      addDailyCredit(guildId, link.discord_id, dateUtc, blocksAfterCap);
      sessionsCredited++;
      totalReward += blocksAfterCap;
    }

    let u = perUser.get(link.discord_id);
    if (!u) {
      u = { mcDisplay, sessions: [], creditedBlocks: 0, baseValueAwarded: 0, cappedMinutes: 0 };
      perUser.set(link.discord_id, u);
    }
    u.sessions.push({ joinedAt, leftAt: ev.ts, minutes, credited: blocksAfterCap });
    u.baseValueAwarded += blocksAfterCap;
  }

  // Bump watermark to the newest event we saw (even if no rewards — prevents re-processing)
  const newest = newEvents.length > 0 ? newEvents[newEvents.length - 1].ts : settings.lastSyncTs;
  if (newest > settings.lastSyncTs) {
    upsertSettings(guildId, { lastSyncTs: newest });
  }

  // Persist sync log
  const summaryRows = [];
  for (const [discordId, u] of perUser.entries()) {
    summaryRows.push({
      discordId,
      mcDisplay: u.mcDisplay,
      sessions: u.sessions.length,
      totalMinutes: u.sessions.reduce((a, s) => a + s.minutes, 0),
      awarded: u.baseValueAwarded,
      capped: u.cappedMinutes
    });
  }
  const unlinkedList = Array.from(unlinkedSeen.values());

  db.run(`
    INSERT INTO mc_sync_log
      (guild_id, admin_id, synced_at, lines_total, events_parsed, events_new, sessions_credited, total_reward, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    adminId,
    Date.now(),
    totalLines,
    events.length,
    newEvents.length,
    sessionsCredited,
    totalReward,
    JSON.stringify({ rewards: summaryRows, unlinked: unlinkedList })
  ]);

  return {
    totalLines,
    eventsParsed: events.length,
    eventsNew: newEvents.length,
    sessionsCredited,
    totalReward,
    perUser: summaryRows,
    unlinked: unlinkedList,
    watermarkAdvanced: newest > settings.lastSyncTs,
    newWatermark: newest,
    settings
  };
}

module.exports = {
  initMcRewards,
  getMcSettings,
  setMcChannel,
  upsertSettings,
  getLinkByDiscord,
  getLinkByMcName,
  linkUser,
  unlinkUser,
  getAllLinks,
  getOpenSessions,
  clearOpenSessions,
  getRecentSyncLogs,
  parseLogText,
  processSync,
  getDailyCredit,
  utcDateString,
  DEFAULTS
};
