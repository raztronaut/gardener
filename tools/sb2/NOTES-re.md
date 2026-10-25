# NOTES — phase 2b: battle-rule reverse engineering (RAM map, routines)

Work in progress; numbers here are MEASURED in the harness or READ from the 65816
code (stated per item). The distilled, implementable rules go to `SPEC.md`.
All WRAM addresses are CPU addresses ($7E:xxxx / $7F:xxxx). ROM is **HiROM**
(header $FFC0 "SUPER BOMBERMAN2", map mode $31 = HiROM/FastROM, 1 MiB; reset
$00:FA00, NMI $00:FD83): ROM offset = ((bank & $3F) << 16) | addr.

## Tools (tools/sb2/re/)

| file | what |
|---|---|
| `hooks.py` | ctypes wrapper for the shim's exec/read/write hooks (see below) |
| `dis65816.py` | 65816 disassembler; `--func PC` = recursive routine listing, `--range lo hi` |
| `coverage.py` | records executed ROM bytes + their M/X flags → `data/sb2/re/exec_mx.npy` (used by the disassembler to size immediates) |
| `xref.py` | callers (JSL/JSR/JMP/JML) into an address range |
| `sb2lib.py` | RAM-map constants + `Game` helper (load state, peek/poke, grid, players) |
| `disall.py` | listing of every executed ROM range → `data/sb2/re/dis/all.txt` |
| `vectors.py` | test-vector generator/verifier → `data/sb2/vectors/*.json` (format in its header) |
| `analyze_vectors.py` | summaries of vectors used for SPEC numbers |
| `ai_*.py`, `round_*.py`, `stages_*.py` | sub-task scripts (see notes-ai/round/stages.md) |

### Harness hooks (added to `harness/sb2_shim.cpp`, call sites in `harness/snes9x-sb2-hooks.patch`)
Three guarded call sites in snes9x (before every opcode in `S9xMainLoop`; fast-path
WRAM byte/word reads and writes in `getset.h`). With flags = 0 (default) the core is
unchanged: selftest ALL OK, determinism hashes identical to phase 1
(`0047482f9ff2e05e`), and a 600-frame battle with all hooks on ends with the same
WRAM as without. Exports: `retro_sb2_hook_set_flags(bits)` (1 exec counts + M/X
map per ROM byte, 2 write watch, 4 read watch, 8 exec trace with registers),
`retro_sb2_hook_watch(kind, lo, hi, on)`, `retro_sb2_hook_log(kind, &ptr, &dropped)`
(16-byte events: pc, wram offset, value, old value, frame tag),
`retro_sb2_hook_trace_config(lo_pc, hi_pc, capacity)`, `retro_sb2_hook_trace()`,
`retro_sb2_hook_exec_counts(0 rom | 1 wram | 2 mx)`, `retro_sb2_hook_set_tag(t)`.
build.sh now also resets/applies `cpuexec.cpp getset.h` and installs the .so by
copy+rename (a running process keeps its mapping).

## Frame structure

- Main loop `C0FB11`: waits until the NMI counter `$0036` changes, then runs one
  game tick: `C00C36, C00000, C01602 (input), C0D8E8, C10C3C, C0D843, C036E6,
  C01E1D (players), C10CAF, C0DCB4 (burning soft blocks, every 2nd tick), C0E0AA,
  C0E076, C0DA42, C00617, C005EA, C1334B, C09615, C11C1A, C10971, C00CAA, C00A38`.
- `$0032` = logic tick counter (+1 per executed tick). **Lag frames exist**: when a
  tick overruns the frame, the next NMI is missed and the game skips a video frame
  (seen e.g. ~1 in 10–40 frames while CPUs think). Rules below are per *tick*;
  vectors record `$0032` so a port can align ticks to frames.
- `$001A` = battle stage id: stages 1..10 (select order) = 0,1,2,5,6,7,8,9,$A,$B.
  `$00B9` bit 15 = battle mode (normal game has it clear).

