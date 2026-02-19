// Screw Your Neighbor - Slash command and UI
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBalance, removeFromTotal, addMoney } = require('../economy');
const {
  createGame, getGame, deleteGame, addPlayer, removePlayer,
  isInGame, hasActiveGame, getAlivePlayers, getTurnOrder, getDealerId,
  startRound, getCurrentPlayerId, isDealer, processAction, resolveRound,
  recordGameStats, createLivesDisplay, formatCard, isKing,
  getSYNSettings
} = require('../screwyourneighbor');
const { generateSYNRevealImage, generateHandImage } = require('../cardImages');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('syn')
    .setDescription('Start a game of Screw Your Neighbor!')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Wager amount (all players must match)')
        .setRequired(true)
        .setMinValue(100)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const wager = interaction.options.getInteger('bet');

    // Get settings
    const settings = getSYNSettings(guildId);
    if (!settings.enabled) {
      return interaction.reply({ content: '❌ Screw Your Neighbor is currently disabled.', ephemeral: true });
    }

    // Check bet limits
    if (wager < settings.minBet) {
      return interaction.reply({ content: `❌ Minimum bet is **${settings.minBet.toLocaleString()}** ${CURRENCY}`, ephemeral: true });
    }
    if (settings.maxBet > 0 && wager > settings.maxBet) {
      return interaction.reply({ content: `❌ Maximum bet is **${settings.maxBet.toLocaleString()}** ${CURRENCY}`, ephemeral: true });
    }

    // Check for existing game
    if (hasActiveGame(guildId)) {
      const existingGame = getGame(guildId);
      if (existingGame.status === 'lobby') {
        return interaction.reply({ content: `❌ There's already a Screw Your Neighbor lobby open! Join it instead.`, ephemeral: true });
      }
      return interaction.reply({ content: '❌ A game is already in progress in this server!', ephemeral: true });
    }

    // Check balance
    const balance = getBalance(guildId, userId);
    if (balance.total < wager) {
      return interaction.reply({ content: `❌ You don't have enough! Balance: **${balance.total.toLocaleString()}** ${CURRENCY}`, ephemeral: true });
    }

    // Charge host
    const result = await removeFromTotal(guildId, userId, wager, 'SYN buy-in');
    if (!result.success) {
      return interaction.reply({ content: '❌ Could not deduct buy-in.', ephemeral: true });
    }

    // Create game
    const displayName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
    const game = createGame(guildId, userId, displayName, wager, settings.startingLives);
    game.settings = settings;

    await interaction.deferReply();

    // Send lobby embed
    const { embed, components } = createLobbyEmbed(game);
    const reply = await interaction.editReply({ embeds: [embed], components });
    game.lobbyMessageId = reply.id;

    // Start lobby timeout
    startLobbyTimeout(interaction, game);
  }
};

// ==================== LOBBY ====================

