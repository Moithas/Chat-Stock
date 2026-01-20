const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, removeMoney, addMoney, removeFromTotal } = require('../economy');
const { 
  getLotteryInfo, 
  buyLotteryTicket, 
  getUserTickets, 
  getAllTickets,
  drawLottery,
  setJackpot,
  getRecentWinners,
  getGamblingSettings,
  getLotteryTicketPrice
} = require('../gambling');
const { hasAdminPermission, logAdminAction } = require('../admin');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lottery')
    .setDescription('Play the Pick 4 lottery!')
    .addSubcommand(sub =>
      sub.setName('buy')
        .setDescription('Buy a lottery ticket')
        .addIntegerOption(opt => opt.setName('num1').setDescription('First number (0-29)').setRequired(true).setMinValue(0).setMaxValue(29))
        .addIntegerOption(opt => opt.setName('num2').setDescription('Second number (0-29)').setRequired(true).setMinValue(0).setMaxValue(29))
        .addIntegerOption(opt => opt.setName('num3').setDescription('Third number (0-29)').setRequired(true).setMinValue(0).setMaxValue(29))
        .addIntegerOption(opt => opt.setName('num4').setDescription('Fourth number (0-29)').setRequired(true).setMinValue(0).setMaxValue(29)))
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('View current jackpot and lottery info'))
    .addSubcommand(sub =>
      sub.setName('tickets')
        .setDescription('View your current tickets'))
    .addSubcommand(sub =>
      sub.setName('draw')
        .setDescription('Draw the winning numbers (Admin only)'))
    .addSubcommand(sub =>
      sub.setName('setjackpot')
        .setDescription('Set the jackpot amount (Admin only)')
        .addIntegerOption(opt => opt.setName('amount').setDescription('New jackpot amount').setRequired(true).setMinValue(1000))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    switch (subcommand) {
      case 'buy':
        return handleBuy(interaction, guildId, userId);
      case 'info':
        return handleInfo(interaction, guildId);
      case 'tickets':
        return handleTickets(interaction, guildId, userId);
      case 'draw':
        return handleDraw(interaction, guildId, userId);
      case 'setjackpot':
        return handleSetJackpot(interaction, guildId, userId);
    }
  }
};

