// Gambling module for Chat-Stock
// Handles blackjack and roulette games

let db = null;

// Active games storage (in-memory, keyed by oduserId)
const activeBlackjackGames = new Map();

// Persistent shoe storage per guild (in-memory)
// Each entry: { deck: [], numDecks: number, totalCards: number }
const guildShoes = new Map();

// Cache for gambling settings per guild
const guildGamblingSettings = new Map();

// Card suits and values
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function initGambling(database) {
  db = database;
  
  // Create gambling stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS gambling_stats (
      user_id TEXT PRIMARY KEY,
      blackjack_wins INTEGER DEFAULT 0,
      blackjack_losses INTEGER DEFAULT 0,
      blackjack_pushes INTEGER DEFAULT 0,
      blackjack_blackjacks INTEGER DEFAULT 0,
      blackjack_earnings INTEGER DEFAULT 0,
      roulette_wins INTEGER DEFAULT 0,
      roulette_losses INTEGER DEFAULT 0,
      roulette_earnings INTEGER DEFAULT 0
    )
  `);
  
  // Create gambling settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS gambling_settings (
      guild_id TEXT PRIMARY KEY,
      blackjack_decks INTEGER DEFAULT 1,
      lottery_draw_day INTEGER DEFAULT NULL,
      lottery_draw_hour INTEGER DEFAULT NULL,
      lottery_draw_minute INTEGER DEFAULT 0,
      lottery_channel_id TEXT DEFAULT NULL,
      lottery_auto_draw INTEGER DEFAULT 0
    )
  `);
  
  // Add new columns if they don't exist (migration)
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_draw_day INTEGER DEFAULT NULL`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_draw_hour INTEGER DEFAULT NULL`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_draw_minute INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_channel_id TEXT DEFAULT NULL`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_auto_draw INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_prize_2match INTEGER DEFAULT 1000`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_prize_3match INTEGER DEFAULT 5000`);
  } catch (e) {}
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN lottery_ticket_price INTEGER DEFAULT 1000`);
  } catch (e) {}
  // Scratch card settings
  try {
    db.run(`ALTER TABLE gambling_settings ADD COLUMN scratch_enabled INTEGER DEFAULT 1`);
  } catch (e) {}
  
  // Create scratch card settings table (per-guild card type customization)
  db.run(`
    CREATE TABLE IF NOT EXISTS scratch_card_settings (
      guild_id TEXT NOT NULL,
      card_type TEXT NOT NULL,
      price INTEGER,
      match3_multiplier INTEGER,
      match4_multiplier INTEGER,
      jackpot_multiplier INTEGER,
      jackpot_chance REAL,
      win_symbol_chance REAL,
      PRIMARY KEY (guild_id, card_type)
    )
  `);
  
  // Create lottery table
  db.run(`
    CREATE TABLE IF NOT EXISTS lottery (
      guild_id TEXT PRIMARY KEY,
      jackpot INTEGER DEFAULT 10000,
      winning_numbers TEXT,
      last_draw_time INTEGER,
      total_tickets_sold INTEGER DEFAULT 0
    )
  `);
  
  // Create lottery tickets table
  db.run(`
    CREATE TABLE IF NOT EXISTS lottery_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      numbers TEXT NOT NULL,
      purchase_time INTEGER NOT NULL
    )
  `);
  
  // Create lottery history table
  db.run(`
    CREATE TABLE IF NOT EXISTS lottery_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      numbers TEXT NOT NULL,
      winning_numbers TEXT NOT NULL,
      matches INTEGER NOT NULL,
      prize INTEGER NOT NULL,
      draw_time INTEGER NOT NULL
    )
  `);
  
  // Create scratch card tickets table
  db.run(`
    CREATE TABLE IF NOT EXISTS scratch_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      card_type TEXT NOT NULL,
      symbols TEXT NOT NULL,
      scratched TEXT NOT NULL,
      prize INTEGER DEFAULT 0,
      win_type TEXT DEFAULT NULL,
      is_complete INTEGER DEFAULT 0,
      is_free INTEGER DEFAULT 0,
      purchase_time INTEGER NOT NULL,
      completed_time INTEGER DEFAULT NULL
    )
  `);
  
  // Add is_free column if it doesn't exist (for existing databases)
  try {
    db.run(`ALTER TABLE scratch_tickets ADD COLUMN is_free INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Create scratch card stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS scratch_stats (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      card_type TEXT NOT NULL,
      total_purchased INTEGER DEFAULT 0,
      total_spent INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      jackpots_won INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, card_type)
    )
  `);
  
  // Create indexes for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_gambling_stats_user ON gambling_stats(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lottery_tickets_guild_user ON lottery_tickets(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lottery_history_guild_time ON lottery_history(guild_id, draw_time)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_scratch_tickets_guild_user ON scratch_tickets(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_scratch_stats_guild_user ON scratch_stats(guild_id, user_id)`);
  
  console.log('🎰 Gambling system initialized');
}

// ============ GAMBLING SETTINGS ============

