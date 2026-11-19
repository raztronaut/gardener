# World: binary analysis, 2026-11-06

All addresses below are virtual PS1 RAM addresses for US SLUS-00680, executable
SHA-256 recorded in README. Values were checked against executable disassembly
and original-game execution, not borrowed from SB2.

## Reproducible experiment entry

`data/bw/harness/fight3.state` is a stage-1 live battle capture from the original
installed core. The isolated instrumented core loads it successfully. `probe.py`
compares 12 emulated frames from that same state, with idle/right/down/button
inputs. Idle versus idle-repeat produces identical RAM, frame and instruction
coverage totals. Early probe outputs used Cross as the bomb hypothesis; the later
button experiment established that Circle (libretro mask 256) actually places it.
Do not interpret Cross traces as bomb creation.

Captures leading into battle: `press3` title → `mode` main-mode submenu →
`battle-highlight` Battle Game selected → `setup-ready` Battle Royal selection →
`royal1` player setup → `players-confirmed` rules → `rules-confirmed` character
selection → `arena` stage selector → `fight0..4` match. Frame waits are important;
a black capture during loading is not proof of failure. Start confirms player
setup; both human controller ports need to confirm their characters.

## Grid

- Base `0x800cbc80`, uint16 little-endian, **2 layers × 30 rows × 64 columns**.
- Address: base + 2 * (layer * 1920 + row * 64 + column).
- `0x8001bab4`: validates unsigned-16 arguments: layer<2, row<30, column<64.
- `0x8001d354`: gets flags `cell & 0xff80`; invalid coordinates return `0x7f00`.
- `0x8001d8c0`: checks whether `cell & 0x7f` lies in `0x10..0x13`; invalid=0.
  The gameplay name for these four types remains unverified.
- Standard stage in the capture: enclosing border columns 1..15, rows 16..28;
  playable interior 13×11. Border type `0x7f`, fixed pillar type `0x76`, open
  floor type `0x01`, varying destructible/item-bearing cells around `0x60..0x75`.
  Exact meaning of each destructible subtype still needs observation.
- Source helpers already allow up to 30 rows. This is promising for a taller board,
  but merely changing map data does not fix camera, background, spawn or HUD logic.

## Players and position

Five records at `0x800cda98`, stride `0xdc` (loop at `0x8001cd54..68` verifies both).
Offsets relative to each record:

| Offset | Observed use |
| --- | --- |
| +0x4c | signed 16-bit world X, four fractional bits |
| +0x4e | signed 16-bit world Y, four fractional bits |
| +0x52 | column index |
| +0x54 | row index |
| +0x56 | layer index |
| +0x58,+0x5a,+0x5c | movement parameters, all 18 in this capture |
| +0x8c | available bomb capacity checked by creation routine |
| +0x92 | initial bomb fuse copied to new bomb, 150 in this capture |

`0x8001ba78` column center = signed16(column*320+160).
`0x8001ba9c` row center = signed16(row*256+128).
This is a 20×16 world-unit tile grid with four fractional coordinate bits.
These are world coordinates; the final projection/camera still needs decoding.

Controlled right input: player 1 X advances by 18 fixed units per update,
from 0x460 to 0x526 over 11 updates in 12 video frames. Store at `0x8001f1f0`
(`sh v0,0x4c(s0)`) is in a branch delay slot. Y alignment store is at
`0x8001ec68`; this was the reason the initial observer missed it.

## Bombs

- **Circle** (mask 256) places a bomb. Cross, Square and Triangle did not change
  the grid in the controlled 12-frame placement experiment.
- `0x80025058` creates a bomb; pool starts at `0x800cdee8`, **40 slots × 0x7c**.
  Free slot sentinel: signed halfword at +0x56 equals 10.
- In this state creation selected slot 3, address `0x800ce05c`.
- Bomb coordinates use +0x4c/+0x4e; fuse is unsigned16 at +0x6c.
- `0x8002528c` copies the player's +0x92 fuse to bomb +0x6c (150 observed).
- `0x8002504c` decrements a nonzero fuse by one; 150 initialization followed by
  149 in the same update, then 148,147,... on subsequent updates. This is not yet
  a complete explosion/chain-reaction timing specification.
