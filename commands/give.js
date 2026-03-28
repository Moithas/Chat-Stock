const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, addMoney, removeMoney, removeFromBank } = require('../economy');
const { recordGiftProtection } = require('../rob');
const { getCurrency } = require('../admin');



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
      amount = parseInt(amountInput.replace(/,/g, ''));
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
          .setDescription(`You don't have any cash to give.\n\n💵 Cash: **${senderBalance.cash.toLocaleString()}** ${getCurrency(guildId)}`)],
        ephemeral: true
      });
    }

    // Check if sender has enough cash
    if (senderBalance.cash < amount) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Insufficient Funds')
          .setDescription(`You don't have enough cash to give.\n\n💵 Cash: **${senderBalance.cash.toLocaleString()}** ${getCurrency(guildId)}`)],
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

    // Infamy charity reduction: if recipient had negative balance (debt), reduce giver's infamy
    try {
      const recipientBalanceBefore = getBalance(guildId, toUser.id);
      // Calculate how much debt was cleared by this gift (recipient was in debt before)
      const recipientOldBalance = recipientBalanceBefore.cash - amount; // reconstruct pre-gift cash
      if (recipientOldBalance < 0) {
        const debtCleared = Math.min(amount, Math.abs(recipientOldBalance));
        const { reduceInfamy, getInfamySettings } = require('../infamy');
        const infSettings = getInfamySettings(guildId);
        if (infSettings.enabled && debtCleared > 0) {
          const reduction = Math.round(debtCleared * infSettings.charity_rate);
          if (reduction > 0) {
            reduceInfamy(guildId, fromUser.id, reduction, 'charity');
          }
        }
      }
    } catch (e) {
      // Infamy module not loaded, skip
    }

    const newSenderBalance = getBalance(guildId, fromUser.id);
    const newRecipientBalance = getBalance(guildId, toUser.id);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Gift Sent!')
      .setDescription(`${fromUser.username} gave **${amount.toLocaleString()}** ${getCurrency(guildId)} to <@${toUser.id}>`)
      .addFields(
        { 
          name: `${fromUser.username}'s Balance`, 
          value: `💵 Cash: ${newSenderBalance.cash.toLocaleString()} ${getCurrency(guildId)}\n🏦 Bank: ${newSenderBalance.bank.toLocaleString()} ${getCurrency(guildId)}`, 
          inline: true 
        },
        { 
          name: `${toUser.username}'s Balance`, 
          value: `💵 Cash: ${newRecipientBalance.cash.toLocaleString()} ${getCurrency(guildId)}\n🏦 Bank: ${newRecipientBalance.bank.toLocaleString()} ${getCurrency(guildId)}`, 
          inline: true 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
