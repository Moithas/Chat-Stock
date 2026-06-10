const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, removeMoney, addMoney, removeFromTotal } = require('../economy');
const { 
  spinRoulette, 
  getNumberColor, 
  formatRouletteNumber,
  checkRouletteBet, 
  getRoulettePayout,
  getRouletteOdds,
  updateRouletteStats,
  recordRouletteSpin,
  getRouletteStats,
  ROULETTE_DOUBLE_ZERO
} = require('../gambling');
const { getCurrency } = require('../admin');
const { applyGamblingBonus, getPetBonusDecimal } = require('../pets');


const BETTING_WINDOW = 30000; // 30 seconds to place bets

// Active roulette tables per channel
const activeTables = new Map();

// Outside bets (named choices). Number bets are accepted separately via autocomplete.
const OUTSIDE_BETS = [
  { name: '🔴 Red (1:1)',          value: 'red' },
  { name: '⚫ Black (1:1)',         value: 'black' },
  { name: '🟢 Green / 0 or 00 (17:1)', value: 'green' },
  { name: 'Even (1:1)',            value: 'even' },
  { name: 'Odd (1:1)',             value: 'odd' },
  { name: 'Low 1-18 (1:1)',        value: 'low' },
  { name: 'High 19-36 (1:1)',      value: 'high' },
  { name: '1st Dozen 1-12 (2:1)',  value: '1st12' },
  { name: '2nd Dozen 13-24 (2:1)', value: '2nd12' },
  { name: '3rd Dozen 25-36 (2:1)', value: '3rd12' },
  { name: 'Column 1 (2:1)',        value: 'col1' },
  { name: 'Column 2 (2:1)',        value: 'col2' },
  { name: 'Column 3 (2:1)',        value: 'col3' }
];

// Full set of straight-number bet values: '0', '00', '1'..'36'
const NUMBER_BET_VALUES = ['0', '00', ...Array.from({ length: 36 }, (_, i) => String(i + 1))];
const VALID_BET_VALUES = new Set([
  ...OUTSIDE_BETS.map(b => b.value),
  ...NUMBER_BET_VALUES
]);

// Map of various aliases → canonical bet value, for forgiving input parsing.
// Keyed by lowercased alias. Built once on module load.
const BET_ALIASES = (() => {
  const m = new Map();
  // Direct values
  for (const v of OUTSIDE_BETS.map(b => b.value)) m.set(v, v);
  // Display-name aliases (lowercased, no emoji)
  m.set('red',         'red');
  m.set('black',       'black');
  m.set('green',       'green');
  m.set('0/00',        'green');
  m.set('zero',        '0');
  m.set('double zero', '00');
  m.set('double-zero', '00');
  m.set('even',        'even');
  m.set('odd',         'odd');
  m.set('low',         'low');
  m.set('high',        'high');
  m.set('1-18',        'low');
  m.set('19-36',       'high');
  m.set('1st dozen',   '1st12');
  m.set('2nd dozen',   '2nd12');
  m.set('3rd dozen',   '3rd12');
  m.set('1-12',        '1st12');
  m.set('13-24',       '2nd12');
  m.set('25-36',       '3rd12');
  m.set('column 1',    'col1');
  m.set('column 2',    'col2');
  m.set('column 3',    'col3');
  m.set('col1',        'col1');
  m.set('col2',        'col2');
  m.set('col3',        'col3');
  return m;
})();

