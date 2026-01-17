const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, getAllBalances } = require('../economy');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your balance or another user balance')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to check (leave empty for yourself)')
        .setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    const balance = getBalance(guildId, userId);
    
    // Get ranking
    const allBalances = getAllBalances(guildId);
    const rank = allBalances.findIndex(b => b.userId === userId) + 1;
    const totalUsers = allBalances.length;

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`💰 ${targetUser.username}'s Balance`)
      .addFields(
        { name: '💵 Cash', value: `${balance.cash.toLocaleString()} ${CURRENCY}`, inline: true },
        { name: '🏦 Bank', value: `${balance.bank.toLocaleString()} ${CURRENCY}`, inline: true },
        { name: '💎 Total', value: `${balance.total.toLocaleString()} ${CURRENCY}`, inline: true }
      )
      .setFooter({ text: rank > 0 ? `Rank #${rank} of ${totalUsers}` : 'Unranked' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
