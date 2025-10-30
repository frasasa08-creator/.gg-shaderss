// commands/server-info.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Mostra info sui server del bot'),
    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        
        const servers = interaction.client.guilds.cache.map(guild => 
            `**${guild.name}** - ID: \`${guild.id}\` - Membri: ${guild.memberCount}`
        ).join('\n');
        
        await interaction.editReply({ 
            content: `🏠 **Server del bot (${interaction.client.guilds.cache.size}):**\n${servers}` 
        });
    }
};
