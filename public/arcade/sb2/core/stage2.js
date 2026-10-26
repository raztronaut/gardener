// Stage 2 (ice, $1A = 1) — handlers exported under their ROM addresses (see stage.js).
//
// - C0C09E  ice movement: speed level forced to 1, the held axis accelerates by
//           0.25 px/tick^2 up to 2 px/tick, no friction (velocity kept on release),
//           the opposite direction decelerates first.
// - C0ACD4  pushing a soft block (from the movement handlers): the block becomes a
//           sliding mover (mode 3, driven by movers.js C094B4).
// - C04468  hole cells (underlay type 9): fall in, then a launch up and over.
// - C05763  per bomber: rides the underground "track" cells (underlay 8 / 9 / $0A,
//           the ',' cells of the map) between holes at 2 px/tick, random turns at the
//           $0A junctions, the launch arc and the landing.
//
// Bomber fields used here: +52 state (b0 busy, b1 carrying, b6 junction latch,
// b8 riding, b9 rise anim set, b10 fall anim done, b11 hole sequence, b12 launched,
// b13 past the apex, b14/b15 ice axis latches), +02 b11 (in the hole system), +54 / +AE
// ice X latch (input / sign), +AC / +CE ice Y latch, +58 / +5A ice acceleration,
// +C8 shadow object, +CC landing cell.
import { r8, r16, w8, w16, GRID, UNDER, DANGER, TILE, TILE_UNDER, OBJ_LIST } from './mem.js';
import * as move from './move.js';
import * as movers from './movers.js';
import { emit } from './events.js';
import { HOP_C5EB09, ANIM_C5EAE5 } from './movers_tables.js';

const sfx = (id) => emit('sfx', { id });
const player = (p) => (p - 0x8000) >> 8;

// ---- ice movement (C0C09E) -----------------------------------------------------------
// $C5FB33 (acceleration per speed level, [frac for +58/+5A, word for +3A/+32]); only
// level 1 is used (the routine forces +F0 = 1).
const ICE_ACC = [[0x4000, 0], [0x4000, 0], [0x4000, 0], [0x4000, 0], [0x4000, 0], [0x4000, 0], [0x4000, 0]];

export function C0C09E(p) {
  w8(p + 0xF0, 1);
  move.speedFromLevel(p);               // C0C290
  const [a, b] = ICE_ACC[r8(p + 0xF0)];
  w16(p + 0x58, a); w16(p + 0x5A, a);
  w16(p + 0x3A, b); w16(p + 0x32, b);
  iceX(p);                              // C0C139
  iceY(p);                              // C0C1E3
  iceClamp(p);                          // C0C0E8
}

function iceX(p) {                      // C0C139
  const inp = r16(p + 0x6E) & 0x0300;
  w16(0x4E, inp);
  if (!inp) {
    w16(p + 0x26, 0);
    w16(p, (r16(p) & 0xFFFE) | r16(p + 0xAE));
    return;
  }
  if (!(r16(p + 0x52) & 0x8000)) {      // C0C184: latch the axis
    w16(p + 0x52, r16(p + 0x52) | 0x8000);
    w16(p + 0x54, inp);
    w16(p + 0xAE, r16(p) & 1);
  }
  w16(p + 0x26, r16(p + 0x5A));
  if (r16(p + 0x54) === inp) { w16(p, r16(p) & 0xFFFB); return; }   // C0C1B4: accelerate
  // C0C15A: opposite input: decelerate until the velocity's integer part is 0
  if (r16(p + 0x14) === 0) {
    w16(p + 0x52, r16(p + 0x52) & 0x7FFF);
    move.zeroX(p);                      // C0AF7F
    return;
  }
  w16(p, r16(p) | 4);
  w16(p, (r16(p) & 0xFFFE) | r16(p + 0xAE));
}

