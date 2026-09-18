// Public by design: the PKCE flow needs no client secret.
// Same Spotify app as /spike/ — just make sure this page's exact URL is
// also registered as a Redirect URI in the dashboard (the spike and the
// real app live at different paths, so each needs its own entry).
export const SPOTIFY_CONFIG = {
  clientId: 'b9dec09d4e9941129e2fab974f2f864b',

  redirectUri: window.location.origin + window.location.pathname,

  scopes: [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
  ],
};
