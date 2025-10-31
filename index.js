 // index.js
const { initializeStatusSystem, detectPreviousCrash, updateBotStatus, updateStatusPeriodically } = require('./utils/statusUtils');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('./db'); // importa db da nuovo file

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
            botStatus = 1;
            statusText = '🟢 ONLINE';
        } else if (client) {
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

// === PAGINA PRINCIPALE: STATUS + WIDGET + PULSANTE INVITO ===
app.get('/', (req, res) => {
    // Fallback JSON per Render
    if (req.headers['user-agent']?.includes('Render') || req.query.raw) {
        return res.status(200).json({
            status: 'Bot is running',
            bot: client?.isReady() ? 'online' : 'starting',
            timestamp: new Date().toISOString()
        });
    }

    // Link di invito (sostituisci con il tuo CLIENT_ID)
    const INVITE_LINK = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID || 'IL_TUO_CLIENT_ID'}&scope=bot+applications.commands&permissions=8`;

    res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>.gg/shaderss • Status</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f0f0f;
      --card: #1a1a1a;
      --text: #e0e0e0;
      --text-light: #aaaaaa;
      --accent: #00d4ff;
      --border: #333333;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif;
      min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px;
    }
    .container {
      background: var(--card); border: 1px solid var(--border); border-radius: 16px;
      padding: 32px; max-width: 900px; width: 100%; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      position: relative;
    }
    .header {
      text-align: center; margin-bottom: 32px;
    }
    .header h1 {
      font-size: 2.2rem; font-weight: 700; color: white;
    }
    .header p {
      color: var(--text-light); margin-top: 8px; font-size: 1rem;
    }
    .invite-btn {
      position: absolute; top: 20px; right: 20px;
      background: #5865F2; color: white; padding: 10px 18px;
      border-radius: 8px; font-weight: 600; font-size: 0.9rem;
      text-decoration: none; display: flex; align-items: center; gap: 8px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(88, 101, 242, 0.3);
    }
    .invite-btn:hover {
      background: #4752c4; transform: translateY(-2px); box-shadow: 0 6px 16px rgba(88, 101, 242, 0.4);
    }
    .invite-btn svg {
      width: 18px; height: 18px;
    }
    .grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
    }
    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
      .invite-btn { position: static; margin-bottom: 20px; justify-self: center; }
    }
    .card {
      background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; border: 1px solid var(--border);
    }
    .card h3 {
      font-size: 1.1rem; margin-bottom: 16px; color: white; display: flex; align-items: center; gap: 8px;
    }
    .status {
      font-size: 2rem; font-weight: 700; display: flex; align-items: center; gap: 12px;
    }
    .online { color: #00ff88; }
    .offline { color: #ff4444; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
    .info-grid {
      display: grid; grid-template-columns: max-content 1fr; gap: 12px 16px; font-size: 0.95rem;
    }
    .label { color: var(--text-light); }
    .value { color: white; text-align: right; }
    .widget-container {
      background: #2f3136; border-radius: 12px; overflow: hidden; border: 1px solid #444;
    }
    .footer {
      text-align: center; margin-top: 32px; color: var(--text-light); font-size: 0.9rem;
    }
    .refresh {
      text-align: center; margin-top: 16px; font-size: 0.8rem; color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- PULSANTE INVITA -->
    <a href="${INVITE_LINK}" target="_blank" class="invite-btn">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a13.83 13.83 0 0 0 1.226-1.963a.074.074 0 0 0-.041-.105a13.2 13.2 0 0 1-1.872-.878a.075.075 0 0 1-.008-.125a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.075.075 0 0 1-.006.125a12.3 12.3 0 0 1-1.873.878a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.963a.077.077 0 0 0 .084.028a19.9 19.9 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.057c.49-5.38-.2-9.89-3.45-13.66a.07.07 0 0 0-.032-.027z"/></svg>
      Bot Invite
    </a>

    <div class="header">
      <h1>.gg/shaderss</h1>
      <p>Discord Bot • 24/7</p>
    </div>

    <div class="grid">
      <!-- STATUS CARD -->
      <div class="card">
        <h3>Bot Status</h3>
        <div class="status" id="status">Caricamento...</div>
        <div class="info-grid">
          <span class="label">Tag:</span> <span class="value" id="tag">-</span>
          <span class="label">Server:</span> <span class="value" id="guilds">-</span>
          <span class="label">Ping:</span> <span class="value" id="ping">-</span>
          <span class="label">Uptime:</span> <span class="value" id="uptime">-</span>
        </div>
      </div>

      <!-- WIDGET CARD -->
      <div class="card">
        <h3>Server Live</h3>
        <div class="widget-container">
          <iframe src="https://discord.com/widget?id=1431629401384026234&theme=dark" 
                  width="100%" height="400" allowtransparency="true" frameborder="0" 
                  sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                  style="border-radius: 8px;"></iframe>
        </div>
      </div>
    </div>

    <div class="footer">
      Powered by sasa1111
    </div>
    <div class="refresh"></div>
  </div>

  <script>
    async function updateStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const bot = data.bot;

        const statusEl = document.getElementById('status');
        statusEl.innerHTML = bot.statusCode === 1 
          ? '<span class="online pulse">ONLINE</span>' 
          : '<span class="offline">OFFLINE</span>';

        document.getElementById('tag').textContent = bot.tag;
        document.getElementById('guilds').textContent = bot.guilds;
        document.getElementById('ping').textContent = bot.ping + 'ms';
        document.getElementById('uptime').textContent = bot.uptime;
      } catch (err) {
        document.getElementById('status').innerHTML = '<span class="offline">ERRORE</span>';
      }
    }

    updateStatus();
    setInterval(updateStatus, 10000);
  </script>
</body>
</html>
    `);
});

