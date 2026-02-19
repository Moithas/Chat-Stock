const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { 
  getPropertySettings, 
  getProperties,
  getUserProperties, 
  getUserPropertyCount,
  getTotalPropertyValue,
  buyRandomProperty,
  buyLevel1Property,
  sellProperty,
  getUserCards,
  useCard,
  canPlayCard,
  setCardCooldown,
  getAllPropertyCooldowns,
  calculateCardEffect,
  getTierName,
  getTierEmoji,
  // Upgrade system
  getUpgradeCosts,
  getPropertyUpgradeStatus,
  checkAndCompleteExpiredUpgrade,
  startUpgradeStage,
  completeUpgradeStage,
  performPropertyUpgrade,
  getEffectivePropertyValue,
  UPGRADE_STAGES
} = require('../property');
const { getPortfolio, calculateStockPrice } = require('../database');

// Import economy functions
let economy;
try {
  economy = require('../economy');
} catch (e) {
  console.log('Economy not available for property system');
}

// Helper to check if economy is enabled (checked at runtime)
function isEconomyEnabled() {
  return economy && economy.isEnabled();
}

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('property')
    .setDescription('Property management panel'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    
    const settings = getPropertySettings(guildId);
    
    if (!settings.enabled) {
      return interaction.reply({ 
        content: '❌ The property system is currently disabled.',
          flags: 64 
      });
    }

    await showPropertyPanel(interaction, guildId, userId, settings);
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getPropertySettings(guildId);

    // Handle property panel buttons
    if (customId.startsWith('property_panel_')) {
      const action = customId.replace('property_panel_', '');

      if (action === 'register') {
        return handleRegisterButton(interaction, guildId, userId, settings);
      }
      if (action === 'buy') {
        return handleBuyButton(interaction, guildId, userId, settings);
      }
      if (action === 'sell') {
        return handleSellButton(interaction, guildId, userId);
      }
      if (action === 'market') {
        return handleMarketButton(interaction, guildId);
      }
      if (action === 'back') {
        return showPropertyPanel(interaction, guildId, userId, settings, true);
      }
      if (action === 'upgrades') {
        return showUpgradesPanel(interaction, guildId, userId, settings);
      }
      // Rent button for specific property: property_panel_rent_<propertyId>
      if (action.startsWith('rent_')) {
        const propertyId = parseInt(action.replace('rent_', ''));
        return handleRentButton(interaction, guildId, userId, settings, propertyId);
      }
      // Upgrade buttons: property_panel_upgrade_<stage>_<ownedPropertyId>
      if (action.startsWith('upgrade_')) {
        const parts = action.replace('upgrade_', '').split('_');
        const stage = parts[0];
        const ownedPropertyId = parseInt(parts[1]);
        return handleUpgradeButton(interaction, guildId, userId, settings, stage, ownedPropertyId);
      }
    }
  },
  handleRentSelect,
  handleSellSelect,
  handleSellConfirm,
  handleSellCancel,
  handleUpgradeSelect
};

