# Bomberman World — The Garden Edition

User request, 2026-11-06: adapt the original PlayStation Bomberman World to the
900×1600 GardenOS screen in the same spirit as Super Bomberman Garden Edition:
extend playable arenas, preserve original assets and measured game behavior.
Battle mode is the first target, following the existing SB2 port. Do not substitute
stretched emulation, cropped gameplay, or an SB2 reskin and call it a World port.

## Status — original items and ten battle stages, Nov 10

**Available in Arcade as “Bomberman World: The Garden Edition”.** The original
PlayStation game remains a separate library entry. This build runs on the wall's
900×1600 display, with an extended **11×27 rectangular playable arena**, original sprites,
animations, palettes, battle music and captured sound effects.

- Start / confirm follows the original title → Game Mode → Battle Game → Single
  Match → players → rules → stage selection flow. On players, select row 2 and use left/right to
  switch MAN/COM. SN30 = P1; Xbox = P2; the remaining slots are CPU controlled.
- On rules, up/down selects BATTLE or TIME; left/right chooses 1/3/5 wins or
  1–5 minutes. Other rules remain at their displayed fixed defaults. Start advances to stages; left/right chooses a stage and Start begins.
  The bottom face button (SN30 B / Xbox A) returns to the previous menu. Unported choices explain
  that they are available in the separate original PS1 game; they do not silently
  start a different mode.
- D-pad moves; the **right face button** (SN30 A / Xbox B / PS1 Circle) places bombs.
  Other face/shoulder buttons retain PS1 positions; no invented SNES mapping.
- Start pauses/resumes. Select+Start or Escape returns to Arcade and closes audio.
- Keyboard: arrows + Space/Z for P1, WASD + F for P2; Enter starts/pauses.
- Rounds default to three minutes and first to three wins. Scores persist between
  rounds; a completed match waits for Start and returns to player setup.

Rounds start with the original **one bomb and firepower 2**. Destructible crates
sample the original private map's empty/item-bearing distribution. Original MIPS
routines perform burning, reveal, pickup and effects for all 21 nonempty crate
contents; bomb, fire and speed upgrades change the actual player statistics. The
sprite component order is reversed to match the original prepend ordering table:
item frames must draw behind their icons. Pickup and observed stage sounds are
captured from the original SPU.

All ten original battle stages are selectable: Standard, Candy Store, Jungle
Tunnel, Brick Castle, Volcano, Slippy Valley, Chimney Blast, Slow or Fast, Desert
Warp and Seesaw Park. Standard remains the 11×27 mirrored portrait arena. The
other nine are **13×27**, preserving the original 13×11 stage sector at rows
17–27, both collision layers, stage identity, native object pool and its update
routines, with playable terrain extended north. Their special structures remain
in the original sector; they are not replicated throughout the extension. The
native second-floor camera offset is required for upstairs sprites and terrain.
Original perimeter scenery is omitted where it would float through the new
boundary. Static stage previews come from actual original selection captures.

This remains a battle adaptation, **not the complete PS1 game port**. Adventure,
Challenge, Group Match, custom character selection and all rule variants are not
offered. Native per-pixel half transparency is supported for platform shadows. Not every other PS1 blend mode, animated palette or stage decoration is
reproduced. Music is still the captured 60-second battle loop, not the full OST.
The portrait camera uses a shallower 1/10 depth shear. Original sprites stay
upright; Standard block faces and square stage pillars are reprojected with the
floor. The original projection helper remains a separate binary reference.

### How it runs

`public/arcade/bw/` is the single runtime source; `tools/bw/*.mjs` entry points
re-export it for research tests. A bounded R3000 routine runner executes original
battle code from the private 2 MiB RAM pack: player movement/collision, bombs,
flames, death, animation and CPU decisions. It does **not** boot a PS1 emulator,
read the disc during play, stretch a framebuffer, or reuse SB2's engine.

