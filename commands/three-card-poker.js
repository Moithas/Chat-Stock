// Three Card Poker command for Chat-Stock
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { 
  getSettings, 
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
  PAIR_PLUS_PAYOUTS,
  SIX_CARD_BONUS_PAYOUTS,
  ANTE_BONUS_PAYOUTS
} = require('../threecardpoker');
const { isEnabled, getBalance, removeFromBank, addMoney } = require('../economy');
const { generateThreeCardPokerImage } = require('../cardImages');
const { getCurrency } = require('../admin');



// Prevent double-click processing
const processingUsers = new Set();

// Generate bet options based on settings
function generateBetOptions(guildId, minBet, maxBet, includeNone = false) {
  const standardAmounts = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  const options = standardAmounts.filter(amount => amount >= minBet && amount <= maxBet);
  
  const selectOptions = options.map(amount => ({
    label: amount.toLocaleString(),
    value: amount.toString(),
    description: `Bet ${amount.toLocaleString()} ${getCurrency(guildId).replace(/<:[^:]+:(\d+)>/, '')}`
  }));
  
  if (includeNone) {
    selectOptions.unshift({
      label: 'None',
      value: '0',
      description: 'Skip this bet'
    });
  }
  
  return selectOptions;
}

// Create betting phase embed
function createBettingEmbed(game, balance) {
  const settings = getSettings(game.guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x2E8B57)
    .setTitle('🃏 Three Card Poker')
    .setDescription(`**Ante:** ${game.anteBet.toLocaleString()} ${getCurrency(game.guildId)}\n\nSelect your optional side bets, then click **Deal Cards** to begin!`)
    .addFields(
      { 
        name: '💰 Your Balance', 
        value: `${balance.toLocaleString()} ${getCurrency(game.guildId)}`, 
        inline: true 
      },
      { 
        name: '🎲 Pair Plus', 
        value: game.pairPlusBet > 0 ? `${game.pairPlusBet.toLocaleString()} ${getCurrency(game.guildId)}` : 'None', 
        inline: true 
      },
      { 
        name: '🎯 6-Card Bonus', 
        value: game.sixCardBet > 0 ? `${game.sixCardBet.toLocaleString()} ${getCurrency(game.guildId)}` : 'None', 
        inline: true 
      }
    )
    .addFields(
      {
        name: '📋 How to Play',
        value: '1. Place optional side bets (Pair Plus & 6-Card Bonus)\n2. Click Deal Cards to see your hand\n3. Choose to Play (match ante) or Fold\n4. Dealer must Qualify with Queen-high or better!',
        inline: false
      }
    )
    .setFooter({ text: `Min: ${settings.minBet.toLocaleString()} | Max: ${settings.maxBet.toLocaleString()}` });
  
  return embed;
}