function createLobbyEmbed(game) {
  const s = game.settings || getSYNSettings(game.guildId);
  const playersArray = Array.from(game.players.values());
  let playerList = '';
  for (let i = 0; i < playersArray.length; i++) {
    const p = playersArray[i];
    const hostTag = p.id === game.hostId ? ' 👑' : '';
    playerList += `**${i + 1}.** ${p.name}${hostTag} ${createLivesDisplay(p.lives, s.startingLives)}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🃏 Screw Your Neighbor')
    .setDescription(
      `**${game.players.get(game.hostId)?.name}** is hosting!\n` +
      `Wager: **${game.wager.toLocaleString()}** ${CURRENCY} per player\n` +
      `Everyone starts with **${s.startingLives} lives**. Lowest card loses a life!\n` +
      `Last one standing wins the pot!\n\n` +
      `**Players (${game.players.size}/${s.maxPlayers}):**\n${playerList}\n` +
      `Need at least **${s.minPlayers}** players to start.`
    )
    .setFooter({ text: `Lobby closes after ${s.lobbyTimeoutSeconds}s of inactivity` })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('syn_join')
      .setLabel(`Join (${game.wager.toLocaleString()} 🧀)`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(game.players.size >= s.maxPlayers),
    new ButtonBuilder()
      .setCustomId('syn_leave')
      .setLabel('Leave')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('syn_start')
      .setLabel(`Start Game (${game.players.size} players)`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(game.players.size < s.minPlayers)
  );

  return { embed, components: [row1] };
}

function startLobbyTimeout(interaction, game) {
  if (game._lobbyTimer) clearTimeout(game._lobbyTimer);

  const s = game.settings || getSYNSettings(game.guildId);
  game._lobbyTimer = setTimeout(async () => {
    const current = getGame(game.guildId);
    if (!current || current.status !== 'lobby') return;

    // Refund all players
    for (const [userId] of current.players) {
      await addMoney(current.guildId, userId, current.wager, 'SYN lobby expired refund');
    }

    deleteGame(current.guildId);

    try {
      const embed = new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle('🃏 Screw Your Neighbor — Lobby Expired')
        .setDescription('Not enough players joined in time. All buy-ins refunded.')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], components: [] });
    } catch {}
  }, s.lobbyTimeoutSeconds * 1000);
}

// ==================== BUTTON HANDLER ====================

async function handleButton(interaction) {
  const customId = interaction.customId;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // Lobby buttons
  if (customId === 'syn_join') return handleJoin(interaction);
  if (customId === 'syn_leave') return handleLeave(interaction);
  if (customId === 'syn_start') return handleStart(interaction);

  // Game buttons
  if (customId === 'syn_viewcard') return handleViewCard(interaction);
  if (customId === 'syn_peekcard') return handlePeekCard(interaction);
  if (customId === 'syn_pass') return handleGameAction(interaction, 'pass');
  if (customId === 'syn_knock') return handleGameAction(interaction, 'knock');
}

async function handleJoin(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const game = getGame(guildId);

  if (!game || game.status !== 'lobby') {
    return interaction.reply({ content: '❌ No lobby to join.', ephemeral: true });
  }

  if (game.players.has(userId)) {
    return interaction.reply({ content: '❌ You\'re already in this game!', ephemeral: true });
  }

  const s = game.settings || getSYNSettings(guildId);
  if (game.players.size >= s.maxPlayers) {
    return interaction.reply({ content: '❌ Game is full!', ephemeral: true });
  }

  // Check balance
  const balance = getBalance(guildId, userId);
  if (balance.total < game.wager) {
    return interaction.reply({ content: `❌ You need **${game.wager.toLocaleString()}** ${CURRENCY} to join! Balance: **${balance.total.toLocaleString()}**`, ephemeral: true });
  }

  // Charge
  const result = await removeFromTotal(guildId, userId, game.wager, 'SYN buy-in');
  if (!result.success) {
    return interaction.reply({ content: '❌ Could not deduct buy-in.', ephemeral: true });
  }

  const displayName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
  addPlayer(guildId, userId, displayName, s.startingLives);

  // Reset lobby timer
  startLobbyTimeout(interaction, game);

  // Update lobby
  await interaction.deferUpdate();
  const { embed, components } = createLobbyEmbed(game);
  await interaction.editReply({ embeds: [embed], components });
}

async function handleLeave(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const game = getGame(guildId);

  if (!game || game.status !== 'lobby') {
    return interaction.reply({ content: '❌ No lobby to leave.', ephemeral: true });
  }

  if (!game.players.has(userId)) {
    return interaction.reply({ content: '❌ You\'re not in this game!', ephemeral: true });
  }

  // Refund
  await addMoney(guildId, userId, game.wager, 'SYN leave refund');
  const result = removePlayer(guildId, userId);

  if (!result) {
    // Game was destroyed (host left and no one else)
    await interaction.deferUpdate();
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('🃏 Screw Your Neighbor — Cancelled')
      .setDescription('Host left and no players remain. All buy-ins refunded.')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  await interaction.deferUpdate();
  const { embed, components } = createLobbyEmbed(game);
  await interaction.editReply({ embeds: [embed], components });
}

async function handleStart(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const game = getGame(guildId);

  if (!game || game.status !== 'lobby') {
    return interaction.reply({ content: '❌ No lobby to start.', ephemeral: true });
  }

  if (userId !== game.hostId) {
    return interaction.reply({ content: '❌ Only the host can start the game!', ephemeral: true });
  }

  const s = game.settings || getSYNSettings(guildId);
  if (game.players.size < s.minPlayers) {
    return interaction.reply({ content: `❌ Need at least **${s.minPlayers}** players to start!`, ephemeral: true });
  }

  // Clear lobby timer
  if (game._lobbyTimer) clearTimeout(game._lobbyTimer);

  await interaction.deferUpdate();

  // Update lobby message to show game starting
  const startEmbed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🃏 Screw Your Neighbor — Starting!')
    .setDescription(`Game is starting with **${game.players.size}** players!\nPot: **${(game.wager * game.players.size).toLocaleString()}** ${CURRENCY}\n\nMoving to thread...`)
    .setTimestamp();
  await interaction.editReply({ embeds: [startEmbed], components: [] });

  // Create thread
  try {
    const hostName = game.players.get(game.hostId)?.name || 'Unknown';
    const message = await interaction.fetchReply();
    const thread = await message.startThread({
      name: `🃏 SYN — ${hostName}'s Table`,
      autoArchiveDuration: 60
    });
    game.threadId = thread.id;
    game._thread = thread;

    // Initialize deck and start first round
    game.deck = require('../screwyourneighbor').createDeck();
    await startNewRound(interaction, game, thread);
  } catch (error) {
    console.error('SYN: Error creating thread:', error);
    // Fallback: play in original channel
    game.deck = require('../screwyourneighbor').createDeck();
    await startNewRound(interaction, game, null);
  }
}

