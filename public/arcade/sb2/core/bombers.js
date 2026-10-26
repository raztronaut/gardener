// Object pipeline (C01E1D) and the per-bomber routines that are not movement.
// Objects are the 32 slots at $7E8000 (0..3 = bombers P1..P4, 4.. = movers such as
// kicked/thrown bombs); the active list $7E2620 is rebuilt every tick in slot order.
import { r8, r16, w8, w16, OBJ, OBJ_LIST } from './mem.js';
import * as move from './move.js';
import * as ai from './ai.js';
import * as disease from './disease.js';
import * as stage from './stage.js';
import * as movers from './movers.js';
import * as bombs from './bombs.js';
import * as anim from './anim.js';

// ---- C01602: pads -> +6E of human bombers ------------------------------------------
// (C01797 latched the pads into $C3/$C5/$C7/$C9 and the signatures into $CD..$D0.)
function humanInput(slot, padAddr, sigAddr) {   // C01625 / C0167C / C016D3 / C0172A
  const p = OBJ + slot * 0x100;
  if (r16(p) & 0x0800) return;          // dying
  if (r16(p + 4) & 0x0001) return;      // COM
  if (r16(p + 0x52) & 0x0001) return;   // busy (throw / jump / ...)
  if ((r8(sigAddr) & 0x1F) !== 1) return; // no standard pad connected
  let v = r16(padAddr);
  if ((v & 0x0300) === 0x0300) v &= 0xFCFF;   // L+R -> neither
  if ((v & 0x0C00) === 0x0C00) v &= 0xF3FF;   // U+D -> neither
  w16(padAddr, v);
  w16(p + 0x6E, v);
}

export function input() {               // C01602
  // C01862 / CC96BB: controller-type probe and a debug hook, no battle state.
  humanInput(0, 0xC3, 0xCD);
  if (r16(0xB9) & 0x8000) {
    humanInput(1, 0xC5, 0xCE);
    humanInput(2, 0xC7, 0xCF);
    humanInput(3, 0xC9, 0xD0);
  }
}

// ---- C028F6: rebuild the active object list ------------------------------------------
function rebuildList() {
  w16(0xB7, 0);
  w16(OBJ_LIST, 0xFFFF);
  let x = 0;
  for (let k = 0; k < 32; k++) {
    const p = OBJ + k * 0x100;
    if (r16(p) & 0x8000) {
      w16(OBJ_LIST + x, p);
      w16(0x26A0 + x, r16(p + 0xA8));
      x += 2;
      w16(OBJ_LIST + x, 0xFFFF);
      w16(0x26A0 + x, 0xFFFF);
    }
  }
}

// ---- C105F7: the cell each object is moving into ($7E2720, read by the movers) -------
function frontCells() {
  for (let x = 0; ; x += 2) {
    const p = r16(OBJ_LIST + x);
    if (p === 0xFFFF) break;
    const d = move.motionDir(p);        // C0A8D3 -> $5BFC
    if (!d) { w16(0x2720 + x, 0); continue; }
    let delta;
    if (d & 0x100) delta = 2;
    else if (d & 0x200) delta = 0xFFFE;
    else if (d & 0x400) delta = 0x80;
    else delta = 0xFF80;
    w16(0x2720 + x, (delta + r16(p + 0xA8)) & 0xFFFF);
  }
}

// ---- C022E2: input -> animation flags (+0E) and velocity sign bits (+00 b0/b1) --------
function inputFlags(p) {
  if (!(r16(p) & 0x8000)) return;
  // (+6E bit $0010 = R button: debug hook C022A0, disabled by LDA #0 / BEQ)
  let e = r16(p + 0x0E) & 0xEFFF;
  const dirs = r16(p + 0x6E) & 0x0F00;
  if (dirs) e = (e | 0x1000) & 0xBFFF;
  e &= 0xDFFF;
  if (r16(p + 0x6C) !== dirs) {
    w16(p + 0x6C, dirs);
    e |= 0x2000;
  }
  w16(p + 0x0E, e);
  if (!(r16(p + 0x52) & 0x0001)) velocitySigns(p);
}

function velocitySigns(p) {             // C02357
  if (!(r16(0xB9) & 0x8000) && (r16(p + 2) & 0x8000)) return;
  const inp = r16(p + 0x6E);
  if (r16(0x1A) === 2) {                // stage 3: per-axis locks in +CA (tunnels)
    const ca = r16(p + 0xCA);
    if (!(ca & 0x0100)) {
      if (inp & 0x0100) w16(p, r16(p) & 0xFFFE);
      else if (inp & 0x0200) w16(p, r16(p) | 0x0001);
    }
    if (!(ca & 0x0200)) {
      if (inp & 0x0400) w16(p, r16(p) & 0xFFFD);
      else if (inp & 0x0800) w16(p, r16(p) | 0x0002);
    }
    return;
  }
  if (inp & 0x0100) w16(p, r16(p) & 0xFFFE);
  else if (inp & 0x0200) w16(p, r16(p) | 0x0001);
  if (inp & 0x0400) w16(p, r16(p) & 0xFFFD);
  else if (inp & 0x0800) w16(p, r16(p) | 0x0002);
}

