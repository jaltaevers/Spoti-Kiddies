// Tile/settings persistence, PIN hashing, and import/export/share-link
// validation. Every storage access is wrapped in try/catch since it can
// throw (private browsing, full storage, disabled storage).
//
// The store holds multiple named kids, each with their own tiles and
// playback settings, plus one PIN shared by the whole device (not
// per-kid — it gates parent mode itself, before any kid is selected).
const STORAGE_KEY = 'kmt_config_v1';

export const DEFAULT_KID_SETTINGS = {
  kidName: '',
  endOfSong: 'continue', // 'stop' | 'repeat' | 'continue'
  maxVolume: 1,
  sleepTimerMinutes: null, // null | 15 | 30 | 45 | 60
  hideExplicit: true,
  tileDisplay: 'cover', // 'cover' (album art) | 'simple' (emoji + song name)
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

export function makeKidId() {
  return 'k_' + Math.random().toString(36).slice(2, 10);
}

export function makeTileId() {
  return 't_' + Math.random().toString(36).slice(2, 10);
}

function makeKid(name) {
  return {
    id: makeKidId(),
    tiles: [],
    sourcePlaylistUrl: null,
    settings: { ...DEFAULT_KID_SETTINGS, kidName: name || '' },
  };
}

function normalizeKid(k) {
  return {
    id: (k && k.id) || makeKidId(),
    tiles: Array.isArray(k && k.tiles) ? k.tiles : [],
    sourcePlaylistUrl: (k && k.sourcePlaylistUrl) || null,
    settings: { ...DEFAULT_KID_SETTINGS, ...((k && k.settings) || {}) },
  };
}

// Pre-multi-kid saves looked like { tiles, settings: {...DEFAULT_KID_SETTINGS, pinHash} },
// one flat config for the whole device. Wrap that as this device's first
// kid, carrying its PIN over to the new device-level slot, so upgrading
// doesn't reset anything an existing family already set up.
function migrateLegacyStore(stored) {
  const legacySettings = stored.settings || {};
  const kid = {
    id: makeKidId(),
    tiles: Array.isArray(stored.tiles) ? stored.tiles : [],
    sourcePlaylistUrl: null,
    settings: {
      kidName: legacySettings.kidName || '',
      endOfSong: legacySettings.endOfSong || DEFAULT_KID_SETTINGS.endOfSong,
      maxVolume: legacySettings.maxVolume != null ? legacySettings.maxVolume : DEFAULT_KID_SETTINGS.maxVolume,
      sleepTimerMinutes: legacySettings.sleepTimerMinutes != null ? legacySettings.sleepTimerMinutes : null,
      hideExplicit: legacySettings.hideExplicit != null ? legacySettings.hideExplicit : true,
      tileDisplay: legacySettings.tileDisplay || DEFAULT_KID_SETTINGS.tileDisplay,
    },
  };
  return { kids: [kid], activeKidId: kid.id, pinHash: legacySettings.pinHash || null };
}

export function loadStore() {
  const stored = readJson(STORAGE_KEY);
  if (!stored) {
    const kid = makeKid('');
    return { kids: [kid], activeKidId: kid.id, pinHash: null };
  }
  if (Array.isArray(stored.kids) && stored.kids.length > 0) {
    const kids = stored.kids.map(normalizeKid);
    const activeKidId = kids.some((k) => k.id === stored.activeKidId) ? stored.activeKidId : kids[0].id;
    return { kids, activeKidId, pinHash: stored.pinHash || null };
  }
  return migrateLegacyStore(stored);
}

export function saveStore(store) {
  return writeJson(STORAGE_KEY, {
    version: 2,
    kids: store.kids,
    activeKidId: store.activeKidId,
    pinHash: store.pinHash,
  });
}

export function getActiveKid(store) {
  return store.kids.find((k) => k.id === store.activeKidId) || store.kids[0];
}

export function addKid(store, name) {
  const kid = makeKid(name);
  return { ...store, kids: [...store.kids, kid], activeKidId: kid.id };
}

// Always leaves at least one kid behind — an empty roster has nothing for
// kid mode to show and nowhere for parent mode to point the tab bar.
export function removeKid(store, kidId) {
  const kids = store.kids.filter((k) => k.id !== kidId);
  const safeKids = kids.length > 0 ? kids : [makeKid('')];
  const activeKidId = store.activeKidId === kidId ? safeKids[0].id : store.activeKidId;
  return { ...store, kids: safeKids, activeKidId };
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

// Imports/exports one kid at a time — the file a parent exports from
// "Songs" is that kid's tiles/settings, not the whole roster.
export function validateImportedConfig(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a valid config file');
  if (!Array.isArray(data.tiles)) throw new Error('Missing tiles list');
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
    sourcePlaylistUrl: typeof data.sourcePlaylistUrl === 'string' ? data.sourcePlaylistUrl : null,
    settings: { ...DEFAULT_KID_SETTINGS, ...(data.settings || {}) },
  };
}

export function encodeShareLink(kid) {
  const compact = {
    v: 1,
    uris: kid.tiles.map((t) => t.uri),
    overrides: kid.tiles.reduce((acc, t, i) => {
      if (t.override) acc[i] = t.override;
      return acc;
    }, {}),
    sourcePlaylistUrl: kid.sourcePlaylistUrl || undefined,
    settings: kid.settings,
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
  if (!Array.isArray(compact.uris)) {
    throw new Error('Setup link has no songs in it');
  }
  for (const uri of compact.uris) {
    if (!TRACK_URI_RE.test(uri)) throw new Error(`Setup link has an invalid track URI: ${uri}`);
  }
  return compact;
}
