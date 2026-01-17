const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getBalance, removeMoney, addMoney, removeFromTotal } = require('../economy');
const { generateBlackjackTableImage } = require('../cardImages');
const { getGamblingSettings } = require('../gambling');

const CURRENCY = '<:babybel:1418824333664452608>';
const DEALER_EMOJI = ''; // Casino dealer emoji
const TURN_TIME_LIMIT = 30; // Seconds per turn
const TURN_WARNING_TIME = 10; // Warning when this many seconds left

// Game states
const multiplayerGames = new Map(); // guildId -> gameData
const turnTimers = new Map(); // guildId -> { timer, warningTimer }
const cleanupTimers = new Map(); // guildId -> cleanup timeout

// Auto-cleanup inactive games every 5 minutes
setInterval(() => {
  const now = Date.now();
  const timeout = 15 * 60 * 1000; // 15 minutes
  
  for (const [guildId, game] of multiplayerGames.entries()) {
    if (now - game.lastActivity > timeout) {
      console.log(`ðŸƒ Cleaning up inactive blackjack table for guild ${guildId}`);
      // Clear any turn timers
      clearTurnTimer(guildId);
      // Return all bets to players
      for (const player of game.players.values()) {
        if (player.bet > 0) {
          addMoney(guildId, player.id, player.bet, 'Multiplayer Blackjack - table cleanup').catch(console.error);
        }
      }
      multiplayerGames.delete(guildId);
    }
  }
}, 5 * 60 * 1000);

// Preset bet amounts
const PRESET_BETS = [100, 250, 500, 1000, 2500];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjacktable')
    .setDescription('Join or create a multiplayer blackjack table')
    .addSubcommand(subcommand =>
      subcommand
        .setName('join')
        .setDescription('Join or create a multiplayer blackjack table')
        .addStringOption(option =>
          option.setName('bet')
            .setDescription('Bet amount (100, 250, 500, 1000, 2500, or custom amount)')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('leave')
        .setDescription('Leave the current blackjack table'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Show current table status')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (subcommand === 'join') {
      return handleJoin(interaction);
    } else if (subcommand === 'leave') {
      return handleLeave(interaction);
    } else if (subcommand === 'status') {
      return handleStatus(interaction);
    }
  }
};

async function handleJoin(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const betInput = interaction.options.getString('bet');

  await interaction.deferReply();

  // Parse bet amount
  let betAmount;
  if (PRESET_BETS.map(String).includes(betInput)) {
    betAmount = parseInt(betInput);
  } else {
    // Try to parse as custom amount
    const customBet = parseInt(betInput);
    if (isNaN(customBet) || customBet < 100) {
      return interaction.editReply({
        content: `❌ Invalid bet amount! Use preset amounts (${PRESET_BETS.join(', ')}) or a custom amount ≥100.`
      });
    }
    betAmount = customBet;
  }

  // Check if player has enough balance
  const balanceData = await getBalance(guildId, userId);
  if (balanceData.total < betAmount) {
    return interaction.editReply({
      content: `❌ You don't have enough! Your balance: **${balanceData.total.toLocaleString()}** ${CURRENCY}`
    });
  }

  // Get or create game for this guild
  let game = multiplayerGames.get(guildId);
  
  if (!game) {
    // Create new table
    game = createNewTable(guildId);
    multiplayerGames.set(guildId, game);
  }

  // Check if player is already at the table
  if (game.players.has(userId)) {
    return interaction.editReply({
      content: '❌ You are already at this table! Use `/blackjacktable leave` to leave first.'
    });
  }

  // Check if table is full
  if (game.players.size >= 4) {
    return interaction.editReply({
      content: '❌ Table is full! Maximum 4 players per table.'
    });
  }

  // Check if game is in progress
  if (game.status !== 'waiting') {
    return interaction.editReply({
      content: '❌ Game is already in progress! Wait for it to finish.'
    });
  }

  // Add player to table
  await removeFromTotal(guildId, userId, betAmount, 'Multiplayer Blackjack bet');
  
  const player = {
    id: userId,
    username: interaction.user.username,
    displayName: interaction.user.displayName || interaction.user.username,
    avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
    bet: betAmount,
    hand: [],
    status: 'waiting', // waiting, playing, stand, bust, blackjack
    insurance: 0,
    doubledDown: false
  };

  game.players.set(userId, player);
  game.lastActivity = Date.now();

  // Show updated table
  const { embed, attachment } = await createTableEmbed(game, guildId);
  const components = createWaitingComponents(game);
  
  await interaction.editReply({ 
    content: `âœ… **${interaction.user.displayName}** joined the table! (${player.bet.toLocaleString()} ${CURRENCY})`,
    embeds: [embed], 
    files: [attachment], 
    components 
  });
}

async function handleLeave(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  await interaction.deferReply({ ephemeral: true });

  const game = multiplayerGames.get(guildId);
  if (!game) {
    return interaction.editReply({
      content: '❌ No active table found.'
    });
  }

  const player = game.players.get(userId);
  if (!player) {
    return interaction.editReply({
      content: '❌ You are not at this table.'
    });
  }

  if (game.status !== 'waiting') {
    return interaction.editReply({
      content: '❌ Cannot leave during an active game! Wait for the hand to finish.'
    });
  }

  // Return player's bet
  await addMoney(guildId, userId, player.bet, 'Multiplayer Blackjack - left table');
  
  // Remove player from table
  game.players.delete(userId);
  game.lastActivity = Date.now();

  // If no players left, clean up table
  if (game.players.size === 0) {
    multiplayerGames.delete(guildId);
    return interaction.editReply({
      content: ' You left the table. Table has been closed (no players remaining).'
    });
  }

  return interaction.editReply({
    content: '✔ You left the blackjack table. Your bet has been returned.'
  });
}

async function handleStatus(interaction) {
  const guildId = interaction.guildId;
  
  await interaction.deferReply();

  const game = multiplayerGames.get(guildId);
  if (!game) {
    return interaction.editReply({
      content: '❌ No active blackjack table found.'
    });
  }

  const { embed, attachment } = await createTableEmbed(game, guildId);
  const components = game.status === 'waiting' ? createWaitingComponents(game) : [];
  
  return interaction.editReply({ embeds: [embed], files: [attachment], components });
}

function createNewTable(guildId) {
  const settings = getGamblingSettings(guildId);
  const numDecks = settings.blackjack_decks || 2;
  const deck = shuffleDeck(numDecks);
  
  return {
    guildId,
    players: new Map(), // userId -> playerData
    dealer: {
      hand: [],
      holeCard: null // First card dealt face down
    },
    deck: deck,
    numDecks: numDecks,
    totalCards: numDecks * 52,
    status: 'waiting', // waiting, dealing, playing, dealer_turn, finished
    currentPlayer: null, // userId of current player's turn
    startTime: null,
    lastActivity: Date.now()
  };
}

function shuffleDeck(numDecks = 2) {
  const suits = ['\u2660', '\u2665', '\u2666', '\u2663'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];

  // Create multiple decks
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank });
      }
    }
  }

  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
    }
  }

  // Adjust for aces
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

// Check if a hand can be split (two cards of same rank)
function canSplit(hand) {
  if (hand.length !== 2) return false;
  // Cards must have the exact same rank to split
  return hand[0].rank === hand[1].rank;
}