Host code supplies input, round lifecycle, canvas rendering and audio. Two
original code patches extend AI danger-map initialization from row 14 to row 0
and from 17 to 32 columns. The original grid already supports 30×64 cells. Two
occupancy-mask loops are executed as equivalent JS. The camera uses a
20-pixel column and (-1.6,16)-pixel row basis for portrait presentation. The original
(-8,16) reference remains in geometry.js. World geometry is a continuous rectangle
with solid collision boundaries and new spawns. Top/left and
right/bottom raised walls share the same dimensions. The rejected low right rim
and double-height bottom foundation are removed. Background blue/green pixels
are masked out of extracted stone blocks; exposed right faces use original solid
block artwork. The 27-row board preserves the pillar lattice at all four corners.
Each player starts in exactly three connected cells bounded by crates; the corner
crate field is mirrored. `layout-test.mjs` checks this over 100 seeds.
Sound scheduling and BIOS memory/random services have explicit host hooks.
Commercial bytes never belong in `public/` or Git.

Private runtime files are in `data/bw/pack/`, served by an exact-name allowlist at
`/api/bw/asset/`. The shelf entry appears only when `pack.json` is installed.
Stage assets load on selection; only the selected stage is kept by the runtime. The private pack includes ten stage captures plus the original menu and audio assets. No dedicated service,
background emulator, model, network subscription or idle game process is required.

### Validation and local development

```sh
node tools/bw/items-test.mjs         # 2,420 native item ticks; one-bomb enforcement
node tools/bw/items-browser.cjs      # visible reveal → movement → pickup → capacity
node tools/bw/stages-test.mjs        # ten stages, native maps/objects, gameplay
node tools/bw/stages-render-test.cjs # native piece order and per-pixel transparency
node tools/bw/stages-browser.cjs     # all ten menu selections, screenshots and exit
node tools/bw/layout-test.mjs        # 100 starts, bounded pockets, intact pillars
node tools/bw/projection-test.mjs    # 6,240 original-code camera comparisons + bounds
node tools/bw/mips-test.mjs          # 7,930 original-machine routine fixtures
node tools/bw/tick-conformance.mjs  # 360 complete original battle ticks, RAM exact
node tools/bw/engine-test.mjs       # movement, bomb placement, 3,000 tall ticks
node tools/bw/match-test.mjs        # all four CPUs bomb; natural match → next round
node tools/bw/preview.mjs           # isolated localhost:8796, no wall changes
node tools/bw/browser-test.cjs      # browser movement, bombs, rendering, Escape
node tools/bw/controls-test.cjs     # two pads, tap edges, pause/audio, win/reset/exit
node tools/bw/menu-test.cjs         # navigation, time/wins, completion and exit
```

Browser checks currently use this machine's Playwright installation and isolated
Chrome binary (paths in each script). Conformance fixtures are private research
outputs generated from the original game; do not commit them. The 360-frame test
compares grid, actor, bomb, effect, AI scratch and RNG RAM, excluding audio/device
state and stack residue. It is not a claim of whole-game or all-stage conformance.

The camera build preceding the enclosed-border/menu revision measured median **16.7 ms**, p95 **16.8 ms** over 180 displayed
frames (one frame >25 ms), and a canvas covering exactly 900×1600. These are
short-run presentation measurements, not a long-session worst-case guarantee.
Actual Arcade launch, keyboard input, Select+Start return and relaunch were checked.
The controller paths were exercised with the same raw events used by the pad
bridge; a person has not yet play-tested both physical controllers together.

### Rebuild the private pack

The existing research capture is the baseline. From the validated local extraction
and `fight3.state`, build the isolated analysis core with all three hooks:

