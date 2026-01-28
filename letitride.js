// Let It Ride Card Game Module
// Classic poker variant - player vs house

let db = null;
let forceEnabledOnStartup = true; // Flag to force enable on first settings access

// Card constants
const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  minBet: 1000,
  maxBet: 100000,
  timerSeconds: 15
};

// Standard payout table (multiplier for EACH remaining bet)
const PAYOUT_TABLE = {
  'Royal Flush': 1000,
  'Straight Flush': 200,
  'Four of a Kind': 50,
  'Full House': 11,
  'Flush': 8,
  'Straight': 5,
  'Three of a Kind': 3,
  'Two Pair': 2,
  'Pair (10s or Better)': 1,
  'No Win': 0
};

// In-memory caches
const guildSettings = new Map();
const activeGames = new Map(); // visually userId -> game state

function initialize(database) {
  db = database;
  
  // Create settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS letitride_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      min_bet INTEGER DEFAULT 1000,
      max_bet INTEGER DEFAULT 100000,
      timer_seconds INTEGER DEFAULT 15
    )
  `);
  
  // Create stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS letitride_stats (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      games_played INTEGER DEFAULT 0,
      total_wagered INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      total_lost INTEGER DEFAULT 0,
      royal_flushes INTEGER DEFAULT 0,
      straight_flushes INTEGER DEFAULT 0,
      four_of_a_kinds INTEGER DEFAULT 0,
      full_houses INTEGER DEFAULT 0,
      flushes INTEGER DEFAULT 0,
      straights INTEGER DEFAULT 0,
      three_of_a_kinds INTEGER DEFAULT 0,
      two_pairs INTEGER DEFAULT 0,
      high_pairs INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create history table
  db.run(`
    CREATE TABLE IF NOT EXISTS letitride_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bet_amount INTEGER NOT NULL,
      bets_remaining INTEGER NOT NULL,
      hand_rank TEXT NOT NULL,
      payout INTEGER NOT NULL,
      cards TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
  
  // Clear any stale cache entries
  guildSettings.clear();
  
  // Enable the game by default on startup
  try {
    db.run(`UPDATE letitride_settings SET enabled = 1`);
    console.log('🎰 Let It Ride: Force-enabled all existing settings');
  } catch (err) {
    console.error('🎰 Let It Ride: Error enabling on startup:', err);
  }
  
  console.log('🎰 Let It Ride system initialized');
}

function getSettings(guildId) {
  if (guildSettings.has(guildId)) {
    const cached = guildSettings.get(guildId);
    // Ensure cached settings have all required fields
    if (cached.minBet !== undefined && cached.maxBet !== undefined) {
      return cached;
    }
    // Cache is incomplete, clear it and re-fetch
    guildSettings.delete(guildId);
  }
  
  // Return defaults if database not initialized
  if (!db) {
    return { ...DEFAULT_SETTINGS };
  }
  
  const row = db.prepare('SELECT * FROM letitride_settings WHERE guild_id = ?').get(guildId);
  
  if (row) {
    // Always use defaults for any missing/null values
    let enabled = row.enabled !== null ? !!row.enabled : DEFAULT_SETTINGS.enabled;
    
    // Force enable on first access after bot startup
    if (forceEnabledOnStartup && !enabled) {
      console.log('[Let It Ride] Force-enabling game on first access after startup');
      enabled = true;
      // Update the database too
      db.run(`UPDATE letitride_settings SET enabled = 1 WHERE guild_id = ?`, [guildId]);
      forceEnabledOnStartup = false; // Only do this once per restart
    }
    
    const settings = {
      enabled: enabled,
      minBet: row.min_bet ?? DEFAULT_SETTINGS.minBet,
      maxBet: row.max_bet ?? DEFAULT_SETTINGS.maxBet,
      timerSeconds: row.timer_seconds ?? DEFAULT_SETTINGS.timerSeconds
    };
    guildSettings.set(guildId, settings);
    return settings;
  }
  
  // Insert default settings (enabled by default)
  const settings = { ...DEFAULT_SETTINGS };
  db.run(`
    INSERT INTO letitride_settings (guild_id, enabled, min_bet, max_bet, timer_seconds)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, settings.enabled ? 1 : 0, settings.minBet, settings.maxBet, settings.timerSeconds]);
  
  guildSettings.set(guildId, settings);
  forceEnabledOnStartup = false; // Clear flag after first settings access
  return settings;
}

function updateSettings(guildId, updates) {
  // Get current settings (from cache or DB)
  const currentSettings = getSettings(guildId);
  
  // Create a new settings object with updates applied, using defaults as fallback
  const settings = {
    enabled: updates.enabled !== undefined ? updates.enabled : (currentSettings.enabled ?? DEFAULT_SETTINGS.enabled),
    minBet: updates.minBet !== undefined ? updates.minBet : (currentSettings.minBet ?? DEFAULT_SETTINGS.minBet),
    maxBet: updates.maxBet !== undefined ? updates.maxBet : (currentSettings.maxBet ?? DEFAULT_SETTINGS.maxBet),
    timerSeconds: updates.timerSeconds !== undefined ? updates.timerSeconds : (currentSettings.timerSeconds ?? DEFAULT_SETTINGS.timerSeconds)
  };
  
  console.log(`[Let It Ride] updateSettings: enabled=${settings.enabled}, minBet=${settings.minBet}`);
  
  // Use INSERT OR REPLACE to handle case where row doesn't exist yet
  db.run(`
    INSERT OR REPLACE INTO letitride_settings 
    (guild_id, enabled, min_bet, max_bet, timer_seconds)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, settings.enabled ? 1 : 0, settings.minBet, settings.maxBet, settings.timerSeconds]);
  
  // Update cache with new settings object
  guildSettings.set(guildId, settings);
  return settings;
}

