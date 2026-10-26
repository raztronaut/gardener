// Bombs: buttons (C02945: A place / B remote / X stop), placement (C03082 + C034C0),
// AI danger marks, the even-tick bomb update + explosions (C0E0AA), owner refund,
// rays and chain reactions, AI danger-map decay (C0E076).
// Transliterated from the 65816; each function names its routine. Pointers:
//   bomber / object p = WRAM offset 0x8000 + 0x100*slot ($7E:8000)
//   bomb b            = WRAM offset 0x12000 + 0x100*k  ($7F:2000); the bomb list
//                       $7E2960 holds the bank-$7F low words (0x2000 + 0x100*k).
import { r8, r16, w8, w16, GRID, UNDER, DANGER, TILE, TILE_UNDER } from './mem.js';
import { emit } from './events.js';
import * as movers from './movers.js';
import * as stage from './stage.js';
import { queueBurn } from './burn.js';

const BOMB0 = 0x12000;
const LIST = 0x2960;
const bptr = (w) => 0x10000 + w;       // bomb list word -> WRAM offset

// flame tile tables ($C5F423 -> per piece, 13 phases): 0 centre, 1 up end, 2 down end,
// 3 left end, 4 right end, 5 vertical arm, 6 horizontal arm
const FLAME = [
  [0x012C, 0x014C, 0x016C, 0x018C, 0x01AC, 0x018C, 0x01AC, 0x018C, 0x01AC, 0x018C, 0x016C, 0x014C, 0x012C],
  [0x0120, 0x0140, 0x0160, 0x0180, 0x01A0, 0x0180, 0x01A0, 0x0180, 0x01A0, 0x0180, 0x0160, 0x0140, 0x0120],
  [0x0122, 0x0142, 0x0162, 0x0182, 0x01A2, 0x0182, 0x01A2, 0x0182, 0x01A2, 0x0182, 0x0162, 0x0142, 0x0122],
  [0x0124, 0x0144, 0x0164, 0x0184, 0x01A4, 0x0184, 0x01A4, 0x0184, 0x01A4, 0x0184, 0x0164, 0x0144, 0x0124],
  [0x0126, 0x0146, 0x0166, 0x0186, 0x01A6, 0x0186, 0x01A6, 0x0186, 0x01A6, 0x0186, 0x0166, 0x0146, 0x0126],
  [0x0128, 0x0148, 0x0168, 0x0188, 0x01A8, 0x0188, 0x01A8, 0x0188, 0x01A8, 0x0188, 0x0168, 0x0148, 0x0128],
  [0x012A, 0x014A, 0x016A, 0x018A, 0x01AA, 0x018A, 0x01AA, 0x018A, 0x01AA, 0x018A, 0x016A, 0x014A, 0x012A],
];
// explosion phase durations $C5F415 (in bomb updates), $FF = end
const PHASES = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0xFF];
// fizzing-bomb tile cycles by bomb type ($C5F4E7[type & $1F]); $C5F52B for flags $0800
const BOMB_ANIM = {
  0: [0x0100, 0x0100, 0x0100, 0x0100, 0x0100, 0x0102, 0x0102, 0x0102, 0x0104, 0x0104, 0x0104, 0x0104, 0x0106, 0x0106, 0x0106, 0x0106],
  1: [0x0108, 0x0108, 0x0108, 0x0108, 0x010A, 0x010A, 0x010A, 0x010A, 0x010C, 0x010C, 0x010C, 0x010C, 0x010E, 0x010E, 0x010E, 0x010E],
  2: [0x01E0, 0x01E0, 0x01E0, 0x01E0, 0x01E0, 0x01E0, 0x01E0, 0x01E0, 0x01E0, 0x01E0, 0x01E2, 0x01E2, 0x01E2, 0x01E2, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E4, 0x01E6, 0x01E6, 0x01E6, 0x01E6, 0x01E6, 0x01E6, 0x01E6],
  4: [0x01C8, 0x01C8, 0x01C8, 0x01C8, 0x01C8, 0x01C8, 0x01C8, 0x01CA, 0x01CA, 0x01CA, 0x01CA, 0x01CC, 0x01CC, 0x01CC, 0x01CC, 0x01CC, 0x01CC, 0x01CE, 0x01CE, 0x01CE, 0x01CE],
  8: [0x01C2, 0x01C0, 0x01C2, 0x01C4, 0x01C2, 0x01C0, 0x01C2, 0x01C4, 0x01C2, 0x01C0, 0x01C2, 0x01C4, 0x01C2, 0x01C0, 0x01C2, 0x01C4, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2, 0x01C2],
  scatter: [0x0340, 0x0340, 0x0340, 0x0340, 0x0340, 0x0342, 0x0342, 0x0342, 0x0344, 0x0344, 0x0344, 0x0344, 0x0346, 0x0346, 0x0346, 0x0346],
};
// stage-4 fuse cells $C5E55C (grid indices)
export const FUSE_CELLS = [0x0308, 0x030A, 0x030C, 0x030E, 0x0310, 0x0312, 0x0314, 0x0316, 0x0318,
  0x0608, 0x060A, 0x060C, 0x060E, 0x0610, 0x0612, 0x0614, 0x0616, 0x0618,
  0x0388, 0x0408, 0x0488, 0x0508, 0x0588, 0x0398, 0x0418, 0x0498, 0x0518, 0x0598];
