const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBalance, removeMoney, addMoney, removeFromTotal } = require('../economy');
const { 
  purchaseScratchTicket,
  getActiveScratchTickets,
  getScratchTicket,
  scratchBoxes,
  revealAllBoxes,
  updateScratchStats,
  getScratchStats,
  getRecentScratchWins,
  getGamblingSettings,
  getScratchCardSettings,
  getAllScratchCardSettings
} = require('../gambling');
const {
  generateScratchCard,
  generateRevealedCard,
  generateCardSymbols,
  checkWinningsWithSettings,
  getCardConfig,
  getCardTypes,
  CARD_CONFIGS
} = require('../scratchcard');

const CURRENCY = '<:babybel:1418824333664452608>';

// Note: The /scratch command has been removed. Use /scratcher instead.
// This file is kept only for handling legacy scratch card buttons (scratch_play_, scratch_reveal_, etc.)

module.exports = {
  // No slash command - use /scratcher instead
  data: null,

  // Export button handler for legacy scratch_ prefixed buttons
  async handleButton(interaction) {
    const [action, ticketId, ...args] = interaction.customId.split('_').slice(1);
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Verify ticket ownership
    const ticket = getScratchTicket(parseInt(ticketId));
    if (!ticket) {
      return interaction.reply({
        content: '❌ Ticket not found!',
        flags: 64
      });
    }
    if (ticket.user_id !== userId) {
      return interaction.reply({
        content: '❌ This is not your scratch card!',
        flags: 64
      });
    }

    switch (action) {
      case 'scratch':
        return handleScratchBox(interaction, ticket, parseInt(args[0]));
      case 'reveal':
        return handleRevealAll(interaction, ticket, guildId, userId);
      case 'play':
        return handlePlayCard(interaction, ticket);
    }
  }
};

async function handleBuy(interaction, guildId, userId) {
  const cardType = interaction.options.getString('type');
  const config = getCardConfig(cardType);
  
  if (!config) {
    return interaction.reply({
      content: '❌ Invalid card type!',
      flags: 64
    });
  }

  // Get guild-specific settings for this card type
  const cardSettings = getScratchCardSettings(guildId, cardType);
  const price = cardSettings.price;

  // Check for existing active tickets of same type
  const activeTickets = getActiveScratchTickets(guildId, userId);
  const existingSameType = activeTickets.filter(t => t.card_type === cardType);
  if (existingSameType.length >= 3) {
    return interaction.reply({
      content: `❌ You already have ${existingSameType.length} unfinished ${config.name} cards! Finish those first.`,
      flags: 64
    });
  }

  // Check balance (can use cash + bank)
  const balanceData = await getBalance(guildId, userId);
  if (balanceData.total < price) {
    return interaction.reply({
      content: `❌ You need **${price.toLocaleString()}** ${CURRENCY} to buy a ${config.name} card! You have **${balanceData.total.toLocaleString()}** ${CURRENCY}`,
      flags: 64
    });
  }

  await interaction.deferReply();

  // Deduct money from total balance (cash first, then bank)
  await removeFromTotal(guildId, userId, price, `Scratch card purchase: ${config.name}`);

  // Generate symbols with guild-specific odds and create ticket
  const symbols = generateCardSymbols(cardType, cardSettings);
  const ticket = purchaseScratchTicket(guildId, userId, cardType, symbols);

  // Generate card image
  const imageBuffer = generateScratchCard(cardType, symbols, null, ticket.id);
  const attachment = new AttachmentBuilder(imageBuffer, { name: `scratch-${ticket.id}.png` });

  const embed = new EmbedBuilder()
    .setColor(parseInt(config.colors.gradientStart.replace('#', ''), 16))
    .setTitle(`${config.emoji} ${config.name} Purchased!`)
    .setDescription(`Ticket #${ticket.id}\n\nGood luck! Scratch to reveal your prizes!`)
    .addFields(
      { name: '💰 Cost', value: `**${price.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '📊 Grid', value: `${config.grid.rows}x${config.grid.cols} (${config.grid.rows * config.grid.cols} boxes)`, inline: true }
    )
    .setImage(`attachment://scratch-${ticket.id}.png`)
    .setFooter({ text: 'Click "Play Card" to start scratching!' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`scratch_play_${ticket.id}`)
      .setLabel('🎮 Play Card')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`scratch_reveal_${ticket.id}`)
      .setLabel('⚡ Reveal All')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
    components: [row]
  });
}

