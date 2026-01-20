const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBalance, removeMoney, addMoney, removeFromTotal } = require('../economy');
const { 
  startBlackjackGame, 
  getBlackjackGame, 
  blackjackHit, 
  blackjackDoubleDown,
  blackjackTakeInsurance,
  blackjackDeclineInsurance,
  dealerHasBlackjack,
  dealerNeedsCard,
  dealerHit,
  finalizeDealerTurn,
  endBlackjackGame,
  calculateHandValue,
  updateBlackjackStats,
  canSplitHand,
  blackjackSplit,
  blackjackHitSplit,
  blackjackStandSplit,
  resolveSplitGame
} = require('../gambling');
const { generateBlackjackImage } = require('../cardImages');

const CURRENCY = '<:babybel:1418824333664452608>';
const DEALER_CARD_DELAY = 1200; // milliseconds between dealer cards

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play a game of blackjack')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Amount to bet')
        .setRequired(true)
        .setMinValue(100)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const bet = interaction.options.getInteger('bet');

    // Defer reply immediately to prevent timeout
    await interaction.deferReply();

    // Check for existing game
    const existingGame = getBlackjackGame(userId);
    if (existingGame) {
      return interaction.editReply({
        content: '❌ You already have an active blackjack game! Finish it first.'
      });
    }

    // Check balance (can use cash + bank)
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.total < bet) {
      return interaction.editReply({
        content: `❌ You don't have enough! Your balance: **${balanceData.total.toLocaleString()}** ${CURRENCY}`
      });
    }

    // Deduct bet from total balance (cash first, then bank) and start game
    await removeFromTotal(guildId, userId, bet, 'Blackjack bet');
    const game = startBlackjackGame(userId, bet, guildId);

    try {
      // Check for immediate win/push (natural blackjack)
      if (game.status === 'blackjack') {
        const winnings = Math.floor(bet * 2.5); // Blackjack pays 3:2
        await addMoney(guildId, userId, winnings, 'Blackjack win');
        updateBlackjackStats(userId, 'blackjack', winnings - bet);
        endBlackjackGame(userId);

        const { embed, attachment } = await createGameEmbed(game, interaction.user, true, winnings - bet);
        return interaction.editReply({ embeds: [embed], files: [attachment] });
      }

      if (game.status === 'push') {
        await addMoney(guildId, userId, bet, 'Blackjack push'); // Return bet
        updateBlackjackStats(userId, 'push', 0);
        endBlackjackGame(userId);

        const { embed, attachment } = await createGameEmbed(game, interaction.user, true, 0);
        return interaction.editReply({ embeds: [embed], files: [attachment] });
      }

      // Check if insurance is being offered
      if (game.status === 'insurance') {
        const { embed, attachment } = await createInsuranceEmbed(game, interaction.user);
        const maxInsurance = Math.floor(bet / 2);
        const balance = balanceData.total; // Use total balance for button check
        const buttons = createInsuranceButtons(maxInsurance, balance >= maxInsurance);
        return interaction.editReply({ embeds: [embed], files: [attachment], components: [buttons] });
      }

      // Normal game - show buttons
      const { embed, attachment } = await createGameEmbed(game, interaction.user, false);
      const canDouble = balanceData.total >= bet;
      const canSplit = balanceData.total >= bet && canSplitHand(game.playerHand);
      const buttons = createGameButtons(game, canDouble, canSplit);
      
      await interaction.editReply({ embeds: [embed], files: [attachment], components: [buttons] });
    } catch (error) {
      // If anything fails (like image loading), refund the bet and clean up
      console.error('Blackjack game error, refunding bet:', error);
      await addMoney(guildId, userId, bet, 'Blackjack refund (error)');
      endBlackjackGame(userId);
      return interaction.editReply({
        content: `❌ Something went wrong starting the game. Your bet of **${bet.toLocaleString()}** ${CURRENCY} has been refunded.`
      });
    }
  }
};

