// COM AI — C0C54B and everything it calls (SPEC §15, tools/sb2/re/notes-ai.md,
// corrections in tools/sb2/NOTES-core-ai.md). A faithful transliteration, quirks
// included. The AI only writes the bomber's +6E "pad" word (consumed by movement and
// the bomb code like a human pad), its latches in +0E, its own fields
// (+38 +BE +D4 +D6 +D8 +DA +DC +DE +EC +EE), the plan buffer $0500 + $100*slot and the
// scan scratch words $7E5DB8..$5DD4. The random walk calls the shared RNG (C00CAA).
//
// Plan buffer: 4-byte entries [direction word, count word], $FFFF direction = end.
// +BE: bit 15 = a plan is active, bit 14 = escape mode.
import { r8, r16, w8, w16, OBJ } from './mem.js';
import { rng } from './rng.js';
import * as move from './move.js';
import { isTall } from './geom.js';

const GRID = 0x1C000, DANGER = 0x18000;

// ROM tables (indexed by COM level +D2 = 0..8, or as noted)
const CHASE = [0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48, 0x50, 0x50];     // $C1CE94
const BOMBBOX = [0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48, 0x50, 0x50];   // $C1CEA6
const STUCK = [0xC0, 0xC0, 0x80, 0x80, 0x80, 0x40, 0x40, 0x20, 0x10];     // $C1CE02
const HOLD = [0xC0, 0xC0, 0xC0, 0x80, 0x80, 0x40, 0x40, 0x20, 0x10];      // $C1CDF0
const WALK_DIR = [0x800, 0x400, 0x200, 0x100];                            // $C1CE14 (repeats, by r & $1E)
const WALK_DELTA = [0xFF80, 0x0080, 0xFFFE, 0x0002];                      // $C1CE34 (repeats)
const WALK_LEN = [8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 10, 11, 12, 13];    // $C1CE54
const WALK_LEN4 = [3, 4, 5, 6, 3, 4, 5, 6, 3, 4, 5, 6, 7, 8, 9, 10];      // $C1CE74 (stage 4, $1A = 5)
const CENTRE = [2, 3, 4, 5, 6, 6, 6, 6];                                  // $C5D900 (by speed & 7)
// C0D008 / C0CF7C / C0CFC2 / C0D04E: target order per slot (first one not dying)
const TARGETS = [[2, 1, 3], [3, 0, 2], [0, 3, 1], [1, 2, 0]];

const u = (v) => v & 0xFFFF;
const grid = (idx) => (idx < 0x4000 ? r16(GRID + idx) : 0xFFFF);  // $7FC000,X (X < $4000 in practice)
const danger = (idx) => r16(DANGER + idx);
const absd = (v) => { v = u(v); return v & 0x8000 ? u(-v) : v; }; // SEC/SBC, BPL, EOR #$FFFF, INC
const lvl = (p) => r16(p + 0xD2);
const plan = (p) => 0x500 + (p & 0x0F00);                         // plan buffer of the bomber
// C0D504: [$97] = $C5D5B6[slot] (= $00:0500 + $100*slot); C01DCB leaves $40 = slot (slot != 0)
function setPlan(p) {
  const slot = (p >> 8) & 0x0F;
  if (slot) w16(0x40, slot);
  w16(0x97, 0x500 + slot * 0x100); w8(0x99, 0);
  return 0x500 + slot * 0x100;
}

function cancelPlan(p) {                 // BE &= $3FFF ; [$97] = $FFFF
  w16(p + 0xBE, r16(p + 0xBE) & 0x3FFF);
  w16(r16(0x97), 0xFFFF);
}

function facing(p) {                     // C0CD2C -> +DA
  const i = r16(p + 0x6E);
  const d = i & 0x200 ? 0xFFFE : i & 0x100 ? 0x0002 : i & 0x800 ? 0xFF80 : 0x0080;
  w16(p + 0xDA, d);
  return d;
}

