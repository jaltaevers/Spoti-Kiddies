import { SPOTIFY_CONFIG } from './config.js';
import * as auth from './auth.js';
import { createPlayer } from './player.js';

const EVENT_HINTS = {
  initialization_error: 'SDK failed to initialize in this browser (unsupported browser, or blocked by an extension/private mode).',
  authentication_error: 'Access token was rejected by the SDK. Try Log out then log back in.',
  account_error:
    'Often means: this Spotify account has no active Premium subscription, or (Development Mode) it is not on this app’s allowed-users list in the dashboard.',
  playback_error: 'A specific playback request failed (bad track URI, or a transient Spotify Connect issue).',
  autoplay_failed: 'Browser blocked audio starting from this tap. Usually means activateElement() did not run synchronously in the tap handler.',
};

const els = {
  loginView: document.getElementById('login-view'),
  playerView: document.getElementById('player-view'),
  loginBtn: document.getElementById('login-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  accountName: document.getElementById('account-name'),
  deviceId: document.getElementById('device-id'),
  trackUri: document.getElementById('track-uri'),
  playBtn: document.getElementById('play-btn'),
  pauseBtn: document.getElementById('pause-btn'),
  resumeBtn: document.getElementById('resume-btn'),
  nowPlaying: document.getElementById('now-playing'),
  logOutput: document.getElementById('log-output'),
  copyLogBtn: document.getElementById('copy-log-btn'),
  clearLogBtn: document.getElementById('clear-log-btn'),
};

function logLine(type, data, isError = false) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (isError ? ' error' : '');
  let text = type;
  if (data !== undefined) {
    try {
      text += ' ' + JSON.stringify(data);
    } catch (e) {
      text += ' [unserializable payload]';
    }
  }
  entry.innerHTML = `<span class="ts">[${time}]</span>`;
  entry.append(document.createTextNode(text));
  els.logOutput.appendChild(entry);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
  (isError ? console.error : console.log)(`[spike] ${type}`, data);
}

window.addEventListener('error', (e) => {
  logLine('window_error', { message: e.message, filename: e.filename, lineno: e.lineno }, true);
});
window.addEventListener('unhandledrejection', (e) => {
  logLine('unhandled_rejection', { reason: String(e.reason) }, true);
});

els.clearLogBtn.addEventListener('click', () => {
  els.logOutput.innerHTML = '';
});

els.copyLogBtn.addEventListener('click', async () => {
  const text = els.logOutput.innerText;
  try {
    await navigator.clipboard.writeText(text);
    logLine('log_copied', { chars: text.length });
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      logLine('log_copied_fallback', {});
    } catch (e2) {
      logLine('log_copy_failed', { message: String(e2) }, true);
    } finally {
      document.body.removeChild(ta);
    }
  }
});

function showLoginView() {
  els.loginView.hidden = false;
  els.playerView.hidden = true;
}

function showPlayerView() {
  els.loginView.hidden = true;
  els.playerView.hidden = false;
}

els.loginBtn.addEventListener('click', () => {
  auth.redirectToLogin(SPOTIFY_CONFIG).catch((e) => logLine('login_redirect_error', { message: e.message }, true));
});

