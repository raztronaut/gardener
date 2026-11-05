import {spawn,execFileSync} from 'node:child_process';import {mkdtempSync,mkdirSync,symlinkSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const cases=[['open the weather actually open hacker news','news'],['please cancel this message','cancel'],['set a timer for two minutes actually set a timer for ten minutes','timer']];
const root=mkdtempSync(join(tmpdir(),'garden-audio-eval-'));mkdirSync(join(root,'voice'));symlinkSync(join(process.cwd(),'data/voice/models'),join(root,'voice/models'));
const files=cases.map(([text],i)=>{const f=join(root,`${i}.wav`);execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`flite=text='${text}':voice=slt`,'-ar','16000','-ac','1',f]);return f;});
const lengths=files.map(f=>Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',f]).toString()));
const child=spawn(process.execPath,['src/voice.mjs'],{env:{...process.env,GARDENER_DATA:root,GARDENER_VOICE_PORT:'8857',GARDENER_VOICE_WAV:files.join(',')},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
let ctl=new AbortController(),timers=[];const events=[],start=performance.now();
try {
 let r;for(let i=0;i<80;i++){try{r=await fetch('http://127.0.0.1:8857/status');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const response=await fetch('http://127.0.0.1:8857/events',{signal:ctl.signal});
 const post=(path,body)=>fetch('http://127.0.0.1:8857'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 timers.push(setTimeout(()=>ctl.abort(),90000));
 let pending='';try{for await(const chunk of response.body){pending+=new TextDecoder().decode(chunk);let end;while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const l=frame.split('\n').find(x=>x.startsWith('data: '));if(!l)continue;const e=JSON.parse(l.slice(6));if(e.t==='qa-audio'){await post('/ptt',{down:e.down});if(e.index===cases.length-1&&!e.down)timers.push(setTimeout(()=>ctl.abort(),5000));continue;}if(e.t==='level'||e.t==='beat')continue;events.push({ms:Math.round(performance.now()-start),...e});if(e.t==='context')await post('/reply',{id:e.id,data:{dashboard:'main',commands:[{name:'timer'}],widgets:[{id:'weather'},{id:'hacker-news'}]}});if(e.t==='act')await post('/reply',{id:e.id,data:e.calls.map(()=>({ok:true}))});}}}catch(e){if(!ctl.signal.aborted)throw e;}
 const acts=events.filter(e=>e.t==='act').flatMap(e=>e.calls);const transcripts=events.filter(e=>e.t==='transcript');
 const checks={livePartials:events.filter(e=>e.t==='partial').length>=3,news:acts.some(a=>a.name==='open'&&a.input.target==='hacker-news'),timer:acts.some(a=>a.input?.name==='timer'&&a.input.arg==='10'),noAbandonedWeather:!acts.some(a=>a.name==='open'&&a.input.target==='weather'),spokenCancel:events.some(e=>e.why==='spoken-cancel')};
 writeFileSync('/tmp/garden-v2-audio.json',JSON.stringify({at:new Date().toISOString(),method:'synthetic flite speech -> paced PCM -> real VAD/Parakeet -> edit -> stub wall; push-to-talk, no wake test',checks,events,logs},null,2));console.log(checks);if(Object.values(checks).some(x=>!x))process.exitCode=1;
}finally{ctl.abort();timers.forEach(clearTimeout);child.kill('SIGTERM');}
