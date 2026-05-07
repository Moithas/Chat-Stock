const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
const { addMoney } = require('../economy');
const { EFFECT_TYPES, getAllInventoryItemsByEffect, removeFromInventory } = require('../items');
const {
  getDungeonSettings,
  getFullTierSettings,
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
  BOSS_TYPES,
  FLOOR_INTROS,
  DAMAGE
} = require('../dungeon');
const { getCurrency } = require('../admin');



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
  'Botnet Overlord': 'Botnet Overlord',
  // Bosses
  'Fragmentor': 'Fragmentor',
  'Beast Forge': 'Beast Forge',
  'Chaos': 'Chaos'
};

// Tier display names and colors
const TIER_INFO = {
  1: { name: 'Tier 1', label: '🏰 Tier 1', color: 0x3498db, emoji: '🏰' },
  2: { name: 'Tier 2', label: '⚔️ Tier 2', color: 0xe67e22, emoji: '⚔️' },
  3: { name: 'Tier 3', label: '💀 Tier 3', color: 0xe74c3c, emoji: '💀' }
};

function getMonsterAttachment(enemyName, defeated = false, enraged = false, scale = 1.0) {
  const baseName = MONSTER_IMAGE_MAP[enemyName];
  if (!baseName) return null;
  
  let fileName;
  if (defeated) {
    fileName = `${baseName} Defeat.png`;
  } else if (enraged) {
    fileName = `${baseName} Enraged.png`;
  } else {
    fileName = `${baseName}.png`;
  }
  const filePath = path.join(__dirname, '..', 'assets', 'Dungeon', fileName);
  
  if (!fs.existsSync(filePath)) return null;
  
  if (scale < 1.0) {
    return { filePath, scale, isScaled: true };
  }
  
  return new AttachmentBuilder(filePath, { name: 'monster.png' });
}

