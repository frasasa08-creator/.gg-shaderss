cat > monitor-bot.sh << 'EOF'
#!/bin/bash

WEBHOOK="https://discord.com/api/webhooks/1421106385281613838/AtaHjdpE9cyZ3r7ZASUtE0V8AM17NT6Gi4fNDkrEdrFnmB9ONTgK7RMZHx3VnpnqaM_g"

echo "🔍 Avvio monitoraggio bot..."

while true; do
    # Controlla se il bot è online
    if pm2 status | grep -q "discord-bot.*online"; then
        echo "✅ Bot online - $(date)"
    else
        echo "❌ Bot OFFLINE! Riavvio..."
        
        curl -X POST "$WEBHOOK" \
          -H "Content-Type: application/json" \
          -d '{"content": "🔴 Bot offline! Riavvio automatico..."}'
        
        # Forza il riavvio anche se stopped
        pm2 restart discord-bot
        
        sleep 10
        
        # Conferma
        if pm2 status | grep -q "discord-bot.*online"; then
            curl -X POST "$WEBHOOK" \
              -H "Content-Type: application/json" \
              -d '{"content": "✅ Bot riavviato con successo!"}'
        else
            curl -X POST "$WEBHOOK" \
              -H "Content-Type: application/json" \
              -d '{"content": "❌ Errore nel riavvio del bot!"}'
        fi
    fi
    sleep 60
done
EOF