function clearSettingsCache(guildId) {
  guildSettings.delete(guildId);
}

// ============ DECK FUNCTIONS ============

function createDeck() {
  const deck = [];
  for (const suit of SUIT_NAMES) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ============ HAND EVALUATION ============

function getCardValue(card) {
  const rankValues = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return rankValues[card.rank];
}

function evaluateHand(cards) {
  // Sort cards by value (high to low)
  const sorted = [...cards].sort((a, b) => getCardValue(b) - getCardValue(a));
  const values = sorted.map(c => getCardValue(c));
  const suits = sorted.map(c => c.suit);
  
  // Check for flush
  const isFlush = suits.every(s => s === suits[0]);
  
  // Check for straight
  let isStraight = false;
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 5) {
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    if (maxVal - minVal === 4) {
      isStraight = true;
    }
    // Check for A-2-3-4-5 (wheel)
    if (values.includes(14) && values.includes(2) && values.includes(3) && values.includes(4) && values.includes(5)) {
      isStraight = true;
    }
  }
  
  // Count ranks
  const rankCounts = {};
  for (const val of values) {
    rankCounts[val] = (rankCounts[val] || 0) + 1;
  }
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  
  // Determine hand rank
  if (isFlush && isStraight) {
    if (values.includes(14) && values.includes(13) && values.includes(12) && values.includes(11) && values.includes(10)) {
      return { rank: 'Royal Flush', payout: PAYOUT_TABLE['Royal Flush'], cards: sorted };
    }
    return { rank: 'Straight Flush', payout: PAYOUT_TABLE['Straight Flush'], cards: sorted };
  }
  
  if (counts[0] === 4) {
    return { rank: 'Four of a Kind', payout: PAYOUT_TABLE['Four of a Kind'], cards: sorted };
  }
  
  if (counts[0] === 3 && counts[1] === 2) {
    return { rank: 'Full House', payout: PAYOUT_TABLE['Full House'], cards: sorted };
  }
  
  if (isFlush) {
    return { rank: 'Flush', payout: PAYOUT_TABLE['Flush'], cards: sorted };
  }
  
  if (isStraight) {
    return { rank: 'Straight', payout: PAYOUT_TABLE['Straight'], cards: sorted };
  }
  
  if (counts[0] === 3) {
    return { rank: 'Three of a Kind', payout: PAYOUT_TABLE['Three of a Kind'], cards: sorted };
  }
  
  if (counts[0] === 2 && counts[1] === 2) {
    return { rank: 'Two Pair', payout: PAYOUT_TABLE['Two Pair'], cards: sorted };
  }
  
  if (counts[0] === 2) {
    // Find the pair value
    const pairValue = parseInt(Object.keys(rankCounts).find(k => rankCounts[k] === 2));
    if (pairValue >= 10) {
      return { rank: 'Pair (10s or Better)', payout: PAYOUT_TABLE['Pair (10s or Better)'], cards: sorted };
    }
  }
  
  return { rank: 'No Win', payout: 0, cards: sorted };
}

