// Independent input watchdog. Read-only normally; at most one guarded page reload
// per hour. It never restarts Chrome, clears storage, or injects mouse/key events.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename,statfs} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {inputDecision,probePage} from './input-health-policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
const folder=root+'data/diagnostics',port=process.env.GARDENER_KIOSK_DEBUG_PORT||'9223';
const voicePort=process.env.GARDENER_VOICE_PORT||'8797';
let rawCount=0,lastRaw=0,mouse=null,stopped=false,state={},lastRecovery=0,lastSample=0;
let history=[],incidents=[],pendingRestore=null,lastTarget=null;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const getJSON=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error('health endpoint unavailable');return r.json();};
async function save(name,data){await mkdir(folder,{recursive:true});await writeFile(folder+'/'+name+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(folder+'/'+name+'.tmp',folder+'/'+name);}
async function resources(){
  const [mem,vm,disk]=await Promise.all([readFile('/proc/meminfo','utf8'),readFile('/proc/vmstat','utf8'),statfs(root)]);
  const field=(s,k)=>Number(s.match(new RegExp('^'+k+':?\\s+(\\d+)','m'))?.[1]||0);
  return {at:Date.now(),availableMB:Math.round(field(mem,'MemAvailable')/1024),swapUsedMB:Math.round((field(mem,'SwapTotal')-field(mem,'SwapFree'))/1024),swapInPages:field(vm,'pswpin'),swapOutPages:field(vm,'pswpout'),oomKills:field(vm,'oom_kill'),diskFreeGB:Math.round(disk.bavail*disk.bsize/1e9),watchdogRSSMB:Math.round(process.memoryUsage().rss/1e6)};
}
async function cdp(tab,method,params={}) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(tab.webSocketDebuggerUrl);
    const finish=(err,value)=>{clearTimeout(timer);try{ws.close();}catch{}err?reject(err):resolve(value);};
    const timer=setTimeout(()=>finish(Error('CDP timeout')),2500);
    ws.onopen=()=>ws.send(JSON.stringify({id:1,method,params}));
    ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id===1)finish(r.error?Error(r.error.message):null,r.result);};
    ws.onerror=()=>finish(Error('CDP disconnected'));
  });
}
async function evaluate(tab,expression){const r=await cdp(tab,'Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Page health unavailable');return r.result?.value;}
async function attachMouse(){
  if(mouse||stopped)return;
  try {
    const {stdout}=await exec('xinput',['list','--id-only',process.env.GARDENER_MOUSE||'Logitech USB Receiver Mouse'],{timeout:2000});
    const id=stdout.trim();if(!/^\d+$/.test(id))return;
    mouse=spawn('stdbuf',['-oL','xinput','test',id],{stdio:['ignore','pipe','ignore']});let buffer='';
    mouse.stdout.on('data',data=>{buffer+=data;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(/^motion |^button press\s+[123]\s*$/.test(line)){rawCount++;lastRaw=Date.now();}});
    const gone=()=>{mouse=null;rawCount=0;state={};};mouse.on('exit',gone);mouse.on('error',gone);
  }catch{/* unplugged or asleep; retry without recovery */}
}
try{const old=JSON.parse(await readFile(folder+'/input-health.json','utf8'));lastRecovery=old.lastRecovery||0;history=(old.samples||[]).slice(-119);incidents=(old.incidents||[]).slice(-19);}catch{}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{stopped=true;mouse?.kill();});
while(!stopped){
  let status='watching',failure=null;
  try {
    await attachMouse();
    const tabs=await getJSON(`http://127.0.0.1:${port}/json/list`);
    const tab=tabs.find(t=>t.type==='page'&&/^http:\/\/(127\.0\.0\.1|localhost):8787\/$/.test(t.url));
    if(!tab)throw Error('Kiosk target unavailable');
    if(lastTarget!==tab.id){state={};lastTarget=tab.id;}
    const page=await evaluate(tab,`(${probePage.toString()})()`);
    if(pendingRestore){
      if(Date.now()>pendingRestore.until)pendingRestore=null;
      else if(page.safe){await evaluate(tab,`window.gardenWall.act({name:'layout',input:{action:'page',page:${pendingRestore.page}}})`);pendingRestore=null;}
    }
    const count=rawCount;rawCount=0;
    if(count>=10){
      const [{stdout},voice,calib]=await Promise.all([exec('python3',[root+'tools/input-window.py'],{timeout:3000}),getJSON(`http://127.0.0.1:${voicePort}/status`),getJSON(`http://127.0.0.1:${voicePort}/calibration`)]);
      state=inputDecision(state,{now:Date.now(),rawCount:count,lastRaw,page,window:JSON.parse(stdout),voiceIdle:voice.state==='idle'&&!calib.active});
      if(state.recover){
        status='confirmed-input-loss';
        if(Date.now()-lastRecovery>=3600000){
          // Recheck page and X guards immediately before the only mutation.
          const again=await evaluate(tab,`(${probePage.toString()})()`);
          const currentWindow=JSON.parse((await exec('python3',[root+'tools/input-window.py'],{timeout:3000})).stdout);
          const [v,c]=await Promise.all([getJSON(`http://127.0.0.1:${voicePort}/status`),getJSON(`http://127.0.0.1:${voicePort}/calibration`)]);
          if(again.safe&&again.lastInput===page.lastInput&&currentWindow.kiosk&&!currentWindow.buttonsDown&&v.state==='idle'&&!c.active){
            lastRecovery=Date.now();incidents.push({at:lastRecovery,reason:status,page:again.page,resources:await resources()});incidents=incidents.slice(-20);
            await save('input-health.json',{lastRecovery,status:'recovering',incidents,samples:history});
            await cdp(tab,'Page.reload');pendingRestore={page:again.page,until:Date.now()+30000};status='reloaded-idle-dashboard';state={};
          }
        }else status='recovery-cooldown';
      }
    }else state={};
  }catch(e){state={};rawCount=0;status='observation-unavailable';failure=e.message;}
  if(Date.now()-lastSample>60000||status==='reloaded-idle-dashboard'){
    try{history.push(await resources());history=history.slice(-120);await save('input-health.json',{lastRecovery,status,failure,mouseConnected:!!mouse,incidents,samples:history});lastSample=Date.now();}catch{/* No destructive fallback on a full disk. */}
  }
  await delay(5000);
}
