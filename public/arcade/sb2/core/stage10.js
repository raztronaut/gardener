// Stage 10 (forest, $1A = $B): the Y-button jump and the soft-block regrowth; plus the
// generic animated-tile list C1334B (all stages). Handlers are exported under their ROM
// addresses (see stage.js).
//
// Jump fields: +02 b0 jumping, b1 apex passed, b2 direction chosen; +C0 landing y (low
// byte — the whole y on the tall field; moves with the shadow on vertical jumps), +C2 jump direction (2 R, 4 L, 8 D,
// $10 U), +C8 the shadow object (a mover slot), +9A the input at take-off.
// Regrowth: $5D0A delay, $5D0C index into the regrow list $7F0300 (grid idx) /
// $7F0700 (tile idx); the growing block: $7F0B00 tile idx (0 = none), $7F0B02 grid idx,
// $7F0B04 animation step, $7F0B06 frame length (4) / $7F0B07 its countdown.
import { r8, r16, w8, w16, OBJ_LIST, GRID } from './mem.js';
import { emit } from './events.js';
import * as move from './move.js';
import * as movers from './movers.js';
import { isTall } from './geom.js';

const JUMP_ANIM = { 2: 0x0002, 4: 0x0006, 8: 0x0004, 0x10: 0x0000 };   // $C5E817[+5E]
const REGROW_TILES = [0x1CC0, 0x1CC2, 0x1CC4, 0x1CC6, 0x1C02, 0xFFFF];   // $C5E386
const REGROW_DELAY = [0x0100, 0x0140, 0x01C0, 0x0280, 0x0100, 0x0180, 0x0040, 0x0340,
  0x0100, 0x0180, 0x0080, 0x0400, 0x0140, 0x01C0, 0x00C0, 0x0500];         // $C5E366
const RESUME_DIRS = [0x100, 0x200, 0x400, 0x800];                          // $C5D848

const restart = (p) => w16(p + 0x0E, (r16(p + 0x0E) | 0x3000) & 0x3FFF);

// ---- Y button: C06616 (take-off) ----------------------------------------------------
export function C06616(p) {
  if (r16(p + 0x52) & 0x0001) return;
  if (!(r16(p + 0x6E) & 0x4000)) { w16(p + 0x0E, r16(p + 0x0E) & 0xFEFF); return; }
  if (r16(p + 0x0E) & 0x0100) return;   // Y edge latch
  w16(p + 0x0E, r16(p + 0x0E) | 0x0100);
  w16(p + 0x9A, r16(p + 0x6E));
  jumpState(p);                         // C068B6
  jumpLaunch(p);                        // C06852
  emit('jump', { player: (p - 0x8000) >> 8, from: r16(p + 0xA8) });
}

function jumpState(p) {                 // C068B6
  if (r16(p + 0x52) & 0x0002) movers.dropCarried(p);   // C0A743
  w16(p + 0x52, 0x0801);
  w16(p + 2, r16(p + 2) | 1);
  w16(p + 0x50, 7);
  w16(p + 0x56, (r16(p + 4) & 0x0100) ? 2 : 0);
  w16(p + 0x6A, JUMP_ANIM[r16(p + 0x5E)] ?? 0);
  restart(p);
  w16(p + 0x0C, 0);
  w16(p + 0x6E, 0);
}

function jumpLaunch(p) {                // C06852: vy 4 up, decelerating 0.25/tick
  w16(p + 0x1C, 4);
  w16(p + 0x2E, 0x4000);
  w16(p, r16(p) | 0x000A);
  w16(p + 0x14, 0);
  w16(p + 0x16, 0);
  // tall: the original keeps only the low byte of the landing y (y < 256 on 13x11); on
  // the 13x25 field y reaches 448, so +C0 holds the whole y (else a jump below row 16
  // lands 256 px = 16 rows higher)
  w16(p + 0xC0, isTall() ? r16(p + 0x18) : r16(p + 0x18) & 0xFF);
  shadow(p);                            // C04C0C
  const s = r16(0x73);                  // (the original zeroes [$73] even if no slot)
  for (const o of [0x14, 0x16, 0x24, 0x26, 0x1C, 0x1E, 0x2C, 0x2E]) w16(s + o, 0);
}

function shadow(p) {                    // C04C0C: the jump shadow (mover, template $C2017B)
  w16(0x5BFE, p); w8(0x5C00, 0x7E);     // C02F1B
  let o = null;
  for (let k = 0, q = 0x8400; k < 0x1C; k++, q += 0x100) {
    if (!(r16(q) & 0x8000)) { w8(q + 0xA8, 0); w8(q + 0xAA, 0); o = q; break; }
  }
  if (o === null) return;
  w16(0x73, o); w8(0x75, 0x7E);
  movers.initObject(o, 'still');        // C02196
  w16(0x6A, r16(0x5BFE)); w8(0x6C, r8(0x5C00));   // C02F0A
  w16(p + 0xC8, o);
  w16(o + 6, r16(p + 0x2A));
  w16(o + 0x10, r16(p + 0x10));
  w16(o + 0x18, r16(p + 0x18));
  w16(o, r16(o) | (r16(p) & 0x0F));
  w16(o + 0x6A, 0x14);
  w16(o + 8, 0);
}

