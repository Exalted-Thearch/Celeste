const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the upcoming tracks in the queue'),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue?.tracks.size) {
      return interaction.reply({ content: '<:xbutton:1484155914780151910> The queue is empty!', flags: MessageFlags.Ephemeral });
    }

    queue.tracks.shuffle();

    return interaction.reply({ content: `<:shuffle:1483467751019380817> Shuffled **${queue.tracks.size}** tracks!` });
  },
};
