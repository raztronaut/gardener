// Super Bomberman 2 battle core — public API.
//
//   import { createGame } from './core/index.js';
//   const game = createGame({ stage: 1, layout: 'original', players: [...], rules, seed });
//   game.tick(pads);      // exactly one original logic tick; pads = 4 libretro masks
//   game.state            // renderer view (see STATE.md), rebuilt lazily after each tick
//   game.events           // events of the last tick
//
// See public/arcade/sb2/core/STATE.md for the state and event schema.
import { WRAM_SIZE, use, r16 } from './mem.js';
import { tick as runTick, roundFinished } from './loop.js';
import { reset as resetEvents } from './events.js';

export function createGame(opts = {}) {
  const mem = new Uint8Array(WRAM_SIZE);
  if (opts.wram) mem.set(opts.wram);
  const game = {
    mem,
    events: [],
    opts,
    tick(pads) {
      use(mem);
      this.events = [];
      resetEvents(this.events);
      if (roundFinished()) return this.events;
      runTick(this, pads);
      return this.events;
    },
    get finished() { use(mem); return roundFinished(); },
  };
  return game;
}