// ---- per tick while jumping: C06658 -------------------------------------------------
export function C06658(p) {
  if (r16(p) & 0x0800) return;
  if (!(r16(p + 2) & 1)) return;
  jumpMove(p);                          // C066F5
  if (!(r16(p + 2) & 2)) {
    if (r16(p + 0x1C)) return;
    w16(p + 2, r16(p + 2) | 2);         // apex
  }
  if (!landed(p)) return;               // C06819
  // landing
  const s = r16(p + 0xC8);              // C05B89: free the shadow
  w16(s, 0); w16(s + 0x10, 0x1FF); w16(s + 0x18, 0xF0);
  w16(p + 2, r16(p + 2) & 0xFFF8);
  w16(p + 0x18, r16(p + 0xC0));
  w16(p + 0x6A, r16(p + 0x5E));
  w16(p + 0x50, r16(p + 0x56));
  w16(p + 0x52, r16(p + 0x52) & 0xC000);
  restart(p);
  move.zeroX(p);                        // C08D3A
  move.zeroY(p);                        // C08D52
  centreCell(p);                        // C0BEA6
  w16(p + 0xBE, r16(p + 0xBE) & 0x3FFF);
  emit('land', { player: (p - 0x8000) >> 8, cell: r16(p + 0xA8), onBomb: !!r16(0x5D02) });
  if (r16(0x5D02)) movers.hopOut?.(p); // C0838C: landed on a bomb -> hop one more cell
}

function jumpMove(p) {                  // C066F5
  if (!(r16(p + 2) & 4)) {
    const d = jumpDir(p);               // C05F45
    w16(0x40, d);
    if (!d) return;
    // C067C3
    w16(p + 2, r16(p + 2) | 4);
    const c = (d & 0x100) ? 2 : (d & 0x200) ? 4 : (d & 0x400) ? 8 : 0x10;
    w16(p + 0xC2, c);
    w16(p + 0x5E, c);
    w16(p + 0x6A, JUMP_ANIM[c]);
    restart(p);
    w16(p + 0x0C, 0);
    w16(p + 0x6E, 0);
  }
  const s = r16(p + 0xC8);
  w16(0x73, s); w8(0x75, 0x7E);
  const c = r16(p + 0xC2);
  if (c & 2 || c & 4) {                 // C06743 right / C06766 left: 0.5 px/tick
    for (const o of [p, s]) {
      w16(o, (c & 2) ? (r16(o) & 0xFFFE) : (r16(o) | 1));
      w16(o + 0x14, 0);
      w16(o + 0x16, 0x8000);
    }
  } else if (!(r16(0x32) & 1)) {        // C06789 down / C067A6 up: 1 px every 2 ticks
    const dv = (c & 8) ? 1 : -1;
    if (isTall()) w16(p + 0xC0, (r16(p + 0xC0) + dv) & 0xFFFF);
    else w8(p + 0xC0, (r8(p + 0xC0) + dv) & 0xFF);
    w16(s + 0x18, (r16(s + 0x18) + dv) & 0xFFFF);
  }
}

function jumpDir(p) {                   // C05F45: COM -> C05F25, human -> its pad
  if (r16(p + 4) & 1) {
    if (r16(0x1A) !== 3) { const d = r16(p + 0x9A) & 0x0F00; if (d) return d; }
    return RESUME_DIRS[r16(0x400) & 3];
  }
  let v = r16(0xC3 + (((p >> 8) & 0x0F) << 1));
  if ((v & 0x0300) === 0x0300) v &= 0xFCFF;
  if ((v & 0x0C00) === 0x0C00) v &= 0xF3FF;
  return (v & 0x0300) ? (v & 0x0300) : (v & 0x0C00);
}

function landed(p) {                    // C06819
  w16(0x5D02, 0);
  const m = isTall() ? 0xFFFF : 0xFF;   // tall: whole y (see C06852)
  if ((r16(p + 0x18) & m) < (r16(p + 0xC0) & m)) return false;
  if (r8(p + 0xB4) === 0x43) w16(0x5D02, 1);
  return true;
}

function centreCell(p) {                // C0BEA6
  let v = move.gridAt(r16(p + 0x10), r16(p + 0x18));
  const idx = move.lastIdx;
  if (v === 0xC2 && r8(p + 0xFB)) v = 0x40;
  w8(p + 0xB4, v & 0xFF);
  if (r16(0x1C78)) w8(p + 0xB4, 0x41);
  if (idx !== r16(p + 0xA8)) w16(p + 0x3A, r16(p + 0xA8));
  w16(p + 0xA8, idx);
}

