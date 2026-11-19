// Reproduces voice.mjs's memory pattern without the mic or the wall: wake spotter + VAD fed
// continuously on the main thread, Parakeet in the real ASR worker (src/voice-asr-worker.mjs),
// and "turns" = a 2 s wake check, partial decodes every 450 ms over a growing request, then a
// final decode (requests 3–12 s, built from the bundled test speech). No audio is written.
// usage: node bench-voice-memory.mjs [turns=40]   → one JSON line per checkpoint
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const G = new URL('../../../', import.meta.url).pathname;
const sherpa = createRequire(join(G, 'package.json'))('sherpa-onnx-node');
const M = join(G, 'data/voice/models'), K = join(M, 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01');
const A = join(M, 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8');
const RATE = 16000, TURNS = +process.argv[2] || 40;
const mem = () => { const s = readFileSync('/proc/self/status', 'utf8'); const g = (k) => +(s.match(new RegExp(k + ':\\s+(\\d+)'))?.[1] || 0) >> 10; return { rss: g('VmRSS'), swap: g('VmSwap'), hwm: g('VmHWM'), threads: g('Threads') << 10 >> 10 }; };
const out = (tag, extra = {}) => console.log(JSON.stringify({ tag, t: Math.round(performance.now()), ...mem(), ...extra }));
out('start');
const kws = new sherpa.KeywordSpotter({ featConfig: { sampleRate: RATE, featureDim: 80 }, modelConfig: { transducer: { encoder: join(K, 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx'), decoder: join(K, 'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx'), joiner: join(K, 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx') }, tokens: join(K, 'tokens.txt'), numThreads: 1, provider: 'cpu', debug: 0 }, keywordsFile: join(G, 'data/voice/keywords.txt') });
const vad = new sherpa.Vad({ sileroVad: { model: join(M, 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.25, minSpeechDuration: 0.15, windowSize: 512, maxSpeechDuration: 20 }, sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0 }, 30);
const w = new Worker(join(G, 'src/voice-asr-worker.mjs'), { workerData: { dir: A } });
await new Promise((r) => w.once('message', r));
out('loaded');
const wait = new Map(); let n = 0;
w.on('message', (m) => { if (m.id) { wait.get(m.id)(m); wait.delete(m.id); } });
const asr = (s) => new Promise((r) => { const id = ++n, c = new Float32Array(s); wait.set(id, r); w.postMessage({ id, samples: c }, [c.buffer]); });
const speech = (() => { const a = sherpa.readWave(join(A, 'test_wavs/en-english.wav')), b = sherpa.readWave(join(A, 'test_wavs/0.wav')); const x = new Float32Array(a.samples.length + b.samples.length); x.set(a.samples); x.set(b.samples, a.samples.length); return x; })();
let st = kws.createStream(), pos = 0;
const feed = (ms) => { const len = RATE * ms / 1000; for (let o = 0; o < len; o += 1600) { const c = speech.subarray(pos % (speech.length - 1600), pos % (speech.length - 1600) + 1600); pos += 1600; st.acceptWaveform({ sampleRate: RATE, samples: c }); while (kws.isReady(st)) kws.decode(st); vad.acceptWaveform(c); while (!vad.isEmpty()) vad.pop(); } };
const decodes = [];
for (let t = 0; t < TURNS; t++) {
  feed(3000);
  const off = (t * 7919) % (speech.length - RATE * 12);
  decodes.push((await asr(speech.subarray(off, off + RATE * 2))).decodeMs); // wake check
  st = kws.createStream();
  const reqS = 3 + (t * 37) % 10; // 3..12 s
  for (let s = 0.45; s < reqS; s += 0.45) { feed(450); decodes.push((await asr(speech.subarray(off, off + Math.round(RATE * s)))).decodeMs); }
  decodes.push((await asr(speech.subarray(off, off + RATE * reqS))).decodeMs); // final
  if ((t + 1) % 10 === 0) { decodes.sort((a, b) => a - b); out('turns', { done: t + 1, decodeMedian: decodes[decodes.length >> 1], decodeP95: decodes[Math.floor(decodes.length * 0.95)] }); decodes.length = 0; }
}
await w.terminate();
