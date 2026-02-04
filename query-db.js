const initSqlJs = require('sql.js');
const fs = require('fs');

async function main() {
  const SQL = await initSqlJs();
  const data = fs.readFileSync('./chatstock.db');
  const db = new SQL.Database(data);
  
  const userId = '706155855934128228';
  
  // User info
  console.log('=== USER INFO ===');
  const user = db.exec(`SELECT * FROM users WHERE user_id = '${userId}'`);
  if (user.length > 0 && user[0].values.length > 0) {
    const cols = user[0].columns;
    const vals = user[0].values[0];
    cols.forEach((col, i) => console.log(`  ${col}: ${vals[i]}`));
  }
  
  // Balance
  console.log('\n=== BALANCE ===');
  const balance = db.exec(`SELECT * FROM balances WHERE user_id = '${userId}'`);
  if (balance.length > 0 && balance[0].values.length > 0) {
    const cols = balance[0].columns;
    const vals = balance[0].values[0];
    cols.forEach((col, i) => console.log(`  ${col}: ${vals[i]}`));
  }
  
  // Passive income tracker
  console.log('\n=== PASSIVE INCOME TRACKER ===');
  const passive = db.exec(`SELECT * FROM passive_income_tracker WHERE user_id = '${userId}'`);
  if (passive.length > 0 && passive[0].values.length > 0) {
    const cols = passive[0].columns;
    const vals = passive[0].values[0];
    cols.forEach((col, i) => {
      if (col.includes('time')) {
        console.log(`  ${col}: ${vals[i]} (${new Date(vals[i]).toLocaleString()})`);
      } else {
        console.log(`  ${col}: ${vals[i]}`);
      }
    });
  }
  
  // Passive income history
  console.log('\n=== PASSIVE INCOME HISTORY (last 10) ===');
  try {
    // First get columns
    const passiveCols = db.exec("PRAGMA table_info(passive_income_history)");
    console.log('  Columns:', passiveCols[0].values.map(r => r[1]).join(', '));
    
    const passiveHist = db.exec(`SELECT * FROM passive_income_history WHERE user_id = '${userId}' ORDER BY id DESC LIMIT 10`);
    if (passiveHist.length > 0 && passiveHist[0].values.length > 0) {
      passiveHist[0].values.forEach(row => console.log('    ', row.join(', ')));
    } else {
      console.log('  No history');
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
  
  // Work history
  console.log('\n=== WORK HISTORY (last 10) ===');
  try {
    const workHist = db.exec(`SELECT * FROM work_history WHERE user_id = '${userId}' ORDER BY id DESC LIMIT 10`);
    if (workHist.length > 0 && workHist[0].values.length > 0) {
      console.log('  Columns:', workHist[0].columns.join(', '));
      workHist[0].values.forEach(row => console.log('    ', row.join(', ')));
    } else {
      console.log('  No work history');
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
  
  // Recent economy transactions
  console.log('\n=== RECENT ECONOMY TRANSACTIONS (last 30) ===');
  const tx = db.exec(`SELECT * FROM economy_transactions WHERE user_id = '${userId}' ORDER BY timestamp DESC LIMIT 30`);
  if (tx.length > 0 && tx[0].values.length > 0) {
    console.log('  Columns:', tx[0].columns.join(', '));
    tx[0].values.forEach(row => {
      const ts = new Date(row[5]).toLocaleString();
      console.log(`    ${row[2] >= 0 ? '+' : ''}${row[2]} ${row[3]} | ${row[4]} | ${ts}`);
    });
  }
  
  // Check for any cap-related tables
  console.log('\n=== CHECKING FOR CAP/LIMIT TABLES ===');
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%cap%' OR name LIKE '%limit%' OR name LIKE '%daily%')");
  if (tables.length > 0 && tables[0].values.length > 0) {
    tables[0].values.forEach(row => console.log('  ', row[0]));
  } else {
    console.log('  No cap/limit tables found');
  }
  
  // All tables
  console.log('\n=== ALL TABLES ===');
  const allTables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  if (allTables.length > 0) {
    allTables[0].values.forEach(row => console.log('  ', row[0]));
  }
  
  // Dividend settings (includes passive income settings)
  console.log('\n=== DIVIDEND/PASSIVE INCOME SETTINGS ===');
  try {
    const divSettings = db.exec(`SELECT * FROM dividend_settings WHERE guild_id = '1417672485964615702'`);
    if (divSettings.length > 0 && divSettings[0].values.length > 0) {
      const cols = divSettings[0].columns;
      const vals = divSettings[0].values[0];
      cols.forEach((col, i) => console.log(`  ${col}: ${vals[i]}`));
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
  
  // Calculate user's current stock price - OLD SYSTEM
  console.log('\n=== OLD FLAT RATE CALCULATION ===');
  const fifteenDaysAgo = Date.now() - (15 * 24 * 60 * 60 * 1000);
  const recentMsgs = db.exec(`SELECT COUNT(*) FROM transactions WHERE buyer_id = '${userId}' AND timestamp > ${fifteenDaysAgo} AND transaction_type = 'MESSAGE'`);
  console.log('  Recent messages (15 days):', recentMsgs[0].values[0][0]);
  
  const sharesOwned = db.exec(`SELECT SUM(shares) FROM stocks WHERE stock_user_id = '${userId}'`);
  console.log('  Total shares of this stock owned:', sharesOwned[0].values[0][0] || 0);
  
  // Show stock price breakdown - OLD SYSTEM
  const baseValue = 100;
  const recentCount = recentMsgs[0].values[0][0] || 0;
  const activityMult = 1 + Math.min(recentCount * 0.002, 0.60);
  let priceOld = baseValue * activityMult;
  
  const totalShares = sharesOwned[0].values[0][0] || 0;
  if (totalShares > 0) {
    const demandMult = 1 + Math.min(totalShares * 0.003, 0.30);
    priceOld *= demandMult;
  }
  
  console.log('  Activity multiplier (OLD - CAPPED):', activityMult.toFixed(4));
  console.log('  Demand multiplier:', totalShares > 0 ? (1 + Math.min(totalShares * 0.003, 0.30)).toFixed(4) : 'N/A');
  console.log('  Old calculated price:', Math.round(priceOld * 100) / 100);
  
  // NEW DIMINISHING RETURNS CALCULATION
  console.log('\n=== NEW DIMINISHING RETURNS CALCULATION ===');
  const tierSettings = {
    tier1Threshold: 20,
    tier1Rate: 0.5,       // 0.5% each = 10% max
    tier2Threshold: 50,
    tier2Rate: 0.25,      // 0.25% each = 7.5% max
    tier3Threshold: 100,
    tier3Rate: 0.15,      // 0.15% each = 7.5% max
    tier4Rate: 0.05       // 0.05% each (no cap!)
  };
  
  function calculateDailyContribution(messageCount, settings) {
    let contribution = 0;
    let remaining = messageCount;
    
    const tier1Count = Math.min(remaining, settings.tier1Threshold);
    contribution += tier1Count * settings.tier1Rate;
    remaining -= tier1Count;
    
    if (remaining > 0) {
      const tier2Count = Math.min(remaining, settings.tier2Threshold - settings.tier1Threshold);
      contribution += tier2Count * settings.tier2Rate;
      remaining -= tier2Count;
    }
    
    if (remaining > 0) {
      const tier3Count = Math.min(remaining, settings.tier3Threshold - settings.tier2Threshold);
      contribution += tier3Count * settings.tier3Rate;
      remaining -= tier3Count;
    }
    
    if (remaining > 0) {
      contribution += remaining * settings.tier4Rate;
    }
    
    return contribution;
  }
  
  // Check today's transactions
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  console.log('\n=== TODAY TRANSACTIONS ===');
  console.log('  Today starts at:', todayStart.toLocaleString(), '(', todayStart.getTime(), ')');
  const todayTx = db.exec(`SELECT * FROM economy_transactions WHERE user_id = '${userId}' AND timestamp >= ${todayStart.getTime()} ORDER BY timestamp DESC`);
  if (todayTx.length > 0 && todayTx[0].values.length > 0) {
    console.log('  Count:', todayTx[0].values.length);
    todayTx[0].values.forEach(row => {
      console.log(`    ${row[2] >= 0 ? '+' : ''}${row[2]} ${row[3]} | ${row[4]} | ${new Date(row[5]).toLocaleString()}`);
    });
  } else {
    console.log('  No transactions today');
  }
  
  // MESSAGE DISTRIBUTION ANALYSIS
  console.log('\n=== MESSAGE DISTRIBUTION (by day) ===');
  const now = Date.now();
  const fifteenDaysAgo2 = now - (15 * 24 * 60 * 60 * 1000);
  
  // Get all messages in the 15-day window
  const allMsgs = db.exec(`SELECT timestamp FROM transactions WHERE buyer_id = '${userId}' AND timestamp > ${fifteenDaysAgo2} AND transaction_type = 'MESSAGE' ORDER BY timestamp ASC`);
  
  if (allMsgs.length > 0 && allMsgs[0].values.length > 0) {
    const messages = allMsgs[0].values.map(r => r[0]);
    console.log('  Total messages in 15-day window:', messages.length);
    
    // Group by day
    const dayBuckets = {};
    for (const ts of messages) {
      const date = new Date(ts);
      const dayKey = date.toLocaleDateString();
      dayBuckets[dayKey] = (dayBuckets[dayKey] || 0) + 1;
    }
    
    console.log('\n  Messages per day (with NEW system contribution):');
    const sortedDays = Object.keys(dayBuckets).sort((a, b) => new Date(a) - new Date(b));
    let totalNewContribution = 0;
    for (const day of sortedDays) {
      const dayDate = new Date(day);
      const daysUntilExpire = Math.ceil((dayDate.getTime() + 15 * 24 * 60 * 60 * 1000 - now) / (24 * 60 * 60 * 1000));
      const dailyContrib = calculateDailyContribution(dayBuckets[day], tierSettings);
      totalNewContribution += dailyContrib;
      console.log(`    ${day}: ${dayBuckets[day]} msgs → +${dailyContrib.toFixed(2)}% (expire in ${daysUntilExpire} days)`);
    }
    
    // Calculate NEW price
    const newActivityMult = 1 + (totalNewContribution / 100);
    let priceNew = baseValue * newActivityMult;
    if (totalShares > 0) {
      const demandMult = 1 + Math.min(totalShares * 0.003, 0.30);
      priceNew *= demandMult;
    }
    
    console.log('\n=== COMPARISON ===');
    console.log('  Total activity contribution (NEW):', totalNewContribution.toFixed(2) + '%');
    console.log('  Activity multiplier (NEW):', newActivityMult.toFixed(4));
    console.log('  NEW calculated price:', Math.round(priceNew * 100) / 100);
    console.log('  OLD calculated price:', Math.round(priceOld * 100) / 100);
    console.log('  Difference:', Math.round((priceNew - priceOld) * 100) / 100);
    
    // Calculate when they'd drop below 300 (the cap threshold)
    console.log('\n=== OLD SYSTEM: WHEN WOULD CAP LIFT? ===');
    const capThreshold = 300; // 300 messages = 60% cap
    const excessMessages = messages.length - capThreshold;
    console.log('  Messages above cap threshold:', excessMessages);
    
    if (excessMessages > 0) {
      // Find when enough messages expire to drop below 300
      let cumulative = 0;
      for (const day of sortedDays) {
        cumulative += dayBuckets[day];
        if (cumulative >= excessMessages) {
          const dayDate = new Date(day);
          const expireDate = new Date(dayDate.getTime() + 15 * 24 * 60 * 60 * 1000);
          console.log(`  Cap would lift on: ${expireDate.toLocaleDateString()}`);
          console.log(`  (when ${day}'s ${dayBuckets[day]} messages expire)`);
          console.log(`  Days from now: ${Math.ceil((expireDate.getTime() - now) / (24 * 60 * 60 * 1000))}`);
          break;
        }
      }
    } else {
      console.log('  User is NOT capped - can increase now by chatting!');
    }
    
    console.log('\n=== NEW SYSTEM: NO HARD CAP! ===');
    console.log('  Every message always adds something.');
    console.log('  Tomorrow\'s first 20 messages will be worth', (20 * tierSettings.tier1Rate).toFixed(1) + '% total');
  }
  
  db.close();
}

main().catch(console.error);
