// Per-tick event list (game.events), for sound effects and UI. Routines call emit();
// the game resets the list at the start of every tick.
export let EV = [];
export function reset(list) { EV = list; }
export function emit(type, data) { EV.push(data ? { type, ...data } : { type }); }
