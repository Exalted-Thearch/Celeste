const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the paused track'),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: '<:xbutton:1484155914780151910> Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }
    if (!queue.node.isPaused()) {
      return interaction.reply({ content: '<:xbutton:1484155914780151910> Music is not paused!', flags: MessageFlags.Ephemeral });
    }

    queue.node.resume();

    return interaction.reply({ content: '<:play:1483468453858906244> Resumed the music.' });
  },
};
