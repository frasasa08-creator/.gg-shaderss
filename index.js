// index.js
const { initializeStatusSystem, detectPreviousCrash, updateBotStatus, updateStatusPeriodically } = require('./utils/statusUtils');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const db = require('./db');  // importa db da nuovo file

// Inizializzazione client Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
    ],
});

// === SERVER EXPRESS PER RENDER ===
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Endpoint API per stato bot (usato dalla pagina)
app.get('/api/status', (req, res) => {
    try {
        const botUptime = process.uptime();
        const hours = Math.floor(botUptime / 3600);
        const minutes = Math.floor((botUptime % 3600) / 60);
        const seconds = Math.floor(botUptime % 60);
        
        // CONTROLLO STATO REALE DEL BOT
        let botStatus = 0;
        let statusText = '🔴 OFFLINE';
        
        if (client && client.isReady()) {
            // Se il bot è ready, è ONLINE
            botStatus = 1;
            statusText = '🟢 ONLINE';
        } else if (client) {
            // Se il client esiste ma non è ready, è CONNECTING
            botStatus = 2;
            statusText = '🟠 CONNECTING';
        }
        
        res.json({
            bot: {
                status: statusText,
                statusCode: botStatus,
                tag: client?.user?.tag || 'Offline',
                uptime: `${hours}h ${minutes}m ${seconds}s`,
                rawUptime: botUptime,
                guilds: client?.guilds?.cache?.size || 0,
                ping: client?.ws?.ping || 'N/A',
                lastUpdate: new Date().toISOString(),
                // Debug info
                isReady: client?.isReady(),
                wsStatus: client?.ws?.status
            },
            server: {
                status: '🟢 ONLINE',
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Errore in /api/status:', error);
        res.json({
            bot: {
                status: '🔴 OFFLINE',
                statusCode: 0,
                tag: 'Errore di connessione',
                uptime: '0h 0m 0s',
                guilds: 0,
                ping: 'N/A',
                lastUpdate: new Date().toISOString()
            },
            server: {
                status: '🟢 ONLINE',
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            }
        });
    }
});

// Health check migliorato
app.get('/health', (req, res) => {
    if (client && client.isReady()) {
        res.status(200).json({ 
            status: 'ok', 
            bot: 'online',
            timestamp: new Date().toISOString()
        });
    } else {
        res.status(503).json({ 
            status: 'error', 
            bot: 'offline',
            timestamp: new Date().toISOString()
        });
    }
});

// Root endpoint per Render
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'Bot is running',
        bot: client?.isReady() ? 'online' : 'starting',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server health check in ascolto sulla porta ${PORT}`);
});

// Pagina principale con AUTO-REFRESH
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Discord Bot Status</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                
                .container {
                    background: rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    max-width: 500px;
                    width: 100%;
                    text-align: center;
                }
                
                .status-icon {
                    font-size: 4rem;
                    margin-bottom: 20px;
                }
                
                .online { color: #4CAF50; }
                .offline { color: #f44336; }
                .connecting { color: #ff9800; }
                
                .status-text {
                    font-size: 1.5rem;
                    font-weight: bold;
                    margin-bottom: 10px;
                }
                
                .bot-info {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    padding: 20px;
                    margin: 15px 0;
                }
                
                .info-item {
                    display: flex;
                    justify-content: space-between;
                    margin: 8px 0;
                    font-size: 1rem;
                }
                
                .label {
                    font-weight: 600;
                }
                
                .value {
                    font-weight: 300;
                }
                
                .last-update {
                    font-size: 0.8rem;
                    opacity: 0.8;
                    margin-top: 20px;
                }
                
                .refresh-notice {
                    font-size: 0.9rem;
                    opacity: 0.7;
                    margin-top: 10px;
                }
                
                .pulse {
                    animation: pulse 2s infinite;
                }
                
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.7; }
                    100% { opacity: 1; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div id="statusIcon" class="status-icon">⏳</div>
                <div id="statusText" class="status-text">Caricamento...</div>
                
                <div class="bot-info">
                    <div class="info-item">
                        <span class="label">🤖 Bot:</span>
                        <span id="botTag" class="value">-</span>
                    </div>
                    <div class="info-item">
                        <span class="label">📊 Stato:</span>
                        <span id="botStatus" class="value">-</span>
                    </div>
                    <div class="info-item">
                        <span class="label">⏱️ Uptime:</span>
                        <span id="botUptime" class="value">-</span>
                    </div>
                    <div class="info-item">
                        <span class="label">🏠 Server:</span>
                        <span id="botGuilds" class="value">-</span>
                    </div>
                    <div class="info-item">
                        <span class="label">📡 Ping:</span>
                        <span id="botPing" class="value">-</span>
                    </div>
                </div>
                
                <div id="lastUpdate" class="last-update"></div>
                <div class="refresh-notice">🔄 Aggiornamento automatico ogni 5 secondi</div>
            </div>

            <script>
                // Funzione per aggiornare lo stato
                async function updateStatus() {
                    try {
                        const response = await fetch('/api/status');
                        const data = await response.json();
                        
                        // Aggiorna l'interfaccia
                        updateUI(data.bot);
                    } catch (error) {
                        // Se c'è errore, il bot è probabilmente offline
                        updateUI({
                            status: '🔴 OFFLINE',
                            tag: 'Non raggiungibile',
                            uptime: '0h 0m 0s',
                            guilds: 0,
                            ping: 'N/A',
                            statusCode: 0
                        });
                    }
                }
                
                // Funzione per aggiornare l'UI
                function updateUI(bot) {
                    const statusIcon = document.getElementById('statusIcon');
                    const statusText = document.getElementById('statusText');
                    const botTag = document.getElementById('botTag');
                    const botStatus = document.getElementById('botStatus');
                    const botUptime = document.getElementById('botUptime');
                    const botGuilds = document.getElementById('botGuilds');
                    const botPing = document.getElementById('botPing');
                    const lastUpdate = document.getElementById('lastUpdate');
                    
                    // Aggiorna i valori
                    botTag.textContent = bot.tag;
                    botStatus.textContent = bot.status;
                    botUptime.textContent = bot.uptime;
                    botGuilds.textContent = bot.guilds;
                    botPing.textContent = bot.ping + 'ms';
                    
                    // Aggiorna icona e colore in base allo stato
                    statusIcon.className = 'status-icon';
                    statusText.className = 'status-text';
                    
                    if (bot.statusCode === 1) { // ONLINE
                        statusIcon.textContent = '🤖';
                        statusIcon.classList.add('online', 'pulse');
                        statusText.classList.add('online');
                    } else if (bot.statusCode === 0) { // OFFLINE
                        statusIcon.textContent = '🔴';
                        statusIcon.classList.add('offline');
                        statusText.classList.add('offline');
                    } else { // CONNECTING/RECONNECTING
                        statusIcon.textContent = '🟠';
                        statusIcon.classList.add('connecting', 'pulse');
                        statusText.classList.add('connecting');
                    }
                    
                    // Aggiorna timestamp
                    lastUpdate.textContent = '🕒 Ultimo aggiornamento: ' + new Date().toLocaleTimeString();
                }
                
                // Aggiorna immediatamente al caricamento
                updateStatus();
                
                // Aggiorna ogni 5 secondi
                setInterval(updateStatus, 5000);
                
                // Anche se la pagina perde focus, quando ritorna attiva aggiorna
                document.addEventListener('visibilitychange', function() {
                    if (!document.hidden) {
                        updateStatus();
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Avvia server web con error handling ⬅️ MODIFICATO
let server;
try {
    server = app.listen(PORT, () => {
        console.log(`🚀 Server web attivo sulla porta ${PORT}`);
        console.log(`🌐 Status page disponibile`);
    });
} catch (error) {
    console.error('❌ Errore avvio server web:', error);
    console.log('⚠️  Server web non avviato, ma bot Discord funziona');
}

// Collezioni comandi e cooldown
client.commands = new Collection();
client.cooldowns = new Collection();

// Caricamento comandi
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    }
}

// Caricamento eventi
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

// Gestione interazioni
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Errore eseguendo ${interaction.commandName}:`, error);
            
            // Gestione errori specifica per interaction già risposte
            if (error.code === 'InteractionNotReplied') {
                try {
                    await interaction.reply({ 
                        content: '❌ Errore: Interaction già processata', 
                        flags: 64 
                    });
                } catch (replyError) {
                    console.log('⚠️ Impossibile rispondere all\'interaction');
                }
            } else if (error.code === 10062) {
                console.log('⚠️ Interaction sconosciuta, ignorando...');
            } else {
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ 
                            content: '❌ Si è verificato un errore eseguendo questo comando!', 
                            flags: 64 
                        });
                    }
                } catch (replyError) {
                    console.log('⚠️ Impossibile rispondere all\'interaction');
                }
            }
        }
    }

    // Gestione menu select per ticket
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_select') {
            try {
                const { createTicket } = require('./utils/ticketUtils');
                await createTicket(interaction, interaction.values[0]);
            } catch (error) {
                console.error('Errore creazione ticket:', error);
                if (!interaction.replied && !interaction.deferred) {
                    try {
                        await interaction.reply({ 
                            content: '❌ Errore durante la creazione del ticket!', 
                            flags: 64 
                        });
                    } catch (replyError) {
                        console.log('⚠️ Impossibile rispondere all\'interaction');
                    }
                }
            }
        }
    }

    // Gestione bottone per chiudere ticket (mostra modal)
    if (interaction.isButton()) {
        if (interaction.customId === 'close_ticket') {
            try {
                const { showCloseTicketModal } = require('./utils/ticketUtils');
                await showCloseTicketModal(interaction);
            } catch (error) {
                console.error('Errore mostrare modal chiusura:', error);
                if (!interaction.replied && !interaction.deferred) {
                    try {
                        await interaction.reply({ 
                            content: '❌ Errore durante l\'apertura del form di chiusura!', 
                            flags: 64 
                        });
                    } catch (replyError) {
                        console.log('⚠️ Impossibile rispondere all\'interaction');
                    }
                }
            }
        }
    }

    // Gestione modal per chiusura ticket con motivazione
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'close_ticket_modal') {
            try {
                const { closeTicketWithReason } = require('./utils/ticketUtils');
                await closeTicketWithReason(interaction);
            } catch (error) {
                console.error('Errore chiusura ticket con motivazione:', error);
                if (!interaction.replied && !interaction.deferred) {
                    try {
                        await interaction.reply({ 
                            content: '❌ Errore durante la chiusura del ticket!', 
                            flags: 64 
                        });
                    } catch (replyError) {
                        console.log('⚠️ Impossibile rispondere all\'interaction');
                    }
                }
            }
        }
    }
});

