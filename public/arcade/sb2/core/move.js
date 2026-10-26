// Movement (C0A474) — input -> velocity, 16.16 integration, the collision handlers with
// their corner slides (C0A98E dispatch, C0AED4 R / C0B2DE L / C0B40C D / C0B854 U and
// the diagonals), the death check (C0A5C9/C0A675), the shield flicker (C0A570), the
// time-up kill (C0A6FD), the end of the death animation (C0A7FA). SPEC §4, §12.
//
// Object fields used (offsets into the 0x100-byte object): +00 flags (b15 active,
// b11 dying, b0/b1 X/Y velocity negative, b2/b3 accel negative, b6/b7 max-speed check),
// +10/+12 x int/frac, +14/+16 vx, +18/+1A y, +1C/+1E vy, +20/+22 and +30/+32 conveyor
// velocity (+28 its direction bits), +24/+26 and +2C/+2E accelerations, +34/+36 and
// +3C/+3E max speeds, +5C wanted facing, +5E facing (2 R, 4 L, 8 D, $10 U), +6A anim id,
// +6E input (SNES bits), +A0..+A6 current speed, +A8 grid index, +AA tile index,
// +B0..+B3 corner probes, +B4 cell type under the centre, +B5..+B8 front probes,
// +F0 speed level, +FA bomb-pass, +FB wall-pass.
import { r8, r16, w8, w16, OBJ_LIST } from './mem.js';
import * as items from './items.js';
import * as movers from './movers.js';
import * as stage from './stage.js';
import { emit } from './events.js';
import { parkY } from './geom.js';

// Speed table $C5FB07: [int, frac] per level (SPEC §3)
export const SPEED = [[0, 0x8000], [1, 0x4000], [1, 0x8000], [2, 0], [2, 0x8000], [2, 0xC000],
  [3, 0], [0, 0xD000], [0, 0], [0, 0x6000], [3, 0x8000]];

const G = (a) => r16(a);
// ---- grid lookups -------------------------------------------------------------------
export let lastIdx = 0;                 // the X register after C0BFE2 (grid index)

export function gridAt(x, y) {          // C0BFE2: cell word at pixel (x, y); sets lastIdx
  w16(0x4C, y & 0xFFFF); w16(0x4A, x & 0xFFFF);
  let idx = ((((y + r16(0x5EFB)) & 0x3F0) << 3) + ((((x + r16(0x5F01)) & 0x3F0)) >> 3)) & 0xFFFF;
  if ((idx & 0x7F) >= 0x40) idx &= 0xFFBF;
  idx &= 0x0FFF;
  w16(0x4E, idx);
  lastIdx = idx;
  return r16(0x1C000 + idx);
}

function tileIndexAt(x, y) {            // C0A515
  const ty = (r16(0x5EFB) + y) & 0x3F0, tx = (r16(0x5F01) + x) & 0x3F0;
  return (((ty & 0x1F0) << 2) + ((tx & 0x1F0) >> 3)) & 0x7FF;
}

export function centreCell(p) {         // C0BEA6: +B4 = cell under the centre, +A8 / +3A
  let v = gridAt(r16(p + 0x10), r16(p + 0x18));
  const idx = lastIdx;
  if (v === 0xC2 && r8(p + 0xFB)) v = 0x40;
  w16(0x5E, v);                         // C0BEB8 / C0BECD: scratch $5E
  w8(p + 0xB4, v & 0xFF);
  if (r16(0x1C78)) w8(p + 0xB4, 0x41);  // debug "invincible" switch (always 0)
  if (idx !== r16(p + 0xA8)) w16(p + 0x3A, r16(p + 0xA8));
  w16(p + 0xA8, idx);
}

export function cellLookup(p) {         // C0A4F7
  w16(p + 0xAA, tileIndexAt(r16(p + 0x10), r16(p + 0x18)));
  centreCell(p);
}

// probe helper: the byte stored for a corner/front probe (soft = passable for wall-pass)
function probe(p, x, y) {
  let v = gridAt(x, y);
  if (v === 0xC2 && r8(p + 0xFB)) v = 0x40;
  return v;
}
const probeB0 = (p) => w8(p + 0xB0, probe(p, r16(p + 0x10) + 7, r16(p + 0x18) + 8));      // C0BEFE
const probeB1 = (p) => w8(p + 0xB1, probe(p, r16(p + 0x10) + 7, r16(p + 0x18) - 7));      // C0BF37
const probeB2 = (p) => w8(p + 0xB2, probe(p, r16(p + 0x10) - 8, r16(p + 0x18) - 7));      // C0BF70
const probeB3 = (p) => w8(p + 0xB3, probe(p, r16(p + 0x10) - 8, r16(p + 0x18) + 8));      // C0BFA9

