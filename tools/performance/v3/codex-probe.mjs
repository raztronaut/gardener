import {spawn}from'node:child_process';import{createInterface}from'node:readline';import{writeFileSync,mkdirSync}from'node:fs';
const tier=process.argv.includes('--standard')?'default':'fast';
const wanted=(process.argv.find(x=>x.startsWith('--models='))?.slice(9)||'gpt-6.1-terra,gpt-6.1-sol').split(',');
const output=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'docs/performance/v4/codex.json';
const child=spawn('codex',['app-server','--stdio'],{stdio:['pipe','pipe','pipe']});let id=0;const pending=new Map();let onEvent=()=>{};
child.stderr.resume();const lines=createInterface({input:child.stdout});
lines.on('line',line=>{try{const msg=JSON.parse(line);if(msg.id!==undefined&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}else if(msg.method)onEvent(msg);}catch{}});
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const seq=++id;pending.set(seq,{resolve,reject});child.stdin.write(JSON.stringify({id:seq,method,params})+'\n');});
const deadline=setTimeout(()=>{console.error('Codex benchmark deadline');child.kill();process.exitCode=1;},300000);
try{
 await rpc('initialize',{clientInfo:{name:'garden_latency_eval',title:'Garden latency eval',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const catalog=await rpc('model/list',{includeHidden:false});const models=catalog.data||[];console.log(JSON.stringify(models.map(m=>({id:m.id,model:m.model,effort:m.supportedReasoningEfforts})),null,2));
 if(process.argv.includes('--bench')){
  mkdirSync('/tmp/garden-model-eval',{recursive:true});const rows=[];
  const chosen=wanted.filter(id=>models.some(m=>m.model===id||m.id===id));
  if(!chosen.length)throw Error('Requested 6.1 models were not listed.');
  const cases=[{name:'action',text:'Return only JSON: {"action":"open","target":"transit"}. Do not call tools.'},{name:'repair',text:'A user says: open weather, actually show transit. Return only JSON containing action=open and target equal to their final intended panel. Do not call tools.'},{name:'explanation',text:'Explain in exactly three short sentences why cached data can make a house display faster, what stale means, and why timestamps matter. Do not call tools.'}];
  for(let rep=0;rep<2;rep++)for(const model of rep?[...chosen].reverse():chosen){
   const boot=performance.now();const thread=await rpc('thread/start',{model,serviceTier:tier,cwd:'/tmp/garden-model-eval',approvalPolicy:'never',sandbox:'read-only',ephemeral:true,baseInstructions:'You are a latency benchmark. Answer the user directly without any tools or external actions.',developerInstructions:'This is an isolated text-only benchmark. No tools.',config:{model_reasoning_effort:'low'}});
   const setupMs=Math.round(performance.now()-boot);
   for(const test of cases){
    const start=performance.now();let first=null,text='',usage=null,toolCalls=0;let complete;const done=new Promise(r=>complete=r);
    onEvent=m=>{if(m.params?.threadId!==thread.thread.id)return;if(m.method==='item/agentMessage/delta'){first??=performance.now();text+=m.params.delta||'';}if(m.method==='thread/tokenUsage/updated')usage=m.params.tokenUsage;if(m.method==='item/started'&&['commandExecution','mcpToolCall','dynamicToolCall'].includes(m.params.item?.type))toolCalls++;if(m.method==='turn/completed')complete(m.params.turn);};
    await rpc('turn/start',{threadId:thread.thread.id,model,serviceTier:tier,effort:'low',input:[{type:'text',text:test.text}]});
    const turn=await done;const row={model,requestedTier:tier,rep,case:test.name,setupMs,firstTextMs:first?Math.round(first-start):null,totalMs:Math.round(performance.now()-start),text,usage,toolCalls,status:turn.status,error:turn.error?.message};
    row.correct=test.name==='explanation'?text.length>30&&toolCalls===0:/"action"\s*:\s*"open"/.test(text)&&/"target"\s*:\s*"transit"/.test(text)&&toolCalls===0;rows.push(row);console.log(model,test.name,row.totalMs,row.status);
    writeFileSync(output,JSON.stringify({at:new Date().toISOString(),method:'Authenticated local Codex app-server; sequential text-only requests; low effort; requested tier in each row; fresh ephemeral thread per model/repetition, alternating model order. Warm turns share their model thread. No household context or tools.',rows},null,2));
   }
  }
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{clearTimeout(deadline);child.kill();lines.close();}
