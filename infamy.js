// Infamy & Bounty System - Backend Module
// Tracks criminal reputation, bounty mechanics, insider trading detection, and probation



let db = null;
let client = null;

// ==================== TIER DEFINITIONS ====================
const INFAMY_TIERS = [
  { tier: 0, name: 'Clean',        emoji: '✅',  minPoints: 0,       maxPoints: 14999,  successBuff: 0,  earningsCut: 0,   fineModifier: 0,   feeModifier: 0,  vaultPenalty: 0, bountyChance: 0  },
  { tier: 1, name: 'Suspect',      emoji: '🔍',  minPoints: 15000,   maxPoints: 29999,  successBuff: 0,  earningsCut: 0,   fineModifier: 0,   feeModifier: 0,  vaultPenalty: 0, bountyChance: 0  },
  { tier: 2, name: 'Criminal',     emoji: '🔓',  minPoints: 30000,   maxPoints: 59999,  successBuff: 5,  earningsCut: 0,   fineModifier: 10,  feeModifier: 0,  vaultPenalty: 0, bountyChance: 0  },
  { tier: 3, name: 'Wanted',       emoji: '🚨',  minPoints: 60000,   maxPoints: 99999,  successBuff: 10, earningsCut: 5,   fineModifier: 20,  feeModifier: 0,  vaultPenalty: 0, bountyChance: 15 },
  { tier: 4, name: 'Most Wanted',  emoji: '🏴',  minPoints: 100000,  maxPoints: 149999, successBuff: 15, earningsCut: 10,  fineModifier: 30,  feeModifier: 5,  vaultPenalty: 2, bountyChance: 30 },
  { tier: 5, name: 'Blacklisted',  emoji: '☠️',  minPoints: 150000,  maxPoints: Infinity,successBuff: 20, earningsCut: 20, fineModifier: 50,  feeModifier: 10, vaultPenalty: -1, bountyChance: 50 }
];

// Infamy gain rates per source
const INFAMY_RATES = {
  hack: 0.2,     // 0.2 per currency stolen
  rob: 0.5,      // 0.5 per currency stolen
  vault: 1.0,    // 1.0 per currency collected
  insider: 1000  // flat 1,000 per detected stock
};

