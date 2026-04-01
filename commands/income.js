const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getWorkSettings, canWork, calculateWorkReward, getRandomFlavorText, recordWork, getTotalWorked, getWorkCount } = require('../work');
const { getHuntSettings, canHunt, recordHuntCooldown, recordHuntResult, rollHuntOutcome, rollCurrencyAmount, getHuntStats } = require('../hunt');
const { getDividendSettings, canCollectPassiveIncome, calculatePassiveIncome, recordPassiveIncomeCollection, getTotalPassiveIncomeCollected, getCollectableRoleIncomes, recordRoleIncomeCollection, getTotalRoleIncomeCollected } = require('../dividends');
const { calculateStockPrice, getUser, getDb } = require('../database');
const { addMoney } = require('../economy');
const { getEffectValue, EFFECT_TYPES, getHuntEligibleItems, addToInventory } = require('../items');
const { getLuckyPennyEffect, LP_EFFECT_TYPES, getLuckyPennySettings, canUseLuckyPenny, recordLuckyPennyUse, rollLuckyPenny, applyBuff: applyLpBuff, getActiveLuckyPennyBuffs, LP_EFFECT_EMOJI, INVERSE_EFFECTS } = require('../luckypenny');
const { getCurrency } = require('../admin');
const { applyIncomeMultiplier, getPrestigeEmoji } = require('../prestige');
const { getPetBonusDecimal } = require('../pets');



// Helper to format time remaining
function formatTimeRemaining(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('income')
    .setDescription('View all income sources and collect earnings'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    return showIncomePanel(interaction, guildId, userId);
  }
};

