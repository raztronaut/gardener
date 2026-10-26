// One ORIGINAL logic tick: the main loop C0FB11 (C0FB39..C0FB9A) plus the NMI's tick
// counter increment (00FD84: INC $32 once the tick has completed).
import { r8, r16, w8, w16, OBJ, padToSnes } from './mem.js';
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
  // NMI (00FD84): the previous tick is counted before this one starts, so $32 during
  // the tick (and in the vectors' truth.tick) is the index of the running tick.
  // Only a tick that completed ($16 != 0) is counted: the first tick after a round init
  // (which clears $16) runs with $32 = 0.
  if (r16(0x16)) w16(0x32, (r16(0x32) + 1) & 0xFFFF);
  w16(0x16, 0);            // C0FB27 STZ $16
  latchPads(pads);
  round.fade();            // C00C36  screen fade-in (brightness $30)
  bombers.input();         // C01602  pads -> human bombers' +6E
  stage.regrow();          // C0D8E8  stage 10 soft-block regrowth
  round.hurry();           // C10C3C  "Hurry!" at 0:38
  round.suddenDeath();     // C0D843  falling blocks
  stage.perTick();         // C036E6  stage gimmick, once per tick
  bombers.objects(G);      // C01E1D  every object: bombers, kicked/thrown bombs, ...
  round.effects();         // C10CAF  effect objects at $7EF000 (hurry banner ...)
  burn.update();           // C0DCB4  burning soft blocks / items (odd ticks)
  bombs.update();          // C0E0AA  bombs and explosions (even ticks)
  bombs.dangerDecay();     // C0E076  AI danger map decay when no bomb is out
  burn.list();             // C0DA42  rebuild the burn list
  disease.visuals();       // C00617  HUD sick faces (odd ticks)
  disease.contagion();     // C005EA  disease swap between touching bombers
  stage.anim();            // C1334B  animated tile lists
  items.scatter();         // C09615  items of dead bombers re-appear
  round.clock();           // C11C1A  round clock
  // C10971: pause handling (not part of the battle logic)
  rng();                   // C00CAA  once per tick
  round.end();             // C00A38  round-over detection / 256-tick countdown
  w16(0x16, (r16(0x16) + 1) & 0xFFFF);   // C0FB8D INC $16: tick complete
}

// After the tick: is the battle loop finished (round over and the 256 ticks elapsed)?
export function roundFinished() {
  return (r16(0xB9) & 0x4000) !== 0 && r16(0xBE) === 0;
}
