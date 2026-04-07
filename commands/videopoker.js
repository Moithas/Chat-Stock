// Video Poker Command
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBalance, removeFromTotal, addMoney } = require('../economy');
const {
  getSettings,
  hasActiveGame,
  getActiveGame,
  startGame,
  holdCards,
  drawCards,
  endGame,
  forceEndGame,
  setGameMessage,
  setGameTimer,
  formatCard,
  getPayTable,
  getVariants,
  PAY_TABLES
} = require('../videopoker');
const { generateVideoPokerImage } = require('../cardImages');
const { getCurrency } = require('../admin');
const { applyGamblingBonus, getPetBonusDecimal } = require('../pets');

// Prevent double-click processing
const processingUsers = new Set();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('videopoker')
    .setDescription('Play Video Poker!')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Your bet amount')
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const betAmount = interaction.options.getInteger('bet');

    await interaction.deferReply();

    const settings = getSettings(guildId);

    if (!settings.enabled) {
      return interaction.editReply({ content: '❌ Video Poker is currently disabled on this server.' });
    }

    if (hasActiveGame(guildId, userId)) {
      return interaction.editReply({ content: '❌ You already have an active Video Poker game!' });
    }

    if (betAmount < settings.minBet || betAmount > settings.maxBet) {
      return interaction.editReply({
        content: `❌ Bet must be between **${settings.minBet.toLocaleString()}** and **${settings.maxBet.toLocaleString()}** ${getCurrency(guildId)}.`
      });
    }

    const balance = await getBalance(guildId, userId);
    if (balance.total < betAmount) {
      return interaction.editReply({
        content: `❌ You need **${betAmount.toLocaleString()}** ${getCurrency(guildId)} to play.\nYour balance: **${balance.total.toLocaleString()}** ${getCurrency(guildId)}`
      });
    }

    // Show variant selection
    const embed = new EmbedBuilder()
      .setColor(0x1565C0)
      .setTitle('🎰 Video Poker — Choose Your Game')
      .setDescription(
        `Bet: **${betAmount.toLocaleString()}** ${getCurrency(guildId)}\n\n` +
        `👑 **Jacks or Better** — Classic! Pair of Jacks+ wins.\n` +
        `🃏 **Deuces Wild** — All 2s are wild cards!\n` +
        `💎 **Bonus Poker** — Bigger payouts for Four of a Kind.`
      )
      .setFooter({ text: 'Select a variant to begin!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vp_variant_${userId}_${betAmount}_jacks_or_better`)
        .setLabel('Jacks or Better')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👑'),
      new ButtonBuilder()
        .setCustomId(`vp_variant_${userId}_${betAmount}_deuces_wild`)
        .setLabel('Deuces Wild')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🃏'),
      new ButtonBuilder()
        .setCustomId(`vp_variant_${userId}_${betAmount}_bonus_poker`)
        .setLabel('Bonus Poker')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💎'),
      new ButtonBuilder()
        .setCustomId(`vp_cancel_${userId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }
};

// ==================== GAME DISPLAY ====================

async function buildGameDisplay(game, user) {
  const payTableData = getPayTable(game.variant);
  let embed, attachment = null, components = [];

  try {
    const imageBuffer = await generateVideoPokerImage(
      game.hand,
      game.held,
      game.betAmount,
      user.displayName,
      payTableData.name,
      payTableData.hands,
      game.phase === 'resolved' ? game.result : null
    );
    attachment = new AttachmentBuilder(imageBuffer, { name: 'videopoker.png' });
  } catch (err) {
    console.error('Error generating video poker image:', err);
  }

  if (game.phase === 'hold') {
    embed = buildHoldEmbed(game, user, attachment);
    components = buildHoldButtons(user.id, game.held);
  } else if (game.phase === 'resolved') {
    embed = buildResultEmbed(game, user, attachment);
    components = buildResultButtons(user.id, game.betAmount);
  }

  return { embed, attachment, components };
}

function buildHoldEmbed(game, user, attachment) {
  const payTableData = getPayTable(game.variant);
  const heldCount = game.held.filter(h => h).length;

  const embed = new EmbedBuilder()
    .setColor(0x1565C0)
    .setTitle(`🎰 Video Poker — ${payTableData.name}`)
    .setDescription(
      `Select cards to **HOLD**, then click **DRAW** to replace the rest.\n\n` +
      `🃏 **Your Hand:** ${game.hand.map((c, i) => `${game.held[i] ? '**[' : ''}${formatCard(c)}${game.held[i] ? ']**' : ''}`).join('  ')}`
    )
    .addFields(
      { name: '💰 Bet', value: `**${game.betAmount.toLocaleString()}** ${getCurrency(game.guildId)}`, inline: true },
      { name: '📌 Held', value: `**${heldCount}** / 5`, inline: true },
      { name: `${payTableData.emoji} Variant`, value: payTableData.name, inline: true }
    )
    .setFooter({ text: `${user.displayName} • Tap cards to hold, then Draw!` })
    .setTimestamp();

  if (attachment) embed.setImage('attachment://videopoker.png');
  return embed;
}

function buildResultEmbed(game, user, attachment) {
  const payTableData = getPayTable(game.variant);
  const handRank = game.result.rank;
  const payout = game.payout;

  // Calculate pet gambling bonus tag for win display
  let petGamblingBoost = 0;
  let boostedPayout = payout;
  if (payout > 0) {
    try {
      const bonus = getPetBonusDecimal(game.guildId, game.userId, 'gambling');
      if (bonus > 0) {
        petGamblingBoost = Math.round(bonus * 100);
        boostedPayout = Math.floor(payout * (1 + bonus));
      }
    } catch (e) {}
  }

  let color, title, description;

  if (payout > 0) {
    color = 0x4CAF50;
    title = `🎉 ${handRank}!`;
    const multiplier = game.result.payout;
    description =
      `**${handRank}** pays **${multiplier}:1**!\n\n` +
      `Bet: **${game.betAmount.toLocaleString()}** ${getCurrency(game.guildId)}\n` +
      `Payout: **${multiplier}x** × ${game.betAmount.toLocaleString()} = **+${payout.toLocaleString()}** ${getCurrency(game.guildId)}!` +
      (petGamblingBoost > 0 ? `\n🐾 Pet bonus: +${petGamblingBoost}% → **+${boostedPayout.toLocaleString()}** ${getCurrency(game.guildId)}` : '');
  } else {
    color = 0xF44336;
    title = '😔 No Winning Hand';
    description =
      `Your hand: **${handRank}**\n\n` +
      `Lost: **-${Math.abs(payout).toLocaleString()}** ${getCurrency(game.guildId)}`;
  }

  const finalCards = game.hand.map((c, i) => `**${formatCard(c)}**`).join('  ');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎰 ${payTableData.name} — ${title}`)
    .setDescription(description)
    .addFields(
      { name: '🃏 Final Hand', value: finalCards, inline: false }
    )
    .setFooter({ text: user.displayName })
    .setTimestamp();

  if (attachment) embed.setImage('attachment://videopoker.png');
  return embed;
}

// ==================== BUTTON BUILDERS ====================

function buildHoldButtons(userId, held) {
  // Row 1: Card hold toggles (1-5)
  const cardRow = new ActionRowBuilder().addComponents(
    ...held.map((isHeld, i) =>
      new ButtonBuilder()
        .setCustomId(`vp_hold_${userId}_${i}`)
        .setLabel(`Card ${i + 1}${isHeld ? ' ✓' : ''}`)
        .setStyle(isHeld ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );

  // Row 2: Draw and Hold All / Release All
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vp_draw_${userId}`)
      .setLabel('DRAW')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎰'),
    new ButtonBuilder()
      .setCustomId(`vp_holdall_${userId}`)
      .setLabel('Hold All')
      .setStyle(ButtonStyle.Success)
      .setEmoji('📌'),
    new ButtonBuilder()
      .setCustomId(`vp_releaseall_${userId}`)
      .setLabel('Release All')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔄')
  );

  return [cardRow, actionRow];
}

function buildResultButtons(userId, betAmount) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vp_playagain_${userId}_${betAmount}`)
      .setLabel('Play Again')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId(`vp_done_${userId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✅')
  );

  return [row];
}

// ==================== BUTTON HANDLERS ====================

async function handleButton(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const customId = interaction.customId;

  // ---- Variant selection ----
  if (customId.startsWith('vp_variant_')) {
    const parts = customId.split('_');
    // vp_variant_{userId}_{betAmount}_{variant_with_underscores}
    const targetUserId = parts[2];
    const betAmount = parseInt(parts[3]);
    const variant = parts.slice(4).join('_');

    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }

    if (processingUsers.has(userId)) {
      return interaction.reply({ content: '⏳ Processing...', flags: 64 });
    }
    processingUsers.add(userId);

    try {
      const settings = getSettings(guildId);
      if (!settings.enabled) {
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('🎰 Game Disabled').setDescription('Video Poker is currently disabled.');
        return interaction.update({ embeds: [embed], components: [] });
      }

      if (hasActiveGame(guildId, userId)) {
        return interaction.reply({ content: '❌ You already have an active game!', flags: 64 });
      }

      // Check balance and deduct
      const balance = await getBalance(guildId, userId);
      if (balance.total < betAmount) {
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('💸 Insufficient Funds')
          .setDescription(`You need **${betAmount.toLocaleString()}** ${getCurrency(guildId)} to play.`);
        return interaction.update({ embeds: [embed], components: [] });
      }

      await removeFromTotal(guildId, userId, betAmount, 'Video Poker bet');

      // Start game
      const game = startGame(guildId, userId, interaction.user.displayName, betAmount, variant);

      await interaction.deferUpdate();

      const { embed, attachment, components } = await buildGameDisplay(game, interaction.user);
      const reply = await interaction.editReply({
        embeds: [embed],
        files: attachment ? [attachment] : [],
        components
      });

      setGameMessage(guildId, userId, reply.id, interaction.channelId);

      setGameTimer(guildId, userId, async () => {
        await handleTimeout(interaction.client, guildId, userId);
      }, settings.timerSeconds * 1000);
    } catch (err) {
      console.error('Error starting video poker:', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ An error occurred.', flags: 64 });
        }
      } catch (e) { /* ignore */ }
    } finally {
      processingUsers.delete(userId);
    }
    return;
  }

  // ---- Cancel ----
  if (customId.startsWith('vp_cancel_')) {
    const targetUserId = customId.split('_')[2];
    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎰 Game Cancelled').setDescription('No bets were placed.');
    return interaction.update({ embeds: [embed], components: [] });
  }

  // ---- Play Again ----
  if (customId.startsWith('vp_playagain_')) {
    const parts = customId.split('_');
    const targetUserId = parts[2];
    const betAmount = parseInt(parts[3]);

    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }

    await handlePlayAgain(interaction, betAmount);
    return;
  }

  // ---- Done ----
  if (customId.startsWith('vp_done_')) {
    const targetUserId = customId.split('_')[2];
    if (userId !== targetUserId) {
      return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
    }
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎰 Thanks for Playing!').setDescription('Come back anytime to play Video Poker!');
    await interaction.update({ embeds: [embed], components: [] });
    return;
  }

  // ---- Game action buttons (hold, draw, holdall, releaseall) ----
  if (processingUsers.has(userId)) {
    return interaction.reply({ content: '⏳ Processing your last action...', flags: 64 });
  }

  const game = getActiveGame(guildId, userId);
  if (!game) {
    return interaction.reply({ content: '❌ No active game found.', flags: 64 });
  }

  if (game.userId !== userId) {
    return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
  }

  // Validate button belongs to this user
  const parts = customId.split('_');
  if (parts[2] !== userId) {
    return interaction.reply({ content: '❌ This is not your game!', flags: 64 });
  }

  processingUsers.add(userId);
  try {
    try {
      await interaction.deferUpdate();
    } catch (err) {
      console.error('Error deferring video poker update:', err);
      return;
    }

    const settings = getSettings(guildId);

    // Handle hold toggle
    if (customId.startsWith('vp_hold_')) {
      const cardIndex = parseInt(parts[3]);
      if (game.phase !== 'hold') {
        return interaction.followUp({ content: '❌ Game is not in hold phase.', flags: 64 });
      }

      const newHeld = [...game.held];
      newHeld[cardIndex] = !newHeld[cardIndex];
      holdCards(guildId, userId, newHeld);

      const { embed, attachment, components } = await buildGameDisplay(game, interaction.user);
      await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components });

      // Reset timer
      setGameTimer(guildId, userId, async () => {
        await handleTimeout(interaction.client, guildId, userId);
      }, settings.timerSeconds * 1000);
      return;
    }

    // Handle Hold All
    if (customId.startsWith('vp_holdall_')) {
      if (game.phase !== 'hold') return;
      holdCards(guildId, userId, [true, true, true, true, true]);

      const { embed, attachment, components } = await buildGameDisplay(game, interaction.user);
      await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components });

      setGameTimer(guildId, userId, async () => {
        await handleTimeout(interaction.client, guildId, userId);
      }, settings.timerSeconds * 1000);
      return;
    }

    // Handle Release All
    if (customId.startsWith('vp_releaseall_')) {
      if (game.phase !== 'hold') return;
      holdCards(guildId, userId, [false, false, false, false, false]);

      const { embed, attachment, components } = await buildGameDisplay(game, interaction.user);
      await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components });

      setGameTimer(guildId, userId, async () => {
        await handleTimeout(interaction.client, guildId, userId);
      }, settings.timerSeconds * 1000);
      return;
    }

    // Handle Draw
    if (customId.startsWith('vp_draw_')) {
      if (game.phase !== 'hold') {
        return interaction.followUp({ content: '❌ Game is not in hold phase.', flags: 64 });
      }

      const updatedGame = drawCards(guildId, userId);
      if (!updatedGame) {
        return interaction.followUp({ content: '❌ Error drawing cards.', flags: 64 });
      }

      const { embed, attachment, components } = await buildGameDisplay(updatedGame, interaction.user);
      await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components });

      // Process payout
      await processResult(interaction, updatedGame);
      endGame(guildId, userId);
      return;
    }
  } catch (err) {
    console.error('Error handling video poker button:', err);
    try {
      await interaction.followUp({ content: '❌ An error occurred processing your action.', flags: 64 });
    } catch (e) { /* ignore */ }
  } finally {
    processingUsers.delete(userId);
  }
}

async function processResult(interaction, game) {
  if (game.payout > 0) {
    // Win — return bet + boosted winnings
    const boostedPayout = applyGamblingBonus(game.guildId, game.userId, game.payout);
    const totalReturn = boostedPayout + game.betAmount;
    await addMoney(game.guildId, game.userId, totalReturn, 'Video Poker winnings');
  }
  // If payout <= 0, bet was already deducted at start
}

async function handleTimeout(client, guildId, userId) {
  const game = getActiveGame(guildId, userId);
  if (!game) return;

  const result = forceEndGame(guildId, userId, 'timeout');
  if (!result) return;

  // Process payouts
  if (result.payout > 0) {
    const boostedPayout = applyGamblingBonus(result.guildId, userId, result.payout);
    const totalReturn = boostedPayout + result.betAmount;
    await addMoney(result.guildId, userId, totalReturn, 'Video Poker winnings (timeout)');
  }

  // Update the original message
  try {
    const channel = await client.channels.fetch(game.channelId);
    const message = await channel.messages.fetch(game.messageId);

    const user = await client.users.fetch(userId);
    const { embed, attachment } = await buildGameDisplay(result, user);

    embed.setDescription(embed.data.description + '\n\n⏰ *Game auto-completed due to timeout.*');

    await message.edit({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
  } catch (err) {
    console.error('Error updating timed out video poker game:', err);
  }
}

async function handlePlayAgain(interaction, betAmount) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const settings = getSettings(guildId);

  if (!settings.enabled) {
    const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('🎰 Game Disabled').setDescription('Video Poker is currently disabled.');
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Clean up any existing game
  if (hasActiveGame(guildId, userId)) {
    forceEndGame(guildId, userId);
  }

  // Check balance
  const balance = await getBalance(guildId, userId);
  if (balance.total < betAmount) {
    const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('💸 Insufficient Funds')
      .setDescription(`You need **${betAmount.toLocaleString()}** ${getCurrency(guildId)} to play again.\nYou have **${balance.total.toLocaleString()}** ${getCurrency(guildId)}.`);
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Show variant selection again
  const embed = new EmbedBuilder()
    .setColor(0x1565C0)
    .setTitle('🎰 Video Poker — Choose Your Game')
    .setDescription(
      `Bet: **${betAmount.toLocaleString()}** ${getCurrency(guildId)}\n\n` +
      `👑 **Jacks or Better** — Classic! Pair of Jacks+ wins.\n` +
      `🃏 **Deuces Wild** — All 2s are wild cards!\n` +
      `💎 **Bonus Poker** — Bigger payouts for Four of a Kind.`
    )
    .setFooter({ text: 'Select a variant to begin!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vp_variant_${userId}_${betAmount}_jacks_or_better`)
      .setLabel('Jacks or Better')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👑'),
    new ButtonBuilder()
      .setCustomId(`vp_variant_${userId}_${betAmount}_deuces_wild`)
      .setLabel('Deuces Wild')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🃏'),
    new ButtonBuilder()
      .setCustomId(`vp_variant_${userId}_${betAmount}_bonus_poker`)
      .setLabel('Bonus Poker')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💎'),
    new ButtonBuilder()
      .setCustomId(`vp_cancel_${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✖️')
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

module.exports.handleButton = handleButton;
module.exports.handleTimeout = handleTimeout;