function getGamblingSettings(guildId) {
  // Check cache first
  if (guildGamblingSettings.has(guildId)) {
    return guildGamblingSettings.get(guildId);
  }
  
  if (db) {
    const result = db.exec('SELECT * FROM gambling_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const settings = {
        blackjack_decks: row.blackjack_decks || 2,
        lottery_draw_day: row.lottery_draw_day,
        lottery_draw_hour: row.lottery_draw_hour,
        lottery_draw_minute: row.lottery_draw_minute || 0,
        lottery_channel_id: row.lottery_channel_id,
        lottery_auto_draw: row.lottery_auto_draw === 1,
        lottery_prize_2match: row.lottery_prize_2match || 1000,
        lottery_prize_3match: row.lottery_prize_3match || 5000,
        scratch_enabled: row.scratch_enabled !== 0 // Default true
      };
      guildGamblingSettings.set(guildId, settings);
      return settings;
    }
  }
  
  // Return defaults
  return { 
    blackjack_decks: 2,
    lottery_draw_day: null,
    lottery_draw_hour: null,
    lottery_draw_minute: 0,
    lottery_channel_id: null,
    lottery_auto_draw: false,
    lottery_prize_2match: 1000,
    lottery_prize_3match: 5000,
    scratch_enabled: true
  };
}

function updateGamblingSettings(guildId, updates) {
  if (!db) return;
  
  const current = getGamblingSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO gambling_settings (guild_id, blackjack_decks, lottery_draw_day, lottery_draw_hour, lottery_draw_minute, lottery_channel_id, lottery_auto_draw, lottery_prize_2match, lottery_prize_3match, scratch_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId, 
    settings.blackjack_decks,
    settings.lottery_draw_day,
    settings.lottery_draw_hour,
    settings.lottery_draw_minute,
    settings.lottery_channel_id,
    settings.lottery_auto_draw ? 1 : 0,
    settings.lottery_prize_2match,
    settings.lottery_prize_3match,
    settings.scratch_enabled ? 1 : 0
  ]);
  
  guildGamblingSettings.set(guildId, settings);
}

// ============ UTILITY FUNCTIONS ============

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function createShoe(numDecks) {
  const shoe = [];
  for (let i = 0; i < numDecks; i++) {
    shoe.push(...createDeck());
  }
  return shoe;
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getCardValue(card) {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;
  
  for (const card of hand) {
    value += getCardValue(card);
    if (card.rank === 'A') aces++;
  }
  
  // Convert aces from 11 to 1 if busting
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}

// Get card image URL from deckofcardsapi.com
function getCardImageUrl(card) {
  // Convert suit to code: ♠=S, ♥=H, ♦=D, ♣=C
  const suitCodes = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
  const suitCode = suitCodes[card.suit];
  
  // Convert rank to code (10 stays as 0, face cards are first letter)
  let rankCode = card.rank;
  if (card.rank === '10') rankCode = '0';
  
  return `https://deckofcardsapi.com/static/img/${rankCode}${suitCode}.png`;
}

// Get back of card image
function getCardBackUrl() {
  return 'https://deckofcardsapi.com/static/img/back.png';
}

function formatCard(card) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  return `\`${card.rank}${card.suit}\``;
}

function formatHand(hand, hideSecond = false) {
  if (hideSecond && hand.length >= 2) {
    return `${formatCard(hand[0])} \`??\``;
  }
  return hand.map(formatCard).join(' ');
}

// Get all card image URLs for a hand
function getHandImageUrls(hand, hideSecond = false) {
  if (hideSecond && hand.length >= 2) {
    return [getCardImageUrl(hand[0]), getCardBackUrl()];
  }
  return hand.map(getCardImageUrl);
}

// ============ BLACKJACK ============

// Get or create a shoe for a guild
function getGuildShoe(guildId) {
  const settings = getGamblingSettings(guildId);
  const numDecks = settings.blackjack_decks || 2;
  const totalCards = numDecks * 52;
  
  let shoe = guildShoes.get(guildId);
  
  // Check if we need a new shoe:
  // 1. No shoe exists
  // 2. Deck count setting changed
  // 3. Less than 25% of cards remain (cut card reached)
  const needsReshuffle = !shoe || 
                         shoe.numDecks !== numDecks || 
                         shoe.deck.length < (totalCards * 0.25);
  
  if (needsReshuffle) {
    shoe = {
      deck: shuffleDeck(createShoe(numDecks)),
      numDecks: numDecks,
      totalCards: totalCards,
      reshuffled: true
    };
    guildShoes.set(guildId, shoe);
  } else {
    shoe.reshuffled = false;
  }
  
  return shoe;
}

function startBlackjackGame(userId, bet, guildId) {
  // Get the persistent shoe for this guild
  const shoe = getGuildShoe(guildId);
  
  const playerHand = [shoe.deck.pop(), shoe.deck.pop()];
  const dealerHand = [shoe.deck.pop(), shoe.deck.pop()];
  
  // Check if dealer's face-up card (first card) is an Ace
  const dealerShowsAce = dealerHand[0].rank === 'A';
  
  const game = {
    userId,
    bet,
    deck: shoe.deck, // Reference to the shared shoe
    playerHand,
    dealerHand,
    numDecks: shoe.numDecks,
    totalCards: shoe.totalCards,
    reshuffled: shoe.reshuffled,
    guildId,
    status: 'playing', // playing, insurance, playerBust, dealerBust, playerWin, dealerWin, push, blackjack
    insuranceBet: 0,
    insuranceOffered: dealerShowsAce,
    insuranceDeclined: false,
    startTime: Date.now()
  };
  
  // Check for natural blackjack
  const playerValue = calculateHandValue(playerHand);
  const dealerValue = calculateHandValue(dealerHand);
  
  // If dealer shows Ace and player doesn't have blackjack, offer insurance first
  if (dealerShowsAce && playerValue !== 21) {
    game.status = 'insurance';
    activeBlackjackGames.set(userId, game);
    return game;
  }
  
  if (playerValue === 21 && dealerValue === 21) {
    game.status = 'push';
  } else if (playerValue === 21) {
    game.status = 'blackjack';
  }
  
  activeBlackjackGames.set(userId, game);
  return game;
}

