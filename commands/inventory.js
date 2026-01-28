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
  isRoleGrantItem,
  recordRoleGrant,
  hasRoleGrant,
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
    .setDescription('View your inventory, use items, and check active effects')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('View another player\'s inventory (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const targetUser = interaction.options.getUser('player');
    const targetId = targetUser ? targetUser.id : userId;
    const targetName = targetUser ? targetUser.username : interaction.user.username;
    const isOwnInventory = targetId === userId;
    
    return showInventoryPanel(interaction, guildId, targetId, targetName, isOwnInventory);
  }
};

// State tracking for inventory panels
const inventoryState = new Map();

async function showInventoryPanel(interaction, guildId, targetId, targetName, isOwnInventory, page = 0, tab = 'items') {
  const inventory = getUserInventory(guildId, targetId);
  const effects = isOwnInventory ? getActiveEffects(guildId, targetId) : [];
  
  // Build embed based on current tab
  let embed;
  if (tab === 'items') {
    embed = createInventoryEmbed(inventory, page, targetName, isOwnInventory);
  } else if (tab === 'effects') {
    embed = createEffectsEmbed(effects, targetName);
  }
  
  // Build components
  const components = createInventoryPanelComponents(inventory, effects, page, tab, isOwnInventory);
  
  // Store state for this interaction
  const stateKey = `${interaction.user.id}-${interaction.channelId}`;
  inventoryState.set(stateKey, {
    guildId,
    targetId,
    targetName,
    isOwnInventory,
    page,
    tab,
    inventory,
    effects
  });
  
  // Clean up old states after 5 minutes
  setTimeout(() => inventoryState.delete(stateKey), 300000);
  
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply({ embeds: [embed], components });
  }
  
  const response = await interaction.reply({ 
    embeds: [embed], 
    components,
    fetchReply: true 
  });
  
  // Create collector for button/select interactions
  const collector = response.createMessageComponentCollector({ 
    time: 300000 // 5 minutes
  });
  
  collector.on('collect', async (i) => {
    // Only the person who ran the command can interact
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'Use `/inventory` to open your own inventory panel!', ephemeral: true });
    }
    
    const state = inventoryState.get(stateKey);
    if (!state) {
      return i.reply({ content: '❌ Session expired. Please use `/inventory` again.', ephemeral: true });
    }
    
    try {
      await handleInventoryInteraction(i, state, stateKey, response);
    } catch (error) {
      console.error('Inventory interaction error:', error);
      if (!i.replied && !i.deferred) {
        await i.reply({ content: '❌ An error occurred.', ephemeral: true }).catch(() => {});
      }
    }
  });
  
  collector.on('end', () => {
    inventoryState.delete(stateKey);
    // Disable buttons on timeout
    response.edit({ components: [] }).catch(() => {});
  });
}

async function handleInventoryInteraction(i, state, stateKey, response) {
  const { guildId, targetId, targetName, isOwnInventory } = state;
  
  // Tab switching
  if (i.customId === 'inv_tab_items') {
    state.tab = 'items';
    state.page = 0;
    state.inventory = getUserInventory(guildId, targetId);
    inventoryState.set(stateKey, state);
    
    const embed = createInventoryEmbed(state.inventory, 0, targetName, isOwnInventory);
    const components = createInventoryPanelComponents(state.inventory, state.effects, 0, 'items', isOwnInventory);
    return i.update({ embeds: [embed], components });
  }
  
  if (i.customId === 'inv_tab_effects') {
    if (!isOwnInventory) {
      return i.reply({ content: '❌ You can only view your own effects!', ephemeral: true });
    }
    state.tab = 'effects';
    state.effects = getActiveEffects(guildId, targetId);
    inventoryState.set(stateKey, state);
    
    const embed = createEffectsEmbed(state.effects, targetName);
    const components = createInventoryPanelComponents(state.inventory, state.effects, state.page, 'effects', isOwnInventory);
    return i.update({ embeds: [embed], components });
  }
  
  // Pagination
  if (i.customId === 'inv_prev') {
    state.page = Math.max(0, state.page - 1);
    inventoryState.set(stateKey, state);
    
    const embed = createInventoryEmbed(state.inventory, state.page, targetName, isOwnInventory);
    const components = createInventoryPanelComponents(state.inventory, state.effects, state.page, state.tab, isOwnInventory);
    return i.update({ embeds: [embed], components });
  }
  
  if (i.customId === 'inv_next') {
    const maxPage = Math.ceil(state.inventory.length / ITEMS_PER_PAGE) - 1;
    state.page = Math.min(maxPage, state.page + 1);
    inventoryState.set(stateKey, state);
    
    const embed = createInventoryEmbed(state.inventory, state.page, targetName, isOwnInventory);
    const components = createInventoryPanelComponents(state.inventory, state.effects, state.page, state.tab, isOwnInventory);
    return i.update({ embeds: [embed], components });
  }
  
  // Use item from select menu
  if (i.customId === 'inv_use_select') {
    if (!isOwnInventory) {
      return i.reply({ content: '❌ You can only use items from your own inventory!', ephemeral: true });
    }
    
    const itemId = parseInt(i.values[0]);
    await handleUseItemFromPanel(i, guildId, targetId, itemId, state, stateKey, response, targetName);
  }
}

