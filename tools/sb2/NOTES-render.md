# NOTES — phase 3b: presentation (renderer, sound, front end, Arcade)

The port's picture is the original's display side re-run on the core's WRAM: the core
keeps the original's memory layout, so every display routine reads the same fields the
65816 code reads. Display-only state (OAM free list, effect objects, palette uploads)
lives in `render/display.js`. Nothing the logic reads is ever written.

## Files

| file | what |
|---|---|
| `public/arcade/sb2/render/ppu.js` | small SNES PPU for this screen: BG1/BG2 4bpp 16x16, BG3 2bpp + priority bit, OBJ 8/16, window 1 (inverted), colour math (half-add on BG2), master brightness. Tile-cached BG layers composed per 8x8 block, sprites per frame, no per-frame allocation |
| `public/arcade/sb2/render/display.js` | the display routines (addresses below), OAM builder, effect objects, palettes, HUD, tall adaptations |
| `public/arcade/sb2/render/pack.js` | loads `pack/pack.json` + `pack/sb2.bin` (2 requests) |
| `public/arcade/sb2/audio.js` | Web Audio: looping stage music, SFX by sound id |
| `public/arcade/sb2/app.js` | picker / match / tally / victory, pad mapping, game loop |
| `public/widgets/emulator.js` | shelf entry + `bootPort()` (same `__GARDEN_GAME` contract) |
| `src/server.mjs` | `GET /api/sb2/asset/<path>` -> `data/sb2/assets/<path>` (read-only, guarded) |
| `tools/sb2/extract/pack.py` | builds the pack (+ cover, + thumbnails via `tools/sb2/render/thumbs.mjs`) |
| `tools/sb2/conformance/visual.py` | pixel comparison against the harness (+ `visual_render.mjs`) |
| `tools/sb2/conformance/visual_extra.py` | extra display scenarios (Hurry, sudden death on every stage) |
| `tools/sb2/qa/*.mjs` | headless browser QA (CDP + pad injection), `perf.mjs` |
| `tools/sb2/render/shot.mjs` | render any stage/layout/tick to PNG |

## The pack (data/sb2/assets/pack/, gitignored)
- ROM banks $C1 (palettes), $C2 (poses, effect scripts), $C5 (bomber pose graphics, tables).
- Per stage: VRAM 64 KiB + CGRAM + WRAM $7E4000-$7E5FFF at the first bright frame of the
  quiet 4-human match (`mt4_stageNN`). The WRAM slice holds the animated characters'
  source graphics ($7E4828 + frame*32, uploaded by C1348D).
- `cover.png` (title screen lines 0..175, x2), `thumb_{tall,orig}_NN.png` (rendered by the
  port), between-round figure animations (from sprites.json) in pack.json.
- Rebuild: `python3 tools/sb2/extract/pack.py` (needs the harness, the derived states and node).

## Display routines reproduced (all measured against harness frames)
- **Frame <-> tick**: the tick that completes in frame i is uploaded by the NMI ending
  frame i; the harness shows it in frame i+1 (lag 1, every sample).
- **BG2**: C0F60E DMAs the tile mirror $7FA0C0 (rows 3..15, 32 words per row) to VRAM
  $4060 every NMI. Tall: rows 3..29 (the same mirror, the field is rows 3..29).
