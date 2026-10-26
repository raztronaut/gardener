#!/usr/bin/env node
// Stage-select mini maps of the TALL arenas (data/sb2/assets/pack/mini_tall.png, gitignored:
// ROM-derived): each stage's real tall layout at the start of a round (seed 1, nobody
// moving, the four bombers in their corners), rendered by the port's renderer and taken
// 1 pixel in 2 (nearest, no blending: crisp). The full ring is 15 x 27 cells = 120 x 216 at
// 8 px per cell; the menu's preview hole is 112 x 208, so the outer half of the ring cells
// is cropped (4 px each side). 10 maps side by side: 1120 x 208.
//   node tools/sb2/render/minimaps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';
import { loadPack } from './shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));
const OUT = path.join(ROOT, 'data', 'sb2', 'assets', 'pack');
const pack = loadPack();
const MW = 112, MH = 208;
const atlas = new Uint8Array(MW * 10 * MH * 4);
for (let stage = 1; stage <= 10; stage++) {
  const game = createGame({ stage, layout: 'tall', seed: 1, players: [0, 1, 2, 3].map(() => ({ type: 'human' })),
    rules: { wins: 3, time: 3, gbomber: false } });
  const d = createDisplay(pack, { layout: 'tall' });
  d.beginRound(game);
  for (let i = 0; i < 24; i++) { game.tick([0, 0, 0, 0]); d.frame(game, game.events); }
  const px = new Uint8Array(d.render().buffer);
  // ring cell (1, 3) top-left on screen = (8, 25); + 8 px = the crop origin
  const x0 = 16, y0 = 33;
  for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
    const s = ((y0 + 2 * j) * 256 + (x0 + 2 * i)) * 4, t = (j * MW * 10 + (stage - 1) * MW + i) * 4;
    atlas[t] = px[s]; atlas[t + 1] = px[s + 1]; atlas[t + 2] = px[s + 2]; atlas[t + 3] = 255;
  }
}
fs.writeFileSync(path.join(OUT, 'mini_tall.png'), encodePNG(atlas, MW * 10, MH, 1));
console.log('mini maps written to', path.join(OUT, 'mini_tall.png'));
