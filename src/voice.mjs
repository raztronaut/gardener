// The Gardener™ — "Hey Garden": the always-listening, on-device voice service.
//
// PRIVATE BY DESIGN: audio never leaves this machine and is never written anywhere — it
// normally lives in two fixed RAM buffers (a 2.5 s wake ring and a ≤12 s request).
// Explicit room calibration temporarily keeps bounded labelled trials in RAM; buffers
// are cleared on finish/cancel. No calibration audio is written or uploaded. Speech is turned into text HERE (sherpa-onnx,
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
import {randomUUID} from 'node:crypto';
const voiceSessionId=randomUUID();let voiceEventSeq=0;
import {makeDestination} from './voice-destination.mjs';
import {tvRequest,tvDirectAction,tvAppLaunch} from './voice-tv.mjs';
const destination=makeDestination();
import { spawn, fork, execFileSync } from 'node:child_process';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import {roomPlan,extractTrials,gainClip,rms,POSITIONS} from './voice-room-calibration.mjs';
import {makeDetector as makeRoomDetector} from './voice-kws-eval.mjs';
import { VoiceTurns, editUtterance, silenceBudget } from './voice-turn.mjs';
import { runAgent } from './voiceagent.mjs';
import { botanistWorking } from './botanist.mjs';
import { meantForWall } from './jev.mjs';
// false wakes: below this, Jev thinks the words weren't said TO the wall (TV, chatter) — measured:
// short real commands >= 0.38 ("allow it"), overheard chatter mostly 0.13-0.3
const WAKE_MIN = +(process.env.GARDENER_WAKE_MIN || 0.3);

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');

const PORT = +(process.env.GARDENER_VOICE_PORT || 8797);
const WALL_ORIGINS = new Set(['http://127.0.0.1:8787', 'http://localhost:8787', `http://127.0.0.1:${process.env.GARDENER_PORT || 8787}`]);
const RATE = 16000;
const MODELS = join(paths.DATA, 'voice', 'models');
const STATE_FILE = join(paths.DATA, 'voice', 'state.json');
const KWS_DIR = join(MODELS, 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01');
const ASR_DIR = process.env.GARDENER_VOICE_ASR_DIR || join(MODELS, 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8');
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
const turns = new VoiceTurns();
let captureEpoch = 0, latestPartial = '', partialCapture = 0;
const RING_S = 2.5, MAX_S = 12, END_SILENCE_MS = 750, NO_SPEECH_MS = 5000, PARTIAL_MS = Math.max(450,Math.min(2000,Number(process.env.GARDENER_VOICE_PARTIAL_MS)||450));

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
const transcribe = (samples, measure = false) => new Promise((resolve) => {
  const id = ++asrN; const began = performance.now(); asrWait.set(id, (text) => { if (measure) log(`asr turnaround: ${Math.round(performance.now() - began)} ms`); resolve(text); });
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
const send = (ev) => { ev={seq:++voiceEventSeq,sessionId:voiceSessionId,destination:destination.current,turnId:turns.current?.id,...ev}; const line = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) { try { c.write(line); } catch { clients.delete(c); } } };
const pending = new Map(); // request id → resolve (tool results / context from the wall)
let reqN = 0;
function askWall(type, payload, timeoutMs = 6000, signal) {
  const id = `${Date.now().toString(36)}-${++reqN}`;
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ ok: false, error: 'cancelled' });
    if (!primary) return resolve({ ok: false, error: 'the wall is not connected' });
    const settle = (value) => { clearTimeout(t); pending.delete(id); signal?.removeEventListener('abort', aborted); resolve(value); };
    const aborted = () => settle({ok:false,error:'cancelled'});
    const t = setTimeout(() => settle({ok:false,error:'the wall did not answer'}), timeoutMs);
    signal?.addEventListener('abort', aborted, {once:true});
    pending.set(id, settle);
    try { primary.write(`data: ${JSON.stringify({ t: type, id, turnId: turns.current?.id, ...payload })}\n\n`); } catch { /* gone */ }
  });
}

