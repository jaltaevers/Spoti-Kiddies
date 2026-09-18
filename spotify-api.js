// Shared Web API access: auth handling (401 refresh+retry, 403, 429) lives
// here once, used by both player.js (playback control) and parent mode
// (search, playlist import, track lookup).
import { getValidAccessToken, refreshAccessToken, clearTokens } from './auth.js';

const API_BASE = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = info.status;
    this.retryAfterSeconds = info.retryAfterSeconds;
    this.body = info.body;
  }
}

export function createSpotifyApi(config, { onReauthRequired } = {}) {
  async function rawRequest(path, options) {
    const token = await getValidAccessToken(config);
    if (!token) {
      onReauthRequired && onReauthRequired();
      throw new SpotifyApiError('Not logged in', { status: 401 });
    }
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options && options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options && options.headers),
      },
    });
  }

  async function request(path, options = {}) {
    let res = await rawRequest(path, options);

    if (res.status === 401) {
      let refreshed = false;
      try {
        await refreshAccessToken(config);
        refreshed = true;
      } catch (e) {
        // handled by the shared reauth check below
      }
      if (refreshed) res = await rawRequest(path, options);
      if (res.status === 401) {
        clearTokens();
        onReauthRequired && onReauthRequired();
        throw new SpotifyApiError('Session expired — please log in again', { status: 401 });
      }
    }

    if (res.status === 429) {
      const retryAfterSeconds = Number(res.headers.get('Retry-After') || '1');
      throw new SpotifyApiError('Rate limited by Spotify', { status: 429, retryAfterSeconds });
    }
    if (res.status === 403) {
      throw new SpotifyApiError(
        'This Spotify account can’t be used right now (no active Premium, or not on this app’s allowed-users list)',
        { status: 403 }
      );
    }
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '');
      throw new SpotifyApiError(`Request failed: ${res.status}`, { status: res.status, body });
    }
    return res;
  }

  async function getMe() {
    const res = await request('/me');
    return res.json();
  }

  async function searchTracks(query, offset = 0, limit = 10) {
    const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit), offset: String(offset) });
    const res = await request(`/search?${params.toString()}`);
    const data = await res.json();
    return { items: data.tracks.items, total: data.tracks.total, hasMore: !!data.tracks.next };
  }

  function extractPlaylistId(input) {
    const trimmed = input.trim();
    const linkMatch = trimmed.match(/playlist\/([A-Za-z0-9]+)/);
    if (linkMatch) return linkMatch[1];
    const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
    if (uriMatch) return uriMatch[1];
    return /^[A-Za-z0-9]{10,}$/.test(trimmed) ? trimmed : null;
  }

  async function getPlaylistItems(playlistIdOrLink, { maxItems = 300 } = {}) {
    const playlistId = extractPlaylistId(playlistIdOrLink);
    if (!playlistId) throw new Error('Doesn’t look like a Spotify playlist link or ID');

    const fields = encodeURIComponent(
      'items(track(uri,name,duration_ms,explicit,artists(name),album(images))),next'
    );
    let path = `/playlists/${playlistId}/items?fields=${fields}&limit=50`;
    const tracks = [];
    while (path && tracks.length < maxItems) {
      const res = await request(path);
      const data = await res.json();
      for (const item of data.items || []) {
        if (item && item.track && typeof item.track.uri === 'string' && item.track.uri.startsWith('spotify:track:')) {
          tracks.push(item.track);
        }
      }
      path = data.next ? data.next.replace(API_BASE, '') : null;
    }
    return tracks;
  }

  async function getTracksByIds(ids) {
    // No batch "get several tracks" call here on purpose: that endpoint was
    // among the ones pulled for Development Mode in the Feb 2026 migration,
    // so individual lookups (parallelized) are the safe path at our scale
    // (at most 16 tiles).
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await request(`/tracks/${id}`);
          return await res.json();
        } catch (e) {
          return null;
        }
      })
    );
    return results;
  }

  async function setRepeatMode(deviceId, mode) {
    await request(`/me/player/repeat?state=${mode}&device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' });
  }

  return { request, getMe, searchTracks, getPlaylistItems, getTracksByIds, setRepeatMode, extractPlaylistId };
}
