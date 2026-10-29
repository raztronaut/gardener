// The Gardener™ — /rainforest [place]: generative forest soundscapes, synthesized live in
// Web Audio (no recordings, nothing loops audibly). A preset is a mix of layers:
//   rain     a noise bed (low hush + bright canopy patter, slowly drifting) + single drops
//   insects  a cicada drone of detuned, amplitude-modulated tones, rising and fading in waves
//   birds    calls built from frequency sweeps — whistle, trill, rise, fall, melodic song,
//            bell (araponga), squawk (macaw), laugh (kookaburra), whip (whipbird),
//            jay, woodpecker drumming, wren
//   frogs    croak pulses · monkeys: howler roars, gibbon whoops · wind: gusts in the trees
//   creek    babbling water · thunder: a rare distant roll
// Everything is scheduled a few seconds ahead from one timer. start(place) while playing
// crossfades to the new place; stop() fades out and frees the nodes.
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const PRESETS = {
  default: { label: 'Rainforest', rain: { bed: 0.55, patter: 0.11, drops: 40 }, insects: { level: 0.014, freqs: [4300, 4720, 5150], am: [38, 43, 31] },
    birds: { rate: 2, kinds: ['whistle', 'trill', 'rise', 'fall'], pitch: [1900, 4200] }, frogs: 0.18, thunder: 0.025 },
  amazon: { label: 'Amazon', rain: { bed: 0.7, patter: 0.15, drops: 60 }, insects: { level: 0.02, freqs: [3900, 4300, 4760, 5300], am: [44, 51, 39, 47] },
    birds: { rate: 2.2, kinds: ['whistle', 'trill', 'rise', 'fall', 'squawk', 'squawk'], pitch: [1500, 3800] }, frogs: 0.35, monkeys: { kind: 'howler', rate: 0.06 }, thunder: 0.05 },
  atlantic: { label: 'Mata Atlântica', rain: { bed: 0.35, patter: 0.07, drops: 22 }, insects: { level: 0.025, freqs: [3250, 3480, 3790], am: [24, 29, 21] },
    birds: { rate: 3, kinds: ['song', 'song', 'bell', 'trill', 'whistle'], pitch: [1700, 3600] }, frogs: 0.15, thunder: 0.015 },
  borneo: { label: 'Borneo', rain: { bed: 0.5, patter: 0.1, drops: 35 }, insects: { level: 0.028, freqs: [5200, 5600, 6100, 4800], am: [62, 70, 55, 66] },
    birds: { rate: 1.5, kinds: ['whistle', 'fall', 'trill'], pitch: [1500, 3400] }, frogs: 0.2, monkeys: { kind: 'gibbon', rate: 0.08 }, thunder: 0.03 },
  daintree: { label: 'Daintree', rain: { bed: 0.45, patter: 0.09, drops: 30 }, insects: { level: 0.012, freqs: [4100, 4500], am: [35, 40] },
    birds: { rate: 1.6, kinds: ['laugh', 'whip', 'whip', 'whistle', 'trill'], pitch: [1600, 3600] }, frogs: 0.25, thunder: 0.02 },
  olympic: { label: 'Olympic (temperate)', rain: { bed: 0.5, patter: 0.05, drops: 50 }, wind: 0.25, creek: 0.2,
    birds: { rate: 1, kinds: ['wren', 'song', 'whistle'], pitch: [2200, 4500] }, frogs: 0.05, thunder: 0 },
  yosemite: { label: 'Yosemite', wind: 0.45, creek: 0.3,
    birds: { rate: 1.2, kinds: ['jay', 'woodpecker', 'song', 'whistle', 'wren'], pitch: [1800, 4000] }, frogs: 0, thunder: 0 },
};
export const ALIASES = { amazonia: 'amazon', 'mata': 'atlantic', 'mataatlantica': 'atlantic', 'mata-atlantica': 'atlantic', 'atlantica': 'atlantic',
  australia: 'daintree', washington: 'olympic', temperate: 'olympic', sierra: 'yosemite', tropical: 'default', rainforest: 'default' };
export const resolve = (name) => { const k = String(name || 'default').toLowerCase().replace(/\s+/g, ''); return PRESETS[k] ? k : ALIASES[k] || null; };

