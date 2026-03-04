const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
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

// Monster name → image file base name mapping
const MONSTER_IMAGE_MAP = {
  'Script Kiddie': 'ScriptKiddie',
  'Rogue Bot': 'RogueBot',
  'Corrupt Firewall': 'CorruptFirewall',
  'Data Wraith': 'DataWraith',
  'Malware Golem': 'MalwareGolem',
  'Phishing Phantom': 'PhishingPhantom',
  'Ransomware Demon': 'RansomwareDemon',
  'Trojan Sentinel': 'TrojanSentinel',
  'Zero-Day Specter': 'Zero-DaySpecter',
  'DDoS Swarm': 'DDosSwarm',
  'Cryptojacker': 'Cryptojacker',
  'Worm Cluster': 'WormCluster',
  'Rootkit Shade': 'RootkitShade',
  'Keylogger Stalker': 'KeyloggerStalker',
  'Botnet Overlord': 'BotnetOverlord'
};

function getMonsterAttachment(enemyName, defeated = false, scale = 1.0) {
  const baseName = MONSTER_IMAGE_MAP[enemyName];
  if (!baseName) return null;
  
  const fileName = defeated ? `${baseName} Defeat.png` : `${baseName}.png`;
  const filePath = path.join(__dirname, '..', 'assets', 'Dungeon', fileName);
  
  if (!fs.existsSync(filePath)) return null;
  
  if (scale < 1.0) {
    // Return a promise-based attachment for scaled images
    return { filePath, scale, isScaled: true };
  }
  
  return new AttachmentBuilder(filePath, { name: 'monster.png' });
}

