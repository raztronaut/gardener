// The Gardener™ — /rainforest [place]: forest ambience from REAL field recordings.
// The audio lives in the gitignored data/ambience/ (built by tools/ambience/, credits in
// data/ambience/credits.json) and is served read-only by GET /api/ambience/<path>.
// manifest.json lists, per place:
//   beds     [{file, seconds, gain}]  long soundscape takes, played back to back in a shuffled
//            order with long equal-power crossfades (each take starts and ends inside the
//            overlap, so there is never a seam or a gap)
//   accents  [{file, gain}]           single bird / animal calls, dropped in sparsely at random
//            times, at a random stereo position and a slightly varied level
// Only the active place is decoded: the playing take, the next one (prefetched shortly before
// its crossfade) and a few accents — all at 32 kHz to keep memory small (birdsong lives well
// under 16 kHz). start(place) while playing crossfades to the new place once it is ready;
// stop() fades out and frees everything.
const rnd = (a, b) => a + Math.random() * (b - a);

export const PRESETS = {
  default: { label: 'Forest morning' },
  amazon: { label: 'Amazon' },
  atlantic: { label: 'Mata Atlântica' },
  borneo: { label: 'Borneo' },
  daintree: { label: 'Daintree' },
  olympic: { label: 'Olympic (temperate)' },
  yosemite: { label: 'Yosemite' },
};
export const ALIASES = { amazonia: 'amazon', mata: 'atlantic', mataatlantica: 'atlantic', 'mata-atlantica': 'atlantic', atlantica: 'atlantic',
  australia: 'daintree', queensland: 'daintree', washington: 'olympic', temperate: 'olympic', sierra: 'yosemite', tropical: 'amazon',
  rainforest: 'default', morning: 'default', dawn: 'default', birds: 'default', forest: 'default', malaysia: 'borneo', brazil: 'atlantic' };
export const resolve = (name) => { const k = String(name || 'default').toLowerCase().replace(/\s+/g, ''); return PRESETS[k] ? k : ALIASES[k] || null; };

const BASE = '/api/ambience/';
const VOL = 0.9;          // master level (the recordings are already loudness-matched)
const FADE_IN = 3;        // seconds, on start
const SWITCH = 4;         // seconds, crossfade between places
const XF = 14;            // seconds, crossfade between bed takes
const PREFETCH = 40;      // start decoding the next take this long before its crossfade
let ctx = null, master = null, cur = null, manifestP = null;

// equal-power fade curves (sin / cos quarter waves)
const CURVE_N = 64;
const fadeInCurve = Float32Array.from({ length: CURVE_N }, (_, i) => Math.sin((i / (CURVE_N - 1)) * Math.PI / 2));
const fadeOutCurve = Float32Array.from({ length: CURVE_N }, (_, i) => Math.cos((i / (CURVE_N - 1)) * Math.PI / 2));

