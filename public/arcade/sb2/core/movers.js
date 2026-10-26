// Moving objects (SPEC §10, §11): the per-object mover dispatch C08230 and everything
// that creates or drives objects in the mover slots $7E8400.. (28 slots):
//   mode 0 (+7E bits 8-11 = 0): bombers — hop out of a solid cell, stage-3 tunnel step
//   mode 1: a bomb in motion (kicked +52=$20, thrown/bouncing +52=$10, carried by a
//           stage-8 conveyor +02 b9)
//   mode 2: a flying item (skull cured / bombed, items knocked out of a stunned bomber)
//   mode 3: a pushed soft block (stage 2)
//   mode 4: static (no handler)
// Positions are integrated by the normal movement routine (move.js C0A474), which runs
// for every object; movers only set velocities (+14/+1C) and their sign bits (+00 b0/b1).
// Thrown / bouncing objects follow ROM motion scripts (movers_tables.js): one
// (flags, vx, vy) triple per tick, pointer in +43..+45.
import { r8, r16, w8, w16, GRID, UNDER, DANGER, TILE, TILE_UNDER } from './mem.js';
import { emit } from './events.js';
import * as move from './move.js';
import * as anim from './anim.js';
import * as T from './movers_tables.js';

const wt = (t, x) => t[(x & 0xFFFF) >> 1];               // word table indexed by byte offset
const bombPtr = (p) => 0x10000 | r16(p + 0x40);         // +40: bomb slot (bank $7F)
const g = (idx) => r16(GRID + idx);
const setG = (idx, v) => w16(GRID + idx, v);
const sfx = (id) => emit('sfx', { id });

// ---- small helpers (same routines as move.js, kept local) ---------------------------
function tileIndexAt(x, y) {             // C0A515 (-> $46)
  const ty = (r16(0x5EFB) + y) & 0x3F0, tx = (r16(0x5F01) + x) & 0x3F0;
  w16(0x4E, ty); w16(0x48, tx);
  const v = (((ty & 0x1F0) << 2) + ((tx & 0x1F0) >> 3)) & 0x7FF;
  w16(0x46, v);
  return v;
}
function centreCell(p) {                 // C0BEA6
  let v = move.gridAt(r16(p + 0x10), r16(p + 0x18));
  const idx = move.lastIdx;
  if (v === 0xC2 && r8(p + 0xFB)) v = 0x40;
  w8(p + 0xB4, v & 0xFF);
  if (r16(0x1C78)) w8(p + 0xB4, 0x41);
  if (idx !== r16(p + 0xA8)) w16(p + 0x3A, r16(p + 0xA8));
  w16(p + 0xA8, idx);
}
function cellLookupFull(p) {             // C0A515 -> +AA, C0BEA6
  w16(p + 0xAA, tileIndexAt(r16(p + 0x10), r16(p + 0x18)));
  centreCell(p);
}
function nearCentre(p, n) {              // C19BFB: |x-cx| < n and |y-cy| < n
  w16(0x52, n);
  const [cx, cy] = move.cellCentre(r16(p + 0xA8));
  let d = (r16(p + 0x10) - cx) & 0xFFFF; if (d & 0x8000) d = (-d) & 0xFFFF;
  if (d >= n) return false;
  d = (r16(p + 0x18) - cy) & 0xFFFF; if (d & 0x8000) d = (-d) & 0xFFFF;
  return d < n;
}
function restoreUnder(idx, tidx) {       // C0DDF7
  w16(0x42, idx); w16(0x44, tidx);
  setG(idx, r16(UNDER + idx));
  w16(DANGER + idx, 0);
  w16(TILE + tidx, r16(TILE_UNDER + tidx));
}
function zeroVel(o) { move.zeroX(o); move.zeroY(o); }    // C08D3A + C08D52
function zeroVelQuirk(o) {               // C09272 / C0EEB2: +1C is written twice, +1E kept
  for (const f of [0x14, 0x16, 0x24, 0x26, 0x1C, 0x2C, 0x2E]) w16(o + f, 0);
}
function animStart(o) { anim.start?.(o); }               // C021B0 + C021DC (anim script)

// C0E432: give a bomb back to its owner (bombs out -1, bombs in hand recomputed)
function returnBomb(owner) {
  let out = r8(owner + 0xF8);
  if (out) { out--; w8(owner + 0xF8, out); }
  const d = r8(owner + 0xF5);
  let hand;
  if (d === 3) hand = 0;
  else if (d === 6) hand = out === 0 ? 1 : 0;
  else hand = (r8(owner + 0xE1) - r8(owner + 0xF8)) & 0xFF;
  w8(owner + 0xF1, hand);
}
const ownerOf = (b) => 0x8000 | (r8(b + 6) << 8);       // C0E651 ([$70])

// ---- object slots --------------------------------------------------------------------
// C02F1B: first free slot of $7E8400.. (28); +A8/+AA low bytes cleared. null = none.
// It saves the current object pointer ($6A/$6C) in $5BFE/$5C00 (restored by C02F0A).
function allocMover(cur, bank = 0x7E) {
  w16(0x5BFE, cur & 0xFFFF); w8(0x5C00, bank);
  for (let k = 0, o = 0x8400; k < 0x1C; k++, o += 0x100) {
    if (!(r16(o) & 0x8000)) { w8(o + 0xA8, 0); w8(o + 0xAA, 0); return o; }
  }
  return null;
}
// C02196 + C02401 with a template (C20151: mode 1 bomb, C2015F: mode 2 item,
// C2016D: mode 3 block, C2017B: mode 4)
const TEMPLATES = {
  bomb: [0x8400, 0x0C00, 0x80, 0x80, 0x0100, 0x8000, 5],
  item: [0x8400, 0x0C00, 0x80, 0x80, 0x0200, 0x8000, 5],
  block: [0x8400, 0x0C00, 0x80, 0x80, 0x0300, 0x0004, 5],
  still: [0x8400, 0x0C00, 0x80, 0x80, 0x0400, 0x8000, 5],
};
export function initObject(o, kind) {    // C02196
  const t = TEMPLATES[kind];
  w16(o + 0x0A, r16(0x1C));
  w16(o, t[0]); w16(o + 4, t[1]); w16(o + 0x10, t[2]); w16(o + 0x18, t[3]);
  w16(o + 0x7E, t[4]); w16(o + 6, t[5]); w16(o + 0x2A, t[5]); w16(o + 0x50, t[6]);
  w16(o + 0x0C, 0); w16(o + 0x0E, 0); w16(o + 0x52, 0);
  w16(o + 0x6C, 0); w16(o + 0x6E, 0);
  animStart(o);
}
function freeMover(o) {                  // C08CA3
  w16(o, 0); w16(o + 2, 0);
  zeroVel(o);
  w16(o + 0x10, 0x1FF); w16(o + 0x18, 0xF0);
}

