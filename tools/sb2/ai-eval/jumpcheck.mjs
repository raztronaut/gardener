#!/usr/bin/env node
// Checks the ★ jump model (ai_smart.js jumpEnd / hopPath) against the core: a bomber placed
// on every floor cell of stage 10 jumps in every direction (others parked); compares the
// cell it ends in (after the landing and any hop) and when it can act again.
//   node tools/sb2/ai-eval/jumpcheck.mjs [--core DIR] [--layouts original,tall] [-v]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const coreDir = path.resolve(opt('--core', process.env.SB2_CORE || path.resolve(HERE, '../../../public/arcade/sb2/core')));
const imp = (f) => import(pathToFileURL(path.join(coreDir, f)).href);
const { createGame } = await imp('index.js');
const mem = await imp('mem.js');
const { jumpPredict } = await imp('ai_smart.js');
const verbose = a.includes('-v');
const DIRS = [16, 32, 64, 128];   // U D L R pad bits
let rejects = 0, total = 0, bad = 0, early = 0, late = 0, worst = 0;
for (const layout of opt('--layouts', 'original,tall').split(',')) {
  const base = createGame({ stage: 10, layout, seed: 1000, players: [{ type: 'human' }, { type: 'off' }, { type: 'off' }, { type: 'off' }],
    rules: { wins: 3, time: 3, comLevel: 5, gbomber: false } });
  for (let i = 0; i < 20; i++) base.tick([0, 0, 0, 0]);
  // --clear: every other soft block removed (more take-off cells, hops of every length)
  if (a.includes('--clear')) {
    mem.use(base.mem);
    let k = 0;
    for (let cy = 4; cy <= (layout === 'tall' ? 28 : 14); cy++) for (let cx = 2; cx <= 14; cx++) {
      const gi = 0x1C000 + cy * 0x80 + cx * 2;
      if (mem.r8(gi) === 0xC2 && (k++ & 1)) { mem.w16(gi, 0); mem.w16(0x1D000 + cy * 0x80 + cx * 2, 0); }
    }
  }
  const snap = base.save();
  const s0 = base.state, G = s0.grid;
  const rows = layout === 'tall' ? 28 : 14;
  for (let cy = 4; cy <= rows; cy++) for (let cx = 2; cx <= 14; cx++) {
    if (G.code[(cy - G.rows[0]) * G.width + cx] !== 0) continue;
    for (let d = 0; d < 4; d++) {
      const g = createGame({ stage: 10, layout, seed: 1000, players: [{ type: 'human' }, { type: 'off' }, { type: 'off' }, { type: 'off' }],
        rules: { wins: 3, time: 3, comLevel: 5, gbomber: false } });
      g.load(snap);
      mem.use(g.mem);
      mem.w16(0x8010, 16 * cx); mem.w16(0x8018, 16 * cy - 16);
      g.tick([0, 0, 0, 0]); g.tick([0, 0, 0, 0]);
      const tk = g.state.tick + 1;
      const pr = jumpPredict(g, cx, cy, d, tk);
      mem.use(g.mem);
      let t = 0, end = null;
      g.tick([0, 0, 0, 0].map((_, k) => (k === 0 ? DIRS[d] | 2 : 0)));
      for (t = 0; t < 400; t++) {
        const b = g.state.bombers[0];
        if (!b.jumping && !b.hopping && !b.busy) { end = { cell: [b.cx, b.cy], t: g.state.tick }; break; }
        g.tick([0, 0, 0, 0]);
      }
      total++;
      const same = pr && end && pr.cell[0] === end.cell[0] && pr.cell[1] === end.cell[1];
      const dt = pr && end ? pr.t - end.t : 0;
      if (!pr) rejects++;
      if (!same && pr) bad++;
      if (same && dt < 0) early++;
      if (same && dt > 3) late++;
      if (same) worst = Math.max(worst, Math.abs(dt));
      if (verbose || (!same && pr)) console.log(`${layout} (${cx},${cy}) ${'UDLR'[d]}: model ${pr ? pr.cell + ' @' + (pr.t - tk) : 'reject'} core ${end ? end.cell + ' @' + (end.t - tk) : 'none'}`);
    }
  }
}
console.log(`${total} jumps (${rejects} rejected by the model): ${bad} wrong end cell, ${early} predicted early, ${late} > 3 ticks late, worst |dt| ${worst}`);
process.exit(bad || early ? 1 : 0);
