const db = require('./db');

class StatsSystem {
  async getGuildStats(guildId) {
    try {
      const [
        ticketStats,
        responseTime,
        popularHours,
        staffPerformance
      ] = await Promise.all([
        this.getTicketStats(guildId),
        this.getAverageResponseTime(guildId),
        this.getPopularHours(guildId),
        this.getStaffPerformance(guildId)
      ]);

      return {
        ticketStats,
        responseTime,
        popularHours,
        staffPerformance,
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Errore statistiche:', error);
      throw error;
    }
  }

  async getTicketStats(guildId) {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_tickets,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tickets,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_tickets,
        COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 END) as today_tickets,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as weekly_tickets,
        AVG(EXTRACT(EPOCH FROM (closed_at - created_at))) as avg_resolution_time_seconds
      FROM tickets 
      WHERE guild_id = $1
    `, [guildId]);

    return result.rows[0];
  }

  async getAverageResponseTime(guildId) {
    const result = await db.query(`
      SELECT 
        ticket_id,
        MIN(timestamp) as first_user_message,
        MIN(CASE WHEN is_staff = true THEN timestamp END) as first_staff_response,
        EXTRACT(EPOCH FROM (
          MIN(CASE WHEN is_staff = true THEN timestamp END) - MIN(timestamp)
        )) as response_time_seconds
      FROM messages 
      WHERE ticket_id IN (SELECT id::text FROM tickets WHERE guild_id = $1)
      GROUP BY ticket_id
      HAVING MIN(CASE WHEN is_staff = true THEN timestamp END) IS NOT NULL
    `, [guildId]);

    const avgResponseTime = result.rows.reduce((acc, row) => acc + parseFloat(row.response_time_seconds), 0) / result.rows.length;
    
    return {
      average_response_seconds: avgResponseTime || 0,
      total_analyzed_tickets: result.rows.length
    };
  }

  async getPopularHours(guildId) {
    const result = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as ticket_count
      FROM tickets 
      WHERE guild_id = $1
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY ticket_count DESC
      LIMIT 6
    `, [guildId]);

    return result.rows;
  }

  async getStaffPerformance(guildId) {
    const result = await db.query(`
      SELECT 
        username,
        COUNT(*) as messages_sent,
        COUNT(DISTINCT ticket_id) as tickets_handled,
        AVG(LENGTH(content)) as avg_message_length
      FROM messages 
      WHERE is_staff = true 
        AND ticket_id IN (SELECT id::text FROM tickets WHERE guild_id = $1)
        AND timestamp >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY username
      ORDER BY messages_sent DESC
      LIMIT 10
    `, [guildId]);

    return result.rows;
  }
}

module.exports = new StatsSystem();
