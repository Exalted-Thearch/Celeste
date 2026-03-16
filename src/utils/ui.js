const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const config = require("../../config");

/**
 * Creates a standard V2 Component layout for music playback.
 * Returns the message payload containing 'embeds' and 'components'.
 */
function createTrackMessage(track, state = "Playing") {
  const isPaused = state === "Paused";

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: `🎵 Now ${state}` })
    .setDescription(
      `**[${track.title}](${track.url})**\n\`${track.author}\`  •  \`Duration - ${track.duration}\`\nRequested by ${track.requestedBy}`,
    )
    .setThumbnail(track.thumbnail);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_shuffle")
      .setEmoji("🔀")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_play_pause")
      .setEmoji(isPaused ? "▶️" : "⏸️")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("btn_skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_loop")
      .setEmoji("🔁")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

async function handleButtonInteraction(interaction) {
  const { useQueue } = require("discord-player");
  const queue = useQueue(interaction.guildId);

  if (!queue || !queue.isPlaying()) {
    return interaction.reply({
      content: "❌ Nothing is currently playing.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Must be in the same voice channel to use buttons safely
  if (interaction.member.voice.channelId !== queue.dispatcher?.channel?.id) {
    return interaction.reply({
      content: "❌ You must be in the same voice channel to use these buttons.",
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    switch (interaction.customId) {
      case "btn_play_pause":
        const isPaused = queue.node.isPaused();
        isPaused ? queue.node.setPaused(false) : queue.node.setPaused(true);

        // Update the message with the new state
        const track = queue.currentTrack;
        await interaction.update(
          createTrackMessage(track, isPaused ? "Playing" : "Paused"),
        );
        break;

      case "btn_skip":
        queue.node.skip();
        await interaction.reply({
          content: `✅ Skipped by ${interaction.user}`,
        });
        break;

      case "btn_stop":
        queue.delete();
        await interaction.reply({
          content: `⏹️ Stopped by ${interaction.user}. Cleared queue.`,
        });
        break;

      case "btn_shuffle":
        if (!queue.tracks.size) {
          return interaction.reply({
            content: "❌ The queue is empty!",
            flags: MessageFlags.Ephemeral,
          });
        }
        queue.tracks.shuffle();
        await interaction.reply({
          content: `🔀 Shuffled **${queue.tracks.size}** tracks!`,
        });
        break;

      case "btn_loop":
        const { QueueRepeatMode } = require("discord-player");
        const currentMode = queue.repeatMode;
        // Simple toggle: Off -> Track -> Queue -> Off
        let newMode;
        let modeName;
        if (currentMode === QueueRepeatMode.OFF) {
          newMode = QueueRepeatMode.TRACK;
          modeName = "Track";
        } else if (currentMode === QueueRepeatMode.TRACK) {
          newMode = QueueRepeatMode.QUEUE;
          modeName = "Queue";
        } else {
          newMode = QueueRepeatMode.OFF;
          modeName = "Off";
        }
        queue.setRepeatMode(newMode);
        await interaction.reply({
          content: `🔁 Loop mode set to **${modeName}**`,
        });
        break;

      case "btn_queue_prev":
      case "btn_queue_next":
        // For queue pagination, we grab the page from the message content visually, or rely on a generic re-run.
        // To keep it simple, we just re-run the queue command logic via the client's command handler.
        const cmd = interaction.client.commands.get("queue");
        if (cmd) {
          // Extract page from embed author of the message
          const author = interaction.message.embeds[0]?.author?.name || "";
          const match = author.match(/Page (\d+)/);
          let currentPage = match ? parseInt(match[1]) : 1;

          if (interaction.customId === "btn_queue_prev") currentPage--;
          if (interaction.customId === "btn_queue_next") currentPage++;

          // Ensure page stays within valid range
          if (currentPage < 1) currentPage = 1;

          // Mock the options to pass to the execute function
          interaction.options = { getInteger: () => currentPage };
          // Tell interaction.reply to update instead
          const originalReply = interaction.reply.bind(interaction);
          interaction.reply = interaction.update.bind(interaction);
          await cmd.execute(interaction.client, interaction);
          interaction.reply = originalReply;
        }
        break;
    }
  } catch (err) {
    console.error("[Button Handler Error]", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ Error: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

module.exports = {
  createTrackMessage,
  handleButtonInteraction,
};
