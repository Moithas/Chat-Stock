const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getBalance, addMoney, removeFromBank, removeMoney } = require('../economy');
const { 
  getBankSettings, 
  getUserActiveLoan, 
  checkLoanEligibility, 
  createLoan,
  getUserActiveBonds,
  getBondConfigs,
  getBondConfig,
  purchaseBond,
  recordLoanPayment,
  getEffectiveNextPayment,
  getUserLoanHistory,
  getBondHistory,
  getTotalBondsCollected,
  getTotalBondIncomeCollected,
  recordBondHistory,
  completeLoan,
  getUserCreditScore,
  getCreditTier,
  getCreditLoanLimits,
  formatCreditScore,
  createCreditBar,
  recordCreditEvent,
  getLoanWarning,
  MAX_CREDIT_SCORE
} = require('../bank');
const { getUserProperties } = require('../property');
const { getDb, getPortfolio, calculateStockPrice } = require('../database');
const { 
  getImmunityTiers, 
  getImmunityTier, 
  getUserActiveImmunity, 
  purchaseImmunity,
  getImmunityHistory,
  getImmuneRoles
} = require('../rob');
const { getWealthTaxSettings, calculateUserWealth, calculateTaxForWealth, getDayName } = require('../wealth-tax');
const { getCurrency } = require('../admin');



module.exports = {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('Access bank services - loans, bonds, and more'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    
    await showBankPanel(interaction, guildId, userId);
  }
};

// ============ MAIN PANEL ============