// AI danger decay order $C5D46A (113 cells; note the original's typo $049C for $069C)
export const DECAY_CELLS = [
  0x0204, 0x0206, 0x0208, 0x020A, 0x020C, 0x020E, 0x0210, 0x0212, 0x0214, 0x0216, 0x0218, 0x021A, 0x021C,
  0x0284, 0x0288, 0x028C, 0x0290, 0x0294, 0x0298, 0x029C,
  0x0304, 0x0306, 0x0308, 0x030A, 0x030C, 0x030E, 0x0310, 0x0312, 0x0314, 0x0316, 0x0318, 0x031A, 0x031C,
  0x0384, 0x0388, 0x038C, 0x0390, 0x0394, 0x0398, 0x039C,
  0x0404, 0x0406, 0x0408, 0x040A, 0x040C, 0x040E, 0x0410, 0x0412, 0x0414, 0x0416, 0x0418, 0x041A, 0x041C,
  0x0484, 0x0488, 0x048C, 0x0490, 0x0494, 0x0498, 0x049C,
  0x0504, 0x0506, 0x0508, 0x050A, 0x050C, 0x050E, 0x0510, 0x0512, 0x0514, 0x0516, 0x0518, 0x051A, 0x051C,
  0x0584, 0x0588, 0x058C, 0x0590, 0x0594, 0x0598, 0x059C,
  0x0604, 0x0606, 0x0608, 0x060A, 0x060C, 0x060E, 0x0610, 0x0612, 0x0614, 0x0616, 0x0618, 0x061A, 0x061C,
  0x0684, 0x0688, 0x068C, 0x0690, 0x0694, 0x0698, 0x049C,
  0x0704, 0x0706, 0x0708, 0x070A, 0x070C, 0x070E, 0x0710, 0x0712, 0x0714, 0x0716, 0x0718, 0x071A, 0x071C];
// Layout-dependent tables (the tall layout replaces them): see setLayoutTables().
let decayCells = DECAY_CELLS;
let fuseCells = FUSE_CELLS;
export function setLayoutTables({ decay, fuse } = {}) {
  decayCells = decay || DECAY_CELLS;
  fuseCells = fuse || FUSE_CELLS;
}

const cellOf = (g) => ({ cx: (g & 0x7F) >> 1, cy: g >> 7 });

// ================================================================================
// Buttons
// ================================================================================
export function buttons(p) {            // C02945
  const f = r16(p);
  if (!(f & 0x8000)) return;
  if (f & 0x0800) return;
  if (r16(p + 0x52) & 0x0001) return;
  if (r16(p + 2) & 0x8000) { if (!C02975(p)) return; }
  place(p);                             // C03082
  remoteButton(p);                      // C02A7A
  stopButton(p);                        // C029FD
}

