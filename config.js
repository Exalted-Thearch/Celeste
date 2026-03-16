require('dotenv').config();

module.exports = {
  token:     process.env.TOKEN,
  clientId:  process.env.CLIENT_ID,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  embedColor: '#5865F2',       // Discord blurple
  defaultVolume: 80,
  leaveOnEmpty: true,
  leaveOnEmptyCooldown: 30000, // 30 seconds before leaving empty channel
};
