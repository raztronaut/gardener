#!/usr/bin/env node
// Tick-by-tick WRAM diff of the JS core against the original (wtrace.py traces).
//   node wdiff.mjs <vector> [--ranges lo-hi,...] [--ignore lo-hi,...] [--n 40] [--ticks K]
//                  [--keep]   (keep going after a diverging tick)
//                  [--sync lo-hi,...]         after each tick (and its comparison) copy these
//                                             ranges from the original into the core
//                  [--sync-except lo-hi,...]  ... or copy ALL of WRAM except these ranges:
//                                             isolates one subsystem (e.g. the AI's bytes)
//                  [--from T]                 only report ticks >= T
// Ranges are WRAM offsets in hex (7E:xxxx = 0xxxx, 7F:xxxx = 1xxxx). The default set
// covers the battle logic state; object fields are labelled P1+xx / O5+xx, bombs B3+xx.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTrace } from './wtrace.mjs';
// The core under test: SB2_CORE=<dir> overrides (e.g. a snapshot copy, see snapcore.sh).
const CORE_DIR = process.env.SB2_CORE ? path.resolve(process.env.SB2_CORE) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/arcade/sb2/core');
const { createGame } = await import(path.join(CORE_DIR, 'index.js'));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const C = path.join(ROOT, 'data', 'sb2', 'conformance');
const VEC = path.join(ROOT, 'data', 'sb2', 'vectors');

export const DEFAULT_RANGES = [
  [0x30, 0x31], [0x32, 0x34], [0xB9, 0xBB], [0xBE, 0xC0], [0xD6, 0xD8],
  [0x400, 0x420], [0x500, 0x900], [0x2620, 0x2700], [0x2960, 0x29B0],
  [0x3B48, 0x3BA0], [0x3C48, 0x3CCC], [0x5C00, 0x5F00],
  [0x8000, 0xA000], [0x10000, 0x10200], [0x12000, 0x14800], [0x18000, 0x19000],
  [0x1A000, 0x1A800], [0x1C000, 0x1D000], [0x1D000, 0x1E000]];

export function label(a) {
  if (a >= 0x8000 && a < 0xA000) { const s = (a - 0x8000) >> 8, f = a & 0xFF; return (s < 4 ? 'P' + (s + 1) : 'O' + s) + '+' + f.toString(16).toUpperCase().padStart(2, '0'); }
  if (a >= 0x12000 && a < 0x14800) { const s = (a - 0x12000) >> 8; return 'B' + s + '+' + (a & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
  if (a >= 0x1C000 && a < 0x1E000) { const g = a & 0xFFF; return (a < 0x1D000 ? 'grid' : 'under') + '(' + ((g & 0x7F) >> 1) + ',' + (g >> 7) + ')' + (g & 1 ? 'hi' : ''); }
  if (a >= 0x18000 && a < 0x19000) { const g = a & 0xFFF; return 'danger(' + ((g & 0x7F) >> 1) + ',' + (g >> 7) + ')'; }
  if (a >= 0x1A000 && a < 0x1A800) { const g = a & 0x7FF; return 'tile(' + ((g & 0x3F) >> 1) + ',' + (g >> 6) + ')'; }
  if (a >= 0x10000 && a < 0x10200) return 'burn' + ((a - 0x10000) >> 4) + '+' + (a & 15);
  return (a >= 0x10000 ? '7F:' : '$') + (a & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

const parseR = (s) => s.split(',').map((x) => x.split('-').map((h) => parseInt(h, 16))).map(([a, b]) => [a, b === undefined ? a + 1 : b]);

function main() {
  const a = process.argv.slice(2);
  const name = a[0];
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const ranges = opt('--ranges') ? parseR(opt('--ranges')) : DEFAULT_RANGES;
  const ignore = opt('--ignore') ? parseR(opt('--ignore')) : [];
  const nmax = +opt('--n', 40), tmax = +opt('--ticks', 1e9), keep = a.includes('--keep');
  const sync = opt('--sync') ? parseR(opt('--sync')) : null;
  const syncEx = opt('--sync-except') ? parseR(opt('--sync-except')) : null;
  const from = +opt('--from', 0);
  const start = new Uint8Array(fs.readFileSync(path.join(C, 'start', name + '.wram')));
  const v = JSON.parse(fs.readFileSync(path.join(VEC, name + '.json'), 'utf8'));
  const game = createGame({ wram: start });
  let shown = 0, k = 0, prevTick = start[0x32] | (start[0x33] << 8);
  for (const rec of readTrace(path.join(C, 'wtrace', name + '.bin'), start)) {
    if (k++ >= tmax) break;
    const fr = v.frames[rec.frame];
    // the pads were those of the group's first frame
    let f0 = rec.frame;
    while (f0 > 0 && v.frames[f0 - 1].truth.tick === fr.truth.tick) f0--;
    if (rec.tick < prevTick) { if (!game.nextRound) { console.log('round change: nextRound() missing'); break; } game.nextRound(); }
    else game.tick(v.frames[f0].pads.slice(0, 4).map((p, i) => (v.start.multitap || i < 2 ? p : null)));
    prevTick = rec.tick;
    const diffs = [];
    for (const [lo, hi] of ranges) for (let x = lo; x < hi; x++) {
      if (game.mem[x] !== rec.wram[x] && !ignore.some(([l, h]) => x >= l && x < h)) diffs.push(x);
    }
    if (diffs.length && rec.tick >= from) {
      console.log(`tick ${rec.tick} (frame ${rec.frame}): ${diffs.length} bytes differ`);
      for (const x of diffs.slice(0, nmax)) console.log(`  ${label(x).padEnd(16)} @${x.toString(16).padStart(5, '0')} exp ${rec.wram[x].toString(16).padStart(2, '0')} got ${game.mem[x].toString(16).padStart(2, '0')}`);
      if (!keep || ++shown >= +opt('--shows', 5)) break;
    }
    if (sync) for (const [lo, hi] of sync) game.mem.set(rec.wram.subarray(lo, hi), lo);
    if (syncEx) {
      const keepB = new Map();
      for (const [lo, hi] of syncEx) keepB.set(lo, game.mem.slice(lo, hi));
      game.mem.set(rec.wram);
      for (const [lo, b] of keepB) game.mem.set(b, lo);
    }
  }
}
main();
