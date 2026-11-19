// Isolated Chromium profile, cached transit fixtures, no production actions.
const {chromium}=require('/tmp/garden-browser-qa/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base='http://127.0.0.1:8787';
 const fixtures={};for(const path of ['/api/transit','/api/transit/catalog','/api/transit/routes'])fixtures[path]=await (await fetch(base+path,{signal:AbortSignal.timeout(30000)})).json();
 const b=await chromium.launch({executablePath:'/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome',args:['--no-sandbox','--disable-gpu','--disable-webgl']});
 try{
  const p=await b.newPage({viewport:{width:900,height:1600}}),errors=[];p.on('pageerror',e=>errors.push(e.message));let slow=false,requests=0;
  await p.route('**/__input-test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="classic"><body></body></html>'}));
  await p.route('**/api/**',async r=>{requests++;if(slow)await new Promise(res=>setTimeout(res,100));const path=new URL(r.request().url()).pathname;await r.fulfill({json:fixtures[path]||{items:[],feeds:[]}}).catch(()=>{});});
  await p.goto(base+'/__input-test');
  await p.evaluate(async()=>{
   const realSet=window.setInterval,realClear=window.clearInterval;window.intervals=new Set();window.setInterval=(...args)=>{const id=realSet(...args);intervals.add(id);return id;};window.clearInterval=id=>{intervals.delete(id);realClear(id);};
   window.makeScope=(await import('/lib/widget-scope.js')).createWidgetScope;window.transit=(await import('/widgets/transit.js')).default;
   window.h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2).toLowerCase(),v);else if(v!==null&&v!==false)e.setAttribute(k,v);}for(const kid of kids.flat())if(kid!=null)e.append(kid);return e;};
   window.openTest=()=>{const body=document.createElement('div');document.body.append(body);const scope=makeScope(e=>{throw e});const promise=transit.openFull(body,{h,...scope,style:()=>{},_stop:scope.stop});return {body,scope,promise};};
  });
  const session=await p.context().newCDPSession(p);
  const cycle=()=>p.evaluate(async()=>{const t=performance.now(),m=openTest();const dispose=await m.promise;m.scope.stop();dispose?.();m.body.remove();return performance.now()-t;});
  for(let i=0;i<3;i++)await cycle();await session.send('HeapProfiler.collectGarbage');const baseline=await session.send('Runtime.getHeapUsage');
  const durations=[];for(let i=0;i<20;i++)durations.push(await cycle());
  await session.send('HeapProfiler.collectGarbage');const after=await session.send('Runtime.getHeapUsage');
  assert.equal(await p.evaluate(()=>intervals.size),0);
  slow=true;
  for(let i=0;i<20;i++)await p.evaluate(async()=>{const m=openTest();m.scope.stop();m.body.remove();const dispose=await m.promise;dispose?.();});
  await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>intervals.size),0);slow=false;
  const map=await p.evaluate(async()=>{
   const {transitMap}=await import('/lib/transit-map.js');const container=document.createElement('div');container.style.width='740px';document.body.append(container);
   const args={container,data:{origin:{lat:37.76,lon:-122.46},stops:[],vehicles:[]},shapes:{routes:[]},onRoute:()=>{},onVehicle:()=>{}};
   args.onCamera=c=>{args.camera=c;transitMap(args);};transitMap(args);let maxTiles=0;
   for(let i=0;i<40;i++){container.querySelector('[aria-label="Zoom out"]').click();maxTiles=Math.max(maxTiles,container.querySelectorAll('img').length);}
   window.mapTest={container,args,transitMap};return {maxTiles,bounds:args.camera};
  });assert(map.maxTiles<=80,JSON.stringify(map));assert(map.bounds.every(Number.isFinite));
  await p.mouse.move(100,100);await p.mouse.down();
  const capture=await p.evaluate(()=>{const old=mapTest.container.firstElementChild;const before=old.hasPointerCapture(1);mapTest.transitMap(mapTest.args);return {before,after:old.hasPointerCapture(1)};});await p.mouse.up();assert(capture.before);assert(!capture.after);
  await p.evaluate(()=>mapTest.container.remove());
  const rss=await p.evaluate(async()=>{const mod=await import('/lib/feed-reader.js');const ctl=new AbortController();const host=document.createElement('div');document.body.append(host);const root=mod.openFeeds({h,signal:ctl.signal,openPanel:(_,r)=>host.replaceChildren(r),openReader:()=>{}});ctl.abort();host.remove();await new Promise(r=>setTimeout(r,150));return {disposed:typeof root.dispose==='function',aborted:ctl.signal.aborted};});assert(rss.disposed&&rss.aborted);
  assert.equal(errors.length,0,errors.join('\n'));
  durations.sort((a,b)=>a-b);const report={at:new Date().toISOString(),method:'Isolated headless Chromium; cached real transit responses, 3 warmups, 20 completed and 20 interrupted opens; not physical-display latency',completedCycles:20,interruptedCycles:20,openCloseMs:{median:Math.round(durations[10]),p95:Math.round(durations[18])},jsHeapBefore:baseline.usedSize,jsHeapAfter:after.usedSize,jsHeapGrowthBytes:after.usedSize-baseline.usedSize,activeIntervalsAfterClose:await p.evaluate(()=>intervals.size),map,capture,errors,requests};
  fs.mkdirSync('docs/performance/input-health',{recursive:true});fs.writeFileSync('docs/performance/input-health/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
