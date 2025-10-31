const { EmbedBuilder } = require('discord.js');

/**
 * Crea l'embed di benvenuto
 */
async function createWelcomeEmbed(user, memberCount, welcomeImageUrl, embedColor = 0xFFFFFF) {
    try {
        // Formatta il numero del membro con suffisso (1st, 2nd, 3rd, etc.)
        const getNumberWithSuffix = (number) => {
            if (number % 100 >= 11 && number % 100 <= 13) return number + 'th';
            switch (number % 10) {
                case 1: return number + 'st';
                case 2: return number + 'nd';
                case 3: return number + 'rd';
                default: return number + 'th';
            }
        };

        const formattedMemberCount = getNumberWithSuffix(memberCount);

        // Crea l'embed
        const embed = new EmbedBuilder()
            .setTitle('WELCOME')
            .setDescription(`Welcome ${user} in Shaderss, you're the ${formattedMemberCount} member!`)
            .setImage(welcomeImageUrl)
            .setColor(embedColor)
            //.setTimestamp();

        return { embeds: [embed] };
        
    } catch (error) {
        console.error('Errore creazione embed welcome:', error);
        throw error;
    }
}

module.exports = {
    createWelcomeEmbed
};
