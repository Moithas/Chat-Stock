// Screw Your Neighbor (SYN) - Multiplayer card game
// Lowest card loses a life. Last player standing wins the pot.

const { saveDatabase } = require('./database');

let db = null;

// Card values: A=1 (worst/lowest), 2-10, J=11, Q=12, K=13 (best/highest)
// LOWEST card loses. Kings cannot be passed. Dealer swaps with deck instead of passing left.
const CARD_VALUES = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Default settings (overridable via admin panel)
const defaultSettings = {
  enabled: true,
  startingLives: 3,
  maxPlayers: 8,
  minPlayers: 3,
  turnTimeSeconds: 20,
  dealDelaySeconds: 5,
  revealDelaySeconds: 6,
  eliminationDelaySeconds: 4,
  lobbyTimeoutSeconds: 120,
  minBet: 100,
  maxBet: 0 // 0 = no limit
};

// Keep constants for backward compatibility with imports
const STARTING_LIVES = defaultSettings.startingLives;
const MAX_PLAYERS = defaultSettings.maxPlayers;
const MIN_PLAYERS = defaultSettings.minPlayers;
const LOBBY_TIMEOUT_MS = defaultSettings.lobbyTimeoutSeconds * 1000;
const TURN_TIME_MS = defaultSettings.turnTimeSeconds * 1000;
const REVEAL_DELAY_MS = defaultSettings.revealDelaySeconds * 1000;
const ELIMINATION_DELAY_MS = defaultSettings.eliminationDelaySeconds * 1000;

// Active games: guildId -> game state
const activeGames = new Map();

function initSYN(database) {
  db = database;

  // Create SYN settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS syn_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      starting_lives INTEGER DEFAULT 3,
      max_players INTEGER DEFAULT 8,
      min_players INTEGER DEFAULT 3,
      turn_time_seconds INTEGER DEFAULT 20,
      deal_delay_seconds INTEGER DEFAULT 5,
      reveal_delay_seconds INTEGER DEFAULT 6,
      elimination_delay_seconds INTEGER DEFAULT 4,
      lobby_timeout_seconds INTEGER DEFAULT 120,
      min_bet INTEGER DEFAULT 100,
      max_bet INTEGER DEFAULT 0
    )
  `);

  // Create SYN stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS syn_stats (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      total_wagered INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      total_lost INTEGER DEFAULT 0,
      rounds_survived INTEGER DEFAULT 0,
      times_passed INTEGER DEFAULT 0,
      times_knocked INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_syn_stats_guild ON syn_stats(guild_id)`);

  // Migration: add deal_delay_seconds column if missing
  try {
    db.run(`ALTER TABLE syn_settings ADD COLUMN deal_delay_seconds INTEGER DEFAULT 5`);
  } catch (e) {
    // Column already exists
  }

  saveDatabase();
  console.log('🃏 Screw Your Neighbor system initialized');
}

// ==================== DECK ====================

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, value: CARD_VALUES[rank] });
    }
  }
  return shuffleDeck(deck);
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard(deck) {
  if (deck.length === 0) return null;
  return deck.pop();
}

function formatCard(card) {
  if (!card) return '??';
  return `${card.rank}${card.suit}`;
}

function isKing(card) {
  return card && card.rank === 'K';
}

// ==================== GAME STATE ====================

