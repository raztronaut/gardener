#!/usr/bin/env node
// End-to-end check of the pacing model as the wall runs it (public/arcade/sb2/pacing.js
// after(), fed by the core + the renderer exactly like app.js), against the original.
//
//   node tools/sb2/conformance/lagcheck.mjs            # every vector: predicted vs actual
//   node tools/sb2/conformance/lagcheck.mjs --sim      # + scenarios on both layouts
//
// Actual = the frames the original spent on each tick (the vector's frame -> tick map:
// the gap between the frames in which consecutive ticks completed). Speed = ticks per
// second = 60.0988 x ticks / frames.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVector } from './run.mjs';
import { createPacer } from '../../../public/arcade/sb2/pacing.js';
import { loadPack } from '../render/shot.mjs';
import { createDisplay } from '../../../public/arcade/sb2/render/display.js';
import { createGame } from '../../../public/arcade/sb2/core/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const VEC = path.join(ROOT, 'data', 'sb2', 'vectors');
const PACK = loadPack();
const HZ = 60.0988;

function checkVector(name) {
  const pacer = createPacer({ rom8: PACK.rom8 });
  const disp = createDisplay(PACK, { layout: 'original' });
  const done = [], pred = [], skip = [];
  let lastTick = -1;
  const r = runVector(name, {
    max: 1,
    onTick: ({ i, game }) => {
      disp.frame(game, game.events);
      const t = game.mem[0x32] | (game.mem[0x33] << 8);
      const newRound = t < lastTick;
      if (newRound) pacer.reset();              // a new round (as app.js does)
      lastTick = t;
      // a new round's first tick (its gap holds the scoreboard and the init) and the round's
      // last tick (the battle loop exits into the fade-out) are not play
      skip.push(newRound || game.finished);
      pred.push(pacer.after(game, disp));
      done.push(i);
    },
  });
  // tick k's actual length = done[k] - done[k-1]; skip the first tick and the post-round gaps
  let T = 0, A = 0, P = 0, match = 0;
  for (let k = 1; k < done.length; k++) {
    const a = done[k] - done[k - 1];
    if (a >= 20 || skip[k]) continue;
    T++; A += a; P += pred[k];
    if (a === pred[k]) match++;
  }
  return { name, ok: r.ok, T, A, P, match: T ? match / T * 100 : 100 };
}

function simulate({ stage, layout, players, ticks, seed = 7, sd = false }) {
  const game = createGame({ stage, layout, seed, players, rules: { wins: 3, time: sd ? 1 : 3, gbomber: false, comLevel: 5 } });
  const disp = createDisplay(PACK, { layout });
  const pacer = createPacer({ rom8: PACK.rom8 });
  disp.beginRound(game);
  // the human: a deterministic wander (holds a direction, drops a bomb now and then)
  let s = seed * 9301 + 49297, dir = 16, hold = 0;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF;
  let T = 0, F = 0, lagT = 0;
  // slot 0 = the wandering human; other humans stand still (no controller)
  for (let k = 0; k < ticks; k++) {
    if (game.finished) {
      const res = game.nextRound();
      if (res && res.matchOver) game.newMatch({});
      disp.beginRound(game); pacer.reset();
    }
    if (--hold <= 0) { dir = [16, 32, 64, 128][(rnd() * 4) | 0]; hold = 8 + ((rnd() * 40) | 0); }
    const pads = [players[0].type === 'human' ? dir | (rnd() < 0.03 ? 256 : 0) : null, null, null, null];
    game.tick(pads);
    disp.frame(game, game.events);
    const f = pacer.after(game, disp);
    T++; F += f; if (f > 1) lagT++;
  }
  return { T, F, lagFrames: F - T, rate: HZ * T / F };
}

function main() {
  const names = fs.readdirSync(VEC).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  let T = 0, A = 0, P = 0;
  console.log('vector                  ticks  frames  pred   speed err  tick match  actual rate  model rate');
  for (const n of names) {
    const c = checkVector(n);
    T += c.T; A += c.A; P += c.P;
    console.log(`${n.padEnd(22)} ${String(c.T).padStart(6)} ${String(c.A).padStart(7)} ${String(c.P).padStart(5)}  ${((c.A - c.P) / c.A * 100).toFixed(2).padStart(7)} %  ${c.match.toFixed(2).padStart(8)} %  ${(HZ * c.T / c.A).toFixed(2).padStart(9)}  ${(HZ * c.T / c.P).toFixed(2).padStart(9)}`);
  }
  console.log(`ALL ${T} ticks: ${A} frames, predicted ${P} (${((A - P) / A * 100).toFixed(3)} %)`);
  if (process.argv.includes('--sim')) {
    const H = { type: 'human' }, C = { type: 'cpu', level: 5 };
    // (the core has no OFF slot: "idle" humans stand still without a controller)
    const scen = [
      ['humans only (1 walking + 3 idle)', [H, H, H, H]], ['1 human + 1 CPU (+2 idle)', [H, C, H, H]],
      ['1 human + 3 CPU', [H, C, C, C]], ['4 CPU', [C, C, C, C]],
    ];
    console.log('\nscenario (stage 1..10, 3600 ticks each)   layout     lag %   ticks/s');
    for (const layout of ['original', 'tall']) {
      for (const [label, players] of scen) {
        let t = 0, f = 0;
        for (let st = 1; st <= 10; st++) { const r = simulate({ stage: st, layout, players, ticks: 3600, seed: st }); t += r.T; f += r.F; }
        console.log(`${label.padEnd(40)} ${layout.padEnd(9)} ${((f - t) / f * 100).toFixed(2).padStart(6)}   ${(HZ * t / f).toFixed(2)}`);
      }
      let t = 0, f = 0;
      for (let st = 1; st <= 10; st++) { const r = simulate({ stage: st, layout, players: [H, C, C, C], ticks: 7200, seed: 100 + st, sd: true }); t += r.T; f += r.F; }
      console.log(`${'sudden death (1:00 rounds, 1 H + 3 CPU)'.padEnd(40)} ${layout.padEnd(9)} ${((f - t) / f * 100).toFixed(2).padStart(6)}   ${(HZ * t / f).toFixed(2)}`);
    }
  }
}
main();