async function showBankPanel(interaction, guildId, userId, isUpdate = false) {
  const settings = getBankSettings(guildId);
  const balance = await getBalance(guildId, userId);
  const activeLoan = getUserActiveLoan(guildId, userId);
  const activeBonds = getUserActiveBonds(guildId, userId);
  
  const loanWarning = getLoanWarning(guildId, userId, getCurrency(guildId));
  
  const embed = new EmbedBuilder()
    .setColor(loanWarning ? 0xE74C3C : 0x3498db)
    .setTitle('🏦 Bank Services')
    .setDescription(`Welcome to the bank, **${interaction.user.displayName}**!${loanWarning || ''}`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }));
  
  // Bank Balance Section
  embed.addFields({
    name: '💰 Bank Balance',
    value: `**${balance.bank.toLocaleString()}** ${getCurrency(guildId)}`,
    inline: true
  });
  
  embed.addFields({
    name: '💵 Cash on Hand',
    value: `**${balance.cash.toLocaleString()}** ${getCurrency(guildId)}`,
    inline: true
  });
  
  embed.addFields({ name: '\u200B', value: '\u200B', inline: true }); // Spacer
  
  // Credit Score Section
  const creditInfo = getUserCreditScore(guildId, userId);
  const creditTier = getCreditTier(creditInfo.score, guildId);
  const creditLimits = getCreditLoanLimits(guildId, userId);
  const creditBar = createCreditBar(creditInfo.score);
  
  let creditText = [
    `**Score:** ${creditTier.emoji} **${creditInfo.score}** / ${MAX_CREDIT_SCORE} (${creditTier.name})`,
    `${creditBar}`,
    `**Max Loan:** ${creditLimits.maxLoan > 0 ? creditLimits.maxLoan.toLocaleString() + ' ' + getCurrency(guildId) : '❌ Not eligible'}`,
    `**Interest Rate:** ${creditLimits.interestRate}%`
  ];
  
  if (creditInfo.loansCompleted > 0 || creditInfo.loansDefaulted > 0) {
    creditText.push(`📊 Completed: **${creditInfo.loansCompleted}** | Defaulted: **${creditInfo.loansDefaulted}**`);
  }
  
  if (creditLimits.defaultPenaltyPercent > 0) {
    creditText.push(`⚠️ **Default penalty:** -${Math.round(creditLimits.defaultPenaltyPercent)}% max loan (${creditInfo.totalDefaultedAmount.toLocaleString()} ${getCurrency(guildId)} lifetime defaults)`);
  }
  
  if (creditLimits.defaultCooldownRemaining > 0) {
    const cooldownHours = Math.ceil(creditLimits.defaultCooldownRemaining / (60 * 60 * 1000));
    creditText.push(`🚫 **Loan banned** for ${cooldownHours}h (recent default)`);
  } else if (creditInfo.score < 500 && creditInfo.loansDefaulted > 0) {
    creditText.push(`🔄 Credit recovering **+10/day** until restored`);
  }
  
  embed.addFields({
    name: '📊 Credit Score',
    value: creditText.join('\n'),
    inline: false
  });

  // Loan Status Section
  if (activeLoan) {
    const remaining = activeLoan.total_owed - activeLoan.amount_paid;
    const nextPayment = activeLoan.next_payment_time;
    const effectivePayment = getEffectiveNextPayment(activeLoan);
    const progressPercent = Math.round((activeLoan.amount_paid / activeLoan.total_owed) * 100);
    const progressBar = createProgressBar(progressPercent);
    
    const paymentDisplay = effectivePayment < activeLoan.payment_amount
      ? `~~${activeLoan.payment_amount.toLocaleString()}~~ **${effectivePayment.toLocaleString()}** ${getCurrency(guildId)} (${activeLoan.payment_interval})`
      : `${effectivePayment.toLocaleString()} ${getCurrency(guildId)} (${activeLoan.payment_interval})`;
    
    embed.addFields({
      name: '💳 Active Loan',
      value: [
        `**Remaining:** ${remaining.toLocaleString()} ${getCurrency(guildId)}`,
        `**Payment:** ${paymentDisplay}`,
        `**Next Payment:** <t:${Math.floor(nextPayment / 1000)}:R>`,
        `**Progress:** ${progressBar} ${progressPercent}%`,
        activeLoan.missed_payments > 0 ? `⚠️ **Missed Payments:** ${activeLoan.missed_payments}` : ''
      ].filter(Boolean).join('\n'),
      inline: false
    });
  } else {
    embed.addFields({
      name: '💳 Loan Status',
      value: settings.loansEnabled ? '✅ No active loan - You can apply for one!' : '❌ Loans are currently disabled',
      inline: false
    });
  }
  
  // Bond Status Section
  if (activeBonds.length > 0) {
    const bondTexts = activeBonds.map(bond => {
      const timeLeft = bond.expires_at - Date.now();
      const daysLeft = Math.ceil(timeLeft / (24 * 60 * 60 * 1000));
      const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
      const timeDisplay = daysLeft > 0 ? `${daysLeft} days` : `${hoursLeft} hours`;
      return `**${bond.bond_name}** - <@&${bond.role_id}>\n└ Expires: <t:${Math.floor(bond.expires_at / 1000)}:R> (${timeDisplay} left)`;
    });
    
    embed.addFields({
      name: '📜 Active Bonds',
      value: bondTexts.join('\n\n'),
      inline: false
    });
  } else {
    embed.addFields({
      name: '📜 Bond Status',
      value: settings.bondsEnabled ? '✅ No active bonds - Purchase one to get roles!' : '❌ Bonds are currently disabled',
      inline: false
    });
  }
  
  // Wealth Tax Section
  const taxSettings = getWealthTaxSettings(guildId);
  if (taxSettings.enabled) {
    const wealth = calculateUserWealth(guildId, userId);
    const { totalTax, breakdown } = calculateTaxForWealth(wealth.total, taxSettings.tiers);
    
    // Calculate next collection time
    const now = new Date();
    const nextCollection = new Date();
    nextCollection.setHours(taxSettings.collectionHour, 0, 0, 0);
    
    // Find next occurrence of collection day
    const daysUntil = (taxSettings.collectionDay - now.getDay() + 7) % 7;
    if (daysUntil === 0 && now.getHours() >= taxSettings.collectionHour) {
      nextCollection.setDate(nextCollection.getDate() + 7);
    } else {
      nextCollection.setDate(nextCollection.getDate() + daysUntil);
    }
    
    let taxText = '';
    if (totalTax > 0) {
      taxText = [
        `**Your Wealth:** ${wealth.total.toLocaleString()} ${getCurrency(guildId)}`,
        `└ 💵 Cash: ${wealth.cash.toLocaleString()} | 📈 Stocks: ${wealth.stocks.toLocaleString()} | 🏠 Properties: ${wealth.properties.toLocaleString()}`,
        `**Estimated Tax:** ${totalTax.toLocaleString()} ${getCurrency(guildId)}`,
        `**Next Collection:** <t:${Math.floor(nextCollection.getTime() / 1000)}:R> (${getDayName(taxSettings.collectionDay)})`
      ].join('\n');
    } else {
      taxText = [
        `**Your Wealth:** ${wealth.total.toLocaleString()} ${getCurrency(guildId)}`,
        `✅ **Tax Exempt** - Below taxable threshold`,
        `**Next Collection:** <t:${Math.floor(nextCollection.getTime() / 1000)}:R> (${getDayName(taxSettings.collectionDay)})`
      ].join('\n');
    }
    
    embed.addFields({
      name: '🏛️ Wealth Tax',
      value: taxText,
      inline: false
    });
  }
  
  // Build buttons
  const row1 = new ActionRowBuilder();
  
  // Loan button - changes based on whether user has an active loan
  if (activeLoan) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId('bank_pay_loan')
        .setLabel('Pay Loan')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💳')
    );
  } else {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId('bank_apply_loan')
        .setLabel('Apply for Loan')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💰')
        .setDisabled(!settings.loansEnabled)
    );
  }
  
  // Buy Bond button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('bank_buy_bond')
      .setLabel('Buy Bond')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📜')
      .setDisabled(!settings.bondsEnabled || activeBonds.length > 0)
  );
  
  // History button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('bank_history')
      .setLabel('History')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋')
  );
  
  // Refresh button
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('bank_refresh')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄')
  );
  
  // Bounty Board button (second row)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bounty_board')
      .setLabel('Bounty Board')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🏴‍☠️')
  );
  
  const replyOptions = { embeds: [embed], components: [row1, row2], flags: 64 };
  
  if (isUpdate) {
    return interaction.update(replyOptions);
  } else if (interaction.deferred) {
    return interaction.editReply(replyOptions);
  } else {
    return interaction.reply(replyOptions);
  }
}