```sh
python3 tools/bw/instrument.py
python3 tools/bw/instrument-gpu.py
python3 tools/bw/instrument-sound.py
nice -n 10 make -C data/bw/upstream/pcsx-rearmed -f Makefile.libretro -j2 \
  DYNAREC=none USE_ASYNC_CDROM=0 USE_ASYNC_GPU=0 USE_ASYNC_SPU=0 \
  HAVE_PHYSICAL_CDROM=0
python3 tools/bw/capture-gpu.py
nice -n 10 python3 tools/bw/capture-audio.py
for state in press3 mode royal0 royal1 players-confirmed; do
  python3 tools/bw/capture-gpu.py --load data/bw/harness/$state.state --out data/bw/menu-gpu/$state
  python3 tools/bw/decode-gpu.py data/bw/menu-gpu/$state
done
# All ten stage captures are required for the complete private pack.
python3 tools/bw/capture-stages.py
# Capture/decode each fight-N.state into data/bw/complete/stages/gpu-N
# with capture-gpu.py --load ... --out ... and decode-gpu.py (N = 0..9).
python3 tools/bw/pack.py
```

The sound capture isolates original SPU effects from music/CD audio. It operates
only on the analysis core, never the installed live RetroArch core. Music capture
is reused when already present. `prepare-presentation.py` extracts the background draw references and original
TITLE.RC art into private pack metadata. `build-menu-pack.py` extracts separate
original menu backgrounds, lettering, cursors and editable values from the captured
menu GPU draws. These five private menu save-states/captures are required in addition
to the battle baseline. Menus fill 320×568: the extracted paper is extended with fixed-size edges and
its labels/cursors are repositioned without distorting their proportions. Title
art retains its aspect ratio above the reflowed options; the original copyright
sits at the foot of the screen. `pack.py` invokes both
extractors, checks fixed binary sizes and records
SHA-256 values. A fresh machine still needs its own original disc and a valid
battle capture; no commercial assets or save-state are downloaded by this tooling.
The private cover is a screenshot of this build, `data/bw/pack/cover.png`.

### Earlier research

Complete translated movement/collision/fuse helpers passed 7,930 machine-code
comparisons before the routine runner was introduced. Three independent GP0
replays each matched all 524,288 VRAM pixels. Those measurements establish the
original-size baseline; they do not claim pixel identity for the new portrait view.
See `NOTES-re.md` for addresses, measurements and reproducible experiments.

## Reproduce

All commands from `/home/talbot/gardener`. Python requires existing numpy/Pillow.
No commercial assets belong in Git or in `public/`.

```sh
mkdir -p data/bw/disc
LD_LIBRARY_PATH="$PWD/data/tools/mame/root/usr/lib/aarch64-linux-gnu" \
  nice -n 10 data/tools/mame/root/usr/bin/chdman extractcd \
  -i 'data/roms/Bomberman World (USA).chd' \
  -o data/bw/disc/world.cue -ob data/bw/disc/world.bin
python3 tools/bw/disc.py data/bw/disc/world.bin --out data/bw/files
nice -n 10 python3 tools/bw/assets.py data/bw/files/RC --out data/bw/assets
python3 -m unittest discover -s tools/bw -p 'test_*.py'
nice -n 10 python3 tools/bw/harness.py --frames 900 --name boot
```

chdman refuses existing outputs; reuse the validated extraction on subsequent runs.
Harness pad values are libretro masks: Start=8, cross/B=1, down=32, right=128.
Captures live in `data/bw/harness`; `--load path.state` resumes a capture.
HLE BIOS is requested; this is an analysis baseline, not a retail-BIOS accuracy
claim. Rendering is captured at the original resolution. A 60-frame replay from the captured intro state produced identical RAM and frame
hashes twice (`data/bw/replay-check.json`). This validates that short intro replay
only; battle input/state conformance remains untested.

## GitHub research

https://github.com/TechnicallyComputers/Bomberman-World-Recomp
Checked revision `284ab8680c4fc765bd3478cd7db60dbb78a1dba2`, kept under ignored
`data/bw/upstream/bomberman-world`. Contains generated MIPS-to-C and progressive
symbols, predominantly unnamed game functions; not a human-readable battle engine.
Its widescreen-site list explicitly says candidates from static analysis only.