function manifest() {
  manifestP ||= fetch(`${BASE}manifest.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`manifest ${r.status}`); return r.json(); })
    .catch((e) => { manifestP = null; throw e; });
  return manifestP;
}
function shuffled(n, avoidFirst) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (n > 1 && a[0] === avoidFirst) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

// ---- one playing place ---------------------------------------------------------
function session(key) {
  const S = { key, on: true, ready: false, out: ctx.createGain(), bufs: new Map(), srcs: new Set(), timer: 0,
    place: null, version: '', order: [], pos: 0, lastBed: -1, nextAt: 0, pending: false, nextAccent: 0, recentAcc: [] };
  S.out.gain.value = 0; S.out.connect(master);
  const url = (file) => `${BASE}${encodeURIComponent(key)}/${encodeURIComponent(file)}?v=${encodeURIComponent(S.version)}`;
  // decoded buffers, keyed by file; only what this place needs right now
  const load = (file) => {
    if (!S.bufs.has(file)) {
      S.bufs.set(file, fetch(url(file)).then((r) => { if (!r.ok) throw new Error(`${file} ${r.status}`); return r.arrayBuffer(); })
        .then((ab) => ctx.decodeAudioData(ab)).catch((e) => { S.bufs.delete(file); throw e; }));
    }
    return S.bufs.get(file);
  };
  const keep = (src, file, isBed) => {
    S.srcs.add(src);
    src.onended = () => {
      S.srcs.delete(src); try { src.disconnect(); } catch { /* gone */ }
      // free a take's decoded audio once it has played out (accents stay cached, they're small)
      if (isBed && ![...S.srcs].some((s) => s.file === file) && S.nextFile !== file) S.bufs.delete(file);
    };
    src.file = file;
  };
  const nextBedIndex = () => {
    const n = S.place.beds.length;
    if (S.pos >= S.order.length) { S.order = shuffled(n, S.lastBed); S.pos = 0; }
    return S.order[S.pos++];
  };
  // schedule bed i at `when`; first = the session's opening take (starts somewhere inside it)
  const playBed = (i, buf, when, first) => {
    const bed = S.place.beds[i], file = bed.file;
    const offset = first ? rnd(0, Math.max(0, buf.duration - XF * 3 - 60)) : 0;
    const dur = buf.duration - offset;
    const xf = Math.min(XF, dur / 3);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; g.gain.value = first ? 1 : 0;
    src.connect(g).connect(S.out);
    if (!first) g.gain.setValueCurveAtTime(fadeInCurve.map((v) => v * (bed.gain ?? 1)), when, xf);
    else g.gain.value = bed.gain ?? 1;
    g.gain.setValueCurveAtTime(fadeOutCurve.map((v) => v * (bed.gain ?? 1)), when + dur - xf, xf);
    keep(src, file, true);
    src.start(when, offset); src.stop(when + dur + 0.05);
    S.lastBed = i;
    S.nextAt = when + dur - xf; // the next take fades in across this one's tail
  };
  const queueNext = () => {
    S.pending = true;
    const i = nextBedIndex(), file = S.place.beds[i].file;
    S.nextFile = file;
    load(file).then((buf) => {
      if (!S.on) return;
      const when = Math.max(S.nextAt, ctx.currentTime + 0.1);
      playBed(i, buf, when, false);
      S.nextFile = null; S.pending = false;
    }).catch((e) => { console.warn('[rainforest]', e); S.pending = false; S.nextFile = null; });
  };
  const playAccent = () => {
    const acc = S.place.accents; if (!acc || !acc.length) return;
    let i, tries = 0;
    do { i = Math.floor(Math.random() * acc.length); } while (S.recentAcc.includes(i) && ++tries < 8);
    S.recentAcc.push(i); if (S.recentAcc.length > Math.min(3, acc.length - 1)) S.recentAcc.shift();
    const a = acc[i];
    load(a.file).then((buf) => {
      if (!S.on) return;
      const src = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner();
      src.buffer = buf; p.pan.value = rnd(-0.75, 0.75);
      const at = ctx.currentTime + 0.1, peak = (a.gain ?? 1) * rnd(0.55, 1), d = buf.duration;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + 0.4);
      g.gain.setValueAtTime(peak, at + Math.max(0.5, d - 0.8)); g.gain.linearRampToValueAtTime(0, at + d);
      src.connect(g).connect(p).connect(S.out);
      keep(src, a.file, false);
      src.start(at); src.stop(at + d + 0.05);
    }).catch((e) => console.warn('[rainforest]', e));
  };
  const tick = () => {
    if (!S.on) return;
    const now = ctx.currentTime;
    if (S.ready && !S.pending && now >= S.nextAt - PREFETCH) queueNext();
    if (S.ready && now >= S.nextAccent) {
      const [lo, hi] = S.place.accentEvery || [25, 70];
      if (S.nextAccent) playAccent();
      S.nextAccent = now + rnd(lo, hi);
    }
    S.timer = setTimeout(tick, 2000);
  };
  // boot: manifest → first take → fade in (or crossfade from the previous place)
  S.started = manifest().then((m) => {
    S.place = m.places && m.places[key]; S.version = m.version || '';
    if (!S.place || !S.place.beds || !S.place.beds.length) throw new Error(`no recordings for "${key}"`);
    const i = nextBedIndex();
    return load(S.place.beds[i].file).then((buf) => {
      if (!S.on) return false;
      const t = ctx.currentTime + 0.05;
      playBed(i, buf, t, true);
      S.out.gain.setValueAtTime(0, t); S.out.gain.linearRampToValueAtTime(1, t + (S.fadeIn || FADE_IN));
      S.ready = true; S.nextAccent = ctx.currentTime + rnd(6, 18);
      tick();
      return true;
    });
  }).catch((e) => { console.warn('[rainforest]', e); S.error = String(e.message || e); return false; });
  return S;
}
function endSession(S, fade) {
  if (!S || !S.on) return;
  S.on = false; clearTimeout(S.timer);
  const t = ctx.currentTime, g = S.out.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
  setTimeout(() => {
    S.srcs.forEach((s) => { try { s.stop(); } catch { /* done */ } });
    S.srcs.clear(); S.bufs.clear();
    try { S.out.disconnect(); } catch { /* gone */ }
  }, fade * 1000 + 200);
}

// ---- public API ----------------------------------------------------------------
export function isOn() { return !!(cur && cur.on); }
export function current() { return cur && cur.on ? cur.key : null; }
export function start(name = 'default') {
  const key = resolve(name); if (!key) return false;
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 32000, latencyHint: 'playback' });
    master = ctx.createGain(); master.gain.value = VOL; master.connect(ctx.destination);
  }
  ctx.resume().catch(() => {});
  if (cur && cur.on && cur.key === key) return true;
  const prev = cur && cur.on ? cur : null;
  cur = session(key);
  if (prev) { // keep the old place playing until the new one is decoded, then crossfade
    cur.fadeIn = SWITCH;
    const next = cur;
    next.started.then((ok) => { if (prev.on) endSession(prev, ok ? SWITCH : 1.5); });
  }
  return true;
}
export function stop(fade = 2) { endSession(cur, fade); }
// duck under a game / restore after (the soundscape keeps running, just silent)
export function duck(down) {
  if (!ctx || !master) return;
  const t = ctx.currentTime, g = master.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(down ? 0 : VOL, t + (down ? 0.6 : 2.5));
}
// for tests / the credits view
export function status() {
  return cur ? { key: cur.key, on: cur.on, ready: cur.ready, error: cur.error || null, decoded: cur.bufs.size, playing: cur.srcs.size,
    state: ctx && ctx.state, sampleRate: ctx && ctx.sampleRate } : null;
}
