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
| +FA | (byte) bomb-pass? (lets player walk over bombs) | `C0AF65`, `C10169` |
| +FB | (byte) **wall-pass** (soft blocks $C2 become passable $40) | `C0BEA6` |
| +FF | (byte) **kick** ability | `C0AFAF` |

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