function getBlackjackGame(userId) {
  return activeBlackjackGames.get(userId);
}

// Take insurance bet
function blackjackTakeInsurance(userId, insuranceAmount) {
  const game = activeBlackjackGames.get(userId);
  if (!game || game.status !== 'insurance') return null;
  
  game.insuranceBet = insuranceAmount;
  game.status = 'playing';
  
  // Check if dealer has blackjack (21)
  const dealerValue = calculateHandValue(game.dealerHand);
  if (dealerValue === 21) {
    game.dealerHasBlackjack = true;
  }
  
  return game;
}

// Decline insurance
function blackjackDeclineInsurance(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || game.status !== 'insurance') return null;
  
  game.insuranceDeclined = true;
  game.status = 'playing';
  
  // Check if dealer has blackjack
  const dealerValue = calculateHandValue(game.dealerHand);
  if (dealerValue === 21) {
    game.dealerHasBlackjack = true;
  }
  
  return game;
}

// Check if dealer has blackjack (used after insurance decision)
function dealerHasBlackjack(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game) return false;
  
  return calculateHandValue(game.dealerHand) === 21;
}

function blackjackHit(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || game.status !== 'playing') return null;
  
  game.playerHand.push(game.deck.pop());
  const value = calculateHandValue(game.playerHand);
  
  if (value > 21) {
    game.status = 'playerBust';
  } else if (value === 21) {
    // Auto-stand on 21
    return blackjackStand(userId);
  }
  
  return game;
}

function blackjackStand(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || game.status !== 'playing') return null;
  
  // Dealer draws until 17 or higher (must hit on soft 17)
  while (calculateHandValue(game.dealerHand) < 17 || isSoft17(game.dealerHand)) {
    game.dealerHand.push(game.deck.pop());
  }
  
  const playerValue = calculateHandValue(game.playerHand);
  const dealerValue = calculateHandValue(game.dealerHand);
  
  if (dealerValue > 21) {
    game.status = 'dealerBust';
  } else if (playerValue > dealerValue) {
    game.status = 'playerWin';
  } else if (dealerValue > playerValue) {
    game.status = 'dealerWin';
  } else {
    game.status = 'push';
  }
  
  return game;
}

// Check if dealer needs another card (for animated dealer play)
function dealerNeedsCard(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game) return false;
  
  const value = calculateHandValue(game.dealerHand);
  return value < 17 || isSoft17(game.dealerHand);
}

// Deal one card to dealer (for animated dealer play)
function dealerHit(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game) return null;
  
  game.dealerHand.push(game.deck.pop());
  return game;
}

// Finalize dealer's turn and determine winner
function finalizeDealerTurn(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game) return null;
  
  const playerValue = calculateHandValue(game.playerHand);
  const dealerValue = calculateHandValue(game.dealerHand);
  
  if (dealerValue > 21) {
    game.status = 'dealerBust';
  } else if (playerValue > dealerValue) {
    game.status = 'playerWin';
  } else if (dealerValue > playerValue) {
    game.status = 'dealerWin';
  } else {
    game.status = 'push';
  }
  
  return game;
}

// Check if hand is a soft 17 (17 with an Ace counted as 11)
function isSoft17(hand) {
  const value = calculateHandValue(hand);
  if (value !== 17) return false;
  
  // Check if there's an Ace being counted as 11
  let hardValue = 0;
  for (const card of hand) {
    if (['J', 'Q', 'K'].includes(card.rank)) {
      hardValue += 10;
    } else if (card.rank === 'A') {
      hardValue += 1; // Count Ace as 1 for hard value
    } else {
      hardValue += parseInt(card.rank);
    }
  }
  
  // If hard value is 7 and calculated value is 17, it's soft 17 (Ace counted as 11)
  return hardValue === 7;
}

function blackjackDoubleDown(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || game.status !== 'playing') return null;
  if (game.playerHand.length !== 2) return null; // Can only double on first two cards
  
  game.bet *= 2;
  game.playerHand.push(game.deck.pop());
  
  const value = calculateHandValue(game.playerHand);
  if (value > 21) {
    game.status = 'playerBust';
    return game;
  }
  
  // Must stand after double down
  return blackjackStand(userId);
}

// Check if hand can be split (two cards of same rank)
function canSplitHand(hand) {
  if (hand.length !== 2) return false;
  return hand[0].rank === hand[1].rank;
}

// Split hand - creates a split hand in the game
function blackjackSplit(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || game.status !== 'playing') return null;
  if (!canSplitHand(game.playerHand)) return null;
  if (game.hasSplit) return null; // Already split
  
  // Take the second card to create split hand
  const splitCard = game.playerHand.pop();
  
  // Deal new card to original hand
  game.playerHand.push(game.deck.pop());
  
  // Create split hand with second card and deal new card
  game.splitHand = [splitCard, game.deck.pop()];
  game.splitBet = game.bet;
  game.hasSplit = true;
  game.currentHand = 'main'; // Start playing main hand
  game.splitStatus = 'playing'; // Split hand status
  
  // Check if main hand hit 21
  if (calculateHandValue(game.playerHand) === 21) {
    game.status = 'stand'; // Mark main hand as done
    game.currentHand = 'split';
  }
  
  return game;
}

// Hit on split hand
function blackjackHitSplit(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || !game.hasSplit || game.currentHand !== 'split') return null;
  if (game.splitStatus !== 'playing') return null;
  
  game.splitHand.push(game.deck.pop());
  const value = calculateHandValue(game.splitHand);
  
  if (value > 21) {
    game.splitStatus = 'bust';
  } else if (value === 21) {
    game.splitStatus = 'stand';
  }
  
  return game;
}

