// Pet System — Core Module
// Handles species, shop, adoption, care, growth, bonuses, and kennel

const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
const { migrateAddColumn, saveDatabase } = require('./database');
const { TTLCache } = require('./cache');

let db = null;

// ============ SPECIES DEFINITIONS ============
const SPECIES = {
  cat:     { name: 'Cat',     emoji: '🐱', type: 'shop',   baseCost: 50000,   variants: 5, specialties: { work: 5.0 } },
  dog:     { name: 'Dog',     emoji: '🐶', type: 'shop',   baseCost: 50000,   variants: 5, specialties: { rob_defense: 1.0 } },
  bird:    { name: 'Bird',    emoji: '🐦', type: 'shop',   baseCost: 50000,   variants: 5, specialties: { rob_offense: 1.0 } },
  spider:  { name: 'Spider',  emoji: '🕷️', type: 'shop',   baseCost: 50000,   variants: 4, specialties: { vault: 1.0 } },
  bear:    { name: 'Bear',    emoji: '🐻', type: 'shop',   baseCost: 50000,   variants: 4, specialties: { property: 1.0 } },
  panda:   { name: 'Panda',   emoji: '🐼', type: 'shop',   baseCost: 50000,   variants: 2, specialties: { gambling: 1.0 } },
  wolf:    { name: 'Wolf',    emoji: '🐺', type: 'exotic',  baseCost: 0,       variants: 5, specialties: { rob_defense: 1.0, rob_offense: 1.0 } },
  dragon:  { name: 'Dragon',  emoji: '🐉', type: 'exotic',  baseCost: 0,       variants: 5, specialties: { vault: 1.0, gambling: 1.0 } },
  alien:   { name: 'Alien',   emoji: '👽', type: 'exotic',  baseCost: 0,       variants: 1, specialties: { work: 5.0, property: 1.0 } },
  unicorn: { name: 'Unicorn', emoji: '🦄', type: 'exotic',  baseCost: 0,       variants: 5, specialties: { work: 2.0, rob_defense: 0.4, rob_offense: 0.4, vault: 0.4, property: 0.4, gambling: 0.4 } },
};

const SHOP_SPECIES = ['cat', 'dog', 'bird', 'spider', 'bear', 'panda'];

// ============ RARITY DEFINITIONS ============
const RARITIES = {
  common:    { name: 'Common',    emoji: '⚪', multiplier: 1.0, priceTier: 1, color: 0x95a5a6 },
  uncommon:  { name: 'Uncommon',  emoji: '🟢', multiplier: 1.3, priceTier: 2, color: 0x2ecc71 },
  rare:      { name: 'Rare',      emoji: '🔵', multiplier: 1.6, priceTier: 3, color: 0x3498db },
  epic:      { name: 'Epic',      emoji: '🟣', multiplier: 2.0, priceTier: 4, color: 0x9b59b6 },
  legendary: { name: 'Legendary', emoji: '🟡', multiplier: 2.5, priceTier: 5, color: 0xf39c12 },
};

// Shop rarity weights (only common/uncommon/rare in shop)
const SHOP_RARITY_WEIGHTS = [
  { rarity: 'common',   weight: 80 },
  { rarity: 'uncommon', weight: 15 },
  { rarity: 'rare',     weight: 5 },
];
const SHOP_MAX_RARES = 2;

// ============ GROWTH PHASES ============
const PHASES = {
  baby:     { name: 'Baby',     emoji: '💒', minLevel: 1,  maxLevel: 10,  bonusMult: 0,    canPlay: true,  canTrain: false, canBreed: false },
  juvenile: { name: 'Juvenile', emoji: '🌱', minLevel: 11, maxLevel: 25,  bonusMult: 0,    canPlay: true,  canTrain: true,  canBreed: false },
  adult:    { name: 'Adult',    emoji: '⭐', minLevel: 26, maxLevel: 40,  bonusMult: 1.0,  canPlay: true,  canTrain: true,  canBreed: true  },
  elder:    { name: 'Elder',    emoji: '👑', minLevel: 41, maxLevel: 50,  bonusMult: 1.25, canPlay: true,  canTrain: true,  canBreed: true  },
};

// ============ FOOD TYPES ============
const FOOD_TYPES = {
  basic:   { name: 'Basic Food',   emoji: '🍖', costMult: 1.0,  hunger: 10, happiness: 0  },
  premium: { name: 'Premium Food', emoji: '🥩', costMult: 4.0,  hunger: 20, happiness: 5  },
  treat:   { name: 'Treat',        emoji: '🍰', costMult: 2.0,  hunger: 2,  happiness: 8  },
};

// ============ BREEDING SYSTEM ============
const BREEDING_FEES = {
  common:    75000,
  uncommon:  100000,
  rare:      200000,
  epic:      500000,
  legendary: 1000000,
};

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Breeding rarity table: [parentA][parentB] = { common: %, uncommon: %, ... }
const BREEDING_RARITY_TABLE = {
  'common-common':       { common: 85, uncommon: 14, rare: 1, epic: 0, legendary: 0 },
  'common-uncommon':     { common: 45, uncommon: 50, rare: 5, epic: 0, legendary: 0 },
  'common-rare':         { common: 25, uncommon: 55, rare: 19, epic: 1, legendary: 0 },
  'common-epic':         { common: 15, uncommon: 40, rare: 40, epic: 5, legendary: 0 },
  'common-legendary':    { common: 10, uncommon: 30, rare: 40, epic: 19, legendary: 1 },
  'uncommon-uncommon':   { common: 5, uncommon: 80, rare: 14, epic: 1, legendary: 0 },
  'uncommon-rare':       { common: 0, uncommon: 45, rare: 50, epic: 5, legendary: 0 },
  'uncommon-epic':       { common: 0, uncommon: 25, rare: 55, epic: 19, legendary: 1 },
  'uncommon-legendary':  { common: 0, uncommon: 15, rare: 40, epic: 40, legendary: 5 },
  'rare-rare':           { common: 0, uncommon: 5, rare: 80, epic: 14, legendary: 1 },
  'rare-epic':           { common: 0, uncommon: 0, rare: 45, epic: 50, legendary: 5 },
  'rare-legendary':      { common: 0, uncommon: 0, rare: 25, epic: 55, legendary: 20 },
  'epic-epic':           { common: 0, uncommon: 0, rare: 5, epic: 80, legendary: 15 },
  'epic-legendary':      { common: 0, uncommon: 0, rare: 0, epic: 45, legendary: 55 },
  'legendary-legendary': { common: 0, uncommon: 0, rare: 0, epic: 5, legendary: 95 },
};

const BREEDING_SHINY_CHANCES = {
  none: 0.01,   // Neither parent shiny
  one: 0.05,    // One parent shiny
  both: 0.15,   // Both parents shiny
};

// ============ PET IMAGES ============
const PET_IMAGES_DIR = path.join(__dirname, 'assets', 'pets');
const PHASE_NAMES = ['baby', 'juvenile', 'adult', 'elder'];
const ALL_SPECIES = Object.keys(SPECIES);

function getPetImagePath(species, phaseName, variant = 1) {
  const file = `${species}_${phaseName}_${variant}.png`;
  const filePath = path.join(PET_IMAGES_DIR, file);
  if (fs.existsSync(filePath)) return { filePath, fileName: file };
  return null;
}

// Shiny holographic foil overlay cache
const shinyCache = new Map();
const SHINY_CACHE_TTL = 3600000; // 1 hour

