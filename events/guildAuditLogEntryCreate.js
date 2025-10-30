const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const db = require('../db');

module.exports = {
    name: Events.GuildAuditLogEntryCreate,
    async execute(auditLogEntry, guild) {
        try {
            // Recupera il canale di MODERATION log (separato)
            const result = await db.query(
                'SELECT moderation_log_channel_id FROM guild_settings WHERE guild_id = $1',
                [guild.id]
            );

            if (result.rows.length === 0 || !result.rows[0].moderation_log_channel_id) {
                return;
            }

            const modLogChannel = guild.channels.cache.get(result.rows[0].moderation_log_channel_id);
            if (!modLogChannel) {
                return;
            }

            const { action, executor, target, reason, changes } = auditLogEntry;

            // Verifica che executor e target esistano
            if (!executor || !target) {
                return;
            }

            let embed = new EmbedBuilder()
                .setTimestamp()
                .setFooter({ text: `ID Azione: ${auditLogEntry.id}` });

            switch (action) {
                case AuditLogEvent.MemberKick:
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
                    if (timeoutChange) {
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
                        return; // Ignora altri aggiornamenti
                    }
                    break;

                case AuditLogEvent.MemberRoleUpdate:
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

                default:
                    return; // Ignora altre azioni
            }

            await modLogChannel.send({ embeds: [embed] });
            console.log(`✅ Moderation log inviato per azione: ${action}`);

        } catch (error) {
            console.error('Errore evento moderation log:', error);
        }
    },
};
