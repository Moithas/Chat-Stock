const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, removeMoney, addMoney } = require('../economy');
const {
  getFightSettings,
  getFighterStats,
  calculateOdds,
  canFightOpponent,
  createFight,
  getFight,
  getFightByChannel,
  getFightByFighter,
  deleteFight,
  createChallenge,
  getChallenge,
  getChallengeForOpponent,
  deleteChallenge,
  placeSpectatorBet,
  getSpectatorBetTotals,
  clearSpectatorBets,
  recordFight,
  recordFightHistory,
  updateFighterStats,
  calculateRoundResult,
  getRandomGif,
  createHealthBar,
  DAMAGE,
  GIFS
} = require('../fight');
const { saveDatabase } = require('../database');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fight')
    .setDescription('Challenge someone to a cage fight!')
    .addUserOption(option =>
      option.setName('opponent')
        .setDescription('The user you want to fight')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Amount to wager')
        .setRequired(true)
        .setMinValue(1)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const challenger = interaction.user;
    const opponent = interaction.options.getUser('opponent');
    const betAmount = interaction.options.getInteger('bet');
    const settings = getFightSettings(guildId);

    // Check if fighting is enabled
    if (!settings.enabled) {
      return interaction.reply({ content: '❌ Fighting is currently disabled on this server.', ephemeral: true });
    }

    // Can't fight yourself
    if (challenger.id === opponent.id) {
      return interaction.reply({ content: '❌ You can\'t fight yourself!', ephemeral: true });
    }

    // Can't fight bots
    if (opponent.bot) {
      return interaction.reply({ content: '❌ You can\'t fight bots!', ephemeral: true });
    }

    // Check if either player is already in a fight
    const existingFight1 = getFightByFighter(guildId, challenger.id);
    const existingFight2 = getFightByFighter(guildId, opponent.id);
    
    if (existingFight1) {
      return interaction.reply({ content: '❌ You\'re already in a fight!', ephemeral: true });
    }
    if (existingFight2) {
      return interaction.reply({ content: '❌ That player is already in a fight!', ephemeral: true });
    }

    // Check for existing challenge
    const existingChallenge = getChallenge(guildId, challenger.id);
    if (existingChallenge) {
      return interaction.reply({ content: '❌ You already have a pending challenge!', ephemeral: true });
    }

    // Check rematch cooldown
    const rematchCheck = canFightOpponent(guildId, challenger.id, opponent.id);
    if (!rematchCheck.canFight) {
      return interaction.reply({ 
        content: `❌ You must fight **${rematchCheck.fightsNeeded}** more unique opponent(s) before you can fight this person again!`, 
        ephemeral: true 
      });
    }

    // Check challenger has enough money (cash only)
    const challengerBalance = await getBalance(guildId, challenger.id);
    if (challengerBalance.cash < betAmount) {
      return interaction.reply({ 
        content: `❌ You don't have enough cash! You have **${challengerBalance.cash.toLocaleString()}** ${CURRENCY} in cash.`, 
        ephemeral: true 
      });
    }

    // Check opponent has enough money (we'll verify again on accept)
    const opponentBalance = await getBalance(guildId, opponent.id);
    if (opponentBalance.cash < betAmount) {
      return interaction.reply({ 
        content: `❌ ${opponent.displayName} doesn't have enough cash to match your bet!`, 
        ephemeral: true 
      });
    }

    // Fetch member objects for display names and avatars
    let challengerMember, opponentMember;
    try {
      challengerMember = await interaction.guild.members.fetch(challenger.id);
      opponentMember = await interaction.guild.members.fetch(opponent.id);
    } catch {
      return interaction.reply({ content: '❌ Could not fetch player information.', ephemeral: true });
    }

    // Create the challenge
    createChallenge(guildId, challenger.id, {
      id: challenger.id,
      username: challenger.username,
      displayName: challengerMember.displayName,
      avatarURL: challenger.displayAvatarURL({ dynamic: true, size: 128 })
    }, {
      id: opponent.id,
      username: opponent.username,
      displayName: opponentMember.displayName,
      avatarURL: opponent.displayAvatarURL({ dynamic: true, size: 128 })
    }, betAmount);

    // Get fighter stats for display
    const challengerStats = getFighterStats(guildId, challenger.id);
    const opponentStats = getFighterStats(guildId, opponent.id);

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🥊 CAGE FIGHT CHALLENGE!')
      .setDescription(`**${challengerMember.displayName}** has challenged **${opponentMember.displayName}** to a fight!`)
      .addFields(
        { 
          name: `🔴 ${challengerMember.displayName}`, 
          value: `Record: **${challengerStats.wins}-${challengerStats.losses}**${challengerStats.draws > 0 ? `-${challengerStats.draws}` : ''}\nKOs: **${challengerStats.knockouts}** | TKOs: **${challengerStats.tkos}**`, 
          inline: true 
        },
        { 
          name: `🔵 ${opponentMember.displayName}`, 
          value: `Record: **${opponentStats.wins}-${opponentStats.losses}**${opponentStats.draws > 0 ? `-${opponentStats.draws}` : ''}\nKOs: **${opponentStats.knockouts}** | TKOs: **${opponentStats.tkos}**`, 
          inline: true 
        },
        { name: '💰 Wager', value: `**${betAmount.toLocaleString()}** ${CURRENCY}`, inline: false }
      )
      .setFooter({ text: `${opponentMember.displayName} has ${settings.challengeTimeoutSeconds} seconds to respond!` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`fight_accept_${challenger.id}`)
        .setLabel('Accept Fight')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`fight_decline_${challenger.id}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );

    const message = await interaction.reply({ 
      content: `<@${opponent.id}>`, 
      embeds: [embed], 
      components: [row], 
      fetchReply: true 
    });

    // Set timeout for challenge expiration
    setTimeout(async () => {
      const challenge = getChallenge(guildId, challenger.id);
      if (challenge) {
        deleteChallenge(guildId, challenger.id);
        
        const expiredEmbed = EmbedBuilder.from(embed)
          .setColor(0x666666)
          .setFooter({ text: 'Challenge expired - no response' });

        try {
          await message.edit({ embeds: [expiredEmbed], components: [] });
        } catch {}
      }
    }, settings.challengeTimeoutSeconds * 1000);
  },

  // Handle button interactions
  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;

    // Accept fight
    if (customId.startsWith('fight_accept_')) {
      const challengerId = customId.replace('fight_accept_', '');
      const challenge = getChallenge(guildId, challengerId);

      if (!challenge) {
        return interaction.reply({ content: '❌ This challenge no longer exists.', ephemeral: true });
      }

      if (interaction.user.id !== challenge.opponent.id) {
        return interaction.reply({ content: '❌ This challenge isn\'t for you!', ephemeral: true });
      }

      // Verify both players still have the money
      const challengerBalance = await getBalance(guildId, challenge.challenger.id);
      const opponentBalance = await getBalance(guildId, challenge.opponent.id);

      if (challengerBalance.cash < challenge.betAmount) {
        deleteChallenge(guildId, challengerId);
        return interaction.update({ 
          content: `❌ ${challenge.challenger.displayName} no longer has enough cash!`,
          embeds: [],
          components: []
        });
      }

      if (opponentBalance.cash < challenge.betAmount) {
        deleteChallenge(guildId, challengerId);
        return interaction.update({ 
          content: '❌ You no longer have enough cash!',
          embeds: [],
          components: []
        });
      }

      // Take money from both players (escrow)
      await removeMoney(guildId, challenge.challenger.id, challenge.betAmount, 'Fight wager');
      await removeMoney(guildId, challenge.opponent.id, challenge.betAmount, 'Fight wager');

      // Create the fight
      const fight = createFight(
        guildId,
        interaction.channelId,
        challenge.challenger,
        challenge.opponent,
        challenge.betAmount
      );

      deleteChallenge(guildId, challengerId);

      // Start the betting phase
      await startBettingPhase(interaction, fight);
      return;
    }

    // Decline fight
    if (customId.startsWith('fight_decline_')) {
      const challengerId = customId.replace('fight_decline_', '');
      const challenge = getChallenge(guildId, challengerId);

      if (!challenge) {
        return interaction.reply({ content: '❌ This challenge no longer exists.', ephemeral: true });
      }

      if (interaction.user.id !== challenge.opponent.id) {
        return interaction.reply({ content: '❌ This challenge isn\'t for you!', ephemeral: true });
      }

      deleteChallenge(guildId, challengerId);

      return interaction.update({
        content: `**${challenge.opponent.displayName}** declined the fight!`,
        embeds: [],
        components: []
      });
    }

    // Spectator bet buttons
    if (customId.startsWith('fight_bet_')) {
      const parts = customId.split('_');
      const fightId = parts[2];
      const fighterId = parts[3];
      
      const fight = getFight(fightId);
      if (!fight || fight.status !== 'betting') {
        return interaction.reply({ content: '❌ Betting is closed!', ephemeral: true });
      }

      // Can't bet on own fight
      if (interaction.user.id === fight.challenger.id || interaction.user.id === fight.opponent.id) {
        return interaction.reply({ content: '❌ You can\'t bet on your own fight!', ephemeral: true });
      }

      // Check if already bet
      const existingBet = fight.spectatorBets.find(b => b.oddsMinFights === interaction.user.id);
      if (existingBet) {
        return interaction.reply({ content: '❌ You\'ve already placed a bet on this fight!', ephemeral: true });
      }

      // Show bet amount modal or buttons
      const fighterName = fighterId === fight.challenger.id ? fight.challenger.displayName : fight.opponent.displayName;
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`fight_betamt_${fightId}_${fighterId}_1000`)
          .setLabel('1,000')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`fight_betamt_${fightId}_${fighterId}_5000`)
          .setLabel('5,000')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`fight_betamt_${fightId}_${fighterId}_10000`)
          .setLabel('10,000')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`fight_betamt_${fightId}_${fighterId}_max`)
          .setLabel(`Max (${fight.betAmount.toLocaleString()})`)
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({
        content: `How much do you want to bet on **${fighterName}**?`,
        components: [row],
        ephemeral: true
      });
    }

    // Spectator bet amount selection
    if (customId.startsWith('fight_betamt_')) {
      const parts = customId.split('_');
      const fightId = parts[2];
      const fighterId = parts[3];
      const amountStr = parts[4];

      const fight = getFight(fightId);
      if (!fight || fight.status !== 'betting') {
        return interaction.update({ content: '❌ Betting is closed!', components: [] });
      }

      const amount = amountStr === 'max' ? fight.betAmount : parseInt(amountStr);

      // Validate amount
      if (amount > fight.betAmount) {
        return interaction.update({ content: `❌ Maximum bet is **${fight.betAmount.toLocaleString()}** ${CURRENCY}`, components: [] });
      }

      // Check balance
      const balance = await getBalance(guildId, interaction.user.id);
      if (balance.cash < amount) {
        return interaction.update({ content: `❌ You don't have enough cash! You have **${balance.cash.toLocaleString()}** ${CURRENCY}`, components: [] });
      }

      // Take money and record bet
      await removeMoney(guildId, interaction.user.id, amount, 'Fight spectator bet');
      
      fight.spectatorBets.push({
        oddsMinFights: interaction.user.id,
        oddsMinFightsIdx: fighterId,
        amount: amount
      });

      placeSpectatorBet(guildId, fight.id, interaction.user.id, fighterId, amount);

      const fighterName = fighterId === fight.challenger.id ? fight.challenger.displayName : fight.opponent.displayName;
      
      await interaction.update({ 
        content: `✅ Bet placed: **${amount.toLocaleString()}** ${CURRENCY} on **${fighterName}**!`, 
        components: [] 
      });

      // Update the public embed with new bet totals
      await updateBettingEmbed(interaction.channel, fight);
      return;
    }

    // Fighter clicks "Select Your Move" button - show ephemeral move options
    if (customId.startsWith('fight_select_')) {
      const fightId = customId.split('_')[2];
      const fight = getFight(fightId);
      
      if (!fight || fight.status !== 'fighting') {
        return interaction.reply({ content: '❌ This fight is no longer active!', ephemeral: true });
      }

      const isFighter1 = interaction.user.id === fight.challenger.id;
      const isFighter2 = interaction.user.id === fight.opponent.id;

      if (!isFighter1 && !isFighter2) {
        return interaction.reply({ content: '❌ You\'re not in this fight!', ephemeral: true });
      }

      // Check if they already selected
      if ((isFighter1 && fight.fighter1Selected) || (isFighter2 && fight.fighter2Selected)) {
        return interaction.reply({ content: '✅ You already selected your move! Waiting for opponent...', ephemeral: true });
      }

      const grappleCooldown = isFighter1 ? fight.fighter1GrappleCooldown : fight.fighter2GrappleCooldown;
      const settings = getFightSettings(fight.guildId);

      const moveEmbed = new EmbedBuilder()
        .setColor(isFighter1 ? '#FF6B6B' : '#4ECDC4')
        .setTitle('⚔️ Select Your Move!')
        .setDescription(
          `**Round ${fight.round}** - Choose your attack:\n\n` +
          `👊 **Strike** - Quick attack\n` +
          `🤼 **Takedown** - Wrestling move\n` +
          `🤝 **Choke** - Submission attempt\n` +
          `💚 **Grapple** - Heal 15% HP${grappleCooldown > 0 ? ` (${grappleCooldown} round cooldown)` : ''}`
        )
        .setFooter({ text: 'Only you can see this message' });

      const moveButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`fight_move_${fight.id}_strike`)
          .setLabel('Strike')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('👊'),
        new ButtonBuilder()
          .setCustomId(`fight_move_${fight.id}_takedown`)
          .setLabel('Takedown')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🤼'),
        new ButtonBuilder()
          .setCustomId(`fight_move_${fight.id}_choke`)
          .setLabel('Choke')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🤝'),
        new ButtonBuilder()
          .setCustomId(`fight_move_${fight.id}_grapple`)
          .setLabel(grappleCooldown > 0 ? `Grapple (${grappleCooldown} cd)` : 'Grapple')
          .setStyle(ButtonStyle.Success)
          .setEmoji('💚')
          .setDisabled(grappleCooldown > 0)
      );

      return interaction.reply({ 
        embeds: [moveEmbed], 
        components: [moveButtons], 
        ephemeral: true 
      });
    }

    // Fighter move selection (from ephemeral message)
    if (customId.startsWith('fight_move_')) {
      const parts = customId.split('_');
      const fightId = parts[2];
      const move = parts[3];

      const fight = getFight(fightId);
      if (!fight || fight.status !== 'fighting') {
        return interaction.update({ content: '❌ This fight is no longer active!', components: [], embeds: [] });
      }

      const isFighter1 = interaction.user.id === fight.challenger.id;
      const isFighter2 = interaction.user.id === fight.opponent.id;

      if (!isFighter1 && !isFighter2) {
        return interaction.reply({ content: '❌ You\'re not in this fight!', ephemeral: true });
      }

      // Check if they already selected
      if ((isFighter1 && fight.fighter1Selected) || (isFighter2 && fight.fighter2Selected)) {
        return interaction.update({ content: '✅ You already locked in your move!', components: [], embeds: [] });
      }

      // Check grapple cooldown
      if (move === 'grapple') {
        const cooldown = isFighter1 ? fight.fighter1GrappleCooldown : fight.fighter2GrappleCooldown;
        if (cooldown > 0) {
          return interaction.update({ content: `❌ Grapple is on cooldown for ${cooldown} more round(s)!`, components: [], embeds: [] });
        }
      }

      // Record the move and mark as selected
      if (isFighter1) {
        fight.fighter1Move = move;
        fight.fighter1Selected = true;
      } else {
        fight.fighter2Move = move;
        fight.fighter2Selected = true;
      }

      await interaction.update({ 
        content: `✅ You selected **${move.toUpperCase()}**! Waiting for opponent...`, 
        components: [],
        embeds: []
      });

      // Update the public round message to show who has selected
      await updateRoundMessage(interaction.channel, fight);

      // Check if both moves are in - use resolving flag to prevent race condition
      if (fight.fighter1Move && fight.fighter2Move && !fight.resolving) {
        fight.resolving = true;
        await resolveRound(interaction.channel, fight);
      }

      return;
    }
  }
};

