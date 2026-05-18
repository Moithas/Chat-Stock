// /admin-minecraft — unified admin panel for the Minecraft reward system
// Replaces /admin-mc (set-channel, sync, audit, unlink, stats, settings, reset-sessions).

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelSelectMenuBuilder, UserSelectMenuBuilder, ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const { hasAdminPermission, logAdminAction } = require('../admin');
const {
  getMcSettings, setMcChannel, upsertSettings,
  getAllLinks, unlinkUser, getOpenSessions, clearOpenSessions,
  getRecentSyncLogs, processSync
} = require('../mc-rewards');

const PANEL_VIEW = {
  OVERVIEW: 'overview',
  AUDIT: 'audit',
  STATS: 'stats',
  CHANNEL: 'channel',
  UNLINK: 'unlink',
  CONFIRM_RESET: 'confirm_reset'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-minecraft')
    .setDescription('Admin panel for the Minecraft activity reward system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!hasAdminPermission(interaction.member, interaction.guildId)) {
      return interaction.reply({ content: '❌ You don\'t have permission to use this.', ephemeral: true });
    }
    const payload = buildPanel(interaction.guildId, PANEL_VIEW.OVERVIEW);
    return interaction.reply({ ...payload, ephemeral: true });
  },

  // Wired from bot.js interaction router
  handleButton,
  handleChannelSelect,
  handleUserSelect,
  handleMcSyncModal,
  handleMcSettingsModal
};

// ───────────────────────────────────────────── panel views ─────────────────────────────────────────────

function buildPanel(guildId, view) {
  if (view === PANEL_VIEW.AUDIT) return buildAuditView(guildId);
  if (view === PANEL_VIEW.STATS) return buildStatsView(guildId);
  if (view === PANEL_VIEW.CHANNEL) return buildChannelView(guildId);
  if (view === PANEL_VIEW.UNLINK) return buildUnlinkView(guildId);
  if (view === PANEL_VIEW.CONFIRM_RESET) return buildConfirmResetView(guildId);
  return buildOverviewView(guildId);
}

function buildOverviewView(guildId) {
  const settings = getMcSettings(guildId);
  const links = getAllLinks(guildId);
  const open = getOpenSessions(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎮 Minecraft Admin Panel')
    .setDescription('Overview of the Minecraft activity reward system. Use the buttons below to manage it.')
    .addFields(
      { name: 'Summary channel', value: settings.channelId ? `<#${settings.channelId}>` : '_not set_', inline: true },
      { name: 'Reward', value: `+${settings.rewardPerBlock} per ${settings.minutesPerBlock}m`, inline: true },
      { name: 'Daily cap', value: `+${settings.dailyCap}`, inline: true },
      { name: 'Linked players', value: String(links.length), inline: true },
      { name: 'Open sessions', value: String(open.length), inline: true },
      { name: 'Last sync', value: settings.lastSyncTs ? `<t:${Math.floor(settings.lastSyncTs / 1000)}:R>` : '_never_', inline: true }
    );

  return { embeds: [embed], components: buildMainButtonRows() };
}

function buildAuditView(guildId) {
  const links = getAllLinks(guildId);
  const open = getOpenSessions(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎮 Audit — Linked Players & Open Sessions');

  if (links.length > 0) {
    const linkLines = links.slice(0, 20).map(l => `<@${l.discord_id}> → \`${l.mc_username_display}\``);
    if (links.length > 20) linkLines.push(`_…and ${links.length - 20} more_`);
    embed.addFields({ name: `🔗 Linked players (${links.length})`, value: linkLines.join('\n'), inline: false });
  } else {
    embed.addFields({ name: '🔗 Linked players', value: '_no one is linked yet_', inline: false });
  }

  if (open.length > 0) {
    const openLines = open.slice(0, 15).map(o =>
      `\`${o.mc_username_display}\` — joined <t:${Math.floor(o.joined_at / 1000)}:R>`);
    if (open.length > 15) openLines.push(`_…and ${open.length - 15} more_`);
    embed.addFields({ name: `🟢 Open sessions (${open.length})`, value: openLines.join('\n'), inline: false });
  } else {
    embed.addFields({ name: '🟢 Open sessions', value: '_none_', inline: false });
  }

  return { embeds: [embed], components: buildBackRow() };
}

function buildStatsView(guildId) {
  const logs = getRecentSyncLogs(guildId, 10);
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎮 Recent Sync History');

  if (logs.length === 0) {
    embed.setDescription('_No syncs recorded yet._');
  } else {
    embed.setDescription(logs.map(l =>
      `<t:${Math.floor(l.synced_at / 1000)}:f> — <@${l.admin_id}>: ` +
      `${l.events_new}/${l.events_parsed} new events, ${l.sessions_credited} credited, +${(l.total_reward || 0).toFixed(2)}`
    ).join('\n'));
  }

  return { embeds: [embed], components: buildBackRow() };
}

function buildChannelView(guildId) {
  const settings = getMcSettings(guildId);
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📺 Set Summary Channel')
    .setDescription(
      `Pick the channel where public sync summaries will be posted.\n\n` +
      `**Current:** ${settings.channelId ? `<#${settings.channelId}>` : '_not set_'}`
    );

  const selectRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('mc_admin_select_channel')
      .setPlaceholder('Choose a text channel')
      .setChannelTypes(ChannelType.GuildText)
  );

  return { embeds: [embed], components: [selectRow, buildBackRow()[0]] };
}

function buildUnlinkView(guildId) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🧑 Unlink a Player')
    .setDescription('Pick a user to remove their Minecraft username link. They will stop receiving MC rewards until they relink.');

  const selectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('mc_admin_select_user')
      .setPlaceholder('Choose a user to unlink')
  );

  return { embeds: [embed], components: [selectRow, buildBackRow()[0]] };
}