async function applyShinyOverlay(imagePath) {
  // Check cache
  const cached = shinyCache.get(imagePath);
  if (cached && Date.now() - cached.time < SHINY_CACHE_TTL) return cached.buffer;

  const img = await loadImage(imagePath);
  const w = img.width;
  const h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Draw original image
  ctx.drawImage(img, 0, 0, w, h);

  // --- Layer 1: Diagonal rainbow gradient (overlay blend) ---
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.45;
  const rainbow = ctx.createLinearGradient(0, 0, w, h);
  rainbow.addColorStop(0.00, '#ff0000');
  rainbow.addColorStop(0.12, '#ff8800');
  rainbow.addColorStop(0.25, '#ffff00');
  rainbow.addColorStop(0.38, '#00ff00');
  rainbow.addColorStop(0.50, '#00ffcc');
  rainbow.addColorStop(0.62, '#0088ff');
  rainbow.addColorStop(0.75, '#4400ff');
  rainbow.addColorStop(0.88, '#ff00ff');
  rainbow.addColorStop(1.00, '#ff0044');
  ctx.fillStyle = rainbow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // --- Layer 2: Secondary shimmer bands (soft-light) ---
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.32;
  const shimmer = ctx.createLinearGradient(w, 0, 0, h);
  shimmer.addColorStop(0.0, 'rgba(255,255,255,0.0)');
  shimmer.addColorStop(0.2, 'rgba(255,255,255,0.9)');
  shimmer.addColorStop(0.3, 'rgba(255,255,255,0.0)');
  shimmer.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  shimmer.addColorStop(0.65, 'rgba(255,255,255,0.8)');
  shimmer.addColorStop(0.75, 'rgba(255,255,255,0.0)');
  shimmer.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // --- Layer 3: Screen highlight streak ---
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.20;
  const streak = ctx.createLinearGradient(w * 0.2, 0, w * 0.8, h);
  streak.addColorStop(0.0, 'rgba(255,200,255,0.0)');
  streak.addColorStop(0.35, 'rgba(200,255,255,0.6)');
  streak.addColorStop(0.5, 'rgba(255,255,200,0.8)');
  streak.addColorStop(0.65, 'rgba(200,200,255,0.6)');
  streak.addColorStop(1.0, 'rgba(255,200,255,0.0)');
  ctx.fillStyle = streak;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // --- Layer 4: Sparkle dots ---
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // Seed sparkle positions deterministically from image path so they're consistent
  let seed = 0;
  for (let i = 0; i < imagePath.length; i++) seed = ((seed << 5) - seed + imagePath.charCodeAt(i)) | 0;
  const pseudoRandom = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed & 0x7fffffff) / 2147483647; };

  const sparkleCount = 18;
  for (let i = 0; i < sparkleCount; i++) {
    const sx = pseudoRandom() * w;
    const sy = pseudoRandom() * h;
    const size = 1.5 + pseudoRandom() * 3;
    const alpha = 0.4 + pseudoRandom() * 0.5;

    // 4-pointed star sparkle
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    // Vertical line
    ctx.moveTo(sx, sy - size * 2);
    ctx.lineTo(sx + size * 0.3, sy);
    ctx.lineTo(sx, sy + size * 2);
    ctx.lineTo(sx - size * 0.3, sy);
    ctx.closePath();
    ctx.fill();
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(sx - size * 2, sy);
    ctx.lineTo(sx, sy - size * 0.3);
    ctx.lineTo(sx + size * 2, sy);
    ctx.lineTo(sx, sy + size * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // --- Layer 5: Gold border glow ---
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  const borderWidth = 4;
  // Outer glow
  ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
  ctx.lineWidth = borderWidth;
  ctx.strokeRect(borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth);
  // Inner bright edge
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 255, 200, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(borderWidth + 1, borderWidth + 1, w - (borderWidth + 1) * 2, h - (borderWidth + 1) * 2);
  ctx.restore();

  const buffer = canvas.toBuffer('image/png');
  shinyCache.set(imagePath, { buffer, time: Date.now() });
  return buffer;
}

/**
 * Get pet image data for display. Returns { data, fileName, isBuffer } 
 * - For normal pets: data = filePath, isBuffer = false
 * - For shiny pets: data = PNG buffer with holographic overlay, isBuffer = true
 */
async function getPetImage(species, phaseName, variant = 1, shiny = false) {
  const imageInfo = getPetImagePath(species, phaseName, variant);
  if (!imageInfo) return null;

  if (!shiny) {
    return { data: imageInfo.filePath, fileName: imageInfo.fileName, isBuffer: false };
  }

  try {
    const buffer = await applyShinyOverlay(imageInfo.filePath);
    const shinyFileName = `shiny_${imageInfo.fileName}`;
    return { data: buffer, fileName: shinyFileName, isBuffer: true };
  } catch (e) {
    console.error('Error applying shiny overlay:', e);
    return { data: imageInfo.filePath, fileName: imageInfo.fileName, isBuffer: false };
  }
}

// ============ PLAY/TRAIN MESSAGES ============
const PLAY_MESSAGES = {
  cat:     ['played with a ball of yarn 🧶', 'chased a laser pointer around the room', 'knocked things off the table for fun', 'hid in a cardboard box 📦'],
  dog:     ['played fetch in the park 🎾', 'went for a walk around the block 🦮', 'rolled around in the grass', 'did zoomies around the yard'],
  bird:    ['flew laps around the room 🪶', 'sang a catchy tune 🎵', 'played with a shiny bell', 'learned to mimic a new sound'],
  spider:  ['spun an impressive web 🕸️', 'played hide and seek in the corners', 'practiced jumping between surfaces', 'caught a fly mid-air 🪰'],
  bear:    ['splashed in a stream 💦', 'rolled a big boulder around', 'climbed a tree and got stuck', 'played with a beehive 🍯'],
  panda:   ['tumbled down a hill 🎋', 'ate bamboo while doing somersaults', 'played peekaboo behind a bush', 'rolled around like a fluffy ball'],
  wolf:    ['howled at the moon 🌙', 'played tug-of-war with a rope', 'practiced stalking through tall grass', 'chased its own shadow'],
  dragon:  ['practiced fire breathing 🔥', 'flew in circles above the clouds ☁️', 'played with a pile of gold coins', 'toasted marshmallows with its breath'],
  alien:   ['rearranged crop circles 🛸', 'tried to understand human memes', 'beamed up random objects', 'communicated through telepathy 🧠'],
  unicorn: ['galloped through a rainbow 🌈', 'made flowers bloom wherever it stepped 🌸', 'sparkled extra bright ✨', 'granted a small wish'],
};

const TRAIN_MESSAGES = {
  cat:     ['practiced stealth techniques 🐱‍👤', 'trained balance on narrow ledges', 'sharpened its reaction time', 'mastered the art of silent landing'],
  dog:     ['practiced guarding drills 🛡️', 'trained scent tracking', 'worked on obedience commands', 'practiced defensive stance'],
  bird:    ['practiced aerial maneuvers ✈️', 'trained precision diving', 'worked on speed flying', 'rehearsed distraction tactics'],
  spider:  ['practiced web construction patterns', 'trained ambush techniques 🕷️', 'worked on venom accuracy', 'studied trap engineering'],
  bear:    ['practiced heavy lifting 🏋️', 'trained fortification techniques', 'worked on intimidation skills', 'studied structural analysis'],
  panda:   ['practiced probability theory 🎲', 'trained pattern recognition', 'worked on lucky charm rituals', 'studied game theory'],
  wolf:    ['practiced pack tactics 🐺', 'trained dual-stance fighting', 'worked on pursuit and evasion', 'studied territorial strategy'],
  dragon:  ['practiced treasure hoarding 💎', 'trained financial intuition', 'worked on elemental control', 'studied ancient wealth magic'],
  alien:   ['practiced time-space optimization ⏳', 'trained multi-dimensional thinking', 'worked on resource analysis', 'studied efficiency algorithms'],
  unicorn: ['practiced channeling pure energy ✨', 'trained harmonious balance', 'worked on universal attunement', 'studied the nature of all things'],
};

// ============ DEFAULT SETTINGS ============
const DEFAULT_SETTINGS = {
  enabled: false,
  shopRestockInterval: 43200,   // 12 hours in seconds
  baseFoodCost: 2000,
  renameCost: 25000,
  playCooldown: 7200,           // 2 hours in seconds
  trainCooldown: 7200,          // 2 hours in seconds
  hungerDecayPerDay: 60,
  happinessDecayPerDay: 48,
  feedHungerRestore: 30,
  playHappinessGain: 15,
  trainHappinessGain: 8,
  playXp: 50,
  trainXp: 80,
  baseBonusPercent: 5.0,
  shinyChance: 0.01,
  shinyBonusMultiplier: 1.1,
  eggMysteryPrice: 250000,
  eggGoldenPrice: 1000000,
  eggPrismaticPrice: 5000000,
  kennelPrices: [2500000, 7500000, 10000000],
  basePetSlots: 2,
  // Breeding settings
  breedingEnabled: true,
  breedingFeeCommon: 75000,
  breedingFeeUncommon: 100000,
  breedingFeeRare: 200000,
  breedingFeeEpic: 500000,
  breedingFeeLegendary: 1000000,
  breedingExoticMultiplier: 3.0,
  breedingCooldownHours: 72,       // 3 days default
  gestationHours: 24,
  breedingShinyNone: 0.01,
  breedingShinyOne: 0.05,
  breedingShinyBoth: 0.15,
  maxStudFee: 0,                   // 0 = unlimited
  // Transfer settings
  transferEnabled: true,
  transferMinHappiness: 80,
  transferHappinessPenalty: 50,
};

// Settings cache
const settingsCache = new TTLCache();

// Shop stock cache (guildId -> { stock, restockTime })
const shopCache = new Map();

// ============ INITIALIZATION ============
function initPets(database) {
  db = database;

  db.run(`
    CREATE TABLE IF NOT EXISTS pet_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      shop_restock_interval INTEGER DEFAULT 43200,
      base_food_cost INTEGER DEFAULT 2000,
      rename_cost INTEGER DEFAULT 25000,
      play_cooldown INTEGER DEFAULT 7200,
      train_cooldown INTEGER DEFAULT 7200,
      hunger_decay_per_day INTEGER DEFAULT 60,
      happiness_decay_per_day INTEGER DEFAULT 48,
      feed_hunger_restore INTEGER DEFAULT 30,
      play_happiness_gain INTEGER DEFAULT 15,
      train_happiness_gain INTEGER DEFAULT 8,
      play_xp INTEGER DEFAULT 50,
      train_xp INTEGER DEFAULT 80,
      base_bonus_percent REAL DEFAULT 5.0,
      shiny_chance REAL DEFAULT 0.01,
      shiny_bonus_multiplier REAL DEFAULT 1.1,
      egg_mystery_price INTEGER DEFAULT 250000,
      egg_golden_price INTEGER DEFAULT 1000000,
      egg_prismatic_price INTEGER DEFAULT 5000000,
      kennel_l1_price INTEGER DEFAULT 2500000,
      kennel_l2_price INTEGER DEFAULT 7500000,
      kennel_l3_price INTEGER DEFAULT 10000000,
      base_pet_slots INTEGER DEFAULT 2
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      species TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      sex TEXT NOT NULL,
      shiny INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      hunger INTEGER DEFAULT 100,
      happiness INTEGER DEFAULT 100,
      last_decay_time INTEGER NOT NULL,
      last_fed INTEGER,
      last_played INTEGER,
      last_trained INTEGER,
      born_at INTEGER NOT NULL,
      source TEXT DEFAULT 'shop',
      is_active INTEGER DEFAULT 0,
      bond_streak INTEGER DEFAULT 0,
      last_care_day INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pet_shop (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      species TEXT NOT NULL,
      rarity TEXT NOT NULL,
      sex TEXT NOT NULL,
      shiny INTEGER DEFAULT 0,
      price INTEGER NOT NULL,
      slot_number INTEGER NOT NULL,
      stocked_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pet_kennel (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      level INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS eggs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      egg_type TEXT NOT NULL,
      purchased_at INTEGER NOT NULL,
      hatch_time INTEGER NOT NULL,
      warm_count INTEGER DEFAULT 0,
      last_warm_time INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS egg_pity (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      eggs_without_epic INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS breeding_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      requester_pet_id INTEGER NOT NULL,
      partner_id TEXT NOT NULL,
      partner_pet_id INTEGER NOT NULL,
      stud_fee INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS trade_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      requester_pet_id INTEGER NOT NULL,
      partner_id TEXT NOT NULL,
      partner_pet_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_pets_owner ON pets(guild_id, owner_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pet_shop_guild ON pet_shop(guild_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_eggs_owner ON eggs(guild_id, owner_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_breeding_requests_guild ON breeding_requests(guild_id)`);

  // Runaway pets: stash full pet snapshot when they run away so user can recover
  db.run(`
    CREATE TABLE IF NOT EXISTS pet_runaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      pet_name TEXT NOT NULL,
      species TEXT NOT NULL,
      ran_away_at INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pet_runaways_owner ON pet_runaways(guild_id, owner_id)`);
  // Recovery window: 0 = not yet surfaced to user; timer starts on first listing
  migrateAddColumn(db, 'pet_runaways', 'recovery_expires_at INTEGER DEFAULT 0');

  // Per-user runaway recovery counter — drives doubling cost
  db.run(`
    CREATE TABLE IF NOT EXISTS pet_runaway_recoveries (
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      recovery_count INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, owner_id)
    )
  `);

  // Migration: add is_active column
  migrateAddColumn(db, 'pets', 'is_active INTEGER DEFAULT 0');
  // Migration: add bond columns
  migrateAddColumn(db, 'pets', 'bond_streak INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pets', 'last_care_day INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pets', 'variant INTEGER DEFAULT 1');
  migrateAddColumn(db, 'pet_settings', 'kennel_prices TEXT');

  // Migration: add breeding columns
  migrateAddColumn(db, 'pets', 'gestating INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pets', 'gestation_end INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pets', 'breeding_cooldown_end INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pets', 'gestating_for_user TEXT');
  migrateAddColumn(db, 'pets', 'gestating_male_id INTEGER'); // Track the father during gestation
  // Migration: add lineage columns
  migrateAddColumn(db, 'pets', 'mother_id INTEGER'); // NULL if adopted/hatched
  migrateAddColumn(db, 'pets', 'father_id INTEGER'); // NULL if adopted/hatched
  migrateAddColumn(db, 'pets', 'mother_name TEXT'); // Stored at birth so it persists even if parent is deleted
  migrateAddColumn(db, 'pets', 'father_name TEXT'); // Stored at birth so it persists even if parent is deleted
  // Grandparent names - stored at birth for full lineage persistence
  migrateAddColumn(db, 'pets', 'maternal_grandmother_name TEXT'); // Mother's mother
  migrateAddColumn(db, 'pets', 'maternal_grandfather_name TEXT'); // Mother's father
  migrateAddColumn(db, 'pets', 'paternal_grandmother_name TEXT'); // Father's mother
  migrateAddColumn(db, 'pets', 'paternal_grandfather_name TEXT'); // Father's father
  // Migration: add breeding settings columns
  migrateAddColumn(db, 'pet_settings', 'breeding_enabled INTEGER DEFAULT 1');
  migrateAddColumn(db, 'pet_settings', 'breeding_fee_common INTEGER DEFAULT 75000');
  migrateAddColumn(db, 'pet_settings', 'breeding_fee_uncommon INTEGER DEFAULT 100000');
  migrateAddColumn(db, 'pet_settings', 'breeding_fee_rare INTEGER DEFAULT 200000');
  migrateAddColumn(db, 'pet_settings', 'breeding_fee_epic INTEGER DEFAULT 500000');
  migrateAddColumn(db, 'pet_settings', 'breeding_fee_legendary INTEGER DEFAULT 1000000');
  migrateAddColumn(db, 'pet_settings', 'breeding_exotic_multiplier REAL DEFAULT 3.0');
  migrateAddColumn(db, 'pet_settings', 'breeding_cooldown_hours INTEGER DEFAULT 72');
  migrateAddColumn(db, 'pet_settings', 'gestation_hours INTEGER DEFAULT 24');
  migrateAddColumn(db, 'pet_settings', 'breeding_shiny_none REAL DEFAULT 0.01');
  migrateAddColumn(db, 'pet_settings', 'breeding_shiny_one REAL DEFAULT 0.05');
  migrateAddColumn(db, 'pet_settings', 'breeding_shiny_both REAL DEFAULT 0.15');
  migrateAddColumn(db, 'pet_settings', 'max_stud_fee INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pet_settings', 'transfer_enabled INTEGER DEFAULT 1');
  migrateAddColumn(db, 'pet_settings', 'transfer_min_happiness INTEGER DEFAULT 80');
  migrateAddColumn(db, 'pet_settings', 'transfer_happiness_penalty INTEGER DEFAULT 50');

  saveDatabase();
  console.log('🐾 Pet system initialized');
}

// ============ SETTINGS ============
function getSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached) return cached;

  if (!db) return { ...DEFAULT_SETTINGS };

  const stmt = db.prepare('SELECT * FROM pet_settings WHERE guild_id = ?');
  stmt.bind([guildId]);
  let settings;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    settings = {
      enabled: row.enabled === 1,
      shopRestockInterval: row.shop_restock_interval,
      baseFoodCost: row.base_food_cost,
      renameCost: row.rename_cost,
      playCooldown: row.play_cooldown,
      trainCooldown: row.train_cooldown,
      hungerDecayPerDay: row.hunger_decay_per_day,
      happinessDecayPerDay: row.happiness_decay_per_day,
      feedHungerRestore: row.feed_hunger_restore,
      playHappinessGain: row.play_happiness_gain,
      trainHappinessGain: row.train_happiness_gain,
      playXp: row.play_xp,
      trainXp: row.train_xp,
      baseBonusPercent: row.base_bonus_percent,
      shinyChance: row.shiny_chance,
      shinyBonusMultiplier: row.shiny_bonus_multiplier,
      eggMysteryPrice: row.egg_mystery_price,
      eggGoldenPrice: row.egg_golden_price,
      eggPrismaticPrice: row.egg_prismatic_price,
      kennelPrices: row.kennel_prices ? JSON.parse(row.kennel_prices) : [row.kennel_l1_price, row.kennel_l2_price, row.kennel_l3_price],
      basePetSlots: row.base_pet_slots,
      // Breeding settings
      breedingEnabled: row.breeding_enabled === 1 || row.breeding_enabled === null,
      breedingFeeCommon: row.breeding_fee_common ?? 75000,
      breedingFeeUncommon: row.breeding_fee_uncommon ?? 100000,
      breedingFeeRare: row.breeding_fee_rare ?? 200000,
      breedingFeeEpic: row.breeding_fee_epic ?? 500000,
      breedingFeeLegendary: row.breeding_fee_legendary ?? 1000000,
      breedingExoticMultiplier: row.breeding_exotic_multiplier ?? 3.0,
      breedingCooldownHours: row.breeding_cooldown_hours ?? 72,
      gestationHours: row.gestation_hours ?? 24,
      breedingShinyNone: row.breeding_shiny_none ?? 0.01,
      breedingShinyOne: row.breeding_shiny_one ?? 0.05,
      breedingShinyBoth: row.breeding_shiny_both ?? 0.15,
      maxStudFee: row.max_stud_fee ?? 0,
      // Transfer settings
      transferEnabled: row.transfer_enabled === 1 || row.transfer_enabled === null,
      transferMinHappiness: row.transfer_min_happiness ?? 80,
      transferHappinessPenalty: row.transfer_happiness_penalty ?? 50,
    };
  } else {
    settings = { ...DEFAULT_SETTINGS };
  }
  stmt.free();
  settingsCache.set(guildId, settings, 300000); // 5 min cache
  return settings;
}

