# SB2 battle — round flow (phase 2b sub-notes)

Tick = one main-loop iteration = one `$0032` increment (see NOTES-re "Tick counter / lag").
All rules below count **ticks**, not video frames: lag frames slow the real clock.
"V" = verified in the harness, "C" = read from code only.

Scripts: `round_sd.py` (sudden-death order/timing), `round_crush.py` (block vs bomb /
player), `round_match.py` (whole CPU match: round over, results, wins).

## Settings (menu → battle variables)

| menu row | menu var | range (V, cycled with RIGHT) | battle var | meaning |
|---|---|---|---|---|
| COM LEVEL | `$1CA5` | 0..8 (shown 1..9, wraps) | `$5C58` = same | CPU level − 1 (default 4 = "5") |
| BATTLE | `$1CA7` | 0..4 (shown 1..5) | `$5C5A` = `$1CA7`+1 | wins needed to take the match (default 3) |
| TIME | `$1CA9` | 0..4 | `$5C54` | 0 = 1:00, 1 = 2:00 (default), 2 = 3:00, 3 = 5:00, 4 = ∞ (minutes table `$C5EE53` = 1,2,3,5,$FFFF) |
| G-BOMBER | `$1CAB` | 0/1 | `$5C5C` | gold bomber on/off (default ON) |

Copy-over at `CC0377`; defaults at `CC1445` (COM 5, BATTLE 3, 2:00, G-BOMBER ON). The
attract demo (`CC0204`) uses 4 COM, level 4 ("4"→stored 3), 1:00, G-BOMBER off.
`$5C4C/4E/50/52` = per-slot MAN/COM flags.

## Round start (V)

- Round init `C00D80`: `$5C56 = $FFFF`, minutes `$5E10` = table[`$5C54`], seconds
  `$5E12 = 0`, sub-counter `$5E14 = 0`; `$0032` reset to 0 (`C01EB1`); objects cleared
  (`C01ED5`, so **all player stats/items reset every round**).
- **No "READY/GO" countdown.** The screen fades in: `$0030` (INIDISP shadow,
  brightness) goes 0→15, +1 per tick, reaching 15 on tick 16.
- Players are frozen until `$30 & $0F == $0F` (gate in `C01E1D`): P1 holding DOWN from
  the stage-select START first moves on **tick 16** (measured: y $30→$31 at tick 16,
  CPU P2 starts at tick 17). Bombs/timer already run during the fade.
- The round timer runs from tick 0 (fade included).

## Timer (V; `C11C1A`, called every tick at the end of the main loop)

- `$5E10` minutes, `$5E12` seconds, `$5E14` sub-tick counter, `$5E04/06/08` displayed
  digits (m, s-tens, s-units), `$5E20` bit15 = timer stopped.
- `$5E14` counts up each tick; when it is $40 on entry it resets to 0 and one second is
  subtracted → **one displayed second = 65 ticks** (first decrement at tick 64,
  then every 65 ticks: 2:00→1:59 at tick 64, 1:58 at 129, …). Measured.
- Not counted when TIME = ∞ (`$5C54 == 4`).
- At 0:00 the next "second" (65 ticks later) does not go negative: it sets
  `$5C56 = 0` (= time up). For 2:00: 0:00 shown at tick 64+119×65 = 7799, time-up at
  tick **7864**.
- Time up: every bomber whose pipeline reaches `C0A6FD` with `$5C56 == 0` is killed via
  the normal death routine (`C0A675`, +00 b11 dying). All four die together → round
  over with no survivor → **DRAW** (measured: DRAW screen).

## "Hurry!" (V visually, C trigger)

When the displayed time is 0:38 (`C10B76`, digits 0/3/8, not ∞) a "Hurry!" sprite
object is spawned at `$7EF000` (x = $140, y = $70, scrolls left 2 px/tick), sound $4E,
`$5E34` |= $8000. Cosmetic. (A 1:05 variant exists but is dead code.)

## Sudden death (falling blocks) (V)