async function createTableEmbed(game, guildId) {
  const playersArray = Array.from(game.players.values());
  
  let title = '🃏 Multiplayer Blackjack Table';
  let description = '';
  let color = 0x3498db; // Blue for waiting
  
  if (game.status === 'waiting') {
    color = 0x2ecc71; // Green for waiting
    title = 'Blackjack Table - Waiting for Players';
    
    if (playersArray.length === 0) {
      description = `**No players at table**\n\n` +
        `Use \`/blackjacktable join [bet]\` to join\n` +
        `Preset bets: ${PRESET_BETS.map(b => `**${b.toLocaleString()}**`).join(', ')}\n` +
        `Or use a custom amount â‰¥ 100\n` +
        `Maximum 4 players per table`;
    } else {
      description = `**Players at table: ${playersArray.length}/4**\n\n`;
      
      // Show players with their bets
      for (let i = 0; i < playersArray.length; i++) {
        const player = playersArray[i];
        description += `**${i + 1}.** ${player.displayName} - **${player.bet.toLocaleString()}** ${CURRENCY}\n`;
      }
      
      description += `\n Waiting for ${4 - playersArray.length} more players\n`;
      description += ` Or players can start the game manually`;
    }
  } else {
    // Game in progress
    title = ` Blackjack Table - ${game.status.replace('_', ' ').toUpperCase()}`;
    description = `**Players: ${playersArray.length}/4**\n\n`;
    
    // Show each player's status
    for (let i = 0; i < playersArray.length; i++) {
      const player = playersArray[i];
      const handValue = player.hand.length > 0 ? calculateHandValue(player.hand) : 0;
      const isCurrentPlayer = game.currentPlayer === player.id;
      
      let statusEmoji = '';
      if (isCurrentPlayer && game.status === 'playing') {
        statusEmoji = '👉 '; // During game - show current player
      } else if (game.status === 'finished' && player.finalResult) {
        // Show final win/loss results after game
        switch (player.finalResult) {
          case 'blackjack':
            statusEmoji = '🎰 '; // Blackjack win
            break;
          case 'win':
            statusEmoji = '🎉 '; // Regular win
            break;
          case 'push':
            statusEmoji = '🤝 '; // Push/tie
            break;
          case 'bust':
            statusEmoji = '💥 '; // Busted
            break;
          case 'loss':
            statusEmoji = '😔 '; // Lost to dealer
            break;
        }
      } else {
        // During game - show current action status
        if (player.status === 'blackjack') statusEmoji = '🎰 ';
        else if (player.status === 'bust') statusEmoji = '💥 ';
        else if (player.status === 'stand') statusEmoji = '✔️ ';
      }
      
      description += `${statusEmoji}**${player.displayName}**`;
      if (handValue > 0) {
        description += ` (${handValue})`;
      }
      description += ` - **${player.bet.toLocaleString()}** ${CURRENCY}\n`;
    }
    
    // Show dealer if cards are dealt
    if (game.dealer.hand.length > 0) {
      const visibleValue = game.status === 'dealer_turn' || game.status === 'finished' 
        ? calculateHandValue(game.dealer.hand) 
        : calculateHandValue([game.dealer.hand[0]]); // Only first card visible
      
      description += `\n${DEALER_EMOJI} **Dealer** (${visibleValue})`;
    }
  }

  // Generate table image
  const imageBuffer = await generateBlackjackTableImage(game);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack-table.png' });

  // Build footer with deck status
  const cardsRemaining = game.deck.length;
  const totalCards = game.totalCards || game.numDecks * 52;
  const deckInfo = `${game.numDecks} deck${game.numDecks > 1 ? 's' : ''} | ${cardsRemaining}/${totalCards} cards`;
  
  let footerText;
  if (game.status === 'waiting') {
    footerText = `Table created • ${playersArray.length}/4 players • ${deckInfo}`;
  } else if (game.status === 'finished') {
    footerText = `Game finished • ${deckInfo}`;
  } else {
    // Show turn timer if active
    let timerInfo = '';
    if (game.turnStartTime && game.currentPlayer) {
      const elapsed = Math.floor((Date.now() - game.turnStartTime) / 1000);
      const remaining = Math.max(0, TURN_TIME_LIMIT - elapsed);
      timerInfo = ` ${remaining}s`;
    }
    footerText = `Game in progress${timerInfo} • ${deckInfo}`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setImage('attachment://blackjack-table.png')
    .setFooter({ text: footerText })
    .setTimestamp();

  return { embed, attachment };
}

function createWaitingComponents(game) {
  const components = [];
  
  // If table is empty, show join buttons with preset amounts
  if (game.players.size === 0) {
    const row1 = new ActionRowBuilder();
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_table_join_100')
        .setLabel('Join (100)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('bj_table_join_250')
        .setLabel('Join (250)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('bj_table_join_500')
        .setLabel('Join (500)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('bj_table_join_1000')
        .setLabel('Join (1000)')
        .setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder();
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_table_join_2500')
        .setLabel('Join (2500)')
        .setStyle(ButtonStyle.Success)
        ,
      new ButtonBuilder()
        .setCustomId('bj_table_join_custom')
        .setLabel('Join (Custom)')
        .setStyle(ButtonStyle.Primary)
        
    );
    
    components.push(row1, row2);
  } else {
    // Players at table - show join and control buttons
    const row1 = new ActionRowBuilder();
    
    if (game.players.size < 4) {
      // Join buttons for when players are already at table
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId('bj_table_join_100')
          .setLabel('Join (100)')
          .setStyle(ButtonStyle.Success)
          ,
        new ButtonBuilder()
          .setCustomId('bj_table_join_250')
          .setLabel('Join (250)')
          .setStyle(ButtonStyle.Success)
          ,
        new ButtonBuilder()
          .setCustomId('bj_table_join_500')
          .setLabel('Join (500)')
          .setStyle(ButtonStyle.Success)
          
      );
      
      // Add more join options if space allows
      if (row1.components.length < 5) {
        row1.addComponents(
          new ButtonBuilder()
            .setCustomId('bj_table_join_custom')
            .setLabel('Custom Bet')
            .setStyle(ButtonStyle.Primary)
            
        );
      }
    }

    const row2 = new ActionRowBuilder();
    
    // Start game button (only show if 2+ players)
    if (game.players.size >= 2) {
      row2.addComponents(
        new ButtonBuilder()
          .setCustomId('bj_table_start')
          .setLabel(`Start Game (${game.players.size} players)`)
          .setStyle(ButtonStyle.Success)
      );
    }

    // Leave table button
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_table_leave')
        .setLabel('Leave Table')
        .setStyle(ButtonStyle.Danger)
    );
    
    if (row1.components.length > 0) components.push(row1);
    components.push(row2);
  }

  return components;
}

// Create buttons for insurance phase
function createInsuranceComponents(game) {
  const row = new ActionRowBuilder();
  
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('bj_table_insurance_yes')
      .setLabel('Take Insurance')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('bj_table_insurance_no')
      .setLabel('No Insurance')
      .setStyle(ButtonStyle.Secondary)
  );
  
  return [row];
}

