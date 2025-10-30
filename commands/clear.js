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
        .setName('clear')
        .setDescription('Pulisci un numero specifico di messaggi')
        .addIntegerOption(option =>
            option
                .setName('quantità')
                .setDescription('Numero di messaggi da eliminare (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addUserOption(option =>
            option
                .setName('utente')
                .setDescription('Pulisci solo i messaggi di un utente specifico')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    
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

            const amount = interaction.options.getInteger('quantità');
            const targetUser = interaction.options.getUser('utente');

            if (amount < 1 || amount > 100) {
                return await interaction.editReply({
                    content: '❌ Devi specificare un numero tra 1 e 100!'
                });
            }

            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            let messagesToDelete = messages;

            if (targetUser) {
                messagesToDelete = messages.filter(msg => msg.author.id === targetUser.id);
            }

            const filteredMessages = Array.from(messagesToDelete.values()).slice(0, amount);

            if (filteredMessages.length === 0) {
                return await interaction.editReply({
                    content: '❌ Nessun messaggio trovato da eliminare!'
                });
            }

            if (interaction.channel.isTextBased()) {
                await interaction.channel.bulkDelete(filteredMessages, true);
            }

            const embed = new EmbedBuilder()
                .setTitle('🧹 Pulizia Messaggi Completata')
                .setDescription(`**${filteredMessages.length}** messaggi eliminati con successo!`)
                .addFields(
                    { name: '📊 Messaggi Eliminati', value: filteredMessages.length.toString(), inline: true },
                    { name: '👤 Utente Target', value: targetUser ? targetUser.tag : 'Tutti gli utenti', inline: true },
                    { name: '📅 Data', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ 
                    text: `Eseguito da ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL() 
                });

            await interaction.editReply({ embeds: [embed] });

            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (error) {
                    // Ignora se il messaggio è già stato cancellato
                }
            }, 10000);

            console.log(`✅ Pulizia effettuata da ${interaction.user.tag} in ${interaction.channel.name}: ${filteredMessages.length} messaggi eliminati`);

        } catch (error) {
            console.error('Errore comando clear:', error);
            
            if (error.code === 50034) {
                await interaction.editReply({
                    content: '❌ Non puoi eliminare messaggi più vecchi di 14 giorni!'
                });
            } else {
                await interaction.editReply({
                    content: `❌ Errore durante la pulizia: ${error.message}`
                });
            }
        }
    },
};
