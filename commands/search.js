const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { useMainPlayer } = require('discord-player');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a song and choose from the top 5 results')
    .addStringOption((o) =>
      o.setName('query')
        .setDescription('Song name to search')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('platform')
        .setDescription('Platform to search on')
        .addChoices(
          { name: 'YouTube',    value: 'YOUTUBE_SEARCH' },
          { name: 'Spotify',    value: 'SPOTIFY_SEARCH' },
          { name: 'SoundCloud', value: 'SOUNDCLOUD_SEARCH' },
        ),
    ),

  async execute(client, interaction) {
    const query    = interaction.options.getString('query', true);
    const platform = interaction.options.getString('platform') || 'YOUTUBE_SEARCH';
    const channel  = interaction.member?.voice?.channel;

    if (!channel) {
      return interaction.reply({ content: '❌ You need to be in a voice channel!', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      const player = useMainPlayer();
      const { QueryType } = require('discord-player');
      
      let results;
      let fallbackText = '';

      if (platform === 'SPOTIFY_SEARCH') {
        const { searchSpotify } = require('../src/utils/spotify');
        const spotifyTracks = await searchSpotify(query);

        if (spotifyTracks.length > 0) {
          const spotifyUrl = spotifyTracks[0].external_urls.spotify;
          results = await player.search(spotifyUrl, { requestedBy: interaction.user });
          console.log('[Spotify Search Command] Found via API →', spotifyUrl);
        }
      } else {
        results = await player.search(query, { 
          requestedBy: interaction.user,
          searchEngine: QueryType[platform] 
        });
      }

      if (!results || !results.tracks.length) {
        if (platform !== 'YOUTUBE_SEARCH') {
          fallbackText = `\n*(Note: No results found on ${platform.split('_')[0]}, showing YouTube results instead)*`;
          results = await player.search(query, { 
            requestedBy: interaction.user,
            searchEngine: QueryType.YOUTUBE_SEARCH 
          });
        }
      }

      if (!results || !results.tracks.length) {
        return interaction.editReply({ content: '❌ No results found!' });
      }

      const tracks = results.tracks.slice(0, 5);
      const menu = new StringSelectMenuBuilder()
        .setCustomId('search_pick')
        .setPlaceholder('Choose a track...')
        .addOptions(
          tracks.map((t, i) => ({
            label:       `${i + 1}. ${t.title}`.slice(0, 100),
            description: `${t.author} — ${t.duration}`.slice(0, 100),
            value:       String(i),
          })),
        );

      const tracksText = tracks.map((t, i) => `\`${i + 1}.\` **[${t.title}](${t.url})**\n└ ${t.author} — \`${t.duration}\``).join('\n\n');
      const content = `🔍 **Results for:** \`${query}\` on **${platform.split('_')[0]}**${fallbackText}\n\n${tracksText}`;

      const msg = await interaction.editReply({
        content:    content,
        components: [new ActionRowBuilder().addComponents(menu)],
        flags:      MessageFlags.SuppressEmbeds,
      });

      const collector = msg.createMessageComponentCollector({ time: 30_000 });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: '❌ This is not your search!', flags: MessageFlags.Ephemeral });
        }

        await i.deferUpdate();
        const selected = tracks[parseInt(i.values[0])];

        const { track } = await player.play(channel, selected, {
          nodeOptions: {
            metadata:             { channel: interaction.channel },
            volume:               config.defaultVolume,
            leaveOnEmpty:         config.leaveOnEmpty,
            leaveOnEmptyCooldown: config.leaveOnEmptyCooldown,
            leaveOnEnd:           false,
          },
          requestedBy: interaction.user,
        });

        const { createTrackMessage } = require('../src/utils/ui');
        const queue = useQueue(interaction.guildId);
        const ui = createTrackMessage(track, 'Added to Queue', queue);

        await interaction.editReply({
          content: null,
          ...ui,
        });

        collector.stop();
      });

      collector.on('end', (_, reason) => {
        if (reason === 'time') {
          interaction.editReply({ components: [] }).catch(() => {});
        }
      });
    } catch (err) {
      console.error('[search]', err);
      return interaction.editReply({ content: `❌ ${err.message}` });
    }
  },
};
