# NOTES — the Garden Edition skin ("Bomber Garden")

A complete second set of pictures for the port, themed on the wall: little gardeners, seed
pods, petal blooms, ten gardens, a garden HUD / title / menus. It is ORIGINAL pixel art
(drawn by the code and text grids in `tools/sb2/garden/src/`), committed with its build
under `public/arcade/sb2/garden/`. The game, its timings, poses and anchors are the
original's: the skin only replaces graphics, in the same formats the renderer reads.

## How it plugs in
- `public/arcade/sb2/garden/garden.json` + `garden.bin` = an OVERLAY: byte patches into the
  runtime pack's blobs (`data/sb2/assets/pack/`, built from the user's ROM) and into the
  menus' pack. `render/skin.js`: `skinPack(pack, skin)` -> a new pack (the original is not
  touched), `skinMenuPack(menuPack, skin, mini, miniOrig)`. The display (`render/display.js`)
  and the menus (`menu.js`) then run unchanged; the only skin hooks are data:
  `pack.manifest.skin.border95` (the item border's two flashing colours, C00617) and
  `.objPal8` (the classic held / moving bomb palette).
- Only bytes the build DRAWS are in the overlay (characters, palettes, a few map words of
  the title, replaced sprite-piece and figure pictures). The original's layout (which tile
  goes where, poses, scripts, tables) is read from `data/sb2/` at build time and never
  copied. Nothing ROM-derived is committed.
