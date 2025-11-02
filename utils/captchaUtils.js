const db = require('./db');
const svgCaptcha = require('svg-captcha');

class CaptchaSystem {
  constructor() {
    this.pendingVerifications = new Map();
  }

  async createTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_verifications (
        user_id VARCHAR(20) PRIMARY KEY,
        attempts INTEGER DEFAULT 0,
        last_attempt TIMESTAMP,
        verified BOOLEAN DEFAULT false
      )
    `);
  }

  generateCaptcha() {
    const captcha = svgCaptcha.create({
      size: 6,
      noise: 3,
      color: true,
      background: '#36393f'
    });
    
    return captcha;
  }

  async verifyUser(userId, answer) {
    const verification = this.pendingVerifications.get(userId);
    
    if (!verification) {
      return { success: false, message: 'Captcha non trovato' };
    }

    if (verification.answer.toLowerCase() === answer.toLowerCase()) {
      this.pendingVerifications.delete(userId);
      await db.query(
        `INSERT INTO user_verifications (user_id, verified) 
         VALUES ($1, true) 
         ON CONFLICT (user_id) 
         DO UPDATE SET verified = true, attempts = 0`,
        [userId]
      );
      return { success: true, message: 'Verifica completata!' };
    } else {
      verification.attempts++;
      if (verification.attempts >= 3) {
        this.pendingVerifications.delete(userId);
        return { success: false, message: 'Troppi tentativi falliti' };
      }
      return { success: false, message: 'Codice errato, riprova' };
    }
  }

  async isUserVerified(userId) {
    const result = await db.query(
      'SELECT verified FROM user_verifications WHERE user_id = $1',
      [userId]
    );
    
    return result.rows.length > 0 && result.rows[0].verified;
  }
}

module.exports = new CaptchaSystem();
