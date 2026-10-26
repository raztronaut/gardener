// TALL layouts (SPEC §17): the same 13 columns, 25 playfield rows (cy 4..28; border rows
// 3 and 29), for all 10 stages, generated from each stage's own map (layout_data.js):
//
//  * Every tall row copies a row of the original map (grid code, underlay, tile word and
//    underlay tile word — so cell kinds, shadows and gimmick tiles stay the original's).
//    The default row map keeps the original's top (rows 3..9) and bottom (rows 9..15 ->
//    23..29, i.e. the spawn corners with their clear L cells) and fills rows 10..22 with
//    the stage's middle pattern (pillar row 9 on odd rows, soft row 8 / 10 on even rows),
//    so the lattice stays on odd rows/columns and the field is symmetric about cy 16.
//    Per-stage maps / gimmick placement: see STAGE_ROWS and fixups() below and
//    tools/sb2/NOTES-core-tall.md.
//  * The random soft-block removal is the original C0F50D with the scan widened to 32
//    rows and N scaled by the soft-block count; the deck has 145 cards (counts x25/11,
//    rounded); sudden death covers the two outer rings of the tall field (136 blocks).
import { r8, r16, w8, w16, GRID, UNDER, TILE, TILE_UNDER, OBJ } from './mem.js';
import { STAGE_MAPS } from './layout_data.js';
import { setOffsets, maskGrids, buildDeck, regrowList, DECK_COUNTS, DECK, pixelToGrid, pixelToTile, restoreCell } from './layout.js';
import { rng } from './rng.js';
import { isTall } from './geom.js';
import * as bombs from './bombs.js';
import * as burn from './burn.js';
import * as items from './items.js';
import * as round from './round.js';
import * as stage4 from './stage4.js';
import * as stage8 from './stage8.js';

export const TALL_DECK_SIZE = 145;
const REMOVE = [12, 16, 0, 0, 0, 0, 30, 0, 23, 0, 8, 0];         // $C5EA4D[$1A]

// ---- row maps: tall row (0..31) -> original map row (0..17) ------------------------------
function generic(t) {
  if (t <= 9) return t;
  if (t >= 23) return t - 14 <= 17 ? t - 14 : 17;
  return (t & 1) ? 9 : (t < 16 ? 8 : 10);
}
const STAGE_ROWS = {
  // stage 4 (fuse ring): the centre spawn rows 8/10 land on 15/17, pillar rows (9) on the
  // even middle rows, so the 4 bombers start around the centre like the original
  5: (t) => (t <= 9 ? t : t >= 23 ? t - 14 : (t & 1) ? (t < 16 ? 8 : 10) : 9),
  // stage 7 (race track): straight segments (row 10) above and below the pad row, the
  // permanent soft block row 8 just above the pad row 16 (as 8 above 9 in the original)
  8: (t) => (t <= 7 ? t : t <= 14 ? 10 : t === 15 ? 8 : t === 16 ? 9 : t <= 23 ? 10 : t - 14),
  // stage 8 (conveyors): ring rows 6 / 26, sides on every row in between
  9: (t) => (t <= 7 ? t : t >= 25 ? t - 14 : (t & 1) ? 9 : 10),
  // stage 10 (forest): rows 6..12 repeated three times
  0xB: (t) => (t <= 5 ? t : t <= 26 ? 6 + ((t - 6) % 7) : t - 14),
};
// stage 2 (ice): the hole rows (orig 6 / 12) repeat at 12 and 20 (holes at cy 6,12,20,26)
const OVERRIDE = { 1: { 12: 6, 20: 12 } };

export function rowOf(sid, t) {
  const o = OVERRIDE[sid] && OVERRIDE[sid][t];
  if (o !== undefined) return o;
  if (t >= 30) return t - 14;
  return (STAGE_ROWS[sid] || generic)(t);
}

// ---- map ------------------------------------------------------------------------------
const hx2 = (s, c) => parseInt(s.substr(c * 2, 2), 16);
const hx4 = (s, c) => parseInt(s.substr(c * 4, 4), 16);
function src(m, row, c) {
  return { g: hx2(m.grid[row], c), u: hx2(m.under[row], c), t: hx4(m.tile[row], c), tu: hx4(m.tileUnder[row], c) };
}
function put(cx, cy, s) {
  const gi = cy * 0x80 + cx * 2, ti = cy * 0x40 + cx * 2;
  w16(GRID + gi, s.g); w16(UNDER + gi, s.u); w16(TILE + ti, s.t); w16(TILE_UNDER + ti, s.tu);
}
const get = (cx, cy) => ({ g: r16(GRID + cy * 0x80 + cx * 2), u: r16(UNDER + cy * 0x80 + cx * 2),
  t: r16(TILE + cy * 0x40 + cx * 2), tu: r16(TILE_UNDER + cy * 0x40 + cx * 2) });

