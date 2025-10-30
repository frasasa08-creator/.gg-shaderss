const { Events, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        try {
            // Controlla se è stato kickato (attendi l'audit log)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const auditLogs = await member.guild.fetchAuditLogs({
                type: 20, // MEMBER_KICK
                limit: 1
            });

            const latestKick = auditLogs.entries.first();
            
            // Se l'utente è stato kickato di recente, non loggare nei quit log
            if (latestKick && 
                latestKick.target.id === member.user.id && 
                (Date.now() - latestKick.createdTimestamp) < 5000) {
                console.log(`🚫 ${member.user.tag} kickato, ignorato nei quit log`);
                return;
            }

            // Recupera SOLO il canale quit log
            const result = await db.query(
                'SELECT quit_log_channel_id FROM guild_settings WHERE guild_id = $1',
                [member.guild.id]
            );

            if (result.rows.length === 0 || !result.rows[0].quit_log_channel_id) {
                return;
            }

            const quitLogChannel = member.guild.channels.cache.get(result.rows[0].quit_log_channel_id);
            if (!quitLogChannel) {
                return;
            }

            // Calcola tempo nel server
            const joinedTimestamp = member.joinedTimestamp;
            const timeInServer = joinedTimestamp ? Date.now() - joinedTimestamp : null;
            
            let timeString = 'Sconosciuto';
            if (timeInServer) {
                const days = Math.floor(timeInServer / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeInServer % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                
                if (days > 0) {
                    timeString = `${days} giorni, ${hours} ore`;
                } else if (hours > 0) {
                    const minutes = Math.floor((timeInServer % (1000 * 60 * 60)) / (1000 * 60));
                    timeString = `${hours} ore, ${minutes} minuti`;
                } else {
                    const minutes = Math.floor(timeInServer / (1000 * 60));
                    timeString = `${minutes} minuti`;
                }
            }

            // Prepara la lista dei ruoli (escludendo @everyone)
            const roles = member.roles.cache
                .filter(role => role.id !== member.guild.id) // Rimuovi @everyone
                .sort((a, b) => b.position - a.position); // Ordina per posizione

            let rolesString = 'Nessun ruolo';
            if (roles.size > 0) {
                // Prendi massimo 5 ruoli principali
                const topRoles = roles.first(5);
                rolesString = topRoles.map(role => role.toString()).join(', ');
                
                // Se ci sono più di 5 ruoli, aggiungi contatore
                if (roles.size > 5) {
                    rolesString += ` e altri ${roles.size - 5} ruoli`;
                }
            }

            const quitEmbed = new EmbedBuilder()
                .setTitle('👋 USCITA MEMBRO')
                .setDescription(`**${member.user.tag}** ha lasciato il server`)
                .addFields(
                    { name: '👤 Utente', value: `${member.user.toString()} (\`${member.id}\`)`, inline: true },
                    { name: '📅 Entrato', value: joinedTimestamp ? `<t:${Math.floor(joinedTimestamp / 1000)}:f>` : 'Sconosciuto', inline: true },
                    { name: '⏱️ Tempo nel server', value: timeString, inline: true },
                    { name: '🎭 Ruoli', value: rolesString, inline: false },
                    { name: '📊 Membri rimanenti', value: member.guild.memberCount.toString(), inline: true }
                )
                .setColor(0xff0000)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setTimestamp()
                .setFooter({ text: `ID: ${member.id}` });

            await quitLogChannel.send({ embeds: [quitEmbed] });
            console.log(`✅ Log uscita inviato per ${member.user.tag} con ${roles.size} ruoli`);

        } catch (error) {
            console.error('❌ Errore evento guildMemberRemove:', error);
        }
    },
};