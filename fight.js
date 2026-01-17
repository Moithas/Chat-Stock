// Fight System - PvP cage fighting with betting
// Rock-paper-scissors style combat with spectator betting

const { saveDatabase } = require('./database');

let db = null;

// Default settings
const defaultSettings = {
  enabled: true,
  houseCutPercent: 5,
  rematchFightsRequired: 3,  // Must fight X unique opponents before rematch
  challengeTimeoutSeconds: 30,
  spectatorBetWindowSeconds: 30,
  roundTimeSeconds: 15,
  maxRounds: 20,
  grappleCooldown: 3,  // Rounds before grapple can be used again
  tkoRounds: 3,  // Consecutive no-response rounds for TKO
  drawAfkRounds: 2,  // Consecutive rounds both AFK = draw
  oddsMinFights: 5  // Minimum fights before odds kick in
};

// Damage values
const DAMAGE = {
  STRIKE: 15,
  TAKEDOWN: 20,
  CHOKE: 25,
  GRAPPLE_HEAL: 25,
  DOUBLE_GRAPPLE_HEAL: 5
};

// Move interactions - [attacker][defender] = { winner: 'attacker'|'defender'|'both'|'none', damage: number }
const MOVE_MATRIX = {
  strike: {
    strike: { winner: 'none', damage: 0 },
    takedown: { winner: 'attacker', damage: DAMAGE.STRIKE },
    choke: { winner: 'defender', damage: DAMAGE.CHOKE },
    grapple: { winner: 'both', attackerDamage: DAMAGE.STRIKE, defenderHeal: DAMAGE.GRAPPLE_HEAL }
  },
  takedown: {
    strike: { winner: 'defender', damage: DAMAGE.STRIKE },
    takedown: { winner: 'none', damage: 0 },
    choke: { winner: 'attacker', damage: DAMAGE.TAKEDOWN },
    grapple: { winner: 'both', attackerDamage: DAMAGE.TAKEDOWN, defenderHeal: DAMAGE.GRAPPLE_HEAL }
  },
  choke: {
    strike: { winner: 'attacker', damage: DAMAGE.CHOKE },
    takedown: { winner: 'defender', damage: DAMAGE.TAKEDOWN },
    choke: { winner: 'none', damage: 0 },
    grapple: { winner: 'both', attackerDamage: DAMAGE.CHOKE, defenderHeal: DAMAGE.GRAPPLE_HEAL }
  },
  grapple: {
    strike: { winner: 'both', defenderDamage: DAMAGE.STRIKE, attackerHeal: DAMAGE.GRAPPLE_HEAL },
    takedown: { winner: 'both', defenderDamage: DAMAGE.TAKEDOWN, attackerHeal: DAMAGE.GRAPPLE_HEAL },
    choke: { winner: 'both', defenderDamage: DAMAGE.CHOKE, attackerHeal: DAMAGE.GRAPPLE_HEAL },
    grapple: { winner: 'stalemate', heal: DAMAGE.DOUBLE_GRAPPLE_HEAL }
  }
};

// GitHub repository base URL for fight images
// UPDATE THIS with your actual GitHub username and repo name after pushing images
const GITHUB_REPO = 'https://raw.githubusercontent.com/Moithas/Chat-Stock/main/assets/fight';

// GIF/Image URLs for successful moves (hosted on GitHub for reliability)
const GIFS = {
  strike: [
    `${GITHUB_REPO}/strike1.png`,
    `${GITHUB_REPO}/strike2.png`,
    `${GITHUB_REPO}/strike3.png`,
    `${GITHUB_REPO}/strike4.png`,
    `${GITHUB_REPO}/strike5.png`,
    `${GITHUB_REPO}/strike6.png`,
    `${GITHUB_REPO}/strike7.png`
  ],
  takedown: [
    `${GITHUB_REPO}/takedown1.png`,
    `${GITHUB_REPO}/takedown2.png`,
    `${GITHUB_REPO}/takedown3.png`,
    `${GITHUB_REPO}/takedown4.png`,
    `${GITHUB_REPO}/takedown5.png`,
    `${GITHUB_REPO}/takedown6.png`
  ],
  choke: [
    `${GITHUB_REPO}/choke1.png`,
    `${GITHUB_REPO}/choke2.png`,
    `${GITHUB_REPO}/choke3.png`,
    `${GITHUB_REPO}/choke4.png`,
    `${GITHUB_REPO}/choke5.png`,
    `${GITHUB_REPO}/choke6.png`
  ],
  doubleGrapple: [
    `${GITHUB_REPO}/doublegrapple1.png`,
    `${GITHUB_REPO}/doublegrapple2.png`
  ]
};

