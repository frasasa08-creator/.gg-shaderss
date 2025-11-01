// index.js - VERSIONE FINALE, PULITA, SENZA DUPLICATI, TUTTO FUNZIONANTE
const { initializeStatusSystem, detectPreviousCrash, updateBotStatus, updateStatusPeriodically } = require('./utils/statusUtils');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { cleanupOldTranscripts } = require('./utils/ticketUtils');
require('dotenv').config();
const db = require('./db');

// === CLIENT DISCORD ===
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
    ],
});

client.commands = new Collection();
client.cooldowns = new Collection();

// === PULIZIA TRANSCRIPT AUTOMATICA ===
async function startAutoCleanup() {
    try {
        console.log('Avvio pulizia automatica transcript...');
        await cleanupOldTranscripts(7);
        setInterval(() => cleanupOldTranscripts(7), 24 * 60 * 60 * 1000);
        console.log('Pulizia automatica configurata (ogni 24 ore)');
    } catch (err) {
        console.error('Errore cleanup:', err);
    }
}

// === ESTRAZIONE SERVER ID DAL NOME FILE ===
function extractServerIdFromFilename(filename) {
    const patterns = [
        /ticket-\w+-\w+-\d+-(\d{17,19})\.html$/,
        /-(\d{17,19})\.html$/,
        /^(\d{17,19})-.*\.html$/,
        /ticket-.*-(\d{17,19})\.html$/,
        /.*-(\d{17,19})\.html$/
    ];
    for (const p of patterns) {
        const m = filename.match(p);
        if (m) return m[1];
    }
    return null;
}

// === EXPRESS + WEBSOCKET ===
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, maxAge: 24*60*60*1000, sameSite: 'lax' },
    name: 'shaderss.sid',
    store: new session.MemoryStore(),
    rolling: true
}));

app.use(passport.initialize());
app.use(passport.session());

// Debug session
app.use((req, res, next) => {
    console.log('SESSION:', { path: req.path, auth: req.isAuthenticated(), user: req.user?.username });
    next();
});

// Passport
const getCallbackURL = () => process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/auth/discord/callback`
    : process.env.CALLBACK_URL || `http://localhost:${PORT}/auth/discord/callback`;

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: getCallbackURL(),
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// === MIDDLEWARE AUTENTICAZIONE ===
function requireAuth(req, res, next) {
    const publicRoutes = ['/auth/discord', '/auth/discord/callback', '/auth/failure', '/health', '/api/status', '/'];
    if (publicRoutes.includes(req.path)) return next();
    if (req.isAuthenticated()) return next();
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/discord');
}
app.use(requireAuth);

// === ROTTE AUTENTICAZIONE ===
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/auth/failure' }),
    (req, res) => res.redirect(req.session.returnTo || '/')
);
app.get('/auth/failure', (req, res) => res.send('<h1>Autenticazione fallita</h1><a href="/auth/discord">Riprova</a>'));
app.get('/logout', (req, res) => req.logout(() => req.session.destroy(() => res.redirect('/'))));

// === ROTTE PUBBLICHE ===
app.get('/health', (req, res) => res.json({ status: 'ok', bot: client.isReady() ? 'online' : 'offline' }));
app.get('/api/status', (req, res) => {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = Math.floor(uptime % 60);
    res.json({
        bot: { status: client.isReady() ? 'ONLINE' : 'OFFLINE', tag: client.user?.tag || 'Offline', uptime: `${h}h ${m}m ${s}s`, guilds: client.guilds.cache.size, ping: client.ws.ping || 'N/A' },
        server: { status: 'ONLINE' }
    });
});

// === WEBSOCKET PER CHAT LIVE ===
const wss = new WebSocketServer({ noServer: true });
const ticketClients = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.headers.origin + req.url);
    const ticketId = url.searchParams.get('ticketId');
    if (!ticketId) return ws.close();
    if (!ticketClients.has(ticketId)) ticketClients.set(ticketId, new Set());
    ticketClients.get(ticketId).add(ws);
    ws.on('close', () => {
        const clients = ticketClients.get(ticketId);
        if (clients) { clients.delete(ws); if (clients.size === 0) ticketClients.delete(ticketId); }
    });
});

function broadcastTicketMessage(ticketId, message) {
    const clients = ticketClients.get(ticketId);
    if (!clients) return;
    clients.forEach(ws => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'new_message', message })));
}

