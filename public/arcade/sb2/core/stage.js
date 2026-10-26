// Stage gimmick dispatch. The original dispatches through per-stage tables; each
// handler is implemented in a per-stage module (stage2.js .. stage10.js) and exported
// under its ROM address (e.g. `export function C04D33(p)`), so this file only routes:
//   per tick         C036E6  table $C03707 by stage id $1A
//   per object       C05741  table $C5EB7F by $1A
//   cell under it    C04337  underlay type 9 -> C04468, $11 -> C04DE1, else table
//                            $C5EBBF by the grid cell type (low 6 bits)
//   Y button         C065F1
//   stage-10 regrow  C0D8E8
//   tile animations  C1334B
//   ice input        C0C09E  (stage 2, from movement C0C01C)
//   push block       C0ACD4  (stage 2, from the movement handlers)
import { r16 } from './mem.js';
import * as s2 from './stage2.js';
import * as s3 from './stage3.js';
import * as s4 from './stage4.js';
import * as s5 from './stage5.js';
import * as s6 from './stage6.js';
import * as s7 from './stage7.js';
import * as s8 from './stage8.js';
import * as s9 from './stage9.js';
import * as s10 from './stage10.js';

const H = {};
for (const m of [s2, s3, s4, s5, s6, s7, s8, s9, s10]) for (const k in m) if (/^C[0-9A-F]{5}$/.test(k)) H[k] = m[k];
const call = (addr, p) => { const f = H[addr]; if (f) f(p); };

// $C03707: per-tick handler by $1A (stage ids 0,1,2,5,6,7,8,9,$A,$B = stages 1..10)
const PER_TICK = { 2: 'C0426E', 4: 'C0384C', 5: 'C03A89', 6: 'C03748', 7: 'C04206', 9: 'C0406E', 0xA: 'C03EB6' };
// $C5EB7F: per-object handler by $1A
const PER_OBJ = { 1: 'C05763', 2: 'C05A59', 3: 'C05A73', 4: 'C05F97', 6: 'C06302', 7: 'C06307', 8: 'C06321', 9: 'C06376', 0xA: 'C06567' };
// $C5EBBF: handler by the type of the cell under the object (others: no-op)
const CELL = {
  0x09: 'C04468', 0x0B: 'C04623', 0x0C: 'C046E3', 0x0F: 'C04C66', 0x10: 'C04D33', 0x11: 'C04DE1',
  0x12: 'C05288', 0x13: 'C052B6', 0x15: 'C052E5', 0x16: 'C0538B', 0x17: 'C053E1', 0x18: 'C05461',
  0x19: 'C054E1', 0x1A: 'C05561', 0x1B: 'C055E1', 0x1C: 'C05639', 0x1D: 'C05691', 0x1E: 'C056E9',
};

export function perTick() {             // C036E6
  const a = PER_TICK[r16(0x1A)];
  if (a) call(a);
}

export function perBomber(p) {          // C05741
  const a = PER_OBJ[r16(0x1A)];
  if (a) call(a, p);
}

export function cellHandler(p) {        // C04337
  const idx = r16(p + 0xA8);
  const u = r16(0x1D000 + idx) & 0x3F;
  if (u === 0x09) return call('C04468', p);
  if (u === 0x11) return call('C04DE1', p);
  const a = CELL[r16(0x1C000 + idx) & 0x3F];
  if (a) call(a, p);
}

export function yButton(p) {            // C065F1
  const st = r16(0x1A);
  if (r16(0x1C6E)) { if (st === 2 || st === 1) return; }
  else if (st !== 0xB) return;
  call('C06616', p);
  call('C06658', p);
}

export function regrow() { call('C0D8E8'); }   // stage table $C5E2A6: only stage 10
export function anim() { call('C1334B'); }
export function iceInput(p) { call('C0C09E', p); }
export function pushBlock(p) { call('C0ACD4', p); }