async function handleUseItemFromPanel(i, guildId, userId, itemId, state, stateKey, response, targetName) {
  // Find the item in inventory
  const item = state.inventory.find(inv => inv.item_id === itemId);
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
        removeFromInventory(guildId, userId, itemId, 1);
        
        // Refresh inventory display
        state.inventory = getUserInventory(guildId, userId);
        state.page = Math.min(state.page, Math.max(0, Math.ceil(state.inventory.length / ITEMS_PER_PAGE) - 1));
        inventoryState.set(stateKey, state);
        
        const embed = createInventoryEmbed(state.inventory, state.page, targetName, true);
        const components = createInventoryPanelComponents(state.inventory, state.effects, state.page, state.tab, true);
        await response.edit({ embeds: [embed], components });
        
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
  
  // Handle role grant items
  if (shopItem && isRoleGrantItem(shopItem.effect_type)) {
    await i.deferReply({ ephemeral: true });
    
    try {
      const roleId = shopItem.effect_value_text || String(shopItem.effect_value);
      console.log('[Role Grant Debug] effect_value_text:', shopItem.effect_value_text, 'effect_value:', shopItem.effect_value, 'roleId:', roleId);
      const role = i.guild.roles.cache.get(roleId);
      
      if (!role) {
        return i.editReply({ 
          content: `❌ The role for this item no longer exists! Please contact an admin.`
        });
      }
      
      if (hasRoleGrant(guildId, userId, roleId)) {
        return i.editReply({ 
          content: `❌ You already have the **${role.name}** role from a previous purchase!`
        });
      }
      
      const member = await i.guild.members.fetch(userId);
      if (member.roles.cache.has(roleId)) {
        return i.editReply({ 
          content: `❌ You already have the **${role.name}** role!`
        });
      }
      
      try {
        await member.roles.add(role, `Shop item: ${shopItem.name}`);
      } catch (roleError) {
        console.error('Error adding role:', roleError);
        return i.editReply({ 
          content: `❌ Failed to add role. The bot may not have permission to assign this role.`
        });
      }
      
      removeFromInventory(guildId, userId, itemId, 1);
      recordRoleGrant(guildId, userId, roleId, shopItem.id, shopItem.name, shopItem.duration_hours);
      
      // Refresh inventory
      state.inventory = getUserInventory(guildId, userId);
      state.page = Math.min(state.page, Math.max(0, Math.ceil(state.inventory.length / ITEMS_PER_PAGE) - 1));
      inventoryState.set(stateKey, state);
      
      const embed = createInventoryEmbed(state.inventory, state.page, targetName, true);
      const components = createInventoryPanelComponents(state.inventory, state.effects, state.page, state.tab, true);
      await response.edit({ embeds: [embed], components });
      
      const durationText = shopItem.duration_hours === 0 ? 'permanently' : `for ${shopItem.duration_hours} hours`;
      return i.editReply({ 
        content: `✅ **Role Granted!**\n\nYou now have the **${role.name}** role ${durationText}!`
      });
      
    } catch (error) {
      console.error('Error granting role:', error);
      return i.editReply({ content: '❌ Failed to grant role. Please contact an admin.' });
    }
  }
  
  // Use regular effect item
  await i.deferReply({ ephemeral: true });
  
  const result = useItem(guildId, userId, itemId);
  
  if (!result.success) {
    return i.editReply({ content: `❌ ${result.error}` });
  }
  
  // Refresh inventory and effects
  state.inventory = getUserInventory(guildId, userId);
  state.effects = getActiveEffects(guildId, userId);
  state.page = Math.min(state.page, Math.max(0, Math.ceil(state.inventory.length / ITEMS_PER_PAGE) - 1));
  inventoryState.set(stateKey, state);
  
  const embed = createInventoryEmbed(state.inventory, state.page, targetName, true);
  const components = createInventoryPanelComponents(state.inventory, state.effects, state.page, state.tab, true);
  await response.edit({ embeds: [embed], components });
  
  const effectName = getEffectTypeName(result.effect.type);
  const durationStr = formatDuration(result.effect.durationHours * 60 * 60 * 1000);
  
  return i.editReply({ 
    content: `✅ **Used ${item.emoji} ${item.name}!**\n\n` +
      `Effect: **${effectName}** (+${result.effect.value}%)\n` +
      `Duration: ⏱️ ${durationStr}\n\n` +
      `View your active effects in the **Effects** tab!`
  });
}

