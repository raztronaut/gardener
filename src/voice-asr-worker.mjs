// The Gardener™ — speech-to-text worker for src/voice.mjs (Parakeet TDT 110M via
// sherpa-onnx, CPU). Lives in its own thread so decoding never stalls the mic loop, the
// wake word or the level stream. Gets Float32Array samples (transferred), returns text.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
const D = workerData.dir;
const asr = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: { encoder: join(D, 'encoder.int8.onnx'), decoder: join(D, 'decoder.int8.onnx'), joiner: join(D, 'joiner.int8.onnx') },
    tokens: join(D, 'tokens.txt'), numThreads: 4, provider: 'cpu', modelType: 'nemo_transducer', debug: 0,
  },
});
parentPort.on('message', ({ id, samples }) => {
  let text = '';
  try {
    if (samples.length >= 16000 * 0.25) {
      const st = asr.createStream();
      const lead = new Float32Array(16000 * 0.3); // a beat of silence first: the model keeps the first word
      st.acceptWaveform({ sampleRate: 16000, samples: lead });
      st.acceptWaveform({ sampleRate: 16000, samples });
      st.acceptWaveform({ sampleRate: 16000, samples: lead });
      asr.decode(st);
      text = String(asr.getResult(st).text || '').trim();
    }
  } catch { text = ''; }
  samples.fill(0); // the audio is gone
  parentPort.postMessage({ id, text });
});
parentPort.postMessage({ ready: true });
