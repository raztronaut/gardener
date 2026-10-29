# NOTES — core: stages 8, 9, 10 and the animated tile lists (phase 3a)

Code: `public/arcade/sb2/core/stage8.js`, `stage9.js`, `stage10.js` (handlers exported
under their ROM address, routed by `stage.js`). All read from the 65816 code; verified
by `cpu_stage08/09/10` (whole round 1 matches the original's WRAM byte for byte in the
logic ranges, wdiff; run.mjs passes all three — see "needed elsewhere").

## Stage 8 (factory, $1A = 9)
- Per tick C0406E: `$5D60 = $FFFF`; belt palette cycle C041A0 (`$5CB8` timer 8, or 4
  in fast mode; `$5CBA` phase 0..3, +1 per step, −1 when reversed — a renderer can use it
  as the belt scroll phase); second cycle C04158 (`$5CC0` 4 ticks, `$5CC2` 0..1);
  switch animations C040EF (direction, `$5CC4`/`$5CC8`, 4 ticks/frame) and C04086
  (speed, `$5CC6`/`$5CCA`, 5 ticks/frame). Palette writes ($7E2420) are display only
  and not reproduced.
- **Switch timing**: stepping on (8,8) / (8,10) (cells $12 / $13) only sets the
  animation step to 0 (and the object's latch `+02 b8`); the mode bit (`$5CBE` b1
  reversed, b0 fast) toggles on the NEXT tick's per-tick step 0. Tiles at $7FA210 /
  $7FA290 (+ $7FB...) cycle 1C64/1C66/1C68 (dir) and 1C6A/1C6C/1C6E (speed), reversed
  order when switching back. The latch clears when the object's cell is neither (8,8)
  nor (8,10) (C06376). A mover toggles a switch only while kicked (`+52 & $20`).
- **Belt cells** $17..$1A (C053E1 R, C05461 L, C054E1 U, C05561 D) set, every tick an
  object stands on them, the belt velocity +20/+22 (x) or +30/+32 (y) = $0000.8FFF
  (0.5625) or fast $0002.4FFF (2.3125) and +28 = the push direction (swapped when
  reversed); move.js C0C34D combines it with the walking velocity. Movers are carried
  only if `+7E == $100` (bomb) and `+02 b9`. Off a belt cell (C06533) the belt
  velocity is cleared. Corner cells $1B..$1E pick the outgoing belt; a carried bomb is
  first clamped to the turn (x $40/$C0, y $50/$B0 — `setRing()` for tall layouts) and
  ignored until it reaches it.
- **Bombs resting on a belt** (C0DF30 in bombs.js → C0DF87 here): a bomb whose underlay
  is $17..$1E (not exploding/held, fuse ≠ 1 unless remote-and-not-forced) becomes a
  belt-carried mover (template bomb, `+02 = $200`, `+00 = $9400`); its cell reverts to
  the underlay. Quirk: the mover's +46 is copied from scratch `$52`.
- C06398: a bomber with kick walking into a carried bomb (next cell = the bomb's, the
  cell beyond free of solid/object bits, no other carried bomb there) turns it into a
  kicked bomb (speed 2) — never happened in the vectors.

## Stage 9 (tech, $1A = $A)
- Per tick C03EB6: panel colour cycle `$5CC0` (6 ticks) / `$5CC2` phase 0..3 (display).
- C06567 / C052E5 / C0538B handle cells $55 (pit: fall anim, then a random warp to one of
  $C5E6C6 = 020E 041C 0504 0712 [041C]) and $56 (stun). Neither cell exists in the
  battle map; arrows only act on kicked bombs (movers.js C10F81).

## Stage 10 (forest, $1A = $B)
- **Jump** (C06616 on the Y edge, latch `+0E b8`; C068B6 + C06852): `+52 = $0801`,
  `+02 b0`, vy 4 px/tick up with deceleration 0.25/tick² (`+2E = $4000`, `+00 |= $0A`),
  landing y = take-off y (+C0). A shadow object (mover, template $C2017B, anim $14) is
  spawned (`+C8`). Each tick (C06658/C066F5): the direction is chosen on the first tick
  that has one — COM: the input at take-off (`+9A`), else random `$C5D848[$0400&3]`;
  human: the pad at that tick (horizontal wins) — so a human jumping with no direction
  held goes straight up and keeps polling. Horizontal: 0.5 px/tick (+16 = $8000) for
  bomber and shadow; vertical: the landing y (+C0) and the shadow move 1 px every even
  tick. Lands when y ≥ +C0 after the apex (32 ticks for a full arc): shadow freed,
  velocities zeroed, state restored. **No block check at take-off**: landing on a bomb
  (`+B4 == $43` → `$5D02`) calls the hop-out C0838C (movers.js); landing in a solid cell
  is handled by the movers' mode-0 hop-out. Measured rules (timings, wrap, fire, items,
  carrying) and the original-vs-core check: NOTES-core-ai.md "Stage 10 jump".
- **Soft-block regrowth (not in SPEC)**, C0D8E8 every tick before the objects: after a
  delay `$5D0A = $C5E366[$0400&$1E]` (64..1280 ticks; skipped while `$5D7E < 0`), the
  index `$5D0C += $0402&$1E` walks the regrow list `$7F0300` (built at init by C0F428:
  the map's soft cells; 0 = end → index reset). If the cell is empty and no object
  stands on it or next to it (C0D9F0), it regrows: the cell is `$C2` (solid, danger 0)
  from the first frame on, the tile cycles 1CC0/1CC2/1CC4/1CC6/1C02 at 4 ticks per frame
  (C0D88F, state `$7F0B00..07`), then stops. The underlay stays floor; bombed later it
  burns like any soft block (and draws the next deck card). Sudden death cancels a pending regrow on its cell
  (round.js C0D7CC). Measured: 4 regrowths in cpu_stage10, all reproduced.
- C0DA60 (per entry of the `$7E3D88` list, C0DA42): the list is only cleared at init
  (C01D70) and never filled in battle → never runs (export is a no-op).

## C1334B (all stages): animated character lists `$7E2BF0`
32-byte entries until byte 0 = $FF: b7 upload pending, b1 stopped, b0 one-shot; +1 char
number, +2 frame length, +3 countdown, +4 sequence index (frames ≥ $F0 end, restart at
$10). A pending entry queues one VRAM upload (`$5EEE = 1`, `$5EEF..$5EF8`; the NMI
uploads and clears `$5EEE`) and skips the advance that tick. Only stage 6 (teleporter
pads, list from setup.js) uses it in battle; reproduced exactly.

## SPEC corrections
- §14 stage 10: add the regrowth rule above; the jump has no block check at take-off
  (code), direction = pad at the first airborne tick for humans / take-off input for
  COMs; vertical jumps move the landing point 0.5 px/tick.
- §14 stage 8: switches take effect one tick after stepping on them; belt-resting bombs
  are converted into carried movers (C0DF87).