- `app.js`: `set.skin` 'garden' (default) | 'classic', persisted with the menu settings;
  one display per layout + skin, one menu instance per skin. The stage select has a third
  row under TALL / CLASSIC: GARDEN / CLASSIC (UP / DOWN picks the row, LEFT / RIGHT
  switches; the other skin's menus take over on the same row at once). No overlay = no row,
  classic only.
- `public/widgets/emulator.js`: the shelf entry is "Bomber Garden" with
  `garden/cover.png` (the garden title, rendered by the menus' own PPU).

## Build
    tools/sb2/garden/make.sh      # build.py (all stages, ~12 s) + minimaps.mjs + the cover

| file | what |
|---|---|
| `garden/build.py` | sources -> overlay; palette allocation per palette row (<= 15 colours, errors name the cells), char conflict checks, the HUD / OBJ / title tile-izers |
| `garden/lib/gfx.py` | images = int32 arrays of BGR555 colours (-1 transparent), grids, 4bpp / 2bpp encoders, deterministic noise |
| `garden/src/swatch.py` | every colour (the wall's mint / teal / forest greens, soils, stone, terracotta, petals, golds, waters, the pod) |
| `garden/src/brushes.py` | clump bushes, seamless foliage, speckle grounds, shadows, bricks, stone blocks, ring roles |
| `garden/src/objects.py` | seed pods (5 types), petal blooms (7 pieces x 5 frames), burning blocks shedding leaves, wilting puffs |
| `garden/src/items.py` | the 24 item icons (garden tags, border colour 15 flashes mint / gold) |
| `garden/src/stages/sNN.py` | the ten gardens: terrain, ring by role, gimmick tiles, animated characters (`__anims__`), palette cycles (`__cycles__`) |
| `garden/src/bombers.py` + `bombers/pieces.txt` | the gardeners: palettes (identity = hat + overalls), 240 pose pieces as text grids |
| `garden/src/hud.py`, `fx.py`, `menus.py`, `menufont.py`, `title.py`, `figures.py` | HUD bar, sprite effects, menu scenery / palettes, menu lettering, title, winner figures |
| `garden/trace_bombers.py` | one-time: traces the gardeners over the original pose pieces (needs the ROM pack) -> `pieces.txt` (then edited by hand) |
| `garden/census.mjs` | which poses / OBJ tiles the battle draws (CPU matches, all stages) |
| `garden/preview.mjs`, `posesheet.py`, `menushots.mjs`, `minimaps.mjs` | review renders (stages mid-round, pose sheets, menu screens, previews, cover) |
| `garden/qa_matches.mjs` | whole matches on every tall garden in a headless browser (test server only) |

## What is drawn where (measured in the census / the pack)
- **Arena** (per stage VRAM chars at BG2 char base 0): every metatile of `stage.json`;
  flipped metatiles (all entries flipped, tile drawn unflipped elsewhere) come from their
  unflipped twin. Palette rows: 1..4 = ONE garden palette (pods + blooms + burning + the
  stage's floor, <= 3 floor colours), 5 = items, 6 / 7 = terrain. Objects are composited
  over the stage's floor (FLOOR, default `floor_0`; stage 2 the ice) like the original bakes
  its bombs / flames into opaque BG2 cells.
- **Stage 4 fuse ring = hose**: track pieces 0x2C (corner right+bottom), 0x2E (vertical),
  0x40 (horizontal); burning frames by tile: 0x60..0x6E horizontal, 0x80..0x8E vertical
  (8 frames), 0xA0/A2 + 0xA4/A6 spark positions, 0xA8..0xC6 corner (8), 0xC8/CA corner sparks.
- **Animated characters** (C1340A sources, WRAM $7E4828 + (frame & $7F) * 32, 16 chars per
  row, the build patches the pack's WRAM slice): stage 5 tiles 0x4C (frames 0..6) / 0x4E
  (8..E) = the pergolas' wisteria, stage 6 0x46 (0..6) / 0x2A (8..E) = birdbath / petal ring.
- **Palette cycles** (whole BG rows loaded from ROM C1 per phase, the build rewrites the
  phase palettes): stage 8 row 6 at C1:DBFE (4 phases: 5 water colours turning along the
  stream; default flow clockwise, checked against conveyed bombs), row 7 at C1:DC7E (2:
  lantern lights), stage 9 row 6 at C1:DB7E (4: LED chase toward the arrow tips).
- **HUD** (BG3 2bpp, map $5C00, chars $A000): the bar cut along the original's map; CGRAM 0
  (the backdrop) = the bar's green; palettes 0..3 = night/white/mint, red/blue/night,
  night/white/mint, night/mint/gold. Digits 0x86..0x8F, fallen hats 0xD0/D1 + 0x60.. 0x66..
- **Gardeners** (ROM C5 tile*32, poses streamed by C09EDA): all 240 16x16 pieces; palettes
  at C1:E2BC + 32i (healthy), E55C + 32i (skull flash), DCFC / DD1C (gold).
- **Fixed OBJ tiles** (every stage's OBJ base): 32 34 36 38 40 pods (normal remote power
  pierce rubber, drawn in objPal8), 42..47 sparkles, 98..110 small pods, 64 jump shadow
  (index 1 of any gardener palette), 66..78 the flipping seed packet of a flying item (the
  white gardener's palette indices), 136/138/140 the item-scatter puff (a quarter mirrored 4
  ways), 192/194 rising seeds, 160..174 "Hurry!" (cut along the banner pose: H = 160 over
  162, u r r y, "!" 174 + dot 173, tail 172), 142 the falling block (= the stage's pressure
  block; 188 = the blink), stage 2 tile 96 the snowball (OBJ row 4). OBJ row 6 per stage.
- **Menus**: palettes 1..4 recoloured index by index (cgram.menu + cgram.01..10), the stone
  wall / strip / player icons redrawn, all lettering redrawn (menufont.py: the original's
  text cells by tile number), the title: BG1 map cols 16..31 rows 0..13 and BG2 rows 0..13
  cut into fresh tiles (tile 0 = empty BG1, 0x200 = BG2 sky -> the backdrop, cloud tiles
  0x24A/0x24C, 0x202..0x20C kept for menu.js), title sprites / cursor / strip / "go" run
  replaced through `menu.manifest` overrides, the pieces blob replaced whole.

## Checks
- `node tools/sb2/conformance/run.mjs`: 46/46. `python3 tools/sb2/conformance/visual.py`:
  246 / 246 samples pixel-exact (the original skin; the skin hooks default to the original
  values).
- Browser (test server 8791, own headless Chromium): menus.mjs --fast (both skin rows, a
  match, results, the shelf) and qa_matches.mjs: whole matches on all ten tall gardens with
  hurry and sudden death, no page errors.
- Frame cost: identical for both skins (same renderer, same tile cache): Node, 5 stages x
  2500 ticks, render 1.29 / 1.29 ms per frame with a browser running beside it.