function iceY(p) {                      // C0C1E3
  const inp = r16(p + 0x6E) & 0x0C00;
  w16(0x4E, inp);
  if (!inp) {
    w16(p + 0x2E, 0);
    w16(p, (r16(p) & 0xFFFD) | r16(p + 0xCE));
    return;
  }
  if (!(r16(p + 0x52) & 0x4000)) {      // C0C22E
    w16(p + 0x52, r16(p + 0x52) | 0x4000);
    w16(p + 0xAC, inp);
    w16(p + 0xCE, r16(p) & 2);
  }
  w16(p + 0x2E, r16(p + 0x58));
  // C0C261 — quirk: clears bit 2 (the X deceleration flag), not bit 3
  if (r16(p + 0xAC) === inp) { w16(p, r16(p) & 0xFFFB); return; }
  if (r16(p + 0x1C) === 0) {            // C0C204
    w16(p + 0x52, r16(p + 0x52) & 0xBFFF);
    move.zeroY(p);                      // C0AF97
    return;
  }
  w16(p, r16(p) | 8);
  w16(p, (r16(p) & 0xFFFD) | r16(p + 0xCE));
}

function iceClamp(p) {                  // C0C0E8: cap the accelerating axis at 2 px/tick
  if (!(r16(p) & 4) && r16(p + 0x14) >= 2) {
    w16(p + 0x14, 2); w16(p + 0x16, 0); w16(p + 0x26, 0);
  }
  if (!(r16(p) & 8) && r16(p + 0x1C) >= 2) {
    w16(p + 0x1C, 2); w16(p + 0x1E, 0); w16(p + 0x2E, 0);
  }
}

// ---- object slots (C02F1B; same as movers.js allocMover) -------------------------------
function allocMover(cur) {
  w16(0x5BFE, cur & 0xFFFF); w8(0x5C00, 0x7E);
  for (let k = 0, o = 0x8400; k < 0x1C; k++, o += 0x100) {
    if (!(r16(o) & 0x8000)) { w8(o + 0xA8, 0); w8(o + 0xAA, 0); return o; }
  }
  return null;
}

function restoreUnder(idx, tidx) {      // C0DDF7
  w16(0x42, idx); w16(0x44, tidx);
  w16(GRID + idx, r16(UNDER + idx));
  w16(DANGER + idx, 0);
  w16(TILE + tidx, r16(TILE_UNDER + tidx));
}

// $C5FAE7: +00 direction bits of a mover by facing code (2 R, 4 L, 8 D, $10 U)
const faceFlags = (f) => [0x0000, 0x002A, 0x002B, 0x0000, 0x0015, 0, 0, 0, 0x0016][f >> 1] ?? 0;

// ---- pushing a soft block (C0ACD4) ---------------------------------------------------
export function C0ACD4(p) {
  if (r16(0x1A) !== 1) return;
  move.motionDir(p);                    // C0A8D3
  const d = r16(0x5BFC);
  const f = ((d << 1) >> 8) & 0xFF | (((d << 1) & 0xFF) << 8);   // ASL; XBA
  w16(0x5CA8, f & 0xFFFF);
  let step, tstep;
  if (f === 2) { step = 2; tstep = 2; }
  else if (f === 4) { step = 0xFFFE; tstep = 0xFFFE; }
  else if (f === 8) { step = 0x80; tstep = 0x40; }
  else if (f === 0x10) { step = 0xFF80; tstep = 0xFFC0; }
  else return;
  w16(0x52, step); w16(0x50, tstep);
  // C0AC4B: the cell ahead must be a soft block that is not burning
  const blk = (step + r16(p + 0xA8)) & 0xFFFF;
  w16(0x5E2E, blk);
  if ((r16(GRID + blk) & 0xFF) !== 0xC2) return;
  for (let x = 0; ; x += 0x10) {        // C0AC6E: in the burn list?
    if (r16(0x10000 + x) & 0x8000) break;
    if (r16(0x10002 + x) === blk) return;
  }
  // C0AC8D: the cell beyond must be free (or an item) and no object stands there
  const beyond = (((step << 1) & 0xFFFF) + r16(p + 0xA8)) & 0xFFFF;
  w16(0x54, beyond);
  const c = r16(GRID + beyond) & 0xFF;
  if ((c & 0x40) && c !== 0x44) return;
  for (let x = 0; ; x += 2) {
    const q = r16(OBJ_LIST + x);
    if (q === 0xFFFF) break;
    if (r16(q + 0xA8) === beyond) return;
  }
  // C0AD3A: spawn the sliding block
  w16(0x5C0E, (r16(p + 0xA8) + step) & 0xFFFF);
  w16(0x50, (r16(p + 0xAA) + tstep) & 0xFFFF);
  const o = allocMover(p);
  if (o === null) return;
  movers.initObject(o, 'block');        // C02196 with template $C2016D
  w16(o + 0x46, step);
  w16(o + 0xA8, r16(0x5C0E));
  w16(o + 0xAA, r16(0x50));
  const [x, y] = move.cellCentre(r16(0x5C0E));
  w16(o + 0x10, x);
  w16(o + 0x18, y & r16(0x5D3C));
  for (const k of [0x14, 0x16, 0x24, 0x26, 0x1C, 0x1E, 0x2C, 0x2E]) w16(o + k, 0);
  w16(o + 0x5E, r16(0x5CA8));
  w16(o, r16(o) | faceFlags(r16(0x5CA8)));
  w16(o, r16(o) | (r16(p) & 0x000F));   // quirk: the pusher's velocity sign bits
  if (r16(0x5CA8) >= 6) w16(o + 0x1C, 2); else w16(o + 0x14, 2);
  w16(o + 0x6A, 0x16);
  w16(o + 0x08, 0);
  restoreUnder(r16(o + 0xA8), r16(o + 0xAA));
  emit('blockPushed', { player: player(p), cell: r16(o + 0xA8) });
}

