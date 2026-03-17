const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { useMainPlayer } = require("discord-player");
const { searchSpotify } = require("../src/utils/spotify");
const config = require("../config");

// ── Short-lived autocomplete cache ────────────────────────────────────────────
// Stores Spotify track metadata keyed by a short ID so we stay under Discord's
// 100-char autocomplete value limit. Entries expire after 5 minutes.
const _autoCache = new Map();
function cacheTrack(track) {
  const key = `sp_${track.id}`;
  _autoCache.set(key, {
    title: track.name,
    author: track.artists.map((a) => a.name).join(", "),
    thumbnail: track.album?.images?.[0]?.url ?? null,
    url: track.external_urls.spotify,
    duration: msToTimestamp(track.duration_ms),
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return key;
}
function getCached(key) {
  const entry = _autoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _autoCache.delete(key);
    return null;
  }
  return entry;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from Spotify, YouTube and more")
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("Song name or URL")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  // ── Autocomplete ──────────────────────────────────────────────────────────────
  async autocomplete(interaction) {
    const query = interaction.options.getFocused();
    if (!query?.trim()) return interaction.respond([]);
    if (/^(https?:\/\/)/.test(query)) return interaction.respond([]);

    try {
      // Try Spotify first — clean "Title — Artist" format
      const spotifyTracks = await searchSpotify(query, 5);
      if (spotifyTracks.length > 0) {
        return interaction.respond(
          spotifyTracks.map((t) => ({
            name: `${t.name} — ${t.artists.map((a) => a.name).join(", ")}`.slice(
              0,
              100,
            ),
            value: cacheTrack(t), // short key like "sp_abc123" — well under 100 chars
          })),
        );
      }

      // Fallback to YouTube
      const player = useMainPlayer();
      const { QueryType } = require("discord-player");
      const res = await player.search(query, {
        requestedBy: interaction.user,
        searchEngine: QueryType.YOUTUBE_SEARCH,
      });
      if (!res?.hasTracks()) return interaction.respond([]);
      return interaction.respond(
        res.tracks.slice(0, 5).map((t) => ({
          name: `${t.title} — ${t.author}`.slice(0, 100),
          value: t.url,
        })),
      );
    } catch (err) {
      if (!interaction.responded) {
        await interaction.respond([]).catch(() => {});
      }
    }
  },

  // ── Execute ───────────────────────────────────────────────────────────────────
  async execute(client, interaction) {
    const query = interaction.options.getString("query", true);
    const channel = interaction.member?.voice?.channel;

    if (!channel) {
      return interaction.reply({
        content: "❌ You need to be in a voice channel!",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const player = useMainPlayer();
      const { QueryType } = require("discord-player");

      let res;
      let spotifyMeta = null; // will hold { title, author, thumbnail, url, duration }
      const isUrl = /^(https?:\/\/)/.test(query);

      // ── 1. Direct URL ────────────────────────────────────────────────────────
      if (isUrl) {
        res = await player.search(query, { requestedBy: interaction.user });

        // ── 2. Autocomplete-selected Spotify result ──────────────────────────────
      } else if (query.startsWith("sp_")) {
        const cached = getCached(query);

        if (cached) {
          spotifyMeta = cached;
          const ytQuery = `${cached.title} ${cached.author}`;
          res = await player.search(ytQuery, {
            requestedBy: interaction.user,
            searchEngine: QueryType.YOUTUBE_SEARCH,
          });
          console.log(
            "[Spotify cached] →",
            cached.title,
            "by",
            cached.author,
            "| YT tracks:",
            res?.tracks?.length ?? 0,
          );
        }

        // Cache miss (e.g. took too long) — fall back to plain text search
        if (!res?.hasTracks()) {
          res = await player.search(query, {
            requestedBy: interaction.user,
            searchEngine: QueryType.YOUTUBE_SEARCH,
          });
        }

        // ── 3. Plain text query ──────────────────────────────────────────────────
      } else {
        // Search Spotify for metadata
        const spotifyTracks = await searchSpotify(query, 1);

        if (spotifyTracks.length > 0) {
          const t = spotifyTracks[0];
          spotifyMeta = {
            title: t.name,
            author: t.artists.map((a) => a.name).join(", "),
            thumbnail: t.album?.images?.[0]?.url ?? null,
            url: t.external_urls.spotify,
            duration: msToTimestamp(t.duration_ms),
          };

          // Use clean Spotify title+artist to get correct YouTube audio
          const ytQuery = `${t.name} ${t.artists.map((a) => a.name).join(" ")}`;
          res = await player.search(ytQuery, {
            requestedBy: interaction.user,
            searchEngine: QueryType.YOUTUBE_SEARCH,
          });
          console.log(
            "[Spotify meta] →",
            spotifyMeta.title,
            "by",
            spotifyMeta.author,
            "| YT tracks:",
            res?.tracks?.length ?? 0,
          );
        }

        // Fallback: no Spotify result → search YouTube directly
        if (!res?.hasTracks()) {
          console.log("[YouTube fallback]", query);
          spotifyMeta = null;
          res = await player.search(query, {
            requestedBy: interaction.user,
            searchEngine: QueryType.YOUTUBE_SEARCH,
          });
        }
      }

      if (!res || !res.hasTracks()) {
        return interaction.editReply({ content: "❌ No results found." });
      }

      let tracks = [...res.tracks];
      const isPlaylist = res.hasPlaylist();

      if (isPlaylist) {
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
        if (tracks.length > 100) tracks = tracks.slice(0, 100);
      }

      if (!isPlaylist && tracks.length > 1 && !isUrl) {
        tracks = [tracks[0]];
      }

      // Inject Spotify metadata into the track object so ui.js can use it
      if (spotifyMeta && tracks[0]) {
        tracks[0].spotifyInfo = spotifyMeta;
      }

      const queue = player.nodes.create(interaction.guild, {
        metadata: { channel: interaction.channel },
        volume: config.defaultVolume,
        leaveOnEmpty: config.leaveOnEmpty,
        leaveOnEmptyCooldown: config.leaveOnEmptyCooldown,
        leaveOnEnd: false,
        leaveOnStop: false,
        selfDeaf: true,
      });

      try {
        if (!queue.connection) await queue.connect(channel);
      } catch {
        player.nodes.delete(interaction.guildId);
        return interaction.editReply({
          content: "❌ Could not join your voice channel!",
        });
      }

      queue.addTrack(tracks);
      if (!queue.isPlaying()) await queue.node.play();

      const { createTrackMessage } = require("../src/utils/ui");
      if (isPlaylist) {
        return interaction.editReply({
          content: `✅ Added playlist **${res.playlist.title}** (${tracks.length} random tracks) to the queue.`,
        });
      } else {
        const ui = createTrackMessage(tracks[0], "Added to Queue", queue);
        return interaction.editReply({
          ...ui,
        });
      }
    } catch (err) {
      console.error("[play]", err);
      return interaction.editReply({ content: `❌ ${err.message}` });
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function msToTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