// front probes from the dispatch copies $5BF8 (x) / $5BFA (y); store $5BF6, $5C02, +B5..
function front(p, dx, dy, field) {
  const x = (r16(0x5BF8) + dx) & 0xFFFF, y = (r16(0x5BFA) + dy) & 0xFFFF;
  w16(0x5BF6, dx ? x : y);
  const v = probe(p, x, y);
  w16(0x5C02, v);
  w8(p + field, v & 0xFF);
  return v;
}
const frontR = (p) => front(p, 7, 0, 0xB5);      // C0AE99
const frontL = (p) => front(p, -8, 0, 0xB6);     // C0B2A3
const frontD = (p) => front(p, 0, 8, 0xB8);      // C0B3D1
const frontU = (p) => front(p, 0, -7, 0xB7);     // C0B819

// ---- velocity helpers ---------------------------------------------------------------
export function zeroX(p) { w16(p + 0x14, 0); w16(p + 0x16, 0); w16(p + 0x24, 0); w16(p + 0x26, 0); } // C0AF7F / C08D3A
export function zeroY(p) { w16(p + 0x1C, 0); w16(p + 0x1E, 0); w16(p + 0x2C, 0); w16(p + 0x2E, 0); } // C0AF97 / C08D52
export function zeroXY(p) { zeroX(p); zeroY(p); }                                                 // C0AF76
export function restoreX(p) { w16(p + 0x12, r16(0x5C2A)); w16(p + 0x10, r16(0x5C2C)); }           // C0B951
export function restoreY(p) { w16(p + 0x1A, r16(0x5C2E)); w16(p + 0x18, r16(0x5C30)); }           // C0B968
export function undoX(p) { zeroX(p); restoreX(p); }                                               // C0B94D
export function undoY(p) { zeroY(p); restoreY(p); }                                               // C0B964

export function cellCentre(idx) {       // C0EE1C -> [x, y] ($42, $44)
  const x = (((idx & 0x7F) << 3) - r16(0x5F01) + 8) & 0x1FF;
  const y = ((((idx & 0xF80) >> 3) - r16(0x5EFB)) + 7) & 0x1FF;
  w16(0x40, idx); w16(0x42, x); w16(0x44, y);
  return [x, y];
}

export function snapToCell(p) {         // C1C6CE
  zeroY(p); zeroX(p);
  const [x, y] = cellCentre(r16(p + 0xA8));
  w16(p + 0x10, x);
  w16(p + 0x18, y);
}

export function savePos(p) {            // C0C055
  w16(0x5C2C, r16(p + 0x10)); w16(0x5C2A, r16(p + 0x12));
  w16(0x5C34, r16(p + 0x14)); w16(0x5C32, r16(p + 0x16));
  w16(0x5C30, r16(p + 0x18)); w16(0x5C2E, r16(p + 0x1A));
  w16(0x5C38, r16(p + 0x1C)); w16(0x5C36, r16(p + 0x1E));
}

export function motionDir(p) {          // C0A8D3 -> $5BFC
  let a = 0, b = 0;
  if (r16(p + 0x14) | r16(p + 0x16)) a = (r16(p) & 1) ? 0x200 : 0x100;
  if (r16(p + 0x1C) | r16(p + 0x1E)) b = (r16(p) & 2) ? 0x800 : 0x400;
  w16(0x40, a); w16(0x42, b);
  let d = a | b;
  if (!d) d = r16(p + 0x6E) & 0x0F00;
  w16(0x5BFC, d);
  return d;
}

// ---- input -> velocity --------------------------------------------------------------
export function speedFromLevel(p) {     // C0C290 (battle)
  const [i, f] = SPEED[r8(p + 0xF0)] || [0, 0];
  w16(p + 0xA0, i); w16(p + 0xA4, i);
  w16(p + 0xA2, f); w16(p + 0xA6, f);
}

export function inputVelocity(p) {      // C0C2CE
  if (r16(0x1A) === 1) return;
  speedFromLevel(p);
  if (r16(p + 0x60) & 1) w16(p + 0x6E, r16(0x5D80) & r16(p + 0x6E));
  const inp = r16(p + 0x6E);
  w16(0x4A, inp);
  if (inp & 0x0C00) { w16(p + 0x1C, r16(p + 0xA0)); w16(p + 0x1E, r16(p + 0xA2)); }
  else { w16(p + 0x1C, 0); w16(p + 0x1E, 0); }
  if (inp & 0x0300) { w16(p + 0x14, r16(p + 0xA4)); w16(p + 0x16, r16(p + 0xA6)); }
  else { w16(p + 0x14, 0); w16(p + 0x16, 0); }
  conveyorVelocity(p);
}

