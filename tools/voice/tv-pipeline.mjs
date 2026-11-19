// Synthetic speech only. A separate voice process and pinned loopback TV fixture;
// no household microphone, no production TV/wall actions, no persisted real speech.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,symlinkSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import https from 'node:https';import {openNetflix,catalogEntries} from '/home/talbot/.local/share/garden-tv/bridge/tv-media.mjs';import assert from 'node:assert/strict';
const base='/home/talbot/.local/share/garden-tv/bridge',dir=mkdtempSync(join(tmpdir(),'garden-tv-voice-eval-'));
mkdirSync(join(dir,'voice'));symlinkSync(join(process.cwd(),'data/voice/models'),join(dir,'voice/models'));
const cases=[['open twitch on the TV','twitch'],['open twitch actually open spotify on the TV','spotify'],['open netflix on the TV no cancel that','cancel'],['put the original animated Avatar the Last Airbender on Netflix on the TV','media'],['hey garden open twitch on the TV','wake']];
const files=cases.map(([text],i)=>{const f=join(dir,i+'.wav');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`flite=text='${text}':voice=slt`,'-ar','16000','-ac','1',f]);return f;});
const calls=[],events=[];let sample=-1;const ready=join(dir,'ready');writeFileSync(ready,'test');
const config=JSON.parse(readFileSync(base+'/config.json'));
const server=https.createServer({key:readFileSync(base+'/key.pem'),cert:readFileSync(base+'/cert.pem')},async(req,res)=>{
 assert.equal(req.headers.authorization,'Bearer '+config.token);
 let body='';for await(const c of req)body+=c;
 res.setHeader('content-type','application/json');
 if(req.url==='/voice/context')return res.end(JSON.stringify({destination:'tv',name:'GardenTV',widgets:[{id:'netflix'},{id:'twitch'},{id:'spotify'}],commands:[],media:{verifiedNetflix:catalogEntries(),netflix:'Search official Netflix title, then media tool; profile required. Do not claim playing.'}}));
 if(req.url==='/voice/act'){const a=JSON.parse(body).calls;calls.push(...a.map(a=>({sample,...a})));return res.end(JSON.stringify(await Promise.all(a.map(async a=>a.name==='media'?openNetflix(a.input,{requestedText:JSON.parse(body).request,shell:async()=>'',foreground:async()=>true}):({ok:true,say:a.input.target+' opened on the TV.'})))));}
 res.writeHead(404);res.end('{}');
});await new Promise(r=>server.listen(8871,'127.0.0.1',r));
const child=spawn(process.execPath,['src/voice.mjs'],{env:{...process.env,GARDENER_DATA:dir,GARDENER_VOICE_PORT:'8859',GARDENER_TV_BRIDGE_PORT:'8871',GARDENER_TV_BRIDGE_CONFIG:base+'/config.json',GARDENER_TV_VOICE_READY_FILE:ready,GARDENER_VOICE_WAV:files.join(',')},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);const ctl=new AbortController();const post=(p,b)=>fetch('http://127.0.0.1:8859'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});let tailTimer;const timer=setTimeout(()=>ctl.abort(),210000);
try{
 for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:8859/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const response=await fetch('http://127.0.0.1:8859/events',{signal:ctl.signal});let text='';
 try{for await(const c of response.body){text+=new TextDecoder().decode(c);let cut;while((cut=text.indexOf('\n\n'))>=0){const f=text.slice(0,cut);text=text.slice(cut+2);const l=f.split('\n').find(l=>l.startsWith('data:'));if(!l)continue;const e=JSON.parse(l.slice(5));if(e.t==='qa-audio'){sample=e.index;if(sample<4&&e.down)await post('/ptt',{down:true,auto:true});if(sample===4&&!e.down)tailTimer=setTimeout(()=>ctl.abort(),30000);continue;}if(e.t==='state'&&e.end&&sample===4)ctl.abort();if(!['level','beat'].includes(e.t))events.push({sample,at:Date.now(),...e});if(e.t==='context')await post('/reply',{id:e.id,data:{dashboard:'main',widgets:[],commands:[]}});if(e.t==='act')await post('/reply',{id:e.id,data:e.calls.map(()=>({ok:false,error:'Unexpected wall route in TV test'}))});}}}catch(e){if(!ctl.signal.aborted)throw e;}
 const checks={twitch:calls.some(c=>c.sample===0&&c.input.target==='twitch'),safeCorrection:!calls.some(c=>c.sample===1&&c.input.target==='twitch')&&(calls.some(c=>c.sample===1&&c.input.target==='spotify')||events.some(e=>e.sample===1&&e.t==='state'&&e.end&&e.reply)),cancelled:!calls.some(c=>c.sample===2)&&events.some(e=>e.sample===2&&e.why==='spoken-cancel'),netflixMedia:calls.some(c=>c.sample===3&&c.name==='media'&&c.input.url.endsWith('70142405')),wakeTwitch:calls.some(c=>c.sample===4&&c.input.target==='twitch'),partials:events.some(e=>e.t==='partial'),tvOnly:!events.some(e=>e.t==='act'||e.t==='context')&&calls.length>0&&events.filter(e=>e.t==='state'&&e.state==='thinking').every(e=>e.destination==='tv')};
 writeFileSync('/tmp/garden-tv-pipeline-eval.json',JSON.stringify({method:'Synthetic flite speech -> paced PCM -> real KWS (last sample), VAD, Parakeet, corrections, routing, real model for media -> stub TV actions. Not a room mic/physical screen test.',checks,calls,events,logs},null,2));console.log(checks);assert(Object.values(checks).every(Boolean),'See /tmp/garden-tv-pipeline-eval.json');
}finally{writeFileSync('/tmp/garden-tv-pipeline-debug.json',JSON.stringify({calls,events,logs},null,2));clearTimeout(timer);clearTimeout(tailTimer);ctl.abort();child.kill('SIGTERM');server.closeAllConnections();server.close();}
