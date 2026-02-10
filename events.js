const CURRENCY = '<:babybel:1418824333664452608>';

let db = null;
let client = null;

// Active market events (guild_id -> { multiplier, expiresAt, eventName })
const activeMarketEvents = new Map();

// Active vault events (messageId -> { collectors: Set, reward amounts })
const activeVaults = new Map();

// Message counters per guild (guild_id -> { eventCounter, eventTarget, truckCounter, truckTarget })
const messageCounters = new Map();

// Vault image URL
const VAULT_IMAGE = 'https://cdn.discordapp.com/attachments/1418772691166560256/1456469066456760340/vault.png?ex=69587a05&is=69572885&hm=8e684a51af13d21e8167d5b95915b7f6d386478f3b00810bae9a46ce4812b238&';

// Default events with flavor text
const DEFAULT_EVENTS = [
  // Positive Events (boost prices)
  { id: 1, name: 'Bull Run', flavor: 'Investors are feeling optimistic! The market is surging.', type: 'positive', minPercent: 3, maxPercent: 30 },
  { id: 2, name: 'Viral Moment', flavor: 'Stocks just went viral on social media! 🚀', type: 'positive', minPercent: 3, maxPercent: 30 },
  { id: 3, name: 'Earnings Beat', flavor: 'Everyone is crushing their earnings expectations!', type: 'positive', minPercent: 3, maxPercent: 30 },
  { id: 4, name: 'Fed Rate Cut', flavor: 'The Federal Reserve just cut interest rates!', type: 'positive', minPercent: 3, maxPercent: 30 },
  { id: 5, name: 'Merger Mania', flavor: 'Major acquisitions are driving stock prices up!', type: 'positive', minPercent: 3, maxPercent: 30 },
  { id: 6, name: 'Tech Breakthrough', flavor: 'A revolutionary technology was just announced!', type: 'positive', minPercent: 3, maxPercent: 30 },
  { id: 7, name: 'Foreign Investment', flavor: 'International investors are flooding the market!', type: 'positive', minPercent: 3, maxPercent: 30 },
  { id: 8, name: 'Consumer Confidence', flavor: 'Consumer spending is at an all-time high!', type: 'positive', minPercent: 3, maxPercent: 30 },
  
  // Negative Events (drop prices)
  { id: 9, name: 'Market Correction', flavor: 'The market is correcting after recent highs. 📉', type: 'negative', minPercent: 3, maxPercent: 30 },
  { id: 10, name: 'Scandal Breaks', flavor: 'A major corporate scandal just hit the news!', type: 'negative', minPercent: 3, maxPercent: 30 },
  { id: 11, name: 'Earnings Miss', flavor: 'Everyone is missing their earnings targets!', type: 'negative', minPercent: 3, maxPercent: 30 },
  { id: 12, name: 'Rate Hike', flavor: 'The Federal Reserve just raised interest rates!', type: 'negative', minPercent: 3, maxPercent: 30 },
  { id: 13, name: 'Trade War', flavor: 'New tariffs are causing market uncertainty!', type: 'negative', minPercent: 3, maxPercent: 30 },
  { id: 14, name: 'Tech Crash', flavor: 'The tech sector is experiencing a major selloff!', type: 'negative', minPercent: 3, maxPercent: 30 },
  { id: 15, name: 'Capital Flight', flavor: 'Investors are pulling money out of the market!', type: 'negative', minPercent: 3, maxPercent: 30 },
  { id: 16, name: 'Recession Fears', flavor: 'Economic indicators are pointing to a recession!', type: 'negative', minPercent: 3, maxPercent: 30 },
  
  // Neutral Events (interesting but no effect)
  { id: 17, name: 'Sideways Trading', flavor: 'The market is moving sideways today. How exciting.', type: 'neutral', minPercent: 0, maxPercent: 0 },
  { id: 18, name: 'Lunch Break', flavor: 'Traders are out to lunch. Literally.', type: 'neutral', minPercent: 0, maxPercent: 0 },
  { id: 19, name: 'Algorithm Glitch', flavor: 'A trading algorithm just had a brief moment of confusion.', type: 'neutral', minPercent: 0, maxPercent: 0 },
  { id: 20, name: 'Coffee Shortage', flavor: 'Wall Street is running low on coffee. Productivity unchanged.', type: 'neutral', minPercent: 0, maxPercent: 0 }
];

// In-memory cache
const guildEventSettings = new Map();

