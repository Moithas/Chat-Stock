// Admin Bank Panel - Fully Modular with handleInteraction
const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder
} = require('discord.js');
const { logAdminAction } = require('../admin');

const CURRENCY = '<:babybel:1418824333664452608>';

// ==================== INTERACTION IDS ====================
const BUTTON_IDS = [
  'bank_loans_toggle',
  'bank_bonds_toggle',
  'bank_loan_settings',
  'bank_loan_criteria',
  'bank_bond_settings',
  'bank_view_loans',
  'bank_view_bonds',
  'bank_settings',
  'bank_back',
  'bank_edit_loan_settings',
  'bank_toggle_req_properties',
  'bank_toggle_req_portfolio',
  'bank_toggle_req_tenure',
  'bank_toggle_collateral',
  'bank_edit_requirements',
  'bank_add_bond'
];

const BUTTON_PREFIXES = [
  'bank_bonds_page_',
  'bank_activebonds_page_',
  'bank_loans_page_',
  'bank_bond_edit_',
  'bank_bond_toggle_',
  'bank_bond_role_',
  'bank_bond_delete_',
  'bank_loan_forgive_',
  'bank_loan_detail_'
];

const MODAL_IDS = [
  'modal_bank_loan_settings',
  'modal_bank_criteria',
  'modal_bank_bond_add'
];

const MODAL_PREFIXES = [
  'modal_bank_bond_edit_'
];

const SELECT_IDS = [
  'bank_delete_active_bond'
];

const SELECT_PREFIXES = [
  'bank_bond_select_',
  'bank_loan_select_',
  'bank_bond_role_select_'
];

// ==================== HANDLE INTERACTION ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;

  // Handle buttons
  if (interaction.isButton()) {
    if (BUTTON_IDS.includes(customId)) {
      return await handleButton(interaction, guildId, customId);
    }
    for (const prefix of BUTTON_PREFIXES) {
      if (customId.startsWith(prefix)) {
        return await handleButton(interaction, guildId, customId);
      }
    }
  }

  // Handle modals
  if (interaction.isModalSubmit()) {
    if (MODAL_IDS.includes(customId)) {
      return await handleModal(interaction, guildId, customId);
    }
    for (const prefix of MODAL_PREFIXES) {
      if (customId.startsWith(prefix)) {
        return await handleModal(interaction, guildId, customId);
      }
    }
  }

  // Handle select menus
  if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu()) {
    if (SELECT_IDS.includes(customId)) {
      return await handleSelect(interaction, guildId, customId);
    }
    for (const prefix of SELECT_PREFIXES) {
      if (customId.startsWith(prefix)) {
        return await handleSelect(interaction, guildId, customId);
      }
    }
  }

  return false;
}

