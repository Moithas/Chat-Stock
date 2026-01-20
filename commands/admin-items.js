// Admin Items Panel - Item Shop management
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const { logAdminAction } = require('../admin');
const { 
  getItemSettings, 
  updateItemSettings, 
  getShopItems, 
  getShopItem,
  addShopItem, 
  updateShopItem, 
  deleteShopItem,
  getShopStats,
  initializeDefaultItems,
  addToInventory,
  EFFECT_TYPES,
  ITEM_CATEGORIES,
  getPendingFulfillments,
  getPendingFulfillmentCount,
  getFulfillmentRequest,
  completeFulfillment,
  cancelFulfillment
} = require('../items');
const { addMoney } = require('../economy');
const { ChannelType } = require('discord.js');

const CURRENCY = '<:babybel:1418824333664452608>';
const ITEMS_PER_PAGE = 5;

// Helper function to safely parse emoji for select menu options
// Custom emojis like <:name:id> need to be converted to { id, name } format
// Unicode emojis can be used as-is
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
  // Validate it's actually a valid unicode emoji (basic check)
  if (emojiStr.length <= 8 && !emojiStr.includes(':')) {
    return emojiStr;
  }
  
  // Invalid format, return default
  return '📦';
}

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_items', 'items_toggle', 'items_add', 'items_manage', 'items_stats',
  'items_init_defaults', 'items_prev', 'items_next', 'back_items',
  'items_fulfillments', 'items_fulfill_prev', 'items_fulfill_next',
  'items_ticket_settings', 'items_create_continue', 'items_create_cancel',
  'items_give', 'items_give_confirm', 'items_give_cancel',
  'items_take', 'items_take_confirm', 'items_take_cancel'
];

const MODAL_IDS = [
  'modal_items_add', 'modal_items_edit', 'modal_items_create', 'modal_items_give_qty', 'modal_items_take_qty'
];

const SELECT_IDS = [
  'items_select', 'items_category_filter', 'items_effect_select',
  'items_ticket_category', 'items_ticket_log',
  'items_create_category', 'items_create_effect',
  'items_give_user', 'items_give_item',
  'items_take_user', 'items_take_item'
];

// Track pagination state per guild/user
const paginationState = new Map();

// Track item creation state per user (for multi-step creation)
const itemCreationState = new Map();

// Track admin give item state per user
const giveItemState = new Map();

// Track admin take item state per user
const takeItemState = new Map();

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    // Check for dynamic item IDs
    if (customId.startsWith('items_edit_') || customId.startsWith('items_delete_') || customId.startsWith('items_toggle_') || customId.startsWith('items_usable_')) {
      const parts = customId.split('_');
      const action = parts[1];
      const itemId = parseInt(parts[2]);
      
      if (action === 'edit') {
        await showEditItemModal(interaction, guildId, itemId);
        return true;
      } else if (action === 'delete') {
        await handleDeleteItem(interaction, guildId, itemId);
        return true;
      } else if (action === 'toggle') {
        await handleToggleItem(interaction, guildId, itemId);
        return true;
      } else if (action === 'usable') {
        await handleToggleUsable(interaction, guildId, itemId);
        return true;
      }
    }
    
    // Check for fulfillment action buttons (complete/cancel/refund)
    if (customId.startsWith('items_complete_') || customId.startsWith('items_cancel_') || customId.startsWith('items_refund_')) {
      const parts = customId.split('_');
      const action = parts[1];
      const requestId = parseInt(parts[2]);
      
      if (action === 'complete') {
        await handleCompleteFulfillment(interaction, guildId, requestId);
        return true;
      } else if (action === 'cancel') {
        await handleCancelFulfillment(interaction, guildId, requestId, false);
        return true;
      } else if (action === 'refund') {
        await handleCancelFulfillment(interaction, guildId, requestId, true);
        return true;
      }
    }
    
    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'admin_items':
        await interaction.deferUpdate();
        await showItemsPanel(interaction, guildId);
        return true;
      case 'items_toggle':
        await handleShopToggle(interaction, guildId);
        return true;
      case 'items_add':
        await showItemCreationPanel(interaction, guildId);
        return true;
      case 'items_create_continue':
        await showItemCreationModal(interaction, guildId);
        return true;
      case 'items_create_cancel':
        itemCreationState.delete(interaction.user.id);
        await interaction.deferUpdate();
        await showItemsPanel(interaction, guildId);
        return true;
      case 'items_manage':
        await interaction.deferUpdate();
        await showManageItemsPanel(interaction, guildId, 0);
        return true;
      case 'items_stats':
        await interaction.deferUpdate();
        await showStatsPanel(interaction, guildId);
        return true;
      case 'items_init_defaults':
        await handleInitDefaults(interaction, guildId);
        return true;
      case 'items_prev':
        await handlePageNav(interaction, guildId, -1);
        return true;
      case 'items_next':
        await handlePageNav(interaction, guildId, 1);
        return true;
      case 'back_items':
        await interaction.deferUpdate();
        await showItemsPanel(interaction, guildId);
        return true;
      case 'items_fulfillments':
        await interaction.deferUpdate();
        await showFulfillmentsPanel(interaction, guildId, 0);
        return true;
      case 'items_fulfill_prev':
        await handleFulfillmentPageNav(interaction, guildId, -1);
        return true;
      case 'items_fulfill_next':
        await handleFulfillmentPageNav(interaction, guildId, 1);
        return true;
      case 'items_ticket_settings':
        await interaction.deferUpdate();
        await showTicketSettingsPanel(interaction, guildId);
        return true;
      case 'items_give':
        await interaction.deferUpdate();
        await showGiveItemPanel(interaction, guildId);
        return true;
      case 'items_give_confirm':
        await handleGiveItemConfirm(interaction, guildId);
        return true;
      case 'items_give_cancel':
        giveItemState.delete(interaction.user.id);
        await interaction.deferUpdate();
        await showItemsPanel(interaction, guildId);
        return true;
      case 'items_take':
        await interaction.deferUpdate();
        await showTakeItemPanel(interaction, guildId);
        return true;
      case 'items_take_confirm':
        await handleTakeItemConfirm(interaction, guildId);
        return true;
      case 'items_take_cancel':
        takeItemState.delete(interaction.user.id);
        await interaction.deferUpdate();
        await showItemsPanel(interaction, guildId);
        return true;
    }
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (customId.startsWith('modal_items_edit_')) {
      const itemId = parseInt(customId.split('_')[3]);
      await handleEditItemModal(interaction, guildId, itemId);
      return true;
    }
    
    if (!MODAL_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'modal_items_add':
        await handleAddItemModal(interaction, guildId);
        return true;
      case 'modal_items_create':
        await handleItemCreationModal(interaction, guildId);
        return true;
      case 'modal_items_give_qty':
        await handleGiveItemQtyModal(interaction, guildId);
        return true;
      case 'modal_items_take_qty':
        await handleTakeItemQtyModal(interaction, guildId);
        return true;
    }
  }
  
  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
    if (!SELECT_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'items_select':
        await handleItemSelect(interaction, guildId);
        return true;
      case 'items_category_filter':
        await handleCategoryFilter(interaction, guildId);
        return true;
      case 'items_effect_select':
        // Used in modals, handled there
        return true;
      case 'items_ticket_category':
        await handleTicketCategorySelect(interaction, guildId);
        return true;
      case 'items_ticket_log':
        await handleTicketLogSelect(interaction, guildId);
        return true;
      case 'items_create_category':
        await handleCreateCategorySelect(interaction, guildId);
        return true;
      case 'items_create_effect':
        await handleCreateEffectSelect(interaction, guildId);
        return true;
      case 'items_give_item':
        await handleGiveItemSelect(interaction, guildId);
        return true;
      case 'items_take_item':
        await handleTakeItemSelect(interaction, guildId);
        return true;
    }
  }
  
  // Handle channel select menu interactions
  if (interaction.isChannelSelectMenu()) {
    if (customId === 'items_ticket_category') {
      await handleTicketCategorySelect(interaction, guildId);
      return true;
    }
    if (customId === 'items_ticket_log') {
      await handleTicketLogSelect(interaction, guildId);
      return true;
    }
  }
  
  // Handle user select menu interactions
  if (interaction.isUserSelectMenu()) {
    if (customId === 'items_give_user') {
      await handleGiveUserSelect(interaction, guildId);
      return true;
    }
    if (customId === 'items_take_user') {
      await handleTakeUserSelect(interaction, guildId);
      return true;
    }
  }
  
  return false;
}

// ==================== PANEL DISPLAYS ====================

