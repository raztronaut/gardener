// Read-only local Paseo status/activity benchmark. Never prompts or mutates an agent.
import {readFileSync,writeFileSync} from 'node:fs';
const agentId=JSON.parse(readFileSync('data/voice/botanist.json','utf8')).agentId;
const rows=[];
for(let i=0;i<20;i++){
 const method=i%4===0?'get_agent_activity':'get_agent_status',start=performance.now();
 try{
  const response=await fetch('http://127.0.0.1:6767/mcp/agents',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name:method,arguments:{agentId,...(method==='get_agent_activity'?{limit:3}:{})}}}),signal:AbortSignal.timeout(8000)});
  const body=await response.text();rows.push({method,ms:Math.round((performance.now()-start)*100)/100,ok:response.ok&&!/"isError":true/.test(body)});
 }catch{rows.push({method,ms:Math.round((performance.now()-start)*100)/100,ok:false});}
}
const data={at:new Date().toISOString(),method:'20 sequential real local MCP read-only status/activity calls; no agents spawned or prompted; no returned household content stored.',rows};
writeFileSync('docs/performance/v6/paseo.json',JSON.stringify(data,null,2));console.log('Read-only local MCP calls:',rows.filter(r=>r.ok).length,'/',rows.length);
