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
                .setDescription('URL o carica un\'immagine PNG per il benvenuto')
                .setRequired(true))
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

            const welcomeChannel = interaction.options.getChannel('welcome_channel');
            const welcomeLogChannel = interaction.options.getChannel('welcome_log_channel');
            const quitLogChannel = interaction.options.getChannel('quit_log_channel');
            const welcomeImage = interaction.options.getString('welcome_image');

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

            // Salvataggio nel database
            await db.query(`
                INSERT INTO guild_settings (guild_id, welcome_channel_id, welcome_log_channel_id, quit_log_channel_id, welcome_image_url)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (guild_id)
                DO UPDATE SET
                    welcome_channel_id = $2,
                    welcome_log_channel_id = $3,
                    quit_log_channel_id = $4,
                    welcome_image_url = $5,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                interaction.guild.id,
                welcomeChannel.id,
                welcomeLogChannel.id,
                quitLogChannel.id,
                welcomeImage
            ]);

            // Embed di conferma
            const embed = new EmbedBuilder()
                .setTitle('✅ Sistema Welcome Configurato')
                .setDescription('Il sistema di benvenuto è stato configurato con successo!')
                .addFields(
                    { name: '📨 Canale Welcome', value: `<#${welcomeChannel.id}>`, inline: true },
                    { name: '📋 Log Welcome', value: `<#${welcomeLogChannel.id}>`, inline: true },
                    { name: '🚪 Log Uscite', value: `<#${quitLogChannel.id}>`, inline: true },
                    { name: '🖼️ Immagine', value: '[Clicca qui per vedere](' + welcomeImage + ')', inline: false }
                )
                .setColor(0x00ff00)
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