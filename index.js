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

// === CSS GLOBALE STILE ERASER ===
const globalCSS = `
    <style>
        :root {
            --primary: #5865F2;
            --primary-dark: #4752c4;
            --primary-light: rgba(88, 101, 242, 0.1);
            --success: #00ff88;
            --error: #ed4245;
            --warning: #faa81a;
            --background: #0a0a0a;
            --surface: #111111;
            --card-bg: #1a1a1a;
            --card-hover: #252525;
            --text-primary: #ffffff;
            --text-secondary: #a0a0a0;
            --text-muted: #666666;
            --border: #2a2a2a;
            --border-light: #333333;
            --gradient: linear-gradient(135deg, var(--primary) 0%, #9b59b6 50%, var(--success) 100%);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background: var(--background);
            color: var(--text-primary);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.6;
            min-height: 100vh;
            position: relative;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
        }

        .btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(88, 101, 242, 0.3);
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 2rem;
            transition: all 0.3s ease;
        }

        .card:hover {
            border-color: var(--primary);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        /* Sfondo Animato CORRETTO */
        .animated-bg {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            overflow: hidden;
        }
        
        .animated-bg::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: 
                radial-gradient(circle at 20% 80%, rgba(88, 101, 242, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, rgba(0, 255, 136, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 40% 40%, rgba(250, 168, 26, 0.05) 0%, transparent 50%);
            animation: float 20s ease-in-out infinite;
        }
        
        .animated-bg::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                linear-gradient(45deg, rgba(10, 10, 10, 0.9) 0%, rgba(17, 17, 17, 0.95) 100%);
        }
        
        @keyframes float {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            33% { transform: translate(30px, -30px) rotate(120deg); }
            66% { transform: translate(-20px, 20px) rotate(240deg); }
        }

        /* Container principale sopra lo sfondo */
        .main-container {
            position: relative;
            z-index: 1;
            min-height: 100vh;
        }
    </style>
`;

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
            ${globalCSS}
        </head>
        <body>
            <div class="animated-bg"></div>
            <div class="main-container">
                <div style="text-align: center; padding: 100px;">
                    <h1>❌ Errore Interno del Server</h1>
                    <p>Si è verificato un errore durante l'autenticazione.</p>
                    
                    <div style="background: #2f3136; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
                        <strong>Dettagli errore:</strong><br>
                        ${err.message || 'Errore sconosciuto'}
                    </div>
                    
                    <a href="/auth/discord" class="btn">Riprova Login</a>
                    <a href="/" class="btn">Torna alla Home</a>
                </div>
            </div>
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
            ${globalCSS}
        </head>
        <body>
            <div class="animated-bg"></div>
            <div class="main-container">
                <div style="text-align: center; padding: 100px;">
                    <h1>❌ Autenticazione Fallita</h1>
                    <p>Impossibile accedere con Discord.</p>
                    
                    <div style="background: #2f3136; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
                        <strong>Dettagli errore:</strong><br>
                        Codice: ${error}<br>
                        Descrizione: ${errorDescription}
                    </div>
                    
                    <a href="/auth/discord" class="btn">Riprova Login</a>
                    <a href="/" class="btn">Torna alla Home</a>
                </div>
            </div>
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

// === FUNZIONI HELPER PER STATISTICHE ===
async function getTicketStats() {
    try {
        // Conta tutti i ticket creati (aperti + chiusi)
        const ticketsResult = await db.query('SELECT COUNT(*) as total_tickets FROM tickets');
        const totalTickets = parseInt(ticketsResult.rows[0].total_tickets) || 0;

        // Conta utenti unici che hanno creato ticket
        const usersResult = await db.query('SELECT COUNT(DISTINCT user_id) as unique_users FROM tickets');
        const uniqueUsers = parseInt(usersResult.rows[0].unique_users) || 0;

        return {
            totalTickets,
            uniqueUsers
        };
    } catch (error) {
        console.error('❌ Errore recupero statistiche ticket:', error);
        return {
            totalTickets: 0,
            uniqueUsers: 0
        };
    }
}

async function getLiveStats() {
    try {
        // Ticket aperti in questo momento
        const openTicketsResult = await db.query('SELECT COUNT(*) as open_tickets FROM tickets WHERE status = $1', ['open']);
        const openTickets = parseInt(openTicketsResult.rows[0].open_tickets) || 0;

        // Ticket chiusi oggi
        const today = new Date().toISOString().split('T')[0];
        const todayTicketsResult = await db.query(
            'SELECT COUNT(*) as today_tickets FROM tickets WHERE DATE(created_at) = $1',
            [today]
        );
        const todayTickets = parseInt(todayTicketsResult.rows[0].today_tickets) || 0;

        return {
            openTickets,
            todayTickets
        };
    } catch (error) {
        console.error('❌ Errore recupero statistiche live:', error);
        return {
            openTickets: 0,
            todayTickets: 0
        };
    }
}

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

