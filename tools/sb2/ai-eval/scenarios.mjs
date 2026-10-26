#!/usr/bin/env node
// Tall-specific AI scenario tests: each one sets up a situation on the 13x25 field where
// a 13x11 assumption makes a COM visibly fail, and checks the original layout too.
//   node tools/sb2/ai-eval/scenarios.mjs [--core DIR]
// Exit code 1 if any scenario fails.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const coreDir = path.resolve(opt('--core', process.env.SB2_CORE || path.resolve(HERE, '../../../public/arcade/sb2/core')));
const imp = (f) => import(pathToFileURL(path.join(coreDir, f)).href);
const { createGame } = await imp('index.js');
const mem = await imp('mem.js');
const ai = await imp('ai.js');

let fails = 0;
const report = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) fails++; };
const cpuGame = (stage, layout, seed, human = false) => createGame({ stage, layout, seed,
  players: [0, 1, 2, 3].map((i) => (human && i === 0 ? { type: 'human' } : { type: 'cpu', level: 5 })),
  rules: { wins: 3, time: 3, comLevel: 5, gbomber: false } });

// 1. Glove aim (C0C66E): a COM holding a bomb only throws at a human in the same 8-px
//    column or row. The original compares y & $F8, which on the tall field also matches a
//    human 256 px (16 rows) above/below: the COM throws sideways at nobody.
for (const layout of ['original', 'tall']) {
  for (const [label, dy, want] of [['same row', 0, 0x200], ['16 rows below', 0x100, 0]]) {
    if (layout === 'original' && dy) continue;            // y never reaches 256 there
    const g = cpuGame(1, layout, 1000, true);
    for (let t = 0; t < 20; t++) g.tick([0, 0, 0, 0]);
    mem.use(g.mem);
    const P = 0x8200, H = 0x8000;                         // COM P3, human P1
    mem.w16(P + 0x52, mem.r16(P + 0x52) | 0x0002);        // holding a bomb
    mem.w16(P + 0xD6, 0x80);                              // hold timer at the level-5 limit
    mem.w16(P + 0x6E, 0);
    mem.w16(0x500 + 0x200, 0); mem.w16(0x502 + 0x200, 0x10); mem.w16(0x504 + 0x200, 0xFFFF);
    mem.w16(P + 0xBE, 0x8000);                            // plan [stand, 16]
    mem.w16(H + 0x10, mem.r16(P + 0x10) - 0x40);          // 4 cells to the left
    mem.w16(H + 0x18, mem.r16(P + 0x18) + dy);
    ai.tick(P);
    const dirs = mem.r16(P + 0x6E) & 0x0F00;
    report(`glove aim, ${layout}, human ${label}`, dirs === want, `throw direction ${dirs.toString(16)} (want ${want.toString(16)})`);
  }
}

// 2. Stage 10 Y-jump (C06852/C06819): the landing y is kept as a byte; on the tall field a
//    jump from below row 16 landed 16 rows higher (COMs jump on their periodic Y press).
for (const layout of ['original', 'tall']) {
  let jumps = 0, bad = 0, low = 0;
  for (let i = 0; i < 4; i++) {
    const g = cpuGame(10, layout, 1000 + 2 * i * 7919 % 60000);
    const start = {};
    for (let t = 0; t < 40000 && !g.finished; t++) {
      for (const e of g.tick([0, 0, 0, 0])) {
        const b = g.state.bombers[e.player];
        if (e.type === 'jump') { jumps++; start[e.player] = [b.cx, b.cy]; if (b.y >= 0x100) low++; }
        if (e.type === 'land' && start[e.player]) {
          const [x0, y0] = start[e.player];
          if (Math.abs(b.cx - x0) + Math.abs(b.cy - y0) > 2) bad++;
        }
      }
    }
  }
  report(`stage 10 jump lands next to take-off, ${layout}`, bad === 0, `${jumps} jumps (${low} from y >= 256), ${bad} landed > 2 cells away`);
}

process.exit(fails ? 1 : 0);