// Active fights (in-memory, keyed by guildId-fightId)
const activeFights = new Map();

// Pending challenges (in-memory, keyed by guildId-challengerId)
const pendingChallenges = new Map();

function initFight(database) {
  db = database;
  
  // Create fight settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS fight_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      house_cut_percent REAL DEFAULT 5,
      rematch_fights_required INTEGER DEFAULT 3,
      challenge_timeout_seconds INTEGER DEFAULT 30,
      spectator_bet_window_seconds INTEGER DEFAULT 60,
      round_time_seconds INTEGER DEFAULT 15,
      max_rounds INTEGER DEFAULT 20,
      grapple_cooldown INTEGER DEFAULT 1,
      tko_rounds INTEGER DEFAULT 3,
      draw_afk_rounds INTEGER DEFAULT 2,
      odds_min_fights INTEGER DEFAULT 5
    )
  `);
  
  // Create fighter stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS fighter_stats (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      total_earnings REAL DEFAULT 0,
      total_losses REAL DEFAULT 0,
      knockouts INTEGER DEFAULT 0,
      tkos INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create fight history table
  db.run(`
    CREATE TABLE IF NOT EXISTS fight_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      fighter1_id TEXT NOT NULL,
      fighter2_id TEXT NOT NULL,
      winner_id TEXT,
      loser_id TEXT,
      result_type TEXT NOT NULL,
      fighter1_final_hp INTEGER,
      fighter2_final_hp INTEGER,
      rounds INTEGER,
      bet_amount REAL,
      spectator_pool REAL DEFAULT 0,
      house_cut REAL DEFAULT 0,
      fought_at INTEGER NOT NULL
    )
  `);
  
  // Create opponent history table (for rematch cooldown)
  db.run(`
    CREATE TABLE IF NOT EXISTS fight_opponent_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      opponent_id TEXT NOT NULL,
      fought_at INTEGER NOT NULL
    )
  `);
  
  // Create spectator bets table
  db.run(`
    CREATE TABLE IF NOT EXISTS fight_spectator_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      fight_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      fighter_id TEXT NOT NULL,
      amount REAL NOT NULL,
      placed_at INTEGER NOT NULL
    )
  `);
  
  saveDatabase();
  console.log('🥊Fight system initialized');
}

// ==================== SETTINGS ====================

function getFightSettings(guildId) {
  if (!db) return { ...defaultSettings };
  
  const result = db.exec(`SELECT * FROM fight_settings WHERE guild_id = ?`, [guildId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return { ...defaultSettings };
  }
  
  const row = result[0].values[0];
  const cols = result[0].columns;
  const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  
  return {
    enabled: data.enabled === 1,
    houseCutPercent: data.house_cut_percent,
    rematchFightsRequired: data.rematch_fights_required,
    challengeTimeoutSeconds: data.challenge_timeout_seconds,
    spectatorBetWindowSeconds: data.spectator_bet_window_seconds,
    roundTimeSeconds: data.round_time_seconds,
    maxRounds: data.max_rounds,
    grappleCooldown: data.grapple_cooldown,
    tkoRounds: data.tko_rounds,
    drawAfkRounds: data.draw_afk_rounds,
    oddsMinFights: data.odds_min_fights
  };
}

function updateFightSettings(guildId, settings) {
  if (!db) return;
  
  db.run(`
    INSERT INTO fight_settings (
      guild_id, enabled, house_cut_percent, rematch_fights_required,
      challenge_timeout_seconds, spectator_bet_window_seconds, round_time_seconds,
      max_rounds, grapple_cooldown, tko_rounds, draw_afk_rounds, odds_min_fights
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled = excluded.enabled,
      house_cut_percent = excluded.house_cut_percent,
      rematch_fights_required = excluded.rematch_fights_required,
      challenge_timeout_seconds = excluded.challenge_timeout_seconds,
      spectator_bet_window_seconds = excluded.spectator_bet_window_seconds,
      round_time_seconds = excluded.round_time_seconds,
      max_rounds = excluded.max_rounds,
      grapple_cooldown = excluded.grapple_cooldown,
      tko_rounds = excluded.tko_rounds,
      draw_afk_rounds = excluded.draw_afk_rounds,
      odds_min_fights = excluded.odds_min_fights
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.houseCutPercent,
    settings.rematchFightsRequired,
    settings.challengeTimeoutSeconds,
    settings.spectatorBetWindowSeconds,
    settings.roundTimeSeconds,
    settings.maxRounds,
    settings.grappleCooldown,
    settings.tkoRounds,
    settings.drawAfkRounds,
    settings.oddsMinFights
  ]);
  
  saveDatabase();
}

