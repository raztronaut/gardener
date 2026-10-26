// Items: pickup (C0986A) and the per-tile effect handlers ($C5F145), the cure on pickup
// (C0980D, the disease leaves as a flying skull: C09231), skull roll (C099DF), a bombed
// skull flying away (C0EE71), and the items of a dead bomber re-appearing on the field
// (C097A0 when the death animation ends, then C09615 one item per tick).
import { r8, r16, w8, w16, GRID, UNDER, DANGER, TILE, TILE_UNDER } from './mem.js';
import { emit } from './events.js';
import * as move from './move.js';
import * as movers from './movers.js';
import { restore } from './burn.js';

// item kinds in deck order ($C5F205): tile words
export const ITEM_TILES = [0x1600, 0x1604, 0x1602, 0x1606, 0x1622, 0x160E, 0x160A, 0x1626,
  0x1624, 0x162A, 0x1628, 0x1640, 0x1620, 0x1608, 0x164A, 0x164C];
export const ITEM_NAMES = {
  0x00: 'bomb_up', 0x02: 'fire_up', 0x04: 'pierce', 0x06: 'full_fire', 0x08: 'bomb_pass',
  0x0A: 'skull', 0x0E: 'remote', 0x20: 'wall_pass', 0x22: 'speed_up', 0x24: 'kick',
  0x26: 'glove', 0x28: 'rubber_bomb', 0x2A: 'power_bomb', 0x40: 'heart',
};
// skull rolls: $C5EEB5 normal, $C5EEC5 stage 7 ($1A = 8), $C5EED5 with a shield
const SKULL = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 2, 4, 5, 6];
const SKULL_ST7 = [1, 2, 3, 1, 2, 6, 1, 2, 3, 6, 3, 6, 2, 1, 3, 6];
const SKULL_SHIELD = [1, 4, 3, 4, 5, 6, 1, 4, 3, 4, 5, 6, 4, 4, 5, 6];
// stat bytes counted when a dead bomber's items scatter ($C5FF7D, per kind; 0 = none)
const SCATTER_STATS = [0xE1, 0xE5, 0xE2, 0xF4, 0xE0, 0xE6, 0x00, 0xFE, 0xFF, 0xE7, 0xE8, 0x00, 0xFB, 0xFA];

const cellOf = (g) => ({ cx: (g & 0x7F) >> 1, cy: g >> 7 });
const SFX_GET = 0x4C;

// ================================================================================
// Pickup (C0986A): the bomber's centre cell holds an item
// ================================================================================
export function pickup(p) {
  if ((r8(p + 0xB4) & 0x3F) !== 0x04) return;
  cure(p);                               // C0980D
  const tile = r16(TILE + r16(p + 0xAA));
  const k = tile & 0xFF;
  const h = HANDLERS[k];
  emit('itemGot', { slot: (p - 0x8000) >> 8, item: ITEM_NAMES[k] || k, tile, ...cellOf(r16(p + 0xA8)), sfx: k === 0x24 ? 0x61 : k === 0x0A ? 0x55 : SFX_GET });
  if (h) h(p);
  else take(p);                          // (unused tiles: C09B1A / C09C75 / C09C16 just take it)
}

function take(p) {                       // C098B0: the cell reverts to its underlay
  restore(r16(p + 0xA8), r16(p + 0xAA));
}

function cure(p) {                       // C0980D
  if (!r8(p + 0xF5)) return;
  w8(p + 0xF5, 0);
  const n = r8(p + 0xE9);
  if (n) w8(p + 0xE9, n - 1);
  w16(0x5C70, 1);
  // C09850
  w16(0x5C74, 1);
  w16(0x5C72, 0);
  w16(0x5C84, 0x160A);
  flyingItem(p);                         // C09231
  emit('cured', { slot: (p - 0x8000) >> 8 });
}

const inc9 = (p, o) => { const v = r8(p + o); if (v < 9) w8(p + o, v + 1); };
const handFor = (p) => {                 // bombs in hand by disease (shared tail)
  const d = r8(p + 0xF5);
  if (d === 3) return 0;
  if (d === 6) return r8(p + 0xF8) ? 0 : 1;
  return (r8(p + 0xE1) - r8(p + 0xF8)) & 0xFF;
};

