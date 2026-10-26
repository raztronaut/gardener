// Stage 3 (beach, $1A = 2) — handlers exported under their ROM addresses (see stage.js).
//
// - C0426E  per tick: re-open the tunnels a bomber has left (C042D9 / C0427B), then the
//           bomber/bomber collision C069D8, which on this stage also sets every bomber's
//           walking velocity (move.js C0C01C skips the normal input on stage 3).
// - C04DE1  tunnel cells (underlay $11) beyond the top/bottom border gaps at cx 4 / 12:
//           a bomber is moved to the opposite end and walks in; the exit cell is closed
//           ($FB) while it transits; one bomber per tunnel; blocked = pushed back.
// - C05A59  per object: off the tunnel cells -> clear the transit flag (+02 b10).
//
// Collision: bombers are 13 x 15 px solid to each other. Touching pairs are grouped
// (table $C5EA65 by the 6-bit pair mask $5C8C); each group is sorted by y ($3F88) and by
// x ($3F98) and resolved: a bomber walking into another pushes it at 0.5 px/tick when the
// other can't or won't move away; with 3+ bombers in a line the walking directions are
// "voted". +CA: b4..b7 = R/L/D/U blocked for this tick (C06FE3), b8/b9 = X/Y pushed
// (bombers.js velocitySigns then keeps the push direction).
import { r8, r16, w8, w16, GRID, UNDER, OBJ_LIST } from './mem.js';
import * as move from './move.js';
import { emit } from './events.js';
import { isTall } from './geom.js';

const sfx = (id) => emit('sfx', { id });
const P = (e) => e & 0xFF00;            // object pointer of a sorted-list entry
const inp = (o) => r16(o + 0x6E);
const ca = (o) => r16(o + 0xCA);
function setVX(o) { w16(o + 0x14, r16(o + 0xA4)); w16(o + 0x16, r16(o + 0xA6)); }
function setVY(o) { w16(o + 0x1C, r16(o + 0xA0)); w16(o + 0x1E, r16(o + 0xA2)); }

// direct-page scratch the original keeps across these routines
let d50 = 0, d52 = 0, d54 = 0, d56 = 0, d5C = 0, d5E = 0;

// ---- per tick ----------------------------------------------------------------------
// tall: the bottom tunnels are at rows 29/30 instead of 15/16 (geom.js)
const TUN = () => (isTall() ? { b4: 0x0E88, f4: 0x0F08, b12: 0x0E98, f12: 0x0F18, y: 0x1CF }
  : { b4: 0x0788, f4: 0x0808, b12: 0x0798, f12: 0x0818, y: 0xEF });

export function C0426E() {
  const T = TUN();
  reopen(0x0003, 0x5D06, 0x0188, T.b4);      // C042D9 (cx 4)
  reopen(0x000C, 0x5D08, 0x0198, T.b12);     // C0427B (cx 12)
  C069D8();
}

function reopen(mask, who, top, bottom) {
  if (!(r16(0x5D04) & mask)) return;
  const o = 0x8000 + (r16(who) & 0x0FFF);
  const u = r16(UNDER + r16(o + 0xA8)) & 0xFF;
  if (u === 0x11) return;                    // still in the tunnel
  if (!(r16(o + 0x52) & 0x0020)) w16(o + 0x52, r16(o + 0x52) & 0xF7FE);
  w16(0x5D04, r16(0x5D04) & ~mask & 0xFFFF);
  w16(who, 0);
  w16(GRID + top, 0); w16(UNDER + top, 0);
  w16(GRID + bottom, 0); w16(UNDER + bottom, 0);
  emit('tunnelExit', { player: (o - 0x8000) >> 8, cell: r16(o + 0xA8) });
}

