const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { 
  getUserInventory, 
  getActiveEffects, 
  useItem,
  formatDuration,
  getEffectTypeName,
  EFFECT_TYPES,
  isServiceItem,
  isCosmeticItem,
  getUserFulfillments,
  getShopItem,
  createFulfillmentRequest,
  removeFromInventory,
  getFulfillmentByTicket,
  getFulfillmentRequest,
  completeFulfillment,
  cancelFulfillment,
  getItemSettings
} = require('../items');
const { getAdminRole, isAdmin } = require('../admin');

const CURRENCY = '<:babybel:1418824333664452608>';
const ITEMS_PER_PAGE = 8;

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
    .setName('inventory')
    .setDescription('View your inventory and active effects')
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View your items or another player\'s items')
        .addUserOption(option =>
          option.setName('player')
            .setDescription('View another player\'s inventory (optional)')
            .setRequired(false)
        ))
    .addSubcommand(subcommand =>
      subcommand
        .setName('effects')
        .setDescription('View your active effects'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('use')
        .setDescription('Use an item from your inventory')
        .addStringOption(option =>
          option.setName('item')
            .setDescription('The name of the item to use')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    try {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const focusedValue = interaction.options.getFocused().toLowerCase();
      
      // Get user's inventory
      const inventory = getUserInventory(guildId, userId);
      
      // Filter by search term
      const filtered = inventory
        .filter(item => item.name.toLowerCase().includes(focusedValue))
        .slice(0, 25);
      
      await interaction.respond(
        filtered.map(item => ({
          name: `${item.emoji} ${item.name} (x${item.quantity})`,
          value: item.item_id.toString()
        }))
      );
    } catch (error) {
      // Ignore "Unknown interaction" errors - these happen when Discord times out the autocomplete
      if (error.code !== 10062) {
        console.error('Autocomplete error:', error);
      }
    }
  },

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'view') {
      const targetUser = interaction.options.getUser('player');
      const targetId = targetUser ? targetUser.id : userId;
      const targetName = targetUser ? targetUser.username : interaction.user.username;
      const isOwnInventory = targetId === userId;
      return handleViewInventory(interaction, guildId, targetId, targetName, isOwnInventory);
    } else if (subcommand === 'effects') {
      return handleViewEffects(interaction, guildId, userId);
    } else if (subcommand === 'use') {
      return handleUseItem(interaction, guildId, userId);
    }
  }
};