// ==================== FIGHTER STATS ====================

function getFighterStats(guildId, userId) {
  if (!db) return { wins: 0, losses: 0, draws: 0, totalEarnings: 0, totalLosses: 0, knockouts: 0, tkos: 0 };
  
  const result = db.exec(`SELECT * FROM fighter_stats WHERE guild_id = ? AND user_id = ?`, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return { wins: 0, losses: 0, draws: 0, totalEarnings: 0, totalLosses: 0, knockouts: 0, tkos: 0 };
  }
  
  const row = result[0].values[0];
  const cols = result[0].columns;
  const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  
  return {
    wins: data.wins,
    losses: data.losses,
    draws: data.draws,
    totalEarnings: data.total_earnings,
    totalLosses: data.total_losses,
    knockouts: data.knockouts,
    tkos: data.tkos
  };
}

function updateFighterStats(guildId, oddsMinFights, winnerId, loserId, resultType, betAmount, isDraw = false, fighter1Id = null, fighter2Id = null) {
  if (!db) return;
  
  if (isDraw) {
    // Update both players with a draw - use fighter IDs since there's no winner/loser
    const fighters = [fighter1Id, fighter2Id].filter(id => id != null);
    for (const userId of fighters) {
      db.run(`
        INSERT INTO fighter_stats (guild_id, user_id, draws)
        VALUES (?, ?, 1)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          draws = draws + 1
      `, [guildId, userId]);
    }
  } else {
    // Update winner
    const koField = resultType === 'knockout' ? 'knockouts' : (resultType === 'tko' ? 'tkos' : null);
    
    db.run(`
      INSERT INTO fighter_stats (guild_id, user_id, wins, total_earnings${koField ? ', ' + koField : ''})
      VALUES (?, ?, 1, ?${koField ? ', 1' : ''})
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        wins = wins + 1,
        total_earnings = total_earnings + ?
        ${koField ? ', ' + koField + ' = ' + koField + ' + 1' : ''}
    `, [guildId, winnerId, betAmount, betAmount]);
    
    // Update loser
    db.run(`
      INSERT INTO fighter_stats (guild_id, user_id, losses, total_losses)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        losses = losses + 1,
        total_losses = total_losses + ?
    `, [guildId, loserId, betAmount, betAmount]);
  }
  
  saveDatabase();
}

