const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot and Discord latency to diagnose response issues'),

  async execute(interaction) {
    const start = Date.now();

    // 1) Send initial reply (measures API round-trip)
    await interaction.reply({ content: '🏓 Pinging…', withResponse: true });
    const apiLatency = Date.now() - start;

    // 2) WebSocket heartbeat (Discord gateway latency — not our bot)
    const wsLatency = interaction.client.ws.ping;

    // 3) Database query speed
    let dbLatency = -1;
    try {
      const dbStart = Date.now();
      const db = getDb();
      if (db) {
        db.exec('SELECT 1');
      }
      dbLatency = Date.now() - dbStart;
    } catch {
      dbLatency = -1;
    }

    // 4) Bot uptime
    const uptimeMs = interaction.client.uptime;
    const uptimeSec = Math.floor(uptimeMs / 1000);
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeStr = days > 0
      ? `${days}d ${hours}h ${minutes}m ${seconds}s`
      : hours > 0
        ? `${hours}h ${minutes}m ${seconds}s`
        : `${minutes}m ${seconds}s`;

    // Color based on worst latency
    const worst = Math.max(apiLatency, wsLatency);
    const color = worst < 150 ? 0x43b581   // green
               : worst < 400 ? 0xfaa61a   // yellow
               :                0xf04747;  // red

    // Status indicator helper
    const indicator = (ms) => {
      if (ms < 0) return '❌ error';
      if (ms < 100) return `🟢 ${ms}ms`;
      if (ms < 250) return `🟡 ${ms}ms`;
      return `🔴 ${ms}ms`;
    };

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor(color)
      .addFields(
        {
          name: '📡 Discord WebSocket',
          value: indicator(wsLatency),
          inline: true
        },
        {
          name: '🌐 API Round-Trip',
          value: indicator(apiLatency),
          inline: true
        },
        {
          name: '🗄️ Database',
          value: indicator(dbLatency),
          inline: true
        },
        {
          name: '⏱️ Uptime',
          value: uptimeStr,
          inline: true
        }
      )
      .setFooter({ text: 'High Discord WS/API = Discord issue · High Database = bot issue' })
      .setTimestamp();

    await interaction.editReply({ content: null, embeds: [embed] });
  }
};