// ---- soft-block regrowth: C0D8E8 (every tick, before the objects) --------------------
export function C0D8E8() {
  if (r16(0x1A) !== 0x0B) return;       // $C5E2A6[$1A]: only stage 10
  if (r16(0x10B00)) { growStep(); return; }   // C0D88F
  if (!(r16(0x5D7E) & 0x8000)) {
    const t = r16(0x5D0A);
    if (t !== 0 && t - 1 !== 0) { w16(0x5D0A, t - 1); return; }
  }
  // ($1A & $F0) == $20 -> C0D98D: no battle stage
  const k = ((r16(0x402) & 0x1E) + r16(0x5D0C)) & 0xFFFF;
  w16(0x5D0C, k);
  const gi = r16(0x10300 + k);
  if (!gi) { w16(0x5D0A, 0); w16(0x5D0C, 0); return; }
  w16(0x52, gi);
  if (r16(GRID + gi)) return;           // cell not empty
  if (objectNear(gi)) return;           // C0D9F0
  w16(0x5D0A, REGROW_DELAY[(r16(0x400) & 0x1E) >> 1]);
  w16(0x10B00, r16(0x10700 + k));
  w16(0x10B02, r16(0x10300 + k));
  w16(0x10B04, 0);
  w16(0x10B06, 4);
}

function objectNear(gi) {               // C0D9F0: an object on or next to the cell
  for (let x = 0; ; x += 2) {
    w16(0x40, x);
    const q = r16(OBJ_LIST + x);
    if (q === 0xFFFF) return false;
    const c = r16(q + 0xA8);
    w16(0x54, c);
    if (c === gi || ((c + 2) & 0xFFFF) === gi || ((c - 2) & 0xFFFF) === gi ||
      ((c + 0x80) & 0xFFFF) === gi || ((c - 0x80) & 0xFFFF) === gi) return true;
  }
}

function growStep() {                   // C0D88F: 4 ticks per frame; solid from frame 1
  const b = r8(0x10B07);
  if (b !== 0 && b - 1 !== 0) { w8(0x10B07, b - 1); return; }
  w8(0x10B07, r8(0x10B06));
  const s = r16(0x10B04);
  const v = REGROW_TILES[s >> 1];
  w16(0x40, v);
  w16(0x10B04, s + 2);
  if (v & 0x8000) { w16(0x10B00, 0); return; }
  w16(0x1A000 + r16(0x10B00), v);
  const gi = r16(0x10B02);
  w16(GRID + gi, 0xC2);
  w16(0x18000 + gi, 0);
  if (s === 0) emit('blockRegrow', { cell: gi });
}

// C0DA60: per-entry routine of the $7E3D88 animation list (C0DA42). The list is only
// cleared at round init (C01D70) and never filled in battle, so this never runs.
export function C0DA60() {}

// ---- C1334B: animated character lists at $7E2BF0 (all stages) ------------------------
// 32-byte entries, byte 0 $FF = end: b0 flags (b7 upload pending, b1 stopped, b0 one-
// shot), b1 character number, b2 frame length, b3 countdown, b4 sequence index (into
// the entry; frames >= $F0 end the sequence, restart at $10). A pending upload is
// queued ($5EEE..$5EF8, done by the NMI which clears $5EEE) instead of advancing.
export function C1334B() {
  w8(0x5EEE, 0);                        // (the previous NMI performed the upload)
  if (queueUpload()) return;            // C1340A
  for (let e = 0x2BF0; ; e += 0x20) {   // C13367
    const f = r8(e);
    if (f === 0xFF) return;
    if (f & 2) continue;
    const c = r8(e + 3);
    if (c !== 0 && c - 1 !== 0) { w8(e + 3, c - 1); continue; }
    w8(e + 3, r8(e + 2));
    w8(e, r8(e) | 0x80);
    const i = (r8(e + 4) + 1) & 0xFF;
    w8(e + 4, i);
    if (r8(e + i) < 0xF0) continue;
    if (r8(e) & 1) {                    // C133CD (battle): stop after one pass
      if (r16(0xB9) & 0x8000) w8(e, (r8(e) | 2) & 0x7F);
    }
    w8(e + 4, 0x10);
  }
}

function queueUpload() {                // C1340A
  for (let e = 0x2BF0; ; e += 0x20) {
    const f = r8(e);
    if (f === 0xFF) return false;
    if (!(f & 0x80)) continue;
    const vram = (r8(e + 1) << 4) & 0xFFFF;
    w16(0x5EEF, vram);
    w16(0x5EF4, (vram + 0x100) & 0xFFFF);
    const fr = r8(e + r8(e + 4)) & 0x7F;
    const src = ((fr << 5) + 0x4828) & 0xFFFF;
    w16(0x5EF1, src);
    w16(0x5EF6, (src + 0x200) & 0xFFFF);
    w8(0x5EF3, 0x7E); w8(0x5EF8, 0x7E);
    w8(0x5EEE, 1);
    w8(e, f & 0x7F);
    return true;
  }
}