async function createGameEmbed(game, user, gameOver, winnings = 0) {
  const playerValue = calculateHandValue(game.playerHand);
  const dealerValue = calculateHandValue(game.dealerHand);
  
  let color = 0x3498db; // Blue for in progress
  let title = '🃏 Blackjack';
  let description = '';

  if (gameOver) {
    switch (game.status) {
      case 'blackjack':
        color = 0xf1c40f; // Gold
        title = '🎰 BLACKJACK!';
        description = `You got a natural blackjack! **+${winnings.toLocaleString()}** ${CURRENCY}`;
        break;
      case 'playerWin':
      case 'dealerBust':
        color = 0x2ecc71; // Green
        title = '🎉 You Win!';
        description = game.status === 'dealerBust' 
          ? `Dealer busts! **+${winnings.toLocaleString()}** ${CURRENCY}`
          : `You beat the dealer! **+${winnings.toLocaleString()}** ${CURRENCY}`;
        break;
      case 'dealerWin':
      case 'playerBust':
        color = 0xe74c3c; // Red
        title = '😢 You Lose';
        description = game.status === 'playerBust'
          ? `Bust! You went over 21. **-${game.bet.toLocaleString()}** ${CURRENCY}`
          : `Dealer wins. **-${game.bet.toLocaleString()}** ${CURRENCY}`;
        break;
      case 'push':
        color = 0x95a5a6; // Gray
        title = '🤝 Push';
        description = 'It\'s a tie! Your bet has been returned.';
        break;
    }
  }

  // Generate card image
  const imageBuffer = await generateBlackjackImage(game.playerHand, game.dealerHand, !gameOver);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack.png' });

  // Calculate cards remaining
  const cardsRemaining = game.deck.length;
  const totalCards = game.totalCards || game.numDecks * 52;
  
  // Build footer text
  let footerText = `${user.username} | ${game.numDecks} deck${game.numDecks > 1 ? 's' : ''} | ${cardsRemaining}/${totalCards} cards`;
  if (game.reshuffled) {
    footerText += ' | 🔄 Fresh shuffle';
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description || `Bet: **${game.bet.toLocaleString()}** ${CURRENCY}`)
    .setImage('attachment://blackjack.png')
    .setFooter({ text: footerText })
    .setTimestamp();

  return { embed, attachment };
}

// Create insurance offer embed
async function createInsuranceEmbed(game, user) {
  const playerValue = calculateHandValue(game.playerHand);
  const maxInsurance = Math.floor(game.bet / 2);
  
  // Generate card image (dealer's hole card hidden)
  const imageBuffer = await generateBlackjackImage(game.playerHand, game.dealerHand, true);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack.png' });

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f) // Gold for insurance offer
    .setTitle('🛡️ Insurance?')
    .setDescription(
      `Dealer shows an **Ace**!\n\n` +
      `Bet: **${game.bet.toLocaleString()}** ${CURRENCY}\n` +
      `Your hand: **${playerValue}**\n\n` +
      `Would you like to take insurance?\n` +
      `• Insurance costs up to **${maxInsurance.toLocaleString()}** ${CURRENCY} (half your bet)\n` +
      `• If dealer has Blackjack, insurance pays **2:1**\n` +
      `• If dealer doesn't have Blackjack, you lose the insurance bet`
    )
    .setImage('attachment://blackjack.png')
    .setFooter({ text: `${user.username} | ${game.numDecks} deck${game.numDecks > 1 ? 's' : ''}` })
    .setTimestamp();

  return { embed, attachment };
}

// Create insurance buttons
function createInsuranceButtons(maxInsurance, canAfford) {
  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('bj_insurance_full')
      .setLabel(`Full Insurance (${maxInsurance.toLocaleString()})`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('🛡️')
      .setDisabled(!canAfford),
    new ButtonBuilder()
      .setCustomId('bj_insurance_decline')
      .setLabel('No Insurance')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌')
  );

  return row;
}

