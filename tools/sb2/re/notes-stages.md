# notes-stages — the 10 SB2 battle stages (phase 2b sub-task)

All numbers measured in the harness (stated "verified") or read from code ("code").
Coordinates: cell (cx, cy) in the 64×32 grid at `$7FC000`; the inner field is
cx 2..14 × cy 4..14 (13×11). Pixel ↔ cell: cx = (x+8)>>4, cy = (y+$17)>>4; a cell centre
is x = 16cx, y = 16cy−16. Ticks = executed game ticks (`$32`). Scripts:
`stages_dump.py` (grids/spawns of the 10 states), `stages_gen.py full|random`
(ROM maps before random soft removal, via a patched ROM copy in data/), `stages_softsim.py`
(re-implementation of the soft-block removal, matched against the emulator),
`stages_cov.py` (stage-unique code), `stages_report.py` (maps below).

## Stage ids and per-stage code
Stage 1..10 (select order) = `$1A` 0,1,2,5,6,7,8,9,$A,$B (3 and 4 unused in battle).
Dispatch tables indexed by `$1A`:
- `C036E6` (main loop, once per tick) → table `$C03707`: 0 none, 1 none, 2 `C0426E`
  (stage 3: tunnels + player/player collision), 5 `C03A89` (stage 4 fuse ring), 6 `C03748`
  (stage 5 tile list, once), 7 `C04206` (none), 8 none, 9 `C0406E` (stage 8 conveyors/
  switches), $A `C03EB6` (stage 9 palette cycling only), $B none.
- `C05741` (per player per tick) → table `$C5EB7F`: 1 `C05763` (stage 2 hole/jump state),
  2 `C05A59`, 6 `C11080` (stage 5 graphics toggle every 160 ticks, cosmetic), 7 `C06307`,
  8 `C06321` (stage 7 stop-pad timer), 9 `C06376`, $A `C06567`.
- `C04337` (per player): handler by the type (low 6 bits) of the cell under the player
  centre, table `$C5EBBF` (64×4 bytes); underlay type 9 → `C04468` (stage-2 hole), underlay
  $11 → `C04DE1` (stage-3 tunnel). Types used: $0F `C04C66` (stage-7 pad), $10 `C04D33`
  (stage-6 teleporter), $12 `C05288` / $13 `C052B6` (stage-8 switches), $17..$1E `C053E1`..
  `C056E9` (stage-8 conveyor cells); 00–08, 0A, 3C–3F etc. → no-op.
- Movement input: `C0C01C` → stage 2 ($1A=1) uses the ice integrator `C0C09E`; stage 3
  ($1A=2) skips the normal `C0C2CE` and moves via its own pair-collision code (`C069D8`).
- `C065F1`: stage 10 ($1A=$B) → Y-button jump `C06616`/`C06658`.

## Spawns (code `C01AF3`, verified in all 10 states)
Table `$C5E51C` (all stages but 4): P1 (2,4) x=$20 y=$30 · P2 (14,14) x=$E0 y=$D0 ·
P3 (14,4) x=$E0 y=$30 · P4 (2,14) x=$20 y=$D0. Stage 4 (`$1A==5`) uses `$C5E52C`:
P1 (6,8) $60,$70 · P2 (10,10) $A0,$90 · P3 (10,8) $A0,$70 · P4 (6,10) $60,$90.
The clear cells around spawns come from the fixed ROM maps (below; no runtime rule).

## Layout build (code `C0F3E4` chain; verified)
1. `C0F672/C0F6E5`: the stage map (RLE words: bits 10–15 = run−1, bits 0–9 = metatile id)
   is decoded into `$7FE000` as 64×64 cells; metatile → collision byte (`[$7C]`) and BG tile
   word (`[$79]`). Rows 0–31 become `$7FC000` (initial grid), rows 32–63 `$7FD000`
   (underlay). Pointers per stage via `$C5F9E5`.
