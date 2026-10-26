// Stage 8 (factory, $1A = 9): the conveyor ring and its two switches.
// Handlers are exported under their ROM addresses and routed by stage.js.
//
// Globals: $5CBE b0 = fast mode, b1 = reversed (counter-clockwise); $5CC4 / $5CC6 =
// direction / speed switch animation step ($FFFF idle; 0 = just stepped on: the next
// tick's step 0 toggles the mode bit), $5CC8 / $5CCA their 4- / 5-tick timers;
// $5CB8 / $5CBA conveyor palette-animation timer / phase (0..3, the belt "scroll" the
// renderer can use), $5CC0 / $5CC2 the second palette cycle (0..1); $5D60 = $FFFF every
// tick (a latch the movers clear, C08CC6).
// Per object: +20/+22 and +30/+32 conveyor velocity (int/frac, x and y), +28 its
// direction bits — move.js C0C34D adds them to the walking velocity; +02 b8 = "already
// toggled a switch" latch (cleared when off both switch cells), +02 b9 = a bomb carried
// by the belt (mover, movers.js).
import { r8, r16, w8, w16, OBJ_LIST, GRID } from './mem.js';
import { emit } from './events.js';
import * as move from './move.js';
import * as movers from './movers.js';
import { DIRBITS_C5FAE7, DELTA_C5E392, ANIM_C5FC29 } from './movers_tables.js';

// switch tiles (BG tile words written at (8,8) $7FA210 and (8,10) $7FA290)
const DIR_TILES_ON = [0x1C64, 0x1C66, 0x1C68, 0xFFFF];   // $C5E3EC (toggled to reversed)
const DIR_TILES_OFF = [0x1C68, 0x1C66, 0x1C64, 0xFFFF];  // $C5E3F4
const SPD_TILES_ON = [0x1C6A, 0x1C6C, 0x1C6E, 0xFFFF];   // $C5E3FC (toggled to fast)
const SPD_TILES_OFF = [0x1C6E, 0x1C6C, 0x1C6A, 0xFFFF];  // $C5E404

// Ring geometry used by the corner cells to snap carried bombs onto the turn: columns
// 4 / 12 (x $40 / $C0), rows 6 / 12 (y $50 / $B0). A tall layout stretches the ring.
let RING = { left: 0x40, right: 0xC0, top: 0x50, bottom: 0xB0 };
export function setRing(r) { RING = { ...RING, ...r }; }

// ---- per tick: C0406E ---------------------------------------------------------------
export function C0406E() {
  w16(0x5D60, 0xFFFF);
  beltPalette();                        // C041A0
  beltPalette2();                       // C04158
  dirSwitchAnim();                      // C040EF
  speedSwitchAnim();                    // C04086
}

function beltPalette() {                // C041A0: belt colour cycle (palette $7E2420+$C0)
  const t = r16(0x5CB8);
  if (t !== 0 && t - 1 !== 0) { w16(0x5CB8, t - 1); return; }
  w16(0x5CB8, (r16(0x5CBE) & 1) ? 4 : 8);
  let ph = (r16(0x5CBE) & 2) ? r16(0x5CBA) - 1 : r16(0x5CBA) + 1;
  ph &= 3;
  w16(0x5CBA, ph);
  w16(0x40, ph << 5); w16(0x42, 0xC0);  // (16 colours from $C1DBFE+ph*32: display only)
}

function beltPalette2() {               // C04158: second colour cycle ($C1DC7E)
  const t = r16(0x5CC0);
  if (t !== 0 && t - 1 !== 0) { w16(0x5CC0, t - 1); return; }
  w16(0x5CC0, 4);
  const ph = (r16(0x5CC2) + 1) & 1;
  w16(0x5CC2, ph);
  w16(0x40, ph << 5); w16(0x42, 0xE0);
}

function switchAnim(stepA, timerA, bit, reload, tileOn, tileOff, tileIdx, kind) {
  const s = r16(stepA);
  if (s & 0x8000) return;
  if (s === 0) {
    w16(0x5CBE, r16(0x5CBE) ^ bit);
    emit('conveyorSwitch', { kind, reversed: !!(r16(0x5CBE) & 2), fast: !!(r16(0x5CBE) & 1) });
  }
  const t = r16(timerA);
  if (t !== 0 && t - 1 !== 0) { w16(timerA, t - 1); return; }
  w16(timerA, reload);
  let v = tileOn[s];
  if (!(r16(0x5CBE) & bit)) v = tileOff[s];
  w16(0x40, v);
  if (v & 0x8000) { w16(stepA, 0xFFFF); w16(timerA, 0); return; }
  w16(0x1A000 + tileIdx, v);
  w16(0x1B000 + tileIdx, v);
  w16(stepA, s + 1);
}
// C040EF: direction switch (8,8); C04086: speed switch (8,10)
const dirSwitchAnim = () => switchAnim(0x5CC4, 0x5CC8, 2, 4, DIR_TILES_ON, DIR_TILES_OFF, 0x210, 'direction');
const speedSwitchAnim = () => switchAnim(0x5CC6, 0x5CCA, 1, 5, SPD_TILES_ON, SPD_TILES_OFF, 0x290, 'speed');

