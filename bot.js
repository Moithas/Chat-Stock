require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const { initDatabase, createUser, updateMessageCount, calculateStockPrice, logPrice, getUser, getDb, getStreakInfo } = require('./database');
const { initTicker, sendStreakAnnouncement, sendStreakExpiredAnnouncement } = require('./ticker');
const { initFees } = require('./fees');
const { initAntiSpam, shouldCountMessage } = require('./antispam');
const { initAdmin } = require('./admin');
const { initMarketProtection } = require('./market');
const { initProperty, scheduleCardDistribution } = require('./property');
const { initEvents, handleMessage: handleEventMessage } = require('./events');
const { initGambling, getGamblingSettings, getAllTickets, drawLottery, getLotteryInfo } = require('./gambling');
const { initDividends, startDividendScheduler } = require('./dividends');
const { initWork } = require('./work');
const { initCrime } = require('./crime');
const { initSlut } = require('./slut');
const { initRob, startImmunityScheduler } = require('./rob');
const { initHack } = require('./hack');
const { initFight } = require('./fight');
const { initBank, startBankScheduler } = require('./bank');
const { addMoney } = require('./economy');
const { initWealthTax, getWealthTaxSettings, collectWealthTax, getLotteryInfo: getWealthTaxLotteryInfo } = require('./wealth-tax');
const { initSkills } = require('./skills');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
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
const CURRENCY = '<:babybel:1418824333664452608>';
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
                    { name: '💸 Total Prizes', value: `**${result.totalPrizesPaid.toLocaleString()}** ${CURRENCY}`, inline: true }
                  );

                if (result.jackpotWon) {
                  embed.addFields({
                    name: '🎊 JACKPOT WINNER!',
                    value: `Someone won the **${result.jackpotAmount.toLocaleString()}** ${CURRENCY} jackpot!`
                  });
                }

                if (winners.length > 0) {
                  const by4 = winners.filter(w => w.matches === 4);
                  const by3 = winners.filter(w => w.matches === 3);
                  const by2 = winners.filter(w => w.matches === 2);

                  let winnerText = '';
                  if (by4.length > 0) {
                    winnerText += `**🏆 4 Matches (JACKPOT):**\n${by4.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${CURRENCY}`).join('\n')}\n\n`;
                  }
                  if (by3.length > 0) {
                    winnerText += `**🥈 3 Matches:**\n${by3.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${CURRENCY}`).join('\n')}\n\n`;
                  }
                  if (by2.length > 0) {
                    winnerText += `**🥉 2 Matches:**\n${by2.map(w => `<@${w.userId}>: ${w.numbers.join('-')} → **${w.prize.toLocaleString()}** ${CURRENCY}`).join('\n')}`;
                  }
                  embed.addFields({ name: '🏅 Winners', value: winnerText || 'None' });
                } else {
                  embed.addFields({ name: '😢 No Winners', value: 'No one matched 2 or more numbers this draw.' });
                }

                const newInfo = getLotteryInfo(guild.id);
                embed.addFields({ name: '💰 New Jackpot', value: `**${newInfo.jackpot.toLocaleString()}** ${CURRENCY}` });
                embed.setFooter({ text: 'Thanks for playing! Next draw coming soon.' }).setTimestamp();

                await channel.send({ embeds: [embed] });
              }
            } catch (e) {
              console.error('Failed to announce lottery results:', e);
            }
          }
        }
      } catch (e) {
        console.error(`Error checking lottery for guild ${guild.id}:`, e);
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
                    { name: '💸 Total Collected', value: `**${result.totalCollected.toLocaleString()}** ${CURRENCY}`, inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: '🎰 Previous Jackpot', value: `${result.previousJackpot.toLocaleString()} ${CURRENCY}`, inline: true },
                    { name: '🎰 New Jackpot', value: `**${result.newJackpot.toLocaleString()}** ${CURRENCY}`, inline: true }
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
              console.error('Failed to announce wealth tax collection:', e);
            }
          }
        }
      } catch (e) {
        console.error(`Error collecting wealth tax for guild ${guild.id}:`, e);
      }
    }
    
    lastWealthTaxCheck = checkKey;
  }, 60000); // Check every minute
  
  console.log('💰 Wealth tax scheduler started');
}

