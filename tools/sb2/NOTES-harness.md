# NOTES — phase 1: instrumented emulator harness

Headless, deterministic snes9x (libretro) driven from Python via ctypes, with a tiny
C shim that exposes the PPU/APU state libretro hides. Everything below was measured
in the harness on the Jetson Orin Nano (2026-10-25) unless marked otherwise.

## Build

    tools/sb2/harness/build.sh        # clone + patch + nice -n 10 make -j4

- Clones `libretro/snes9x` into `data/sb2/build/snes9x` (gitignored) and pins
  revision `fae2fea08f74180759ef540ee94259213f503480` (override: `SNES9X_REV=`).
  Savestates are snes9x-revision specific: keep the pin unless you regenerate states.
- `snes9x-sb2.patch` is one line in `libretro/Makefile.common` adding
  `libretro/sb2_shim.cpp`; build.sh copies `sb2_shim.cpp` in. All shim exports are
  `retro_sb2_*`, so the stock `link.T` (`global: retro_*`) exports them unchanged.
- Output: `data/sb2/build/snes9x_sb2_libretro.so` (~1 min full build, -O3).

## Files (tools/sb2/harness/)

| file | what |
|---|---|
| `sb2_shim.cpp`, `snes9x-sb2.patch`, `build.sh` | core instrumentation + build |
| `snes.py` | `Snes` frontend (ctypes), `B` button bits |
| `inputs.py` | input-script parser/player/CLI (`expand`, `to_text`, `play`) |
| `ramwatch.py` | `RamWatch` per-frame history, `event_diff` counterfactual diff, `Search` |
| `spc.py` | `.spc` v0.30 writer/reader (used by `Snes.save_spc`) |
| `audio.py` | `AudioRecorder` (.wav native, anything else through ffmpeg), `record()` |
| `sheet.py` | contact sheets of frames for eyeballing |
| `paths.py` | scripted power-on → menus → states; emits `scripts/*.txt`; `--check` |
| `scripts/*.txt` | the exact input scripts for every saved state (generated) |
| `selftest.py` | perf + determinism + spc + audio + battle checks |

Run Python from `tools/sb2/harness/` (or put it on `sys.path`). The modules
import each other by bare name.

## API (snes.py)

```python
from snes import Snes, B
S = Snes(rom=DEFAULT_ROM, core=DEFAULT_CORE, multitap=False, render=True)
S.step(pads)                     # exactly one frame (one retro_run)
S.run(frames, pads=0, on_frame=None)
#   pads: int (P1 mask held) | tuple (per-port masks held) |
#         list of per-frame entries (len == frames, each int or tuple) | callable(i)->entry
#   on_frame(S, i) after each frame
S.frame()        # np.uint8 (224, 256, 3) RGB (from RGB565 -> use cgram() for exact colours)
S.png(path, scale=1)
S.audio()        # np.int16 (N, 2) since last call; S.sample_rate == 32040.0, ~533 samples/frame
S.wram() S.vram() S.cgram() S.oam() S.apu_ram() S.io()   # np.uint8 copies (live=True: zero-copy view)
S.dsp()          # np.uint8 (128,) DSP registers
S.smp()          # dict: pc a x y psw sp opcode_cycle control dsp_addr f8 f9 timer_target
                 #       timer_counter cpu_to_spc spc_to_cpu
S.ppu()          # dict, see below
S.sprites()      # OAM decoded: [{i,x,y,tile,pal,prio,hflip,vflip,large}] x128
S.palette_rgb()  # (256,3) uint8
S.read(0x7E0C40, n)              # WRAM by CPU address
S.save_state() -> bytes; S.load_state(bytes); S.save_state_file(p); S.load_state_file(p)
S.save_spc(path, song='', ...)   # valid .spc of the APU *now*; does not perturb emulation
S.wram_hash()                    # sha1 of WRAM
S.reset()                        # soft reset
S.fps                            # 60.0988 (NTSC)
S.frame_count                    # frames stepped by THIS Snes object (not stored in states)
```

**One `Snes` per process** — a libretro core is process-global state. Use
subprocesses for parallel runs.

