// Internal economy system - replacement for UBB
const { getDb } = require('./database');

// Get user's balance
function getBalance(guildId, userId) {
  const db = getDb();
  
  const result = db.exec(
    'SELECT cash, bank FROM balances WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    // No balance record, return zeros
    return {
      cash: 0,
      bank: 0,
      total: 0
    };
  }
  
  const [cash, bank] = result[0].values[0];
  return {
    cash: cash || 0,
    bank: bank || 0,
    total: (cash || 0) + (bank || 0)
  };
}

// Ensure user has a balance record
function ensureBalance(guildId, userId, startingCash = 0, startingBank = 0) {
  const db = getDb();
  
  const existing = db.exec(
    'SELECT 1 FROM balances WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  
  if (existing.length === 0 || existing[0].values.length === 0) {
    db.run(
      'INSERT INTO balances (guild_id, user_id, cash, bank) VALUES (?, ?, ?, ?)',
      [guildId, userId, startingCash, startingBank]
    );
  }
}

// Log a transaction for audit trail
function logTransaction(guildId, userId, amount, balanceType, reason = '') {
  const db = getDb();
  
  db.run(
    'INSERT INTO economy_transactions (guild_id, user_id, amount, balance_type, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, userId, amount, balanceType, reason, Date.now()]
  );
}

// Add money to user's cash
async function addMoney(guildId, userId, amount, reason = 'Transaction') {
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    db.run(
      'UPDATE balances SET cash = cash + ? WHERE guild_id = ? AND user_id = ?',
      [amount, guildId, userId]
    );
    
    logTransaction(guildId, userId, amount, 'cash', reason);
    return true;
  } catch (error) {
    console.error('Error adding money:', error);
    return false;
  }
}

// Add money directly to user's bank
async function addToBank(guildId, userId, amount, reason = 'Deposit') {
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    db.run(
      'UPDATE balances SET bank = bank + ? WHERE guild_id = ? AND user_id = ?',
      [amount, guildId, userId]
    );
    
    logTransaction(guildId, userId, amount, 'bank', reason);
    return true;
  } catch (error) {
    console.error('Error adding to bank:', error);
    return false;
  }
}

// Remove money from user's cash
async function removeMoney(guildId, userId, amount, reason = 'Transaction') {
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    const balance = getBalance(guildId, userId);
    if (balance.cash < amount) {
      console.error(`Insufficient cash: ${balance.cash} < ${amount}`);
      return false;
    }
    
    db.run(
      'UPDATE balances SET cash = cash - ? WHERE guild_id = ? AND user_id = ?',
      [amount, guildId, userId]
    );
    
    logTransaction(guildId, userId, -amount, 'cash', reason);
    return true;
  } catch (error) {
    console.error('Error removing money:', error);
    return false;
  }
}

// Force remove money from user's cash (allows negative balance/debt)
// Used for robbery to prevent deposit exploit during fight-back period
async function forceRemoveMoney(guildId, userId, amount, reason = 'Transaction') {
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    db.run(
      'UPDATE balances SET cash = cash - ? WHERE guild_id = ? AND user_id = ?',
      [amount, guildId, userId]
    );
    
    logTransaction(guildId, userId, -amount, 'cash', reason);
    return true;
  } catch (error) {
    console.error('Error force removing money:', error);
    return false;
  }
}

// Remove money from user's bank
async function removeFromBank(guildId, userId, amount, reason = 'Withdrawal') {
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    const balance = getBalance(guildId, userId);
    if (balance.bank < amount) {
      console.error(`Insufficient bank balance: ${balance.bank} < ${amount}`);
      return false;
    }
    
    db.run(
      'UPDATE balances SET bank = bank - ? WHERE guild_id = ? AND user_id = ?',
      [amount, guildId, userId]
    );
    
    logTransaction(guildId, userId, -amount, 'bank', reason);
    return true;
  } catch (error) {
    console.error('Error removing from bank:', error);
    return false;
  }
}

