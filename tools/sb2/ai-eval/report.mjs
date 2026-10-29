#!/usr/bin/env node
// Compare eval.mjs result files.
//   node tools/sb2/ai-eval/report.mjs a.json [b.json ...] [--mode cpu4|human3|mix1v3|mix2v2]
//        [--kind star|L5|...] [--stages]
// Without --stages: one column per (file, layout, mode, kind) (filtered by --mode / --kind).
// With --stages: key metrics per stage and layout, one block per (file, mode, kind).
import fs from 'node:fs';
import { derive, table, zero } from './eval.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const files = a.filter((x, i) => x.endsWith('.json') && !['--mode', '--kind'].includes(a[i - 1]));
const mode = opt('--mode', null), kind = opt('--kind', null);
const R = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const sum = (accs) => { const z = zero(); for (const x of accs) for (const k in x) z[k] += x[k]; return z; };
// keys: layout/mode/kind (byLM), layout/mode/kind/stage (byStage); old files: layout/mode[/stage]
const parse = (k, staged) => {
  const p = k.split('/');
  if (staged) return p.length === 4 ? { l: p[0], m: p[1], k: p[2], s: +p[3] } : { l: p[0], m: p[1], k: '?', s: +p[2] };
  return { l: p[0], m: p[1], k: p[2] || '?' };
};
const combos = (r) => [...new Set(Object.keys(r.byLM).map((k) => { const q = parse(k, false); return `${q.m}/${q.k}`; }))]
  .filter((mk) => (!mode || mk.split('/')[0] === mode) && (!kind || mk.split('/')[1] === kind)).sort();

if (!a.includes('--stages')) {
  const cols = [];
  for (const r of R) for (const mk of combos(r)) for (const l of ['original', 'tall']) {
    const acc = sum(Object.entries(r.byLM).filter(([k]) => { const q = parse(k, false); return q.l === l && `${q.m}/${q.k}` === mk; }).map(([, v]) => v));
    if (acc.rounds) cols.push({ name: `${R.length > 1 ? r.label + ':' : ''}${l === 'original' ? 'orig' : 'tall'}/${mk}`.slice(-18), acc });
  }
  console.log(table(cols));
} else {
  const keys = ['win % (per CPU-round)', 'self-kills / CPU-minute', 'opp kills / CPU-minute', 'idle % (not busy, no direction)', 'all draws %', 'first kill (s)', 'human wins %', 'CPU deaths / CPU-round', '  walked into fire %deaths',
    'sealed (no soft exit, no foe) %', '  by SD block %deaths', 'jumps / min'];
  const short = ['win%', 'selfK/m', 'oppK/m', 'idle%', 'draw%', '1stKill', 'humWin%', 'death/r', 'walkIn%', 'sealed%', 'SDdth%', 'jump/m'];
  for (const r of R) for (const mk of combos(r)) {
    console.log(`== ${r.label}  ${mk}`);
    console.log('stage layout   ' + short.map((s) => s.padStart(9)).join(''));
    for (const st of r.stages) for (const l of ['original', 'tall']) {
      const acc = sum(Object.entries(r.byStage).filter(([k]) => { const q = parse(k, true); return q.l === l && `${q.m}/${q.k}` === mk && q.s === st; }).map(([, v]) => v));
      if (!acc.rounds) continue;
      const d = derive(acc);
      console.log(`${String(st).padStart(5)} ${l.padEnd(9)}` + keys.map((k) => d[k].toFixed(2).padStart(9)).join(''));
    }
  }
}