// ==================== INITIALIZATION ====================
function initInfamy(database, discordClient) {
  db = database;
  client = discordClient;

  // Main settings table (per-guild configuration)
  db.run(`
    CREATE TABLE IF NOT EXISTS infamy_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      decay_per_hour REAL DEFAULT 1,
      dungeon_reduction INTEGER DEFAULT 25,
      charity_rate REAL DEFAULT 0.1,
      hack_rate REAL DEFAULT 0.2,
      rob_rate REAL DEFAULT 0.5,
      vault_rate REAL DEFAULT 1.0,
      insider_flat INTEGER DEFAULT 1000,
      t0_max INTEGER DEFAULT 14999,
      t1_max INTEGER DEFAULT 29999,
      t2_max INTEGER DEFAULT 59999,
      t3_max INTEGER DEFAULT 99999,
      t4_max INTEGER DEFAULT 149999,
      bounty_t3_chance INTEGER DEFAULT 15,
      bounty_t4_chance INTEGER DEFAULT 30,
      bounty_t5_chance INTEGER DEFAULT 50,
      probation_days_per_tier INTEGER DEFAULT 1,
      announce_channel_id TEXT
    )
  `);

  // Player infamy tracker
  db.run(`
    CREATE TABLE IF NOT EXISTS infamy_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      infamy_points REAL DEFAULT 0,
      total_earned REAL DEFAULT 0,
      total_decayed REAL DEFAULT 0,
      total_reduced REAL DEFAULT 0,
      bounties_posted INTEGER DEFAULT 0,
      bounties_claimed_on INTEGER DEFAULT 0,
      peak_infamy REAL DEFAULT 0,
      probation_until INTEGER DEFAULT 0,
      probation_tier INTEGER DEFAULT 0,
      last_updated INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  // Active bounty board
  db.run(`
    CREATE TABLE IF NOT EXISTS bounty_board (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      bounty_amount INTEGER NOT NULL,
      posted_at INTEGER NOT NULL,
      posted_infamy REAL NOT NULL,
      claimed_by TEXT,
      claimed_at INTEGER,
      claim_method TEXT,
      active INTEGER DEFAULT 1
    )
  `);

  // Insider trading snapshots
  db.run(`
    CREATE TABLE IF NOT EXISTS insider_trading_snapshots (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      stock_user_id TEXT NOT NULL,
      shares INTEGER NOT NULL,
      price_at_snapshot REAL NOT NULL,
      event_name TEXT,
      snapshot_time INTEGER NOT NULL,
      checked INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, stock_user_id, snapshot_time)
    )
  `);

  // Add peak_infamy column if missing (migration)
  try {
    db.run('ALTER TABLE infamy_tracker ADD COLUMN peak_infamy REAL DEFAULT 0');
  } catch (e) { /* column already exists */ }

  console.log('🏴‍☠️ Infamy & Bounty system initialized');
}

// ==================== SETTINGS ====================
function getInfamySettings(guildId) {
  if (!db) return getDefaultSettings();

  const result = db.exec('SELECT * FROM infamy_settings WHERE guild_id = ?', [guildId]);
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  }

  return getDefaultSettings();
}

function getDefaultSettings() {
  return {
    enabled: 1,
    decay_per_hour: 1,
    dungeon_reduction: 25,
    charity_rate: 0.1,
    hack_rate: 0.2,
    rob_rate: 0.5,
    vault_rate: 1.0,
    insider_flat: 1000,
    t0_max: 14999,
    t1_max: 29999,
    t2_max: 59999,
    t3_max: 99999,
    t4_max: 149999,
    bounty_t3_chance: 15,
    bounty_t4_chance: 30,
    bounty_t5_chance: 50,
    probation_days_per_tier: 1,
    announce_channel_id: null
  };
}

function updateInfamySettings(guildId, updates) {
  if (!db) return;
  const current = getInfamySettings(guildId);
  const merged = { ...current, ...updates, guild_id: guildId };

  db.run(`
    INSERT OR REPLACE INTO infamy_settings 
    (guild_id, enabled, decay_per_hour, dungeon_reduction, charity_rate, hack_rate, rob_rate, vault_rate, insider_flat,
     t0_max, t1_max, t2_max, t3_max, t4_max, bounty_t3_chance, bounty_t4_chance, bounty_t5_chance, 
     probation_days_per_tier, announce_channel_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId, merged.enabled, merged.decay_per_hour, merged.dungeon_reduction, merged.charity_rate,
    merged.hack_rate, merged.rob_rate, merged.vault_rate, merged.insider_flat,
    merged.t0_max, merged.t1_max, merged.t2_max, merged.t3_max, merged.t4_max,
    merged.bounty_t3_chance, merged.bounty_t4_chance, merged.bounty_t5_chance,
    merged.probation_days_per_tier, merged.announce_channel_id
  ]);
}

