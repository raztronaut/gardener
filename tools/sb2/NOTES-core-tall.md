# NOTES — phase 3a core: TALL layouts (13×25)

`createGame({ layout: 'tall', stage, players, rules, seed })` builds a 13×25 playfield
(cy 4..28, border rows 3 and 29; SPEC §17) for all 10 stages. Files: `core/tall.js`
(generator, tall tables), `core/geom.js` (layout-dependent constants). Checks:
`tools/sb2/conformance/tall_sanity.mjs`; quick runs: `tools/sb2/conformance/sim.mjs --tall`.

## Where the layout lives
- The layout is a byte in the WRAM image, `$7E7000` (never touched by the original, checked
  over every vector trace): b0 = tall, b1 = "pace" sudden death. So the geometry follows
  whichever game's memory is active and survives `save()/load()`.
- `geom.js` derives the constants the core needs from it (`isTall`, `parkY`, `yMask`,
  `offY`, `hopBottom`, sudden-death / hurry digits, block steps).
- Module tables that depend on the layout (danger decay list, stage-4 fuse list/ring,
  item-scatter scan, sudden-death order/corners, stage-8 ring) are installed by
  `tall.syncLayout()`, which `index.js` runs whenever a different game's memory becomes
  active and `layout.buildLayout` runs at every round init.

## Generation (tall.js)
- Every tall row copies one row of the stage's ORIGINAL map (grid code, underlay, tile word,
  underlay tile word from `layout_data.js`), so cell kinds, floor shadows, gimmick tiles and
  the spawn corners are the original's. Default row map (`rowOf`): rows 0..9 = original 0..9,
  rows 23..31 = original 9..17 (the bottom spawn corners at 26..28), middle rows 10..22 =
  original row 9 (pillar row) on odd rows and row 8 / 10 (soft row) on even rows. Pillars
  stay on odd rows/columns; the field is symmetric about cy 16 where the original is.
- Per stage:
  - 1, 6, 9: default (stage 6's teleporters land on (4,6) (12,6) (4,26) (12,26); stage 9's
    arrows only where the original has them: corners, (4,6) R (12,6) V (6,8) U (10,8) U and
    the mirrored lower ones; middle-row copies are stripped).
  - 2 (ice): default + the hole rows repeat at 12 and 20 → holes at cx 4/8/12 on cy 6, 12,
    20, 26.
  - 3 (beach): default (the frame columns cx 3/13 and the central water/soft band stretch;
    tunnels stay at cx 4/12 in the top border rows 2/3 and the bottom border rows 29/30).
  - 4 (barrels): one fuse ring cx 4..12 × cy 6..26; centre spawns P1 (6,15) P2 (10,17)
    P3 (10,15) P4 (6,17). Rows 9..24 repeat the original's rows 7..11 (14..18 = 7..11
    exactly, so the centre looks like the original's), with the pillar-parity flip as a
    double OPEN row (8/9, 23/24). The first version repeated rows 8/9/10 only: every middle
    pillar row then had row 9's soft blocks at cx 2/14, cutting the sides into 2-cell
    pockets whose only exit is the fuse ring — a wall to the COM escape scan ($0E) — and
    COMs died on their own bombs there (ai-eval: own-bomb deaths 1.36/CPU-min vs 0.84 on
    the original; 0.58 with the new rows).
  - 5 (garden): default with the power tiles placed on the repeated diamond: 21 tiles —
    (8,4) (4,6) (12,6) (6,8) (10,8) (8,9) (6,10) (10,10) (4,12) (12,12) (8,16) and the T/B
    mirror of the first ten.
  - 7 (race): straight track segments (original row 10) above and below; pads on cy 16;
    the permanent soft block at (8,15) above the centre stop pad; L/R symmetric only.
  - 8 (factory): conveyor ring rows 6/26, columns 4/12 (clockwise), soft blocks on cx 8 of
    the even middle rows, direction switch (8,15), open (8,16), speed switch (8,17).
  - 10 (forest): rows 6..12 repeated three times (rows 6..26).
- Random soft-block removal: C0F50D with the scan widened to 32 rows (`y & $1F0`), N scaled
  by the soft-block count (round(N × soft_tall / soft_orig)).