function createGameComponents(game) {
  const currentPlayerId = game.currentPlayer;
  if (!currentPlayerId) return [];
  
  const player = game.players.get(currentPlayerId);
  if (!player || player.status !== 'playing') return [];
  
  const row = new ActionRowBuilder();
  
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('bj_table_hit')
      .setLabel('Hit')
      .setStyle(ButtonStyle.Primary)
      ,
    new ButtonBuilder()
      .setCustomId('bj_table_stand')
      .setLabel('Stand')
      .setStyle(ButtonStyle.Secondary)
      
  );

  // Double down only available on first two cards
  if (player.hand.length === 2 && !player.doubledDown && !player.isSplitHand) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_table_double')
        .setLabel('Double Down')
        .setStyle(ButtonStyle.Danger)
        
    );
  }

  // Split only available with two cards of same rank
  if (player.hand.length === 2 && !player.hasSplit && canSplit(player.hand)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_table_split')
        .setLabel('Split')
        .setStyle(ButtonStyle.Secondary)
        
    );
  }

  return [row];
}

// Create buttons for when game is finished
function createFinishedComponents(game) {
  const components = [];
  
  // Row 1: Play Again, Change Bet, and Leave buttons for current players
  const row1 = new ActionRowBuilder();
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('bj_table_play_again')
      .setLabel('Play Again')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('bj_table_change_bet')
      .setLabel('Change Bet')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('bj_table_leave_finished')
      .setLabel('Leave Table')
      .setStyle(ButtonStyle.Danger)
  );
  components.push(row1);
  
  // Row 2: Join buttons for new players (if table not full)
  if (game && game.players.size < 4) {
    const row2 = new ActionRowBuilder();
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_table_join_100')
        .setLabel('Join (100)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('bj_table_join_250')
        .setLabel('Join (250)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('bj_table_join_500')
        .setLabel('Join (500)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('bj_table_join_custom')
        .setLabel('Custom Bet')
        .setStyle(ButtonStyle.Secondary)
    );
    components.push(row2);
  }
  
  return components;
}

// Export button handlers
module.exports.handleTableButton = async function(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const action = interaction.customId;

  console.log(`Button pressed: ${action} by ${userId} in guild ${guildId}`);

  try {
    const game = multiplayerGames.get(guildId);
    if (!game) {
      console.log(`No game found for guild ${guildId}. Active games: ${Array.from(multiplayerGames.keys()).join(', ')}`);
      return interaction.reply({
        content: 'No active table found.',
        ephemeral: true
      }).catch(err => console.log('Failed to reply (no game):', err.message));
    }
    
    console.log(`Game found. Status: ${game.status}, Current player: ${game.currentPlayer}`);

    if (action === 'bj_table_leave') {
      return handleButtonLeave(interaction, game);
    }

    if (action === 'bj_table_start') {
      return handleStartGame(interaction, game);
    }

    // Game action buttons
    if (['bj_table_hit', 'bj_table_stand', 'bj_table_double', 'bj_table_split'].includes(action)) {
      return handleGameAction(interaction, game, action);
    }

    // Join buttons
    if (action.startsWith('bj_table_join_')) {
      return handleJoinButton(interaction, game, action);
    }

    // Post-game buttons
    if (action === 'bj_table_play_again') {
      return handlePlayAgain(interaction, game);
    }

    if (action === 'bj_table_leave_finished') {
      return handleLeaveFinished(interaction, game);
    }
    
    if (action === 'bj_table_change_bet') {
      return handleChangeBet(interaction, game);
    }
    
    // Insurance buttons
    if (action === 'bj_table_insurance_yes' || action === 'bj_table_insurance_no') {
      return handleInsuranceDecision(interaction, game, action);
    }
    
    // Unknown action - acknowledge to prevent Android timeout
    return interaction.deferUpdate().catch(() => {});
  } catch (error) {
    console.error('Error in handleTableButton:', error);
    // Try to respond if we haven't already
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: 'An error occurred. Please try again.',
        ephemeral: true
      }).catch(() => {});
    }
  }
};

// Handle custom bet modal
module.exports.handleCustomBetModal = async function(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const betAmountStr = interaction.fields.getTextInputValue('custom_bet_amount');

  const game = multiplayerGames.get(guildId);
  if (!game) {
    return interaction.reply({
      content: '❌ No active table found.',
      ephemeral: true
    });
  }

  // Check if player is already at the table
  if (game.players.has(userId)) {
    return interaction.reply({
      content: '❌ You are already at this table!',
      ephemeral: true
    });
  }

  // Check if table is full
  if (game.players.size >= 4) {
    return interaction.reply({
      content: '❌ Table is full! Maximum 4 players per table.',
      ephemeral: true
    });
  }

  // Check if game is in progress (can join during waiting or finished/between hands)
  if (game.status !== 'waiting' && game.status !== 'finished') {
    return interaction.reply({
      content: '❌ Game is in progress! Wait for the hand to finish.',
      ephemeral: true
    });
  }

  // Parse bet amount
  const betAmount = parseInt(betAmountStr);
  if (isNaN(betAmount) || betAmount < 100) {
    return interaction.reply({
      content: '❌ Invalid bet amount! Must be a number ≥ 100.',
      ephemeral: true
    });
  }

  return joinPlayerToTable(interaction, game, betAmount);
};

// Handle change bet modal
module.exports.handleChangeBetModal = async function(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const newBetStr = interaction.fields.getTextInputValue('new_bet_amount');

  const game = multiplayerGames.get(guildId);
  if (!game) {
    return interaction.reply({
      content: '! No active table found.',
      ephemeral: true
    });
  }

  const player = game.players.get(userId);
  if (!player) {
    return interaction.reply({
      content: '! You are not at this table.',
      ephemeral: true
    });
  }

  if (game.status !== 'finished') {
    return interaction.reply({
      content: '! You can only change your bet between hands.',
      ephemeral: true
    });
  }

  // Parse new bet amount
  const newBet = parseInt(newBetStr);
  if (isNaN(newBet) || newBet < 100) {
    return interaction.reply({
      content: '! Invalid bet amount! Must be a number >= 100.',
      ephemeral: true
    });
  }

  const oldBet = player.bet;
  const difference = newBet - oldBet;

  // Check if player can afford the increase
  if (difference > 0) {
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.total < difference) {
      return interaction.reply({
        content: `! You don't have enough to increase your bet! Need ${difference.toLocaleString()} more ${CURRENCY}, but you only have ${balanceData.total.toLocaleString()} ${CURRENCY}.`,
        ephemeral: true
      });
    }
    // Charge the difference
    await removeFromTotal(guildId, userId, difference, 'Multiplayer Blackjack - bet increase');
  } else if (difference < 0) {
    // Refund the difference
    await addMoney(guildId, userId, Math.abs(difference), 'Multiplayer Blackjack - bet decrease');
  }

  // Update player's bet
  player.bet = newBet;
  
  // Cancel cleanup timer since player is active
  if (cleanupTimers.has(guildId)) {
    clearTimeout(cleanupTimers.get(guildId));
    cleanupTimers.delete(guildId);
  }
  
  game.lastActivity = Date.now();

  await interaction.deferUpdate();

  // Update display
  const { embed, attachment } = await createTableEmbed(game, guildId);
  const readyCount = Array.from(game.players.values()).filter(p => p.readyForNext).length;
  embed.setFooter({ text: `Waiting for players to ready up... (${readyCount}/${game.players.size} ready)` });
  
  return interaction.editReply({ 
    embeds: [embed], 
    files: [attachment], 
    components: createFinishedComponents(game) 
  });
};

