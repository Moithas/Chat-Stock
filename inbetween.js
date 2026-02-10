// In Between (Acey Deucey) Card Game Module
// Progressive pot style card game played against the house

let db = null;

// Card constants
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  anteAmount: 1000,
  potFloor: 1000,
  cooldownSeconds: 30,
  playTimerSeconds: 60 // Time limit per round before auto-fold
};

// In-memory caches
const guildSettings = new Map();
const guildPots = new Map();
const activeGames = new Map(); // guildId -> game state
const lastGameTime = new Map(); // guildId:oderId -> timestamp of last completed game (per-player cooldown)

function initialize(database) {
  db = database;
  
  // Create settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS inbetween_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      ante_amount INTEGER DEFAULT 1000,
      pot_floor INTEGER DEFAULT 1000,
      cooldown_seconds INTEGER DEFAULT 30,
      play_timer_seconds INTEGER DEFAULT 60
    )
  `);
  
  // Create pot table
  db.run(`
    CREATE TABLE IF NOT EXISTS inbetween_pot (
      guild_id TEXT PRIMARY KEY,
      pot_amount INTEGER DEFAULT 1000
    )
  `);
  
  // Create stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS inbetween_stats (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      hands_played INTEGER DEFAULT 0,
      hands_won INTEGER DEFAULT 0,
      hands_lost INTEGER DEFAULT 0,
      poles_hit INTEGER DEFAULT 0,
      total_wagered INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      total_lost INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  
  // Create history table
  db.run(`
    CREATE TABLE IF NOT EXISTS inbetween_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      pole1_suit TEXT NOT NULL,
      pole1_rank TEXT NOT NULL,
      pole2_suit TEXT NOT NULL,
      pole2_rank TEXT NOT NULL,
      third_card_suit TEXT,
      third_card_rank TEXT,
      bet_amount INTEGER NOT NULL,
      result TEXT NOT NULL,
      payout INTEGER NOT NULL,
      pot_after INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
  
  console.log('🃏 In Between game system initialized');
}

// ============ SETTINGS FUNCTIONS ============

function getSettings(guildId) {
  if (guildSettings.has(guildId)) {
    return guildSettings.get(guildId);
  }
  
  if (!db) return { ...DEFAULT_SETTINGS };
  
  const stmt = db.prepare('SELECT * FROM inbetween_settings WHERE guild_id = ?');
  stmt.bind([guildId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    const settings = {
      enabled: row.enabled === 1,
      anteAmount: row.ante_amount,
      potFloor: row.pot_floor,
      cooldownSeconds: row.cooldown_seconds,
      playTimerSeconds: row.play_timer_seconds
    };
    stmt.free();
    guildSettings.set(guildId, settings);
    return settings;
  }
  
  stmt.free();
  guildSettings.set(guildId, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

function updateSettings(guildId, updates) {
  if (!db) return;
  
  const current = getSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO inbetween_settings 
    (guild_id, enabled, ante_amount, pot_floor, cooldown_seconds, play_timer_seconds)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.anteAmount,
    settings.potFloor,
    settings.cooldownSeconds,
    settings.playTimerSeconds
  ]);
  
  guildSettings.set(guildId, settings);
}

// ============ POT FUNCTIONS ============

function getPot(guildId) {
  if (guildPots.has(guildId)) {
    return guildPots.get(guildId);
  }
  
  if (!db) {
    const settings = getSettings(guildId);
    return settings.potFloor;
  }
  
  const stmt = db.prepare('SELECT pot_amount FROM inbetween_pot WHERE guild_id = ?');
  stmt.bind([guildId]);
  
  if (stmt.step()) {
    const pot = stmt.getAsObject().pot_amount;
    stmt.free();
    guildPots.set(guildId, pot);
    return pot;
  }
  
  stmt.free();
  const settings = getSettings(guildId);
  guildPots.set(guildId, settings.potFloor);
  return settings.potFloor;
}

function setPot(guildId, amount) {
  if (!db) return;
  
  const settings = getSettings(guildId);
  // Enforce pot floor
  const finalAmount = Math.max(amount, settings.potFloor);
  
  db.run(`
    INSERT OR REPLACE INTO inbetween_pot (guild_id, pot_amount)
    VALUES (?, ?)
  `, [guildId, finalAmount]);
  
  guildPots.set(guildId, finalAmount);
  return finalAmount;
}

function addToPot(guildId, amount) {
  const current = getPot(guildId);
  return setPot(guildId, current + amount);
}

function removeFromPot(guildId, amount) {
  const current = getPot(guildId);
  const settings = getSettings(guildId);
  // Never go below floor - house covers the difference
  const newAmount = Math.max(current - amount, settings.potFloor);
  return setPot(guildId, newAmount);
}

// ============ CARD FUNCTIONS ============

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

// Get numeric value of a card (Ace can be 1 or 14)
function getCardValue(card, aceHigh = true) {
  if (['J', 'Q', 'K'].includes(card.rank)) {
    return { 'J': 11, 'Q': 12, 'K': 13 }[card.rank];
  }
  if (card.rank === 'A') {
    return aceHigh ? 14 : 1;
  }
  return parseInt(card.rank);
}

// Helper to get pole values from a game state
function getPoleValues(game) {
  // For pole1: use player choice if it's an ace
  const p1Val = getCardValue(game.pole1, game.pole1AceChoice === 'high' || (game.pole1.rank !== 'A'));
  // For pole2: always high if it's an ace (14)
  const p2Val = getCardValue(game.pole2, true);
  return { p1Val, p2Val };
}

// Check if cards are adjacent (no card can be between them)
function areCardsAdjacent(card1Value, card2Value) {
  return Math.abs(card1Value - card2Value) === 1;
}

// Check if cards are equal
function areCardsEqual(card1Value, card2Value) {
  return card1Value === card2Value;
}

// Check if third card is between the poles
function isCardBetween(thirdValue, lowValue, highValue) {
  return thirdValue > lowValue && thirdValue < highValue;
}

// Check if third card hits a pole
function hitsAPole(thirdValue, pole1Value, pole2Value) {
  return thirdValue === pole1Value || thirdValue === pole2Value;
}

// Format card for display
function formatCard(card) {
  const suitColors = { '♠': '⬛', '♣': '⬛', '♥': '🟥', '♦': '🟥' };
  return `${card.rank}${card.suit}`;
}

// ============ GAME STATE FUNCTIONS ============

function hasActiveGame(guildId) {
  return activeGames.has(guildId);
}

function getActiveGame(guildId) {
  return activeGames.get(guildId);
}

function canStartGame(guildId, userId) {
  if (hasActiveGame(guildId)) {
    return { canStart: false, reason: 'A game is already in progress in this server.' };
  }
  
  const settings = getSettings(guildId);
  if (!settings.enabled) {
    return { canStart: false, reason: 'In Between is currently disabled on this server.' };
  }
  
  // Player-specific cooldown
  const cooldownKey = `${guildId}:${userId}`;
  const lastTime = lastGameTime.get(cooldownKey) || 0;
  const now = Date.now();
  const cooldownMs = settings.cooldownSeconds * 1000;
  
  if (now - lastTime < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastTime)) / 1000);
    return { canStart: false, reason: `Please wait **${remaining}** seconds before playing again.` };
  }
  
  return { canStart: true };
}

