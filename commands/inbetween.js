// In Between (Acey Deucey) Command
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { getBalance, removeMoney, addMoney, removeFromTotal, applyFine } = require('../economy');
const { 
  getSettings, 
  getPot, 
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
  calculateOdds,
  getCardValue,
  getPoleValues,
  formatCard
} = require('../inbetween');
const { generateInBetweenImage } = require('../cardImages');

const CURRENCY = '<:babybel:1418824333664452608>';

// Track pending ante prompts (guildId -> { userId, messageId, timeout })
const pendingAntePrompts = new Map();

// Ante prompt timeout (15 seconds)
const ANTE_TIMEOUT_MS = 15000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inbetween')
    .setDescription('Play In Between (Acey Deucey) - a progressive pot card game'),
  
  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    
    await interaction.deferReply();
    
    const settings = getSettings(guildId);
    
    if (!settings.enabled) {
      return interaction.editReply({ content: '❌ In Between is currently disabled on this server.' });
    }
    
    // Check if a game is already in progress
    if (hasActiveGame(guildId)) {
      return interaction.editReply({ content: '❌ A game is already in progress in this server.' });
    }
    
    // Check if there's already a pending ante prompt
    if (pendingAntePrompts.has(guildId)) {
      return interaction.editReply({ content: '❌ Someone else is already starting a game. Please wait for them to finish or timeout.' });
    }
    
    // Check player cooldown
    const canStart = canStartGame(guildId, userId);
    if (!canStart.canStart) {
      return interaction.editReply({ content: `❌ ${canStart.reason}` });
    }
    
    // Check if player can afford the ante
    const balance = await getBalance(guildId, userId);
    if (balance.total < settings.anteAmount) {
      return interaction.editReply({ 
        content: `❌ You need **${settings.anteAmount.toLocaleString()}** ${CURRENCY} to ante up!\nYour balance: **${balance.total.toLocaleString()}** ${CURRENCY}` 
      });
    }
    
    // Show ante prompt (don't start game yet)
    const pot = getPot(guildId);
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🃏 In Between (Acey Deucey)')
      .setDescription(`Pay the ante to receive your two pole cards.\n\nIf the third card lands **between** your poles, you win your bet!\nIf it **hits a pole**, you pay the entire pot!`)
      .addFields(
        { name: '🎫 Ante', value: `**${settings.anteAmount.toLocaleString()}** ${CURRENCY}`, inline: true },
        { name: '💰 Current Pot', value: `**${pot.toLocaleString()}** ${CURRENCY}`, inline: true },
        { name: '📊 Max Bet', value: `**${Math.floor(pot / 2).toLocaleString()}** ${CURRENCY} (50%)`, inline: true }
      )
      .setFooter({ text: `${interaction.user.displayName} • Click within 15 seconds to deal!` })
      .setTimestamp();
    
    // Include userId in the button customId so only they can click it
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ib_pay_ante_${userId}`)
        .setLabel(`Pay Ante (${settings.anteAmount.toLocaleString()})`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🃏')
    );
    
    const reply = await interaction.editReply({ embeds: [embed], components: [row] });
    
    // Set up timeout to expire the ante prompt after 15 seconds
    const timeout = setTimeout(async () => {
      // Check if still pending (not already processed)
      if (pendingAntePrompts.has(guildId)) {
        pendingAntePrompts.delete(guildId);
        
        // Update the message to show it expired
        const expiredEmbed = new EmbedBuilder()
          .setColor(0x808080)
          .setTitle('🃏 In Between (Acey Deucey)')
          .setDescription('⏰ **Ante prompt expired!**\n\nYou took too long to respond. Use `/inbetween` to try again.')
          .setFooter({ text: `${interaction.user.displayName} • Timed out` })
          .setTimestamp();
        
        try {
          await interaction.editReply({ embeds: [expiredEmbed], components: [] });
        } catch (e) {
          // Message may have been deleted
        }
      }
    }, ANTE_TIMEOUT_MS);
    
    // Track the pending prompt
    pendingAntePrompts.set(guildId, {
      userId,
      messageId: reply.id,
      channelId: interaction.channelId,
      timeout
    });
  }
};

// ==================== GAME DISPLAY ====================

async function buildGameDisplay(game, user) {
  const settings = getSettings(game.guildId);
  let embed, attachment = null, components = [];
  
  // Generate card image
  try {
    const imageBuffer = await generateInBetweenImage(
      game.pole1, 
      game.pole2, 
      game.thirdCard,
      user.displayName,
      game.status === 'resolved'
    );
    attachment = new AttachmentBuilder(imageBuffer, { name: 'inbetween.png' });
  } catch (err) {
    console.error('Error generating In Between image:', err);
  }
  
  // Build embed based on game state
  if (game.status === 'awaiting_ace_choice') {
    embed = buildAceChoiceEmbed(game, user, attachment);
    components = buildAceChoiceButtons();
  } else if (game.status === 'awaiting_bet') {
    embed = buildBettingEmbed(game, user, attachment);
    components = buildBettingButtons(game);
  } else if (game.status === 'awaiting_high_low') {
    embed = buildHighLowEmbed(game, user, attachment);
    components = buildHighLowButtons();
  } else if (game.status === 'auto_loss') {
    embed = buildAutoLossEmbed(game, user, attachment);
    components = [];
  } else if (game.status === 'resolved') {
    embed = buildResultEmbed(game, user, attachment);
    components = [];
  }
  
  return { embed, attachment, components };
}

function buildAceChoiceEmbed(game, user, attachment) {
  const pot = game.currentPot;
  const otherVal = getCardValue(game.pole2, true); // Second card, ace always high
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🃏 In Between - Choose Ace Value')
    .setDescription(`Your first card is an **Ace**!\nChoose whether it should be **High (14)** or **Low (1)**.\n\nYour other card is **${formatCard(game.pole2)}** (${otherVal}).`)
    .addFields(
      { name: '🎯 Your Cards', value: `**${formatCard(game.pole1)}** and **${formatCard(game.pole2)}**`, inline: true },
      { name: '💰 Current Pot', value: `**${pot.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '🎫 Your Ante', value: `**${game.ante.toLocaleString()}** ${CURRENCY}`, inline: true }
    )
    .setFooter({ text: `${user.displayName} • Choose wisely!` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://inbetween.png');
  }
  
  return embed;
}