async function showItemsPanel(interaction, guildId) {
  const settings = getItemSettings(guildId);
  const items = getShopItems(guildId, null, false);
  const stats = getShopStats(guildId);
  const pendingCount = getPendingFulfillmentCount(guildId);
  
  // Get category and log channel names for display
  const guild = interaction.guild;
  const ticketCategoryName = settings.ticketCategoryId 
    ? guild.channels.cache.get(settings.ticketCategoryId)?.name || 'Not Found' 
    : 'Not Set';
  const ticketLogName = settings.ticketLogChannelId 
    ? `<#${settings.ticketLogChannelId}>` 
    : 'Not Set';
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🛒 Item Shop Administration')
    .setDescription('Manage your server\'s item shop. Items can provide buffs, debuffs, and special effects.')
    .addFields(
      { name: '🔌 Shop Status', value: settings.shopEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📦 Total Items', value: `${items.length}`, inline: true },
      { name: '💰 Total Sales', value: `${stats.totalSales}`, inline: true },
      { name: '📊 Revenue', value: `${stats.totalRevenue.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '📋 Pending Requests', value: pendingCount > 0 ? `⚠️ ${pendingCount}` : '✅ None', inline: true },
      { name: '🎫 Ticket Settings', value: `Category: **${ticketCategoryName}**\nLog: ${ticketLogName}`, inline: true }
    );
  
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_toggle')
        .setLabel(settings.shopEnabled ? 'Disable Shop' : 'Enable Shop')
        .setStyle(settings.shopEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(settings.shopEnabled ? '🔴' : '🟢'),
      new ButtonBuilder()
        .setCustomId('items_add')
        .setLabel('Add Item')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➕'),
      new ButtonBuilder()
        .setCustomId('items_give')
        .setLabel('Give Item')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎁'),
      new ButtonBuilder()
        .setCustomId('items_take')
        .setLabel('Take Item')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('📤'),
      new ButtonBuilder()
        .setCustomId('items_manage')
        .setLabel('Manage Items')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📝')
    );
  
  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_fulfillments')
        .setLabel(`Fulfillments${pendingCount > 0 ? ` (${pendingCount})` : ''}`)
        .setStyle(pendingCount > 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setEmoji('📋'),
      new ButtonBuilder()
        .setCustomId('items_stats')
        .setLabel('View Stats')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📊'),
      new ButtonBuilder()
        .setCustomId('items_ticket_settings')
        .setLabel('Ticket Settings')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🎫'),
      new ButtonBuilder()
        .setCustomId('items_init_defaults')
        .setLabel('Add Default Items')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📦')
        .setDisabled(items.length > 0),
      new ButtonBuilder()
        .setCustomId('back_dashboard')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showManageItemsPanel(interaction, guildId, page = 0, categoryFilter = null) {
  const items = getShopItems(guildId, categoryFilter, false);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const pageItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  
  // Store pagination state
  const stateKey = `${guildId}-${interaction.user.id}`;
  paginationState.set(stateKey, { page: currentPage, category: categoryFilter });
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📝 Manage Shop Items')
    .setFooter({ text: `Page ${currentPage + 1}/${totalPages} • ${items.length} items` });
  
  if (pageItems.length === 0) {
    embed.setDescription('No items found.\n\nUse the "Add Item" button to create items, or "Add Default Items" to initialize with starter items.');
  } else {
    let description = '';
    for (const item of pageItems) {
      const status = item.enabled ? '✅' : '❌';
      const effectText = item.effect_type ? ` → ${item.effect_type} (+${item.effect_value}%)` : '';
      description += `${status} ${item.emoji} **${item.name}** - ${item.price.toLocaleString()} ${CURRENCY}${effectText}\n`;
      description += `   ${item.description ? item.description.substring(0, 50) + (item.description.length > 50 ? '...' : '') : 'No description'}\n\n`;
    }
    embed.setDescription(description);
  }
  
  const components = [];
  
  // Category filter dropdown
  const filterRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_category_filter')
        .setPlaceholder('📂 Filter by Category')
        .addOptions([
          { label: '📦 All Items', value: 'all', default: categoryFilter === null },
          { label: '🛡️ Protection', value: 'protection', default: categoryFilter === 'protection' },
          { label: '⚡ Boosts', value: 'boost', default: categoryFilter === 'boost' },
          { label: '🔧 Utility', value: 'utility', default: categoryFilter === 'utility' },
          { label: '🎁 Consumable', value: 'consumable', default: categoryFilter === 'consumable' },
          { label: '✨ Special', value: 'special', default: categoryFilter === 'special' }
        ])
    );
  components.push(filterRow);
  
  // Item selection dropdown (if there are items)
  if (pageItems.length > 0) {
    const selectRow = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('items_select')
          .setPlaceholder('🔍 Select an item to edit/delete')
          .addOptions(
            pageItems.map(item => ({
              label: item.name,
              value: item.id.toString(),
              description: `${item.price.toLocaleString()} - ${item.category}`,
              emoji: parseEmojiForSelect(item.emoji)
            }))
          )
      );
    components.push(selectRow);
  }
  
  // Navigation buttons
  const navRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_prev')
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('items_add')
        .setLabel('Add Item')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕'),
      new ButtonBuilder()
        .setCustomId('items_next')
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('back_items')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  components.push(navRow);
  
  await interaction.editReply({ embeds: [embed], components });
}

async function showItemDetailPanel(interaction, guildId, itemId) {
  const item = getShopItem(guildId, itemId);
  
  if (!item) {
    return interaction.editReply({ 
      content: '❌ Item not found!',
      embeds: [],
      components: []
    });
  }
  
  // Ensure usable has a default if column doesn't exist yet
  const isUsable = item.usable !== 0;
  const isForSale = item.enabled === 1;
  
  const embed = new EmbedBuilder()
    .setColor(isForSale ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${item.emoji} ${item.name}`)
    .setDescription(item.description || 'No description')
    .addFields(
      { name: '💰 Price', value: `${item.price.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '📂 Category', value: item.category, inline: true },
      { name: '🛒 For Sale', value: isForSale ? '✅ Yes' : '❌ No', inline: true },
      { name: '🔓 Usable', value: isUsable ? '✅ Yes' : '❌ No', inline: true }
    );
  
  // Only show effect details for items where they matter
  const isBoostEffect = item.effect_type && 
    !item.effect_type.startsWith('service_') && 
    item.effect_type !== 'cosmetic' && 
    item.effect_type !== 'lottery_free_ticket';
  
  if (item.effect_type) {
    embed.addFields(
      { name: '✨ Effect Type', value: item.effect_type, inline: true }
    );
    
    // Only show value and duration for boost effects
    if (isBoostEffect) {
      embed.addFields(
        { name: '📊 Effect Value', value: `+${item.effect_value}%`, inline: true },
        { name: '⏱️ Duration', value: `${item.duration_hours} hours`, inline: true }
      );
      
      // Show cooldown if set
      if (item.use_cooldown_hours > 0) {
        embed.addFields(
          { name: '⏳ Use Cooldown', value: `${item.use_cooldown_hours} hours`, inline: true }
        );
      }
    }
  }
  
  embed.addFields(
    { name: '📦 Max Stack', value: `${item.max_stack}`, inline: true }
  );
  
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`items_edit_${item.id}`)
        .setLabel('Edit')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️'),
      new ButtonBuilder()
        .setCustomId(`items_toggle_${item.id}`)
        .setLabel(isForSale ? 'Remove from Shop' : 'Add to Shop')
        .setStyle(isForSale ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(isForSale ? '🛒' : '🛒'),
      new ButtonBuilder()
        .setCustomId(`items_usable_${item.id}`)
        .setLabel(isUsable ? 'Disable Use' : 'Enable Use')
        .setStyle(isUsable ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji(isUsable ? '🔒' : '🔓')
    );
  
  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`items_delete_${item.id}`)
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId('items_manage')
        .setLabel('Back to List')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showStatsPanel(interaction, guildId) {
  const stats = getShopStats(guildId);
  const items = getShopItems(guildId, null, false);
  
  // Count by category
  const categoryCounts = {};
  for (const item of items) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  }
  
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('📊 Shop Statistics')
    .addFields(
      { name: '📦 Total Items', value: `${stats.totalItems}`, inline: true },
      { name: '🛒 Total Sales', value: `${stats.totalSales}`, inline: true },
      { name: '💰 Total Revenue', value: `${stats.totalRevenue.toLocaleString()} ${CURRENCY}`, inline: true }
    );
  
  // Add category breakdown
  if (Object.keys(categoryCounts).length > 0) {
    const categoryText = Object.entries(categoryCounts)
      .map(([cat, count]) => `${getCategoryEmoji(cat)} ${cat}: ${count}`)
      .join('\n');
    embed.addFields({ name: '📂 Items by Category', value: categoryText });
  }
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('back_items')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== ITEM CREATION FLOW (Multi-Step) ====================

async function showItemCreationPanel(interaction, guildId) {
  // Initialize creation state for this user
  itemCreationState.set(interaction.user.id, {
    category: 'utility',
    effectType: null,
    guildId: guildId
  });
  
  await interaction.deferUpdate();
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('➕ Create New Item - Step 1')
    .setDescription('Select a **category** and **effect type** for your new item using the dropdown menus below.\n\nOnce you\'ve made your selections, click **Continue** to enter the item details.')
    .addFields(
      { name: '📁 Category', value: '`utility` (default)', inline: true },
      { name: '⚡ Effect Type', value: '`None` (cosmetic)', inline: true }
    )
    .setFooter({ text: 'Step 1 of 2 - Select category and effect type' });
  
  // Category select menu
  const categoryOptions = [
    { label: '🛡️ Protection', value: 'protection', description: 'Items that protect from rob/hack' },
    { label: '⚡ Boost', value: 'boost', description: 'Items that boost earnings or success rates' },
    { label: '🔧 Utility', value: 'utility', description: 'General utility items' },
    { label: '🍎 Consumable', value: 'consumable', description: 'Single-use consumable items' },
    { label: '⭐ Special', value: 'special', description: 'Special or limited items' }
  ];
  
  const categoryRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_create_category')
        .setPlaceholder('Select item category...')
        .addOptions(categoryOptions)
    );
  
  // Effect type select menu - organized by category
  const effectOptions = [
    // No effect
    { label: '🏆 Cosmetic (No Effect)', value: 'cosmetic', description: 'Collectible with no gameplay effect' },
    // Protection
    { label: '🛡️ Rob Protection', value: 'rob_protection', description: 'Protects from being robbed' },
    { label: '🔒 Hack Protection', value: 'hack_protection', description: 'Protects from being hacked' },
    // Boosts
    { label: '💼 Work Boost', value: 'work_boost', description: 'Increases work earnings' },
    { label: '🔫 Crime Boost', value: 'crime_boost', description: 'Increases crime earnings' },
    { label: '💋 Slut Boost', value: 'slut_boost', description: 'Increases slut earnings' },
    { label: '🎯 Rob Success Boost', value: 'rob_success_boost', description: 'Increases rob success rate' },
    { label: '💻 Hack Success Boost', value: 'hack_success_boost', description: 'Increases hack success rate' },
    { label: '📈 XP Boost', value: 'xp_boost', description: 'Increases XP gains' },
    // Risk reduction
    { label: '📉 Rob Fine Reduction', value: 'rob_fine_reduction', description: 'Reduces fines when caught robbing' },
    { label: '📉 Hack Fine Reduction', value: 'hack_fine_reduction', description: 'Reduces fines when caught hacking' },
    { label: '📉 Crime Fine Reduction', value: 'crime_fine_reduction', description: 'Reduces fines when caught' },
    // Special
    { label: '🎰 Lottery Boost', value: 'lottery_boost', description: 'Extra lottery ticket or bonus' },
    { label: '�️ Free Lottery Ticket', value: 'lottery_free_ticket', description: 'Instant free lottery ticket (random numbers)' },
    { label: '�🏦 Bank Interest Boost', value: 'bank_interest_boost', description: 'Increased bank interest' },
    { label: '⏱️ Cooldown Reduction', value: 'cooldown_reduction', description: 'Reduces command cooldowns' },
    // Debuffs
    { label: '📉 Earnings Penalty', value: 'earnings_penalty', description: 'Reduces all earnings (curse)' },
    { label: '⚠️ Robbery Vulnerability', value: 'robbery_vulnerability', description: 'Easier to be robbed (curse)' },
    // Service items
    { label: '🎨 Custom Emoji (Service)', value: 'service_custom_emoji', description: 'Admin adds custom emoji' },
    { label: '📝 Nickname Change (Service)', value: 'service_nickname', description: 'Admin changes nickname' },
    { label: '🏷️ Custom Role (Service)', value: 'service_custom_role', description: 'Admin creates custom role' },
    { label: '🌈 Custom Color (Service)', value: 'service_custom_color', description: 'Admin gives custom role color' },
    { label: '✨ Other Service', value: 'service_other', description: 'Generic service item' }
  ];
  
  const effectRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_create_effect')
        .setPlaceholder('Select effect type...')
        .addOptions(effectOptions)
    );
  
  // Action buttons
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_create_continue')
        .setLabel('Continue')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➡️'),
      new ButtonBuilder()
        .setCustomId('items_create_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [categoryRow, effectRow, buttonRow] });
}

async function handleCreateCategorySelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const category = interaction.values[0];
  const userId = interaction.user.id;
  
  // Update creation state
  const state = itemCreationState.get(userId) || { category: 'utility', effectType: null, guildId };
  state.category = category;
  itemCreationState.set(userId, state);
  
  // Update the embed to show current selection
  await updateCreationPanel(interaction, state);
}

async function handleCreateEffectSelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const effectType = interaction.values[0];
  const userId = interaction.user.id;
  
  // Update creation state
  const state = itemCreationState.get(userId) || { category: 'utility', effectType: null, guildId };
  state.effectType = effectType === 'cosmetic' ? null : effectType;
  itemCreationState.set(userId, state);
  
  // Update the embed to show current selection
  await updateCreationPanel(interaction, state);
}

async function updateCreationPanel(interaction, state) {
  const categoryEmojis = {
    protection: '🛡️',
    boost: '⚡',
    utility: '🔧',
    consumable: '🍎',
    special: '⭐'
  };
  
  const effectNames = {
    'rob_protection': '🛡️ Rob Protection',
    'hack_protection': '🔒 Hack Protection',
    'work_boost': '💼 Work Boost',
    'crime_boost': '🔫 Crime Boost',
    'slut_boost': '💋 Slut Boost',
    'rob_success_boost': '🎯 Rob Success Boost',
    'hack_success_boost': '💻 Hack Success Boost',
    'xp_boost': '📈 XP Boost',
    'rob_fine_reduction': '📉 Rob Fine Reduction',
    'hack_fine_reduction': '📉 Hack Fine Reduction',
    'crime_fine_reduction': '📉 Crime Fine Reduction',
    'lottery_boost': '🎰 Lottery Boost',
    'lottery_free_ticket': '🎟️ Free Lottery Ticket',
    'bank_interest_boost': '🏦 Bank Interest Boost',
    'cooldown_reduction': '⏱️ Cooldown Reduction',
    'earnings_penalty': '📉 Earnings Penalty',
    'robbery_vulnerability': '⚠️ Robbery Vulnerability',
    'service_custom_emoji': '🎨 Custom Emoji (Service)',
    'service_nickname': '📝 Nickname Change (Service)',
    'service_custom_role': '🏷️ Custom Role (Service)',
    'service_custom_color': '🌈 Custom Color (Service)',
    'service_other': '✨ Other Service'
  };
  
  const categoryDisplay = `${categoryEmojis[state.category] || '📦'} ${state.category}`;
  const effectDisplay = state.effectType ? effectNames[state.effectType] || state.effectType : '🏆 Cosmetic (No Effect)';
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('➕ Create New Item - Step 1')
    .setDescription('Select a **category** and **effect type** for your new item using the dropdown menus below.\n\nOnce you\'ve made your selections, click **Continue** to enter the item details.')
    .addFields(
      { name: '📁 Category', value: `\`${categoryDisplay}\``, inline: true },
      { name: '⚡ Effect Type', value: `\`${effectDisplay}\``, inline: true }
    )
    .setFooter({ text: 'Step 1 of 2 - Select category and effect type' });
  
  // Recreate the select menus (Discord requires this)
  const categoryOptions = [
    { label: '🛡️ Protection', value: 'protection', description: 'Items that protect from rob/hack', default: state.category === 'protection' },
    { label: '⚡ Boost', value: 'boost', description: 'Items that boost earnings or success rates', default: state.category === 'boost' },
    { label: '🔧 Utility', value: 'utility', description: 'General utility items', default: state.category === 'utility' },
    { label: '🍎 Consumable', value: 'consumable', description: 'Single-use consumable items', default: state.category === 'consumable' },
    { label: '⭐ Special', value: 'special', description: 'Special or limited items', default: state.category === 'special' }
  ];
  
  const categoryRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_create_category')
        .setPlaceholder('Select item category...')
        .addOptions(categoryOptions)
    );
  
  const currentEffect = state.effectType || 'cosmetic';
  const effectOptions = [
    { label: '🏆 Cosmetic (No Effect)', value: 'cosmetic', description: 'Collectible with no gameplay effect', default: currentEffect === 'cosmetic' },
    { label: '🛡️ Rob Protection', value: 'rob_protection', description: 'Protects from being robbed', default: currentEffect === 'rob_protection' },
    { label: '🔒 Hack Protection', value: 'hack_protection', description: 'Protects from being hacked', default: currentEffect === 'hack_protection' },
    { label: '💼 Work Boost', value: 'work_boost', description: 'Increases work earnings', default: currentEffect === 'work_boost' },
    { label: '🔫 Crime Boost', value: 'crime_boost', description: 'Increases crime earnings', default: currentEffect === 'crime_boost' },
    { label: '💋 Slut Boost', value: 'slut_boost', description: 'Increases slut earnings', default: currentEffect === 'slut_boost' },
    { label: '🎯 Rob Success Boost', value: 'rob_success_boost', description: 'Increases rob success rate', default: currentEffect === 'rob_success_boost' },
    { label: '💻 Hack Success Boost', value: 'hack_success_boost', description: 'Increases hack success rate', default: currentEffect === 'hack_success_boost' },
    { label: '📈 XP Boost', value: 'xp_boost', description: 'Increases XP gains', default: currentEffect === 'xp_boost' },
    { label: '📉 Rob Fine Reduction', value: 'rob_fine_reduction', description: 'Reduces fines when caught robbing', default: currentEffect === 'rob_fine_reduction' },
    { label: '📉 Hack Fine Reduction', value: 'hack_fine_reduction', description: 'Reduces fines when caught hacking', default: currentEffect === 'hack_fine_reduction' },
    { label: '📉 Crime Fine Reduction', value: 'crime_fine_reduction', description: 'Reduces fines when caught', default: currentEffect === 'crime_fine_reduction' },
    { label: '🎰 Lottery Boost', value: 'lottery_boost', description: 'Extra lottery ticket or bonus', default: currentEffect === 'lottery_boost' },
    { label: '�️ Free Lottery Ticket', value: 'lottery_free_ticket', description: 'Instant free lottery ticket', default: currentEffect === 'lottery_free_ticket' },
    { label: '�🏦 Bank Interest Boost', value: 'bank_interest_boost', description: 'Increased bank interest', default: currentEffect === 'bank_interest_boost' },
    { label: '⏱️ Cooldown Reduction', value: 'cooldown_reduction', description: 'Reduces command cooldowns', default: currentEffect === 'cooldown_reduction' },
    { label: '📉 Earnings Penalty', value: 'earnings_penalty', description: 'Reduces all earnings (curse)', default: currentEffect === 'earnings_penalty' },
    { label: '⚠️ Robbery Vulnerability', value: 'robbery_vulnerability', description: 'Easier to be robbed (curse)', default: currentEffect === 'robbery_vulnerability' },
    { label: '🎨 Custom Emoji (Service)', value: 'service_custom_emoji', description: 'Admin adds custom emoji', default: currentEffect === 'service_custom_emoji' },
    { label: '📝 Nickname Change (Service)', value: 'service_nickname', description: 'Admin changes nickname', default: currentEffect === 'service_nickname' },
    { label: '🏷️ Custom Role (Service)', value: 'service_custom_role', description: 'Admin creates custom role', default: currentEffect === 'service_custom_role' },
    { label: '🌈 Custom Color (Service)', value: 'service_custom_color', description: 'Admin gives custom role color', default: currentEffect === 'service_custom_color' },
    { label: '✨ Other Service', value: 'service_other', description: 'Generic service item', default: currentEffect === 'service_other' }
  ];
  
  const effectRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_create_effect')
        .setPlaceholder('Select effect type...')
        .addOptions(effectOptions)
    );
  
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_create_continue')
        .setLabel('Continue')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➡️'),
      new ButtonBuilder()
        .setCustomId('items_create_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [categoryRow, effectRow, buttonRow] });
}

async function showItemCreationModal(interaction, guildId) {
  const userId = interaction.user.id;
  const state = itemCreationState.get(userId);
  
  if (!state) {
    return interaction.reply({ content: '❌ Session expired. Please start over by clicking "Add Item".', ephemeral: true });
  }
  
  // Determine what fields to show based on effect type
  const hasEffect = state.effectType && state.effectType !== 'cosmetic';
  const isServiceItem = state.effectType && state.effectType.startsWith('service_');
  const isLotteryTicket = state.effectType === 'lottery_free_ticket';
  
  const modal = new ModalBuilder()
    .setCustomId('modal_items_create')
    .setTitle('Create Item - Details');
  
  const nameInput = new TextInputBuilder()
    .setCustomId('item_name')
    .setLabel('Item Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., Lucky Charm')
    .setRequired(true)
    .setMaxLength(50);
  
  const descInput = new TextInputBuilder()
    .setCustomId('item_description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe what the item does...')
    .setRequired(false)
    .setMaxLength(200);
  
  const priceInput = new TextInputBuilder()
    .setCustomId('item_price')
    .setLabel('Price')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 10000')
    .setRequired(true);
  
  const emojiInput = new TextInputBuilder()
    .setCustomId('item_emoji')
    .setLabel('Emoji (paste custom emoji to get full code)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('⚡ or paste <:name:id> for custom emoji')
    .setValue('📦')
    .setRequired(false)
    .setMaxLength(64);
  
  const maxStackInput = new TextInputBuilder()
    .setCustomId('item_max_stack')
    .setLabel('Max Stack (how many can a user hold?)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 5 (default: 99)')
    .setValue('99')
    .setRequired(false)
    .setMaxLength(3);
  
  // Only show effect value/duration for items with effects (not service items or lottery tickets)
  if (hasEffect && !isServiceItem && !isLotteryTicket) {
    const effectDetailsInput = new TextInputBuilder()
      .setCustomId('item_effect_details')
      .setLabel('Value:Duration:Cooldown (hours)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g., 50:24:48 (50% for 24h, 48h cooldown)')
      .setValue('50:24:0')
      .setRequired(true);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(priceInput),
      new ActionRowBuilder().addComponents(effectDetailsInput),
      new ActionRowBuilder().addComponents(maxStackInput)
    );
  } else {
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(priceInput),
      new ActionRowBuilder().addComponents(maxStackInput),
      new ActionRowBuilder().addComponents(emojiInput)
    );
  }
  
  await interaction.showModal(modal);
}

