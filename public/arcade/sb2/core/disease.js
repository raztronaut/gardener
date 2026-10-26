// Diseases: per-bomber effects (C03686: blink schedule, stats restored once cured),
// contagion between bombers sharing a cell (C005EA), the HUD "sick face" timers (C00617).
import { r8, r16, w8, w16, OBJ } from './mem.js';
import * as move from './move.js';
import { emit } from './events.js';

// blink schedule $C5EE5D: (bit 15 = hidden, low bits = ticks) pairs, $FFFF = restart
const BLINK = [0x8001, 0x0001, 0x8001, 0x0001, 0x8001, 0x0001, 0x8001, 0x0001, 0x8001, 0x0001,
  0x8002, 0x0002, 0x8002, 0x0002, 0x8002, 0x0002, 0x8002, 0x0002, 0x8002, 0x0002,
  0x8002, 0x0004, 0x8002, 0x0004, 0x8003, 0x0006, 0x8003, 0x0006,
  0x8004, 0x0008, 0x8004, 0x0008, 0x8004, 0x0008,
  0x8006, 0x000A, 0x8006, 0x000A, 0x8006, 0x000A, 0x8006, 0x000A, 0x80C0];

export function perBomber(p) {           // C03686
  if (!(r16(p) & 0x8000)) return;
  const d = r8(p + 0xF5);
  if (d) {
    if (d === 1) blink(p);               // C0362B
    w16(p + 4, r16(p + 4) | 0x0080);
    return;
  }
  const f4 = r16(p + 4);
  if (!(f4 & 0x0080)) return;
  w16(p + 4, f4 & 0xFF3F);               // cured: restore the current stats
  w8(p + 0xF0, r8(p + 0xE0));
  w8(p + 0xF2, r8(p + 0xE2));
  w8(p + 0xF1, (r8(p + 0xE1) - r8(p + 0xF8)) & 0xFF);
}

function blink(p) {                      // C0362B
  let c = r16(p + 0xFC);
  if (c) {
    c = (c - 1) & 0xFFFF;
    if (c) { w16(p + 0xFC, c); return; }
  }
  for (;;) {
    const i = r8(p + 0xF9);
    w8(p + 0xF9, (i + 1) & 0xFF);
    const v = BLINK[(i * 2 & 0xFF) >> 1];
    if (v === undefined || v === 0xFFFF) { w8(p + 0xF9, 0); continue; }
    w16(p + 0xFC, v & 0x7FFF);
    w16(p + 4, r16(p + 4) & 0xFFBF);
    if (v & 0x8000) w16(p + 4, r16(p + 4) | 0x0040);
    return;
  }
}

// C001EE: stats after a disease swap
export function rederive(p) {
  w8(p + 0xF9, 0);
  w16(p + 0xFC, 0);
  w16(p + 4, r16(p + 4) & 0xFFBF);
  const d = r8(p + 0xF5);
  if (d === 1 || d === 4) {
    w8(p + 0xF2, r8(p + 0xE2));
    w8(p + 0xF1, (r8(p + 0xE1) - r8(p + 0xF8)) & 0xFF);
  } else if (d === 5) { /* quirk: stats not refreshed */ }
  else if (d === 3) w8(p + 0xF1, 0);
  else if (d === 6) {
    w8(p + 0xF1, r8(p + 0xF8) ? 0 : 1);
    w8(p + 0xF2, 0);
  }
  w8(p + 0xF0, 0);
  if (d === 5) { /* slow: level 0 */ }
  else if (d === 4) w8(p + 0xF0, 6);
  else w8(p + 0xF0, r8(p + 0xE0));
  move.inputVelocity?.(p);               // C0C2CE
}

// ---- contagion (C005EA -> C002AB / C00445 / C0055A) ---------------------------------
function pair(a, b, bit) {
  const pa = OBJ + a * 0x100, pb = OBJ + b * 0x100;
  if (r16(pb) & 0x0800) return;          // (the latch is NOT cleared in these two cases)
  if (r16(pb + 0x52) & 0x0001) return;
  if (r16(pa + 0xA8) !== r16(pb + 0xA8)) { w16(0x5C5E, r16(0x5C5E) & ~bit & 0xFFFF); return; }
  if (r16(0x5C5E) & bit) return;
  w16(0x5C5E, r16(0x5C5E) | bit);
  let t = r8(pa + 0xF5); w8(pa + 0xF5, r8(pb + 0xF5)); w8(pb + 0xF5, t);
  t = r8(pa + 0xE9); w8(pa + 0xE9, r8(pb + 0xE9)); w8(pb + 0xE9, t);
  rederive(pa);
  rederive(pb);
  emit('diseaseSwap', { a, b });
}

export function contagion() {            // C005EA
  if (!(r16(0xB9) & 0x8000)) return;
  if (!(r16(OBJ) & 0x0800)) {            // C002AB
    if (!(r16(OBJ + 0x52) & 1)) { pair(0, 1, 0x01); pair(0, 2, 0x02); pair(0, 3, 0x04); }
  }
  if (!(r16(OBJ + 0x100) & 0x0800)) {    // C00445
    if (!(r16(OBJ + 0x152) & 1)) { pair(1, 2, 0x08); pair(1, 3, 0x10); }
  }
  if (!(r16(OBJ + 0x200) & 0x0800)) {    // C0055A
    if (!(r16(OBJ + 0x252) & 1)) pair(2, 3, 0x20);
  }
}

// ---- C00617: HUD sick-face timers (odd ticks). Only the $5C60.. counters are kept; the
// palette uploads (C0101C / C01037 / C00676 / C00691 ...) are display-only.
export function visuals() {
  if (!(r16(0x32) & 1)) return;
  const t = r16(0x5C62);
  if (t) w16(0x5C62, t - 1);
  else {
    w16(0x5C62, 1);
    w16(0x5C60, r16(0x5C60) ^ 0x0010);
  }
  face(0, 0x0800, 0x5C64, 0x0008);       // C006B7
  if (r16(0xB9) & 0x8000) {
    face(1, 0x0400, 0x5C66, 0x0004);     // C0076B
    face(2, 0x0200, 0x5C68, 0x0002);     // C0081D
    face(3, 0x0100, 0x5C6A, 0x0001);     // C008CF
  }
}

function face(slot, onBit, timer, toggle) {
  const p = OBJ + slot * 0x100;
  if (!r8(p + 0xF5)) {
    w16(0x5C60, r16(0x5C60) | onBit);    // (palette restored once: display only)
    return;
  }
  w16(0x5C60, r16(0x5C60) & ~onBit & 0xFFFF);
  const t = r16(timer);
  if (t) { w16(timer, t - 1); return; }
  w16(timer, 3);
  w16(0x5C60, r16(0x5C60) ^ toggle);
}