// $C5E8D9: the pair bits of each bomber; $C5EA65: pair mask -> group nibbles
const MINE = [0x07, 0x19, 0x2A, 0x34];
const GROUPS = [0x0000, 0x0011, 0x0101, 0x0111, 0x1001, 0x1011, 0x1101, 0x1111, 0x0110, 0x0111, 0x0111, 0x0111,
  0x1221, 0x1111, 0x1111, 0x1111, 0x1010, 0x1011, 0x2121, 0x1111, 0x1011, 0x1011, 0x1111, 0x1111, 0x1110, 0x1111,
  0x1111, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111, 0x1100, 0x2211, 0x1101, 0x1111, 0x1101, 0x1111, 0x1101, 0x1111,
  0x1110, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111, 0x1110, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111,
  0x1111, 0x1111, 0x1110, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111, 0x1111];

export function C069D8() {
  if (r16(0x1A) !== 2) return;
  for (let k = 0; k < 4; k++) {              // C080EC / C08128 / C08164 / C081A0
    const o = 0x8000 + 0x100 * k;
    move.speedFromLevel(o);                  // C0C290
    w16(o + 0x14, 0); w16(o + 0x16, 0); w16(o + 0x1C, 0); w16(o + 0x1E, 0);
    w16(o + 0xCA, 0);
    for (let i = 0; i < 8; i += 2) w16(0x3FA8 + 0x20 * k + i, 0);
  }
  w16(0x5C8C, 0);
  const pair = (a, b, bit) => {              // C07EAE ...: |dx| < 13 and |dy| < 15
    const oa = 0x8000 + 0x100 * a, ob = 0x8000 + 0x100 * b;
    if (r16(ob) & 0x0800) return;
    let dx = (r16(ob + 0x10) - r16(oa + 0x10)) & 0xFFFF; if (dx & 0x8000) dx = (-dx) & 0xFFFF;
    if (dx >= 0x0D) return;
    let dy = (r16(ob + 0x18) - r16(oa + 0x18)) & 0xFFFF; if (dy & 0x8000) dy = (-dy) & 0xFFFF;
    if (dy >= 0x0F) return;
    w16(0x5C8C, r16(0x5C8C) | bit);
  };
  if (!(r16(0x8000) & 0x0800)) { pair(0, 1, 1); pair(0, 2, 2); pair(0, 3, 4); }
  if (!(r16(0x8100) & 0x0800)) { pair(1, 2, 8); pair(1, 3, 0x10); }
  if (!(r16(0x8200) & 0x0800)) pair(2, 3, 0x20);
  if (r16(0x5C8C)) {
    resolve();                               // C06A45
    emit('bombersBump', { mask: r16(0x5C8C) });
  }
  for (let k = 0; k < 4; k++) {              // C081DC.. -> C0804C
    if (!(MINE[k] & r16(0x5C8C))) move.inputVelocity(0x8000 + 0x100 * k);   // C0C2CE
  }
}

function resolve() {                         // C06A45
  groups(GROUPS[r16(0x5C8C)]);               // C07DD6
  for (let i = 0; i < 12; i += 2) w16(0x5C9C + i, r16(0x5C90 + i));   // C06A66
  C07111();
  if (r16(0x5C8E)) {                         // C06A97: the second group (a separate pair)
    w16(0x5C90, r16(0x5C98));
    w16(0x5C92, r16(0x5C9A));
    w16(0x5C94, 0); w16(0x5C96, 0);
    pair2();                                 // C06AB2
  }
}

function groups(a) {                         // C07DD6
  w16(0x40, a);
  for (let i = 0x5C8E; i <= 0x5C9A; i += 2) w16(i, 0);
  let n1 = 0, n2 = 0;
  if (a & 0x2222) w16(0x5C8E, 1);
  for (let k = 0; k < 4; k++) {
    const n = (a >> (4 * k)) & 0xF;
    if (!n) continue;
    if (n === 2) { w16(0x5C98 + n2, 0x8000 | (k << 8)); if (k < 3) n2 += 2; }
    else { w16(0x5C90 + n1, 0x8000 | (k << 8)); if (k < 3) n1 += 2; }
  }
}