// ==================== GAME FLOW ====================

async function startNewRound(originalInteraction, game, thread) {
  startRound(game);

  const channel = thread || await originalInteraction.client.channels.fetch(originalInteraction.channelId);
  const s = game.settings || getSYNSettings(game.guildId);

  // Build round status embed — strategy phase
  const dealEmbed = createRoundEmbed(game, 'dealing');

  // Add countdown info to the embed
  const countdownTime = Math.floor((Date.now() + s.dealDelaySeconds * 1000) / 1000);
  dealEmbed.setDescription(
    dealEmbed.data.description + 
    `\n\n🔍 **Strategy Phase** — Look at your cards!\nPassing begins <t:${countdownTime}:R>`
  );

  // Peek button for strategy phase
  const peekRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('syn_peekcard')
      .setLabel('👁️ View My Card')
      .setStyle(ButtonStyle.Primary)
  );

  // Send round message
  const roundMsg = await channel.send({ embeds: [dealEmbed], components: [peekRow] });
  game.roundMessageId = roundMsg.id;
  game._roundMsg = roundMsg;
  game._channel = channel;

  // Wait for deal delay (strategy phase)
  await new Promise(resolve => setTimeout(resolve, s.dealDelaySeconds * 1000));

  // Update embed to show round is now active
  try {
    const activeEmbed = createRoundEmbed(game, 'playing');
    const activePeekRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('syn_peekcard')
        .setLabel('👁️ View My Card')
        .setStyle(ButtonStyle.Secondary)
    );
    await roundMsg.edit({ embeds: [activeEmbed], components: [activePeekRow] });
  } catch {}

  // Prompt first player
  await promptCurrentPlayer(game, channel);
}

