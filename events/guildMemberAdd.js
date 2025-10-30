const { Events, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { createCanvas, loadImage } = require('canvas');

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

// ==================== FUNZIONE SISTEMA WELCOME (ESISTENTE) ====================
async function handleWelcomeSystem(member) {
    try {
        // Recupera le impostazioni welcome dal DB
        const result = await db.query(
            'SELECT welcome_channel_id, welcome_log_channel_id, welcome_image_url FROM guild_settings WHERE guild_id = $1',
            [member.guild.id]
        );

        if (result.rows.length === 0 || !result.rows[0].welcome_channel_id) {
            return;
        }

        const welcomeChannel = member.guild.channels.cache.get(result.rows[0].welcome_channel_id);
        if (!welcomeChannel) {
            return;
        }

        // Crea immagine welcome personalizzata con sfondo caricato
        try {
            const canvas = createCanvas(800, 300);
            const ctx = canvas.getContext('2d');

            // Carica l'immagine di sfondo dal database
            if (result.rows[0].welcome_image_url) {
                try {
                    const background = await loadImage(result.rows[0].welcome_image_url);
                    // Disegna l'immagine di sfondo che copre tutto il canvas
                    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
                } catch (bgError) {
                    console.error('Errore caricamento immagine sfondo:', bgError);
                    // Fallback: sfondo nero se l'immagine non carica
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            } else {
                // Nessuna immagine, sfondo nero
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            // Cerchio avatar con bordo
            ctx.save();
            ctx.beginPath();
            ctx.arc(150, 150, 70, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();

            // Carica avatar utente
            const avatar = await loadImage(member.user.displayAvatarURL({ extension: 'jpg', size: 512 }));
            ctx.drawImage(avatar, 80, 80, 140, 140);
            ctx.restore();

            // Bordo cerchio avatar
            ctx.beginPath();
            ctx.arc(150, 150, 70, 0, Math.PI * 2, true);
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#FFFFFF';
            ctx.stroke();

            // Testo "BENVENUTO"
            ctx.font = 'bold 55px Arial';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'left';
            ctx.fillText('WELCOME', 300, 120);

            // Nome utente
            ctx.font = 'bold 45px Arial';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(member.user.username, 300, 170);

            // Ombra per i testi
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            // Riscrivi i testi con ombra
            ctx.font = 'bold 55px Arial';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('WELCOME', 300, 120);

            ctx.font = 'bold 45px Arial';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(member.user.username, 300, 170);

            // Converti in buffer e invia
            const buffer = canvas.toBuffer('image/png');
            
            await welcomeChannel.send({
                files: [{
                    attachment: buffer,
                    name: `welcome-${member.user.username}.png`
                }]
            });

            console.log(`✅ Welcome image creata per ${member.user.tag}`);

        } catch (canvasError) {
            console.error('Errore creazione welcome image:', canvasError);
            // Fallback: messaggio semplice
            await welcomeChannel.send({
                content: `🎉 **BENVENUTO ${member.user.username.toUpperCase()}** nel server!`
            });
        }

        // LOG dell'arrivo nel canale welcome log (separato)
        if (result.rows[0].welcome_log_channel_id) {
            const logChannel = member.guild.channels.cache.get(result.rows[0].welcome_log_channel_id);
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