async function handleButtonLeave(interaction, game) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  const player = game.players.get(userId);
  if (!player) {
    return interaction.reply({
      content: '❌ You are not at this table.',
      ephemeral: true
    });
  }

  if (game.status !== 'waiting') {
    return interaction.reply({
      content: '❌ Cannot leave during an active game!',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  // Return bet
  await addMoney(guildId, userId, player.bet, 'Multiplayer Blackjack - left table');
  
  // Remove player
  game.players.delete(userId);

  // If no players left, clean up
  if (game.players.size === 0) {
    multiplayerGames.delete(guildId);
    return interaction.editReply({
      content: '✔ Table closed - no players remaining.',
      embeds: [],
      files: [],
      components: []
    });
  }

  // Update table display
  const { embed, attachment } = await createTableEmbed(game, guildId);
  const components = createWaitingComponents(game);
  
  return interaction.editReply({ embeds: [embed], files: [attachment], components });
}

async function handleInsuranceDecision(interaction, game, action) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // Check if game is in insurance phase
  if (game.status !== 'insurance') {
    return interaction.reply({
      content: '! Insurance is not currently available.',
      ephemeral: true
    });
  }

  const player = game.players.get(userId);
  if (!player) {
    return interaction.reply({
      content: '! You are not at this table.',
      ephemeral: true
    });
  }

  // Check if player already decided
  if (player.insuranceDecided) {
    return interaction.reply({
      content: '! You have already made your insurance decision.',
      ephemeral: true
    });
  }

  // Check if player has blackjack (they don't need insurance)
  if (player.status === 'blackjack') {
    return interaction.reply({
      content: '! You have Blackjack - no need for insurance!',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  if (action === 'bj_table_insurance_yes') {
    // Insurance costs half the original bet
    const insuranceAmount = Math.floor(player.bet / 2);
    
    // Check if player can afford insurance
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.total < insuranceAmount) {
      player.insuranceDecided = true;
      player.insurance = 0;
      await interaction.followUp({
        content: `! You don't have enough for insurance (${insuranceAmount.toLocaleString()} ${CURRENCY} needed). Insurance declined.`,
        ephemeral: true
      });
    } else {
      // Charge insurance
      await removeFromTotal(guildId, userId, insuranceAmount, 'Multiplayer Blackjack - insurance');
      player.insurance = insuranceAmount;
      player.insuranceDecided = true;
      console.log(`${player.displayName} took insurance for ${insuranceAmount}`);
    }
  } else {
    // Declined insurance
    player.insurance = 0;
    player.insuranceDecided = true;
    console.log(`${player.displayName} declined insurance`);
  }

  game.lastActivity = Date.now();

  // Check if all players have decided
  if (allPlayersDecidedInsurance(game)) {
    // Proceed to check dealer blackjack and start play
    await proceedAfterInsurance(game);
  } else {
    // Update display to show who has decided
    const { embed, attachment } = await createTableEmbed(game, guildId);
    const decidedCount = Array.from(game.players.values()).filter(p => p.insuranceDecided).length;
    const totalNeedDecision = Array.from(game.players.values()).filter(p => p.status !== 'blackjack').length;
    embed.setFooter({ text: `Insurance: ${decidedCount}/${totalNeedDecision} players have decided` });
    
    return interaction.editReply({ 
      embeds: [embed], 
      files: [attachment], 
      components: createInsuranceComponents(game) 
    });
  }
}

async function handlePlayAgain(interaction, game) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  const player = game.players.get(userId);
  if (!player) {
    return interaction.reply({
      content: '! You are not at this table.',
      ephemeral: true
    });
  }

  if (game.status !== 'finished') {
    return interaction.reply({
      content: '! Game is not finished yet.',
      ephemeral: true
    });
  }

  // Check if player has enough money for another round with same bet
  const balanceData = await getBalance(guildId, userId);
  if (balanceData.total < player.bet) {
    return interaction.reply({
      content: `! You don't have enough money for another round. Balance: ${balanceData.total.toLocaleString()} UBB, Bet: ${player.bet.toLocaleString()} UBB`,
      ephemeral: true
    });
  }

  // Cancel the cleanup timer as soon as any player clicks Play Again
  if (cleanupTimers.has(guildId)) {
    clearTimeout(cleanupTimers.get(guildId));
    cleanupTimers.delete(guildId);
    console.log(`Cancelled cleanup timer (player ready) for guild ${guildId}`);
  }

  // Mark this player as ready for next round
  player.readyForNext = true;
  game.lastActivity = Date.now(); // Keep game active

  // Check if all players are ready
  const allPlayersReady = Array.from(game.players.values()).every(p => p.readyForNext);

  await interaction.deferUpdate();

  if (allPlayersReady) {
    // Start a new round
    return await startNewRound(game, interaction);
  } else {
    // Show waiting status
    const readyCount = Array.from(game.players.values()).filter(p => p.readyForNext).length;
    const totalCount = game.players.size;
    
    const { embed, attachment } = await createTableEmbed(game, guildId);
    embed.setFooter({ text: `Waiting for players to ready up... (${readyCount}/${totalCount} ready)` });
    
    return interaction.editReply({ embeds: [embed], files: [attachment], components: createFinishedComponents(game) });
  }
}

async function handleLeaveFinished(interaction, game) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  const player = game.players.get(userId);
  if (!player) {
    return interaction.reply({
      content: '! You are not at this table.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  // Remove player from table
  game.players.delete(userId);

  // If no players left, clean up the table
  if (game.players.size === 0) {
    multiplayerGames.delete(guildId);
    return interaction.editReply({
      content: 'Table closed - all players left.',
      embeds: [],
      files: [],
      components: []
    });
  }

  // Check if remaining players are all ready
  const allPlayersReady = Array.from(game.players.values()).every(p => p.readyForNext);

  if (allPlayersReady && game.status === 'finished') {
    // Start new round with remaining players
    await startNewRound(game, interaction);
  } else {
    // Update the display
    const { embed, attachment } = await createTableEmbed(game, guildId);
    
    let components;
    if (game.status === 'finished') {
      const readyCount = Array.from(game.players.values()).filter(p => p.readyForNext).length;
      embed.setFooter({ text: `Waiting for players to ready up... (${readyCount}/${game.players.size} ready)` });
      components = createFinishedComponents(game);
    } else {
      components = createWaitingComponents(game);
    }
    
    return interaction.editReply({ embeds: [embed], files: [attachment], components });
  }
}

async function handleChangeBet(interaction, game) {
  const userId = interaction.user.id;

  const player = game.players.get(userId);
  if (!player) {
    return interaction.reply({
      content: '! You are not at this table.',
      ephemeral: true
    });
  }

  if (game.status !== 'finished') {
    return interaction.reply({
      content: '! You can only change your bet between hands.',
      ephemeral: true
    });
  }

  // Show modal for new bet amount
  const modal = new ModalBuilder()
    .setCustomId('bj_table_change_bet_modal')
    .setTitle('Change Your Bet');

  const betInput = new TextInputBuilder()
    .setCustomId('new_bet_amount')
    .setLabel(`Current bet: ${player.bet.toLocaleString()} - Enter new amount`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(10)
    .setPlaceholder(player.bet.toString())
    .setRequired(true);

  const firstActionRow = new ActionRowBuilder().addComponents(betInput);
  modal.addComponents(firstActionRow);

  return interaction.showModal(modal);
}

async function startNewRound(game, interaction) {
  const guildId = game.guildId;
  
  // Deduct bets from all players
  for (const [playerId, player] of game.players) {
    const balanceData = await getBalance(guildId, playerId);
    if (balanceData.total < player.bet) {
      // Player can't afford bet, remove them
      game.players.delete(playerId);
      continue;
    }
    await removeMoney(guildId, playerId, player.bet, 'Multiplayer Blackjack - new round bet');
    
    // Reset player state
    player.hands = [[]];
    player.currentHandIndex = 0;
    player.standing = [false];
    player.busted = [false];
    player.doubled = [false];
    player.result = null;
    player.winAmount = 0;
    player.readyForNext = false;
  }

  // Check if enough players remain
  if (game.players.size < 2) {
    // Refund remaining player and close
    for (const [playerId, player] of game.players) {
      await addMoney(guildId, playerId, player.bet, 'Multiplayer Blackjack - not enough players');
    }
    multiplayerGames.delete(guildId);
    return interaction.editReply({
      content: 'Table closed - not enough players for another round.',
      embeds: [],
      files: [],
      components: []
    });
  }

  // Store channel reference for timer updates
  game.channelId = interaction.channelId;
  game.client = interaction.client;

  // Cancel any pending cleanup timer from previous round
  if (cleanupTimers.has(guildId)) {
    clearTimeout(cleanupTimers.get(guildId));
    cleanupTimers.delete(guildId);
    console.log(`Cancelled cleanup timer for new round in guild ${guildId}`);
  }

  // Check if deck needs reshuffling (less than 20 cards remaining)
  if (game.deck.length < 20) {
    const settings = getGamblingSettings(guildId);
    const numDecks = settings.blackjack_decks || 2;
    game.deck = shuffleDeck(numDecks);
    console.log(`Reshuffled deck for new round (${game.deck.length} cards)`);
  }

  // Use startMultiplayerGame to reset and deal cards
  startMultiplayerGame(game);
  
  console.log(`New round started. Game status: ${game.status}, Current player: ${game.currentPlayer}`);
  
  // Update display
  const { embed, attachment } = await createTableEmbed(game, guildId);
  
  // Check if insurance phase
  let components;
  if (game.status === 'insurance') {
    components = createInsuranceComponents(game);
    embed.setFooter({ text: 'Dealer shows Ace! Take insurance? (15 seconds to decide)' });
    // Start insurance timer
    startInsuranceTimer(game);
  } else {
    components = createGameComponents(game);
    // Start turn timer for first player
    startTurnTimer(game);
  }
  
  const reply = await interaction.editReply({ embeds: [embed], files: [attachment], components });
  game.messageId = reply.id;
  
  return reply;
}

async function handleStartGame(interaction, game) {
  const userId = interaction.user.id;

  if (!game.players.has(userId)) {
    return interaction.reply({
      content: '! You must be at the table to start the game.',
      ephemeral: true
    });
  }

  if (game.players.size < 2) {
    return interaction.reply({
      content: '! Need at least 2 players to start.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();
  
  // Start the game
  startMultiplayerGame(game);
  
  // Store channel reference for timer updates
  game.channelId = interaction.channelId;
  game.client = interaction.client;
  
  // Update display
  const { embed, attachment } = await createTableEmbed(game, game.guildId);
  
  // Check if insurance phase
  let components;
  if (game.status === 'insurance') {
    components = createInsuranceComponents(game);
    embed.setFooter({ text: 'Dealer shows Ace! Take insurance? (15 seconds to decide)' });
    // Start insurance timer
    startInsuranceTimer(game);
  } else {
    components = createGameComponents(game);
    // Start turn timer for first player
    startTurnTimer(game);
  }
  
  const reply = await interaction.editReply({ embeds: [embed], files: [attachment], components });
  game.messageId = reply.id;
  
  return reply;
}

function startMultiplayerGame(game) {
  game.status = 'dealing';
  game.startTime = new Date();
  
  // Reset all players
  for (const player of game.players.values()) {
    player.hand = [];
    player.status = 'playing';
    player.insurance = 0;
    player.doubledDown = false;
  }
  
  // Reset dealer
  game.dealer.hand = [];
  game.dealer.holeCard = null;
  
  // Deal initial cards
  const playersArray = Array.from(game.players.values());
  
  // Deal first card to each player
  for (const player of playersArray) {
    player.hand.push(game.deck.pop());
  }
  
  // Deal first card to dealer (hole card - face down)
  game.dealer.holeCard = game.deck.pop();
  
  // Deal second card to each player
  for (const player of playersArray) {
    player.hand.push(game.deck.pop());
  }
  
  // Deal second card to dealer (face up)
  game.dealer.hand.push(game.deck.pop());
  
  // Check for blackjacks and set first player
  checkForBlackjacks(game);
  
  // Check if dealer shows an Ace - offer insurance
  const dealerUpcard = game.dealer.hand[0];
  if (dealerUpcard && dealerUpcard.rank === 'A') {
    game.status = 'insurance';
    game.insuranceDeadline = Date.now() + 15000; // 15 seconds to decide
    // Mark all non-blackjack players as needing to decide on insurance
    for (const player of game.players.values()) {
      if (player.status !== 'blackjack') {
        player.insuranceDecided = false;
      } else {
        player.insuranceDecided = true; // Blackjack players don't need insurance
      }
    }
    console.log('Dealer shows Ace - offering insurance to all players');
    return; // Don't set next player yet
  }
  
  // Set the first player (start from beginning)
  game.currentPlayer = null; // Reset current player
  setNextPlayer(game);
  
  console.log(`Game started with ${game.players.size} players. First player: ${game.currentPlayer ? game.players.get(game.currentPlayer)?.displayName : 'NONE'}`);
  
  game.status = 'playing';
}

function checkForBlackjacks(game) {
  for (const player of game.players.values()) {
    if (calculateHandValue(player.hand) === 21) {
      player.status = 'blackjack';
    }
  }
}

function setNextPlayer(game) {
  const playersArray = Array.from(game.players.values());
  
  // Find current player index
  let currentIndex = -1;
  if (game.currentPlayer) {
    currentIndex = playersArray.findIndex(p => p.id === game.currentPlayer);
  }
  
  // Look for next player who can still play, starting from after current player
  for (let i = currentIndex + 1; i < playersArray.length; i++) {
    const player = playersArray[i];
    if (player.status === 'playing') {
      game.currentPlayer = player.id;
      return;
    }
  }
  
  // If no player found after current, check from beginning
  for (let i = 0; i <= currentIndex; i++) {
    const player = playersArray[i];
    if (player.status === 'playing') {
      game.currentPlayer = player.id;
      return;
    }
  }
  
  // No players can play, move to dealer
  game.currentPlayer = null;
  game.status = 'dealer_turn';
}

// Start turn timer for current player
function startTurnTimer(game) {
  const guildId = game.guildId;
  
  // Clear any existing timers
  clearTurnTimer(guildId);
  
  // Don't start timer if no current player or game is over
  if (!game.currentPlayer || game.status !== 'playing') {
    return;
  }
  
  game.turnStartTime = Date.now();
  game.turnTimeRemaining = TURN_TIME_LIMIT;
  
  // Set warning timer (fires when TURN_WARNING_TIME seconds remain)
  const warningDelay = (TURN_TIME_LIMIT - TURN_WARNING_TIME) * 1000;
  const warningTimer = setTimeout(async () => {
    try {
      await sendTurnWarning(game);
    } catch (error) {
      console.error('Error sending turn warning:', error);
    }
  }, warningDelay);
  
  // Set main timer (auto-stand when time expires)
  const mainTimer = setTimeout(async () => {
    try {
      await handleTurnTimeout(game);
    } catch (error) {
      console.error('Error handling turn timeout:', error);
    }
  }, TURN_TIME_LIMIT * 1000);
  
  turnTimers.set(guildId, { timer: mainTimer, warningTimer });
  console.log(`Turn timer started for ${game.players.get(game.currentPlayer)?.displayName} (${TURN_TIME_LIMIT}s)`);
}

// Clear turn timer
function clearTurnTimer(guildId) {
  const timers = turnTimers.get(guildId);
  if (timers) {
    clearTimeout(timers.timer);
    clearTimeout(timers.warningTimer);
    turnTimers.delete(guildId);
  }
}

// Send warning message when time is running low
async function sendTurnWarning(game) {
  if (!game.client || !game.channelId || !game.currentPlayer) return;
  
  const player = game.players.get(game.currentPlayer);
  if (!player) return;
  
  const realUserId = player.realUserId || player.id;
  
  try {
    const channel = await game.client.channels.fetch(game.channelId);
    if (channel) {
      await channel.send({
        content: `⏰ <@${realUserId}> - **${TURN_WARNING_TIME} seconds** remaining! Make your move or you'll auto-stand!`,
      });
    }
  } catch (error) {
    console.error('Error sending turn warning:', error);
  }
}

// Handle turn timeout - auto-stand the player
async function handleTurnTimeout(game) {
  if (!game.currentPlayer || game.status !== 'playing') return;
  
  const player = game.players.get(game.currentPlayer);
  if (!player || player.status !== 'playing') return;
  
  console.log(`⏰ Turn timeout for ${player.displayName} - auto-standing`);
  
  // Auto-stand the player
  player.status = 'stand';
  player.timedOut = true;
  
  // Move to next player
  setNextPlayer(game);
  
  // Check if we need dealer turn
  if (game.status === 'dealer_turn') {
    await playDealerTurn(game);
  }
  
  // Update the game display
  await updateGameDisplay(game, `⏰ **${player.displayName}** ran out of time and auto-stood!`);
  
  // Start timer for next player if game continues
  if (game.status === 'playing' && game.currentPlayer) {
    startTurnTimer(game);
  }
}

// Update game display (used by timer)
async function updateGameDisplay(game, message = null) {
  if (!game.client || !game.channelId) return;
  
  try {
    const channel = await game.client.channels.fetch(game.channelId);
    if (!channel) return;
    
    const { embed, attachment } = await createTableEmbed(game, game.guildId);
    let components;
    if (game.status === 'playing') {
      components = createGameComponents(game);
    } else if (game.status === 'finished') {
      components = createFinishedComponents(game);
    } else {
      components = [];
    }
    
    // Delete old message and send new one at bottom of chat
    if (game.messageId) {
      try {
        const msg = await channel.messages.fetch(game.messageId);
        await msg.delete();
      } catch (e) {
        // Message might already be deleted, that's fine
      }
    }
    
    // Send new message at bottom
    const newMsg = await channel.send({ embeds: [embed], files: [attachment], components });
    game.messageId = newMsg.id;
    
    // Send timeout notification if provided
    if (message) {
      await channel.send({ content: message });
    }
  } catch (error) {
    console.error('Error updating game display:', error);
  }
}

// Insurance timer storage
const insuranceTimers = new Map(); // guildId -> timer

// Start insurance decision timer
function startInsuranceTimer(game) {
  const guildId = game.guildId;
  
  // Clear any existing timer
  clearInsuranceTimer(guildId);
  
  // 15 seconds to decide on insurance
  const timer = setTimeout(async () => {
    try {
      await handleInsuranceTimeout(game);
    } catch (error) {
      console.error('Error handling insurance timeout:', error);
    }
  }, 15000);
  
  insuranceTimers.set(guildId, timer);
}

// Clear insurance timer
function clearInsuranceTimer(guildId) {
  const timer = insuranceTimers.get(guildId);
  if (timer) {
    clearTimeout(timer);
    insuranceTimers.delete(guildId);
  }
}

// Handle insurance timeout - auto-decline for undecided players
async function handleInsuranceTimeout(game) {
  if (game.status !== 'insurance') return;
  
  console.log('Insurance timeout - auto-declining for undecided players');
  
  // Auto-decline for anyone who hasn't decided
  for (const player of game.players.values()) {
    if (!player.insuranceDecided) {
      player.insuranceDecided = true;
      player.insurance = 0;
    }
  }
  
  // Proceed to check dealer blackjack and start play
  await proceedAfterInsurance(game);
}

// Check if all players have decided on insurance
function allPlayersDecidedInsurance(game) {
  for (const player of game.players.values()) {
    if (!player.insuranceDecided) {
      return false;
    }
  }
  return true;
}

// Proceed after all insurance decisions are made
async function proceedAfterInsurance(game) {
  const guildId = game.guildId;
  
  // Clear the insurance timer
  clearInsuranceTimer(guildId);
  
  // Check if dealer has blackjack
  const dealerHand = [game.dealer.holeCard, ...game.dealer.hand];
  const dealerValue = calculateHandValue(dealerHand);
  const dealerHasBlackjack = dealerValue === 21;
  
  if (dealerHasBlackjack) {
    console.log('Dealer has blackjack!');
    game.dealer.hand = dealerHand; // Reveal hole card
    game.dealer.holeCard = null;
    
    // Pay out insurance (2:1)
    for (const player of game.players.values()) {
      if (player.insurance > 0) {
        const insurancePayout = player.insurance * 3; // Original bet + 2:1 winnings
        await addMoney(guildId, player.id, insurancePayout, 'Multiplayer Blackjack - insurance payout');
        player.insuranceWon = true;
      }
      
      // Players with blackjack push against dealer blackjack
      if (player.status === 'blackjack') {
        player.status = 'push';
        await addMoney(guildId, player.id, player.bet, 'Multiplayer Blackjack - push');
      } else {
        // All other players lose to dealer blackjack
        player.status = 'dealer_blackjack';
      }
    }
    
    game.status = 'finished';
    game.dealerHasBlackjack = true;
    
    // Update display
    await updateGameDisplayAfterInsurance(game);
    return;
  }
  
  // Dealer doesn't have blackjack - players lose insurance bets
  console.log('Dealer does not have blackjack - insurance bets lost');
  for (const player of game.players.values()) {
    if (player.insurance > 0) {
      player.insuranceLost = true;
    }
  }
  
  // Continue to normal play
  game.currentPlayer = null;
  setNextPlayer(game);
  game.status = 'playing';
  
  // Update display and start turn timer
  await updateGameDisplayAfterInsurance(game);
  
  if (game.currentPlayer) {
    startTurnTimer(game);
  }
}

// Update game display after insurance phase
async function updateGameDisplayAfterInsurance(game) {
  if (!game.client || !game.channelId) return;
  
  try {
    const channel = await game.client.channels.fetch(game.channelId);
    if (!channel) return;
    
    const { embed, attachment } = await createTableEmbed(game, game.guildId);
    
    let components;
    if (game.status === 'finished') {
      components = createFinishedComponents(game);
    } else if (game.status === 'playing') {
      components = createGameComponents(game);
    } else {
      components = [];
    }
    
    // Build insurance result message
    let insuranceMsg = '';
    if (game.dealerHasBlackjack) {
      insuranceMsg = 'Dealer has Blackjack!';
      for (const player of game.players.values()) {
        if (player.insuranceWon) {
          insuranceMsg += ` ${player.displayName} won insurance!`;
        }
      }
    } else {
      const insuranceLosers = Array.from(game.players.values()).filter(p => p.insuranceLost);
      if (insuranceLosers.length > 0) {
        insuranceMsg = 'Dealer does not have Blackjack. Insurance bets lost.';
      }
    }
    
    if (insuranceMsg) {
      embed.setFooter({ text: insuranceMsg });
    }
    
    // Delete old message and send new one at bottom of chat
    if (game.messageId) {
      try {
        const msg = await channel.messages.fetch(game.messageId);
        await msg.delete();
      } catch (e) {
        // Message might already be deleted, that's fine
      }
    }
    
    // Send new message at bottom
    const newMsg = await channel.send({ embeds: [embed], files: [attachment], components });
    game.messageId = newMsg.id;
  } catch (error) {
    console.error('Error updating game display after insurance:', error);
  }
}

async function handleGameAction(interaction, game, action) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // Check if it's this user's turn (either main hand or split hand)
  const currentPlayer = game.players.get(game.currentPlayer);
  const isUsersTurn = game.currentPlayer === userId || 
                      (currentPlayer && currentPlayer.realUserId === userId);
  
  if (!isUsersTurn) {
    return interaction.reply({
      content: '❌ It\'s not your turn!',
      ephemeral: true
    });
  }

  // Get the actual player object (could be main hand or split hand)
  const player = game.players.get(game.currentPlayer);
  if (!player || player.status !== 'playing') {
    return interaction.reply({
      content: '❌ You cannot perform this action.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();
  
  // Clear the turn timer since player took action
  clearTurnTimer(guildId);
  game.lastActivity = Date.now();

  console.log(`ðŸƒ Player ${player.displayName} performing action: ${action}`);

  if (action === 'bj_table_hit') {
    // Hit
    player.hand.push(game.deck.pop());
    
    const handValue = calculateHandValue(player.hand);
    console.log(`ðŸƒ ${player.displayName} hit, hand value: ${handValue}`);
    
    if (handValue > 21) {
      player.status = 'bust';
      console.log(`ðŸƒ ${player.displayName} busted`);
      setNextPlayer(game);
    } else if (handValue === 21) {
      player.status = 'stand';
      console.log(`ðŸƒ ${player.displayName} got 21, auto-standing`);
      setNextPlayer(game);
    }
    // Otherwise player continues (don't call setNextPlayer)
    
  } else if (action === 'bj_table_stand') {
    // Stand
    player.status = 'stand';
    console.log(`ðŸƒ ${player.displayName} stands`);
    setNextPlayer(game);
    
  } else if (action === 'bj_table_double') {
    // Double down - need to check balance and charge
    const realUserId = player.realUserId || userId;
    const balanceData = await getBalance(guildId, realUserId);
    if (balanceData.total < player.bet) {
      return interaction.followUp({
        content: `❌ You need **${player.bet.toLocaleString()}** more ${CURRENCY} to double down!`,
        ephemeral: true
      });
    }
    
    await removeFromTotal(guildId, realUserId, player.bet, 'Multiplayer Blackjack double down');
    player.bet *= 2;
    player.doubledDown = true;
    
    // Hit once and stand
    player.hand.push(game.deck.pop());
    
    const handValue = calculateHandValue(player.hand);
    console.log(`ðŸƒ ${player.displayName} doubled down, hand value: ${handValue}`);
    
    if (handValue > 21) {
      player.status = 'bust';
    } else {
      player.status = 'stand';
    }
    
    setNextPlayer(game);
  } else if (action === 'bj_table_split') {
    // Split - need to check balance for second hand
    if (!canSplit(player.hand)) {
      return interaction.followUp({
        content: '❌ You cannot split this hand!',
        ephemeral: true
      });
    }
    
    const realUserId = player.realUserId || userId;
    const balanceData = await getBalance(guildId, realUserId);
    if (balanceData.total < player.bet) {
      return interaction.followUp({
        content: `❌ You need **${player.bet.toLocaleString()}** more ${CURRENCY} to split!`,
        ephemeral: true
      });
    }
    
    await removeFromTotal(guildId, realUserId, player.bet, 'Multiplayer Blackjack split');
    
    // Create split hand as a new "player" entry
    const splitCard = player.hand.pop(); // Take second card
    player.hasSplit = true;
    
    // Deal new card to original hand
    player.hand.push(game.deck.pop());
    
    // Create split hand player
    const splitPlayer = {
      id: `${userId}_split`,
      realUserId: userId, // Track the real user for payouts
      username: player.username,
      displayName: `${player.displayName} (Split)`,
      avatar: player.avatar,
      bet: player.bet / 2, // Original bet was doubled, so each hand has half
      hand: [splitCard],
      status: 'playing',
      insurance: 0,
      doubledDown: false,
      isSplitHand: true,
      hasSplit: false
    };
    
    // Correct the bet - player keeps original bet, split hand gets same bet
    splitPlayer.bet = player.bet;
    
    // Deal card to split hand
    splitPlayer.hand.push(game.deck.pop());
    
    // Insert split hand right after current player in the map
    const playersArray = Array.from(game.players.entries());
    const playerIndex = playersArray.findIndex(([id]) => id === userId);
    const newPlayersArray = [
      ...playersArray.slice(0, playerIndex + 1),
      [splitPlayer.id, splitPlayer],
      ...playersArray.slice(playerIndex + 1)
    ];
    game.players = new Map(newPlayersArray);
    
    console.log(`ðŸƒ ${player.displayName} split their hand`);
    
    // Check for 21 on either hand
    if (calculateHandValue(player.hand) === 21) {
      player.status = 'stand';
      setNextPlayer(game);
    }
    // Player continues with their first hand
  }

  console.log(`ðŸƒ Next player: ${game.currentPlayer ? game.players.get(game.currentPlayer)?.displayName : 'DEALER'}`);

  // Check if we need to start dealer turn
  if (game.status === 'dealer_turn') {
    console.log('ðŸƒ Starting dealer turn');
    await playDealerTurn(game);
  }

  // Update display
  const { embed, attachment } = await createTableEmbed(game, guildId);
  let components = [];
  if (game.status === 'playing') {
    components = createGameComponents(game);
  } else if (game.status === 'finished') {
    components = createFinishedComponents(game);
  }
  
  // Start timer for next player if game continues
  if (game.status === 'playing' && game.currentPlayer) {
    startTurnTimer(game);
  }
  
  // Delete old message and send new one at bottom of chat
  try {
    const channel = await interaction.client.channels.fetch(game.channelId);
    
    // Delete the current interaction message (which is the game embed)
    try {
      await interaction.deleteReply();
    } catch (e) {
      // Message might already be deleted
    }
    
    // Send new message at bottom
    const newMsg = await channel.send({ embeds: [embed], files: [attachment], components });
    game.messageId = newMsg.id;
    return;
  } catch (error) {
    console.error('Error refreshing game display:', error);
    // Fallback to editing in place if channel send fails
    return interaction.editReply({ embeds: [embed], files: [attachment], components });
  }
}

async function playDealerTurn(game) {
  // Reveal hole card
  game.dealer.hand.unshift(game.dealer.holeCard);
  game.dealer.holeCard = null;
  
  // Dealer hits until 17 or higher
  while (calculateHandValue(game.dealer.hand) < 17) {
    game.dealer.hand.push(game.deck.pop());
  }
  
  // Determine winners and pay out
  await resolveGame(game);
}

async function resolveGame(game) {
  const dealerValue = calculateHandValue(game.dealer.hand);
  const dealerBust = dealerValue > 21;
  const dealerHasBlackjack = dealerValue === 21 && game.dealer.hand.length === 2;
  const guildId = game.guildId;
  
  for (const player of game.players.values()) {
    const playerValue = calculateHandValue(player.hand);
    const playerHasBlackjack = player.status === 'blackjack' && player.hand.length === 2;
    let winnings = 0;
    let result = 'loss'; // Track the actual result
    
    if (playerHasBlackjack) {
      // Natural blackjack - only pushes against dealer natural blackjack
      if (dealerHasBlackjack) {
        // Both have natural blackjack - push
        winnings = player.bet;
        result = 'push';
      } else {
        // Player blackjack beats everything else (including dealer 21 with 3+ cards)
        winnings = Math.floor(player.bet * 2.5);
        result = 'blackjack';
      }
    } else if (player.status === 'bust') {
      // Player busted, loses
      winnings = 0;
      result = 'bust';
    } else {
      // Regular comparison
      if (dealerBust || playerValue > dealerValue) {
        // Player wins
        winnings = player.bet * 2;
        result = 'win';
      } else if (playerValue === dealerValue) {
        // Push (but dealer blackjack beats non-blackjack 21)
        if (dealerHasBlackjack) {
          winnings = 0;
          result = 'loss';
        } else {
          winnings = player.bet;
          result = 'push';
        }
      } else {
        // Dealer wins
        winnings = 0;
        result = 'loss';
      }
    }
    
    // Store the final result for display
    player.finalResult = result;
    
    if (winnings > 0) {
      // Use realUserId for split hands, otherwise use player.id
      const payoutUserId = player.realUserId || player.id;
      await addMoney(guildId, payoutUserId, winnings, 'Multiplayer Blackjack win');
    }
  }
  
  game.status = 'finished';
  
  // Clear any turn timers
  clearTurnTimer(guildId);
  
  // Clear any existing cleanup timer
  if (cleanupTimers.has(guildId)) {
    clearTimeout(cleanupTimers.get(guildId));
  }
  
  // Auto-cleanup after 60 seconds (gives time for Play Again)
  const cleanupTimer = setTimeout(() => {
    if (multiplayerGames.has(guildId)) {
      const g = multiplayerGames.get(guildId);
      // Only delete if still finished (not if new round started)
      if (g.status === 'finished') {
        console.log(`Cleanup timer: deleting finished game for guild ${guildId}`);
        multiplayerGames.delete(guildId);
      }
    }
    cleanupTimers.delete(guildId);
  }, 60000);
  cleanupTimers.set(guildId, cleanupTimer);
}

async function handleJoinButton(interaction, game, action) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // Check if player is already at the table
  if (game.players.has(userId)) {
    return interaction.reply({
      content: '❌ You are already at this table!',
      ephemeral: true
    });
  }

  // Check if table is full
  if (game.players.size >= 4) {
    return interaction.reply({
      content: '❌ Table is full! Maximum 4 players per table.',
      ephemeral: true
    });
  }

  // Check if game is in progress (can join during waiting or finished/between hands)
  if (game.status !== 'waiting' && game.status !== 'finished') {
    return interaction.reply({
      content: '❌ Game is in progress! Wait for the hand to finish.',
      ephemeral: true
    });
  }

  if (action === 'bj_table_join_custom') {
    // Show modal for custom bet amount
    const modal = new ModalBuilder()
      .setCustomId('bj_table_custom_bet')
      .setTitle('Enter Custom Bet Amount');

    const betInput = new TextInputBuilder()
      .setCustomId('custom_bet_amount')
      .setLabel('Bet Amount (minimum 100)')
      .setStyle(TextInputStyle.Short)
      .setMinLength(3)
      .setMaxLength(10)
      .setPlaceholder('1337')
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(betInput);
    modal.addComponents(firstActionRow);

    return interaction.showModal(modal);
  }

  // Handle preset bet amounts
  let betAmount;
  if (action === 'bj_table_join_100') betAmount = 100;
  else if (action === 'bj_table_join_250') betAmount = 250;
  else if (action === 'bj_table_join_500') betAmount = 500;
  else if (action === 'bj_table_join_1000') betAmount = 1000;
  else if (action === 'bj_table_join_2500') betAmount = 2500;
  else {
    return interaction.reply({
      content: '❌ Invalid join action.',
      ephemeral: true
    });
  }

  return joinPlayerToTable(interaction, game, betAmount);
}

async function joinPlayerToTable(interaction, game, betAmount) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // Check balance
  const balanceData = await getBalance(guildId, userId);
  if (balanceData.total < betAmount) {
    return interaction.reply({
      content: `❌ You don't have enough! Your balance: **${balanceData.total.toLocaleString()}** ${CURRENCY}`,
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  // Charge bet
  await removeFromTotal(guildId, userId, betAmount, 'Multiplayer Blackjack bet');
  
  const player = {
    id: userId,
    username: interaction.user.username,
    displayName: interaction.user.displayName || interaction.user.username,
    avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
    bet: betAmount,
    hand: [],
    status: 'waiting',
    insurance: 0,
    doubledDown: false,
    readyForNext: game.status === 'finished' // Auto-ready if joining between hands
  };

  game.players.set(userId, player);
  game.lastActivity = Date.now();
  
  // Cancel cleanup timer if someone joins between hands
  if (game.status === 'finished' && cleanupTimers.has(guildId)) {
    clearTimeout(cleanupTimers.get(guildId));
    cleanupTimers.delete(guildId);
    console.log(`Cancelled cleanup timer (new player joined) for guild ${guildId}`);
  }

  // Update table display
  const { embed, attachment } = await createTableEmbed(game, guildId);
  
  let components;
  if (game.status === 'finished') {
    // Show finished components with join buttons for between hands
    const readyCount = Array.from(game.players.values()).filter(p => p.readyForNext).length;
    embed.setFooter({ text: `Waiting for players to ready up... (${readyCount}/${game.players.size} ready)` });
    components = createFinishedComponents(game);
  } else {
    components = createWaitingComponents(game);
  }
  
  await interaction.editReply({ 
    content: `✔ **${interaction.user.displayName}** joined the table! (${player.bet.toLocaleString()} ${CURRENCY})`,
    embeds: [embed], 
    files: [attachment], 
    components 
  });
}


