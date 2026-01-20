const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getWorkSettings, canWork, calculateWorkReward, getRandomFlavorText, recordWork, getTotalWorked, getWorkCount } = require('../work');
const { getSlutSettings, canSlut, attemptSlut, calculateSlutReward, calculateFine, getRandomSuccessText, getRandomFailText, recordSlut, getSlutStats } = require('../slut');
const { getCrimeSettings, canCrime, attemptCrime, calculateCrimeReward, calculateFine: calculateCrimeFine, getRandomSuccessText: getCrimeSuccessText, getRandomFailText: getCrimeFailText, recordCrime, getCrimeStats } = require('../crime');
const { getDividendSettings, canCollectPassiveIncome, calculatePassiveIncome, recordPassiveIncomeCollection, getTotalPassiveIncomeCollected, getCollectableRoleIncomes, recordRoleIncomeCollection, getTotalRoleIncomeCollected } = require('../dividends');
const { calculateStockPrice, getUser, getDb } = require('../database');
const { addMoney, removeMoney, getBalance, applyFine } = require('../economy');
const { getEffectValue, EFFECT_TYPES } = require('../items');

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
  const slutSettings = getSlutSettings(guildId);
  const crimeSettings = getCrimeSettings(guildId);
  const collectSettings = getDividendSettings(guildId);
  
  // Check work status
  const workStatus = canWork(guildId, userId);
  const workReady = workStatus.canWork;
  const workTime = workStatus.timeRemaining ? formatTimeRemaining(workStatus.timeRemaining) : null;
  
  // Check slut status
  const slutStatus = canSlut(guildId, userId);
  const slutReady = slutStatus.canSlut;
  const slutTime = slutStatus.timeRemaining ? formatTimeRemaining(slutStatus.timeRemaining) : null;
  
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
  
  // Slut section
  if (slutSettings.enabled) {
    fields.push({
      name: `💋 Slut ${slutReady ? '✅' : '⏳'}`,
      value: slutReady 
        ? `**Ready!**`
        : `Ready in **${slutTime}**`,
      inline: true
    });
  } else {
    fields.push({
      name: '💋 Slut ❌',
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
  
  // Slut button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('income_slut')
      .setLabel('💋 Slut')
      .setStyle(slutReady && slutSettings.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!slutReady || !slutSettings.enabled)
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
  } else {
    await interaction.reply(replyOptions);
  }
}

// Handle button interactions
async function handleIncomeButton(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const customId = interaction.customId;
  
  if (customId === 'income_refresh') {
    return showIncomePanel(interaction, guildId, userId, true);
  }
  
  if (customId === 'income_work') {
    return executeWork(interaction, guildId, userId);
  }
  
  if (customId === 'income_slut') {
    return executeSlut(interaction, guildId, userId);
  }
  
  if (customId === 'income_crime') {
    return executeCrime(interaction, guildId, userId);
  }
  
  if (customId === 'income_collect') {
    return executeCollect(interaction, guildId, userId);
  }
}

async function executeWork(interaction, guildId, userId) {
  const settings = getWorkSettings(guildId);
  
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Work is disabled on this server.', flags: 64 });
  }
  
  const { canWork: canDoWork, reason } = canWork(guildId, userId);
  if (!canDoWork) {
    return interaction.reply({ content: `⏳ ${reason}`, flags: 64 });
  }
  
  await interaction.deferUpdate();
  
  const baseAmount = calculateWorkReward(settings);
  const flavorText = getRandomFlavorText(settings);
  
  // Apply item boost
  const workBoost = getEffectValue(guildId, userId, EFFECT_TYPES.WORK_BOOST);
  const amount = workBoost > 0 
    ? Math.floor(baseAmount * (1 + workBoost / 100))
    : baseAmount;
  const boosted = workBoost > 0;
  
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

async function executeSlut(interaction, guildId, userId) {
  const settings = getSlutSettings(guildId);
  
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ This command is disabled on this server.', flags: 64 });
  }
  
  const { canSlut: canDoSlut, reason } = canSlut(guildId, userId);
  if (!canDoSlut) {
    return interaction.reply({ content: `⏳ ${reason}`, flags: 64 });
  }
  
  await interaction.deferUpdate();
  
  const success = attemptSlut(settings);
  
  if (success) {
    const baseAmount = calculateSlutReward(settings);
    const flavorText = getRandomSuccessText(settings);
    
    // Apply item boost
    const slutBoost = getEffectValue(guildId, userId, EFFECT_TYPES.SLUT_BOOST);
    const amount = slutBoost > 0 
      ? Math.floor(baseAmount * (1 + slutBoost / 100))
      : baseAmount;
    const boosted = slutBoost > 0;
    
    // Record FIRST to set cooldown (prevents spam exploit)
    recordSlut(guildId, userId, true, amount, flavorText);
    await addMoney(guildId, userId, amount, 'Slut payout');
    
    const stats = getSlutStats(guildId, userId);
    const netProfit = stats.totalGained - stats.totalLost;
    
    const embed = new EmbedBuilder()
      .setColor(0xff69b4)
      .setTitle('💋 Success!')
      .setDescription(flavorText)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: '💰 You Earned',
        value: boosted 
          ? `**+${amount.toLocaleString()}** ${CURRENCY} ⚡ (+${slutBoost}% boost!)`
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
    
    const fine = calculateFine(settings, totalBalance);
    const flavorText = getRandomFailText(settings);
    
    // Record FIRST to set cooldown (prevents spam exploit)
    recordSlut(guildId, userId, false, fine, flavorText);
    await applyFine(guildId, userId, fine, 'Slut fine');
    
    const stats = getSlutStats(guildId, userId);
    const netProfit = stats.totalGained - stats.totalLost;
    
    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle('😰 Busted!')
      .setDescription(flavorText)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: '💸 Fine',
        value: `**-${fine.toLocaleString()}** ${CURRENCY}`,
        inline: true
      })
      .setFooter({ text: `Success rate: ${Math.round((stats.successes / Math.max(1, stats.successes + stats.failures)) * 100)}% | Net profit: ${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()} | ${interaction.user.displayName}` })
      .setTimestamp();

    await interaction.channel.send({ embeds: [embed] });
  }
  
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