function initEvents(database, discordClient) {
  db = database;
  client = discordClient;
  
  // Create event settings table (with message count triggers)
  db.run(`
    CREATE TABLE IF NOT EXISTS event_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      channel_id TEXT,
      min_messages INTEGER DEFAULT 500,
      max_messages INTEGER DEFAULT 2000,
      event_duration_minutes INTEGER DEFAULT 30,
      positive_weight INTEGER DEFAULT 40,
      negative_weight INTEGER DEFAULT 40,
      neutral_weight INTEGER DEFAULT 20,
      last_event_time INTEGER DEFAULT 0
    );
  `);
  
  // Migration: Convert interval columns to message columns if needed
  try {
    db.run(`ALTER TABLE event_settings ADD COLUMN min_messages INTEGER DEFAULT 500`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE event_settings ADD COLUMN max_messages INTEGER DEFAULT 2000`);
  } catch (e) {
    // Column already exists
  }
  
  // Migration: Add event duration columns if they don't exist
  try {
    db.run(`ALTER TABLE event_settings ADD COLUMN event_duration_minutes INTEGER DEFAULT 30`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE event_settings ADD COLUMN min_duration_minutes INTEGER DEFAULT 15`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE event_settings ADD COLUMN max_duration_minutes INTEGER DEFAULT 60`);
  } catch (e) {
    // Column already exists
  }
  
  // Create vault settings table (with message count triggers)
  db.run(`
    CREATE TABLE IF NOT EXISTS cheese_truck_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      channel_id TEXT,
      min_messages INTEGER DEFAULT 200,
      max_messages INTEGER DEFAULT 1000,
      min_reward INTEGER DEFAULT 100,
      max_reward INTEGER DEFAULT 10000
    );
  `);
  
  // Migration: Convert interval columns to message columns if needed
  try {
    db.run(`ALTER TABLE cheese_truck_settings ADD COLUMN min_messages INTEGER DEFAULT 200`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE cheese_truck_settings ADD COLUMN max_messages INTEGER DEFAULT 1000`);
  } catch (e) {
    // Column already exists
  }
  
  // Create event history table
  db.run(`
    CREATE TABLE IF NOT EXISTS event_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      event_id INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      percent_change REAL NOT NULL,
      affected_stocks TEXT,
      triggered_by TEXT,
      triggered_at INTEGER NOT NULL
    );
  `);
  
  // Create vault history table
  db.run(`
    CREATE TABLE IF NOT EXISTS cheese_truck_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      triggered_at INTEGER NOT NULL,
      winners TEXT,
      total_payout INTEGER DEFAULT 0,
      had_booby_trap INTEGER DEFAULT 0
    );
  `);
  
  // Create message counters table (persists across restarts)
  db.run(`
    CREATE TABLE IF NOT EXISTS message_counters (
      guild_id TEXT PRIMARY KEY,
      event_counter INTEGER DEFAULT 0,
      event_target INTEGER DEFAULT 0,
      truck_counter INTEGER DEFAULT 0,
      truck_target INTEGER DEFAULT 0
    );
  `);
  
  // Create active events table (persists across restarts)
  db.run(`
    CREATE TABLE IF NOT EXISTS active_market_events (
      guild_id TEXT PRIMARY KEY,
      multiplier REAL NOT NULL,
      percent_change REAL NOT NULL,
      expires_at INTEGER NOT NULL,
      event_name TEXT NOT NULL
    );
  `);
  
  // Create indexes for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_history_guild_time ON event_history(guild_id, triggered_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_truck_history_guild_time ON cheese_truck_history(guild_id, triggered_at)`);
  
  // Restart any enabled schedulers after a short delay (to let guilds load)
  setTimeout(() => {
    initializeMessageCounters();
    loadActiveEvents();
  }, 5000);
  
  console.log('📰 Events system initialized (message-based triggers)');
}

// Initialize message counters for all enabled guilds
function initializeMessageCounters() {
  if (!db) return;
  
  // Initialize event counters
  const eventResults = db.exec('SELECT guild_id FROM event_settings WHERE enabled = 1');
  if (eventResults.length > 0 && eventResults[0].values.length > 0) {
    for (const row of eventResults[0].values) {
      const guildId = row[0];
      initGuildCounter(guildId);
      console.log(`📰 Initialized market event counter for guild ${guildId}`);
    }
  }
  
  // Initialize vault counters
  const truckResults = db.exec('SELECT guild_id FROM cheese_truck_settings WHERE enabled = 1');
  if (truckResults.length > 0 && truckResults[0].values.length > 0) {
    for (const row of truckResults[0].values) {
      const guildId = row[0];
      initGuildCounter(guildId);
      console.log(`🏦 Initialized vault counter for guild ${guildId}`);
    }
  }
}