async function handlePlayCard(interaction, ticket) {
  if (ticket.is_complete) {
    return interaction.reply({
      content: '❌ This card has already been completed!',
      flags: 64
    });
  }

  await interaction.deferUpdate();

  const config = getCardConfig(ticket.card_type);
  const totalBoxes = config.grid.rows * config.grid.cols;
  
  // Create grid of buttons for scratching
  const rows = [];
  let boxIndex = 0;
  
  for (let r = 0; r < config.grid.rows; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < config.grid.cols; c++) {
      const isScratched = ticket.scratched[boxIndex];
      const button = new ButtonBuilder()
        .setCustomId(`scratch_scratch_${ticket.id}_${boxIndex}`)
        .setStyle(isScratched ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(isScratched);
      
      if (isScratched) {
        button.setLabel(ticket.symbols[boxIndex]);
      } else {
        button.setLabel('❓');
      }
      
      row.addComponents(button);
      boxIndex++;
    }
    rows.push(row);
  }
  
  // Add reveal all button
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`scratch_reveal_${ticket.id}`)
      .setLabel('⚡ Reveal All')
      .setStyle(ButtonStyle.Danger)
  );
  rows.push(controlRow);

  // Generate current card image
  const imageBuffer = generateScratchCard(ticket.card_type, ticket.symbols, ticket.scratched, ticket.id);
  const attachment = new AttachmentBuilder(imageBuffer, { name: `scratch-${ticket.id}.png` });

  const scratchedCount = ticket.scratched.filter(s => s).length;
  const embed = new EmbedBuilder()
    .setColor(parseInt(config.colors.gradientStart.replace('#', ''), 16))
    .setTitle(`${config.emoji} ${config.name} - Ticket #${ticket.id}`)
    .setDescription(`Click the ❓ buttons to scratch each box!\n\n**Scratched:** ${scratchedCount}/${totalBoxes}`)
    .setImage(`attachment://scratch-${ticket.id}.png`)
    .setFooter({ text: 'Match 3 symbols to win!' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
    components: rows
  });
}

async function handleScratchBox(interaction, ticket, boxIndex) {
  if (ticket.is_complete) {
    return interaction.reply({
      content: '❌ This card has already been completed!',
      flags: 64
    });
  }

  if (ticket.scratched[boxIndex]) {
    return interaction.reply({
      content: '❌ This box is already scratched!',
      flags: 64
    });
  }

  await interaction.deferUpdate();

  // Scratch the box
  const updatedTicket = scratchBoxes(ticket.id, [boxIndex]);
  const config = getCardConfig(updatedTicket.card_type);
  const totalBoxes = config.grid.rows * config.grid.cols;
  const scratchedCount = updatedTicket.scratched.filter(s => s).length;

  // Check if all boxes scratched
  const allScratched = scratchedCount === totalBoxes;

  if (allScratched) {
    // Complete the ticket
    return finishCard(interaction, updatedTicket, interaction.guildId, interaction.user.id);
  }

  // Create updated grid
  const rows = [];
  let idx = 0;
  
  for (let r = 0; r < config.grid.rows; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < config.grid.cols; c++) {
      const isScratched = updatedTicket.scratched[idx];
      const button = new ButtonBuilder()
        .setCustomId(`scratch_scratch_${ticket.id}_${idx}`)
        .setStyle(isScratched ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(isScratched);
      
      if (isScratched) {
        button.setLabel(updatedTicket.symbols[idx]);
      } else {
        button.setLabel('❓');
      }
      
      row.addComponents(button);
      idx++;
    }
    rows.push(row);
  }
  
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`scratch_reveal_${ticket.id}`)
      .setLabel('⚡ Reveal All')
      .setStyle(ButtonStyle.Danger)
  );
  rows.push(controlRow);

  // Generate updated card image
  const imageBuffer = generateScratchCard(updatedTicket.card_type, updatedTicket.symbols, updatedTicket.scratched, updatedTicket.id);
  const attachment = new AttachmentBuilder(imageBuffer, { name: `scratch-${ticket.id}.png` });

  const embed = new EmbedBuilder()
    .setColor(parseInt(config.colors.gradientStart.replace('#', ''), 16))
    .setTitle(`${config.emoji} ${config.name} - Ticket #${ticket.id}`)
    .setDescription(`Click the ❓ buttons to scratch each box!\n\n**Scratched:** ${scratchedCount}/${totalBoxes}`)
    .setImage(`attachment://scratch-${ticket.id}.png`)
    .setFooter({ text: 'Match 3 symbols to win!' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
    components: rows
  });
}

