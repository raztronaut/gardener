// The Gardener™ — "Hey Garden": the always-listening, on-device voice service.
//
// PRIVATE BY DESIGN: audio never leaves this machine and is never written anywhere — it
// lives only in two fixed RAM buffers (a 2.5 s ring for the wake check, a ≤12 s buffer for
// one request), both overwritten in place. Speech is turned into text HERE (sherpa-onnx,
// on the CPU); only that text — and only after "hey garden" — goes to the agent
// (src/voiceagent.mjs, Claude). Transcripts are not logged.
//
//   mic (PulseAudio, 16 kHz mono) ─► wake word: sherpa-onnx keyword spotter ("HEY GARDEN",
//   3.3M-param zipformer, ~10% of one core) ─► verified by the speech model on the last
//   2 s (kills "the garden looks lovely" false wakes) ─► listening: silero VAD for the
//   end of the request, Parakeet TDT 110M for live + final text ─► agent ─► the wall
//
// The wall (public/lib/voice.js) connects to GET /events (SSE, this port, localhost only)
// for state / mic level / live words / tool calls, and answers tool calls and context
// requests on POST /reply. POST /control {enabled} turns listening on/off (mic closed).
// Models: data/voice/models/ (gitignored; tools/voice/README.md says how to fetch them).
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { runAgent } from './voiceagent.mjs';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');

const PORT = +(process.env.GARDENER_VOICE_PORT || 8797);
const WALL_ORIGINS = new Set(['http://127.0.0.1:8787', 'http://localhost:8787', `http://127.0.0.1:${process.env.GARDENER_PORT || 8787}`]);
const RATE = 16000;
const MODELS = join(paths.DATA, 'voice', 'models');
const STATE_FILE = join(paths.DATA, 'voice', 'state.json');
const KWS_DIR = join(MODELS, 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01');
const ASR_DIR = join(MODELS, 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8');
// the wake phrase in the KWS model's pieces (tools/voice/bpe-keyword.py "HEY GARDEN")
const KEYWORDS = '▁HE Y ▁G ARD EN @HEY_GARDEN\n';
// second stage: what the speech model must hear for a wake to count
// (+ any extra spellings calibration learned for this voice, data/voice/calibration.json)
const CAL_FILE = process.env.GARDENER_VOICE_CAL || join(paths.DATA, 'voice', 'calibration.json'); // (QA: a separate file)
let CAL = { threshold: +(process.env.GARDENER_WAKE_THRESHOLD || 0.25), score: 1.0, gain: 1, words: [] };
try { CAL = { ...CAL, ...JSON.parse(readFileSync(CAL_FILE, 'utf8')) }; } catch { /* not calibrated yet */ }
const escRe = (w) => w.replace(/[^a-z]/gi, '');
let WAKE_RE = null;
const buildWakeRe = () => { WAKE_RE = new RegExp(`\\b(hey|hay|hi|hei|heya|ok(ay)?)\\b[\\s,.!?-]*(gard[eio]?ns?${CAL.words.map((w) => '|' + escRe(w)).join('')})\\b`, 'i'); };
buildWakeRe();
const RING_S = 2.5, MAX_S = 12, END_SILENCE_MS = 750, NO_SPEECH_MS = 5000, PARTIAL_MS = 450;

// events only (wake, timings, tool names) — never what was said; capped at ~256 KB
const LOG_FILE = join(paths.DATA, 'voice', 'voice.log');
const log = (m) => {
  const line = `[voice] ${new Date().toISOString()} ${m}`;
  console.log(line);
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 256 * 1024) writeFileSync(LOG_FILE, readFileSync(LOG_FILE, 'utf8').slice(-128 * 1024));
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* ignore */ }
};

