const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getSupportServerUrl } = require('../admin');



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
          `2. **Check your balance** - Use \`/balance\` to see your money\n` +
          `3. **Deposit to bank** - Use \`/deposit\` to protect your money\n` +
          `4. **Buy stocks** - Invest in active chatters with \`/stock buy\`\n` +
          `5. **Earn income** - Use \`/income\` commands when off cooldown`,
        inline: false
      },
      {
        name: '💰 Ways to Earn Money',
        value: 
          `• **Work / Hunt** - Steady income or random loot drops\n` +
          `• **Lucky Penny** - Roll for random buffs, debuffs, or cash\n` +
          `• **Gambling** - Blackjack, Roulette, Poker, SYN & more\n` +
          `• **Stock Trading** - Buy low, sell high\n` +
          `• **Rob / Hack** - Steal from other players\n` +
          `• **Dividends** - Own stock shares for daily payouts\n` +
          `• **Dungeon** - Battle monsters for gold rewards`,
        inline: false
      },
      {
        name: '🏆 Tracking Progress',
        value:
          `• \`/leaderboard\` - See rankings for stocks, portfolios, balances & fights\n` +
          `• \`/stock\` **Price** - View any user's stock, chart & chat streak\n` +
          `• **Dashboard** - Auto-updating market board in the ticker channel`,
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
          `• **Base Value**: Grows permanently with each message\n` +
          `• **Activity Tiers**: Daily messages boost price with diminishing returns\n` +
          `• **Demand**: More shares owned by others = higher demand multiplier\n` +
          `• **Chat Streak**: Consecutive active days grant bonus tiers\n` +
          `• **Inactivity**: 3+ days without chatting applies a decay penalty`,
        inline: false
      },
      {
        name: '🔥 Chat Streak Tiers',
        value:
          `Consecutive days of activity unlock bonuses:\n` +
          `• **7 days** — 🔥 Bronze Streak (+2% stock price)\n` +
          `• **14 days** — 🔥🔥 Silver Streak (+4% stock price)\n` +
          `• **30 days** — 🔥🔥🔥 Gold Streak (+7% stock price)\n` +
          `Gold expires after 7 days and your streak resets to 0.\nMissing a full day breaks your streak!`,
        inline: false
      },
      {
        name: '📊 Using the Stock Panel',
        value: 
          `Use \`/stock\` to open the **Stock Panel** - your hub for all trading!\n\n` +
          `**Panel Features:**\n` +
          `• 📈 **Price** - View any user's stock price, chart & streak\n` +
          `• 💰 **Buy** - Purchase shares of a user\n` +
          `• 💵 **Sell** - Sell shares you own\n` +
          `• 📁 **Portfolio** - View your or others' holdings\n` +
          `• ✂️ **Split** - Split your stock when price is high\n` +
          `• 📜 **History** - See Dividend and Bonus History\n` +
          `• 👥 **Shareholders** - See who owns shares of your stock`,
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
        name: '💵 Dividends & CEO Bonus',
        value:
          `• **Dividends**: Shareholders receive periodic payouts based on stock price\n` +
          `• **CEO Bonus**: You earn 5% of total dividends your stock pays out\n` +
          `• Payout time is set by admins — check the ticker for announcements`,
        inline: false
      },
      {
        name: '📰 Market Events & Dashboard',
        value: 
          `• **Market Events** trigger after a number of server messages\n` +
          `• Events temporarily boost or crash all stock prices (±3–30%)\n` +
          `• The **Dashboard** auto-updates in the ticker channel with top stocks, gainers/losers & market trends`,
        inline: false
      },
      {
        name: '💡 Trading Tips',
        value: 
          `• Buy stocks of consistently active chatters\n` +
          `• Watch the dashboard for top gainers/losers\n` +
          `• Check a user's chat streak before buying — streaks boost price\n` +
          `• Use \`/leaderboard\` to find top stocks and portfolios`,
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
          `\`/give @user [amount|all]\` - Send money to someone\n` +
          `\`/bank\` - Open the full banking panel`,
        inline: false
      },
      {
        name: '💳 Loans',
        value: 
          `Need quick cash? Take out a loan!\n` +
          `• Borrow money with interest\n` +
          `• Make payments on schedule\n` +
          `• Missing payments has consequences\n` +
          `• Loans may have requirements like level or property to qualify`,
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
      },
      {
        name: '📊 Credit Score',
        value:
          `Your credit score is tracked based on financial behavior.\n` +
          `• Affects your loan eligibility and interest rates\n` +
          `• Good credit unlocks better loan terms\n` +
          `• View your score in the \`/bank\` panel`,
        inline: false
      },
      {
        name: '🛡️ Rob Immunity',
        value:
          `Purchase protection from being robbed.\n` +
          `• Multiple tiers of immunity available\n` +
          `• Higher tiers last longer\n` +
          `• Buy from the \`/bank\` panel`,
        inline: false
      },
      {
        name: '💰 Wealth Tax',
        value:
          `A periodic tax on total net worth (cash + stocks + properties).\n` +
          `• Progressive tiers — higher net worth = higher rate\n` +
          `• Tax collected goes to the lottery jackpot\n` +
          `• Check your estimated tax in the \`/bank\` panel`,
        inline: false
      }
    ]
  },
  
  income: {
    title: '💼 Income Commands',
    color: 0xf39c12,
    description: `Earn money through work and various income sources. Use \`/income\` to open the panel.`,
    fields: [
      {
        name: '💼 Work',
        value: 
          `**Safe & Reliable**\n` +
          `• Guaranteed payout every time\n` +
          `• Lower rewards but no risk\n` +
          `• Good for steady income`,
        inline: true
      },
      {
        name: '🏹 Hunt',
        value: 
          `**Random Drops**\n` +
          `• Chance to find items, currency, or nothing\n` +
          `• No risk — just a cooldown\n` +
          `• Eligible items set by admins`,
        inline: true
      },
      {
        name: '🪙 Lucky Penny',
        value:
          `**Random Roller**\n` +
          `• Roll for a random outcome\n` +
          `• **Buff**: Temporary boost to various stats\n` +
          `• **Debuff**: Temporary penalty\n` +
          `• **Cash**: Instant currency reward\n` +
          `• **Nothing**: Shorter cooldown`,
        inline: true
      },
      {
        name: '🪙 Lucky Penny Effects',
        value:
          `Buffs/debuffs can affect:\n` +
          `• Work payout, Hack/Rob success rates\n` +
          `• Hack/Rob cooldowns and fines\n` +
          `• Hack/Rob XP earned\n` +
          `• Your personal stock price\n` +
          `Effects are temporary and show in relevant commands.`,
        inline: false
      },
      {
        name: '📈 Collect',
        value: 
          `\`/income collect\` gathers all passive income:\n` +
          `• **Stock Bonus** — Income from your stock value & holders\n` +
          `• **Bond Interest** — From your active savings bond\n` +
          `• **Role Income** — Server Booster and other role bonuses\n` +
          `All income sources have independent cooldowns.`,
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
        name: '🃏 /syn [bet]',
        value:
          `Screw Your Neighbor (multiplayer).\n` +
          `• Avoid having the lowest card\n` +
          `• Trade cards with your neighbor\n` +
          `• Last player standing wins!`,
        inline: true
      },
      {
        name: '🎰 /scratch & /scratcher',
        value: 
          `Buy and scratch lottery tickets!\n` +
          `• \`/scratcher\` — Full scratch card shop & panel\n` +
          `• \`/scratch\` — Quick scratch game\n` +
          `• Match symbols to win prizes`,
        inline: true
      },
      {
        name: '🎟️ /lottery',
        value: 
          `Server-wide lottery drawings.\n` +
          `• Buy tickets for a chance to win the pot\n` +
          `• Funded by wealth tax collections`,
        inline: true
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
          `• Victim can deploy virus and counter-hack\n` +
          `• Train your hack skill to improve odds\n` +
          `• After an attempted hack, the hacker goes on a cooldown.\n` +
          `• After being hacked, the victim has temporary immunity.`,
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
          `• Purchase **Rob Immunity** from the \`/bank\` panel\n` +
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
    title: '🥊 Fight & Dungeon',
    color: 0xff5722,
    description: `Challenge other players to fights or enter the dungeon solo!`,
    fields: [
      {
        name: '🥊 /fight @user [wager]',
        value: 
          `Challenge someone to a fight!\n` +
          `• Both players wager money\n` +
          `• Winner takes the pot\n` +
          `• Fights are turn-based with multiple attack types`,
        inline: false
      },
      {
        name: '⚔️ Fight Moves (3-Way Cycle)',
        value: 
          `**👊 Strike** beats 🤼 Takedown (15 dmg)\n` +
          `**🤼 Takedown** beats 🤝 Choke (20 dmg)\n` +
          `**🤝 Choke** beats 👊 Strike (25 dmg)\n` +
          `**💚 Grapple** — Heal 25 HP, but take damage from any attack. Has a cooldown.\n` +
          `Same move vs same move = stalemate (no damage)`,
        inline: false
      },
      {
        name: '🏰 /dungeon',
        value:
          `Solo PvE dungeon crawl through 5 floors!\n` +
          `• Battle progressively harder NPC enemies\n` +
          `• Rewards scale per floor cleared\n` +
          `• **Escape** after any floor to keep your earnings\n` +
          `• **Death** = lose 50% of earned earnings\n` +
          `• Has a cooldown between runs`,
        inline: false
      },
      {
        name: '⚔️ Dungeon Moves (5-Way Cycle)',
        value:
          `**💥 Exploit** beats Corrupt & Isolate | loses to Spam & Override\n` +
          `**☠️ Corrupt** beats Isolate & Spam | loses to Override & Exploit\n` +
          `**🔒 Isolate** beats Spam & Override | loses to Exploit & Corrupt\n` +
          `**📡 Spam** beats Override & Exploit | loses to Isolate & Corrupt\n` +
          `**🔄 Override** beats Exploit & Corrupt | loses to Spam & Isolate\n` +
          `**💚 Restore** — Heal 25 HP, but take damage from any attack. Has a cooldown.`,
        inline: false
      }
    ]
  },

  events: {
    title: '🎪 Server Events',
    color: 0xff9800,
    description: `Special events that happen as the server stays active!`,
    fields: [
      {
        name: '📰 Market Events',
        value:
          `Triggered after a number of server messages.\n` +
          `• **Bull Events** temporarily boost all stock prices\n` +
          `• **Bear Events** temporarily drop all stock prices\n` +
          `• Effects last 1-4 hours\n` +
          `• Announced in the ticker channel`,
        inline: false
      },
      {
        name: '🏦 Vault',
        value:
          `A Vault randomly spawns in the ticker channel after enough messages.\n` +
          `• Click the button to claim a random cash reward\n` +
          `• First-come-first-served — react fast!\n` +
          `• Watch out for booby traps`,
        inline: false
      },
      {
        name: '📊 Leaderboard',
        value:
          `Use \`/leaderboard\` to see server rankings!\n` +
          `• **Stock Prices** — Highest valued stocks\n` +
          `• **Portfolios** — Biggest portfolio values\n` +
          `• **Balances** — Richest players by cash + bank\n` +
          `• **Fighters** — Best fight win records`,
        inline: false
      }
    ]
  },

  infamy: {
    title: '🏴‍☠️ Infamy & Bounty System',
    color: 0x8b0000,
    description: `Criminal activity builds **Infamy** — a reputation score that tracks how notorious you are. Higher infamy brings powerful perks but also severe penalties.`,
    fields: [
      {
        name: '📊 Infamy Tiers',
        value:
          `Your tier is based on your total infamy points:\n` +
          `• **T0 — Clean** (0-14,999) — No effects\n` +
          `• **T1 — Suspect** 🔍 (15k-29,999) — No effects yet\n` +
          `• **T2 — Criminal** 🔓 (30k-59,999) — +5% success, +10% fines\n` +
          `• **T3 — Wanted** ⚠️ (60k-99,999) — +10% success, -5% earnings, +20% fines\n` +
          `• **T4 — Most Wanted** 🚨 (100k-149,999) — +15% success, -10% earnings, +30% fines, +5% trade fees, +2s vault delay\n` +
          `• **T5 — Blacklisted** 💀 (150k+) — +20% success, -20% earnings, +50% fines, +10% trade fees, vault locked`,
        inline: false
      },
      {
        name: '💰 How You Gain Infamy',
        value:
          `Infamy is earned from criminal activities:\n` +
          `• **Hacking** — 0.2× the amount stolen\n` +
          `• **Robbing** — 0.5× the amount stolen\n` +
          `• **Vault Claims** — 1.0× the vault reward\n` +
          `• **Insider Trading** — 1,000 flat per detected stock`,
        inline: false
      },
      {
        name: '🏴‍☠️ Bounty System',
        value:
          `At T3+, each crime has a chance to post a **Bounty** on you:\n` +
          `• T3: 15% chance | T4: 30% | T5: 50%\n` +
          `• Bounty amount = your current infamy points\n` +
          `• Bounty grows with each crime you commit\n` +
          `• Anyone who successfully hacks/robs you **claims the bounty**\n` +
          `• Only 1 active bounty per player at a time\n` +
          `• View active bounties on the **Bounty Board** in \`/bank\``,
        inline: false
      },
      {
        name: '🔍 Insider Trading',
        value:
          `When a market event hits, the system snapshots all portfolios.\n` +
          `If you sell stocks that gained value from the event:\n` +
          `• **5-10% gain** → 10% detection chance per stock\n` +
          `• **10-20% gain** → 25% detection chance\n` +
          `• **20%+ gain** → 45% detection chance\n` +
          `Detection = 1,000 infamy + public announcement`,
        inline: false
      },
      {
        name: '⏬ Reducing Infamy',
        value:
          `Infamy decays and can be actively reduced:\n` +
          `• **Hourly Decay** — 1 point/hour (automatic)\n` +
          `• **Charity** — Give money to players in debt (0.1× debt cleared)\n` +
          `• **Dungeon** — Clear dungeon floors (25 points/floor)\n` +
          `• **Bounty Claimed** — When someone claims your bounty, you enter **probation** (1 day per tier), then reset to 0`,
        inline: false
      },
      {
        name: '📋 Commands',
        value:
          `\`/infamy\` — View your infamy tier, stats & effects\n` +
          `\`/infamy [user]\` — Check another player's infamy\n` +
          `\`/bank\` → **Bounty Board** — See all active bounties`,
        inline: false
      }
    ]
  },

  profile: {
    title: '📋 Player Profile',
    color: 0x3498db,
    description: `Use \`/profile\` to view detailed stats about any player across all systems.`,
    fields: [
      {
        name: '📋 Overview',
        value:
          `The default landing page shows total wealth, server rank, account age, messages, and items owned.`,
        inline: false
      },
      {
        name: '📂 Categories',
        value:
          `Use the buttons to switch between detailed category views:\n` +
          `• **💰 Finance** — Cash, bank, properties, credit score, streak, taxes, loans & bonds\n` +
          `• **📈 Stock** — Portfolio, shareholders, price rank, dividends & capital gains\n` +
          `• **🔓 Crime** — Hack/rob levels, infamy, bounties & steal history\n` +
          `• **🎰 Gambling** — Per-game stats for every casino game + total P/L\n` +
          `• **🥊 Fight** — Wins, losses, KOs, win rate & streaks\n` +
          `• **🏰 Dungeon** — Per-tier runs, clears, gold earned & keys owned`,
        inline: false
      },
      {
        name: '👤 Viewing Other Players',
        value:
          `Use the **user dropdown** at the top of the embed to select any server member and view their profile.`,
        inline: false
      }
    ]
  },
  
  prestige: {
    title: '🎖️ Prestige System',
    color: 0xFFD700,
    description: `Sacrifice everything for permanent bonuses. Use \`/prestige\` to view your status and prestige up.`,
    fields: [
      {
        name: '🏆 Prestige Tiers',
        value:
          `🥉 **Bronze** — 100M total wealth\n` +
          `🥈 **Silver** — 500M total wealth\n` +
          `🥇 **Gold** — 1.5B total wealth\n` +
          `💠 **Platinum** — 5B total wealth\n` +
          `💎 **Diamond** — 150B total wealth`,
        inline: false
      },
      {
        name: '🎁 Permanent Bonuses (per tier)',
        value:
          `• **+5% income** from all sources\n` +
          `• **+10% XP** for hack & rob skills\n` +
          `• **+100% borrow limit** from bank\n` +
          `• Starting cash bonus (25K–500K)\n` +
          `• Prestige badge on profile`,
        inline: false
      },
      {
        name: '💀 What Gets Reset',
        value:
          `Cash, bank, stocks, properties, items, effects, loans, bonds, credit score, cooldowns, and skills XP.`,
        inline: true
      },
      {
        name: '✅ What Stays',
        value:
          `Fight stats, dungeon progress, infamy, gambling stats, chat streak, and stock popularity.`,
        inline: true
      },
      {
        name: '⏱️ Rules',
        value:
          `• 1-week cooldown between prestiges\n` +
          `• Must have total wealth ≥ tier cost\n` +
          `• **Irreversible** — cannot be undone`,
        inline: false
      }
    ]
  },
  
  admin: {
    title: '⚙️ Admin Commands',
    color: 0x607d8b,
    description: `Use \`/admin\` to open the admin dashboard. All settings are managed through the dropdown menu.`,
    fields: [
      {
        name: '💰 Economy',
        value: 'Wealth tax brackets, bank loans & bonds, dividend payouts',
        inline: true
      },
      {
        name: '💵 Income',
        value: 'Work, Hunt & Lucky Penny settings',
        inline: true
      },
      {
        name: '🎰 Gambling',
        value: 'Lottery, scratch cards, SYN & vault',
        inline: true
      },
      {
        name: '⚔️ Combat',
        value: 'Fight wagers, dungeon, rob & hack',
        inline: true
      },
      {
        name: '�‍☠️ Infamy',
        value: 'Criminal reputation, bounties & insider trading',
        inline: true
      },
      {
        name: '🎓 Skills',
        value: 'XP rates, training & level bonuses',
        inline: true
      },
      {
        name: '🛒 Items',
        value: 'Shop items, prices & effects',
        inline: true
      },
      {
        name: '🏠 Properties',
        value: 'Wealth cards, tiers & upgrades',
        inline: true
      },
      {
        name: '⚙️ System',
        value: 'Market fees, ticker, events & anti-spam',
        inline: true
      },
      {
        name: '🔨 Admin-Only Commands',
        value: 
          `\`/addmoney\` - Add/remove money from a user\n` +
          `\`/liquidate\` - Force-liquidate a user's stock\n` +
          `\`/purge-users\` - Remove departed users from DB`,
        inline: false
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
    { label: 'Stock Market', description: 'Trading, streaks & dividends', value: 'stocks', emoji: '📈', default: currentPage === 'stocks' },
    { label: 'Banking & Money', description: 'Bank, loans, bonds & taxes', value: 'banking', emoji: '🏦', default: currentPage === 'banking' },
    { label: 'Income Commands', description: 'Work, Hunt & Lucky Penny', value: 'income', emoji: '💼', default: currentPage === 'income' },
    { label: 'Gambling', description: 'Casino games & betting', value: 'gambling', emoji: '🎰', default: currentPage === 'gambling' },
    { label: 'Rob & Hack', description: 'Stealing from players', value: 'crime', emoji: '🔓', default: currentPage === 'crime' },
    { label: 'Property', description: 'Real estate & passive income', value: 'property', emoji: '🏠', default: currentPage === 'property' },
    { label: 'Shop & Items', description: 'Buying & using items', value: 'items', emoji: '🛒', default: currentPage === 'items' },
    { label: 'Fight & Dungeon', description: 'PvP battles & PvE dungeon', value: 'fight', emoji: '🥊', default: currentPage === 'fight' },
    { label: 'Events & Leaderboard', description: 'Market events, vault & rankings', value: 'events', emoji: '🎪', default: currentPage === 'events' },
    { label: 'Infamy & Bounty', description: 'Criminal reputation system', value: 'infamy', emoji: '🏴‍☠️', default: currentPage === 'infamy' },
    { label: 'Player Profile', description: 'View detailed player stats', value: 'profile', emoji: '📋', default: currentPage === 'profile' },
    { label: 'Prestige', description: 'Prestige tiers & permanent bonuses', value: 'prestige', emoji: '🎖️', default: currentPage === 'prestige' }
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

function buildLinkButtons(guildId) {
  const supportUrl = getSupportServerUrl(guildId);
  if (!supportUrl) return null;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Support Server')
      .setStyle(ButtonStyle.Link)
      .setURL(supportUrl)
      .setEmoji('❓')
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
    const components = [menu];
    const linkRow = buildLinkButtons(interaction.guildId);
    if (linkRow) components.push(linkRow);
    
    await interaction.reply({ embeds: [embed], components });
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
    const components = [menu];
    const linkRow = buildLinkButtons(interaction.guildId);
    if (linkRow) components.push(linkRow);
    
    await interaction.update({ embeds: [embed], components });
    return true;
  }
};