function createProgressBar(percent, length = 10) {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ============ LOAN APPLICATION ============

async function showLoanApplication(interaction, guildId, userId) {
  const settings = getBankSettings(guildId);
  
  if (!settings.loansEnabled) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Loans Disabled')
        .setDescription('Loans are currently disabled on this server.')],
      flags: 64
    });
  }
  
  const existingLoan = getUserActiveLoan(guildId, userId);
  if (existingLoan) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Existing Loan')
        .setDescription('You already have an active loan. Please pay it off before applying for a new one.')],
      flags: 64
    });
  }
  
  // Check eligibility - gather required data
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const properties = getUserProperties(guildId, userId);
  const propertiesOwned = properties.length;
  
  // Calculate portfolio value
  const portfolio = getPortfolio(userId);
  let portfolioValue = 0;
  for (const holding of portfolio) {
    const price = calculateStockPrice(holding.stock_user_id);
    portfolioValue += price * holding.shares;
  }
  
  const eligibility = checkLoanEligibility(guildId, userId, member, portfolioValue, propertiesOwned);
  if (!eligibility.eligible) {
    const creditInfo = getUserCreditScore(guildId, userId);
    const desc = [
      ...eligibility.reasons,
      '',
      `📊 Your Credit Score: ${formatCreditScore(creditInfo.score, guildId)}`
    ].join('\n');
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Not Eligible')
        .setDescription(desc)],
      flags: 64
    });
  }
  
  // Get credit-based loan limits
  const creditLimits = eligibility.creditLimits || getCreditLoanLimits(guildId, userId);
  const effectiveMax = Math.max(settings.loanMinAmount, creditLimits.maxLoan);
  
  // Show loan application modal
  const modal = new ModalBuilder()
    .setCustomId('bank_loan_modal')
    .setTitle('Loan Application');
  
  const amountInput = new TextInputBuilder()
    .setCustomId('loan_amount')
    .setLabel(`Amount (${settings.loanMinAmount.toLocaleString()} - ${effectiveMax.toLocaleString()})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`Max: ${effectiveMax.toLocaleString()} (based on credit score)`)
    .setRequired(true);
  
  const durationInput = new TextInputBuilder()
    .setCustomId('loan_duration')
    .setLabel(`Duration in Days (${settings.loanMinDuration} - ${settings.loanMaxDuration})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter days...')
    .setRequired(true);
  
  const intervalInput = new TextInputBuilder()
    .setCustomId('loan_interval')
    .setLabel('Payment Interval (daily or weekly)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('daily or weekly')
    .setValue('daily')
    .setRequired(true);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(durationInput),
    new ActionRowBuilder().addComponents(intervalInput)
  );
  
  return interaction.showModal(modal);
}

// ============ LOAN PAYMENT ============

async function showPayLoanPanel(interaction, guildId, userId) {
  const loan = getUserActiveLoan(guildId, userId);
  
  if (!loan) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ No Active Loan')
        .setDescription('You don\'t have any active loans to pay.')],
      flags: 64
    });
  }
  
  const balance = await getBalance(guildId, userId);
  const remaining = loan.total_owed - loan.amount_paid;
  const effectivePayment = getEffectiveNextPayment(loan);
  const progressPercent = Math.round((loan.amount_paid / loan.total_owed) * 100);
  const progressBar = createProgressBar(progressPercent);
  
  const prepaidNote = effectivePayment < loan.payment_amount 
    ? effectivePayment === 0 
      ? '\n✅ *Next payment fully covered by prepayment!*' 
      : `\n💡 *Reduced from ${loan.payment_amount.toLocaleString()} by prepayment*`
    : '';
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('💳 Loan Payment')
    .setDescription(`Choose how much to pay toward your loan.${prepaidNote}`)
    .addFields(
      { name: '💰 Your Bank Balance', value: `${balance.bank.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '📊 Remaining Balance', value: `${remaining.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '📅 Next Payment Due', value: `${effectivePayment.toLocaleString()} ${getCurrency(guildId)} <t:${Math.floor(loan.next_payment_time / 1000)}:R>`, inline: true },
      { name: '📈 Progress', value: `${progressBar} ${progressPercent}%`, inline: true }
    )
    .setFooter({ text: 'Payments are deducted from your bank balance' });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bank_pay_scheduled')
      .setLabel(`Pay Scheduled (${effectivePayment.toLocaleString()})`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(effectivePayment === 0 || balance.bank < effectivePayment),
    new ButtonBuilder()
      .setCustomId('bank_pay_full')
      .setLabel(`Pay in Full (${remaining.toLocaleString()})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(balance.bank < remaining),
    new ButtonBuilder()
      .setCustomId('bank_pay_custom')
      .setLabel('Custom Amount')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('bank_panel_back')
      .setLabel('Back')
      .setStyle(ButtonStyle.Danger)
  );
  
  return interaction.update({ embeds: [embed], components: [row] });
}

// ============ BOND PURCHASE ============

async function showBondShop(interaction, guildId, userId) {
  const settings = getBankSettings(guildId);
  
  if (!settings.bondsEnabled) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Bonds Disabled')
        .setDescription('Savings bonds are currently disabled on this server.')],
      flags: 64
    });
  }
  
  const activeBonds = getUserActiveBonds(guildId, userId);
  if (activeBonds.length > 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Bond Already Active')
        .setDescription('You already have an active bond.\nYou can only hold one bond at a time.\n\nWait for your current bond to expire before purchasing another.')],
      flags: 64
    });
  }
  
  const bonds = getBondConfigs(guildId).filter(b => b.enabled === 1);
  
  if (bonds.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🏦 Savings Bonds')
        .setDescription('No savings bonds are currently available.')],
      flags: 64
    });
  }
  
  const balance = await getBalance(guildId, userId);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🏦 Savings Bonds')
    .setDescription(`Purchase a bond to receive a role for a limited time.\nThe role may provide income via \`/collect\`.\n\n**Your Cash:** ${balance.cash.toLocaleString()} ${getCurrency(guildId)}`)
    .setFooter({ text: 'Select a bond to purchase • Bond cost is paid from cash' });
  
  for (const bond of bonds) {
    const canAfford = balance.cash >= bond.price;
    embed.addFields({
      name: `${canAfford ? '✅' : '❌'} ${bond.name}`,
      value: `**Price:** ${bond.price.toLocaleString()} ${getCurrency(guildId)}\n**Duration:** ${bond.duration_days} days\n**Role:** <@&${bond.role_id}>`,
      inline: true
    });
  }
  
  // Create select menu
  const selectOptions = bonds.map(b => ({
    label: b.name,
    description: `${b.price.toLocaleString()} - ${b.duration_days} days`,
    value: String(b.id)
  }));
  
  const select = new StringSelectMenuBuilder()
    .setCustomId('bank_bond_select')
    .setPlaceholder('Select a bond to purchase...')
    .addOptions(selectOptions);
  
  const row1 = new ActionRowBuilder().addComponents(select);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bank_panel_back')
      .setLabel('Back to Bank')
      .setStyle(ButtonStyle.Danger)
  );
  
  return interaction.update({ embeds: [embed], components: [row1, row2] });
}

