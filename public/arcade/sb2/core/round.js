// Round flow: fade-in, clock, "Hurry!", sudden death, round end (SPEC §13,
// tools/sb2/re/notes-round.md).
import { r8, r16, w8, w16, OBJ, GRID, UNDER, TILE, TILE_UNDER, DANGER, BOMB_LIST, cellX, cellY } from './mem.js';
import { emit } from './events.js';
import { isTall, sdDigits, hurryDigits, sdBlockSteps } from './geom.js';

// $C5D432: clock digit tiles
const DIGIT = [0x288F, 0x2886, 0x2887, 0x2888, 0x2889, 0x288A, 0x288B, 0x288C, 0x288D, 0x288E];

export function fade() {               // C00C36
  if ((r8(0x30) & 0x0F) >= 0x0F) return;
  const n = (r16(0x5E32) + 1) & 0xFFFF;
  w16(0x5E32, n);
  if (n < 3) return;
  if (r8(0x30) !== 0x0F) w8(0x30, (r8(0x30) + 1) & 0xFF);
}

// C10C3C / C10B76: "Hurry!" when the clock shows 0:38 (not with TIME = infinite). The
// banner object at $7EF000 (C10BCC) is display only and not modelled; $5E34 b15 latches.
export function hurry() {
  if (r16(0x5E34) & 0x8000) return;
  if (r16(0x5C54) === 4) return;
  const hd = hurryDigits();            // tall: 0:52 (geom.js)
  if (r16(0x5E04) !== hd[0] || r16(0x5E06) !== hd[1] || r16(0x5E08) !== hd[2]) return;
  w16(0x5E34, r16(0x5E34) | 0x8000);
  emit('hurry', { sfx: 0x4E });
}

// ---- sudden death -------------------------------------------------------------------
// $C5E1C9: order of the falling blocks as indices into the row-major inner field list
// ($7F0B10, C0F4A1); $FE = stop unless the hidden option $1C68 is set, $FF = end.
export const SD_ORDER = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 25, 38, 51, 64, 77, 90, 103, 116, 129, 142, 141,
  140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 117, 104, 91, 78, 65, 52, 39, 26, 13, 14, 15, 16, 17,
  18, 19, 20, 21, 22, 23, 24, 37, 50, 63, 76, 89, 102, 115, 128, 127, 126, 125, 124, 123, 122, 121, 120, 119,
  118, 105, 92, 79, 66, 53, 40, 27, 0xFE, 28, 29, 30, 31, 32, 33, 34, 35, 36, 49, 62, 75, 88, 101, 114,
  113, 112, 111, 110, 109, 108, 107, 106, 93, 80, 67, 54, 41, 42, 43, 44, 45, 46, 47, 48, 61, 74, 87, 100,
  99, 98, 97, 96, 95, 94, 81, 68, 55, 56, 57, 58, 59, 60, 73, 86, 85, 84, 83, 82, 69, 70, 71, 72,
  0xFF,
];
const SD_STEPS = [0x18CC, 0x18CC, 0x18CC, 0x18CC, 0xFFFF];   // $C5E25A
let sdOrder = SD_ORDER;                // tall layouts install their own order
export function setSuddenDeathOrder(order) { sdOrder = order || SD_ORDER; }

export function suddenDeath() {        // C0D843
  const b9 = r16(0xB9);
  if (!(b9 & 0x8000) || (b9 & 0x4000)) return;
  const f = r16(0x5D0E);
  if (f & 0x0001) {
    if (!(f & 0x0002)) sdStep();
    return;
  }
  if (r16(0x5C54) === 4) return;
  const sd = sdDigits();               // tall: 0:47 (geom.js)
  if (r16(0x5E04) === sd[0] && r16(0x5E06) === sd[1] && r16(0x5E08) === sd[2]) {
    w16(0x5D0E, f | 0x0001);
    emit('suddenDeath', {});
  }
}

