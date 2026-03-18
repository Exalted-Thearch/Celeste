const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { useMainPlayer } = require("discord-player");
const { searchSpotify, getSpotifyTrack } = require("../src/utils/spotify");
const config = require("../config");

// ── Short-lived autocomplete cache ────────────────────────────────────────────
// Stores Spotify track metadata keyed by a short ID so we stay under Discord's
// 100-char autocomplete value limit. Entries expire after 5 minutes.
const _autoCache = new Map();
const SPOTIFY_SEARCH_TIMEOUT_MS = 1200;
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
      const spotifyTracks = await withTimeout(
        searchSpotify(query, 5),
        SPOTIFY_SEARCH_TIMEOUT_MS,
      );
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
      let sourceMeta = null; // { title, author, thumbnail, url, duration, source
      let forceSingleTrack = false;
      const isUrl = /^(https?:\/\/)/.test(query);

      // ── 1. Direct URL ────────────────────────────────────────────────────────
      if (isUrl) {
        const sourceType = detectUrlSource(query);

        // SoundCloud previews and Apple Music DRM links are unreliable for
        // direct streaming, so we resolve metadata and then play equivalent
        // YouTube audio while preserving original source info in the card.
        if (
          sourceType === "soundcloud" ||
          sourceType === "appleMusic" ||
          sourceType === "spotify"
        ) {
          let seedTrack = null;

          // Extractor lookup first (works well for SoundCloud, sometimes Apple)
          const sourceRes = await player.search(query, {
            requestedBy: interaction.user,
          });
          if (sourceRes?.hasTracks()) {
            seedTrack = sourceRes.tracks[0];
          }

          // Apple Music fallback metadata lookup via iTunes API when extractor
          // cannot resolve the URL.
          if (!seedTrack && sourceType === "appleMusic") {
            const appleMeta = await resolveAppleMusicMetadata(query);
            if (appleMeta) {
              seedTrack = {
                title: appleMeta.title,
                author: appleMeta.author,
                thumbnail: appleMeta.thumbnail,
                duration: appleMeta.duration,
              };
            }
          }

          // Spotify metadata lookup via direct API for more reliable artcovers
          if (sourceType === "spotify") {
            const spotifyId = extractSpotifyId(query);
            if (spotifyId) {
              const spotifyMeta = await getSpotifyTrack(spotifyId);
              if (spotifyMeta) {
                // Prefer API values for high-quality artcover
                seedTrack = {
                  title: spotifyMeta.name,
                  author: spotifyMeta.artists.map((a) => a.name).join(", "),
                  thumbnail: spotifyMeta.album?.images?.[0]?.url ?? null,
                  duration: msToTimestamp(spotifyMeta.duration_ms),
                };
              }
            }
          }

          if (seedTrack) {
            sourceMeta = {
              title: seedTrack.title,
              author: seedTrack.author,
              thumbnail: seedTrack.thumbnail,
              url: query,
              duration: seedTrack.duration,
              source: sourceType,
            };

            const ytQuery = `${seedTrack.title} ${seedTrack.author}`;
            forceSingleTrack = true;
            res = await player.search(ytQuery, {
              requestedBy: interaction.user,
              searchEngine: QueryType.YOUTUBE_SEARCH,
            });
          }

          // Last fallback for any URL that still did not resolve.
          if (!res?.hasTracks()) {
            res = await player.search(query, { requestedBy: interaction.user });
          }
        } else {
          res = await player.search(query, { requestedBy: interaction.user });
        }
        // ── 2. Autocomplete-selected Spotify result ──────────────────────────────
      } else if (query.startsWith("sp_")) {
        const cached = getCached(query);

        if (cached) {
          sourceMeta = { ...cached, source: "spotify" };
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
        const spotifyTracks = await withTimeout(
          searchSpotify(query, 1),
          SPOTIFY_SEARCH_TIMEOUT_MS,
        );

        if (spotifyTracks.length > 0) {
          const t = spotifyTracks[0];
          sourceMeta = {
            title: t.name,
            author: t.artists.map((a) => a.name).join(", "),
            thumbnail: t.album?.images?.[0]?.url ?? null,
            url: t.external_urls.spotify,
            duration: msToTimestamp(t.duration_ms),
            source: "spotify",
          };

          // Use clean Spotify title+artist to get correct YouTube audio
          const ytQuery = `${t.name} ${t.artists.map((a) => a.name).join(" ")}`;
          res = await player.search(ytQuery, {
            requestedBy: interaction.user,
            searchEngine: QueryType.YOUTUBE_SEARCH,
          });
          console.log(
            "[Spotify meta] →",
            sourceMeta.title,
            "by",
            sourceMeta.author,
            "| YT tracks:",
            res?.tracks?.length ?? 0,
          );
        }

        // Fallback: no Spotify result → search YouTube directly
        if (!res?.hasTracks()) {
          console.log("[YouTube fallback]", query);
          sourceMeta = null;
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
      if (!isPlaylist && tracks.length > 1 && (!isUrl || forceSingleTrack)) {
        const bestTrack = pickBestCandidateTrack(tracks, sourceMeta);
        tracks = [bestTrack || tracks[0]];
      }

      // Inject Spotify metadata into the track object so ui.js can use it
      // Normalize displayed duration for URL-derived metadata when source
      // extractors return preview lengths (e.g. SoundCloud 0:30).
      if (sourceMeta && tracks[0]) {
        sourceMeta.duration =
          shouldUseAudioDuration(sourceMeta.duration) ?
            tracks[0].duration
          : sourceMeta.duration;

        tracks[0].sourceInfo = sourceMeta;
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

function shouldUseAudioDuration(value) {
  if (!value) return true;
  return value === "0:30" || value === "0:29" || value === "0:31";
}

function pickBestCandidateTrack(tracks, sourceMeta) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  if (!sourceMeta?.title) return tracks[0];

  const expectedDuration = parseTimestampToSeconds(sourceMeta.duration);
  const targetTokens = buildTokenSet(
    `${sourceMeta.title} ${sourceMeta.author || ""}`,
  );

  const scored = tracks.map((track) => {
    const title = `${track.title || ""}`;
    const author = `${track.author || ""}`;
    const haystack = `${title} ${author}`.toLowerCase();
    const candidateTokens = buildTokenSet(`${title} ${author}`);
    const overlap = jaccard(targetTokens, candidateTokens);

    const trackDuration = parseTimestampToSeconds(track.duration);
    const durationPenalty =
      expectedDuration && trackDuration ?
        Math.min(Math.abs(trackDuration - expectedDuration), 180)
      : 0;

    let score = overlap * 100;
    score -= durationPenalty * 0.2;

    if (
      /\b(lyrics?|lyrical|slowed|reverb|sped\s*up|8d|nightcore|remix|dj|cover)\b/i.test(
        haystack,
      )
    ) {
      score -= 20;
    }

    if (/\b(official\s+audio|topic)\b/i.test(haystack)) {
      score += 8;
    }

    if (/\b(live|performance|concert)\b/i.test(haystack)) {
      score -= 8;
    }

    return { track, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.track || tracks[0];
}

function buildTokenSet(value = "") {
  const cleaned = value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return new Set(cleaned.split(" ").filter(Boolean));
}

function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (!union) return 0;
  return intersection / union;
}

function parseTimestampToSeconds(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function extractSpotifyId(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    // Standard format: /track/ID or /track/ID?si=...
    const trackIndex = segments.indexOf("track");
    if (trackIndex !== -1 && segments[trackIndex + 1]) {
      return segments[trackIndex + 1];
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveAppleMusicMetadata(value) {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const country = segments[0] || "us";

    const queryTrackId = parsed.searchParams.get("i");
    const numericPathId = [...segments]
      .reverse()
      .find((part) => /^\d+$/.test(part));
    const prefixedPathId = segments
      .map((part) => {
        const match = part.match(/^id(\d+)$/);
        return match ? match[1] : null;
      })
      .find(Boolean);

    const lookupId = queryTrackId || prefixedPathId || numericPathId;
    if (!lookupId) return null;

    const response = await fetch(
      `https://itunes.apple.com/lookup?id=${lookupId}&entity=song&country=${country}`,
    );
    if (!response.ok) return null;

    const data = await response.json();
    const song = data?.results?.find((item) => item.wrapperType === "track");
    const collection = data?.results?.find(
      (item) => item.wrapperType === "collection",
    );
    if (!song && !collection) return null;

    const resolved = song || collection;

    return {
      title: resolved.trackName || resolved.collectionName,
      author: resolved.artistName,
      thumbnail: resolved.artworkUrl100?.replace("100x100", "600x600") ?? null,
      duration:
        resolved.trackTimeMillis ?
          msToTimestamp(resolved.trackTimeMillis)
        : null,
    };
  } catch {
    return null;
  }
}

function detectUrlSource(value) {
  try {
    const { hostname } = new URL(value);
    if (hostname.includes("spotify.com") || hostname.includes("open.spotify.com")) return "spotify";
    if (hostname.includes("soundcloud.com")) return "soundcloud";
    if (hostname.includes("music.apple.com")) return "appleMusic";
  } catch {
    return null;
  }
  return null;
}
async function withTimeout(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve([]), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
