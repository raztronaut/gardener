// Burning soft blocks and items (burn list $7F0000, 32 x 16 bytes), the item deck reveal
// and the stage-10 regrowth list hook.
//   entry +0 tile index, +2 grid index, +4 type (2 soft / 4 item), +5 frame offset,
//   +6 frame period (3), +7 period counter, +8 owner palette byte.
import { r8, r16, w8, w16, GRID, UNDER, DANGER, TILE, TILE_UNDER, BURN } from './mem.js';
import { emit } from './events.js';
import * as stage from './stage.js';
import { spawnFlyingSkull } from './items.js';
import { returnBomb } from './round.js';
import * as movers from './movers.js';

const SOFT_FRAMES = [0x00E0, 0x00E2, 0x00E4, 0x00E6, 0x00E8, 0x00EA];                 // $C5F3F7
const ITEM_FRAMES = [0x012E, 0x014E, 0x016E, 0x018E, 0x01AE, 0x01E8, 0x01EA];         // $C5F405
const DECK = 0x3C48;
let deckAddr = DECK;                     // the tall layout moves the (145-card) deck
export function setDeckAddr(a) { deckAddr = a || DECK; }
export function getDeckAddr() { return deckAddr; }

const cellOf = (g) => ({ cx: (g & 0x7F) >> 1, cy: g >> 7 });

// C0EF44: a ray hit a soft block ($02), an item ($04) or a $0B cell. b = bomb, e = ray entry.
export function queueBurn(b, e, type, g) {
  let t = type;
  if (t === 0x0B) {
    t = 0x0004;
    w16(TILE_UNDER + r16(e), 0x1808);
    w16(UNDER + g, 0);
  }
  const tile = r16(e);
  w16(0x5C10, tile);
  if (t === 0x0004 && (r16(TILE + tile) & 0x03FF) === 0x020A) {   // a skull is not burnt:
    w16(0x5C0E, g);                                                // it flies away
    spawnFlyingSkull(b);                 // C0EE71
    return;
  }
  for (let k = 0; k < 0x20; k++) {
    const q = BURN + k * 0x10;
    const v = r16(q);
    if (v & 0x8000) {
      w16(q, tile);
      w16(q + 2, g);
      w16(q + 4, t);
      w16(q + 6, 3);
      w16(q + 8, r8(b + 0x0C));
      emit(t === 4 ? 'itemBurn' : 'blockBurn', { ...cellOf(g), owner: r8(b + 6) });
      return;
    }
    if (v === tile) return;              // already burning
  }
}

// C0DEA5: active burn entries -> $7E2860
function C0DEA5() {
  w16(0x2860, 0xFFFF);
  let x = 0;
  for (let k = 0; k < 0x20; k++) {
    const q = BURN + k * 0x10;
    if (!(r16(q) & 0x8000)) {
      w16(0x2860 + x, q & 0xFFFF);
      x += 2;
      w16(0x2860 + x, 0xFFFF);
    }
  }
}

export function update() {               // C0DCB4 (odd ticks)
  if (!(r16(0x32) & 1)) return;
  C0DEA5();
  for (let x = 0; ; x += 2) {
    w16(0x1C, x);
    const w = r16(0x2860 + x);
    if (w === 0xFFFF) return;
    C0DCDA(0x10000 + w);
  }
}

function C0DCDA(q) {
  const type = r8(q + 4);
  const v = type === 4 ? 0x0041 : 0x00C2;
  const g = r16(q + 2);
  w16(GRID + g, v);
  if (r16(UNDER + g) === 0x00C1) return C0DD76(q);       // a sudden-death block landed
  const c = r8(q + 7);
  if (c) {
    const n = (c - 1) & 0xFF;
    if (n) { w8(q + 7, n); return; }
  }
  w8(q + 7, r8(q + 6));
  const fr = r8(q + 5);
  w8(q + 5, (fr + 2) & 0xFF);
  const tab = type === 4 ? ITEM_FRAMES : SOFT_FRAMES;
  const t = tab[fr >> 1];
  if (t === undefined) return C0DD76(q);
  w16(TILE + r16(q), t | (r8(q + 8) << 8));
}

function C0DD76(q) {                     // burn finished
  const g = r16(q + 2), tile = r16(q);
  w16(0x42, g);
  w16(0x44, tile);
  // (normal game: C12200)
  if (C0DE13(q)) return;
  restore(g, tile);                      // C0DDF7
  w16(q, 0xFFFF);
}

