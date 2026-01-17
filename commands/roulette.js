const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, removeMoney, addMoney, removeFromTotal } = require('../economy');
const { 
  spinRoulette, 
  getNumberColor, 
  checkRouletteBet, 
  getRoulettePayout,
  getRouletteOdds,
  updateRouletteStats,
  recordRouletteSpin,
  getRouletteStats
} = require('../gambling');

const CURRENCY = '<:babybel:1418824333664452608>';
const BETTING_WINDOW = 30000; // 30 seconds to place bets

// Active roulette tables per channel
const activeTables = new Map();

// Valid bet choices for autocomplete
const BET_CHOICES = [
  { name: '🔴 Red (1:1)', value: 'red' },
  { name: '⚫ Black (1:1)', value: 'black' },
  { name: '🟢 Green/0 (35:1)', value: 'green' },
  { name: 'Even (1:1)', value: 'even' },
  { name: 'Odd (1:1)', value: 'odd' },
  { name: 'Low 1-18 (1:1)', value: 'low' },
  { name: 'High 19-36 (1:1)', value: 'high' },
  { name: '1st Dozen 1-12 (2:1)', value: '1st12' },
  { name: '2nd Dozen 13-24 (2:1)', value: '2nd12' },
  { name: '3rd Dozen 25-36 (2:1)', value: '3rd12' },
  { name: 'Column 1 (2:1)', value: 'col1' },
  { name: 'Column 2 (2:1)', value: 'col2' },
  { name: 'Column 3 (2:1)', value: 'col3' }
];

// ============ HELPER FUNCTIONS ============

function formatChoice(choice) {
  const formats = {
    'red': '🔴 Red',
    'black': '⚫ Black',
    'green': '🟢 Green',
    'even': 'Even',
    'odd': 'Odd',
    'low': 'Low (1-18)',
    'high': 'High (19-36)',
    '1st12': '1st Dozen',
    '2nd12': '2nd Dozen',
    '3rd12': '3rd Dozen',
    'col1': 'Column 1',
    'col2': 'Column 2',
    'col3': 'Column 3'
  };
  return formats[choice] || `#${choice}`;
}

function buildTableEmbed(table) {
  const timeLeft = Math.max(0, Math.ceil((BETTING_WINDOW - (Date.now() - table.createdAt)) / 1000));
  
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('🎰 Roulette Table - Place Your Bets!')
    .setDescription(`Wheel spins in **${timeLeft}s** or when someone clicks **Spin**!\nUse \`/roulette <bet> <choice>\` to add more bets.`)
    .setTimestamp();

  // Group bets by player
  const playerBets = new Map();
  for (const bet of table.bets) {
    const key = bet.userId;
    if (!playerBets.has(key)) {
      playerBets.set(key, { name: bet.displayName, bets: [] });
    }
    playerBets.get(key).bets.push(bet);
  }

  // Add field for each player
  for (const [odId, data] of playerBets) {
    const betLines = data.bets.map(b => 
      `${formatChoice(b.choice)} - **${b.amount.toLocaleString()}** ${CURRENCY}`
    ).join('\n');
    
    const totalBet = data.bets.reduce((sum, b) => sum + b.amount, 0);
    
    embed.addFields({
      name: `🎲 ${data.name} (${data.bets.length} bet${data.bets.length > 1 ? 's' : ''})`,
      value: `${betLines}\n*Total: ${totalBet.toLocaleString()}*`,
      inline: true
    });
  }

  // Add stats
  const stats = getRouletteStats();
  if (stats.total > 0 && stats.last10.length > 0) {
    const recentSpins = stats.last10.slice(0, 5).map(s => `${s.color}${s.number}`).join(' ');
    embed.addFields({
      name: '📊 Recent Spins',
      value: recentSpins,
      inline: false
    });
  }

  return embed;
}

function buildButtons() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('roulette_spin')
        .setLabel('🎡 Spin the Wheel!')
        .setStyle(ButtonStyle.Success)
    );
}