// C0C34D: add the conveyor velocity (+20/+22 x, +30/+32 y; +28 = its direction bits)
// to the walking velocity (sign-magnitude, sign in +00 b0 / b1).
function conveyorVelocity(p) {
  if (r16(p + 0x20) | r16(p + 0x22)) conveyAxis(p, 0x14, 0x20, 1, (r16(p) & 1) ? 0x200 : 0x100);
  if (r16(p + 0x30) | r16(p + 0x32)) conveyAxis(p, 0x1C, 0x30, 2, (r16(p) & 2) ? 0x800 : 0x400);
}
function conveyAxis(p, v, c, signBit, sameDir) {   // C0C468 / C0C4D9 / C0C388 / C0C3F8
  if (r16(p + 0x28) & sameDir) {        // conveyor pushes the way we move: add magnitudes
    const f = r16(p + c + 2) + r16(p + v + 2);
    w16(p + v + 2, f);
    w16(p + v, r16(p + c) + r16(p + v) + (f > 0xFFFF ? 1 : 0));
    return;
  }
  let f = r16(p + v + 2) - r16(p + c + 2);
  let i = r16(p + v) - r16(p + c) - (f < 0 ? 1 : 0);
  if (i & 0x8000 ? true : i < 0) {      // magnitude went negative: flip the sign
    w16(p, r16(p) ^ signBit);
    f = r16(p + c + 2) - r16(p + v + 2);
    i = r16(p + c) - r16(p + v) - (f < 0 ? 1 : 0);
  }
  w16(0x40, f); w16(0x42, i);
  w16(p + v + 2, f); w16(p + v, i);
}

function inputMove(p) {                 // C0C01C
  if ((r16(p + 0x7E) & 0xFF00) && !(r16(p + 2) & 0x0200)) return;
  if (r16(p + 2) & 0x8000) return;
  savePos(p);
  const st = r16(0x1A);
  if (st === 2) return;                 // stage 3 moves through its own pair code
  if (st === 1) { stage.iceInput?.(p); return; }   // C0C09E (stage 2 ice)
  inputVelocity(p);
}

// ---- integration --------------------------------------------------------------------
function addPair(p, iOff, fOff, di, df) {
  const f = r16(p + fOff) + df;
  w16(p + fOff, f);
  w16(p + iOff, r16(p + iOff) + di + (f > 0xFFFF ? 1 : 0));
}
function subPair(p, iOff, fOff, di, df) {   // returns carry (no borrow)
  const f = r16(p + fOff) - df;
  w16(p + fOff, f);
  const i = r16(p + iOff) - di - (f < 0 ? 1 : 0);
  w16(p + iOff, i);
  return i >= 0;
}

function accelerate(p) {                // C0A2B8
  if (r16(p + 0x24) | r16(p + 0x26)) {  // C0A329
    if (!(r16(p) & 4)) addPair(p, 0x14, 0x16, r16(p + 0x24), r16(p + 0x26));
    else if (!subPair(p, 0x14, 0x16, r16(p + 0x24), r16(p + 0x26))) {
      w16(p + 0x14, 0); w16(p + 0x16, 0); w16(p, r16(p) ^ 0x0005);
    }
  }
  if (r16(p + 0x2C) | r16(p + 0x2E)) {
    if (!(r16(p) & 8)) addPair(p, 0x1C, 0x1E, r16(p + 0x2C), r16(p + 0x2E));
    else if (!subPair(p, 0x1C, 0x1E, r16(p + 0x2C), r16(p + 0x2E))) {
      w16(p + 0x1C, 0); w16(p + 0x1E, 0); w16(p, r16(p) ^ 0x000A);
    }
  }
}

function integrate(p) {                 // C0A380
  if (r16(p + 0x14) | r16(p + 0x16)) {  // C0A3E0
    if (!(r16(p) & 1)) addPair(p, 0x10, 0x12, r16(p + 0x14), r16(p + 0x16));
    else subPair(p, 0x10, 0x12, r16(p + 0x14), r16(p + 0x16));
  }
  if (r16(p + 0x1C) | r16(p + 0x1E)) {  // C0A39F
    if (!(r16(p) & 2)) addPair(p, 0x18, 0x1A, r16(p + 0x1C), r16(p + 0x1E));
    else subPair(p, 0x18, 0x1A, r16(p + 0x1C), r16(p + 0x1E));
  }
}