function C02975(p) {                    // carry set = buttons allowed
  const x = r16(p + 0x62) & 0x7FFF;
  if (r16(0x807E + x) === 0x00DC) return false;
  return (r16(0x80C0 + x) & 0x0800) !== 0;
}

// ---- A: place / lift / throw (C03082) ------------------------------------------
export function place(p) {
  if (r16(p + 0x6E) & 0x0080) return pressA(p);
  if (r16(p + 0x52) & 0x0004) { movers.throwRelease?.(p); return; }   // C02CAF
  if (r8(p + 0xF5) === 0x02) {          // diarrhoea
    if (C03055(p)) placeBomb(p);
    return;
  }
  w16(p + 0x0E, r16(p + 0x0E) & 0xFBFF); // A released: clear the edge latch
}

function pressA(p) {                     // C030C8
  const e = r16(p + 0x0E);
  if (e & 0x0400) return;
  w16(p + 0x0E, e | 0x0400);
  const b4 = r8(p + 0xB4);
  if (b4 & 0x40) {                       // object cell (bomb / item / ...)
    if (r8(p + 0xFE) && (b4 & 0x3F) === 3 && r16(p + 0x50) !== 8) movers.lift?.(p); // C02F6E
    return;
  }
  placeBomb(p);
}

function C03055(p) {                     // diarrhoea: every 2nd call, try to drop
  const e = r16(p + 0x0E) ^ 0x0002;
  w16(p + 0x0E, e);
  if (!(e & 0x0002)) return false;
  w16(p + 0x0E, r16(p + 0x0E) & 0xFBFF);
  return !(r8(p + 0xB4) & 0x40);
}

function placeBomb(p) {                  // C03104
  if (C031EB(p)) return;
  if (C0319A(p)) return;
  if (C03163()) return;
  const hand = r8(p + 0xF1);
  if (!hand) return;
  w8(p + 0xF1, hand - 1);
  const b = spawn(p);                    // C034C0
  if (b < 0) return;
  // C3A4B5: sound $48
  w8(p + 0xF8, (r8(p + 0xF8) + 1) & 0xFF);
  w16(0x5E46, 0);
  C03185(b);
  rayMarks(b, 0x10, 0xFFC0, 0xFF80, 5, 1, true);   // C0323F up
  rayMarks(b, 0x4C, 0x0040, 0x0080, 5, 2, false);  // C032E5 down
  rayMarks(b, 0x88, 0xFFFE, 0xFFFE, 6, 3, false);  // C03386 left
  rayMarks(b, 0xC4, 0x0002, 0x0002, 6, 4, false);  // C03423 right
  C107CB();
  const g = r16(b + 0x0A);
  emit('bombPlaced', { slot: (p - 0x8000) >> 8, bomb: (b - BOMB0) >> 8, ...cellOf(g), type: r16(b) & 0xFF, range: r8(b + 7), sfx: 0x48 });
}

function C031EB(p) {                     // carry set = cannot place
  const t = r8(p + 0xB4) & 0x3F;
  if (t === 0x11) return true;
  if (t === 0x01) return false;          // on fire: allowed (no bomb scan)
  for (let x = 0; ; x += 2) {
    const w = r16(LIST + x);
    if (w === 0xFFFF) return false;
    const b = bptr(w);
    if (r16(b) & 0x5000) continue;
    if (r16(b + 2) === r16(p + 0xAA)) return true;
  }
}

function C0319A(p) {                     // a mover on / entering the bomber's cell
  for (let x = 0; ; x += 2) {
    const o = r16(0x2620 + x);
    if (o === 0xFFFF) return false;
    if (o < 0x8400) continue;
    const t = r16(o + 0x7E);
    if (!(t & 0x0100) && (t & 0x3F) !== 0x29) continue;
    const c = r16(p + 0xA8);
    if (r16(0x2720 + x) === c) return true;
    if (r16(o + 0xA8) === c) return true;
  }
}

