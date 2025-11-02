const fs = require('fs').promises;
const path = require('path');
const db = require('./db');

class I18nSystem {
  constructor() {
    this.locales = {};
    this.defaultLanguage = 'it';
  }

  async initialize() {
    await this.loadLocales();
    await this.createTable();
    console.log('✅ Sistema i18n inizializzato');
  }

  async loadLocales() {
    const localesPath = path.join(__dirname, '../locales');
    
    try {
      const files = await fs.readdir(localesPath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const lang = file.replace('.json', '');
          const content = await fs.readFile(path.join(localesPath, file), 'utf8');
          this.locales[lang] = JSON.parse(content);
        }
      }
    } catch (error) {
      console.error('Errore caricamento lingue:', error);
    }
  }

  async createTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id VARCHAR(20) PRIMARY KEY,
        language VARCHAR(5) DEFAULT 'it',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async setUserLanguage(userId, language) {
    await db.query(
      `INSERT INTO user_preferences (user_id, language) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id) 
       DO UPDATE SET language = $2, updated_at = CURRENT_TIMESTAMP`,
      [userId, language]
    );
  }

  async getUserLanguage(userId) {
    const result = await db.query(
      'SELECT language FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    
    return result.rows.length > 0 ? result.rows[0].language : this.defaultLanguage;
  }

  translate(key, language = null, variables = {}) {
    const lang = language || this.defaultLanguage;
    const keys = key.split('.');
    
    let value = this.locales[lang];
    for (const k of keys) {
      value = value?.[k];
    }
    
    if (!value) {
      console.warn(`Traduzione mancante: ${key} per ${lang}`);
      return key;
    }
    
    // Sostituisci variabili
    return value.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
      return variables[variable] || match;
    });
  }
}

module.exports = new I18nSystem();