function nearCentre(p, n) {              // C19BFB (+ C0EE1C): |x - cx| < n && |y - cy| < n
  const idx = r16(p + 0xA8);
  w16(0x40, idx);
  const cx = u(((idx & 0x7F) << 3) - r16(0x5F01) + 8) & 0x1FF;
  const cy = u(((idx & 0xF80) >> 3) - r16(0x5EFB) + 7) & 0x1FF;
  w16(0x42, cx); w16(0x44, cy);
  if (absd(r16(p + 0x10) - cx) >= n) return false;
  if (absd(r16(p + 0x18) - cy) >= n) return false;
  return true;
}

function pressA(p) {                     // C0CCE6
  if (r16(p + 0x52) & 0x0002) return;   // holding a bomb
  if (grid(r16(p + 0xA8)) === 0x000E) return;
  w16(p + 0x6E, r16(p + 0x6E) | 0x0080);
  w16(p + 0x0E, r16(p + 0x0E) & 0xFBFF);
  if (r8(p + 0xFE) & 0xFF) return;      // glove: no cooldown reset
  w16(p + 0xD8, 0);
}

function pressY(p) {                     // C0C628
  w16(p + 0x6E, r16(p + 0x6E) | 0x4000);
  w16(p + 0x0E, r16(p + 0x0E) & 0xFEFF);
}

// ---- 1. stuck-in-cell timer (C106D8) -------------------------------------------------
function stuckTimer(p) {
  const c = r16(p + 0xA8);
  if (c !== r16(p + 0x38)) { w16(p + 0x38, c); w16(p + 0xEC, 0); return; }
  const n = u(r16(p + 0xEC) + 1);
  w16(p + 0xEC, n);
  if (STUCK[lvl(p)] >= n) return;
  w16(p + 0xEC, 0);
  setPlan(p);                            // C10714
  w16(0x94, r16(0x97)); w8(0x96, r8(0x99));
  cancelPlan(p);
}

// ---- 2. planners (C0CE32) ------------------------------------------------------------
function planners(p) {
  if (r16(p + 0xBE) & 0x8000) return;
  // C0BEA6: cell under the centre again (same result as C0A4F7 this tick; it also
  // rewrites the scratch $4A/$4C/$4E that later routines may read)
  (move.centreCell || move.cellLookup)(p);
  w16(p + 0xDE, r16(p + 0xA8));
  planSoft(p);                           // C0D112, phase 3
  planItem(p);                           // C0D0E7, phase 2
  planChase(p);                          // C0CE59, phase 1
  planRandom(p);                         // C0D441, phases 1-3
}

// line scan for a target cell value (C0D344.. soft $C2 / C0D13D.. item $44): returns
// dir | n (n = free cells passed) or $FFFF. Bombs and solid cells stop it.
function lineScan(p, delta, dir, target, upGuard) {
  let c = r16(p + 0xA8), n = 0;
  w16(0x5E, c); w16(0x5C, 0);
  for (;;) {
    const nc = u(c + delta);
    if (upGuard && nc >= 0x2000) return 0xFFFF;
    c = nc;
    w16(0x5E, c);
    const v = grid(c);
    if (v === target) return (n | dir) & 0xFFFF;
    if (v === 0x0043 || (v & 0x0080)) return 0xFFFF;
    n = (n + 1) & 0xFFFF;                // INC $5C
    w16(0x5C, n);
  }
}

function scans(p, target) {              // results in $5DD4 R, $5DD2 L, $5DD0 U, $5DCE D
  w16(0x5DD4, lineScan(p, 0x0002, 0x0100, target, false));
  w16(0x5DD2, lineScan(p, 0xFFFE, 0x0200, target, false));
  w16(0x5DD0, lineScan(p, 0xFF80, 0x0800, target, true));
  w16(0x5DCE, lineScan(p, 0x0080, 0x0400, target, false));
}

const PRIO = [[0x5DCE, 0x0400], [0x5DD0, 0x0800], [0x5DD2, 0x0200], [0x5DD4, 0x0100]]; // D, U, L, R