// ---- sorted lists (C07D29 by y -> $3F88, C07C7C by x -> $3F98) -----------------------
function sortedList(field, dst) {
  w16(0x2A70, 0xFFFF);
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const p = r16(0x5C90 + 2 * i);
    if (i > 0 && !p) break;
    w16(0x40, p);
    w16(0x2A70 + 2 * n, (r16(0x8000 + (p & 0x0F00) + field) & 0xFF) | p);
    n++;
    w16(0x2A70 + 2 * n, 0xFFFF);
  }
  sortDesc();                                // C028A7
  for (let i = 0; i < 10; i += 2) w16(dst + i, r16(0x2A70 + i));
}
function sortDesc() {                        // C028A7: exchange sort, largest low byte first
  for (let i = 0; r16(0x2A70 + i) !== 0xFFFF; i += 2) {
    let key = r16(0x2A70 + i) & 0xFF;
    for (let j = i + 2; r16(0x2A70 + j) !== 0xFFFF; j += 2) {
      if ((r16(0x2A70 + j) & 0xFF) > key) {
        const t = r16(0x2A70 + j);
        w16(0x2A70 + j, r16(0x2A70 + i));
        w16(0x2A70 + i, t);
        key = t & 0xFF;
      }
    }
  }
}
const Y = (i) => r16(0x3F88 + 2 * i);        // by y, descending (0 = lowest on screen)
const X = (i) => r16(0x3F98 + 2 * i);        // by x, descending (0 = rightmost)

// ---- C06FE3: which directions each grouped bomber can move this tick -----------------
function locks(o) {
  if (r16(o + 0x52) & 0x0001) { w16(o + 0xCA, ca(o) | 0x00F0); return; }
  const x = r16(o + 0x10), y = r16(o + 0x18), a = r16(o + 0xA8);
  const side = (delta, bit, horiz) => {
    w16(o + 0xCA, ca(o) & ~bit & 0xFFFF);
    const c = r16(GRID + ((a + delta) & 0xFFFF));
    let lock;
    if (c & 0x80) lock = horiz ? !(x & 0xF) : !(y & 0xF);
    else lock = (c & 0x3F) === 3;
    if (!lock) lock = horiz ? (y & 0xF) !== 0 : (x & 0xF) !== 0;
    if (lock) w16(o + 0xCA, ca(o) | bit);
  };
  side(2, 0x10, true);
  side(-2, 0x20, true);
  side(0x80, 0x40, false);
  side(-0x80, 0x80, false);
}
function allLocks(list) { for (const o of list) if (o) locks(o); }   // C06FB2

// ---- a pair (C06AB2) -----------------------------------------------------------------
let p82 = 0, p85 = 0, p88 = 0, p8B = 0;
function pair2() {
  const a = r16(0x5C90), b = r16(0x5C92);
  sortedList(0x18, 0x3F88);                  // C07D29
  sortedList(0x10, 0x3F98);                  // C07C7C
  allLocks([a, b, 0, 0]);                    // C06FB2
  // C06B1B
  p82 = P(Y(0)); p85 = P(Y(1)); p88 = P(X(0)); p8B = P(X(1));
  d50 = (inp(p82) & 0x0800) ? 0x8000 : 0;    // lower one walks up
  d52 = (inp(p85) & 0x0400) ? 0x8000 : 0;    // upper one walks down
  d54 = (inp(p88) & 0x0200) ? 0x8000 : 0;    // right one walks left
  d56 = (inp(p8B) & 0x0100) ? 0x8000 : 0;    // left one walks right
  if ((Y(0) & 0xFF) === (Y(1) & 0xFF)) { sameRowRight(); sameRowLeft(); return; }   // C06C5A, C06D30
  if ((X(0) & 0xFF) === (X(1) & 0xFF)) { sameColLower(); sameColUpper(); return; }  // C06EDC, C06E06
  apart();                                   // C06B83
}

