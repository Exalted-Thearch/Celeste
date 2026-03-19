require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
} = require("discord.js");
const { Player, QueueRepeatMode, QueryType } = require("discord-player");
const { YoutubeiExtractor } = require("discord-player-youtubei");
const fs = require("fs");
const path = require("path");
const config = require("./config");

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// ─── Discord Player ───────────────────────────────────────────────────────────
const player = new Player(client, {
  ytdlOptions: {
    quality: "highestaudio",
    highWaterMark: 1 << 25, // 32MB
    dlChunkSize: 0,
  },
  skipFFmpeg: false,
  bufferingTimeout: 3000,
});

const YtDlpWrap = require("yt-dlp-wrap").default;

// Auto-download yt-dlp binary if not present

(async () => {
  const { execFile } = require("child_process");

  const YTDLP_PATH =
    process.platform === "win32" ?
      "C:\\Programming\\yt-dlp\\yt-dlp.exe"
    : "/usr/local/bin/yt-dlp";

  const COOKIES_PATH =
    process.platform === "win32" ? null : "/home/ubuntu/Celeste/cookies.txt";

  await player.extractors.register(YoutubeiExtractor, {
    streamOptions: {
      useClient: "TV",
    },
    createStream: async (track) => {
      const { useMainPlayer, QueryType } = require("discord-player");
      const { promisify } = require("util");
      const execFileAsync = promisify(execFile);

      let urlToStream = track.url;

      if (!/youtube\.com|youtu\.be/i.test(urlToStream)) {
        try {
          const p = useMainPlayer();
          const query = `${track.title} ${track.author}`.trim();
          const res = await p.search(query, {
            searchEngine: QueryType.YOUTUBE_SEARCH,
          });
          if (res?.hasTracks()) {
            urlToStream = res.tracks[0].url;
          } else {
            return null;
          }
        } catch (e) {
          return null;
        }
      }

      // Get the CDN URL first
      const args = [
        "--no-warnings",
        "-f",
        "bestaudio[acodec=opus]/bestaudio[acodec=mp4a]/bestaudio/best",
        "--get-url",
      ];
      if (COOKIES_PATH) args.push("--cookies", COOKIES_PATH);
      args.push(urlToStream);

      let cdnUrl;
      try {
        const { stdout } = await execFileAsync(YTDLP_PATH, args);
        cdnUrl = stdout.trim().split("\n")[0];
      } catch (e) {
        console.error(`[yt-dlp] Failed for "${track.title}":`, e.message);
        return null;
      }

      if (!cdnUrl) return null;

      // On AWS: pipe through ffmpeg for stable audio
      // On Windows: return URL directly (no latency issues locally)
      if (process.platform !== "win32") {
        const { spawn } = require("child_process");
        const ffmpeg = spawn(
          "ffmpeg",
          [
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "5",
            "-i",
            cdnUrl,
            "-vn",
            "-acodec",
            "libopus",
            "-b:a",
            "128k",
            "-f",
            "opus",
            "pipe:1",
          ],
          { stdio: ["ignore", "pipe", "ignore"] },
        );

        console.log("[ffmpeg] Piping stream for:", track.title);
        return ffmpeg.stdout;
      }

      console.log("[yt-dlp] Got stream URL for:", track.title);
      return cdnUrl;
    }, // ← closing createStream
  }); // ← closing register

  // Load specialized extractors
  try {
    const {
      SpotifyExtractor,
      SoundCloudExtractor,
    } = require("@discord-player/extractor");

    await player.extractors.register(SpotifyExtractor, {
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret,
    });
    console.log("✅ SpotifyExtractor registered");

    await player.extractors.register(SoundCloudExtractor, {});
    console.log("✅ SoundCloudExtractor registered");
  } catch (err) {
    console.error(
      "❌ Failed to register Spotify/SoundCloud extractor:",
      err.message,
    );
  }

  // Load remaining extractors (skip already registered ones)
  try {
    const { DefaultExtractors } = await import("@discord-player/extractor");
    for (const extractor of DefaultExtractors) {
      if (!player.extractors.store.has(extractor.identifier)) {
        await player.extractors.register(extractor, {});
      }
    }
    console.log("✅ DefaultExtractors loaded");
  } catch (err) {
    console.error("❌ Failed to load DefaultExtractors:", err.message);
  }
})();

