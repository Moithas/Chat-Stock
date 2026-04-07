// Let It Ride Command
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBalance, removeFromTotal, addMoney } = require('../economy');
const { 
  getSettings, 
  hasActiveGame, 
  getActiveGame,
  startGame,
  pullBackBet,
  letItRide,
  endGame,
  forceEndGame,
  setGameMessage,
  setGameTimer,
  formatCard,
  getPayoutTable,
  PAYOUT_TABLE
} = require('../letitride');
const { generateLetItRideImage } = require('../cardImages');
const { getCurrency } = require('../admin');
const { applyGamblingBonus, getPetBonusDecimal } = require('../pets');



module.exports = {
  data: new SlashCommandBuilder()
    .setName('letitride')
    .setDescription('Play Let It Ride poker!')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Bet amount per spot (3 equal bets)')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const betAmount = interaction.options.getInteger('bet');
    
    await interaction.deferReply();
    
    const settings = getSettings(guildId);
    
    if (!settings.enabled) {
      return interaction.editReply({ content: '❌ Let It Ride is currently disabled on this server.' });
    }
    
    // Check if player already has an active game
    if (hasActiveGame(guildId, userId)) {
      return interaction.editReply({ content: '❌ You already have an active Let It Ride game!' });
    }
    
    // Validate bet amount
    if (betAmount < settings.minBet || betAmount > settings.maxBet) {
      return interaction.editReply({ 
        content: `❌ Bet must be between **${settings.minBet.toLocaleString()}** and **${settings.maxBet.toLocaleString()}** ${getCurrency(guildId)} per spot.` 
      });
    }
    
    // Check if player can afford all 3 bets
    const totalRequired = betAmount * 3;
    const balance = await getBalance(guildId, userId);
    if (balance.total < totalRequired) {
      return interaction.editReply({ 
        content: `❌ You need **${totalRequired.toLocaleString()}** ${getCurrency(guildId)} for 3 bets of **${betAmount.toLocaleString()}** each.\nYour balance: **${balance.total.toLocaleString()}** ${getCurrency(guildId)}` 
      });
    }
    
    // Deduct all 3 bets upfront
    await removeFromTotal(guildId, userId, totalRequired, 'Let It Ride bets');
    
    // Start the game
    const game = startGame(guildId, userId, interaction.user.displayName, betAmount);
    
    // Build and send the game display
    const { embed, attachment, components } = await buildGameDisplay(game, interaction.user);
    
    const reply = await interaction.editReply({ 
      embeds: [embed], 
      files: attachment ? [attachment] : [], 
      components 
    });
    
    // Store message info for timeout handling
    setGameMessage(guildId, userId, reply.id, interaction.channelId);
    
    // Set decision timer
    setGameTimer(guildId, userId, async () => {
      await handleTimeout(interaction.client, guildId, userId);
    }, settings.timerSeconds * 1000);
  }
};

// ==================== GAME DISPLAY ====================

async function buildGameDisplay(game, user) {
  let embed, attachment = null, components = [];
  
  // Generate table image
  try {
    const imageBuffer = await generateLetItRideImage(
      game.playerCards,
      game.communityCards,
      game.revealedCommunity,
      game.betAmount,
      game.bet1,
      game.bet2,
      game.bet3,
      user.displayName,
      game.status === 'resolved' ? game.result : null
    );
    attachment = new AttachmentBuilder(imageBuffer, { name: 'letitride.png' });
  } catch (err) {
    console.error('Error generating Let It Ride image:', err);
  }
  
  // Build embed based on game state
  if (game.status === 'decision_1') {
    embed = buildDecision1Embed(game, user, attachment);
    components = buildDecision1Buttons();
  } else if (game.status === 'decision_2') {
    embed = buildDecision2Embed(game, user, attachment);
    components = buildDecision2Buttons();
  } else if (game.status === 'resolved') {
    embed = buildResultEmbed(game, user, attachment);
    // Add Play Again and Done buttons with encoded bet amount
    components = buildResultButtons(user.id, game.betAmount);
  }
  
  return { embed, attachment, components };
}

