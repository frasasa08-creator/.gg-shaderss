#!/bin/bash
echo "🚀 Setup automatico avviato..."

# Rendi eseguibile il monitor
chmod +x monitor-bot.sh

# Avvia il bot e il monitor
pm2 start index.js --name discord-bot
pm2 start monitor-bot.sh --name bot-monitor

# Salva la configurazione PM2
pm2 save

echo "✅ Setup completato!"
echo "🤖 Bot: discord-bot"
echo "🛡️ Monitor: bot-monitor"
