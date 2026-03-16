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
      return interaction.reply({ content: '❌ Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }

    const current = queue.currentTrack;
    queue.node.skip();

    return interaction.reply({ content: `⏭️ Skipped **[${current.title}](${current.url})**` });
  },
};