// ---- models (loaded once; ~350 MB resident) ------------------------------------------
const makeSpotter = () => new sherpa.KeywordSpotter({
  featConfig: { sampleRate: RATE, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: join(KWS_DIR, 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx'),
      decoder: join(KWS_DIR, 'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx'),
      joiner: join(KWS_DIR, 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx'),
    },
    tokens: join(KWS_DIR, 'tokens.txt'), numThreads: 1, provider: 'cpu', debug: 0,
  },
  keywordsFile: (() => { const f = join(paths.DATA, 'voice', 'keywords.txt'); writeFileSync(f, KEYWORDS); return f; })(),
  keywordsThreshold: CAL.threshold, keywordsScore: CAL.score,
});
let kws = makeSpotter();
// speech-to-text runs in a worker thread (src/voice-asr-worker.mjs)
const asrWorker = new Worker(new URL('./voice-asr-worker.mjs', import.meta.url), { workerData: { dir: ASR_DIR } });
const asrWait = new Map(); let asrN = 0;
asrWorker.on('message', (m) => { if (m.id) { asrWait.get(m.id)?.(m.text); asrWait.delete(m.id); } });
asrWorker.on('error', (e) => { log(`asr worker: ${e.message}`); process.exit(1); }); // systemd restarts us
const transcribe = (samples) => new Promise((resolve) => {
  const id = ++asrN; asrWait.set(id, resolve);
  const copy = new Float32Array(samples); // a private copy, handed over (zeroed by the worker)
  asrWorker.postMessage({ id, samples: copy }, [copy.buffer]);
});
const vad = new sherpa.Vad({
  sileroVad: { model: join(MODELS, 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.25, minSpeechDuration: 0.15, windowSize: 512, maxSpeechDuration: 20 },
  sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0,
}, 30);
// TWO spotter streams, the second started 0.32 s after the first: the streaming model sees
// audio in fixed chunks, and a phrase that lands across a chunk boundary can be missed
// (measured: every other alignment). Offset by about half a chunk, one of the two always
// sees it whole — 48/48 alignments detected vs 24/48 with one stream.
const KWS_OFFSET = Math.round(RATE * 0.32);
let kwsA = null, kwsB = null, kwsFed = 0;
function resetSpotter() { kwsA = kws.createStream(); kwsB = null; kwsFed = 0; }
resetSpotter();

// ---- RAM-only audio buffers --------------------------------------------------------
const ring = new Float32Array(RATE * RING_S); let ringPos = 0, ringFull = false;
const utter = new Float32Array(RATE * MAX_S); let utterLen = 0;
function ringPush(x) {
  for (let i = 0; i < x.length; i++) { ring[ringPos++] = x[i]; if (ringPos === ring.length) { ringPos = 0; ringFull = true; } }
}
function ringLast(n) { // the last n samples, oldest first
  n = Math.min(n, ringFull ? ring.length : ringPos);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ring[(ringPos - n + i + ring.length) % ring.length];
  return out;
}

// ---- wall connection (SSE out, POST in) ----------------------------------------------
const clients = new Set();
let primary = null; // the most recently connected wall: the one that answers context / acts
const send = (ev) => { const line = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) { try { c.write(line); } catch { clients.delete(c); } } };
const pending = new Map(); // request id → resolve (tool results / context from the wall)
let reqN = 0;
function askWall(type, payload, timeoutMs = 6000) {
  const id = `${Date.now().toString(36)}-${++reqN}`;
  return new Promise((resolve) => {
    if (!primary) return resolve({ ok: false, error: 'the wall is not connected' });
    const t = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'the wall did not answer' }); }, timeoutMs);
    pending.set(id, (v) => { clearTimeout(t); pending.delete(id); resolve(v); });
    try { primary.write(`data: ${JSON.stringify({ t: type, id, ...payload })}\n\n`); } catch { /* gone */ }
  });
}

// ---- the state machine ---------------------------------------------------------------
let enabled = true;
try { enabled = JSON.parse(readFileSync(STATE_FILE, 'utf8')).enabled !== false; } catch { /* default on */ }
let state = 'idle';              // idle | checking (wake heard, verifying) | listening | thinking
let tWake = 0, tLastSpeech = 0, heardSpeech = false, lastPartialAt = 0, lastLevelAt = 0, level = 0, partialBusy = false;
const setState = (s, extra = {}) => { state = s; send({ t: 'state', state: s, ...extra }); };