function buildBettingEmbed(game, user, attachment) {
  const pot = game.currentPot;
  const maxBet = Math.floor(pot / 2);
  const odds = calculateOdds(game);
  
  // Determine pole values for display
  const { p1Val, p2Val } = getPoleValues(game);
  const lowVal = Math.min(p1Val, p2Val);
  const highVal = Math.max(p1Val, p2Val);
  
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🃏 In Between - Place Your Bet')
    .setDescription(`Your poles: **${formatCard(game.pole1)}** (${p1Val}) and **${formatCard(game.pole2)}** (${p2Val})\n\nYou need the third card to land **between ${lowVal} and ${highVal}**.`)
    .addFields(
      { name: '💰 Pot', value: `**${pot.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '📊 Max Bet (50%)', value: `**${maxBet.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '🎫 Your Ante', value: `**${game.ante.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '📈 Spread', value: `**${odds.spread}** cards can win`, inline: true },
      { name: '✅ Win Chance', value: `~**${odds.winChance}%**`, inline: true },
      { name: '⚠️ Pole Risk', value: `~**${odds.poleChance}%**`, inline: true }
    )
    .setFooter({ text: `${user.displayName} • Hit a pole = pay double your bet!` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://inbetween.png');
  }
  
  return embed;
}

function buildHighLowEmbed(game, user, attachment) {
  const pot = game.currentPot;
  const { p1Val } = getPoleValues(game);
  const poleVal = p1Val; // In high/low mode, both poles have equal value
  
  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle('🃏 In Between - High or Low?')
    .setDescription(`Both poles are **${formatCard(game.pole1)}** and **${formatCard(game.pole2)}** (equal value: ${poleVal})!\n\nGuess if the third card will be **Higher** or **Lower** to win your ante back 1:1.\n\n⚠️ If you hit the same value again, you pay the **entire pot**!`)
    .addFields(
      { name: '💰 Pot at Risk', value: `**${pot.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '🎫 Your Ante', value: `**${game.ante.toLocaleString()}** ${CURRENCY}`, inline: true }
    )
    .setFooter({ text: `${user.displayName} • Good luck!` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://inbetween.png');
  }
  
  return embed;
}

function buildAutoLossEmbed(game, user, attachment) {
  const { p1Val, p2Val } = getPoleValues(game);
  
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🃏 In Between - Adjacent Cards!')
    .setDescription(`Bad luck! Your poles **${formatCard(game.pole1)}** (${p1Val}) and **${formatCard(game.pole2)}** (${p2Val}) are adjacent.\n\nNo card can land between them - you lose your ante.`)
    .addFields(
      { name: '💸 Lost', value: `**-${game.ante.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '💰 Pot', value: `**${game.currentPot.toLocaleString()}** ${CURRENCY}`, inline: true }
    )
    .setFooter({ text: `${user.displayName} • Better luck next time!` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://inbetween.png');
  }
  
  return embed;
}

function buildResultEmbed(game, user, attachment) {
  let color, title, description;
  const thirdVal = game.thirdCard ? getCardValue(game.thirdCard) : null;
  
  switch (game.result) {
    case 'win':
      color = 0x57F287;
      title = '🎉 Winner!';
      const totalWin = game.payout + game.ante;
      description = `The third card **${formatCard(game.thirdCard)}** (${thirdVal}) landed between your poles!\n\n**You won ${totalWin.toLocaleString()}** ${CURRENCY} *(${game.payout.toLocaleString()} + ${game.ante.toLocaleString()} ante)*!`;
      break;
    
    case 'lose':
      color = 0xED4245;
      title = '😔 Outside the Poles';
      description = `The third card **${formatCard(game.thirdCard)}** (${thirdVal}) was outside your poles.\n\n**You lost ${Math.abs(game.payout).toLocaleString()}** ${CURRENCY}.`;
      break;
    
    case 'pole_hit':
      color = 0x000000;
      title = '💀 YOU HIT THE POLE!';
      description = `The third card **${formatCard(game.thirdCard)}** (${thirdVal}) matched one of your poles!\n\n**You lose double your bet: ${Math.abs(game.payout).toLocaleString()}** ${CURRENCY}!`;
      break;
    
    case 'win_highlow':
      color = 0x57F287;
      title = '🎉 Correct Guess!';
      const totalWinHL = game.payout + game.ante;
      description = `The third card **${formatCard(game.thirdCard)}** (${thirdVal}) - you guessed right!\n\n**You won ${totalWinHL.toLocaleString()}** ${CURRENCY} *(${game.payout.toLocaleString()} + ${game.ante.toLocaleString()} ante)*!`;
      break;
    
    case 'lose_highlow':
      color = 0xED4245;
      title = '😔 Wrong Guess';
      description = `The third card **${formatCard(game.thirdCard)}** (${thirdVal}) - wrong guess!\n\n**You lost your ante: ${game.ante.toLocaleString()}** ${CURRENCY}.`;
      break;
    
    case 'pole_hit_highlow':
      color = 0x000000;
      title = '💀 HIT THE POLE ON HIGH/LOW!';
      description = `The third card **${formatCard(game.thirdCard)}** (${thirdVal}) matched the pole value!\n\n**You lose double your ante: ${Math.abs(game.payout).toLocaleString()}** ${CURRENCY}!`;
      break;
    
    case 'pass':
      color = 0x99AAB5;
      title = '🏳️ Passed';
      description = `You passed on this hand.\n\n**Ante lost: ${game.ante.toLocaleString()}** ${CURRENCY}`;
      break;
    
    case 'timeout':
      color = 0x99AAB5;
      title = '⏰ Time\'s Up!';
      description = `You ran out of time and forfeited your ante.\n\n**Ante lost: ${game.ante.toLocaleString()}** ${CURRENCY}`;
      break;
    
    case 'adjacent':
      color = 0xED4245;
      title = '📏 Adjacent Cards';
      description = `Your poles were adjacent - no card can fit between.\n\n**Ante lost: ${game.ante.toLocaleString()}** ${CURRENCY}`;
      break;
    
    default:
      color = 0x99AAB5;
      title = 'Game Over';
      description = 'The game has ended.';
  }
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🃏 In Between - ${title}`)
    .setDescription(description)
    .addFields(
      { name: '💰 Pot After', value: `**${game.currentPot.toLocaleString()}** ${CURRENCY}`, inline: true }
    )
    .setFooter({ text: `${user.displayName}` })
    .setTimestamp();
  
  if (attachment) {
    embed.setImage('attachment://inbetween.png');
  }
  
  return embed;
}

// ==================== BUTTON BUILDERS ====================

function buildAceChoiceButtons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ib_ace_high')
      .setLabel('High (14)')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⬆️'),
    new ButtonBuilder()
      .setCustomId('ib_ace_low')
      .setLabel('Low (1)')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⬇️')
  );
  
  return [row];
}

function buildBettingButtons(game) {
  const pot = game.currentPot;
  const maxBet = Math.floor(pot / 2);
  
  const bet10 = Math.floor(maxBet * 0.10);
  const bet25 = Math.floor(maxBet * 0.25);
  const bet50 = maxBet;
  
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ib_bet_10')
      .setLabel(`10% (${bet10.toLocaleString()})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ib_bet_25')
      .setLabel(`25% (${bet25.toLocaleString()})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ib_bet_50')
      .setLabel(`50% (${bet50.toLocaleString()})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ib_bet_custom')
      .setLabel('Custom')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️')
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ib_pass')
      .setLabel('Pass (Forfeit Ante)')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🏳️')
  );
  
  return [row1, row2];
}

function buildHighLowButtons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ib_high')
      .setLabel('Higher')
      .setStyle(ButtonStyle.Success)
      .setEmoji('⬆️'),
    new ButtonBuilder()
      .setCustomId('ib_low')
      .setLabel('Lower')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⬇️')
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
  
  // Handle pay ante button (before game exists)
  // Button format: ib_pay_ante_<userId>
  if (customId.startsWith('ib_pay_ante_')) {
    const allowedUserId = customId.split('_')[3]; // Extract userId from customId
    
    // Check if this user is allowed to click the button
    if (userId !== allowedUserId) {
      return interaction.reply({ content: '❌ This is not your game! Use `/inbetween` to start your own.', flags: 64 });
    }
    
    // Clear the pending prompt and timeout
    const pending = pendingAntePrompts.get(guildId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingAntePrompts.delete(guildId);
    }
    
    const settings = getSettings(guildId);
    
    // Check if a game started while waiting (shouldn't happen with lockout but safety check)
    if (hasActiveGame(guildId)) {
      return interaction.reply({ content: '❌ A game is already in progress!', flags: 64 });
    }
    
    // Check if game can still start (includes player cooldown)
    const canStart = canStartGame(guildId, userId);
    if (!canStart.canStart) {
      return interaction.reply({ content: `❌ ${canStart.reason}`, flags: 64 });
    }
    
    // Re-check balance
    const balance = await getBalance(guildId, userId);
    if (balance.total < settings.anteAmount) {
      return interaction.reply({ 
        content: `❌ You need **${settings.anteAmount.toLocaleString()}** ${CURRENCY} to ante up!\nYour balance: **${balance.total.toLocaleString()}** ${CURRENCY}`,
        flags: 64
      });
    }
    
    await interaction.deferUpdate();
    
    // Deduct ante
    await removeFromTotal(guildId, userId, settings.anteAmount, 'In Between ante');
    
    // Start the game
    const game = startGame(guildId, userId, interaction.user.displayName);
    
    // Build and send the game display
    const { embed, attachment, components } = await buildGameDisplay(game, interaction.user);
    
    const reply = await interaction.editReply({ 
      embeds: [embed], 
      files: attachment ? [attachment] : [], 
      components 
    });
    
    // If auto_loss (adjacent cards), end the game immediately
    if (game.status === 'auto_loss') {
      endGame(guildId);
      return;
    }
    
    // Store message info for timeout handling
    setGameMessage(guildId, reply.id, interaction.channelId);
    
    // Set play timer
    setPlayTimer(guildId, async () => {
      await handleTimeout(interaction.client, guildId);
    }, settings.playTimerSeconds * 1000);
    return;
  }
  
  const game = getActiveGame(guildId);
  
  if (!game) {
    return interaction.reply({ content: '❌ No active game found.', flags: 64 });
  }
  
  if (game.userId !== userId) {
    return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
  }
  
  if (processingUsers.has(userId)) {
    return interaction.reply({ content: '⏳ Processing your last action...', flags: 64 });
  }
  processingUsers.add(userId);
  try {
  
  // Handle ace choice
  if (customId === 'ib_ace_high' || customId === 'ib_ace_low') {
    const choice = customId === 'ib_ace_high' ? 'high' : 'low';
    const updatedGame = setAceChoice(guildId, choice);
    
    if (!updatedGame) {
      return interaction.reply({ content: '❌ Invalid action.', flags: 64 });
    }
    
    await interaction.deferUpdate();
    
    // Check if auto-loss due to adjacent
    if (updatedGame.status === 'auto_loss') {
      const { embed, attachment } = await buildGameDisplay(updatedGame, interaction.user);
      await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
      endGame(guildId);
      return;
    }
    
    const { embed, attachment, components } = await buildGameDisplay(updatedGame, interaction.user);
    await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components });
    return;
  }
  
  // Handle betting buttons
  if (customId.startsWith('ib_bet_')) {
    if (customId === 'ib_bet_custom') {
      // Show custom bet modal
      const pot = game.currentPot;
      const maxBet = Math.floor(pot / 2);
      
      const modal = new ModalBuilder()
        .setCustomId('ib_custom_bet_modal')
        .setTitle('Custom Bet');
      
      const betInput = new TextInputBuilder()
        .setCustomId('bet_amount')
        .setLabel(`Enter bet amount (max: ${maxBet.toLocaleString()})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1000')
        .setRequired(true);
      
      modal.addComponents(new ActionRowBuilder().addComponents(betInput));
      await interaction.showModal(modal);
      return;
    }
    
    // Calculate bet amount based on button
    const pot = game.currentPot;
    const maxBet = Math.floor(pot / 2);
    let betAmount;
    
    if (customId === 'ib_bet_10') betAmount = Math.floor(maxBet * 0.10);
    else if (customId === 'ib_bet_25') betAmount = Math.floor(maxBet * 0.25);
    else if (customId === 'ib_bet_50') betAmount = maxBet;
    
    if (betAmount < 1) betAmount = 1;
    
    await processBet(interaction, guildId, betAmount);
    return;
  }
  
  // Handle pass
  if (customId === 'ib_pass') {
    await interaction.deferUpdate();
    
    const result = passHand(guildId);
    if (!result) {
      return interaction.followUp({ content: '❌ Invalid action.', flags: 64 });
    }
    
    const { embed, attachment } = await buildGameDisplay(result, interaction.user);
    await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
    endGame(guildId);
    return;
  }
  
  // Handle high/low
  if (customId === 'ib_high' || customId === 'ib_low') {
    const guess = customId === 'ib_high' ? 'high' : 'low';
    
    await interaction.deferUpdate();
    
    const result = makeHighLowGuess(guildId, guess);
    if (!result) {
      return interaction.followUp({ content: '❌ Invalid action.', flags: 64 });
    }
    
    // Process payouts
    await processResult(interaction, result);
    
    const { embed, attachment } = await buildGameDisplay(result, interaction.user);
    await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
    endGame(guildId);
    return;
  }
  
  // Fallback for unrecognized buttons
  return interaction.reply({ content: '❌ Unknown action.', flags: 64 });

  } finally {
    processingUsers.delete(userId);
  }
}

async function handleModal(interaction) {
  if (interaction.customId !== 'ib_custom_bet_modal') return;
  
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const game = getActiveGame(guildId);
  
  if (!game || game.userId !== userId) {
    return interaction.reply({ content: '❌ Invalid game state.', flags: 64 });
  }
  
  const betStr = interaction.fields.getTextInputValue('bet_amount');
  const betAmount = parseInt(betStr.replace(/,/g, ''));
  
  if (isNaN(betAmount) || betAmount < 1) {
    return interaction.reply({ content: '❌ Invalid bet amount.', flags: 64 });
  }
  
  const pot = game.currentPot;
  const maxBet = Math.floor(pot / 2);
  
  if (betAmount > maxBet) {
    return interaction.reply({ content: `❌ Maximum bet is **${maxBet.toLocaleString()}** (50% of pot).`, flags: 64 });
  }
  
  await processBet(interaction, guildId, betAmount);
}

async function processBet(interaction, guildId, betAmount) {
  const userId = interaction.user.id;
  const game = getActiveGame(guildId);
  
  if (!game) {
    return interaction.reply({ content: '❌ No active game.', flags: 64 });
  }
  
  // Check if player can afford the bet (for potential pole hit)
  const balance = await getBalance(guildId, userId);
  
  // Deduct bet from player
  const deducted = await removeFromTotal(guildId, userId, betAmount, 'In Between bet');
  if (!deducted) {
    return interaction.reply({ content: `❌ You don't have enough to bet **${betAmount.toLocaleString()}** ${CURRENCY}!`, flags: 64 });
  }
  
  // Place the bet
  placeBet(guildId, betAmount);
  
  // Draw the third card
  const result = drawThirdCard(guildId);
  
  if (!interaction.deferred) {
    await interaction.deferUpdate();
  }
  
  // Process the result
  await processResult(interaction, result);
  
  const { embed, attachment } = await buildGameDisplay(result, interaction.user);
  await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
  endGame(guildId);
}

async function processResult(interaction, game) {
  const guildId = game.guildId;
  const userId = game.userId;
  
  if (game.result === 'win' || game.result === 'win_highlow') {
    // Pay out winnings: return bet + winnings + ante (ante was deducted at start)
    await addMoney(guildId, userId, game.bet + game.payout + game.ante, 'In Between winnings');
  } else if (game.result === 'pole_hit' || game.result === 'pole_hit_highlow') {
    // Player owes double their bet/ante (payout is negative)
    // The bet was already placed, so they owe an additional bet amount
    // Use applyFine to ensure debt is applied even if they can't afford it
    const additionalPenalty = game.result === 'pole_hit' ? game.bet : game.ante;
    await applyFine(guildId, userId, additionalPenalty, 'In Between pole penalty');
  }
  // For 'lose', the bet was already deducted when placed
  // For 'pass', the ante was already deducted when game started
}

async function handleTimeout(client, guildId) {
  const game = getActiveGame(guildId);
  if (!game) return;
  
  // Force end the game
  const result = forceEndGame(guildId, 'timeout');
  if (!result) return;
  
  // Try to update the original message
  try {
    const channel = await client.channels.fetch(game.channelId);
    const message = await channel.messages.fetch(game.messageId);
    
    // Get the user for display
    const user = await client.users.fetch(game.userId);
    
    const { embed, attachment } = await buildGameDisplay(result, user);
    await message.edit({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
  } catch (err) {
    console.error('Error updating timed out In Between game:', err);
  }
}

module.exports.handleButton = handleButton;
module.exports.handleModal = handleModal;
module.exports.handleTimeout = handleTimeout;
