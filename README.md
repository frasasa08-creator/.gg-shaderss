# Discord Bot Avanzato

Bot Discord completo con sistema di benvenuto, ticket avanzato e log di moderazione.

## 🚀 Funzionalità

### Sistema Welcome
- **Comando:** `/setup_welcome`
- Immagine di benvenuto personalizzata con avatar utente circolare
- Canali separati per welcome e log di entrata/uscita
- **Comando:** `/test_welcome` per testare l'immagine

### Sistema Ticket Innovativo
- **Comando:** `/ticket_panel`
- Pannello completamente personalizzabile
- Menu dropdown con opzioni illimitate
- Emoji e immagini personalizzabili
- Un ticket per utente alla volta
- Categorie automatiche per ogni tipo di ticket
- Transcript automatico quando si chiude un ticket
- Countdown di chiusura di 5 secondi

### Sistema Log Moderazione
- Log automatici per ban, kick, timeout, cambio ruoli
- Audit log integrato
- Canali separati per ogni tipo di log

## 📋 Requisiti

- Node.js v16 o superiore
- PostgreSQL database (Aiven)
- Discord Bot Token

## 🛠️ Installazione

1. **Clona e installa dipendenze:**
```bash
npm install
```

2. **Configura il file `.env`:**
```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_bot_client_id_here
GUILD_ID=your_guild_id_here

DB_HOST=your_aiven_host_here
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_database_username
DB_PASSWORD=your_database_password
DB_SSL=true
```

3. **Struttura cartelle necessaria:**
```
├── commands/
│   ├── setup_welcome.js
│   ├── test_welcome.js
│   └── ticket_panel.js
├── events/
│   ├── ready.js
│   ├── guildMemberAdd.js
│   ├── guildMemberRemove.js
│   ├── guildAuditLogEntryCreate.js
│   └── messageCreate.js
├── utils/
│   ├── welcomeUtils.js
│   └── ticketUtils.js
├── index.js
├── package.json
└── .env
```

4. **Avvia il bot:**
```bash
npm start
```

## 🎮 Comandi

### `/setup_welcome`
Configura il sistema di benvenuto completo.

**Opzioni:**
- `welcome_channel`: Canale per i messaggi di benvenuto
- `welcome_log_channel`: Canale per i log degli ingressi
- `quit_log_channel`: Canale per i log delle uscite
- `welcome_image`: URL dell'immagine di sfondo

### `/test_welcome`
Genera un'immagine di benvenuto di test per verificare la configurazione.

### `/ticket_panel`
Crea un pannello ticket personalizzato.

**Opzioni:**
- `ticket_log_channel`: Canale per i transcript dei ticket
- `title`: Titolo del pannello
- `description`: Descrizione (usa `\n` per andare a capo)
-