function createRoundEmbed(game, phase) {
  const s = game.settings || getSYNSettings(game.guildId);
  const alive = getAlivePlayers(game);
  const dealerId = getDealerId(game);
  const currentId = getCurrentPlayerId(game);
  const pot = game.wager * game.players.size;
  const turnTimeMs = s.turnTimeSeconds * 1000;

  let playerLines = '';
  for (const userId of game.currentTurnOrder || alive) {
    const player = game.players.get(userId);
    if (!player) continue;

    const isCurrentTurn = userId === currentId && phase === 'playing';
    const isDealerPlayer = userId === dealerId;
    const lives = createLivesDisplay(player.lives, s.startingLives);
    const dealerTag = isDealerPlayer ? ' 🎲' : '';

    let status = '';
    if (phase === 'dealing' || phase === 'playing') {
      if (player.action === 'knock') status = '✊ Knocked';
      else if (player.action === 'pass') status = '📤 Passed';
      else if (isCurrentTurn) status = '⏳ Choosing...';
      else if (player.action === null && game.currentTurnOrder.indexOf(userId) > game.currentTurnIndex) status = '🕐 Waiting';
      else status = '🂠 Card dealt';
    }

    const turnMarker = isCurrentTurn ? '▸ ' : '  ';
    playerLines += `${turnMarker}${lives}  **${player.name}**${dealerTag} — ${status}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(phase === 'playing' ? 0x3498db : 0xe67e22)
    .setTitle(`🃏 Round ${game.round} — ${phase === 'dealing' ? 'Cards Dealt!' : 'In Progress'}`)
    .setDescription(
      `Pot: **${pot.toLocaleString()}** ${CURRENCY}\n\n${playerLines}`
    )
    .setFooter({ text: `🎲 = Dealer | ${s.turnTimeSeconds}s per turn` })
    .setTimestamp();

  if (currentId && phase === 'playing') {
    const currentPlayer = game.players.get(currentId);
    embed.setDescription(
      `Pot: **${pot.toLocaleString()}** ${CURRENCY}\n\n${playerLines}\n` +
      `Turn: **${currentPlayer?.name}** (<t:${Math.floor((Date.now() + turnTimeMs) / 1000)}:R>)`
    );
  }

  return embed;
}

async function promptCurrentPlayer(game, channel) {
  const currentId = getCurrentPlayerId(game);
  if (!currentId) return;

  const player = game.players.get(currentId);
  if (!player) return;

  // Update round embed
  try {
    const roundEmbed = createRoundEmbed(game, 'playing');
    const peekRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('syn_peekcard')
        .setLabel('👁️ View My Card')
        .setStyle(ButtonStyle.Secondary)
    );
    await game._roundMsg.edit({ embeds: [roundEmbed], components: [peekRow] });
  } catch {}

  // Send PUBLIC turn announcement (no card info visible)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('syn_viewcard')
      .setLabel('👀 View Your Card')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('syn_peekcard')
      .setLabel('👁️ View My Card')
      .setStyle(ButtonStyle.Secondary)
  );

  try {
    await channel.send({
      content: `<@${currentId}> — your turn! Click below to see your card and choose.`,
      components: [row]
    });
  } catch (error) {
    console.error('SYN: Error sending turn prompt:', error);
  }

  // Start turn timer
  const s = game.settings || getSYNSettings(game.guildId);
  const turnTimeMs = s.turnTimeSeconds * 1000;
  if (game._turnTimer) clearTimeout(game._turnTimer);
  game._turnTimer = setTimeout(async () => {
    const current = getGame(game.guildId);
    if (!current || current.status !== 'playing') return;
    const curId = getCurrentPlayerId(current);
    if (curId !== currentId) return; // already moved on

    // Auto-knock on timeout
    const result = processAction(current, currentId, 'knock');

    try {
      await channel.send({ content: `⏰ **${player.name}** ran out of time — auto-knocked!` });
    } catch {}

    if (result.roundOver) {
      await handleRoundEnd(current, channel);
    } else {
      await promptCurrentPlayer(current, channel);
    }
  }, turnTimeMs);
}

async function handleViewCard(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const game = getGame(guildId);

  if (!game || game.status !== 'playing') {
    return interaction.reply({ content: '❌ No active game.', ephemeral: true });
  }

  const currentId = getCurrentPlayerId(game);
  if (currentId !== userId) {
    return interaction.reply({ content: '❌ It\'s not your turn!', ephemeral: true });
  }

  const player = game.players.get(userId);
  if (!player || !player.card) {
    return interaction.reply({ content: '❌ No card found.', ephemeral: true });
  }

  const cardDisplay = formatCard(player.card);
  const isDealerPlayer = isDealer(game, userId);
  const hasKing = isKing(player.card);

  let description = '';
  if (hasKing) {
    description = `## 👑 Your Card: **${cardDisplay}**\n\n` +
      `Kings can't be passed! You must **knock**.`;
  } else if (isDealerPlayer) {
    description = `## 🃏 Your Card: **${cardDisplay}**\n\n` +
      `You're the **Dealer** this round.\n` +
      `**Pass** = swap with top of deck\n` +
      `**Knock** = keep your card`;
  } else {
    const nextIdx = game.currentTurnIndex + 1;
    const nextId = nextIdx < game.currentTurnOrder.length ? game.currentTurnOrder[nextIdx] : null;
    const nextPlayer = nextId ? game.players.get(nextId) : null;
    const nextName = nextPlayer ? nextPlayer.name : 'next player';

    description = `## 🃏 Your Card: **${cardDisplay}**\n\n` +
      `**Pass** = give this card to **${nextName}**\n` +
      `**Knock** = keep your card`;
  }

  const cardEmbed = new EmbedBuilder()
    .setColor(hasKing ? 0xf1c40f : 0x3498db)
    .setDescription(description);

  // Generate card image
  let attachment = null;
  try {
    const imageBuffer = await generateHandImage([player.card]);
    if (imageBuffer) {
      attachment = new AttachmentBuilder(imageBuffer, { name: 'syn-card.png' });
      cardEmbed.setImage('attachment://syn-card.png');
    }
  } catch (error) {
    console.error('SYN: Error generating card image:', error);
  }

  const actionRow = new ActionRowBuilder();
  if (hasKing) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('syn_knock')
        .setLabel('🔒 Knock')
        .setStyle(ButtonStyle.Primary)
    );
  } else {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('syn_pass')
        .setLabel('📤 Pass')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('syn_knock')
        .setLabel('✊ Knock')
        .setStyle(ButtonStyle.Success)
    );
  }

  const replyOpts = {
    embeds: [cardEmbed],
    components: [actionRow],
    ephemeral: true
  };
  if (attachment) replyOpts.files = [attachment];

  await interaction.reply(replyOpts);
}