const HANDLERS = {
  0x00(p) {                              // C098C2 bomb up
    inc9(p, 0xE1);
    w8(p + 0xF1, handFor(p));
    take(p);
  },
  0x02(p) {                              // C0991D fire up
    inc9(p, 0xE2); inc9(p, 0xE4);
    w8(p + 0xF2, r8(p + 0xF5) === 6 ? 0 : r8(p + 0xE2));
    take(p);
  },
  0x04(p) { w8(p + 0xF3, 4); w8(p + 0xE5, (r8(p + 0xE5) + 1) & 0xFF); take(p); },   // C09965 pierce
  0x06(p) {                              // C09986 full fire
    w8(p + 0xF4, (r8(p + 0xF4) + 1) & 0xFF);
    w8(p + 0xE2, 9);
    w8(p + 0xF2, r8(p + 0xF5) === 6 ? 0 : r8(p + 0xE2));
    take(p);
  },
  0x08(p) { w8(p + 0xFA, (r8(p + 0xFA) + 1) & 0xFF); take(p); },                    // C099C5 bomb pass
  0x0A: skull,                                                                      // C099DF
  0x0E(p) { w8(p + 0xF3, 1); w8(p + 0xE6, (r8(p + 0xE6) + 1) & 0xFF); take(p); },   // C09B1D remote
  0x20(p) { w8(p + 0xFB, (r8(p + 0xFB) + 1) & 0xFF); take(p); },                    // C09B3E wall pass
  0x22(p) {                              // C09B58 speed up
    const v = r8(p + 0xE0); if (v < 5) w8(p + 0xE0, v + 1);
    speedTail(p);
  },
  0x24(p) { w8(p + 0xFF, (r8(p + 0xFF) + 1) & 0xFF); take(p); },                    // C09BA8 kick
  0x26(p) { w8(p + 0xFE, (r8(p + 0xFE) + 1) & 0xFF); take(p); },                    // C09BF6 glove
  0x28(p) { w8(p + 0xF3, 8); w8(p + 0xE8, (r8(p + 0xE8) + 1) & 0xFF); take(p); },   // C09C19 rubber
  0x2A(p) { w8(p + 0xF3, 2); w8(p + 0xE7, (r8(p + 0xE7) + 1) & 0xFF); take(p); },   // C09C3A power
  0x40(p) { w8(p + 0xEF, (r8(p + 0xEF) + 1) & 0xFF); take(p); },                    // C09C5B heart
};

function speedTail(p) {                  // C09B74: current speed from disease / base
  w8(p + 0xF0, 0);
  const d = r8(p + 0xF5);
  if (d === 5) { /* slow: level 0 */ }
  else if (d === 4) w8(p + 0xF0, 6);
  else w8(p + 0xF0, r8(p + 0xE0));
  move.inputVelocity?.(p);               // C0C2CE
  take(p);
}

function skull(p) {                      // C099DF
  w8(p + 0xF9, 0);
  w16(p + 0xFC, 0);
  w16(p + 4, r16(p + 4) & 0xFFBF);
  C09ACD(p);
  const i = r16(0x400) & 0x0F;
  let d;
  if (r16(0x1A) === 8) d = SKULL_ST7[i];
  else if (r8(p + 0xEF)) d = SKULL_SHIELD[i];
  else d = SKULL[i];
  if (d === 3 && (r8(p + 4) & 1)) d = 2; // COMs never get constipation
  w8(p + 0xF5, d);
  w8(p + 0xE9, (r8(p + 0xE9) + 1) & 0xFF);
  if (d === 1 || d === 4 || d === 5) {
    if (d !== 5) {
      w8(p + 0xF2, r8(p + 0xE2));
      w8(p + 0xF1, (r8(p + 0xE1) - r8(p + 0xF8)) & 0xFF);
    }
  } else if (d === 3) w8(p + 0xF1, 0);
  else if (d === 6) {
    w8(p + 0xF1, r8(p + 0xF8) ? 0 : 1);
    w8(p + 0xF2, 0);
  }
  emit('disease', { slot: (p - 0x8000) >> 8, disease: d });
  speedTail(p);
}

// C09A64 quirk: for diseases 1 and 4 the original branches to the stat refresh (C09A75),
// for 5 it skips it (BRA C09AC8). Implemented above.

function C09ACD(p) {                     // restore the stat a previous disease changed
  const d = r8(p + 0xF5);
  if (d < 3) return;
  if (d === 3) w8(p + 0xF1, (r8(p + 0xE1) - r8(p + 0xF8)) & 0xFF);
  else if (d === 6) { w8(p + 0xF1, r8(p + 0xE1)); w8(p + 0xF2, r8(p + 0xE2)); }
  else w8(p + 0xF0, r8(p + 0xE0));
}