async function handleViewInventory(interaction, guildId, targetId, targetName, isOwnInventory) {
  const inventory = getUserInventory(guildId, targetId);
  
  if (inventory.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle(`🎒 ${targetName}'s Inventory`)
      .setDescription(isOwnInventory 
        ? "Your inventory is empty!\n\nUse `/shop` to browse and buy items."
        : `**${targetName}** doesn't have any items in their inventory.`)
      .setFooter({ text: isOwnInventory ? 'Tip: Buy items from the shop to gain powerful effects!' : `Viewing ${targetName}'s inventory` });
    
    return interaction.reply({ embeds: [emptyEmbed] });
  }
  
  // Create inventory embed
  const embed = createInventoryEmbed(inventory, 0, targetName);
  const components = createInventoryComponents(inventory, 0, isOwnInventory);
  
  const response = await interaction.reply({ 
    embeds: [embed], 
    components,
    fetchReply: true 
  });
  
  // Create collector for interactions
  const collector = response.createMessageComponentCollector({ 
    time: 180000 // 3 minutes
  });
  
  let currentPage = 0;
  const viewerId = interaction.user.id;
  
  collector.on('collect', async (i) => {
    // Only the person who ran the command can interact
    if (i.user.id !== viewerId) {
      return i.reply({ content: 'Use `/inventory view` to see your own inventory!', ephemeral: true });
    }
    
    try {
      if (i.customId === 'inv_prev') {
        currentPage = Math.max(0, currentPage - 1);
        const newEmbed = createInventoryEmbed(inventory, currentPage, targetName);
        const newComponents = createInventoryComponents(inventory, currentPage, isOwnInventory);
        await i.update({ embeds: [newEmbed], components: newComponents });
      }
      else if (i.customId === 'inv_next') {
        const maxPage = Math.ceil(inventory.length / ITEMS_PER_PAGE) - 1;
        currentPage = Math.min(maxPage, currentPage + 1);
        const newEmbed = createInventoryEmbed(inventory, currentPage, targetName);
        const newComponents = createInventoryComponents(inventory, currentPage, isOwnInventory);
        await i.update({ embeds: [newEmbed], components: newComponents });
      }
      else if (i.customId === 'inv_use_select') {
        // Only allow using items from own inventory
        if (!isOwnInventory) {
          return i.reply({ content: '❌ You can only use items from your own inventory!', ephemeral: true });
        }
        
        const itemId = parseInt(i.values[0]);
        
        // Find the item in inventory
        const item = inventory.find(inv => inv.item_id === itemId);
        if (!item) {
          return i.reply({ content: "❌ Item not found in your inventory!", ephemeral: true });
        }
        
        // Check if it's a service or cosmetic item
        const shopItem = getShopItem(guildId, itemId);
        if (shopItem && isServiceItem(shopItem.effect_type)) {
          // Create a ticket channel for the service item
          await i.deferReply({ ephemeral: true });
          
          try {
            const ticketResult = await createServiceTicket(i.guild, i.user, shopItem, guildId);
            
            if (ticketResult.success) {
              // Remove item from inventory since ticket is created
              removeFromInventory(guildId, targetId, itemId, 1);
              
              // Refresh inventory display
              const newInventory = getUserInventory(guildId, targetId);
              if (newInventory.length === 0) {
                const emptyEmbed = new EmbedBuilder()
                  .setColor(0x95a5a6)
                  .setTitle('🎒 Your Inventory')
                  .setDescription("Your inventory is now empty!\n\nUse `/shop` to browse and buy items.");
                await response.edit({ embeds: [emptyEmbed], components: [] });
              } else {
                currentPage = Math.min(currentPage, Math.ceil(newInventory.length / ITEMS_PER_PAGE) - 1);
                const newEmbed = createInventoryEmbed(newInventory, currentPage, targetName);
                const newComponents = createInventoryComponents(newInventory, currentPage, isOwnInventory);
                await response.edit({ embeds: [newEmbed], components: newComponents });
              }
              
              await i.editReply({ 
                content: `🎫 **Ticket Created!**\n\nYour service request for **${shopItem.emoji} ${shopItem.name}** has been opened!\n\n👉 Head to ${ticketResult.channel} to discuss with an admin.`
              });
            } else {
              await i.editReply({ content: `❌ ${ticketResult.error}` });
            }
          } catch (error) {
            console.error('Error creating service ticket:', error);
            await i.editReply({ content: '❌ Failed to create ticket. Please contact an admin.' });
          }
          return;
        }
        
        if (shopItem && shopItem.effect_type === 'cosmetic') {
          return i.reply({ 
            content: `🏆 **${item.emoji} ${item.name}** is a cosmetic item!\n\nCosmetic items are collectibles and don't have an activatable effect. They're displayed in your inventory as trophies!`, 
            ephemeral: true 
          });
        }
        
        // Handle free lottery ticket - show modal for number selection
        if (shopItem && shopItem.effect_type === 'lottery_free_ticket') {
          const modal = new ModalBuilder()
            .setCustomId(`lottery_ticket_modal_${itemId}`)
            .setTitle('🎟️ Pick Your Lottery Numbers');
          
          const num1Input = new TextInputBuilder()
            .setCustomId('lottery_num1')
            .setLabel('First Number (0-29)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter a number 0-29')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);
          
          const num2Input = new TextInputBuilder()
            .setCustomId('lottery_num2')
            .setLabel('Second Number (0-29)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter a number 0-29')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);
          
          const num3Input = new TextInputBuilder()
            .setCustomId('lottery_num3')
            .setLabel('Third Number (0-29)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter a number 0-29')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);
          
          const num4Input = new TextInputBuilder()
            .setCustomId('lottery_num4')
            .setLabel('Fourth Number (0-29)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter a number 0-29')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);
          
          modal.addComponents(
            new ActionRowBuilder().addComponents(num1Input),
            new ActionRowBuilder().addComponents(num2Input),
            new ActionRowBuilder().addComponents(num3Input),
            new ActionRowBuilder().addComponents(num4Input)
          );
          
          return i.showModal(modal);
        }
        
        // Use the item
        const result = useItem(guildId, targetId, itemId);
        
        if (!result.success) {
          return i.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }
        
        // Success - show result
        const successEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ Item Used!')
          .setDescription(`You used **${result.item.emoji} ${result.item.name}**!`)
          .addFields(
            { name: '✨ Effect', value: getEffectTypeName(result.effect.type), inline: true },
            { name: '📊 Value', value: `+${result.effect.value}%`, inline: true },
            { name: '⏱️ Duration', value: `${result.effect.durationHours} hours`, inline: true }
          )
          .setFooter({ text: 'Use /inventory effects to see all active effects' });
        
        await i.reply({ embeds: [successEmbed] });
        
        // Refresh inventory display
        const newInventory = getUserInventory(guildId, targetId);
        if (newInventory.length === 0) {
          const emptyEmbed = new EmbedBuilder()
            .setColor(0x95a5a6)
            .setTitle('🎒 Your Inventory')
            .setDescription("Your inventory is now empty!\n\nUse `/shop` to browse and buy items.");
          
          await response.edit({ embeds: [emptyEmbed], components: [] });
        } else {
          currentPage = Math.min(currentPage, Math.ceil(newInventory.length / ITEMS_PER_PAGE) - 1);
          const newEmbed = createInventoryEmbed(newInventory, currentPage, targetName);
          const newComponents = createInventoryComponents(newInventory, currentPage, isOwnInventory);
          await response.edit({ embeds: [newEmbed], components: newComponents });
        }
      }
      else if (i.customId === 'inv_view_effects') {
        // Show effects view - always shows viewer's effects
        const effects = getActiveEffects(guildId, viewerId);
        const effectsEmbed = createEffectsEmbed(effects, interaction.user.username);
        const backRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('inv_back')
              .setLabel('Back to Inventory')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('◀️')
          );
        
        await i.update({ embeds: [effectsEmbed], components: [backRow] });
      }
      else if (i.customId === 'inv_back') {
        // Back to inventory
        const refreshedInventory = getUserInventory(guildId, targetId);
        const newEmbed = createInventoryEmbed(refreshedInventory.length > 0 ? refreshedInventory : [], 0, targetName);
        const newComponents = refreshedInventory.length > 0 ? createInventoryComponents(refreshedInventory, 0, isOwnInventory) : [];
        await i.update({ embeds: [newEmbed], components: newComponents });
      }
    } catch (error) {
      console.error('Inventory interaction error:', error);
      try {
        await i.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true });
      } catch (e) {
        // Interaction may have already been handled
      }
    }
  });
  
  collector.on('end', async () => {
    try {
      await response.edit({ components: [] });
    } catch (e) {
      // Message may have been deleted
    }
  });
}

