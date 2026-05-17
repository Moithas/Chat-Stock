// /mc-link — link a Discord user to their Bedrock username
// Required before any Minecraft playtime can be credited to their stock.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { linkUser, unlinkUser, getLinkByDiscord } = require('../mc-rewards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mc-link')
    .setDescription('Link your Minecraft (Bedrock) username so your playtime counts toward your stock')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set or update your Minecraft username')
        .addStringOption(o =>
          o.setName('username')
            .setDescription('Your exact in-game name (case-insensitive). Example: Xx B Mac xX')
            .setRequired(true)
            .setMaxLength(64)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove your Minecraft username link')
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show your current Minecraft link')
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const username = interaction.options.getString('username');
      const result = linkUser(guildId, userId, username);
      if (!result.success) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🎮 Minecraft Link Saved')
        .setDescription(
          `Linked to **${result.mcUsername}**.\n\n` +
          `Your in-game time will be credited to your stock the next time an admin runs ` +
          `\`/admin-mc sync\` and your username appears in the pasted console log.`
        )
        .setFooter({ text: 'Make sure the username matches your Bedrock name EXACTLY (capitalisation doesn\'t matter).' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      const result = unlinkUser(guildId, userId);
      if (!result.success) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }
      return interaction.reply({
        content: `🗑️ Unlinked from **${result.mcUsername}**. You'll no longer receive Minecraft rewards.`,
        ephemeral: true
      });
    }

    if (sub === 'status') {
      const link = getLinkByDiscord(guildId, userId);
      if (!link) {
        return interaction.reply({
          content: 'ℹ️ You don\'t have a Minecraft link yet. Use `/mc-link set username:<your-name>` to add one.',
          ephemeral: true
        });
      }
      const linkedAt = new Date(link.linked_at);
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🎮 Your Minecraft Link')
        .addFields(
          { name: 'In-game name', value: `\`${link.mc_username_display}\``, inline: true },
          { name: 'Linked', value: `<t:${Math.floor(linkedAt.getTime() / 1000)}:R>`, inline: true }
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