function updateSettings(guildId, updates) {
  if (!db) return;

  // Map camelCase to snake_case columns
  const columnMap = {
    enabled: 'enabled',
    shopRestockInterval: 'shop_restock_interval',
    baseFoodCost: 'base_food_cost',
    renameCost: 'rename_cost',
    playCooldown: 'play_cooldown',
    trainCooldown: 'train_cooldown',
    hungerDecayPerDay: 'hunger_decay_per_day',
    happinessDecayPerDay: 'happiness_decay_per_day',
    feedHungerRestore: 'feed_hunger_restore',
    playHappinessGain: 'play_happiness_gain',
    trainHappinessGain: 'train_happiness_gain',
    playXp: 'play_xp',
    trainXp: 'train_xp',
    baseBonusPercent: 'base_bonus_percent',
    shinyChance: 'shiny_chance',
    shinyBonusMultiplier: 'shiny_bonus_multiplier',
    eggMysteryPrice: 'egg_mystery_price',
    eggGoldenPrice: 'egg_golden_price',
    eggPrismaticPrice: 'egg_prismatic_price',
    kennelPrices: 'kennel_prices',
    basePetSlots: 'base_pet_slots',
    // Breeding settings
    breedingEnabled: 'breeding_enabled',
    breedingFeeCommon: 'breeding_fee_common',
    breedingFeeUncommon: 'breeding_fee_uncommon',
    breedingFeeRare: 'breeding_fee_rare',
    breedingFeeEpic: 'breeding_fee_epic',
    breedingFeeLegendary: 'breeding_fee_legendary',
    breedingExoticMultiplier: 'breeding_exotic_multiplier',
    breedingCooldownHours: 'breeding_cooldown_hours',
    gestationHours: 'gestation_hours',
    breedingShinyNone: 'breeding_shiny_none',
    breedingShinyOne: 'breeding_shiny_one',
    breedingShinyBoth: 'breeding_shiny_both',
    maxStudFee: 'max_stud_fee',
    // Transfer settings
    transferEnabled: 'transfer_enabled',
    transferMinHappiness: 'transfer_min_happiness',
    transferHappinessPenalty: 'transfer_happiness_penalty',
  };

  const current = getSettings(guildId);
  const merged = { ...current, ...updates };

  const cols = Object.keys(columnMap);
  const sqlCols = cols.map(k => columnMap[k]).join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map(k => {
    const val = merged[k];
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (Array.isArray(val)) return JSON.stringify(val);
    return val;
  });

  db.run(
    `INSERT OR REPLACE INTO pet_settings (guild_id, ${sqlCols}) VALUES (?, ${placeholders})`,
    [guildId, ...values]
  );

  settingsCache.delete(guildId);
  saveDatabase();
}

// ============ PET SHOP ============
function weightedRandom(weights) {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let rand = Math.random() * total;
  for (const entry of weights) {
    rand -= entry.weight;
    if (rand <= 0) return entry.rarity;
  }
  return weights[weights.length - 1].rarity;
}