// motion scripts ---------------------------------------------------------------------
const mword = (a) => { const v = T.MWORDS.get(a); return v === undefined ? 0xFFFF : v; };
function setScript(o, a) { w8(o + 0x43, a & 0xFF); w8(o + 0x44, (a >> 8) & 0xFF); w8(o + 0x45, a >> 16); }
const getScript = (o) => r8(o + 0x43) | (r8(o + 0x44) << 8) | (r8(o + 0x45) << 16);
function scriptFor(top, n, facing) { return T.MPTR.get(T.MPTR.get(top + 4 * n) + 2 * facing); }
function C02BB9(o, n) { setScript(o, scriptFor(0xC5CAA0, n, r16(o + 0x5E))); }       // bounce / hop
function C02C03(o, n) {                  // throw script (also leaves it in $5C08..)
  const a = scriptFor(0xC5CAA0, n, r16(o + 0x5E));
  w8(0x5C08, a & 0xFF); w8(0x5C0A, (a >> 8) & 0xFF); w8(0x5C0C, a >> 16);
  setScript(o, a);
}
function C02C59(o, n) {                  // flying-item script
  const a = scriptFor(0xC5C0B6, n, r16(o + 0x5E));
  w8(0x5C08, a & 0xFF); w8(0x5C0A, (a >> 8) & 0xFF); w8(0x5C0C, a >> 16);
  setScript(o, a);
}
function C09354(o, n) { setScript(o, scriptFor(0xC5C9B0, n, r16(o + 0x5E))); }       // re-aimed bounce
// one script step (C08AFB / C09405); false = the script has ended (landed)
function scriptStep(o) {
  const a = getScript(o);
  const f = mword(a);
  if (f === 0xFFFF) return false;
  w16(o, (r16(o) & 0xFFF0) | f);
  w16(o + 0x14, mword(a + 2));
  w16(o + 0x1C, mword(a + 4));
  setScript(o, a + 6);
  return true;
}
const animDir = (f) => (f & 2) ? 0 : (f & 4) ? 4 : (f & 4) ? 6 : 2;   // C092D4 (quirk: 6 unreachable)

// ---- AI danger marks / bomb rays (C0323F up, C032E5 down, C03386 left, C03423 right) --
function markRay(b, rayOff, dt, dg, mid, end, upGuard) {
  w16(0x5DAE, 0);
  let n = r8(b + 7) + 1;
  let t = r16(b + 2), gi = r16(b + 0x0A);
  let e = b + rayOff;
  for (;;) {
    t = (t + dt) & 0xFFFF; gi = (gi + dg) & 0xFFFF;
    w16(e, t); w16(e + 2, gi); w16(e + 4, mid);
    if (!r16(0x5DAE) && !(upGuard && gi >= 0x2000)) {
      const c = g(gi);
      if ((c & 0x80) || c === 0x44 || c === 0x43) w16(0x5DAE, 0xFFFF);
      else {
        if (r16(UNDER + gi) === 0x0E) w16(0x5E46, 0xFFFF);
        w16(DANGER + gi, 0xFFFF);
      }
    }
    if (--n === 0) break;
    e += 6;
  }
  w16(e + 4, end);
}
function markAll(b) {
  markRay(b, 0x10, -0x40, -0x80, 5, 1, true);
  markRay(b, 0x4C, 0x40, 0x80, 5, 2, false);
  markRay(b, 0x88, -2, -2, 6, 3, false);
  markRay(b, 0xC4, 2, 2, 6, 4, false);
}
// C0E303: clear the bomb's danger marks (centre + its 4 rays as stored)
function clearDanger(b) {
  w16(DANGER + r16(b + 0x0A), 0);
  const n0 = r8(b + 7) + 1;
  // C0E3E7 (up: also stops at a grid index >= $2000), C0E394, C0E355, C0E318
  for (const [off, guard] of [[0x10, true], [0x4C, false], [0x88, false], [0xC4, false]]) {
    let n = n0;
    for (let e = b + off; ; e += 6) {
      if (guard && r16(e + 2) >= 0x2000) break;
      if (r16(e) === 0xFFFF) break;
      w16(DANGER + r16(e + 2), 0);
      if (--n === 0) break;
    }
  }
}

// ======================================================================================
// C08230: per-object mover dispatch (called for every object in the list)
// ======================================================================================
export function update(p) {
  const f = r16(p);
  if (!(f & 0x8000)) return;
  if (f & 0x0800) return;
  const m = r16(p + 0x7E);
  if (m & 0x0080) return;
  switch ((m & 0x0F00) >> 8) {
    case 0: bomberMode(p); break;        // C08282
    case 1: bombMover(p); break;         // C08974
    case 2: itemMover(p); break;         // C093F6
    case 3: blockMover(p); break;        // C094B4
    default: break;                      // 4: C08281 (RTL)
  }
}