// ---- the state machine ---------------------------------------------------------------
let enabled = true;
try { enabled = JSON.parse(readFileSync(STATE_FILE, 'utf8')).enabled !== false; } catch { /* default on */ }
let state = 'idle';              // idle | checking (wake heard, verifying) | listening | thinking
let tWake = 0, tLastSpeech = 0, heardSpeech = false, lastPartialAt = 0, lastLevelAt = 0, level = 0, partialBusy = false;
// push-to-talk (the MX Master's square button, via pad.mjs): held = listening, no wake word,
// no silence timeout; released → a short tail so the last word is in, then the request
let ptt = false, pttUp = 0, pttAuto = false;
const speechSilence=t=>Math.max(silenceBudget(t),Math.min(2000,Number(process.env.GARDENER_VOICE_END_SILENCE_MS)||750));
const setState = (s, extra = {}) => { state = s; send({ t: 'state', state: s, ...extra }); };

function onAudio(x) {
  if (state === 'calibrating') { calibAudio(x); return; }
  if (state === 'analyzing') return;
  if (CAL.gain !== 1) for (let i = 0; i < x.length; i++) { const v = x[i] * CAL.gain; x[i] = v > 1 ? 1 : v < -1 ? -1 : v; } // calibrated mic boost
  if (state === 'idle' || state === 'thinking') {
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
  if (state !== 'listening' && state !== 'finalizing') return;
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
  if (state === 'finalizing') return; // keep VAD/audio while the candidate final is decoding
  if (heardSpeech && !partialBusy && now - lastPartialAt > PARTIAL_MS) {
    lastPartialAt = now; partialBusy = true;
    const epoch = captureEpoch, len = utterLen;
    transcribe(utter.subarray(0, len)).then((p) => { if (epoch !== captureEpoch) return; partialBusy = false; p = stripWake(p); if (p && state === 'listening') { latestPartial = p; partialCapture = len; destination.preview(p); send({ t: 'partial', text: p, turnId: turns.current?.id }); } });
  }
  if (utterLen >= utter.length) return finish('max');
  if (ptt) {
    if(pttAuto && !pttUp){if(heardSpeech && now-tLastSpeech>speechSilence(latestPartial)){ptt=false;return finish('ptt');}if(!heardSpeech&&now-tWake>NO_SPEECH_MS)return cancel('silence');}
    // released: wait ≥ 350 ms (the mic's latency + the last syllable), and while words are
    // still coming in up to 1.2 s; then the request (or nothing, if nothing was said)
    if (pttUp && ((now - pttUp > 350 && now - tLastSpeech > 300) || now - pttUp > 1200)) { ptt = false; return heardSpeech ? finish('ptt') : cancel('ptt-empty'); }
    return;
  }
  if (heardSpeech && now - tLastSpeech > speechSilence(latestPartial)) return finish('end');
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
  const previous = state;
  const epoch = ++captureEpoch;
  state = 'checking'; vad.reset(); heardSpeech = false;
  const win = ringLast(RATE * 2);
  utter.set(win, 0); utterLen = win.length;
  const heard = await transcribe(win);
  if (epoch !== captureEpoch || state !== 'checking') return;
  if (!WAKE_RE.test(heard)) { log('wake rejected by the speech check'); utterLen = 0; resetSpotter(); state = previous === 'thinking' && turns.current ? 'thinking' : 'idle'; return; }
  if (turns.current) send({t:'cancel-turn',turnId:turns.current.id});
  turns.begin(); destination.begin(); latestPartial=''; partialCapture=0;
  log('wake');
  // words already said after "garden" (in the window, or during the check) count as speech
  const said = !!stripWake(heard) || heardSpeech;
  tWake = Date.now(); tLastSpeech = tWake; heardSpeech = said; lastPartialAt = 0; level = 0; partialBusy = false;
  setState('listening');
  const initial=stripWake(heard); if(initial){destination.preview(initial);send({t:'partial',text:initial});}
}

function cancel(why) {
  if(calib){endCalibration(calib,{ok:false,cancelled:true,why:'Calibration cancelled. Current settings kept.'});return;}
  if (turns.current) send({t:'cancel-turn',turnId:turns.current.id});
  turns.cancel(); captureEpoch++; ptt=false; pttUp=0; partialBusy=false; latestPartial=''; partialCapture=0;
  log(`cancel (${why})`);
  utter.fill(0,0,utterLen); utterLen=0; vad.reset(); resetSpotter();
  setState('idle', {end:'cancel',why});
}
const stripWake = (t) => String(t || '')
  .replace(/^\s*(?:\S+\s+){0,2}?(?:hey|hay|hi|hei|heya|ok(?:ay)?)\b[\s,.!?-]*gard[eio]?ns?\b[\s,.!?-]*/i, '')
  .replace(/^\s*gard[eio]?ns?\b[\s,.!?-]+/i, '').trim();
async function executeText(raw, turn, why) {
  if (!turns.isCurrent(turn)) return;
  const edited=editUtterance(raw);
  if (edited.kind==='cancel') return cancel('spoken-cancel');
  if (edited.kind==='wait') {
    setState('idle',{end:'fail',reply:'I heard an unfinished correction. Please say the full request again.'}); turns.cancel(); return;
  }
  const launch=tvAppLaunch(edited.text);
  const routed=destination.resolve(launch?'on the TV, '+launch.text:edited.text),text=routed.text,target=routed.destination;
  if(target==='tv'&&!existsSync(process.env.GARDENER_TV_VOICE_READY_FILE||'/nonexistent-gardentv-voice-ready')){destination.end();setState('idle',{destination:'garden',end:'fail',reply:'TV voice setup is saved, but needs the TV on to finish.'});turns.cancel();return;}
  destination.remember();
  send({t:'destination',destination:target});
  send({t:'transcript',text,phase:edited.kind==='correct'?'Corrected request':'Heard'});
  const native=target==='tv'?tvDirectAction(text):null;
  if (why!=='ptt' && why!=='qa' && !native) {
    const m=await meantForWall(text,{timeoutMs:800}).catch(()=>null);
    if (!turns.isCurrent(turn)) return;
    if (m && m.p<WAKE_MIN) return cancel('not-for-me');
  }
  setState('thinking',{text,turnId:turn.id});
  const t0=Date.now(), signal=turn.controller.signal;
  const beat=setInterval(()=>send({t:'beat'}),4000);
  const deadline=setTimeout(()=>{if(turns.isCurrent(turn)){cancel('timeout');send({t:'transcript',text:'That took too long. Please try again.',phase:'Stopped'});}},target==='tv'?45000:20000);
  try {
    const call=calls=>target==='tv'?tvRequest('/voice/act',{calls,request:text},{signal}):askWall('act',{calls},8000,signal);
    const direct=native;
    const out=direct?await (async()=>{const results=await call([direct]);const r=results[0];return {kind:'action',ok:r?.ok===true,reply:r?.ok?(r.say||''):r?.error||'The TV could not do that.'};})():await runAgent(text,{
      destination:target,signal,startedAt:turn.startedAt, context:()=>target==='tv'?tvRequest('/voice/context',null,{signal}):askWall('context',{},2500,signal),
      call,notify:(ev)=>{if(signal.aborted)return;if(ev.kind==='destination'&&ev.destination==='tv'){destination.begin('tv');destination.remember();send({t:'destination',destination:'tv'});send({t:'transcript',text:ev.text||text,phase:'Heard'});setState('thinking');}else send({t:'botanist',destination:target,...ev});},log,
    });
    if (!turns.isCurrent(turn)) return;
    log(`done in ${Date.now()-t0} ms (${out.ok?'ok':'failed'})`);
    if(state==='checking') { turns.current=null; return; }
    resetSpotter(); setState('idle',{end:out.ok?'done':'fail',feedback:out.kind||(destination.current==='tv'?'action':'answer'),reply:out.reply||'',...(out.format?{format:out.format}:{})});
    turns.current=null;
  } catch(e) {
    if(turns.isCurrent(turn)){log(`agent failed (${e.name})`);setState('idle',{end:'fail',reply:'I couldn’t finish that request.'});turns.cancel();}
  } finally {clearInterval(beat);clearTimeout(deadline);}
}
async function finish(why) {
  const turn=turns.current;
  if(!turn) return cancel('no-turn');
  setState('finalizing'); const epoch=captureEpoch, speechAt=tLastSpeech;
  const text=stripWake(await transcribe(utter.subarray(0,utterLen),true));
  if(!turns.isCurrent(turn)||epoch!==captureEpoch) return;
  if(why !== 'max' && tLastSpeech > speechAt) { setState('listening'); latestPartial=text; send({t:'partial',text}); return; }
  utter.fill(0,0,utterLen);utterLen=0;vad.reset();
  if(!text||text.replace(/[^a-z]/gi,'').length<2)return cancel('nothing');
  log(`request (${why}, ${text.length} chars)`);
  await executeText(text,turn,turn.invocation||why);
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
  const gap=Math.max(8,Math.min(30,Number(process.env.GARDENER_VOICE_WAV_GAP)||8));
  const silence = new Float32Array(RATE * gap);
  const stream = [];
  for (const c of clips) stream.push(silence.subarray(0, RATE * 3), c, silence);
  const all = new Float32Array(stream.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of stream) { all.set(x, o); o += x.length; }
  log(`QA input: ${clips.length} clip(s), ${(all.length / RATE).toFixed(1)} s`);
  let markerOffset=0; const markers=[];
  clips.forEach((c,index)=>{markers.push({at:markerOffset+RATE*2,index,down:true},{at:markerOffset+RATE*3+c.length+RATE*.5,index,down:false});markerOffset+=RATE*(3+gap)+c.length;});
  let pos = 0; const STEP = RATE / 50;
  const iv = setInterval(() => {
    if (pos >= all.length) { clearInterval(iv); log('QA input done'); return; }
    while(markers.length && markers[0].at<=pos){const m=markers.shift();send({t:'qa-audio',index:m.index,down:m.down});}
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
    res.write(`data: ${JSON.stringify({ t: 'hello', seq:voiceEventSeq,sessionId:voiceSessionId, destination:destination.current, turnId:turns.current?.id, enabled, state, botanist: botanistWorking(), calibration: calibrationSnapshot() })}\n\n`);
    res.gardenObserver = url.searchParams.get('observe') === '1';
    clients.add(res); if (!res.gardenObserver) primary = res;
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); if (primary === res) primary = [...clients].filter((c) => !c.gardenObserver).pop() || null; });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/calibration') {res.writeHead(200,{...cors,'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({active:!!calib,session:calibrationSnapshot(),canUndo:!!CAL.previous}));}
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ seq:voiceEventSeq,sessionId:voiceSessionId, enabled, state, destination:destination.current,turnId:turns.current?.id, mic: !!mic, clients: clients.size, rssMB: Math.round(process.memoryUsage().rss / 1e6) }));
  }
  if (req.method === 'POST' && (url.pathname === '/reply' || url.pathname === '/control' || url.pathname === '/say' || url.pathname === '/ptt')) {
    let body; try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400, cors); return res.end(); }
    if (url.pathname === '/reply') { const f = pending.get(String(body.id || '')); if (f) f(body.data ?? {}); }
    else if (url.pathname === '/ptt') {
      if (body.down && enabled && (state === 'idle' || state === 'checking' || state === 'thinking' || state === 'finalizing')) {
        if(turns.current) send({t:'cancel-turn',turnId:turns.current.id});
        const turn=turns.begin();turn.invocation='ptt'; destination.begin(body.destination==='tv'?'tv':'garden'); captureEpoch++; latestPartial=''; partialCapture=0; partialBusy=false;
        ptt = true; pttAuto = body.auto === true; pttUp = 0; resetSpotter(); vad.reset();
        const lead = ringLast(Math.round(RATE * 0.25)); utter.set(lead, 0); utterLen = lead.length; // the press may beat the first word
        tWake = Date.now(); tLastSpeech = tWake; heardSpeech = false; lastPartialAt = 0; level = 0; partialBusy = false;
        log('push-to-talk'); setState('listening', { ptt: true });
      } else if (!body.down && ptt) pttUp = Date.now();
    }
    else if (url.pathname === '/control') { if(body.releaseDestination==='tv')destination.end(); if (body.cancel && (!body.sessionId || (body.sessionId===voiceSessionId && body.turnId===turns.current?.id && destination.current==='tv'))) cancel('user'); if ('enabled' in body) setEnabled(body.enabled); if (body.calibrate||body.calibrationAction) {const action=body.calibrationAction||'start';if(['pause','resume'].includes(action)){if(!calib||state!=='calibrating'){res.writeHead(409,{...cors,'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:'No recording session to pause.'}));}calib.paused=action==='pause';calibSend({...calib.event,paused:calib.paused,cue:false});res.writeHead(200,{...cors,'Content-Type':'application/json'});return res.end('{"ok":true}');}const result=action==='start'?startCalibration():action==='undo'?undoCalibration():action==='cancel'?(calib?(endCalibration(calib,{ok:false,cancelled:true,why:'Calibration cancelled. Current settings kept.'}),{ok:true}):{ok:true}):{ok:false,error:'Unknown calibration action'};res.writeHead(result.ok?200:409,{...cors,'Content-Type':'application/json'});return res.end(JSON.stringify(result));} }
    else if (url.pathname === '/say' && !origin) {
      if(calib){res.writeHead(409,cors);return res.end('Calibration is active');}
      if(typeof body.text==='string') {
        if(turns.current)send({t:'cancel-turn',turnId:turns.current.id});
        const turn=turns.begin(); destination.begin(body.destination==='tv'?'tv':body.destination==='garden'?'garden':undefined); captureEpoch++; tWake=Date.now(); tLastSpeech=tWake; heardSpeech=false; setState('listening');
        setTimeout(()=>{if(turns.isCurrent(turn))executeText(body.text,turn,'qa');},600);
      }
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
  }
  res.writeHead(404, cors); res.end();
}).listen(PORT, '127.0.0.1', () => log(`events on http://127.0.0.1:${PORT}/events`));

// ---- guided room calibration: labelled trials, held-out validation, RAM-only ----
let calib=null,lastCalib=null;
const ROOM_REPORT=join(paths.DATA,'voice','room-calibration-report.json');
try{lastCalib=JSON.parse(readFileSync(ROOM_REPORT,'utf8'));}catch{}
function calibrationSnapshot(){return calib?.event||lastCalib||null;}
function calibSend(event){if(calib)calib.event={t:'calib',...event};send({t:'calib',...event});}
function startCalibration(){
 if(calib||state!=='idle')return {ok:false,error:'Finish the current voice interaction first.'};
 if(!enabled||(!mic&&!process.env.GARDENER_VOICE_WAV))return {ok:false,error:'Turn voice listening on before calibration.'};
 const plan=roomPlan();
 calib={plan,buf:new Float32Array(RATE*plan.seconds),len:0,index:-1,lastTick:0,lastAudio:Date.now(),worker:null,baseline:{threshold:CAL.threshold,score:CAL.score,gain:CAL.gain},copies:[]};
 const C=calib;C.watch=setInterval(()=>{if(calib!==C)return;if(state==='analyzing'&&C.event&&Date.now()-(C.lastBeat||0)>2000){C.lastBeat=Date.now();send(C.event);}if(Date.now()-C.lastAudio>8000&&state==='calibrating')endCalibration(C,{ok:false,why:'The microphone stopped delivering audio. Current settings kept.'});},1000);
 ring.fill(0);utter.fill(0);utterLen=0;captureEpoch++;vad.reset();resetSpotter();
 setState('calibrating');calibAudio(new Float32Array());log('guided room calibration started');return {ok:true,seconds:plan.seconds};
}
function calibAudio(x){
 const C=calib;if(!C)return;C.lastAudio=Date.now();if(C.paused)return;
 const n=Math.min(x.length,C.buf.length-C.len);C.buf.set(x.subarray(0,n),C.len);C.len+=n;
 const elapsed=C.len/RATE,index=C.plan.steps.findIndex(s=>elapsed<s.end),s=C.plan.steps[index];
 if(s&&(index!==C.index||Date.now()-C.lastTick>400)){
  const cue=index!==C.index&&s.kind==='positive';if(index!==C.index&&s.kind==='move'&&!process.env.GARDENER_VOICE_WAV){const prompt=spawn('spd-say',['-w',s.label+'. Say the wake phrase once after each tone.'],{stdio:'ignore'});prompt.on('error',()=>{});C.prompt=prompt;}C.index=index;C.lastTick=Date.now();
  calibSend({phase:'record',step:index,kind:s.kind,label:s.label,zone:s.zone,repeat:s.repeat,cue,left:Math.max(0,Math.ceil(s.end-elapsed)),totalLeft:Math.ceil(C.plan.seconds-elapsed),seconds:C.plan.seconds,heard:C.plan.steps.slice(0,index).filter(s=>s.kind==='positive').length,level:rms(x)});
 }
 if(C.len>=C.buf.length){setState('analyzing');analyzeCalibration(C).catch(()=>{if(calib===C)endCalibration(C,{ok:false,why:'Calibration could not finish. Current settings kept.'});});}
}
function workerEvaluation(C,trials){
 return new Promise((resolve,reject)=>{
  // a child process, not a thread: the evaluation builds several detectors (~40 MB each) and a
  // process hands all of it back to the OS on exit (docs/performance/v7)
  const worker=fork(new URL('./voice-room-worker.mjs',import.meta.url),[],{serialization:'advanced',stdio:['ignore','inherit','inherit','ipc']});C.worker=worker;
  worker.terminate=()=>{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');};
  worker.send({...trials,baseline:C.baseline,dir:KWS_DIR,kwFile:join(paths.DATA,'voice','keywords.txt')});
  let settled=false;const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);C.rejectWorker=null;worker.terminate();err?reject(err):resolve(value);};
  const timer=setTimeout(()=>finish(Error('Calibration evaluation timed out')),420000);C.rejectWorker=()=>finish(Error('Calibration cancelled'));
  worker.on('message',m=>{if(calib!==C)return finish(Error('Obsolete session'));if(m.error)finish(Error(m.error));else if(m.done)finish(null,m);else calibSend({phase:'analyze',progress:m.progress*.8,label:'Testing noise, room sound, echo, distance and speed'});});
  worker.on('error',e=>finish(e));worker.on('exit',code=>{if(!settled)finish(Error('Calibration worker stopped: '+code));});
 });
}
async function analyzeCalibration(C){
 if(calib!==C)return;C.deadline=setTimeout(()=>{if(calib===C)endCalibration(C,{ok:false,why:'Calibration took too long. Current settings kept.'});},420000);calibSend({phase:'analyze',progress:0,label:'Checking the labelled trials'});
 const trials=extractTrials(C.buf,C.plan);C.copies.push(...trials.positives.map(x=>x.samples),...trials.negatives.map(x=>x.samples));
 C.buf.fill(0);const quiet=trials.positives.filter(p=>p.quiet);
 if(quiet.length)return endCalibration(C,{ok:false,why:`${quiet.length} trial(s) were too quiet or empty. Retry closer to the microphone at those positions. Current settings kept.`,quietPositions:[...new Set(quiet.map(p=>POSITIONS[p.zone]))]});
 const evaluation=await workerEvaluation(C,trials);if(calib!==C)return;
 const base=evaluation.results[0],selection=evaluation.selection,best=selection.candidate;
 const held=trials.positives.filter(p=>p.split==='validation'),zoneResults=[];let before=0,after=0;
 // Replay exactly the second-stage window at the candidate's first KWS trigger.
 for(const [i,p]of held.entries()){
  const k=evaluation.meta.findIndex(m=>m.id===p.id&&m.variant==='clean');const pass=[];
  for(const result of [base,best]){
   const end=result.ends[k];if(!end){pass.push(false);continue;}
   const samples=gainClip(p.samples.subarray(Math.max(0,end-RATE*2),end),result.config.gain);C.copies.push(samples);
   const text=await transcribe(samples);samples.fill(0);if(calib!==C)return;
   pass.push(WAKE_RE.test(text));
  }
  before+=Number(pass[0]);after+=Number(pass[1]);zoneResults.push({position:POSITIONS[p.zone],before:pass[0],after:pass[1]});
  calibSend({phase:'analyze',progress:.8+.2*(i+1)/held.length,label:'Checking the complete wake phrase on reserved trials'});
 }
 const perPositionSafe=zoneResults.every(z=>!z.before||z.after),changed=['threshold','score','gain'].some(k=>best.config[k]!==C.baseline[k]);
 const improved=best.tuning.recall>base.tuning.recall||after>before;
 const apply=selection.accepted&&perPositionSafe&&after>=before&&improved&&changed;
 const stats={takes:trials.positives.length,tests:evaluation.meta.length,candidates:evaluation.candidates,tuning:best.tuning,validation:best.validation,baseline:{tuning:base.tuning,validation:base.validation},wakeCheck:{before,after,total:held.length,positions:zoneResults}};
 let why=apply?'A better setting passed the reserved trials.':!selection.accepted?selection.reason:!perPositionSafe?'A reserved position got worse; current settings kept.':'No verified improvement over current settings; kept your existing profile.';
 if(apply){
  const previous={threshold:CAL.threshold,score:CAL.score,gain:CAL.gain,words:CAL.words};
  const next={...CAL,...best.config,previous,at:new Date().toISOString(),stats};
  // Write settings before swapping the live detector. Audio never enters this file.
  const detector=makeRoomDetector({dir:KWS_DIR,kwFile:join(paths.DATA,'voice','keywords.txt')},next.threshold,next.score);
  try{writeFileSync(CAL_FILE+'.next',JSON.stringify(next,null,2),{mode:0o600});renameSync(CAL_FILE+'.next',CAL_FILE);}catch{endCalibration(C,{ok:false,why:'Could not save calibration. Current settings kept.'});return;}
  CAL=next;kws=detector;buildWakeRe();
 }
 endCalibration(C,{ok:true,applied:apply,why,...stats,gain:CAL.gain,threshold:CAL.threshold,at:new Date().toISOString(),limits:'Four reserved real trials plus synthetic stress tests. This tunes thresholds and gain, not neural model weights. Short negative clips do not establish an all-day false-wake rate.'});
}
function endCalibration(C,result){
 if(calib!==C)return;clearInterval(C.watch);clearTimeout(C.deadline);C.prompt?.kill();C.rejectWorker?.();C.worker?.terminate();C.buf.fill(0);for(const x of C.copies)x.fill(0);calib=null;
 ring.fill(0);utter.fill(0);utterLen=0;vad.reset();resetSpotter();
 lastCalib={t:'calib',phase:'done',...result};try{writeFileSync(ROOM_REPORT,JSON.stringify(lastCalib,null,2),{mode:0o600});}catch{}
 send(lastCalib);setState('idle',{end:'calib'});
}
function undoCalibration(){
 if(calib||state!=='idle')return {ok:false,error:'Finish the current interaction first.'};
 if(!CAL.previous)return {ok:false,error:'There is no previous calibration to restore.'};
 const next={...CAL.previous,at:new Date().toISOString()};const detector=makeRoomDetector({dir:KWS_DIR,kwFile:join(paths.DATA,'voice','keywords.txt')},next.threshold,next.score);
 try{writeFileSync(CAL_FILE+'.next',JSON.stringify(next,null,2),{mode:0o600});renameSync(CAL_FILE+'.next',CAL_FILE);}catch{return {ok:false,error:'Could not save the restored profile.'};}
 CAL=next;kws=detector;buildWakeRe();resetSpotter();return {ok:true};
}

if (!existsSync(KWS_DIR) || !existsSync(ASR_DIR)) log('models missing — see tools/voice/README.md');
startMic();
process.on('SIGTERM', () => { if (state !== 'idle') send({ t: 'state', state: 'idle', end: 'cancel' }); stopMic(); setTimeout(() => process.exit(0), 50); });