// Create betting phase components
function createBettingComponents(guildId, userId) {
  const settings = getSettings(guildId);
  const betOptions = generateBetOptions(guildId, settings.minBet, settings.maxBet, true);
  
  const pairPlusSelect = new StringSelectMenuBuilder()
    .setCustomId(`tcp_pairplus_${userId}`)
    .setPlaceholder('🎲 Pair Plus Bet (Optional)')
    .addOptions(betOptions.slice(0, 25)); // Discord limit
  
  const sixCardSelect = new StringSelectMenuBuilder()
    .setCustomId(`tcp_sixcard_${userId}`)
    .setPlaceholder('🎯 6-Card Bonus Bet (Optional)')
    .addOptions(betOptions.slice(0, 25));
  
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tcp_deal_${userId}`)
      .setLabel('Deal Cards')
      .setEmoji('🎴')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`tcp_cancel_${userId}`)
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
  
  return [
    new ActionRowBuilder().addComponents(pairPlusSelect),
    new ActionRowBuilder().addComponents(sixCardSelect),
    buttons
  ];
}

// Create playing phase embed with table image
async function createPlayingEmbed(game, playerName) {
  const settings = getSettings(game.guildId);
  const totalBet = game.anteBet + game.pairPlusBet + game.sixCardBet;
  
  const embed = new EmbedBuilder()
    .setColor(0x2E8B57)
    .setTitle('🃏 Three Card Poker')
    .setDescription(`Your hand: **${formatHand(game.playerHand)}**\n\nChoose to **Play** (bet another ${game.anteBet.toLocaleString()} ${getCurrency(game.guildId)}) or **Fold** (forfeit ante).`)
    .addFields(
      { name: '💵 Ante', value: `${game.anteBet.toLocaleString()}`, inline: true },
      { name: '🎲 Pair Plus', value: game.pairPlusBet > 0 ? game.pairPlusBet.toLocaleString() : 'None', inline: true },
      { name: '🎯 6-Card', value: game.sixCardBet > 0 ? game.sixCardBet.toLocaleString() : 'None', inline: true }
    )
    .setFooter({ text: `Total at risk: ${totalBet.toLocaleString()} (+ ${game.anteBet.toLocaleString()} if you Play) | ${settings.timerSeconds}s to decide` });
  
  // Generate table image
  try {
    const imageBuffer = await generateThreeCardPokerImage(
      game.playerHand,
      game.dealerHand,
      false, // Don't reveal dealer yet
      game.anteBet,
      game.pairPlusBet,
      game.sixCardBet,
      false, // ante active
      false, // play not yet
      playerName,
      null // no result yet
    );
    
    return { embed, imageBuffer };
  } catch (err) {
    console.error('Error generating TCP image:', err);
    return { embed, imageBuffer: null };
  }
}

// Create playing phase components
function createPlayingComponents(userId, anteBet) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tcp_play_${userId}`)
        .setLabel(`Play (${anteBet.toLocaleString()})`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tcp_fold_${userId}`)
        .setLabel('Fold')
        .setEmoji('🏳️')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

// Create result embed
async function createResultEmbed(game, results, playerName) {
  const isWin = results.totalResult > 0;
  const isTie = results.totalResult === 0;
  
  let color = 0xE74C3C; // Red for loss
  let title = '❌ You Lose!';
  
  if (isWin) {
    color = 0x2ECC71; // Green for win
    title = '🎉 You Win!';
  } else if (isTie) {
    color = 0xF39C12; // Yellow for push
    title = '🤝 Push!';
  }
  
  if (results.folded) {
    title = '🏳️ You Folded';
  }
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`**Your Hand:** ${formatHand(game.playerHand)} (${results.playerHand.rank})\n**Dealer's Hand:** ${formatHand(game.dealerHand)} (${results.dealerHand.rank})${!results.dealerQualifies ? ' - **DNQ**' : ''}`)
    .addFields(
      { name: '💵 Ante', value: formatResult(game.guildId, results.anteResult, results.anteOutcome), inline: true },
      { name: '▶️ Play', value: formatResult(game.guildId, results.playResult, results.playOutcome), inline: true },
      { name: '⭐ Ante Bonus', value: formatResult(game.guildId, results.anteBonusResult, results.anteBonusOutcome), inline: true },
      { name: '🎲 Pair Plus', value: formatResult(game.guildId, results.pairPlusResult, results.pairPlusOutcome), inline: true },
      { name: '🎯 6-Card', value: formatResult(game.guildId, results.sixCardResult, results.sixCardOutcome), inline: true },
      { name: '💰 Total', value: formatTotal(game.guildId, results.totalResult), inline: true }
    );
  
  if (results.sixCardHand) {
    embed.addFields({ name: '🃏 6-Card Hand', value: results.sixCardHand.rank, inline: false });
  }
  
  // Generate final table image
  try {
    const imageBuffer = await generateThreeCardPokerImage(
      game.playerHand,
      game.dealerHand,
      true, // Reveal dealer
      game.anteBet,
      game.pairPlusBet,
      game.sixCardBet,
      true, // ante resolved
      !results.folded, // play bet made if not folded
      playerName,
      results
    );
    
    return { embed, imageBuffer };
  } catch (err) {
    console.error('Error generating TCP result image:', err);
    return { embed, imageBuffer: null };
  }
}

