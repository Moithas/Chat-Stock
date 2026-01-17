// Admin Skills Panel - XP & Training Settings (Fully Modular)
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logAdminAction } = require('../admin');
const { getSkillSettings, updateSkillSettings, LEVEL_THRESHOLDS, TRAINING_COSTS, TRAINING_TIMES } = require('../skills');

const CURRENCY = '<:babybel:1418824333664452608>';

// Define all interaction IDs this module handles
const BUTTON_IDS = [
  'admin_skills',
  'admin_skills_edit_xp', 'admin_skills_edit_hack', 'admin_skills_edit_rob',
  'admin_skills_view_levels',
  'back_admin_skills'
];

const MODAL_IDS = [
  'modal_admin_skills_xp',
  'modal_admin_skills_hack',
  'modal_admin_skills_rob'
];

// ==================== MAIN INTERACTION HANDLER ====================
async function handleInteraction(interaction, guildId) {
  const customId = interaction.customId;
  
  // Handle button interactions
  if (interaction.isButton()) {
    if (!BUTTON_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'admin_skills':
        await interaction.deferUpdate();
        await showSkillsPanel(interaction, guildId);
        return true;
      case 'admin_skills_edit_xp':
        await handleEditXpSettings(interaction, guildId);
        return true;
      case 'admin_skills_edit_hack':
        await handleEditHackBonuses(interaction, guildId);
        return true;
      case 'admin_skills_edit_rob':
        await handleEditRobBonuses(interaction, guildId);
        return true;
      case 'admin_skills_view_levels':
        await interaction.deferUpdate();
        await showLevelThresholds(interaction, guildId);
        return true;
      case 'back_admin_skills':
        await interaction.deferUpdate();
        await showSkillsPanel(interaction, guildId);
        return true;
    }
  }
  
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (!MODAL_IDS.includes(customId)) return false;
    
    switch (customId) {
      case 'modal_admin_skills_xp':
        await handleXpSettingsModal(interaction, guildId);
        return true;
      case 'modal_admin_skills_hack':
        await handleHackBonusesModal(interaction, guildId);
        return true;
      case 'modal_admin_skills_rob':
        await handleRobBonusesModal(interaction, guildId);
        return true;
    }
  }
  
  return false;
}

