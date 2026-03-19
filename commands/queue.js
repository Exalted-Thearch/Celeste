const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { useQueue } = require('discord-player');
const config = require('../config');

const PAGE_SIZE = 10;

/**
 * Builds the queue embed + pagination buttons for the given 0-indexed page.
 * Exported so the button handler in ui.js can reuse it.
 */
function buildQueueReply(queue, page) {
  const tracks = queue.tracks.toArray();
  const totalPages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, totalPages - 1));

  const slice = tracks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const upcoming =
    slice.length
      ? slice
          .map(
            (t, i) =>
              `\`${page * PAGE_SIZE + i + 1}.\` [${t.title}](${t.url}) — \`${t.duration}\``,
          )
          .join('\n')
      : '*No more tracks in queue.*';

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: `📑 Queue — Page ${page + 1}/${totalPages}` })
    .setDescription(
      `**Now Playing:**\n[${queue.currentTrack.title}](${queue.currentTrack.url}) — \`${queue.currentTrack.duration}\`\n\n**Up Next:**\n${upcoming}`,
    )
    .setFooter({ text: `${tracks.length} track(s) in queue` });

  // Encode the target page number directly in the customId so the
  // button handler knows which page to navigate to without any state.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_queue_nav:${page - 1}`)
      .setLabel('◀  Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`btn_queue_nav:${page + 1}`)
      .setLabel('Next  ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current music queue')
    .addIntegerOption((o) =>
      o.setName('page').setDescription('Page number').setMinValue(1),
    ),

  async execute(client, interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue?.isPlaying()) {
      return interaction.reply({
        content: '<:xbutton:1484155914780151910> Nothing is playing right now!',
        flags: MessageFlags.Ephemeral,
      });
    }

    const tracks = queue.tracks.toArray();
    const totalPages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
    const pageInput = interaction.options.getInteger('page') ?? 1;
    const page = Math.max(0, Math.min(pageInput - 1, totalPages - 1));

    return interaction.reply(buildQueueReply(queue, page));
  },

  buildQueueReply,
};