async function getScaledMonsterAttachment(enemyName, defeated = false, enraged = false, scale = 0.8) {
  const baseName = MONSTER_IMAGE_MAP[enemyName];
  if (!baseName) return null;
  
  let fileName;
  if (defeated) {
    fileName = `${baseName} Defeat.png`;
  } else if (enraged) {
    fileName = `${baseName} Enraged.png`;
  } else {
    fileName = `${baseName}.png`;
  }
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
    const globalSettings = getDungeonSettings(guildId);

    // Check if dungeon is enabled
    if (!globalSettings.enabled) {
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

    // Check for Dungeon Keys in inventory (all tiers)
    const dungeonKeys = getAllInventoryItemsByEffect(guildId, userId, EFFECT_TYPES.DUNGEON_KEY);
    if (!dungeonKeys || dungeonKeys.length === 0) {
      return interaction.editReply({ 
        content: `❌ You need a **🗝️ Dungeon Key** to enter the dungeon!\n\nPurchase one from the \`/shop\`.` 
      });
    }

    // Get unique tiers available
    const availableTiers = [...new Set(dungeonKeys.map(k => k.effect_value || 1))].sort((a, b) => a - b);

    // If only one tier available, auto-select it
    if (availableTiers.length === 1) {
      const tier = availableTiers[0];
      const key = dungeonKeys.find(k => (k.effect_value || 1) === tier);
      await startDungeonRun(interaction, guildId, userId, tier, key);
      return;
    }

    // Multiple tiers — show tier selection
    const tierEmbed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🏰 CHOOSE YOUR DUNGEON')
      .setDescription('Select a dungeon tier to enter. Higher tiers are harder but more rewarding!');

    for (const tier of availableTiers) {
      const tierSettings = getFullTierSettings(guildId, tier);
      const boss = BOSS_TYPES[tier];
      const info = TIER_INFO[tier] || TIER_INFO[1];
      const key = dungeonKeys.find(k => (k.effect_value || 1) === tier);

      let totalGold = 0;
      for (let i = 1; i <= tierSettings.maxFloors; i++) {
        totalGold += tierSettings.baseReward + (i - 1) * tierSettings.rewardPerFloor;
      }

      tierEmbed.addFields({
        name: `${info.emoji} ${info.name} — ${tierSettings.maxFloors} Floors`,
        value: `👾 Boss: ${boss ? `${boss.emoji} **${boss.name}**` : 'None'}\n` +
               `💰 Full Clear: ${totalGold.toLocaleString()} ${getCurrency(guildId)}\n` +
               `❤️ Player HP: ${tierSettings.playerHp}% | 💀 Death Penalty: ${tierSettings.deathPenaltyPercent}%\n` +
               `🗝️ Key: ${key.emoji || '🗝️'} ${key.name} (x${key.quantity})`,
        inline: false
      });
    }

    const tierRow = new ActionRowBuilder();
    for (const tier of availableTiers) {
      const info = TIER_INFO[tier] || TIER_INFO[1];
      tierRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`dungeon_tier_${tier}_${userId}`)
          .setLabel(info.label)
          .setStyle(tier === 3 ? ButtonStyle.Danger : tier === 2 ? ButtonStyle.Primary : ButtonStyle.Success)
      );
    }

    await interaction.editReply({ embeds: [tierEmbed], components: [tierRow] });
    const message = await interaction.fetchReply();

    // Collect tier selection
    const tierCollector = message.createMessageComponentCollector({
      filter: i => i.user.id === userId && i.customId.startsWith('dungeon_tier_'),
      time: 30000,
      max: 1
    });

    tierCollector.on('collect', async (btn) => {
      const selectedTier = parseInt(btn.customId.split('_')[2]);
      const key = dungeonKeys.find(k => (k.effect_value || 1) === selectedTier);

      if (!key) {
        await btn.reply({ content: '❌ You no longer have a key for that tier!', ephemeral: true });
        return;
      }

      try { await btn.deferUpdate(); } catch {}
      await startDungeonRun(interaction, guildId, userId, selectedTier, key);
    });

    tierCollector.on('end', async (collected, reason) => {
      if (collected.size === 0) {
        try {
          await message.edit({
            embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle('🏰 Dungeon').setDescription('You took too long to choose. Run `/dungeon` again.')],
            components: []
          });
        } catch {}
      }
    });
  }
};

// ==================== START DUNGEON RUN ====================