// ==================== INFAMY TRACKING ====================
function getInfamy(guildId, userId) {
  if (!db) return { infamy_points: 0, total_earned: 0, total_decayed: 0, total_reduced: 0, bounties_posted: 0, bounties_claimed_on: 0, peak_infamy: 0, probation_until: 0, probation_tier: 0 };

  const result = db.exec('SELECT * FROM infamy_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  }

  return { infamy_points: 0, total_earned: 0, total_decayed: 0, total_reduced: 0, bounties_posted: 0, bounties_claimed_on: 0, peak_infamy: 0, probation_until: 0, probation_tier: 0 };
}

function addInfamy(guildId, userId, amount, source = 'unknown') {
  if (!db) return 0;
  const settings = getInfamySettings(guildId);
  if (!settings.enabled) return 0;

  amount = Math.round(amount);
  if (amount <= 0) return 0;

  const current = getInfamy(guildId, userId);
  const newPoints = current.infamy_points + amount;

  db.run(`
    INSERT INTO infamy_tracker (guild_id, user_id, infamy_points, total_earned, peak_infamy, last_updated)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      infamy_points = infamy_points + ?,
      total_earned = total_earned + ?,
      peak_infamy = MAX(peak_infamy, infamy_points + ?),
      last_updated = ?
  `, [guildId, userId, amount, amount, amount, Date.now(), amount, amount, amount, Date.now()]);

  return newPoints;
}

function reduceInfamy(guildId, userId, amount, source = 'unknown') {
  if (!db) return 0;

  amount = Math.round(amount);
  if (amount <= 0) return 0;

  const current = getInfamy(guildId, userId);
  const actualReduction = Math.min(amount, current.infamy_points);
  if (actualReduction <= 0) return 0;

  db.run(`
    UPDATE infamy_tracker SET 
      infamy_points = MAX(0, infamy_points - ?),
      total_reduced = total_reduced + ?,
      last_updated = ?
    WHERE guild_id = ? AND user_id = ?
  `, [actualReduction, actualReduction, Date.now(), guildId, userId]);

  return current.infamy_points - actualReduction;
}

function resetInfamy(guildId, userId) {
  if (!db) return;

  db.run(`
    UPDATE infamy_tracker SET 
      infamy_points = 0,
      probation_until = 0,
      probation_tier = 0,
      last_updated = ?
    WHERE guild_id = ? AND user_id = ?
  `, [Date.now(), guildId, userId]);
}

// ==================== TIER CALCULATIONS ====================
function getInfamyTier(guildId, userId) {
  const data = getInfamy(guildId, userId);
  return getTierFromPoints(data.infamy_points, guildId);
}

function getTierFromPoints(points, guildId) {
  const settings = getInfamySettings(guildId);
  const thresholds = [
    settings.t0_max,
    settings.t1_max,
    settings.t2_max,
    settings.t3_max,
    settings.t4_max
  ];

  if (points > thresholds[4]) return INFAMY_TIERS[5];
  if (points > thresholds[3]) return INFAMY_TIERS[4];
  if (points > thresholds[2]) return INFAMY_TIERS[3];
  if (points > thresholds[1]) return INFAMY_TIERS[2];
  if (points > thresholds[0]) return INFAMY_TIERS[1];
  return INFAMY_TIERS[0];
}

function getTierEffects(guildId, userId) {
  const data = getInfamy(guildId, userId);
  const tier = getTierFromPoints(data.infamy_points, guildId);

  // During probation, use probation tier effects
  if (data.probation_until > Date.now() && data.probation_tier > 0) {
    const probationTier = INFAMY_TIERS[Math.min(data.probation_tier, 5)];
    return {
      ...probationTier,
      infamyPoints: data.infamy_points,
      onProbation: true,
      probationUntil: data.probation_until
    };
  }

  return {
    ...tier,
    infamyPoints: data.infamy_points,
    onProbation: false,
    probationUntil: 0
  };
}

// ==================== BOUNTY SYSTEM ====================
function rollBountyCheck(guildId, userId) {
  const settings = getInfamySettings(guildId);
  if (!settings.enabled) return false;

  const data = getInfamy(guildId, userId);
  const tier = getTierFromPoints(data.infamy_points, guildId);

  if (tier.bountyChance <= 0) return false;

  // Check if already has active bounty
  const existing = getActiveBounty(guildId, userId);
  if (existing) {
    // Update existing bounty amount to current infamy
    updateBountyAmount(guildId, userId, Math.round(data.infamy_points));
    return false; // Don't create a new one, just update
  }

  const roll = Math.random() * 100;
  return roll < tier.bountyChance;
}

function createBounty(guildId, userId) {
  if (!db) return null;

  const data = getInfamy(guildId, userId);
  const bountyAmount = Math.round(data.infamy_points);

  if (bountyAmount <= 0) return null;

  db.run(`
    INSERT INTO bounty_board (guild_id, target_user_id, bounty_amount, posted_at, posted_infamy, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `, [guildId, userId, bountyAmount, Date.now(), data.infamy_points]);

  // Increment bounties posted counter
  db.run(`
    UPDATE infamy_tracker SET bounties_posted = bounties_posted + 1
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, userId]);

  return {
    targetUserId: userId,
    bountyAmount,
    postedAt: Date.now()
  };
}

function getActiveBounty(guildId, targetUserId) {
  if (!db) return null;

  const result = db.exec(
    'SELECT * FROM bounty_board WHERE guild_id = ? AND target_user_id = ? AND active = 1 ORDER BY posted_at DESC LIMIT 1',
    [guildId, targetUserId]
  );

  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  }

  return null;
}

function getActiveBounties(guildId) {
  if (!db) return [];

  const result = db.exec(
    'SELECT * FROM bounty_board WHERE guild_id = ? AND active = 1 ORDER BY bounty_amount DESC',
    [guildId]
  );

  if (result.length === 0 || result[0].values.length === 0) return [];

  const cols = result[0].columns;
  return result[0].values.map(vals => cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {}));
}

function updateBountyAmount(guildId, targetUserId, newAmount) {
  if (!db) return;

  db.run(`
    UPDATE bounty_board SET bounty_amount = ?
    WHERE guild_id = ? AND target_user_id = ? AND active = 1
  `, [newAmount, guildId, targetUserId]);
}

function claimBounty(guildId, targetUserId, claimedBy, method = 'hack') {
  if (!db) return null;

  const bounty = getActiveBounty(guildId, targetUserId);
  if (!bounty) return null;

  // Mark bounty as claimed
  db.run(`
    UPDATE bounty_board SET active = 0, claimed_by = ?, claimed_at = ?, claim_method = ?
    WHERE guild_id = ? AND target_user_id = ? AND active = 1
  `, [claimedBy, Date.now(), method, guildId, targetUserId]);

  // Increment target's bounties_claimed_on counter
  db.run(`
    UPDATE infamy_tracker SET bounties_claimed_on = bounties_claimed_on + 1
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, targetUserId]);

  return bounty;
}

