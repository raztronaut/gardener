#!/usr/bin/env node
// Round-init conformance: createGame() from scratch vs the original's WRAM right after
// its round init (data/sb2/conformance/init/<name>.wram, from capstages.py), compared
// over the battle-logic ranges (wdiff.mjs DEFAULT_RANGES + the init-only lists).
//   node tools/sb2/conformance/check_init.mjs [--n 20]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const CORE = process.env.SB2_CORE || path.join(ROOT, 'public', 'arcade', 'sb2', 'core');
const { createGame } = await import(path.join(CORE, 'index.js'));
const I = path.join(ROOT, 'data', 'sb2', 'conformance', 'init');

export const RANGES = [[0x30, 0x31], [0x32, 0x34], [0xB9, 0xBB], [0xBE, 0xC0], [0xD6, 0xD8],
  [0x400, 0x420], [0x500, 0x900], [0x2620, 0x2A20], [0x2BF0, 0x2FF0], [0x2FF0, 0x3200],
  [0x3B48, 0x3BA0], [0x3C48, 0x3CCC], [0x3D88, 0x3F88], [0x5C00, 0x5F10],
  [0x8000, 0x10000], [0x10000, 0x10200], [0x10300, 0x10400], [0x10700, 0x10780],
  [0x10B10, 0x10C30], [0x10D10, 0x10E30], [0x12000, 0x14800], [0x18000, 0x1A000],
  [0x1A000, 0x1A800], [0x1B000, 0x1B800], [0x1C000, 0x20000]];
// bomb slots: only the flags word is initialised; the rest is scratch left by graphics
// decompression, never read before a bomb is spawned
// The stage-10 regrow lists ($7F0300/$7F0700) are scratch (scoreboard sprites) on the
// other stages.
let stageId = 0;
const IGNORE = (a) => (a >= 0x12000 && a < 0x14800 && (a & 0xFF) > 1) ||
  (stageId !== 0xB && ((a >= 0x10300 && a < 0x10400) || (a >= 0x10700 && a < 0x10780)));

const SETUPS = {
  com4: (stage) => ({ stage, players: [0, 1, 2, 3].map(() => ({ type: 'cpu' })), rules: { comLevel: 5, wins: 3, time: 2, gbomber: true } }),
  '1p': (stage) => ({ stage, players: [{ type: 'human' }, { type: 'cpu' }, { type: 'cpu' }, { type: 'cpu' }] }),
  mt4: (stage) => ({ stage, players: [0, 1, 2, 3].map(() => ({ type: 'human' })) }),
};

export function diffMem(a, b, n) {
  const out = [];
  stageId = a[0x1A];
  for (const [lo, hi] of RANGES) for (let x = lo; x < hi; x++) if (a[x] !== b[x] && !IGNORE(x)) { out.push(x); }
  return out;
}

const nmax = +(process.argv[process.argv.indexOf('--n') + 1] || 12);
let ok = 0, total = 0;
for (const f of fs.readdirSync(I).filter((f) => /^(com4|1p|mt4)_stage\d\d\.wram$/.test(f)).sort()) {
  const [kind, st] = f.replace('.wram', '').split('_stage');
  const exp = new Uint8Array(fs.readFileSync(path.join(I, f)));
  const g = createGame({ ...SETUPS[kind](+st), seed: 0 });
  const d = diffMem(exp, g.mem);
  total++; if (!d.length) ok++;
  console.log(`${d.length ? 'FAIL' : 'PASS'}  ${f.padEnd(20)} ${d.length} bytes differ` +
    (d.length ? ': ' + d.slice(0, nmax).map((x) => `${x.toString(16)} exp ${exp[x].toString(16)} got ${g.mem[x].toString(16)}`).join(', ') : ''));
}
console.log(`${ok}/${total} round inits match`);

// Round 2 of cpu_round: the original's WRAM after the last tick of round 1 (wtrace) ->
// nextRound() vs the original right after its round-2 init (capinit.py cpu_round 4010 4110).
{
  const { readTrace } = await import('./wtrace.mjs');
  const C = path.join(ROOT, 'data', 'sb2', 'conformance');
  const tp = path.join(C, 'wtrace', 'cpu_round.bin');
  const ip = path.join(I, 'cpu_round_r2_init.wram');
  if (fs.existsSync(tp) && fs.existsSync(ip)) {
    let last = null;
    for (const rec of readTrace(tp, new Uint8Array(fs.readFileSync(path.join(C, 'start', 'cpu_round.wram'))))) {
      if (rec.frame > 3613) break;
      last = rec.wram.slice();     // the round's last tick (incl. the battle-loop exit)
    }
    const exp = new Uint8Array(fs.readFileSync(ip));
    const g = createGame({ wram: last });
    const res = g.nextRound();
    const d = diffMem(exp, g.mem);
    total++; if (!d.length) ok++;
    console.log(`${d.length ? 'FAIL' : 'PASS'}  cpu_round round 2   ${d.length} bytes differ (winner ${res && res.winner})` +
      (d.length ? ': ' + d.slice(0, nmax).map((x) => `${x.toString(16)} exp ${exp[x].toString(16)} got ${g.mem[x].toString(16)}`).join(', ') : ''));
    console.log(`${ok}/${total} round inits match`);
  }
}
