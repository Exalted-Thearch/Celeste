const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
} = require("discord.js");

// SeparatorSpacingSize raw values (not always exported by discord.js)
const SeparatorSpacingSize = { Small: 1, Large: 2 };

const config = require("../../config");

const ICONS = {
  spotify: "<:spotify:1483160867838365706>",
  youtube: "<:ytMusic:1483161271711957114>",
  appleMusic: "<:AppleMusic:1483456769014501406>",
  soundcloud: "<:soundcloud:1483457082022690846>",
};

/**
 *  [🔀] [⏹️] [⏸️ primary] [⏭️] [🔁]
 */
function createTrackMessage(track, state = "Playing", queue = null) {
  const isPaused = state === "Paused";
  const isQueued = state === "Added to Queue";
  const isPlaying = state === "Playing" || isPaused;

  const sourceInfo =
    track.sourceInfo ??
    track.spotifyInfo ??
    track.metadata?.sourceInfo ??
    track.metadata?.spotifyInfo ??
    null;

  const extId = track.extractor?.identifier || "";
  const sourceType = sourceInfo?.source || null;
  const isSpotify = sourceType === "spotify" || extId.includes("spotify");
  const isApple = sourceType === "appleMusic" || extId.includes("apple-music");
  const isSoundCloud =
    sourceType === "soundcloud" || extId.includes("soundcloud");

  const title = sourceInfo?.title || track.title || "Unknown Title";
  const author = sourceInfo?.author || track.author || "Unknown Artist";
  const url = sourceInfo?.url || track.url || null;
  const thumbnail = sourceInfo?.thumbnail || track.thumbnail || null;
  const duration = sourceInfo?.duration || track.duration || null;

  let accentColor = 0xf25858;
  let sourceIcon = ICONS.youtube;
  let sourceName = "YouTube";

  if (isSpotify) {
    accentColor = 0x1db954;
    sourceIcon = ICONS.spotify;
    sourceName = "Spotify";
  } else if (isApple) {
    accentColor = 0xfa243c;
    sourceIcon = ICONS.appleMusic;
    sourceName = "Apple Music";
  } else if (isSoundCloud) {
    accentColor = 0xff3300;
    sourceIcon = ICONS.soundcloud;
    sourceName = "SoundCloud";
  }

  // ── State label (top of card) ─────────────────────────────────────────────────
  // "▸ Now Playing" / "▸ Paused" / "🎵 Added to Queue  `#2`"
  let stateLine;
  if (isQueued && queue) {
    stateLine = `<:vinylrecord:1483465811854229685> **Added to Queue** \`#${queue.tracks.size}\``;
  } else if (isPaused) {
    stateLine = `<:pause1:1484157187633971281> **Paused**`;
  } else {
    stateLine = `<:musicalnote:1483465838026690662> **Now Playing**`;
  } 

  // ── Main section: state / title / artist + thumbnail ─────────────────────────
  // -# prefix = Discord's small muted subtext in Components V2
  const titleLine = url ? `### [${title}](${url})` : `### ${title}`;
  const authorLine = `-# ${author}`;

  const mainSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(stateLine),
    new TextDisplayBuilder().setContent(titleLine),
    new TextDisplayBuilder().setContent(authorLine),
  );

  if (thumbnail) {
    mainSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail));
  }

  // ── Meta line: source · duration · requested by ───────────────────────────────
  const metaParts = [`${sourceIcon} ${sourceName}`];
  if (duration) metaParts.push(`<:clock:1484156954283872416> ${duration}`);
  if (track.requestedBy)
    metaParts.push(
      `<:requestedBy:1484156602083967018> ${track.requestedBy.displayName || track.requestedBy.username || track.requestedBy}`,
    );

  // ── Progress bar (playing/paused only) ────────────────────────────────────────
  let progressBar = null;
  if (isPlaying && queue) {
    try {
      const bar = queue.node.createProgressBar({ timecodes: true, length: 19 });
      if (bar) progressBar = bar;
    } catch {
      /* unavailable — skip silently */
    }
  }

  // ── Assemble container ────────────────────────────────────────────────────────
  const container = new ContainerBuilder().setAccentColor(accentColor);

  // Main content (state + title + artist + thumbnail)
  container.addSectionComponents(mainSection);

  // Thin spacer
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(false),
  );

  // Meta row — muted with -# prefix
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${metaParts.join("  ·  ")}`),
  );

  // Progress bar with a divider above it
  if (progressBar) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`\`${progressBar}\``),
    );
  }

  // ── Playback controls ─────────────────────────────────────────────────────────
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("shuffle")
      .setEmoji("1483467751019380817")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("stop")
      .setEmoji("1483467796418527353")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("pause_resume")
      .setEmoji(isPaused ? "1483468453858906244" : "1483467759114391552")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("skip")
      .setEmoji("1483467742504947824")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("loop")
      .setEmoji("1483467778886467605")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    components: [container, controls],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ── Button handler ────────────────────────────────────────────────────────────
async function handleButtonInteraction(interaction) {
  const { useQueue } = require("discord-player");
  const queue = useQueue(interaction.guildId);

  if (!queue || !queue.isPlaying()) {
    return interaction.reply({
      content: "<:xbutton:1484155914780151910> Nothing is currently playing.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.member.voice.channelId !== queue.dispatcher?.channel?.id) {
    return interaction.reply({
      content: "<:xbutton:1484155914780151910> You must be in the same voice channel to use these buttons.",
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    switch (interaction.customId) {
      case "pause_resume": {
        const isPaused = queue.node.isPaused();
        isPaused ? queue.node.setPaused(false) : queue.node.setPaused(true);
        await interaction.update(
          createTrackMessage(
            queue.currentTrack,
            isPaused ? "Playing" : "Paused",
            queue,
          ),
        );
        break;
      }
      case "skip":
        queue.node.skip();
        await interaction.reply({
          content: `<:skipbutton:1483467742504947824> Skipped by ${interaction.user.displayName}`,
        });
        break;
      case "stop":
        queue.delete();
        await interaction.reply({
          content: `<:stop:1483467796418527353> Stopped by ${interaction.user.displayName}. Cleared queue.`,
        });
        break;
      case "shuffle":
        if (!queue.tracks.size) {
          return interaction.reply({
            content: "<:xbutton:1484155914780151910> The queue is empty!",
            flags: MessageFlags.Ephemeral,
          });
        }
        queue.tracks.shuffle();
        await interaction.reply({
          content: `<:shuffle:1483467751019380817> Shuffled **${queue.tracks.size}** tracks!`,
        });
        break;
      case "loop": {
        const { QueueRepeatMode } = require("discord-player");
        const mode = queue.repeatMode;
        let newMode, modeName;
        if (mode === QueueRepeatMode.OFF) {
          newMode = QueueRepeatMode.TRACK;
          modeName = "Track";
        } else if (mode === QueueRepeatMode.TRACK) {
          newMode = QueueRepeatMode.QUEUE;
          modeName = "Queue";
        } else {
          newMode = QueueRepeatMode.OFF;
          modeName = "Off";
        }
        queue.setRepeatMode(newMode);
        await interaction.reply({
          content: `<:looparrow:1483467778886467605> Loop mode set to **${modeName}**`,
        });
        break;
      }
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

module.exports = { createTrackMessage, handleButtonInteraction };
