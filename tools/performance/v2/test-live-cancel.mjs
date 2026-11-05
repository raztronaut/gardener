import {spawn,execFileSync} from 'node:child_process';import {mkdtempSync,mkdirSync,symlinkSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'garden-cancel-eval-'));mkdirSync(join(dir,'voice'));symlinkSync(join(process.cwd(),'data/voice/models'),join(dir,'voice/models'));
const silent=join(dir,'silence.wav');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','1',silent]);
const child=spawn(process.execPath,['src/voice.mjs'],{env:{...process.env,GARDENER_DATA:dir,GARDENER_VOICE_PORT:'8858',GARDENER_VOICE_WAV:silent},stdio:['ignore','pipe','pipe']}),ctl=new AbortController();let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);const events=[];let contextResolve,contextSeen=new Promise(r=>contextResolve=r);let obsoleteId;
const post=(path,body)=>fetch('http://127.0.0.1:8858'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:8858/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const response=await fetch('http://127.0.0.1:8858/events',{signal:ctl.signal});
 const consume=(async()=>{let text='';for await(const c of response.body){text+=new TextDecoder().decode(c);let i;while((i=text.indexOf('\n\n'))>=0){const f=text.slice(0,i);text=text.slice(i+2);const l=f.split('\n').find(l=>l.startsWith('data: '));if(!l)continue;const e=JSON.parse(l.slice(6));events.push(e);if(e.t==='context'){obsoleteId=e.id;contextResolve();}if(e.t==='act')await post('/reply',{id:e.id,data:e.calls.map(()=>({ok:true}))});}}})();consume.catch(()=>{});
 await post('/say',{text:'Could you please open the weather panel?'});await Promise.race([contextSeen,new Promise((_,r)=>setTimeout(()=>r(Error('no context')),10000))]);
 await post('/control',{cancel:true});await post('/reply',{id:obsoleteId,data:{widgets:[{id:'weather'}]}});await new Promise(r=>setTimeout(r,1000));assert.equal(events.filter(e=>e.t==='act').length,0,'cancelled context produced an action');
 await post('/say',{text:'set a timer for five no ten minutes'});let done=false;
 for(let i=0;i<60;i++){if(events.some(e=>e.t==='state'&&e.end==='done')){done=true;break;}await new Promise(r=>setTimeout(r,100));}
 const acts=events.filter(e=>e.t==='act').flatMap(e=>e.calls);assert.equal(done,true);assert.equal(acts.length,1);assert.equal(acts[0].input.arg,'10');
 writeFileSync('/tmp/garden-v2-live-cancel.json',JSON.stringify({cancelDuringContext:true,obsoleteReplyIgnored:true,nextCorrectedTurnSucceeds:true,events},null,2));console.log('PASS real voice service: cancel pending context, ignore obsolete reply, accept corrected next turn');
}finally{writeFileSync('/tmp/garden-v2-live-cancel-debug.json',JSON.stringify({logs,events},null,2));ctl.abort();child.kill('SIGTERM');}
