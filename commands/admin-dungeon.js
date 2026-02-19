// Admin Dungeon Panel - Dungeon crawl settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getDungeonSettings, updateDungeonSettings } = require('../dungeon');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_dungeon',
  'dungeon_toggle', 'dungeon_edit_settings',
  'back_dungeon'
];

const MODAL_IDS = [
  'modal_dungeon_settings'
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
      case 'dungeon_edit_settings':
        await handleDungeonEditSettings(interaction, guildId);
        return true;
      case 'back_dungeon':
        await interaction.deferUpdate();
        await showDungeonPanel(interaction, guildId);
        return true;
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;

    switch (customId) {
      case 'modal_dungeon_settings':
        await handleDungeonSettingsModal(interaction, guildId);
        return true;
    }
  }

  return false;
}

// ==================== DUNGEON PANEL ====================
async function showDungeonPanel(interaction, guildId) {
  const settings = getDungeonSettings(guildId);

  // Calculate total gold for a full clear
  let totalGold = 0;
  for (let i = 1; i <= settings.maxFloors; i++) {
    totalGold += settings.baseReward + (i - 1) * settings.rewardPerFloor;
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🏰 Dungeon Settings')
    .setDescription('Configure the solo dungeon crawl system')
    .addFields(
      { name: '📊 Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🏰 Max Floors', value: String(settings.maxFloors), inline: true },
      { name: '⏱️ Cooldown', value: `${settings.cooldownMinutes} min`, inline: true },
      { name: '💰 Base Reward', value: `${settings.baseReward.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '💰 Per Floor Bonus', value: `+${settings.rewardPerFloor.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '💰 Full Clear Total', value: `${totalGold.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: '❤️ Player HP', value: `${settings.playerHp}%`, inline: true },
      { name: '🤖 Base Enemy HP', value: `${settings.baseEnemyHp}%`, inline: true },
      { name: '🤖 Enemy HP/Floor', value: `+${settings.enemyHpPerFloor}%`, inline: true },
      { name: '💀 Death Penalty', value: `−${settings.deathPenaltyPercent}% of earned gold`, inline: true },
      { name: '⏱️ Round Timer', value: `${settings.roundTimeSeconds}s`, inline: true }
    );

  const toggleBtn = new ButtonBuilder()
    .setCustomId('dungeon_toggle')
    .setLabel(settings.enabled ? 'Disable' : 'Enable')
    .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const editBtn = new ButtonBuilder()
    .setCustomId('dungeon_edit_settings')
    .setLabel('⚙️ Edit Settings')
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('◀️ Back')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(toggleBtn, editBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== TOGGLE ====================
async function handleDungeonToggle(interaction, guildId) {
  const settings = getDungeonSettings(guildId);
  updateDungeonSettings(guildId, { enabled: !settings.enabled });
  logAdminAction(guildId, interaction.user.id, interaction.user.username, `Toggled dungeon ${!settings.enabled ? 'ON' : 'OFF'}`);
  await showDungeonPanel(interaction, guildId);
}

// ==================== EDIT SETTINGS ====================
async function handleDungeonEditSettings(interaction, guildId) {
  const settings = getDungeonSettings(guildId);

  const modal = new ModalBuilder()
    .setCustomId('modal_dungeon_settings')
    .setTitle('Dungeon Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_floors')
          .setLabel('Max Floors')
          .setPlaceholder('5')
          .setValue(String(settings.maxFloors))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rewards')
          .setLabel('Base Reward, Per Floor Bonus (comma sep)')
          .setPlaceholder('50,30')
          .setValue(`${settings.baseReward},${settings.rewardPerFloor}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
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
          .setCustomId('enemy_hp')
          .setLabel('Base Enemy HP, HP Per Floor (comma sep)')
          .setPlaceholder('80,15')
          .setValue(`${settings.baseEnemyHp},${settings.enemyHpPerFloor}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('player_settings')
          .setLabel('Player HP, Death Penalty %, Round Timer(s)')
          .setPlaceholder('100,50,15')
          .setValue(`${settings.playerHp},${settings.deathPenaltyPercent},${settings.roundTimeSeconds}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
}

// ==================== MODAL HANDLER ====================
async function handleDungeonSettingsModal(interaction, guildId) {
  try {
    const maxFloors = parseInt(interaction.fields.getTextInputValue('max_floors'));

    const rewardParts = interaction.fields.getTextInputValue('rewards').split(',').map(v => parseInt(v.trim()));
    const baseReward = rewardParts[0];
    const rewardPerFloor = rewardParts[1];

    const cooldownMinutes = parseInt(interaction.fields.getTextInputValue('cooldown'));

    const enemyParts = interaction.fields.getTextInputValue('enemy_hp').split(',').map(v => parseInt(v.trim()));
    const baseEnemyHp = enemyParts[0];
    const enemyHpPerFloor = enemyParts[1];

    const playerParts = interaction.fields.getTextInputValue('player_settings').split(',').map(v => parseInt(v.trim()));
    const playerHp = playerParts[0];
    const deathPenaltyPercent = playerParts[1];
    const roundTimeSeconds = playerParts[2];

    // Validate
    const allValues = [maxFloors, baseReward, rewardPerFloor, cooldownMinutes, baseEnemyHp, enemyHpPerFloor, playerHp, deathPenaltyPercent, roundTimeSeconds];
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

    updateDungeonSettings(guildId, {
      maxFloors, baseReward, rewardPerFloor, cooldownMinutes,
      baseEnemyHp, enemyHpPerFloor, playerHp, deathPenaltyPercent, roundTimeSeconds
    });

    logAdminAction(guildId, interaction.user.id, interaction.user.username,
      `Updated dungeon settings: ${maxFloors} floors, ${baseReward}+${rewardPerFloor}/floor, ${cooldownMinutes}min cd`);

    await interaction.reply({ content: '✅ Dungeon settings updated!', flags: 64 });
  } catch (err) {
    console.error('[Admin-Dungeon] Modal error:', err);
    await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 }).catch(() => {});
  }
}

module.exports = {
  handleInteraction,
  showDungeonPanel
};
