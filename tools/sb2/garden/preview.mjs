#!/usr/bin/env node
// Garden Edition previews (dev): full tall stages mid-round (CPU matches: bombers, pods,
// blooms, burning hedges, items), rendered by the port's own display with the skin
// overlay applied, next to the original. Nothing here touches a browser or the kiosk.
//
//   node tools/sb2/garden/preview.mjs [--stages 1,2,..] [--ticks 900,1500] [--layout tall]
//        [--scale 2] [--orig] [--out data/sb2/garden/preview] [--seed 3] [--glove]
// Writes <out>/garden_sNN.png (one column per sampled tick; + the original with --orig).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../render/png.mjs';
import { loadPack } from '../render/shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));
const { skinPack } = await import(path.join(ROOT, 'public/arcade/sb2/render/skin.js'));

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const stages = arg('stages', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const ticks = arg('ticks', '700,1400').split(',').map(Number);
const layout = arg('layout', 'tall');
const scale = +arg('scale', '2');
const seed = +arg('seed', '3');
const outDir = path.resolve(ROOT, arg('out', 'data/sb2/garden/preview'));
fs.mkdirSync(outDir, { recursive: true });

export function loadGardenSkin() {
  const dir = path.join(ROOT, 'public/arcade/sb2/garden');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'garden.json'), 'utf8'));
  return { manifest, bin: new Uint8Array(fs.readFileSync(path.join(dir, manifest.bin))), base: '/arcade/sb2/garden/' };
}

const orig = loadPack();
const garden = skinPack(orig, loadGardenSkin());

function run(pack, stage) {
  const game = createGame({ stage, layout, seed: seed + stage,
    players: [0, 1, 2, 3].map(() => ({ type: 'cpu', level: 10 })), rules: { wins: 3, time: 3, gbomber: false } });
  const d = createDisplay(pack, { layout, classic: true });
  d.beginRound(game);
  if (has('glove')) for (let i = 0; i < 4; i++) { game.mem[0x8000 + 0x100 * i + 0xFE] = 1; game.mem[0x8000 + 0x100 * i + 0xFF] = 1; }
  const shots = [];
  let t = 0;
  for (const want of ticks) {
    for (; t < want && !game.finished; t++) { game.tick([0, 0, 0, 0]); d.frame(game, game.events); }
    shots.push(new Uint8Array(d.render().buffer.slice(0)));
  }
  return { shots, H: d.H };
}

for (const st of stages) {
  const cols = [];
  const g = run(garden, st);
  cols.push(...g.shots);
  if (has('orig')) cols.push(...run(orig, st).shots);
  const W = 256 * cols.length + 8 * (cols.length - 1), H = g.H;
  const sheet = new Uint8Array(W * H * 4);
  cols.forEach((px, k) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < 256; x++) {
      const s = (y * 256 + x) * 4, dd = (y * W + k * 264 + x) * 4;
      sheet[dd] = px[s]; sheet[dd + 1] = px[s + 1]; sheet[dd + 2] = px[s + 2]; sheet[dd + 3] = 255;
    }
  });
  const out = path.join(outDir, `garden_s${String(st).padStart(2, '0')}.png`);
  fs.writeFileSync(out, encodePNG(sheet, W, H, scale));
  console.log(out);
}
