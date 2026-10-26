// Super Bomberman 2 battle core — working memory.
//
// The core keeps its authoritative state in a 128 KiB image laid out exactly like the
// original's WRAM ($7E0000-$7FFFFF). Every routine is a transliteration of the 65816
// routine named in its comment and reads/writes the same fields, so:
//   - a vector's start state is the original's WRAM (start/<vector>.wram),
//   - any byte can be compared with the original tick by tick (wtrace),
//   - the field documentation is the original's RAM map (tools/sb2/NOTES-re.md).
// The renderer does not read this directly: see view.js (game.state).
//
// Addresses used throughout the core are WRAM OFFSETS: $7E:xxxx -> 0x0xxxx,
// $7F:xxxx -> 0x1xxxx (bank $00 low RAM $0000-$1FFF is the same as $7E:0000-$1FFF).

export const WRAM_SIZE = 0x20000;

// The memory the routines operate on. One game ticks at a time (JS is single-threaded),
// so the active game swaps its image in with use() before running a tick.
export let M = new Uint8Array(WRAM_SIZE);

export function use(bytes) { M = bytes; }

export function r8(a) { return M[a]; }
export function r16(a) { return M[a] | (M[a + 1] << 8); }
export function w8(a, v) { M[a] = v; }
export function w16(a, v) { M[a] = v; M[a + 1] = v >> 8; }
// signed views
export function s8(a) { return (M[a] << 24) >> 24; }
export function s16(a) { return (r16(a) << 16) >> 16; }

// 16-bit helpers (the 65816 works on 16-bit words; keep the wrap-arounds)
export const u16 = (v) => v & 0xFFFF;
export const sx16 = (v) => (v << 16) >> 16;

// ---- frequently used regions ------------------------------------------------------
export const OBJ = 0x08000;       // $7E8000: object slots, 0x100 bytes each (0..3 = bombers)
export const OBJ_SLOTS = 32;
export const OBJ_LIST = 0x02620;  // $7E2620: active object pointers, $FFFF-terminated
export const BOMB = 0x12000;      // $7F2000: bomb slots, 0x100 bytes each
export const BOMB_SLOTS = 40;
export const BOMB_LIST = 0x02960; // $7E2960: active bomb pointers (low word), $FFFF-terminated
export const GRID = 0x1C000;      // $7FC000: collision grid, word per cell, idx = cy*0x80 + cx*2
export const UNDER = 0x1D000;     // $7FD000: underlay grid
export const DANGER = 0x18000;    // $7F8000: AI danger map
export const TILE = 0x1A000;      // $7FA000: BG tile word per cell (tile space, see tileIndex)
export const TILE_UNDER = 0x1B000;// $7FB000: underlay tile words
export const BURN = 0x10000;      // $7F0000: burn list, 32 x 16 bytes

export const gridIndex = (cx, cy) => cy * 0x80 + cx * 2;
export const cellX = (idx) => (idx & 0x7F) >> 1;
export const cellY = (idx) => idx >> 7;
// tile-space index of a cell (C0A515): ((y+$17)&$1F0)<<2 | ((x+8)&$1F0)>>3 for a pixel,
// i.e. cy*0x40 + cx*2 for a cell.
export const tileIndex = (cx, cy) => cy * 0x40 + cx * 2;
export const gridToTile = (idx) => ((idx >> 7) << 6) | (idx & 0x7F);

// libretro joypad bits (harness order) -> SNES pad word (+6E order)
export const PAD = {
  B: 0x001, Y: 0x002, SELECT: 0x004, START: 0x008, UP: 0x010, DOWN: 0x020,
  LEFT: 0x040, RIGHT: 0x080, A: 0x100, X: 0x200, L: 0x400, R: 0x800,
};
export const SNES = {
  B: 0x8000, Y: 0x4000, SELECT: 0x2000, START: 0x1000, UP: 0x0800, DOWN: 0x0400,
  LEFT: 0x0200, RIGHT: 0x0100, A: 0x0080, X: 0x0040, L: 0x0020, R: 0x0010,
};
export function padToSnes(p) {
  let s = 0;
  for (const k in PAD) if (p & PAD[k]) s |= SNES[k];
  return s;
}