const { createTrackMessage } = require("./src/utils/ui");

// ─── Player Events ────────────────────────────────────────────────────────────
player.events.on("playerStart", async (queue, track) => {
  console.log(
    `[Player] Started playing: ${track.title} in ${queue.guild.name}`,
  );
  if (queue.metadata) queue.metadata.lastTrack = track;

  // Spotify playlist tracks often come back with the generic CDN thumbnail
  // instead of real album art. Use title+author search to get the real artwork,
  // since the internal track URL ID doesn't work with the Spotify API directly.
  const isSpotifyTrack = track.extractor?.identifier
    ?.toLowerCase()
    .includes("spotify");
  const hasGenericThumb =
    !track.thumbnail || /scdn\.co\/i\/_global/i.test(track.thumbnail);
  if (isSpotifyTrack && hasGenericThumb) {
    try {
      const { searchSpotify } = require("./src/utils/spotify");
      const results = await searchSpotify(
        `${track.title} ${track.author}`.trim(),
        1,
      );
      const artUrl = results[0]?.album?.images?.[0]?.url;
      if (artUrl) track.thumbnail = artUrl;
    } catch {
      /* non-critical — proceed with whatever thumbnail we have */
    }
  }

  const ui = createTrackMessage(track);
  queue.metadata?.channel?.send({ ...ui });
});

