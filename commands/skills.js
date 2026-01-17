const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, addMoney } = require('../economy');
const { 
  getUserSkills, 
  getXpProgress, 
  getHackBonuses, 
  getRobBonuses, 
  createProgressBar,
  formatDuration,
  checkTrainingComplete,
  getTrainingInfo,
  startTraining,
  LEVEL_THRESHOLDS,
  TRAINING_COSTS,
  TRAINING_TIMES
} = require('../skills');

const CURRENCY = '<:babybel:1418824333664452608>';

// Button custom IDs
const BUTTON_IDS = ['skills_train_hack', 'skills_train_rob', 'skills_refresh'];

function buildSkillsEmbed(interaction, skills, hackBonuses, robBonuses, hackProgress, robProgress, notifications = []) {
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🎓 ${interaction.user.username}'s Skills`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  
  if (notifications.length > 0) {
    embed.setDescription(notifications.join('\n'));
  }
  
  // Hack skill section
  let hackStatus = '';
  if (skills.hackLevel >= 10) {
    hackStatus = '**MAX LEVEL**';
  } else {
    hackStatus = `[${createProgressBar(hackProgress.percent)}] ${hackProgress.current}/${hackProgress.needed} XP`;
  }
  
  let hackTrainingStatus = '';
  if (skills.hackTraining && skills.hackTraining.endTime > Date.now()) {
    const remaining = skills.hackTraining.endTime - Date.now();
    hackTrainingStatus = `\n🏋️ Training: ${formatDuration(remaining)} remaining`;
  }
  
  embed.addFields({
    name: `💻 Hacking - Level ${skills.hackLevel}`,
    value: `${hackStatus}${hackTrainingStatus}\n` +
      `├ Success Rate: **+${hackBonuses.successRateBonus.toFixed(1)}%**\n` +
      `├ Max Steal: **${(5 + hackBonuses.maxStealBonus).toFixed(1)}%** of bank\n` +
      `├ Cooldown: **-${hackBonuses.cooldownReduction.toFixed(1)}%**\n` +
      `└ Trace Chance: **-${hackBonuses.traceReduction.toFixed(1)}%**`,
    inline: false
  });
  
  // Rob skill section
  let robStatus = '';
  if (skills.robLevel >= 10) {
    robStatus = '**MAX LEVEL**';
  } else {
    robStatus = `[${createProgressBar(robProgress.percent)}] ${robProgress.current}/${robProgress.needed} XP`;
  }
  
  let robTrainingStatus = '';
  if (skills.robTraining && skills.robTraining.endTime > Date.now()) {
    const remaining = skills.robTraining.endTime - Date.now();
    robTrainingStatus = `\n🏋️ Training: ${formatDuration(remaining)} remaining`;
  }
  
  embed.addFields({
    name: `🔓 Robbing - Level ${skills.robLevel}`,
    value: `${robStatus}${robTrainingStatus}\n` +
      `├ Success Rate: **+${robBonuses.successRateBonus.toFixed(1)}%**\n` +
      `├ Steal Range: **${(20 + robBonuses.minStealBonus).toFixed(1)}% - ${(80 + robBonuses.maxStealBonus).toFixed(1)}%** of cash\n` +
      `├ Cooldown: **-${robBonuses.cooldownReduction.toFixed(1)}%**\n` +
      `└ Jail/Fine: **-${robBonuses.fineReduction.toFixed(1)}%**`,
    inline: false
  });
  
  // XP info
  embed.addFields({
    name: '📊 Total XP',
    value: `💻 Hack: **${skills.hackXp.toLocaleString()}** XP\n🔓 Rob: **${skills.robXp.toLocaleString()}** XP`,
    inline: true
  });
  
  return embed;
}