function C03163() {                      // bomb count limit (normal game only)
  if (r16(0xB9) & 0x8000) return false;
  let n = 0;
  for (let x = 0; r16(LIST + x) !== 0xFFFF; x += 2) n++;
  return n >= 9;
}

// C034C0: take the first free bomb slot
function spawn(p) {
  let b = BOMB0;
  let k = 0x28;
  while (r16(b) & 0x8000) { b += 0x100; if (--k === 0) return -1; }
  let type = r8(p + 0xF3);
  if ((type & 0x02) && r8(p + 0xF8)) type = 0;       // power bomb only with no bomb out
  w8(p + 0x42, type);
  w16(b, type | 0x8000);
  w16(b + 2, r16(p + 0xAA));
  w8(b + 4, 0x48);
  const owner = (p >> 8) & 0x7F;
  w8(b + 6, owner);
  w8(b + 0x0C, ((owner + 1) << 2) & 0xFF);
  C03583(p, b);
  const ser = (r16(p + 0xF6) + 1) & 0xFFFF;
  w16(p + 0xF6, ser);
  w8(b + 5, ser & 0xFF);
  w16(b + 8, 0x0001);
  const g = r16(p + 0xA8);
  w16(b + 0x0A, g);
  w16(GRID + g, 0x0043);
  if (r16(b) & 0x0002) w8(b + 7, 9);
  return b;
}

function C03583(p, b) {                  // range: fire stat, or 9 on a stage-5 power tile
  const s = r16(0x1A);
  if (s === 6 || (s & 0xF0) === 0x10) {
    const c = r16(p + 0xA8);
    for (let x = 0; ; x += 4) {
      const v = r16(0x2FF0 + x);
      if (v & 0x8000) break;
      if (v === c) { w8(b + 7, 9); return; }
    }
  }
  w8(b + 7, r8(p + 0xF2));
}

// ---- AI danger marks at placement --------------------------------------------------
function C03185(b) {
  w16(DANGER + r16(b + 0x0A), 0xFFFF);
}

// C0323F / C032E5 / C03386 / C03423: build one ray table (6-byte entries: tile, grid,
// piece) and mark the danger map until the first solid / item / bomb cell.
function rayMarks(b, base, dTile, dGrid, piece, endPiece, up) {
  let blocked = 0;
  w16(0x5DAE, 0);
  let n = r8(b + 7) + 1;
  let tile = r16(b + 2), g = r16(b + 0x0A);
  let e = b + base;
  for (;;) {
    tile = (tile + dTile) & 0xFFFF;
    w16(e, tile);
    g = (g + dGrid) & 0xFFFF;
    w16(e + 2, g);
    w16(e + 4, piece);
    if (!blocked) {
      if (up && g >= 0x2000) blocked = 1;
      else {
        const c = r16(GRID + g);
        if ((c & 0x80) || c === 0x44 || c === 0x43) blocked = 1;
        else {
          if (r16(UNDER + g) === 0x000E) w16(0x5E46, 0xFFFF);
          w16(DANGER + g, 0xFFFF);
        }
      }
      if (blocked) w16(0x5DAE, 0xFFFF);
    }
    if (--n === 0) break;
    e += 6;
  }
  w16(e + 4, endPiece);
}

function C107CB() {                      // a mark touched the stage-4 fuse: whole ring
  if (!r16(0x5E46)) return;
  for (const g of fuseCells) w16(DANGER + g, 0xFFFF);
}

// ---- B: remote detonation (C02A7A) ------------------------------------------------
function remoteButton(p) {
  if (!(r16(p + 0x6E) & 0x8000)) { w16(p + 0x0E, r16(p + 0x0E) & 0xF7FF); return; }
  const e = r16(p + 0x0E);
  if (e & 0x0800) return;
  w16(p + 0x0E, e | 0x0800);
  const owner = (p & 0x07FF) >> 8;
  C02B25(owner);
  C02AB5();
}

