const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { createDatabase } = require('../config/database');

// Connessione database per questo comando
const db = createDatabase();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('allowedroles')
        .setDescription('Gestisci i ruoli autorizzati ad usare i comandi del bot')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Imposta i ruoli autorizzati')
                .addStringOption(option =>
                    option
                        .setName('ruoli')
                        .setDescription('ID dei ruoli autorizzati (separati da virgola)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Aggiungi ruoli alla lista degli autorizzati')
                .addStringOption(option =>
                    option
                        .setName('ruoli')
                        .setDescription('ID dei ruoli da aggiungere (separati da virgola)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Rimuovi ruoli dalla lista degli autorizzati')
                .addStringOption(option =>
                    option
                        .setName('ruoli')
                        .setDescription('ID dei ruoli da rimuovere (separati da virgola)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Rimuovi tutti i ruoli autorizzati')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('show')
                .setDescription('Mostra i ruoli autorizzati attuali')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        // ⬇️⬇️⬇️ DEFER IMMEDIATO CON FLAGS CORRETTO ⬇️⬇️⬇️
        await interaction.deferReply({ flags: 64 });

        try {
            // Controllo permessi amministratore (dopo il defer)
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.editReply({
                    content: '❌ Non hai i permessi necessari per utilizzare questo comando.'
                });
            }

            const subcommand = interaction.options.getSubcommand();
            const rolesString = interaction.options.getString('ruoli');

            // ⬇️⬇️⬇️ MESSAGGIO DI CARICAMENTO PER OPERAZIONI LUNGHE ⬇️⬇️⬇️
            if (subcommand !== 'show' && subcommand !== 'clear') {
                await interaction.editReply({ 
                    content: '🔄 Validazione ruoli in corso...' 
                });
            }

            // Recupera la configurazione attuale con TIMEOUT
            const dbResult = await db.query(
                'SELECT settings FROM guild_settings WHERE guild_id = $1',
                [interaction.guild.id]
            );

            let currentSettings = dbResult.rows.length > 0 ? dbResult.rows[0].settings : {};
            let allowedRoles = currentSettings.allowed_roles || [];

            // ⬇️⬇️⬇️ GESTIONE SEPARATA PER SOTTOCOMANDI SEMPLICI PRIMA ⬇️⬇️⬇️
            if (subcommand === 'show') {
                await handleShowSubcommand(interaction, allowedRoles);
                return;
            }

            if (subcommand === 'clear') {
                await handleClearSubcommand(interaction, allowedRoles);
                return;
            }

            // ⬇️⬇️⬇️ GESTIONE RUOLI CON VALIDAZIONE OTTIMIZZATA ⬇️⬇️⬇️
            await handleRolesSubcommand(interaction, subcommand, rolesString, allowedRoles);

        } catch (error) {
            console.error('Errore comando allowedroles:', error);
            
            // ⬇️⬇️⬇️ GESTIONE ERRORI MIGLIORATA ⬇️⬇️⬇️
            try {
                const errorMessage = error.message.includes('timeout') || error.message.includes('Timeout')
                    ? '⏰ Il comando ha impiegato troppo tempo. Riprova più tardi.'
                    : '❌ Errore durante l\'esecuzione del comando.';

                await interaction.editReply({ content: errorMessage });
            } catch (editError) {
                console.log('⚠️ Interaction scaduta, impossibile rispondere');
            }
        }
    },
};

// ⬇️⬇️⬇️ FUNZIONI SEPARATE PER OTTIMIZZARE ⬇️⬇️⬇️

async function handleShowSubcommand(interaction, allowedRoles) {
    const embed = new EmbedBuilder()
        .setTitle('👥 Ruoli Autorizzati')
        .setColor(0x0099FF)
        .setTimestamp();

    if (allowedRoles.length === 0) {
        embed.setDescription('❌ Nessun ruolo autorizzato configurato.\nSolo gli amministratori possono usare i comandi.');
    } else {
        // ⬇️⬇️⬇️ FETCH PARALLELO PER PERFORMANCE ⬇️⬇️⬇️
        const rolePromises = allowedRoles.map(roleId => 
            interaction.guild.roles.fetch(roleId).catch(() => null)
        );
        
        const roles = await Promise.all(rolePromises);
        const validRoles = roles.filter(role => role !== null);
        const invalidRoleIds = allowedRoles.filter((_, index) => roles[index] === null);

        if (validRoles.length === 0) {
            embed.setDescription('❌ Tutti i ruoli autorizzati non sono più validi.');
        } else {
            const roleDetails = validRoles.map(role => 
                `• ${role.toString()} (ID: ${role.id})`
            );

            if (invalidRoleIds.length > 0) {
                roleDetails.push(`\n❌ **Ruoli non trovati:** ${invalidRoleIds.join(', ')}`);
            }

            embed.addFields(
                { name: `Ruoli Autorizzati (${validRoles.length})`, value: roleDetails.join('\n') }
            );
        }
    }

    await interaction.editReply({ embeds: [embed] });
}

