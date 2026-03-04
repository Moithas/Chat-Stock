const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getWorkSettings, canWork, calculateWorkReward, getRandomFlavorText, recordWork, getTotalWorked, getWorkCount } = require('../work');
const { getCrimeSettings, canCrime, attemptCrime, calculateCrimeReward, calculateFine: calculateCrimeFine, getRandomSuccessText: getCrimeSuccessText, getRandomFailText: getCrimeFailText, recordCrime, getCrimeStats } = require('../crime');
const { getDividendSettings, canCollectPassiveIncome, calculatePassiveIncome, recordPassiveIncomeCollection, getTotalPassiveIncomeCollected, getCollectableRoleIncomes, recordRoleIncomeCollection, getTotalRoleIncomeCollected } = require('../dividends');
const { calculateStockPrice, getUser, getDb } = require('../database');
const { addMoney, removeMoney, getBalance, applyFine } = require('../economy');
const { getEffectValue, EFFECT_TYPES } = require('../items');
const { getLuckyPennyEffect, LP_EFFECT_TYPES, getLuckyPennySettings, canUseLuckyPenny, recordLuckyPennyUse, rollLuckyPenny, applyBuff: applyLpBuff, getActiveLuckyPennyBuffs, LP_EFFECT_EMOJI, INVERSE_EFFECTS } = require('../luckypenny');