// ---- C0A146: keep the position in range; off-screen flags (+00 b12/b13) -------------
function clampPos(p) {
  if (!(r16(p) & 0x8000)) return;
  w16(p + 0x10, r16(p + 0x10) & r16(0x5D3E));
  w16(p + 0x18, r16(p + 0x18) & r16(0x5D3C));
  const y = r16(p + 0x18), x = r16(p + 0x10);
  const onY = !(y >= 0x200 || (y >= 0xF0 && y < 0x1F8));
  const onX = !(x >= 0x200 || (x >= 0x110 && x < 0x1E8));
  if (!(r16(p) & 0x1000)) {             // currently flagged off-screen
    if (onY && onX) w16(p, (r16(p) | 0x1000) & 0xDFFF);
    return;
  }
  if (onY && onX) return;
  // C0A1C3: gone off-screen. Objects with +04 b10 (bombers) are only flagged; any other
  // object (a mover) is erased: its 256 bytes are zeroed.
  if (r16(p + 4) & 0x0400) { w16(p, (r16(p) | 0x2000) & 0xEFFF); return; }
  for (let i = 0; i < 0x100; i += 2) w16(p + i, 0);
}

// ---- C01E1D: run every object -------------------------------------------------------
export function objects(G) {
  rebuildList();                        // C028F6
  frontCells();                         // C105F7
  // C020FA (clear the OAM buffer) and C02821 (sprite priorities by y) are display only;
  // C02821 writes +08 (sprite priority) of the 4 bombers:
  spritePriorities();
  for (let x = 0; ; x += 2) {
    w16(0x1C, x);
    w16(0x20, x >> 1);
    const p = r16(OBJ_LIST + x);
    if (p === 0xFFFF) break;
    if (r16(p + 4) & 0x0002) continue;
    move.cellLookup(p);                 // C0A4F7
    if ((r8(0x30) & 0x0F) === 0x0F) {
      if (!(r16(p + 0x7E) & 0xFF00)) {
        ai.tick(p);                     // C0C54B  (COM only)
        inputFlags(p);                  // C022E2
        disease.perBomber(p);           // C03686
      }
      stage.cellHandler(p);             // C04337  gimmick of the cell under the object
      stage.yButton(p);                 // C065F1  Y action (stage 10 jump ...)
      stage.perBomber(p);               // C05741  per-stage per-object state
      move.move(p);                     // C0A474  movement, death, item pickup
      movers.update(p);                 // C08230  kicked / thrown bombs
      bombs.buttons(p);                 // C02945  A / B / X
    }
    anim.flags(p);                      // C0224A
    clampPos(p);                        // C0A146
    anim.timer(p);                      // C0A120
    spriteFlags(p);                     // C09C7B (sprite building: only the +0E b0 ack)
  }
  if (r16(0x32) & 1) w16(0x5E5A, (r16(0x5E5A) + 1) & 0xFFFF);
}

// C09C7B: builds the OAM entries (fields +7C..+8A, display only). The one logic-visible
// effect: a bomber's "new frame" flag +0E b0 is acknowledged (cleared).
function spriteFlags(p) {
  const f = r16(p);
  if (!(f & 0x8000) || (f & 0x2000)) return;
  if (p >= 0x8400) return;
  const e = r16(p + 0x0E);
  if (e & 1) w16(p + 0x0E, e & 0xFFFE);
}

function spritePriorities() {           // C02821 / C028A7 / C02869 (only +08 matters)
  // C028A7 sorts the 4 bombers by y; C02869 then writes +08 = $30, $38, $40, $48 in
  // that order. Sorting: insertion by the low byte of y, ties keep slot order.
  const e = [];
  for (let i = 0; i < 4; i++) e.push(((r16(OBJ + i * 0x100 + 0x18) & 0xFF) | (0x8000 + i * 0x100)));
  sortBombers(e);
  for (let i = 0; i < 4; i++) w16(0x2A70 + i * 2, e[i]);
  w16(0x2A78, 0xFFFF);
  let v = 0x30;
  for (let i = 0; i < 4; i++) { w16((e[i] & 0xFF00) + 0x08, v); v += 8; }
}

// C028A7: exchange sort, largest y (low byte) first; +08 then gets $30, $38, ... in
// that order (only the sprite priority depends on it).
function sortBombers(e) {
  for (let i = 0; i < e.length; i++) {
    let key = e[i] & 0xFF;
    for (let j = i + 1; j < e.length; j++) {
      if ((e[j] & 0xFF) > key) { const t = e[j]; e[j] = e[i]; e[i] = t; key = t & 0xFF; }
    }
  }
}
