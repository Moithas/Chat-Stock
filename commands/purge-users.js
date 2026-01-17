const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getDb, saveDatabase } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge-users')
    .setDescription('Remove users who are no longer in the server from the database (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Double-check admin permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permissions to use this command.', ephemeral: true });
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
    let removedCount = 0;
    let keptCount = 0;
    const removedUsers = [];

    // Check each user
    for (const [userId, username] of dbUsers) {
      try {
        // Try to fetch the member from the guild
        await interaction.guild.members.fetch(userId);
        keptCount++;
      } catch (error) {
        // User is not in the guild anymore, remove them
        removedUsers.push({ userId, username });
        
        // Remove from users table
        db.run('DELETE FROM users WHERE user_id = ?', [userId]);
        
        // Remove from balances table
        db.run('DELETE FROM balances WHERE user_id = ?', [userId]);
        
        // Remove from stocks table (both owned stocks and ownership)
        db.run('DELETE FROM stocks WHERE owner_id = ? OR stock_user_id = ?', [userId, userId]);
        
        // Remove from transactions
        db.run('DELETE FROM transactions WHERE buyer_id = ? OR stock_user_id = ?', [userId, userId]);
        
        // Remove from economy_transactions
        db.run('DELETE FROM economy_transactions WHERE user_id = ?', [userId]);
        
        // Remove from stock_purchases
        db.run('DELETE FROM stock_purchases WHERE owner_id = ? OR stock_user_id = ?', [userId, userId]);
        
        // Remove from price_history
        db.run('DELETE FROM price_history WHERE user_id = ?', [userId]);
        
        // Remove from work, crime, slut history
        db.run('DELETE FROM work_history WHERE user_id = ?', [userId]);
        db.run('DELETE FROM work_tracker WHERE user_id = ?', [userId]);
        db.run('DELETE FROM crime_history WHERE user_id = ?', [userId]);
        db.run('DELETE FROM crime_tracker WHERE user_id = ?', [userId]);
        db.run('DELETE FROM slut_history WHERE user_id = ?', [userId]);
        db.run('DELETE FROM slut_tracker WHERE user_id = ?', [userId]);
        db.run('DELETE FROM rob_history WHERE robber_id = ? OR target_id = ?', [userId, userId]);
        db.run('DELETE FROM rob_tracker WHERE user_id = ?', [userId]);
        
        // Remove from income history
        db.run('DELETE FROM passive_income_history WHERE user_id = ?', [userId]);
        db.run('DELETE FROM passive_income_tracker WHERE user_id = ?', [userId]);
        db.run('DELETE FROM role_income_history WHERE user_id = ?', [userId]);
        db.run('DELETE FROM role_income_tracker WHERE user_id = ?', [userId]);
        
        // Remove from dividend history
        db.run('DELETE FROM dividend_history WHERE stock_user_id = ? OR shareholder_id = ?', [userId, userId]);
        db.run('DELETE FROM self_dividend_history WHERE stock_user_id = ?', [userId]);
        
        // Remove from gambling tables
        db.run('DELETE FROM gambling_stats WHERE user_id = ?', [userId]);
        db.run('DELETE FROM scratch_stats WHERE user_id = ?', [userId]);
        db.run('DELETE FROM scratch_tickets WHERE user_id = ?', [userId]);
        db.run('DELETE FROM lottery_tickets WHERE user_id = ?', [userId]);
        db.run('DELETE FROM lottery_history WHERE user_id = ?', [userId]);
        
        // Remove from property ownership
        db.run('DELETE FROM owned_properties WHERE user_id = ?', [userId]);
        db.run('DELETE FROM card_cooldowns WHERE user_id = ?', [userId]);
        
        // Remove from loans and bonds
        db.run('DELETE FROM loans WHERE user_id = ?', [userId]);
        db.run('DELETE FROM active_bonds WHERE user_id = ?', [userId]);
        db.run('DELETE FROM loan_payments WHERE user_id = ?', [userId]);
        db.run('DELETE FROM bond_history WHERE user_id = ?', [userId]);
        
        // Remove from wealth cards
        db.run('DELETE FROM user_cards WHERE user_id = ?', [userId]);
        
        // Remove from admin logs
        db.run('DELETE FROM admin_logs WHERE user_id = ?', [userId]);
        
        removedCount++;
      }
    }

    // Save database
    saveDatabase();

    const embed = new EmbedBuilder()
      .setColor(removedCount > 0 ? 0xe74c3c : 0x2ecc71)
      .setTitle('🗑️ User Purge Complete')
      .addFields(
        { name: '✅ Users Kept', value: keptCount.toString(), inline: true },
        { name: '🗑️ Users Removed', value: removedCount.toString(), inline: true },
        { name: '📊 Total Checked', value: dbUsers.length.toString(), inline: true }
      )
      .setTimestamp();

    if (removedCount > 0 && removedCount <= 25) {
      // Show list of removed users (max 25 due to embed field limits)
      const removedList = removedUsers.map(u => `• ${u.username} (${u.userId})`).join('\n');
      embed.addFields({ name: 'Removed Users', value: removedList || 'None', inline: false });
    }

    embed.setDescription(
      removedCount > 0 
        ? '✅ Successfully removed users who are no longer in the server.' 
        : '✅ All users in the database are still in the server.'
    );

    await interaction.editReply({ embeds: [embed] });
  }
};