- Placement changes grid cell (layer0,row17,col3) from 0x4001 to 0x3f81;
  grid store is `0x8001d4fc`. The low seven-bit floor type stays 1.

## Battle overlay and executable

`BIN/BAT_S.BIN` starts at RAM `0x800e3578` (first 256 bytes match exactly).
88497/88612 bytes match in fight3; mutated data must not be mistaken for code.
Movement, grid and bomb routines above are in the main executable, not this overlay.
`data/bw/battle-disassembly.txt` is a raw linear disassembly and includes DATA;
it is not a verified function listing. `executable-disassembly.txt` has the same
caveat. Use executed coverage and references to classify code.

## First conformance core

`core.mjs` translates five small original helpers, not the whole game.
`conformance.py` calls the actual MIPS functions through the isolated interpreter
and records outputs for boundaries, signed inputs and random map coordinates.
`conformance.mjs` compares JavaScript outputs: **1009/1009 match**.
Generated fixtures and RAM grid stay ignored in `data/bw/conformance`.

Next: complete collision/movement dispatch and bomb lifecycle, verify all stage
formats and sprite composition, then implement portrait rendering. The port is
still unfinished and has no live Arcade entry.

## First bomb cell lifecycle

200-frame watch from fight3, holding Circle: cell (0,17,3) becomes `0x3f81`
at frame 1. At frame 151 the bomb occupancy clears to `0x4001`, then the flame
bit produces `0xc001` in the same frame. At frame 174 it returns to `0x4001`.
This is one normal-bomb scenario, not yet a general specification for every
power-up, chain reaction or stage. Evidence: `data/bw/bomb-cell-lifecycle.json`.

Observer validation: `probe.py` repeats the idle scenario with tracing enabled
and disabled and asserts identical RAM/frame hashes. It also requires repeated
traced runs to have identical coverage totals. Re-run after modifying hooks.

## Movement and collision translation (continued 2026-11-08)

`movement.mjs` now translates the complete movement dispatch at **0x8001eef8**
and its immediate collision/alignment dependencies. `bombs.mjs` translates the
normal/remote fuse updater at **0x80024f98**. These operate on a private RAM
DataView; they are not integrated into the wall or a playable browser game yet.

Original functions covered:

| Address | Translation |
| --- | --- |
| `0x8001c120` | Cell admission by actor mask, including type-4 layer redirection |
| `0x8001c0a4` | Signed fixed-point position → column/row/layer |
| `0x8001bd10`, `0x8001bd44` | Integer-unit center errors |
| `0x8001c268` | Directional actor contact and position correction |
| `0x8001c4bc` | Bomb contact, including the owner exemption table |
| `0x8001c61c` | Special-floor player contact |
| `0x8001c738`, `c8f8`, `cab8`, `cc68` | Up/down/left/right collision resolution |
| `0x8001ea1c`, `ebd0` | Perpendicular corner alignment |
| `0x8001ed7c` | Axis selection for diagonal input |
| `0x8001eef8` | Movement dispatch and facing updates |
| `0x80024f98` | Fuse decrement or remote-trigger input consumption |

`movement-oracle.py` executes the **actual original machine code** after resetting
RAM to the captured fight3 baseline for every case. It writes test fixtures under
`data/bw/conformance/movement/`. `movement-conformance.mjs` compares returns and
all changed bytes in `[0x800cbc80, 0x800d3e00)`, covering the grid, player records,
bomb pool and adjacent effects records; stack scratch bytes are intentionally not
part of an engine-state comparison. Void return registers are not compared.

**7,930/7,930 cases pass:** 7,732 movement/collision cases and 198 fuse cases.
This includes 600 complete movement-dispatch calls, boundary contacts, all 128
collision masks against 11 flag patterns, type-4 redirection, signed coordinate
conversion, diagonal inputs, actor exceptions, and normal/remote fuse paths.
These are controlled routine-level cases, not an assertion that the entire game
or arbitrary play sessions are implemented. The previous 1,009 helper cases and
five file-format tests still pass separately.

Preserve two non-obvious original behaviors caught during translation:
- Off-center diagonal selection sets `actor+0xd5` to 1 when the integer Y center
  error is zero, and 0 otherwise.