// Resolve any user-typed/autocomplete-rendered string into a canonical bet value.
// Returns null if nothing matches.
function resolveBetChoice(raw) {
  if (raw == null) return null;
  // Strip emoji/punctuation/extra whitespace; keep digits, letters, slashes, dashes
  const cleaned = raw
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9/\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;

  // 1) Already a valid value (handles "black", "1st12", "00", "17", "07")
  if (cleaned === '00') return '00';
  if (/^\d+$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    if (n >= 0 && n <= 36) return String(n);
  }
  if (VALID_BET_VALUES.has(cleaned)) return cleaned;

  // 2) Full alias map (e.g. "1st dozen", "1-12")
  if (BET_ALIASES.has(cleaned)) return BET_ALIASES.get(cleaned);

  // 3) "#17", "# 5"
  const hashMatch = cleaned.match(/#\s*(\d{1,2}|00)\b/);
  if (hashMatch) {
    const v = hashMatch[1];
    if (v === '00') return '00';
    const n = parseInt(v, 10);
    if (n >= 0 && n <= 36) return String(n);
  }

  // 4) Display-name substring contains an alias keyword
  //    e.g. "black 1 1" (from "⚫ Black (1:1)") → 'black'
  //    e.g. "1st dozen 1 12 2 1" → '1st12'
  for (const [alias, value] of BET_ALIASES.entries()) {
    if (alias.length < 3) continue; // skip super-short keys that match too much
    const pattern = new RegExp(`(^|\\b)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`);
    if (pattern.test(cleaned)) return value;
  }

  // 5) Bare number embedded somewhere (e.g. "🟢 #00 — 0/00 (35:1)" → '00')
  if (/(^|\s)00(\s|$)/.test(cleaned)) return '00';
  const numMatch = cleaned.match(/(^|\s)(\d{1,2})(\s|$)/);
  if (numMatch) {
    const n = parseInt(numMatch[2], 10);
    if (n >= 0 && n <= 36) return String(n);
  }

  return null;
}

// ============ HELPER FUNCTIONS ============

function formatChoice(choice) {
  const formats = {
    'red': '🔴 Red',
    'black': '⚫ Black',
    'green': '🟢 Green (0/00)',
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
  if (formats[choice]) return formats[choice];
  // Number bet — render with green/red/black color emoji
  if (choice === '00') return `🟢 #00`;
  const n = Number(choice);
  if (Number.isFinite(n) && n >= 0 && n <= 36) return `${getNumberColor(n)} #${n}`;
  return `#${choice}`;
}

// Convert a stored spin's `number` (may be 0-36 or 37=='00') to its display label.
function spinLabel(spin) {
  return formatRouletteNumber(spin.number);
}

// Build the full stats footer fields shared between the live table and result embeds.
// Includes Recent Spins / Color % / Hot 5 / Cold 5.
function buildStatsFields(includeRecent = true) {
  const stats = getRouletteStats();
  const fields = [];

  if (includeRecent && stats.last10.length > 0) {
    const recent = stats.last10.map(s => `${s.color}${spinLabel(s)}`).join(' ');
    fields.push({ name: '📊 Recent Spins', value: recent, inline: false });
  }

  if (stats.total > 0) {
    const p = stats.percentages;
    fields.push({
      name: `🎨 Color Distribution (last ${stats.total} spin${stats.total !== 1 ? 's' : ''})`,
      value: `🔴 Red **${p.red}%** • ⚫ Black **${p.black}%** • 🟢 Green **${p.green}%**`,
      inline: false
    });

    if (stats.hotNumbers.length > 0) {
      const hot = stats.hotNumbers
        .map(h => `${h.color}${h.label} ×${h.count}`)
        .join(' • ');
      fields.push({ name: '🔥 Hottest (top 5)', value: hot, inline: true });
    }

    if (stats.coldNumbers.length > 0) {
      const cold = stats.coldNumbers
        .map(c => `${c.color}${c.label} ×${c.count}`)
        .join(' • ');
      fields.push({ name: '🧊 Coldest (bottom 5)', value: cold, inline: true });
    }
  }

  return fields;
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
      `${formatChoice(b.choice)} - **${b.amount.toLocaleString()}** ${getCurrency(table.guildId)}`
    ).join('\n');
    
    const totalBet = data.bets.reduce((sum, b) => sum + b.amount, 0);
    
    embed.addFields({
      name: `🎲 ${data.name} (${data.bets.length} bet${data.bets.length > 1 ? 's' : ''})`,
      value: `${betLines}\n*Total: ${totalBet.toLocaleString()}*`,
      inline: true
    });
  }

  // Add stats footer (recent spins + color % + hot/cold)
  for (const f of buildStatsFields(true)) {
    embed.addFields(f);
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

  // Detect hedged bets (opposing outcomes) - players with hedges don't get gambling bonus
  const OPPOSING_BETS = [
    ['red', 'black'],
    ['odd', 'even'],
    ['low', 'high']
  ];
  
  // Full coverage bets (all three = covers all 36 numbers)
  const FULL_COVERAGE = [
    ['col1', 'col2', 'col3'],
    ['1st12', '2nd12', '3rd12']
  ];
  
  const hedgedPlayers = new Set();
  const playerChoices = new Map();
  
  for (const bet of table.bets) {
    if (!playerChoices.has(bet.userId)) {
      playerChoices.set(bet.userId, new Set());
    }
    playerChoices.get(bet.userId).add(bet.choice);
  }
  
  for (const [odId, choices] of playerChoices) {
    // Check opposing 1:1 bets
    for (const [a, b] of OPPOSING_BETS) {
      if (choices.has(a) && choices.has(b)) {
        hedgedPlayers.add(odId);
        break;
      }
    }
    // Check full coverage (all three columns or all three dozens)
    for (const trio of FULL_COVERAGE) {
      if (trio.every(c => choices.has(c))) {
        hedgedPlayers.add(odId);
        break;
      }
    }
  }

  // Process all bets
  const results = [];
  let totalWon = 0;
  let totalLost = 0;

  for (const bet of table.bets) {
    const won = checkRouletteBet(bet.choice, number);
    const isHedged = hedgedPlayers.has(bet.userId);
    
    if (won) {
      const profit = bet.amount * (bet.payout - 1); // Profit only (payout includes original bet)
      // No gambling bonus if player hedged their bets
      const boostedProfit = isHedged ? profit : applyGamblingBonus(table.guildId, bet.userId, profit);
      const totalPayout = bet.amount + boostedProfit; // Return bet + boosted profit
      await addMoney(table.guildId, bet.userId, totalPayout, 'Roulette win');
      updateRouletteStats(bet.userId, true, boostedProfit);
      totalWon += boostedProfit;
      
      results.push({
        ...bet,
        won: true,
        winnings: boostedProfit,
        hedged: isHedged
      });
    } else {
      updateRouletteStats(bet.userId, false, bet.amount);
      totalLost += bet.amount;
      
      results.push({
        ...bet,
        won: false,
        winnings: -bet.amount,
        hedged: isHedged
      });
    }
  }

  // Build results embed
  const numLabel = formatRouletteNumber(number);
  const isZero = number === 0 || number === ROULETTE_DOUBLE_ZERO;
  const resultEmbed = new EmbedBuilder()
    .setColor(isZero ? 0x2ecc71 : (color === '🔴' ? 0xe74c3c : 0x2c2f33))
    .setTitle(`${color} The ball landed on **${numLabel}**!`)
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
    `House ${totalWon > totalLost ? 'lost' : 'won'} **${Math.abs(totalWon - totalLost).toLocaleString()}** ${getCurrency(table.guildId)}`
  );

  // Add field for each player's results
  for (const [odId, data] of playerResults) {
    const isHedged = data.results.some(r => r.hedged);
    const resultLines = data.results.map(r => {
      const icon = r.won ? '✅' : '❌';
      const amount = r.won ? `+${r.winnings.toLocaleString()}` : `${r.winnings.toLocaleString()}`;
      return `${icon} ${formatChoice(r.choice)} → **${amount}** ${getCurrency(table.guildId)}`;
    }).join('\n');
    
    const netIcon = data.netWinnings >= 0 ? '🎉' : '💸';
    const netText = data.netWinnings >= 0 
      ? `+${data.netWinnings.toLocaleString()}` 
      : data.netWinnings.toLocaleString();
    
    // Pet gambling bonus tag for winners (but not if hedged)
    let playerPetTag = '';
    if (isHedged) {
      playerPetTag = ' ⚖️ *hedged*';
    } else if (data.netWinnings > 0) {
      try {
        const bonus = getPetBonusDecimal(table.guildId, odId, 'gambling') * 100;
        if (bonus > 0) playerPetTag = ` (🐾 +${bonus.toFixed(1)}%)`;
      } catch (e) {}
    }
    
    resultEmbed.addFields({
      name: `${netIcon} ${data.name}`,
      value: `${resultLines}\n**Net: ${netText}${playerPetTag}** ${getCurrency(table.guildId)}`,
      inline: true
    });
  }

  // Add stats footer (recent spins + color % + hot/cold)
  for (const f of buildStatsFields(true)) {
    resultEmbed.addFields(f);
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
    .setDescription('Play American roulette (0, 00, 1–36) — multiple players can bet on the same spin!')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Amount to bet')
        .setRequired(true)
        .setMinValue(100))
    .addStringOption(option =>
      option.setName('choice')
        .setDescription('Outside bet name (red, black, even…) or a number 0, 00, 1–36')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    try {
      const focused = (interaction.options.getFocused() || '').toString().trim().toLowerCase();
      const results = [];

      // 1) Outside bets matched by name or value
      for (const b of OUTSIDE_BETS) {
        if (!focused || b.value.includes(focused) || b.name.toLowerCase().includes(focused)) {
          results.push(b);
        }
      }

      // 2) Number bets — match by digit prefix/contains
      for (const v of NUMBER_BET_VALUES) {
        if (!focused || v === focused || v.startsWith(focused) || v.includes(focused)) {
          let label;
          if (v === '00') label = '🟢 #00 — 0/00 (35:1)';
          else {
            const n = Number(v);
            label = `${getNumberColor(n)} #${n} (35:1)`;
          }
          results.push({ name: label, value: v });
        }
      }

      // Discord limit: 25 max
      await interaction.respond(results.slice(0, 25));
    } catch (e) {
      try { await interaction.respond([]); } catch (_) { /* ignore */ }
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    const bet = interaction.options.getInteger('bet');
    const rawChoice = (interaction.options.getString('choice') || '').toString().trim();
    // Robustly resolve any of: a canonical value, a display name (with emoji),
    // an alias, "#17", "07", "1st dozen", etc.
    const choice = resolveBetChoice(rawChoice);

    if (!choice || !VALID_BET_VALUES.has(choice)) {
      return interaction.reply({
        content: `❌ Couldn't interpret \`${rawChoice}\` as a roulette bet. Pick an outside bet (red, black, even, low, 1st12…) or a number from \`0\`, \`00\`, or \`1\`–\`36\`.`,
        flags: 64
      });
    }

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
        content: `❌ You don't have enough! Your balance: **${balanceData.total.toLocaleString()}** ${getCurrency(guildId)}`,
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
          content: `✅ Bet placed: **${bet.toLocaleString()}** ${getCurrency(guildId)} on **${formatChoice(choice)}**`
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