// ==================== SKILLS PANEL ====================
async function showSkillsPanel(interaction, guildId) {
  const settings = getSkillSettings(guildId);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎓 Skills & Training Settings')
    .setDescription('Configure XP awards, training, and skill bonuses for /hack and /rob')
    .addFields(
      { name: '📊 XP Settings', value: 
        `Success Base: **${settings.successXpBase}** XP\n` +
        `Per 1K Stolen: **+${settings.successXpPerThousand}** XP\n` +
        `Bonus Cap: **+${settings.successXpBonusCap}** XP max\n` +
        `Failure XP: **${settings.failureXp}** XP\n` +
        `Training XP: **${settings.trainingXpPercent}%** of level`, 
        inline: true 
      },
      { name: '💻 Hack Bonuses (per level)', value: 
        `Success Rate: **+${settings.hackSuccessRatePerLevel}%**\n` +
        `Max Steal: **+${settings.hackMaxStealPerLevel}%**\n` +
        `Cooldown: **-${settings.hackCooldownReductionPerLevel}%**\n` +
        `Trace Chance: **-${settings.hackTraceReductionPerLevel}%**`, 
        inline: true 
      },
      { name: '🔓 Rob Bonuses (per level)', value: 
        `Success Rate: **+${settings.robSuccessRatePerLevel}%**\n` +
        `Min/Max Steal: **+${settings.robMinStealPerLevel}%** / **+${settings.robMaxStealPerLevel}%**\n` +
        `Cooldown: **-${settings.robCooldownReductionPerLevel}%**\n` +
        `Fine: **-${settings.robFineReductionPerLevel}%**`, 
        inline: true 
      }
    )
    .setFooter({ text: 'Players can only train once per level - must earn XP to level up' });

  const editXpBtn = new ButtonBuilder()
    .setCustomId('admin_skills_edit_xp')
    .setLabel('XP Settings')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('📊');

  const editHackBtn = new ButtonBuilder()
    .setCustomId('admin_skills_edit_hack')
    .setLabel('Hack Bonuses')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('💻');

  const editRobBtn = new ButtonBuilder()
    .setCustomId('admin_skills_edit_rob')
    .setLabel('Rob Bonuses')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔓');

  const viewLevelsBtn = new ButtonBuilder()
    .setCustomId('admin_skills_view_levels')
    .setLabel('View Level Info')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📈');

  const backBtn = new ButtonBuilder()
    .setCustomId('back_dashboard')
    .setLabel('Back to Dashboard')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row1 = new ActionRowBuilder().addComponents(editXpBtn, editHackBtn, editRobBtn);
  const row2 = new ActionRowBuilder().addComponents(viewLevelsBtn, backBtn);

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

// ==================== VIEW LEVEL THRESHOLDS ====================
async function showLevelThresholds(interaction, guildId) {
  const settings = getSkillSettings(guildId);
  
  // Build level info
  let levelInfo = '';
  for (let i = 0; i < 10; i++) {
    const xpNeeded = LEVEL_THRESHOLDS[i + 1] - LEVEL_THRESHOLDS[i];
    const trainingXp = Math.floor(xpNeeded * (settings.trainingXpPercent / 100));
    levelInfo += `**Level ${i} → ${i + 1}**: ${xpNeeded.toLocaleString()} XP (Training: ${trainingXp} XP)\n`;
  }
  
  // Build training costs
  let trainingInfo = '';
  for (let i = 1; i <= 9; i++) {
    const hours = TRAINING_TIMES[i] / (1000 * 60 * 60);
    trainingInfo += `**To Level ${i}**: ${TRAINING_COSTS[i].toLocaleString()} ${CURRENCY} (${hours}h)\n`;
  }
  
  // Build max bonuses at level 10
  const hackMaxBonuses = 
    `Success: +${(settings.hackSuccessRatePerLevel * 10).toFixed(1)}%\n` +
    `Max Steal: ${(5 + settings.hackMaxStealPerLevel * 10).toFixed(1)}% of bank\n` +
    `Cooldown: -${(settings.hackCooldownReductionPerLevel * 10).toFixed(1)}%\n` +
    `Trace: -${(settings.hackTraceReductionPerLevel * 10).toFixed(1)}%`;
    
  const robMaxBonuses = 
    `Success: +${(settings.robSuccessRatePerLevel * 10).toFixed(1)}%\n` +
    `Steal: ${(20 + settings.robMinStealPerLevel * 10).toFixed(1)}% - ${(80 + settings.robMaxStealPerLevel * 10).toFixed(1)}%\n` +
    `Cooldown: -${(settings.robCooldownReductionPerLevel * 10).toFixed(1)}%\n` +
    `Fine: -${(settings.robFineReductionPerLevel * 10).toFixed(1)}%`;

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('📈 Level & Training Info')
    .setDescription('XP requirements, training costs, and max bonuses')
    .addFields(
      { name: '📊 XP Requirements', value: levelInfo, inline: false },
      { name: '🏋️ Training Costs', value: trainingInfo, inline: false },
      { name: '💻 Hack Max (Lv10)', value: hackMaxBonuses, inline: true },
      { name: '🔓 Rob Max (Lv10)', value: robMaxBonuses, inline: true }
    )
    .setFooter({ text: 'Training gives 75% of XP needed - players must earn the rest' });

  const backBtn = new ButtonBuilder()
    .setCustomId('back_admin_skills')
    .setLabel('Back to Skills')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row = new ActionRowBuilder().addComponents(backBtn);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ==================== EDIT XP SETTINGS ====================
async function handleEditXpSettings(interaction, guildId) {
  const settings = getSkillSettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_skills_xp')
    .setTitle('Edit XP Settings');

  const successBaseInput = new TextInputBuilder()
    .setCustomId('success_base')
    .setLabel('Success XP Base')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.successXpBase))
    .setPlaceholder('20')
    .setRequired(true);

  const perThousandInput = new TextInputBuilder()
    .setCustomId('per_thousand')
    .setLabel('Bonus XP per 1K Stolen')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.successXpPerThousand))
    .setPlaceholder('1')
    .setRequired(true);

  const bonusCapInput = new TextInputBuilder()
    .setCustomId('bonus_cap')
    .setLabel('Max Bonus XP')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.successXpBonusCap))
    .setPlaceholder('30')
    .setRequired(true);

  const failureXpInput = new TextInputBuilder()
    .setCustomId('failure_xp')
    .setLabel('Failure XP')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.failureXp))
    .setPlaceholder('8')
    .setRequired(true);

  const trainingPercentInput = new TextInputBuilder()
    .setCustomId('training_percent')
    .setLabel('Training XP % (of level requirement)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.trainingXpPercent))
    .setPlaceholder('75')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(successBaseInput),
    new ActionRowBuilder().addComponents(perThousandInput),
    new ActionRowBuilder().addComponents(bonusCapInput),
    new ActionRowBuilder().addComponents(failureXpInput),
    new ActionRowBuilder().addComponents(trainingPercentInput)
  );

  await interaction.showModal(modal);
}