// Inizializza database
async function initDatabase() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id VARCHAR(20) PRIMARY KEY,
                welcome_channel_id VARCHAR(20),
                welcome_log_channel_id VARCHAR(20),
                quit_log_channel_id VARCHAR(20),
                ticket_log_channel_id VARCHAR(20),
                moderation_log_channel_id VARCHAR(20),
                welcome_image_url TEXT,
                ticket_categories TEXT,
                settings JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                channel_id VARCHAR(20) NOT NULL,
                ticket_type VARCHAR(100) NOT NULL,
                status VARCHAR(20) DEFAULT 'open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP,
                close_reason TEXT
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER REFERENCES tickets(id),
                user_id VARCHAR(20) NOT NULL,
                username VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
                
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS bot_status (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(20) PRIMARY KEY,
                status_channel_id VARCHAR(20),
                status_message_id VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
        CREATE TABLE IF NOT EXISTS persistent_roles (
            user_id VARCHAR(20) NOT NULL,
            guild_id VARCHAR(20) NOT NULL,
            role_id VARCHAR(20) NOT NULL,
            assigned_by VARCHAR(20) NOT NULL,
            assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, guild_id, role_id)
            )
        `);

        console.log('✅ Database inizializzato correttamente');
    } catch (error) {
        console.error('❌ Errore inizializzazione database:', error);
    }
}

let isDeploying = false;

async function deployCommands() {
  // Skip se già fatto o disabilitato
  if (process.env.REGISTER_COMMANDS !== 'true' || isDeploying) {
    console.log('Deploy comandi SKIPPATO (già fatto o in corso)');
    return;
  }

  isDeploying = true;
  console.log('Inizio registrazione comandi per i 2 server...');

  // Carica comandi
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    try {
      const command = require(`./commands/${file}`);
      if (command.data?.name) {
        commands.push(command.data.toJSON());
      }
    } catch (err) {
      console.error(`Errore caricamento comando ${file}:`, err.message);
    }
  }

  if (commands.length === 0) {
    console.log('Nessun comando da registrare.');
    isDeploying = false;
    return;
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Lista dei tuoi 2 server (da .env o hardcoded)
  const guildIds = [
    process.env.GUILD_ID_1,  // Server 1
    process.env.GUILD_ID_2   // Server 2
  ].filter(id => id); // rimuovi null/undefined

  if (guildIds.length === 0) {
    console.log('Nessun GUILD_ID configurato!');
    isDeploying = false;
    return;
  }

  // Registra per ogni server
  for (const guildId of guildIds) {
    try {
      console.log(`Registrazione comandi in ${guildId}...`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`Comandi registrati in ${guildId}`);
    } catch (error) {
      if (error.code === 429) {
        const wait = (error.retry_after || 10) * 1000;
        console.log(`Rate limit! Aspetto ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        // Riprova una volta
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
      } else {
        console.error(`Errore in ${guildId}:`, error.message);
      }
    }
  }

  console.log('Tutti i comandi registrati nei 2 server!');
  isDeploying = false;
}