// === NUOVA API PER INVIO MESSAGGI CON SUPPORTO CHAT LIVE ===
app.post('/api/ticket/send-message', async (req, res) => {
    try {
        const { ticketId, message, channelId } = req.body;
        const username = req.user.username;

        console.log(`📨 Invio messaggio STAFF per ticket ${ticketId} da ${username}: ${message}`);

        // 1. Cerca il ticket
        const ticketQuery = await db.query(
            'SELECT * FROM tickets WHERE id::text = $1 OR channel_id = $1',
            [ticketId]
        );
        
        if (ticketQuery.rows.length === 0) {
            console.log('❌ Ticket non trovato:', ticketId);
            return res.status(404).json({ error: 'Ticket non trovato' });
        }

        const ticket = ticketQuery.rows[0];
        const targetChannelId = channelId || ticket.channel_id;

        // ✅ PREVENZIONE DUPLICATI STAFF
        const existingStaffMessage = await db.query(
            `SELECT * FROM messages 
             WHERE ticket_id = $1 
             AND content = $2 
             AND username = $3 
             AND is_staff = true 
             AND timestamp > NOW() - INTERVAL '2 seconds'`,
            [ticketId, message, username]
        );

        if (existingStaffMessage.rows.length > 0) {
            console.log('⚠️ Messaggio staff duplicato, salto il salvataggio:', message);
            return res.json({ success: true, message: { id: 'duplicate', content: message } });
        }

        // 2. Salva il messaggio come STAFF
        const messageQuery = await db.query(
            'INSERT INTO messages (ticket_id, username, content, is_staff, timestamp) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
            [ticketId, username, message, true]
        );

        const savedMessage = messageQuery.rows[0];
        console.log(`💾 Messaggio STAFF salvato per ticket ${ticketId}: ${username}`);

        // 3. Invia su Discord
        const channel = client.channels.cache.get(targetChannelId);
        if (channel) {
            const discordMessage = `<:discotoolsxyzicon18:1434231459702509758> **[STAFF]**: ${message}`;
            await channel.send(discordMessage);
            console.log('✅ Messaggio inviato su Discord nel canale:', targetChannelId);
        } else {
            console.log('⚠️ Canale Discord non trovato:', targetChannelId);
        }

        res.json({ 
            success: true, 
            message: savedMessage 
        });

    } catch (error) {
        console.error('❌ Errore invio messaggio staff:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// === NUOVA API PER RECUPERO MESSAGGI PER CHAT LIVE ===
app.get('/api/ticket/:ticketId/messages', async (req, res) => {
    try {
        const { ticketId } = req.params;
        
        console.log(`📥 Richiesta messaggi per ticket: ${ticketId}`);
        
        const result = await db.query(
            'SELECT * FROM messages WHERE ticket_id::text = $1 ORDER BY timestamp ASC',
            [ticketId]
        );
        
        console.log(`✅ Trovati ${result.rows.length} messaggi per ticket ${ticketId}`);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Errore recupero messaggi:', error);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// === API PER ELIMINARE DUPLICATI INCROCIATI ===
app.delete('/api/cleanup-duplicates-improved', async (req, res) => {
    try {
        // Elimina duplicati dove stesso contenuto, stesso ticket, ma utenti diversi (staff vs user)
        const result = await db.query(`
            DELETE FROM messages 
            WHERE id IN (
                SELECT m1.id
                FROM messages m1
                JOIN messages m2 ON 
                    m1.ticket_id = m2.ticket_id 
                    AND m1.content = m2.content 
                    AND m1.timestamp > NOW() - INTERVAL '1 hour'
                    AND m2.timestamp > NOW() - INTERVAL '1 hour'
                    AND m1.id > m2.id
                    AND (
                        (m1.is_staff = true AND m2.is_staff = false) OR
                        (m1.is_staff = false AND m2.is_staff = true)
                    )
            )
        `);
        
        console.log(`🧹 Eliminati ${result.rowCount} messaggi duplicati incrociati`);
        res.json({ success: true, deleted: result.rowCount });
        
    } catch (error) {
        console.error('❌ Errore pulizia duplicati incrociati:', error);
        res.status(500).json({ error: 'Errore pulizia' });
    }
});

// === NUOVA ROTTA PER LA CHAT LIVE - VERSIONE CORRETTA ===
app.get('/chat/:ticketId', checkStaffRole, async (req, res) => {
    try {
        const { ticketId } = req.params;
        
        console.log(`💬 Apertura chat live per ticket: ${ticketId}`);
        
        // Recupera le informazioni del ticket - CORREZIONE: usa CAST per convertire tipi
        const ticketResult = await db.query(
        'SELECT * FROM tickets WHERE id::text = $1 OR channel_id = $1',
        [ticketId]
    );
        if (ticketResult.rows.length === 0) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Ticket Non Trovato</title>
                    ${globalCSS}
                </head>
                <body>
                    <div class="animated-bg"></div>
                    <div class="main-container">
                        <div style="text-align: center; padding: 100px;">
                            <h1>❌ Ticket Non Trovato</h1>
                            <p>Il ticket richiesto non esiste o non è più disponibile.</p>
                            <a href="/transcripts" class="btn">Torna ai Transcript</a>
                        </div>
                    </div>
                </body>
                </html>
            `);
        }

        const ticket = ticketResult.rows[0];
        
        // Verifica che l'utente abbia accesso al server del ticket
        const userGuilds = req.user.guilds || [];
        const hasAccess = userGuilds.some(guild => guild.id === ticket.guild_id);
        
        if (!hasAccess) {
            return res.status(403).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Accesso Negato</title>
                    ${globalCSS}
                </head>
                <body>
                    <div class="animated-bg"></div>
                    <div class="main-container">
                        <div style="text-align: center; padding: 100px;">
                            <h1>❌ Accesso Negato</h1>
                            <p>Non hai i permessi per accedere a questa chat.</p>
                            <a href="/transcripts" class="btn">Torna ai Transcript</a>
                        </div>
                    </div>
                </body>
                </html>
            `);
        }

        // Recupera i messaggi esistenti - CORREZIONE: usa CAST anche qui
        const messagesResult = await db.query(
        'SELECT * FROM messages WHERE ticket_id::text = $1 ORDER BY timestamp ASC',
        [ticket.id.toString()]
    );

        const messages = messagesResult.rows;

        // HTML per la chat live con interfaccia Discord-like
        res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat Live - Ticket ${ticket.id}</title>
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
            --background: #36393f;
            --channel-sidebar: #2f3136;
            --server-sidebar: #202225;
            --text-primary: #ffffff;
            --text-secondary: #b9bbbe;
            --text-muted: #72767d;
            --border: #40444b;
            --message-hover: #32353b;
            --success: #00ff88;
        }

        body {
            background: var(--background);
            color: var(--text-primary);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            height: 100vh;
            overflow: hidden;
            position: relative;
        }

        .app-container {
            display: flex;
            height: 100vh;
            position: relative;
            z-index: 2;
        }

        /* Server Sidebar */
        .server-sidebar {
            width: 72px;
            background: var(--server-sidebar);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 12px 0;
            gap: 8px;
        }

        .server-icon {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            cursor: pointer;
            transition: border-radius 0.2s ease;
        }

        .server-icon:hover {
            border-radius: 16px;
        }

        /* Channel Sidebar */
        .channel-sidebar {
            width: 240px;
            background: var(--channel-sidebar);
            display: flex;
            flex-direction: column;
        }

        .server-header {
            padding: 16px;
            border-bottom: 1px solid var(--border);
            font-weight: 600;
            font-size: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .channels-section {
            padding: 16px;
        }

        .section-title {
            color: var(--text-muted);
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            margin-bottom: 8px;
        }

        .channel-item {
            padding: 6px 8px;
            border-radius: 4px;
            cursor: pointer;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
        }

        .channel-item:hover {
            background: var(--message-hover);
            color: var(--text-primary);
        }

        .channel-item.active {
            background: var(--primary-dark);
            color: var(--text-primary);
        }

        /* Main Chat Area */
        .chat-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: var(--background);
        }

        .chat-header {
            padding: 16px;
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
        }

        .chat-header i {
            color: var(--text-muted);
        }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .message {
            display: flex;
            gap: 16px;
            padding: 4px 16px;
            border-radius: 4px;
            transition: background 0.1s ease;
        }

        .message:hover {
            background: var(--message-hover);
        }

        .message-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            flex-shrink: 0;
        }

        .message-content {
            flex: 1;
            min-width: 0;
        }

        .message-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }

        .message-author {
            font-weight: 600;
            font-size: 16px;
        }

        .message-timestamp {
            color: var(--text-muted);
            font-size: 12px;
        }

        .message-text {
            font-size: 16px;
            line-height: 1.4;
            word-wrap: break-word;
        }

        .staff-badge {
            background: var(--primary);
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }

        /* Input Area */
        .input-area {
            padding: 16px;
            background: var(--background);
            border-top: 1px solid var(--border);
        }

        .input-container {
            background: var(--channel-sidebar);
            border-radius: 8px;
            padding: 16px;
        }

        .message-input {
            width: 100%;
            background: transparent;
            border: none;
            color: var(--text-primary);
            font-size: 16px;
            font-family: 'Inter', sans-serif;
            resize: none;
            outline: none;
            max-height: 200px;
            min-height: 20px;
        }

        .message-input::placeholder {
            color: var(--text-muted);
        }

        .input-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 8px;
        }

        .action-buttons {
            display: flex;
            gap: 8px;
        }

        .action-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            transition: color 0.2s ease;
        }

        .action-btn:hover {
            color: var(--text-primary);
        }

        .send-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.2s ease;
        }

        .send-btn:hover {
            background: var(--primary-dark);
        }

        .send-btn:disabled {
            background: var(--border);
            cursor: not-allowed;
        }

        /* Back Button */
        .back-btn {
            position: fixed;
            top: 20px;
            left: 20px;
            background: var(--primary);
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
        }

        .back-btn:hover {
            background: var(--primary-dark);
        }

        /* Loading and Empty States */
        .loading {
            text-align: center;
            padding: 40px;
            color: var(--text-muted);
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-muted);
        }

        .empty-state i {
            font-size: 3rem;
            margin-bottom: 16px;
            color: var(--border);
        }

        /* Scrollbar */
        .messages-container::-webkit-scrollbar {
            width: 8px;
        }

        .messages-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .messages-container::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: 4px;
        }

        .messages-container::-webkit-scrollbar-thumb:hover {
            background: var(--text-muted);
        }

        .user-badge {
          background: var(--success);
          color: #000;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .server-sidebar {
                display: none;
            }
            
            .channel-sidebar {
                width: 200px;
            }
        }
    </style>
