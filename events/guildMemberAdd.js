const { Events, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { createWelcomeEmbed } = require('../utils/welcomeUtils'); // Assicurati che il percorso sia corretto

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            // ==================== RIPRISTINO RUOLI PERSISTENTI ====================
            await restorePersistentRoles(member);
            
            // ==================== SISTEMA WELCOME ====================
            await handleWelcomeSystem(member);

        } catch (error) {
            console.error('Errore evento guildMemberAdd:', error);
        }
    },
};

// ==================== FUNZIONE RIPRISTINO RUOLI PERSISTENTI ====================
async function restorePersistentRoles(member) {
    try {
        // Recupera i ruoli persistenti dal database
        const result = await db.query(
            'SELECT role_id FROM persistent_roles WHERE user_id = $1 AND guild_id = $2',
            [member.user.id, member.guild.id]
        );

        if (result.rows.length === 0) {
            console.log(`ℹ️  Nessun ruolo persistente da ripristinare per ${member.user.tag}`);
            return;
        }

        const rolesToRestore = [];
        const failedRoles = [];

        // Verifica ogni ruolo e prepara per l'assegnazione
        for (const row of result.rows) {
            const role = member.guild.roles.cache.get(row.role_id);
            
            if (role) {
                // Controlla se il bot può gestire questo ruolo
                const botMember = member.guild.members.me;
                if (botMember.roles.highest.position > role.position) {
                    rolesToRestore.push(role);
                } else {
                    failedRoles.push(role.name);
                    console.log(`⚠️  Bot non può assegnare il ruolo ${role.name} (posizione troppo alta)`);
                }
            } else {
                console.log(`⚠️  Ruolo ${row.role_id} non trovato nel server`);
            }
        }

        // Assegna tutti i ruoli validi
        if (rolesToRestore.length > 0) {
            try {
                await member.roles.add(rolesToRestore);
                console.log(`✅ Ripristinati ${rolesToRestore.length} ruoli persistenti per ${member.user.tag}:`, 
                    rolesToRestore.map(role => role.name).join(', '));
                
                // Log del ripristino ruoli
                await logRoleRestoration(member, rolesToRestore, failedRoles);
                
            } catch (roleError) {
                console.error(`❌ Errore assegnazione ruoli a ${member.user.tag}:`, roleError);
            }
        }

        if (failedRoles.length > 0) {
            console.log(`❌ Ruoli non assegnati per ${member.user.tag} (permessi insufficienti):`, failedRoles.join(', '));
        }

    } catch (error) {
        console.error(`❌ Errore ripristino ruoli persistenti per ${member.user.tag}:`, error);
    }
}

// ==================== FUNZIONE LOG RIPRISTINO RUOLI ====================
async function logRoleRestoration(member, restoredRoles, failedRoles) {
    try {
        // Cerca un canale log nel database
        const settingsResult = await db.query(
            'SELECT welcome_log_channel_id FROM guild_settings WHERE guild_id = $1',
            [member.guild.id]
        );

        if (settingsResult.rows.length === 0 || !settingsResult.rows[0].welcome_log_channel_id) {
            return;
        }

        const logChannel = member.guild.channels.cache.get(settingsResult.rows[0].welcome_log_channel_id);
        if (!logChannel) {
            return;
        }

        const logEmbed = new EmbedBuilder()
            .setTitle('🔄 Ruoli Persistenti Ripristinati')
            .setDescription(`**Utente:** ${member.user.tag} (\`${member.user.id}\`)`)
            .setColor(0x00FF00)
            .setTimestamp()
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

        if (restoredRoles.length > 0) {
            logEmbed.addFields({
                name: '✅ Ruoli Ripristinati',
                value: restoredRoles.map(role => role.toString()).join(', '),
                inline: false
            });
        }

        if (failedRoles.length > 0) {
            logEmbed.addFields({
                name: '⚠️ Ruoli Non Assegnati',
                value: failedRoles.join(', '),
                inline: false
            });
        }

        await logChannel.send({ embeds: [logEmbed] });

    } catch (error) {
        console.error('❌ Errore invio log ripristino ruoli:', error);
    }
}

// ==================== FUNZIONE SISTEMA WELCOME (MODIFICATA) ====================
async function handleWelcomeSystem(member) {
    try {
        // Recupera le impostazioni welcome dal DB - AGGIUNTO welcome_embed_color
        const result = await db.query(
            'SELECT welcome_channel_id, welcome_log_channel_id, welcome_image_url, welcome_embed_color FROM guild_settings WHERE guild_id = $1',
            [member.guild.id]
        );

        if (result.rows.length === 0 || !result.rows[0].welcome_channel_id) {
            return;
        }

        const settings = result.rows[0];
        const welcomeChannel = member.guild.channels.cache.get(settings.welcome_channel_id);
        if (!welcomeChannel) {
            return;
        }

        // USA L'EMBED INVECE DI CANVAS
        try {
            const welcomeMessage = await createWelcomeEmbed(
                member.user,
                member.guild.memberCount,
                settings.welcome_image_url,
                settings.welcome_embed_color || 0xFFFFFF // Default bianco
            );

            await welcomeChannel.send(welcomeMessage);
            console.log(`✅ Embed welcome inviato per ${member.user.tag}`);

        } catch (embedError) {
            console.error('Errore creazione embed welcome:', embedError);
            // Fallback: messaggio semplice
            await welcomeChannel.send({
                content: `🎉 **WELCOME ${member.user.username.toUpperCase()}** in Shaderss! Sei il ${member.guild.memberCount}° membro!`
            });
        }

        // LOG dell'arrivo nel canale welcome log (separato)
        if (settings.welcome_log_channel_id) {
            const logChannel = member.guild.channels.cache.get(settings.welcome_log_channel_id);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('👤 Nuovo Membro')
                    .setDescription(`${member.user.tag} si è unito al server`)
                    .addFields(
                        { name: '🆔 ID', value: member.user.id, inline: true },
                        { name: '📅 Account creato', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                        { name: '👥 Membri totali', value: member.guild.memberCount.toString(), inline: true }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp()
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

                await logChannel.send({ embeds: [logEmbed] });
                console.log(`✅ Log arrivo inviato per ${member.user.tag}`);
            }
        }

    } catch (error) {
        console.error('Errore sistema welcome:', error);
    }
}

// ==================== FUNZIONI ESPORTATE PER I COMANDI ====================
module.exports.restorePersistentRoles = restorePersistentRoles;
module.exports.handleWelcomeSystem = handleWelcomeSystem;