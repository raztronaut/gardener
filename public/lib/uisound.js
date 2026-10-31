// The Gardener™ — interface sounds: soft clicks for the wall, synthesized in Web Audio
// (no files). Quiet by design, and silent at night, during Arcade games (the game owns
// the speakers then) and while the page is hidden.
//
//   uiSound('tick')     a tap on a card / button / row
//   uiSound('nav')      the controller moves focus (softer)
//   uiSound('open')     a panel opens  (a small rising pop)
//   uiSound('close')    a panel closes (falling)
//   uiSound('confirm')  a seed is planted (three-note chime)
//   uiSound('select')   the controller's A: a brighter two-tone press
//   uiSound('wake')     the wall wakes from night: a warm swell + a rising chime
let ctx = null, master = null, noise = null, last = 0;
const VOL = 1.0;
const BOOST = 2.5; // every tone ×2.5 (humans: "much louder", 2026-10-30), capped below clipping
const pk = (v) => Math.min(0.6, v * BOOST);

function ready() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return false; }
    master = ctx.createGain(); master.gain.value = VOL; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate); // 50 ms of white noise, reused
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return true;
}
const quiet = () => document.hidden || document.body.classList.contains('night') || document.body.classList.contains('arcade-full');

// a sine blip with a fast attack and an exponential tail
function blip(t, freq, dur, peak, type = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(pk(peak), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
// a band-passed noise click (the "physical" part of a tick)
function click(t, centre, dur, peak) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = 'bandpass'; f.frequency.value = centre; f.Q.value = 1.4;
  g.gain.setValueAtTime(pk(peak), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.01);
}

// the wall waking: a soft detuned pad swells in, then a rising major-ninth chime over it
function wake(t) {
  const pad = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1800, t + 1.6);
  pad.gain.setValueAtTime(0.0001, t); pad.gain.exponentialRampToValueAtTime(pk(0.05), t + 1.2); pad.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
  pad.connect(lp).connect(master);
  for (const [f, d] of [[261.63, -6], [261.63, 6], [392, 0], [523.25, 3]]) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = d;
    o.connect(pad); o.start(t); o.stop(t + 3.7);
  }
  [523.25, 659.25, 783.99, 1174.66].forEach((f, i) => blip(t + 0.55 + i * 0.16, f, 1.1, 0.035));
}

export function uiSound(kind = 'tick') {
  if (quiet() || !ready()) return;
  const now = performance.now();
  // one action = one sound: a click that opens something already ticked, so a tick/nav
  // within 150 ms of any other sound is dropped (the HN row tap + its reader opening)
  if ((kind === 'tick' || kind === 'nav') && now - last < 150) return;
  last = now;
  const t = ctx.currentTime + 0.005;
  if (kind === 'tick') { click(t, 3800, 0.012, 0.22); blip(t, 2300, 0.035, 0.05); }
  else if (kind === 'nav') { click(t, 2600, 0.010, 0.12); blip(t, 1700, 0.03, 0.03); }
  else if (kind === 'open') { blip(t, 620, 0.09, 0.07); blip(t + 0.045, 930, 0.12, 0.06); }
  else if (kind === 'close') { blip(t, 880, 0.08, 0.06); blip(t + 0.04, 590, 0.11, 0.05); }
  else if (kind === 'confirm') { [1046.5, 1318.5, 1568].forEach((f, i) => blip(t + i * 0.07, f, 0.35, 0.045)); }
  else if (kind === 'select') { click(t, 4200, 0.012, 0.2); blip(t, 1175, 0.07, 0.06); blip(t + 0.05, 1760, 0.12, 0.055); }
  else if (kind === 'wake') wake(t);
}

// taps anywhere on something interactive
export function wireClickSounds() {
  const SEL = 'button, a[href], .clickable, [role="button"], #garden > .card[data-wid], .cl-row, summary, input[type="checkbox"]';
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest(SEL)) uiSound('tick');
  }, true);
}
