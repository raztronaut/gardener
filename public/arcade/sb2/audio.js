// Super Bomberman 2 · Tall — sound (Web Audio).
//
// Music: each stage's battle theme from the harness recordings (data/sb2/assets/audio/,
// tools/sb2/NOTES-extract.md): `<stage>_loop.ogg` = intro + exactly one loop, played with
// loopStart / loopEnd from audio.json so it loops seamlessly. Stage 4's song has no common
// loop point (its channels never realign within the 620 s recording), so it streams the
// full recording through a media element: a round never lasts that long.
// SFX: the effects isolated from the original, triggered by the sound ids the core puts
// on its events (game.events[].sfx: $48 bomb, $42 explosion, $4C/$61/$55 items, $44
// kick, $43 lift, $45 throw, $46 draw, $4E hurry, $72 first falling block).
// One voice per effect id (a repeat restarts it, like the original's driver).
// The kiosk's Chrome allows autoplay, so the context starts without a gesture.
import { ASSET_BASE } from './render/pack.js';

const RATE = 32040;   // the SNES APU rate: decoded buffers stay small and unresampled

export function createAudio(manifest) {
  let ctx = null;
  try { ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' }); } catch { try { ctx = new AudioContext(); } catch { ctx = null; } }
  const master = ctx ? ctx.createGain() : null;
  const musicGain = ctx ? ctx.createGain() : null;
  const sfxGain = ctx ? ctx.createGain() : null;
  if (ctx) {
    master.gain.value = 0.9; musicGain.gain.value = 0.55; sfxGain.gain.value = 0.9;
    musicGain.connect(master); sfxGain.connect(master); master.connect(ctx.destination);
  }
  const bySound = new Map();     // sound id -> sfx entry
  for (const s of (manifest.sfx || [])) bySound.set(parseInt(String(s.sound_id).replace('$', ''), 16), s);
  const buffers = new Map();     // url -> Promise<AudioBuffer>
  const voices = new Map();      // sound id -> source node
  let music = null;              // { src | el, gain }
  let musicToken = 0;
  let closed = false;

  function resume() { if (ctx && ctx.state !== 'running' && !closed) ctx.resume().catch(() => {}); }
  resume();

  function load(url) {
    if (!ctx) return Promise.resolve(null);
    let p = buffers.get(url);
    if (!p) {
      p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url)))).then((b) => ctx.decodeAudioData(b)).catch(() => null);
      buffers.set(url, p);
    }
    return p;
  }
  const sfxUrl = (s) => ASSET_BASE + 'audio/sfx/' + s.ogg;
  const musicEntry = (name) => (manifest.music || []).find((m) => m.name === name);

  // warm the effect buffers (small)
  function preloadSfx() { return Promise.all([...bySound.values()].map((s) => load(sfxUrl(s)))); }

  function playSfx(id) {
    if (!ctx || closed) return;
    const s = bySound.get(id);
    if (!s) return;
    load(sfxUrl(s)).then((buf) => {
      if (!buf || closed) return;
      const old = voices.get(id);
      if (old) { try { old.stop(); } catch { /* ended */ } }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(sfxGain);
      src.start();
      voices.set(id, src);
      src.onended = () => { if (voices.get(id) === src) voices.delete(id); };
    });
  }

  function stopMusic(fade = 0) {
    musicToken++;
    const m = music;
    music = null;
    if (!m || !ctx) return;
    const t = ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
    setTimeout(() => {
      try { m.src && m.src.stop(); } catch { /* stopped */ }
      if (m.el) { m.el.pause(); m.el.removeAttribute('src'); m.el.load(); }
      try { m.gain.disconnect(); } catch { /* gone */ }
    }, Math.max(10, fade * 1000) + 30);
  }

  // name: 'battle_stageNN' | 'draw' | 'victory'; loop: use the loop points (battle themes)
  async function playMusic(name, { loop = true } = {}) {
    if (!ctx || closed) return;
    stopMusic(0);
    const token = ++musicToken;
    const e = musicEntry(name);
    if (!e) return;
    const gain = ctx.createGain();
    gain.connect(musicGain);
    if (loop && e.loop_start_s == null && e.recorded_seconds > 300) {
      // stage 4: stream the long recording (no loop point exists)
      const el = new Audio(ASSET_BASE + 'audio/music/' + e.ogg);
      el.loop = true; el.preload = 'auto';
      const node = ctx.createMediaElementSource(el);
      node.connect(gain);
      music = { el, gain };
      el.play().catch(() => {});
      return;
    }
    const file = loop && e.loop_start_s != null ? e.name + '_loop.ogg' : e.ogg;
    const buf = await load(ASSET_BASE + 'audio/music/' + file);
    if (!buf || token !== musicToken || closed) { try { gain.disconnect(); } catch { /* */ } return; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (loop && e.loop_start_s != null) {
      src.loop = true;
      src.loopStart = e.loop_start_s;
      src.loopEnd = Math.min(buf.duration, e.loop_start_s + e.loop_length_s);
    }
    src.connect(gain);
    src.start();
    music = { src, gain };
  }

  function preloadMusic(name, loop = true) {
    const e = musicEntry(name);
    if (!e || (loop && e.loop_start_s == null && e.recorded_seconds > 300)) return Promise.resolve();
    return load(ASSET_BASE + 'audio/music/' + (loop && e.loop_start_s != null ? e.name + '_loop.ogg' : e.ogg));
  }

  // the core's events of one tick
  function events(list) {
    for (const ev of list) {
      if (ev.sfx != null) playSfx(ev.sfx);
      else if (ev.type === 'sfx' && ev.id != null) playSfx(ev.id);
    }
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); if (music && music.el) music.el.pause(); }
  function wake() { resume(); if (music && music.el) music.el.play().catch(() => {}); }
  function close() {
    closed = true;
    stopMusic(0);
    for (const v of voices.values()) { try { v.stop(); } catch { /* */ } }
    voices.clear();
    if (ctx) ctx.close().catch(() => {});
  }

  return { ctx, playMusic, stopMusic, preloadMusic, preloadSfx, playSfx, events, suspend, wake, close, resume };
}