function maxSpeedCheck(p) {             // C0A228 (literal transliteration of its compares)
  if (r16(p) & 0x40) {
    let hit;
    const f36 = r16(p + 0x36), f16 = r16(p + 0x16);
    if (f36 === f16 || f36 < f16) hit = r16(p + 0x14) === r16(p + 0x34);
    else hit = !(r16(p + 0x34) >= r16(p + 0x14));
    if (hit) w16(p, (r16(p) ^ 4) & 0xFFBF);
  }
  if (r16(p) & 0x80) {
    let hit;
    const f3e = r16(p + 0x3E), f1e = r16(p + 0x1E);
    if (f3e === f1e || f3e < f1e) hit = r16(p + 0x1C) === r16(p + 0x3C);
    else hit = !(r16(p + 0x3C) >= r16(p + 0x1C));
    if (hit) w16(p, (r16(p) ^ 8) & 0xFF7F);
  }
}

// ---- death --------------------------------------------------------------------------
export function deathCheck(p) {         // C0A5C9
  if (r16(p + 2) & 0x8000) return;
  if (r16(p) & 0x0400) return;
  if (r16(p + 2) & 0x0200) return;
  centreCell(p);
  if (r16(p + 4) & 0x0020) return;      // flickering after a shield hit
  w16(0x5D5A, 0);
  if ((r8(p + 0xB4) & 0x3F) !== 1) return;   // (battle: only fire / falling blocks kill)
  // C0A644 (battle)
  const sh = r8(p + 0xEF);
  if (!sh) { die(p); return; }
  if (sh < 0x80) w8(p + 0xEF, sh - 1);
  w16(p + 4, r16(p + 4) | 0x0020);
  w8(p + 0xB9, 0xC0);
  emit('shieldHit', { player: (p - 0x8000) >> 8 });
}

export function die(p) {                // C0A675
  if (r16(p + 0x52) & 0x0002) movers.dropCarried?.(p);   // C0A743: drop the lifted bomb
  w8(p + 0xF5, 0);
  w16(p + 4, r16(p + 4) & 0xFFBF);
  w16(p, r16(p) | 0x0800);
  w16(p + 0x52, 0x0801);
  const k = r16(0x5D5A) ? 7 : 0;
  w16(p + 0x50, k);
  w16(p + 0x56, k);
  w16(p + 0x6A, r16(0x5D5A) === 1 ? 0x1C : 0x1E);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  if (p < 0x8400) emit('died', { player: (p - 0x8000) >> 8, cell: r16(p + 0xA8) });
}

function flicker(p) {                   // C0A570: shield-hit invulnerability countdown
  if (!(r16(p + 4) & 0x0020)) return;
  let t = r8(p + 0xB9);
  if (t !== 0xFF) {
    if (t === 0 || --t === 0) {         // C0A5B2
      w16(p + 6, r16(p + 0x2A));
      w16(p + 4, r16(p + 4) & 0xFFDF);
      return;
    }
    w8(p + 0xB9, t);
  }
  if (r16(0x32) & 1) return;
  w16(p + 6, r16(p + 6) === 7 ? r16(p + 0x2A) : 7);    // palette blink
}

function timeUp(p) {                    // C0A6FD
  if (r16(0x5C56)) return;
  const hi = r16(p + 0x7E) & 0xFF00;
  if (hi) {
    if (hi !== 0x0400) return;
    w16(p, 0); w16(p + 0x10, 0x1FF); w16(p + 0x18, parkY());   // tall: parked below the field
  }
  die(p);
}

function dyingStep(p) {                 // C0A7FA: end of the death animation
  if (r16(p + 0x0C) !== 0x0FFF) return;
  if (r16(p + 0x60) & 0x0800) return;
  w16(p + 0x60, r16(p + 0x60) | 0x0800);
  w16(p + 0x10, 0);
  w16(p + 0x18, parkY());               // tall: parked below the field
  w16(p + 0xA8, 0);
  if (r16(0xB9) & 0x8000) items.deathScatter?.(p);       // C097A0
}

function busyMove(p) {                  // C0A834: +52 bit0 (busy) — wait for the anim end
  if (r16(p + 0x0C) !== 0x0FFF) return;
  if (r16(p + 0x6E) & 0x0F00) inputVelocity(p);
  else {
    for (const o of [0x14, 0x16, 0x24, 0x26, 0x1C, 0x1E, 0x2C, 0x2E]) w16(p + o, 0);
  }
  w16(p + 0x6A, r16(p + 0x5E));
  w16(p + 0x50, r16(p + 0x56));
  let s = r16(p + 0x52) & 0xFF7A;
  if (s & 2) s |= 4;
  w16(p + 0x52, s);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  if (r16(p + 4) & 1) {                 // COM: resume with a direction (C05F25)
    w16(p + 0x6E, r16(p + 0x6E) & 0xF0FF);
    w16(p + 0x6E, r16(p + 0x6E) | comResumeDir(p));
    w16(p + 0xBE, r16(p + 0xBE) & 0x7FFF);
  }
}