// ==================== BETTING PHASE ====================

async function startBettingPhase(interaction, fight) {
  const settings = getFightSettings(fight.guildId);
  fight.status = 'betting';

  // Calculate odds
  const odds = calculateOdds(fight.guildId, fight.challenger.id, fight.opponent.id);

  // Build odds display text
  const getOddsText = (fighterOdds, winRate, isFirst) => {
    if (odds.isEvenOdds) return `Odds: **${fighterOdds}x**\n(New fighter)`;
    return `Odds: **${fighterOdds}x**\nWin rate: ${winRate}%`;
  };

  // Warning for low-quality matchups
  const loserWarning = odds.bothLosers 
    ? '\n\n⚠️ **Low-quality matchup** - Both fighters have losing records. Odds capped at 2x.' 
    : '';

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🥊 CAGE FIGHT - BETTING OPEN!')
    .setDescription(`**${fight.challenger.displayName}** vs **${fight.opponent.displayName}**\n\n💰 **Prize Pool:** ${(fight.betAmount * 2).toLocaleString()} ${CURRENCY}${loserWarning}`)
    .addFields(
      { 
        name: `🔴 ${fight.challenger.displayName}`, 
        value: getOddsText(odds.fighter1Odds, odds.fighter1WinRate, true), 
        inline: true 
      },
      { 
        name: `🔵 ${fight.opponent.displayName}`, 
        value: getOddsText(odds.fighter2Odds, odds.fighter2WinRate, false), 
        inline: true 
      },
      { 
        name: '💰 Spectator Bets', 
        value: `${fight.challenger.displayName}: **0** ${CURRENCY} (0 bets)\n${fight.opponent.displayName}: **0** ${CURRENCY} (0 bets)`, 
        inline: false 
      }
    )
    .setFooter({ text: `Betting closes in ${settings.spectatorBetWindowSeconds} seconds!` })
    .setThumbnail(fight.challenger.avatarURL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fight_bet_${fight.id}_${fight.challenger.id}`)
      .setLabel(`Bet on ${fight.challenger.displayName}`)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴'),
    new ButtonBuilder()
      .setCustomId(`fight_bet_${fight.id}_${fight.opponent.id}`)
      .setLabel(`Bet on ${fight.opponent.displayName}`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔵')
  );

  const message = await interaction.update({ 
    content: '🎰 **PLACE YOUR BETS!** Fighters cannot bet on their own match.',
    embeds: [embed], 
    components: [row],
    fetchReply: true
  });

  fight.publicMessageId = message.id;

  // Countdown timer updates
  const bettingEndTime = Date.now() + (settings.spectatorBetWindowSeconds * 1000);
  
  const countdownInterval = setInterval(async () => {
    const remaining = Math.ceil((bettingEndTime - Date.now()) / 1000);
    
    if (remaining <= 0 || fight.status !== 'betting') {
      clearInterval(countdownInterval);
      return;
    }

    // Update footer with countdown at 30s, 15s, 10s, 5s
    if ([30, 15, 10, 5].includes(remaining)) {
      try {
        const betTotals = getSpectatorBetTotals(fight.guildId, fight.id, fight.challenger.id, fight.opponent.id);
        
        const updatedEmbed = EmbedBuilder.from(embed)
          .spliceFields(2, 1, {
            name: '💰 Spectator Bets',
            value: `${fight.challenger.displayName}: **${betTotals.fighter1Total.toLocaleString()}** ${CURRENCY} (${betTotals.fighter1Count} bets)\n${fight.opponent.displayName}: **${betTotals.fighter2Total.toLocaleString()}** ${CURRENCY} (${betTotals.fighter2Count} bets)`,
            inline: false
          })
          .setFooter({ text: `⏱️ Betting closes in ${remaining} seconds!` });

        await message.edit({ embeds: [updatedEmbed] });
      } catch {}
    }
  }, 1000);

  // End betting phase after timeout
  setTimeout(async () => {
    if (fight.status === 'betting') {
      clearInterval(countdownInterval);
      await startFightPhase(interaction.channel, fight, message);
    }
  }, settings.spectatorBetWindowSeconds * 1000);
}

async function updateBettingEmbed(channel, fight) {
  if (!fight.publicMessageId) return;

  try {
    const message = await channel.messages.fetch(fight.publicMessageId);
    const embed = message.embeds[0];
    
    const betTotals = getSpectatorBetTotals(fight.guildId, fight.id, fight.challenger.id, fight.opponent.id);
    
    const updatedEmbed = EmbedBuilder.from(embed)
      .spliceFields(2, 1, {
        name: '💰 Spectator Bets',
        value: `${fight.challenger.displayName}: **${betTotals.fighter1Total.toLocaleString()}** ${CURRENCY} (${betTotals.fighter1Count} bets)\n${fight.opponent.displayName}: **${betTotals.fighter2Total.toLocaleString()}** ${CURRENCY} (${betTotals.fighter2Count} bets)`,
        inline: false
      });

    await message.edit({ embeds: [updatedEmbed] });
  } catch {}
}

// ==================== FIGHT PHASE ====================

async function startFightPhase(channel, fight, existingMessage) {
  const settings = getFightSettings(fight.guildId);
  fight.status = 'fighting';
  fight.round = 1;

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('🥊 FIGHT STARTING!')
    .setDescription(`**${fight.challenger.displayName}** vs **${fight.opponent.displayName}**`)
    .addFields(
      { 
        name: `🔴 ${fight.challenger.displayName}`, 
        value: `${createHealthBar(100)} **100%**`, 
        inline: true 
      },
      { 
        name: `🔵 ${fight.opponent.displayName}`, 
        value: `${createHealthBar(100)} **100%**`, 
        inline: true 
      }
    )
    .setFooter({ text: 'Get ready...' });

  // Update the public message
  try {
    if (existingMessage) {
      await existingMessage.edit({ content: '🔔 **FIGHT STARTING!**', embeds: [embed], components: [] });
    } else {
      await channel.send({ embeds: [embed] });
    }
  } catch {}

  // Short delay then start the first round
  setTimeout(async () => {
    await startRoundTimer(channel, fight);
  }, 2000);
}

// Update the public round message when a fighter selects their move
async function updateRoundMessage(channel, fight) {
  if (!fight.roundMessage) return;

  const settings = getFightSettings(fight.guildId);
  
  const f1Status = fight.fighter1Selected ? '✅ Ready!' : '⏳ Waiting...';
  const f2Status = fight.fighter2Selected ? '✅ Ready!' : '⏳ Waiting...';

  const roundEmbed = new EmbedBuilder()
    .setColor(0xFF6B00)
    .setTitle(`⚔️ ROUND ${fight.round}`)
    .setDescription(
      `**${fight.challenger.displayName}** vs **${fight.opponent.displayName}**\n\n` +
      `${createHealthBar(fight.fighter1HP)} ${fight.challenger.displayName}: **${fight.fighter1HP}%**\n` +
      `${createHealthBar(fight.fighter2HP)} ${fight.opponent.displayName}: **${fight.fighter2HP}%**\n\n` +
      `⏱️ **${settings.roundTimeSeconds} seconds** to select your move!\n\n` +
      `Fighters: Click the button below to choose your attack.`
    )
    .addFields(
      { name: '🔴 ' + fight.challenger.displayName, value: f1Status, inline: true },
      { name: '🔵 ' + fight.opponent.displayName, value: f2Status, inline: true }
    )
    .setFooter({ text: 'Your move selection is private - only you can see it!' });

  const selectButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fight_select_${fight.id}`)
      .setLabel('Select Your Move')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🥊')
  );

  try {
    await fight.roundMessage.edit({ embeds: [roundEmbed], components: [selectButton] });
  } catch {}
}