// Format remaining time as human-readable string
function formatCooldown(remainingMs) {
  const minutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

async function showPropertyPanel(interaction, guildId, userId, settings, isUpdate = false, isDeferred = false) {
  const userProperties = getUserProperties(guildId, userId);
  const userCards = getUserCards(guildId, userId);
  const propertyCooldowns = getAllPropertyCooldowns(guildId, userId);
  
  // Check and auto-complete any expired upgrade stages (handles bot restarts)
  for (const prop of userProperties) {
    checkAndCompleteExpiredUpgrade(guildId, userId, prop.id, prop.property_id);
  }
  
  let balanceData = { cash: 0, bank: 0, total: 0 };
  if (isEconomyEnabled()) {
    balanceData = await economy.getBalance(guildId, userId);
  }

  // Check if user has the required role (if any)
  const member = interaction.member;
  const hasRequiredRole = !settings.requiredRole || member.roles.cache.has(settings.requiredRole);
  
  // Build the main embed
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🏠 Property Manager')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  // If user doesn't have required role, show registration info
  if (!hasRequiredRole) {
    embed.setDescription(
      `❌ **Registration Required**\n\n` +
      `You need to register to access the property market.\n\n` +
      `🔒 **Required Role:** <@&${settings.requiredRole}>\n` +
      `💰 **Registration Fee:** ${settings.registerPrice.toLocaleString()} ${CURRENCY}\n` +
      `💵 **Your Balance:** ${Math.round(balanceData.total).toLocaleString()} ${CURRENCY}\n\n` +
      `Click the **Register** button below to purchase access!`
    );
    
    const registerRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('property_panel_register')
        .setLabel('Register')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Success)
        .setDisabled(balanceData.total < settings.registerPrice)
    );
    
    if (isDeferred) {
      return await interaction.editReply({ embeds: [embed], components: [registerRow] });
    } else if (isUpdate) {
      return await interaction.update({ embeds: [embed], components: [registerRow] });
    } else {
      return await interaction.reply({ embeds: [embed], components: [registerRow], flags: 64 });
    }
  }
  
  if (userProperties.length === 0) {
    embed.setDescription(`You don't own any properties yet!\n\n💰 **Balance:** ${Math.round(balanceData.total).toLocaleString()} ${CURRENCY}\n💵 **Purchase Fee:** ${settings.purchaseFee.toLocaleString()} ${CURRENCY}\n\nUse the **Buy Property** button below to get started!`);
  } else {
    // Build property list with cooldown timers
    const totalValue = getTotalPropertyValue(guildId, userId);
    let totalRent = 0;
    let totalCards = 0;
    let readyCount = 0;
    
    const propertyList = propertyCooldowns.map((pc, index) => {
      const effectiveValue = pc.property.value + (pc.property.remodel_bonus || 0);
      const rent = Math.round(effectiveValue * (settings.rentPercent / 100));
      totalRent += rent;
      totalCards += pc.property.tier;
      
      let cooldownStatus;
      if (pc.canPlay) {
        cooldownStatus = '✅ Ready';
        readyCount++;
      } else {
        cooldownStatus = `⏱️ ${formatCooldown(pc.remainingMs)}`;
      }
      
      return `**${index + 1}.** ${getTierEmoji(pc.property.tier)} **${pc.property.name}** — ${cooldownStatus}\n` +
             `   💵 ${effectiveValue.toLocaleString()} ${CURRENCY} | 💰 ${rent.toLocaleString()} ${CURRENCY}/rent`;
    }).join('\n\n');
    
    embed.setDescription(`${propertyList}\n\n━━━━━━━━━━━━━━━━━━━━━━`);
    embed.addFields(
      { name: '💰 Balance', value: `${Math.round(balanceData.total).toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '📊 Portfolio Value', value: `${totalValue.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '🏘️ Properties', value: `${userProperties.length}/${settings.propertyLimit}`, inline: true },
      { name: '💵 Total Rent/Day', value: `${totalRent.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '🧧 Wealth Cards', value: `${userCards.length}`, inline: true },
      { name: '✅ Ready', value: `${readyCount}/${userProperties.length}`, inline: true }
    );
  }
  
  // Build button rows
  const rows = [];
  
  // Property buttons row(s) - one button per property (max 25 buttons / 5 per row)
  if (propertyCooldowns.length > 0) {
    let currentRow = new ActionRowBuilder();
    let buttonCount = 0;
    
    for (const pc of propertyCooldowns) {
      if (buttonCount === 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
        buttonCount = 0;
      }
      
      // Max 4 rows for properties (20 buttons), leaving room for action row
      if (rows.length >= 4) break;
      
      const shortName = pc.property.name.length > 15 
        ? pc.property.name.substring(0, 12) + '...' 
        : pc.property.name;
      
      const button = new ButtonBuilder()
        .setCustomId(`property_panel_rent_${pc.property.id}`)
        .setLabel(shortName)
        .setEmoji(pc.canPlay ? '💰' : '⏱️')
        .setStyle(pc.canPlay ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!pc.canPlay || userCards.length === 0);
      
      currentRow.addComponents(button);
      buttonCount++;
    }
    
    if (buttonCount > 0) {
      rows.push(currentRow);
    }
  }
  
  // Action buttons row
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('property_panel_buy')
      .setLabel('Buy Property')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(userProperties.length >= settings.propertyLimit),
    new ButtonBuilder()
      .setCustomId('property_panel_upgrades')
      .setLabel('Upgrades')
      .setEmoji('🔨')
      .setStyle(ButtonStyle.Success)
      .setDisabled(userProperties.length === 0),
    new ButtonBuilder()
      .setCustomId('property_panel_sell')
      .setLabel('Sell Property')
      .setEmoji('💵')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(userProperties.length === 0),
    new ButtonBuilder()
      .setCustomId('property_panel_market')
      .setLabel('Market')
      .setEmoji('🏘️')
      .setStyle(ButtonStyle.Secondary)
  );
  
  rows.push(actionRow);
  
  if (isDeferred) {
    await interaction.editReply({ embeds: [embed], components: rows });
  } else if (isUpdate) {
    await interaction.update({ embeds: [embed], components: rows });
  } else {
    await interaction.reply({ embeds: [embed], components: rows, flags: 64 });
  }
}

async function handleRegisterButton(interaction, guildId, userId, settings) {
  // Check if registration is even required
  if (!settings.requiredRole) {
    return interaction.reply({
      content: '❌ Registration is not required for this server.',
      flags: 64
    });
  }

  // Check if user already has the role
  const member = interaction.member;
  if (member.roles.cache.has(settings.requiredRole)) {
    return interaction.reply({
      content: '✅ You are already registered!',
      flags: 64
    });
  }

  // Check if economy is enabled
  if (!isEconomyEnabled()) {
    return interaction.reply({
      content: '❌ Currency system not available.',
      flags: 64
    });
  }

  await interaction.deferUpdate();

  // Check balance
  const balanceData = await economy.getBalance(guildId, userId);
  if (balanceData.total < settings.registerPrice) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ Insufficient Funds')
      .setDescription(
        `You need **${settings.registerPrice.toLocaleString()}** ${CURRENCY} to register.\n\n` +
        `Your balance: **${Math.round(balanceData.total).toLocaleString()}** ${CURRENCY}`
      );
    
    return interaction.editReply({ embeds: [embed], components: [] });
  }

  // Deduct the registration fee
  await economy.removeFromTotal(guildId, userId, settings.registerPrice, 'Property registration fee');

  // Give the user the role
  try {
    const role = await interaction.guild.roles.fetch(settings.requiredRole);
    if (role) {
      await member.roles.add(role);
    }
  } catch (error) {
    console.error('Error adding registration role:', error);
    // Refund if role assignment fails
    await economy.addMoney(guildId, userId, settings.registerPrice, 'Property registration refund');
    return interaction.editReply({
      content: '❌ Failed to assign registration role. Your funds have been refunded.',
      embeds: [],
      components: []
    });
  }

  // Show success and refresh the panel
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Registration Complete!')
    .setDescription(
      `You have been registered for the property market!\n\n` +
      `💰 **Fee Paid:** ${settings.registerPrice.toLocaleString()} ${CURRENCY}\n` +
      `🎭 **Role Granted:** <@&${settings.requiredRole}>\n\n` +
      `You can now buy and manage properties!`
    );

  await interaction.editReply({ embeds: [embed], components: [] });
  
  // Refresh the panel after a short delay
  setTimeout(async () => {
    try {
      const updatedSettings = getPropertySettings(guildId);
      await showPropertyPanel(interaction, guildId, userId, updatedSettings, false, true);
    } catch (e) {
      // Ignore errors from refreshing
    }
  }, 2000);
}

async function handleBuyButton(interaction, guildId, userId, settings) {
  // Check required role
  if (settings.requiredRole) {
    const member = interaction.member;
    if (!member.roles.cache.has(settings.requiredRole)) {
      return interaction.reply({
        content: `❌ You need the <@&${settings.requiredRole}> role to buy properties!`,
        flags: 64
      });
    }
  }

  // Check property limit
  const currentCount = getUserPropertyCount(guildId, userId);
  if (currentCount >= settings.propertyLimit) {
    return interaction.reply({
      content: `❌ You've reached the property limit of **${settings.propertyLimit}**! Sell a property first.`,
      flags: 64
    });
  }
  
  // Check if economy is enabled and user has enough balance
  if (!isEconomyEnabled()) {
    return interaction.reply({
      content: '❌ Currency system not available.',
      flags: 64
    });
  }
  
  await interaction.deferUpdate();
  
  const balanceData = await economy.getBalance(guildId, userId);
  if (balanceData.cash < settings.purchaseFee) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ Insufficient Funds')
      .setDescription(`You need **${settings.purchaseFee.toLocaleString()}** ${CURRENCY} in cash to buy a property.\n\nYou only have **${balanceData.cash.toLocaleString()}** ${CURRENCY} cash.`);
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('property_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🏠')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return interaction.editReply({ embeds: [embed], components: [backButton] });
  }
  
  // Deduct fee from cash
  await economy.removeMoney(guildId, userId, settings.purchaseFee, 'Property purchase');
  
  // Buy Level 1 property (always starts at Rusty Trailer)
  const property = buyLevel1Property(guildId, userId);
  
  if (!property) {
    // Refund if something went wrong
    await economy.addMoney(guildId, userId, settings.purchaseFee, 'Property refund');
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ Purchase Failed')
      .setDescription('Something went wrong. Your money has been refunded.');
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('property_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🏠')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return interaction.editReply({ embeds: [embed], components: [backButton] });
  }
  
  const effectiveValue = property.value + (property.remodel_bonus || 0);
  const rentAmount = Math.round(effectiveValue * (settings.rentPercent / 100));
  const cardsPerDay = property.tier;
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🏠 Property Purchased!')
    .setDescription(`**${interaction.user.displayName}** is now the proud owner of **${property.name}**!\n\n💡 *Tip: Use the **Upgrades** button to improve your property!*`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Tier', value: `${getTierEmoji(property.tier)} ${getTierName(property.tier)}`, inline: true },
      { name: 'Value', value: `${property.value.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: 'Daily Rent', value: `${rentAmount.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: 'Cards/Day', value: `${cardsPerDay} Wealth Cards`, inline: true },
      { name: 'Cost Paid', value: `${settings.purchaseFee.toLocaleString()} ${CURRENCY}`, inline: true }
    )
    .setFooter({ text: 'Property is ready to collect rent!' });
  
  // Update panel and send public message
  await showPropertyPanel(interaction, guildId, userId, settings, false, true);
  await interaction.channel.send({ embeds: [embed] });
}

