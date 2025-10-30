const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { createDatabase } = require('../config/database');

// Connessione database per questo comando
const db = createDatabase();

// Funzione per controllare i permessi
async function checkPermissions(interaction) {
    if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    const result = await db.query(
        'SELECT settings FROM guild_settings WHERE guild_id = $1',
        [interaction.guild.id]
    );

    if (result.rows.length === 0) {
        return false;
    }

    const settings = result.rows[0].settings || {};
    const allowedRoles = settings.allowed_roles || [];
    const userRoles = interaction.member.roles.cache;
    return allowedRoles.some(roleId => userRoles.has(roleId));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forcecloseticket')
        .setDescription('Forza la chiusura di un ticket per un utente specifico')
        .addUserOption(option =>
            option.setName('utente')
                .setDescription('L\'utente di cui vuoi chiudere il ticket')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('motivo')
                .setDescription('Motivo della chiusura forzata')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        try {
            // Controllo permessi
            const hasPermission = await checkPermissions(interaction);
            if (!hasPermission) {
                return await interaction.reply({
                    content: '❌ Non hai i permessi necessari per utilizzare questo comando.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const targetUser = interaction.options.getUser('utente');
            const reason = interaction.options.getString('motivo') || "Forzatura amministrativa";

            // Prima verifica se esiste UN QUALSIASI ticket per questo utente
            const anyTicket = await db.query(
                'SELECT id, status, category FROM tickets WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
                [interaction.guild.id, targetUser.id]
            );

            if (anyTicket.rows.length === 0) {
                return await interaction.editReply({
                    content: `❌ Nessun ticket trovato per l'utente ${targetUser.tag}`
                });
            }

            const ticket = anyTicket.rows[0];
            
            if (ticket.status === 'closed') {
                return await interaction.editReply({
                    content: `ℹ️ Il ticket di ${targetUser.tag} è già chiuso`
                });
            }

            if (ticket.status === 'open') {
                await db.query(
                    'UPDATE tickets SET status = $1, closed_at = NOW(), close_reason = $2 WHERE id = $3',
                    ['closed', reason, ticket.id]
                );

                const embed = new EmbedBuilder()
                    .setTitle('✅ Ticket Chiuso Forzatamente')
                    .setDescription(`Il ticket di ${targetUser.tag} è stato chiuso con successo`)
                    .addFields(
                        { name: '👤 Utente', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                        { name: '📋 Categoria', value: ticket.category || 'N/A', inline: true },
                        { name: '📝 Motivo', value: reason, inline: false }
                    )
                    .setColor(0x00ff00)
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

                try {
                    const ticketChannel = await interaction.guild.channels.fetch(ticket.id);
                    if (ticketChannel) {
                        await ticketChannel.delete();
                    }
                } catch (channelError) {
                    console.log('Canale ticket non trovato o già eliminato:', channelError.message);
                }

                console.log(`✅ Ticket forzatamente chiuso per ${targetUser.tag} nel server ${interaction.guild.name}`);
                return;
            }

        } catch (error) {
            console.error('Errore comando forcecloseticket:', error);
            await interaction.editReply({
                content: `❌ Errore durante la chiusura forzata del ticket: ${error.message}`
            });
        }
    },

    async forceCloseTicket(guildId, userId, reason = "Forzatura amministrativa") {
        try {
            const anyTicket = await db.query(
                'SELECT id, status FROM tickets WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
                [guildId, userId]
            );

            if (anyTicket.rows.length === 0) {
                return { success: false, message: "Nessun ticket trovato per questo utente" };
            }

            const ticket = anyTicket.rows[0];
            
            if (ticket.status === 'closed') {
                return { success: true, message: "Ticket già chiuso" };
            }

            if (ticket.status === 'open') {
                await db.query(
                    'UPDATE tickets SET status = $1, closed_at = NOW(), close_reason = $2 WHERE id = $3',
                    ['closed', reason, ticket.id]
                );
                return { success: true, message: "Ticket chiuso con successo" };
            }

        } catch (error) {
            console.error("Errore durante la forzatura chiusura ticket:", error);
            return { success: false, message: "Errore durante la chiusura del ticket" };
        }
    }
};