// Admin Property Panel - Property and Card settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const { logAdminAction } = require('../admin');

const CURRENCY = '<:babybel:1418824333664452608>';

// Tier names and emojis
const TIER_NAMES = ['', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const TIER_EMOJIS = ['', '⚪', '🟢', '🔵', '🟣', '🟡'];

// Button IDs this module handles
const BUTTON_IDS = [
  'property_toggle', 'property_edit_settings', 'property_manage_cards', 
  'property_set_role', 'property_edit_weights', 'back_property',
  'cards_view_positive', 'cards_view_negative', 'cards_view_neutral', 'cards_add_card',
  'cards_back_to_list', 'cards_give_card', 'cards_take_card', 'takecard_back'
];
const BUTTON_PREFIXES = ['card_edit_', 'card_delete_', 'takecard_remove_'];
const MODAL_IDS = ['modal_property_settings', 'modal_add_card', 'modal_tier_weights'];
const MODAL_PREFIXES = ['modal_edit_card_'];
const SELECT_IDS = ['property_role_select', 'givecard_user_select', 'givecard_card_select', 'takecard_user_select', 'takecard_card_select'];
const SELECT_PREFIXES = ['card_select_'];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle buttons
  if (interaction.isButton()) {
    // Check for static IDs or dynamic prefixes
    const isStaticButton = BUTTON_IDS.includes(customId);
    const isDynamicButton = BUTTON_PREFIXES.some(prefix => customId.startsWith(prefix));
    
    if (!isStaticButton && !isDynamicButton) return false;
    
    try {
      if (customId === 'property_toggle') {
        const { getPropertySettings, updatePropertySettings } = require('../property');
        const settings = getPropertySettings(guildId);
        updatePropertySettings(guildId, { enabled: !settings.enabled });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled properties ${!settings.enabled ? 'ON' : 'OFF'}`);
        await interaction.deferUpdate();
        await showPropertyPanel(interaction, guildId);
      }
      else if (customId === 'property_edit_settings') {
        const { getPropertySettings } = require('../property');
        const settings = getPropertySettings(guildId);
        const modal = createPropertySettingsModal(settings);
        await interaction.showModal(modal);
      }
      else if (customId === 'property_manage_cards') {
        await interaction.deferUpdate();
        await showCardListPanel(interaction, guildId);
      }
      else if (customId === 'property_set_role') {
        const roleSelect = createPropertyRoleSelect();
        await interaction.reply({
          content: '🎫 Select the required role for property access (or leave empty for no requirement):',
          components: [roleSelect],
          flags: 64
        });
      }
      else if (customId === 'property_edit_weights') {
        const { getTierWeights } = require('../property');
        let weights;
        try {
          weights = getTierWeights(guildId);
        } catch {
          weights = { 1: 35, 2: 25, 3: 20, 4: 12, 5: 8 };
        }
        const modal = createTierWeightsModal(weights);
        await interaction.showModal(modal);
      }
      else if (customId === 'back_property') {
        await interaction.deferUpdate();
        await showPropertyPanel(interaction, guildId);
      }
      else if (customId === 'cards_view_positive') {
        await interaction.deferUpdate();
        await showCardsOfType(interaction, guildId, 'positive');
      }
      else if (customId === 'cards_view_negative') {
        await interaction.deferUpdate();
        await showCardsOfType(interaction, guildId, 'negative');
      }
      else if (customId === 'cards_view_neutral') {
        await interaction.deferUpdate();
        await showCardsOfType(interaction, guildId, 'neutral');
      }
      else if (customId === 'cards_add_card') {
        const modal = createAddCardModal();
        await interaction.showModal(modal);
      }
      else if (customId === 'cards_back_to_list') {
        await interaction.deferUpdate();
        await showCardListPanel(interaction, guildId);
      }
      else if (customId === 'cards_give_card') {
        await interaction.deferUpdate();
        await showGiveCardPanel(interaction, guildId);
      }
      else if (customId === 'cards_take_card') {
        await interaction.deferUpdate();
        await showTakeCardPanel(interaction, guildId);
      }
      else if (customId === 'takecard_back') {
        await interaction.deferUpdate();
        await showCardListPanel(interaction, guildId);
      }
      // Dynamic card edit button
      else if (customId.startsWith('card_edit_')) {
        const cardId = parseInt(customId.replace('card_edit_', ''));
        const { getCards } = require('../property');
        const cards = getCards(guildId);
        const card = cards.find(c => c.id === cardId);
        if (card) {
          const modal = createEditCardModal(card);
          await interaction.showModal(modal);
        }
      }
      // Dynamic card delete button
      else if (customId.startsWith('card_delete_')) {
        const cardId = parseInt(customId.replace('card_delete_', ''));
        const { deleteCard, getCards } = require('../property');
        const cards = getCards(guildId);
        const card = cards.find(c => c.id === cardId);
        if (card) {
          deleteCard(guildId, cardId);
          logAdminAction(guildId, interaction.user.id, interaction.user.username, `Deleted card "${card.name}"`);
          await interaction.deferUpdate();
          await showCardsOfType(interaction, guildId, card.type);
        }
      }
      // Dynamic remove card from user button
      else if (customId.startsWith('takecard_remove_')) {
        const userCardId = parseInt(customId.replace('takecard_remove_', ''));
        const { removeCard } = require('../property');
        removeCard(userCardId);
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Removed card (user_card_id: ${userCardId}) from user`);
        await interaction.deferUpdate();
        await showTakeCardPanel(interaction, guildId);
      }
      return true;
    } catch (err) {
      console.error('[Admin-Property] Button error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  // Handle string select menu (card select)
  if (interaction.isStringSelectMenu()) {
    const isDynamicSelect = SELECT_PREFIXES.some(prefix => customId.startsWith(prefix));
    const isStaticSelect = SELECT_IDS.includes(customId);
    if (!isDynamicSelect && !isStaticSelect) return false;
    
    try {
      if (customId.startsWith('card_select_')) {
        const type = customId.replace('card_select_', '');
        const cardId = parseInt(interaction.values[0]);
        await interaction.deferUpdate();
        await showCardDetailPanel(interaction, guildId, cardId, type);
      }
      else if (customId === 'givecard_card_select') {
        const cardId = parseInt(interaction.values[0]);
        const { grantCard, getCards } = require('../property');
        const cards = getCards(guildId);
        const card = cards.find(c => c.id === cardId);
        
        // We need to get the selected user from the message components
        // For simplicity, store the user in a temp way or use a follow-up approach
        // Let's show a user select after card is picked
        await interaction.deferUpdate();
        await showGiveCardUserSelect(interaction, guildId, cardId);
      }
      else if (customId === 'takecard_user_select') {
        const userId = interaction.values[0];
        await interaction.deferUpdate();
        await showUserCardsToRemove(interaction, guildId, userId);
      }
      return true;
    } catch (err) {
      console.error('[Admin-Property] String Select error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  // Handle user select menu
  if (interaction.isUserSelectMenu()) {
    if (customId !== 'givecard_user_select') return false;
    
    try {
      // Extract card ID from the message embed footer
      const footer = interaction.message.embeds[0]?.footer?.text || '';
      const cardIdMatch = footer.match(/Card ID: (\d+)/);
      if (!cardIdMatch) {
        await interaction.reply({ content: '❌ Could not determine selected card.', flags: 64 });
        return true;
      }
      
      const cardId = parseInt(cardIdMatch[1]);
      const userId = interaction.values[0];
      const { grantCard, getCards } = require('../property');
      const cards = getCards(guildId);
      const card = cards.find(c => c.id === cardId);
      
      grantCard(guildId, userId, cardId);
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Gave card "${card?.name || cardId}" to <@${userId}>`);
      
      await interaction.reply({ content: `✅ Gave **${card?.name || 'Card'}** to <@${userId}>!`, flags: 64 });
      return true;
    } catch (err) {
      console.error('[Admin-Property] User Select error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  // Handle role select menu
  if (interaction.isRoleSelectMenu()) {
    if (!SELECT_IDS.includes(customId)) return false;
    
    try {
      if (customId === 'property_role_select') {
        const { updatePropertySettings } = require('../property');
        const selectedRole = interaction.values.length > 0 ? interaction.values[0] : null;
        
        updatePropertySettings(guildId, { requiredRole: selectedRole });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set property required role to ${selectedRole ? `<@&${selectedRole}>` : 'None'}`);
        await interaction.update({
          content: selectedRole ? `✅ Property required role set to <@&${selectedRole}>` : '✅ Property role requirement removed',
          components: []
        });
      }
      return true;
    } catch (err) {
      console.error('[Admin-Property] Select error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  // Handle modals
  if (interaction.isModalSubmit()) {
    const isStaticModal = MODAL_IDS.includes(customId);
    const isDynamicModal = MODAL_PREFIXES.some(prefix => customId.startsWith(prefix));
    
    if (!isStaticModal && !isDynamicModal) return false;
    
    try {
      if (customId === 'modal_property_settings') {
        const { updatePropertySettings } = require('../property');
        const purchaseFee = parseInt(interaction.fields.getTextInputValue('purchase_fee'));
        const propertyLimit = parseInt(interaction.fields.getTextInputValue('property_limit'));
        const rentPercent = parseFloat(interaction.fields.getTextInputValue('rent_percent'));
        const cardCooldown = parseInt(interaction.fields.getTextInputValue('card_cooldown'));
        const negativeOdds = parseInt(interaction.fields.getTextInputValue('negative_odds'));
        
        if (isNaN(purchaseFee) || isNaN(propertyLimit) || isNaN(rentPercent) || isNaN(cardCooldown) || isNaN(negativeOdds)) {
          await interaction.reply({ content: '❌ Invalid property settings. Please enter valid numbers.', flags: 64 });
          return true;
        }
        
        updatePropertySettings(guildId, { 
          purchaseFee, 
          propertyLimit,
          rentPercent,
          cardCooldownMinutes: cardCooldown,
          negativeCardOdds: negativeOdds
        });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated property settings: ${purchaseFee} fee, ${propertyLimit} limit, ${rentPercent}% rent`);
        await interaction.reply({ content: '✅ Property settings updated!', flags: 64 });
      }
      else if (customId === 'modal_add_card') {
        const { createCard } = require('../property');
        const cardName = interaction.fields.getTextInputValue('card_name');
        const cardFlavor = interaction.fields.getTextInputValue('card_flavor');
        const cardType = interaction.fields.getTextInputValue('card_type').toLowerCase();
        const effectType = interaction.fields.getTextInputValue('effect_type').toLowerCase();
        const effectValues = interaction.fields.getTextInputValue('effect_values').split(',').map(v => parseFloat(v.trim()));
        
        if (!['positive', 'negative', 'neutral'].includes(cardType)) {
          await interaction.reply({ content: '❌ Invalid card type. Use: positive, negative, or neutral', flags: 64 });
          return true;
        }
        
        if (!['flat', 'balance', 'portfolio', 'property_value', 'rent_bonus'].includes(effectType)) {
          await interaction.reply({ content: '❌ Invalid effect type. Use: flat, balance, portfolio, property_value, or rent_bonus', flags: 64 });
          return true;
        }
        
        if (effectValues.length !== 2 || effectValues.some(isNaN)) {
          await interaction.reply({ content: '❌ Invalid effect values. Use format: min,max (e.g., 100,500)', flags: 64 });
          return true;
        }
        
        createCard(guildId, {
          name: cardName,
          flavor: cardFlavor,
          type: cardType,
          effectType: effectType,
          minValue: effectValues[0],
          maxValue: effectValues[1]
        });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Created ${cardType} card: ${cardName}`);
        await interaction.reply({ content: `✅ Created ${cardType} card: **${cardName}**`, flags: 64 });
      }
      else if (customId === 'modal_tier_weights') {
        const { updateTierWeights } = require('../property');
        const t1 = parseInt(interaction.fields.getTextInputValue('tier1_weight'));
        const t2 = parseInt(interaction.fields.getTextInputValue('tier2_weight'));
        const t3 = parseInt(interaction.fields.getTextInputValue('tier3_weight'));
        const t4 = parseInt(interaction.fields.getTextInputValue('tier4_weight'));
        const t5 = parseInt(interaction.fields.getTextInputValue('tier5_weight'));
        
        if ([t1, t2, t3, t4, t5].some(isNaN)) {
          await interaction.reply({ content: '❌ All weights must be valid numbers.', flags: 64 });
          return true;
        }
        
        const total = t1 + t2 + t3 + t4 + t5;
        if (total !== 100) {
          await interaction.reply({ content: `❌ Weights must add up to 100%. Current total: ${total}%`, flags: 64 });
          return true;
        }
        
        updateTierWeights(guildId, { 1: t1, 2: t2, 3: t3, 4: t4, 5: t5 });
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated tier weights: T1=${t1}%, T2=${t2}%, T3=${t3}%, T4=${t4}%, T5=${t5}%`);
        await interaction.reply({ content: '✅ Tier weights updated!', flags: 64 });
      }
      else if (customId.startsWith('modal_edit_card_')) {
        const { updateCard, getCards } = require('../property');
        const cardId = parseInt(customId.replace('modal_edit_card_', ''));
        
        const cardName = interaction.fields.getTextInputValue('card_name');
        const cardFlavor = interaction.fields.getTextInputValue('card_flavor');
        const cardType = interaction.fields.getTextInputValue('card_type').toLowerCase();
        const effectType = interaction.fields.getTextInputValue('effect_type').toLowerCase();
        const effectValues = interaction.fields.getTextInputValue('effect_values').split(',').map(v => parseFloat(v.trim()));
        
        if (!['positive', 'negative', 'neutral'].includes(cardType)) {
          await interaction.reply({ content: '❌ Invalid card type. Use: positive, negative, or neutral', flags: 64 });
          return true;
        }
        
        if (!['flat', 'balance', 'portfolio', 'property_value', 'rent_bonus'].includes(effectType)) {
          await interaction.reply({ content: '❌ Invalid effect type. Use: flat, balance, portfolio, property_value, or rent_bonus', flags: 64 });
          return true;
        }
        
        if (effectValues.length !== 2 || effectValues.some(isNaN)) {
          await interaction.reply({ content: '❌ Invalid effect values. Use format: min,max (e.g., 100,500)', flags: 64 });
          return true;
        }
        
        updateCard(guildId, cardId, {
          name: cardName,
          flavor: cardFlavor,
          type: cardType,
          effect_type: effectType,
          min_value: effectValues[0],
          max_value: effectValues[1]
        });
        
        logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated card #${cardId}: ${cardName}`);
        await interaction.reply({ content: `✅ Updated card: **${cardName}**`, flags: 64 });
      }
      return true;
    } catch (err) {
      console.error('[Admin-Property] Modal error:', err);
      await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
      return true;
    }
  }
  
  return false;
}

// ==================== PROPERTY PANEL ====================
async function showPropertyPanel(interaction, guildId) {
  const { getPropertySettings, getProperties } = require('../property');
  const settings = getPropertySettings(guildId);
  const properties = getProperties(guildId);
  
  // Count properties by tier
  const tierCounts = [0, 0, 0, 0, 0, 0];
  properties.forEach(p => tierCounts[p.tier]++);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🏠 Property Settings')
    .setDescription('Configure the property system and wealth cards')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💰 Purchase Fee', value: (settings.purchaseFee || 5000).toLocaleString(), inline: true },
      { name: '🏢 Property Limit', value: String(settings.propertyLimit || 3), inline: true },
      { name: '📊 Rent %', value: `${settings.rentPercent || 1}%`, inline: true },
      { name: '⏱️ Card Cooldown', value: `${settings.cardCooldownMinutes || 120} min`, inline: true },
      { name: '🎯 Negative Odds', value: `${settings.negativeCardOdds || 50}%`, inline: true },
      { name: '📝 Register Price', value: (settings.registerPrice || 10000).toLocaleString(), inline: true },
      { name: '🎫 Required Role', value: settings.requiredRole ? `<@&${settings.requiredRole}>` : 'None', inline: true }
    );

  // Property tier breakdown
  const tierText = [1, 2, 3, 4, 5].map(t => 
    `${TIER_EMOJIS[t]} ${TIER_NAMES[t]}: ${tierCounts[t]} properties`
  ).join('\n');
  embed.addFields({ name: '🏘️ Properties by Tier', value: tierText || 'No properties', inline: false });

  const toggleBtn = new ButtonBuilder()
    .setCustomId('property_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const settingsBtn = new ButtonBuilder()
    .setCustomId('property_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const cardsBtn = new ButtonBuilder()
    .setCustomId('property_manage_cards')
    .setLabel('🃏 Manage Cards')
    .setStyle(ButtonStyle.Primary);

  const roleBtn = new ButtonBuilder()
    .setCustomId('property_set_role')
    .setLabel('🎫 Set Required Role')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, settingsBtn, cardsBtn, roleBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== MODAL BUILDERS ====================
function createPropertySettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_property_settings')
    .setTitle('Property Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('purchase_fee')
          .setLabel('Purchase Fee (one-time cost)')
          .setPlaceholder('5000')
          .setValue(String(settings.purchaseFee || 5000))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('property_limit')
          .setLabel('Max Properties Per User')
          .setPlaceholder('3')
          .setValue(String(settings.propertyLimit || 3))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rent_percent')
          .setLabel('Daily Rent % of Property Value')
          .setPlaceholder('1.0')
          .setValue(String(settings.rentPercent || 1.0))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('card_cooldown')
          .setLabel('Card Cooldown (minutes)')
          .setPlaceholder('120')
          .setValue(String(settings.cardCooldownMinutes || 120))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('negative_odds')
          .setLabel('Negative Card Odds %')
          .setPlaceholder('50')
          .setValue(String(settings.negativeCardOdds || 50))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createPropertyRoleSelect() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('property_role_select')
      .setPlaceholder('Select required role (or none)')
      .setMinValues(0)
      .setMaxValues(1)
  );
}

// ==================== CARD LIST PANEL ====================
async function showCardListPanel(interaction, guildId) {
  const { getCards } = require('../property');
  let cards;
  try {
    cards = getCards(guildId);
  } catch {
    cards = [];
  }
  
  const positiveCards = cards.filter(c => c.type === 'positive');
  const negativeCards = cards.filter(c => c.type === 'negative');
  const neutralCards = cards.filter(c => c.type === 'neutral');
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🃏 Wealth Cards')
    .setDescription('View and manage property wealth cards')
    .addFields(
      { name: '✅ Positive Cards', value: `${positiveCards.length} cards`, inline: true },
      { name: '❌ Negative Cards', value: `${negativeCards.length} cards`, inline: true },
      { name: '⚪ Neutral Cards', value: `${neutralCards.length} cards`, inline: true }
    );

  // Show first few cards of each type
  if (positiveCards.length > 0) {
    const preview = positiveCards.slice(0, 3).map(c => `• ${c.name}`).join('\n');
    embed.addFields({ name: '✅ Positive Preview', value: preview + (positiveCards.length > 3 ? '\n...' : ''), inline: false });
  }
  
  if (negativeCards.length > 0) {
    const preview = negativeCards.slice(0, 3).map(c => `• ${c.name}`).join('\n');
    embed.addFields({ name: '❌ Negative Preview', value: preview + (negativeCards.length > 3 ? '\n...' : ''), inline: false });
  }

  const viewPositiveBtn = new ButtonBuilder()
    .setCustomId('cards_view_positive')
    .setLabel('✅ Positive')
    .setStyle(ButtonStyle.Success);

  const viewNegativeBtn = new ButtonBuilder()
    .setCustomId('cards_view_negative')
    .setLabel('❌ Negative')
    .setStyle(ButtonStyle.Danger);

  const viewNeutralBtn = new ButtonBuilder()
    .setCustomId('cards_view_neutral')
    .setLabel('⚪ Neutral')
    .setStyle(ButtonStyle.Secondary);

  const addCardBtn = new ButtonBuilder()
    .setCustomId('cards_add_card')
    .setLabel('➕ Add')
    .setStyle(ButtonStyle.Primary);

  const giveCardBtn = new ButtonBuilder()
    .setCustomId('cards_give_card')
    .setLabel('🎁 Give')
    .setStyle(ButtonStyle.Primary);

  const takeCardBtn = new ButtonBuilder()
    .setCustomId('cards_take_card')
    .setLabel('✋ Take')
    .setStyle(ButtonStyle.Danger);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_property')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(viewPositiveBtn, viewNegativeBtn, viewNeutralBtn);
  const row2 = new ActionRowBuilder().addComponents(addCardBtn, giveCardBtn, takeCardBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== GIVE CARD PANEL ====================
async function showGiveCardPanel(interaction, guildId) {
  const { getCards } = require('../property');
  const { UserSelectMenuBuilder } = require('discord.js');
  let cards;
  try {
    cards = getCards(guildId);
  } catch {
    cards = [];
  }

  if (cards.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🎁 Give Card')
      .setDescription('❌ No cards exist yet. Create some cards first!');

    const backBtn = new ButtonBuilder()
      .setCustomId('property_manage_cards')
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary);

    await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn)] });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🎁 Give Card to User')
    .setDescription('First, select which card to give:');

  const cardOptions = cards.slice(0, 25).map(card => ({
    label: card.name.substring(0, 100),
    description: `${card.type} - ${card.effect_type}`,
    value: String(card.id),
    emoji: card.type === 'positive' ? '✅' : card.type === 'negative' ? '❌' : '⚪'
  }));

  const cardSelect = new StringSelectMenuBuilder()
    .setCustomId('givecard_card_select')
    .setPlaceholder('Select a card to give...')
    .addOptions(cardOptions);

  const backBtn = new ButtonBuilder()
    .setCustomId('property_manage_cards')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(cardSelect);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== GIVE CARD USER SELECT ====================
async function showGiveCardUserSelect(interaction, guildId, cardId) {
  const { getCards } = require('../property');
  const { UserSelectMenuBuilder } = require('discord.js');
  const cards = getCards(guildId);
  const card = cards.find(c => c.id === cardId);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🎁 Give Card to User')
    .setDescription(`Selected card: **${card?.name || 'Unknown'}**\n\nNow select a user to give this card to:`)
    .setFooter({ text: `Card ID: ${cardId}` });

  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('givecard_user_select')
    .setPlaceholder('Select a user...')
    .setMinValues(1)
    .setMaxValues(1);

  const backBtn = new ButtonBuilder()
    .setCustomId('cards_give_card')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(userSelect);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== TAKE CARD PANEL ====================
async function showTakeCardPanel(interaction, guildId) {
  const { getUsersWithCards } = require('../property');
  let usersWithCards;
  try {
    usersWithCards = getUsersWithCards(guildId);
  } catch {
    usersWithCards = [];
  }

  if (usersWithCards.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('✋ Take Card from User')
      .setDescription('❌ No users currently have any cards.');

    const backBtn = new ButtonBuilder()
      .setCustomId('property_manage_cards')
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary);

    await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn)] });
    return;
  }

  // Fetch usernames from Discord
  const guild = interaction.guild;
  const usersWithNames = await Promise.all(usersWithCards.slice(0, 25).map(async (u) => {
    try {
      const member = await guild.members.fetch(u.userId);
      return { ...u, username: member.user.username, displayName: member.displayName, leftServer: false };
    } catch {
      return { ...u, username: `Unknown`, displayName: `[Left Server]`, leftServer: true };
    }
  }));

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('✋ Take Card from User')
    .setDescription(`Select a user to view their cards:\n\n${usersWithNames.slice(0, 10).map(u => `**${u.displayName}**${u.leftServer ? ' ⚠️' : ''}: ${u.cardCount} card(s)`).join('\n')}`);

  const userOptions = usersWithNames.map(u => ({
    label: u.leftServer ? `[Left Server] (ID: ...${u.userId.slice(-6)})` : u.displayName.substring(0, 100),
    description: `${u.cardCount} card(s)`,
    value: u.userId
  }));

  const userSelect = new StringSelectMenuBuilder()
    .setCustomId('takecard_user_select')
    .setPlaceholder('Select a user...')
    .addOptions(userOptions);

  const backBtn = new ButtonBuilder()
    .setCustomId('property_manage_cards')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(userSelect);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== SHOW USER CARDS TO REMOVE ====================
async function showUserCardsToRemove(interaction, guildId, userId) {
  const { getUserCards, getCards } = require('../property');
  let userCards;
  try {
    userCards = getUserCards(guildId, userId);
  } catch {
    userCards = [];
  }

  const allCards = getCards(guildId);

  if (userCards.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('✋ Take Card from User')
      .setDescription(`<@${userId}> has no cards.`);

    const backBtn = new ButtonBuilder()
      .setCustomId('cards_take_card')
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary);

    await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn)] });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('✋ Take Card from User')
    .setDescription(`<@${userId}>'s cards:\n\nClick a button to remove that card.`);

  // Show cards as buttons (up to 5 per row, max 25)
  const rows = [];
  const cardsToShow = userCards.slice(0, 20);
  
  for (let i = 0; i < cardsToShow.length; i += 5) {
    const chunk = cardsToShow.slice(i, i + 5);
    const row = new ActionRowBuilder();
    
    for (const userCard of chunk) {
      const cardInfo = allCards.find(c => c.id === userCard.card_id);
      const emoji = cardInfo?.type === 'positive' ? '✅' : cardInfo?.type === 'negative' ? '❌' : '⚪';
      
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`takecard_remove_${userCard.id}`)
          .setLabel(`${cardInfo?.name?.substring(0, 20) || 'Card'}`)
          .setEmoji(emoji)
          .setStyle(ButtonStyle.Danger)
      );
    }
    rows.push(row);
  }

  // Add back button
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('takecard_back')
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary)
  );
  rows.push(backRow);

  await interaction.editReply({ embeds: [embed], components: rows.slice(0, 5) });
}