// C0DE13: a finished soft block draws the next deck card (carry set = item revealed)
function C0DE13(q) {
  const tile = r16(q);
  if ((r16(TILE + tile) & 0x0100) === 0x0100) return false;  // a burnt item: no card
  for (let x = deckAddr; ; x += 2) {
    const c = r16(x);
    if (c === 0xFFFF) return false;
    if (c === 0) continue;
    w16(x, 0);
    if (c & 0x8000) return false;
    w16(TILE + tile, c);
    const g = r16(q + 2);
    w16(GRID + g, 0x0044);
    w16(q, 0xFFFF);
    emit('itemRevealed', { ...cellOf(g), tile: c });
    return true;
  }
}

export function restore(g, tile) {       // C0DDF7: cell back to its underlay
  w16(GRID + g, r16(UNDER + g));
  w16(DANGER + g, 0);
  w16(TILE + tile, r16(TILE_UNDER + tile));
}

// C0DA42: stage animation list ($7E3D88, 16 x 16 bytes; stage 10 regrowth). The
// per-entry routine C0DA60 is stage code: stage.regrowEntry(ptr) when it exists.
export function list() {
  w16(0x2860, 0xFFFF);                   // C0DE63
  let x = 0;
  for (let k = 0; k < 0x10; k++) {
    const q = 0x3D88 + k * 0x10;
    if (!(r16(q) & 0x8000)) {
      w16(0x2860 + x, q);
      x += 2;
      w16(0x2860 + x, 0xFFFF);
    }
  }
  for (let i = 0; ; i += 2) {
    w16(0x1C, i);
    const w = r16(0x2860 + i);
    if (w === 0xFFFF) return;
    cellAnim(w);                          // C0DA60
  }
}

// Cell-animation scripts used in battle ([tile word, duration, cell code] per frame,
// $FFFF = end): $C5E264 = stage-3 tunnel closing at sudden death (round.js C0D52B).
const CELL_SCRIPTS = { 0xC5E264: [[0x18CC, 3, 0xC1], [0x18CC, 3, 0xC1], [0x18CC, 3, 0xC1], [0x18CC, 3, 0xC1]] };

// C0DA60: one entry of the cell-animation list ($7E3D88, 16 bytes: +0 flags (b14 loop,
// $FFFF free), +2 tile index, +4 grid index, +6 frame timer, +8 frame number,
// +A..+C script pointer). Odd ticks only.
function cellAnim(q) {
  if (!(r16(0x32) & 1)) return;
  if (r16(0x1A) !== 2 && r16(UNDER + r16(q + 4)) === 0xC1) { w16(q, 0xFFFF); return; }
  let t = r8(q + 6);
  if (t !== 0 && --t !== 0) { w8(q + 6, t); return; }
  const scr = CELL_SCRIPTS[r8(q + 10) | (r8(q + 11) << 8) | (r8(q + 12) << 16)];
  for (;;) {
    const fr = scr ? scr[r16(q + 8)] : undefined;
    if (fr === undefined) {               // $FFFF: end of script
      if (r16(q) & 0x4000) { w16(q + 6, 0); w16(q + 8, 0); continue; }
      w16(q, 0xFFFF);
      return;
    }
    w16(0x5CD8, fr[0]); w16(0x5CDA, fr[1]); w16(0x5CDC, fr[2]);
    cellAnimHit(q);                       // C0DB1D
    const ti = r16(q + 2), gi = r16(q + 4);
    w16(TILE + ti, fr[0]); w16(TILE_UNDER + ti, fr[0]);
    w16(GRID + gi, fr[2]); w16(UNDER + gi, fr[2]);
    w16(q + 6, fr[1]);
    w16(q + 8, r16(q + 8) + 1);
    return;
  }
}

function cellAnimHit(q) {                 // C0DB1D: what the new cell does to its content
  const gi = r16(q + 4);
  w16(0x5C0E, gi);
  const v = r16(GRID + gi);
  if (r16(0x1A) === 2) {                  // C103D2: a bomb there vanishes, back to its owner
    if (v !== 0x43) return;
    for (let x = 0; ; x += 2) {
      const b = r16(0x2960 + x);
      if (b === 0xFFFF) return;
      const p = 0x10000 + b;
      if (r16(p + 0x0A) !== gi) continue;
      if (r16(p) & 0x5000) return;
      w16(p, 0);
      returnBomb(p);
      return;
    }
  }
  if (v === 0x44) {                       // a skull item flies off (C0EE71)
    w16(0x5C10, r16(q + 2));
    if ((r16(TILE + r16(q + 2)) & 0x3FF) === 0x20A) movers.skullFly();
  }
  // v == $43 on other stages: C0DBA0 (never reached in battle: only stage 3 queues cells)
}
