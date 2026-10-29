#!/usr/bin/env node
// Garden Edition stage-select previews: each garden at the start of a round, rendered by the
// port with the skin applied, 1 pixel in 2 (crisp):
//   public/arcade/sb2/garden/mini_tall.png  10 x (112 x 208)  the TALL arena (like the
//                                           original pack's mini_tall.png)
//   public/arcade/sb2/garden/mini_orig.png  10 x (112 x 112)  the CLASSIC 13 x 11 arena
//                                           (the original menus show their own preview art)
//   node tools/sb2/garden/minimaps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../render/png.mjs';
import { loadPack } from '../render/shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));
const { skinPack } = await import(path.join(ROOT, 'public/arcade/sb2/render/skin.js'));
const OUT = path.join(ROOT, 'public/arcade/sb2/garden');
const sk = JSON.parse(fs.readFileSync(path.join(OUT, 'garden.json'), 'utf8'));
const pack = skinPack(loadPack(), { manifest: sk, bin: new Uint8Array(fs.readFileSync(path.join(OUT, sk.bin))), base: '/arcade/sb2/garden/' });

function shot(stage, layout) {
  const game = createGame({ stage, layout, seed: 1, players: [0, 1, 2, 3].map(() => ({ type: 'human' })),
    rules: { wins: 3, time: 3, gbomber: false } });
  const d = createDisplay(pack, { layout, classic: true });
  d.beginRound(game);
  for (let i = 0; i < 24; i++) { game.tick([0, 0, 0, 0]); d.frame(game, game.events); }
  return new Uint8Array(d.render().buffer.slice(0));
}
for (const [layout, MH, file] of [['tall', 208, 'mini_tall.png'], ['original', 112, 'mini_orig.png']]) {
  const MW = 112;
  const atlas = new Uint8Array(MW * 10 * MH * 4);
  for (let stage = 1; stage <= 10; stage++) {
    const px = shot(stage, layout);
    // ring cell (1, 3) top-left on screen = (8, 25); + 8 px = the crop origin. The classic
    // arena (15 x 13 cells = 120 x 104 at half size) sits 4 px lower in its 112 x 112 hole.
    const x0 = 16, y0 = layout === 'tall' ? 33 : 25, dy = layout === 'tall' ? 0 : 4;
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      const sy = y0 + 2 * (j - dy), t = (j * MW * 10 + (stage - 1) * MW + i) * 4;
      if (j < dy || sy >= (layout === 'tall' ? 455 : 224) || (layout !== 'tall' && j - dy >= 104)) { atlas[t] = 15; atlas[t + 1] = 58; atlas[t + 2] = 36; atlas[t + 3] = 255; continue; }
      const s = (sy * 256 + (x0 + 2 * i)) * 4;
      atlas[t] = px[s]; atlas[t + 1] = px[s + 1]; atlas[t + 2] = px[s + 2]; atlas[t + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(OUT, file), encodePNG(atlas, MW * 10, MH, 1));
  console.log('wrote', path.join(OUT, file));
}