async function handlePeekCard(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const game = getGame(guildId);

  if (!game || (game.status !== 'playing' && game.status !== 'reveal')) {
    return interaction.reply({ content: '❌ No active round.', ephemeral: true });
  }

  const player = game.players.get(userId);
  if (!player) {
    return interaction.reply({ content: '❌ You\'re not in this game!', ephemeral: true });
  }

  if (player.eliminated) {
    return interaction.reply({ content: '💀 You\'ve been eliminated!', ephemeral: true });
  }

  if (!player.card) {
    return interaction.reply({ content: '❌ You don\'t have a card yet.', ephemeral: true });
  }

  const cardDisplay = formatCard(player.card);
  const hasKing = isKing(player.card);
  const isDealerPlayer = isDealer(game, userId);

  let statusNote = '';
  if (player.action === 'knock') statusNote = '\n\n✊ You **knocked** this round.';
  else if (player.action === 'pass') statusNote = '\n\n📤 You **passed** this round.';

  let roleNote = '';
  if (isDealerPlayer) roleNote = '  🎲 Dealer';

  const description = `## ${hasKing ? '👑' : '🃏'} Your Card: **${cardDisplay}**${roleNote}${statusNote}`;

  const cardEmbed = new EmbedBuilder()
    .setColor(hasKing ? 0xf1c40f : 0x3498db)
    .setDescription(description);

  // Generate card image
  let attachment = null;
  try {
    const imageBuffer = await generateHandImage([player.card]);
    if (imageBuffer) {
      attachment = new AttachmentBuilder(imageBuffer, { name: 'syn-card.png' });
      cardEmbed.setImage('attachment://syn-card.png');
    }
  } catch (error) {
    console.error('SYN: Error generating peek card image:', error);
  }

  const replyOpts = {
    embeds: [cardEmbed],
    ephemeral: true
  };
  if (attachment) replyOpts.files = [attachment];

  await interaction.reply(replyOpts);
}

