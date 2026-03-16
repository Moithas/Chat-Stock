// Admin Infamy Panel - Infamy & Bounty settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { logAdminAction, getCurrency } = require('../admin');
const { getInfamySettings, updateInfamySettings, INFAMY_TIERS } = require('../infamy');



// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_infamy',
  'infamy_toggle', 'infamy_edit_tiers', 'infamy_edit_rates',
  'infamy_edit_bounty', 'infamy_edit_misc', 'infamy_set_channel',
  'back_infamy'
];

const MODAL_IDS = [
  'modal_infamy_tiers',
  'modal_infamy_rates',
  'modal_infamy_bounty',
  'modal_infamy_misc'
];

const SELECT_IDS = [
  'infamy_channel_select'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;

  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;

    switch (customId) {
      case 'admin_infamy':
        await interaction.deferUpdate();
        await showInfamyPanel(interaction, guildId);
        return true;
      case 'infamy_toggle':
        await interaction.deferUpdate();
        await handleToggle(interaction, guildId);
        return true;
      case 'infamy_edit_tiers':
        await showTiersModal(interaction, guildId);
        return true;
      case 'infamy_edit_rates':
        await showRatesModal(interaction, guildId);
        return true;
      case 'infamy_edit_bounty':
        await showBountyModal(interaction, guildId);
        return true;
      case 'infamy_edit_misc':
        await showMiscModal(interaction, guildId);
        return true;
      case 'infamy_set_channel':
        await interaction.deferUpdate();
        await showChannelSelect(interaction, guildId);
        return true;
      case 'back_infamy':
        await interaction.deferUpdate();
        await showInfamyPanel(interaction, guildId);
        return true;
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;

    switch (customId) {
      case 'modal_infamy_tiers':
        await handleTiersModal(interaction, guildId);
        return true;
      case 'modal_infamy_rates':
        await handleRatesModal(interaction, guildId);
        return true;
      case 'modal_infamy_bounty':
        await handleBountyModal(interaction, guildId);
        return true;
      case 'modal_infamy_misc':
        await handleMiscModal(interaction, guildId);
        return true;
    }
  }

  // Handle channel select
  if (interaction.isChannelSelectMenu()) {
    if (customId !== 'infamy_channel_select') return false;
    await handleChannelSelect(interaction, guildId);
    return true;
  }

  return false;
}

