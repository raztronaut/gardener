#!/usr/bin/env node
// Per-frame cost of the port, headless (Node = the same V8 as the kiosk's Chrome, on the
// same Jetson CPU): game.tick + display.frame (core + display logic) and display.render
// (BG/sprite composition into the 256xH RGBA buffer). 4 CPUs play; the clock is poked
// to reach hurry / sudden death inside the run. Also counts GCs to show the steady state
// allocates (almost) nothing per frame.
//   node tools/sb2/qa/perf.mjs [--layout tall|original] [--stage N] [--ticks 6000]
import { PerformanceObserver } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../render/shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const layout = arg('layout', 'tall'), TICKS = +arg('ticks', 6000), stages = arg('stage', '1,3,5,8').split(',').map(Number);

let gcs = 0, gcMs = 0;
new PerformanceObserver((l) => { for (const e of l.getEntries()) { gcs++; gcMs += e.duration; } }).observe({ entryTypes: ['gc'] });
const pack = loadPack();
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
// one display per layout for the whole session, like the app (app.js reuses it across matches)
const disp = createDisplay(pack, { layout });
for (const stage of stages) {
  const game = createGame({ stage, layout, seed: 7, players: [0, 1, 2, 3].map(() => ({ type: 'cpu', level: 5 })), rules: { wins: 3, time: 3, gbomber: false } });
  const d = disp;
  d.beginRound(game);
  const tk = [], rd = [], all = [];
  // warm-up (JIT), then measure
  for (let i = 0; i < 300; i++) { game.tick([0, 0, 0, 0]); d.frame(game, game.events); d.render(); }
  game.mem[0x5E10] = 1; game.mem[0x5E12] = 0;     // 1:00 -> hurry / sudden death during the run
  const g0 = gcs, gm0 = gcMs;
  for (let i = 0; i < TICKS && !game.finished; i++) {
    const a = performance.now();
    game.tick([0, 0, 0, 0]); d.frame(game, game.events);
    const b = performance.now();
    d.render();
    const c = performance.now();
    tk.push(b - a); rd.push(c - b); all.push(c - a);
  }
  const s = (x) => x.slice().sort((p, q) => p - q);
  const T = s(tk), R = s(rd), A = s(all);
  const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
  console.log(`${layout} stage ${stage}: ${A.length} frames  tick+logic mean ${mean(tk).toFixed(3)} p95 ${pct(T, 0.95).toFixed(3)} ms | render mean ${mean(rd).toFixed(3)} p95 ${pct(R, 0.95).toFixed(3)} ms | total mean ${mean(all).toFixed(3)} p95 ${pct(A, 0.95).toFixed(3)} p99 ${pct(A, 0.99).toFixed(3)} max ${A[A.length - 1].toFixed(2)} ms | GCs ${gcs - g0} (${(gcMs - gm0).toFixed(1)} ms) | sd ${game.state.suddenDeath} finished ${game.finished}`);
}
