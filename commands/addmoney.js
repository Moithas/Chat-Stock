const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addMoney, addToBank, forceRemoveMoney, removeFromBank, getBalance } = require('../economy');
const { getCurrency, logAdminAction, hasAdminPermission } = require('../admin');



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
        .setRequired(false)),

  async execute(interaction) {
    // Check admin permissions (Server Admin OR Stock Admin role)
    if (!hasAdminPermission(interaction.member, interaction.guildId)) {
      return interaction.reply({ content: '❌ You need admin permissions to use this command.', ephemeral: true });
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

    // Add/remove money — handle negative amounts by calling removal functions
    let success;
    if (amount >= 0) {
      if (type === 'cash') {
        success = await addMoney(guildId, userId, amount, reason);
      } else {
        success = await addToBank(guildId, userId, amount, reason);
      }
    } else {
      // Negative amount = admin removal (use forceRemove to allow going into debt)
      const absAmount = Math.abs(amount);
      if (type === 'cash') {
        success = await forceRemoveMoney(guildId, userId, absAmount, reason);
      } else {
        success = await removeFromBank(guildId, userId, absAmount, reason);
      }
    }

    if (!success) {
      return interaction.reply({ content: '❌ Failed to modify balance. User may have insufficient funds.', ephemeral: true });
    }

    // Get balance after
    const after = getBalance(guildId, userId);

    const action = amount >= 0 ? 'Added' : 'Removed';
    const absAmount = Math.abs(amount);

    // Log the admin action with full details
    logAdminAction(
      guildId, 
      interaction.user.id, 
      interaction.user.username, 
      `💰 ${action} ${absAmount.toLocaleString()} ${type} ${amount >= 0 ? 'to' : 'from'} ${targetUser.username}`,
      `User: <@${userId}> | Before: ${before.total.toLocaleString()} → After: ${after.total.toLocaleString()} | Reason: ${reason}`
    );

    const embed = new EmbedBuilder()
      .setColor(amount >= 0 ? 0x2ecc71 : 0xe74c3c)
      .setTitle(`💰 ${action} Money`)
      .setDescription(`${action} ${absAmount.toLocaleString()} ${getCurrency(guildId)} ${amount >= 0 ? 'to' : 'from'} ${targetUser.username}'s ${type}`)
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
