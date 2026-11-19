import {readFileSync,writeFileSync} from 'node:fs';
const d=JSON.parse(readFileSync('docs/performance/v6/paseo.json','utf8'));
const metrics=['get_agent_status','get_agent_activity'].map(method=>{
 const values=d.rows.filter(r=>r.method===method&&r.ok).map(r=>r.ms),v=[...values].sort((a,b)=>a-b),n=v.length;
 return {id:method,label:method==='get_agent_status'?'Agent status request':'Agent activity request',unit:'ms',median:n?Math.round((n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2)*100)/100:null,p95:n?v[Math.ceil(n*.95)-1]:null,samples:n,warmth:'active local daemon; serial calls',values};
});
const suite={id:'paseo-mcp',title:'Talk to Paseo locally',description:'Read the existing coding agent’s status and activity without launching its CLI.',measuredAt:d.at,method:d.method,limits:'This measures local daemon HTTP/tool latency, not model inference, task completion, event delivery or polling delay.',metrics,checks:{passed:d.rows.filter(r=>r.ok).length,total:d.rows.length}};
for(const path of ['docs/performance/v6/benchmarks.json','public/genui/benchmarks.json']){const report=JSON.parse(readFileSync(path));report.suites=report.suites.filter(s=>s.id!==suite.id);report.suites.push(suite);report.generatedAt=new Date().toISOString();writeFileSync(path,JSON.stringify(report,null,2));}
console.log(metrics);
