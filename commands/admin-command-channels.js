// Admin panel: per-guild command-channel allowlist management.
// Wired into /admin → 🎯 Command Channels.
//
// Replaces Discord Integrations command-channel restrictions with bot-side
// enforcement so the bot can dynamically permit channels it owns (VIP rooms).

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  getAllowedChannels,
  listGuildRestrictions,
  addAllowedChannel,
  removeAllowedChannel,
  clearCommandRestrictions,
} = require('../commandChannels');

// Custom-id namespace. Format: `cmdch:<action>` or `cmdch:<action>|<commandName>`.
const ID_PREFIX = 'cmdch:';

// ==================== MAIN PANEL ====================

const PAGE_SIZE = 10;

async function showCommandChannelsPanel(interaction, guildId, page = 0) {
  const restrictions = listGuildRestrictions(guildId);
  const entries = Object.entries(restrictions).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = entries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(0x4f8bff)
    .setTitle('🎯 Command Channel Restrictions')
    .setDescription([
      'Bot-side per-command channel allowlist. Replaces Discord *Server Settings → Integrations* restrictions so VIP rooms and other bot-managed channels can be permitted automatically.',
      '',
      '• A command with **no** allowed channels is usable **everywhere**.',
      '• Adding even one channel makes it **restricted** to that list (plus its threads).',
      '• Administrators and VIP gambling rooms always bypass these rules.',
    ].join('\n'));

  if (total === 0) {
    embed.addFields({ name: 'Currently restricted commands', value: '_None — every command is unrestricted._' });
  } else {
    const lines = slice.map(([cmd, chs]) => {
      const list = chs.slice(0, 5).map(c => `<#${c}>`).join(', ');
      const more = chs.length > 5 ? ` *(+${chs.length - 5})*` : '';
      return `**/${cmd}** → ${list}${more}`;
    });
    const desc = lines.join('\n');
    embed.addFields({
      name: `Restricted commands (${total}) — page ${safePage + 1}/${totalPages}`,
      value: desc.length > 1024 ? desc.slice(0, 1018) + '\n…' : desc,
    });
  }
  embed.setFooter({ text: 'Use "Manage a command" to add, remove, or clear channels.' });

  const rows = [];

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ID_PREFIX + 'open')
      .setLabel('Manage a command')
      .setEmoji('🎯')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('back_dashboard')
      .setLabel('Back to dashboard')
      .setStyle(ButtonStyle.Secondary)
  ));

  if (totalPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(ID_PREFIX + 'page|' + (safePage - 1))
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(ID_PREFIX + 'page|noop')
        .setLabel(`Page ${safePage + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(ID_PREFIX + 'page|' + (safePage + 1))
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1)
    ));
  }

  await interaction.editReply({ embeds: [embed], components: rows });
}

// ==================== COMMAND DETAIL VIEW ====================

async function showCommandDetail(interaction, guildId, commandName) {
  const channels = getAllowedChannels(guildId, commandName);
  const embed = new EmbedBuilder()
    .setColor(channels.length === 0 ? 0x57f287 : 0xfee75c)
    .setTitle(`🎯 /${commandName}`)
    .setDescription(channels.length === 0
      ? '_This command is **unrestricted** — usable in every channel._'
      : 'Currently allowed in the channels below. Threads inside allowed channels work automatically.');

  if (channels.length > 0) {
    const list = channels.map(c => `<#${c}>`).join('\n');
    embed.addFields({
      name: `Allowed channels (${channels.length})`,
      value: list.length > 1024 ? list.slice(0, 1018) + '\n…' : list,
    });
  }

  const rows = [];

  // Add-channel selector
  rows.push(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(ID_PREFIX + 'add|' + commandName)
      .setPlaceholder('➕ Add channel(s) to allowlist')
      .setMinValues(1)
      .setMaxValues(25)
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
        ChannelType.GuildForum
      )
  ));

  // Remove-channel selector (only if any exist)
  if (channels.length > 0) {
    const removeOptions = channels.slice(0, 25).map(id => {
      const ch = interaction.guild?.channels?.cache?.get(id);
      const label = ch ? `#${ch.name}`.slice(0, 100) : id;
      const description = ch?.parent?.name ? ch.parent.name.slice(0, 100) : undefined;
      return description ? { label, value: id, description } : { label, value: id };
    });
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ID_PREFIX + 'remove|' + commandName)
        .setPlaceholder('➖ Remove channel(s) from allowlist')
        .setMinValues(1)
        .setMaxValues(Math.min(removeOptions.length, 25))
        .addOptions(removeOptions)
    ));
  }

  // Action buttons
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ID_PREFIX + 'clear|' + commandName)
      .setLabel('Clear all')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(channels.length === 0),
    new ButtonBuilder()
      .setCustomId(ID_PREFIX + 'back')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  ));

  await interaction.editReply({ embeds: [embed], components: rows });
}

