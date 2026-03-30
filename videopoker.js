// Video Poker game module for Chat-Stock
// Supports Jacks or Better, Deuces Wild, Bonus Poker

const { TTLCache } = require('./cache');

let db = null;

// Card constants
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const DEFAULT_SETTINGS = {
  enabled: true,
  minBet: 100,
  maxBet: 1000000,
  timerSeconds: 30
};

// ============ PAY TABLES ============

const PAY_TABLES = {
  'jacks_or_better': {
    name: 'Jacks or Better',
    emoji: '👑',
    hands: {
      'Royal Flush':     250,
      'Straight Flush':  50,
      'Four of a Kind':  25,
      'Full House':      9,
      'Flush':           6,
      'Straight':        4,
      'Three of a Kind': 3,
      'Two Pair':        2,
      'Jacks or Better': 1
    }
  },
  'deuces_wild': {
    name: 'Deuces Wild',
    emoji: '🃏',
    hands: {
      'Natural Royal Flush': 250,
      'Four Deuces':         200,
      'Wild Royal Flush':    25,
      'Five of a Kind':      15,
      'Straight Flush':      9,
      'Four of a Kind':      5,
      'Full House':          3,
      'Flush':               2,
      'Straight':            2,
      'Three of a Kind':     1
    }
  },
  'bonus_poker': {
    name: 'Bonus Poker',
    emoji: '💎',
    hands: {
      'Royal Flush':          250,
      'Straight Flush':       50,
      'Four Aces':            80,
      'Four 2s-4s':           40,
      'Four 5s-Ks':           25,
      'Full House':           8,
      'Flush':                5,
      'Straight':             4,
      'Three of a Kind':      3,
      'Two Pair':             2,
      'Jacks or Better':      1
    }
  }
};

// In-memory caches
const guildSettings = new TTLCache();
const activeGames = new Map();

// ============ INITIALIZATION ============

function initialize(database) {
  db = database;

  db.run(`
    CREATE TABLE IF NOT EXISTS videopoker_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      min_bet INTEGER DEFAULT 100,
      max_bet INTEGER DEFAULT 1000000,
      timer_seconds INTEGER DEFAULT 30
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS videopoker_stats (
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
      jacks_or_better INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS videopoker_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      bet_amount INTEGER NOT NULL,
      hand_rank TEXT NOT NULL,
      payout INTEGER NOT NULL,
      initial_cards TEXT NOT NULL,
      final_cards TEXT NOT NULL,
      held TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  guildSettings.clear();
  console.log('🎰 Video Poker system initialized');
}

// ============ SETTINGS ============

function getSettings(guildId) {
  if (guildSettings.has(guildId)) {
    const cached = guildSettings.get(guildId);
    if (cached.minBet !== undefined && cached.maxBet !== undefined) {
      return cached;
    }
    guildSettings.delete(guildId);
  }

  if (!db) return { ...DEFAULT_SETTINGS };

  const stmt = db.prepare('SELECT * FROM videopoker_settings WHERE guild_id = ?');
  stmt.bind([guildId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    const settings = {
      enabled: row.enabled !== null ? !!row.enabled : DEFAULT_SETTINGS.enabled,
      minBet: row.min_bet ?? DEFAULT_SETTINGS.minBet,
      maxBet: row.max_bet ?? DEFAULT_SETTINGS.maxBet,
      timerSeconds: row.timer_seconds ?? DEFAULT_SETTINGS.timerSeconds
    };
    guildSettings.set(guildId, settings);
    return settings;
  }
  stmt.free();

  const settings = { ...DEFAULT_SETTINGS };
  db.run(`
    INSERT INTO videopoker_settings (guild_id, enabled, min_bet, max_bet, timer_seconds)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, settings.enabled ? 1 : 0, settings.minBet, settings.maxBet, settings.timerSeconds]);

  guildSettings.set(guildId, settings);
  return settings;
}

