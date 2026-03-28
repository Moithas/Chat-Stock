const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, removeFromBank, addMoney } = require('../economy');
const { getCurrency } = require('../admin');



module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Move money from bank to cash')
    .addStringOption(opt =>
      opt.setName('amount')
        .setDescription('Amount to withdraw (or "all" to withdraw everything)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const amountInput = interaction.options.getString('amount');

    const balance = getBalance(guildId, userId);

    // Parse amount or use 'all'
    let amount;
    if (amountInput.toLowerCase() === 'all') {
      amount = balance.bank;
    } else {
      amount = parseInt(amountInput.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Invalid Amount')
            .setDescription('Please enter a valid number or "all".')]
        });
      }
      // Cap at max bank if user enters more than they have
      if (amount > balance.bank) {
        amount = balance.bank;
      }
    }

    if (amount <= 0 || balance.bank === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Insufficient Funds')
          .setDescription(`You only have **${balance.bank.toLocaleString()}** ${getCurrency(guildId)} in your bank.`)],
        ephemeral: true
      });
    }

    // Move money from bank to cash
    const removed = await removeFromBank(guildId, userId, amount, 'Withdrawal to cash');
    if (!removed) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Withdrawal Failed')
          .setDescription('Unable to complete withdrawal. Please try again.')],
        ephemeral: true
      });
    }

    await addMoney(guildId, userId, amount, 'Withdrawal from bank');

    const newBalance = getBalance(guildId, userId);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Withdrawal Successful')
      .setDescription(`You withdrew **${amount.toLocaleString()}** ${getCurrency(guildId)} from your bank.`)
      .addFields(
        { name: '💵 Cash', value: `${newBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '🏦 Bank', value: `${newBalance.bank.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '💎 Total', value: `${newBalance.total.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
