// Shared "forfeit new-player immunity" confirmation used by /hack and /rob.
// New-player immunity protects a player from being hacked/robbed. Initiating an
// attack forfeits it, so we warn the player first and only waive on confirm.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { waiveNewPlayerImmunity } = require('./economy');

// Shows an ephemeral warning with confirm/cancel buttons. On confirm, forfeits
// the player's immunity and tells them to re-run the command to attack.
// The command should ABORT after calling this (the action is not performed here).
async function promptImmunityForfeit(interaction, action, guildId, userId, immunityEnds) {
  const verb = action === 'hack' ? 'hack' : 'rob';
  const until = immunityEnds ? ` (protected until <t:${Math.floor(immunityEnds / 1000)}:R>)` : '';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('⚠️ You Still Have New Player Immunity')
    .setDescription(
      `Right now **no one can hack or rob you**${until}.\n\n` +
      `If you ${verb} someone, you **give up that protection early** — other players ` +
      `will be able to hack and rob **you** for the rest of your immunity window.\n\n` +
      `Do you want to give up your immunity?`
    )
    .setFooter({ text: 'This is permanent — your immunity will not come back.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`npimm_forfeit_${userId}`)
      .setLabel('Give Up Immunity')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⚔️'),
    new ButtonBuilder()
      .setCustomId(`npimm_keep_${userId}`)
      .setLabel('Keep Immunity')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🛡️')
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
  const msg = await interaction.fetchReply();

  const choice = await msg.awaitMessageComponent({
    filter: i => i.user.id === userId && (i.customId === `npimm_forfeit_${userId}` || i.customId === `npimm_keep_${userId}`),
    time: 30000
  }).catch(() => null);

  if (!choice) {
    await interaction.editReply({ content: '⌛ Timed out — your immunity is safe.', embeds: [], components: [] }).catch(() => {});
    return;
  }

  if (choice.customId === `npimm_keep_${userId}`) {
    await choice.update({ content: '🛡️ Immunity kept. No action taken.', embeds: [], components: [] }).catch(() => {});
    return;
  }

  waiveNewPlayerImmunity(guildId, userId);
  await choice.update({
    content: `⚔️ **Immunity forfeited.** You can now be hacked and robbed too.\nRun \`/${action}\` again to carry out your attack.`,
    embeds: [],
    components: []
  }).catch(() => {});
}

module.exports = { promptImmunityForfeit };
