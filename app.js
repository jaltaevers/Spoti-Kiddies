import { SPOTIFY_CONFIG } from './config.js';
import * as auth from './auth.js';
import { createSpotifyApi } from './spotify-api.js';
import { createPlayer } from './player.js';
import { loadConfig, saveConfig, decodeShareLinkHash, tileFromTrack } from './store.js';
import { createKidMode } from './kid-mode.js';
import { createParentGate } from './parent-gate.js';
import { createParentMode } from './parent-mode.js';

const views = {
  login: document.getElementById('login-view'),
  kid: document.getElementById('kid-mode'),
  gate: document.getElementById('parent-gate-view'),
  parent: document.getElementById('parent-mode-view'),
};

function showOnly(name) {
  for (const key of Object.keys(views)) {
    views[key].hidden = key !== name;
  }
}

let config = loadConfig();
function getConfig() {
  return config;
}
function getSavedConfig() {
  return config;
}

function applyDocumentTitle() {
  const name = config.settings.kidName && config.settings.kidName.trim();
  document.title = name ? `${name}’s Music Tiles` : 'Kids Music Tiles';
}

const api = createSpotifyApi(SPOTIFY_CONFIG, { onReauthRequired: forceReauth });

function forceReauth() {
  auth.clearTokens();
  showOnly('login');
}

document.getElementById('login-btn').addEventListener('click', () => {
  auth.redirectToLogin(SPOTIFY_CONFIG).catch((e) => {
    const el = document.getElementById('login-error');
    el.hidden = false;
    el.textContent = e.message;
  });
});

// Spotify rejects the whole login attempt (its own error page, before ever
// redirecting back here) when redirect_uri doesn't exactly match a URI
// registered in the app dashboard. This app can't fix that registration —
// only the dashboard can — so instead it surfaces the exact value it's
// sending and flags a way this page can end up computing one that could
// never work, so a parent debugging "login is broken" from this screen
// isn't stuck guessing. (The other known-bad case, opening this page via
// file://, is handled by the inline script in index.html instead — this
// module script never even loads under file://, so it can't detect it.)
function describeRedirectUriProblem() {
  if (window.location.hostname === 'localhost') {
    return 'Spotify no longer accepts "localhost" as a Redirect URI. Use the same server at http://127.0.0.1:<port>/ instead (same page, different address in the bar), and register that exact address.';
  }
  return null;
}

(function initRedirectUriHelp() {
  document.getElementById('redirect-uri-value').textContent = SPOTIFY_CONFIG.redirectUri;

  const problem = describeRedirectUriProblem();
  if (problem) {
    const warningEl = document.getElementById('redirect-uri-warning');
    warningEl.hidden = false;
    warningEl.textContent = problem;
  }

  document.getElementById('copy-redirect-uri-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('redirect-uri-status');
    try {
      await navigator.clipboard.writeText(SPOTIFY_CONFIG.redirectUri);
      statusEl.textContent = 'Copied.';
    } catch (e) {
      window.prompt('Copy this address:', SPOTIFY_CONFIG.redirectUri);
    }
    setTimeout(() => (statusEl.textContent = ''), 2500);
  });
})();

let player = null;
let kidMode = null;

const parentGate = createParentGate({
  els: {
    title: document.getElementById('parent-gate-title'),
    message: document.getElementById('parent-gate-message'),
    input: document.getElementById('parent-gate-input'),
    error: document.getElementById('parent-gate-error'),
    form: document.getElementById('parent-gate-form'),
    cancelBtn: document.getElementById('parent-gate-cancel-btn'),
  },
  getConfig,
  saveSettings(partial) {
    config.settings = { ...config.settings, ...partial };
    saveConfig(config);
  },
  onSuccess: () => enterParentMode(),
  onCancel: () => showOnly('kid'),
});