function getTopFighters(guildId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM fighter_stats 
    WHERE guild_id = ? 
    ORDER BY wins DESC, (wins - losses) DESC
    LIMIT ?
  `, [guildId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// ==================== ODDS CALCULATION ====================

function calculateOdds(guildId, fighter1Id, fighter2Id) {
  const settings = getFightSettings(guildId);
  const stats1 = getFighterStats(guildId, fighter1Id);
  const stats2 = getFighterStats(guildId, fighter2Id);
  
  const totalFights1 = stats1.wins + stats1.losses + stats1.draws;
  const totalFights2 = stats2.wins + stats2.losses + stats2.draws;
  
  // If either fighter has less than minimum fights, return even odds
  if (totalFights1 < settings.oddsMinFights || totalFights2 < settings.oddsMinFights) {
    return {
      fighter1Odds: 1.0,
      fighter2Odds: 1.0,
      fighter1WinRate: 0.5,
      fighter2WinRate: 0.5,
      isEvenOdds: true
    };
  }
  
  // Calculate win rates
  const winRate1 = stats1.wins / Math.max(totalFights1, 1);
  const winRate2 = stats2.wins / Math.max(totalFights2, 1);
  
  // Calculate if both fighters have losing records
  const isLoser1 = winRate1 < 0.5;
  const isLoser2 = winRate2 < 0.5;
  const bothLosers = isLoser1 && isLoser2;
  
  // Normalize win rates to get implied probability
  const totalRate = winRate1 + winRate2;
  let prob1 = totalRate > 0 ? winRate1 / totalRate : 0.5;
  let prob2 = totalRate > 0 ? winRate2 / totalRate : 0.5;
  
  // Apply house overround (margin) - odds will imply probabilities that sum to >100%
  // Base margin: 10% (odds sum to ~110% implied probability)
  // When both are losers: 25% margin (heavily favor the house)
  const houseMargin = bothLosers ? 0.25 : 0.10;
  
  // Inflate probabilities by margin
  const marginFactor = 1 + houseMargin;
  prob1 = Math.min(prob1 * marginFactor, 0.95);
  prob2 = Math.min(prob2 * marginFactor, 0.95);
  
  // Convert probability to multiplier (inverse)
  // Higher probability = lower payout multiplier
  const maxMultiplier = 5.0;
  const minMultiplier = 1.05; // Slightly above 1x to ensure some profit potential
  
  let odds1 = prob1 > 0 ? Math.min(1 / prob1, maxMultiplier) : maxMultiplier;
  let odds2 = prob2 > 0 ? Math.min(1 / prob2, maxMultiplier) : maxMultiplier;
  
  // When both fighters are losers, cap max odds more aggressively
  // This prevents big payouts on "longshot" bets when everyone is bad
  if (bothLosers) {
    const loserMaxMultiplier = 2.0; // Cap at 2x when both are losers
    odds1 = Math.min(odds1, loserMaxMultiplier);
    odds2 = Math.min(odds2, loserMaxMultiplier);
  }
  
  // Ensure minimum payout
  odds1 = Math.max(odds1, minMultiplier);
  odds2 = Math.max(odds2, minMultiplier);
  
  // Calculate original (pre-margin) win rates for display
  const displayProb1 = totalRate > 0 ? winRate1 / totalRate : 0.5;
  const displayProb2 = totalRate > 0 ? winRate2 / totalRate : 0.5;
  
  return {
    fighter1Odds: Math.round(odds1 * 100) / 100,
    fighter2Odds: Math.round(odds2 * 100) / 100,
    fighter1WinRate: Math.round(displayProb1 * 100),
    fighter2WinRate: Math.round(displayProb2 * 100),
    isEvenOdds: false,
    bothLosers: bothLosers
  };
}

// ==================== REMATCH COOLDOWN ====================

function recordFight(guildId, fighter1Id, fighter2Id) {
  if (!db) return;
  
  const now = Date.now();
  
  // Record for both directions
  db.run(`
    INSERT INTO fight_opponent_history (guild_id, user_id, opponent_id, fought_at)
    VALUES (?, ?, ?, ?)
  `, [guildId, fighter1Id, fighter2Id, now]);
  
  db.run(`
    INSERT INTO fight_opponent_history (guild_id, user_id, opponent_id, fought_at)
    VALUES (?, ?, ?, ?)
  `, [guildId, fighter2Id, fighter1Id, now]);
  
  saveDatabase();
}

function canFightOpponent(guildId, userId, opponentId) {
  if (!db) return { canFight: true, fightsNeeded: 0 };
  
  const settings = getFightSettings(guildId);
  
  // Get the last time these two fought
  const lastFightResult = db.exec(`
    SELECT MAX(fought_at) as last_fight FROM fight_opponent_history
    WHERE guild_id = ? AND user_id = ? AND opponent_id = ?
  `, [guildId, userId, opponentId]);
  
  if (lastFightResult.length === 0 || !lastFightResult[0].values[0][0]) {
    return { canFight: true, fightsNeeded: 0 };
  }
  
  const lastFightTime = lastFightResult[0].values[0][0];
  
  // Count unique opponents fought since last fight with this opponent
  const uniqueOpponentsResult = db.exec(`
    SELECT COUNT(DISTINCT opponent_id) as count FROM fight_opponent_history
    WHERE guild_id = ? AND user_id = ? AND opponent_id != ? AND fought_at > ?
  `, [guildId, userId, opponentId, lastFightTime]);
  
  const uniqueOpponents = uniqueOpponentsResult[0]?.values[0][0] || 0;
  
  if (uniqueOpponents >= settings.rematchFightsRequired) {
    return { canFight: true, fightsNeeded: 0 };
  }
  
  return {
    canFight: false,
    fightsNeeded: settings.rematchFightsRequired - uniqueOpponents
  };
}

// ==================== ACTIVE FIGHTS ====================

function createFight(guildId, channelId, challenger, opponent, betAmount) {
  const fightId = `${guildId}-${Date.now()}`;
  
  const fight = {
    id: fightId,
    guildId,
    channelId,
    challenger: {
      id: challenger.id,
      username: challenger.username,
      displayName: challenger.displayName || challenger.username,
      avatarURL: challenger.avatarURL || (typeof challenger.displayAvatarURL === 'function' ? challenger.displayAvatarURL({ dynamic: true, size: 128 }) : null)
    },
    opponent: {
      id: opponent.id,
      username: opponent.username,
      displayName: opponent.displayName || opponent.username,
      avatarURL: opponent.avatarURL || (typeof opponent.displayAvatarURL === 'function' ? opponent.displayAvatarURL({ dynamic: true, size: 128 }) : null)
    },
    betAmount,
    status: 'pending',  // pending, betting, fighting, finished
    round: 0,
    maxRounds: getFightSettings(guildId).maxRounds,
    fighter1HP: 100,
    fighter2HP: 100,
    fighter1Move: null,
    fighter2Move: null,
    fighter1GrappleCooldown: 0,
    fighter2GrappleCooldown: 0,
    fighter1AfkStreak: 0,
    fighter2AfkStreak: 0,
    consecutiveDoubleAfk: 0,
    roundHistory: [],
    spectatorBets: [],
    publicMessageId: null,
    fighter1EphemeralMsg: null,
    fighter2EphemeralMsg: null,
    createdAt: Date.now()
  };
  
  activeFights.set(fightId, fight);
  return fight;
}

function getFight(fightId) {
  return activeFights.get(fightId);
}

function getFightByChannel(guildId, channelId) {
  for (const fight of activeFights.values()) {
    if (fight.guildId === guildId && fight.channelId === channelId && fight.status !== 'finished') {
      return fight;
    }
  }
  return null;
}

function getFightByFighter(guildId, oddsMinFights) {
  for (const fight of activeFights.values()) {
    if (fight.guildId === guildId && fight.status !== 'finished') {
      if (fight.challenger.id === oddsMinFights || fight.opponent.id === oddsMinFights) {
        return fight;
      }
    }
  }
  return null;
}

function deleteFight(fightId) {
  activeFights.delete(fightId);
}

// ==================== CHALLENGES ====================

function createChallenge(guildId, oddsMinFights, challengerObj, opponentObj, betAmount) {
  const key = `${guildId}-${oddsMinFights}`;
  
  const challenge = {
    guildId,
    oddsMinFights,
    challenger: challengerObj,
    opponent: opponentObj,
    betAmount,
    createdAt: Date.now()
  };
  
  pendingChallenges.set(key, challenge);
  return challenge;
}

function getChallenge(guildId, oddsMinFights) {
  return pendingChallenges.get(`${guildId}-${oddsMinFights}`);
}

function getChallengeForOpponent(guildId, opponentId) {
  for (const [key, challenge] of pendingChallenges.entries()) {
    if (challenge.guildId === guildId && challenge.opponent.id === opponentId) {
      return challenge;
    }
  }
  return null;
}

function deleteChallenge(guildId, oddsMinFights) {
  pendingChallenges.delete(`${guildId}-${oddsMinFights}`);
}

// ==================== SPECTATOR BETS ====================

function placeSpectatorBet(guildId, oddsMinFights, oddsMinFightsIdx, oddsMinFightsAmount, amount) {
  if (!db) return false;
  
  db.run(`
    INSERT INTO fight_spectator_bets (guild_id, fight_id, user_id, fighter_id, amount, placed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, oddsMinFights, oddsMinFightsIdx, oddsMinFightsAmount, amount, Date.now()]);
  
  saveDatabase();
  return true;
}