// ============ GAME FUNCTIONS ============

function hasActiveGame(userId) {
  return activeGames.has(userId);
}

function getActiveGame(userId) {
  return activeGames.get(userId);
}

function startGame(guildId, userId, username, betAmount) {
  const deck = shuffleDeck(createDeck());
  
  // Deal 3 cards to player, 2 community cards (face down initially)
  const playerCards = [deck.pop(), deck.pop(), deck.pop()];
  const communityCards = [deck.pop(), deck.pop()];
  
  const game = {
    guildId,
    userId,
    username,
    betAmount, // Amount per bet spot
    deck,
    playerCards,       // Player's 3 cards (always visible)
    communityCards,    // 2 community cards
    revealedCommunity: 0, // 0 = none, 1 = first revealed, 2 = both revealed
    betsRemaining: 3,  // Start with 3 bets (can pull back to min of 1)
    bet1: true,        // First bet - can be pulled back after seeing 3 cards
    bet2: true,        // Second bet - can be pulled back after first community
    bet3: true,        // Third bet - always stays (required)
    status: 'decision_1', // decision_1, decision_2, resolved
    result: null,
    payout: 0,
    startTime: Date.now(),
    messageId: null,
    channelId: null,
    timer: null
  };
  
  activeGames.set(userId, game);
  return game;
}

function pullBackBet(userId, betNumber) {
  const game = activeGames.get(userId);
  if (!game) return null;
  
  if (betNumber === 1 && game.status === 'decision_1' && game.bet1) {
    game.bet1 = false;
    game.betsRemaining = 2;
    // Move to reveal first community card
    game.revealedCommunity = 1;
    game.status = 'decision_2';
    return game;
  }
  
  if (betNumber === 2 && game.status === 'decision_2' && game.bet2) {
    game.bet2 = false;
    game.betsRemaining = game.bet1 ? 2 : 1;
    // Reveal second community card and resolve
    game.revealedCommunity = 2;
    return resolveGame(game);
  }
  
  return null;
}

function letItRide(userId) {
  const game = activeGames.get(userId);
  if (!game) return null;
  
  if (game.status === 'decision_1') {
    // Keep bet 1, reveal first community card
    game.revealedCommunity = 1;
    game.status = 'decision_2';
    return game;
  }
  
  if (game.status === 'decision_2') {
    // Keep bet 2, reveal second community and resolve
    game.revealedCommunity = 2;
    return resolveGame(game);
  }
  
  return null;
}

function resolveGame(game) {
  // Combine player cards with community cards for final 5-card hand
  const finalHand = [...game.playerCards, ...game.communityCards];
  const handResult = evaluateHand(finalHand);
  
  game.result = handResult;
  game.status = 'resolved';
  
  // Calculate payout based on remaining bets
  const activeBets = (game.bet1 ? 1 : 0) + (game.bet2 ? 1 : 0) + 1; // bet3 always active
  game.betsRemaining = activeBets;
  
  if (handResult.payout > 0) {
    // Win! Payout is multiplier * bet * number of active bets
    game.payout = handResult.payout * game.betAmount * activeBets;
  } else {
    // Lose all active bets
    game.payout = -(game.betAmount * activeBets);
  }
  
  return game;
}

function endGame(userId) {
  const game = activeGames.get(userId);
  if (!game) return null;
  
  console.log(`[Let It Ride] endGame: userId=${userId}, guildId=${game.guildId}, status=${game.status}`);
  
  // Clear timer
  if (game.timer) {
    clearTimeout(game.timer);
  }
  
  // Record history
  recordHistory(game);
  
  // Update stats
  updateStats(game);
  
  // Remove from active games
  activeGames.delete(userId);
  
  return game;
}

function forceEndGame(userId, reason = 'timeout') {
  const game = activeGames.get(userId);
  if (!game) return null;
  
  // Clear timer
  if (game.timer) {
    clearTimeout(game.timer);
  }
  
  // If not resolved, auto let-it-ride to finish
  while (game.status !== 'resolved') {
    letItRide(userId);
  }
  
  game.timeoutReason = reason;
  
  // Record and cleanup
  recordHistory(game);
  updateStats(game);
  activeGames.delete(userId);
  
  return game;
}

