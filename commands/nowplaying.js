const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the currently playing track'),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '❌ Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }

    const track = queue.currentTrack;
    const bar   = queue.node.createProgressBar({ timecodes: true, length: 20 });

    const { createTrackMessage } = require('../src/utils/ui');
    const msgData = createTrackMessage(track, 'Playing');
    
    // Set the progress bar as the message content
    msgData.content = bar;

    return interaction.reply(msgData);
  },
};