async function handleViewEffects(interaction, guildId, userId) {
  const effects = getActiveEffects(guildId, userId);
  const embed = createEffectsEmbed(effects, interaction.user.username);
  
  return interaction.reply({ embeds: [embed] });
}

async function handleUseItem(interaction, guildId, userId) {
  const itemIdStr = interaction.options.getString('item');
  const itemId = parseInt(itemIdStr);
  
  if (isNaN(itemId)) {
    return interaction.reply({ 
      content: '❌ Invalid item! Use the autocomplete suggestions.', 
      ephemeral: true 
    });
  }
  
  // Check if user has the item first
  const inventory = getUserInventory(guildId, userId);
  const inventoryItem = inventory.find(item => item.item_id === itemId);
  
  if (!inventoryItem) {
    return interaction.reply({ 
      content: '❌ You don\'t have this item in your inventory!', 
      ephemeral: true 
    });
  }
  
  // Get the shop item details for special handling
  const shopItem = getShopItem(guildId, itemId);
  
  // Handle service items - create ticket
  if (shopItem && isServiceItem(shopItem.effect_type)) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const ticketResult = await createServiceTicket(interaction.guild, interaction.user, shopItem, guildId);
      
      if (ticketResult.success) {
        removeFromInventory(guildId, userId, itemId, 1);
        return interaction.editReply({ 
          content: `🎫 **Ticket Created!**\n\nYour service request for **${shopItem.emoji} ${shopItem.name}** has been opened!\n\n👉 Head to ${ticketResult.channel} to discuss with an admin.`
        });
      } else {
        return interaction.editReply({ content: `❌ ${ticketResult.error}` });
      }
    } catch (error) {
      console.error('Error creating service ticket:', error);
      return interaction.editReply({ content: '❌ Failed to create ticket. Please contact an admin.' });
    }
  }
  
  // Handle cosmetic items - can't be "used"
  if (shopItem && shopItem.effect_type === 'cosmetic') {
    return interaction.reply({ 
      content: `🏆 **${shopItem.emoji} ${shopItem.name}** is a cosmetic item!\n\nCosmetic items are collectibles and don't have an activatable effect. They're displayed in your inventory as trophies!`, 
      ephemeral: true 
    });
  }
  
  // Handle free lottery ticket - show modal for number selection
  if (shopItem && shopItem.effect_type === 'lottery_free_ticket') {
    const modal = new ModalBuilder()
      .setCustomId(`lottery_ticket_modal_${itemId}`)
      .setTitle('🎟️ Pick Your Lottery Numbers');
    
    const num1Input = new TextInputBuilder()
      .setCustomId('lottery_num1')
      .setLabel('First Number (0-29)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter a number 0-29')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);
    
    const num2Input = new TextInputBuilder()
      .setCustomId('lottery_num2')
      .setLabel('Second Number (0-29)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter a number 0-29')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);
    
    const num3Input = new TextInputBuilder()
      .setCustomId('lottery_num3')
      .setLabel('Third Number (0-29)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter a number 0-29')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);
    
    const num4Input = new TextInputBuilder()
      .setCustomId('lottery_num4')
      .setLabel('Fourth Number (0-29)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter a number 0-29')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(num1Input),
      new ActionRowBuilder().addComponents(num2Input),
      new ActionRowBuilder().addComponents(num3Input),
      new ActionRowBuilder().addComponents(num4Input)
    );
    
    return interaction.showModal(modal);
  }
  
  // Use the item (regular effect items)
  const result = useItem(guildId, userId, itemId);
  
  if (!result.success) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }
  
  // Success
  const successEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Item Used!')
    .setDescription(`You used **${result.item.emoji} ${result.item.name}**!`)
    .addFields(
      { name: '✨ Effect', value: getEffectTypeName(result.effect.type), inline: true },
      { name: '📊 Value', value: `+${result.effect.value}%`, inline: true },
      { name: '⏱️ Duration', value: `${result.effect.durationHours} hours`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'Use /inventory effects to see all active effects' });
  
  return interaction.reply({ embeds: [successEmbed] });
}

