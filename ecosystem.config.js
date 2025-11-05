module.exports = {
  apps: [{
    name: "discord-bot",
    script: "./index.js",
    instances: 1,
    exec_mode: "fork",
    
    // ✅ CONFIGURAZIONE PRODUZIONE
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 3000,
    
    // 📊 Logging
    log_file: "./logs/combined.log",
    out_file: "./logs/out.log",
    error_file: "./logs/error.log",
    time: true,
    
    env: {
      NODE_ENV: "production",
      STATUS_WEBHOOK_URL: "https://discord.com/api/webhooks/IL_TUO_WEBHOOK_URL"
    }
  }],

  // 🔔 AGGIUNGI QUESTA SEZIONE EVENTI PM2
  events: {
    start: "./pm2-events.js",
    stop: "./pm2-events.js", 
    restart: "./pm2-events.js",
    crash: "./pm2-events.js",
    delete: "./pm2-events.js"
  }
};