function generateShopStock(guildId) {
  const settings = getSettings(guildId);
  const now = Date.now();

  // Clear old stock
  db.run('DELETE FROM pet_shop WHERE guild_id = ?', [guildId]);

  const stock = [];
  let rareCount = 0;

  for (let slot = 1; slot <= 18; slot++) {
    const species = SHOP_SPECIES[Math.floor(Math.random() * SHOP_SPECIES.length)];
    let rarity = weightedRandom(SHOP_RARITY_WEIGHTS);

    // Enforce max 2 rares
    if (rarity === 'rare' && rareCount >= SHOP_MAX_RARES) {
      rarity = Math.random() < 0.7 ? 'common' : 'uncommon';
    }
    if (rarity === 'rare') rareCount++;

    const sex = Math.random() < 0.5 ? 'M' : 'F';
    const shiny = Math.random() < settings.shinyChance ? 1 : 0;
    const speciesData = SPECIES[species];
    const rarityData = RARITIES[rarity];
    const price = speciesData.baseCost * rarityData.priceTier;

    db.run(
      `INSERT INTO pet_shop (guild_id, species, rarity, sex, shiny, price, slot_number, stocked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, species, rarity, sex, shiny, price, slot, now]
    );

    stock.push({ species, rarity, sex, shiny, price, slot_number: slot, stocked_at: now });
  }

  // Update cache
  shopCache.set(guildId, { stock: null, restockTime: now + (settings.shopRestockInterval * 1000) });
  saveDatabase();
  return stock;
}

function getShopStock(guildId) {
  if (!db) return [];

  const settings = getSettings(guildId);
  const cache = shopCache.get(guildId);
  const now = Date.now();

  // Check if restock is needed
  let needsRestock = false;
  if (!cache) {
    // Check DB for existing stock
    const stmt = db.prepare('SELECT stocked_at FROM pet_shop WHERE guild_id = ? LIMIT 1');
    stmt.bind([guildId]);
    if (stmt.step()) {
      const stockedAt = stmt.getAsObject().stocked_at;
      const elapsed = now - stockedAt;
      if (elapsed >= settings.shopRestockInterval * 1000) {
        needsRestock = true;
      } else {
        shopCache.set(guildId, { stock: null, restockTime: stockedAt + (settings.shopRestockInterval * 1000) });
      }
    } else {
      needsRestock = true;
    }
    stmt.free();
  } else if (now >= cache.restockTime) {
    needsRestock = true;
  }

  if (needsRestock) {
    generateShopStock(guildId);
  }

  // Fetch from DB
  const stmt = db.prepare('SELECT * FROM pet_shop WHERE guild_id = ? ORDER BY slot_number');
  stmt.bind([guildId]);
  const stock = [];
  while (stmt.step()) {
    stock.push(stmt.getAsObject());
  }
  stmt.free();

  // Sort by species order, then rarity tier
  const speciesOrder = SHOP_SPECIES.reduce((m, s, i) => { m[s] = i; return m; }, {});
  const rarityOrder = Object.keys(RARITIES).reduce((m, r, i) => { m[r] = i; return m; }, {});
  stock.sort((a, b) => (speciesOrder[a.species] ?? 99) - (speciesOrder[b.species] ?? 99) || (rarityOrder[a.rarity] ?? 99) - (rarityOrder[b.rarity] ?? 99));

  return stock;
}

function getShopRestockTime(guildId) {
  const cache = shopCache.get(guildId);
  if (cache) return cache.restockTime;

  const stmt = db.prepare('SELECT stocked_at FROM pet_shop WHERE guild_id = ? LIMIT 1');
  stmt.bind([guildId]);
  if (stmt.step()) {
    const stockedAt = stmt.getAsObject().stocked_at;
    const settings = getSettings(guildId);
    stmt.free();
    return stockedAt + (settings.shopRestockInterval * 1000);
  }
  stmt.free();
  return Date.now();
}

function removeShopSlot(guildId, slotNumber) {
  if (!db) return;
  db.run('DELETE FROM pet_shop WHERE guild_id = ? AND slot_number = ?', [guildId, slotNumber]);
  shopCache.delete(guildId); // Invalidate cache
}

// ============ PET CRUD ============
function adoptPet(guildId, userId, species, name, rarity, sex, shiny, source = 'shop', forcedVariant = null, lineage = null) {
  if (!db) return null;
  const now = Date.now();
  const speciesData = SPECIES[species];
  const variant = forcedVariant || Math.ceil(Math.random() * (speciesData?.variants || 1));

  // Lineage contains: motherId, fatherId, motherName, fatherName, and grandparent names
  const lin = lineage || {};

  db.run(
    `INSERT INTO pets (guild_id, owner_id, species, name, rarity, sex, shiny, level, xp, hunger, happiness, last_decay_time, born_at, source, variant, mother_id, father_id, mother_name, father_name, maternal_grandmother_name, maternal_grandfather_name, paternal_grandmother_name, paternal_grandfather_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 100, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, userId, species, name, rarity, sex, shiny, now, now, source, variant,
     lin.motherId || null, lin.fatherId || null,
     lin.motherName || null, lin.fatherName || null,
     lin.maternalGrandmotherName || null, lin.maternalGrandfatherName || null,
     lin.paternalGrandmotherName || null, lin.paternalGrandfatherName || null]
  );

  // Get the inserted pet
  const stmt = db.prepare('SELECT * FROM pets WHERE guild_id = ? AND owner_id = ? ORDER BY id DESC LIMIT 1');
  stmt.bind([guildId, userId]);
  let pet = null;
  if (stmt.step()) {
    pet = stmt.getAsObject();
  }
  stmt.free();

  // Auto-set as active if user has no active pet
  if (pet && !getActivePet(guildId, userId)) {
    setActivePet(guildId, userId, pet.id);
    pet.is_active = 1;
  }

  saveDatabase();
  return pet;
}

function getPet(petId) {
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM pets WHERE id = ?');
  stmt.bind([petId]);
  let pet = null;
  if (stmt.step()) {
    pet = stmt.getAsObject();
  }
  stmt.free();
  return pet;
}

function getUserPets(guildId, userId) {
  if (!db) return [];
  const stmt = db.prepare('SELECT * FROM pets WHERE guild_id = ? AND owner_id = ? ORDER BY id');
  stmt.bind([guildId, userId]);
  const pets = [];
  while (stmt.step()) {
    pets.push(stmt.getAsObject());
  }
  stmt.free();
  return pets;
}

function getUserPetCount(guildId, userId) {
  if (!db) return 0;
  const stmt = db.prepare('SELECT COUNT(*) as count FROM pets WHERE guild_id = ? AND owner_id = ?');
  stmt.bind([guildId, userId]);
  let count = 0;
  if (stmt.step()) {
    count = stmt.getAsObject().count;
  }
  stmt.free();
  return count;
}

function deletePet(petId) {
  if (!db) return;
  db.run('DELETE FROM pets WHERE id = ?', [petId]);
  saveDatabase();
}

function renamePet(petId, newName) {
  if (!db) return;
  db.run('UPDATE pets SET name = ? WHERE id = ?', [newName, petId]);
  saveDatabase();
}

function setActivePet(guildId, userId, petId) {
  if (!db) return;
  // Clear any currently active pet for this user
  db.run('UPDATE pets SET is_active = 0 WHERE guild_id = ? AND owner_id = ? AND is_active = 1', [guildId, userId]);
  // Set the new active pet
  db.run('UPDATE pets SET is_active = 1 WHERE id = ? AND guild_id = ? AND owner_id = ?', [petId, guildId, userId]);
  saveDatabase();
}

function clearActivePet(guildId, userId) {
  if (!db) return;
  db.run('UPDATE pets SET is_active = 0 WHERE guild_id = ? AND owner_id = ? AND is_active = 1', [guildId, userId]);
  saveDatabase();
}

function getActivePet(guildId, userId) {
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM pets WHERE guild_id = ? AND owner_id = ? AND is_active = 1 LIMIT 1');
  stmt.bind([guildId, userId]);
  let pet = null;
  if (stmt.step()) {
    pet = stmt.getAsObject();
  }
  stmt.free();
  return pet;
}

// ============ DECAY & EFFECTIVE STATS ============
function getEffectiveStats(pet, settings) {
  if (!settings) settings = getSettings(pet.guild_id);
  const now = Date.now();
  const elapsedDays = (now - pet.last_decay_time) / 86400000;

  const hunger = Math.max(0, Math.round(pet.hunger - elapsedDays * settings.hungerDecayPerDay));
  const happiness = Math.max(0, Math.round(pet.happiness - elapsedDays * settings.happinessDecayPerDay));

  return { hunger, happiness, ranAway: hunger <= 0 };
}

function processDecay(guildId, userId) {
  if (!db) return [];
  const pets = getUserPets(guildId, userId);
  const settings = getSettings(guildId);
  const ranAway = [];
  const now = Date.now();

  for (const pet of pets) {
    const effective = getEffectiveStats(pet, settings);
    if (effective.ranAway) {
      // Snapshot the pet so it can be recovered later
      stashRunaway(pet, now);
      ranAway.push(pet);
      deletePet(pet.id);
    } else {
      // Update stored values to current effective values
      db.run(
        'UPDATE pets SET hunger = ?, happiness = ?, last_decay_time = ? WHERE id = ?',
        [effective.hunger, effective.happiness, now, pet.id]
      );
    }
  }

  if (ranAway.length > 0) saveDatabase();
  return ranAway;
}

// ============ RUNAWAY RECOVERY ============
// Pricing: 1st recovery is free, 2nd is 5,000, doubles each subsequent recovery.
function getRunawayRecoveryCost(count) {
  if (count <= 0) return 0;
  return 5000 * Math.pow(2, count - 1);
}

// Runaway snapshots expire 24h after the user first sees them in the panel.
// recovery_expires_at = 0 means the timer hasn't started yet.
const RUNAWAY_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

function stashRunaway(pet, ranAwayAt) {
  if (!db) return;
  db.run(
    'INSERT INTO pet_runaways (guild_id, owner_id, pet_name, species, ran_away_at, snapshot, recovery_expires_at) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [pet.guild_id, pet.owner_id, pet.name, pet.species, ranAwayAt, JSON.stringify(pet)]
  );
}

// Delete any runaway snapshots whose recovery window has elapsed.
function expireRunaways() {
  if (!db) return 0;
  const now = Date.now();
  db.run('DELETE FROM pet_runaways WHERE recovery_expires_at > 0 AND recovery_expires_at < ?', [now]);
  return now;
}

function getRunawayPets(guildId, userId) {
  if (!db) return [];
  // Drop any that have already expired.
  expireRunaways();
  const now = Date.now();
  const stmt = db.prepare('SELECT id, pet_name, species, ran_away_at, snapshot, recovery_expires_at FROM pet_runaways WHERE guild_id = ? AND owner_id = ? ORDER BY ran_away_at');
  stmt.bind([guildId, userId]);
  const rows = [];
  const newlyStarted = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    let snap = null;
    try { snap = JSON.parse(row.snapshot); } catch (e) { snap = null; }
    let expiresAt = row.recovery_expires_at;
    // First time the user is seeing this runaway — start the 24h timer now.
    if (!expiresAt || expiresAt === 0) {
      expiresAt = now + RUNAWAY_RECOVERY_WINDOW_MS;
      newlyStarted.push({ id: row.id, expiresAt });
    }
    rows.push({ id: row.id, name: row.pet_name, species: row.species, ranAwayAt: row.ran_away_at, recoveryExpiresAt: expiresAt, snapshot: snap });
  }
  stmt.free();

  if (newlyStarted.length > 0) {
    for (const r of newlyStarted) {
      db.run('UPDATE pet_runaways SET recovery_expires_at = ? WHERE id = ?', [r.expiresAt, r.id]);
    }
    saveDatabase();
  }

  return rows;
}

