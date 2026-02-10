const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');

const CURRENCY = '<:babybel:1418824333664452608>';

// Help page content
const helpPages = {
  overview: {
    title: '📊 Chat-Stock Overview',
    color: 0x5865F2,
    description: `Welcome to **Chat-Stock** - a full economy game built around server activity!\n\nEvery member is a tradeable stock. Chat more to increase your value, invest in active members, and grow your wealth through various activities.`,
    fields: [
      {
        name: '🎯 Getting Started',
        value: 
          `1. **Chat actively** - Your stock price rises with messages\n` +
          `2. **Check your balance** - Use \`/balance\` to see your ${CURRENCY}\n` +
          `3. **Deposit to bank** - Use \`/deposit\` to protect your money\n` +
          `4. **Buy stocks** - Invest in active chatters with \`/stock buy\`\n` +
          `5. **Earn income** - Use \`/income\` commands when off cooldown`,
        inline: false
      },
      {
        name: '💰 Ways to Earn Money',
        value: 
          `• **Work** - Safe, steady income\n` +
          `• **Slut** - Higher risk/reward\n` +
          `• **Crime** - Highest risk/reward\n` +
          `• **Gambling** - Blackjack, Roulette, Poker & more\n` +
          `• **Stock Trading** - Buy low, sell high\n` +
          `• **Rob/Hack** - Steal from other players\n` +
          `• **Dividends** - Own stock shares for daily payouts`,
        inline: false
      },
      {
        name: '📖 Help Categories',
        value: `Use the dropdown menu below to learn about specific features!`,
        inline: false
      }
    ]
  },
  
  stocks: {
    title: '📈 Stock Market Guide',
    color: 0x00c853,
    description: `Every server member is a tradeable stock! Prices are based on chat activity and demand.`,
    fields: [
      {
        name: '💬 How Stock Prices Work',
        value: 
          `Your stock price is calculated from:\n` +
          `• **Base Value**: 100 ${CURRENCY}\n` +
          `• **Activity**: Messages in the last 15 days boost price\n` +
          `• **Activity Tiers**: First msgs/day = full value, then diminishing returns\n` +
          `• **Demand**: More shares owned by others = higher demand\n` +
          `• **Streak Bonus**: Daily activity streaks boost price`,
        inline: false
      },
      {
        name: '📊 Using the Stock Panel',
        value: 
          `Use \`/stock\` to open the **Stock Panel** - your hub for all trading!\n\n` +
          `**Panel Features:**\n` +
          `• 📈 **Price** - View any user's stock price & chart\n` +
          `• 💰 **Buy** - Purchase shares of a user\n` +
          `• 💵 **Sell** - Sell shares you own\n` +
          `• 📁 **Portfolio** - View your or others' holdings\n` +
          `• ✂️ **Split** - Split your stock when price is high\n` +
          `• 📜 **History** - See Dividend and Bonus History\n`+
          `• 👥 **Shareholders** - See who owns shares of your stock or another stock`,
        inline: false
      },
      {
        name: '✂️ Stock Splits',
        value: 
          `When your stock price gets high, you can split it!\n` +
          `• **2:1 split**: Price halves, all shareholders get 2x shares\n` +
          `• Requires minimum price (check in the Stock Panel)\n` +
          `• Good strategy to make your stock more accessible`,
        inline: false
      },
      {
        name: '💡 Trading Tips',
        value: 
          `• Buy stocks of consistently active chatters\n` +
          `• Watch the dashboard for top gainers/losers\n` +
          `• Market events can temporarily boost/crash sectors\n` +
          `• Dividends pay out based on shares you own`,
        inline: false
      }
    ]
  },
  
  banking: {
    title: '🏦 Banking & Money',
    color: 0x3498db,
    description: `Protect your wealth with the banking system.`,
    fields: [
      {
        name: '💵 Cash vs Bank',
        value: 
          `**Cash (Wallet)**: Can be robbed by other players\n` +
          `**Bank**: Protected from /rob (but not /hack)\n\n` +
          `⚠️ Keep money in the bank to stay safer!`,
        inline: false
      },
      {
        name: '🏦 Banking Commands',
        value: 
          `\`/balance\` - Check your cash & bank balance\n` +
          `\`/deposit [amount|all]\` - Move cash to bank\n` +
          `\`/withdraw [amount|all]\` - Move bank to cash\n` +
          `\`/give @user [amount|all]\` - Send money to someone`,
        inline: false
      },
      {
        name: '💳 Loans',
        value: 
          `Need quick cash? Take out a loan!\n` +
          `• Borrow money with interest\n` +
          `• Make payments on schedule\n` +
          `• Missing payments has consequences\n`+
          `• Loans may have requirments like level or propertyto qualify`,
        inline: false
      },
      {
        name: '📜 Bonds',
        value: 
          `Earn passive income from your Savings Bond!\n` +
          `• Collect multiple times per day to maximize earnings\n` +
          `• Bonds come in multiple tiers with varying rates\n` +
          `• You can only have one active bond at a time`,
        inline: false
      }
    ]
  },
  
  income: {
    title: '💼 Income Commands',
    color: 0xf39c12,
    description: `Earn money through work, with varying risk/reward levels.`,
    fields: [
      {
        name: '💼 /income work',
        value: 
          `**Safe & Reliable**\n` +
          `• Guaranteed payout every time\n` +
          `• Lower rewards but no risk\n` +
          `• Good for steady income`,
        inline: true
      },
      {
        name: '💋 /income slut',
        value: 
          `**Medium Risk**\n` +
          `• Higher potential payout\n` +
          `• Chance of getting caught (fine)\n` +
          `• Fines can't exceed your balance`,
        inline: true
      },
      {
        name: '🔫 /income crime',
        value: 
          `**High Risk**\n` +
          `• Highest potential rewards\n` +
          `• Higher chance of failure\n` +
          `• Fines are % of your balance`,
        inline: true
      },
      {
        name: '📈 Collect',
        value: 
          `Collect earns income from your level on the server.\n` +
          `Bonds, Passive income from stocks, and Server Booster bonus are collected here as well.\n` +
          `All income sources have a cooldown between uses. Refer to the income panel to see details.`,
        inline: false
      }
    ]
  },
  
  gambling: {
    title: '🎰 Gambling Games',
    color: 0xe74c3c,
    description: `Test your luck with various casino games!`,
    fields: [
      {
        name: '🃏 /blackjack [bet]',
        value: 
          `Classic 21! Beat the dealer without going over.\n` +
          `• Hit, Stand, Double Down, or Split\n` +
          `• Blackjack pays 3:2`,
        inline: true
      },
      {
        name: '🎡 /roulette',
        value: 
          `Spin the wheel and bet on numbers/colors.\n` +
          `• Bet on specific numbers, colors, or ranges\n` +
          `• Different odds for different bets`,
        inline: true
      },
      {
        name: '🃏 /inbetween',
        value: 
          `Progressive pot card game (Acey Deucey).\n` +
          `• Two cards dealt as "poles"\n` +
          `• Bet if third card lands between\n` +
          `• Hit a pole = pay double!`,
        inline: true
      },
      {
        name: '🎴 /letitride [ante]',
        value: 
          `Poker-style game with 3 bet spots.\n` +
          `• Pull back or "let it ride"\n` +
          `• Pair of 10s or better wins`,
        inline: true
      },
      {
        name: '🃏 /three-card-poker [ante]',
        value: 
          `Three Card Poker with Pair Plus.\n` +
          `• Beat the dealer's hand\n` +
          `• Bonus payouts for big hands`,
        inline: true
      },
      {
        name: '🎰 /scratch',
        value: 
          `Buy and scratch lottery tickets!\n` +
          `• Match symbols to win\n` +
          `• Different ticket types available`,
        inline: true
      },
      {
        name: '🎟️ /lottery',
        value: 
          `Server-wide lottery drawings.\n` +
          `• Buy tickets for a chance to win the pot\n` +
          `• Drawings happen on schedule`,
        inline: false
      }
    ]
  },
  
  crime: {
    title: '🔓 Rob, Hack & Crime',
    color: 0x9b59b6,
    description: `Target other players to steal their wealth - but beware the risks!`,
    fields: [
      {
        name: '💰 /rob @user',
        value: 
          `Attempt to steal **cash** from someone's wallet.\n` +
          `• Only targets cash, not bank\n` +
          `• Victim can defend in different ways\n` +
          `• Success rate depends on skill level\n` +
          `• Failure = you pay a fine\n` +
          `• After an attempted robbery, the robber goes on a cooldown.`,
        inline: false
      },
      {
        name: '💻 /hack @user',
        value: 
          `Attempt to hack into someone's **bank account**.\n` +
          `• Targets banked money (more lucrative)\n` +
          `• Victim can deply virus and counter-hack\n` +
          `• Train your hack skill to improve odds\n` +
          `• After an attempted hack, the hacker goes on a cooldown.\n` +
          `• After succefully being hacked, the victim goes on a cooldown where they can't be hacked again for a period of time.`,
        inline: false
      },
      {
        name: '🎓 /skills',
        value: 
          `View and train your larceny skills!\n` +
          `• **Rob Training**: Improves /rob success\n` +
          `• **Hack Training**: Improves /hack success\n` +
          `• Training provides 75% of a level`,
        inline: false
      },
      {
        name: '🛡️ Protection',
        value: 
          `• Keep money in the bank (safe from /rob)\n` +
          `• Watch for hack attempts on your bank\n` +
          `• Trace attackers for a revenge bonus\n` +
          `• When someone Robs or Hacks, act quickly!`,
        inline: false
      }
    ]
  },
  
  property: {
    title: '🏠 Property System',
    color: 0x1abc9c,
    description: `Invest in properties for passive income and perks!`,
    fields: [
      {
        name: '🏘️ /property',
        value: 
          `• You may need to register for the property system before buying.\n` +
          `• View and manage your properties.\n` +
          `• Buy properties to earn Wealth Cards\n` +
          `• Upgrade properties for better returns\n` +
          `• Collect rent periodically`,
        inline: false
      },
      {
        name: '📈 Upgrades',
        value: 
          `Properties can be upgraded over time.\n` +
          `• Each upgrade increases income\n` +
          `• Upgrades take time to complete\n` +
          `• Higher tier = better earnings`,
        inline: false
      },
      {
        name: '💡 Strategy',
        value: 
          `• Buy Multiple properties\n` +
          `• Reinvest rent into upgrades\n` +
          `• Use and Maximize Wealth Cards`,
        inline: false
      }
    ]
  },
  
  items: {
    title: '🛒 Shop & Items',
    color: 0xe91e63,
    description: `Buy items from the shop for special effects and bonuses!`,
    fields: [
      {
        name: '🛒 /shop',
        value: 
          `Browse and purchase items.\n` +
          `• Various items with different effects\n` +
          `• Some items are consumable, others permanent\n` +
          `• Limited stock on some items`,
        inline: false
      },
      {
        name: '🎒 /inventory',
        value: 
          `View your owned items.\n` +
          `• See what items you have\n` +
          `• See effects and usage info of used items`,
        inline: false
      },
      {
        name: '🎁 /giveitem @user [item]',
        value: 
          `Give an item to another player.\n` +
          `• Trade items with friends\n` +
          `• Some items may be untradeable`,
        inline: false
      }
    ]
  },
  
  fight: {
    title: '🥊 Fight System',
    color: 0xff5722,
    description: `Challenge other players to fights and wager money!`,
    fields: [
      {
        name: '🥊 /fight @user [wager]',
        value: 
          `Challenge someone to a fight!\n` +
          `• Both players wager money\n` +
          `• Winner takes the pot\n` +
          `• Outcome based on various factors`,
        inline: false
      },
      {
        name: '⚔️ Fight Mechanics',
        value: 
          `• Fights are turn-based\n` +
          `• Watch for patterns in attacks\n` +
          `• Don't bet more than you can afford to lose!`,
        inline: false
      }
    ]
  },
  
  admin: {
    title: '⚙️ Admin Commands',
    color: 0x607d8b,
    description: `Server admin commands for configuring the bot.`,
    fields: [
      {
        name: '📊 /admin dashboard',
        value: `View all bot settings and system status.`,
        inline: true
      },
      {
        name: '🎰 /admin gambling',
        value: `Configure gambling games and limits.`,
        inline: true
      },
      {
        name: '💼 /admin work',
        value: `Set work/slut/crime payouts & cooldowns.`,
        inline: true
      },
      {
        name: '🏦 /admin bank',
        value: `Configure banking and interest rates.`,
        inline: true
      },
      {
        name: '💰 /admin dividends',
        value: `Set dividend rates and payout times.`,
        inline: true
      },
      {
        name: '🏠 /admin property',
        value: `Configure property system settings.`,
        inline: true
      },
      {
        name: '💻 /admin hack',
        value: `Configure hack system settings.`,
        inline: true
      },
      {
        name: '🛒 /admin items',
        value: `Manage shop items and prices.`,
        inline: true
      },
      {
        name: '🔧 /admin maintenance',
        value: `Bot maintenance and data tools.`,
        inline: true
      }
    ]
  }
};

