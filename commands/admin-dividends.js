// Admin Dividends Panel - Fully Modular with handleInteraction
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction } = require('../admin');

const CURRENCY = '<:babybel:1418824333664452608>';

// ==================== INTERACTION IDS ====================
const BUTTON_IDS = [
  'dividend_toggle',
  'dividend_edit_settings',
  'dividend_self_toggle',
  'dividend_passive_toggle',
  'dividend_passive_edit',
  'dividend_role_income',
  'dividend_back',
  'role_income_add'
];

const BUTTON_PREFIXES = [
  'role_income_edit_',
  'role_income_toggle_',
  'role_income_delete_'
];

const MODAL_IDS = [
  'modal_dividend_settings',
  'modal_passive_settings',
  'modal_role_income_add'
];

const MODAL_PREFIXES = [
  'modal_role_income_edit_'
];

const SELECT_IDS = [
  'role_income_select'
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
  if (interaction.isStringSelectMenu()) {
    if (SELECT_IDS.includes(customId)) {
      return await handleSelect(interaction, guildId, customId);
    }
  }

  return false;
}

// ==================== BUTTON HANDLER ====================
async function handleButton(interaction, guildId, customId) {
  const { getDividendSettings, updateDividendSettings, getRoleIncomes, toggleRoleIncome, removeRoleIncome } = require('../dividends');

  // Toggle dividends
  if (customId === 'dividend_toggle') {
    const settings = getDividendSettings(guildId);
    updateDividendSettings(guildId, { enabled: !settings.enabled });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled dividends ${!settings.enabled ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showDividendPanel(interaction, guildId);
    return true;
  }

  // Edit dividend settings
  if (customId === 'dividend_edit_settings') {
    const settings = getDividendSettings(guildId);
    const modal = createDividendSettingsModal(settings);
    await interaction.showModal(modal);
    return true;
  }

  // Toggle CEO self dividend
  if (customId === 'dividend_self_toggle') {
    const settings = getDividendSettings(guildId);
    updateDividendSettings(guildId, { selfDividendEnabled: !settings.selfDividendEnabled });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled CEO bonus ${!settings.selfDividendEnabled ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showDividendPanel(interaction, guildId);
    return true;
  }

  // Toggle passive income
  if (customId === 'dividend_passive_toggle') {
    const settings = getDividendSettings(guildId);
    updateDividendSettings(guildId, { passiveIncomeEnabled: !settings.passiveIncomeEnabled });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled passive income ${!settings.passiveIncomeEnabled ? 'ON' : 'OFF'}`);
    await interaction.deferUpdate();
    await showDividendPanel(interaction, guildId);
    return true;
  }

  // Edit passive income settings
  if (customId === 'dividend_passive_edit') {
    const settings = getDividendSettings(guildId);
    const modal = createPassiveSettingsModal(settings);
    await interaction.showModal(modal);
    return true;
  }

  // Show role income panel
  if (customId === 'dividend_role_income') {
    await interaction.deferUpdate();
    await showRoleIncomePanel(interaction, guildId);
    return true;
  }

  // Back to dividend panel
  if (customId === 'dividend_back') {
    await interaction.deferUpdate();
    await showDividendPanel(interaction, guildId);
    return true;
  }

  // Add role income button
  if (customId === 'role_income_add') {
    const modal = createRoleIncomeAddModal();
    await interaction.showModal(modal);
    return true;
  }

  // Role income edit button (dynamic ID)
  if (customId.startsWith('role_income_edit_')) {
    const roleIncomeId = parseInt(customId.replace('role_income_edit_', ''));
    const roleIncomes = getRoleIncomes(guildId);
    const ri = roleIncomes.find(r => r.id === roleIncomeId);
    if (ri) {
      const modal = createRoleIncomeEditModal(ri);
      await interaction.showModal(modal);
    }
    return true;
  }

  // Role income toggle button (dynamic ID)
  if (customId.startsWith('role_income_toggle_')) {
    const roleIncomeId = parseInt(customId.replace('role_income_toggle_', ''));
    const roleIncomes = getRoleIncomes(guildId);
    const ri = roleIncomes.find(r => r.id === roleIncomeId);
    if (ri) {
      toggleRoleIncome(guildId, ri.role_id);
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled role income for role ${ri.role_id}`);
    }
    await interaction.deferUpdate();
    await showRoleIncomeEditPanel(interaction, guildId, roleIncomeId);
    return true;
  }

  // Role income delete button (dynamic ID)
  if (customId.startsWith('role_income_delete_')) {
    const roleIncomeId = parseInt(customId.replace('role_income_delete_', ''));
    const roleIncomes = getRoleIncomes(guildId);
    const ri = roleIncomes.find(r => r.id === roleIncomeId);
    if (ri) {
      removeRoleIncome(guildId, ri.role_id);
      logAdminAction(guildId, interaction.user.id, interaction.user.username, `Deleted role income for role ${ri.role_id}`);
    }
    await interaction.deferUpdate();
    await showRoleIncomePanel(interaction, guildId);
    return true;
  }

  return false;
}