// Stand on split hand
function blackjackStandSplit(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || !game.hasSplit || game.currentHand !== 'split') return null;
  
  game.splitStatus = 'stand';
  return game;
}

// Resolve split game (dealer plays and determine outcomes)
function resolveSplitGame(userId) {
  const game = activeBlackjackGames.get(userId);
  if (!game || !game.hasSplit) return null;
  
  // Dealer draws until 17 or higher
  while (calculateHandValue(game.dealerHand) < 17 || isSoft17(game.dealerHand)) {
    game.dealerHand.push(game.deck.pop());
  }
  
  const dealerValue = calculateHandValue(game.dealerHand);
  const mainValue = calculateHandValue(game.playerHand);
  const splitValue = calculateHandValue(game.splitHand);
  
  // Determine main hand outcome
  if (game.status === 'playerBust' || mainValue > 21) {
    game.mainResult = 'bust';
  } else if (dealerValue > 21) {
    game.mainResult = 'win';
  } else if (mainValue > dealerValue) {
    game.mainResult = 'win';
  } else if (dealerValue > mainValue) {
    game.mainResult = 'loss';
  } else {
    game.mainResult = 'push';
  }
  
  // Determine split hand outcome
  if (game.splitStatus === 'bust' || splitValue > 21) {
    game.splitResult = 'bust';
  } else if (dealerValue > 21) {
    game.splitResult = 'win';
  } else if (splitValue > dealerValue) {
    game.splitResult = 'win';
  } else if (dealerValue > splitValue) {
    game.splitResult = 'loss';
  } else {
    game.splitResult = 'push';
  }
  
  game.status = 'finished';
  return game;
}

function endBlackjackGame(userId) {
  const game = activeBlackjackGames.get(userId);
  activeBlackjackGames.delete(userId);
  return game;
}

function updateBlackjackStats(userId, result, amount) {
  if (!db) return;
  
  // Ensure user exists in stats
  db.run(`INSERT OR IGNORE INTO gambling_stats (user_id) VALUES (?)`, [userId]);
  
  switch (result) {
    case 'win':
      db.run(`UPDATE gambling_stats SET blackjack_wins = blackjack_wins + 1, blackjack_earnings = blackjack_earnings + ? WHERE user_id = ?`, [amount, userId]);
      break;
    case 'loss':
      db.run(`UPDATE gambling_stats SET blackjack_losses = blackjack_losses + 1, blackjack_earnings = blackjack_earnings - ? WHERE user_id = ?`, [amount, userId]);
      break;
    case 'push':
      db.run(`UPDATE gambling_stats SET blackjack_pushes = blackjack_pushes + 1 WHERE user_id = ?`, [userId]);
      break;
    case 'blackjack':
      db.run(`UPDATE gambling_stats SET blackjack_wins = blackjack_wins + 1, blackjack_blackjacks = blackjack_blackjacks + 1, blackjack_earnings = blackjack_earnings + ? WHERE user_id = ?`, [amount, userId]);
      break;
  }
}

// ============ ROULETTE ============

const ROULETTE_NUMBERS = {
  red: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
  black: [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35],
  green: [0]
};

const ROULETTE_BETS = {
  // Color bets (1:1)
  red: { payout: 2, check: (n) => ROULETTE_NUMBERS.red.includes(n) },
  black: { payout: 2, check: (n) => ROULETTE_NUMBERS.black.includes(n) },
  
  // Even/Odd (1:1)
  even: { payout: 2, check: (n) => n !== 0 && n % 2 === 0 },
  odd: { payout: 2, check: (n) => n % 2 === 1 },
  
  // High/Low (1:1)
  low: { payout: 2, check: (n) => n >= 1 && n <= 18 },
  high: { payout: 2, check: (n) => n >= 19 && n <= 36 },
  
  // Dozens (2:1)
  '1st12': { payout: 3, check: (n) => n >= 1 && n <= 12 },
  '2nd12': { payout: 3, check: (n) => n >= 13 && n <= 24 },
  '3rd12': { payout: 3, check: (n) => n >= 25 && n <= 36 },
  
  // Columns (2:1)
  'col1': { payout: 3, check: (n) => n !== 0 && n % 3 === 1 },
  'col2': { payout: 3, check: (n) => n !== 0 && n % 3 === 2 },
  'col3': { payout: 3, check: (n) => n !== 0 && n % 3 === 0 },
  
  // Green (35:1)
  green: { payout: 36, check: (n) => n === 0 }
};

// Add straight-up number bets (35:1)
for (let i = 0; i <= 36; i++) {
  ROULETTE_BETS[String(i)] = { payout: 36, check: (n) => n === i };
}

function spinRoulette() {
  return Math.floor(Math.random() * 37); // 0-36
}

function getNumberColor(num) {
  if (num === 0) return '🟢';
  if (ROULETTE_NUMBERS.red.includes(num)) return '🔴';
  return '⚫';
}

function checkRouletteBet(betType, number) {
  const bet = ROULETTE_BETS[betType.toLowerCase()];
  if (!bet) return null;
  return bet.check(number);
}

function getRoulettePayout(betType) {
  const bet = ROULETTE_BETS[betType.toLowerCase()];
  return bet ? bet.payout : null;
}

function getRouletteOdds(betType) {
  const bet = ROULETTE_BETS[betType.toLowerCase()];
  if (!bet) return null;
  return `${bet.payout - 1}:1`;
}