## Arena grid (bank $7F)

- **`$7FC000`**: collision grid, one **word** per cell, **64 cells × 32 rows**, row stride
  $80 bytes: index = cy*$80 + cx*2. The battle arena occupies cols 1..15, rows 3..15
  (border ring = $C6), inner play field **cols 2..14 × rows 4..14 = 13×11**; everything
  outside is $C5. Measured in battle_start.
- `$7FD000`: underlay grid (same layout): what a cell reverts to when a bomb/fire/item
  leaves it (`C0DDF7` copies D000→C000 and clears $7F8000).
- `$7F8000`: per-cell word cleared alongside (AI/danger or owner data; TBD).
- `$7FA000` / `$7FB000`: BG tile words per 16×16 cell (current / underlay), index in
  "tile" space (`C0A515`: ((y+$5EFB)&$1F0)<<2 + ((x+$5F01)&$1F0)>>3).
- Cell byte (low byte; high byte 0): bit7 = solid, bit6 = "object", bits0-5 = type.
  Seen: `$00` floor, `$C2` soft block, `$C5` hard block / outside, `$C6` border wall,
  `$43` bomb (type 3), `$44` item (type 4; also used while a soft block's item is
  revealed), `$01` fire, `$41` (type 1|$40, flame/aux — TBD), `$40` = soft block
  treated as passable for a player with wall-pass (`+$FB`).
- Pixel → cell: **cx = (x + $5F01) >> 4, cy = (y + $5EFB) >> 4** with `$5F01 = 8`,
  `$5EFB = $17` on all 10 stages (`C0BFE2`). A player centred in cell (cx,cy) has
  x = 16cx, y = 16cy − 16. (Arena-pixel convention used in SPEC: left = x,
  top = y + 16; cell (cx,cy) spans [16cx, 16cx+15].)

## Objects

- `$7E8000 + $100*i`: object slots ($7E8000–$7EBFFF cleared at round init by `C01ED5`).
  Players are slots 0..3 = P1 white, P2 black, P3 red, P4 blue (HUD order).
- `$7E2620`: list of active "bomber" object pointers (words, $FFFF-terminated;
  `8000 8100 8200 8300` at round start). `C01E1D` iterates it each tick and runs the
  per-player pipeline (below). Entries ≥ $8400 are other mobile objects that block
  players (`C0AB0F`).

### Generic object fields (word unless noted)
| off | meaning | evidence |
|---|---|---|
| +00 | flags: b15 active, b0 X velocity negative, b1 Y velocity negative, b11 … | `C0A3E0` / `C0A39F` |
| +02, +04 | more flags (+04 b5 = dying/locked?) | |
| +06 | slot index (players 0..3) | dump |
| +0C | animation timer (counts down), +0E anim flags | `C0A120` |
| **+10** | **X pixel** (int), **+12** X fraction (1/65536) | `C0A3E0` adds +14:+16 |
| +14 / +16 | X speed int / frac (magnitude; sign in +00 b0) | |
| **+18** | **Y pixel**, **+1A** Y fraction | `C0A39F` |
| +1C / +1E | Y speed int / frac | |
| +20/22, +24/26, +2C/2E, +30/32, +34/36, +3C/3E | accel / decel / max-speed pairs (generic physics `C0A2B8`, `C0C34D`) | |
| +38 | grid index of the object | `C0DDB2` |

