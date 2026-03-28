const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, getAllBalances, removeMoney, addToBank } = require('../economy');
const { getCurrency } = require('../admin');



module.exports = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Move money from cash to bank')
    .addStringOption(opt =>
      opt.setName('amount')
        .setDescription('Amount to deposit (or "all" to deposit everything)')
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
      amount = balance.cash;
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
      // Cap at max cash if user enters more than they have
      if (amount > balance.cash) {
        amount = balance.cash;
      }
    }

    if (amount <= 0 || balance.cash === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Insufficient Funds')
          .setDescription(`You only have **${balance.cash.toLocaleString()}** ${getCurrency(guildId)} in cash.`)],
        ephemeral: true
      });
    }

    // Move money from cash to bank
    const removed = await removeMoney(guildId, userId, amount, 'Deposit to bank');
    if (!removed) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Deposit Failed')
          .setDescription('Unable to complete deposit. Please try again.')],
        ephemeral: true
      });
    }

    await addToBank(guildId, userId, amount, 'Deposit from cash');

    const newBalance = getBalance(guildId, userId);
    
    // Get ranking
    const allBalances = getAllBalances(guildId);
    const rank = allBalances.findIndex(b => b.userId === userId) + 1;
    const totalUsers = allBalances.length;

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Deposit Successful')
      .setDescription(`You deposited **${amount.toLocaleString()}** ${getCurrency(guildId)} to your bank.`)
      .addFields(
        { name: '💵 Cash', value: `${newBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '🏦 Bank', value: `${newBalance.bank.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '💎 Total', value: `${newBalance.total.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
      )
      .setFooter({ text: rank > 0 ? `Rank #${rank} of ${totalUsers}` : 'Unranked' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