// ==================== PROBATION ====================
function startProbation(guildId, userId) {
  if (!db) return;

  const data = getInfamy(guildId, userId);
  const tier = getTierFromPoints(data.infamy_points, guildId);
  const settings = getInfamySettings(guildId);

  const daysOfProbation = tier.tier * settings.probation_days_per_tier;
  const probationUntil = Date.now() + (daysOfProbation * 24 * 60 * 60 * 1000);

  db.run(`
    UPDATE infamy_tracker SET 
      probation_until = ?,
      probation_tier = ?,
      infamy_points = 0,
      last_updated = ?
    WHERE guild_id = ? AND user_id = ?
  `, [probationUntil, tier.tier, Date.now(), guildId, userId]);
}

function isOnProbation(guildId, userId) {
  const data = getInfamy(guildId, userId);
  if (data.probation_until > Date.now()) {
    return {
      onProbation: true,
      until: data.probation_until,
      tier: data.probation_tier
    };
  }

  // Auto-clear expired probation
  if (data.probation_until > 0 && data.probation_until <= Date.now()) {
    db.run(`
      UPDATE infamy_tracker SET probation_until = 0, probation_tier = 0
      WHERE guild_id = ? AND user_id = ?
    `, [guildId, userId]);
  }

  return { onProbation: false, until: 0, tier: 0 };
}

// ==================== DECAY ====================
function decayAllInfamy() {
  if (!db) return;

  try {
    // Get all guilds with infamy settings
    const guilds = db.exec('SELECT DISTINCT guild_id FROM infamy_tracker WHERE infamy_points > 0');
    if (guilds.length === 0 || guilds[0].values.length === 0) return;

    for (const [guildId] of guilds[0].values) {
      const settings = getInfamySettings(guildId);
      if (!settings.enabled || settings.decay_per_hour <= 0) continue;

      const decayAmount = settings.decay_per_hour;

      db.run(`
        UPDATE infamy_tracker SET 
          infamy_points = MAX(0, infamy_points - ?),
          total_decayed = total_decayed + MIN(infamy_points, ?),
          last_updated = ?
        WHERE guild_id = ? AND infamy_points > 0
      `, [decayAmount, decayAmount, Date.now(), guildId]);
    }
  } catch (error) {
    console.error('Error decaying infamy:', error);
  }
}

