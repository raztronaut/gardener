// Object animation: C0224A (pick/restart the animation), C0A120 (+0C timer),
// C0249D (script interpreter), C021B0/C021DC (script lookup).
//
// Fields: +0C frame timer ($0FFF = script ended / frozen), +0E flags (b0 "new frame",
// b12 moving, b13 restart, b14 idle anim latched; b8/b10 are the Y / A button edge
// latches used by the button code), +4F call depth, +40.. call stack, +59 loop depth,
// +5A.. loop counters, +50 anim set, +6A anim id (facing code 2/4/8/$10, $1E death …),
// +6C last direction bits, +70..+72 script pointer, +76..+78 script table,
// +79..+7B pose pointer (the sprite frame to draw: the renderer's frame id).
// Logic depends on this: the end of the death animation removes the bomber and
// scatters its items (C0A7FA), busy states wait for +0C == $0FFF (C0A834).
import { r8, r16, w8, w16 } from './mem.js';
import { SETS, ENTRY, OPS } from './animdata.js';

const r24 = (a) => r8(a) | (r8(a + 1) << 8) | (r8(a + 2) << 16);
const w24 = (a, v) => { w8(a, v & 0xFF); w8(a + 1, (v >> 8) & 0xFF); w8(a + 2, (v >> 16) & 0xFF); };

export function start(p) {              // C021B0 + C021DC
  const set = r16(p + 0x50);
  const [base, offt] = SETS[set] || SETS[0];
  w24(p + 0x76, base);
  let k = r16(p + 0x6A);
  if (r16(p + 0x6E) & 0x0F00) k += 0x20;
  const sp = (ENTRY[set] || ENTRY[0])[k >> 1];
  if (sp === undefined) throw new Error('anim: no entry for set ' + set + ' anim ' + k);
  w24(p + 0x70, sp);
  w16(p + 0x0C, 0);
}

export function flags(p) {              // C0224A
  if (!(r16(p) & 0x8000)) return;
  const e = r16(p + 0x0E);
  if (!(e & 0x1000)) {                  // C0227A: not moving
    if (e & 0x4000) { w16(p + 0x0E, e & 0xDFFF); return; }
    w16(p + 0x0E, e | 0x6000);
    start(p);
    w16(p + 0x6C, 0);
    return;
  }
  if ((e & 0x2000) || r16(p + 0x0C) === 0x0FFF) start(p);
}

export function timer(p) {              // C0A120
  if (!(r16(p) & 0x8000)) return;
  let t = r16(p + 0x0C);
  if (t !== 0) {
    if (t === 0x0FFF) return;
    t = (t - 1) & 0xFFFF;
    w16(p + 0x0C, t);
    if (t !== 0) return;
  }
  w16(p + 0x0E, r16(p + 0x0E) | 1);
  step(p);
}

export function step(p) {               // C0249D
  let a = r24(p + 0x70);
  for (let guard = 0; guard < 256; guard++) {
    const op = OPS[a];
    if (!op) throw new Error('anim: no script op at $' + a.toString(16));
    switch (op[0]) {
      case 'pose': w24(p + 0x79, op[1]); a += 4; break;
      case 'wait': w16(p + 0x0C, op[1]); a += 2; w24(p + 0x70, a); return;
      case 'nop': a += 2; break;
      case 'vel': {                     // C0255A
        const x = op[1];
        if (x & 0x0800) w16(p + 4, r16(p + 4) | 0x0800);
        if (!(x & 0x0400)) {            // C025DC
          w16(p + 0x1E, (x & 7) << 13);
          w16(p + 0x1C, (x & 0x18) >> 3);
          w16(p + 0x16, (x & 0xE0) << 8);
          w16(p + 0x14, (x & 0x300) >> 8);
        } else throw new Error('anim: table velocity command not implemented');
        a += 2; break;
      }
      case 'jump': a = op[1]; break;
      case 'call': {                    // C02679
        const d = r8(p + 0x4F);
        if (d >= 5) { a += 5; break; }
        w24(p + 0x40 + 3 * (d & 0xF), (a & 0xFF0000) | ((a + 5) & 0xFFFF));
        w8(p + 0x4F, d + 1);
        a = op[1]; break;
      }
      case 'ret': {                     // C026DB
        const d = (r8(p + 0x4F) - 1) & 0xFF;
        w8(p + 0x4F, d);
        a = r24(p + 0x40 + 3 * (d & 0xF)); break;
      }
      case 'loop': {                    // C02709
        const k = r8(p + 0x59);
        if (k >= 3) { a += 2; break; }
        w16(p + 0x5A + 2 * (k & 0xF), op[1]);
        a += 2;
        w24(p + 0x50 + 3 * (k & 0xF), a);
        w8(p + 0x59, k + 1); break;
      }
      case 'next': {                    // C0276F
        const k = ((r8(p + 0x59) & 0xF) - 1) & 0xFFFF;
        const ca = p + 0x5A + ((k << 1) & 0xFFFF);
        let c = r16(ca);
        if (!(c & 0x8000)) {
          c = (c - 1) & 0xFFFF; w16(ca, c);
          if (c === 0) { a += 2; w8(p + 0x59, r8(p + 0x59) - 1); break; }
        }
        a = r24(p + 0x50 + 3 * k); break;
      }
      case 'set':                       // C027CF
        if (op[1]) { op[1].forEach((v, i) => w16(p + 0x60 + 2 * i, v)); a += 12; } else a += 2;
        break;
      case 'stop': return;              // C024FA / C02820: RTL, +70 unchanged
      default: throw new Error('anim: bad op ' + op[0] + ' at $' + a.toString(16));
    }
  }
  throw new Error('anim: runaway script');
}
