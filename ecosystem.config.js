module.exports = {
  apps: [{
    name: "discord-bot",
    script: "./index.js",
    instances: 1,
    exec_mode: "fork",
    
    // ✅ CONFIGURAZIONE PRODUZIONE
    autorestart: true,           // Riavvia se crasha
    watch: false,                // ❌ NO watch (meglio performance)
    max_memory_restart: "500M",  // Riavvia se memoria alta
    max_restarts: 10,            // Massimo 10 restart/15 secondi
    min_uptime: "10s",           // Considera stabile dopo 10s
    restart_delay: 3000,         // Aspetta 3s tra restart
    
    // 📊 Logging
    log_file: "./logs/combined.log",
    out_file: "./logs/out.log",
    error_file: "./logs/error.log",
    time: true,
    
    env: {
      NODE_ENV: "production"
    }
  }]
};
