#!/usr/bin/env node
// Danger-map audit: how many cells of the AI danger map ($7F8000) are marked while no
// bomb's blast line (the AI's own marking rule: centre + range+1 cells per ray, stopping
// before a solid cell, an item or a bomb) and no fire covers them ("stale" marks), and how
// often a COM is standing on / walking against such a cell.
//   node tools/sb2/ai-eval/danger.mjs [--core DIR] [--stages 1-10] [--seeds 4] [--rounds 2]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const coreDir = path.resolve(opt('--core', process.env.SB2_CORE || path.resolve(HERE, '../../../public/arcade/sb2/core')));
const { createGame } = await import(pathToFileURL(path.join(coreDir, 'index.js')).href);
const [s0, s1] = opt('--stages', '1-10').split('-').map(Number);
const nSeeds = +opt('--seeds', 4), rounds = +opt('--rounds', 2);

for (const layout of ['original', 'tall']) {
  let ticks = 0, staleSum = 0, legitSum = 0, cpuTicks = 0, onStale = 0, frontStale = 0, noBombTicks = 0;
  for (let st = s0; st <= (s1 || s0); st++) for (let i = 0; i < nSeeds; i++) {
    const game = createGame({ stage: st, layout, seed: 1000 + 2 * i * 7919 % 60000,
      players: [0, 1, 2, 3].map(() => ({ type: 'cpu', level: 5 })), rules: { wins: 3, time: 3, comLevel: 5, gbomber: false } });
    for (let r = 0; r < rounds; r++) {
      let t = 0;
      while (!game.finished && t < 40000) {
        game.tick([0, 0, 0, 0]); t++;
        const s = game.state, m = game.mem;
        const W = s.grid.width, r0 = s.grid.rows[0], H = s.grid.height;
        const code = (x, y) => (y < r0 || y >= r0 + H ? 0xC6 : s.grid.code[(y - r0) * W + x]);
        const legit = new Set();
        for (const b of s.bombs) {
          if (b.moving) continue;
          legit.add(b.cy * 0x80 + b.cx * 2);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 1; k <= b.range + 1; k++) {
            const x = b.cx + dx * k, y = b.cy + dy * k, v = code(x, y);
            if ((v & 0x80) || v === 0x44 || v === 0x43) break;
            legit.add(y * 0x80 + x * 2);
          }
        }
        for (const f of s.fire) legit.add(f.cy * 0x80 + f.cx * 2);
        if (!s.bombs.length) noBombTicks++;
        let stale = 0, lg = 0;
        const staleSet = new Set();
        for (let y = r0; y < r0 + H; y++) for (let x = 0; x < W; x++) {
          const gi = y * 0x80 + x * 2;
          if (!(m[0x18000 + gi] | m[0x18001 + gi])) continue;
          if (legit.has(gi)) lg++; else { stale++; staleSet.add(gi); }
        }
        ticks++; staleSum += stale; legitSum += lg;
        for (const b of s.bombers) {
          if (!b.active || b.dying || !b.com) continue;
          cpuTicks++;
          const gi = b.cy * 0x80 + b.cx * 2;
          if (staleSet.has(gi)) onStale++;
          const d = b.input & 0x200 ? -2 : b.input & 0x100 ? 2 : b.input & 0x800 ? -0x80 : b.input & 0x400 ? 0x80 : 0;
          if (d && staleSet.has(gi + d)) frontStale++;
        }
      }
      const res = game.nextRound();
      if (res && res.matchOver) game.newMatch({});
    }
  }
  console.log(`${layout.padEnd(9)} stale marks/tick ${(staleSum / ticks).toFixed(2)}  legit ${(legitSum / ticks).toFixed(2)}  ` +
    `no-bomb ticks ${(100 * noBombTicks / ticks).toFixed(1)}%  COM on a stale cell ${(100 * onStale / cpuTicks).toFixed(2)}%  facing one ${(100 * frontStale / cpuTicks).toFixed(2)}%`);
}