function buildDecision1Embed(game, user, attachment) {
  const totalBet = game.betAmount * 3;
  
  const embed = new EmbedBuilder()
    .setColor(0x2E7D32)
    .setTitle('🎰 Let It Ride - First Decision')
    .setDescription(`You've been dealt 3 cards. Review your hand and decide:\n\n**Pull Back** your first bet, or **Let It Ride**!`)
    .addFields(
      { name: '🃏 Your Cards', value: game.playerCards.map(c => `**${formatCard(c)}**`).join('  '), inline: true },
      { name: '💰 Per Bet', value: `**${game.betAmount.toLocaleString()}** ${getCurrency(game.guildId)}`, inline: true },
      { name: '📊 Total at Risk', value: `**${totalBet.toLocaleString()}** ${getCurrency(game.guildId)}`, inline: true }
    )
    .setFooter({ text: `${user.displayName} • Make your decision!` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://letitride.png');
  }
  
  return embed;
}

function buildDecision2Embed(game, user, attachment) {
  const activeBets = (game.bet1 ? 1 : 0) + 2; // bet2 and bet3 still active
  const totalAtRisk = game.betAmount * activeBets;
  
  const embed = new EmbedBuilder()
    .setColor(0x1565C0)
    .setTitle('🎰 Let It Ride - Second Decision')
    .setDescription(`First community card revealed! Decide on your second bet:\n\n**Pull Back** your second bet, or **Let It Ride**!`)
    .addFields(
      { name: '🃏 Your Cards', value: game.playerCards.map(c => `**${formatCard(c)}**`).join('  '), inline: false },
      { name: '🎴 Community', value: `**${formatCard(game.communityCards[0])}**  🂠`, inline: true },
      { name: '💰 Bets Remaining', value: `**${activeBets}** (${totalAtRisk.toLocaleString()} ${getCurrency(game.guildId)})`, inline: true }
    )
    .setFooter({ text: `${user.displayName} • Second decision!` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://letitride.png');
  }
  
  return embed;
}

function buildResultEmbed(game, user, attachment) {
  const handRank = game.result.rank;
  const payout = game.payout;
  const activeBets = game.betsRemaining;
  const totalWagered = game.betAmount * activeBets;
  
  // Calculate pet gambling bonus for display
  let petGamblingBoost = 0;
  let boostedPayout = payout;
  if (payout > 0) {
    try {
      const gamblingBonus = getPetBonusDecimal(game.guildId, game.userId, 'gambling');
      if (gamblingBonus > 0) {
        petGamblingBoost = Math.round(gamblingBonus * 100);
        boostedPayout = Math.floor(payout * (1 + gamblingBonus));
      }
    } catch (e) { /* pets not loaded */ }
  }
  
  let color, title, description;
  
  if (payout > 0) {
    color = 0x4CAF50;
    title = `🎉 ${handRank}!`;
    const multiplier = PAYOUT_TABLE[handRank];
    description = `**${handRank}** pays **${multiplier}:1**!\n\n` +
      `Bets remaining: **${activeBets}** × ${game.betAmount.toLocaleString()} = **${totalWagered.toLocaleString()}** ${getCurrency(game.guildId)}\n` +
      `Payout: **${multiplier}x** × ${totalWagered.toLocaleString()} = **+${payout.toLocaleString()}** ${getCurrency(game.guildId)}!` +
      (petGamblingBoost > 0 ? `\n🐾 Pet bonus: +${petGamblingBoost}% → **+${boostedPayout.toLocaleString()}** ${getCurrency(game.guildId)}` : '');
  } else {
    color = 0xF44336;
    title = '😔 No Winning Hand';
    description = `Your hand: **${handRank}**\n\n` +
      `Bets lost: **${activeBets}** × ${game.betAmount.toLocaleString()} = **-${Math.abs(payout).toLocaleString()}** ${getCurrency(game.guildId)}`;
  }
  
  const finalHand = [...game.playerCards, ...game.communityCards];
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎰 Let It Ride - ${title}`)
    .setDescription(description)
    .addFields(
      { name: '🃏 Final Hand', value: finalHand.map(c => `**${formatCard(c)}**`).join('  '), inline: false }
    )
    .setFooter({ text: `${user.displayName}` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://letitride.png');
  }
  
  return embed;
}

// ==================== BUTTON BUILDERS ====================

function buildDecision1Buttons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lir_ride_1')
      .setLabel('Let It Ride!')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎰'),
    new ButtonBuilder()
      .setCustomId('lir_pull_1')
      .setLabel('Pull Back Bet 1')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('↩️')
  );
  
  return [row];
}

function buildDecision2Buttons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lir_ride_2')
      .setLabel('Let It Ride!')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎰'),
    new ButtonBuilder()
      .setCustomId('lir_pull_2')
      .setLabel('Pull Back Bet 2')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('↩️')
  );
  
  return [row];
}

function buildResultButtons(userId, betAmount) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lir_playagain_${userId}_${betAmount}`)
      .setLabel('Play Again')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId(`lir_done_${userId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✅')
  );
  
  return [row];
}

// ==================== BUTTON HANDLERS ====================

// Prevent double-click processing
const processingUsers = new Set();

async function handleButton(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const customId = interaction.customId;
  
  // Handle Play Again button (game may be ended)
  if (customId.startsWith('lir_playagain_')) {
    const parts = customId.split('_');
    const targetUserId = parts[2];
    const betAmount = parseInt(parts[3]);
    
    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }
    
    await handlePlayAgain(interaction, betAmount);
    return;
  }
  
  // Handle Done button
  if (customId.startsWith('lir_done_')) {
    const targetUserId = customId.split('_')[2];
    
    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎰 Thanks for Playing!')
      .setDescription('Come back anytime to play Let It Ride!');
    
    await interaction.update({ embeds: [embed], components: [] });
    return;
  }
  
  if (processingUsers.has(userId)) {
    return interaction.reply({ content: '⏳ Processing your last action...', flags: 64 });
  }
  
  const game = getActiveGame(guildId, userId);
  
  if (!game) {
    return interaction.reply({ content: '❌ No active game found.', flags: 64 });
  }
  
  if (game.userId !== userId) {
    return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
  }
  
  processingUsers.add(userId);
  try {
  try {
    await interaction.deferUpdate();
  } catch (err) {
    console.error('Error deferring Let It Ride update:', err);
    return;
  }
  
  const settings = getSettings(guildId);
  let updatedGame;
  
  try {
    // Handle first decision
    if (customId === 'lir_ride_1') {
      updatedGame = letItRide(guildId, userId);
    } else if (customId === 'lir_pull_1') {
      updatedGame = pullBackBet(guildId, userId, 1);
      // Refund the pulled bet
      if (updatedGame) {
        await addMoney(guildId, userId, game.betAmount, 'Let It Ride bet 1 refund');
      }
    }
    // Handle second decision
    else if (customId === 'lir_ride_2') {
      updatedGame = letItRide(guildId, userId);
    } else if (customId === 'lir_pull_2') {
      updatedGame = pullBackBet(guildId, userId, 2);
      // Refund the pulled bet
      if (updatedGame) {
        await addMoney(guildId, userId, game.betAmount, 'Let It Ride bet 2 refund');
      }
    }
    
    if (!updatedGame) {
      return interaction.followUp({ content: '❌ Invalid action for current game state.', flags: 64 });
    }
    
    // Build updated display
    const { embed, attachment, components } = await buildGameDisplay(updatedGame, interaction.user);
    await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components });
    
    // If game is resolved, process payouts and end
    if (updatedGame.status === 'resolved') {
      await processResult(interaction, updatedGame);
      endGame(guildId, userId);
      return;
    }
    
    // Reset timer for next decision
    setGameTimer(guildId, userId, async () => {
      await handleTimeout(interaction.client, guildId, userId);
    }, settings.timerSeconds * 1000);
  } catch (err) {
    console.error('Error handling Let It Ride button:', err);
    try {
      await interaction.followUp({ content: '❌ An error occurred processing your action.', flags: 64 });
    } catch (e) { /* ignore */ }
  }
  } finally {
    processingUsers.delete(userId);
  }
}

async function processResult(interaction, game) {
  const guildId = game.guildId;
  const userId = game.userId;
  
  if (game.payout > 0) {
    // Player won - pay out winnings + return remaining bets (pet bonus on winnings only)
    const boostedPayout = applyGamblingBonus(guildId, userId, game.payout);
    const totalReturn = boostedPayout + (game.betAmount * game.betsRemaining);
    await addMoney(guildId, userId, totalReturn, 'Let It Ride winnings');
  }
  // If payout <= 0, bets were already deducted at start
}

async function handleTimeout(client, guildId, userId) {
  const game = getActiveGame(guildId, userId);
  if (!game) return;
  
  // Remember how many bets were active before force-end
  const betsBeforeEnd = (game.bet1 ? 1 : 0) + (game.bet2 ? 1 : 0) + 1;
  
  // Force end the game (auto pull-back remaining bets)
  const result = forceEndGame(guildId, userId, 'timeout');
  if (!result) return;
  
  // Refund pulled-back bets (bets that were active before but got pulled by forceEndGame)
  const pulledBets = betsBeforeEnd - result.betsRemaining;
  if (pulledBets > 0) {
    await addMoney(result.guildId, userId, result.betAmount * pulledBets, 'Let It Ride timeout bet refund');
  }
  
  // Process payouts
  if (result.payout > 0) {
    const totalReturn = result.payout + (result.betAmount * result.betsRemaining);
    await addMoney(result.guildId, userId, totalReturn, 'Let It Ride winnings (timeout)');
  }
  
  // Try to update the original message
  try {
    const channel = await client.channels.fetch(game.channelId);
    const message = await channel.messages.fetch(game.messageId);
    
    const user = await client.users.fetch(userId);
    const { embed, attachment } = await buildGameDisplay(result, user);
    
    // Add timeout notice
    embed.setDescription(embed.data.description + '\n\n⏰ *Game auto-completed due to timeout.*');
    
    await message.edit({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
  } catch (err) {
    console.error('Error updating timed out Let It Ride game:', err);
  }
}

async function handlePlayAgain(interaction, betAmount) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  
  const settings = getSettings(guildId);
  
  if (!settings.enabled) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🎰 Game Disabled')
      .setDescription('Let It Ride is currently disabled.');
    return interaction.update({ embeds: [embed], components: [] });
  }
  
  // Clean up any existing game
  if (hasActiveGame(guildId, userId)) {
    forceEndGame(guildId, userId);
  }
  
  // Check balance
  const totalRequired = betAmount * 3;
  const balance = await getBalance(guildId, userId);
  if (balance.total < totalRequired) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('💸 Insufficient Funds')
      .setDescription(`You need **${totalRequired.toLocaleString()}** ${getCurrency(guildId)} to play again with the same bet.\nYou have **${balance.total.toLocaleString()}** ${getCurrency(guildId)}.`);
    return interaction.update({ embeds: [embed], components: [] });
  }
  
  // Deduct bets
  await removeFromTotal(guildId, userId, totalRequired, 'Let It Ride bets');
  
  // Start new game
  const game = startGame(guildId, userId, interaction.user.displayName, betAmount);
  
  // Build and send display
  const { embed, attachment, components } = await buildGameDisplay(game, interaction.user);
  
  const replyOptions = { embeds: [embed], components };
  if (attachment) {
    replyOptions.files = [attachment];
  }
  
  const reply = await interaction.update({ ...replyOptions, fetchReply: true });
  
  setGameMessage(guildId, userId, reply.id, interaction.channelId);
  
  // Set timer
  setGameTimer(guildId, userId, async () => {
    await handleTimeout(interaction.client, guildId, userId);
  }, settings.timerSeconds * 1000);
}

module.exports.handleButton = handleButton;
module.exports.handleTimeout = handleTimeout;
