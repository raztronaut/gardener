// Pure room-calibration planning, augmentation and conservative model selection.
// No recordings or transcripts are persisted by this module.
export const RATE=16000;
export const POSITIONS=['Near the screen','Across the room','By the doorway','Your hardest listening spot'];
export function roomPlan(){
 let at=0;const steps=[];const add=(kind,seconds,label,extra={})=>{steps.push({kind,seconds,label,start:at,end:at+seconds,...extra});at+=seconds;};
 add('noise',20,'Room sound only — keep the usual fans or music on');
 add('negative',20,'Talk normally, without saying “Hey Garden”');
 for(const [zone,label]of POSITIONS.entries()){
  add('move',12,`Move: ${label.toLowerCase()}`,{zone});
  for(let repeat=0;repeat<3;repeat++)add('positive',[6,9,7][repeat],'Say “Hey Garden” once after the chime',{zone,repeat,split:repeat===2?'validation':'tuning'});
 }
 return {steps,seconds:at};
}
export const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/Math.max(1,x.length));
export function gainClip(x,gain){const y=new Float32Array(x.length);for(let i=0;i<x.length;i++)y[i]=Math.max(-1,Math.min(1,x[i]*gain));return y;}
export function trimTrial(x){
 const hop=320,levels=[];for(let i=0;i<x.length;i+=hop)levels.push(rms(x.subarray(i,i+hop)));
 const floor=[...levels].sort((a,b)=>a-b)[Math.floor(levels.length*.2)]||0;
 const threshold=Math.max(.0008,floor*2.4),active=levels.flatMap((v,i)=>v>threshold?[i]:[]);
 if(!active.length)return {samples:new Float32Array(),quiet:true};
 const start=Math.max(0,(active[0]-12)*hop),end=Math.min(x.length,(active.at(-1)+20)*hop);
 return {samples:x.slice(start,end),quiet:false};
}
export function extractTrials(audio,plan){
 const positives=[],negatives=[];
 for(const s of plan.steps){
  if(s.kind==='positive'){
   // Exclude the cue itself. Trials are labelled by the guided task, NOT by ASR.
   const x=audio.slice(Math.round((s.start+.5)*RATE),Math.round(s.end*RATE));const t=trimTrial(x);x.fill(0);
   positives.push({id:`spot-${s.zone}-take-${s.repeat}`,zone:s.zone,split:s.split,...t});
  }else if(['noise','negative'].includes(s.kind)){
   for(let i=0;i<4;i++)negatives.push({id:`${s.kind}-${i}`,split:i%2?'validation':'tuning',kind:s.kind,samples:audio.slice((s.start+i*5)*RATE,(s.start+(i+1)*5)*RATE)});
  }
 }
 return {positives,negatives};
}
function rng(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function noiseAtSnr(x,snr,{pink=false,seed=73}={}){
 const random=rng(seed),noise=new Float32Array(x.length);let low=0;
 for(let i=0;i<x.length;i++){const white=random()*2-1;low=.97*low+.03*white;noise[i]=pink?low:white;}
 const scale=rms(x)/Math.max(1e-9,rms(noise))/10**(snr/20),y=new Float32Array(x.length);
 for(let i=0;i<x.length;i++)y[i]=x[i]+noise[i]*scale;noise.fill(0);return gainClip(y,1);
}
export function augment(x,name,room=new Float32Array()){
 if(name==='clean')return new Float32Array(x);
 if(name==='noise')return noiseAtSnr(x,10);
 if(name==='pink')return noiseAtSnr(x,6,{pink:true});
 if(name==='far')return noiseAtSnr(gainClip(x,.35),8,{pink:true});
 if(name==='room'){
  if(rms(room)<1e-8)return noiseAtSnr(x,10,{pink:true});
  const y=new Float32Array(x.length),g=rms(x)/rms(room)*.4;
  for(let i=0;i<x.length;i++)y[i]=x[i]+room[i%room.length]*g;return gainClip(y,1);
 }
 if(name==='echo'){
  const y=new Float32Array(x.length+Math.round(.25*RATE));
  for(let i=0;i<x.length;i++){y[i]+=x[i];for(const [delay,g]of [[.035,.25],[.08,.18],[.14,.1],[.23,.06]])y[i+Math.round(delay*RATE)]+=x[i]*g;}
  return gainClip(y,1);
 }
 if(['slower','faster'].includes(name)){
  const f=name==='slower'?.92:1.08,y=new Float32Array(Math.floor(x.length/f));
  for(let i=0;i<y.length;i++){const p=i*f,j=Math.floor(p),a=p-j;y[i]=(x[j]||0)*(1-a)+(x[j+1]||0)*a;}return y;
 }
 throw Error('Unknown augmentation');
}
export function summarize(out,meta,split){
 const p=meta.flatMap((m,i)=>m.split===split&&m.positive?[i]:[]),n=meta.flatMap((m,i)=>m.split===split&&!m.positive?[i]:[]);
 const clean=p.filter(i=>meta[i].variant==='clean'),hits=indices=>indices.filter(i=>out[i]>0).length;
 return {hits:hits(p),total:p.length,recall:p.length?hits(p)/p.length:0,cleanHits:hits(clean),cleanTotal:clean.length,falseTriggers:n.reduce((s,i)=>s+out[i],0),negativeSeconds:n.reduce((s,i)=>s+meta[i].seconds,0)};
}
export function chooseCandidate(results){
 const baseline=results[0];if(!baseline)return null;
 // Never consult held-out trials to choose among candidates.
 const safe=results.filter(r=>r.clipping<=.01&&r.tuning.falseTriggers===0&&r.tuning.cleanHits>=baseline.tuning.cleanHits);
 safe.sort((a,b)=>b.tuning.recall-a.tuning.recall||b.config.threshold-a.config.threshold||a.config.gain-b.config.gain||a.config.score-b.config.score);
 const best=safe[0];if(!best)return {candidate:baseline,accepted:false,reason:'No setting passed the false-trigger checks.'};
 if(!best.validation||!baseline.validation)return {candidate:best,accepted:false,reason:'Reserved trials pending.'};
 const validation=best.validation,before=baseline.validation;
 const accepted=validation.falseTriggers===0&&validation.cleanHits>=before.cleanHits&&validation.recall>=before.recall&&best.tuning.recall>=baseline.tuning.recall;
 return {candidate:best,accepted,reason:accepted?'Held-out checks passed.':'The candidate did not beat the existing held-out checks; current settings kept.'};
}