function startGame(guildId, userId, username) {
  const settings = getSettings(guildId);
  const deck = shuffleDeck(createDeck());
  
  // Deal two cards (poles)
  const pole1 = deck.pop();
  const pole2 = deck.pop();
  
  // Add ante to pot
  const potBeforeAnte = getPot(guildId);
  const currentPot = addToPot(guildId, settings.anteAmount);
  
  const game = {
    guildId,
    oddsMessage: null,
    userId,
    username,
    pole1,
    pole2,
    pole1AceChoice: null, // 'high' or 'low' if pole1 is an Ace
    thirdCard: null,
    deck,
    ante: settings.anteAmount,
    bet: 0,
    status: 'awaiting_bet', // awaiting_ace_choice, awaiting_bet, awaiting_high_low, resolved
    result: null,
    payout: 0,
    potAtStart: potBeforeAnte,
    currentPot,
    startTime: Date.now(),
    messageId: null,
    channelId: null,
    playTimer: null
  };
  
  // Check if first card is an Ace - need ace choice
  if (pole1.rank === 'A') {
    game.status = 'awaiting_ace_choice';
  } else {
    // Check for equal poles (high/low mode)
    const p1Val = getCardValue(pole1);
    const p2Val = getCardValue(pole2, true); // Second ace is always high (14)
    
    if (areCardsEqual(p1Val, p2Val)) {
      game.status = 'awaiting_high_low';
    } else if (areCardsAdjacent(Math.min(p1Val, p2Val), Math.max(p1Val, p2Val))) {
      // Adjacent cards - auto loss
      game.status = 'auto_loss';
      game.result = 'adjacent';
      // Ante already added to pot
    }
  }
  
  activeGames.set(guildId, game);
  return game;
}