async function handleGameAction(interaction, action) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const game = getGame(guildId);

  if (!game || game.status !== 'playing') {
    return interaction.reply({ content: '❌ No active game.', ephemeral: true });
  }

  const currentId = getCurrentPlayerId(game);
  if (currentId !== userId) {
    return interaction.reply({ content: '❌ It\'s not your turn!', ephemeral: true });
  }

  // Clear turn timer
  if (game._turnTimer) clearTimeout(game._turnTimer);

  const result = processAction(game, userId, action);
  if (!result.success) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }

  // Acknowledge the button press ephemerally
  const ackMsg = action === 'pass' ? '📤 You passed!' : '✊ You knocked!';
  await interaction.reply({ content: ackMsg, ephemeral: true });

  const channel = game._channel;

  // Send action feedback
  let feedbackMsg = result.description;
  if (result.deckKingBlocked) {
    feedbackMsg = `🎲 ${result.description}`;
  }

  try {
    await channel.send({ content: feedbackMsg });
  } catch {}

  // If the next player received a passed card, let them know
  if (result.receivedBy) {
    const receiver = game.players.get(result.receivedBy);
    if (receiver) {
      try {
        await channel.send({
          content: `📥 **${receiver.name}** received a passed card! (swapped with their original)`
        });
      } catch {}
    }
  }

  if (result.roundOver) {
    await handleRoundEnd(game, channel);
  } else {
    await promptCurrentPlayer(game, channel);
  }
}

// ==================== ROUND END / REVEAL ====================