const parentMode = createParentMode({
  els: {
    kidNameInput: document.getElementById('kid-name-input'),
    quickPlaylistInput: document.getElementById('quick-playlist-input'),
    quickPlaylistBtn: document.getElementById('quick-playlist-btn'),
    quickPlaylistStatus: document.getElementById('quick-playlist-status'),
    quickPlaylistError: document.getElementById('quick-playlist-error'),
    volumeValue: document.getElementById('volume-value'),
    accountInfo: document.getElementById('account-info'),
    tokenWarning: document.getElementById('token-warning'),
    tileCount: document.getElementById('tile-count'),
    tileCountWarning: document.getElementById('tile-count-warning'),
    tileList: document.getElementById('tile-list'),
    colorPickerInput: document.getElementById('color-picker-input'),
    searchResults: document.getElementById('search-results'),
    searchLoadMore: document.getElementById('search-load-more'),
    searchInput: document.getElementById('search-input'),
    playlistInput: document.getElementById('playlist-input'),
    playlistFetchBtn: document.getElementById('playlist-fetch-btn'),
    playlistError: document.getElementById('playlist-error'),
    playlistResults: document.getElementById('playlist-results'),
    playlistAddAllBtn: document.getElementById('playlist-add-all-btn'),
    tabSearchBtn: document.getElementById('tab-search'),
    tabPlaylistBtn: document.getElementById('tab-playlist'),
    searchPanel: document.getElementById('search-panel'),
    playlistPanel: document.getElementById('playlist-panel'),
    endOfSongRadios: Array.from(document.querySelectorAll('input[name="end-of-song"]')),
    volumeSlider: document.getElementById('volume-slider'),
    sleepTimerSelect: document.getElementById('sleep-timer-select'),
    hideExplicitToggle: document.getElementById('hide-explicit-toggle'),
    changePinBtn: document.getElementById('change-pin-btn'),
    saveBtn: document.getElementById('save-btn'),
    exportBtn: document.getElementById('export-btn'),
    importBtn: document.getElementById('import-btn'),
    importFileInput: document.getElementById('import-file-input'),
    copyLinkBtn: document.getElementById('copy-link-btn'),
    saveStatus: document.getElementById('save-status'),
    doneBtn: document.getElementById('parent-done-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    reloginBtn: document.getElementById('relogin-btn'),
  },
  api,
  getSavedConfig,
  saveAndApply(newConfig) {
    config = newConfig;
    saveConfig(config);
    applyDocumentTitle();
    if (kidMode) kidMode.show();
  },
  onDone: () => {
    if (getSavedConfig().tiles.length < 4) {
      window.alert('Save at least 4 songs before returning to kid mode.');
      return;
    }
    showOnly('kid');
    kidMode.show();
  },
  onLogout: () => {
    auth.clearTokens();
    window.location.reload();
  },
  onRelogin: () => {
    auth.redirectToLogin(SPOTIFY_CONFIG).catch((e) => window.alert(e.message));
  },
  onReauthRequired: forceReauth,
});

function enterParentMode() {
  showOnly('parent');
  api
    .getMe()
    .then((profile) => parentMode.show(profile))
    .catch(() => parentMode.show(null));
}

async function applyPendingShareLink() {
  const compact = window.__pendingShareLink;
  if (!compact) return;
  window.__pendingShareLink = null;
  try {
    const ids = compact.uris.map((uri) => uri.split(':')[2]);
    const tracks = await api.getTracksByIds(ids);
    const tiles = compact.uris.map((uri, i) => {
      const track = tracks[i];
      const override = compact.overrides && compact.overrides[i];
      if (!track) return { id: 'imported_' + i, uri, title: '', artist: '', albumArtUrl: null, durationMs: 0, explicit: false, override: override || null };
      return tileFromTrack(track, override ? { override } : {});
    });
    config = { tiles, settings: { ...config.settings, ...(compact.settings || {}) } };
    saveConfig(config);
  } catch (e) {
    console.error('Failed to import setup link', e);
  }
}

async function initPlayerAndKidMode() {
  player = createPlayer({
    name: 'Kids Music Tiles',
    volume: config.settings.maxVolume,
    api,
    getOAuthToken: (callback) => {
      auth
        .getValidAccessToken(SPOTIFY_CONFIG)
        .then((token) => {
          if (token) callback(token);
        })
        .catch(() => {});
    },
  });

  kidMode = createKidMode({
    els: {
      grid: document.getElementById('kid-grid'),
      overlay: document.getElementById('now-playing-overlay'),
      npArt: document.getElementById('np-art'),
      progressBar: document.getElementById('np-progress-bar'),
      error: document.getElementById('kid-error'),
      errorDetail: document.getElementById('kid-error-detail'),
      parentGateBtn: document.getElementById('parent-gate-btn'),
      backBtn: document.getElementById('back-to-tiles-btn'),
      playPause: document.getElementById('np-play-pause'),
      greeting: document.getElementById('kid-greeting'),
      sparkleLayer: document.getElementById('sparkle-layer'),
    },
    player,
    getConfig,
    onOpenParentGate: () => {
      showOnly('gate');
      parentGate.show();
    },
  });

  try {
    await player.init();
  } catch (e) {
    console.error('Player init failed', e);
  }
}

async function main() {
  const pendingHash = window.location.hash;
  if (pendingHash) {
    try {
      window.__pendingShareLink = decodeShareLinkHash(pendingHash);
    } catch (e) {
      window.alert('That setup link looks invalid: ' + e.message);
    }
  }

  try {
    await auth.handleRedirectCallback(SPOTIFY_CONFIG);
  } catch (e) {
    const el = document.getElementById('login-error');
    el.hidden = false;
    el.textContent = e.message;
  }

  if (!auth.loadTokens()) {
    showOnly('login');
    return;
  }

  await applyPendingShareLink();
  window.history.replaceState({}, document.title, window.location.pathname);
  applyDocumentTitle();

  await initPlayerAndKidMode();

  if (config.tiles.length < 4) {
    enterParentMode();
  } else {
    showOnly('kid');
    kidMode.show();
  }
}

main();
