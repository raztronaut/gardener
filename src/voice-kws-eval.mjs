import {createRequire} from 'node:module';import {join} from 'node:path';
const sherpa=createRequire(import.meta.url)('sherpa-onnx-node');const RATE=16000,OFF=Math.round(RATE*.32),STEP=320;
export function makeDetector({dir,kwFile},threshold,score) {
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
export function fires(k, x, detail=false) {
  let A = k.createStream(), B = null, fed = 0, n = 0, firstEnd=null;
  for (let p = 0; p < x.length; p += STEP) {
    const c = x.subarray(p, p + STEP);
    let fired=false;
    for (const st of [A, B]) {
      if (!st) continue;
      st.acceptWaveform({ sampleRate: RATE, samples: c });
      while (k.isReady(st)) { k.decode(st); if (k.getResult(st).keyword) { n++; firstEnd ??= p+c.length; A = k.createStream(); B = null; fed = 0; fired=true; break; } }
      if(fired)break;
    }
    if(fired)continue;
    fed += c.length;
    if (!B && fed >= OFF) B = k.createStream();
  }
  return detail?{count:n,firstEnd}:n;
}
