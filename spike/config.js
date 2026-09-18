// Public by design: the PKCE flow needs no client secret, so the Client ID
// can live here in plain sight.
//
// 1. Create an app at https://developer.spotify.com/dashboard
// 2. Copy its Client ID into clientId below.
// 3. Register redirectUri (below) as a Redirect URI on that app, exactly,
//    including the trailing slash.
export const SPOTIFY_CONFIG = {
  clientId: 'b9dec09d4e9941129e2fab974f2f864b',

  // Must exactly match a Redirect URI registered in the Spotify dashboard.
  // Resolves automatically to the right value on GitHub Pages and on
  // http://127.0.0.1:<port>/ for local dev, as long as both exact URLs
  // (trailing slash included) are registered.
  redirectUri: window.location.origin + window.location.pathname,

  scopes: [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
  ],

  // Optional: pre-fill the track URI field so you don't have to paste one
  // every time. Get a URI from the Spotify app: track's "..." menu → Share
  // → Copy Song Link, then paste the resulting open.spotify.com link into
  // the field on the page — it's converted to spotify:track:... for you.
  defaultTrackUri: '',
};
