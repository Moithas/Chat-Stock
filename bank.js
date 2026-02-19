// Bank module for Chat-Stock
// Handles loans with interest and savings bonds

let db = null;

// Default bank settings
const DEFAULT_SETTINGS = {
  // Loans
  loansEnabled: true,
  loanInterestRate: 5,           // 5% interest
  loanMaxAmount: 100000,         // Max loan amount
  loanMinAmount: 1000,           // Min loan amount
  loanMaxDuration: 30,           // Max loan duration in days
  loanMinDuration: 1,            // Min loan duration in days
  loanPaymentIntervals: ['daily', 'weekly'],  // Available payment intervals
  loanMissedPaymentPenalty: 10,  // 10% penalty on missed payment
  loanMaxMissedPayments: 3,      // Max missed payments before consequences
  
  // Loan Requirements (all must be met if enabled)
  loanRequireProperties: false,
  loanMinProperties: 1,
  loanRequirePortfolio: false,
  loanMinPortfolioValue: 10000,
  loanRequireTenure: false,
  loanMinTenureDays: 30,
  
  // Default Consequences
  loanSeizeCollateral: false,     // Seize a property on default
  
  // Savings Bonds
  bondsEnabled: true,
  bondConfigs: []  // Array of { id, name, price, roleId, durationDays }
};

// Cache for guild settings
const guildBankSettings = new Map();

function initBank(database) {
  db = database;
  
  // Create bank settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS bank_settings (
      guild_id TEXT PRIMARY KEY,
      loans_enabled INTEGER DEFAULT 1,
      loan_interest_rate REAL DEFAULT 5,
      loan_max_amount INTEGER DEFAULT 100000,
      loan_min_amount INTEGER DEFAULT 1000,
      loan_max_duration INTEGER DEFAULT 30,
      loan_min_duration INTEGER DEFAULT 1,
      loan_payment_intervals TEXT DEFAULT 'daily,weekly',
      loan_missed_payment_penalty REAL DEFAULT 10,
      loan_max_missed_payments INTEGER DEFAULT 3,
      loan_require_properties INTEGER DEFAULT 0,
      loan_min_properties INTEGER DEFAULT 1,
      loan_require_portfolio INTEGER DEFAULT 0,
      loan_min_portfolio_value INTEGER DEFAULT 10000,
      loan_require_tenure INTEGER DEFAULT 0,
      loan_min_tenure_days INTEGER DEFAULT 30,
      loan_seize_collateral INTEGER DEFAULT 0,
      bonds_enabled INTEGER DEFAULT 1
    )
  `);
  
  // Add collateral column if it doesn't exist (for existing databases)
  try {
    db.run('ALTER TABLE bank_settings ADD COLUMN loan_seize_collateral INTEGER DEFAULT 0');
  } catch (e) { /* Column may already exist */ }
  
  // Create loans table
  db.run(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      principal INTEGER NOT NULL,
      interest_rate REAL NOT NULL,
      total_owed INTEGER NOT NULL,
      amount_paid INTEGER DEFAULT 0,
      payment_amount INTEGER NOT NULL,
      payment_interval TEXT NOT NULL,
      next_payment_time INTEGER NOT NULL,
      missed_payments INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);
  
  // Create loan payments history
  db.run(`
    CREATE TABLE IF NOT EXISTS loan_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      payment_time INTEGER NOT NULL,
      FOREIGN KEY (loan_id) REFERENCES loans(id)
    )
  `);
  
  // Create bond configs table
  db.run(`
    CREATE TABLE IF NOT EXISTS bond_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  
  // Create active bonds table (user purchases)
  db.run(`
    CREATE TABLE IF NOT EXISTS active_bonds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bond_config_id INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      purchase_price INTEGER NOT NULL,
      purchased_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (bond_config_id) REFERENCES bond_configs(id)
    )
  `);
  
  // Create bond purchase history
  db.run(`
    CREATE TABLE IF NOT EXISTS bond_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bond_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      purchased_at INTEGER NOT NULL,
      expired_at INTEGER
    )
  `);
  
  // Create credit score table
  db.run(`
    CREATE TABLE IF NOT EXISTS loan_credit_scores (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      credit_score INTEGER DEFAULT 500,
      loans_completed INTEGER DEFAULT 0,
      loans_defaulted INTEGER DEFAULT 0,
      total_on_time_payments INTEGER DEFAULT 0,
      total_missed_payments INTEGER DEFAULT 0,
      total_borrowed INTEGER DEFAULT 0,
      total_repaid INTEGER DEFAULT 0,
      last_default_time INTEGER DEFAULT 0,
      last_recovery_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  // Migration: add last_recovery_time column if missing
  try {
    db.run(`ALTER TABLE loan_credit_scores ADD COLUMN last_recovery_time INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  // Migration: add total_defaulted_amount column for lifetime default tracking
  try {
    db.run(`ALTER TABLE loan_credit_scores ADD COLUMN total_defaulted_amount INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  // Create credit tier settings table (per-guild overrides)
  db.run(`
    CREATE TABLE IF NOT EXISTS credit_tier_settings (
      guild_id TEXT NOT NULL,
      tier_index INTEGER NOT NULL,
      max_loan_percent REAL NOT NULL,
      interest_mod REAL NOT NULL,
      PRIMARY KEY (guild_id, tier_index)
    )
  `);

  // Create indexes for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_loans_guild_user ON loans(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(guild_id, status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_active_bonds_guild_user ON active_bonds(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_active_bonds_expires ON active_bonds(expires_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bond_history_guild_user ON bond_history(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_credit_scores_guild_user ON loan_credit_scores(guild_id, user_id)`);
  
  console.log('🏦 Bank system initialized');
}

// ============ SETTINGS ============

function getBankSettings(guildId) {
  if (guildBankSettings.has(guildId)) {
    return guildBankSettings.get(guildId);
  }
  
  if (db) {
    const result = db.exec('SELECT * FROM bank_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const settings = {
        loansEnabled: row.loans_enabled === 1,
        loanInterestRate: row.loan_interest_rate,
        loanMaxAmount: row.loan_max_amount,
        loanMinAmount: row.loan_min_amount,
        loanMaxDuration: row.loan_max_duration,
        loanMinDuration: row.loan_min_duration,
        loanPaymentIntervals: row.loan_payment_intervals ? row.loan_payment_intervals.split(',') : ['daily', 'weekly'],
        loanMissedPaymentPenalty: row.loan_missed_payment_penalty,
        loanMaxMissedPayments: row.loan_max_missed_payments,
        loanRequireProperties: row.loan_require_properties === 1,
        loanMinProperties: row.loan_min_properties,
        loanRequirePortfolio: row.loan_require_portfolio === 1,
        loanMinPortfolioValue: row.loan_min_portfolio_value,
        loanRequireTenure: row.loan_require_tenure === 1,
        loanMinTenureDays: row.loan_min_tenure_days,
        loanSeizeCollateral: row.loan_seize_collateral === 1,
        bondsEnabled: row.bonds_enabled === 1
      };
      guildBankSettings.set(guildId, settings);
      return settings;
    }
  }
  
  return { ...DEFAULT_SETTINGS };
}

