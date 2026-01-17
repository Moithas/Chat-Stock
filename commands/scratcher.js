const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBalance, removeFromTotal, addMoney } = require('../economy');
const { 
  purchaseScratchTicket,
  getActiveScratchTickets,
  getScratchTicket,
  scratchBoxes,
  revealAllBoxes,
  updateScratchStats,
  getScratchStats,
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scratcher')
    .setDescription('Scratch card panel - buy, view, and play scratch cards!'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Check if scratch cards are enabled
    const settings = getGamblingSettings(guildId);
    if (settings.scratch_enabled === false) {
      return interaction.reply({
        content: '❌ Scratch cards are currently disabled on this server.',
        flags: 64
      });
    }

    await showMainPanel(interaction, guildId, userId);
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Handle main panel buttons
    if (customId.startsWith('scratcher_')) {
      const action = customId.split('_')[1];

      switch (action) {
        case 'buy':
          return handleBuyCard(interaction, guildId, userId, customId.split('_')[2]);
        case 'info':
          return handleInfo(interaction, guildId);
        case 'stats':
          return handleStats(interaction, guildId, userId);
        case 'cards':
          return handleActiveCards(interaction, guildId, userId);
        case 'back':
          return showMainPanel(interaction, guildId, userId, true);
        case 'shop':
          // Open a new ephemeral shop panel (from public card message)
          return showMainPanel(interaction, guildId, userId, false);
        case 'play':
          return handlePlayCard(interaction, guildId, userId, parseInt(customId.split('_')[2]));
        case 'reveal':
          return handleRevealAll(interaction, guildId, userId, parseInt(customId.split('_')[2]));
        case 'scratch':
          const parts = customId.split('_');
          return handleScratchBox(interaction, guildId, userId, parseInt(parts[2]), parseInt(parts[3]));
      }
    }
  }
};

async function showMainPanel(interaction, guildId, userId, isUpdate = false) {
  const allSettings = getAllScratchCardSettings(guildId);
  const balanceData = await getBalance(guildId, userId);
  const activeTickets = getActiveScratchTickets(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎰 Scratch Card Shop')
    .setDescription(`Welcome to the scratch card shop! Buy a card and scratch to win!\n\n💰 **Your Balance:** ${balanceData.total.toLocaleString()} ${CURRENCY}\n🎟️ **Active Cards:** ${activeTickets.length}`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  // Add each card type as a field with compact info
  for (const cardType of getCardTypes()) {
    const config = getCardConfig(cardType);
    const settings = allSettings[cardType];
    const totalBoxes = config.grid.rows * config.grid.cols;
    const jackpotPrize = (settings.price * settings.jackpot).toLocaleString();

    embed.addFields({
      name: `${config.emoji} ${config.name}`,
      value: [
        `💵 **${settings.price.toLocaleString()}** ${CURRENCY}`,
        `📊 ${config.grid.rows}x${config.grid.cols} grid`,
        `💎 Jackpot: **${jackpotPrize}** ${CURRENCY}`
      ].join('\n'),
      inline: true
    });
  }

  // Create buy buttons for each card type
  const buyRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scratcher_buy_cheese')
      .setLabel('Buy Cheese')
      .setEmoji('🧀')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('scratcher_buy_cash')
      .setLabel('Buy Cash')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Primary)
  );

  const buyRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scratcher_buy_stocks')
      .setLabel('Buy Stocks')
      .setEmoji('📈')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('scratcher_buy_lucky7s')
      .setLabel('Buy Lucky 7s')
      .setEmoji('🎰')
      .setStyle(ButtonStyle.Primary)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scratcher_info')
      .setLabel('Full Info')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('scratcher_stats')
      .setLabel('My Stats')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('scratcher_cards')
      .setLabel(`Active Cards (${activeTickets.length})`)
      .setEmoji('🎟️')
      .setStyle(activeTickets.length > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(activeTickets.length === 0)
  );

  const options = {
    embeds: [embed],
    components: [buyRow1, buyRow2, actionRow],
    flags: 64
  };

  if (isUpdate) {
    await interaction.update(options);
  } else {
    await interaction.reply(options);
  }
}

