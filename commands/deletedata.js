const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDb, saveDatabase } = require('../database');
const { getCurrency } = require('../admin');

// Track pending confirmations to prevent duplicate processing
const pendingDeletions = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deletedata')
    .setDescription('Delete ALL your data from this server (GDPR). This cannot be undone!'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    // Check for pending confirmation
    if (pendingDeletions.has(`${guildId}_${userId}`)) {
      return interaction.reply({
        content: '⚠️ You already have a pending data deletion request. Please confirm or cancel it.',
        flags: 64
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚠️ Delete All Your Data')
      .setDescription(
        `**This will permanently delete ALL of your data from this server:**\n\n` +
        `• Balance (cash + bank)\n` +
        `• Stock portfolio & trade history\n` +
        `• Properties, cards & upgrades\n` +
        `• Skills & stats (gambling, fight, work, etc.)\n` +
        `• Loans, bonds & credit score\n` +
        `• Inventory & item effects\n` +
        `• All game history & tracker data\n` +
        `• Infamy, bounties & crime records\n\n` +
        `🚨 **This action is IRREVERSIBLE.** You will start completely fresh if you continue playing.`
      )
      .setFooter({ text: 'This confirmation expires in 60 seconds.' })
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('deletedata_confirm')
        .setLabel('DELETE EVERYTHING')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId('deletedata_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    pendingDeletions.set(`${guildId}_${userId}`, Date.now());

    // Auto-expire after 60 seconds
    setTimeout(() => {
      pendingDeletions.delete(`${guildId}_${userId}`);
    }, 60000);

    await interaction.reply({ embeds: [embed], components: [buttons], flags: 64 });
  }
};

module.exports.handleButton = async function(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const action = interaction.customId;

  if (action === 'deletedata_cancel') {
    pendingDeletions.delete(`${guildId}_${userId}`);
    return interaction.update({
      content: '✅ Data deletion cancelled. Your data is safe.',
      embeds: [],
      components: []
    });
  }

  if (action === 'deletedata_confirm') {
    if (!pendingDeletions.has(`${guildId}_${userId}`)) {
      return interaction.update({
        content: '❌ This confirmation has expired. Use `/deletedata` again.',
        embeds: [],
        components: []
      });
    }

    pendingDeletions.delete(`${guildId}_${userId}`);
    await interaction.update({
      content: '🔄 Deleting all your data... Please wait.',
      embeds: [],
      components: []
    });

    try {
      const db = getDb();
      const deleted = deleteAllUserData(db, guildId, userId);

      saveDatabase();

      await interaction.editReply({
        content: `✅ **All your data has been permanently deleted from this server.**\n\n` +
          `Removed data from **${deleted}** database tables.\n` +
          `If you send a message or use a command, a fresh account will be created automatically.`
      });
    } catch (error) {
      console.error(`[GDPR] Error deleting data for user ${userId} in guild ${guildId}:`, error);
      await interaction.editReply({
        content: '❌ An error occurred while deleting your data. Please contact a server admin.'
      });
    }
  }
};

/**
 * Delete all user data from a specific guild.
 * Returns the number of tables cleaned.
 */
function deleteAllUserData(db, guildId, userId) {
  let tablesDeleted = 0;

  // Helper to run a DELETE and count affected
  const del = (sql, params) => {
    try {
      db.run(sql, params);
      tablesDeleted++;
    } catch (e) {
      // Table may not exist yet — skip silently
    }
  };

  // === Tables with guild_id + user_id ===
  del('DELETE FROM balances WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM economy_transactions WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM owned_properties WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM property_upgrades WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM user_cards WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM card_cooldowns WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM user_skills WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM slut_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM slut_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM inbetween_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM inbetween_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM hack_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM dungeon_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM dungeon_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM loans WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM loan_payments WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM active_bonds WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM bond_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM loan_credit_scores WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM syn_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM rob_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM rob_user_immunity WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM rob_immunity_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM user_inventory WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM active_effects WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM item_purchase_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM item_fulfillment_requests WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM effect_use_cooldowns WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM temporary_role_grants WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM passive_income_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM passive_income_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM role_income_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM role_income_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM lottery_tickets WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM lottery_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM scratch_tickets WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM scratch_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM letitride_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM letitride_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM threecardpoker_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM threecardpoker_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM luckypenny_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM work_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM work_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM hunt_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM hunt_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM bump_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM infamy_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM insider_trading_snapshots WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM admin_logs WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM fighter_stats WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM fight_opponent_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM fight_spectator_bets WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM crime_tracker WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM crime_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM error_log WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  del('DELETE FROM wealth_tax_history WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  // === Tables with alternate user column names ===
  del('DELETE FROM hack_target_tracker WHERE guild_id = ? AND target_id = ?', [guildId, userId]);
  del('DELETE FROM hack_history WHERE guild_id = ? AND (hacker_id = ? OR target_id = ?)', [guildId, userId, userId]);
  del('DELETE FROM rob_target_tracker WHERE guild_id = ? AND target_id = ?', [guildId, userId]);
  del('DELETE FROM rob_gift_protection WHERE guild_id = ? AND (giver_id = ? OR recipient_id = ?)', [guildId, userId, userId]);
  del('DELETE FROM rob_history WHERE guild_id = ? AND (robber_id = ? OR target_id = ?)', [guildId, userId, userId]);
  del('DELETE FROM fight_history WHERE guild_id = ? AND (fighter1_id = ? OR fighter2_id = ?)', [guildId, userId, userId]);
  del('DELETE FROM dividend_history WHERE guild_id = ? AND (shareholder_id = ? OR stock_user_id = ?)', [guildId, userId, userId]);
  del('DELETE FROM self_dividend_history WHERE guild_id = ? AND stock_user_id = ?', [guildId, userId]);
  del('DELETE FROM split_history WHERE guild_id = ? AND stock_user_id = ?', [guildId, userId]);
  del('DELETE FROM stock_purchases WHERE guild_id = ? AND owner_id = ?', [guildId, userId]);
  del('DELETE FROM bounty_board WHERE guild_id = ? AND (target_user_id = ? OR claimed_by = ?)', [guildId, userId, userId]);

  // === Global tables (no guild_id) — delete user's global stock profile ===
  del('DELETE FROM stocks WHERE owner_id = ? OR stock_user_id = ?', [userId, userId]);
  del('DELETE FROM transactions WHERE buyer_id = ? OR stock_user_id = ?', [userId, userId]);
  del('DELETE FROM price_history WHERE user_id = ?', [userId]);
  del('DELETE FROM gambling_stats WHERE user_id = ?', [userId]);
  del('DELETE FROM users WHERE user_id = ?', [userId]);

  return tablesDeleted;
}
