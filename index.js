// index.js
const { initializeStatusSystem, detectPreviousCrash, updateBotStatus, updateStatusPeriodically } = require('./utils/statusUtils');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const { cleanupOldTranscripts } = require('./utils/ticketUtils');
require('dotenv').config();
const db = require('./db');

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

// Avvia pulizia automatica all'avvio e ogni 24 ore
async function startAutoCleanup() {
    try {
        console.log('🧹 Avvio pulizia automatica transcript...');
        await cleanupOldTranscripts(7);
        
        // Esegui pulizia ogni 24 ore
        setInterval(async () => {
            console.log('🔄 Esecuzione pulizia automatica giornaliera...');
            await cleanupOldTranscripts(7);
        }, 24 * 60 * 60 * 1000); // 24 ore
        
        console.log('✅ Pulizia automatica configurata (ogni 24 ore)');
    } catch (error) {
        console.error('❌ Errore avvio pulizia automatica:', error);
    }
}


// === FUNZIONE MIGLIORATA PER ESTRARRE SERVER ID DAL NOME FILE ===
function extractServerIdFromFilename(filename) {
    console.log(`🔍 Analizzo file: ${filename}`);
    
    // Pattern per il formato standard: ticket-{tipo}-{username}-{timestamp}-{serverId}.html
    const standardPattern = /ticket-\w+-\w+-\d+-(\d{17,19})\.html$/;
    
    // Pattern per altri formati comuni
    const patterns = [
        standardPattern,
        /-(\d{17,19})\.html$/,
        /^(\d{17,19})-.*\.html$/,
        /ticket-.*-(\d{17,19})\.html$/,
        /.*-(\d{17,19})\.html$/
    ];
    
    for (const pattern of patterns) {
        const match = filename.match(pattern);
        if (match && match[1]) {
            console.log(`✅ Server ID trovato: ${match[1]}`);
            return match[1];
        }
    }
    
    console.log(`❌ Nessun Server ID trovato in: ${filename}`);
    return null;
}

// === SERVER EXPRESS PER RENDER ===
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// === MIDDLEWARE IN ORDINE CORRETTO ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// TRUST PROXY CRITICO per Render
app.set('trust proxy', 1);

// Session middleware - CONFIGURAZIONE DEFINITIVA per Render
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true, // FORZA HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 ore
        sameSite: 'lax',
        // RIMUOVI domain per permettere a Render di gestirlo
    },
    name: 'shaderss.sid', // Nome più semplice
    store: new session.MemoryStore(),
    rolling: true
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// DEBUG MIGLIORATO
app.use((req, res, next) => {
    console.log('🔍 SESSION DEBUG:', {
        path: req.path,
        authenticated: req.isAuthenticated(),
        user: req.user?.username || 'Nessuno',
        sessionId: req.sessionID,
        cookies: req.headers.cookie ? 'Presenti' : 'Assenti',
        'user-agent': req.headers['user-agent']
    });
    next();
});

// DEBUG: Verifica configurazione
console.log('🔧 DEBUG Configurazione Session:');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? 'Presente' : 'MISSING!');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Cookie secure:', true);
console.log('Trust proxy:', 1);

// Configurazione Passport con URL dinamico
const getCallbackURL = () => {
    let callbackURL;
    
    if (process.env.RENDER_EXTERNAL_URL) {
        callbackURL = `${process.env.RENDER_EXTERNAL_URL}/auth/discord/callback`;
    } else if (process.env.CALLBACK_URL) {
        callbackURL = process.env.CALLBACK_URL;
    } else {
        callbackURL = `http://localhost:${PORT}/auth/discord/callback`;
    }
    
    console.log('🌐 Callback URL generato:', callbackURL);
    return callbackURL;
};

// Configurazione DiscordStrategy
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: getCallbackURL(),
    scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('🔑 Utente autenticato con successo:', profile.username);
        console.log('📋 Dati profile:', {
            id: profile.id,
            username: profile.username,
            discriminator: profile.discriminator,
            guilds: profile.guilds ? profile.guilds.length : 0
        });
        
        return done(null, profile);
    } catch (error) {
        console.error('❌ Errore durante autenticazione:', error);
        return done(error, null);
    }
}));

// Serializzazione e deserializzazione
passport.serializeUser((user, done) => {
    console.log('💾 Serializzazione utente:', user.username);
    done(null, user);
});

passport.deserializeUser((user, done) => {
    console.log('📖 Deserializzazione utente:', user.username);
    done(null, user);
});

// === MIDDLEWARE DI AUTENTICAZIONE GLOBALE ===
function requireAuth(req, res, next) {
    const publicRoutes = ['/auth/discord', '/auth/discord/callback', '/auth/failure', '/health', '/api/status', '/'];
    
    if (publicRoutes.includes(req.path)) {
        return next();
    }
    
    if (req.isAuthenticated()) {
        console.log('✅ Utente autenticato:', req.user.username);
        return next();
    }
    
    console.log('❌ Utente NON autenticato, redirect a login');
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/discord');
}

// Applica il middleware a TUTTE le rotte
app.use(requireAuth);

// === ROTTE DI AUTENTICAZIONE ===
app.get('/auth/discord', (req, res, next) => {
    console.log('🚀 Inizio autenticazione OAuth per:', req.user?.username || 'Utente non loggato');
    passport.authenticate('discord')(req, res, next);
});

app.get('/auth/discord/callback',
    (req, res, next) => {
        console.log('🔄 Callback OAuth ricevuto');
        console.log('📊 Session ID:', req.sessionID);
        console.log('👤 Utente prima auth:', req.user?.username || 'Nessuno');
        
        passport.authenticate('discord', { 
            failureRedirect: '/auth/failure',
            failureMessage: true
        })(req, res, next);
    },
    (req, res) => {
        console.log('✅ Autenticazione completata per:', req.user.username);
        console.log('📋 Session dopo auth:', req.sessionID);
        console.log('👤 User dopo auth:', req.user.username);
        
        const returnTo = req.session.returnTo || '/';
        delete req.session.returnTo;
        
        console.log('🔀 Redirect a:', returnTo);
        res.redirect(returnTo);
    }
);

// Middleware per debugging session
app.use((req, res, next) => {
    console.log('🔍 Debug Session - Path:', req.path);
    console.log('🔍 Debug Session - Authenticated:', req.isAuthenticated());
    console.log('🔍 Debug Session - User:', req.user?.username || 'Nessuno');
    console.log('🔍 Debug Session - Session ID:', req.sessionID);
    next();
});

// Middleware per gestire errori
app.use((err, req, res, next) => {
    console.error('❌ Errore server:', err);
    res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Errore Interno</title>
            <style>
                body { background: #1e1f23; color: #ed4245; font-family: sans-serif; text-align: center; padding: 100px; }
                .btn { display: inline-block; background: #5865F2; color: white; padding: 10px 20px; 
                       border-radius: 8px; text-decoration: none; margin: 10px; }
                .error-details { background: #2f3136; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
            </style>
        </head>
        <body>
            <h1>❌ Errore Interno del Server</h1>
            <p>Si è verificato un errore durante l'autenticazione.</p>
            
            <div class="error-details">
                <strong>Dettagli errore:</strong><br>
                ${err.message || 'Errore sconosciuto'}
            </div>
            
            <a href="/auth/discord" class="btn">Riprova Login</a>
            <a href="/" class="btn">Torna alla Home</a>
        </body>
        </html>
    `);
});

app.get('/auth/failure', (req, res) => {
    console.log('❌ Autenticazione fallita');
    const error = req.query.error || 'Errore sconosciuto';
    const errorDescription = req.query.error_description || 'Nessuna descrizione';
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Autenticazione Fallita</title>
            <style>
                body { background: #1e1f23; color: #ed4245; font-family: sans-serif; text-align: center; padding: 100px; }
                .btn { display: inline-block; background: #5865F2; color: white; padding: 10px 20px; 
                       border-radius: 8px; text-decoration: none; margin: 10px; }
                .error-details { background: #2f3136; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
            </style>
        </head>
        <body>
            <h1>❌ Autenticazione Fallita</h1>
            <p>Impossibile accedere con Discord.</p>
            
            <div class="error-details">
                <strong>Dettagli errore:</strong><br>
                Codice: ${error}<br>
                Descrizione: ${errorDescription}
            </div>
            
            <a href="/auth/discord" class="btn">Riprova Login</a>
            <a href="/" class="btn">Torna alla Home</a>
        </body>
        </html>
    `);
});

app.get('/logout', (req, res) => {
    console.log('🚪 Logout utente:', req.user?.username);
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destroy error:', err);
            }
            res.redirect('/');
        });
    });
});