function onAudio(x) {
  if (CAL.gain !== 1) for (let i = 0; i < x.length; i++) { const v = x[i] * CAL.gain; x[i] = v > 1 ? 1 : v < -1 ? -1 : v; } // calibrated mic boost
  if (state === 'calibrating') { calibAudio(x); return; }
  if (state === 'idle') {
    ringPush(x);
    for (const st of [kwsA, kwsB]) {
      if (!st) continue;
      st.acceptWaveform({ sampleRate: RATE, samples: x });
      while (kws.isReady(st)) {
        kws.decode(st);
        if (kws.getResult(st).keyword) { resetSpotter(); onKeyword(); return; }
      }
    }
    kwsFed += x.length;
    if (!kwsB && kwsFed >= KWS_OFFSET) kwsB = kws.createStream();
    return;
  }
  if (state === 'checking') { // keep what's said while the wake is verified (and notice it)
    appendUtter(x); vad.acceptWaveform(x);
    if (vad.isDetected()) { heardSpeech = true; tLastSpeech = Date.now(); }
    while (!vad.isEmpty()) vad.pop();
    return;
  }
  if (state !== 'listening') return; // thinking: the mic is ignored (nothing buffered)
  // level for the edge animation (~30 Hz): RMS → 0..1, quick attack / slower release
  let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  const rms = Math.sqrt(e / Math.max(1, x.length));
  const v = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-6) + 52) / 36));
  level = v > level ? v : level * 0.82 + v * 0.18;
  const now = Date.now();
  if (now - lastLevelAt > 33) { lastLevelAt = now; send({ t: 'level', v: +level.toFixed(3) }); }
  // the request audio + end-of-speech detection
  appendUtter(x);
  vad.acceptWaveform(x);
  if (vad.isDetected()) { heardSpeech = true; tLastSpeech = now; }
  while (!vad.isEmpty()) vad.pop();
  if (heardSpeech && !partialBusy && now - lastPartialAt > PARTIAL_MS) {
    lastPartialAt = now; partialBusy = true;
    transcribe(utter.subarray(0, utterLen)).then((p) => { partialBusy = false; p = stripWake(p); if (p && state === 'listening') send({ t: 'partial', text: p }); });
  }
  if (utterLen >= utter.length) return finish('max');
  if (heardSpeech && now - tLastSpeech > END_SILENCE_MS) return finish('end');
  if (!heardSpeech && now - tWake > NO_SPEECH_MS) return cancel('silence');
}

function appendUtter(x) {
  const room = utter.length - utterLen;
  utter.set(room >= x.length ? x : x.subarray(0, room), utterLen); utterLen += Math.min(room, x.length);
}
async function onKeyword() {
  // stage 2: the speech model must hear "hey garden" in the last 2 s. The request starts
  // WITH that window (the spotter fires a beat after "garden", so a request said in one
  // breath — "hey garden open the weather" — would otherwise lose its first word); the
  // wake words are stripped from the text. Meanwhile the audio keeps flowing in.
  state = 'checking'; vad.reset(); heardSpeech = false;
  const win = ringLast(RATE * 2);
  utter.set(win, 0); utterLen = win.length;
  const heard = await transcribe(win);
  if (!WAKE_RE.test(heard)) { log('wake rejected by the speech check'); utterLen = 0; resetSpotter(); state = 'idle'; return; }
  log('wake');
  // words already said after "garden" (in the window, or during the check) count as speech
  const said = !!stripWake(heard) || heardSpeech;
  tWake = Date.now(); tLastSpeech = tWake; heardSpeech = said; lastPartialAt = 0; level = 0; partialBusy = false;
  setState('listening');
}

function cancel(why) {
  log(`cancel (${why})`);
  utterLen = 0; vad.reset(); resetSpotter();
  setState('idle', { end: 'cancel', why });
}

