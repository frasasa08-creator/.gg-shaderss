// pm2-events.js - Gestisce eventi PM2 specifici
const { WebhookClient, EmbedBuilder } = require('discord.js');

class PM2EventNotifier {
  constructor() {
    this.webhook = null;
    
    if (process.env.STATUS_WEBHOOK_URL) {
      try {
        this.webhook = new WebhookClient({ url: process.env.STATUS_WEBHOOK_URL });
        console.log('✅ PM2 Event Notifier inizializzato');
      } catch (error) {
        console.log('❌ Errore webhook PM2:', error.message);
      }
    }
  }

  async sendPM2Event(event, data) {
    if (!this.webhook) return;
    
    try {
      const embed = new EmbedBuilder()
        .setTimestamp()
        .setFooter({ text: `PM2 Event • ${new Date().toLocaleTimeString()}` });

      switch (event) {
        case 'process:exception':
          embed.setTitle('🔴 PM2 - Bot Crashato')
               .setDescription(`**Processo:** ${data.process.name}`)
               .setColor(0xff0000)
               .addFields(
                 { name: 'Errore', value: `\`${data.error.message}\`` },
                 { name: 'Restart Automatico', value: '✅ Attivo' }
               );
          break;

        case 'restart':
          embed.setTitle('🔄 PM2 - Bot Riaviato')
               .setDescription(`**Processo:** ${data.process.name}`)
               .setColor(0x0099ff)
               .addFields(
                 { name: 'Uptime Precedente', value: data.process.pm2_env.uptime || 'N/A' },
                 { name: 'Restart Count', value: `${data.process.pm2_env.restart_time || 0}` }
               );
          break;

        case 'online':
          embed.setTitle('✅ PM2 - Bot Online')
               .setDescription(`**Processo:** ${data.process.name}`)
               .setColor(0x00ff00)
               .addFields(
                 { name: 'PID', value: `${data.process.pid}` },
                 { name: 'Modalità', value: data.process.pm2_env.exec_mode }
               );
          break;

        case 'stop':
          embed.setTitle('⏹️ PM2 - Bot Fermato')
               .setDescription(`**Processo:** ${data.process.name}`)
               .setColor(0xffff00);
          break;

        case 'delete':
          embed.setTitle('🗑️ PM2 - Processo Rimosso')
               .setDescription(`**Processo:** ${data.process.name}`)
               .setColor(0xffa500);
          break;

        default:
          embed.setTitle(`📢 PM2 - ${event}`)
               .setDescription(`**Processo:** ${data.process.name}`)
               .setColor(0x808080);
      }

      await this.webhook.send({ embeds: [embed] });
    } catch (error) {
      console.log('⚠️ Errore invio notifica PM2:', error.message);
    }
  }
}

const notifier = new PM2EventNotifier();

// Esporta gli eventi PM2
module.exports = {
  // Bot crashato
  'process:exception': (data) => {
    notifier.sendPM2Event('process:exception', data);
  },
  
  // Bot riavviato
  'restart': (data) => {
    notifier.sendPM2Event('restart', data);
  },
  
  // Bot online
  'online': (data) => {
    notifier.sendPM2Event('online', data);
  },
  
  // Bot stoppato
  'stop': (data) => {
    notifier.sendPM2Event('stop', data);
  },
  
  // Processo eliminato
  'delete': (data) => {
    notifier.sendPM2Event('delete', data);
  }
};
