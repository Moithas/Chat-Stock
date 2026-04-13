const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getBalance, removeMoney, addMoney } = require('../economy');
const { 
  getShopItems, 
  getShopItem, 
  getItemSettings, 
  addToInventory, 
  recordPurchase,
  initializeDefaultItems,
  ITEM_CATEGORIES,
  formatDuration,
  isServiceItem
} = require('../items');
const { getCurrency } = require('../admin');


const ITEMS_PER_PAGE = 5;

// Helper function to safely parse emoji for select menu options
// Custom emojis like <:name:id> need to be converted to { id, name } format
function parseEmojiForSelect(emojiStr) {
  if (!emojiStr) return '📦';
  
  // Check if it's a custom emoji like <:name:123456789> or <a:name:123456789>
  const customEmojiMatch = emojiStr.match(/^<(a?):(\w+):(\d+)>$/);
  if (customEmojiMatch) {
    return {
      animated: customEmojiMatch[1] === 'a',
      name: customEmojiMatch[2],
      id: customEmojiMatch[3]
    };
  }
  
  // Check if it's just an emoji ID (numbers only)
  if (/^\d+$/.test(emojiStr)) {
    return { id: emojiStr };
  }
  
  // Check if it's an invalid shortcode like :name: (won't work in select menus)
  if (/^:\w+:$/.test(emojiStr)) {
    return '📦'; // Fall back to default
  }
  
  // Otherwise treat it as a unicode emoji or return default
  if (emojiStr.length <= 8 && !emojiStr.includes(':')) {
    return emojiStr;
  }
  
  // Invalid format, return default
  return '📦';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse and buy items from the shop')
    .addStringOption(option =>
      option.setName('category')
        .setDescription('Filter by category')
        .setRequired(false)
        .addChoices(
          { name: '🛡️ Protection', value: 'protection' },
          { name: '⚡ Boosts', value: 'boost' },
          { name: '🔧 Utility', value: 'utility' },
          { name: '🎁 Consumable', value: 'consumable' },
          { name: '✨ Special', value: 'special' },
          { name: '📦 All Items', value: 'all' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const categoryFilter = interaction.options.getString('category');
    
    // Check if shop is enabled
    const settings = getItemSettings(guildId);
    if (!settings.shopEnabled) {
      return interaction.editReply({ 
        content: '🚫 The shop is currently closed!'
      });
    }
    
    // Initialize default items if none exist
    initializeDefaultItems(guildId);
    
    // Get items
    const category = categoryFilter === 'all' ? null : categoryFilter;
    const items = getShopItems(guildId, category, true);
    
    if (items.length === 0) {
      return interaction.editReply({ 
        content: '📦 The shop is empty! Ask an admin to add some items.'
      });
    }
    
    // Get user's balance
    const balance = getBalance(guildId, userId);
    
    // Create the shop embed
    const embed = createShopEmbed(guildId, items, 0, balance.cash, categoryFilter);
    const components = createShopComponents(items, 0, guildId, userId);
    
    const response = await interaction.editReply({ 
      embeds: [embed], 
      components
    });
    
    // Create collector for interactions
    const collector = response.createMessageComponentCollector({ 
      time: 300000 // 5 minutes
    });
    
    let currentPage = 0;
    let selectedItemId = null;
    
    collector.on('collect', async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: 'This shop is not for you!', ephemeral: true });
      }
      
      try {
        // Handle page navigation
        if (i.customId === 'shop_prev') {
          currentPage = Math.max(0, currentPage - 1);
          const freshBalance = getBalance(guildId, userId);
          const newEmbed = createShopEmbed(guildId, items, currentPage, freshBalance.cash, categoryFilter);
          const newComponents = createShopComponents(items, currentPage, guildId, userId);
          await i.update({ embeds: [newEmbed], components: newComponents });
        }
        else if (i.customId === 'shop_next') {
          const maxPage = Math.ceil(items.length / ITEMS_PER_PAGE) - 1;
          currentPage = Math.min(maxPage, currentPage + 1);
          const freshBalance = getBalance(guildId, userId);
          const newEmbed = createShopEmbed(guildId, items, currentPage, freshBalance.cash, categoryFilter);
          const newComponents = createShopComponents(items, currentPage, guildId, userId);
          await i.update({ embeds: [newEmbed], components: newComponents });
        }
        // Handle item selection
        else if (i.customId === 'shop_select') {
          selectedItemId = parseInt(i.values[0]);
          const item = getShopItem(guildId, selectedItemId);
          
          if (!item) {
            return i.reply({ content: '❌ Item not found!', ephemeral: true });
          }
          
          // Show item details with buy button (fresh balance check)
          const freshBalance = getBalance(guildId, userId);
          const detailEmbed = createItemDetailEmbed(guildId, item, freshBalance.cash);
          const detailComponents = createItemDetailComponents(item, freshBalance.cash);
          
          await i.update({ embeds: [detailEmbed], components: detailComponents });
        }
        // Handle back to shop
        else if (i.customId === 'shop_back') {
          selectedItemId = null;
          const freshBalance = getBalance(guildId, userId);
          const newEmbed = createShopEmbed(guildId, items, currentPage, freshBalance.cash, categoryFilter);
          const newComponents = createShopComponents(items, currentPage, guildId, userId);
          await i.update({ embeds: [newEmbed], components: newComponents });
        }
        // Handle buy confirmation - show quantity modal
        else if (i.customId === 'shop_buy') {
          if (!selectedItemId) {
            return i.reply({ content: '❌ No item selected!', ephemeral: true });
          }
          
          const item = getShopItem(guildId, selectedItemId);
          if (!item) {
            return i.reply({ content: '❌ Item no longer available!', ephemeral: true });
          }

          const modal = new ModalBuilder()
            .setCustomId(`shop_qty_modal_${selectedItemId}`)
            .setTitle(`Buy ${item.name}`);

          const qtyInput = new TextInputBuilder()
            .setCustomId('quantity')
            .setLabel(`How many? (${item.price.toLocaleString()} each)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1')
            .setValue('1')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(4);

          modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
          await i.showModal(modal);

          // Wait for modal submission
          try {
            const modalSubmit = await i.awaitModalSubmit({ time: 60000, filter: m => m.customId === `shop_qty_modal_${selectedItemId}` && m.user.id === userId });
            const qtyStr = modalSubmit.fields.getTextInputValue('quantity').trim();
            const quantity = parseInt(qtyStr);

            if (isNaN(quantity) || quantity < 1) {
              return modalSubmit.reply({ content: '❌ Please enter a valid number (1 or more).', ephemeral: true });
            }
            if (quantity > 99) {
              return modalSubmit.reply({ content: '❌ You can only buy up to 99 at a time.', ephemeral: true });
            }

            const freshItem = getShopItem(guildId, selectedItemId);
            if (!freshItem) {
              return modalSubmit.reply({ content: '❌ Item no longer available!', ephemeral: true });
            }

            const totalCost = freshItem.price * quantity;
            const currentBalance = getBalance(guildId, userId);

            if (currentBalance.cash < totalCost) {
              return modalSubmit.reply({ 
                content: `❌ You don't have enough cash! You need **${totalCost.toLocaleString()}** ${getCurrency(guildId)} (${quantity}x ${freshItem.price.toLocaleString()}) but only have **${currentBalance.cash.toLocaleString()}** ${getCurrency(guildId)}.`, 
                ephemeral: true 
              });
            }

            // Process purchase
            const paid = await removeMoney(guildId, userId, totalCost, `Shop purchase: ${freshItem.name} x${quantity}`);
            if (!paid) {
              return modalSubmit.reply({ content: '❌ Failed to process payment. Make sure you have enough cash!', ephemeral: true });
            }

            const addResult = addToInventory(guildId, userId, freshItem.id, quantity);
            if (!addResult.success) {
              await addMoney(guildId, userId, totalCost, `Shop refund: ${freshItem.name} x${quantity} (inventory error)`);
              return modalSubmit.reply({ content: `❌ ${addResult.error}`, ephemeral: true });
            }
            recordPurchase(guildId, userId, freshItem, quantity, totalCost);

            const isService = isServiceItem(freshItem.effect_type);
            const qtyText = quantity > 1 ? ` x${quantity}` : '';

            const successEmbed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle('✅ Purchase Successful!')
              .setDescription(`You bought **${freshItem.emoji} ${freshItem.name}${qtyText}** for **${totalCost.toLocaleString()}** ${getCurrency(guildId)}`)
              .addFields(
                { name: '💵 Previous Balance', value: `${currentBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
                { name: '💰 New Balance', value: `${(currentBalance.cash - totalCost).toLocaleString()} ${getCurrency(guildId)}`, inline: true }
              );

            if (quantity > 1) {
              successEmbed.addFields({ name: '🔢 Quantity', value: `${quantity} @ ${freshItem.price.toLocaleString()} each`, inline: true });
            }

            if (isService) {
              successEmbed.addFields({
                name: '🎫 Service Item',
                value: 'Use this item from `/inventory` to open a ticket and request your service!',
                inline: false
              });
              successEmbed.setFooter({ text: 'Use /inventory → Use Item to open a service ticket' });
            } else {
              successEmbed.setFooter({ text: 'Use /inventory to view and use your items!' });
            }

            const backRow = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId('shop_back')
                  .setLabel('Back to Shop')
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji('🛒')
              );

            await modalSubmit.update({ embeds: [successEmbed], components: [backRow] });
          } catch (err) {
            // Modal timed out or was dismissed - silently ignore
          }
        }
        // Handle dismiss
        else if (i.customId === 'shop_dismiss') {
          collector.stop('dismissed');
          try { await i.message.delete(); } catch (e) {}
          return;
        }
        // Handle category filter from menu
        else if (i.customId === 'shop_category') {
          const newCategory = i.values[0] === 'all' ? null : i.values[0];
          const newItems = getShopItems(guildId, newCategory, true);
          currentPage = 0;
          
          const freshBalance = getBalance(guildId, userId);
          const newEmbed = createShopEmbed(guildId, newItems, 0, freshBalance.cash, i.values[0]);
          const newComponents = createShopComponents(newItems, 0, guildId, userId);
          await i.update({ embeds: [newEmbed], components: newComponents });
        }
      } catch (error) {
        console.error('Shop interaction error:', error);
        try {
          await i.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true });
        } catch (e) {
          // Interaction may have already been handled
        }
      }
    });
    
    collector.on('end', async (collected, reason) => {
      if (reason === 'dismissed') return;
      try {
        const disabledEmbed = new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle('🛒 Shop Session Expired')
          .setDescription('Use `/shop` to open the shop again.');
        
        await response.edit({ embeds: [disabledEmbed], components: [] });
      } catch (e) {
        // Message may have been deleted
      }
    });
  }
};

function createShopEmbed(guildId, items, page, userCash, categoryFilter) {
  const startIndex = page * ITEMS_PER_PAGE;
  const pageItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  
  const categoryName = categoryFilter && categoryFilter !== 'all' 
    ? categoryFilter.charAt(0).toUpperCase() + categoryFilter.slice(1) 
    : 'All';
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🛒 Item Shop')
    .setDescription(`Browse items and make purchases!\n💰 Your Cash: **${userCash.toLocaleString()}** ${getCurrency(guildId)}\n\n**Category: ${categoryName}**`)
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${items.length} items available` });
  
  if (pageItems.length === 0) {
    embed.addFields({ name: 'No Items', value: 'No items available in this category.' });
  } else {
    for (const item of pageItems) {
      const affordable = userCash >= item.price ? '✅' : '❌';
      const durationText = item.duration_hours ? `⏱️ ${item.duration_hours}h` : '';
      
      embed.addFields({
        name: `${item.emoji} ${item.name} - ${item.price.toLocaleString()} ${getCurrency(guildId)} ${affordable}`,
        value: `${item.description || 'No description'}\n${durationText}`,
        inline: false
      });
    }
  }
  
  return embed;
}

function createShopComponents(items, page, guildId, userId) {
  const components = [];
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const pageItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  
  // Category select menu
  const categoryRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('shop_category')
        .setPlaceholder('📂 Filter by Category')
        .addOptions([
          { label: '📦 All Items', value: 'all' },
          { label: '🛡️ Protection', value: 'protection' },
          { label: '⚡ Boosts', value: 'boost' },
          { label: '🔧 Utility', value: 'utility' },
          { label: '🎁 Consumable', value: 'consumable' },
          { label: '✨ Special', value: 'special' }
        ])
    );
  components.push(categoryRow);
  
  // Item select menu (if there are items)
  if (pageItems.length > 0) {
    const itemOptions = pageItems.map(item => ({
      label: `${item.name} - ${item.price.toLocaleString()}`,
      value: item.id.toString(),
      description: item.description ? item.description.substring(0, 100) : 'No description',
      emoji: parseEmojiForSelect(item.emoji)
    }));
    
    const selectRow = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('shop_select')
          .setPlaceholder('🔍 Select an item to view details')
          .addOptions(itemOptions)
      );
    components.push(selectRow);
  }
  
  // Navigation buttons
  const navRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('shop_prev')
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('shop_next')
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('shop_dismiss')
        .setLabel('Dismiss')
        .setStyle(ButtonStyle.Danger)
    );
  components.push(navRow);
  
  return components;
}

