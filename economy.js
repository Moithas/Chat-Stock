// Internal economy system - replacement for UBB
const { getDb } = require('./database');
const { getAdminSettings } = require('./admin');
const log = require('./logger');

// Hard cap: no single transaction should exceed 1 trillion (well within MAX_SAFE_INTEGER)
const MAX_ECONOMY_VALUE = 1_000_000_000_000;

// Validate amount is a positive finite number — blocks NaN, Infinity, negatives, non-numbers
function isValidAmount(amount) {
  return typeof amount === 'number' && isFinite(amount) && amount > 0;
}

// Clamp amount to safe economy range — prevents precision loss near MAX_SAFE_INTEGER
function clampAmount(amount) {
  if (amount > MAX_ECONOMY_VALUE) {
    log.warn(`[ECONOMY OVERFLOW] Amount ${amount} clamped to MAX_ECONOMY_VALUE (${MAX_ECONOMY_VALUE})`);
    return MAX_ECONOMY_VALUE;
  }
  return amount;
}

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
    // New player — check for configured starting balance
    if (startingCash === 0 && startingBank === 0) {
      const settings = getAdminSettings(guildId);
      if (settings.startingBalance > 0) {
        startingBank = settings.startingBalance;
      }
    }
    db.run(
      'INSERT INTO balances (guild_id, user_id, cash, bank, created_at) VALUES (?, ?, ?, ?, ?)',
      [guildId, userId, startingCash, startingBank, Date.now()]
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
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] addMoney rejected invalid amount: ${amount} (${typeof amount}) for user ${userId}, reason: ${reason}`);
    return false;
  }
  amount = Math.round(clampAmount(amount));
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
    log.error('Error adding money', { error: error.message });
    return false;
  }
}

// Add money directly to user's bank
async function addToBank(guildId, userId, amount, reason = 'Deposit') {
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] addToBank rejected invalid amount: ${amount} (${typeof amount}) for user ${userId}, reason: ${reason}`);
    return false;
  }
  amount = Math.round(clampAmount(amount));
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
    log.error('Error adding to bank', { error: error.message });
    return false;
  }
}

// Remove money from user's cash (atomic check-and-deduct)
async function removeMoney(guildId, userId, amount, reason = 'Transaction') {
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] removeMoney rejected invalid amount: ${amount} (${typeof amount}) for user ${userId}, reason: ${reason}`);
    return false;
  }
  amount = Math.round(amount);
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    // Atomic: deduct only if sufficient funds, return rows changed
    const result = db.run(
      'UPDATE balances SET cash = cash - ? WHERE guild_id = ? AND user_id = ? AND cash >= ?',
      [amount, guildId, userId, amount]
    );
    
    if (!result || result.changes === 0) {
      log.warn(`Insufficient cash for removeMoney: user ${userId}, amount ${amount}`);
      return false;
    }
    
    logTransaction(guildId, userId, -amount, 'cash', reason);
    return true;
  } catch (error) {
    log.error('Error removing money', { error: error.message });
    return false;
  }
}

// Force remove money from user's cash (allows negative balance/debt)
// Used for robbery to prevent deposit exploit during fight-back period
async function forceRemoveMoney(guildId, userId, amount, reason = 'Transaction') {
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] forceRemoveMoney rejected invalid amount: ${amount} (${typeof amount}) for user ${userId}, reason: ${reason}`);
    return false;
  }
  amount = Math.round(amount);
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
    log.error('Error force removing money', { error: error.message });
    return false;
  }
}

