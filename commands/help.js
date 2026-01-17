const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn how the Chat Stock market works'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Chat Stock Market - How It Works')
      .setDescription(`Welcome to the server stock market! Trade shares of your fellow chatters based on their activity.`)
      .addFields(
        {
          name: '💬 How Stocks Work',
          value: `Every person in the server is a stock! The more you chat, the more your stock is worth. Your stock price increases with:\n• **Recent messages** - Only messages from the last 15 days count\n• **Market demand** - More shares owned = higher price\n• **Stay active** - Prices decay if you don't chat for 3+ days!`,
          inline: false
        },
        {
          name: '📈 Base Price Formula',
          value: `• Starting value: 100 ${CURRENCY}\n• +0.5% per message (last 15 days)\n• +0.5% per share owned by others (max +50%)\n• -5% per day of inactivity after 3 days (max -50%)`,
          inline: false
        },
        {
          name: '💰 Trading Commands',
          value: 
            `**\`/price [@user]\`** - Check stock price (with chart)\n` +
            `**\`/buy @user [shares]\`** - Purchase shares\n` +
            `**\`/sell @user [shares]\`** - Sell your shares\n` +
            `**\`/portfolio [@user]\`** - View stock holdings\n` +
            `**\`/leaderboard [type]\`** - Top stocks or portfolios`,
          inline: false
        },
        {
          name: '⚙️ Admin Commands',
          value: 
            `**\`/admin dashboard\`** - View all settings\n` +
            `**\`/admin fees\`** - Trading fee settings\n` +
            `**\`/admin antispam\`** - Anti-spam settings\n` +
            `**\`/admin market\`** - Market protection settings\n` +
            `**\`/admin ticker\`** - Stock ticker channel\n` +
            `**\`/admin permissions\`** - Admin role & logging`,
          inline: false
        },
        {
          name: '🎯 Trading Tips',
          value: 
            `• Buy stocks of consistently active chatters!\n` +
            `• Messages older than 15 days don't count toward price\n` +
            `• Inactive users (3+ days) lose 5% value per day\n` +
            `• Popular stocks (lots of shares owned) are more expensive\n` +
            `• Can't buy your own stock\n` +
            `• All transactions use UnbelievaBoat ${CURRENCY}`,
          inline: false
        },
        {
          name: '📊 Example',
          value: 
            `Alice sends 50 messages in the last 15 days → Base: 125 ${CURRENCY}\n` +
            `20 shares of Alice owned by others → +10% demand\n` +
            `Alice last chatted 2 days ago → No penalty\n` +
            `**Alice's stock price: 137.5 ${CURRENCY} per share**\n\n` +
            `If Alice goes inactive for 5 days → -10% decay penalty`,
          inline: false
        }
      )
      .setFooter({ text: 'Start chatting to increase your stock value! 📈' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};