- Deck: 145 cards at the original address `$7E3C48` (`$3C48..$3D6B`, unused by the original:
  checked over every trace); per-stage counts × 25/11 rounded (stage 1: bomb 16, fire 14,
  speed 11, skull 2, glove 7, kick 7); pierce/remote stay 0. Positions = RNG mod 145
  (layout.buildDeck), otherwise the original's draw order and quirks.
- Spawns: (2,4) (14,4) (2,28) (14,28) with the original's clear L cells; dead/empty bombers
  are parked at y = $1F0 (below the field) instead of $F0 (row 16 is inside the tall field).

## Sudden death (design choice)
- The two outer rings of the tall field: 72 + 64 = **136 blocks**, clockwise from (2,4)
  (`tall.ringOrder`), through a ring-only field list at `$7F0B10/$7F0D10` (same footprint as
  the original's 143-entry list).
- **Default (`rules.tallSuddenDeath = 'clock'`): starts at 0:47 at the original 15 ticks per
  block** (2040 ticks → ends ≈ 0:16, like the original's ≈ 0:15); "Hurry!" at 0:52 (5 s
  before, as 0:38 → 0:33).
- Option `'pace'`: starts at 0:33 like the original with 9 ticks per block (3 steps of 3
  ticks; 136 × 9 = 1224 ≈ the original 1200).
- AI corner pre-marks (C0D6A8) use the tall corners; the original's fourth-entry quirk (an
  address that is no ring cell) is kept.

## 13×11 constants that had to follow the layout (edits in other modules, marked "tall:")
- `bombers.js` C0A146: off-screen y threshold $F0 → $1E0; x ≥ $1F8 counts as off-screen in
  tall so objects parked at ($1FF, $F0) still vanish.
- `setup.js`: `$5D3C` (y mask) = $1FF; tall spawns; parked y.
- `move.js` C0A7FA / C0A6FD: parked y.
- `movers.js` C0843E hop-out bottom limit (+224 px); C1043F tunnel step centre ($F0).
- `items.js` C0963E: the free-cell bound `$800` → the scan end (`$F00`).
- `round.js`: sudden-death / hurry digits and block steps from geom; stage-3 tunnel closing
  cells (4,29) (4,30) (12,29) (12,30).
- `layout.js` buildLayout → `tall.buildTallLayout`.
- `index.js`: `layout` option, `game.layout`, table sync on game switch.
- y kept with bit 8 where the original masks it to 8 bits (y reaches 448; found by
  tools/sb2/ai-eval, see NOTES-core-ai.md): `stage10.js` jump landing y +C0 (C06852 /
  C066F5 / C06819 — a jump below row 16 landed 16 rows higher), `ai.js` glove aim
  (C0C66E `AND #$F8`), `movers.js` belt-bomb snap (C088CC `AND #$F0`); `movers.js` C08CC6
  thrown bomb on a stage-8 switch uses the tall switch cells (8,15)/(8,17).
- `stage3.js` tunnels (bottom cells rows 29/30, transit y $1CF), `stage6.js` lower pads
  (12,26)/(4,26), `stage8.js` switches (8,15)/(8,17) (tile animation + latch), stage-4 / 8
  rings via their `setRing` hooks.
- The original layout stays byte-identical: run.mjs pass set unchanged (45/45) before/after.

## tall_sanity.mjs
Per stage: spawn connectivity after the removal (stage 10 needs the Y-jump, as its original
map does), symmetry like the original (L/R + T/B for 1–6, L/R for 7), no soft block or new
gimmick in a spawn pocket (stage 9's corner arrows are the original's), deck = 145 with the
scaled counts, CPU rounds (4 COM, level 5) to completion for seeds 1, 2, 4. Note: seeds s and
s|1 give the same stream (the RNG ORs 1 into the seed).

## Known gaps
- Stage 9's `$55` random-teleport destinations ($C5E6C6) are 13×11 cells; no `$55` cell
  exists in any battle map, so this never runs.
- The renderer has no original BG for the tall arena: it must compose it from the metatiles
  by the copied tile words (they are the original's words, so `stage.json` metatiles match).
- Tall rounds are not verified against anything but the sanity checks (there is no original
  to compare with); behaviour inside the extra rows is the original code on a taller grid.