function getSpectatorBets(guildId, oddsMinFights) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM fight_spectator_bets WHERE guild_id = ? AND fight_id = ?
  `, [guildId, oddsMinFights]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getSpectatorBetTotals(guildId, fightId, fighter1Id, fighter2Id) {
  if (!db) return { fighter1Total: 0, fighter2Total: 0, fighter1Count: 0, fighter2Count: 0 };
  
  const result = db.exec(`
    SELECT fighter_id, SUM(amount) as total, COUNT(*) as count
    FROM fight_spectator_bets 
    WHERE guild_id = ? AND fight_id = ?
    GROUP BY fighter_id
  `, [guildId, fightId]);
  
  let fighter1Total = 0, fighter2Total = 0, fighter1Count = 0, fighter2Count = 0;
  
  if (result.length > 0) {
    for (const row of result[0].values) {
      const oddsMinFights = row[0];
      const total = row[1];
      const count = row[2];
      
      if (oddsMinFights === fighter1Id) {
        fighter1Total = total;
        fighter1Count = count;
      } else if (oddsMinFights === fighter2Id) {
        fighter2Total = total;
        fighter2Count = count;
      }
    }
  }
  
  return { fighter1Total, fighter2Total, fighter1Count, fighter2Count };
}

function clearSpectatorBets(guildId, oddsMinFights) {
  if (!db) return;
  db.run(`DELETE FROM fight_spectator_bets WHERE guild_id = ? AND fight_id = ?`, [guildId, oddsMinFights]);
  saveDatabase();
}

// ==================== FIGHT HISTORY ====================

function recordFightHistory(guildId, fighter1Id, fighter2Id, winnerId, loserId, resultType, fighter1FinalHp, fighter2FinalHp, rounds, betAmount, spectatorPool, houseCut) {
  if (!db) return;
  
  db.run(`
    INSERT INTO fight_history (
      guild_id, fighter1_id, fighter2_id, winner_id, loser_id, result_type,
      fighter1_final_hp, fighter2_final_hp, rounds, bet_amount, spectator_pool, house_cut, fought_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId, fighter1Id, fighter2Id, winnerId, loserId, resultType,
    fighter1FinalHp, fighter2FinalHp, rounds, betAmount, spectatorPool, houseCut, Date.now()
  ]);
  
  saveDatabase();
}

