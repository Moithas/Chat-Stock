const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getLeaderboard, getAllUsers, getPortfolio, calculateStockPrice } = require('../database');
const { getAllBalances } = require('../economy');
const { getTopFighters } = require('../fight');
const { getDungeonLeaderboard } = require('../dungeon');
const { getCurrency } = require('../admin');


const ITEMS_PER_PAGE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View interactive leaderboard with multiple views'),

  async execute(interaction) {
    await interaction.deferReply();
    await showLeaderboardPanel(interaction, 'stocks', 0);
  }
};

async function showLeaderboardPanel(interaction, type = 'stocks', page = 0, isUpdate = false) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  let embed, totalPages;

  switch(type) {
    case 'stocks':
      const stockResult = await buildStockLeaderboard(guildId, page);
      embed = stockResult.embed;
      totalPages = stockResult.totalPages;
      break;
    case 'portfolio':
      const portfolioResult = await buildPortfolioLeaderboard(guildId, page);
      embed = portfolioResult.embed;
      totalPages = portfolioResult.totalPages;
      break;
    case 'cash':
      const cashResult = await buildCashLeaderboard(guildId, page, interaction.guild);
      embed = cashResult.embed;
      totalPages = cashResult.totalPages;
      break;
    case 'fight':
      const fightResult = await buildFightLeaderboard(guildId, page, interaction.guild);
      embed = fightResult.embed;
      totalPages = fightResult.totalPages;
      break;
    case 'dungeon':
      const dungeonResult = await buildDungeonLeaderboard(guildId, page, interaction.guild);
      embed = dungeonResult.embed;
      totalPages = dungeonResult.totalPages;
      break;
    default:
      const defaultResult = await buildStockLeaderboard(guildId, page);
      embed = defaultResult.embed;
      totalPages = defaultResult.totalPages;
  }

  // Add page info to footer
  if (totalPages > 1) {
    const currentFooter = embed.data.footer?.text || '';
    embed.setFooter({ text: `Page ${page + 1}/${totalPages}${currentFooter ? ' • ' + currentFooter : ''}` });
  }

  const typeButtons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_stocks_${page}_${userId}`)
        .setLabel('Stock Prices')
        .setEmoji('📈')
        .setStyle(type === 'stocks' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`leaderboard_portfolio_${page}_${userId}`)
        .setLabel('Portfolio')
        .setEmoji('💼')
        .setStyle(type === 'portfolio' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`leaderboard_cash_${page}_${userId}`)
        .setLabel('Balance')
        .setEmoji('💰')
        .setStyle(type === 'cash' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`leaderboard_fight_${page}_${userId}`)
        .setLabel('Fighters')
        .setEmoji('🥊')
        .setStyle(type === 'fight' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`leaderboard_dungeon_${page}_${userId}`)
        .setLabel('Dungeon')
        .setEmoji('🏰')
        .setStyle(type === 'dungeon' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

  const navButtons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_prev_${type}_${page}_${userId}`)
        .setLabel('Previous')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`leaderboard_next_${type}_${page}_${userId}`)
        .setLabel('Next')
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

  if (isUpdate) {
    await interaction.update({ embeds: [embed], components: [typeButtons, navButtons] });
  } else if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components: [typeButtons, navButtons] });
  } else {
    await interaction.reply({ embeds: [embed], components: [typeButtons, navButtons] });
  }
}

async function buildStockLeaderboard(guildId, page = 0) {
  const allStocks = getLeaderboard(1000, guildId);
  const totalPages = Math.max(1, Math.ceil(allStocks.length / ITEMS_PER_PAGE));
  const startIdx = page * ITEMS_PER_PAGE;
  const endIdx = startIdx + ITEMS_PER_PAGE;
  const pageStocks = allStocks.slice(startIdx, endIdx);

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('🏆 Stock Market Leaderboard')
    .setDescription('Stocks by current share price')
    .setTimestamp();

  if (allStocks.length === 0) {
    embed.setDescription('❌ No stocks available yet! Start chatting to create your stock!');
    return { embed, totalPages: 1 };
  }

  for (let i = 0; i < pageStocks.length; i++) {
    const stock = pageStocks[i];
    const rank = startIdx + i;
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `**${rank + 1}.**`;
    
    embed.addFields({
      name: `${medal} ${stock.username}`,
      value: 
        `💰 **Price:** ${stock.currentPrice} ${getCurrency(guildId)}/share\n` +
        `📊 **Shares Owned:** ${stock.totalShares || 0} shares\n`,
      inline: false
    });
  }

  return { embed, totalPages };
}

