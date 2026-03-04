// Dungeon Crawl System - Solo PvE combat
// Fight through floors of NPC enemies for small rewards

const { saveDatabase } = require('./database');

let db = null;

// Default settings
const defaultSettings = {
  enabled: true,
  maxFloors: 5,
  baseReward: 50,          // Reward for floor 1
  rewardPerFloor: 30,       // Additional reward per floor
  cooldownMinutes: 180,     // 3 hour cooldown
  baseEnemyHp: 60,          // Floor 1 enemy HP
  enemyHpPerFloor: 10,      // Additional enemy HP per floor
  playerHp: 100,            // Player starting HP
  deathPenaltyPercent: 50,  // Lose 50% of earned gold on death
  roundTimeSeconds: 15,     // Time to pick a move
  floorHealPercent: 20      // HP recovered after clearing a floor
};

// Enemy types with themed names and move tendencies
const ENEMY_TYPES = [
  { name: 'Script Kiddie', emoji: '👶', bias: { exploit: 30, corrupt: 10, isolate: 10, spam: 35, override: 15 } },
  { name: 'Rogue Bot', emoji: '🤖', bias: { exploit: 20, corrupt: 20, isolate: 20, spam: 20, override: 20 } },
  { name: 'Corrupt Firewall', emoji: '🔥', bias: { exploit: 15, corrupt: 35, isolate: 20, spam: 10, override: 20 } },
  { name: 'Data Wraith', emoji: '👻', bias: { exploit: 10, corrupt: 15, isolate: 40, spam: 15, override: 20 } },
  { name: 'Malware Golem', emoji: '🧟', bias: { exploit: 30, corrupt: 25, isolate: 10, spam: 20, override: 15 } },
  { name: 'Phishing Phantom', emoji: '🎣', bias: { exploit: 15, corrupt: 10, isolate: 30, spam: 25, override: 20 } },
  { name: 'Ransomware Demon', emoji: '😈', bias: { exploit: 20, corrupt: 30, isolate: 15, spam: 20, override: 15 } },
  { name: 'Trojan Sentinel', emoji: '🛡️', bias: { exploit: 15, corrupt: 15, isolate: 25, spam: 15, override: 30 } },
  { name: 'Zero-Day Specter', emoji: '💀', bias: { exploit: 35, corrupt: 20, isolate: 15, spam: 15, override: 15 } },
  { name: 'DDoS Swarm', emoji: '🐝', bias: { exploit: 10, corrupt: 10, isolate: 10, spam: 50, override: 20 } },
  { name: 'Cryptojacker', emoji: '⛏️', bias: { exploit: 20, corrupt: 25, isolate: 20, spam: 15, override: 20 } },
  { name: 'Worm Cluster', emoji: '🪱', bias: { exploit: 20, corrupt: 20, isolate: 15, spam: 30, override: 15 } },
  { name: 'Rootkit Shade', emoji: '🌑', bias: { exploit: 10, corrupt: 15, isolate: 35, spam: 15, override: 25 } },
  { name: 'Keylogger Stalker', emoji: '👁️', bias: { exploit: 30, corrupt: 15, isolate: 20, spam: 25, override: 10 } },
  { name: 'Botnet Overlord', emoji: '👑', bias: { exploit: 20, corrupt: 25, isolate: 20, spam: 15, override: 20 } }
];

// Floor flavor text
const FLOOR_INTROS = [
  "You descend into the server's corrupted memory banks...",
  "The digital corridors grow darker as you push deeper...",
  "Warning signs flash as you breach the next layer...",
  "Encrypted barriers crumble as you force your way through...",
  "The system's defenses intensify around you..."
];

// Damage values
const DAMAGE = {
  SPAM: 15,
  ISOLATE: 15,
  OVERRIDE: 20,
  EXPLOIT: 20,
  CORRUPT: 25,
  RESTORE_HEAL: 25,
  DOUBLE_RESTORE_HEAL: 5
};

