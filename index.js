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

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// DEBUG: Log delle variabili d'ambiente (rimuovi in produzione)
console.log('🔧 DEBUG Variabili OAuth:');
console.log('CLIENT_ID:', process.env.CLIENT_ID ? 'Presente' : 'Mancante');
console.log('DISCORD_CLIENT_SECRET:', process.env.DISCORD_CLIENT_SECRET ? 'Presente' : 'Mancante');
console.log('RENDER_EXTERNAL_URL:', process.env.RENDER_EXTERNAL_URL || 'Non impostato');
console.log('NODE_ENV:', process.env.NODE_ENV || 'Non impostato');

// Configurazione Passport con URL dinamico e debugging
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

// Configurazione DiscordStrategy con error handling migliorato
const strategy = new DiscordStrategy({
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
        
        // Aggiungi i guilds al profile per i controlli staff
        if (profile.guilds) {
            profile.guilds = profile.guilds;
        }
        
        return done(null, profile);
    } catch (error) {
        console.error('❌ Errore durante autenticazione:', error);
        return done(error, null);
    }
});

// Aggiungi logging per gli eventi della strategy
strategy._oauth2.setAuthMethod('Bearer');
strategy._oauth2._useAuthorizationHeaderForGET = true;

// Override della funzione per il token per aggiungere logging
const originalGetOAuthAccessToken = strategy._oauth2.getOAuthAccessToken.bind(strategy._oauth2);
strategy._oauth2.getOAuthAccessToken = function(code, params, callback) {
    console.log('🔄 Richiesta token OAuth con codice:', code ? 'Presente' : 'Mancante');
    console.log('🔗 URL token:', this._getAccessTokenUrl());
    
    return originalGetOAuthAccessToken(code, params, function(err, accessToken, refreshToken, params) {
        if (err) {
            console.error('❌ Errore ottenimento token OAuth:', err);
            console.error('❌ Dettagli errore:', {
                statusCode: err.statusCode,
                data: err.data
            });
        } else {
            console.log('✅ Token OAuth ottenuto con successo');
        }
        callback(err, accessToken, refreshToken, params);
    });
};

passport.use(strategy);

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
    const publicRoutes = ['/auth/discord', '/auth/discord/callback', '/auth/failure', '/health', '/api/status'];
    
    if (publicRoutes.includes(req.path)) {
        return next();
    }
    
    if (req.isAuthenticated()) {
        return next();
    }
    
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/discord');
}

// Applica il middleware a TUTTE le rotte
app.use(requireAuth);

// === ROTTE DI AUTENTICAZIONE ===
app.get('/auth/discord', (req, res, next) => {
    console.log('🚀 Inizio autenticazione OAuth');
    console.log('🔗 Redirect a Discord OAuth');
    passport.authenticate('discord')(req, res, next);
});

app.get('/auth/discord/callback',
    (req, res, next) => {
        console.log('🔄 Callback OAuth ricevuto');
        console.log('📊 Query parameters:', req.query);
        console.log('❌ Error parameter:', req.query.error);
        
        passport.authenticate('discord', { 
            failureRedirect: '/auth/failure',
            failureMessage: true
        })(req, res, next);
    },
    (req, res) => {
        console.log('✅ Autenticazione completata per:', req.user.username);
        const returnTo = req.session.returnTo || '/';
        delete req.session.returnTo;
        res.redirect(returnTo);
    }
);

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
            
            <p>Verifica che:</p>
            <ul style="text-align: left; display: inline-block;">
                <li>Le variabili d'ambiente siano configurate correttamente</li>
                <li>Il Client Secret sia valido</li>
                <li>Il Callback URL sia impostato correttamente nel Discord Developer Portal</li>
            </ul>
            <br>
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
            
            <p>Verifica che:</p>
            <ul style="text-align: left; display: inline-block;">
                <li>Il bot sia invitato nel server</li>
                <li>I permessi OAuth siano configurati correttamente</li>
                <li>Il callback URL sia impostato correttamente nel Discord Developer Portal</li>
            </ul>
            <br>
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
        req.session.destroy(() => {
            res.redirect('/auth/discord');
        });
    });
});

// ... (il resto del codice rimane uguale, mantenendo tutte le altre route e funzionalità)

