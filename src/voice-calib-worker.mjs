// The Gardener™ — wake-word calibration worker (src/voice.mjs "calibrate"): runs the
// keyword spotter with ONE candidate setting over every test clip (the person's own
// "hey garden"s plus their noisy / echoey / far / babble / speed variants, and the
// negatives), exactly as the live listener does (two streams offset by 0.32 s), and
// reports which clips fired. The clips live only in memory and are zeroed when done.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
const { dir, keywords, kwFile } = workerData;
writeFileSync(kwFile, keywords);
const RATE = 16000, OFF = Math.round(RATE * 0.32), STEP = 320;

function spotter(threshold, score) {
  return new sherpa.KeywordSpotter({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx'),
        decoder: join(dir, 'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx'),
        joiner: join(dir, 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx'),
      },
      tokens: join(dir, 'tokens.txt'), numThreads: 1, provider: 'cpu', debug: 0,
    },
    keywordsFile: kwFile, keywordsThreshold: threshold, keywordsScore: score,
  });
}
// how many times the phrase fires in x (fresh streams, like the live listener after a reset)
function fires(k, x) {
  let A = k.createStream(), B = null, fed = 0, n = 0;
  for (let p = 0; p < x.length; p += STEP) {
    const c = x.subarray(p, p + STEP);
    for (const st of [A, B]) {
      if (!st) continue;
      st.acceptWaveform({ sampleRate: RATE, samples: c });
      while (k.isReady(st)) { k.decode(st); if (k.getResult(st).keyword) { n++; A = k.createStream(); B = null; fed = 0; break; } }
    }
    fed += c.length;
    if (!B && fed >= OFF) B = k.createStream();
  }
  return n;
}
parentPort.on('message', ({ id, threshold, score, clips }) => {
  const k = spotter(threshold, score);
  const out = clips.map((x) => fires(k, x));
  for (const x of clips) x.fill(0);
  parentPort.postMessage({ id, out });
});
