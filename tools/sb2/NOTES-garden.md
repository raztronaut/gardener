# NOTES — the Garden Edition skin ("Bomber Garden")

The ENVIRONMENT of the port redrawn as ten natural gardens, in ORIGINAL pixel art (drawn by
code in `tools/sb2/garden/src/`), committed with its build under `public/arcade/sb2/garden/`.
The game, its timings, poses and anchors are the original's.

**What the skin changes (2026-10-29, after the user's feedback "you shouldn't change player
and npc sprites, also bombs and fire the same, items the same too ... much more garden and
nature like", then "I liked the bomb style, keep that"):**
- ORIGINAL (not in the overlay at all): the bombers (players, CPUs, every colour and
  animation, the gold G-Bomber), the fire and explosions, the burning soft blocks and burning
  items, the items, the falling sudden-death block and every other sprite (jump shadow, flying
  item, item puff, "Hurry!"), the winner figures, the menus' player heads / bottom strip / go run.
- GARDEN: the seed pods (all bomb types, their pulse, held / kicked / thrown pods: OBJ tiles
  32..40 + 98..110 + 42..47 in `objPal8`), the arenas (ground, soft and hard blocks, borders,
  gimmick tiles, animated stage tiles, palette cycles), the HUD bar (the player icons are bomber
  helmets drawn in its palettes), the menus' scenery / lettering, the title.
- Classic colours stay as on the CLASSIC skin (display.js `classic`): fire / burning blocks in
  the red owner's colours (BG row 3), bombs in black's (BG row 2 = the pods' row here).

## How it plugs in
- `garden.json` + `garden.bin` = an OVERLAY on the runtime pack (`data/sb2/assets/pack/`, built
  from the user's ROM): byte patches (palette rows, a few characters, the HUD, the pods' OBJ
  tiles, stage-cycle palettes in rom.C1) and the CELL ART of the arenas
  (`pack.display.art`). `render/skin.js` `skinPack(pack, skin)` -> a new pack (the original is
  not touched) whose `manifest.skin` carries `objPal8`, `art`, `artBin` and `origStage(n)`
  (the ORIGINAL stage, for the fire masks); `skinMenuPack(...)` for the menus.
- Nothing ROM-derived is committed: layouts (which metatile is where, tile numbers) are read
  from `data/sb2/` at build time; the original's own pictures are only used at RUN time.

### Cell art (arena.py -> display.js `stageArt` -> ppu.js `setArt`, BG2 only, skins only)
- Each stage module paints its garden on 512 x 512 canvases in BG2 map space per layout (tall /
  original), from the start map of a match (`maps.json`, `mapdump.mjs`): `base` (the ground,
  opaque), `decal`, `shade` (bool), `obj` / `obj2` (static walls: hard blocks, hedges,
  trees, stone walls). Shadows of obj / obj2 fall down-right by themselves (`CAST`).
- The canvases are cut per map cell into 16 x 16 PICTURES (deduplicated, <= 15 colours, one
  palette row each, stored 4bpp + the row: 129 bytes) -> a STACK per cell (ground, decal,
  shade mask, objects). display.js composes the stacks once per stage and layout into
  `under` (512 x 512 CGRAM indices; a shade mask maps each colour through the stage's
  `shade` table = the colour in shadow).
- Per BG2 tile key (tile | hflip << 10 | vflip << 11) a MODE: 1 = the ground only (floors,
  hard blocks, walls, the stage-4 vine); 2 = picture layers over the ground (soft blocks:
  variants by a stable per-cell hash `artHash(tx, ty, salt)`, the regrowing toadstools with
  the same salt so a cell regrows its own variant; pods; the sudden-death block; gimmick
  tiles, flipped like their entry); 3 = the ORIGINAL characters over the ground (fire,
  burning blocks, burning items: row 3; items: their own row 5; animated cells / teleporters:
  the garden's characters, their own row).
- Mode 3 floor masks (display.js, from the ORIGINAL pack at run time): the floor reference
  that matches the cell best (`maskRefs` = floor entries + stage extras), pixels equal to it
  and connected to the cell's edge, plus pixels of a floor-only colour (floor colours that
  never occur in the middle of the original's flame centres / intact soft block,
  `fireRefs`) anywhere. Those show the garden ground.
- Palette rows: 3 and 5 stay the original's (fire, items); 2 = the pods (+ spare); 1, 4, 6, 7
  = the garden (packed by `solve_rows`: greedy + deterministic restarts; a picture's colours
  must fit one row; colours of a palette cycle are pinned to their row).
- Cost: render identical within noise (perf.mjs --skin garden), 0 GCs; `stageArt` once per
  stage per page, 10..70 ms at the first round on that stage (cached).
- The original skin: `art` null, ppu path unchanged (visual.py pixel-exact).

## Build
    tools/sb2/garden/make.sh      # build.py (all stages, ~12 s) + minimaps.mjs + the cover

| file | what |
|---|---|
| `garden/build.py` | sources -> overlay (palette rows, characters, HUD, pods, menus, title, the art blob) |
| `garden/arena.py` | the cell-art builder: layouts, canvases -> pictures / stacks / classes, palette packing, shade table |
| `garden/lib/nature.py` | noise, dome lighting, dithered shading, blobs, foliage, selective outline, cast shadows |
| `garden/src/terrain.py` | shared painters: grass / moss / soil / gravel / water textures, decals, bushes, ferns, grass clumps, reeds, lily pads, conifers, toadstools, cabbages, pumpkins, boulders, stumps, standing stones, logs, masses (hedges), crowns (trees), stone walls, vines |
| `garden/src/stages/sNN.py` | the ten gardens: `paint(cv, L)`, `soft()`, `pressure()`, `gimmicks()`, `regrow()`, `chars()` / `anims()`, `CYCLES`, `SHADE`, `FLOOR_KINDS`, `MASK_REFS`, `CHAR_CELLS` |
| `garden/src/objects.py` (pods), `fx.py` (held / moving pods), `hud.py`, `menus.py`, `menufont.py`, `title.py` | the other pictures |
| `garden/preview.mjs`, `menushots.mjs`, `minimaps.mjs` | review renders (stages mid-round next to the original, menus, previews, cover) |
| `garden/qa_matches.mjs` | whole matches on every tall garden in a headless browser (test server only) |
| `garden/spritecheck.mjs` | sprite audit: original vs skinned display in lockstep, every OAM entry compared |

Dev: `GARDEN_ONLY=4 python3 tools/sb2/garden/build.py` builds one stage (the others keep the
original pictures); always run the full `make.sh` before committing.

## The ten gardens
1 meadow (hawthorn hedgerow with wild roses) · 2 frosty woodland (ice with frozen streams = the
underground track, black water holes, snowy fir treeline) · 3 lily pond (shallow water, lily
pads, cattails, reed bank, two stone culverts = the tunnels) · 4 orchard (the fuse ring = a
grapevine on a wire, painted in the ground: its fire runs along it; dry-stone wall with ivy) ·
5 zen moss garden (sun stones = power pads, wisteria arbours = the BG1 plates, red maples) ·
6 rose garden (birdbath / turning petal ring = teleporters, planters, rose hedge) · 7 hedge
maze (the maze walls painted as continuous clipped hedges, carved stepping stones = speed pads)
· 8 Japanese garden (the belts = a stream in river pebbles, cycle-driven; millstone / lotus
basin switches; lanterns with flickering lights; bamboo grove) · 9 vegetable terraces
(marigold arrows on boards = the arrow panels, cycle-driven; terrace walls) · 10 deep forest
(regrowing toadstools, canopy, stumps, dappled floor).

## What is drawn where (measured in the census / the pack)
- **Arena**: cell art (above). BG2 characters are only written for the animated cells
  (stage 6 teleporters) and BG1 for the stage-5 arbours; everything else in BG2 is pictures.
  The original's tile 6 above / below the stage-3 culverts and tile 0 are mode 1 (`GROUND_KEYS`).
- **Stage 4 fuse ring = grapevine**: the ring cells (gimmick_0e, any row 1..4) are mode 1 with
  the vine painted in their static ground; the original's burning frames (flame kind, no piece)
  are mode 3 masked against the floor AND the ring pieces (`MASK_REFS`), so the original's
  fire runs along the vine.
- **Animated characters** (C1340A sources, WRAM $7E4828 + (frame & $7F) * 32, 16 chars per
  row, the build patches the pack's WRAM slice): stage 5 tiles 0x4C (frames 0..6) / 0x4E
  (8..E) = the arbours' wisteria (BG1), stage 6 0x46 (0..6) / 0x2A (8..E) = birdbath / petal
  ring (BG2, mode 3 over the ground).
- **Palette cycles** (whole BG rows loaded from ROM C1 per phase, the build rewrites the
  phase palettes): stage 8 row 6 at C1:DBFE (4 phases: 5 water colours turning along the
  stream; default flow clockwise, checked against conveyed bombs), row 7 at C1:DC7E (2:
  lantern lights), stage 9 row 6 at C1:DB7E (4: marigold chase toward the arrow tips).
- **HUD** (BG3 2bpp, map $5C00, chars $A000): the bar cut along the original's map; CGRAM 0
  (the backdrop) = the bar's green; palettes 0..3 = night/white/mint, red/blue/night,
  night/white/mint, night/mint/gold. Digits 0x86..0x8F, crossed-out helmets 0xD0/D1 + 0x60..0x66.
  Screen line 24 (the picture's last row) must stay EMPTY like the original's: it lies over the
  arena's top row, and a BG3 pixel there is half-added onto BG2 (stage 3's culvert cells). That
  blend() in ppu.render's per-pixel loop, never reached on the original's screens, kept V8
  deoptimising render in Chrome ("insufficient type feedback" / OSR loops): 2.6 ms per draw
  instead of 1.5 for the rest of the page's life. Found with --js-flags=--trace-deopt.
- **Pods** (every stage's OBJ base): 32 34 36 38 40 (normal remote power pierce rubber), 42..47
  sparkles, 98..110 small pods, in `objPal8` (OBJ palette 8): classic mode puts kicked / thrown /
  held bombs there; with a skin `objPal8` a bomb mover in mode 2 (drawn in its pose's palette 0,
  seen on stages 3 and 5) takes it too.
- **The falling sudden-death block** (effect object, C10761, anim 2): OBJ tile 142 (16x16) and
  188 (8x8, empty: the blink), OBJ palette 6. In the ORIGINAL it is a plain white square
  (tile 142 = colour 9 = $7FFF; checked in the harness, visual vector hurry_stage04) until it
  lands as the stage's block. The skin draws tile 142 as the garden's own landed block
  (`pressure()`, 6 colours) in OBJ palette 6 slots 10..15, which hold $7C1E placeholders on
  every stage and are never shown by the original (spritecheck.mjs: no sprite pixel uses them).
- **Sprite audit** (`node tools/sb2/garden/spritecheck.mjs`): one game drives the original and
  the skinned display in lockstep (all stages, both layouts, items, G-Bomber, sudden death),
  ~2.1 M sprite draws compared colour by colour: everything but the skin's own sprites (pods,
  stage-2 pushed block, falling block) is identical to the original; no placeholder colour;
  the only all-white sprite left is the original's flipping item card (tiles 66..78, palette 0,
  index 3 of the white bomber = white: a real card shape, the same in the classic skin).
- **Menus**: palettes 2..4 recoloured index by index (palette 1 only its panel colour 15: the
  player heads keep the original's), the stone wall / strip scenery and all lettering redrawn
  (menufont.py), the title: BG1 map cols 16..31 rows 0..13 and BG2 rows 0..13 cut into fresh
  tiles (tile 0 = empty BG1, 0x200 = BG2 sky -> the backdrop, cloud tiles 0x24A/0x24C,
  0x202..0x20C kept for menu.js); title cursor = a pod (`title_cursor` override), no title
  sprites; the strip and the go run are the original's.

## Checks
- `node tools/sb2/conformance/run.mjs`: 46/46. `python3 tools/sb2/conformance/visual.py`:
  246 / 246 samples pixel-exact (the original skin: no art, the ppu path is unchanged);
  `visual_extra.py --check --norecord` (Hurry, sudden death, falling blocks on every stage):
  661 / 661 pixel-exact (its hurry_stage08 logic replay fails on the last frame, as before
  this work: the core is not touched by the skin).
- Browser (test server 8791, own headless Chromium): qa_matches.mjs: whole matches on all ten
  tall gardens with hurry and sudden death, no page errors.
- Frame cost (`node tools/sb2/qa/perf.mjs --stage 1,3,5,8,10 [--skin garden]`, tall, 4 CPUs
  through sudden death): render mean 0.42..0.56 ms classic vs 0.48..0.57 ms garden, 0 GCs.
