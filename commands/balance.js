const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, getAllBalances } = require('../economy');
const { getCurrency } = require('../admin');
const { getLoanWarning } = require('../bank');



module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your balance or another user balance')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to check (leave empty for yourself)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    const balance = getBalance(guildId, userId);
    
    // Get ranking
    const allBalances = getAllBalances(guildId);
    const rank = allBalances.findIndex(b => b.userId === userId) + 1;
    const totalUsers = allBalances.length;

    // Only show loan warning when checking own balance
    const loanWarning = (userId === interaction.user.id) ? getLoanWarning(guildId, userId, getCurrency(guildId)) : null;

    const embed = new EmbedBuilder()
      .setColor(loanWarning ? 0xE74C3C : 0x3498db)
      .setTitle(`💰 ${targetUser.username}'s Balance`)
      .addFields(
        { name: '💵 Cash', value: `${balance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '🏦 Bank', value: `${balance.bank.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '💎 Total', value: `${balance.total.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
      )
      .setFooter({ text: rank > 0 ? `Rank #${rank} of ${totalUsers}` : 'Unranked' })
      .setTimestamp();

    if (loanWarning) {
      embed.setDescription(loanWarning.trim());
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