function comResumeDir(p) {              // C05F25
  if (r16(0x1A) !== 3) {
    const d = r16(p + 0x9A) & 0x0F00;
    if (d) return d;
  }
  return [0x100, 0x200, 0x400, 0x800][r16(0x400) & 3];
}

// ---- C0A474 -------------------------------------------------------------------------
export function move(p) {
  const f = r16(p);
  if (!(f & 0x8000)) return;
  if (f & 0x0800) { dyingStep(p); return; }
  if (r16(p + 0x52) & 0x0001) {
    if (r16(p + 2) & 0x0080) { deathCheck(p); savePos(p); }
    else if (!(r16(p + 0x52) & 0x0800)) { busyMove(p); deathCheck(p); flicker(p); return; }
  } else {
    deathCheck(p);
    inputMove(p);
  }
  accelerate(p);                        // C0A2B8
  integrate(p);                         // C0A380
  maxSpeedCheck(p);                     // C0A228
  flicker(p);                           // C0A570
  timeUp(p);                            // C0A6FD
  cellLookup(p);                        // C0A4F7
  if (r16(p + 0x7E) & 0xFF00) return;
  if (r16(p + 0x52) & 0x0800) return;
  collide(p);                           // C0A98E
  items.pickup?.(p);                      // C0986A
}

// ---- collision dispatch C0A98E ------------------------------------------------------
function collide(p) {
  // (non-battle branch skipped: battle only)
  motionDir(p);                         // C0A92A
  if (r16(0x1A) !== 2 && r16(p + 0x10) === r16(0x5C2C) && r16(p + 0x18) === r16(0x5C30)) return;
  if (r8(p + 0xB4) === 0xC1) { undoX(p); undoY(p); return; }
  w16(p + 0x5C, 0);
  w16(0x5BFA, r16(p + 0x18));
  w16(0x5BF8, r16(p + 0x10));
  w16(0x5BF4, 0);
  switch ((r16(0x5BFC) & 0x0F00) >> 8) {
    case 1: moveR(p); break;
    case 2: moveL(p); break;
    case 4: moveD(p); break;
    case 5: moveRD(p); break;
    case 6: moveLD(p); break;
    case 8: moveU(p); break;
    case 9: moveRU(p); break;
    case 10: moveLU(p); break;
    default: break;                     // C0AE98: none / opposite / 3+ directions
  }
}

// ---- "another mobile object ahead" (C0AB0F R, C0AB8B L, C0AA93 D, C0AA13 U) ---------
function moverAhead(p, dir) {
  const px = r16(p + 0x10), py = r16(p + 0x18);
  w16(0x5E, px); w16(0x5A, py);
  for (let x = 0; ; x += 2) {
    w16(0x5C, x);
    const q = r16(OBJ_LIST + x);
    if (q === 0xFFFF) return false;
    if (q < 0x8400) continue;
    if (!(r16(q + 0x7E) === 0xEF || (r16(q + 0x52) & 0x20) || (r16(q + 2) & 0x0200))) continue;
    const qx = r16(q + 0x10), qy = r16(q + 0x18);
    let side, d;
    if (dir === 'R') { side = qy - py; d = qx - px; }
    else if (dir === 'L') { side = qy - py; d = px - qx; }
    else if (dir === 'D') { side = qx - px; d = qy - py; }
    else { side = qx - px; d = py - qy; }
    side &= 0xFFFF; if (side & 0x8000) side = (-side) & 0xFFFF;
    if (side >= 8) continue;
    d &= 0xFFFF;
    if (d === 0 || d >= 0x0F) continue;
    restoreX(p); restoreY(p);
    return true;
  }
}

// ---- standing on a bomb: walking onto another one is undone (C10169 R, C101A0 L,
// C101D7 U, C1020E D) ---------------------------------------------------------------
function bombWalkOff(p, horizontal) {
  if (r8(p + 0xFB - 1)) return;         // +FA bomb-pass
  const v = horizontal ? gridAt(r16(0x5C2C), r16(p + 0x18)) : gridAt(r16(p + 0x10), r16(0x5C30));
  if (v === 0x43) return;
  if (horizontal) undoX(p); else undoY(p);
  cellLookup(p);
  snapToCell(p);
  if (horizontal) { w16(0x5C2A, r16(p + 0x12)); w16(0x5C2C, r16(p + 0x10)); }   // C10143
  else { w16(0x5C2E, r16(p + 0x1A)); w16(0x5C30, r16(p + 0x18)); }             // C10156
}

