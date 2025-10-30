const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-add')
        .setDescription('Aggiungi un ruolo persistente a un utente')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('L\'utente a cui assegnare il ruolo')
                .setRequired(true))
        .addRoleOption(option => 
            option.setName('role')
                .setDescription('Il ruolo da assegnare')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
        // ⬇️⬇️⬇️ DEFER REPLY SUBITO ⬇️⬇️⬇️
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
            
            // Controlla permessi bot
            const botMember = interaction.guild.members.me;
            if (botMember.roles.highest.position <= role.position) {
                return await interaction.editReply({ 
                    content: `❌ Non posso assegnare il ruolo ${role.name} perché è più alto dei miei ruoli!` 
                });
            }
            
            // Assegna ruolo
            await member.roles.add(role);
            
            // Salva nel database
            await db.query(
                'INSERT INTO persistent_roles (user_id, guild_id, role_id, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, guild_id, role_id) DO NOTHING',
                [targetUser.id, interaction.guild.id, role.id, interaction.user.id]
            );
            
            await interaction.editReply({ 
                content: `✅ Ruolo ${role} assegnato persistentemente a ${targetUser.tag}!` 
            });
            
        } catch (error) {
            console.error('Errore comando role-add:', error);
            await interaction.editReply({ 
                content: '❌ Errore durante l\'assegnazione del ruolo!' 
            });
        }
    }
};
