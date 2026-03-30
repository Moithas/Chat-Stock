module.exports = {
  apps: [{
    name: 'black-ledger',
    script: 'bot.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    kill_timeout: 5000,           // 5s for graceful shutdown before SIGKILL
    listen_timeout: 10000,        // 10s to consider app "online"
    restart_delay: 3000,          // 3s between crash restarts
    max_restarts: 10,             // Max 10 restarts in window
    min_uptime: 10000,            // Must run 10s to count as stable
    env: {
      NODE_ENV: 'production'
    }
  }]
};
