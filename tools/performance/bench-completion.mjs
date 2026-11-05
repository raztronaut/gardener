import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const originalFetch=globalThis.fetch;
process.env.GARDENER_BOTANIST_AGENT='benchmark-only';
const results=[];
for(const [label,path] of [['before',`${process.cwd()}/tools/performance/fixtures/botanist-before.txt`],['after',`${process.cwd()}/src/botanist.mjs`]]) {
 let sent=0,requests=0;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).includes('openrouter')) return Response.json({answers:{risk:{choice:'harmless',confidence:1}}});
  requests++;const {params}=JSON.parse(opts.body);let data;
  if(params.name==='send_agent_prompt'){sent=performance.now();data={ok:true};}
  if(params.name==='get_agent_status')data={status:performance.now()-sent<4000?'running':'idle'};
  if(params.name==='get_agent_activity')data={content:`[Assistant]\n${sent?'Benchmark done.':'Old reply.'}`};
  return Response.json({result:{structuredContent:data}});
 };
 let src=readFileSync(path,'utf8').replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${pathToFileURL(`${process.cwd()}/src/${p.slice(2)}`)}'`);
 const {botanist}=await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
 let done;const completed=new Promise(r=>done=r);
 await botanist({task:'Calculate 2 plus 2'}, {notify:ev=>{if(ev.kind==='done')done(ev);}});
 await completed;
 results.push({label,simulatedWorkMs:4000,reportedMs:Math.round(performance.now()-sent),requests});
}
globalThis.fetch=originalFetch;
writeFileSync('/tmp/garden-completion-bench.json',JSON.stringify(results,null,2));console.log(results);