function updateBankSettings(guildId, updates) {
  if (!db) return;
  
  const current = getBankSettings(guildId);
  const settings = { ...current, ...updates };
  
  const intervalsStr = Array.isArray(settings.loanPaymentIntervals) 
    ? settings.loanPaymentIntervals.join(',') 
    : settings.loanPaymentIntervals;
  
  db.run(`
    INSERT OR REPLACE INTO bank_settings 
    (guild_id, loans_enabled, loan_interest_rate, loan_max_amount, loan_min_amount,
     loan_max_duration, loan_min_duration, loan_payment_intervals, loan_missed_payment_penalty,
     loan_max_missed_payments, loan_require_properties, loan_min_properties,
     loan_require_portfolio, loan_min_portfolio_value, loan_require_tenure, loan_min_tenure_days,
     loan_seize_collateral, bonds_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.loansEnabled ? 1 : 0,
    settings.loanInterestRate,
    settings.loanMaxAmount,
    settings.loanMinAmount,
    settings.loanMaxDuration,
    settings.loanMinDuration,
    intervalsStr,
    settings.loanMissedPaymentPenalty,
    settings.loanMaxMissedPayments,
    settings.loanRequireProperties ? 1 : 0,
    settings.loanMinProperties,
    settings.loanRequirePortfolio ? 1 : 0,
    settings.loanMinPortfolioValue,
    settings.loanRequireTenure ? 1 : 0,
    settings.loanMinTenureDays,
    settings.loanSeizeCollateral ? 1 : 0,
    settings.bondsEnabled ? 1 : 0
  ]);
  
  guildBankSettings.set(guildId, settings);
}

// ============ LOAN FUNCTIONS ============

function getUserActiveLoan(guildId, userId) {
  if (!db) return null;
  
  const result = db.exec(`
    SELECT * FROM loans 
    WHERE guild_id = ? AND user_id = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

function getUserLoanHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM loans 
    WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `, [guildId, userId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function createLoan(guildId, userId, principal, interestRate, durationDays, paymentInterval) {
  if (!db) return null;
  
  const totalInterest = Math.floor(principal * (interestRate / 100));
  const totalOwed = principal + totalInterest;
  
  // Calculate number of payments based on interval
  let numPayments;
  let intervalMs;
  if (paymentInterval === 'daily') {
    numPayments = durationDays;
    intervalMs = 24 * 60 * 60 * 1000;
  } else if (paymentInterval === 'weekly') {
    numPayments = Math.ceil(durationDays / 7);
    intervalMs = 7 * 24 * 60 * 60 * 1000;
  } else {
    numPayments = durationDays;
    intervalMs = 24 * 60 * 60 * 1000;
  }
  
  const paymentAmount = Math.ceil(totalOwed / numPayments);
  const now = Date.now();
  const nextPaymentTime = now + intervalMs;
  
  db.run(`
    INSERT INTO loans (guild_id, user_id, principal, interest_rate, total_owed, payment_amount, payment_interval, next_payment_time, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [guildId, userId, principal, interestRate, totalOwed, paymentAmount, paymentInterval, nextPaymentTime, now]);
  
  // Get the created loan
  const result = db.exec('SELECT last_insert_rowid() as id');
  const loanId = result[0].values[0][0];
  
  return {
    id: loanId,
    principal,
    interestRate,
    totalOwed,
    paymentAmount,
    paymentInterval,
    numPayments,
    nextPaymentTime
  };
}

function recordLoanPayment(loanId, guildId, userId, amount, type = 'scheduled') {
  if (!db) return;
  
  db.run(`
    INSERT INTO loan_payments (loan_id, guild_id, user_id, amount, type, payment_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [loanId, guildId, userId, amount, type, Date.now()]);
  
  // Update loan
  db.run(`
    UPDATE loans SET amount_paid = amount_paid + ? WHERE id = ?
  `, [amount, loanId]);
}

function updateLoanNextPayment(loanId, nextTime) {
  if (!db) return;
  db.run('UPDATE loans SET next_payment_time = ? WHERE id = ?', [nextTime, loanId]);
}

function incrementMissedPayments(loanId) {
  if (!db) return;
  db.run('UPDATE loans SET missed_payments = missed_payments + 1 WHERE id = ?', [loanId]);
}

function completeLoan(loanId) {
  if (!db) return;
  db.run(`UPDATE loans SET status = 'completed', completed_at = ? WHERE id = ?`, [Date.now(), loanId]);
}

function defaultLoan(loanId) {
  if (!db) return;
  db.run(`UPDATE loans SET status = 'defaulted', completed_at = ? WHERE id = ?`, [Date.now(), loanId]);
}

function getAllActiveLoans(guildId) {
  if (!db) return [];
  
  const query = guildId 
    ? `SELECT * FROM loans WHERE status = 'active' AND guild_id = ?`
    : `SELECT * FROM loans WHERE status = 'active'`;
  const params = guildId ? [guildId] : [];
  
  const result = db.exec(query, params);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function forgiveLoan(loanId) {
  if (!db) return false;
  db.run(`UPDATE loans SET status = 'forgiven', completed_at = ? WHERE id = ?`, [Date.now(), loanId]);
  return true;
}

function removeDefaultedLoan(guildId, userId) {
  if (!db) return false;
  
  // Find the most recent defaulted loan for this user
  const result = db.exec(`
    SELECT id FROM loans 
    WHERE guild_id = ? AND user_id = ? AND status = 'defaulted'
    ORDER BY created_at DESC LIMIT 1
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return false;
  
  const loanId = result[0].values[0][0];
  db.run(`DELETE FROM loans WHERE id = ?`, [loanId]);
  db.run(`DELETE FROM loan_payments WHERE loan_id = ?`, [loanId]);
  return true;
}

function getAllActiveBonds(guildId) {
  if (!db) return [];
  
  const query = guildId 
    ? `SELECT ab.*, bc.name as bond_name FROM active_bonds ab JOIN bond_configs bc ON ab.bond_config_id = bc.id WHERE ab.status = 'active' AND ab.guild_id = ?`
    : `SELECT ab.*, bc.name as bond_name FROM active_bonds ab JOIN bond_configs bc ON ab.bond_config_id = bc.id WHERE ab.status = 'active'`;
  const params = guildId ? [guildId] : [];
  
  const result = db.exec(query, params);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function removeBond(bondId, guildId) {
  if (!db) return false;
  db.run(`UPDATE active_bonds SET status = 'removed' WHERE id = ? AND guild_id = ?`, [bondId, guildId]);
  return true;
}

function getLoansNeedingPayment() {
  if (!db) return [];
  
  const now = Date.now();
  const result = db.exec(`
    SELECT * FROM loans 
    WHERE status = 'active' AND next_payment_time <= ?
  `, [now]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

// ============ BOND FUNCTIONS ============

function getBondConfigs(guildId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM bond_configs 
    WHERE guild_id = ?
    ORDER BY price ASC
  `, [guildId]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getBondConfig(guildId, bondId) {
  if (!db) return null;
  
  const result = db.exec(`
    SELECT * FROM bond_configs 
    WHERE guild_id = ? AND id = ?
  `, [guildId, bondId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const cols = result[0].columns;
  const vals = result[0].values[0];
  return cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
}

function createBondConfig(guildId, name, price, roleId, durationDays) {
  if (!db) return null;
  
  db.run(`
    INSERT INTO bond_configs (guild_id, name, price, role_id, duration_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, name, price, roleId, durationDays, Date.now()]);
  
  const result = db.exec('SELECT last_insert_rowid() as id');
  return result[0].values[0][0];
}

function updateBondConfig(guildId, bondId, updates) {
  if (!db) return false;
  
  const current = getBondConfig(guildId, bondId);
  if (!current) return false;
  
  const name = updates.name ?? current.name;
  const price = updates.price ?? current.price;
  const roleId = updates.role_id ?? current.role_id;
  const durationDays = updates.duration_days ?? current.duration_days;
  const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : current.enabled;
  
  db.run(`
    UPDATE bond_configs 
    SET name = ?, price = ?, role_id = ?, duration_days = ?, enabled = ?
    WHERE guild_id = ? AND id = ?
  `, [name, price, roleId, durationDays, enabled, guildId, bondId]);
  
  return true;
}

function deleteBondConfig(guildId, bondId) {
  if (!db) return false;
  db.run('DELETE FROM bond_configs WHERE guild_id = ? AND id = ?', [guildId, bondId]);
  return true;
}

function purchaseBond(guildId, userId, bondConfigId, roleId, price, durationDays) {
  if (!db) return null;
  
  const now = Date.now();
  const expiresAt = now + (durationDays * 24 * 60 * 60 * 1000);
  
  db.run(`
    INSERT INTO active_bonds (guild_id, user_id, bond_config_id, role_id, purchase_price, purchased_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guildId, userId, bondConfigId, roleId, price, now, expiresAt]);
  
  const result = db.exec('SELECT last_insert_rowid() as id');
  return {
    id: result[0].values[0][0],
    expiresAt
  };
}

function getUserActiveBonds(guildId, userId) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT ab.*, bc.name as bond_name, bc.duration_days
    FROM active_bonds ab
    JOIN bond_configs bc ON ab.bond_config_id = bc.id
    WHERE ab.guild_id = ? AND ab.user_id = ? AND ab.status = 'active'
    ORDER BY ab.expires_at ASC
  `, [guildId, userId]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getExpiredBonds() {
  if (!db) return [];
  
  const now = Date.now();
  const result = db.exec(`
    SELECT ab.*, bc.name as bond_name
    FROM active_bonds ab
    JOIN bond_configs bc ON ab.bond_config_id = bc.id
    WHERE ab.status = 'active' AND ab.expires_at <= ?
  `, [now]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function expireBond(bondId) {
  if (!db) return;
  db.run(`UPDATE active_bonds SET status = 'expired' WHERE id = ?`, [bondId]);
}

function recordBondHistory(guildId, userId, bondName, price, durationDays) {
  if (!db) return;
  db.run(`
    INSERT INTO bond_history (guild_id, user_id, bond_name, price, duration_days, purchased_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, userId, bondName, price, durationDays, Date.now()]);
}

function getBondHistory(guildId, userId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM bond_history 
    WHERE guild_id = ? AND user_id = ?
    ORDER BY purchased_at DESC LIMIT ?
  `, [guildId, userId, limit]);
  
  if (result.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

function getTotalBondsCollected(guildId, userId) {
  if (!db) return 0;
  
  const result = db.exec(`
    SELECT SUM(price) as total FROM bond_history 
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, userId]);
  
  if (result.length === 0 || result[0].values.length === 0) return 0;
  
  const total = result[0].values[0][0];
  return total || 0;
}

function getTotalBondIncomeCollected(guildId, userId) {
  if (!db) return 0;
  
  // Get the most recent bond purchase time
  const latestBondResult = db.exec(`
    SELECT MAX(purchased_at) as latest_purchase FROM bond_history 
    WHERE guild_id = ? AND user_id = ?
  `, [guildId, userId]);
  
  if (latestBondResult.length === 0 || latestBondResult[0].values.length === 0) return 0;
  
  const latestBondTime = latestBondResult[0].values[0][0];
  if (!latestBondTime) return 0;
  
  // Get all bond role IDs for this user
  const bondRolesResult = db.exec(`
    SELECT DISTINCT ab.role_id FROM active_bonds ab
    WHERE ab.guild_id = ? AND ab.user_id = ?
    UNION
    SELECT DISTINCT bc.role_id FROM bond_configs bc
    WHERE bc.guild_id = ?
  `, [guildId, userId, guildId]);
  
  if (bondRolesResult.length === 0 || bondRolesResult[0].values.length === 0) return 0;
  
  const roleIds = bondRolesResult[0].values.map(row => row[0]);
  
  // Sum all income from these roles AFTER the latest bond purchase
  const incomeResult = db.exec(`
    SELECT SUM(amount) as total FROM role_income_history 
    WHERE guild_id = ? AND user_id = ? AND role_id IN (${roleIds.map(() => '?').join(',')}) AND collection_time >= ?
  `, [guildId, userId, ...roleIds, latestBondTime]);
  
  if (incomeResult.length === 0 || incomeResult[0].values.length === 0) return 0;
  
  const total = incomeResult[0].values[0][0];
  return total || 0;
}

// ============ CREDIT SCORE SYSTEM ============

// Credit tiers determine borrowing limits and interest rates
const CREDIT_TIERS = [
  { name: 'Bankrupt',    emoji: '💀', minScore: 0,   maxLoanPercent: 0,    interestMod: 0,   color: 0x2c2f33 },
  { name: 'Terrible',    emoji: '🔴', minScore: 100, maxLoanPercent: 15,   interestMod: 2.0, color: 0xe74c3c },
  { name: 'Poor',        emoji: '🟠', minScore: 250, maxLoanPercent: 30,   interestMod: 1.5, color: 0xe67e22 },
  { name: 'Fair',        emoji: '🟡', minScore: 400, maxLoanPercent: 50,   interestMod: 1.2, color: 0xf1c40f },
  { name: 'Good',        emoji: '🟢', minScore: 500, maxLoanPercent: 75,   interestMod: 1.0, color: 0x2ecc71 },
  { name: 'Great',       emoji: '🟢', minScore: 650, maxLoanPercent: 100,  interestMod: 0.8, color: 0x27ae60 },
  { name: 'Excellent',   emoji: '⭐', minScore: 800, maxLoanPercent: 130,  interestMod: 0.6, color: 0x3498db },
  { name: 'Perfect',     emoji: '💎', minScore: 950, maxLoanPercent: 160,  interestMod: 0.4, color: 0x9b59b6 }
];

const DEFAULT_CREDIT_SCORE = 500; // Everyone starts at "Good"
const MAX_CREDIT_SCORE = 1000;
const MIN_CREDIT_SCORE = 0;

// Score changes
const SCORE_CHANGES = {
  LOAN_COMPLETED: 50,        // Paid off a loan in full
  ON_TIME_PAYMENT: 5,        // Each scheduled payment made on time
  MISSED_PAYMENT: -30,       // Missed a payment
  LOAN_DEFAULTED: -200,      // Defaulted on a loan
  EARLY_PAYOFF_BONUS: 25,    // Paid off before all scheduled payments
};

// Default cooldown: how long (in days) a defaulter must wait before borrowing again
const DEFAULT_COOLDOWN_DAYS = 7;

// Passive credit recovery: points gained per day while below starting score and past cooldown
const PASSIVE_RECOVERY_PER_DAY = 10;
const PASSIVE_RECOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000; // Check in 1-day increments

// Get credit tiers with per-guild overrides applied
function getGuildCreditTiers(guildId) {
  const tiers = CREDIT_TIERS.map(t => ({ ...t })); // Clone defaults
  if (!db) return tiers;

  const result = db.exec(`SELECT tier_index, max_loan_percent, interest_mod FROM credit_tier_settings WHERE guild_id = ?`, [guildId]);
  if (result.length > 0 && result[0].values.length > 0) {
    for (const row of result[0].values) {
      const idx = row[0];
      if (idx >= 0 && idx < tiers.length) {
        tiers[idx].maxLoanPercent = row[1];
        tiers[idx].interestMod = row[2];
      }
    }
  }
  return tiers;
}

function updateCreditTierSetting(guildId, tierIndex, maxLoanPercent, interestMod) {
  if (!db || tierIndex < 0 || tierIndex >= CREDIT_TIERS.length) return;

  db.run(`
    INSERT OR REPLACE INTO credit_tier_settings (guild_id, tier_index, max_loan_percent, interest_mod)
    VALUES (?, ?, ?, ?)
  `, [guildId, tierIndex, maxLoanPercent, interestMod]);

  saveDatabase();
}

function resetCreditTierSettings(guildId) {
  if (!db) return;
  db.run(`DELETE FROM credit_tier_settings WHERE guild_id = ?`, [guildId]);
  saveDatabase();
}

function getUserCreditScore(guildId, userId) {
  if (!db) return { score: DEFAULT_CREDIT_SCORE, loansCompleted: 0, loansDefaulted: 0, onTimePayments: 0, missedPayments: 0, totalBorrowed: 0, totalRepaid: 0, totalDefaultedAmount: 0, lastDefaultTime: 0 };

  const result = db.exec(`SELECT * FROM loan_credit_scores WHERE guild_id = ? AND user_id = ?`, [guildId, userId]);

  if (result.length === 0 || result[0].values.length === 0) {
    return { score: DEFAULT_CREDIT_SCORE, loansCompleted: 0, loansDefaulted: 0, onTimePayments: 0, missedPayments: 0, totalBorrowed: 0, totalRepaid: 0, totalDefaultedAmount: 0, lastDefaultTime: 0 };
  }

  const cols = result[0].columns;
  const vals = result[0].values[0];
  const row = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});

  let score = row.credit_score;
  const lastDefaultTime = row.last_default_time || 0;

  // Passive credit recovery: if score is below starting score and past default cooldown, recover over time
  if (score < DEFAULT_CREDIT_SCORE) {
    const cooldownMs = DEFAULT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const cooldownEnd = lastDefaultTime > 0 ? lastDefaultTime + cooldownMs : 0;
    const now = Date.now();

    if (now > cooldownEnd) {
      // Calculate recovery from the later of: cooldown end, or last recovery checkpoint
      const lastRecovery = row.last_recovery_time || cooldownEnd || 0;
      if (lastRecovery > 0) {
        const elapsed = now - lastRecovery;
        const daysElapsed = Math.floor(elapsed / PASSIVE_RECOVERY_INTERVAL_MS);

        if (daysElapsed > 0) {
          const recovery = daysElapsed * PASSIVE_RECOVERY_PER_DAY;
          const newScore = Math.min(DEFAULT_CREDIT_SCORE, score + recovery);

          if (newScore > score) {
            score = newScore;
            // Persist the recovery
            db.run(`UPDATE loan_credit_scores SET credit_score = ?, last_recovery_time = ? WHERE guild_id = ? AND user_id = ?`,
              [score, now, guildId, userId]);
            saveDatabase();
            console.log(`📊 Passive credit recovery for ${userId}: ${row.credit_score} → ${score} (+${recovery})`);
          }
        }
      }
    }
  }

  return {
    score,
    loansCompleted: row.loans_completed,
    loansDefaulted: row.loans_defaulted,
    onTimePayments: row.total_on_time_payments,
    missedPayments: row.total_missed_payments,
    totalBorrowed: row.total_borrowed,
    totalRepaid: row.total_repaid,
    totalDefaultedAmount: row.total_defaulted_amount || 0,
    lastDefaultTime
  };
}

function modifyCreditScore(guildId, userId, change, reason = '') {
  if (!db) return;

  const current = getUserCreditScore(guildId, userId);
  const newScore = Math.max(MIN_CREDIT_SCORE, Math.min(MAX_CREDIT_SCORE, current.score + change));

  db.run(`
    INSERT OR REPLACE INTO loan_credit_scores 
    (guild_id, user_id, credit_score, loans_completed, loans_defaulted, total_on_time_payments, total_missed_payments, total_borrowed, total_repaid, last_default_time, last_recovery_time, total_defaulted_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `, [guildId, userId, newScore, current.loansCompleted, current.loansDefaulted, current.onTimePayments, current.missedPayments, current.totalBorrowed, current.totalRepaid, current.lastDefaultTime, current.totalDefaultedAmount || 0]);

  if (reason) {
    console.log(`📊 Credit score for ${userId}: ${current.score} → ${newScore} (${change > 0 ? '+' : ''}${change}, ${reason})`);
  }

  return newScore;
}

// Minimum loan size (as % of current max borrowing limit) to earn positive credit score changes
const CREDIT_MIN_LOAN_PERCENT = 25;

function recordCreditEvent(guildId, userId, event, loanPrincipal = 0, paymentAmount = 0) {
  if (!db) return;

  const current = getUserCreditScore(guildId, userId);
  const settings = getBankSettings(guildId);
  const baseMaxAmount = settings.loanMaxAmount || 100000;

  // Determine the user's current max loan for the minimum threshold check
  const creditLimits = getCreditLoanLimits(guildId, userId);
  const currentMaxLoan = creditLimits.maxLoan;
  const minLoanForCredit = Math.floor(currentMaxLoan * (CREDIT_MIN_LOAN_PERCENT / 100));

  // Check if this loan qualifies for positive credit impact
  // Loans below 25% of your max borrowing limit don't build credit (but penalties always apply)
  const isPositiveEvent = ['completed', 'completed_early', 'on_time_payment'].includes(event);
  const qualifiesForCredit = loanPrincipal >= minLoanForCredit || !isPositiveEvent;

  // Scale factor: rewards/penalties scale with loan size relative to max
  const loanScale = loanPrincipal > 0 
    ? Math.max(0.1, Math.min(2.0, loanPrincipal / baseMaxAmount))
    : 1;

  let scoreChange = 0;
  const updates = { ...current };

  switch (event) {
    case 'completed':
      updates.loansCompleted = current.loansCompleted + 1;
      updates.totalRepaid = current.totalRepaid + paymentAmount;
      scoreChange = qualifiesForCredit ? Math.round(SCORE_CHANGES.LOAN_COMPLETED * loanScale) : 0;
      break;
    case 'completed_early':
      updates.loansCompleted = current.loansCompleted + 1;
      updates.totalRepaid = current.totalRepaid + paymentAmount;
      scoreChange = qualifiesForCredit ? Math.round((SCORE_CHANGES.LOAN_COMPLETED + SCORE_CHANGES.EARLY_PAYOFF_BONUS) * loanScale) : 0;
      break;
    case 'defaulted':
      updates.loansDefaulted = current.loansDefaulted + 1;
      updates.lastDefaultTime = Date.now();
      updates.totalDefaultedAmount = (current.totalDefaultedAmount || 0) + loanPrincipal;
      // Default penalty scales more aggressively (1.5x multiplier on scale)
      const defaultScale = Math.max(0.25, (loanPrincipal / baseMaxAmount) * 1.5);
      scoreChange = Math.round(SCORE_CHANGES.LOAN_DEFAULTED * defaultScale);
      break;
    case 'on_time_payment':
      updates.onTimePayments = current.onTimePayments + 1;
      updates.totalRepaid = current.totalRepaid + paymentAmount;
      scoreChange = qualifiesForCredit ? Math.max(1, Math.round(SCORE_CHANGES.ON_TIME_PAYMENT * loanScale)) : 0;
      break;
    case 'missed_payment':
      updates.missedPayments = current.missedPayments + 1;
      scoreChange = Math.min(-1, Math.round(SCORE_CHANGES.MISSED_PAYMENT * loanScale));
      break;
    case 'loan_taken':
      updates.totalBorrowed = current.totalBorrowed + loanPrincipal;
      scoreChange = 0;
      break;
  }

  if (isPositiveEvent && !qualifiesForCredit && loanPrincipal > 0) {
    console.log(`📊 Credit [${event}] ${userId}: No score change — loan ${loanPrincipal.toLocaleString()} below 25% threshold (${minLoanForCredit.toLocaleString()})`)
  }

  const newScore = Math.max(MIN_CREDIT_SCORE, Math.min(MAX_CREDIT_SCORE, current.score + scoreChange));

  db.run(`
    INSERT OR REPLACE INTO loan_credit_scores 
    (guild_id, user_id, credit_score, loans_completed, loans_defaulted, total_on_time_payments, total_missed_payments, total_borrowed, total_repaid, last_default_time, last_recovery_time, total_defaulted_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `, [guildId, userId, newScore, updates.loansCompleted, updates.loansDefaulted, updates.onTimePayments, updates.missedPayments, updates.totalBorrowed, updates.totalRepaid, updates.lastDefaultTime, updates.totalDefaultedAmount || 0]);

  saveDatabase();

  if (scoreChange !== 0) {
    console.log(`📊 Credit [${event}] ${userId}: ${current.score} → ${newScore} (${scoreChange > 0 ? '+' : ''}${scoreChange}, principal=${loanPrincipal}, scale=${loanScale.toFixed(2)})`);
  }

  return newScore;
}

function getCreditTier(score, guildId = null) {
  const tiers = guildId ? getGuildCreditTiers(guildId) : CREDIT_TIERS;
  // Find the highest tier the score qualifies for
  let tier = tiers[0];
  for (const t of tiers) {
    if (score >= t.minScore) tier = t;
  }
  return tier;
}

function getCreditLoanLimits(guildId, userId) {
  const settings = getBankSettings(guildId);
  const credit = getUserCreditScore(guildId, userId);
  const tier = getCreditTier(credit.score, guildId);

  // Max loan = base max * tier percentage
  let maxLoan = Math.floor(settings.loanMaxAmount * (tier.maxLoanPercent / 100));

  // Lifetime default penalty: reduce max loan based on total amount defaulted
  // Every $1 of lifetime defaults reduces max borrowing power
  // Penalty caps at 75% reduction — you can never fully recover from serial defaults
  let defaultPenaltyPercent = 0;
  if (credit.totalDefaultedAmount > 0) {
    defaultPenaltyPercent = Math.min(75, (credit.totalDefaultedAmount / (settings.loanMaxAmount * 3)) * 100);
    maxLoan = Math.floor(maxLoan * (1 - defaultPenaltyPercent / 100));
  }

  // Interest = base rate * tier modifier
  const interestRate = Math.round((settings.loanInterestRate * tier.interestMod) * 10) / 10;

  // Check default cooldown
  let defaultCooldownRemaining = 0;
  if (credit.lastDefaultTime > 0) {
    const cooldownMs = DEFAULT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - credit.lastDefaultTime;
    if (elapsed < cooldownMs) {
      defaultCooldownRemaining = cooldownMs - elapsed;
    }
  }

  return {
    credit,
    tier,
    maxLoan,
    interestRate,
    defaultCooldownRemaining,
    defaultPenaltyPercent,
    baseMaxLoan: settings.loanMaxAmount,
    baseInterestRate: settings.loanInterestRate
  };
}

function formatCreditScore(score, guildId = null) {
  const tier = getCreditTier(score, guildId);
  return `${tier.emoji} **${score}** / ${MAX_CREDIT_SCORE} (${tier.name})`;
}

function createCreditBar(score, length = 10) {
  const pct = (score / MAX_CREDIT_SCORE) * 100;
  const filled = Math.round((pct / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ============ ELIGIBILITY CHECKS ============

function checkLoanEligibility(guildId, userId, member, portfolioValue, propertiesOwned) {
  const settings = getBankSettings(guildId);
  const reasons = [];
  
  if (!settings.loansEnabled) {
    return { eligible: false, reasons: ['Loans are currently disabled.'] };
  }
  
  // Check for existing active loan
  const existingLoan = getUserActiveLoan(guildId, userId);
  if (existingLoan) {
    return { eligible: false, reasons: ['You already have an active loan. Pay it off first.'] };
  }

  // Check credit score - default cooldown
  const creditLimits = getCreditLoanLimits(guildId, userId);
  if (creditLimits.defaultCooldownRemaining > 0) {
    const days = Math.ceil(creditLimits.defaultCooldownRemaining / (24 * 60 * 60 * 1000));
    const hours = Math.ceil(creditLimits.defaultCooldownRemaining / (60 * 60 * 1000));
    const timeStr = days > 1 ? `${days} days` : `${hours} hours`;
    reasons.push(`🚫 You defaulted on a loan recently. You must wait **${timeStr}** before borrowing again.`);
  }

  // Check credit score - bankrupt tier can't borrow
  if (creditLimits.tier.maxLoanPercent <= 0) {
    reasons.push(`💀 Your credit score is too low to borrow. (${formatCreditScore(creditLimits.credit.score)})`);
  }
  
  // Check property requirement
  if (settings.loanRequireProperties) {
    if (propertiesOwned < settings.loanMinProperties) {
      reasons.push(`You need at least ${settings.loanMinProperties} properties (you have ${propertiesOwned}).`);
    }
  }
  
  // Check portfolio requirement
  if (settings.loanRequirePortfolio) {
    if (portfolioValue < settings.loanMinPortfolioValue) {
      reasons.push(`You need a portfolio worth at least ${settings.loanMinPortfolioValue.toLocaleString()} (yours is ${portfolioValue.toLocaleString()}).`);
    }
  }
  
  // Check tenure requirement
  if (settings.loanRequireTenure && member) {
    const joinedAt = member.joinedAt;
    if (joinedAt) {
      const tenureDays = Math.floor((Date.now() - joinedAt.getTime()) / (24 * 60 * 60 * 1000));
      if (tenureDays < settings.loanMinTenureDays) {
        reasons.push(`You need to be a member for at least ${settings.loanMinTenureDays} days (you've been here ${tenureDays} days).`);
      }
    }
  }
  
  return {
    eligible: reasons.length === 0,
    reasons,
    creditLimits // Pass along for use in the application UI
  };
}

// ============ BOND TIER ALIASES (for admin panel) ============

function getBondTiers(guildId) {
  return getBondConfigs(guildId);
}

function addBondTier(guildId, name, price, roleId, durationDays) {
  return createBondConfig(guildId, name, price, roleId, durationDays);
}

function updateBondTier(guildId, bondId, updates) {
  return updateBondConfig(guildId, bondId, updates);
}

function removeBondTier(guildId, bondId) {
  return deleteBondConfig(guildId, bondId);
}

// ============ SCHEDULER ============

let schedulerClient = null;
const { saveDatabase } = require('./database');

function startBankScheduler(client) {
  schedulerClient = client;
  
  // Check every minute for payments due and expired bonds
  setInterval(async () => {
    await processLoanPayments();
    await processExpiredBonds();
  }, 60000);
  
  console.log('🏦 Bank scheduler started');
}

async function processLoanPayments() {
  if (!db || !schedulerClient) return;
  
  const loans = getLoansNeedingPayment();
  const { removeFromBank } = require('./economy');
  
  for (const loan of loans) {
    try {
      const guild = await schedulerClient.guilds.fetch(loan.guild_id);
      if (!guild) continue;
      
      const remaining = loan.total_owed - loan.amount_paid;
      const paymentAmount = Math.min(loan.payment_amount, remaining);
      
      // Try to take payment from bank
      const success = await removeFromBank(loan.guild_id, loan.user_id, paymentAmount, 'Loan payment');
      
      if (success) {
        // Record successful payment
        recordLoanPayment(loan.id, loan.guild_id, loan.user_id, paymentAmount, 'scheduled');
        recordCreditEvent(loan.guild_id, loan.user_id, 'on_time_payment', loan.principal, paymentAmount);
        
        const newPaid = loan.amount_paid + paymentAmount;
        if (newPaid >= loan.total_owed) {
          completeLoan(loan.id);
          recordCreditEvent(loan.guild_id, loan.user_id, 'completed', loan.principal, paymentAmount);
          console.log(`✅ Loan ${loan.id} completed for user ${loan.user_id}`);
        } else {
          // Schedule next payment
          const intervalMs = loan.payment_interval === 'weekly' 
            ? 7 * 24 * 60 * 60 * 1000 
            : 24 * 60 * 60 * 1000;
          updateLoanNextPayment(loan.id, Date.now() + intervalMs);
        }
      } else {
        // Missed payment
        incrementMissedPayments(loan.id);
        recordCreditEvent(loan.guild_id, loan.user_id, 'missed_payment', loan.principal, 0);
        
        const settings = getBankSettings(loan.guild_id);
        if (loan.missed_payments + 1 >= settings.loanMaxMissedPayments) {
          defaultLoan(loan.id);
          recordCreditEvent(loan.guild_id, loan.user_id, 'defaulted', loan.principal, 0);
          console.log(`❌ Loan ${loan.id} defaulted for user ${loan.user_id}`);
          
          // Seize property as collateral if enabled
          if (settings.loanSeizeCollateral) {
            try {
              const { seizePropertyFromUser } = require('./property');
              const seized = seizePropertyFromUser(loan.guild_id, loan.user_id);
              if (seized) {
                console.log(`🏠 Seized property ${seized.name} from user ${loan.user_id} as loan collateral`);
              }
            } catch (e) {
              console.error('Error seizing collateral:', e);
            }
          }
        } else {
          // Add penalty to total owed
          const penalty = Math.floor(remaining * (settings.loanMissedPaymentPenalty / 100));
          db.run('UPDATE loans SET total_owed = total_owed + ? WHERE id = ?', [penalty, loan.id]);
          
          // Schedule retry in 1 hour
          updateLoanNextPayment(loan.id, Date.now() + 60 * 60 * 1000);
        }
      }
      
      saveDatabase();
    } catch (error) {
      console.error(`Error processing loan payment for loan ${loan.id}:`, error);
    }
  }
}

async function processExpiredBonds() {
  if (!db || !schedulerClient) return;
  
  const expiredBonds = getExpiredBonds();
  
  for (const bond of expiredBonds) {
    try {
      const guild = await schedulerClient.guilds.fetch(bond.guild_id);
      if (!guild) continue;
      
      const member = await guild.members.fetch(bond.user_id).catch(() => null);
      if (member && bond.role_id) {
        await member.roles.remove(bond.role_id).catch(console.error);
      }
      
      expireBond(bond.id);
      console.log(`📜 Bond ${bond.id} expired for user ${bond.user_id}`);
      
      saveDatabase();
    } catch (error) {
      console.error(`Error processing expired bond ${bond.id}:`, error);
    }
  }
}

module.exports = {
  initBank,
  getBankSettings,
  updateBankSettings,
  startBankScheduler,
  // Loans
  getUserActiveLoan,
  getUserLoanHistory,
  createLoan,
  recordLoanPayment,
  updateLoanNextPayment,
  incrementMissedPayments,
  completeLoan,
  defaultLoan,
  getAllActiveLoans,
  getLoansNeedingPayment,
  checkLoanEligibility,
  forgiveLoan,
  removeDefaultedLoan,
  // Credit Score
  getUserCreditScore,
  modifyCreditScore,
  recordCreditEvent,
  getCreditTier,
  getCreditLoanLimits,
  formatCreditScore,
  createCreditBar,
  getGuildCreditTiers,
  updateCreditTierSetting,
  resetCreditTierSettings,
  CREDIT_TIERS,
  MAX_CREDIT_SCORE,
  DEFAULT_COOLDOWN_DAYS,
  // Bonds
  getBondConfigs,
  getBondConfig,
  createBondConfig,
  updateBondConfig,
  deleteBondConfig,
  purchaseBond,
  getUserActiveBonds,
  getExpiredBonds,
  expireBond,
  recordBondHistory,
  getBondHistory,
  getTotalBondsCollected,
  getTotalBondIncomeCollected,
  getAllActiveBonds,
  removeBond,
  // Bond Tier aliases for admin
  getBondTiers,
  addBondTier,
  updateBondTier,
  removeBondTier
};
