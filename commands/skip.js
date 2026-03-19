const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '<:xbutton:1484155914780151910> Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }

    const current = queue.currentTrack;
    queue.node.skip();

    return interaction.reply({ content: `<:skipbutton:1483467742504947824> Skipped **[${current.title}](${current.url})**` });
  },
};