function createInventoryEmbed(inventory, page, username) {
  const totalPages = Math.max(1, Math.ceil(inventory.length / ITEMS_PER_PAGE));
  const startIndex = page * ITEMS_PER_PAGE;
  const pageItems = inventory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🎒 ${username}'s Inventory`)
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${inventory.length} items total` });
  
  if (inventory.length === 0) {
    embed.setDescription("Your inventory is empty!\n\nUse `/shop` to browse and buy items.");
    return embed;
  }
  
  let description = '';
  for (const item of pageItems) {
    const effectText = item.effect_type 
      ? `\n   ↳ ${getEffectTypeName(item.effect_type)} (+${item.effect_value}%) for ${item.duration_hours}h`
      : '';
    
    description += `${item.emoji} **${item.name}** x${item.quantity}${effectText}\n`;
  }
  
  embed.setDescription(description);
  
  return embed;
}

function createInventoryComponents(inventory, page, isOwnInventory = true) {
  const components = [];
  const totalPages = Math.ceil(inventory.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const pageItems = inventory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  
  // Use item select menu - only show for own inventory
  if (isOwnInventory && pageItems.length > 0) {
    const useableItems = pageItems.filter(item => item.effect_type);
    
    if (useableItems.length > 0) {
      const selectRow = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('inv_use_select')
            .setPlaceholder('🔮 Select an item to use')
            .addOptions(
              useableItems.map(item => ({
                label: `Use ${item.name}`,
                value: item.item_id.toString(),
                description: `${item.effect_type} for ${item.duration_hours}h`,
                emoji: parseEmojiForSelect(item.emoji)
              }))
            )
        );
      components.push(selectRow);
    }
  }
  
  // Navigation and effects buttons
  const navRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('inv_prev')
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('inv_view_effects')
        .setLabel('View Active Effects')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✨'),
      new ButtonBuilder()
        .setCustomId('inv_next')
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
  components.push(navRow);
  
  return components;
}

function createEffectsEmbed(effects, username) {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`✨ ${username}'s Active Effects`)
    .setTimestamp();
  
  if (effects.length === 0) {
    embed.setDescription("You have no active effects!\n\nUse items from your inventory to gain effects.");
    return embed;
  }
  
  let description = '';
  const now = Date.now();
  
  for (const effect of effects) {
    const remaining = effect.expires_at - now;
    const timeLeft = formatDuration(remaining);
    const effectName = getEffectTypeName(effect.effect_type);
    
    description += `**${effectName}**\n`;
    description += `   ↳ Value: +${effect.effect_value}%\n`;
    description += `   ↳ From: ${effect.source_item_name}\n`;
    description += `   ↳ Time Left: ⏱️ ${timeLeft}\n\n`;
  }
  
  embed.setDescription(description);
  embed.setFooter({ text: `${effects.length} active effect${effects.length !== 1 ? 's' : ''}` });
  
  return embed;
}

