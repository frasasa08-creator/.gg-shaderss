// commands/logs.js
const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Mostra gli ultimi log del bot')
        .addIntegerOption(option =>
            option.setName('righe')
                .setDescription('Numero di righe da mostrare (default: 20)')
                .setRequired(false)),

    async execute(interaction) {
        const OWNER_IDS = ['1140218068417650823'];
        
        if (!OWNER_IDS.includes(interaction.user.id)) {
            return interaction.reply({ 
                content: '❌ **Accesso Negato**',
                ephemeral: true 
            });
        }

        await interaction.deferReply();

        const lines = interaction.options.getInteger('righe') || 20;
        
        try {
            // Prova a leggere diversi file di log
            const logFiles = [
                './logs/combined.log',
                './logs/out.log', 
                './logs/error.log',
                './pm2-logs.log'
            ];

            let logContent = '';
            
            for (const logFile of logFiles) {
                try {
                    const content = await fs.readFile(logFile, 'utf8');
                    const linesArray = content.split('\n').filter(line => line.trim());
                    const lastLines = linesArray.slice(-lines).join('\n');
                    
                    logContent += `**📁 ${path.basename(logFile)}**:\n\`\`\`bash\n${lastLines || 'File vuoto'}\n\`\`\`\n`;
                    
                    if (logContent.length > 1500) break; // Evita messaggi troppo lunghi
                } catch (error) {
                    logContent += `**📁 ${path.basename(logFile)}**: ❌ Non trovato\n`;
                }
            }

            if (!logContent) {
                logContent = '❌ Nessun file di log trovato';
            }

            interaction.editReply(logContent);

        } catch (error) {
            interaction.editReply(`❌ Errore lettura log: ${error.message}`);
        }
    }
};
