const TAP_DEBOUNCE_MS = 800;
const HOLD_MS = 3000;
const FADE_MS = 30_000;

function computeLayout(count) {
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  if (count <= 12) return { cols: 4, rows: 3 };
  return { cols: 4, rows: 4 };
}

function isPortrait() {
  return window.matchMedia('(orientation: portrait)').matches;
}

export function createKidMode({ els, player, getConfig, onOpenParentGate }) {
  const lastTapAt = new Map();
  let activeTileIndex = -1;
  let holdTimer = null;
  let sleepTimerHandle = null;
  let fadeIntervalHandle = null;
  let progressTickHandle = null;
  let lastState = { position: 0, durationMs: 0, updatedAt: 0, paused: true };

  function paintTileVisual(btn, tile) {
    btn.style.background = '';
    btn.style.backgroundImage = '';
    btn.innerHTML = '';
    if (tile.override) {
      btn.style.background = tile.override.color;
      const span = document.createElement('span');
      span.className = 'kid-tile-emoji';
      span.textContent = tile.override.emoji;
      btn.appendChild(span);
    } else if (tile.albumArtUrl) {
      btn.style.backgroundImage = `url("${tile.albumArtUrl}")`;
    }
    const eq = document.createElement('span');
    eq.className = 'kid-tile-eq';
    eq.innerHTML = '<i></i><i></i><i></i>';
    btn.appendChild(eq);
  }

  function renderGrid() {
    const config = getConfig();
    const tiles = config.tiles;
    const { cols, rows } = computeLayout(tiles.length);
    const portrait = isPortrait();
    els.grid.style.setProperty('--cols', String(portrait ? rows : cols));
    els.grid.style.setProperty('--rows', String(portrait ? cols : rows));
    els.grid.innerHTML = '';

    tiles.forEach((tile, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kid-tile';
      btn.setAttribute('aria-label', tile.title || 'song');
      paintTileVisual(btn, tile);
      btn.addEventListener('click', () => handleTap(index));
      els.grid.appendChild(btn);
    });

    updateActiveTileVisual();
  }

  function updateActiveTileVisual() {
    Array.from(els.grid.children).forEach((btn, i) => {
      btn.classList.toggle('is-playing', i === activeTileIndex);
    });
  }

  async function handleTap(index) {
    const config = getConfig();
    const tile = config.tiles[index];
    if (!tile) return;
    const now = Date.now();
    if (now - (lastTapAt.get(tile.id) || 0) < TAP_DEBOUNCE_MS) return;
    lastTapAt.set(tile.id, now);

    try {
      await player.activateElement();
      const mode = config.settings.endOfSong;
      if (mode === 'stop') {
        await player.setRepeatMode('off');
        await player.playTracks([tile.uri], 0);
      } else if (mode === 'repeat') {
        await player.setRepeatMode('track');
        await player.playTracks([tile.uri], 0);
      } else {
        await player.setRepeatMode('context');
        await player.playTracks(
          config.tiles.map((t) => t.uri),
          index
        );
      }
      await player.setVolume(config.settings.maxVolume);
      activeTileIndex = index;
      updateActiveTileVisual();
      openNowPlaying();
      hideError();
    } catch (e) {
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
  });

  player.onEvent(({ type }) => {
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
  window.addEventListener('resize', () => renderGrid());

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