// Create a ticket channel for service item fulfillment
async function createServiceTicket(guild, user, item, guildId) {
  try {
    // Get admin role for the guild
    const adminRoleId = getAdminRole(guildId);
    
    if (!adminRoleId) {
      return { success: false, error: 'No admin role configured. Please ask an admin to set up the admin role first.' };
    }
    
    const adminRole = guild.roles.cache.get(adminRoleId);
    if (!adminRole) {
      return { success: false, error: 'Admin role not found. Please contact server staff.' };
    }
    
    // Get item settings for ticket category
    const itemSettings = getItemSettings(guildId);
    
    // Create ticket channel name
    const ticketName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString().slice(-4)}`;
    
    // Build permission overwrites - only include roles the bot can manage
    const permissionOverwrites = [
      {
        id: guild.id, // @everyone
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: user.id, // The user who created the ticket
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: guild.client.user.id, // Bot
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages]
      }
    ];
    
    // Only add admin role permissions if bot's role is higher than admin role
    const botMember = guild.members.cache.get(guild.client.user.id);
    if (botMember && botMember.roles.highest.position > adminRole.position) {
      permissionOverwrites.push({
        id: adminRoleId, // Admin role
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
      });
    }
    
    // Build channel creation options
    const channelOptions = {
      name: ticketName,
      type: ChannelType.GuildText,
      permissionOverwrites,
      reason: `Service ticket for ${user.tag} - ${item.name}`
    };
    
    // Add category if configured and bot has permission
    if (itemSettings.ticketCategoryId) {
      const category = guild.channels.cache.get(itemSettings.ticketCategoryId);
      if (category && category.type === ChannelType.GuildCategory) {
        // Check if bot can manage channels in this category
        const botPermsInCategory = category.permissionsFor(guild.client.user);
        if (botPermsInCategory && botPermsInCategory.has(PermissionFlagsBits.ManageChannels)) {
          channelOptions.parent = itemSettings.ticketCategoryId;
        }
      }
    }
    
    // Create the channel
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create(channelOptions);
    } catch (createError) {
      // If category creation fails, try without category
      if (channelOptions.parent) {
        console.log('Failed to create ticket in category, trying without category:', createError.message);
        delete channelOptions.parent;
        ticketChannel = await guild.channels.create(channelOptions);
      } else {
        throw createError;
      }
    }
    
    // Create the fulfillment request with ticket channel ID
    const requestId = createFulfillmentRequest(guildId, user.id, item.id, item.name, item.effect_type, null, ticketChannel.id);
    
    // Send the initial ticket message
    const ticketEmbed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🎫 Service Request: ${item.emoji} ${item.name}`)
      .setDescription(`${user} has requested a service item fulfillment.`)
      .addFields(
        { name: '👤 Requested By', value: `${user}`, inline: true },
        { name: '📦 Item', value: `${item.emoji} ${item.name}`, inline: true },
        { name: '🎯 Service Type', value: getServiceTypeName(item.effect_type), inline: true },
        { name: '📋 Item Description', value: item.description || 'No description provided', inline: false }
      )
      .setFooter({ text: `Ticket #${requestId} • Request ID: ${requestId}` })
      .setTimestamp();
    
    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_complete_${requestId}`)
          .setLabel('✅ Complete & Close')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`ticket_close_${requestId}`)
          .setLabel('❌ Close Ticket')
          .setStyle(ButtonStyle.Danger)
      );
    
    await ticketChannel.send({ 
      content: `${user} | <@&${adminRoleId}>`,
      embeds: [ticketEmbed], 
      components: [actionRow] 
    });
    
    // Send instructions
    await ticketChannel.send({
      content: `**Welcome to your service ticket!**\n\n` +
        `📝 Please describe what you'd like for your **${item.name}**.\n` +
        `👤 An admin with the <@&${adminRoleId}> role will assist you shortly.\n\n` +
        `*Once the service is complete, an admin will close this ticket.*`
    });
    
    // Log ticket creation
    await logTicketAction(guild, guildId, 'created', {
      ticketId: requestId,
      user,
      item,
      channel: ticketChannel
    });
    
    return { success: true, channel: ticketChannel, requestId };
    
  } catch (error) {
    console.error('Error creating service ticket:', error);
    return { success: false, error: 'Failed to create ticket channel. Bot may lack permissions.' };
  }
}