async function handleItemCreationModal(interaction, guildId) {
  const userId = interaction.user.id;
  const state = itemCreationState.get(userId);
  
  if (!state) {
    return interaction.reply({ content: '❌ Session expired. Please start over by clicking "Add Item".', ephemeral: true });
  }
  
  const name = interaction.fields.getTextInputValue('item_name').trim();
  const description = interaction.fields.getTextInputValue('item_description').trim();
  const priceStr = interaction.fields.getTextInputValue('item_price').trim();
  
  // Parse price
  const price = parseInt(priceStr.replace(/,/g, ''));
  if (isNaN(price) || price < 0) {
    return interaction.reply({ content: '❌ Invalid price! Enter a positive number.', ephemeral: true });
  }
  
  // Parse max_stack
  let maxStack = 99;
  try {
    const maxStackStr = interaction.fields.getTextInputValue('item_max_stack').trim();
    if (maxStackStr) {
      maxStack = parseInt(maxStackStr) || 99;
      if (maxStack < 1) maxStack = 1;
      if (maxStack > 999) maxStack = 999;
    }
  } catch (e) {
    maxStack = 99;
  }
  
  // Get emoji - may not be present in all modal variants
  let emoji = '📦';
  try {
    emoji = interaction.fields.getTextInputValue('item_emoji').trim() || '📦';
  } catch (e) {
    // Emoji field not present in this modal variant
  }
  
  // Get effect details if applicable
  let effectValue = 0;
  let durationHours = 0;
  let useCooldownHours = 0;
  
  const hasEffect = state.effectType && state.effectType !== 'cosmetic';
  const isServiceItem = state.effectType && state.effectType.startsWith('service_');
  const isLotteryTicket = state.effectType === 'lottery_free_ticket';
  
  if (hasEffect && !isServiceItem && !isLotteryTicket) {
    try {
      const effectDetails = interaction.fields.getTextInputValue('item_effect_details').trim();
      const parts = effectDetails.split(':');
      effectValue = parseInt(parts[0]) || 50;
      durationHours = parseInt(parts[1]) || 24;
      useCooldownHours = parseInt(parts[2]) || 0;
    } catch (e) {
      effectValue = 50;
      durationHours = 24;
      useCooldownHours = 0;
    }
  }
  
  // Create the item
  const itemData = {
    name,
    description,
    price,
    category: state.category,
    effect_type: state.effectType,
    effect_value: effectValue,
    duration_hours: durationHours,
    use_cooldown_hours: useCooldownHours,
    max_stack: maxStack,
    enabled: true,
    emoji
  };
  
  const newItem = addShopItem(guildId, itemData);
  
  // Clean up state
  itemCreationState.delete(userId);
  
  if (!newItem) {
    return interaction.reply({ content: '❌ Failed to create item. Name may already exist.', ephemeral: true });
  }
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_ADD', 
    `Added item: ${name} (${price} coins, category: ${state.category}, effect: ${state.effectType || 'none'})`);
  
  await interaction.reply({ 
    content: `✅ Created item **${emoji} ${name}** for **${price.toLocaleString()}** ${CURRENCY}\n📁 Category: \`${state.category}\`\n⚡ Effect: \`${state.effectType || 'cosmetic'}\``,
    ephemeral: true 
  });
  
  // Refresh the panel
  await showManageItemsPanel(interaction, guildId, 0);
}

