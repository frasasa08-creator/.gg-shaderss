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

// Funzione per verificare e aggiungere la colonna se non esiste
async function ensureEmbedColorColumnExists() {
    try {
        // Verifica se la colonna esiste
        const checkResult = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'guild_settings' AND column_name = 'welcome_embed_color'
        `);
        
        if (checkResult.rows.length === 0) {
            // La colonna non esiste, la aggiungiamo
            console.log('Aggiungendo colonna welcome_embed_color...');
            await db.query(`
                ALTER TABLE guild_settings ADD COLUMN welcome_embed_color INTEGER DEFAULT 16777215
            `);
            console.log('Colonna welcome_embed_color aggiunta con successo');
        }
    } catch (error) {
        console.error('Errore verifica colonna welcome_embed_color:', error);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup_welcome')
        .setDescription('Configura il sistema di benvenuto')
        .addChannelOption(option =>
            option.setName('welcome_channel')
                .setDescription('Canale dove inviare i messaggi di benvenuto')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('welcome_log_channel')
                .setDescription('Canale per i log dei benvenuti')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('quit_log_channel')
                .setDescription('Canale per i log delle uscite')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('welcome_image')
                .setDescription('URL dell\'immagine per il benvenuto')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('embed_color')
                .setDescription('Colore dell\'embed in esadecimale (es. #FFFFFF per bianco)')
                .setRequired(false)),

    async execute(interaction) {
        try {
            // Controllo permessi
            const hasPermission = await checkPermissions(interaction);
            if (!hasPermission) {
                const reply = await interaction.reply({
                    content: '❌ Non hai i permessi necessari per utilizzare questo comando.',
                    ephemeral: true
                });
                return reply;
            }

            await interaction.deferReply({ ephemeral: true });

            // Assicurati che la colonna esista
            await ensureEmbedColorColumnExists();

            const welcomeChannel = interaction.options.getChannel('welcome_channel');
            const welcomeLogChannel = interaction.options.getChannel('welcome_log_channel');
            const quitLogChannel = interaction.options.getChannel('quit_log_channel');
            const welcomeImage = interaction.options.getString('welcome_image');
            const embedColor = interaction.options.getString('embed_color') || '#FFFFFF';

            // Validazione canali
            if (welcomeChannel.type !== 0) {
                return await interaction.editReply({ 
                    content: '❌ Il canale di benvenuto deve essere un canale di testo!'
                });
            }

            // Validazione URL immagine
            const urlRegex = /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;
            const isDiscordCDN = welcomeImage.includes('cdn.discordapp.com') || welcomeImage.includes('media.discordapp.net');
            
            if (!urlRegex.test(welcomeImage) && !isDiscordCDN) {
                return await interaction.editReply({ 
                    content: '❌ L\'immagine deve essere un URL valido che termina con .jpg, .jpeg, .png, .gif o .webp!'
                });
            }

            // Validazione colore
            const colorRegex = /^#?([0-9A-F]{6})$/i;
            let finalColor = 0xFFFFFF; // Bianco di default
            
            if (embedColor) {
                const cleanColor = embedColor.replace('#', '');
                if (colorRegex.test(cleanColor)) {
                    finalColor = parseInt(cleanColor, 16);
                } else {
                    return await interaction.editReply({ 
                        content: '❌ Il colore deve essere in formato esadecimale (es. #FFFFFF per bianco)!'
                    });
                }
            }

            // Salvataggio nel database - query aggiornata per gestire la colonna
            await db.query(`
                INSERT INTO guild_settings (guild_id, welcome_channel_id, welcome_log_channel_id, quit_log_channel_id, welcome_image_url, welcome_embed_color)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (guild_id)
                DO UPDATE SET
                    welcome_channel_id = EXCLUDED.welcome_channel_id,
                    welcome_log_channel_id = EXCLUDED.welcome_log_channel_id,
                    quit_log_channel_id = EXCLUDED.quit_log_channel_id,
                    welcome_image_url = EXCLUDED.welcome_image_url,
                    welcome_embed_color = EXCLUDED.welcome_embed_color,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                interaction.guild.id,
                welcomeChannel.id,
                welcomeLogChannel.id,
                quitLogChannel.id,
                welcomeImage,
                finalColor
            ]);

            // Embed di conferma
            const embed = new EmbedBuilder()
                .setTitle('✅ Sistema Welcome Configurato')
                .setDescription('Il sistema di benvenuto è stato configurato con successo!')
                .addFields(
                    { name: '📨 Canale Welcome', value: `<#${welcomeChannel.id}>`, inline: true },
                    { name: '📋 Log Welcome', value: `<#${welcomeLogChannel.id}>`, inline: true },
                    { name: '🚪 Log Uscite', value: `<#${quitLogChannel.id}>`, inline: true },
                    { name: '🖼️ Immagine', value: '[Clicca qui per vedere](' + welcomeImage + ')', inline: true },
                    { name: '🎨 Colore Embed', value: `#${finalColor.toString(16).toUpperCase().padStart(6, '0')}`, inline: true }
                )
                .setColor(finalColor)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Errore setup welcome:', error);
            console.error('Stack trace:', error.stack);
            await interaction.editReply({ 
                content: `❌ Errore durante la configurazione: ${error.message}`
            });
        }
    },
};