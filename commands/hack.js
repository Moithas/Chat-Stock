const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, removeFromBank, addMoney, applyFine, getPlayerCreatedAt } = require('../economy');
const { 
  getHackSettings, 
  canHack, 
  canBeHacked, 
  canHackTarget,
  startActiveHack, 
  endActiveHack,
  recordHackerCooldown,
  recordTargetHacked,
  clearTargetCooldown,
  clearHackerCooldown,
  applyAttemptPenalty,
  calculateSuccessRate,
  calculateStealAmount,
  calculateFine,
  getDefenseChance,
  isUserImmuneToHack,
  recordHack
} = require('../hack');
const { 
  getHackBonuses, 
  addXp, 
  checkTrainingComplete 
} = require('../skills');
const { hasActiveEffect, getEffectValue, EFFECT_TYPES } = require('../items');
const { getLuckyPennyEffect, LP_EFFECT_TYPES } = require('../luckypenny');
const { getInfamySettings, getTierEffects, addInfamy, rollBountyCheck, createBounty, getActiveBounty, claimBounty, startProbation, announceBountyPosted, announceBountyClaimed } = require('../infamy');
const { addMoney: addMoneyForBounty } = require('../economy');
const { getCurrency, getAdminSettings } = require('../admin');



// Progress bar characters
const PROGRESS_FILLED = '█';
const PROGRESS_EMPTY = '░';

// Flavor messages for each progress stage
const HACK_STAGES = [
  { progress: 0, message: "Initializing breach protocol...", emoji: "🔌" },
  { progress: 20, message: "Bypassing firewall...", emoji: "🛡️" },
  { progress: 40, message: "Decrypting credentials...", emoji: "🔐" },
  { progress: 60, message: "Accessing secure server...", emoji: "🏦" },
  { progress: 80, message: "Extracting funds...", emoji: "💰" },
  { progress: 100, message: "Transfer complete!", emoji: "✅" }
];

// Result flavor texts
const FLAVOR_TEXTS = {
  hackSuccess: [
    "You've breached {target}'s defenses and siphoned their funds!",
    "{target}'s firewall was no match for your skills!",
    "Access granted! {target}'s bank account has been compromised!",
    "You've successfully infiltrated {target}'s financial systems!",
    "{target} never saw the digital heist coming!"
  ],
  hackFail: [
    "Your hack was detected and blocked by {target}'s security!",
    "{target}'s encryption was too strong!",
    "Security protocols kicked in and terminated your connection!",
    "Your intrusion attempt triggered {target}'s alarm systems!",
    "Access denied! {target}'s firewall held strong!"
  ],
  defenseSuccess: [
    "{target} deployed a counter-virus and stopped the hack!",
    "{target}'s quick reflexes saved their bank account!",
    "Virus neutralized! {target} successfully defended!",
    "{target} pulled the plug just in time!",
    "Connection terminated by {target}'s security measures!"
  ],
  traceSuccess: [
    "{target} traced the connection and recovered some funds!",
    "Counter-hack successful! {target} got some payback!",
    "{target}'s trace program found the hacker's stash!",
    "Reverse engineering complete! {target} extracted compensation!"
  ],
  traceFail: [
    "{target} tried to trace but the hacker covered their tracks.",
    "The trail went cold. No funds recovered.",
    "{target}'s trace hit a dead end.",
    "The hacker's VPN was too secure to trace."
  ]
};

function getRandomFlavor(textArray) {
  return textArray[Math.floor(Math.random() * textArray.length)];
}

function createProgressBar(progress) {
  const filled = Math.floor(progress / 10);
  const empty = 10 - filled;
  return PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(empty);
}

function getStageInfo(progress) {
  for (let i = HACK_STAGES.length - 1; i >= 0; i--) {
    if (progress >= HACK_STAGES[i].progress) {
      return HACK_STAGES[i];
    }
  }
  return HACK_STAGES[0];
}