// ---- switch cells -------------------------------------------------------------------
function switchCell(p, stepA) {
  if (r16(p + 2) & 0x0100) return;      // latched until the object leaves the switch
  if (p >= 0x8400 && !(r16(p + 0x52) & 0x0020)) return;   // movers: only a kicked bomb
  w16(p + 2, r16(p + 2) | 0x0100);
  w16(stepA, 0);
}
export function C05288(p) { switchCell(p, 0x5CC4); }   // $12 direction switch
export function C052B6(p) { switchCell(p, 0x5CC6); }   // $13 speed switch

// ---- conveyor cells (C053E1 right, C05461 left, C054E1 up, C05561 down) -------------
// sets the belt velocity: 0.5625 px/tick ($0000.8FFF) or fast 2.3125 ($0002.4FFF)
function belt(p, axis, normalDir, revDir) {
  if (r16(p) & 0x0800) return;
  if (p >= 0x8400) {
    if (r16(p + 0x7E) !== 0x0100) return;          // only bomb movers
    if (!(r16(p + 2) & 0x0200)) return;            // carried by the belt
  }
  for (const o of [0x20, 0x22, 0x30, 0x32, 0x28]) w16(p + o, 0);
  let f = 0x8FFF, i = 0;
  if (r16(0x5CBE) & 1) { f = 0x4FFF; i = 2; }
  w16(0x40, f); w16(0x42, i);
  const o = axis === 'x' ? 0x20 : 0x30;
  w16(p + o, i);
  w16(p + o + 2, f);
  w16(p + 0x28, (r16(0x5CBE) & 2) ? revDir : normalDir);
}
export function C053E1(p) { belt(p, 'x', 0x100, 0x200); }   // $17 belt right
export function C05461(p) { belt(p, 'x', 0x200, 0x100); }   // $18 belt left
export function C054E1(p) { belt(p, 'y', 0x800, 0x400); }   // $19 belt up
export function C05561(p) { belt(p, 'y', 0x400, 0x800); }   // $1A belt down

// corner cells: a carried bomb is snapped onto the turn before the new direction applies
function corner(p, field, lessThan, limit, then) {
  if (p < 0x8400) return then(p);
  if (!(r16(p + 2) & 0x0200)) return;
  const v = r16(p + field);
  if (lessThan ? v >= limit + 1 : v < limit) return;
  w16(p + field, limit);
  then(p);
}
export function C055E1(p) {             // $1B top-right corner
  if (r16(0x5CBE) & 2) corner(p, 0x18, true, RING.top, C053E1);
  else corner(p, 0x10, false, RING.right, C05561);
}
export function C05639(p) {             // $1C bottom-right corner
  if (r16(0x5CBE) & 2) corner(p, 0x10, false, RING.right, C05561);
  else corner(p, 0x18, false, RING.bottom, C05461);
}
export function C05691(p) {             // $1D bottom-left... (pushes right / up)
  if (r16(0x5CBE) & 2) corner(p, 0x10, true, RING.left, C054E1);
  else corner(p, 0x18, true, RING.top, C053E1);
}
export function C056E9(p) {             // $1E corner (pushes up / left)
  if (r16(0x5CBE) & 2) corner(p, 0x18, false, RING.bottom, C05461);
  else corner(p, 0x10, true, RING.left, C054E1);
}

// ---- per object: C06376 -------------------------------------------------------------
export function C06376(p) {
  offBelt(p);                           // C06533
  kickCarried(p);                       // C06398
  const c = r16(p + 0xA8);
  if (c === 0x0410 || c === 0x0510) return;   // still on a switch: (8,8) / (8,10)
  w16(p + 2, r16(p + 2) & 0xFEFF);
}

function offBelt(p) {                   // C06533: not on a belt cell -> no belt velocity
  const t = r8(p + 0xB4);
  if (t >= 0x17 && t < 0x1F) return;
  for (const o of [0x20, 0x22, 0x30, 0x32, 0x28]) w16(p + o, 0);
}

// C06398: a bomber with kick walking into a belt-carried bomb kicks it
function kickCarried(p) {
  if (p >= 0x8400) return;
  if (r16(p) & 0x0800) return;
  if (!(r8(p + 0xFF) & 0x0F)) return;
  for (let x = 0; ; x += 2) {
    w16(0x22, x);
    const q = r16(OBJ_LIST + x);
    if (q === 0xFFFF) return;
    if (q < 0x8400) continue;
    if (!(r16(q + 2) & 0x0200)) continue;
    if (!kickTarget(p, q)) continue;    // C0642B
    if (!noOtherCarried()) continue;    // C063F2
    startKick(q);                       // C06482
  }
}