2. `C0F5AF`: grid words masked to their low byte; copy to `$7FE000`.
3. `C0F50D` (battle only) **random soft-block removal**: N = word `$C5EA4D[$1A]` =
   stage1 12, stage2 16, stage5 30, stage7 23, stage9 8, others 0. Scan cells with
   x = 0,16,..,240 (inner loop) and y = 0,16,..,240 (outer), wrapping forever, cell =
   ((x+8)>>4, (y+$17)>>4); for every cell whose type is 2 (soft): r = RNG (`C00CAA`,
   value at `$0400`); if r ≥ $80 the cell is restored from the underlay (`C0DDF7`) and
   N −= 1; stop when N = 0. RNG: seed' = ((seed|1)·$383) & $FFFF, r = (seed'·(seed&$FF))>>16.
   **Verified**: `stages_softsim.py` reproduces the round-1 layouts of stages 1,2,5,9
   exactly from the ROM maps with seed 0 (the seed is 0 at stage select after power-on;
   it is only advanced by battle ticks, so later rounds / matches get other layouts; a
   title-screen demo would also advance it). Stage 7's only soft block has underlay $C2,
   so its 23 "removals" restore it (≈115 extra frames of loading) and it is permanent.
4. `C01CEA`: hidden item list (`$7E3C48`, parent's item notes). `C0F428` ($C5E2A6 per
   stage, only $1A=$B set): list of soft cells at `$7F0300`.

## Maps
Legend: `#` hard/wall ($C5, border $C6) · `s` soft ($C2) · `.` floor (00; stage 2 ice $07)
· `1..4` spawns · `,` ice variant ($08/$0A, no behaviour found) · `O` stage-2 hole ($49 over
underlay 9) · `f` stage-4 fuse ($0E) · `*` stage-5 power tile ($14) · `T` stage-6 teleporter
($50) · `P` stage-7 speed pad ($0F) · `> < ^ v` stage-8 conveyor ($17 right, $18 left,
$19 up, $1A down, corners $1D/$1B/$1C/$1E push right/down/left/up) · `D`/`S` stage-8
switches ($12 direction, $13 speed) · `U V R L` stage-9 arrows ($3C up, $3D down,
$3E right, $3F left; the corner arrows lie under the spawns).
Columns: full ROM map | round 1 (seed 0) | underlay. Stage 3's border has floor gaps
at (4,3),(12,3),(4,15),(12,15) (tunnels, underlay $11).