// ============ HISTORY ============

async function showHistory(interaction, guildId, userId) {
  const loanHistory = getUserLoanHistory(guildId, userId, 5);
  const bondHist = getBondHistory(guildId, userId, 5);
  const totalBondIncomeCollected = getTotalBondIncomeCollected(guildId, userId);
  
  const creditInfo = getUserCreditScore(guildId, userId);
  const creditTier = getCreditTier(creditInfo.score, guildId);

  const embed = new EmbedBuilder()
    .setColor(creditTier.color || 0x3498db)
    .setTitle('📋 Your Bank History')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setDescription([
      `📊 **Credit Score:** ${formatCreditScore(creditInfo.score, guildId)}`,
      `${createCreditBar(creditInfo.score)}`,
      '',
      `✅ Loans Completed: **${creditInfo.loansCompleted}** | ❌ Defaulted: **${creditInfo.loansDefaulted}**`,
      `📈 On-Time Payments: **${creditInfo.onTimePayments}** | ⚠️ Missed: **${creditInfo.missedPayments}**`,
      `💰 Total Borrowed: **${creditInfo.totalBorrowed.toLocaleString()}** ${getCurrency(guildId)}`,
      `💸 Total Repaid: **${creditInfo.totalRepaid.toLocaleString()}** ${getCurrency(guildId)}`
    ].join('\n'));
  
  if (loanHistory.length > 0) {
    const loanText = loanHistory.map(l => {
      const date = new Date(l.created_at).toLocaleDateString();
      const status = l.status === 'completed' ? '✅' : l.status === 'defaulted' ? '❌' : '🔄';
      return `${status} **${l.principal.toLocaleString()}** ${getCurrency(guildId)} (${date}) - ${l.status}`;
    }).join('\n');
    
    embed.addFields({ name: '💰 Recent Loans', value: loanText, inline: false });
  } else {
    embed.addFields({ name: '💰 Recent Loans', value: 'No loan history', inline: false });
  }
  
  if (bondHist.length > 0) {
    const bondText = bondHist.map(b => {
      const date = new Date(b.purchased_at).toLocaleDateString();
      return `📜 **${b.bond_name}** - ${b.price.toLocaleString()} ${getCurrency(guildId)} (${date})`;
    }).join('\n');
    
    embed.addFields({ name: '📜 Recent Bonds', value: bondText, inline: false });
  } else {
    embed.addFields({ name: '📜 Recent Bonds', value: 'No bond history', inline: false });
  }
  
  // Total bond income collected
  if (totalBondIncomeCollected > 0) {
    embed.addFields({ name: '💵 Total Income Collected This Bond', value: `**${totalBondIncomeCollected.toLocaleString()}** ${getCurrency(guildId)}`, inline: false });
  }
  
  // Immunity history
  const immunityHist = getImmunityHistory(guildId, userId, 5);
  if (immunityHist.length > 0) {
    const immunityText = immunityHist.map(i => {
      const date = new Date(i.purchased_at).toLocaleDateString();
      return `🛡️ **${i.tier_name}** - ${i.price.toLocaleString()} ${getCurrency(guildId)} (${date})`;
    }).join('\n');
    
    embed.addFields({ name: '🛡️ Recent Protection', value: immunityText, inline: false });
  } else {
    embed.addFields({ name: '🛡️ Recent Protection', value: 'No protection history', inline: false });
  }
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bank_panel_back')
      .setLabel('Back to Bank')
      .setStyle(ButtonStyle.Danger)
  );
  
  return interaction.update({ embeds: [embed], components: [row] });
}

// ============ SECURITY PANEL ============

