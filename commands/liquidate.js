const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getPortfolio, getAllStockHolders, calculateStockPrice, getDb, saveDatabase } = require('../database');
const { addToBank } = require('../economy');
const { calculateSellFee, getGuildSettings } = require('../fees');
const { getCurrency } = require('../admin');



module.exports = {
  data: new SlashCommandBuilder()
    .setName('liquidate')
    .setDescription('[ADMIN] Force liquidate a user\'s stock holdings and compensate shareholders')
    .addStringOption(option =>
      option.setName('user')
        .setDescription('The user ID or @mention to liquidate')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    // Check if user is admin (has ADMINISTRATOR permission)
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ You need Administrator permission to use this command.',
        flags: 64
      });
    }

    const guildId = interaction.guildId;
    const userInput = interaction.options.getString('user');
    
    // Extract user ID from mention (<@123>) or raw ID
    const targetUserId = userInput.replace(/[<@!>]/g, '').trim();
    
    if (!/^\d{17,20}$/.test(targetUserId)) {
      return interaction.reply({
        content: '❌ Invalid user. Provide a user ID or @mention.',
        flags: 64
      });
    }
    
    // Try to fetch user info (works even if they left the server)
    let targetUsername = targetUserId;
    try {
      const fetchedUser = await interaction.client.users.fetch(targetUserId);
      targetUsername = fetchedUser.username;
    } catch {
      // User may be deleted entirely — use ID as fallback
      targetUsername = `Unknown (${targetUserId})`;
    }
    
    const db = getDb();

    const user = getUser(targetUserId);
    if (!user) {
      return interaction.reply({
        content: `❌ User ${targetUsername} not found in database.`,
        flags: 64
      });
    }

    // Get all shareholders of this user's stock (people who own shares in the target)
    const shareholders = getAllStockHolders(targetUserId);
    
    // Get the target's portfolio (stocks they own in others)
    const portfolio = getPortfolio(targetUserId);

    if (shareholders.length === 0 && portfolio.length === 0) {
      return interaction.reply({
        content: `ℹ️ ${targetUsername} has no stock holdings and no shareholders.`,
        flags: 64
      });
    }

    await interaction.deferReply();

    const results = {
      shareholdersCompensated: 0,
      totalCompensation: 0,
      totalFees: 0,
      shareholderDetails: [],
      stocksDeleted: 0
    };

    // 1. Compensate shareholders of the target's stock (people who own shares IN the target)
    if (shareholders.length > 0) {
      const currentPrice = calculateStockPrice(targetUserId, guildId);
      
      for (const holder of shareholders) {
        // Skip if the holder is the target themselves
        if (holder.ownerId === targetUserId) continue;
        
        const grossValue = Math.round(holder.shares * currentPrice);
        const fee = calculateSellFee(guildId, grossValue);
        const netCompensation = grossValue - fee;
        
        if (netCompensation > 0) {
          // Add to holder's bank
          await addToBank(guildId, holder.ownerId, netCompensation, `Liquidation compensation for ${targetUsername}'s stock`);
          
          results.shareholdersCompensated++;
          results.totalCompensation += netCompensation;
          results.totalFees += fee;
          results.shareholderDetails.push({
            ownerId: holder.ownerId,
            shares: holder.shares,
            gross: grossValue,
            fee: fee,
            net: netCompensation
          });
        }
        
        // Delete this shareholder's holding of the target's stock
        db.run('DELETE FROM stocks WHERE owner_id = ? AND stock_user_id = ?', [holder.ownerId, targetUserId]);
      }
      
      // Also delete target's self-held shares if any
      db.run('DELETE FROM stocks WHERE owner_id = ? AND stock_user_id = ?', [targetUserId, targetUserId]);
    }

    // 2. Delete all stocks the target owns in OTHER people (no compensation)
    if (portfolio.length > 0) {
      for (const holding of portfolio) {
        // Skip self-owned stock (already handled above)
        if (holding.stock_user_id === targetUserId) continue;
        
        db.run('DELETE FROM stocks WHERE owner_id = ? AND stock_user_id = ?', [targetUserId, holding.stock_user_id]);
        results.stocksDeleted++;
      }
    }

    // Save all changes
    saveDatabase();

    // Build response embed
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`💸 Liquidation Complete: ${targetUsername}`)
      .setDescription(`All stock holdings for **${targetUsername}** have been liquidated.`)
      .addFields(
        { name: '👥 Shareholders Compensated', value: `${results.shareholdersCompensated}`, inline: true },
        { name: '💰 Total Compensation', value: `${results.totalCompensation.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '💸 Fees Collected', value: `${results.totalFees.toLocaleString()} ${getCurrency(guildId)}`, inline: true },
        { name: '📉 Target\'s Holdings Deleted', value: `${results.stocksDeleted} stock(s)`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: `Liquidated by ${interaction.user.username}` });

    // Add shareholder breakdown if not too many
    if (results.shareholderDetails.length > 0 && results.shareholderDetails.length <= 10) {
      const breakdown = results.shareholderDetails.map(s => 
        `<@${s.ownerId}>: ${s.shares} shares → ${s.net.toLocaleString()} ${getCurrency(guildId)} (fee: ${s.fee.toLocaleString()})`
      ).join('\n');
      embed.addFields({ name: '📋 Compensation Breakdown', value: breakdown, inline: false });
    } else if (results.shareholderDetails.length > 10) {
      embed.addFields({ 
        name: '📋 Compensation Breakdown', 
        value: `Too many shareholders to list (${results.shareholderDetails.length} total)`, 
        inline: false 
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