function formatResult(guildId, amount, outcome) {
  if (outcome === 'No bet' || outcome === 'N/A') {
    return outcome;
  }
  
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${amount.toLocaleString()} ${getCurrency(guildId)}\n(${outcome})`;
}

function formatTotal(guildId, amount) {
  const prefix = amount > 0 ? '+' : '';
  const emoji = amount > 0 ? '🟢' : amount < 0 ? '🔴' : '🟡';
  return `${emoji} ${prefix}${amount.toLocaleString()} ${getCurrency(guildId)}`;
}

// Create result components
function createResultComponents(userId, anteBet, pairPlusBet, sixCardBet) {
  // Encode bets in button ID: tcp_playagain_userId_ante_pairplus_sixcard
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tcp_playagain_${userId}_${anteBet}_${pairPlusBet}_${sixCardBet}`)
        .setLabel('Play Again')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`tcp_done_${userId}`)
        .setLabel('Done')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('three-card-poker')
    .setDescription('Play Three Card Poker!')
    .addIntegerOption(option =>
      option.setName('ante')
        .setDescription('Your ante bet amount')
        .setRequired(true)
        .setMinValue(1)
    ),
  
  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const anteBet = interaction.options.getInteger('ante');
    
    // Check if game is enabled
    const settings = getSettings(guildId);
    if (!settings.enabled) {
      return interaction.reply({ content: '🃏 Three Card Poker is currently disabled.', flags: 64 });
    }
    
    // Check for active game
    if (hasActiveGame(guildId, userId)) {
      return interaction.reply({ content: '❌ You already have an active Three Card Poker game!', flags: 64 });
    }
    
    // Validate bet
    if (anteBet < settings.minBet || anteBet > settings.maxBet) {
      return interaction.reply({ 
        content: `❌ Ante must be between ${settings.minBet.toLocaleString()} and ${settings.maxBet.toLocaleString()} ${getCurrency(guildId)}.`, 
        flags: 64 
      });
    }
    
    // Check balance
    if (!isEnabled()) {
      return interaction.reply({ content: '❌ Economy system is not enabled.', flags: 64 });
    }
    
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.bank < anteBet) {
      return interaction.reply({ 
        content: `❌ Insufficient funds! You have ${balanceData.bank.toLocaleString()} ${getCurrency(guildId)} in your bank.`, 
        flags: 64 
      });
    }
    
    // Start game
    const result = startGame(guildId, userId, anteBet);
    if (!result.success) {
      return interaction.reply({ content: `❌ ${result.error}`, flags: 64 });
    }
    
    // Deduct ante
    await removeFromBank(guildId, userId, anteBet);
    
    // Create betting phase
    const embed = createBettingEmbed(result.game, balanceData.bank - anteBet);
    const components = createBettingComponents(guildId, userId);
    
    const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true });
    setGameMessage(guildId, userId, reply.id, interaction.channelId);
  },
  
  // Button and select menu handlers
  async handleButton(interaction, action, targetUserId, extraData = []) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    
    // Verify it's the right user
    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }
    
    // Allow non-money actions without processing guard
    if (action === 'cancel' || action === 'done') {
      const game = getActiveGame(guildId, userId);
      if (action === 'cancel') return handleCancel(interaction, game);
      if (action === 'done') return handleDone(interaction);
    }
    
    if (processingUsers.has(userId)) {
      return interaction.reply({ content: '⏳ Processing your last action...', flags: 64 });
    }
    processingUsers.add(userId);
    try {
    
    const game = getActiveGame(guildId, userId);
    
    switch (action) {
      case 'deal':
        await handleDeal(interaction, game);
        break;
      case 'play':
        await handlePlay(interaction, game);
        break;
      case 'fold':
        await handleFold(interaction, game);
        break;
      case 'playagain':
        // extraData contains [ante, pairplus, sixcard]
        const bets = {
          ante: parseInt(extraData[0]) || 0,
          pairPlus: parseInt(extraData[1]) || 0,
          sixCard: parseInt(extraData[2]) || 0
        };
        await handlePlayAgain(interaction, bets);
        break;
    }
    
    } finally {
      processingUsers.delete(userId);
    }
  },
  
  async handleSelectMenu(interaction, menuType, targetUserId) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    
    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }
    
    const game = getActiveGame(guildId, userId);
    if (!game || game.phase !== 'betting') {
      return interaction.reply({ content: '❌ No active game in betting phase.', flags: 64 });
    }
    
    const value = parseInt(interaction.values[0]);
    
    // Check balance for side bet
    if (value > 0) {
      const balanceData = await getBalance(guildId, userId);
      const currentTotal = game.anteBet + game.pairPlusBet + game.sixCardBet;
      const oldBet = menuType === 'pairplus' ? game.pairPlusBet : game.sixCardBet;
      const newTotal = currentTotal - oldBet + value;
      
      if (balanceData.bank < (newTotal - game.anteBet)) { // Ante already deducted
        return interaction.reply({ 
          content: `❌ Insufficient funds for this side bet! You have ${balanceData.bank.toLocaleString()} ${getCurrency(guildId)} remaining.`, 
          flags: 64 
        });
      }
    }
    
    // Update side bet
    if (menuType === 'pairplus') {
      game.pairPlusBet = value;
    } else if (menuType === 'sixcard') {
      game.sixCardBet = value;
    }
    
    // Update embed
    const balanceData = await getBalance(guildId, userId);
    const embed = createBettingEmbed(game, balanceData.bank);
    
    await interaction.update({ embeds: [embed] });
  }
};