function sdStep() {                    // C0D5BB
  tunnelsClose();                      // C0D52B (stage 3)
  const c = r16(0x5D10);
  if (c !== 0 && c - 1 !== 0) { w16(0x5D10, c - 1); return; }
  w16(0x5D10, 3);
  if (!(r16(0x5D0E) & 0x0004)) {
    w16(0x5D0E, r16(0x5D0E) | 0x0004);
    for (;;) {
      const k = r16(0x5D12);
      w16(0x5D12, k + 1);
      const v = sdOrder[k] ?? 0xFF;
      w16(0x40, v);
      if (v === 0xFF || (v === 0xFE && !r16(0x1C68))) { w16(0x5D0E, r16(0x5D0E) | 0x0002); return; }
      if (v === 0xFE) continue;
      w16(0x5D16, r16(0x10B10 + v * 2));
      w16(0x5D18, r16(0x10D10 + v * 2));
      break;
    }
  }
  const step = r16(0x5D14);
  const tile = step + 1 >= sdBlockSteps() ? 0xFFFF : (SD_STEPS[step] ?? 0xFFFF);   // tall: 3-step blocks with 'pace'
  if (tile & 0x8000) {
    w16(0x5D14, 0);
    w16(0x5D0E, r16(0x5D0E) & 0xFFFB);
    return;
  }
  w16(0x42, tile);
  sdDeleteBomb();                      // C0D7F3
  sdCancelRegrow();                    // C0D7CC
  const gi = r16(0x5D16);
  if (r16(GRID + gi) !== 0x4C) {
    w16(GRID + gi, 0xC1); w16(UNDER + gi, 0xC1);
    w16(DANGER + gi, 0);
    const ti = r16(0x5D18);
    w16(TILE + ti, tile); w16(TILE_UNDER + ti, tile);
    sdCornerDanger(gi);                // C0D6A8
    if (step === 0) emit('blockFell', { cx: cellX(gi), cy: cellY(gi), sfx: 0x72 });
    // C10761: the falling-block sprite (display only)
  }
  w16(0x5D14, step + 1);
}

// C0D6A8: a block on a ring corner marks the next side of the ring as dangerous for the AI
const SD_CORNERS = { 0x0204: [0x0D, 2], 0x021C: [0x0B, 0x80], 0x071C: [0x0D, 0xFFFE], 0x0704: [0x0A, 0xFF80],
  0x0286: [0x0B, 2], 0x029A: [0x09, 0x80], 0x069A: [0x0B, 0xFFFE], 0x1E06: [0x08, 0xFF80] };
let sdCorners = SD_CORNERS;
export function setSuddenDeathCorners(c) { sdCorners = c || SD_CORNERS; }
function sdCornerDanger(gi) {
  const e = sdCorners[gi];
  if (!e) return;
  let a = gi;
  for (let n = e[0]; n > 0; n--) { w16(DANGER + (a & 0xFFFF), 0xFFFF); a = (a + e[1]) & 0xFFFF; }
}

function sdCancelRegrow() {            // C0D7CC: a block on a pending stage-10 regrow cell
  const gi = r16(0x5D16);
  if (r16(GRID + gi) !== 0xC2) return;
  if (!r16(0x10B00)) return;
  if (r16(0x10B02) !== gi) return;
  w16(0x10B00, 0);
}

function sdDeleteBomb() {              // C0D7F3: a bomb under the block vanishes
  const gi = r16(0x5D16);
  if (r16(GRID + gi) !== 0x43) return;
  for (let x = 0; ; x += 2) {
    const b = r16(BOMB_LIST + x);
    if (b === 0xFFFF) return;
    const p = 0x10000 + b;             // bomb pointers are $7F:xxxx
    if (r16(p + 0x0A) !== gi) continue;
    if (r16(p) & 0x5000) return;       // exploding / held
    w16(p, 0);
    returnBomb(p);                     // C0E42E
    return;
  }
}

// C0E42E: give a bomb back to its owner (+F8 out -1, +F1 in hand re-derived)
function returnBomb(b) {
  const o = 0x8000 | ((r8(b + 6) | 0x80) << 8) & 0xFF00;
  let out = r8(o + 0xF8);
  if (out) { out--; w8(o + 0xF8, out); }
  const dis = r8(o + 0xF5);
  let hand;
  if (dis === 3) hand = 0;
  else if (dis === 6) hand = out === 0 ? 1 : 0;
  else hand = (r8(o + 0xE1) - out) & 0xFF;
  w8(o + 0xF1, hand);
}