function planSoft(p) {                   // C0D112 + C0D2BC
  if ((r16(0x32) & 3) !== 3 || (r16(p + 0xBE) & 0x8000)) return;
  const b = setPlan(p);
  scans(p, 0x00C2);
  for (const [a, dir] of PRIO) {
    const v = r16(a);
    if (v & 0x8000) continue;
    w16(b, dir);                         // quirk: the direction is written even if n = 0
    if (!(v & 0xFF)) return;             // adjacent block: no plan
    w16(b + 2, (v & 0xFF) + 1);
    w16(p + 0xBE, 0x8000);
    w16(p + 0xDC, 0);
    // quirk: no $FFFF terminator is written (C0D33D loads it but never stores it), so
    // the walk continues with whatever entries the buffer still holds after entry 0.
    return;
  }
}

function planItem(p) {                   // C0D0E7 + C0D23A
  if ((r16(0x32) & 3) !== 2 || (r16(p + 0xBE) & 0x8000)) return;
  const b = setPlan(p);
  scans(p, 0x0044);
  for (const [a, dir] of PRIO) {
    const v = r16(a);
    if (v & 0x8000) continue;
    w16(b, dir);
    w16(b + 2, (v & 0xFF) + 1);
    w16(p + 0xBE, 0x8000);
    w16(p + 0xDC, 0);
    w16(b + 4, 0xFFFF);
    return;
  }
}

function planChase(p) {                  // C0CE59
  if ((r16(0x32) & 3) !== 1 || (r16(p + 0xBE) & 0x8000)) return;
  const b = setPlan(p);
  const slot = (p >> 8) & 0x0F;
  w16(p + 0xD4, 0);
  for (const q of TARGETS[slot]) {
    if (!(r16(OBJ + q * 0x100) & 0x0800)) { w16(p + 0xD4, OBJ + q * 0x100); break; }
  }
  const thr = CHASE[lvl(p)];
  w16(0x5A, thr);
  const t = r16(p + 0xD4);               // C0CE91
  if (!(t & 0x8000)) return;
  w16(0x88, t); w8(0x8A, 0x7E);
  const put = (dir) => { w16(0x50, dir); w16(b, dir); w16(b + 2, 4); w16(b + 4, 0xFFFF); w16(p + 0xBE, 0x8000); };
  // quirk: on the negative branch the code reloads A with the step constant ($0002 /
  // $0080, stored to $52) before the CMP, so a target to the RIGHT is never chased
  // horizontally (2 < threshold) and a target BELOW is always chased down (0x80 >= any
  // threshold) whatever the distance.
  let d = u(r16(p + 0x10) - r16(t + 0x10)), dir = 0x200;
  w16(0x52, 0xFFFE);
  if (d & 0x8000) { d = 0x0002; dir = 0x100; w16(0x52, 2); }
  if (d >= thr) { put(dir); return; }
  d = u(r16(p + 0x18) - r16(t + 0x18)); dir = 0x800;
  w16(0x52, 0xFF80);
  if (d & 0x8000) { d = 0x0080; dir = 0x400; w16(0x52, 0x80); }
  if (d >= thr) put(dir);
}

function planRandom(p) {                 // C0D441
  if (!(r16(0x32) & 3) || (r16(p + 0xBE) & 0x8000)) return;
  const b = setPlan(p);
  w16(0x5E, 1);
  rng();                                 // C0D45C
  const k = (r16(0x400) & 0x1E) >> 1;
  const nb = u(WALK_DELTA[k & 3] + r16(p + 0xA8));   // C0D4BB
  if (grid(nb) & 0x0080) {
    w16(p + 0x6E, r16(p + 0x6E) & 0xF0FF);
    w16(p + 0xBE, r16(p + 0xBE) & 0x3FFF);
    w16(b, 0); w16(b + 2, 0x10); w16(b + 4, 0xFFFF);
  } else {
    w16(b, WALK_DIR[k & 3]);
    const j = (r16(0x402) & 0x1E) >> 1;
    w16(b + 2, (r16(0x1A) === 5 ? WALK_LEN4 : WALK_LEN)[j]);
    w16(b + 4, 0xFFFF);
    w16(0x97, r16(0x97) + 4);            // the pointer itself advances (INC $97 x4)
    w16(0x5E, 0);
  }
  w16(p + 0xBE, r16(p + 0xBE) | 0x8000);
  w16(p + 0xDC, 0);
}

