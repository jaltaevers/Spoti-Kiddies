// Thin wrapper around the Spotify Web Playback SDK, kept behind a small,
// swappable interface: init, playTracks, pause, resume, next, previous,
// setVolume, getState, onStateChange (+ onEvent, activateElement for this
// debug spike). If the SDK proves unreliable on the target tablet, this
// module is the one place a Spotify Connect remote-control implementation
// would replace, without touching UI code.

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const API_BASE = 'https://api.spotify.com/v1';

let sdkLoadPromise = null;
function loadSdk() {
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise((resolve, reject) => {
    if (window.Spotify) {
      resolve(window.Spotify);
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the Spotify Web Playback SDK script'));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

export function createPlayer({ name, getOAuthToken, volume = 1 }) {
  let player = null;
  let deviceId = null;
  const stateListeners = new Set();
  const eventListeners = new Set();
  let playInFlight = null;

  function emitEvent(type, data) {
    for (const listener of eventListeners) {
      try {
        listener({ type, data });
      } catch (e) {
        console.error('event listener threw', e);
      }
    }
  }

  function emitState(state) {
    for (const listener of stateListeners) {
      try {
        listener(state);
      } catch (e) {
        console.error('state listener threw', e);
      }
    }
  }

  async function init() {
    const Spotify = await loadSdk();
    player = new Spotify.Player({ name, getOAuthToken, volume });

    for (const eventName of ['initialization_error', 'authentication_error', 'account_error', 'playback_error', 'autoplay_failed']) {
      player.addListener(eventName, (payload) => emitEvent(eventName, payload));
    }
    player.addListener('ready', ({ device_id }) => {
      deviceId = device_id;
      emitEvent('ready', { device_id });
    });
    player.addListener('not_ready', ({ device_id }) => {
      emitEvent('not_ready', { device_id });
    });
    player.addListener('player_state_changed', (state) => {
      emitEvent('player_state_changed', state);
      emitState(state);
    });

    const connected = await player.connect();
    emitEvent('connect_result', { connected });
    if (!connected) {
      throw new Error('Spotify.Player.connect() returned false');
    }
  }

  function fetchOAuthToken() {
    return new Promise((resolve, reject) => {
      try {
        getOAuthToken(resolve);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function apiRequest(path, options = {}) {
    const token = await fetchOAuthToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '');
      emitEvent('api_error', { path, status: res.status, body });
      throw new Error(`${path} failed: ${res.status}`);
    }
    emitEvent('api_success', { path });
    return res;
  }

  function requireDeviceId() {
    if (!deviceId) {
      throw new Error('Player not ready yet: no device_id. Wait for the "ready" event.');
    }
    return deviceId;
  }

  async function playTracks(uris, offset = 0) {
    const id = requireDeviceId();
    // Never fire overlapping play requests: fold a tap that lands mid-request
    // into waiting for the one already in flight, then issue the new one.
    if (playInFlight) await playInFlight.catch(() => {});
    playInFlight = apiRequest(`/me/player/play?device_id=${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ uris, offset: { position: offset } }),
    }).finally(() => {
      playInFlight = null;
    });
    return playInFlight;
  }

  function pause() {
    const id = requireDeviceId();
    return apiRequest(`/me/player/pause?device_id=${encodeURIComponent(id)}`, { method: 'PUT' });
  }

  async function resume() {
    if (player) await player.resume();
  }

  function next() {
    const id = requireDeviceId();
    return apiRequest(`/me/player/next?device_id=${encodeURIComponent(id)}`, { method: 'POST' });
  }

  function previous() {
    const id = requireDeviceId();
    return apiRequest(`/me/player/previous?device_id=${encodeURIComponent(id)}`, { method: 'POST' });
  }

  async function setVolume(value) {
    if (player) await player.setVolume(value);
  }

  async function getState() {
    return player ? player.getCurrentState() : null;
  }

  function onStateChange(listener) {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }

  function onEvent(listener) {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  }

  async function activateElement() {
    // Must run synchronously inside the tap handler (before any other
    // await) so the browser still counts this as a user gesture — required
    // for audio to start on mobile. See index/app.js play handler.
    if (player && typeof player.activateElement === 'function') {
      await player.activateElement();
    }
  }

  return {
    init,
    playTracks,
    pause,
    resume,
    next,
    previous,
    setVolume,
    getState,
    onStateChange,
    onEvent,
    activateElement,
    getDeviceId: () => deviceId,
  };
}