function setGameMessage(userId, messageId, channelId) {
  const game = activeGames.get(userId);
  if (game) {
    game.messageId = messageId;
    game.channelId = channelId;
  }
}

function setGameTimer(userId, callback, timeoutMs) {
  const game = activeGames.get(userId);
  if (game) {
    if (game.timer) {
      clearTimeout(game.timer);
    }
    game.timer = setTimeout(callback, timeoutMs);
  }
}

// ============ STATS FUNCTIONS ============

function updateStats(game) {
  if (!db || !game) return;
  
  const { guildId, userId, betAmount, betsRemaining, result, payout } = game;
  
  // Ensure required fields exist
  if (!guildId || !userId) {
    console.error('[Let It Ride] updateStats: Missing guildId or userId', { guildId, userId });
    return;
  }
  
  // Calculate total wagered (bet amount * number of bets that stayed in)
  const totalWagered = betAmount * betsRemaining;
  let totalWon = 0;
  let totalLost = 0;
  
  if (payout > 0) {
    totalWon = payout;
  } else {
    totalLost = Math.abs(payout);
  }
  
  // Determine hand type for stat tracking
  const handRank = result ? result.rank : 'No Win';
  
  try {
    db.run(`
      INSERT INTO letitride_stats (guild_id, user_id, games_played, total_wagered, total_won, total_lost)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        games_played = games_played + 1,
        total_wagered = total_wagered + excluded.total_wagered,
        total_won = total_won + excluded.total_won,
        total_lost = total_lost + excluded.total_lost
    `, [guildId, userId, totalWagered, totalWon, totalLost]);
    
    // Update hand-specific counters
    const handColumns = {
      'Royal Flush': 'royal_flushes',
      'Straight Flush': 'straight_flushes',
      'Four of a Kind': 'four_of_a_kinds',
      'Full House': 'full_houses',
      'Flush': 'flushes',
      'Straight': 'straights',
      'Three of a Kind': 'three_of_a_kinds',
      'Two Pair': 'two_pairs',
      'Pair (10s or Better)': 'high_pairs'
    };
    
    if (handColumns[handRank]) {
      db.run(`
        UPDATE letitride_stats 
        SET ${handColumns[handRank]} = ${handColumns[handRank]} + 1
        WHERE guild_id = ? AND user_id = ?
      `, [guildId, userId]);
    }
  } catch (err) {
    console.error('[Let It Ride] Error updating stats:', err.message);
  }
}

function recordHistory(game) {
  if (!db || !game || !game.result) return;
  
  // Ensure required fields exist
  if (!game.guildId || !game.userId) {
    console.error('[Let It Ride] recordHistory: Missing guildId or userId', { 
      guildId: game.guildId, 
      userId: game.userId 
    });
    return;
  }
  
  const cardsJson = JSON.stringify([...game.playerCards, ...game.communityCards]);
  
  try {
    db.run(`
      INSERT INTO letitride_history 
      (guild_id, user_id, bet_amount, bets_remaining, hand_rank, payout, cards, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      game.guildId,
      game.userId,
      game.betAmount,
      game.betsRemaining,
      game.result.rank,
      game.payout,
      cardsJson,
      Date.now()
    ]);
  } catch (err) {
    console.error('[Let It Ride] Error recording history:', err.message);
  }
}

function getStats(guildId, userId) {
  if (!db) return null;
  
  return db.prepare(`
    SELECT * FROM letitride_stats WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);
}

// ============ UTILITY FUNCTIONS ============

function formatCard(card) {
  const suitSymbols = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
  return `${card.rank}${suitSymbols[card.suit]}`;
}

function getPayoutTable() {
  return PAYOUT_TABLE;
}

module.exports = {
  initialize,
  getSettings,
  updateSettings,
  clearSettingsCache,
  hasActiveGame,
  getActiveGame,
  startGame,
  pullBackBet,
  letItRide,
  endGame,
  forceEndGame,
  setGameMessage,
  setGameTimer,
  getStats,
  formatCard,
  getPayoutTable,
  evaluateHand,
  PAYOUT_TABLE
};