// ==================== INFAMY PANEL ====================
async function showInfamyPanel(interaction, guildId) {
  const settings = getInfamySettings(guildId);

  const embed = new EmbedBuilder()
    .setColor(settings.enabled ? 0xff0000 : 0x95a5a6)
    .setTitle('🏴‍☠️ Infamy & Bounty Settings')
    .setDescription(settings.enabled ? '✅ Infamy system is **ENABLED**' : '❌ Infamy system is **DISABLED**')
    .addFields(
      {
        name: '📊 Tier Thresholds',
        value:
          `T0 Clean: 0–${settings.t0_max.toLocaleString()}\n` +
          `T1 Suspect: ${(settings.t0_max + 1).toLocaleString()}–${settings.t1_max.toLocaleString()}\n` +
          `T2 Criminal: ${(settings.t1_max + 1).toLocaleString()}–${settings.t2_max.toLocaleString()}\n` +
          `T3 Wanted: ${(settings.t2_max + 1).toLocaleString()}–${settings.t3_max.toLocaleString()}\n` +
          `T4 Most Wanted: ${(settings.t3_max + 1).toLocaleString()}–${settings.t4_max.toLocaleString()}\n` +
          `T5 Blacklisted: ${(settings.t4_max + 1).toLocaleString()}+`,
        inline: true
      },
      {
        name: '📈 Infamy Rates',
        value:
          `💻 Hack: ${settings.hack_rate}× stolen\n` +
          `💰 Rob: ${settings.rob_rate}× stolen\n` +
          `🏦 Vault: ${settings.vault_rate}× collected\n` +
          `📊 Insider: ${settings.insider_flat.toLocaleString()} flat`,
        inline: true
      },
      {
        name: '🎯 Bounty Chances',
        value:
          `T3: ${settings.bounty_t3_chance}%\n` +
          `T4: ${settings.bounty_t4_chance}%\n` +
          `T5: ${settings.bounty_t5_chance}%`,
        inline: true
      },
      {
        name: '⚙️ Other Settings',
        value:
          `📉 Decay: ${settings.decay_per_hour}/hour\n` +
          `🏰 Dungeon reduction: ${settings.dungeon_reduction}/floor\n` +
          `🎁 Charity rate: ${settings.charity_rate}× debt cleared\n` +
          `⚖️ Probation: ${settings.probation_days_per_tier} day(s)/tier\n` +
          `📢 Channel: ${settings.announce_channel_id ? `<#${settings.announce_channel_id}>` : 'Not set'}`,
        inline: false
      }
    )
    .setFooter({ text: 'Infamy & Bounty System' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('infamy_toggle').setLabel(settings.enabled ? '❌ Disable' : '✅ Enable').setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('infamy_edit_tiers').setLabel('📊 Tiers').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('infamy_edit_rates').setLabel('📈 Rates').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('infamy_edit_bounty').setLabel('🎯 Bounty').setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('infamy_edit_misc').setLabel('⚙️ Misc').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('infamy_set_channel').setLabel('📢 Channel').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('back_dashboard').setLabel('◀ Dashboard').setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== TOGGLE ====================
async function handleToggle(interaction, guildId) {
  const settings = getInfamySettings(guildId);
  const newEnabled = settings.enabled ? 0 : 1;
  updateInfamySettings(guildId, { enabled: newEnabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'INFAMY_TOGGLE', `${newEnabled ? 'Enabled' : 'Disabled'} infamy system`);
  await showInfamyPanel(interaction, guildId);
}

// ==================== TIERS MODAL ====================
async function showTiersModal(interaction, guildId) {
  const settings = getInfamySettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_infamy_tiers')
    .setTitle('Edit Tier Thresholds');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t0_max')
        .setLabel('T0 Clean max (default 14999)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.t0_max))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t1_max')
        .setLabel('T1 Suspect max (default 29999)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.t1_max))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t2_max')
        .setLabel('T2 Criminal max (default 59999)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.t2_max))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t3_max')
        .setLabel('T3 Wanted max (default 99999)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.t3_max))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t4_max')
        .setLabel('T4 Most Wanted max (default 149999)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.t4_max))
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleTiersModal(interaction, guildId) {
  const t0 = parseInt(interaction.fields.getTextInputValue('t0_max'));
  const t1 = parseInt(interaction.fields.getTextInputValue('t1_max'));
  const t2 = parseInt(interaction.fields.getTextInputValue('t2_max'));
  const t3 = parseInt(interaction.fields.getTextInputValue('t3_max'));
  const t4 = parseInt(interaction.fields.getTextInputValue('t4_max'));

  if ([t0, t1, t2, t3, t4].some(v => isNaN(v) || v < 0)) {
    return interaction.reply({ content: '❌ All values must be positive numbers.', flags: 64 });
  }
  if (!(t0 < t1 && t1 < t2 && t2 < t3 && t3 < t4)) {
    return interaction.reply({ content: '❌ Thresholds must be in ascending order (T0 < T1 < T2 < T3 < T4).', flags: 64 });
  }

  await interaction.deferUpdate();
  updateInfamySettings(guildId, { t0_max: t0, t1_max: t1, t2_max: t2, t3_max: t3, t4_max: t4 });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'INFAMY_TIERS',
    `Updated tiers: T0=${t0}, T1=${t1}, T2=${t2}, T3=${t3}, T4=${t4}`);
  await showInfamyPanel(interaction, guildId);
}

// ==================== RATES MODAL ====================
async function showRatesModal(interaction, guildId) {
  const settings = getInfamySettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_infamy_rates')
    .setTitle('Edit Infamy Rates');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('hack_rate')
        .setLabel('Hack rate (× stolen amount, default 0.2)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.hack_rate))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rob_rate')
        .setLabel('Rob rate (× stolen amount, default 0.5)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.rob_rate))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('vault_rate')
        .setLabel('Vault rate (× collected amount, default 1.0)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.vault_rate))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('insider_flat')
        .setLabel('Insider trading flat (per stock, def 1000)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.insider_flat))
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleRatesModal(interaction, guildId) {
  const hackRate = parseFloat(interaction.fields.getTextInputValue('hack_rate'));
  const robRate = parseFloat(interaction.fields.getTextInputValue('rob_rate'));
  const vaultRate = parseFloat(interaction.fields.getTextInputValue('vault_rate'));
  const insiderFlat = parseInt(interaction.fields.getTextInputValue('insider_flat'));

  if ([hackRate, robRate, vaultRate].some(v => isNaN(v) || v < 0) || isNaN(insiderFlat) || insiderFlat < 0) {
    return interaction.reply({ content: '❌ All values must be non-negative numbers.', flags: 64 });
  }

  await interaction.deferUpdate();
  updateInfamySettings(guildId, { hack_rate: hackRate, rob_rate: robRate, vault_rate: vaultRate, insider_flat: insiderFlat });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'INFAMY_RATES',
    `Updated rates: hack=${hackRate}, rob=${robRate}, vault=${vaultRate}, insider=${insiderFlat}`);
  await showInfamyPanel(interaction, guildId);
}

// ==================== BOUNTY MODAL ====================
async function showBountyModal(interaction, guildId) {
  const settings = getInfamySettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_infamy_bounty')
    .setTitle('Edit Bounty Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t3_chance')
        .setLabel('T3 bounty roll chance % (default 15)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.bounty_t3_chance))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t4_chance')
        .setLabel('T4 bounty roll chance % (default 30)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.bounty_t4_chance))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('t5_chance')
        .setLabel('T5 bounty roll chance % (default 50)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.bounty_t5_chance))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('probation_days')
        .setLabel('Probation days per tier (default 1)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.probation_days_per_tier))
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleBountyModal(interaction, guildId) {
  const t3 = parseInt(interaction.fields.getTextInputValue('t3_chance'));
  const t4 = parseInt(interaction.fields.getTextInputValue('t4_chance'));
  const t5 = parseInt(interaction.fields.getTextInputValue('t5_chance'));
  const probDays = parseInt(interaction.fields.getTextInputValue('probation_days'));

  if ([t3, t4, t5, probDays].some(v => isNaN(v) || v < 0)) {
    return interaction.reply({ content: '❌ All values must be non-negative numbers.', flags: 64 });
  }

  await interaction.deferUpdate();
  updateInfamySettings(guildId, {
    bounty_t3_chance: t3, bounty_t4_chance: t4, bounty_t5_chance: t5,
    probation_days_per_tier: probDays
  });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'INFAMY_BOUNTY',
    `Updated bounty: T3=${t3}%, T4=${t4}%, T5=${t5}%, probation=${probDays}d/tier`);
  await showInfamyPanel(interaction, guildId);
}

// ==================== MISC MODAL ====================
async function showMiscModal(interaction, guildId) {
  const settings = getInfamySettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_infamy_misc')
    .setTitle('Edit Misc Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('decay_rate')
        .setLabel('Passive decay per hour (default 1)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.decay_per_hour))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dungeon_reduction')
        .setLabel('Dungeon floor reduction (default 25)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.dungeon_reduction))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('charity_rate')
        .setLabel('Charity rate (× debt cleared, default 0.1)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(settings.charity_rate))
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleMiscModal(interaction, guildId) {
  const decay = parseFloat(interaction.fields.getTextInputValue('decay_rate'));
  const dungeon = parseInt(interaction.fields.getTextInputValue('dungeon_reduction'));
  const charity = parseFloat(interaction.fields.getTextInputValue('charity_rate'));

  if ([decay, charity].some(v => isNaN(v) || v < 0) || isNaN(dungeon) || dungeon < 0) {
    return interaction.reply({ content: '❌ All values must be non-negative numbers.', flags: 64 });
  }

  await interaction.deferUpdate();
  updateInfamySettings(guildId, { decay_per_hour: decay, dungeon_reduction: dungeon, charity_rate: charity });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'INFAMY_MISC',
    `Updated misc: decay=${decay}/hr, dungeon=${dungeon}/floor, charity=${charity}×`);
  await showInfamyPanel(interaction, guildId);
}

// ==================== CHANNEL SELECT ====================
async function showChannelSelect(interaction, guildId) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('📢 Select Announcement Channel')
    .setDescription('Choose the channel where bounty & infamy announcements will be posted.');

  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('infamy_channel_select')
      .setPlaceholder('Select a channel...')
      .setChannelTypes(ChannelType.GuildText)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('back_infamy').setLabel('◀ Back').setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row, backRow] });
}

async function handleChannelSelect(interaction, guildId) {
  const channelId = interaction.values[0];
  await interaction.deferUpdate();
  updateInfamySettings(guildId, { announce_channel_id: channelId });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, 'INFAMY_CHANNEL',
    `Set announcement channel to ${channelId}`);
  await showInfamyPanel(interaction, guildId);
}

// ==================== EXPORTS ====================
module.exports = {
  showInfamyPanel,
  handleInteraction
};
