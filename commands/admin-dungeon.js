// Admin Dungeon Panel - Dungeon crawl settings with tiered system (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction, getCurrency } = require('../admin');
const { getDungeonSettings, updateDungeonSettings, getDungeonTierSettings, updateDungeonTierSettings, BOSS_TYPES, TIER_DEFAULTS } = require('../dungeon');



// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_dungeon',
  'dungeon_toggle', 'dungeon_edit_global',
  'dungeon_tier_1', 'dungeon_tier_2', 'dungeon_tier_3',
  'dungeon_edit_tier_1', 'dungeon_edit_tier_2', 'dungeon_edit_tier_3',
  'back_dungeon'
];

const MODAL_IDS = [
  'modal_dungeon_global',
  'modal_dungeon_tier_1', 'modal_dungeon_tier_2', 'modal_dungeon_tier_3'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;

  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;

    switch (customId) {
      case 'admin_dungeon':
        await interaction.deferUpdate();
        await showDungeonPanel(interaction, guildId);
        return true;
      case 'dungeon_toggle':
        await interaction.deferUpdate();
        await handleDungeonToggle(interaction, guildId);
        return true;
      case 'dungeon_edit_global':
        await handleEditGlobal(interaction, guildId);
        return true;
      case 'dungeon_tier_1':
      case 'dungeon_tier_2':
      case 'dungeon_tier_3': {
        await interaction.deferUpdate();
        const tier = parseInt(customId.split('_')[2]);
        await showTierPanel(interaction, guildId, tier);
        return true;
      }
      case 'dungeon_edit_tier_1':
      case 'dungeon_edit_tier_2':
      case 'dungeon_edit_tier_3': {
        const tier = parseInt(customId.split('_')[3]);
        await handleEditTier(interaction, guildId, tier);
        return true;
      }
      case 'back_dungeon':
        await interaction.deferUpdate();
        await showDungeonPanel(interaction, guildId);
        return true;
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;

    if (customId === 'modal_dungeon_global') {
      await handleGlobalModal(interaction, guildId);
      return true;
    }

    const tierMatch = customId.match(/^modal_dungeon_tier_(\d)$/);
    if (tierMatch) {
      await handleTierModal(interaction, guildId, parseInt(tierMatch[1]));
      return true;
    }
  }

  return false;
}

// ==================== MAIN DUNGEON PANEL ====================
async function showDungeonPanel(interaction, guildId) {
  const settings = getDungeonSettings(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🏰 Dungeon Settings')
    .setDescription('Configure the tiered dungeon crawl system.\nUse the tier buttons to configure each tier independently.')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '⏱️ Cooldown', value: `${settings.cooldownMinutes} min`, inline: true },
      { name: '⏱️ Round Timer', value: `${settings.roundTimeSeconds}s`, inline: true }
    );

  // Show tier summaries
  for (let tier = 1; tier <= 3; tier++) {
    const ts = getDungeonTierSettings(guildId, tier);
    const boss = BOSS_TYPES[tier];
    let totalGold = 0;
    for (let i = 1; i <= ts.maxFloors; i++) {
      totalGold += ts.baseReward + (i - 1) * ts.rewardPerFloor;
    }
    const tierEmojis = { 1: '🏰', 2: '⚔️', 3: '💀' };
    embed.addFields({
      name: `${tierEmojis[tier]} Tier ${tier} — ${ts.maxFloors} Floors`,
      value: `Boss: ${boss.emoji} ${boss.name} | Full Clear: ${totalGold.toLocaleString()} ${getCurrency(guildId)}\nHP: ${ts.playerHp}% | Enemy: ${ts.baseEnemyHp}+${ts.enemyHpPerFloor}/floor | Death: −${ts.deathPenaltyPercent}%`,
      inline: false
    });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dungeon_toggle').setLabel(settings.enabled ? 'Disable' : 'Enable').setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('dungeon_edit_global').setLabel('⚙️ Global Settings').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('back_dashboard').setLabel('◀️ Back').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dungeon_tier_1').setLabel('🏰 Tier 1').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('dungeon_tier_2').setLabel('⚔️ Tier 2').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dungeon_tier_3').setLabel('💀 Tier 3').setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== TIER PANEL ====================