function setAceChoice(guildId, choice) {
  const game = activeGames.get(guildId);
  if (!game || game.status !== 'awaiting_ace_choice') return null;
  
  game.pole1AceChoice = choice;
  
  // Now determine game state with the chosen ace value
  const p1Val = getCardValue(game.pole1, choice === 'high');
  const p2Val = getCardValue(game.pole2, true); // Second ace always high (14)
  
  console.log(`[In Between] Ace choice: ${choice}, pole1=${game.pole1.rank} (${p1Val}), pole2=${game.pole2.rank} (${p2Val}), equal=${areCardsEqual(p1Val, p2Val)}`);
  
  if (areCardsEqual(p1Val, p2Val)) {
    game.status = 'awaiting_high_low';
  } else if (areCardsAdjacent(Math.min(p1Val, p2Val), Math.max(p1Val, p2Val))) {
    game.status = 'auto_loss';
    game.result = 'adjacent';
  } else {
    game.status = 'awaiting_bet';
  }
  
  console.log(`[In Between] New status: ${game.status}`);
  
  return game;
}

function placeBet(guildId, betAmount) {
  const game = activeGames.get(guildId);
  if (!game || game.status !== 'awaiting_bet') return null;
  
  game.bet = betAmount;
  return game;
}

function makeHighLowGuess(guildId, guess) {
  const game = activeGames.get(guildId);
  if (!game || game.status !== 'awaiting_high_low') return null;
  
  // Draw third card
  game.thirdCard = game.deck.pop();
  const thirdVal = getCardValue(game.thirdCard);
  const { p1Val } = getPoleValues(game);
  const poleVal = p1Val; // In high/low mode, both poles have equal value
  
  if (thirdVal === poleVal) {
    // Hit the pole on high/low - pay double the ante
    game.result = 'pole_hit_highlow';
    game.payout = -(game.ante * 2); // Lose double the ante
    // Ante + penalty goes to pot
    addToPot(guildId, game.ante * 2);
  } else if ((guess === 'high' && thirdVal > poleVal) || (guess === 'low' && thirdVal < poleVal)) {
    // Won high/low - get ante back 1:1
    game.result = 'win_highlow';
    game.payout = game.ante;
    removeFromPot(guildId, game.ante);
  } else {
    // Lost high/low - lose ante (already in pot)
    game.result = 'lose_highlow';
    game.payout = 0;
  }
  
  game.status = 'resolved';
  game.currentPot = getPot(guildId);
  return game;
}

function drawThirdCard(guildId) {
  const game = activeGames.get(guildId);
  if (!game || game.status !== 'awaiting_bet' || game.bet === 0) return null;
  
  // Draw third card
  game.thirdCard = game.deck.pop();
  
  // Calculate values
  const { p1Val, p2Val } = getPoleValues(game);
  const thirdVal = getCardValue(game.thirdCard);
  
  const lowPole = Math.min(p1Val, p2Val);
  const highPole = Math.max(p1Val, p2Val);
  
  if (hitsAPole(thirdVal, p1Val, p2Val)) {
    // Hit a pole - pay double the bet
    game.result = 'pole_hit';
    game.payout = -(game.bet * 2); // Lose double the bet
    // Their bet + penalty goes to pot
    addToPot(guildId, game.bet * 2);
  } else if (isCardBetween(thirdVal, lowPole, highPole)) {
    // Win! Card is between poles
    game.result = 'win';
    game.payout = game.bet;
    removeFromPot(guildId, game.bet);
  } else {
    // Lose - card is outside poles
    game.result = 'lose';
    game.payout = -game.bet;
    addToPot(guildId, game.bet);
  }
  
  game.status = 'resolved';
  game.currentPot = getPot(guildId);
  return game;
}

function passHand(guildId) {
  const game = activeGames.get(guildId);
  if (!game || (game.status !== 'awaiting_bet' && game.status !== 'awaiting_ace_choice')) return null;
  
  game.status = 'resolved';
  game.result = 'pass';
  game.payout = 0; // Ante already in pot
  game.currentPot = getPot(guildId);
  
  return game;
}

function endGame(guildId) {
  const game = activeGames.get(guildId);
  if (!game) return null;
  
  // Clear play timer if exists
  if (game.playTimer) {
    clearTimeout(game.playTimer);
  }
  
  // Record history
  recordHistory(game);
  
  // Update stats
  updateStats(game);
  
  // Set player-specific cooldown timer
  const cooldownKey = `${guildId}:${game.userId}`;
  lastGameTime.set(cooldownKey, Date.now());
  
  // Remove active game
  activeGames.delete(guildId);
  
  return game;
}

function forceEndGame(guildId, reason = 'timeout') {
  const game = activeGames.get(guildId);
  if (!game) return null;
  
  // Clear play timer
  if (game.playTimer) {
    clearTimeout(game.playTimer);
  }
  
  // If game wasn't resolved, treat as fold
  if (game.status !== 'resolved') {
    game.status = 'resolved';
    game.result = reason;
    game.payout = 0; // Forfeit ante
    game.currentPot = getPot(guildId);
  }
  
  // Record and cleanup
  recordHistory(game);
  updateStats(game);
  const cooldownKey = `${guildId}:${game.userId}`;
  lastGameTime.set(cooldownKey, Date.now());
  activeGames.delete(guildId);
  
  return game;
}