function updateSettings(guildId, updates) {
  const currentSettings = getSettings(guildId);
  const settings = {
    enabled: updates.enabled !== undefined ? updates.enabled : currentSettings.enabled,
    minBet: updates.minBet !== undefined ? updates.minBet : currentSettings.minBet,
    maxBet: updates.maxBet !== undefined ? updates.maxBet : currentSettings.maxBet,
    timerSeconds: updates.timerSeconds !== undefined ? updates.timerSeconds : currentSettings.timerSeconds
  };

  db.run(`
    INSERT OR REPLACE INTO videopoker_settings 
    (guild_id, enabled, min_bet, max_bet, timer_seconds)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, settings.enabled ? 1 : 0, settings.minBet, settings.maxBet, settings.timerSeconds]);

  guildSettings.set(guildId, settings);
  return settings;
}

function clearSettingsCache(guildId) {
  if (guildId) guildSettings.delete(guildId);
  else guildSettings.clear();
}

// ============ DECK FUNCTIONS ============

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
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

function evaluateStandardHand(cards) {
  const sorted = [...cards].sort((a, b) => getCardValue(b) - getCardValue(a));
  const values = sorted.map(c => getCardValue(c));
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = false;
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 5) {
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    if (maxVal - minVal === 4) isStraight = true;
    // A-2-3-4-5 wheel
    if (values.includes(14) && values.includes(2) && values.includes(3) && values.includes(4) && values.includes(5)) {
      isStraight = true;
    }
  }

  const rankCounts = {};
  for (const val of values) {
    rankCounts[val] = (rankCounts[val] || 0) + 1;
  }
  const counts = Object.values(rankCounts).sort((a, b) => b - a);

  if (isFlush && isStraight && values.includes(14) && values.includes(13)) return 'Royal Flush';
  if (isFlush && isStraight) return 'Straight Flush';
  if (counts[0] === 4) return 'Four of a Kind';
  if (counts[0] === 3 && counts[1] === 2) return 'Full House';
  if (isFlush) return 'Flush';
  if (isStraight) return 'Straight';
  if (counts[0] === 3) return 'Three of a Kind';
  if (counts[0] === 2 && counts[1] === 2) return 'Two Pair';
  if (counts[0] === 2) {
    const pairValue = parseInt(Object.keys(rankCounts).find(k => rankCounts[k] === 2));
    if (pairValue >= 11) return 'Jacks or Better'; // J, Q, K, A
    return 'Low Pair';
  }
  return 'High Card';
}

function evaluateJacksOrBetter(cards) {
  const rank = evaluateStandardHand(cards);
  const payTable = PAY_TABLES['jacks_or_better'].hands;
  if (payTable[rank] !== undefined) return { rank, payout: payTable[rank] };
  return { rank: 'No Win', payout: 0 };
}

function evaluateDeucesWild(cards) {
  const numDeuces = cards.filter(c => c.rank === '2').length;
  const nonWild = cards.filter(c => c.rank !== '2');

  // No wilds — evaluate normally but check for Natural Royal
  if (numDeuces === 0) {
    const rank = evaluateStandardHand(cards);
    if (rank === 'Royal Flush') return { rank: 'Natural Royal Flush', payout: PAY_TABLES['deuces_wild'].hands['Natural Royal Flush'] };
    const payTable = PAY_TABLES['deuces_wild'].hands;
    if (payTable[rank] !== undefined) return { rank, payout: payTable[rank] };
    return { rank: 'No Win', payout: 0 };
  }

  // With wilds — try all possible replacements to find best hand
  const bestRank = findBestDeucesWildHand(nonWild, numDeuces);
  return bestRank;
}

function findBestDeucesWildHand(nonWild, numDeuces) {
  // For efficiency, evaluate by checking possible hand ranks top-down
  const values = nonWild.map(c => getCardValue(c));
  const suits = nonWild.map(c => c.suit);
  const totalCards = nonWild.length + numDeuces; // should be 5

  const rankCounts = {};
  for (const val of values) {
    rankCounts[val] = (rankCounts[val] || 0) + 1;
  }
  const countsArr = Object.values(rankCounts).sort((a, b) => b - a);
  const maxOfAKind = (countsArr[0] || 0) + numDeuces;

  const payTable = PAY_TABLES['deuces_wild'].hands;

  // Four Deuces
  if (numDeuces === 4) return { rank: 'Four Deuces', payout: payTable['Four Deuces'] };

  // Five of a Kind (4 of same + wild, or 3 + 2 wilds, etc.)
  if (maxOfAKind >= 5) return { rank: 'Five of a Kind', payout: payTable['Five of a Kind'] };

  // Check for Royal Flush with wilds
  if (canMakeRoyalFlush(nonWild, numDeuces)) {
    return { rank: 'Wild Royal Flush', payout: payTable['Wild Royal Flush'] };
  }

  // Check for Straight Flush with wilds
  if (canMakeStraightFlush(nonWild, numDeuces)) {
    return { rank: 'Straight Flush', payout: payTable['Straight Flush'] };
  }

  // Four of a Kind
  if (maxOfAKind >= 4) return { rank: 'Four of a Kind', payout: payTable['Four of a Kind'] };

  // Full House
  if (numDeuces >= 1 && countsArr[0] === 2 && countsArr[1] === 2) {
    return { rank: 'Full House', payout: payTable['Full House'] };
  }
  if (countsArr[0] + numDeuces >= 3 && countsArr.length >= 2 && nonWild.length >= 4) {
    // 3+2 possible?
    const needForTrips = 3 - (countsArr[0] || 0);
    const remainingWilds = numDeuces - Math.max(0, needForTrips);
    if (remainingWilds >= 0 && countsArr[1] >= 2) {
      return { rank: 'Full House', payout: payTable['Full House'] };
    }
  }

  // Flush with wilds
  if (canMakeFlush(nonWild, numDeuces)) {
    return { rank: 'Flush', payout: payTable['Flush'] };
  }

  // Straight with wilds
  if (canMakeStraight(nonWild, numDeuces)) {
    return { rank: 'Straight', payout: payTable['Straight'] };
  }

  // Three of a Kind
  if (maxOfAKind >= 3) return { rank: 'Three of a Kind', payout: payTable['Three of a Kind'] };

  return { rank: 'No Win', payout: 0 };
}

function canMakeRoyalFlush(nonWild, numDeuces) {
  // All non-wild cards must be same suit and in {10, J, Q, K, A}
  if (nonWild.length === 0) return numDeuces >= 5;
  const royalValues = [10, 11, 12, 13, 14];
  const suit = nonWild[0].suit;
  if (!nonWild.every(c => c.suit === suit)) return false;
  if (!nonWild.every(c => royalValues.includes(getCardValue(c)))) return false;
  const uniqueRoyals = new Set(nonWild.map(c => getCardValue(c)));
  return uniqueRoyals.size === nonWild.length; // no duplicates within royal values
}

function canMakeStraightFlush(nonWild, numDeuces) {
  if (nonWild.length === 0) return numDeuces >= 5;
  // All non-wild must be same suit
  const suit = nonWild[0].suit;
  if (!nonWild.every(c => c.suit === suit)) return false;

  return canMakeStraight(nonWild, numDeuces);
}

function canMakeFlush(nonWild, numDeuces) {
  if (nonWild.length === 0) return numDeuces >= 5;
  const suit = nonWild[0].suit;
  return nonWild.every(c => c.suit === suit);
}

function canMakeStraight(nonWild, numDeuces) {
  if (nonWild.length === 0) return numDeuces >= 5;
  const values = [...new Set(nonWild.map(c => getCardValue(c)))];
  if (values.length !== nonWild.length) return false; // duplicates can't make straight

  // Try all possible 5-card straight windows
  // Normal straights: low card from 2 to 10
  for (let low = 2; low <= 10; low++) {
    const needed = [];
    for (let v = low; v < low + 5; v++) {
      if (!values.includes(v)) needed.push(v);
    }
    if (needed.length <= numDeuces) return true;
  }
  // A-2-3-4-5 wheel
  const wheelValues = [14, 2, 3, 4, 5];
  const wheelNeeded = wheelValues.filter(v => !values.includes(v));
  if (wheelNeeded.length <= numDeuces) return true;

  return false;
}

function evaluateBonusPoker(cards) {
  const rank = evaluateStandardHand(cards);
  const payTable = PAY_TABLES['bonus_poker'].hands;

  // Special handling for Four of a Kind variants
  if (rank === 'Four of a Kind') {
    const values = cards.map(c => getCardValue(c));
    const rankCounts = {};
    for (const val of values) {
      rankCounts[val] = (rankCounts[val] || 0) + 1;
    }
    const quadValue = parseInt(Object.keys(rankCounts).find(k => rankCounts[k] === 4));

    if (quadValue === 14) return { rank: 'Four Aces', payout: payTable['Four Aces'] };
    if (quadValue >= 2 && quadValue <= 4) return { rank: 'Four 2s-4s', payout: payTable['Four 2s-4s'] };
    return { rank: 'Four 5s-Ks', payout: payTable['Four 5s-Ks'] };
  }

  if (payTable[rank] !== undefined) return { rank, payout: payTable[rank] };
  return { rank: 'No Win', payout: 0 };
}

function evaluateHand(cards, variant) {
  switch (variant) {
    case 'jacks_or_better': return evaluateJacksOrBetter(cards);
    case 'deuces_wild': return evaluateDeucesWild(cards);
    case 'bonus_poker': return evaluateBonusPoker(cards);
    default: return evaluateJacksOrBetter(cards);
  }
}

// ============ GAME STATE MANAGEMENT ============

function hasActiveGame(guildId, userId) {
  return activeGames.has(`${guildId}_${userId}`);
}

function getActiveGame(guildId, userId) {
  return activeGames.get(`${guildId}_${userId}`);
}

function startGame(guildId, userId, username, betAmount, variant) {
  const deck = shuffleDeck(createDeck());

  const hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

  const game = {
    guildId,
    userId,
    username,
    betAmount,
    variant,
    deck,
    initialHand: hand.map(c => ({ ...c })),
    hand,
    held: [false, false, false, false, false],
    phase: 'hold', // hold -> resolved
    result: null,
    payout: 0,
    startTime: Date.now(),
    messageId: null,
    channelId: null,
    timer: null
  };

  activeGames.set(`${guildId}_${userId}`, game);
  return game;
}

function holdCards(guildId, userId, heldPositions) {
  const game = activeGames.get(`${guildId}_${userId}`);
  if (!game || game.phase !== 'hold') return null;

  game.held = heldPositions;
  return game;
}

function drawCards(guildId, userId) {
  const game = activeGames.get(`${guildId}_${userId}`);
  if (!game || game.phase !== 'hold') return null;

  // Replace non-held cards
  for (let i = 0; i < 5; i++) {
    if (!game.held[i]) {
      game.hand[i] = game.deck.pop();
    }
  }

  // Evaluate final hand
  const result = evaluateHand(game.hand, game.variant);
  game.result = result;
  game.phase = 'resolved';

  if (result.payout > 0) {
    game.payout = result.payout * game.betAmount;
  } else {
    game.payout = -game.betAmount;
  }

  return game;
}

function endGame(guildId, userId) {
  const game = activeGames.get(`${guildId}_${userId}`);
  if (!game) return null;

  if (game.timer) clearTimeout(game.timer);

  recordHistory(game);
  updateStats(game);

  activeGames.delete(`${guildId}_${userId}`);
  return game;
}

function forceEndGame(guildId, userId, reason = 'timeout') {
  const game = activeGames.get(`${guildId}_${userId}`);
  if (!game) return null;

  if (game.timer) clearTimeout(game.timer);

  // If not resolved, draw with whatever is held
  if (game.phase === 'hold') {
    drawCards(guildId, userId);
  }

  game.timeoutReason = reason;

  recordHistory(game);
  updateStats(game);
  activeGames.delete(`${guildId}_${userId}`);

  return game;
}

function setGameMessage(guildId, userId, messageId, channelId) {
  const game = activeGames.get(`${guildId}_${userId}`);
  if (game) {
    game.messageId = messageId;
    game.channelId = channelId;
  }
}

function setGameTimer(guildId, userId, callback, timeoutMs) {
  const game = activeGames.get(`${guildId}_${userId}`);
  if (game) {
    if (game.timer) clearTimeout(game.timer);
    game.timer = setTimeout(callback, timeoutMs);
  }
}

// ============ STATS FUNCTIONS ============

function updateStats(game) {
  if (!db || !game || !game.result) return;

  const { guildId, userId, betAmount, result, payout } = game;
  if (!guildId || !userId) return;

  const totalWagered = betAmount;
  const totalWon = payout > 0 ? payout : 0;
  const totalLost = payout < 0 ? Math.abs(payout) : 0;

  try {
    db.run(`
      INSERT INTO videopoker_stats (guild_id, user_id, games_played, total_wagered, total_won, total_lost)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        games_played = games_played + 1,
        total_wagered = total_wagered + excluded.total_wagered,
        total_won = total_won + excluded.total_won,
        total_lost = total_lost + excluded.total_lost
    `, [guildId, userId, totalWagered, totalWon, totalLost]);

    const handColumns = {
      'Royal Flush': 'royal_flushes',
      'Natural Royal Flush': 'royal_flushes',
      'Wild Royal Flush': 'royal_flushes',
      'Straight Flush': 'straight_flushes',
      'Four of a Kind': 'four_of_a_kinds',
      'Four Aces': 'four_of_a_kinds',
      'Four 2s-4s': 'four_of_a_kinds',
      'Four 5s-Ks': 'four_of_a_kinds',
      'Four Deuces': 'four_of_a_kinds',
      'Five of a Kind': 'four_of_a_kinds',
      'Full House': 'full_houses',
      'Flush': 'flushes',
      'Straight': 'straights',
      'Three of a Kind': 'three_of_a_kinds',
      'Two Pair': 'two_pairs',
      'Jacks or Better': 'jacks_or_better'
    };

    const col = handColumns[result.rank];
    if (col) {
      db.run(`
        UPDATE videopoker_stats SET ${col} = ${col} + 1
        WHERE guild_id = ? AND user_id = ?
      `, [guildId, userId]);
    }
  } catch (err) {
    console.error('[Video Poker] Error updating stats:', err.message);
  }
}

function recordHistory(game) {
  if (!db || !game || !game.result) return;
  if (!game.guildId || !game.userId) return;

  try {
    db.run(`
      INSERT INTO videopoker_history 
      (guild_id, user_id, variant, bet_amount, hand_rank, payout, initial_cards, final_cards, held, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      game.guildId,
      game.userId,
      game.variant,
      game.betAmount,
      game.result.rank,
      game.payout,
      JSON.stringify(game.initialHand),
      JSON.stringify(game.hand),
      JSON.stringify(game.held),
      Date.now()
    ]);
  } catch (err) {
    console.error('[Video Poker] Error recording history:', err.message);
  }
}

