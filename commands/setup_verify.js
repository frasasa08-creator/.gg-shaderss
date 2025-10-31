const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ButtonStyle } = require('discord.js');
const { createDatabase } = require('../config/database');
const { createVerifyEmbed, createVerifyButton, createActionRow } = require('../utils/verifyUtils');

const db = createDatabase();

// Funzione per verificare e aggiungere le colonne verify se non esistono
async function ensureVerifyColumnsExist() {
    try {
        const columnsToCheck = [
            'verify_channel_id',
            'verify_roles', 
            'verify_embed_title',
            'verify_embed_description',
            'verify_embed_image',
            'verify_embed_color',
            'verify_button_text',
            'verify_button_style',
            'verify_message_id' // AGGIUNTA QUESTA COLONNA
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
                } else if (columnName === 'verify_embed_color') {
                    alterQuery = `ALTER TABLE guild_settings ADD COLUMN ${columnName} INTEGER DEFAULT 0x0099FF`;
                } else if (columnName === 'verify_button_text') {
                    alterQuery = `ALTER TABLE guild_settings ADD COLUMN ${columnName} TEXT DEFAULT 'Verifica'`;
                } else if (columnName === 'verify_button_style') {
                    alterQuery = `ALTER TABLE guild_settings ADD COLUMN ${columnName} TEXT DEFAULT 'primary'`;
                } else if (columnName === 'verify_message_id') {
                    alterQuery = `ALTER TABLE guild_settings ADD COLUMN ${columnName} TEXT`;
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup_verify')
        .setDescription('Configura il sistema di verifica')
        // PRIMA tutte le opzioni OBBLIGATORIE
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Canale dove inviare il messaggio di verifica')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Titolo dell\'embed di verifica')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Descrizione dell\'embed di verifica')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('image')
                .setDescription('URL immagine per l\'embed')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role1')
                .setDescription('Primo ruolo da assegnare')
                .setRequired(true))
        // POI tutte le opzioni OPZIONALI
        .addStringOption(option =>
            option.setName('button_text')
                .setDescription('Testo del bottone di verifica')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('button_color')
                .setDescription('Colore del bottone (primary, success, danger, secondary)')
                .setRequired(false)
                .addChoices(
                    { name: 'Blu', value: 'primary' },
                    { name: 'Verde', value: 'success' },
                    { name: 'Rosso', value: 'danger' },
                    { name: 'Grigio', value: 'secondary' }
                ))
        .addStringOption(option =>
            option.setName('embed_color')
                .setDescription('Colore dell\'embed in esadecimale (es. #0099FF)')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('role2')
                .setDescription('Secondo ruolo da assegnare (opzionale)')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('role3')
                .setDescription('Terzo ruolo da assegnare (opzionale)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Assicurati che le colonne esistano nel database
            await ensureVerifyColumnsExist();

            // Opzioni obbligatorie
            const channel = interaction.options.getChannel('channel');
            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');
            const image = interaction.options.getString('image');
            const role1 = interaction.options.getRole('role1');
            
            // Opzioni opzionali
            const buttonText = interaction.options.getString('button_text') || 'Verifica';
            const buttonColor = interaction.options.getString('button_color') || 'primary';
            const embedColor = interaction.options.getString('embed_color') || '#0099FF';
            const role2 = interaction.options.getRole('role2');
            const role3 = interaction.options.getRole('role3');

            // Validazione canale
            if (channel.type !== 0) {
                return await interaction.editReply({ 
                    content: '❌ Il canale deve essere un canale di testo!'
                });
            }

            // Validazione URL immagine
            const urlRegex = /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;
            const isDiscordCDN = image.includes('cdn.discordapp.com') || image.includes('media.discordapp.net');
            
            if (!urlRegex.test(image) && !isDiscordCDN) {
                return await interaction.editReply({ 
                    content: '❌ L\'immagine deve essere un URL valido!'
                });
            }

            // Preparazione ruoli
            const roles = [role1];
            if (role2) roles.push(role2);
            if (role3) roles.push(role3);

            // Verifica che il bot possa gestire i ruoli
            const botMember = interaction.guild.members.me;
            for (const role of roles) {
                if (botMember.roles.highest.position <= role.position) {
                    return await interaction.editReply({ 
                        content: `❌ Non posso assegnare il ruolo ${role.name} perché è più alto dei miei ruoli!`
                    });
                }
            }

            // Converti colore embed
            let finalEmbedColor = 0x0099FF;
            if (embedColor) {
                const cleanColor = embedColor.replace('#', '');
                if (/^[0-9A-F]{6}$/i.test(cleanColor)) {
                    finalEmbedColor = parseInt(cleanColor, 16);
                }
            }

            // Converti colore bottone
            const buttonStyles = {
                primary: ButtonStyle.Primary,
                success: ButtonStyle.Success,
                danger: ButtonStyle.Danger,
                secondary: ButtonStyle.Secondary
            };
            const buttonStyle = buttonStyles[buttonColor] || ButtonStyle.Primary;

            // Crea l'embed e il bottone
            const embed = createVerifyEmbed(title, description, image, finalEmbedColor);
            const button = createVerifyButton(buttonText, 'verify_button', buttonStyle);
            const actionRow = createActionRow(button);

            // Invia il messaggio di verifica
            const verifyMessage = await channel.send({ 
                embeds: [embed], 
                components: [actionRow] 
            });

            // Salva le impostazioni nel database
            await db.query(`
                INSERT INTO guild_settings (guild_id, verify_channel_id, verify_roles, verify_embed_title, verify_embed_description, verify_embed_image, verify_embed_color, verify_button_text, verify_button_style, verify_message_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (guild_id)
                DO UPDATE SET
                    verify_channel_id = $2,
                    verify_roles = $3,
                    verify_embed_title = $4,
                    verify_embed_description = $5,
                    verify_embed_image = $6,
                    verify_embed_color = $7,
                    verify_button_text = $8,
                    verify_button_style = $9,
                    verify_message_id = $10,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                interaction.guild.id,
                channel.id,
                JSON.stringify(roles.map(role => role.id)),
                title,
                description,
                image,
                finalEmbedColor,
                buttonText,
                buttonColor,
                verifyMessage.id
            ]);

            // Embed di conferma
            const confirmEmbed = new EmbedBuilder()
                .setTitle('✅ Sistema Verifica Configurato')
                .setDescription('Il sistema di verifica è stato configurato con successo!')
                .addFields(
                    { name: '📨 Canale', value: `<#${channel.id}>`, inline: true },
                    { name: '🎨 Colore Embed', value: `#${finalEmbedColor.toString(16).toUpperCase().padStart(6, '0')}`, inline: true },
                    { name: '🔘 Bottone', value: buttonText, inline: true },
                    { name: '🎯 Colore Bottone', value: buttonColor, inline: true },
                    { name: '👥 Ruoli', value: roles.map(role => role.toString()).join(', '), inline: false },
                    { name: '📝 Messaggio ID', value: verifyMessage.id, inline: false }
                )
                .setColor(finalEmbedColor)
                //.setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            console.log(`✅ Sistema verify configurato per ${interaction.guild.name} da ${interaction.user.tag}`);

        } catch (error) {
            console.error('Errore setup verify:', error);
            await interaction.editReply({ 
                content: `❌ Errore durante la configurazione: ${error.message}`
            });
        }
    },
};
