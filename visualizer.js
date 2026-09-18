// A classic Winamp-style spectrum analyzer, drawn on a <canvas>.
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
const MIN_BARS = 16;
const MAX_BARS = 48;
const PX_PER_BAR = 14; // roughly how wide (css px) each bar+gap reads as
const BAR_FILL_RATIO = 0.72; // fraction of each bar's column it actually fills
const SEGMENT_STRIDE = 5; // css px between LED-style gap lines
const SEGMENT_HEIGHT = 1.5;
const FRAME_INTERVAL_MS = 50; // ~20fps — plenty smooth for chunky bars, cheap on battery
const PEAK_CAP_HEIGHT = 2;
const PEAK_FALL_PER_SEC = 0.7; // fraction of full height per second

export function createVisualizer({ canvas }) {
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

    const barCount = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.round(cssWidth / PX_PER_BAR)));
    bars = Array.from({ length: barCount }, makeBar);

    gradient = ctx.createLinearGradient(0, cssHeight, 0, 0);
    gradient.addColorStop(0, '#00e676');
    gradient.addColorStop(0.55, '#ffea00');
    gradient.addColorStop(0.8, '#ff9100');
    gradient.addColorStop(1, '#ff1744');
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

    const stride = cssWidth / bars.length;
    const barWidth = Math.max(1, stride * BAR_FILL_RATIO);

    ctx.fillStyle = gradient;
    bars.forEach((bar, i) => {
      const h = bar.value * cssHeight;
      if (h <= 0) return;
      const x = i * stride + (stride - barWidth) / 2;
      ctx.fillRect(x, cssHeight - h, barWidth, h);
    });

    // Cuts transparent gap lines across the filled bars so they read as
    // segmented LED blocks instead of solid columns.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let y = cssHeight - SEGMENT_STRIDE; y > 0; y -= SEGMENT_STRIDE) {
      ctx.fillRect(0, y, cssWidth, SEGMENT_HEIGHT);
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    bars.forEach((bar, i) => {
      if (bar.peak <= 0) return;
      const x = i * stride + (stride - barWidth) / 2;
      const peakY = Math.max(0, cssHeight - bar.peak * cssHeight - PEAK_CAP_HEIGHT);
      ctx.fillRect(x, peakY, barWidth, PEAK_CAP_HEIGHT);
    });
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
    setPlaying(isPlaying) {
      playing = !!isPlaying;
    },
  };
}