async function handleBuyCard(interaction, guildId, userId, cardType) {
  const config = getCardConfig(cardType);
  if (!config) {
    return interaction.reply({
      content: '❌ Invalid card type!',
      flags: 64
    });
  }

  const cardSettings = getScratchCardSettings(guildId, cardType);
  const price = cardSettings.price;

  // Check for existing cards of this type
  const existingTickets = getActiveScratchTickets(guildId, userId);
  const existingSameType = existingTickets.filter(t => t.card_type === cardType);
  
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
    .setDescription(`${interaction.user} bought a scratch card!\n\nTicket #${ticket.id} - Good luck!`)
    .addFields(
      { name: '💰 Cost', value: `**${price.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '📊 Grid', value: `${config.grid.rows}x${config.grid.cols} (${config.grid.rows * config.grid.cols} boxes)`, inline: true }
    )
    .setImage(`attachment://scratch-${ticket.id}.png`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: 'Click "Play Card" to start scratching!' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`scratcher_play_${ticket.id}`)
      .setLabel('🎮 Play Card')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`scratcher_reveal_${ticket.id}`)
      .setLabel('⚡ Reveal All')
      .setStyle(ButtonStyle.Secondary)
  );

  // Update ephemeral panel to confirm purchase
  await interaction.update({
    content: `✅ Purchased **${config.name}** for **${price.toLocaleString()}** ${CURRENCY}! Your card is in the channel below.`,
    embeds: [],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('scratcher_back')
        .setLabel('Back to Shop')
        .setStyle(ButtonStyle.Primary)
    )],
    files: []
  });

  // Send public message with the card
  await interaction.channel.send({
    embeds: [embed],
    files: [attachment],
    components: [row]
  });
}