// ---- mode 0: bombers ------------------------------------------------------------------
function bomberMode(p) {                 // C08282
  if (!(r16(p + 0x52) & 0x0008)) {
    const b4 = r8(p + 0xB4);
    if (b4 === 0xFB) { tunnelStep(p); return; }
    if (!(b4 & 0x80)) return;
    if (r16(p + 0x52) & 0x0001) return;
    hopOut(p);                           // C0838C
  }
  C12F6C(p);
  C08302(p);
  const b4 = r8(p + 0xB4);
  if (b4 & 0x80) return;
  if (b4 === 0x43) return;
  snapCentre(p);                         // C0456D
  w16(p + 0x6A, r16(p + 0x5E));
  w16(p + 0x50, r16(p + 0x56));
  w16(p + 0x52, 0);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
}
function tunnelStep(p) {                 // C1043F (stage 3: standing on a closed tunnel cell)
  const d = r16(p + 0x18) < 0x80 ? 8 : 0xFFF8;
  w16(p + 0x18, (r16(p + 0x18) + d) & 0xFFFF);
}
export function snapCentre(p) {          // C0456D
  const [x, y] = move.cellCentre(r16(p + 0xA8));
  w16(0x5C0E, r16(p + 0xA8));
  w16(p + 0x10, x);
  w16(p + 0x18, y & r16(0x5D3C));
  zeroVel(p);
  centreCell(p);
}
function C08302(p) {                     // a falling block lands on a hopping bomber
  if (r8(p + 0xB4) !== 0xC1) return;
  if ((r16(p + 4) & 0x0020) && r8(p + 0xB9) !== 1) return;
  const sh = r8(p + 0xEF);
  if (!sh) { move.die(p); return; }
  w8(p + 0xEF, sh - 1);
  w8(p + 0xB9, 0xC0);
  w16(p + 4, r16(p + 4) | 0x0020);
}
function hopOut(p) {                     // C0838C: inside a solid cell -> hop out
  snapCentre(p);
  if (r16(p + 0x52) & 0x0002) dropCarried(p);
  w16(p + 0x52, 0x0809);
  const d = hopDir(p);                   // C0843E
  const e0 = wt(T.HOP_C5EB09, d * 4), e1 = wt(T.HOP_C5EB09, d * 4 + 2);
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
function hopDir(p) {                     // C0843E (battle): direction away from the edge
  let d = r16(p + 0x5E);
  if (!d) { d = 8; w16(p + 0x5E, 8); }
  const c2 = r8(p + 0xC2);
  if (c2) d = c2;
  const y = r16(p + 0x18), x = r16(p + 0x10);
  // edge limits of the 13x11 field (TODO tall: bottom row limit)
  if (y >= 0xD7) d = (d & 0x18) ? d & 0x18 : 0x10;
  else if (y < 0x28) d = (d & 0x18) ? d & 0x18 : 8;
  else if (x < 0x19) d = (d & 6) ? d & 6 : 2;
  else if (x >= 0xE7) d = (d & 6) ? d & 6 : 4;
  w16(0x40, d);
  w16(p + 0x5E, d);
  w16(p + 0x6A, wt(T.ANIM_C5EAE5, d));
  return d;
}

// C12F6C: wrap-around — an object over a cell whose tile is 0 (outside the arena)
// moves 16 px at a time (in its facing direction) until it is over a real tile.
function C12F6C(o) {
  if (r8(o + 0x42) & 0x08) return;
  if (r16(TILE + r16(o + 0xAA)) & 0x03FF) return;
  if (r16(o + 2) & 0x2000) return;
  const f = r16(o + 0x5E);
  let x = r16(o + 0x10), y = r16(o + 0x18);
  w16(0x4C, y); w16(0x4A, x);
  const horiz = f & 6;
  const step = (f & 2) || (f & 8) ? 0x10 : 0x1F0;   // +16 for R / D, -16 for L / U
  if (!(f & 0x1E)) return;
  let t;
  for (;;) {
    t = tileIndexAt(x, y);
    if (r16(TILE + t) & 0x03FF) break;
    if (horiz) { x = (x + step) & 0x1FF; w16(0x4A, x); }
    else { y = (y + step) & 0x1FF; w16(0x4C, y); }
  }
  w16(o + 0xAA, t);
  if (horiz) w16(o + 0x10, x); else w16(o + 0x18, y);
  centreCell(o);
}

// ======================================================================================
// mode 1: a bomb in motion (C08974)
// ======================================================================================
function bombMover(o) {
  w16(0x5C7E, g(r16(o + 0xA8)));
  const b = bombPtr(o);
  if (r16(o + 2) & 0x2000) { sinkInHole(o); return; }    // C13E86
  // the moving bomb's fuse runs on odd ticks (unless the round is over)
  if ((r16(0x32) & 1) && !(r16(0xB9) & 0x4000)) {
    const fuse = r8(b + 4);
    if (!((r16(b) & 1) && fuse >= 4) && fuse !== 1) w8(b + 4, fuse - 1);
  }
  const s = r16(o + 0x52);
  if (s & 0x0010) { flying(o, b); return; }               // C08AFB
  if (s & 0x0020) { kicked(o, b); return; }               // C08A01
  if (!(r16(o + 2) & 0x0200)) return;
  if (conveyed(o, b)) toBomb(o);                          // C087FC
}

function sinkInHole(o) {                 // C13E86: anim end -> object freed, bomb returned
  if (r16(o + 0x0C) !== 0x0FFF) return;
  freeMover(o);
  if (r16(o + 0x7E) === 0x0200) return;
  const b = bombPtr(o);
  returnBomb(ownerOf(b));
  w16(b, 0);
}

function itemUnder(o) {                  // shared by C08A30 / C0881F / C094D3: an item is
  w16(0x5C10, r16(o + 0xAA));            // under the mover: a skull flies away, others
  if (r16(TILE + r16(o + 0xAA)) === 0x160A) skullFly(o);   // are destroyed
  else restoreUnder(r16(o + 0xA8), r16(o + 0xAA));
}

function kicked(o, b) {                  // C08A01
  if (r16(o + 2) & 0x0400) return;
  const idx = r16(o + 0xA8);
  w16(0x5C0E, idx);
  const c = g(idx) & 0x3F;
  if (c === 1) { w8(b + 4, 1); toBomb(o); return; }        // rolled into fire
  if (c === 4) itemUnder(o);
  const bf = r16(b);
  if (!(!(bf & 0x80) && (bf & 1)) && r8(b + 4) === 1) { toBomb(o); return; }
  if (!nextFree(o)) { stopOrBounce(o); return; }           // C08537
  if (!nearCentre(o, 4)) { arrows(o); return; }            // C0895F
  const n = g(r16(0x54)) & 0xFF;
  if (!(n & 0x40) || n === 0x44 || n === 0x50) { arrows(o); return; }
  if (n === 0xC0) { reverse(o); return; }
  if (g(r16(o + 0xA8)) === 0x43) { kickToHop(o); return; }  // C10000
  stopOrBounce(o);
}
function stopOrBounce(o) {               // C08AA6
  if (r8(o + 0x42) & 0x08) reverse(o);   // rubber: roll back
  else toBomb(o);
}
// C08537: is the next cell free of objects? ($54 = next cell). Stuns a bomber in the
// way when the bomb has the power flag (b1) — an unused path in battle.
function nextFree(o) {
  const typ = r8(o + 0x42) & 0x1F;
  w16(0x58, typ);
  const here = r16(o + 0xA8);
  w16(0x56, here);
  const nxt = (r16(o + 0x46) + here) & 0xFFFF;
  w16(0x54, nxt);
  for (let x = 0; ; x += 2) {
    const q = r16(0x2620 + x);
    if (q === 0xFFFF) return true;
    if (q === o) continue;
    if (r16(q + 4) & 0x8000) continue;
    if ((r16(q + 0x7E) & 0x0F00) === 0x0400) continue;
    if (r16(q + 0x52) & 0x0810) continue;
    if (typ & 2) {
      if (q < 0x8400) { if (r16(q + 0xA8) === here) return powerHit(o, q); continue; }
    }
    if (!otherHeading(o, q, nxt) || r16(q + 0xA8) === nxt) {
      if (q < 0x8400 && (typ & 2)) return powerHit(o, q);
      return false;
    }
  }
}
function powerHit(o, q) {                // C085CF..C0860D
  if (r16(q + 0x52) & 0x0002) dropCarried(q);
  stun(q, o);                            // C084BB
  return true;
}
// C1050E: carry clear if another object's front cell ($2720) is $54 (and that object's
// list cells are cleared, C104EE)
function otherHeading(o, q, nxt) {
  for (let x = 0; ; x += 2) {
    const r = r16(0x2620 + x);
    if (r === 0xFFFF) return true;
    if (r === o) continue;
    if (!(r16(r) & 0x8000)) continue;
    if (r16(0x2720 + x) === nxt) {
      for (let y = 0; ; y += 2) {        // C104EE
        const s = r16(0x2620 + y);
        if (s === 0xFFFF) break;
        if (s === o) { w16(0x26A0 + y, 0); w16(0x2720 + y, 0); break; }
      }
      return false;
    }
  }
}
function reverse(o) {                    // C08613: snap to the cell, roll the other way
  const [x, y] = move.cellCentre(r16(o + 0xA8));
  w16(o + 0x10, x); w16(o + 0x18, y);
  w16(o, r16(o) ^ 0x000F);
  const f = wt(T.RUBDIR_C5ECBF, r16(o + 0x5E) * 2);
  w16(o + 0x5E, f);
  w16(o + 0x46, f === 2 ? 2 : f === 4 ? 0xFFFE : f === 8 ? 0x80 : 0xFF80);
}
function kickToHop(o) {                  // C10000: a kicked bomb meets a bomb -> hops over
  w16(0x5E5E, r16(0x73)); w16(0x5E60, r8(0x75));
  w16(o + 0x52, 0x10);
  w16(o + 0x18, (r16(o + 0x18) - 0x0E) & 0xFFFF);
  zeroVel(o);
  C02C03(o, 1);
  // quirk: the type comes from [$82], whatever that pointer was left at
  const pp = ((r8(0x84) & 1) << 16) | r16(0x82);
  const typ = r16(pp) & 0x1F;
  w8(o + 0x42, typ);
  w16(o + 0x6A, wt(T.ANIM_C5FC29, typ * 2));
}

// stage-9 arrows: a kicked bomb entering an arrow cell, near its centre, is redirected
function arrows(o) {                     // C10F81
  const c = g(r16(o + 0xA8)) & 0x3F;
  if (c < 0x3C) { w16(o + 0xC0, 0); return; }
  const s = r16(o + 0xC0);
  if (s & 0x8000) return;
  if (s & 1) return;
  if (!nearCentre(o, 6)) return;         // C5D900[4] = 6
  w16(o + 0xC0, s | 1);
  move.snapToCell(o);
  const t = g(r16(o + 0xA8));
  w16(0x5E, t);
  if (t === 0x3C) { w16(o, r16(o) | 2); w16(o + 0x1C, 2); w16(o + 0x46, 0xFF80); w16(o + 0x5E, 0x10); }
  if (t === 0x3D) { w16(o, r16(o) & 0xFFFD); w16(o + 0x1C, 2); w16(o + 0x46, 0x80); w16(o + 0x5E, 8); }
  if (t === 0x3E) { w16(o, r16(o) & 0xFFFE); w16(o + 0x14, 2); w16(o + 0x46, 2); w16(o + 0x5E, 2); }
  if (t === 0x3F) { w16(o, r16(o) | 1); w16(o + 0x14, 2); w16(o + 0x46, 0xFFFE); w16(o + 0x5E, 4); }
}

// ---- thrown / bouncing (C08AFB) ---------------------------------------------------------
function flying(o, b) {
  w16(o + 4, r16(o + 4) & 0xFFBF);
  if (scriptStep(o)) return;
  sfx(0x45);
  w16(o + 4, r16(o + 4) | 0x0040);
  const c = r16(0x5C7E);
  if (c >= 0x17 && c < 0x1B && conveyorBombHere(o)) { bounce(o); return; }
  if (!landingFree(o)) { bounce(o); return; }              // C104A0
  if (c === 0x11 || (c & 0x40)) { bounce(o); return; }
  if (!(r16(0xB9) & 0x8000)) { /* C11F95: normal game only */ }
  if (!hitBomber(o)) return;                              // C08D6A: stunned a bomber
  if ((r8(o + 0x42) & 0x08) && r8(b + 4) !== 1) { rubberLand(o); return; }  // C092FB
  emit('land', { cell: r16(o + 0xA8) });
  toBomb(o);
}
function conveyorBombHere(o) {           // C08C6F
  for (let x = 0; ; x += 2) {
    const q = r16(0x2620 + x);
    if (q === 0xFFFF) return false;
    if (r16(o + 0xA8) === r16(q + 0xA8) && (r16(q + 2) & 0x0200)) return true;
  }
}
function landingFree(o) {                // C104A0 (battle): no other mover here/heading here
  const here = r16(o + 0xA8);
  w16(0x54, here);
  for (let x = 8; ; x += 2) {
    const q = r16(0x2620 + x);
    if (q === 0xFFFF) return true;
    if (q === o) continue;
    if (!(r16(q) & 0x8000)) continue;
    if (r16(q + 0x52) & 0x0010) continue;
    if (r16(0x2720 + x) === here) return false;
    if (r16(q + 0xA8) === here) return false;
  }
}
// C093A2: bounce one more cell (rubber: in a random direction first)
function bounce(o) {
  if (r8(o + 0x42) & 0x08) {
    const f = wt(T.RANDDIR_C5FC6D, r16(0x408) & 0x1E);
    w16(o + 0x5E, f);
    w16(0x40, wt(T.DIRBITS_C5FAE7, f));
    w16(o, (r16(o) & 0xFF00) | wt(T.DIRBITS_C5FAE7, f));
  }
  hop(o);
}
export function hop(o) {                 // C093D1 (= C0939E)
  zeroVel(o);
  w16(o + 0x48, 0);
  C02BB9(o, 0);
  emit('bounce', { cell: r16(o + 0xA8) });
  C12F6C(o);
}
function rubberLand(o) {                 // C092FB: rubber bomb re-aims at random
  const f = wt(T.RANDDIR_C5FC6D, r16(0x408) & 0x1E);
  w16(o + 0x5E, f);
  w16(0x40, wt(T.DIRBITS_C5FAE7, f));
  w16(o, (r16(o) & 0xFF00) | wt(T.DIRBITS_C5FAE7, f));
  zeroVel(o);
  C09354(o, wt(T.DIST_C5EE0F, r16(0x404) & 0x1E));
  w16(0x5C0E, r16(o + 0xA8));
  const [x, y] = move.cellCentre(r16(o + 0xA8));
  w16(o + 0x10, x);
  w16(o + 0x18, y & r16(0x5D3C));
}

// C08D6A: does the landing bomb hit a bomber? Returns false (carry clear) if it did.
function hitBomber(o) {
  w16(0x5C04, 0);
  for (let k = 0; k < 4; k++) {
    const q = 0x8000 + k * 0x100;
    if (r16(q) & 0x0800) continue;
    if (r16(q + 0x52) & 0x0800) continue;
    if (r16(o + 0xA8) !== r16(q + 0xA8)) continue;
    if (r16(q + 0x52) & 0x0002) {        // the victim carries a bomb
      if (!(r8(o + 0x42) & 2) || (r8(q + 0x42) & 2)) { deflect(o, q); continue; }
      dropCarried(q);
    }
    stunHit(q, o);                       // C08E82
  }
  return !(r16(0x5C04) & 0x8000);
}
function deflect(o, q) {                 // C08E0A: bounces back off a carried bomb
  w16(o + 0x10, r16(q + 0x10)); w16(o + 0x18, r16(q + 0x18));
  zeroVel(o);
  setScript(o, scriptFor(0xC5C9B0, r16(o + 0x48), r16(o + 0x5E)));
  w16(o + 0x5E, wt(T.REVDIR_C5FAB5, r16(o + 0x5E)));
  w16(0x5C04, 0xFFFF);
}
function stunState(q) {                  // shared part of C08E82 / C084BB
  w16(q + 0x52, 1);
  w16(q + 0x6A, 0x10);
  w16(q + 0x50, 4);
  w16(q + 0x56, (r16(q + 4) & 0x0100) ? 2 : 0);
  w16(q + 0x0E, (r16(q + 0x0E) | 0x3000) & 0x3FFF);
  w16(q + 0x0C, 0);
  w16(q + 0x6E, 0);
  w16(0x5C04, 0xFFFF);
}
function stunHit(q, o) {                 // C08E82: a thrown bomb lands on bomber q
  if (r16(q + 0x52) & 0x0080) return;
  stunState(q);
  bounce(o);                             // C093A2
  if ((r16(0xB9) & 0x8000) || (r16(0x1A) & 0x0F) !== 7) dropItems(q);  // C0914A
  sfx(0x47);
  emit('stun', { player: (q - 0x8000) >> 8 });
}
function stun(q, o) {                    // C084BB (from a kicked power bomb)
  if (r16(q + 0x52) & 0x0080) return;
  stunState(q);
  if ((r16(0xB9) & 0x8000) || (r16(0x1A) & 0x0F) !== 7) dropItems(q);
  sfx(0x47);
  emit('stun', { player: (q - 0x8000) >> 8 });
}

// ---- back to a bomb (C08BDA) ---------------------------------------------------------
export function toBomb(o) {
  if (r16(0x5D60) & 0x8000) C08CC6(o);
  cellLookupFull(o);
  freeMover(o);                          // C08CA3 (x/y parked, +A8 kept)
  const b = bombPtr(o);
  const idx = r16(o + 0xA8);
  w16(b + 0x0A, idx);
  setG(idx, 0x43);
  w16(b + 2, r16(o + 0xAA));
  w16(b, r16(b) & 0xEFFF);
  // C10734: a thrown bomb lands with at least $38 on its fuse
  if ((r16(0xB9) & 0x8000) && (r16(o + 0x52) & 0x0010) && r8(b + 4) < 0x38) w8(b + 4, 0x38);
  powerTile(o, b);                       // C08CF0
  markAll(b);
  if ((r16(0x5C7E) & 0x3F) === 1) { w16(b, r16(b) | 0x80); w8(b + 4, 1); }
}
function C08CC6(o) {                     // ($5D60 b15) thrown bomb clears a stage latch
  if (!(r16(o + 0x52) & 0x0010)) return;
  const idx = r16(o + 0xA8);
  if (idx === 0x0410) w16(0x5CC4, 0);
  else if (idx === 0x0510) w16(0x5CC6, 0);
}
function powerTile(o, b) {               // C08CF0: stage 5 power tiles -> range 9
  const st = r16(0x1A);
  if (st !== 6 && (st & 0xF0) !== 0x10) return;
  const idx = r16(o + 0xA8);
  for (let x = 0; ; x += 4) {
    const v = r16(0x2FF0 + x);
    if (v & 0x8000) break;
    if (v === idx) { w8(b + 7, 9); return; }
  }
  if (r16(o + 0x7E) === 0xE9) w8(b + 7, r8(0x80F2));
}

// ---- conveyed bombs (stage 8): C087FC, carry set = becomes a bomb again --------------
function conveyed(o, b) {
  const idx = r16(o + 0xA8);
  w16(0x5C0E, idx);
  const c = g(idx) & 0x3F;
  if (c === 1) { w8(b + 4, 1); return true; }
  if (c === 4) itemUnder(o);
  const bf = r16(b);
  if (!(!(bf & 0x80) && (bf & 1)) && r8(b + 4) === 1) return true;
  if (!objectAheadFree(o)) { move.restoreX(o); move.restoreY(o); return false; }   // C088C2
  // C08944: not aligned to the grid -> keep moving
  const a = (r16(o + 0x10) | r16(o + 0x18)) & 0x0F;
  if (a >= 4 && a < 0x0C) return false;
  const n = r16(0x54);
  const c2 = g(n) & 0xFF;
  if (!(c2 & 0x40) || c2 === 0x44) return false;
  if (!r16(UNDER + n)) return false;
  // C088CC: snap to the nearest cell and stay
  let x = r16(o + 0x10);
  x = (x & 0x0F) >= 8 ? ((x & 0xF0) + 0x10) : (x & 0xF0);
  w16(o + 0x10, x); w16(0x5C2C, x); w16(0x5C2A, 0);
  let y = r16(o + 0x18);
  y = (y & 0x0F) >= 8 ? ((y & 0xF0) + 0x10) : (y & 0xF0);
  w16(o + 0x18, y); w16(0x5C30, y); w16(0x5C2E, 0);
  move.restoreX(o); move.restoreY(o);
  return false;
}
// C0865F: is the way ahead (motion direction) free of other objects? also $54 = next cell
function objectAheadFree(o) {
  const d = move.motionDir(o);
  if (!d) return false;
  const k = (d << 1) >> 8 & 0xFF;        // ASL, XBA: direction bit index * 2
  w16(0x54, (wt(T.DELTA_C5E392, k) + r16(o + 0xA8)) & 0xFFFF);
  const bits = wt(T.DIRS_C5E3A4, k);
  const x0 = r16(o + 0x10), y0 = r16(o + 0x18);
  const abs = (v) => { v &= 0xFFFF; return (v & 0x8000) ? (-v) & 0xFFFF : v; };
  for (let x = 0; ; x += 2) {
    const q = r16(0x2620 + x);
    if (q === 0xFFFF) return true;
    if (r16(q + 4) & 0x8000) continue;
    const qx = r16(q + 0x10), qy = r16(q + 0x18);
    if (bits & 0x100) {                  // C08758 right
      if (abs(qy - y0) >= 8) continue;
      const dx = (qx - x0) & 0xFFFF; if (dx && dx < 0x10) return false;
    } else if (bits & 0x200) {           // C087A8 left
      if (abs(qy - y0) >= 8) continue;
      const dx = (x0 - qx) & 0xFFFF; if (dx && dx < 0x10) return false;
    } else if (bits & 0x400) {           // C086B4 down
      if (abs(qx - x0) >= 8) continue;
      const dy = (qy - y0) & 0xFFFF; if (dy && dy < 0x10) return false;
    } else {                             // C08704 up
      if (abs(qx - x0) >= 8) continue;
      const dy = (y0 - qy) & 0xFFFF; if (dy && dy < 0x10) return false;
    }
  }
}

// ======================================================================================
// kick (C0AFAF, minus the C0AF76 velocity reset done by move.js). true = kicked.
// ======================================================================================
export function kick(p) {
  if (!r8(p + 0xFF)) return false;
  const here = r16(p + 0xA8);
  w16(0x50, here);
  const d = ((r16(p + 0x6E) >> 8) & 0x0F) * 2;
  let delta;
  if (d === 2) delta = 2; else if (d === 4) delta = 0xFFFE;
  else if (d === 8) delta = 0x80; else if (d === 0x10) delta = 0xFF80; else return false;
  w16(0x52, delta);
  const b = findBombAhead(here, delta);  // C0B1F8 -> $82
  if (b === null) return false;
  if (!kickTargetFree(p, b, delta)) return false;          // C0B155
  w16(b, r16(b) | 0x1000);
  w16(0x5C0E, r16(b + 0x0A));
  clearDanger(b);                        // C0E303
  const o = allocMover(p);
  if (o === null) return false;
  initObject(o, 'bomb');
  w16(o + 0x46, delta);
  w16(o + 0xA8, r16(b + 0x0A));
  const [x, y] = move.cellCentre(r16(0x5C0E));
  w16(o + 0x10, x);
  w16(o + 0x18, y & r16(0x5D3C));
  w16(o + 0x40, b & 0xFFFF);
  w16(o + 6, r8(b + 6) & 0x0F);
  w16(o + 0x52, 0x20);
  w16(o + 0xC0, 0x8000);
  zeroVel(o);
  w16(o + 2, 0);
  const f = d;                           // facing code (2 R, 4 L, 8 D, $10 U)
  w16(o + 0x5E, f);
  w16(o, r16(o) | wt(T.DIRBITS_C5FAE7, f));
  w16(o, r16(o) | (r16(p) & 0x000F));
  if (f >= 6) w16(o + 0x1C, 2); else w16(o + 0x14, 2);
  const typ = r16(b) & 0x1F;
  w8(o + 0x42, typ);
  w16(o + 0x6A, wt(T.ANIM_C5FC29, typ * 2));
  w16(o + 8, 0);
  restoreUnder(r16(b + 0x0A), r16(b + 2));
  sfx(0x44);
  emit('kick', { player: (p - 0x8000) >> 8, cell: r16(b + 0x0A), dir: f });
  return true;
}
function findBombAhead(here, delta) {    // C0B1F8: a bomb on cell+delta with fuse >= 3
  const want = (here + delta) & 0xFFFF;
  w16(0x54, want);
  w8(0x84, 0x7F);
  for (let k = 0; k < 0x28; k++) {
    const b = 0x12000 + k * 0x100;
    w16(0x82, b & 0xFFFF);
    const f = r16(b);
    if (!(f & 0x8000) || (f & 0x0800) || (f & 0x5000)) continue;
    if (r16(b + 0x0A) !== want) continue;
    return r8(b + 4) >= 3 ? b : null;
  }
  w16(0x82, 0x4800);
  return null;
}
function kickTargetFree(p, b, delta) {   // C0B155
  const nxt = (r16(b + 0x0A) + delta) & 0xFFFF;
  w16(0x54, nxt);
  const c = g(nxt) & 0xFF;
  if ((c & 0x40) && c !== 0x44 && c !== 0x50) return false;
  for (let x = 0; ; x += 2) {
    const q = r16(0x2620 + x);
    if (q === 0xFFFF) return true;
    if (r16(q + 4) & 0x8000) continue;
    if ((r16(q + 0x7E) & 0x0F00) === 0x0400) continue;
    if (r16(q + 0x52) & 0x0800) continue;
    if (r16(q + 0xA8) !== nxt) continue;
    if (q >= 0x8400 || !(r16(b) & 0x0002)) return false;
    stun(q, null);                       // kicked power bomb stuns the bomber there
    return true;
  }
}

// ======================================================================================
// power glove
// ======================================================================================
// C02F6E: A on your own bomb (fuse >= 4) -> lift it (+52 |= 3); the bomb is held (+00
// b12) and its cell restored. The 15-tick lift animation then sets +52 = 6 (anim.js).
export function lift(p) {
  if (r16(p + 0x52) & 0x0803) return;
  const here = r16(p + 0xA8);
  w16(0x42, here);
  let b = null;
  for (let k = 0; k < 0x28; k++) {
    const q = 0x12000 + k * 0x100;
    const f = r16(q);
    if (!(f & 0x8000) || (f & 0x5000)) continue;
    if (r16(q + 0x0A) === here) { b = q; break; }
  }
  if (b === null) return;
  if (r8(b + 4) < 4) return;
  clearDanger(b);                        // C0E2F7 -> C0E303
  if ((r8(b + 6) << 8) !== (p & 0x0F00)) return;           // only your own bomb
  w16(p + 0x40, b & 0xFFFF);
  w8(p + 0x42, r16(b) & 0x1F);
  w16(p + 0x52, r16(p + 0x52) | 3);
  w16(p + 0x6A, wt(T.ANIM_C5EE2F, r16(p + 0x5E)));
  const a = (r16(p + 0x50) + 1) & 0xFFFF;
  w16(p + 0x50, a); w16(p + 0x56, a);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  w16(p + 0x0C, 0);
  w16(b, r16(b) | 0x1000);
  restoreUnder(r16(b + 0x0A), r16(b + 2));
  sfx(0x48);
  emit('lift', { player: (p - 0x8000) >> 8, cell: here });
}

// C02CAF: A released while carrying (+52 b2) -> throw in the facing direction.
export function throwRelease(p) {
  w16(p + 0x52, (r16(p + 0x52) & 1) | 1);
  w16(p + 0x6A, wt(T.ANIM_C5EE41, r16(p + 0x5E)));
  w16(p + 0x56, (r16(p + 0x50) - 1) & 0xFFFF);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  const o = allocMover(p);
  if (o === null) return;
  initObject(o, 'bomb');
  w16(o + 0x40, r16(p + 0x40));
  w16(o + 6, r16(p + 0x2A));
  w16(o + 0x10, r16(p + 0x10));
  w16(o + 0x18, (r16(p + 0x18) - 0x10) & r16(0x5D3C));
  w16(o + 0x52, 0x10);
  w16(o + 2, 0);
  zeroVel(o);
  let f = r16(p + 0x5E) & 0x1F;
  if (!f) f = 8;                         // (battle)
  w16(o + 0x5E, f);
  w16(o, r16(o) | wt(T.DIRBITS_C5FAE7, f));
  w16(o + 0x48, throwDistance(p));       // C02DCF
  C02C03(o, r16(o + 0x48));
  const typ = r8(p + 0x42);
  w8(o + 0x42, typ);
  w16(o + 0x6A, wt(T.ANIM_C5FC29, typ * 2));
  w16(o + 8, 1);
  sfx(0x43);
  emit('throw', { player: (p - 0x8000) >> 8, dir: f, cells: r16(o + 0x48) });
}
// C02DCF: 3 cells, or 2..5 to land on a bomber standing in line (cells 2..5 ahead)
function throwDistance(p) {
  const f = r16(p + 0x5E);
  let step;
  if (f === 2) step = 4; else if (f === 4) step = -4; else if (f === 8) step = 0x100;
  else if (f === 0x10) step = -0x100; else return 3;     // C02DE8: (C02E4F) then 3
  // C02ECD (R) / C02E90 (L): start at +-4 (2 cells); C02E4F (D) / C02E0E (U): +-$100
  let c = (r16(p + 0xA8) + step) & 0xFFFF;
  const inc = step === 4 ? 2 : step === -4 ? -2 : step === 0x100 ? 0x80 : -0x80;
  for (let y = 2; y < 6; y++) {
    for (let k = 0; k < 4; k++) if (r16(0x8000 + k * 0x100 + 0xA8) === c) return y;
    c = (c + inc) & 0xFFFF;
  }
  return 3;
}

// C0A743: a bomber that dies / is hit while carrying drops its bomb: it hops one cell
// in a random direction.
export function dropCarried(p) {
  const o = allocMover(p);
  if (o === null) return;
  initObject(o, 'bomb');
  w16(o + 0x40, r16(p + 0x40));
  w16(o + 6, r16(p + 6));
  w16(o + 0x10, r16(p + 0x10));
  w16(o + 0x18, (r16(p + 0x18) - 0x10) & r16(0x5D3C));
  w16(o + 0x52, 0x10);
  zeroVel(o);
  const f = wt(T.RANDDIR_C5FC6D, r16(0x400) & 0x1E);
  w16(o + 0x5E, f);
  w16(o, r16(o) | wt(T.DIRBITS_C5FAE7, f));
  w16(o + 0x48, 1);
  C02C03(o, 1);
  const typ = r8(p + 0x42);
  w8(o + 0x42, typ);
  w16(o + 0x6A, wt(T.ANIM_C5FC29, typ * 2));
}

// X button (C029FD loop body C029C0): stop your own kicked bomb where it is. bombs.js
// zeroes the velocities (C02994) and calls this with the mover.
export function stopKicked(o) {
  toBomb(o);                             // C08BDA
  emit('kickStop', { cell: r16(o + 0xA8) });
}

// ======================================================================================
// flying items (mode 2)
// ======================================================================================
// C0EE71: a bombed skull flies 3 cells in a random direction ($5C0E = its cell,
// $5C10 = its tile index). Called by the explosion code (bombs.js, C0EF86) and by a
// kicked bomb rolling over a skull.
export function skullFly(cur = r16(0x6A)) {
  const o = allocMover(cur);
  if (o === null) return;
  initObject(o, 'item');
  const [x, y] = move.cellCentre(r16(0x5C0E));
  w16(o + 0x10, x);
  w16(o + 0x18, (y - 0x0E) & 0xFFFF);
  w16(o + 0x4A, 0x160A);
  zeroVelQuirk(o);
  const k = (r16(0x5C12) + 2) & 0x1E;
  w16(0x5C12, k);
  const f = wt(T.RANDDIR_C5FC6D, r16(0x400 + k) & 0x1E);
  w16(o + 0x5E, f);
  w16(o, r16(o) | wt(T.DIRBITS_C5FAE7, f));
  C02C03(o, 3);
  w16(o + 0x6A, animDir(r16(o + 0x5E)));
  restoreUnder(r16(0x5C0E), r16(0x5C10));
  emit('itemFly', { item: 0x160A, cell: r16(0x5C0E) });
}

// C09231: launch one item (kind $5C84) out of bomber src; $5C72 = index into the
// per-tick RNG table for its direction and distance.
export function spawnFlyingItem(src, cur = r16(0x6A)) {
  const o = allocMover(cur);
  if (o === null) return;
  initObject(o, 'item');
  w16(o + 0x10, r16(src + 0x10));
  w16(o + 0x18, (r16(src + 0x18) - 0x10) & r16(0x5D3C));
  w16(o + 0x4A, r16(0x5C84));
  zeroVelQuirk(o);
  const k = r16(0x5C72);                 // (the AND #$1E before LDA $0400,X is discarded)
  const f = wt(T.RANDDIR_C5FC6D, r16(0x400 + k) & 0x1E);
  w16(o + 0x5E, f);
  w16(o, r16(o) | wt(T.DIRBITS_C5FAE7, f));
  C02C59(o, wt(T.DIST_C5EE0F, r16(0x400 + k) & 0x1E));
  w16(o + 0x6A, animDir(r16(o + 0x5E)));
  emit('itemFly', { item: r16(0x5C84), from: (src - 0x8000) >> 8 });
}
// C09850: the skull of a cured disease flies out of bomber src (item pickup, C0980D)
export function skullOut(src) {
  w16(0x5C74, 1);
  w16(0x5C72, 0);
  w16(0x5C84, 0x160A);
  spawnFlyingItem(src);
}

function itemMover(o) {                  // C093F6
  if (r16(o + 2) & 0x2000) { sinkInHole(o); return; }
  if (scriptStep(o)) return;
  sfx(0x5F);
  const c = g(r16(o + 0xA8));
  w16(0x5C0C, c);
  if (c === 0x12 || c === 0x13 || c === 0x11 || (c & 0x40) || c === 1) { hop(o); return; }
  w16(TILE + r16(o + 0xAA), r16(o + 0x4A));
  setG(r16(o + 0xA8), 0x44);
  emit('itemLand', { item: r16(o + 0x4A), cell: r16(o + 0xA8) });
  freeMover(o);
}

// C0914A: a stunned bomber drops 1..3 items (count $C5EDFF[$0404 & 15], minus the
// skulls it carries first), each a flying item.
export function dropItems(q) {
  if (r16(q + 0x52) & 0x0080) return;
  w16(q + 0x52, r16(q + 0x52) | 0x0080);
  const r = r16(0x404) & 0x0F;
  w16(0x5C78, r);
  w16(0x5C70, T.DROPN_C5EDFF[r] & 0x0F);
  skullsOut(q);                          // C091BB
  let n = (r16(0x5C70) - r16(0x5C74)) & 0xFFFF;
  if (n === 0 || (r16(0x5C70) < r16(0x5C74))) return;
  w16(0x5C70, n);
  w16(0x5C72, 0);
  for (;;) {
    pickDrop(q);                         // C08F02
    if (r16(0x5C84) === 0xFFFF) return;
    spawnFlyingItem(q);
    w16(0x5C72, r16(0x5C72) + 2);
    n = r16(0x5C70) - 1;
    if (!n) return;
    w16(0x5C70, n);
  }
}
function skullsOut(q) {                  // C091BB: carried skulls (+E9) / disease go first
  let n = r8(q + 0xE9);
  w16(0x5C74, n); w16(0x5C76, n);
  if (!n) {
    if (!r8(q + 0xF5)) { w16(0x5C74, 0); w16(0x5C76, 0); return; }
    w16(0x5C74, 1); w16(0x5C76, 1);
  }
  w16(0x5C72, 0);
  w16(0x5C84, 0x160A);
  for (;;) {
    spawnFlyingItem(q);
    w16(0x5C72, r16(0x5C72) + 2);
    const k = r16(0x5C76) - 1;
    if (!k) break;
    w16(0x5C76, k);
  }
  w8(q + 0xE9, 0);
  w8(q + 0xF5, 0);
}
// C08F02: try up to 16 item kinds starting at $5C78 until one can be taken from q;
// $5C84 = its tile ($FFFF = none). The handlers take the item off the bomber's stats.
function pickDrop(q) {
  w16(0x5C7A, 0);
  for (;;) {
    w16(0x5C84, 0xFFFF);
    const k = T.DROPK_C5EDDD[r16(0x5C78)] >> 2;
    DROP[k](q);
    if (r16(0x5C84) !== 0xFFFF) return;
    w16(0x5C78, (r16(0x5C78) + 1) & 0x0F);
    const c = r16(0x5C7A) + 1;
    w16(0x5C7A, c);
    if (c === 0x10) return;
  }
}
const dec8 = (q, off) => w8(q + off, r8(q + off) - 1);
const DROP = [
  (q) => {                               // C08F5B speed up (not on stage 7)
    if (r16(0x1A) === 8) return;
    if (r8(q + 0xE0) < 2) return;
    dec8(q, 0xE0); w16(0x5C84, 0x1622);
    if (r8(q + 0xF0) >= 2) dec8(q, 0xF0);
  },
  (q) => {                               // C08F8C bomb up
    if (r8(q + 0xE1) < 2) return;
    dec8(q, 0xE1);
    if (r8(q + 0xF1)) dec8(q, 0xF1); else if (r8(q + 0xF8)) dec8(q, 0xF8);
    w16(0x5C84, 0x1600);
  },
  (q) => {                               // C08FC0 fire up (full fire: C08FF9)
    if (r8(q + 0xF4)) {
      if (r8(q + 0xE4) < 2) return;
      dec8(q, 0xE4); w16(0x5C84, 0x1602); return;
    }
    if (r8(q + 0xE2) < 2) return;
    dec8(q, 0xE2); dec8(q, 0xE4); w16(0x5C84, 0x1602);
    if (r8(q + 0xF2) >= 2) dec8(q, 0xF2);
  },
  (q) => {                               // C09013 full fire
    const v = r8(q + 0xF4);
    if (!v) return;
    w8(q + 0xF4, v - 1);
    if (v - 1 === 0) { const e4 = r8(q + 0xE4); w8(q + 0xE2, e4); w8(q + 0xF2, e4); }
    w16(0x5C84, 0x1606);
  },
  (q) => { if (r8(q + 0xFE)) { dec8(q, 0xFE); w16(0x5C84, 0x1626); } },   // C0903E glove
  (q) => { if (r8(q + 0xFF)) { dec8(q, 0xFF); w16(0x5C84, 0x1624); } },   // C09058 kick
  (q) => typeDrop(q, 0xE5, 0x1604, 4),    // C09072 pierce
  (q) => typeDrop(q, 0xE6, 0x160E, 1),    // C0909B remote
  (q) => typeDrop(q, 0xE7, 0x162A, 2),    // C090C4 power
  (q) => typeDrop(q, 0xE8, 0x1628, 8),    // C090ED rubber
  (q) => { if (r8(q + 0xFA)) { dec8(q, 0xFA); w16(0x5C84, 0x1608); } },   // C09116 bomb pass
  (q) => { if (r8(q + 0xFB)) { dec8(q, 0xFB); w16(0x5C84, 0x1620); } },   // C09130 wall pass
];
function typeDrop(q, cnt, tile, type) {
  if (!r8(q + cnt)) return;
  dec8(q, cnt);
  w16(0x5C84, tile);
  if (r8(q + 0xF3) === type) w8(q + 0xF3, 0);
}

// ======================================================================================
// mode 3: a pushed soft block (stage 2), C094B4
// ======================================================================================
function blockMover(o) {
  const idx = r16(o + 0xA8);
  w16(0x5C0E, idx);
  const c = g(idx) & 0x3F;
  if (c === 1) { blockStop(o); blockBurn(o); return; }    // C09543, C0958B
  if (c === 4) itemUnder(o);
  if (!blockAheadFree(o)) { blockStop(o); return; }       // C095CA
  const n = g(r16(0x54)) & 0xFF;
  if (!(n & 0x40)) return;
  if (n === 0x44) return;
  blockStop(o);
}
function blockStop(o) {                  // C09543: becomes a soft block again
  w16(0x5CAC, r16(o + 0xAA));
  w16(0x5CAA, r16(o + 0xA8));
  w16(o, 0);
  zeroVel(o);
  w16(o + 0x10, 0x1FF); w16(o + 0x18, 0xF0);
  setG(r16(0x5CAA), 0xC2);
  w16(TILE + r16(0x5CAC), 0x1C02);
}
function blockBurn(o) {                  // C0958B: queue it in the burn list (8-byte
  for (let y = 0x20, x = 0; y; y--, x += 8) {              // stride — sic)
    const v = r16(0x10000 + x);
    if (v & 0x8000) {
      w16(0x10000 + x, r16(0x5CAC)); w16(0x10002 + x, r16(0x5CAA));
      w16(0x10004 + x, 2); w16(0x10006 + x, 3);
      return;
    }
    if (v === r16(0x4A)) return;
  }
}
function blockAheadFree(o) {             // C095CA
  const here = r16(o + 0xA8);
  w16(0x56, here);
  const nxt = (r16(o + 0x46) + here) & 0xFFFF;
  w16(0x54, nxt);
  for (let x = 0; ; x += 2) {
    const q = r16(0x2620 + x);
    if (q === 0xFFFF) return true;
    if (r16(q + 0x52) & 0x0810) continue;
    if (!otherHeading(o, q, nxt)) return false;
    if (r16(q + 0xA8) === nxt) return false;
  }
}
