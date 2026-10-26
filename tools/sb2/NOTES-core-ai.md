# NOTES — phase 3a: COM AI in the JS core (public/arcade/sb2/core/ai.js)

`ai.js` is a line-by-line transliteration of `C0C54B` and everything it calls (stuck timer
`C106D8`, planners `C0CE32`, danger/escape `C0C990`/`C0C9A8`, stall `C0CC97`, executor
`C0CD53`, bombing/glove `C0C843`, periodic Y `C0C5DB`), including the zero-page scratch it
leaves behind (`$40 $50 $52 $54 $56 $58 $5A $5C $5E $88 $8A $94-$96 $97-$99`): other routines
read some of it (e.g. a belt-carried bomb on stage 8 copies `$52` into its +46, `C0DF87`).

## Verification (measured)
`tools/sb2/conformance/aisnap.py` logs every WRAM write while the emulator replays a vector
and cuts out each COM AI call (WRAM at its first write, and at the first write from outside
the AI's routines, interrupt handlers excluded). `aicheck.mjs` runs `ai.tick()` on each
"before" image and compares the "after" image (zero page `$40-$9F`, `$0300-$0A00`,
`$5C00-$5F10`, bombers `$8000-$83FF`, danger map, grid).

| vector | AI calls | identical |
|---|---|---|
| cpu_round_1p | 12 800 | all |
| cpu_round (round 1 + round 2 start) | 29 660 | all |
| cpu_stage02 … cpu_stage10 | 5 344 / 10 607 / 7 611 / 14 968 / 10 828 / 15 136 / 9 162 / 14 642 / 5 100 | all |

Paths never exercised by the vectors (so verified by reading only): the trapped exit onto
`$55`/`$49`/`$50` cells (`C0CBF2`), the up-scan `$2000` guards.

## Corrections to re/notes-ai.md and SPEC §15
1. **Chase (`C0CE91`) quirk.** On the negative branch the code reloads A with the step
   constant (`LDA #$0002` / `LDA #$0080`, stored to `$52`) *before* `CMP threshold`:
   - target to the RIGHT (self.x < target.x): the compared value is 2 → never a horizontal
     chase; it falls through to the vertical test;
   - target BELOW (self.y < target.y): the compared value is $80 ≥ every threshold → always
     `[D, 4]`, whatever the distance.
   So only "target left by ≥ threshold" (L) and "target above by ≥ threshold" (U) use the
   threshold. (Found at tick 145 of cpu_round_1p; register trace at `C0CEBC`.)
2. **Soft-block seek (`C0D2BC`).** The chosen direction is written to plan[0] *before* the
   adjacency test, so an adjacent block (n = 0) leaves plan[0].dir changed (count untouched,
   no plan flag). When a plan is made, the `$FFFF` terminator is loaded but **never stored**
   (`C0D33D LDY #4 / LDA #$FFFF / RTL`): after `[dir, n+1]` the executor continues with
   whatever entries are still in the buffer from older plans.
3. **Bombing an enemy (`C0C86D`).** No early exit: all four slots are tested (each match
   jumps to `C0CCE6` and returns into the loop), so "press A" can happen several times in
   one tick (harmless, same result).
4. **Glove aim (`C0C66E`).** All four slots are tested and every aligned living human
   overwrites +6E with a bare direction word, so the **last** aligned human (slot order)
   wins. Then +6E &= $0F00 (release A/Y = throw), +D6 = 0. Throw happens when +D6 > hold.
5. **Trapped exit (`C0CBF2`).** A `$55` neighbour in *any* direction jumps to the "right"
   case, so the plan is always `[R, 1]` for `$55` (only `$49`/`$50` use the matching
   direction). Checked in order R, L, U, D.
6. **Escape plan pointer.** When trapped without a gimmick exit: press Y, +BE |= $C000 and,
   if plan[0].dir ≠ 0, plan[0] = `[0, $0FFF]` (entry 1 left as is).
7. **Random walk (`C0D441`)** is also called from the stall handler, but it checks
   `tick & 3 ≠ 0` itself: a stall on a phase-0 tick cancels the plan without a new one.
   The non-blocked path advances the dp pointer `$97` by 4 (scratch only).
8. **Stuck timer**: the plan is dropped when +EC becomes **greater** than the level limit
   (+EC is reset to 0 then); +38 is written twice when the cell changes.
9. **Executor**: the end marker check is "bit 15 of the direction word"; the "arrived"
   test happens even in escape mode; the stop-before-danger rule stores the masked pad word
   into the entry's count (`$0080` if A is held, so the entry continues 127 more cells).
10. **Up scans** (soft, item, escape) stop when the next index is ≥ `$2000`; down scans have
   no guard. Escape side cells check `$43`, `$01`, solid and danger but not `$0E`.
11. `C0C843` resets the glove timer +D6 to 0 on every tick the bomber is not holding.
12. The planners call `C0BEA6` (cell under the centre) again before `+DE = +A8`; it only
   re-derives the same cell but rewrites scratch `$4A/$4C/$4E` (ai.js calls the movement
   module's `centreCell` when exported, else `cellLookup`).

## Notes for the tall layout
Read from the disassembly of the whole AI (C0C54B..C0D530, C17CA9..C17F40, C106D8): the
only field-size assumptions are the up-scan `$2000` guard (row 64, outside a 32-row grid:
harmless), `C0EE1C`'s `& $1FF` pixel mask (row 29 → y 448, fits) and the glove aim's
`AND #$00F8` on y (C0C66E, 4 copies; also the never-called C0CF08): on the 13x25 field it
matched a human 256 px = 16 rows away as "same row", so a COM threw sideways at nobody.
ai.js masks y with $1F8 on the tall layout only. The scan results keep the distance in
the low byte (`AND #$00FF`): ≤ 24 cells, fits. No ROM table the AI reads is laid out for
the 13x11 field except the danger decay list $C5D46A (tall.js TALL_DECAY).

## Tall CPU audit (tools/sb2/ai-eval, Oct 2026)
"CPUs seem more stupid on the tall field." Tools:
- `eval.mjs` — headless matches (4 COMs, and a scripted human P1 `human.mjs` + 3 COMs) on
  all stages, original vs tall, per-CPU metrics: deaths by own bomb / opponent / sudden
  death / walking into fire, idle / stuck / reversals, bombs, soft blocks and items per
  minute, time near a foe (plus a random-placement baseline that normalises for the arena
  size), isolation / sealed-in, time-up draws, human wins. `report.mjs` compares runs
  (`--stages` per stage, `--mode`). `--core DIR` runs a snapshot (snapcore.sh).
- `danger.mjs` — stale danger-map marks (marked cells no bomb/fire explains).
- `scenarios.mjs` — the tall failures below as pass/fail tests (also on the original).

Root causes found (each fails in scenarios.mjs on the old core, passes now):
1. **Stage 10 jump** (stage10.js C06852/C066F5/C06819): the landing y +C0 is a byte; a jump
   from y ≥ 256 (below row 16) landed 256 px higher — 52 of 281 COM jumps in 4 tall games
   teleported, some into the border row. COMs jump on every periodic Y facing a wall.
2. **Glove aim** (ai.js C0C66E): y `AND #$F8` (above).
3. **Stage 4 tall map** (tall.js): 2-cell side pockets exiting only over the fuse ring,
   which the escape scan treats as a wall: own-bomb deaths 57% of deaths vs 43% (30 seeds);
   with the new rows 32%.
4. **Stage 8 belt bombs** (movers.js C088CC): y `AND #$F0` on the snap sent a bomb below
   row 16 up 16 rows (into the border for row 18); C08CC6 checked the 13x11 switch cells.
The original layout is unchanged (run.mjs 46/46, aicheck: 135 858 AI calls identical).

Checked and NOT changed (measured, no gain):
- Vertical chase legs scaled 4 → 9 cells on tall: proximity unchanged (10.1%), first
  kill later (29 s vs 25 s). The chase is not the bottleneck; soft blocks are.
- Danger decay 2 cells/tick on tall (253-cell list vs 113): stale marks 1.66 → 1.58 per
  tick, a COM faces a stale mark 0.32% of its ticks either way.
What remains different is density, not decisions: the tall field has 2.27x the cells and
soft blocks for the same 4 bombers and clock, so COMs meet less (near a foe 10% vs 16%,
first kill 25 s vs 19 s, time-up draws 6% vs 2%, mostly stage 7 where the sudden death
leaves a 9x21 inside). Normalised by a random placement on the same arena, tall COMs are
near a foe MORE (0.84 vs 0.68). Per-decision metrics match (own-bomb share 57/55%,
walked into fire 15/15%, idle 67/67%, reversals 15/15%, stuck 6/6%).

COM level (+D2 = level − 1, honoured on tall): only CHASE / BOMBBOX / STUCK / HOLD change
(table above; levels 8 and 9 differ only in STUCK/HOLD). Measured (human3, 4–6 seeds x 10
stages): L1 → L5 → L9 idle 71 → 66 → 43%, cells/s 1.9 → 2.1 → 3.1, bombs/min 6.5 → 10.7 →
12.1, own-bomb deaths/min 0.31 → 0.60 → 0.80 (original; tall the same trend). A higher
level is busier, not safer: vs the scripted human, human wins 22 / 33 / 32%.
