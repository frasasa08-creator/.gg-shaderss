const { Events, EmbedBuilder } = require('discord.js');
const db = require('../db');

// Funzione per verificare e aggiungere le colonne verify se non esistono
async function ensureVerifyColumnsExist(guildId) {
    try {
        const columnsToCheck = [
            'verify_roles',
            'welcome_log_channel_id'
        ];
        
        for (const columnName of columnsToCheck) {
            const checkResult = await db.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'guild_settings' AND column_name = $1
            `, [columnName]);
            
            if (checkResult.rows.length === 0) {
                console.log(`Aggiungendo colonna ${columnName}...`);
                
                let alterQuery;
                if (columnName === 'verify_roles') {
                    alterQuery = `ALTER TABLE guild_settings ADD COLUMN ${columnName} JSONB`;
                } else {
                    alterQuery = `ALTER TABLE guild_settings ADD COLUMN ${columnName} TEXT`;
                }
                
                await db.query(alterQuery);
                console.log(`✅ Colonna ${columnName} aggiunta con successo`);
            }
        }
    } catch (error) {
        console.error('Errore verifica colonne verify:', error);
    }
}

// Funzione per parsare correttamente i verify_roles
function parseVerifyRoles(verifyRolesData) {
    if (!verifyRolesData) return [];
    
    // Se è già un array, restituiscilo direttamente
    if (Array.isArray(verifyRolesData)) {
        return verifyRolesData;
    }
    
    // Se è una stringa, prova a parsarla come JSON
    if (typeof verifyRolesData === 'string') {
        try {
            const parsed = JSON.parse(verifyRolesData);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Errore parsing verify_roles come JSON:', error);
            return [];
        }
    }
    
    // Se non è né array né stringa, restituisci array vuoto
    return [];
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (interaction.customId !== 'verify_button') return;

        try {
            await interaction.deferReply({ ephemeral: true });

            // Assicurati che le colonne esistano nel database
            await ensureVerifyColumnsExist(interaction.guild.id);

            // Recupera le impostazioni di verifica dal database
            const result = await db.query(
                'SELECT verify_roles FROM guild_settings WHERE guild_id = $1',
                [interaction.guild.id]
            );

            if (result.rows.length === 0 || !result.rows[0].verify_roles) {
                return await interaction.editReply({
                    content: '❌ Sistema di verifica non configurato correttamente. Usa prima `/setup_verify`.'
                });
            }

            // Usa la funzione di parsing migliorata
            const roleIds = parseVerifyRoles(result.rows[0].verify_roles);
            
            if (roleIds.length === 0) {
                console.error('Nessun ruolo valido trovato in verify_roles:', result.rows[0].verify_roles);
                return await interaction.editReply({
                    content: '❌ Configurazione dei ruoli non valida. Contatta lo staff.'
                });
            }

            console.log('Ruoli da assegnare:', roleIds);

            const rolesToAdd = [];
            const failedRoles = [];
            const missingRoles = [];

            // Verifica ogni ruolo
            for (const roleId of roleIds) {
                // Verifica che roleId sia una stringa valida
                if (typeof roleId !== 'string' || roleId.trim() === '') {
                    console.warn(`ID ruolo non valido: ${roleId}`);
                    missingRoles.push(roleId);
                    continue;
                }

                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    // Controlla se l'utente ha già il ruolo
                    if (interaction.member.roles.cache.has(roleId)) {
                        failedRoles.push(`${role.name} (già assegnato)`);
                    } else {
                        // Verifica che il bot possa assegnare il ruolo
                        const botMember = interaction.guild.members.me;
                        if (botMember.roles.highest.position > role.position) {
                            rolesToAdd.push(role);
                        } else {
                            failedRoles.push(`${role.name} (permessi insufficienti)`);
                        }
                    }
                } else {
                    missingRoles.push(roleId);
                    console.warn(`Ruolo non trovato: ${roleId} in ${interaction.guild.name}`);
                }
            }

            // Log dei ruoli mancanti
            if (missingRoles.length > 0) {
                console.warn(`⚠️ Ruoli non trovati in ${interaction.guild.name}:`, missingRoles);
            }

            // Assegna i ruoli
            if (rolesToAdd.length > 0) {
                try {
                    await interaction.member.roles.add(rolesToAdd);
                    
                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Verifica Completata!')
                        .setDescription('Sei stato verificato con successo! Benvenuto nel server! 🎉')
                        .addFields({
                            name: '🎉 Ruoli Assegnati',
                            value: rolesToAdd.map(role => role.toString()).join('\n') || 'Nessun ruolo assegnato',
                            inline: false
                        })
                        .setColor(0x00FF00)
                        .setTimestamp()
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }));

                    if (failedRoles.length > 0 || missingRoles.length > 0) {
                        let notes = [];
                        if (failedRoles.length > 0) notes.push(`**Ruoli non assegnati:**\n${failedRoles.join('\n')}`);
                        if (missingRoles.length > 0) notes.push(`**Ruoli non trovati:** ${missingRoles.length} ruoli`);
                        
                        successEmbed.addFields({
                            name: '⚠️ Note',
                            value: notes.join('\n'),
                            inline: false
                        });
                    }

                    await interaction.editReply({ embeds: [successEmbed] });

                    // Log della verifica
                    await logVerification(interaction, rolesToAdd, failedRoles, missingRoles);

                    console.log(`✅ Utente ${interaction.user.tag} verificato con successo in ${interaction.guild.name}`);

                } catch (roleError) {
                    console.error('Errore assegnazione ruoli:', roleError);
                    
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ Errore di Verifica')
                        .setDescription('Si è verificato un errore durante l\'assegnazione dei ruoli.')
                        .addFields({
                            name: '🔧 Cosa fare',
                            value: 'Contatta lo staff del server per assistenza.',
                            inline: false
                        })
                        .setColor(0xFF0000)
                        .setTimestamp();

                    await interaction.editReply({ 
                        embeds: [errorEmbed],
                        content: ' '
                    });
                }
            } else if (failedRoles.length > 0 && failedRoles.some(fr => fr.includes('già assegnato'))) {
                const infoEmbed = new EmbedBuilder()
                    .setTitle('ℹ️ Verifica già Completata')
                    .setDescription('Hai già tutti i ruoli di verifica!')
                    .addFields({
                        name: '📋 Ruoli già assegnati',
                        value: failedRoles.filter(fr => fr.includes('già assegnato'))
                                        .map(fr => fr.replace(' (già assegnato)', ''))
                                        .join('\n') || 'Nessun ruolo',
                        inline: false
                    })
                    .setColor(0x0099FF)
                    .setTimestamp();

                await interaction.editReply({ embeds: [infoEmbed] });
            } else {
                await interaction.editReply({
                    content: '❌ Nessun ruolo disponibile per l\'assegnazione. Contatta lo staff.'
                });
            }

        } catch (error) {
            console.error('Errore verifica:', error);
            
            try {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Errore di Sistema')
                    .setDescription('Si è verificato un errore durante la verifica.')
                    .addFields({
                        name: '🔧 Cosa fare',
                        value: 'Riprova più tardi o contatta lo staff del server.',
                        inline: false
                    })
                    .setColor(0xFF0000)
                    .setTimestamp();

                await interaction.editReply({ 
                    embeds: [errorEmbed],
                    content: ' '
                });
            } catch (replyError) {
                console.error('Errore anche nel reply di errore:', replyError);
            }
        }
    },
};

// Funzione per loggare la verifica
async function logVerification(interaction, rolesAdded, failedRoles = [], missingRoles = []) {
    try {
        // Cerca un canale log nel database
        const result = await db.query(
            'SELECT welcome_log_channel_id FROM guild_settings WHERE guild_id = $1',
            [interaction.guild.id]
        );

        if (result.rows.length === 0 || !result.rows[0].welcome_log_channel_id) return;

        const logChannel = interaction.guild.channels.cache.get(result.rows[0].welcome_log_channel_id);
        if (!logChannel) return;

        const logEmbed = new EmbedBuilder()
            .setTitle('✅ Utente Verificato')
            .setDescription(`**Utente:** ${interaction.user.tag} (\`${interaction.user.id}\`)`)
            .addFields(
                { 
                    name: '👥 Ruoli Assegnati', 
                    value: rolesAdded.length > 0 ? rolesAdded.map(role => role.toString()).join(', ') : 'Nessun ruolo', 
                    inline: false 
                },
                { 
                    name: '📅 Data Verifica', 
                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`, 
                    inline: true 
                },
                { 
                    name: '👤 Member Since', 
                    value: `<t:${Math.floor(interaction.member.joinedTimestamp / 1000)}:R>`, 
                    inline: true 
                }
            )
            .setColor(0x00FF00)
            .setTimestamp()
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }));

        if (failedRoles.length > 0) {
            logEmbed.addFields({
                name: '⚠️ Ruoli Non Assegnati',
                value: failedRoles.join('\n'),
                inline: false
            });
        }

        if (missingRoles.length > 0) {
            logEmbed.addFields({
                name: '🔍 Ruoli Mancanti',
                value: `${missingRoles.length} ruoli non trovati nel server`,
                inline: false
            });
        }

        await logChannel.send({ embeds: [logEmbed] });

        console.log(`📝 Log verifica inviato per ${interaction.user.tag} in ${interaction.guild.name}`);

    } catch (error) {
        console.error('Errore invio log verifica:', error);
    }
}