// Bundled + synthetic utterances only. Never captures a household microphone.
import {Worker} from 'node:worker_threads';import{once}from'node:events';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';import{mkdtempSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
const sherpa=createRequire(import.meta.url)('sherpa-onnx-node');
const root=mkdtempSync(join(tmpdir(),'garden-v3-speech-'));
const phrases=['open the weather actually open hacker news','please cancel this message','set a timer for two minutes actually set a timer for ten minutes','connect to tech crunch'];
const samples=phrases.map((text,i)=>{const path=join(root,i+'.wav');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`flite=text='${text}':voice=${i%2?'rms':'slt'}`,'-ar','16000','-ac','1',path]);return sherpa.readWave(path).samples;});
const models={garden:join(process.cwd(),'data/voice/models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8'),paseo:join(process.env.HOME,'.paseo/models/local-speech/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8')};
const rows=[],loads=[];const norm=s=>s.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
for(const model of ['garden','paseo','paseo','garden']){
 const t0=performance.now();const worker=new Worker(new URL('../../../src/voice-asr-worker.mjs',import.meta.url),{workerData:{dir:models[model],threads:2}});await once(worker,'message');loads.push({model,ms:Math.round(performance.now()-t0),rssMB:Math.round(process.memoryUsage().rss/1048576)});
 for(let i=0;i<phrases.length;i++)for(const condition of ['clean','noise']){
  const audio=new Float32Array(samples[i]);let seed=991;const rms=Math.sqrt(audio.reduce((s,x)=>s+x*x,0)/audio.length);
  if(condition==='noise')for(let k=0;k<audio.length;k++){seed=(1664525*seed+1013904223)>>>0;audio[k]=Math.max(-1,Math.min(1,audio[k]+(seed/4294967296*2-1)*rms*.55));}
  const start=performance.now(),p=once(worker,'message');worker.postMessage({id:rows.length,samples:audio},[audio.buffer]);const [result]=await p;
  rows.push({model,threads:2,phrase:phrases[i],condition,seconds:samples[i].length/16000,ms:Math.round(performance.now()-start),text:result.text,exact: norm(result.text)===norm(phrases[i]),rssMB:Math.round(process.memoryUsage().rss/1048576)});
 }
 await worker.terminate();console.log('Completed',model,rows.length);
}
writeFileSync('docs/performance/v3/speech.json',JSON.stringify({at:new Date().toISOString(),method:'32 sequential decodes, four synthetic phrases, two voices, clean/noise, reversed model order; CPU, two threads. No room audio; not a production accuracy claim.',loads,rows},null,2));
