#!/usr/bin/env node
// Per-call oracle for the COM AI: replays every AI call recorded by aisnap.py (the
// original's WRAM just before C0C54B ran for a bomber, and just after it returned) through
// ai.tick() and compares all of the recorded regions (zero-page scratch $40-$9F included).
//   python3 aisnap.py <vector> 0 99999 ; node aicheck.mjs /tmp/sb2/aisnap_<vector>.bin [N]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { use } from '../../../public/arcade/sb2/core/mem.js';
import { tick as aiTick } from '../../../public/arcade/sb2/core/ai.js';
const REG = [[0, 0xA00], [0x5C00, 0x5F10], [0x8000, 0x8400], [0x18000, 0x19000], [0x1C000, 0x1D000]];
const L = REG.reduce((a, [x, y]) => a + y - x, 0);
function label(a) {
  if (a >= 0x8000 && a < 0xA000) { const s = (a - 0x8000) >> 8, f = a & 0xFF; return (s < 4 ? 'P' + (s + 1) : 'O' + s) + '+' + f.toString(16).toUpperCase().padStart(2, '0'); }
  if (a >= 0x12000 && a < 0x14800) { const s = (a - 0x12000) >> 8; return 'B' + s + '+' + (a & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
  if (a >= 0x1C000 && a < 0x1E000) { const g = a & 0xFFF; return (a < 0x1D000 ? 'grid' : 'under') + '(' + ((g & 0x7F) >> 1) + ',' + (g >> 7) + ')' + (g & 1 ? 'hi' : ''); }
  if (a >= 0x18000 && a < 0x19000) { const g = a & 0xFFF; return 'danger(' + ((g & 0x7F) >> 1) + ',' + (g >> 7) + ')'; }
  if (a >= 0x1A000 && a < 0x1A800) { const g = a & 0x7FF; return 'tile(' + ((g & 0x3F) >> 1) + ',' + (g >> 6) + ')'; }
  if (a >= 0x10000 && a < 0x10200) return 'burn' + ((a - 0x10000) >> 4) + '+' + (a & 15);
  return (a >= 0x10000 ? '7F:' : '$') + (a & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

const buf = fs.readFileSync(process.argv[2]);
let ok = 0, bad = 0;
const unpack = (b, o) => { const m = new Uint8Array(0x20000); let k = o; for (const [x, y] of REG) { m.set(b.subarray(k, k + y - x), x); k += y - x; } return m; };
for (let off = 0; off < buf.length;) {
  const t = buf.readUInt32LE(off), s = buf.readUInt32LE(off + 4), n = buf.readUInt32LE(off + 8);
  const raw = zlib.inflateSync(buf.subarray(off + 12, off + 12 + n)); off += 12 + n;
  const before = unpack(raw, 0), after = unpack(raw, L);
  use(before);
  aiTick(0x8000 + s * 0x100);
  const d = [];
  for (const [x0, y0] of REG) for (let x = (Math.max(x0, 0x40)); x < y0; x++) if (x < 0x300 && (x < 0x40 || x > 0x9F)) continue; else if (before[x] !== after[x]) d.push(x);
  if (d.length) { bad++; if (bad <= +(process.argv[3] || 5)) { console.log(`tick ${t} slot ${s}: ${d.length} differ`); for (const x of d.slice(0, 16)) console.log(`  ${label(x).padEnd(14)} exp ${after[x].toString(16)} got ${before[x].toString(16)}`); } }
  else ok++;
}
console.log(`ok ${ok} bad ${bad}`);
