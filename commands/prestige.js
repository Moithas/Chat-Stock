// /prestige command — View prestige status, perks, and prestige up
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance } = require('../economy');
const { getPortfolio, calculateStockPrice } = require('../database');
const { getTotalPropertyValue } = require('../property');
const { getCurrency } = require('../admin');
const { 
  getPrestigeData, getPrestigeLevel, getPrestigeSettings, canPrestige,
  executePrestige, getNextTier, getTierInfo, getPrestigeBadge,
  getIncomeMultiplier, getXpMultiplier, getBorrowMultiplier,
  PRESTIGE_TIERS
} = require('../prestige');

function calculateTotalWealth(guildId, userId) {
  const balance = getBalance(guildId, userId);
  const portfolio = getPortfolio(userId);
  let portfolioValue = 0;
  for (const stock of portfolio) {
    portfolioValue += calculateStockPrice(stock.stock_user_id, guildId) * stock.shares;
  }
  const propValue = getTotalPropertyValue(guildId, userId) || 0;
  return balance.cash + balance.bank + portfolioValue + propValue;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prestige')
    .setDescription('View your prestige status or prestige up for permanent bonuses'),

  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const settings = getPrestigeSettings(guildId);
    if (!settings.enabled) {
      return interaction.editReply({ content: '❌ The prestige system is currently disabled.' });
    }

    await showPrestigePanel(interaction, guildId, userId);
  },

  async handleButton(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const customId = interaction.customId;

    // Only the original user can interact
    const parts = customId.split('_');
    const ownerId = parts[parts.length - 1];
    if (ownerId !== userId) {
      return interaction.reply({ content: '❌ This is not your prestige panel.', flags: 64 });
    }

    if (customId.startsWith('prestige_confirm_')) {
      await handlePrestigeConfirm(interaction, guildId, userId);
    } else if (customId.startsWith('prestige_cancel_')) {
      await interaction.deferUpdate();
      await showPrestigePanel(interaction, guildId, userId, true);
    } else if (customId.startsWith('prestige_start_')) {
      await handlePrestigeStart(interaction, guildId, userId);
    }
  }
};

async function showPrestigePanel(interaction, guildId, userId, isUpdate = false) {
  const data = getPrestigeData(guildId, userId);
  const settings = getPrestigeSettings(guildId);
  const totalWealth = calculateTotalWealth(guildId, userId);
  const currency = getCurrency(guildId);
  const nextTier = getNextTier(data.level);

  // Current tier info
  const currentTier = data.level > 0 ? getTierInfo(data.level) : null;
  const currentBadge = currentTier ? `${currentTier.emoji} ${currentTier.name}` : 'None';

  // Build tier progress display
  let tierDisplay = '';
  for (const tier of PRESTIGE_TIERS) {
    const achieved = data.level >= tier.level;
    const isCurrent = data.level === tier.level;
    const isNext = nextTier && tier.level === nextTier.level;

    if (achieved) {
      tierDisplay += `${tier.emoji} ~~${tier.name}~~ — ✅ Achieved\n`;
    } else if (isNext) {
      const progress = Math.min(100, Math.floor((totalWealth / tier.cost) * 100));
      const bar = createProgressBar(progress);
      tierDisplay += `${tier.emoji} **${tier.name}** — ${totalWealth.toLocaleString()} / ${tier.cost.toLocaleString()} ${currency}\n${bar} ${progress}%\n`;
    } else {
      tierDisplay += `${tier.emoji} ${tier.name} — ${tier.cost.toLocaleString()} ${currency}\n`;
    }
  }

  // Perks display
  const incomeBonus = data.level > 0 ? `+${(data.level * settings.incomeMultiplierPerTier * 100).toFixed(0)}%` : '+0%';
  const xpBonus = data.level > 0 ? `+${(data.level * settings.xpMultiplierPerTier * 100).toFixed(0)}%` : '+0%';
  const borrowBonus = data.level > 0 ? `${(1 + data.level * settings.borrowMultiplierPerTier).toFixed(0)}x` : '1x';

  const embed = new EmbedBuilder()
    .setColor(currentTier ? currentTier.color : 0x2b2d31)
    .setTitle('🎖️ Prestige')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '🏅 Current Tier', value: currentBadge, inline: true },
      { name: '💰 Total Wealth', value: `${totalWealth.toLocaleString()} ${currency}`, inline: true },
      { name: '🔄 Total Prestiges', value: String(data.totalPrestiges), inline: true },
      { name: '📊 Active Bonuses', value: `Income: **${incomeBonus}** | XP: **${xpBonus}** | Borrow: **${borrowBonus}**`, inline: false },
      { name: '🏆 Prestige Tiers', value: tierDisplay || 'None', inline: false }
    );

  // Add next tier detail
  if (nextTier) {
    embed.addFields({
      name: `⬆️ Next: ${nextTier.emoji} ${nextTier.name}`,
      value: [
        `**Cost:** ${nextTier.cost.toLocaleString()} ${currency} (total wealth)`,
        `**Starting Bonus:** ${nextTier.startingBonus.toLocaleString()} ${currency}`,
        `**New Income:** +${(nextTier.level * settings.incomeMultiplierPerTier * 100).toFixed(0)}%`,
        `**New XP:** +${(nextTier.level * settings.xpMultiplierPerTier * 100).toFixed(0)}%`,
        `**New Borrow:** ${(1 + nextTier.level * settings.borrowMultiplierPerTier).toFixed(0)}x`,
      ].join('\n'),
      inline: false
    });
  }

  if (data.time > 0) {
    embed.addFields({
      name: '⏰ Last Prestige',
      value: `<t:${Math.floor(data.time / 1000)}:R>`,
      inline: true
    });
  }

  // Eligibility check
  const eligibility = canPrestige(guildId, userId, totalWealth);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`prestige_start_${userId}`)
      .setLabel(nextTier ? `Prestige to ${nextTier.name}` : 'Max Prestige')
      .setEmoji(nextTier ? nextTier.emoji : '💎')
      .setStyle(eligibility.eligible ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!eligibility.eligible)
  );

  if (!eligibility.eligible && eligibility.reason) {
    embed.setFooter({ text: eligibility.reason.replace(/\*\*/g, '') });
  }

  const payload = { embeds: [embed], components: [buttons] };
  if (isUpdate) {
    await interaction.editReply(payload);
  } else {
    await interaction.editReply(payload);
  }
}

