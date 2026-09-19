// A classic Winamp-style spectrum analyzer, drawn on a <canvas>. Three
// visual variants share the same signal-generation engine below:
// 'bar-strip' (the chunky LED-segment bars on the now-playing overlay),
// 'ambient-backdrop' (a soft, blurred glow behind the kid-mode tile grid,
// low-opacity enough that tiles on top stay perfectly legible), and
// 'winamp-backdrop' (the same background placement but turned up: bolder,
// far less blurred, much more opaque — a kid or parent can switch to it by
// tapping the visualizer toggle a second time, cycling off → subtle →
// winamp, the same click-to-cycle-visualization feel the real thing had).
//
// This does NOT analyze real audio: the Spotify Web Playback SDK plays
// through its own DRM-gated pipeline with no accessible <audio> element or
// MediaStream, so there's nothing a Web Audio AnalyserNode could ever be
// attached to (and Development Mode's restricted API access rules out
// leaning on Spotify's own audio-analysis endpoint instead). Bars are
// driven by a synthetic signal — layered sine waves per bar plus a slowly
// wandering "energy" envelope — shaped to swell and settle the way a real
// spectrum does, and tied to actual play/pause state via setPlaying() so
// it goes quiet exactly when the music does.

const FRAME_INTERVAL_MS = 50; // ~20fps — plenty smooth for chunky bars, cheap on battery

const VARIANTS = {
  'bar-strip': {
    minBars: 16,
    maxBars: 48,
    pxPerBar: 14, // roughly how wide (css px) each bar+gap reads as
    barFillRatio: 0.72,
    heightRatio: 1, // bars can fill the full canvas height
    gradientStops: [
      [0, '#00e676'],
      [0.55, '#ffea00'],
      [0.8, '#ff9100'],
      [1, '#ff1744'],
    ],
    segmentStride: 5, // css px between LED-style gap lines
    segmentHeight: 1.5,
    peakCapHeight: 2,
    blurPx: 0,
  },
  'ambient-backdrop': {
    minBars: 8,
    maxBars: 16,
    pxPerBar: 90,
    barFillRatio: 1.3, // > 1 so blurred columns overlap into one soft field instead of separate blobs
    heightRatio: 0.8, // leaves the top of the screen clear
    gradientStops: [
      [0, 'rgba(0, 230, 118, 0.4)'],
      [0.55, 'rgba(255, 234, 0, 0.32)'],
      [0.8, 'rgba(255, 145, 0, 0.28)'],
      [1, 'rgba(255, 23, 68, 0.22)'],
    ],
    segmentStride: 0, // no LED segmentation — a smooth glow, not a readout
    segmentHeight: 0,
    peakCapHeight: 0, // no peak caps — too fine a detail once blurred
    blurPx: 36,
  },
  // Same placement as ambient-backdrop (behind the grid, z-index unchanged)
  // but turned up rather than washed out: more, narrower bars, nearly
  // opaque, and only lightly blurred — reads as an actual visualizer
  // filling the screen instead of a mood-lighting glow. Tiles stay tappable
  // regardless of intensity since they sit on their own opaque layer above
  // this one; it's only ever visible in the gaps and empty space around them.
  'winamp-backdrop': {
    minBars: 14,
    maxBars: 28,
    pxPerBar: 46,
    barFillRatio: 1.1,
    heightRatio: 0.98,
    gradientStops: [
      [0, 'rgba(0, 230, 118, 0.88)'],
      [0.55, 'rgba(255, 234, 0, 0.8)'],
      [0.8, 'rgba(255, 145, 0, 0.75)'],
      [1, 'rgba(255, 23, 68, 0.7)'],
    ],
    segmentStride: 0,
    segmentHeight: 0,
    peakCapHeight: 0,
    blurPx: 10,
  },
};

const PEAK_FALL_PER_SEC = 0.7; // fraction of full height per second

