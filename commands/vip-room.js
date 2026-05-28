const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const {
  getActiveRoomForUser,
  getRoomByChannelId,
  getRoomGuests,
  removeRoomGuest,
  isRoomGuest
} = require('../items');

function buildRoomPanel(interaction, room, guests) {
  const guestList = guests.length > 0
    ? guests.map(g => `• <@${g.userId}>`).join('\n')
    : '*No guests invited yet.*';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🎰 ${interaction.user.username}'s VIP Gambling Room`)
    .setDescription(
      `**Channel:** <#${room.channelId}>\n` +
      `**Created:** <t:${Math.floor(room.createdAt / 1000)}:F>\n` +
      `**Expires:** <t:${Math.floor(room.expiresAt / 1000)}:F> (<t:${Math.floor(room.expiresAt / 1000)}:R>)`
    )
    .addFields(
      { name: `👥 Guests (${guests.length})`, value: guestList, inline: false }
    )
    .setFooter({ text: 'Use the buttons below to rename the room or remove guests.' });

  const rows = [];

  // Rename button (always available)
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vip_room_rename_${room.channelId}`)
      .setLabel('Rename Room')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️')
  ));

  // Build remove-guest buttons (max 5 per row, max 25 total — Discord limit)
  if (guests.length > 0) {
    const visible = guests.slice(0, 25);
    let row = new ActionRowBuilder();
    for (let i = 0; i < visible.length; i++) {
      if (i > 0 && i % 5 === 0) {
        rows.push(row);
        row = new ActionRowBuilder();
      }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`vip_room_remove_${room.channelId}_${visible[i].userId}`)
          .setLabel(`Remove guest ${i + 1}`)
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🚫')
      );
    }
    rows.push(row);
  }
  return { embed, rows };
}

function sanitizeChannelName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, 100);
}

async function handleRenameButton(interaction) {
  const match = interaction.customId.match(/^vip_room_rename_(\d+)$/);
  if (!match) return;
  const [, channelId] = match;

  const room = getRoomByChannelId(channelId);
  if (!room) {
    return interaction.reply({ content: '❌ That VIP room no longer exists.', ephemeral: true });
  }
  if (room.userId !== interaction.user.id) {
    return interaction.reply({ content: '❌ Only the room owner can rename this room.', ephemeral: true });
  }

  const channel = interaction.guild.channels.cache.get(channelId)
    ?? await interaction.guild.channels.fetch(channelId).catch(() => null);
  const currentName = channel?.name || '';

  const modal = new ModalBuilder()
    .setCustomId(`vip_room_rename_modal_${channelId}`)
    .setTitle('Rename VIP Room')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('new_name')
          .setLabel('New channel name')
          .setPlaceholder('e.g. high-rollers-lounge')
          .setValue(currentName)
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
}

async function handleRenameModal(interaction) {
  const match = interaction.customId.match(/^vip_room_rename_modal_(\d+)$/);
  if (!match) return;
  const [, channelId] = match;

  const room = getRoomByChannelId(channelId);
  if (!room) {
    return interaction.reply({ content: '❌ That VIP room no longer exists.', ephemeral: true });
  }
  if (room.userId !== interaction.user.id) {
    return interaction.reply({ content: '❌ Only the room owner can rename this room.', ephemeral: true });
  }

  const raw = interaction.fields.getTextInputValue('new_name');
  const newName = sanitizeChannelName(raw);
  if (!newName) {
    return interaction.reply({
      content: '❌ Invalid name. Use letters, numbers, dashes, or underscores (1–100 chars).',
      ephemeral: true
    });
  }

  const channel = interaction.guild.channels.cache.get(channelId)
    ?? await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return interaction.reply({ content: '❌ Could not find the room channel.', ephemeral: true });
  }
  if (channel.name === newName) {
    return interaction.reply({ content: `ℹ️ The room is already named **#${newName}**.`, ephemeral: true });
  }

  try {
    await channel.setName(newName, `Renamed by VIP room owner ${interaction.user.tag}`);
  } catch (e) {
    console.error('Failed to rename VIP room channel:', e);
    const reason = e?.rawError?.message || e?.message || 'Unknown error';
    return interaction.reply({
      content: `❌ Failed to rename the room: ${reason}\n\n*Discord limits channel renames to 2 per 10 minutes.*`,
      ephemeral: true
    });
  }

  return interaction.reply({
    content: `✅ Renamed your VIP room to <#${channelId}> (**#${newName}**).`,
    ephemeral: true
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vip-room')
    .setDescription('Manage your VIP Gambling Room (view info and remove guests)'),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    const room = getActiveRoomForUser(guildId, userId);
    if (!room) {
      return interaction.reply({
        content: '❌ You don\'t own an active VIP Gambling Room. Buy one from `/shop`!',
        ephemeral: true
      });
    }

    const guests = getRoomGuests(room.channelId);
    const { embed, rows } = buildRoomPanel(interaction, room, guests);

    return interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  },

  async handleButton(interaction) {
    if (interaction.customId.startsWith('vip_room_rename_')) {
      return handleRenameButton(interaction);
    }
    // customId format: vip_room_remove_{channelId}_{userId}
    const match = interaction.customId.match(/^vip_room_remove_(\d+)_(\d+)$/);
    if (!match) return;
    const [, channelId, guestId] = match;

    const room = getRoomByChannelId(channelId);
    if (!room) {
      return interaction.reply({ content: '❌ That VIP room no longer exists.', ephemeral: true });
    }
    if (room.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only the room owner can remove guests.', ephemeral: true });
    }
    if (!isRoomGuest(channelId, guestId)) {
      return interaction.reply({ content: '❌ That user is not a guest of your room.', ephemeral: true });
    }

    // Remove the permission overwrite on the room channel
    const channel = interaction.guild.channels.cache.get(channelId)
      ?? await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (channel) {
      try {
        await channel.permissionOverwrites.delete(guestId, `Uninvited by room owner ${interaction.user.tag}`);
      } catch (e) {
        console.error('Failed to remove guest overwrite:', e);
        return interaction.reply({
          content: '❌ Failed to remove guest permissions. Please contact an admin.',
          ephemeral: true
        });
      }
    }

    removeRoomGuest(channelId, guestId);

    // Refresh the panel in place
    const guests = getRoomGuests(channelId);
    const { embed, rows } = buildRoomPanel(interaction, room, guests);
    try {
      await interaction.update({
        content: `✅ Removed <@${guestId}> from your VIP room.`,
        embeds: [embed],
        components: rows
      });
    } catch (e) {
      // Fall back to reply if update fails (interaction expired/etc.)
      try {
        await interaction.reply({ content: `✅ Removed <@${guestId}> from your VIP room.`, ephemeral: true });
      } catch (_) { /* ignore */ }
    }
  },

  async handleModal(interaction) {
    if (interaction.customId.startsWith('vip_room_rename_modal_')) {
      return handleRenameModal(interaction);
    }
  }
};
