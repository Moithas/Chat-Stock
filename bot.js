require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes, ActivityType } = require('discord.js');
const { initDatabase, createUser, updateMessageCount, calculateStockPrice, logPrice, getUser, getDb, getStreakInfo, shutdownDatabase } = require('./database');
const { initTicker, sendStreakAnnouncement, sendStreakExpiredAnnouncement } = require('./ticker');
const { initFees } = require('./fees');
const { initAntiSpam, shouldCountMessage, shouldCountButtonInteraction, getSpamSettings } = require('./antispam');
const { initAdmin, getCurrency } = require('./admin');
const { initMarketProtection } = require('./market');
const { initProperty, scheduleCardDistribution } = require('./property');
const { initEvents, handleMessage: handleEventMessage } = require('./events');
const { initGambling, getGamblingSettings, getAllTickets, drawLottery, getLotteryInfo, cleanupStaleBlackjackGames } = require('./gambling');
const { initDividends, startDividendScheduler } = require('./dividends');
const { initWork } = require('./work');
const { initCrime } = require('./crime');
const { initSlut } = require('./slut');
const { initRob, startImmunityScheduler } = require('./rob');
const { initHack, cleanupStaleHacks } = require('./hack');
const { initFight, cleanupStaleFights } = require('./fight');
const { initBank, startBankScheduler } = require('./bank');
const { addMoney } = require('./economy');
const { initWealthTax, getWealthTaxSettings, collectWealthTax, getLotteryInfo: getWealthTaxLotteryInfo } = require('./wealth-tax');
const { initSkills } = require('./skills');
const { initItems, getExpiredRoleGrants, removeRoleGrantRecord } = require('./items');
const { initCooldownTracker, startAllTrackers } = require('./cooldown-tracker');
const { initialize: initInBetween, cleanupStaleGames: cleanupStaleInBetween } = require('./inbetween');
const { initialize: initLetItRide, cleanupStaleGames: cleanupStaleLetItRide } = require('./letitride');
const { initialize: initThreeCardPoker, cleanupStaleGames: cleanupStaleThreeCardPoker } = require('./threecardpoker');
const { initialize: initVideoPoker, cleanupStaleGames: cleanupStaleVideoPoker } = require('./videopoker');
const { initMaintenance, startCleanupScheduler, logError, checkCommandCooldown, updateCommandCooldown, trackCommandUsage } = require('./maintenance');
const { initDungeon, cleanupStaleRuns: cleanupStaleDungeons } = require('./dungeon');
const { initHunt } = require('./hunt');
const log = require('./logger');
const { initSYN, cleanupStaleGames: cleanupStaleSYN } = require('./screwyourneighbor');
const { initLuckyPenny } = require('./luckypenny');
const { initBumpReward, getBumpSettings, getBumpStats, isDisboardBump, extractBumperUserId, rollBumpReward, recordBump } = require('./bumpreward');
const { initInfamy, decayAllInfamy } = require('./infamy');
const { initPrestige } = require('./prestige');
const { initPets } = require('./pets');
const { initPremium } = require('./premium');
const fs = require('fs');
const path = require('path');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.Message,
    Partials.Channel
  ]
});

client.commands = new Collection();

// Load command files
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  // Skip commands with no data (e.g., legacy button handlers)
  if (command.data) {
    client.commands.set(command.data.name, command);
  }
}

// Lottery auto-draw scheduler
let lastDrawCheck = null;

