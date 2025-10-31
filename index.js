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

// ROTTA TRANSCRIPT ONLINE
app.get('/transcript/:identifier', (req, res) => {
    const identifier = req.params.identifier.toLowerCase();
    const transcriptDir = path.join(__dirname, 'transcripts');
    const filePath = path.join(transcriptDir, `${identifier}.html`);

    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'text/html');
        return res.sendFile(filePath);
    }

    res.status(404).send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript non trovato</title>
    <style>
        body { background: #1e1f23; color: #fff; font-family: 'Segoe UI', sans-serif; text-align: center; padding: 50px; }
        h1 { color: #ed4245; }
        p { font-size: 1.2em; }
        .discord { color: #5865F2; }
    </style>
</head>
<body>
    <h1>Transcript non trovato</h1>
    <p>Il ticket <span class="discord">#${identifier}</span> non esiste o è stato eliminato.</p>
    <p>Torna tra 7 giorni? No, è già andato.</p>
</body>
</html>
    `);
});

// === PROTEZIONE STAFF PER /transcripts ===
app.get('/transcripts', (req, res) => {
    const token = req.query.token;
    if (!token || token !== process.env.STAFF_TOKEN) {
        return res.status(403).send(`
<!DOCTYPE html>
<html><head><title>Accesso Negato</title>
<style>body{background:#1e1f23;color:#ed4245;font-family:sans-serif;text-align:center;padding:100px;}
h1{font-size:3em;}</style></head>
<body><h1>Accesso Negato</h1><p>Solo lo staff può accedere.</p></body></html>
        `);
    }

    // === LISTA TRANSCRIPT (PROTETTA) ===
    const transcriptDir = path.join(__dirname, 'transcripts');
    let list = '';

    if (fs.existsSync(transcriptDir)) {
        const files = fs.readdirSync(transcriptDir)
            .filter(f => f.endsWith('.html') && f !== '.gitkeep')
            .sort((a, b) => fs.statSync(path.join(transcriptDir, b)).mtime - fs.statSync(path.join(transcriptDir, a)).mtime);

        list = files.length > 0 ? `
            <h2>Transcript Archiviati (${files.length})</h2>
            <ul>
                ${files.map(file => {
                    const name = file.replace('.html', '');
                    const date = new Date(fs.statSync(path.join(transcriptDir, file)).mtime).toLocaleString('it-IT');
                    return `<li><a href="/transcript/${name}" target="_blank">#${name}</a> <small>${date}</small></li>`;
                }).join('')}
            </ul>
        ` : '<p>Nessun transcript trovato.</p>';
    } else {
        list = '<p>Cartella non trovata.</p>';
    }

    res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - Staff Only</title>
    <style>
        body { margin:0; background:#0f0f12; color:#fff; font-family:'Inter',sans-serif; padding:40px; }
        .container { max-width:800px; margin:auto; background:#1a1a1d; border-radius:16px; padding:30px; }
        h1 { color:#5865F2; text-align:center; }
        ul { list-style:none; padding:0; }
        li { padding:12px; background:#2f3136; margin:8px 0; border-radius:8px; }
        a { color:#00b0f4; text-decoration:none; font-weight:600; }
        a:hover { text-decoration:underline; }
        small { float:right; color:#72767d; }
        .back { text-align:center; margin-top:30px; }
        .back a { color:#5865F2; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Transcript (Staff)</h1>
        ${list}
        <div class="back">
            <a href="/">← Home</a>
        </div>
    </div>
</body>
</html>
    `);
});

// LISTA COMPLETA TRANSCRIPT
app.get('/transcripts', (req, res) => {
    const transcriptDir = path.join(__dirname, 'transcripts');
    let list = '';

    if (fs.existsSync(transcriptDir)) {
        const files = fs.readdirSync(transcriptDir)
            .filter(f => f.endsWith('.html') && f !== '.gitkeep')
            .sort((a, b) => fs.statSync(path.join(transcriptDir, b)).mtime - fs.statSync(path.join(transcriptDir, a)).mtime);

        list = files.length > 0 ? `
            <h2>Tutti i Transcript (${files.length})</h2>
            <ul>
                ${files.map(file => {
                    const name = file.replace('.html', '');
                    const date = new Date(fs.statSync(path.join(transcriptDir, file)).mtime).toLocaleString('it-IT');
                    return `<li><a href="/transcript/${name}" target="_blank">#${name}</a> <small>${date}</small></li>`;
                }).join('')}
            </ul>
        ` : '<p>Nessun transcript trovato.</p>';
    } else {
        list = '<p>Cartella transcript non trovata.</p>';
    }

    res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tutti i Transcript</title>
    <style>
        body { margin:0; background:#0f0f12; color:#fff; font-family:'Inter',sans-serif; padding:40px; }
        .container { max-width:800px; margin:auto; background:#1a1a1d; border-radius:16px; padding:30px; }
        h1 { color:#5865F2; text-align:center; }
        ul { list-style:none; padding:0; }
        li { padding:12px; background:#2f3136; margin:8px 0; border-radius:8px; }
        a { color:#00b0f4; text-decoration:none; font-weight:600; }
        a:hover { text-decoration:underline; }
        small { float:right; color:#72767d; }
        .back { text-align:center; margin-top:30px; }
        .back a { color:#5865F2; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Transcript Archiviati</h1>
        ${list}
        <div class="back">
            <a href="/">← Torna alla home</a>
        </div>
    </div>
</body>
</html>
    `);
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

