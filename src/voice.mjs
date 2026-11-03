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
const WAKE_RE = /\b(hey|hay|hi|hei|heya|ok(ay)?)\b[\s,.!?-]*gard[eio]?ns?\b/i;
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
const kws = new sherpa.KeywordSpotter({
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
  keywordsThreshold: +(process.env.GARDENER_WAKE_THRESHOLD || 0.25), keywordsScore: 1.0,
});
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
let kwsStream = kws.createStream();

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
  if (state === 'idle') {
    ringPush(x);
    kwsStream.acceptWaveform({ sampleRate: RATE, samples: x });
    while (kws.isReady(kwsStream)) {
      kws.decode(kwsStream);
      const r = kws.getResult(kwsStream);
      if (r.keyword) { kws.reset(kwsStream); onKeyword(); break; }
    }
    return;
  }
  if (state === 'checking') { appendUtter(x); return; } // keep what's said while the wake is verified
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
    transcribe(utter.subarray(0, utterLen)).then((p) => { partialBusy = false; if (p && state === 'listening') send({ t: 'partial', text: p }); });
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
  // stage 2: the speech model must hear "hey garden" in the last 2 s (meanwhile the
  // audio keeps flowing into the request buffer, so nothing said right after is lost)
  state = 'checking'; utterLen = 0; vad.reset();
  const heard = await transcribe(ringLast(RATE * 2));
  if (!WAKE_RE.test(heard)) { log('wake rejected by the speech check'); utterLen = 0; kwsStream = kws.createStream(); state = 'idle'; return; }
  log('wake');
  tWake = Date.now(); tLastSpeech = tWake; heardSpeech = false; lastPartialAt = 0; level = 0; partialBusy = false;
  setState('listening');
}

function cancel(why) {
  log(`cancel (${why})`);
  utterLen = 0; vad.reset(); kwsStream = kws.createStream();
  setState('idle', { end: 'cancel', why });
}

async function finish(why) {
  state = 'thinking';
  const text = await transcribe(utter.subarray(0, utterLen));
  utter.fill(0, 0, utterLen); utterLen = 0; vad.reset(); // the audio is gone now
  if (!text || text.replace(/[^a-z]/gi, '').length < 2) return cancel('nothing');
  log(`request (${why}, ${text.length} chars)`);
  setState('thinking', { text });
  const t0 = Date.now();
  let out;
  try {
    out = await runAgent(text, {
      context: () => askWall('context', {}, 2500),
      call: (calls) => askWall('act', { calls }, 8000),
      log,
    });
  } catch (e) { log(`agent: ${e.message || e}`); out = { ok: false, reply: 'Sorry — I couldn’t do that.' }; }
  log(`done in ${Date.now() - t0} ms (${out.ok ? 'ok' : 'failed'})`);
  kwsStream = kws.createStream();
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
function startMic() {
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
    else if (url.pathname === '/control') { if ('enabled' in body) setEnabled(body.enabled); }
    else if (url.pathname === '/say' && !origin) { // QA only (curl, no browser origin): run a typed request
      if (state === 'idle' && typeof body.text === 'string') { tWake = Date.now(); setState('listening'); setTimeout(() => { const t = body.text; utterLen = 0; (async () => { setState('thinking', { text: t }); const out = await runAgent(t, { context: () => askWall('context', {}, 2500), call: (calls) => askWall('act', { calls }, 8000), log }).catch(() => ({ ok: false, reply: 'Sorry — I couldn’t do that.' })); setState('idle', { end: out.ok ? 'done' : 'fail', reply: out.reply || '' }); })(); }, 600); }
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
  }
  res.writeHead(404, cors); res.end();
}).listen(PORT, '127.0.0.1', () => log(`events on http://127.0.0.1:${PORT}/events`));

if (!existsSync(KWS_DIR) || !existsSync(ASR_DIR)) log('models missing — see tools/voice/README.md');
startMic();
process.on('SIGTERM', () => { stopMic(); process.exit(0); });