</head>
<body>
    <div class="animated-bg"></div>
    <div class="main-container">
        <a href="/transcripts" class="back-btn">
            <i class="fas fa-arrow-left"></i>
            Torna ai Ticket
        </a>

        <div class="app-container">
            <!-- Server Sidebar -->
            <div class="server-sidebar">
                <div class="server-icon">
                    <i class="fas fa-ticket-alt"></i>
                </div>
            </div>

            <!-- Channel Sidebar -->
            <div class="channel-sidebar">
                <div class="server-header">
                    <i class="fas fa-comments"></i>
                    Chat Ticket
                </div>
                <div class="channels-section">
                    <div class="section-title">Ticket Info</div>
                    <div class="channel-item active">
                        <i class="fas fa-hashtag"></i>
                        #ticket-${ticket.id}
                    </div>
                    <div class="channel-item">
                        <i class="fas fa-user"></i>
                        Utente: ${ticket.user_id}
                    </div>
                    <div class="channel-item">
                        <i class="fas fa-tag"></i>
                        Tipo: ${ticket.ticket_type}
                    </div>
                    <div class="channel-item">
                        <i class="fas fa-clock"></i>
                        Aperto: ${new Date(ticket.created_at).toLocaleDateString('it-IT')}
                    </div>
                </div>
            </div>

            <!-- Main Chat Area -->
            <div class="chat-area">
                <div class="chat-header">
                    <i class="fas fa-hashtag"></i>
                    Chat Live - Ticket ${ticket.id}
                </div>

                <div class="messages-container" id="messagesContainer">
                    ${messages.length === 0 ? `
                        <div class="empty-state">
                            <i class="fas fa-comments"></i>
                            <h3>Nessun messaggio ancora</h3>
                            <p>Inizia la conversazione inviando un messaggio!</p>
                        </div>
                    ` : messages.map(msg => `
                        <div class="message" data-message-id="${msg.id}">
                            <div class="message-avatar">
                                ${msg.username.charAt(0).toUpperCase()}
                            </div>
                            <div class="message-content">
                                <div class="message-header">
                                    <span class="message-author">${msg.username}</span>
                                    ${msg.is_staff ? '<span class="staff-badge">STAFF</span>' : '<span class="user-badge">UTENTE</span>'}
                                    <span class="message-timestamp">${new Date(msg.timestamp).toLocaleString('it-IT')}</span>
                                </div>
                                <div class="message-text">${msg.content}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="input-area">
                    <div class="input-container">
                        <textarea 
                            class="message-input" 
                            id="messageInput" 
                            placeholder="Scrivi un messaggio in #ticket-${ticket.id}"
                            rows="1"
                        ></textarea>
                        <div class="input-actions">
                            <div class="action-buttons">
                                <button class="action-btn" title="Aggiungi emoji">
                                    <i class="far fa-smile"></i>
                                </button>
                                <button class="action-btn" title="Allega file">
                                    <i class="fas fa-plus"></i>
                                </button>
                            </div>
                            <button class="send-btn" id="sendButton" disabled>
                                <i class="fas fa-paper-plane"></i>
                                Invia
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
    const ticketId = '${ticket.id}';
    const channelId = '${ticket.channel_id}';
    let chatInterval = null;

    // Elementi DOM
    const messagesContainer = document.getElementById('messagesContainer');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    // ✅ CORREZIONE 1: Auto-resize e abilitazione pulsante
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        
        // ✅ Abilita/disabilita pulsante invio CORRETTAMENTE
        sendButton.disabled = this.value.trim() === '';
        
        // ✅ Aggiorna visivamente il pulsante
        if (sendButton.disabled) {
            sendButton.style.opacity = '0.6';
            sendButton.style.cursor = 'not-allowed';
        } else {
            sendButton.style.opacity = '1';
            sendButton.style.cursor = 'pointer';
        }
    });

    // ✅ CORREZIONE 2: Invio messaggio con Enter (SENZA Shift)
    messageInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // ✅ IMPEDISCE ANDATA A CAPO
            if (!sendButton.disabled) {
                sendMessage();
            }
        }
    });

    // ✅ CORREZIONE 3: Invio messaggio con click
    sendButton.addEventListener('click', function() {
        if (!sendButton.disabled) {
            sendMessage();
        }
    });

    // ✅ CORREZIONE 4: Funzione migliorata per caricare messaggi
    async function loadMessages() {
        try {
            console.log('🔄 Caricamento messaggi per ticket:', ticketId);
            
            // ✅ CORRETTO: sintassi fixata - senza template literals problematici
            const response = await fetch('/api/ticket/' + ticketId + '/messages');
            
            if (!response.ok) {
                throw new Error('Errore HTTP: ' + response.status);
            }
            
            const messages = await response.json();
            console.log('✅ Trovati ' + messages.length + ' messaggi');
            displayMessages(messages);
        } catch (error) {
            console.error('❌ Errore caricamento messaggi:', error);
        }
    }

    // ✅ CORREZIONE 5: Mostra messaggi nell'interfaccia (STAFF + UTENTE)
    function displayMessages(messages) {
        if (messages.length === 0) {
            messagesContainer.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><h3>Nessun messaggio ancora</h3><p>Inizia la conversazione inviando un messaggio!</p></div>';
            return;
        }
    
        messagesContainer.innerHTML = messages.map(function(msg) {
            const isStaff = msg.is_staff;
            const badge = isStaff ? '<span class="staff-badge">STAFF</span>' : '<span class="user-badge">UTENTE</span>';
            const avatarColor = isStaff ? 'var(--primary)' : 'var(--success)';
            
            return '<div class="message" data-message-id="' + msg.id + '">' +
                   '<div class="message-avatar" style="background: ' + avatarColor + '">' + msg.username.charAt(0).toUpperCase() + '</div>' +
                   '<div class="message-content">' +
                   '<div class="message-header">' +
                   '<span class="message-author">' + msg.username + '</span>' +
                   badge +
                   '<span class="message-timestamp">' + new Date(msg.timestamp).toLocaleString('it-IT') + '</span>' +
                   '</div>' +
                   '<div class="message-text">' + msg.content + '</div>' +
                   '</div>' +
                   '</div>';
        }).join('');
    
        // Scroll automatico all'ultimo messaggio
        scrollToBottom();
    }

    // ✅ CORREZIONE 6: Funzione migliorata per inviare messaggi
    async function sendMessage() {
        const message = messageInput.value.trim();
        
        if (!message || sendButton.disabled) {
            return;
        }
        
        try {
            // Salva il testo prima di disabilitare
            const messageToSend = message;
            
            // ✅ Disabilita input durante l'invio
            messageInput.disabled = true;
            sendButton.disabled = true;
            sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Invio...';
            sendButton.style.opacity = '0.6';
            sendButton.style.cursor = 'not-allowed';

            console.log('📨 Invio messaggio:', messageToSend);
            
            const response = await fetch('/api/ticket/send-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ticketId: ticketId,
                    channelId: channelId,
                    message: messageToSend
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // ✅ Pulisci input e reset
                messageInput.value = '';
                messageInput.style.height = 'auto';
                
                // ✅ Ricarica messaggi immediatamente
                await loadMessages();
                
                console.log('✅ Messaggio inviato con successo');
            } else {
                alert('❌ Errore nell\\'invio del messaggio: ' + (result.error || 'Errore sconosciuto'));
            }
        } catch (error) {
            console.error('❌ Errore invio messaggio:', error);
            alert('❌ Errore di connessione durante l\\'invio');
        } finally {
            // ✅ Riabilita input CORRETTAMENTE
            messageInput.disabled = false;
            sendButton.disabled = true; // Inizialmente disabilitato
            sendButton.innerHTML = '<i class="fas fa-paper-plane"></i> Invia';
            sendButton.style.opacity = '0.6';
            sendButton.style.cursor = 'not-allowed';
            
            // ✅ Rimetti il focus sull'input
            messageInput.focus();
        }
    }

    // ✅ CORREZIONE 7: Scroll automatico in fondo
    function scrollToBottom() {
        setTimeout(function() {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    }

    // ✅ CORREZIONE 8: Aggiornamento in tempo reale MIGLIORATO
    function startChatUpdates() {
        // Carica immediatamente
        loadMessages();
        
        // ✅ Aggiorna ogni 3 secondi (più frequente)
        chatInterval = setInterval(loadMessages, 3000);
        
        console.log('🔄 Aggiornamento chat attivato (3s)');
    }

    function stopChatUpdates() {
        if (chatInterval) {
            clearInterval(chatInterval);
            chatInterval = null;
            console.log('⏹️ Aggiornamento chat fermato');
        }
    }

    // ✅ CORREZIONE 9: Gestione visibilità pagina
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            stopChatUpdates();
        } else {
            startChatUpdates();
        }
    });

    // ✅ CORREZIONE 10: Inizializzazione MIGLIORATA
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 Inizializzazione chat live per ticket:', ticketId);
        
        // Avvia aggiornamenti
        startChatUpdates();
        
        // Focus sull'input
        messageInput.focus();
        
        // Scroll iniziale in fondo
        scrollToBottom();
        
        console.log('✅ Chat live inizializzata correttamente');
    });

    // ✅ CORREZIONE 11: Gestione chiusura pagina
    window.addEventListener('beforeunload', function() {
        stopChatUpdates();
    });
</script>
</body>
</html>
        `);
    } catch (error) {
        console.error('❌ Errore chat live:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Errore Chat</title>
                ${globalCSS}
            </head>
            <body>
                <div class="animated-bg"></div>
                <div class="main-container">
                    <div style="text-align: center; padding: 100px;">
                        <h1>❌ Errore Caricamento Chat</h1>
                        <p>Si è verificato un errore durante il caricamento della chat.</p>
                        <a href="/transcripts" class="btn">Torna ai Transcript</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

// === SISTEMA NOTIFICHE ===
async function getUnreadNotifications(guildId = null) {
    try {
        let query = `
            SELECT t.id, t.guild_id, t.channel_id, t.ticket_type, t.user_id, 
                   COUNT(m.id) as unread_count,
                   MAX(m.timestamp) as last_activity
            FROM tickets t
            LEFT JOIN messages m ON t.id::text = m.ticket_id 
                AND m.timestamp > COALESCE(t.last_viewed, t.created_at)
                AND m.is_staff = false
            WHERE t.status = 'open'
        `;
        
        const params = [];
        if (guildId) {
            query += ' AND t.guild_id = $1';
            params.push(guildId);
        }
        
        query += ' GROUP BY t.id, t.guild_id, t.channel_id, t.ticket_type, t.user_id';
        
        const result = await db.query(query, params);
        
        let totalUnread = 0;
        const notifications = result.rows.map(row => {
            const unread = parseInt(row.unread_count) || 0;
            totalUnread += unread;
            return {
                ticketId: row.id,
                guildId: row.guild_id,
                channelId: row.channel_id,
                ticketType: row.ticket_type,
                userId: row.user_id,
                unreadCount: unread,
                lastActivity: row.last_activity
            };
        });

        return {
            totalUnread,
            notifications
        };
    } catch (error) {
        console.error('❌ Errore recupero notifiche:', error);
        return { totalUnread: 0, notifications: [] };
    }
}

async function markTicketAsViewed(ticketId) {
    try {
        await db.query(
            'UPDATE tickets SET last_viewed = NOW() WHERE id = $1',
            [ticketId]
        );
        return true;
    } catch (error) {
        console.error('❌ Errore marcatura ticket come letto:', error);
        return false;
    }
}

// === ROTTA TRANSCRIPT ONLINE MIGLIORATA ===
app.get('/transcripts/:identifier', (req, res) => {
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
    ${globalCSS}
</head>
<body>
    <div class="animated-bg"></div>
    <div class="main-container">
        <div style="text-align: center; padding: 50px;">
            <h1>🔍 Transcript Non Trovato</h1>
            
            <div style="background: #faa81a; color: #000; padding: 15px; border-radius: 8px; margin: 20px 0; font-weight: 600;">
                ⚠️ Il transcript richiesto non è stato trovato nel sistema
            </div>
            
            <p>Il transcript <span style="color: #5865F2;">${identifier}</span> non esiste o non è più disponibile.</p>
            
            <div style="background: #2f3136; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; max-width: 800px; margin-left: auto; margin-right: auto; font-family: monospace;">
                <strong>🔧 Informazioni di Debug:</strong><br><br>
                <strong>Identifier cercato:</strong> ${identifier}<br>
                <strong>Cartella transcripts:</strong> ${transcriptDir}<br>
                <strong>Stato cartella:</strong> ${folderInfo}<br>
                <strong>File .html trovati:</strong> ${fileCount}<br>
                <strong>Server:</strong> ${process.env.RENDER_EXTERNAL_URL || 'Local'}<br>
                <strong>Tempo:</strong> ${new Date().toLocaleString('it-IT')}<br><br>
                
                <strong>📁 File disponibili (${fileCount}):</strong>
                <div style="background: #36393f; padding: 15px; border-radius: 5px; margin: 10px 0; text-align: left; max-height: 300px; overflow-y: auto;">
                    ${allFilesList.length > 0 ? 
                        allFilesList.map(file => `
                            <div style="padding: 5px 0; border-bottom: 1px solid #40444b;">
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
                <a href="/" class="btn" style="background: #2f3136; color: #b9bbbe;">🏠 Torna alla Home</a>
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
        </div>
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
                ${globalCSS}
            </head>
            <body>
                <div class="animated-bg"></div>
                <div class="main-container">
                    <div style="text-align: center; padding: 100px;">
                        <h1>❌ Accesso Negato ai Transcript</h1>
                        <p>Non hai i permessi necessari per accedere alla sezione transcript.</p>
                        
                        <div style="background: #2f3136; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
                            <h3>🔒 Come ottenere l'accesso:</h3>
                            <p>Per accedere ai transcript, devi avere uno dei <strong>ruoli consentiti</strong> configurati con il comando:</p>
                            
                            <div style="background: #36393f; padding: 10px; border-radius: 5px; font-family: monospace; margin: 10px 0;">
                                /allowedroles set ruoli: ID_RUOLO1, ID_RUOLO2
                            </div>
                            
                            <p><strong>Oppure</strong> essere un <strong>amministratore del server</strong> Discord.</p>
                            
                            <p><strong>I ruoli consentiti sono gli stessi che possono usare i comandi del bot!</strong></p>
                            
                            <p>Contatta un amministratore del server para essere aggiunto ai ruoli autorizzati.</p>
                        </div>
                        
                        <div>
                            <a href="/" class="btn">🏠 Torna alla Home</a>
                            <a href="/logout" class="btn">🚪 Logout</a>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Errore controllo permessi:', error);
        return res.status(500).send('Errore interno del server');
    }
}

// === DASHBOARD MODERNA ===
app.get('/dashboard', checkStaffRole, async (req, res) => {
    try {
        const userGuilds = req.user.guilds || [];
        const accessibleGuilds = [];
        const notifications = await getUnreadNotifications();

        // Trova tutti i server dove l'utente ha accesso + dove il bot è presente
        for (const guild of userGuilds) {
            const botGuild = client.guilds.cache.get(guild.id);
            if (!botGuild) continue;

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
                    const guildNotifications = await getUnreadNotifications(guild.id);
                    accessibleGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
                        memberCount: guild.approximate_member_count || 'N/A',
                        botPresent: true,
                        unreadCount: guildNotifications.totalUnread
                    });
                }
            } else {
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                if (isAdmin) {
                    const guildNotifications = await getUnreadNotifications(guild.id);
                    accessibleGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
                        memberCount: guild.approximate_member_count || 'N/A',
                        botPresent: true,
                        unreadCount: guildNotifications.totalUnread
                    });
                }
            }
        }

        if (accessibleGuilds.length === 0) {
            return res.status(403).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Nessun Accesso</title>
                    ${globalCSS}
                </head>
                <body>
                    <div class="animated-bg"></div>
                    <div class="main-container">
                        <div style="text-align: center; padding: 100px;">
                            <h1>❌ Nessun Server Accessibile</h1>
                            <p>Non hai i permessi per gestire ticket in nessun server.</p>
                            <a href="/" style="color: #5865F2;">Torna alla Home</a>
                        </div>
                    </div>
                </body>
                </html>
            `);
        }

        const header = generateHeader(req);
        
        res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - .gg/shaderss</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
        ${globalCSS}
        
        .dashboard-header {
            text-align: center;
            padding: 4rem 0 2rem;
        }
        
        .dashboard-title {
            font-size: 3rem;
            font-weight: 700;
            background: linear-gradient(135deg, #ffffff 0%, var(--primary) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 1rem;
        }
        
        .dashboard-subtitle {
            color: var(--text-secondary);
            font-size: 1.2rem;
            margin-bottom: 3rem;
        }
        
        .servers-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin: 3rem 0;
        }
        
        .server-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 2rem;
            transition: all 0.3s ease;
            position: relative;
            cursor: pointer;
        }
        
        .server-card:hover {
            transform: translateY(-8px);
            border-color: var(--primary);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }
        
        .server-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        
        .server-icon {
            width: 60px;
            height: 60px;
            border-radius: 12px;
            object-fit: cover;
        }
        
        .default-icon {
            width: 60px;
            height: 60px;
            border-radius: 12px;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5rem;
        }
        
        .server-info {
            flex: 1;
        }
        
        .server-name {
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
        }
        
        .server-meta {
            display: flex;
            gap: 1rem;
            color: var(--text-secondary);
            font-size: 0.9rem;
        }
        
        .server-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-top: 1.5rem;
        }
        
        .stat {
            text-align: center;
            padding: 1rem;
            background: var(--surface);
            border-radius: 8px;
        }
        
        .stat-number {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--primary);
            margin-bottom: 0.25rem;
        }
        
        .stat-label {
            font-size: 0.8rem;
            color: var(--text-secondary);
        }
        
        .notification-badge {
            background: var(--error);
            color: white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.7rem;
            font-weight: 600;
            position: absolute;
            top: 1rem;
            right: 1rem;
        }
        
        .nav-notification-badge {
            background: var(--error);
            color: white;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.6rem;
            font-weight: 600;
            margin-left: 0.5rem;
        }
        
        .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-secondary);
        }
        
        .empty-state i {
            font-size: 4rem;
            margin-bottom: 1rem;
            color: var(--border);
        }
    </style>