- Diagonal dispatch passes the other input component to the alignment helper;
  it is not equivalent to simply calling the cardinal-direction path.
- Horizontal collision resolvers continue to the grid check after an object
  contact; vertical resolvers return early. This asymmetry is present in MIPS.

Remote fuse path: flag 8 suppresses the ordinary decrement. It only consumes the
owner's pending input (`player+0xac`) and zeroes the fuse when the bomb's +0x74
byte is zero, owner index is below 5, owner flags lack `0x0c000000`, and pending
input intersects the mask at `*(uint32*)0x80078c00 + 2`.

## Controlled chain-reaction experiments

`bomb-scenarios.py` loads fight3, disables existing bomb slots, clears their grid
occupancy, and invokes original creation `0x80025058` for explicitly arranged
bombs. It records every setup mutation. This is a synthetic experiment inside the
original engine, not an unmodified retail input replay. CPU players remain active;
interpret the first detonation and nearby grid changes, not later match outcomes.

Evidence is under `data/bw/bomb-scenarios/`. Zero-based captured-frame results:

| Arrangement | First bomb slot released | Second bomb slot released |
| --- | --- | --- |
| Single normal bomb, initial fuse 150 | 150 | — |
| Adjacent bombs, initial fuses 2 and 80 | 2 | 6 |
| Pillar between the bombs | 2 | 80 |
| Destructible block between the bombs | 2 | 80 |

The adjacent flame reaches the second cell at frame 5; that bomb is released at
frame 6. A four-frame detonation separation in this setup is **not** a universal
chain timing claim. Ordinary fuse 1 becomes 0 without detonating in that call;
the outer update checks zero on the subsequent update. Destructible type `0x60`
is changed to a burning-cell state `0xfe01` before later becoming floor. The
full propagation/animation/damage/power-up engine is still outstanding.

## Renderer capture and exact rectangle replay

`instrument-gpu.py` adds read-only GP0/VRAM observation exports to the isolated
pinned PCSX core's `plugins/gpulib/gpu.c`. It is disabled by default and does not
modify the installed emulator. The observer records **consumed** command words,
so incomplete buffers are not double-counted. Captures fail on log overflow.

`capture-gpu.py` compares the same captured state with observation disabled and
enabled, requiring identical RAM, video-frame and VRAM hashes. `decode-gpu.py`
decodes the command stream. `replay-gpu.py` independently replays the observed
rectangle draw subset, palette lookup, texture modulation, clipping, mask bits,
fill and VRAM copy. Unsupported commands/features fail explicitly; this is not a
general-purpose GPU implementation.

Three independently captured frames now reproduce **all 524,288 VRAM pixels
exactly (zero differences each)**:

| Capture directory | Original-game setup | Sprite draws | Unique palette-correct pieces |
| --- | --- | --- | --- |
| `data/bw/gpu/` | Two idle warm-up frames, capture next | 233 | 117 |
| `data/bw/gpu-right60/` | 60 frames holding Right, capture next | 230 | 119 |
| `data/bw/gpu-explosion160/` | 160 frames holding Circle, capture next | 235 | 120 |

Each directory contains `capture.json`, `packets.json`, before/after VRAM,
`replay.json`, `replayed-frame.png`, a visual sprite sheet and `pieces/manifest.json`.
All original artwork stays in ignored `data/`; no screenshots, sprites, RAM or
commercial asset tables are committed to the source tools.

The World arena uses a skewed projection, not SB2's square presentation. Position
projection helpers are `0x800178d0` (Y) and `0x80017908` (X); camera layer records
have stride 0x50 with X at `0x8008b464` and Y at `0x8008b466`. For position block p:
- `screenY = signed16((signed16(p.y) >> 4) - cameraY)`.
- `screenX = signed16((signed16(p.x) >> 4) - cameraX + trunc((480-screenY)/2))`.
The actor draw routine at `0x8001797c` also applies height and transient offsets.
In the sampled stage each extra map row moves the image 8 pixels left and 16
pixels down. A taller arena must handle this geometry and background edges;
simply repeating texture rows or stretching the source framebuffer is not a port.

Next implementation work: decode `0x80023624` flame propagation and its effect
records; decode animation metadata and timing; build a source-size interactive
battle slice with the translated movement and captured assets before changing
board dimensions. No playable World portrait entry has been released.