async function buildPortfolioLeaderboard(guildId, page = 0) {
  const allUsers = getAllUsers();
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('💼 Portfolio Leaderboard')
    .setDescription('Investors by total portfolio value')
    .setTimestamp();

  if (allUsers.length === 0) {
    embed.setDescription('❌ No users available yet! Start chatting and trading!');
    return { embed, totalPages: 1 };
  }

  const portfolioValues = [];

  for (const user of allUsers) {
    const portfolio = getPortfolio(user.user_id);
    
    let totalValue = 0;
    let totalInvested = 0;

    for (const stock of portfolio) {
      const currentPrice = calculateStockPrice(stock.stock_user_id, guildId);
      totalValue += currentPrice * stock.shares;
      totalInvested += stock.avg_buy_price * stock.shares;
    }

    const profit = totalValue - totalInvested;
    const profitPercent = totalInvested > 0 ? ((profit / totalInvested) * 100) : 0;

    if (totalInvested > 0) {
      portfolioValues.push({
        userId: user.user_id,
        username: user.username,
        totalValue: totalValue,
        totalInvested: totalInvested,
        profit: profit,
        profitPercent: profitPercent,
        holdingsCount: portfolio.length
      });
    }
  }

  if (portfolioValues.length === 0) {
    embed.setDescription('❌ No one has invested in any stocks yet! Use `/buy` to get started!');
    return { embed, totalPages: 1 };
  }

  portfolioValues.sort((a, b) => b.totalValue - a.totalValue);
  
  const totalPages = Math.max(1, Math.ceil(portfolioValues.length / ITEMS_PER_PAGE));
  const startIdx = page * ITEMS_PER_PAGE;
  const endIdx = startIdx + ITEMS_PER_PAGE;
  const pageInvestors = portfolioValues.slice(startIdx, endIdx);

  for (let i = 0; i < pageInvestors.length; i++) {
    const investor = pageInvestors[i];
    const rank = startIdx + i;
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `**${rank + 1}.**`;
    const profitEmoji = investor.profit >= 0 ? '📈' : '📉';
    const profitSign = investor.profit >= 0 ? '+' : '';
    
    embed.addFields({
      name: `${medal} ${investor.username}`,
      value: 
        `💰 **Portfolio Value:** ${Math.round(investor.totalValue)} ${getCurrency(guildId)}\n` +
        `${profitEmoji} **Profit/Loss:** ${profitSign}${Math.round(investor.profit)} ${getCurrency(guildId)} (${investor.profitPercent.toFixed(1)}%)\n` +
        `📊 **Holdings:** ${investor.holdingsCount} stocks`,
      inline: false
    });
  }

  return { embed, totalPages };
}