function createHackEmbed(guildId, hackerId, targetUser, progress, settings, targetBank, maxStealBonus = 0, hackerLevel = 0) {
  const stage = getStageInfo(progress);
  const defenseChance = getDefenseChance(progress);
  const potentialSteal = calculateStealAmount(targetBank, progress, settings, maxStealBonus);
  
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${stage.emoji} HACK IN PROGRESS`)
    .setDescription(`<@${hackerId}> is hacking **${targetUser.username}**'s bank account!${hackerLevel > 0 ? `\n🎓 **Hacker Level:** ${hackerLevel}` : ''}`)
    .addFields(
      { name: 'Progress', value: `[${createProgressBar(progress)}] ${progress}%`, inline: false },
      { name: 'Status', value: stage.message, inline: true },
      { name: 'Potential Theft', value: `${potentialSteal.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
    )
    .setTimestamp();
  
  if (progress < 80) {
    embed.addFields({ 
      name: '🛡️ Defense Chance', 
      value: `${defenseChance}% if you act now!`, 
      inline: true 
    });
  } else {
    embed.addFields({ 
      name: '🛡️ Defense', 
      value: '❌ Too late to defend!', 
      inline: true 
    });
  }
  
  return embed;
}

function createDefenseButton(hackerId, disabled = false) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`hack_defend_${hackerId}`)
        .setLabel('Deploy Virus')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🦠')
        .setDisabled(disabled)
    );
}

function createTraceButton(hackerId, disabled = false) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`hack_trace_${hackerId}`)
        .setLabel('Trace Hacker')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔍')
        .setDisabled(disabled)
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hack')
    .setDescription('Attempt to hack another user\'s bank account')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to hack')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    const hackerId = interaction.user.id;
    const targetUser = interaction.options.getUser('target');
    const targetId = targetUser.id;

    // Check if trying to hack self
    if (hackerId === targetId) {
      return interaction.editReply({
        content: '❌ You can\'t hack yourself! That\'s just checking your own balance.'
      });
    }

    // Check if trying to hack a bot
    if (targetUser.bot) {
      return interaction.editReply({
        content: '❌ You can\'t hack bots! They don\'t have bank accounts.'
      });
    }

    const settings = getHackSettings(guildId);

    // Check if hacking is enabled
    if (!settings.enabled) {
      return interaction.editReply({
        content: '❌ Hacking is currently disabled on this server.'
      });
    }

    // Check if target has an immune role
    const targetMember = interaction.guild.members.cache.get(targetId) || 
                         await interaction.guild.members.fetch(targetId).catch(() => null);
    if (targetMember) {
      const targetRoles = targetMember.roles.cache.map(role => role.id);
      if (isUserImmuneToHack(guildId, targetRoles)) {
        return interaction.editReply({
          content: `❌ **${targetUser.username}** has hack immunity and cannot be hacked!`
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
          return interaction.editReply({
            content: `❌ **${targetUser.username}** is a new player and has hack immunity until <t:${Math.floor(immunityEnds / 1000)}:R>.`
          });
        }
      }
    }
    
    // Check if target has item-based hack protection (100% = full immunity)
    const hackProtectionValue = getEffectValue(guildId, targetId, EFFECT_TYPES.HACK_PROTECTION);
    if (hackProtectionValue >= 100) {
      return interaction.editReply({
        content: `❌ **${targetUser.username}** has a 🔥 **Firewall** protecting them and cannot be hacked!`
      });
    }

    // Check if target can be hacked (cooldown + not currently being hacked)
    const targetCooldownCheck = canBeHacked(guildId, targetId);
    if (!targetCooldownCheck.canBeHacked) {
      // Apply attempt penalty if target is protected (has timeRemaining = recently hacked)
      let penaltyMsg = '';
      if (targetCooldownCheck.timeRemaining) {
        const penalty = applyAttemptPenalty(guildId, hackerId);
        if (penalty.applied) {
          penaltyMsg = `\n\n🚨 **Security Alert!** Your hack attempt was flagged by authorities. You've been locked out for **${penalty.penaltyMinutes} minutes**.`;
        }
      }
      return interaction.editReply({
        content: `❌ ${targetCooldownCheck.reason}${penaltyMsg}`
      });
    }

    // Check if this target counts for XP (anti-farming - still allows hack, just no XP)
    const uniqueTargetCheck = canHackTarget(guildId, hackerId, targetId);
    const awardsXp = uniqueTargetCheck.canHack;

    // Check for completed training and get skill bonuses
    const trainingResult = checkTrainingComplete(guildId, hackerId, 'hack');
    const hackBonuses = getHackBonuses(guildId, hackerId);
    const targetBonuses = getHackBonuses(guildId, targetId);
    
    // Skill difference affects defense: each level the target has over the hacker adds +5% defense chance
    // Each level the hacker has over the target reduces defense chance by 3%
    const skillDifference = targetBonuses.level - hackBonuses.level;
    const defenseSkillMod = skillDifference > 0 
      ? skillDifference * 5   // Target is higher: +5% defense per level advantage
      : skillDifference * 3;  // Hacker is higher: -3% defense per level advantage (skillDiff is negative)

    // Check hacker cooldown (with skill reduction + LP buff)
    const lpHackCooldown = getLuckyPennyEffect(guildId, hackerId, LP_EFFECT_TYPES.HACK_COOLDOWN);
    const totalHackCooldownReduction = hackBonuses.cooldownReduction + (-lpHackCooldown);
    const hackerCooldownCheck = canHack(guildId, hackerId, totalHackCooldownReduction);
    if (!hackerCooldownCheck.canHack) {
      let response = `❌ ${hackerCooldownCheck.reason}`;
      if (trainingResult) {
        response = `✅ **Hack training complete!** +${trainingResult.xpGained} XP${trainingResult.levelUp ? ` → **Level ${trainingResult.newLevel}!**` : ''}\n\n` + response;
      }
      return interaction.editReply({ content: response });
    }

    // Get balances
    const hackerBalance = getBalance(guildId, hackerId);
    const targetBalance = getBalance(guildId, targetId);

    // Check if target has bank debt - can't hack players with negative bank
    // (negative cash is fine, we're stealing from bank not cash)
    if (targetBalance.bank < 0) {
      return interaction.editReply({
        content: `❌ You cannot hack ${targetUser.username} - their bank account is in debt!`
      });
    }

    // Check if target has any bank balance to steal
    if (targetBalance.bank === 0) {
      return interaction.editReply({
        content: `❌ ${targetUser.username} has no money in the bank to hack!`
      });
    }

    // Calculate success rate (with skill bonus, item bonus, LP buff, and target defense)
    // Uses total balance (cash + bank) for both parties
    const itemSuccessBoost = getEffectValue(guildId, hackerId, EFFECT_TYPES.HACK_SUCCESS_BOOST);
    const lpHackSuccess = getLuckyPennyEffect(guildId, hackerId, LP_EFFECT_TYPES.HACK_SUCCESS);
    const targetHackDefense = getEffectValue(guildId, targetId, EFFECT_TYPES.HACK_DEFENSE);
    const totalSuccessBonus = hackBonuses.successRateBonus + itemSuccessBoost + lpHackSuccess - targetHackDefense;
    const hackerTotal = hackerBalance.cash + hackerBalance.bank;
    const targetTotal = targetBalance.cash + targetBalance.bank;
    const successRate = calculateSuccessRate(targetTotal, hackerTotal, totalSuccessBonus);
    
    // Debug logging for hack rate calculation
    console.log(`🔍 HACK DEBUG - Hacker: ${hackerId}, Target: ${targetId}`);
    console.log(`   Hacker Balance: cash=${hackerBalance.cash}, bank=${hackerBalance.bank}, total=${hackerTotal}`);
    console.log(`   Target Balance: cash=${targetBalance.cash}, bank=${targetBalance.bank}, total=${targetTotal}`);
    console.log(`   hackBonuses object:`, JSON.stringify(hackBonuses));
    console.log(`   Skill Bonus: ${hackBonuses.successRateBonus}% (level ${hackBonuses.level}), Item Boost: ${itemSuccessBoost}%`);
    console.log(`   LP Hack Success: ${lpHackSuccess}%, Target Hack Defense: ${targetHackDefense}%`);
    console.log(`   Total Success Bonus: ${totalSuccessBonus}%`);
    // Apply infamy tier success buff
    const hackerTierEffects = getTierEffects(guildId, hackerId);
    const infamySuccessBuff = hackerTierEffects.successBuff || 0;
    const adjustedSuccessRate = Math.min(95, successRate + infamySuccessBuff);

    console.log(`   Base Rate: ${((targetTotal / 2.5) / (hackerTotal + targetTotal) * 100).toFixed(2)}%`);
    console.log(`   Infamy Tier: ${hackerTierEffects.tier} (${hackerTierEffects.name}), Success Buff: +${infamySuccessBuff}%`);
    console.log(`   Final Success Rate: ${adjustedSuccessRate.toFixed(2)}%`);

    // Start tracking this hack
    startActiveHack(guildId, targetId, hackerId);
    
    // Put hacker on cooldown immediately
    recordHackerCooldown(guildId, hackerId);

    // Build training notification if applicable
    let trainingNotification = '';
    if (trainingResult) {
      trainingNotification = `✅ **Hack training complete!** +${trainingResult.xpGained} XP${trainingResult.levelUp ? ` → **Level ${trainingResult.newLevel}!**` : ''}\n\n`;
    }

    // Send initial hack embed (with skill bonus)
    const initialEmbed = createHackEmbed(guildId, hackerId, targetUser, 0, settings, targetBalance.bank, hackBonuses.maxStealBonus, hackBonuses.level);
    const defenseRow = createDefenseButton(hackerId);
    
    await interaction.editReply({ content: `${trainingNotification}💻 Initiating hack on ${targetUser.username}...` });
    
    const hackMessage = await interaction.channel.send({
      content: `<@${targetId}> ⚠️ **YOUR BANK IS BEING HACKED!**`,
      embeds: [initialEmbed],
      components: [defenseRow]
    });

    let progress = 0;
    let defended = false;
    let defenseCollector = null;
    let hackCompleted = false;

    // Failsafe: if hack doesn't complete within 45 seconds, force cleanup
    const failsafeTimeout = setTimeout(() => {
      if (!hackCompleted) {
        console.error(`⚠️ HACK FAILSAFE triggered for hacker=${hackerId}, target=${targetId} — forcing cleanup`);
        endActiveHack(guildId, targetId);
        clearTargetCooldown(guildId, targetId);
        clearHackerCooldown(guildId, hackerId);
        hackCompleted = true;
      }
    }, 45000);

    // Set up button collector for defense
    const filter = i => i.customId === `hack_defend_${hackerId}` && i.user.id === targetId;
    defenseCollector = hackMessage.createMessageComponentCollector({ filter, time: 25000 });

    defenseCollector.on('collect', async (buttonInteraction) => {
      defenseCollector.stop('defended');
      
      const baseDefenseChance = getDefenseChance(progress);
      const defenseChance = Math.min(95, Math.max(5, baseDefenseChance + defenseSkillMod));
      const defenseRoll = Math.random() * 100;
      const defenseSuccess = defenseRoll < defenseChance;
      
      await buttonInteraction.deferUpdate();
      
      if (defenseSuccess) {
        // Defense succeeded - hack fails, but hacker still gets XP
        defended = true;
        hackCompleted = true;
        clearTimeout(failsafeTimeout);
        endActiveHack(guildId, targetId);
        clearTargetCooldown(guildId, targetId);
        
        // Use 100% progress to calculate fine based on full potential steal, not current progress
        // Otherwise early defense (e.g. 0% progress) results in zero fine
        const potentialSteal = calculateStealAmount(targetBalance.bank, 100, settings, hackBonuses.maxStealBonus);
        const itemFineReduction = getEffectValue(guildId, hackerId, EFFECT_TYPES.HACK_FINE_REDUCTION);
        const lpHackFine = getLuckyPennyEffect(guildId, hackerId, LP_EFFECT_TYPES.HACK_FINES);
        const fineReduction = (hackBonuses.level * 3) + itemFineReduction + (-lpHackFine); // 3% per level + item + LP
        const baseFine = calculateFine(potentialSteal, settings);
        // Apply infamy fine modifier
        const defInfamyFineModifier = hackerTierEffects.fineModifier || 0;
        const fine = Math.floor(baseFine * (1 - fineReduction / 100) * (1 + defInfamyFineModifier / 100));
        
        // Fine the hacker
        await applyFine(guildId, hackerId, fine, `Failed hack attempt on ${targetUser.username} (defended)`);
        
        // Award failure XP (only if unique target)
        const xpResult = awardsXp 
          ? addXp(guildId, hackerId, 'hack', 0, false)
          : { xpGained: 0, levelUp: false };
        
        recordHack(guildId, hackerId, targetId, false, fine, true);
        
        const flavorText = getRandomFlavor(FLAVOR_TEXTS.defenseSuccess).replaceAll('{target}', `**${targetUser.username}**`);
        
        const xpFooter = awardsXp 
          ? `Hacker gained ${xpResult.xpGained} XP • You can attempt to trace the hacker!`
          : `Hacker gained no XP (must target unique people) • You can attempt to trace the hacker!`;
        
        const defenseEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('🛡️ HACK DEFENDED!')
          .setDescription(flavorText)
          .addFields(
            { name: '🎯 Defense Roll', value: `${defenseRoll.toFixed(1)}% (needed < ${defenseChance}%)`, inline: true },
            { name: '💸 Hacker Fined', value: `${fine.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
            { name: '📊 Hack Progress', value: `${progress}%`, inline: true }
          )
          .setFooter({ text: xpFooter })
          .setTimestamp();
        
        const traceRow = createTraceButton(hackerId);
        
        await hackMessage.edit({
          content: `<@${targetId}>`,
          embeds: [defenseEmbed],
          components: [traceRow]
        });
        
        // Set up trace collector
        const traceFilter = i => {
          console.log(`Trace filter check: customId=${i.customId}, expected=hack_trace_${hackerId}, userId=${i.user.id}, targetId=${targetId}`);
          return i.customId === `hack_trace_${hackerId}` && i.user.id === targetId;
        };
        const traceCollector = hackMessage.createMessageComponentCollector({ 
          filter: traceFilter, 
          time: 15000, 
          max: 1,
          componentType: 2 // Button type
        });
        
        console.log(`Trace collector created for hackerId=${hackerId}, targetId=${targetId}`);
        
        traceCollector.on('collect', async (traceInteraction) => {
          await traceInteraction.deferUpdate();
          
          // Get the current embed to preserve it
          const originalEmbed = hackMessage.embeds[0];
          
          // Base 40% chance to trace, reduced by hacker's trace reduction skill
          const baseTraceChance = 40;
          const traceChance = Math.max(5, baseTraceChance - hackBonuses.traceReduction); // Minimum 5%
          const traceRoll = Math.random() * 100;
          const traceSuccess = traceRoll < traceChance;
          
          if (traceSuccess) {
            // Recover 10-25% of what would have been stolen
            const recoveryPercent = 10 + Math.random() * 15;
            const recoveryAmount = Math.floor(potentialSteal * (recoveryPercent / 100));
            
            // Take recovery amount from the hacker (can put them further into debt)
            await applyFine(guildId, hackerId, recoveryAmount, `Traced by ${targetUser.username}`);
            await addMoney(guildId, targetId, recoveryAmount, `Traced hacker ${interaction.user.username}`);
            
            const traceFlavorText = getRandomFlavor(FLAVOR_TEXTS.traceSuccess).replaceAll('{target}', `**${targetUser.username}**`);
            
            const traceEmbed = new EmbedBuilder()
              .setColor(0x3498db)
              .setTitle('🔍 TRACE SUCCESSFUL!')
              .setDescription(traceFlavorText)
              .addFields(
                { name: '💰 Recovered', value: `${recoveryAmount.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
                { name: '📊 Trace Roll', value: `${traceRoll.toFixed(1)}% (needed < ${traceChance.toFixed(1)}%)`, inline: true }
              )
              .setTimestamp();
            
            await hackMessage.edit({
              embeds: [originalEmbed, traceEmbed],
              components: []
            });
          } else {
            const traceFlavorText = getRandomFlavor(FLAVOR_TEXTS.traceFail).replaceAll('{target}', `**${targetUser.username}**`);
            
            const traceEmbed = new EmbedBuilder()
              .setColor(0x95a5a6)
              .setTitle('🔍 Trace Failed')
              .setDescription(traceFlavorText)
              .addFields(
                { name: '📊 Trace Roll', value: `${traceRoll.toFixed(1)}% (needed < ${traceChance.toFixed(1)}%)`, inline: true }
              )
              .setTimestamp();
            
            await hackMessage.edit({
              embeds: [originalEmbed, traceEmbed],
              components: []
            });
          }
        });
        
        traceCollector.on('end', async (collected, reason) => {
          if (reason === 'time' && collected.size === 0) {
            // Trace button expired
            await hackMessage.edit({ components: [] }).catch(() => {});
          }
        });
        
      } else {
        // Defense failed - hack continues but button disabled
        const failEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('🦠 VIRUS NEUTRALIZED!')
          .setDescription(`${targetUser.username}'s defense failed! The hack continues...`)
          .addFields(
            { name: '🎲 Defense Roll', value: `${defenseRoll.toFixed(1)}% (needed < ${defenseChance}%)`, inline: true }
          )
          .setTimestamp();
        
        await interaction.channel.send({ embeds: [failEmbed] });
      }
    });

    // Progress loop
    const progressInterval = setInterval(async () => {
      if (defended) {
        clearInterval(progressInterval);
        return;
      }
      
      progress += 20;
      
      if (progress >= 100) {
        clearInterval(progressInterval);
        if (defenseCollector) defenseCollector.stop('complete');
        clearTimeout(failsafeTimeout);
        hackCompleted = true;
        
        try {
        // End active hack tracking
        endActiveHack(guildId, targetId);
        
        // Determine success
        const hackRoll = Math.random() * 100;
        const hackSuccess = hackRoll < adjustedSuccessRate;
        
        if (hackSuccess) {
          // Successful hack
          let stolenAmount = calculateStealAmount(targetBalance.bank, 100, settings, hackBonuses.maxStealBonus);
          
          // Apply hack protection reduction (if target has partial protection)
          if (hackProtectionValue > 0 && hackProtectionValue < 100) {
            stolenAmount = Math.floor(stolenAmount * (1 - hackProtectionValue / 100));
          }
          
          // Apply infamy earnings cut
          const earningsCut = hackerTierEffects.earningsCut || 0;
          if (earningsCut > 0) {
            stolenAmount = Math.floor(stolenAmount * (1 - earningsCut / 100));
          }
          
          await removeFromBank(guildId, targetId, stolenAmount, `Hacked by ${interaction.user.username}`);
          await addMoney(guildId, hackerId, stolenAmount, `Hacked ${targetUser.username}`);
          
          // Add infamy for successful hack
          const infamySettings = getInfamySettings(guildId);
          if (infamySettings.enabled) {
            const infamyGained = Math.round(stolenAmount * infamySettings.hack_rate);
            if (infamyGained > 0) addInfamy(guildId, hackerId, infamyGained, 'hack');
            
            // Check if target has a bounty — claim it!
            const targetBounty = getActiveBounty(guildId, targetId);
            if (targetBounty) {
              const claimed = claimBounty(guildId, targetId, hackerId, 'hack');
              if (claimed) {
                await addMoneyForBounty(guildId, hackerId, claimed.bounty_amount, `Bounty claimed on ${targetUser.username}`);
                startProbation(guildId, targetId);
                announceBountyClaimed(guildId, targetId, hackerId, claimed.bounty_amount, 'hack');
                
                // Public notification in channel
                try {
                  const { EmbedBuilder: EB } = require('discord.js');
                  await interaction.followUp({ embeds: [new EB()
                    .setColor(0xffd700)
                    .setTitle('🏆 Bounty Claimed!')
                    .setDescription(`<@${hackerId}> claimed the bounty on <@${targetId}>!\n\n💰 **Reward:** ${claimed.bounty_amount.toLocaleString()} ${getCurrency(guildId)}\n⚔️ **Method:** 💻 Hack\n\n⚖️ <@${targetId}> is now on **probation** — infamy reset to 0 but tier penalties remain.`)
                    .setTimestamp()] });
                } catch (e) {}
              }
            }
            
            // Roll for bounty posting
            if (rollBountyCheck(guildId, hackerId)) {
              const bounty = createBounty(guildId, hackerId);
              if (bounty) {
                announceBountyPosted(guildId, hackerId, bounty.bountyAmount);
                
                // Public notification in channel
                try {
                  const { EmbedBuilder: EB2 } = require('discord.js');
                  await interaction.followUp({ embeds: [new EB2()
                    .setColor(0xff0000)
                    .setTitle('🚨 BOUNTY POSTED!')
                    .setDescription(`A bounty has been placed on <@${hackerId}>!\n\n💰 **Bounty: ${bounty.bountyAmount.toLocaleString()}** ${getCurrency(guildId)}\n\n*Successfully hack or rob this player to claim the bounty!*`)
                    .setFooter({ text: 'Check /leaderboard → Bounty Board for all active bounties' })
                    .setTimestamp()] });
                } catch (e) {}
              }
            }
          }
          
          // Keep target on cooldown (successful hack)
          recordTargetHacked(guildId, targetId);
          
          // Award success XP (only if unique target)
          const xpResult = awardsXp 
            ? addXp(guildId, hackerId, 'hack', 0, true, stolenAmount)
            : { xpGained: 0, levelUp: false };
          
          recordHack(guildId, hackerId, targetId, true, stolenAmount, false);
          
          const flavorText = getRandomFlavor(FLAVOR_TEXTS.hackSuccess).replaceAll('{target}', `**${targetUser.username}**`);
          
          const xpFooter = awardsXp 
            ? `+${xpResult.xpGained} Hack XP${xpResult.levelUp ? ` • LEVEL UP → ${xpResult.newLevel}!` : ''}`
            : `No XP (target unique people)`;
          
          const protectionNote = hackProtectionValue > 0 && hackProtectionValue < 100 
            ? ` (🔥 ${hackProtectionValue}% protected)`
            : '';
          
          const tierIndicator = hackerTierEffects.tier >= 1 ? ` ${hackerTierEffects.emoji}` : '';
          
          const successEmbed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle(`💻 HACK SUCCESSFUL!${tierIndicator}`)
            .setDescription(flavorText)
            .addFields(
              { name: '💰 Stolen', value: `${stolenAmount.toLocaleString()} ${getCurrency(guildId)}${protectionNote}${earningsCut > 0 ? ` (−${earningsCut}% cut)` : ''}`, inline: true },
              { name: '📊 Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%${infamySuccessBuff > 0 ? ` (+${infamySuccessBuff}%)` : ''}`, inline: true },
              { name: '🎲 Roll', value: `${hackRoll.toFixed(1)}%`, inline: true }
            )
            .setFooter({ text: xpFooter })
            .setTimestamp();
          
          await hackMessage.edit({
            content: `<@${targetId}>`,
            embeds: [successEmbed],
            components: []
          });
          
        } else {
          // Failed hack
          const potentialSteal = calculateStealAmount(targetBalance.bank, 100, settings, hackBonuses.maxStealBonus);
          const baseFine = calculateFine(potentialSteal, settings);
          const itemFineReduction = getEffectValue(guildId, hackerId, EFFECT_TYPES.HACK_FINE_REDUCTION);
          const lpHackFine2 = getLuckyPennyEffect(guildId, hackerId, LP_EFFECT_TYPES.HACK_FINES);
          const fineReduction = hackBonuses.traceReduction + itemFineReduction + (-lpHackFine2); // trace + item + LP
          // Apply infamy fine modifier (higher fines at higher tiers)
          const infamyFineModifier = hackerTierEffects.fineModifier || 0;
          const fine = Math.floor(baseFine * (1 - fineReduction / 100) * (1 + infamyFineModifier / 100));
          
          await applyFine(guildId, hackerId, fine, `Failed hack attempt on ${targetUser.username}`);
          
          // Clear target cooldown (hack failed)
          clearTargetCooldown(guildId, targetId);
          
          // Award failure XP (only if unique target)
          const xpResult = awardsXp 
            ? addXp(guildId, hackerId, 'hack', 0, false)
            : { xpGained: 0, levelUp: false };
          
          recordHack(guildId, hackerId, targetId, false, fine, false);
          
          const flavorText = getRandomFlavor(FLAVOR_TEXTS.hackFail).replaceAll('{target}', `**${targetUser.username}**`);
          
          const xpFooter = awardsXp 
            ? `+${xpResult.xpGained} Hack XP • You can trace the hacker for recovery!`
            : `No XP (target unique people) • You can trace the hacker for recovery!`;
          
          const failEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🚫 HACK FAILED!')
            .setDescription(flavorText)
            .addFields(
              { name: '💸 Fine', value: `${fine.toLocaleString()} ${getCurrency(guildId)}${infamyFineModifier > 0 ? ` (+${infamyFineModifier}%)` : ''}`, inline: true },
              { name: '📊 Success Rate', value: `${adjustedSuccessRate.toFixed(1)}%`, inline: true },
              { name: '🎲 Roll', value: `${hackRoll.toFixed(1)}%`, inline: true }
            )
            .setFooter({ text: xpFooter })
            .setTimestamp();
          
          const traceRow = createTraceButton(hackerId);
          
          await hackMessage.edit({
            content: `<@${targetId}>`,
            embeds: [failEmbed],
            components: [traceRow]
          });
          
          // Set up trace collector for failed hack
          const traceFilter = i => {
            console.log(`Trace filter (fail) check: customId=${i.customId}, expected=hack_trace_${hackerId}, userId=${i.user.id}, targetId=${targetId}`);
            return i.customId === `hack_trace_${hackerId}` && i.user.id === targetId;
          };
          const traceCollector = hackMessage.createMessageComponentCollector({ 
            filter: traceFilter, 
            time: 15000, 
            max: 1,
            componentType: 2 // Button type
          });
          
          console.log(`Trace collector (fail) created for hackerId=${hackerId}, targetId=${targetId}`);
          
          traceCollector.on('collect', async (traceInteraction) => {
            await traceInteraction.deferUpdate();
            
            // Get the current embed to preserve it
            const originalEmbed = hackMessage.embeds[0];
            
            // Base 40% chance to trace, reduced by hacker's trace reduction skill
            const baseTraceChance = 40;
            const traceChance = Math.max(5, baseTraceChance - hackBonuses.traceReduction);
            const traceRoll = Math.random() * 100;
            const traceSuccess = traceRoll < traceChance;
            
            if (traceSuccess) {
              // Recover 10-25% of what would have been stolen
              const recoveryPercent = 10 + Math.random() * 15;
              const recoveryAmount = Math.floor(potentialSteal * (recoveryPercent / 100));
              
              // Take recovery amount from the hacker (can put them further into debt)
              await applyFine(guildId, hackerId, recoveryAmount, `Traced by ${targetUser.username}`);
              await addMoney(guildId, targetId, recoveryAmount, `Traced hacker ${interaction.user.username}`);
              
              const traceFlavorText = getRandomFlavor(FLAVOR_TEXTS.traceSuccess).replaceAll('{target}', `**${targetUser.username}**`);
              
              const traceEmbed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('🔍 TRACE SUCCESSFUL!')
                .setDescription(traceFlavorText)
                .addFields(
                  { name: '💰 Recovered', value: `${recoveryAmount.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
                  { name: '📊 Trace Roll', value: `${traceRoll.toFixed(1)}% (needed < ${traceChance.toFixed(1)}%)`, inline: true }
                )
                .setTimestamp();
              
              await hackMessage.edit({
                embeds: [originalEmbed, traceEmbed],
                components: []
              });
            } else {
              const traceFlavorText = getRandomFlavor(FLAVOR_TEXTS.traceFail).replaceAll('{target}', `**${targetUser.username}**`);
              
              const traceEmbed = new EmbedBuilder()
                .setColor(0x95a5a6)
                .setTitle('🔍 Trace Failed')
                .setDescription(traceFlavorText)
                .addFields(
                  { name: '📊 Trace Roll', value: `${traceRoll.toFixed(1)}% (needed < ${traceChance.toFixed(1)}%)`, inline: true }
                )
                .setTimestamp();
              
              await hackMessage.edit({
                embeds: [originalEmbed, traceEmbed],
                components: []
              });
            }
          });
          
          traceCollector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
              // Trace button expired
              await hackMessage.edit({ components: [] }).catch(() => {});
            }
          });
        }
        
        } catch (err) {
          console.error(`❌ HACK ERROR during completion for hacker=${hackerId}, target=${targetId}:`, err);
          // Make sure active hack and cooldowns are always cleaned up
          endActiveHack(guildId, targetId);
          clearTargetCooldown(guildId, targetId);
          clearHackerCooldown(guildId, hackerId);
          try {
            await hackMessage.edit({ 
              content: `❌ An error occurred during the hack. No money was transferred.`,
              embeds: [], 
              components: [] 
            });
          } catch (editErr) {
            console.error('Failed to edit hack message after error:', editErr.message);
          }
        }
        
        return;
      }
      
      // Update progress embed (with skill bonus)
      const progressEmbed = createHackEmbed(guildId, hackerId, targetUser, progress, settings, targetBalance.bank, hackBonuses.maxStealBonus, hackBonuses.level);
      const newDefenseRow = createDefenseButton(hackerId, progress >= 80);
      
      try {
        await hackMessage.edit({
          embeds: [progressEmbed],
          components: [newDefenseRow]
        });
      } catch (err) {
        // Message may have been deleted or API error
        console.error(`❌ HACK PROGRESS ERROR for hacker=${hackerId}, target=${targetId}:`, err.message);
        clearInterval(progressInterval);
        clearTimeout(failsafeTimeout);
        hackCompleted = true;
        endActiveHack(guildId, targetId);
        clearTargetCooldown(guildId, targetId);
        clearHackerCooldown(guildId, hackerId);
      }
    }, 5000);
  }
};