async function showIncomePanel(interaction, guildId, userId, isUpdate = false) {
  const member = interaction.member;
  const userRoleIds = member.roles.cache.map(r => r.id);
  
  // Get settings for all income sources
  const workSettings = getWorkSettings(guildId);
  const lpSettings = getLuckyPennySettings(guildId);
  const huntSettings = getHuntSettings(guildId);
  const collectSettings = getDividendSettings(guildId);
  
  // Check work status (with Lucky Penny cooldown buff)
  const lpWorkCooldown = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.WORK_COOLDOWN);
  const workCooldownReduction = -lpWorkCooldown; // negate: LP -20 (buff) → +20 reduction; LP +20 (debuff) → -20 (increase)
  const workStatus = canWork(guildId, userId, workCooldownReduction);
  const workReady = workStatus.canWork;
  const workTime = workStatus.timeRemaining ? formatTimeRemaining(workStatus.timeRemaining) : null;
  
  // Check Lucky Penny status
  const lpStatus = canUseLuckyPenny(guildId, userId);
  const lpReady = lpStatus.canUse;
  const lpTime = lpStatus.timeRemaining ? formatTimeRemaining(lpStatus.timeRemaining) : null;
  
  // Check hunt status
  const huntStatus = canHunt(guildId, userId);
  const huntReady = huntStatus.canHunt;
  const huntTime = huntStatus.reason ? huntStatus.reason.match(/\*\*(.+?)\*\*/)?.[1] || 'soon' : null;
  
  // Check collect status
  const user = getUser(userId);
  let stockBonusReady = false;
  let stockBonusTime = null;
  let stockBonusAmount = 0;
  
  if (collectSettings.passiveIncomeEnabled && user) {
    const collectStatus = canCollectPassiveIncome(guildId, userId);
    stockBonusReady = collectStatus.canCollect;
    stockBonusTime = collectStatus.timeRemaining ? formatTimeRemaining(collectStatus.timeRemaining) : null;
    
    const db = getDb();
    const sharesResult = db.exec('SELECT SUM(shares) as total FROM stocks WHERE stock_user_id = ? AND owner_id != ?', [userId, userId]);
    const totalSharesOwned = sharesResult.length > 0 && sharesResult[0].values.length > 0 && sharesResult[0].values[0][0] 
      ? sharesResult[0].values[0][0] 
      : 0;
    const stockPrice = calculateStockPrice(userId, guildId);
    stockBonusAmount = calculatePassiveIncome(stockPrice, collectSettings.passiveIncomeRate, totalSharesOwned);
  }
  
  // Check role incomes
  const { collectableIncomes, notReadyIncomes } = getCollectableRoleIncomes(guildId, userId, userRoleIds);
  const roleReady = collectableIncomes.length > 0;
  const totalRoleAmount = collectableIncomes.reduce((sum, r) => sum + r.amount, 0);
  
  // Build the embed
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💵 Income Panel')
    .setDescription('View your available income sources and collect earnings!');
  
  const fields = [];
  
  // Work section
  if (workSettings.enabled) {
    const avgReward = Math.floor((workSettings.minReward + workSettings.maxReward) / 2);
    fields.push({
      name: `💼 Work ${workReady ? '✅' : '⏳'}`,
      value: workReady 
        ? `**Ready!** Earn ${workSettings.minReward}-${workSettings.maxReward} ${getCurrency(guildId)}`
        : `Ready in **${workTime}**`,
      inline: true
    });
  } else {
    fields.push({
      name: '💼 Work ❌',
      value: 'Disabled',
      inline: true
    });
  }
  
  // Lucky Penny section
  if (lpSettings.enabled) {
    fields.push({
      name: `🪙 Lucky Penny ${lpReady ? '✅' : '⏳'}`,
      value: lpReady 
        ? `**Ready!** Try your luck!`
        : `Ready in **${lpTime}**`,
      inline: true
    });
  } else {
    fields.push({
      name: '🪙 Lucky Penny ❌',
      value: 'Disabled',
      inline: true
    });
  }
  
  // Hunt section
  if (huntSettings.enabled) {
    fields.push({
      name: `🏹 Hunt ${huntReady ? '✅' : '⏳'}`,
      value: huntReady 
        ? `**Ready!** Find items, currency, or nothing!`
        : `Not ready yet — ${huntTime}`,
      inline: true
    });
  } else {
    fields.push({
      name: '🏹 Hunt ❌',
      value: 'Disabled',
      inline: true
    });
  }
  
  // Collect section (Stock Bonus)
  if (collectSettings.passiveIncomeEnabled) {
    if (user) {
      fields.push({
        name: `📈 Stock Bonus ${stockBonusReady ? '✅' : '⏳'}`,
        value: stockBonusReady 
          ? `**Ready!** Collect **${stockBonusAmount.toLocaleString()}** ${getCurrency(guildId)}`
          : `Ready in **${stockBonusTime}**`,
        inline: true
      });
    } else {
      fields.push({
        name: '📈 Stock Bonus ❌',
        value: 'Need a stock first',
        inline: true
      });
    }
  } else {
    fields.push({
      name: '📈 Stock Bonus ❌',
      value: 'Disabled',
      inline: true
    });
  }
  
  // Role incomes section
  if (collectableIncomes.length > 0 || notReadyIncomes.length > 0) {
    let roleText = '';
    if (collectableIncomes.length > 0) {
      roleText += collectableIncomes.map(r => `✅ **${r.roleName}**: ${r.amount.toLocaleString()} ${getCurrency(guildId)}`).join('\n');
    }
    if (notReadyIncomes.length > 0) {
      if (roleText) roleText += '\n';
      roleText += notReadyIncomes.map(r => `⏳ **${r.roleName}**: ${formatTimeRemaining(r.timeRemaining)}`).join('\n');
    }
    fields.push({
      name: '🏷️ Role Incomes',
      value: roleText,
      inline: false
    });
  }
  
  embed.addFields(fields);
  
  // Build buttons
  const row1 = new ActionRowBuilder();
  
  // Work button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('income_work')
      .setLabel('💼 Work')
      .setStyle(workReady && workSettings.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!workReady || !workSettings.enabled)
  );
  
  // Lucky Penny button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('income_luckypenny')
      .setLabel('🪙 Lucky Penny')
      .setStyle(lpReady && lpSettings.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!lpReady || !lpSettings.enabled)
  );
  
  // Hunt button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('income_hunt')
      .setLabel('🏹 Hunt')
      .setStyle(huntReady && huntSettings.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!huntReady || !huntSettings.enabled)
  );
  
  // Collect button (combines stock bonus and role incomes)
  const canCollectAnything = (stockBonusReady && stockBonusAmount > 0) || roleReady;
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('income_collect')
      .setLabel('📈 Collect')
      .setStyle(canCollectAnything ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canCollectAnything)
  );
  
  // Refresh button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('income_refresh')
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Primary)
  );
  
  const replyOptions = {
    embeds: [embed],
    components: [row1],
    flags: 64 // Ephemeral
  };
  
  if (isUpdate === 'edit') {
    // Used after deferUpdate + followUp - need to edit the original deferred response
    await interaction.editReply(replyOptions);
  } else if (isUpdate) {
    await interaction.update(replyOptions);
  } else if (interaction.deferred) {
    await interaction.editReply(replyOptions);
  } else {
    await interaction.reply(replyOptions);
  }
}

