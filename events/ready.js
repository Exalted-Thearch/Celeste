module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} guild(s)`);
    client.user.setActivity('🎵 /play', { type: 2 }); // 2 = LISTENING
  },
};
