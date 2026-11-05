import {writeFileSync} from 'node:fs';
const rows=[];
for(const text of ['open the weather','close the panel','open hacker news','close the panel']) {
 const ctl=new AbortController(); const response=await fetch('http://127.0.0.1:8797/events?observe=1',{signal:ctl.signal});
 let start,thinking,started=false; const done=(async()=>{let pending='';for await(const bytes of response.body){pending+=new TextDecoder().decode(bytes);let end;while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const line=frame.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;const e=JSON.parse(line.slice(6));if(e.t==='state'&&e.state==='thinking'){thinking=performance.now();started=true;}if(e.t==='state'&&e.state==='idle'&&started)return {ok:e.end==='done',totalMs:Math.round(performance.now()-start),agentWallMs:Math.round(performance.now()-thinking)};}}})();
 start=performance.now();await fetch('http://127.0.0.1:8797/say',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
 let timer;const row=await Promise.race([done,new Promise((_,rej)=>timer=setTimeout(()=>rej(Error('timeout')),25000))]);clearTimeout(timer);ctl.abort();rows.push({text,...row});console.log(rows.at(-1));
}
writeFileSync(process.argv[2],JSON.stringify({at:new Date().toISOString(),method:'real /say -> voice service -> kiosk action -> idle SSE; includes fixed 600ms QA delay; no microphone/ASR',rows},null,2));
