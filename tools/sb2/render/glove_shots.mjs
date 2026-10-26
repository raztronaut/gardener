#!/usr/bin/env node
// Glove sequences by each bomber colour, rendered with the wall's classic colours: every
// bomber in turn gets the glove, drops a bomb, lifts it, carries it, throws it (it flies,
// bounces on blocks, lands) — one contact-sheet row per bomber, a crop around the action
// every few ticks. For checking that a bomb is drawn in black's colours in every state.
//   node tools/sb2/render/glove_shots.mjs <out.png> [original|tall] [classic 0|1] [stage]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';
import { loadPack } from './shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));

const [out = '/tmp/glove.png', layout = 'original', cls = '1', stage = '1'] = process.argv.slice(2);
const B = { A: 256, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
const pack = loadPack();
const CW = 112, CH = 96, SAMPLE = [6, 10, 14, 18, 22, 26, 30, 33, 36, 39, 42, 45, 48, 52];
const W = CW * SAMPLE.length, H = CH * 4;
const sheet = new Uint8Array(W * H * 4);
const disp = createDisplay(pack, { layout, classic: cls === '1' });
for (let k = 0; k < 4; k++) {
  const game = createGame({ stage: +stage, layout, seed: 7 + k,
    players: [0, 1, 2, 3].map(() => ({ type: 'human' })), rules: { wins: 3, time: 3, gbomber: false } });
  const M = game.mem, p = 0x8000 + 0x100 * k;
  M[p + 0xFE] = 1;                                // glove (+FE)
  disp.beginRound(game);
  for (let t = 0; t < 16; t++) { game.tick([0, 0, 0, 0]); disp.frame(game, game.events); }
  const b = game.state.bombers[k];
  const dir = b.cx < 8 ? B.RIGHT : B.LEFT;        // throw towards the middle
  const seq = [];
  const hold = (n, m) => { for (let i = 0; i < n; i++) seq.push(m); };
  hold(1, B.A); hold(6, 0); hold(20, B.A); hold(1, B.A | dir); hold(1, dir); hold(40, 0);
  const x0 = Math.max(0, Math.min(256 - CW, (b.x - 8) + (dir === B.RIGHT ? -24 : -CW + 40)));
  const y0 = Math.max(0, Math.min(disp.H - CH, b.y - 24 - 40));
  let col = 0;
  for (let i = 0; i < seq.length; i++) {
    const pads = [0, 0, 0, 0]; pads[k] = seq[i];
    game.tick(pads); disp.frame(game, game.events);
    if (SAMPLE[col] === i) {
      const px = new Uint8Array(disp.render().buffer.slice(0));
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const s = ((y0 + y) * 256 + x0 + x) * 4, d = ((k * CH + y) * W + col * CW + x) * 4;
        sheet[d] = px[s]; sheet[d + 1] = px[s + 1]; sheet[d + 2] = px[s + 2]; sheet[d + 3] = 255;
      }
      col++;
    }
  }
}
fs.writeFileSync(out, encodePNG(sheet, W, H, 2));
console.log(out);