`S.render = False` skips PPU rendering (≈1.65× faster; `frame()` goes stale;
memory/registers are still exact).

## Buttons — libretro joypad bit order (`B`)

mask = `1 << id`, id = RETRO_DEVICE_ID_JOYPAD_*:

| bit | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| button | B | Y | SELECT | START | UP | DOWN | LEFT | RIGHT | A | X | L | R |
| mask | 0x001 | 0x002 | 0x004 | 0x008 | 0x010 | 0x020 | 0x040 | 0x080 | 0x100 | 0x200 | 0x400 | 0x800 |

The core maps these to the SNES serial bits itself (this is NOT the SNES $4218
order). `B.parse('RIGHT+A')`, `B.fmt(mask)`.

## Pads / multitap

- Default: two plain joypads, `pads[0]` = SNES port 1, `pads[1]` = port 2.
- `Snes(multitap=True)`: Multitap (MP5) in SNES port 2 → `pads[0]` P1 (port 1),
  `pads[1..4]` = multitap slots 1–4 (libretro users 1–4).
  **Works**: SB2 detects it — with the multitap plugged, the battle player table
  defaults to 1P–4P all MAN (without it: 1P MAN 2P MAN 3P COM 4P COM). Measured in
  `battle_start_4p_mt` (40 frames of DOWN/UP on one pad, frame-diff bbox):
  pads[0] → white bomber top-left, pads[1] → black bottom-right, pads[2] → red
  top-right, pads[3] → blue bottom-left; pads[4] (5th) does nothing (SB2 battle has 4
  bombers). HUD order white/black/red/blue = P1..P4.
- Input timing: pads given to `step()` are latched by that frame's auto-joypad read;
  in a running battle a 1-frame tap at step k changes WRAM by the end of step k.
  The very first step after loading `battle_start.state` ignores input (taps at
  steps ≥1 work) — measured with `event_diff`.

## Shim memory map (`retro_sb2_mem_ptr(id)`)

| id | name | size | meaning |
|---|---|---|---|
| 0 | CGRAM | 512 | `PPU.CGDATA`: 256 little-endian BGR555 words (`0bbbbbgggggrrrrr`) |
| 1 | OAM | 544 | `PPU.OAMData`: 128×4 B (x, y, tile, attr vhoopppN) + 32 B high table (2 bits/sprite: x bit 8, size) |
| 2 | VRAM | 65536 | `Memory.VRAM`, byte offset = word address × 2 |
| 3 | APURAM | 65536 | SPC700 RAM (note $F4–$F7 hold SPC→CPU port values; $F0–$FF are not the live I/O regs) |
| 4 | FILLRAM | 32768 | snes9x bank-0 I/O shadow: `[0x21xx]` = last byte written to that PPU register, `[0x42xx]/[0x43xx]` CPU/DMA regs. For write-twice regs (scroll, M7) only the last byte is kept — use `ppu()` |
| 5 | WRAM | 131072 | `Memory.RAM`, $7E0000–$7FFFFF (same as libretro SYSTEM_RAM) |

### `S.ppu()` fields (end-of-frame values)

All `*_base` values are **VRAM word addresses**; `*_base_byte` = ×2 = offset into `vram()`.

- `bgmode` (0–7), `bg3_priority`, `bgmode_raw` ($2105: bits 4–7 = 16×16 tiles BG1–4)
- `bgN_sc_base` (tilemap, $2107–$210A), `bgN_sc_size` (0=32×32 1=64×32 2=32×64 3=64×64),
  `bgN_char_base` (tiles, $210B/$210C), `bgN_hofs`, `bgN_vofs` (10-bit) for N=1..4
- `obsel` raw, `obj_name_base` (tiles $000–$0FF), `obj_name_base2` (tiles $100–$1FF,
  includes the OBSEL gap), `obj_size_select` (OBSEL bits 5–7)
- `tm` / `ts` main/sub screen enables ($212C/$212D: bit0 BG1 … bit3 BG4, bit4 OBJ)
- `cgwsel`, `cgadsub`, `coldata_r/g/b` (colour math), `brightness`, `forced_blank`
- Mode 7: `m7a m7b m7c m7d m7x m7y m7hofs m7vofs m7sel`
- `mosaic`, `mosaic_raw`, `screen_height` (224), `setini`, `hdmaen`