const isBomb = (v) => (v & 0x3F) === 3;
const solid = (b) => (b & 0x80) !== 0;

// kick attempt (C0AF5F family): returns true when the bomb blocks (undo), false = pass
function bombAhead(p) {
  zeroXY(p);                            // C0AFAF starts with C0AF76
  if (movers.kick?.(p)) return true;      // C0AFAF: kicked -> stop here
  return !r8(p + 0xFA);                 // bomb-pass walks on
}

function moveR(p) {                     // C0AED4
  zeroY(p);
  if (moverAhead(p, 'R')) return facing(p);
  const w = frontR(p);
  let bomb;
  if (isBomb(r8(p + 0xB4))) {
    bombWalkOff(p, true);
    bomb = isBomb(r16(0x1C000 + ((r16(p + 0xA8) + 2) & 0xFFFF)));
  } else bomb = isBomb(w);
  if (bomb && bombAhead(p)) { undoX(p); return facing(p); }
  probeB0(p); probeB1(p);
  w8(0x5BFE, r8(p + 0xB0)); w8(0x5C00, r8(p + 0xB1));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) {
    snapBack(p, 7, 0, -1); zeroXY(p); stage.pushBlock?.(p);
  } else slideR(p);
  facing(p);
}

function moveL(p) {                     // C0B2DE
  zeroY(p);
  if (moverAhead(p, 'L')) return facing(p);
  const w = frontL(p);
  let bomb;
  if (isBomb(r8(p + 0xB4))) {
    bombWalkOff(p, true);
    bomb = isBomb(r16(0x1C000 + ((r16(p + 0xA8) - 2) & 0xFFFF)));
  } else bomb = isBomb(w);
  if (bomb && bombAhead(p)) { undoX(p); return facing(p); }
  probeB3(p); probeB2(p);
  w8(0x5BFE, r8(p + 0xB2)); w8(0x5C00, r8(p + 0xB3));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) {
    snapBack(p, -8, 0, 1); zeroXY(p); stage.pushBlock?.(p);
  } else slideL(p);
  facing(p);
}

function moveD(p) {                     // C0B40C
  zeroX(p);
  if (moverAhead(p, 'D')) return facing(p);
  const w = frontD(p);
  let bomb;
  if (isBomb(r8(p + 0xB4))) {
    bombWalkOff(p, false);
    bomb = isBomb(r16(0x1C000 + ((r16(p + 0xA8) + 0x80) & 0xFFFF)));
  } else bomb = isBomb(w);
  if (bomb && bombAhead(p)) { undoY(p); return facing(p); }
  probeB0(p); probeB3(p);
  w8(0x5BFE, r8(p + 0xB0)); w8(0x5C00, r8(p + 0xB3));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) {
    snapBack(p, 0, 8, -1); zeroXY(p); stage.pushBlock?.(p);
  } else slideD(p);
  facing(p);
}

function moveU(p) {                     // C0B854
  zeroX(p);
  if (moverAhead(p, 'U')) return facing(p);
  const w = frontU(p);
  let bomb;
  if (isBomb(r8(p + 0xB4))) {
    bombWalkOff(p, false);
    bomb = isBomb(r16(0x1C000 + ((r16(p + 0xA8) - 0x80) & 0xFFFF)));
  } else bomb = isBomb(w);
  if (bomb && bombAhead(p)) { undoY(p); return facing(p); }
  probeB1(p); probeB2(p);
  w8(0x5BFE, r8(p + 0xB1)); w8(0x5C00, r8(p + 0xB2));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) {
    snapBack(p, 0, -7, 1); zeroXY(p); stage.pushBlock?.(p);
  } else slideU(p);
  facing(p);
}