```
stage 1  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=True T/B=True rot180=True soft full=93 round1=81
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1..sssssss..3#   #1..s.s.sss..3#   #1...........3#
 5 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
 6 #.sssssssssss.#   #.ssssssss.ss.#   #.............#
 7 #s#s#s#s#s#s#s#   #s#s#s#s#s#s#s#   #.#.#.#.#.#.#.#
 8 #sssssssssssss#   #sssssssss.sss#   #.............#
 9 #s#s#s#s#s#s#s#   #.#s#.#s#s#s#.#   #.#.#.#.#.#.#.#
10 #sssssssssssss#   #sssssss.s.sss#   #.............#
11 #s#s#s#s#s#s#s#   #s#s#s#s#s#s#s#   #.#.#.#.#.#.#.#
12 #.sssssssssss.#   #.sssssssss.s.#   #.............#
13 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
14 #4..sssssss..2#   #4..ss.s.ss..2#   #4...........2#
15 ###############   ###############   ###############

stage 2  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=True T/B=True rot180=True soft full=81 round1=65
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1..sssssss..3#   #1..sss.sss..3#   #1...........3#
 5 #.#s#s#s#s#s#.#   #.#s#.#s#.#s#.#   #.#.#.#.#.#.#.#
 6 #.sOsssOsssOs.#   #.sOs..OsssOs.#   #..O...O...O..#
 7 #s#,#s#,#s#,#s#   #.#,#.#,#.#,#s#   #.#,#.#,#.#,#.#
 8 #sssssssssssss#   #ssss,ssssssss#   #..,,,,,,,,,..#
 9 #s#s#s#s#s#s#s#   #s#s#.#s#s#s#.#   #.#.#.#,#.#.#.#
10 #sssssssssssss#   #s.sss,sssssss#   #..,,,,,,,,,..#
11 #s#,#s#,#s#,#s#   #.#,#s#,#.#,#s#   #.#,#.#,#.#,#.#
12 #.sOsssOsssOs.#   #.sOsssOsssOs.#   #..O...O...O..#
13 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
14 #4..sssssss..2#   #4..sssss.s..2#   #4...........2#
15 ###############   ###############   ###############

stage 3  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=True T/B=True rot180=True soft full=20 round1=20
    123456789ABCDEF     123456789ABCDEF
 3 ###.#######.###   ###.#######.###   ###.#######.###
 4 #1...........3#   #1...........3#   #1...........3#
 5 #.#.###.###.#.#   #.#.###.###.#.#   #.#.###.###.#.#
 6 #.#.........#.#   #.#.........#.#   #.#.........#.#
 7 #.#.#s###s#.#.#   #.#.#s###s#.#.#   #.#.#.###.#.#.#
 8 #.#.#sssss#.#.#   #.#.#sssss#.#.#   #.#.#.....#.#.#
 9 #.#sss###sss#.#   #.#sss###sss#.#   #.#...###...#.#
10 #.#.#sssss#.#.#   #.#.#sssss#.#.#   #.#.#.....#.#.#
11 #.#.#s###s#.#.#   #.#.#s###s#.#.#   #.#.#.###.#.#.#
12 #.#.........#.#   #.#.........#.#   #.#.........#.#
13 #.#.###.###.#.#   #.#.###.###.#.#   #.#.###.###.#.#
14 #4...........2#   #4...........2#   #4...........2#
15 ###.#######.###   ###.#######.###   ###.#######.###

stage 4  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=True T/B=True rot180=True soft full=36 round1=36
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #ssss.....ssss#   #ssss.....ssss#   #.............#
 5 #s#s#.#.#.#s#s#   #s#s#.#.#.#s#s#   #.#.#.#.#.#.#.#
 6 #ssfffffffffss#   #ssfffffffffss#   #..fffffffff..#
 7 #.#f#.#s#.#f#.#   #.#f#.#s#.#f#.#   #.#f#.#.#.#f#.#
 8 #..f.1...3.f..#   #..f.1...3.f..#   #..f.1...3.f..#
 9 #s#f#.#.#.#f#s#   #s#f#.#.#.#f#s#   #.#f#.#.#.#f#.#
10 #..f.4...2.f..#   #..f.4...2.f..#   #..f.4...2.f..#
11 #.#f#.#s#.#f#.#   #.#f#.#s#.#f#.#   #.#f#.#.#.#f#.#
12 #ssfffffffffss#   #ssfffffffffss#   #..fffffffff..#
13 #s#s#.#.#.#s#s#   #s#s#.#.#.#s#s#   #.#.#.#.#.#.#.#
14 #ssss.....ssss#   #ssss.....ssss#   #.............#
15 ###############   ###############   ###############

stage 5  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=True T/B=True rot180=True soft full=93 round1=63
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1..sssssss..3#   #1..s..*s....3#   #1.....*.....3#
 5 #.#s#s#s#s#s#.#   #.#s#.#.#s#s#.#   #.#.#.#.#.#.#.#
 6 #.sssssssssss.#   #.sss.ssss.*..#   #..*.......*..#
 7 #s#s#s#s#s#s#s#   #s#s#s#s#s#s#s#   #.#.#.#.#.#.#.#
 8 #sssssssssssss#   #sss.ssss*.s.s#   #....*...*....#
 9 #s#s#s#s#s#s#s#   #.#s#.#s#s#s#.#   #.#.#.#*#.#.#.#
10 #sssssssssssss#   #sssssss.*.sss#   #....*...*....#
11 #s#s#s#s#s#s#s#   #.#s#s#.#s#s#s#   #.#.#.#.#.#.#.#
12 #.sssssssssss.#   #.sss..ss.s*s.#   #..*.......*..#
13 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
14 #4..sssssss..2#   #4..ss.s..s..2#   #4.....*.....2#
15 ###############   ###############   ###############

stage 6  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=True T/B=True rot180=True soft full=69 round1=69
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1....sss....3#   #1....sss....3#   #1...........3#
 5 #.#.#s#s#s#.#.#   #.#.#s#s#s#.#.#   #.#.#.#.#.#.#.#
 6 #..TsssssssT..#   #..TsssssssT..#   #..T.......T..#
 7 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
 8 #sssssssssssss#   #sssssssssssss#   #.............#
 9 #s#s#s#s#s#s#s#   #s#s#s#s#s#s#s#   #.#.#.#.#.#.#.#
10 #sssssssssssss#   #sssssssssssss#   #.............#
11 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
12 #..TsssssssT..#   #..TsssssssT..#   #..T.......T..#
13 #.#.#s#s#s#.#.#   #.#.#s#s#s#.#.#   #.#.#.#.#.#.#.#
14 #4....sss....2#   #4....sss....2#   #4...........2#
15 ###############   ###############   ###############

stage 7  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=True T/B=False rot180=False soft full=1 round1=1
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1...........3#   #1...........3#   #1...........3#
 5 #.#####.#####.#   #.#####.#####.#   #.#####.#####.#
 6 #.#.........#.#   #.#.........#.#   #.#.........#.#
 7 #.#.#######.#.#   #.#.#######.#.#   #.#.#######.#.#
 8 #.#.#..s..#.#.#   #.#.#..s..#.#.#   #.#.#..s..#.#.#
 9 #.P...#P#...P.#   #.P...#P#...P.#   #.P...#P#...P.#
10 #.#.#.....#.#.#   #.#.#.....#.#.#   #.#.#.....#.#.#
11 #.#.#######.#.#   #.#.#######.#.#   #.#.#######.#.#
12 #.#.........#.#   #.#.........#.#   #.#.........#.#
13 #.#####.#####.#   #.#####.#####.#   #.#####.#####.#
14 #4...........2#   #4...........2#   #4...........2#
15 ###############   ###############   ###############

stage 8  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=False T/B=False rot180=False soft full=30 round1=30
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1...........3#   #1...........3#   #1...........3#
 5 #.#s#s#.#s#s#.#   #.#s#s#.#s#s#.#   #.#.#.#.#.#.#.#
 6 #..>>>>>>>>v..#   #..>>>>>>>>v..#   #..>>>>>>>>v..#
 7 #.#^#s#.#s#v#.#   #.#^#s#.#s#v#.#   #.#^#.#.#.#v#.#
 8 #.s^sssDsssvs.#   #.s^sssDsssvs.#   #..^...D...v..#
 9 #.#^#s#.#s#v#.#   #.#^#s#.#s#v#.#   #.#^#.#.#.#v#.#
10 #.s^sssSsssvs.#   #.s^sssSsssvs.#   #..^...S...v..#
11 #.#^#s#.#s#v#.#   #.#^#s#.#s#v#.#   #.#^#.#.#.#v#.#
12 #..^<<<<<<<<..#   #..^<<<<<<<<..#   #..^<<<<<<<<..#
13 #.#s#s#.#s#s#.#   #.#s#s#.#s#s#.#   #.#.#.#.#.#.#.#
14 #4...........2#   #4...........2#   #4...........2#
15 ###############   ###############   ###############

stage 9  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=False T/B=False rot180=False soft full=93 round1=85
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1..sssssss..3#   #1..sss.sss..3#   #1...........3#
 5 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
 6 #.sssssssssss.#   #.ssssssss.ss.#   #..R.......V..#
 7 #s#s#s#s#s#s#s#   #s#s#s#s#s#s#s#   #.#.#.#.#.#.#.#
 8 #sssssssssssss#   #sssssssss.sss#   #....U...U....#
 9 #s#s#s#s#s#s#s#   #.#s#.#s#s#s#.#   #.#.#.#.#.#.#.#
10 #sssssssssssss#   #sssssss.s.sss#   #....V...V....#
11 #s#s#s#s#s#s#s#   #s#s#s#s#s#s#s#   #.#.#.#.#.#.#.#
12 #.sssssssssss.#   #.sssssssssss.#   #..U.......L..#
13 #.#s#s#s#s#s#.#   #.#s#s#s#s#s#.#   #.#.#.#.#.#.#.#
14 #4..sssssss..2#   #4..sssssss..2#   #4...........2#
15 ###############   ###############   ###############

stage 10  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=False T/B=False rot180=False soft full=57 round1=57
    123456789ABCDEF     123456789ABCDEF
 3 ###############   ###############   ###############
 4 #1..#sssss#..3#   #1..#sssss#..3#   #1..#.....#..3#
 5 #.###s###s###.#   #.###s###s###.#   #.###.###.###.#
 6 #.#ssss.sss#s.#   #.#ssss.sss#s.#   #.#........#..#
 7 #s###s#s#s###s#   #s###s#s#s###s#   #.###.#.#.###.#
 8 #ss#ss#ss#ss#s#   #ss#ss#ss#ss#s#   #..#..#..#..#.#
 9 ###.###.###.###   ###.###.###.###   ###.###.###.###
10 #s#ss#ss#ss#ss#   #s#ss#ss#ss#ss#   #.#..#..#..#..#
11 #s###s#s#s###s#   #s###s#s#s###s#   #.###.#.#.###.#
12 #..#sss.ssss#.#   #..#sss.ssss#.#   #..#........#.#
13 #.###s###s###.#   #.###s###s###.#   #.###.###.###.#
14 #4..#sssss#..2#   #4..#sssss#..2#   #4..#.....#..2#
15 ###############   ###############   ###############

```
Hard-block lattice: stages 1,2,4,5,6,8,9 use the classic pillars at odd cx 3..13 × odd cy
5..13 (stage 4/6/8 keep the lattice but leave some cells open). Stages 3, 7, 10 have
hand-drawn hard layouts. Mirror symmetry L/R and T/B: stages 1–6; stage 7 only L/R (the
permanent block); 8 (conveyor direction), 9 (arrows) and 10 (layout) are not symmetric
(stage 9's arrow set is 180°-rotation-like, stage 10's rows 6/12 and 8/10 are shifted).

