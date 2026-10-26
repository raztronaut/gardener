# NOTES — core stages 4-7 (phase 3a)

Code: `public/arcade/sb2/core/stage4.js` .. `stage7.js` (handlers exported under their ROM
address, routed by `stage.js`). Verified by `tools/sb2/conformance/run.mjs` (cpu_stage04..07
pass, 3264/3742/3897/3784 ticks) and by `wdiff.mjs` (full logic WRAM identical until the end of
each vector, except the display-only tile-animation bytes below). Negative controls (handlers
stubbed) diverge at the first teleport (cpu_stage06 tick 251) / first pad (cpu_stage07 tick 342).
Extra vector `stage07_stoppad` (recorded by `tools/sb2/conformance/rec_stage47.py`, P1 human on
battle_stage07 walks onto the centre stop pad): passes, WRAM identical.

## Stage 4 — fuse ring (C03A89 = C03C85 + C03A92)
- Ignition (C0E8F8, in bombs.js) sets the ring phase `$5CE2` = 0 and `$5CF0` = owner palette.
- C03A92: idle while `$5CE2` < 0. Timer `$5CE4`: a phase runs when the timer is 0 or 1 on entry,
  then it is reset to 3 (so a phase every 3 ticks). `$5CE4` starts at 0 at round init, so the
  FIRST ring of a round starts on the next tick after ignition, but a later ring waits 3 ticks
  (the timer still holds 3 from the previous ring).
- Phases 0..9 write fire (`$01`) + the flame tile of the phase on all 28 cells (lists
  `$C5E64E` top row, `$C5E674` bottom, `$C5E6B0` right column, `$C5E69A` left column; tiles via
  `$C33029..` → `$C312DC`, palette bits replaced by `$5CF0`); phase 10 re-arms (`$0E`, grey
  tiles) and sets `$5CE2` = `$FFFF`. Fire = 10 phases × 3 ticks = 30 ticks (SPEC's "11 phases"
  counts the re-arm phase).
- QUIRK (C03C38): the danger map gets the TILE WORD (`STA $5E` where `STY` was meant), 0 on
  phase 10. The second ring writes `$FFFF` correctly.
- Cells whose underlay is a sudden-death block (`$C1`) are skipped. A skull ITEM on a ring cell
  (`$44`, tile & $3FF = $20A) flies off first (C03E8A → C0EE71 = movers.skullFly).
- A second, outer ring (C03C85, `$5CDE/$5CE0/$5CEE`, rows 4/14 and columns 2/14) is lit by fire
  on a `$0E` cell that is NOT in the main list — no such cell exists in battle (implemented).
- `setRing()` lets a taller layout supply its own ring lists.

## Stage 5 — power tiles (C03748, C06302)
- The `$7E2FF0` list ([grid, tile] words, `$FFFF`-terminated) is built on the FIRST battle tick
  (`$5D58` b0), not at round init, by scanning all 32×32 positions for underlay `$14` (tiles under
  soft blocks included). Verified byte-exact against cpu_stage05's start WRAM.
- C06302 → C11080 runs per OBJECT per tick: `$5E28` +1 per object; at `$280` it resets and
  `$5E2A` b0 flips. SPEC's "every 160 ticks" holds only with exactly 4 objects in the list
  (movers make it faster). The switched tile-animation lists (`$7E2BF0`) are display only and
  not reproduced.

## Stage 6 — teleporters (C04D33, C06307, C10456)
- Pads by colour: the pad's current tile word is matched against the UNDERLAY tile words of the
  4 pads (`$C5E881` tile indices); destination = `$C5E8B1` grid index of the matching other pad.
- Blocked if the destination holds a bomb (`$43`) or a BOMB MOVER (an object with +7E b8 and
  +42 = 8 on that cell, C10456). SPEC says "a bomb or bomber" — bombers do NOT block.
- Kicked bombs (+7E hi set, +52 b5) teleport too. Bombers must have +52 & $81 = 0 and not be dying.
- After the move: centre of the destination (y & `$5D3C`), C0BEA6, +04 b4 latch; C06307 clears
  the latch once the object's cell is no longer `$50`.

## Stage 7 — speed pads (C04C66, C06321)
- Entering a pad (latch +0E b2) sets BOTH +F0 and +E0 (base) to the pad level (`$C5E859`:
  $1C28→9, $1C2A→7, $1C2C→1, $1C2E→6, $1C48→10, $1C4A→8 = stop), then C0C2CE.
- Stop pad: +0E b3, +CE = $80 and +0C (anim timer) = $80; C06321 sets +52 b0 (busy) every tick on
  the pad and decrements +CE; when it would reach 0 (it stays at 1) +0E b3 clears and +52 b0
  clears unless +52 b7. Measured: P1 busy for 129 frames (stage07_stoppad).
- A non-stop pad re-rolls its tile (current and underlay) from `$C5E871[$0400 & $E]` after use.
  Kicked bombs only latch and trigger the re-roll (no speed). The stop pad never re-rolls.

## Not done here
- C1334B (tile-animation lists `$7E2BF0`, VRAM request `$5EEE..$5EF8`): display only, routed by
  stage.js but unimplemented — the only wdiff differences left on cpu_stage05/06.