async function handleRevealAll(interaction, ticket, guildId, userId) {
  if (ticket.is_complete) {
    return interaction.reply({
      content: '❌ This card has already been completed!',
      flags: 64
    });
  }

  await interaction.deferUpdate();
  return finishCard(interaction, ticket, guildId, userId);
}

async function finishCard(interaction, ticket, guildId, userId) {
  const config = getCardConfig(ticket.card_type);
  const cardSettings = getScratchCardSettings(guildId, ticket.card_type);
  
  // Calculate winnings with guild-specific settings
  const { winnings, winType } = checkWinningsWithSettings(ticket.card_type, ticket.symbols, cardSettings);
  
  // Complete the ticket
  const completedTicket = revealAllBoxes(ticket.id, winnings, winType);
  
  // Determine spent amount - free tickets cost $0
  const spentAmount = ticket.is_free ? 0 : cardSettings.price;
  
  // For FREE_TICKET wins, the winnings are 0 (they get a new ticket, not cash)
  const wonAmount = winType === 'FREE_TICKET' ? 0 : winnings;
  
  // Always update stats for every ticket played
  updateScratchStats(guildId, userId, ticket.card_type, spentAmount, wonAmount, winType === 'JACKPOT' || winType === 'MEGA JACKPOT');
  
  // Pay out winnings
  if (winnings > 0) {
    await addMoney(guildId, userId, winnings, `Scratch card win: ${config.name} - ${winType}`);
  }
  
  // Handle FREE TICKET - generate a new ticket automatically (marked as free)
  let freeTicket = null;
  if (winType === 'FREE_TICKET') {
    const symbols = generateCardSymbols(ticket.card_type, cardSettings);
    freeTicket = purchaseScratchTicket(guildId, userId, ticket.card_type, symbols, true);
  }

  // Generate revealed card image
  const imageBuffer = generateRevealedCard(ticket.card_type, ticket.symbols, ticket.id);
  const attachment = new AttachmentBuilder(imageBuffer, { name: `scratch-${ticket.id}-revealed.png` });

  // Build result embed
  let resultColor, resultTitle, resultDesc;
  
  if (winType === 'JACKPOT' || winType === 'MEGA JACKPOT') {
    resultColor = 0xFFD700;
    resultTitle = `🎉 ${winType}! ${config.emoji} ${config.name}`;
    resultDesc = `**INCREDIBLE!** You hit the ${winType}!\n\n💎 **Won: ${winnings.toLocaleString()}** ${CURRENCY}`;
  } else if (winType === 'MEGA WIN') {
    resultColor = 0xE91E63;
    resultTitle = `🎊 MEGA WIN! ${config.emoji} ${config.name}`;
    resultDesc = `**AMAZING!** You got a MEGA WIN!\n\n🏆 **Won: ${winnings.toLocaleString()}** ${CURRENCY}`;
  } else if (winType === 'WIN') {
    resultColor = 0x4CAF50;
    resultTitle = `✨ Winner! ${config.emoji} ${config.name}`;
    resultDesc = `**Congratulations!** You matched 3!\n\n💰 **Won: ${winnings.toLocaleString()}** ${CURRENCY}`;
  } else if (winType === 'FREE_TICKET') {
    resultColor = 0x9C27B0;
    resultTitle = `🎟️ Free Ticket! ${config.emoji} ${config.name}`;
    resultDesc = `**You matched 3 symbols!** You win a FREE ticket!\n\n🎫 **New Ticket:** #${freeTicket.id}`;
  } else {
    resultColor = 0x9E9E9E;
    resultTitle = `${config.emoji} ${config.name} - No Win`;
    resultDesc = `Better luck next time!\n\n💸 **Cost:** ${cardSettings.price.toLocaleString()} ${CURRENCY}`;
  }

  const embed = new EmbedBuilder()
    .setColor(resultColor)
    .setTitle(resultTitle)
    .setDescription(resultDesc);
  
  // Different fields for free ticket vs regular result
  if (winType === 'FREE_TICKET') {
    embed.addFields(
      { name: '🎟️ Original Ticket', value: `#${ticket.id}`, inline: true },
      { name: '🎫 Free Ticket', value: `#${freeTicket.id}`, inline: true },
      { name: '💵 Cost', value: 'FREE!', inline: true }
    );
  } else {
    embed.addFields(
      { name: '🎟️ Ticket', value: `#${ticket.id}`, inline: true },
      { name: '💵 Cost', value: `${cardSettings.price.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '📊 Net', value: `${(winnings - cardSettings.price).toLocaleString()} ${CURRENCY}`, inline: true }
    );
  }
  
  embed
    .setImage(`attachment://scratch-${ticket.id}-revealed.png`)
    .setFooter({ text: winType === 'FREE_TICKET' ? 'Click below to play your free ticket!' : 'Use /scratch buy to play again!' })
    .setTimestamp();

  // Show symbol counts
  const counts = {};
  for (const sym of ticket.symbols) {
    counts[sym] = (counts[sym] || 0) + 1;
  }
  const countsText = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([sym, count]) => `${sym} x${count}`)
    .join('  ');
  
  embed.addFields({ name: '🎲 Symbols', value: countsText });

  // Add buttons for free ticket
  const components = [];
  if (winType === 'FREE_TICKET' && freeTicket) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratch_play_${freeTicket.id}`)
        .setLabel('🎮 Play Free Ticket')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`scratch_reveal_${freeTicket.id}`)
        .setLabel('⚡ Reveal All')
        .setStyle(ButtonStyle.Secondary)
    );
    components.push(row);
  }

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
    components
  });
}

async function handleCards(interaction, guildId, userId) {
  const tickets = getActiveScratchTickets(guildId, userId);

  if (tickets.length === 0) {
    return interaction.reply({
      content: '❌ You don\'t have any active scratch cards. Use `/scratch buy` to purchase one!',
      flags: 64
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎟️ Your Active Scratch Cards')
    .setDescription('Click a button to play a card!')
    .setTimestamp();

  const rows = [];
  
  for (const ticket of tickets.slice(0, 5)) {
    const config = getCardConfig(ticket.card_type);
    const scratchedCount = ticket.scratched.filter(s => s).length;
    const totalBoxes = config.grid.rows * config.grid.cols;
    
    embed.addFields({
      name: `${config.emoji} Ticket #${ticket.id} - ${config.name}`,
      value: `Progress: ${scratchedCount}/${totalBoxes} scratched`,
      inline: true
    });
    
    if (rows.length < 5) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`scratch_play_${ticket.id}`)
          .setLabel(`Play #${ticket.id}`)
          .setEmoji(config.emoji)
          .setStyle(ButtonStyle.Primary)
      );
      rows.push(row);
    }
  }

  if (tickets.length > 5) {
    embed.setFooter({ text: `Showing 5 of ${tickets.length} cards` });
  }

  await interaction.reply({
    embeds: [embed],
    components: rows,
    flags: 64
  });
}