Measured in `battle_start` (+2 frames): mode 1 (BG3 priority), BG1 tilemap word
$5800 32×32 scroll (8,23), BG2 tilemap $4000 64×64 scroll (8,22), BG1/BG2 chars $0000,
BG3 tilemap $5C00 chars $5000, OBJ tiles $6000/$7000 (8×8+16×16), TM=$17
(BG1+BG2+BG3+OBJ), TS=$14, **HDMAEN=$02** — HDMA channel 1 is active in battle (likely
the HUD/arena split), so end-of-frame scroll values may not hold for every line.
M7 matrix values are meaningless outside mode 7 (shared write latches).

### APU

- `S.apu_ram()` 64 KB, `S.dsp()` 128 regs (read via `SNES::dsp.read`, which only
  catches up the lazily-clocked DSP — no behavioural change), `S.smp()` CPU regs + I/O.
- `S.save_spc(path)`: snapshot state → finish the current SPC700 instruction
  (`retro_sb2_smp_finish_opcode`, so PC is on a boundary) → build file → restore the
  snapshot. $F0–$FF are rebuilt from the SMP's internal fields (control, dsp addr,
  CPU→SPC ports at $F4–$F7, timer targets/counters); extra-RAM block = RAM $FFC0–$FFFF.
  Verified: 66048 bytes; emulation after a dump is bit-identical to a run without one;
  ffmpeg's libgme decodes the battle .spc (5 s RMS 2356) and its band spectrum
  correlates 0.985 with the harness's own audio of the same 5 s.

## Tools

- **Input scripts** (`inputs.py`): one line per hold — `<frames> [P1] [P2] …`,
  buttons joined with `+`, `-` = none; directives `!save p`, `!load p`, `!png p`,
  `!mark name` (relative paths → `data/sb2/states/` / `data/sb2/debug/`).
  `python3 inputs.py script.txt [--state in] [--save out] [--png f] [--sheet f --every N] [--multitap]`
  (`-` reads stdin). `inputs.to_text(per_frame_pads)` writes a script back.
- **RAM watch** (`ramwatch.py`): `RamWatch(S).run(n, pads)` keeps a WRAM snapshot
  per frame → `changed()`, `series(off)`, `changed_at(i)`, `report(offs)`.
  `event_diff(S, state, frames, with_pads, without_pads, settle=0)` replays the same
  state twice and lists every byte that differs + first differing frame — the
  deterministic way to find "what does X change". `Search(S)` = cheat-finder narrowing
  (`keep('changed'|'same'|'inc'|'dec'|'eq'|'ne'|'delta', v)`). Offsets are WRAM
  offsets; CPU address = $7E0000 + offset.
- **Audio**: `audio.record(S, 'x.ogg', frames, pads)` or `AudioRecorder(path, S.sample_rate)`
  + `.write(S.audio())` per frame; `.wav` via `wave`, others (`.ogg` vorbis q6) via ffmpeg.
- **Contact sheets**: `sheet.Sheet().add(S, label)` … `.save(png, cols)`.

## Saved states (`data/sb2/states/`, gitignored; rebuild: `python3 paths.py && python3 paths.py --multitap`)

Each has a matching `scripts/<name>.txt` (from power-on); `paths.py --check` replays
every script in a fresh core and confirmed all 20 savestates **byte-identical**.