function createInventoryEmbed(inventory, page, username, isOwnInventory = true) {
  const totalPages = Math.max(1, Math.ceil(inventory.length / ITEMS_PER_PAGE));
  const startIndex = page * ITEMS_PER_PAGE;
  const pageItems = inventory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🎒 ${username}'s Inventory`)
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${inventory.length} item${inventory.length !== 1 ? 's' : ''} total` });
  
  if (inventory.length === 0) {
    embed.setDescription(isOwnInventory 
      ? "Your inventory is empty!\n\nUse `/shop` to browse and buy items."
      : `**${username}** doesn't have any items.`);
    return embed;
  }
  
  let description = '';
  for (const item of pageItems) {
    const effectText = item.effect_type && item.effect_type !== 'cosmetic'
      ? `\n   ↳ ${getEffectTypeName(item.effect_type)} (+${item.effect_value}%) for ${item.duration_hours}h`
      : item.effect_type === 'cosmetic' ? '\n   ↳ 🏆 Cosmetic' : '';
    
    description += `${item.emoji} **${item.name}** x${item.quantity}${effectText}\n`;
  }
  
  embed.setDescription(description);
  
  return embed;
}

function createInventoryPanelComponents(inventory, effects, page, tab, isOwnInventory) {
  const components = [];
  const totalPages = Math.max(1, Math.ceil(inventory.length / ITEMS_PER_PAGE));
  
  // Tab buttons row
  const tabRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('inv_tab_items')
      .setLabel(`📦 Items (${inventory.length})`)
      .setStyle(tab === 'items' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('inv_tab_effects')
      .setLabel(`✨ Effects (${effects.length})`)
      .setStyle(tab === 'effects' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!isOwnInventory)
  );
  components.push(tabRow);
  
  // Items tab components
  if (tab === 'items') {
    const startIndex = page * ITEMS_PER_PAGE;
    const pageItems = inventory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    
    // Use item select menu - only show for own inventory with usable items
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
                  description: item.effect_type === 'cosmetic' 
                    ? 'Cosmetic - Display only' 
                    : `${getEffectTypeName(item.effect_type)} for ${item.duration_hours}h`,
                  emoji: parseEmojiForSelect(item.emoji)
                }))
              )
          );
        components.push(selectRow);
      }
    }
    
    // Navigation row
    if (totalPages > 1) {
      const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('inv_prev')
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('inv_next')
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      );
      components.push(navRow);
    }
  }
  
  return components;
}

function createEffectsEmbed(effects, username) {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`✨ ${username}'s Active Effects`)
    .setTimestamp();
  
  if (effects.length === 0) {
    embed.setDescription("No active effects!\n\nUse items from your inventory to gain effects.");
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
      reason: `Service ticket for ${user.username} - ${item.name}`
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