// Prevent double-click processing
const processingUsers = new Set();

// Handle button interactions
async function handleIncomeButton(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const customId = interaction.customId;
  
  if (customId === 'income_refresh') {
    return showIncomePanel(interaction, guildId, userId, true);
  }
  
  // Prevent double-click on income actions
  if (processingUsers.has(userId)) {
    return interaction.reply({ content: '⏳ Processing your previous action...', flags: 64 });
  }
  processingUsers.add(userId);
  
  try {
    if (customId === 'income_work') {
      return await executeWork(interaction, guildId, userId);
    }
    
    if (customId === 'income_luckypenny') {
      return await executeLuckyPenny(interaction, guildId, userId);
    }
    
    if (customId === 'income_hunt') {
      return await executeHunt(interaction, guildId, userId);
    }
    
    if (customId === 'income_collect') {
      return await executeCollect(interaction, guildId, userId);
    }
  } finally {
    processingUsers.delete(userId);
  }
}

async function executeWork(interaction, guildId, userId) {
  const settings = getWorkSettings(guildId);
  
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Work is disabled on this server.', flags: 64 });
  }
  
  // Apply LP cooldown buff to work
  const lpWorkCdBuff = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.WORK_COOLDOWN);
  const workCdReduction = -lpWorkCdBuff; // negate: LP -20 (buff) → +20 reduction
  const { canWork: canDoWork, reason } = canWork(guildId, userId, workCdReduction);
  if (!canDoWork) {
    return interaction.reply({ content: `⏳ ${reason}`, flags: 64 });
  }
  
  await interaction.deferUpdate();
  
  const baseAmount = calculateWorkReward(settings);
  const flavorText = getRandomFlavorText(settings);
  
  // Apply item boost + Lucky Penny payout buff + pet bonus
  const workBoost = getEffectValue(guildId, userId, EFFECT_TYPES.WORK_BOOST);
  const lpWorkBoost = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.WORK_PAYOUT);
  const petWorkBoost = getPetBonusDecimal(guildId, userId, 'work') * 100;
  const totalBoost = workBoost + lpWorkBoost + petWorkBoost;
  const amount = totalBoost > 0 
    ? Math.floor(baseAmount * (1 + totalBoost / 100))
    : totalBoost < 0
      ? Math.max(1, Math.floor(baseAmount * (1 + totalBoost / 100)))
      : baseAmount;
  const boosted = totalBoost > 0;
  const debuffed = totalBoost < 0;
  
  // Record the work FIRST to set cooldown (prevents spam exploit)
  recordWork(guildId, userId, amount, flavorText);
  
  // Apply prestige income multiplier
  const prestigeAmount = applyIncomeMultiplier(guildId, userId, amount);
  
  const success = await addMoney(guildId, userId, prestigeAmount, 'Work payout');
  
  if (!success) {
    return interaction.followUp({ content: '❌ Failed to add money. Please try again later.', flags: 64 });
  }
  
  const totalEarned = getTotalWorked(guildId, userId);
  const workCount = getWorkCount(guildId, userId);
  
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('💼 Work Complete!')
    .setDescription(flavorText)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields({
      name: '💰 You Earned',
      value: (() => {
        let text = `**+${prestigeAmount.toLocaleString()}** ${getCurrency(guildId)}`;
        const tags = [];
        if (boosted) tags.push(`⚡ +${workBoost}% boost`);
        if (prestigeAmount > amount) tags.push(`${getPrestigeEmoji(guildId, userId)} +${Math.round((prestigeAmount / amount - 1) * 100)}% prestige`);
        if (tags.length) text += ` (${tags.join(', ')})`;
        return text;
      })(),
      inline: true
    })
    .setFooter({ text: `Total earned: ${totalEarned.toLocaleString()} | Jobs completed: ${workCount} | ${interaction.user.displayName}` })
    .setTimestamp();

  await interaction.channel.send({ embeds: [embed] });
  
  // Refresh the panel
  setTimeout(() => showIncomePanel(interaction, guildId, userId, 'edit'), 500);
}