## Gimmicks

### Stage 1 — plain. 12 random soft removals.

### Stage 2 — ice ($1A=1)
- **Ice movement** (`C0C09E`, verified): speed level forced to 1 every tick; input
  accelerates the pressed axis by 0.25 px/tick² (table `$C5FB33`), v += a then x += v (first
  tick 0.25), capped at 2.0 px/tick (`C0C0E8`); **no friction** — releasing keeps sliding at
  the current speed until a collision stops it. Opposite input decelerates 0.25/tick to 0
  then accelerates the other way. A perpendicular input zeroes the other axis at once (the
  collision handler of the new direction clears it) and the normal corner slide (1.25 px/tick)
  applies while aligning.
- **Push soft blocks** (`C0ACD4`, only `$1A==1`, verified): when a player is blocked on both
  front corners by a soft block ($C2) that is not burning (`C0AC6E`), and the cell beyond is
  not an object cell (bit6) or is an item ($44) and no bomber stands there (`C0AC8D`), the block
  becomes a sliding object moving 2.0 px/tick in the push direction until blocked, then turns
  back into $C2 there (CPUs push too).
- **Holes** at (4,6),(8,6),(12,6),(4,12),(8,12),(12,12) (`C04468` chain, verified for (4,6)):
  entering the cell (centre point) snaps the player to the cell centre, ~12 ticks "fall"
  animation, then a vertical launch: vy = 8 px/tick decelerating 0.5/tick², up to ~y=$12
  (off the top of the field), then falls (accel 1/16) and lands on the cell one row below the
  hole ((4,7) for (4,6); one row up if that cell is solid/object). Total 91 ticks from entry
  to control (tick 31→122). Player has no control meanwhile.