// C0D52B: stage 3 closes its 4 border tunnels at the first sudden-death step: 8 entries
// in the cell-animation list $7E3D88 (cells $C5E286 / tiles $C5E296, script $C5E264;
// the list is run by C0DA42, which writes the $C1 cells).
const TUNNEL_TILES = [0x0188, 0x0108, 0x0198, 0x0118, 0x0788, 0x0808, 0x0798, 0x0818];
const TUNNEL_CELLS = [0x00C8, 0x0088, 0x00D8, 0x0098, 0x03C8, 0x0408, 0x03D8, 0x0418];
// tall: (4,3) (4,2) (12,3) (12,2) as above, then (4,29) (4,30) (12,29) (12,30)
const TALL_TUNNEL_TILES = [0x0188, 0x0108, 0x0198, 0x0118, 0x0E88, 0x0F08, 0x0E98, 0x0F18];
const TALL_TUNNEL_CELLS = [0x00C8, 0x0088, 0x00D8, 0x0098, 0x0748, 0x0788, 0x0758, 0x0798];
function tunnelsClose() {
  if (r16(0x1A) !== 2) return;
  if (r16(0x5E3C) & 0x8000) return;
  w16(0x5E3C, r16(0x5E3C) | 0x8000);
  for (let k = 0; k < 8; k++) {
    let x = -1;
    for (let e = 0; e < 16; e++) if (r16(0x3D88 + e * 16) & 0x8000) { x = e * 16; break; }
    if (x < 0) return;
    const a = 0x3D88 + x;
    w16(a, 0);
    w16(a + 2, (isTall() ? TALL_TUNNEL_CELLS : TUNNEL_CELLS)[k]);   // tall: bottom tunnels at rows 29/30
    w16(a + 4, (isTall() ? TALL_TUNNEL_TILES : TUNNEL_TILES)[k]);
    w16(a + 6, 0);
    w16(a + 8, 0);
    w8(a + 10, 0x64); w8(a + 11, 0xE2); w8(a + 12, 0xC5);
  }
}

export function effects() {}           // C10CAF: effect objects at $7EF000 — display only

export function clock() {              // C11C1A
  if (r16(0x5E20) & 0x8000) return;    // stopped
  if (r16(0xB9) & 0x8000) { if (r16(0x5C54) === 4) return; }
  else if (r16(0x5C54) >= 0x0A) return;
  const sub = r16(0x5E14);
  if (sub !== 0x40) { w16(0x5E14, sub + 1); return; }
  w16(0x5E14, 0);
  // C11D17: one second down
  const s = r16(0x5E12) - 1;
  if (s >= 0) w16(0x5E12, s);
  else {
    const m = r16(0x5E10);
    if (m === 0) w16(0x5C56, 0);       // time up
    else { w16(0x5E10, m - 1); w16(0x5E12, 0x3B); }
  }
  // C11CA3 / C11C78: displayed digits
  const sec = r16(0x5E12);
  w16(0x5E16, 0); w16(0x5E18, 0); w16(0x5E1A, 0);
  w16(0x5E1C, Math.floor(sec / 10)); w16(0x5E1E, sec % 10);
  w16(0x5E04, r16(0x5E10)); w16(0x5E06, r16(0x5E1C)); w16(0x5E08, r16(0x5E1E));
  // C11C78: digit tiles
  w16(0x5E0A, DIGIT[r16(0x5E04)] ?? 0); w16(0x5E0C, DIGIT[r16(0x5E06)] ?? 0); w16(0x5E0E, DIGIT[r16(0x5E08)] ?? 0);
  emit('clock', { min: r16(0x5E10), sec });
}

export function end() {                // C00A38
  let b9 = r16(0xB9);
  if (b9 & 0x4000) {
    w16(0xBE, (r16(0xBE) - 1) & 0xFFFF);
    if (r16(0xBE) === 0) exitBattle();   // main loop C0FB9E: the 256 ticks are over
    return;
  }
  // (b9 & 0x1000: not battle)
  // C00A27: time-up countdown word (only counts when not 0 / $FFFF)
  const t = r16(0x5C56);
  if (t !== 0 && t !== 0xFFFF) w16(0x5C56, t - 1);
  if (b9 & 0x2000) return;             // tag match (C00AC8) — not implemented
  let n = 0;
  for (let i = 0; i < 4; i++) if (r16(OBJ + i * 0x100) & 0x0800) n++;
  w16(0x40, n);
  if (n >= 3) {
    w16(0xB9, b9 | 0x4000);
    w16(0x5E20, 0x8000);
    w16(0xBE, 0x100);
    emit('roundOver', {});
  }
}

// C0FBA6..C0FBCD + C00BD6: leave the battle loop — $B9 b11, the winner ($5C3E, C00B05)
// and the fade-out ($30: 15 -> 0 one per frame, then $80 = forced blank). The scoreboard
// (win counter) follows in setup.finishRound(), called by game.nextRound().
export function exitBattle() {
  const b9 = r16(0xB9) | 0x0800;
  w16(0xB9, b9);
  let win = 0xFFFF;
  if (b9 & 0x8000) {
    if (b9 & 0x2000) return;           // tag match (C00B52) — not implemented
    win = winner();
    w16(0x5C3E, win);
  }
  w8(0x30, 0x80);
  emit('roundEnd', { winner: win === 0xFFFF ? null : win, draw: win === 0xFFFF, sfx: win === 0xFFFF ? 0x46 : undefined });
}

export function winner() {             // C00B05: first slot not dying, or $FFFF = draw
  for (let i = 0; i < 4; i++) if (!(r16(OBJ + i * 0x100) & 0x0800)) return i;
  return 0xFFFF;
}