// ==================== SHOW CARDS OF TYPE ====================
async function showCardsOfType(interaction, guildId, type) {
  const { getCards } = require('../property');
  const { StringSelectMenuBuilder } = require('discord.js');
  let cards;
  try {
    cards = getCards(guildId);
  } catch {
    cards = [];
  }
  
  const filteredCards = cards.filter(c => c.type === type);
  const typeEmoji = type === 'positive' ? '✅' : type === 'negative' ? '❌' : '⚪';
  const typeName = type.charAt(0).toUpperCase() + type.slice(1);
  
  const embed = new EmbedBuilder()
    .setColor(type === 'positive' ? 0x2ecc71 : type === 'negative' ? 0xe74c3c : 0x95a5a6)
    .setTitle(`${typeEmoji} ${typeName} Cards`)
    .setDescription(`Showing all ${type} wealth cards\n*Select a card below to edit or delete it*`);

  if (filteredCards.length === 0) {
    embed.addFields({ name: 'No Cards', value: `*No ${type} cards configured yet.*` });
  } else {
    // Show cards in chunks to avoid embed limits
    const chunks = [];
    for (let i = 0; i < filteredCards.length; i += 10) {
      chunks.push(filteredCards.slice(i, i + 10));
    }
    
    for (let i = 0; i < Math.min(chunks.length, 3); i++) {
      const chunk = chunks[i];
      let value = '';
      for (const card of chunk) {
        const tierEmoji = TIER_EMOJIS[card.tier] || '⚪';
        value += `${tierEmoji} **${card.name}**\n`;
        if (card.flavor) value += `   _${card.flavor.substring(0, 50)}${card.flavor.length > 50 ? '...' : ''}_\n`;
      }
      embed.addFields({ 
        name: i === 0 ? `Cards (${filteredCards.length} total)` : '\u200B', 
        value: value || 'None'
      });
    }
    
    if (chunks.length > 3) {
      embed.addFields({ name: '\u200B', value: `*...and ${filteredCards.length - 30} more cards*` });
    }
  }

  const rows = [];

  // Add select menu if there are cards
  if (filteredCards.length > 0) {
    const selectOptions = filteredCards.slice(0, 25).map(card => ({
      label: card.name.substring(0, 100),
      description: card.flavor ? card.flavor.substring(0, 100) : `${card.effect_type} effect`,
      value: String(card.id)
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`card_select_${type}`)
      .setPlaceholder('Select a card to edit/delete...')
      .addOptions(selectOptions);

    rows.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const backBtn = new ButtonBuilder()
    .setCustomId('property_manage_cards')
    .setLabel('◀️ Back to Cards')
    .setStyle(ButtonStyle.Secondary);

  rows.push(new ActionRowBuilder().addComponents(backBtn));

  await interaction.editReply({ embeds: [embed], components: rows });
}

// ==================== CARD DETAIL PANEL ====================
async function showCardDetailPanel(interaction, guildId, cardId, type) {
  const { getCards } = require('../property');
  let cards;
  try {
    cards = getCards(guildId);
  } catch {
    cards = [];
  }

  const card = cards.find(c => c.id === cardId);
  if (!card) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('❌ Card Not Found')
      .setDescription('This card no longer exists.');

    const backBtn = new ButtonBuilder()
      .setCustomId(`cards_view_${type}`)
      .setLabel('◀️ Back')
      .setStyle(ButtonStyle.Secondary);

    await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn)] });
    return;
  }

  const typeEmoji = card.type === 'positive' ? '✅' : card.type === 'negative' ? '❌' : '⚪';
  const tierEmoji = TIER_EMOJIS[card.tier] || '⚪';

  const embed = new EmbedBuilder()
    .setColor(card.type === 'positive' ? 0x2ecc71 : card.type === 'negative' ? 0xe74c3c : 0x95a5a6)
    .setTitle(`${typeEmoji} ${card.name}`)
    .setDescription(card.flavor || '*No flavor text*')
    .addFields(
      { name: '🎴 Type', value: card.type.charAt(0).toUpperCase() + card.type.slice(1), inline: true },
      { name: '⚡ Effect', value: card.effect_type || 'flat', inline: true },
      { name: `${tierEmoji} Tier`, value: String(card.tier || 1), inline: true },
      { name: '📊 Min Value', value: String(card.min_value ?? 0), inline: true },
      { name: '📊 Max Value', value: String(card.max_value ?? 0), inline: true },
      { name: '🆔 Card ID', value: String(card.id), inline: true }
    );

  const editBtn = new ButtonBuilder()
    .setCustomId(`card_edit_${card.id}`)
    .setLabel('✏️ Edit Card')
    .setStyle(ButtonStyle.Primary);

  const deleteBtn = new ButtonBuilder()
    .setCustomId(`card_delete_${card.id}`)
    .setLabel('🗑️ Delete Card')
    .setStyle(ButtonStyle.Danger);

  const backBtn = new ButtonBuilder()
    .setCustomId(`cards_view_${card.type}`)
    .setLabel('◀️ Back to List')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(editBtn, deleteBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== CREATE EDIT CARD MODAL ====================
function createEditCardModal(card) {
  return new ModalBuilder()
    .setCustomId(`modal_edit_card_${card.id}`)
    .setTitle(`Edit Card: ${card.name.substring(0, 30)}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('card_name')
          .setLabel('Card Name')
          .setValue(card.name || '')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('card_flavor')
          .setLabel('Flavor Text')
          .setValue(card.flavor || '')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('card_type')
          .setLabel('Type')
          .setPlaceholder('positive, negative, or neutral')
          .setValue(card.type || 'neutral')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('effect_type')
          .setLabel('Effect Type')
          .setPlaceholder('flat/balance/portfolio/property_value/rent_bonus')
          .setValue(card.effect_type || 'flat')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('effect_values')
          .setLabel('Min/Max Values (e.g., 100,500)')
          .setValue(`${card.min_value ?? 0},${card.max_value ?? 0}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createAddCardModal() {
  return new ModalBuilder()
    .setCustomId('modal_add_card')
    .setTitle('Add Wealth Card')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('card_name')
          .setLabel('Card Name')
          .setPlaceholder('Lucky Day')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('card_flavor')
          .setLabel('Flavor Text')
          .setPlaceholder('Fortune smiles upon you!')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('card_type')
          .setLabel('Type')
          .setPlaceholder('positive, negative, or neutral')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('effect_type')
          .setLabel('Effect Type')
          .setPlaceholder('flat/balance/portfolio/property_value/rent_bonus')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('effect_values')
          .setLabel('Min/Max Values')
          .setPlaceholder('100,500 (or 5,10 for %)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== TIER WEIGHTS PANEL ====================
async function showTierWeightsPanel(interaction, guildId) {
  const { getPropertySettings, getTierWeights } = require('../property');
  const settings = getPropertySettings(guildId);
  let weights;
  try {
    weights = getTierWeights(guildId);
  } catch {
    weights = { 1: 35, 2: 25, 3: 20, 4: 12, 5: 8 };
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎲 Property Tier Weights')
    .setDescription('Configure the drop rates for each property tier')
    .addFields(
      { name: `${TIER_EMOJIS[1]} Tier 1 (Common)`, value: `${weights[1] || 35}%`, inline: true },
      { name: `${TIER_EMOJIS[2]} Tier 2 (Uncommon)`, value: `${weights[2] || 25}%`, inline: true },
      { name: `${TIER_EMOJIS[3]} Tier 3 (Rare)`, value: `${weights[3] || 20}%`, inline: true },
      { name: `${TIER_EMOJIS[4]} Tier 4 (Epic)`, value: `${weights[4] || 12}%`, inline: true },
      { name: `${TIER_EMOJIS[5]} Tier 5 (Legendary)`, value: `${weights[5] || 8}%`, inline: true }
    );

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  embed.setFooter({ text: `Total: ${total}% (should be 100%)` });

  const editBtn = new ButtonBuilder()
    .setCustomId('property_edit_weights')
    .setLabel('⚙️ Edit Weights')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_property')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

function createTierWeightsModal(weights) {
  return new ModalBuilder()
    .setCustomId('modal_tier_weights')
    .setTitle('Tier Drop Weights (must = 100%)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier1_weight')
          .setLabel('Tier 1 (Common) Weight %')
          .setPlaceholder('35')
          .setValue(String(weights[1] || 35))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier2_weight')
          .setLabel('Tier 2 (Uncommon) Weight %')
          .setPlaceholder('25')
          .setValue(String(weights[2] || 25))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier3_weight')
          .setLabel('Tier 3 (Rare) Weight %')
          .setPlaceholder('20')
          .setValue(String(weights[3] || 20))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier4_weight')
          .setLabel('Tier 4 (Epic) Weight %')
          .setPlaceholder('12')
          .setValue(String(weights[4] || 12))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tier5_weight')
          .setLabel('Tier 5 (Legendary) Weight %')
          .setPlaceholder('8')
          .setValue(String(weights[5] || 8))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

module.exports = {
  handleInteraction,
  showPropertyPanel,
  showCardListPanel,
  showTierWeightsPanel
};