// ==================== ADMIN GIVE ITEM FLOW ====================

async function showGiveItemPanel(interaction, guildId) {
  const items = getShopItems(guildId, null, false);
  
  if (items.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🎁 Give Item')
      .setDescription('No items exist in the shop yet!\n\nCreate items first using **Add Item** or **Add Default Items**.');
    
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('back_items')
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('◀️')
      );
    
    return interaction.editReply({ embeds: [embed], components: [backRow] });
  }
  
  // Initialize give state
  giveItemState.set(interaction.user.id, {
    guildId: guildId,
    userId: null,
    itemId: null,
    quantity: 1
  });
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🎁 Give Item to User')
    .setDescription('Select a **user** and an **item** to give them.\n\nThis will add the item directly to their inventory.')
    .addFields(
      { name: '👤 User', value: '`Not selected`', inline: true },
      { name: '📦 Item', value: '`Not selected`', inline: true }
    )
    .setFooter({ text: 'Step 1: Select a user and item' });
  
  // User select menu
  const userRow = new ActionRowBuilder()
    .addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('items_give_user')
        .setPlaceholder('Select a user...')
    );
  
  // Item select menu
  const itemOptions = items.slice(0, 25).map(item => ({
    label: `${item.emoji} ${item.name}`,
    value: item.id.toString(),
    description: `${item.price.toLocaleString()} coins - ${item.category}`
  }));
  
  const itemRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_give_item')
        .setPlaceholder('Select an item...')
        .addOptions(itemOptions)
    );
  
  // Action buttons
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_give_confirm')
        .setLabel('Give Item')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎁')
        .setDisabled(true), // Disabled until both user and item selected
      new ButtonBuilder()
        .setCustomId('items_give_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [userRow, itemRow, buttonRow] });
}