// HOMEPAGE MODERNA CON DESIGN AGGIORNATO
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>.gg/shaderss • Discord Bot</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --primary: #5865F2;
            --primary-dark: #4752c4;
            --success: #00ff88;
            --error: #ed4245;
            --warning: #faa81a;
            --background: #0f0f12;
            --card-bg: #1a1a1d;
            --card-hover: #232327;
            --text-primary: #ffffff;
            --text-secondary: #b9bbbe;
            --text-muted: #72767d;
            --border: #2f3136;
            --border-light: #40444b;
        }

        body {
            background: var(--background);
            color: var(--text-primary);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.6;
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        /* Header */
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 40px 20px;
            background: linear-gradient(135deg, var(--card-bg) 0%, #1e1e22 100%);
            border-radius: 20px;
            border: 1px solid var(--border);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .logo {
            font-size: 3.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, var(--primary) 0%, #9b59b6 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 10px;
        }

        .tagline {
            font-size: 1.2rem;
            color: var(--text-secondary);
            margin-bottom: 25px;
            font-weight: 500;
        }

        .btn-group {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 12px 24px;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
            font-size: 0.95rem;
        }

        .btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(88, 101, 242, 0.3);
        }

        .btn-secondary {
            background: var(--border);
            color: var(--text-primary);
        }

        .btn-secondary:hover {
            background: var(--border-light);
            transform: translateY(-2px);
        }

        /* Main Grid */
        .main-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
        }

        /* Cards */
        .card {
            background: var(--card-bg);
            border-radius: 16px;
            padding: 25px;
            border: 1px solid var(--border);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
            border-color: var(--primary);
        }

        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--primary), var(--success));
        }

        .card h2 {
            font-size: 1.4rem;
            margin-bottom: 20px;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .card h2 i {
            color: var(--primary);
        }

        /* Status Items */
        .status-item {
            display: flex;
            justify-content: between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid var(--border-light);
        }

        .status-item:last-child {
            border-bottom: none;
        }

        .status-label {
            color: var(--text-secondary);
            font-weight: 500;
            flex: 1;
        }

        .status-value {
            font-weight: 600;
            font-family: 'Monaco', 'Consolas', monospace;
        }

        .status-online {
            color: var(--success);
        }

        .status-offline {
            color: var(--error);
        }

        .status-loading {
            color: var(--warning);
        }

        /* Widget Container */
        .widget-container {
            border-radius: 12px;
            overflow: hidden;
            background: var(--border);
            margin-top: 15px;
        }

        .widget-container iframe {
            display: block;
            border: none;
        }

        /* Members List */
        .members-list {
            max-height: 300px;
            overflow-y: auto;
            margin-top: 15px;
        }

        .member {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px;
            border-radius: 8px;
            transition: background 0.2s ease;
        }

        .member:hover {
            background: var(--border);
        }

        .member-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 0.9rem;
        }

        .member-info {
            flex: 1;
        }

        .member-name {
            font-weight: 600;
            color: var(--text-primary);
        }

        .member-status {
            font-size: 0.85rem;
            color: var(--text-muted);
        }

        /* Footer */
        .footer {
            text-align: center;
            margin-top: 50px;
            padding: 30px;
            color: var(--text-muted);
            border-top: 1px solid var(--border);
        }

        .powered-by {
            font-size: 0.9rem;
        }

        .powered-by strong {
            color: var(--text-secondary);
        }

        /* Loading Animation */
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .loading {
            animation: pulse 1.5s infinite;
            color: var(--warning);
        }

        /* Responsive */
        @media (max-width: 768px) {
            .main-grid {
                grid-template-columns: 1fr;
            }
            
            .header {
                padding: 30px 15px;
            }
            
            .logo {
                font-size: 2.5rem;
            }
            
            .btn-group {
                flex-direction: column;
                align-items: center;
            }
            
            .btn {
                width: 200px;
                justify-content: center;
            }
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 8px;
        }

        ::-webkit-scrollbar-track {
            background: var(--border);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--primary);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--primary-dark);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header class="header">
            <h1 class="logo">.gg/shaderss</h1>
            <p class="tagline">Discord Bot • 24/7 • Advanced Features</p>
            <div class="btn-group">
                <a href="https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID || 'IL_TUO_CLIENT_ID'}&scope=bot+applications.commands&permissions=8" class="btn">
                    <i class="fas fa-robot"></i>Invita Bot
                </a>
                <a href="/transcripts" class="btn btn-secondary">
                    <i class="fas fa-file-alt"></i>Tutti i Transcript
                </a>
            </div>
        </header>

        <!-- Main Grid -->
        <div class="main-grid">
            <!-- Status Card -->
            <div class="card">
                <h2><i class="fas fa-heart-pulse"></i> Bot Status</h2>
                <div class="status-item">
                    <span class="status-label">Stato</span>
                    <span class="status-value status-online" id="statusText">ONLINE</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Tag</span>
                    <span class="status-value" id="tag">-</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Server</span>
                    <span class="status-value" id="guilds">-</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Ping</span>
                    <span class="status-value" id="ping">- ms</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Uptime</span>
                    <span class="status-value" id="uptime">-</span>
                </div>
            </div>

            <!-- Discord Widget Card -->
            <div class="card">
                <h2><i class="fab fa-discord"></i> Server Live</h2>
                <p style="color: var(--text-secondary); margin-bottom: 15px; font-size: 0.95rem;">
                    Unisciti alla nostra community Discord
                </p>
                <div class="widget-container">
                    <iframe src="https://discord.com/widget?id=1431629401384026234&theme=dark" 
                            width="100%" height="350" allowtransparency="true" frameborder="0"
                            sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts">
                    </iframe>
                </div>
            </div>
        </div>

        <!-- Additional Info Card -->
        <div class="card">
            <h2><i class="fas fa-star"></i> Caratteristiche</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
                <div style="text-align: center; padding: 15px; background: var(--border); border-radius: 8px;">
                    <i class="fas fa-ticket-alt" style="color: var(--primary); font-size: 1.5rem; margin-bottom: 8px;"></i>
                    <div style="font-weight: 600;">Sistema Ticket</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Supporto avanzato</div>
                </div>
                <div style="text-align: center; padding: 15px; background: var(--border); border-radius: 8px;">
                    <i class="fas fa-shield-alt" style="color: var(--success); font-size: 1.5rem; margin-bottom: 8px;"></i>
                    <div style="font-weight: 600;">Moderazione</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Tools completi</div>
                </div>
                <div style="text-align: center; padding: 15px; background: var(--border); border-radius: 8px;">
                    <i class="fas fa-bolt" style="color: var(--warning); font-size: 1.5rem; margin-bottom: 8px;"></i>
                    <div style="font-weight: 600;">24/7 Uptime</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Sempre online</div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <footer class="footer">
            <p class="powered-by">Powered by <strong>sasa111</strong></p>
        </footer>
    </div>

    <script>
        async function updateStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                
                if (data.bot.status === 'ONLINE') {
                    document.getElementById('statusText').className = 'status-value status-online';
                    document.getElementById('statusText').textContent = 'ONLINE';
                } else {
                    document.getElementById('statusText').className = 'status-value status-offline';
                    document.getElementById('statusText').textContent = 'OFFLINE';
                }
                
                document.getElementById('tag').textContent = data.bot.tag.split('#')[0] || '-';
                document.getElementById('guilds').textContent = data.bot.guilds || '-';
                document.getElementById('ping').textContent = data.bot.ping + ' ms' || '- ms';
                document.getElementById('uptime').textContent = data.bot.uptime || '-';
                
            } catch(e) {
                console.error('Errore aggiornamento status:', e);
                document.getElementById('statusText').className = 'status-value status-offline';
                document.getElementById('statusText').textContent = 'OFFLINE';
            }
        }

        // Aggiorna immediatamente e poi ogni 10 secondi
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

// Endpoint API per stato bot (usato dalla pagina)
app.get('/api/status', (req, res) => {
    try {
        const botUptime = process.uptime();
        const hours = Math.floor(botUptime / 3600);
        const minutes = Math.floor((botUptime % 3600) / 60);
        const seconds = Math.floor(botUptime % 60);

        let botStatus = 0;
        let statusText = 'OFFLINE';

        if (client && client.isReady()) {
            botStatus = 1;
            statusText = 'ONLINE';
        } else if (client) {
            botStatus = 2;
            statusText = 'CONNECTING';
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
                status: 'ONLINE',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                ping: 'N/A',
                guilds: 0,
                tags: 'ticket, support, advanced'
            }
        });
    } catch (error) {
        console.error('Errore in /api/status:', error);
        res.json({
            bot: {
                status: 'OFFLINE',
                statusCode: 0,
                tag: 'Errore di connessione',
                uptime: '0h 0m 0s',
                guilds: 0,
                ping: 'N/A',
                lastUpdate: new Date().toISOString()
            },
            server: {
                status: 'ONLINE',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                ping: 'N/A',
                guilds: 0,
                tags: 'ticket, support, advanced'
            }
        });
    }
});

console.log('File index.js caricato completamente');
