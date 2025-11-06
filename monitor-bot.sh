#!/bin/bash

WEBHOOK="https://discord.com/api/webhooks/1421106385281613838/AtaHjdpE9cyZ3r7ZASUtE0V8AM17NT6Gi4fNDkrEdrFnmB9ONTgK7RMZHx3VnpnqaM_g"

echo "🔍 Avvio monitoraggio bot..."

while true; do
    if pm2 status | grep -q "discord-bot.*online"; then
        echo "✅ Bot online - $(date)"
    else
        echo "❌ Bot OFFLINE! Riavvio..."
        
        curl -X POST "$WEBHOOK" \
          -H "Content-Type: application/json" \
          -d '{"content": "🔴 Il bot è crashato! Riavvio in corso..."}'
        
        pm2 restart discord-bot
        sleep 10
        
        curl -X POST "$WEBHOOK" \
          -H "Content-Type: application/json" \
          -d '{"content": "✅ Bot riavviato!"}'
    fi
    sleep 60
done