function createGameButtons(game, canDouble, canSplit = false) {
  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('bj_hit')
      .setLabel('Hit')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👆'),
    new ButtonBuilder()
      .setCustomId('bj_stand')
      .setLabel('Stand')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✋')
  );

  // Only show double down on first two cards
  if (game.playerHand.length === 2 && canDouble && !game.hasSplit) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_double')
        .setLabel('Double Down')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⬆️')
    );
  }

  // Only show split on first two cards of same rank, if not already split
  if (game.playerHand.length === 2 && canSplit && !game.hasSplit && canSplitHand(game.playerHand)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_split')
        .setLabel('Split')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✂️')
    );
  }

  return row;
}

// Export button handler
module.exports.handleBlackjackButton = async function(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const game = getBlackjackGame(userId);

  if (!game) {
    return interaction.reply({
      content: '❌ No active game found. Start a new game with `/blackjack`',
      flags: 64
    });
  }

  const action = interaction.customId;

  // Handle insurance buttons
  if (action === 'bj_insurance_full' || action === 'bj_insurance_decline') {
    if (game.status !== 'insurance') {
      return interaction.reply({
        content: '❌ Insurance is no longer available.',
        flags: 64
      });
    }

    await interaction.deferUpdate();

    if (action === 'bj_insurance_full') {
      const insuranceAmount = Math.floor(game.bet / 2);
      const balanceData = await getBalance(guildId, userId);
      
      if (balanceData.total < insuranceAmount) {
        return interaction.followUp({
          content: `❌ You need **${insuranceAmount.toLocaleString()}** ${CURRENCY} for insurance!`,
          flags: 64
        });
      }
      
      await removeFromTotal(guildId, userId, insuranceAmount, 'Blackjack insurance');
      blackjackTakeInsurance(userId, insuranceAmount);
    } else {
      blackjackDeclineInsurance(userId);
    }

    // Check if dealer has blackjack
    const updatedGame = getBlackjackGame(userId);
    if (dealerHasBlackjack(userId)) {
      return handleDealerBlackjack(interaction, userId, guildId, updatedGame);
    }

    // Dealer doesn't have blackjack - continue game
    // If player took insurance, they lost it
    const { embed, attachment } = await createGameEmbed(updatedGame, interaction.user, false);
    const balanceData = await getBalance(guildId, userId);
    const buttons = createGameButtons(updatedGame, balanceData.total >= updatedGame.bet);
    
    let insuranceMsg = '';
    if (updatedGame.insuranceBet > 0) {
      insuranceMsg = `\n\n*Dealer doesn't have Blackjack. Insurance lost: **-${updatedGame.insuranceBet.toLocaleString()}** ${CURRENCY}*`;
    }
    
    const modifiedEmbed = EmbedBuilder.from(embed)
      .setDescription(embed.data.description + insuranceMsg);
    
    return interaction.editReply({ embeds: [modifiedEmbed], files: [attachment], components: [buttons] });
  }

  if (game.status !== 'playing' && !(game.hasSplit && game.currentHand === 'split' && game.splitStatus === 'playing')) {
    return interaction.reply({
      content: '❌ This game is already over.',
      flags: 64
    });
  }

  await interaction.deferUpdate();

  let updatedGame = game;
  let triggerDealerTurn = false;

  if (action === 'bj_hit') {
    // Check if playing split hand
    if (game.hasSplit && game.currentHand === 'main') {
      updatedGame = blackjackHit(userId);
      
      // Check if main hand busted or got 21
      if (updatedGame.status === 'playerBust' || calculateHandValue(updatedGame.playerHand) === 21) {
        // Move to split hand
        updatedGame.status = 'playing';
        updatedGame.currentHand = 'split';
        
        const { embed, attachment } = await createSplitGameEmbed(updatedGame, interaction.user, false);
        const buttons = createSplitGameButtons(updatedGame);
        return interaction.editReply({ embeds: [embed], files: [attachment], components: [buttons] });
      }
      
      // Continue with main hand
      const { embed, attachment } = await createSplitGameEmbed(updatedGame, interaction.user, false);
      const buttons = createSplitGameButtons(updatedGame);
      return interaction.editReply({ embeds: [embed], files: [attachment], components: [buttons] });
    }
    
    updatedGame = blackjackHit(userId);
    // If player busted or got 21, no dealer turn needed
    if (updatedGame.status === 'playerBust') {
      // Player busted - game over (no split)
    } else if (calculateHandValue(updatedGame.playerHand) === 21) {
      // Player has 21, trigger dealer turn
      triggerDealerTurn = true;
    }
  } else if (action === 'bj_stand') {
    // Check if playing split hand - need to transition to split
    if (game.hasSplit && game.currentHand === 'main') {
      game.status = 'stand'; // Mark main hand as done
      game.currentHand = 'split';
      
      const { embed, attachment } = await createSplitGameEmbed(game, interaction.user, false);
      const buttons = createSplitGameButtons(game);
      return interaction.editReply({ embeds: [embed], files: [attachment], components: [buttons] });
    }
    triggerDealerTurn = true;
  } else if (action === 'bj_double') {
    // Check if user can afford double down (can use cash + bank)
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.total < game.bet) {
      return interaction.followUp({
        content: `❌ You need **${game.bet.toLocaleString()}** more ${CURRENCY} to double down!`,
        flags: 64
      });
    }
    await removeFromTotal(guildId, userId, game.bet, 'Blackjack double down');
    updatedGame = blackjackDoubleDown(userId);
    // Double down always triggers dealer turn (unless player busted)
    if (updatedGame.status !== 'playerBust') {
      triggerDealerTurn = true;
    }
  } else if (action === 'bj_split') {
    // Check if user can afford split
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.total < game.bet) {
      return interaction.followUp({
        content: `❌ You need **${game.bet.toLocaleString()}** more ${CURRENCY} to split!`,
        flags: 64
      });
    }
    if (!canSplitHand(game.playerHand)) {
      return interaction.followUp({
        content: '❌ You can only split a pair!',
        flags: 64
      });
    }
    await removeFromTotal(guildId, userId, game.bet, 'Blackjack split');
    updatedGame = blackjackSplit(userId);
    
    // Show split game with both hands
    const { embed, attachment } = await createSplitGameEmbed(updatedGame, interaction.user, false);
    const buttons = createSplitGameButtons(updatedGame);
    return interaction.editReply({ embeds: [embed], files: [attachment], components: [buttons] });
  } else if (action === 'bj_split_hit') {
    // Hit on split hand
    if (!game.hasSplit || game.currentHand !== 'split') {
      return interaction.followUp({ content: '❌ Invalid action.', flags: 64 });
    }
    updatedGame = blackjackHitSplit(userId);
    
    if (updatedGame.splitStatus === 'bust' || updatedGame.splitStatus === 'stand') {
      // Split hand is done, resolve the game
      return await resolveSplitAndShow(interaction, userId, guildId, updatedGame);
    }
    
    const { embed, attachment } = await createSplitGameEmbed(updatedGame, interaction.user, false);
    const buttons = createSplitGameButtons(updatedGame);
    return interaction.editReply({ embeds: [embed], files: [attachment], components: [buttons] });
  } else if (action === 'bj_split_stand') {
    // Stand on split hand
    if (!game.hasSplit || game.currentHand !== 'split') {
      return interaction.followUp({ content: '❌ Invalid action.', flags: 64 });
    }
    updatedGame = blackjackStandSplit(userId);
    return await resolveSplitAndShow(interaction, userId, guildId, updatedGame);
  }

  if (!updatedGame) {
    return interaction.followUp({
      content: '❌ Something went wrong.',
      flags: 64
    });
  }

  // If player is still playing (didn't bust), show their current hand
  if (updatedGame.status === 'playing' && !triggerDealerTurn) {
    const { embed, attachment } = await createGameEmbed(updatedGame, interaction.user, false, 0);
    const components = [createGameButtons(updatedGame, false)];
    return interaction.editReply({ embeds: [embed], files: [attachment], components });
  }

  // If player busted, show result immediately
  if (updatedGame.status === 'playerBust') {
    updateBlackjackStats(userId, 'loss', updatedGame.bet);
    endBlackjackGame(userId);
    const { embed, attachment } = await createGameEmbed(updatedGame, interaction.user, true, 0);
    return interaction.editReply({ embeds: [embed], files: [attachment], components: [] });
  }

  // Dealer's turn - animate card by card
  await playDealerTurnAnimated(interaction, userId, guildId, updatedGame);
};

