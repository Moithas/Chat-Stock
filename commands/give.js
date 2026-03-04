const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, addMoney, removeMoney, removeFromBank } = require('../economy');
const { recordGiftProtection } = require('../rob');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give money to another user')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to give money to')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('amount')
        .setDescription('Amount to give (or "all" to give everything)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const fromUser = interaction.user;
    const toUser = interaction.options.getUser('user');
    const amountInput = interaction.options.getString('amount');

    // Prevent self-transfers
    if (fromUser.id === toUser.id) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Invalid Transfer')
          .setDescription('You cannot give money to yourself!')],
        ephemeral: true
      });
    }

    // Prevent giving to bots
    if (toUser.bot) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Invalid Transfer')
          .setDescription('You cannot give money to bots!')],
        ephemeral: true
      });
    }

    const senderBalance = getBalance(guildId, fromUser.id);

    // Parse amount or use 'all' - only from cash
    let amount;
    if (amountInput.toLowerCase() === 'all') {
      amount = senderBalance.cash;
    } else {
      amount = parseInt(amountInput);
      if (isNaN(amount) || amount <= 0) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Invalid Amount')
            .setDescription('Please enter a valid number or "all".')],
          ephemeral: true
        });
      }
    }

    // Prevent giving debt (negative cash) or zero
    if (amount <= 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ No Cash to Give')
          .setDescription(`You don't have any cash to give.\n\n💵 Cash: **${senderBalance.cash.toLocaleString()}** ${CURRENCY}`)],
        ephemeral: true
      });
    }

    // Check if sender has enough cash
    if (senderBalance.cash < amount) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Insufficient Funds')
          .setDescription(`You don't have enough cash to give.\n\n💵 Cash: **${senderBalance.cash.toLocaleString()}** ${CURRENCY}`)],
        ephemeral: true
      });
    }

    // Remove from sender's cash
    const removed = await removeMoney(guildId, fromUser.id, amount, `Gift to ${toUser.username}`);
    
    if (!removed) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Transfer Failed')
          .setDescription('Unable to complete transfer. Please try again.')],
        ephemeral: true
      });
    }

    // Add to recipient's cash
    await addMoney(guildId, toUser.id, amount, `Gift from ${fromUser.username}`);
    
    // Record gift for rob protection (prevents exploitation)
    recordGiftProtection(guildId, fromUser.id, toUser.id);

    const newSenderBalance = getBalance(guildId, fromUser.id);
    const newRecipientBalance = getBalance(guildId, toUser.id);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Gift Sent!')
      .setDescription(`${fromUser.username} gave **${amount.toLocaleString()}** ${CURRENCY} to <@${toUser.id}>`)
      .addFields(
        { 
          name: `${fromUser.username}'s Balance`, 
          value: `💵 Cash: ${newSenderBalance.cash.toLocaleString()} ${CURRENCY}\n🏦 Bank: ${newSenderBalance.bank.toLocaleString()} ${CURRENCY}`, 
          inline: true 
        },
        { 
          name: `${toUser.username}'s Balance`, 
          value: `💵 Cash: ${newRecipientBalance.cash.toLocaleString()} ${CURRENCY}\n🏦 Bank: ${newRecipientBalance.bank.toLocaleString()} ${CURRENCY}`, 
          inline: true 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