function buildConfirmResetView(guildId) {
  const open = getOpenSessions(guildId);
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('🧹 Clear Open Sessions?')
    .setDescription(
      `This will delete **${open.length}** open (unmatched) session record(s).\n` +
      `Players currently logged in won't get credit for time before the next sync. Use this if sessions are stuck.`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mc_admin_reset_confirm')
      .setLabel(`Clear ${open.length} session(s)`)
      .setEmoji('🧹')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(open.length === 0),
    new ButtonBuilder()
      .setCustomId('mc_admin_back')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// ───────────────────────────────────────────── components ─────────────────────────────────────────────

function buildMainButtonRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mc_admin_sync').setLabel('Sync (Paste Log)').setEmoji('📋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mc_admin_audit').setLabel('Audit').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mc_admin_stats').setLabel('Stats').setEmoji('📜').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mc_admin_settings').setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mc_admin_channel').setLabel('Set Channel').setEmoji('📺').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mc_admin_unlink').setLabel('Unlink Player').setEmoji('🧑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mc_admin_reset').setLabel('Reset Sessions').setEmoji('🧹').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('mc_admin_dismiss').setLabel('Dismiss').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

function buildBackRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('mc_admin_back')
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

// ───────────────────────────────────────────── handlers ─────────────────────────────────────────────

async function handleButton(interaction) {
  if (!hasAdminPermission(interaction.member, interaction.guildId)) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  const id = interaction.customId;

  if (id === 'mc_admin_dismiss') {
    try { await interaction.update({ content: '✅ Closed.', embeds: [], components: [] }); } catch (e) {}
    return;
  }

  if (id === 'mc_admin_back') {
    return interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.OVERVIEW));
  }

  if (id === 'mc_admin_audit')    return interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.AUDIT));
  if (id === 'mc_admin_stats')    return interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.STATS));
  if (id === 'mc_admin_channel')  return interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.CHANNEL));
  if (id === 'mc_admin_unlink')   return interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.UNLINK));
  if (id === 'mc_admin_reset')    return interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.CONFIRM_RESET));

  if (id === 'mc_admin_sync')     return openSyncModal(interaction);
  if (id === 'mc_admin_settings') return openSettingsModal(interaction);

  if (id === 'mc_admin_reset_confirm') {
    const open = getOpenSessions(interaction.guildId);
    clearOpenSessions(interaction.guildId);
    logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
      'MC reset open sessions', `cleared ${open.length}`);
    await interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.OVERVIEW));
    return interaction.followUp({ content: `🧹 Cleared **${open.length}** open session(s).`, ephemeral: true });
  }
}