// Save active event to database
function saveActiveEvent(guildId, multiplier, percentChange, expiresAt, eventName) {
  if (!db) return;
  
  db.run(`
    INSERT OR REPLACE INTO active_market_events (guild_id, multiplier, percent_change, expires_at, event_name)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, multiplier, percentChange, expiresAt, eventName]);
}

// Remove active event from database
function removeActiveEvent(guildId) {
  if (!db) return;
  
  db.run('DELETE FROM active_market_events WHERE guild_id = ?', [guildId]);
}

// Load active events from database on startup
function loadActiveEvents() {
  if (!db) return;
  
  const results = db.exec('SELECT guild_id, multiplier, percent_change, expires_at, event_name FROM active_market_events');
  
  if (results.length === 0 || results[0].values.length === 0) {
    console.log('📰 No active market events to restore');
    return;
  }
  
  const now = Date.now();
  let restored = 0;
  let expired = 0;
  
  for (const row of results[0].values) {
    const [guildId, multiplier, percentChange, expiresAt, eventName] = row;
    
    if (expiresAt > now) {
      // Event still active - restore it
      activeMarketEvents.set(guildId, {
        multiplier,
        percentChange,
        expiresAt,
        eventName
      });
      
      // Schedule the end
      const remainingMs = expiresAt - now;
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      scheduleEventEnd(guildId, expiresAt, eventName, percentChange, remainingMinutes);
      
      console.log(`📰 Restored event "${eventName}" for guild ${guildId} (${remainingMinutes} min remaining)`);
      restored++;
    } else {
      // Event expired - remove from database
      removeActiveEvent(guildId);
      expired++;
    }
  }
  
  console.log(`📰 Active events: ${restored} restored, ${expired} expired`);
}

// Schedule the end of an event
function scheduleEventEnd(guildId, expiresAt, eventName, percentChange, durationMinutes) {
  const remainingMs = expiresAt - Date.now();
  
  if (remainingMs <= 0) {
    // Already expired
    activeMarketEvents.delete(guildId);
    removeActiveEvent(guildId);
    return;
  }
  
  setTimeout(async () => {
    const current = activeMarketEvents.get(guildId);
    if (current && current.expiresAt === expiresAt) {
      activeMarketEvents.delete(guildId);
      removeActiveEvent(guildId);
      
      // Refresh last known prices to prevent false stock alerts
      try {
        const { refreshLastKnownPrices } = require('./ticker');
        refreshLastKnownPrices(guildId);
      } catch (e) {
        // Ticker not loaded yet, that's fine
      }
      
      // Announce that the event has ended
      await announceEventEnd(guildId, eventName, percentChange);
    }
  }, remainingMs);
}

// Initialize or get guild counter
function initGuildCounter(guildId) {
  if (!messageCounters.has(guildId)) {
    const eventSettings = getEventSettings(guildId);
    const truckSettings = getVaultSettings(guildId);
    
    // Try to load from database first
    const saved = loadCountersFromDb(guildId);
    
    if (saved && saved.eventTarget > 0 && saved.truckTarget > 0) {
      // Use saved counters
      messageCounters.set(guildId, {
        eventCounter: saved.eventCounter,
        eventTarget: saved.eventTarget,
        truckCounter: saved.truckCounter,
        truckTarget: saved.truckTarget
      });
      console.log(`📊 Loaded saved counters for guild ${guildId}: Events ${saved.eventCounter}/${saved.eventTarget}, Truck ${saved.truckCounter}/${saved.truckTarget}`);
    } else {
      // Create new counters
      const newCounters = {
        eventCounter: 0,
        eventTarget: getRandomTarget(eventSettings.minMessages, eventSettings.maxMessages),
        truckCounter: 0,
        truckTarget: getRandomTarget(truckSettings.minMessages, truckSettings.maxMessages)
      };
      messageCounters.set(guildId, newCounters);
      saveCountersToDb(guildId, newCounters);
    }
  }
  return messageCounters.get(guildId);
}

// Load counters from database
function loadCountersFromDb(guildId) {
  if (!db) return null;
  
  try {
    const result = db.exec('SELECT * FROM message_counters WHERE guild_id = ?', [guildId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const data = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      return {
        eventCounter: data.event_counter || 0,
        eventTarget: data.event_target || 0,
        truckCounter: data.truck_counter || 0,
        truckTarget: data.truck_target || 0
      };
    }
  } catch (e) {
    console.error('Error loading counters:', e);
  }
  return null;
}

// Save counters to database
function saveCountersToDb(guildId, counters) {
  if (!db) return;
  
  try {
    db.run(`
      INSERT OR REPLACE INTO message_counters 
      (guild_id, event_counter, event_target, truck_counter, truck_target)
      VALUES (?, ?, ?, ?, ?)
    `, [
      guildId,
      counters.eventCounter,
      counters.eventTarget,
      counters.truckCounter,
      counters.truckTarget
    ]);
  } catch (e) {
    console.error('Error saving counters:', e);
  }
}

// Get random target between min and max
function getRandomTarget(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Handle incoming message - call this from bot.js
async function handleMessage(message) {
  if (!message.guild || message.author.bot) return;
  
  const guildId = message.guild.id;
  const counter = initGuildCounter(guildId);
  
  const eventSettings = getEventSettings(guildId);
  const truckSettings = getVaultSettings(guildId);
  
  // Debug: Log settings on first message
  if (counter.truckCounter === 0 && counter.eventCounter === 0) {
    console.log(`🔍 Guild ${guildId} settings check:`, {
      eventEnabled: eventSettings.enabled,
      eventChannel: eventSettings.channelId,
      truckEnabled: truckSettings.enabled,
      truckChannel: truckSettings.channelId
    });
  }
  
  let shouldSave = false;
  
  // Count message for events
  if (eventSettings.enabled && eventSettings.channelId) {
    counter.eventCounter++;
    shouldSave = true;
    
    // Log every 10 messages to see progress
    if (counter.eventCounter % 10 === 0) {
      console.log(`📰 Event progress: ${counter.eventCounter}/${counter.eventTarget} messages`);
    }
    
    if (counter.eventCounter >= counter.eventTarget) {
      // Trigger event!
      const oldTarget = counter.eventTarget;
      counter.eventCounter = 0;
      counter.eventTarget = getRandomTarget(eventSettings.minMessages, eventSettings.maxMessages);
      
      // Save new target immediately
      saveCountersToDb(guildId, counter);
      
      console.log(`📰 Event target reached! Attempting to trigger event...`);
      try {
        const { event, affectedStocks, durationMinutes } = await triggerEvent(guildId, 'automatic');
        console.log(`📰 Event triggered:`, event?.name || 'No event', `Duration: ${durationMinutes} minutes`);
        await announceEvent(guildId, event, affectedStocks, durationMinutes);
        console.log(`📰 Market event triggered for guild ${guildId} after ${oldTarget} messages`);
      } catch (err) {
        console.error(`📰 ERROR triggering event:`, err);
      }
    }
  }
  
  // Count message for vault
  if (truckSettings.enabled && truckSettings.channelId) {
    counter.truckCounter++;
    shouldSave = true;
    
    // Log every 10 messages to see progress
    if (counter.truckCounter % 10 === 0) {
      console.log(`🏦 Vault progress: ${counter.truckCounter}/${counter.truckTarget} messages`);
    }
    
    if (counter.truckCounter >= counter.truckTarget) {
      // Spawn vault!
      const oldTarget = counter.truckTarget;
      counter.truckCounter = 0;
      counter.truckTarget = getRandomTarget(truckSettings.minMessages, truckSettings.maxMessages);
      
      // Save new target immediately
      saveCountersToDb(guildId, counter);
      
      console.log(`🏦 Vault target reached! Attempting spawn...`);
      try {
        const result = await spawnVault(guildId);
        console.log(`🏦 Vault spawn result: ${result}`);
        if (result) {
          console.log(`🏦 Vault spawned for guild ${guildId} after ${oldTarget} messages`);
        } else {
          console.log(`🏦 Vault spawn returned false for guild ${guildId}`);
        }
      } catch (err) {
        console.error(`🏦 ERROR spawning vault:`, err);
      }
    }
  }
  
  // Save counters to database periodically (every 10 messages to reduce writes)
  if (shouldSave && (counter.eventCounter % 10 === 0 || counter.truckCounter % 10 === 0)) {
    saveCountersToDb(guildId, counter);
  }
}

// Get current message progress (for admin panel)
function getMessageProgress(guildId) {
  const counter = messageCounters.get(guildId);
  if (!counter) return { eventProgress: 0, eventTarget: 0, truckProgress: 0, truckTarget: 0 };
  
  return {
    eventProgress: counter.eventCounter,
    eventTarget: counter.eventTarget,
    truckProgress: counter.truckCounter,
    truckTarget: counter.truckTarget
  };
}

// Reset counter for a specific type
function resetCounter(guildId, type) {
  const counter = initGuildCounter(guildId);
  
  if (type === 'event') {
    const settings = getEventSettings(guildId);
    counter.eventCounter = 0;
    counter.eventTarget = getRandomTarget(settings.minMessages, settings.maxMessages);
  } else if (type === 'truck') {
    const settings = getVaultSettings(guildId);
    counter.truckCounter = 0;
    counter.truckTarget = getRandomTarget(settings.minMessages, settings.maxMessages);
  }
  
  // Save to database
  saveCountersToDb(guildId, counter);
}

function getEventSettings(guildId) {
  if (guildEventSettings.has(guildId)) {
    return guildEventSettings.get(guildId);
  }
  
  if (db) {
    const result = db.exec('SELECT * FROM event_settings WHERE guild_id = ?', [guildId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const settings = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
      
      const parsed = {
        enabled: settings.enabled === 1,
        channelId: settings.channel_id,
        minMessages: settings.min_messages || 500,
        maxMessages: settings.max_messages || 2000,
        minDurationMinutes: settings.min_duration_minutes || 15,
        maxDurationMinutes: settings.max_duration_minutes || 60,
        positiveWeight: settings.positive_weight,
        negativeWeight: settings.negative_weight,
        neutralWeight: settings.neutral_weight,
        lastEventTime: settings.last_event_time
      };
      
      guildEventSettings.set(guildId, parsed);
      return parsed;
    }
  }
  
  // Return defaults
  return {
    enabled: false,
    channelId: null,
    minMessages: 500,
    maxMessages: 2000,
    minDurationMinutes: 15,
    maxDurationMinutes: 60,
    positiveWeight: 40,
    negativeWeight: 40,
    neutralWeight: 20,
    lastEventTime: 0
  };
}

function updateEventSettings(guildId, updates) {
  if (!db) return;
  
  const current = getEventSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO event_settings 
    (guild_id, enabled, channel_id, min_messages, max_messages, min_duration_minutes, max_duration_minutes, positive_weight, negative_weight, neutral_weight, last_event_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.channelId,
    settings.minMessages,
    settings.maxMessages,
    settings.minDurationMinutes,
    settings.maxDurationMinutes,
    settings.positiveWeight,
    settings.negativeWeight,
    settings.neutralWeight,
    settings.lastEventTime
  ]);
  
  guildEventSettings.set(guildId, settings);
  
  // Update counter target if range changed
  if (updates.minMessages !== undefined || updates.maxMessages !== undefined) {
    resetCounter(guildId, 'event');
  }
}

function getRandomEvent(guildId) {
  const settings = getEventSettings(guildId);
  
  // Calculate total weight
  const totalWeight = settings.positiveWeight + settings.negativeWeight + settings.neutralWeight;
  const roll = Math.random() * totalWeight;
  
  let eventType;
  if (roll < settings.positiveWeight) {
    eventType = 'positive';
  } else if (roll < settings.positiveWeight + settings.negativeWeight) {
    eventType = 'negative';
  } else {
    eventType = 'neutral';
  }
  
  // Get events of this type
  const events = DEFAULT_EVENTS.filter(e => e.type === eventType);
  const event = events[Math.floor(Math.random() * events.length)];
  
  // Calculate percent change
  let percentChange = 0;
  if (event.type !== 'neutral') {
    percentChange = event.minPercent + Math.random() * (event.maxPercent - event.minPercent);
    if (event.type === 'negative') {
      percentChange = -percentChange;
    }
  }
  
  return {
    ...event,
    percentChange: Math.round(percentChange * 10) / 10
  };
}

function applyEventToStocks(guildId, percentChange, durationMinutes = 30, eventName = 'Market Event') {
  if (percentChange === 0) return { durationMinutes };
  
  const multiplier = 1 + (percentChange / 100);
  const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
  
  // Store the active market event in memory
  activeMarketEvents.set(guildId, {
    multiplier,
    percentChange,
    expiresAt,
    eventName
  });
  
  // Persist to database so it survives restarts
  saveActiveEvent(guildId, multiplier, percentChange, expiresAt, eventName);
  
  // Refresh last known prices to prevent false stock alerts
  try {
    const { refreshLastKnownPrices } = require('./ticker');
    refreshLastKnownPrices(guildId);
  } catch (e) {
    // Ticker not loaded yet, that's fine
  }
  
  // Schedule removal of the event and announce when it ends
  scheduleEventEnd(guildId, expiresAt, eventName, percentChange, durationMinutes);
  
  return { durationMinutes }; // Return duration for use in announcement
}

// Get the active market multiplier for a guild
function getMarketEventMultiplier(guildId) {
  const event = activeMarketEvents.get(guildId);
  
  if (!event) return 1.0;
  
  // Check if expired
  if (Date.now() > event.expiresAt) {
    activeMarketEvents.delete(guildId);
    return 1.0;
  }
  
  return event.multiplier;
}

// Get active event info for display
function getActiveMarketEvent(guildId) {
  const event = activeMarketEvents.get(guildId);
  
  if (!event) return null;
  
  // Check if expired
  if (Date.now() > event.expiresAt) {
    activeMarketEvents.delete(guildId);
    return null;
  }
  
  return {
    name: event.eventName,
    multiplier: event.multiplier,
    percentChange: event.percentChange,
    expiresAt: event.expiresAt,
    remainingMinutes: Math.ceil((event.expiresAt - Date.now()) / 60000)
  };
}

function logEvent(guildId, event, affectedStocks, triggeredBy = 'system') {
  if (!db) return;
  
  // affectedStocks is now an object { durationMinutes }, not an array
  const stocksJson = JSON.stringify([]);
  
  db.run(`
    INSERT INTO event_history (guild_id, event_id, event_name, event_type, percent_change, affected_stocks, triggered_by, triggered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    event.id,
    event.name,
    event.type,
    event.percentChange,
    stocksJson,
    triggeredBy,
    Date.now()
  ]);
  
  // Update last event time
  updateEventSettings(guildId, { lastEventTime: Date.now() });
}