function getRunawayPet(runawayId) {
  if (!db) return null;
  // Clean up first so an expired snapshot isn't accidentally recovered via a stale button.
  expireRunaways();
  const stmt = db.prepare('SELECT id, guild_id, owner_id, pet_name, species, ran_away_at, snapshot, recovery_expires_at FROM pet_runaways WHERE id = ?');
  stmt.bind([runawayId]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  if (!row) return null;
  let snap = null;
  try { snap = JSON.parse(row.snapshot); } catch (e) { return null; }
  return { id: row.id, guildId: row.guild_id, ownerId: row.owner_id, name: row.pet_name, species: row.species, ranAwayAt: row.ran_away_at, recoveryExpiresAt: row.recovery_expires_at, snapshot: snap };
}

function getRunawayRecoveryCount(guildId, userId) {
  if (!db) return 0;
  const stmt = db.prepare('SELECT recovery_count FROM pet_runaway_recoveries WHERE guild_id = ? AND owner_id = ?');
  stmt.bind([guildId, userId]);
  let n = 0;
  if (stmt.step()) n = stmt.getAsObject().recovery_count;
  stmt.free();
  return n;
}

function incrementRunawayRecoveryCount(guildId, userId) {
  if (!db) return;
  db.run(`
    INSERT INTO pet_runaway_recoveries (guild_id, owner_id, recovery_count)
    VALUES (?, ?, 1)
    ON CONFLICT(guild_id, owner_id) DO UPDATE SET recovery_count = recovery_count + 1
  `, [guildId, userId]);
}

// Restore a runaway pet to the user's roster. Returns the new pet row.
function recoverRunaway(runawayId) {
  if (!db) return null;
  const runaway = getRunawayPet(runawayId);
  if (!runaway || !runaway.snapshot) return null;
  const p = runaway.snapshot;
  const now = Date.now();
  // Restore hunger/happiness to a reasonable level so they don't immediately run away again
  const restoredHunger = Math.max(50, p.hunger || 0);
  const restoredHappiness = Math.max(50, p.happiness || 0);

  db.run(
    `INSERT INTO pets (
      guild_id, owner_id, species, name, rarity, sex, shiny, level, xp,
      hunger, happiness, last_decay_time, last_fed, last_played, last_trained,
      born_at, source, is_active, bond_streak, last_care_day, variant,
      gestating, gestation_end, breeding_cooldown_end, gestating_for_user, gestating_male_id,
      mother_id, father_id, mother_name, father_name,
      maternal_grandmother_name, maternal_grandfather_name,
      paternal_grandmother_name, paternal_grandfather_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.guild_id, p.owner_id, p.species, p.name, p.rarity, p.sex, p.shiny || 0, p.level || 1, p.xp || 0,
      restoredHunger, restoredHappiness, now, p.last_fed || null, p.last_played || null, p.last_trained || null,
      p.born_at || now, p.source || 'recovered', p.bond_streak || 0, p.last_care_day || 0, p.variant || 1,
      p.gestating || 0, p.gestation_end || 0, p.breeding_cooldown_end || 0, p.gestating_for_user || null, p.gestating_male_id || null,
      p.mother_id || null, p.father_id || null, p.mother_name || null, p.father_name || null,
      p.maternal_grandmother_name || null, p.maternal_grandfather_name || null,
      p.paternal_grandmother_name || null, p.paternal_grandfather_name || null
    ]
  );

  // Get the newly inserted pet
  const stmt = db.prepare('SELECT * FROM pets WHERE guild_id = ? AND owner_id = ? ORDER BY id DESC LIMIT 1');
  stmt.bind([p.guild_id, p.owner_id]);
  let newPet = null;
  if (stmt.step()) newPet = stmt.getAsObject();
  stmt.free();

  // Remove the runaway entry
  db.run('DELETE FROM pet_runaways WHERE id = ?', [runawayId]);
  saveDatabase();
  return newPet;
}

function deleteRunaway(runawayId) {
  if (!db) return;
  db.run('DELETE FROM pet_runaways WHERE id = ?', [runawayId]);
  saveDatabase();
}


// ============ FEEDING ============
function calculateFoodCost(pet, settings, foodType = 'basic') {
  if (!settings) settings = getSettings(pet.guild_id);
  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const levelFactor = 1 + (pet.level - 1) * 0.03;
  const exoticFactor = speciesData.type === 'exotic' ? 1.5 : 1.0;
  const food = FOOD_TYPES[foodType] || FOOD_TYPES.basic;
  return Math.round(settings.baseFoodCost * food.costMult * levelFactor * rarityData.multiplier * exoticFactor);
}

function feedPet(petId, settings, foodType = 'basic') {
  if (!db) return { success: false, error: 'Database not available' };

  const pet = getPet(petId);
  if (!pet) return { success: false, error: 'Pet not found' };
  if (!settings) settings = getSettings(pet.guild_id);

  const effective = getEffectiveStats(pet, settings);
  if (effective.ranAway) {
    deletePet(petId);
    return { success: false, error: 'ran_away', pet };
  }

  const food = FOOD_TYPES[foodType] || FOOD_TYPES.basic;

  if (effective.hunger >= 100 && effective.happiness >= 100) {
    return { success: false, error: 'not_hungry', pet };
  }
  if (food.hunger > 0 && effective.hunger >= 100 && food.happiness === 0) {
    return { success: false, error: 'not_hungry', pet };
  }
  if (food.happiness > 0 && effective.happiness >= 100 && food.hunger === 0) {
    return { success: false, error: 'already_happy', pet };
  }

  const cost = calculateFoodCost(pet, settings, foodType);
  const newHunger = Math.min(100, effective.hunger + food.hunger);
  const newHappiness = Math.min(100, effective.happiness + food.happiness);
  const now = Date.now();

  const bondStreak = advanceBond(petId, pet);

  db.run(
    'UPDATE pets SET hunger = ?, happiness = ?, last_decay_time = ?, last_fed = ? WHERE id = ?',
    [newHunger, newHappiness, now, now, petId]
  );
  saveDatabase();

  return {
    success: true,
    cost,
    foodType,
    foodName: food.name,
    foodEmoji: food.emoji,
    hungerBefore: effective.hunger,
    hungerAfter: newHunger,
    happinessBefore: effective.happiness,
    happinessAfter: newHappiness,
    bondStreak,
    pet: { ...pet, hunger: newHunger, happiness: newHappiness, last_decay_time: now, last_fed: now, bond_streak: bondStreak },
  };
}

function feedAllPets(guildId, userId, settings) {
  if (!db) return { success: false, error: 'Database not available' };
  if (!settings) settings = getSettings(guildId);

  const pets = getUserPets(guildId, userId);
  if (pets.length === 0) return { success: false, error: 'no_pets' };

  let totalCost = 0;
  const results = [];

  for (const pet of pets) {
    const effective = getEffectiveStats(pet, settings);
    if (effective.ranAway) {
      deletePet(pet.id);
      results.push({ pet, status: 'ran_away' });
      continue;
    }
    if (effective.hunger >= 100) {
      results.push({ pet, status: 'full' });
      continue;
    }
    const cost = calculateFoodCost(pet, settings, 'basic');
    totalCost += cost;
    results.push({ pet, status: 'fed', cost, hungerBefore: effective.hunger });
  }

  return { success: true, totalCost, results, petCount: pets.length };
}

function executeFeedAll(guildId, userId, settings) {
  if (!db) return { success: false, error: 'Database not available' };
  if (!settings) settings = getSettings(guildId);

  const pets = getUserPets(guildId, userId);
  const fed = [];
  let totalCost = 0;
  const now = Date.now();

  for (const pet of pets) {
    const effective = getEffectiveStats(pet, settings);
    if (effective.ranAway) { deletePet(pet.id); continue; }
    if (effective.hunger >= 100) continue;

    const cost = calculateFoodCost(pet, settings, 'basic');
    const food = FOOD_TYPES.basic;
    const newHunger = Math.min(100, effective.hunger + food.hunger);
    totalCost += cost;

    advanceBond(pet.id, pet);
    db.run(
      'UPDATE pets SET hunger = ?, last_decay_time = ?, last_fed = ? WHERE id = ?',
      [newHunger, now, now, pet.id]
    );
    fed.push({ name: pet.name, cost, hungerBefore: effective.hunger, hungerAfter: newHunger });
  }

  if (fed.length > 0) saveDatabase();
  return { success: true, totalCost, fed };
}

// ============ PRECHECK (shared) ============
function precheckPlay(petId, settings) {
  if (!db) return { success: false, error: 'Database not available' };
  const pet = getPet(petId);
  if (!pet) return { success: false, error: 'Pet not found' };
  if (!settings) settings = getSettings(pet.guild_id);

  const effective = getEffectiveStats(pet, settings);
  if (effective.ranAway) {
    deletePet(petId);
    return { success: false, error: 'ran_away', pet };
  }
  const phase = getPhase(pet.level);
  if (!phase.canPlay) return { success: false, error: 'phase_locked', pet };

  const now = Date.now();
  if (pet.last_played && (now - pet.last_played) < settings.playCooldown * 1000) {
    const readyAt = pet.last_played + settings.playCooldown * 1000;
    return { success: false, error: 'cooldown', readyAt, pet };
  }
  return { success: true, pet, effective };
}

function precheckTrain(petId, settings) {
  if (!db) return { success: false, error: 'Database not available' };
  const pet = getPet(petId);
  if (!pet) return { success: false, error: 'Pet not found' };
  if (!settings) settings = getSettings(pet.guild_id);

  const effective = getEffectiveStats(pet, settings);
  if (effective.ranAway) {
    deletePet(petId);
    return { success: false, error: 'ran_away', pet };
  }
  const phase = getPhase(pet.level);
  if (!phase.canTrain) return { success: false, error: 'phase_locked', pet };

  const now = Date.now();
  if (pet.last_trained && (now - pet.last_trained) < settings.trainCooldown * 1000) {
    const readyAt = pet.last_trained + settings.trainCooldown * 1000;
    return { success: false, error: 'cooldown', readyAt, pet };
  }

  const cost = getTrainCost(pet.level, settings);
  return { success: true, pet, effective, cost };
}

function getTrainCost(level, settings) {
  const base = Math.floor(settings.baseFoodCost * 0.25);
  return Math.floor(base * (1 + 2 * (level - 1) / 49));
}

// ============ BOND ============
function getDayNumber(timestamp) {
  return Math.floor(timestamp / 86400000);
}

function advanceBond(petId, pet) {
  const now = Date.now();
  const today = getDayNumber(now);
  const lastDay = pet.last_care_day || 0;

  if (today === lastDay) return pet.bond_streak || 0; // Already cared today

  let streak = pet.bond_streak || 0;
  if (today === lastDay + 1) {
    streak++; // Consecutive day
  } else if (lastDay > 0) {
    streak = 1; // Missed a day, reset
  } else {
    streak = 1; // First care ever
  }

  db.run('UPDATE pets SET bond_streak = ?, last_care_day = ? WHERE id = ?', [streak, today, petId]);
  return streak;
}

function getBondMultiplier(bondStreak) {
  // 1.0x at 0 days, scales to 1.5x at 30+ days
  const capped = Math.min(bondStreak, 30);
  return 1.0 + (capped / 30) * 0.5;
}

// ============ PLAY ============
function playWithPet(petId, settings, miniGameWon = true) {
  const pet = getPet(petId);
  if (!pet) return { success: false, error: 'Pet not found' };
  if (!settings) settings = getSettings(pet.guild_id);

  const effective = getEffectiveStats(pet, settings);
  const now = Date.now();
  const bondStreak = advanceBond(petId, pet);

  const happinessGain = miniGameWon ? settings.playHappinessGain : 5;
  const xpGain = miniGameWon ? settings.playXp : Math.floor(settings.playXp / 5);
  const newHappiness = Math.min(100, effective.happiness + happinessGain);
  const { newLevel, newXp, leveledUp, newPhase } = addXp(pet, xpGain);

  db.run(
    'UPDATE pets SET happiness = ?, last_decay_time = ?, last_played = ?, xp = ?, level = ? WHERE id = ?',
    [newHappiness, now, now, newXp, newLevel, petId]
  );
  saveDatabase();

  const messages = PLAY_MESSAGES[pet.species] || PLAY_MESSAGES.cat;
  const message = messages[Math.floor(Math.random() * messages.length)];

  return {
    success: true,
    message,
    xpGain,
    happinessBefore: effective.happiness,
    happinessAfter: newHappiness,
    leveledUp,
    newLevel,
    newPhase,
    miniGameWon,
    pet: { ...pet, happiness: newHappiness, last_decay_time: now, last_played: now, xp: newXp, level: newLevel },
  };
}

// ============ TRAIN ============
function trainPet(petId, settings, miniGameWon = true) {
  const pet = getPet(petId);
  if (!pet) return { success: false, error: 'Pet not found' };
  if (!settings) settings = getSettings(pet.guild_id);

  const effective = getEffectiveStats(pet, settings);
  const now = Date.now();
  const bondStreak = advanceBond(petId, pet);

  const newHappiness = Math.min(100, effective.happiness + settings.trainHappinessGain);
  const xpGain = miniGameWon ? Math.floor(settings.trainXp * 1.5) : settings.trainXp;
  const { newLevel, newXp, leveledUp, newPhase } = addXp(pet, xpGain);

  db.run(
    'UPDATE pets SET happiness = ?, last_decay_time = ?, last_trained = ?, xp = ?, level = ? WHERE id = ?',
    [newHappiness, now, now, newXp, newLevel, petId]
  );
  saveDatabase();

  const messages = TRAIN_MESSAGES[pet.species] || TRAIN_MESSAGES.cat;
  const message = messages[Math.floor(Math.random() * messages.length)];

  return {
    success: true,
    message,
    xpGain,
    happinessBefore: effective.happiness,
    happinessAfter: newHappiness,
    leveledUp,
    newLevel,
    newPhase,
    miniGameWon,
    pet: { ...pet, happiness: newHappiness, last_decay_time: now, last_trained: now, xp: newXp, level: newLevel },
  };
}

// ============ XP & LEVELING ============
function xpToNextLevel(level) {
  return level * 11;
}

function addXp(pet, amount) {
  let level = pet.level;
  let xp = pet.xp + amount;
  let leveledUp = false;
  let newPhase = null;

  while (level < 50) {
    const needed = xpToNextLevel(level);
    if (xp >= needed) {
      xp -= needed;
      level++;
      leveledUp = true;

      // Check phase change
      const oldPhase = getPhase(level - 1);
      const currentPhase = getPhase(level);
      if (oldPhase.name !== currentPhase.name) {
        newPhase = currentPhase;
      }
    } else {
      break;
    }
  }

  // Cap at level 50
  if (level >= 50) {
    level = 50;
    xp = 0;
  }

  return { newLevel: level, newXp: xp, leveledUp, newPhase };
}

function getPhase(level) {
  if (level >= 41) return PHASES.elder;
  if (level >= 26) return PHASES.adult;
  if (level >= 11) return PHASES.juvenile;
  return PHASES.baby;
}

function getTotalXpForLevel(targetLevel) {
  let total = 0;
  for (let l = 1; l < targetLevel; l++) {
    total += xpToNextLevel(l);
  }
  return total;
}

// ============ BONUS CALCULATION ============
function getPetBonus(guildId, userId, bonusType) {
  if (!db) return 0;

  const settings = getSettings(guildId);
  if (!settings.enabled) return 0;

  const pet = getActivePet(guildId, userId);
  if (!pet) return 0;

  return getSinglePetBonus(pet, bonusType, settings);
}

function getPetBonusDecimal(guildId, userId, bonusType) {
  return getPetBonus(guildId, userId, bonusType) / 100;
}

// Helper: apply gambling pet bonus to a payout amount
function applyGamblingBonus(guildId, userId, amount) {
  const bonus = getPetBonusDecimal(guildId, userId, 'gambling');
  if (bonus > 0) return Math.floor(amount * (1 + bonus));
  return amount;
}

function getSinglePetBonus(pet, bonusType, settings) {
  if (!settings) settings = getSettings(pet.guild_id);
  const speciesData = SPECIES[pet.species];
  if (!speciesData) return 0;

  const specialtyMult = speciesData.specialties[bonusType] || 0;
  if (specialtyMult === 0) return 0;

  const phase = getPhase(pet.level);
  if (phase.bonusMult === 0) return 0;

  const effective = getEffectiveStats(pet, settings);
  if (effective.ranAway || effective.happiness <= 0) return 0;

  const rarityData = RARITIES[pet.rarity];
  if (!rarityData) return 0;

  const bondMult = getBondMultiplier(pet.bond_streak || 0);

  return settings.baseBonusPercent
    * specialtyMult
    * rarityData.multiplier
    * phase.bonusMult
    * (effective.happiness / 100)
    * (pet.shiny ? settings.shinyBonusMultiplier : 1.0)
    * bondMult;
}

// ============ PET SLOTS ============
function getKennel(guildId, userId) {
  if (!db) return { level: 0 };
  const stmt = db.prepare('SELECT level FROM pet_kennel WHERE guild_id = ? AND user_id = ?');
  stmt.bind([guildId, userId]);
  let level = 0;
  if (stmt.step()) {
    level = stmt.getAsObject().level;
  }
  stmt.free();
  return { level };
}

function upgradeKennel(guildId, userId) {
  if (!db) return { success: false, error: 'Database not available' };

  const kennel = getKennel(guildId, userId);
  const settings = getSettings(guildId);
  const maxLevel = settings.kennelPrices.length;
  if (kennel.level >= maxLevel) {
    return { success: false, error: 'max_level' };
  }

  const newLevel = kennel.level + 1;

  db.run(
    `INSERT OR REPLACE INTO pet_kennel (guild_id, user_id, level) VALUES (?, ?, ?)`,
    [guildId, userId, newLevel]
  );
  saveDatabase();

  return { success: true, newLevel };
}

function getKennelUpgradeCost(guildId, currentLevel) {
  const settings = getSettings(guildId);
  if (currentLevel >= settings.kennelPrices.length) return null;
  return settings.kennelPrices[currentLevel];
}

function getMaxPetSlots(guildId, userId) {
  const settings = getSettings(guildId);
  let slots = settings.basePetSlots;

  // Prestige bonus (+1 per tier)
  try {
    const { getPrestigeLevel } = require('./prestige');
    const prestigeLevel = getPrestigeLevel(guildId, userId);
    slots += prestigeLevel;
  } catch (e) {
    // Prestige module not loaded
  }

  // Kennel bonus
  const kennel = getKennel(guildId, userId);
  slots += kennel.level;

  const maxKennelSlots = settings.kennelPrices ? settings.kennelPrices.length : 3;
  return Math.min(slots, settings.basePetSlots + 5 + maxKennelSlots); // dynamic cap
}

// ============ DISPLAY HELPERS ============
function formatPetName(pet) {
  const speciesData = SPECIES[pet.species];
  const shinyPrefix = pet.shiny ? '✨ ' : '';
  return `${shinyPrefix}${speciesData.emoji} ${pet.name}`;
}

function formatPetSummary(pet, settings) {
  const speciesData = SPECIES[pet.species];
  const rarityData = RARITIES[pet.rarity];
  const phase = getPhase(pet.level);
  const effective = getEffectiveStats(pet, settings);
  const sexEmoji = pet.sex === 'M' ? '♂️' : '♀️';
  const shinyPrefix = pet.shiny ? '✨' : '';

  const activeTag = pet.is_active ? ' ⚔️' : '';

  return `${shinyPrefix}${speciesData.emoji} **${pet.name}**${activeTag} — ${sexEmoji} ${rarityData.name} ${speciesData.name} — Lv.${pet.level} (${phase.name}) — ❤️ ${effective.happiness} 🍖 ${effective.hunger}`;
}

function formatShopEntry(entry) {
  const speciesData = SPECIES[entry.species];
  const rarityData = RARITIES[entry.rarity];
  const sexEmoji = entry.sex === 'M' ? '♂️' : '♀️';
  const shinyPrefix = entry.shiny ? '✨ ' : '';
  return `${shinyPrefix}${speciesData.emoji} ${sexEmoji} ${rarityData.name} ${speciesData.name}`;
}

function formatBonusType(bonusType) {
  const names = {
    work: '💼 Work Payout',
    rob_defense: '🛡️ Rob/Hack Defense',
    rob_offense: '⚔️ Rob/Hack Offense',
    vault: '🏦 Vault Earnings',
    property: '🏠 Property Upgrade Speed',
    gambling: '🎰 Gambling Payout',
  };
  return names[bonusType] || bonusType;
}

function getSpecialtyDisplay(species) {
  const speciesData = SPECIES[species];
  if (!speciesData) return 'Unknown';
  const entries = Object.entries(speciesData.specialties);
  return entries.map(([type, mult]) => {
    const label = formatBonusType(type);
    const strength = mult < 1 ? ` (${Math.round(mult * 100)}%)` : '';
    return `${label}${strength}`;
  }).join('\n');
}

// ============ EGG SYSTEM ============
const EGG_TYPES = {
  mystery: {
    name: 'Mystery Egg',
    emoji: '🥚',
    color: 0x95a5a6,
    settingsKey: 'eggMysteryPrice',
    warmCost: 1000,
    shinyChance: 0.01,
    hatchHours: 72,
    speciesWeights: [
      { species: 'wolf',   weight: 25 },
      { species: 'alien',  weight: 25 },
      { species: 'cat',    weight: 8.33 },
      { species: 'dog',    weight: 8.33 },
      { species: 'bird',   weight: 8.33 },
      { species: 'spider', weight: 8.33 },
      { species: 'bear',   weight: 8.33 },
      { species: 'panda',  weight: 8.34 },
    ],
    // Rarity tables differ by species type
    normalRarity: [
      { rarity: 'rare',      weight: 70 },
      { rarity: 'epic',      weight: 25 },
      { rarity: 'legendary', weight: 5 },
    ],
    exoticRarity: [
      { rarity: 'common',   weight: 80 },
      { rarity: 'uncommon', weight: 15 },
      { rarity: 'rare',     weight: 5 },
    ],
  },
  golden: {
    name: 'Golden Egg',
    emoji: '🥇',
    color: 0xf1c40f,
    settingsKey: 'eggGoldenPrice',
    warmCost: 3000,
    shinyChance: 0.02,
    hatchHours: 72,
    speciesWeights: [
      { species: 'wolf',    weight: 10.5 },
      { species: 'alien',   weight: 10.5 },
      { species: 'dragon',  weight: 10.5 },
      { species: 'cat',     weight: 10.5 },
      { species: 'dog',     weight: 10.5 },
      { species: 'bird',    weight: 10.5 },
      { species: 'spider',  weight: 10.5 },
      { species: 'bear',    weight: 10.5 },
      { species: 'panda',   weight: 10.5 },
      { species: 'unicorn', weight: 5.5 },
    ],
    normalRarity: [
      { rarity: 'rare',      weight: 45 },
      { rarity: 'epic',      weight: 45 },
      { rarity: 'legendary', weight: 10 },
    ],
    exoticRarity: [
      { rarity: 'common',    weight: 15 },
      { rarity: 'uncommon',  weight: 30 },
      { rarity: 'rare',      weight: 30 },
      { rarity: 'epic',      weight: 18 },
      { rarity: 'legendary', weight: 7 },
    ],
  },
  prismatic: {
    name: 'Prismatic Egg',
    emoji: '🌈',
    color: 0x9b59b6,
    settingsKey: 'eggPrismaticPrice',
    warmCost: 5000,
    shinyChance: 0.05,
    hatchHours: 72,
    speciesWeights: [
      { species: 'wolf',    weight: 31 },
      { species: 'alien',   weight: 31 },
      { species: 'dragon',  weight: 31 },
      { species: 'unicorn', weight: 7 },
    ],
    // Prismatic: all exotics, single rarity table (no commons)
    normalRarity: [
      { rarity: 'uncommon',  weight: 25 },
      { rarity: 'rare',      weight: 35 },
      { rarity: 'epic',      weight: 25 },
      { rarity: 'legendary', weight: 15 },
    ],
    exoticRarity: [
      { rarity: 'uncommon',  weight: 25 },
      { rarity: 'rare',      weight: 35 },
      { rarity: 'epic',      weight: 25 },
      { rarity: 'legendary', weight: 15 },
    ],
  },
};

const EXOTIC_SPECIES = ['wolf', 'dragon', 'alien', 'unicorn'];

function getEggPrice(guildId, eggType) {
  const settings = getSettings(guildId);
  const eggData = EGG_TYPES[eggType];
  if (!eggData) return 0;
  return settings[eggData.settingsKey] || 0;
}

function getUserEggs(guildId, userId) {
  if (!db) return [];
  const stmt = db.prepare('SELECT * FROM eggs WHERE guild_id = ? AND owner_id = ? ORDER BY purchased_at ASC');
  stmt.bind([guildId, userId]);
  const eggs = [];
  while (stmt.step()) {
    eggs.push(stmt.getAsObject());
  }
  stmt.free();
  return eggs;
}

function getUserEggCount(guildId, userId) {
  if (!db) return 0;
  const stmt = db.prepare('SELECT COUNT(*) as count FROM eggs WHERE guild_id = ? AND owner_id = ?');
  stmt.bind([guildId, userId]);
  let count = 0;
  if (stmt.step()) {
    count = stmt.getAsObject().count;
  }
  stmt.free();
  return count;
}

function getEgg(eggId) {
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM eggs WHERE id = ?');
  stmt.bind([eggId]);
  let egg = null;
  if (stmt.step()) {
    egg = stmt.getAsObject();
  }
  stmt.free();
  return egg;
}

function buyEgg(guildId, userId, eggType) {
  if (!db) return null;
  const eggData = EGG_TYPES[eggType];
  if (!eggData) return null;

  const now = Date.now();
  const hatchTime = now + (eggData.hatchHours * 3600000);

  db.run(
    `INSERT INTO eggs (guild_id, owner_id, egg_type, purchased_at, hatch_time, warm_count, last_warm_time)
     VALUES (?, ?, ?, ?, ?, 0, 0)`,
    [guildId, userId, eggType, now, hatchTime]
  );

  // Retrieve the new egg
  const stmt = db.prepare('SELECT * FROM eggs WHERE guild_id = ? AND owner_id = ? ORDER BY id DESC LIMIT 1');
  stmt.bind([guildId, userId]);
  let egg = null;
  if (stmt.step()) {
    egg = stmt.getAsObject();
  }
  stmt.free();
  saveDatabase();
  return egg;
}

function warmEgg(guildId, userId, eggId) {
  if (!db) return { success: false, reason: 'Database not ready' };

  const egg = getEgg(eggId);
  if (!egg) return { success: false, reason: 'Egg not found' };
  if (egg.owner_id !== userId || egg.guild_id !== guildId) return { success: false, reason: 'Not your egg' };

  const now = Date.now();
  const eggData = EGG_TYPES[egg.egg_type];
  if (!eggData) return { success: false, reason: 'Invalid egg type' };

  // Check if already hatched
  if (now >= egg.hatch_time) return { success: false, reason: 'This egg is ready to hatch!' };

  // Check cooldown (3 hours)
  const warmCooldown = 3 * 3600000;
  if (egg.last_warm_time && (now - egg.last_warm_time) < warmCooldown) {
    const remaining = warmCooldown - (now - egg.last_warm_time);
    return { success: false, reason: 'cooldown', remaining };
  }

  // Reduce hatch time by 1-3 hours
  const reduction = (1 + Math.random() * 2) * 3600000; // 1-3 hours in ms
  const newHatchTime = Math.max(now, egg.hatch_time - reduction);
  const actualReduction = egg.hatch_time - newHatchTime;

  db.run(
    'UPDATE eggs SET hatch_time = ?, warm_count = warm_count + 1, last_warm_time = ? WHERE id = ?',
    [newHatchTime, now, eggId]
  );
  saveDatabase();

  return {
    success: true,
    cost: eggData.warmCost,
    reduction: actualReduction,
    newHatchTime,
    ready: now >= newHatchTime,
  };
}

function rollEggResult(eggType) {
  const eggData = EGG_TYPES[eggType];
  if (!eggData) return null;

  // Roll species
  const totalWeight = eggData.speciesWeights.reduce((sum, w) => sum + w.weight, 0);
  let rand = Math.random() * totalWeight;
  let species = eggData.speciesWeights[eggData.speciesWeights.length - 1].species;
  for (const entry of eggData.speciesWeights) {
    rand -= entry.weight;
    if (rand <= 0) { species = entry.species; break; }
  }

  // Roll rarity based on species type
  const isExotic = EXOTIC_SPECIES.includes(species);
  const rarityTable = isExotic ? eggData.exoticRarity : eggData.normalRarity;
  const rarityTotal = rarityTable.reduce((sum, w) => sum + w.weight, 0);
  let rRand = Math.random() * rarityTotal;
  let rarity = rarityTable[rarityTable.length - 1].rarity;
  for (const entry of rarityTable) {
    rRand -= entry.weight;
    if (rRand <= 0) { rarity = entry.rarity; break; }
  }

  // Roll sex
  const sex = Math.random() < 0.5 ? 'M' : 'F';

  // Roll shiny
  const shiny = Math.random() < eggData.shinyChance ? 1 : 0;

  // Roll variant
  const speciesData = SPECIES[species];
  const variant = Math.ceil(Math.random() * (speciesData?.variants || 1));

  return { species, rarity, sex, shiny, variant };
}

function applyPityProtection(guildId, userId, result) {
  if (!db) return result;

  // Get pity counter
  const stmt = db.prepare('SELECT eggs_without_epic FROM egg_pity WHERE guild_id = ? AND user_id = ?');
  stmt.bind([guildId, userId]);
  let pityCount = 0;
  if (stmt.step()) {
    pityCount = stmt.getAsObject().eggs_without_epic;
  }
  stmt.free();

  const isEpicPlus = result.rarity === 'epic' || result.rarity === 'legendary';

  if (isEpicPlus) {
    // Reset pity counter
    db.run('INSERT OR REPLACE INTO egg_pity (guild_id, user_id, eggs_without_epic) VALUES (?, ?, 0)', [guildId, userId]);
    saveDatabase();
    return result;
  }

  // Increment pity counter
  pityCount++;

  if (pityCount >= 5) {
    // Bad luck protection — guarantee at least Epic
    result.rarity = 'epic';
    pityCount = 0;
  }

  db.run('INSERT OR REPLACE INTO egg_pity (guild_id, user_id, eggs_without_epic) VALUES (?, ?, ?)', [guildId, userId, pityCount]);
  saveDatabase();
  return result;
}

function hatchEgg(guildId, userId, eggId) {
  if (!db) return { success: false, reason: 'Database not ready' };

  const egg = getEgg(eggId);
  if (!egg) return { success: false, reason: 'Egg not found' };
  if (egg.owner_id !== userId || egg.guild_id !== guildId) return { success: false, reason: 'Not your egg' };

  const now = Date.now();
  if (now < egg.hatch_time) return { success: false, reason: 'not_ready', hatch_time: egg.hatch_time };

  // Roll the result
  let result = rollEggResult(egg.egg_type);
  if (!result) return { success: false, reason: 'Invalid egg type' };

  // Apply pity protection
  result = applyPityProtection(guildId, userId, result);

  // Delete the egg
  db.run('DELETE FROM eggs WHERE id = ?', [eggId]);
  saveDatabase();

  const eggData = EGG_TYPES[egg.egg_type];
  return {
    success: true,
    result,
    eggType: egg.egg_type,
    eggData,
    isAnnouncement: result.rarity === 'legendary' || result.shiny === 1,
  };
}

function deleteEgg(eggId) {
  if (!db) return;
  db.run('DELETE FROM eggs WHERE id = ?', [eggId]);
  saveDatabase();
}

// ============ BREEDING SYSTEM ============

function getBreedingFee(guildId, rarity, isExotic) {
  const settings = getSettings(guildId);
  const fees = {
    common: settings.breedingFeeCommon,
    uncommon: settings.breedingFeeUncommon,
    rare: settings.breedingFeeRare,
    epic: settings.breedingFeeEpic,
    legendary: settings.breedingFeeLegendary,
  };
  const baseFee = fees[rarity] || fees.common;
  return isExotic ? Math.round(baseFee * settings.breedingExoticMultiplier) : baseFee;
}

// Normalize sex field — accepts 'M','m','male','Male' → 'M'; 'F','f','female','Female' → 'F'
function normalizeSex(sex) {
  if (!sex) return '';
  const s = sex.toString().toLowerCase();
  if (s === 'm' || s === 'male') return 'M';
  if (s === 'f' || s === 'female') return 'F';
  return sex.toString().toUpperCase();
}

function canBreed(pet, guildId) {
  if (!pet) return { canBreed: false, reason: 'Pet not found' };
  
  const phase = getPhase(pet.level);
  if (!phase.canBreed) return { canBreed: false, reason: `${phase.name} pets cannot breed. Must be Adult or Elder.` };
  
  if (pet.gestating) return { canBreed: false, reason: 'This pet is currently gestating.' };
  
  const now = Date.now();
  if (normalizeSex(pet.sex) === 'F' && pet.breeding_cooldown_end && now < pet.breeding_cooldown_end) {
    const remaining = pet.breeding_cooldown_end - now;
    return { canBreed: false, reason: 'cooldown', remaining };
  }
  
  return { canBreed: true };
}

function canBreedTogether(pet1, pet2) {
  if (!pet1 || !pet2) return { canBreed: false, reason: 'Pet not found' };
  if (pet1.id === pet2.id) return { canBreed: false, reason: 'Cannot breed a pet with itself' };
  if (pet1.species !== pet2.species) return { canBreed: false, reason: 'Pets must be the same species' };
  const sex1 = normalizeSex(pet1.sex);
  const sex2 = normalizeSex(pet2.sex);
  if (sex1 === sex2) return { canBreed: false, reason: 'Breeding requires one male and one female' };
  
  const check1 = canBreed(pet1);
  if (!check1.canBreed) return check1;
  
  const check2 = canBreed(pet2);
  if (!check2.canBreed) return check2;
  
  return { canBreed: true };
}

function rollBreedingRarity(parent1Rarity, parent2Rarity, hasElder) {
  // Sort rarities so we always look up the correct key
  const r1Idx = RARITY_ORDER.indexOf(parent1Rarity);
  const r2Idx = RARITY_ORDER.indexOf(parent2Rarity);
  const [lowRarity, highRarity] = r1Idx <= r2Idx ? [parent1Rarity, parent2Rarity] : [parent2Rarity, parent1Rarity];
  
  const key = `${lowRarity}-${highRarity}`;
  const table = BREEDING_RARITY_TABLE[key];
  if (!table) return 'common'; // Fallback
  
  // Roll from the table
  const roll = Math.random() * 100;
  let cumulative = 0;
  let result = 'common';
  for (const rarity of RARITY_ORDER) {
    cumulative += table[rarity];
    if (roll <= cumulative) {
      result = rarity;
      break;
    }
  }
  
  // Apply elder bonus: +1 tier
  if (hasElder) {
    const idx = RARITY_ORDER.indexOf(result);
    if (idx < RARITY_ORDER.length - 1) {
      result = RARITY_ORDER[idx + 1];
    }
  }
  
  return result;
}

function rollBreedingShiny(parent1Shiny, parent2Shiny, settings) {
  const bothShiny = parent1Shiny && parent2Shiny;
  const oneShiny = parent1Shiny || parent2Shiny;
  
  let chance;
  if (bothShiny) chance = settings.breedingShinyBoth;
  else if (oneShiny) chance = settings.breedingShinyOne;
  else chance = settings.breedingShinyNone;
  
  return Math.random() < chance ? 1 : 0;
}

function rollBreedingVariant(parent1, parent2) {
  // If same variant, inherit it
  if (parent1.variant === parent2.variant) return parent1.variant;
  // Otherwise random
  const speciesData = SPECIES[parent1.species];
  return Math.ceil(Math.random() * (speciesData?.variants || 1));
}

function startGestation(guildId, femalePetId, malePetId, forUserId) {
  if (!db) return { success: false, reason: 'Database not ready' };
  
  const settings = getSettings(guildId);
  const gestationMs = settings.gestationHours * 3600000;
  const gestationEnd = Date.now() + gestationMs;
  
  db.run(
    'UPDATE pets SET gestating = 1, gestation_end = ?, gestating_for_user = ?, gestating_male_id = ? WHERE id = ?',
    [gestationEnd, forUserId, malePetId, femalePetId]
  );
  saveDatabase();
  return { success: true, gestationEnd };
}

function getGestatingPets(guildId, userId) {
  if (!db) return [];
  // Get pets gestating FOR this user (they will receive the baby)
  const stmt = db.prepare('SELECT * FROM pets WHERE guild_id = ? AND gestating_for_user = ? AND gestating = 1');
  stmt.bind([guildId, userId]);
  const pets = [];
  while (stmt.step()) {
    pets.push(stmt.getAsObject());
  }
  stmt.free();
  return pets;
}

function getMyGestatingPets(guildId, userId) {
  if (!db) return [];
  // Get pets owned by this user that are gestating
  const stmt = db.prepare('SELECT * FROM pets WHERE guild_id = ? AND owner_id = ? AND gestating = 1');
  stmt.bind([guildId, userId]);
  const pets = [];
  while (stmt.step()) {
    pets.push(stmt.getAsObject());
  }
  stmt.free();
  return pets;
}

function giveBirth(guildId, femalePetId, maleParent, requesterUserId) {
  if (!db) return { success: false, reason: 'Database not ready' };
  
  const female = getPet(femalePetId);
  if (!female) return { success: false, reason: 'Female pet not found' };
  if (!female.gestating) return { success: false, reason: 'This pet is not gestating' };
  
  const now = Date.now();
  if (now < female.gestation_end) return { success: false, reason: 'Not ready yet', gestation_end: female.gestation_end };
  
  const settings = getSettings(guildId);
  
  // Get male parent from stored ID if not provided
  const maleId = female.gestating_male_id;
  const male = maleParent || (maleId ? getPet(maleId) : null);
  
  // Determine if either parent is elder
  const femalePhase = getPhase(female.level);
  const malePhase = male ? getPhase(male.level) : null;
  const hasElder = femalePhase.name === 'Elder' || (malePhase && malePhase.name === 'Elder');
  
  // Roll baby attributes
  const babyRarity = rollBreedingRarity(female.rarity, male?.rarity || female.rarity, hasElder);
  const babyShiny = rollBreedingShiny(female.shiny, male?.shiny || 0, settings);
  const babyVariant = male ? rollBreedingVariant(female, male) : female.variant;
  const babySex = Math.random() < 0.5 ? 'M' : 'F';
  
  // Clear gestation status and set cooldown
  const cooldownEnd = now + (settings.breedingCooldownHours * 3600000);
  db.run(
    'UPDATE pets SET gestating = 0, gestation_end = 0, gestating_for_user = NULL, gestating_male_id = NULL, breeding_cooldown_end = ? WHERE id = ?',
    [cooldownEnd, femalePetId]
  );
  saveDatabase();
  
  return {
    success: true,
    species: female.species,
    rarity: babyRarity,
    shiny: babyShiny,
    variant: babyVariant,
    sex: babySex,
    hadElder: hasElder,
    motherName: female.name,
    motherId: female.id,
    fatherId: male?.id || null,
    fatherName: male?.name || null,
  };
}

// Breeding request functions
function createBreedingRequest(guildId, requesterId, requesterPetId, partnerId, partnerPetId, studFee) {
  if (!db) return null;
  
  const now = Date.now();
  const expiresAt = now + (24 * 3600000); // 24 hour expiry
  
  db.run(
    `INSERT INTO breeding_requests (guild_id, requester_id, requester_pet_id, partner_id, partner_pet_id, stud_fee, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [guildId, requesterId, requesterPetId, partnerId, partnerPetId, studFee, now, expiresAt]
  );
  
  const stmt = db.prepare('SELECT * FROM breeding_requests WHERE guild_id = ? ORDER BY id DESC LIMIT 1');
  stmt.bind([guildId]);
  let request = null;
  if (stmt.step()) {
    request = stmt.getAsObject();
  }
  stmt.free();
  saveDatabase();
  return request;
}

function getBreedingRequest(requestId) {
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM breeding_requests WHERE id = ?');
  stmt.bind([requestId]);
  let request = null;
  if (stmt.step()) {
    request = stmt.getAsObject();
  }
  stmt.free();
  return request;
}

function getPendingBreedingRequests(guildId, userId) {
  if (!db) return [];
  // Get requests where this user is the partner and status is pending
  const stmt = db.prepare('SELECT * FROM breeding_requests WHERE guild_id = ? AND partner_id = ? AND status = ?');
  stmt.bind([guildId, userId, 'pending']);
  const requests = [];
  while (stmt.step()) {
    requests.push(stmt.getAsObject());
  }
  stmt.free();
  return requests;
}

function getOutgoingBreedingRequests(guildId, userId) {
  if (!db) return [];
  const stmt = db.prepare('SELECT * FROM breeding_requests WHERE guild_id = ? AND requester_id = ? AND status = ?');
  stmt.bind([guildId, userId, 'pending']);
  const requests = [];
  while (stmt.step()) {
    requests.push(stmt.getAsObject());
  }
  stmt.free();
  return requests;
}

function updateBreedingRequestStatus(requestId, status) {
  if (!db) return;
  db.run('UPDATE breeding_requests SET status = ? WHERE id = ?', [status, requestId]);
  saveDatabase();
}

function updateBreedingRequestStudFee(requestId, studFee) {
  if (!db) return;
  db.run('UPDATE breeding_requests SET stud_fee = ? WHERE id = ?', [studFee, requestId]);
  saveDatabase();
}

function deleteBreedingRequest(requestId) {
  if (!db) return;
  db.run('DELETE FROM breeding_requests WHERE id = ?', [requestId]);
  saveDatabase();
}

function cleanupExpiredBreedingRequests(guildId) {
  if (!db) return;
  const now = Date.now();
  db.run('DELETE FROM breeding_requests WHERE guild_id = ? AND expires_at < ? AND status = ?', [guildId, now, 'pending']);
  saveDatabase();
}

// ============ PET TRANSFER (GIVE/SELL) ============

function canTransferPet(pet, guildId) {
  if (!pet) return { canTransfer: false, reason: 'Pet not found' };
  
  const settings = getSettings(guildId);
  if (!settings.transferEnabled) return { canTransfer: false, reason: 'Pet transfers are disabled on this server' };
  
  if (pet.gestating) return { canTransfer: false, reason: 'Cannot transfer a gestating pet' };
  
  const stats = getEffectiveStats(pet);
  if (stats.happiness < settings.transferMinHappiness) {
    return { canTransfer: false, reason: `Pet must have at least ${settings.transferMinHappiness} happiness to transfer. Current: ${stats.happiness}` };
  }
  
  return { canTransfer: true };
}

function transferPet(guildId, petId, fromUserId, toUserId) {
  if (!db) return { success: false, reason: 'Database not ready' };
  
  const pet = getPet(petId);
  if (!pet) return { success: false, reason: 'Pet not found' };
  if (pet.owner_id !== fromUserId) return { success: false, reason: 'Not your pet' };
  if (pet.guild_id !== guildId) return { success: false, reason: 'Pet not in this server' };
  
  const canCheck = canTransferPet(pet, guildId);
  if (!canCheck.canTransfer) return { success: false, reason: canCheck.reason };
  
  const settings = getSettings(guildId);
  
  // Calculate new happiness after penalty
  const stats = getEffectiveStats(pet);
  const newHappiness = Math.max(0, stats.happiness - settings.transferHappinessPenalty);
  
  // Clear active status if it was active
  if (pet.is_active) {
    db.run('UPDATE pets SET is_active = 0 WHERE id = ?', [petId]);
  }
  
  // Transfer ownership and apply happiness penalty
  db.run(
    'UPDATE pets SET owner_id = ?, happiness = ?, is_active = 0 WHERE id = ?',
    [toUserId, newHappiness, petId]
  );
  
  saveDatabase();
  
  // Auto-set as active for new owner if they have no active pet
  if (!getActivePet(guildId, toUserId)) {
    setActivePet(guildId, toUserId, petId);
  }
  
  return {
    success: true,
    pet,
    newHappiness,
    happinessPenalty: settings.transferHappinessPenalty,
  };
}

// ============ PET TRADING (SWAP) ============

function createTradeRequest(guildId, requesterId, requesterPetId, partnerId, partnerPetId = null) {
  if (!db) return null;
  
  const now = Date.now();
  const expiresAt = now + (24 * 3600000); // 24 hour expiry
  
  db.run(
    `INSERT INTO trade_requests (guild_id, requester_id, requester_pet_id, partner_id, partner_pet_id, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [guildId, requesterId, requesterPetId, partnerId, partnerPetId, now, expiresAt]
  );
  
  const stmt = db.prepare('SELECT * FROM trade_requests WHERE guild_id = ? ORDER BY id DESC LIMIT 1');
  stmt.bind([guildId]);
  let request = null;
  if (stmt.step()) {
    request = stmt.getAsObject();
  }
  stmt.free();
  saveDatabase();
  return request;
}

function getTradeRequest(requestId) {
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM trade_requests WHERE id = ?');
  stmt.bind([requestId]);
  let request = null;
  if (stmt.step()) {
    request = stmt.getAsObject();
  }
  stmt.free();
  return request;
}

function updateTradeRequestPet(requestId, partnerPetId) {
  if (!db) return;
  db.run('UPDATE trade_requests SET partner_pet_id = ? WHERE id = ?', [partnerPetId, requestId]);
  saveDatabase();
}

function updateTradeRequestStatus(requestId, status) {
  if (!db) return;
  db.run('UPDATE trade_requests SET status = ? WHERE id = ?', [status, requestId]);
  saveDatabase();
}

function deleteTradeRequest(requestId) {
  if (!db) return;
  db.run('DELETE FROM trade_requests WHERE id = ?', [requestId]);
  saveDatabase();
}

function cleanupExpiredTradeRequests(guildId) {
  if (!db) return;
  const now = Date.now();
  db.run('DELETE FROM trade_requests WHERE guild_id = ? AND expires_at < ? AND status = ?', [guildId, now, 'pending']);
  saveDatabase();
}

function executeTrade(guildId, pet1Id, user1Id, pet2Id, user2Id) {
  if (!db) return { success: false, reason: 'Database not ready' };
  
  const pet1 = getPet(pet1Id);
  const pet2 = getPet(pet2Id);
  
  if (!pet1 || !pet2) return { success: false, reason: 'Pet not found' };
  if (pet1.owner_id !== user1Id) return { success: false, reason: 'Pet 1 ownership mismatch' };
  if (pet2.owner_id !== user2Id) return { success: false, reason: 'Pet 2 ownership mismatch' };
  if (pet1.guild_id !== guildId || pet2.guild_id !== guildId) return { success: false, reason: 'Pet not in this server' };
  
  const settings = getSettings(guildId);
  
  // Calculate new happiness after penalty for both pets
  const stats1 = getEffectiveStats(pet1);
  const stats2 = getEffectiveStats(pet2);
  const newHappiness1 = Math.max(0, stats1.happiness - settings.transferHappinessPenalty);
  const newHappiness2 = Math.max(0, stats2.happiness - settings.transferHappinessPenalty);
  
  // Clear active status for both pets
  db.run('UPDATE pets SET is_active = 0 WHERE id IN (?, ?)', [pet1Id, pet2Id]);
  
  // Swap ownership and apply happiness penalty
  db.run(
    'UPDATE pets SET owner_id = ?, happiness = ?, is_active = 0 WHERE id = ?',
    [user2Id, newHappiness1, pet1Id]
  );
  db.run(
    'UPDATE pets SET owner_id = ?, happiness = ?, is_active = 0 WHERE id = ?',
    [user1Id, newHappiness2, pet2Id]
  );
  
  saveDatabase();
  
  // Auto-set as active for new owners if they have no active pet
  if (!getActivePet(guildId, user1Id)) {
    setActivePet(guildId, user1Id, pet2Id);
  }
  if (!getActivePet(guildId, user2Id)) {
    setActivePet(guildId, user2Id, pet1Id);
  }
  
  return {
    success: true,
    pet1: { ...pet1, newHappiness: newHappiness1 },
    pet2: { ...pet2, newHappiness: newHappiness2 },
    happinessPenalty: settings.transferHappinessPenalty,
  };
}

// ============ EXPORTS ============
module.exports = {
  initPets,
  // Constants
  SPECIES,
  SHOP_SPECIES,
  RARITIES,
  PHASES,
  FOOD_TYPES,
  RARITY_ORDER,
  BREEDING_RARITY_TABLE,
  // Settings
  getSettings,
  updateSettings,
  // Shop
  getShopStock,
  getShopRestockTime,
  removeShopSlot,
  generateShopStock,
  // CRUD
  adoptPet,
  getPet,
  getUserPets,
  getUserPetCount,
  deletePet,
  renamePet,
  setActivePet,
  clearActivePet,
  getActivePet,
  // Decay
  getEffectiveStats,
  processDecay,
  // Runaway recovery
  getRunawayPets,
  getRunawayPet,
  getRunawayRecoveryCount,
  getRunawayRecoveryCost,
  incrementRunawayRecoveryCount,
  recoverRunaway,
  deleteRunaway,
  // Care
  calculateFoodCost,
  feedPet,

  precheckPlay,
  precheckTrain,
  playWithPet,
  trainPet,
  getTrainCost,
  getBondMultiplier,
  // Leveling
  xpToNextLevel,
  getPhase,
  getTotalXpForLevel,
  // Bonuses
  getPetBonus,
  getPetBonusDecimal,
  applyGamblingBonus,
  getSinglePetBonus,
  // Kennel
  getKennel,
  upgradeKennel,
  getKennelUpgradeCost,
  getMaxPetSlots,
  // Display
  formatPetName,
  formatPetSummary,
  formatShopEntry,
  formatBonusType,
  getSpecialtyDisplay,
  // Images
  getPetImagePath,
  getPetImage,
  // Eggs
  EGG_TYPES,
  getEggPrice,
  getUserEggs,
  getUserEggCount,
  getEgg,
  buyEgg,
  warmEgg,
  hatchEgg,
  deleteEgg,
  rollEggResult,
  // Breeding
  getBreedingFee,
  normalizeSex,
  canBreed,
  canBreedTogether,
  rollBreedingRarity,
  rollBreedingShiny,
  rollBreedingVariant,
  startGestation,
  getGestatingPets,
  getMyGestatingPets,
  giveBirth,
  createBreedingRequest,
  getBreedingRequest,
  getPendingBreedingRequests,
  getOutgoingBreedingRequests,
  updateBreedingRequestStatus,
  updateBreedingRequestStudFee,
  deleteBreedingRequest,
  cleanupExpiredBreedingRequests,
  // Transfer
  canTransferPet,
  transferPet,
  // Trading
  createTradeRequest,
  getTradeRequest,
  updateTradeRequestPet,
  updateTradeRequestStatus,
  deleteTradeRequest,
  cleanupExpiredTradeRequests,
  executeTrade,
};
