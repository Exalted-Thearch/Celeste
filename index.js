require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const { Player } = require('discord-player');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const fs   = require('fs');
const path = require('path');
const config = require('./config');

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
    quality: 'highestaudio',
    highWaterMark: 1 << 25, // 32MB
    dlChunkSize: 0,
  },
  skipFFmpeg: false
});

(async () => {
  // YouTubei must be registered first — it handles YouTube & YT Music
  await player.extractors.register(YoutubeiExtractor, {
    streamOptions: {
      useClient: 'TVHTML5',
    },
    useYoutubeDL: true,
  });

  // Load specialized extractors
  const { SpotifyExtractor, SoundCloudExtractor } = require('@discord-player/extractor');
  await player.extractors.register(SpotifyExtractor, {
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
  });
  await player.extractors.register(SoundCloudExtractor, {});

  // Load all other remaining extractors
  const { DefaultExtractors } = await import('@discord-player/extractor');
  await player.extractors.loadMulti(DefaultExtractors);

  console.log('✅ Extractors loaded (YouTube, Spotify, SoundCloud, etc.)');
})();

const { createTrackMessage } = require('./src/utils/ui');

// ─── Player Events ────────────────────────────────────────────────────────────
player.events.on('playerStart', (queue, track) => {
  queue.metadata?.channel?.send(createTrackMessage(track));
});

player.events.on('emptyQueue', (queue) => {
  queue.metadata?.channel?.send('✅ Queue finished! Add more songs with `/play`.');
});

player.events.on('error', (queue, error) => {
  console.error('[Player Error]', error);
  
  // Ignore known UDP socket discovery errors from spamming the channel
  if (error.message.includes('Cannot perform IP discovery') || error.message.includes('socket closed')) {
    return;
  }
  
  queue.metadata?.channel?.send(`❌ Player error: ${error.message}`);
});

player.events.on('playerError', (queue, error) => {
  console.error('[Player Error - track]', error);
});

// ─── Load Commands ────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandFiles = fs
  .readdirSync(path.join(__dirname, 'commands'))
  .filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const cmd = require(path.join(__dirname, 'commands', file));
  if (!cmd.data || !cmd.execute) {
    console.warn(`⚠️  Skipping ${file} — missing data or execute`);
    continue;
  }
  client.commands.set(cmd.data.name, cmd);
  console.log(`  ✔ Command loaded: /${cmd.data.name}`);
}

// ─── Load Events ─────────────────────────────────────────────────────────────
const eventFiles = fs
  .readdirSync(path.join(__dirname, 'events'))
  .filter((f) => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(__dirname, 'events', file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(client, ...args));
  } else {
    client.on(event.name, (...args) => event.execute(client, ...args));
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(config.token);