// ==================== INSIDER TRADING ====================
function snapshotPortfolio(guildId, eventName) {
  if (!db) return;

  try {
    // Get all users with stock holdings
    const holdings = db.exec(`
      SELECT s.user_id as holder_id, s.stock_user_id, s.shares
      FROM stocks s
      WHERE s.shares > 0
    `);

    if (holdings.length === 0 || holdings[0].values.length === 0) return;

    const now = Date.now();
    for (const [holderId, stockUserId, shares] of holdings[0].values) {
      // Get current price of the stock
      try {
        const { calculateStockPrice } = require('./database');
        const price = calculateStockPrice(stockUserId, guildId);

        db.run(`
          INSERT OR REPLACE INTO insider_trading_snapshots 
          (guild_id, user_id, stock_user_id, shares, price_at_snapshot, event_name, snapshot_time, checked)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `, [guildId, holderId, stockUserId, shares, price, eventName, now]);
      } catch (e) {
        // Skip this stock if price calc fails
      }
    }

    console.log(`📸 Insider trading snapshots taken for guild ${guildId} (event: ${eventName})`);
  } catch (error) {
    console.error('Error taking insider trading snapshot:', error);
  }
}

function checkInsiderTrading(guildId, userId, stockUserId, sellPrice, sharesSold) {
  if (!db) return { detected: false };

  const settings = getInfamySettings(guildId);
  if (!settings.enabled) return { detected: false };

  // Get the most recent unchecked snapshot for this holding
  const result = db.exec(`
    SELECT * FROM insider_trading_snapshots 
    WHERE guild_id = ? AND user_id = ? AND stock_user_id = ? AND checked = 0
    ORDER BY snapshot_time DESC LIMIT 1
  `, [guildId, userId, stockUserId]);

  if (result.length === 0 || result[0].values.length === 0) return { detected: false };

  const cols = result[0].columns;
  const vals = result[0].values[0];
  const snapshot = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});

  // Mark as checked
  db.run(`
    UPDATE insider_trading_snapshots SET checked = 1
    WHERE guild_id = ? AND user_id = ? AND stock_user_id = ? AND snapshot_time = ?
  `, [guildId, userId, stockUserId, snapshot.snapshot_time]);

  // Calculate profit percentage
  const snapshotPrice = snapshot.price_at_snapshot;
  if (snapshotPrice <= 0) return { detected: false };

  const profitPercent = ((sellPrice - snapshotPrice) / snapshotPrice) * 100;
  if (profitPercent <= 5) return { detected: false }; // No detection below 5% profit

  // Determine detection chance based on profit tier
  let detectionChance = 0;
  if (profitPercent > 20) {
    detectionChance = 45;
  } else if (profitPercent > 10) {
    detectionChance = 25;
  } else if (profitPercent > 5) {
    detectionChance = 10;
  }

  const roll = Math.random() * 100;
  const detected = roll < detectionChance;

  if (detected) {
    // Add flat infamy
    const infamyGained = settings.insider_flat;
    addInfamy(guildId, userId, infamyGained, 'insider_trading');

    return {
      detected: true,
      profitPercent: Math.round(profitPercent * 10) / 10,
      detectionChance,
      roll: Math.round(roll * 10) / 10,
      infamyGained,
      eventName: snapshot.event_name
    };
  }

  return { detected: false, profitPercent: Math.round(profitPercent * 10) / 10 };
}

