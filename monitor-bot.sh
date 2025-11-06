cat > monitor-bot.sh << 'EOF'
#!/bin/bash

WEBHOOK="https://discord.com/api/webhooks/1421106385281613838/AtaHjdpE9cyZ3r7ZASUtE0V8AM17NT6Gi4fNDkrEdrFnmB9ONTgK7RMZHx3VnpnqaM_g"

echo "🔍 Avvio monitoraggio bot..."

while true; do
    if pm2 status | grep -q "discord-bot.*online"; then
        echo "✅ Bot online - $(date)"
    else
        echo "❌ Bot OFFLINE! Invio notifica..."
        
        # Webhook di notifica CRASH
        curl -s -X POST "$WEBHOOK" \
          -H "Content-Type: application/json" \
          -d '{"content": "🔴 **CRASH BOT** - Il bot è crashato! Riavvio automatico in corso..."}' > /dev/null
        
        echo "📤 Notifica crash inviata"
        
        # Riavvia il bot
        pm2 restart discord-bot
        sleep 5
        
        # Webhook di conferma RIAVVIO
        curl -s -X POST "$WEBHOOK" \
          -H "Content-Type: application/json" \
          -d '{"content": "✅ **BOT RIAVVIATO** - Il bot è tornato online!"}' > /dev/null
        
        echo "📤 Conferma riavvio inviata"
    fi
    sleep 30  # Controlla ogni 30 secondi invece di 60
done
EOF