function updateRouletteStats(userId, won, amount) {
  if (!db) return;
  
  db.run(`INSERT OR IGNORE INTO gambling_stats (user_id) VALUES (?)`, [userId]);
  
  if (won) {
    db.run(`UPDATE gambling_stats SET roulette_wins = roulette_wins + 1, roulette_earnings = roulette_earnings + ? WHERE user_id = ?`, [amount, userId]);
  } else {
    db.run(`UPDATE gambling_stats SET roulette_losses = roulette_losses + 1, roulette_earnings = roulette_earnings - ? WHERE user_id = ?`, [amount, userId]);
  }
}

// Roulette spin history tracking
const recentRouletteSpins = [];
const MAX_SPIN_HISTORY = 50;

function recordRouletteSpin(number) {
  recentRouletteSpins.unshift({
    number,
    color: getNumberColor(number),
    timestamp: Date.now()
  });
  
  // Keep only last 50 spins
  if (recentRouletteSpins.length > MAX_SPIN_HISTORY) {
    recentRouletteSpins.pop();
  }
}

function getRouletteStats() {
  const last10 = recentRouletteSpins.slice(0, 10);
  
  // Count colors in history
  const counts = { red: 0, black: 0, green: 0 };
  const numberCounts = {};
  
  for (const spin of recentRouletteSpins) {
    if (spin.color === '🔴') counts.red++;
    else if (spin.color === '⚫') counts.black++;
    else counts.green++;
    
    numberCounts[spin.number] = (numberCounts[spin.number] || 0) + 1;
  }
  
  // Find hot numbers (most frequent)
  const sortedByFreq = Object.entries(numberCounts).sort((a, b) => b[1] - a[1]);
  const hotNumbers = sortedByFreq.slice(0, 5).map(([num, count]) => ({
    number: parseInt(num),
    count,
    color: getNumberColor(parseInt(num))
  }));
  
  // Find cold numbers (numbers that haven't appeared)
  const allNumbers = Array.from({ length: 37 }, (_, i) => i);
  const coldNumbers = allNumbers
    .filter(n => !numberCounts[n])
    .slice(0, 5)
    .map(n => ({ number: n, color: getNumberColor(n) }));
  
  const total = recentRouletteSpins.length;
  
  return {
    last10,
    counts,
    hotNumbers,
    coldNumbers,
    total,
    percentages: total > 0 ? {
      red: ((counts.red / total) * 100).toFixed(1),
      black: ((counts.black / total) * 100).toFixed(1),
      green: ((counts.green / total) * 100).toFixed(1)
    } : null
  };
}

// ============ STATS ============