// ================================================================================
// Flying items: the object code lives in movers.js (C09231 spawnFlyingItem, C0EE71
// skullFly); these wrappers supply the original's context.
// ================================================================================
function flyingItem(p) {                 // C09231 from the cure (after C09850's setup)
  movers.spawnFlyingItem?.(p, p);
}

export function spawnFlyingSkull(b) {    // C0EE71 from the explosion (C0EF86), $6A = bomb b
  movers.skullFly?.((b - 0x10000) & 0xFFFF);
  w8(0x5C00, 0x7F);                      // C02F1B saved $6C = $7F (bank of the bomb)
}

function cellCentre(idx) {               // C0EE1C
  const x = ((idx & 0x7F) * 8 - r16(0x5F01) + 8) & 0x1FF;
  const y = (((idx & 0xF80) >> 3) - r16(0x5EFB) + 7) & 0x1FF;
  w16(0x40, idx); w16(0x42, x); w16(0x44, y);
  return [x, y];
}

// ================================================================================
// Items of a dead bomber
// ================================================================================
export function deathScatter(p) {        // C097A0 (end of the death animation)
  C09712();
  if (r16(0x1E000) & 0x8000) return;
  if (r8(p + 0xF4)) w8(p + 0xE2, r8(p + 0xE4));    // C09787: full fire -> back to fire-ups
  for (let k = 0; k < SCATTER_STATS.length; k++) {
    const y = SCATTER_STATS[k];
    if (!y) continue;
    let n = r8(p + y);
    if (!n) continue;
    if (y < 0xE4) { n = (n - 1) & 0xFF; if (!n) continue; }
    let x = 0;
    while (r16(0x3B48 + x) !== 0xFFFF) x += 2;
    for (; n; n--, x += 2) w16(0x3B48 + x, k);
    w16(0x3B48 + x, 0xFFFF);
  }
}

// Scan range of C09712 (the tall layout widens it): grid indices [0x204, scanEnd)
let scanEnd = 0x800, scanMask = 0x7FF;
export function setScatterScan(end, mask) { scanEnd = end || 0x800; scanMask = mask || 0x7FF; }

function C09712() {                      // free floor cells -> $7FE000 list (128 max)
  w16(0x1E000, 0xFFFF);
  let n = 0, i = 0x0204, x = 0;
  for (;;) {
    if (i >= scanEnd) {
      if (r16(0x1E000) === 0xFFFF) return;
      i = 0x0204;
    }
    x = i & scanMask;
    const c = r16(GRID + x);
    if (c === 0 || !(c === 0x12 || c === 0x13 || c === 0x11 || c === 0x44 || c === 0x01 || (c & 0xC0))) {
      w16(0x1E000 + n, x);
      x = n;
      n += 2;
      if (n >= 0x100) return;
    }
    i += 2;
    if (i < scanEnd) continue;
    // C0977E: the original tests the word at $7FE000 + X, X = the last list offset
    // written, or the last grid index scanned if that cell was rejected (a quirk)
    if (r16(0x1E000 + x) & 0x8000) return;
  }
}

export function scatter() {              // C09615: one scattered item per tick
  if (r16(0x1A) === 4) return;
  if (r16(0x1E000) & 0x8000) return;
  for (let x = 0; ; x += 2) {
    const k = r16(0x3B48 + x);
    if (k === 0xFFFF) return;
    if (k === 0xFFFE) continue;
    C0963E(k, x);
    return;
  }
}

function C0963E(k, x) {
  w16(0x50, k);
  w16(0x3B48 + x, 0xFFFE);
  if (k === 4 && r16(0x1A) === 8) return;          // no speed-ups on stage 7
  const tile = ITEM_TILES[k];
  w16(0x52, tile);
  const g = r16(0x1E000 + (r16(0x400) & 0xFE));
  if (g >= scanEnd) return;               // tall: $F00 (setScatterScan)
  const c = r16(GRID + g);
  if (c !== 0 && (c === 0x44 || c === 0x01 || (c & 0xC0))) return;
  w16(GRID + g, 0x0044);
  w16(DANGER + g, 0);
  w16(0x5E42, g);
  const [px, py] = cellCentre(g);
  // C096B9: the puff effect object (display only)
  const ti = (((py + r16(0x5EFB)) & 0x1F0) << 2) + (((px + r16(0x5F01)) & 0x1F0) >> 3);  // C0A515
  w16(0x46, ti);
  w16(TILE + ti, tile);
  emit('itemScattered', { ...cellOf(g), tile });
}

