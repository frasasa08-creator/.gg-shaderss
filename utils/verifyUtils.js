const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

/**
 * Crea l'embed di verifica
 */
function createVerifyEmbed(title, description, imageUrl, color = 0x0099FF) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setImage(imageUrl)
        .setColor(color)
        .setTimestamp();

    return embed;
}

/**
 * Crea il button di verifica
 */
function createVerifyButton(label = 'Verifica', customId = 'verify_button', style = ButtonStyle.Primary, emoji = '<:discotoolsxyzicon16:1433592187375063132>') {
    const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style);

    if (emoji) {
        button.setEmoji(emoji);
    }

    return button;
}

/**
 * Crea la riga con il button
 */
function createActionRow(button) {
    return new ActionRowBuilder().addComponents(button);
}

module.exports = {
    createVerifyEmbed,
    createVerifyButton,
    createActionRow
};