function getEventHistory(guildId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`
    SELECT * FROM event_history 
    WHERE guild_id = ? 
    ORDER BY triggered_at DESC 
    LIMIT ?
  `, [guildId, limit]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  return result[0].values.map(row => {
    const cols = result[0].columns;
    return cols.reduce((obj, col, i) => ({ ...obj, [col]: row[i] }), {});
  });
}

async function triggerEvent(guildId, triggeredBy = 'system') {
  const settings = getEventSettings(guildId);
  const event = getRandomEvent(guildId);
  
  // Random duration between min and max
  const durationMinutes = Math.floor(Math.random() * (settings.maxDurationMinutes - settings.minDurationMinutes + 1)) + settings.minDurationMinutes;
  
  const affectedStocks = applyEventToStocks(guildId, event.percentChange, durationMinutes, event.name);
  
  logEvent(guildId, event, affectedStocks, triggeredBy);
  
  return { event, affectedStocks, durationMinutes };
}

async function announceEvent(guildId, event, affectedStocks, durationMinutes = 30) {
  const settings = getEventSettings(guildId);
  
  if (!settings.channelId || !client) return false;
  
  try {
    const channel = await client.channels.fetch(settings.channelId);
    if (!channel) return false;
    
    const { EmbedBuilder } = require('discord.js');
    
    const colorMap = { positive: 0x2ecc71, negative: 0xe74c3c, neutral: 0x95a5a6 };
    const emojiMap = { positive: '📈', negative: '📉', neutral: '📊' };
    
    // Calculate expiration timestamp for Discord countdown
    const expiresAt = Math.floor((Date.now() + durationMinutes * 60 * 1000) / 1000);
    
    const embed = new EmbedBuilder()
      .setColor(colorMap[event.type])
      .setTitle(`${emojiMap[event.type]} MARKET EVENT: ${event.name}`)
      .setDescription(event.flavor)
      .setTimestamp();
    
    if (event.type !== 'neutral') {
      const changeText = event.percentChange > 0 
        ? `+${event.percentChange}%` 
        : `${event.percentChange}%`;
      
      embed.addFields({
        name: 'Market Impact',
        value: `All stock prices are temporarily affected by **${changeText}**`,
        inline: false
      });
      
      embed.addFields({
        name: '⏱️ Duration',
        value: `Ends <t:${expiresAt}:R> (at <t:${expiresAt}:t>)`,
        inline: false
      });
    } else {
      embed.addFields({
        name: 'Market Impact',
        value: 'No price changes',
        inline: false
      });
    }
    
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('Failed to announce event:', err);
    return false;
  }
}