async function handleXpSettingsModal(interaction, guildId) {
  const successBase = parseInt(interaction.fields.getTextInputValue('success_base')) || 20;
  const perThousand = parseInt(interaction.fields.getTextInputValue('per_thousand')) || 1;
  const bonusCap = parseInt(interaction.fields.getTextInputValue('bonus_cap')) || 30;
  const failureXp = parseInt(interaction.fields.getTextInputValue('failure_xp')) || 8;
  const trainingPercent = parseInt(interaction.fields.getTextInputValue('training_percent')) || 75;

  updateSkillSettings(guildId, {
    successXpBase: Math.max(1, successBase),
    successXpPerThousand: Math.max(0, perThousand),
    successXpBonusCap: Math.max(0, bonusCap),
    failureXp: Math.max(1, failureXp),
    trainingXpPercent: Math.min(99, Math.max(1, trainingPercent)) // Cap at 99% so they always need to earn some
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `Updated skill XP settings: Base=${successBase}, Per1K=${perThousand}, Cap=${bonusCap}, Fail=${failureXp}, Training=${trainingPercent}%`);

  await interaction.deferUpdate();
  await showSkillsPanel(interaction, guildId);
}

// ==================== EDIT HACK BONUSES ====================
async function handleEditHackBonuses(interaction, guildId) {
  const settings = getSkillSettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_skills_hack')
    .setTitle('Edit Hack Bonuses (per level)');

  const successRateInput = new TextInputBuilder()
    .setCustomId('success_rate')
    .setLabel('Success Rate Bonus % per Level')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.hackSuccessRatePerLevel))
    .setPlaceholder('4')
    .setRequired(true);

  const maxStealInput = new TextInputBuilder()
    .setCustomId('max_steal')
    .setLabel('Max Steal Bonus % per Level (base 5%)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.hackMaxStealPerLevel))
    .setPlaceholder('1.5')
    .setRequired(true);

  const cooldownInput = new TextInputBuilder()
    .setCustomId('cooldown')
    .setLabel('Cooldown Reduction % per Level')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.hackCooldownReductionPerLevel))
    .setPlaceholder('2')
    .setRequired(true);

  const traceInput = new TextInputBuilder()
    .setCustomId('trace')
    .setLabel('Trace Chance Reduction % per Level')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.hackTraceReductionPerLevel))
    .setPlaceholder('4')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(successRateInput),
    new ActionRowBuilder().addComponents(maxStealInput),
    new ActionRowBuilder().addComponents(cooldownInput),
    new ActionRowBuilder().addComponents(traceInput)
  );

  await interaction.showModal(modal);
}

