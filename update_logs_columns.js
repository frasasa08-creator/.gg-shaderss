const { createDatabase } = require('./config/database');

async function updateLogsColumns() {
    try {
        const db = createDatabase();
        
        console.log('🔄 Aggiornamento colonne logs...');
        
        // Aggiungi le nuove colonne per i log separati
        const queries = [
            `ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS role_log_channel_id TEXT`,
            `ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS channel_log_channel_id TEXT`,
            `ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS message_log_channel_id TEXT`
        ];
        
        for (const query of queries) {
            await db.query(query);
            console.log(`✅ Query eseguita: ${query}`);
        }
        
        console.log('✅ Database aggiornato con successo!');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Errore aggiornamento database:', error);
        process.exit(1);
    }
}

updateLogsColumns();