// Correctness-only suites deliberately have no timing metric.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const specifications=[
 {id:'stream-framing',file:'tools/genui/test-stream.mjs',log:'docs/performance/v6/stream-tests.tap',title:'JSON that arrives in pieces',description:'Only complete, correctly framed A2UI messages are delivered.',method:'Node regression tests across every chunk width, UTF-8 and surrogate splits, misleading quoted/nested keys, invalid grammar and bounded byte/count/depth limits.',limits:'Parser correctness only. No model, rendering or physical display latency is measured.'},
 {id:'voice-stream-correctness',file:'tools/genui/voice-stream.test.mjs',log:'docs/performance/v6/voice-stream-tests.tap',title:'Voice generation without obsolete updates',description:'Streamed UI stays ordered, waits for routing, and respects cancellation.',method:'Actual voice stream orchestration and SDK SSE handling exercised with synthetic tool JSON and mocked provider fetch. Tests incremental paint before completion, serial dispatch, router gate, cancellation, failure, deduplication and malformed-tail retirement.',limits:'No household audio, live model request or device action. These pass/fail cases do not measure recognition accuracy or voice-response latency.'},
];
const suites=[];let failed=false;
for(const spec of specifications){
 const result=spawnSync(process.execPath,['--test',spec.file],{encoding:'utf8'}),output=(result.stdout||'')+(result.stderr||'');writeFileSync(spec.log,output);
 const total=Number(output.match(/^# tests (\d+)/m)?.[1]||0),passed=Number(output.match(/^# pass (\d+)/m)?.[1]||0);
 suites.push({id:spec.id,title:spec.title,description:spec.description,method:spec.method,limits:spec.limits,measuredAt:new Date().toISOString(),metrics:[],checks:{passed,total},notes:['Pass/fail regression checks. No timing claim.']});
 console.log(spec.id,passed+'/'+total,result.status===0?'passed':'FAILED');if(result.status!==0||!total)failed=true;
}
for(const path of ['docs/performance/v6/benchmarks.json','public/genui/benchmarks.json']){const d=JSON.parse(readFileSync(path));d.suites=d.suites.filter(s=>!suites.some(x=>x.id===s.id));d.suites.push(...suites);writeFileSync(path,JSON.stringify(d,null,2));}
if(failed)process.exitCode=1;
