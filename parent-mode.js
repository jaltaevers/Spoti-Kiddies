import { tileFromTrack, validateImportedConfig, encodeShareLink, hashPin } from './store.js';
import { getLoginAgeInfo } from './auth.js';

const EMOJI_COLOR_DEFAULT = '#5b5bd6';

export function reorderArray(arr, fromIndex, toIndex) {
  const copy = arr.slice();
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function createParentMode({ els, api, getSavedConfig, saveAndApply, onDone, onLogout, onRelogin, onReauthRequired }) {
  let draft = null;
  let searchOffset = 0;
  let searchQuery = '';
  let searchDebounce = null;

  function existingUris() {
    return new Set(draft.tiles.map((t) => t.uri));
  }

  function renderAccount(profile) {
    els.accountInfo.textContent = profile ? profile.display_name || profile.id : 'Not logged in';
    const info = getLoginAgeInfo();
    if (info && info.expiringSoon) {
      els.tokenWarning.hidden = false;
      els.tokenWarning.textContent =
        info.daysRemaining > 0
          ? `Your Spotify login may need renewing in about ${info.daysRemaining} day(s).`
          : 'Your Spotify login may have expired — log in again if playback stops working.';
    } else {
      els.tokenWarning.hidden = true;
    }
  }

  function renderTileCount() {
    els.tileCount.textContent = String(draft.tiles.length);
    const tooFew = draft.tiles.length < 4;
    els.tileCountWarning.hidden = !tooFew;
    if (tooFew) {
      els.tileCountWarning.textContent = `Add at least ${4 - draft.tiles.length} more song(s) — kid mode needs 4–16.`;
    }
  }

  function renderTileList() {
    els.tileList.innerHTML = '';
    draft.tiles.forEach((tile, index) => {
      const li = document.createElement('li');
      li.className = 'tile-row';

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '⠷';
      handle.setAttribute('aria-label', 'Drag to reorder');

      const thumb = document.createElement('div');
      thumb.className = 'tile-thumb';
      if (tile.override) {
        thumb.style.background = tile.override.color;
        thumb.textContent = tile.override.emoji;
      } else if (tile.albumArtUrl) {
        thumb.style.backgroundImage = `url("${tile.albumArtUrl}")`;
      }

      const meta = document.createElement('div');
      meta.className = 'tile-meta';
      const titleEl = document.createElement('div');
      titleEl.className = 'tile-title';
      titleEl.textContent = tile.title || tile.uri;
      const artistEl = document.createElement('div');
      artistEl.className = 'tile-artist';
      artistEl.textContent = tile.artist || '';
      meta.appendChild(titleEl);
      meta.appendChild(artistEl);
      if (tile.explicit) {
        const badge = document.createElement('span');
        badge.className = 'explicit-badge';
        badge.textContent = 'E';
        meta.appendChild(badge);
      }

      const overrideBtn = document.createElement('button');
      overrideBtn.type = 'button';
      overrideBtn.className = 'tile-action-btn';
      overrideBtn.textContent = '🎨';
      overrideBtn.setAttribute('aria-label', 'Set emoji + color instead of album art');
      overrideBtn.addEventListener('click', () => openOverrideEditor(index));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tile-action-btn tile-remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.setAttribute('aria-label', 'Remove');
      removeBtn.addEventListener('click', () => {
        draft.tiles.splice(index, 1);
        renderTileList();
        renderTileCount();
      });

      li.appendChild(handle);
      li.appendChild(thumb);
      li.appendChild(meta);
      li.appendChild(overrideBtn);
      li.appendChild(removeBtn);
      els.tileList.appendChild(li);
    });
    renderTileCount();
    setupDragReorder();
  }

  function openOverrideEditor(index) {
    const tile = draft.tiles[index];
    const emoji = window.prompt('Emoji for this tile (leave blank to use album art instead):', tile.override ? tile.override.emoji : '');
    if (emoji === null) return;
    if (emoji.trim() === '') {
      tile.override = null;
    } else {
      const color = tile.override ? tile.override.color : EMOJI_COLOR_DEFAULT;
      tile.override = { emoji: emoji.trim().slice(0, 4), color };
      openColorEditor(index);
    }
    renderTileList();
  }

  function openColorEditor(index) {
    els.colorPickerInput.value = draft.tiles[index].override.color;
    els.colorPickerInput.onchange = () => {
      draft.tiles[index].override.color = els.colorPickerInput.value;
      renderTileList();
    };
    els.colorPickerInput.click();
  }

  let dragState = null;
  function setupDragReorder() {
    els.tileList.onpointerdown = (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const row = handle.closest('.tile-row');
      const rows = Array.from(els.tileList.children);
      dragState = { pointerId: e.pointerId, startIndex: rows.indexOf(row), row, startY: e.clientY, targetIndex: rows.indexOf(row) };
      row.classList.add('dragging');
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore — capture is a nice-to-have, not required for correctness
      }
    };
    els.tileList.onpointermove = (e) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      const deltaY = e.clientY - dragState.startY;
      dragState.row.style.transform = `translateY(${deltaY}px)`;
      const rows = Array.from(els.tileList.children).filter((r) => r !== dragState.row);
      const currentCenter = dragState.row.offsetTop + dragState.row.offsetHeight / 2 + deltaY;
      let targetIndex = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rowCenter = rows[i].offsetTop + rows[i].offsetHeight / 2;
        if (currentCenter < rowCenter) {
          targetIndex = i;
          break;
        }
      }
      dragState.targetIndex = targetIndex;
    };
    const endDrag = (e) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      const { startIndex, targetIndex } = dragState;
      dragState.row.classList.remove('dragging');
      dragState.row.style.transform = '';
      dragState = null;
      if (targetIndex !== undefined && targetIndex !== startIndex) {
        draft.tiles = reorderArray(draft.tiles, startIndex, targetIndex > startIndex ? targetIndex - 1 : targetIndex);
        renderTileList();
      }
    };
    els.tileList.onpointerup = endDrag;
    els.tileList.onpointercancel = endDrag;
  }

  function renderResultRow(track, container) {
    if (draft.settings.hideExplicit && track.explicit) return;

    const row = document.createElement('div');
    row.className = 'result-row';
    const thumb = document.createElement('div');
    thumb.className = 'tile-thumb';
    const art = track.album && track.album.images && track.album.images[0];
    if (art) thumb.style.backgroundImage = `url("${art.url}")`;

    const meta = document.createElement('div');
    meta.className = 'tile-meta';
    const titleEl = document.createElement('div');
    titleEl.className = 'tile-title';
    titleEl.textContent = track.name;
    const artistEl = document.createElement('div');
    artistEl.className = 'tile-artist';
    artistEl.textContent = `${(track.artists || []).map((a) => a.name).join(', ')} · ${formatDuration(track.duration_ms)}`;
    meta.appendChild(titleEl);
    meta.appendChild(artistEl);
    if (track.explicit) {
      const badge = document.createElement('span');
      badge.className = 'explicit-badge';
      badge.textContent = 'E';
      meta.appendChild(badge);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'tile-action-btn';
    const already = existingUris().has(track.uri);
    const full = draft.tiles.length >= 16;
    addBtn.textContent = already ? 'Added' : full ? 'Full' : 'Add';
    addBtn.disabled = already || full;
    addBtn.addEventListener('click', () => {
      draft.tiles.push(tileFromTrack(track));
      renderTileList();
      renderResults(container === els.searchResults ? lastSearchResults : lastPlaylistResults, container);
    });

    row.appendChild(thumb);
    row.appendChild(meta);
    row.appendChild(addBtn);
    container.appendChild(row);
  }

  let lastSearchResults = [];
  let lastPlaylistResults = [];

  function renderResults(tracks, container) {
    container.innerHTML = '';
    tracks.forEach((t) => renderResultRow(t, container));
  }

  async function runSearch(reset) {
    if (!searchQuery.trim()) {
      lastSearchResults = [];
      renderResults([], els.searchResults);
      els.searchLoadMore.hidden = true;
      return;
    }
    if (reset) searchOffset = 0;
    try {
      const { items, hasMore } = await api.searchTracks(searchQuery, searchOffset, 10);
      lastSearchResults = reset ? items : lastSearchResults.concat(items);
      renderResults(lastSearchResults, els.searchResults);
      els.searchLoadMore.hidden = !hasMore;
      searchOffset += items.length;
    } catch (e) {
      handleApiError(e, els.searchResults);
    }
  }

  function handleApiError(e, container) {
    if (e && e.status === 401 && onReauthRequired) {
      onReauthRequired();
      return;
    }
    const el = document.createElement('div');
    el.className = 'warning';
    el.textContent = e && e.retryAfterSeconds ? `Spotify asked us to slow down — try again in ${e.retryAfterSeconds}s.` : (e && e.message) || 'Something went wrong';
    if (container) {
      container.innerHTML = '';
      container.appendChild(el);
    }
  }

  async function fetchPlaylist() {
    els.playlistError.hidden = true;
    els.playlistResults.innerHTML = '';
    els.playlistAddAllBtn.hidden = true;
    const link = els.playlistInput.value.trim();
    if (!link) return;
    try {
      const tracks = await api.getPlaylistItems(link);
      lastPlaylistResults = tracks;
      renderResults(tracks, els.playlistResults);
      els.playlistAddAllBtn.hidden = tracks.length === 0;
    } catch (e) {
      els.playlistError.hidden = false;
      els.playlistError.textContent =
        e && e.status === 403
          ? 'Can’t read this playlist — Development Mode only allows reading playlists you created or collaborate on. Try one of your own playlists, or add songs individually via Search.'
          : (e && e.message) || 'Couldn’t fetch that playlist.';
    }
  }

  function addAllFromPlaylist() {
    const uris = existingUris();
    for (const track of lastPlaylistResults) {
      if (draft.tiles.length >= 16) break;
      if (uris.has(track.uri) || (draft.settings.hideExplicit && track.explicit)) continue;
      draft.tiles.push(tileFromTrack(track));
      uris.add(track.uri);
    }
    renderTileList();
    renderResults(lastPlaylistResults, els.playlistResults);
  }

  function renderSettings() {
    els.endOfSongRadios.forEach((r) => {
      r.checked = r.value === draft.settings.endOfSong;
    });
    els.volumeSlider.value = String(Math.round(draft.settings.maxVolume * 100));
    els.sleepTimerSelect.value = draft.settings.sleepTimerMinutes ? String(draft.settings.sleepTimerMinutes) : '';
    els.hideExplicitToggle.checked = draft.settings.hideExplicit;
  }

  function bindSettings() {
    els.endOfSongRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) draft.settings.endOfSong = r.value;
      });
    });
    els.volumeSlider.addEventListener('input', () => {
      draft.settings.maxVolume = Number(els.volumeSlider.value) / 100;
    });
    els.sleepTimerSelect.addEventListener('change', () => {
      draft.settings.sleepTimerMinutes = els.sleepTimerSelect.value ? Number(els.sleepTimerSelect.value) : null;
    });
    els.hideExplicitToggle.addEventListener('change', () => {
      draft.settings.hideExplicit = els.hideExplicitToggle.checked;
      renderResults(lastSearchResults, els.searchResults);
      renderResults(lastPlaylistResults, els.playlistResults);
    });
    els.changePinBtn.addEventListener('click', async () => {
      const pin = window.prompt('New 4-digit PIN:');
      if (pin === null) return;
      if (!/^\d{4}$/.test(pin)) {
        window.alert('PIN must be exactly 4 digits.');
        return;
      }
      draft.settings.pinHash = await hashPin(pin);
      window.alert('PIN updated — remember to tap Save.');
    });
  }

  function bindSearch() {
    els.searchInput.addEventListener('input', () => {
      searchQuery = els.searchInput.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runSearch(true), 400);
    });
    els.searchLoadMore.addEventListener('click', () => runSearch(false));
    els.playlistFetchBtn.addEventListener('click', fetchPlaylist);
    els.playlistAddAllBtn.addEventListener('click', addAllFromPlaylist);
    els.tabSearchBtn.addEventListener('click', () => switchTab('search'));
    els.tabPlaylistBtn.addEventListener('click', () => switchTab('playlist'));
  }

  function switchTab(tab) {
    els.tabSearchBtn.classList.toggle('active', tab === 'search');
    els.tabPlaylistBtn.classList.toggle('active', tab === 'playlist');
    els.searchPanel.hidden = tab !== 'search';
    els.playlistPanel.hidden = tab !== 'playlist';
  }

  function hasUnsavedChanges() {
    return JSON.stringify(draft) !== JSON.stringify(getSavedConfig());
  }

  function bindSaveActions() {
    els.saveBtn.addEventListener('click', () => {
      if (draft.tiles.length < 4) {
        window.alert('Add at least 4 songs before saving.');
        return;
      }
      saveAndApply(draft);
      els.saveStatus.textContent = 'Saved.';
      setTimeout(() => (els.saveStatus.textContent = ''), 2000);
    });

    els.exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ version: 1, tiles: draft.tiles, settings: draft.settings }, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kids-music-tiles-config.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    els.importBtn.addEventListener('click', () => els.importFileInput.click());
    els.importFileInput.addEventListener('change', async () => {
      const file = els.importFileInput.files && els.importFileInput.files[0];
      els.importFileInput.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = validateImportedConfig(JSON.parse(text));
        draft = parsed;
        renderTileList();
        renderSettings();
        els.saveStatus.textContent = 'Imported — tap Save to apply.';
      } catch (e) {
        window.alert('Couldn’t import that file: ' + e.message);
      }
    });

    els.copyLinkBtn.addEventListener('click', async () => {
      if (draft.tiles.length < 4) {
        window.alert('Add at least 4 songs first.');
        return;
      }
      const link = encodeShareLink(draft);
      try {
        await navigator.clipboard.writeText(link);
        els.saveStatus.textContent = 'Setup link copied.';
      } catch (e) {
        window.prompt('Copy this link:', link);
      }
      setTimeout(() => (els.saveStatus.textContent = ''), 2500);
    });

    els.doneBtn.addEventListener('click', () => {
      if (hasUnsavedChanges() && !window.confirm('Discard unsaved changes?')) return;
      onDone();
    });

    els.logoutBtn.addEventListener('click', onLogout);
    els.reloginBtn.addEventListener('click', onRelogin);
  }

  bindSettings();
  bindSearch();
  bindSaveActions();

  return {
    async show(profile) {
      draft = JSON.parse(JSON.stringify(getSavedConfig()));
      renderAccount(profile);
      renderTileList();
      renderSettings();
      lastSearchResults = [];
      lastPlaylistResults = [];
      els.searchInput.value = '';
      els.playlistInput.value = '';
      els.searchResults.innerHTML = '';
      els.playlistResults.innerHTML = '';
      els.playlistError.hidden = true;
      els.playlistAddAllBtn.hidden = true;
      switchTab('search');
    },
  };
}
