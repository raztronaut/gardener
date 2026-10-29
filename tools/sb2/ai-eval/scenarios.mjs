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

// 3. Stage 8 belt bombs (C088CC snap): a conveyed bomb that stops is snapped to its cell
//    with y AND #$F0; on the tall field a bomb below row 16 jumped 16 rows up (even into
//    the border), where the COMs' danger marks and escapes no longer match the real bomb.
for (const layout of ['original', 'tall']) {
  let jumps = 0, n = 0;
  for (let i = 0; i < 12; i++) {
    const g = cpuGame(8, layout, 1000 + 2 * i * 7919 % 60000);
    let prev = new Map();
    for (let t = 0; t < 40000 && !g.finished; t++) {
      g.tick([0, 0, 0, 0]);
      const s = g.state, cur = new Map();
      for (const b of s.bombs) if (!b.moving) cur.set(b.slot, [b.cx, b.cy]);
      for (const m of s.movers) if (m.kind === 'bomb' && m.bomb != null) cur.set(m.bomb, [(m.x + 8) >> 4, (m.y + 23) >> 4]);
      // (a thrown bomb wrapping over the border comes from outside the field: not counted)
      const last = layout === 'tall' ? 28 : 14;
      for (const [k, [x, y]] of cur) { const p = prev.get(k); if (!p) continue; n++; if (p[1] >= 4 && p[1] <= last && Math.abs(y - p[1]) > 2) jumps++; }
      prev = cur;
    }
  }
  report(`stage 8 bombs never jump rows, ${layout}`, jumps === 0, `${n} bomb-ticks, ${jumps} vertical jumps > 2 cells`);
}

// 4. COM ★ on stage 10: its start pocket (2,4)..(4,4), (2,5)..(2,8), (3,8) is closed by rocks;
//    the only way out is the Y jump (over / through rocks and soft blocks). It must leave
//    within 25 s and stay alive meanwhile (it used to sit there: idle 90 %, sealed 70 %).
for (const layout of ['original', 'tall']) {
  const pocket = new Set(['2,4', '3,4', '4,4', '2,5', '2,6', '2,7', '2,8', '3,8']);
  let out = 0, dead = 0, jumps = 0;
  for (let i = 0; i < 3; i++) {
    const g = createGame({ stage: 10, layout, seed: 1000 + 2 * i * 7919 % 60000,
      players: [0, 1, 2, 3].map((k) => ({ type: 'cpu', level: k === 0 ? 10 : 5 })), rules: { wins: 3, time: 3, comLevel: 5, gbomber: false } });
    let left = false;
    for (let t = 0; t < 1500 && !left; t++) {
      for (const e of g.tick([0, 0, 0, 0])) { if (e.type === 'jump' && e.player === 0) jumps++; if (e.type === 'died' && e.player === 0) dead++; }
      const b = g.state.bombers[0];
      if (!b.jumping && !b.hopping && !pocket.has(b.cx + ',' + b.cy)) left = true;
    }
    if (left) out++;
  }
  report(`★ leaves its stage-10 start pocket, ${layout}`, out === 3 && dead === 0, `${out}/3 games out within 25 s, ${jumps} jumps, ${dead} deaths`);
}

process.exit(fails ? 1 : 0);
