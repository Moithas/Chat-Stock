// /admin-mc — manage Minecraft reward system (admin only)
// Subcommands: set-channel, sync, audit, unlink, stats, settings, reset-sessions

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits
} = require('discord.js');
const { hasAdminPermission, logAdminAction } = require('../admin');
const {
  getMcSettings, setMcChannel, upsertSettings,
  getAllLinks, unlinkUser, getOpenSessions, clearOpenSessions,
  getRecentSyncLogs, processSync
} = require('../mc-rewards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-mc')
    .setDescription('Manage the Minecraft activity reward system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s =>
      s.setName('set-channel')
        .setDescription('Set the channel where Minecraft sync summaries are posted')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Text channel for MC summaries')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s => s.setName('sync').setDescription('Paste Shockbyte console output to credit linked players'))
    .addSubcommand(s => s.setName('audit').setDescription('Show all linked players and currently open sessions'))
    .addSubcommand(s =>
      s.setName('unlink')
        .setDescription('Remove a user\'s Minecraft link')
        .addUserOption(o => o.setName('user').setDescription('User to unlink').setRequired(true))
    )
    .addSubcommand(s => s.setName('stats').setDescription('Show recent sync history'))
    .addSubcommand(s => s.setName('settings').setDescription('Configure reward rate and daily cap'))
    .addSubcommand(s => s.setName('reset-sessions').setDescription('Clear all open (unmatched) sessions')),

  async execute(interaction) {
    if (!hasAdminPermission(interaction.member, interaction.guildId)) {
      return interaction.reply({ content: '❌ You don\'t have permission to use this.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'set-channel') return setChannel(interaction);
    if (sub === 'sync') return openSyncModal(interaction);
    if (sub === 'audit') return showAudit(interaction);
    if (sub === 'unlink') return doUnlink(interaction);
    if (sub === 'stats') return showStats(interaction);
    if (sub === 'settings') return openSettingsModal(interaction);
    if (sub === 'reset-sessions') return doResetSessions(interaction);
  },

  handleMcSyncModal,
  handleMcSettingsModal
};

async function setChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  setMcChannel(interaction.guildId, channel.id);
  logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
    'Set MC summary channel', `#${channel.name}`);
  return interaction.reply({
    content: `✅ Minecraft summary channel set to ${channel}.`,
    ephemeral: true
  });
}

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

  // Public reply in the channel where the admin ran the command
  await interaction.editReply({ embeds: [embed] });

  // Also cross-post the player-facing summary to the configured channel
  // (only if it's a different channel and a reward was actually given)
  const settings = getMcSettings(interaction.guildId);
  if (settings.channelId && settings.channelId !== interaction.channelId && result.totalReward > 0) {
    try {
      const ch = await interaction.client.channels.fetch(settings.channelId);
      if (ch && ch.isTextBased()) {
        const publicEmbed = buildPublicSummaryEmbed(result, interaction.user);
        await ch.send({ embeds: [publicEmbed] });
      }
    } catch (e) {
      // Channel might be gone or bot lacks perms — admin already got the in-channel summary
    }
  }
}

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

async function showAudit(interaction) {
  const links = getAllLinks(interaction.guildId);
  const open = getOpenSessions(interaction.guildId);
  const settings = getMcSettings(interaction.guildId);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎮 Minecraft Audit')
    .addFields(
      { name: 'Summary channel', value: settings.channelId ? `<#${settings.channelId}>` : '_not set_', inline: true },
      { name: 'Reward', value: `+${settings.rewardPerBlock}/${settings.minutesPerBlock}m`, inline: true },
      { name: 'Daily cap', value: `+${settings.dailyCap}`, inline: true },
      { name: 'Last sync', value: settings.lastSyncTs ? `<t:${Math.floor(settings.lastSyncTs / 1000)}:R>` : '_never_', inline: false }
    );

  if (links.length > 0) {
    const linkLines = links.slice(0, 15).map(l => `<@${l.discord_id}> → \`${l.mc_username_display}\``);
    if (links.length > 15) linkLines.push(`_…and ${links.length - 15} more_`);
    embed.addFields({ name: `🔗 Linked players (${links.length})`, value: linkLines.join('\n'), inline: false });
  } else {
    embed.addFields({ name: '🔗 Linked players', value: '_no one is linked yet_', inline: false });
  }

  if (open.length > 0) {
    const openLines = open.slice(0, 10).map(o =>
      `\`${o.mc_username_display}\` — joined <t:${Math.floor(o.joined_at / 1000)}:R>`);
    if (open.length > 10) openLines.push(`_…and ${open.length - 10} more_`);
    embed.addFields({ name: `🟢 Open sessions (${open.length})`, value: openLines.join('\n'), inline: false });
  }

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function doUnlink(interaction) {
  const target = interaction.options.getUser('user');
  const result = unlinkUser(interaction.guildId, target.id);
  if (!result.success) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }
  logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
    'MC unlink', `${target.username} (${result.mcUsername})`);
  return interaction.reply({
    content: `✅ Unlinked ${target} from \`${result.mcUsername}\`.`,
    ephemeral: true
  });
}

async function showStats(interaction) {
  const logs = getRecentSyncLogs(interaction.guildId, 10);
  if (logs.length === 0) {
    return interaction.reply({ content: 'No syncs recorded yet.', ephemeral: true });
  }
  const lines = logs.map(l => {
    return `<t:${Math.floor(l.synced_at / 1000)}:f> — <@${l.admin_id}>: ` +
      `${l.events_new}/${l.events_parsed} new events, ${l.sessions_credited} credited, +${(l.total_reward || 0).toFixed(2)}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎮 Recent MC Syncs')
    .setDescription(lines.join('\n'));
  return interaction.reply({ embeds: [embed], ephemeral: true });
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

async function doResetSessions(interaction) {
  const open = getOpenSessions(interaction.guildId);
  clearOpenSessions(interaction.guildId);
  logAdminAction(interaction.guildId, interaction.user.id, interaction.user.username,
    'MC reset open sessions', `cleared ${open.length}`);
  return interaction.reply({
    content: `🧹 Cleared **${open.length}** open session(s). Next sync starts fresh.`,
    ephemeral: true
  });
}
