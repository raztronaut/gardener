import {readFileSync,writeFileSync}from'node:fs';
const agentId=JSON.parse(readFileSync('data/voice/botanist.json','utf8')).agentId;
const rows=[];
for(let i=0;i<20;i++) {
 const name=i%4===0?'get_agent_activity':'get_agent_status';const start=performance.now();
 const r=await fetch('http://127.0.0.1:6767/mcp/agents',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name,arguments:{agentId,...(name==='get_agent_activity'?{limit:3}:{})}}}),signal:AbortSignal.timeout(8000)});
 const t=await r.text();rows.push({method:name,ms:Math.round((performance.now()-start)*100)/100,ok:r.ok&&!/"isError":true/.test(t)});
}
writeFileSync('/tmp/garden-v2-paseo.json',JSON.stringify({at:new Date().toISOString(),method:'real local MCP read-only status/activity calls; no agents spawned or prompted',rows},null,2));console.log(rows);