// Get friendly name for service type
function getServiceTypeName(effectType) {
  const names = {
    'service_custom_emoji': '🎨 Custom Emoji',
    'service_nickname': '📝 Nickname Change',
    'service_custom_role': '🏷️ Custom Role',
    'service_custom_color': '🌈 Custom Role Color',
    'service_other': '✨ Special Service'
  };
  return names[effectType] || effectType || 'Service';
}

// Handle ticket button interactions (complete/close)
async function handleTicketButton(interaction) {
  const customId = interaction.customId;
  const guildId = interaction.guildId;
  
  // Check if user is admin
  if (!isAdmin(guildId, interaction.user.id, interaction.member)) {
    return interaction.reply({ content: '❌ Only admins can manage tickets.', ephemeral: true });
  }
  
  // Parse button ID: ticket_complete_123 or ticket_close_123
  const parts = customId.split('_');
  const action = parts[1]; // 'complete' or 'close'
  const requestId = parseInt(parts[2]);
  
  const request = getFulfillmentRequest(requestId);
  if (!request) {
    return interaction.reply({ content: '❌ Request not found.', ephemeral: true });
  }
  
  if (request.status !== 'pending') {
    return interaction.reply({ content: '❌ This request has already been processed.', ephemeral: true });
  }
  
  await interaction.deferReply();
  
  if (action === 'complete') {
    // Mark as completed
    completeFulfillment(requestId, interaction.user.id, 'Completed via ticket');
    
    // Send completion message
    const completeEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Service Completed!')
      .setDescription(`This service request has been fulfilled by ${interaction.user}.`)
      .addFields(
        { name: '📦 Item', value: request.item_name, inline: true },
        { name: '👤 Customer', value: `<@${request.user_id}>`, inline: true },
        { name: '🎯 Completed By', value: `${interaction.user}`, inline: true }
      )
      .setFooter({ text: 'This channel will be deleted in 10 seconds...' })
      .setTimestamp();
    
    await interaction.editReply({ embeds: [completeEmbed], components: [] });
    
    // Log ticket completion
    await logTicketAction(interaction.guild, guildId, 'completed', {
      ticketId: requestId,
      userId: request.user_id,
      itemName: request.item_name,
      completedBy: interaction.user,
      channel: interaction.channel
    });
    
    // Delete the channel after delay
    setTimeout(async () => {
      try {
        await interaction.channel.delete('Service ticket completed');
      } catch (e) {
        console.error('Failed to delete ticket channel:', e);
      }
    }, 10000);
    
  } else if (action === 'close') {
    // Just close without completing (cancelled)
    cancelFulfillment(requestId, interaction.user.id, 'Closed via ticket');
    
    const closeEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ Ticket Closed')
      .setDescription(`This ticket has been closed by ${interaction.user}.`)
      .addFields(
        { name: '📦 Item', value: request.item_name, inline: true },
        { name: '👤 Customer', value: `<@${request.user_id}>`, inline: true }
      )
      .setFooter({ text: 'This channel will be deleted in 10 seconds...' })
      .setTimestamp();
    
    await interaction.editReply({ embeds: [closeEmbed], components: [] });
    
    // Log ticket closure
    await logTicketAction(interaction.guild, guildId, 'closed', {
      ticketId: requestId,
      userId: request.user_id,
      itemName: request.item_name,
      closedBy: interaction.user,
      channel: interaction.channel
    });
    
    // Delete the channel after delay
    setTimeout(async () => {
      try {
        await interaction.channel.delete('Service ticket closed');
      } catch (e) {
        console.error('Failed to delete ticket channel:', e);
      }
    }, 10000);
  }
}