function setGameMessage(guildId, messageId, channelId) {
  const game = activeGames.get(guildId);
  if (game) {
    game.messageId = messageId;
    game.channelId = channelId;
  }
}

function setPlayTimer(guildId, callback, timeoutMs) {
  const game = activeGames.get(guildId);
  if (game) {
    // Clear existing timer
    if (game.playTimer) {
      clearTimeout(game.playTimer);
    }
    game.playTimer = setTimeout(callback, timeoutMs);
  }
}

// ============ STATS FUNCTIONS ============

function updateStats(game) {
  if (!db || !game) return;
  
  const { guildId, userId, bet, result, payout } = game;
  
  // Determine stat updates
  let won = 0, lost = 0, poleHit = 0;
  let totalWon = 0, totalLost = 0;
  
  if (result === 'win' || result === 'win_highlow') {
    won = 1;
    totalWon = payout;
  } else if (result === 'lose' || result === 'lose_highlow' || result === 'adjacent') {
    lost = 1;
    totalLost = game.ante;
  } else if (result === 'pole_hit' || result === 'pole_hit_highlow') {
    lost = 1;
    poleHit = 1;
    totalLost = Math.abs(payout);
  } else if (result === 'pass' || result === 'timeout') {
    lost = 1;
    totalLost = game.ante;
  }
  
  db.run(`
    INSERT INTO inbetween_stats (guild_id, user_id, hands_played, hands_won, hands_lost, poles_hit, total_wagered, total_won, total_lost)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      hands_played = hands_played + 1,
      hands_won = hands_won + ?,
      hands_lost = hands_lost + ?,
      poles_hit = poles_hit + ?,
      total_wagered = total_wagered + ?,
      total_won = total_won + ?,
      total_lost = total_lost + ?
  `, [guildId, userId, won, lost, poleHit, bet, totalWon, totalLost, won, lost, poleHit, bet, totalWon, totalLost]);
}

function getStats(guildId, userId) {
  if (!db) return null;
  
  const stmt = db.prepare('SELECT * FROM inbetween_stats WHERE guild_id = ? AND user_id = ?');
  stmt.bind([guildId, userId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      handsPlayed: row.hands_played,
      handsWon: row.hands_won,
      handsLost: row.hands_lost,
      polesHit: row.poles_hit,
      totalWagered: row.total_wagered,
      totalWon: row.total_won,
      totalLost: row.total_lost,
      netProfit: row.total_won - row.total_lost
    };
  }
  
  stmt.free();
  return null;
}

// ============ HISTORY FUNCTIONS ============

function recordHistory(game) {
  if (!db || !game) return;
  
  db.run(`
    INSERT INTO inbetween_history 
    (guild_id, user_id, pole1_suit, pole1_rank, pole2_suit, pole2_rank, third_card_suit, third_card_rank, bet_amount, result, payout, pot_after, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    game.guildId,
    game.userId,
    game.pole1.suit,
    game.pole1.rank,
    game.pole2.suit,
    game.pole2.rank,
    game.thirdCard?.suit || null,
    game.thirdCard?.rank || null,
    game.bet,
    game.result,
    game.payout,
    game.currentPot,
    Date.now()
  ]);
}

// ============ ODDS CALCULATION ============

function calculateOdds(game) {
  if (!game) return null;
  
  const { p1Val, p2Val } = getPoleValues(game);
  
  const lowPole = Math.min(p1Val, p2Val);
  const highPole = Math.max(p1Val, p2Val);
  const spread = highPole - lowPole - 1; // Cards that can fit between
  
  // Total remaining cards in deck that aren't the poles
  // 52 cards - 2 poles = 50 cards, but we need to account for duplicates
  // For simplicity, calculate based on rank spread
  const totalCards = 50; // Approximation
  const winningCards = spread * 4; // Each rank has 4 suits
  const poleCards = 8; // 4 cards of each pole rank (minus the 2 dealt)
  const losingCards = totalCards - winningCards - 6; // -6 for pole cards minus dealt
  
  return {
    spread,
    winChance: Math.round((winningCards / totalCards) * 100),
    poleChance: Math.round((6 / totalCards) * 100), // Roughly 6 cards that match poles
    loseChance: Math.round((losingCards / totalCards) * 100)
  };
}

module.exports = {
  initialize,
  getSettings,
  updateSettings,
  getPot,
  setPot,
  addToPot,
  removeFromPot,
  hasActiveGame,
  getActiveGame,
  canStartGame,
  startGame,
  setAceChoice,
  placeBet,
  makeHighLowGuess,
  drawThirdCard,
  passHand,
  endGame,
  forceEndGame,
  setGameMessage,
  setPlayTimer,
  getStats,
  calculateOdds,
  getCardValue,
  getPoleValues,
  formatCard,
  SUITS,
  RANKS
};