async function announceEventEnd(guildId, eventName, percentChange) {
  const settings = getEventSettings(guildId);
  
  if (!settings.channelId || !client) return false;
  
  try {
    const channel = await client.channels.fetch(settings.channelId);
    if (!channel) return false;
    
    const { EmbedBuilder } = require('discord.js');
    
    const wasPositive = percentChange > 0;
    const emoji = wasPositive ? '📉' : '📈';
    const color = 0x95a5a6; // Gray for ended event
    
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${emoji} EVENT ENDED: ${eventName}`)
      .setDescription(`The market event "**${eventName}**" has concluded.`)
      .addFields({
        name: '📊 Market Status',
        value: 'Stock prices have returned to normal.',
        inline: false
      })
      .setTimestamp()
      .setFooter({ text: 'Markets stabilized' });
    
    await channel.send({ embeds: [embed] });
    console.log(`📰 Event ended announcement sent for guild ${guildId}: ${eventName}`);
    return true;
  } catch (err) {
    console.error('Failed to announce event end:', err);
    return false;
  }
}

// Scheduler for automatic events - now message-based
function startEventScheduler(guildId) {
  const counter = initGuildCounter(guildId);
  const settings = getEventSettings(guildId);
  counter.eventCounter = 0;
  counter.eventTarget = getRandomTarget(settings.minMessages, settings.maxMessages);
  console.log(`📰 Market event counter started for guild ${guildId} (target: ${counter.eventTarget} messages)`);
}

function stopEventScheduler(guildId) {
  const counter = messageCounters.get(guildId);
  if (counter) {
    counter.eventCounter = 0;
    counter.eventTarget = Infinity; // Effectively disable
  }
}

// ============== VAULT SYSTEM ==============

function getVaultSettings(guildId) {
  if (!db) return { enabled: false, channelId: null, minMessages: 200, maxMessages: 1000, minReward: 100, maxReward: 10000 };
  
  const result = db.exec('SELECT * FROM cheese_truck_settings WHERE guild_id = ?', [guildId]);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const settings = cols.reduce((obj, col, i) => ({ ...obj, [col]: vals[i] }), {});
    
    return {
      enabled: settings.enabled === 1,
      channelId: settings.channel_id,
      minMessages: settings.min_messages || 200,
      maxMessages: settings.max_messages || 1000,
      minReward: settings.min_reward || 100,
      maxReward: settings.max_reward || 10000
    };
  }
  
  return { enabled: false, channelId: null, minMessages: 200, maxMessages: 1000, minReward: 100, maxReward: 10000 };
}

function updateVaultSettings(guildId, updates) {
  if (!db) return;
  
  const current = getVaultSettings(guildId);
  const settings = { ...current, ...updates };
  
  db.run(`
    INSERT OR REPLACE INTO cheese_truck_settings 
    (guild_id, enabled, channel_id, min_messages, max_messages, min_reward, max_reward)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    guildId,
    settings.enabled ? 1 : 0,
    settings.channelId,
    settings.minMessages,
    settings.maxMessages,
    settings.minReward,
    settings.maxReward
  ]);
  
  // Update counter target if range changed
  if (updates.minMessages !== undefined || updates.maxMessages !== undefined) {
    resetCounter(guildId, 'truck');
  }
}

