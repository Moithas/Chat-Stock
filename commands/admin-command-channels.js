// Admin: per-guild command-channel allowlist management.
// Replaces Discord Integrations command-channel restrictions with bot-side enforcement,
// so the bot can permit channels it creates (VIP rooms, etc.) without needing OAuth2.

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const {
  isCommandRestrictedInGuild,
  getAllowedChannels,
  listGuildRestrictions,
  addAllowedChannel,
  removeAllowedChannel,
  clearCommandRestrictions,
} = require('../commandChannels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-command-channels')
    .setDescription('Manage per-command channel restrictions (bot-side)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all command restrictions in this guild, or one command')
        .addStringOption(o =>
          o.setName('command').setDescription('Filter to a single command').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a channel to a command\'s allowlist (creates the allowlist if missing)')
        .addStringOption(o =>
          o.setName('command').setDescription('Slash command name (without leading /)').setRequired(true)
        )
        .addChannelOption(o =>
          o.setName('channel').setDescription('Channel to allow').setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a channel from a command\'s allowlist')
        .addStringOption(o =>
          o.setName('command').setDescription('Slash command name').setRequired(true)
        )
        .addChannelOption(o =>
          o.setName('channel').setDescription('Channel to remove').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Clear all restrictions for a command (makes it usable in any channel)')
        .addStringOption(o =>
          o.setName('command').setDescription('Slash command name').setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: '❌ Use this in a server.', flags: 64 });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Administrator only.', flags: 64 });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'list') {
      const filter = interaction.options.getString('command');
      if (filter) {
        const channels = getAllowedChannels(guildId, filter);
        if (channels.length === 0) {
          return interaction.reply({ content: `\`/${filter}\` is **unrestricted** (allowed in every channel).`, flags: 64 });
        }
        const mentions = channels.map(c => `<#${c}>`).join('\n');
        const embed = new EmbedBuilder()
          .setTitle(`Allowed channels for /${filter}`)
          .setDescription(mentions)
          .setColor(0x4f8bff);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }
      const all = listGuildRestrictions(guildId);
      const entries = Object.entries(all).sort(([a],[b]) => a.localeCompare(b));
      if (entries.length === 0) {
        return interaction.reply({ content: 'No command-channel restrictions configured in this guild.', flags: 64 });
      }
      const lines = entries.map(([cmd, chs]) => {
        const list = chs.slice(0, 6).map(c => `<#${c}>`).join(', ');
        const more = chs.length > 6 ? ` (+${chs.length - 6})` : '';
        return `**/${cmd}** → ${list}${more}`;
      });
      // Embed description max 4096 chars; split if needed
      const desc = lines.join('\n');
      const embed = new EmbedBuilder()
        .setTitle(`Command-channel restrictions (${entries.length})`)
        .setDescription(desc.length > 4000 ? desc.slice(0, 4000) + '\n…(truncated)' : desc)
        .setColor(0x4f8bff);
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    if (sub === 'add') {
      const cmd = interaction.options.getString('command').trim().replace(/^\//, '');
      const channel = interaction.options.getChannel('channel');
      addAllowedChannel(guildId, cmd, channel.id);
      const count = getAllowedChannels(guildId, cmd).length;
      return interaction.reply({
        content: `✅ \`/${cmd}\` is now allowed in <#${channel.id}>. Total allowed channels: **${count}**.`,
        flags: 64
      });
    }

    if (sub === 'remove') {
      const cmd = interaction.options.getString('command').trim().replace(/^\//, '');
      const channel = interaction.options.getChannel('channel');
      const wasRestricted = isCommandRestrictedInGuild(guildId, cmd);
      removeAllowedChannel(guildId, cmd, channel.id);
      const remaining = getAllowedChannels(guildId, cmd).length;
      let note = '';
      if (wasRestricted && remaining === 0) note = '\n⚠️ Last channel removed — command is now **unrestricted**.';
      return interaction.reply({
        content: `✅ Removed <#${channel.id}> from \`/${cmd}\`. Remaining: **${remaining}**.${note}`,
        flags: 64
      });
    }

    if (sub === 'clear') {
      const cmd = interaction.options.getString('command').trim().replace(/^\//, '');
      clearCommandRestrictions(guildId, cmd);
      return interaction.reply({
        content: `✅ Cleared all restrictions for \`/${cmd}\`. It is now usable in any channel.`,
        flags: 64
      });
    }
  }
};