async function handleInfo(interaction, guildId) {
  const allSettings = getAllScratchCardSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎰 Scratch Cards Info')
    .setDescription('Scratch off the boxes to reveal symbols. Match 3 or more of the same symbol to win!')
    .setTimestamp();

  for (const cardType of getCardTypes()) {
    const config = getCardConfig(cardType);
    const settings = allSettings[cardType];
    const totalBoxes = config.grid.rows * config.grid.cols;
    
    let prizesText = `Match 3: **${settings.match3}x** (${(settings.price * settings.match3).toLocaleString()} ${CURRENCY})`;
    if (settings.match4) {
      prizesText += `\nMatch 4: **${settings.match4}x** (${(settings.price * settings.match4).toLocaleString()} ${CURRENCY})`;
    }
    prizesText += `\nJackpot (💎): **${settings.jackpot}x** (${(settings.price * settings.jackpot).toLocaleString()} ${CURRENCY})`;
    
    embed.addFields({
      name: `${config.emoji} ${config.name}`,
      value: [
        `**Price:** ${settings.price.toLocaleString()} ${CURRENCY}`,
        `**Grid:** ${config.grid.rows}x${config.grid.cols} (${totalBoxes} boxes)`,
        `**Prizes:**`,
        prizesText
      ].join('\n'),
      inline: false
    });
  }

  embed.addFields({
    name: '💡 Tips',
    value: [
      '• Each card has different odds and payouts',
      '• Jackpot symbol (💎) wins big if you match 3!',
      '• You can have up to 3 of each card type active',
      '• Use "Reveal All" to instantly see your results'
    ].join('\n')
  });

  await interaction.reply({ embeds: [embed] });
}

