// Tile/settings persistence, PIN hashing, and import/export/share-link
// validation. Every storage access is wrapped in try/catch since it can
// throw (private browsing, full storage, disabled storage).
const STORAGE_KEY = 'kmt_config_v1';

export const DEFAULT_SETTINGS = {
  kidName: '',
  endOfSong: 'continue', // 'stop' | 'repeat' | 'continue'
  maxVolume: 1,
  sleepTimerMinutes: null, // null | 15 | 30 | 45 | 60
  hideExplicit: true,
  pinHash: null,
};

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error(`Failed to read ${key}`, e);
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`Failed to write ${key}`, e);
    return false;
  }
}

export function loadConfig() {
  const stored = readJson(STORAGE_KEY);
  if (!stored) return { tiles: [], settings: { ...DEFAULT_SETTINGS } };
  return {
    tiles: Array.isArray(stored.tiles) ? stored.tiles : [],
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings || {}) },
  };
}

export function saveConfig(config) {
  return writeJson(STORAGE_KEY, { version: 1, tiles: config.tiles, settings: config.settings });
}

export function makeTileId() {
  return 't_' + Math.random().toString(36).slice(2, 10);
}

export function tileFromTrack(track, overrides = {}) {
  return {
    id: makeTileId(),
    uri: track.uri,
    title: track.name,
    artist: (track.artists || []).map((a) => a.name).join(', '),
    albumArtUrl: track.album && track.album.images && track.album.images[0] ? track.album.images[0].url : null,
    durationMs: track.duration_ms || 0,
    explicit: !!track.explicit,
    override: null,
    ...overrides,
  };
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPin(pin) {
  return sha256Hex(pin);
}

export async function checkPin(pin, pinHash) {
  if (!pinHash) return false;
  return (await sha256Hex(pin)) === pinHash;
}

const TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]+$/;

export function validateImportedConfig(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a valid config file');
  if (!Array.isArray(data.tiles)) throw new Error('Missing tiles list');
  if (data.tiles.length < 4 || data.tiles.length > 16) {
    throw new Error(`Need 4–16 tiles, found ${data.tiles.length}`);
  }
  for (const tile of data.tiles) {
    if (!tile || typeof tile.uri !== 'string' || !TRACK_URI_RE.test(tile.uri)) {
      throw new Error(`Invalid track URI: ${tile && tile.uri}`);
    }
  }
  return {
    tiles: data.tiles.map((t) => ({
      id: t.id || makeTileId(),
      uri: t.uri,
      title: t.title || '',
      artist: t.artist || '',
      albumArtUrl: t.albumArtUrl || null,
      durationMs: t.durationMs || 0,
      explicit: !!t.explicit,
      override:
        t.override && typeof t.override.emoji === 'string'
          ? { emoji: t.override.emoji, color: t.override.color || '#5b5bd6' }
          : null,
    })),
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
  };
}

export function encodeShareLink(config) {
  const compact = {
    v: 1,
    uris: config.tiles.map((t) => t.uri),
    overrides: config.tiles.reduce((acc, t, i) => {
      if (t.override) acc[i] = t.override;
      return acc;
    }, {}),
    settings: config.settings,
  };
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${window.location.origin}${window.location.pathname}#setup=${b64}`;
}

export function decodeShareLinkHash(hash) {
  const match = /(?:^#|&)setup=([^&]+)/.exec(hash);
  if (!match) return null;
  let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  const compact = JSON.parse(json);
  if (!Array.isArray(compact.uris) || compact.uris.length < 4 || compact.uris.length > 16) {
    throw new Error('Setup link has an invalid number of songs');
  }
  for (const uri of compact.uris) {
    if (!TRACK_URI_RE.test(uri)) throw new Error(`Setup link has an invalid track URI: ${uri}`);
  }
  return compact;
}