function apart() {                           // C06B83 = C06BF7 + C06B94: only moving apart
  let o = P(Y(0));
  if ((inp(o) & 0x0400) && !(ca(o) & 0x40)) setVY(o);
  o = P(Y(1));
  if ((inp(o) & 0x0800) && !(ca(o) & 0x80)) setVY(o);
  o = P(X(0));
  if ((inp(o) & 0x0100) && !(ca(o) & 0x10)) setVX(o);
  o = P(X(1));
  if ((inp(o) & 0x0200) && !(ca(o) & 0x20)) setVX(o);
}

function pushPair(a, b, vOff, set, bit) {    // both move at 0.5 px/tick
  w16(a + vOff, 0); w16(b + vOff, 0);
  w16(a + vOff + 2, 0x8000); w16(b + vOff + 2, 0x8000);
  if (set) { w16(a, r16(a) | bit); w16(b, r16(b) | bit); }
  else { w16(a, r16(a) & ~bit & 0xFFFF); w16(b, r16(b) & ~bit & 0xFFFF); }
  sfx(0x49);                                 // C3A4B5
}

// the other one must not walk away along the perpendicular axis it can use
function perpFree(o, mask, hiBit, hiLock, loLock) {
  const i = inp(o) & mask;
  if (!i) return false;
  if (i & hiBit) return !(ca(o) & hiLock);
  return !(ca(o) & loLock);
}

function sameRowRight() {                    // C06C5A (p88 = right one)
  const i = inp(p88);
  if (i & 0x0100) setVX(p88);
  else if (i & 0x0200) { // C06CC4: pushes the left one left
    if (d56 & 0x8000) return;
    if (perpFree(p8B, 0x0C00, 0x0800, 0x80, 0x40)) return;
    if (inp(p8B) & 0x0200) return;
    if (ca(p8B) & 0x20) return;
    pushPair(p88, p8B, 0x14, true, 1);
  } else if (i & 0x0800) { if (!(ca(p88) & 0x80)) setVY(p88); }
  else if (i & 0x0400) { if (!(ca(p88) & 0x40)) setVY(p88); }
}
function sameRowLeft() {                     // C06D30 (p8B = left one)
  const i = inp(p8B);
  if (i & 0x0200) setVX(p8B);
  else if (i & 0x0100) { // C06D9A: pushes the right one right
    if (d54 & 0x8000) return;
    if (perpFree(p88, 0x0C00, 0x0800, 0x80, 0x40)) return;
    if (inp(p88) & 0x0100) return;
    if (ca(p88) & 0x10) return;
    pushPair(p8B, p88, 0x14, false, 1);
  } else if (i & 0x0800) { if (!(ca(p8B) & 0x80)) setVY(p8B); }
  else if (i & 0x0400) { if (!(ca(p8B) & 0x40)) setVY(p8B); }
}
function sameColLower() {                    // C06EDC (p82 = lower one)
  const i = inp(p82);
  if (i & 0x0400) setVY(p82);
  else if (i & 0x0800) { // C06F46: pushes the upper one up
    if (d52 & 0x8000) return;
    if (perpFree(p85, 0x0300, 0x0100, 0x10, 0x20)) return;
    if (inp(p85) & 0x0800) return;
    if (ca(p85) & 0x80) return;
    pushPair(p82, p85, 0x1C, true, 2);
  } else if (i & 0x0200) { if (!(ca(p82) & 0x20)) setVX(p82); }
  else if (i & 0x0100) { if (!(ca(p82) & 0x10)) setVX(p82); }
}
function sameColUpper() {                    // C06E06 (p85 = upper one)
  const i = inp(p85);
  if (i & 0x0800) setVY(p85);
  else if (i & 0x0400) { // C06E70: pushes the lower one down
    if (d50 & 0x8000) return;
    if (perpFree(p82, 0x0300, 0x0100, 0x10, 0x20)) return;
    if (inp(p82) & 0x0400) return;
    if (ca(p82) & 0x40) return;
    pushPair(p85, p82, 0x1C, false, 2);
  } else if (i & 0x0200) { if (!(ca(p85) & 0x20)) setVX(p85); }
  else if (i & 0x0100) { if (!(ca(p85) & 0x10)) setVX(p85); }
}