// Animate dealer's turn - reveal cards one at a time
async function playDealerTurnAnimated(interaction, userId, guildId, game) {
  // First, show the dealer's hidden card (reveal the hole card)
  const { embed: revealEmbed, attachment: revealAttachment } = await createDealerTurnEmbed(game, interaction.user, 'Dealer reveals hole card...');
  await interaction.editReply({ embeds: [revealEmbed], files: [revealAttachment], components: [] });
  
  await sleep(DEALER_CARD_DELAY);
  
  // Dealer draws cards one at a time
  while (dealerNeedsCard(userId)) {
    dealerHit(userId);
    const updatedGame = getBlackjackGame(userId);
    
    const dealerValue = calculateHandValue(updatedGame.dealerHand);
    const statusMsg = dealerValue > 21 ? 'Dealer busts!' : `Dealer draws... (${dealerValue})`;
    
    const { embed, attachment } = await createDealerTurnEmbed(updatedGame, interaction.user, statusMsg);
    await interaction.editReply({ embeds: [embed], files: [attachment], components: [] });
    
    await sleep(DEALER_CARD_DELAY);
  }
  
  // Finalize the game
  const finalGame = finalizeDealerTurn(userId);
  
  // Determine winnings and update stats
  let winnings = 0;
  if (finalGame.status === 'playerWin' || finalGame.status === 'dealerBust') {
    winnings = finalGame.bet;
    await addMoney(guildId, userId, finalGame.bet * 2, 'Blackjack win');
    updateBlackjackStats(userId, 'win', winnings);
  } else if (finalGame.status === 'push') {
    await addMoney(guildId, userId, finalGame.bet, 'Blackjack push');
    updateBlackjackStats(userId, 'push', 0);
  } else {
    updateBlackjackStats(userId, 'loss', finalGame.bet);
  }
  
  endBlackjackGame(userId);
  
  // Show final result
  const { embed: finalEmbed, attachment: finalAttachment } = await createGameEmbed(finalGame, interaction.user, true, winnings);
  await interaction.editReply({ embeds: [finalEmbed], files: [finalAttachment], components: [] });
}