// ---- holes (C04468, cell handler for underlay type 9) ---------------------------------
export function C04468(p) {
  if (p >= 0x8400) return;
  if (r16(p) & 0x0800) return;
  if (!(r16(p + 2) & 0x0800) && (r16(0x5D0E) & 1)) return;  // holes close in sudden death
  if (!(r16(p + 0x52) & 0x0800)) fallIn(p);                // C04599
  if (r16(p + 0x52) & 0x0100) { launch(p); return; }       // C04386
  if (!(r16(p + 0x52) & 0x0400)) {
    if (r16(p + 0x0C) !== 0x0FFF) return;                  // falling animation
    w16(p + 0x52, r16(p + 0x52) | 0x0400);
  }
  if (!(r16(p + 0x52) & 0x0200)) riseAnim(p);              // C04540
  if (!(r16(p + 0x52) & 0x0100)) leaveHole(p);             // C044E3
}

function restartAnim(p) {
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  w16(p + 0x0C, 0);
  w16(p + 0x6E, 0);
}

function fallIn(p) {                    // C04599
  movers.snapCentre(p);                 // C0456D
  if (r16(p + 0x52) & 0x0002) movers.dropCarried(p);       // C0A743
  w16(p + 0x52, 0x0801);
  w16(p + 2, 0x0800);
  w16(p + 0x6A, 0);
  w16(p + 0x50, 4);
  w16(p + 0x56, (r16(p + 4) & 0x0100) ? 2 : 0);
  restartAnim(p);
  sfx(0x5E);                            // C3A4B5
  emit('holeFall', { player: player(p), cell: r16(p + 0xA8) });
}

function riseAnim(p) {                  // C04540
  w16(p + 0x52, r16(p + 0x52) | 0x0200);
  w16(p + 0x6A, 2);
  restartAnim(p);
}

function leaveHole(p) {                 // C044E3: start riding the track, 2 px/tick
  w16(p + 0x52, r16(p + 0x52) | 0x0100);
  w16(p + 0x1C, 2);
  if (r16(p + 0xA8) >= 0x480) {         // lower half: up
    w16(p + 0x5E, 0x10);
    w16(p, (r16(p) & 0xFFFC) | 2);
    w16(p + 0x18, (r16(p + 0x18) - 8) & 0xFFFF);
  } else {
    w16(p + 0x5E, 8);
    w16(p, r16(p) & 0xFFFC);
    w16(p + 0x18, (r16(p + 0x18) + 8) & 0xFFFF);
  }
  centreCell(p);                        // C0BEA6
}

function centreCell(p) {                // C0BEA6 (as move.js)
  let v = move.gridAt(r16(p + 0x10), r16(p + 0x18));
  const idx = move.lastIdx;
  if (v === 0xC2 && r8(p + 0xFB)) v = 0x40;
  w8(p + 0xB4, v & 0xFF);
  if (r16(0x1C78)) w8(p + 0xB4, 0x41);
  if (idx !== r16(p + 0xA8)) w16(p + 0x3A, r16(p + 0xA8));
  w16(p + 0xA8, idx);
}