async function showTierPanel(interaction, guildId, tier) {
  const ts = getDungeonTierSettings(guildId, tier);
  const boss = BOSS_TYPES[tier];
  const tierEmojis = { 1: '🏰', 2: '⚔️', 3: '💀' };

  let totalGold = 0;
  for (let i = 1; i <= ts.maxFloors; i++) {
    totalGold += ts.baseReward + (i - 1) * ts.rewardPerFloor;
  }

  const embed = new EmbedBuilder()
    .setColor(tier === 3 ? 0xe74c3c : tier === 2 ? 0xe67e22 : 0x3498db)
    .setTitle(`${tierEmojis[tier]} Dungeon Tier ${tier} Settings`)
    .setDescription(`**Boss:** ${boss.emoji} **${boss.name}**\n${boss.abilityDescription}`)
    .addFields(
      { name: '🏰 Max Floors', value: String(ts.maxFloors), inline: true },
      { name: '❤️ Player HP', value: `${ts.playerHp}%`, inline: true },
      { name: '💀 Death Penalty', value: `−${ts.deathPenaltyPercent}%`, inline: true },
      { name: '💰 Base Reward', value: `${ts.baseReward.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Per Floor Bonus', value: `+${ts.rewardPerFloor.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Full Clear Total', value: `${totalGold.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '🤖 Base Enemy HP', value: `${ts.baseEnemyHp}%`, inline: true },
      { name: '🤖 Enemy HP/Floor', value: `+${ts.enemyHpPerFloor}%`, inline: true },
      { name: '💚 Floor Heal', value: `${ts.floorHealPercent}%`, inline: true },
      { name: '🔥 Boss Enrage', value: `Below ${ts.enragedThreshold}% HP`, inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dungeon_edit_tier_${tier}`).setLabel('⚙️ Edit Tier Settings').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('back_dungeon').setLabel('◀️ Back').setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== TOGGLE ====================
async function handleDungeonToggle(interaction, guildId) {
  const settings = getDungeonSettings(guildId);
  updateDungeonSettings(guildId, { enabled: !settings.enabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled dungeon ${!settings.enabled ? 'ON' : 'OFF'}`);
  await showDungeonPanel(interaction, guildId);
}

// ==================== EDIT GLOBAL MODAL ====================
async function handleEditGlobal(interaction, guildId) {
  const settings = getDungeonSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_dungeon_global')
    .setTitle('Dungeon Global Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown')
          .setLabel('Cooldown (minutes)')
          .setPlaceholder('180')
          .setValue(String(settings.cooldownMinutes))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('round_timer')
          .setLabel('Round Timer (seconds)')
          .setPlaceholder('15')
          .setValue(String(settings.roundTimeSeconds))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
}

// ==================== EDIT TIER MODAL ====================
async function handleEditTier(interaction, guildId, tier) {
  const ts = getDungeonTierSettings(guildId, tier);

  const modal = new ModalBuilder()
    .setCustomId(`modal_dungeon_tier_${tier}`)
    .setTitle(`Dungeon Tier ${tier} Settings`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_floors')
          .setLabel('Max Floors')
          .setPlaceholder('5')
          .setValue(String(ts.maxFloors))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rewards')
          .setLabel('Base Reward, Per Floor Bonus (comma sep)')
          .setPlaceholder('50,30')
          .setValue(`${ts.baseReward},${ts.rewardPerFloor}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('enemy_hp')
          .setLabel('Base Enemy HP, HP Per Floor (comma sep)')
          .setPlaceholder('80,15')
          .setValue(`${ts.baseEnemyHp},${ts.enemyHpPerFloor}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('player_settings')
          .setLabel('Player HP, Death Penalty %, Floor Heal %')
          .setPlaceholder('100,50,20')
          .setValue(`${ts.playerHp},${ts.deathPenaltyPercent},${ts.floorHealPercent}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('enraged_threshold')
          .setLabel('Boss Enrage Threshold (% HP)')
          .setPlaceholder('40')
          .setValue(String(ts.enragedThreshold))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
}

// ==================== GLOBAL MODAL HANDLER ====================
async function handleGlobalModal(interaction, guildId) {
  try {
    const cooldownMinutes = parseInt(interaction.fields.getTextInputValue('cooldown'));
    const roundTimeSeconds = parseInt(interaction.fields.getTextInputValue('round_timer'));

    if ([cooldownMinutes, roundTimeSeconds].some(isNaN)) {
      await interaction.reply({ content: '❌ All values must be valid numbers.', flags: 64 });
      return;
    }

    if (cooldownMinutes < 0) {
      await interaction.reply({ content: '❌ Cooldown must be 0 or greater.', flags: 64 });
      return;
    }

    if (roundTimeSeconds < 5 || roundTimeSeconds > 120) {
      await interaction.reply({ content: '❌ Round timer must be between 5 and 120 seconds.', flags: 64 });
      return;
    }

    updateDungeonSettings(guildId, { cooldownMinutes, roundTimeSeconds });

    logAdminAction(guildId, interaction.user.id, interaction.user.username,
      `Updated dungeon global: ${cooldownMinutes}min cd, ${roundTimeSeconds}s rounds`);

    await interaction.reply({ content: '✅ Global dungeon settings updated!', flags: 64 });
  } catch (err) {
    console.error('[Admin-Dungeon] Global modal error:', err);
    await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
  }
}

// ==================== TIER MODAL HANDLER ====================
async function handleTierModal(interaction, guildId, tier) {
  try {
    const maxFloors = parseInt(interaction.fields.getTextInputValue('max_floors'));

    const rewardParts = interaction.fields.getTextInputValue('rewards').split(',').map(v => parseInt(v.trim()));
    const baseReward = rewardParts[0];
    const rewardPerFloor = rewardParts[1];

    const enemyParts = interaction.fields.getTextInputValue('enemy_hp').split(',').map(v => parseInt(v.trim()));
    const baseEnemyHp = enemyParts[0];
    const enemyHpPerFloor = enemyParts[1];

    const playerParts = interaction.fields.getTextInputValue('player_settings').split(',').map(v => parseInt(v.trim()));
    const playerHp = playerParts[0];
    const deathPenaltyPercent = playerParts[1];
    const floorHealPercent = playerParts[2];

    const enragedThreshold = parseInt(interaction.fields.getTextInputValue('enraged_threshold'));

    const allValues = [maxFloors, baseReward, rewardPerFloor, baseEnemyHp, enemyHpPerFloor, playerHp, deathPenaltyPercent, floorHealPercent, enragedThreshold];
    if (allValues.some(isNaN)) {
      await interaction.reply({ content: '❌ All values must be valid numbers.', flags: 64 });
      return;
    }

    if (maxFloors < 1 || maxFloors > 20) {
      await interaction.reply({ content: '❌ Max floors must be between 1 and 20.', flags: 64 });
      return;
    }

    if (deathPenaltyPercent < 0 || deathPenaltyPercent > 100) {
      await interaction.reply({ content: '❌ Death penalty must be between 0 and 100%.', flags: 64 });
      return;
    }

    if (enragedThreshold < 0 || enragedThreshold > 100) {
      await interaction.reply({ content: '❌ Enrage threshold must be between 0 and 100%.', flags: 64 });
      return;
    }

    updateDungeonTierSettings(guildId, tier, {
      maxFloors, baseReward, rewardPerFloor,
      baseEnemyHp, enemyHpPerFloor, playerHp,
      deathPenaltyPercent, floorHealPercent, enragedThreshold
    });

    logAdminAction(guildId, interaction.user.id, interaction.user.username,
      `Updated dungeon tier ${tier}: ${maxFloors} floors, ${baseReward}+${rewardPerFloor}/floor, ${deathPenaltyPercent}% penalty`);

    await interaction.reply({ content: `✅ Tier ${tier} dungeon settings updated!`, flags: 64 });
  } catch (err) {
    console.error('[Admin-Dungeon] Tier modal error:', err);
    await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
  }
}

module.exports = {
  handleInteraction,
  showDungeonPanel
};