</head>
<body>
    <div class="animated-bg"></div>
    <div class="main-container">
    ${header}

    <div class="container">
        <div class="dashboard-header">
            <h1 class="dashboard-title">Dashboard</h1>
            <p class="dashboard-subtitle">Gestisci i ticket e le notifiche dei tuoi server</p>
        </div>

        <div class="servers-grid">
            ${accessibleGuilds.map(guild => `
                <div class="server-card" onclick="selectServer('${guild.id}')">
                    ${guild.unreadCount > 0 ? `<div class="notification-badge">${guild.unreadCount}</div>` : ''}
                    
                    <div class="server-header">
                        ${guild.icon ? 
                            `<img src="${guild.icon}" class="server-icon" alt="${guild.name}">` : 
                            `<div class="default-icon"><i class="fas fa-server"></i></div>`
                        }
                        <div class="server-info">
                            <div class="server-name">${guild.name}</div>
                            <div class="server-meta">
                                <span><i class="fas fa-users"></i> ${guild.memberCount} membri</span>
                                <span><i class="fas fa-robot"></i> Bot Online</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="server-stats">
                        <div class="stat">
                            <div class="stat-number">${guild.unreadCount}</div>
                            <div class="stat-label">Notifiche</div>
                        </div>
                        <div class="stat">
                            <div class="stat-number"><i class="fas fa-ticket-alt"></i></div>
                            <div class="stat-label">Ticket Attivi</div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>

        ${accessibleGuilds.length === 0 ? `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>Nessun server disponibile</h3>
                <p>Non hai accesso a nessun server con il bot attivo.</p>
            </div>
        ` : ''}
    </div>

    <script>
        function selectServer(guildId) {
            window.location.href = '/dashboard/' + guildId;
        }
        
        // Aggiorna notifiche in tempo reale
        async function updateNotifications() {
            try {
                const response = await fetch('/api/notifications');
                const data = await response.json();
                
                if (data.success) {
                    const badge = document.getElementById('globalNotificationBadge');
                    if (data.totalUnread > 0) {
                        badge.textContent = data.totalUnread;
                        badge.style.display = 'flex';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            } catch (error) {
                console.error('Errore aggiornamento notifiche:', error);
            }
        }
        
        // Aggiorna ogni 30 secondi
        setInterval(updateNotifications, 30000);
        updateNotifications();
    </script>
</div>
</body>
</html>
        `);
    } catch (error) {
        console.error('❌ Errore nella dashboard:', error);
        res.status(500).send('Errore interno del server');
    }
});

