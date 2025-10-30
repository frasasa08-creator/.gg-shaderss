const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// Import del database
let db;
try {
    db = require('../db');
} catch (error) {
    console.error('❌ Errore nel caricamento del database:', error.message);
    db = {
        query: async () => ({ rows: [] }),
    };
}

/**
 * Crea un nuovo ticket
 */
async function createTicket(interaction, optionValue) {
    try {
        await interaction.deferReply({ flags: 64 });

        const guild = interaction.guild;
        const user = interaction.user;

        // PRIMA: Pulizia ticket orfani
        console.log(`🧹 Verifica ticket orfani per ${user.id}...`);
        const openTickets = await db.query(
            'SELECT * FROM tickets WHERE guild_id = $1 AND user_id = $2 AND status = $3',
            [guild.id, user.id, 'open']
        );

        let hasValidOpenTicket = false;
        let validOpenTicket = null;

        for (const ticket of openTickets.rows) {
            const channelExists = guild.channels.cache.get(ticket.channel_id);
            if (!channelExists) {
                console.log(`🧹 Pulizia ticket orfano: ${ticket.id}`);
                await db.query(
                    'UPDATE tickets SET status = $1, closed_at = NOW(), close_reason = $2 WHERE id = $3',
                    ['closed', 'Pulizia automatica: canale eliminato', ticket.id]
                );
            } else {
                hasValidOpenTicket = true;
                validOpenTicket = ticket;
                console.log(`✅ Ticket aperto valido trovato: ${ticket.id}`);
            }
        }

        // Se c'è un ticket aperto valido, blocca la creazione
        if (hasValidOpenTicket && validOpenTicket) {
            const existingChannel = guild.channels.cache.get(validOpenTicket.channel_id);
            return await interaction.editReply({
                content: `❌ Hai già un ticket aperto! ${existingChannel ? existingChannel.toString() : 'Chiudi quello attuale prima di aprirne uno nuovo.'}`
            });
        }

        // Recupera le opzioni ticket dal database
        const settingsResult = await db.query(
            'SELECT settings FROM guild_settings WHERE guild_id = $1',
            [guild.id]
        );

        if (!settingsResult.rows.length || !settingsResult.rows[0].settings?.ticket_options) {
            return await interaction.editReply({
                content: '❌ Configurazione ticket non trovata!'
            });
        }

        const ticketOptions = settingsResult.rows[0].settings.ticket_options;
        const selectedOption = ticketOptions.find(opt => opt.value === optionValue);

        if (!selectedOption) {
            return await interaction.editReply({
                content: '❌ Opzione ticket non valida!'
            });
        }

        // Trova o crea la categoria
        let category = guild.channels.cache.find(ch => 
            ch.type === ChannelType.GuildCategory && 
            ch.name.toLowerCase() === selectedOption.category.toLowerCase()
        );

        if (!category) {
            category = await guild.channels.create({
                name: selectedOption.category,
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone,
                        deny: [PermissionFlagsBits.ViewChannel],
                    }
                ]
            });
        }

        // Crea il canale ticket
        const ticketChannelName = `${selectedOption.name.toLowerCase().replace(/\s+/g, '-')}-${user.username.toLowerCase()}`;
        
        const ticketChannel = await guild.channels.create({
            name: ticketChannelName,
            type: ChannelType.GuildText,
            parent: category
        });

        // Sincronizza i permessi con la categoria
        await ticketChannel.lockPermissions();
        console.log(`✅ Permessi sincronizzati con la categoria: ${category.name}`);

        // Aggiungi permessi per l'utente
        await ticketChannel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true
        });
        console.log(`✅ Permessi aggiunti per l'utente: ${user.tag}`);

        // Salva il ticket nel database
        const ticketResult = await db.query(
            'INSERT INTO tickets (guild_id, user_id, channel_id, ticket_type, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [guild.id, user.id, ticketChannel.id, selectedOption.name, 'open']
        );

        const ticketId = ticketResult.rows[0].id;

        // Crea l'embed di benvenuto del ticket
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`🎫 Ticket: ${selectedOption.name}`)
            .setDescription(`Ciao ${user.toString()}!\n\nGrazie per aver aperto un ticket. Un membro dello staff ti risponderà il prima possibile.\n\n**Tipo:** ${selectedOption.name}\n**Categoria:** ${selectedOption.category}`)
            .setColor(0x0099ff)
            .setTimestamp()
            .setFooter({ text: `Ticket ID: ${ticketId}` });

        // Bottone per chiudere il ticket
        const closeButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Chiudi Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

        await ticketChannel.send({
            content: `${user.toString()} - ${selectedOption.emoji ?? ''}`,
            embeds: [welcomeEmbed],
            components: [closeButton]
        });

        await interaction.editReply({
            content: `✅ Ticket creato! ${ticketChannel.toString()}`
        });

        // Reset del menu select
        try {
            const originalMessage = interaction.message;
            if (originalMessage && originalMessage.components && originalMessage.components.length > 0) {
                const actionRow = originalMessage.components[0];
                if (actionRow && actionRow.components && actionRow.components.length > 0) {
                    const selectMenu = actionRow.components[0];
                    
                    const newSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId(selectMenu.customId || 'ticket_select')
                        .setPlaceholder('🎫 Scegli una opzione...');
                    
                    if (selectMenu.options) {
                        newSelectMenu.addOptions(selectMenu.options);
                    }
                    
                    const newActionRow = new ActionRowBuilder().addComponents(newSelectMenu);
                    
                    await originalMessage.edit({
                        embeds: originalMessage.embeds || [],
                        components: [newActionRow]
                    });
                    console.log('✅ Menu select resettato con successo');
                }
            }
        } catch (menuError) {
            console.log('⚠️ Impossibile resettare il menu select:', menuError.message);
        }

    } catch (error) {
        console.error('Errore creazione ticket:', error);
        try {
            await interaction.editReply({
                content: `❌ Errore durante la creazione del ticket: ${error.message}`
            });
        } catch (editError) {
            console.log('⚠️ Impossibile rispondere');
        }
    }
}