export function loadTallMap(sid) {
  const m = STAGE_MAPS[sid];
  if (!m) throw new Error('unknown stage id ' + sid);
  for (let i = 0; i < 0x1000; i += 2) { w16(GRID + i, 0xC5); w16(UNDER + i, 0xC5); }
  for (let i = 0; i < 0x800; i += 2) { w16(TILE + i, 0); w16(TILE_UNDER + i, 0); }
  for (let t = 0; t < 32; t++) {
    const row = rowOf(sid, t);
    for (let c = 0; c < 17; c++) put(c, t, src(m, row, c));
  }
  fixups(sid, m);
}

// gimmick placement that a plain row copy doesn't give
function fixups(sid, m) {
  const isPower = (s) => s.u === 0x14 || s.g === 0x14;
  if (sid === 6) {                      // stage 5: power tiles on the repeated diamond
    const tileWord = src(m, 4, 8).tu;   // the power tile ((8,4) is soft in the full map)
    for (let cy = 9; cy <= 23; cy++) for (let cx = 2; cx <= 14; cx++) {
      const s = get(cx, cy);
      if (!isPower(s)) continue;
      const plain = src(m, (cy & 1) ? 9 : 8, (cy & 1) ? 6 : 7);   // a floor cell of that row kind
      s.u = 0; s.tu = plain.tu;
      if (s.g === 0x14) { s.g = 0; s.t = plain.tu; }
      put(cx, cy, s);
    }
    const tiles = [[8, 9], [6, 10], [10, 10], [4, 12], [12, 12], [8, 16], [4, 20], [12, 20], [6, 22], [10, 22], [8, 23]];
    for (const [cx, cy] of tiles) {
      const s = get(cx, cy);
      s.u = 0x14; s.tu = tileWord;
      if (s.g !== 0xC2) { s.g = 0x14; s.t = tileWord; }
      put(cx, cy, s);
    }
  } else if (sid === 9) {               // stage 8: switches straddle the centre row
    for (let cy = 8; cy <= 24; cy += 2) put(8, cy, src(m, 10, 7));   // soft like its row
    put(8, 16, src(m, 9, 8));           // open centre cell between the switches
    put(8, 15, src(m, 8, 8));           // direction switch ($12)
    put(8, 17, src(m, 10, 8));          // speed switch ($13)
  } else if (sid === 0xA) {             // stage 9: arrows only where the original has them
    for (let cy = 10; cy <= 22; cy++) for (let cx = 2; cx <= 14; cx++) {
      const s = get(cx, cy);
      if ((s.u & 0x3F) >= 0x3C && (s.u & 0x3F) <= 0x3F) {
        const plain = src(m, rowOf(sid, cy), 7);
        s.u = plain.u; s.tu = plain.tu;
        if ((s.g & 0x3F) >= 0x3C) { s.g = plain.g; s.t = plain.t; }
        put(cx, cy, s);
      }
    }
  }
}

// ---- C0F50D widened to 32 rows ----------------------------------------------------------
function softCount(sid, tall) {
  if (!tall) {
    const m = STAGE_MAPS[sid]; let n = 0;
    for (let r = 0; r < m.grid.length; r++) for (let c = 0; c < 17; c++) if (hx2(m.grid[r], c) === 0xC2) n++;
    return n;
  }
  let n = 0;
  for (let i = 0; i < 0x1000; i += 2) if ((r16(GRID + i) & 0xFF) === 0xC2) n++;
  return n;
}

export function removeSoftTall(sid) {
  w16(0x5BEE, 0); w16(0x5BF0, 0);
  const o = softCount(sid, false);
  let n = o ? Math.round((REMOVE[sid] || 0) * softCount(sid, true) / o) : 0;
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
        continue;
      }
    }
    const nx = (x + 0x10) & 0xF0;
    w16(0x5BEE, nx);
    if (nx === 0) w16(0x5BF0, (y + 0x10) & 0x1F0);
  }
}

export function tallDeckCounts(sid) {
  return DECK_COUNTS[sid].map((c) => Math.round(c * 25 / 11));
}

