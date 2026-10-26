#!/usr/bin/env node
// Render a port frame to PNG (dev / QA): a CPU-only match on a stage, after N ticks.
//   node tools/sb2/render/shot.mjs <stage 1..10> <original|tall> <ticks> <out.png> [seed] [scale]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { makePack } = await import(path.join(ROOT, 'public/arcade/sb2/render/pack.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));

export function loadPack() {
  const dir = path.join(ROOT, 'data', 'sb2', 'assets', 'pack');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
  return makePack(m, new Uint8Array(fs.readFileSync(path.join(dir, m.bin))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stage, layout, ticks, out, seed = '1', scale = '2'] = process.argv.slice(2);
  const pack = loadPack();
  const game = createGame({ stage: +stage, layout, seed: +seed,
    players: [0, 1, 2, 3].map(() => ({ type: 'cpu', level: 5 })), rules: { wins: 3, time: 3, gbomber: false } });
  const d = createDisplay(pack, { layout });
  d.beginRound(game);
  const t0 = performance.now();
  for (let i = 0; i < +ticks && !game.finished; i++) { game.tick([0, 0, 0, 0]); d.frame(game, game.events); }
  const t1 = performance.now();
  const px = d.render();
  fs.writeFileSync(out, encodePNG(new Uint8Array(px.buffer), 256, d.H, +scale));
  console.log(JSON.stringify({ out, ticks: game.state.tick, msPerTick: (t1 - t0) / Math.max(1, +ticks) }));
}