// === ROTTE PUBBLICHE ===
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

app.post('/api/ticket/send-message', async (req, res) => {
    try {
        const { ticketId, message } = req.body;
        const username = req.user.username;

        console.log(`📨 Invio messaggio per ticket ${ticketId} da ${username}`);

        // 1. Cerca il ticket (usa la tua tabella tickets esistente)
        const ticketResult = await db.query(
            'SELECT * FROM tickets WHERE channel_id = $1 OR id::text = $1',
            [ticketId]
        );
        
        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket non trovato' });
        }

        const ticket = ticketResult.rows[0];

        // 2. Salva il messaggio nella NUOVA tabella messages
        await db.query(
            'INSERT INTO messages (ticket_id, username, content) VALUES ($1, $2, $3)',
            [ticketId, username, message]
        );

        // 3. Invia su Discord
        const channel = client.channels.cache.get(ticket.channel_id);
        if (channel) {
            const discordMessage = `<:discotoolsxyzicon18:1434231459702509758> **[STAFF]** : ${message}`;
            await channel.send(discordMessage);
            console.log('✅ Messaggio inviato su Discord');
        }

        res.json({ success: true });

    } catch (error) {
        console.error('❌ Errore invio messaggio:', error);
        res.status(500).json({ error: 'Errore interno' });
    }
});

/*app.get('/api/ticket/:ticketId/messages', async (req, res) => {
    try {
        const { ticketId } = req.params;
        
        const result = await db.query(
            'SELECT * FROM messages WHERE ticket_id = $1 ORDER BY timestamp',
            [ticketId]
        );
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Errore recupero messaggi:', error);
        res.status(500).json({ error: 'Errore interno' });
    }
});

app.get('/transcripts/:ticketId', async (req, res) => {
    try {
        const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
        if (!ticket) {
            return res.status(404).send('Ticket non trovato');
        }

        // Verifica permessi utente
        const hasAccess = await checkUserAccess(req.user, ticket.guildId);
        if (!hasAccess) {
            return res.status(403).send('Accesso negato');
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Chat Ticket ${ticket.ticketId}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    #ticket-chat {
                        border: 1px solid #ccc;
                        border-radius: 8px;
                        padding: 15px;
                        max-width: 800px;
                        margin: 20px auto;
                    }
                    #chat-messages {
                        height: 500px;
                        overflow-y: auto;
                        border: 1px solid #eee;
                        padding: 15px;
                        margin-bottom: 15px;
                        background: #f9f9f9;
                    }
                    .message {
                        margin-bottom: 15px;
                        padding: 10px;
                        border-radius: 8px;
                        background: white;
                        border-left: 4px solid #5865F2;
                    }
                    .message strong {
                        color: #5865F2;
                    }
                    .message small {
                        color: #666;
                        margin-left: 10px;
                    }
                    #chat-input {
                        display: flex;
                        gap: 10px;
                    }
                    #message-input {
                        flex: 1;
                        padding: 12px;
                        border: 1px solid #ccc;
                        border-radius: 8px;
                        font-size: 16px;
                    }
                    button {
                        padding: 12px 20px;
                        background: #5865F2;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 16px;
                    }
                </style>
            </head>
            <body>
                <h1>Chat Ticket: ${ticket.ticketId}</h1>
                <div id="ticket-chat">
                    <div id="chat-messages"></div>
                    <div id="chat-input">
                        <input type="text" id="message-input" placeholder="Scrivi un messaggio...">
                        <button onclick="sendMessage()">Invia</button>
                    </div>
                </div>

                <script>
                    const currentTicketId = '${ticket.ticketId}';
                    let chatInterval = null;

                    async function loadMessages() {
                        try {
                            // ✅ CORRETTO - CONCATENAZIONE DI STRINGHE
                            const response = await fetch('/api/ticket/' + currentTicketId + '/messages');
                            const messages = await response.json();
                            displayMessages(messages);
                        } catch (error) {
                            console.error('Errore caricamento messaggi:', error);
                        }
                    }

                    function displayMessages(messages) {
                        const chatContainer = document.getElementById('chat-messages');
                        chatContainer.innerHTML = '';
                        
                        messages.forEach(msg => {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message';
                            messageDiv.innerHTML = '<strong>' + msg.user + ':</strong> ' + msg.content + '<small>' + new Date(msg.timestamp).toLocaleString() + '</small>';
                            chatContainer.appendChild(messageDiv);
                        });
                        
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    async function sendMessage() {
                        const input = document.getElementById('message-input');
                        const message = input.value.trim();
                        
                        if (!message) return;
                        
                        try {
                            const response = await fetch('/api/ticket/send-message', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    ticketId: currentTicketId,
                                    message: message
                                })
                            });
                            
                            if (response.ok) {
                                input.value = '';
                                loadMessages();
                            } else {
                                alert('Errore invio messaggio');
                            }
                        } catch (error) {
                            console.error('Errore invio messaggio:', error);
                            alert('Errore di connessione');
                        }
                    }

                    function startChatUpdates() {
                        loadMessages();
                        chatInterval = setInterval(loadMessages, 3000);
                    }

                    document.getElementById('message-input').addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    document.addEventListener('DOMContentLoaded', function() {
                        startChatUpdates();
                    });
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Errore caricamento transcript:', error);
        res.status(500).send('Errore interno del server');
    }
});

// API per ottenere i messaggi di un ticket
/*app.get('/api/ticket/:ticketId/messages', async (req, res) => {
    try {
        const { ticketId } = req.params;

        const ticket = await Ticket.findOne({ ticketId: ticketId });
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket non trovato' });
        }

        // Verifica permessi
        const hasAccess = await checkUserAccess(req.user, ticket.guildId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Accesso negato' });
        }

        // Ritorna i messaggi dal transcript
        res.json(ticket.transcript || []);

    } catch (error) {
        console.error('❌ Errore recupero messaggi:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});*/



