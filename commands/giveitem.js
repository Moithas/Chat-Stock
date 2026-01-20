const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserInventory, getInventoryItem, getShopItem, addToInventory, removeFromInventory } = require('../items');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveitem')
    .setDescription('Give an item from your inventory to another user')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to give the item to')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Name of the item to give')
        .setRequired(true)
        .setAutocomplete(true))
    .addIntegerOption(opt =>
      opt.setName('quantity')
        .setDescription('How many to give (default: 1)')
        .setRequired(false)
        .setMinValue(1)),

  async autocomplete(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const focusedValue = interaction.options.getFocused().toLowerCase();
    
    // Get user's inventory
    const inventory = getUserInventory(guildId, userId);
    
    // Filter items that match the search
    const filtered = inventory
      .filter(item => item.name.toLowerCase().includes(focusedValue))
      .slice(0, 25)
      .map(item => ({
        name: `${item.emoji} ${item.name} (x${item.quantity})`,
        value: item.name
      }));
    
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const guildId = interaction.guildId;
    const fromUser = interaction.user;
    const toUser = interaction.options.getUser('user');
    const itemName = interaction.options.getString('item');
    const quantity = interaction.options.getInteger('quantity') || 1;

    // Prevent self-transfers
    if (fromUser.id === toUser.id) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Invalid Transfer')
          .setDescription('You cannot give items to yourself!')],
        ephemeral: true
      });
    }

    // Prevent giving to bots
    if (toUser.bot) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Invalid Transfer')
          .setDescription('You cannot give items to bots!')],
        ephemeral: true
      });
    }

    // Get sender's inventory
    const inventory = getUserInventory(guildId, fromUser.id);
    
    // Find the item in their inventory (case-insensitive)
    const inventoryItem = inventory.find(i => i.name.toLowerCase() === itemName.toLowerCase());
    
    if (!inventoryItem) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Item Not Found')
          .setDescription(`You don't have **${itemName}** in your inventory.\n\nUse \`/inventory\` to see your items.`)],
        ephemeral: true
      });
    }

    // Check if sender has enough quantity
    if (inventoryItem.quantity < quantity) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Insufficient Quantity')
          .setDescription(`You only have **${inventoryItem.quantity}x ${inventoryItem.emoji} ${inventoryItem.name}**.\n\nYou tried to give **${quantity}**.`)],
        ephemeral: true
      });
    }

    // Remove from sender's inventory
    const removed = removeFromInventory(guildId, fromUser.id, inventoryItem.item_id, quantity);
    
    if (!removed) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Transfer Failed')
          .setDescription('Failed to remove item from your inventory. Please try again.')],
        ephemeral: true
      });
    }

    // Add to recipient's inventory
    const added = addToInventory(guildId, toUser.id, inventoryItem.item_id, quantity);
    
    if (!added.success) {
      // Rollback - give item back to sender
      addToInventory(guildId, fromUser.id, inventoryItem.item_id, quantity);
      
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Transfer Failed')
          .setDescription(added.error || 'Failed to add item to recipient\'s inventory. Your item has been returned.')],
        ephemeral: true
      });
    }

    // Success!
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🎁 Item Given!')
      .setDescription(`You gave **${quantity}x ${inventoryItem.emoji} ${inventoryItem.name}** to ${toUser}!`)
      .addFields(
        { name: '📤 From', value: `${fromUser}`, inline: true },
        { name: '📥 To', value: `${toUser}`, inline: true },
        { name: '📦 Item', value: `${inventoryItem.emoji} ${inventoryItem.name}`, inline: true }
      )
      .setFooter({ text: `Quantity: ${quantity}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Try to DM the recipient
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🎁 You Received an Item!')
        .setDescription(`**${fromUser.username}** gave you **${quantity}x ${inventoryItem.emoji} ${inventoryItem.name}**!`)
        .addFields(
          { name: '📦 Item', value: inventoryItem.name, inline: true },
          { name: '📝 Description', value: inventoryItem.description || 'No description', inline: false }
        )
        .setFooter({ text: `From: ${interaction.guild.name}` })
        .setTimestamp();

      await toUser.send({ embeds: [dmEmbed] });
    } catch (e) {
      // User has DMs disabled, that's fine
    }
  }
};
