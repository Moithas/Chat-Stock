const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, removeFromBank, addMoney, applyFine } = require('../economy');
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

const CURRENCY = '<:babybel:1418824333664452608>';

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

function createHackEmbed(hackerId, targetUser, progress, settings, targetBank, maxStealBonus = 0, hackerLevel = 0) {
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
      { name: 'Potential Theft', value: `${potentialSteal.toLocaleString()} ${CURRENCY}`, inline: true }
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
    const guildId = interaction.guildId;
    const hackerId = interaction.user.id;
    const targetUser = interaction.options.getUser('target');
    const targetId = targetUser.id;

    // Check if trying to hack self
    if (hackerId === targetId) {
      return interaction.reply({
        content: '❌ You can\'t hack yourself! That\'s just checking your own balance.'
      });
    }

    // Check if trying to hack a bot
    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ You can\'t hack bots! They don\'t have bank accounts.'
      });
    }

    const settings = getHackSettings(guildId);

    // Check if hacking is enabled
    if (!settings.enabled) {
      return interaction.reply({
        content: '❌ Hacking is currently disabled on this server.'
      });
    }

    // Check if target has an immune role
    const targetMember = interaction.guild.members.cache.get(targetId) || 
                         await interaction.guild.members.fetch(targetId).catch(() => null);
    if (targetMember) {
      const targetRoles = targetMember.roles.cache.map(role => role.id);
      if (isUserImmuneToHack(guildId, targetRoles)) {
        return interaction.reply({
          content: `❌ **${targetUser.username}** has hack immunity and cannot be hacked!`
        });
      }
    }
    
    // Check if target has item-based hack protection (100% = full immunity)
    const hackProtectionValue = getEffectValue(guildId, targetId, EFFECT_TYPES.HACK_PROTECTION);
    if (hackProtectionValue >= 100) {
      return interaction.reply({
        content: `❌ **${targetUser.username}** has a 🔥 **Firewall** protecting them and cannot be hacked!`
      });
    }

    // Check if target can be hacked (cooldown + not currently being hacked)
    const targetCooldownCheck = canBeHacked(guildId, targetId);
    if (!targetCooldownCheck.canBeHacked) {
      return interaction.reply({
        content: `❌ ${targetCooldownCheck.reason}`
      });
    }

    // Check if this target counts for XP (anti-farming - still allows hack, just no XP)
    const uniqueTargetCheck = canHackTarget(guildId, hackerId, targetId);
    const awardsXp = uniqueTargetCheck.canHack;

    // Check for completed training and get skill bonuses
    const trainingResult = checkTrainingComplete(guildId, hackerId, 'hack');
    const hackBonuses = getHackBonuses(guildId, hackerId);

    // Check hacker cooldown (with skill reduction)
    const hackerCooldownCheck = canHack(guildId, hackerId, hackBonuses.cooldownReduction);
    if (!hackerCooldownCheck.canHack) {
      let response = `❌ ${hackerCooldownCheck.reason}`;
      if (trainingResult) {
        response = `✅ **Hack training complete!** +${trainingResult.xpGained} XP${trainingResult.levelUp ? ` → **Level ${trainingResult.newLevel}!**` : ''}\n\n` + response;
      }
      return interaction.reply({ content: response });
    }

    // Get balances
    const hackerBalance = getBalance(guildId, hackerId);
    const targetBalance = getBalance(guildId, targetId);

    // Check if target has bank debt - can't hack players with negative bank
    // (negative cash is fine, we're stealing from bank not cash)
    if (targetBalance.bank < 0) {
      return interaction.reply({
        content: `❌ You cannot hack ${targetUser.username} - their bank account is in debt!`
      });
    }

    // Check if target has any bank balance to steal
    if (targetBalance.bank === 0) {
      return interaction.reply({
        content: `❌ ${targetUser.username} has no money in the bank to hack!`
      });
    }

    // Calculate success rate (with skill bonus and item bonus)
    // Uses total balance (cash + bank) for both parties
    const itemSuccessBoost = getEffectValue(guildId, hackerId, EFFECT_TYPES.HACK_SUCCESS_BOOST);
    const totalSuccessBonus = hackBonuses.successRateBonus + itemSuccessBoost;
    const hackerTotal = hackerBalance.cash + hackerBalance.bank;
    const targetTotal = targetBalance.cash + targetBalance.bank;
    const successRate = calculateSuccessRate(targetTotal, hackerTotal, totalSuccessBonus);
    
    // Debug logging for hack rate calculation
    console.log(`🔍 HACK DEBUG - Hacker: ${hackerId}, Target: ${targetId}`);
    console.log(`   Hacker Balance: cash=${hackerBalance.cash}, bank=${hackerBalance.bank}, total=${hackerTotal}`);
    console.log(`   Target Balance: cash=${targetBalance.cash}, bank=${targetBalance.bank}, total=${targetTotal}`);
    console.log(`   hackBonuses object:`, JSON.stringify(hackBonuses));
    console.log(`   Skill Bonus: ${hackBonuses.successRateBonus}% (level ${hackBonuses.level}), Item Boost: ${itemSuccessBoost}%`);
    console.log(`   Total Success Bonus: ${totalSuccessBonus}%`);
    console.log(`   Base Rate: ${((targetTotal / 2.5) / (hackerTotal + targetTotal) * 100).toFixed(2)}%`);
    console.log(`   Final Success Rate: ${successRate.toFixed(2)}%`);

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
    const initialEmbed = createHackEmbed(hackerId, targetUser, 0, settings, targetBalance.bank, hackBonuses.maxStealBonus, hackBonuses.level);
    const defenseRow = createDefenseButton(hackerId);
    
    await interaction.reply({ content: `${trainingNotification}💻 Initiating hack on ${targetUser.username}...` });
    
    const hackMessage = await interaction.channel.send({
      content: `<@${targetId}> ⚠️ **YOUR BANK IS BEING HACKED!**`,
      embeds: [initialEmbed],
      components: [defenseRow]
    });

    let progress = 0;
    let defended = false;
    let defenseCollector = null;

    // Set up button collector for defense
    const filter = i => i.customId === `hack_defend_${hackerId}` && i.user.id === targetId;
    defenseCollector = hackMessage.createMessageComponentCollector({ filter, time: 25000 });

    defenseCollector.on('collect', async (buttonInteraction) => {
      defenseCollector.stop('defended');
      
      const defenseChance = getDefenseChance(progress);
      const defenseRoll = Math.random() * 100;
      const defenseSuccess = defenseRoll < defenseChance;
      
      await buttonInteraction.deferUpdate();
      
      if (defenseSuccess) {
        // Defense succeeded - hack fails, but hacker still gets XP
        defended = true;
        endActiveHack(guildId, targetId);
        clearTargetCooldown(guildId, targetId);
        
        const potentialSteal = calculateStealAmount(targetBalance.bank, progress, settings, hackBonuses.maxStealBonus);
        const itemFineReduction = getEffectValue(guildId, hackerId, EFFECT_TYPES.HACK_FINE_REDUCTION);
        const fineReduction = (hackBonuses.level * 3) + itemFineReduction; // 3% reduction per level + item
        const baseFine = calculateFine(potentialSteal, settings);
        const fine = Math.floor(baseFine * (1 - fineReduction / 100));
        
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
            { name: '💸 Hacker Fined', value: `${fine.toLocaleString()} ${CURRENCY}`, inline: true },
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
            
            await addMoney(guildId, targetId, recoveryAmount, `Traced hacker ${interaction.user.username}`);
            
            const traceFlavorText = getRandomFlavor(FLAVOR_TEXTS.traceSuccess).replaceAll('{target}', `**${targetUser.username}**`);
            
            const traceEmbed = new EmbedBuilder()
              .setColor(0x3498db)
              .setTitle('🔍 TRACE SUCCESSFUL!')
              .setDescription(traceFlavorText)
              .addFields(
                { name: '💰 Recovered', value: `${recoveryAmount.toLocaleString()} ${CURRENCY}`, inline: true },
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
        
        // End active hack tracking
        endActiveHack(guildId, targetId);
        
        // Determine success
        const hackRoll = Math.random() * 100;
        const hackSuccess = hackRoll < successRate;
        
        if (hackSuccess) {
          // Successful hack
          let stolenAmount = calculateStealAmount(targetBalance.bank, 100, settings, hackBonuses.maxStealBonus);
          
          // Apply hack protection reduction (if target has partial protection)
          if (hackProtectionValue > 0 && hackProtectionValue < 100) {
            stolenAmount = Math.floor(stolenAmount * (1 - hackProtectionValue / 100));
          }
          
          await removeFromBank(guildId, targetId, stolenAmount, `Hacked by ${interaction.user.username}`);
          await addMoney(guildId, hackerId, stolenAmount, `Hacked ${targetUser.username}`);
          
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
          
          const successEmbed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('💻 HACK SUCCESSFUL!')
            .setDescription(flavorText)
            .addFields(
              { name: '💰 Stolen', value: `${stolenAmount.toLocaleString()} ${CURRENCY}${protectionNote}`, inline: true },
              { name: '📊 Success Rate', value: `${successRate.toFixed(1)}%`, inline: true },
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
          const fineReduction = hackBonuses.traceReduction + itemFineReduction; // Use trace reduction + item
          const fine = Math.floor(baseFine * (1 - fineReduction / 100));
          
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
              { name: '💸 Fine', value: `${fine.toLocaleString()} ${CURRENCY}`, inline: true },
              { name: '📊 Success Rate', value: `${successRate.toFixed(1)}%`, inline: true },
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
              
              await addMoney(guildId, targetId, recoveryAmount, `Traced hacker ${interaction.user.username}`);
              
              const traceFlavorText = getRandomFlavor(FLAVOR_TEXTS.traceSuccess).replaceAll('{target}', `**${targetUser.username}**`);
              
              const traceEmbed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('🔍 TRACE SUCCESSFUL!')
                .setDescription(traceFlavorText)
                .addFields(
                  { name: '💰 Recovered', value: `${recoveryAmount.toLocaleString()} ${CURRENCY}`, inline: true },
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
        
        return;
      }
      
      // Update progress embed (with skill bonus)
      const progressEmbed = createHackEmbed(hackerId, targetUser, progress, settings, targetBalance.bank, hackBonuses.maxStealBonus, hackBonuses.level);
      const newDefenseRow = createDefenseButton(hackerId, progress >= 80);
      
      try {
        await hackMessage.edit({
          embeds: [progressEmbed],
          components: [newDefenseRow]
        });
      } catch (err) {
        // Message may have been deleted
        clearInterval(progressInterval);
        endActiveHack(guildId, targetId);
      }
    }, 5000);
  }
};
