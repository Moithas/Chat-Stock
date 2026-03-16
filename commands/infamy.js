// /infamy command - View your criminal reputation, tier, effects, and bounty status
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getInfamy, getInfamyTier, getTierEffects, getActiveBounty, isOnProbation, getInfamySettings, getInfamyLeaderboard, INFAMY_TIERS } = require('../infamy');
const { getCurrency } = require('../admin');



// Progress bar characters
const BAR_FILLED = '█';
const BAR_EMPTY = '░';

function buildProgressBar(current, max, length = 12) {
  if (max <= 0 || max === Infinity) {
    // At max tier, show full bar
    return BAR_FILLED.repeat(length);
  }
  const percent = Math.max(0, Math.min(current / max, 1));
  const filled = Math.max(0, Math.min(Math.round(percent * length), length));
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(length - filled);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infamy')
    .setDescription('View your criminal reputation and bounty status')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Check another user\'s infamy (optional)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    const settings = getInfamySettings(guildId);
    if (!settings.enabled) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle('🏴‍☠️ Infamy System')
          .setDescription('The infamy system is currently disabled.')]
      });
    }

    const data = getInfamy(guildId, userId);
    const tierInfo = getTierEffects(guildId, userId);
    const activeBounty = getActiveBounty(guildId, userId);
    const probation = isOnProbation(guildId, userId);

    // Calculate progress to next tier
    const currentTier = tierInfo.tier;
    const nextTier = currentTier < 5 ? INFAMY_TIERS[currentTier + 1] : null;
    const currentMin = INFAMY_TIERS[currentTier].minPoints;
    const currentMax = nextTier ? nextTier.minPoints - 1 : Infinity;
    const progressInTier = data.infamy_points - currentMin;
    const tierRange = nextTier ? nextTier.minPoints - currentMin : 1;

    const progressBar = buildProgressBar(progressInTier, tierRange);
    const progressText = nextTier 
      ? `${progressBar} ${Math.round(data.infamy_points).toLocaleString()} / ${nextTier.minPoints.toLocaleString()}`
      : `${progressBar} MAX TIER`;

    // Build effects description
    let effectsText = '';
    if (tierInfo.tier === 0) {
      effectsText = '✅ No criminal penalties';
    } else {
      const effects = [];
      if (tierInfo.tier >= 1) effects.push(`🔍 Infamy indicator on hack/rob`);
      if (tierInfo.successBuff > 0) effects.push(`⚡ +${tierInfo.successBuff}% hack/rob success`);
      if (tierInfo.earningsCut > 0) effects.push(`📉 -${tierInfo.earningsCut}% criminal earnings`);
      if (tierInfo.fineModifier > 0) effects.push(`💸 +${tierInfo.fineModifier}% failure fines`);
      if (tierInfo.feeModifier > 0) effects.push(`📊 +${tierInfo.feeModifier}% trading fees`);
      if (tierInfo.vaultPenalty === -1) effects.push(`🔒 Vault access LOCKED`);
      else if (tierInfo.vaultPenalty > 0) effects.push(`⏱️ +${tierInfo.vaultPenalty}s vault click timer`);
      if (tierInfo.bountyChance > 0) effects.push(`🎯 ${tierInfo.bountyChance}% bounty roll per crime`);
      effectsText = effects.join('\n');
    }

    // Build embed
    const embed = new EmbedBuilder()
      .setColor(tierInfo.tier >= 4 ? 0xff0000 : tierInfo.tier >= 2 ? 0xff6600 : tierInfo.tier >= 1 ? 0xffaa00 : 0x2ecc71)
      .setTitle(`🏴‍☠️ ${targetUser.username}'s Infamy`)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { 
          name: `${tierInfo.emoji} Tier ${tierInfo.tier}: ${tierInfo.name}`, 
          value: progressText, 
          inline: false 
        },
        { 
          name: '📊 Current Effects', 
          value: effectsText, 
          inline: false 
        },
        {
          name: '📈 Infamy Stats',
          value: 
            `🏴‍☠️ **Current:** ${Math.round(data.infamy_points).toLocaleString()}\n` +
            `📈 **Total Earned:** ${Math.round(data.total_earned).toLocaleString()}\n` +
            `📉 **Total Decayed:** ${Math.round(data.total_decayed).toLocaleString()}\n` +
            `🎁 **Total Reduced:** ${Math.round(data.total_reduced).toLocaleString()}`,
          inline: true
        },
        {
          name: '🎯 Bounty Records',
          value:
            `📋 **Bounties Posted:** ${data.bounties_posted}\n` +
            `🏆 **Bounties Claimed On:** ${data.bounties_claimed_on}`,
          inline: true
        }
      );

    // Active bounty section
    if (activeBounty) {
      embed.addFields({
        name: '🚨 ACTIVE BOUNTY',
        value: `💰 **${activeBounty.bounty_amount.toLocaleString()}** ${getCurrency(guildId)}\n📅 Posted <t:${Math.floor(activeBounty.posted_at / 1000)}:R>`,
        inline: false
      });
    }

    // Probation section
    if (probation.onProbation) {
      const probTier = INFAMY_TIERS[probation.tier];
      embed.addFields({
        name: '⚖️ ON PROBATION',
        value: `Tier ${probation.tier} (${probTier.name}) effects until <t:${Math.floor(probation.until / 1000)}:R>\nInfamy reset to 0, but penalties remain.`,
        inline: false
      });
    }

    // Decay info
    embed.setFooter({ text: `Infamy decays ${settings.decay_per_hour}/hr • Dungeon floors reduce by ${settings.dungeon_reduction}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('infamy_leaderboard')
        .setLabel('🏴‍☠️ Most Wanted')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('infamy_dismiss')
        .setLabel('Dismiss')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;

    if (customId === 'infamy_leaderboard') {
      await interaction.deferUpdate();

      const leaderboard = getInfamyLeaderboard(guildId, 10);

      if (leaderboard.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle('🏴‍☠️ Most Wanted')
          .setDescription('No criminals found! The streets are clean... for now.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('infamy_dismiss')
            .setLabel('Dismiss')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      let lbText = '';
      for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const tier = getTierEffects(guildId, entry.user_id);
        let username = entry.user_id;
        try {
          const user = await interaction.client.users.fetch(entry.user_id);
          username = user.username;
        } catch (e) {}

        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        lbText += `${medal} ${tier.emoji} **${username}** — ${Math.round(entry.infamy_points).toLocaleString()} pts (${tier.name})\n`;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🏴‍☠️ Most Wanted Leaderboard')
        .setDescription(lbText)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('infamy_dismiss')
          .setLabel('Dismiss')
          .setStyle(ButtonStyle.Secondary)
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (customId === 'infamy_dismiss') {
      await interaction.deferUpdate();
      try {
        await interaction.deleteReply();
      } catch (e) {
        // Fallback: just remove components if delete fails
        await interaction.editReply({ components: [] });
      }
    }
  }
};
