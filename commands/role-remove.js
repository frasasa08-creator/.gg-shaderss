const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-remove')
        .setDescription('Rimuovi un ruolo persistente da un utente')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('L\'utente a cui rimuovere il ruolo')
                .setRequired(true))
        .addRoleOption(option => 
            option.setName('role')
                .setDescription('Il ruolo da rimuovere')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        
        try {
            const targetUser = interaction.options.getUser('user');
            const role = interaction.options.getRole('role');
            const member = interaction.guild.members.cache.get(targetUser.id);
            
            if (!member) {
                return await interaction.editReply({ 
                    content: '❌ Utente non trovato nel server!' 
                });
            }
            
            // Rimuovi ruolo
            await member.roles.remove(role);
            
            // Rimuovi dal database
            await db.query(
                'DELETE FROM persistent_roles WHERE user_id = $1 AND guild_id = $2 AND role_id = $3',
                [targetUser.id, interaction.guild.id, role.id]
            );
            
            await interaction.editReply({ 
                content: `✅ Ruolo ${role} rimosso da ${targetUser.tag}!` 
            });
            
        } catch (error) {
            console.error('Errore comando role-remove:', error);
            await interaction.editReply({ 
                content: '❌ Errore durante la rimozione del ruolo!' 
            });
        }
    }
};