async function showSecurityPanel(interaction, guildId, userId) {
  const balance = await getBalance(guildId, userId);
  const activeImmunity = getUserActiveImmunity(guildId, userId);
  const immunityTiers = getImmunityTiers(guildId).filter(t => t.enabled === 1);
  const immuneRoles = getImmuneRoles(guildId);
  
  // Check if user has role-based immunity
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const userRoleIds = member ? Array.from(member.roles.cache.keys()) : [];
  const hasRoleImmunity = immuneRoles.some(roleId => userRoleIds.includes(roleId));
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🛡️ Security Services')
    .setDescription('Protect yourself from robbery attempts!')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }));
  
  // Show current immunity status
  if (hasRoleImmunity) {
    embed.addFields({
      name: '🛡️ Current Protection',
      value: '✅ **Permanent Immunity** (Role-based)\nYou have a role that grants rob immunity!',
      inline: false
    });
  } else if (activeImmunity) {
    const timeLeft = activeImmunity.expires_at - Date.now();
    const daysLeft = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
    const hoursLeft = Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    
    embed.addFields({
      name: '🛡️ Current Protection',
      value: [
        `✅ **${activeImmunity.tier_name}** Active`,
        `⏱️ Time Remaining: ${daysLeft > 0 ? `${daysLeft}d ` : ''}${hoursLeft}h`,
        `📅 Expires: <t:${Math.floor(activeImmunity.expires_at / 1000)}:R>`
      ].join('\n'),
      inline: false
    });
  } else {
    embed.addFields({
      name: '🛡️ Current Protection',
      value: '❌ **No Active Protection**\nYou are vulnerable to robbery!',
      inline: false
    });
  }
  
  // Show available tiers
  if (immunityTiers.length > 0) {
    embed.addFields({
      name: '💰 Your Cash',
      value: `**${balance.cash.toLocaleString()}** ${getCurrency(guildId)}`,
      inline: true
    });
    
    const tierText = immunityTiers.map(tier => {
      const canAfford = balance.cash >= tier.price;
      return `${canAfford ? '✅' : '❌'} **${tier.name}** - ${tier.price.toLocaleString()} ${getCurrency(guildId)} (${tier.duration_days} days)`;
    }).join('\n');
    
    embed.addFields({
      name: '📋 Available Protection Plans',
      value: tierText,
      inline: false
    });
  } else {
    embed.addFields({
      name: '📋 Available Protection Plans',
      value: '*No protection plans are currently available.*',
      inline: false
    });
  }
  
  const components = [];
  
  // Add tier selection if there are tiers and user doesn't have immunity
  if (immunityTiers.length > 0 && !activeImmunity && !hasRoleImmunity) {
    const selectOptions = immunityTiers.map(t => ({
      label: t.name,
      description: `${t.price.toLocaleString()} - ${t.duration_days} days protection`,
      value: String(t.id)
    }));
    
    const select = new StringSelectMenuBuilder()
      .setCustomId('bank_immunity_select')
      .setPlaceholder('Select a protection plan...')
      .addOptions(selectOptions);
    
    components.push(new ActionRowBuilder().addComponents(select));
  }
  
  // Back button
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bank_panel_back')
      .setLabel('Back to Bank')
      .setStyle(ButtonStyle.Danger)
  ));
  
  return interaction.update({ embeds: [embed], components });
}

// ============ INTERACTION HANDLERS ============