### Player-specific fields
| off | meaning | evidence |
|---|---|---|
| +6E | joypad bits this tick (SNES order: $8000 B, $4000 Y, $2000 Sel, $1000 St, $0800 Up, $0400 Down, $0200 Left, $0100 Right, $0080 A, $0040 X, $0020 L, $0010 R) | `C0C2CE` |
| +7E | high byte ≠ 0 → player not controllable (dead/winning…) | `C01E5A` |
| +A0/+A2 | current speed (int/frac), copied from speed table | `C0C290` |
| +A8 | grid index of the player's cell | `C0BEF8` |
| +AA | tile index of the player's cell | `C0A4F7` |
| +B0/+B1 | probe cells (front-lower / front-upper corner) | `C0BEFE` / `C0BF37` |
| +B4 | cell type under the player centre (byte) | `C0BEA6` |
| +B5 | cell type in front (byte) | `C0AE99` |
| +F0 | **speed level** (byte) → speed table `$C5FB07` | `C0C290` |
| +E0/+E1/+E2 | base speed level / bomb capacity / fire | item handlers |
| +E4..+E9 | item counters (fire-ups, pierce, remote, power, rubber, skulls) | item handlers |
| +EF | shield (heart) count | `C0A644`, `C09C5B` |
| +F1 / +F8 | bombs in hand / bombs out | `C03118`, `C0E46C` |
| +F2 | current fire (reach = +F2 + 1) | `C03583` |
| +F3 | bomb type (1 remote, 2 power, 4 pierce, 8 rubber) | `C034E5` |
| +F5 | disease id 0..6 | `C099DF` |
| +F6 | bomb serial counter | `C03545` |
| +FA | (byte) bomb-pass | `C0AF65`, `C10169`, `C099C5` |
| +FB | (byte) **wall-pass** (soft blocks $C2 become passable $40) | `C0BEA6` |
| +FE | (byte) **glove** | `C030E3`, `C09BF6` |
| +FF | (byte) **kick** ability | `C0AFAF`, `C09BA8` |
| +52 | action state (1 dying anim, 3 lifting, 6 carrying, $81 stunned, $0801 dying) | |
| +5E | facing (2 R, 4 L, 8 D, $10 U) | `C0AE5F` |

Speed table `$C5FB07` (4 bytes per level: int word, frac word), read from ROM:
0: 0.5, **1: 1.25 (start)**, 2: 1.5, 3: 2.0, 4: 2.5, 5: 2.75, 6: 3.0, 7: 0.8125,
8: 0, 9: 0.375, 10: 3.5 (px per tick). Measured: P1 at level 1 moves +1,+1,+1,+2 px
per tick (1.25).

## Per-player pipeline (`C01E1D`, once per tick per bomber, if `$30 & $0F == $0F`)
`C0A4F7` (cell lookup) → if `+7E` hi = 0: `C0C54B` (CPU AI, only COM) , `C022E2`,
`C03686` → `C04337, C065F1, C05741, C0A474 (movement), C08230, C02945` → `C0224A,
C0A146 (position clamp/visibility), C0A120 (anim), C09C7B`.

### Movement (`C0A474`)
1. `C0C055` saves old X/Y (+frac) to `$5C2A..$5C30`.
2. `C0C2CE` sets speed from input: Up/Down → Y speed = +A0/+A2, Left/Right → X speed
   (direction bits in +00 b0/b1).
3. `C0A2B8`/`C0A380` integrate (16.16 fixed point).
4. `C0A98E` collision: dispatches on the move direction (R=$100, L=$200, D=$400,
   U=$800, from velocity, else from input) through the table at `$C0AC0B`
   (R `C0AED4`, L `C0B2DE`, D `C0B40C`, U `C0B854`, R+D `C0B62D`, L+D `C0B6A8`,
   R+U `C0B723`, L+U `C0B79E`, others no-op).
   Right handler `C0AED4` (others mirror it):
   - zero the perpendicular velocity (`C08D52`);
   - other mobile objects within |dy|<8, 0<dx<15 → undo the X move (`C0AB0F`);
   - probe the cell at (x+7, y) = front centre (`C0AE99` → `$5C02`, `+B5`);
   - bomb rules (type 3): standing on a bomb (`+B4`) lets you walk off it (`C10169`);
     a bomb in front stops you, kicks it if `+FF` (`C0AFAF`);
   - probe corners (x+7, y+8) → `+B0` and (x+7, y−7) → `+B1`;
   - **both solid** (bit7): `C0B252` walks X back 1 px at a time until (x+7, y) is
     not solid, stops the player (`C0AF76`) [and on stage 2 tries to push the block,
     `C0ACD4`];
   - **one solid** → `C0BBCD` corner slide: if the front centre is solid the X move is
     undone; the player moves perpendicular, away from the solid corner, by its full
     speed (from the saved Y), then is walked back 1 px at a time while the leading
     corner on that side is solid; a bomb there stops the slide;
   - neither → free move.
   Probe offsets for the other directions: left x−8, up y−7, down y+8, corners at
   ±(7|8) on the other axis → the player's solid box is **[x−8, x+7] × [y−7, y+8]**
   (16×16).
   Measured (`battle_start`, soft blocks cleared, P1 at cell (2,5) to the left of the
   pillar (3,5), holding RIGHT, Y offset −8..+8): any non-zero offset slides
   1.25 px/tick toward the free row while X waits until the front-centre probe leaves
   the pillar row; offset 0 = stuck. Matches the code.

