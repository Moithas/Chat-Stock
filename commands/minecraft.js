// /minecraft — unified player panel for Minecraft link & rewards
// Replaces the old /mc-link command (set/remove/status).

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const {
  getLinkByDiscord, linkUser, unlinkUser,
  getMcSettings, getDailyCredit, utcDateString
} = require('../mc-rewards');

const SERVER_IP = '15.235.23.32';
const SERVER_PORT = '21230';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minecraft')
    .setDescription('Manage your Minecraft link and see your reward status'),

  async execute(interaction) {
    const { embed, components } = buildPanel(interaction.guildId, interaction.user);
    return interaction.reply({ embeds: [embed], components, ephemeral: true });
  },

  // Wired from bot.js interaction router
  handleButton,
  handleLinkModal
};

function buildPanel(guildId, user) {
  const link = getLinkByDiscord(guildId, user.id);
  const settings = getMcSettings(guildId);
  const today = utcDateString(Date.now());
  const usedToday = getDailyCredit(guildId, user.id, today);
  const cap = settings.dailyCap;

  const embed = new EmbedBuilder()
    .setColor(link ? 0x57f287 : 0xfaa61a)
    .setTitle('🎮 Minecraft Rewards')
    .setDescription(
      link
        ? `You're linked! Your in-game playtime will be credited to your stock on the next sync.`
        : `You're **not linked** yet. Link your Bedrock username to start earning base value for time spent on the server.`
    );

  if (link) {
    embed.addFields(
      { name: 'In-game name', value: `\`${link.mc_username_display}\``, inline: true },
      { name: 'Linked', value: `<t:${Math.floor(link.linked_at / 1000)}:R>`, inline: true },
      { name: 'Today (UTC)', value: `**+${usedToday}** / ${cap} base value`, inline: true }
    );
  }

  embed.addFields(
    {
      name: '🌐 Server Connection',
      value: `**IP:** \`${SERVER_IP}\`\n**Port:** \`${SERVER_PORT}\``,
      inline: false
    },
    {
      name: 'Reward rate',
      value: `**+${settings.rewardPerBlock}** base value per **${settings.minutesPerBlock} min** played • daily cap **+${settings.dailyCap}**`,
      inline: false
    }
  );

  embed.setFooter({ text: 'Base value is your permanent stock floor — it never goes down.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mc_panel_link')
      .setLabel(link ? 'Update Username' : 'Link Username')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('mc_panel_unlink')
      .setLabel('Unlink')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!link),
    new ButtonBuilder()
      .setCustomId('mc_panel_refresh')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('mc_panel_dismiss')
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, components: [row] };
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'mc_panel_dismiss') {
    try { await interaction.update({ content: '✅ Closed.', embeds: [], components: [] }); } catch (e) {}
    return;
  }

  if (id === 'mc_panel_refresh') {
    const { embed, components } = buildPanel(interaction.guildId, interaction.user);
    return interaction.update({ embeds: [embed], components });
  }

  if (id === 'mc_panel_unlink') {
    const result = unlinkUser(interaction.guildId, interaction.user.id);
    if (!result.success) {
      return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    }
    const { embed, components } = buildPanel(interaction.guildId, interaction.user);
    return interaction.update({ embeds: [embed], components });
  }

  if (id === 'mc_panel_link') {
    const existing = getLinkByDiscord(interaction.guildId, interaction.user.id);
    const modal = new ModalBuilder()
      .setCustomId('mc_panel_link_modal')
      .setTitle('🎮 Link Minecraft Username');
    const input = new TextInputBuilder()
      .setCustomId('mc_username')
      .setLabel('Your Bedrock in-game name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(64)
      .setPlaceholder('Example: Xx B Mac xX');
    if (existing) input.setValue(existing.mc_username_display);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
}

async function handleLinkModal(interaction) {
  const username = interaction.fields.getTextInputValue('mc_username');
  const result = linkUser(interaction.guildId, interaction.user.id, username);
  if (!result.success) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }
  const { embed, components } = buildPanel(interaction.guildId, interaction.user);
  return interaction.reply({
    content: `✅ Linked to **${result.mcUsername}**.`,
    embeds: [embed],
    components,
    ephemeral: true
  });
}
