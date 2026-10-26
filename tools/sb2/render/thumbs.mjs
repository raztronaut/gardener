#!/usr/bin/env node
// Picker thumbnails for the port (data/sb2/assets/pack/, gitignored: ROM-derived):
// thumb_tall_NN.png (256x455) and thumb_orig_NN.png (256x224) = each stage's real layout
// at the start of a round (seed 1, nobody moving), rendered by the port's renderer.
//   node tools/sb2/render/thumbs.mjs
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
for (const layout of ['tall', 'original']) {
  for (let stage = 1; stage <= 10; stage++) {
    const game = createGame({ stage, layout, seed: 1, players: [0, 1, 2, 3].map(() => ({ type: 'human' })),
      rules: { wins: 3, time: 3, gbomber: false } });
    const d = createDisplay(pack, { layout });
    d.beginRound(game);
    for (let i = 0; i < 24; i++) { game.tick([0, 0, 0, 0]); d.frame(game, game.events); }
    const px = d.render();
    const f = path.join(OUT, `thumb_${layout === 'tall' ? 'tall' : 'orig'}_${String(stage).padStart(2, '0')}.png`);
    fs.writeFileSync(f, encodePNG(new Uint8Array(px.buffer), 256, d.H, 1));
  }
}
console.log('thumbnails written to', OUT);