async function handleClearSubcommand(interaction, allowedRoles) {
    if (allowedRoles.length === 0) {
        await interaction.editReply({
            content: '❌ Non ci sono ruoli autorizzati da rimuovere.'
        });
        return;
    }

    await db.query(`
        INSERT INTO guild_settings (guild_id, settings)
        VALUES ($1, jsonb_build_object('allowed_roles', '[]'::jsonb))
        ON CONFLICT (guild_id)
        DO UPDATE SET
            settings = jsonb_set(
                COALESCE(guild_settings.settings, '{}'::jsonb),
                '{allowed_roles}',
                '[]'::jsonb
            ),
            updated_at = CURRENT_TIMESTAMP
    `, [interaction.guild.id]);

    await interaction.editReply({
        content: '✅ Tutti i ruoli autorizzati sono stati rimossi. Solo gli amministratori potranno usare i comandi.'
    });
}

async function handleRolesSubcommand(interaction, subcommand, rolesString, allowedRoles) {
    // Parsing e validazione ruoli
    const inputRoles = rolesString.split(',').map(roleId => roleId.trim());
    const validRoles = [];
    const invalidRoles = [];

    // ⬇️⬇️⬇️ VALIDAZIONE INIZIALE SENZA FETCH ⬇️⬇️⬇️
    for (const roleId of inputRoles) {
        if (!/^\d{17,20}$/.test(roleId)) {
            invalidRoles.push(roleId);
            continue;
        }
        validRoles.push(roleId);
    }

    if (invalidRoles.length > 0) {
        await interaction.editReply({
            content: `❌ ID ruoli non validi: ${invalidRoles.join(', ')}\nGli ID devono essere numerici (17-20 cifre).`
        });
        return;
    }

    if (validRoles.length === 0) {
        await interaction.editReply({
            content: '❌ Nessun ruolo valido specificato.'
        });
        return;
    }

    // ⬇️⬇️⬇️ VERIFICA ESISTENZA RUOLI CON FETCH PARALLELO ⬇️⬇️⬇️
    await interaction.editReply({ 
        content: '🔍 Verifica esistenza ruoli...' 
    });

    const roleCheckPromises = validRoles.map(roleId =>
        interaction.guild.roles.fetch(roleId).then(role => ({ roleId, role }))
    );

    const roleResults = await Promise.all(roleCheckPromises);
    const existingRoles = [];
    const nonExistingRoles = [];

    roleResults.forEach(({ roleId, role }) => {
        if (role) {
            existingRoles.push(roleId);
        } else {
            nonExistingRoles.push(roleId);
        }
    });

    if (nonExistingRoles.length > 0) {
        await interaction.editReply({
            content: `❌ Ruoli non trovati nel server: ${nonExistingRoles.join(', ')}`
        });
        return;
    }

    // ⬇️⬇️⬇️ ELABORAZIONE RUOLI ⬇️⬇️⬇️
    let newAllowedRoles = [];
    let action = '';
    let description = '';

    switch (subcommand) {
        case 'set':
            newAllowedRoles = [...new Set(existingRoles)];
            action = 'impostati';
            description = `I ruoli autorizzati sono stati impostati.`;
            break;

        case 'add':
            newAllowedRoles = [...new Set([...allowedRoles, ...existingRoles])];
            action = 'aggiunti';
            description = `I ruoli sono stati aggiunti alla lista degli autorizzati.`;
            break;

        case 'remove':
            newAllowedRoles = allowedRoles.filter(roleId => !existingRoles.includes(roleId));
            action = 'rimossi';
            description = `I ruoli sono stati rimossi dalla lista degli autorizzati.`;
            break;
    }

    // ⬇️⬇️⬇️ SALVATAGGIO DATABASE ⬇️⬇️⬇️
    await interaction.editReply({ 
        content: '💾 Salvataggio configurazione...' 
    });

    await db.query(`
        INSERT INTO guild_settings (guild_id, settings)
        VALUES ($1, jsonb_build_object('allowed_roles', $2::jsonb))
        ON CONFLICT (guild_id)
        DO UPDATE SET
            settings = jsonb_set(
                COALESCE(guild_settings.settings, '{}'::jsonb),
                '{allowed_roles}',
                $2::jsonb
            ),
            updated_at = CURRENT_TIMESTAMP
    `, [interaction.guild.id, JSON.stringify(newAllowedRoles)]);

    // ⬇️⬇️⬇️ MESSAGGIO FINALE ⬇️⬇️⬇️
    const roleNames = roleResults
        .filter(({ role }) => role)
        .map(({ role }) => role.name);

    const embed = new EmbedBuilder()
        .setTitle('✅ Ruoli Autorizzati Aggiornati')
        .setDescription(description)
        .addFields(
            { name: '📊 Azione', value: action, inline: true },
            { name: '👥 Ruoli ' + action, value: existingRoles.length.toString(), inline: true },
            { name: '📋 Nomi Ruoli', value: roleNames.join(', ') || 'N/A', inline: false },
            { name: '🔢 ID Ruoli', value: existingRoles.join(', '), inline: false },
            { name: '📈 Totale Ruoli Autorizzati', value: newAllowedRoles.length.toString(), inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}