// ==================== MODAL HANDLER ====================
async function handleModal(interaction, guildId, customId) {
  const { updateDividendSettings, addRoleIncome, updateRoleIncome, getRoleIncomes } = require('../dividends');

  // Dividend settings modal
  if (customId === 'modal_dividend_settings') {
    const dividendRate = parseFloat(interaction.fields.getTextInputValue('dividend_rate'));
    const payoutFrequency = interaction.fields.getTextInputValue('payout_frequency').toLowerCase();
    const payoutHour = parseInt(interaction.fields.getTextInputValue('payout_hour'));
    const minShares = parseInt(interaction.fields.getTextInputValue('min_shares'));
    const minPrice = parseInt(interaction.fields.getTextInputValue('min_price'));

    if (isNaN(dividendRate) || dividendRate < 0 || dividendRate > 100) {
      await interaction.reply({ content: '❌ Dividend rate must be between 0 and 100.', flags: 64 });
      return true;
    }
    if (!['daily', 'weekly', 'biweekly'].includes(payoutFrequency)) {
      await interaction.reply({ content: '❌ Frequency must be daily, weekly, or biweekly.', flags: 64 });
      return true;
    }
    if (isNaN(payoutHour) || payoutHour < 0 || payoutHour > 23) {
      await interaction.reply({ content: '❌ Payout hour must be between 0 and 23.', flags: 64 });
      return true;
    }
    if (isNaN(minShares) || minShares < 0) {
      await interaction.reply({ content: '❌ Minimum shares must be 0 or greater.', flags: 64 });
      return true;
    }
    if (isNaN(minPrice) || minPrice < 0) {
      await interaction.reply({ content: '❌ Minimum price must be 0 or greater.', flags: 64 });
      return true;
    }

    updateDividendSettings(guildId, {
      dividendRate,
      payoutFrequency,
      dividendPayoutHour: payoutHour,
      minSharesForDividend: minShares,
      minPriceForDividend: minPrice
    });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated dividend settings: rate=${dividendRate}%, freq=${payoutFrequency}, hour=${payoutHour}`);
    await interaction.deferUpdate();
    await showDividendPanel(interaction, guildId);
    return true;
  }

  // Passive income settings modal
  if (customId === 'modal_passive_settings') {
    const passiveRate = parseFloat(interaction.fields.getTextInputValue('passive_rate'));
    const passiveCooldown = parseInt(interaction.fields.getTextInputValue('passive_cooldown'));
    const selfRate = parseFloat(interaction.fields.getTextInputValue('self_rate'));

    if (isNaN(passiveRate) || passiveRate < 0 || passiveRate > 100) {
      await interaction.reply({ content: '❌ Passive rate must be between 0 and 100.', flags: 64 });
      return true;
    }
    if (isNaN(passiveCooldown) || passiveCooldown < 1) {
      await interaction.reply({ content: '❌ Cooldown must be at least 1 hour.', flags: 64 });
      return true;
    }
    if (isNaN(selfRate) || selfRate < 0 || selfRate > 100) {
      await interaction.reply({ content: '❌ Self dividend rate must be between 0 and 100.', flags: 64 });
      return true;
    }

    updateDividendSettings(guildId, {
      passiveIncomeRate: passiveRate,
      passiveIncomeCooldown: passiveCooldown,
      selfDividendRate: selfRate
    });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated passive settings: rate=${passiveRate}%, cooldown=${passiveCooldown}h, selfRate=${selfRate}%`);
    await interaction.deferUpdate();
    await showDividendPanel(interaction, guildId);
    return true;
  }

  // Add role income modal
  if (customId === 'modal_role_income_add') {
    const roleName = interaction.fields.getTextInputValue('role_name');
    const amount = parseInt(interaction.fields.getTextInputValue('amount'));
    const cooldown = parseInt(interaction.fields.getTextInputValue('cooldown'));

    const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) {
      await interaction.reply({ content: `❌ Role not found: "${roleName}"`, flags: 64 });
      return true;
    }
    if (isNaN(amount) || amount <= 0) {
      await interaction.reply({ content: '❌ Amount must be a positive number.', flags: 64 });
      return true;
    }
    if (isNaN(cooldown) || cooldown < 1) {
      await interaction.reply({ content: '❌ Cooldown must be at least 1 hour.', flags: 64 });
      return true;
    }

    addRoleIncome(guildId, role.id, role.name, amount, cooldown);
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Added role income for ${role.name}: ${amount} every ${cooldown}h`);
    await interaction.deferUpdate();
    await showRoleIncomePanel(interaction, guildId);
    return true;
  }

  // Edit role income modal (dynamic ID)
  if (customId.startsWith('modal_role_income_edit_')) {
    const roleIncomeId = parseInt(customId.replace('modal_role_income_edit_', ''));
    const roleIncomes = getRoleIncomes(guildId);
    const ri = roleIncomes.find(r => r.id === roleIncomeId);

    if (!ri) {
      await interaction.reply({ content: '❌ Role income not found.', flags: 64 });
      return true;
    }

    const amount = parseInt(interaction.fields.getTextInputValue('amount'));
    const cooldown = parseInt(interaction.fields.getTextInputValue('cooldown'));

    if (isNaN(amount) || amount <= 0) {
      await interaction.reply({ content: '❌ Amount must be a positive number.', flags: 64 });
      return true;
    }
    if (isNaN(cooldown) || cooldown < 1) {
      await interaction.reply({ content: '❌ Cooldown must be at least 1 hour.', flags: 64 });
      return true;
    }

    updateRoleIncome(guildId, ri.role_id, { amount, cooldown_hours: cooldown });
    logAdminAction(guildId, interaction.user.id, interaction.user.username, `Updated role income for role ${ri.role_id}: ${amount} every ${cooldown}h`);
    await interaction.deferUpdate();
    await showRoleIncomeEditPanel(interaction, guildId, roleIncomeId);
    return true;
  }

  return false;
}

// ==================== SELECT HANDLER ====================
async function handleSelect(interaction, guildId, customId) {
  // Role income select dropdown
  if (customId === 'role_income_select') {
    const roleIncomeId = parseInt(interaction.values[0]);
    await interaction.deferUpdate();
    await showRoleIncomeEditPanel(interaction, guildId, roleIncomeId);
    return true;
  }

  return false;
}

// ==================== PANEL DISPLAYS ====================
async function showDividendPanel(interaction, guildId) {
  const { getDividendSettings } = require('../dividends');
  const settings = getDividendSettings(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📈 Dividend Settings')
    .setDescription('Manage dividend payouts and passive income')
    .addFields(
      { name: '📊 Dividends', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '💵 Rate', value: `${settings.dividendRate}%`, inline: true },
      { name: '📅 Frequency', value: settings.payoutFrequency, inline: true },
      { name: '🕐 Payout Hour', value: `${settings.dividendPayoutHour}:00`, inline: true },
      { name: '📉 Min Shares', value: settings.minSharesForDividend.toString(), inline: true },
      { name: '💰 Min Price', value: settings.minPriceForDividend.toLocaleString(), inline: true },
      { name: '\u200B', value: '**CEO Bonus**', inline: false },
      { name: '🎖️ CEO Bonus', value: settings.selfDividendEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📈 Self Rate', value: `${settings.selfDividendRate}%`, inline: true },
      { name: '\u200B', value: '**Passive Income**', inline: false },
      { name: '💸 Passive Income', value: settings.passiveIncomeEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📊 Passive Rate', value: `${settings.passiveIncomeRate}%`, inline: true },
      { name: '⏱️ Cooldown', value: `${settings.passiveIncomeCooldown}h`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('dividend_toggle')
    .setLabel(settings.enabled ? 'Disable Dividends' : 'Enable Dividends')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('dividend_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const selfToggleBtn = new ButtonBuilder()
    .setCustomId('dividend_self_toggle')
    .setLabel(settings.selfDividendEnabled ? 'Disable CEO Bonus' : 'Enable CEO Bonus')
    .setStyle(settings.selfDividendEnabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const passiveToggleBtn = new ButtonBuilder()
    .setCustomId('dividend_passive_toggle')
    .setLabel(settings.passiveIncomeEnabled ? 'Disable Passive' : 'Enable Passive')
    .setStyle(settings.passiveIncomeEnabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const passiveEditBtn = new ButtonBuilder()
    .setCustomId('dividend_passive_edit')
    .setLabel('✏️ Edit Passive/CEO')
    .setStyle(ButtonStyle.Secondary);

  const roleIncomeBtn = new ButtonBuilder()
    .setCustomId('dividend_role_income')
    .setLabel('🎭 Role Income')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(toggleBtn, editBtn, selfToggleBtn, passiveToggleBtn);
  const row2 = new ActionRowBuilder().addComponents(passiveEditBtn, roleIncomeBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function showRoleIncomePanel(interaction, guildId) {
  const { getRoleIncomes } = require('../dividends');
  const roleIncomes = getRoleIncomes(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎭 Role Income Settings')
    .setDescription('Configure income that users can collect based on their roles.');

  if (roleIncomes.length === 0) {
    embed.addFields({ name: 'No Role Incomes', value: '*No role incomes configured yet.*' });
  } else {
    const chunkSize = 10;
    for (let i = 0; i < roleIncomes.length; i += chunkSize) {
      const chunk = roleIncomes.slice(i, i + chunkSize);
      let fieldValue = '';
      for (const ri of chunk) {
        const status = ri.enabled ? '✅' : '❌';
        fieldValue += `${status} <@&${ri.role_id}> - **${ri.amount.toLocaleString()}** ${CURRENCY} every ${ri.cooldown_hours}h\n`;
      }
      const fieldName = i === 0 ? `Role Incomes (${roleIncomes.length} total)` : '\u200B';
      embed.addFields({ name: fieldName, value: fieldValue });
    }
  }

  const components = [];

  if (roleIncomes.length > 0) {
    const options = roleIncomes.slice(0, 25).map(ri => ({
      label: `Role ID: ${ri.role_id.slice(-6)}`,
      description: `${ri.amount.toLocaleString()} every ${ri.cooldown_hours}h - ${ri.enabled ? 'Enabled' : 'Disabled'}`,
      value: String(ri.id)
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('role_income_select')
      .setPlaceholder('Select a role income to edit...')
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const addBtn = new ButtonBuilder()
    .setCustomId('role_income_add')
    .setLabel('➕ Add Role Income')
    .setStyle(ButtonStyle.Success);

  const backBtn = new ButtonBuilder()
    .setCustomId('dividend_back')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(addBtn, backBtn));

  await interaction.editReply({ embeds: [embed], components });
}

async function showRoleIncomeEditPanel(interaction, guildId, roleIncomeId) {
  const { getRoleIncomes } = require('../dividends');
  const roleIncomes = getRoleIncomes(guildId);
  const ri = roleIncomes.find(r => r.id === roleIncomeId);

  if (!ri) {
    return interaction.editReply({ content: '❌ Role income not found.', embeds: [], components: [] });
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('✏️ Edit Role Income')
    .addFields(
      { name: '🎭 Role', value: `<@&${ri.role_id}>`, inline: true },
      { name: '💵 Amount', value: `${ri.amount.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '⏱️ Cooldown', value: `${ri.cooldown_hours} hours`, inline: true },
      { name: '📊 Status', value: ri.enabled ? '✅ Enabled' : '❌ Disabled', inline: true }
    );

  const editBtn = new ButtonBuilder()
    .setCustomId(`role_income_edit_${roleIncomeId}`)
    .setLabel('✏️ Edit Amount/Cooldown')
    .setStyle(ButtonStyle.Primary);

  const toggleBtn = new ButtonBuilder()
    .setCustomId(`role_income_toggle_${roleIncomeId}`)
    .setLabel(ri.enabled ? 'Disable' : 'Enable')
    .setStyle(ri.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const deleteBtn = new ButtonBuilder()
    .setCustomId(`role_income_delete_${roleIncomeId}`)
    .setLabel('🗑️ Delete')
    .setStyle(ButtonStyle.Danger);

  const backBtn = new ButtonBuilder()
    .setCustomId('dividend_role_income')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(editBtn, toggleBtn, deleteBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== MODAL BUILDERS ====================
function createDividendSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_dividend_settings')
    .setTitle('Dividend Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dividend_rate')
          .setLabel('Dividend Rate (%)')
          .setPlaceholder('0.5')
          .setValue(String(settings.dividendRate))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('payout_frequency')
          .setLabel('Frequency (daily/weekly/biweekly)')
          .setPlaceholder('daily')
          .setValue(settings.payoutFrequency)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('payout_hour')
          .setLabel('Payout Hour (0-23)')
          .setPlaceholder('12')
          .setValue(String(settings.dividendPayoutHour))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_shares')
          .setLabel('Minimum Shares for Dividend')
          .setPlaceholder('1')
          .setValue(String(settings.minSharesForDividend))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_price')
          .setLabel('Minimum Stock Price for Dividend')
          .setPlaceholder('100')
          .setValue(String(settings.minPriceForDividend))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createPassiveSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('modal_passive_settings')
    .setTitle('Passive Income & CEO Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('passive_rate')
          .setLabel('Passive Income Rate (%)')
          .setPlaceholder('0.1')
          .setValue(String(settings.passiveIncomeRate ?? 0.1))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('passive_cooldown')
          .setLabel('Passive Income Cooldown (hours)')
          .setPlaceholder('24')
          .setValue(String(settings.passiveIncomeCooldown ?? 2))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('self_rate')
          .setLabel('CEO Self-Dividend Rate (%)')
          .setPlaceholder('0.5')
          .setValue(String(settings.selfDividendRate ?? 5))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createRoleIncomeAddModal() {
  return new ModalBuilder()
    .setCustomId('modal_role_income_add')
    .setTitle('Add Role Income')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('role_name')
          .setLabel('Role Name (exact match)')
          .setPlaceholder('VIP Member')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('Income Amount')
          .setPlaceholder('1000')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown')
          .setLabel('Cooldown (hours)')
          .setPlaceholder('24')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function createRoleIncomeEditModal(ri) {
  return new ModalBuilder()
    .setCustomId(`modal_role_income_edit_${ri.id}`)
    .setTitle('Edit Role Income')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('Income Amount')
          .setPlaceholder('1000')
          .setValue(String(ri.amount))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown')
          .setLabel('Cooldown (hours)')
          .setPlaceholder('24')
          .setValue(String(ri.cooldown_hours))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showDividendPanel,
  showRoleIncomePanel,
  showRoleIncomeEditPanel,
  createDividendSettingsModal,
  createRoleIncomeAddModal,
  createRoleIncomeEditModal
};
