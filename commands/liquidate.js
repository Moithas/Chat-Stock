const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getPortfolio } = require('../database');
const { isEnabled, addMoney } = require('../economy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('liquidate')
    .setDescription('[ADMIN] Force liquidate a user\'s stock holdings')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user whose stock to liquidate')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    // Check if user is admin (has ADMINISTRATOR permission)
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ You need Administrator permission to use this command.',
        flags: 64
      });
    }

    const targetUser = interaction.options.getUser('user');
    const targetUserId = targetUser.id;

    const user = getUser(targetUserId);
    if (!user) {
      return interaction.reply({
        content: `❌ User ${targetUser.username} not found in database.`,
        flags: 64
      });
    }

    // Check if user has any stock holdings
    const portfolio = getPortfolio(targetUserId);
    if (portfolio.length === 0) {
      return interaction.reply({
        content: `❌ ${targetUser.username} doesn't own any stocks.`,
        flags: 64
      });
    }

    // Get all shareholders of this user's stock
    const { getAllStockHolders } = require('../database');
    const shareholders = getAllStockHolders(targetUserId);

    if (shareholders.length === 0) {
      return interaction.reply({
        content: `ℹ️ ${targetUser.username}'s stock has no shareholders.`,
        flags: 64
      });
    }

    await interaction.deferReply();

    let totalCompensation = 0;
    const compensations = [];

    // Calculate compensation for each shareholder
    for (const holding of portfolio) {
      const shareholders = getAllStockHolders(holding.stock_user_id);
      for (const shareholder of shareholders) {
        const compensation = Math.round(shareholder.shares * holding.avg_buy_price);
        totalCompensation += compensation;
        compensations.push({
          ownerId: shareholder.ownerId,
          compensation,
          shares: shareholder.shares,
          stockUserId: holding.stock_user_id
        });
      }
    }

    // Build response embed
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`💸 Liquidation Report: ${targetUser.username}`)
      .addFields(
        { name: 'Status', value: 'Processing...', inline: false }
      )
      .setTimestamp();

    // Since this command would need database write access and UBB integration,
    // we're marking it as a template. In production, you'd need to:
    // 1. Delete all stock holdings from the user
    // 2. Compensate each shareholder
    // 3. Log the transaction

    embed.setFields(
      { name: '⚠️ Note', value: 'This is a template command. Full implementation requires database write permissions.', inline: false },
      { name: 'Total Shareholders Affected', value: `${shareholders.length}`, inline: true },
      { name: 'Total Compensation', value: `${totalCompensation.toLocaleString()} <:babybel:1418824333664452608>`, inline: true }
    );

    await interaction.editReply({ embeds: [embed] });
  }
};
