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
import { applySettings, roundInit, finishRound, newMatch } from './setup.js';

export function createGame(opts = {}) {
  const mem = new Uint8Array(WRAM_SIZE);
  if (opts.wram) mem.set(opts.wram);
  const game = {
    mem,
    events: [],
    opts,
    // per-slot COM level override (+D2); the original uses one level for every COM
    levels: opts.players ? opts.players.map((p) => (p && p.level ? p.level - 1 : null)) : null,
    result: null,          // { winner, wins, matchOver } of the last finished round
    // After a finished round (game.finished): scoreboard bookkeeping, then the next
    // round's init (new soft-block layout and deck from the running RNG). Returns the
    // finished round's result; when the match is over it does not start a round
    // (call newMatch() first).
    nextRound() {
      use(mem);
      this.events = [];
      resetEvents(this.events);
      if (roundFinished() || (r16(0xB9) & 0x4000)) this.result = finishRound();
      if (this.result && this.result.matchOver) return this.result;
      roundInit(this);
      return this.result;
    },
    // Start the next match on the same settings (the champion becomes the gold bomber
    // when G-BOMBER is on; bonus = roulette result 0..5).
    newMatch(o = {}) {
      use(mem);
      this.events = [];
      resetEvents(this.events);
      newMatch(o);
      this.result = null;
      roundInit(this);
    },
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
  if (!opts.wram) {
    use(mem);
    resetEvents(game.events);
    applySettings(opts);
    roundInit(game);
  }
  return game;
}