// ---- 3 or 4 bombers (C07111) ---------------------------------------------------------
function C07111() {
  if (!r16(0x5C94)) { pair2(); return; }
  allLocks([r16(0x5C90), r16(0x5C92), r16(0x5C94), r16(0x5C96)]);   // C06FB2
  sortedList(0x18, 0x3F88);
  sortedList(0x10, 0x3F98);
  const same = (L) => { const k = L(0) & 0xFF; for (let i = 1; L(i) !== 0xFFFF; i++) if ((L(i) & 0xFF) !== k) return false; return true; };
  if (same(Y)) { row(); return; }            // C072A1
  if (same(X)) { column(); return; }         // C07288
  // C0719D: not in a line: only the outermost ones may walk outwards
  let o = P(Y(0));                            // C0721C
  if ((inp(o) & 0x0400) && !(ca(o) & 0x40)) setVY(o);
  o = P(Y(3) !== 0xFFFF ? Y(3) : Y(2));
  if ((inp(o) & 0x0800) && !(ca(o) & 0x80)) setVY(o);
  o = P(X(0));                                // C071B0
  if ((inp(o) & 0x0100) && !(ca(o) & 0x10)) setVX(o);
  o = P(X(3) !== 0xFFFF ? X(3) : X(2));
  if ((inp(o) & 0x0200) && !(ca(o) & 0x20)) setVX(o);
}

// votes of two neighbours a (first) / b (second) along an axis (C07AB9 family):
// pos = the positive direction bit (R / D), mask = the axis bits
function vote(a, b, mask, pos, maskB = mask) {
  const ia = inp(a) & mask, ib = inp(b) & maskB;
  if (!ia) { if (ib) { if (ib & pos) d5E++; else d5C++; } }
  else if (ia & pos) { if (!ib) d5E++; else if (ib & pos) d5E += 2; }
  else if (!ib) d5C++; else if (!(ib & pos)) d5C += 2;
}

function row() {                             // C072A1: all on one row
  d5E = 0; d5C = 0;
  vote(P(X(0)), P(X(1)), 0x0300, 0x0100);    // C07A7F
  vote(P(X(1)), P(X(2)), 0x0300, 0x0100);    // C07A01
  if (X(3) !== 0xFFFF) vote(P(X(2)), P(X(3)), 0x0300, 0x0100);   // C0797E
  if (d5E < d5C) pushLine(X, 0x0200, 0x0100, 0x20, 0x14, true, 1, setVX, 0x0100);       // C077F9
  else if (d5E > d5C) pushBack(X, 0x0100, 0x0200, 0x10, 0x14, false, 1, setVX, 0x0100); // C074F8
  // C07309: everybody may still walk off the row vertically
  for (let i = 0; X(i) !== 0xFFFF; i++) {
    const o = P(X(i)), v = inp(o) & 0x0C00;
    if (!v) continue;
    if (v & 0x0800) { if (!(ca(o) & 0x80)) setVY(o); }
    else if (!(ca(o) & 0x40)) setVY(o);
  }
}

