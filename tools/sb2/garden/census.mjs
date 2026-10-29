#!/usr/bin/env node
// Garden skin census: which graphics the battle actually draws. Runs CPU matches on every
// stage (both layouts, items forced on some bombers: kick / glove / bomb types / skull),
// and records every bomber pose (ROM C2 pointer + anim set/id, with its C5 pieces) and
// every fixed-VRAM OBJ tile (+ OBJ palette) used by movers and effects.
//   node tools/sb2/garden/census.mjs  -> data/sb2/garden/census.json (local, ROM-derived)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../render/shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const { createDisplay } = await import(path.join(ROOT, 'public/arcade/sb2/render/display.js'));
const pack = loadPack();
const poses = new Map();     // pose ptr -> {anims:Set, count}
const objTiles = new Map();  // stage:tile:size -> {pals:Set, count}
const TICKS = +(process.env.CENSUS_TICKS || 9000);
const BT = [0, 4, 6, 8];     // bombType values to force (normal, remote?, …)
for (const layout of ['tall', 'original']) for (let stage = 1; stage <= 10; stage++) for (let run = 0; run < (layout === 'tall' ? 3 : 1); run++) {
  const game = createGame({ stage, layout, seed: 100 + stage * 7 + run * 1000,
    players: [0, 1, 2, 3].map(() => ({ type: 'cpu', level: run === 1 ? 5 : 10 })), rules: { wins: 3, time: 3, gbomber: run === 2, champion: run === 2 ? 0x8100 : null } });
  const d = createDisplay(pack, { layout, classic: true });
  const ppu = d.ppu;
  const rev = new Map();
  const orig = ppu.vramObj;
  ppu.vramObj = (t, size) => { const g = orig(t, size); rev.set(g, t + ':' + size); return g; };
  d.beginRound(game);
  const M = game.mem;
  for (let i = 0; i < 4; i++) {
    const p = 0x8000 + 0x100 * i;
    if (run !== 1) { M[p + 0xFF] = 1; M[p + 0xFE] = 1; }
  }
  let rounds = 0;
  for (let t = 0; t < TICKS; t++) {
    if (game.finished) { const r = game.nextRound(); rounds++; if (r.matchOver || rounds > 3) break; d.beginRound(game);
      for (let i = 0; i < 4; i++) { const p = 0x8000 + 0x100 * i; if (run !== 1) { M[p + 0xFF] = 1; M[p + 0xFE] = 1; M[p + 0xF3] = [0, 0x0E, 0x28, 0x2A][(rounds + i) & 3] === 0 ? M[p + 0xF3] : M[p + 0xF3]; } } }
    game.tick([0, 0, 0, 0]);
    d.frame(game, game.events);
    for (let i = 0; i < 4; i++) {
      const p = 0x8000 + 0x100 * i;
      if (!(M[p + 1] & 0x80)) continue;
      const pose = M[p + 0x79] | (M[p + 0x7A] << 8) | (M[p + 0x7B] << 16);
      const key = pose;
      let e = poses.get(key); if (!e) { e = { anims: new Set(), count: 0, cols: new Set() }; poses.set(key, e); }
      e.count++; e.anims.add((M[p + 0x50] | (M[p + 0x51] << 8)) + '/' + (M[p + 0x6A] | (M[p + 0x6B] << 8)).toString(16)); e.cols.add(i);
    }
    const o = ppu.oam;
    for (let k = 0; k < o.n; k++) {
      const key = rev.get(o.gfx[k]);
      if (!key) continue;
      const kk = stage + ':' + key;
      let e = objTiles.get(kk); if (!e) { e = { pals: new Set(), count: 0 }; objTiles.set(kk, e); }
      e.count++; e.pals.add(o.pal[k]);
    }
  }
  process.stderr.write(`${layout} ${stage} run ${run} poses ${poses.size} obj ${objTiles.size}\n`);
}
const out = {
  poses: [...poses].map(([p, e]) => ({ pose: p, count: e.count, anims: [...e.anims], cols: [...e.cols] })),
  obj: [...objTiles].map(([k, e]) => ({ key: k, count: e.count, pals: [...e.pals] })),
};
fs.mkdirSync(path.join(ROOT, 'data/sb2/garden'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/sb2/garden/census.json'), JSON.stringify(out));
console.log('poses', out.poses.length, 'obj', out.obj.length);