async function handleChannelSelect(interaction) {
  if (!hasAdminPermission(interaction.member, interaction.guildId)) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  const channelId = interaction.values[0];
  setMcChannel(interaction.guildId, channelId);
  logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
    'Set MC summary channel', `<#${channelId}>`);
  await interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.OVERVIEW));
  return interaction.followUp({ content: `✅ Summary channel set to <#${channelId}>.`, ephemeral: true });
}

async function handleUserSelect(interaction) {
  if (!hasAdminPermission(interaction.member, interaction.guildId)) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  const targetId = interaction.values[0];
  const result = unlinkUser(interaction.guildId, targetId);
  await interaction.update(buildPanel(interaction.guildId, PANEL_VIEW.OVERVIEW));
  if (!result.success) {
    return interaction.followUp({ content: `❌ ${result.error}`, ephemeral: true });
  }
  logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
    'MC unlink', `<@${targetId}> (${result.mcUsername})`);
  return interaction.followUp({
    content: `✅ Unlinked <@${targetId}> from \`${result.mcUsername}\`.`,
    ephemeral: true
  });
}

// ───────────────────────────────────────────── modals ─────────────────────────────────────────────

async function openSyncModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('mc_sync_modal')
    .setTitle('🎮 Paste Minecraft Console Log');

  const input = new TextInputBuilder()
    .setCustomId('mc_sync_text')
    .setLabel('Paste Shockbyte console output (any size)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000)
    .setPlaceholder('Paste the full console log. Only Player connected/disconnected lines are read.');

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function openSettingsModal(interaction) {
  const cur = getMcSettings(interaction.guildId);
  const modal = new ModalBuilder()
    .setCustomId('mc_settings_modal')
    .setTitle('🎮 MC Reward Settings');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('mc_reward_per_block')
        .setLabel('Base value per block (integer)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(cur.rewardPerBlock))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('mc_minutes_per_block')
        .setLabel('Minutes per block (integer)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(cur.minutesPerBlock))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('mc_daily_cap')
        .setLabel('Daily cap per user (integer)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(cur.dailyCap))
    )
  );
  return interaction.showModal(modal);
}

async function handleMcSyncModal(interaction) {
  if (!hasAdminPermission(interaction.member, interaction.guildId)) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  await interaction.deferReply(); // public reply so players can see their rewards

  const text = interaction.fields.getTextInputValue('mc_sync_text');
  const result = processSync(interaction.guildId, interaction.user.id, text);

  logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
    'MC sync',
    `events=${result.eventsParsed} new=${result.eventsNew} credited=${result.sessionsCredited} reward=+${result.totalReward.toFixed(2)}`);

  const embed = buildSyncSummaryEmbed(result, interaction.user);
  await interaction.editReply({ embeds: [embed] });

  const settings = getMcSettings(interaction.guildId);
  if (settings.channelId && settings.channelId !== interaction.channelId && result.totalReward > 0) {
    try {
      const ch = await interaction.client.channels.fetch(settings.channelId);
      if (ch && ch.isTextBased()) {
        const publicEmbed = buildPublicSummaryEmbed(result, interaction.user);
        await ch.send({ embeds: [publicEmbed] });
      }
    } catch (e) { /* channel gone or no perms */ }
  }
}

async function handleMcSettingsModal(interaction) {
  if (!hasAdminPermission(interaction.member, interaction.guildId)) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  const rpb = parseInt(interaction.fields.getTextInputValue('mc_reward_per_block'), 10);
  const mpb = parseInt(interaction.fields.getTextInputValue('mc_minutes_per_block'), 10);
  const cap = parseInt(interaction.fields.getTextInputValue('mc_daily_cap'), 10);

  if (!Number.isFinite(rpb) || rpb < 0 || rpb > 100 ||
      !Number.isFinite(mpb) || mpb < 1 || mpb > 240 ||
      !Number.isFinite(cap) || cap < 0 || cap > 10000) {
    return interaction.reply({
      content: '❌ Invalid values. Reward 0–100, minutes 1–240, cap 0–10000.',
      ephemeral: true
    });
  }

  upsertSettings(interaction.guildId, {
    rewardPerBlock: rpb,
    minutesPerBlock: mpb,
    dailyCap: cap
  });
  logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
    'MC settings updated', `reward=+${rpb}/${mpb}m cap=${cap}`);
  return interaction.reply({
    content: `✅ Updated: **+${rpb}** base value per **${mpb} min**, daily cap **+${cap}**.`,
    ephemeral: true
  });
}

