const config = require("../../config");

// ── Spotify token cache ────────────────────────────────────────────────────────
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (_spotifyToken && Date.now() < _spotifyTokenExpiry) return _spotifyToken;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(
          `${config.spotifyClientId}:${config.spotifyClientSecret}`,
        ).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  _spotifyToken = data.access_token;
  _spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _spotifyToken;
}

async function searchSpotify(query, limit = 5) {
  try {
    const token = await getSpotifyToken();
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data?.tracks?.items ?? [];
  } catch (err) {
    console.error('[Spotify API error]', err.message);
    return [];
  }
}

module.exports = {
  searchSpotify,
};
