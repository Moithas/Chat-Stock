const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, removeMoney, forceRemoveMoney, addMoney, applyFine, getPlayerCreatedAt } = require('../economy');
const { getRobSettings, canRob, canBeRobbed, canRobTarget, recordTargetRobbed, recordGiftProtection, checkGiftProtection, calculateSuccessRate, attemptRob, calculateStolenAmount, calculateFine, recordRob, isUserImmune, hasActiveImmunity } = require('../rob');
const { getRobBonuses, addXp, checkTrainingComplete } = require('../skills');
const { hasActiveEffect, getEffectValue, EFFECT_TYPES } = require('../items');
const { getLuckyPennyEffect, LP_EFFECT_TYPES } = require('../luckypenny');
const { getInfamySettings, getTierEffects, addInfamy, rollBountyCheck, createBounty, getActiveBounty, claimBounty, startProbation, announceBountyPosted, announceBountyClaimed } = require('../infamy');
const { addMoney: addMoneyForBounty } = require('../economy');
const { getCurrency, getAdminSettings } = require('../admin');
const { applyIncomeMultiplier, getPrestigeEmoji } = require('../prestige');
const { getPetBonusDecimal } = require('../pets');



// Flavor texts for various scenarios
const FLAVOR_TEXTS = {
  robSuccess: [
    "You managed to slip past {target} and grab their cash!",
    "{target} didn't notice as you pocketed their money!",
    "You successfully picked {target}'s pocket!",
    "{target} was too distracted to notice you stealing their cash!",
    "You sneaky thief! You robbed {target} blind!",
    "Stealth mode activated! You stole from {target}!",
    "{target} never saw it coming!"
  ],
  robFail: [
    "You got caught red-handed trying to rob {target}!",
    "{target} caught you stealing and turned you in!",
    "Security caught you attempting to rob {target}!",
    "You're not as sneaky as you thought! Caught by {target}!",
    "{target} fought back and you got arrested!",
    "Alarm! {target} triggered the police on you!",
    "You failed miserably at robbing {target}!"
  ],
  hideCashSuccess: [
    "{target}'s cash is well hidden - you found nothing!",
    "{target} had already hidden their cash. Smart move!",
    "You can't find the cash - {target} hid it too well!",
    "{target} outsmarted you by hiding everything!",
    "Empty pockets! {target} successfully hid their money!"
  ],
  hideCashFail: [
    "{target} tried to hide their cash but you found it anyway!",
    "{target}'s hiding spot was too obvious!",
    "You found {target}'s secret stash!",
    "{target} didn't hide their cash very well!",
    "You located {target}'s hidden money!"
  ],
  hideCashFailRobFail: [
    "{target}'s defense didn't work, but you got caught anyway!",
    "You broke through {target}'s hiding spot, but guards caught you!",
    "{target} tried to hide their money, but so did you... from the police!",
    "You found {target}'s cash, but security found you first!",
    "{target}'s defense was useless when you got arrested!"
  ],
  dodgeSuccess: [
    "{target} saw you coming and dodged out of the way!",
    "{target} was too quick! They got away some of your cash!",
    "{target} pulled an impressive dodge and stole some of your cash instead!",
    "You lunged but {target} was faster!",
    "{target} Matrix-dodged your robbery attempt!"
  ],
  dodgeFail: [
    "{target} tried to dodge but you caught them anyway!",
    "{target}'s dodge was too slow!",
    "You anticipated {target}'s movement and caught them!",
    "{target} failed their dodge and got got!",
    "{target}'s evasion didn't work against you!"
  ],
  dodgeFailRobFail: [
    "{target} couldn't dodge fast enough, but neither could you escape!",
    "You caught {target} mid-dodge, but got caught yourself!",
    "{target}'s dodge failed, and so did your escape!",
    "You tackled {target}, but the cops tackled you!",
    "{target}'s dodge was useless when you both got arrested!"
  ],
  fightBackSuccess: [
    "{target} fought back hard and you lost your stolen cash!",
    "{target} threw a punch and knocked the money out of your hands!",
    "{target} overpowered you and got their money back!",
    "You underestimated {target}'s strength!",
    "{target} turned the tables and you lost everything!"
  ],
  fightBackFail: [
    "You overpowered {target}'s counterattack!",
    "{target} tried to fight back but you were too strong!",
    "{target}'s attempt to fight back failed!",
    "You blocked {target}'s attack and took the money!",
    "{target} wasn't strong enough to stop you!"
  ],
  fightBackFailRobFail: [
    "{target} couldn't fight you off, but the law did!",
    "You overpowered {target}, but the police overpowered you!",
    "{target} was helpless, but so were you against the cops!",
    "You beat {target}'s defense, but lost to justice!",
    "{target} couldn't stop you, but {target}'s friends could!"
  ]
};

function getRandomFlavor(textArray) {
  return textArray[Math.floor(Math.random() * textArray.length)];
}

function getTimeScaledSuccessRate(defenseSuccessRate, elapsedSeconds, windowSeconds = 10) {
  // Splits the defense window into 3 equal segments:
  // First third: 100% of base rate
  // Second third: 75% of base rate
  // Final third: 50% of base rate
  const third = windowSeconds / 3;
  if (elapsedSeconds < third) return defenseSuccessRate;
  if (elapsedSeconds < third * 2) return defenseSuccessRate * 0.75;
  return defenseSuccessRate * 0.5;
}

function createDefenseButtons(robberId) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`rob_defend_hidecash_${robberId}`)
        .setLabel('Hide Cash')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🙈'),
      new ButtonBuilder()
        .setCustomId(`rob_defend_dodge_${robberId}`)
        .setLabel('Dodge')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💨'),
      new ButtonBuilder()
        .setCustomId(`rob_defend_fightback_${robberId}`)
        .setLabel('Fight Back')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🥊')
    );
}

// Helper: apply infamy earnings cut to stolen amount
function applyInfamyEarningsCut(stolenAmount, tierEffects) {
  const earningsCut = tierEffects.earningsCut || 0;
  if (earningsCut > 0) {
    return Math.floor(stolenAmount * (1 - earningsCut / 100));
  }
  return stolenAmount;
}

