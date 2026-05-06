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
      const shareholderPayouts = []; // Track individual payouts
      
      for (const holder of shareholders) {
        if (holder.ownerId === userId) continue; // Skip self
        
        const grossValue = Math.round(holder.shares * currentPrice);
        const fee = calculateSellFee(guildId, grossValue);
        const netCompensation = grossValue - fee;
        
        if (netCompensation > 0) {
          await addToBank(guildId, holder.ownerId, netCompensation, `Liquidation: ${username} left server`);
          userCompensation += netCompensation;
          userFees += fee;
          results.shareholdersCompensated++;
          
          // Track this payout
          shareholderPayouts.push({
            holderId: holder.ownerId,
            shares: holder.shares,
            compensation: netCompensation
          });
        }
      }
      
      if (shareholderPayouts.length > 0) {
        results.liquidated++;
        results.totalCompensation += userCompensation;
        results.totalFees += userFees;
        results.liquidationDetails.push({
          username,
          userId,
          shareholders: shareholderPayouts.length,
          compensation: userCompensation,
          fees: userFees,
          payouts: shareholderPayouts
        });
      }
    }
    
    // Count portfolio holdings being deleted
    const portfolio = getPortfolio(userId);
    results.stocksDeleted += portfolio.filter(p => p.stock_user_id !== userId).length;
    
    // === PURGE PHASE ===
    // Delete all user data. Each statement is wrapped in try/catch so a
    // single missing/renamed table can't abort the entire batch (which
    // previously caused the loop to stop after the first user).
    const deletes = [
      ['users', 'DELETE FROM users WHERE user_id = ?', [userId]],
      ['balances', 'DELETE FROM balances WHERE user_id = ?', [userId]],
      ['stocks', 'DELETE FROM stocks WHERE owner_id = ? OR stock_user_id = ?', [userId, userId]],
      ['transactions', 'DELETE FROM transactions WHERE buyer_id = ? OR stock_user_id = ?', [userId, userId]],
      ['economy_transactions', 'DELETE FROM economy_transactions WHERE user_id = ?', [userId]],
      ['stock_purchases', 'DELETE FROM stock_purchases WHERE owner_id = ? OR stock_user_id = ?', [userId, userId]],
      ['price_history', 'DELETE FROM price_history WHERE user_id = ?', [userId]],
      ['work_history', 'DELETE FROM work_history WHERE user_id = ?', [userId]],
      ['work_tracker', 'DELETE FROM work_tracker WHERE user_id = ?', [userId]],
      ['crime_history', 'DELETE FROM crime_history WHERE user_id = ?', [userId]],
      ['crime_tracker', 'DELETE FROM crime_tracker WHERE user_id = ?', [userId]],
      ['slut_history', 'DELETE FROM slut_history WHERE user_id = ?', [userId]],
      ['slut_tracker', 'DELETE FROM slut_tracker WHERE user_id = ?', [userId]],
      ['rob_history', 'DELETE FROM rob_history WHERE robber_id = ? OR target_id = ?', [userId, userId]],
      ['rob_tracker', 'DELETE FROM rob_tracker WHERE user_id = ?', [userId]],
      ['passive_income_history', 'DELETE FROM passive_income_history WHERE user_id = ?', [userId]],
      ['passive_income_tracker', 'DELETE FROM passive_income_tracker WHERE user_id = ?', [userId]],
      ['role_income_history', 'DELETE FROM role_income_history WHERE user_id = ?', [userId]],
      ['role_income_tracker', 'DELETE FROM role_income_tracker WHERE user_id = ?', [userId]],
      ['dividend_history', 'DELETE FROM dividend_history WHERE stock_user_id = ? OR shareholder_id = ?', [userId, userId]],
      ['self_dividend_history', 'DELETE FROM self_dividend_history WHERE stock_user_id = ?', [userId]],
      ['gambling_stats', 'DELETE FROM gambling_stats WHERE user_id = ?', [userId]],
      ['scratch_stats', 'DELETE FROM scratch_stats WHERE user_id = ?', [userId]],
      ['scratch_tickets', 'DELETE FROM scratch_tickets WHERE user_id = ?', [userId]],
      ['lottery_tickets', 'DELETE FROM lottery_tickets WHERE user_id = ?', [userId]],
      ['lottery_history', 'DELETE FROM lottery_history WHERE user_id = ?', [userId]],
      ['owned_properties', 'DELETE FROM owned_properties WHERE user_id = ?', [userId]],
      ['card_cooldowns', 'DELETE FROM card_cooldowns WHERE user_id = ?', [userId]],
      ['loans', 'DELETE FROM loans WHERE user_id = ?', [userId]],
      ['active_bonds', 'DELETE FROM active_bonds WHERE user_id = ?', [userId]],
      ['loan_payments', 'DELETE FROM loan_payments WHERE user_id = ?', [userId]],
      ['bond_history', 'DELETE FROM bond_history WHERE user_id = ?', [userId]],
      ['user_cards', 'DELETE FROM user_cards WHERE user_id = ?', [userId]],
      ['admin_logs', 'DELETE FROM admin_logs WHERE user_id = ?', [userId]],
      ['infamy_tracker', 'DELETE FROM infamy_tracker WHERE user_id = ?', [userId]],
      ['bounty_board', 'DELETE FROM bounty_board WHERE target_user_id = ?', [userId]],
      ['insider_trading_snapshots', 'DELETE FROM insider_trading_snapshots WHERE user_id = ?', [userId]],
      ['dungeon_tracker', 'DELETE FROM dungeon_tracker WHERE user_id = ?', [userId]],
      ['dungeon_history', 'DELETE FROM dungeon_history WHERE user_id = ?', [userId]],
      ['user_skills', 'DELETE FROM user_skills WHERE user_id = ?', [userId]],
      ['pets', 'DELETE FROM pets WHERE owner_id = ?', [userId]],
      // Clear gestation flag on any other player's pet that was gestating for this user
      ['pets (gestation cleanup)', "UPDATE pets SET gestating = 0, gestation_end = 0, gestating_for_user = NULL, gestating_male_id = NULL WHERE gestating_for_user = ?", [userId]],
    ];

    for (const [label, sql, params] of deletes) {
      try {
        db.run(sql, params);
      } catch (err) {
        // Ignore "no such table" errors so renamed/removed tables don't
        // abort the rest of the purge for this user or the next user.
        const msg = String(err && err.message || err);
        if (!/no such table/i.test(msg)) {
          console.error(`[purge-users] ${label} failed for ${userId}:`, msg);
        }
      }
    }

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
    
    // Show detailed liquidation breakdown per user
    const currency = getCurrency(guildId);
    for (const detail of results.liquidationDetails.slice(0, 5)) {
      // Build payout list for this liquidated user
      const payoutLines = detail.payouts.slice(0, 8).map(p => 
        `  └ <@${p.holderId}>: ${p.shares} shares → **${p.compensation.toLocaleString()}** ${currency}`
      );
      
      if (detail.payouts.length > 8) {
        payoutLines.push(`  └ ... and ${detail.payouts.length - 8} more`);
      }
      
      embed.addFields({
        name: `💸 ${detail.username}`,
        value: `Total: **${detail.compensation.toLocaleString()}** ${currency}\n${payoutLines.join('\n')}`,
        inline: false
      });
    }
    
    if (results.liquidationDetails.length > 5) {
      embed.addFields({
        name: '📋 Additional Liquidations',
        value: results.liquidationDetails.slice(5).map(d => 
          `• **${d.username}** — ${d.shareholders} shareholder(s) → ${d.compensation.toLocaleString()} ${currency}`
        ).join('\n').slice(0, 1000),
        inline: false
      });
    }
  }

  await interaction.editReply({ content: null, embeds: [embed], components: [] });
  return true;
};
