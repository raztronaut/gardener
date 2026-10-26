// RNG — C00CAA / C00CDF (SPEC §16).
//   seed' = ((seed | 1) * $0383) & $FFFF          ($00D6)
//   result = (seed' * (old seed & $FF)) >> 16
// C00CAA stores the result at $0400, at $0400 + ($32 & $1E), and in the +BA word of
// bomber slot ($5C3A >> 8), then rotates $5C3A over the 4 slots.
// It is called once per tick at the end of the main loop and additionally by the deck
// shuffle (C01D2D), the soft-block removal (C0F560) and the COM random walk (C0D45C).
import { r16, w16 } from './mem.js';

export function rngNext() {           // C00CDF with X = $D6
  const old = r16(0xD6);
  const seed = (((old | 1) * 0x0383) & 0xFFFF) >>> 0;
  w16(0xD6, seed);
  w16(0x42, seed);
  const prod = seed * (old & 0xFF);
  const r = (prod >>> 16) & 0xFFFF;
  w16(0x40, r);                      // scratch left as the original leaves it
  w16(0x44, prod & 0xFFFF);
  w16(0xD8, old & 0xFF00);
  return r;
}

export function rng() {               // C00CAA
  const r = rngNext();
  w16(0x400, r);
  w16(0x400 + (r16(0x32) & 0x1E), r);
  const k = r16(0x5C3A);
  w16(0x8000 + k + 0xBA, r);
  w16(0x5C3A, (k + 0x100) & 0x300);
  return r;
}