// Helper: process infamy gain, bounty claim/roll after a successful rob
async function processRobInfamy(guildId, robberId, targetId, stolenAmount, interaction) {
  const settings = getInfamySettings(guildId);
  if (!settings.enabled) return { infamyGained: 0, bountyClaimed: null, bountyPosted: null };
  
  // Gain infamy
  const infamyGained = Math.round(stolenAmount * settings.rob_rate);
  if (infamyGained > 0) {
    addInfamy(guildId, robberId, infamyGained, 'rob');
  }
  
  let bountyClaimed = null;
  let bountyPosted = null;
  
  // Check if target has a bounty the robber can claim
  const targetBounty = getActiveBounty(guildId, targetId);
  if (targetBounty) {
    bountyClaimed = claimBounty(guildId, targetId, robberId, 'rob');
    if (bountyClaimed) {
      await addMoneyForBounty(guildId, robberId, bountyClaimed.bounty_amount, 'Bounty claimed (rob)');
      startProbation(guildId, targetId);
      announceBountyClaimed(guildId, targetId, robberId, bountyClaimed.bounty_amount, 'rob');
      
      // Public notification in channel
      try {
        const { EmbedBuilder } = require('discord.js');
        await interaction.followUp({ embeds: [new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle('🏆 Bounty Claimed!')
          .setDescription(`<@${robberId}> claimed the bounty on <@${targetId}>!\n\n💰 **Reward:** ${bountyClaimed.bounty_amount.toLocaleString()} ${getCurrency(guildId)}\n⚔️ **Method:** 💰 Rob\n\n⚖️ <@${targetId}> is now on **probation** — infamy reset to 0 but tier penalties remain.`)
          .setTimestamp()] });
      } catch (e) {}
    }
  }
  
  // Roll for bounty on robber
  if (!bountyClaimed && rollBountyCheck(guildId, robberId)) {
    const newBounty = createBounty(guildId, robberId);
    if (newBounty) {
      bountyPosted = newBounty;
      announceBountyPosted(guildId, robberId, newBounty.bountyAmount);
      
      // Public notification in channel
      try {
        const { EmbedBuilder } = require('discord.js');
        await interaction.followUp({ embeds: [new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🚨 BOUNTY POSTED!')
          .setDescription(`A bounty has been placed on <@${robberId}>!\n\n💰 **Bounty: ${newBounty.bountyAmount.toLocaleString()}** ${getCurrency(guildId)}\n\n*Successfully hack or rob this player to claim the bounty!*`)
          .setFooter({ text: 'Check /leaderboard → Bounty Board for all active bounties' })
          .setTimestamp()] });
      } catch (e) {}
    }
  }
  
  return { infamyGained, bountyClaimed, bountyPosted };
}