// When bot is ready
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  // Initialize database first
  await initDatabase();
  
  // Internal economy is always enabled (no initialization needed)
  console.log('✅ Internal economy system enabled');
  
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

  // Initialize stock ticker
  initTicker(client);
  
  // Register slash commands
  const commands = [];
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    // Skip commands with no data (e.g., legacy button handlers)
    if (command.data) {
      commands.push(command.data.toJSON());
    }
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
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
  console.log('🎭 Status rotation started');
});

// Track messages for stock value
client.on('messageCreate', async (message) => {
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
  updateMessageCount(Date.now(), userId);
  
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
    const currentPrice = calculateStockPrice(userId);
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
  
  // Create user if doesn't exist
  createUser(userId, username);
  
  // Count this reaction as activity
  updateMessageCount(Date.now(), userId);
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
    
    // Update message count for slash command
    updateMessageCount(Date.now(), userId);
    
    // Also count toward events (vault, market events)
    // Create a mock message object for handleEventMessage
    handleEventMessage({
      guild: interaction.guild,
      author: { bot: false, id: userId }
    });
  }

  // Count button clicks, select menu selections, and modals toward activity
  if (!interaction.user.bot && (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit())) {
    const userId = interaction.user.id;
    
    // Create user if doesn't exist
    createUser(userId, interaction.user.username);
    
    // Count this interaction as activity
    updateMessageCount(Date.now(), userId);
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
      console.error('Error handling scratch button:', error);
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
      console.error('Error handling scratcher button:', error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
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
      console.error('Error handling stock panel button:', error);
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
      console.error('Error handling stock panel select:', error);
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
      console.error('Error handling stock panel user select:', error);
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
      console.error('Error handling stock modal:', error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle blackjack buttons and modals
  if (interaction.isButton() && interaction.customId.startsWith('bj_')) {
    try {
      if (interaction.customId.startsWith('bj_table_')) {
        // Multiplayer blackjack table buttons
        const { handleTableButton } = require('./commands/blackjack-table');
        await handleTableButton(interaction);
      } else {
        // Single-player blackjack buttons
        const { handleBlackjackButton } = require('./commands/blackjack');
        await handleBlackjackButton(interaction);
      }
    } catch (error) {
      console.error('Error handling blackjack button:', error);
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

  // Handle blackjack table modals
  if (interaction.isModalSubmit() && interaction.customId === 'bj_table_custom_bet') {
    try {
      const { handleCustomBetModal } = require('./commands/blackjack-table');
      await handleCustomBetModal(interaction);
    } catch (error) {
      console.error('Error handling blackjack modal:', error);
      try {
        await interaction.reply({ content: 'An error occurred.', flags: 64 });
      } catch (e) {
        // Ignore - interaction may have expired
      }
    }
    return;
  }

  // Handle blackjack table change bet modal
  if (interaction.isModalSubmit() && interaction.customId === 'bj_table_change_bet_modal') {
    try {
      const { handleChangeBetModal } = require('./commands/blackjack-table');
      await handleChangeBetModal(interaction);
    } catch (error) {
      console.error('Error handling blackjack change bet modal:', error);
      try {
        await interaction.reply({ content: 'An error occurred.', flags: 64 });
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
      console.error('Error handling split interaction:', error);
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
      console.error('Error handling roulette button:', error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', flags: 64 });
        }
      } catch (e) { /* Interaction expired */ }
    }
    return;
  }

  // Handle bank interactions (all user-facing bank buttons and modals)
  const bankUserIds = [
    'bank_apply_loan', 'bank_pay_loan', 'bank_buy_bond', 'bank_history', 'bank_refresh', 
    'bank_panel_back', 'bank_loan_modal', 'bank_loan_cancel', 'bank_pay_scheduled',
    'bank_pay_full', 'bank_pay_custom', 'bank_pay_custom_modal', 'bank_bond_select',
    'bank_security', 'bank_immunity_select'
  ];
  if ((interaction.isButton() && (bankUserIds.includes(interaction.customId) || interaction.customId.startsWith('bank_loan_confirm_'))) ||
      (interaction.isStringSelectMenu() && (interaction.customId === 'bank_bond_select' || interaction.customId === 'bank_immunity_select')) ||
      (interaction.isModalSubmit() && (interaction.customId === 'bank_loan_modal' || interaction.customId === 'bank_pay_custom_modal'))) {
    try {
      const { handleBankInteraction } = require('./commands/bank');
      await handleBankInteraction(interaction);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
      console.error('Error handling bank interaction:', error);
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
      console.error('Error handling leaderboard button:', error);
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
      console.error('Error handling income button:', error);
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
        console.error('Error handling property panel button:', error);
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
        console.error('Error handling rent select:', error);
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
        console.error('Error handling sell select:', error);
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
        console.error('Error handling sell confirm:', error);
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
        console.error('Error handling sell cancel:', error);
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
        console.error('Error handling fight button:', error);
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
        console.error('Error handling skills button:', error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
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
    
    // Check if this is an admin panel interaction
    const adminCustomIds = [
      'admin_select', 'admin_category', 'back_dashboard',
      'fees_toggle', 'fees_edit_buy', 'fees_edit_sell',
      'antispam_toggle', 'antispam_edit_settings',
      'market_edit_cooldown', 'market_edit_tax',
      'property_toggle', 'property_fee', 'property_limit', 'property_rent', 'property_cards',
      'property_edit_settings', 'property_manage_cards',
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
      'vault_panel', 'vault_toggle', 'vault_spawn', 'vault_interval', 
      'vault_reward', 'vault_channel',
      'modal_vault_interval', 'modal_vault_reward',
      'permissions_role', 'permissions_removerole',
      'modal_buy_fee', 'modal_sell_fee',
      'modal_antispam_settings',
      'modal_market_cooldown', 'modal_market_capital_gains',
      'modal_property_fee', 'modal_property_limit', 'modal_property_rentpercent', 'modal_property_cards',
      'modal_property_register_price', 'modal_property_settings', 'modal_add_card', 'modal_tier_weights',
      'property_role_select', 'cards_view_positive', 'cards_view_negative', 'cards_view_neutral', 
      'cards_add_card', 'back_property', 'property_edit_weights',
      'gambling_decks', 'gambling_settings', 'push_cards',
      'gambling_edit_blackjack', 'gambling_lottery_settings', 'gambling_toggle_scratch', 'gambling_scratch_config',
      'gambling_scratch_stats',
      'lottery_toggle_auto', 'lottery_edit_schedule', 'lottery_edit_prizes', 'lottery_set_channel', 'lottery_edit_ticket_price',
      'vault_toggle', 'vault_spawn', 'vault_reward', 'vault_channel', 'vault_force_spawn', 'back_gambling',
      'modal_blackjack_settings', 'modal_lottery_schedule', 'modal_lottery_prizes', 'modal_lottery_ticket_price', 'modal_vault_spawn', 'modal_vault_reward',
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
      'admin_income_work', 'admin_income_crime', 'admin_income_slut', 'back_income',
      'work_toggle', 'work_edit_settings',
      'modal_work_settings',
      'crime_toggle', 'crime_edit_settings', 'modal_crime_settings',
      'slut_toggle', 'slut_edit_settings', 'modal_slut_settings',
      'rob_toggle', 'rob_edit_settings', 'rob_immunity_settings', 'modal_rob_settings',
      'rob_add_immune_role', 'rob_clear_immune_roles', 'rob_immunity_role_select',
      'rob_defense_settings', 'rob_defense_toggle', 'rob_defense_edit', 'back_rob_defense', 'modal_rob_defense_settings',
      'rob_target_cooldown', 'modal_rob_target_cooldown',
      'admin_hack', 'hack_toggle', 'hack_edit_settings', 'hack_immunity_settings',
      'hack_add_immune_role', 'hack_clear_immune_roles', 'hack_immunity_role_select',
      'modal_hack_settings', 'back_hack',
      'admin_fight', 'fight_toggle', 'fight_edit_settings', 'fight_view_leaderboard', 'fight_view_history',
      'fight_reset_stats', 'fight_reset_confirm', 'modal_fight_settings', 'back_fight',
      'stocks_add', 'stocks_remove', 'stocks_reset_split', 'modal_stocks_add', 'modal_stocks_remove', 'modal_stocks_reset_split',
      'bank_settings', 'bank_loans_toggle', 'bank_bonds_toggle', 'bank_loan_settings', 'bank_loan_criteria',
      'bank_edit_loan_settings', 'bank_edit_requirements',
      'bank_toggle_req_properties', 'bank_toggle_req_portfolio', 'bank_toggle_req_tenure', 'bank_toggle_collateral',
      'bank_bond_settings', 'bank_add_bond', 'bank_view_loans', 'bank_view_bonds', 'bank_delete_active_bond',
      'modal_bank_criteria', 'modal_bank_loan_settings', 'modal_bank_bond_add',
      'wealth_tax_toggle', 'wealth_tax_schedule', 'wealth_tax_channel', 'wealth_tax_tiers', 'wealth_tax_preview',
      'wealth_tax_collect_now', 'wealth_tax_confirm_collect', 'wealth_tax_reset_tiers', 'wealth_tax_back',
      'wealth_tax_add_tier', 'wealth_tax_tier_select', 'wealth_tax_schedule_modal', 'wealth_tax_channel_modal', 
      'wealth_tax_add_tier_modal', 'wealth_tax_last_collection',
      'admin_skills', 'admin_skills_edit_xp', 'admin_skills_edit_hack', 'admin_skills_edit_rob',
      'admin_skills_view_levels', 'back_admin_skills',
      'modal_admin_skills_xp', 'modal_admin_skills_hack', 'modal_admin_skills_rob'
    ];
    
    // Check for exact match OR dynamic card/property edit IDs
    const isDynamicCardId = interaction.customId.startsWith('card_edit_') || 
                            interaction.customId.startsWith('card_delete_') ||
                            interaction.customId.startsWith('card_select_') ||
                            interaction.customId.startsWith('modal_edit_card_');
    const isDynamicPropId = interaction.customId.startsWith('prop_edit_') || 
                            interaction.customId.startsWith('modal_prop_');
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
                          interaction.customId.startsWith('modal_bank_bond_edit_');
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
    
    if (adminCustomIds.includes(interaction.customId) || isDynamicCardId || isDynamicPropId || isDynamicGiveCard || isDynamicMsgPage || isDynamicRoleIncome || isDynamicBank || isDynamicRob || isDynamicWealthTax || isDynamicScratch) {
      try {
        const { handleAdminInteraction } = require('./commands/admin');
        await handleAdminInteraction(interaction);
      } catch (error) {
        if (error.code === 10062 || error.code === 40060) return; // Interaction expired/acknowledged
        console.error('Error handling admin interaction:', error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 });
          }
        } catch (e) { /* Interaction expired */ }
      }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  // Track slash command usage as a message (always counts, no anti-spam)
  const userId = interaction.user.id;
  const username = interaction.user.username;
  
  createUser(userId, username);
  updateMessageCount(Date.now(), userId);
  
  // Periodically log price
  const userMessages = getUser(userId);
  if (userMessages && userMessages.total_messages % 10 === 0) {
    const currentPrice = calculateStockPrice(userId);
    logPrice(userId, currentPrice, Date.now());
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    // Ignore interaction errors - these happen when bot restarts while commands are pending
    // 10062 = Unknown interaction (expired), 40060 = Already acknowledged
    if (error.code === 10062 || error.code === 40060) {
      console.log(`⚠️ Interaction issue for /${interaction.commandName}: ${error.code === 10062 ? 'expired' : 'already acknowledged'}`);
      return;
    }
    
    console.error('Error executing command:', error);
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