// ---- 3. danger / escape (C0C990, C0C9A8) --------------------------------------------
function dangerCheck(p) {
  if (r16(p + 0xBE) & 0x4000) return;
  if (!danger(r16(p + 0xA8))) return;
  escape(p);
}

// C17EB5 (R) / C17E08 (L) / C17CA9 (U) / C17D5B (D). result word: bit 15 = found,
// bit 1 = via a side cell, bit 0 = second side; count word = cells walked.
function escScan(p, delta, s1, s2, resA, upGuard) {
  w16(resA, 0); w16(resA + 2, 0);
  let c = r16(p + 0xA8);
  w16(0x50, c);
  for (;;) {
    const nc = u(c + delta);
    w16(0x50, nc);
    if (upGuard && nc >= 0x2000) return;
    c = nc;
    const v = grid(c);
    if (v === 0x000E || v === 0x0043 || v === 0x0001 || (v & 0x0080)) return;
    w16(resA + 2, u(r16(resA + 2) + 1));
    if (!danger(c)) { w16(resA, r16(resA) | 0x8000); return; }
    const side = (x) => { const w = grid(x); return !(w === 0x0043 || w === 0x0001 || (w & 0x0080)) && !danger(x); };
    if (side(u(c + s1))) { w16(resA, (r16(resA) | 0x8002) & 0xFFFE); return; }
    if (side(u(c + s2))) { w16(resA, r16(resA) | 0x8003); return; }
  }
}

function escape(p) {                     // C0C9A8
  escScan(p, 0x0002, 0xFF80, 0x0080, 0x5DB8, false);   // R
  escScan(p, 0xFFFE, 0xFF80, 0x0080, 0x5DBC, false);   // L
  escScan(p, 0xFF80, 0xFFFE, 0x0002, 0x5DC0, true);    // U
  escScan(p, 0x0080, 0xFFFE, 0x0002, 0x5DC4, false);   // D
  const b = setPlan(p);
  if (!((r16(0x5DB8) | r16(0x5DBC) | r16(0x5DC4) | r16(0x5DC0)) & 0x8000)) { trapped(p, b); return; }
  w16(p + 0xBE, r16(p + 0xBE) | 0xC000);
  w16(p + 0xDC, 0);
  // C0CA75 horizontal: farther exit wins, ties R
  let h = 0, hn = 0xFFFF;
  if (r16(0x5DB8) & 0x8000) {
    if (r16(0x5DBC) & 0x8000) { h = 1; hn = r16(0x5DBA); if (hn < r16(0x5DBE)) { h = 2; hn = r16(0x5DBE); } }
    else { h = 1; hn = r16(0x5DBA); }
  } else if (r16(0x5DBC) & 0x8000) { h = 2; hn = r16(0x5DBE); }
  // C0CA26 vertical: farther wins, ties D
  let v = 0, vn = 0xFFFF;
  if (r16(0x5DC4) & 0x8000) {
    if (r16(0x5DC0) & 0x8000) { v = 4; vn = r16(0x5DC6); if (vn < r16(0x5DC2)) { v = 8; vn = r16(0x5DC2); } }
    else { v = 4; vn = r16(0x5DC6); }
  } else if (r16(0x5DC0) & 0x8000) { v = 8; vn = r16(0x5DC2); }
  w16(0x52, v); w16(0x54, vn); w16(0x56, hn);
  const ch = vn < hn ? v : h;            // C0CA11
  w16(0x58, ch);
  // ($58 also held h in between; final value is the choice)
  // C0CAC4 R / C0CB06 L / C0CB48 D / C0CB8A U
  let dir, res, n, t1, t2;
  if (ch & 8) { dir = 0x800; res = r16(0x5DC0); n = r16(0x5DC2); t1 = 0x200; t2 = 0x100; }
  else if (ch & 4) { dir = 0x400; res = r16(0x5DC4); n = r16(0x5DC6); t1 = 0x200; t2 = 0x100; }
  else if (ch & 2) { dir = 0x200; res = r16(0x5DBC); n = r16(0x5DBE); t1 = 0x800; t2 = 0x400; }
  else { dir = 0x100; res = r16(0x5DB8); n = r16(0x5DBA); t1 = 0x800; t2 = 0x400; }
  w16(b, dir); w16(b + 2, n);
  if (res & 2) { w16(b + 4, res & 1 ? t2 : t1); w16(b + 6, 1); w16(b + 8, 0xFFFF); }
  else w16(b + 4, 0xFFFF);
}

