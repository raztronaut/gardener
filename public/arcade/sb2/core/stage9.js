// Stage 9 (tech, $1A = $A): arrow cells and the panel colour cycle. The arrows only
// redirect kicked bombs (movers.js C10F81). Cells $55 / $56 (a random-teleport pit and a
// stun cell) have handlers but never appear in the battle maps; they are implemented
// for completeness. Handlers are exported under their ROM addresses (see stage.js).
import { r8, r16, w8, w16 } from './mem.js';
import { emit } from './events.js';
import * as movers from './movers.js';

// $C5E6C6: teleport destinations (grid indices) for the $55 pit
const PIT_DEST = [0x020E, 0x041C, 0x0504, 0x0712, 0x041C];

// ---- per tick: C03EB6 -> C03EBB, panel colour cycle (palette $7E2420+$C0, display) ---
export function C03EB6() {
  const t = r16(0x5CC0);
  if (t !== 0 && t - 1 !== 0) { w16(0x5CC0, t - 1); return; }
  w16(0x5CC0, 6);
  w16(0x5CC2, (r16(0x5CC2) + 1) & 3);   // phase 0..3 (16 colours from $C1DB7E + ph*32)
}

// ---- per object: C06567 -------------------------------------------------------------
export function C06567(p) {
  if (p >= 0x8400) return;
  if (r16(p) & 0x0800) return;
  const c = r16(0x1C000 + r16(p + 0xA8));
  if (c !== 0x55) w16(p + 2, r16(p + 2) & 0xFFCF);
  if (c === 0) w16(p + 2, r16(p + 2) & 0xFFF7);
  pitTeleport(p);                       // C065A4
}

function pitTeleport(p) {               // C065A4: at the end of the fall anim, warp
  const f = r16(p + 2);
  if (!(f & 0x0020) || (f & 0x0010)) return;
  if (r16(p + 0x0C) !== 0x00FF) return;
  w16(p + 0x0C, 1);
  let k = (r16(0x400) & 6) >> 1;
  let d = PIT_DEST[k];
  if (d === r16(p + 0xA8)) d = PIT_DEST[k + 1];
  w16(p + 0xA8, d);
  movers.snapCentre(p);                 // C0456D
  w16(p + 2, r16(p + 2) | 0x0010);
  emit('teleport', { player: (p - 0x8000) >> 8, to: d });
}

// ---- cell $55: fall into the pit (C052E5) -------------------------------------------
export function C052E5(p) {
  if (p >= 0x8400) return;
  if (r16(p) & 0x0800) return;
  if (r16(p + 2) & 0x0029) return;
  w16(p + 2, r16(p + 2) | 0x0020);
  movers.snapCentre(p);                 // C0456D
  if (r16(p + 0x52) & 0x0002) movers.dropCarried(p);   // C0A743
  w16(p + 0x52, 1);
  w16(p + 0x50, 7);
  w16(p + 0x56, (r16(p + 4) & 0x0100) ? 2 : 0);
  w16(p + 0x6A, 0x18);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  w16(p + 0x0C, 0);
  w16(p + 0x6E, 0);
  emit('sfx', { id: 0x56 });
}

// ---- cell $56: stun (C0538B -> C084BB) ----------------------------------------------
export function C0538B(p) {
  if (p >= 0x8400) return;
  if (r16(p) & 0x0800) return;
  const f = r16(p + 2);
  if (f & 0x0009) return;
  w16(p + 2, f | 0x0008);
  if (r16(p + 0x52) & 0x0002) movers.dropCarried(p);   // C0A743
  // C084BB (stun the bomber)
  if (r16(p + 0x52) & 0x0080) return;
  w16(p + 0x52, 1);
  w16(p + 0x6A, 0x10);
  w16(p + 0x50, 4);
  w16(p + 0x56, (r16(p + 4) & 0x0100) ? 2 : 0);
  w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);
  w16(p + 0x0C, 0);
  w16(p + 0x6E, 0);
  w16(0x5C04, 0xFFFF);
  if (movers.dropItems) movers.dropItems(p);           // C0914A (battle)
  emit('sfx', { id: 0x47 });
}