// ==================== BUTTON HANDLER ====================
async function handleButton(interaction, guildId, customId) {
  const { getBankSettings, updateBankSettings, getBondTiers, updateBondTier, deleteBondTier, forgiveLoan, getAllActiveLoans } = require('../bank');

  // Toggle loans
  if (customId === 'bank_loans_toggle') {
    const settings = getBankSettings(guildId);
    updateBankSettings(guildId, { loansEnabled: !settings.loansEnabled });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled loans ${!settings.loansEnabled ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showBankPanel(interaction, guildId, true);
    return true;
  }

  // Toggle bonds
  if (customId === 'bank_bonds_toggle') {
    const settings = getBankSettings(guildId);
    updateBankSettings(guildId, { bondsEnabled: !settings.bondsEnabled });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled bonds ${!settings.bondsEnabled ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showBankPanel(interaction, guildId, true);
    return true;
  }

  // Loan settings panel
  if (customId === 'bank_loan_settings') {
    await interaction.deferUpdate();
    await showBankLoanSettingsPanel(interaction, guildId);
    return true;
  }

  // Loan criteria/requirements panel
  if (customId === 'bank_loan_criteria') {
    await interaction.deferUpdate();
    await showBankRequirementsPanel(interaction, guildId);
    return true;
  }

  // Bond settings/tiers panel
  if (customId === 'bank_bond_settings') {
    await interaction.deferUpdate();
    await showBondTiersPanel(interaction, guildId, 0, true);
    return true;
  }

  // View active loans
  if (customId === 'bank_view_loans') {
    await interaction.deferUpdate();
    await showActiveLoansPanel(interaction, guildId, 0);
    return true;
  }

  // View active bonds
  if (customId === 'bank_view_bonds') {
    await interaction.deferUpdate();
    await showActiveBondsPanel(interaction, guildId, 0, true);
    return true;
  }

  // Back to bank panel
  if (customId === 'bank_settings' || customId === 'bank_back') {
    await interaction.deferUpdate();
    await showBankPanel(interaction, guildId, true);
    return true;
  }

  // Edit loan settings modal
  if (customId === 'bank_edit_loan_settings') {
    const settings = getBankSettings(guildId);
    const modal = createBankLoanSettingsModal(settings);
    await interaction.showModal(modal);
    return true;
  }

  // Toggle property requirement
  if (customId === 'bank_toggle_req_properties') {
    const settings = getBankSettings(guildId);
    updateBankSettings(guildId, { loanRequireProperties: !settings.loanRequireProperties });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled property requirement ${!settings.loanRequireProperties ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showBankRequirementsPanel(interaction, guildId);
    return true;
  }

  // Toggle portfolio requirement
  if (customId === 'bank_toggle_req_portfolio') {
    const settings = getBankSettings(guildId);
    updateBankSettings(guildId, { loanRequirePortfolio: !settings.loanRequirePortfolio });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled portfolio requirement ${!settings.loanRequirePortfolio ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showBankRequirementsPanel(interaction, guildId);
    return true;
  }

  // Toggle tenure requirement
  if (customId === 'bank_toggle_req_tenure') {
    const settings = getBankSettings(guildId);
    updateBankSettings(guildId, { loanRequireTenure: !settings.loanRequireTenure });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled tenure requirement ${!settings.loanRequireTenure ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showBankRequirementsPanel(interaction, guildId);
    return true;
  }

  // Toggle collateral seizure
  if (customId === 'bank_toggle_collateral') {
    const settings = getBankSettings(guildId);
    updateBankSettings(guildId, { loanSeizeCollateral: !settings.loanSeizeCollateral });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled collateral seizure ${!settings.loanSeizeCollateral ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showBankRequirementsPanel(interaction, guildId);
    return true;
  }

  // Edit requirements modal
  if (customId === 'bank_edit_requirements') {
    const settings = getBankSettings(guildId);
    const modal = createBankRequirementsModal(settings);
    await interaction.showModal(modal);
    return true;
  }

  // Add bond tier modal
  if (customId === 'bank_add_bond') {
    const modal = createBondTierModal();
    await interaction.showModal(modal);
    return true;
  }

  // Bond tier pagination
  if (customId.startsWith('bank_bonds_page_')) {
    const page = parseInt(customId.replace('bank_bonds_page_', ''));
    await interaction.deferUpdate();
    await showBondTiersPanel(interaction, guildId, page, true);
    return true;
  }

  // Active bonds pagination
  if (customId.startsWith('bank_activebonds_page_')) {
    const page = parseInt(customId.replace('bank_activebonds_page_', ''));
    await interaction.deferUpdate();
    await showActiveBondsPanel(interaction, guildId, page, true);
    return true;
  }

  // Active loans pagination
  if (customId.startsWith('bank_loans_page_')) {
    const page = parseInt(customId.replace('bank_loans_page_', ''));
    await interaction.deferUpdate();
    await showActiveLoansPanel(interaction, guildId, page);
    return true;
  }

  // Edit bond tier modal
  if (customId.startsWith('bank_bond_edit_')) {
    const bondId = parseInt(customId.replace('bank_bond_edit_', ''));
    const bond = getBondTiers(guildId).find(b => b.id === bondId);
    if (bond) {
      const modal = createBondTierModal(bond);
      await interaction.showModal(modal);
    }
    return true;
  }

  // Toggle bond tier
  if (customId.startsWith('bank_bond_toggle_')) {
    const bondId = parseInt(customId.replace('bank_bond_toggle_', ''));
    const bond = getBondTiers(guildId).find(b => b.id === bondId);
    if (bond) {
      updateBondTier(guildId, bondId, { enabled: !bond.enabled });
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled bond tier "${bond.name}" ${!bond.enabled ? 'ON' : 'OFF'}`);
    }
    await interaction.deferUpdate();
    await showBondEditPanel(interaction, guildId, bondId);
    return true;
  }

  // Change bond role - show role select
  if (customId.startsWith('bank_bond_role_')) {
    const bondId = parseInt(customId.replace('bank_bond_role_', ''));
    await interaction.deferUpdate();
    await showBondRoleSelectPanel(interaction, guildId, bondId);
    return true;
  }

  // Delete bond tier
  if (customId.startsWith('bank_bond_delete_')) {
    const bondId = parseInt(customId.replace('bank_bond_delete_', ''));
    const bond = getBondTiers(guildId).find(b => b.id === bondId);
    if (bond) {
      deleteBondTier(guildId, bondId);
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Deleted bond tier "${bond.name}"`);
    }
    await interaction.deferUpdate();
    await showBondTiersPanel(interaction, guildId, 0, true);
    return true;
  }

  // Loan detail panel
  if (customId.startsWith('bank_loan_detail_')) {
    const loanId = parseInt(customId.replace('bank_loan_detail_', ''));
    await interaction.deferUpdate();
    await showLoanDetailPanel(interaction, guildId, loanId);
    return true;
  }

  // Forgive loan
  if (customId.startsWith('bank_loan_forgive_')) {
    const loanId = parseInt(customId.replace('bank_loan_forgive_', ''));
    const loans = getAllActiveLoans(guildId);
    const loan = loans.find(l => l.id === loanId);
    if (loan) {
      forgiveLoan(loanId);
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Forgave loan #${loanId} for user ${loan.user_id}`);
    }
    await interaction.deferUpdate();
    await showActiveLoansPanel(interaction, guildId, 0);
    return true;
  }

  return false;
}

// ==================== MODAL HANDLER ====================
async function handleModal(interaction, guildId, customId) {
  const { updateBankSettings, addBondTier, updateBondTier, getBondTiers } = require('../bank');

  // Loan settings modal
  if (customId === 'modal_bank_loan_settings') {
    const interestRate = parseFloat(interaction.fields.getTextInputValue('interest_rate'));
    const minAmount = parseInt(interaction.fields.getTextInputValue('min_amount'));
    const maxAmount = parseInt(interaction.fields.getTextInputValue('max_amount'));
    const durationStr = interaction.fields.getTextInputValue('duration');
    const penaltyStr = interaction.fields.getTextInputValue('penalty');

    // Parse duration range
    const durationParts = durationStr.split('-').map(s => parseInt(s.trim()));
    if (durationParts.length !== 2 || durationParts.some(isNaN)) {
      await interaction.reply({ content: '❌ Invalid duration format. Use: min-max (e.g., 1-30)', flags: 64 });
      return true;
    }

    // Parse penalty/max missed
    const penaltyParts = penaltyStr.split('/').map(s => parseInt(s.trim()));
    if (penaltyParts.length !== 2 || penaltyParts.some(isNaN)) {
      await interaction.reply({ content: '❌ Invalid penalty format. Use: penalty/maxMissed (e.g., 10/3)', flags: 64 });
      return true;
    }

    if (isNaN(interestRate) || interestRate < 0 || interestRate > 100) {
      await interaction.reply({ content: '❌ Interest rate must be between 0 and 100.', flags: 64 });
      return true;
    }
    if (isNaN(minAmount) || isNaN(maxAmount) || minAmount < 0 || maxAmount < minAmount) {
      await interaction.reply({ content: '❌ Invalid loan amounts.', flags: 64 });
      return true;
    }

    updateBankSettings(guildId, {
      loanInterestRate: interestRate,
      loanMinAmount: minAmount,
      loanMaxAmount: maxAmount,
      loanMinDuration: durationParts[0],
      loanMaxDuration: durationParts[1],
      loanMissedPaymentPenalty: penaltyParts[0],
      loanMaxMissedPayments: penaltyParts[1]
    });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated loan settings`);
    await interaction.deferUpdate();
    await showBankLoanSettingsPanel(interaction, guildId);
    return true;
  }

  // Requirements modal
  if (customId === 'modal_bank_criteria') {
    const minProperties = parseInt(interaction.fields.getTextInputValue('min_properties'));
    const minPortfolio = parseInt(interaction.fields.getTextInputValue('min_portfolio'));
    const minTenure = parseInt(interaction.fields.getTextInputValue('min_tenure'));

    if (isNaN(minProperties) || minProperties < 0) {
      await interaction.reply({ content: '❌ Minimum properties must be 0 or greater.', flags: 64 });
      return true;
    }
    if (isNaN(minPortfolio) || minPortfolio < 0) {
      await interaction.reply({ content: '❌ Minimum portfolio must be 0 or greater.', flags: 64 });
      return true;
    }
    if (isNaN(minTenure) || minTenure < 0) {
      await interaction.reply({ content: '❌ Minimum tenure must be 0 or greater.', flags: 64 });
      return true;
    }

    updateBankSettings(guildId, {
      loanMinProperties: minProperties,
      loanMinPortfolioValue: minPortfolio,
      loanMinTenureDays: minTenure
    });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated loan requirements`);
    await interaction.deferUpdate();
    await showBankRequirementsPanel(interaction, guildId);
    return true;
  }

  // Add bond tier modal
  if (customId === 'modal_bank_bond_add') {
    const name = interaction.fields.getTextInputValue('name');
    const price = parseInt(interaction.fields.getTextInputValue('price'));
    const duration = parseInt(interaction.fields.getTextInputValue('duration'));

    if (!name || name.trim().length === 0) {
      await interaction.reply({ content: '❌ Bond name is required.', flags: 64 });
      return true;
    }
    if (isNaN(price) || price <= 0) {
      await interaction.reply({ content: '❌ Price must be a positive number.', flags: 64 });
      return true;
    }
    if (isNaN(duration) || duration <= 0) {
      await interaction.reply({ content: '❌ Duration must be at least 1 day.', flags: 64 });
      return true;
    }

    // Add with no role initially - admin can set role after
    addBondTier(guildId, name.trim(), price, duration, null);
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Added bond tier "${name.trim()}"`);
    await interaction.deferUpdate();
    await showBondTiersPanel(interaction, guildId, 0, true);
    return true;
  }

  // Edit bond tier modal
  if (customId.startsWith('modal_bank_bond_edit_')) {
    const bondId = parseInt(customId.replace('modal_bank_bond_edit_', ''));
    const bond = getBondTiers(guildId).find(b => b.id === bondId);

    if (!bond) {
      await interaction.reply({ content: '❌ Bond tier not found.', flags: 64 });
      return true;
    }

    const name = interaction.fields.getTextInputValue('name');
    const price = parseInt(interaction.fields.getTextInputValue('price'));
    const duration = parseInt(interaction.fields.getTextInputValue('duration'));

    if (!name || name.trim().length === 0) {
      await interaction.reply({ content: '❌ Bond name is required.', flags: 64 });
      return true;
    }
    if (isNaN(price) || price <= 0) {
      await interaction.reply({ content: '❌ Price must be a positive number.', flags: 64 });
      return true;
    }
    if (isNaN(duration) || duration <= 0) {
      await interaction.reply({ content: '❌ Duration must be at least 1 day.', flags: 64 });
      return true;
    }

    updateBondTier(guildId, bondId, { name: name.trim(), price, duration_days: duration });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated bond tier "${name.trim()}"`);
    await interaction.deferUpdate();
    await showBondEditPanel(interaction, guildId, bondId);
    return true;
  }

  return false;
}

// ==================== SELECT HANDLER ====================
async function handleSelect(interaction, guildId, customId) {
  const { updateBondTier, getBondTiers, removeBond, getAllActiveBonds } = require('../bank');

  // Bond tier select (from tiers list)
  if (customId.startsWith('bank_bond_select_')) {
    const bondId = parseInt(interaction.values[0]);
    await interaction.deferUpdate();
    await showBondEditPanel(interaction, guildId, bondId);
    return true;
  }

  // Loan select (from loans list)
  if (customId.startsWith('bank_loan_select_')) {
    const loanId = parseInt(interaction.values[0]);
    await interaction.deferUpdate();
    await showLoanDetailPanel(interaction, guildId, loanId);
    return true;
  }

  // Bond role select
  if (customId.startsWith('bank_bond_role_select_')) {
    const bondId = parseInt(customId.replace('bank_bond_role_select_', ''));
    const roleId = interaction.values[0];
    
    updateBondTier(guildId, bondId, { role_id: roleId });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Set role for bond tier to <@&${roleId}>`);
    await interaction.deferUpdate();
    await showBondEditPanel(interaction, guildId, bondId);
    return true;
  }

  // Delete active bond
  if (customId === 'bank_delete_active_bond') {
    const bondId = parseInt(interaction.values[0]);
    const bonds = getAllActiveBonds(guildId);
    const bond = bonds.find(b => b.id === bondId);
    
    if (bond) {
      // Remove bond role from user
      try {
        const member = await interaction.guild.members.fetch(bond.user_id);
        if (member && bond.role_id) {
          await member.roles.remove(bond.role_id).catch(() => {});
        }
      } catch {}
      
      removeBond(bondId, guildId);
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Removed active bond #${bondId}`);
    }
    await interaction.deferUpdate();
    await showActiveBondsPanel(interaction, guildId, 0, true);
    return true;
  }

  return false;
}

// ==================== PANEL DISPLAYS ====================
async function showBankPanel(interaction, guildId, useEditReply = false) {
  const { getBankSettings, getAllActiveLoans, getAllActiveBonds, getBondTiers } = require('../bank');
  const settings = getBankSettings(guildId);
  const bonds = getBondTiers(guildId);
  const activeLoans = getAllActiveLoans(guildId);
  const activeBonds = getAllActiveBonds(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🏦 Bank Settings')
    .setDescription('Configure loans and savings bonds.')
    .addFields(
      { name: '💰 Loans', value: settings.loansEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📜 Bonds', value: settings.bondsEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📊 Active', value: `${activeLoans.length} loans, ${activeBonds.length} bonds`, inline: true },
      { name: '💵 Interest Rate', value: `${settings.loanInterestRate}%`, inline: true },
      { name: '📉 Loan Limits', value: `${settings.loanMinAmount.toLocaleString()} - ${settings.loanMaxAmount.toLocaleString()}`, inline: true },
      { name: '📅 Duration', value: `${settings.loanMinDuration} - ${settings.loanMaxDuration} days`, inline: true }
    );

  // Add requirements info
  const reqs = [];
  if (settings.loanRequireProperties) reqs.push(`${settings.loanMinProperties} properties`);
  if (settings.loanRequirePortfolio) reqs.push(`${settings.loanMinPortfolioValue.toLocaleString()} portfolio`);
  if (settings.loanRequireTenure) reqs.push(`${settings.loanMinTenureDays} days member`);
  embed.addFields({ 
    name: '📋 Loan Requirements', 
    value: reqs.length > 0 ? reqs.join(', ') : 'None', 
    inline: false 
  });

  // Add bond tiers info
  if (bonds.length > 0) {
    const bondInfo = bonds.slice(0, 5).map(b => 
      `**${b.name}**: ${b.price.toLocaleString()} for ${b.duration_days} days`
    ).join('\n');
    embed.addFields({ name: '📜 Bond Tiers', value: bondInfo || 'None configured', inline: false });
  }

  const loansToggleBtn = new ButtonBuilder()
    .setCustomId('bank_loans_toggle')
    .setLabel(settings.loansEnabled ? 'Disable Loans' : 'Enable Loans')
    .setStyle(settings.loansEnabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const bondsToggleBtn = new ButtonBuilder()
    .setCustomId('bank_bonds_toggle')
    .setLabel(settings.bondsEnabled ? 'Disable Bonds' : 'Enable Bonds')
    .setStyle(settings.bondsEnabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const loanSettingsBtn = new ButtonBuilder()
    .setCustomId('bank_loan_settings')
    .setLabel('⚙️ Loan Settings')
    .setStyle(ButtonStyle.Primary);

  const requirementsBtn = new ButtonBuilder()
    .setCustomId('bank_loan_criteria')
    .setLabel('📋 Requirements')
    .setStyle(ButtonStyle.Primary);

  const row1 = new ActionRowBuilder().addComponents(loansToggleBtn, bondsToggleBtn, loanSettingsBtn, requirementsBtn);

  const bondTiersBtn = new ButtonBuilder()
    .setCustomId('bank_bond_settings')
    .setLabel('📜 Bond Tiers')
    .setStyle(ButtonStyle.Primary);

  const viewLoansBtn = new ButtonBuilder()
    .setCustomId('bank_view_loans')
    .setLabel(`📊 View Loans (${activeLoans.length})`)
    .setStyle(ButtonStyle.Secondary);

  const viewBondsBtn = new ButtonBuilder()
    .setCustomId('bank_view_bonds')
    .setLabel(`📜 View Bonds (${activeBonds.length})`)
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder().addComponents(bondTiersBtn, viewLoansBtn, viewBondsBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showBankLoanSettingsPanel(interaction, guildId) {
  const { getBankSettings } = require('../bank');
  const settings = getBankSettings(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('⚙️ Loan Settings')
    .setDescription('Configure loan interest, amounts, and penalties.')
    .addFields(
      { name: '💵 Interest Rate', value: `${settings.loanInterestRate}%`, inline: true },
      { name: '📉 Min Loan', value: settings.loanMinAmount.toLocaleString(), inline: true },
      { name: '📈 Max Loan', value: settings.loanMaxAmount.toLocaleString(), inline: true },
      { name: '📅 Min Duration', value: `${settings.loanMinDuration} days`, inline: true },
      { name: '📅 Max Duration', value: `${settings.loanMaxDuration} days`, inline: true },
      { name: '⚠️ Missed Payment Penalty', value: `${settings.loanMissedPaymentPenalty}%`, inline: true },
      { name: '❌ Max Missed Payments', value: `${settings.loanMaxMissedPayments}`, inline: true }
    );

  const editBtn = new ButtonBuilder()
    .setCustomId('bank_edit_loan_settings')
    .setLabel('✏️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('bank_settings')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showBankRequirementsPanel(interaction, guildId) {
  const { getBankSettings } = require('../bank');
  const settings = getBankSettings(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📋 Loan Requirements & Collateral')
    .setDescription('Configure loan requirements and default consequences.')
    .addFields(
      { 
        name: '🏠 Properties Required', 
        value: settings.loanRequireProperties 
          ? `✅ Yes - Min: ${settings.loanMinProperties}` 
          : '❌ No', 
        inline: true 
      },
      { 
        name: '📊 Portfolio Required', 
        value: settings.loanRequirePortfolio 
          ? `✅ Yes - Min: ${settings.loanMinPortfolioValue.toLocaleString()}` 
          : '❌ No', 
        inline: true 
      },
      { 
        name: '📅 Tenure Required', 
        value: settings.loanRequireTenure 
          ? `✅ Yes - Min: ${settings.loanMinTenureDays} days` 
          : '❌ No', 
        inline: true 
      },
      {
        name: '⚠️ Seize Collateral on Default',
        value: settings.loanSeizeCollateral
          ? '✅ Yes - Lowest value property seized'
          : '❌ No',
        inline: true
      }
    );

  const togglePropsBtn = new ButtonBuilder()
    .setCustomId('bank_toggle_req_properties')
    .setLabel(settings.loanRequireProperties ? '🏠 Disable Properties' : '🏠 Enable Properties')
    .setStyle(settings.loanRequireProperties ? ButtonStyle.Danger : ButtonStyle.Success);

  const togglePortfolioBtn = new ButtonBuilder()
    .setCustomId('bank_toggle_req_portfolio')
    .setLabel(settings.loanRequirePortfolio ? '📊 Disable Portfolio' : '📊 Enable Portfolio')
    .setStyle(settings.loanRequirePortfolio ? ButtonStyle.Danger : ButtonStyle.Success);

  const toggleTenureBtn = new ButtonBuilder()
    .setCustomId('bank_toggle_req_tenure')
    .setLabel(settings.loanRequireTenure ? '📅 Disable Tenure' : '📅 Enable Tenure')
    .setStyle(settings.loanRequireTenure ? ButtonStyle.Danger : ButtonStyle.Success);

  const row1 = new ActionRowBuilder().addComponents(togglePropsBtn, togglePortfolioBtn, toggleTenureBtn);

  const toggleCollateralBtn = new ButtonBuilder()
    .setCustomId('bank_toggle_collateral')
    .setLabel(settings.loanSeizeCollateral ? '⚠️ Disable Collateral' : '⚠️ Enable Collateral')
    .setStyle(settings.loanSeizeCollateral ? ButtonStyle.Danger : ButtonStyle.Success);

  const editValuesBtn = new ButtonBuilder()
    .setCustomId('bank_edit_requirements')
    .setLabel('✏️ Edit Values')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('bank_settings')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder().addComponents(toggleCollateralBtn, editValuesBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showBondTiersPanel(interaction, guildId, page = 0, useEditReply = false) {
  const { getBondTiers } = require('../bank');
  const bonds = getBondTiers(guildId);
  const perPage = 5;
  const totalPages = Math.ceil(bonds.length / perPage) || 1;
  const start = page * perPage;
  const pageBonds = bonds.slice(start, start + perPage);

  let description = 'Configure savings bond tiers that users can purchase.\n';
  description += 'Each tier gives a role for a set duration.\n\n';

  if (pageBonds.length === 0) {
    description += '*No bond tiers configured. Click "Add Tier" to create one.*';
  } else {
    for (const bond of pageBonds) {
      const status = bond.enabled ? '✅' : '❌';
      description += `${status} **${bond.name}**\n`;
      description += `   💵 Price: ${bond.price.toLocaleString()} | ⏱️ ${bond.duration_days} days`;
      if (bond.role_id) {
        description += ` | <@&${bond.role_id}>`;
      } else {
        description += ` | ⚠️ No role set`;
      }
      description += '\n\n';
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📜 Bond Tiers')
    .setDescription(description)
    .setFooter({ text: `Page ${page + 1}/${totalPages}` });

  const components = [];

  // Add bond selection menu if there are bonds
  if (pageBonds.length > 0) {
    const options = pageBonds.map(b => ({
      label: b.name,
      description: `${b.price.toLocaleString()} for ${b.duration_days} days`,
      value: String(b.id)
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`bank_bond_select_${page}`)
      .setPlaceholder('Select a tier to edit...')
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const addBtn = new ButtonBuilder()
    .setCustomId('bank_add_bond')
    .setLabel('➕ Add Tier')
    .setStyle(ButtonStyle.Success);

  const prevBtn = new ButtonBuilder()
    .setCustomId(`bank_bonds_page_${page - 1}`)
    .setLabel('◀️ Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`bank_bonds_page_${page + 1}`)
    .setLabel('Next ▶️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);

  const backBtn = new ButtonBuilder()
    .setCustomId('bank_settings')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(addBtn, prevBtn, nextBtn, backBtn));

  await interaction.editReply({ embeds: [embed], components });
}

async function showBondEditPanel(interaction, guildId, bondId) {
  const { getBondTiers } = require('../bank');
  const bond = getBondTiers(guildId).find(b => b.id === parseInt(bondId));
  
  if (!bond) {
    return interaction.editReply({ 
      content: '❌ Bond tier not found.', 
      embeds: [], 
      components: [] 
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📜 Edit Bond: ${bond.name}`)
    .addFields(
      { name: '💵 Price', value: bond.price.toLocaleString(), inline: true },
      { name: '⏱️ Duration', value: `${bond.duration_days} days`, inline: true },
      { name: '🎭 Role', value: bond.role_id ? `<@&${bond.role_id}>` : '⚠️ Not set', inline: true },
      { name: '📊 Status', value: bond.enabled ? '✅ Enabled' : '❌ Disabled', inline: true }
    );

  const editBtn = new ButtonBuilder()
    .setCustomId(`bank_bond_edit_${bondId}`)
    .setLabel('✏️ Edit')
    .setStyle(ButtonStyle.Primary);

  const toggleBtn = new ButtonBuilder()
    .setCustomId(`bank_bond_toggle_${bondId}`)
    .setLabel(bond.enabled ? 'Disable' : 'Enable')
    .setStyle(bond.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const selectRoleBtn = new ButtonBuilder()
    .setCustomId(`bank_bond_role_${bondId}`)
    .setLabel('🎭 Change Role')
    .setStyle(ButtonStyle.Primary);

  const deleteBtn = new ButtonBuilder()
    .setCustomId(`bank_bond_delete_${bondId}`)
    .setLabel('🗑️ Delete')
    .setStyle(ButtonStyle.Danger);

  const backBtn = new ButtonBuilder()
    .setCustomId('bank_bond_settings')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(editBtn, toggleBtn, selectRoleBtn, deleteBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showBondRoleSelectPanel(interaction, guildId, bondId) {
  const { getBondTiers } = require('../bank');
  const bond = getBondTiers(guildId).find(b => b.id === parseInt(bondId));
  
  if (!bond) {
    return interaction.editReply({ 
      content: '❌ Bond tier not found.', 
      embeds: [], 
      components: [] 
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🎭 Select Role for: ${bond.name}`)
    .setDescription('Choose a role that users will receive when they purchase this bond.');

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`bank_bond_role_select_${bondId}`)
    .setPlaceholder('Select a role...')
    .setMinValues(1)
    .setMaxValues(1);

  const backBtn = new ButtonBuilder()
    .setCustomId(`bank_bond_edit_panel_${bondId}`)
    .setLabel('◀️ Cancel')
    .setStyle(ButtonStyle.Secondary);

  // Add back button ID to be handled
  const row1 = new ActionRowBuilder().addComponents(roleSelect);
  const row2 = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showActiveLoansPanel(interaction, guildId, page = 0) {
  const { getAllActiveLoans } = require('../bank');
  const loans = getAllActiveLoans(guildId);
  const perPage = 5;
  const totalPages = Math.ceil(loans.length / perPage) || 1;
  const start = page * perPage;
  const pageLoans = loans.slice(start, start + perPage);

  let description = 'Active loans in the server.\n\n';

  if (pageLoans.length === 0) {
    description += '*No active loans.*';
  } else {
    for (const loan of pageLoans) {
      const remaining = loan.total_owed - loan.amount_paid;
      description += `**Loan #${loan.id}** - <@${loan.user_id}>\n`;
      description += `   💵 Principal: ${loan.principal.toLocaleString()} | Remaining: ${remaining.toLocaleString()}\n`;
      description += `   📅 Next Payment: <t:${Math.floor(loan.next_payment_time / 1000)}:R> | Missed: ${loan.missed_payments}\n\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Active Loans')
    .setDescription(description)
    .setFooter({ text: `Page ${page + 1}/${totalPages} | Total: ${loans.length} loans` });

  const components = [];

  // Add loan selection menu if there are loans
  if (pageLoans.length > 0) {
    const options = pageLoans.map(l => ({
      label: `Loan #${l.id}`,
      description: `${(l.total_owed - l.amount_paid).toLocaleString()} remaining`,
      value: String(l.id)
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`bank_loan_select_${page}`)
      .setPlaceholder('Select a loan to manage...')
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const prevBtn = new ButtonBuilder()
    .setCustomId(`bank_loans_page_${page - 1}`)
    .setLabel('◀️ Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`bank_loans_page_${page + 1}`)
    .setLabel('Next ▶️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);

  const backBtn = new ButtonBuilder()
    .setCustomId('bank_settings')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(prevBtn, nextBtn, backBtn));

  await interaction.editReply({ embeds: [embed], components });
}

async function showLoanDetailPanel(interaction, guildId, loanId) {
  const { getAllActiveLoans } = require('../bank');
  const loans = getAllActiveLoans(guildId);
  const loan = loans.find(l => l.id === parseInt(loanId));
  
  if (!loan) {
    return interaction.editReply({ 
      content: '❌ Loan not found or no longer active.', 
      embeds: [], 
      components: [] 
    });
  }

  const remaining = loan.total_owed - loan.amount_paid;
  const progress = Math.floor((loan.amount_paid / loan.total_owed) * 100);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📊 Loan #${loan.id}`)
    .addFields(
      { name: '👤 Borrower', value: `<@${loan.user_id}>`, inline: true },
      { name: '💵 Principal', value: loan.principal.toLocaleString(), inline: true },
      { name: '📈 Interest Rate', value: `${loan.interest_rate}%`, inline: true },
      { name: '💰 Total Owed', value: loan.total_owed.toLocaleString(), inline: true },
      { name: '✅ Paid', value: loan.amount_paid.toLocaleString(), inline: true },
      { name: '📉 Remaining', value: remaining.toLocaleString(), inline: true },
      { name: '📊 Progress', value: `${progress}%`, inline: true },
      { name: '📅 Payment Amount', value: loan.payment_amount.toLocaleString(), inline: true },
      { name: '⏰ Interval', value: loan.payment_interval, inline: true },
      { name: '📅 Next Payment', value: `<t:${Math.floor(loan.next_payment_time / 1000)}:R>`, inline: true },
      { name: '⚠️ Missed Payments', value: String(loan.missed_payments), inline: true },
      { name: '📆 Created', value: `<t:${Math.floor(loan.created_at / 1000)}:D>`, inline: true }
    );

  const forgiveBtn = new ButtonBuilder()
    .setCustomId(`bank_loan_forgive_${loanId}`)
    .setLabel('🎁 Forgive Loan')
    .setStyle(ButtonStyle.Success);

  const backBtn = new ButtonBuilder()
    .setCustomId('bank_view_loans')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(forgiveBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showActiveBondsPanel(interaction, guildId, page = 0, useEditReply = false) {
  const { getAllActiveBonds } = require('../bank');
  const bonds = getAllActiveBonds(guildId);
  const perPage = 5;
  const totalPages = Math.ceil(bonds.length / perPage) || 1;
  const start = page * perPage;
  const pageBonds = bonds.slice(start, start + perPage);

  // Fetch usernames for all bonds on this page
  const bondUsernames = {};
  for (const bond of pageBonds) {
    try {
      const member = await interaction.guild.members.fetch(bond.user_id);
      bondUsernames[bond.user_id] = member.user.username;
    } catch {
      bondUsernames[bond.user_id] = 'Unknown User';
    }
  }

  let description = 'Active savings bonds in the server.\n\n';

  if (pageBonds.length === 0) {
    description += '*No active bonds.*';
  } else {
    for (const bond of pageBonds) {
      const username = bondUsernames[bond.user_id] || 'Unknown';
      description += `**#${bond.id} ${bond.bond_name}** - ${username}\n`;
      description += `   💵 Paid: ${bond.purchase_price.toLocaleString()} | <@&${bond.role_id}>\n`;
      description += `   📅 Expires: <t:${Math.floor(bond.expires_at / 1000)}:R>\n\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📜 Active Bonds')
    .setDescription(description)
    .setFooter({ text: `Page ${page + 1}/${totalPages} | Total: ${bonds.length} bonds` });

  const components = [];

  // Add delete select menu if there are bonds on this page
  if (pageBonds.length > 0) {
    const selectOptions = pageBonds.map(bond => {
      const username = bondUsernames[bond.user_id] || 'Unknown';
      return {
        label: `#${bond.id} - ${bond.bond_name}`,
        description: `User: ${username}`,
        value: String(bond.id)
      };
    });

    const deleteSelect = new StringSelectMenuBuilder()
      .setCustomId('bank_delete_active_bond')
      .setPlaceholder('🗑️ Select a bond to cancel/remove')
      .addOptions(selectOptions);

    components.push(new ActionRowBuilder().addComponents(deleteSelect));
  }

  const prevBtn = new ButtonBuilder()
    .setCustomId(`bank_activebonds_page_${page - 1}`)
    .setLabel('◀️ Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`bank_activebonds_page_${page + 1}`)
    .setLabel('Next ▶️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);

  const backBtn = new ButtonBuilder()
    .setCustomId('bank_settings')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(prevBtn, nextBtn, backBtn));

  await interaction.editReply({ embeds: [embed], components });
}

// ==================== MODAL BUILDERS ====================
function createBankLoanSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_bank_loan_settings')
    .setTitle('Loan Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('interest_rate')
          .setLabel('Interest Rate (%)')
          .setPlaceholder('5')
          .setValue(String(settings.loanInterestRate))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_amount')
          .setLabel('Minimum Loan Amount')
          .setPlaceholder('1000')
          .setValue(String(settings.loanMinAmount))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_amount')
          .setLabel('Maximum Loan Amount')
          .setPlaceholder('100000')
          .setValue(String(settings.loanMaxAmount))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration Range (min-max days)')
          .setPlaceholder('1-30')
          .setValue(`${settings.loanMinDuration}-${settings.loanMaxDuration}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('penalty')
          .setLabel('Missed Payment Penalty (%) / Max Missed')
          .setPlaceholder('10/3')
          .setValue(`${settings.loanMissedPaymentPenalty}/${settings.loanMaxMissedPayments}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createBankRequirementsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_bank_criteria')
    .setTitle('Loan Requirements')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_properties')
          .setLabel('Minimum Properties Required')
          .setPlaceholder('1')
          .setValue(String(settings.loanMinProperties))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_portfolio')
          .setLabel('Minimum Portfolio Value')
          .setPlaceholder('10000')
          .setValue(String(settings.loanMinPortfolioValue))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_tenure')
          .setLabel('Minimum Server Tenure (days)')
          .setPlaceholder('30')
          .setValue(String(settings.loanMinTenureDays))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createBondTierModal(bond = null) {
  const isEdit = bond !== null;
  return new ModalBuilder()
    .setCustomId(isEdit ? `modal_bank_bond_edit_${bond.id}` : 'modal_bank_bond_add')
    .setTitle(isEdit ? 'Edit Bond Tier' : 'Add Bond Tier')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Bond Name')
          .setPlaceholder('Silver Bond')
          .setValue(isEdit ? bond.name : '')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('price')
          .setLabel('Price')
          .setPlaceholder('10000')
          .setValue(isEdit ? String(bond.price) : '')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration (days)')
          .setPlaceholder('30')
          .setValue(isEdit ? String(bond.duration_days) : '')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showBankPanel,
  showBankLoanSettingsPanel,
  showBankRequirementsPanel,
  showBondTiersPanel,
  showBondEditPanel,
  showBondRoleSelectPanel,
  showActiveLoansPanel,
  showLoanDetailPanel,
  showActiveBondsPanel,
  createBankLoanSettingsModal,
  createBankRequirementsModal,
  createBondTierModal
};