- 16 random removals.

### Stage 3 — water/beach ($1A=2)
- **Tunnels** (`C04DE1`, `C050E0`, verified): the border gaps at cx 4 and 12 link top and
  bottom. Walking up out through (4,3) (when y reaches $18) teleports to y=$EF (row 16) and
  the player auto-walks up into (4,15) at its speed (2 if speed 0) with input forced; the
  exit cell is marked $FB (solid) during transit; only one player per tunnel (`$5D04` bits
  0–1 for cx 4, 2–3 for cx 12); blocked if a bomber stands on the exit cells. Transit
  6 ticks, then the player stood still ~11 ticks before moving on (measured).
- **Bombers are solid to each other** (`C069D8` pair checks |dx|<13, |dy|<15; resolution
  `C06A45`): a walking bomber pushes a standing one; both move at 0.5 px/tick (verified with
  4 humans: P1 pushing P3).
- No random removal (20 fixed soft blocks).

### Stage 4 — fuse ring ($1A=5), central spawns
- 28 fuse cells ($0E, list `$C5E55C`) form the ring cx 4..12 × cy 6..12. When a bomb's fire
  is written on any cell whose underlay is $0E (`C0E8F8`), the ring ignites if idle
  (`$5CE2` < 0): **all 28 cells become fire on the next tick**, the ring fire runs 11
  phases × 3 ticks (`C03A92`, timer `$5CE4`=3) — measured fire ticks 175→204 (30 ticks) —
  and then re-arms (cells revert to $0E; only the BG turns grey). Bombers on the ring die;
  bombs on it chain. A second fuse id (`$5CDE`) exists for $0E cells outside the list (none
  in battle).
