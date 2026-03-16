const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current track'),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '❌ Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }
    if (queue.node.isPaused()) {
      return interaction.reply({ content: '❌ Already paused. Use `/resume` to resume.', flags: MessageFlags.Ephemeral });
    }

    queue.node.pause();

    return interaction.reply({ content: '⏸️ Paused the music.' });
  },
};