// "hey garden, open the weather" → "open the weather" (only a wake phrase near the start)
const stripWake = (t) => String(t || '')
  .replace(/^\s*(?:\S+\s+){0,2}?(?:hey|hay|hi|hei|heya|ok(?:ay)?)\b[\s,.!?-]*gard[eio]?ns?\b[\s,.!?-]*/i, '')
  .replace(/^\s*gard[eio]?ns?\b[\s,.!?-]+/i, '').trim();
async function finish(why) {
  state = 'thinking';
  const text = stripWake(await transcribe(utter.subarray(0, utterLen)));
  utter.fill(0, 0, utterLen); utterLen = 0; vad.reset(); // the audio is gone now
  if (!text || text.replace(/[^a-z]/gi, '').length < 2) return cancel('nothing');
  log(`request (${why}, ${text.length} chars)`);
  setState('thinking', { text });
  const t0 = Date.now();
  let out;
  try {
    // the whole request is bounded: 20 s, then it gives up (never a stuck "thinking")
    out = await Promise.race([new Promise((r) => setTimeout(() => r({ ok: false, reply: 'That took too long — try again?' }), 20000)), runAgent(text, {
      context: () => askWall('context', {}, 2500),
      call: (calls) => askWall('act', { calls }, 8000),
      log,
    })]);
  } catch (e) { log(`agent: ${e.message || e}`); out = { ok: false, reply: 'Sorry — I couldn’t do that.' }; }
  log(`done in ${Date.now() - t0} ms (${out.ok ? 'ok' : 'failed'})`);
  resetSpotter();
  setState('idle', { end: out.ok ? 'done' : 'fail', reply: out.reply || '' });
}

