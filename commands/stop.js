const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop music and clear the queue'),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: '❌ Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }

    queue.delete();

    return interaction.reply({ content: '⏹️ Stopped the music and cleared the queue.' });
  },
};
