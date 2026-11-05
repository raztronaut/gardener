import { runAgent } from '../../src/voiceagent.mjs';
import { writeFileSync } from 'node:fs';
const prompts = ['open the weather', 'close the panel', 'start a timer for 2 minutes', 'open hacker news', 'open the weather', 'close the panel'];
const rows = [];
for (const text of prompts) {
  const calls = [], logs = []; const t = performance.now();
  const result = await runAgent(text, { context: async () => ({ dashboard: 'main', open: null, widgets: [{id:'weather',title:'Weather'},{id:'hacker-news',title:'Hacker News'}], commands: [{name:'timer'}, {name:'headlines'}, {name:'mood'}] }), call: async (xs) => { calls.push(...xs); return xs.map(() => ({ok:true})); }, log: (s) => logs.push(s) });
  rows.push({ text, ms: Math.round(performance.now()-t), ok: result.ok, calls, logs });
  console.log(JSON.stringify(rows.at(-1)));
}
const sorted=rows.map(r=>r.ms).sort((a,b)=>a-b);
const out={at:new Date().toISOString(), mode:'typed transcript; stubbed wall transport; real model APIs when needed', medianMs:(sorted[2] + sorted[3]) / 2,rows};
writeFileSync(process.argv[2] || '/tmp/garden-voice-bench.json',JSON.stringify(out,null,2));