// Create embed for dealer's turn (showing status message)
async function createDealerTurnEmbed(game, user, statusMessage) {
  const imageBuffer = await generateBlackjackImage(game.playerHand, game.dealerHand, false);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack.png' });
  
  const embed = new EmbedBuilder()
    .setColor(0xf39c12) // Orange for dealer's turn
    .setTitle('🃏 Dealer\'s Turn')
    .setDescription(`Bet: **${game.bet.toLocaleString()}** ${CURRENCY}\n\n⏳ ${statusMessage}`)
    .setImage('attachment://blackjack.png')
    .setFooter({ text: `Player: ${user.username}` })
    .setTimestamp();
  
  return { embed, attachment };
}

// Helper function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle when dealer has blackjack after insurance decision
async function handleDealerBlackjack(interaction, userId, guildId, game) {
  const imageBuffer = await generateBlackjackImage(game.playerHand, game.dealerHand, false);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack.png' });
  
  let netResult = 0;
  let description = '';
  let color = 0xe74c3c; // Red default
  let title = '🃏 Dealer has Blackjack!';
  
  if (game.insuranceBet > 0) {
    // Player took insurance - insurance pays 2:1
    const insurancePayout = game.insuranceBet * 2; // Plus original insurance bet back = 3x
    const insuranceWin = game.insuranceBet * 2; // Net win from insurance
    
    // Player loses main bet but wins insurance
    netResult = insuranceWin - game.bet;
    
    await addMoney(guildId, userId, game.insuranceBet * 3, 'Blackjack insurance payout'); // 2:1 plus original
    
    if (netResult === 0) {
      color = 0x95a5a6; // Gray for break even
      title = '🛡️ Insurance Saved You!';
      description = `Dealer has Blackjack!\n\n` +
        `Main bet lost: **-${game.bet.toLocaleString()}** ${CURRENCY}\n` +
        `Insurance payout (2:1): **+${insuranceWin.toLocaleString()}** ${CURRENCY}\n\n` +
        `**You broke even!**`;
    } else {
      color = 0x2ecc71; // Green if net positive
      title = '🛡️ Insurance Pays Off!';
      description = `Dealer has Blackjack!\n\n` +
        `Main bet lost: **-${game.bet.toLocaleString()}** ${CURRENCY}\n` +
        `Insurance payout (2:1): **+${insuranceWin.toLocaleString()}** ${CURRENCY}\n\n` +
        `**Net: +${netResult.toLocaleString()}** ${CURRENCY}`;
    }
    
    updateBlackjackStats(userId, 'loss', -netResult); // Net result for stats
  } else {
    // Player declined insurance - loses main bet
    netResult = -game.bet;
    description = `Dealer has Blackjack!\n\n` +
      `You declined insurance.\n` +
      `**Lost: -${game.bet.toLocaleString()}** ${CURRENCY}`;
    
    updateBlackjackStats(userId, 'loss', game.bet);
  }
  
  endBlackjackGame(userId);
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setImage('attachment://blackjack.png')
    .setFooter({ text: `${interaction.user.username}` })
    .setTimestamp();
  
  return interaction.editReply({ embeds: [embed], files: [attachment], components: [] });
}