async function handleBankInteraction(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const customId = interaction.customId;

  // Main panel buttons
  if (customId === 'bank_apply_loan') {
    return showLoanApplication(interaction, guildId, userId);
  }
  
  if (customId === 'bank_pay_loan') {
    return showPayLoanPanel(interaction, guildId, userId);
  }
  
  if (customId === 'bank_buy_bond') {
    return showBondShop(interaction, guildId, userId);
  }
  
  if (customId === 'bank_security') {
    return showSecurityPanel(interaction, guildId, userId);
  }
  
  if (customId === 'bank_history') {
    return showHistory(interaction, guildId, userId);
  }
  
  if (customId === 'bank_refresh' || customId === 'bank_panel_back') {
    return showBankPanel(interaction, guildId, userId, true);
  }
  
  // Bounty Board
  if (customId === 'bounty_board') {
    return showBountyBoard(interaction, guildId);
  }
  
  // Immunity purchase
  if (customId === 'bank_immunity_select') {
    const tierId = parseInt(interaction.values[0]);
    const tier = getImmunityTier(guildId, tierId);
    
    if (!tier) {
      return interaction.reply({ content: '❌ Protection plan not found.', flags: 64 });
    }
    
    // Check if user already has immunity
    const activeImmunity = getUserActiveImmunity(guildId, userId);
    if (activeImmunity) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Already Protected')
          .setDescription('You already have active rob immunity.\nWait for it to expire before purchasing another.')],
        flags: 64
      });
    }
    
    // Check balance
    const balance = await getBalance(guildId, userId);
    if (balance.cash < tier.price) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Insufficient Funds')
          .setDescription(`You need **${tier.price.toLocaleString()}** ${getCurrency(guildId)} in cash.\nYou have **${balance.cash.toLocaleString()}** ${getCurrency(guildId)}`)],
        flags: 64
      });
    }
    
    // Process purchase
    await interaction.deferUpdate();
    
    try {
      // Remove money from cash
      await removeMoney(guildId, userId, tier.price, 'Rob immunity purchase');
      
      // Grant immunity
      const result = purchaseImmunity(guildId, userId, tierId);
      
      // Assign role if tier has one configured
      if (result.roleId) {
        try {
          const member = await interaction.guild.members.fetch(userId);
          const role = await interaction.guild.roles.fetch(result.roleId);
          if (role) {
            await member.roles.add(role);
          }
        } catch (roleErr) {
          console.error('Failed to add immunity role:', roleErr.message);
        }
      }
      
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🛡️ Protection Purchased!')
        .setDescription(`**${interaction.user.displayName}** is now protected from robbery!`)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '📋 Plan', value: result.tierName, inline: true },
          { name: '💵 Price Paid', value: `${result.price.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '⏱️ Duration', value: `${result.durationDays} days`, inline: true },
          { name: '📅 Expires', value: `<t:${Math.floor(result.expiresAt / 1000)}:F>`, inline: false }
        )
        .setFooter({ text: 'You are now immune to /rob attempts!' });
      
      // Add role info if applicable
      if (result.roleId) {
        embed.addFields({ name: '🎭 Role Granted', value: `<@&${result.roleId}>`, inline: true });
      }
      
      await interaction.editReply({ embeds: [], components: [], content: '✅ Protection purchased!' });
      try {
        await interaction.channel.send({ embeds: [embed] });
      } catch (e) {
        // Channel send failed
      }
      return;
    } catch (error) {
      console.error('Error purchasing immunity:', error);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Error')
          .setDescription('Failed to process purchase. Please try again.')],
        components: []
      });
    }
  }

  // Loan modal submit
  if (customId === 'bank_loan_modal') {
    const amount = parseInt(interaction.fields.getTextInputValue('loan_amount').replace(/,/g, ''));
    const days = parseInt(interaction.fields.getTextInputValue('loan_duration').replace(/,/g, ''));
    const interval = interaction.fields.getTextInputValue('loan_interval').toLowerCase().trim();
    
    const settings = getBankSettings(guildId);
    const creditLimits = getCreditLoanLimits(guildId, userId);
    const effectiveMax = Math.max(settings.loanMinAmount, creditLimits.maxLoan);
    const effectiveRate = creditLimits.interestRate;
    
    // Validate
    if (isNaN(amount) || amount < settings.loanMinAmount || amount > effectiveMax) {
      return interaction.reply({
        content: `❌ Invalid amount. Must be between ${settings.loanMinAmount.toLocaleString()} and ${effectiveMax.toLocaleString()} (based on your credit score).`,
        flags: 64
      });
    }
    
    if (isNaN(days) || days < settings.loanMinDuration || days > settings.loanMaxDuration) {
      return interaction.reply({
        content: `❌ Invalid duration. Must be between ${settings.loanMinDuration} and ${settings.loanMaxDuration} days.`,
        flags: 64
      });
    }
    
    const validIntervals = settings.loanPaymentIntervals || ['daily', 'weekly'];
    if (!validIntervals.includes(interval)) {
      return interaction.reply({
        content: `❌ Invalid interval. Must be one of: ${validIntervals.join(', ')}`,
        flags: 64
      });
    }
    
    // Calculate loan details using credit-adjusted interest rate
    const interest = Math.floor(amount * (effectiveRate / 100));
    const totalOwed = amount + interest;
    const intervalMs = interval === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const durationMs = days * 24 * 60 * 60 * 1000;
    const numPayments = Math.ceil(durationMs / intervalMs);
    const paymentAmount = Math.ceil(totalOwed / numPayments);
    
    const creditInfo = getUserCreditScore(guildId, userId);
    const creditTier = getCreditTier(creditInfo.score, guildId);
    
    const embed = new EmbedBuilder()
      .setColor(creditTier.color || 0xf1c40f)
      .setTitle('📋 Loan Application Review')
      .setDescription(`Please review your loan terms before confirming.\n📊 Credit: ${formatCreditScore(creditInfo.score, guildId)}`)
      .addFields(
        { name: '💵 Principal', value: `${amount.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '📈 Interest Rate', value: `${effectiveRate}%${effectiveRate !== settings.loanInterestRate ? ` (base ${settings.loanInterestRate}%)` : ''}`, inline: true },
        { name: '💰 Interest Amount', value: `${interest.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '📊 Total to Repay', value: `${totalOwed.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '📅 Duration', value: `${days} days`, inline: true },
        { name: '🔄 Payment Schedule', value: `${paymentAmount.toLocaleString()} ${getCurrency(guildId)} ${interval}`, inline: true }
      )
      .setFooter({ text: '⚠️ Missed payments hurt your credit score! Defaults result in a loan ban.' });
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bank_loan_confirm_${amount}_${days}_${interval}`)
        .setLabel('Accept Loan')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId('bank_loan_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );
    
    return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
  }

  // Loan confirm
  if (customId.startsWith('bank_loan_confirm_')) {
    const parts = customId.replace('bank_loan_confirm_', '').split('_');
    const amount = parseInt(parts[0]);
    const days = parseInt(parts[1]);
    const paymentInterval = parts[2];

    await interaction.deferUpdate();

    try {
      const settings = getBankSettings(guildId);
      const creditLimits = getCreditLoanLimits(guildId, userId);
      const effectiveRate = creditLimits.interestRate;
      const loan = createLoan(guildId, userId, amount, effectiveRate, days, paymentInterval);
      
      // Record that a loan was taken
      recordCreditEvent(guildId, userId, 'loan_taken', amount, 0);
      
      // Give the user the money
      await addMoney(guildId, userId, amount, 'Bank loan');

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Loan Approved!')
        .setDescription(`Your loan of **${amount.toLocaleString()}** ${getCurrency(guildId)} has been deposited into your cash balance.`)
        .addFields(
          { name: '💰 Total to Repay', value: `${loan.totalOwed.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '📅 Payment Schedule', value: `${loan.paymentAmount.toLocaleString()} ${getCurrency(guildId)} ${paymentInterval}`, inline: true },
          { name: '⏰ First Payment', value: `<t:${Math.floor(loan.nextPaymentTime / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: '⚠️ Missed payments hurt your credit score! Defaults ban you from loans.' });

      return interaction.editReply({ embeds: [embed], components: [] });
    } catch (error) {
      console.error('Error creating loan:', error);
      return interaction.editReply({ 
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Error')
          .setDescription('Failed to process loan. Please try again.')],
        components: [] 
      });
    }
  }

  // Loan cancel
  if (customId === 'bank_loan_cancel') {
    return interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Loan Cancelled')
        .setDescription('Your loan application has been cancelled.')],
      components: []
    });
  }

  // Pay scheduled amount
  if (customId === 'bank_pay_scheduled') {
    const loan = getUserActiveLoan(guildId, userId);
    if (!loan) {
      return interaction.reply({ content: '❌ No active loan found.', flags: 64 });
    }
    
    const effectiveAmount = getEffectiveNextPayment(loan);
    if (effectiveAmount <= 0) {
      return interaction.reply({ content: '✅ Your next payment is already covered by prepayment!', flags: 64 });
    }
    await processPayment(interaction, guildId, userId, loan, effectiveAmount);
  }

  // Pay full amount
  if (customId === 'bank_pay_full') {
    const loan = getUserActiveLoan(guildId, userId);
    if (!loan) {
      return interaction.reply({ content: '❌ No active loan found.', flags: 64 });
    }
    
    const remaining = loan.total_owed - loan.amount_paid;
    await processPayment(interaction, guildId, userId, loan, remaining);
  }

  // Custom payment modal
  if (customId === 'bank_pay_custom') {
    const loan = getUserActiveLoan(guildId, userId);
    if (!loan) {
      return interaction.reply({ content: '❌ No active loan found.', flags: 64 });
    }
    
    const remaining = loan.total_owed - loan.amount_paid;
    
    const modal = new ModalBuilder()
      .setCustomId('bank_pay_custom_modal')
      .setTitle('Custom Loan Payment');
    
    const amountInput = new TextInputBuilder()
      .setCustomId('payment_amount')
      .setLabel(`Amount to Pay (Max: ${remaining.toLocaleString()})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter amount...')
      .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
    
    return interaction.showModal(modal);
  }

  // Custom payment modal submit
  if (customId === 'bank_pay_custom_modal') {
    const amount = parseInt(interaction.fields.getTextInputValue('payment_amount').replace(/,/g, ''));
    
    if (isNaN(amount) || amount <= 0) {
      return interaction.reply({ content: '❌ Invalid amount.', flags: 64 });
    }
    
    const loan = getUserActiveLoan(guildId, userId);
    if (!loan) {
      return interaction.reply({ content: '❌ No active loan found.', flags: 64 });
    }
    
    const remaining = loan.total_owed - loan.amount_paid;
    if (amount > remaining) {
      return interaction.reply({ content: `❌ You only owe ${remaining.toLocaleString()} ${getCurrency(guildId)}`, flags: 64 });
    }
    
    await processPayment(interaction, guildId, userId, loan, amount);
  }

  // Bond purchase select
  if (customId === 'bank_bond_select') {
    const bondId = parseInt(interaction.values[0]);
    const bond = getBondConfig(guildId, bondId);

    if (!bond) {
      return interaction.reply({ content: '❌ Bond not found.', flags: 64 });
    }

    // Check if user already has any bond active
    const activeBonds = getUserActiveBonds(guildId, userId);
    if (activeBonds.length > 0) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Bond Already Active')
          .setDescription('You already have an active bond.\nYou can only hold one bond at a time.')],
        flags: 64
      });
    }

    // Check if user has enough in cash
    const balance = await getBalance(guildId, userId);
    if (balance.cash < bond.price) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Insufficient Funds')
          .setDescription(`You need **${bond.price.toLocaleString()}** ${getCurrency(guildId)} in cash.\nYou have **${balance.cash.toLocaleString()}** ${getCurrency(guildId)}`)],
        flags: 64
      });
    }

    // Process purchase
    await interaction.deferUpdate();

    try {
      // Remove money
      const { removeMoney } = require('../economy');
      await removeMoney(guildId, userId, bond.price, 'Savings bond purchase');

      // Create bond and assign role
      const result = purchaseBond(guildId, userId, bondId, bond.role_id, bond.price, bond.duration_days);
      recordBondHistory(guildId, userId, bond.name, bond.price, bond.duration_days);

      // Assign role
      try {
        const member = await interaction.guild.members.fetch(userId);
        const role = await interaction.guild.roles.fetch(bond.role_id);
        
        if (role) {
          await member.roles.add(role);
        }
      } catch (roleErr) {
        console.error('Failed to add bond role:', roleErr.message);
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Bond Purchased!')
        .setDescription(`**${interaction.user.displayName}** purchased the **${bond.name}** bond.`)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '💵 Price Paid', value: `${bond.price.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '🎭 Role Granted', value: `<@&${bond.role_id}>`, inline: true },
          { name: '📅 Expires', value: `<t:${Math.floor(result.expiresAt / 1000)}:D>`, inline: true }
        )
        .setFooter({ text: 'The role will be automatically removed when the bond expires.' });

      await interaction.editReply({ embeds: [], components: [], content: '✅ Bond purchased!' });
      try {
        await interaction.channel.send({ embeds: [embed] });
      } catch (e) {
        // Channel send failed
      }
      return;
    } catch (error) {
      console.error('Error processing bond purchase:', error);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('❌ Error')
          .setDescription('Failed to process bond purchase. Please try again.')],
        components: []
      });
    }
  }
}

async function processPayment(interaction, guildId, userId, loan, amount) {
  const balance = await getBalance(guildId, userId);
  
  if (balance.bank < amount) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Insufficient Funds')
        .setDescription(`You need **${amount.toLocaleString()}** ${getCurrency(guildId)} in your bank.\nYou have **${balance.bank.toLocaleString()}** ${getCurrency(guildId)}`)],
      flags: 64
    });
  }
  
  await interaction.deferUpdate();
  
  try {
    await removeFromBank(guildId, userId, amount, 'Loan payment');
    recordLoanPayment(loan.id, guildId, userId, amount, 'manual');
    recordCreditEvent(guildId, userId, 'on_time_payment', loan.principal, amount);
    
    const remaining = loan.total_owed - loan.amount_paid;
    const newRemaining = remaining - amount;
    
    if (newRemaining <= 0) {
      completeLoan(loan.id);
      
      // Check if early payoff (paid before the natural end date)
      const loanAge = Date.now() - loan.created_at;
      const intervalMs = loan.payment_interval === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const expectedPayments = Math.ceil(loan.total_owed / loan.payment_amount);
      const elapsedPayments = Math.floor(loanAge / intervalMs);
      const isEarly = elapsedPayments < expectedPayments - 1;
      
      recordCreditEvent(guildId, userId, isEarly ? 'completed_early' : 'completed', loan.principal, 0);
      
      const creditInfo = getUserCreditScore(guildId, userId);
      
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🎉 Loan Paid Off!')
        .setDescription(`Congratulations! You've paid off your entire loan!${isEarly ? ' 🌟 **Early payoff bonus!**' : ''}\n\n**Final Payment:** ${amount.toLocaleString()} ${getCurrency(guildId)}\n📊 Credit Score: ${formatCreditScore(creditInfo.score, guildId)}`);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('bank_panel_back')
          .setLabel('Back to Bank')
          .setStyle(ButtonStyle.Primary)
      );
      
      return interaction.editReply({ embeds: [embed], components: [row] });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Payment Successful')
      .setDescription(`You paid **${amount.toLocaleString()}** ${getCurrency(guildId)} toward your loan.`)
      .addFields(
        { name: 'Remaining Balance', value: `${newRemaining.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
      );
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bank_pay_loan')
        .setLabel('Make Another Payment')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('bank_panel_back')
        .setLabel('Back to Bank')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error('Loan payment error:', error);
    return interaction.editReply({ 
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Error')
        .setDescription('Failed to process payment. Please try again.')],
      components: [] 
    });
  }
}

// ============ BOUNTY BOARD ============
async function showBountyBoard(interaction, guildId) {
  try {
    const { getActiveBounties, getInfamySettings, INFAMY_TIERS, getTierFromPoints } = require('../infamy');
    const settings = getInfamySettings(guildId);
    
    if (!settings.enabled) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle('🏴‍☠️ Bounty Board')
          .setDescription('The infamy system is currently disabled.')],
        flags: 64
      });
    }
    
    const bounties = getActiveBounties(guildId);
    
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🏴‍☠️ Bounty Board')
      .setTimestamp();
    
    if (bounties.length === 0) {
      embed.setDescription('No active bounties. The streets are clean... for now.');
    } else {
      let desc = `**${bounties.length}** active ${bounties.length === 1 ? 'bounty' : 'bounties'}:\n\n`;
      
      for (const bounty of bounties) {
        let username = bounty.target_user_id;
        try {
          const user = await interaction.client.users.fetch(bounty.target_user_id);
          username = user.username;
        } catch (e) {}
        
        const tier = getTierFromPoints(bounty.posted_infamy, guildId);
        const postedAgo = `<t:${Math.floor(bounty.posted_at / 1000)}:R>`;
        
        desc += `${tier.emoji} **${username}**\n`;
        desc += `└ 💰 **${bounty.bounty_amount.toLocaleString()}** ${getCurrency(guildId)} • ${tier.name} • Posted ${postedAgo}\n\n`;
      }
      
      desc += `*Successfully hack or rob a bounty target to claim their bounty!*`;
      embed.setDescription(desc);
    }
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bank_panel_back')
        .setLabel('Back to Bank')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return interaction.update({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error('Error showing bounty board:', error);
    return interaction.reply({
      content: '❌ Failed to load bounty board.',
      flags: 64
    });
  }
}

module.exports.handleBankInteraction = handleBankInteraction;
