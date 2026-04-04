// Pet System — Core Module
// Handles species, shop, adoption, care, growth, bonuses, and kennel

const path = require('path');
const fs = require('fs');
const { migrateAddColumn, saveDatabase } = require('./database');
const { TTLCache } = require('./cache');

let db = null;

// ============ SPECIES DEFINITIONS ============
const SPECIES = {
  cat:     { name: 'Cat',     emoji: '🐱', type: 'shop',   baseCost: 50000,   variants: 3, specialties: { work: 1.0 } },
  dog:     { name: 'Dog',     emoji: '🐶', type: 'shop',   baseCost: 75000,   variants: 5, specialties: { rob_defense: 1.0 } },
  bird:    { name: 'Bird',    emoji: '🐦', type: 'shop',   baseCost: 75000,   variants: 5, specialties: { rob_offense: 1.0 } },
  spider:  { name: 'Spider',  emoji: '🕷️', type: 'shop',   baseCost: 100000,  variants: 2, specialties: { vault: 1.0 } },
  bear:    { name: 'Bear',    emoji: '🐻', type: 'shop',   baseCost: 100000,  variants: 4, specialties: { property: 1.0 } },
  panda:   { name: 'Panda',   emoji: '🐼', type: 'shop',   baseCost: 250000,  variants: 2, specialties: { gambling: 1.0 } },
  wolf:    { name: 'Wolf',    emoji: '🐺', type: 'exotic',  baseCost: 0,       variants: 1, specialties: { rob_defense: 1.0, rob_offense: 1.0 } },
  dragon:  { name: 'Dragon',  emoji: '🐉', type: 'exotic',  baseCost: 0,       variants: 1, specialties: { vault: 1.0, gambling: 1.0 } },
  alien:   { name: 'Alien',   emoji: '👽', type: 'exotic',  baseCost: 0,       variants: 1, specialties: { work: 1.0, property: 1.0 } },
  unicorn: { name: 'Unicorn', emoji: '🦄', type: 'exotic',  baseCost: 0,       variants: 5, specialties: { work: 0.4, rob_defense: 0.4, rob_offense: 0.4, vault: 0.4, property: 0.4, gambling: 0.4 } },
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
  kennelL1Price: 2500000,
  kennelL2Price: 7500000,
  kennelL3Price: 10000000,
  basePetSlots: 2,
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

  db.run(`CREATE INDEX IF NOT EXISTS idx_pets_owner ON pets(guild_id, owner_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pet_shop_guild ON pet_shop(guild_id)`);

  // Migration: add is_active column
  migrateAddColumn(db, 'pets', 'is_active INTEGER DEFAULT 0');
  // Migration: add bond columns
  migrateAddColumn(db, 'pets', 'bond_streak INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pets', 'last_care_day INTEGER DEFAULT 0');
  migrateAddColumn(db, 'pets', 'variant INTEGER DEFAULT 1');

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
      kennelL1Price: row.kennel_l1_price,
      kennelL2Price: row.kennel_l2_price,
      kennelL3Price: row.kennel_l3_price,
      basePetSlots: row.base_pet_slots,
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
    kennelL1Price: 'kennel_l1_price',
    kennelL2Price: 'kennel_l2_price',
    kennelL3Price: 'kennel_l3_price',
    basePetSlots: 'base_pet_slots',
  };

  const current = getSettings(guildId);
  const merged = { ...current, ...updates };

  const cols = Object.keys(columnMap);
  const sqlCols = cols.map(k => columnMap[k]).join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map(k => {
    const val = merged[k];
    if (typeof val === 'boolean') return val ? 1 : 0;
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
function adoptPet(guildId, userId, species, name, rarity, sex, shiny, source = 'shop', forcedVariant = null) {
  if (!db) return null;
  const now = Date.now();
  const speciesData = SPECIES[species];
  const variant = forcedVariant || Math.ceil(Math.random() * (speciesData?.variants || 1));

  db.run(
    `INSERT INTO pets (guild_id, owner_id, species, name, rarity, sex, shiny, level, xp, hunger, happiness, last_decay_time, born_at, source, variant)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 100, 100, ?, ?, ?, ?)`,
    [guildId, userId, species, name, rarity, sex, shiny, now, now, source, variant]
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
  if (kennel.level >= 3) {
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
  if (currentLevel >= 3) return null;
  const costs = [settings.kennelL1Price, settings.kennelL2Price, settings.kennelL3Price];
  return costs[currentLevel];
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

  return Math.min(slots, 10); // Hard cap at 10
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

// ============ EXPORTS ============
module.exports = {
  initPets,
  // Constants
  SPECIES,
  SHOP_SPECIES,
  RARITIES,
  PHASES,
  FOOD_TYPES,
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
};
