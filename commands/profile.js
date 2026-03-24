// /profile command - Player profile viewer with category tabs
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } = require('discord.js');
const { getUser, getPortfolio, calculateStockPrice, getAllStockHolders, getStockRank, getPortfolioRank, calculateStreakInfo, getDb } = require('../database');
const { getBalance } = require('../economy');
const { getUserProperties, getTotalPropertyValue } = require('../property');
const { getUserCreditScore, getCreditTier, getUserLoanHistory, getUserActiveBonds, getBondHistory, createCreditBar, CREDIT_TIERS, MAX_CREDIT_SCORE } = require('../bank');
const { getUserSkills, getLevel, createProgressBar } = require('../skills');
const { getTotalDividendsReceived, getLastSplitTime } = require('../dividends');
const { getUserInventory } = require('../items');
const { getCurrency } = require('../admin');



// Button IDs
const BUTTON_IDS = ['profile_finance', 'profile_stock', 'profile_crime', 'profile_gambling', 'profile_fight', 'profile_dungeon', 'profile_overview', 'profile_dismiss'];

// ==================== DATA FETCHERS ====================

function getOverviewData(guildId, userId, user) {
  const db = getDb();
  const balance = getBalance(guildId, userId);
  
  // Portfolio value
  const portfolio = getPortfolio(userId);
  let portfolioValue = 0;
  for (const stock of portfolio) {
    portfolioValue += calculateStockPrice(stock.stock_user_id, guildId) * stock.shares;
  }
  
  // Properties value
  const propValue = getTotalPropertyValue(guildId, userId) || 0;
  
  // Total wealth = cash + bank + portfolio + properties
  const totalWealth = balance.cash + balance.bank + portfolioValue + propValue;
  
  // Net worth rank
  let netWorthRank = null;
  try {
    // Batch-fetch all balances and stock holdings for ranking
    const allBalances = db.exec('SELECT user_id, cash, bank FROM balances WHERE guild_id = ?', [guildId]);
    if (allBalances.length > 0 && allBalances[0].values.length > 0) {
      const balanceMap = new Map();
      for (const row of allBalances[0].values) {
        balanceMap.set(row[0], { cash: row[1] || 0, bank: row[2] || 0 });
      }

      // Batch-fetch all stock holdings in one query
      const allStocks = db.exec('SELECT owner_id, stock_user_id, shares FROM stocks WHERE shares > 0');
      const ownerHoldings = new Map();
      if (allStocks.length > 0) {
        for (const row of allStocks[0].values) {
          if (!ownerHoldings.has(row[0])) ownerHoldings.set(row[0], []);
          ownerHoldings.get(row[0]).push({ stock_user_id: row[1], shares: row[2] });
        }
      }

      const wealthList = [];
      for (const [uid, bal] of balanceMap) {
        let pv = 0;
        const holdings = ownerHoldings.get(uid) || [];
        for (const s of holdings) {
          pv += calculateStockPrice(s.stock_user_id, guildId) * s.shares;
        }
        const pVal = getTotalPropertyValue(guildId, uid) || 0;
        wealthList.push({ userId: uid, wealth: bal.cash + bal.bank + pv + pVal });
      }
      wealthList.sort((a, b) => b.wealth - a.wealth);
      const rank = wealthList.findIndex(u => u.userId === userId) + 1;
      if (rank > 0) netWorthRank = { rank, total: wealthList.length };
    }
  } catch (e) {}
  
  // Messages
  const totalMessages = user ? user.total_messages || 0 : 0;
  
  // Items owned
  let itemCount = 0;
  try {
    const inventory = getUserInventory(guildId, userId);
    itemCount = inventory.reduce((sum, item) => sum + (item.quantity || 0), 0);
  } catch (e) {}
  
  // Account creation (first transaction or message)
  let accountAge = 'Unknown';
  try {
    const firstTx = db.exec(
      'SELECT MIN(timestamp) as first_time FROM transactions WHERE buyer_id = ? AND timestamp > 0',
      [userId]
    );
    if (firstTx.length > 0 && firstTx[0].values[0][0]) {
      const firstTime = firstTx[0].values[0][0];
      const days = Math.floor((Date.now() - firstTime) / (24 * 60 * 60 * 1000));
      accountAge = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days.toLocaleString()} days`;
    }
  } catch (e) {}
  
  return { totalWealth, netWorthRank, totalMessages, itemCount, accountAge, balance, portfolioValue, propValue };
}

function getFinanceData(guildId, userId) {
  const db = getDb();
  const balance = getBalance(guildId, userId);
  
  // Portfolio value
  const portfolio = getPortfolio(userId);
  let portfolioValue = 0;
  for (const stock of portfolio) {
    portfolioValue += calculateStockPrice(stock.stock_user_id, guildId) * stock.shares;
  }
  
  // Properties
  const properties = getUserProperties(guildId, userId);
  const propValue = getTotalPropertyValue(guildId, userId) || 0;
  const propNames = properties.map(p => `${p.name}`).join(', ') || 'None';
  
  // Total wealth
  const totalWealth = balance.cash + balance.bank + portfolioValue + propValue;
  
  // Credit score
  let creditScore = 500;
  let creditTier = null;
  try {
    const cs = getUserCreditScore(guildId, userId);
    creditScore = cs ? cs.score : 500;
    creditTier = getCreditTier(creditScore);
  } catch (e) {}
  
  // Chat streak
  const streak = calculateStreakInfo(userId);
  const streakTier = streak.tier === 3 ? '🥇 Gold' : streak.tier === 2 ? '🥈 Silver' : streak.tier === 1 ? '🥉 Bronze' : 'None';
  
  // Wealth tax paid (lifetime)
  let totalTaxPaid = 0;
  try {
    const taxResult = db.exec(
      'SELECT SUM(tax_amount) as total FROM wealth_tax_history WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    if (taxResult.length > 0 && taxResult[0].values[0][0]) {
      totalTaxPaid = taxResult[0].values[0][0];
    }
  } catch (e) {}
  
  // Total loans (historical count)
  let totalLoans = 0;
  try {
    const loanResult = db.exec(
      'SELECT COUNT(*) as total FROM loans WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    if (loanResult.length > 0 && loanResult[0].values[0][0]) {
      totalLoans = loanResult[0].values[0][0];
    }
  } catch (e) {}
  
  // Active bonds
  let activeBondCount = 0;
  try {
    const bonds = getUserActiveBonds(guildId, userId);
    activeBondCount = bonds ? bonds.length : 0;
  } catch (e) {}
  
  // Total spent on bonds & total collected from bonds
  let totalBondSpent = 0;
  let totalBondCollected = 0;
  try {
    const spentResult = db.exec(
      'SELECT SUM(purchase_price) as total FROM active_bonds WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    if (spentResult.length > 0 && spentResult[0].values[0][0]) {
      totalBondSpent = spentResult[0].values[0][0];
    }
    // Also count expired bonds from bond_history
    const histSpent = db.exec(
      'SELECT SUM(price) as total FROM bond_history WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    if (histSpent.length > 0 && histSpent[0].values[0][0]) {
      totalBondSpent = histSpent[0].values[0][0]; // History includes all purchases
    }
  } catch (e) {}
  
  try {
    // Bond income collected (matured bonds get their value back + premium typically)
    // Since bonds pay role access, "collected" = bonds that completed
    const collectedResult = db.exec(
      'SELECT COUNT(*) as count, SUM(price) as total FROM bond_history WHERE guild_id = ? AND user_id = ? AND expired_at IS NOT NULL',
      [guildId, userId]
    );
    if (collectedResult.length > 0 && collectedResult[0].values[0][1]) {
      totalBondCollected = collectedResult[0].values[0][1];
    }
  } catch (e) {}
  
  return {
    balance, portfolioValue, propValue, propNames, totalWealth,
    creditScore, creditTier, streak, streakTier,
    totalTaxPaid, totalLoans, activeBondCount, totalBondSpent, totalBondCollected,
    properties
  };
}

function getStockData(guildId, userId) {
  const db = getDb();
  
  // Portfolio
  const portfolio = getPortfolio(userId);
  let portfolioValue = 0;
  for (const stock of portfolio) {
    portfolioValue += calculateStockPrice(stock.stock_user_id, guildId) * stock.shares;
  }
  
  // Shareholders
  const shareholders = getAllStockHolders(userId);
  
  // Stock price
  const currentPrice = calculateStockPrice(userId, guildId);
  
  // Stock rank
  const stockRank = getStockRank(userId, guildId);
  
  // Last split date
  let lastSplit = 'Never';
  try {
    const splitTime = getLastSplitTime(guildId, userId);
    if (splitTime > 0) {
      lastSplit = `<t:${Math.floor(splitTime / 1000)}:R>`;
    }
  } catch (e) {}
  
  // Total dividends received
  let totalDividends = 0;
  try {
    totalDividends = getTotalDividendsReceived(guildId, userId) || 0;
  } catch (e) {}
  
  // Capital gains tax paid
  let totalCapGains = 0;
  try {
    const cgResult = db.exec(
      `SELECT SUM(CAST(SUBSTR(reason, INSTR(reason, 'Tax:') + 5) AS INTEGER)) as total 
       FROM economy_transactions 
       WHERE guild_id = ? AND user_id = ? AND reason LIKE '%Capital Gains%' AND amount < 0`,
      [guildId, userId]
    );
    // Alternative: just sum negative amounts with capital gains reason
    const cgResult2 = db.exec(
      `SELECT SUM(ABS(amount)) as total FROM economy_transactions 
       WHERE guild_id = ? AND user_id = ? AND reason LIKE '%apital%ain%'  AND amount < 0`,
      [guildId, userId]
    );
    if (cgResult2.length > 0 && cgResult2[0].values[0][0]) {
      totalCapGains = cgResult2[0].values[0][0];
    }
  } catch (e) {}
  
  return {
    portfolio, portfolioValue, shareholders, currentPrice,
    stockRank, lastSplit, totalDividends, totalCapGains
  };
}

function getCrimeData(guildId, userId) {
  const db = getDb();
  
  // Skill levels
  const skills = getUserSkills(guildId, userId);
  
  // Infamy
  let infamyPoints = 0;
  let infamyTier = null;
  let activeBounty = null;
  let peakInfamy = 0;
  let bountiesAgainst = 0;
  try {
    const { getInfamy, getTierEffects, getActiveBounty } = require('../infamy');
    const infamyData = getInfamy(guildId, userId);
    infamyPoints = infamyData.infamy_points || 0;
    peakInfamy = infamyData.peak_infamy || 0;
    bountiesAgainst = infamyData.bounties_claimed_on || 0;
    infamyTier = getTierEffects(guildId, userId);
    activeBounty = getActiveBounty(guildId, userId);
  } catch (e) {}
  
  // Total stolen (lifetime hack + rob earnings)
  let totalStolen = 0;
  try {
    const stolenResult = db.exec(
      `SELECT SUM(amount) as total FROM economy_transactions 
       WHERE guild_id = ? AND user_id = ? AND (reason LIKE '%hack%' OR reason LIKE '%rob%' OR reason LIKE '%stole%' OR reason LIKE '%Hacked%' OR reason LIKE '%Robbed%') AND amount > 0`,
      [guildId, userId]
    );
    if (stolenResult.length > 0 && stolenResult[0].values[0][0]) {
      totalStolen = stolenResult[0].values[0][0];
    }
  } catch (e) {}
  
  // Times caught / fined
  let timesCaught = 0;
  try {
    const caughtResult = db.exec(
      `SELECT COUNT(*) as total FROM economy_transactions 
       WHERE guild_id = ? AND user_id = ? AND (reason LIKE '%fine%' OR reason LIKE '%caught%' OR reason LIKE '%Hack fine%' OR reason LIKE '%Rob fine%') AND amount < 0`,
      [guildId, userId]
    );
    if (caughtResult.length > 0 && caughtResult[0].values[0][0]) {
      timesCaught = caughtResult[0].values[0][0];
    }
  } catch (e) {}
  
  return { skills, infamyPoints, infamyTier, activeBounty, totalStolen, timesCaught, peakInfamy, bountiesAgainst };
}

function getGamblingData(guildId, userId) {
  const db = getDb();
  
  // Blackjack + Roulette stats (global table, not per-guild)
  let bjStats = { wins: 0, losses: 0, pushes: 0, blackjacks: 0, earnings: 0 };
  let rouletteStats = { wins: 0, losses: 0, earnings: 0 };
  try {
    const result = db.exec('SELECT * FROM gambling_stats WHERE user_id = ?', [userId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
      bjStats = {
        wins: row.blackjack_wins || 0,
        losses: row.blackjack_losses || 0,
        pushes: row.blackjack_pushes || 0,
        blackjacks: row.blackjack_blackjacks || 0,
        earnings: row.blackjack_earnings || 0
      };
      rouletteStats = {
        wins: row.roulette_wins || 0,
        losses: row.roulette_losses || 0,
        earnings: row.roulette_earnings || 0
      };
    }
  } catch (e) {}
  
  // In Between stats
  let ibStats = { played: 0, won: 0, lost: 0, poles: 0, wagered: 0, totalWon: 0, totalLost: 0 };
  try {
    const result = db.exec('SELECT * FROM inbetween_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
      ibStats = {
        played: row.hands_played || 0, won: row.hands_won || 0, lost: row.hands_lost || 0,
        poles: row.poles_hit || 0, wagered: row.total_wagered || 0,
        totalWon: row.total_won || 0, totalLost: row.total_lost || 0
      };
    }
  } catch (e) {}
  
  // Let It Ride stats
  let lirStats = { played: 0, wagered: 0, totalWon: 0, totalLost: 0 };
  try {
    const result = db.exec('SELECT * FROM letitride_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
      lirStats = {
        played: row.games_played || 0, wagered: row.total_wagered || 0,
        totalWon: row.total_won || 0, totalLost: row.total_lost || 0
      };
    }
  } catch (e) {}
  
  // Three Card Poker stats
  let tcpStats = { played: 0, won: 0, lost: 0, wagered: 0, totalWon: 0, totalLost: 0, biggestWin: 0 };
  try {
    const result = db.exec('SELECT * FROM threecardpoker_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
      tcpStats = {
        played: row.games_played || 0, won: row.games_won || 0, lost: row.games_lost || 0,
        wagered: row.total_wagered || 0, totalWon: row.total_won || 0,
        totalLost: row.total_lost || 0, biggestWin: row.biggest_win || 0
      };
    }
  } catch (e) {}
  
  // SYN stats
  let synStats = { played: 0, won: 0, wagered: 0, totalWon: 0, totalLost: 0 };
  try {
    const result = db.exec('SELECT * FROM syn_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
      synStats = {
        played: row.games_played || 0, won: row.games_won || 0,
        wagered: row.total_wagered || 0, totalWon: row.total_won || 0, totalLost: row.total_lost || 0
      };
    }
  } catch (e) {}
  
  // Scratch card stats (aggregated across card types)
  let scratchStats = { purchased: 0, spent: 0, won: 0, jackpots: 0 };
  try {
    const result = db.exec(
      'SELECT SUM(total_purchased) as purchased, SUM(total_spent) as spent, SUM(total_won) as won, SUM(jackpots_won) as jackpots FROM scratch_stats WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      scratchStats = { purchased: row[0] || 0, spent: row[1] || 0, won: row[2] || 0, jackpots: row[3] || 0 };
    }
  } catch (e) {}
  
  // Lottery stats
  let lotteryStats = { tickets: 0, wins: 0, totalPrize: 0 };
  try {
    const result = db.exec(
      'SELECT COUNT(*) as wins, SUM(prize) as total FROM lottery_history WHERE guild_id = ? AND user_id = ? AND prize > 0',
      [guildId, userId]
    );
    if (result.length > 0 && result[0].values.length > 0) {
      lotteryStats.wins = result[0].values[0][0] || 0;
      lotteryStats.totalPrize = result[0].values[0][1] || 0;
    }
    const ticketResult = db.exec(
      'SELECT COUNT(*) as total FROM lottery_tickets WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    if (ticketResult.length > 0 && ticketResult[0].values.length > 0) {
      lotteryStats.tickets = ticketResult[0].values[0][0] || 0;
    }
  } catch (e) {}
  
  // Total P/L across all games
  const totalPL = bjStats.earnings + rouletteStats.earnings +
    (ibStats.totalWon - ibStats.totalLost) +
    (lirStats.totalWon - lirStats.totalLost) +
    (tcpStats.totalWon - tcpStats.totalLost) +
    (synStats.totalWon - synStats.totalLost) +
    (scratchStats.won - scratchStats.spent) +
    lotteryStats.totalPrize;
  
  return { bjStats, rouletteStats, ibStats, lirStats, tcpStats, synStats, scratchStats, lotteryStats, totalPL };
}

function getFightData(guildId, userId) {
  const db = getDb();
  
  let stats = { wins: 0, losses: 0, draws: 0, total_earnings: 0, total_losses: 0, knockouts: 0, tkos: 0 };
  try {
    const result = db.exec('SELECT * FROM fighter_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      stats = cols.reduce((obj, col, i) => ({ ...obj, [col]: result[0].values[0][i] }), {});
    }
  } catch (e) {}
  
  const totalFights = (stats.wins || 0) + (stats.losses || 0) + (stats.draws || 0);
  const winRate = totalFights > 0 ? ((stats.wins || 0) / totalFights * 100).toFixed(1) : '0.0';
  const totalWon = Math.round((stats.total_earnings || 0) - (stats.total_losses || 0));
  
  // Win streak (count consecutive wins from most recent fights)
  let currentStreak = 0;
  let bestStreak = 0;
  try {
    const history = db.exec(
      `SELECT winner_id FROM fight_history 
       WHERE guild_id = ? AND (fighter1_id = ? OR fighter2_id = ?) AND result_type != 'DRAW'
       ORDER BY fought_at DESC`,
      [guildId, userId, userId]
    );
    if (history.length > 0 && history[0].values.length > 0) {
      let streak = 0;
      let countingCurrent = true;
      for (const row of history[0].values) {
        if (row[0] === userId) {
          streak++;
          if (countingCurrent) currentStreak = streak;
          if (streak > bestStreak) bestStreak = streak;
        } else {
          if (countingCurrent) countingCurrent = false;
          streak = 0;
        }
      }
    }
  } catch (e) {}
  
  return { stats, totalFights, winRate, totalWon, currentStreak, bestStreak };
}

function getDungeonData(guildId, userId) {
  const db = getDb();
  
  const tierData = {};
  let totalProfit = 0;
  
  for (let tier = 1; tier <= 3; tier++) {
    try {
      const result = db.exec(
        `SELECT 
          COUNT(*) as total_runs,
          SUM(CASE WHEN result = 'clear' THEN 1 ELSE 0 END) as total_clears,
          SUM(CASE WHEN result = 'death' THEN 1 ELSE 0 END) as total_deaths,
          SUM(gold_earned) as total_gold,
          MAX(max_floor) as best_floor
        FROM dungeon_history 
        WHERE guild_id = ? AND user_id = ? AND tier = ?`,
        [guildId, userId, tier]
      );
      if (result.length > 0 && result[0].values.length > 0) {
        const row = result[0].values[0];
        tierData[tier] = {
          runs: row[0] || 0,
          clears: row[1] || 0,
          deaths: row[2] || 0,
          gold: row[3] || 0,
          bestFloor: row[4] || 0
        };
        totalProfit += row[3] || 0;
      } else {
        tierData[tier] = { runs: 0, clears: 0, deaths: 0, gold: 0, bestFloor: 0 };
      }
    } catch (e) {
      tierData[tier] = { runs: 0, clears: 0, deaths: 0, gold: 0, bestFloor: 0 };
    }
  }
  
  // Dungeon keys owned
  let keysOwned = 0;
  try {
    const keyResult = db.exec(
      `SELECT SUM(ui.quantity) as total 
       FROM user_inventory ui 
       JOIN shop_items si ON ui.item_id = si.id 
       WHERE ui.guild_id = ? AND ui.user_id = ? AND si.effect_type = 'dungeon_key' AND ui.quantity > 0`,
      [guildId, userId]
    );
    if (keyResult.length > 0 && keyResult[0].values.length > 0 && keyResult[0].values[0][0]) {
      keysOwned = keyResult[0].values[0][0];
    }
  } catch (e) {}
  
  return { tierData, totalProfit, keysOwned };
}

// ==================== EMBED BUILDERS ====================

function buildOverviewEmbed(guildId, userId, user, displayName, avatarUrl) {
  const data = getOverviewData(guildId, userId, user);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📋 ${displayName}'s Profile`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: '💰 Total Wealth', value: `${Math.round(data.totalWealth).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🏆 Server Rank', value: data.netWorthRank ? `#${data.netWorthRank.rank} of ${data.netWorthRank.total}` : 'Unranked', inline: true },
      { name: '📅 Account Age', value: data.accountAge, inline: true },
      { name: '💵 Cash / Bank', value: `${Math.round(data.balance.cash).toLocaleString()} / ${Math.round(data.balance.bank).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '📈 Portfolio', value: `${Math.round(data.portfolioValue).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🏠 Properties', value: `${Math.round(data.propValue).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💬 Messages', value: data.totalMessages.toLocaleString(), inline: true },
      { name: '🎒 Items Owned', value: String(data.itemCount), inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    )
    .setFooter({ text: 'Select a category below for detailed stats' });
  
  return embed;
}

function buildFinanceEmbed(guildId, userId, displayName, avatarUrl) {
  const data = getFinanceData(guildId, userId);
  
  const creditBar = createCreditBar(data.creditScore);
  const tierName = data.creditTier ? data.creditTier.name : 'Unknown';
  
  const propList = data.properties.length > 0
    ? data.properties.slice(0, 5).map(p => `• ${p.name}`).join('\n') + (data.properties.length > 5 ? `\n...and ${data.properties.length - 5} more` : '')
    : 'None';
  
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`💰 ${displayName} — Finance`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: '💵 Cash', value: `${Math.round(data.balance.cash).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🏦 Bank', value: `${Math.round(data.balance.bank).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💎 Total Wealth', value: `${Math.round(data.totalWealth).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🏠 Properties', value: propList, inline: false },
      { name: '📊 Credit Score', value: `${creditBar} ${data.creditScore}/${MAX_CREDIT_SCORE} (${tierName})`, inline: false },
      { name: '🔥 Chat Streak', value: `${data.streak.days} days (${data.streakTier})${data.streak.bonus > 0 ? ` — +${(data.streak.bonus * 100).toFixed(0)}% stock growth` : ''}`, inline: false },
      { name: '💰 Wealth Tax Paid', value: `${Math.round(data.totalTaxPaid).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '📋 Total Loans', value: String(data.totalLoans), inline: true },
      { name: '📄 Active Bonds', value: String(data.activeBondCount), inline: true },
      { name: '🛒 Spent on Bonds', value: `${Math.round(data.totalBondSpent).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💸 Collected from Bonds', value: `${Math.round(data.totalBondCollected).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );
}

function buildStockEmbed(guildId, userId, displayName, avatarUrl) {
  const data = getStockData(guildId, userId);
  
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`📈 ${displayName} — Stock Market`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: '📊 Portfolio Value', value: `${Math.round(data.portfolioValue).toLocaleString()} ${getCurrency(guildId)} (${data.portfolio.length} stocks)`, inline: true },
      { name: '👥 Shareholders', value: `${data.shareholders.length} investors`, inline: true },
      { name: '💲 Stock Price', value: `${data.currentPrice.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🏆 Price Rank', value: data.stockRank ? `#${data.stockRank.rank} of ${data.stockRank.total}` : 'Unranked', inline: true },
      { name: '✂️ Last Split', value: data.lastSplit, inline: true },
      { name: '💰 Dividends Received', value: `${Math.round(data.totalDividends).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '📉 Capital Gains Tax Paid', value: `${Math.round(data.totalCapGains).toLocaleString()} ${getCurrency(guildId)}`, inline: false }
    );
}

function buildCrimeEmbed(guildId, userId, displayName, avatarUrl) {
  const data = getCrimeData(guildId, userId);
  
  const tierEmoji = data.infamyTier ? data.infamyTier.emoji : '';
  const tierName = data.infamyTier ? data.infamyTier.name : 'Clean';
  
  const bountyText = data.activeBounty 
    ? `💰 ${Math.round(data.activeBounty.bounty_amount).toLocaleString()} ${getCurrency(guildId)}`
    : 'None';
  
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`🔓 ${displayName} — Crime`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: '💻 Hack Level', value: `Level ${data.skills.hackLevel}`, inline: true },
      { name: '🔓 Rob Level', value: `Level ${data.skills.robLevel}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🏴‍☠️ Infamy', value: `${tierEmoji} ${tierName} — ${Math.round(data.infamyPoints).toLocaleString()} pts`, inline: true },
      { name: '🎯 Active Bounty', value: bountyText, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💰 Total Stolen', value: `${Math.round(data.totalStolen).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🚔 Times Caught', value: String(data.timesCaught), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📈 Peak Infamy', value: `${Math.round(data.peakInfamy).toLocaleString()} pts`, inline: true },
      { name: '📝 Bounties Against', value: String(data.bountiesAgainst), inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );
}

function buildGamblingEmbed(guildId, userId, displayName, avatarUrl) {
  const data = getGamblingData(guildId, userId);
  
  const bjGames = data.bjStats.wins + data.bjStats.losses + data.bjStats.pushes;
  const rGames = data.rouletteStats.wins + data.rouletteStats.losses;
  
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`🎰 ${displayName} — Gambling`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: '🃏 Blackjack', value: `${bjGames} games | ${data.bjStats.wins}W-${data.bjStats.losses}L-${data.bjStats.pushes}P\nP/L: ${data.bjStats.earnings >= 0 ? '+' : ''}${Math.round(data.bjStats.earnings).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🎡 Roulette', value: `${rGames} games | ${data.rouletteStats.wins}W-${data.rouletteStats.losses}L\nP/L: ${data.rouletteStats.earnings >= 0 ? '+' : ''}${Math.round(data.rouletteStats.earnings).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🎴 In Between', value: `${data.ibStats.played} hands | ${data.ibStats.won}W-${data.ibStats.lost}L\nP/L: ${(data.ibStats.totalWon - data.ibStats.totalLost) >= 0 ? '+' : ''}${Math.round(data.ibStats.totalWon - data.ibStats.totalLost).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🏇 Let It Ride', value: `${data.lirStats.played} games\nP/L: ${(data.lirStats.totalWon - data.lirStats.totalLost) >= 0 ? '+' : ''}${Math.round(data.lirStats.totalWon - data.lirStats.totalLost).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🃏 Three Card Poker', value: `${data.tcpStats.played} games | ${data.tcpStats.won}W-${data.tcpStats.lost}L\nP/L: ${(data.tcpStats.totalWon - data.tcpStats.totalLost) >= 0 ? '+' : ''}${Math.round(data.tcpStats.totalWon - data.tcpStats.totalLost).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🔄 SYN', value: `${data.synStats.played} games | ${data.synStats.won}W\nP/L: ${(data.synStats.totalWon - data.synStats.totalLost) >= 0 ? '+' : ''}${Math.round(data.synStats.totalWon - data.synStats.totalLost).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🎰 Scratch Cards', value: `${data.scratchStats.purchased} cards | ${data.scratchStats.jackpots} jackpots\nP/L: ${(data.scratchStats.won - data.scratchStats.spent) >= 0 ? '+' : ''}${Math.round(data.scratchStats.won - data.scratchStats.spent).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🎟️ Lottery', value: `${data.lotteryStats.tickets} tickets | ${data.lotteryStats.wins} wins\nPrize: ${Math.round(data.lotteryStats.totalPrize).toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: `📊 Total Gambling P/L`, value: `**${data.totalPL >= 0 ? '+' : ''}${Math.round(data.totalPL).toLocaleString()}** ${getCurrency(guildId)}`, inline: false }
    );
}

function buildFightEmbed(guildId, userId, displayName, avatarUrl) {
  const data = getFightData(guildId, userId);
  
  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`🥊 ${displayName} — Fight`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: '⚔️ Total Fights', value: String(data.totalFights), inline: true },
      { name: '✅ Wins', value: String(data.stats.wins || 0), inline: true },
      { name: '❌ Losses', value: String(data.stats.losses || 0), inline: true },
      { name: '🤝 Draws', value: String(data.stats.draws || 0), inline: true },
      { name: '📊 Win Rate', value: `${data.winRate}%`, inline: true },
      { name: '💥 KOs / TKOs', value: `${data.stats.knockouts || 0} / ${data.stats.tkos || 0}`, inline: true },
      { name: '🔥 Current Streak', value: `${data.currentStreak}W`, inline: true },
      { name: '🏆 Best Streak', value: `${data.bestStreak}W`, inline: true },
      { name: '💰 Net Earnings', value: `${data.totalWon >= 0 ? '+' : ''}${data.totalWon.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
    );
}

function buildDungeonEmbed(guildId, userId, displayName, avatarUrl) {
  const data = getDungeonData(guildId, userId);
  
  const tierNames = { 1: '🟢 Tier 1 — Breach', 2: '🟡 Tier 2 — Siege', 3: '🔴 Tier 3 — Chaos' };
  const fields = [];
  
  for (let tier = 1; tier <= 3; tier++) {
    const t = data.tierData[tier];
    fields.push({
      name: tierNames[tier],
      value: t.runs > 0
        ? `Runs: **${t.runs}** | Clears: **${t.clears}** | Deaths: **${t.deaths}**\nBest Floor: **${t.bestFloor}** | Gold: **${t.gold.toLocaleString()}** ${getCurrency(guildId)}`
        : `*No runs yet*`,
      inline: false
    });
  }
  
  fields.push(
    { name: '🔑 Dungeon Keys', value: String(data.keysOwned), inline: true },
    { name: '💰 Total Dungeon Profit', value: `${data.totalProfit.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
    { name: '\u200b', value: '\u200b', inline: true }
  );
  
  return new EmbedBuilder()
    .setColor(0x8b4513)
    .setTitle(`🏰 ${displayName} — Dungeon`)
    .setThumbnail(avatarUrl)
    .addFields(fields);
}

// ==================== UI BUILDERS ====================

function buildCategoryButtons(activeCategory = 'overview') {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('profile_overview').setLabel('📋 Overview').setStyle(activeCategory === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('profile_finance').setLabel('💰 Finance').setStyle(activeCategory === 'finance' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('profile_stock').setLabel('📈 Stock').setStyle(activeCategory === 'stock' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('profile_crime').setLabel('🔓 Crime').setStyle(activeCategory === 'crime' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('profile_gambling').setLabel('🎰 Gambling').setStyle(activeCategory === 'gambling' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('profile_fight').setLabel('🥊 Fight').setStyle(activeCategory === 'fight' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('profile_dungeon').setLabel('🏰 Dungeon').setStyle(activeCategory === 'dungeon' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('profile_dismiss').setLabel('Dismiss').setStyle(ButtonStyle.Danger)
  );
  
  return [row1, row2];
}

function buildUserSelect(currentUserId) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('profile_user_select')
      .setPlaceholder('Select a player to view...')
      .setDefaultUsers([currentUserId])
  );
}

function buildEmbed(category, guildId, userId, displayName, avatarUrl) {
  const user = getUser(userId);
  
  switch (category) {
    case 'finance': return buildFinanceEmbed(guildId, userId, displayName, avatarUrl);
    case 'stock': return buildStockEmbed(guildId, userId, displayName, avatarUrl);
    case 'crime': return buildCrimeEmbed(guildId, userId, displayName, avatarUrl);
    case 'gambling': return buildGamblingEmbed(guildId, userId, displayName, avatarUrl);
    case 'fight': return buildFightEmbed(guildId, userId, displayName, avatarUrl);
    case 'dungeon': return buildDungeonEmbed(guildId, userId, displayName, avatarUrl);
    default: return buildOverviewEmbed(guildId, userId, user, displayName, avatarUrl);
  }
}

// ==================== COMMAND ====================

// Track which user each interaction author is viewing
const viewingUser = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View detailed player profiles'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const displayName = interaction.user.displayName;
    const avatarUrl = interaction.user.displayAvatarURL({ dynamic: true });
    
    // Default to viewing own profile
    viewingUser.set(interaction.user.id, { userId, displayName, avatarUrl });
    
    const embed = buildEmbed('overview', guildId, userId, displayName, avatarUrl);
    const buttons = buildCategoryButtons('overview');
    const userSelect = buildUserSelect(userId);
    
    await interaction.editReply({ embeds: [embed], components: [userSelect, ...buttons] });
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    
    if (customId === 'profile_dismiss') {
      await interaction.deferUpdate();
      try {
        await interaction.deleteReply();
      } catch (e) {
        await interaction.editReply({ components: [] });
      }
      return;
    }
    
    await interaction.deferUpdate();
    
    const guildId = interaction.guildId;
    const category = customId.replace('profile_', '');
    
    // Get the user being viewed (or default to command author)
    const viewing = viewingUser.get(interaction.user.id) || {
      userId: interaction.user.id,
      displayName: interaction.user.displayName,
      avatarUrl: interaction.user.displayAvatarURL({ dynamic: true })
    };
    
    const embed = buildEmbed(category, guildId, viewing.userId, viewing.displayName, viewing.avatarUrl);
    const buttons = buildCategoryButtons(category);
    const userSelect = buildUserSelect(viewing.userId);
    
    await interaction.editReply({ embeds: [embed], components: [userSelect, ...buttons] });
  },

  async handleUserSelect(interaction) {
    await interaction.deferUpdate();
    
    const guildId = interaction.guildId;
    const selectedUserId = interaction.values[0];
    
    let displayName = selectedUserId;
    let avatarUrl = null;
    try {
      const user = await interaction.client.users.fetch(selectedUserId);
      displayName = user.displayName;
      avatarUrl = user.displayAvatarURL({ dynamic: true });
    } catch (e) {}
    
    // Store the selected user
    viewingUser.set(interaction.user.id, { userId: selectedUserId, displayName, avatarUrl });
    
    const embed = buildEmbed('overview', guildId, selectedUserId, displayName, avatarUrl);
    const buttons = buildCategoryButtons('overview');
    const userSelect = buildUserSelect(selectedUserId);
    
    await interaction.editReply({ embeds: [embed], components: [userSelect, ...buttons] });
  },

  BUTTON_IDS
};