// Handler functions
async function handleDeal(interaction, game) {
  if (!game || game.phase !== 'betting') {
    return interaction.reply({ content: '❌ No active game in betting phase.', flags: 64 });
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  
  // Deduct side bets
  const sideBetTotal = game.pairPlusBet + game.sixCardBet;
  if (sideBetTotal > 0) {
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.bank < sideBetTotal) {
      return interaction.reply({ 
        content: `❌ Insufficient funds for side bets! You need ${sideBetTotal.toLocaleString()} ${getCurrency(guildId)} more.`, 
        flags: 64 
      });
    }
    await removeFromBank(guildId, userId, sideBetTotal);
  }
  
  // Deal cards
  const result = dealCards(guildId, userId);
  if (!result.success) {
    return interaction.reply({ content: `❌ ${result.error}`, flags: 64 });
  }
  
  // Create playing phase
  const { embed, imageBuffer } = await createPlayingEmbed(game, interaction.user.displayName);
  const components = createPlayingComponents(userId, game.anteBet);
  
  const replyOptions = { embeds: [embed], components };
  
  if (imageBuffer) {
    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'threecardpoker.png' });
    embed.setImage('attachment://threecardpoker.png');
    replyOptions.files = [attachment];
  }
  
  await interaction.update(replyOptions);
  
  // Set timer for auto-fold
  const settings = getSettings(guildId);
  setGameTimer(guildId, userId, async () => {
    const currentGame = getActiveGame(guildId, userId);
    if (currentGame && currentGame.phase === 'playing') {
      const timeoutResult = forceEndGame(guildId, userId, 'timeout');
      if (timeoutResult && !timeoutResult.cancelled) {
        // Pay out using same logic as handleFold
        const sideBetWins = Math.max(0, timeoutResult.results.pairPlusResult) + Math.max(0, timeoutResult.results.sixCardResult);
        const sideBetLosses = Math.min(0, timeoutResult.results.pairPlusResult) + Math.min(0, timeoutResult.results.sixCardResult);
        const sideBetTotal = game.pairPlusBet + game.sixCardBet;
        const sideReturn = sideBetTotal + sideBetWins + sideBetLosses;
        if (sideReturn > 0) {
          await addMoney(guildId, userId, sideReturn);
        }
        
        try {
          const channel = await interaction.client.channels.fetch(game.channelId);
          const message = await channel.messages.fetch(game.messageId);
          
          const { embed: resultEmbed, imageBuffer: resultImage } = await createResultEmbed(currentGame, timeoutResult.results, interaction.user.displayName);
          resultEmbed.setFooter({ text: '⏰ Auto-folded due to timeout' });
          
          const replyOptions = { embeds: [resultEmbed], components: [] };
          if (resultImage) {
            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(resultImage, { name: 'threecardpoker.png' });
            resultEmbed.setImage('attachment://threecardpoker.png');
            replyOptions.files = [attachment];
          }
          
          await message.edit(replyOptions);
        } catch (err) {
          console.error('Error updating timeout message:', err);
        }
      }
      endGame(guildId, userId);
    }
  }, settings.timerSeconds * 1000);
}