function getStats(guildId, userId) {
  if (!db) return null;

  const stmt = db.prepare('SELECT * FROM videopoker_stats WHERE guild_id = ? AND user_id = ?');
  stmt.bind([guildId, userId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// ============ UTILITY ============

function formatCard(card) {
  const suitSymbols = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
  return `${card.rank}${suitSymbols[card.suit]}`;
}

function getPayTable(variant) {
  return PAY_TABLES[variant] || PAY_TABLES['jacks_or_better'];
}

function getVariants() {
  return Object.entries(PAY_TABLES).map(([key, val]) => ({
    key,
    name: val.name,
    emoji: val.emoji
  }));
}

// Clean up stale video poker games (stuck for over 30 minutes)
function cleanupStaleGames() {
  const now = Date.now();
  const GAME_TIMEOUT = 30 * 60 * 1000;
  let cleaned = 0;
  for (const [key, game] of activeGames) {
    if (game.startTime && now - game.startTime > GAME_TIMEOUT) {
      activeGames.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[GC] Cleaned up ${cleaned} stale video poker game(s)`);
  }
}

module.exports = {
  initialize,
  getSettings,
  updateSettings,
  clearSettingsCache,
  hasActiveGame,
  getActiveGame,
  startGame,
  holdCards,
  drawCards,
  endGame,
  forceEndGame,
  setGameMessage,
  setGameTimer,
  getStats,
  formatCard,
  getPayTable,
  getVariants,
  evaluateHand,
  PAY_TABLES,
  cleanupStaleGames
};
