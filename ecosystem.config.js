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
      STATUS_WEBHOOK_URL: "https://discord.com/api/webhooks/1421106385281613838/AtaHjdpE9cyZ3r7ZASUtE0V8AM17NT6Gi4fNDkrEdrFnmB9ONTgK7RMZHx3VnpnqaM_g",
      
      // 🔥 AGGIUNGI QUESTE PER PM2 PLUS (dopo la registrazione)
      PM2_PUBLIC_KEY: "il-tuo-public-key",
      PM2_SECRET_KEY: "il-tuo-secret-key"
    }
  }],

  // 🔔 EVENTI PM2
  events: {
    start: "./pm2-events.js",
    stop: "./pm2-events.js", 
    restart: "./pm2-events.js",
    crash: "./pm2-events.js",
    delete: "./pm2-events.js"
  }
};