// Log ticket actions to the configured log channel
async function logTicketAction(guild, guildId, action, data) {
  try {
    const itemSettings = getItemSettings(guildId);
    
    if (!itemSettings.ticketLogChannelId) return;
    
    const logChannel = guild.channels.cache.get(itemSettings.ticketLogChannelId);
    if (!logChannel) return;
    
    // Check if bot can send messages to this channel
    const botPerms = logChannel.permissionsFor(guild.client.user);
    if (!botPerms || !botPerms.has(PermissionFlagsBits.SendMessages) || !botPerms.has(PermissionFlagsBits.ViewChannel)) {
      console.log(`Bot lacks permission to log to ticket log channel ${logChannel.name}`);
      return;
    }
    
    let embed;
    
    if (action === 'created') {
      embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🎫 Ticket Created')
        .addFields(
          { name: 'Ticket ID', value: `#${data.ticketId}`, inline: true },
          { name: 'User', value: `${data.user}`, inline: true },
          { name: 'Item', value: `${data.item.emoji} ${data.item.name}`, inline: true },
          { name: 'Channel', value: `${data.channel}`, inline: true }
        )
        .setTimestamp();
    } else if (action === 'completed') {
      embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Ticket Completed')
        .addFields(
          { name: 'Ticket ID', value: `#${data.ticketId}`, inline: true },
          { name: 'Customer', value: `<@${data.userId}>`, inline: true },
          { name: 'Item', value: data.itemName, inline: true },
          { name: 'Completed By', value: `${data.completedBy}`, inline: true }
        )
        .setTimestamp();
    } else if (action === 'closed') {
      embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Ticket Closed')
        .addFields(
          { name: 'Ticket ID', value: `#${data.ticketId}`, inline: true },
          { name: 'Customer', value: `<@${data.userId}>`, inline: true },
          { name: 'Item', value: data.itemName, inline: true },
          { name: 'Closed By', value: `${data.closedBy}`, inline: true }
        )
        .setTimestamp();
    }
    
    if (embed) {
      await logChannel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Error logging ticket action:', error);
  }
}

// Handle lottery ticket modal submission
async function handleLotteryTicketModal(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  
  // Extract item ID from modal custom ID
  const itemId = parseInt(interaction.customId.replace('lottery_ticket_modal_', ''));
  
  // Get the numbers from the modal
  const num1 = parseInt(interaction.fields.getTextInputValue('lottery_num1'));
  const num2 = parseInt(interaction.fields.getTextInputValue('lottery_num2'));
  const num3 = parseInt(interaction.fields.getTextInputValue('lottery_num3'));
  const num4 = parseInt(interaction.fields.getTextInputValue('lottery_num4'));
  
  // Validate all are numbers
  if ([num1, num2, num3, num4].some(n => isNaN(n))) {
    return interaction.reply({ 
      content: '❌ All values must be valid numbers!', 
      ephemeral: true 
    });
  }
  
  // Validate range (0-29)
  if ([num1, num2, num3, num4].some(n => n < 0 || n > 29)) {
    return interaction.reply({ 
      content: '❌ All numbers must be between 0 and 29!', 
      ephemeral: true 
    });
  }
  
  // Validate uniqueness
  const numbers = [num1, num2, num3, num4];
  const uniqueNumbers = [...new Set(numbers)];
  if (uniqueNumbers.length !== 4) {
    return interaction.reply({ 
      content: '❌ All 4 numbers must be unique!', 
      ephemeral: true 
    });
  }
  
  // Verify user still has the item
  const inventory = getUserInventory(guildId, userId);
  const inventoryItem = inventory.find(item => item.item_id === itemId);
  
  if (!inventoryItem) {
    return interaction.reply({ 
      content: '❌ You no longer have this item in your inventory!', 
      ephemeral: true 
    });
  }
  
  // Get the shop item details
  const shopItem = getShopItem(guildId, itemId);
  if (!shopItem || shopItem.effect_type !== 'lottery_free_ticket') {
    return interaction.reply({ 
      content: '❌ This item is no longer valid!', 
      ephemeral: true 
    });
  }
  
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const { buyLotteryTicket, getLotteryInfo } = require('../gambling');
    
    // Buy the ticket with user's numbers
    const ticketResult = buyLotteryTicket(guildId, userId, numbers);
    
    if (!ticketResult.success) {
      return interaction.editReply({ content: `❌ Failed to redeem lottery ticket: ${ticketResult.error}` });
    }
    
    // Remove item from inventory
    removeFromInventory(guildId, userId, itemId, 1);
    
    // Get lottery info for display
    const lotteryInfo = getLotteryInfo(guildId);
    
    const ticketEmbed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🎟️ Free Lottery Ticket Redeemed!')
      .setDescription(`You redeemed your **${shopItem.emoji} ${shopItem.name}**!`)
      .addFields(
        { name: '🔢 Your Numbers', value: `**${ticketResult.numbers.join(' - ')}**`, inline: false },
        { name: '🏆 Current Jackpot', value: `**${lotteryInfo.jackpot.toLocaleString()}** ${CURRENCY}`, inline: true }
      )
      .setFooter({ text: 'Use /lottery tickets to see all your tickets • Good luck!' })
      .setTimestamp();
    
    return interaction.editReply({ embeds: [ticketEmbed] });
  } catch (error) {
    console.error('Error redeeming lottery ticket:', error);
    return interaction.editReply({ content: '❌ Failed to redeem lottery ticket. Please try again.' });
  }
}

// Export the ticket handler for use in bot.js
module.exports.handleTicketButton = handleTicketButton;
module.exports.handleLotteryTicketModal = handleLotteryTicketModal;
