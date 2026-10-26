// Stage layouts for the original 13x11 arenas: stage maps, the random soft-block
// removal, the item deck, the sudden-death cell lists and the stage-10 regrow list.
// Every function names the 65816 routine it transliterates (round init chain C0F3E4).
import { r8, r16, w8, w16, GRID, UNDER, TILE, TILE_UNDER, DANGER } from './mem.js';
import { rng } from './rng.js';
import { STAGE_MAPS } from './layout_data.js';

// battle stage ids ($1A) of the stage-select stages 1..10
export const STAGE_IDS = [0, 1, 2, 5, 6, 7, 8, 9, 0xA, 0xB];

// $C5EA4D[$1A]: random soft-block removal count
const REMOVE = [12, 16, 0, 0, 0, 0, 30, 0, 23, 0, 8, 0];
// $C5E2A6[$1A]: stage has the soft-block regrow list (stage 10 only)
const REGROW = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
// $C5F205: item tile word per deck kind
export const DECK_TILES = [0x1600, 0x1604, 0x1602, 0x1606, 0x1622, 0x160E, 0x160A, 0x1626,
  0x1624, 0x162A, 0x1628, 0x1640, 0x1620, 0x1608, 0x164A, 0x164C];
// $C5F225[$1A] -> count per kind (16 kinds, then $FFFF)
export const DECK_COUNTS = [
  [7, 0, 6, 0, 5, 0, 1, 3, 3, 0, 0, 0, 0, 0, 0, 0],
  [6, 0, 7, 0, 5, 0, 1, 2, 2, 1, 0, 0, 0, 0, 0, 0],
  [6, 0, 6, 1, 4, 0, 1, 3, 0, 1, 0, 0, 0, 0, 0, 0],
  [7, 0, 7, 1, 5, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [5, 0, 5, 0, 5, 0, 1, 2, 2, 0, 0, 0, 0, 0, 0, 0],
  [6, 0, 2, 0, 5, 0, 1, 0, 3, 0, 2, 0, 0, 0, 0, 0],
  [5, 0, 5, 0, 5, 0, 1, 0, 4, 1, 3, 0, 0, 0, 0, 0],
  [6, 0, 6, 1, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0],
  [6, 0, 6, 0, 6, 0, 1, 2, 2, 1, 2, 0, 0, 0, 0, 0],
  [6, 0, 6, 0, 5, 0, 1, 0, 5, 1, 1, 0, 0, 0, 0, 0],
  [7, 0, 5, 1, 5, 0, 1, 3, 2, 1, 2, 0, 0, 0, 0, 0],
];
export const DECK = 0x3C48;          // $7E3C48: 64 cards + $FFFF

// C0BFE2: pixel (x, y) -> grid index (and the cell value)
export function pixelToGrid(x, y) {
  const a = (((y + r16(0x5EFB)) & 0x03F0) << 3) & 0xFFFF;
  let i = (a + ((((x + r16(0x5F01)) & 0x03F0) >> 3))) & 0xFFFF;
  if ((i & 0x7F) >= 0x40) i &= 0xFFBF;
  return i & 0x0FFF;
}

// C0A515: pixel (x, y) -> tile index
export function pixelToTile(x, y) {
  const yy = (r16(0x5EFB) + y) & 0x03F0;
  const xx = (r16(0x5F01) + x) & 0x03F0;
  return ((((yy & 0x01F0) << 2) + ((xx & 0x01F0) >> 3)) & 0x07FF);
}

// C0F601 + C0F708 (map decode): load the stage's grid, underlay and tile words.
export function loadMap(sid) {
  const m = STAGE_MAPS[sid];
  if (!m) throw new Error('unknown stage id ' + sid);
  for (let i = 0; i < 0x1000; i += 2) { w16(GRID + i, 0xC5); w16(UNDER + i, 0xC5); }
  for (let i = 0; i < 0x800; i += 2) { w16(TILE + i, 0); w16(TILE_UNDER + i, 0); }
  for (let r = 0; r < m.grid.length; r++) {
    for (let c = 0; c < 17; c++) {
      w16(GRID + r * 0x80 + c * 2, parseInt(m.grid[r].substr(c * 2, 2), 16));
      w16(UNDER + r * 0x80 + c * 2, parseInt(m.under[r].substr(c * 2, 2), 16));
      w16(TILE + r * 0x40 + c * 2, parseInt(m.tile[r].substr(c * 4, 4), 16));
      w16(TILE_UNDER + r * 0x40 + c * 2, parseInt(m.tileUnder[r].substr(c * 4, 4), 16));
    }
  }
}

// C0F5D3: arena pixel offsets and position masks used by the cell lookups
export function setOffsets() {
  w16(0x5EFD, 0x03FE);
  w16(0x5F03, 0);
  w16(0x5EFB, 0x17); w16(0x5EF9, 0x17);
  w16(0x5F01, 0x08); w16(0x5EFF, 0x08);
}

// C0F5AF: grid + underlay words masked to their low byte, copied to $7FE000
export function maskGrids() {
  for (let i = 0; i < 0x2000; i += 2) {
    const v = r16(GRID + i) & 0xFF;
    w16(GRID + i, v);
    w16(0x1E000 + i, v);
  }
}

// C0DDF7: restore a cell (grid index gi, tile index ti) from the underlay
export function restoreCell(gi, ti) {
  w16(0x42, gi); w16(0x44, ti);
  w16(GRID + gi, r16(UNDER + gi));
  w16(DANGER + gi, 0);
  w16(TILE + ti, r16(TILE_UNDER + ti));
}

// C0F50D: random soft-block removal. Scans x = 0,16..240 (inner) / y (outer), wrapping
// forever; every soft cell draws one RNG value and is removed when it is >= $80.
export function removeSoft(sid) {
  if (!(r16(0xB9) & 0x8000)) return;
  w16(0x5BEE, 0); w16(0x5BF0, 0);
  let n = REMOVE[sid] || 0;
  if (!n) return;
  w16(0x5BF2, n);
  for (;;) {
    const x = r16(0x5BEE), y = r16(0x5BF0);
    const gi = pixelToGrid(x, y);
    w16(0x5BFC, gi);
    if ((r16(GRID + gi) & 0x3F) === 2) {
      const ti = pixelToTile(x, y);
      w16(0x5BFA, ti);
      rng();
      if (r16(0x400) >= 0x80) {
        restoreCell(gi, ti);
        n = r16(0x5BF2) - 1;
        if (n === 0) return;
        w16(0x5BF2, n);
        continue;                   // same cell again (it is no longer soft)
      }
    }
    const nx = (x + 0x10) & 0xF0;
    w16(0x5BEE, nx);
    if (nx === 0) w16(0x5BF0, (y + 0x10) & 0xF0);
  }
}

// C01CEA: the item deck. 64 blank cards ($8000); for each kind its count of cards at
// RNG()&63, retried while taken. Quirk kept: a free position is drawn BEFORE the count is
// checked, so every kind (and the terminator) wastes one successful draw.
export function buildDeck(sid, counts = DECK_COUNTS[sid], size = 64, deck = DECK) {
  for (let i = 0; i < size; i++) w16(deck + i * 2, 0x8000);
  w16(deck + size * 2, 0xFFFF);
  let k = 0;
  for (;;) {
    let placed = 0;
    for (;;) {
      let x;
      // (the original: RNG & 63; a larger deck — tall layouts — uses RNG mod size)
      do { rng(); x = (size === 64 ? (r16(0x400) & 0x3F) : (r16(0x400) % size)) * 2; } while (!(r16(deck + x) & 0x8000));
      if (k >= counts.length) return;
      if (counts[k] === placed) { k++; break; }
      placed++;
      w16(deck + x, DECK_TILES[k]);
    }
  }
}

// C0F428: stage 10 — list of the regrowable soft cells ($7F0300 grid idx, $7F0700 tile idx)
export function regrowList(sid) {
  if (!REGROW[sid]) return;
  for (let i = 0; i < 0x1000; i += 2) w16(0x10300 + i, 0);   // C0F415
  let n = 0;
  for (let y = 0; y < 0x200; y += 0x10) {
    for (let x = 0; x < 0x200; x += 0x10) {
      const gi = pixelToGrid(x, y);
      if (r16(GRID + gi) === 0xC2 && r16(UNDER + gi) === 0) {
        w16(0x10300 + n, gi);
        w16(0x10700 + n, pixelToTile(x, y));
        n += 2;
      }
    }
  }
}

// C0F4A1: the inner field, row-major: $7F0B10 grid indices, $7F0D10 tile indices
// (the sudden-death order $C5E1C9 indexes this list).
export function fieldList(cols = 13, rows = 11) {
  if (!(r16(0xB9) & 0x8000)) return;
  let n = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = 0x20 + i * 0x10, y = 0x30 + j * 0x10;
      w16(0x10B10 + n, pixelToGrid(x, y));
      w16(0x10D10 + n, pixelToTile(x, y));
      n += 2;
    }
  }
}

// C0F3E4: the whole layout chain of a round (after C0F1E0's graphics setup).
export function buildLayout(sid) {
  loadMap(sid);          // C0F36F/C0F3C2/C0F8B3/C0F815/C0F601
  setOffsets();          // C0F5D3
  maskGrids();           // C0F5AF
  removeSoft(sid);       // C0F50D
  maskGrids();           // C0F5AF
  buildDeck(sid);        // C01CEA
  regrowList(sid);       // C0F428
  fieldList();           // C0F4A1
}
