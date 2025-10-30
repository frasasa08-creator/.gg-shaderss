const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        .setName('message')
        .setDescription('Fai scrivere un messaggio al bot')
        .addStringOption(option =>
            option
                .setName('testo')
                .setDescription('Il testo che vuoi far scrivere al bot (usa \\n per andare a capo)')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option
                .setName('canale')
                .setDescription('Canale dove inviare il messaggio (default: canale corrente)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('tipo')
                .setDescription('Tipo di messaggio')
                .setRequired(false)
                .addChoices(
                    { name: '📝 Messaggio Normale', value: 'normal' },
                    { name: '📋 Embed', value: 'embed' },
                    { name: '⚠️ Avviso', value: 'warning' },
                    { name: '✅ Successo', value: 'success' },
                    { name: '❌ Errore', value: 'error' },
                    { name: 'ℹ️ Informazione', value: 'info' }
                )
        )
        .addStringOption(option =>
            option
                .setName('titolo')
                .setDescription('Titolo per l\'embed')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('colore')
                .setDescription('Colore personalizzato per l\'embed (es: #ff0000)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('immagine')
                .setDescription('URL immagine da includere')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('ping')
                .setDescription('Includi un ping @everyone?')
                .setRequired(false)
        )
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

            const text = interaction.options.getString('testo').replace(/\\n/g, '\n');
            const channel = interaction.options.getChannel('canale') || interaction.channel;
            const type = interaction.options.getString('tipo') || 'normal';
            const title = interaction.options.getString('titolo');
            const color = interaction.options.getString('colore');
            const image = interaction.options.getString('immagine');
            const ping = interaction.options.getBoolean('ping') || false;

            // Validazione canale
            if (channel && channel.type !== 0) {
                return await interaction.editReply({
                    content: '❌ Il canale deve essere un canale di testo!'
                });
            }

            // Validazione lunghezza testo
            if (text.length > 2000) {
                return await interaction.editReply({
                    content: '❌ Il testo è troppo lungo! Massimo 2000 caratteri.'
                });
            }

            // Validazione colore se specificato
            if (color) {
                const hexColorRegex = /^#[0-9A-F]{6}$/i;
                if (!hexColorRegex.test(color)) {
                    return await interaction.editReply({
                        content: '❌ Colore non valido! Usa il formato hex: #ff0000'
                    });
                }
            }

            // Validazione URL immagine
            if (image) {
                try {
                    new URL(image);
                } catch {
                    return await interaction.editReply({
                        content: '❌ URL immagine non valido!'
                    });
                }
            }

            let messageContent = '';
            let embed = null;

            // Prepara il messaggio in base al tipo
            switch (type) {
                case 'normal':
                    messageContent = text;
                    break;

                case 'embed':
                    embed = new EmbedBuilder()
                        .setDescription(text)
                        .setColor(color || 0x0099FF);

                    if (title) embed.setTitle(title);
                    if (image) embed.setImage(image);
                    break;

                case 'warning':
                    embed = new EmbedBuilder()
                        .setTitle(title || '⚠️ Avviso')
                        .setDescription(text)
                        .setColor(0xFFA500)
                        .setTimestamp();

                    if (image) embed.setImage(image);
                    break;

                case 'success':
                    embed = new EmbedBuilder()
                        .setTitle(title || '✅ Successo')
                        .setDescription(text)
                        .setColor(0x00FF00)
                        .setTimestamp();

                    if (image) embed.setImage(image);
                    break;

                case 'error':
                    embed = new EmbedBuilder()
                        .setTitle(title || '❌ Errore')
                        .setDescription(text)
                        .setColor(0xFF0000)
                        .setTimestamp();

                    if (image) embed.setImage(image);
                    break;

                case 'info':
                    embed = new EmbedBuilder()
                        .setTitle(title || 'ℹ️ Informazione')
                        .setDescription(text)
                        .setColor(0x0099FF)
                        .setTimestamp();

                    if (image) embed.setImage(image);
                    break;
            }

            // Prepara il contenuto del messaggio
            if (ping) {
                messageContent = '@everyone ' + messageContent;
            }

            // Invia il messaggio
            const messageOptions = {};
            if (messageContent) messageOptions.content = messageContent;
            if (embed) messageOptions.embeds = [embed];

            const sentMessage = await channel.send(messageOptions);

            // Embed di conferma
            const confirmEmbed = new EmbedBuilder()
                .setTitle('✅ Messaggio Inviato')
                .setDescription('Il messaggio è stato inviato con successo!')
                .addFields(
                    { name: '📝 Tipo', value: type, inline: true },
                    { name: '📊 Lunghezza', value: `${text.length} caratteri`, inline: true },
                    { name: '📨 Canale', value: channel.toString(), inline: true },
                    { name: '🔗 Link Messaggio', value: `[Clicca qui](${sentMessage.url})`, inline: false }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            // Log dell'azione
            console.log(`✅ Messaggio inviato da ${interaction.user.tag} in ${channel.name}: ${text.substring(0, 100)}...`);

        } catch (error) {
            console.error('Errore comando message:', error);
            
            if (error.code === 50013) {
                await interaction.editReply({
                    content: '❌ Non ho i permessi per inviare messaggi in quel canale!'
                });
            } else if (error.code === 50001) {
                await interaction.editReply({
                    content: '❌ Non posso accedere a quel canale!'
                });
            } else {
                await interaction.editReply({
                    content: `❌ Errore durante l\'invio del messaggio: ${error.message}`
                });
            }
        }
    },
};