// ---- the mic -------------------------------------------------------------------------
let mic = null;
function micSource() {
  if (process.env.GARDENER_MIC) return process.env.GARDENER_MIC;
  try {
    const lines = execFileSync('pactl', ['list', 'short', 'sources'], { timeout: 3000 }).toString().split('\n');
    const pick = lines.map((l) => l.split('\t')[1]).filter((n) => n && n.startsWith('alsa_input.') && !n.includes('monitor'));
    return pick.find((n) => /mic/i.test(n)) || pick.find((n) => /usb/i.test(n)) || pick[0] || null;
  } catch { return null; }
}
// QA only: GARDENER_VOICE_WAV=a.wav[,b.wav…] plays those files (8 s apart, real-time pace)
// into the pipeline instead of the mic — the whole path, wake word to the wall
function startWavInput(files) {
  const rs = (w) => {
    if (w.sampleRate === RATE) return w.samples;
    const r = new sherpa.LinearResampler(w.sampleRate, RATE);
    return r.flush(w.samples);
  };
  const clips = files.split(',').map((f) => rs(sherpa.readWave(f)));
  const silence = new Float32Array(RATE * 8);
  const stream = [];
  for (const c of clips) stream.push(silence.subarray(0, RATE * 3), c, silence);
  const all = new Float32Array(stream.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of stream) { all.set(x, o); o += x.length; }
  log(`QA input: ${clips.length} clip(s), ${(all.length / RATE).toFixed(1)} s`);
  let pos = 0; const STEP = RATE / 50;
  const iv = setInterval(() => {
    if (pos >= all.length) { clearInterval(iv); log('QA input done'); return; }
    onAudio(all.slice(pos, pos + STEP)); pos += STEP;
  }, 20);
}
function startMic() {
  if (process.env.GARDENER_VOICE_WAV) { startWavInput(process.env.GARDENER_VOICE_WAV); return; }
  if (mic || !enabled) return;
  const src = micSource();
  if (!src) { log('no microphone found — retrying in 10 s'); setTimeout(startMic, 10000); return; }
  log(`listening on ${src}`);
  mic = spawn('parec', ['-d', src, '--format=s16le', `--rate=${RATE}`, '--channels=1', '--raw', '--latency-msec=30'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let rest = Buffer.alloc(0);
  mic.stdout.on('data', (chunk) => {
    const b = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    const n = b.length >> 1; rest = b.subarray(n << 1);
    const pcm = (b.byteOffset & 1) ? new Int16Array(new Uint8Array(b.subarray(0, n << 1)).buffer) : new Int16Array(b.buffer, b.byteOffset, n);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = pcm[i] * (1 / 32768);
    try { onAudio(x); } catch (e) { log(`audio: ${e.message}`); }
  });
  mic.on('exit', () => { mic = null; if (enabled) { log('mic stream ended — restarting in 3 s'); setTimeout(startMic, 3000); } });
}
function stopMic() { if (mic) { const m = mic; mic = null; m.kill(); } if (state !== 'idle') cancel('off'); ring.fill(0); ringPos = 0; ringFull = false; }
function setEnabled(on) {
  enabled = !!on;
  try { mkdirSync(join(paths.DATA, 'voice'), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify({ enabled })); } catch { /* ignore */ }
  if (enabled) startMic(); else stopMic();
  send({ t: 'enabled', enabled });
  log(enabled ? 'enabled' : 'disabled (mic closed)');
}

// ---- HTTP (127.0.0.1 only) -----------------------------------------------------------
const readBody = (req, max = 256 * 1024) => new Promise((res, rej) => {
  let n = 0; const parts = [];
  req.on('data', (c) => { n += c.length; if (n > max) { rej(new Error('too big')); req.destroy(); } else parts.push(c); });
  req.on('end', () => res(Buffer.concat(parts).toString('utf8'))); req.on('error', rej);
});
http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !WALL_ORIGINS.has(origin)) { res.writeHead(403); return res.end(); }
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ t: 'hello', enabled, state })}\n\n`);
    clients.add(res); primary = res;
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); if (primary === res) primary = [...clients].pop() || null; });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ enabled, state, mic: !!mic, clients: clients.size, rssMB: Math.round(process.memoryUsage().rss / 1e6) }));
  }
  if (req.method === 'POST' && (url.pathname === '/reply' || url.pathname === '/control' || url.pathname === '/say')) {
    let body; try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400, cors); return res.end(); }
    if (url.pathname === '/reply') { const f = pending.get(String(body.id || '')); if (f) f(body.data ?? {}); }
    else if (url.pathname === '/control') { if ('enabled' in body) setEnabled(body.enabled); if (body.calibrate) startCalibration(+body.seconds || 60); }
    else if (url.pathname === '/say' && !origin) { // QA only (curl, no browser origin): run a typed request
      if (state === 'idle' && typeof body.text === 'string') { tWake = Date.now(); setState('listening'); setTimeout(() => { const t = body.text; utterLen = 0; (async () => { setState('thinking', { text: t }); const out = await runAgent(t, { context: () => askWall('context', {}, 2500), call: (calls) => askWall('act', { calls }, 8000), log }).catch(() => ({ ok: false, reply: 'Sorry — I couldn’t do that.' })); setState('idle', { end: out.ok ? 'done' : 'fail', reply: out.reply || '' }); })(); }, 600); }
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
  }
  res.writeHead(404, cors); res.end();
}).listen(PORT, '127.0.0.1', () => log(`events on http://127.0.0.1:${PORT}/events`));