// === ROTTA COMPLETA PER GESTIONE TICKET ===
app.get('/dashboard/:guildId', checkStaffRole, async (req, res) => {
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
            position: relative;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            position: relative;
            z-index: 2;
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
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin: 3rem 0;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
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
<div class="animated-bg"></div>
<div class="main-container">
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

                <!-- Stats Section -->
                <section class="container">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number" id="totalTicketsCount">-</div>
                            <div class="stat-label">Ticket Gestiti</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" id="uniqueUsersCount">-</div>
                            <div class="stat-label">Utenti Serviti</div>
                        </div>
                    </div>
                </section>
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
                                <a href="/chat/${ticket.id}" target="_blank" class="btn btn-respond">
                                    <i class="fas fa-comments"></i> Chat Live
                                </a>
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

    <script>
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
    </script>
</div>
</body>
</html>`;

        res.send(html);

    } catch (error) {
        console.error('❌ Errore nel caricamento gestione ticket:', error);
        res.status(500).send('Errore interno del server');
    }
});

// === DEBUG DATABASE TICKETS ===
app.get('/debug-tickets', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 10');
        res.json({
            totalTickets: result.rows.length,
            tickets: result.rows
        });
    } catch (error) {
        res.json({ error: error.message });
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
                ${globalCSS}
            </head>
            <body>
                <div class="animated-bg"></div>
                <div class="main-container">
                    <div style="padding: 20px;">
                        <h1>🔍 Debug Permessi - ${userInfo.username}</h1>
                        
                        ${userInfo.guilds.map(guild => `
                            <div style="background: #2f3136; margin: 10px 0; padding: 15px; border-radius: 8px; border-left: 5px solid ${guild.hasAccess ? '#00ff88' : '#ed4245'};">
                                <h3>${guild.name} ${guild.hasAccess ? '✅' : '❌'}</h3>
                                <p><strong>ID:</strong> ${guild.id}</p>
                                <p><strong>Admin:</strong> ${guild.isAdmin ? '✅' : '❌'}</p>
                                
                                <p><strong>Ruoli utente:</strong><br>
                                ${guild.userRoles.map(roleId => `<span style="display: inline-block; background: #5865F2; padding: 2px 8px; border-radius: 4px; margin: 2px; font-size: 0.9em;">${roleId}</span>`).join('') || 'Nessun ruolo'}</p>
                                
                                <p><strong>Ruoli consentiti:</strong><br>
                                ${guild.allowedRoles ? guild.allowedRoles.map(roleId => 
                                    `<span style="display: inline-block; background: #00ff88; color: black; padding: 2px 8px; border-radius: 4px; margin: 2px; font-size: 0.9em; ${guild.userRoles.includes(roleId) ? 'border: 2px solid #5865F2;' : ''}">${roleId}</span>`
                                ).join('') : 'Nessun ruolo consentito'}</p>
                                
                                <p><strong>Accesso transcript:</strong> ${guild.hasAccess ? '✅ CONSENTITO' : '❌ NEGATO'}</p>
                            </div>
                        `).join('')}
                        
                        <br>
                        <a href="/" style="color: #5865F2;">← Torna alla Home</a>
                    </div>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Errore debug:', error);
        res.status(500).json({ error: error.message });
    }
});

// === FUNZIONE HELPER PER HEADER ===
function generateHeader(req) {
    return `
        <header class="modern-header">
            <div class="container">
                <div class="nav-container">
                    <div class="logo">.gg/shaderss</div>
                    <nav class="nav-links">
                        <a href="/" class="nav-link">Home</a>
                        <a href="/dashboard" class="nav-link">
                            Dashboard
                            <span class="notification-badge" id="globalNotificationBadge" style="display: none;">0</span>
                        </a>
                    </nav>
                    <div class="user-section">
                        <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                             class="user-avatar" alt="Avatar">
                        <span style="color: var(--text-secondary);">${req.user.username}</span>
                        <a href="/logout" class="btn btn-outline" style="margin-left: 1rem;">
                            <i class="fas fa-sign-out-alt"></i> Logout
                        </a>
                    </div>
                </div>
            </div>
        </header>
    `;
}

// === HOMEPAGE ===
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
    <title>.gg/shaderss • Advanced Discord Bot</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
        ${globalCSS}
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 20px;
        }

        /* Header Moderno */
        .modern-header {
            background: var(--surface);
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 1000;
            backdrop-filter: blur(20px);
        }

        .nav-container {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
        }

        .logo {
            font-size: 1.5rem;
            font-weight: 700;
            background: var(--gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .nav-links {
            display: flex;
            gap: 2rem;
            align-items: center;
        }

        .nav-link {
            color: var(--text-secondary);
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s ease;
            position: relative;
        }

        .nav-link:hover {
            color: var(--text-primary);
        }

        .nav-link::after {
            content: '';
            position: absolute;
            bottom: -5px;
            left: 0;
            width: 0;
            height: 2px;
            background: var(--gradient);
            transition: width 0.3s ease;
        }

        .nav-link:hover::after {
            width: 100%;
        }

        .user-section {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 2px solid var(--primary);
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
            font-size: 0.9rem;
        }

        .btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(88, 101, 242, 0.3);
        }

        .btn-outline {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text-primary);
        }

        .btn-outline:hover {
            background: var(--primary-light);
            border-color: var(--primary);
        }

        /* Hero Section */
        .hero {
            padding: 6rem 0 4rem;
            text-align: center;
            position: relative;
        }

        .hero::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: radial-gradient(ellipse at center, rgba(88, 101, 242, 0.1) 0%, transparent 70%);
            pointer-events: none;
        }

        .hero-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            background: var(--primary-light);
            color: var(--primary);
            border-radius: 50px;
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            border: 1px solid rgba(88, 101, 242, 0.2);
        }

        .hero-title {
            font-size: 3.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, #ffffff 0%, var(--text-secondary) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 1rem;
            line-height: 1.1;
        }

        .hero-subtitle {
            font-size: 1.25rem;
            color: var(--text-secondary);
            margin-bottom: 2.5rem;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }

        .hero-actions {
            display: flex;
            gap: 1rem;
            justify-content: center;
            margin-bottom: 3rem;
        }


        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 2rem;
            margin: 3rem 0;
            max-width: 700px;
            margin-left: auto;
            margin-right: auto;
        }

        .stat-card {
            background: var(--card-bg);
            padding: 2rem;
            border-radius: 12px;
            border: 1px solid var(--border);
            text-align: center;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--gradient);
        }

        .stat-card:hover {
            transform: translateY(-5px);
            border-color: var(--primary);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            background: var(--gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .stat-label {
            color: var(--text-secondary);
            font-size: 0.9rem;
            font-weight: 500;
        }

        /* Features Grid */
        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin: 4rem 0;
        }

        .feature-card {
            background: var(--card-bg);
            padding: 2rem;
            border-radius: 12px;
            border: 1px solid var(--border);
            transition: all 0.3s ease;
        }

        .feature-card:hover {
            transform: translateY(-5px);
            border-color: var(--primary);
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
        }

        .feature-icon {
            width: 60px;
            height: 60px;
            background: var(--primary-light);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1.5rem;
            color: var(--primary);
            font-size: 1.5rem;
        }

        .feature-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--text-primary);
        }

        .feature-description {
            color: var(--text-secondary);
            line-height: 1.6;
        }

        /* Status Section */
        .status-section {
            background: var(--surface);
            border-radius: 16px;
            padding: 3rem;
            margin: 4rem 0;
            border: 1px solid var(--border);
        }

        .status-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
        }

        .status-title {
            font-size: 1.5rem;
            font-weight: 600;
        }

        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
        }

        .status-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
            border-bottom: 1px solid var(--border-light);
        }

        .status-item:last-child {
            border-bottom: none;
        }

        .status-label {
            color: var(--text-secondary);
            font-weight: 500;
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

        /* Footer */
        .footer {
            background: var(--surface);
            border-top: 1px solid var(--border);
            padding: 3rem 0;
            margin-top: 4rem;
        }

        .footer-content {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 3rem;
        }

        .footer-section h3 {
            margin-bottom: 1rem;
            color: var(--text-primary);
        }

        .footer-links {
            list-style: none;
        }

        .footer-links li {
            margin-bottom: 0.5rem;
        }

        .footer-links a {
            color: var(--text-secondary);
            text-decoration: none;
            transition: color 0.3s ease;
        }

        .footer-links a:hover {
            color: var(--primary);
        }

        .footer-bottom {
            text-align: center;
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid var(--border);
            color: var(--text-muted);
        }

        /* Responsive */
        @media (max-width: 768px) {
            .hero-title {
                font-size: 2.5rem;
            }
            
            .nav-container {
                flex-direction: column;
                gap: 1rem;
            }
            
            .nav-links {
                gap: 1rem;
            }
            
            .hero-actions {
                flex-direction: column;
                align-items: center;
            }
            
            .status-header {
                flex-direction: column;
                gap: 1rem;
                text-align: center;
            }
        }
    </style>
</head>
<body>
    <div class="animated-bg"></div>
    <div class="main-container">
        <!-- Header -->
        <header class="modern-header">
            <div class="container">
                <div class="nav-container">
                    <div class="logo">.gg/shaderss</div>
                    <nav class="nav-links">
                        <a href="/" class="nav-link">Home</a>
                        <a href="/transcripts" class="nav-link">Transcript</a>
                        <a href="/debug-permissions" class="nav-link">Debug</a>
                    </nav>
                    <div class="user-section">
                        <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                             class="user-avatar" alt="Avatar">
                        <a href="/logout" class="btn btn-outline">
                            <i class="fas fa-sign-out-alt"></i> Logout
                        </a>
                    </div>
                </div>
            </div>
        </header>

        <!-- Hero Section -->
        <section class="hero">
            <div class="container">
                <div class="hero-badge">
                    <i class="fas fa-robot"></i>
                    Advanced Discord Bot
                </div>
                <h1 class="hero-title">Gestione Ticket Avanzata</h1>
                <p class="hero-subtitle">
                    Sistema di ticketing professionale con transcript automatici, 
                    chat live e moderazione integrata per la tua community Discord.
                </p>
                <div class="hero-actions">
                    <a href="/transcripts" class="btn">
                        <i class="fas fa-file-alt"></i> Gestisci Transcript
                    </a>
                    <a href="https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID || 'IL_TUO_CLIENT_ID'}&scope=bot+applications.commands&permissions=8" 
                       class="btn btn-outline" target="_blank">
                        <i class="fas fa-plus"></i> Invita Bot
                    </a>
                </div>
            </div>
        </section>

        <!-- Stats Section -->
        <section class="container">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number" id="totalTicketsCount">0</div>
                    <div class="stat-label">Ticket Gestiti</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="uniqueUsersCount">0</div>
                    <div class="stat-label">Utenti Serviti</div>
                </div>
            </div>
        </section>

        <!-- Features Section -->
        <section class="container">
            <div class="features-grid">
                <div class="feature-card">
                    <div class="feature-icon">
                        <i class="fas fa-ticket-alt"></i>
                    </div>
                    <h3 class="feature-title">Sistema Ticket</h3>
                    <p class="feature-description">
                        Gestione ticket avanzata con categorie personalizzabili, 
                        chiusura automatica e transcript dettagliati.
                    </p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">
                        <i class="fas fa-comments"></i>
                    </div>
                    <h3 class="feature-title">Chat Live</h3>
                    <p class="feature-description">
                        Interfaccia di chat in tempo reale per comunicare con 
                        gli utenti direttamente dal pannello web.
                    </p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">
                        <i class="fas fa-shield-alt"></i>
                    </div>
                    <h3 class="feature-title">Moderazione</h3>
                    <p class="feature-description">
                        Tool di moderazione completi con log dettagliati e 
                        sistema di ruoli avanzato per lo staff.
                    </p>
                </div>
            </div>
        </section>

        <!-- Status Section -->
        <section class="container">
            <div class="status-section">
                <div class="status-header">
                    <h2 class="status-title">Stato Sistema</h2>
                    <div class="status-badge" id="globalStatus">
                        <span class="status-value status-online">ONLINE</span>
                    </div>
                </div>
                <div class="status-grid">
                    <div class="status-item">
                        <span class="status-label">Stato Bot</span>
                        <span class="status-value status-online" id="botStatus">ONLINE</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Ping</span>
                        <span class="status-value" id="botPing">- ms</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Server</span>
                        <span class="status-value" id="botGuilds">-</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Uptime</span>
                        <span class="status-value" id="botUptime">-</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- Footer -->
        <footer class="footer">
            <div class="container">
                <div class="footer-content">
                    <div class="footer-section">
                        <h3>.gg/shaderss</h3>
                        <p style="color: var(--text-secondary);">
                            Bot Discord avanzato per la gestione di community 
                            con strumenti professionali per moderazione e supporto.
                        </p>
                    </div>
                    <div class="footer-section">
                        <h3>Link Rapidi</h3>
                        <ul class="footer-links">
                            <li><a href="/">Home</a></li>
                            <li><a href="/transcripts">Transcript</a></li>
                            <li><a href="/debug-permissions">Debug</a></li>
                            <li><a href="/auth/discord">Login</a></li>
                        </ul>
                    </div>
                    <div class="footer-section">
                        <h3>Supporto</h3>
                        <ul class="footer-links">
                            <li><a href="https://discord.gg/shaderss" target="_blank">Server Discord</a></li>
                            <li><a href="/health">Status</a></li>
                            <li><a href="/api/status">API Status</a></li>
                        </ul>
                    </div>
                </div>
                <div class="footer-bottom">
                    <p>&copy; 2024 .gg/shaderss • Powered by sasa111</p>
                </div>
            </div>
        </footer>

        <script>
            async function updateStatus() {
                try {
                    console.log('🔄 Aggiornamento status...');
                    
                    // Aggiorna status bot
                    const statusRes = await fetch('/api/status');
                    const statusData = await statusRes.json();
                    
                    console.log('📡 Dati status:', statusData);
                    
                    if (statusData.bot.status === 'ONLINE') {
                        document.getElementById('botStatus').className = 'status-value status-online';
                        document.getElementById('botStatus').textContent = 'ONLINE';
                        document.getElementById('globalStatus').innerHTML = '<span class="status-value status-online">SISTEMA ONLINE</span>';
                    } else {
                        document.getElementById('botStatus').className = 'status-value status-offline';
                        document.getElementById('botStatus').textContent = 'OFFLINE';
                        document.getElementById('globalStatus').innerHTML = '<span class="status-value status-offline">SISTEMA OFFLINE</span>';
                    }
                    
                    document.getElementById('botPing').textContent = (statusData.bot.ping || 'N/A') + ' ms';
                    document.getElementById('botGuilds').textContent = statusData.bot.guilds || '0';
                    document.getElementById('botUptime').textContent = statusData.bot.uptime || '0h 0m 0s';
    
                    // Aggiorna statistiche ticket
                    const statsRes = await fetch('/api/stats');
                    const statsData = await statsRes.json();
                    
                    console.log('📊 Dati statistiche:', statsData);
                    
                    document.getElementById('totalTicketsCount').textContent = statsData.totalTickets || '0';
                    document.getElementById('uniqueUsersCount').textContent = statsData.uniqueUsers || '0';
                    
                } catch(e) {
                    console.error('❌ Errore aggiornamento status:', e);
                    document.getElementById('botStatus').className = 'status-value status-offline';
                    document.getElementById('botStatus').textContent = 'OFFLINE';
                    document.getElementById('globalStatus').innerHTML = '<span class="status-value status-offline">ERRORE CONNESSIONE</span>';
                    
                    // Valori di fallback
                    document.getElementById('totalTicketsCount').textContent = '0';
                    document.getElementById('uniqueUsersCount').textContent = '0';
                }
            }
    
            // Aggiorna immediatamente e poi ogni 10 secondi
            document.addEventListener('DOMContentLoaded', function() {
                updateStatus();
                setInterval(updateStatus, 10000);
                
                // Animazioni
                const cards = document.querySelectorAll('.feature-card, .stat-card');
                cards.forEach((card, index) => {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(20px)';
                    
                    setTimeout(() => {
                        card.style.transition = 'all 0.6s ease';
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, index * 100);
                });
            });
        </script>
    </div>
</body>
</html>
    `);
});