- Trigger `C0D843`: when the displayed time reads **0:33** (and TIME ≠ ∞, round not
  over) it sets `$5D0E` bit0 on the next tick; from then on `C0D5BB` runs every tick:
  a 3-tick counter `$5D10`; each 3rd tick one "step".
- Order: byte table `$C5E1C9` = indices into the 13×11 inner field, row-major
  (index i → cell (2 + i%13, 4 + i/13); the per-stage list `$7F0B10` was row-major on
  all 10 stages). `$FE` = stop unless `$1C68 ≠ 0`; `$FF` = end. `$1C68` is 0 in every
  normal game (it becomes $FFFF only through a menu-side counter `$1C6A == 10`
  at `CC17D2` — a hidden option, not decoded) → **80 blocks: the outer two rings**.
- Each block: step 0 writes the cell = `$C1` in both `$7FC000` and `$7FD000` (unless
  the cell is `$4C`), tile `$18CC`, spawns the falling-block sprite (`C10761`, sound $72
  on the first block); steps 1–3 rewrite the tile; step 4 (anim table `$C5E25A` = 4 ×
  $18CC then $FFFF) ends the block; the next block starts on the following step.
  → **one block every 15 ticks; the cell turns solid at the first tick of its block.**
- Timing for 2:00: 0:33 shown at tick 5654, bit set 5655, **block n lands at tick
  5656 + 15·n**, n = 0..79 (last at 6841, ≈ 0:15). Measured: blocks at relative
  ticks 0, 15, 30 … 330 for (2,4)…(14,14); 0:33 at t147 → bit t148 → first block t149.
- Cell order (n = 0..79, tick offset 15·n):
  (2,4) (3,4) (4,4) (5,4) (6,4) (7,4) (8,4) (9,4) (10,4) (11,4) (12,4) (13,4) (14,4)
  (14,5) (14,6) (14,7) (14,8) (14,9) (14,10) (14,11) (14,12) (14,13) (14,14)
  (13,14) (12,14) (11,14) (10,14) (9,14) (8,14) (7,14) (6,14) (5,14) (4,14) (3,14) (2,14)
  (2,13) (2,12) (2,11) (2,10) (2,9) (2,8) (2,7) (2,6) (2,5)
  (3,5) (4,5) (5,5) (6,5) (7,5) (8,5) (9,5) (10,5) (11,5) (12,5) (13,5)
  (13,6) (13,7) (13,8) (13,9) (13,10) (13,11) (13,12) (13,13)
  (12,13) (11,13) (10,13) (9,13) (8,13) (7,13) (6,13) (5,13) (4,13) (3,13)
  (3,12) (3,11) (3,10) (3,9) (3,8) (3,7) (3,6)
  — only with `$1C68 ≠ 0`, continuing at n = 80: (4,6)…(12,6) (12,7)…(12,12)
  (11,12)…(4,12) (4,11)…(4,7) (5,7)…(11,7) (11,8)…(11,11) (10,11)…(5,11) (5,10)…(5,8)
  (6,8)…(10,8) (10,9) (10,10) (9,10)…(6,10) (6,9) (7,9) (8,9) (9,9) (143 total).
- Effects of a landing block (cell = `$C1`: solid, type 1):
  - **player** whose centre cell it is: dies the same tick (the death check treats
    type 1 like fire; `+EF` protection would absorb it — C). Measured (P1 on (2,4)).
  - **bomb** in the cell: removed without exploding, the owner gets it back
    (+F8 −1, +F1 recomputed) (`C0D7F3`→`C0E42E`). Measured.
  - soft block / item / floor / pillar: simply overwritten (a soft block's hidden item
    is lost). Fire: the block overwrites it, but an explosion still in progress keeps
    rewriting its ray cells with fire until it ends and then restores the underlay ($C1) (C).
  - Danger map: blocks at the ring corners (grid idx $204,$21C,$71C,$704,$286,$29A,$69A,
    $1E06) mark the next row/column as dangerous in `$7F8000` for the AI (`C0D6A8`).
  - Stage 3 (`$1A == 2`) only: at sudden-death start the four 2-deep tunnels in the
    top/bottom border — (4,2) (4,3) (12,2) (12,3) (4,15) (4,16) (12,15) (12,16), cell type
    $11 — are closed to $C1 (`C0D52B`; measured).
