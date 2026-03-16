const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useMainPlayer } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube, Spotify, SoundCloud and more')
    .addStringOption((o) =>
      o.setName('query')
        .setDescription('Song name or URL')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  // Autocomplete: suggest top 5 results as the user types
  async autocomplete(interaction) {
    const query = interaction.options.getFocused();
    if (!query?.trim()) return interaction.respond([]);

    // Don't suggest if it's already a URL
    if (/^(https?:\/\/)/.test(query)) return interaction.respond([]);

    try {
      const player = useMainPlayer();
      const { QueryType } = require('discord-player');

      // Attempt Spotify search for autocomplete first to match execute logic
      let res = await player.search(query, { 
        requestedBy: interaction.user,
        searchEngine: QueryType.SPOTIFY_SEARCH 
      });

      if (!res || !res.hasTracks()) {
        res = await player.search(query, { 
          requestedBy: interaction.user,
          searchEngine: QueryType.YOUTUBE_SEARCH 
        });
      }

      if (!res || !res.hasTracks()) return interaction.respond([]);

      const tracks = res.tracks.slice(0, 5);
      
      // If the query is already "almost exact" (very similar to the top result),
      // we can reduce the number of suggestions to keep it clean.
      const topTrackTitle = tracks[0].title.toLowerCase();
      const queryLower = query.toLowerCase();
      
      // If query is long and starts matching the top result closely, just show the top 1-2
      if (query.length > 15 && topTrackTitle.includes(queryLower)) {
        return interaction.respond(
          tracks.slice(0, 2).map((t) => ({
            name: `${t.title} — ${t.author}`.slice(0, 100),
            value: t.url,
          })),
        );
      }

      await interaction.respond(
        tracks.map((t) => ({
          name: `${t.title} — ${t.author}`.slice(0, 100),
          value: t.url,
        })),
      );
    } catch {
      await interaction.respond([]);
    }
  },

  async execute(client, interaction) {
    const query   = interaction.options.getString('query', true);
    const channel = interaction.member?.voice?.channel;

    if (!channel) {
      return interaction.reply({ content: '❌ You need to be in a voice channel!', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      const player = useMainPlayer();
      const { QueryType } = require('discord-player');
      
      let res;
      const isUrl = /^(https?:\/\/)/.test(query);

      if (isUrl) {
        // Direct URL playback
        res = await player.search(query, { requestedBy: interaction.user });
      } else {
        // Search priority: Spotify -> YouTube
        res = await player.search(query, { 
          requestedBy: interaction.user,
          searchEngine: QueryType.SPOTIFY_SEARCH 
        });

        if (!res || !res.hasTracks()) {
          res = await player.search(query, { 
            requestedBy: interaction.user,
            searchEngine: QueryType.YOUTUBE_SEARCH 
          });
        }
      }

      if (!res || !res.hasTracks()) {
        return interaction.editReply({ content: '❌ No results found' });
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
      } catch (err) {
        player.nodes.delete(interaction.guildId);
        return interaction.editReply({ content: '❌ Could not join your voice channel!' });
      }

      queue.addTrack(tracks);
      if (!queue.isPlaying()) await queue.node.play();

      const { createTrackMessage } = require('../src/utils/ui');
      if (isPlaylist) {
        return interaction.editReply({ content: `✅ Added playlist **${res.playlist.title}** (${tracks.length} random tracks) to the queue.` });
      } else {
        return interaction.editReply(createTrackMessage(tracks[0], 'Added to Queue'));
      }
    } catch (err) {
      console.error('[play]', err);
      return interaction.editReply({ content: `❌ ${err.message}` });
    }
  },
};
