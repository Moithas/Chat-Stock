const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addMoney, addToBank, getBalance } = require('../economy');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addmoney')
    .setDescription('Add or remove money from a user (Admin only)')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to add/remove money from')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('Amount to add (use negative to remove)')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Add to cash or bank')
        .setRequired(true)
        .addChoices(
          { name: 'Cash', value: 'cash' },
          { name: 'Bank', value: 'bank' }
        ))
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for adjustment')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Double-check admin permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permissions to use this command.', ephemeral: true });
    }

    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser('user');
    const userId = targetUser.id;
    const amount = interaction.options.getInteger('amount');
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason') || 'Admin adjustment';

    // Prevent adding to bots
    if (targetUser.bot) {
      return interaction.reply({ content: '❌ Cannot modify bot balances.', ephemeral: true });
    }

    // Get balance before
    const before = getBalance(guildId, userId);

    // Add/remove money
    let success;
    if (type === 'cash') {
      success = await addMoney(guildId, userId, amount, reason);
    } else {
      success = await addToBank(guildId, userId, amount, reason);
    }

    if (!success) {
      return interaction.reply({ content: '❌ Failed to modify balance. User may have insufficient funds.', ephemeral: true });
    }

    // Get balance after
    const after = getBalance(guildId, userId);

    const action = amount >= 0 ? 'Added' : 'Removed';
    const absAmount = Math.abs(amount);

    const embed = new EmbedBuilder()
      .setColor(amount >= 0 ? 0x2ecc71 : 0xe74c3c)
      .setTitle(`💰 ${action} Money`)
      .setDescription(`${action} ${absAmount.toLocaleString()} ${CURRENCY} ${amount >= 0 ? 'to' : 'from'} ${targetUser.username}'s ${type}`)
      .addFields(
        { name: 'Before', value: `💵 Cash: ${before.cash.toLocaleString()}\n🏦 Bank: ${before.bank.toLocaleString()}\n💰 Total: ${before.total.toLocaleString()}`, inline: true },
        { name: 'After', value: `💵 Cash: ${after.cash.toLocaleString()}\n🏦 Bank: ${after.bank.toLocaleString()}\n💰 Total: ${after.total.toLocaleString()}`, inline: true },
        { name: 'Reason', value: reason, inline: false }
      )
      .setFooter({ text: `Admin: ${interaction.user.username}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