// === CHAT WEB IN TEMPO REALE ===
app.get('/ticket/:id', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.redirect('/auth/discord');
        const ticketId = req.params.id;
        const result = await db.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
        if (result.rows.length === 0) return res.send('<h1>Ticket non trovato</h1>');
        const ticket = result.rows[0];

        // Controllo permessi staff
        const settingsRes = await db.query('SELECT settings FROM guild_settings WHERE guild_id = $1', [ticket.guild_id]);
        const allowedRoles = settingsRes.rows[0]?.settings?.allowed_roles || [];
        const member = await client.guilds.cache.get(ticket.guild_id)?.members.fetch(req.user.id);
        const isStaff = member?.permissions.has('Administrator') || allowedRoles.some(id => member?.roles.cache.has(id));
        if (!isStaff) return res.status(403).send('<h1>Accesso negato</h1>');

        const html = `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Ticket #${ticket.id} - Chat</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #36393f; color: #dcddde; }
        .chat-container { max-width: 800px; margin: 20px auto; background: #2f3136; border-radius: 8px; overflow: hidden; box-shadow: 0 0 10px rgba(0,0,0,0.5); }
        .chat-header { padding: 15px; background: #292b2f; border-bottom: 1px solid #202225; }
        .chat-header h3 { margin: 0; font-size: 1.2rem; }
        .chat-header p { margin-top: 5px; font-size: 0.9rem; color: #b9bbbe; }
        .chat-messages { height: 60vh; overflow-y: auto; padding: 15px; }
        .message { margin-bottom: 15px; }
        .message-header { display: flex; justify-content: space-between; font-size: 0.8rem; color: #72767d; margin-bottom: 3px; }
        .message-content { word-wrap: break-word; }
        .chat-input { display: flex; padding: 15px; background: #40444b; gap: 10px; }
        #messageInput { flex: 1; padding: 10px; background: #36393f; border: none; border-radius: 5px; color: white; resize: none; }
        #sendBtn { padding: 0 15px; background: #5865f2; color: white; border: none; border-radius: 5px; cursor: pointer; }
        #sendBtn:hover { background: #4752c4; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h3>Ticket #${ticket.id} - ${ticket.ticket_type || 'N/A'}</h3>
            <p>Utente: <strong>${ticket.username}</strong></p>
        </div>
        <div id="messages" class="chat-messages"></div>
        <div class="chat-input">
            <textarea id="messageInput" placeholder="Scrivi un messaggio... (premi Invio)"></textarea>
            <button id="sendBtn">Invia</button>
        </div>
    </div>
    <script>
        const ticketId = '${ticket.id}';
        const ws = new WebSocket('ws://' + location.host + '/ws?ticketId=' + ticketId);
        const messagesDiv = document.getElementById('messages');
        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');

        fetch('/ticket/${ticketId}/messages').then(r => r.json()).then(msgs => msgs.forEach(addMessage));

        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'new_message') addMessage(data.message);
        };

        function addMessage(msg) {
            const div = document.createElement('div');
            div.className = 'message';
            const time = new Date(msg.created_at || msg.timestamp).toLocaleTimeString('it-IT');
            div.innerHTML =
                '<div class="message-header">' +
                    '<strong>' + escapeHtml(msg.username) + '</strong>' +
                    '<span class="timestamp">' + time + '</span>' +
                '</div>' +
                '<div class="message-content">' + escapeHtml(msg.content).replace(/\\*\\*/g, '') + '</div>';
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        async function sendMessage() {
            const text = input.value.trim();
            if (!text) return;
            await fetch('/ticket/${ticketId}/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });
            input.value = '';
        }

        sendBtn.onclick = sendMessage;
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    </script>
</body>
</html>`;
        res.send(html);
    } catch (err) {
        console.error('Errore pagina ticket:', err);
        res.status(500).send('Errore server');
    }
});

app.get('/ticket/:id/messages', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC', [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Errore' });
    }
});

