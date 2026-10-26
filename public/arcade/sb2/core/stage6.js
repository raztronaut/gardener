// Stage 6 (pink, $1A = 7): teleporters. Handlers exported under their ROM address.
//   C04D33 (cell type $50): an object whose centre is on a pad, not latched (+04 b4),
//     is moved to the centre of the other pad of the same colour (BG tile word, found
//     in the underlay tiles of the 4 pads $C5E881), unless that cell holds a bomb ($43)
//     or a bomb mover (C10456). Bombers must be free (+52 & $81 = 0, not dying);
//     movers (+7E hi != 0) only when kicked (+52 b5). Then +04 b4 latches.
//   C06307 (per object): the latch is cleared once the object's cell is not a pad.
import { r8, r16, w8, w16, OBJ_LIST } from './mem.js';
import { gridAt, lastIdx, cellCentre } from './move.js';
import { emit } from './events.js';
import { isTall } from './geom.js';

const PAD_TILES = [0x0188, 0x0198, 0x0318, 0x0308];   // $C5E881: tile index of each pad
const PAD_DEST = [0x0308, 0x0318, 0x0618, 0x0608];    // $C5E8B1: grid index of each pad
// tall: the lower pads are at (12,26) / (4,26)
const TALL_PAD_TILES = [0x0188, 0x0198, 0x0698, 0x0688];
const TALL_PAD_DEST = [0x0308, 0x0318, 0x0D18, 0x0D08];

function centreCell(p) {                // C0BEA6
  let v = gridAt(r16(p + 0x10), r16(p + 0x18));
  const idx = lastIdx;
  if (v === 0xC2 && r8(p + 0xFB)) v = 0x40;
  w8(p + 0xB4, v & 0xFF);
  if (r16(0x1C78)) w8(p + 0xB4, 0x41);
  if (idx !== r16(p + 0xA8)) w16(p + 0x3A, r16(p + 0xA8));
  w16(p + 0xA8, idx);
}

function moverAt(p, dest) {             // C10456: a bomb mover on the destination
  for (let x = 8; ; x += 2) {
    const q = r16(OBJ_LIST + x);
    if (q === 0xFFFF) return false;
    if (q === p) continue;
    if (!(r16(q) & 0x8000)) continue;
    if (!(r16(q + 0x7E) & 0x0100)) continue;
    if (r8(q + 0x42) !== 8) continue;
    if (r16(q + 0xA8) === dest) return true;
  }
}

export function C04D33(p) {
  if (r16(p + 4) & 0x0010) return;
  if (r16(p + 0x7E) & 0x0F00) { if (!(r16(p + 0x52) & 0x0020)) return; }
  else {
    if (r16(p + 0x52) & 0x0081) return;
    if (r16(p) & 0x0800) return;
  }
  const here = r16(p + 0xAA);
  w16(0x40, here);
  const colour = r16(0x1A000 + here);
  w16(0x42, colour);
  w16(0x4E, 4);
  for (let y = 0; y < 4; y++) {
    const t = (isTall() ? TALL_PAD_TILES : PAD_TILES)[y];   // tall
    if (r16(0x1B000 + t) !== colour || t === here) continue;
    // C04D98
    const dest = (isTall() ? TALL_PAD_DEST : PAD_DEST)[y];  // tall
    w16(0x50, y * 2); w16(0x52, dest);
    if (r16(0x1C000 + dest) === 0x43) return;
    if (moverAt(p, dest)) return;
    w16(0x5C0E, dest);
    const [x, yy] = cellCentre(dest);
    w16(p + 0x10, x);
    w16(p + 0x18, yy & r16(0x5D3C));
    centreCell(p);
    w16(p + 4, r16(p + 4) | 0x0010);
    if (p < 0x8400) emit('teleport', { player: (p - 0x8000) >> 8, fromTile: here, to: dest });
    else emit('teleport', { object: p, fromTile: here, to: dest });
    return;
  }
}

export function C06307(p) {
  if (r16(0x1C000 + r16(p + 0xA8)) === 0x50) return;
  w16(p + 4, r16(p + 4) & 0xFFEF);
}