async function handleGiveUserSelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const userId = interaction.user.id;
  const selectedUser = interaction.users.first();
  
  if (!selectedUser) return;
  
  // Update state
  const state = giveItemState.get(userId) || { guildId, userId: null, itemId: null, quantity: 1 };
  state.userId = selectedUser.id;
  state.userName = selectedUser.username;
  giveItemState.set(userId, state);
  
  await updateGiveItemPanel(interaction, state);
}

async function handleGiveItemSelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const userId = interaction.user.id;
  const itemId = parseInt(interaction.values[0]);
  
  // Update state
  const state = giveItemState.get(userId) || { guildId, userId: null, itemId: null, quantity: 1 };
  state.itemId = itemId;
  
  // Get item details
  const item = getShopItem(guildId, itemId);
  if (item) {
    state.itemName = item.name;
    state.itemEmoji = item.emoji;
  }
  
  giveItemState.set(userId, state);
  
  await updateGiveItemPanel(interaction, state);
}

async function updateGiveItemPanel(interaction, state) {
  const items = getShopItems(state.guildId, null, false);
  
  const userDisplay = state.userId ? `<@${state.userId}>` : '`Not selected`';
  const itemDisplay = state.itemId && state.itemName ? `${state.itemEmoji} ${state.itemName}` : '`Not selected`';
  const canConfirm = state.userId && state.itemId;
  
  const embed = new EmbedBuilder()
    .setColor(canConfirm ? 0x2ecc71 : 0x3498db)
    .setTitle('🎁 Give Item to User')
    .setDescription(canConfirm 
      ? 'Ready to give item! Click **Give Item** to confirm, or select a different user/item.'
      : 'Select a **user** and an **item** to give them.\n\nThis will add the item directly to their inventory.')
    .addFields(
      { name: '👤 User', value: userDisplay, inline: true },
      { name: '📦 Item', value: itemDisplay, inline: true }
    )
    .setFooter({ text: canConfirm ? 'Click Give Item to open quantity dialog' : 'Step 1: Select a user and item' });
  
  // User select menu
  const userRow = new ActionRowBuilder()
    .addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('items_give_user')
        .setPlaceholder('Select a user...')
    );
  
  // Item select menu
  const itemOptions = items.slice(0, 25).map(item => ({
    label: `${item.emoji} ${item.name}`,
    value: item.id.toString(),
    description: `${item.price.toLocaleString()} coins - ${item.category}`,
    default: item.id === state.itemId
  }));
  
  const itemRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_give_item')
        .setPlaceholder('Select an item...')
        .addOptions(itemOptions)
    );
  
  // Action buttons
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_give_confirm')
        .setLabel('Give Item')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎁')
        .setDisabled(!canConfirm),
      new ButtonBuilder()
        .setCustomId('items_give_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [userRow, itemRow, buttonRow] });
}

async function handleGiveItemConfirm(interaction, guildId) {
  const userId = interaction.user.id;
  const state = giveItemState.get(userId);
  
  if (!state || !state.userId || !state.itemId) {
    return interaction.reply({ content: '❌ Please select both a user and an item first.', ephemeral: true });
  }
  
  // Show quantity modal
  const modal = new ModalBuilder()
    .setCustomId('modal_items_give_qty')
    .setTitle('Give Item - Quantity');
  
  const qtyInput = new TextInputBuilder()
    .setCustomId('give_quantity')
    .setLabel(`How many ${state.itemEmoji} ${state.itemName} to give?`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter quantity (1-100)')
    .setValue('1')
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(3);
  
  modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
  
  await interaction.showModal(modal);
}

async function handleGiveItemQtyModal(interaction, guildId) {
  const userId = interaction.user.id;
  const state = giveItemState.get(userId);
  
  if (!state || !state.userId || !state.itemId) {
    return interaction.reply({ content: '❌ Session expired. Please start over.', ephemeral: true });
  }
  
  const qtyStr = interaction.fields.getTextInputValue('give_quantity').trim();
  const quantity = parseInt(qtyStr);
  
  if (isNaN(quantity) || quantity < 1 || quantity > 100) {
    return interaction.reply({ content: '❌ Invalid quantity! Enter a number between 1 and 100.', ephemeral: true });
  }
  
  // Add item to user's inventory
  const added = addToInventory(state.guildId, state.userId, state.itemId, quantity);
  
  // Clean up state
  giveItemState.delete(userId);
  
  if (!added.success) {
    return interaction.reply({ content: `❌ ${added.error || 'Failed to add item to inventory. Please try again.'}`, ephemeral: true });
  }
  
  // Log the action
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_GIVE',
    `Gave ${quantity}x ${state.itemName} to ${state.userName}`);
  
  // Send ephemeral confirmation to admin
  await interaction.reply({
    content: `✅ Successfully gave **${quantity}x ${state.itemEmoji} ${state.itemName}** to <@${state.userId}>!`,
    ephemeral: true
  });
  
  // Send public announcement embed
  const publicEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🎁 Item Gift!')
    .setDescription(`<@${state.userId}> has received a gift!`)
    .addFields(
      { name: '📦 Item', value: `${state.itemEmoji} **${state.itemName}**`, inline: true },
      { name: '📊 Quantity', value: `x${quantity}`, inline: true },
      { name: '🎁 From', value: `<@${interaction.user.id}>`, inline: true }
    )
    .setFooter({ text: 'Use /inventory to view your items!' })
    .setTimestamp();
  
  await interaction.channel.send({ embeds: [publicEmbed] });
  
  // Refresh the panel
  await showItemsPanel(interaction, guildId);
}

// ==================== ADMIN TAKE ITEM FLOW ====================

async function showTakeItemPanel(interaction, guildId) {
  // Initialize take state
  takeItemState.set(interaction.user.id, {
    guildId: guildId,
    userId: null,
    itemId: null,
    quantity: 1,
    maxQuantity: 0
  });
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('📤 Take Item from User')
    .setDescription('First, select a **user** to view their inventory.\n\nThen you can select which item to take.')
    .addFields(
      { name: '👤 User', value: '`Not selected`', inline: true },
      { name: '📦 Item', value: '`Not selected`', inline: true }
    )
    .setFooter({ text: 'Step 1: Select a user' });
  
  // User select menu
  const userRow = new ActionRowBuilder()
    .addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('items_take_user')
        .setPlaceholder('Select a user to view their inventory...')
    );
  
  // Action buttons
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_take_confirm')
        .setLabel('Take Item')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('📤')
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('items_take_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [userRow, buttonRow] });
}

