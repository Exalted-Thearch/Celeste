const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recommend')
    .setDescription('Auto-recommend similar songs when the queue runs out')
    .addBooleanOption((o) =>
      o.setName('enabled')
        .setDescription('Turn recommendations on or off')
        .setRequired(true),
    ),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({
        content: '<:xbutton:1484155914780151910> Nothing is playing right now!',
        flags: MessageFlags.Ephemeral,
      });
    }

    const enabled = interaction.options.getBoolean('enabled');
    queue.metadata.recommendEnabled = enabled;

    return interaction.reply({
      content: enabled
        ? '<:musicalnote:1483465838026690662> Recommendations **on** — I\'ll queue similar songs when the queue ends!'
        : '<:xbutton:1484155914780151910> Recommendations **off**.',
    });
  },
};