function createItemDetailEmbed(guildId, item, userCash) {
  const affordable = userCash >= item.price;
  
  const embed = new EmbedBuilder()
    .setColor(affordable ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${item.emoji} ${item.name}`)
    .setDescription(item.description || 'No description available.')
    .addFields(
      { name: '💰 Price', value: `**${item.price.toLocaleString()}** ${getCurrency(guildId)}`, inline: true },
      { name: '📂 Category', value: item.category.charAt(0).toUpperCase() + item.category.slice(1), inline: true },
      { name: '💵 Your Cash', value: `**${userCash.toLocaleString()}** ${getCurrency(guildId)}`, inline: true }
    );
  
  if (item.effect_type) {
    const effectName = getEffectDisplayName(item.effect_type);
    const effectDesc = item.effect_value > 0 ? `+${item.effect_value}%` : 'Active';
    embed.addFields(
      { name: '✨ Effect', value: effectName, inline: true },
      { name: '📊 Value', value: effectDesc, inline: true },
      { name: '⏱️ Duration', value: `${item.duration_hours} hours`, inline: true }
    );
  }
  
  if (!affordable) {
    embed.addFields({
      name: '❌ Cannot Afford',
      value: `You need **${(item.price - userCash).toLocaleString()}** ${getCurrency(guildId)} more to buy this item.`
    });
  }
  
  return embed;
}

function createItemDetailComponents(item, userCash) {
  const affordable = userCash >= item.price;
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('shop_buy')
        .setLabel(`Buy for ${item.price.toLocaleString()}`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('🛒')
        .setDisabled(!affordable),
      new ButtonBuilder()
        .setCustomId('shop_back')
        .setLabel('Back to Shop')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  
  return [row];
}

function getEffectDisplayName(effectType) {
  const names = {
    'rob_protection': '🛡️ Rob Protection',
    'hack_protection': '🔥 Hack Protection',
    'rob_defense': '🛡️ Rob Defense',
    'hack_defense': '🔒 Hack Defense',
    'rob_success_boost': '🍀 Rob Success Boost',
    'hack_success_boost': '💻 Hack Success Boost',
    'work_boost': '💼 Work Earnings Boost',
    'crime_boost': '🔫 Crime Earnings Boost',
    'slut_boost': '💋 Slut Earnings Boost',
    'xp_boost': '📈 XP Boost',
    'rob_fine_reduction': '⚖️ Rob Fine Reduction',
    'hack_fine_reduction': '⚖️ Hack Fine Reduction',
    'crime_fine_reduction': '⚖️ Crime Fine Reduction',
    'lottery_boost': '🎰 Lottery Boost',
    'bank_interest_boost': '🏦 Bank Interest Boost',
    'cooldown_reduction': '⏰ Cooldown Reduction',
    'dungeon_key': '🗝️ Dungeon Key'
  };
  return names[effectType] || effectType;
}