// Gestione riconnessione automatica
client.on('disconnect', () => {
    console.log('🔌 Bot disconnesso da Discord...');
});

client.on('reconnecting', () => {
    console.log('🔄 Riconnessione a Discord in corso...');
});

client.on('resume', (replayed) => {
    console.log(`✅ Connessione ripristinata. Eventi replay: ${replayed}`);
});

client.on('error', (error) => {
    console.error('❌ Errore client Discord:', error);
});

// Avvio bot
client.once('ready', async () => {
    console.log(`✅ Bot online come ${client.user.tag}`);
    console.log(`🏠 Server: ${client.guilds.cache.size} server`);
    console.log(`👥 Utenti: ${client.users.cache.size} utenti`);
    console.log(`🌐 Web Server: Porta ${PORT}`);
    
    await initDatabase();
    await deployCommands();

    // Rileva se c'è stato un crash
    await detectPreviousCrash(client);
    
    // Inizializza il sistema di status
    await initializeStatusSystem(client);
    
    // Aggiorna status a ONLINE
    await updateBotStatus(client, 'online', 'Avvio completato');
    
    // Imposta attività del bot
    client.user.setActivity({
        name: `${client.guilds.cache.size} servers | /help`,
        type: 3 // WATCHING
    });
    
    // Aggiorna status ogni 5 minuti
    setInterval(() => {
        updateStatusPeriodically(client);
    }, 5 * 60 * 1000);

    // Keep-alive interno per prevenire sospensioni Render
    setInterval(() => {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        console.log(`❤️  Keep-alive - Bot attivo da ${hours}h ${minutes}m`);
        
        // Aggiorna attività bot
        client.user.setActivity({
            name: `${client.guilds.cache.size} servers | ${hours}h uptime`,
            type: 3 // WATCHING
        });
        
    }, 10 * 60 * 1000); // Ogni 10 minuti
});