// ---- calibration: "Hey Garden" learns this voice in this house --------------------------
// One minute of the person saying "hey garden" around the house (they asked for it; RAM
// only, zeroed after). Each take is found by its transcript, then turned into a test set
// with DATA AUGMENTATION — white / pink noise, other speech underneath, room echo, far
// away (quiet + noise floor), slower / faster — plus the minute's other sounds as
// negatives. Every candidate setting (spotter threshold × score × mic boost) is run over
// all of it in parallel workers; the one that catches the most takes without too many
// false triggers wins, is applied at once and saved. Words the speech model heard instead
// of "garden" (e.g. "Gordon") are learned for the second-stage check.
let calib = null;
function startCalibration(seconds) {
  if (calib || state !== 'idle') return;
  seconds = Math.max(20, Math.min(120, seconds));
  calib = { buf: new Float32Array(RATE * seconds), len: 0, segs: [], heard: 0, t0: Date.now(), seconds, lastTick: 0, checks: [] };
  vad.reset();
  log(`calibration: recording ${seconds} s`);
  setState('calibrating');
  send({ t: 'calib', phase: 'record', left: seconds, heard: 0 });
}
function calibAudio(x) {
  const C = calib; if (!C) return;
  const room = C.buf.length - C.len; const n = Math.min(room, x.length);
  C.buf.set(x.subarray(0, n), C.len); C.len += n;
  let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  const v = Math.min(1, Math.max(0, (20 * Math.log10(Math.sqrt(e / Math.max(1, x.length)) + 1e-6) + 52) / 36));
  level = v > level ? v : level * 0.82 + v * 0.18;
  const now = Date.now();
  if (now - lastLevelAt > 33) { lastLevelAt = now; send({ t: 'level', v: +level.toFixed(3) }); }
  vad.acceptWaveform(x);
  while (!vad.isEmpty()) {
    const seg = vad.front(false); vad.pop();
    const start = seg.start, samples = new Float32Array(seg.samples);
    const p = transcribe(samples).then((t) => {
      if (/\b(hey|hay|hi|hei|heya|ok(ay)?|a)\b[\s,.!?-]*g[aeiou]?r?d?\w*/i.test(t) && /\bg[ao]r?d|gordon|garn/i.test(t)) { /* "hey" + a garden-ish word */ C.segs.push({ start, end: start + samples.length, text: t }); C.heard++; send({ t: 'calib', phase: 'record', left: Math.max(0, Math.ceil(C.seconds - (Date.now() - C.t0) / 1000)), heard: C.heard }); }
    });
    C.checks.push(p); C.speech = (C.speech || 0) + 1;
  }
  if (now - C.lastTick > 1000) { C.lastTick = now; send({ t: 'calib', phase: 'record', left: Math.max(0, Math.ceil(C.seconds - (now - C.t0) / 1000)), heard: C.heard }); }
  if (C.len >= C.buf.length) { state = 'analyzing'; analyzeCalibration().catch((err) => { log(`calibration failed: ${err.message}`); endCalibration({ ok: false, why: 'something went wrong' }); }); }
}

// --- augmentation (deterministic) ---
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const rmsOf = (x) => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, x.length)); };
const clipTo = (x) => { for (let i = 0; i < x.length; i++) x[i] = x[i] > 1 ? 1 : x[i] < -1 ? -1 : x[i]; return x; };
function withNoise(x, snrDb, pink) {
  const r = rmsOf(x) / Math.pow(10, snrDb / 20), y = new Float32Array(x.length);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < x.length; i++) {
    let w = rnd() * 2 - 1;
    if (pink) { b0 = 0.997 * b0 + 0.029591 * w; b1 = 0.985 * b1 + 0.032534 * w; b2 = 0.95 * b2 + 0.048056 * w; w = (b0 + b1 + b2 + 0.1848 * w) * 3.5; }
    y[i] = x[i] + w * r * 1.7;
  }
  return clipTo(y);
}
function withSpeech(x, other, relDb) {
  if (!other || !other.length) return withNoise(x, 8, true);
  const g = (rmsOf(x) / (rmsOf(other) || 1)) * Math.pow(10, relDb / 20), y = new Float32Array(x.length), o = Math.floor(rnd() * other.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + other[(o + i) % other.length] * g;
  return clipTo(y);
}
function withEcho(x, rt60) { // a sparse synthetic room: early reflections + an exponentially decaying tail
  const len = Math.round(RATE * rt60 * 0.6), taps = [];
  for (let k = 0; k < 260; k++) { const d = Math.floor(Math.pow(rnd(), 1.6) * len) + 40; taps.push([d, (rnd() * 2 - 1) * Math.exp(-6.9 * d / (RATE * rt60)) * 0.55]); }
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { let v = x[i]; for (const [d, g] of taps) if (i >= d) v += x[i - d] * g; y[i] = v; }
  const k = (rmsOf(x) / (rmsOf(y) || 1)); for (let i = 0; i < y.length; i++) y[i] *= k;
  return clipTo(y);
}
const farAway = (x) => withNoise(x.map((v) => v * 0.22), 14, true);
function speed(x, f) { const n = Math.floor(x.length / f), y = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i * f, j = Math.floor(t), a = t - j; y[i] = (x[j] || 0) * (1 - a) + (x[j + 1] || 0) * a; } return y; }
const scaled = (x, g) => clipTo(x.map((v) => v * g));

