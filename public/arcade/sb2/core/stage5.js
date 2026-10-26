// Stage 5 (garden, $1A = 6): power tiles. Handlers exported under their ROM address.
//   C03748 (per tick): on the first tick only ($5D58 b0), C03761 lists every cell whose
//     underlay is $14 into $7E2FF0 as [grid index, tile index] words, $FFFF-terminated.
//     Bomb placement (C03583 in bombs.js) gives range 9 on a listed cell.
//   C06302 (per object!) -> C11080: graphics toggle counter $5E28 counts up once per
//     object per tick; at $280 it resets and $5E2A b0 flips (the tile-animation lists at
//     $7E2BF0 are switched; display only — the list contents are not reproduced here).
import { r16, w16 } from './mem.js';
import { gridAt, lastIdx } from './move.js';
import { emit } from './events.js';

function tileIndexAt(x, y) {            // C0A515
  const ty = (r16(0x5EFB) + y) & 0x3F0, tx = (r16(0x5F01) + x) & 0x3F0;
  return (((ty & 0x1F0) << 2) + ((tx & 0x1F0) >> 3)) & 0x7FF;
}

function buildList(match, list, underlay) {   // C03778 (underlay) / C037E2 (grid)
  let n = 0;
  for (let y = 0; y < 0x200; y += 0x10) {
    for (let x = 0; x < 0x200; x += 0x10) {
      gridAt(x, y);
      const idx = lastIdx;
      w16(0x48, idx);
      if (r16((underlay ? 0x1D000 : 0x1C000) + idx) !== match) continue;
      w16(list + n, idx); n += 2;
      w16(list + n, tileIndexAt(x, y)); n += 2;
    }
  }
  w16(list + n, 0xFFFF);
}

export function C03748() {
  if (r16(0x5D58) & 1) return;
  buildList(0x14, 0x2FF0, true);        // C03761
  w16(0x5D58, r16(0x5D58) | 1);
}

export function C06302() {              // C11080
  const c = (r16(0x5E28) + 1) & 0xFFFF;
  w16(0x5E28, c);
  if (c < 0x280) return;
  w16(0x5E28, 0);
  w16(0x5E2A, r16(0x5E2A) ^ 1);
  w16(0x2C70, 0x00FF); w16(0x2C71, 0x00FF);   // (C110B6: ends the switched anim lists)
  emit('stageAnim', { stage: 5, phase: r16(0x5E2A) & 1 });
}