async function handleTakeUserSelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const adminId = interaction.user.id;
  const selectedUser = interaction.users.first();
  
  if (!selectedUser) return;
  
  // Get the selected user's inventory
  const inventory = getUserInventory(guildId, selectedUser.id);
  
  // Update state
  const state = takeItemState.get(adminId) || { guildId, userId: null, itemId: null, quantity: 1, maxQuantity: 0 };
  state.userId = selectedUser.id;
  state.userName = selectedUser.username;
  state.itemId = null; // Reset item when user changes
  takeItemState.set(adminId, state);
  
  if (inventory.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('📤 Take Item from User')
      .setDescription(`**${selectedUser.username}** has no items in their inventory.`)
      .addFields(
        { name: '👤 User', value: `<@${selectedUser.id}>`, inline: true },
        { name: '📦 Inventory', value: '`Empty`', inline: true }
      )
      .setFooter({ text: 'Select a different user or cancel' });
    
    const userRow = new ActionRowBuilder()
      .addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('items_take_user')
          .setPlaceholder('Select a different user...')
      );
    
    const buttonRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('items_take_confirm')
          .setLabel('Take Item')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('📤')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('items_take_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✖️')
      );
    
    return interaction.editReply({ embeds: [embed], components: [userRow, buttonRow] });
  }
  
  // Show user's inventory
  await updateTakeItemPanel(interaction, state, inventory);
}

async function handleTakeItemSelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const adminId = interaction.user.id;
  const [itemIdStr, quantityStr] = interaction.values[0].split(':');
  const itemId = parseInt(itemIdStr);
  const maxQuantity = parseInt(quantityStr);
  
  // Update state
  const state = takeItemState.get(adminId);
  if (!state) return;
  
  state.itemId = itemId;
  state.maxQuantity = maxQuantity;
  
  // Get item details
  const item = getShopItem(guildId, itemId);
  if (item) {
    state.itemName = item.name;
    state.itemEmoji = item.emoji;
  }
  
  takeItemState.set(adminId, state);
  
  // Get user's inventory to update display
  const inventory = getUserInventory(guildId, state.userId);
  await updateTakeItemPanel(interaction, state, inventory);
}

async function updateTakeItemPanel(interaction, state, inventory) {
  const userDisplay = state.userId ? `<@${state.userId}>` : '`Not selected`';
  const itemDisplay = state.itemId && state.itemName 
    ? `${state.itemEmoji} ${state.itemName} (x${state.maxQuantity})` 
    : '`Not selected`';
  const canConfirm = state.userId && state.itemId;
  
  // Build inventory list for embed
  let inventoryText = '';
  for (const item of inventory.slice(0, 10)) {
    inventoryText += `${item.emoji} **${item.name}** x${item.quantity}\n`;
  }
  if (inventory.length > 10) {
    inventoryText += `\n*...and ${inventory.length - 10} more items*`;
  }
  
  const embed = new EmbedBuilder()
    .setColor(canConfirm ? 0xe74c3c : 0x3498db)
    .setTitle('📤 Take Item from User')
    .setDescription(canConfirm 
      ? `Ready to take item from **${state.userName}**!\n\nClick **Take Item** to specify quantity.`
      : `Select an item from **${state.userName}**'s inventory to take.`)
    .addFields(
      { name: '👤 User', value: userDisplay, inline: true },
      { name: '📦 Selected Item', value: itemDisplay, inline: true },
      { name: `📋 ${state.userName}'s Inventory`, value: inventoryText || 'Empty', inline: false }
    )
    .setFooter({ text: canConfirm ? 'Click Take Item to specify quantity' : 'Step 2: Select an item to take' });
  
  // User select menu
  const userRow = new ActionRowBuilder()
    .addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('items_take_user')
        .setPlaceholder('Select a different user...')
    );
  
  // Item select menu from user's inventory
  const itemOptions = inventory.slice(0, 25).map(item => ({
    label: `${item.emoji} ${item.name} (x${item.quantity})`,
    value: `${item.item_id}:${item.quantity}`,
    description: item.description ? item.description.substring(0, 50) : 'No description',
    default: item.item_id === state.itemId
  }));
  
  const itemRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_take_item')
        .setPlaceholder('Select an item to take...')
        .addOptions(itemOptions)
    );
  
  // Action buttons
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_take_confirm')
        .setLabel('Take Item')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('📤')
        .setDisabled(!canConfirm),
      new ButtonBuilder()
        .setCustomId('items_take_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [userRow, itemRow, buttonRow] });
}

