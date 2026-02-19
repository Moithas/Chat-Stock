const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addMoney } = require('../economy');
const {
  getDungeonSettings,
  canRunDungeon,
  recordDungeonCooldown,
  recordDungeonRun,
  getDungeonStats,
  generateEnemy,
  getEnemyMove,
  resolveRound,
  calculateFloorReward,
  calculateTotalReward,
  createHealthBar,
  getActiveRun,
  setActiveRun,
  clearActiveRun,
  isInDungeon,
  FLOOR_INTROS
} = require('../dungeon');

const CURRENCY = '<:babybel:1418824333664452608>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dungeon')
    .setDescription('Enter the dungeon and fight NPC enemies for rewards!'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getDungeonSettings(guildId);

    // Check if dungeon is enabled
    if (!settings.enabled) {
      return interaction.reply({ content: '❌ The dungeon is currently closed.', ephemeral: true });
    }

    // Check if user is already in a dungeon
    if (isInDungeon(guildId, userId)) {
      return interaction.reply({ content: '❌ You\'re already in a dungeon run! Finish your current run first.', ephemeral: true });
    }

    // Check cooldown
    const cooldownCheck = canRunDungeon(guildId, userId);
    if (!cooldownCheck.canRun) {
      return interaction.reply({ content: `❌ ${cooldownCheck.reason}`, ephemeral: true });
    }

    // Start cooldown immediately
    recordDungeonCooldown(guildId, userId);

    // Initialize run state
    const enemy = generateEnemy(1, settings);
    const run = {
      floor: 1,
      playerHp: settings.playerHp,
      playerMaxHp: settings.playerHp,
      goldEarned: 0,
      enemy,
      roundLog: [],
      grappleCooldown: 0,
      enemyGrappleCooldown: 0
    };
    setActiveRun(guildId, userId, run);

    // Build intro embed
    const introEmbed = buildFloorEmbed(interaction.user, run, settings);

    const moveRow = buildMoveButtons(userId, run.grappleCooldown);
    const escapeRow = buildEscapeButton(userId);

    await interaction.reply({
      embeds: [introEmbed],
      components: [moveRow, escapeRow]
    });

    const message = await interaction.fetchReply();

    // Set up the button collector
    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === userId,
      time: settings.roundTimeSeconds * 1000 * 60 // generous overall timeout (per-floor * generous multiplier)
    });

    let roundTimer = null;
    let roundExpired = false;

    // Start round timer
    function startRoundTimer() {
      roundExpired = false;
      if (roundTimer) clearTimeout(roundTimer);
      roundTimer = setTimeout(async () => {
        roundExpired = true;
        // Player took too long — treat as a death
        const currentRun = getActiveRun(guildId, userId);
        if (!currentRun) return;

        const penaltyPercent = settings.deathPenaltyPercent / 100;
        const goldEarned = Math.floor(currentRun.goldEarned * (1 - penaltyPercent));
        
        if (goldEarned > 0) {
          await addMoney(guildId, userId, goldEarned, 'Dungeon run (timed out)');
        }

        recordDungeonRun(guildId, userId, currentRun.floor - 1, settings.maxFloors, goldEarned, 'died');
        clearActiveRun(guildId, userId);
        collector.stop('timeout');

        const timeoutEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('💀 YOU HESITATED TOO LONG!')
          .setDescription(`You froze up and ${currentRun.enemy.emoji} **${currentRun.enemy.name}** took you down!`)
          .addFields(
            { name: '🏰 Floor Reached', value: `${currentRun.floor} / ${settings.maxFloors}`, inline: true },
            { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${CURRENCY} (−${settings.deathPenaltyPercent}% penalty)`, inline: true }
          )
          .setTimestamp();

        try {
          await message.edit({ embeds: [timeoutEmbed], components: [] });
        } catch {}
      }, settings.roundTimeSeconds * 1000);
    }

    startRoundTimer();

    collector.on('collect', async (buttonInteraction) => {
      if (roundExpired) return;

      const currentRun = getActiveRun(guildId, userId);
      if (!currentRun) {
        await buttonInteraction.deferUpdate();
        collector.stop('ended');
        return;
      }

      const customId = buttonInteraction.customId;

      // ==================== ESCAPE ====================
      if (customId === `dungeon_escape_${userId}`) {
        if (roundTimer) clearTimeout(roundTimer);
        await buttonInteraction.deferUpdate();

        const goldEarned = currentRun.goldEarned;
        if (goldEarned > 0) {
          await addMoney(guildId, userId, goldEarned, 'Dungeon run (escaped)');
        }

        const floorsCleared = currentRun.floor - 1;
        recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'escaped');
        clearActiveRun(guildId, userId);
        collector.stop('escaped');

        const stats = getDungeonStats(guildId, userId);

        const escapeEmbed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle('🏃 ESCAPED THE DUNGEON!')
          .setDescription(`You retreated before facing ${currentRun.enemy.emoji} **${currentRun.enemy.name}** on Floor ${currentRun.floor}.`)
          .addFields(
            { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
            { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
            { name: '❤️ HP Remaining', value: `${currentRun.playerHp}%`, inline: true },
            { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths}`, inline: false }
          )
          .setTimestamp();

        try { await message.edit({ embeds: [escapeEmbed], components: [] }); } catch {}
        return;
      }

      // ==================== CONTINUE TO NEXT FLOOR ====================
      if (customId === `dungeon_continue_${userId}`) {
        await buttonInteraction.deferUpdate();

        // Generate new enemy for next floor
        currentRun.floor++;
        currentRun.enemy = generateEnemy(currentRun.floor, settings);
        currentRun.roundLog = [];
        currentRun.enemyGrappleCooldown = 0;

        setActiveRun(guildId, userId, currentRun);
        startRoundTimer();

        const floorEmbed = buildFloorEmbed(interaction.user, currentRun, settings);
        const newMoveRow = buildMoveButtons(userId, currentRun.grappleCooldown);
        const newEscapeRow = buildEscapeButton(userId);

        try { await message.edit({ embeds: [floorEmbed], components: [newMoveRow, newEscapeRow] }); } catch {}
        return;
      }

      // ==================== CASH OUT (after clearing final floor) ====================
      if (customId === `dungeon_cashout_${userId}`) {
        if (roundTimer) clearTimeout(roundTimer);
        await buttonInteraction.deferUpdate();
        // Already handled in the clear logic — this button is just for acknowledgment
        collector.stop('cleared');
        return;
      }

      // ==================== MOVE SELECTION ====================
      const moveMatch = customId.match(/^dungeon_move_(.+?)_(.+)$/);
      if (!moveMatch || moveMatch[2] !== userId) return;

      const playerMove = moveMatch[1];
      
      // Validate grapple cooldown
      if (playerMove === 'grapple' && currentRun.grappleCooldown > 0) {
        await buttonInteraction.reply({ content: `❌ Grapple is on cooldown for ${currentRun.grappleCooldown} more round(s)!`, ephemeral: true });
        return;
      }

      if (roundTimer) clearTimeout(roundTimer);
      await buttonInteraction.deferUpdate();

      // Get enemy move
      const enemyMove = getEnemyMove(currentRun.enemy, currentRun.enemyGrappleCooldown);

      // Resolve combat
      const result = resolveRound(playerMove, enemyMove);

      // Apply damage and healing
      currentRun.playerHp = Math.min(currentRun.playerMaxHp, currentRun.playerHp - result.playerDamage + result.playerHeal);
      currentRun.enemy.hp = Math.min(currentRun.enemy.maxHp, currentRun.enemy.hp - result.enemyDamage + result.enemyHeal);

      // Clamp to 0
      if (currentRun.playerHp < 0) currentRun.playerHp = 0;
      if (currentRun.enemy.hp < 0) currentRun.enemy.hp = 0;

      // Update grapple cooldowns
      if (playerMove === 'grapple') {
        currentRun.grappleCooldown = 3;
      } else if (currentRun.grappleCooldown > 0) {
        currentRun.grappleCooldown--;
      }
      if (enemyMove === 'grapple') {
        currentRun.enemyGrappleCooldown = 3;
      } else if (currentRun.enemyGrappleCooldown > 0) {
        currentRun.enemyGrappleCooldown--;
      }

      // Log the round
      currentRun.roundLog.push({
        playerMove,
        enemyMove,
        description: result.description
      });

      // ==================== PLAYER DIED ====================
      if (currentRun.playerHp <= 0) {
        const penaltyPercent = settings.deathPenaltyPercent / 100;
        const goldEarned = Math.floor(currentRun.goldEarned * (1 - penaltyPercent));

        if (goldEarned > 0) {
          await addMoney(guildId, userId, goldEarned, 'Dungeon run (died)');
        }

        const floorsCleared = currentRun.floor - 1;
        recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'died');
        clearActiveRun(guildId, userId);
        collector.stop('died');

        const stats = getDungeonStats(guildId, userId);

        const deathEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('💀 YOU DIED!')
          .setDescription(`${currentRun.enemy.emoji} **${currentRun.enemy.name}** defeated you on Floor ${currentRun.floor}!`)
          .addFields(
            { name: '⚔️ Last Round', value: result.description, inline: false },
            { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
            { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${CURRENCY} (−${settings.deathPenaltyPercent}% penalty)`, inline: true },
            { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths}`, inline: false }
          )
          .setTimestamp();

        try { await message.edit({ embeds: [deathEmbed], components: [] }); } catch {}
        return;
      }

      // ==================== ENEMY DIED ====================
      if (currentRun.enemy.hp <= 0) {
        const floorReward = calculateFloorReward(currentRun.floor, settings);
        currentRun.goldEarned += floorReward;

        // Check if dungeon is cleared
        if (currentRun.floor >= settings.maxFloors) {
          // FULL CLEAR!
          const goldEarned = currentRun.goldEarned;
          await addMoney(guildId, userId, goldEarned, 'Dungeon run (cleared!)');

          recordDungeonRun(guildId, userId, currentRun.floor, settings.maxFloors, goldEarned, 'cleared');
          clearActiveRun(guildId, userId);
          collector.stop('cleared');

          const stats = getDungeonStats(guildId, userId);

          const clearEmbed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🏆 DUNGEON CLEARED!')
            .setDescription(`You defeated ${currentRun.enemy.emoji} **${currentRun.enemy.name}** and conquered all ${settings.maxFloors} floors!`)
            .addFields(
              { name: '⚔️ Final Round', value: result.description, inline: false },
              { name: '🏰 Floors Cleared', value: `${currentRun.floor} / ${settings.maxFloors}`, inline: true },
              { name: '💰 Total Gold', value: `${goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
              { name: '❤️ HP Remaining', value: `${currentRun.playerHp}%`, inline: true },
              { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths} | Total Gold: ${stats.totalGoldEarned.toLocaleString()}`, inline: false }
            )
            .setTimestamp();

          try { await message.edit({ embeds: [clearEmbed], components: [] }); } catch {}
          return;
        }

        // Floor cleared but more to go — heal and show results
        const healAmount = Math.floor(currentRun.playerMaxHp * (settings.floorHealPercent / 100));
        const hpBefore = currentRun.playerHp;
        currentRun.playerHp = Math.min(currentRun.playerMaxHp, currentRun.playerHp + healAmount);
        const actualHeal = currentRun.playerHp - hpBefore;

        setActiveRun(guildId, userId, currentRun);
        startRoundTimer(); // Timer for the decision

        const nextEnemy = generateEnemy(currentRun.floor + 1, settings);
        const nextFloorReward = calculateFloorReward(currentRun.floor + 1, settings);

        const victoryEmbed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`⚔️ FLOOR ${currentRun.floor} CLEARED!`)
          .setDescription(`You defeated ${currentRun.enemy.emoji} **${currentRun.enemy.name}**!\n\n${result.description}`)
          .addFields(
            { name: '💰 Floor Reward', value: `+${floorReward.toLocaleString()} ${CURRENCY}`, inline: true },
            { name: '💰 Total Earned', value: `${currentRun.goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
            { name: '❤️ Your HP', value: `${createHealthBar(currentRun.playerHp, currentRun.playerMaxHp)} ${currentRun.playerHp}%${actualHeal > 0 ? ` (+${actualHeal}% healed)` : ' (full HP!)'}`, inline: false },
            { name: `⬇️ Floor ${currentRun.floor + 1} Preview`, value: `${nextEnemy.emoji} **${nextEnemy.name}** — ${nextEnemy.maxHp}% HP\n💰 Reward: ${nextFloorReward.toLocaleString()} ${CURRENCY}`, inline: false }
          )
          .setFooter({ text: `Continue deeper or escape with your gold? (${settings.roundTimeSeconds}s to decide)` })
          .setTimestamp();

        const decisionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dungeon_continue_${userId}`)
            .setLabel(`⬇️ Floor ${currentRun.floor + 1}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`dungeon_escape_${userId}`)
            .setLabel(`🏃 Escape (${currentRun.goldEarned.toLocaleString()})`)
            .setStyle(ButtonStyle.Success)
        );

        try { await message.edit({ embeds: [victoryEmbed], components: [decisionRow] }); } catch {}
        return;
      }

      // ==================== COMBAT CONTINUES ====================
      setActiveRun(guildId, userId, currentRun);
      startRoundTimer();

      const combatEmbed = buildCombatEmbed(interaction.user, currentRun, settings, result.description);
      const newMoveRow = buildMoveButtons(userId, currentRun.grappleCooldown);
      const newEscapeRow = buildEscapeButton(userId);

      try { await message.edit({ embeds: [combatEmbed], components: [newMoveRow, newEscapeRow] }); } catch {}
    });

    collector.on('end', async (collected, reason) => {
      if (roundTimer) clearTimeout(roundTimer);
      // Clean up if still in dungeon (safety net)
      const leftoverRun = getActiveRun(guildId, userId);
      if (leftoverRun && reason !== 'timeout') {
        clearActiveRun(guildId, userId);
      }
    });
  }
};

// ==================== EMBED BUILDERS ====================

function buildFloorEmbed(user, run, settings) {
  const floorIntro = FLOOR_INTROS[Math.min(run.floor - 1, FLOOR_INTROS.length - 1)];
  const floorReward = calculateFloorReward(run.floor, settings);

  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🏰 DUNGEON — Floor ${run.floor} / ${settings.maxFloors}`)
    .setDescription(`${floorIntro}\n\n${run.enemy.emoji} **${run.enemy.name}** appears!`)
    .addFields(
      { name: '❤️ Your HP', value: `${createHealthBar(run.playerHp, run.playerMaxHp)} ${run.playerHp}%`, inline: true },
      { name: `${run.enemy.emoji} Enemy HP`, value: `${createHealthBar(run.enemy.hp, run.enemy.maxHp)} ${run.enemy.hp}%`, inline: true },
      { name: '💰 Gold Earned', value: `${run.goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '💰 Floor Reward', value: `${floorReward.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '📋 Moves', value: '⚔️ Slash > 🛡️ Tackle > 🪤 Subdue > ⚔️ Slash\n💚 Heal restores HP but enemy attacks freely', inline: false }
    )
    .setFooter({ text: `Choose your move! (${settings.roundTimeSeconds}s per round)` })
    .setTimestamp();
}

function buildCombatEmbed(user, run, settings, lastRoundText) {
  const floorReward = calculateFloorReward(run.floor, settings);

  // Show last 3 rounds of log
  const recentLog = run.roundLog.slice(-3).map((r, i) => {
    const roundNum = run.roundLog.length - (run.roundLog.slice(-3).length - 1 - i);
    return `**R${roundNum}:** ${r.description}`;
  }).join('\n');

  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🏰 DUNGEON — Floor ${run.floor} / ${settings.maxFloors}`)
    .setDescription(`Fighting ${run.enemy.emoji} **${run.enemy.name}**`)
    .addFields(
      { name: '❤️ Your HP', value: `${createHealthBar(run.playerHp, run.playerMaxHp)} ${run.playerHp}%`, inline: true },
      { name: `${run.enemy.emoji} Enemy HP`, value: `${createHealthBar(run.enemy.hp, run.enemy.maxHp)} ${run.enemy.hp}%`, inline: true },
      { name: '💰 Gold Earned', value: `${run.goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '📜 Combat Log', value: recentLog || 'No actions yet', inline: false }
    )
    .setFooter({ text: `Choose your move! (${settings.roundTimeSeconds}s per round)` })
    .setTimestamp();
}

function buildMoveButtons(userId, grappleCooldown) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dungeon_move_strike_${userId}`)
      .setLabel('Slash')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⚔️'),
    new ButtonBuilder()
      .setCustomId(`dungeon_move_takedown_${userId}`)
      .setLabel('Tackle')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🛡️'),
    new ButtonBuilder()
      .setCustomId(`dungeon_move_choke_${userId}`)
      .setLabel('Subdue')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🪤'),
    new ButtonBuilder()
      .setCustomId(`dungeon_move_grapple_${userId}`)
      .setLabel(grappleCooldown > 0 ? `Heal (${grappleCooldown}cd)` : 'Heal')
      .setStyle(ButtonStyle.Success)
      .setEmoji('💚')
      .setDisabled(grappleCooldown > 0)
  );
}

function buildEscapeButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dungeon_escape_${userId}`)
      .setLabel('🏃 Escape')
      .setStyle(ButtonStyle.Secondary)
  );
}