async function handleRoundEnd(game, channel) {
  game.status = 'reveal';
  const s = game.settings || getSYNSettings(game.guildId);

  const roundResult = resolveRound(game);
  const { results, losers, winner, lowestValue } = roundResult;

  // Build reveal embed
  let revealLines = '';
  for (const r of results) {
    const cardStr = formatCard(r.card);
    const status = r.isLoser ? '💀 **LOWEST**' : '✅ Safe';
    revealLines += `  **${r.name}:** \`${cardStr}\`  ${status}\n`;
  }

  // Life changes
  let lifeChanges = '';
  for (const r of results) {
    if (r.isLoser) {
      const before = createLivesDisplay(r.livesRemaining + 1, s.startingLives);
      const after = createLivesDisplay(r.livesRemaining, s.startingLives);
      lifeChanges += `${r.name}: ${before} → ${after}${r.eliminated ? ' **💀 ELIMINATED!**' : ''}\n`;
    }
  }

  // Generate card image
  let attachment = null;
  try {
    const revealData = results.map(r => ({
      name: r.name,
      card: r.card,
      isLoser: r.isLoser
    }));
    const imageBuffer = await generateSYNRevealImage(revealData);
    if (imageBuffer) {
      attachment = new AttachmentBuilder(imageBuffer, { name: 'syn-reveal.png' });
    }
  } catch (error) {
    console.error('SYN: Error generating reveal image:', error);
  }

  const revealEmbed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`🃏 Round ${game.round} — Reveal!`)
    .setDescription(
      `${revealLines}\n` +
      `**Life Changes:**\n${lifeChanges}`
    )
    .setFooter({ text: `Lowest value: ${lowestValue} (A=1, K=13)` })
    .setTimestamp();

  if (attachment) {
    revealEmbed.setImage('attachment://syn-reveal.png');
  }

  const sendOpts = { embeds: [revealEmbed] };
  if (attachment) sendOpts.files = [attachment];

  try {
    await channel.send(sendOpts);
  } catch (error) {
    console.error('SYN: Error sending reveal:', error);
  }

  // Check for eliminations
  const eliminated = results.filter(r => r.eliminated);
  if (eliminated.length > 0) {
    await new Promise(resolve => setTimeout(resolve, s.eliminationDelaySeconds * 1000));

    const alive = getAlivePlayers(game);
    let elimMsg = eliminated.map(e => `💀 **${e.name}** has been eliminated!`).join('\n');
    if (alive.length > 1) {
      const remaining = alive.map(id => {
        const p = game.players.get(id);
        return `${p.name} (${p.lives}❤️)`;
      }).join(', ');
      elimMsg += `\n\nRemaining: ${remaining}`;
    }

    try {
      await channel.send({ content: elimMsg });
    } catch {}
  }

  // Check for winner
  if (winner) {
    await handleVictory(game, winner, channel);
    return;
  }

  // Check if game should continue
  const alive = getAlivePlayers(game);
  if (alive.length <= 1) {
    await handleVictory(game, alive[0] || null, channel);
    return;
  }

  // Wait then start next round
  await new Promise(resolve => setTimeout(resolve, s.revealDelaySeconds * 1000));

  try {
    await channel.send({ content: `📦 Shuffling for **Round ${game.round + 1}**...` });
  } catch {}

  await new Promise(resolve => setTimeout(resolve, 1500));
  await startNewRound(null, game, channel);
}

async function handleVictory(game, winnerId, channel) {
  game.status = 'finished';

  const pot = game.wager * game.players.size;
  const winnerPlayer = winnerId ? game.players.get(winnerId) : null;

  // Pay winner
  if (winnerId) {
    await addMoney(game.guildId, winnerId, pot, 'SYN winnings');
  }

  // Record stats
  recordGameStats(game.guildId, game.players, winnerId, game.wager);

  // Build victory embed
  let statsLines = '';
  for (const [userId, player] of game.players) {
    const tag = userId === winnerId ? ' 🏆' : ' 💀';
    statsLines += `**${player.name}**${tag} — Knocked ${player.stats.knocked}x, Passed ${player.stats.passed}x, Survived ${player.stats.roundsSurvived} rounds\n`;
  }

  const victoryEmbed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏆 Screw Your Neighbor — WINNER!')
    .setDescription(
      `🎉 **${winnerPlayer?.name || 'Unknown'}** is the last one standing!\n\n` +
      `💰 Pot: **${pot.toLocaleString()}** ${CURRENCY} → **${winnerPlayer?.name || 'Unknown'}**\n\n` +
      `**Game Stats:**\n${statsLines}\n` +
      `Rounds played: **${game.round}** | Players: **${game.players.size}**`
    )
    .setTimestamp();

  try {
    await channel.send({ embeds: [victoryEmbed] });
  } catch {}

  // Delete thread after 1 minute
  if (game._thread) {
    const thread = game._thread;
    setTimeout(async () => {
      try {
        await thread.delete('SYN game ended');
      } catch {}
    }, 60000);
  }

  // Cleanup
  if (game._turnTimer) clearTimeout(game._turnTimer);
  if (game._lobbyTimer) clearTimeout(game._lobbyTimer);
  deleteGame(game.guildId);
}

// ==================== EXPORTS ====================

module.exports.handleButton = handleButton;
