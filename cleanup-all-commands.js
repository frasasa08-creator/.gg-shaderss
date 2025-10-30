// cleanup-all-commands.js - Esegui una volta sola
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function resetAllCommands() {
    try {
        console.log('🧹 RESET COMPLETO DI TUTTI I COMANDI...');

        // 1. Reset comandi globali
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
        console.log('✅ Comandi globali resettati');

        // 2. Reset comandi in tutti i server
        const guilds = ['ID_SERVER_1', 'ID_SERVER_2']; // Inserisci gli ID dei tuoi server
        
        for (const guildId of guilds) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                    { body: [] }
                );
                console.log(`✅ Comandi resettati nel server ${guildId}`);
            } catch (error) {
                console.log(`⚠️ Errore reset server ${guildId}:`, error.message);
            }
        }

        console.log('🎉 Reset completato! Ora riavvia il bot.');
        
    } catch (error) {
        console.error('❌ Errore reset:', error);
    }
}

resetAllCommands();
