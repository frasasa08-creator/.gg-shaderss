const { createCanvas, loadImage, registerFont } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const https = require('https');
const http = require('http');

/**
 * Scarica un'immagine da un URL
 */
async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        
        client.get(url, (response) => {
            if (response.statusCode === 200) {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
            } else {
                reject(new Error(`Failed to download image: ${response.statusCode}`));
            }
        }).on('error', reject);
    });
}

/**
 * Crea un'immagine circolare dall'avatar dell'utente
 */
async function createCircularImage(imageBuffer, size = 150) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Carica l'immagine
    const image = await loadImage(imageBuffer);
    
    // Crea un cerchio
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    
    // Disegna l'immagine nel cerchio
    ctx.drawImage(image, 0, 0, size, size);
    ctx.restore();
    
    return canvas;
}

/**
 * Crea l'immagine di benvenuto
 */
async function createWelcomeImage(user, backgroundImageUrl) {
    try {
        // Dimensioni canvas
        const width = 800;
        const height = 400;
        
        // Crea il canvas
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Scarica e carica l'immagine di sfondo
        const backgroundBuffer = await downloadImage(backgroundImageUrl);
        const backgroundImage = await loadImage(backgroundBuffer);
        
        // Disegna lo sfondo
        ctx.drawImage(backgroundImage, 0, 0, width, height);
        
        // Scarica l'avatar dell'utente
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatarBuffer = await downloadImage(avatarUrl);
        
        // Crea l'avatar circolare
        const circularAvatar = await createCircularImage(avatarBuffer, 150);
        
        // Posiziona l'avatar al centro-alto
        const avatarX = (width - 150) / 2;
        const avatarY = 50;
        ctx.drawImage(circularAvatar, avatarX, avatarY);
        
        // Configura il testo
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        
        // Testo "Welcome"
        ctx.font = 'bold 48px Arial';
        const welcomeY = avatarY + 150 + 60;
        ctx.strokeText('Welcome', width / 2, welcomeY);
        ctx.fillText('Welcome', width / 2, welcomeY);
        
        // Nome utente
        ctx.font = 'bold 36px Arial';
        const usernameY = welcomeY + 50;
        const username = user.globalName || user.username;
        ctx.strokeText(username, width / 2, usernameY);
        ctx.fillText(username, width / 2, usernameY);
        
        // Converti in buffer
        const buffer = canvas.toBuffer('image/png');
        
        // Crea l'attachment
        return new AttachmentBuilder(buffer, { name: 'welcome.png' });
        
    } catch (error) {
        console.error('Errore creazione immagine welcome:', error);
        throw error;
    }
}

module.exports = {
    createWelcomeImage,
    downloadImage,
    createCircularImage
};