function getFightHistory(guildId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM fight_history WHERE guild_id = ? ORDER BY fought_at DESC LIMIT ?
  `, [guildId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// ==================== DAMAGE CALCULATION ====================

function calculateRoundResult(move1, move2) {
  // Handle timeout cases
  if (!move1 && !move2) {
    return { 
      type: 'double_timeout',
      fighter1Damage: 0,
      fighter2Damage: 0,
      fighter1Heal: 0,
      fighter2Heal: 0,
      description: 'Both fighters failed to respond!'
    };
  }
  
  if (!move1) {
    return {
      type: 'fighter1_timeout',
      fighter1Damage: getDamageForMove(move2),
      fighter2Damage: 0,
      fighter1Heal: 0,
      fighter2Heal: move2 === 'grapple' ? DAMAGE.GRAPPLE_HEAL : 0,
      winner: 'fighter2',
      winningMove: move2,
      description: `Fighter 1 failed to respond! Fighter 2's ${move2.toUpperCase()} lands!`
    };
  }
  
  if (!move2) {
    return {
      type: 'fighter2_timeout',
      fighter1Damage: 0,
      fighter2Damage: getDamageForMove(move1),
      fighter1Heal: move1 === 'grapple' ? DAMAGE.GRAPPLE_HEAL : 0,
      fighter2Heal: 0,
      winner: 'fighter1',
      winningMove: move1,
      description: `Fighter 2 failed to respond! Fighter 1's ${move1.toUpperCase()} lands!`
    };
  }
  
  const interaction = MOVE_MATRIX[move1][move2];
  
  if (interaction.winner === 'none') {
    return {
      type: 'clash',
      fighter1Damage: 0,
      fighter2Damage: 0,
      fighter1Heal: 0,
      fighter2Heal: 0,
      description: `Both fighters used ${move1.toUpperCase()}! No effect!`
    };
  }
  
  if (interaction.winner === 'stalemate') {
    return {
      type: 'stalemate',
      fighter1Damage: 0,
      fighter2Damage: 0,
      fighter1Heal: interaction.heal,
      fighter2Heal: interaction.heal,
      description: `Both fighters grapple! Each recovers ${interaction.heal}% health!`
    };
  }
  
  if (interaction.winner === 'both') {
    // One attacked, one grappled
    const attackerIsF1 = move1 !== 'grapple';
    
    if (attackerIsF1) {
      // Fighter 1 attacked, Fighter 2 grappled
      const netEffect = interaction.defenderHeal - interaction.attackerDamage;
      return {
        type: 'attack_vs_grapple',
        fighter1Damage: 0,
        fighter2Damage: interaction.attackerDamage,
        fighter1Heal: 0,
        fighter2Heal: interaction.defenderHeal,
        winner: 'fighter1',
        winningMove: move1,
        description: `${move1.toUpperCase()} hits for ${interaction.attackerDamage}%! Fighter 2 heals ${interaction.defenderHeal}% (net ${netEffect >= 0 ? '+' : ''}${netEffect}%)`
      };
    } else {
      // Fighter 2 attacked, Fighter 1 grappled
      const netEffect = interaction.attackerHeal - interaction.defenderDamage;
      return {
        type: 'attack_vs_grapple',
        fighter1Damage: interaction.defenderDamage,
        fighter2Damage: 0,
        fighter1Heal: interaction.attackerHeal,
        fighter2Heal: 0,
        winner: 'fighter2',
        winningMove: move2,
        description: `${move2.toUpperCase()} hits for ${interaction.defenderDamage}%! Fighter 1 heals ${interaction.attackerHeal}% (net ${netEffect >= 0 ? '+' : ''}${netEffect}%)`
      };
    }
  }
  
  if (interaction.winner === 'attacker') {
    return {
      type: 'attack',
      fighter1Damage: 0,
      fighter2Damage: interaction.damage,
      fighter1Heal: 0,
      fighter2Heal: 0,
      winner: 'fighter1',
      winningMove: move1,
      description: `${move1.toUpperCase()} beats ${move2.toUpperCase()}! Fighter 2 takes ${interaction.damage}% damage!`
    };
  }
  
  if (interaction.winner === 'defender') {
    return {
      type: 'attack',
      fighter1Damage: interaction.damage,
      fighter2Damage: 0,
      fighter1Heal: 0,
      fighter2Heal: 0,
      winner: 'fighter2',
      winningMove: move2,
      description: `${move2.toUpperCase()} beats ${move1.toUpperCase()}! Fighter 1 takes ${interaction.damage}% damage!`
    };
  }
  
  return {
    type: 'unknown',
    fighter1Damage: 0,
    fighter2Damage: 0,
    fighter1Heal: 0,
    fighter2Heal: 0,
    description: 'Unknown interaction!'
  };
}