// Move matrix — 5-way cycle
// Exploit > Corrupt, Isolate | loses to Spam, Override
// Corrupt > Isolate, Spam | loses to Override, Exploit
// Isolate > Spam, Override | loses to Exploit, Corrupt
// Spam > Override, Exploit | loses to Isolate, Corrupt
// Override > Exploit, Corrupt | loses to Spam, Isolate
// Restore heals but takes damage from any attack
const MOVE_MATRIX = {
  exploit: {
    exploit:  { winner: 'none', damage: 0 },
    corrupt:  { winner: 'attacker', damage: DAMAGE.EXPLOIT },
    isolate:  { winner: 'attacker', damage: DAMAGE.EXPLOIT },
    spam:     { winner: 'defender', damage: DAMAGE.SPAM },
    override: { winner: 'defender', damage: DAMAGE.OVERRIDE },
    restore:  { winner: 'both', attackerDamage: DAMAGE.EXPLOIT, defenderHeal: DAMAGE.RESTORE_HEAL }
  },
  corrupt: {
    exploit:  { winner: 'defender', damage: DAMAGE.EXPLOIT },
    corrupt:  { winner: 'none', damage: 0 },
    isolate:  { winner: 'attacker', damage: DAMAGE.CORRUPT },
    spam:     { winner: 'attacker', damage: DAMAGE.CORRUPT },
    override: { winner: 'defender', damage: DAMAGE.OVERRIDE },
    restore:  { winner: 'both', attackerDamage: DAMAGE.CORRUPT, defenderHeal: DAMAGE.RESTORE_HEAL }
  },
  isolate: {
    exploit:  { winner: 'defender', damage: DAMAGE.EXPLOIT },
    corrupt:  { winner: 'defender', damage: DAMAGE.CORRUPT },
    isolate:  { winner: 'none', damage: 0 },
    spam:     { winner: 'attacker', damage: DAMAGE.ISOLATE },
    override: { winner: 'attacker', damage: DAMAGE.ISOLATE },
    restore:  { winner: 'both', attackerDamage: DAMAGE.ISOLATE, defenderHeal: DAMAGE.RESTORE_HEAL }
  },
  spam: {
    exploit:  { winner: 'attacker', damage: DAMAGE.SPAM },
    corrupt:  { winner: 'defender', damage: DAMAGE.CORRUPT },
    isolate:  { winner: 'defender', damage: DAMAGE.ISOLATE },
    spam:     { winner: 'none', damage: 0 },
    override: { winner: 'attacker', damage: DAMAGE.SPAM },
    restore:  { winner: 'both', attackerDamage: DAMAGE.SPAM, defenderHeal: DAMAGE.RESTORE_HEAL }
  },
  override: {
    exploit:  { winner: 'attacker', damage: DAMAGE.OVERRIDE },
    corrupt:  { winner: 'attacker', damage: DAMAGE.OVERRIDE },
    isolate:  { winner: 'defender', damage: DAMAGE.ISOLATE },
    spam:     { winner: 'defender', damage: DAMAGE.SPAM },
    override: { winner: 'none', damage: 0 },
    restore:  { winner: 'both', attackerDamage: DAMAGE.OVERRIDE, defenderHeal: DAMAGE.RESTORE_HEAL }
  },
  restore: {
    exploit:  { winner: 'both', defenderDamage: DAMAGE.EXPLOIT, attackerHeal: DAMAGE.RESTORE_HEAL },
    corrupt:  { winner: 'both', defenderDamage: DAMAGE.CORRUPT, attackerHeal: DAMAGE.RESTORE_HEAL },
    isolate:  { winner: 'both', defenderDamage: DAMAGE.ISOLATE, attackerHeal: DAMAGE.RESTORE_HEAL },
    spam:     { winner: 'both', defenderDamage: DAMAGE.SPAM, attackerHeal: DAMAGE.RESTORE_HEAL },
    override: { winner: 'both', defenderDamage: DAMAGE.OVERRIDE, attackerHeal: DAMAGE.RESTORE_HEAL },
    restore:  { winner: 'stalemate', heal: DAMAGE.DOUBLE_RESTORE_HEAL }
  }
};

// Active dungeon runs (in-memory)
const activeRuns = new Map(); // guildId-userId -> run state