/**
 * Mostra il modal per la motivazione di chiusura
 */
async function showCloseTicketModal(interaction) {
    try {
        // Crea il modal
        const modal = new ModalBuilder()
            .setCustomId('close_ticket_modal')
            .setTitle('Chiudi Ticket');

        // Aggiungi il campo per la motivazione
        const reasonInput = new TextInputBuilder()
            .setCustomId('close_reason')
            .setLabel('Motivazione della chiusura')
            .setPlaceholder('Inserisci la motivazione per chiudere questo ticket...')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(5)
            .setMaxLength(500)
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(actionRow);

        // Mostra il modal
        await interaction.showModal(modal);
        
    } catch (error) {
        console.error('Errore mostrare modal chiusura:', error);
        try {
            await interaction.reply({
                content: '❌ Errore durante l\'apertura del form di chiusura.',
                flags: 64
            });
        } catch (replyError) {
            console.log('⚠️ Impossibile rispondere');
        }
    }
}

/**
 * Chiude un ticket con motivazione
 */
async function closeTicketWithReason(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const reason = interaction.fields.getTextInputValue('close_reason');
        const channel = interaction.channel;
        const user = interaction.user;

        const ticketResult = await db.query(
            'SELECT * FROM tickets WHERE channel_id = $1 AND status = $2',
            [channel.id, 'open']
        );

        if (ticketResult.rows.length === 0) {
            return await interaction.editReply({
                content: '❌ Questo non è un canale ticket valido!'
            });
        }

        const ticket = ticketResult.rows[0];
        
        console.log(`📝 Generazione transcript per ticket ${ticket.id}...`);
        const transcript = await generateOblivionBotTranscript(channel, ticket.id);
        console.log(`✅ Transcript generato: ${transcript.name}`);

        // Salva il transcript temporaneamente e crea un URL pubblico
        // Per ora usiamo un approccio con file allegati per il DM
        const transcriptAttachment = transcript;

        // Recupera informazioni sull'utente che ha aperto il ticket
        let ticketCreator = null;
        try {
            ticketCreator = await interaction.client.users.fetch(ticket.user_id);
        } catch (error) {
            console.log('⚠️ Impossibile trovare l\'utente che ha aperto il ticket:', ticket.user_id);
        }

        // INVIO TRANSCRIPT IN DM ALL'UTENTE (con file allegato)
        if (ticketCreator) {
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('📋 Transcript del tuo Ticket')
                    .setDescription(`Ecco il transcript del ticket che hai aperto su **${interaction.guild.name}**\n\n**Scarica il file qui sotto per visualizzare la conversazione completa.**`)
                    .addFields(
                        { name: '🎫 Tipo Ticket', value: ticket.ticket_type, inline: true },
                        { name: '📅 Aperto il', value: `<t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:f>`, inline: true },
                        { name: '🔒 Chiuso da', value: user.toString(), inline: true },
                        { name: '📝 Motivazione', value: reason.length > 100 ? reason.substring(0, 100) + '...' : reason, inline: true },
                        { name: '📁 Canale', value: `#${channel.name}`, inline: true }
                    )
                    .setColor(0x0099ff)
                    .setTimestamp()
                    .setFooter({ text: `Ticket ID: ${ticket.id} • Apri il file HTML nel tuo browser` });

                await ticketCreator.send({
                    content: '📄 **Ecco il transcript del tuo ticket chiuso:**',
                    embeds: [dmEmbed],
                    files: [transcriptAttachment]
                });
                console.log(`✅ Transcript inviato in DM a ${ticketCreator.tag}`);
            } catch (dmError) {
                console.log(`❌ Impossibile inviare il transcript in DM a ${ticketCreator.tag}:`, dmError.message);
                await channel.send({
                    content: `⚠️ ${user.toString()}, non è stato possibile inviare il transcript in DM a <@${ticket.user_id}>. Potrebbero avere i DM chiusi.`
                });
            }
        }

        // EMBED DI CHIUSURA NEL CANALE TICKET
        const closeEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket Chiuso')
            .setDescription(`Il ticket è stato chiuso da ${user.toString()}\n\nIl transcript è stato inviato in DM all'utente.`)
            .addFields(
                { name: '👤 Aperto da', value: `<@${ticket.user_id}>`, inline: true },
                { name: '🎫 Tipo', value: ticket.ticket_type, inline: true },
                { name: '🔒 Chiuso da', value: user.toString(), inline: true },
                { name: '📝 Motivazione', value: reason.length > 100 ? reason.substring(0, 100) + '...' : reason, inline: true },
                { name: '📅 Data apertura', value: `<t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:f>`, inline: true }
            )
            .setColor(0xff0000)
            .setTimestamp()
            .setFooter({ text: `Ticket ID: ${ticket.id} • Transcript inviato in DM` });

        await channel.send({ embeds: [closeEmbed] });

        // LOG NEL CANALE DEI LOG (con file allegato)
        const logChannelResult = await db.query(
            'SELECT ticket_log_channel_id FROM guild_settings WHERE guild_id = $1',
            [interaction.guild.id]
        );

        if (logChannelResult.rows.length > 0) {
            const logChannel = interaction.guild.channels.cache.get(logChannelResult.rows[0].ticket_log_channel_id);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('📋 Ticket Chiuso - Log')
                    .addFields(
                        { name: '👤 Utente', value: `<@${ticket.user_id}>`, inline: true },
                        { name: '🎫 Tipo', value: ticket.ticket_type, inline: true },
                        { name: '🔒 Chiuso da', value: user.toString(), inline: true },
                        { name: '📝 Motivazione', value: reason.length > 100 ? reason.substring(0, 100) + '...' : reason, inline: true },
                        { name: '📅 Aperto', value: `<t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:f>`, inline: true },
                        { name: '📅 Chiuso', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                        { name: '📁 Canale', value: `#${channel.name}`, inline: true }
                    )
                    .setColor(0xff0000)
                    .setTimestamp();

                try {
                    await logChannel.send({
                        content: '📄 **Transcript del ticket:**',
                        embeds: [logEmbed],
                        files: [transcriptAttachment]
                    });
                } catch (logError) {
                    console.error('Errore invio log:', logError);
                }
            }
        }

        // AGGIORNA IL TICKET NEL DATABASE
        await db.query(
            'UPDATE tickets SET status = $1, closed_at = CURRENT_TIMESTAMP, close_reason = $2 WHERE id = $3',
            ['closed', reason, ticket.id]
        );

        const countdownEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket in Chiusura')
            .setDescription('Il ticket si chiuderà in **5** secondi...')
            .setColor(0xff0000);

        // Countdown
        try {
            const message = await interaction.editReply({ embeds: [countdownEmbed] });

            for (let i = 4; i >= 1; i--) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                countdownEmbed.setDescription(`Il ticket si chiuderà in **${i}** second${i !== 1 ? 'i' : 'o'}...`);
                try {
                    await message.edit({ embeds: [countdownEmbed] });
                } catch (editError) {
                    break;
                }
            }
        } catch (error) {
            // Ignora errori countdown
        }

        // Eliminazione canale
        setTimeout(async () => {
            try {
                if (channel.deletable) {
                    await channel.delete('Ticket chiuso');
                    console.log(`✅ Canale ticket ${channel.id} eliminato con successo`);
                }
            } catch (deleteError) {
                console.error('Errore eliminazione canale ticket:', deleteError);
            }
        }, 1000);

    } catch (error) {
        console.error('Errore chiusura ticket:', error);
        try {
            await interaction.editReply({
                content: `❌ Errore durante la chiusura del ticket: ${error.message}`
            });
        } catch (editError) {
            console.log('⚠️ Impossibile rispondere');
        }
    }
}

