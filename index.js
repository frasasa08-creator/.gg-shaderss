// index.js
const { initializeStatusSystem, detectPreviousCrash, updateBotStatus, updateStatusPeriodically } = require('./utils/statusUtils');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
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

// === ROTTA TRANSCRIPT ONLINE MIGLIORATA ===
app.get('/transcript/:identifier', (req, res) => {
    const identifier = req.params.identifier.toLowerCase();
    const transcriptDir = path.join(__dirname, 'transcripts');
    
    console.log(`🔍 Ricerca transcript: ${identifier}`);
    
    // Cerca il file esatto
    const exactPath = path.join(transcriptDir, `${identifier}.html`);
    
    if (fs.existsSync(exactPath)) {
        console.log(`✅ Transcript trovato: ${identifier}.html`);
        res.setHeader('Content-Type', 'text/html');
        return res.sendFile(exactPath);
    }
    
    // Se non trova il file esatto, cerca file che contengono l'identifier
    try {
        const allFiles = fs.readdirSync(transcriptDir)
            .filter(f => f.endsWith('.html') && f !== '.gitkeep');
        
        console.log(`📁 File disponibili:`, allFiles);
        
        // Cerca file che contengono l'identifier nel nome
        const matchingFiles = allFiles.filter(file => {
            const fileNameWithoutExt = file.replace('.html', '').toLowerCase();
            return fileNameWithoutExt.includes(identifier) || identifier.includes(fileNameWithoutExt);
        });
        
        if (matchingFiles.length > 0) {
            console.log(`✅ Transcript trovato con match parziale: ${matchingFiles[0]}`);
            const filePath = path.join(transcriptDir, matchingFiles[0]);
            res.setHeader('Content-Type', 'text/html');
            return res.sendFile(filePath);
        }
        
        console.log(`❌ Nessun transcript trovato per: ${identifier}`);
        
    } catch (error) {
        console.error('Errore ricerca transcript:', error);
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
        .debug { background: #2f3136; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; font-family: monospace; }
    </style>
</head>
<body>
    <h1>Transcript non trovato</h1>
    <p>Il ticket <span class="discord">#${identifier}</span> non esiste o è stato eliminato.</p>
    
    <div class="debug">
        <strong>Debug Info:</strong><br>
        Identifier cercato: ${identifier}<br>
        Cartella transcripts: ${transcriptDir}<br>
        File .html nella cartella: ${fs.existsSync(transcriptDir) ? fs.readdirSync(transcriptDir).filter(f => f.endsWith('.html')).length : 'Cartella non esistente'}
    </div>
    
    <a href="/transcripts" style="color: #5865F2; text-decoration: none;">← Torna alla lista transcript</a>
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

        // Trova tutti i server dove l'utente ha accesso ai transcript
        for (const guild of userGuilds) {
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
                        memberCount: guild.approximate_member_count || 'N/A'
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
                        memberCount: guild.approximate_member_count || 'N/A'
                    });
                }
            }
        }

        // Se c'è solo un server accessibile, redirect diretto
        if (accessibleGuilds.length === 1) {
            return res.redirect(`/transcripts/${accessibleGuilds[0].id}`);
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
                    <p>Non hai i permessi per visualizzare i transcript in nessun server.</p>
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

        .server-members {
            display: flex;
            align-items: center;
            gap: 5px;
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
            <p>Scegli il server Discord di cui vuoi visualizzare i transcript</p>
            
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

// === ROTTA TRANSCRIPT PER SERVER SPECIFICO MIGLIORATA ===
app.get('/transcripts/:guildId', checkStaffRole, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const userGuilds = req.user.guilds || [];
        
        // Verifica che l'utente abbia accesso a questo server specifico
        const userGuild = userGuilds.find(g => g.id === guildId);
        if (!userGuild) {
            return res.status(403).send('Accesso negato a questo server');
        }

        // Verifica i permessi per questo server specifico
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
            // Se non ci sono impostazioni, solo admin può accedere
            hasAccess = (userGuild.permissions & 0x8) === 0x8;
        }

        if (!hasAccess) {
            return res.status(403).send('Accesso negato a questo server');
        }

        // LEGGI TUTTI I TRANSCRIPT (NON FILTRARE PER SERVER)
        const transcriptDir = path.join(__dirname, 'transcripts');
        let list = '';

        if (fs.existsSync(transcriptDir)) {
            const allFiles = fs.readdirSync(transcriptDir)
                .filter(f => f.endsWith('.html') && f !== '.gitkeep')
                .sort((a, b) => fs.statSync(path.join(transcriptDir, b)).mtime - fs.statSync(path.join(transcriptDir, a)).mtime);

            console.log(`📁 Tutti i file transcript trovati:`, allFiles.length);

            list = allFiles.length > 0 ? `
                <div class="transcript-header">
                    <h2><i class="fas fa-file-alt"></i> Transcript - ${userGuild.name}</h2>
                    <div class="transcript-stats">
                        <span class="stat"><i class="fas fa-folder"></i> ${allFiles.length} transcript totali</span>
                        <span class="stat"><i class="fas fa-server"></i> Server ID: ${guildId}</span>
                        <span class="user-info">
                            <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                                 class="user-avatar" alt="Avatar">
                            ${req.user.username}
                        </span>
                    </div>
                </div>
                
                <div style="background: #2f3136; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #5865F2;">
                    <p style="margin: 0; font-size: 0.9rem; color: #b9bbbe;">
                        <strong>💡 Info:</strong> Mostrando tutti i transcript disponibili. Il sistema di filtraggio per server sarà implementato prossimamente.
                    </p>
                </div>
                
                <div class="transcript-list">
                    ${allFiles.map(file => {
                        const name = file.replace('.html', '');
                        const stats = fs.statSync(path.join(transcriptDir, file));
                        const date = new Date(stats.mtime).toLocaleString('it-IT');
                        const size = (stats.size / 1024).toFixed(2);
                        
                        return `
                        <div class="transcript-item">
                            <div class="transcript-info">
                                <div class="transcript-name">
                                    <i class="fas fa-ticket-alt"></i>
                                    <a href="/transcript/${name}" target="_blank">${name}</a>
                                </div>
                                <div class="transcript-meta">
                                    <span><i class="far fa-clock"></i> ${date}</span>
                                    <span><i class="fas fa-weight-hanging"></i> ${size} KB</span>
                                    <span><i class="fas fa-file"></i> ${file}</span>
                                </div>
                            </div>
                            <div class="transcript-actions">
                                <a href="/transcript/${name}" target="_blank" class="btn-view">
                                    <i class="fas fa-eye"></i> Visualizza
                                </a>
                                <button onclick="copyTranscriptLink('${name}')" class="btn-copy" title="Copia link">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            ` : `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <h3>Nessun transcript trovato</h3>
                    <p>Non ci sono ancora transcript archiviati nel sistema.</p>
                    <div style="margin-top: 15px; padding: 15px; background: var(--border); border-radius: 8px; text-align: left;">
                        <p style="margin: 5px 0;"><strong>Debug Info:</strong></p>
                        <p style="margin: 5px 0; font-size: 0.9rem;">Server ID: ${guildId}</p>
                        <p style="margin: 5px 0; font-size: 0.9rem;">Cartella transcript: ${transcriptDir}</p>
                        <p style="margin: 5px 0; font-size: 0.9rem;">Cartella esistente: ${fs.existsSync(transcriptDir) ? '✅' : '❌'}</p>
                    </div>
                </div>
            `;
        } else {
            list = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Cartella transcript non trovata</h3>
                    <p>La cartella dei transcript non esiste sul server.</p>
                    <p style="margin-top: 10px; font-size: 0.9rem; color: var(--text-secondary);">
                        Path: ${transcriptDir}
                    </p>
                </div>
            `;
        }

        res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - ${userGuild.name}</title>
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
            max-width: 1000px;
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
            margin-bottom: 20px;
            padding: 20px;
            background: var(--card-bg);
            border-radius: 12px;
            border: 1px solid var(--border);
        }

        .server-icon {
            width: 50px;
            height: 50px;
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

        .transcript-header {
            background: var(--card-bg);
            padding: 25px;
            border-radius: 15px;
            margin-bottom: 25px;
            border: 1px solid var(--border);
        }

        .transcript-header h2 {
            color: var(--text-primary);
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .transcript-stats {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
        }

        .stat {
            background: var(--primary);
            color: white;
            padding: 8px 15px;
            border-radius: 8px;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .transcript-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .transcript-item {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.3s ease;
        }

        .transcript-item:hover {
            border-color: var(--primary);
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        }

        .transcript-info {
            flex: 1;
        }

        .transcript-name {
            font-weight: 600;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .transcript-name a {
            color: var(--text-primary);
            text-decoration: none;
        }

        .transcript-name a:hover {
            color: var(--primary);
        }

        .transcript-meta {
            display: flex;
            gap: 20px;
            font-size: 0.85rem;
            color: var(--text-secondary);
        }

        .transcript-meta span {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .transcript-actions {
            display: flex;
            gap: 10px;
        }

        .btn-view {
            background: var(--primary);
            color: white;
            padding: 8px 15px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: background 0.3s ease;
        }

        .btn-view:hover {
            background: var(--primary-dark);
        }

        .btn-copy {
            background: var(--border);
            color: var(--text-primary);
            border: none;
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
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

        .btn-logout {
            background: var(--error);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn-logout:hover {
            background: #d83639;
        }

        .empty-state, .error-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-secondary);
        }

        .empty-state i {
            font-size: 3rem;
            margin-bottom: 20px;
            color: var(--border);
        }

        @media (max-width: 768px) {
            .transcript-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 15px;
            }
            
            .transcript-actions {
                align-self: flex-end;
            }
            
            .transcript-stats {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .transcript-meta {
                flex-direction: column;
                gap: 5px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-shield-alt"></i> Staff Area - Transcript</h1>
            <div class="user-actions">
                <div class="user-info">
                    <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                         class="user-avatar" alt="Avatar">
                    <span>${req.user.username}</span>
                </div>
                <a href="/logout" class="btn-logout">
                    <i class="fas fa-sign-out-alt"></i> Logout
                </a>
            </div>
        </div>

        <div class="server-header">
            ${userGuild.icon ? `<img src="https://cdn.discordapp.com/icons/${userGuild.id}/${userGuild.icon}.png" class="server-icon" alt="${userGuild.name}">` : '<div class="server-icon" style="background: var(--primary); display: flex; align-items: center; justify-content: center; color: white;"><i class="fas fa-server"></i></div>'}
            <div class="server-info">
                <h2>${userGuild.name}</h2>
                <p>ID: ${userGuild.id} ${guildId === '1431629401384026234' ? '<span style="color: var(--success); margin-left: 10px;">(Server Principale)</span>' : ''}</p>
            </div>
        </div>
        
        ${list}
        
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
                // Mostra feedback
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
    </script>
</body>
</html>
        `);
    } catch (error) {
        console.error('❌ Errore nel caricamento transcript server:', error);
        res.status(500).send('Errore interno del server');
    }
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