function buildTrainingButtons(guildId, userId) {
  const skills = getUserSkills(guildId, userId);
  const hackInfo = getTrainingInfo(guildId, userId, 'hack');
  const robInfo = getTrainingInfo(guildId, userId, 'rob');
  
  const row = new ActionRowBuilder();
  
  // Hack training button
  let hackLabel = 'Train Hack';
  let hackDisabled = false;
  let hackStyle = ButtonStyle.Primary;
  
  if (hackInfo.maxLevel) {
    hackLabel = 'Hack Maxed';
    hackDisabled = true;
    hackStyle = ButtonStyle.Secondary;
  } else if (hackInfo.activeTraining) {
    const remaining = hackInfo.activeTraining.endTime - Date.now();
    if (remaining > 0) {
      hackLabel = `Training... ${formatDuration(remaining)}`;
      hackDisabled = true;
      hackStyle = ButtonStyle.Secondary;
    } else {
      hackLabel = 'Claim Training';
      hackStyle = ButtonStyle.Success;
    }
  } else if (hackInfo.alreadyTrainedAtLevel) {
    hackLabel = 'Level Up to Train';
    hackDisabled = true;
    hackStyle = ButtonStyle.Secondary;
  } else {
    hackLabel = `Train Hack (${hackInfo.cost.toLocaleString()})`;
  }
  
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('skills_train_hack')
      .setLabel(hackLabel)
      .setEmoji('💻')
      .setStyle(hackStyle)
      .setDisabled(hackDisabled)
  );
  
  // Rob training button
  let robLabel = 'Train Rob';
  let robDisabled = false;
  let robStyle = ButtonStyle.Primary;
  
  if (robInfo.maxLevel) {
    robLabel = 'Rob Maxed';
    robDisabled = true;
    robStyle = ButtonStyle.Secondary;
  } else if (robInfo.activeTraining) {
    const remaining = robInfo.activeTraining.endTime - Date.now();
    if (remaining > 0) {
      robLabel = `Training... ${formatDuration(remaining)}`;
      robDisabled = true;
      robStyle = ButtonStyle.Secondary;
    } else {
      robLabel = 'Claim Training';
      robStyle = ButtonStyle.Success;
    }
  } else if (robInfo.alreadyTrainedAtLevel) {
    robLabel = 'Level Up to Train';
    robDisabled = true;
    robStyle = ButtonStyle.Secondary;
  } else {
    robLabel = `Train Rob (${robInfo.cost.toLocaleString()})`;
  }
  
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('skills_train_rob')
      .setLabel(robLabel)
      .setEmoji('🔓')
      .setStyle(robStyle)
      .setDisabled(robDisabled)
  );
  
  // Refresh button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('skills_refresh')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );
  
  return row;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skills')
    .setDescription('View your hack and rob skill levels and train'),
  
  customIds: BUTTON_IDS,
  
  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    
    // Check for completed training first
    const hackTrainingResult = checkTrainingComplete(guildId, userId, 'hack');
    const robTrainingResult = checkTrainingComplete(guildId, userId, 'rob');
    
    // Get updated skills after training check
    const skills = getUserSkills(guildId, userId);
    const hackBonuses = getHackBonuses(guildId, userId);
    const robBonuses = getRobBonuses(guildId, userId);
    const hackProgress = getXpProgress(skills.hackXp);
    const robProgress = getXpProgress(skills.robXp);
    
    // Training completion notifications
    let notifications = [];
    if (hackTrainingResult) {
      notifications.push(`✅ **Hack training complete!** +${hackTrainingResult.xpGained} XP${hackTrainingResult.levelUp ? ` → **Level ${hackTrainingResult.newLevel}!**` : ''}`);
    }
    if (robTrainingResult) {
      notifications.push(`✅ **Rob training complete!** +${robTrainingResult.xpGained} XP${robTrainingResult.levelUp ? ` → **Level ${robTrainingResult.newLevel}!**` : ''}`);
    }
    
    const embed = buildSkillsEmbed(interaction, skills, hackBonuses, robBonuses, hackProgress, robProgress, notifications);
    const buttons = buildTrainingButtons(guildId, userId);
    
    await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: true });
  },
  
  async handleButton(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const customId = interaction.customId;
    
    // Handle refresh
    if (customId === 'skills_refresh') {
      // Check for completed training first
      const hackTrainingResult = checkTrainingComplete(guildId, userId, 'hack');
      const robTrainingResult = checkTrainingComplete(guildId, userId, 'rob');
      
      const skills = getUserSkills(guildId, userId);
      const hackBonuses = getHackBonuses(guildId, userId);
      const robBonuses = getRobBonuses(guildId, userId);
      const hackProgress = getXpProgress(skills.hackXp);
      const robProgress = getXpProgress(skills.robXp);
      
      let notifications = [];
      if (hackTrainingResult) {
        notifications.push(`✅ **Hack training complete!** +${hackTrainingResult.xpGained} XP${hackTrainingResult.levelUp ? ` → **Level ${hackTrainingResult.newLevel}!**` : ''}`);
      }
      if (robTrainingResult) {
        notifications.push(`✅ **Rob training complete!** +${robTrainingResult.xpGained} XP${robTrainingResult.levelUp ? ` → **Level ${robTrainingResult.newLevel}!**` : ''}`);
      }
      
      const embed = buildSkillsEmbed(interaction, skills, hackBonuses, robBonuses, hackProgress, robProgress, notifications);
      const buttons = buildTrainingButtons(guildId, userId);
      
      return interaction.update({ embeds: [embed], components: [buttons] });
    }
    
    // Handle training buttons
    const skill = customId === 'skills_train_hack' ? 'hack' : 'rob';
    const skillName = skill === 'hack' ? 'Hacking' : 'Robbing';
    const skillEmoji = skill === 'hack' ? '💻' : '🔓';
    
    // Check for completed training first
    const trainingResult = checkTrainingComplete(guildId, userId, skill);
    
    // If we just claimed training, update the panel and show result
    if (trainingResult) {
      const skills = getUserSkills(guildId, userId);
      const hackBonuses = getHackBonuses(guildId, userId);
      const robBonuses = getRobBonuses(guildId, userId);
      const hackProgress = getXpProgress(skills.hackXp);
      const robProgress = getXpProgress(skills.robXp);
      
      const notifications = [`✅ **${skillName} training complete!** +${trainingResult.xpGained} XP${trainingResult.levelUp ? ` → **Level ${trainingResult.newLevel}!**` : ''}`];
      
      const embed = buildSkillsEmbed(interaction, skills, hackBonuses, robBonuses, hackProgress, robProgress, notifications);
      const buttons = buildTrainingButtons(guildId, userId);
      
      return interaction.update({ embeds: [embed], components: [buttons] });
    }
    
    // Get training info
    const trainingInfo = getTrainingInfo(guildId, userId, skill);
    
    // Check if already at max level
    if (trainingInfo.maxLevel) {
      return interaction.reply({
        content: `${skillEmoji} You've already mastered ${skillName}! (Level 10)`,
        ephemeral: true
      });
    }
    
    // Check if already trained at this level
    if (trainingInfo.alreadyTrainedAtLevel) {
      return interaction.reply({
        content: `${skillEmoji} You've already trained ${skillName} at this level!\n\nUse \`/hack\` or \`/rob\` to earn XP and level up before training again.`,
        ephemeral: true
      });
    }
    
    // Check if already training (shouldn't happen with disabled buttons, but safety check)
    if (trainingInfo.activeTraining && trainingInfo.activeTraining.endTime > Date.now()) {
      const remaining = trainingInfo.activeTraining.endTime - Date.now();
      return interaction.reply({
        content: `${skillEmoji} You're already training ${skillName}! ${formatDuration(remaining)} remaining.`,
        ephemeral: true
      });
    }
    
    // Check if user can afford training
    const balance = getBalance(guildId, userId);
    if (balance.cash < trainingInfo.cost) {
      return interaction.reply({
        content: `${skillEmoji} You need **${trainingInfo.cost.toLocaleString()}** ${CURRENCY} to train ${skillName}.\n` +
          `Your cash: **${balance.cash.toLocaleString()}** ${CURRENCY} (need **${(trainingInfo.cost - balance.cash).toLocaleString()}** more)`,
        ephemeral: true
      });
    }
    
    // Deduct cost and start training
    addMoney(guildId, userId, -trainingInfo.cost, 'cash');
    const result = startTraining(guildId, userId, skill);
    
    if (!result.success) {
      // Refund if something went wrong
      addMoney(guildId, userId, trainingInfo.cost, 'cash');
      return interaction.reply({
        content: `❌ Failed to start training: ${result.error}`,
        ephemeral: true
      });
    }
    
    // Build success message
    let successMsg = `${skillEmoji} **${skillName} Training Started!**\n\n` +
      `💰 Cost: **${result.cost.toLocaleString()}** ${CURRENCY}\n` +
      `⏰ Duration: **${formatDuration(result.duration)}**\n` +
      `📈 XP Reward: **+${result.xpReward}** XP\n` +
      `🎯 Training for: **Level ${result.nextLevel}**\n\n` +
      `*You can only train once per level. Use \`/hack\` or \`/rob\` to earn XP!*`;
    
    // Update the panel
    const skills = getUserSkills(guildId, userId);
    const hackBonuses = getHackBonuses(guildId, userId);
    const robBonuses = getRobBonuses(guildId, userId);
    const hackProgress = getXpProgress(skills.hackXp);
    const robProgress = getXpProgress(skills.robXp);
    
    const embed = buildSkillsEmbed(interaction, skills, hackBonuses, robBonuses, hackProgress, robProgress, []);
    const buttons = buildTrainingButtons(guildId, userId);
    
    // Send confirmation and update panel
    await interaction.reply({ content: successMsg, ephemeral: true });
    
    // Update the original message with new button states
    try {
      await interaction.message.edit({ embeds: [embed], components: [buttons] });
    } catch (e) {
      // Original message may have been deleted, ignore
    }
  }
};
