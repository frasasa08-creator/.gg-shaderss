const { Pool } = require('pg');
require('dotenv').config();

// Configurazione database condivisa
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false // Fix per certificati Aiven
    }
};

// Crea una nuova connessione database
function createDatabase() {
    return new Pool(dbConfig);
}

module.exports = { createDatabase, dbConfig };