async function startDungeonRun(interaction, guildId, userId, tier, key) {
  const settings = getFullTierSettings(guildId, tier);
  const tierInfo = TIER_INFO[tier] || TIER_INFO[1];

  // Double-check they're not in a dungeon (race condition prevention)
  if (isInDungeon(guildId, userId)) {
    try { await interaction.editReply({ content: '❌ You\'re already in a dungeon run!', embeds: [], components: [] }); } catch {}
    return;
  }

  // Consume the key
  removeFromInventory(guildId, userId, key.item_id, 1);

  // Start cooldown immediately
  recordDungeonCooldown(guildId, userId);

  // Initialize run state
  const enemy = generateEnemy(1, settings, tier);
  const run = {
    floor: 1,
    tier,
    playerHp: settings.playerHp,
    playerMaxHp: settings.playerHp,
    goldEarned: 0,
    enemy,
    roundLog: [],
    restoreCooldown: 0,
    enemyRestoreCooldown: 0,
    bossEnraged: false // Track whether boss enraged image should show
  };
  setActiveRun(guildId, userId, run);

  // Build intro embed
  const introEmbed = buildFloorEmbed(interaction.user, run, settings, guildId);
  const monsterAttach = await getScaledMonsterAttachment(run.enemy.name);

  const moveRow = buildMoveButtons(userId, run.restoreCooldown);
  const restoreEscapeRow = buildRestoreEscapeRow(userId, run.restoreCooldown, run.playerHp);

  await interaction.editReply({
    embeds: [introEmbed],
    components: [moveRow, restoreEscapeRow],
    files: monsterAttach ? [monsterAttach] : []
  });

  const message = await interaction.fetchReply();

  // Set up the button collector
  const collector = message.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: settings.roundTimeSeconds * 1000 * 60
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
      if (currentRun.enemy.hp <= 0) {
        const goldEarned = currentRun.goldEarned;
        if (goldEarned > 0) {
          await addMoney(guildId, userId, goldEarned, 'Dungeon run (decision timeout)');
        }

        const floorsCleared = currentRun.floor;
        recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'escaped', tier);
        clearActiveRun(guildId, userId);
        collector.stop('timeout');

        const stats = getDungeonStats(guildId, userId);

        const timeoutEmbed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle('⏱️ TIME\'S UP — AUTO ESCAPE')
          .setDescription(`You took too long to decide and automatically escaped the dungeon with your earnings.`)
          .addFields(
            { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
            { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
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

      recordDungeonRun(guildId, userId, currentRun.floor - 1, settings.maxFloors, goldEarned, 'died', tier);
      clearActiveRun(guildId, userId);
      collector.stop('timeout');

      const timeoutAttach = getMonsterAttachment(currentRun.enemy.name);
      const timeoutEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💀 YOU HESITATED TOO LONG!')
        .setDescription(`You froze up and ${currentRun.enemy.emoji} **${currentRun.enemy.name}** took you down!`)
        .addFields(
          { name: '🏰 Floor Reached', value: `${currentRun.floor} / ${settings.maxFloors}`, inline: true },
          { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${getCurrency(guildId)} (−${settings.deathPenaltyPercent}% penalty)`, inline: true }
        )
        .setTimestamp();
      if (timeoutAttach) timeoutEmbed.setImage('attachment://monster.png');

      try {
        await message.edit({ embeds: [timeoutEmbed], components: [], attachments: [], files: timeoutAttach ? [timeoutAttach] : [] });
      } catch {}
    }, settings.roundTimeSeconds * 1000);
  }

  startRoundTimer();

  // Helper: perform an escape using the current run state. Used both by the
  // direct escape button handler and by the deferred handler that fires when
  // the user clicked Escape while a previous click was still resolving (the
  // "pending escape" path — fixes escapes being silently dropped between
  // rounds while combat continues).
  async function performEscape(currentRun) {
    if (!currentRun) return;
    if (roundTimer) clearTimeout(roundTimer);

    // === BETWEEN FLOORS (enemy already dead) — free escape, no penalty ===
    if (currentRun.enemy.hp <= 0) {
      const goldEarned = currentRun.goldEarned;
      if (goldEarned > 0) {
        await addMoney(guildId, userId, goldEarned, 'Dungeon run (escaped)');
      }
      const floorsCleared = currentRun.floor;
      recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'escaped', tier);
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
          { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '❤️ HP Remaining', value: `${currentRun.playerHp}%`, inline: true },
          { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths}`, inline: false }
        )
        .setTimestamp();
      if (escapeAttach) escapeEmbed.setImage('attachment://monster.png');
      try { await message.edit({ embeds: [escapeEmbed], components: [], attachments: [], files: escapeAttach ? [escapeAttach] : [] }); } catch {}
      return;
    }

    // === DURING COMBAT — roll to escape ===
    const escapeChance = Math.min(currentRun.playerHp + 25, 99);
    const escapeRoll = Math.floor(Math.random() * 100) + 1;
    const escaped = escapeRoll <= escapeChance;

    if (escaped) {
      const penalty = Math.floor(currentRun.goldEarned * 0.25);
      const goldEarned = currentRun.goldEarned - penalty;
      if (goldEarned > 0) {
        await addMoney(guildId, userId, goldEarned, 'Dungeon run (combat escape)');
      }
      const floorsCleared = currentRun.floor - 1;
      recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'escaped', tier);
      clearActiveRun(guildId, userId);
      collector.stop('escaped');

      const stats = getDungeonStats(guildId, userId);
      const escapeAttach = getMonsterAttachment(currentRun.enemy.name);
      const escapeEmbed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('🏃 ESCAPED MID-COMBAT!')
        .setDescription(
          `You scrambled away from ${currentRun.enemy.emoji} **${currentRun.enemy.name}**!\n\n` +
          `🎲 Escape roll: **${escapeRoll}** vs **${escapeChance}%** chance — ✅ Success!\n` +
          `⚠️ **−25% gold penalty** for fleeing mid-fight`
        )
        .addFields(
          { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
          { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${getCurrency(guildId)}${penalty > 0 ? ` (−${penalty.toLocaleString()})` : ''}`, inline: true },
          { name: '❤️ HP Remaining', value: `${currentRun.playerHp}%`, inline: true },
          { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths}`, inline: false }
        )
        .setTimestamp();
      if (escapeAttach) escapeEmbed.setImage('attachment://monster.png');
      try { await message.edit({ embeds: [escapeEmbed], components: [], attachments: [], files: escapeAttach ? [escapeAttach] : [] }); } catch {}
      return;
    }

    // === FAILED ESCAPE — enemy gets a free attack ===
    const attackMoves = [
      { name: 'exploit', weight: currentRun.enemy.bias.exploit },
      { name: 'corrupt', weight: currentRun.enemy.bias.corrupt },
      { name: 'isolate', weight: currentRun.enemy.bias.isolate },
      { name: 'spam', weight: currentRun.enemy.bias.spam },
      { name: 'override', weight: currentRun.enemy.bias.override }
    ];
    const totalWeight = attackMoves.reduce((sum, m) => sum + m.weight, 0);
    let attackRoll = Math.random() * totalWeight;
    let enemyAttack = attackMoves[0].name;
    for (const m of attackMoves) {
      attackRoll -= m.weight;
      if (attackRoll <= 0) { enemyAttack = m.name; break; }
    }
    const freeHitDamage = {
      exploit: DAMAGE.EXPLOIT, corrupt: DAMAGE.CORRUPT,
      isolate: DAMAGE.ISOLATE, spam: DAMAGE.SPAM, override: DAMAGE.OVERRIDE
    };
    const freeDmg = freeHitDamage[enemyAttack] || 15;
    const freeMoveName = enemyAttack.toUpperCase();

    currentRun.playerHp -= freeDmg;
    if (currentRun.playerHp < 0) currentRun.playerHp = 0;
    currentRun.roundLog.push({
      playerMove: 'escape (failed)',
      enemyMove: enemyAttack,
      description: `🏃 Escape failed! (Roll: **${escapeRoll}** vs **${escapeChance}%** — ❌)\n${currentRun.enemy.emoji} **${freeMoveName}** hits for **${freeDmg}%** damage!`
    });

    if (currentRun.playerHp <= 0) {
      const penaltyPercent = settings.deathPenaltyPercent / 100;
      const goldEarned = Math.floor(currentRun.goldEarned * (1 - penaltyPercent));
      if (goldEarned > 0) {
        await addMoney(guildId, userId, goldEarned, 'Dungeon run (died escaping)');
      }
      const floorsCleared = currentRun.floor - 1;
      recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'died', tier);
      clearActiveRun(guildId, userId);
      collector.stop('died');

      const stats = getDungeonStats(guildId, userId);
      const deathAttach = getMonsterAttachment(currentRun.enemy.name, false, currentRun.bossEnraged);
      const deathEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💀 ESCAPE FAILED — YOU DIED!')
        .setDescription(
          `You tried to flee but ${currentRun.enemy.emoji} **${currentRun.enemy.name}** caught you!\n\n` +
          `🎲 Escape roll: **${escapeRoll}** vs **${escapeChance}%** chance — ❌ Failed!\n` +
          `${currentRun.enemy.emoji} **${freeMoveName}** hits for **${freeDmg}%** damage!`
        )
        .addFields(
          { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
          { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${getCurrency(guildId)} (−${settings.deathPenaltyPercent}% penalty)`, inline: true },
          { name: '📊 Lifetime Stats', value: `Runs: ${stats.totalRuns} | Clears: ${stats.clears} | Deaths: ${stats.deaths}`, inline: false }
        )
        .setTimestamp();
      if (deathAttach) deathEmbed.setImage('attachment://monster.png');
      try { await message.edit({ embeds: [deathEmbed], components: [], attachments: [], files: deathAttach ? [deathAttach] : [] }); } catch {}
      return;
    }

    // Player survived — back to combat
    setActiveRun(guildId, userId, currentRun);
    startRoundTimer();
    const combatEmbed = buildCombatEmbed(interaction.user, currentRun, settings);
    const isEnraged = currentRun.bossEnraged && currentRun.enemy.boss;
    const combatAttach = await getScaledMonsterAttachment(currentRun.enemy.name, false, isEnraged);
    const newMoveRow = buildMoveButtons(userId, currentRun.restoreCooldown);
    const newRestoreEscapeRow = buildRestoreEscapeRow(userId, currentRun.restoreCooldown, currentRun.playerHp);
    try { await message.edit({ embeds: [combatEmbed], components: [newMoveRow, newRestoreEscapeRow], attachments: [], files: combatAttach ? [combatAttach] : [] }); } catch {}
  }

  collector.on('collect', async (buttonInteraction) => {
    if (roundExpired) return;

    const currentRun = getActiveRun(guildId, userId);
    if (!currentRun) {
      try { await buttonInteraction.deferUpdate(); } catch {}
      collector.stop('ended');
      return;
    }

    // If a previous click is still resolving (combat resolution + DB write +
    // Discord message edit can take 100-500ms), acknowledge this click so
    // Discord doesn't show the user "interaction failed". If it was an
    // Escape click, remember it so we can honor it after the in-flight op
    // completes — otherwise users mashing Escape between rounds were having
    // their escape silently dropped while combat continued.
    if (currentRun.processing) {
      try { await buttonInteraction.deferUpdate(); } catch {}
      if (buttonInteraction.customId === `dungeon_escape_${userId}`) {
        currentRun.pendingEscape = true;
      }
      return;
    }
    currentRun.processing = true;

    try {

    const customId = buttonInteraction.customId;

    // ==================== ESCAPE ====================
    if (customId === `dungeon_escape_${userId}`) {
      try { await buttonInteraction.deferUpdate(); } catch {}
      await performEscape(currentRun);
      return;
    }

    // ==================== CONTINUE TO NEXT FLOOR ====================
    if (customId === `dungeon_continue_${userId}`) {
      try { await buttonInteraction.deferUpdate(); } catch {}

      // Guard against double-click: if enemy is already alive, a prior continue already advanced the floor
      if (currentRun.enemy.hp > 0) { currentRun.processing = false; return; }

      currentRun.floor++;
      currentRun.enemy = currentRun.nextEnemy || generateEnemy(currentRun.floor, settings, currentRun.tier);
      currentRun.nextEnemy = null;
      currentRun.roundLog = [];
      currentRun.enemyRestoreCooldown = 0;
      currentRun.bossEnraged = false;

      setActiveRun(guildId, userId, currentRun);
      startRoundTimer();

      const floorEmbed = buildFloorEmbed(interaction.user, currentRun, settings, guildId);
      const newFloorAttach = await getScaledMonsterAttachment(currentRun.enemy.name);
      const newMoveRow = buildMoveButtons(userId, currentRun.restoreCooldown);
      const newRestoreEscapeRow = buildRestoreEscapeRow(userId, currentRun.restoreCooldown, currentRun.playerHp);

      try { await message.edit({ embeds: [floorEmbed], components: [newMoveRow, newRestoreEscapeRow], attachments: [], files: newFloorAttach ? [newFloorAttach] : [] }); } catch {}
      return;
    }

    // ==================== CASH OUT (after clearing final floor) ====================
    if (customId === `dungeon_cashout_${userId}`) {
      if (roundTimer) clearTimeout(roundTimer);
      try { await buttonInteraction.deferUpdate(); } catch {}
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

    // Track player's move for adaptive bosses BEFORE getting enemy move
    if (currentRun.enemy.abilities?.adaptive) {
      // lastPlayerMove was set from the PREVIOUS round — enemy uses it now
      // After getting enemy move, we'll update it to the current player move
    }

    // Get enemy move
    const enemyMove = getEnemyMove(currentRun.enemy, currentRun.enemyRestoreCooldown);

    // Update adaptive tracking AFTER enemy has chosen (so next round uses this move)
    if (currentRun.enemy.abilities?.adaptive) {
      currentRun.enemy.lastPlayerMove = playerMove;
    }

    // Resolve combat
    const result = resolveRound(playerMove, enemyMove);

    // ==================== BOSS ABILITY MODIFIERS ====================
    let bossAbilityText = '';

    // Restore Boost: Boss heals 40% instead of 25%
    if (currentRun.enemy.abilities?.restoreBoost && enemyMove === 'restore') {
      const boostedHeal = 40;
      const healDiff = boostedHeal - DAMAGE.RESTORE_HEAL;
      result.enemyHeal += healDiff;
      bossAbilityText += '\n🔮 **Restore Boost!** ';
    }

    // Rage Mode: +25% damage when boss is below 30% HP
    const bossHpPercent = (currentRun.enemy.hp / currentRun.enemy.maxHp) * 100;
    if (currentRun.enemy.abilities?.rageMode && bossHpPercent <= 30) {
      const bonus = Math.ceil(result.playerDamage * 0.25);
      if (bonus > 0) {
        result.playerDamage += bonus;
        bossAbilityText += `\n⚒️ **Rage Mode!** (+${bonus}% bonus damage)`;
      }
    }

    // Boss enraged image — triggers when HP drops below threshold (independent of abilities)
    if (currentRun.enemy.boss && currentRun.enemy.enragedThreshold) {
      currentRun.bossEnraged = bossHpPercent <= currentRun.enemy.enragedThreshold;
    }

    // Adaptive indicator
    if (currentRun.enemy.abilities?.adaptive && currentRun.roundLog.length > 0) {
      bossAbilityText += '\n🌀 *Chaos is adapting to your patterns...*';
    }

    if (bossAbilityText) {
      result.description += bossAbilityText;
    }

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
      recordDungeonRun(guildId, userId, floorsCleared, settings.maxFloors, goldEarned, 'died', tier);
      clearActiveRun(guildId, userId);
      collector.stop('died');

      const stats = getDungeonStats(guildId, userId);

      const deathAttach = getMonsterAttachment(currentRun.enemy.name, false, currentRun.bossEnraged);
      const deathEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💀 YOU DIED!')
        .setDescription(`${currentRun.enemy.emoji} **${currentRun.enemy.name}** defeated you on Floor ${currentRun.floor}!`)
        .addFields(
          { name: '⚔️ Last Round', value: result.description, inline: false },
          { name: '🏰 Floors Cleared', value: `${floorsCleared} / ${settings.maxFloors}`, inline: true },
          { name: '💰 Gold Earned', value: `${goldEarned.toLocaleString()} ${getCurrency(guildId)} (−${settings.deathPenaltyPercent}% penalty)`, inline: true },
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

      // Reduce infamy on floor clear
      try {
        const { reduceInfamy, getInfamySettings } = require('../infamy');
        const infSettings = getInfamySettings(guildId);
        if (infSettings.enabled && infSettings.dungeon_reduction > 0) {
          reduceInfamy(guildId, userId, infSettings.dungeon_reduction, 'dungeon');
        }
      } catch (e) {
        // Infamy not loaded
      }

      // Check if dungeon is cleared
      if (currentRun.floor >= settings.maxFloors) {
        // FULL CLEAR!
        const goldEarned = currentRun.goldEarned;
        await addMoney(guildId, userId, goldEarned, 'Dungeon run (cleared!)');

        recordDungeonRun(guildId, userId, currentRun.floor, settings.maxFloors, goldEarned, 'cleared', tier);
        clearActiveRun(guildId, userId);
        collector.stop('cleared');

        const stats = getDungeonStats(guildId, userId);

        const clearAttach = getMonsterAttachment(currentRun.enemy.name, true);
        const isBoss = currentRun.enemy.boss;
        const clearEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(isBoss ? `🏆 BOSS DEFEATED — DUNGEON CLEARED!` : '🏆 DUNGEON CLEARED!')
          .setDescription(
            isBoss
              ? `You vanquished ${currentRun.enemy.emoji} **${currentRun.enemy.name}** and conquered all ${settings.maxFloors} floors of the ${tierInfo.name} dungeon!`
              : `You defeated ${currentRun.enemy.emoji} **${currentRun.enemy.name}** and conquered all ${settings.maxFloors} floors!`
          )
          .addFields(
            { name: '⚔️ Final Round', value: result.description, inline: false },
            { name: '🏰 Floors Cleared', value: `${currentRun.floor} / ${settings.maxFloors}`, inline: true },
            { name: '💰 Total Gold', value: `${goldEarned.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
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
      startRoundTimer();

      const nextEnemy = generateEnemy(currentRun.floor + 1, settings, currentRun.tier);
      currentRun.nextEnemy = nextEnemy;
      const nextFloorReward = calculateFloorReward(currentRun.floor + 1, settings);

      // Show boss warning if next enemy is a boss
      let nextEnemyPreview = `${nextEnemy.emoji} **${nextEnemy.name}** — ${nextEnemy.maxHp}% HP\n💰 Reward: ${nextFloorReward.toLocaleString()} ${getCurrency(guildId)}`;
      if (nextEnemy.boss) {
        nextEnemyPreview += `\n\n⚠️ **BOSS FIGHT!**\n${nextEnemy.abilityDescription}`;
      }

      const victoryAttach = getMonsterAttachment(currentRun.enemy.name, true);
      const victoryEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`⚔️ FLOOR ${currentRun.floor} CLEARED!`)
        .setDescription(`You defeated ${currentRun.enemy.emoji} **${currentRun.enemy.name}**!\n\n${result.description}`)
        .addFields(
          { name: '💰 Floor Reward', value: `+${floorReward.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '💰 Total Earned', value: `${currentRun.goldEarned.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '❤️ Your HP', value: `${createHealthBar(currentRun.playerHp, currentRun.playerMaxHp)} ${currentRun.playerHp}%${actualHeal > 0 ? ` (+${actualHeal}% healed)` : ' (full HP!)'}`, inline: false },
          { name: `⬇️ Floor ${currentRun.floor + 1} Preview`, value: nextEnemyPreview, inline: false }
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
    const isEnraged = currentRun.bossEnraged && currentRun.enemy.boss;
    const combatAttach = await getScaledMonsterAttachment(currentRun.enemy.name, false, isEnraged);
    const newMoveRow = buildMoveButtons(userId, currentRun.restoreCooldown);
    const newRestoreEscapeRow = buildRestoreEscapeRow(userId, currentRun.restoreCooldown, currentRun.playerHp);

    try { await message.edit({ embeds: [combatEmbed], components: [newMoveRow, newRestoreEscapeRow], attachments: [], files: combatAttach ? [combatAttach] : [] }); } catch {}

    } finally {
      // Clear processing lock if run is still active. If the user pressed
      // Escape while the previous click was still resolving, honor it now
      // so combat doesn't simply continue past their escape attempt.
      const still = getActiveRun(guildId, userId);
      if (still) {
        still.processing = false;
        if (still.pendingEscape) {
          still.pendingEscape = false;
          try { await performEscape(still); }
          catch (e) { console.error('[dungeon] pending escape failed:', e); }
        }
      }
    }
  });

  collector.on('end', async (collected, reason) => {
    if (roundTimer) clearTimeout(roundTimer);
    const leftoverRun = getActiveRun(guildId, userId);
    if (leftoverRun && reason !== 'timeout') {
      clearActiveRun(guildId, userId);
    }
  });
}

// ==================== EMBED BUILDERS ====================

function buildFloorEmbed(user, run, settings, guildId) {
  const floorIntro = FLOOR_INTROS[Math.min(run.floor - 1, FLOOR_INTROS.length - 1)];
  const floorReward = calculateFloorReward(run.floor, settings);
  const tierInfo = TIER_INFO[run.tier] || TIER_INFO[1];
  const isBoss = run.enemy.boss;

  const embed = new EmbedBuilder()
    .setColor(isBoss ? 0xe74c3c : tierInfo.color)
    .setTitle(`${tierInfo.emoji} DUNGEON ${tierInfo.name} — Floor ${run.floor} / ${settings.maxFloors}`)
    .setDescription(
      isBoss
        ? `${floorIntro}\n\n⚠️ **BOSS ENCOUNTER!**\n${run.enemy.emoji} **${run.enemy.name}** blocks your path!\n\n${run.enemy.abilityDescription}`
        : `${floorIntro}\n\n${run.enemy.emoji} **${run.enemy.name}** appears!`
    )
    .setImage('attachment://monster.png')
    .addFields(
      { name: '❤️ Your HP', value: `${createHealthBar(run.playerHp, run.playerMaxHp)} ${run.playerHp}%`, inline: true },
      { name: `${run.enemy.emoji} ${isBoss ? 'Boss' : 'Enemy'} HP`, value: `${createHealthBar(run.enemy.hp, run.enemy.maxHp)} ${run.enemy.hp}%`, inline: true },
      { name: '💰 Gold Earned', value: `${run.goldEarned.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Floor Reward', value: `${floorReward.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
    )
    .setFooter({ text: `Choose your move! (${settings.roundTimeSeconds}s per round)` })
    .setTimestamp();

  return embed;
}

function buildCombatEmbed(user, run, settings, lastRoundText) {
  const floorReward = calculateFloorReward(run.floor, settings);
  const tierInfo = TIER_INFO[run.tier] || TIER_INFO[1];
  const isBoss = run.enemy.boss;

  const lastRound = run.roundLog.length > 0 ? run.roundLog[run.roundLog.length - 1] : null;
  const recentLog = lastRound ? `**R${run.roundLog.length}:** ${lastRound.description}` : '';

  // Boss status indicators
  let bossStatus = '';
  if (isBoss) {
    const bossHpPercent = (run.enemy.hp / run.enemy.maxHp) * 100;
    if (run.enemy.abilities?.rageMode && bossHpPercent <= 30) {
      bossStatus = '\n⚒️ **RAGE MODE ACTIVE!**';
    }
    if (run.enemy.abilities?.adaptive && run.roundLog.length > 0) {
      bossStatus += '\n🌀 *Adapting to your patterns...*';
    }
  }

  return new EmbedBuilder()
    .setColor(isBoss && run.bossEnraged ? 0xe74c3c : tierInfo.color)
    .setTitle(`${tierInfo.emoji} DUNGEON ${tierInfo.name} — Floor ${run.floor} / ${settings.maxFloors}`)
    .setDescription(`Fighting ${run.enemy.emoji} **${run.enemy.name}**${isBoss ? ' (BOSS)' : ''}${bossStatus}`)
    .setImage('attachment://monster.png')
    .addFields(
      { name: '❤️ Your HP', value: `${createHealthBar(run.playerHp, run.playerMaxHp)} ${run.playerHp}%`, inline: true },
      { name: `${run.enemy.emoji} ${isBoss ? 'Boss' : 'Enemy'} HP`, value: `${createHealthBar(run.enemy.hp, run.enemy.maxHp)} ${run.enemy.hp}%`, inline: true },
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

function buildRestoreEscapeRow(userId, restoreCooldown, playerHp = 100) {
  const escapeChance = Math.min(playerHp + 25, 99);
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
      .setLabel(`🏃 Escape (${escapeChance}%)`)
      .setStyle(ButtonStyle.Secondary)
  );
}
