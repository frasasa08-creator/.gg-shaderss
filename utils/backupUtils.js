const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const db = require('./db');

class BackupSystem {
  constructor() {
    this.backupDir = path.join(__dirname, '../backups');
  }

  async initialize() {
    await this.ensureBackupDir();
    console.log('✅ Sistema backup inizializzato');
  }

  async ensureBackupDir() {
    try {
      await fs.access(this.backupDir);
    } catch {
      await fs.mkdir(this.backupDir, { recursive: true });
    }
  }

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupDir, `backup-${timestamp}.sql`);
    
    try {
      // Backup del database
      const tables = ['tickets', 'messages', 'guild_settings', 'push_subscriptions'];
      
      let backupSQL = `-- Backup creato il ${new Date().toISOString()}\n\n`;
      
      for (const table of tables) {
        const data = await db.query(`SELECT * FROM ${table}`);
        backupSQL += `-- Dump della tabella ${table}\n`;
        backupSQL += `TRUNCATE TABLE ${table} CASCADE;\n\n`;
        
        for (const row of data.rows) {
          const columns = Object.keys(row).join(', ');
          const values = Object.values(row).map(val => {
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            return val;
          }).join(', ');
          
          backupSQL += `INSERT INTO ${table} (${columns}) VALUES (${values});\n`;
        }
        backupSQL += '\n';
      }
      
      await fs.writeFile(backupFile, backupSQL);
      console.log(`✅ Backup creato: ${backupFile}`);
      
      // Pulisci backup vecchi (mantieni solo ultimi 7)
      await this.cleanOldBackups();
      
      return { success: true, file: backupFile };
    } catch (error) {
      console.error('❌ Errore backup:', error);
      return { success: false, error: error.message };
    }
  }

  async cleanOldBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('.sql'));
      
      if (backupFiles.length > 7) {
        backupFiles.sort();
        const filesToDelete = backupFiles.slice(0, backupFiles.length - 7);
        
        for (const file of filesToDelete) {
          await fs.unlink(path.join(this.backupDir, file));
          console.log(`🗑️ Backup rimosso: ${file}`);
        }
      }
    } catch (error) {
      console.error('Errore pulizia backup:', error);
    }
  }
}

module.exports = new BackupSystem();