async function spinWheel(table) {
  console.log('spinWheel called, table.spinning:', table.spinning);
  if (table.spinning) return;
  table.spinning = true;

  console.log('Spinning wheel for channel:', table.channelId);
  console.log('Number of bets:', table.bets.length);

  // Update embed to show spinning
  const spinningEmbed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('🎡 The wheel is spinning...')
    .setDescription('No more bets!');

  try {
    await table.interaction.editReply({ embeds: [spinningEmbed], components: [] });
    console.log('Spinning embed sent');
  } catch (e) {
    // Message deleted, can't continue
    console.error('Failed to edit message for spinning:', e.message);
    activeTables.delete(table.channelId);
    return;
  }

  // Dramatic delay
  await new Promise(resolve => setTimeout(resolve, 2500));

  // Spin the wheel
  const number = spinRoulette();
  const color = getNumberColor(number);
  recordRouletteSpin(number);

  // Process all bets
  const results = [];
  let totalWon = 0;
  let totalLost = 0;

  for (const bet of table.bets) {
    const won = checkRouletteBet(bet.choice, number);
    
    if (won) {
      const winnings = bet.amount * bet.payout;
      await addMoney(table.guildId, bet.userId, winnings, 'Roulette win');
      updateRouletteStats(bet.userId, true, winnings - bet.amount);
      totalWon += winnings - bet.amount;
      
      results.push({
        ...bet,
        won: true,
        winnings: winnings - bet.amount
      });
    } else {
      updateRouletteStats(bet.userId, false, bet.amount);
      totalLost += bet.amount;
      
      results.push({
        ...bet,
        won: false,
        winnings: -bet.amount
      });
    }
  }

  // Build results embed
  const resultEmbed = new EmbedBuilder()
    .setColor(number === 0 ? 0x2ecc71 : (color === '🔴' ? 0xe74c3c : 0x2c2f33))
    .setTitle(`${color} The ball landed on **${number}**!`)
    .setTimestamp();

  // Group results by player
  const playerResults = new Map();
  for (const result of results) {
    if (!playerResults.has(result.userId)) {
      playerResults.set(result.userId, { name: result.displayName, results: [], netWinnings: 0 });
    }
    const pr = playerResults.get(result.userId);
    pr.results.push(result);
    pr.netWinnings += result.winnings;
  }

  // Calculate summary
  const winners = results.filter(r => r.won).length;
  const losers = results.filter(r => !r.won).length;
  
  resultEmbed.setDescription(
    `**${winners}** winning bet${winners !== 1 ? 's' : ''} • **${losers}** losing bet${losers !== 1 ? 's' : ''}\n` +
    `House ${totalWon > totalLost ? 'lost' : 'won'} **${Math.abs(totalWon - totalLost).toLocaleString()}** ${CURRENCY}`
  );

  // Add field for each player's results
  for (const [odId, data] of playerResults) {
    const resultLines = data.results.map(r => {
      const icon = r.won ? '✅' : '❌';
      const amount = r.won ? `+${r.winnings.toLocaleString()}` : `${r.winnings.toLocaleString()}`;
      return `${icon} ${formatChoice(r.choice)} → **${amount}** ${CURRENCY}`;
    }).join('\n');
    
    const netIcon = data.netWinnings >= 0 ? '🎉' : '💸';
    const netText = data.netWinnings >= 0 
      ? `+${data.netWinnings.toLocaleString()}` 
      : data.netWinnings.toLocaleString();
    
    resultEmbed.addFields({
      name: `${netIcon} ${data.name}`,
      value: `${resultLines}\n**Net: ${netText}** ${CURRENCY}`,
      inline: true
    });
  }

  // Add recent spins
  const stats = getRouletteStats();
  if (stats.last10.length > 0) {
    const recentSpins = stats.last10.slice(0, 10).map(s => `${s.color}${s.number}`).join(' ');
    resultEmbed.addFields({
      name: '📊 Recent Spins',
      value: recentSpins,
      inline: false
    });
  }

  try {
    await table.interaction.editReply({ embeds: [resultEmbed], components: [] });
    console.log('Result embed sent successfully');
  } catch (e) {
    // Message was deleted
    console.error('Failed to send result embed:', e.message);
  }

  // Clean up table
  activeTables.delete(table.channelId);
}

