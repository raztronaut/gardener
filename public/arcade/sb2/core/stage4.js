// Stage 4 (barrels, $1A = 5): the fuse ring. Handlers exported under their ROM address
// (see stage.js). The ignition itself (fire written on a fuse cell, C0E8F8) is in
// bombs.js: it sets $5CE2 = 0 (ring phase) and $5CF0 = the bomb owner's palette bits.
//
// C03A89 (per tick) = C03C85 (second ring, $5CDE: never lit in battle — every $0E cell
// is in the main list) + C03A92 (main ring, $5CE2). A lit ring runs 11 phases, one
// every 3 ticks ($5CE4 timer): phases 0..9 write fire ($01) on every ring cell with the
// flame tile of that phase; phase 10 re-arms the cells ($0E) and the ring is idle again
// ($FFFF). Quirk (C03C38): the main ring writes the TILE WORD into the AI danger map
// instead of $FFFF (STA $5E where STY was meant); phase 10 writes 0. Cells whose
// underlay is a sudden-death block ($C1) are skipped. A skull item lying on a ring cell
// flies off first (C03E8A -> C0EE71).
import { r16, w16 } from './mem.js';
import * as movers from './movers.js';

// Flame tiles per piece and phase (from $C312DC via the per-phase lists $C33029/$C33055/
// $C33081/$C330AD; palette bits $1C00 masked off, the owner's palette is ORed in).
const T = (base, flip) => base.map((v) => v | flip);
const CORNER = [0xA8, 0xAA, 0xAC, 0xAE, 0xC0, 0xC2, 0xC4, 0xC6, 0xC8, 0xCA, 0x2C];
const HORIZ = [0x60, 0x62, 0x64, 0x66, 0x68, 0x6A, 0x6C, 0x6E, 0xA0, 0xA2, 0x40];
const VERT = [0x80, 0x82, 0x84, 0x86, 0x88, 0x8A, 0x8C, 0x8E, 0xA4, 0xA6, 0x2E];
const PIECE = {
  TL: T(CORNER, 0x0000), TR: T(CORNER, 0x4000), BL: T(CORNER, 0x8000), BR: T(CORNER, 0xC000),
  T: T(HORIZ, 0x0000), L: T(VERT, 0x0000),
  // the bottom row and the right column re-arm with a different flip than they burn
  B: [...T(HORIZ.slice(0, 10), 0x8000), 0xC040],
  R: [...T(VERT.slice(0, 10), 0xC000), 0x402E],
};

// ring lists [tile index, grid index, piece], processed top row, bottom row, right
// column, left column ($C5E64E, $C5E674, $C5E6B0, $C5E69A)
const row = (cy, cx0, cx1, edge) => {
  const out = [];
  for (let cx = cx0; cx <= cx1; cx++) {
    const piece = cx === cx0 ? (edge === 'T' ? 'TL' : 'BL') : cx === cx1 ? (edge === 'T' ? 'TR' : 'BR') : edge;
    out.push([cy * 0x40 + cx * 2, cy * 0x80 + cx * 2, piece]);
  }
  return out;
};
const col = (cx, cy0, cy1, edge) => {
  const out = [];
  for (let cy = cy0; cy <= cy1; cy++) out.push([cy * 0x40 + cx * 2, cy * 0x80 + cx * 2, edge]);
  return out;
};
// ring with corners (cx0, cy0)-(cx1, cy1): rows include the corners, columns don't
export function ringLists(cx0, cy0, cx1, cy1) {
  return [row(cy0, cx0, cx1, 'T'), row(cy1, cx0, cx1, 'B'), col(cx1, cy0 + 1, cy1 - 1, 'R'), col(cx0, cy0 + 1, cy1 - 1, 'L')];
}
const MAIN = ringLists(4, 6, 12, 12);      // the 28 fuse cells $C5E55C
const SECOND = ringLists(2, 4, 14, 14);    // $C5E596/$C5E5CC/$C5E628/$C5E602 (outer ring)
// the word read after each list's $FFFF terminator (left in $5CEA: the next list's data)
MAIN.term = [0x0308, 0x01C8, 0x020E, 0x01D8];
SECOND.term = [0x0384, 0x0144, 0x0188, 0x015C];

// layout-dependent (the tall layout stretches the ring): see setRing()
let mainRing = MAIN, secondRing = SECOND;
export function setRing(main, second) { mainRing = main || MAIN; secondRing = second || SECOND; }

function ringCell(phase, tileIdx, g, piece, palAddr, dangerQuirk) {   // C03E8A + C03C38/C03E2B
  w16(0x5CE8, tileIdx); w16(0x5CEA, g);
  w16(0x5C0E, g);                                        // C03E8A
  if (r16(0x1C000 + g) === 0x44) {
    w16(0x5C10, tileIdx);
    if ((r16(0x1A000 + tileIdx) & 0x3FF) === 0x20A) movers.skullFly?.();   // C0EE71
  }
  const tile = (PIECE[piece][phase] & 0xE3FF) | r16(palAddr);
  w16(0x50, tile);
  if (r16(0x1D000 + g) === 0xC1) return;                 // C03E78
  w16(0x1A000 + tileIdx, tile);
  const last = phase === 10;
  w16(0x1C000 + g, last ? 0x000E : 0x0001);
  w16(0x18000 + g, last ? 0 : (dangerQuirk ? tile : 0xFFFF));
}

function runRing(phaseAddr, timerAddr, palAddr, lists, quirk) {      // C03A92 / C03C85
  const ph = r16(phaseAddr);
  if (ph & 0x8000) return;
  const t = r16(timerAddr);
  if (t !== 0 && t - 1 !== 0) { w16(timerAddr, t - 1); return; }
  w16(timerAddr, 3);
  lists.forEach((list, li) => {
    let k = 0;
    for (const [ti, g, piece] of list) { w16(0x5CE6, (k += 4)); ringCell(ph, ti, g, piece, palAddr, quirk); }
    w16(0x5CE8, 0xFFFF); w16(0x5CEA, lists.term ? lists.term[li] : 0); w16(0x5CE6, k + 4);
  });
  const n = ph + 1;
  w16(phaseAddr, n === 11 ? 0xFFFF : n);
}

export function C03A89() {
  runRing(0x5CDE, 0x5CE0, 0x5CEE, secondRing, false);   // C03C85
  runRing(0x5CE2, 0x5CE4, 0x5CF0, mainRing, true);      // C03A92
}