async function handleHackBonusesModal(interaction, guildId) {
  const successRate = parseFloat(interaction.fields.getTextInputValue('success_rate')) || 4;
  const maxSteal = parseFloat(interaction.fields.getTextInputValue('max_steal')) || 1.5;
  const cooldown = parseFloat(interaction.fields.getTextInputValue('cooldown')) || 2;
  const trace = parseFloat(interaction.fields.getTextInputValue('trace')) || 4;

  updateSkillSettings(guildId, {
    hackSuccessRatePerLevel: Math.max(0, successRate),
    hackMaxStealPerLevel: Math.max(0, maxSteal),
    hackCooldownReductionPerLevel: Math.max(0, cooldown),
    hackTraceReductionPerLevel: Math.max(0, trace)
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `Updated hack skill bonuses: Success=${successRate}%, MaxSteal=${maxSteal}%, Cooldown=${cooldown}%, Trace=${trace}%`);

  await interaction.deferUpdate();
  await showSkillsPanel(interaction, guildId);
}

// ==================== EDIT ROB BONUSES ====================
async function handleEditRobBonuses(interaction, guildId) {
  const settings = getSkillSettings(guildId);
  
  const modal = new ModalBuilder()
    .setCustomId('modal_admin_skills_rob')
    .setTitle('Edit Rob Bonuses (per level)');

  const successRateInput = new TextInputBuilder()
    .setCustomId('success_rate')
    .setLabel('Success Rate Bonus % per Level')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.robSuccessRatePerLevel))
    .setPlaceholder('2')
    .setRequired(true);

  const minStealInput = new TextInputBuilder()
    .setCustomId('min_steal')
    .setLabel('Min Steal Bonus % per Level (base 20%)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.robMinStealPerLevel))
    .setPlaceholder('1.5')
    .setRequired(true);

  const maxStealInput = new TextInputBuilder()
    .setCustomId('max_steal')
    .setLabel('Max Steal Bonus % per Level (base 80%)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.robMaxStealPerLevel))
    .setPlaceholder('1.5')
    .setRequired(true);

  const cooldownInput = new TextInputBuilder()
    .setCustomId('cooldown')
    .setLabel('Cooldown Reduction % per Level')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.robCooldownReductionPerLevel))
    .setPlaceholder('1.5')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(successRateInput),
    new ActionRowBuilder().addComponents(minStealInput),
    new ActionRowBuilder().addComponents(maxStealInput),
    new ActionRowBuilder().addComponents(cooldownInput)
  );

  await interaction.showModal(modal);
}

async function handleRobBonusesModal(interaction, guildId) {
  const successRate = parseFloat(interaction.fields.getTextInputValue('success_rate')) || 2;
  const minSteal = parseFloat(interaction.fields.getTextInputValue('min_steal')) || 1.5;
  const maxSteal = parseFloat(interaction.fields.getTextInputValue('max_steal')) || 1.5;
  const cooldown = parseFloat(interaction.fields.getTextInputValue('cooldown')) || 1.5;

  updateSkillSettings(guildId, {
    robSuccessRatePerLevel: Math.max(0, successRate),
    robMinStealPerLevel: Math.max(0, minSteal),
    robMaxStealPerLevel: Math.max(0, maxSteal),
    robCooldownReductionPerLevel: Math.max(0, cooldown)
  });

  logAdminAction(guildId, interaction.user.id, interaction.user.username, 
    `Updated rob skill bonuses: Success=${successRate}%, MinSteal=${minSteal}%, MaxSteal=${maxSteal}%, Cooldown=${cooldown}%`);

  await interaction.deferUpdate();
  await showSkillsPanel(interaction, guildId);
}

// ==================== EXPORTS ====================
module.exports = {
  handleInteraction,
  showSkillsPanel,
  BUTTON_IDS,
  MODAL_IDS
};
