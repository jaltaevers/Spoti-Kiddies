const TAP_DEBOUNCE_MS = 800;
const HOLD_MS = 2250; // 75% of the original 3000ms
const FADE_MS = 30_000;
const TILE_PALETTE = ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'];
const SPARKLES = ['✨', '⭐', '🎉'];
// Cover mode: album art (or a manual emoji+color override), no text — for
// kids who recognize songs by photo. Simple mode: an emoji + the song's
// name on every tile — for kids who can read and would rather pick by
// name. This default emoji only applies when a tile has no manual
// override, which always wins in either mode.
const SIMPLE_MODE_EMOJI = ['🎵', '🎶', '🎤', '🥁', '🎸', '🎹', '🎺', '🌟', '🦄', '🌈', '🎈', '🐥', '🍭', '🚀', '🐬', '🎉'];

// Scales to any tile count (there's no fixed cap on how many a kid can
// have) by keeping the grid roughly square rather than stopping at a
// hardcoded ceiling — e.g. 4→2×2, 9→3×3, 16→4×4, 30→6×5. Very large
// counts still fit: .kid-grid falls back to scrolling rather than
// squeezing tiles down indefinitely.
function computeLayout(count) {
  if (count <= 0) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

function isPortrait() {
  return window.matchMedia('(orientation: portrait)').matches;
}

export function createKidMode({ els, player, getConfig, onOpenParentGate }) {
  const lastTapAt = new Map();
  let activeTileIndex = -1;
  // The source of truth for "what's playing" — activeTileIndex is only
  // ever a position within *some* tile array, which is meaningless (or
  // actively misleading, pointing at an unrelated song) once a different
  // kid's differently-ordered grid renders. Every renderGrid() re-derives
  // activeTileIndex from this against the current tiles, and drops it —
  // hiding the now-playing bar — if it's not one of this kid's songs.
  let activeTrackUri = null;
  let holdTimer = null;
  let sleepTimerHandle = null;
  let fadeIntervalHandle = null;
  let progressTickHandle = null;
  let lastState = { position: 0, durationMs: 0, updatedAt: 0, paused: true };

  function paintTileVisual(btn, tile, index, displayMode) {
    btn.style.background = '';
    btn.style.backgroundImage = '';
    btn.innerHTML = '';
    if (tile.override) {
      btn.style.background = tile.override.color;
      const span = document.createElement('span');
      span.className = 'kid-tile-emoji';
      span.textContent = tile.override.emoji;
      btn.appendChild(span);
    } else if (displayMode === 'simple') {
      const span = document.createElement('span');
      span.className = 'kid-tile-emoji';
      span.textContent = SIMPLE_MODE_EMOJI[index % SIMPLE_MODE_EMOJI.length];
      btn.appendChild(span);
    } else if (tile.albumArtUrl) {
      btn.style.backgroundImage = `url("${tile.albumArtUrl}")`;
    }

    if (displayMode === 'simple') {
      const label = document.createElement('span');
      label.className = 'kid-tile-label';
      label.textContent = tile.title || '';
      btn.appendChild(label);
    }

    const eq = document.createElement('span');
    eq.className = 'kid-tile-eq';
    eq.innerHTML = '<i></i><i></i><i></i>';
    btn.appendChild(eq);
  }

  function renderGrid() {
    const config = getConfig();
    const tiles = config.tiles;
    const displayMode = config.settings.tileDisplay === 'simple' ? 'simple' : 'cover';
    const { cols, rows } = computeLayout(tiles.length);
    const portrait = isPortrait();
    els.grid.style.setProperty('--cols', String(portrait ? rows : cols));
    els.grid.style.setProperty('--rows', String(portrait ? cols : rows));
    els.grid.innerHTML = '';

    tiles.forEach((tile, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kid-tile';
      btn.style.setProperty('--tile-color', TILE_PALETTE[index % TILE_PALETTE.length]);
      btn.setAttribute('aria-label', tile.title || 'song');
      paintTileVisual(btn, tile, index, displayMode);
      btn.addEventListener('click', () => handleTap(index, btn));
      els.grid.appendChild(btn);
    });

    if (activeTrackUri) {
      const idx = tiles.findIndex((t) => t.uri === activeTrackUri);
      if (idx === -1) {
        // Whatever was last playing isn't one of this kid's songs (most
        // often: a different kid's grid is now showing) — nothing here
        // should claim to be "now playing".
        activeTileIndex = -1;
        activeTrackUri = null;
        closeNowPlaying();
      } else {
        activeTileIndex = idx;
        if (!els.overlay.hidden) renderNowPlayingArt();
      }
    }

    updateActiveTileVisual();
    renderGreeting();
  }

  function renderGreeting() {
    if (!els.greeting) return;
    const name = getConfig().settings.kidName && getConfig().settings.kidName.trim();
    els.greeting.hidden = !name;
    if (name) els.greeting.textContent = `🎵 ${name}’s Music`;
  }

  function spawnSparkles(originBtn) {
    if (!els.sparkleLayer || !originBtn) return;
    const rect = originBtn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    for (let i = 0; i < 6; i++) {
      const span = document.createElement('span');
      span.className = 'sparkle';
      span.textContent = SPARKLES[i % SPARKLES.length];
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const distance = 60 + Math.random() * 40;
      span.style.left = `${centerX}px`;
      span.style.top = `${centerY}px`;
      span.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      span.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
      els.sparkleLayer.appendChild(span);
      const remove = () => span.remove();
      span.addEventListener('animationend', remove);
      // Fallback in case animationend doesn't fire for some reason — this
      // runs for hours unattended, so a stray sparkle must not linger.
      setTimeout(remove, 1000);
    }
  }

  function updateActiveTileVisual() {
    Array.from(els.grid.children).forEach((btn, i) => {
      btn.classList.toggle('is-playing', i === activeTileIndex);
    });
  }

  // Phase 0 only ever proved one shape of play request reliable on the
  // target tablet: a single track, `playTracks([uri], 0)` (see spike/app.js).
  // "Continue to next tile" (the default) instead queues every tile in the
  // grid in one call and sets repeat mode before anything has played —
  // never exercised in that testing. pendingFullQueuePlay lets the
  // playback_error handler below fall back to the proven single-track
  // shape if that untested path fails, without double-starting playback
  // on the ordinary path where it succeeds.
  let pendingFullQueuePlay = null;

  function markTilePlaying(index) {
    activeTileIndex = index;
    activeTrackUri = getConfig().tiles[index] ? getConfig().tiles[index].uri : null;
    updateActiveTileVisual();
    openNowPlaying();
    hideError();
  }

  async function handleTap(index, btn) {
    const config = getConfig();
    const tile = config.tiles[index];
    if (!tile) return;
    const now = Date.now();
    if (now - (lastTapAt.get(tile.id) || 0) < TAP_DEBOUNCE_MS) return;
    lastTapAt.set(tile.id, now);
    spawnSparkles(btn);
    pendingFullQueuePlay = null;

    try {
      await player.activateElement();
      const mode = config.settings.endOfSong;
      if (mode === 'stop') {
        await player.playTracks([tile.uri], 0);
        player.setRepeatMode('off').catch(() => {});
      } else if (mode === 'repeat') {
        await player.playTracks([tile.uri], 0);
        player.setRepeatMode('track').catch(() => {});
      } else {
        pendingFullQueuePlay = { tile, at: Date.now() };
        await player.playTracks(
          config.tiles.map((t) => t.uri),
          index
        );
        player.setRepeatMode('context').catch(() => {});
      }
      await player.setVolume(config.settings.maxVolume);
      markTilePlaying(index);
    } catch (e) {
      if (pendingFullQueuePlay) {
        // The untested full-queue request itself was rejected (rather
        // than accepted and failing later) — fall back right away.
        pendingFullQueuePlay = null;
        try {
          await player.playTracks([tile.uri], 0);
          await player.setVolume(config.settings.maxVolume);
          markTilePlaying(index);
          return;
        } catch (e2) {
          showError(e2);
          return;
        }
      }
      showError(e);
    }
  }

  function openNowPlaying() {
    els.overlay.hidden = false;
    renderNowPlayingArt();
    startProgressTicker();
    armSleepTimer();
  }

  function closeNowPlaying() {
    els.overlay.hidden = true;
    stopProgressTicker();
  }

  function renderNowPlayingArt() {
    const config = getConfig();
    const tile = config.tiles[activeTileIndex];
    els.npArt.innerHTML = '';
    els.npArt.style.background = '';
    els.npArt.style.backgroundImage = '';
    if (!tile) return;
    if (tile.override) {
      els.npArt.style.background = tile.override.color;
      const span = document.createElement('span');
      span.className = 'kid-tile-emoji np-emoji';
      span.textContent = tile.override.emoji;
      els.npArt.appendChild(span);
    } else if (tile.albumArtUrl) {
      els.npArt.style.backgroundImage = `url("${tile.albumArtUrl}")`;
    }
  }

  function startProgressTicker() {
    stopProgressTicker();
    progressTickHandle = setInterval(() => {
      if (lastState.paused || !lastState.durationMs) return;
      const elapsed = lastState.position + (Date.now() - lastState.updatedAt);
      const pct = Math.min(100, (elapsed / lastState.durationMs) * 100);
      els.progressBar.style.width = pct + '%';
    }, 250);
  }
  function stopProgressTicker() {
    if (progressTickHandle) clearInterval(progressTickHandle);
    progressTickHandle = null;
  }

  function armSleepTimer() {
    clearSleepTimer();
    const minutes = getConfig().settings.sleepTimerMinutes;
    if (!minutes) return;
    const totalMs = minutes * 60_000;
    sleepTimerHandle = setTimeout(() => {
      startFadeOut(getConfig().settings.maxVolume);
    }, Math.max(0, totalMs - FADE_MS));
  }
  function clearSleepTimer() {
    if (sleepTimerHandle) clearTimeout(sleepTimerHandle);
    sleepTimerHandle = null;
    if (fadeIntervalHandle) clearInterval(fadeIntervalHandle);
    fadeIntervalHandle = null;
  }

  function startFadeOut(fromVolume) {
    const steps = 20;
    let step = 0;
    fadeIntervalHandle = setInterval(() => {
      step++;
      const vol = Math.max(0, fromVolume * (1 - step / steps));
      player.setVolume(vol).catch(() => {});
      if (step >= steps) {
        clearInterval(fadeIntervalHandle);
        fadeIntervalHandle = null;
        player.pause().catch(() => {});
      }
    }, FADE_MS / steps);
  }

  function showError(e) {
    els.error.hidden = false;
    els.errorDetail.textContent = (e && e.message) || 'Something went wrong';
  }
  function hideError() {
    els.error.hidden = true;
  }

  function handlePlayPauseTap() {
    if (lastState.paused) {
      player.resume().catch((e) => showError(e));
    } else {
      player.pause().catch((e) => showError(e));
    }
  }

  function startHold() {
    els.parentGateBtn.classList.add('is-holding');
    holdTimer = setTimeout(() => {
      els.parentGateBtn.classList.remove('is-holding');
      onOpenParentGate();
    }, HOLD_MS);
  }
  function cancelHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    els.parentGateBtn.classList.remove('is-holding');
  }

  player.onStateChange((state) => {
    if (!state) return;
    const track = state.track_window && state.track_window.current_track;
    lastState = {
      position: state.position,
      durationMs: track ? track.duration_ms : 0,
      updatedAt: Date.now(),
      paused: state.paused,
    };
    els.playPause.textContent = state.paused ? '▶' : '⏸';

    // "Continue to next tile" queues the whole grid and lets Spotify
    // auto-advance through it on its own — when it does, this is the only
    // signal that the current track actually changed. Without this, the
    // now-playing art (and the grid's is-playing highlight) stayed frozen
    // on whichever tile was originally tapped instead of following along.
    if (track && track.uri) {
      const config = getConfig();
      const newIndex = config.tiles.findIndex((t) => t.uri === track.uri);
      if (newIndex !== -1 && newIndex !== activeTileIndex) {
        activeTileIndex = newIndex;
        activeTrackUri = track.uri;
        updateActiveTileVisual();
        renderNowPlayingArt();
      }
    }
  });

  player.onEvent(({ type }) => {
    // The SDK can accept a play request (no throw) and only report failure
    // moments later via this event — the case handleTap's own catch can't
    // see. If it's this tap's untested full-queue request, fall back to
    // the single-track shape Phase 0 proved reliable instead of just
    // showing an error for something a retry would likely fix.
    if (type === 'playback_error' && pendingFullQueuePlay && Date.now() - pendingFullQueuePlay.at < 5000) {
      const { tile } = pendingFullQueuePlay;
      pendingFullQueuePlay = null;
      const config = getConfig();
      const index = config.tiles.findIndex((t) => t.id === tile.id);
      player
        .playTracks([tile.uri], 0)
        .then(() => player.setVolume(config.settings.maxVolume))
        .then(() => markTilePlaying(index))
        .catch((e) => showError(e));
      return;
    }
    pendingFullQueuePlay = null;
    if (['account_error', 'playback_error', 'initialization_error', 'authentication_error'].includes(type)) {
      showError(new Error(type));
    }
  });

  els.parentGateBtn.addEventListener('pointerdown', startHold);
  els.parentGateBtn.addEventListener('pointerup', cancelHold);
  els.parentGateBtn.addEventListener('pointerleave', cancelHold);
  els.parentGateBtn.addEventListener('pointercancel', cancelHold);
  els.backBtn.addEventListener('click', closeNowPlaying);
  els.playPause.addEventListener('click', handlePlayPauseTap);

  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(renderGrid, 150);
  });

  return {
    show() {
      renderGrid();
    },
    hide() {
      closeNowPlaying();
      clearSleepTimer();
    },
  };
}