function buildHelpEmbed(pageKey) {
  const page = helpPages[pageKey] || helpPages.overview;
  
  const embed = new EmbedBuilder()
    .setColor(page.color)
    .setTitle(page.title)
    .setDescription(page.description)
    .setTimestamp()
    .setFooter({ text: 'Chat-Stock Economy Bot • Use the menu to browse topics' });
  
  for (const field of page.fields) {
    embed.addFields(field);
  }
  
  return embed;
}

function buildHelpMenu(currentPage = 'overview', isAdmin = false) {
  const options = [
    { label: 'Overview', description: 'Getting started & basics', value: 'overview', emoji: '📊', default: currentPage === 'overview' },
    { label: 'Stock Market', description: 'Trading stocks & splits', value: 'stocks', emoji: '📈', default: currentPage === 'stocks' },
    { label: 'Banking & Money', description: 'Bank, deposits & dividends', value: 'banking', emoji: '🏦', default: currentPage === 'banking' },
    { label: 'Income Commands', description: 'Work, slut & crime', value: 'income', emoji: '💼', default: currentPage === 'income' },
    { label: 'Gambling', description: 'Casino games & betting', value: 'gambling', emoji: '🎰', default: currentPage === 'gambling' },
    { label: 'Rob & Hack', description: 'Stealing from players', value: 'crime', emoji: '🔓', default: currentPage === 'crime' },
    { label: 'Property', description: 'Real estate & passive income', value: 'property', emoji: '🏠', default: currentPage === 'property' },
    { label: 'Shop & Items', description: 'Buying & using items', value: 'items', emoji: '🛒', default: currentPage === 'items' },
    { label: 'Fight System', description: 'PvP battles & wagers', value: 'fight', emoji: '🥊', default: currentPage === 'fight' }
  ];
  
  // Only show admin option to admins
  if (isAdmin) {
    options.push({ label: 'Admin Commands', description: 'Server configuration', value: 'admin', emoji: '⚙️', default: currentPage === 'admin' });
  }
  
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help_menu')
      .setPlaceholder('Select a help topic...')
      .addOptions(options)
  );
}

function isUserAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || 
         member.permissions.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn how Chat-Stock works - comprehensive game guide'),

  async execute(interaction) {
    const isAdmin = isUserAdmin(interaction.member);
    const embed = buildHelpEmbed('overview');
    const menu = buildHelpMenu('overview', isAdmin);
    
    await interaction.reply({ embeds: [embed], components: [menu] });
  },
  
  // Handle menu interactions
  async handleInteraction(interaction) {
    if (!interaction.isStringSelectMenu()) return false;
    if (interaction.customId !== 'help_menu') return false;
    
    const selectedPage = interaction.values[0];
    const isAdmin = isUserAdmin(interaction.member);
    
    // Prevent non-admins from viewing admin page
    if (selectedPage === 'admin' && !isAdmin) {
      await interaction.reply({ content: '❌ You don\'t have permission to view admin commands.', flags: 64 });
      return true;
    }
    
    const embed = buildHelpEmbed(selectedPage);
    const menu = buildHelpMenu(selectedPage, isAdmin);
    
    await interaction.update({ embeds: [embed], components: [menu] });
    return true;
  }
};