function launch(p) {                    // C04386: riding into a hole -> launched up
  if (r16(p + 0x52) & 0x1000) return;
  movers.snapCentre(p);                 // C0456D
  w16(p, r16(p) | 0x000A);              // moving up, decelerating
  w16(p + 0x1C, 8);
  w16(p + 0x2E, 0x8000);
  shadow(p);                            // C0440C
  let land = (r16(p + 0xA8) + 0x80) & 0xFFFF;
  w16(0x40, land);
  if (r16(GRID + land) & 0xC0) { land = (r16(p + 0xA8) - 0x80) & 0xFFFF; w16(0x40, land); }
  w16(p + 0xCC, land);
  w16(p + 0x5E, 8);
  w16(p + 0x52, (r16(p + 0x52) & 0xDFFF) | 0x1000);
  w16(p + 0x6A, 4);
  restartAnim(p);
  emit('holeLaunch', { player: player(p), cell: r16(p + 0xA8), land });
}

function shadow(p) {                    // C0440C: the shadow that stays on the ground
  const o = spawnShadow(p);             // C04C0C
  if (o === null) return;               // (the original then writes through a stale $73)
  for (const k of [0x14, 0x16, 0x24, 0x26]) w16(o + k, 0);
  w16(o + 0x1C, 0);
  w16(o + 0x1E, 0x4000);
  w16(o + 0x2C, 0);
  w16(o + 0x2E, 0);
  w16(o, r16(o) & 0xFFF0);
  if (r16(GRID + ((r16(p + 0xA8) + 0x80) & 0xFFFF)) & 0xC0) w16(o, r16(o) | 2);
}

function spawnShadow(p) {               // C04C0C
  const o = allocMover(p);
  if (o === null) return null;
  movers.initObject(o, 'still');        // template $C2017B
  w16(p + 0xC8, o);
  w16(o + 6, r16(p + 0x2A));
  w16(o + 0x10, r16(p + 0x10));
  w16(o + 0x18, r16(p + 0x18));
  w16(o, r16(o) | (r16(p) & 0x000F));
  w16(o + 0x6A, 0x14);
  w16(o + 0x08, 0);
  return o;
}

// ---- per bomber (C05763) ---------------------------------------------------------------
export function C05763(p) {
  if (r16(p) & 0x0800) return;
  const s = r16(p + 0x52);
  if (!(s & 0x1000)) {                  // C0582E: riding the track
    if (s & 0x0100) { steer(p); junction(p); }
    return;
  }
  if (!(s & 0x2000)) {                  // rising: wait for the apex
    if (r16(p + 0x1C)) return;
    w16(p + 0x52, s | 0x2000);
    w16(p + 0x1C, 0);
    w16(p + 0x2E, 0x1000);
    w16(p + 0x6A, 6);
    restartAnim(p);
    return;
  }
  // falling: land when over the landing cell
  if (r16(p + 0xCC) !== r16(p + 0xA8)) return;
  if (r8(p + 0xB4) === 0x43) w16(0x5D02, 1);
  movers.snapCentre(p);                 // C0456D
  const o = r16(p + 0xC8);              // C05B89: remove the shadow
  w16(o, 0); w16(o + 0x10, 0x1FF); w16(o + 0x18, 0xF0);
  w16(p + 0x6A, r16(p + 0x5E));
  w16(p + 0x50, r16(p + 0x56));
  w16(p + 0x52, r16(p + 0x52) & 0xC000);
  w16(p + 2, r16(p + 2) & 0xF7FF);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  emit('holeLand', { player: player(p), cell: r16(p + 0xA8) });
  // landed on a bomb: hop off it (C0838C). $5D02 is not cleared on this stage (only
  // the stage-10 jump code writes it), so every later landing hops too (quirk).
  if (r16(0x5D02)) (movers.hopOut || hopOut)(p);
}