function createGame(guildId, hostId, hostName, wager, startingLives) {
  const lives = startingLives || STARTING_LIVES;
  const game = {
    guildId,
    hostId,
    wager,
    status: 'lobby', // lobby, playing, reveal, finished
    players: new Map(), // userId -> player state
    playerOrder: [],     // array of userIds in seat order
    dealerIndex: 0,      // index into playerOrder for current dealer
    currentPlayerIndex: -1,
    round: 0,
    deck: [],
    pendingPassCard: null, // card being passed to next player
    passedFrom: null,      // who passed the card
    actions: new Map(),    // userId -> 'pass'|'knock' for current round
    threadId: null,
    lobbyMessageId: null,
    roundMessageId: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  // Add host
  game.players.set(hostId, {
    id: hostId,
    name: hostName,
    lives: lives,
    card: null,
    originalCard: null,
    action: null, // 'pass', 'knock', 'waiting'
    eliminated: false,
    stats: { passed: 0, knocked: 0, roundsSurvived: 0 }
  });
  game.playerOrder.push(hostId);

  activeGames.set(guildId, game);
  return game;
}

function getGame(guildId) {
  return activeGames.get(guildId) || null;
}

function deleteGame(guildId) {
  activeGames.delete(guildId);
}

function addPlayer(guildId, userId, userName, startingLives) {
  const game = activeGames.get(guildId);
  if (!game) return null;

  if (game.players.has(userId)) return null;
  if (game.players.size >= MAX_PLAYERS) return null;
  if (game.status !== 'lobby') return null;

  game.players.set(userId, {
    id: userId,
    name: userName,
    lives: startingLives || STARTING_LIVES,
    card: null,
    originalCard: null,
    action: null,
    eliminated: false,
    stats: { passed: 0, knocked: 0, roundsSurvived: 0 }
  });
  game.playerOrder.push(userId);
  game.lastActivity = Date.now();
  return game;
}

function removePlayer(guildId, userId) {
  const game = activeGames.get(guildId);
  if (!game || game.status !== 'lobby') return null;

  game.players.delete(userId);
  game.playerOrder = game.playerOrder.filter(id => id !== userId);
  game.lastActivity = Date.now();

  // If host left, transfer or destroy
  if (userId === game.hostId) {
    if (game.playerOrder.length > 0) {
      game.hostId = game.playerOrder[0];
    } else {
      activeGames.delete(guildId);
      return null;
    }
  }
  return game;
}

function isInGame(guildId, userId) {
  const game = activeGames.get(guildId);
  return game && game.players.has(userId);
}

function hasActiveGame(guildId) {
  return activeGames.has(guildId);
}

// ==================== ROUND LOGIC ====================

function getAlivePlayers(game) {
  return game.playerOrder.filter(id => {
    const p = game.players.get(id);
    return p && !p.eliminated;
  });
}

function getTurnOrder(game) {
  // Turn order: start after dealer, go clockwise, dealer is last
  const alive = getAlivePlayers(game);
  if (alive.length === 0) return [];

  // Find dealer's position among alive players
  const dealerId = alive[game.dealerIndex % alive.length];
  const dealerPos = alive.indexOf(dealerId);

  // Reorder: everyone after dealer first, then dealer last
  const order = [];
  for (let i = 1; i < alive.length; i++) {
    order.push(alive[(dealerPos + i) % alive.length]);
  }
  order.push(dealerId); // dealer acts last
  return order;
}

function getDealerId(game) {
  const alive = getAlivePlayers(game);
  if (alive.length === 0) return null;
  return alive[game.dealerIndex % alive.length];
}

function startRound(game) {
  game.round++;
  game.status = 'playing';
  game.actions.clear();
  game.pendingPassCard = null;
  game.passedFrom = null;

  // Reshuffle if deck is low (need at least 1 card per alive player + a few extra for dealer draws)
  const alive = getAlivePlayers(game);
  if (game.deck.length < alive.length + 5) {
    game.deck = createDeck();
  }

  // Deal 1 card to each alive player
  for (const userId of alive) {
    const player = game.players.get(userId);
    const card = drawCard(game.deck);
    player.card = card;
    player.originalCard = card;
    player.action = null;
  }

  // Set first player (after dealer)
  const turnOrder = getTurnOrder(game);
  game.currentTurnOrder = turnOrder;
  game.currentTurnIndex = 0;
  game.lastActivity = Date.now();

  return game;
}

function getCurrentPlayerId(game) {
  if (!game.currentTurnOrder || game.currentTurnIndex >= game.currentTurnOrder.length) return null;
  return game.currentTurnOrder[game.currentTurnIndex];
}

function isDealer(game, userId) {
  return getDealerId(game) === userId;
}

function isLastPlayer(game, userId) {
  // The dealer is always last
  return isDealer(game, userId);
}

function processAction(game, userId, action) {
  const player = game.players.get(userId);
  if (!player) return { success: false, error: 'Player not found' };

  const currentId = getCurrentPlayerId(game);
  if (currentId !== userId) return { success: false, error: 'Not your turn' };

  let result = { success: true, action, description: '' };

  if (action === 'knock') {
    player.action = 'knock';
    player.stats.knocked++;
    result.description = `${player.name} knocked! ✊`;
    game.actions.set(userId, 'knock');
  } else if (action === 'pass') {
    // Kings cannot be passed
    if (isKing(player.card)) {
      return { success: false, error: 'You cannot pass a King! You must knock.' };
    }

    player.action = 'pass';
    player.stats.passed++;
    game.actions.set(userId, 'pass');

    if (isDealer(game, userId)) {
      // Dealer swaps with top of deck
      const deckCard = drawCard(game.deck);
      if (deckCard && isKing(deckCard)) {
        // King from deck — swap blocked, put king back
        game.deck.push(deckCard);
        result.description = `${player.name} drew from the deck... 👑 **KING!** Swap blocked! Stuck with their card.`;
        result.deckKingBlocked = true;
      } else if (deckCard) {
        // Successful deck swap
        const oldCard = player.card;
        player.card = deckCard;
        result.description = `${player.name} swapped with the deck.`;
        result.deckCard = deckCard;
        result.oldCard = oldCard;
      } else {
        // Empty deck (shouldn't happen)
        result.description = `${player.name} tried the deck but it's empty!`;
      }
    } else {
      // Normal pass: store the card for the next player to receive
      const passedCard = player.card;
      game.pendingPassCard = passedCard;
      game.passedFrom = userId;
      result.description = `${player.name} passed a card! 📤`;
      result.passedCard = passedCard;
    }
  }

  // Advance to next player
  game.currentTurnIndex++;
  game.lastActivity = Date.now();

  // If next player has a pending pass card, they receive it (forced swap)
  const nextId = getCurrentPlayerId(game);
  if (nextId && game.pendingPassCard) {
    const nextPlayer = game.players.get(nextId);
    const received = game.pendingPassCard;
    nextPlayer.originalCard = nextPlayer.card; // remember what they had
    const givenAway = nextPlayer.card;
    nextPlayer.card = received; // forced swap

    // Give the passer the receiver's old card (completing the swap)
    if (game.passedFrom) {
      const passer = game.players.get(game.passedFrom);
      if (passer) {
        passer.card = givenAway;
      }
    }

    game.pendingPassCard = null;
    game.passedFrom = null;
    result.receivedBy = nextId;
    result.receivedCard = received;
    result.swappedCard = givenAway;
  }

  // Check if round is over
  if (game.currentTurnIndex >= game.currentTurnOrder.length) {
    result.roundOver = true;
  }

  return result;
}

function resolveRound(game) {
  // Find the lowest card among alive players
  const alive = getAlivePlayers(game);
  let lowestValue = Infinity;

  for (const userId of alive) {
    const player = game.players.get(userId);
    if (player.card && player.card.value < lowestValue) {
      lowestValue = player.card.value;
    }
  }

  // Find all players tied at the lowest
  const losers = [];
  const results = [];

  for (const userId of alive) {
    const player = game.players.get(userId);
    const isLoser = player.card && player.card.value === lowestValue;

    if (isLoser) {
      player.lives--;
      losers.push(userId);
      results.push({
        userId,
        name: player.name,
        card: player.card,
        isLoser: true,
        livesRemaining: player.lives,
        eliminated: player.lives <= 0
      });

      if (player.lives <= 0) {
        player.eliminated = true;
      }
    } else {
      player.stats.roundsSurvived++;
      results.push({
        userId,
        name: player.name,
        card: player.card,
        isLoser: false,
        livesRemaining: player.lives,
        eliminated: false
      });
    }
  }

  // Rotate dealer for next round (among alive players after eliminations)
  const aliveAfter = getAlivePlayers(game);
  if (aliveAfter.length > 0) {
    game.dealerIndex = (game.dealerIndex + 1) % aliveAfter.length;
  }

  // Check for winner
  let winner = null;
  if (aliveAfter.length === 1) {
    winner = aliveAfter[0];
    game.status = 'finished';
  } else if (aliveAfter.length === 0) {
    // Everyone died same round (shouldn't really happen with 1-life loss per round but handle it)
    game.status = 'finished';
  }

  return { results, losers, winner, lowestValue };
}

// ==================== STATS ====================

function recordGameStats(guildId, players, winnerId, wager) {
  if (!db) return;

  for (const [userId, player] of players) {
    const isWinner = userId === winnerId;
    const totalPlayers = players.size;
    const potWon = isWinner ? wager * totalPlayers : 0;

    db.run(`
      INSERT INTO syn_stats (guild_id, user_id, games_played, games_won, total_wagered, total_won, total_lost, rounds_survived, times_passed, times_knocked)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        games_played = games_played + 1,
        games_won = games_won + ?,
        total_wagered = total_wagered + ?,
        total_won = total_won + ?,
        total_lost = total_lost + ?,
        rounds_survived = rounds_survived + ?,
        times_passed = times_passed + ?,
        times_knocked = times_knocked + ?
    `, [
      guildId, userId,
      isWinner ? 1 : 0, wager, potWon, isWinner ? 0 : wager,
      player.stats.roundsSurvived, player.stats.passed, player.stats.knocked,
      isWinner ? 1 : 0, wager, potWon, isWinner ? 0 : wager,
      player.stats.roundsSurvived, player.stats.passed, player.stats.knocked
    ]);
  }

  saveDatabase();
}

function getPlayerStats(guildId, userId) {
  if (!db) return null;

  const stmt = db.prepare(`SELECT * FROM syn_stats WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject();
  stmt.free();
  return row;
}

// ==================== HELPERS ====================

function createLivesDisplay(lives, maxLives) {
  const max = maxLives || STARTING_LIVES;
  const full = '❤️'.repeat(Math.max(0, lives));
  const empty = '🖤'.repeat(Math.max(0, max - lives));
  return full + empty;
}

// ==================== SETTINGS ====================

function getSYNSettings(guildId) {
  if (!db) return { ...defaultSettings };

  const stmt = db.prepare(`SELECT * FROM syn_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      enabled: row.enabled === 1,
      startingLives: row.starting_lives || defaultSettings.startingLives,
      maxPlayers: row.max_players || defaultSettings.maxPlayers,
      minPlayers: row.min_players || defaultSettings.minPlayers,
      turnTimeSeconds: row.turn_time_seconds || defaultSettings.turnTimeSeconds,
      dealDelaySeconds: row.deal_delay_seconds || defaultSettings.dealDelaySeconds,
      revealDelaySeconds: row.reveal_delay_seconds || defaultSettings.revealDelaySeconds,
      eliminationDelaySeconds: row.elimination_delay_seconds || defaultSettings.eliminationDelaySeconds,
      lobbyTimeoutSeconds: row.lobby_timeout_seconds || defaultSettings.lobbyTimeoutSeconds,
      minBet: row.min_bet ?? defaultSettings.minBet,
      maxBet: row.max_bet ?? defaultSettings.maxBet
    };
  }

  stmt.free();
  return { ...defaultSettings };
}