function C02B25(owner) {                 // remote bombs of this owner -> $29E0 / $2A10
  w16(0x29E0, 0xFFFF);
  w16(0x2A10, 0xFFFF);
  let k = 0;
  for (let x = 0; ; x += 2) {
    const w = r16(LIST + x);
    if (w === 0xFFFF) break;
    const b = bptr(w);
    const f = r16(b);
    if (f & 0x4000) continue;
    if (!(f & 0x0001)) continue;
    if (r8(b + 6) !== owner) continue;
    w16(0x29E0 + k, w);
    w16(0x2A10 + k, r8(b + 5));
    k += 2;
    w16(0x29E0 + k, 0xFFFF);
    w16(0x2A10 + k, 0xFFFF);
  }
}

function C02AB5() {                      // the oldest one (lowest serial) goes off
  if (r16(0x29E0) & 0x8000) return;
  if (!(r16(0x29E2) & 0x8000)) {
    for (let x = 2; !(r16(0x2A10 + x) & 0x8000); x += 2) {
      if (r16(0x2A10 + x) >= r16(0x2A10)) continue;
      let t = r16(0x2A10 + x); w16(0x2A10 + x, r16(0x2A10)); w16(0x2A10, t);
      t = r16(0x29E0 + x); w16(0x29E0 + x, r16(0x29E0)); w16(0x29E0, t);
    }
  }
  let w = -1;
  for (let x = 0; ; x += 2) {
    const v = r16(0x29E0 + x);
    if (v & 0x8000) { w = r16(0x29E0); break; }
    if (!(r16(bptr(v)) & 0x1000)) { w = v; break; }
  }
  const b = bptr(w);
  w8(b + 4, 2);
  w16(b, r16(b) | 0x0080);
  emit('remote', { bomb: (b - BOMB0) >> 8, ...cellOf(r16(b + 0x0A)) });
}

// ---- X: stop your kicked bomb (C029FD) --------------------------------------------
function stopButton(p) {
  if (!(r16(p + 0x6E) & 0x0040)) { w16(p + 0x0E, r16(p + 0x0E) & 0xFDFF); return; }
  const e = r16(p + 0x0E);
  if (e & 0x0200) return;
  w16(p + 0x0E, e | 0x0200);
  const owner = (p & 0x7FFF) >> 8;
  for (let x = 0; ; x += 2) {
    const o = r16(0x2620 + x);
    if (o === 0xFFFF) return;
    if (o < 0x8400) continue;
    if (!(r16(o + 0x52) & 0x0020)) continue;
    if (r16(o + 6) !== owner) continue;
    if (r16(GRID + r16(o + 0xA8)) === 0x0043) continue;
    for (const off of [0x14, 0x16, 0x24, 0x26, 0x1C, 0x1E, 0x2C, 0x2E]) w16(o + off, 0); // C02994
    if (movers.stopKicked) movers.stopKicked(o);                                      // C029C0 -> C08BDA
  }
}

// ================================================================================
// Even-tick bomb update (C0E0AA)
// ================================================================================
export function update() {
  if (r16(0x32) & 1) return;
  if (r16(0x5D60) & 0x8000) C0DF30();
  C0DEE7();
  for (let x = 0; ; x += 2) {
    w16(0x1C, x);
    const w = r16(LIST + x);
    if (w === 0xFFFF) return;
    const b = bptr(w);
    if (r16(b) & 0x4000) { explosion(b); continue; }
    tickBomb(b);                         // C0E980
    if (r16(b) & 0x4000) return;         // one detonation per update
  }
}

export function C0DEE7() {               // rebuild the bomb list (unless $5D60 < 0)
  if (r16(0x5D60) & 0x8000) return;
  C0DEEE();
}

export function C0DEEE() {
  w16(LIST, 0xFFFF);
  let x = 0;
  for (let k = 0; k < 0x28; k++) {
    const b = BOMB0 + k * 0x100;
    if (r16(b) & 0x8000) {
      w16(LIST + x, 0x2000 + k * 0x100);
      x += 2;
      w16(LIST + x, 0xFFFF);
    }
  }
}