function initDungeon(database) {
  db = database;

  // Create dungeon settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS dungeon_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      max_floors INTEGER DEFAULT 5,
      base_reward INTEGER DEFAULT 50,
      reward_per_floor INTEGER DEFAULT 30,
      cooldown_minutes INTEGER DEFAULT 180,
      base_enemy_hp INTEGER DEFAULT 80,
      enemy_hp_per_floor INTEGER DEFAULT 15,
      player_hp INTEGER DEFAULT 100,
      death_penalty_percent INTEGER DEFAULT 50,
      round_time_seconds INTEGER DEFAULT 15,
      floor_heal_percent INTEGER DEFAULT 20
    )
  `);

  // Create dungeon cooldown tracker table
  db.run(`
    CREATE TABLE IF NOT EXISTS dungeon_tracker (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_dungeon_time INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  // Create dungeon history table
  db.run(`
    CREATE TABLE IF NOT EXISTS dungeon_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      floors_cleared INTEGER NOT NULL,
      max_floor INTEGER NOT NULL,
      gold_earned INTEGER NOT NULL,
      result TEXT NOT NULL,
      run_time INTEGER NOT NULL
    )
  `);

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_dungeon_tracker_guild_user ON dungeon_tracker(guild_id, user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_dungeon_history_guild_user ON dungeon_history(guild_id, user_id)`);

  // Migration: add floor_heal_percent column if missing
  try {
    db.run(`ALTER TABLE dungeon_settings ADD COLUMN floor_heal_percent INTEGER DEFAULT 20`);
  } catch (e) {
    // Column already exists
  }

  saveDatabase();
  console.log('🏰 Dungeon system initialized');
}

// ==================== SETTINGS ====================

function getDungeonSettings(guildId) {
  if (!db) return { ...defaultSettings };

  const stmt = db.prepare(`SELECT * FROM dungeon_settings WHERE guild_id = ?`);
  stmt.bind([guildId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      enabled: row.enabled === 1,
      maxFloors: row.max_floors || defaultSettings.maxFloors,
      baseReward: row.base_reward || defaultSettings.baseReward,
      rewardPerFloor: row.reward_per_floor || defaultSettings.rewardPerFloor,
      cooldownMinutes: row.cooldown_minutes || defaultSettings.cooldownMinutes,
      baseEnemyHp: row.base_enemy_hp || defaultSettings.baseEnemyHp,
      enemyHpPerFloor: row.enemy_hp_per_floor || defaultSettings.enemyHpPerFloor,
      playerHp: row.player_hp || defaultSettings.playerHp,
      deathPenaltyPercent: row.death_penalty_percent ?? defaultSettings.deathPenaltyPercent,
      roundTimeSeconds: row.round_time_seconds || defaultSettings.roundTimeSeconds,
      floorHealPercent: row.floor_heal_percent ?? defaultSettings.floorHealPercent
    };
  }

  stmt.free();
  return { ...defaultSettings };
}

function updateDungeonSettings(guildId, newSettings) {
  if (!db) return;

  const current = getDungeonSettings(guildId);
  const merged = { ...current, ...newSettings };

  db.run(`INSERT OR REPLACE INTO dungeon_settings 
    (guild_id, enabled, max_floors, base_reward, reward_per_floor, cooldown_minutes, base_enemy_hp, enemy_hp_per_floor, player_hp, death_penalty_percent, round_time_seconds, floor_heal_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, merged.enabled ? 1 : 0, merged.maxFloors, merged.baseReward, merged.rewardPerFloor,
     merged.cooldownMinutes, merged.baseEnemyHp, merged.enemyHpPerFloor, merged.playerHp,
     merged.deathPenaltyPercent, merged.roundTimeSeconds, merged.floorHealPercent]);

  saveDatabase();
}

// ==================== COOLDOWN ====================

function canRunDungeon(guildId, userId) {
  if (!db) return { canRun: true };

  const settings = getDungeonSettings(guildId);
  const stmt = db.prepare(`SELECT last_dungeon_time FROM dungeon_tracker WHERE guild_id = ? AND user_id = ?`);
  stmt.bind([guildId, userId]);

  if (!stmt.step()) {
    stmt.free();
    return { canRun: true };
  }

  const row = stmt.getAsObject();
  stmt.free();
  const lastTime = row.last_dungeon_time;
  const cooldownMs = settings.cooldownMinutes * 60 * 1000;
  const elapsed = Date.now() - lastTime;

  if (elapsed < cooldownMs) {
    const remaining = cooldownMs - elapsed;
    const mins = Math.ceil(remaining / 60000);
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    const timeStr = hours > 0 ? `${hours}h ${remainingMins}m` : `${mins}m`;
    return { canRun: false, reason: `You're still recovering from your last dungeon run! Try again in **${timeStr}**.` };
  }

  return { canRun: true };
}