- Spawns in the centre (see above). No random removal.

### Stage 5 — power tiles ($1A=6)
- 11 tiles $14 at (8,4),(4,6),(12,6),(6,8),(10,8),(8,9),(6,10),(10,10),(4,12),(12,12),(8,14)
  (list built once into `$7E2FF0` by `C03761`). A bomb placed on one gets range 9 (fire
  reaches 10 cells, i.e. the whole row/column until blocked) (`C03583`, verified). Tiles are
  under soft blocks at round start where the ROM map has soft.
- 30 random removals. Graphics toggle every 160 ticks (cosmetic).

### Stage 6 — teleporters ($1A=7)
- 4 teleporters $50 at (4,6),(12,6),(4,12),(12,12) (`C04D33`, verified (4,6)→(12,12)). When
  a bomber's centre enters one, it is moved to the centre of the partner pad with the same
  BG tile (colour): (4,6)↔(12,12), (12,6)↔(4,12) (tables `$C5E881` tiles, `$C5E8B1`
  destinations). Not if the destination holds a bomb ($43) or a bomber (`C10456`). Flag +04 b4
  blocks re-teleporting until the player leaves the pad; movement continues the same tick.
- No random removal.

### Stage 7 — race track ($1A=8)
- Speed pads $0F at (3,9),(8,9),(13,9) (`C04C66`, verified). Entering a pad sets speed level
  +F0 and its base +E0 from the pad tile (`$C5E859`): $1C28→9 (0.375 px/tick), $1C2A→7
  (0.8125), $1C2C→1 (1.25), $1C2E→6 (3.0), $1C48→10 (3.5), $1C4A (the centre pad) → stop:
  input locked for 128 ticks (+CE, `C06321`). After a non-stop pad is used its tile is re-rolled
  from `$C5E871[(RNG $0400 & $E)/2]` = {1C28,1C2A,1C2C,1C2E,1C48,1C48,1C2E,1C2C}. Round
  start: (3,9) and (13,9) = $1C2C (normal), (8,9) = $1C4A (stop). Retrigger needs leaving the
  pad (+0E bits 2–3).
