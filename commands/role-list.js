const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-list')
        .setDescription('Mostra i ruoli persistenti di un utente')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('L\'utente da controllare')
                .setRequired(true)),
    
    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        
        try {
            const targetUser = interaction.options.getUser('user');
            
            // Recupera ruoli persistenti dal database
            const result = await db.query(
                'SELECT role_id, assigned_by, assigned_at FROM persistent_roles WHERE user_id = $1 AND guild_id = $2',
                [targetUser.id, interaction.guild.id]
            );
            
            if (result.rows.length === 0) {
                return await interaction.editReply({ 
                    content: `ℹ️ ${targetUser.tag} non ha ruoli persistenti.` 
                });
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`🎭 Ruoli Persistenti - ${targetUser.tag}`)
                .setColor(0x0099FF)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));
            
            for (const row of result.rows) {
                const role = interaction.guild.roles.cache.get(row.role_id);
                const assignedBy = await interaction.client.users.fetch(row.assigned_by).catch(() => ({ tag: 'Sconosciuto' }));
                
                if (role) {
                    embed.addFields({
                        name: role.name,
                        value: `Assegnato da: ${assignedBy.tag}\nData: <t:${Math.floor(new Date(row.assigned_at).getTime() / 1000)}:R>`,
                        inline: true
                    });
                }
            }
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Errore comando role-list:', error);
            await interaction.editReply({ 
                content: '❌ Errore durante il recupero dei ruoli!' 
            });
        }
    }
};
