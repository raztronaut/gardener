// Stage 7 (race track, $1A = 8): speed pads. Handlers exported under their ROM address.
//   C04C66 (cell type $0F): on entering a pad (latch +0E b2), a free bomber gets the
//     speed level of the pad's tile ($C5E859: tile -> level) as +F0 and +E0; the stop
//     tile ($1C4A, level 8) instead freezes it: +0E b3, +CE = +0C = $80. A kicked bomb
//     (+7E hi, +52 b5) only latches. Then a non-stop pad re-rolls its tile from
//     $C5E871[$0400 & $E] (current and underlay tile).
//   C06321 (per object): off a pad the latches (+0E b2/b3) clear; on the stop pad the
//     bomber is busy (+52 b0) until +CE counts down to 0.
// The permanent soft block at (8,8) is layout (underlay $C2, see layout.js).
import { r16, w16, w8 } from './mem.js';
import { inputVelocity } from './move.js';
import { emit } from './events.js';

const PAD_LEVEL = { 0x1C28: 9, 0x1C2A: 7, 0x1C2C: 1, 0x1C2E: 6, 0x1C48: 10, 0x1C4A: 8 };   // $C5E859
const REROLL = [0x1C28, 0x1C2A, 0x1C2C, 0x1C2E, 0x1C48, 0x1C48, 0x1C2E, 0x1C2C];       // $C5E871
const STOP = 0x1C4A;

export function C04C66(p) {
  if (r16(p + 0x0E) & 0x0004) return;
  const mover = (r16(p + 0x7E) & 0x0F00) !== 0;
  if (mover) { if (!(r16(p + 0x52) & 0x0020)) return; }
  else {
    if (r16(p + 0x52) & 0x0081) return;
    if (r16(p) & 0x0800) return;
  }
  w16(p + 0x0E, r16(p + 0x0E) | 0x0004);
  const ti = r16(p + 0xAA);
  if (!mover) {
    const tile = r16(0x1A000 + ti);
    w16(0x40, tile);
    const lvl = PAD_LEVEL[tile];
    if (lvl === undefined) throw new Error('stage 7: unknown pad tile $' + tile.toString(16));
    w16(0x40, lvl);
    if (lvl === 8) {
      w16(p + 0x0E, r16(p + 0x0E) | 0x0008);
      w16(p + 0xCE, 0x80);
      w16(p + 0x0C, 0x80);
      if (p < 0x8400) emit('stopPad', { player: (p - 0x8000) >> 8, ticks: 0x80 });
    } else {
      w8(p + 0xF0, lvl);                                // speed level and its base
      w8(p + 0xE0, lvl);
      inputVelocity(p);                                 // C0C2CE
      if (p < 0x8400) emit('speedPad', { player: (p - 0x8000) >> 8, level: lvl });
    }
  }
  // C04D05: re-roll a used normal pad
  if (r16(0x1A000 + ti) === STOP) return;
  const t = REROLL[(r16(0x400) & 0x0E) >> 1];
  w16(0x40, t);
  w16(0x1A000 + ti, t);
  w16(0x1B000 + ti, t);
}

export function C06321(p) {
  if (r16(0x1C000 + r16(p + 0xA8)) !== 0x0F) {
    w16(p + 0x0E, r16(p + 0x0E) & 0xFFF3);
    return;
  }
  if (!(r16(p + 0x0E) & 0x0008)) return;
  w16(p + 0x52, r16(p + 0x52) | 0x0001);
  const c = r16(p + 0xCE);
  if (c !== 0 && c - 1 !== 0) { w16(p + 0xCE, c - 1); return; }
  w16(p + 0x0E, r16(p + 0x0E) & 0xFFF7);
  const s = r16(p + 0x52);
  if (!(s & 0x0080)) w16(p + 0x52, s & 0xFFFE);
}
