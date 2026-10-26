// Round flow: fade-in, clock, "Hurry!", sudden death, round end (SPEC §13,
// tools/sb2/re/notes-round.md).
import { r8, r16, w8, w16, OBJ } from './mem.js';
import { emit } from './events.js';

export function fade() {               // C00C36
  if ((r8(0x30) & 0x0F) >= 0x0F) return;
  const n = (r16(0x5E32) + 1) & 0xFFFF;
  w16(0x5E32, n);
  if (n < 3) return;
  if (r8(0x30) !== 0x0F) w8(0x30, (r8(0x30) + 1) & 0xFF);
}

export function hurry() {}             // C10C3C (TODO)
export function suddenDeath() {}       // C0D843 (TODO)
export function effects() {}           // C10CAF (TODO)

export function clock() {              // C11C1A
  if (r16(0x5E20) & 0x8000) return;    // stopped
  if (r16(0xB9) & 0x8000) { if (r16(0x5C54) === 4) return; }
  else if (r16(0x5C54) >= 0x0A) return;
  const sub = r16(0x5E14);
  if (sub !== 0x40) { w16(0x5E14, sub + 1); return; }
  w16(0x5E14, 0);
  // C11D17: one second down
  const s = r16(0x5E12) - 1;
  if (s >= 0) w16(0x5E12, s);
  else {
    const m = r16(0x5E10);
    if (m === 0) w16(0x5C56, 0);       // time up
    else { w16(0x5E10, m - 1); w16(0x5E12, 0x3B); }
  }
  // C11CA3 / C11C78: displayed digits
  const sec = r16(0x5E12);
  w16(0x5E16, 0); w16(0x5E18, 0); w16(0x5E1A, 0);
  w16(0x5E1C, Math.floor(sec / 10)); w16(0x5E1E, sec % 10);
  w16(0x5E04, r16(0x5E10)); w16(0x5E06, r16(0x5E1C)); w16(0x5E08, r16(0x5E1E));
  emit('clock', { min: r16(0x5E10), sec });
}

export function end() {                // C00A38
  let b9 = r16(0xB9);
  if (b9 & 0x4000) { w16(0xBE, (r16(0xBE) - 1) & 0xFFFF); return; }
  // (b9 & 0x1000: not battle)
  // C00A27: time-up countdown word (only counts when not 0 / $FFFF)
  const t = r16(0x5C56);
  if (t !== 0 && t !== 0xFFFF) w16(0x5C56, t - 1);
  if (b9 & 0x2000) return;             // tag match (C00AC8) — not implemented
  let n = 0;
  for (let i = 0; i < 4; i++) if (r16(OBJ + i * 0x100) & 0x0800) n++;
  w16(0x40, n);
  if (n >= 3) {
    w16(0xB9, b9 | 0x4000);
    w16(0x5E20, 0x8000);
    w16(0xBE, 0x100);
    emit('roundOver', {});
  }
}

export function winner() {             // C00B05: first slot not dying, or $FFFF = draw
  for (let i = 0; i < 4; i++) if (!(r16(OBJ + i * 0x100) & 0x0800)) return i;
  return 0xFFFF;
}