// Create embed for split game showing both hands
async function createSplitGameEmbed(game, user, gameOver) {
  const mainValue = calculateHandValue(game.playerHand);
  const splitValue = calculateHandValue(game.splitHand);
  const dealerValue = calculateHandValue(game.dealerHand);
  
  const currentHand = game.currentHand;
  const mainStatus = mainValue > 21 ? '💥 Bust' : (game.status === 'stand' || currentHand === 'split' ? '✋ Stand' : '🎯 Playing');
  const splitStatus = game.splitStatus === 'bust' ? '💥 Bust' : (game.splitStatus === 'stand' ? '✋ Stand' : '🎯 Playing');
  
  let description = `**Total Bet:** ${(game.bet + game.splitBet).toLocaleString()} ${CURRENCY}\n\n`;
  description += `**Hand 1** ${currentHand === 'main' ? '👈' : ''}: ${mainValue} ${mainStatus}\n`;
  description += `**Hand 2** ${currentHand === 'split' ? '👈' : ''}: ${splitValue} ${splitStatus}\n`;
  
  // For now, generate image for the current active hand
  const activeHand = currentHand === 'main' ? game.playerHand : game.splitHand;
  const imageBuffer = await generateBlackjackImage(activeHand, game.dealerHand, !gameOver);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack.png' });
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6) // Purple for split game
    .setTitle('🃏 Blackjack - Split Hands')
    .setDescription(description)
    .setImage('attachment://blackjack.png')
    .setFooter({ text: `${user.username} | Playing ${currentHand === 'main' ? 'Hand 1' : 'Hand 2'}` })
    .setTimestamp();
  
  return { embed, attachment };
}

