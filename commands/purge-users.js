const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDb, saveDatabase, getAllStockHolders, calculateStockPrice, getPortfolio } = require('../database');
const { hasAdminPermission, getCurrency } = require('../admin');
const { addToBank } = require('../economy');
const { calculateSellFee } = require('../fees');

// Store pending purges for confirmation
const pendingPurges = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge-users')
    .setDescription('Remove users who are no longer in the server from the database (Admin only)'),

  async execute(interaction) {
    // Check admin permissions (Server Admin OR Stock Admin role)
    if (!hasAdminPermission(interaction.member, interaction.guildId)) {
      return interaction.reply({ content: '❌ You need admin permissions to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const db = getDb();

    // Get all users from database
    const usersResult = db.exec('SELECT user_id, username FROM users');
    
    if (usersResult.length === 0 || usersResult[0].values.length === 0) {
      return interaction.editReply({ content: '✅ No users found in database.' });
    }

    const dbUsers = usersResult[0].values;
    const missingUsers = [];
    let keptCount = 0;

    // Check each user - build list of missing users
    for (const [userId, username] of dbUsers) {
      try {
        await interaction.guild.members.fetch(userId);
        keptCount++;
      } catch (error) {
        // User is not in the guild anymore
        const shareholders = getAllStockHolders(userId);
        const portfolio = getPortfolio(userId);
        
        // Calculate liquidation value if they have shareholders
        let liquidationValue = 0;
        let shareholderCount = 0;
        if (shareholders.length > 0) {
          const currentPrice = calculateStockPrice(userId, guildId);
          for (const holder of shareholders) {
            if (holder.ownerId === userId) continue; // Skip self
            const grossValue = Math.round(holder.shares * currentPrice);
            const fee = calculateSellFee(guildId, grossValue);
            liquidationValue += (grossValue - fee);
            shareholderCount++;
          }
        }
        
        missingUsers.push({ 
          userId, 
          username, 
          shareholders: shareholderCount,
          liquidationValue,
          portfolioCount: portfolio.filter(p => p.stock_user_id !== userId).length
        });
      }
    }

    if (missingUsers.length === 0) {
      return interaction.editReply({ 
        content: '✅ All users in the database are still in the server. Nothing to purge.',
        embeds: [],
        components: []
      });
    }

    // Build preview embed
    const usersWithShareholders = missingUsers.filter(u => u.shareholders > 0);
    const totalLiquidation = missingUsers.reduce((sum, u) => sum + u.liquidationValue, 0);
    
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('⚠️ Purge Preview')
      .setDescription(
        `Found **${missingUsers.length}** user(s) who left the server.\n\n` +
        `${usersWithShareholders.length > 0 
          ? `**${usersWithShareholders.length}** user(s) still have shareholders who will be compensated.` 
          : 'No users have shareholders that need compensation.'}`
      )
      .addFields(
        { name: '👥 Users in Server', value: keptCount.toString(), inline: true },
        { name: '🗑️ Users to Purge', value: missingUsers.length.toString(), inline: true },
        { name: '💸 Total Liquidation', value: `${totalLiquidation.toLocaleString()} ${getCurrency(guildId)}`, inline: true }
      )
      .setTimestamp();
    
    // List users to purge (max 15)
    const userList = missingUsers.slice(0, 15).map(u => {
      let line = `• **${u.username}**`;
      if (u.shareholders > 0) {
        line += ` — 💸 ${u.shareholders} shareholder(s) → ${u.liquidationValue.toLocaleString()}`;
      }
      if (u.portfolioCount > 0) {
        line += ` — 📉 ${u.portfolioCount} holding(s)`;
      }
      return line;
    }).join('\n');
    
    embed.addFields({ 
      name: 'Users to Purge', 
      value: userList + (missingUsers.length > 15 ? `\n... and ${missingUsers.length - 15} more` : ''), 
      inline: false 
    });

    // Store pending purge data
    const purgeId = `${guildId}_${interaction.user.id}_${Date.now()}`;
    pendingPurges.set(purgeId, { missingUsers, guildId, keptCount });
    
    // Auto-expire after 2 minutes
    setTimeout(() => pendingPurges.delete(purgeId), 120000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`purge_confirm_${purgeId}`)
        .setLabel(`Purge ${missingUsers.length} Users`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId(`purge_cancel_${purgeId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }
};

// Handle button interactions
module.exports.handlePurgeButton = async function(interaction) {
  const customId = interaction.customId;
  
  if (customId.startsWith('purge_cancel_')) {
    pendingPurges.delete(customId.replace('purge_cancel_', ''));
    return interaction.update({ 
      content: '❌ Purge cancelled.', 
      embeds: [], 
      components: [] 
    });
  }
  
  if (!customId.startsWith('purge_confirm_')) return false;
  
  const purgeId = customId.replace('purge_confirm_', '');
  const purgeData = pendingPurges.get(purgeId);
  
  if (!purgeData) {
    return interaction.update({ 
      content: '❌ This purge session has expired. Run `/purge-users` again.', 
      embeds: [], 
      components: [] 
    });
  }
  
  pendingPurges.delete(purgeId);
  
  await interaction.update({
    content: '⏳ Purging users and compensating shareholders...',
    embeds: [],
    components: []
  });
  
  const { missingUsers, guildId, keptCount } = purgeData;
  const db = getDb();
  
  const results = {
    purged: 0,
    liquidated: 0,
    totalCompensation: 0,
    totalFees: 0,
    shareholdersCompensated: 0,
    stocksDeleted: 0,
    liquidationDetails: []
  };
  
  // Process each missing user
  for (const user of missingUsers) {
    const { userId, username } = user;
    
    // === LIQUIDATION PHASE ===
    // Compensate shareholders before deleting data
    const shareholders = getAllStockHolders(userId);
    if (shareholders.length > 0) {
      const currentPrice = calculateStockPrice(userId, guildId);
      let userCompensation = 0;
      let userFees = 0;
      let userShareholders = 0;
      
      for (const holder of shareholders) {
        if (holder.ownerId === userId) continue; // Skip self
        
        const grossValue = Math.round(holder.shares * currentPrice);
        const fee = calculateSellFee(guildId, grossValue);
        const netCompensation = grossValue - fee;
        
        if (netCompensation > 0) {
          await addToBank(guildId, holder.ownerId, netCompensation, `Liquidation: ${username} left server`);
          userCompensation += netCompensation;
          userFees += fee;
          userShareholders++;
          results.shareholdersCompensated++;
        }
      }
      
      if (userShareholders > 0) {
        results.liquidated++;
        results.totalCompensation += userCompensation;
        results.totalFees += userFees;
        results.liquidationDetails.push({
          username,
          shareholders: userShareholders,
          compensation: userCompensation,
          fees: userFees
        });
      }
    }
    
    // Count portfolio holdings being deleted
    const portfolio = getPortfolio(userId);
    results.stocksDeleted += portfolio.filter(p => p.stock_user_id !== userId).length;
    
    // === PURGE PHASE ===
    // Delete all user data
    db.run('DELETE FROM users WHERE user_id = ?', [userId]);
    db.run('DELETE FROM balances WHERE user_id = ?', [userId]);
    db.run('DELETE FROM stocks WHERE owner_id = ? OR stock_user_id = ?', [userId, userId]);
    db.run('DELETE FROM transactions WHERE buyer_id = ? OR stock_user_id = ?', [userId, userId]);
    db.run('DELETE FROM economy_transactions WHERE user_id = ?', [userId]);
    db.run('DELETE FROM stock_purchases WHERE owner_id = ? OR stock_user_id = ?', [userId, userId]);
    db.run('DELETE FROM price_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM work_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM work_tracker WHERE user_id = ?', [userId]);
    db.run('DELETE FROM crime_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM crime_tracker WHERE user_id = ?', [userId]);
    db.run('DELETE FROM slut_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM slut_tracker WHERE user_id = ?', [userId]);
    db.run('DELETE FROM rob_history WHERE robber_id = ? OR target_id = ?', [userId, userId]);
    db.run('DELETE FROM rob_tracker WHERE user_id = ?', [userId]);
    db.run('DELETE FROM passive_income_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM passive_income_tracker WHERE user_id = ?', [userId]);
    db.run('DELETE FROM role_income_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM role_income_tracker WHERE user_id = ?', [userId]);
    db.run('DELETE FROM dividend_history WHERE stock_user_id = ? OR shareholder_id = ?', [userId, userId]);
    db.run('DELETE FROM self_dividend_history WHERE stock_user_id = ?', [userId]);
    db.run('DELETE FROM gambling_stats WHERE user_id = ?', [userId]);
    db.run('DELETE FROM scratch_stats WHERE user_id = ?', [userId]);
    db.run('DELETE FROM scratch_tickets WHERE user_id = ?', [userId]);
    db.run('DELETE FROM lottery_tickets WHERE user_id = ?', [userId]);
    db.run('DELETE FROM lottery_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM owned_properties WHERE user_id = ?', [userId]);
    db.run('DELETE FROM card_cooldowns WHERE user_id = ?', [userId]);
    db.run('DELETE FROM loans WHERE user_id = ?', [userId]);
    db.run('DELETE FROM active_bonds WHERE user_id = ?', [userId]);
    db.run('DELETE FROM loan_payments WHERE user_id = ?', [userId]);
    db.run('DELETE FROM bond_history WHERE user_id = ?', [userId]);
    db.run('DELETE FROM user_cards WHERE user_id = ?', [userId]);
    db.run('DELETE FROM admin_logs WHERE user_id = ?', [userId]);
    db.run('DELETE FROM infamy_tracker WHERE user_id = ?', [userId]);
    db.run('DELETE FROM bounty_board WHERE target_user_id = ?', [userId]);
    db.run('DELETE FROM insider_trading_snapshots WHERE user_id = ?', [userId]);
    db.run('DELETE FROM dungeon_stats WHERE user_id = ?', [userId]);
    db.run('DELETE FROM dungeon_cooldowns WHERE user_id = ?', [userId]);
    db.run('DELETE FROM skill_stats WHERE user_id = ?', [userId]);
    db.run('DELETE FROM pets WHERE owner_id = ?', [userId]);
    db.run('DELETE FROM pet_gestations WHERE gestating_for_user = ?', [userId]);
    
    results.purged++;
  }

  // Save database
  saveDatabase();

  // Build results embed
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🗑️ Purge & Liquidation Complete')
    .setDescription(
      `Successfully removed **${results.purged}** user(s) who left the server.\n` +
      (results.liquidated > 0 
        ? `**${results.liquidated}** user(s) had shareholders who were compensated.` 
        : '')
    )
    .addFields(
      { name: '👥 Users Kept', value: keptCount.toString(), inline: true },
      { name: '🗑️ Users Purged', value: results.purged.toString(), inline: true },
      { name: '📉 Holdings Deleted', value: results.stocksDeleted.toString(), inline: true }
    )
    .setTimestamp()
    .setFooter({ text: `Purged by ${interaction.user.username}` });

  // Add liquidation details if any
  if (results.liquidated > 0) {
    embed.addFields(
      { name: '💸 Total Compensation', value: `${results.totalCompensation.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '💰 Fees Collected', value: `${results.totalFees.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
      { name: '👥 Shareholders Paid', value: results.shareholdersCompensated.toString(), inline: true }
    );
    
    // Show liquidation breakdown (max 10)
    if (results.liquidationDetails.length > 0) {
      const breakdown = results.liquidationDetails.slice(0, 10).map(d => 
        `• **${d.username}** — ${d.shareholders} shareholder(s) → ${d.compensation.toLocaleString()}`
      ).join('\n');
      
      embed.addFields({ 
        name: '📋 Liquidation Breakdown', 
        value: breakdown + (results.liquidationDetails.length > 10 ? `\n... and ${results.liquidationDetails.length - 10} more` : ''),
        inline: false 
      });
    }
  }

  await interaction.editReply({ content: null, embeds: [embed], components: [] });
  return true;
};
