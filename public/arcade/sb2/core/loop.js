// One ORIGINAL logic tick: the main loop C0FB11 (C0FB39..C0FB9A) plus the NMI's tick
// counter increment (00FD84: INC $32 once the tick has completed).
import { r8, r16, w8, w16, OBJ, padToSnes, COST } from './mem.js';
import { rng } from './rng.js';
import * as bombers from './bombers.js';
import * as bombs from './bombs.js';
import * as burn from './burn.js';
import * as round from './round.js';
import * as stage from './stage.js';
import * as items from './items.js';
import * as disease from './disease.js';

// pads: 4 per-player masks in libretro bit order (harness order). A player whose pad
// is `undefined`/`null` is treated as "no controller" (the original then never writes
// that human's +6E).
export function latchPads(pads) {          // C01797: auto-joypad read -> $C3/$C5/$C7/$C9
  const addr = [0xC3, 0xC5, 0xC7, 0xC9];
  const sig = [0xCD, 0xCE, 0xCF, 0xD0];
  for (let i = 0; i < 4; i++) {
    const p = pads ? pads[i] : null;
    const s = p == null ? 0 : padToSnes(p);
    w16(addr[i], s);
    // signature: (low nibble of the pad word) << 1 | connected bit
    w8(sig[i], ((s & 0x0F) << 1) | (p == null ? 0 : 1));
  }
}

export function tick(G, pads) {
  COST.n.fill(0); COST.t = 0;      // work meter (mem.js), group = call order below
  // NMI (00FD84): the previous tick is counted before this one starts, so $32 during
  // the tick (and in the vectors' truth.tick) is the index of the running tick.
  // Only a tick that completed ($16 != 0) is counted: the first tick after a round init
  // (which clears $16) runs with $32 = 0.
  if (r16(0x16)) w16(0x32, (r16(0x32) + 1) & 0xFFFF);
  w16(0x16, 0);            // C0FB27 STZ $16
  latchPads(pads);
  COST.t = 1; round.fade();            // C00C36  screen fade-in (brightness $30)
  COST.t = 2; bombers.input();         // C01602  pads -> human bombers' +6E
  COST.t = 3; stage.regrow();          // C0D8E8  stage 10 soft-block regrowth
  COST.t = 4; round.hurry();           // C10C3C  "Hurry!" at 0:38
  COST.t = 5; round.suddenDeath();     // C0D843  falling blocks
  COST.t = 6; stage.perTick();         // C036E6  stage gimmick, once per tick
  COST.t = 7; bombers.objects(G);      // C01E1D  every object: bombers, kicked/thrown bombs, ...
  COST.t = 8; round.effects();         // C10CAF  effect objects at $7EF000 (hurry banner ...)
  COST.t = 9; burn.update();           // C0DCB4  burning soft blocks / items (odd ticks)
  COST.t = 10; bombs.update();          // C0E0AA  bombs and explosions (even ticks)
  COST.t = 11; bombs.dangerDecay();     // C0E076  AI danger map decay when no bomb is out
  COST.t = 12; burn.list();             // C0DA42  rebuild the burn list
  COST.t = 13; disease.visuals();       // C00617  HUD sick faces (odd ticks)
  COST.t = 14; disease.contagion();     // C005EA  disease swap between touching bombers
  COST.t = 15; stage.anim();            // C1334B  animated tile lists
  COST.t = 16; items.scatter();         // C09615  items of dead bombers re-appear
  COST.t = 17; round.clock();           // C11C1A  round clock
  // C10971: pause handling (not part of the battle logic)
  COST.t = 18; rng();                   // C00CAA  once per tick
  COST.t = 19; round.end();             // C00A38  round-over detection / 256-tick countdown
  COST.t = 0;
  w16(0x16, (r16(0x16) + 1) & 0xFFFF);   // C0FB8D INC $16: tick complete
  COST.last.set(COST.n); COST.t = 31;
}

// After the tick: is the battle loop finished (round over and the 256 ticks elapsed)?
export function roundFinished() {
  return (r16(0xB9) & 0x4000) !== 0 && r16(0xBE) === 0;
}
