// commands/terminal.js
const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');
const os = require('os');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('terminal')
        .setDescription('Esegui comandi sul server (Owner only)')
        .addStringOption(option =>
            option.setName('comando')
                .setDescription('Comando da eseguire')
                .setRequired(true)),

    async execute(interaction) {
        // ✅ SOLO TU PUOI USARLO - SOSTITUISCI CON IL TUO ID DISCORD
        const OWNER_IDS = ['606567078529007626', '123456789012345678']; // Aggiungi il tuo ID Discord qui
        
        if (!OWNER_IDS.includes(interaction.user.id)) {
            return interaction.reply({ 
                content: '❌ **Accesso Negato**\nSolo il proprietario del bot può usare questo comando.',
                ephemeral: true 
            });
        }

        const command = interaction.options.getString('comando');
        
        // 🔒 COMANDI BLOCCATI per sicurezza
        const blockedCommands = ['rm -rf', 'format', 'mkfs', 'dd', 'shutdown', 'reboot'];
        if (blockedCommands.some(cmd => command.toLowerCase().includes(cmd))) {
            return interaction.reply({
                content: '❌ **Comando Bloccato**\nQuesto comando è pericoloso e non può essere eseguito.',
                ephemeral: true
            });
        }

        await interaction.deferReply(); // ⚠️ IMPORTANTE per comandi lunghi

        // 🖥️ Informazioni sistema
        const systemInfo = {
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            memory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
            uptime: `${Math.round(os.uptime() / 60 / 60)}h`
        };

        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
            let output = '';
            
            // 📊 Header con info sistema
            output += `**🖥️ Sistema**: ${systemInfo.platform} ${systemInfo.arch} | **CPU**: ${systemInfo.cpus} core | **RAM**: ${systemInfo.memory} | **Uptime**: ${systemInfo.uptime}\n`;
            output += `**📟 Comando**: \`${command}\`\n`;
            output += '```bash\n';

            if (error) {
                output += `❌ ERRORE: ${error.message}\n`;
            }
            
            if (stderr) {
                output += `⚠️ STDERR: ${stderr}\n`;
            }
            
            if (stdout) {
                output += stdout;
            }

            // Se non c'è output
            if (!error && !stderr && !stdout) {
                output += '✅ Comando eseguito (nessun output)';
            }

            output += '\n```';

            // 🔄 Gestione output troppo lungo
            if (output.length > 1900) {
                output = output.substring(0, 1900) + '\n```\n⚠️ Output troncato (troppo lungo)';
            }

            interaction.editReply(output);
        });
    }
};
