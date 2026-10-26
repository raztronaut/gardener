// Arena geometry of the active layout. The original battle field is 13x11 (rows 3..15
// incl. the border ring); the TALL layout (SPEC §17) is 13x25 (rows 3..29). A few
// routines carry 13x11 constants (off-screen thresholds, parking position of dead
// bombers, hop-out limits, scan ranges); they read them from here.
//
// The layout is stored IN the WRAM image (a byte the original never uses), so the
// geometry always follows the game whose memory is active (several games can run
// side by side) and survives save()/load().
import { r8, w8 } from './mem.js';

export const TALL_FLAG = 0x7000;        // $7E7000 (unused by the original): b0 = tall layout,
                                        // b1 = tall sudden death at the original pace
export const isTall = () => (r8(TALL_FLAG) & 1) === 1;
export function setTall(on, fastSuddenDeath = false) { w8(TALL_FLAG, on ? (fastSuddenDeath ? 3 : 1) : 0); }

// Sudden death on the tall field (136 blocks instead of 80). Default: it starts at 0:47
// (instead of 0:33) at the original 15 ticks per block, so it ends at the same clock
// time (~0:16); "Hurry!" moves to 0:52 (5 s before, like 0:38 / 0:33). Option
// rules.tallSuddenDeath = 'pace': start at 0:33 with 9 ticks per block (3 steps).
const sdFast = () => (r8(TALL_FLAG) & 3) === 3;
export const sdDigits = () => (isTall() && !sdFast() ? [0, 4, 7] : [0, 3, 3]);
export const hurryDigits = () => (isTall() && !sdFast() ? [0, 5, 2] : [0, 3, 8]);
export const sdBlockSteps = () => (isTall() && sdFast() ? 3 : 5);

export const TALL_ROWS = 25;            // playfield rows (cy 4..28), border rows 3 and 29
export const EXTRA_Y = (TALL_ROWS - 11) * 16;   // 224 px more than the original

// y of the bottom edge rows / parking spot of removed bombers (C0A7FA, C0A6FD, C01B9B):
// the original parks them at y = $F0 (row 16, off-screen because the field ends at 15).
export const parkY = () => (isTall() ? 0x1F0 : 0xF0);
// position mask for y (C0A146 / $5D3C)
export const yMask = () => (isTall() ? 0x1FF : 0xFF);
// C0A146: an object is off-screen when y >= offY && y < $1F8 (or y >= $200)
export const offY = () => (isTall() ? 0x1E0 : 0xF0);
// C0843E: hop-out edge limits (bottom)
export const hopBottom = () => (isTall() ? 0xD7 + EXTRA_Y : 0xD7);