function C0DF30() {                      // stage 8: bombs resting on the conveyor
  C0DEEE();
  for (let x = 0; ; x += 2) {
    w16(0x1C, x);
    const w = r16(LIST + x);
    if (w === 0xFFFF) return;
    const b = bptr(w);
    const f = r16(b);
    if (f & 0x5000) continue;
    if (!((f & 0x0001) && !(f & 0x0080))) {
      if (r8(b + 4) === 1) continue;
    }
    const t = r16(UNDER + r16(b + 0x0A)) & 0x3F;
    if (t < 0x17 || t >= 0x1F) continue;
    if (stage.conveyorBomb) stage.conveyorBomb(b);   // C0DF87 (stage 8 code)
  }
}

function tickBomb(b) {                   // C0E980
  let f = r16(b);
  if (f & 0x1000) return;                // carried / kicked: the mover runs the fuse
  const g = r16(b + 0x0A);
  let boom = r16(GRID + g) === 0x0001;
  if (!boom && !(r16(0xB9) & 0x8000) && r16(UNDER + g) === 0x0001) boom = true;
  if (!boom) {
    let count;
    if (f & 0x0080) count = (f & 0x0040) || !(r16(0xB9) & 0x4000);
    else if (f & 0x0001) count = false;
    else count = (f & 0x0040) || !(r16(0xB9) & 0x4000);
    if (count) {
      const fuse = (r8(b + 4) - 1) & 0xFF;
      if (fuse === 0) boom = true;
      else w8(b + 4, fuse);
    }
  }
  if (boom) {
    refund(b);                           // C0E46C
    detonate(b);                         // C0EA83
    // C3A4B5: sound $42
    emit('bombExploded', { bomb: (b - BOMB0) >> 8, owner: r8(b + 6), ...cellOf(g), range: r8(b + 7), sfx: 0x42 });
    return;
  }
  // C0E9DE: re-assert the bomb cell and animate the fizz
  if (r16(b) & 0x0020) return;
  w16(GRID + g, 0x0043);
  f = r16(b);
  const tab = (f & 0x0800) ? BOMB_ANIM.scatter : BOMB_ANIM[f & 0x1F];
  let t8 = (r8(b + 8) - 1) & 0xFF;
  w8(b + 8, t8);
  if (t8) return;
  w8(b + 8, 2);
  const fr = r8(b + 9);
  w8(b + 9, (fr + 1) & 0xFF);
  let tile = tab && fr < tab.length ? tab[fr] : 0xFFFF;
  if (tile & 0x8000) { w8(b + 9, 0); tile = tab ? tab[0] : 0; }
  w16(TILE + r16(b + 2), tile | (r8(b + 0x0C) << 8));
  dangerRefresh(b);                      // C0E174
}

// C0E46C: the owner gets the bomb back
function refund(b) {
  const o = (r16(b) & 0x0800) ? 0x8500 : (0x8000 | ((r8(b + 6) | 0x80) << 8)) & 0xFFFF;
  let out = r8(o + 0xF8);
  if (out) { out--; w8(o + 0xF8, out); }
  const d = r8(o + 0xF5);
  let hand;
  if (d === 3) hand = 0;
  else if (d === 6) hand = out === 0 ? 1 : 0;
  else hand = (r8(o + 0xE1) - r8(o + 0xF8)) & 0xFF;
  w8(o + 0xF1, hand);
}

// C0EA83: detonation — walk the 4 rays
function detonate(b) {
  w16(b, r16(b) | 0x4000);
  w16(b + 8, 0);
  w16(0x5C12, 0);
  ray(b, 0x10, 0x4C, true);              // C0EAA7 up (cuts the hit bomb's down ray)
  ray(b, 0x4C, 0x10, false);             // C0EB8E down
  ray(b, 0xC4, 0x88, false);             // C0EC68 right
  ray(b, 0x88, 0xC4, false);             // C0ED42 left
}