async function handleTakeItemConfirm(interaction, guildId) {
  const adminId = interaction.user.id;
  const state = takeItemState.get(adminId);
  
  if (!state || !state.userId || !state.itemId) {
    return interaction.reply({ content: '❌ Please select both a user and an item first.', ephemeral: true });
  }
  
  // Show quantity modal
  const modal = new ModalBuilder()
    .setCustomId('modal_items_take_qty')
    .setTitle('Take Item - Quantity');
  
  const qtyInput = new TextInputBuilder()
    .setCustomId('take_quantity')
    .setLabel(`How many ${state.itemEmoji} ${state.itemName} to take? (max: ${state.maxQuantity})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`Enter quantity (1-${state.maxQuantity})`)
    .setValue(state.maxQuantity.toString())
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(3);
  
  modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
  
  await interaction.showModal(modal);
}

async function handleTakeItemQtyModal(interaction, guildId) {
  const adminId = interaction.user.id;
  const state = takeItemState.get(adminId);
  
  if (!state || !state.userId || !state.itemId) {
    return interaction.reply({ content: '❌ Session expired. Please start over.', ephemeral: true });
  }
  
  const qtyStr = interaction.fields.getTextInputValue('take_quantity').trim();
  const quantity = parseInt(qtyStr);
  
  if (isNaN(quantity) || quantity < 1) {
    return interaction.reply({ content: '❌ Invalid quantity! Enter a positive number.', ephemeral: true });
  }
  
  if (quantity > state.maxQuantity) {
    return interaction.reply({ 
      content: `❌ Cannot take ${quantity}! User only has ${state.maxQuantity}x ${state.itemEmoji} ${state.itemName}.`, 
      ephemeral: true 
    });
  }
  
  // Remove item from user's inventory
  const removed = removeFromInventory(state.guildId, state.userId, state.itemId, quantity);
  
  // Clean up state
  takeItemState.delete(adminId);
  
  if (!removed) {
    return interaction.reply({ content: '❌ Failed to remove item from inventory. Please try again.', ephemeral: true });
  }
  
  // Log the action
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_TAKE',
    `Took ${quantity}x ${state.itemName} from ${state.userName}`);
  
  await interaction.reply({
    content: `✅ Successfully took **${quantity}x ${state.itemEmoji} ${state.itemName}** from <@${state.userId}>!`,
    ephemeral: true
  });
  
  // Refresh the panel
  await showItemsPanel(interaction, guildId);
}

// ==================== MODAL HANDLERS ====================

async function showAddItemModal(interaction, guildId) {
  const modal = new ModalBuilder()
    .setCustomId('modal_items_add')
    .setTitle('Add New Shop Item');
  
  const nameInput = new TextInputBuilder()
    .setCustomId('item_name')
    .setLabel('Item Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., Lucky Charm')
    .setRequired(true)
    .setMaxLength(50);
  
  const descInput = new TextInputBuilder()
    .setCustomId('item_description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe what the item does...')
    .setRequired(false)
    .setMaxLength(200);
  
  const priceInput = new TextInputBuilder()
    .setCustomId('item_price')
    .setLabel('Price')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 10000')
    .setRequired(true);
  
  const effectInput = new TextInputBuilder()
    .setCustomId('item_effect')
    .setLabel('Effect (type:value:hours) - optional')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., work_boost:50:6 or rob_protection:100:24')
    .setRequired(false);
  
  const extraInput = new TextInputBuilder()
    .setCustomId('item_extra')
    .setLabel('Category, Emoji (category,emoji) - optional')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., boost,⚡ or protection,🛡️')
    .setRequired(false);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(priceInput),
    new ActionRowBuilder().addComponents(effectInput),
    new ActionRowBuilder().addComponents(extraInput)
  );
  
  await interaction.showModal(modal);
}

async function handleAddItemModal(interaction, guildId) {
  const name = interaction.fields.getTextInputValue('item_name').trim();
  const description = interaction.fields.getTextInputValue('item_description').trim();
  const priceStr = interaction.fields.getTextInputValue('item_price').trim();
  const effectStr = interaction.fields.getTextInputValue('item_effect').trim();
  const extraStr = interaction.fields.getTextInputValue('item_extra').trim();
  
  // Parse price
  const price = parseInt(priceStr.replace(/,/g, ''));
  if (isNaN(price) || price < 0) {
    return interaction.reply({ content: '❌ Invalid price! Enter a positive number.', ephemeral: true });
  }
  
  // Parse effect (format: type:value:hours)
  let effectType = null;
  let effectValue = 0;
  let durationHours = 24;
  
  if (effectStr) {
    const effectParts = effectStr.split(':');
    if (effectParts.length >= 1) effectType = effectParts[0].toLowerCase();
    if (effectParts.length >= 2) effectValue = parseInt(effectParts[1]) || 0;
    if (effectParts.length >= 3) durationHours = parseInt(effectParts[2]) || 24;
  }
  
  // Parse extra (format: category,emoji)
  let category = 'utility';
  let emoji = '📦';
  
  if (extraStr) {
    const extraParts = extraStr.split(',');
    if (extraParts.length >= 1) {
      const cat = extraParts[0].trim().toLowerCase();
      if (['protection', 'boost', 'utility', 'consumable', 'special'].includes(cat)) {
        category = cat;
      }
    }
    if (extraParts.length >= 2) emoji = extraParts[1].trim() || '📦';
  }
  
  // Create the item
  const itemData = {
    name,
    description,
    price,
    category,
    effect_type: effectType,
    effect_value: effectValue,
    duration_hours: durationHours,
    max_stack: 1,
    enabled: true,
    emoji
  };
  
  const newItem = addShopItem(guildId, itemData);
  
  if (!newItem) {
    return interaction.reply({ content: '❌ Failed to create item. Name may already exist.', ephemeral: true });
  }
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_ADD', 
    `Added item: ${name} (${price} coins)`);
  
  await interaction.reply({ 
    content: `✅ Created item **${emoji} ${name}** for **${price.toLocaleString()}** ${CURRENCY}`,
    ephemeral: true 
  });
  
  // Refresh the panel
  await showManageItemsPanel(interaction, guildId, 0);
}

async function showEditItemModal(interaction, guildId, itemId) {
  const item = getShopItem(guildId, itemId);
  if (!item) {
    return interaction.reply({ content: '❌ Item not found!', ephemeral: true });
  }
  
  const modal = new ModalBuilder()
    .setCustomId(`modal_items_edit_${itemId}`)
    .setTitle(`Edit: ${item.name}`);
  
  const nameInput = new TextInputBuilder()
    .setCustomId('item_name')
    .setLabel('Item Name')
    .setStyle(TextInputStyle.Short)
    .setValue(item.name)
    .setRequired(true)
    .setMaxLength(50);
  
  const descInput = new TextInputBuilder()
    .setCustomId('item_description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(item.description || '')
    .setRequired(false)
    .setMaxLength(200);
  
  const priceInput = new TextInputBuilder()
    .setCustomId('item_price')
    .setLabel('Price')
    .setStyle(TextInputStyle.Short)
    .setValue(item.price.toString())
    .setRequired(true);
  
  const effectStr = item.effect_type ? `${item.effect_type}:${item.effect_value}:${item.duration_hours}:${item.use_cooldown_hours || 0}` : '';
  const effectInput = new TextInputBuilder()
    .setCustomId('item_effect')
    .setLabel('Effect (type:value:hours:cooldown)')
    .setStyle(TextInputStyle.Short)
    .setValue(effectStr)
    .setPlaceholder('e.g., work_boost:50:6:24')
    .setRequired(false);
  
  const extraInput = new TextInputBuilder()
    .setCustomId('item_extra')
    .setLabel('Category, Emoji')
    .setStyle(TextInputStyle.Short)
    .setValue(`${item.category},${item.emoji}`)
    .setRequired(false);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(priceInput),
    new ActionRowBuilder().addComponents(effectInput),
    new ActionRowBuilder().addComponents(extraInput)
  );
  
  await interaction.showModal(modal);
}

async function handleEditItemModal(interaction, guildId, itemId) {
  const name = interaction.fields.getTextInputValue('item_name').trim();
  const description = interaction.fields.getTextInputValue('item_description').trim();
  const priceStr = interaction.fields.getTextInputValue('item_price').trim();
  const effectStr = interaction.fields.getTextInputValue('item_effect').trim();
  const extraStr = interaction.fields.getTextInputValue('item_extra').trim();
  
  // Parse price
  const price = parseInt(priceStr.replace(/,/g, ''));
  if (isNaN(price) || price < 0) {
    return interaction.reply({ content: '❌ Invalid price! Enter a positive number.', ephemeral: true });
  }
  
  // Parse effect
  let effectType = null;
  let effectValue = 0;
  let durationHours = 24;
  let useCooldownHours = 0;
  
  if (effectStr) {
    const effectParts = effectStr.split(':');
    if (effectParts.length >= 1) effectType = effectParts[0].toLowerCase();
    if (effectParts.length >= 2) effectValue = parseInt(effectParts[1]) || 0;
    if (effectParts.length >= 3) durationHours = parseInt(effectParts[2]) || 24;
    if (effectParts.length >= 4) useCooldownHours = parseInt(effectParts[3]) || 0;
  }
  
  // Parse extra
  let category = 'utility';
  let emoji = '📦';
  
  if (extraStr) {
    const extraParts = extraStr.split(',');
    if (extraParts.length >= 1) {
      const cat = extraParts[0].trim().toLowerCase();
      if (['protection', 'boost', 'utility', 'consumable', 'special'].includes(cat)) {
        category = cat;
      }
    }
    if (extraParts.length >= 2) emoji = extraParts[1].trim() || '📦';
  }
  
  // Update the item
  const success = updateShopItem(guildId, itemId, {
    name,
    description,
    price,
    category,
    effect_type: effectType,
    effect_value: effectValue,
    duration_hours: durationHours,
    use_cooldown_hours: useCooldownHours,
    emoji
  });
  
  if (!success) {
    return interaction.reply({ content: '❌ Failed to update item.', ephemeral: true });
  }
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_EDIT', 
    `Edited item #${itemId}: ${name}`);
  
  await interaction.reply({ 
    content: `✅ Updated item **${emoji} ${name}**`,
    ephemeral: true 
  });
  
  // Refresh to show item detail
  await interaction.deferUpdate().catch(() => {});
  await showItemDetailPanel(interaction, guildId, itemId);
}

// ==================== BUTTON HANDLERS ====================

async function handleShopToggle(interaction, guildId) {
  const settings = getItemSettings(guildId);
  updateItemSettings(guildId, { shopEnabled: !settings.shopEnabled });
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'SHOP_TOGGLE', 
    `Shop ${!settings.shopEnabled ? 'enabled' : 'disabled'}`);
  
  await interaction.deferUpdate();
  await showItemsPanel(interaction, guildId);
}

async function handleDeleteItem(interaction, guildId, itemId) {
  const item = getShopItem(guildId, itemId);
  if (!item) {
    return interaction.reply({ content: '❌ Item not found!', ephemeral: true });
  }
  
  deleteShopItem(guildId, itemId);
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_DELETE', 
    `Deleted item: ${item.name}`);
  
  await interaction.reply({ 
    content: `✅ Deleted item **${item.emoji} ${item.name}**`,
    ephemeral: true 
  });
  
  await interaction.deferUpdate().catch(() => {});
  await showManageItemsPanel(interaction, guildId, 0);
}

async function handleToggleItem(interaction, guildId, itemId) {
  const item = getShopItem(guildId, itemId);
  if (!item) {
    return interaction.reply({ content: '❌ Item not found!', ephemeral: true });
  }
  
  updateShopItem(guildId, itemId, { enabled: !item.enabled });
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_TOGGLE', 
    `${!item.enabled ? 'Added to shop' : 'Removed from shop'}: ${item.name}`);
  
  await interaction.deferUpdate();
  await showItemDetailPanel(interaction, guildId, itemId);
}

async function handleToggleUsable(interaction, guildId, itemId) {
  const item = getShopItem(guildId, itemId);
  if (!item) {
    return interaction.reply({ content: '❌ Item not found!', ephemeral: true });
  }
  
  const currentUsable = item.usable !== 0;
  updateShopItem(guildId, itemId, { usable: currentUsable ? 0 : 1 });
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEM_USABLE_TOGGLE', 
    `${currentUsable ? 'Disabled' : 'Enabled'} use for item: ${item.name}`);
  
  await interaction.deferUpdate();
  await showItemDetailPanel(interaction, guildId, itemId);
}

async function handleInitDefaults(interaction, guildId) {
  initializeDefaultItems(guildId);
  
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'ITEMS_INIT', 
    'Initialized default shop items');
  
  await interaction.reply({ 
    content: '✅ Added default starter items to the shop!',
    ephemeral: true 
  });
  
  await interaction.deferUpdate().catch(() => {});
  await showItemsPanel(interaction, guildId);
}

async function handlePageNav(interaction, guildId, direction) {
  const stateKey = `${guildId}-${interaction.user.id}`;
  const state = paginationState.get(stateKey) || { page: 0, category: null };
  
  const newPage = Math.max(0, state.page + direction);
  
  await interaction.deferUpdate();
  await showManageItemsPanel(interaction, guildId, newPage, state.category);
}

