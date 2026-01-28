// Three Card Poker game module for Chat-Stock
// Handles game logic, hand evaluation, and payouts

const { getDb } = require('./database');

let db = null;

const DEFAULT_SETTINGS = {
  enabled: true,
  minBet: 100,
  maxBet: 100000,
  timerSeconds: 60  // Time to make Play/Fold decision
};

// In-memory game state
const activeGames = new Map();
const settingsCache = new Map();
let forceEnabledOnStartup = true;

// Card constants
const SUITS = ['S', 'H', 'D', 'C'];  // Spades, Hearts, Diamonds, Clubs
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Hand rankings for 3-card poker (different from standard poker!)
const HAND_RANKS_3CARD = {
  'Straight Flush': 6,
  'Three of a Kind': 5,
  'Straight': 4,
  'Flush': 3,
  'Pair': 2,
  'High Card': 1
};

// Hand rankings for 5-card poker (6-card bonus)
const HAND_RANKS_5CARD = {
  'Royal Flush': 10,
  'Straight Flush': 9,
  'Four of a Kind': 8,
  'Full House': 7,
  'Flush': 6,
  'Straight': 5,
  'Three of a Kind': 4,
  'Two Pair': 3,
  'Pair': 2,
  'High Card': 1
};

// Payout tables
const ANTE_BONUS_PAYOUTS = {
  'Straight Flush': 5,
  'Three of a Kind': 4,
  'Straight': 1
};

const PAIR_PLUS_PAYOUTS = {
  'Straight Flush': 40,
  'Three of a Kind': 30,
  'Straight': 6,
  'Flush': 4,
  'Pair': 1
};

const SIX_CARD_BONUS_PAYOUTS = {
  'Royal Flush': 1000,
  'Straight Flush': 200,
  'Four of a Kind': 50,
  'Full House': 25,
  'Flush': 20,
  'Straight': 10,
  'Three of a Kind': 5
};

// ============ INITIALIZATION ============

