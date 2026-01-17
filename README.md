Chat-Stock Discord Bot
A Discord bot that creates a stock market based on user chat activity! The more users chat, the more their "stock" is worth. Buy and sell shares of your favorite chatters!
Features

📈 Dynamic Stock Prices - Stock value increases with chat activity
💰 Buy & Sell System - Trade user stocks with slash commands
📊 Portfolio Tracking - View your holdings and profit/loss
🏆 Leaderboard - See the top stocks in your server
📉 Market Forces - Supply and demand affects stock prices
💾 SQLite Database - All data stored locally

Setup Instructions
1. Install Dependencies
In your terminal, run:
bashnpm install
This will install all required packages (discord.js, dotenv, better-sqlite3).
2. Configure Your Bot

Copy .env.example to a new file called .env:

bash   copy .env.example .env

Open .env and fill in your details:

DISCORD_TOKEN - Your bot token from Discord Developer Portal
GUILD_ID - Your Discord server ID (right-click server icon → Copy Server ID)
UBB_API_KEY - (Optional) UnbelievaBoat API key for economy integration



3. Enable Developer Mode in Discord
To get your Guild ID:

Open Discord Settings → Advanced
Enable "Developer Mode"
Right-click your server icon → Copy Server ID

4. Invite Your Bot
Create an invite link with these permissions:

Bot permissions: Send Messages, Read Messages, Use Slash Commands
OAuth2 URL Generator in Discord Developer Portal
Required scopes: bot, applications.commands

5. Start the Bot
bashnpm start
You should see:
✅ Logged in as YourBot#1234
🔄 Registering slash commands...
✅ Slash commands registered!
Available Commands

/buy @user [shares] - Buy shares of a user's stock
/sell @user [shares] - Sell shares you own
/portfolio [@user] - View stock portfolio
/price [@user] - Check current stock price
/leaderboard - View top 10 stocks

How It Works
Stock Value Calculation

Base Value: Starts at 100 coins
Activity Multiplier: +1% per message sent by the user
Demand Multiplier: More shares owned = higher price (up to 50% boost)

Example:

User has sent 50 messages
10 shares of their stock are held by others
Base price: 100 coins
Activity: 100 × 1.50 = 150 coins (50% increase)
Demand: 150 × 1.05 = 157.5 coins (5% increase)
Final Price: 157.5 coins per share

UnbelievaBoat Integration (TODO)
The bot has placeholder code for UnbelievaBoat integration in:

commands/buy.js - Check balance before purchase
commands/sell.js - Add coins after sale

To enable:

Get API key from UnbelievaBoat dashboard
Add to .env file
Implement the API calls (examples in comments)

File Structure
Chat-Stock/
├── bot.js              # Main bot file
├── database.js         # Database functions
├── package.json        # Dependencies
├── .env                # Your configuration (create this!)
├── .env.example        # Template for .env
├── README.md           # This file
├── commands/
│   ├── buy.js         # Buy command
│   ├── sell.js        # Sell command
│   ├── portfolio.js   # Portfolio command
│   ├── price.js       # Price command
│   └── leaderboard.js # Leaderboard command
└── chatstock.db       # SQLite database (auto-created)
Troubleshooting
Bot not responding to commands?

Make sure you've enabled Message Content Intent in Discord Developer Portal
Check that GUILD_ID is correct in .env
Restart the bot after making changes

Database errors?

Delete chatstock.db and restart the bot (will reset all data)

Commands not showing up?

Wait a few minutes for Discord to sync
Try kicking and re-inviting the bot

Future Enhancements

 Complete UnbelievaBoat economy integration
 Add dividends based on chat activity
 Stock splits when prices get too high
 Market events (crashes, booms)
 Trading history graphs
 Short selling mechanics

Support
For issues or questions, check the Discord.js documentation at https://discord.js.org