function trapped(p, b) {                 // C0CBCC
  if (gimmickExit(p, b)) return;         // C0CBF2
  pressY(p);
  w16(p + 0xBE, r16(p + 0xBE) | 0xC000);
  if (r16(b)) { w16(b, 0); w16(b + 2, 0x0FFF); }
}

function gimmickExit(p, b) {             // C0CBF2: step onto an adjacent $55/$49/$50 cell
  const c = r16(p + 0xA8);
  w16(0x40, c);
  const tries = [[2, 0x100], [0xFFFE, 0x200], [0xFF80, 0x800], [0x80, 0x400]];
  for (const [d, dir] of tries) {
    const v = grid(u(c + d));
    // quirk: a $55 cell in ANY direction jumps to the "right" case (dir R)
    if (v === 0x0055) return gimmickPlan(p, b, 0x100);
    if (v === 0x0049 || v === 0x0050) return gimmickPlan(p, b, dir);
  }
  return false;
}
function gimmickPlan(p, b, dir) {
  w16(b, dir); w16(b + 2, 1); w16(b + 4, 0xFFFF);
  w16(p + 0xBE, r16(p + 0xBE) | 0xC000);
  return true;
}

// ---- 4. stall (C0CC97) -----------------------------------------------------------------
function stall(p) {
  if (!(r16(p + 0x6E) & 0x0F00)) {      // standing: C0C97F re-escape (even in escape mode)
    if (danger(r16(p + 0xA8))) escape(p);
    return;
  }
  if (r16(p + 0xDC) < 0x10) return;
  const b = setPlan(p);                  // C0CCB0
  w16(p + 0xBE, r16(p + 0xBE) & 0x3FFF);
  w16(b, 0xFFFF);
  const d = facing(p);                   // C0CCCC
  if (grid(u(d + r16(p + 0xA8))) === 0x00C2) pressA(p);
  planRandom(p);
}

// ---- 5. plan executor (C0CD53) ----------------------------------------------------------
function execute(p) {
  let e = setPlan(p);
  w16(0x94, e); w8(0x96, 0);
  for (;;) {
    const dir = r16(e);
    if (dir & 0x8000) { cancelPlan(p); return; }   // end: direction bits are kept
    if (r16(e + 2)) break;
    e += 4;
    w16(0x94, e);
  }
  w16(p + 0x6E, (r16(p + 0x6E) & 0xF0FF) | r16(e));
  w16(p + 0xDC, u(r16(p + 0xDC) + 1));
  if (!(r16(p + 0xBE) & 0x4000)) {       // C0CDF1: stop before fire / bomb / danger
    const nx = u(facing(p) + r16(p + 0xA8));
    const v = grid(nx);
    if ((v === 0x0001 || v === 0x0043 || danger(nx)) && (w16(0x52, 4), nearCentre(p, 4))) {
      const i = r16(p + 0x6E) & 0xF0FF;
      w16(p + 0x6E, i);
      w16(e + 2, i);                     // quirk: the count becomes the pad word ($0080 if A held)
    }
  }
  if (r16(p + 0xA8) === r16(p + 0xDE)) return;
  const n = CENTRE[r8(p + 0xF0) & 7];
  w16(0x52, n);
  if (!nearCentre(p, n)) return;
  w16(p + 0xDE, r16(p + 0xA8));
  w16(p + 0xDC, 0);
  const c = r16(e + 2);
  if (c) w16(e + 2, c - 1);
}