- One permanent soft block at (8,8) (underlay $C2; blocks fire, never yields an item).
  No items appear on this stage (none seen in 4000 CPU frames).

### Stage 8 — conveyor ring ($1A=9)
- Ring of $17..$1E cells: row 6 cx 4..12, column 12 cy 6..12, row 12, column 4 (clockwise by
  default: top →, right ↓, bottom ←, left ↑; corners push in the outgoing direction). A
  bomber standing on it is carried at **0.5625 px/tick** (+20/22 = $0000.8FFF) — verified per
  tick; bombs are carried too (as moving objects, ≈0.56 px/tick).
- Switches (verified): stepping onto (8,8) ($12) toggles the direction (`$5CBE` b1 →
  counter-clockwise, −0.5625); stepping onto (8,10) ($13) toggles fast mode (`$5CBE` b0 →
  2.3125 px/tick = $0002.4FFF). Latched per player until it leaves the switch (+02 b8);
  switch tile animates every 4/5 ticks (`C040EF`/`C04086`).
- No random removal.

### Stage 9 — arrows ($1A=$A)
- Arrow cells (underlay): (2,4) V, (14,4) L, (4,6) R, (12,6) V, (6,8) U, (10,8) U, (6,10) V,
  (10,10) V, (4,12) U, (12,12) L, (2,14) R, (14,14) U. They do nothing to bombers; a moving
  (kicked) bomb entering one is redirected (`C10F81`, code): $3C up, $3D down, $3E right,
  $3F left, at 2 px/tick, once per cell (+C0 b0), if the next cell is free (`C19BFB`).
  (Not measured — needs a kick.)
- `C06567` handles cell $55 (random teleport among `$C5E6C6`), never seen in battle.
- 8 random removals.

### Stage 10 — forest, jumping ($1A=$B)
- **Y button = jump** (`C06616`→`C068B6`/`C06658`, verified): the bomber hops one cell
  (16 px) in its facing direction over 32 ticks (forward 0.5 px/tick; visual arc up ~30 px
  with vy ≈3 decelerating), no control meanwhile. Into a hard/soft block: no move. Onto a
  bomb cell: lands on it and slides one more cell (measured: (2,4)→(4,4) over a bomb at (3,4)).
- Hand-drawn hard layout, 57 fixed soft blocks, no random removal.

## Notes for a taller arena (same 13 columns, more rows)
- Lattice stages (1,2,5,6,8,9): continue the pillar pattern (odd cx × odd cy); keep the
  spawn L-shapes in the four corners (spawn + 2 cells along the end wall + 2 along the side,
  stage 6 a bigger clear corner: rows 4–7 per map); fill the new middle rows like rows 7–11
  (rows of soft between pillar rows, side columns soft). Scale the random-removal count N
  by the soft-block count (stage1 12/93, stage2 16/81, stage5 30/93, stage9 8/93).
- Stage 2: repeat the hole rows (holes at cx 4,8,12 every 6 rows) keeping T/B symmetry.
- Stage 3: tunnels stay at cx 4/12 on the top/bottom border; extend the hard frame columns
  (cx 3 and 13) and the central water band.
- Stage 4: keep central spawns; the fuse ring can be stretched vertically (one loop).
- Stage 5: power tiles on the diamond pattern (every 2 rows on cx 6/10, cx 4/12 every 6, cx 8).
- Stage 6: teleporters stay at the 4 corners of the inner area (cx 4/12, 2 rows from the ends).
- Stage 7: track rings are a fixed drawing; add straight segments vertically, pads on the
  middle row.
- Stage 8: stretch the conveyor ring vertically; switches stay on cx 8 straddling the middle.
- Stage 9: keep the corner loop (V on the left column top, R bottom-left, U right column bottom,
  L top-right) and the inner rotation-symmetric arrow set.
- Stage 10: irregular; repeat the rows-6..12 block pattern.
