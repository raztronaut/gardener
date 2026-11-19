import {parentPort as threadPort,workerData as threadData} from 'node:worker_threads';
// Runs as a child process (src/voice.mjs forks it) so every detector it builds is returned to
// the OS when it exits; a worker thread left that memory stranded in the voice process.
// Still works as a worker thread (threadPort) for older callers.
const workerData=threadData??await new Promise(r=>process.once('message',r));
let lastSend=Promise.resolve();
const parentPort=threadPort??{
 postMessage:(m)=>{lastSend=new Promise(r=>process.send(m,undefined,{},()=>r()));},
 close:()=>{lastSend.then(()=>process.disconnect());},
};
import {makeDetector,fires} from './voice-kws-eval.mjs';
import {augment,gainClip,rms,summarize,chooseCandidate,RATE} from './voice-room-calibration.mjs';
const {positives,negatives,baseline,dir,kwFile}=workerData;
const clips=[],meta=[];
try{
 const variants=['clean','noise','pink','room','echo','far','slower','faster'];
 const room=negatives.find(n=>n.kind==='noise')?.samples;
 for(const p of positives)for(const variant of (p.split==='tuning'?['clean','noise','echo']:variants)){const x=augment(p.samples,variant,room);clips.push(x);meta.push({id:p.id,zone:p.zone,split:p.split,positive:true,variant,seconds:x.length/RATE});}
 for(const n of negatives){clips.push(n.samples);meta.push({...n,samples:undefined,positive:false,seconds:n.samples.length/RATE});}
 const levels=positives.filter(p=>p.split==='tuning').map(p=>rms(p.samples)).sort((a,b)=>a-b),median=levels[Math.floor(levels.length/2)]||.063;
 const auto=Math.max(1,Math.min(4,.063/median)),gains=[baseline.gain];if(Math.abs(auto-baseline.gain)>.3)gains.push(+auto.toFixed(2));
 const configs=[baseline];for(const gain of gains)for(const threshold of [...new Set([baseline.threshold,Math.min(.4,+(baseline.threshold*1.3).toFixed(3)),Math.max(.07,+(baseline.threshold*.6).toFixed(3))])])for(const score of [baseline.score])if(!configs.some(c=>c.gain===gain&&c.threshold===threshold&&c.score===score))configs.push({threshold,score,gain});
 const results=[];
 for(const [i,config]of configs.entries()){
  const detector=makeDetector({dir,kwFile},config.threshold,config.score);const out=[],ends=[];let clipped=0,total=0;
  for(const [j,x]of clips.entries()){
   if(meta[j].split==='validation'){out.push(0);ends.push(null);continue;}
   for(const v of x){total++;if(Math.abs(v*config.gain)>1)clipped++;}
   const scaled=gainClip(x,config.gain);try{const result=fires(detector,scaled,true);out.push(result.count);ends.push(result.firstEnd);}finally{scaled.fill(0);}
   if(j%8===0)parentPort.postMessage({progress:(i+j/clips.length)/configs.length});
  }
  results.push({config,out,ends,clipping:clipped/Math.max(1,total),tuning:summarize(out,meta,'tuning'),validation:null});
 }
 const proposed=chooseCandidate(results).candidate;
 for(const result of [...new Set([results[0],proposed])]){
  const detector=makeDetector({dir,kwFile},result.config.threshold,result.config.score);
  for(const [i,x]of clips.entries())if(meta[i].split==='validation'){
   const y=gainClip(x,result.config.gain);try{const r=fires(detector,y,true);result.out[i]=r.count;result.ends[i]=r.firstEnd;}finally{y.fill(0);}
  }
  result.validation=summarize(result.out,meta,'validation');
 }
 const selection=chooseCandidate(results);
 parentPort.postMessage({done:true,results,meta,selection,candidates:configs.length});
}catch(e){parentPort.postMessage({error:e.message});}finally{for(const x of clips)x.fill(0);for(const x of positives)x.samples.fill(0);for(const x of negatives)x.samples.fill(0);parentPort.close();}