async function handleCancel(interaction, game) {
  if (!game) {
    return interaction.reply({ content: '❌ No active game to cancel.', flags: 64 });
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  
  // Refund ante (side bets not yet deducted in betting phase)
  await addMoney(guildId, userId, game.anteBet);
  
  endGame(guildId, userId);
  
  const embed = new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle('🃏 Game Cancelled')
    .setDescription(`Your ante of ${game.anteBet.toLocaleString()} ${getCurrency(guildId)} has been refunded.`);
  
  await interaction.update({ embeds: [embed], components: [] });
}

async function handlePlay(interaction, game) {
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: '❌ No active game in playing phase.', flags: 64 });
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  
  // Deduct play bet (equals ante)
  const balanceData = await getBalance(guildId, userId);
  if (balanceData.bank < game.anteBet) {
    return interaction.reply({ 
      content: `❌ Insufficient funds for Play bet! You need ${game.anteBet.toLocaleString()} ${getCurrency(guildId)}.`, 
      flags: 64 
    });
  }
  
  await removeFromBank(guildId, userId, game.anteBet);
  
  // Resolve game
  const result = playHand(guildId, userId);
  if (!result.success) {
    return interaction.reply({ content: `❌ ${result.error}`, flags: 64 });
  }
  
  // Calculate winnings and pay out
  const totalBet = game.anteBet * 2 + game.pairPlusBet + game.sixCardBet; // Ante + Play + side bets
  const netResult = result.results.totalResult;
  
  if (netResult >= 0) {
    // Return original bets plus winnings to cash balance
    await addMoney(guildId, userId, totalBet + netResult);
  } else {
    // Return any partial wins (side bets that won) to cash balance
    const partialReturn = totalBet + netResult; // netResult is negative
    if (partialReturn > 0) {
      await addMoney(guildId, userId, partialReturn);
    }
  }
  
  // Show results
  const { embed, imageBuffer } = await createResultEmbed(game, result.results, interaction.user.displayName);
  const components = createResultComponents(userId, game.anteBet, game.pairPlusBet || 0, game.sixCardBet || 0);
  
  const replyOptions = { embeds: [embed], components };
  if (imageBuffer) {
    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'threecardpoker.png' });
    embed.setImage('attachment://threecardpoker.png');
    replyOptions.files = [attachment];
  }
  
  await interaction.update(replyOptions);
  endGame(guildId, userId);
}

async function handleFold(interaction, game) {
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: '❌ No active game in playing phase.', flags: 64 });
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  
  // Resolve game (fold)
  const result = foldHand(guildId, userId);
  if (!result.success) {
    return interaction.reply({ content: `❌ ${result.error}`, flags: 64 });
  }
  
  // Pay out any side bet wins (Pair Plus and 6-Card still pay when folding)
  const sideBetWins = Math.max(0, result.results.pairPlusResult) + Math.max(0, result.results.sixCardResult);
  const sideBetLosses = Math.min(0, result.results.pairPlusResult) + Math.min(0, result.results.sixCardResult);
  const sideBetTotal = game.pairPlusBet + game.sixCardBet;
  
  // Return side bet stakes + any wins, minus losses to cash balance
  const sideReturn = sideBetTotal + sideBetWins + sideBetLosses;
  if (sideReturn > 0) {
    await addMoney(guildId, userId, sideReturn);
  }
  
  // Show results
  const { embed, imageBuffer } = await createResultEmbed(game, result.results, interaction.user.displayName);
  const components = createResultComponents(userId, game.anteBet, game.pairPlusBet || 0, game.sixCardBet || 0);
  
  const replyOptions = { embeds: [embed], components };
  if (imageBuffer) {
    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'threecardpoker.png' });
    embed.setImage('attachment://threecardpoker.png');
    replyOptions.files = [attachment];
  }
  
  await interaction.update(replyOptions);
  endGame(guildId, userId);
}

