const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const db = require('../db');

module.exports = {
    name: Events.GuildAuditLogEntryCreate,
    async execute(auditLogEntry, guild) {
        try {
            const { action, executor, target, reason, changes, extra } = auditLogEntry;

            // Verifica che executor esista
            if (!executor || executor.bot) return;

            let embed = new EmbedBuilder()
                .setTimestamp()
                .setFooter({ text: `ID Azione: ${auditLogEntry.id}` });

            let logType = null;

            switch (action) {
                // ==================== LOG MODERAZIONE (Ban, Kick, Timeout) ====================
                case AuditLogEvent.MemberKick:
                    if (!target) return;
                    logType = 'moderation';
                    embed
                        .setTitle('🦶 UTENTE KICKATO')
                        .setDescription(`**${target.tag}** è stato kickato dal server`)
                        .addFields(
                            { name: '👤 Utente', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                            { name: '🛡️ Moderatore', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                            { name: '📝 Motivo', value: reason || 'Nessun motivo specificato', inline: false }
                        )
                        .setColor(0xFF4500)
                        .setThumbnail(target.displayAvatarURL({ dynamic: true }));
                    break;

                case AuditLogEvent.MemberBanAdd:
                    if (!target) return;
                    logType = 'moderation';
                    embed
                        .setTitle('🔨 UTENTE BANNATO')
                        .setDescription(`**${target.tag}** è stato bannato dal server`)
                        .addFields(
                            { name: '👤 Utente', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                            { name: '🛡️ Moderatore', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                            { name: '📝 Motivo', value: reason || 'Nessun motivo specificato', inline: false }
                        )
                        .setColor(0x8B0000)
                        .setThumbnail(target.displayAvatarURL({ dynamic: true }));
                    break;

                case AuditLogEvent.MemberBanRemove:
                    if (!target) return;
                    logType = 'moderation';
                    embed
                        .setTitle('🔓 UTENTE SBANNATO')
                        .setDescription(`**${target.tag}** è stato sbannato dal server`)
                        .addFields(
                            { name: '👤 Utente', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                            { name: '🛡️ Moderatore', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                            { name: '📝 Motivo', value: reason || 'Nessun motivo specificato', inline: false }
                        )
                        .setColor(0x00FF00)
                        .setThumbnail(target.displayAvatarURL({ dynamic: true }));
                    break;

                case AuditLogEvent.MemberUpdate:
                    const timeoutChange = changes?.find(change => change.key === 'communication_disabled_until');
                    if (timeoutChange && target) {
                        logType = 'moderation';
                        const timeoutUntil = timeoutChange.new;
                        if (timeoutUntil) {
                            const timeoutDate = new Date(timeoutUntil);
                            embed
                                .setTitle('🔇 TIMEOUT APPLICATO')
                                .setDescription(`**${target.tag}** è stato messo in timeout`)
                                .addFields(
                                    { name: '👤 Utente', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                                    { name: '🛡️ Moderatore', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                                    { name: '⏰ Fino al', value: `<t:${Math.floor(timeoutDate.getTime() / 1000)}:f>`, inline: true },
                                    { name: '📝 Motivo', value: reason || 'Nessun motivo specificato', inline: false }
                                )
                                .setColor(0xFFA500)
                                .setThumbnail(target.displayAvatarURL({ dynamic: true }));
                        } else {
                            embed
                                .setTitle('🔊 TIMEOUT RIMOSSO')
                                .setDescription(`Il timeout di **${target.tag}** è stato rimosso`)
                                .addFields(
                                    { name: '👤 Utente', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                                    { name: '🛡️ Moderatore', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                                    { name: '📝 Motivo', value: reason || 'Nessun motivo specificato', inline: false }
                                )
                                .setColor(0x00FF00)
                                .setThumbnail(target.displayAvatarURL({ dynamic: true }));
                        }
                    } else {
                        return;
                    }
                    break;

                // ==================== LOG RUOLI (Modifica, Aggiunta, Rimozione ruoli) ====================
                case AuditLogEvent.MemberRoleUpdate:
                    if (!target) return;
                    logType = 'roles';
                    const roleChanges = changes?.filter(change => change.key === '$add' || change.key === '$remove');
                    if (roleChanges && roleChanges.length > 0) {
                        let addedRoles = [];
                        let removedRoles = [];

                        for (const change of roleChanges) {
                            if (change.key === '$add' && change.new) {
                                addedRoles = change.new.map(role => `<@&${role.id}>`);
                            } else if (change.key === '$remove' && change.new) {
                                removedRoles = change.new.map(role => `<@&${role.id}>`);
                            }
                        }

                        if (addedRoles.length > 0 || removedRoles.length > 0) {
                            embed
                                .setTitle('🏷️ RUOLI MODIFICATI')
                                .setDescription(`**${target.tag}** - Ruoli aggiornati`)
                                .addFields(
                                    { name: '👤 Utente', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                                    { name: '🛡️ Moderatore', value: `${executor.tag} (\`${executor.id}\`)`, inline: true }
                                )
                                .setColor(0x0099FF);

                            if (addedRoles.length > 0) {
                                embed.addFields({ 
                                    name: '➕ Ruoli aggiunti', 
                                    value: addedRoles.join(', ') || 'Nessuno', 
                                    inline: false 
                                });
                            }

                            if (removedRoles.length > 0) {
                                embed.addFields({ 
                                    name: '➖ Ruoli rimossi', 
                                    value: removedRoles.join(', ') || 'Nessuno', 
                                    inline: false 
                                });
                            }

                            if (reason) {
                                embed.addFields({ 
                                    name: '📝 Motivo', 
                                    value: reason, 
                                    inline: false 
                                });
                            }

                            embed.setThumbnail(target.displayAvatarURL({ dynamic: true }));
                        } else {
                            return;
                        }
                    } else {
                        return;
                    }
                    break;

                case AuditLogEvent.RoleCreate:
                    if (!target) return;
                    logType = 'roles';
                    embed
                        .setTitle('🆕 RUOLO CREATO')
                        .setDescription(`È stato creato un nuovo ruolo`)
                        .addFields(
                            { name: '🎭 Ruolo', value: `${target.name} (\`${target.id}\`)`, inline: true },
                            { name: '🛡️ Creato da', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                            { name: '🎨 Colore', value: target.hexColor || 'Default', inline: true }
                        )
                        .setColor(target.color || 0x00FF00)
                        .setFooter({ text: `ID Ruolo: ${target.id} | ID Azione: ${auditLogEntry.id}` });
                    break;

                case AuditLogEvent.RoleDelete:
                    if (!target) return;
                    logType = 'roles';
                    embed
                        .setTitle('🗑️ RUOLO ELIMINATO')
                        .setDescription(`Un ruolo è stato eliminato`)
                        .addFields(
                            { name: '🎭 Ruolo', value: `${target.name} (\`${target.id}\`)`, inline: true },
                            { name: '🛡️ Eliminato da', value: `${executor.tag} (\`${executor.id}\`)`, inline: true }
                        )
                        .setColor(0xFF0000)
                        .setFooter({ text: `ID Ruolo: ${target.id} | ID Azione: ${auditLogEntry.id}` });
                    break;

                case AuditLogEvent.RoleUpdate:
                    if (!target) return;
                    logType = 'roles';
                    const roleUpdateChanges = changes?.map(change => {
                        switch (change.key) {
                            case 'name':
                                return `**Nome:** "${change.old}" → "${change.new}"`;
                            case 'color':
                                return `**Colore:** ${change.old} → ${change.new}`;
                            case 'permissions':
                                return `**Permessi:** modificati`;
                            case 'hoist':
                                return `**Separato:** ${change.old ? 'Sì' : 'No'} → ${change.new ? 'Sì' : 'No'}`;
                            case 'mentionable':
                                return `**Menzionabile:** ${change.old ? 'Sì' : 'No'} → ${change.new ? 'Sì' : 'No'}`;
                            default:
                                return null;
                        }
                    }).filter(Boolean);

                    if (roleUpdateChanges && roleUpdateChanges.length > 0) {
                        embed
                            .setTitle('⚙️ RUOLO MODIFICATO')
                            .setDescription(`Il ruolo **${target.name}** è stato modificato`)
                            .addFields(
                                { name: '🎭 Ruolo', value: `${target.toString()} (\`${target.id}\`)`, inline: true },
                                { name: '🛡️ Modificato da', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                                { name: '📝 Modifiche', value: roleUpdateChanges.join('\n'), inline: false }
                            )
                            .setColor(target.color || 0xFFFF00)
                            .setFooter({ text: `ID Ruolo: ${target.id} | ID Azione: ${auditLogEntry.id}` });
                    } else {
                        return;
                    }
                    break;

                // ==================== LOG CANALI ====================
                case AuditLogEvent.ChannelCreate:
                    if (!target) return;
                    logType = 'channels';
                    embed
                        .setTitle('🆕 CANALE CREATO')
                        .setDescription(`È stato creato un nuovo canale`)
                        .addFields(
                            { name: '📁 Canale', value: `${target.toString()} (\`${target.id}\`)`, inline: true },
                            { name: '🛡️ Creato da', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                            { name: '📋 Tipo', value: getChannelType(target.type), inline: true }
                        )
                        .setColor(0x00FF00)
                        .setFooter({ text: `ID Canale: ${target.id} | ID Azione: ${auditLogEntry.id}` });
                    break;

                case AuditLogEvent.ChannelDelete:
                    if (!target) return;
                    logType = 'channels';
                    embed
                        .setTitle('🗑️ CANALE ELIMINATO')
                        .setDescription(`Un canale è stato eliminato`)
                        .addFields(
                            { name: '📁 Canale', value: `#${target.name} (\`${target.id}\`)`, inline: true },
                            { name: '🛡️ Eliminato da', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                            { name: '📋 Tipo', value: getChannelType(target.type), inline: true }
                        )
                        .setColor(0xFF0000)
                        .setFooter({ text: `ID Canale: ${target.id} | ID Azione: ${auditLogEntry.id}` });
                    break;

                case AuditLogEvent.ChannelUpdate:
                    if (!target) return;
                    logType = 'channels';
                    const channelUpdateChanges = changes?.map(change => {
                        switch (change.key) {
                            case 'name':
                                return `**Nome:** #${change.old} → #${change.new}`;
                            case 'topic':
                                const oldTopic = change.old || 'Nessuno';
                                const newTopic = change.new || 'Nessuno';
                                return `**Topic:** "${oldTopic.substring(0, 50)}${oldTopic.length > 50 ? '...' : ''}" → "${newTopic.substring(0, 50)}${newTopic.length > 50 ? '...' : ''}"`;
                            case 'nsfw':
                                return `**NSFW:** ${change.old ? 'Sì' : 'No'} → ${change.new ? 'Sì' : 'No'}`;
                            case 'rate_limit_per_user':
                                return `**Slowmode:** ${change.old}s → ${change.new}s`;
                            default:
                                return null;
                        }
                    }).filter(Boolean);

                    if (channelUpdateChanges && channelUpdateChanges.length > 0) {
                        embed
                            .setTitle('⚙️ CANALE MODIFICATO')
                            .setDescription(`Il canale ${target.toString()} è stato modificato`)
                            .addFields(
                                { name: '📁 Canale', value: `${target.toString()} (\`${target.id}\`)`, inline: true },
                                { name: '🛡️ Modificato da', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                                { name: '📝 Modifiche', value: channelUpdateChanges.join('\n'), inline: false }
                            )
                            .setColor(0xFFFF00)
                            .setFooter({ text: `ID Canale: ${target.id} | ID Azione: ${auditLogEntry.id}` });
                    } else {
                        return;
                    }
                    break;

                // ==================== LOG MESSAGGI ====================
                case AuditLogEvent.MessageDelete:
                    if (extra && extra.channel && extra.count) {
                        logType = 'messages';
                        embed
                            .setTitle('🗑️ MESSAGGI ELIMINATI')
                            .setDescription(`Messaggi eliminati in ${extra.channel.toString()}`)
                            .addFields(
                                { name: '📁 Canale', value: extra.channel.toString(), inline: true },
                                { name: '🛡️ Moderatore', value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                                { name: '📊 Messaggi eliminati', value: extra.count.toString(), inline: true }
                            )
                            .setColor(0xFF6B6B);

                        if (reason) {
                            embed.addFields({ 
                                name: '📝 Motivo', 
                                value: reason, 
                                inline: false 
                            });
                        }
                    } else {
                        return;
                    }
                    break;

                default:
                    return; // Ignora altre azioni
            }

            // Se abbiamo un tipo di log, invia al canale appropriato
            if (logType) {
                await sendToLogChannel(guild, logType, embed);
            }

        } catch (error) {
            console.error('Errore evento moderation log:', error);
        }
    },
};

// Funzione per inviare al canale di log appropriato
async function sendToLogChannel(guild, logType, embed) {
    try {
        // Recupera i canali di log dal database
        const result = await db.query(
            'SELECT moderation_log_channel_id, role_log_channel_id, channel_log_channel_id, message_log_channel_id FROM guild_settings WHERE guild_id = $1',
            [guild.id]
        );

        if (result.rows.length === 0) return;

        const config = result.rows[0];
        let logChannelId;

        switch (logType) {
            case 'moderation':
                logChannelId = config.moderation_log_channel_id;
                break;
            case 'roles':
                logChannelId = config.role_log_channel_id;
                break;
            case 'channels':
                logChannelId = config.channel_log_channel_id;
                break;
            case 'messages':
                logChannelId = config.message_log_channel_id;
                break;
        }

        if (!logChannelId) return;

        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        await logChannel.send({ embeds: [embed] });
        console.log(`✅ ${logType.toUpperCase()} log inviato`);

    } catch (error) {
        console.error(`Errore invio ${logType} log:`, error);
    }
}

// Funzione helper per ottenere il tipo di canale in italiano
function getChannelType(type) {
    const types = {
        0: '📝 Testuale',
        2: '🔊 Vocale',
        4: '📁 Categoria',
        5: '📢 Annunci',
        13: '🎤 Stage',
        15: '🧵 Forum',
        16: '📄 Media'
    };
    return types[type] || 'Sconosciuto';
}