// Helper: apply infamy fine modifier  
function applyInfamyFineModifier(fine, tierEffects) {
  const fineModifier = tierEffects.fineModifier || 0;
  if (fineModifier > 0) {
    return Math.floor(fine * (1 + fineModifier / 100));
  }
  return fine;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Attempt to rob another user\'s cash')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user you want to rob')
        .setRequired(true)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const robberId = interaction.user.id;
    const targetUser = interaction.options.getUser('target');
    const targetId = targetUser.id;

    // Check if trying to rob self
    if (robberId === targetId) {
      return interaction.reply({
        content: '❌ You can\'t rob yourself! That\'s just moving money between pockets.'
      });
    }

    // Check if trying to rob a bot
    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ You can\'t rob bots! They don\'t carry cash.'
      });
    }

    const settings = getRobSettings(guildId);

    // Check if robbing is enabled
    if (!settings.enabled) {
      return interaction.reply({
        content: '❌ Robbing is currently disabled on this server.'
      });
    }

    // Check if target has an immune role
    const targetMember = interaction.guild.members.cache.get(targetId) || await interaction.guild.members.fetch(targetId).catch(() => null);
    if (targetMember) {
      const targetRoles = targetMember.roles.cache.map(role => role.id);
      if (isUserImmune(guildId, targetRoles)) {
        return interaction.reply({
          content: `❌ **${targetUser.username}** has rob immunity and cannot be robbed!`
        });
      }
    }
    
    // Check new player immunity
    const adminSettings = getAdminSettings(guildId);
    if (adminSettings.newPlayerImmunityDays > 0) {
      const targetCreatedAt = getPlayerCreatedAt(guildId, targetId);
      if (targetCreatedAt > 0) {
        const immunityMs = adminSettings.newPlayerImmunityDays * 24 * 60 * 60 * 1000;
        const immunityEnds = targetCreatedAt + immunityMs;
        if (Date.now() < immunityEnds) {
          return interaction.reply({
            content: `❌ **${targetUser.username}** is a new player and has rob immunity until <t:${Math.floor(immunityEnds / 1000)}:R>.`
          });
        }
      }
    }

    // Check if target has purchased immunity
    if (hasActiveImmunity(guildId, targetId)) {
      return interaction.reply({
        content: `❌ **${targetUser.username}** has purchased rob protection and cannot be robbed!`
      });
    }
    
    // Check if target has item-based rob protection (100% = full immunity)
    const robProtectionValue = getEffectValue(guildId, targetId, EFFECT_TYPES.ROB_PROTECTION);
    if (robProtectionValue >= 100) {
      return interaction.reply({
        content: `❌ **${targetUser.username}** has a 🛡️ **Bodyguard** protecting them and cannot be robbed!`
      });
    }

    // Check if target was recently robbed (target cooldown)
    const targetCooldownCheck = canBeRobbed(guildId, targetId);
    if (!targetCooldownCheck.canBeRobbed) {
      return interaction.reply({
        content: `❌ ${targetCooldownCheck.reason}`
      });
    }

    // Record target protection immediately to prevent simultaneous robs
    recordTargetRobbed(guildId, targetId);

    // Check if this target counts for XP (anti-farming - still allows rob, just no XP)
    const uniqueTargetCheck = canRobTarget(guildId, robberId, targetId);
    const awardsXp = uniqueTargetCheck.canRob;

    // Check for completed training and get skill bonuses
    const trainingResult = checkTrainingComplete(guildId, robberId, 'rob');
    const robBonuses = getRobBonuses(guildId, robberId);

    // Check gift protection (prevent exploitation)
    const giftProtection = checkGiftProtection(guildId, robberId, targetId);
    if (!giftProtection.canRob) {
      let response = `❌ ${giftProtection.reason}`;
      if (trainingResult) {
        response = `✅ **Rob training complete!** +${trainingResult.xpGained} XP${trainingResult.levelUp ? ` → **Level ${trainingResult.newLevel}!**` : ''}\n\n` + response;
      }
      return interaction.reply({ content: response });
    }

    // Check cooldown (with skill reduction + LP buff)
    const lpRobCooldown = getLuckyPennyEffect(guildId, robberId, LP_EFFECT_TYPES.ROB_COOLDOWN);
    const totalRobCooldownReduction = robBonuses.cooldownReduction + (-lpRobCooldown);
    const cooldownCheck = canRob(guildId, robberId, totalRobCooldownReduction);
    if (!cooldownCheck.canRob) {
      let response = `❌ ${cooldownCheck.reason}`;
      if (trainingResult) {
        response = `✅ **Rob training complete!** +${trainingResult.xpGained} XP${trainingResult.levelUp ? ` → **Level ${trainingResult.newLevel}!**` : ''}\n\n` + response;
      }
      return interaction.reply({ content: response });
    }

    // Get balances
    const robberBalance = getBalance(guildId, robberId);
    const targetBalance = getBalance(guildId, targetId);

    // Check if target has bank debt or cash debt - can't rob players in debt
    if (targetBalance.bank < 0 || targetBalance.cash < 0) {
      return interaction.reply({
        content: `❌ You cannot rob ${targetUser.username} - they are in debt!`
      });
    }

    // Check if target has any cash to steal
    if (targetBalance.cash === 0) {
      return interaction.reply({
        content: `❌ ${targetUser.username} has no cash to steal! They're broke.`
      });
    }

    // Calculate success rate (with skill bonus, item bonus, LP buff, target defense, and pet bonuses)
    const itemSuccessBoost = getEffectValue(guildId, robberId, EFFECT_TYPES.ROB_SUCCESS_BOOST);
    const lpRobSuccess = getLuckyPennyEffect(guildId, robberId, LP_EFFECT_TYPES.ROB_SUCCESS);
    const targetRobDefense = getEffectValue(guildId, targetId, EFFECT_TYPES.ROB_DEFENSE);
    const petRobOffense = getPetBonusDecimal(guildId, robberId, 'rob_offense') * 100;
    const petRobDefense = getPetBonusDecimal(guildId, targetId, 'rob_defense') * 100;
    const totalSuccessBonus = robBonuses.successRateBonus + itemSuccessBoost + lpRobSuccess + petRobOffense - targetRobDefense - petRobDefense;
    const successRate = calculateSuccessRate(targetBalance.cash, robberBalance.total, totalSuccessBonus);

    // Get infamy tier effects for success buff
    const robberTierEffects = getTierEffects(guildId, robberId);
    const infamySuccessBuff = robberTierEffects.successBuff || 0;
    const adjustedSuccessRate = Math.min(95, successRate + infamySuccessBuff);

    // Build training notification if applicable
    let trainingNotification = '';
    if (trainingResult) {
      trainingNotification = `✅ **Rob training complete!** +${trainingResult.xpGained} XP${trainingResult.levelUp ? ` → **Level ${trainingResult.newLevel}!**` : ''}\n\n`;
    }

    // Record that this target is being robbed (target cooldown already started above)

    // Check if defenses are enabled and send defense prompt
    if (settings.defensesEnabled) {
      // Reply immediately to acknowledge the command
      await interaction.reply({ content: `🔫 ${interaction.user.username} is attempting to rob ${targetUser.username}...` });
      
      const row = createDefenseButtons(robberId);

      // Send defense prompt to channel
      const defenseEmbed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('🚨 ROBBERY IN PROGRESS!')
        .setDescription(`<@${targetId}> is being robbed by ${interaction.user.username}! Choose a defense within ${settings.defenseWindowSeconds} seconds:`)
        .addFields(
          { name: '🙈 Hide Cash', value: `${settings.hidecashSuccessRate}% success - No money changes hands if you succeed`, inline: true },
          { name: '💨 Dodge', value: `${settings.dodgeSuccessRate}% success - Get 15% of what they'd steal if you succeed`, inline: true },
          { name: '🥊 Fight Back', value: `${settings.fightBackSuccessRate}% success - Get 30% of what they'd steal if you succeed`, inline: true }
        )
        .setFooter({ text: 'Your success chance decreases the longer you wait!' })
        .setTimestamp();

      const startTime = Date.now();
      let defenseResponse = null;

      try {
        const defenseMessage = await interaction.channel.send({ content: `<@${targetId}>`, embeds: [defenseEmbed], components: [row] });
        
        // Wait for button click with configurable timeout
        const filter = i => i.customId.startsWith('rob_defend_') && i.customId.includes(`_${robberId}`) && i.user.id === targetId;
        const collected = await defenseMessage.awaitMessageComponent({ filter, time: settings.defenseWindowSeconds * 1000 }).catch(() => null);
        
        if (collected) {
          // Acknowledge the button interaction to avoid expiration
          await collected.deferUpdate();

          // Lock buttons to prevent further clicks
          try {
            for (const btn of row.components) btn.setDisabled(true);
            await collected.message.edit({ components: [row] });
          } catch {}

          defenseResponse = collected.customId.split('_')[2]; // Extract defense type
          const elapsedMs = Date.now() - startTime;
          const elapsedSeconds = Math.floor(elapsedMs / 1000);

          // Announce the chosen defense in the channel
          await interaction.channel.send({ content: `<@${targetId}> chose to **${defenseResponse}**!` });

          // Process defense based on elapsed time
          await processDefense(interaction, guildId, robberId, targetId, targetUser, targetBalance, robberBalance, defenseResponse, elapsedSeconds, settings, robBonuses, awardsXp, robProtectionValue);
          return;
        } else {
          // Timeout: lock buttons to avoid late clicks
          try {
            for (const btn of row.components) btn.setDisabled(true);
            await defenseMessage.edit({ components: [row] });
          } catch {}
          
          // No defense chosen - announce timeout and proceed with normal rob
          await interaction.channel.send({ content: `⏱️ <@${targetId}> didn't defend in time!` });
          
          // Process the rob after timeout (no defense)
          const timeoutSuccess = attemptRob(adjustedSuccessRate);
          const timeoutEmbed = new EmbedBuilder().setTimestamp();

          if (timeoutSuccess) {
            const stolenAmount = calculateStolenAmount(targetBalance.cash, settings, robBonuses.minStealBonus, robBonuses.maxStealBonus);
            let actualStolen = Math.min(stolenAmount, targetBalance.cash);
            
            // Apply rob protection reduction (if target has partial protection)
            if (robProtectionValue > 0 && robProtectionValue < 100) {
              actualStolen = Math.floor(actualStolen * (1 - robProtectionValue / 100));
            }

            // Apply infamy earnings cut
            actualStolen = applyInfamyEarningsCut(actualStolen, robberTierEffects);

            await forceRemoveMoney(guildId, targetId, actualStolen, `Robbed by ${interaction.user.username}`);
            const robPrestigeAmount = applyIncomeMultiplier(guildId, robberId, actualStolen);
            await addMoney(guildId, robberId, robPrestigeAmount, `Stole from ${targetUser.username}`);
            recordRob(guildId, robberId, targetId, true, actualStolen);
            
            // Process infamy gain, bounty claim/roll
            const infamyResult = await processRobInfamy(guildId, robberId, targetId, actualStolen, interaction);
            
            // Award success XP (only if unique target)
            const xpResult = awardsXp 
              ? addXp(guildId, robberId, 'rob', 0, true, actualStolen)
              : { xpGained: 0, levelUp: false };

            const stealPercent = Math.round((actualStolen / targetBalance.cash) * 100);
            const flavorText = getRandomFlavor(FLAVOR_TEXTS.robSuccess).replaceAll('{target}', `**${targetUser.username}**`);

            const xpFooter = awardsXp 
              ? `+${xpResult.xpGained} Rob XP${xpResult.levelUp ? ` • LEVEL UP → ${xpResult.newLevel}!` : ''}`
              : `No XP (farm target same person less)`;

            const protectionNote = robProtectionValue > 0 && robProtectionValue < 100 
              ? ` (🛡️ ${robProtectionValue}% protected)`
              : '';

            const tierIndicator = robberTierEffects.tier >= 1 ? ` ${robberTierEffects.emoji}` : '';

            const prestigeNoteTimeout = robPrestigeAmount > actualStolen ? ` (${getPrestigeEmoji(guildId, robberId)} +${Math.round((robPrestigeAmount / actualStolen - 1) * 100)}% prestige)` : '';

            timeoutEmbed
              .setColor(0x2ecc71)
              .setTitle(`💰 Rob Successful!${tierIndicator}`)
              .setDescription(flavorText)
              .addFields(
                { name: '💵 Stolen', value: `${robPrestigeAmount.toLocaleString()} ${getCurrency(guildId)} (${stealPercent}% of their cash)${protectionNote}${robberTierEffects.earningsCut > 0 ? `\n🏴‍☠️ Earnings cut: -${robberTierEffects.earningsCut}%` : ''}${prestigeNoteTimeout}`, inline: true },
                { name: '📊 Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${infamySuccessBuff > 0 ? ` (+${infamySuccessBuff}% infamy)` : ''}${petRobOffense > 0 ? ` (🐾 +${petRobOffense.toFixed(1)}%)` : ''}${petRobDefense > 0 ? `\n🛡️ Target pet: -${petRobDefense.toFixed(1)}%` : ''}`, inline: true },
                { name: '💼 Your New Balance', value: `${(robberBalance.cash + robPrestigeAmount).toLocaleString()} ${getCurrency(guildId)}${infamyResult.bountyClaimed ? `\n🏆 +${infamyResult.bountyClaimed.bounty_amount.toLocaleString()} bounty` : ''}`, inline: false }
              )
              .setFooter({ text: xpFooter });
          } else {
            const itemFineReduction = getEffectValue(guildId, robberId, EFFECT_TYPES.ROB_FINE_REDUCTION);
            const lpRobFine = getLuckyPennyEffect(guildId, robberId, LP_EFFECT_TYPES.ROB_FINES);
            const totalFineReduction = robBonuses.fineReduction + itemFineReduction + (-lpRobFine);
            let fine = calculateFine(robberBalance.total, settings, totalFineReduction);
            fine = applyInfamyFineModifier(fine, robberTierEffects);
            await applyFine(guildId, robberId, fine, `Failed rob attempt on ${targetUser.username}`);
            recordRob(guildId, robberId, targetId, false, fine);
            
            // Award failure XP (only if unique target)
            const xpResult = awardsXp 
              ? addXp(guildId, robberId, 'rob', 0, false)
              : { xpGained: 0, levelUp: false };

            const finePercent = robberBalance.total > 0 ? Math.round((fine / robberBalance.total) * 100) : 0;
            const flavorText = getRandomFlavor(FLAVOR_TEXTS.robFail).replaceAll('{target}', `**${targetUser.username}**`);

            const xpFooter = awardsXp 
              ? `+${xpResult.xpGained} Rob XP • Better luck next time!`
              : `No XP (target unique people) • Better luck next time!`;

            timeoutEmbed
              .setColor(0xe74c3c)
              .setTitle('🚨 Rob Failed!')
              .setDescription(flavorText)
              .addFields(
                { name: '💸 Fine', value: `${fine.toLocaleString()} ${getCurrency(guildId)} (${finePercent}% of your balance)${robberTierEffects.fineModifier > 0 ? `\n🏴‍☠️ Fine modifier: +${robberTierEffects.fineModifier}%` : ''}`, inline: true },
                { name: '📊 Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${infamySuccessBuff > 0 ? ` (+${infamySuccessBuff}% infamy)` : ''}${petRobOffense > 0 ? ` (🐾 +${petRobOffense.toFixed(1)}%)` : ''}${petRobDefense > 0 ? `\n🛡️ Target pet: -${petRobDefense.toFixed(1)}%` : ''}`, inline: true },
                { name: '💼 Your New Balance', value: `${(robberBalance.total - fine).toLocaleString()} ${getCurrency(guildId)}`, inline: false }
              )
              .setFooter({ text: xpFooter });
          }

          await interaction.channel.send({ embeds: [timeoutEmbed] });
          return;
        }
      } catch (error) {
        console.error('Error sending rob defense notification:', error);
      }
      return;
    }

    // Defenses disabled OR no defense response received - proceed with normal rob
    const success = attemptRob(adjustedSuccessRate);

    const embed = new EmbedBuilder()
      .setTimestamp();

    if (success) {
      // Calculate stolen amount (with skill bonuses)
      const stolenAmount = calculateStolenAmount(targetBalance.cash, settings, robBonuses.minStealBonus, robBonuses.maxStealBonus);
      let actualStolen = Math.min(stolenAmount, targetBalance.cash);
      
      // Apply rob protection reduction (if target has partial protection)
      if (robProtectionValue > 0 && robProtectionValue < 100) {
        actualStolen = Math.floor(actualStolen * (1 - robProtectionValue / 100));
      }

      // Apply infamy earnings cut
      actualStolen = applyInfamyEarningsCut(actualStolen, robberTierEffects);

      // Transfer money
      await forceRemoveMoney(guildId, targetId, actualStolen, `Robbed by ${interaction.user.username}`);
      const robPrestigeAmount2 = applyIncomeMultiplier(guildId, robberId, actualStolen);
      await addMoney(guildId, robberId, robPrestigeAmount2, `Stole from ${targetUser.username}`);

      // Record the rob
      recordRob(guildId, robberId, targetId, true, actualStolen);
      
      // Process infamy gain, bounty claim/roll
      const infamyResult = await processRobInfamy(guildId, robberId, targetId, actualStolen, interaction);
      
      // Award success XP (only if unique target)
      const xpResult = awardsXp 
        ? addXp(guildId, robberId, 'rob', 0, true, actualStolen)
        : { xpGained: 0, levelUp: false };

      const stealPercent = Math.round((actualStolen / targetBalance.cash) * 100);
      const flavorText = getRandomFlavor(FLAVOR_TEXTS.robSuccess).replaceAll('{target}', `**${targetUser.username}**`);

      const xpFooter = awardsXp 
        ? `+${xpResult.xpGained} Rob XP${xpResult.levelUp ? ` • LEVEL UP → ${xpResult.newLevel}!` : ''}`
        : `No XP (target unique people)`;

      const protectionNote = robProtectionValue > 0 && robProtectionValue < 100 
        ? ` (🛡️ ${robProtectionValue}% protected)`
        : '';

      const tierIndicator = robberTierEffects.tier >= 1 ? ` ${robberTierEffects.emoji}` : '';

      const prestigeNote2 = robPrestigeAmount2 > actualStolen ? ` (${getPrestigeEmoji(guildId, robberId)} +${Math.round((robPrestigeAmount2 / actualStolen - 1) * 100)}% prestige)` : '';

      embed
        .setColor(0x2ecc71)
        .setTitle(`💰 Rob Successful!${tierIndicator}`)
        .setDescription(flavorText)
        .addFields(
          { name: '💵 Stolen', value: `${robPrestigeAmount2.toLocaleString()} ${getCurrency(guildId)} (${stealPercent}% of their cash)${protectionNote}${robberTierEffects.earningsCut > 0 ? `\n🏴‍☠️ Earnings cut: -${robberTierEffects.earningsCut}%` : ''}${prestigeNote2}`, inline: true },
          { name: '📊 Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${infamySuccessBuff > 0 ? ` (+${infamySuccessBuff}% infamy)` : ''}${petRobOffense > 0 ? ` (🐾 +${petRobOffense.toFixed(1)}%)` : ''}${petRobDefense > 0 ? `\n🛡️ Target pet: -${petRobDefense.toFixed(1)}%` : ''}`, inline: true },
          { name: '💼 Your New Balance', value: `${(robberBalance.cash + robPrestigeAmount2).toLocaleString()} ${getCurrency(guildId)}${infamyResult.bountyClaimed ? `\n🏆 +${infamyResult.bountyClaimed.bounty_amount.toLocaleString()} bounty` : ''}`, inline: false }
        )
        .setFooter({ text: xpFooter });

      await interaction.reply({ content: trainingNotification || null, embeds: [embed] });
    } else {
      // Rob failed - calculate fine (with skill reduction, item reduction, and LP buff)
      const itemFineReduction2 = getEffectValue(guildId, robberId, EFFECT_TYPES.ROB_FINE_REDUCTION);
      const lpRobFine2 = getLuckyPennyEffect(guildId, robberId, LP_EFFECT_TYPES.ROB_FINES);
      const totalFineReduction2 = robBonuses.fineReduction + itemFineReduction2 + (-lpRobFine2);
      let fine = calculateFine(robberBalance.total, settings, totalFineReduction2);
      fine = applyInfamyFineModifier(fine, robberTierEffects);

      // Apply fine (can put user into negative balance)
      await applyFine(guildId, robberId, fine, `Failed rob attempt on ${targetUser.username}`);

      // Record the failed rob
      recordRob(guildId, robberId, targetId, false, fine);
      
      // Award failure XP (only if unique target)
      const xpResult = awardsXp 
        ? addXp(guildId, robberId, 'rob', 0, false)
        : { xpGained: 0, levelUp: false };

      const finePercent = robberBalance.total > 0 ? Math.round((fine / robberBalance.total) * 100) : 0;
      const flavorText = getRandomFlavor(FLAVOR_TEXTS.robFail).replaceAll('{target}', `**${targetUser.username}**`);

      const xpFooter = awardsXp 
        ? `+${xpResult.xpGained} Rob XP • Better luck next time!`
        : `No XP (target unique people) • Better luck next time!`;

      embed
        .setColor(0xe74c3c)
        .setTitle('🚨 Rob Failed!')
        .setDescription(flavorText)
        .addFields(
          { name: '💸 Fine', value: `${fine.toLocaleString()} ${getCurrency(guildId)} (${finePercent}% of your balance)${robberTierEffects.fineModifier > 0 ? `\n🏴‍☠️ Fine modifier: +${robberTierEffects.fineModifier}%` : ''}`, inline: true },
          { name: '📊 Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${infamySuccessBuff > 0 ? ` (+${infamySuccessBuff}% infamy)` : ''}${petRobOffense > 0 ? ` (🐾 +${petRobOffense.toFixed(1)}%)` : ''}${petRobDefense > 0 ? `\n🛡️ Target pet: -${petRobDefense.toFixed(1)}%` : ''}`, inline: true },
          { name: '💼 Your New Balance', value: `${(robberBalance.total - fine).toLocaleString()} ${getCurrency(guildId)}`, inline: false }
        )
        .setFooter({ text: xpFooter });

      await interaction.reply({ content: trainingNotification || null, embeds: [embed] });
    }
  }
};

async function processDefense(interaction, guildId, robberId, targetId, targetUser, targetBalance, robberBalance, defenseType, elapsedSeconds, settings, robBonuses, awardsXp, robProtectionValue = 0) {
  const itemSuccessBoost = getEffectValue(guildId, robberId, EFFECT_TYPES.ROB_SUCCESS_BOOST);
  const lpRobSuccessDef = getLuckyPennyEffect(guildId, robberId, LP_EFFECT_TYPES.ROB_SUCCESS);
  const petRobOffenseDef = getPetBonusDecimal(guildId, robberId, 'rob_offense') * 100;
  const petRobDefenseDef = getPetBonusDecimal(guildId, targetId, 'rob_defense') * 100;
  const totalSuccessBonus = robBonuses.successRateBonus + itemSuccessBoost + lpRobSuccessDef + petRobOffenseDef - petRobDefenseDef;
  const successRate = calculateSuccessRate(targetBalance.cash, robberBalance.total, totalSuccessBonus);
  
  // Get infamy tier effects
  const robberTierEffects = getTierEffects(guildId, robberId);
  const infamySuccessBuff = robberTierEffects.successBuff || 0;
  const adjustedSuccessRate = Math.min(95, successRate + infamySuccessBuff);
  
  const stolenAmount = calculateStolenAmount(targetBalance.cash, settings, robBonuses.minStealBonus, robBonuses.maxStealBonus);
  let actualStolen = Math.min(stolenAmount, targetBalance.cash);
  
  // Apply rob protection reduction (if target has partial protection)
  if (robProtectionValue > 0 && robProtectionValue < 100) {
    actualStolen = Math.floor(actualStolen * (1 - robProtectionValue / 100));
  }
  
  // Apply infamy earnings cut
  actualStolen = applyInfamyEarningsCut(actualStolen, robberTierEffects);
  
  const itemFineReduction = getEffectValue(guildId, robberId, EFFECT_TYPES.ROB_FINE_REDUCTION);
  const lpRobFineDef = getLuckyPennyEffect(guildId, robberId, LP_EFFECT_TYPES.ROB_FINES);
  const totalFineReduction = robBonuses.fineReduction + itemFineReduction + (-lpRobFineDef);
  let fine = calculateFine(robberBalance.total, settings, totalFineReduction);
  fine = applyInfamyFineModifier(fine, robberTierEffects);
  
  // Variable to track XP result for footer
  let xpResult = null;
  let robSucceeded = false;
  let amountForXp = 0;

  const embed = new EmbedBuilder()
    .setTimestamp();

  let defenseSuccess = false;
  let defenseSuccessRate = 0;

  // Determine defense success based on type and time scaling
  if (defenseType === 'hidecash') {
    defenseSuccessRate = settings.hidecashSuccessRate;
  } else if (defenseType === 'dodge') {
    defenseSuccessRate = settings.dodgeSuccessRate;
  } else if (defenseType === 'fightback') {
    defenseSuccessRate = settings.fightBackSuccessRate;
  }

  const timeScaledRate = getTimeScaledSuccessRate(defenseSuccessRate, elapsedSeconds, settings.defenseWindowSeconds || 10);
  const roll = Math.random() * 100;
  defenseSuccess = roll < timeScaledRate;

  // Process outcome based on defense type and success
  if (defenseType === 'hidecash') {
    if (defenseSuccess) {
      const flavorText = getRandomFlavor(FLAVOR_TEXTS.hideCashSuccess).replaceAll('{target}', `**${targetUser.username}**`);
      
      embed
        .setColor(0x3498db)
        .setTitle('🙈 Hide Cash - Success!')
        .setDescription(flavorText)
        .addFields(
          { name: '💵 Money Saved', value: `${actualStolen.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '📊 Defense Success Rate', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
          { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
          { name: '💼 Your Balance', value: `${targetBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
        );

      // Record the successful defense
      recordRob(guildId, robberId, targetId, false, 0);
      robSucceeded = false;
    } else {
      // Defense failed - apply normal rob calculation
      const robSuccess = attemptRob(adjustedSuccessRate);
      
      if (robSuccess) {
        // Normal rob succeeds
        const flavorText = getRandomFlavor(FLAVOR_TEXTS.hideCashFail).replaceAll('{target}', `**${targetUser.username}**`);
        await forceRemoveMoney(guildId, targetId, actualStolen, `Robbed by ${interaction.user.username}`);
        const robPrestigeAmountHide = applyIncomeMultiplier(guildId, robberId, actualStolen);
        await addMoney(guildId, robberId, robPrestigeAmountHide, `Stole from ${targetUser.username}`);

        const protectionNote = robProtectionValue > 0 && robProtectionValue < 100 
          ? ` (🛡️ ${robProtectionValue}% protected)`
          : '';

        const prestigeNoteHide = robPrestigeAmountHide > actualStolen ? ` (${getPrestigeEmoji(guildId, robberId)} +${Math.round((robPrestigeAmountHide / actualStolen - 1) * 100)}% prestige)` : '';

        embed
          .setColor(0xe74c3c)
          .setTitle('🙈 Hide Cash - Failed!')
          .setDescription(flavorText)
          .addFields(
            { name: '💵 Money Stolen', value: `${actualStolen.toLocaleString()} ${getCurrency(guildId)}${protectionNote}${prestigeNoteHide}`, inline: true },
            { name: '📊 Defense Failed', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
            { name: '📊 Rob Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${petRobOffenseDef > 0 ? ` (🐾 +${petRobOffenseDef.toFixed(1)}%)` : ''}${petRobDefenseDef > 0 ? `\n🛡️ Target pet: -${petRobDefenseDef.toFixed(1)}%` : ''}`, inline: true },
            { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
            { name: '💼 Your Balance', value: `${(targetBalance.cash - actualStolen).toLocaleString()} ${getCurrency(guildId)}`, inline: false }
          );

        recordRob(guildId, robberId, targetId, true, actualStolen);
        robSucceeded = true;
        amountForXp = actualStolen;
      } else {
        // Normal rob fails - robber gets fined
        const flavorText = getRandomFlavor(FLAVOR_TEXTS.hideCashFailRobFail).replaceAll('{target}', `**${targetUser.username}**`);
        await applyFine(guildId, robberId, fine, `Failed rob attempt on ${targetUser.username}`);

        embed
          .setColor(0xf39c12)
          .setTitle('🙈 Hide Cash - Failed!')
          .setDescription(flavorText)
          .addFields(
            { name: '💸 Fine Applied', value: `${fine.toLocaleString()} ${getCurrency(guildId)}${robberTierEffects.fineModifier > 0 ? ` (+${robberTierEffects.fineModifier}% infamy)` : ''}`, inline: true },
            { name: '📊 Defense Failed', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
            { name: '📊 Rob Failed', value: `${adjustedSuccessRate.toFixed(1)}%`, inline: true },
            { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
            { name: '💼 Your Balance', value: `${targetBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
          );

        recordRob(guildId, robberId, targetId, false, fine);
        robSucceeded = false;
      }
    }
  } else if (defenseType === 'dodge') {
    if (defenseSuccess) {
      const gainAmount = Math.min(Math.floor(actualStolen * 0.15), 25000);
      const flavorText = getRandomFlavor(FLAVOR_TEXTS.dodgeSuccess).replaceAll('{target}', `**${targetUser.username}**`);

      // Prevent robbery; penalize robber and credit defender
      await applyFine(guildId, robberId, gainAmount, `Dodged by ${targetUser.username}`);
      await addMoney(guildId, targetId, gainAmount, `Dodged robbery from ${interaction.user.username}`);

      embed
        .setColor(0x3498db)
        .setTitle('💨 Dodge - Success!')
        .setDescription(flavorText)
        .addFields(
          { name: '💵 Money Saved', value: `${actualStolen.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '💸 Robber Lost', value: `${gainAmount.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '💰 Defender Gained', value: `${gainAmount.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '📊 Defense Success Rate', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
          { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
          { name: '💼 Your Balance', value: `${targetBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
        );

      // Record as successful defense
      recordRob(guildId, robberId, targetId, false, 0);
      robSucceeded = false;
    } else {
      // Defense failed - apply normal rob calculation
      const robSuccess = attemptRob(adjustedSuccessRate);
      
      if (robSuccess) {
        // Normal rob succeeds
        const flavorText = getRandomFlavor(FLAVOR_TEXTS.dodgeFail).replaceAll('{target}', `**${targetUser.username}**`);
        await forceRemoveMoney(guildId, targetId, actualStolen, `Robbed by ${interaction.user.username}`);
        const robPrestigeAmountDodge = applyIncomeMultiplier(guildId, robberId, actualStolen);
        await addMoney(guildId, robberId, robPrestigeAmountDodge, `Stole from ${targetUser.username}`);

        const protectionNoteDodge = robProtectionValue > 0 && robProtectionValue < 100 
          ? ` (🛡️ ${robProtectionValue}% protected)`
          : '';

        const prestigeNoteDodge = robPrestigeAmountDodge > actualStolen ? ` (${getPrestigeEmoji(guildId, robberId)} +${Math.round((robPrestigeAmountDodge / actualStolen - 1) * 100)}% prestige)` : '';

        embed
          .setColor(0xe74c3c)
          .setTitle('💨 Dodge - Failed!')
          .setDescription(flavorText)
          .addFields(
            { name: '💵 Money Stolen', value: `${actualStolen.toLocaleString()} ${getCurrency(guildId)}${protectionNoteDodge}${prestigeNoteDodge}`, inline: true },
            { name: '📊 Defense Failed', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
            { name: '📊 Rob Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${petRobOffenseDef > 0 ? ` (🐾 +${petRobOffenseDef.toFixed(1)}%)` : ''}${petRobDefenseDef > 0 ? `\n🛡️ Target pet: -${petRobDefenseDef.toFixed(1)}%` : ''}`, inline: true },
            { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
            { name: '💼 Your Balance', value: `${(targetBalance.cash - actualStolen).toLocaleString()} ${getCurrency(guildId)}`, inline: false }
          );

        recordRob(guildId, robberId, targetId, true, actualStolen);
        robSucceeded = true;
        amountForXp = actualStolen;
      } else {
        // Normal rob fails - robber gets fined
        const flavorText = getRandomFlavor(FLAVOR_TEXTS.dodgeFailRobFail).replaceAll('{target}', `**${targetUser.username}**`);
        await applyFine(guildId, robberId, fine, `Failed rob attempt on ${targetUser.username}`);

        embed
          .setColor(0xf39c12)
          .setTitle('💨 Dodge - Failed!')
          .setDescription(flavorText)
          .addFields(
            { name: '💸 Fine Applied', value: `${fine.toLocaleString()} ${getCurrency(guildId)}${robberTierEffects.fineModifier > 0 ? ` (+${robberTierEffects.fineModifier}% infamy)` : ''}`, inline: true },
            { name: '📊 Defense Failed', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
            { name: '📊 Rob Failed', value: `${adjustedSuccessRate.toFixed(1)}%`, inline: true },
            { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
            { name: '💼 Your Balance', value: `${targetBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
          );

        recordRob(guildId, robberId, targetId, false, fine);
        robSucceeded = false;
      }
    }
  } else if (defenseType === 'fightback') {
    if (defenseSuccess) {
      const gainAmount = Math.min(Math.floor(actualStolen * 0.30), 50000);
      const flavorText = getRandomFlavor(FLAVOR_TEXTS.fightBackSuccess).replaceAll('{target}', `**${targetUser.username}**`);
      
      // Robber loses based on capped percentage of what they would have stolen
      await applyFine(guildId, robberId, gainAmount, `Lost to ${targetUser.username} during robbery attempt`);
      // Defender gains the capped amount from the robber
      await addMoney(guildId, targetId, gainAmount, `Won fight back against ${interaction.user.username}`);

      embed
        .setColor(0x3498db)
        .setTitle('🥊 Fight Back - Success!')
        .setDescription(flavorText)
        .addFields(
          { name: '💵 Money Saved', value: `${actualStolen.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '💸 Robber Lost', value: `${gainAmount.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '💰 Defender Gained', value: `${gainAmount.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
          { name: '📊 Defense Success Rate', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
          { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
          { name: '💼 Your Balance', value: `${targetBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
        );

      // Record the successful defense
      recordRob(guildId, robberId, targetId, false, 0);
      robSucceeded = false;
    } else {
      // Defense failed - apply normal rob calculation
      const robSuccess = attemptRob(adjustedSuccessRate);
      
      if (robSuccess) {
        // Normal rob succeeds
        const flavorText = getRandomFlavor(FLAVOR_TEXTS.fightBackFail).replaceAll('{target}', `**${targetUser.username}**`);
        await forceRemoveMoney(guildId, targetId, actualStolen, `Robbed by ${interaction.user.username}`);
        const robPrestigeAmountFight = applyIncomeMultiplier(guildId, robberId, actualStolen);
        await addMoney(guildId, robberId, robPrestigeAmountFight, `Stole from ${targetUser.username}`);

        const protectionNoteFight = robProtectionValue > 0 && robProtectionValue < 100 
          ? ` (🛡️ ${robProtectionValue}% protected)`
          : '';

        const prestigeNoteFight = robPrestigeAmountFight > actualStolen ? ` (${getPrestigeEmoji(guildId, robberId)} +${Math.round((robPrestigeAmountFight / actualStolen - 1) * 100)}% prestige)` : '';

        embed
          .setColor(0xe74c3c)
          .setTitle('🥊 Fight Back - Failed!')
          .setDescription(flavorText)
          .addFields(
            { name: '💵 Money Stolen', value: `${actualStolen.toLocaleString()} ${getCurrency(guildId)}${protectionNoteFight}${prestigeNoteFight}`, inline: true },
            { name: '📊 Defense Failed', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
            { name: '📊 Rob Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${petRobOffenseDef > 0 ? ` (🐾 +${petRobOffenseDef.toFixed(1)}%)` : ''}${petRobDefenseDef > 0 ? `\n🛡️ Target pet: -${petRobDefenseDef.toFixed(1)}%` : ''}`, inline: true },
            { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
            { name: '💼 Your Balance', value: `${(targetBalance.cash - actualStolen).toLocaleString()} ${getCurrency(guildId)}`, inline: false }
          );

        recordRob(guildId, robberId, targetId, true, actualStolen);
        robSucceeded = true;
        amountForXp = actualStolen;
      } else {
        // Normal rob fails - robber gets fined
        const flavorText = getRandomFlavor(FLAVOR_TEXTS.fightBackFailRobFail).replaceAll('{target}', `**${targetUser.username}**`);
        await applyFine(guildId, robberId, fine, `Failed rob attempt on ${targetUser.username}`);

        embed
          .setColor(0xf39c12)
          .setTitle('🥊 Fight Back - Failed!')
          .setDescription(flavorText)
          .addFields(
            { name: '💸 Fine Applied', value: `${fine.toLocaleString()} ${getCurrency(guildId)}${robberTierEffects.fineModifier > 0 ? ` (+${robberTierEffects.fineModifier}% infamy)` : ''}`, inline: true },
            { name: '📊 Defense Failed', value: `${timeScaledRate.toFixed(1)}%`, inline: true },
            { name: '📊 Rob Failed', value: `${adjustedSuccessRate.toFixed(1)}%`, inline: true },
            { name: '⏱️ Reaction Time', value: `${elapsedSeconds} seconds`, inline: true },
            { name: '💼 Your Balance', value: `${targetBalance.cash.toLocaleString()} ${getCurrency(guildId)}`, inline: false }
          );

        recordRob(guildId, robberId, targetId, false, fine);
        robSucceeded = false;
      }
    }
  }

  // Award XP to the robber for attempting the rob (only if unique target)
  xpResult = awardsXp 
    ? addXp(guildId, robberId, 'rob', robSucceeded, amountForXp)
    : { xpGained: 0, levelUp: false };
  
  // Process infamy for successful robs
  let infamyResult = { infamyGained: 0, bountyClaimed: null, bountyPosted: null };
  if (robSucceeded && amountForXp > 0) {
    infamyResult = await processRobInfamy(guildId, robberId, targetId, amountForXp, interaction);
  }
  
  // Add XP info to footer
  let footerText;
  if (awardsXp) {
    footerText = `🔓 Rob XP: +${xpResult.xpGained}`;
    if (xpResult.levelUp) {
      footerText += ` | 🎉 Level Up! Now Level ${xpResult.newLevel}`;
    }
  } else {
    footerText = `🔓 No XP (target unique people)`;
  }
  embed.setFooter({ text: footerText });

  // Send the outcome embed to the robbery channel
  await interaction.channel.send({ embeds: [embed] });
}