function ray(b, base, back, up) {
  let n = r8(b + 7) + 1;
  let e = b + base;
  for (;;) {
    if (up && r16(e + 2) >= 0x2000) { w16(e, 0xFFFF); return; }
    if (r16(e) === 0xFFFF) return;
    const g = r16(e + 2);
    const t = r16(GRID + g) & 0x3F;
    w16(0x5BEE, t);
    // (normal-game cell types $22 / $16 and C146E9 are not used in battle)
    if (t !== 0x0F && t !== 0x09) {
      if (t === 0x03) { chain(b, e, back); w16(e, 0xFFFF); return; }
      if (t === 0x02 || t === 0x04 || t === 0x0B) {
        queueBurn(b, e, t, g);           // C0EF44
        if (r16(b) & 0x0004) {           // pierce: keep going
          if (r16(0x5BEE) === 0x0005) { w16(e, 0xFFFF); return; }
          if (--n === 0) return;
          e += 6;
          continue;
        }
      }
      const c = r16(GRID + g);
      if (c & 0x80) { w16(e, 0xFFFF); return; }
      const ct = c & 0x3F;
      if (ct === 0x26 || ct === 0x04 || ct === 0x0B) { w16(e, 0xFFFF); return; }
    }
    if (--n === 0) return;
    e += 6;
  }
}

// C0EFD3: a ray reached a bomb: set it off (fuse 2, forced) and cut its ray pointing back
function chain(b, e, back) {
  const tile = r16(e);
  for (let k = 0; k < 0x28; k++) {
    const o = BOMB0 + k * 0x100;
    const f = r16(o);
    if (!f || (f & 0x5000)) continue;
    if (r16(o + 2) !== tile) continue;
    w16(o, f | 0x00C0);
    w8(o + 4, 2);
    w16(o + back, 0xFFFF);
    emit('chain', { bomb: k, ...cellOf(r16(o + 0x0A)) });
    return;
  }
}

// C0E0F0: a running explosion (one phase per bomb update)
function explosion(b) {
  const t = r8(b + 8);
  if (t) {
    const n = (t - 1) & 0xFF;
    if (n) { w8(b + 8, n); return; }
  }
  const ph = r8(b + 9);
  flameCentre(b, ph);                    // C0E679
  flameRay(b, 0x10, ph, true);           // C0E86D up
  flameRay(b, 0x4C, ph, false);          // C0E6CC down
  flameRay(b, 0x88, ph, false);          // C0E757 left
  flameRay(b, 0xC4, ph, false);          // C0E7E2 right
  const d = PHASES[ph] ?? 0xFF;
  if (d !== 0xFF) { w8(b + 8, d); w8(b + 9, (ph + 1) & 0xFF); return; }
  w8(b + 9, 0);
  explosionEnd(b);                       // C0E14F
}

function flameCentre(b, ph) {
  const tile = FLAME[0][ph] | (r8(b + 0x0C) << 8);
  w16(GRID + r16(b + 0x0A), 0x0001);
  w16(TILE + r16(b + 2), tile);
}

function flameRay(b, base, ph, up) {
  let n = r8(b + 7) + 1;
  for (let e = b + base; ; e += 6) {
    if (up ? r16(e) >= 0x2000 : r16(e) === 0xFFFF) return;
    const tile = (FLAME[r16(e + 4)] || FLAME[0])[ph] | (r8(b + 0x0C) << 8);
    fuseHook(b, e);                      // C0E8F8
    const g = r16(e + 2);
    w16(GRID + g, 0x0001);
    w16(TILE + r16(e), tile);
    if (--n === 0) return;
  }
}

function fuseHook(b, e) {                // C0E8F8: fire on a stage-4 fuse cell
  if (r16(0x1A) !== 5) return;
  const g = r16(e + 2);
  w16(0x5CEC, g);
  if (r16(UNDER + g) !== 0x000E) return;
  if (!fuseCells.includes(g)) {          // C0E956: a fuse cell outside the list
    if (r16(0x5CDE) & 0x8000) { w16(0x5CDE, 0); emit('fuseRing', { second: true, sfx: 0x6A }); }
    w16(0x5CEE, r8(b + 0x0C) << 8);
    return;
  }
  if (r16(0x5CE2) & 0x8000) {            // C0E919
    w16(0x5CE2, 0);
    // C3A4B5: sound $6A
    emit('fuseRing', { sfx: 0x6A });
  }
  w16(0x5CF0, r8(b + 0x0C) << 8);
}