function column() {                          // C07288: all in one column
  d5E = 0; d5C = 0;
  // C07AFD — quirk: an up-walking first bomber looks at the second one's X bits
  {
    const a = P(Y(0)), b = P(Y(1));
    const ia = inp(a) & 0x0C00;
    if (ia && !(ia & 0x0400)) { if (!(inp(b) & 0x0300)) d5C++; else d5C += 2; }
    else vote(a, b, 0x0C00, 0x0400);
  }
  vote(P(Y(1)), P(Y(2)), 0x0C00, 0x0400);    // C07B7B
  if (Y(3) !== 0xFFFF) vote(P(Y(2)), P(Y(3)), 0x0C00, 0x0400);   // C07BF9
  if (d5E < d5C) pushLine(Y, 0x0800, 0x0400, 0x80, 0x1C, true, 2, setVY, 0x0200);       // C07674
  else if (d5E > d5C) pushBack(Y, 0x0400, 0x0800, 0x40, 0x1C, false, 2, setVY, 0x0200); // C0737C
  // C072BA: everybody may still walk off the column horizontally
  for (let i = 0; Y(i) !== 0xFFFF; i++) {
    const o = P(Y(i)), v = inp(o) & 0x0300;
    if (!v) continue;
    if (v & 0x0200) { if (!(ca(o) & 0x20)) setVX(o); }
    else if (!(ca(o) & 0x10)) setVX(o);
  }
}

// The negative direction (L / U) won: scan from the list head (C077F9 / C07674).
// push = the winning walk bit, away = the other bit of the axis, lockBit = the last
// one's lock in the push direction.
function pushLine(L, push, away, lockBit, vOff, set, signBit, setV, caBit) {
  let n = 0; while (L(n) !== 0xFFFF) n++;
  for (let i = 0; i < n - 1; i++) {
    const o = P(L(i));
    if (inp(o) & push) {                     // C078E7 / C07762
      const last = P(L(n - 1));
      if (ca(last) & lockBit) return;
      for (let k = i; k < n; k++) {
        const q = P(L(k));
        sfx(0x49);
        w16(q + vOff, 0); w16(q + vOff + 2, 0x8000);
        w16(q, set ? r16(q) | signBit : r16(q) & ~signBit & 0xFFFF);
        w16(q + 0xCA, ca(q) | caBit);
      }
      if (inp(last) & push) { setV(last); w16(last + 0xCA, ca(last) & ~caBit & 0xFFFF); }
      return;
    }
    if (inp(o) & away) setV(o);
  }
  const o = P(L(n - 1));                     // C078BD / C07738
  if (inp(o) & push) setV(o);
}

// The positive direction (R / D) won: scan from the list tail (C074F8 / C0737C).
function pushBack(L, push, away, lockBit, vOff, set, signBit, setV, caBit) {
  let n = 0; while (L(n) !== 0xFFFF) n++;
  for (let i = n - 1; i >= 1; i--) {
    const o = P(L(i));
    if (inp(o) & push) {                     // C075F3 / C07477
      const head = P(L(0));
      if (ca(head) & lockBit) return;
      for (let k = i; k >= 0; k--) {
        const q = P(L(k));
        sfx(0x49);
        w16(q + vOff, 0); w16(q + vOff + 2, 0x8000);
        w16(q, set ? r16(q) | signBit : r16(q) & ~signBit & 0xFFFF);
        w16(q + 0xCA, ca(q) | caBit);
      }
      if (inp(head) & push) { setV(head); w16(head + 0xCA, ca(head) & ~caBit & 0xFFFF); }
      return;
    }
    if (inp(o) & away) setV(o);
  }
  const o = P(L(0));                         // C075C9 / C0744D
  if (inp(o) & push) setV(o);
}

// ---- tunnels (C04DE1, cell handler for underlay $11) ---------------------------------
export function C04DE1(o) {
  if (o >= 0x8400 && !(r16(o + 0x52) & 0x0020)) return;   // only bombers / kicked bombs
  const T = TUN(), c = r16(o + 0xA8);     // tall: TUN()
  if (c === 0x0108) enter(o, T.b4, T.f4, 0x5D06, 1, T.y, 0x0800);          // C050E0
  else if (c === T.f4) enter(o, 0x0188, 0x0108, 0x5D06, 2, 0x11, 0x0400);  // C04F64
  else if (c === 0x0118) enter(o, T.b12, T.f12, 0x5D08, 4, T.y, 0x0800);   // C04E20
  else if (c === T.f12) enter(o, 0x0198, 0x0118, 0x5D08, 8, 0x11, 0x0400); // C04EC2
}

