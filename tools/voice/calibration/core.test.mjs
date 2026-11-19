import test from 'node:test';import assert from 'node:assert/strict';
import {roomPlan,extractTrials,RATE,noiseAtSnr,rms,augment,chooseCandidate,gainClip} from '../../../src/voice-room-calibration.mjs';
test('four positions, unequal intervals, 12 independent labelled trials and reserved third takes',()=>{
 const p=roomPlan(),trials=p.steps.filter(s=>s.kind==='positive');assert.equal(trials.length,12);assert.equal(trials.filter(s=>s.split==='validation').length,4);assert(new Set(trials.map(s=>s.seconds)).size>1);assert(p.seconds<180);
 for(let i=1;i<p.steps.length;i++)assert.equal(p.steps[i].start,p.steps[i-1].end);
 const audio=new Float32Array(RATE*p.seconds);for(const s of trials)for(let i=(s.start+2)*RATE;i<(s.start+3)*RATE;i++)audio[i]=.02*Math.sin(i*.1);
 const result=extractTrials(audio,p);assert(result.positives.every(p=>!p.quiet));assert.equal(result.negatives.length,8);assert.equal(result.negatives.filter(n=>n.split==='validation').reduce((s,n)=>s+n.samples.length/RATE,0),20);
 assert.deepEqual(result.positives.map(p=>p.split),trials.map(p=>p.split));audio.fill(0);
});
test('quiet trials remain visible failures instead of being excluded by transcription',()=>{const p=roomPlan(),r=extractTrials(new Float32Array(p.seconds*RATE),p);assert.equal(r.positives.filter(x=>x.quiet).length,12);});
test('noise is deterministic, measured SNR is accurate and all variants are finite',()=>{
 const x=Float32Array.from({length:16000},(_,i)=>.05*Math.sin(i*.02));const y=noiseAtSnr(x,10),delta=y.map((v,i)=>v-x[i]);assert(Math.abs(20*Math.log10(rms(x)/rms(delta))-10)<.01);assert.deepEqual(y,noiseAtSnr(x,10));
 for(const name of ['clean','noise','pink','room','echo','far','slower','faster']){const z=augment(x,name);assert(z.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));assert.notEqual(z,x);}assert.equal(gainClip(new Float32Array([.75,-.75]),2)[0],1);
});
const result=(recall,validation=recall,fp=0)=>({config:{threshold:.25,score:1,gain:1},clipping:0,tuning:{recall,cleanHits:8,falseTriggers:fp},validation:{recall:validation,cleanHits:4,falseTriggers:fp}});
test('selection uses tuning only and vetoes a held-out regression',()=>{const baseline=result(.7),overfit=result(.9,.6),less=result(.8,.95);const choice=chooseCandidate([baseline,overfit,less]);assert.equal(choice.candidate,overfit);assert.equal(choice.accepted,false);});
test('false triggers and clipping veto a candidate',()=>{const b=result(.5),bad=result(1,1,1),clipped={...result(1),clipping:.02};assert.equal(chooseCandidate([b,bad,clipped]).candidate,b);});
test('conservative tie keeps higher threshold, then lower gain',()=>{const b=result(.8),r={...result(.8),config:{threshold:.12,score:1.5,gain:3}};assert.equal(chooseCandidate([b,r]).candidate,b);});