async function handlePlayAgain(interaction, bets) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  
  // Get bet amounts from the button data
  const previousAnte = bets.ante;
  const previousPairPlus = bets.pairPlus;
  const previousSixCard = bets.sixCard;
  const totalRequired = previousAnte + previousPairPlus + previousSixCard;
  
  // Check if game is still enabled
  const settings = getSettings(guildId);
  if (!settings.enabled) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🃏 Game Disabled')
      .setDescription('Three Card Poker is currently disabled.');
    return interaction.update({ embeds: [embed], components: [] });
  }
  
  // Check balance for all bets
  const balanceData = await getBalance(guildId, userId);
  if (balanceData.bank < totalRequired) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('💸 Insufficient Funds')
      .setDescription(`You need **${totalRequired.toLocaleString()} ${getCurrency(guildId)}** to play again with the same bets.\nYou have **${balanceData.bank.toLocaleString()} ${getCurrency(guildId)}** in your bank.`);
    return interaction.update({ embeds: [embed], components: [] });
  }
  
  // Clean up old game if exists
  if (hasActiveGame(guildId, userId)) {
    forceEndGame(guildId, userId);
  }
  
  // Start new game with same ante
  const result = startGame(guildId, userId, previousAnte);
  if (!result.success) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ Error')
      .setDescription(result.error);
    return interaction.update({ embeds: [embed], components: [] });
  }
  
  // Deduct ante
  await removeFromBank(guildId, userId, previousAnte);
  
  // Set side bets if any
  if (previousPairPlus > 0 || previousSixCard > 0) {
    const sideResult = setSideBets(guildId, userId, previousPairPlus, previousSixCard);
    if (sideResult.success) {
      // Deduct side bets
      if (previousPairPlus > 0) {
        await removeFromBank(guildId, userId, previousPairPlus);
      }
      if (previousSixCard > 0) {
        await removeFromBank(guildId, userId, previousSixCard);
      }
    }
  }
  
  // Get updated game state
  const newGame = getActiveGame(guildId, userId);
  
  // Deal cards immediately (skip betting phase since bets are already set)
  const dealResult = dealCards(guildId, userId);
  if (!dealResult.success) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ Error')
      .setDescription(dealResult.error);
    return interaction.update({ embeds: [embed], components: [] });
  }
  
  // Show playing phase
  const newBalance = balanceData.bank - totalRequired;
  const { embed, imageBuffer } = await createPlayingEmbed(dealResult.game, interaction.user.displayName);
  const components = createPlayingComponents(userId, previousAnte);
  
  const replyOptions = { embeds: [embed], components };
  
  if (imageBuffer) {
    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'threecardpoker.png' });
    embed.setImage('attachment://threecardpoker.png');
    replyOptions.files = [attachment];
  }
  
  const reply = await interaction.update({ 
    ...replyOptions,
    fetchReply: true 
  });
  setGameMessage(guildId, userId, reply.id, interaction.channelId);
  
  // Set timer for auto-fold (reuse settings from earlier in function)
  setGameTimer(guildId, userId, async () => {
    const currentGame = getActiveGame(guildId, userId);
    if (currentGame && currentGame.phase === 'playing') {
      const timeoutResult = forceEndGame(guildId, userId, 'timeout');
      try {
        const channel = await interaction.client.channels.fetch(interaction.channelId);
        const message = await channel.messages.fetch(reply.id);
        const timeoutEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('⏰ Time\'s Up!')
          .setDescription('You took too long to decide. Your ante has been forfeited.');
        await message.edit({ embeds: [timeoutEmbed], components: [] });
      } catch (e) { /* Message may be deleted */ }
    }
  }, settings.timerSeconds * 1000);
}

async function handleDone(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🃏 Thanks for Playing!')
    .setDescription('Come back anytime to play Three Card Poker!');
  
  await interaction.update({ embeds: [embed], components: [] });
}
