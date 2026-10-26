#!/usr/bin/env node
// Compare eval.mjs result files.
//   node tools/sb2/ai-eval/report.mjs a.json [b.json ...] [--mode cpu4|human3] [--stages]
// Without --stages: one column per (file, layout) for the chosen mode (default: both modes
// summed). With --stages: key metrics per stage, original vs tall, for each file.
import fs from 'node:fs';
import { derive, table, zero } from './eval.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const files = a.filter((x, i) => x.endsWith('.json') && a[i - 1] !== '--mode');
const mode = opt('--mode', null);
const R = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const sum = (accs) => { const z = zero(); for (const x of accs) for (const k in x) z[k] += x[k]; return z; };
const pick = (r, layout, stage) => sum(Object.entries(stage ? r.byStage : r.byLM)
  .filter(([k]) => { const [l, m, s] = k.split('/'); return l === layout && (!mode || m === mode) && (!stage || +s === stage); })
  .map(([, v]) => v));

if (!a.includes('--stages')) {
  const cols = [];
  for (const r of R) for (const l of ['original', 'tall']) cols.push({ name: `${r.label}/${l}`.slice(-14), acc: pick(r, l) });
  console.log(`mode: ${mode || 'cpu4+human3'}`);
  console.log(table(cols));
} else {
  const keys = ['self-kills / CPU-minute', 'opp kills / CPU-minute', 'idle %', 'reversals % of moves', `near foe (<=3) %`,
    'time-up draws %', 'first kill (s)', 'human wins %', 'soft destroyed / min / 100 soft'];
  const short = ['selfK/m', 'oppK/m', 'idle%', 'rev%', 'near%', 'timeUp%', '1stKill', 'humWin%', 'soft%/m'];
  for (const r of R) {
    console.log(`== ${r.label}  mode ${mode || 'cpu4+human3'}`);
    console.log('stage layout   ' + short.map((s) => s.padStart(9)).join(''));
    for (const st of r.stages) for (const l of ['original', 'tall']) {
      const d = derive(pick(r, l, st));
      console.log(`${String(st).padStart(5)} ${l.padEnd(9)}` + keys.map((k) => d[k].toFixed(2).padStart(9)).join(''));
    }
  }
}
