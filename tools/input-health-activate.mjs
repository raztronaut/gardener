// One-shot activation: preserve a current game/panel/draft and reload only after
// the main wall has been idle for 15 seconds. Run locally, never on a timer.
import {probePage} from '../src/input-health-policy.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const file=root+'data/diagnostics/input-fix-activation.json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function record(data){await mkdir(root+'data/diagnostics',{recursive:true});await writeFile(file,JSON.stringify({at:new Date().toISOString(),...data},null,2)+'\n',{mode:0o600});}
async function evalPage(tab,expression){
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(tab.webSocketDebuggerUrl),timer=setTimeout(()=>{ws.close();reject(Error('Page unavailable'));},3000);
  ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
  ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id!==1)return;clearTimeout(timer);ws.close();r.error||r.result?.exceptionDetails?reject(Error('Page evaluation failed')):resolve(r.result?.result?.value);};
  ws.onerror=()=>{clearTimeout(timer);ws.close();reject(Error('Kiosk disconnected'));};
 });
}
const get=async url=>(await fetch(url,{signal:AbortSignal.timeout(2500)})).json();
await record({status:'waiting-for-idle-wall'});
const deadline=Date.now()+55*60000;let consecutive=0,version=null,previousPage=1;
while(Date.now()<deadline){
 try{
  const tabs=await get('http://127.0.0.1:9223/json/list'),tab=tabs.find(t=>t.type==='page'&&t.url==='http://127.0.0.1:8787/');
  if(!tab)throw Error('No kiosk');
  const page=await evalPage(tab,`(${probePage.toString()})()`);
  if(version){
   const loaded=await evalPage(tab,'window.__GARDEN_BOOT_VERSION');
   if(loaded===version){
    if(page.safe)await evalPage(tab,`window.gardenWall.act({name:'layout',input:{action:'page',page:${previousPage}}})`);
    await record({status:'active',version,pageRestored:page.safe?previousPage:null});process.exit(0);
   }
  }else{
   const [voice,calib]=await Promise.all([get('http://127.0.0.1:8797/status'),get('http://127.0.0.1:8797/calibration')]);
   const safe=page.safe&&!page.fresh&&Date.now()-page.lastInput>15000&&voice.state==='idle'&&!calib.active;
   consecutive=safe?consecutive+1:0;
   if(consecutive>=2){
    previousPage=page.page;
    const {bumpUiVersion}=await import('../src/db.mjs');version=bumpUiVersion();
    await record({status:'activating',version,previousPage});
   }
  }
 }catch{consecutive=0;}
 await sleep(5000);
}
await record({status:'deferred-timeout',version});process.exitCode=1;
