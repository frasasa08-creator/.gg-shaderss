// server.js - SOLO server web
const express = require('express');
const app = express();
const PORT = process.env.PORT;

app.get('/', (req, res) => {
    res.send('🤖 Bot Discord ONLINE - Sito web funzionante!');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        server: 'Web Server Online',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🎉 SERVER WEB AVVIATO SU PORTA ${PORT}`);
});