async function handlePrestigeStart(interaction, guildId, userId) {
  await interaction.deferUpdate();

  const totalWealth = calculateTotalWealth(guildId, userId);
  const eligibility = canPrestige(guildId, userId, totalWealth);
  const currency = getCurrency(guildId);

  if (!eligibility.eligible) {
    return interaction.editReply({
      content: `❌ ${eligibility.reason}`,
      embeds: [],
      components: []
    });
  }

  const nextTier = eligibility.nextTier;

  // Show confirmation with full details of what will be reset
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`⚠️ Prestige to ${nextTier.emoji} ${nextTier.name}?`)
    .setDescription('**This action is IRREVERSIBLE.** Read carefully before confirming.')
    .addFields(
      { name: '💀 WILL BE RESET', value: [
        '• Cash & bank balance',
        '• All stock holdings',
        '• All properties & wealth cards',
        '• All items & active effects',
        '• All loans, bonds & credit score',
        '• All cooldowns & timers',
        '• Skills XP (hack & rob)'
      ].join('\n'), inline: true },
      { name: '✅ WILL BE KEPT', value: [
        '• Fight stats & fighter level',
        '• Dungeon progress',
        '• Infamy & bounty',
        '• Gambling stats',
        '• Chat streak',
        '• Stock price & popularity',
        "• Others' shares of your stock"
      ].join('\n'), inline: true },
      { name: '🎁 YOU WILL RECEIVE', value: [
        `• ${nextTier.emoji} **${nextTier.name}** prestige badge`,
        `• **${nextTier.startingBonus.toLocaleString()}** ${currency} starting cash`,
        `• **+${(nextTier.level * 5)}%** income from all sources`,
        `• **+${(nextTier.level * 10)}%** XP gain`,
        `• **${(nextTier.level + 1)}x** borrow limit`,
        `• Prestige leaderboard entry`
      ].join('\n'), inline: false },
      { name: '💰 Current Wealth', value: `**${totalWealth.toLocaleString()}** ${currency} → **${nextTier.startingBonus.toLocaleString()}** ${currency}`, inline: false }
    )
    .setFooter({ text: 'This cannot be undone. You will lose everything listed above.' });

  const confirmButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`prestige_confirm_${userId}`)
      .setLabel(`PRESTIGE TO ${nextTier.name.toUpperCase()}`)
      .setEmoji('⚠️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`prestige_cancel_${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [confirmButtons] });
}

async function handlePrestigeConfirm(interaction, guildId, userId) {
  await interaction.deferUpdate();

  // Re-validate everything at the moment of execution
  const totalWealth = calculateTotalWealth(guildId, userId);
  const eligibility = canPrestige(guildId, userId, totalWealth);
  const currency = getCurrency(guildId);

  if (!eligibility.eligible) {
    return interaction.editReply({
      content: `❌ Prestige failed: ${eligibility.reason}`,
      embeds: [],
      components: []
    });
  }

  // Execute the prestige
  const result = executePrestige(guildId, userId, totalWealth);

  if (!result.success) {
    return interaction.editReply({
      content: `❌ Prestige failed: ${result.error}`,
      embeds: [],
      components: []
    });
  }

  const tier = result.tier;
  const embed = new EmbedBuilder()
    .setColor(tier.color)
    .setTitle(`${tier.emoji} PRESTIGE ACHIEVED — ${tier.name.toUpperCase()}!`)
    .setDescription(`**${interaction.user.displayName}** has prestiged!`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '🏅 New Tier', value: `${tier.emoji} ${tier.name}`, inline: true },
      { name: '💵 Starting Cash', value: `${tier.startingBonus.toLocaleString()} ${currency}`, inline: true },
      { name: '💰 Wealth Sacrificed', value: `${totalWealth.toLocaleString()} ${currency}`, inline: true },
      { name: '📈 Active Bonuses', value: [
        `Income: **+${tier.level * 5}%**`,
        `XP: **+${tier.level * 10}%**`,
        `Borrow: **${tier.level + 1}x**`
      ].join(' | '), inline: false }
    )
    .setTimestamp()
    .setFooter({ text: 'A new journey begins...' });

  await interaction.editReply({ embeds: [embed], components: [] });
}

function createProgressBar(percent, length = 10) {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