async function handleSellButton(interaction, guildId, userId) {
  const userProperties = getUserProperties(guildId, userId);
  const settings = getPropertySettings(guildId);
  
  if (userProperties.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ No Properties')
      .setDescription('You don\'t own any properties to sell!');
    
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('property_panel_back')
        .setLabel('Back to Panel')
        .setEmoji('🏠')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return interaction.update({ embeds: [embed], components: [backButton] });
  }
  
  // Build property list with sell prices
  let propertyList = '';
  userProperties.forEach((prop, index) => {
    const sellPrice = Math.round(prop.value * 0.5);
    propertyList += `**${index + 1}.** ${getTierEmoji(prop.tier)} **${prop.name}**\n`;
    propertyList += `   💵 Value: ${prop.value.toLocaleString()} ${CURRENCY} | 💰 Sell: ${sellPrice.toLocaleString()} ${CURRENCY}\n\n`;
  });
  
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🏠 Sell Property')
    .setDescription(propertyList)
    .setFooter({ text: 'Properties sell for 50% of their value' });
  
  const selectOptions = userProperties.map((prop, index) => {
    const sellPrice = Math.round(prop.value * 0.5);
    return {
      label: prop.name,
      description: `${getTierName(prop.tier)} | Sell for ${sellPrice.toLocaleString()} ${CURRENCY}`,
      value: prop.id.toString(),
      emoji: getTierEmoji(prop.tier)
    };
  });
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('property_sell_select')
    .setPlaceholder('Select a property to sell...')
    .addOptions(selectOptions.slice(0, 25));
  
  const selectRow = new ActionRowBuilder().addComponents(selectMenu);
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('property_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [selectRow, backButton] });
}

// Handle sell property selection - show confirmation
async function handleSellSelect(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const propertyId = parseInt(interaction.values[0]);
  
  // Get property from user's owned properties
  const userProperties = getUserProperties(guildId, userId);
  const propertyToSell = userProperties.find(p => p.id === propertyId);
  
  if (!propertyToSell) {
    return interaction.reply({ content: '❌ Property not found or you don\'t own it.', flags: 64 });
  }
  
  const sellPrice = Math.round(propertyToSell.value * 0.5);
  
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('⚠️ Confirm Sale')
    .setDescription(`Are you sure you want to sell **${propertyToSell.name}**?`)
    .addFields(
      { name: '🏠 Property', value: `${getTierEmoji(propertyToSell.tier)} ${propertyToSell.name}`, inline: true },
      { name: '💵 Original Value', value: `${propertyToSell.value.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '🏦 You\'ll Receive', value: `${sellPrice.toLocaleString()} ${CURRENCY}`, inline: true }
    )
    .setFooter({ text: 'Funds will be deposited directly into your bank' });
  
  const confirmBtn = new ButtonBuilder()
    .setCustomId(`property_sell_confirm_${propertyId}`)
    .setLabel('Confirm Sale')
    .setStyle(ButtonStyle.Danger);
  
  const cancelBtn = new ButtonBuilder()
    .setCustomId('property_sell_cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);
  
  const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
  
  await interaction.update({ embeds: [embed], components: [row] });
}

// Handle sell confirmation
async function handleSellConfirm(interaction, propertyId) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  
  // Get property from user's owned properties
  const userProperties = getUserProperties(guildId, userId);
  const propertyToSell = userProperties.find(p => p.id === propertyId);
  
  if (!propertyToSell) {
    return interaction.reply({ content: '❌ Property not found or you don\'t own it.', flags: 64 });
  }
  
  const sellPrice = Math.round(propertyToSell.value * 0.5);
  
  // Sell the property
  const sold = sellProperty(guildId, userId, propertyToSell.id);
  
  if (!sold) {
    return interaction.reply({
      content: '❌ Failed to sell property. Please try again.',
      flags: 64
    });
  }
  
  // Add money directly to user's bank
  if (isEconomyEnabled()) {
    await economy.addToBank(guildId, userId, sellPrice, 'Property sale');
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🏠 Property Sold!')
    .setDescription(`**${interaction.user.displayName}** sold **${propertyToSell.name}** for **${sellPrice.toLocaleString()}** ${CURRENCY}`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Original Value', value: `${propertyToSell.value.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: 'Sale Price (50%)', value: `${sellPrice.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '🏦 Deposited To', value: 'Bank', inline: true }
    );
  
  // Update panel and send public message
  const settings = getPropertySettings(guildId);
  await showPropertyPanel(interaction, guildId, userId, settings, true);
  await interaction.channel.send({ embeds: [embed] });
}

// Handle sell cancel
async function handleSellCancel(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const settings = getPropertySettings(guildId);
  
  // Just go back to the panel
  return showPropertyPanel(interaction, guildId, userId, settings, true);
}

// ============ UPGRADE SYSTEM ============

// Format time as human-readable
function formatUpgradeTime(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  } else if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else {
    const days = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return h > 0 ? `${days}d ${h}h` : `${days}d`;
  }
}

// Get stage emoji
function getStageEmoji(stage) {
  const emojis = {
    renovate: '🔧',
    remodel: '🏗️',
    expand: '📐',
    upgrade: '⬆️'
  };
  return emojis[stage] || '❓';
}

// Get stage display name
function getStageName(stage) {
  const names = {
    renovate: 'Renovate',
    remodel: 'Remodel',
    expand: 'Expand',
    upgrade: 'Upgrade'
  };
  return names[stage] || stage;
}

// Show the upgrades panel with all properties and their upgrade status
async function showUpgradesPanel(interaction, guildId, userId, settings, isUpdate = false) {
  const userProperties = getUserProperties(guildId, userId);
  
  // Check and auto-complete any expired upgrade stages (handles bot restarts)
  for (const prop of userProperties) {
    checkAndCompleteExpiredUpgrade(guildId, userId, prop.id, prop.property_id);
  }
  
  let balanceData = { cash: 0, bank: 0, total: 0 };
  if (isEconomyEnabled()) {
    balanceData = await economy.getBalance(guildId, userId);
  }
  
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('🔨 Property Upgrades')
    .setDescription('Select a property to upgrade. Each stage costs currency and time.\n\n' +
      '**Stages:** 🔧 Renovate → 🏗️ Remodel → 📐 Expand → ⬆️ Upgrade\n' +
      '━━━━━━━━━━━━━━━━━━━━━━')
    .setFooter({ text: `💰 Balance: ${Math.round(balanceData.total).toLocaleString()} ` })
    .setTimestamp();
  
  // Build property list with upgrade status
  const propertyList = userProperties.map((prop, index) => {
    const status = getPropertyUpgradeStatus(guildId, userId, prop.id);
    const effectiveValue = getEffectivePropertyValue(guildId, userId, prop.id, prop.value);
    const { costs, times } = getUpgradeCosts(prop.property_id);
    
    let statusText = '';
    if (status.isInProgress) {
      const remainingMs = status.stageCompletesAt - Date.now();
      const remainingHours = remainingMs / (1000 * 60 * 60);
      statusText = `⏳ ${getStageName(status.currentStage)} in progress (${formatUpgradeTime(remainingHours)} left)`;
    } else if (status.nextStage) {
      const nextCost = costs[status.nextStage];
      const nextTime = times[status.nextStage];
      if (status.nextStage === 'upgrade' && prop.property_id >= 15) {
        statusText = `✅ **MAX LEVEL** - Fully upgraded!`;
      } else {
        statusText = `${getStageEmoji(status.nextStage)} Ready: **${getStageName(status.nextStage)}** — ${nextCost.toLocaleString()} ${CURRENCY} / ${formatUpgradeTime(nextTime)}`;
      }
    } else {
      statusText = '✅ All stages complete!';
    }
    
    // Show completed stages
    const stages = [];
    if (status.renovateComplete) stages.push('🔧');
    if (status.remodelComplete) stages.push('🏗️');
    if (status.expandComplete) stages.push('📐');
    const stageProgress = stages.length > 0 ? stages.join('') : '○○○';
    
    const remodelBonus = status.remodelValueBonus > 0 ? ` (+${status.remodelValueBonus.toLocaleString()})` : '';
    const taxShelter = status.expandComplete ? ' 🛡️' : '';
    
    return `**${index + 1}.** ${getTierEmoji(prop.tier)} **${prop.name}** [${stageProgress}]${taxShelter}\n` +
           `   💵 ${effectiveValue.toLocaleString()}${remodelBonus} ${CURRENCY}\n` +
           `   ${statusText}`;
  }).join('\n\n');
  
  embed.addFields({ name: 'Your Properties', value: propertyList || 'No properties owned' });
  
  // Build select menu for choosing property to upgrade
  const rows = [];
  
  if (userProperties.length > 0) {
    const upgradeOptions = userProperties
      .filter(prop => {
        const status = getPropertyUpgradeStatus(guildId, userId, prop.id);
        // Can upgrade if not in progress and has a next stage (unless max level upgrade)
        return !status.isInProgress && status.nextStage && 
               !(status.nextStage === 'upgrade' && prop.property_id >= 15);
      })
      .slice(0, 25)
      .map(prop => {
        const status = getPropertyUpgradeStatus(guildId, userId, prop.id);
        const { costs, times } = getUpgradeCosts(prop.property_id);
        const nextCost = costs[status.nextStage];
        const nextTime = times[status.nextStage];
        
        return {
          label: `${prop.name} - ${getStageName(status.nextStage)}`,
          description: `${nextCost.toLocaleString()} ${CURRENCY} / ${formatUpgradeTime(nextTime)}`,
          value: `${status.nextStage}_${prop.id}`,
          emoji: getStageEmoji(status.nextStage)
        };
      });
    
    if (upgradeOptions.length > 0) {
      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('property_upgrade_select')
          .setPlaceholder('🔨 Select an upgrade to start...')
          .addOptions(upgradeOptions)
      );
      rows.push(selectRow);
    }
  }
  
  // Back button
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('property_panel_back')
      .setLabel('Back to Properties')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
  );
  rows.push(backRow);
  
  if (isUpdate) {
    await interaction.update({ embeds: [embed], components: rows });
  } else {
    await interaction.update({ embeds: [embed], components: rows });
  }
}

// Handle upgrade select menu
async function handleUpgradeSelect(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const settings = getPropertySettings(guildId);
  
  const [stage, ownedPropertyIdStr] = interaction.values[0].split('_');
  const ownedPropertyId = parseInt(ownedPropertyIdStr);
  
  // Get the property
  const userProperties = getUserProperties(guildId, userId);
  const property = userProperties.find(p => p.id === ownedPropertyId);
  
  if (!property) {
    return interaction.reply({ content: '❌ Property not found.', flags: 64 });
  }
  
  // Check and auto-complete any expired upgrade first (handles bot restarts)
  const autoCompleted = checkAndCompleteExpiredUpgrade(guildId, userId, ownedPropertyId, property.property_id);
  if (autoCompleted.wasCompleted) {
    // Stage was auto-completed, refresh the panel to show updated status
    return showUpgradesPanel(interaction, guildId, userId, settings, true);
  }
  
  // Get costs
  const { costs, times } = getUpgradeCosts(property.property_id);
  const cost = costs[stage];
  const time = times[stage];
  
  // Check balance
  if (!isEconomyEnabled()) {
    return interaction.reply({ content: '❌ Currency system not available.', flags: 64 });
  }
  
  const balanceData = await economy.getBalance(guildId, userId);
  if (balanceData.total < cost) {
    return interaction.reply({
      content: `❌ Insufficient funds! You need **${cost.toLocaleString()}** ${CURRENCY} but only have **${Math.round(balanceData.total).toLocaleString()}** ${CURRENCY}.`,
      flags: 64
    });
  }
  
  // Deduct cost
  await economy.removeFromTotal(guildId, userId, cost, `Property ${stage}: ${property.name}`);
  
  // Start the upgrade
  const result = startUpgradeStage(guildId, userId, ownedPropertyId, stage, property.property_id);
  
  if (!result.success) {
    // Refund
    await economy.addMoney(guildId, userId, cost, `Upgrade refund: ${property.name}`);
    return interaction.reply({ content: `❌ ${result.error}`, flags: 64 });
  }
  
  // Get benefit description
  let benefitText = '';
  if (stage === 'renovate') {
    benefitText = 'Unlocks Remodel stage';
  } else if (stage === 'remodel') {
    const properties = getProperties(guildId);
    const nextProp = properties.find(p => p.id === property.property_id + 1);
    if (nextProp) {
      const bonus = Math.floor((nextProp.value - property.value) * 0.5);
      benefitText = `+${bonus.toLocaleString()} ${CURRENCY} property value`;
    } else {
      const bonus = Math.floor(property.value * 0.15);
      benefitText = `+${bonus.toLocaleString()} ${CURRENCY} property value (15%)`;
    }
  } else if (stage === 'expand') {
    benefitText = 'Property excluded from wealth tax';
  } else if (stage === 'upgrade') {
    const properties = getProperties(guildId);
    const nextProp = properties.find(p => p.id === property.property_id + 1);
    benefitText = nextProp ? `Upgrades to ${nextProp.name}` : 'Unknown';
  }
  
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`${getStageEmoji(stage)} ${getStageName(stage)} Started!`)
    .setDescription(`**${property.name}** is now being upgraded.`)
    .addFields(
      { name: '💰 Cost', value: `${cost.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '⏱️ Time', value: formatUpgradeTime(time), inline: true },
      { name: '✨ Benefit', value: benefitText, inline: true }
    )
    .setFooter({ text: `Completes at: ${new Date(result.completesAt).toLocaleString()}` })
    .setTimestamp();
  
  await interaction.update({ embeds: [embed], components: [] });
  
  // Auto-complete after timer (schedule completion check)
  setTimeout(async () => {
    const completeResult = completeUpgradeStage(guildId, userId, ownedPropertyId, property.property_id);
    
    // If it was an upgrade stage, perform the actual property upgrade
    if (completeResult.success && stage === 'upgrade') {
      performPropertyUpgrade(guildId, userId, ownedPropertyId, property.property_id);
    }
  }, time * 60 * 60 * 1000 + 1000); // Add 1 second buffer
  
  // After 3 seconds, show the upgrades panel again
  setTimeout(async () => {
    try {
      await showUpgradesPanel(interaction, guildId, userId, settings, false);
    } catch (e) {
      // Interaction may have expired
    }
  }, 3000);
}

// Handle upgrade button click (from property buttons - not currently used)
async function handleUpgradeButton(interaction, guildId, userId, settings, stage, ownedPropertyId) {
  // This is called from button clicks - redirect to the select menu flow
  return showUpgradesPanel(interaction, guildId, userId, settings, true);
}

async function handleList(interaction, guildId, targetUserId, targetUser) {
  const userProperties = getUserProperties(guildId, targetUserId);
  const settings = getPropertySettings(guildId);
  const userCards = getUserCards(guildId, targetUserId);
  const isSelf = targetUserId === interaction.user.id;
  
  if (userProperties.length === 0) {
    const msg = isSelf 
      ? `🏠 You don't own any properties yet! Use \`/property buy\` to purchase one for **${settings.purchaseFee}** ${CURRENCY}.`
      : `🏠 **${targetUser.username}** doesn't own any properties.`;
    return interaction.reply({
      content: msg,
        flags: 64
    });
  }
  
  const totalValue = getTotalPropertyValue(guildId, targetUserId);
  let totalRent = 0;
  let totalCards = 0;
  
  const propertyList = userProperties.map((prop, index) => {
    const effectiveValue = prop.value + (prop.remodel_bonus || 0);
    const rent = Math.round(effectiveValue * (settings.rentPercent / 100));
    const cards = prop.tier;
    totalRent += rent;
    totalCards += cards;
    
    return `**${index + 1}.** ${getTierEmoji(prop.tier)} **${prop.name}**\n` +
           `   💵 Value: ${effectiveValue.toLocaleString()} ${CURRENCY} | 💰 Rent: ${rent.toLocaleString()} ${CURRENCY} | 🧧 Cards: ${cards}/day`;
  }).join('\n\n');
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🏠 ${targetUser.username}'s Property Portfolio`)
    .setDescription(propertyList)
    .addFields(
      { name: '📊 Total Property Value', value: `${totalValue} ${CURRENCY}`, inline: true },
      { name: '💰 Total Prospective Rent', value: `${totalRent} ${CURRENCY}`, inline: true },
      { name: '🏘️ Properties Owned', value: `${userProperties.length}/${settings.propertyLimit}`, inline: true },
      { name: '🧧 Wealth Cards', value: `**${userCards.length}**`, inline: true },
      { name: '📈 Cards Earned/Day', value: `${totalCards}`, inline: true }
    )
    .setFooter({ text: 'Use /property rent to collect rent' });
  
  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleMarketButton(interaction, guildId) {
  const properties = getProperties(guildId);
  const settings = getPropertySettings(guildId);
  
  // Group by tier
  const tiers = [1, 2, 3, 4, 5];
  
  let description = '';
  
  for (const tier of tiers) {
    const tierProps = properties.filter(p => p.tier === tier);
    const tierName = getTierName(tier);
    const emoji = getTierEmoji(tier);
    
    description += `\n**${emoji} ${tierName} (${tier} card${tier > 1 ? 's' : ''}/day)**\n`;
    
    for (const prop of tierProps) {
      const rent = Math.round(prop.value * (settings.rentPercent / 100));
      description += `• ${prop.name} - ${prop.value.toLocaleString()} ${CURRENCY} (Rent: ${rent.toLocaleString()})\n`;
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🏘️ Property Market')
    .setDescription(description)
    .addFields(
      { name: '💵 Purchase Fee', value: `${settings.purchaseFee.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '🏠 Property Limit', value: `${settings.propertyLimit} per player`, inline: true },
      { name: '📈 Rent Rate', value: `${settings.rentPercent}% of value`, inline: true }
    )
    .setFooter({ text: 'Use the Buy Property button to purchase a random property' });
  
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('property_panel_back')
      .setLabel('Back to Panel')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary)
  );
  
  await interaction.update({ embeds: [embed], components: [backButton] });
}

async function handleRent(interaction, guildId, userId, settings) {
  // Check if user has properties
  const userProperties = getUserProperties(guildId, userId);
  if (userProperties.length === 0) {
    return interaction.reply({
      content: '❌ You don\'t own any properties! Use `/property buy` to purchase one.',
        flags: 64
    });
  }
  
  // Check if user has cards
  const cards = getUserCards(guildId, userId);
  if (cards.length === 0) {
    return interaction.reply({
      content: '❌ You need a Wealth Card to collect rent! Cards are distributed daily at midnight.',
        flags: 64
    });
  }
  
  // Get cooldowns for all properties
  const propertyCooldowns = getAllPropertyCooldowns(guildId, userId);
  const readyProperties = propertyCooldowns.filter(pc => pc.canPlay);
  
  // Build property list with cooldown status
  let propertyList = '';
  propertyCooldowns.forEach((pc, index) => {
    const effectiveValue = pc.property.value + (pc.property.remodel_bonus || 0);
    const rent = Math.round(effectiveValue * (settings.rentPercent / 100));
    if (pc.canPlay) {
      propertyList += `**${index + 1}.** ${getTierEmoji(pc.property.tier)} **${pc.property.name}** - ✅ Ready\n`;
      propertyList += `   💵 Rent: ${rent} ${CURRENCY}\n\n`;
    } else {
      const nextAvailableTimestamp = Math.floor((Date.now() + pc.remainingMs) / 1000);
      propertyList += `**${index + 1}.** ${getTierEmoji(pc.property.tier)} **${pc.property.name}** - ⏱️ <t:${nextAvailableTimestamp}:R>\n`;
      propertyList += `   💵 Rent: ${rent} ${CURRENCY}\n\n`;
    }
  });
  
  const embed = new EmbedBuilder()
    .setColor(readyProperties.length > 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🏠 Collect Rent')
    .setDescription(propertyList)
    .addFields(
      { name: '🧧 Wealth Cards', value: `You have **${cards.length}** card${cards.length !== 1 ? 's' : ''}`, inline: true },
      { name: '✅ Ready Properties', value: `**${readyProperties.length}** of **${propertyCooldowns.length}**`, inline: true }
    )
    .setFooter({ text: 'Select a ready property below to collect rent' });
  
  // Build dropdown options (only ready properties)
  if (readyProperties.length === 0) {
    return interaction.reply({
      embeds: [embed],
      content: '⏱️ All your properties are on cooldown!',
      flags: 64
    });
  }
  
  const selectOptions = readyProperties.map((pc, index) => {
    const effectiveValue = pc.property.value + (pc.property.remodel_bonus || 0);
    const rent = Math.round(effectiveValue * (settings.rentPercent / 100));
    return {
      label: pc.property.name,
      description: `${getTierName(pc.property.tier)} | Rent: ${rent} ${CURRENCY}`,
      value: pc.property.id.toString(),
      emoji: getTierEmoji(pc.property.tier)
    };
  });
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('property_rent_select')
    .setPlaceholder('Select a property to collect rent from...')
    .addOptions(selectOptions.slice(0, 25));
  
  const row = new ActionRowBuilder().addComponents(selectMenu);
  
  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

// Handle rent property selection
// Handle rent button click from property panel
async function handleRentButton(interaction, guildId, userId, settings, propertyId) {
  // Get property from user's owned properties
  const userProperties = getUserProperties(guildId, userId);
  const property = userProperties.find(p => p.id === propertyId);
  
  if (!property) {
    return interaction.reply({ content: '❌ Property not found or you don\'t own it.', flags: 64 });
  }
  
  // Check cooldown for THIS property
  const cooldown = canPlayCard(guildId, userId, propertyId);
  if (!cooldown.canPlay) {
    const minutes = Math.ceil(cooldown.remainingMs / 60000);
    return interaction.reply({
      content: `⏱️ **${property.name}** is on cooldown. You can collect rent in **${minutes} minute${minutes !== 1 ? 's' : ''}**.`,
      flags: 64
    });
  }
  
  // Check if user has cards
  const cards = getUserCards(guildId, userId);
  if (cards.length === 0) {
    return interaction.reply({
      content: '❌ You need a Wealth Card to collect rent! Cards are distributed daily at midnight.',
      flags: 64
    });
  }
  
  // Defer the update for async operations
  await interaction.deferUpdate();
  
  const effectiveValue = property.value + (property.remodel_bonus || 0);
  const rentAmount = Math.round(effectiveValue * (settings.rentPercent / 100));
  
  // Get user's financial data for card calculations
  let userBalance = 0;
  if (isEconomyEnabled()) {
    const balanceData = await economy.getBalance(guildId, userId);
    userBalance = balanceData.cash + balanceData.bank;
  }
  
  // Calculate portfolio value
  const portfolio = getPortfolio(userId);
  let portfolioValue = 0;
  for (const stock of portfolio) {
    const price = calculateStockPrice(stock.stock_user_id);
    portfolioValue += price * stock.shares;
  }
  
  const propertyValue = getTotalPropertyValue(guildId, userId);
  
  // Draw random card from user's available cards
  const cardIndex = Math.floor(Math.random() * cards.length);
  const drawnCard = cards[cardIndex];
  
  // Calculate card effect
  const effect = calculateCardEffect(drawnCard, rentAmount, userBalance, portfolioValue, propertyValue);
  
  // Use the card and set cooldown for THIS property
  useCard(drawnCard.id);
  setCardCooldown(guildId, userId, propertyId);
  
  // Calculate total payout (rent is always paid, card effect is bonus/penalty)
  const totalPayout = rentAmount + effect.amount;
  
  // Apply to economy balance (handleRentButton)
  if (isEconomyEnabled()) {
    if (totalPayout >= 0) {
      await economy.addMoney(guildId, userId, totalPayout, 'Property rent');
    } else {
      // Apply loss as fine (can go negative)
      await economy.applyFine(guildId, userId, Math.abs(totalPayout), 'Property loss');
    }
  }
  
  // Build result embed
  const isPositive = drawnCard.type === 'positive';
  const cardEmoji = isPositive ? '🟢' : (drawnCard.type === 'negative' ? '🔴' : '⚪');
  
  // Calculate next available time for this property
  const nextAvailable = new Date(Date.now() + settings.cardCooldownMinutes * 60 * 1000);
  const nextAvailableTimestamp = Math.floor(nextAvailable.getTime() / 1000);
  
  // Format the effect amount with sign
  const effectStr = effect.amount >= 0 ? `+${effect.amount.toLocaleString()}` : effect.amount.toLocaleString();
  const totalStr = totalPayout >= 0 ? `+${totalPayout.toLocaleString()}` : totalPayout.toLocaleString();
  
  const embed = new EmbedBuilder()
    .setColor(totalPayout >= 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${cardEmoji} ${drawnCard.name}`)
    .setDescription(`**${interaction.user.displayName}** collected rent!\n\n*"${drawnCard.flavor}"*`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '🏠 Property', value: `**${property.name}**`, inline: true },
      { name: '⏱️ Next Rent', value: `<t:${nextAvailableTimestamp}:R>`, inline: true },
      { name: '🧧 Cards Left', value: `**${cards.length - 1}**`, inline: true },
      { name: '💵 Base Rent', value: `+${rentAmount.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: `${cardEmoji} Card Effect`, value: `${effectStr} ${CURRENCY}`, inline: true },
      { name: '💰 Total', value: `**${totalStr}** ${CURRENCY}`, inline: true },
      { name: '📝 Effect Details', value: effect.description, inline: false }
    );
  
  // Check if user is actually in debt after transaction
  if (isEconomyEnabled()) {
    const newBalance = await economy.getBalance(guildId, userId);
    if (newBalance.cash < 0) {
      embed.addFields({
        name: '⚠️ Warning',
        value: 'This transaction has put you into debt!',
        inline: false
      });
    }
  }
  
  // Update the ephemeral panel to show new state, and send public result
  await showPropertyPanel(interaction, guildId, userId, settings, false, true);
  await interaction.channel.send({ embeds: [embed] });
}

// Handle rent property selection from dropdown (legacy)
async function handleRentSelect(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const propertyId = parseInt(interaction.values[0]);
  
  const settings = getPropertySettings(guildId);
  
  // Get property from user's owned properties (the ID is from owned_properties table)
  const userProperties = getUserProperties(guildId, userId);
  const property = userProperties.find(p => p.id === propertyId);
  
  if (!property) {
    return interaction.update({ content: '❌ Property not found or you don\'t own it.', embeds: [], components: [] });
  }
  
  // Check cooldown for THIS property
  const cooldown = canPlayCard(guildId, userId, propertyId);
  if (!cooldown.canPlay) {
    const minutes = Math.ceil(cooldown.remainingMs / 60000);
    return interaction.update({
      content: `⏱️ **${property.name}** is on cooldown. You can collect rent in **${minutes} minute${minutes !== 1 ? 's' : ''}**.`,
      embeds: [],
      components: []
    });
  }
  
  // Check if user has cards
  const cards = getUserCards(guildId, userId);
  if (cards.length === 0) {
    return interaction.update({
      content: '❌ You need a Wealth Card to collect rent! Cards are distributed daily at midnight.',
      embeds: [],
      components: []
    });
  }
  
  // Defer the update for async operations
  await interaction.deferUpdate();
  
  const effectiveValue = property.value + (property.remodel_bonus || 0);
  const rentAmount = Math.round(effectiveValue * (settings.rentPercent / 100));
  
  // Get user's financial data for card calculations
  let userBalance = 0;
  if (isEconomyEnabled()) {
    const balanceData = await economy.getBalance(guildId, userId);
    userBalance = balanceData.cash + balanceData.bank;
  }
  
  // Calculate portfolio value
  const portfolio = getPortfolio(userId);
  let portfolioValue = 0;
  for (const stock of portfolio) {
    const price = calculateStockPrice(stock.stock_user_id);
    portfolioValue += price * stock.shares;
  }
  
  const propertyValue = getTotalPropertyValue(guildId, userId);
  
  // Draw random card from user's available cards
  const cardIndex = Math.floor(Math.random() * cards.length);
  const drawnCard = cards[cardIndex];
  
  // Calculate card effect
  const effect = calculateCardEffect(drawnCard, rentAmount, userBalance, portfolioValue, propertyValue);
  
  // Use the card and set cooldown for THIS property
  useCard(drawnCard.id);
  setCardCooldown(guildId, userId, propertyId);
  
  // Calculate total payout (rent is always paid, card effect is bonus/penalty)
  const totalPayout = rentAmount + effect.amount;
  
  // Apply to economy balance (handleRentSelect)
  if (isEconomyEnabled()) {
    if (totalPayout >= 0) {
      await economy.addMoney(guildId, userId, totalPayout, 'Property rent');
    } else {
      // Apply loss as fine (can go negative)
      await economy.applyFine(guildId, userId, Math.abs(totalPayout), 'Property loss');
    }
  }
  
  // Build result embed
  const isPositive = drawnCard.type === 'positive';
  const cardEmoji = isPositive ? '🟢' : (drawnCard.type === 'negative' ? '🔴' : '⚪');
  
  // Calculate next available time for this property
  const nextAvailable = new Date(Date.now() + settings.cardCooldownMinutes * 60 * 1000);
  const nextAvailableTimestamp = Math.floor(nextAvailable.getTime() / 1000);
  
  // Format the effect amount with sign
  const effectStr = effect.amount >= 0 ? `+${effect.amount.toLocaleString()}` : effect.amount.toLocaleString();
  const totalStr = totalPayout >= 0 ? `+${totalPayout.toLocaleString()}` : totalPayout.toLocaleString();
  
  const embed = new EmbedBuilder()
    .setColor(totalPayout >= 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${cardEmoji} ${drawnCard.name}`)
    .setDescription(`**${interaction.user.displayName}** collected rent!\n\n*"${drawnCard.flavor}"*`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '🏠 Property', value: `**${property.name}**`, inline: true },
      { name: '⏱️ Next Rent', value: `<t:${nextAvailableTimestamp}:R>`, inline: true },
      { name: '🧧 Cards Left', value: `**${cards.length - 1}**`, inline: true },
      { name: '💵 Base Rent', value: `+${rentAmount.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: `${cardEmoji} Card Effect`, value: `${effectStr} ${CURRENCY}`, inline: true },
      { name: '💰 Total', value: `**${totalStr}** ${CURRENCY}`, inline: true },
      { name: '📝 Effect Details', value: effect.description, inline: false }
    );
  
  // Check if user is actually in debt after transaction
  if (isEconomyEnabled()) {
    const newBalance = await economy.getBalance(guildId, userId);
    if (newBalance.cash < 0) {
      embed.addFields({
        name: '⚠️ Warning',
        value: 'This transaction has put you into debt!',
        inline: false
      });
    }
  }
  
  // Clear the ephemeral selection menu and send public result
  await interaction.deleteReply();
  await interaction.channel.send({ embeds: [embed] });
}
