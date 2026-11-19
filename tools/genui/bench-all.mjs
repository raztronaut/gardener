// Sequential runner avoids overlapping benchmark workloads on the shared Jetson.
import {spawnSync} from 'node:child_process';
for(const file of ['tools/genui/test-stream.mjs','tools/genui/bench-actions.mjs','tools/genui/bench-local-mcp.mjs','tools/genui/bench-runtime.cjs','tools/genui/bench-publish-mcp.mjs','tools/genui/bench-correctness.mjs','tools/genui/bench-publish-live-model.mjs']){
 const result=spawnSync(process.execPath,[file],{stdio:'inherit',env:{...process.env,GARDENER_BENCH_A2UI:'1'}});
 if(result.status!==0)process.exit(result.status||1);
}