// C0838C / C0843E (copied from movers.js, which does not export them): inside a solid
// cell -> hop to a neighbour, away from the field edge.
const wt = (t, x) => t[(x & 0xFFFF) >> 1];
function hopOut(p) {
  movers.snapCentre(p);
  if (r16(p + 0x52) & 0x0002) movers.dropCarried(p);
  w16(p + 0x52, 0x0809);
  const d = hopDir(p);
  const e0 = wt(HOP_C5EB09, d * 4), e1 = wt(HOP_C5EB09, d * 4 + 2);
  w16(0x40, e0);
  w16(0x42, (e0 & 0x0300) >> 8);
  w16(p, (r16(p) & 0xFFFC) | ((e0 & 0x0300) >> 8));
  w16(p + 0x14, e0 & 0xFF);
  w16(p + 0x1C, e1 & 0xFF);
  w16(p + 0x50, 4);
  w16(p + 0x56, (r16(p + 4) & 0x0100) ? 2 : 0);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  w16(p + 0x0C, 0);
  w16(p + 0x6E, 0);
  w16(p + 0xBE, r16(p + 0xBE) & 0x3FFF);
}
function hopDir(p) {
  let d = r16(p + 0x5E);
  if (!d) { d = 8; w16(p + 0x5E, 8); }
  const c2 = r8(p + 0xC2);
  if (c2) d = c2;
  const y = r16(p + 0x18), x = r16(p + 0x10);
  if (y >= 0xD7) d = (d & 0x18) ? d & 0x18 : 0x10;
  else if (y < 0x28) d = (d & 0x18) ? d & 0x18 : 8;
  else if (x < 0x19) d = (d & 6) ? d & 6 : 2;
  else if (x >= 0xE7) d = (d & 6) ? d & 6 : 4;
  w16(0x40, d);
  w16(p + 0x5E, d);
  w16(p + 0x6A, wt(ANIM_C5EAE5, d));
  return d;
}

const track = (t) => t === 0x0A || t === 0x09 || t === 0x08;
const under = (idx) => r16(UNDER + (idx & 0xFFFF)) & 0x3F;

function goD(p) { w16(p + 0x1C, 2); w16(p + 0x5E, 8); w16(p, r16(p) & 0xFFFC); }              // C059F3
function goU(p) { w16(p + 0x1C, 2); w16(p + 0x5E, 0x10); w16(p, (r16(p) & 0xFFFC) | 2); }     // C05A0B
function goL(p) { w16(p + 0x14, 2); w16(p + 0x5E, 4); w16(p, (r16(p) & 0xFFFC) | 1); }        // C05A26
function goR(p) { w16(p + 0x14, 2); w16(p + 0x5E, 2); w16(p, r16(p) & 0xFFFC); }              // C05A41

function steer(p) {                     // C05841: at the end of a straight, turn
  const f = r16(p + 0x5E), a = r16(p + 0xA8);
  if (f === 2 || f === 4) {             // C0586F / C058B1
    if (track(under(a + (f === 2 ? 2 : -2)))) return;
    movers.snapCentre(p);
    if (under(r16(p + 0xA8) + 0x80) === 8) goD(p); else goU(p);
  } else if (f === 8 || f === 0x10) {   // C058F3 / C05935
    if (track(under(a + (f === 8 ? 0x80 : -0x80)))) return;
    movers.snapCentre(p);
    if (under(r16(p + 0xA8) + 2) === 8) goR(p); else goL(p);
  }
}

// $C5EB4D (random new direction, by $0406 & $1E) and $C5EB6D (opposite by facing)
const NEWDIR = [2, 4, 8, 0x10, 2, 4, 8, 0x10, 2, 4, 8, 0x10, 2, 4, 8, 0x10, 0, 4, 2, 0, 0x10];
const OPPOSITE = { 2: 4, 4: 2, 8: 0x10, 0x10: 8 };

function junction(p) {                  // C05977: a $0A cell turns the rider randomly
  if (r16(UNDER + r16(p + 0xA8)) !== 0x0A) { w16(p + 0x52, r16(p + 0x52) & 0xFFBF); return; }
  if (r16(p + 0x52) & 0x0040) return;
  w16(p + 0x52, r16(p + 0x52) | 0x0040);
  movers.snapCentre(p);
  let k = (r16(0x406) & 0x1E) >> 1;
  let d = NEWDIR[k];
  w16(0x40, d);
  // quirk: the retry reads $C5EB4D at (facing + 2), not at the next random entry
  const f = r16(p + 0x5E);
  if ((OPPOSITE[f] ?? 0) === d) { d = NEWDIR[(f + 2) >> 1] ?? 0; w16(0x40, d); }
  if (d === 2) goR(p);
  else if (d === 4) goL(p);
  else if (d === 8) goD(p);
  else if (d === 0x10) goU(p);
  else goR(p);                          // (d = 0 falls through to C059DF)
}