async function handleStats(interaction, guildId, userId) {
  const stats = getScratchStats(guildId, userId);

  if (stats.length === 0) {
    return interaction.reply({
      content: '❌ You haven\'t played any scratch cards yet! Use `/scratch buy` to get started.',
      flags: 64
    });
  }

  let totalSpent = 0;
  let totalWon = 0;
  let totalPurchased = 0;
  let totalJackpots = 0;

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Your Scratch Card Statistics')
    .setTimestamp();

  for (const stat of stats) {
    const config = getCardConfig(stat.card_type);
    totalSpent += stat.total_spent;
    totalWon += stat.total_won;
    totalPurchased += stat.total_purchased;
    totalJackpots += stat.jackpots_won;

    embed.addFields({
      name: `${config.emoji} ${config.name}`,
      value: [
        `Cards: **${stat.total_purchased}**`,
        `Spent: **${stat.total_spent.toLocaleString()}** ${CURRENCY}`,
        `Won: **${stat.total_won.toLocaleString()}** ${CURRENCY}`,
        `Net: **${(stat.total_won - stat.total_spent).toLocaleString()}** ${CURRENCY}`,
        `Jackpots: **${stat.jackpots_won}** 💎`
      ].join('\n'),
      inline: true
    });
  }

  embed.setDescription([
    `**Total Cards:** ${totalPurchased}`,
    `**Total Spent:** ${totalSpent.toLocaleString()} ${CURRENCY}`,
    `**Total Won:** ${totalWon.toLocaleString()} ${CURRENCY}`,
    `**Net Profit:** ${(totalWon - totalSpent).toLocaleString()} ${CURRENCY}`,
    `**Jackpots:** ${totalJackpots} 💎`
  ].join('\n'));

  await interaction.reply({ embeds: [embed], flags: 64 });
}
