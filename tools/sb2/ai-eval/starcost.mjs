#!/usr/bin/env node
// ★ decision cost per ★ bomber per tick (ai_smart.js decide(), wall clock on this machine):
// one ★ vs three level-5 COMs, every stage, both layouts.
//   node tools/sb2/ai-eval/starcost.mjs [--core DIR] [--stages 1-10] [--seeds 2] [--ticks 6000]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const coreDir = path.resolve(opt('--core', process.env.SB2_CORE || path.resolve(HERE, '../../../public/arcade/sb2/core')));
const { createGame } = await import(pathToFileURL(path.join(coreDir, 'index.js')).href);
const { stats } = await import(pathToFileURL(path.join(coreDir, 'ai_smart.js')).href);
const range = (s) => { const m = s.match(/^(\d+)-(\d+)$/); if (!m) return s.split(',').map(Number); const o = []; for (let i = +m[1]; i <= +m[2]; i++) o.push(i); return o; };
const stages = range(opt('--stages', '1-10')), seeds = +opt('--seeds', 2), ticks = +opt('--ticks', 6000);
stats.timing = true;
let all = 0, allN = 0, allMax = 0;
console.log('stage layout     ms/★tick   max ms   searches/★tick');
for (const st of stages) for (const layout of ['original', 'tall']) {
  stats.ms = 0; stats.calls = 0; stats.maxMs = 0; stats.searches = 0;
  for (let k = 0; k < seeds; k++) {
    const g = createGame({ stage: st, layout, seed: 1000 + 2 * k * 7919 % 60000,
      players: [0, 1, 2, 3].map((i) => ({ type: 'cpu', level: i === k % 4 ? 10 : 5 })),
      rules: { wins: 3, time: 3, comLevel: 5, gbomber: false } });
    for (let t = 0; t < ticks; t++) { if (g.finished) { const r = g.nextRound(); if (r.matchOver) g.newMatch({}); } g.tick([0, 0, 0, 0]); }
  }
  console.log(`${String(st).padStart(5)} ${layout.padEnd(9)} ${(stats.ms / stats.calls).toFixed(4).padStart(9)} ${stats.maxMs.toFixed(2).padStart(8)} ${(stats.searches / stats.calls).toFixed(2).padStart(10)}`);
  all += stats.ms; allN += stats.calls; allMax = Math.max(allMax, stats.maxMs);
}
console.log(`all             ${(all / allN).toFixed(4).padStart(9)} ${allMax.toFixed(2).padStart(8)}`);