function initialize(database) {
  db = database || getDb();
  
  // Create settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS threecardpoker_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      min_bet INTEGER DEFAULT 100,
      max_bet INTEGER DEFAULT 100000,
      timer_seconds INTEGER DEFAULT 60
    )
  `);
  
  // Create stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS threecardpoker_stats (
      guild_id TEXT,
      user_id TEXT,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      games_lost INTEGER DEFAULT 0,
      total_wagered INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      total_lost INTEGER DEFAULT 0,
      biggest_win INTEGER DEFAULT 0,
      straight_flushes INTEGER DEFAULT 0,
      three_of_kinds INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create history table
  db.run(`
    CREATE TABLE IF NOT EXISTS threecardpoker_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT,
      user_id TEXT,
      ante_bet INTEGER,
      pair_plus_bet INTEGER,
      six_card_bet INTEGER,
      player_hand TEXT,
      dealer_hand TEXT,
      player_hand_rank TEXT,
      dealer_hand_rank TEXT,
      six_card_hand_rank TEXT,
      folded INTEGER DEFAULT 0,
      dealer_qualified INTEGER DEFAULT 1,
      ante_result INTEGER DEFAULT 0,
      play_result INTEGER DEFAULT 0,
      ante_bonus_result INTEGER DEFAULT 0,
      pair_plus_result INTEGER DEFAULT 0,
      six_card_result INTEGER DEFAULT 0,
      total_result INTEGER DEFAULT 0,
      timestamp INTEGER
    )
  `);
  
  // Force enable on startup
  if (forceEnabledOnStartup) {
    const result = db.exec('SELECT guild_id FROM threecardpoker_settings');
    if (result.length > 0 && result[0].values.length > 0) {
      db.run('UPDATE threecardpoker_settings SET enabled = 1');
      console.log('🃏 3 Card Poker: Force-enabled all existing settings');
    }
    forceEnabledOnStartup = false;
  }
  
  console.log('🃏 Three Card Poker system initialized');
}

// ============ SETTINGS ============

function getSettings(guildId) {
  if (settingsCache.has(guildId)) {
    return settingsCache.get(guildId);
  }
  
  const result = db.exec('SELECT * FROM threecardpoker_settings WHERE guild_id = ?', [guildId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    // Create default settings
    db.run(`
      INSERT INTO threecardpoker_settings (guild_id, enabled, min_bet, max_bet, timer_seconds)
      VALUES (?, ?, ?, ?, ?)
    `, [guildId, DEFAULT_SETTINGS.enabled ? 1 : 0, DEFAULT_SETTINGS.minBet, DEFAULT_SETTINGS.maxBet, DEFAULT_SETTINGS.timerSeconds]);
    
    settingsCache.set(guildId, { ...DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS };
  }
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  
  const settings = {
    enabled: row.enabled === 1,
    minBet: row.min_bet,
    maxBet: row.max_bet,
    timerSeconds: row.timer_seconds
  };
  
  settingsCache.set(guildId, settings);
  return settings;
}

function updateSettings(guildId, settings) {
  getSettings(guildId); // Ensure row exists
  
  db.run(`
    UPDATE threecardpoker_settings 
    SET enabled = ?, min_bet = ?, max_bet = ?, timer_seconds = ?
    WHERE guild_id = ?
  `, [settings.enabled ? 1 : 0, settings.minBet, settings.maxBet, settings.timerSeconds, guildId]);
  
  settingsCache.set(guildId, settings);
}

function clearSettingsCache(guildId) {
  if (guildId) {
    settingsCache.delete(guildId);
  } else {
    settingsCache.clear();
  }
}

// ============ DECK MANAGEMENT ============

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
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ============ GAME STATE MANAGEMENT ============

function hasActiveGame(userId) {
  return activeGames.has(userId);
}

function getActiveGame(userId) {
  return activeGames.get(userId);
}

function startGame(guildId, userId, anteBet) {
  const settings = getSettings(guildId);
  
  if (!settings.enabled) {
    return { success: false, error: 'Three Card Poker is currently disabled.' };
  }
  
  if (hasActiveGame(userId)) {
    return { success: false, error: 'You already have an active game.' };
  }
  
  if (anteBet < settings.minBet || anteBet > settings.maxBet) {
    return { success: false, error: `Ante must be between ${settings.minBet.toLocaleString()} and ${settings.maxBet.toLocaleString()}.` };
  }
  
  const game = {
    guildId,
    userId,
    anteBet,
    pairPlusBet: 0,
    sixCardBet: 0,
    phase: 'betting', // betting -> playing -> resolved
    playerHand: [],
    dealerHand: [],
    deck: shuffleDeck(createDeck()),
    folded: false,
    messageId: null,
    channelId: null,
    timer: null,
    startTime: Date.now()
  };
  
  activeGames.set(userId, game);
  
  return { success: true, game };
}

function setSideBets(userId, pairPlusBet, sixCardBet) {
  const game = activeGames.get(userId);
  if (!game || game.phase !== 'betting') {
    return { success: false, error: 'No active game in betting phase.' };
  }
  
  const settings = getSettings(game.guildId);
  
  // Validate side bets (0 is allowed - means no bet)
  if (pairPlusBet > 0 && (pairPlusBet < settings.minBet || pairPlusBet > settings.maxBet)) {
    return { success: false, error: `Pair Plus bet must be between ${settings.minBet.toLocaleString()} and ${settings.maxBet.toLocaleString()}.` };
  }
  
  if (sixCardBet > 0 && (sixCardBet < settings.minBet || sixCardBet > settings.maxBet)) {
    return { success: false, error: `6-Card Bonus bet must be between ${settings.minBet.toLocaleString()} and ${settings.maxBet.toLocaleString()}.` };
  }
  
  game.pairPlusBet = pairPlusBet;
  game.sixCardBet = sixCardBet;
  
  return { success: true, game };
}

function dealCards(userId) {
  const game = activeGames.get(userId);
  if (!game || game.phase !== 'betting') {
    return { success: false, error: 'No active game in betting phase.' };
  }
  
  // Deal 3 cards to player and 3 to dealer
  game.playerHand = [game.deck.pop(), game.deck.pop(), game.deck.pop()];
  game.dealerHand = [game.deck.pop(), game.deck.pop(), game.deck.pop()];
  game.phase = 'playing';
  
  return { success: true, game };
}

function playHand(userId) {
  const game = activeGames.get(userId);
  if (!game || game.phase !== 'playing') {
    return { success: false, error: 'No active game in playing phase.' };
  }
  
  game.folded = false;
  return resolveGame(game);
}

function foldHand(userId) {
  const game = activeGames.get(userId);
  if (!game || game.phase !== 'playing') {
    return { success: false, error: 'No active game in playing phase.' };
  }
  
  game.folded = true;
  return resolveGame(game);
}

function resolveGame(game) {
  game.phase = 'resolved';
  
  // Clear any timer
  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
  
  // Evaluate hands
  const playerHandResult = evaluate3CardHand(game.playerHand);
  const dealerHandResult = evaluate3CardHand(game.dealerHand);
  
  // Check if dealer qualifies (Queen-high or better)
  const dealerQualifies = doesDealerQualify(game.dealerHand);
  
  // Calculate all payouts
  const results = {
    playerHand: playerHandResult,
    dealerHand: dealerHandResult,
    dealerQualifies,
    folded: game.folded,
    
    // Individual bet results
    anteResult: 0,
    playResult: 0,
    anteBonusResult: 0,
    pairPlusResult: 0,
    sixCardResult: 0,
    
    // For display
    anteOutcome: '',
    playOutcome: '',
    anteBonusOutcome: '',
    pairPlusOutcome: '',
    sixCardOutcome: ''
  };
  
  if (game.folded) {
    // Folded - lose ante, but side bets still pay
    results.anteResult = -game.anteBet;
    results.anteOutcome = 'Folded';
    results.playOutcome = 'N/A';
  } else {
    // Played - resolve ante and play bets
    if (!dealerQualifies) {
      // Dealer doesn't qualify - ante pays 1:1, play pushes
      results.anteResult = game.anteBet;
      results.playResult = 0;
      results.anteOutcome = 'Win (Dealer DNQ)';
      results.playOutcome = 'Push';
    } else {
      // Dealer qualifies - compare hands
      const comparison = compareHands(playerHandResult, dealerHandResult);
      
      if (comparison > 0) {
        // Player wins
        results.anteResult = game.anteBet;
        results.playResult = game.anteBet; // Play bet equals ante
        results.anteOutcome = 'Win';
        results.playOutcome = 'Win';
      } else if (comparison < 0) {
        // Dealer wins
        results.anteResult = -game.anteBet;
        results.playResult = -game.anteBet;
        results.anteOutcome = 'Lose';
        results.playOutcome = 'Lose';
      } else {
        // Tie - push
        results.anteResult = 0;
        results.playResult = 0;
        results.anteOutcome = 'Push';
        results.playOutcome = 'Push';
      }
    }
    
    // Ante bonus (paid regardless of dealer qualifying, based on player's hand)
    const anteBonusMultiplier = ANTE_BONUS_PAYOUTS[playerHandResult.rank] || 0;
    if (anteBonusMultiplier > 0) {
      results.anteBonusResult = game.anteBet * anteBonusMultiplier;
      results.anteBonusOutcome = `${playerHandResult.rank} (${anteBonusMultiplier}:1)`;
    } else {
      results.anteBonusOutcome = 'No bonus';
    }
  }
  
  // Pair Plus (always pays based on player's hand, even if folded)
  if (game.pairPlusBet > 0) {
    const pairPlusMultiplier = PAIR_PLUS_PAYOUTS[playerHandResult.rank] || 0;
    if (pairPlusMultiplier > 0) {
      results.pairPlusResult = game.pairPlusBet * pairPlusMultiplier;
      results.pairPlusOutcome = `${playerHandResult.rank} (${pairPlusMultiplier}:1)`;
    } else {
      results.pairPlusResult = -game.pairPlusBet;
      results.pairPlusOutcome = 'Lose';
    }
  } else {
    results.pairPlusOutcome = 'No bet';
  }
  
  // 6-Card Bonus (best 5-card hand from all 6 cards)
  if (game.sixCardBet > 0) {
    const allCards = [...game.playerHand, ...game.dealerHand];
    const sixCardResult = evaluate5CardHand(allCards);
    results.sixCardHand = sixCardResult;
    
    const sixCardMultiplier = SIX_CARD_BONUS_PAYOUTS[sixCardResult.rank] || 0;
    if (sixCardMultiplier > 0) {
      results.sixCardResult = game.sixCardBet * sixCardMultiplier;
      results.sixCardOutcome = `${sixCardResult.rank} (${sixCardMultiplier}:1)`;
    } else {
      results.sixCardResult = -game.sixCardBet;
      results.sixCardOutcome = 'Lose';
    }
  } else {
    results.sixCardOutcome = 'No bet';
  }
  
  // Calculate total
  results.totalResult = results.anteResult + results.playResult + results.anteBonusResult + results.pairPlusResult + results.sixCardResult;
  
  // Store results in game for later use
  game.results = results;
  
  // Record to database
  updateStats(game, results);
  recordHistory(game, results);
  
  return { success: true, game, results };
}

function endGame(userId) {
  const game = activeGames.get(userId);
  if (game) {
    if (game.timer) {
      clearTimeout(game.timer);
    }
    activeGames.delete(userId);
  }
}

function forceEndGame(userId, reason = 'timeout') {
  const game = activeGames.get(userId);
  if (!game) return null;
  
  // If in playing phase, auto-fold
  if (game.phase === 'playing') {
    game.folded = true;
    const result = resolveGame(game);
    endGame(userId);
    return { ...result, reason };
  }
  
  // If in betting phase, just cancel (no cards dealt, refund ante)
  if (game.phase === 'betting') {
    endGame(userId);
    return { cancelled: true, refund: game.anteBet + game.pairPlusBet + game.sixCardBet, reason };
  }
  
  endGame(userId);
  return { cancelled: true, reason };
}

// ============ HAND EVALUATION (3-CARD) ============

function getRankValue(rank) {
  const values = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  return values[rank];
}

function evaluate3CardHand(hand) {
  const ranks = hand.map(c => getRankValue(c.rank)).sort((a, b) => b - a);
  const suits = hand.map(c => c.suit);
  
  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const isStraight = is3CardStraight(ranks);
  const rankCounts = getRankCounts(hand);
  const maxCount = Math.max(...Object.values(rankCounts));
  
  let rank, highCards;
  
  if (isStraight && isFlush) {
    rank = 'Straight Flush';
    highCards = isStraight.highCard ? [isStraight.highCard] : ranks;
  } else if (maxCount === 3) {
    rank = 'Three of a Kind';
    highCards = ranks;
  } else if (isStraight) {
    rank = 'Straight';
    highCards = isStraight.highCard ? [isStraight.highCard] : ranks;
  } else if (isFlush) {
    rank = 'Flush';
    highCards = ranks;
  } else if (maxCount === 2) {
    rank = 'Pair';
    // Sort with pair first, then kicker
    const pairRank = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 2));
    const kicker = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 1));
    highCards = [pairRank, pairRank, kicker];
  } else {
    rank = 'High Card';
    highCards = ranks;
  }
  
  return { rank, highCards, value: HAND_RANKS_3CARD[rank] };
}

function is3CardStraight(ranks) {
  const sorted = [...ranks].sort((a, b) => a - b);
  
  // Regular straight
  if (sorted[2] - sorted[1] === 1 && sorted[1] - sorted[0] === 1) {
    return { highCard: sorted[2] };
  }
  
  // Ace-low straight (A-2-3)
  if (sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 14) {
    return { highCard: 3 }; // 3 is the high card in A-2-3
  }
  
  return false;
}

function getRankCounts(hand) {
  const counts = {};
  for (const card of hand) {
    const val = getRankValue(card.rank);
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

function doesDealerQualify(dealerHand) {
  // Dealer needs Queen-high or better to qualify
  const result = evaluate3CardHand(dealerHand);
  
  // Any pair or better qualifies
  if (result.value >= HAND_RANKS_3CARD['Pair']) {
    return true;
  }
  
  // High card - need Queen or better
  if (result.rank === 'High Card') {
    return result.highCards[0] >= 12; // Queen = 12
  }
  
  return true; // Flush/Straight/etc. always qualify
}

function compareHands(hand1, hand2) {
  // Compare hand ranks first
  if (hand1.value !== hand2.value) {
    return hand1.value - hand2.value;
  }
  
  // Same rank - compare high cards
  for (let i = 0; i < hand1.highCards.length; i++) {
    if (hand1.highCards[i] !== hand2.highCards[i]) {
      return hand1.highCards[i] - hand2.highCards[i];
    }
  }
  
  return 0; // Tie
}

// ============ HAND EVALUATION (5-CARD for 6-Card Bonus) ============

function evaluate5CardHand(sixCards) {
  // Find best 5-card hand from 6 cards
  const combinations = getCombinations(sixCards, 5);
  let bestHand = null;
  
  for (const combo of combinations) {
    const result = evaluate5CardCombo(combo);
    if (!bestHand || compare5CardHands(result, bestHand) > 0) {
      bestHand = result;
    }
  }
  
  return bestHand;
}

function getCombinations(arr, size) {
  const result = [];
  
  function combine(start, combo) {
    if (combo.length === size) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  
  combine(0, []);
  return result;
}

function evaluate5CardCombo(hand) {
  const ranks = hand.map(c => getRankValue(c.rank)).sort((a, b) => b - a);
  const suits = hand.map(c => c.suit);
  
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = is5CardStraight(ranks);
  const rankCounts = {};
  for (const card of hand) {
    const val = getRankValue(card.rank);
    rankCounts[val] = (rankCounts[val] || 0) + 1;
  }
  
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  
  let rank;
  
  // Royal Flush
  if (isFlush && isStraight && ranks[0] === 14 && ranks[4] === 10) {
    rank = 'Royal Flush';
  }
  // Straight Flush
  else if (isFlush && isStraight) {
    rank = 'Straight Flush';
  }
  // Four of a Kind
  else if (counts[0] === 4) {
    rank = 'Four of a Kind';
  }
  // Full House
  else if (counts[0] === 3 && counts[1] === 2) {
    rank = 'Full House';
  }
  // Flush
  else if (isFlush) {
    rank = 'Flush';
  }
  // Straight
  else if (isStraight) {
    rank = 'Straight';
  }
  // Three of a Kind
  else if (counts[0] === 3) {
    rank = 'Three of a Kind';
  }
  // Two Pair
  else if (counts[0] === 2 && counts[1] === 2) {
    rank = 'Two Pair';
  }
  // Pair
  else if (counts[0] === 2) {
    rank = 'Pair';
  }
  // High Card
  else {
    rank = 'High Card';
  }
  
  return { rank, highCards: ranks, value: HAND_RANKS_5CARD[rank] };
}

function is5CardStraight(ranks) {
  const sorted = [...ranks].sort((a, b) => a - b);
  
  // Regular straight
  let isStraight = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i-1] !== 1) {
      isStraight = false;
      break;
    }
  }
  if (isStraight) return true;
  
  // Ace-low straight (A-2-3-4-5)
  if (sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14) {
    return true;
  }
  
  return false;
}

function compare5CardHands(hand1, hand2) {
  if (hand1.value !== hand2.value) {
    return hand1.value - hand2.value;
  }
  
  for (let i = 0; i < hand1.highCards.length; i++) {
    if (hand1.highCards[i] !== hand2.highCards[i]) {
      return hand1.highCards[i] - hand2.highCards[i];
    }
  }
  
  return 0;
}

// ============ UTILITY ============

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

function formatCard(card) {
  const suitSymbols = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
  return `${card.rank}${suitSymbols[card.suit]}`;
}

function formatHand(hand) {
  return hand.map(formatCard).join(' ');
}

// ============ STATS ============

function updateStats(game, results) {
  if (!db) return;
  
  const totalWagered = game.anteBet + (game.folded ? 0 : game.anteBet) + game.pairPlusBet + game.sixCardBet;
  const won = results.totalResult > 0 ? 1 : 0;
  const lost = results.totalResult < 0 ? 1 : 0;
  const totalWon = results.totalResult > 0 ? results.totalResult : 0;
  const totalLost = results.totalResult < 0 ? Math.abs(results.totalResult) : 0;
  const straightFlush = results.playerHand.rank === 'Straight Flush' ? 1 : 0;
  const threeOfKind = results.playerHand.rank === 'Three of a Kind' ? 1 : 0;
  
  // Check if user exists in stats
  const existing = db.exec('SELECT * FROM threecardpoker_stats WHERE guild_id = ? AND user_id = ?', [game.guildId, game.userId]);
  
  if (existing.length === 0 || existing[0].values.length === 0) {
    db.run(`
      INSERT INTO threecardpoker_stats (guild_id, user_id, games_played, games_won, games_lost, total_wagered, total_won, total_lost, biggest_win, straight_flushes, three_of_kinds)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [game.guildId, game.userId, won, lost, totalWagered, totalWon, totalLost, totalWon, straightFlush, threeOfKind]);
  } else {
    db.run(`
      UPDATE threecardpoker_stats 
      SET games_played = games_played + 1,
          games_won = games_won + ?,
          games_lost = games_lost + ?,
          total_wagered = total_wagered + ?,
          total_won = total_won + ?,
          total_lost = total_lost + ?,
          biggest_win = MAX(biggest_win, ?),
          straight_flushes = straight_flushes + ?,
          three_of_kinds = three_of_kinds + ?
      WHERE guild_id = ? AND user_id = ?
    `, [won, lost, totalWagered, totalWon, totalLost, totalWon, straightFlush, threeOfKind, game.guildId, game.userId]);
  }
}