// Create buttons for split game
function createSplitGameButtons(game) {
  const row = new ActionRowBuilder();
  
  if (game.currentHand === 'main') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_hit')
        .setLabel('Hit')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👆'),
      new ButtonBuilder()
        .setCustomId('bj_stand')
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✋')
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('bj_split_hit')
        .setLabel('Hit')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👆'),
      new ButtonBuilder()
        .setCustomId('bj_split_stand')
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✋')
    );
  }
  
  return row;
}

// Resolve split game and show results
async function resolveSplitAndShow(interaction, userId, guildId, game) {
  // Dealer plays
  const finalGame = resolveSplitGame(userId);
  
  const dealerValue = calculateHandValue(finalGame.dealerHand);
  const mainValue = calculateHandValue(finalGame.playerHand);
  const splitValue = calculateHandValue(finalGame.splitHand);
  
  // Calculate winnings for each hand
  let totalWinnings = 0;
  let mainWin = 0;
  let splitWin = 0;
  
  if (finalGame.mainResult === 'win') {
    mainWin = finalGame.bet;
    await addMoney(guildId, userId, finalGame.bet * 2, 'Blackjack win (Hand 1)');
  } else if (finalGame.mainResult === 'push') {
    await addMoney(guildId, userId, finalGame.bet, 'Blackjack push (Hand 1)');
  }
  
  if (finalGame.splitResult === 'win') {
    splitWin = finalGame.splitBet;
    await addMoney(guildId, userId, finalGame.splitBet * 2, 'Blackjack win (Hand 2)');
  } else if (finalGame.splitResult === 'push') {
    await addMoney(guildId, userId, finalGame.splitBet, 'Blackjack push (Hand 2)');
  }
  
  totalWinnings = mainWin + splitWin;
  const totalLoss = (finalGame.mainResult === 'loss' || finalGame.mainResult === 'bust' ? finalGame.bet : 0) +
                    (finalGame.splitResult === 'loss' || finalGame.splitResult === 'bust' ? finalGame.splitBet : 0);
  const netResult = totalWinnings - totalLoss;
  
  // Update stats
  if (netResult > 0) {
    updateBlackjackStats(userId, 'win', netResult);
  } else if (netResult < 0) {
    updateBlackjackStats(userId, 'loss', Math.abs(netResult));
  } else {
    updateBlackjackStats(userId, 'push', 0);
  }
  
  endBlackjackGame(userId);
  
  // Create final embed
  const imageBuffer = await generateBlackjackImage(finalGame.playerHand, finalGame.dealerHand, false);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack.png' });
  
  const resultIcon = (result) => {
    if (result === 'win') return '✅ Win';
    if (result === 'loss') return '❌ Loss';
    if (result === 'bust') return '💥 Bust';
    return '🤝 Push';
  };
  
  let color = netResult > 0 ? 0x2ecc71 : (netResult < 0 ? 0xe74c3c : 0x95a5a6);
  let title = netResult > 0 ? '🎉 You Won!' : (netResult < 0 ? '😢 You Lost' : '🤝 Push');
  
  let description = `**Dealer:** ${dealerValue}${dealerValue > 21 ? ' (Bust!)' : ''}\n\n`;
  description += `**Hand 1:** ${mainValue} - ${resultIcon(finalGame.mainResult)}\n`;
  description += `**Hand 2:** ${splitValue} - ${resultIcon(finalGame.splitResult)}\n\n`;
  
  if (netResult > 0) {
    description += `**Net Win: +${netResult.toLocaleString()}** ${CURRENCY}`;
  } else if (netResult < 0) {
    description += `**Net Loss: ${netResult.toLocaleString()}** ${CURRENCY}`;
  } else {
    description += `**Break Even!**`;
  }
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setImage('attachment://blackjack.png')
    .setFooter({ text: `${interaction.user.username}` })
    .setTimestamp();
  
  return interaction.editReply({ embeds: [embed], files: [attachment], components: [] });
}