app.post('/ticket/:id/send', async (req, res) => {
    try {
        const { message } = req.body;
        const ticketId = req.params.id;
        if (!req.isAuthenticated() || !message.trim()) return res.status(400).json({ error: 'Bad request' });
        const ticketRes = await db.query('SELECT channel_id FROM tickets WHERE id = $1', [ticketId]);
        if (ticketRes.rows.length === 0) return res.status(404).json({ error: 'Ticket non trovato' });
        const channel = client.channels.cache.get(ticketRes.rows[0].channel_id);
        if (!channel) return res.status(410).json({ error: 'Canale non trovato' });
        const formatted = "**[STAFF]: " + message.trim() + "**";
        await channel.send(formatted);
        const staffUser = await client.users.fetch(req.user.id);
        await db.query(
            'INSERT INTO ticket_messages (ticket_id, user_id, username, content) VALUES ($1, $2, $3, $4)',
            [ticketId, req.user.id, staffUser.tag, formatted]
        );
        broadcastTicketMessage(ticketId, {
            username: staffUser.tag,
            content: formatted,
            timestamp: new Date().toISOString()
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Errore invio:', err);
        res.status(500).json({ error: 'Errore invio' });
    }
});

// === TRANSCRIPT & STAFF AREA ===

// Middleware per verificare permessi staff
async function checkStaffRole(req, res, next) {
    if (!req.isAuthenticated()) return res.redirect('/auth/discord');
    try {
        if (process.env.BOT_OWNER_ID && req.user.id === process.env.BOT_OWNER_ID) return next();
        const userGuilds = req.user.guilds || [];
        for (const guild of userGuilds) {
            const result = await db.query('SELECT settings FROM guild_settings WHERE guild_id = $1', [guild.id]);
            if (result.rows.length > 0) {
                const settings = result.rows[0].settings || {};
                const allowedRoles = settings.allowed_roles || [];
                const userRoles = guild.roles || [];
                const hasAllowedRole = userRoles.some(id => allowedRoles.includes(id));
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                if (hasAllowedRole || isAdmin) return next();
            } else {
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                if (isAdmin) return next();
            }
        }
        return res.status(403).send(`
            <!DOCTYPE html><html><head><title>Accesso Negato</title><style>
                body { background: #1e1f23; color: #ed4245; font-family: sans-serif; text-align: center; padding: 100px; }
                .btn { display: inline-block; background: #5865F2; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; margin: 10px; }
            </style></head><body>
                <h1>Accesso Negato</h1>
                <p>Devi avere un ruolo consentito o essere admin.</p>
                <a href="/" class="btn">Torna alla Home</a>
                <a href="/logout" class="btn">Logout</a>
            </body></html>
        `);
    } catch (err) {
        console.error('Errore permessi:', err);
        res.status(500).send('Errore interno');
    }
}

// Seleziona server
app.get('/transcripts', checkStaffRole, async (req, res) => {
    try {
        const userGuilds = req.user.guilds || [];
        const accessibleGuilds = [];
        for (const guild of userGuilds) {
            const botGuild = client.guilds.cache.get(guild.id);
            if (!botGuild) continue;
            const result = await db.query('SELECT settings FROM guild_settings WHERE guild_id = $1', [guild.id]);
            let hasAccess = false;
            if (result.rows.length > 0) {
                const settings = result.rows[0].settings || {};
                const allowedRoles = settings.allowed_roles || [];
                const userRoles = guild.roles || [];
                const hasAllowedRole = userRoles.some(id => allowedRoles.includes(id));
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                hasAccess = hasAllowedRole || isAdmin;
            } else {
                hasAccess = (guild.permissions & 0x8) === 0x8;
            }
            if (hasAccess) {
                accessibleGuilds.push({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null
                });
            }
        }
        if (accessibleGuilds.length === 0) {
            return res.status(403).send('<h1>Nessun server accessibile</h1>');
        }
        const options = accessibleGuilds.map(g => `
            <div onclick="location.href='/transcripts/${g.id}'" style="cursor:pointer; padding:15px; background:#2f3136; margin:10px; border-radius:8px;">
                ${g.icon ? `<img src="${g.icon}" width="40" style="border-radius:50%; vertical-align:middle;">` : ''}
                <strong>${g.name}</strong>
            </div>
        `).join('');
        res.send(`<!DOCTYPE html><html><head><title>Seleziona Server</title></head><body style="background:#36393f; color:white; padding:20px;">
            <h1>Seleziona Server</h1>${options}<a href="/">Torna alla Home</a>
        </body></html>`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore');
    }
});

// Gestione ticket per server
app.get('/transcripts/:guildId', checkStaffRole, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const botGuild = client.guilds.cache.get(guildId);
        if (!botGuild) return res.status(404).send('Bot non nel server');
        const closedTickets = await db.query('SELECT * FROM tickets WHERE guild_id = $1 AND status = $2 ORDER BY closed_at DESC LIMIT 50', [guildId, 'closed']);
        const openTickets = await db.query('SELECT * FROM tickets WHERE guild_id = $1 AND status = $2', [guildId, 'open']);
        const transcriptDir = path.join(__dirname, 'transcripts');
        let availableTranscripts = [];
        if (fs.existsSync(transcriptDir)) {
            availableTranscripts = fs.readdirSync(transcriptDir)
                .filter(f => f.endsWith('.html') && extractServerIdFromFilename(f) === guildId)
                .map(f => ({ name: f, date: fs.statSync(path.join(transcriptDir, f)).mtime.toLocaleString() }))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
        }
        const html = `<!DOCTYPE html><html><head><title>${botGuild.name}</title></head><body style="background:#36393f; color:white;">
            <h1>${botGuild.name}</h1>
            <h2>Ticket Aperti: ${openTickets.rows.length}</h2>
            <h2>Ticket Chiusi: ${closedTickets.rows.length}</h2>
            <h2>Transcript: ${availableTranscripts.length}</h2>
            <div>${availableTranscripts.map(t => `<a href="/transcript/${t.name}" target="_blank">${t.name}</a><br>`).join('')}</div>
            <a href="/transcripts">Indietro</a>
        </body></html>`;
        res.send(html);
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore');
    }
});

// Visualizza transcript
app.get('/transcript/:identifier', (req, res) => {
    const identifier = req.params.identifier;
    const transcriptDir = path.join(__dirname, 'transcripts');
    const exactPath = path.join(transcriptDir, `${identifier}.html`);
    if (fs.existsSync(exactPath)) return res.sendFile(exactPath);
    const files = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.html'));
    const match = files.find(f => f.toLowerCase().includes(identifier.toLowerCase()));
    if (match) return res.sendFile(path.join(transcriptDir, match));
    res.status(404).send('<h1>Transcript non trovato</h1>');
});

// Elimina transcript
app.delete('/transcript/:filename', checkStaffRole, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'transcripts', `${filename}.html`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false });
    }
});