async function spawnVault(guildId) {
  const settings = getVaultSettings(guildId);
  
  console.log(`🏦 Attempting to spawn vault for guild ${guildId}:`, {
    enabled: settings.enabled,
    channelId: settings.channelId,
    hasClient: !!client
  });
  
  if (!settings.enabled) {
    console.log('🏦 Vault not enabled');
    return false;
  }
  if (!settings.channelId) {
    console.log('🏦 No channel ID set');
    return false;
  }
  if (!client) {
    console.log('🏦 No client available');
    return false;
  }
  
  try {
    const channel = await client.channels.fetch(settings.channelId);
    if (!channel) {
      console.log(`🏦 Could not fetch channel ${settings.channelId}`);
      return false;
    }
    console.log(`🏦 Found channel: ${channel.name}`);
    
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const { addMoney } = require('./economy');
    
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('🏦 VAULT OPENED!')
      .setDescription('**A vault has been discovered!**\n\nFirst 3 people to claim it get rewarded!')
      .setImage(VAULT_IMAGE)
      .setFooter({ text: 'Quick! This disappears in 60 seconds!' })
      .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('vault_grab')
        .setLabel('Claim!')
        .setEmoji('💰')
        .setStyle(ButtonStyle.Success)
    );
    
    const message = await channel.send({ embeds: [embed], components: [row] });
    
    // Determine if there's a booby trap (30% chance) and which slot (1, 2, or 3)
    const hasBoobyTrap = Math.random() < 0.30;
    const boobyTrapSlot = hasBoobyTrap ? Math.floor(Math.random() * 3) + 1 : null;
    
    // Track this vault
    activeVaults.set(message.id, {
      guildId,
      collectors: new Set(),
      rewards: [],
      minReward: settings.minReward,
      maxReward: settings.maxReward,
      boobyTrapSlot: boobyTrapSlot,
      boobyTrapTriggered: false
    });
    
    // Set up button collector
    const collector = message.createMessageComponentCollector({ 
      time: 60000 // 60 seconds
    });
    
    collector.on('collect', async (interaction) => {
      const vaultData = activeVaults.get(message.id);
      if (!vaultData) return;
      
      // Check if user already claimed
      if (vaultData.collectors.has(interaction.user.id)) {
        return interaction.reply({ content: '❌ You already claimed from this vault!', ephemeral: true });
      }
      
      // Check if all 3 spots taken
      if (vaultData.collectors.size >= 3) {
        return interaction.reply({ content: '❌ The vault is empty!', ephemeral: true });
      }
      
      // Add user as collector
      vaultData.collectors.add(interaction.user.id);
      const currentSlot = vaultData.collectors.size; // 1, 2, or 3
      
      // Check if this slot is the booby trap
      if (vaultData.boobyTrapSlot === currentSlot && !vaultData.boobyTrapTriggered) {
        vaultData.boobyTrapTriggered = true;
        
        // Generate penalty (same range as reward)
        const penalty = Math.floor(Math.random() * (vaultData.maxReward - vaultData.minReward + 1)) + vaultData.minReward;
        vaultData.rewards.push({ userId: interaction.user.id, username: interaction.user.username, reward: -penalty, isTrap: true });
        
        // Take money
        try {
          const { applyFine } = require('./economy');
          await applyFine(guildId, interaction.user.id, penalty, 'Vault Booby Trap');
        } catch (e) {
          console.error('Failed to remove vault penalty:', e);
        }
        
        await interaction.reply({ 
          content: `💥 **BOOBY TRAP!** ${interaction.user.username} triggered a security system and lost **${penalty.toLocaleString()}** ${CURRENCY}! 🚨`
        });
      } else {
        // Normal reward
        const reward = Math.floor(Math.random() * (vaultData.maxReward - vaultData.minReward + 1)) + vaultData.minReward;
        vaultData.rewards.push({ userId: interaction.user.id, username: interaction.user.username, reward });
        
        try {
          await addMoney(guildId, interaction.user.id, reward, 'Vault');
        } catch (e) {
          console.error('Failed to add vault reward:', e);
        }
        
        await interaction.reply({ 
          content: `💰 **${interaction.user.username}** claimed **${reward.toLocaleString()}** ${CURRENCY} from the vault!`
        });
      }
      
      // Check if all 3 spots filled
      if (vaultData.collectors.size >= 3) {
        collector.stop('full');
      }
    });
    
    collector.on('end', async (collected, reason) => {
      const vaultData = activeVaults.get(message.id);
      activeVaults.delete(message.id);
      
      // Log to history
      if (vaultData) {
        const totalPayout = vaultData.rewards.reduce((sum, r) => sum + r.reward, 0);
        const hadBoobyTrap = vaultData.rewards.some(r => r.isTrap) ? 1 : 0;
        const winnersJson = JSON.stringify(vaultData.rewards);
        
        try {
          db.run(`INSERT INTO cheese_truck_history (guild_id, triggered_at, winners, total_payout, had_booby_trap) VALUES (?, ?, ?, ?, ?)`,
            [guildId, Date.now(), winnersJson, totalPayout, hadBoobyTrap]);
        } catch (e) {
          console.error('Failed to log vault history:', e);
        }
      }
      
      // Build results
      let resultsText = '';
      if (vaultData && vaultData.rewards.length > 0) {
        resultsText = vaultData.rewards.map((r, i) => {
          if (r.isTrap) {
            return `${i + 1}. 💥 **${r.username}** - ${r.reward.toLocaleString()} ${CURRENCY} (BOOBY TRAP!)`;
          }
          return `${i + 1}. 💰 **${r.username}** - +${r.reward.toLocaleString()} ${CURRENCY}`;
        }).join('\n');
      } else {
        resultsText = 'Nobody claimed the vault!';
      }
      
      const endEmbed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🏦 VAULT CLOSED!')
        .setDescription(`The vault has been sealed!\n\n**Results:**\n${resultsText}`)
        .setImage(VAULT_IMAGE)
        .setTimestamp();
      
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('vault_grab_disabled')
          .setLabel('Closed!')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      
      try {
        await message.edit({ embeds: [endEmbed], components: [disabledRow] });
      } catch (e) {
        // Message may have been deleted
      }
    });
    
    return true;
  } catch (err) {
    console.error('Failed to spawn vault:', err);
    return false;
  }
}

