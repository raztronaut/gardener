// Isolated deterministic UI benchmarks. No production mic, speaker or device actions.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/tmp/garden-browser-qa/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const zlib=require('node:zlib');const crypto=require('node:crypto');const os=require('node:os');
const base=process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787';
const browserPath=process.env.GARDENER_TEST_BROWSER||'/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome';
const raw={version:1,at:new Date().toISOString(),method:'Sequential fixtures in isolated 900×1600 Chromium; software rendering; eight-second startup/font warmup. No microphone capture, model inference or production device actions.',samples:{},checks:{}};
const suites=[];
function metric(id,label,unit,values,warmth,extra={}){assert(values.length&&values.every(Number.isFinite),id);const s=[...values].sort((a,b)=>a-b);return{id,label,unit,median:Math.round((s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2)*100)/100,p95:Math.round(s[Math.ceil(s.length*.95)-1]*100)/100,samples:s.length,warmth,values:values.map(x=>Math.round(x*100)/100),...extra};}
const forecast=(()=>{const days=Array.from({length:4},(_,i)=>new Date(Date.now()+i*86400000).toISOString().slice(0,10));return{current:{temperature_2m:61,apparent_temperature:60,relative_humidity_2m:65,weather_code:1,is_day:1},hourly:{time:days.flatMap(d=>Array.from({length:24},(_,i)=>d+'T'+String(i).padStart(2,'0')+':00')),temperature_2m:Array(96).fill(61),weather_code:Array(96).fill(1),is_day:Array(96).fill(1),precipitation_probability:Array(96).fill(0),uv_index:Array(96).fill(2)},daily:{time:days,temperature_2m_max:Array(4).fill(66),temperature_2m_min:Array(4).fill(49),weather_code:Array(4).fill(1),sunrise:days.map(d=>d+'T06:45'),sunset:days.map(d=>d+'T17:08'),precipitation_probability_max:Array(4).fill(0)}}})();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({executablePath:browserPath,args:['--no-sandbox','--disable-gpu','--disable-webgl']});
 try{
 const context=await browser.newContext({viewport:{width:900,height:1600}});const page=await context.newPage();const errors=[];let forecastRequests=0;
 page.on('pageerror',e=>errors.push(e.message));await page.route('**:8797/**',r=>r.abort());await page.route('**/api/pad/stream',r=>r.abort());
 await page.route('**/api/state',async r=>{const d=await(await r.fetch()).json();await r.fulfill({json:{...d,night:false,snoozeUntil:0}});});
 await page.route('**/api/proxy?**',async r=>{if(!decodeURIComponent(r.request().url()).includes('api.open-meteo.com/v1/forecast'))return r.continue();forecastRequests++;await delay(80);await r.fulfill({json:forecast});});
 await page.route('**/api/transit',async r=>{await delay(160);await r.fulfill({json:{at:Date.now(),stale:false,arrivals:[{route:'7',destination:'Downtown',time:Date.now()+8*60000,distance:150,realtime:true}],vehicles:[],routeVehicles:[],stops:[]}});});
 await page.route('**/api/reading-summary*',async r=>{await delay(240);const day=new Date().toISOString().slice(0,10);await r.fulfill({json:{today:day,edition:{day,intro:'A synthetic benchmark news summary. No household news is recorded.'},editions:[]}});});
 await page.goto(base+'/?theme=classic&screenshot=1&bar=1');await page.waitForFunction(()=>window.gardenWall?.context().layout);await page.evaluate(()=>document.body.classList.add('qa-open'));await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(8000);
 raw.browser=await browser.version();
 const native=await page.evaluate(async()=>{
  const act=input=>window.gardenWall.act({name:'surface',input}),rows=[];
  await act({id:'benchmark-native',operation:'create',revision:1,title:'Benchmark fixture',blocks:[{id:'button',type:'actions',actions:[{target:'weather',label:'Weather'}]},{id:'metric',type:'metric',value:'1'}]});
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const button=document.querySelector('.gs-actions button');button.focus();
  for(let i=2;i<=31;i++){const start=performance.now(),r=await act({id:'benchmark-native',operation:'update',revision:i,blocks:[{id:'button',type:'actions',actions:[{target:'weather',label:'Weather'}]},{id:'metric',type:'metric',value:String(i)}]});const domMs=performance.now()-start;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));rows.push({domMs,frameMs:performance.now()-start,ok:r.ok});}
  return{rows,focusStable:document.activeElement===button,closedRejected:await (async()=>{await window.gardenWall.act({name:'close',input:{}});return!(await act({id:'benchmark-native',operation:'update',revision:32,blocks:[]})).ok})()};
 });assert(native.focusStable&&native.closedRejected&&native.rows.every(r=>r.ok),JSON.stringify(native));raw.samples.native=native;
 suites.push({id:'native-patches',title:'Instant native UI updates',description:'How quickly an already-open Garden surface accepts a new reading.',method:'30 sequential keyed metric patches after warmup; focus remains on an unchanged button.',limits:'DOM and two animation-frame callbacks. This does not measure physical screen presentation or model latency.',metrics:[metric('native-dom','DOM update','ms',native.rows.map(r=>r.domMs),'warm'),metric('native-frame','Update through two frames','ms',native.rows.map(r=>r.frameMs),'warm')],checks:{passed:3,total:3}});
 const briefing=await page.evaluate(async()=>{
  const rows=[];for(let i=0;i<10;i++){
   const start=performance.now();await window.gardenWall.act({name:'command',input:{name:'briefing'}});const shellMs=performance.now()-start;
   let firstDataMs=null;while(!document.querySelector('.gs-status')?.textContent.startsWith('Ready')){
    const text=[...document.querySelectorAll('.gs-block')].filter(e=>e.dataset.kind!=='actions').map(e=>e.textContent).join('');
    if(firstDataMs===null&&(/61°F|7 →/.test(text)))firstDataMs=performance.now()-start;
    if(performance.now()-start>5000)throw Error('Briefing fixture timeout');await new Promise(r=>setTimeout(r,4));
   }
   rows.push({shellMs,firstDataMs:firstDataMs??performance.now()-start,readyMs:performance.now()-start,blocks:document.querySelectorAll('.gs-block').length});
   await window.gardenWall.act({name:'close',input:{}});
  }return rows;
 });assert(briefing.every(r=>r.blocks===4));raw.samples.briefing=briefing;
 suites.push({id:'briefing',title:'A briefing takes shape',description:'The shell appears first; weather, rides and news fill independently.',method:'10 full briefings with deterministic sources: forecast 80 ms, transit 160 ms, news 240 ms. Warm weather cache after wall startup.',limits:'Controlled provider fixtures isolate rendering/orchestration. Real internet, model and microphone delays vary.',metrics:[metric('briefing-shell','First shell','ms',briefing.map(r=>r.shellMs),'warm'),metric('briefing-first-data','First useful reading','ms',briefing.map(r=>r.firstDataMs),'warm'),metric('briefing-ready','All sources ready','ms',briefing.map(r=>r.readyMs),'controlled 240 ms slowest source')],checks:{passed:1,total:1}});
 const before=forecastRequests;
 const cache=await page.evaluate(async()=>{
  const m=await import('/lib/weather-data.js');const config={lat:38.1,lon:-123.1,tz:'UTC'};let t=performance.now();await m.fetchForecast(config);const coldMs=performance.now()-t;const warm=[];
  for(let i=0;i<30;i++){t=performance.now();await m.fetchForecast(config);warm.push(performance.now()-t);}
  const other={...config,lat:38.2};t=performance.now();const shared=await Promise.all(Array.from({length:12},()=>m.fetchForecast(other)));const singleFlightMs=performance.now()-t;
  const persisted=[];for(let i=0;i<20;i++){const fresh=await import('/lib/weather-data.js?cache-benchmark='+i);t=performance.now();const v=await fresh.fetchForecast(other);if(v.data.current.temperature_2m!==61)throw Error('Incorrect cached forecast');persisted.push(performance.now()-t);}
  return{coldMs,warm,persisted,singleFlightMs,sharedSameObject:shared.every(x=>x===shared[0])};
 });const requests=forecastRequests-before;assert.equal(requests,2);assert(cache.sharedSameObject);raw.samples.weather={...cache,networkRequests:requests};
 suites.push({id:'weather-cache',title:'Weather without waiting again',description:'Memory, persistent browser cache and concurrent requests reuse the same forecast.',method:'One controlled 80 ms cold request, 30 memory hits, 20 fresh-module persisted-cache reads, and 12 simultaneous calls for one new location.',limits:'Cache timings exclude module import/download. The single cold sample is a demonstration, not a distribution.',metrics:[metric('weather-cold','Controlled cold fetch','ms',[cache.coldMs],'one controlled cold sample'),metric('weather-memory','Memory cache','ms',cache.warm,'warm memory'),metric('weather-persisted','Saved cache','ms',cache.persisted,'fresh module; saved data'),metric('weather-single-flight','12 calls, one request','ms',[cache.singleFlightMs],'one concurrent fixture')],checks:{passed:3,total:3}});
 // Official A2UI cases use the same isolated page and clock as native fixtures.
 if(process.env.GARDENER_BENCH_A2UI==='1')await benchmarkA2ui(page,raw,suites,metric,base,browser);
 if(fs.existsSync('docs/performance/v6/actions-raw.json')){const actions=JSON.parse(fs.readFileSync('docs/performance/v6/actions-raw.json'));suites.push({id:'actions',title:'Controls without a model round trip',description:'Typed generated actions resolve to the same Garden operations as voice and clicks.',method:actions.method,limits:'Resolver-only CPU time. No speaker, timer, power or device action was actually executed.',metrics:[actions.metric],checks:actions.checks});raw.actions=actions;}
 assert.deepEqual(errors,[]);raw.errors=errors;
 const paths=['public/genui/a2ui-runtime.js','public/lib/live-surface.js','public/lib/garden-actions.js'];const assets=paths.filter(p=>fs.existsSync(p)).map(path=>{const data=fs.readFileSync(path);return{path,bytes:data.length,gzipBytes:zlib.gzipSync(data).length,sha256:crypto.createHash('sha256').update(data).digest('hex')}});raw.assets=assets;
 let hardware='Garden Jetson';try{hardware=fs.readFileSync('/proc/device-tree/model','utf8').replaceAll('\0','').trim()}catch{}
 for(const suite of suites)suite.measuredAt=raw.at;
 const out={version:1,generatedAt:new Date().toISOString(),environment:{device:'Garden Jetson / Ubuntu',hardware,architecture:process.arch,kernel:os.release(),cpuCount:os.cpus().length,browser:raw.browser,notes:raw.method},suites,assets};
 fs.mkdirSync('docs/performance/v6',{recursive:true});fs.writeFileSync('docs/performance/v6/runtime-raw.json',JSON.stringify(raw,null,2));fs.writeFileSync('docs/performance/v6/benchmarks.json',JSON.stringify(out,null,2));fs.writeFileSync('public/genui/benchmarks.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
async function benchmarkA2ui(page,raw,suites,metric,base,browser){
 const result=await page.evaluate(async()=>{
  const nodes=root=>[...root.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?nodes(e.shadowRoot):[])]);
  const find=selector=>nodes(document.querySelector('.ga-body')||document).find(e=>e.matches(selector));
  const wait=async test=>{const started=performance.now();while(!test()){if(performance.now()-started>8000)throw Error('A2UI paint timeout');await new Promise(r=>setTimeout(r,2));}};
  const act=messages=>window.gardenWall.act({name:'a2ui',input:{title:'Benchmark fixture',messages}});
  const msg=(kind,body)=>({version:'v0.9',[kind]:body});
  const create=id=>[msg('createSurface',{surfaceId:id,catalogId:'https://garden.local/catalogs/house-v1.json'}),msg('updateDataModel',{surfaceId:id,path:'/',value:{count:'1',destination:'Garden'}}),msg('updateComponents',{surfaceId:id,components:[
   {id:'root',component:'Column',children:['metric','field','button']},
   {id:'metric',component:'GardenMetric',label:'Readings',value:{path:'/count'},detail:'Controlled fixture'},
   {id:'field',component:'TextField',label:'Destination',value:{path:'/destination'}},
   {id:'button-text',component:'Text',text:'Explore weather'},
   {id:'button',component:'Button',child:'button-text',action:{event:{name:'garden.open',context:{target:'weather'}}}}
  ]})];
  const hadRuntime=performance.getEntriesByType('resource').some(e=>e.name.includes('a2ui-runtime.js'));
  const coldStart=performance.now();const r=await act(create('benchmark-a2ui-first'));if(!r.ok)throw Error(r.error);const coldReturn=performance.now()-coldStart;await wait(()=>find('.ga-metric strong')?.textContent==='1');const coldPaint=performance.now()-coldStart;
  const warm=[];for(let i=0;i<10;i++){
   const start=performance.now(),r=await act(create('benchmark-a2ui-warm-'+i));if(!r.ok)throw Error(r.error);const domMs=performance.now()-start;await wait(()=>find('.ga-metric strong')?.textContent==='1');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));warm.push({domMs,frameMs:performance.now()-start});
  }
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const field=find('input');if(!field)throw Error('A2UI input not rendered');field.focus();field.value='Typed destination';field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
  const patches=[];for(let i=2;i<=31;i++){
   const start=performance.now(),r=await act([msg('updateDataModel',{surfaceId:'benchmark-a2ui-warm-9',path:'/count',value:String(i)})]);if(!r.ok)throw Error(r.error);const domMs=performance.now()-start;await wait(()=>find('.ga-metric strong')?.textContent===String(i));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));patches.push({domMs,frameMs:performance.now()-start});
  }
  const fieldAfter=find('input'),focusStable=fieldAfter===field&&field.getRootNode().activeElement===field,inputStable=fieldAfter.value==='Typed destination';
  const beforeReject=find('.ga-metric strong')?.textContent;
  const bad=await act([msg('updateComponents',{surfaceId:'benchmark-a2ui-warm-9',components:[{id:'evil',component:'Button',child:'button-text',action:{event:{name:'shell.execute',context:{}}}}]})]);
  const invalidRejected=!bad.ok&&find('.ga-metric strong')?.textContent===beforeReject;
  const button=find('button');if(!button)throw Error('A2UI button not rendered');button.click();await wait(()=>!document.querySelector('.garden-a2ui'));
  const actionWorked=document.getElementById('panelTitle')?.textContent.toLowerCase().includes('weather');
  const closed=await act([msg('updateDataModel',{surfaceId:'benchmark-a2ui-warm-9',path:'/count',value:'obsolete'})]);
  return{hadRuntime,coldReturn,coldPaint,warm,patches,checks:{focusStable,inputStable,invalidRejected,actionWorked,closedRejected:!closed.ok}};
 });assert(Object.values(result.checks).every(Boolean),JSON.stringify(result));raw.samples.a2ui=result;
 suites.push({id:'a2ui',title:'A2UI: real streaming components',description:'Official A2UI/Lit runtime, typed input and keyed data bindings.',method:'One first-runtime request, 10 warmed surface creations, 30 sequential bound-data patches. An unchanged typed input retains focus and value; a real generated button opens Weather in the isolated page.',limits:'First-runtime sample includes local bundle download/parse, not an internet CDN. One cold sample is not a cold-start distribution. Frame callbacks do not measure physical screen latency.',metrics:[metric('a2ui-first','First runtime + useful content','ms',[result.coldPaint],result.hadRuntime?'runtime already loaded':'one first-runtime sample'),metric('a2ui-warm','Warm surface through two frames','ms',result.warm.map(r=>r.frameMs),'warm runtime'),metric('a2ui-patch-dom','Data patch accepted','ms',result.patches.map(r=>r.domMs),'warm runtime'),metric('a2ui-patch-frame','Data patch through two frames','ms',result.patches.map(r=>r.frameMs),'warm runtime')],checks:{passed:Object.values(result.checks).filter(Boolean).length,total:Object.keys(result.checks).length}});
}