player.events.on("emptyQueue", async (queue) => {
  console.log(
    `[Player] Queue finished in ${queue.guild.name}. Recommend: ${queue.metadata?.recommendEnabled}`,
  );

  if (!queue.metadata?.recommendEnabled) {
    queue.metadata?.channel?.send(
      "✅ Queue finished! Add more songs with `/play`.",
    );
    return;
  }

  console.log("[Radio] Finding recommendation...");

  const seedTrack =
    queue.history?.currentTrack ||
    queue.metadata?.lastTrack ||
    queue.history?.tracks?.toArray?.()?.at?.(-1);

  if (!seedTrack) {
    console.log("[Radio] Skipped: no seed track available.");
    return;
  }

  // ── Build duplicate-detection sets from the FULL history ─────────────────
  const historyTracks = queue.history?.tracks?.toArray?.() || [];

  const playedUrls = new Set([
    seedTrack.url,
    ...historyTracks.map((t) => t.url),
  ]);

  const normalizeTitle = (title = "") =>
    title
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(
        /\b(official|video|audio|lyrics?|topic|hq|hd|remaster(?:ed)?|version|sped\s*up|slowed|reverb|ft\.?|feat\.?)\b/g,
        " ",
      )
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Fingerprint: clean title + 30-second duration bucket
  // Two uploads of the same song will usually share this fingerprint.
  const fingerprint = (t) => {
    const title = normalizeTitle(t.title || "");
    const secs = Math.floor(Number(t.durationMS || 0) / 1000);
    return `${title}|${Math.floor(secs / 30)}`;
  };

  const playedFingerprints = new Set([
    fingerprint(seedTrack),
    ...historyTracks.map(fingerprint),
  ]);

  const tokenize = (title = "") =>
    new Set(normalizeTitle(title).split(" ").filter(Boolean));

  const tokenOverlap = (a, b) => {
    const ta = tokenize(a);
    const tb = tokenize(b);
    if (!ta.size || !tb.size) return 0;
    let common = 0;
    for (const tok of ta) if (tb.has(tok)) common++;
    return common / Math.min(ta.size, tb.size);
  };

  const seedMeta =
    seedTrack.sourceInfo || seedTrack.metadata?.sourceInfo || null;
  const seedTitle = seedMeta?.title || seedTrack.title;
  const seedAuthor = seedMeta?.author || seedTrack.author;

  const isNearDuplicate = (candidate) => {
    if (!candidate) return true;
    // Exact URL already played
    if (playedUrls.has(candidate.url)) return true;
    // Fingerprint match — same song, different channel/upload
    if (playedFingerprints.has(fingerprint(candidate))) return true;
    // Heavy title overlap + similar duration (same song, different name)
    const seedDuration = Number(seedTrack.durationMS || 0);
    const candDuration = Number(candidate.durationMS || 0);
    const closeDuration =
      seedDuration > 0 &&
      candDuration > 0 &&
      Math.abs(seedDuration - candDuration) <= 8000;
    return tokenOverlap(candidate.title, seedTitle) >= 0.75 && closeDuration;
  };

  const extractYouTubeVideoId = (url = "") => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
      if (parsed.hostname.includes("youtube.com"))
        return parsed.searchParams.get("v");
    } catch {
      return null;
    }
    return null;
  };

  const videoId = extractYouTubeVideoId(seedTrack.url);

  const recommendationSources = [
    ...(videoId ?
      [
        {
          query: `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`,
          isUrl: true,
          label: "yt-radio",
        },
        {
          query: `https://www.youtube.com/watch?v=${videoId}&list=RDMM`,
          isUrl: true,
          label: "yt-mix",
        },
      ]
    : []),
    {
      query: `${seedAuthor} popular songs`,
      isUrl: false,
      label: "artist-popular",
    },
    {
      query: `songs similar to ${seedTitle}`,
      isUrl: false,
      label: "seed-similar",
    },
    { query: `${seedAuthor} mix`, isUrl: false, label: "artist-mix" },
  ];

  try {
    let nextTrack = null;

    for (const source of recommendationSources) {
      const result = await player.search(source.query, {
        requestedBy: seedTrack.requestedBy,
        ...(source.isUrl ? {} : { searchEngine: QueryType.YOUTUBE_SEARCH }),
      });

      if (!result?.hasTracks()) continue;

      const candidates = result.tracks.filter((t) => !isNearDuplicate(t));
      if (!candidates.length) continue;

      // For URL-based radio mixes, pick randomly from the first 8 non-duplicates
      // so the same continuation song isn't always picked.
      if (source.isUrl) {
        const pool = candidates.slice(0, 8);
        nextTrack = pool[Math.floor(Math.random() * pool.length)];
      } else {
        nextTrack = candidates[0];
      }

      console.log(`[Radio] Source: ${source.label} → "${nextTrack.title}"`);
      break;
    }

    if (!nextTrack) {
      console.log("[Radio] Could not find a non-duplicate recommendation.");
      queue.metadata?.channel?.send(
        "🎵 Couldn't find a fresh recommendation — add more songs with `/play`!",
      );
      return;
    }

    queue.addTrack(nextTrack);
    if (!queue.isPlaying()) await queue.node.play();
  } catch (error) {
    console.error("[Radio] Recommendation failed:", error.message);
  }
});

player.events.on("error", (queue, error) => {
  console.error("[Player Error]", error);

  // Ignore transient/benign errors that don't affect playback
  if (
    error.message.includes("Cannot perform IP discovery") ||
    error.message.includes("socket closed") ||
    error.code === "EPIPE" ||
    error.message.includes("write EPIPE") ||
    error.code === "ECONNRESET" ||
    error.message.includes("ECONNRESET")
  ) {
    return;
  }

  queue.metadata?.channel?.send(`❌ Player error: ${error.message}`);
});

player.events.on("playerError", (queue, error) => {
  console.error("[Player Error - track]", error);
});

// ─── Load Commands ────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandFiles = fs
  .readdirSync(path.join(__dirname, "commands"))
  .filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const cmd = require(path.join(__dirname, "commands", file));
  if (!cmd.data || !cmd.execute) {
    console.warn(`⚠️  Skipping ${file} — missing data or execute`);
    continue;
  }
  client.commands.set(cmd.data.name, cmd);
}

// ─── Load Events ─────────────────────────────────────────────────────────────
const eventFiles = fs
  .readdirSync(path.join(__dirname, "events"))
  .filter((f) => f.endsWith(".js"));

for (const file of eventFiles) {
  const event = require(path.join(__dirname, "events", file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(client, ...args));
  } else {
    client.on(event.name, (...args) => event.execute(client, ...args));
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(config.token);