// ---- 6. bombing an enemy / glove throw (C0C843) ------------------------------------------
function attack(p) {
  if (r16(p + 0x52) & 0x0002) { glove(p); return; }
  w16(p + 0xD6, 0);
  const d8 = r16(p + 0xD8);
  if (d8 < 0x80) { w16(p + 0xD8, d8 + 1); return; }
  const box = BOMBBOX[lvl(p)];           // C0C86D: C0C88B / C0C8C8 / C0C905 / C0C942
  w16(0x5A, box);
  for (let q = 0; q < 4; q++) {
    const o = OBJ + q * 0x100;
    if (o === p || (r16(o) & 0x0800)) continue;
    if (absd(r16(p + 0x10) - r16(o + 0x10)) >= box) continue;
    if (absd(r16(p + 0x18) - r16(o + 0x18)) >= box) continue;
    pressA(p);                           // JML C0CCE6, returns into the loop: all slots checked
  }
}

function glove(p) {                      // C0C63D
  const t = u(r16(p + 0xD6) + 1);
  w16(p + 0xD6, t);
  if (HOLD[lvl(p)] >= t) return;
  // C0C66E: face every aligned living HUMAN in slot order (the last match wins).
  // tall: the original's AND #$00F8 on y assumes y < 256; on the 13x25 field y reaches
  // 448, so y keeps bit 8 (else a human 16 rows away counts as "same row"). x < 256.
  const ym = isTall() ? 0x1F8 : 0xF8;
  for (let q = 0; q < 4; q++) {
    const o = OBJ + q * 0x100;
    if (o === p || (r16(o) & 0x0800) || (r16(o + 4) & 0x0001)) continue;
    w16(0x40, r16(p + 0x10) & 0xF8);
    if ((r16(p + 0x10) & 0xF8) === (r16(o + 0x10) & 0xF8)) {
      w16(p + 0x6E, r16(p + 0x18) >= r16(o + 0x18) ? 0x800 : 0x400);
    } else if ((w16(0x40, r16(p + 0x18) & ym), (r16(p + 0x18) & ym) === (r16(o + 0x18) & ym))) {
      w16(p + 0x6E, r16(p + 0x10) >= r16(o + 0x10) ? 0x200 : 0x100);
    }
  }
  w16(p + 0x6E, r16(p + 0x6E) & 0x0F00);   // release A (and Y): throw
  w16(p + 0xD6, 0);
}

// ---- 7. periodic Y (C0C5DB) ---------------------------------------------------------------
function periodicY(p) {
  const n = (r8(p + 0xEE) + 1) & 0xFF;
  w8(p + 0xEE, n);
  if (n < 0x40) { w16(p + 0x6E, r16(p + 0x6E) & 0xBFFF); return; }
  w8(p + 0xEE, 0);
  const d = facing(p);
  if (!(grid(u(d + r16(p + 0xA8))) & 0x0080)) return;
  if (r16(p + 0x52) & 0x0002) return;
  pressY(p);
}

// ---- entry (C0C54B) ---------------------------------------------------------------------
export function tick(p) {
  const f = r16(p);
  if (!(f & 0x8000) || (f & 0x0800)) return;
  if (r16(p + 0x52) & 0x0001) return;
  if (!(r16(p + 4) & 0x0001)) return;    // not a COM
  stuckTimer(p);                         // C106D8
  planners(p);                           // C0CE32
  dangerCheck(p);                        // C0C990
  stall(p);                              // C0CC97
  execute(p);                            // C0CD53
  attack(p);                             // C0C843
  periodicY(p);                          // C0C5DB
}
