const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume')
    .addIntegerOption((o) =>
      o.setName('level')
        .setDescription('Volume level (1–100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '❌ Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }

    const vol = interaction.options.getInteger('level');
    queue.node.setVolume(vol);

    const filled = Math.round(vol / 10);
    const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.embedColor)
          .setDescription(`🔊 Volume set to **${vol}%**\n\`${bar}\``),
      ],
    });
  },
};