async function buildCashLeaderboard(guildId, page = 0, guild = null) {
  const allBalances = getAllBalances(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('💰 Balance Leaderboard')
    .setDescription('Users by total balance (cash + bank)')
    .setTimestamp();

  if (allBalances.length === 0) {
    embed.setDescription('❌ No balances found! Users need to earn money first!');
    return { embed, totalPages: 1 };
  }

  allBalances.sort((a, b) => b.total - a.total);
  
  const totalPages = Math.max(1, Math.ceil(allBalances.length / ITEMS_PER_PAGE));
  const startIdx = page * ITEMS_PER_PAGE;
  const endIdx = startIdx + ITEMS_PER_PAGE;
  const pageUsers = allBalances.slice(startIdx, endIdx);

  // Fetch actual Discord usernames for "Unknown User" entries
  if (guild) {
    for (const user of pageUsers) {
      if (user.username === 'Unknown User') {
        try {
          const member = await guild.members.fetch(user.userId);
          if (member) {
            user.username = member.user.username;
          }
        } catch (err) {
          // User not in server or error fetching, keep "Unknown User"
        }
      }
    }
  }

  for (let i = 0; i < pageUsers.length; i++) {
    const user = pageUsers[i];
    const rank = startIdx + i;
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `**${rank + 1}.**`;
    
    embed.addFields({
      name: `${medal} ${user.username}`,
      value: 
        `💵 **Cash:** ${user.cash.toLocaleString()} ${getCurrency(guildId)}\n` +
        `🏦 **Bank:** ${user.bank.toLocaleString()} ${getCurrency(guildId)}\n` +
        `💰 **Total:** ${user.total.toLocaleString()} ${getCurrency(guildId)}`,
      inline: false
    });
  }

  return { embed, totalPages };
}

async function buildFightLeaderboard(guildId, page = 0, guild = null) {
  const allFighters = getTopFighters(guildId, 100);

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('🥊 Fighter Leaderboard')
    .setDescription('Top fighters ranked by wins')
    .setTimestamp();

  if (allFighters.length === 0) {
    embed.setDescription('❌ No fight records yet! Use `/fight @user <bet>` to start fighting!');
    return { embed, totalPages: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(allFighters.length / ITEMS_PER_PAGE));
  const startIdx = page * ITEMS_PER_PAGE;
  const endIdx = startIdx + ITEMS_PER_PAGE;
  const pageFighters = allFighters.slice(startIdx, endIdx);

  // Fetch actual Discord usernames
  if (guild) {
    for (const fighter of pageFighters) {
      try {
        const member = await guild.members.fetch(fighter.user_id);
        if (member) {
          fighter.username = member.user.username;
        }
      } catch (err) {
        fighter.username = 'Unknown Fighter';
      }
    }
  }

  for (let i = 0; i < pageFighters.length; i++) {
    const fighter = pageFighters[i];
    const rank = startIdx + i;
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `**${rank + 1}.**`;
    
    const totalFights = fighter.wins + fighter.losses + fighter.draws;
    const winRate = totalFights > 0 ? ((fighter.wins / totalFights) * 100).toFixed(1) : '0.0';
    const record = `${fighter.wins}W - ${fighter.losses}L - ${fighter.draws}D`;
    const netEarnings = (fighter.total_earnings || 0) - (fighter.total_losses || 0);
    const earningsSign = netEarnings >= 0 ? '+' : '';
    
    embed.addFields({
      name: `${medal} ${fighter.username || 'Unknown Fighter'}`,
      value: 
        `📊 **Record:** ${record} (${winRate}% win rate)\n` +
        `💥 **KOs:** ${fighter.knockouts || 0} | **TKOs:** ${fighter.tkos || 0}\n` +
        `💰 **Net Earnings:** ${earningsSign}${Math.round(netEarnings).toLocaleString()} ${getCurrency(guildId)}`,
      inline: false
    });
  }

  return { embed, totalPages };
}

async function buildDungeonLeaderboard(guildId, page = 0, guild = null) {
  const allEntries = getDungeonLeaderboard(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🏰 Dungeon Leaderboard')
    .setDescription('Adventurers ranked by total clears')
    .setTimestamp();

  if (allEntries.length === 0) {
    embed.setDescription('❌ No dungeon runs recorded yet! Use `/dungeon` to start your adventure!');
    return { embed, totalPages: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(allEntries.length / ITEMS_PER_PAGE));
  const startIdx = page * ITEMS_PER_PAGE;
  const endIdx = startIdx + ITEMS_PER_PAGE;
  const pageEntries = allEntries.slice(startIdx, endIdx);

  // Fetch Discord usernames
  if (guild) {
    for (const entry of pageEntries) {
      try {
        const member = await guild.members.fetch(entry.user_id);
        if (member) entry.username = member.user.username;
      } catch {
        entry.username = 'Unknown User';
      }
    }
  }

  for (let i = 0; i < pageEntries.length; i++) {
    const entry = pageEntries[i];
    const rank = startIdx + i;
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `**${rank + 1}.**`;

    // Build per-tier breakdown lines (only show tiers with activity)
    const tierLines = [];
    if (entry.t1_runs > 0) {
      tierLines.push(`🏰 T1: ${entry.t1_runs} runs | ${entry.t1_clears} clears | ${entry.t1_escapes} escapes`);
    }
    if (entry.t2_runs > 0) {
      tierLines.push(`⚔️ T2: ${entry.t2_runs} runs | ${entry.t2_clears} clears | ${entry.t2_escapes} escapes`);
    }
    if (entry.t3_runs > 0) {
      tierLines.push(`💀 T3: ${entry.t3_runs} runs | ${entry.t3_clears} clears | ${entry.t3_escapes} escapes`);
    }

    const tierBreakdown = tierLines.length > 0 ? tierLines.join('\n') : 'No tier data';

    embed.addFields({
      name: `${medal} ${entry.username || 'Unknown User'}`,
      value:
        `📊 **${entry.total_runs} runs** — ✅ ${entry.total_clears} clears | 🏃 ${entry.total_escapes} escapes | 💀 ${entry.total_deaths} deaths\n` +
        `${tierBreakdown}\n` +
        `💰 **Total Earned:** ${Number(entry.total_gold).toLocaleString()} ${getCurrency(guildId)}`,
      inline: false
    });
  }

  return { embed, totalPages };
}

module.exports.handleButton = async function(interaction) {
  const parts = interaction.customId.split('_');
  
  // Check if the user clicking the button is the one who created it
  const authorizedUserId = parts[parts.length - 1];
  if (interaction.user.id !== authorizedUserId) {
    return interaction.reply({ 
      content: '❌ Only the user who opened this leaderboard can use these buttons. Use `/leaderboard` to create your own.', 
      ephemeral: true 
    });
  }
  
  if (parts[1] === 'prev' || parts[1] === 'next') {
    const action = parts[1];
    const type = parts[2];
    const currentPage = parseInt(parts[3]) || 0;
    const newPage = action === 'prev' ? Math.max(0, currentPage - 1) : currentPage + 1;
    
    await showLeaderboardPanel(interaction, type, newPage, true);
  } else {
    const type = parts[1];
    const currentPage = parseInt(parts[2]) || 0;
    
    await showLeaderboardPanel(interaction, type, currentPage, true);
  }
};