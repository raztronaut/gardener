import assert from 'node:assert/strict';
import {editUtterance,silenceBudget,VoiceTurns} from '../../../src/voice-turn.mjs';
import {directAction} from '../../../src/voice-fast.mjs';
import {runAgent} from '../../../src/voiceagent.mjs';
import {writeFileSync} from 'node:fs';
const rows=[];
const cases=[
 ...['cancel','stop','please stop','stop that',"don't do that",'do not do that','open weather actually stop','cancel that','please cancel my request','never mind','scratch that','stop listening','stop the voice message','discard that','open weather actually cancel that','open news never mind'].map(t=>[t,'cancel']),
 ...['stop the timer','stop the botanist','cancel the countdown','stop editing','stop the music','how do I cancel that subscription','type cancel that','say never mind','search for stop listening','write stop listening','open the weather','do not cancel that','how do I cancel that','why do people say cancel that','never mind the weather show news','do not stop the timer'].map(t=>[t,'submit']),
 ...['open weather actually','set a timer for','open the','move clock to','what is the weather and','wait','hold on','open weather I mean','start a timer for five no sorry'].map(t=>[t,'wait']),
 ['open weather actually open hacker news','correct','open hacker news'],['set a timer for five no ten minutes','correct','set a timer for ten minutes'],['set a timer for 5 minutes actually 10 minutes','correct','set a timer for 10 minutes'],['open weather no actually show the clock','correct','show the clock'],['open weather no clock','correct','open the clock'],['open weather i mean show the clock','correct','show the clock'],
];
for(const [text,kind,corrected] of cases){const r=editUtterance(text),ok=r.kind===kind&&(!corrected||r.text===corrected);rows.push({text,expected:kind,actual:r.kind,ok});}
for(const noun of ['weather','air quality','hacker news','fractal','clock','gardyn','transit','nearby transit'])for(const verb of ['open','show','show me']){const text=`${verb} the ${noun}`;rows.push({text,ok:directAction(text)?.name==='open'});}
for(const text of ['do not open the weather','open weather and delete my files','open the weather file','make the weather purple','open my news document','please stop running tests','stop timer and close calculator'])rows.push({text,ok:directAction(text)===null});
const ctl=new AbortController();ctl.abort();let calls=0;await assert.rejects(()=>runAgent('open the weather',{signal:ctl.signal,call:async()=>{calls++;}}));assert.equal(calls,0);
const turns=new VoiceTurns(),a=turns.begin(),b=turns.begin();assert.equal(a.controller.signal.aborted,true);assert.equal(turns.isCurrent(a),false);assert.equal(turns.isCurrent(b),true);turns.cancel();assert.equal(b.controller.signal.aborted,true);
assert.equal(silenceBudget('actually'),2200);assert.equal(silenceBudget('open weather'),750);
const out={at:new Date().toISOString(),passed:rows.filter(r=>r.ok).length,total:rows.length,rows};writeFileSync('/tmp/garden-v2-turn-eval.json',JSON.stringify(out,null,2));console.log(JSON.stringify({passed:out.passed,total:out.total,failures:rows.filter(r=>!r.ok)},null,2));assert.equal(out.passed,out.total);