function recordHistory(game, results) {
  if (!db) return;
  
  db.run(`
    INSERT INTO threecardpoker_history (
      guild_id, user_id, ante_bet, pair_plus_bet, six_card_bet,
      player_hand, dealer_hand, player_hand_rank, dealer_hand_rank, six_card_hand_rank,
      folded, dealer_qualified, ante_result, play_result, ante_bonus_result,
      pair_plus_result, six_card_result, total_result, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    game.guildId, game.userId, game.anteBet, game.pairPlusBet, game.sixCardBet,
    JSON.stringify(game.playerHand), JSON.stringify(game.dealerHand),
    results.playerHand.rank, results.dealerHand.rank, results.sixCardHand?.rank || null,
    results.folded ? 1 : 0, results.dealerQualifies ? 1 : 0,
    results.anteResult, results.playResult, results.anteBonusResult,
    results.pairPlusResult, results.sixCardResult, results.totalResult, Date.now()
  ]);
}

function getStats(guildId, userId) {
  if (!db) return null;
  
  const result = db.exec('SELECT * FROM threecardpoker_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

// ============ EXPORTS ============

module.exports = {
  initialize,
  getSettings,
  updateSettings,
  clearSettingsCache,
  hasActiveGame,
  getActiveGame,
  startGame,
  setSideBets,
  dealCards,
  playHand,
  foldHand,
  endGame,
  forceEndGame,
  setGameMessage,
  setGameTimer,
  formatCard,
  formatHand,
  getStats,
  evaluate3CardHand,
  evaluate5CardHand,
  PAIR_PLUS_PAYOUTS,
  SIX_CARD_BONUS_PAYOUTS,
  ANTE_BONUS_PAYOUTS
};