// Gestione shutdown graceful ⬅️ MODIFICATO
async function gracefulShutdown(reason = 'Unknown') {
    console.log(`🔴 Arresto bot in corso... Motivo: ${reason}`);
    
    try {
        // 1. PRIMA chiudi il server web
        if (server) {
            server.close(() => {
                console.log('✅ Server web chiuso');
            });
        }
    } catch (error) {
        console.error('❌ Errore chiusura server web:', error);
    }
    
    try {
        // 2. POI aggiorna status bot
        await updateBotStatus(client, 'offline', `Arresto: ${reason}`);
    } catch (error) {
        console.error('❌ Errore aggiornamento status:', error);
    }
    
    try {
        // 3. INFINE distruggi client Discord
        if (client && !client.destroyed) {
            client.destroy();
            console.log('✅ Client Discord distrutto');
        }
    } catch (error) {
        console.error('❌ Errore distruzione client:', error);
    }
    
    // Esci dopo breve attesa
    setTimeout(() => {
        process.exit(0);
    }, 3000);
}

// Gestione signal events
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', async (error) => {
    console.error('❌ Eccezione non catturata:', error);
    try {
        await updateBotStatus(client, 'error', `Crash: ${error.message}`);
    } catch (statusError) {
        console.error('❌ Impossibile aggiornare status durante crash:', statusError);
    }
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', async (error) => {
    console.error('❌ Promise rejection non gestito:', error);
    try {
        await updateBotStatus(client, 'error', `Rejection: ${error.message}`);
    } catch (statusError) {
        console.error('❌ Impossibile aggiornare status durante rejection:', statusError);
    }
});

// Export client e db
module.exports = { client, db };

// Login bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Errore login bot:', error);
    process.exit(1);
});

console.log('✅ File index.js caricato completamente');