function updateSYNSettings(guildId, newSettings) {
  if (!db) return;

  const current = getSYNSettings(guildId);
  const merged = { ...current, ...newSettings };

  db.run(`INSERT OR REPLACE INTO syn_settings
    (guild_id, enabled, starting_lives, max_players, min_players, turn_time_seconds, deal_delay_seconds, reveal_delay_seconds, elimination_delay_seconds, lobby_timeout_seconds, min_bet, max_bet)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, merged.enabled ? 1 : 0, merged.startingLives, merged.maxPlayers, merged.minPlayers,
     merged.turnTimeSeconds, merged.dealDelaySeconds, merged.revealDelaySeconds, merged.eliminationDelaySeconds,
     merged.lobbyTimeoutSeconds, merged.minBet, merged.maxBet]);

  saveDatabase();
}

module.exports = {
  initSYN,
  createDeck,
  shuffleDeck,
  drawCard,
  formatCard,
  isKing,
  createGame,
  getGame,
  deleteGame,
  addPlayer,
  removePlayer,
  isInGame,
  hasActiveGame,
  getAlivePlayers,
  getTurnOrder,
  getDealerId,
  startRound,
  getCurrentPlayerId,
  isDealer,
  isLastPlayer,
  processAction,
  resolveRound,
  recordGameStats,
  getPlayerStats,
  createLivesDisplay,
  getSYNSettings,
  updateSYNSettings,
  STARTING_LIVES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  LOBBY_TIMEOUT_MS,
  TURN_TIME_MS,
  REVEAL_DELAY_MS,
  ELIMINATION_DELAY_MS,
  CARD_VALUES
};