async function handleItemSelect(interaction, guildId) {
  const itemId = parseInt(interaction.values[0]);
  
  await interaction.deferUpdate();
  await showItemDetailPanel(interaction, guildId, itemId);
}

async function handleCategoryFilter(interaction, guildId) {
  const category = interaction.values[0] === 'all' ? null : interaction.values[0];
  
  await interaction.deferUpdate();
  await showManageItemsPanel(interaction, guildId, 0, category);
}

// ==================== HELPERS ====================

function getCategoryEmoji(category) {
  const emojis = {
    protection: '🛡️',
    boost: '⚡',
    utility: '🔧',
    consumable: '🎁',
    special: '✨'
  };
  return emojis[category] || '📦';
}

// ==================== FULFILLMENT PANEL ====================

// Store fulfillment pagination state
const fulfillmentPaginationState = new Map();

async function showFulfillmentsPanel(interaction, guildId, page = 0) {
  const pending = getPendingFulfillments(guildId);
  const totalPages = Math.max(1, Math.ceil(pending.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const pageRequests = pending.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  
  // Store pagination state
  const stateKey = `${guildId}-${interaction.user.id}-fulfill`;
  fulfillmentPaginationState.set(stateKey, { page: currentPage });
  
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('📋 Service Item Fulfillments')
    .setDescription(pending.length === 0 
      ? '✅ No pending fulfillment requests!\n\nWhen users purchase service items (custom emoji, nickname change, etc.), their requests will appear here.'
      : `**${pending.length} pending request${pending.length !== 1 ? 's' : ''}** awaiting fulfillment.`)
    .setFooter({ text: `Page ${currentPage + 1}/${totalPages}` });
  
  const rows = [];
  
  if (pageRequests.length > 0) {
    let description = embed.data.description + '\n\n';
    
    for (const req of pageRequests) {
      const timestamp = Math.floor(req.created_at / 1000);
      const effectName = getEffectTypeName(req.effect_type);
      description += `**#${req.id}** • <@${req.user_id}>\n`;
      description += `📦 **${req.item_name}** (${effectName})\n`;
      description += `⏰ Requested <t:${timestamp}:R>\n`;
      if (req.user_notes) {
        description += `💬 Notes: ${req.user_notes}\n`;
      }
      description += '\n';
    }
    
    embed.setDescription(description);
    
    // Add action buttons for each request
    for (const req of pageRequests.slice(0, 3)) { // Max 3 requests with buttons due to Discord limits
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`items_complete_${req.id}`)
            .setLabel(`✅ Complete #${req.id}`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`items_refund_${req.id}`)
            .setLabel(`💰 Refund #${req.id}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`items_cancel_${req.id}`)
            .setLabel(`❌ Cancel #${req.id}`)
            .setStyle(ButtonStyle.Danger)
        );
      rows.push(actionRow);
    }
  }
  
  // Navigation and back buttons
  const navRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('items_fulfill_prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('items_fulfill_next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('▶️')
        .setDisabled(currentPage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('back_items')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔙')
    );
  rows.push(navRow);
  
  await interaction.editReply({ embeds: [embed], components: rows });
}

async function handleFulfillmentPageNav(interaction, guildId, direction) {
  const stateKey = `${guildId}-${interaction.user.id}-fulfill`;
  const state = fulfillmentPaginationState.get(stateKey) || { page: 0 };
  
  const newPage = Math.max(0, state.page + direction);
  
  await interaction.deferUpdate();
  await showFulfillmentsPanel(interaction, guildId, newPage);
}

async function handleCompleteFulfillment(interaction, guildId, requestId) {
  const request = getFulfillmentRequest(requestId);
  
  if (!request) {
    return interaction.reply({ content: '❌ Request not found!', ephemeral: true });
  }
  
  if (request.status !== 'pending') {
    return interaction.reply({ content: '❌ This request has already been processed!', ephemeral: true });
  }
  
  completeFulfillment(requestId, interaction.user.id, 'Fulfilled by admin');
  
  await logAdminAction(interaction, guildId, 'Fulfilled Service Item', `Completed request #${requestId} for <@${request.user_id}>: ${request.item_name}`);
  
  await interaction.deferUpdate();
  await showFulfillmentsPanel(interaction, guildId, 0);
}

async function handleCancelFulfillment(interaction, guildId, requestId, refund = false) {
  const request = getFulfillmentRequest(requestId);
  
  if (!request) {
    return interaction.reply({ content: '❌ Request not found!', ephemeral: true });
  }
  
  if (request.status !== 'pending') {
    return interaction.reply({ content: '❌ This request has already been processed!', ephemeral: true });
  }
  
  // Get the item to find the price for refund
  if (refund) {
    const item = getShopItem(guildId, request.item_id);
    if (item) {
      await addMoney(guildId, request.user_id, item.price, `Refund for ${request.item_name}`);
    }
  }
  
  cancelFulfillment(requestId, interaction.user.id, refund ? 'Cancelled with refund' : 'Cancelled by admin');
  
  const action = refund ? 'Refunded Service Item' : 'Cancelled Service Item';
  await logAdminAction(interaction, guildId, action, `${refund ? 'Refunded and cancelled' : 'Cancelled'} request #${requestId} for <@${request.user_id}>: ${request.item_name}`);
  
  await interaction.deferUpdate();
  await showFulfillmentsPanel(interaction, guildId, 0);
}

// Get effect type name (for fulfillment display)
function getEffectTypeName(effectType) {
  const names = {
    'service_custom_emoji': '🎨 Custom Emoji',
    'service_nickname': '📝 Nickname Change',
    'service_custom_role': '🏷️ Custom Role',
    'service_custom_color': '🌈 Custom Color',
    'service_other': '✨ Special Service',
    'cosmetic': '🏆 Cosmetic'
  };
  return names[effectType] || effectType || 'Unknown';
}

// ==================== TICKET SETTINGS ====================

async function showTicketSettingsPanel(interaction, guildId) {
  const settings = getItemSettings(guildId);
  const guild = interaction.guild;
  
  // Get category and log channel names for display
  const ticketCategoryName = settings.ticketCategoryId 
    ? guild.channels.cache.get(settings.ticketCategoryId)?.name || 'Not Found (deleted?)' 
    : 'Not Set';
  const ticketLogName = settings.ticketLogChannelId 
    ? `<#${settings.ticketLogChannelId}>` 
    : 'Not Set';
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎫 Ticket Settings')
    .setDescription('Configure where service item tickets are created and logged.')
    .addFields(
      { name: '📁 Ticket Category', value: ticketCategoryName, inline: true },
      { name: '📋 Log Channel', value: ticketLogName, inline: true }
    )
    .setFooter({ text: 'Use the menus below to configure ticket settings' });
  
  // Get categories for select menu
  const categories = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .map(c => ({ label: c.name.substring(0, 100), value: c.id }))
    .slice(0, 24);
  
  // Add "None" option at the start
  categories.unshift({ label: '❌ No Category (create at root)', value: 'none' });
  
  const categorySelect = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_ticket_category')
        .setPlaceholder('Select ticket category...')
        .addOptions(categories)
    );
  
  // Get text channels for log select
  const textChannels = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText)
    .map(c => ({ label: `#${c.name}`.substring(0, 100), value: c.id }))
    .slice(0, 24);
  
  textChannels.unshift({ label: '❌ No Logging', value: 'none' });
  
  const logSelect = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('items_ticket_log')
        .setPlaceholder('Select log channel...')
        .addOptions(textChannels)
    );
  
  const backRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('back_items')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  
  await interaction.editReply({ embeds: [embed], components: [categorySelect, logSelect, backRow] });
}

async function handleTicketCategorySelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const value = interaction.values[0];
  const categoryId = value === 'none' ? null : value;
  
  updateItemSettings(guildId, { ticketCategoryId: categoryId });
  
  const categoryName = categoryId 
    ? interaction.guild.channels.cache.get(categoryId)?.name || 'Unknown'
    : 'None';
  
  await logAdminAction(interaction, guildId, 'Updated Ticket Category', `Set ticket category to: ${categoryName}`);
  
  await showTicketSettingsPanel(interaction, guildId);
}

async function handleTicketLogSelect(interaction, guildId) {
  await interaction.deferUpdate();
  
  const value = interaction.values[0];
  const channelId = value === 'none' ? null : value;
  
  updateItemSettings(guildId, { ticketLogChannelId: channelId });
  
  const channelName = channelId 
    ? `#${interaction.guild.channels.cache.get(channelId)?.name || 'Unknown'}`
    : 'Disabled';
  
  await logAdminAction(interaction, guildId, 'Updated Ticket Log Channel', `Set ticket log to: ${channelName}`);
  
  await showTicketSettingsPanel(interaction, guildId);
}

// Export for use in admin.js
module.exports = {
  handleInteraction,
  showItemsPanel,
  BUTTON_IDS,
  MODAL_IDS,
  SELECT_IDS
};