// Nuova route per la chat live
/*app.get('/chat/:ticketId', async (req, res) => {
    try {
        const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
        if (!ticket) {
            return res.status(404).send('Ticket non trovato');
        }

        // Verifica permessi utente
        const hasAccess = await checkUserAccess(req.user, ticket.guildId);
        if (!hasAccess) {
            return res.status(403).send('Accesso negato');
        }

        // Restituisci la pagina della chat
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Live Chat - ${ticket.ticketId}</title>
                <!-- Stessi CSS di prima -->
            </head>
            <body>
                <div id="ticket-chat">
                    <h2>Chat Live: ${ticket.ticketId}</h2>
                    <div id="chat-messages"></div>
                    <div id="chat-input">
                        <input type="text" id="message-input" placeholder="Scrivi un messaggio...">
                        <button onclick="sendMessage()">Invia</button>
                    </div>
                </div>
                <!-- Stesso JavaScript di prima -->
                <!-- Chat Interface -->
                <div id="ticket-chat">
                    <div id="chat-messages"></div>
                    <div id="chat-input">
                        <input type="text" id="message-input" placeholder="Scrivi un messaggio...">
                        <button onclick="sendMessage()">Invia</button>
                    </div>
                </div>
                
                <script>
                let currentTicketId = null;
                let chatInterval = null;
                
                // Quando apri un ticket
                function openTicket(ticketId) {
                    currentTicketId = ticketId;
                    loadMessages();
                    startChatUpdates();
                }
                
                // Carica i messaggi
                async function loadMessages() {
                    if (!currentTicketId) return;
                    
                    try {
                        const response = await fetch('/api/ticket/' + currentTicketId + '/messages');
                        const messages = await response.json();
                        displayMessages(messages);
                    } catch (error) {
                        console.error('Errore caricamento messaggi:', error);
                    }
                }
                
                // Mostra i messaggi nell'interfaccia
                function displayMessages(messages) {
                    const chatContainer = document.getElementById('chat-messages');
                    chatContainer.innerHTML = '';
                    
                    messages.forEach(msg => {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message';
                        messageDiv.innerHTML = `
                            <strong>${msg.user}:</strong> ${msg.content}
                            <small>${new Date(msg.timestamp).toLocaleTimeString()}</small>
                        `;
                        chatContainer.appendChild(messageDiv);
                    });
                    
                    // Scroll automatico all'ultimo messaggio
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                // Invia messaggio
                async function sendMessage() {
                    const input = document.getElementById('message-input');
                    const message = input.value.trim();
                    
                    if (!message || !currentTicketId) return;
                    
                    try {
                        const response = await fetch('/api/ticket/send-message', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                ticketId: currentTicketId,
                                message: message
                            })
                        });
                        
                        if (response.ok) {
                            input.value = ''; // Pulisci input
                            loadMessages(); // Ricarica messaggi immediatamente
                        }
                    } catch (error) {
                        console.error('Errore invio messaggio:', error);
                    }
                }
                
                // Aggiornamento in tempo reale
                function startChatUpdates() {
                    if (chatInterval) clearInterval(chatInterval);
                    
                    chatInterval = setInterval(() => {
                        loadMessages();
                    }, 2000); // Aggiorna ogni 2 secondi
                }
                
                // Invio messaggio con Enter
                document.getElementById('message-input').addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        sendMessage();
                    }
                });
                </script>
                
                <style>
                #ticket-chat {
                    border: 1px solid #ccc;
                    border-radius: 8px;
                    padding: 15px;
                    max-width: 600px;
                    margin: 0 auto;
                }
                
                #chat-messages {
                    height: 400px;
                    overflow-y: auto;
                    border: 1px solid #eee;
                    padding: 10px;
                    margin-bottom: 10px;
                }
                
                .message {
                    margin-bottom: 10px;
                    padding: 8px;
                    border-bottom: 1px solid #f0f0f0;
                }
                
                .message small {
                    color: #666;
                    margin-left: 10px;
                }
                
                #chat-input {
                    display: flex;
                    gap: 10px;
                }
                
                #message-input {
                    flex: 1;
                    padding: 8px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                }
                
                button {
                    padding: 8px 15px;
                    background: #5865F2;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                </style>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Errore chat live:', error);
        res.status(500).send('Errore interno del server');
    }
});*/

