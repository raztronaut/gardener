// Per-tick event list (game.events), for sound effects and UI. Routines call emit();
// the game resets the list at the start of every tick. Every event has `type` and
// `tick` ($32 of the tick that produced it); a numeric `cell` (grid index
// cy*0x80 + cx*2) is also given as cx / cy. Schema: STATE.md.
import { r16 } from './mem.js';
export let EV = [];
export function reset(list) { EV = list; }
export function emit(type, data) {
  const e = data ? { type, ...data } : { type };
  e.tick = r16(0x32);
  if (typeof e.cell === 'number' && e.cx === undefined) { e.cx = (e.cell & 0x7F) >> 1; e.cy = e.cell >> 7; }
  EV.push(e);
}