function getGamblingStats(userId) {
  if (!db) return null;
  
  db.run(`INSERT OR IGNORE INTO gambling_stats (user_id) VALUES (?)`, [userId]);
  
  const result = db.exec('SELECT * FROM gambling_stats WHERE user_id = ?', [userId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  }
  
  return {
    user_id: userId,
    blackjack_wins: 0,
    blackjack_losses: 0,
    blackjack_pushes: 0,
    blackjack_blackjacks: 0,
    blackjack_earnings: 0,
    roulette_wins: 0,
    roulette_losses: 0,
    roulette_earnings: 0
  };
}

// ============ LOTTERY ============

const LOTTERY_TICKET_PRICE = 1000; // Default, can be overridden per guild
const LOTTERY_JACKPOT_INCREMENT = 1000;
const LOTTERY_PRIZES = {
  2: 1000,   // 2 matches
  3: 5000,   // 3 matches
  4: 'jackpot' // 4 matches = jackpot
};

function getLotteryTicketPrice(guildId) {
  const settings = getGamblingSettings(guildId);
  return settings.lottery_ticket_price || LOTTERY_TICKET_PRICE;
}

function getLotteryInfo(guildId) {
  if (!db) return null;
  
  // Ensure lottery entry exists
  db.run(`INSERT OR IGNORE INTO lottery (guild_id) VALUES (?)`, [guildId]);
  
  const result = db.exec('SELECT * FROM lottery WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
    return {
      jackpot: data.jackpot || 10000,
      winningNumbers: data.winning_numbers ? JSON.parse(data.winning_numbers) : null,
      lastDrawTime: data.last_draw_time,
      totalTicketsSold: data.total_tickets_sold || 0
    };
  }
  
  return {
    jackpot: 10000,
    winningNumbers: null,
    lastDrawTime: null,
    totalTicketsSold: 0
  };
}

function buyLotteryTicket(guildId, userId, numbers) {
  if (!db) return null;
  
  // Validate numbers (4 numbers, 0-29)
  if (!Array.isArray(numbers) || numbers.length !== 4) {
    return { success: false, error: 'Must pick exactly 4 numbers' };
  }
  
  for (const num of numbers) {
    if (num < 0 || num > 29 || !Number.isInteger(num)) {
      return { success: false, error: 'Numbers must be between 0 and 29' };
    }
  }
  
  // Check for duplicate numbers
  if (new Set(numbers).size !== 4) {
    return { success: false, error: 'All 4 numbers must be different' };
  }
  
  // Add ticket
  db.run(`
    INSERT INTO lottery_tickets (guild_id, user_id, numbers, purchase_time)
    VALUES (?, ?, ?, ?)
  `, [guildId, userId, JSON.stringify(numbers.sort((a,b) => a-b)), Date.now()]);
  
  // Increase jackpot
  db.run(`
    UPDATE lottery 
    SET jackpot = jackpot + ?, total_tickets_sold = total_tickets_sold + 1
    WHERE guild_id = ?
  `, [LOTTERY_JACKPOT_INCREMENT, guildId]);
  
  return { success: true, numbers: numbers.sort((a,b) => a-b) };
}

function getUserTickets(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM lottery_tickets 
    WHERE guild_id = ? AND user_id = ?
    ORDER BY purchase_time DESC
  `, [guildId, userId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    return result[0].values.map(vals => {
      const ticket = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      ticket.numbers = JSON.parse(ticket.numbers);
      return ticket;
    });
  }
  
  return [];
}

function getAllTickets(guildId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM lottery_tickets 
    WHERE guild_id = ?
    ORDER BY purchase_time DESC
  `, [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    return result[0].values.map(vals => {
      const ticket = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      ticket.numbers = JSON.parse(ticket.numbers);
      return ticket;
    });
  }
  
  return [];
}

function drawLottery(guildId) {
  if (!db) return null;
  
  const lotteryInfo = getLotteryInfo(guildId);
  const tickets = getAllTickets(guildId);
  
  // Generate 4 random winning numbers (0-29, no duplicates)
  const winningNumbers = [];
  while (winningNumbers.length < 4) {
    const num = Math.floor(Math.random() * 30);
    if (!winningNumbers.includes(num)) {
      winningNumbers.push(num);
    }
  }
  winningNumbers.sort((a, b) => a - b);
  
  // Get prize settings
  const settings = getGamblingSettings(guildId);
  const prizes = {
    2: settings.lottery_prize_2match,
    3: settings.lottery_prize_3match,
    4: 'jackpot'
  };
  
  // Check each ticket
  const results = [];
  let jackpotWon = false;
  let totalPrizesPaid = 0;
  
  for (const ticket of tickets) {
    const matches = countMatches(ticket.numbers, winningNumbers);
    let prize = 0;
    
    if (matches >= 2) {
      if (matches === 4) {
        prize = lotteryInfo.jackpot;
        jackpotWon = true;
      } else {
        prize = prizes[matches];
      }
      totalPrizesPaid += prize;
      
      // Record in history
      db.run(`
        INSERT INTO lottery_history (guild_id, user_id, numbers, winning_numbers, matches, prize, draw_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [guildId, ticket.user_id, JSON.stringify(ticket.numbers), JSON.stringify(winningNumbers), matches, prize, Date.now()]);
    }
    
    results.push({
      userId: ticket.user_id,
      numbers: ticket.numbers,
      matches,
      prize
    });
  }
  
  // Clear tickets and update lottery
  db.run(`DELETE FROM lottery_tickets WHERE guild_id = ?`, [guildId]);
  
  // Reset jackpot if won, otherwise keep it
  const newJackpot = jackpotWon ? 10000 : lotteryInfo.jackpot;
  
  db.run(`
    UPDATE lottery 
    SET winning_numbers = ?, last_draw_time = ?, jackpot = ?, total_tickets_sold = 0
    WHERE guild_id = ?
  `, [JSON.stringify(winningNumbers), Date.now(), newJackpot, guildId]);
  
  return {
    winningNumbers,
    results,
    jackpotWon,
    jackpotAmount: lotteryInfo.jackpot,
    totalTickets: tickets.length,
    totalPrizesPaid
  };
}

function countMatches(playerNumbers, winningNumbers) {
  let matches = 0;
  for (const num of playerNumbers) {
    if (winningNumbers.includes(num)) {
      matches++;
    }
  }
  return matches;
}

function setJackpot(guildId, amount) {
  if (!db) return;
  db.run(`INSERT OR IGNORE INTO lottery (guild_id) VALUES (?)`, [guildId]);
  db.run(`UPDATE lottery SET jackpot = ? WHERE guild_id = ?`, [amount, guildId]);
}

function getRecentWinners(guildId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM lottery_history 
    WHERE guild_id = ? AND prize > 0
    ORDER BY draw_time DESC
    LIMIT ?
  `, [guildId, limit]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    return result[0].values.map(vals => {
      const winner = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      winner.numbers = JSON.parse(winner.numbers);
      winner.winning_numbers = JSON.parse(winner.winning_numbers);
      return winner;
    });
  }
  
  return [];
}

// ============ SCRATCH CARDS ============

/**
 * Purchase a scratch card ticket
 * @param {string} guildId 
 * @param {string} userId 
 * @param {string} cardType 
 * @param {array} symbols 
 * @param {boolean} isFree - Whether this ticket was free (from FREE_TICKET win)
 */
function purchaseScratchTicket(guildId, userId, cardType, symbols, isFree = false) {
  if (!db) return null;
  
  const totalBoxes = symbols.length;
  const scratched = new Array(totalBoxes).fill(false);
  
  db.run(`
    INSERT INTO scratch_tickets (guild_id, user_id, card_type, symbols, scratched, is_free, purchase_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guildId, userId, cardType, JSON.stringify(symbols), JSON.stringify(scratched), isFree ? 1 : 0, Date.now()]);
  
  // Get the inserted ticket
  const result = db.exec('SELECT last_insert_rowid() as id');
  const ticketId = result[0].values[0][0];
  
  return {
    id: ticketId,
    cardType,
    symbols,
    scratched,
    isComplete: false,
    isFree
  };
}

/**
 * Get a user's active (incomplete) scratch tickets
 */
function getActiveScratchTickets(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM scratch_tickets 
    WHERE guild_id = ? AND user_id = ? AND is_complete = 0
    ORDER BY purchase_time DESC
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const ticket = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
    ticket.symbols = JSON.parse(ticket.symbols);
    ticket.scratched = JSON.parse(ticket.scratched);
    return ticket;
  });
}

/**
 * Get a specific scratch ticket
 */
function getScratchTicket(ticketId) {
  if (!db) return null;
  
  const result = db.exec('SELECT * FROM scratch_tickets WHERE id = ?', [ticketId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const ticket = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  ticket.symbols = JSON.parse(ticket.symbols);
  ticket.scratched = JSON.parse(ticket.scratched);
  return ticket;
}

/**
 * Scratch specific boxes on a ticket
 */
function scratchBoxes(ticketId, boxIndices) {
  if (!db) return null;
  
  const ticket = getScratchTicket(ticketId);
  if (!ticket || ticket.is_complete) return null;
  
  // Update scratched array
  for (const index of boxIndices) {
    if (index >= 0 && index < ticket.scratched.length) {
      ticket.scratched[index] = true;
    }
  }
  
  db.run('UPDATE scratch_tickets SET scratched = ? WHERE id = ?', 
    [JSON.stringify(ticket.scratched), ticketId]);
  
  return ticket;
}

/**
 * Reveal all boxes and complete the ticket
 */
function revealAllBoxes(ticketId, prize, winType) {
  if (!db) return null;
  
  const ticket = getScratchTicket(ticketId);
  if (!ticket) return null;
  
  // Mark all as scratched
  const allScratched = new Array(ticket.scratched.length).fill(true);
  
  db.run(`
    UPDATE scratch_tickets 
    SET scratched = ?, prize = ?, win_type = ?, is_complete = 1, completed_time = ?
    WHERE id = ?
  `, [JSON.stringify(allScratched), prize, winType, Date.now(), ticketId]);
  
  return {
    ...ticket,
    scratched: allScratched,
    prize,
    win_type: winType,
    is_complete: 1
  };
}

/**
 * Update scratch card stats
 */
function updateScratchStats(guildId, userId, cardType, spent, won, isJackpot = false) {
  if (!db) return;
  
  db.run(`
    INSERT INTO scratch_stats (guild_id, user_id, card_type, total_purchased, total_spent, total_won, jackpots_won)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, card_type) DO UPDATE SET
      total_purchased = total_purchased + 1,
      total_spent = total_spent + excluded.total_spent,
      total_won = total_won + excluded.total_won,
      jackpots_won = jackpots_won + excluded.jackpots_won
  `, [guildId, userId, cardType, spent, won, isJackpot ? 1 : 0]);
}

/**
 * Get scratch card stats for a user
 */
function getScratchStats(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM scratch_stats 
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(vals => 
    cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {})
  );
}

/**
 * Get recent scratch card wins
 */
function getRecentScratchWins(guildId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM scratch_tickets 
    WHERE guild_id = ? AND is_complete = 1 AND prize > 0
    ORDER BY completed_time DESC
    LIMIT ?
  `, [guildId, limit]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const ticket = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
    ticket.symbols = JSON.parse(ticket.symbols);
    ticket.scratched = JSON.parse(ticket.scratched);
    return ticket;
  });
}

/**
 * Get server-wide scratch card statistics
 */
function getServerScratchStats(guildId) {
  if (!db) return null;
  
  const result = db.exec(`
    SELECT 
      card_type,
      SUM(total_purchased) as total_cards,
      SUM(total_spent) as total_spent,
      SUM(total_won) as total_won,
      SUM(jackpots_won) as total_jackpots,
      COUNT(DISTINCT user_id) as unique_players
    FROM scratch_stats 
    WHERE guild_id = ?
    GROUP BY card_type
  `, [guildId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const byType = {};
  let grandTotal = { cards: 0, spent: 0, won: 0, jackpots: 0, players: 0 };
  
  for (const row of result[0].values) {
    const obj = cols.reduce((o, col, i) => ({ ...o, [col]: row[i] }), {});
    byType[obj.card_type] = {
      cards: obj.total_cards,
      spent: obj.total_spent,
      won: obj.total_won,
      jackpots: obj.total_jackpots,
      players: obj.unique_players
    };
    grandTotal.cards += obj.total_cards;
    grandTotal.spent += obj.total_spent;
    grandTotal.won += obj.total_won;
    grandTotal.jackpots += obj.total_jackpots;
  }
  
  // Get unique total players
  const playersResult = db.exec(`
    SELECT COUNT(DISTINCT user_id) as total_players FROM scratch_stats WHERE guild_id = ?
  `, [guildId]);
  grandTotal.players = playersResult.length > 0 && playersResult[0].values.length > 0 
    ? playersResult[0].values[0][0] : 0;
  
  return { byType, grandTotal };
}

/**
 * Get scratch card leaderboard
 */
function getScratchLeaderboard(guildId, sortBy = 'profit', limit = 10) {
  if (!db) return [];
  
  let orderClause;
  switch (sortBy) {
    case 'won':
      orderClause = 'total_won DESC';
      break;
    case 'spent':
      orderClause = 'total_spent DESC';
      break;
    case 'jackpots':
      orderClause = 'jackpots_won DESC';
      break;
    case 'cards':
      orderClause = 'total_purchased DESC';
      break;
    case 'profit':
    default:
      orderClause = '(total_won - total_spent) DESC';
      break;
  }
  
  const result = db.exec(`
    SELECT 
      user_id,
      SUM(total_purchased) as total_purchased,
      SUM(total_spent) as total_spent,
      SUM(total_won) as total_won,
      SUM(jackpots_won) as jackpots_won,
      (SUM(total_won) - SUM(total_spent)) as profit
    FROM scratch_stats 
    WHERE guild_id = ?
    GROUP BY user_id
    ORDER BY ${orderClause}
    LIMIT ?
  `, [guildId, limit]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(row => cols.reduce((o, col, i) => ({ ...o, [col]: row[i] }), {}));
}

/**
 * Get all player scratch stats for admin view
 */
function getAllPlayerScratchStats(guildId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT 
      user_id,
      SUM(total_purchased) as total_purchased,
      SUM(total_spent) as total_spent,
      SUM(total_won) as total_won,
      SUM(jackpots_won) as jackpots_won,
      (SUM(total_won) - SUM(total_spent)) as profit
    FROM scratch_stats 
    WHERE guild_id = ?
    GROUP BY user_id
    ORDER BY total_purchased DESC
  `, [guildId]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(row => cols.reduce((o, col, i) => ({ ...o, [col]: row[i] }), {}));
}

// Default scratch card configurations (odds are percentages 0-100)
const DEFAULT_SCRATCH_CONFIGS = {
  cheese: { price: 500, match3: 10, match4: null, jackpot: 50, jackpotOdds: 1, winOdds: 14 },
  cash: { price: 1000, match3: 15, match4: null, jackpot: 75, jackpotOdds: 1, winOdds: 14 },
  stocks: { price: 2500, match3: 2, match4: 25, jackpot: 100, jackpotOdds: 1, winOdds: 14 },
  lucky7s: { price: 5000, match3: 2, match4: 35, jackpot: 250, jackpotOdds: 1, winOdds: 14 }
};

/**
 * Get scratch card settings for a specific card type in a guild
 * Returns odds as percentages (0-100)
 */
function getScratchCardSettings(guildId, cardType) {
  const defaults = DEFAULT_SCRATCH_CONFIGS[cardType];
  if (!defaults) return null;
  
  if (!db) return { ...defaults };
  
  const result = db.exec(`
    SELECT * FROM scratch_card_settings 
    WHERE guild_id = ? AND card_type = ?
  `, [guildId, cardType]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return { ...defaults };
  }
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
  
  return {
    price: row.price ?? defaults.price,
    match3: row.match3_multiplier ?? defaults.match3,
    match4: row.match4_multiplier ?? defaults.match4,
    jackpot: row.jackpot_multiplier ?? defaults.jackpot,
    // Convert stored decimals to percentages, or use defaults (which are already percentages)
    jackpotOdds: row.jackpot_chance != null ? row.jackpot_chance * 100 : defaults.jackpotOdds,
    winOdds: row.win_symbol_chance != null ? row.win_symbol_chance * 100 : defaults.winOdds
  };
}

/**
 * Get all scratch card settings for a guild
 */
function getAllScratchCardSettings(guildId) {
  const settings = {};
  for (const cardType of Object.keys(DEFAULT_SCRATCH_CONFIGS)) {
    settings[cardType] = getScratchCardSettings(guildId, cardType);
  }
  return settings;
}

/**
 * Update scratch card settings for a specific card type
 * Expects odds as percentages (0-100), stores as decimals
 */
function updateScratchCardSettings(guildId, cardType, updates) {
  if (!db) return;
  
  const current = getScratchCardSettings(guildId, cardType);
  const newSettings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO scratch_card_settings 
    (guild_id, card_type, price, match3_multiplier, match4_multiplier, jackpot_multiplier, jackpot_chance, win_symbol_chance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    cardType,
    newSettings.price,
    newSettings.match3,
    newSettings.match4,
    newSettings.jackpot,
    // Convert percentages to decimals for storage
    newSettings.jackpotOdds / 100,
    newSettings.winOdds / 100
  ]);
}

/**
 * Reset scratch card settings to defaults for a card type
 */
function resetScratchCardSettings(guildId, cardType) {
  if (!db) return;
  db.run('DELETE FROM scratch_card_settings WHERE guild_id = ? AND card_type = ?', [guildId, cardType]);
}

module.exports = {
  initGambling,
  // Blackjack
  startBlackjackGame,
  getBlackjackGame,
  blackjackHit,
  blackjackStand,
  blackjackDoubleDown,
  blackjackTakeInsurance,
  blackjackDeclineInsurance,
  dealerHasBlackjack,
  dealerNeedsCard,
  dealerHit,
  finalizeDealerTurn,
  endBlackjackGame,
  calculateHandValue,
  formatHand,
  getHandImageUrls,
  getCardImageUrl,
  getCardBackUrl,
  updateBlackjackStats,
  // Split
  canSplitHand,
  blackjackSplit,
  blackjackHitSplit,
  blackjackStandSplit,
  resolveSplitGame,
  // Roulette
  spinRoulette,
  getNumberColor,
  checkRouletteBet,
  getRoulettePayout,
  getRouletteOdds,
  updateRouletteStats,
  recordRouletteSpin,
  getRouletteStats,
  ROULETTE_BETS,
  ROULETTE_NUMBERS,
  // Stats
  getGamblingStats,
  // Settings
  getGamblingSettings,
  updateGamblingSettings,
  // Lottery
  getLotteryInfo,
  buyLotteryTicket,
  getUserTickets,
  getAllTickets,
  drawLottery,
  setJackpot,
  getRecentWinners,
  LOTTERY_TICKET_PRICE,
  getLotteryTicketPrice,
  LOTTERY_PRIZES,
  // Scratch Cards
  purchaseScratchTicket,
  getActiveScratchTickets,
  getScratchTicket,
  scratchBoxes,
  revealAllBoxes,
  updateScratchStats,
  getScratchStats,
  getRecentScratchWins,
  getServerScratchStats,
  getScratchLeaderboard,
  getAllPlayerScratchStats,
  getScratchCardSettings,
  getAllScratchCardSettings,
  updateScratchCardSettings,
  resetScratchCardSettings,
  DEFAULT_SCRATCH_CONFIGS
};
