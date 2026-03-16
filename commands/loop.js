const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useQueue, QueueRepeatMode } = require('discord-player');
const config = require('../config');

const MODES = {
  off:      { value: QueueRepeatMode.OFF,      label: 'Off',      emoji: '➡️'  },
  track:    { value: QueueRepeatMode.TRACK,    label: 'Track',    emoji: '🔂'  },
  queue:    { value: QueueRepeatMode.QUEUE,    label: 'Queue',    emoji: '🔁'  },
  autoplay: { value: QueueRepeatMode.AUTOPLAY, label: 'Autoplay', emoji: '♾️'  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the repeat/loop mode')
    .addStringOption((o) =>
      o.setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(
          { name: '➡️  Off',      value: 'off'      },
          { name: '🔂  Track',    value: 'track'    },
          { name: '🔁  Queue',    value: 'queue'    },
          { name: '♾️  Autoplay', value: 'autoplay' },
        ),
    ),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: '❌ Nothing is playing right now!', flags: MessageFlags.Ephemeral });
    }

    const key  = interaction.options.getString('mode');
    const mode = MODES[key];
    queue.setRepeatMode(mode.value);

    return interaction.reply({ content: `${mode.emoji} Loop mode set to **${mode.label}**` });
  },
};