**Upstream build blocker:** its pinned psxrecomp commit
`d2201f0fe115c9058bd805464b0e72427b5e27d2` cannot be fetched from
https://github.com/mstan/psxrecomp (`upload-pack: not our ref`, reproduced Nov 6).
Do not claim this checkout builds or silently substitute a different runtime.
The upstream's current branch is available but compatibility and licensing must
be evaluated separately before importing its code. None of its generated game
code has been copied into GardenOS source.

## Measured disc facts

Volume `SLUS_00680`; boot file `SLUS_006.80`, 432128 bytes;
SHA-256 `34b3d7a3657a6b161acf8b5802a22f29bc89e0a8f73c1fdbb94cc607bb75c626`.
PS-X EXE entry `0x8003ee18`, load address `0x80010000`, payload `0x69000`.
`BIN/BAT_S.BIN` is 88612 bytes and begins with pointers in the `0x800e....`
range; its runtime placement is confirmed at `0x800e3578`.

RC: first sector contains `(kind, byteLength)` little-endian uint32 entries,
terminated by `(0,0)`. Payloads start at sector 1, each rounded to 2048 bytes.
Parsing consumes every sector in every RC file. Padding includes unrelated-looking
bytes and is deliberately not interpreted as resources. Kinds remain numeric until
verified. TIM resources start with magic 0x10 and standard CLUT/image blocks.
`BP01.RC` contains an original Bomberman sprite sheet. `BT01.RC` includes arena
background textures; these are evidence for rendering, not a decoded collision map.

## Binary tracing and first conformance core (continued Nov 6)

Read `NOTES-re.md` for the measured map, player, movement and bomb addresses.
The isolated original-game battle replay is working. `core.mjs` has five helpers
with 1009 original-MIPS comparison cases; `movement.mjs` and `bombs.mjs` add
7930 movement/collision/fuse cases as of Nov 8. It is not yet a playable engine.

Instrumentation uses https://github.com/libretro/pcsx_rearmed at pinned commit
`7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e`, isolated in
`data/bw/upstream/pcsx-rearmed`. This is independent of the broken recompilation
runtime pin. The live installed emulator is not modified.

```sh
python3 tools/bw/instrument.py
nice -n 10 make -C data/bw/upstream/pcsx-rearmed -f Makefile.libretro -j2 \
  DYNAREC=none USE_ASYNC_CDROM=0 USE_ASYNC_GPU=0 USE_ASYNC_SPU=0 \
  HAVE_PHYSICAL_CDROM=0
nice -n 10 python3 tools/bw/probe.py data/bw/harness/fight3.state
nice -n 10 python3 tools/bw/watch.py data/bw/harness/fight3.state \
  --start 0x800ce0c8 --size 4 --pad 256 --frames 20 \
  --out data/bw/bomb-timer-writes.json
python3 tools/bw/conformance.py
node tools/bw/conformance.mjs
```

The observer covers normal instructions and branch delay slots. The store watch
covers SB/SH/SW; it does not claim to capture SWL/SWR/GTE stores, BIOS HLE writes,
or DMA. `retro_bw_call` is a bounded original-function execution helper, intended
only for these short read-only routines; CPU registers are restored afterward,
but arbitrary called routines can mutate memory/devices. Never use it on the live
emulator or assume arbitrary calls are side-effect-free.

## GardenOS controller page edges

Outside games and panels, left/right moves among widgets in the same visual row.
At an outer edge it changes dashboard page and focuses the incoming page near
the previous row. It stops at the first/last page and does not rearrange widgets.
`node tools/widget-layout/joypad-pages.cjs` checks both directions, focus transfer,
first/last limits and game/panel ownership in Classic and Moonstone.