function recordDungeonCooldown(guildId, userId) {
  if (!db) return;

  db.run(`INSERT OR REPLACE INTO dungeon_tracker (guild_id, user_id, last_dungeon_time) VALUES (?, ?, ?)`,
    [guildId, userId, Date.now()]);
  saveDatabase();
}

// ==================== HISTORY ====================

function recordDungeonRun(guildId, userId, floorsCleared, maxFloor, goldEarned, result) {
  if (!db) return;

  db.run(`INSERT INTO dungeon_history (guild_id, user_id, floors_cleared, max_floor, gold_earned, result, run_time) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [guildId, userId, floorsCleared, maxFloor, goldEarned, result, Date.now()]);
  saveDatabase();
}

function getDungeonStats(guildId, userId) {
  if (!db) return { totalRuns: 0, totalFloorsCleared: 0, totalGoldEarned: 0, bestFloor: 0, escapes: 0, deaths: 0, clears: 0 };

  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total_runs,
      COALESCE(SUM(floors_cleared), 0) as total_floors,
      COALESCE(SUM(gold_earned), 0) as total_gold,
      COALESCE(MAX(floors_cleared), 0) as best_floor,
      COALESCE(SUM(CASE WHEN result = 'escaped' THEN 1 ELSE 0 END), 0) as escapes,
      COALESCE(SUM(CASE WHEN result = 'died' THEN 1 ELSE 0 END), 0) as deaths,
      COALESCE(SUM(CASE WHEN result = 'cleared' THEN 1 ELSE 0 END), 0) as clears
    FROM dungeon_history 
    WHERE guild_id = ? AND user_id = ?
  `);
  stmt.bind([guildId, userId]);

  if (!stmt.step()) {
    stmt.free();
    return { totalRuns: 0, totalFloorsCleared: 0, totalGoldEarned: 0, bestFloor: 0, escapes: 0, deaths: 0, clears: 0 };
  }

  const row = stmt.getAsObject();
  stmt.free();
  return {
    totalRuns: row.total_runs,
    totalFloorsCleared: row.total_floors,
    totalGoldEarned: row.total_gold,
    bestFloor: row.best_floor,
    escapes: row.escapes,
    deaths: row.deaths,
    clears: row.clears
  };
}

// ==================== ENEMY GENERATION ====================

function generateEnemy(floor, settings) {
  // Pick a random enemy type, with later types more likely on higher floors
  const pool = ENEMY_TYPES.slice(0, Math.min(ENEMY_TYPES.length, 5 + floor * 2));
  const enemy = pool[Math.floor(Math.random() * pool.length)];

  const hp = settings.baseEnemyHp + (floor - 1) * settings.enemyHpPerFloor;

  return {
    ...enemy,
    hp,
    maxHp: hp,
    floor
  };
}

function getEnemyMove(enemy, restoreCooldown = 0) {
  const { exploit, corrupt, isolate, spam, override } = enemy.bias;
  // Enemy also has a small chance to use restore (not in bias — fixed 8% weight)
  const restoreWeight = 8;
  const moves = [
    { name: 'exploit', weight: exploit },
    { name: 'corrupt', weight: corrupt },
    { name: 'isolate', weight: isolate },
    { name: 'spam', weight: spam },
    { name: 'override', weight: override }
  ];

  if (restoreCooldown <= 0) {
    moves.push({ name: 'restore', weight: restoreWeight });
  }

  const total = moves.reduce((sum, m) => sum + m.weight, 0);
  let roll = Math.random() * total;

  for (const m of moves) {
    roll -= m.weight;
    if (roll <= 0) return m.name;
  }
  return moves[0].name;
}

// Display names for moves
const MOVE_NAMES = {
  exploit: 'EXPLOIT',
  corrupt: 'CORRUPT',
  isolate: 'ISOLATE',
  spam: 'SPAM',
  override: 'OVERRIDE',
  restore: 'RESTORE'
};