async function startRoundTimer(channel, fight) {
  const settings = getFightSettings(fight.guildId);
  
  // Clear previous moves and flags
  fight.fighter1Move = null;
  fight.fighter2Move = null;
  fight.fighter1Selected = false;
  fight.fighter2Selected = false;
  fight.resolving = false;

  // Create the round prompt embed with a button for fighters to click
  const roundEmbed = new EmbedBuilder()
    .setColor(0xFF6B00)
    .setTitle(`⚔️ ROUND ${fight.round}`)
    .setDescription(
      `**${fight.challenger.displayName}** vs **${fight.opponent.displayName}**\n\n` +
      `${createHealthBar(fight.fighter1HP)} ${fight.challenger.displayName}: **${fight.fighter1HP}%**\n` +
      `${createHealthBar(fight.fighter2HP)} ${fight.opponent.displayName}: **${fight.fighter2HP}%**\n\n` +
      `⏱️ **${settings.roundTimeSeconds} seconds** to select your move!\n\n` +
      `Fighters: Click the button below to choose your attack.`
    )
    .addFields(
      { name: '🔴 ' + fight.challenger.displayName, value: '⏳ Waiting...', inline: true },
      { name: '🔵 ' + fight.opponent.displayName, value: '⏳ Waiting...', inline: true }
    )
    .setFooter({ text: 'Your move selection is private - only you can see it!' });

  const selectButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fight_select_${fight.id}`)
      .setLabel('Select Your Move')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🥊')
  );

  // Send round prompt
  try {
    const roundMsg = await channel.send({
      content: `<@${fight.challenger.id}> <@${fight.opponent.id}>`,
      embeds: [roundEmbed],
      components: [selectButton]
    });
    fight.roundMessageId = roundMsg.id;
    fight.roundMessage = roundMsg;
  } catch (err) {
    console.error(`Failed to send round ${fight.round} prompt:`, err.message);
  }

  // Round timer
  fight.roundTimeout = setTimeout(async () => {
    // Time's up - resolve with whatever moves were made (check resolving flag)
    if (!fight.resolving) {
      fight.resolving = true;
      await resolveRound(channel, fight);
    }
  }, settings.roundTimeSeconds * 1000);
}

async function resolveRound(channel, fight) {
  // Clear the timeout if it exists
  if (fight.roundTimeout) {
    clearTimeout(fight.roundTimeout);
    fight.roundTimeout = null;
  }

  // Delete round message (the one with the "Select Your Move" button)
  try {
    if (fight.roundMessage) await fight.roundMessage.delete().catch(() => {});
    fight.roundMessage = null;
  } catch {}

  const settings = getFightSettings(fight.guildId);
  const result = calculateRoundResult(fight.fighter1Move, fight.fighter2Move);

  // Track AFK streaks
  if (!fight.fighter1Move) {
    fight.fighter1AfkStreak++;
  } else {
    fight.fighter1AfkStreak = 0;
  }

  if (!fight.fighter2Move) {
    fight.fighter2AfkStreak++;
  } else {
    fight.fighter2AfkStreak = 0;
  }

  // Track consecutive double AFK
  if (!fight.fighter1Move && !fight.fighter2Move) {
    fight.consecutiveDoubleAfk++;
  } else {
    fight.consecutiveDoubleAfk = 0;
  }

  // Apply damage and healing
  fight.fighter1HP = Math.max(0, Math.min(100, fight.fighter1HP - result.fighter1Damage + result.fighter1Heal));
  fight.fighter2HP = Math.max(0, Math.min(100, fight.fighter2HP - result.fighter2Damage + result.fighter2Heal));

  // Update grapple cooldowns
  if (fight.fighter1Move === 'grapple') {
    fight.fighter1GrappleCooldown = settings.grappleCooldown;
  } else if (fight.fighter1GrappleCooldown > 0) {
    fight.fighter1GrappleCooldown--;
  }

  if (fight.fighter2Move === 'grapple') {
    fight.fighter2GrappleCooldown = settings.grappleCooldown;
  } else if (fight.fighter2GrappleCooldown > 0) {
    fight.fighter2GrappleCooldown--;
  }

  // Record round in history
  fight.roundHistory.push({
    round: fight.round,
    fighter1Move: fight.fighter1Move,
    fighter2Move: fight.fighter2Move,
    fighter1HP: fight.fighter1HP,
    fighter2HP: fight.fighter2HP,
    result: result
  });

  // Check for fight end conditions
  let fightEnded = false;
  let endReason = null;
  let winnerId = null;
  let loserId = null;

  // KO check
  if (fight.fighter1HP <= 0) {
    fightEnded = true;
    endReason = 'knockout';
    winnerId = fight.opponent.id;
    loserId = fight.challenger.id;
  } else if (fight.fighter2HP <= 0) {
    fightEnded = true;
    endReason = 'knockout';
    winnerId = fight.challenger.id;
    loserId = fight.opponent.id;
  }

  // TKO check (3 consecutive AFK rounds)
  if (!fightEnded && fight.fighter1AfkStreak >= settings.tkoRounds) {
    fightEnded = true;
    endReason = 'tko';
    winnerId = fight.opponent.id;
    loserId = fight.challenger.id;
  } else if (!fightEnded && fight.fighter2AfkStreak >= settings.tkoRounds) {
    fightEnded = true;
    endReason = 'tko';
    winnerId = fight.challenger.id;
    loserId = fight.opponent.id;
  }

  // Double AFK draw check
  if (!fightEnded && fight.consecutiveDoubleAfk >= settings.drawAfkRounds) {
    fightEnded = true;
    endReason = 'draw_afk';
  }

  // Max rounds check
  if (!fightEnded && fight.round >= settings.maxRounds) {
    fightEnded = true;
    if (fight.fighter1HP > fight.fighter2HP) {
      endReason = 'decision';
      winnerId = fight.challenger.id;
      loserId = fight.opponent.id;
    } else if (fight.fighter2HP > fight.fighter1HP) {
      endReason = 'decision';
      winnerId = fight.opponent.id;
      loserId = fight.challenger.id;
    } else {
      endReason = 'draw_decision';
    }
  }

  // Build round result embed
  const gif = result.winningMove ? getRandomGif(result.winningMove) : (result.type === 'stalemate' ? getRandomGif('doubleGrapple') : null);
  
  const roundEmbed = new EmbedBuilder()
    .setColor(fightEnded ? (endReason.includes('draw') ? 0xFFD700 : 0x00FF00) : 0xFF0000)
    .setTitle(fightEnded ? '🏆 FIGHT OVER!' : `🥊 ROUND ${fight.round} RESULT`)
    .setDescription(buildRoundDescription(fight, result, fightEnded, endReason, winnerId))
    .addFields(
      { 
        name: `🔴 ${fight.challenger.displayName}`, 
        value: `${createHealthBar(fight.fighter1HP)} **${fight.fighter1HP}%**\nMove: ${fight.fighter1Move ? fight.fighter1Move.toUpperCase() : '❌ NO RESPONSE'}`, 
        inline: true 
      },
      { 
        name: `🔵 ${fight.opponent.displayName}`, 
        value: `${createHealthBar(fight.fighter2HP)} **${fight.fighter2HP}%**\nMove: ${fight.fighter2Move ? fight.fighter2Move.toUpperCase() : '❌ NO RESPONSE'}`, 
        inline: true 
      }
    );

  if (gif) {
    roundEmbed.setImage(gif);
  }

  // Delete old public message and send new one
  try {
    if (fight.publicMessageId) {
      const oldMsg = await channel.messages.fetch(fight.publicMessageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    }
  } catch {}

  const newPublicMsg = await channel.send({ embeds: [roundEmbed] });
  fight.publicMessageId = newPublicMsg.id;

  if (fightEnded) {
    // Delay before ending so players can see the final result
    setTimeout(async () => {
      await endFight(channel, fight, endReason, winnerId, loserId);
    }, 10000);
  } else {
    // Continue to next round
    fight.round++;
    
    // Delay before next round so players can read the result
    setTimeout(async () => {
      await startNextRound(channel, fight);
    }, 10000);
  }
}

function buildRoundDescription(fight, result, fightEnded, endReason, winnerId) {
  // Replace generic fighter names with actual display names
  let desc = result.description
    .replace(/Fighter 1/g, fight.challenger.displayName)
    .replace(/Fighter 2/g, fight.opponent.displayName) + '\n\n';

  if (fightEnded) {
    if (endReason === 'knockout') {
      const winnerName = winnerId === fight.challenger.id ? fight.challenger.displayName : fight.opponent.displayName;
      desc += `🥊 **${winnerName} WINS BY KNOCKOUT!**`;
    } else if (endReason === 'tko') {
      const winnerName = winnerId === fight.challenger.id ? fight.challenger.displayName : fight.opponent.displayName;
      const loserName = winnerId === fight.challenger.id ? fight.opponent.displayName : fight.challenger.displayName;
      desc += `🛑 **${winnerName} WINS BY TKO!** (${loserName} failed to respond)`;
    } else if (endReason === 'decision') {
      const winnerName = winnerId === fight.challenger.id ? fight.challenger.displayName : fight.opponent.displayName;
      desc += `📋 **${winnerName} WINS BY JUDGES DECISION!**`;
    } else if (endReason === 'draw_afk') {
      desc += `🤝 **FIGHT ENDS IN A DRAW!** (Both fighters failed to respond)`;
    } else if (endReason === 'draw_decision') {
      desc += `🤝 **FIGHT ENDS IN A DRAW!** (Judges couldn't decide)`;
    }
  }

  return desc;
}