## First playable build, Nov 8

The bounded JS R3000 runner reproduces all 7,930 routine fixtures and a 360-frame
sequence of complete player/bomb/effect/AI updates. `tick-oracle.py` records the
original sequence with the audio scheduler replaced by a no-op; the JS host uses
the same boundary. Compared RAM includes 0xcad80..0xd3a28, 0xf8e00..0xf9000 and
BIOS RNG seed at 0x9010. Load-delay and branch-delay behavior are implemented.

- GP = 0x800789f0. Selected battle tick calls: 1be0c, 21ec4, e68ec, ecad0,
  252f0, 23efc, e95f4, 1be3c (all addresses with 0x80000000 prefix).
- Human held/pressed words: 0x800d9300 / 0x800d92d8 + controller*2.
  Circle bit 0x2000. +d2 is CPU control; +d3 controller index. CPU enable bytes
  at 0x80078c7c. Timer at 0x80078bf8 counts frames, not seconds.
- AI danger-map clear starts at row 14 in original instruction 0x800e6f00
  (0x2414000e); portrait changes that immediate to 0 (0x24140000).
- Portrait rows 2..26, columns 2..12, enclosed by border rows 1/27, columns 1/13.
  Original grid coordinates and fixed-point movement are retained. Canvas
  placement straightens the original skew and slightly increases row spacing.
- Animation primitive record: u32 piece count, then 20-byte pieces; u/v at 0/1,
  signed offsets 2/3, CLUT u16 at 4, TPAGE at 6, width/height at 8/10. The sequence
  entry adds signed x/y at +4/+6. Original animation code advances these pointers.
- `0x80014a78(id,channel)` is sound scheduling. Captured IDs: 7 place, 8 explode,
  46 death, 112 time-related cue. Music includes CD audio, not just SPU voices;
  isolate it by muting CD mix as well as voices 0–15. Effects use voices 16–23.
  Restoring volume from register state when unmuting is necessary: merely
  zeroing cached mixer volumes can make repeated 127-volume effects disappear.

See README for first-build limitations. Original texture pixels/palettes are
retained; full GPU semitransparency and original stage-camera presentation are
not claimed. The private runtime pack is approx 4 MB, loaded only on game launch.

## Perspective correction, Nov 9

The straightened Nov 8 renderer and square floor patch were rejected. Current
`geometry.js` is an exact port of 178d0/17908: signed 16-bit fixed-point inputs,
truncation toward zero for the skew term, and original camera arithmetic. Camera
(184,-40) places the extended board in portrait; (180,220) is the measured original
capture. `projection-test.mjs` compares both against the original functions at
6,240 full-cell/sub-cell positions and validates solid borders and artwork bounds.

Playable rows 1..28; each row starts at `2 + 2*floor((row-1)/5)` and is 11 cells
wide. The stepped border keeps the original oblique basis inside 320×568, rather
than straightening/skewing the original sprites. Pillars retain original even-row,
odd-column parity. AI clear patches: e6f00 starts at row 0; e6f64 scans 32 columns
instead of 17 (storage remains 30×64). CPU motion was checked beyond column 17
and above row 14; all four CPUs traversed 46–62 cells during a 3,600-tick probe.

The 99 initial GPU background sprites reconstruct the original floor image.
Four complete projected 20×16 cells (two pattern phases in both axes) are sampled
with the original row shear; square 32×32 atlas crops do not tile this floor.
The boundary material is sampled from the original wall and masked to the block
silhouette. The HUD uses original timer, digit and character-face textures.
TITLE.RC images 13/14/16/17 supply original menu glyphs, background and logo.
Original bytes live only inside private pack metadata; prepare-presentation.py
rebuilds them from the household extraction. This remains limited battle setup,
not the original complete menus, stage selection or adventure content.

Floor geometry is cached once per renderer. Each depth row caches its block
art until cell types change; actors/effects retain their original depth ordering.
The final live 900×1600 check measured 300 frames: median 16.7 ms, p95 16.8 ms,
four frames over 25 ms. It verified game → library → home and preserved layout.
BW and SB2 now expose an idempotent suspend method for routing away: clear held
inputs, pause simulation/audio, then press Start after returning to continue.