// === DEBUG COMPLETO DATABASE ===
app.get('/debug-db', async (req, res) => {
    try {
        const tickets = await db.query('SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as users FROM tickets');
        const openTickets = await db.query('SELECT COUNT(*) as open FROM tickets WHERE status = $1', ['open']);
        
        res.json({
            database: 'Connesso',
            totalTickets: tickets.rows[0].total,
            uniqueUsers: tickets.rows[0].users,
            openTickets: openTickets.rows[0].open,
            tables: {
                tickets: tickets.rows[0],
                open: openTickets.rows[0]
            }
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

// === API STATUS MIGLIORATA ===
app.get('/api/status', (req, res) => {
    try {
        const botUptime = process.uptime();
        const hours = Math.floor(botUptime / 3600);
        const minutes = Math.floor((botUptime % 3600) / 60);
        const seconds = Math.floor(botUptime % 60);

        let botStatus = 0;
        let statusText = 'OFFLINE';

        // CONTROLLO MIGLIORATO del bot status
        if (client && client.isReady()) {
            botStatus = 1;
            statusText = 'ONLINE';
        } else if (client && client.ws.status === 0) {
            botStatus = 1;
            statusText = 'ONLINE';
        } else {
            botStatus = 0;
            statusText = 'OFFLINE';
        }

        res.json({
            bot: {
                status: statusText,
                statusCode: botStatus,
                tag: client?.user?.tag || 'Bot Offline',
                uptime: `${hours}h ${minutes}m ${seconds}s`,
                rawUptime: botUptime,
                guilds: client?.guilds?.cache?.size || 0,
                ping: client?.ws?.ping || 'N/A',
                lastUpdate: new Date().toISOString(),
                isReady: client?.isReady() || false,
                wsStatus: client?.ws?.status || 'N/A'
            },
            server: {
                status: 'ONLINE',
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
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
                timestamp: new Date().toISOString()
            }
        });
    }
});

// === API CHIUSURA TICKET ===
app.post('/api/ticket/close', checkStaffRole, async (req, res) => {
    try {
        const { ticketId, reason } = req.body;
        const username = req.user.username;

        console.log(`🔒 Chiusura ticket ${ticketId} da ${username}: ${reason}`);

        // 1. Trova il ticket
        const ticketResult = await db.query(
            'SELECT * FROM tickets WHERE id::text = $1 OR channel_id = $1',
            [ticketId]
        );
        
        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket non trovato' });
        }

        const ticket = ticketResult.rows[0];

        // 2. Chiudi il ticket nel database
        await db.query(
            'UPDATE tickets SET status = $1, closed_at = NOW(), close_reason = $2 WHERE id = $3',
            ['closed', reason || 'Chiuso dal pannello web', ticket.id]
        );

        // 3. Invia messaggio di chiusura su Discord
        const channel = client.channels.cache.get(ticket.channel_id);
        if (channel) {
            const closeMessage = `🎫 **TICKET CHIUSO**\n\n**Staff:** ${username}\n**Motivo:** ${reason || 'Chiuso dal pannello web'}\n\nIl ticket è stato chiuso.`;
            await channel.send(closeMessage);
            
            // Opzionale: elimina il canale dopo qualche secondo
            setTimeout(async () => {
                try {
                    await channel.delete('Ticket chiuso dal pannello web');
                } catch (deleteError) {
                    console.log('⚠️ Impossibile eliminare il canale:', deleteError.message);
                }
            }, 5000);
        }

        // 4. Marca come letto
        await markTicketAsViewed(ticket.id);

        res.json({ 
            success: true, 
            message: 'Ticket chiuso con successo',
            ticketId: ticket.id
        });

    } catch (error) {
        console.error('❌ Errore chiusura ticket:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// === API NOTIFICHE ===
app.get('/api/notifications', checkStaffRole, async (req, res) => {
    try {
        const guildId = req.query.guildId || null;
        const notifications = await getUnreadNotifications(guildId);
        
        res.json({
            success: true,
            ...notifications,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Errore API notifiche:', error);
        res.json({
            success: false,
            totalUnread: 0,
            notifications: [],
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/notifications/mark-read', checkStaffRole, async (req, res) => {
    try {
        const { ticketId } = req.body;
        const success = await markTicketAsViewed(ticketId);
        
        res.json({
            success: success,
            message: success ? 'Notifiche marcate come lette' : 'Errore'
        });
    } catch (error) {
        console.error('❌ Errore marcatura notifiche:', error);
        res.json({ success: false, error: error.message });
    }
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

// === API STATS ===
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await getTicketStats();
        const liveStats = await getLiveStats();
        
        console.log('📊 Statistiche recuperate:', { ...stats, ...liveStats });
        
        res.json({
            success: true,
            totalTickets: stats.totalTickets || 0,
            uniqueUsers: stats.uniqueUsers || 0,
            openTickets: liveStats.openTickets || 0,
            todayTickets: liveStats.todayTickets || 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Errore API stats:', error);
        
        // Fallback con dati di esempio per debugging
        const fallbackResult = await db.query('SELECT COUNT(*) as count FROM tickets');
        const fallbackCount = parseInt(fallbackResult?.rows[0]?.count) || 0;
        
        res.json({
            success: false,
            totalTickets: fallbackCount,
            uniqueUsers: Math.floor(fallbackCount * 0.8), // Stima
            openTickets: 0,
            todayTickets: 0,
            timestamp: new Date().toISOString(),
            error: error.message
        });
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

        // ✅ AGGIUNGI COLONNA is_staff SE NON ESISTE
        try {
              await db.query(`
                  ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false
              `);
              console.log('✅ Colonna is_staff aggiunta/verificata nella tabella messages');
          } catch (alterError) {
              console.log('ℹ️ Colonna is_staff già esistente o errore:', alterError.message);
          }
          
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

// === EVENTO PER SALVARE MESSAGGI UTENTE ===
client.on('messageCreate', async (message) => {
    try {
        // Ignora messaggi di bot e messaggi non in canali ticket
        if (message.author.bot) return;
        if (!message.channel.isTextBased()) return;

        // Cerca se questo canale è un ticket
        const ticketResult = await db.query(
            'SELECT * FROM tickets WHERE channel_id = $1 AND status = $2',
            [message.channel.id, 'open']
        );

        if (ticketResult.rows.length === 0) return; // Non è un ticket

        const ticket = ticketResult.rows[0];
        
        // ✅ VERIFICA MIGLIORATA: cerca messaggi identici dello STESSO UTENTE negli ultimi 2 secondi
        const existingMessage = await db.query(
            `SELECT * FROM messages 
             WHERE ticket_id = $1 
             AND content = $2 
             AND username = $3 
             AND is_staff = false 
             AND timestamp > NOW() - INTERVAL '2 seconds'`,
            [ticket.id.toString(), message.content, message.author.username]
        );

        if (existingMessage.rows.length > 0) {
            console.log('⚠️ Messaggio utente duplicato, salto il salvataggio:', message.content);
            return;
        }

        // Salva il messaggio dell'utente
        try {
            await db.query(
                'INSERT INTO messages (ticket_id, username, content, is_staff, timestamp) VALUES ($1, $2, $3, $4, NOW())',
                [ticket.id.toString(), message.author.username, message.content, false]
            );
            console.log(`💾 Messaggio UTENTE salvato per ticket ${ticket.id}: ${message.author.username} - "${message.content}"`);
        } catch (columnError) {
            // Se is_staff non esiste, salva senza
            await db.query(
                'INSERT INTO messages (ticket_id, username, content, timestamp) VALUES ($1, $2, $3, NOW())',
                [ticket.id.toString(), message.author.username, message.content]
            );
            console.log(`💾 Messaggio UTENTE salvato (senza is_staff) per ticket ${ticket.id}: ${message.author.username}`);
        }

    } catch (error) {
        console.error('❌ Errore salvataggio messaggio utente:', error);
    }
});

console.log('File index.js caricato completamente');