function runConfigs(configs, clips) {
  const W = Math.min(5, configs.length), results = new Array(configs.length);
  let next = 0, done = 0;
  return new Promise((resolve) => {
    for (let w = 0; w < W; w++) {
      const worker = new Worker(new URL('./voice-calib-worker.mjs', import.meta.url), { workerData: { dir: KWS_DIR, keywords: KEYWORDS, kwFile: join(paths.DATA, 'voice', `kw-cal-${w}.txt`) } });
      const take = () => {
        if (next >= configs.length) { worker.terminate(); return; }
        const i = next++, c = configs[i];
        const list = clips.map((x) => (c.gain === 1 ? new Float32Array(x) : scaled(x, c.gain)));
        worker.postMessage({ id: i, threshold: c.threshold, score: c.score, clips: list }, list.map((x) => x.buffer));
      };
      worker.on('message', ({ id, out }) => {
        results[id] = out; done++;
        if (calib) calib.progress = done / configs.length;
        send({ t: 'calib', phase: 'analyze', progress: done / configs.length });
        if (done === configs.length) resolve(results); else take();
      });
      take();
    }
  });
}

async function analyzeCalibration() {
  const C = calib;
  send({ t: 'calib', phase: 'analyze', progress: 0 });
  await Promise.all(C.checks);
  const audio = C.buf.subarray(0, C.len);
  const pad = Math.round(RATE * 0.5);
  const takes = C.segs.sort((a, b) => a.start - b.start).slice(0, 16)
    .map((g) => ({ ...g, x: audio.slice(Math.max(0, g.start - pad), Math.min(audio.length, g.end + pad)) }));
  if (takes.length < 2) { log(`calibration: only ${takes.length} takes in ${C.speech || 0} speech segments`); return endCalibration({ ok: false, why: `I only heard ${takes.length} “hey garden” — try again a bit louder` }); }
  // negatives: the minute with the takes cut out (other talk, the room, the TV…)
  const neg = new Float32Array(audio);
  for (const g of takes) neg.fill(0, Math.max(0, g.start - pad), Math.min(neg.length, g.end + pad));
  const negSpeech = neg.filter((v) => v !== 0);
  // the test set: every take × its augmentations; the negatives also with noise added
  const VARIANTS = [['clean', (x) => x], ['noise', (x) => withNoise(x, 10, false)], ['pink noise', (x) => withNoise(x, 5, true)],
    ['speech under', (x) => withSpeech(x, negSpeech, -6)], ['echo', (x) => withEcho(x, 0.5)], ['far away', farAway],
    ['slower', (x) => speed(x, 0.9)], ['faster', (x) => speed(x, 1.1)]];
  const clips = [], meta = [];
  for (const g of takes) for (const [name, f] of VARIANTS) { clips.push(f(g.x)); meta.push({ pos: true, name }); }
  const NEG_CHUNK = RATE * 10;
  for (let o = 0; o + RATE * 2 < neg.length; o += NEG_CHUNK) { const c = neg.slice(o, o + NEG_CHUNK); clips.push(c, withNoise(c, 6, true)); meta.push({ pos: false }, { pos: false }); }
  const negMinutes = (2 * neg.length) / RATE / 60;
  // mic boost: bring the median take to about -24 dBFS (never below 1×, at most 6×)
  const med = takes.map((g) => rmsOf(g.x)).sort((a, b) => a - b)[Math.floor(takes.length / 2)];
  const auto = Math.max(1, Math.min(6, 0.063 / (med || 0.063)));
  const gains = auto > 1.3 ? [1, +auto.toFixed(2)] : [1];
  const configs = [];
  for (const gain of gains) for (const threshold of [0.25, 0.18, 0.12, 0.07]) for (const score of [1.0, 1.8]) configs.push({ threshold, score, gain });
  log(`calibration: ${takes.length} takes, ${clips.length} test clips, ${configs.length} settings`);
  const beat = setInterval(() => send({ t: 'calib', phase: 'analyze', progress: calib ? calib.progress || 0 : 0 }), 3000); // keeps the wall's watchdog fed
  const results = await runConfigs(configs, clips).finally(() => clearInterval(beat));
  let best = null;
  results.forEach((out, i) => {
    let hit = 0, pos = 0, fp = 0;
    out.forEach((n, k) => { if (meta[k].pos) { pos++; if (n > 0) hit++; } else fp += n; });
    const fpm = fp / Math.max(0.2, negMinutes), recall = hit / pos;
    const sc = recall - 0.015 * fpm - (fpm > 10 ? 1 : 0);
    configs[i].recall = recall; configs[i].fpm = fpm;
    if (!best || sc > best.sc + 1e-9 || (Math.abs(sc - best.sc) < 1e-9 && configs[i].threshold > best.c.threshold)) best = { sc, c: configs[i] };
  });
  const before = configs.find((c) => c.gain === 1 && c.threshold === 0.25 && c.score === 1.0) || configs[0];
  // the second stage: the words the speech model heard for "garden" in this voice
  const words = new Set(CAL.words);
  for (const g of takes) { const m = /\b(?:hey|hay|hi|hei|heya|ok(?:ay)?)\b[\s,.!?-]*([a-z]+)/i.exec(g.text); if (m && /^g/i.test(m[1]) && m[1].length <= 9 && !/^gard[eio]?ns?$/i.test(m[1])) words.add(m[1].toLowerCase()); }
  CAL = { threshold: best.c.threshold, score: best.c.score, gain: best.c.gain, words: [...words].slice(0, 12), at: new Date().toISOString(),
    stats: { takes: takes.length, tests: clips.length, recall: +best.c.recall.toFixed(3), recallBefore: +before.recall.toFixed(3), falsePerMin: +best.c.fpm.toFixed(2) } };
  try { writeFileSync(CAL_FILE, JSON.stringify(CAL, null, 1)); } catch { /* ignore */ }
  kws = makeSpotter(); buildWakeRe();
  log(`calibration: threshold ${CAL.threshold}, score ${CAL.score}, boost ${CAL.gain}× — catches ${(100 * best.c.recall).toFixed(0)}% (was ${(100 * before.recall).toFixed(0)}%), ${best.c.fpm.toFixed(1)} false/min`);
  endCalibration({ ok: true, takes: takes.length, tests: clips.length, recall: best.c.recall, recallBefore: before.recall, gain: CAL.gain, threshold: CAL.threshold, words: CAL.words.length });
}
function endCalibration(result) {
  if (calib) { calib.buf.fill(0); calib = null; } // the recording is gone
  vad.reset(); resetSpotter();
  send({ t: 'calib', phase: 'done', ...result });
  setState('idle', { end: 'calib' });
}

if (!existsSync(KWS_DIR) || !existsSync(ASR_DIR)) log('models missing — see tools/voice/README.md');
startMic();
process.on('SIGTERM', () => { if (state !== 'idle') send({ t: 'state', state: 'idle', end: 'cancel' }); stopMic(); setTimeout(() => process.exit(0), 50); });