async function handleBuy(interaction, guildId, userId) {
  const num1 = interaction.options.getInteger('num1');
  const num2 = interaction.options.getInteger('num2');
  const num3 = interaction.options.getInteger('num3');
  const num4 = interaction.options.getInteger('num4');
  const numbers = [num1, num2, num3, num4];

  // Get ticket price for this guild
  const ticketPrice = getLotteryTicketPrice(guildId);

  // Check for duplicates
  if (new Set(numbers).size !== 4) {
    return interaction.reply({
      content: '❌ All 4 numbers must be different!',
      flags: 64
    });
  }

  // Check balance (can use cash + bank)
  const balanceData = await getBalance(guildId, userId);
  if (balanceData.total < ticketPrice) {
    return interaction.reply({
      content: `❌ You need **${ticketPrice.toLocaleString()}** ${CURRENCY} to buy a ticket! You have **${balanceData.total.toLocaleString()}** ${CURRENCY}`,
      flags: 64
    });
  }

  // Deduct money from total balance (cash first, then bank)
  await removeFromTotal(guildId, userId, ticketPrice, 'Lottery ticket purchase');

  // Buy ticket
  const result = buyLotteryTicket(guildId, userId, numbers);
  
  if (!result.success) {
    // Refund if failed
    await addMoney(guildId, userId, ticketPrice, 'Lottery ticket refund');
    return interaction.reply({
      content: `❌ ${result.error}`,
      flags: 64
    });
  }

  const lotteryInfo = getLotteryInfo(guildId);
  const settings = getGamblingSettings(guildId);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎟️ Lottery Ticket Purchased!')
    .setDescription(`Your numbers: **${result.numbers.join(' - ')}**`)
    .addFields(
      { name: '💰 Cost', value: `**${ticketPrice.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '🏆 Current Jackpot', value: `**${lotteryInfo.jackpot.toLocaleString()}** ${CURRENCY}`, inline: true }
    )
    .addFields({
      name: '📋 Prize Tiers',
      value: [
        `**2 matches:** ${settings.lottery_prize_2match.toLocaleString()} ${CURRENCY}`,
        `**3 matches:** ${settings.lottery_prize_3match.toLocaleString()} ${CURRENCY}`,
        `**4 matches:** JACKPOT!`
      ].join('\n')
    })
    .setFooter({ text: 'Good luck!' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleInfo(interaction, guildId) {
  const lotteryInfo = getLotteryInfo(guildId);
  const tickets = getAllTickets(guildId);
  const recentWinners = getRecentWinners(guildId, 5);
  const settings = getGamblingSettings(guildId);
  const ticketPrice = getLotteryTicketPrice(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎰 Pick 4 Lottery')
    .setDescription('Pick 4 numbers from 0-29. Match numbers in any order to win!')
    .addFields(
      { name: '🏆 Current Jackpot', value: `**${lotteryInfo.jackpot.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '🎟️ Tickets Sold', value: `**${tickets.length}**`, inline: true },
      { name: '💵 Ticket Price', value: `**${ticketPrice.toLocaleString()}** ${CURRENCY}`, inline: true }
    )
    .addFields({
      name: '📋 Prize Tiers',
      value: [
        `**2 matches:** ${settings.lottery_prize_2match.toLocaleString()} ${CURRENCY}`,
        `**3 matches:** ${settings.lottery_prize_3match.toLocaleString()} ${CURRENCY}`,
        `**4 matches:** JACKPOT (${lotteryInfo.jackpot.toLocaleString()} ${CURRENCY})`
      ].join('\n')
    });

  if (lotteryInfo.winningNumbers) {
    embed.addFields({
      name: '🎱 Last Winning Numbers',
      value: `**${lotteryInfo.winningNumbers.join(' - ')}**`,
      inline: false
    });
  }

  if (recentWinners.length > 0) {
    const winnerText = recentWinners.slice(0, 5).map(w => 
      `<@${w.user_id}>: ${w.matches} matches - **${w.prize.toLocaleString()}** ${CURRENCY}`
    ).join('\n');
    embed.addFields({
      name: '🏅 Recent Winners',
      value: winnerText
    });
  }

  embed.setFooter({ text: 'Use /lottery buy to purchase a ticket!' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleTickets(interaction, guildId, userId) {
  const tickets = getUserTickets(guildId, userId);
  const lotteryInfo = getLotteryInfo(guildId);

  if (tickets.length === 0) {
    return interaction.reply({
      content: '❌ You don\'t have any lottery tickets. Use `/lottery buy` to purchase one!',
      flags: 64
    });
  }

  // Paginate tickets if there are too many (each ticket line is ~30 chars, limit to ~100 per page)
  const TICKETS_PER_PAGE = 100;
  const totalPages = Math.ceil(tickets.length / TICKETS_PER_PAGE);
  
  // For now, just show first page with a note about total
  const displayTickets = tickets.slice(0, TICKETS_PER_PAGE);
  const ticketList = displayTickets.map((t, i) => 
    `**Ticket ${i + 1}:** ${t.numbers.join(' - ')}`
  ).join('\n');

  let description = ticketList;
  if (tickets.length > TICKETS_PER_PAGE) {
    description += `\n\n*...and ${tickets.length - TICKETS_PER_PAGE} more tickets*`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎟️ Your Lottery Tickets')
    .setDescription(description)
    .addFields(
      { name: '🏆 Current Jackpot', value: `**${lotteryInfo.jackpot.toLocaleString()}** ${CURRENCY}`, inline: true },
      { name: '🎫 Total Tickets', value: `**${tickets.length}**`, inline: true }
    )
    .setFooter({ text: 'Good luck on the next draw!' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleDraw(interaction, guildId, userId) {
  // Admin check
  if (!hasAdminPermission(interaction.member, guildId)) {
    return interaction.reply({
      content: '❌ Only admins can draw the lottery!',
      flags: 64
    });
  }

  const tickets = getAllTickets(guildId);
  
  if (tickets.length === 0) {
    return interaction.reply({
      content: '❌ No tickets have been sold yet!',
      flags: 64
    });
  }

  await interaction.deferReply();

  const result = drawLottery(guildId);
  
  // Pay out winners
  const winners = result.results.filter(r => r.prize > 0);
  for (const winner of winners) {
    await addMoney(guildId, winner.userId, winner.prize, `Lottery win (${winner.matches} matches)`);
  }

  // Build results embed
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎰 LOTTERY DRAW RESULTS!')
    .setDescription(`🎱 **Winning Numbers: ${result.winningNumbers.join(' - ')}**`)
    .addFields(
      { name: '🎟️ Total Tickets', value: `**${result.totalTickets}**`, inline: true },
      { name: '💸 Total Prizes', value: `**${result.totalPrizesPaid.toLocaleString()}** ${CURRENCY}`, inline: true }
    );

  if (result.jackpotWon) {
    embed.addFields({
      name: '🎊 JACKPOT WINNER!',
      value: `Someone won the **${result.jackpotAmount.toLocaleString()}** ${CURRENCY} jackpot!`
    });
  }

  if (winners.length > 0) {
    // Group winners by matches
    const by4 = winners.filter(w => w.matches === 4);
    const by3 = winners.filter(w => w.matches === 3);
    const by2 = winners.filter(w => w.matches === 2);

    let winnerText = '';
    
    if (by4.length > 0) {
      winnerText += `**🏆 4 Matches (JACKPOT):**\n${by4.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${CURRENCY}`).join('\n')}\n\n`;
    }
    if (by3.length > 0) {
      winnerText += `**🥈 3 Matches:**\n${by3.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${CURRENCY}`).join('\n')}\n\n`;
    }
    if (by2.length > 0) {
      winnerText += `**🥉 2 Matches:**\n${by2.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${CURRENCY}`).join('\n')}`;
    }

    embed.addFields({ name: '🏅 Winners', value: winnerText || 'None' });
  } else {
    embed.addFields({ name: '😢 No Winners', value: 'No one matched 2 or more numbers this draw.' });
  }

  // Show new jackpot
  const newInfo = getLotteryInfo(guildId);
  embed.addFields({
    name: '💰 New Jackpot',
    value: `**${newInfo.jackpot.toLocaleString()}** ${CURRENCY}`
  });

  embed.setFooter({ text: 'Thanks for playing!' })
    .setTimestamp();

  logAdminAction(guildId, userId, interaction.user.username, 'Drew lottery', `${result.totalTickets} tickets, ${winners.length} winners`);

  await interaction.editReply({ embeds: [embed] });
}

async function handleSetJackpot(interaction, guildId, userId) {
  // Admin check
  if (!hasAdminPermission(interaction.member, guildId)) {
    return interaction.reply({
      content: '❌ Only admins can set the jackpot!',
      flags: 64
    });
  }

  const amount = interaction.options.getInteger('amount');
  setJackpot(guildId, amount);

  logAdminAction(guildId, userId, interaction.user.username, 'Set lottery jackpot', `${amount.toLocaleString()} ${CURRENCY}`);

  await interaction.reply({
    content: `✅ Lottery jackpot set to **${amount.toLocaleString()}** ${CURRENCY}`,
    flags: 64
  });
}
