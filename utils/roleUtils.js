const db = require('./db');

class RoleSystem {
  async assignRole(interaction, roleId) {
    try {
      const member = interaction.member;
      await member.roles.add(roleId);
      
      return {
        success: true,
        message: '✅ Ruolo assegnato con successo!'
      };
    } catch (error) {
      console.error('Errore assegnazione ruolo:', error);
      return {
        success: false,
        message: '❌ Impossibile assegnare il ruolo'
      };
    }
  }

  async setupAutoRole(guildId, roleId, ticketType) {
    await db.query(
      `INSERT INTO auto_roles (guild_id, role_id, ticket_type) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (guild_id, ticket_type) 
       DO UPDATE SET role_id = $2`,
      [guildId, roleId, ticketType]
    );
  }

  async handleTicketRole(ticket) {
    const autoRole = await db.query(
      'SELECT role_id FROM auto_roles WHERE guild_id = $1 AND ticket_type = $2',
      [ticket.guild_id, ticket.ticket_type]
    );

    if (autoRole.rows.length > 0) {
      const guild = client.guilds.cache.get(ticket.guild_id);
      const member = await guild.members.fetch(ticket.user_id);
      await member.roles.add(autoRole.rows[0].role_id);
    }
  }
}

module.exports = new RoleSystem();