## Tick counter / lag (NMI `00FD84`)
NMI: if the main loop has finished its tick (`$16 != 0`) → `INC $32`, OAM/VRAM DMA;
else (tick still running) nothing is uploaded and `$32` is not incremented = lag frame.
Every executed tick is counted exactly once, at the first NMI after it completes.
`$36` increments every NMI.

## RNG (`C00CDF`, seed `$00D6`)
seed' = ((seed | 1) × $0383) mod 65536; result = (seed' × (X & $FF)) >> 16 (X = range
argument). `C00CAA` (called once per tick at the end of the main loop `C0FB85`, plus
extra calls from the CPU AI `C0D45C`, soft-block item shuffling `C01D2D`, `C0F560`)
calls it with X = old seed, stores the result at `$0400` and at `$0400 + ($32 & $1E)`,
and in player slot `$5C3A>>8` field `+BA` (slots rotate 0..3, one per tick).
Measured over 3000 battle frames: 2794 frames one step, 80 frames two (AI), rest
lag-alignment.

## Bombs (objects at `$7F2000 + $100*k`, k < 40; active list `$7E2960`, $FFFF-terminated)
Placement (`C03082`, per player per tick): bomb button = **SNES A** (+6E bit $0080),
edge-triggered (latch +0E bit $0400). Fails if: cell under the player centre is an
object cell (+B4 bit6) [with glove +FE and a bomb there → pick it up instead,
`C02F6E`]; cell type is fire ($01) or $11 (`C031EB`); a bomb already uses this tile;
a blocking object stands there (`C0319A`); +F1 (bombs in hand) = 0. Then +F1 −= 1,
+F8 (bombs out) += 1, spawn `C034C0`:
| off | value |
|---|---|
| +00 | $8000 \| bomb type (player +F3; bit1 type only if no other bomb out) — b0 remote (no countdown), b1 power (range 9), b2 pierce (fire passes soft blocks), b5 …, b11 …, b12 held/kicked (no ticking), b14 exploding, b15 active |
| +02 | tile index, +0A grid index (cell set to $43) |
| +04 | fuse = $48 (72 bomb updates) |
| +05 | per-player bomb serial (+F6) |
| +06 | owner slot 0..3 |
| +07 | range = player +F2 (fire reaches +07+1 cells); 9 on stage 5 special tiles (list `$7E2FF0`) |
| +08/+09 | timer / anim phase |
| +0C | (owner+1)*4 (palette) |
| +10.. | 4 rays × (range+1) × 6-byte entries (tile, grid, piece) up/down/left/right at +10/+4C/+88/+C4, $FFFF = cut |
Danger marks: `$7F8000[cell] = $FFFF` along the rays (for the AI).

### Bomb update (`C0E0AA`, only on **even ticks** (`$32 & 1 == 0`), list order)
For each bomb: exploding (b14) → `C0E0F0`; else `C0E980`:
- held/kicked (b12) → skip;
- **its cell is fire ($01) → detonate now** (chain);
- remote (b0) and not forced (b7) → no countdown; else +04 −= 1, 0 → detonate.
- **After a detonation the loop stops for this update** (later bombs in the list are
  not updated this tick) → at most one new detonation per bomb update (2 ticks).