// Remove money from user's bank (atomic check-and-deduct)
async function removeFromBank(guildId, userId, amount, reason = 'Withdrawal') {
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] removeFromBank rejected invalid amount: ${amount} (${typeof amount}) for user ${userId}, reason: ${reason}`);
    return false;
  }
  amount = Math.round(amount);
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    // Atomic: deduct only if sufficient funds
    const result = db.run(
      'UPDATE balances SET bank = bank - ? WHERE guild_id = ? AND user_id = ? AND bank >= ?',
      [amount, guildId, userId, amount]
    );
    
    if (!result || result.changes === 0) {
      log.warn(`Insufficient bank balance for removeFromBank: user ${userId}, amount ${amount}`);
      return false;
    }
    
    logTransaction(guildId, userId, -amount, 'bank', reason);
    return true;
  } catch (error) {
    log.error('Error removing from bank', { error: error.message });
    return false;
  }
}

// Check if user has enough money in cash
async function hasEnoughMoney(guildId, userId, amount) {
  try {
    const balance = getBalance(guildId, userId);
    return balance.cash >= amount;
  } catch (error) {
    log.error('Error checking balance', { error: error.message });
    return false;
  }
}

// Check if user has enough money in bank
async function hasEnoughInBank(guildId, userId, amount) {
  try {
    const balance = getBalance(guildId, userId);
    log.debug(`[Bank Check] User: ${userId}, Need: ${amount}, Has: Cash: ${balance.cash}, Bank: ${balance.bank}, Total: ${balance.total}`);
    return balance.bank >= amount;
  } catch (error) {
    log.error('Error checking bank balance', { error: error.message });
    return false;
  }
}

// Remove money from total balance (cash first, then bank) — atomic transaction
async function removeFromTotal(guildId, userId, amount, reason = 'Purchase') {
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] removeFromTotal rejected invalid amount: ${amount} (${typeof amount}) for user ${userId}, reason: ${reason}`);
    return { success: false, error: 'Invalid amount' };
  }
  amount = Math.round(amount);
  try {
    const db = getDb();
    ensureBalance(guildId, userId);
    
    const doTransfer = db.transaction(() => {
      const balance = getBalance(guildId, userId);
      
      if (balance.total < amount) {
        return { success: false, error: 'Insufficient funds' };
      }
      
      const availableCash = Math.max(0, balance.cash);
      const fromCash = Math.min(availableCash, amount);
      const fromBank = amount - fromCash;
      
      if (fromCash > 0) {
        db.run(
          'UPDATE balances SET cash = cash - ? WHERE guild_id = ? AND user_id = ?',
          [fromCash, guildId, userId]
        );
        logTransaction(guildId, userId, -fromCash, 'cash', reason);
      }
      
      if (fromBank > 0) {
        db.run(
          'UPDATE balances SET bank = bank - ? WHERE guild_id = ? AND user_id = ?',
          [fromBank, guildId, userId]
        );
        logTransaction(guildId, userId, -fromBank, 'bank', reason);
      }
      
      return { success: true, fromCash, fromBank };
    });
    
    return doTransfer();
  } catch (error) {
    log.error('Error removing from total', { error: error.message });
    return { success: false, error: error.message };
  }
}

// Set user balance directly (for admin use or migration)
function setBalance(guildId, userId, cash, bank) {
  const db = getDb();
  
  ensureBalance(guildId, userId);
  
  cash = Math.round(cash);
  bank = Math.round(bank);
  
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
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] applyFine rejected invalid amount: ${amount} (${typeof amount}) for user ${userId}, reason: ${reason}`);
    return false;
  }
  amount = Math.round(amount);
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
    log.error('Error applying fine', { error: error.message });
    return false;
  }
}

// Get when a player's balance record was first created (for new player immunity)
function getPlayerCreatedAt(guildId, userId) {
  const db = getDb();
  const result = db.exec(
    'SELECT created_at FROM balances WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] || 0;
}

// Atomic transfer between two users (for rob, hack, fight, give)
// Deducts from source and credits to target in a single transaction
async function atomicTransfer(guildId, fromUserId, toUserId, amount, fromType = 'cash', toType = 'cash', reason = 'Transfer') {
  if (!isValidAmount(amount)) {
    log.error(`[ECONOMY GUARD] atomicTransfer rejected invalid amount: ${amount} for ${fromUserId} → ${toUserId}, reason: ${reason}`);
    return { success: false, error: 'Invalid amount' };
  }
  amount = Math.round(amount);
  try {
    const db = getDb();
    ensureBalance(guildId, fromUserId);
    ensureBalance(guildId, toUserId);
    
    const doTransfer = db.transaction(() => {
      const fromBalance = getBalance(guildId, fromUserId);
      const available = fromType === 'bank' ? fromBalance.bank : fromBalance.cash;
      
      if (available < amount) {
        return { success: false, error: 'Insufficient funds' };
      }
      
      // Deduct from source
      db.run(
        `UPDATE balances SET ${fromType} = ${fromType} - ? WHERE guild_id = ? AND user_id = ?`,
        [amount, guildId, fromUserId]
      );
      logTransaction(guildId, fromUserId, -amount, fromType, reason);
      
      // Credit to target
      db.run(
        `UPDATE balances SET ${toType} = ${toType} + ? WHERE guild_id = ? AND user_id = ?`,
        [amount, guildId, toUserId]
      );
      logTransaction(guildId, toUserId, amount, toType, reason);
      
      return { success: true };
    });
    
    return doTransfer();
  } catch (error) {
    log.error('Error in atomic transfer', { error: error.message });
    return { success: false, error: error.message };
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
  applyFine,
  getPlayerCreatedAt,
  atomicTransfer,
  MAX_ECONOMY_VALUE
};
