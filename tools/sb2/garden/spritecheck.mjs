#!/usr/bin/env node
// Garden Edition sprite audit: ONE game drives two displays in lockstep (the original pack
// and the skinned pack: display.frame only reads the game's memory), and every OAM entry is
// compared colour by colour. The skin may only change its own sprites (the pods, the
// stage-2 pushed block, the falling block); anything else that differs, any sprite pixel in
// a placeholder colour (magenta $7C1E) or an all-white / empty sprite is reported.
//   node tools/sb2/garden/spritecheck.mjs [--stages 1,..] [--ticks 7000]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../render/shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));
const { skinPack } = await import(path.join(ROOT, 'public/arcade/sb2/render/skin.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const STAGES = arg('stages', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number), TICKS = +arg('ticks', 7000);
const dir = path.join(ROOT, 'public/arcade/sb2/garden');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'garden.json'), 'utf8'));
const orig = loadPack();
const garden = skinPack(orig, { manifest: man, bin: new Uint8Array(fs.readFileSync(path.join(dir, man.bin))), base: '/' });
// the skin's own sprites (fixed OBJ tiles): pods, sparkles, small pods; 96 (stage 2), 142 (falling block)
const OWN = new Set([32, 34, 36, 38, 40, 42, 43, 44, 45, 46, 47, 98, 100, 104, 106, 108, 110, 142]);
const issues = new Map();
const note = (k, v) => { if (!issues.has(k)) issues.set(k, v); };
let compared = 0;
for (const layout of ['tall', 'original']) for (const stage of STAGES) for (const run of [0, 1]) {
  const game = createGame({ stage, layout, seed: 300 + stage * 13 + run, players: [0, 1, 2, 3].map(() => ({ type: 'cpu', level: run ? 5 : 10 })),
    rules: { wins: 3, time: 3, gbomber: run === 1, champion: run === 1 ? 0x8100 : null } });
  const dO = createDisplay(orig, { layout, classic: true }), dG = createDisplay(garden, { layout, classic: true });
  const tiles = [new Map(), new Map()];
  for (const [k, d] of [[0, dO], [1, dG]]) { const f = d.ppu.vramObj; d.ppu.vramObj = (t, s) => { const g = f(t, s); tiles[k].set(g, t); return g; }; }
  dO.beginRound(game); dG.beginRound(game);
  const M = game.mem;
  for (let i = 0; i < 4; i++) { const p = 0x8000 + 0x100 * i; M[p + 0xFF] = 1; M[p + 0xFE] = 1; }
  let poked = false;
  for (let t = 0; t < TICKS; t++) {
    if (game.finished) { const r = game.nextRound(); if (r.matchOver) break; dO.beginRound(game); dG.beginRound(game);
      for (let i = 0; i < 4; i++) { const p = 0x8000 + 0x100 * i; M[p + 0xFF] = 1; M[p + 0xFE] = 1; } poked = false; }
    if (!poked && t % 2500 === 600) { M[0x5E10] = 1; M[0x5E12] = 0; poked = true; }
    game.tick([0, 0, 0, 0]);
    dO.frame(game, game.events); dG.frame(game, game.events);
    const a = dO.ppu.oam, b = dG.ppu.oam;
    if (a.n !== b.n) { note(`${stage} oam count`, `${a.n} vs ${b.n}`); continue; }
    for (let k = 0; k < a.n; k++) {
      const ta = tiles[0].get(a.gfx[k]), tb = tiles[1].get(b.gfx[k]);
      const key = (tb === undefined ? 'pose' : 'tile ' + tb) + ' pal ' + b.pal[k] + ' ' + b.w[k];
      const colA = spriteCols(dO, a, k), colB = spriteCols(dG, b, k);
      compared++;
      let anyB = false, allWhite = true, magenta = false;
      for (let i = 0; i < colB.length; i++) { const c = colB[i]; if (c < 0) continue; anyB = true; if (c !== 0x7FFF) allWhite = false; if (c === 0x7C1E) magenta = true; }
      const own = tb !== undefined && (OWN.has(tb) || (stage === 2 && tb === 96));
      if (magenta) note(`${stage} ${key} placeholder`, 'magenta pixels');
      if (anyB && allWhite && !(tb === 142 && !own)) note(`${stage} ${key} white`, 'all white');
      if (!own) {
        let same = colA.length === colB.length;
        for (let i = 0; same && i < colA.length; i++) if (colA[i] !== colB[i]) same = false;
        if (!same) note(`${stage} ${layout} ${key} differs`, `tile ${ta}/${tb}`);
      }
    }
  }
  process.stderr.write(`${layout} ${stage} run ${run} ok\n`);
}
function spriteCols(d, o, k) {
  const g = d.ppu.gfx(o.gfx[k]), c = d.ppu.cgram;
  const pb = 128 + o.pal[k] * 16, out = new Int32Array(g.w * g.h);
  for (let i = 0; i < out.length; i++) out[i] = g.p[i] ? c[pb + g.p[i]] : -1;
  return out;
}
console.log('compared', compared, 'sprites');
for (const [k, v] of issues) console.log(k, '-', v);
if (!issues.size) console.log('no issues');