Measured: bomb placed on tick 18 (even) detonated on tick 162 = **144 ticks** (72
updates, the first in the placement tick).

### Detonation (`C0EA83` → rays `C0EAA7/C0EB8E/C0EC68/C0ED42`)
Each ray walks its (range+1) cells: type $0F/$09 pass; bomb (3) → trigger it
(`C0EFD3`: its flags |= $C0, its fuse := 2, and its ray pointing back is cut) and stop;
soft (2)/item (4)/$0B → queue the cell in the burn list `$7F0000` (16-byte entries) and
stop (pierce bombs continue); solid or types $26/$04/$0B stop; anything else = fire.
The cut point is stored as $FFFF in the ray.

### Explosion (`C0E0F0`, per even tick)
Phase table `$C5F415` = 13 × 1 update then $FF. On each of the 13 updates after the
detonation update, the centre and every ray cell are (re)written as fire `$01` + flame
tile. On the 14th update the cells are restored from the underlay (`C0E14F`) and the
bomb freed (`C0E303`). Measured: cell (2,4) = $01 from frame 153 to 178, back to $00
at 179 (detonation at 151) → fire present for **26 ticks**, starting **2 ticks** after
detonation.

## Death
`C0A5C9` (per player): cell under the centre (+B4 & $3F) = 1 (fire) → in battle, if
+EF ≠ 0 (protection counter) it is decremented and the player flickers (+04 b5,
+B9 = $C0); else `C0A675`: +00 |= $0800 (dying), +52 = $0801, +6A = $1E (death
animation). Measured: P1 standing on its own bomb dies on the first tick the fire is
written.

## Soft blocks, burn list, item deck
- Burn list `$7F0000` (32 × 16-byte entries: tile idx, grid idx, type 2 soft / 4 item,
  frame-time 3, owner palette) filled by `C0EF44` at detonation; processed on **odd
  ticks** by `C0DCB4` → `C0DCDA` (list of active entries rebuilt in `$7E2860`). Frame
  lists `$C5F3ED[type]`: soft 6 frames (`$00E0..$00EA`), item 7 frames; 3 calls (6
  ticks) per frame, first frame immediately → soft gone at D+37, item at D+43 (vectors
  bomb_softblocks, item_burn). While burning: soft cell stays `$C2`, item cell = `$41`.
- End of a soft-block burn → `C0DD76` → battle: `C0DE13` takes the next non-zero deck
  card from `$7E3C48` (64 words + $FFFF; card zeroed when used): `$8000` = nothing
  (`C0DDF7` restores floor), else item tile word → `$7FA000` tile, cell `$44`. Items
  burning (tile has bit 8 set) never draw.
- Deck build `C01CEA` at round init: 64 × `$8000`; per kind k (tile `$C5F205[k]`),
  `$C5F225[stage]` → count list; each card at `RNG() & 63` (retry if occupied; RNG via
  `C00CAA`). Kinds: 0 bomb up 1600, 1 pierce 1604, 2 fire up 1602, 3 full fire 1606,
  4 speed up 1622, 5 remote 160E, 6 skull 160A, 7 glove 1626, 8 kick 1624, 9 power 162A,
  10 rubber 1628, 11 heart 1640, 12 wall pass 1620, 13 bomb pass 1608, 14/15 score items.

