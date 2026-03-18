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
});

const YtDlpWrap = require("yt-dlp-wrap").default;

// Auto-download yt-dlp binary if not present

(async () => {
  // YouTubei must be registered first
  /* await player.extractors.register(YoutubeiExtractor, {
    streamOptions: {
      useClient: "TV",
    },
    ytdlpPath:
      process.platform === "win32" ?
        "C:\\Programming\\yt-dlp\\yt-dlp.exe"
      : "/usr/local/bin/yt-dlp",
    overrideBridgeMode: "yt-dlp",
  });*/

  const { execFile } = require("child_process");
  const { promisify } = require("util");
  const execFileAsync = promisify(execFile);

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
      const args = ["--no-warnings", "-f", "251/250/249/140", "--get-url"];
      if (COOKIES_PATH) args.push("--cookies", COOKIES_PATH);
      args.push(track.url);

      const { stdout } = await execFileAsync(YTDLP_PATH, args);
      const url = stdout.trim().split("\n")[0];
      console.log("[yt-dlp] Got stream for:", track.title);
      return url;
    },
  });

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
player.events.on("playerStart", (queue, track) => {
  console.log(
    `[Player] Started playing: ${track.title} in ${queue.guild.name}`,
  );
  if (queue.metadata) queue.metadata.lastTrack = track;
  const ui = createTrackMessage(track);
  queue.metadata?.channel?.send({ ...ui });
});

player.events.on("emptyQueue", async (queue) => {
  console.log(
    `[Player] Queue finished in ${queue.guild.name}. RepeatMode: ${queue.repeatMode}`,
  );

  // If autoplay is off, notify. If on, attempt a manual fallback recommendation.
  if (queue.repeatMode !== QueueRepeatMode.AUTOPLAY) {
    queue.metadata?.channel?.send(
      "✅ Queue finished! Add more songs with `/play`.",
    );
    return;
  }

  console.log(
    "[Player] Autoplay is enabled, attempting fallback recommendation...",
  );

  const seedTrack =
    queue.history?.currentTrack ||
    queue.metadata?.lastTrack ||
    queue.history?.tracks?.toArray?.()?.at?.(-1);

  if (!seedTrack) {
    console.log("[Player] Autoplay fallback skipped: no seed track available.");
    return;
  }

  const recentPlayed = queue.history?.tracks?.toArray?.()?.slice(-15) || [];
  const seedMeta =
    seedTrack.sourceInfo || seedTrack.metadata?.sourceInfo || null;
  const seedTitle = seedMeta?.title || seedTrack.title;
  const seedAuthor = seedMeta?.author || seedTrack.author;

  const normalizeTitle = (title = "") =>
    title
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(
        /\b(official|video|audio|lyrics?|topic|hq|hd|remaster(?:ed)?|version|sped\s*up|slowed|reverb)\b/g,
        " ",
      )
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const tokenize = (title = "") => {
    const clean = normalizeTitle(title);
    return new Set(clean.split(" ").filter(Boolean));
  };

  const tokenOverlap = (aTitle, bTitle) => {
    const a = tokenize(aTitle);
    const b = tokenize(bTitle);
    if (!a.size || !b.size) return 0;

    let common = 0;
    for (const token of a) {
      if (b.has(token)) common += 1;
    }

    return common / Math.min(a.size, b.size);
  };

  const extractYouTubeVideoId = (url = "") => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) {
        return parsed.pathname.slice(1);
      }
      if (parsed.hostname.includes("youtube.com")) {
        return parsed.searchParams.get("v");
      }
    } catch {
      return null;
    }
    return null;
  };

  const isNearDuplicate = (candidate) => {
    if (!candidate || candidate.url === seedTrack.url) return true;

    const sameTitle =
      normalizeTitle(candidate.title) === normalizeTitle(seedTitle);
    const heavyTitleOverlap = tokenOverlap(candidate.title, seedTitle) >= 0.8;

    const seedDuration = Number(seedTrack.durationMS || 0);
    const candidateDuration = Number(candidate.durationMS || 0);
    const closeDuration =
      seedDuration > 0 &&
      candidateDuration > 0 &&
      Math.abs(seedDuration - candidateDuration) <= 12000;

    const alreadyPlayed = recentPlayed.some(
      (played) => played.url === candidate.url,
    );

    // Reject same name family (covers/reuploads/lyrics edits of the same song)
    const sameSongFamily = heavyTitleOverlap && closeDuration;

    return alreadyPlayed || sameTitle || sameSongFamily;
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
      query: `${seedTitle} ${seedAuthor}`,
      isUrl: false,
      label: "search-seed",
    },
    { query: `${seedAuthor} mix`, isUrl: false, label: "search-mix" },
    {
      query: `${seedAuthor} similar songs`,
      isUrl: false,
      label: "search-similar",
    },
  ];

  try {
    let nextTrack = null;

    for (const source of recommendationSources) {
      const result = await player.search(source.query, {
        requestedBy: seedTrack.requestedBy,
        ...(source.isUrl ? {} : { searchEngine: QueryType.YOUTUBE_SEARCH }),
      });

      if (!result?.hasTracks()) continue;

      nextTrack = result.tracks.find((track) => !isNearDuplicate(track));

      if (nextTrack) {
        console.log(`[Player] Autoplay fallback source: ${source.label}`);
        break;
      }
    }

    if (!nextTrack) {
      console.log(
        "[Player] Autoplay fallback could not find a non-duplicate recommendation.",
      );
      return;
    }

    queue.addTrack(nextTrack);
    if (!queue.isPlaying()) await queue.node.play();

    console.log(`[Player] Autoplay fallback queued: ${nextTrack.title}`);
  } catch (error) {
    console.error("[Player] Autoplay fallback failed:", error.message);
  }
});

player.events.on("error", (queue, error) => {
  console.error("[Player Error]", error);

  // Ignore known UDP socket discovery errors from spamming the channel
  if (
    error.message.includes("Cannot perform IP discovery") ||
    error.message.includes("socket closed")
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