function getDamageForMove(move) {
  switch (move) {
    case 'strike': return DAMAGE.STRIKE;
    case 'takedown': return DAMAGE.TAKEDOWN;
    case 'choke': return DAMAGE.CHOKE;
    case 'grapple': return 0;
    default: return 0;
  }
}

function getRandomGif(moveType) {
  const gifs = GIFS[moveType];
  if (!gifs || gifs.length === 0) return null;
  return gifs[Math.floor(Math.random() * gifs.length)];
}

// ==================== HEALTH BAR ====================

function createHealthBar(hp, maxHp = 100, length = 10) {
  const filledCount = Math.round((hp / maxHp) * length);
  const emptyCount = length - filledCount;
  
  let color;
  if (hp > 60) color = '🟩';
  else if (hp > 30) color = '🟨';
  else color = '🟥';
  
  return color.repeat(filledCount) + '⬛'.repeat(emptyCount);
}

// ==================== RESET ALL STATS ====================

function resetAllFighterStats(guildId) {
  if (!db) return false;
  
  // Delete all fighter stats for this guild
  db.run(`DELETE FROM fighter_stats WHERE guild_id = ?`, [guildId]);
  
  // Delete all fight history for this guild
  db.run(`DELETE FROM fight_history WHERE guild_id = ?`, [guildId]);
  
  // Delete all opponent history for this guild
  db.run(`DELETE FROM fight_opponent_history WHERE guild_id = ?`, [guildId]);
  
  // Delete all spectator bets for this guild (shouldn't have any lingering but just in case)
  db.run(`DELETE FROM fight_spectator_bets WHERE guild_id = ?`, [guildId]);
  
  saveDatabase();
  return true;
}

module.exports = {
  initFight,
  getFightSettings,
  updateFightSettings,
  getFighterStats,
  updateFighterStats,
  getTopFighters,
  calculateOdds,
  recordFight,
  canFightOpponent,
  createFight,
  getFight,
  getFightByChannel,
  getFightByFighter,
  deleteFight,
  createChallenge,
  getChallenge,
  getChallengeForOpponent,
  deleteChallenge,
  placeSpectatorBet,
  getSpectatorBets,
  getSpectatorBetTotals,
  clearSpectatorBets,
  recordFightHistory,
  getFightHistory,
  calculateRoundResult,
  getRandomGif,
  createHealthBar,
  resetAllFighterStats,
  DAMAGE,
  GIFS,
  activeFights,
  pendingChallenges
};