export function createVisualizer({ canvas, variant = 'bar-strip' }) {
  let currentVariant = variant;
  let cfg = VARIANTS[currentVariant];
  const ctx = canvas.getContext('2d');

  let cssWidth = 0;
  let cssHeight = 0;
  let bars = [];
  let gradient = null;
  let playing = false;
  let envelope = 0;
  let energyPhase = Math.random() * Math.PI * 2;
  let t = 0;
  let rafHandle = null;
  let lastFrameAt = 0;

  function makeBar() {
    return {
      freq1: 1.1 + Math.random() * 1.6,
      freq2: 2.3 + Math.random() * 2.7,
      phase1: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2,
      value: 0,
      peak: 0,
    };
  }

  // Reads the canvas's actual on-screen size so bar count/spacing scales
  // with it (a phone-width overlay and a tablet-width one shouldn't render
  // the same fixed bar count) and so drawing can happen in crisp css-pixel
  // coordinates on high-DPI screens instead of a blurry stretched bitmap.
  function resizeToDisplaySize() {
    // clientWidth/clientHeight (unlike getBoundingClientRect, which reports
    // the visually transformed box) reflect the untransformed layout size —
    // important here since start() calls this right as the panel un-hides,
    // the same moment its scaleY() entrance animation begins at 0.
    cssWidth = Math.max(1, canvas.clientWidth);
    cssHeight = Math.max(1, canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const barCount = Math.max(cfg.minBars, Math.min(cfg.maxBars, Math.round(cssWidth / cfg.pxPerBar)));
    bars = Array.from({ length: barCount }, makeBar);

    const drawHeight = cssHeight * cfg.heightRatio;
    gradient = ctx.createLinearGradient(0, cssHeight, 0, cssHeight - drawHeight);
    for (const [stop, color] of cfg.gradientStops) gradient.addColorStop(stop, color);
  }

  function step(dt) {
    t += dt;
    energyPhase += dt * 0.6;
    // A slow, non-repeating-feeling "loudness" wander so bars have quiet
    // and loud passages instead of a constant hum. Settles toward 0 (bars
    // fall flat) whenever nothing's actually playing.
    const targetEnvelope = playing ? 0.5 + 0.5 * Math.max(0, 0.6 * Math.sin(energyPhase) + 0.4 * Math.sin(energyPhase * 2.3 + 1.2)) : 0;
    envelope += (targetEnvelope - envelope) * Math.min(1, dt * (playing ? 2.2 : 5));

    for (const bar of bars) {
      const wobble = 0.5 + 0.5 * (0.6 * Math.sin(t * bar.freq1 + bar.phase1) + 0.4 * Math.sin(t * bar.freq2 + bar.phase2));
      const target = Math.max(0, Math.min(1, wobble)) * envelope;
      bar.value += (target - bar.value) * Math.min(1, dt * 9);
      bar.peak = bar.value > bar.peak ? bar.value : Math.max(bar.value, bar.peak - dt * PEAK_FALL_PER_SEC);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    if (!bars.length) return;

    const drawHeight = cssHeight * cfg.heightRatio;
    const stride = cssWidth / bars.length;
    const barWidth = Math.max(1, stride * cfg.barFillRatio);

    ctx.save();
    if (cfg.blurPx) ctx.filter = `blur(${cfg.blurPx}px)`;
    ctx.fillStyle = gradient;
    bars.forEach((bar, i) => {
      const h = bar.value * drawHeight;
      if (h <= 0) return;
      const x = i * stride + (stride - barWidth) / 2;
      ctx.fillRect(x, cssHeight - h, barWidth, h);
    });
    ctx.restore();

    // Cuts transparent gap lines across the filled bars so they read as
    // segmented LED blocks instead of solid columns. Skipped for variants
    // with no segmentStride (a soft glow has no business looking like a
    // readout).
    if (cfg.segmentStride) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (let y = cssHeight - cfg.segmentStride; y > 0; y -= cfg.segmentStride) {
        ctx.fillRect(0, y, cssWidth, cfg.segmentHeight);
      }
      ctx.restore();
    }

    if (cfg.peakCapHeight) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      bars.forEach((bar, i) => {
        if (bar.peak <= 0) return;
        const x = i * stride + (stride - barWidth) / 2;
        const peakY = Math.max(0, cssHeight - bar.peak * drawHeight - cfg.peakCapHeight);
        ctx.fillRect(x, peakY, barWidth, cfg.peakCapHeight);
      });
    }
  }

  function loop(now) {
    rafHandle = requestAnimationFrame(loop);
    if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
    const dt = lastFrameAt ? Math.min(0.25, (now - lastFrameAt) / 1000) : FRAME_INTERVAL_MS / 1000;
    lastFrameAt = now;
    step(dt);
    draw();
  }

  return {
    start() {
      if (rafHandle) return;
      resizeToDisplaySize();
      lastFrameAt = 0;
      rafHandle = requestAnimationFrame(loop);
    },
    stop() {
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = null;
      if (cssWidth && cssHeight) ctx.clearRect(0, 0, cssWidth, cssHeight);
    },
    // Re-measures the canvas's on-screen size — call after a resize/rotate
    // so bar spacing keeps matching the actual layout. Cheap no-op if the
    // panel is currently hidden (display:none reads back a 0×0 rect).
    handleResize() {
      if (rafHandle) resizeToDisplaySize();
    },
    // Switches which VARIANTS entry this instance draws with (e.g. the
    // background canvas cycling 'ambient-backdrop' -> 'winamp-backdrop').
    // Rebuilds bars/gradient immediately if currently running, since each
    // variant has its own bar count/sizing — same as a resize does.
    setVariant(newVariant) {
      if (!VARIANTS[newVariant] || newVariant === currentVariant) return;
      currentVariant = newVariant;
      cfg = VARIANTS[currentVariant];
      if (rafHandle) resizeToDisplaySize();
    },
    setPlaying(isPlaying) {
      playing = !!isPlaying;
    },
  };
}