// Vault scheduler - now message-based
function startVaultScheduler(guildId) {
  const counter = initGuildCounter(guildId);
  const settings = getVaultSettings(guildId);
  counter.truckCounter = 0;
  counter.truckTarget = getRandomTarget(settings.minMessages, settings.maxMessages);
  console.log(`🏦 Vault counter started for guild ${guildId} (target: ${counter.truckTarget} messages)`);
}

function stopVaultScheduler(guildId) {
  const counter = messageCounters.get(guildId);
  if (counter) {
    counter.truckCounter = 0;
    counter.truckTarget = Infinity; // Effectively disable
  }
}

function getVaultHistory(guildId, limit = 10) {
  if (!db) return [];
  
  const result = db.exec(`SELECT * FROM cheese_truck_history WHERE guild_id = ? ORDER BY triggered_at DESC LIMIT ?`, [guildId, limit]);
  
  if (result.length === 0 || result[0].values.length === 0) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = cols.reduce((o, col, i) => ({ ...o, [col]: row[i] }), {});
    try {
      obj.winners = JSON.parse(obj.winners || '[]');
    } catch (e) {
      obj.winners = [];
    }
    return obj;
  });
}

module.exports = {
  initEvents,
  handleMessage,
  getEventSettings,
  updateEventSettings,
  getRandomEvent,
  triggerEvent,
  announceEvent,
  getEventHistory,
  startEventScheduler,
  stopEventScheduler,
  getMarketEventMultiplier,
  getActiveMarketEvent,
  getMessageProgress,
  DEFAULT_EVENTS,
  // Vault
  getVaultSettings,
  updateVaultSettings,
  spawnVault,
  startVaultScheduler,
  stopVaultScheduler,
  getVaultHistory
};
