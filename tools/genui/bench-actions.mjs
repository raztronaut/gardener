import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {ACTION_CATALOG,resolveGardenAction} from '../../public/lib/garden-actions.js';
const cases=[
 ['garden.open',{target:'weather'},{name:'open',input:{target:'weather'}}],
 ['garden.close',{}, {name:'close',input:{}}],
 ['garden.home',{}, {name:'dashboard',input:{id:'main'}}],
 ['garden.volume',{set:40},{name:'volume',input:{set:40}}],
 ['garden.layout',{action:'resize',widget:'weather',size:'wide'},{name:'layout',input:{action:'resize',widget:'weather',size:'wide'}}],
 ['garden.theme',{theme:'classic'},{name:'command',input:{name:'theme',arg:'classic'}}],
 ['garden.timer',{duration:'2'},{name:'command',input:{name:'timer',arg:'2'}}],
 ['garden.ambience',{place:'off'},{name:'command',input:{name:'rainforest',arg:'off'}}],
 ['garden.directions',{destination:'Ferry Building'},{name:'command',input:{name:'transit',arg:'Ferry Building'}}],
 ['garden.feeds',{query:'add TechCrunch'},{name:'command',input:{name:'rss',arg:'add TechCrunch'}}],
 ['garden.briefing',{sections:'weather departures'},{name:'command',input:{name:'briefing',arg:'weather departures'}}],
 ['garden.pin',{}, {name:'command',input:{name:'pin',arg:''}}],
 ['garden.demo',{flow:'controls'},{name:'command',input:{name:'genui',arg:'controls'}}],
];
let passed=0;for(const[name,input,want]of cases){assert.deepEqual(resolveGardenAction(name,input),want);passed++;}
for(const[name,input]of [['shell.execute',{}],['garden.volume',{set:101}],['garden.theme',{theme:'invented'}],['garden.layout',{action:'execute'}],['garden.directions',{destination:''}],['garden.ambience',{place:'invented'}]]){assert.throws(()=>resolveGardenAction(name,input));passed++;}
const rows=[];for(let batch=0;batch<30;batch++){const start=performance.now();for(let i=0;i<1000;i++){const[name,input]=cases[i%cases.length];resolveGardenAction(name,input);}rows.push((performance.now()-start)*1000/1000);}
const values=[...rows].sort((a,b)=>a-b),median=(values[14]+values[15])/2,p95=values[28];
const result={at:new Date().toISOString(),method:'30 sequential batches of 1,000 action resolutions, cycling 13 real action types. No action sinks executed. Times are batch-amortized microseconds/call.',rows,checks:{passed,total:cases.length+6},catalogActions:Object.keys(ACTION_CATALOG).length,metric:{id:'action-resolve',label:'Resolve a Garden control',unit:'µs',median:Math.round(median*100)/100,p95:Math.round(p95*100)/100,samples:30,warmth:'warm JS; 1,000 calls per sample',values:rows.map(x=>Math.round(x*100)/100)}};
writeFileSync('docs/performance/v6/actions-raw.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