// Check if user has enough money in cash
async function hasEnoughMoney(guildId, userId, amount) {
  try {
    const balance = getBalance(guildId, userId);
    return balance.cash >= amount;
  } catch (error) {
    console.error('Error checking balance:', error);
    return false;
  }
}

// Check if user has enough money in bank
async function hasEnoughInBank(guildId, userId, amount) {
  try {
    const balance = getBalance(guildId, userId);
    console.log(`[Bank Check] User: ${userId}, Need: ${amount}, Has: Cash: ${balance.cash}, Bank: ${balance.bank}, Total: ${balance.total}`);
    return balance.bank >= amount;
  } catch (error) {
    console.error('Error checking bank balance:', error);
    return false;
  }
}

// Remove money from total balance (cash first, then bank)
async function removeFromTotal(guildId, userId, amount, reason = 'Purchase') {
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    const balance = getBalance(guildId, userId);
    
    if (balance.total < amount) {
      return { success: false, error: 'Insufficient funds' };
    }
    
    // Take from cash first, but only if cash is positive
    const availableCash = Math.max(0, balance.cash); // Treat negative cash as 0 available
    const fromCash = Math.min(availableCash, amount);
    const fromBank = amount - fromCash;
    
    // Remove from cash if needed
    if (fromCash > 0) {
      db.run(
        'UPDATE balances SET cash = cash - ? WHERE guild_id = ? AND user_id = ?',
        [fromCash, guildId, userId]
      );
      logTransaction(guildId, userId, -fromCash, 'cash', reason);
    }
    
    // Remove from bank if needed
    if (fromBank > 0) {
      db.run(
        'UPDATE balances SET bank = bank - ? WHERE guild_id = ? AND user_id = ?',
        [fromBank, guildId, userId]
      );
      logTransaction(guildId, userId, -fromBank, 'bank', reason);
    }
    
    return { success: true, fromCash, fromBank };
  } catch (error) {
    console.error('Error removing from total:', error);
    return { success: false, error: error.message };
  }
}

// Set user balance directly (for admin use or migration)
function setBalance(guildId, userId, cash, bank) {
  const db = getDb();
  
  ensureBalance(guildId, userId);
  
  db.run(
    'UPDATE balances SET cash = ?, bank = ? WHERE guild_id = ? AND user_id = ?',
    [cash, bank, guildId, userId]
  );
}

// Check if economy is enabled (always true for internal system)
function isEnabled() {
  return true;
}

// Get transaction history for a user
function getTransactionHistory(guildId, userId, limit = 50) {
  const db = getDb();
  
  const result = db.exec(
    'SELECT * FROM economy_transactions WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ?',
    [guildId, userId, limit]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    return [];
  }
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// Get all balances for a guild (for admin/migration purposes)
function getAllBalances(guildId) {
  const db = getDb();
  
  const result = db.exec(
    `SELECT b.user_id, u.username, b.cash, b.bank 
     FROM balances b 
     LEFT JOIN users u ON b.user_id = u.user_id 
     WHERE b.guild_id = ? 
     ORDER BY (b.cash + b.bank) DESC`,
    [guildId]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    return [];
  }
  
  return result[0].values.map(row => ({
    userId: row[0],
    username: row[1] || 'Unknown User',
    cash: row[2],
    bank: row[3],
    total: row[2] + row[3]
  }));
}
// Apply a fine - can put user into negative cash balance
async function applyFine(guildId, userId, amount, reason = 'Fine') {
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    // Fines can put users into negative balance - no check needed
    db.run(
      'UPDATE balances SET cash = cash - ? WHERE guild_id = ? AND user_id = ?',
      [amount, guildId, userId]
    );
    
    logTransaction(guildId, userId, -amount, 'cash', reason);
    return true;
  } catch (error) {
    console.error('Error applying fine:', error);
    return false;
  }
}

module.exports = {
  isEnabled,
  getBalance,
  ensureBalance,
  addMoney,
  addToBank,
  removeMoney,
  forceRemoveMoney,
  removeFromBank,
  removeFromTotal,
  hasEnoughMoney,
  hasEnoughInBank,
  setBalance,
  getTransactionHistory,
  getAllBalances,
  applyFine
};