async function handleInfo(interaction, guildId) {
  const allSettings = getAllScratchCardSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎰 Scratch Cards - Full Info')
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
    prizesText += `\nFree Ticket (🎟️): Win another card!`;
    
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
      '• 🎟️ symbol gives you a FREE ticket!',
      '• You can have up to 3 of each card type active',
      '• Use "Reveal All" to instantly see your results'
    ].join('\n')
  });

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleStats(interaction, guildId, userId) {
  const stats = getScratchStats(guildId, userId);

  if (stats.length === 0) {
    return interaction.reply({
      content: '❌ You haven\'t played any scratch cards yet! Buy one from the shop to get started.',
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
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
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

async function handleActiveCards(interaction, guildId, userId) {
  const tickets = getActiveScratchTickets(guildId, userId);

  if (tickets.length === 0) {
    return interaction.reply({
      content: '❌ You don\'t have any active scratch cards. Buy one from the shop!',
      flags: 64
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎟️ Your Active Scratch Cards')
    .setDescription('Click a button to play a card!')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  // Group tickets by type
  const ticketsByType = {};
  for (const ticket of tickets) {
    if (!ticketsByType[ticket.card_type]) {
      ticketsByType[ticket.card_type] = [];
    }
    ticketsByType[ticket.card_type].push(ticket);
  }

  for (const [cardType, typeTickets] of Object.entries(ticketsByType)) {
    const config = getCardConfig(cardType);
    const ticketInfo = typeTickets.map(t => {
      const scratchedCount = t.scratched.filter(s => s).length;
      const totalBoxes = config.grid.rows * config.grid.cols;
      return `#${t.id} (${scratchedCount}/${totalBoxes})`;
    }).join(', ');

    embed.addFields({
      name: `${config.emoji} ${config.name}`,
      value: ticketInfo,
      inline: true
    });
  }

  // Create buttons for first 5 tickets (Discord limit)
  const rows = [];
  for (let i = 0; i < Math.min(tickets.length, 4); i++) {
    const ticket = tickets[i];
    const config = getCardConfig(ticket.card_type);
    
    if (i % 4 === 0) {
      rows.push(new ActionRowBuilder());
    }
    
    rows[rows.length - 1].addComponents(
      new ButtonBuilder()
        .setCustomId(`scratcher_play_${ticket.id}`)
        .setLabel(`#${ticket.id}`)
        .setEmoji(config.emoji)
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Add back button
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scratcher_back')
      .setLabel('Back to Shop')
      .setStyle(ButtonStyle.Secondary)
  );
  rows.push(backRow);

  if (tickets.length > 4) {
    embed.setFooter({ text: `Showing 4 of ${tickets.length} cards. Use /scratch cards to see all.` });
  }

  await interaction.update({
    embeds: [embed],
    components: rows,
    files: []
  });
}

async function handlePlayCard(interaction, guildId, userId, ticketId) {
  const ticket = getScratchTicket(ticketId);
  
  if (!ticket) {
    return interaction.reply({
      content: '❌ Ticket not found!',
      flags: 64
    });
  }

  if (ticket.user_id !== userId) {
    return interaction.reply({
      content: '❌ This is not your ticket!',
      flags: 64
    });
  }

  if (ticket.is_complete) {
    return interaction.reply({
      content: '❌ This card has already been completed!',
      flags: 64
    });
  }

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
        .setCustomId(`scratcher_scratch_${ticket.id}_${boxIndex}`)
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
  
  // Add control buttons (only if we have room - max 5 rows)
  if (rows.length < 5) {
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratcher_reveal_${ticket.id}`)
        .setLabel('⚡ Reveal All')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(controlRow);
  }

  // Generate current card image
  const imageBuffer = generateScratchCard(ticket.card_type, ticket.symbols, ticket.scratched, ticket.id);
  const attachment = new AttachmentBuilder(imageBuffer, { name: `scratch-${ticket.id}.png` });

  const scratchedCount = ticket.scratched.filter(s => s).length;
  const embed = new EmbedBuilder()
    .setColor(parseInt(config.colors.gradientStart.replace('#', ''), 16))
    .setTitle(`${config.emoji} ${config.name} - Ticket #${ticket.id}`)
    .setDescription(`${interaction.user} is scratching!\n\nClick the ❓ buttons to scratch each box!\n**Scratched:** ${scratchedCount}/${totalBoxes}`)
    .setImage(`attachment://scratch-${ticket.id}.png`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: 'Match 3 symbols to win!' })
    .setTimestamp();

  // Check if the original message is ephemeral (flags: 64)
  const isEphemeral = interaction.message?.flags?.has(64);
  
  if (isEphemeral) {
    // Playing from ephemeral panel - update panel and send new public message
    await interaction.update({
      content: `🎮 Playing Ticket #${ticket.id}! Check the channel below.`,
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('scratcher_back')
          .setLabel('Back to Shop')
          .setStyle(ButtonStyle.Primary)
      )],
      files: []
    });
    
    await interaction.channel.send({
      embeds: [embed],
      files: [attachment],
      components: rows
    });
  } else {
    // Playing from public message - update it directly
    await interaction.update({
      embeds: [embed],
      files: [attachment],
      components: rows
    });
  }
}

async function handleScratchBox(interaction, guildId, userId, ticketId, boxIndex) {
  const ticket = getScratchTicket(ticketId);
  
  if (!ticket) {
    return interaction.reply({
      content: '❌ Ticket not found!',
      flags: 64
    });
  }

  if (ticket.user_id !== userId) {
    return interaction.reply({
      content: '❌ This is not your ticket!',
      flags: 64
    });
  }

  if (ticket.is_complete) {
    return interaction.reply({
      content: '❌ This card has already been completed!',
      flags: 64
    });
  }

  if (ticket.scratched[boxIndex]) {
    return interaction.deferUpdate();
  }

  await interaction.deferUpdate();

  // Scratch the box
  const updatedTicket = scratchBoxes(ticketId, [boxIndex]);
  
  const config = getCardConfig(updatedTicket.card_type);
  const totalBoxes = config.grid.rows * config.grid.cols;
  const scratchedCount = updatedTicket.scratched.filter(s => s).length;

  // Check if all boxes are scratched
  if (scratchedCount === totalBoxes) {
    return finishCard(interaction, updatedTicket, guildId, userId, false);
  }

  // Create updated grid
  const rows = [];
  let idx = 0;
  
  for (let r = 0; r < config.grid.rows; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < config.grid.cols; c++) {
      const isScratched = updatedTicket.scratched[idx];
      const button = new ButtonBuilder()
        .setCustomId(`scratcher_scratch_${ticketId}_${idx}`)
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
  
  // Add control buttons
  if (rows.length < 5) {
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratcher_reveal_${ticketId}`)
        .setLabel('⚡ Reveal All')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(controlRow);
  }

  // Generate updated card image
  const imageBuffer = generateScratchCard(updatedTicket.card_type, updatedTicket.symbols, updatedTicket.scratched, ticketId);
  const attachment = new AttachmentBuilder(imageBuffer, { name: `scratch-${ticketId}.png` });

  const embed = new EmbedBuilder()
    .setColor(parseInt(config.colors.gradientStart.replace('#', ''), 16))
    .setTitle(`${config.emoji} ${config.name} - Ticket #${ticketId}`)
    .setDescription(`${interaction.user} is scratching!\n\n**Scratched:** ${scratchedCount}/${totalBoxes}`)
    .setImage(`attachment://scratch-${ticketId}.png`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: 'Match 3 symbols to win!' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
    components: rows
  });
}

async function handleRevealAll(interaction, guildId, userId, ticketId) {
  const ticket = getScratchTicket(ticketId);
  
  if (!ticket) {
    return interaction.reply({
      content: '❌ Ticket not found!',
      flags: 64
    });
  }

  if (ticket.user_id !== userId) {
    return interaction.reply({
      content: '❌ This is not your ticket!',
      flags: 64
    });
  }

  if (ticket.is_complete) {
    return interaction.reply({
      content: '❌ This card has already been completed!',
      flags: 64
    });
  }

  // Check if called from ephemeral message
  const isEphemeral = interaction.message?.flags?.has(64);
  
  // Defer the update for non-ephemeral (public) messages since finishCard uses editReply
  if (!isEphemeral) {
    await interaction.deferUpdate();
  }
  
  return finishCard(interaction, ticket, guildId, userId, isEphemeral);
}

async function finishCard(interaction, ticket, guildId, userId, isEphemeral = false) {
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
    resultDesc = `${interaction.user} hit the **${winType}**!\n\n💎 **Won: ${winnings.toLocaleString()}** ${CURRENCY}`;
  } else if (winType === 'MEGA WIN') {
    resultColor = 0xE91E63;
    resultTitle = `🎊 MEGA WIN! ${config.emoji} ${config.name}`;
    resultDesc = `${interaction.user} got a **MEGA WIN**!\n\n🏆 **Won: ${winnings.toLocaleString()}** ${CURRENCY}`;
  } else if (winType === 'WIN') {
    resultColor = 0x4CAF50;
    resultTitle = `✨ Winner! ${config.emoji} ${config.name}`;
    resultDesc = `${interaction.user} matched 3!\n\n💰 **Won: ${winnings.toLocaleString()}** ${CURRENCY}`;
  } else if (winType === 'FREE_TICKET') {
    resultColor = 0x9C27B0;
    resultTitle = `🎟️ Free Ticket! ${config.emoji} ${config.name}`;
    resultDesc = `${interaction.user} matched 3 symbols and won a **FREE ticket**!\n\n🎫 **New Ticket:** #${freeTicket.id}`;
  } else {
    resultColor = 0x9E9E9E;
    resultTitle = `${config.emoji} ${config.name} - No Win`;
    resultDesc = `${interaction.user} - Better luck next time!\n\n❌ **No matches**`;
  }

  const embed = new EmbedBuilder()
    .setColor(resultColor)
    .setTitle(resultTitle)
    .setDescription(resultDesc)
    .setImage(`attachment://scratch-${ticket.id}-revealed.png`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `Ticket #${ticket.id}` })
    .setTimestamp();

  // Show symbol counts
  const symbolCounts = {};
  for (const sym of ticket.symbols) {
    symbolCounts[sym] = (symbolCounts[sym] || 0) + 1;
  }
  const countsText = Object.entries(symbolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([sym, count]) => `${sym} x${count}`)
    .join('  ');
  
  embed.addFields({ name: '🎲 Symbols', value: countsText });

  // Add buttons - always include back to shop for public messages
  const components = [];
  
  if (winType === 'FREE_TICKET' && freeTicket) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratcher_play_${freeTicket.id}`)
        .setLabel('🎮 Play Free Ticket')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`scratcher_reveal_${freeTicket.id}`)
        .setLabel('⚡ Reveal All')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('scratcher_shop')
        .setLabel('🏪 Back to Shop')
        .setStyle(ButtonStyle.Primary)
    );
    components.push(row);
  } else {
    // No free ticket - just show back to shop
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('scratcher_shop')
        .setLabel('🏪 Back to Shop')
        .setStyle(ButtonStyle.Primary)
    );
    components.push(row);
  }

  if (isEphemeral) {
    // Called from ephemeral panel - update panel and send public result
    await interaction.update({
      content: `🎰 Revealed Ticket #${ticket.id}! Check the channel below.`,
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('scratcher_back')
          .setLabel('Back to Shop')
          .setStyle(ButtonStyle.Primary)
      )],
      files: []
    });
    
    await interaction.channel.send({
      embeds: [embed],
      files: [attachment],
      components
    });
  } else {
    // Called from public message - update it
    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components
    });
  }
}