// ==================== MODAL: PICK A COMMAND ====================

function buildPickCommandModal() {
  return new ModalBuilder()
    .setCustomId(ID_PREFIX + 'modal')
    .setTitle('Manage command restrictions')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('command_name')
          .setLabel('Slash command name (without /)')
          .setPlaceholder('e.g. blackjack, three-card-poker, income')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(50)
          .setRequired(true)
      )
    );
}

// ==================== INTERACTION HANDLER ====================

async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith(ID_PREFIX)) return false;

  const rest = customId.slice(ID_PREFIX.length);
  const [action, commandName] = rest.split('|');

  try {
    // Open the "type a command name" modal
    if (action === 'open' && interaction.isButton()) {
      await interaction.showModal(buildPickCommandModal());
      return true;
    }

    // Modal submitted: open detail view for the entered command
    if (action === 'modal' && interaction.isModalSubmit()) {
      await interaction.deferUpdate();
      const name = (interaction.fields.getTextInputValue('command_name') || '').trim().replace(/^\//, '').toLowerCase();
      if (!name) {
        await interaction.followUp({ content: '❌ Empty command name.', flags: 64 });
        return true;
      }
      await showCommandDetail(interaction, guildId, name);
      return true;
    }

    // Back to main list
    if (action === 'back' && interaction.isButton()) {
      await interaction.deferUpdate();
      await showCommandChannelsPanel(interaction, guildId);
      return true;
    }

    // Pagination
    if (action === 'page' && interaction.isButton()) {
      if (commandName === 'noop') {
        await interaction.deferUpdate();
        return true;
      }
      await interaction.deferUpdate();
      const target = parseInt(commandName, 10) || 0;
      await showCommandChannelsPanel(interaction, guildId, target);
      return true;
    }

    // Add channels (channel select)
    if (action === 'add' && interaction.isChannelSelectMenu() && commandName) {
      await interaction.deferUpdate();
      let added = 0;
      for (const id of interaction.values) {
        addAllowedChannel(guildId, commandName, id);
        added++;
      }
      await showCommandDetail(interaction, guildId, commandName);
      await interaction.followUp({ content: `✅ Added ${added} channel(s) to \`/${commandName}\`.`, flags: 64 });
      return true;
    }

    // Remove channels (string select)
    if (action === 'remove' && interaction.isStringSelectMenu() && commandName) {
      await interaction.deferUpdate();
      let removed = 0;
      for (const id of interaction.values) {
        removeAllowedChannel(guildId, commandName, id);
        removed++;
      }
      await showCommandDetail(interaction, guildId, commandName);
      await interaction.followUp({ content: `✅ Removed ${removed} channel(s) from \`/${commandName}\`.`, flags: 64 });
      return true;
    }

    // Clear all restrictions for command
    if (action === 'clear' && interaction.isButton() && commandName) {
      await interaction.deferUpdate();
      clearCommandRestrictions(guildId, commandName);
      await showCommandDetail(interaction, guildId, commandName);
      await interaction.followUp({ content: `✅ Cleared all restrictions for \`/${commandName}\`. It is now usable everywhere.`, flags: 64 });
      return true;
    }
  } catch (err) {
    console.error('[admin-command-channels] interaction error:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 });
      } else {
        await interaction.followUp({ content: `❌ Error: ${err.message}`, flags: 64 });
      }
    } catch {}
    return true;
  }

  return false;
}

module.exports = {
  showCommandChannelsPanel,
  handleInteraction,
};