const CURRENCY = '<:babybel:1418824333664452608>';

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
  const crimeSettings = getCrimeSettings(guildId);
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
  
  // Check crime status
  const crimeStatus = canCrime(guildId, userId);
  const crimeReady = crimeStatus.canCrime;
  const crimeTime = crimeStatus.timeRemaining ? formatTimeRemaining(crimeStatus.timeRemaining) : null;
  
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
        ? `**Ready!** Earn ${workSettings.minReward}-${workSettings.maxReward} ${CURRENCY}`
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
  
  // Crime section
  if (crimeSettings.enabled) {
    fields.push({
      name: `🔫 Crime ${crimeReady ? '✅' : '⏳'}`,
      value: crimeReady 
        ? `**Ready!**`
        : `Ready in **${crimeTime}**`,
      inline: true
    });
  } else {
    fields.push({
      name: '🔫 Crime ❌',
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
          ? `**Ready!** Collect **${stockBonusAmount.toLocaleString()}** ${CURRENCY}`
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
      roleText += collectableIncomes.map(r => `✅ **${r.roleName}**: ${r.amount.toLocaleString()} ${CURRENCY}`).join('\n');
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
  
  // Crime button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('income_crime')
      .setLabel('🔫 Crime')
      .setStyle(crimeReady && crimeSettings.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!crimeReady || !crimeSettings.enabled)
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
    
    if (customId === 'income_crime') {
      return await executeCrime(interaction, guildId, userId);
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
  
  // Apply item boost + Lucky Penny payout buff
  const workBoost = getEffectValue(guildId, userId, EFFECT_TYPES.WORK_BOOST);
  const lpWorkBoost = getLuckyPennyEffect(guildId, userId, LP_EFFECT_TYPES.WORK_PAYOUT);
  const totalBoost = workBoost + lpWorkBoost;
  const amount = totalBoost > 0 
    ? Math.floor(baseAmount * (1 + totalBoost / 100))
    : totalBoost < 0
      ? Math.max(1, Math.floor(baseAmount * (1 + totalBoost / 100)))
      : baseAmount;
  const boosted = totalBoost > 0;
  const debuffed = totalBoost < 0;
  
  // Record the work FIRST to set cooldown (prevents spam exploit)
  recordWork(guildId, userId, amount, flavorText);
  
  const success = await addMoney(guildId, userId, amount, 'Work payout');
  
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
      value: boosted 
        ? `**+${amount.toLocaleString()}** ${CURRENCY} ⚡ (+${workBoost}% boost!)`
        : `**+${amount.toLocaleString()}** ${CURRENCY}`,
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
    await addMoney(guildId, userId, result.amount, 'Lucky Penny');
    
    embed
      .setColor(0xf1c40f)
      .setTitle('🪙 Lucky Penny — Payday!')
      .setDescription(result.flavorText)
      .addFields({ name: '💰 Found', value: `${result.amount.toLocaleString()} ${CURRENCY}`, inline: true });
    
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

async function executeCrime(interaction, guildId, userId) {
  const settings = getCrimeSettings(guildId);
  
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Crime is disabled on this server.', flags: 64 });
  }
  
  const { canCrime: canDoCrime, reason } = canCrime(guildId, userId);
  if (!canDoCrime) {
    return interaction.reply({ content: `⏳ ${reason}`, flags: 64 });
  }
  
  await interaction.deferUpdate();
  
  const success = attemptCrime(settings);
  
  if (success) {
    const baseAmount = calculateCrimeReward(settings);
    const flavorText = getCrimeSuccessText(settings);
    
    // Apply item boost
    const crimeBoost = getEffectValue(guildId, userId, EFFECT_TYPES.CRIME_BOOST);
    const amount = crimeBoost > 0 
      ? Math.floor(baseAmount * (1 + crimeBoost / 100))
      : baseAmount;
    const boosted = crimeBoost > 0;
    
    // Record FIRST to set cooldown (prevents spam exploit)
    recordCrime(guildId, userId, true, amount, flavorText);
    await addMoney(guildId, userId, amount, 'Crime payout');
    
    const stats = getCrimeStats(guildId, userId);
    const netProfit = stats.totalGained - stats.totalLost;
    
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🔫 Crime Successful!')
      .setDescription(flavorText)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: '💰 You Earned',
        value: boosted 
          ? `**+${amount.toLocaleString()}** ${CURRENCY} ⚡ (+${crimeBoost}% boost!)`
          : `**+${amount.toLocaleString()}** ${CURRENCY}`,
        inline: true
      })
      .setFooter({ text: `Success rate: ${Math.round((stats.successes / (stats.successes + stats.failures)) * 100)}% | Net profit: ${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()} | ${interaction.user.displayName}` })
      .setTimestamp();

    await interaction.channel.send({ embeds: [embed] });
  } else {
    let totalBalance = 0;
    try {
      const balance = await getBalance(guildId, userId);
      totalBalance = balance.total;
    } catch (err) {
      console.error('Error fetching balance:', err);
    }
    
    // Apply item fine reduction
    const itemFineReduction = getEffectValue(guildId, userId, EFFECT_TYPES.CRIME_FINE_REDUCTION);
    const baseFine = calculateCrimeFine(settings, totalBalance);
    const fine = itemFineReduction > 0 
      ? Math.floor(baseFine * (1 - itemFineReduction / 100))
      : baseFine;
    const flavorText = getCrimeFailText(settings);
    
    // Record FIRST to set cooldown (prevents spam exploit)
    recordCrime(guildId, userId, false, fine, flavorText);
    await applyFine(guildId, userId, fine, 'Crime fine');
    
    const stats = getCrimeStats(guildId, userId);
    const netProfit = stats.totalGained - stats.totalLost;
    
    const fineText = itemFineReduction > 0 
      ? `**-${fine.toLocaleString()}** ${CURRENCY} ⚖️ (-${itemFineReduction}% from Lawyer!)`
      : `**-${fine.toLocaleString()}** ${CURRENCY}`;
    
    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle('🚓 Busted!')
      .setDescription(flavorText)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: '💸 Fine',
        value: fineText,
        inline: true
      })
      .setFooter({ text: `Success rate: ${Math.round((stats.successes / Math.max(1, stats.successes + stats.failures)) * 100)}% | Net profit: ${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()} | ${interaction.user.displayName}` })
      .setTimestamp();

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
        // Record FIRST to set cooldown (prevents spam exploit)
        recordPassiveIncomeCollection(guildId, userId, stockPrice, amount);
        await addMoney(guildId, userId, amount, 'Stock bonus from stock value');
        collections.push(`📈 **Stock Bonus:** +${amount.toLocaleString()} ${CURRENCY}`);
        totalAmount += amount;
      }
    }
  }
  
  // Check and collect role incomes
  const { collectableIncomes } = getCollectableRoleIncomes(guildId, userId, userRoleIds);
  for (const roleIncome of collectableIncomes) {
    // Record FIRST to set cooldown (prevents spam exploit)
    recordRoleIncomeCollection(guildId, userId, roleIncome.roleId, roleIncome.roleName, roleIncome.amount);
    await addMoney(guildId, userId, roleIncome.amount, `Role income: ${roleIncome.roleName}`);
    collections.push(`🏷️ **${roleIncome.roleName}:** +${roleIncome.amount.toLocaleString()} ${CURRENCY}`);
    totalAmount += roleIncome.amount;
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
        value: `**+${totalAmount.toLocaleString()}** ${CURRENCY}`,
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