// ---- sudden death: the two outer rings of the tall field (clockwise from (2,4)) -----------
export function ringOrder(x0 = 2, y0 = 4, x1 = 14, y1 = 28, rings = 2) {
  const out = [];
  for (let k = 0; k < rings; k++) {
    const a = x0 + k, b = y0 + k, c = x1 - k, d = y1 - k;
    for (let x = a; x <= c; x++) out.push([x, b]);
    for (let y = b + 1; y <= d; y++) out.push([c, y]);
    for (let x = c - 1; x >= a; x--) out.push([x, d]);
    for (let y = d - 1; y > b; y--) out.push([a, y]);
  }
  return out;
}
const RING = ringOrder();               // 72 + 64 = 136 cells
export const TALL_SD_ORDER = [...RING.map((_, i) => i), 0xFE, 0xFF];
// C0D6A8 for the tall rings: [cells to mark, step] when a ring corner fills; the last entry
// keeps the original's quirk (an address that is no ring cell, so that side is never
// pre-marked).
const gi = (x, y) => y * 0x80 + x * 2;
export const TALL_SD_CORNERS = {
  [gi(2, 4)]: [13, 2], [gi(14, 4)]: [25, 0x80], [gi(14, 28)]: [13, 0xFFFE], [gi(2, 28)]: [24, 0xFF80],
  [gi(3, 5)]: [11, 2], [gi(13, 5)]: [23, 0x80], [gi(13, 27)]: [11, 0xFFFE], 0x1E06: [8, 0xFF80],
};

function ringFieldList() {               // C0F4A1 for the tall field: the ring cells only
  RING.forEach(([x, y], i) => {
    w16(0x10B10 + i * 2, gi(x, y));
    w16(0x10D10 + i * 2, y * 0x40 + x * 2);
  });
}

// AI danger decay list ($C5D46A for the tall field): every non-pillar inner cell, row-major
export const TALL_DECAY = (() => {
  const out = [];
  for (let y = 4; y <= 28; y++) for (let x = 2; x <= 14; x++) if (!(y & 1) || !(x & 1)) out.push(gi(x, y));
  return out;
})();

// fuse cells (stage 4): every $0E cell of the tall map, row-major
function fuseList() {
  const out = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 17; x++) if ((r16(UNDER + gi(x, y)) & 0x3F) === 0x0E) out.push(gi(x, y));
  return out;
}

// install / remove the layout-dependent tables of the other modules
export function syncLayout() {
  if (isTall()) {
    bombs.setLayoutTables?.({ decay: TALL_DECAY, fuse: r16(0x1A) === 5 ? fuseList() : undefined });
    items.setScatterScan?.(0x0F00, 0x0FFF);
    round.setSuddenDeathOrder?.(TALL_SD_ORDER);
    round.setSuddenDeathCorners?.(TALL_SD_CORNERS);
    if (stage4.setRing && stage4.ringLists) {   // stage 4: the fuse ring spans rows 6..26
      const main = stage4.ringLists(4, 6, 12, 26), second = stage4.ringLists(2, 4, 14, 28);
      main.term = [0x0308, 0x01C8, 0x020E, 0x01D8];      // (the original's read-past words)
      second.term = [0x0384, 0x0144, 0x0188, 0x015C];
      stage4.setRing(main, second);
    }
    stage8.setRing?.({ left: 0x40, right: 0xC0, top: 0x50, bottom: 0xB0 + 14 * 16 });   // ring rows 6 / 26
  } else {
    bombs.setLayoutTables?.({});
    items.setScatterScan?.();
    round.setSuddenDeathOrder?.(null);
    round.setSuddenDeathCorners?.(null);
    stage4.setRing?.();
    stage8.setRing?.({ left: 0x40, right: 0xC0, top: 0x50, bottom: 0xB0 });
  }
  burn.setDeckAddr?.(DECK);
}

// the tall counterpart of C0F3E4 (layout.buildLayout)
export function buildTallLayout(sid) {
  loadTallMap(sid);
  setOffsets();
  maskGrids();
  removeSoftTall(sid);
  maskGrids();
  buildDeck(sid, tallDeckCounts(sid), TALL_DECK_SIZE, DECK);
  regrowList(sid);
  ringFieldList();
  syncLayout();
}

// spawn positions (C01AF3): the corners of the tall field; stage 4 around its centre
export const TALL_SPAWN = [0x20, 0x30, 0xE0, 0x1B0, 0xE0, 0x30, 0x20, 0x1B0];
export const TALL_SPAWN4 = [0x60, 0xE0, 0xA0, 0x100, 0xA0, 0xE0, 0x60, 0x100];
export function tallSpawns() {
  const t = r16(0x1A) === 5 ? TALL_SPAWN4 : TALL_SPAWN;
  for (let s = 0; s < 4; s++) {
    w16(OBJ + s * 0x100 + 0x10, t[s * 2]);
    w16(OBJ + s * 0x100 + 0x18, t[s * 2 + 1]);
  }
}