| state | frames from power-on | what |
|---|---|---|
| `title` | 662 | title screen, cursor on NORMAL GAME, accepts input |
| `normal_1_1` | 1510 | normal game, level 1-1, first fully-bright frame (timer 4:00) |
| `battle_players` | 1025 | battle → SINGLE MATCH → player table (1P MAN 2P MAN 3P/4P COM) |
| `stage_select` | 1409 | stage select, STAGE 1 shown; 1P MAN + 3 COM, COM LEVEL 5, 3 battles, 2:00, G-BOMBER ON |
| `battle_start` (= `battle_stage01`) | 1741 | stage 1 match, first fully-bright frame, timer 2:00, P1 = white bomber top-left, 3 COM |
| `battle_stage02` … `battle_stage10` | 1793–2201 | same settings, each of the 10 battle stages at its first bright frame |
| `stage_select_2p`, `battle_stage01_2p` | 1387 / 1719 | 2 humans (P1 top-left white, P2 bottom-right black) + 2 COM |
| `title_mt`, `stage_select_4p_mt`, `battle_start_4p_mt` | 662 / 1387 / 1719 | multitap plugged (`Snes(multitap=True)` required), 4 humans |

Debug PNGs of every state: `data/sb2/debug/state_<name>.png`, overview
`data/sb2/debug/all_states.png`; stage previews `debug/stages.png`.

Battle stages in select order (from the previews): 1 grey brick (classic), 2 ice,
3 water/beach, 4 barrels/dirt, 5 garden/teleport-ish, 6 pink/chocolate, 7 race-track
(numbered pads), 8 factory/conveyor ring, 9 tech/arrows, 10 forest/mushrooms.
(Names unverified; mechanics are phase 2b's job.) Stage 7 loads ~115 frames longer
than the others (arena fades in ~430 frames after START instead of ~315).

## Menu navigation (measured)

- Power-on → intro story (spaceships). START (after ~250 frames) skips to the title;
  title is fully drawn ~f412 after power-on. The title idles into an attract-mode
  demo battle if left alone.
- Title: NORMAL GAME / BATTLE GAME / PASSWORD; DOWN once = BATTLE GAME; START.
  ~190 frames of black loading, then SINGLE MATCH / TAG MATCH; START = single.
- Player table: DOWN/UP moves cursor, RIGHT toggles MAN/COM, START confirms.
- Rules: COM LEVEL 5, BATTLE 3, TIME 2:00, G-BOMBER ON (defaults) → START.
- Stage select: LEFT/RIGHT 1..10 (wraps), START. Arena fades in (brightness 1→15 over
  ~15 frames); bombers respond once it's fully bright.
- Normal game: START on NORMAL GAME → story → "1 - 1 START!" card → level (~850 f).

## Performance (selftest.py, `nice -n 10`, in a running battle with random input)

- render on: **~570 fps** (9.5× realtime); render off: **~945 fps** (15.7×);
  render + `wram()` copy every frame: ~546 fps. Savestate = 823,407 bytes,
  save+load is cheap (all 17 paths build in ~15 s).

## Determinism (selftest.py)

- Same 600-frame script from power-on, twice: WRAM hash per frame and frame image
  hash per frame **identical** (final WRAM sha1 `0047482f9ff2e05e…`).
- 600 frames of random 2-pad input from `battle_start`, twice: identical.
- Mid-run save/load round trip reproduces the continuation; separate processes
  replaying `scripts/battle_start.txt` give the same WRAM sha1
  (`7aca0591d35a603b…`).
- Why it holds: no frontend timing, `GET_VARIABLE` unanswered (core defaults:
  randomize-memory off, no overclock), no RTC; audio is produced but never paced.

## Caveats

- `ppu()`, `oam()`, `cgram()` are end-of-frame snapshots. Mid-frame HDMA / IRQ
  raster changes (e.g. per-line scroll) are not captured. `hdmaen` shows if HDMA is on.
- At a scene's first frame OAM may still hold the previous screen's sprites until
  the game's next OAM DMA.
- `frame()` is RGB565-expanded; exact SNES colours: `cgram()` / `palette_rgb()`.
- `io()` / FillRAM keeps the last written byte; for read-only regs it's not live.
- `frame_count` lives in the Python object, not in the savestate.
- `load_state` invalidates `frame()` until the next `step()`.
- The battle input ignores the first step after loading `battle_start`.
- A single-frame tap during a fade or a load is usually dropped; give menus a few
  frames between presses (the paths use 1-frame taps + ≥10-frame gaps).
- Even one frame of different P1 input changes ~179 WRAM bytes within 6 frames (the
  CPU players react), so filter `event_diff` results by *when* they diverge.