// === MIDDLEWARE PER VERIFICA STAFF ===
function checkStaffRole(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/discord');
    }

    const allowedGuilds = process.env.ALLOWED_GUILDS ? process.env.ALLOWED_GUILDS.split(',') : [];
    const staffRoleIds = process.env.STAFF_ROLE_IDS ? process.env.STAFF_ROLE_IDS.split(',') : [];
    
    console.log('👮 Controllo permessi staff per:', req.user.username);
    console.log('🏠 Server consentiti:', allowedGuilds);
    console.log('🎯 Ruoli staff:', staffRoleIds);
    
    const userGuilds = req.user.guilds || [];
    console.log('📋 Server utente:', userGuilds.map(g => ({ id: g.id, name: g.name, permissions: g.permissions })));
    
    const hasAccess = userGuilds.some(guild => {
        const hasGuildAccess = allowedGuilds.includes(guild.id);
        const hasStaffRole = staffRoleIds.some(roleId => 
            guild.roles && guild.roles.includes(roleId)
        );
        const isAdmin = (guild.permissions & 0x8) === 0x8;
        
        console.log(`🔍 Controllo server ${guild.id}:`, {
            hasGuildAccess,
            hasStaffRole,
            isAdmin,
            permissions: guild.permissions
        });
        
        return hasGuildAccess && (hasStaffRole || isAdmin);
    });

    if (hasAccess) {
        console.log('✅ Accesso staff consentito');
        return next();
    } else {
        console.log('❌ Accesso staff negato');
        return res.status(403).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Accesso Negato</title>
                <style>
                    body { background: #1e1f23; color: #ed4245; font-family: sans-serif; text-align: center; padding: 100px; }
                    .btn { display: inline-block; background: #5865F2; color: white; padding: 10px 20px; 
                           border-radius: 8px; text-decoration: none; margin: 10px; }
                </style>
            </head>
            <body>
                <h1>❌ Accesso Negato ai Transcript</h1>
                <p>Non hai i permessi staff necessari per accedere ai transcript.</p>
                <p>Contatta un amministratore se pensi sia un errore.</p>
                <a href="/" class="btn">Torna alla Home</a>
                <a href="/logout" class="btn">Logout</a>
            </body>
            </html>
        `);
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

// ... (mantieni tutto il resto del codice per transcripts, homepage, etc.)

// === ROTTA TRANSCRIPT ONLINE ===
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

// === ROTTA TRANSCRIPT PROTETTA (SOLO STAFF) ===
app.get('/transcripts', checkStaffRole, (req, res) => {
    const transcriptDir = path.join(__dirname, 'transcripts');
    let list = '';

    if (fs.existsSync(transcriptDir)) {
        const files = fs.readdirSync(transcriptDir)
            .filter(f => f.endsWith('.html') && f !== '.gitkeep')
            .sort((a, b) => fs.statSync(path.join(transcriptDir, b)).mtime - fs.statSync(path.join(transcriptDir, a)).mtime);

        list = files.length > 0 ? `
            <div class="transcript-header">
                <h2><i class="fas fa-file-alt"></i> Transcript Archiviati</h2>
                <div class="transcript-stats">
                    <span class="stat"><i class="fas fa-folder"></i> ${files.length} transcript totali</span>
                    <span class="user-info">
                        <img src="${req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                             class="user-avatar" alt="Avatar">
                        ${req.user.username}
                    </span>
                </div>
            </div>
            <div class="transcript-list">
                ${files.map(file => {
                    const name = file.replace('.html', '');
                    const stats = fs.statSync(path.join(transcriptDir, file));
                    const date = new Date(stats.mtime).toLocaleString('it-IT');
                    const size = (stats.size / 1024).toFixed(2);
                    
                    return `
                    <div class="transcript-item">
                        <div class="transcript-info">
                            <div class="transcript-name">
                                <i class="fas fa-ticket-alt"></i>
                                <a href="/transcript/${name}" target="_blank">#${name}</a>
                            </div>
                            <div class="transcript-meta">
                                <span><i class="far fa-clock"></i> ${date}</span>
                                <span><i class="fas fa-weight-hanging"></i> ${size} KB</span>
                            </div>
                        </div>
                        <div class="transcript-actions">
                            <a href="/transcript/${name}" target="_blank" class="btn-view">
                                <i class="fas fa-eye"></i> Visualizza
                            </a>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        ` : `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>Nessun transcript trovato</h3>
                <p>Non ci sono ancora transcript archiviati.</p>
            </div>
        `;
    } else {
        list = '<div class="error-state">Cartella transcript non trovata.</div>';
    }

    res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - Staff Area</title>
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
        
        ${list}
        
        <div style="text-align: center; margin-top: 40px;">
            <a href="/" style="color: var(--primary); text-decoration: none;">
                <i class="fas fa-arrow-left"></i> Torna alla Home
            </a>
        </div>
    </div>
</body>
</html>
    `);
});

// === HOMEPAGE MODERNA (protetta) ===
app.get('/', (req, res) => {
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

        /* Header con info utente */
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

console.log('File index.js caricato completamente');