- **HUD (BG3, map $5C00)**: C11D41 clock = `$28xx` from $5E0A/$5E0C/$5E0E at row 1 cols
  14..17 (colon $2882), skipped while $5E20 b15 (stopped) or TIME infinite; C11356
  (only when no bomber pose was DMA'd this frame, `$BB` = 0): C1195D win digits
  ($C5D432[wins], row 1 cols 6/11/22/27), C113EE.. dead face when `(+00 & $2800) == $2800`
  (cols 3/8/19/24: `$28D0 $28D1 / b b+1 / b+$10 b+$11`, b = $2060/$2062/$2464/$2466).
- **Palettes**: the CGRAM mirror is $7E2420 (C00F2C DMAs 512 bytes every NMI).
  C00617: colour 95 = $7D83 / $00BF by $5C60 b4. C006B7/C0076B/C0081D/C008CF: OBJ palette i
  = sick flash ($C1D7DA[colour] / gold $C1DD1C) while diseased and the toggle bit
  ($0008 >> i) is set, else normal ($C1D7B0[colour] / gold $C1DCFC), written only on the
  transitions. Stage 9 C03EB6: palette 6 = $C1DB7E + 32*$5CC2. Stage 8 C041A0 / C0406E:
  palette 6 = $C1DBFE + 32*$5CBA, palette 7 = $C1DC7E + 32*$5CC2.
- **Animated characters** (stages 5/6): the core queues C1340A ($5EEE, dst $5EEF/$5EF4,
  src $5EF1/$5EF6); C1348D DMAs 2 x 64 bytes.
- **OAM** (C020FA clears: y=$E0, free list $7E2000 zeroed): objects in the order of the
  active list $7E2620 (rebuilt at the start of the tick, so an object created during the
  tick is drawn from the next one). Per object C09C7B (skipped when +00 b13):
  pose = +79 (24-bit): count byte, then 5-byte pieces `dx dy attr size|tilehi tilelo`.
  Position = +10/+18 + signed dx/dy; attr palette from +06 (C0A056) when +06 b15 = 0;
  +04 b6 (hidden) writes nothing; `+52 b0 & b8 & !b12` -> priority 0 (C09FD7).
  - bombers (< $8400, C09D03): slots from +08 ($30/$38/$40/$48 by y, C02821); graphics
    streamed from ROM C5:tile*32 (16x16 = tiles t, t+1, t+16, t+17 of a 16-wide sheet,
    C09EDA); tiles >= $3C0 are fixed VRAM tiles via $C5FC07/$C5FC17 (C09DBB).
  - movers (>= $8400, C09D36): free slots from $50 (from 0 when +08 != 0); fixed VRAM
    tiles `byte4 | (byte3 & 1) << 8` (C0A02D).
  - effect objects ($7EF000 + $100k, C10CAF): slots from $C5D862[+08] = $14; tile +=
    +88. Script interpreter = C0249D on the effect object (decoded from ROM at run time),
    table pointer +90 = $C22C80, script = table[+6A]. "Hurry!" C10BCC (slot 0, x=$140,
    y=$70, anim 0; C10C3C moves it 2 px/tick left until `x & $1F0 == $1A0`); falling
    block C10761 (slot 1, every sudden-death step at the cell centre C0EE1C, anim 2);
    item-scatter puff C096B9 (first free slot 2..15, anim 4, created after C10CAF).
- **Window**: HDMA channel 1 ($C5FD61, indirect $7E3730) sets window 1 per line: lines
  0..23 `($FF,$00)` (BG1/BG2/OBJ fully masked under the HUD), then `($01,$FE)` (x 0 and
  255 masked); TMW = TSW = $13, W12SEL $33, WOBJSEL $03.
- **Colour math**: CGWSEL $02 / CGADSUB $42 = half-add of the sub screen on BG2 pixels: a
  bomber in priority 0 (in a stage-2 hole, under a stage-3 tunnel) shows through BG2.
- **Brightness** (`$30` -> $2100 in the NMI): output = round(c * b / 15) per 5-bit channel,
  measured over a whole fade-in in the harness (every level matches).

## Visual conformance (`visual.py`, 15-bit compare against `S.frame()` at frame i+1)
- 46 logic vectors, 30+ samples each (plus every death): **1473 / 1473 samples
  pixel-exact**; display scenarios (Hurry banner, sudden death with COMs, round end,
  stages 1..10): **661 / 661 pixel-exact**.
- Exact only with `snes9x565` on: snes9x does the half-add in RGB565 with green's low
  bit = its top bit (pixform.h), so a halved green rounds up when both inputs are >= 16.
  The hardware halves 5-bit values; the wall uses the hardware rule, the conformance run
  emulates snes9x (`SB2_HW_BLEND=1` turns it off: the only differences are then +-1 green
  on blended pixels, e.g. 99.95 % on the stage-2 hole frames).
- Not reproduced / not compared: the 32-sprites / 34-tiles per line limits (never
  reached on this screen), OAM priority rotation (unused), an object deleted later in
  the tick it was drawn in (the post-tick state is all the renderer sees; never seen in
  the samples), the round-end fade-out (the core blanks the screen at once; the front end
  cross-fades to the tally instead), G-BOMBER gold palette (implemented, the front end
  plays with `gbomber: false`).
- run.mjs: a round that ends inside a lag tick was compared one frame early (and the tick
  sometimes skipped); fixed (the round-over flag is the last thing a tick writes), 46/46.

## Tall (256 x 455)
- Same HUD and wall. BG2 rows 3..29 from the mirror; BG3 clipped to the first 256 lines
  (its 32x32 map would repeat the HUD at line 257).
- Bomber OAM bases sorted by the full y (the original sorts by the low byte, which would
  put a lower bomber behind a higher one past y 255).
- Stage 5 white plates (BG1): the upper four stay, the lower four move down 14 rows,
  like tall.js copies the rows.
- "Hurry!" crosses the middle of the tall arena (y + 116).

## Front end
- Game loop: rAF; a frame within 2.5 ms of the tick period runs exactly one tick; the
  accumulator allows one catch-up tick per frame and drops the rest. Hidden page: loop
  stopped, AudioContext suspended.
- Input: SN30 Pro raw edges -> core bits (A0 B1 X3 Y4 L6 R7 Select10 Start11, d-pad /
  stick = jx/jy). A press shorter than a frame is latched so the next tick sees it.
  Start = pause; Select+Start: match -> picker -> shelf; B in the picker -> shelf.
- Audio: AudioContext at 32040 Hz; `<stage>_loop.ogg` with loopStart/loopEnd from
  audio.json; stage 4 (no loop point) streams the 620 s recording through a media
  element. SFX by `ev.sfx` / `sfx` events, one voice per id. Draw: draw.ogg; match:
  victory.ogg.

## Performance (Jetson Orin Nano CPU)
- Node (same V8): `node tools/sb2/qa/perf.mjs` — tall, 4 CPUs through hurry + sudden
  death: tick + display logic ~0.05-0.1 ms, render ~0.45-0.55 ms, total mean ~0.6 ms,
  p99 ~1.0-1.2 ms per frame, 0 GCs in the measured runs.
- Headless Chromium on the test server (tools/sb2/qa/match.mjs): 0.46-0.57 ms per tick
  (core + display + audio events), 0.49-0.68 ms per frame for render + putImageData.
- A fresh display per match measured ~2.5x slower (re-JIT of new closures), so the app
  keeps one display per layout for the page's life.