- Falling blocks stop once the round is over (`C0D843` checks `$B9` b14).

## Round end (V; `C00A38`, every tick at the end of the main loop)

- Count the 4 bomber slots with +00 b11 (dying/dead, set the instant a bomber is hit).
  **When ≥ 3 have it**: `$B9 |= $4000` (round over), timer stopped (`$5E20 = $8000`),
  `$BE = $100`. Then `$BE` −1 per tick; the battle loop keeps running for those
  **256 ticks**, then exits to the results (measured: round over t479 → exit t735).
- During those 256 ticks: players can still move/act; falling blocks stop; ordinary
  bombs **do not count down** (`C0E980` skips when `$B9` b14 and the bomb has no b6);
  bombs already set off by fire (flags |= $C0) still count down and running explosions
  continue — so the survivor can still die in a chain.
- Winner (`C00B05`, after the 256 ticks): the first slot without b11 → `$5C3E` =
  slot 0..3; if all four have it → `$5C3E = $FFFF` = **DRAW** (no win awarded).
- Tag match (`$B9` b13) uses team logic (`C00AC8`/`C00B52`); not needed for single match.

## Wins / match (V)

- Win counters: words `$7E5E66 + 2·slot` (P1..P4; pointer table `$CC28F0`),
  incremented on the scoreboard (`CC4CA8`); match over when a counter ≥ `$5C5A`
  (`CC791F`). Measured CPU match (battle_start, 1 idle human + 3 COM lv5, BATTLE 3):
  rounds won by P4, P3, P4, P3, P3 → P3 wins 3–2; most rounds lasted into sudden death.
- Results timing (frames, measured): main-loop exit → `$B9 = $1000` after 18 frames →
  scoreboard (trophies) → next battle's `$B9 = $8001` 409 frames later → first tick of
  the next round ≈ 82 frames after that (~510 frames between rounds). DRAW shows a
  "DRAW" banner instead of the trophy.
- Same stage every round of the match; spawn slots/corners do not change; soft-block
  layout differs per round (random — see stage notes); items/abilities reset.
- Match end: scoreboard → "VICTORY!!" screen → **ROULETTE** ("PUSH B BUTTON"; spins,
  stops when A/START is pressed after ≥ $40 steps, or by itself at step $E8; UI code
  `CC5E00..CC5F9A`, not fully decoded) → back to SINGLE MATCH / player table / rules
  / stage select.

## G-BOMBER (C + V)

At match end the champion's slot → `$1CAF`/`$5C3C`, the roulette result →
`$1CB1`/`$5C42` (`CC5F58`). If G-BOMBER is ON, in every round of the **next match**:
- `C00B8A` (round init): champion's +04 |= $0100 and +50 = 2 → drawn as a **gold
  bomber** (V: red champion appeared gold in the next match);
- `C019CB` (round init): bonus by `$5C42` via table `$C5D5C2` (player byte fields):
  0 → +F1 and +E1 +1 (one more bomb, current and base), 1 → +F0/+E0 +1 (speed up),
  2 → +FE +1 (glove), 3 → +FF +1 (kick), 4 → +EF +1 (one extra hit of protection),
  5 → +F0/+E0 −1 (speed down). (Measured case: result 0.) Mapping of the 8 roulette
  icons to `$5C42` values was not decoded.
G-BOMBER OFF clears `$5C3C/$5C42` (`CC03AC`).

## Uncertainties

- `$1C68` (full 143-block spiral) is reachable only via an unidentified menu input.
- Roulette icon→bonus mapping and stop rule are inferred from UI code.
- Timeout death goes through `C0A6FD`, which only runs in the normal movement path;
  a bomber in a special state at that instant (e.g. mid-kick animation) might be
  missed — in all observed cases all four died.