// ============ COMMAND ============

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Play roulette - multiple players can bet on the same spin!')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Amount to bet')
        .setRequired(true)
        .setMinValue(100))
    .addStringOption(option =>
      option.setName('choice')
        .setDescription('What to bet on')
        .setRequired(true)
        .addChoices(...BET_CHOICES)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    const bet = interaction.options.getInteger('bet');
    const choice = interaction.options.getString('choice').toLowerCase();

    // Validate bet type
    const payout = getRoulettePayout(choice);
    if (!payout) {
      return interaction.reply({
        content: '❌ Invalid bet type!',
        flags: 64
      });
    }

    // Check balance (can use cash + bank)
    const balanceData = await getBalance(guildId, userId);
    if (balanceData.total < bet) {
      return interaction.reply({
        content: `❌ You don't have enough! Your balance: **${balanceData.total.toLocaleString()}** ${CURRENCY}`,
        flags: 64
      });
    }

    // Get or create table for this channel
    let table = activeTables.get(channelId);
    let isNewTable = false;
    
    if (!table || table.spinning) {
      isNewTable = true;
      // Create new table
      table = {
        channelId,
        guildId,
        bets: [],
        players: new Map(),
        interaction: null,
        spinning: false,
        createdAt: Date.now(),
        timeout: null
      };
      activeTables.set(channelId, table);
    }

    // Try to defer/reply FIRST before taking money
    // This ensures Discord is available before we commit
    try {
      if (isNewTable || !table.interaction) {
        await interaction.deferReply();
      } else {
        await interaction.deferReply({ flags: 64 });
      }
    } catch (discordError) {
      // Discord is unavailable - abort WITHOUT taking money
      console.error('Discord unavailable for roulette, aborting:', discordError.message);
      if (isNewTable) {
        activeTables.delete(channelId);
      }
      return; // Don't take money, don't process bet
    }

    // NOW it's safe to deduct bet - Discord confirmed the interaction
    await removeFromTotal(guildId, userId, bet, 'Roulette bet');

    // Add bet to table
    table.bets.push({
      userId: userId,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
      choice,
      amount: bet,
      payout
    });

    // Track total bet per player
    const currentTotal = table.players.get(userId) || 0;
    table.players.set(userId, currentTotal + bet);

    // Build the table embed
    const embed = buildTableEmbed(table);
    const row = buildButtons();

    if (isNewTable || !table.interaction) {
      // First bet - create new message
      await interaction.editReply({ embeds: [embed], components: [row] });
      table.interaction = interaction;
      
      // Set auto-spin timeout
      table.timeout = setTimeout(async () => {
        console.log('Auto-spin timeout triggered for channel:', channelId);
        const currentTable = activeTables.get(channelId);
        console.log('Current table exists:', !!currentTable, 'Same table:', currentTable === table, 'Spinning:', currentTable?.spinning);
        try {
          if (currentTable === table && !table.spinning) {
            await spinWheel(table);
          }
        } catch (error) {
          console.error('Error in roulette auto-spin:', error);
        }
      }, BETTING_WINDOW);
    } else {
      // Update existing message
      try {
        await table.interaction.editReply({ embeds: [embed], components: [row] });
        await interaction.editReply({ 
          content: `✅ Bet placed: **${bet.toLocaleString()}** ${CURRENCY} on **${formatChoice(choice)}**`
        });
      } catch (e) {
        // Message might have been deleted, create new one
        await interaction.editReply({ embeds: [embed], components: [row] });
        table.interaction = interaction;
      }
    }
  },

  // Handle button interactions
  async handleRouletteButton(interaction) {
    console.log('handleRouletteButton called, customId:', interaction.customId);
    const channelId = interaction.channelId;
    const table = activeTables.get(channelId);

    console.log('Table exists:', !!table, 'Table spinning:', table?.spinning);

    if (!table || table.spinning) {
      return interaction.reply({ 
        content: '❌ No active roulette table or wheel is already spinning!', 
        flags: 64 
      });
    }

    if (interaction.customId === 'roulette_spin') {
      console.log('Spin button clicked, clearing timeout and spinning...');
      // Clear the auto-spin timeout
      if (table.timeout) {
        clearTimeout(table.timeout);
        table.timeout = null;
      }
      
      await interaction.deferUpdate();
      try {
        await spinWheel(table);
      } catch (error) {
        console.error('Error spinning roulette wheel:', error);
      }
    }
  }
};