// ───────────────────────────────────────────── embeds (sync result) ─────────────────────────────────────────────

function buildSyncSummaryEmbed(result, adminUser) {
  const lines = [];
  lines.push(`**Lines pasted:** ${result.totalLines}`);
  lines.push(`**Events parsed:** ${result.eventsParsed} (${result.eventsNew} new)`);
  lines.push(`**Sessions credited:** ${result.sessionsCredited}`);
  lines.push(`**Total reward:** +${result.totalReward.toFixed(2)} base value`);
  if (result.watermarkAdvanced) {
    lines.push(`**Watermark advanced to:** <t:${Math.floor(result.newWatermark / 1000)}:f>`);
  } else {
    lines.push(`**Watermark:** unchanged (no new events)`);
  }

  const embed = new EmbedBuilder()
    .setColor(result.totalReward > 0 ? 0x57f287 : 0xfaa61a)
    .setTitle('📋 MC Sync Result')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Synced by ${adminUser.username}` })
    .setTimestamp();

  if (result.perUser.length > 0) {
    const userLines = result.perUser.slice(0, 12).map(u => {
      const mins = Math.round(u.totalMinutes);
      const cappedNote = u.capped > 0 ? ` _(capped: ${Math.round(u.capped)}m)_` : '';
      return `<@${u.discordId}> (\`${u.mcDisplay}\`) — ${u.sessions} session${u.sessions === 1 ? '' : 's'}, ${mins}m → **+${u.awarded.toFixed(2)}**${cappedNote}`;
    });
    if (result.perUser.length > 12) userLines.push(`_…and ${result.perUser.length - 12} more_`);
    embed.addFields({ name: 'Players credited', value: userLines.join('\n'), inline: false });
  }

  if (result.unlinked.length > 0) {
    const list = result.unlinked.slice(0, 12).map(n => `\`${n}\``).join(', ');
    embed.addFields({
      name: '⚠️ Unlinked players (no reward)',
      value: list + (result.unlinked.length > 12 ? ` _(+${result.unlinked.length - 12} more)_` : ''),
      inline: false
    });
  }

  return embed;
}

function buildPublicSummaryEmbed(result, adminUser) {
  const userLines = result.perUser
    .filter(u => u.awarded > 0)
    .map(u => {
      const mins = Math.round(u.totalMinutes);
      return `• <@${u.discordId}> (\`${u.mcDisplay}\`) — **+${u.awarded.toFixed(2)}** for ${mins}m`;
    });
  if (userLines.length === 0) {
    return new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle('🎮 Minecraft Sync')
      .setDescription('No rewards to post.')
      .setFooter({ text: `Synced by ${adminUser.username}` })
      .setTimestamp();
  }
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎮 Minecraft Activity Rewards')
    .setDescription(userLines.join('\n'))
    .setFooter({ text: `+${result.totalReward.toFixed(2)} total base value • Synced by ${adminUser.username}` })
    .setTimestamp();
}