function objectAt(idx) {                     // C05182
  w16(0x5C, idx);
  for (let x = 0; ; x += 2) {
    const q = r16(OBJ_LIST + x);
    if (q === 0xFFFF) return false;
    if (r16(q + 0xA8) === idx) return true;
  }
}

// exit: the closed cell at the far end; far: the tunnel cell behind it; the busy test
// uses $5D04 & 3 for both tunnels (quirk: the cx-12 tunnel checks the cx-4 bits)
function enter(o, exit, far, who, bit, y, dirBit) {
  if (r16(o + 2) & 0x0400) return;           // already in transit
  if (r16(GRID + exit) || objectAt(exit) || objectAt(far) || (r16(0x5D04) & 3)) {
    pushBackOut(o, y === TUN().y);           // C051AE (top) / C05006 (bottom)
    return;
  }
  w16(GRID + exit, 0xFB); w16(UNDER + exit, 0xFB);
  w16(o + 2, r16(o + 2) | 0x0400);
  w16(who, o);
  w16(0x5D04, r16(0x5D04) | bit);
  w16(o + 0x18, y);
  if (o < 0x8400) {
    w16(o + 0x1C, r16(o + 0xA0) || 2);
    w16(o + 0x1E, r16(o + 0xA2));
    w16(o, r16(o) | 2);
    w16(o + 0x52, r16(o + 0x52) | 0x0801);
    w16(o + 0x6E, (r16(o + 0x6E) & 0xF0FF) | dirBit);
  }
  emit('tunnelEnter', { player: o < 0x8400 ? (o - 0x8000) >> 8 : null, cell: exit });
}

// C051AE / C05006: blocked — back out of the tunnel cells by their depth; a bomber in a
// collision group pushes its whole group (the copy of the groups at $5C9C).
function pushBackOut(o, fromTop) {
  // C05264 / C050BC: depth = number of $11 cells from the object's centre outwards
  let d = 0, y = r16(o + 0x18);
  for (;;) {
    w16(0x5E, y);
    const v = move.gridAt(r16(o + 0x10), y);
    if (v !== 0x11) break;
    d++; y = fromTop ? (y + 1) & 0xFFFF : (y - 1) & 0xFFFF;
  }
  w16(0x5C, d);
  const sign = fromTop ? d : -d;
  const one = (q) => { w16(q + 0x18, (r16(q + 0x18) + sign) & 0xFFFF); };
  if (o >= 0x8400 || !r16(0x5C8C)) { one(o); move.cellLookup(o); move.zeroY(o); return; }
  let k = -1;
  for (let i = 0; i < 6; i++) if (r16(0x5C9C + 2 * i) === o) { k = i; break; }
  if (k < 0) { one(o); move.cellLookup(o); move.zeroY(o); return; }
  const shift = (q) => { const x = 0x8000 + (q & 0x0FFF); w16(x + 0x18, (r16(x + 0x18) + sign) & 0xFFFF); };
  if (k >= 4) { shift(r16(0x5C98)); shift(r16(0x5C9A)); return; }
  shift(r16(0x5C90)); shift(r16(0x5C92));
  if (!r16(0x5C94)) return;
  shift(r16(0x5C94));
  if (!r16(0x5C96)) return;
  shift(r16(0x5C96));
}

// ---- per object (C05A59) -------------------------------------------------------------
export function C05A59(o) {
  if (r16(GRID + r16(o + 0xA8)) !== 0x11) w16(o + 2, r16(o + 2) & 0xFBFF);
}