// === ROTTA TRANSCRIPT ONLINE MIGLIORATA ===
app.get('/transcript/:identifier', (req, res) => {
    const identifier = req.params.identifier;
    const transcriptDir = path.join(__dirname, 'transcripts');
    
    console.log(`🔍 Ricerca transcript: ${identifier}`);
    console.log(`📁 Cartella transcript: ${transcriptDir}`);
    
    // Crea la cartella se non esiste
    if (!fs.existsSync(transcriptDir)) {
        console.log('📁 Creo cartella transcripts...');
        fs.mkdirSync(transcriptDir, { recursive: true });
    }
    
    // Cerca il file esatto (SENZA .html nell'identifier)
    const exactPath = path.join(transcriptDir, `${identifier}.html`);
    console.log(`🔍 Percorso cercato: ${exactPath}`);
    console.log(`🔍 File esiste? ${fs.existsSync(exactPath)}`);
    
    if (fs.existsSync(exactPath)) {
        console.log(`✅ Transcript trovato: ${identifier}.html`);
        res.setHeader('Content-Type', 'text/html');
        return res.sendFile(exactPath);
    }
    
    // Se non trova il file esatto, cerca file simili
    try {
        const allFiles = fs.readdirSync(transcriptDir)
            .filter(f => f.endsWith('.html') && f !== '.gitkeep');
        
        console.log(`📁 Tutti i file nella cartella:`, allFiles);
        
        // Cerca file che corrispondono esattamente (case insensitive)
        const matchingFiles = allFiles.filter(file => {
            const fileNameWithoutExt = file.replace('.html', '');
            return fileNameWithoutExt.toLowerCase() === identifier.toLowerCase();
        });
        
        if (matchingFiles.length > 0) {
            console.log(`✅ Transcript trovato con match case-insensitive: ${matchingFiles[0]}`);
            const filePath = path.join(transcriptDir, matchingFiles[0]);
            res.setHeader('Content-Type', 'text/html');
            return res.sendFile(filePath);
        }
        
        // Cerca file che contengono l'identifier
        const partialMatches = allFiles.filter(file => {
            const fileNameWithoutExt = file.replace('.html', '').toLowerCase();
            return fileNameWithoutExt.includes(identifier.toLowerCase());
        });
        
        if (partialMatches.length > 0) {
            console.log(`✅ Transcript trovato con match parziale: ${partialMatches[0]}`);
            const filePath = path.join(transcriptDir, partialMatches[0]);
            res.setHeader('Content-Type', 'text/html');
            return res.sendFile(filePath);
        }
        
        console.log(`❌ Nessun transcript trovato per: ${identifier}`);
        
    } catch (error) {
        console.error('Errore ricerca transcript:', error);
    }

    // === SE IL FILE NON ESISTE ===
    console.log(`❌ Transcript non trovato: ${identifier}`);
    
    // Mostra pagina di errore con informazioni dettagliate
    let folderInfo = 'Cartella non esistente';
    let fileCount = 0;
    let allFilesList = [];
    
    try {
        if (fs.existsSync(transcriptDir)) {
            folderInfo = 'Cartella esistente';
            const files = fs.readdirSync(transcriptDir);
            fileCount = files.filter(f => f.endsWith('.html')).length;
            allFilesList = files.filter(f => f.endsWith('.html'));
        }
    } catch (e) {
        folderInfo = `Errore accesso: ${e.message}`;
    }

    res.status(404).send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript Non Trovato</title>
    <style>
        body { 
            background: #1e1f23; 
            color: #fff; 
            font-family: 'Segoe UI', sans-serif; 
            text-align: center; 
            padding: 50px; 
        }
        h1 { color: #ed4245; }
        p { font-size: 1.2em; margin-bottom: 20px; }
        .discord { color: #5865F2; }
        .debug { 
            background: #2f3136; 
            padding: 20px; 
            border-radius: 8px; 
            margin: 20px 0; 
            text-align: left; 
            font-family: monospace;
            max-width: 800px;
            margin-left: auto;
            margin-right: auto;
        }
        .file-list {
            background: #36393f;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
            text-align: left;
            max-height: 300px;
            overflow-y: auto;
        }
        .btn {
            display: inline-block;
            background: #5865F2;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            text-decoration: none;
            margin: 10px;
            transition: background 0.3s;
            font-weight: 600;
        }
        .btn:hover {
            background: #4752c4;
            transform: translateY(-2px);
        }
        .btn-secondary {
            background: #2f3136;
            color: #b9bbbe;
        }
        .btn-secondary:hover {
            background: #40444b;
        }
        .warning {
            background: #faa81a;
            color: #000;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            font-weight: 600;
        }
        .file-item {
            padding: 5px 0;
            border-bottom: 1px solid #40444b;
        }
        .file-item:last-child {
            border-bottom: none;
        }
    </style>
</head>
<body>
    <h1>🔍 Transcript Non Trovato</h1>
    
    <div class="warning">
        ⚠️ Il transcript richiesto non è stato trovato nel sistema
    </div>
    
    <p>Il transcript <span class="discord">${identifier}</span> non esiste o non è più disponibile.</p>
    
    <div class="debug">
        <strong>🔧 Informazioni di Debug:</strong><br><br>
        <strong>Identifier cercato:</strong> ${identifier}<br>
        <strong>Cartella transcripts:</strong> ${transcriptDir}<br>
        <strong>Stato cartella:</strong> ${folderInfo}<br>
        <strong>File .html trovati:</strong> ${fileCount}<br>
        <strong>Server:</strong> ${process.env.RENDER_EXTERNAL_URL || 'Local'}<br>
        <strong>Tempo:</strong> ${new Date().toLocaleString('it-IT')}<br><br>
        
        <strong>📁 File disponibili (${fileCount}):</strong>
        <div class="file-list">
            ${allFilesList.length > 0 ? 
                allFilesList.map(file => `
                    <div class="file-item">
                        <strong>${file}</strong><br>
                        <small>Nome senza estensione: ${file.replace('.html', '')}</small>
                    </div>
                `).join('') : 
                'Nessun file transcript trovato'
            }
        </div>
    </div>

    <div style="margin-top: 30px;">
        <a href="/debug-transcripts-files" class="btn">🔍 Debug Dettagliato</a>
        <a href="/transcripts" class="btn">📂 Vedi Transcript Disponibili</a>
        <a href="/" class="btn btn-secondary">🏠 Torna alla Home</a>
    </div>

    <div style="margin-top: 40px; padding: 20px; background: #2f3136; border-radius: 8px; max-width: 600px; margin-left: auto; margin-right: auto;">
        <h3>💡 Possibili cause:</h3>
        <ul style="text-align: left; margin: 15px 0;">
            <li>Il transcript è stato eliminato</li>
            <li>Il nome del file non corrisponde</li>
            <li>Problemi di case sensitivity</li>
            <li>Il transcript non è stato ancora generato</li>
        </ul>
    </div>
</body>
</html>
    `);
});

// === MIDDLEWARE PER VERIFICA STAFF - INTEGRATO CON ALLOWEDROLES ===
async function checkStaffRole(req, res, next) {
    if (!req.isAuthenticated()) {
        console.log('❌ Accesso negato: utente non autenticato');
        return res.redirect('/auth/discord');
    }

    try {
        console.log('👮 Controllo permessi transcript per:', req.user.username);
        
        // Owner del bot ha sempre accesso
        if (process.env.BOT_OWNER_ID && req.user.id === process.env.BOT_OWNER_ID) {
            console.log('✅ Accesso owner del bot');
            return next();
        }

        const userGuilds = req.user.guilds || [];
        console.log('📋 Server dell\'utente:', userGuilds.map(g => g.name));

        for (const guild of userGuilds) {
            console.log(`🔍 Controllo server: ${guild.name} (${guild.id})`);
            
            // Cerca le impostazioni del server nel database - STESSA QUERY DEL TUO COMANDO
            const result = await db.query(
                'SELECT settings FROM guild_settings WHERE guild_id = $1',
                [guild.id]
            );

            if (result.rows.length > 0) {
                const settings = result.rows[0].settings || {};
                const allowedRoles = settings.allowed_roles || [];
                
                console.log(`🎯 Ruoli consentiti in ${guild.name}:`, allowedRoles);
                
                if (allowedRoles.length > 0) {
                    // Controlla se l'utente ha uno dei ruoli consentiti
                    const userRoles = guild.roles || [];
                    const hasAllowedRole = userRoles.some(roleId => 
                        allowedRoles.includes(roleId)
                    );
                    
                    // Controlla se è admin del server
                    const isAdmin = (guild.permissions & 0x8) === 0x8;
                    
                    console.log(`👤 Ruoli utente:`, userRoles);
                    console.log(`👑 È admin:`, isAdmin);
                    console.log(`✅ Ha ruolo consentito:`, hasAllowedRole);
                    
                    if (hasAllowedRole || isAdmin) {
                        console.log(`🎉 Accesso CONSENTITO per ${req.user.username} in ${guild.name}`);
                        return next();
                    }
                } else {
                    console.log('⚠️ Nessun ruolo consentito configurato in questo server');
                    // Se non ci sono ruoli consentiti, solo gli admin possono accedere
                    const isAdmin = (guild.permissions & 0x8) === 0x8;
                    if (isAdmin) {
                        console.log(`🎉 Accesso CONSENTITO come admin per ${req.user.username} in ${guild.name}`);
                        return next();
                    }
                }
            } else {
                console.log('❌ Nessuna impostazione trovata per questo server');
                // Se non ci sono impostazioni, solo gli admin possono accedere
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                if (isAdmin) {
                    console.log(`🎉 Accesso CONSENTITO come admin per ${req.user.username} in ${guild.name}`);
                    return next();
                }
            }
        }

        // Se arriva qui, accesso negato
        console.log('🚫 Accesso NEGATO: nessun ruolo autorizzato trovato');
        return res.status(403).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Accesso Negato</title>
                <style>
                    body { 
                        background: #1e1f23; 
                        color: #ed4245; 
                        font-family: sans-serif; 
                        text-align: center; 
                        padding: 100px; 
                    }
                    .btn { 
                        display: inline-block; 
                        background: #5865F2; 
                        color: white; 
                        padding: 10px 20px; 
                        border-radius: 8px; 
                        text-decoration: none; 
                        margin: 10px; 
                    }
                    .info-box {
                        background: #2f3136;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                        text-align: left;
                        max-width: 600px;
                        margin-left: auto;
                        margin-right: auto;
                    }
                    .command-example {
                        background: #36393f;
                        padding: 10px;
                        border-radius: 5px;
                        font-family: monospace;
                        margin: 10px 0;
                    }
                </style>
            </head>
            <body>
                <h1>❌ Accesso Negato ai Transcript</h1>
                <p>Non hai i permessi necessari per accedere alla sezione transcript.</p>
                
                <div class="info-box">
                    <h3>🔒 Come ottenere l'accesso:</h3>
                    <p>Per accedere ai transcript, devi avere uno dei <strong>ruoli consentiti</strong> configurati con il comando:</p>
                    
                    <div class="command-example">
                        /allowedroles set ruoli: ID_RUOLO1, ID_RUOLO2
                    </div>
                    
                    <p><strong>Oppure</strong> essere un <strong>amministratore del server</strong> Discord.</p>
                    
                    <p><strong>I ruoli consentiti sono gli stessi che possono usare i comandi del bot!</strong></p>
                    
                    <p>Contatta un amministratore del server per essere aggiunto ai ruoli autorizzati.</p>
                </div>
                
                <div>
                    <a href="/" class="btn">🏠 Torna alla Home</a>
                    <a href="/logout" class="btn">🚪 Logout</a>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Errore controllo permessi:', error);
        return res.status(500).send('Errore interno del server');
    }
}

// === ROTTA PER SELEZIONARE IL SERVER ===
app.get('/transcripts', checkStaffRole, async (req, res) => {
    try {
        const userGuilds = req.user.guilds || [];
        const accessibleGuilds = [];

        // Trova tutti i server dove l'utente ha accesso + dove il bot è presente
        for (const guild of userGuilds) {
            // Verifica se il bot è in questo server
            const botGuild = client.guilds.cache.get(guild.id);
            if (!botGuild) continue; // Salta se il bot non è nel server

            const result = await db.query(
                'SELECT settings FROM guild_settings WHERE guild_id = $1',
                [guild.id]
            );

            if (result.rows.length > 0) {
                const settings = result.rows[0].settings || {};
                const allowedRoles = settings.allowed_roles || [];
                const userRoles = guild.roles || [];
                const hasAllowedRole = userRoles.some(roleId => allowedRoles.includes(roleId));
                const isAdmin = (guild.permissions & 0x8) === 0x8;

                if (hasAllowedRole || isAdmin) {
                    accessibleGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
                        memberCount: guild.approximate_member_count || 'N/A',
                        botPresent: true
                    });
                }
            } else {
                // Se non ci sono impostazioni, solo admin può accedere
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                if (isAdmin) {
                    accessibleGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
                        memberCount: guild.approximate_member_count || 'N/A',
                        botPresent: true
                    });
                }
            }
        }

        // Se non ci sono server accessibili
        if (accessibleGuilds.length === 0) {
            return res.status(403).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Nessun Accesso</title>
                    <style>
                        body { background: #1e1f23; color: #ed4245; font-family: sans-serif; text-align: center; padding: 100px; }
                        .btn { display: inline-block; background: #5865F2; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; margin: 10px; }
                    </style>
                </head>
                <body>
                    <h1>❌ Nessun Server Accessibile</h1>
                    <p>Non hai i permessi per visualizzare i transcript in nessun server dove il bot è presente.</p>
                    <a href="/" class="btn">Torna alla Home</a>
                </body>
                </html>
            `);
        }

        // Mostra il menu di selezione server
        const serverOptions = accessibleGuilds.map(guild => `
            <div class="server-option" onclick="selectServer('${guild.id}')">
                <div class="server-icon">
                    ${guild.icon ? `<img src="${guild.icon}" alt="${guild.name}">` : '<div class="default-icon"><i class="fas fa-server"></i></div>'}
                </div>
                <div class="server-info">
                    <div class="server-name">${guild.name}</div>
                    <div class="server-meta">
                        <span class="server-id">ID: ${guild.id}</span>
                        <span class="server-members"><i class="fas fa-users"></i> ${guild.memberCount}</span>
                        <span class="bot-status"><i class="fas fa-robot"></i> Bot Online</span>
                    </div>
                </div>
                <div class="server-arrow">
                    <i class="fas fa-chevron-right"></i>
                </div>
            </div>
        `).join('');

        res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Seleziona Server - Transcript</title>
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
            --background: #0f0f12;
            --card-bg: #1a1a1d;
            --text-primary: #ffffff;
            --text-secondary: #b9bbbe;
            --border: #2f3136;
        }

        body {
            background: var(--background);
            color: var(--text-primary);
            font-family: 'Inter', sans-serif;
            padding: 20px;
            min-height: 100vh;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: var(--card-bg);
            border-radius: 16px;
            border: 1px solid var(--border);
        }

        .header h1 {
            color: var(--text-primary);
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .header p {
            color: var(--text-secondary);
            font-size: 1.1rem;
        }

        .user-info {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-top: 15px;
            padding: 10px;
            background: var(--border);
            border-radius: 8px;
        }

        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
        }

        .server-selection {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .server-option {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            align-items: center;
            gap: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .server-option:hover {
            border-color: var(--primary);
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        }

        .server-icon {
            width: 50px;
            height: 50px;
            border-radius: 12px;
            overflow: hidden;
            flex-shrink: 0;
        }

        .server-icon img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .default-icon {
            width: 100%;
            height: 100%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.2rem;
        }

        .server-info {
            flex: 1;
        }

        .server-name {
            font-weight: 600;
            font-size: 1.1rem;
            margin-bottom: 5px;
            color: var(--text-primary);
        }

        .server-meta {
            display: flex;
            gap: 15px;
            font-size: 0.85rem;
            color: var(--text-secondary);
        }

        .server-members, .bot-status {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .bot-status {
            color: var(--success);
        }

        .server-arrow {
            color: var(--text-secondary);
            font-size: 1.1rem;
        }

        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
            color: var(--text-secondary);
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            background: var(--border);
            color: var(--text-primary);
            text-decoration: none;
            border-radius: 8px;
            transition: background 0.3s ease;
        }

        .btn:hover {
            background: var(--primary);
        }

        @media (max-width: 768px) {
            .server-meta {
                flex-direction: column;
                gap: 5px;
            }
            
            .server-option {
                padding: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-server"></i> Seleziona Server</h1>
            <p>Scegli il server Discord di cui vuoi gestire i ticket</p>
            
            <div class="user-info">
                <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                     class="user-avatar" alt="Avatar">
                <span>${req.user.username}</span>
            </div>
        </div>

        <div class="server-selection">
            ${serverOptions}
        </div>

        <div class="footer">
            <a href="/" class="btn">
                <i class="fas fa-arrow-left"></i> Torna alla Home
            </a>
        </div>
    </div>

    <script>
        function selectServer(guildId) {
            window.location.href = '/transcripts/' + guildId;
        }
    </script>
</body>
</html>
        `);
    } catch (error) {
        console.error('❌ Errore nella selezione server:', error);
        res.status(500).send('Errore interno del server');
    }
});

// === ROTTA COMPLETA PER GESTIONE TICKET ===
app.get('/transcripts/:guildId', checkStaffRole, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const userGuilds = req.user.guilds || [];
        
        // Verifica che l'utente abbia accesso a questo server specifico
        const userGuild = userGuilds.find(g => g.id === guildId);
        if (!userGuild) {
            return res.status(403).send('Accesso negato a questo server');
        }

        // Verifica che il bot sia nel server
        const botGuild = client.guilds.cache.get(guildId);
        if (!botGuild) {
            return res.status(404).send('Bot non presente in questo server');
        }

        // Verifica i permessi
        const result = await db.query(
            'SELECT settings FROM guild_settings WHERE guild_id = $1',
            [guildId]
        );

        let hasAccess = false;
        if (result.rows.length > 0) {
            const settings = result.rows[0].settings || {};
            const allowedRoles = settings.allowed_roles || [];
            const userRoles = userGuild.roles || [];
            const hasAllowedRole = userRoles.some(roleId => allowedRoles.includes(roleId));
            const isAdmin = (userGuild.permissions & 0x8) === 0x8;
            hasAccess = hasAllowedRole || isAdmin;
        } else {
            hasAccess = (userGuild.permissions & 0x8) === 0x8;
        }

        if (!hasAccess) {
            return res.status(403).send('Accesso negato a questo server');
        }

        // RECUPERA I DATI
        const transcriptDir = path.join(__dirname, 'transcripts');
        
        // Ticket chiusi (transcript)
        const closedTickets = await db.query(
            'SELECT * FROM tickets WHERE guild_id = $1 AND status = $2 ORDER BY closed_at DESC LIMIT 50',
            [guildId, 'closed']
        );

        // Ticket aperti
        const openTickets = await db.query(
            'SELECT * FROM tickets WHERE guild_id = $1 AND status = $2 ORDER BY created_at DESC',
            [guildId, 'open']
        );

        // Transcript disponibili
        let availableTranscripts = [];
        if (fs.existsSync(transcriptDir)) {
            const allFiles = fs.readdirSync(transcriptDir)
                .filter(f => f.endsWith('.html') && f !== '.gitkeep');

            availableTranscripts = allFiles.filter(file => {
                const serverId = extractServerIdFromFilename(file);
                return serverId === guildId;
            }).map(file => {
                const stats = fs.statSync(path.join(transcriptDir, file));
                return {
                    name: file.replace('.html', ''),
                    file: file,
                    date: new Date(stats.mtime).toLocaleString('it-IT'),
                    size: (stats.size / 1024).toFixed(2)
                };
            }).sort((a, b) => new Date(b.date) - new Date(a.date));
        }

        // HTML per la pagina
        const html = `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gestione Ticket - ${botGuild.name}</title>
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
            --warning: #faa81a;
            --error: #ed4245;
            --background: #0f0f12;
            --card-bg: #1a1a1d;
            --text-primary: #ffffff;
            --text-secondary: #b9bbbe;
            --border: #2f3136;
        }

        body {
            background: var(--background);
            color: var(--text-primary);
            font-family: 'Inter', sans-serif;
            padding: 20px;
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
        }

        .server-header {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 30px;
            padding: 20px;
            background: var(--card-bg);
            border-radius: 12px;
            border: 1px solid var(--border);
        }

        .server-icon {
            width: 60px;
            height: 60px;
            border-radius: 12px;
        }

        .server-info h2 {
            color: var(--text-primary);
            margin-bottom: 5px;
        }

        .server-info p {
            color: var(--text-secondary);
            font-size: 0.9rem;
        }

        .user-info {
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--card-bg);
            padding: 10px 15px;
            border-radius: 10px;
            border: 1px solid var(--border);
        }

        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: var(--card-bg);
            padding: 20px;
            border-radius: 12px;
            border: 1px solid var(--border);
            text-align: center;
        }

        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 5px;
        }

        .stat-open { color: var(--warning); }
        .stat-closed { color: var(--success); }
        .stat-transcripts { color: var(--primary); }

        .section {
            margin-bottom: 40px;
        }

        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .section-title {
            font-size: 1.5rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .ticket-list, .transcript-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .ticket-item, .transcript-item {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.3s ease;
        }

        .ticket-item:hover, .transcript-item:hover {
            border-color: var(--primary);
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        }

        .ticket-info, .transcript-info {
            flex: 1;
        }

        .ticket-name, .transcript-name {
            font-weight: 600;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .ticket-name a, .transcript-name a {
            color: var(--text-primary);
            text-decoration: none;
        }

        .ticket-name a:hover, .transcript-name a:hover {
            color: var(--primary);
        }

        .ticket-meta, .transcript-meta {
            display: flex;
            gap: 20px;
            font-size: 0.85rem;
            color: var(--text-secondary);
        }

        .ticket-meta span, .transcript-meta span {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .ticket-actions, .transcript-actions {
            display: flex;
            gap: 10px;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 8px 15px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 0.85rem;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
        }

        .btn-view {
            background: var(--primary);
            color: white;
        }

        .btn-view:hover {
            background: var(--primary-dark);
        }

        .btn-respond {
            background: var(--success);
            color: #000;
        }

        .btn-respond:hover {
            background: #00cc6a;
        }

        .btn-close {
            background: var(--error);
            color: white;
        }

        .btn-close:hover {
            background: #d83639;
        }

        .btn-copy {
            background: var(--border);
            color: var(--text-primary);
        }

        .btn-copy:hover {
            background: var(--primary);
        }

        .btn-back {
            background: var(--border);
            color: var(--text-primary);
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn-back:hover {
            background: var(--primary);
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-secondary);
        }

        .empty-state i {
            font-size: 3rem;
            margin-bottom: 20px;
            color: var(--border);
        }

        .status-badge {
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
        }

        .status-open { background: var(--warning); color: #000; }
        .status-closed { background: var(--success); color: #000; }

        @media (max-width: 768px) {
            .ticket-item, .transcript-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 15px;
            }
            
            .ticket-actions, .transcript-actions {
                align-self: flex-end;
            }
            
            .ticket-meta, .transcript-meta {
                flex-direction: column;
                gap: 5px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-shield-alt"></i> Staff Area - Gestione Ticket</h1>
            <div class="user-info">
                <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                     class="user-avatar" alt="Avatar">
                <span>${req.user.username}</span>
            </div>
        </div>

        <div class="server-header">
            ${botGuild.icon ? `<img src="https://cdn.discordapp.com/icons/${botGuild.id}/${botGuild.icon}.png" class="server-icon" alt="${botGuild.name}">` : '<div class="server-icon" style="background: var(--primary); display: flex; align-items: center; justify-content: center; color: white;"><i class="fas fa-server"></i></div>'}
            <div class="server-info">
                <h2>${botGuild.name}</h2>
                <p>ID: ${botGuild.id} • Membri: ${botGuild.memberCount || 'N/A'}</p>
            </div>
        </div>

        <!-- STATISTICHE -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number stat-open">${openTickets.rows.length}</div>
                <div>Ticket Aperti</div>
            </div>
            <div class="stat-card">
                <div class="stat-number stat-closed">${closedTickets.rows.length}</div>
                <div>Ticket Chiusi</div>
            </div>
            <div class="stat-card">
                <div class="stat-number stat-transcripts">${availableTranscripts.length}</div>
                <div>Transcript Disponibili</div>
            </div>
        </div>

        <!-- TICKET APERTI -->
        <div class="section">
            <div class="section-header">
                <h3 class="section-title">
                    <i class="fas fa-ticket-alt"></i>
                    Ticket Aperti (Online)
                </h3>
            </div>

            ${openTickets.rows.length > 0 ? `
                <div class="ticket-list">
                    ${openTickets.rows.map(ticket => {
                        const channel = botGuild.channels.cache.get(ticket.channel_id);
                        const user = client.users.cache.get(ticket.user_id);
                        return `
                        <div class="ticket-item">
                            <div class="ticket-info">
                                <div class="ticket-name">
                                    <span class="status-badge status-open">APERTO</span>
                                    ${ticket.ticket_type} - ${user ? user.username : 'Utente Sconosciuto'}
                                </div>
                                <div class="ticket-meta">
                                    <span><i class="far fa-clock"></i> ${new Date(ticket.created_at).toLocaleString('it-IT')}</span>
                                    <span><i class="fas fa-hashtag"></i> ${channel ? channel.name : 'Canale eliminato'}</span>
                                    <span><i class="fas fa-user"></i> ${user ? user.username : 'Utente Sconosciuto'}</span>
                                </div>
                            </div>
                            <div class="ticket-actions">
                                <button onclick="openTicketChat('${ticket.id}', '${ticket.channel_id}')" class="btn btn-respond">
                                    <i class="fas fa-comment"></i> Rispondi
                                </button>
                                ${channel ? `
                                <a href="https://discord.com/channels/${guildId}/${ticket.channel_id}" target="_blank" class="btn btn-view">
                                    <i class="fas fa-external-link-alt"></i> Apri in Discord
                                </a>
                                ` : ''}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            ` : `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <h3>Nessun ticket aperto</h3>
                    <p>Non ci sono ticket aperti in questo momento.</p>
                </div>
            `}
        </div>

        <!-- TRANSCRIPT (TICKET CHIUSI) -->
        <div class="section">
            <div class="section-header">
                <h3 class="section-title">
                    <i class="fas fa-file-alt"></i>
                    Transcript (Ticket Chiusi)
                </h3>
            </div>

            ${availableTranscripts.length > 0 ? `
                <div class="transcript-list">
                    ${availableTranscripts.map(transcript => `
                        <div class="transcript-item">
                            <div class="transcript-info">
                                <div class="transcript-name">
                                    <i class="fas fa-ticket-alt"></i>
                                    <a href="/transcript/${transcript.name}" target="_blank">${transcript.name}</a>
                                </div>
                                <div class="transcript-meta">
                                    <span><i class="far fa-clock"></i> ${transcript.date}</span>
                                    <span><i class="fas fa-weight-hanging"></i> ${transcript.size} KB</span>
                                </div>
                            </div>
                            <div class="transcript-actions">
                                <a href="/transcript/${transcript.name}" target="_blank" class="btn btn-view">
                                    <i class="fas fa-eye"></i> Visualizza
                                </a>
                                <button onclick="copyTranscriptLink('${transcript.name}')" class="btn btn-copy" title="Copia link">
                                    <i class="fas fa-copy"></i>
                                </button>
                                <button onclick="deleteTranscript('${transcript.name}', event)" class="btn btn-close" title="Elimina transcript">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <h3>Nessun transcript disponibile</h3>
                    <p>Non ci sono transcript archiviati per questo server.</p>
                </div>
            `}
        </div>

        <div style="text-align: center; margin-top: 40px; display: flex; gap: 15px; justify-content: center;">
            <a href="/transcripts" class="btn-back">
                <i class="fas fa-arrow-left"></i> Cambia Server
            </a>
            <a href="/" class="btn-back">
                <i class="fas fa-home"></i> Torna alla Home
            </a>
        </div>
    </div>

    <!-- MODAL PER RISPOSTA TICKET -->
    <div id="ticketModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center;">
        <div style="background: var(--card-bg); padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; border: 1px solid var(--border);">
            <h3 style="margin-bottom: 20px;"><i class="fas fa-comment"></i> Rispondi al Ticket</h3>
            <textarea id="ticketMessage" placeholder="Scrivi il tuo messaggio..." style="width: 100%; height: 150px; background: var(--border); border: 1px solid var(--border); color: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; resize: vertical;"></textarea>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button onclick="closeModal()" class="btn btn-copy">Annulla</button>
                <button onclick="sendTicketMessage()" class="btn btn-respond">Invia Messaggio</button>
            </div>
        </div>
    </div>

    <script>
        let currentTicketId = null;
        let currentChannelId = null;

        function openTicketChat(ticketId, channelId) {
            currentTicketId = ticketId;
            currentChannelId = channelId;
            document.getElementById('ticketModal').style.display = 'flex';
            document.getElementById('ticketMessage').focus();
        }

        function closeModal() {
            document.getElementById('ticketModal').style.display = 'none';
            currentTicketId = null;
            currentChannelId = null;
            document.getElementById('ticketMessage').value = '';
        }

        async function sendTicketMessage() {
            const message = document.getElementById('ticketMessage').value.trim();
            if (!message) {
                alert('Inserisci un messaggio!');
                return;
            }

            try {
                const response = await fetch('/api/ticket/send-message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ticketId: currentTicketId,
                        channelId: currentChannelId,
                        message: message
                    })
                });

                const result = await response.json();

                if (result.success) {
                    alert('Messaggio inviato con successo!');
                    closeModal();
                    // Ricarica la pagina per aggiornare lo stato
                    setTimeout(() => location.reload(), 1000);
                } else {
                    alert('Errore: ' + result.message);
                }
            } catch (error) {
                console.error('Errore:', error);
                alert('Errore di connessione');
            }
        }

        function copyTranscriptLink(transcriptId) {
            const link = window.location.origin + '/transcript/' + transcriptId;
            navigator.clipboard.writeText(link).then(() => {
                const btn = event.target.closest('.btn-copy');
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.style.background = 'var(--success)';
                
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.background = '';
                }, 2000);
            });
        }

        async function deleteTranscript(transcriptName, event) {
            if (!confirm('Sei sicuro di voler eliminare questo transcript?\\n\\n⚠️ Questa azione è irreversibile!')) {
                return;
            }

            try {
                const response = await fetch('/transcript/' + encodeURIComponent(transcriptName), {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                const result = await response.json();

                if (result.success) {
                    alert('Transcript eliminato con successo!');
                    const transcriptItem = event.target.closest('.transcript-item');
                    if (transcriptItem) {
                        transcriptItem.style.opacity = '0';
                        transcriptItem.style.transform = 'translateX(-100px)';
                        setTimeout(() => {
                            transcriptItem.remove();
                        }, 300);
                    }
                } else {
                    alert('Errore: ' + result.message);
                }
            } catch (error) {
                console.error('Errore eliminazione:', error);
                alert('Errore di connessione');
            }
        }

        // Chiudi modal con ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });
    </script>
</body>
</html>`;

        res.send(html);

    } catch (error) {
        console.error('❌ Errore nel caricamento gestione ticket:', error);
        res.status(500).send('Errore interno del server');
    }
});

// === ROTTA PER ELIMINARE TRANSCRIPT ===
app.delete('/transcript/:filename', checkStaffRole, async (req, res) => {
    try {
        const filename = req.params.filename;
        const transcriptDir = path.join(__dirname, 'transcripts');
        const filePath = path.join(transcriptDir, `${filename}.html`);

        console.log(`🗑️ Tentativo eliminazione: ${filename}`);

        // Verifica che il file esista
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ 
                success: false, 
                message: 'Transcript non trovato - potrebbe essere già stato eliminato' 
            });
        }

        // Verifica che sia un file HTML (sicurezza)
        if (!filename.endsWith('.html') && !filename.match(/^[a-zA-Z0-9-_]+$/)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nome file non valido' 
            });
        }

        // Elimina il file
        fs.unlinkSync(filePath);
        
        console.log(`✅ Transcript eliminato: ${filename}`);

        res.json({ 
            success: true, 
            message: 'Transcript eliminato con successo. Il link non sarà più accessibile.',
            deletedFile: filename
        });

    } catch (error) {
        console.error('❌ Errore eliminazione transcript:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Errore interno del server durante l\'eliminazione' 
        });
    }
});

// === ROTTA DEBUG PER VERIFICARE I FILE ===
app.get('/debug-transcripts-files', (req, res) => {
    const transcriptDir = path.join(__dirname, 'transcripts');
    
    if (!fs.existsSync(transcriptDir)) {
        return res.json({ 
            success: false, 
            message: 'Cartella transcripts non esiste',
            path: transcriptDir 
        });
    }
    
    const allFiles = fs.readdirSync(transcriptDir)
        .filter(f => f.endsWith('.html') && f !== '.gitkeep');
    
    const fileDetails = allFiles.map(file => {
        const filePath = path.join(transcriptDir, file);
        const stats = fs.statSync(filePath);
        
        return {
            name: file,
            nameWithoutExt: file.replace('.html', ''),
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
        };
    });
    
    res.json({
        success: true,
        transcriptDir: transcriptDir,
        totalFiles: allFiles.length,
        files: fileDetails,
        allFileNames: allFiles
    });
});

// === ROTTA DEBUG PER VERIFICARE I PERMESSI ===
app.get('/debug-permissions', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/discord');
    }

    try {
        const userInfo = {
            username: req.user.username,
            id: req.user.id,
            guilds: []
        };

        // Per ogni guild, controlla le impostazioni dal database
        for (const guild of req.user.guilds || []) {
            const guildInfo = {
                id: guild.id,
                name: guild.name,
                permissions: guild.permissions,
                isAdmin: (guild.permissions & 0x8) === 0x8,
                userRoles: guild.roles || [],
                settings: null,
                hasAccess: false
            };

            // Cerca le impostazioni del server
            const result = await db.query(
                'SELECT settings FROM guild_settings WHERE guild_id = $1',
                [guild.id]
            );

            if (result.rows.length > 0) {
                const settings = result.rows[0].settings || {};
                guildInfo.settings = settings;
                guildInfo.allowedRoles = settings.allowed_roles || [];
                
                // Controlla accesso
                const hasAllowedRole = guildInfo.userRoles.some(roleId => 
                    guildInfo.allowedRoles.includes(roleId)
                );
                guildInfo.hasAccess = hasAllowedRole || guildInfo.isAdmin;
            } else {
                guildInfo.settings = 'Nessuna impostazione trovata';
                guildInfo.allowedRoles = [];
                guildInfo.hasAccess = guildInfo.isAdmin; // Solo admin se nessuna impostazione
            }

            userInfo.guilds.push(guildInfo);
        }

        // Crea una pagina HTML leggibile
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Debug Permessi</title>
                <style>
                    body { background: #1e1f23; color: white; font-family: sans-serif; padding: 20px; }
                    .guild { background: #2f3136; margin: 10px 0; padding: 15px; border-radius: 8px; }
                    .has-access { border-left: 5px solid #00ff88; }
                    .no-access { border-left: 5px solid #ed4245; }
                    .role { display: inline-block; background: #5865F2; padding: 2px 8px; border-radius: 4px; margin: 2px; font-size: 0.9em; }
                    .allowed-role { background: #00ff88; color: black; }
                </style>
            </head>
            <body>
                <h1>🔍 Debug Permessi - ${userInfo.username}</h1>
                
                ${userInfo.guilds.map(guild => `
                    <div class="guild ${guild.hasAccess ? 'has-access' : 'no-access'}">
                        <h3>${guild.name} ${guild.hasAccess ? '✅' : '❌'}</h3>
                        <p><strong>ID:</strong> ${guild.id}</p>
                        <p><strong>Admin:</strong> ${guild.isAdmin ? '✅' : '❌'}</p>
                        
                        <p><strong>Ruoli utente:</strong><br>
                        ${guild.userRoles.map(roleId => `<span class="role">${roleId}</span>`).join('') || 'Nessun ruolo'}</p>
                        
                        <p><strong>Ruoli consentiti:</strong><br>
                        ${guild.allowedRoles ? guild.allowedRoles.map(roleId => 
                            `<span class="role allowed-role ${guild.userRoles.includes(roleId) ? 'user-has-role' : ''}">${roleId}</span>`
                        ).join('') : 'Nessun ruolo consentito'}</p>
                        
                        <p><strong>Accesso transcript:</strong> ${guild.hasAccess ? '✅ CONSENTITO' : '❌ NEGATO'}</p>
                    </div>
                `).join('')}
                
                <br>
                <a href="/" style="color: #5865F2;">← Torna alla Home</a>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Errore debug:', error);
        res.status(500).json({ error: error.message });
    }
});

// === HOMEPAGE MODERNA ===
app.get('/', (req, res) => {
    console.log('🏠 Homepage richiesta - Utente autenticato:', req.isAuthenticated());
    
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/discord');
    }

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

        .user-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding: 20px;
            background: var(--card-bg);
            border-radius: 16px;
            border: 1px solid var(--border);
        }

        .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .user-avatar {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 2px solid var(--primary);
        }

        .user-details h2 {
            color: var(--text-primary);
            margin-bottom: 5px;
        }

        .user-details p {
            color: var(--text-secondary);
            font-size: 0.9rem;
        }

        .header-actions {
            display: flex;
            gap: 15px;
            align-items: center;
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
        }

        .btn-logout {
            background: var(--error);
        }

        .btn-logout:hover {
            background: #d83639;
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

        .main-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
        }

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

        .status-item {
            display: flex;
            justify-content: space-between;
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

        .widget-container {
            border-radius: 12px;
            overflow: hidden;
            background: var(--border);
            margin-top: 15px;
        }

        .footer {
            text-align: center;
            margin-top: 50px;
            padding: 30px;
            color: var(--text-muted);
            border-top: 1px solid var(--border);
        }

        @media (max-width: 768px) {
            .user-header {
                flex-direction: column;
                gap: 15px;
                text-align: center;
            }
            
            .header-actions {
                flex-direction: column;
                width: 100%;
            }
            
            .btn {
                width: 100%;
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header con info utente -->
        <div class="user-header">
            <div class="user-info">
                <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                     class="user-avatar" alt="Avatar">
                <div class="user-details">
                    <h2>Benvenuto, ${req.user.username}!</h2>
                    <p>Accesso effettuato con Discord</p>
                </div>
            </div>
            <div class="header-actions">
                <a href="/transcripts" class="btn">
                    <i class="fas fa-file-alt"></i> Transcript Staff
                </a>
                <a href="/logout" class="btn btn-logout">
                    <i class="fas fa-sign-out-alt"></i> Logout
                </a>
            </div>
        </div>

        <!-- Header principale -->
        <header class="header" style="text-align: center; margin-bottom: 40px; padding: 40px 20px; background: linear-gradient(135deg, var(--card-bg) 0%, #1e1e22 100%); border-radius: 20px; border: 1px solid var(--border); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);">
            <h1 class="logo">.gg/shaderss</h1>
            <p class="tagline">Discord Bot • 24/7 • Advanced Features</p>
            <div class="btn-group">
                <a href="https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID || 'IL_TUO_CLIENT_ID'}&scope=bot+applications.commands&permissions=8" class="btn">
                    <i class="fas fa-robot"></i>Invita Bot
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

        updateStatus();
        setInterval(updateStatus, 10000);
    </script>
</body>
</html>
    `);
});

// Avvia server web
let server;
try {
    server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server web attivo sulla porta ${PORT}`);
        console.log(`🌐 Status page: https://gg-shaderss.onrender.com`);
        
        // Crea la cartella transcripts all'avvio
        const transcriptDir = path.join(__dirname, 'transcripts');
        if (!fs.existsSync(transcriptDir)) {
            fs.mkdirSync(transcriptDir, { recursive: true });
            console.log('📁 Cartella transcripts creata');
        }
    });
} catch (error) {
    console.error('❌ Errore avvio server web:', error);
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
    
    // Gestione menu select per ticket
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
        try {
            const { createTicket } = require('./utils/ticketUtils');
            await createTicket(interaction, interaction.values[0]);
        } catch (error) {
            console.error('Errore creazione ticket:', error);
        }
    }
    
    // Gestione bottone per chiudere ticket
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        try {
            const { showCloseTicketModal } = require('./utils/ticketUtils');
            await showCloseTicketModal(interaction);
        } catch (error) {
            console.error('Errore mostrare modal chiusura:', error);
        }
    }
    
    // Gestione modal per chiusura ticket
    if (interaction.isModalSubmit() && interaction.customId === 'close_ticket_modal') {
        try {
            const { closeTicketWithReason } = require('./utils/ticketUtils');
            await closeTicketWithReason(interaction);
        } catch (error) {
            console.error('Errore chiusura ticket con motivazione:', error);
        }
    }
});

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
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                ticket_id VARCHAR(50) NOT NULL,
                username VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  } catch (error) {
    console.error('❌ ERRORE DEPLOY GLOBALE:', error);
  }
  console.log('🎉 Deploy globale completato!');
  isDeploying = false;
}

// Avvio bot
client.once('ready', async () => {
    console.log(`✅ Bot online come ${client.user.tag}`);
    console.log(`🏠 Server: ${client.guilds.cache.size} server`);
   
    await initDatabase();
    await deployCommands();
    await detectPreviousCrash(client);
    await initializeStatusSystem(client);
    await updateBotStatus(client, 'online', 'Avvio completato');
    await startAutoCleanup();
   
    client.user.setActivity({
        name: `${client.guilds.cache.size} servers | /help`,
        type: 3
    });
   
    setInterval(() => {
        updateStatusPeriodically(client);
    }, 5 * 60 * 1000);
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
    setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', async (error) => {
    console.error('❌ Promise rejection non gestito:', error);
});

// Export client e db
module.exports = { client, db };

// Login bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Errore login bot:', error);
    process.exit(1);
});

console.log('File index.js caricato completamente');
