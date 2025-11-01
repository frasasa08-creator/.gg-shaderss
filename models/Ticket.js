const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
    ticketId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    channelId: { 
        type: String, 
        required: true 
    },
    guildId: { 
        type: String, 
        required: true 
    },
    userId: { 
        type: String, 
        required: true 
    },
    username: { 
        type: String, 
        required: true 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    closedAt: { 
        type: Date 
    },
    status: { 
        type: String, 
        default: 'open',
        enum: ['open', 'closed', 'deleted']
    },
    transcript: [{
        user: String,
        content: String,
        timestamp: { 
            type: Date, 
            default: Date.now 
        }
    }],
    category: {
        type: String,
        default: 'general'
    },
    claimedBy: {
        type: String // ID dello staff che ha preso in carico il ticket
    }
});

// Aggiungi indici per performance
ticketSchema.index({ ticketId: 1 });
ticketSchema.index({ guildId: 1, status: 1 });
ticketSchema.index({ userId: 1 });
ticketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Ticket', ticketSchema);