// === AVVIO SERVER ===
const server = app.listen(PORT, () => {
    console.log(`Server web su http://localhost:${PORT}`);
    const transcriptDir = path.join(__dirname, 'transcripts');
    if (!fs.existsSync(transcriptDir)) fs.mkdirSync(transcriptDir, { recursive: true });
});

server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

// === CARICAMENTO COMANDI ED EVENTI ===
fs.readdirSync('./commands').filter(f => f.endsWith('.js')).forEach(file => {
    const cmd = require(`./commands/${file}`);
    if (cmd.data && cmd.execute) client.commands.set(cmd.data.name, cmd);
});

fs.readdirSync('./events').filter(f => f.endsWith('.js')).forEach(file => {
    const event = require(`./events/${file}`);
    event.once ? client.once(event.name, (...args) => event.execute(...args))
               : client.on(event.name, (...args) => event.execute(...args));
});

// === INTERAZIONI ===
client.on('interactionCreate', async i => {
    if (i.isCommand()) {
        const cmd = client.commands.get(i.commandName);
        if (cmd) await cmd.execute(i).catch(console.error);
    }
    if (i.isStringSelectMenu() && i.customId === 'ticket_select') {
        const { createTicket } = require('./utils/ticketUtils');
        await createTicket(i, i.values[0]);
    }
    if (i.isButton() && i.customId === 'close_ticket') {
        const { showCloseTicketModal } = require('./utils/ticketUtils');
        await showCloseTicketModal(i);
    }
    if (i.isModalSubmit() && i.customId === 'close_ticket_modal') {
        const { closeTicketWithReason } = require('./utils/ticketUtils');
        await closeTicketWithReason(i);
    }
});

// === DATABASE ===
async function initDB() {
    await db.query(`CREATE TABLE IF NOT EXISTS guild_settings (guild_id VARCHAR(20) PRIMARY KEY, settings JSONB DEFAULT '{}')`);
    await db.query(`CREATE TABLE IF NOT EXISTS tickets (id SERIAL PRIMARY KEY, guild_id VARCHAR(20), user_id VARCHAR(20), channel_id VARCHAR(20), ticket_type VARCHAR(100), status VARCHAR(20) DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, closed_at TIMESTAMP, close_reason TEXT)`);
    await db.query(`CREATE TABLE IF NOT EXISTS ticket_messages (id SERIAL PRIMARY KEY, ticket_id INTEGER, user_id VARCHAR(20), username VARCHAR(100), content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    console.log('Database pronto');
}

// === AVVIO BOT ===
client.once('ready', async () => {
    console.log(`Bot online: ${client.user.tag}`);
    await initDB();
    await startAutoCleanup();
    client.user.setActivity(`${client.guilds.cache.size} server | /help`, { type: 3 });
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Login fallito:', err);
    process.exit(1);
});

module.exports = { client, db };