## Item pickup (`C0986A`, per player)
Cell under centre type 4 → `C0980D` (cure disease, +E9 −1) → jump table `$C5F145`
indexed by tile low byte ×2: 00 `C098C2` bomb up (+E1 ≤ 9), 02 `C0991D` fire up
(+E2 ≤ 9, +E4), 04 `C09965` pierce (+F3 = 4), 06 `C09986` full fire (+E2 = 9),
08 `C099C5` bomb pass (+FA), 0A `C099DF` skull, 0E `C09B1D` remote (+F3 = 1),
20 `C09B3E` wall pass (+FB), 22 `C09B58` speed up (+E0 ≤ 5), 24 `C09BA8` kick (+FF),
26 `C09BF6` glove (+FE), 28 `C09C19` rubber (+F3 = 8), 2A `C09C3A` power (+F3 = 2),
40 `C09C5B` heart (+EF). All verified by the item_* vectors.
Base/current stats: +E0/+F0 speed, +E1 capacity (+F1 = in hand, +F8 = out),
+E2/+F2 fire, +F3 bomb type, +F5 disease, +E9 skull count.

## Diseases
- Skull `C099DF`: id = `$C5EEB5[$0400 & 15]` (stage id 8: `$C5EEC5`; with +EF:
  `$C5EED5`); id 3 → 2 if +04 b0 (COM). Applied via `C09B74`/`C001EE`: 1 blink
  (`C0362B`, +FC/+F9 schedule `$C5EE5D` toggling +04 b6 = sprite hidden), 2 auto-bomb
  (`C03055`, every 2nd tick), 3 no bombs, 4 speed 6, 5 speed 0, 6 fire 0 / 1 bomb.
- No timer (only writers of +F5: pickup cure, skull, death, swaps). Measured 4000 ticks.
- Contagion `C002AB`/`C00445`/`C0055A` (each pair once per contact, latch `$5C5E`):
  swap +F5 and +E9 when +A8 equal, then `C001EE` re-derives stats.

## Buttons (per player, `C02945` → `C03082` / `C02A7A` / `C029FD`)
A ($0080) bomb / lift (glove) / throw on release; B ($8000) remote detonation of the
oldest remote bomb (`C02B25` list sorted by serial +05, `C02AB5` sets fuse 2 + b7);
X ($0040) stop own kicked bomb (`C029FD` → `C08BDA`); Y ($4000) stage/AI action
(`C065F1`).

## Kick / throw objects
- Movers are allocated in `$7E8400..` (28 slots, `C02F1B`) and appended to the bomber
  list `$7E2620`. Kick (`C0AFAF`): mover +52 = $20, +40 = bomb ptr, +46 grid step,
  speed 2 px/tick, bomb +00 |= $1000 (bomb update skipped; the mover decrements the
  fuse every 2 ticks). Stops before an occupied cell (measured: before P4), becomes a
  bomb again (`C08BDA`). Rubber (type 8) re-aims via `$C5FC6D[$0408 & $1E]` (`C093A2`).
- Glove lift `C02F6E` (own bomb, fuse ≥ 4, +52 |= 3, 15-tick lift → +52 = 6), throw
  `C02CAF` on A release: mover +52 = $10 at the bomber's x, y−16; distance `C02DCF`
  (3 cells, or 2..5 to land on a bomber in line); 4 px/tick, arc; wraps around the
  arena; bounces 1 cell (2 px/tick) while the landing cell is occupied (measured:
  left from (2,4) → (14,4); up → off P4 at (2,14) → (2,13)).

## Round flow, stages, AI
See `re/notes-round.md` (clock `$5E10/12/14`, time-up `$5C56`, sudden death
`C0D843`/`C0D5BB`, order `$C5E1C9`, round end `C00A38`, winner `$5C3E`, wins
`$5E66+2·slot`, settings `$5C54..$5C5C`), `re/notes-stages.md`, `re/notes-ai.md`
(COM flag +04 b0, level `$7E1CA5`/`$5C58`/+D2, plans at `$0500+$100·slot`, danger map).

## Screen geometry (battle_start, measured)
HUD rows 0..24 (24 = black line); cell (cx,cy) at screen (16cx−8, 16cy−23); BG2 scroll
(8,22), BG1 (8,23); bomber sprite = two 16×16 OBJ at (x−8, y−24) and (x−8, y−8).