function startLotteryScheduler(client) {
  // Check every minute
  setInterval(async () => {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Create a key for this minute to avoid duplicate draws
    const checkKey = `${currentDay}-${currentHour}-${currentMinute}`;
    if (checkKey === lastDrawCheck) return;
    
    // Check all guilds
    for (const guild of client.guilds.cache.values()) {
      try {
        const settings = getGamblingSettings(guild.id);
        
        // Skip if auto-draw not enabled or schedule not set
        if (!settings.lottery_auto_draw) continue;
        if (settings.lottery_draw_day === null || settings.lottery_draw_hour === null) continue;
        
        // Check if it's time to draw
        if (currentDay === settings.lottery_draw_day && 
            currentHour === settings.lottery_draw_hour &&
            currentMinute === (settings.lottery_draw_minute || 0)) {
          
          const tickets = getAllTickets(guild.id);
          if (tickets.length === 0) continue;
          
          console.log(`🎰 Auto-drawing lottery for guild ${guild.name}`);
          
          const result = drawLottery(guild.id);
          
          // Pay out winners
          const winners = result.results.filter(r => r.prize > 0);
          for (const winner of winners) {
            await addMoney(guild.id, winner.userId, winner.prize, `Lottery win (${winner.matches} matches)`);
          }
          
          // Announce in channel if set
          if (settings.lottery_channel_id) {
            try {
              const channel = await client.channels.fetch(settings.lottery_channel_id);
              if (channel) {
                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                  .setColor(0xf1c40f)
                  .setTitle('🎰 AUTOMATIC LOTTERY DRAW!')
                  .setDescription(`🎱 **Winning Numbers: ${result.winningNumbers.join(' - ')}**`)
                  .addFields(
                    { name: '🎟️ Total Tickets', value: `**${result.totalTickets}**`, inline: true },
                    { name: '💸 Total Prizes', value: `**${result.totalPrizesPaid.toLocaleString()}** ${getCurrency(guild.id)}`, inline: true }
                  );

                if (result.jackpotWon) {
                  embed.addFields({
                    name: '🎊 JACKPOT WINNER!',
                    value: `Someone won the **${result.jackpotAmount.toLocaleString()}** ${getCurrency(guild.id)} jackpot!`
                  });
                }

                if (winners.length > 0) {
                  const by4 = winners.filter(w => w.matches === 4);
                  const by3 = winners.filter(w => w.matches === 3);
                  const by2 = winners.filter(w => w.matches === 2);

                  let winnerText = '';
                  if (by4.length > 0) {
                    winnerText += `**🏆 4 Matches (JACKPOT):**\n${by4.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${getCurrency(guild.id)}`).join('\n')}\n\n`;
                  }
                  if (by3.length > 0) {
                    winnerText += `**🥈 3 Matches:**\n${by3.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${getCurrency(guild.id)}`).join('\n')}\n\n`;
                  }
                  if (by2.length > 0) {
                    winnerText += `**🥉 2 Matches:**\n${by2.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${getCurrency(guild.id)}`).join('\n')}`;
                  }
                  embed.addFields({ name: '🏅 Winners', value: winnerText || 'None' });
                } else {
                  embed.addFields({ name: '😢 No Winners', value: 'No one matched 2 or more numbers this draw.' });
                }

                const newInfo = getLotteryInfo(guild.id);
                embed.addFields({ name: '💰 New Jackpot', value: `**${newInfo.jackpot.toLocaleString()}** ${getCurrency(guild.id)}` });
                embed.setFooter({ text: 'Thanks for playing! Next draw coming soon.' }).setTimestamp();

                await channel.send({ embeds: [embed] });
              }
            } catch (e) {
              logError({ guildId: guild.id, command: 'lottery_announce', error: e });
            }
          }
        }
      } catch (e) {
        logError({ guildId: guild.id, command: 'lottery_scheduler', error: e });
      }
    }
    
    lastDrawCheck = checkKey;
  }, 60000); // Check every minute
  
  console.log('🎰 Lottery scheduler started');
}

// Wealth Tax collection scheduler
let lastWealthTaxCheck = null;

function startWealthTaxScheduler(client) {
  // Check every minute
  setInterval(async () => {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Only check at minute 0 to avoid multiple collections
    if (currentMinute !== 0) return;
    
    // Create a key for this hour to avoid duplicate collections
    const checkKey = `wt-${currentDay}-${currentHour}`;
    if (checkKey === lastWealthTaxCheck) return;
    
    // Check all guilds
    for (const guild of client.guilds.cache.values()) {
      try {
        const settings = getWealthTaxSettings(guild.id);
        
        // Skip if not enabled or not the right day/hour
        if (!settings.enabled) continue;
        if (settings.collectionDay !== currentDay) continue;
        if (settings.collectionHour !== currentHour) continue;
        
        console.log(`💰 Collecting wealth tax for guild ${guild.name}`);
        
        const result = await collectWealthTax(guild.id);
        
        if (result.success && result.totalCollected > 0) {
          // Try to announce in the configured wealth tax channel
          const wealthTaxSettings = getWealthTaxSettings(guild.id);
          if (wealthTaxSettings.announcementChannelId) {
            try {
              const channel = await client.channels.fetch(wealthTaxSettings.announcementChannelId);
              if (channel) {
                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                  .setColor(0xe74c3c)
                  .setTitle('💰 WEEKLY WEALTH TAX COLLECTED')
                  .setDescription('The wealth tax has been collected and added to the lottery jackpot!')
                  .addFields(
                    { name: '📊 Users Taxed', value: `**${result.usersAffected}**`, inline: true },
                    { name: '💸 Total Collected', value: `**${result.totalCollected.toLocaleString()}** ${getCurrency(guild.id)}`, inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: '🎰 Previous Jackpot', value: `${result.previousJackpot.toLocaleString()} ${getCurrency(guild.id)}`, inline: true },
                    { name: '🎰 New Jackpot', value: `**${result.newJackpot.toLocaleString()}** ${getCurrency(guild.id)}`, inline: true }
                  )
                  .setFooter({ text: 'Buy lottery tickets to win the boosted jackpot!' })
                  .setTimestamp();
                
                // Show top taxpayers
                if (result.collections.length > 0) {
                  // Show users who had forced liquidation
                  const liquidations = result.collections.filter(c => c.stocksSold && c.stocksSold.length > 0);
                  if (liquidations.length > 0) {
                    const liquidationText = liquidations.map(c => {
                      const sold = c.stocksSold.map(s => `${s.shares} ${s.username}`).join(', ');
                      return `<@${c.userId}>: Liquidated ${sold}`;
                    }).join('\n');
                    embed.addFields({ name: '📉 Forced Liquidations', value: liquidationText });
                  }
                }
                
                await channel.send({ embeds: [embed] });
              }
            } catch (e) {
              logError({ guildId: guild.id, command: 'wealth_tax_announce', error: e });
            }
          }
        }
      } catch (e) {
        logError({ guildId: guild.id, command: 'wealth_tax_scheduler', error: e });
      }
    }
    
    lastWealthTaxCheck = checkKey;
  }, 60000); // Check every minute
  
  console.log('💰 Wealth tax scheduler started');
}

// Role expiration scheduler - removes temporary roles that have expired
function startRoleExpirationScheduler(client) {
  setInterval(async () => {
    try {
      const expiredGrants = getExpiredRoleGrants();
      
      if (expiredGrants.length > 0) {
        console.log(`🏷️ Found ${expiredGrants.length} expired role grant(s) to process`);
      }
      
      for (const grant of expiredGrants) {
        try {
          // Use fetch instead of cache to ensure we get fresh data
          const guild = await client.guilds.fetch(grant.guild_id).catch(() => null);
          if (!guild) {
            console.log(`🏷️ Guild ${grant.guild_id} not accessible, removing record`);
            removeRoleGrantRecord(grant.guild_id, grant.user_id, grant.role_id);
            continue;
          }
          
          const member = await guild.members.fetch(grant.user_id).catch(() => null);
          if (!member) {
            console.log(`🏷️ Member ${grant.user_id} not found in ${guild.name}, removing record`);
            removeRoleGrantRecord(grant.guild_id, grant.user_id, grant.role_id);
            continue;
          }
          
          // Fetch fresh role data
          const role = await guild.roles.fetch(grant.role_id).catch(() => null);
          if (!role) {
            console.log(`🏷️ Role ${grant.role_id} was deleted, removing record`);
            removeRoleGrantRecord(grant.guild_id, grant.user_id, grant.role_id);
            continue;
          }
          
          // Try to remove the role (like bond system does - don't check first, just try)
          try {
            await member.roles.remove(grant.role_id, `Temporary role expired (from shop item: ${grant.source_item_name})`);
            console.log(`🏷️ Removed expired role ${role.name} from ${member.user.username} in ${guild.name}`);
          } catch (roleError) {
            // Only log if it's not a "user doesn't have role" error
            if (roleError.code !== 10011) { // Unknown Role error
              console.error(`🏷️ Failed to remove role ${role.name} from ${member.user.username}: ${roleError.message}`);
            }
          }
          
          // Remove the record
          removeRoleGrantRecord(grant.guild_id, grant.user_id, grant.role_id);
          
        } catch (error) {
          console.error(`Error removing expired role:`, error);
          // Still remove the record to prevent infinite retry
          removeRoleGrantRecord(grant.guild_id, grant.user_id, grant.role_id);
        }
      }
    } catch (error) {
      console.error('Error in role expiration scheduler:', error);
    }
  }, 60000); // Check every minute
  
  console.log('🏷️ Role expiration scheduler started');
}

// When bot is ready
client.once('clientReady', async () => {
  log.info(`Logged in as ${client.user.username}`);
  
  // Initialize database first
  await initDatabase();
  
  // Internal economy is always enabled (no initialization needed)
  log.info('Internal economy system enabled');
  
  // Initialize trading fees system
  initFees(getDb());
  
  // Initialize anti-spam system
  initAntiSpam(getDb());
  
  // Initialize admin system
  initAdmin(getDb(), client);
  
  // Initialize market protection system
  initMarketProtection(getDb());

  // Initialize property system
  initProperty(getDb());
  
  // Schedule daily card distribution (at midnight)
  scheduleCardDistribution(getDb());

  // Initialize events system
  initEvents(getDb(), client);

  // Initialize gambling system
  initGambling(getDb());

  // Initialize dividend system
  initDividends(getDb());

  // Initialize work system
  initWork(getDb());

  // Initialize crime system
  initCrime(getDb());

  // Initialize slut system
  initSlut(getDb());

  // Initialize rob system
  initRob(getDb());

  // Initialize hack system
  initHack(getDb());

  // Initialize skills system
  initSkills(getDb());

  // Initialize fight system
  initFight(getDb());

  // Initialize bank system
  initBank(getDb());

  // Initialize wealth tax system
  initWealthTax(getDb());

  // Initialize items/shop system
  initItems(getDb());

  // Initialize In Between card game
  initInBetween(getDb());

  // Initialize Let It Ride card game
  initLetItRide(getDb());

  // Initialize Three Card Poker game
  initThreeCardPoker(getDb());

  // Initialize Video Poker game
  initVideoPoker(getDb());

  // Initialize dungeon system
  initDungeon(getDb());

  // Initialize hunt system
  initHunt(getDb());

  // Initialize Screw Your Neighbor
  initSYN(getDb());

  // Initialize Lucky Penny system
  initLuckyPenny(getDb());

  // Initialize bump reward system
  initBumpReward(getDb());

  // Initialize infamy & bounty system
  initInfamy(getDb(), client);

  // Initialize prestige system
  initPrestige(getDb());

  // Initialize pet system
  initPets(getDb());

  // Initialize premium tier system
  initPremium(getDb());

  // Initialize maintenance system (cleanup, error logging, rate limiting)
  initMaintenance(getDb(), client);

  // Start lottery auto-draw scheduler
  startLotteryScheduler(client);

  // Start wealth tax scheduler
  startWealthTaxScheduler(client);

  // Start dividend payout scheduler
  startDividendScheduler(client);

  // Start bank payment/bond scheduler
  startBankScheduler(client);

  // Start rob immunity expiration scheduler
  startImmunityScheduler(client);

  // Start database cleanup scheduler (daily at 4 AM)
  startCleanupScheduler();

  // Initialize stock ticker
  initTicker(client);

  // Initialize cooldown tracker
  initCooldownTracker(getDb(), client);
  startAllTrackers();
  
  // Start role expiration scheduler (for temporary shop roles)
  startRoleExpirationScheduler(client);

  // Start infamy decay scheduler (hourly)
  setInterval(() => decayAllInfamy(), 3600000);

  // Start stale game cleanup (every 5 minutes)
  setInterval(() => {
    cleanupStaleBlackjackGames();
    cleanupStaleHacks();
    cleanupStaleFights();
    cleanupStaleInBetween();
    cleanupStaleLetItRide();
    cleanupStaleThreeCardPoker();
    cleanupStaleVideoPoker();
    cleanupStaleDungeons();
    cleanupStaleSYN();
  }, 5 * 60 * 1000);
  
  // Register slash commands (only when definitions change, to preserve Discord integration overrides)
  const commands = [];
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    // Skip commands with no data (e.g., legacy button handlers)
    if (command.data) {
      commands.push(command.data.toJSON());
    }
  }

  const crypto = require('crypto');
  const commandHash = crypto.createHash('md5').update(JSON.stringify(commands)).digest('hex');
  const hashFile = require('path').join(__dirname, '.command-hash');
  let previousHash = '';
  try { previousHash = require('fs').readFileSync(hashFile, 'utf8').trim(); } catch (e) {}

  if (commandHash !== previousHash) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    try {
      log.info('Command definitions changed — registering slash commands...');
      
      // Clear global commands (to prevent duplicates with guild commands)
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: [] }
      );
      log.info('Cleared global commands');
      
      // Register per-guild for instant availability (no duplicates)
      for (const guild of client.guilds.cache.values()) {
        try {
          await rest.put(
            Routes.applicationGuildCommands(client.user.id, guild.id),
            { body: commands }
          );
          log.info(`Slash commands registered for guild: ${guild.name}`);
        } catch (guildError) {
          console.error(`Error registering commands for guild ${guild.name}:`, guildError.message);
        }
      }
      
      require('fs').writeFileSync(hashFile, commandHash);
      log.info('Command hash saved — future restarts will skip registration');
    } catch (error) {
      console.error('Error registering commands:', error);
    }
  } else {
    log.info('Slash commands unchanged — skipping registration (preserving integration overrides)');
  }

  // Rotating status messages
  const statuses = [
    { type: ActivityType.Watching, name: 'Watching the market 📈' },
    { type: ActivityType.Playing, name: 'Analyzing stocks' },
    { type: ActivityType.Playing, name: 'Auditing the vault' },
    { type: ActivityType.Playing, name: 'Printing dividends' },
    { type: ActivityType.Playing, name: 'Managing your portfolio' },
    { type: ActivityType.Watching, name: 'Watchingbank deposits' },
    { type: ActivityType.Playing, name: 'Scratching tickets' },
    { type: ActivityType.Playing, name: 'House always wins' },
    { type: ActivityType.Playing, name: 'Collecting rent 🏠' },
    { type: ActivityType.Playing, name: 'Appraising real estate' },
    { type: ActivityType.Playing, name: 'Flipping properties' },
    { type: ActivityType.Watching, name: 'Watching for robbers 👀' },
    { type: ActivityType.Playing, name: 'Guarding the vault 🏦' },
    { type: ActivityType.Playing, name: '/balance your life choices' },
    { type: ActivityType.Playing, name: '/help' },
  ];

  let statusIndex = 0;
  const updateStatus = () => {
    const status = statuses[statusIndex];
    client.user.setActivity(status.name, { type: status.type });
    statusIndex = (statusIndex + 1) % statuses.length;
  };

  // Set initial status and rotate every 3 minutes
  updateStatus();
  setInterval(updateStatus, 3 * 60 * 1000);
  log.info('Status rotation started');
});

// Handle bot joining a new guild
client.on('guildCreate', async (guild) => {
  log.info(`Joined new guild: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);
  
  // Send welcome embed to the first available text channel
  try {
    const { EmbedBuilder } = require('discord.js');
    const channel = guild.systemChannel || guild.channels.cache.find(
      ch => ch.isTextBased() && ch.permissionsFor(guild.members.me)?.has('SendMessages')
    );
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('📈 Welcome to Black Ledger!')
        .setDescription(
          'Thanks for adding me! I\'m a full-featured economy & stock market bot.\n\n' +
          '**Quick Start:**\n' +
          '• `/help` — Browse all features and commands\n' +
          '• `/balance` — Check your starting balance\n' +
          '• `/work` — Start earning money\n' +
          '• `/stock` — View and trade stocks\n\n' +
          '**Admin Setup:**\n' +
          '• `/admin` — Configure economy, gambling, items & more\n' +
          '• `/admin-items` — Add default shop items\n' +
          '• `/admin-maintenance` — Monitor bot health & usage\n\n' +
          '*All features work out of the box with sensible defaults. Admins can tweak everything via the admin panels.*'
        )
        .setFooter({ text: `Serving ${client.guilds.cache.size} servers` })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
  } catch (e) {
    log.warn('Could not send welcome message', { guild: guild.id, error: e.message });
  }
});

// Handle bot being removed from a guild
client.on('guildDelete', async (guild) => {
  log.info(`Removed from guild: ${guild.name} (${guild.id})`);
  // Guild data stays in DB for potential re-join. Active games are cleaned
  // by the 5-minute stale game cleanup interval. Settings caches are tiny
  // and will be naturally evicted on restart.
});

// Bump reward processing — track by message ID to prevent race conditions and duplicate payouts
const processedBumpMessages = new Set();
const processingBumpMessages = new Set();

// Clear processedBumpMessages every 6 hours to prevent unbounded growth
setInterval(() => {
  if (processedBumpMessages.size > 0) {
    console.log(`[GC] Clearing ${processedBumpMessages.size} processed bump message IDs`);
    processedBumpMessages.clear();
  }
}, 6 * 60 * 60 * 1000);

async function processBumpReward(message) {
  if (!message.author || !message.guildId) return;
  if (message.author.id !== '302050872383242240') return; // Not Disboard
  
  try {
    if (!isDisboardBump(message)) return;
    
    const msgId = message.id;
    console.log(`[BumpReward] Processing bump message ${msgId}, embeds: ${message.embeds?.length || 0}`);
    
    // Already rewarded or currently processing this exact message
    if (processedBumpMessages.has(msgId) || processingBumpMessages.has(msgId)) {
      console.log(`[BumpReward] Message ${msgId} already processed/processing, skipping`);
      return;
    }
    processingBumpMessages.add(msgId);
    
    try {
    const guildId = message.guildId;
    const settings = getBumpSettings(guildId);
    if (!settings.enabled) return;
    
    const bumperId = extractBumperUserId(message);
    if (!bumperId) {
      console.log('[BumpReward] Could not extract bumper user ID from Disboard message');
      return;
    }
    
    // Prevent double-rewarding (Disboard cooldown is 2 hours)
    const stats = getBumpStats(guildId, bumperId);
    if (stats.lastBump && (Date.now() - stats.lastBump) < 2 * 60 * 60 * 1000) return;
    
    const reward = rollBumpReward(settings.minReward, settings.maxReward);
    await addMoney(guildId, bumperId, reward);
    recordBump(guildId, bumperId, reward);
    processedBumpMessages.add(msgId);
    console.log(`[BumpReward] User ${bumperId} rewarded ${reward} for bumping`);
    
    if (settings.announce) {
      const channelId = settings.channelId || message.channelId;
      const channel = message.guild?.channels?.cache?.get(channelId) || message.channel;
      try {
        await channel.send({
          content: `📣 <@${bumperId}> bumped the server and earned **${reward.toLocaleString()}** ${getCurrency(guildId)}! Thanks for the bump!`
        });
      } catch (e) {
        logError({ guildId, command: 'bump_announce', error: e });
      }
    }
    } finally {
      processingBumpMessages.delete(msgId);
    }
  } catch (e) {
    logError({ guildId, userId: bumperId, command: 'bump_reward', error: e });
  }
}

// Listen for Disboard bump message edits (Disboard edits the embed onto its deferred response)
client.on('messageUpdate', async (oldMessage, newMessage) => {
  // Fetch partial if needed
  if (newMessage.partial) {
    try {
      newMessage = await newMessage.fetch();
    } catch (e) {
      return;
    }
  }
  
  // Only process recent messages (within last 5 minutes) to avoid rewarding old bumps on restart
  const messageAge = Date.now() - newMessage.createdTimestamp;
  if (messageAge > 5 * 60 * 1000) {
    return;
  }
  
  await processBumpReward(newMessage);
});

// Track messages for stock value
client.on('messageCreate', async (message) => {
  // Check for Disboard bump rewards (before bot filter)
  if (message.author.bot && message.guildId) {
    await processBumpReward(message);
  }

  // Ignore bots
  if (message.author.bot) return;
  
  const userId = message.author.id;
  const username = message.author.username;
  const guildId = message.guildId;
  
  // Create user if doesn't exist
  createUser(userId, username);
  
  // Check anti-spam before counting message
  const { shouldCount } = shouldCountMessage(guildId, userId, message.content);
  
  if (!shouldCount) {
    // Message doesn't count due to spam protection
    return;
  }
  
  // Update message count
  const spamSettings = getSpamSettings(guildId);
  updateMessageCount(Date.now(), userId, spamSettings.baseValueGrowth);
  
  // Check for streak milestones and announce
  const streakInfo = getStreakInfo(userId);
  if (streakInfo.newTier && streakInfo.tier > 0) {
    // Announce new streak tier
    sendStreakAnnouncement(userId, username, streakInfo.days, streakInfo.tier);
  } else if (streakInfo.expired) {
    // Announce streak expiration
    sendStreakExpiredAnnouncement(userId, username);
  }
  
  // Periodically log price (every 10 messages to avoid spam)
  const userMessages = getUser(userId);
  if (userMessages && userMessages.total_messages % 10 === 0) {
    const currentPrice = calculateStockPrice(userId, guildId);
    logPrice(userId, currentPrice, Date.now());
  }
  
  // Handle event message counting (vault, market events)
  handleEventMessage(message);
});

// Track emoji reactions toward activity
client.on('messageReactionAdd', async (reaction, user) => {
  // Ignore bots
  if (user.bot) return;
  
  const userId = user.id;
  const username = user.username;
  const guildId = reaction.message.guildId;
  
  // Create user if doesn't exist
  createUser(userId, username);
  
  // Check if reaction should count (respects same cooldown as buttons)
  const { shouldCount } = shouldCountButtonInteraction(guildId, userId);
  
  if (shouldCount) {
    // Count this reaction as activity
    const spamSettings = getSpamSettings(guildId);
    updateMessageCount(Date.now(), userId, spamSettings.baseValueGrowth);
  }
});

// Handle slash commands and interactions
client.on('interactionCreate', async (interaction) => {
  // Count slash commands toward stock price (only for actual slash commands, not buttons/modals)
  if (interaction.isChatInputCommand() && !interaction.user.bot) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const guildId = interaction.guildId;
    
    // Create user if doesn't exist
    createUser(userId, username);
    
    // Note: message count is tracked later in the main command handler (avoid double-counting)
    
    // Also count toward events (vault, market events)
    // Create a mock message object for handleEventMessage
    handleEventMessage({
      guild: interaction.guild,
      author: { bot: false, id: userId }
    });
  }

  // Count button clicks, select menu selections, and modals toward activity (with cooldown)
  if (!interaction.user.bot && (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit())) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    
    // Create user if doesn't exist
    createUser(userId, interaction.user.username);
    
    // Check if button interaction should count (respects cooldown)
    const { shouldCount, reason } = shouldCountButtonInteraction(guildId, userId);
    
    if (shouldCount) {
      // Count this interaction as activity
      const spamSettings = getSpamSettings(guildId);
      updateMessageCount(Date.now(), userId, spamSettings.baseValueGrowth);
    } else if (reason) {
      // Optionally log the cooldown reason for debugging
      // console.log(`[ANTISPAM] Button interaction blocked for ${interaction.user.username}: ${reason}`);
    }
  }

  // Debug logging for scratch buttons
  if (interaction.isButton() && interaction.customId.startsWith('scratch_')) {
    console.log(`[DEBUG] Scratch button clicked: "${interaction.customId}"`);
    console.log(`[DEBUG] Starts with scratch_toggle: ${interaction.customId.startsWith('scratch_toggle')}`);
    console.log(`[DEBUG] Starts with scratch_config: ${interaction.customId.startsWith('scratch_config')}`);
  }

  // Handle scratch card buttons (but not admin scratch_toggle/scratch_config/scratch_stats)
  if (interaction.isButton() && interaction.customId.startsWith('scratch_') && 
      !interaction.customId.startsWith('scratch_toggle') && 
      !interaction.customId.startsWith('scratch_config') &&
      !interaction.customId.startsWith('scratch_stats')) {
    try {
      const { handleButton } = require('./commands/scratch');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'scratch button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle maintenance panel buttons, modals, and selects
  if ((interaction.isButton() && interaction.customId.startsWith('maint_')) ||
      (interaction.isStringSelectMenu() && interaction.customId === 'maint_command_select') ||
      (interaction.isModalSubmit() && interaction.customId === 'modal_command_cooldown')) {
    try {
      const { handleInteraction } = require('./commands/admin-maintenance');
      const handled = await handleInteraction(interaction, interaction.guildId);
      if (handled) return;
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'maintenance interaction', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle help menu select
  if ((interaction.isStringSelectMenu() && interaction.customId === 'help_menu') || (interaction.isButton() && interaction.customId.startsWith('help_dismiss_u_'))) {
    try {
      const { handleInteraction } = require('./commands/help');
      await handleInteraction(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'help menu', error });
    }
    return;
  }

  // Handle service ticket buttons (complete/close)
  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
    try {
      const { handleTicketButton } = require('./commands/inventory');
      await handleTicketButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'ticket button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle scratcher panel buttons
  if (interaction.isButton() && interaction.customId.startsWith('scratcher_')) {
    try {
      const { handleButton } = require('./commands/scratcher');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'scratcher button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle GDPR data deletion buttons
  if (interaction.isButton() && interaction.customId.startsWith('deletedata_')) {
    try {
      const { handleButton } = require('./commands/deletedata');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'deletedata button', error });
    }
    return;
  }

  // Handle purge-users buttons
  if (interaction.isButton() && interaction.customId.startsWith('purge_')) {
    try {
      const { handlePurgeButton } = require('./commands/purge-users');
      await handlePurgeButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'purge button', error });
    }
    return;
  }

  // Handle stock panel buttons
  if (interaction.isButton() && interaction.customId.startsWith('stock_')) {
    try {
      const { handleButton } = require('./commands/stock');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'stock panel button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle stock panel select menus
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('stock_')) {
    try {
      const { handleSelectMenu } = require('./commands/stock');
      await handleSelectMenu(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'stock panel select', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle stock panel user select menus
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith('stock_')) {
    try {
      const { handleSelectMenu } = require('./commands/stock');
      await handleSelectMenu(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'stock panel user select', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle stock panel modals (custom buy/sell)
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_stock_')) {
    try {
      const { handleModal } = require('./commands/stock');
      await handleModal(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'stock modal', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle lottery ticket modal (from inventory item)
  if (interaction.isModalSubmit() && interaction.customId.startsWith('lottery_ticket_modal_')) {
    try {
      const { handleLotteryTicketModal } = require('./commands/inventory');
      await handleLotteryTicketModal(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'lottery ticket modal', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle In Between buttons and modals
  if (interaction.isButton() && interaction.customId.startsWith('ib_')) {
    try {
      const { handleButton } = require('./commands/inbetween');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'In Between button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ib_custom_bet_modal') {
    try {
      const { handleModal } = require('./commands/inbetween');
      await handleModal(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'In Between modal', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle Let It Ride buttons
  if (interaction.isButton() && interaction.customId.startsWith('lir_')) {
    try {
      const { handleButton } = require('./commands/letitride');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'Let It Ride button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle Three Card Poker buttons
  if (interaction.isButton() && interaction.customId.startsWith('tcp_')) {
    try {
      const { handleButton } = require('./commands/three-card-poker');
      const parts = interaction.customId.split('_');
      const action = parts[1]; // deal, cancel, play, fold, playagain, done
      const targetUserId = parts[2];
      // For playagain, parts[3], [4], [5] are ante, pairplus, sixcard bets
      const extraData = parts.length > 3 ? parts.slice(3) : [];
      await handleButton(interaction, action, targetUserId, extraData);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'Three Card Poker button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle Video Poker buttons
  if (interaction.isButton() && interaction.customId.startsWith('vp_')) {
    try {
      const { handleButton } = require('./commands/videopoker');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'Video Poker button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle Three Card Poker select menus
  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('tcp_pairplus_') || interaction.customId.startsWith('tcp_sixcard_'))) {
    try {
      const { handleSelectMenu } = require('./commands/three-card-poker');
      const parts = interaction.customId.split('_');
      const menuType = parts[1]; // pairplus or sixcard
      const targetUserId = parts[2];
      await handleSelectMenu(interaction, menuType, targetUserId);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'Three Card Poker select menu', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle blackjack buttons
  if (interaction.isButton() && interaction.customId.startsWith('bj_')) {
    try {
      const { handleBlackjackButton } = require('./commands/blackjack');
      await handleBlackjackButton(interaction);
    } catch (error) {
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'blackjack button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        } else {
          await interaction.followUp({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {
        // Ignore - interaction may have expired
      }
    }
    return;
  }

  // Handle split interactions
  if ((interaction.isStringSelectMenu() && interaction.customId === 'split_select') ||
      (interaction.isButton() && (interaction.customId === 'split_confirm' || interaction.customId === 'split_cancel'))) {
    try {
      const { handleSplitSelect, handleSplitConfirm, handleSplitCancel } = require('./commands/split');
      if (interaction.customId === 'split_select') {
        await handleSplitSelect(interaction);
      } else if (interaction.customId === 'split_confirm') {
        await handleSplitConfirm(interaction);
      } else if (interaction.customId === 'split_cancel') {
        await handleSplitCancel(interaction);
      }
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'split interaction', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle roulette buttons
  if (interaction.isButton() && interaction.customId.startsWith('roulette_')) {
    try {
      const { handleRouletteButton } = require('./commands/roulette');
      await handleRouletteButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'roulette button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle infamy panel buttons (leaderboard, dismiss)
  const infamyUserIds = ['infamy_leaderboard', 'infamy_dismiss'];
  if (interaction.isButton() && infamyUserIds.includes(interaction.customId)) {
    try {
      const { handleButton } = require('./commands/infamy');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'infamy button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {}
    }
    return;
  }

  // Handle profile buttons
  if (interaction.isButton() && interaction.customId.startsWith('profile_')) {
    try {
      const { handleButton } = require('./commands/profile');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'profile button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {}
    }
    return;
  }

  // Handle pet panel buttons
  if (interaction.isButton() && (interaction.customId.startsWith('pet_panel_') || interaction.customId.startsWith('pet_feed_') || interaction.customId.startsWith('pet_feedmenu_') || interaction.customId.startsWith('pet_play_') || interaction.customId.startsWith('pet_train_') || interaction.customId.startsWith('pet_active_') || interaction.customId.startsWith('pet_dismiss_') || interaction.customId.startsWith('pet_view_') || interaction.customId.startsWith('pet_release_') || interaction.customId.startsWith('pet_rename_') || interaction.customId.startsWith('pet_namebuy_') || interaction.customId.startsWith('pet_buy_') || interaction.customId.startsWith('pet_kennel_') || interaction.customId.startsWith('pet_shop_page_') || interaction.customId.startsWith('pet_egg_') || interaction.customId.startsWith('pet_myeggs_') || interaction.customId.startsWith('pet_breed_') || interaction.customId.startsWith('pet_birth_') || interaction.customId.startsWith('pet_gestating_') || interaction.customId.startsWith('pet_stud_') || interaction.customId.startsWith('pet_transfer_') || interaction.customId.startsWith('pet_trade_') || interaction.customId.startsWith('pet_lineage_') || interaction.customId.startsWith('pet_recover_') || interaction.customId.startsWith('pet_runaways_'))) {
    try {
      const { handleButton } = require('./commands/pets');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'pets button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {}
    }
    return;
  }

  // Handle pet panel select menus
  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('pet_select_') || interaction.customId.startsWith('pet_shop_select_') || interaction.customId.startsWith('pet_breed_select_') || interaction.customId.startsWith('pet_breed_partner_select_') || interaction.customId.startsWith('pet_stud_mypet_') || interaction.customId.startsWith('pet_stud_partner_') || interaction.customId.startsWith('pet_transfer_target_') || interaction.customId.startsWith('pet_trade_select_') || interaction.customId.startsWith('pet_trade_partner_'))) {
    try {
      const { handleSelectMenu } = require('./commands/pets');
      await handleSelectMenu(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'pets select', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {}
    }
    return;
  }

  // Handle pet panel user select menus
  if (interaction.isUserSelectMenu() && (interaction.customId.startsWith('pet_stud_targetuser_') || interaction.customId.startsWith('pet_transfer_userselect_') || interaction.customId.startsWith('pet_trade_userselect_'))) {
    try {
      const { handleUserSelectMenu } = require('./commands/pets');
      await handleUserSelectMenu(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'pets user select', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {}
    }
    return;
  }

  // Handle pet panel modals
  if (interaction.isModalSubmit() && (interaction.customId.startsWith('modal_pet_name_') || interaction.customId.startsWith('modal_pet_rename_') || interaction.customId.startsWith('modal_egg_name_') || interaction.customId.startsWith('modal_birth_name_') || interaction.customId.startsWith('modal_stud_accept_') || interaction.customId.startsWith('modal_transfer_price_'))) {
    try {
      const { handleModal } = require('./commands/pets');
      await handleModal(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'pets modal', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {}
    }
    return;
  }

  // Handle profile user select menu
  if (interaction.isUserSelectMenu() && interaction.customId === 'profile_user_select') {
    try {
      const { handleUserSelect } = require('./commands/profile');
      await handleUserSelect(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return;
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'profile user select', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) {}
    }
    return;
  }

  // Handle bank interactions (all user-facing bank buttons and modals)
  const bankUserIds = [
    'bank_apply_loan', 'bank_pay_loan', 'bank_buy_bond', 'bank_history', 'bank_refresh', 
    'bank_panel_back', 'bank_loan_modal', 'bank_loan_cancel', 'bank_pay_scheduled',
    'bank_pay_full', 'bank_pay_custom', 'bank_pay_custom_modal', 'bank_bond_select',
    'bank_security', 'bank_immunity_select', 'bounty_board'
  ];
  if ((interaction.isButton() && (bankUserIds.includes(interaction.customId) || interaction.customId.startsWith('bank_loan_confirm_'))) ||
      (interaction.isStringSelectMenu() && (interaction.customId === 'bank_bond_select' || interaction.customId === 'bank_immunity_select')) ||
      (interaction.isModalSubmit() && (interaction.customId === 'bank_loan_modal' || interaction.customId === 'bank_pay_custom_modal'))) {
    try {
      const { handleBankInteraction } = require('./commands/bank');
      await handleBankInteraction(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'bank interaction', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle leaderboard panel buttons
  if (interaction.isButton() && interaction.customId.startsWith('leaderboard_')) {
    try {
      const { handleButton } = require('./commands/leaderboard');
      await handleButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'leaderboard button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle income panel buttons
  if (interaction.isButton() && interaction.customId.startsWith('income_')) {
    try {
      const { handleIncomeButton } = require('./commands/income');
      await handleIncomeButton(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'income button', error });
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle admin dashboard interactions (buttons, selects, modals)
  if (interaction.isButton() || interaction.isStringSelectMenu() || 
      interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() ||
      interaction.isUserSelectMenu() || interaction.isModalSubmit()) {
    
    // Handle property panel buttons (user-facing)
    if (interaction.isButton() && interaction.customId.startsWith('property_panel_')) {
      try {
        const { handleButton } = require('./commands/property');
        await handleButton(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'property panel button', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }
    
    // Handle property rent selection (user-facing, not admin)
    if (interaction.isStringSelectMenu() && interaction.customId === 'property_rent_select') {
      try {
        const { handleRentSelect } = require('./commands/property');
        await handleRentSelect(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'rent select', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }
    
    // Handle property sell selection (user-facing, not admin)
    if (interaction.isStringSelectMenu() && interaction.customId === 'property_sell_select') {
      try {
        const { handleSellSelect } = require('./commands/property');
        await handleSellSelect(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'sell select', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }
    
    // Handle property upgrade selection
    if (interaction.isStringSelectMenu() && interaction.customId === 'property_upgrade_select') {
      try {
        const { handleUpgradeSelect } = require('./commands/property');
        await handleUpgradeSelect(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'upgrade select', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }
    
    // Handle property sell confirm/cancel buttons
    if (interaction.isButton() && interaction.customId.startsWith('property_sell_confirm_')) {
      try {
        const propertyId = parseInt(interaction.customId.replace('property_sell_confirm_', ''));
        const { handleSellConfirm } = require('./commands/property');
        await handleSellConfirm(interaction, propertyId);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'sell confirm', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === 'property_sell_cancel') {
      try {
        const { handleSellCancel } = require('./commands/property');
        await handleSellCancel(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'sell cancel', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }

    // Handle fight interactions (challenge accept/decline, betting, moves)
    // Exclude admin panel buttons which start with fight_ but are handled by admin
    const fightAdminButtons = ['fight_toggle', 'fight_edit_settings', 'fight_view_leaderboard', 'fight_view_history', 'fight_reset_stats', 'fight_reset_confirm', 'back_fight'];
    if (interaction.isButton() && interaction.customId.startsWith('fight_') && !fightAdminButtons.includes(interaction.customId)) {
      try {
        const { handleButton } = require('./commands/fight');
        await handleButton(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'fight button', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }

    // Handle skills panel buttons (training)
    if (interaction.isButton() && interaction.customId.startsWith('skills_')) {
      try {
        const { handleButton } = require('./commands/skills');
        await handleButton(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'skills button', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }

    // Handle prestige buttons
    if (interaction.isButton() && interaction.customId.startsWith('prestige_')) {
      // Exclude admin panel buttons
      const prestigeAdminButtons = ['prestige_toggle', 'prestige_edit_settings', 'prestige_view_leaderboard', 'back_prestige'];
      if (!prestigeAdminButtons.includes(interaction.customId)) {
        try {
          const { handleButton } = require('./commands/prestige');
          await handleButton(interaction);
        } catch (error) {
          if (error.code === 10062 || error.code === 40060) return;
          logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'prestige button', error });
          try {
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({ content: 'An error occurred.', flags: 64 });
            }
          } catch (e) { /* Interaction expired */ }
        }
        return;
      }
    }

    // Handle rob defense buttons fallback only for DMs (channel implementation handles guild clicks)
    if (interaction.isButton() && interaction.customId.startsWith('rob_defend_') && !interaction.guildId) {
      // Note: In-channel defense buttons are handled inside rob.js via awaitMessageComponent.
      // This fallback is restricted to DMs to avoid race conditions.
      try {
        await interaction.reply({ content: 'This rob defense window has expired.', flags: 64 });
      } catch (error) {
        // Interaction may have already been acknowledged
      }
      return;
    }
    
    // Handle Screw Your Neighbor game buttons (not admin buttons)
    const synAdminIds = ['syn_toggle', 'syn_edit_settings', 'syn_edit_timing', 'back_syn', 'admin_syn'];
    if (interaction.isButton() && interaction.customId.startsWith('syn_') && !synAdminIds.includes(interaction.customId)) {
      try {
        const { handleButton } = require('./commands/screwyourneighbor');
        await handleButton(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return;
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'SYN button', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }

    // Check if this is an admin panel interaction
    const adminCustomIds = [
      'admin_select', 'admin_category', 'back_dashboard',
      'fees_toggle', 'fees_edit_buy', 'fees_edit_sell',
      'antispam_toggle', 'antispam_edit_settings',
      'market_edit_cooldown', 'market_edit_tax',
      'property_toggle', 'property_fee', 'property_limit', 'property_rent', 'property_cards',
      'property_edit_settings', 'property_manage_cards', 'property_manage_names',
      'property_editcards', 'property_editprops', 'property_role_panel', 'property_clear_role',
      'property_set_role', 'property_set_register_price',
      'property_givecard', 'property_takecard', 'givecard_select', 'takecard_select', 'takecard_selectuser',
      'cards_show_positive', 'cards_show_negative', 'cards_show_neutral',
      'cards_give_card', 'cards_take_card', 'takecard_back',
      'givecard_card_select', 'givecard_user_select', 'takecard_user_select',
      'card_add_positive', 'card_add_negative', 'card_add_neutral',
      'card_select', 'prop_select', 'props_list', 'back_property',
      'ticker_set_channel', 'ticker_channel_select',
      'dashboard_toggle', 'dashboard_edit_settings', 'dashboard_set_channel', 'dashboard_refresh',
      'dashboard_channel_select', 'modal_dashboard_settings',
      'events_toggle', 'events_edit_settings', 'events_edit_weights', 'events_set_channel',
      'events_force_spawn',
      'events_channel_select', 'back_ticker',
      'modal_events_settings', 'modal_events_weights',
      // Cooldown Tracker
      'tracker_toggle', 'tracker_edit_settings', 'tracker_set_channel', 'tracker_refresh',
      'tracker_channel_select', 'modal_tracker_settings',
      // Bump Rewards
      'bump_toggle', 'bump_edit_settings', 'bump_toggle_announce', 'bump_set_channel',
      'bump_channel_select', 'modal_bump_settings',
      'vault_panel', 'vault_toggle', 'vault_spawn', 'vault_interval', 
      'vault_reward', 'vault_channel',
      'modal_vault_interval', 'modal_vault_reward',
      'permissions_role', 'permissions_removerole',
      'modal_buy_fee', 'modal_sell_fee',
      'modal_antispam_settings',
      'modal_market_cooldown', 'modal_market_capital_gains',
      'modal_property_fee', 'modal_property_limit', 'modal_property_rentpercent', 'modal_property_cards',
      'modal_property_register_price', 'modal_property_settings', 'modal_add_card', 'modal_tier_weights',
      'property_role_select', 'property_name_select', 'cards_view_positive', 'cards_view_negative', 'cards_view_neutral', 
      'cards_add_card', 'back_property', 'property_edit_weights',
      'gambling_decks', 'gambling_settings', 'push_cards',
      'gambling_edit_blackjack', 'gambling_lottery_settings', 'gambling_toggle_scratch', 'gambling_scratch_config',
      'gambling_scratch_stats', 'gambling_inbetween_settings', 'gambling_letitride_settings', 'gambling_threecardpoker_settings',
      'lottery_toggle_auto', 'lottery_edit_schedule', 'lottery_edit_prizes', 'lottery_set_channel', 'lottery_edit_ticket_price', 'lottery_edit_range', 'lottery_edit_jackpot',
      'vault_toggle', 'vault_spawn', 'vault_reward', 'vault_channel', 'vault_force_spawn', 'back_gambling',
      'inbetween_toggle', 'inbetween_edit_settings', 'inbetween_reset_pot',
      'letitride_toggle', 'letitride_edit_settings',
      'threecardpoker_toggle', 'threecardpoker_edit_settings',
      'videopoker_toggle', 'videopoker_edit_settings', 'gambling_videopoker_settings',
      'modal_blackjack_settings', 'modal_lottery_schedule', 'modal_lottery_prizes', 'modal_lottery_ticket_price', 'modal_lottery_range', 'modal_lottery_jackpot', 'modal_vault_spawn', 'modal_vault_reward',
      'modal_inbetween_settings', 'modal_inbetween_reset_pot', 'modal_letitride_settings', 'modal_threecardpoker_settings', 'modal_videopoker_settings',
      'scratch_select_card', 'lottery_channel_select', 'vault_channel_select',
      'lottery_draw_now', 'lottery_schedule', 'lottery_prizes',
      'scratch_toggle', 'scratch_config', 'scratch_config_cheese', 'scratch_config_cash', 
      'scratch_config_stocks', 'scratch_config_lucky7s', 'scratch_config_reset',
      'scratch_stats_panel', 'scratch_stats_overview', 'scratch_stats_leaderboard', 'scratch_stats_players',
      'modal_scratch_config_cheese', 'modal_scratch_config_cash', 
      'modal_scratch_config_stocks', 'modal_scratch_config_lucky7s',
      'dividends', 'dividends_toggle', 'splits_toggle', 'dividends_config', 'splits_config',
      'dividends_reset_timer', 'dividend_toggle', 'dividend_edit_settings', 'dividend_self_toggle',
      'dividend_passive_toggle', 'dividend_passive_edit', 'dividend_role_income', 'dividend_back', 'role_income_add',
      'role_income_select', 'role_income_toggle', 'role_income_delete', 'role_income_edit',
      'modal_dividend_settings', 'modal_passive_settings', 'modal_role_income_add', 'modal_role_income_edit',
      'ceobonus_toggle', 'passiveincome_toggle', 'bonus_config', 'announcement_config',
      'select_announcement_channel', 'clear_announcement_channel',
      'modal_dividend_config', 'modal_split_config', 'modal_bonus_config',
      'role_income_manage', 'role_income_add', 'role_income_select_role',
      'admin_income_work', 'admin_income_hunt', 'admin_income_lp', 'back_income',
      'work_toggle', 'work_edit_settings',
      'modal_work_settings',
      'hunt_toggle', 'hunt_edit_settings', 'modal_hunt_settings',
      'hunt_manage_items', 'hunt_items_prev', 'hunt_items_next', 'back_hunt',
      'admin_lp_toggle', 'admin_lp_edit_general', 'admin_lp_edit_buffs', 'admin_lp_edit_currency',
      'modal_admin_lp_general', 'modal_admin_lp_buffs', 'modal_admin_lp_currency',
      'rob_toggle', 'rob_edit_settings', 'rob_immunity_settings', 'modal_rob_settings',
      'rob_add_immune_role', 'rob_clear_immune_roles', 'rob_immunity_role_select',
      'rob_defense_settings', 'rob_defense_toggle', 'rob_defense_edit', 'back_rob_defense', 'modal_rob_defense_settings',
      'rob_target_cooldown', 'modal_rob_target_cooldown',
      'admin_hack', 'hack_toggle', 'hack_edit_settings', 'hack_immunity_settings',
      'hack_add_immune_role', 'hack_clear_immune_roles', 'hack_immunity_role_select',
      'hack_anti_farm', 'modal_hack_anti_farm',
      'modal_hack_settings', 'back_hack',
      'admin_fight', 'fight_toggle', 'fight_edit_settings', 'fight_view_leaderboard', 'fight_view_history',
      'fight_reset_stats', 'fight_reset_confirm', 'modal_fight_settings', 'back_fight',
      'stocks_add', 'stocks_remove', 'stocks_reset_split', 'modal_stocks_add', 'modal_stocks_remove', 'modal_stocks_reset_split',
      'bank_settings', 'bank_loans_toggle', 'bank_bonds_toggle', 'bank_loan_settings', 'bank_loan_criteria',
      'bank_edit_loan_settings', 'bank_edit_requirements',
      'bank_toggle_req_properties', 'bank_toggle_req_portfolio', 'bank_toggle_req_tenure', 'bank_toggle_collateral',
      'bank_bond_settings', 'bank_add_bond', 'bank_view_loans', 'bank_view_bonds', 'bank_delete_active_bond',
      'bank_credit_tiers', 'bank_credit_reset', 'bank_credit_tier_select',
      'modal_bank_criteria', 'modal_bank_loan_settings', 'modal_bank_bond_add',
      'wealth_tax_toggle', 'wealth_tax_schedule', 'wealth_tax_channel', 'wealth_tax_tiers', 'wealth_tax_preview',
      'wealth_tax_collect_now', 'wealth_tax_confirm_collect', 'wealth_tax_reset_tiers', 'wealth_tax_back',
      'wealth_tax_add_tier', 'wealth_tax_tier_select', 'wealth_tax_schedule_modal', 'wealth_tax_channel_modal', 
      'wealth_tax_add_tier_modal', 'wealth_tax_last_collection',
      // Activity Tiers
      'activity_tiers_panel', 'activity_tiers_toggle', 'activity_tiers_edit', 'activity_tiers_back',
      'modal_activity_tiers',
      'admin_skills', 'admin_skills_edit_xp', 'admin_skills_edit_hack', 'admin_skills_edit_rob',
      'admin_skills_view_levels', 'back_admin_skills',
      'modal_admin_skills_xp', 'modal_admin_skills_hack', 'modal_admin_skills_rob',
      'admin_items', 'items_toggle', 'items_add', 'items_manage', 'items_stats',
      'items_init_defaults', 'items_prev', 'items_next', 'back_items', 'items_owners',
      'items_fulfillments', 'items_fulfill_prev', 'items_fulfill_next', 'items_ticket_settings',
      'items_create_continue', 'items_create_cancel', 'items_create_role',
      'items_give', 'items_give_confirm', 'items_give_cancel',
      'items_give_user', 'items_give_item',
      'items_take', 'items_take_confirm', 'items_take_cancel',
      'items_take_user', 'items_take_item',
      'items_owners_select',
      'items_select', 'items_category_filter', 'items_effect_select',
      'items_ticket_category', 'items_ticket_log',
      'items_create_category', 'items_create_effect',
      'modal_items_add', 'modal_items_edit', 'modal_items_create', 'modal_items_give_qty', 'modal_items_take_qty',
      // Reset Game
      'reset_game_confirm', 'reset_game_cancel', 'modal_reset_game_confirm',
      // Settings
      'settings_set_role', 'settings_clear_role', 'settings_edit_currency', 'settings_reset_currency',
      'settings_edit_starting_bal', 'settings_edit_immunity',
      'settings_view_logs', 'settings_back_main', 'settings_reset_game',
      'settings_role_select', 'modal_settings_currency', 'modal_settings_starting_bal', 'modal_settings_immunity',
      // Dungeon
      'admin_dungeon', 'dungeon_toggle', 'dungeon_edit_global', 'back_dungeon',
      'dungeon_tier_1', 'dungeon_tier_2', 'dungeon_tier_3',
      'dungeon_edit_tier_1', 'dungeon_edit_tier_2', 'dungeon_edit_tier_3',
      'modal_dungeon_global', 'modal_dungeon_tier_1', 'modal_dungeon_tier_2', 'modal_dungeon_tier_3',
      // SYN
      'admin_syn', 'syn_toggle', 'syn_edit_settings', 'syn_edit_timing', 'back_syn',
      'modal_syn_settings', 'modal_syn_timing',
      // Infamy
      'admin_infamy', 'infamy_toggle', 'infamy_edit_tiers', 'infamy_edit_rates',
      'infamy_edit_bounty', 'infamy_edit_misc', 'infamy_set_channel', 'back_infamy',
      'modal_infamy_tiers', 'modal_infamy_rates', 'modal_infamy_bounty', 'modal_infamy_misc',
      'infamy_channel_select',
      // Prestige
      'admin_prestige', 'prestige_toggle', 'prestige_edit_settings', 'prestige_view_leaderboard', 'back_prestige',
      'modal_prestige_settings',
      // Pets
      'admin_pets_toggle', 'admin_pets_settings', 'admin_pets_restock',
      'admin_pets_economy', 'admin_pets_kennel', 'admin_pets_breeding', 'admin_pets_transfer', 'back_admin_pets',
      'modal_admin_pets_settings', 'modal_admin_pets_economy', 'modal_admin_pets_kennel',
      'modal_admin_pets_breeding', 'modal_admin_pets_transfer',
    ];
    
    // Check for exact match OR dynamic card/property edit IDs
    const isDynamicCardId = interaction.customId.startsWith('card_edit_') || 
                            interaction.customId.startsWith('card_delete_') ||
                            interaction.customId.startsWith('card_select_') ||
                            interaction.customId.startsWith('modal_edit_card_');
    const isDynamicPropId = interaction.customId.startsWith('prop_edit_') || 
                            interaction.customId.startsWith('modal_prop_') ||
                            interaction.customId.startsWith('modal_edit_property_name_');
    const isDynamicGiveCard = interaction.customId.startsWith('givecard_') ||
                              interaction.customId.startsWith('takecard_') ||
                              interaction.customId.startsWith('modal_givecard_');
    const isDynamicMsgPage = interaction.customId.startsWith('crime_success_msgs_page_') ||
                             interaction.customId.startsWith('crime_fail_msgs_page_') ||
                             interaction.customId.startsWith('slut_success_msgs_page_') ||
                             interaction.customId.startsWith('slut_fail_msgs_page_');
    const isDynamicRoleIncome = interaction.customId.startsWith('role_income_page_') ||
                                interaction.customId.startsWith('role_income_edit_') ||
                                interaction.customId.startsWith('role_income_toggle_') ||
                                interaction.customId.startsWith('role_income_delete_') ||
                                interaction.customId.startsWith('role_income_select_') ||
                                interaction.customId.startsWith('modal_role_income_');
    const isDynamicBank = interaction.customId.startsWith('bank_bond_edit_') ||
                          interaction.customId.startsWith('bank_bond_delete_') ||
                          interaction.customId.startsWith('bank_bond_select_') ||
                          interaction.customId.startsWith('bank_bond_toggle_') ||
                          interaction.customId.startsWith('bank_bond_role_') ||
                          interaction.customId.startsWith('bank_bond_setrole_') ||
                          interaction.customId.startsWith('bank_bond_addrole_') ||
                          interaction.customId.startsWith('bank_loan_forgive_') ||
                          interaction.customId.startsWith('bank_loan_select_') ||
                          interaction.customId.startsWith('bank_loans_page_') ||
                          interaction.customId.startsWith('bank_bonds_page_') ||
                          interaction.customId.startsWith('bank_activebonds_page_') ||
                          interaction.customId.startsWith('modal_bank_bond_edit_') ||
                          interaction.customId.startsWith('modal_bank_credit_tier_');
    const isDynamicRob = interaction.customId.startsWith('rob_immune_remove_') ||
                         interaction.customId === 'rob_immune_add_role' ||
                         interaction.customId.startsWith('rob_immunity_page_') ||
                         interaction.customId.startsWith('rob_immunity_tier_select_') ||
                         interaction.customId.startsWith('rob_immunity_toggle_') ||
                         interaction.customId.startsWith('rob_immunity_edit_') ||
                         interaction.customId.startsWith('rob_immunity_delete_') ||
                         interaction.customId.startsWith('rob_immunity_setrole_') ||
                         interaction.customId.startsWith('rob_immunity_clearrole_') ||
                         interaction.customId.startsWith('modal_rob_immunity_edit_');
    const isDynamicWealthTax = interaction.customId.startsWith('wealth_tax_edit_tier_') ||
                               interaction.customId.startsWith('wealth_tax_remove_tier_') ||
                               interaction.customId.startsWith('wealth_tax_tier_modal_');
    const isDynamicScratch = interaction.customId.startsWith('modal_scratch_') ||
                             interaction.customId.startsWith('scratch_edit_');
    const isDynamicHunt = interaction.customId.startsWith('hunt_item_toggle_');
    const isDynamicItems = interaction.customId.startsWith('items_edit_') ||
                           interaction.customId.startsWith('items_delete_') ||
                           interaction.customId.startsWith('items_toggle_') ||
                           interaction.customId.startsWith('items_usable_') ||
                           interaction.customId.startsWith('items_owners_') ||
                           interaction.customId.startsWith('items_huntable_') ||
                           interaction.customId.startsWith('modal_items_edit_') ||
                           interaction.customId.startsWith('items_complete_') ||
                           interaction.customId.startsWith('items_cancel_') ||
                           interaction.customId.startsWith('items_refund_');
    const isDynamicSettings = interaction.customId.startsWith('settings_logs_page_');
    
    if (adminCustomIds.includes(interaction.customId) || isDynamicCardId || isDynamicPropId || isDynamicGiveCard || isDynamicMsgPage || isDynamicRoleIncome || isDynamicBank || isDynamicRob || isDynamicWealthTax || isDynamicScratch || isDynamicItems || isDynamicHunt || isDynamicSettings) {
      try {
        const { handleAdminInteraction } = require('./commands/admin');
        await handleAdminInteraction(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        logError({ guildId: interaction.guildId, userId: interaction.user?.id, command: 'admin interaction', error });
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }
  }

  // Handle autocomplete interactions
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;
    
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`Autocomplete error for /${interaction.commandName}:`, error);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // Track slash command usage as a message (always counts, no anti-spam)
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const guildId = interaction.guildId;
  const commandName = interaction.commandName;
  
  createUser(userId, username);
  const cmdSpamSettings = getSpamSettings(guildId);
  updateMessageCount(Date.now(), userId, cmdSpamSettings.baseValueGrowth);
  
  // Check command rate limit (separate from built-in cooldowns)
  const cooldownCheck = checkCommandCooldown(guildId, userId, commandName);
  if (cooldownCheck.onCooldown) {
    try {
      await interaction.reply({
        content: `⏳ Please wait **${cooldownCheck.remainingSeconds}s** before using \`/${commandName}\` again.`,
        flags: 64
      });
    } catch (e) {
      // Interaction may have expired
    }
    return;
  }
  
  // Periodically log price
  const userMessages = getUser(userId);
  if (userMessages && userMessages.total_messages % 10 === 0) {
    const currentPrice = calculateStockPrice(userId, guildId);
    logPrice(userId, currentPrice, Date.now());
  }

  const command = client.commands.get(commandName);
  if (!command) return;

  // Update cooldown timestamp after successful command lookup
  updateCommandCooldown(guildId, userId, commandName);
  trackCommandUsage(guildId, commandName);

  try {
    await command.execute(interaction);
  } catch (error) {
    // Ignore interaction errors - these happen when bot restarts while commands are pending
    // 10062 = Unknown interaction (expired), 40060 = Already acknowledged
    if (error.code === 10062 || error.code === 40060) {
      console.log(`⚠️ Interaction issue for /${commandName}: ${error.code === 10062 ? 'expired' : 'already acknowledged'}`);
      return;
    }
    
    // Log error to maintenance system
    logError({
      guildId,
      userId,
      command: commandName,
      error
    });
    
    try {
      const errorMessage = { content: 'There was an error executing this command!', flags: 64 };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (e) {
      // Interaction already expired or acknowledged, ignore
      if (e.code !== 10062) {
        console.error('Could not send error message:', e.message);
      }
    }
  }
});

// Login
client.login(process.env.DISCORD_TOKEN);

// === Health check HTTP server ===
const HEALTH_PORT = process.env.HEALTH_PORT || 8080;
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    const healthy = client.ws.status === 0; // 0 = READY
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'ok' : 'degraded',
      uptime: process.uptime(),
      guilds: client.guilds.cache.size,
      ping: client.ws.ping,
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024)
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(HEALTH_PORT, '127.0.0.1', () => {
  log.info(`Health check listening on 127.0.0.1:${HEALTH_PORT}/health`);
});

// === Graceful shutdown ===
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.warn(`${signal} received — shutting down gracefully`);
  try { healthServer.close(); } catch (e) {}
  try { client.destroy(); } catch (e) {}
  try { shutdownDatabase(); } catch (e) {}
  log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', { error: error.message, stack: error.stack });
  logError({ command: 'UNCAUGHT_EXCEPTION', error });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  log.error('Unhandled rejection', { error: error.message, stack: error.stack });
  logError({ command: 'UNHANDLED_REJECTION', error });
});