// ==================== ANNOUNCEMENT HELPERS ====================
async function announceBountyPosted(guildId, targetUserId, bountyAmount) {
  if (!client) return;

  const settings = getInfamySettings(guildId);
  const channelId = settings.announce_channel_id;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const { EmbedBuilder } = require('discord.js');

    let username = targetUserId;
    try {
      const user = await client.users.fetch(targetUserId);
      username = user.username;
    } catch (e) {}

    const tier = getInfamyTier(guildId, targetUserId);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🚨 BOUNTY POSTED!')
      .setDescription(
        `A bounty has been placed on **${username}**!\n\n` +
        `${tier.emoji} **Tier ${tier.tier}: ${tier.name}**\n` +
        `💰 **Bounty: ${bountyAmount.toLocaleString()}** ${getCurrency(guildId)}\n\n` +
        `Successfully hack or rob this player to claim the bounty!`
      )
      .setFooter({ text: 'Check /leaderboard → Bounty Board for active bounties' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error announcing bounty:', error);
  }
}

async function announceBountyClaimed(guildId, targetUserId, claimedBy, bountyAmount, method) {
  if (!client) return;

  const settings = getInfamySettings(guildId);
  const channelId = settings.announce_channel_id;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const { EmbedBuilder } = require('discord.js');

    let targetName = targetUserId;
    let claimerName = claimedBy;
    try {
      const target = await client.users.fetch(targetUserId);
      targetName = target.username;
    } catch (e) {}
    try {
      const claimer = await client.users.fetch(claimedBy);
      claimerName = claimer.username;
    } catch (e) {}

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('🏆 BOUNTY CLAIMED!')
      .setDescription(
        `**${claimerName}** has claimed the bounty on **${targetName}**!\n\n` +
        `💰 **Bounty Reward: ${bountyAmount.toLocaleString()}** ${getCurrency(guildId)}\n` +
        `⚔️ **Method: ${method === 'hack' ? '💻 Hack' : '💰 Rob'}**\n\n` +
        `${targetName} is now on probation.`
      )
      .setFooter({ text: 'Justice has been served!' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error announcing bounty claim:', error);
  }
}

async function announceInsiderTrading(guildId, userId, stockUserId, infamyGained, profitPercent, eventName) {
  if (!client) return;

  const settings = getInfamySettings(guildId);
  const channelId = settings.announce_channel_id;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const { EmbedBuilder } = require('discord.js');

    let username = userId;
    let stockName = stockUserId;
    try {
      const user = await client.users.fetch(userId);
      username = user.username;
    } catch (e) {}
    try {
      const stock = await client.users.fetch(stockUserId);
      stockName = stock.username;
    } catch (e) {}

    const embed = new EmbedBuilder()
      .setColor(0xff6600)
      .setTitle('🔍 INSIDER TRADING DETECTED!')
      .setDescription(
        `**${username}** has been flagged for suspicious trading!\n\n` +
        `📈 **Stock:** ${stockName}\n` +
        `💹 **Profit:** +${profitPercent}% during "${eventName}"\n` +
        `🏴‍☠️ **Infamy Gained:** +${infamyGained.toLocaleString()}`
      )
      .setFooter({ text: 'The SEC is watching...' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error announcing insider trading:', error);
  }
}

// ==================== LEADERBOARD & STATS ====================
function getInfamyLeaderboard(guildId, limit = 10) {
  if (!db) return [];

  const result = db.exec(`
    SELECT user_id, infamy_points, total_earned, bounties_posted, bounties_claimed_on
    FROM infamy_tracker 
    WHERE guild_id = ? AND infamy_points > 0
    ORDER BY infamy_points DESC
    LIMIT ?
  `, [guildId, limit]);

  if (result.length === 0 || result[0].values.length === 0) return [];

  const cols = result[0].columns;
  return result[0].values.map(vals => cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {}));
}

// ==================== MODULE EXPORTS ====================
module.exports = {
  // Init
  initInfamy,

  // Settings
  getInfamySettings,
  updateInfamySettings,

  // Infamy tracking
  getInfamy,
  addInfamy,
  reduceInfamy,
  resetInfamy,

  // Tier calculations
  getInfamyTier,
  getTierFromPoints,
  getTierEffects,
  INFAMY_TIERS,
  INFAMY_RATES,

  // Bounty system
  rollBountyCheck,
  createBounty,
  getActiveBounty,
  getActiveBounties,
  updateBountyAmount,
  claimBounty,

  // Probation
  startProbation,
  isOnProbation,

  // Decay
  decayAllInfamy,

  // Insider trading
  snapshotPortfolio,
  checkInsiderTrading,

  // Announcements
  announceBountyPosted,
  announceBountyClaimed,
  announceInsiderTrading,

  // Stats
  getInfamyLeaderboard
};