async function executeLuckyPenny(interaction, guildId, userId) {
  const settings = getLuckyPennySettings(guildId);
  
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Lucky Penny is currently disabled.', flags: 64 });
  }
  
  const cooldownCheck = canUseLuckyPenny(guildId, userId);
  if (!cooldownCheck.canUse) {
    return interaction.reply({ content: `⏳ ${cooldownCheck.reason}`, flags: 64 });
  }
  
  await interaction.deferUpdate();
  
  // Roll the penny first to determine outcome
  const result = rollLuckyPenny(guildId, userId, settings);
  
  // Record cooldown — reduced if nothing
  if (result.type === 'nothing') {
    recordLuckyPennyUse(guildId, userId, settings.nothingCooldownHours);
  } else {
    recordLuckyPennyUse(guildId, userId);
  }
  
  const embed = new EmbedBuilder()
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  
  if (result.type === 'buff') {
    applyLpBuff(guildId, userId, result.effectType, result.value, result.durationHours);
    
    const isInverse = INVERSE_EFFECTS.has(result.effectType);
    const emojis = LP_EFFECT_EMOJI[result.effectType] || { buff: '✅', debuff: '❌' };
    const emoji = result.isBuff ? emojis.buff : emojis.debuff;
    
    let effectDescription;
    if (result.isBuff) {
      effectDescription = isInverse
        ? `${emoji} **${result.effectName}** reduced by **${result.displayPercent}%**`
        : `${emoji} **${result.effectName}** increased by **${result.displayPercent}%**`;
    } else {
      effectDescription = isInverse
        ? `${emoji} **${result.effectName}** increased by **${result.displayPercent}%**`
        : `${emoji} **${result.effectName}** reduced by **${result.displayPercent}%**`;
    }
    
    embed
      .setColor(result.isBuff ? 0x2ecc71 : 0xe74c3c)
      .setTitle(result.isBuff ? '🪙 Lucky Penny — Buff!' : '🪙 Lucky Penny — Cursed!')
      .setDescription(`${result.flavorText}\n\n${effectDescription}`)
      .addFields({ name: '⏱️ Duration', value: `${result.durationHours} hours`, inline: true });
    
  } else if (result.type === 'currency') {
    const lpPrestigeAmount = applyIncomeMultiplier(guildId, userId, result.amount);
    await addMoney(guildId, userId, lpPrestigeAmount, 'Lucky Penny');
    
    embed
      .setColor(0xf1c40f)
      .setTitle('🪙 Lucky Penny — Payday!')
      .setDescription(result.flavorText)
      .addFields({ name: '💰 Found', value: lpPrestigeAmount > result.amount
        ? `${lpPrestigeAmount.toLocaleString()} ${getCurrency(guildId)} (${getPrestigeEmoji(guildId, userId)} +${Math.round((lpPrestigeAmount / result.amount - 1) * 100)}% prestige)`
        : `${lpPrestigeAmount.toLocaleString()} ${getCurrency(guildId)}`, inline: true });
    
  } else {
    const nothingCdText = settings.nothingCooldownHours < settings.cooldownHours
      ? `\n\n⏩ *Reduced cooldown: **${settings.nothingCooldownHours}h** instead of ${settings.cooldownHours}h*`
      : '';
    embed
      .setColor(0x95a5a6)
      .setTitle('🪙 Lucky Penny — Nothing...')
      .setDescription(result.flavorText + nothingCdText);
  }
  
  // Show active buffs if any
  const activeBuffs = getActiveLuckyPennyBuffs(guildId, userId);
  if (activeBuffs.length > 0) {
    const buffList = activeBuffs.map(b => {
      const timeLeft = b.expiresAt - Date.now();
      const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
      const minsLeft = Math.ceil((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
      const timeStr = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m` : `${minsLeft}m`;
      const isInverse = INVERSE_EFFECTS.has(b.effectType);
      let desc;
      if (b.isBuff) {
        desc = isInverse
          ? `${b.emoji} ${b.name}: −${b.displayPercent}% (${timeStr})`
          : `${b.emoji} ${b.name}: +${b.displayPercent}% (${timeStr})`;
      } else {
        desc = isInverse
          ? `${b.emoji} ${b.name}: +${b.displayPercent}% (${timeStr})`
          : `${b.emoji} ${b.name}: −${b.displayPercent}% (${timeStr})`;
      }
      return desc;
    }).join('\n');
    embed.addFields({ name: '📋 Active Effects', value: buffList, inline: false });
  }
  
  embed.setFooter({ text: interaction.user.displayName });
  
  await interaction.channel.send({ embeds: [embed] });
  
  // Refresh the panel
  setTimeout(() => showIncomePanel(interaction, guildId, userId, 'edit'), 500);
}

// Flavor text arrays for hunt
const HUNT_INTROS = [
  'You venture into the digital wilderness...',
  'You scan the network for hidden treasures...',
  'You set out on a data expedition...',
  'You probe the forgotten sectors of the server...',
  'You hack through the digital underbrush...',
  'You follow a faint signal into unknown territory...',
  'You explore the corrupted outskirts of the network...',
  'You stalk through the server\'s abandoned sectors...'
];

const NOTHING_MESSAGES = [
  'You searched everywhere but found nothing. Better luck next time!',
  'The hunt was a bust — nothing to show for it.',
  'Despite your best efforts, you came back empty-handed.',
  'The digital wilderness offered up nothing today.',
  'You followed every lead, but they all turned cold.',
  'Nothing but static and dead ends this time.',
  'The loot gods were not in your favor today.'
];

const CURRENCY_MESSAGES = [
  'You stumbled upon a hidden cache of currency!',
  'You found some forgotten funds buried in the data!',
  'A generous payday from the digital frontier!',
  'You cracked open a data vault and found some loot!',
  'Score! You discovered a stash of credits!',
  'You extracted some currency from a corrupted node!'
];

const ITEM_MESSAGES = [
  'You discovered something special during your hunt!',
  'A rare find emerged from the depths of the network!',
  'Your keen eye spotted something valuable!',
  'Hidden among the data, you found a prize!',
  'The hunt paid off — you found an item!',
  'You unearthed a treasure from the digital wilds!'
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function executeHunt(interaction, guildId, userId) {
  const settings = getHuntSettings(guildId);
  
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Hunt is disabled on this server.', flags: 64 });
  }
  
  const { canHunt: canDoHunt, reason } = canHunt(guildId, userId);
  if (!canDoHunt) {
    return interaction.reply({ content: `⏳ ${reason}`, flags: 64 });
  }
  
  await interaction.deferUpdate();
  
  // Record cooldown FIRST (prevents spam exploit)
  recordHuntCooldown(guildId, userId);
  
  const intro = randomFrom(HUNT_INTROS);
  let outcome = rollHuntOutcome(settings);
  
  // If item roll but no eligible items, fall back to currency
  const eligibleItems = getHuntEligibleItems(guildId);
  if (outcome === 'item' && eligibleItems.length === 0) {
    outcome = 'currency';
  }
  
  const stats = getHuntStats(guildId, userId);
  
  if (outcome === 'nothing') {
    recordHuntResult(guildId, userId, 'nothing');
    
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('🏹 Hunt — Empty-Handed')
      .setDescription(`${intro}\n\n${randomFrom(NOTHING_MESSAGES)}`)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: `Hunts: ${stats.totalHunts + 1} | Items found: ${stats.itemsFound} | ${interaction.user.displayName}` })
      .setTimestamp();
    
    await interaction.channel.send({ embeds: [embed] });
  } else if (outcome === 'currency') {
    const amount = rollCurrencyAmount(settings);
    const huntPrestigeAmount = applyIncomeMultiplier(guildId, userId, amount);
    recordHuntResult(guildId, userId, 'currency', null, null, huntPrestigeAmount);
    await addMoney(guildId, userId, huntPrestigeAmount, 'Hunt currency find');
    
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏹 Hunt — Currency Found!')
      .setDescription(`${intro}\n\n${randomFrom(CURRENCY_MESSAGES)}`)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: '💰 You Found',
        value: huntPrestigeAmount > amount
          ? `**+${huntPrestigeAmount.toLocaleString()}** ${getCurrency(guildId)} (${getPrestigeEmoji(guildId, userId)} +${Math.round((huntPrestigeAmount / amount - 1) * 100)}% prestige)`
          : `**+${huntPrestigeAmount.toLocaleString()}** ${getCurrency(guildId)}`,
        inline: true
      })
      .setFooter({ text: `Hunts: ${stats.totalHunts + 1} | Total earned: ${(stats.totalCurrencyEarned + huntPrestigeAmount).toLocaleString()} | ${interaction.user.displayName}` })
      .setTimestamp();
    
    await interaction.channel.send({ embeds: [embed] });
  } else if (outcome === 'item') {
    const item = eligibleItems[Math.floor(Math.random() * eligibleItems.length)];
    recordHuntResult(guildId, userId, 'item', item.id, item.name, 0);
    addToInventory(guildId, userId, item.id);
    
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🏹 Hunt — Rare Find!')
      .setDescription(`${intro}\n\n${randomFrom(ITEM_MESSAGES)}`)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: '🎁 You Found',
        value: `${item.emoji} **${item.name}**`,
        inline: true
      })
      .setFooter({ text: `Hunts: ${stats.totalHunts + 1} | Items found: ${stats.itemsFound + 1} | ${interaction.user.displayName}` })
      .setTimestamp();
    
    if (item.image_url) {
      embed.setImage(item.image_url);
    }
    
    await interaction.channel.send({ embeds: [embed] });
  }
  
  // Refresh the panel
  setTimeout(() => showIncomePanel(interaction, guildId, userId, 'edit'), 500);
}

async function executeCollect(interaction, guildId, userId) {
  const member = interaction.member;
  const userRoleIds = member.roles.cache.map(r => r.id);
  const settings = getDividendSettings(guildId);
  
  await interaction.deferUpdate();
  
  const collections = [];
  let totalAmount = 0;
  
  // Check and collect stock bonus
  const user = getUser(userId);
  if (settings.passiveIncomeEnabled && user) {
    const { canCollect } = canCollectPassiveIncome(guildId, userId);
    if (canCollect) {
      const db = getDb();
      const sharesResult = db.exec('SELECT SUM(shares) as total FROM stocks WHERE stock_user_id = ? AND owner_id != ?', [userId, userId]);
      const totalSharesOwned = sharesResult.length > 0 && sharesResult[0].values.length > 0 && sharesResult[0].values[0][0] 
        ? sharesResult[0].values[0][0] 
        : 0;
      const stockPrice = calculateStockPrice(userId, guildId);
      const amount = calculatePassiveIncome(stockPrice, settings.passiveIncomeRate, totalSharesOwned);
      
      if (amount > 0) {
        const stockPrestigeAmount = applyIncomeMultiplier(guildId, userId, amount);
        // Record FIRST to set cooldown (prevents spam exploit)
        recordPassiveIncomeCollection(guildId, userId, stockPrice, stockPrestigeAmount);
        await addMoney(guildId, userId, stockPrestigeAmount, 'Stock bonus from stock value');
        let stockLine = `📈 **Stock Bonus:** +${stockPrestigeAmount.toLocaleString()} ${getCurrency(guildId)}`;
        if (stockPrestigeAmount > amount) stockLine += ` (${getPrestigeEmoji(guildId, userId)} +${Math.round((stockPrestigeAmount / amount - 1) * 100)}% prestige)`;
        collections.push(stockLine);
        totalAmount += stockPrestigeAmount;
      }
    }
  }
  
  // Check and collect role incomes
  const { collectableIncomes } = getCollectableRoleIncomes(guildId, userId, userRoleIds);
  for (const roleIncome of collectableIncomes) {
    const rolePrestigeAmount = applyIncomeMultiplier(guildId, userId, roleIncome.amount);
    // Record FIRST to set cooldown (prevents spam exploit)
    recordRoleIncomeCollection(guildId, userId, roleIncome.roleId, roleIncome.roleName, rolePrestigeAmount);
    await addMoney(guildId, userId, rolePrestigeAmount, `Role income: ${roleIncome.roleName}`);
    let roleLine = `🏷️ **${roleIncome.roleName}:** +${rolePrestigeAmount.toLocaleString()} ${getCurrency(guildId)}`;
    if (rolePrestigeAmount > roleIncome.amount) roleLine += ` (${getPrestigeEmoji(guildId, userId)} +${Math.round((rolePrestigeAmount / roleIncome.amount - 1) * 100)}% prestige)`;
    collections.push(roleLine);
    totalAmount += rolePrestigeAmount;
  }
  
  if (collections.length === 0) {
    await interaction.followUp({ content: '❌ Nothing to collect right now!', flags: 64 });
  } else {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('💵 Income Collected!')
      .setDescription(collections.join('\n'))
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: '💰 Total',
        value: `**+${totalAmount.toLocaleString()}** ${getCurrency(guildId)}`,
        inline: true
      })
      .setFooter({ text: interaction.user.displayName })
      .setTimestamp();

    await interaction.channel.send({ embeds: [embed] });
  }
  
  // Refresh the panel
  setTimeout(() => showIncomePanel(interaction, guildId, userId, 'edit'), 500);
}

module.exports.handleIncomeButton = handleIncomeButton;
module.exports.showIncomePanel = showIncomePanel;
