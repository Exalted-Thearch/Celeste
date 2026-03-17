require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
} = require("discord.js");
const { Player } = require("discord-player");
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

(async () => {
  // YouTubei must be registered first
  await player.extractors.register(YoutubeiExtractor, {
    streamOptions: {
      useClient: 'ANDROID',
    },
    useYoutubeDL: true,
  });

  // Load specialized extractors
  try {
    const { SpotifyExtractor, SoundCloudExtractor } = require('@discord-player/extractor');

    console.log('Spotify ID:', config.spotifyClientId ? '✅ present' : '❌ MISSING');
    console.log('Spotify Secret:', config.spotifyClientSecret ? '✅ present' : '❌ MISSING');

    await player.extractors.register(SpotifyExtractor, {
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret,
    });
    console.log('✅ SpotifyExtractor registered');

    await player.extractors.register(SoundCloudExtractor, {});
    console.log('✅ SoundCloudExtractor registered');
  } catch (err) {
    console.error('❌ Failed to register Spotify/SoundCloud extractor:', err.message);
  }

  // Load remaining extractors (skip already registered ones)
  try {
    const { DefaultExtractors } = await import('@discord-player/extractor');
    for (const extractor of DefaultExtractors) {
      if (!player.extractors.store.has(extractor.identifier)) {
        await player.extractors.register(extractor, {});
      }
    }
    console.log('✅ DefaultExtractors loaded');
  } catch (err) {
    console.error('❌ Failed to load DefaultExtractors:', err.message);
  }

  console.log('Registered extractors:', [...player.extractors.store.keys()]);
})();

const { createTrackMessage } = require("./src/utils/ui");

// ─── Player Events ────────────────────────────────────────────────────────────
player.events.on("playerStart", (queue, track) => {
  console.log(`[Player] Started playing: ${track.title} in ${queue.guild.name}`);
  const ui = createTrackMessage(track);
  queue.metadata?.channel?.send({ ...ui });
});

player.events.on("emptyQueue", (queue) => {
  console.log(`[Player] Queue finished in ${queue.guild.name}. RepeatMode: ${queue.repeatMode}`);
  
  // If autoplay is off, notify. If on, discord-player should be bridging.
  if (queue.repeatMode !== 3) { // 3 is AUTOPLAY
    queue.metadata?.channel?.send(
      "✅ Queue finished! Add more songs with `/play`.",
    );
  } else {
    console.log("[Player] Autoplay is enabled, waiting for bridge...");
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
  console.log(`  ✔ Command loaded: /${cmd.data.name}`);
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