// Spotify rejects the whole login attempt (its own error page, before ever
// redirecting back here) when redirect_uri doesn't exactly match a URI
// registered in the app dashboard — see the "redirect URI mismatch" note in
// SPIKE.md. Surface the exact value this page is sending, and flag a way
// it can end up computing one that could never work. (The other known-bad
// case, opening this page via file://, is handled by the inline script in
// index.html instead — this module script never even loads under file://,
// so it can't detect it.)
(function initRedirectUriHelp() {
  document.getElementById('redirect-uri-value').textContent = SPOTIFY_CONFIG.redirectUri;

  if (window.location.hostname === 'localhost') {
    const warningEl = document.getElementById('redirect-uri-warning');
    warningEl.hidden = false;
    warningEl.textContent = 'Spotify no longer accepts "localhost" as a Redirect URI. Use the same server at http://127.0.0.1:<port>/spike/ instead, and register that exact address.';
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

els.logoutBtn.addEventListener('click', () => {
  auth.clearTokens();
  logLine('logged_out', {});
  window.location.reload();
});

function normalizeTrackUri(input) {
  const trimmed = input.trim();
  const openMatch = trimmed.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  return openMatch ? `spotify:track:${openMatch[1]}` : trimmed;
}

let player = null;

async function fetchProfile(accessToken) {
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
  return res.json();
}

async function initPlayerFlow() {
  showPlayerView();

  let token = null;
  try {
    token = await auth.getValidAccessToken(SPOTIFY_CONFIG);
  } catch (e) {
    if (e.message === 'REAUTH_REQUIRED') {
      logLine('reauth_required', { message: 'Refresh token expired or was revoked — please log in again.' }, true);
      auth.clearTokens();
      showLoginView();
      return;
    }
    logLine('token_error', { message: e.message }, true);
  }

  if (token) {
    try {
      const profile = await fetchProfile(token);
      els.accountName.textContent = profile.display_name || profile.id || '(unknown)';
      logLine('profile_loaded', { id: profile.id, display_name: profile.display_name });
    } catch (e) {
      logLine('profile_load_error', { message: e.message }, true);
    }
  }

  player = createPlayer({
    name: 'Kids Music Tiles (spike)',
    volume: 1,
    getOAuthToken: (callback) => {
      auth
        .getValidAccessToken(SPOTIFY_CONFIG)
        .then((t) => {
          if (!t) throw new Error('No access token available');
          callback(t);
        })
        .catch((e) => logLine('get_oauth_token_error', { message: e.message }, true));
    },
  });

  player.onEvent(({ type, data }) => {
    const isError = /error/.test(type) || type === 'autoplay_failed';
    const hint = EVENT_HINTS[type];
    logLine(type, hint ? { ...data, hint } : data, isError);

    if (type === 'ready') {
      els.deviceId.textContent = data.device_id;
      els.playBtn.disabled = false;
      els.pauseBtn.disabled = false;
      els.resumeBtn.disabled = false;
    }
    if (type === 'not_ready') {
      els.deviceId.textContent = `not ready (${data.device_id})`;
      els.playBtn.disabled = true;
      els.pauseBtn.disabled = true;
      els.resumeBtn.disabled = true;
    }
  });

  player.onStateChange((state) => {
    if (!state) {
      els.nowPlaying.textContent = '';
      return;
    }
    const track = state.track_window && state.track_window.current_track;
    const name = track ? `${track.name} — ${track.artists.map((a) => a.name).join(', ')}` : '(unknown track)';
    els.nowPlaying.textContent = `${state.paused ? 'Paused' : 'Playing'}: ${name}`;
  });

  try {
    await player.init();
  } catch (e) {
    logLine('player_init_error', { message: e.message }, true);
  }
}

let playTapInFlight = false;

els.playBtn.addEventListener('click', async () => {
  if (playTapInFlight) return;
  const uri = normalizeTrackUri(els.trackUri.value);
  if (!uri) {
    logLine('play_aborted', { reason: 'no track URI entered' }, true);
    return;
  }
  if (!/^spotify:track:[A-Za-z0-9]+$/.test(uri)) {
    logLine('play_aborted', { reason: 'does not look like spotify:track:<id>', uri }, true);
    return;
  }

  playTapInFlight = true;
  els.playBtn.disabled = true;
  try {
    logLine('activate_element', {});
    await player.activateElement();
    logLine('play_request', { uri });
    await player.playTracks([uri], 0);
  } catch (e) {
    logLine('play_error', { message: e.message }, true);
  } finally {
    playTapInFlight = false;
    els.playBtn.disabled = !player.getDeviceId();
  }
});

els.pauseBtn.addEventListener('click', () => {
  player.pause().catch((e) => logLine('pause_error', { message: e.message }, true));
});

els.resumeBtn.addEventListener('click', () => {
  player.resume().catch((e) => logLine('resume_error', { message: e.message }, true));
});

async function main() {
  if (SPOTIFY_CONFIG.defaultTrackUri) {
    els.trackUri.value = SPOTIFY_CONFIG.defaultTrackUri;
  }

  try {
    const handled = await auth.handleRedirectCallback(SPOTIFY_CONFIG);
    if (handled) logLine('login_success', {});
  } catch (e) {
    logLine('login_callback_error', { message: e.message }, true);
  }

  if (auth.loadTokens()) {
    await initPlayerFlow();
  } else {
    showLoginView();
  }
}

main();
