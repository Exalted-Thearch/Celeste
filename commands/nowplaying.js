const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const { createTrackMessage } = require('../src/utils/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the currently playing track'),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '<:xbutton:1484155914780151910> Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const track = queue.currentTrack;
    const ui = createTrackMessage(track, 'Playing', queue);
    
    return interaction.editReply({ ...ui });
  },
};