// ==================== COMBAT RESOLUTION ====================

function resolveRound(playerMove, enemyMove) {
  const interaction = MOVE_MATRIX[playerMove][enemyMove];
  const pName = MOVE_NAMES[playerMove];
  const eName = MOVE_NAMES[enemyMove];

  if (interaction.winner === 'none') {
    return {
      playerDamage: 0, enemyDamage: 0, playerHeal: 0, enemyHeal: 0,
      description: `Both used **${pName}** — no effect!`
    };
  }

  if (interaction.winner === 'stalemate') {
    return {
      playerDamage: 0, enemyDamage: 0,
      playerHeal: interaction.heal, enemyHeal: interaction.heal,
      description: `Both heal! Each recovers **${interaction.heal}%** health!`
    };
  }

  if (interaction.winner === 'both') {
    // One attacked, one healed
    const playerAttacked = playerMove !== 'restore';
    if (playerAttacked) {
      return {
        playerDamage: 0,
        enemyDamage: interaction.attackerDamage,
        playerHeal: 0,
        enemyHeal: interaction.defenderHeal,
        description: `Your **${pName}** hits for **${interaction.attackerDamage}%**! Enemy heals **${interaction.defenderHeal}%**.`
      };
    } else {
      return {
        playerDamage: interaction.defenderDamage,
        enemyDamage: 0,
        playerHeal: interaction.attackerHeal,
        enemyHeal: 0,
        description: `Enemy's **${eName}** hits for **${interaction.defenderDamage}%**! You heal **${interaction.attackerHeal}%**.`
      };
    }
  }

  if (interaction.winner === 'attacker') {
    return {
      playerDamage: 0, enemyDamage: interaction.damage, playerHeal: 0, enemyHeal: 0,
      description: `Your **${pName}** beats ${eName}! Enemy takes **${interaction.damage}%** damage!`
    };
  }

  if (interaction.winner === 'defender') {
    return {
      playerDamage: interaction.damage, enemyDamage: 0, playerHeal: 0, enemyHeal: 0,
      description: `Enemy's **${eName}** beats ${pName}! You take **${interaction.damage}%** damage!`
    };
  }

  return { playerDamage: 0, enemyDamage: 0, playerHeal: 0, enemyHeal: 0, description: 'Nothing happened...' };
}

// ==================== FLOOR REWARDS ====================

function calculateFloorReward(floor, settings) {
  return settings.baseReward + (floor - 1) * settings.rewardPerFloor;
}

function calculateTotalReward(floorsCleared, settings) {
  let total = 0;
  for (let i = 1; i <= floorsCleared; i++) {
    total += calculateFloorReward(i, settings);
  }
  return total;
}

// ==================== HEALTH BAR ====================

function createHealthBar(hp, maxHp = 100, length = 10) {
  const clamped = Math.max(0, Math.min(hp, maxHp));
  const filledCount = Math.round((clamped / maxHp) * length);
  const emptyCount = length - filledCount;

  let color;
  const pct = (clamped / maxHp) * 100;
  if (pct > 60) color = '🟩';
  else if (pct > 30) color = '🟨';
  else color = '🟥';

  return color.repeat(filledCount) + '⬛'.repeat(emptyCount);
}

// ==================== ACTIVE RUN MANAGEMENT ====================

function getActiveRun(guildId, userId) {
  return activeRuns.get(`${guildId}-${userId}`) || null;
}

function setActiveRun(guildId, userId, runState) {
  activeRuns.set(`${guildId}-${userId}`, runState);
}

function clearActiveRun(guildId, userId) {
  activeRuns.delete(`${guildId}-${userId}`);
}

function isInDungeon(guildId, userId) {
  return activeRuns.has(`${guildId}-${userId}`);
}

module.exports = {
  initDungeon,
  getDungeonSettings,
  updateDungeonSettings,
  canRunDungeon,
  recordDungeonCooldown,
  recordDungeonRun,
  getDungeonStats,
  generateEnemy,
  getEnemyMove,
  resolveRound,
  calculateFloorReward,
  calculateTotalReward,
  createHealthBar,
  getActiveRun,
  setActiveRun,
  clearActiveRun,
  isInDungeon,
  ENEMY_TYPES,
  FLOOR_INTROS,
  DAMAGE
};