// Avvia server web con error handling
let server;
try {
    server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server web attivo sulla porta ${PORT}`);
        console.log(`🌐 Status page: https://gg-shaderss.onrender.com`);
    });
} catch (error) {
    console.error('❌ Errore avvio server web:', error);
    console.log('⚠️ Server web non avviato, ma bot Discord funziona');
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
                console.log('⚠️ Interaction sconosciuta, ignorando......');
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
    // Gestione bottone per chiudere ticket
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
    // Gestione modal per chiusura ticket
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
  if (process.env.REGISTER_COMMANDS !== 'true' || isDeploying) {
    console.log('⏭️ Deploy SKIPPATO');
    return;
  }
  isDeploying = true;
  console.log('🚀 Inizio DEPLOY GLOBALE dei comandi...');
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    try {
      delete require.cache[require.resolve(`./commands/${file}`)];
      const command = require(`./commands/${file}`);
      if (command.data?.name) {
        commands.push(command.data.toJSON());
      }
    } catch (err) {
      console.error(`❌ Errore comando ${file}:`, err.message);
    }
  }
  if (commands.length === 0) {
    console.log('⚠️ Nessun comando da registrare');
    isDeploying = false;
    return;
  }
  console.log(`📦 ${commands.length} comandi caricati`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('🔄 Registrazione comandi GLOBALI...');
    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`✅ ${data.length} comandi registrati GLOBALMENTE!`);
    console.log(` → Disponibili in TUTTI i server (anche Server 2)`);
  } catch (error) {
    console.error('❌ ERRORE DEPLOY GLOBALE:');
    console.error(` → Codice: ${error.code}`);
    console.error(` → Messaggio: ${error.message}`);
    if (error.code === 50001) {
      console.error(` → Il bot NON ha 'applications.commands' in nessun server`);
      console.error(` → Vai su Developer Portal → OAuth2 → URL Generator → Aggiungi 'applications.commands'`);
    }
  }
  console.log('🎉 Deploy globale completato!');
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
    await detectPreviousCrash(client);
    await initializeStatusSystem(client);
    await updateBotStatus(client, 'online', 'Avvio completato');
   
    client.user.setActivity({
        name: `${client.guilds.cache.size} servers | /help`,
        type: 3 // WATCHING
    });
   
    setInterval(() => {
        updateStatusPeriodically(client);
    }, 5 * 60 * 1000);

    setInterval(() => {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
       
        console.log(`❤️ Keep-alive - Bot attivo da ${hours}h ${minutes}m`);
       
        client.user.setActivity({
            name: `${client.guilds.cache.size} servers | ${hours}h uptime`,
            type: 3 // WATCHING
        });
       
    }, 10 * 60 * 1000);
});

// Gestione shutdown graceful
async function gracefulShutdown(reason = 'Unknown') {
    console.log(`🔴 Arresto bot in corso... Motivo: ${reason}`);
   
    try {
        if (server) {
            server.close(() => {
                console.log('✅ Server web chiuso');
            });
        }
    } catch (error) {
        console.error('❌ Errore chiusura server web:', error);
    }
   
    try {
        await updateBotStatus(client, 'offline', `Arresto: ${reason}`);
    } catch (error) {
        console.error('❌ Errore aggiornamento status:', error);
    }
   
    try {
        if (client && !client.destroyed) {
            client.destroy();
            console.log('✅ Client Discord distrutto');
        }
    } catch (error) {
        console.error('❌ Errore distruzione client:', error);
    }
   
    setTimeout(() => {
        process.exit(0);
    }, 3000);
}

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