/**
 * GENERA TRANSCRIPT IDENTICO A OBLIVION BOT
 */
async function generateOblivionBotTranscript(channel, ticketId) {
    try {
        console.log(`📝 Generazione transcript Oblivion Bot style per ticket ${ticketId}...`);
        
        const guild = channel.guild;
        const ticketResult = await db.query(
            'SELECT * FROM tickets WHERE id = $1',
            [ticketId]
        );
        
        if (ticketResult.rows.length === 0) {
            throw new Error('Ticket non trovato nel database');
        }
        
        const ticket = ticketResult.rows[0];
        const ticketCreator = await channel.client.users.fetch(ticket.user_id).catch(() => null);

        // HTML IDENTICO A OBLIVION BOT CON FAVICON DINAMICA
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charSet="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" type="image/png" href="${channel.client.user.displayAvatarURL({ extension: 'png', size: 64 })}"/>
<title>${guild.name} - Oblivion Bot</title>
<script>
document.addEventListener("click",t=>{let e=t.target;if(!e)return;e.offsetParent?.classList.contains("context-menu")||contextMenu?.classList.remove("visible");let o=e?.getAttribute("data-goto");if(o){let n=document.getElementById(\`m-\${o}\`);n?(n.scrollIntoView({behavior:"smooth",block:"center"}),n.style.backgroundColor="rgba(148, 156, 247, 0.1)",n.style.transition="background-color 0.5s ease",setTimeout(()=>{n.style.backgroundColor="transparent"},1e3)):console.warn(\`Message \${o} not found.\`)}});
</script>
<link rel="stylesheet" href="https://cdn.johnbot.app/css/transcripts.css"/>
<script src="https://cdn.johnbot.app/js/transcripts.js"></script>
<script>
window.$discordMessage = {
    profiles: {
        // Profilo base per il bot - sarà sovrascritto dinamicamente se necessario
        "discord-tickets": {
            author: "Oblivion Bot",
            avatar: "${channel.client.user.displayAvatarURL({ extension: 'webp', size: 64 })}",
            roleColor: "#5865F2",
            roleName: "🤖┃BOT",
            bot: true,
            verified: true
        }
    }
};
</script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@derockdev/discord-components-core@^3.6.1/dist/derockdev-discord-components-core/derockdev-discord-components-core.esm.js"></script>
</head>
<body style="margin:0;min-height:100vh">
<div>
<section>
<span style="font-size:28px;color:#fff;font-weight:600">Welcome to #${channel.name} !</span>
<span style="font-size:16px;color:#b9bbbe;font-weight:400">This is the start of the #${channel.name} channel.</span>
</section>
<header>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="#80848e" viewBox="0 0 24 24">
<path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41045 9L8.35045 15H14.3504L15.4104 9H9.41045Z"></path>
</svg>
${channel.name}
</header>
</div>
<discord-messages style="min-height:100vh;padding:0 0 90px;background-color:#313338;border:none;border-top:1px solid rgba(255, 255, 255, 0.05)">
${await generateOblivionBotMessagesHTML(channel)}
</discord-messages>
<footer>This archive has been generated on the <time id="footer-timestamp">${new Date().toLocaleString('en-US')}</time></footer>
<div id="context-menu" class="context-menu">
<div class="item message">Copy Message ID</div>
<div class="item user">Copy User ID</div>
</div>
<script>
const contextMenu=document.getElementById("context-menu");
document.addEventListener("contextmenu",e=>{e.preventDefault();let t=e.target;if(!t)return;let s=t.closest("discord-message");if(!s){contextMenu?.classList.remove("visible");return}
let n=t?.closest(".discord-author-avatar img"),i=n?s?.getAttribute("profile"):s?.getAttribute("id")?.split("-")[1];if(!i){contextMenu?.classList.remove("visible");return}
if(n?(contextMenu?.querySelector(".item.message")?.classList.add("hidden"),contextMenu?.querySelector(".item.user")?.classList.remove("hidden")):(contextMenu?.querySelector(".item.user")?.classList.add("hidden"),contextMenu?.querySelector(".item.message")?.classList.remove("hidden")),i&&contextMenu){
contextMenu.classList.add("visible"),contextMenu.style.top=e.pageY+"px",contextMenu.style.left=e.pageX+"px";let c=contextMenu.querySelector(n?".item.user":".item.message");
c&&c.addEventListener("click",()=>{navigator.clipboard.writeText(i),contextMenu.classList.remove("visible")},{once:!0})}});
</script>
</body>
</html>`;

        return {
            attachment: Buffer.from(htmlContent, 'utf-8'),
            name: `transcript-${ticketId}.html`
        };

    } catch (error) {
        console.error('Errore generazione transcript Oblivion Bot style:', error);
        return generateOblivionBotFallbackTranscript(channel, ticketId);
    }
}

/**
 * Converte il markdown di Discord in HTML
 */
function convertMarkdownToHTML(text) {
    if (!text) return '';
    
    return text
        // Grassetto **testo**
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Corsivo *testo* o _testo_
        .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
        .replace(/_(.*?)_/g, '<em>$1</em>')
        // Sottolineato __testo__
        .replace(/__(.*?)__/g, '<u>$1</u>')
        // Barrato ~~testo~~
        .replace(/~~(.*?)~~/g, '<s>$1</s>')
        // Code inline `testo`
        .replace(/`(.*?)`/g, '<code>$1</code>')
        // Code block ```testo```
        .replace(/```(\w+)?\n?(.*?)```/gs, '<pre><code>$2</code></pre>');
}

/**
 * Processa le mention nei testi
 */
function processMentions(text, guild) {
    if (!text) return '';
    
    return text
        // Mention utente <@123456789> -> @nomeutente
        .replace(/<@!?(\d+)>/g, (match, userId) => {
            const user = guild.client.users.cache.get(userId);
            return user ? `@${user.username}` : '@UtenteSconosciuto';
        })
        // Mention ruolo <@&123456789> -> @nomeruolo
        .replace(/<@&(\d+)>/g, (match, roleId) => {
            const role = guild.roles.cache.get(roleId);
            return role ? `@${role.name}` : '@RuoloSconosciuto';
        })
        // Mention canale <#123456789> -> #nomecanale
        .replace(/<#(\d+)>/g, (match, channelId) => {
            const channel = guild.channels.cache.get(channelId);
            return channel ? `#${channel.name}` : '#canalesconosciuto';
        });
}

/**
 * Genera i messaggi in formato Oblivion Bot
 */
async function generateOblivionBotMessagesHTML(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = Array.from(messages.values()).reverse();
        const guild = channel.guild;

        if (sortedMessages.length === 0) {
            return `<discord-message id="m-no-messages" timestamp="${new Date().toISOString()}" profile="discord-tickets">
    <discord-embed slot="embeds" color="#ffffff">
        <discord-embed-description slot="description">No messages found in this ticket.</discord-embed-description>
    </discord-embed>
</discord-message>`;
        }

        let messagesHTML = '';
        
        for (const message of sortedMessages) {
            const messageId = `m-${message.id}`;
            const isBot = message.author.bot;
            const timestamp = message.createdAt.toISOString();
            
            let messageContent = message.content || '';
            
            // PROCESS MENTIONS con nomi reali
            messageContent = processMentions(messageContent, guild);
            
            // CONVERTI MARKDOWN A HTML
            messageContent = convertMarkdownToHTML(messageContent);

            // CONVERTI EMOJI PERSONALIZZATE IN IMMAGINI
            messageContent = messageContent.replace(/<:(\w+):(\d+)>/g, 
                '<img src="https://cdn.discordapp.com/emojis/$2.png" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
            );

            // CONVERTI EMOJI ANIMATE IN GIF
            messageContent = messageContent.replace(/<a:(\w+):(\d+)>/g, 
                '<img src="https://cdn.discordapp.com/emojis/$2.gif" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
            );

            // CREA PROFILO DINAMICO PER OGNI MESSAGGIO
            const authorId = message.author.id;
            const authorName = message.author.username;
            const authorAvatar = message.author.displayAvatarURL({ extension: 'webp', size: 64 });
            const isVerified = message.author.bot;
            const roleColor = isVerified ? '#5865F2' : undefined;
            const roleName = isVerified ? '🤖┃BOT' : undefined;

            // Aggiungi il profilo dinamicamente allo script
            const profileScript = `
<script>
if (!window.$discordMessage.profiles["${authorId}"]) {
    window.$discordMessage.profiles["${authorId}"] = {
        author: "${authorName}",
        avatar: "${authorAvatar}",
        ${roleColor ? `roleColor: "${roleColor}",` : ''}
        ${roleName ? `roleName: "${roleName}",` : ''}
        bot: ${isVerified},
        verified: ${isVerified}
    };
}
</script>`;

            // Se è un messaggio normale
            if (message.content && !message.embeds.length && !message.components.length) {
                messagesHTML += `${profileScript}
<discord-message id="${messageId}" timestamp="${timestamp}" profile="${authorId}">
${messageContent}
</discord-message>`;
            }
            // Se ha embed (come il messaggio iniziale del bot)
            else if (message.embeds.length > 0) {
                messagesHTML += `${profileScript}
<discord-message id="${messageId}" timestamp="${timestamp}" profile="${authorId}">`;
                
                if (message.content) {
                    messagesHTML += `${messageContent}`;
                }
                
                message.embeds.forEach(embed => {
                    const embedColor = embed.hexColor || '#0099ff';
                    
                    // Processa anche le emoji e markdown negli embed
                    let embedTitle = embed.title || '';
                    let embedDescription = embed.description || '';
                    let embedFooter = embed.footer?.text || '';
                    
                    // Process mentions e markdown per embed
                    embedTitle = processMentions(embedTitle, guild);
                    embedDescription = processMentions(embedDescription, guild);
                    embedFooter = processMentions(embedFooter, guild);
                    
                    embedTitle = convertMarkdownToHTML(embedTitle);
                    embedDescription = convertMarkdownToHTML(embedDescription);
                    embedFooter = convertMarkdownToHTML(embedFooter);
                    
                    // Converti emoji nel titolo
                    embedTitle = embedTitle.replace(/<:(\w+):(\d+)>/g, 
                        '<img src="https://cdn.discordapp.com/emojis/$2.png" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
                    );
                    embedTitle = embedTitle.replace(/<a:(\w+):(\d+)>/g, 
                        '<img src="https://cdn.discordapp.com/emojis/$2.gif" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
                    );
                    
                    // Converti emoji nella descrizione
                    embedDescription = embedDescription.replace(/<:(\w+):(\d+)>/g, 
                        '<img src="https://cdn.discordapp.com/emojis/$2.png" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
                    );
                    embedDescription = embedDescription.replace(/<a:(\w+):(\d+)>/g, 
                        '<img src="https://cdn.discordapp.com/emojis/$2.gif" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
                    );
                    
                    // Converti emoji nel footer
                    embedFooter = embedFooter.replace(/<:(\w+):(\d+)>/g, 
                        '<img src="https://cdn.discordapp.com/emojis/$2.png" alt="$1" style="width: 16px; height: 16px; vertical-align: middle; margin: 0 1px;" class="discord-custom-emoji">'
                    );
                    embedFooter = embedFooter.replace(/<a:(\w+):(\d+)>/g, 
                        '<img src="https://cdn.discordapp.com/emojis/$2.gif" alt="$1" style="width: 16px; height: 16px; vertical-align: middle; margin: 0 1px;" class="discord-custom-emoji">'
                    );
                    
                    messagesHTML += `
<discord-embed slot="embeds" color="${embedColor}"${embed.image ? ` image="${embed.image.url}"` : ''}>
${embedTitle ? `<discord-embed-title slot="title">${embedTitle}</discord-embed-title>` : ''}
${embedDescription ? `<discord-embed-description slot="description">${embedDescription}</discord-embed-description>` : ''}
${embed.footer ? `<discord-embed-footer slot="footer"${embed.footer.iconURL ? ` footer-image="${embed.footer.iconURL}"` : ''}>${embedFooter}</discord-embed-footer>` : ''}
</discord-embed>`;
                });
                
                messagesHTML += `\n</discord-message>`;
            }
            // Se ha componenti (bottoni)
            else if (message.components.length > 0) {
                messagesHTML += `${profileScript}
<discord-message id="${messageId}" timestamp="${timestamp}" profile="${authorId}">`;
                
                if (message.content) {
                    messagesHTML += `${messageContent}`;
                }
                
                if (message.embeds.length > 0) {
                    message.embeds.forEach(embed => {
                        const embedColor = embed.hexColor || '#5865f2';
                        
                        // Processa emoji e markdown negli embed dei componenti
                        let embedTitle = embed.title || '';
                        let embedDescription = embed.description || '';
                        
                        embedTitle = processMentions(embedTitle, guild);
                        embedDescription = processMentions(embedDescription, guild);
                        
                        embedTitle = convertMarkdownToHTML(embedTitle);
                        embedDescription = convertMarkdownToHTML(embedDescription);
                        
                        embedTitle = embedTitle.replace(/<:(\w+):(\d+)>/g, 
                            '<img src="https://cdn.discordapp.com/emojis/$2.png" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
                        );
                        embedDescription = embedDescription.replace(/<:(\w+):(\d+)>/g, 
                            '<img src="https://cdn.discordapp.com/emojis/$2.png" alt="$1" style="width: 20px; height: 20px; vertical-align: middle; margin: 0 2px;" class="discord-custom-emoji">'
                        );
                        
                        messagesHTML += `
<discord-embed embed-title="${embedTitle || 'Ticket Control Panel'}" slot="embeds" color="${embedColor}">
<discord-embed-description slot="description">${embedDescription || 'Choose an action to perform on the ticket'}</discord-embed-description>
${embed.footer ? `<discord-embed-footer slot="footer"${embed.footer.iconURL ? ` footer-image="${embed.footer.iconURL}"` : ''}>${embed.footer.text}</discord-embed-footer>` : ''}
</discord-embed>`;
                    });
                }
                
                messagesHTML += `
<discord-attachments slot="components">`;
                
                message.components.forEach(componentRow => {
                    messagesHTML += `
<discord-action-row>`;
                    
                    componentRow.components.forEach(component => {
                        if (component.type === 'BUTTON') {
                            const buttonType = getOblivionBotButtonType(component.style);
                            
                            // Processa emoji nelle label dei bottoni
                            let buttonLabel = component.label || '';
                            buttonLabel = buttonLabel.replace(/<:(\w+):(\d+)>/g, 
                                '<img src="https://cdn.discordapp.com/emojis/$2.png" alt="$1" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 4px;" class="discord-custom-emoji">'
                            );
                            
                            messagesHTML += `
<discord-button type="${buttonType}" emoji="${component.emoji?.url || 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f512.svg'}">${buttonLabel}</discord-button>`;
                        }
                    });
                    
                    messagesHTML += `
</discord-action-row>`;
                });
                
                messagesHTML += `
</discord-attachments>
</discord-message>`;
            }
        }

        return messagesHTML;

    } catch (error) {
        console.error('Errore generazione messaggi Oblivion Bot:', error);
        return `
<discord-message id="m-error" timestamp="${new Date().toISOString()}" profile="discord-tickets">
    <discord-embed slot="embeds" color="#ed4245">
        <discord-embed-description slot="description">Error loading messages: ${error.message}</discord-embed-description>
    </discord-embed>
</discord-message>`;
    }
}

/**
 * Restituisce il tipo di bottone per Oblivion Bot
 */
function getOblivionBotButtonType(style) {
    switch (style) {
        case 'SUCCESS': return 'success';
        case 'DANGER': return 'destructive';
        case 'PRIMARY': return 'primary';
        case 'SECONDARY': return 'secondary';
        default: return 'secondary';
    }
}

/**
 * Transcript di fallback in stile Oblivion Bot
 */
function generateOblivionBotFallbackTranscript(channel, ticketId) {
    const fallbackHTML = `<!DOCTYPE html>
<html>
<head>
<meta charSet="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" type="image/png" href="${channel.client.user.displayAvatarURL({ extension: 'png', size: 64 })}"/>
<title>Error - Oblivion Bot</title>
<script>
document.addEventListener("click",t=>{let e=t.target;if(!e)return;e.offsetParent?.classList.contains("context-menu")||contextMenu?.classList.remove("visible");let o=e?.getAttribute("data-goto");if(o){let n=document.getElementById(\`m-\${o}\`);n?(n.scrollIntoView({behavior:"smooth",block:"center"}),n.style.backgroundColor="rgba(148, 156, 247, 0.1)",n.style.transition="background-color 0.5s ease",setTimeout(()=>{n.style.backgroundColor="transparent"},1e3)):console.warn(\`Message \${o} not found.\`)}});
</script>
<link rel="stylesheet" href="https://cdn.johnbot.app/css/transcripts.css"/>
<script src="https://cdn.johnbot.app/js/transcripts.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@derockdev/discord-components-core@^3.6.1/dist/derockdev-discord-components-core/derockdev-discord-components-core.esm.js"></script>
</head>
<body style="margin:0;min-height:100vh">
<div>
<section>
<span style="font-size:28px;color:#fff;font-weight:600">Error Generating Transcript</span>
<span style="font-size:16px;color:#b9bbbe;font-weight:400">Failed to generate transcript for ticket #${ticketId}</span>
</section>
</div>
<discord-messages style="min-height:100vh;padding:0 0 90px;background-color:#313338;border:none;border-top:1px solid rgba(255, 255, 255, 0.05)">
<discord-message id="m-error" timestamp="${new Date().toISOString()}" profile="discord-tickets">
<discord-embed slot="embeds" color="#ed4245">
<discord-embed-description slot="description">An error occurred while generating the transcript for this ticket.</discord-embed-description>
</discord-embed>
</discord-message>
</discord-messages>
<footer>This archive has been generated on the <time>${new Date().toLocaleString('en-US')}</time></footer>
</body>
</html>`;

    return {
        attachment: Buffer.from(fallbackHTML, 'utf-8'),
        name: `transcript-${ticketId}.html`
    };
}

/**
 * Formatta la dimensione del file
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Chiude forzatamente un ticket
 */
async function forceCloseTicket(guildId, userId, reason = "Forzatura amministrativa") {
    try {
        console.log(`🔍 Force closing ticket per guild: ${guildId}, user: ${userId}`);

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

        return { success: false, message: "Stato del ticket non riconosciuto" };

    } catch (error) {
        console.error("❌ Errore durante la forzatura chiusura ticket:", error);
        return { success: false, message: "Errore durante la chiusura del ticket" };
    }
}

/**
 * Salva messaggi ticket
 */
async function saveTicketMessage(message) {
    try {
        const ticketResult = await db.query(
            'SELECT id FROM tickets WHERE channel_id = $1 AND status = $2',
            [message.channel.id, 'open']
        );

        if (ticketResult.rows.length > 0) {
            const ticketId = ticketResult.rows[0].id;

            await db.query(
                'INSERT INTO ticket_messages (ticket_id, user_id, username, content) VALUES ($1, $2, $3, $4)',
                [ticketId, message.author.id, message.author.username, message.content || '[Contenuto non testuale]']
            );
        }
    } catch (error) {
        console.error('Errore salvataggio messaggio ticket:', error);
    }
}

// MANTIENI LA FUNZIONE ORIGINALE PER COMPATIBILITÀ
async function generateTranscript(channel, ticketId) {
    return await generateOblivionBotTranscript(channel, ticketId);
}

module.exports = {
    createTicket,
    showCloseTicketModal,
    closeTicketWithReason,
    forceCloseTicket,
    generateTranscript,
    generateOblivionBotTranscript,
    saveTicketMessage
};