// C0B252 / C0B380 / C0B4B6 / C0B8FE: walk back 1 px at a time until the front-centre
// probe is no longer solid (a soft block counts as free for wall-pass), then store.
function snapBack(p, dx, dy, step) {
  if (dx) {
    w16(0x5BF6, (r16(0x5BF8) + dx) & 0xFFFF);
    for (;;) {
      const v = gridAt(r16(0x5BF6), r16(0x5BFA));
      if (!(v & 0x80) || (v === 0xC2 && r8(p + 0xFB))) break;
      w16(0x5BF6, (r16(0x5BF6) + step) & 0xFFFF);
      w16(0x5BF8, (r16(0x5BF8) + step) & 0xFFFF);
    }
    w16(p + 0x10, r16(0x5BF8));
  } else {
    w16(0x5BF6, (r16(0x5BFA) + dy) & 0xFFFF);
    for (;;) {
      const v = gridAt(r16(0x5BF8), r16(0x5BF6));
      if (!(v & 0x80) || (v === 0xC2 && r8(p + 0xFB))) break;
      w16(0x5BF6, (r16(0x5BF6) + step) & 0xFFFF);
      w16(0x5BFA, (r16(0x5BFA) + step) & 0xFFFF);
    }
    w16(p + 0x18, r16(0x5BFA));
  }
}

// ---- corner slides (C0BBCD R, C0BCF6 L, C0BAA4 D, C0B97B U) --------------------------
// The axis perpendicular to the move gets old position -/+ full speed, then is walked
// back 1 px while the leading corner is solid; a bomb at that corner stops the slide
// (snap to the cell centre) unless the bomber has bomb-pass.
function slideCommon(p, face, firstSolid, secondSolid, perp, firstFace, secondFace, firstBit, secondBit,
  firstProbe, firstField, firstStep, secondProbe, secondField, secondStep, bombFace) {
  w16(p + 0x5C, face);
  if (solid(r16(0x5BFE) & r16(0x5C00))) return;
  let probeFn, field, step, sign;
  if (solid(r16(firstSolid))) {
    if (solid(r16(0x5C02))) { (perp === 'y' ? restoreX : restoreY)(p); w16(p + 0x5C, firstFace); }
    else w16(0x5BF4, r16(0x5BF4) | firstBit);
    sign = -1; probeFn = firstProbe; field = firstField; step = firstStep;
  } else {
    if (!solid(r16(secondSolid))) return;
    if (solid(r16(0x5C02))) { (perp === 'y' ? restoreX : restoreY)(p); w16(p + 0x5C, secondFace); }
    else w16(0x5BF4, r16(0x5BF4) | secondBit);
    sign = 1; probeFn = secondProbe; field = secondField; step = secondStep;
  }
  // perpendicular move by the full speed from the saved position
  if (perp === 'y') {
    if (sign < 0) {
      const f = r16(0x5C2E) - r16(p + 0xA2);
      w16(p + 0x1A, f);
      w16(p + 0x18, r16(0x5C30) - r16(p + 0xA0) - (f < 0 ? 1 : 0));
    } else {
      const f = r16(p + 0xA2) + r16(0x5C2E);
      w16(p + 0x1A, f);
      w16(p + 0x18, r16(p + 0xA0) + r16(0x5C30) + (f > 0xFFFF ? 1 : 0));
    }
  } else if (sign < 0) {
    const f = r16(0x5C2A) - r16(p + 0xA6);
    w16(p + 0x12, f);
    w16(p + 0x10, r16(0x5C2C) - r16(p + 0xA4) - (f < 0 ? 1 : 0));
  } else {
    const f = r16(p + 0xA6) + r16(0x5C2A);
    w16(p + 0x12, f);
    w16(p + 0x10, r16(p + 0xA4) + r16(0x5C2C) + (f > 0xFFFF ? 1 : 0));
  }
  const posOff = perp === 'y' ? 0x18 : 0x10;
  for (;;) {
    probeFn(p);
    const b = r8(p + field);
    if (b === 0x43) {
      if (r8(p + 0xFA)) return;
      w16(p + 0x5C, bombFace);
      snapToCell(p);
      return;
    }
    if (!(b & 0x80)) return;
    w16(p + posOff, r16(p + posOff) + step);
  }
}

function slideR(p) {                    // C0BBCD
  // lower corner (B0) solid -> slide up, check B1; upper (B1) -> slide down, check B0
  slideCommon(p, 2, 0x5BFE, 0x5C00, 'y', 0x10, 0x08, 0x800, 0x400,
    probeB1, 0xB1, 1, probeB0, 0xB0, -1, 2);
}
function slideL(p) {                    // C0BCF6 ($5BFE = B2 upper, $5C00 = B3 lower)
  slideCommon(p, 4, 0x5C00, 0x5BFE, 'y', 0x10, 0x08, 0x800, 0x400,
    probeB2, 0xB2, 1, probeB3, 0xB3, -1, 4);
}
function slideD(p) {                    // C0BAA4 ($5BFE = B0 right, $5C00 = B3 left)
  slideCommon(p, 8, 0x5BFE, 0x5C00, 'x', 0x04, 0x02, 0x200, 0x100,
    probeB3, 0xB3, 1, probeB0, 0xB0, -1, 8);
}
function slideU(p) {                    // C0B97B ($5BFE = B1 right, $5C00 = B2 left)
  slideCommon(p, 0x10, 0x5BFE, 0x5C00, 'x', 0x04, 0x02, 0x200, 0x100,
    probeB2, 0xB2, 1, probeB1, 0xB1, -1, 0x10);
}

