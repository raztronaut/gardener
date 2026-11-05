import {Worker} from 'node:worker_threads';import {once} from 'node:events';import {createRequire} from 'node:module';import {join} from 'node:path';import {writeFileSync} from 'node:fs';
const sherpa=createRequire(import.meta.url)('sherpa-onnx-node'),dir=join(process.cwd(),'data/voice/models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8');
const rows=[];let seed=917;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const expected={'en-english.wav':'I love you.','0.wav':"Well, I don't wish to see it any more, observed Phoebe, turning away her eyes. It is certainly very like the old portrait."};
for(const threads of [2,1,4,4,1,2]) {
 const worker=new Worker(new URL('../../../src/voice-asr-worker.mjs',import.meta.url),{workerData:{dir,threads}});await once(worker,'message');
 for(const file of ['en-english.wav','0.wav'])for(const condition of ['clean','quiet','noise']){
  const wave=sherpa.readWave(join(dir,'test_wavs',file));const samples=new Float32Array(wave.samples);
  const rms=Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length);
  for(let i=0;i<samples.length;i++){if(condition==='quiet')samples[i]*=.25;if(condition==='noise')samples[i]=Math.max(-1,Math.min(1,samples[i]+(rnd()*2-1)*rms*.55));}
  const p=once(worker,'message'),t=performance.now();worker.postMessage({id:1,samples},[samples.buffer]);const [out]=await p;
  rows.push({threads,file,condition,ms:Math.round(performance.now()-t),correct:out.text.toLowerCase().replace(/[^a-z ]/g,'')===expected[file].toLowerCase().replace(/[^a-z ]/g,''),text:out.text});
 }
 await worker.terminate();console.log('ASR batch complete',threads,rows.length);
}
writeFileSync('/tmp/garden-v2-asr.json',JSON.stringify({at:new Date().toISOString(),method:'36 bundled-sample decodes; clean, quiet, seeded additive noise; reversed thread order; not household audio',rows},null,2));