// C0E14F: explosion over — restore the cells, free the slot, clear the danger lines
function explosionEnd(b) {
  w16(b, 0);                             // C0E4E3
  let x = r16(b + 2); w16(TILE + x, r16(TILE_UNDER + x));
  x = r16(b + 0x0A); w16(GRID + x, r16(UNDER + x));
  restoreRay(b, 0x10);                   // C0E5FE
  restoreRay(b, 0x4C);                   // C0E505
  restoreRay(b, 0x88);                   // C0E558
  restoreRay(b, 0xC4);                   // C0E5AB
  dangerClear(b);                        // C0E303
}

function restoreRay(b, base) {
  let n = r8(b + 7) + 1;
  for (let e = b + base; ; e += 6) {
    if (r16(e) === 0xFFFF) return;
    let x = r16(e); w16(TILE + x, r16(TILE_UNDER + x));
    const g = r16(e + 2);
    w16(0x5E, g);
    w16(GRID + g, r16(UNDER + g));
    C122F3(g);
    C12282(g);
    if (--n === 0) return;
  }
}

function C122F3(g) {                     // normal-game switch tile (inactive in battle)
  const s = r16(0x5AAC);
  if (s & 0x8000) return;
  if (r16(0x5AAE) !== g) return;
  const t = (s & 1) ? 0x106E : 0x106C;
  w16(TILE + r16(0x5AB0), t);
  w16(0x5AB2, t);
  w16(0x5AAC, s ^ 1);
}

function C12282(g) {                     // normal-game toggle cells (inactive in battle)
  if (r16(0x5B56) & 0x8000) return;
  const s = r16(0x5D94);
  if ((s & 0x8000) || !(s & 1)) return;
  const c = r16(GRID + g);
  if (c !== 0x73 && c !== 0x74) return;
  for (let q = 0x5B56; r16(q) !== 0xFFFF; q += 8) {
    if (r16(q + 2) !== g) continue;
    const t = (r16(q) & 1) ? 0x1248 : 0x1246;
    const x = r16(q + 4);
    w16(TILE + x, t); w16(TILE_UNDER + x, t);
    w16(q, r16(q) ^ 1);
  }
}

// ---- danger map ---------------------------------------------------------------------
function dangerRefresh(b) {              // C0E174 (every 2nd bomb update)
  w16(DANGER + r16(b + 0x0A), 0xFFFF);
  for (const [base, up] of [[0x10, true], [0x4C, false], [0x88, false], [0xC4, false]]) {
    let n = r8(b + 7) + 1;
    for (let e = b + base; ; e += 6) {
      if (up && r16(e + 2) >= 0x2000) break;
      if (r16(e) === 0xFFFF) break;
      const g = r16(e + 2);
      const c = r16(GRID + g);
      if ((c & 0x80) || c === 0x44 || c === 0x43) break;
      w16(DANGER + g, 0xFFFF);
      if (--n === 0) break;
    }
  }
}

export function dangerClear(b) {         // C0E303 (also used for bombs removed otherwise)
  w16(DANGER + r16(b + 0x0A), 0);        // C0E3D3
  for (const [base, up] of [[0x10, true], [0x4C, false], [0x88, false], [0xC4, false]]) {
    let n = r8(b + 7) + 1;
    for (let e = b + base; ; e += 6) {
      if (up && r16(e + 2) >= 0x2000) break;
      if (r16(e) === 0xFFFF) break;
      w16(DANGER + r16(e + 2), 0);
      if (--n === 0) break;
    }
  }
}

export function dangerDecay() {          // C0E076: no bomb out -> clear one cell per tick
  if (!(r16(LIST) & 0x8000)) return;
  w16(0x5DE6, 0);
  const i = r16(0x5DDC);
  const g = decayCells[i >> 1];
  if (g === undefined) { w16(0x5DDC, 0); return; }
  w16(DANGER + g, 0);
  w16(0x5DDC, i + 2);
}

// C0E46C + C0E303 for callers that remove a bomb without exploding it (sudden death)
export { refund as refundBomb };