// ---- diagonals ----------------------------------------------------------------------
function blockR(p) {                    // C0B505
  w16(0x5C80, r16(0x5C80) & 0xFFFE);
  probeB0(p); probeB1(p);
  w8(0x5BFE, r8(p + 0xB0)); w8(0x5C00, r8(p + 0xB1));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) { undoX(p); w16(0x5C80, r16(0x5C80) | 1); }
}
function blockL(p) {                    // C0B54E
  w16(0x5C80, r16(0x5C80) & 0xFFFD);
  probeB3(p); probeB2(p);
  w8(0x5BFE, r8(p + 0xB2)); w8(0x5C00, r8(p + 0xB3));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) { undoX(p); w16(0x5C80, r16(0x5C80) | 2); }
}
function blockD(p) {                    // C0B597
  w16(0x5C80, r16(0x5C80) & 0xFFFB);
  probeB0(p); probeB3(p);
  w8(0x5BFE, r8(p + 0xB0)); w8(0x5C00, r8(p + 0xB3));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) { undoY(p); w16(0x5C80, r16(0x5C80) | 4); }
}
function blockU(p) {                    // C0B5E2
  w16(0x5C80, r16(0x5C80) & 0xFFF7);
  probeB1(p); probeB2(p);
  w8(0x5BFE, r8(p + 0xB1)); w8(0x5C00, r8(p + 0xB2));
  if (solid(r16(0x5BFE)) && solid(r16(0x5C00))) { undoY(p); w16(0x5C80, r16(0x5C80) | 8); }
}

// h/v: the handlers; hBit/vBit: $5C80 bits; vFace: facing code of the vertical dir;
// order of the corner tests for "facing vertical" and "otherwise" (see SPEC §4 step 4)
function diagonal(p, hFront, vFront, hBlock, vBlock, hBit, vBit, h, v, vFace, faceV, other) {
  hFront(p); vFront(p); hBlock(p); vBlock(p);
  const f = r16(0x5C80) & (hBit | vBit);
  const goV = () => { undoX(p); v(p); };   // horizontal blocked -> vertical handler
  const goH = () => { undoY(p); h(p); };
  if (f === hBit) return goV();
  if (f === vBit) return goH();
  if (f) return facing(p);
  if (r16(p + 0x5E) === vFace) {
    if (solid(r8(p + faceV[0])) || solid(r8(p + faceV[1]))) return goV();
    return goH();
  }
  if (solid(r8(p + other[0])) || solid(r8(p + other[1]))) return goH();
  return goV();
}
const moveRD = (p) => diagonal(p, frontR, frontD, blockR, blockD, 1, 4, moveR, moveD, 8, [0xB0, 0xB1], [0xB0, 0xB3]);    // C0B62D
const moveLD = (p) => diagonal(p, frontL, frontD, blockL, blockD, 2, 4, moveL, moveD, 8, [0xB3, 0xB2], [0xB3, 0xB0]);    // C0B6A8
const moveRU = (p) => diagonal(p, frontR, frontU, blockR, blockU, 1, 8, moveR, moveU, 0x10, [0xB1, 0xB0], [0xB1, 0xB2]); // C0B723
const moveLU = (p) => diagonal(p, frontL, frontU, blockL, blockU, 2, 8, moveL, moveU, 0x10, [0xB2, 0xB3], [0xB2, 0xB1]); // C0B79E

// ---- facing (C0AE25) ----------------------------------------------------------------
function facing(p) {
  if (r16(p + 2) & 0x0080) return;
  const st = r16(0x1A);
  let a;
  if (st === 9 || st === 1 || st === 2) {
    if (!(r16(p + 0x6E) & 0x0F00)) return;
    a = null;
  } else a = r16(p + 0x5C) || null;
  if (a === null) {
    const c = (r16(p + 0x6E) & 0x0F00) >> 7;
    w16(0x5C0C, c);
    if (c & 6) a = c & 6;
    else if (c & 0x18) a = c & 0x18;
    else return;
  }
  if (a === r16(p + 0x5E)) return;
  w16(p + 0x5E, a);
  w16(p + 0x6A, a);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
}
