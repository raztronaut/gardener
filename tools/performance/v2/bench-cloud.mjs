import {readFileSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
const beforePath=process.argv[2]||new URL('./voiceagent-before.txt',import.meta.url);
const source=readFileSync(beforePath,'utf8').replace("import { directAction, isLayoutRequest } from './voice-fast.mjs';", "import * as fast from './voice-fast.mjs'; const {directAction}=fast; const isLayoutRequest=fast.isLayoutRequest || (()=>false);").replace("'@anthropic-ai/sdk'", JSON.stringify(import.meta.resolve('@anthropic-ai/sdk'))).replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${pathToFileURL(`${process.cwd()}/src/${p.slice(2)}`)}'`);
const before=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`),after=await import('../../../src/voiceagent.mjs');
const cases=[
 ['Could you bring up the weather panel?','open'],['Please show me the latest Hacker News','news'],['Could you set a countdown of ninety seconds?','timer'],['Could you switch back to the main GardenOS wall?','home'],['What is seventeen times twenty three?','math'],['How do I cancel a timer without cancelling my voice message?','explain'],
];
const snapshot={dashboard:'main',open:null,widgets:[{id:'weather',title:'Weather',text:'62°F, clear'},{id:'hacker-news',title:'Hacker News'}],commands:[{name:'timer'},{name:'hn'},{name:'rss'}]};
const rows=[];
for(let repetition=0;repetition<2;repetition++)for(const [text,kind]of cases)for(const label of (repetition%2?['after','before']:['before','after'])){
 const mod=label==='before'?before:after,calls=[],logs=[];const start=performance.now();let out;
 try{out=await mod.runAgent(text,{context:async()=>snapshot,call:async xs=>{calls.push(...xs);return xs.map(()=>({ok:true}));},log:s=>logs.push(s),signal:AbortSignal.timeout(18000)});}catch(e){out={ok:false,error:e.name};}
 let correct=out.ok;
 if(kind==='open')correct&&=calls.some(c=>c.name==='open'&&c.input.target==='weather');
 if(kind==='news')correct&&=calls.some(c=>c.name==='open'&&/hn|news/i.test(c.input.target)||c.name==='command'&&/hn|news/i.test(c.input.name));
 if(kind==='timer')correct&&=calls.some(c=>c.name==='command'&&c.input.name==='timer'&&['90s','1:30','1.5'].includes(String(c.input.arg)));
 if(kind==='home')correct&&=calls.some(c=>c.name==='dashboard'&&c.input.id==='main');
 if(kind==='math')correct&&=calls.length===0&&/391/.test(out.reply||'');
 if(kind==='explain')correct&&=calls.length===0;
 rows.push({label,repetition,text,ms:Math.round(performance.now()-start),ok:out.ok,correct,calls,logs});console.log(label,kind,rows.at(-1).ms,correct?'pass':'FAIL');
}
writeFileSync('/tmp/garden-v2-cloud.json',JSON.stringify({at:new Date().toISOString(),method:'interleaved real model APIs, stubbed wall actions; small convenience sample; before/after share local imported helpers',rows},null,2));
