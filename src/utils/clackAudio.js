/** How many files you have: public/audio/clack1.mp3 … clack{N}.mp3 */
export const CLACK_MP3_COUNT = 8;

const CLACK_URLS = Array.from(
  { length: CLACK_MP3_COUNT },
  (_, i) => `/audio/clack${i + 1}.mp3`,
);

const CARRIAGE_RETURN_URL = '/audio/carriagereturn.mp3';

/** Per-hit gain (stacked hits sum before master — keep moderate to avoid digital clipping). */
const VOICE_GAIN = 0.55;
const MASTER_GAIN = 0.38;

let audioCtx = null;
let masterGain = null;
let compressor = null;
const buffers = new Map();
const loading = new Map();

function getContext() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = MASTER_GAIN;

  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-18, audioCtx.currentTime);
  compressor.knee.setValueAtTime(18, audioCtx.currentTime);
  compressor.ratio.setValueAtTime(3.5, audioCtx.currentTime);
  compressor.attack.setValueAtTime(0.002, audioCtx.currentTime);
  compressor.release.setValueAtTime(0.08, audioCtx.currentTime);

  masterGain.connect(compressor);
  compressor.connect(audioCtx.destination);
  return audioCtx;
}

/**
 * Call synchronously from input handlers (keydown, pointerdown, …) so the browser
 * ties AudioContext.resume() to user activation. Async resume after awaits does not unlock audio.
 */
export function resumeAudioContextSync() {
  const ctx = getContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

let unlockListenersInstalled = false;

/** First pointer / touch / key / click resumes audio (helps intro if user interacts early). */
export function installAudioUnlockListeners() {
  if (unlockListenersInstalled) return;
  unlockListenersInstalled = true;
  const opts = { capture: true, passive: true, once: true };
  const unlock = () => {
    resumeAudioContextSync();
  };
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('touchstart', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
  window.addEventListener('click', unlock, opts);
}

async function decodeUrl(url) {
  if (buffers.has(url)) return buffers.get(url);
  if (loading.has(url)) return loading.get(url);

  const p = (async () => {
    const ctx = getContext();
    if (!ctx) throw new Error('no AudioContext');
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const raw = await res.arrayBuffer();
    const copy = raw.slice(0);
    const buf = await ctx.decodeAudioData(copy);
    buffers.set(url, buf);
    return buf;
  })().finally(() => {
    loading.delete(url);
  });

  loading.set(url, p);
  return p;
}

/**
 * Warm all clacks after user lands (reduces first-key delay and decode races).
 */
export function prefetchClackBuffers() {
  installAudioUnlockListeners();
  void Promise.all([
    ...CLACK_URLS.map((u) => decodeUrl(u).catch(() => {})),
    decodeUrl(CARRIAGE_RETURN_URL).catch(() => {}),
  ]);
}

function connectAndStart(ctx, buffer, gain) {
  if (!buffer || !masterGain || ctx.state === 'closed') return;
  try {
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = gain;
    src.buffer = buffer;
    src.connect(g);
    g.connect(masterGain);
    src.start(ctx.currentTime);
  } catch {
    /* ignore */
  }
}

/**
 * Each clack chains off ctx.resume() so rapid keys don’t pile onto one shared await queue
 * (which could drop or delay overlapping shots). resume() is invoked from the keydown stack
 * via resumeAudioContextSync + the first .resume() here.
 */
function playOneShot(url, gain = VOICE_GAIN) {
  const ctx = getContext();
  if (!ctx || !masterGain) return;

  const cached = buffers.get(url);
  if (cached && ctx.state === 'running') {
    connectAndStart(ctx, cached, gain);
    return;
  }

  void ctx
    .resume()
    .then(() => decodeUrl(url))
    .then((buffer) => {
      if (!buffer) return;
      if (ctx.state === 'running') {
        connectAndStart(ctx, buffer, gain);
        return;
      }
      if (ctx.state === 'closed') return;
      void ctx.resume().then(() => {
        if (ctx.state === 'running') connectAndStart(ctx, buffer, gain);
      });
    })
    .catch(() => {});
}

/**
 * Random clack via Web Audio — each hit is a fresh BufferSource (clean overlap, no HTMLAudio decoder fights).
 */
export function playRandomKeyClack() {
  const url = CLACK_URLS[Math.floor(Math.random() * CLACK_URLS.length)];
  playOneShot(url);
}

/** Carriage return / Enter — dedicated sample (public/audio/carriagereturn.mp3). */
export function playCarriageReturn() {
  playOneShot(CARRIAGE_RETURN_URL);
}
