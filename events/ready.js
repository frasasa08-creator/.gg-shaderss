const { Events } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        console.log(`✅ Bot pronto! Logged in come ${client.user.tag}`);
        console.log(`📊 Server: ${client.guilds.cache.size}`);
        console.log(`👥 Utenti: ${client.users.cache.size}`);
        
        // Imposta l'attività del bot
        client.user.setActivity('🎫 Gestione Server', { type: 'WATCHING' });
    },
};