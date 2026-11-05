import { makeTranscript } from './voice-transcript.js';
import { designColor } from './design-values.js';
// The Gardener™ — "Hey Garden" on the wall: the Siri-style edge glow, the live words,
// the sounds and the tool calls (the listening itself is src/voice.mjs, on-device).
//
//   wake      the glow blooms in from the screen's edges + a rising chime
//   listening the edges ripple with your voice (mic level, ~30 Hz) and the words appear
//   thinking  the colours flow faster and breathe while the agent works
//   done      closure: the glow washes mint, a resolving chime, the reply, then it folds away
//   fail      a soft coral wash and a gentle falling tone
// The glow is ONE WebGL shader on a half-resolution canvas, drawn only while active —
// idle costs nothing (no canvas frames, no timers beyond the event stream).
const ORIGIN = `http://${location.hostname}:${new URLSearchParams(location.search).get('voiceport') || 8797}`; // (?voiceport= for QA)

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
uniform vec2 uRes; uniform float uTime, uLevel, uIntro, uThink, uTintAmt, uDim; uniform vec3 uTint;
uniform vec3 uPalette0, uPalette1, uPalette2, uPalette3, uPalette4;
vec3 pal(float x) {
  x = fract(x) * 5.0;
  vec3 c0 = uPalette0, c1 = uPalette1, c2 = uPalette2, c3 = uPalette3, c4 = uPalette4;
  float f = fract(x); f = f * f * (3.0 - 2.0 * f);
  if (x < 1.0) return mix(c0, c1, f);
  if (x < 2.0) return mix(c1, c2, f);
  if (x < 3.0) return mix(c2, c3, f);
  if (x < 4.0) return mix(c3, c4, f);
  return mix(c4, c0, f);
}
void main() {
  vec2 p = gl_FragCoord.xy, c = uRes * 0.5;
  float R = uRes.x * 0.07;                              // the screen's corner radius
  vec2 q = abs(p - c) - (c - R);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - R;
  float d = max(-sd, 0.0);                              // px in from the edge
  float a = atan(p.y - c.y, p.x - c.x) / 6.2831853 + 0.5; // position around the frame
  float t = uTime;
  float wob = 0.5 + 0.5 * sin(a * 6.2831853 * 3.0 + t * 1.9) * sin(a * 6.2831853 * 5.0 - t * 1.3);
  float w = uRes.x * (0.014 + 0.012 * wob + 0.075 * uLevel * (0.35 + 0.65 * wob));
  w *= uIntro;
  float glow = exp(-d / max(w, 0.6));
  float core = exp(-d / max(w * 0.14, 0.6));
  float wash = exp(-d / max(uRes.x * 0.22 * uIntro, 0.6)) * (0.10 + 0.22 * uLevel);
  vec3 col = pal(a + t * 0.05 + 0.06 * sin(t * 0.8 + a * 12.566));
  col = mix(col, uTint, uTintAmt);
  float alpha = clamp(glow * 0.82 + core * 0.55 + wash, 0.0, 1.0) * uIntro * (1.0 - 0.6 * uDim); // the Botanist's working glow: dimmer
  gl_FragColor = vec4(col * alpha, alpha);
}`;

function makeGlow() {
  const cv = document.createElement('canvas');
  cv.id = 'voiceGlow';
  document.body.appendChild(cv);
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {}; for (const n of ['uRes', 'uTime', 'uLevel', 'uIntro', 'uThink', 'uTintAmt', 'uTint', 'uDim']) U[n] = gl.getUniformLocation(pr, n);
  const paletteDefaults = [[.30,.96,.66],[.22,.80,1],[.52,.45,1],[1,.40,.72],[1,.74,.32]];
  const paletteUniforms = paletteDefaults.map((_,i)=>gl.getUniformLocation(pr,'uPalette'+i));
  const refreshPalette = () => {
    gl.useProgram(pr);
    paletteDefaults.forEach((fallback,i)=>gl.uniform3f(paletteUniforms[i],...designColor('--color-voice-'+(i+1),fallback)));
  };
  refreshPalette();
  addEventListener('garden:design',refreshPalette);
  addEventListener('garden:theme',refreshPalette);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // animated state (eased toward targets every frame)
  const S = { intro: 0, introT: 0, level: 0, levelT: 0, think: 0, thinkT: 0, tint: 0, tintT: 0, tintC: [0.45, 1, 0.75], t0: performance.now(),
    work: 0, workT: 0, time: 0, last: performance.now() }; // work = the Botanist busy on a request (a quiet, slow glow)
  let raf = 0;
  const size = () => { cv.width = Math.round(innerWidth / 2); cv.height = Math.round(innerHeight / 2); };
  size(); addEventListener('resize', size);
  const frame = (now) => {
    const k = (rate) => 1 - Math.exp(-rate * 0.016);
    S.intro += (S.introT - S.intro) * k(S.introT > S.intro ? 7 : 4.5);
    S.level += (S.levelT - S.level) * k(S.levelT > S.level ? 22 : 7);
    S.think += (S.thinkT - S.think) * k(4);
    S.tint += (S.tintT - S.tint) * k(6);
    S.work += (S.workT - S.work) * k(S.workT > S.work ? 1.2 : 2.5); // fades in slowly
    // the Botanist alone (no voice request on top): dimmer, a third of the speed, ~20 fps
    const dim = S.work * (1 - Math.min(1, S.introT));
    const dt = Math.min(0.1, (now - S.last) / 1000);
    if (dim > 0.5 && dt < 0.048) { raf = requestAnimationFrame(frame); return; }
    S.last = now; S.time += dt * (1 - 0.68 * dim);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, cv.width, cv.height);
    gl.uniform1f(U.uTime, S.time); gl.uniform1f(U.uDim, dim);
    gl.uniform1f(U.uLevel, S.level); gl.uniform1f(U.uIntro, Math.max(S.intro, S.work * 0.75));
    gl.uniform1f(U.uThink, S.think); gl.uniform1f(U.uTintAmt, S.tint);
    gl.uniform3f(U.uTint, ...S.tintC);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (S.introT === 0 && S.intro < 0.004 && S.workT === 0 && S.work < 0.004) { raf = 0; cv.classList.remove('on'); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    raf = requestAnimationFrame(frame);
  };
  const run = () => { cv.classList.add('on'); if (!raf) raf = requestAnimationFrame(frame); };
  return {
    work(on) { S.workT = on ? 1 : 0; if (on) run(); }, // the Botanist is working on a request
    wake() { S.introT = 1; S.thinkT = 0; S.tintT = 0; S.levelT = 0.15; S.intro = Math.max(S.intro, 0.02); run(); },
    level(v) { S.levelT = v; },
    think() { S.thinkT = 1; S.levelT = 0.1; run(); }, // thinking: the same slow, smooth flow — just calmer
    end(kind) {
      S.thinkT = 0; S.levelT = kind === 'done' ? 0.35 : 0;
      if (kind === 'done') { S.tintC = designColor('--color-voice-success', [0.45, 1.0, 0.74]); S.tintT = 0.85; }
      else if (kind === 'fail') { S.tintC = designColor('--color-voice-error', [1.0, 0.45, 0.38]); S.tintT = 0.75; }
      // hold the closure wash for a beat, then fold the glow back into the edges
      setTimeout(() => { S.introT = 0; S.levelT = 0; }, kind === 'cancel' ? 0 : 520);
      run();
    },
  };
}

function makeCaption(api) {
  const el = document.createElement('div');
  el.id = 'voiceCap';
  el.innerHTML = '<span class="vc-tx"></span>';
  (document.getElementById('zoomroot') || document.body).appendChild(el);
  const tx = el.querySelector('.vc-tx');
  let hideT = 0, glassT = 0, glassH = 0;
  // re-bake the glass when the pill's height changes (a new line); cached per size
  const reglass = () => { clearTimeout(glassT); glassT = setTimeout(() => { const hgt = el.offsetHeight; if (el.classList.contains('on') && hgt !== glassH) { glassH = hgt; api.glass && api.glass(el); } }, 330); }; // (after the slide-in settles)
  return {
    show(text, cls) { clearTimeout(hideT); el.className = `on ${cls || ''}`; tx.textContent = text; reglass(); },
    hide(after = 0) { clearTimeout(hideT); hideT = setTimeout(() => { el.className = ''; glassH = 0; }, after); },
  };
}

// The Botanist's card: what the Claude Code agent (src/botanist.mjs) reports back, minutes
// after the voice request — its answer, a permission it waits for, or an error. Its own
// element (never the voice caption, which may be mid-request). Two tones for contrast over
// any widget: a darker glass body with light ink, under a lighter header strip.
function makeBotanistCard(api) {
  const el = document.createElement('div');
  el.id = 'botanistCard';
  el.innerHTML = '<div class="bc-head"><i class="bc-dot"></i><span class="bc-who">The Botanist</span><span class="bc-kind"></span></div><div class="bc-tx"></div>';
  (document.getElementById('zoomroot') || document.body).appendChild(el);
  const kindEl = el.querySelector('.bc-kind'), tx = el.querySelector('.bc-tx');
  const LABEL = { done: 'done', permission: 'needs your ok', error: 'stopped' };
  let hideT = 0;
  return {
    show(kind, text) {
      clearTimeout(hideT);
      // too long to read in a card: the whole answer as a sheet in the panel
      if (kind === 'done' && text.length > 420 && api.showText) { el.className = ''; api.showText(text); return; }
      el.className = `on ${kind}${text.length > 160 ? ' long' : ''}`;
      kindEl.textContent = LABEL[kind] || '';
      tx.textContent = text;
      // a permission stays until it's answered (the next event) or 3 minutes pass
      hideT = setTimeout(() => { el.className = ''; }, kind === 'permission' ? 180000 : Math.min(30000, 8000 + text.length * 70));
    },
    hide() { clearTimeout(hideT); el.className = ''; },
    waiting: () => el.classList.contains('permission') && el.classList.contains('on'),
  };
}

// calibration card: a countdown ring, the takes heard so far, then the tuning and the result
function makeCalib() {
  const el = document.createElement('div');
  el.id = 'voiceCalib';
  el.innerHTML = `<div class="vk-card"><div class="vk-kicker">Hey Garden · calibration</div>
    <div class="vk-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg"/></svg><b class="vk-num"></b></div>
    <div class="vk-title"></div><div class="vk-sub"></div><div class="vk-dots"></div></div>`;
  (document.getElementById('zoomroot') || document.body).appendChild(el);
  const $ = (q) => el.querySelector(q), fg = $('.fg'), C = 2 * Math.PI * 52;
  fg.style.strokeDasharray = `${C}`;
  let total = 60, hideT = 0;
  const ring = (f) => { fg.style.strokeDashoffset = `${C * (1 - Math.max(0, Math.min(1, f)))}`; };
  return {
    record({ left, heard }) {
      clearTimeout(hideT); el.className = 'on rec';
      if (left > total) total = left;
      $('.vk-num').textContent = `0:${String(left).padStart(2, '0')}`;
      $('.vk-title').textContent = 'Say “Hey Garden” from around the house';
      $('.vk-sub').textContent = 'Near and far, other rooms, your normal voice — a few seconds apart';
      $('.vk-dots').innerHTML = `<span>${heard}</span> heard` + '<i></i>'.repeat(Math.min(heard, 16));
      ring(left / total);
    },
    analyze({ progress = 0 }) {
      el.className = 'on ana';
      $('.vk-num').textContent = `${Math.round(progress * 100)}%`;
      $('.vk-title').textContent = 'Tuning to your voice';
      $('.vk-sub').textContent = 'Testing every take with noise, other voices, room echo, distance and speed';
      $('.vk-dots').innerHTML = '';
      ring(progress);
    },
    done(r) {
      el.className = `on ${r.ok ? 'ok' : 'bad'}`;
      $('.vk-num').textContent = r.ok ? '✓' : '!';
      ring(1);
      if (r.ok) {
        $('.vk-title').textContent = `Calibrated — I catch ${Math.round(r.recall * 100)}% of your “Hey Garden”s`;
        $('.vk-sub').textContent = `${r.takes} takes, ${r.tests} tests (before: ${Math.round(r.recallBefore * 100)}%)${r.gain > 1 ? ` · mic boost ${r.gain.toFixed(1)}×` : ''}`;
      } else { $('.vk-title').textContent = 'Calibration didn’t finish'; $('.vk-sub').textContent = r.why || ''; }
      $('.vk-dots').innerHTML = '';
      hideT = setTimeout(() => { el.className = ''; total = 60; }, 9000);
    },
  };
}

export function startVoice(api) {
  const transcript = makeTranscript({cancel: () => post('/control', {cancel: true}), style: `
    #voiceTranscript { position:fixed; z-index:550; left:5%; right:5%; bottom:110px; padding:20px 24px; border-radius:22px; background:var(--bg-1,#091c14); color:var(--ink,#e0f5e9); border:1px solid var(--stroke); box-shadow:0 8px 32px #0006; font-family:var(--font); }
    #voiceTranscript[hidden] { display:none; }
    .vt-label { font-size:15px; color:var(--ink-soft); margin-bottom:8px; }
    .vt-text { font-size:26px; line-height:1.3; max-height:145px; overflow:auto; padding-right:100px; white-space:pre-wrap; }
    #voiceTranscript button { position:absolute; right:20px; top:20px; border:1px solid var(--stroke); border-radius:12px; background:transparent; color:inherit; font:inherit; padding:10px 14px; cursor:pointer; }
  `});
  const glow = makeGlow();
  const cap = makeCaption(api);
  const bcard = makeBotanistCard(api);
  const calib = makeCalib();
  let es = null, backoff = 2000, enabled = true, busy = false, lastEv = 0, watchdog = 0;
  // never stuck: back to rest if a listening / thinking moment hears nothing for 12 s, or
  // if the voice service restarts mid-request (its hello says it's idle)
  const settle = () => { if (busy) onEvent({ t: 'state', state: 'idle', end: 'cancel' }); };
  const arm = () => { clearTimeout(watchdog); if (busy) watchdog = setTimeout(() => { if (Date.now() - lastEv > 11000) settle(); else arm(); }, 12000); };
  const post = (path, body) => fetch(ORIGIN + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});

  const cancelledTurns = new Set();
  const onEvent = async (ev) => {
    lastEv = Date.now();
    if (ev.t === 'hello') { cancelledTurns.clear(); enabled = ev.enabled; if (ev.state === 'idle') settle(); glow && glow.work(!!ev.botanist); return; }
    if (ev.t === 'enabled') { enabled = ev.enabled; api.toast(enabled ? 'Hey Garden is listening again' : 'Hey Garden is off — the mic is closed'); return; }
    if (ev.t === 'level') { glow && glow.level(ev.v); return; }
    if (ev.t === 'calib') {
      if (ev.phase === 'record') { if (!busy) { busy = true; glow && glow.wake(); api.sound('listen'); } calib.record(ev); }
      else if (ev.phase === 'analyze') { glow && glow.think(); calib.analyze(ev); }
      else if (ev.phase === 'done') { busy = false; glow && glow.end(ev.ok ? 'done' : 'fail'); api.sound(ev.ok ? 'done' : 'fail'); calib.done(ev); }
      lastEv = Date.now(); arm();
      return;
    }
    if (ev.t === 'partial') { if (busy) transcript.update(ev.text, 'Listening · words may revise'); return; }
    if (ev.t === 'transcript') { transcript.update(ev.text, ev.phase || 'Heard'); return; }
    if (ev.t === 'cancel-turn') { cancelledTurns.add(ev.turnId); if(cancelledTurns.size>64)cancelledTurns.delete(cancelledTurns.values().next().value); return; }
    if (ev.t === 'context') { post('/reply', { id: ev.id, data: api.context() }); return; }
    if (ev.t === 'act') {
      const out = [];
      const calls = ev.calls || [];
      for (const [index, c] of calls.entries()) {
        if (ev.turnId && cancelledTurns.has(ev.turnId)) break;
        try { out.push(await api.act(c)); } catch (e) { out.push({ ok: false, error: String(e && e.message || e) }); }
        if (index < calls.length - 1) await new Promise((r) => setTimeout(r, 90)); // pause BETWEEN actions only
      }
      post('/reply', { id: ev.id, data: out });
      return;
    }
    if (ev.t === 'botanist') { // the Botanist reports back (any time, independent of a request)
      // working: the quiet edge glow stays on until THIS request is done / failed / stopped
      if (ev.kind === 'working') { if (bcard.waiting()) bcard.hide(); glow && glow.work(true); return; }
      if (ev.kind === 'idle') { if (bcard.waiting()) bcard.hide(); glow && glow.work(false); return; }
      if (ev.kind === 'dismiss') { bcard.hide(); return; } // answered (allow / deny): the gold card goes
      if (ev.kind === 'done' || ev.kind === 'error') glow && glow.work(false);
      api.sound(ev.kind === 'error' ? 'fail' : ev.kind === 'permission' ? 'heard' : 'done');
      bcard.show(ev.kind, String(ev.text || ''));
      return;
    }
    if (ev.t !== 'state') return;
    if (ev.state === 'listening') {
      busy = true; arm();
      api.duck(true);
      glow && glow.wake();
      api.sound('listen');
      cap.hide(0);
      transcript.update('', 'Listening');
    } else if (ev.state === 'thinking') {
      transcript.update(ev.text || '', 'Working');
      arm();
      glow && glow.think();
      api.sound('heard');
    } else if (ev.state === 'idle' && busy) {
      busy = false; clearTimeout(watchdog);
      transcript.hide(ev.end === 'cancel' ? 0 : 1400);
      const end = ev.end || 'cancel';
      glow && glow.end(end);
      if (end === 'done') {
        api.sound('done');
        const r = ev.reply || '';
        // the answer is always shown whole: in the caption (wrapping, smaller when longer), or —
        // when it's too long to read there — as a sheet in the panel
        // the voice service says caption or sheet (Jev reads the answer); else: by length
        if (ev.format ? ev.format === 'sheet' : r.length > 320) { cap.hide(0); api.showText(r); }
        else if (r) { cap.show(r, `done${r.length > 60 ? ' long' : ''}${r.length > 170 ? ' xl' : ''}`); cap.hide(Math.min(20000, 3000 + r.length * 60)); }
        else cap.hide(600);
      }
      else if (end === 'fail') { api.sound('fail'); cap.show(ev.reply || 'Sorry — I couldn’t do that.', 'fail'); cap.hide(2600); }
      else { api.sound('cancel'); cap.hide(0); }
      setTimeout(() => api.duck(false), 900);
    }
  };

  const connect = () => {
    try { es = new EventSource(`${ORIGIN}/events`); } catch { return; }
    es.onopen = () => { backoff = 2000; };
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } };
    es.onerror = () => { es.close(); es = null; settle(); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); };
  };
  connect();
  return {
    enabled: () => enabled,
    setEnabled: (on) => post('/control', { enabled: !!on }),
    calibrate: (seconds = 60) => post('/control', { calibrate: true, seconds }),
    // QA/preview: run the look without a voice (?voicedemo=1)
    demo() {
      onEvent({ t: 'state', state: 'listening' });
      let k = 0; const iv = setInterval(() => { k++; glow && glow.level(Math.abs(Math.sin(k / 3)) * 0.8); if (k === 20) cap.show('open the weather', 'live'); if (k > 40) { clearInterval(iv); onEvent({ t: 'state', state: 'thinking', text: 'Open the weather' }); setTimeout(() => onEvent({ t: 'state', state: 'idle', end: 'done', reply: 'Opening the weather.' }), 900); } }, 50);
    },
  };
}