function kickTarget(p, q) {             // C0642B
  const d = move.motionDir(p);
  if (!d) return false;
  w16(0x54, r16(p + 0xA8));
  let a = d & 0x0300;
  if (!a) a = d & 0x0C00;
  const k = ((a << 1) >> 8) & 0xFF;     // ASL, XBA
  w16(0x58, k);
  const delta = DELTA_C5E392[k >> 1];
  w16(0x56, delta);
  w16(0x54, (delta + r16(0x54)) & 0xFFFF);
  w16(0x5A, (delta + r16(0x54)) & 0xFFFF);
  if (r16(0x54) !== r16(q + 0xA8)) return false;
  return !(r16(GRID + r16(0x5A)) & 0xC0);
}

function noOtherCarried() {             // C063F2: no carried bomb already in cell $5A
  for (let x = 0; ; x += 2) {
    w16(0x5C, x);
    const q = r16(OBJ_LIST + x);
    if (q === 0xFFFF) return true;
    if (q < 0x8400) continue;
    if (!(r16(q + 2) & 0x0200)) continue;
    if (r16(q + 0xA8) === r16(0x5A)) return false;
  }
}

function startKick(q) {                 // C06482: the carried bomb becomes a kicked bomb
  w16(q + 2, 0);
  w16(q + 0x46, r16(0x56));
  w16(q + 0x52, 0x0020);
  const [x, y] = move.cellCentre(r16(0x54));
  w16(q + 0x10, x);
  w16(q + 0x18, y & r16(0x5D3C));
  for (const o of [0x12, 0x14, 0x16, 0x24, 0x26, 0x20, 0x22, 0x28, 0x1A, 0x1C, 0x1E, 0x2C, 0x2E, 0x30, 0x32]) w16(q + o, 0);
  const k = r16(0x58);
  w16(0x40, r16(q) & 0xFF00);
  w16(q + 0x5E, k);
  w16(q, DIRBITS_C5FAE7[k >> 1] | r16(0x40) | 0x0400);
  if (k >= 6) w16(q + 0x1C, 2); else w16(q + 0x14, 2);
  emit('kick', { cell: r16(0x54), carried: true });
}

// ---- C0DF87: a bomb resting on a belt cell becomes a belt-carried mover ---------------
// (called by the bomb list pass C0DF30 in bombs.js; b = bomb slot, WRAM offset)
export function C0DF87(b) {
  w16(b, r16(b) | 0x1000);
  w16(0x5C0E, r16(b + 0x0A));
  const cur = b & 0xFFFF;
  const o = allocMover(cur, 0x7F);      // C02F1B (template $C20151: bomb mover)
  if (o === null) return;
  movers.initObject(o, 'bomb');         // C02196
  w16(0x6A, r16(0x5BFE)); w8(0x6C, r8(0x5C00));   // C02F0A
  w16(o + 0x46, r16(0x52));             // (whatever $52 holds: the original reads scratch)
  w16(o + 0xA8, r16(b + 0x0A));
  const [x, y] = move.cellCentre(r16(0x5C0E));
  w16(o + 0x10, x);
  w16(o + 0x18, y & r16(0x5D3C));
  w16(o + 0x40, cur);
  const own = r8(b + 6) & 0x0F;
  w16(o + 6, own);
  w8(o + 8, own); w8(o + 0xE0, own);
  w16(o + 2, 0x0200);
  w16(o, 0x9400);
  for (const k of [0x14, 0x16, 0x24, 0x26, 0x1C, 0x1E, 0x2C, 0x2E]) w16(o + k, 0);
  const t = r16(b) & 0x1F;
  w8(o + 0x42, t);
  w16(o + 0x6A, ANIM_C5FC29[t]);
  w16(o + 8, 0);
  // C0DDF7: the bomb's cell reverts to its underlay
  const g = r16(b + 0x0A), ti = r16(b + 2);
  w16(0x42, g); w16(0x44, ti);
  w16(GRID + g, r16(0x1D000 + g));
  w16(0x18000 + g, 0);
  w16(0x1A000 + ti, r16(0x1B000 + ti));
}

// C02F1B: first free mover slot ($7E8400.., 28); remembers the current object pointer
function allocMover(cur, bank) {
  w16(0x5BFE, cur & 0xFFFF); w8(0x5C00, bank);
  for (let k = 0, o = 0x8400; k < 0x1C; k++, o += 0x100) {
    if (!(r16(o) & 0x8000)) { w8(o + 0xA8, 0); w8(o + 0xAA, 0); return o; }
  }
  return null;
}
export { allocMover as allocMoverS8 };