async function getScaledMonsterAttachment(enemyName, defeated = false, scale = 0.8) {
  const baseName = MONSTER_IMAGE_MAP[enemyName];
  if (!baseName) return null;
  
  const fileName = defeated ? `${baseName} Defeat.png` : `${baseName}.png`;
  const filePath = path.join(__dirname, '..', 'assets', 'Dungeon', fileName);
  
  if (!fs.existsSync(filePath)) return null;
  
  try {
    const img = await loadImage(filePath);
    const newWidth = Math.floor(img.width * scale);
    const newHeight = Math.floor(img.height * scale);
    const canvas = createCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, newWidth, newHeight);
    return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'monster.png' });
  } catch (e) {
    console.error('Error scaling monster image:', e.message);
    return new AttachmentBuilder(filePath, { name: 'monster.png' });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dungeon')
    .setDescription('Enter the dungeon and fight NPC enemies for rewards!'),

  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = getDungeonSettings(guildId);

    // Check if dungeon is enabled
    if (!settings.enabled) {
      return interaction.editReply({ content: '❌ The dungeon is currently closed.' });
    }

    // Check if user is already in a dungeon
    if (isInDungeon(guildId, userId)) {
      return interaction.editReply({ content: '❌ You\'re already in a dungeon run! Finish your current run first.' });
    }

    // Check cooldown
    const cooldownCheck = canRunDungeon(guildId, userId);
    if (!cooldownCheck.canRun) {
      return interaction.editReply({ content: `❌ ${cooldownCheck.reason}` });
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
      restoreCooldown: 0,
      enemyRestoreCooldown: 0
    };
    setActiveRun(guildId, userId, run);

    // Build intro embed
    const introEmbed = buildFloorEmbed(interaction.user, run, settings);
    const monsterAttach = await getScaledMonsterAttachment(run.enemy.name);

    const moveRow = buildMoveButtons(userId, run.restoreCooldown);
    const restoreEscapeRow = buildRestoreEscapeRow(userId, run.restoreCooldown);

    await interaction.editReply({
      embeds: [introEmbed],
      components: [moveRow, restoreEscapeRow],
      files: monsterAttach ? [monsterAttach] : []
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
        const currentRun = getActiveRun(guildId, userId);
        if (!currentRun) return;

        // If the enemy is already dead, this timeout fired on the continue/escape decision screen
        // Treat as an escape — player keeps full gold, no penalty
        if (currentRun.enemy.hp <= 0) {
          const goldEarned = currentRun.goldEarned;
          if (goldEarned > 0) {
            await addMoney(guildId, userId, goldEarned, 'Dungeon run (decision timeout)');
          }

          const floorsCleared = currentRun.floor;
          recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'escaped');
          clearActiveRun(guildId, userId);
          collector.stop('timeout');

          const stats = getDungeonStats(guildId, userId);

          const timeoutEmbed = new EmbedBuilder()
            .setColor(0xf39c12)
            .setTitle('⏱️ TIME\'S UP — AUTO ESCAPE')
            .setDescription(`You took too long to decide and automatically escaped the dungeon with your earnings.`)
            .addFields(
              { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
              { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
              { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths}`, inline: false }
            )
            .setTimestamp();

          try { await message.edit({ embeds: [timeoutEmbed], components: [] }); } catch {}
          return;
        }

        // Player took too long mid-combat — treat as a death
        const penaltyPercent = settings.deathPenaltyPercent / 100;
        const goldEarned = Math.floor(currentRun.goldEarned * (1 - penaltyPercent));
        
        if (goldEarned > 0) {
          await addMoney(guildId, userId, goldEarned, 'Dungeon run (timed out)');
        }

        recordDungeonRun(guildId, userId, currentRun.floor - 1, settings.maxFloors, goldEarned, 'died');
        clearActiveRun(guildId, userId);
        collector.stop('timeout');

        const timeoutAttach = getMonsterAttachment(currentRun.enemy.name);
        const timeoutEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('💀 YOU HESITATED TOO LONG!')
          .setDescription(`You froze up and ${currentRun.enemy.emoji} **${currentRun.enemy.name}** took you down!`)
          .addFields(
            { name: '🏰 Floor Reached', value: `${currentRun.floor} / ${settings.maxFloors}`, inline: true },
            { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${CURRENCY} (−${settings.deathPenaltyPercent}% penalty)`, inline: true }
          )
          .setTimestamp();
        if (timeoutAttach) timeoutEmbed.setImage('attachment://monster.png');

        try {
          await message.edit({ embeds: [timeoutEmbed], components: [], attachments: [], files: timeoutAttach ? [timeoutAttach] : [] });
        } catch {}
      }, settings.roundTimeSeconds * 1000);
    }

    startRoundTimer();

    collector.on('collect', async (buttonInteraction) => {
      if (roundExpired) return;

      const currentRun = getActiveRun(guildId, userId);
      if (!currentRun) {
        try { await buttonInteraction.deferUpdate(); } catch {}
        collector.stop('ended');
        return;
      }

      const customId = buttonInteraction.customId;

      // ==================== ESCAPE ====================
      if (customId === `dungeon_escape_${userId}`) {
        if (roundTimer) clearTimeout(roundTimer);
        try { await buttonInteraction.deferUpdate(); } catch {}

        const goldEarned = currentRun.goldEarned;
        if (goldEarned > 0) {
          await addMoney(guildId, userId, goldEarned, 'Dungeon run (escaped)');
        }

        const floorsCleared = currentRun.floor;
        recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'escaped');
        clearActiveRun(guildId, userId);
        collector.stop('escaped');

        const stats = getDungeonStats(guildId, userId);

        const escapeAttach = getMonsterAttachment(currentRun.enemy.name);
        const escapeEmbed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle('🏃 ESCAPED THE DUNGEON!')
          .setDescription(`You escaped after clearing Floor ${currentRun.floor}!`)
          .addFields(
            { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
            { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
            { name: '❤️ HP Remaining', value: `${currentRun.playerHp}%`, inline: true },
            { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths}`, inline: false }
          )
          .setTimestamp();
        if (escapeAttach) escapeEmbed.setImage('attachment://monster.png');

        try { await message.edit({ embeds: [escapeEmbed], components: [], attachments: [], files: escapeAttach ? [escapeAttach] : [] }); } catch {}
        return;
      }

      // ==================== CONTINUE TO NEXT FLOOR ====================
      if (customId === `dungeon_continue_${userId}`) {
        try { await buttonInteraction.deferUpdate(); } catch {}

        // Use the previewed enemy if available, otherwise generate fresh
        currentRun.floor++;
        currentRun.enemy = currentRun.nextEnemy || generateEnemy(currentRun.floor, settings);
        currentRun.nextEnemy = null;
        currentRun.roundLog = [];
        currentRun.enemyRestoreCooldown = 0;

        setActiveRun(guildId, userId, currentRun);
        startRoundTimer();

        const floorEmbed = buildFloorEmbed(interaction.user, currentRun, settings);
        const newFloorAttach = await getScaledMonsterAttachment(currentRun.enemy.name);
        const newMoveRow = buildMoveButtons(userId, currentRun.restoreCooldown);
        const newRestoreEscapeRow = buildRestoreEscapeRow(userId, currentRun.restoreCooldown);

        try { await message.edit({ embeds: [floorEmbed], components: [newMoveRow, newRestoreEscapeRow], attachments: [], files: newFloorAttach ? [newFloorAttach] : [] }); } catch {}
        return;
      }

      // ==================== CASH OUT (after clearing final floor) ====================
      if (customId === `dungeon_cashout_${userId}`) {
        if (roundTimer) clearTimeout(roundTimer);
        try { await buttonInteraction.deferUpdate(); } catch {}
        // Already handled in the clear logic — this button is just for acknowledgment
        collector.stop('cleared');
        return;
      }

      // ==================== MOVE SELECTION ====================
      const moveMatch = customId.match(/^dungeon_move_(.+?)_(.+)$/);
      if (!moveMatch || moveMatch[2] !== userId) return;

      const playerMove = moveMatch[1];
      
      // Validate restore cooldown
      if (playerMove === 'restore' && currentRun.restoreCooldown > 0) {
        await buttonInteraction.reply({ content: `❌ Restore is on cooldown for ${currentRun.restoreCooldown} more round(s)!`, ephemeral: true });
        return;
      }

      if (roundTimer) clearTimeout(roundTimer);
      try { await buttonInteraction.deferUpdate(); } catch {}

      // Get enemy move
      const enemyMove = getEnemyMove(currentRun.enemy, currentRun.enemyRestoreCooldown);

      // Resolve combat
      const result = resolveRound(playerMove, enemyMove);

      // Apply damage and healing
      currentRun.playerHp = Math.min(currentRun.playerMaxHp, currentRun.playerHp - result.playerDamage + result.playerHeal);
      currentRun.enemy.hp = Math.min(currentRun.enemy.maxHp, currentRun.enemy.hp - result.enemyDamage + result.enemyHeal);

      // Clamp to 0
      if (currentRun.playerHp < 0) currentRun.playerHp = 0;
      if (currentRun.enemy.hp < 0) currentRun.enemy.hp = 0;

      // Update restore cooldowns
      if (playerMove === 'restore') {
        currentRun.restoreCooldown = 3;
      } else if (currentRun.restoreCooldown > 0) {
        currentRun.restoreCooldown--;
      }
      if (enemyMove === 'restore') {
        currentRun.enemyRestoreCooldown = 3;
      } else if (currentRun.enemyRestoreCooldown > 0) {
        currentRun.enemyRestoreCooldown--;
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

        const deathAttach = getMonsterAttachment(currentRun.enemy.name);
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
        if (deathAttach) deathEmbed.setImage('attachment://monster.png');

        try { await message.edit({ embeds: [deathEmbed], components: [], attachments: [], files: deathAttach ? [deathAttach] : [] }); } catch {}
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

          const clearAttach = getMonsterAttachment(currentRun.enemy.name, true);
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
          if (clearAttach) clearEmbed.setImage('attachment://monster.png');

          try { await message.edit({ embeds: [clearEmbed], components: [], attachments: [], files: clearAttach ? [clearAttach] : [] }); } catch {}
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
        currentRun.nextEnemy = nextEnemy; // Store so continue uses the same enemy
        const nextFloorReward = calculateFloorReward(currentRun.floor + 1, settings);

        const victoryAttach = getMonsterAttachment(currentRun.enemy.name, true);
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
        if (victoryAttach) victoryEmbed.setImage('attachment://monster.png');

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

        try { await message.edit({ embeds: [victoryEmbed], components: [decisionRow], attachments: [], files: victoryAttach ? [victoryAttach] : [] }); } catch {}
        return;
      }

      // ==================== COMBAT CONTINUES ====================
      setActiveRun(guildId, userId, currentRun);
      startRoundTimer();

      const combatEmbed = buildCombatEmbed(interaction.user, currentRun, settings, result.description);
      const combatAttach = await getScaledMonsterAttachment(currentRun.enemy.name);
      const newMoveRow = buildMoveButtons(userId, currentRun.restoreCooldown);
      const newRestoreEscapeRow = buildRestoreEscapeRow(userId, currentRun.restoreCooldown);

      try { await message.edit({ embeds: [combatEmbed], components: [newMoveRow, newRestoreEscapeRow], attachments: [], files: combatAttach ? [combatAttach] : [] }); } catch {}
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
    .setImage('attachment://monster.png')
    .addFields(
      { name: '❤️ Your HP', value: `${createHealthBar(run.playerHp, run.playerMaxHp)} ${run.playerHp}%`, inline: true },
      { name: `${run.enemy.emoji} Enemy HP`, value: `${createHealthBar(run.enemy.hp, run.enemy.maxHp)} ${run.enemy.hp}%`, inline: true },
      { name: '💰 Gold Earned', value: `${run.goldEarned.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '💰 Floor Reward', value: `${floorReward.toLocaleString()} ${CURRENCY}`, inline: true }
    )
    .setFooter({ text: `Choose your move! (${settings.roundTimeSeconds}s per round)` })
    .setTimestamp();
}

function buildCombatEmbed(user, run, settings, lastRoundText) {
  const floorReward = calculateFloorReward(run.floor, settings);

  // Show only the last round of log
  const lastRound = run.roundLog.length > 0 ? run.roundLog[run.roundLog.length - 1] : null;
  const recentLog = lastRound ? `**R${run.roundLog.length}:** ${lastRound.description}` : '';

  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🏰 DUNGEON — Floor ${run.floor} / ${settings.maxFloors}`)
    .setDescription(`Fighting ${run.enemy.emoji} **${run.enemy.name}**`)
    .setImage('attachment://monster.png')
    .addFields(
      { name: '❤️ Your HP', value: `${createHealthBar(run.playerHp, run.playerMaxHp)} ${run.playerHp}%`, inline: true },
      { name: `${run.enemy.emoji} Enemy HP`, value: `${createHealthBar(run.enemy.hp, run.enemy.maxHp)} ${run.enemy.hp}%`, inline: true },
      { name: ' Combat Log', value: recentLog || 'No actions yet', inline: false }
    )
    .setFooter({ text: `Choose your move! (${settings.roundTimeSeconds}s per round)` })
    .setTimestamp();
}

function buildMoveButtons(userId, restoreCooldown) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dungeon_move_spam_${userId}`)
      .setLabel('Spam')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`dungeon_move_isolate_${userId}`)
      .setLabel('Isolate')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`dungeon_move_override_${userId}`)
      .setLabel('Override')
      .setStyle(ButtonStyle.Danger)
  );
  return row1;
}

function buildRestoreEscapeRow(userId, restoreCooldown) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dungeon_move_exploit_${userId}`)
      .setLabel('Exploit')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`dungeon_move_corrupt_${userId}`)
      .setLabel('Corrupt')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`dungeon_move_restore_${userId}`)
      .setLabel(restoreCooldown > 0 ? `Restore (${restoreCooldown}cd)` : 'Restore')
      .setStyle(ButtonStyle.Success)
      .setDisabled(restoreCooldown > 0),
    new ButtonBuilder()
      .setCustomId(`dungeon_escape_${userId}`)
      .setLabel('🏃 Escape')
      .setStyle(ButtonStyle.Secondary)
  );
}
