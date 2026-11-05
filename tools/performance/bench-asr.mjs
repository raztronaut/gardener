import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { once } from 'node:events';
const sherpa=createRequire(import.meta.url)('sherpa-onnx-node');
const dir=join(process.cwd(),'data/voice/models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8');
const wave=sherpa.readWave(join(dir,'test_wavs/en-english.wav'));
const rows=[];
for(const threads of [4,2,1]) {
 const w=new Worker(new URL('../../src/voice-asr-worker.mjs',import.meta.url),{workerData:{dir,threads}});
 await once(w,'message');
 for(let i=0;i<4;i++) { const samples=new Float32Array(wave.samples); const start=performance.now(); const p=once(w,'message'); w.postMessage({id:i+1,samples},[samples.buffer]); const [m]=await p; rows.push({threads,iteration:i,ms:Math.round(performance.now()-start),decodeMs:m.decodeMs,text:m.text}); }
 await w.terminate();
 console.log(JSON.stringify(rows.filter(r=>r.threads===threads)));
}
writeFileSync('/tmp/garden-asr-bench.json',JSON.stringify({sample:'bundled en-english.wav; not household speech',seconds:wave.samples.length/wave.sampleRate,rows},null,2));