async function startNextRound(channel, fight) {
  const settings = getFightSettings(fight.guildId);

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle(`🥊 ROUND ${fight.round} - FIGHT!`)
    .setDescription(`**${fight.challenger.displayName}** vs **${fight.opponent.displayName}**`)
    .addFields(
      { 
        name: `🔴 ${fight.challenger.displayName}`, 
        value: `${createHealthBar(fight.fighter1HP)} **${fight.fighter1HP}%**`, 
        inline: true 
      },
      { 
        name: `🔵 ${fight.opponent.displayName}`, 
        value: `${createHealthBar(fight.fighter2HP)} **${fight.fighter2HP}%**`, 
        inline: true 
      }
    )
    .setFooter({ text: `Fighters have ${settings.roundTimeSeconds} seconds to select their move!` });

  // Delete old message
  try {
    if (fight.publicMessageId) {
      const oldMsg = await channel.messages.fetch(fight.publicMessageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    }
  } catch {}

  const newMsg = await channel.send({ embeds: [embed] });
  fight.publicMessageId = newMsg.id;

  // Start round timer
  startRoundTimer(channel, fight);
}

async function endFight(channel, fight, endReason, winnerId, loserId) {
  const settings = getFightSettings(fight.guildId);
  fight.status = 'finished';

  const isDraw = endReason.includes('draw');
  const totalPot = fight.betAmount * 2;
  
  // Calculate spectator bet payouts
  const odds = calculateOdds(fight.guildId, fight.challenger.id, fight.opponent.id);
  const betTotals = getSpectatorBetTotals(fight.guildId, fight.id, fight.challenger.id, fight.opponent.id);
  const totalSpectatorPool = betTotals.fighter1Total + betTotals.fighter2Total;
  
  // House cut is calculated later based on what's actually being redistributed
  let houseCut = 0;

  // Payout fighters
  if (isDraw) {
    // Return bets to both fighters
    await addMoney(fight.guildId, fight.challenger.id, fight.betAmount, 'Fight draw - bet returned');
    await addMoney(fight.guildId, fight.opponent.id, fight.betAmount, 'Fight draw - bet returned');
  } else {
    // Winner gets both bets
    await addMoney(fight.guildId, winnerId, totalPot, 'Fight winnings');
  }

  // Payout spectators
  let spectatorPayoutInfo = [];
  if (totalSpectatorPool > 0) {
    
    if (isDraw) {
      // House takes cut from entire pool on draws
      houseCut = Math.floor(totalSpectatorPool * (settings.houseCutPercent / 100));
      
      // Return bets minus house cut proportionally
      for (const bet of fight.spectatorBets) {
        const refund = Math.floor(bet.amount * (1 - settings.houseCutPercent / 100));
        await addMoney(fight.guildId, bet.oddsMinFights, refund, 'Fight draw - spectator bet returned');
        spectatorPayoutInfo.push({ oddsMinFights: bet.oddsMinFights, payout: refund, type: 'refund' });
      }
    } else {
      // Sportsbook model: House takes losing bets, pays winners based on odds minus house cut
      const winningFighterId = winnerId;
      const losingFighterId = loserId;
      
      // Get bets for each side
      const winningBets = fight.spectatorBets.filter(b => b.oddsMinFightsIdx === winningFighterId);
      const losingBets = fight.spectatorBets.filter(b => b.oddsMinFightsIdx === losingFighterId);
      
      const totalLosingBets = losingBets.reduce((sum, b) => sum + b.amount, 0);
      
      // Get odds for the winning fighter
      const winnerOdds = winnerId === fight.challenger.id ? odds.fighter1Odds : odds.fighter2Odds;
      
      // Calculate total house payout to winners
      let totalWinnerPayout = 0;
      for (const bet of winningBets) {
        // Winnings = bet amount × odds multiplier, then house takes cut from winnings
        const grossWinnings = Math.floor(bet.amount * winnerOdds);
        const winningsAfterHouse = Math.floor(grossWinnings * (1 - settings.houseCutPercent / 100));
        const totalPayout = bet.amount + winningsAfterHouse;
        totalWinnerPayout += winningsAfterHouse;
        
        await addMoney(fight.guildId, bet.oddsMinFights, totalPayout, 'Fight spectator bet winnings');
        spectatorPayoutInfo.push({ oddsMinFights: bet.oddsMinFights, payout: totalPayout, type: 'win' });
      }
      
      // House cut = what house took from winnings
      houseCut = Math.floor(totalWinnerPayout * settings.houseCutPercent / (100 - settings.houseCutPercent));

      // Losers get nothing
      for (const bet of losingBets) {
        spectatorPayoutInfo.push({ oddsMinFights: bet.oddsMinFights, payout: 0, type: 'loss' });
      }
    }
  }

  // Record fight in history
  recordFight(fight.guildId, fight.challenger.id, fight.opponent.id);
  recordFightHistory(
    fight.guildId,
    fight.challenger.id,
    fight.opponent.id,
    winnerId,
    loserId,
    endReason,
    fight.fighter1HP,
    fight.fighter2HP,
    fight.round,
    fight.betAmount,
    totalSpectatorPool,
    houseCut
  );

  // Update fighter stats
  updateFighterStats(fight.guildId, settings.oddsMinFights, winnerId, loserId, endReason, fight.betAmount, isDraw, fight.challenger.id, fight.opponent.id);

  // Build final embed
  const winnerObj = winnerId === fight.challenger.id ? fight.challenger : fight.opponent;
  const loserObj = loserId === fight.challenger.id ? fight.challenger : fight.opponent;

  // Determine how the fight ended
  let endReasonText;
  switch (endReason) {
    case 'knockout':
      endReasonText = `💥 **KNOCKOUT!** ${loserObj.displayName}'s health reached 0%`;
      break;
    case 'tko':
      endReasonText = `🛑 **TKO!** ${loserObj.displayName} failed to respond for 3 consecutive rounds`;
      break;
    case 'decision':
      endReasonText = `📋 **JUDGES DECISION** after ${fight.round} rounds\n${fight.challenger.displayName}: ${fight.fighter1HP}% HP | ${fight.opponent.displayName}: ${fight.fighter2HP}% HP`;
      break;
    case 'draw_afk':
      endReasonText = `⏱️ **DOUBLE NO-SHOW** - Both fighters failed to respond`;
      break;
    case 'draw_decision':
      endReasonText = `📋 **SPLIT DECISION** after ${fight.round} rounds - HP tied at ${fight.fighter1HP}%`;
      break;
    default:
      endReasonText = `Fight concluded after ${fight.round} rounds`;
  }

  const finalEmbed = new EmbedBuilder()
    .setColor(isDraw ? 0xFFD700 : 0x00FF00)
    .setTitle(isDraw ? '🤝 FIGHT ENDED IN A DRAW!' : '🏆 FIGHT OVER!')
    .setDescription(isDraw 
      ? `${endReasonText}\n\nBoth fighters take home their original wager.`
      : `**${winnerObj.displayName}** defeats **${loserObj.displayName}**!\n\n${endReasonText}`)
    .addFields(
      { 
        name: '💰 Fighter Payout', 
        value: isDraw 
          ? `Both: **${fight.betAmount.toLocaleString()}** ${CURRENCY} returned`
          : `${winnerObj.displayName}: **+${totalPot.toLocaleString()}** ${CURRENCY}`, 
        inline: false 
      }
    );

  if (!isDraw) {
    finalEmbed.setThumbnail(winnerObj.avatarURL);
  }

  if (totalSpectatorPool > 0) {
    let spectatorSummary = `Total Pool: **${totalSpectatorPool.toLocaleString()}** ${CURRENCY}\nHouse Cut: **${houseCut.toLocaleString()}** ${CURRENCY}`;
    
    const winners = spectatorPayoutInfo.filter(p => p.type === 'win' && p.payout > 0);
    if (winners.length > 0) {
      spectatorSummary += `\n\n**Winners:**`;
      for (const w of winners.slice(0, 5)) {
        spectatorSummary += `\n<@${w.oddsMinFights}>: **+${w.payout.toLocaleString()}** ${CURRENCY}`;
      }
      if (winners.length > 5) {
        spectatorSummary += `\n...and ${winners.length - 5} more`;
      }
    }

    finalEmbed.addFields({ name: '🎰 Spectator Bets', value: spectatorSummary, inline: false });
  }

  // Send final embed
  try {
    if (fight.publicMessageId) {
      const oldMsg = await channel.messages.fetch(fight.publicMessageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    }
  } catch {}

  await channel.send({ embeds: [finalEmbed] });

  // Cleanup
  clearSpectatorBets(fight.guildId, fight.id);
  deleteFight(fight.id);
  saveDatabase();
}
