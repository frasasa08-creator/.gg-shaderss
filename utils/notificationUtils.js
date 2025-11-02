const webpush = require('web-push');
const db = require('./db');

class NotificationSystem {
  constructor() {
    this.vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
    
    webpush.setVapidDetails(
      'mailto:admin@shaderss.gg',
      this.vapidKeys.publicKey,
      this.vapidKeys.privateKey
    );
  }

  async initialize() {
    await this.createTable();
    console.log('✅ Sistema notifiche inizializzato');
  }

  async createTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(20) NOT NULL,
        subscription JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async subscribeUser(userId, subscription) {
    await db.query(
      'INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2)',
      [userId, subscription]
    );
  }

  async notifyStaff(guildId, ticket) {
    const staffSubscriptions = await db.query(
      `SELECT ps.subscription 
       FROM push_subscriptions ps
       JOIN guild_settings gs ON gs.guild_id = $1
       WHERE ps.user_id IN (
         SELECT user_id FROM guild_members 
         WHERE guild_id = $1 AND is_staff = true
       )`,
      [guildId]
    );

    const payload = JSON.stringify({
      title: '🎫 Nuovo Ticket',
      body: `Nuovo ticket ${ticket.ticket_type} da ${ticket.user_id}`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      data: { ticketId: ticket.id, url: `/chat/${ticket.id}` }
    });

    for (const sub of staffSubscriptions.rows) {
      try {
        await webpush.sendNotification(sub.subscription, payload);
      } catch (error) {
        console.error('Errore notifica push:', error);
        // Rimuovi subscription scaduta
        if (error.statusCode === 410) {
          await db.query('DELETE FROM push_subscriptions WHERE subscription = $1', [sub.subscription]);
        }
      }
    }
  }
}

module.exports = new NotificationSystem();