let ctx = null, cur = null, buf = {};
const VOL = 0.5;

function noiseBuffer(sec, brown) {
  const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
  }
  return b;
}

// ---- one playing soundscape --------------------------------------------------
function session(P) {
  const S = { P, on: true, out: ctx.createGain(), nodes: [], timer: 0, nextWave: 0, cicada: null, wind: null };
  S.out.gain.value = 0; S.out.connect(ctx.destination);
  S.out.gain.linearRampToValueAtTime(VOL, ctx.currentTime + 3);
  const pan = (x) => { const p = ctx.createStereoPanner(); p.pan.value = x; p.connect(S.out); return p; };
  const keep = (...n) => S.nodes.push(...n);
  const loopNoise = (b, type, f, q, g, lfoRate, lfoDepth, swellRate, swellDepth, dest = S.out) => {
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const gn = ctx.createGain(); gn.gain.value = g;
    s.connect(fl).connect(gn).connect(dest); s.start(); keep(s);
    if (lfoRate) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = lfoRate; lg.gain.value = lfoDepth; l.connect(lg).connect(fl.frequency); l.start(); keep(l); }
    if (swellRate) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = swellRate; lg.gain.value = swellDepth; l.connect(lg).connect(gn.gain); l.start(); keep(l); }
    return { gain: gn, filter: fl };
  };
  // continuous layers
  if (P.rain && P.rain.bed) loopNoise(buf.brown, 'bandpass', 900, 0.4, P.rain.bed, rnd(0.03, 0.07), 225, rnd(0.015, 0.03), P.rain.bed * 0.35);
  if (P.rain && P.rain.patter) loopNoise(buf.white, 'bandpass', 5200, 0.7, P.rain.patter, rnd(0.03, 0.07), 1300, rnd(0.015, 0.03), P.rain.patter * 0.35);
  if (P.wind) S.wind = loopNoise(buf.brown, 'lowpass', 500, 0.5, P.wind * 0.3, 0, 0, 0, 0);
  if (P.creek) {
    loopNoise(buf.brown, 'lowpass', 700, 0.5, P.creek * 0.6, 0.11, 120, 0.07, P.creek * 0.15);
    const babble = loopNoise(buf.white, 'bandpass', 2200, 1.8, P.creek * 0.12, 3.7, 900, 5.3, P.creek * 0.08);
    babble.filter.Q.value = 2.2;
  }
  if (P.insects) {
    S.cicada = ctx.createGain(); S.cicada.gain.value = 0; S.cicada.connect(S.out);
    P.insects.freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const a = ctx.createGain(); a.gain.value = 0;
      const m = ctx.createOscillator(), mg = ctx.createGain(); m.frequency.value = P.insects.am[i] || 40; mg.gain.value = 0.5;
      m.connect(mg).connect(a.gain);
      const p = ctx.createStereoPanner(); p.pan.value = rnd(-0.7, 0.7);
      o.connect(a).connect(p).connect(S.cicada); o.start(); m.start(); keep(o, m);
    });
  }
  S.nextWave = ctx.currentTime + rnd(2, 8);

  // ---- one-shot voices ----
  const env = (g, at, peak, a, d) => { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d); };
  const tone = (at, type, f0, f1, d, peak, dest, attack = 0.012) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + d);
    env(g, at, peak, attack, d); o.connect(g).connect(dest); o.start(at); o.stop(at + d + attack + 0.05);
  };
  const noiseHit = (at, f, q, d, peak, dest) => {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf.drop; fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    s.connect(fl).connect(g).connect(dest); s.start(at); s.stop(at + d + 0.02);
  };
  const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
  const bird = (t, kind, base, dist, dest) => {
    const a = (x) => x * dist;
    switch (kind) {
      case 'whistle': for (let k = 0; k < 2; k++) tone(t + k * 0.28, 'sine', base, base * 1.35, 0.18, a(0.05), dest); break;
      case 'trill': { const n = Math.floor(rnd(5, 10)); for (let k = 0; k < n; k++) tone(t + k * 0.065, 'sine', base * 1.2, base * 0.85, 0.05, a(0.035), dest); break; }
      case 'rise': tone(t, 'sine', base * 0.7, base * 1.6, 0.32, a(0.045), dest); break;
      case 'fall': tone(t, 'sine', base * 1.5, base * 0.6, 0.4, a(0.04), dest); tone(t + 0.5, 'sine', base * 1.4, base * 0.7, 0.35, a(0.03), dest); break;
      case 'song': { const n = Math.floor(rnd(4, 8)); let tt = t; for (let k = 0; k < n; k++) { const f = base * pick(PENTA); const d = rnd(0.08, 0.2); tone(tt, 'sine', f, f * rnd(0.97, 1.06), d, a(0.04), dest); tt += d + rnd(0.02, 0.08); } break; }
      case 'bell': { const f = rnd(1300, 1700); for (let k = 0; k < (Math.random() < 0.5 ? 1 : 2); k++) { const at = t + k * 1.1; tone(at, 'sine', f, f, 0.6, a(0.07), dest, 0.002); tone(at, 'sine', f * 2.76, f * 2.76, 0.25, a(0.025), dest, 0.002); } break; } // araponga
      case 'squawk': { for (let k = 0; k < Math.floor(rnd(1, 3)); k++) { const at = t + k * 0.35; const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(rnd(500, 750), at); o.frequency.linearRampToValueAtTime(rnd(380, 520), at + 0.25); fl.type = 'bandpass'; fl.frequency.value = 1600; fl.Q.value = 2.5; env(g, at, a(0.05), 0.02, 0.25); o.connect(fl).connect(g).connect(dest); o.start(at); o.stop(at + 0.32); } break; } // macaw
      case 'laugh': { const n = Math.floor(rnd(8, 14)); for (let k = 0; k < n; k++) { const at = t + k * rnd(0.11, 0.15); const f = 700 + 500 * Math.sin((k / n) * Math.PI); const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, at); o.frequency.linearRampToValueAtTime(f * 1.25, at + 0.06); fl.type = 'bandpass'; fl.frequency.value = 1400; fl.Q.value = 3; env(g, at, a(0.045), 0.01, 0.09); o.connect(fl).connect(g).connect(dest); o.start(at); o.stop(at + 0.13); } break; } // kookaburra
      case 'whip': tone(t, 'sine', 1900, 2200, 0.9, a(0.04), dest, 0.08); tone(t + 1.0, 'sine', 1500, 6500, 0.08, a(0.07), dest, 0.003); break; // whipbird
      case 'jay': for (let k = 0; k < Math.floor(rnd(2, 4)); k++) noiseHit(t + k * 0.22, rnd(2300, 3000), 1.6, 0.14, a(0.16), dest); break;
      case 'woodpecker': { const n = Math.floor(rnd(14, 22)), rate = rnd(16, 22); for (let k = 0; k < n; k++) noiseHit(t + k / rate, 1200, 4, 0.02, a(0.22) * (1 - k / (n * 1.6)), dest); break; }
      case 'wren': { const n = Math.floor(rnd(10, 18)); let tt = t; for (let k = 0; k < n; k++) { const f = base * rnd(0.9, 1.7); tone(tt, 'sine', f, f * rnd(0.8, 1.2), 0.04, a(0.03), dest); tt += rnd(0.04, 0.07); } break; }
    }
  };
  const frog = (t, dest) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = rnd(110, 190); f.type = 'lowpass'; f.frequency.value = 700;
    const n = Math.floor(rnd(2, 5));
    for (let k = 0; k < n; k++) env(g, t + k * 0.16, 0.05, 0.02, 0.09);
    o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + n * 0.16 + 0.1);
  };
  const monkey = (t, kind, dest) => {
    if (kind === 'howler') { // a distant roar: buzzy low saw through a vowel formant, swelling
      const d = rnd(2.5, 4.5);
      for (const f0 of [rnd(70, 90), rnd(95, 115)]) {
        const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.15, t + d * 0.5); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + d);
        fl.type = 'bandpass'; fl.frequency.value = rnd(450, 650); fl.Q.value = 1.5;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + d * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(fl).connect(g).connect(dest); o.start(t); o.stop(t + d + 0.1);
      }
    } else { // gibbon: whoops gliding up, faster and higher, then a long one
      const n = Math.floor(rnd(5, 9)); let tt = t;
      for (let k = 0; k < n; k++) { const f = 500 + k * 70; const d = Math.max(0.18, 0.5 - k * 0.04); tone(tt, 'sine', f, f * 1.9, d, 0.045, dest, 0.03); tt += d + 0.05; }
      tone(tt, 'sine', 900, 1500, 0.9, 0.04, dest, 0.05);
    }
  };
  const thunder = (t) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf.rumble; f.type = 'lowpass'; f.frequency.value = 160;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + rnd(0.6, 1.5)); g.gain.exponentialRampToValueAtTime(0.0001, t + rnd(5, 8));
    s.connect(f).connect(g).connect(S.out); s.start(t); s.stop(t + 8.5);
  };

  const tick = () => {
    if (!S.on) return;
    const t0 = ctx.currentTime;
    if (P.rain && P.rain.drops) for (let i = 0; i < P.rain.drops; i++) {
      const t = t0 + Math.random() * 4;
      noiseHit(t, rnd(1800, 6500), rnd(2, 6), rnd(0.02, 0.06), rnd(0.02, 0.09), pan(rnd(-0.9, 0.9)));
    }
    if (S.cicada && t0 >= S.nextWave) {
      const up = rnd(6, 14), hold = rnd(4, 12), down = rnd(5, 10), peak = P.insects.level * rnd(0.6, 1.4), g = S.cicada.gain;
      g.cancelScheduledValues(t0); g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(peak, t0 + up); g.setValueAtTime(peak, t0 + up + hold); g.linearRampToValueAtTime(0, t0 + up + hold + down);
      S.nextWave = t0 + up + hold + down + rnd(4, 20);
    }
    if (S.wind) { // gusts: wander the wind's level and brightness
      const g = S.wind.gain.gain, f = S.wind.filter.frequency, at = t0 + rnd(0.5, 3.5);
      g.linearRampToValueAtTime(P.wind * rnd(0.12, 0.5), at); f.linearRampToValueAtTime(rnd(280, 1100), at);
    }
    if (P.birds) {
      const n = Math.random() < 0.85 ? Math.round(rnd(0, P.birds.rate * 2)) : 0;
      for (let i = 0; i < n; i++) bird(t0 + Math.random() * 4, pick(P.birds.kinds), rnd(...P.birds.pitch), rnd(0.25, 1), pan(rnd(-0.85, 0.85)));
    }
    if (P.frogs && Math.random() < P.frogs) frog(t0 + Math.random() * 4, pan(rnd(-0.6, 0.6)));
    if (P.monkeys && Math.random() < P.monkeys.rate) monkey(t0 + Math.random() * 3, P.monkeys.kind, pan(rnd(-0.8, 0.8)));
    if (P.thunder && Math.random() < P.thunder) thunder(t0 + Math.random() * 3);
    S.timer = setTimeout(tick, 3000);
  };
  tick();
  return S;
}
function endSession(S, fade) {
  if (!S || !S.on) return;
  S.on = false; clearTimeout(S.timer);
  const t = ctx.currentTime, g = S.out.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
  setTimeout(() => { S.nodes.forEach((n) => { try { n.stop(); } catch { /* done */ } }); try { S.out.disconnect(); } catch { /* gone */ } }, fade * 1000 + 200);
}

// ---- public API ----------------------------------------------------------------
export function isOn() { return !!(cur && cur.on); }
export function current() { return cur && cur.on ? cur.name : null; }
export function start(name = 'default') {
  const key = resolve(name); if (!key) return false;
  if (!ctx) {
    ctx = new AudioContext();
    buf = { brown: noiseBuffer(6, true), white: noiseBuffer(6, false), drop: noiseBuffer(0.1, false), rumble: noiseBuffer(9, true) };
  }
  ctx.resume().catch(() => {});
  if (cur && cur.on) { if (cur.name === key) return true; endSession(cur, 2.5); } // crossfade to the new place
  cur = session(PRESETS[key]); cur.name = key;
  return true;
}
export function stop(fade = 2) { endSession(cur, fade); }
// duck under a game / restore after (the soundscape keeps running, just silent)
export function duck(down) {
  if (!cur || !cur.on) return;
  const t = ctx.currentTime, g = cur.out.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(down ? 0 : VOL, t + (down ? 0.6 : 2.5));
}
