# NOTES — phase 2a: battle-mode asset extraction

Everything here is pulled out of the RUNNING game (VRAM / CGRAM / OAM / APU of the
harness core), decoded with the real palettes; nothing is redrawn. All outputs go to
`data/sb2/assets/` (gitignored); only the scripts in `tools/sb2/extract/` are committed.

    python3 tools/sb2/extract/all.py            # everything, ~25 min on the Jetson (3 jobs)
    python3 tools/sb2/extract/all.py --skip-obs # reuse the cached observation runs

Prerequisites: the harness core and states (`tools/sb2/harness/build.sh`, `paths.py`,
`paths.py --multitap`). All numbers below were measured in the harness on 2026-10-25.

## Scripts (tools/sb2/extract/)

| file | what |
|---|---|
| `snesgfx.py` | pure-numpy SNES decoding: 2/4bpp planar tiles, tilemaps (all 4 screen sizes, 8/16 px tiles, flips, priority), OAM (OBSEL sizes, name-base gap, 9-bit X, row-wrapping tile numbers), BGR555 → RGB `(c<<3)\|(c>>2)`, RGBA with hardware transparency |
| `common.py` | paths; derived states: `mt4_stageNN` (4 humans via the multitap, idle = quiet world) and `com4_stageNN` (all 4 bombers COM, the game plays itself) |
| `capture.py` | WRAM facts used for capture (player position, arena grid, BG2 mirror), item spawning / cell pokes |
| `observe.py` | observation runs → `cache/obs_{idle,com,bombs}_stageNN.npz` (per frame: arena BG2 entries, grid codes, CGRAM, OAM, player x/y, BG char rewrites, BG1 use) |
| `stages.py` | per-stage BG extraction (below) |
| `sprites_lib.py`, `sprites.py` | metasprite capture, shape de-duplication, labs (walk/death/win/kick/glove/scatter/match), COM runs |
| `hud.py` | HUD bar, glyphs, faces, between-round screens |
| `sound.py` | music (.spc + .ogg + loop points) and SFX (.ogg, diff-isolated) |
| `preview.py` | contact sheets |
| `all.py` | runs everything in order (one emulator per process) |

## How things were triggered

- **Quiet worlds**: `mt4_stageNN` = stage select with the multitap's 4 human players →
  nobody moves unless a pad says so. Used for match-start snapshots, idle animations,
  all controlled labs and the HUD clock.
- **Self-playing worlds**: `com4_stageNN` = 1P and 2P switched to COM in the player table
  (all 4 COM, level 5). 24000-frame runs per stage: the COMs bomb the arena, burn items,
  kick/throw, die, win rounds, reach sudden death.
- **Labs** (stage 1, soft blocks removed by rewriting grid cell + BG2 entry from the
  game's own floor copy in BG2's lower screen): every bomber walks the outer ring in
  4 directions; all drop a bomb and stand (death x4 → DRAW); three blow themselves up
  (round win, scoreboard) x4; white wins 3 rounds (VICTORY!! screen, roulette); kick /
  glove items spawned in front of each bomber (grid code $44 + BG2 entry in VRAM and
  in the `$7FA000` mirror = a real collectable item) and used.
- **Bomb lab**: P1 picks each bomb item (remote, pierce, rubber, power) and drops a bomb,
  for the bomb animations the COMs never showed.

## Formats

- PNGs are RGBA with alpha 0 exactly where the hardware is transparent (colour 0 of a
  BG/OBJ palette). Colours are CGRAM BGR555 expanded with `(c<<3)|(c>>2)`.
- `chars_*.png` are INDEXED PNGs: pixel value = colour index inside its palette
  (0..15 for 4bpp, 0..3 for 2bpp; index 0 = transparent, grey preview palette). Use with
  `palettes.json` to recolour.
- Coordinates: screen pixels = OAM pixels (snes9x output row r = OAM y r, measured).
  BG pixel (x, y) appears on screen at (x − hofs, y − vofs − 1) (measured: BG2 scroll
  (8, 22) → screen = BG2 − (8, 23)).
- Durations are in video frames (60.0988 Hz) as measured. The game runs one logic tick
  per frame but drops frames when the CPU overruns (lag); durations from the COM runs
  are the MODE of all observed run lengths, so lag frames don't leak in. See
  NOTES-re.md for tick-level timing.
- Raw tilemap entries (`entry`) are SNES words: bits 0-9 tile, 10-12 palette,
  13 priority, 14 hflip, 15 vflip. For the 16x16 BG2 cells the metatile is tiles
  t, t+1, t+16, t+17.

## data/sb2/assets/stages/stageNN/ (all 10 stages)

| file | content |
|---|---|
| `screen.png` | the emulator frame at match start (what the TV shows) |
| `arena.png` | BG2 arena (15x13 cells incl. the wall ring = 240x208) at match start |
| `bg1.png bg2.png bg3.png` | each whole tilemap rendered (BG2 is 64x64 cells: screen 0 = live arena, screen 2 = the floor-only copy the game restores cells from; BG3 = HUD) |
| `chars_bg12.png`, `chars_bg3.png` | BG1/2 4bpp (1024 tiles) / BG3 2bpp (256 tiles) characters, indexed |
| `palettes.json` | CGRAM at match start: `bgr555[256]`, `rgb[256]`, `bg[8][16]`, `obj[8][16]` |
| `tilemaps.json` | `ppu` registers + `layers.bgN`: sc_base, sc_size, char_base, bpp, tile_px, hofs, vofs, width, height, `entries[y][x]` (raw words) |
| `metatiles.png` | every distinct 16x16 BG2 cell, 16 per row |
| `anim_tiles.png` | (stages 5, 6) phases of the character-animated cells |
| `stage.json` | manifest |

`stage.json`:
- `geometry`: cell 16, arena 15x13 (includes the outer wall ring; play field 13x11),
  `arena_origin_in_bg2_px` [16, 48], `bg2_scroll`, `screen_from_bg2`,
  `arena_cell_screen_px` (cell (c, r) top-left on screen = (8 + 16c, 25 + 16r)).
- `metatiles[]`: `id`, `name`, `kind`, `rect` [x, y, w, h] in metatiles.png, `entry`
  (canonical tilemap word) + `entries` (all words that render identically, e.g. a hard
  block and the wall ring), `tile`, `pal`, `prio`, `hflip`, `vflip`, `grid_codes`
  (histogram of WRAM grid codes seen under this cell in the COM run → what the game
  thinks the cell is), `observed_frames`, `on_start_map`, plus per kind: `piece`/`frame`
  (flames), `bomb_type`/`frame`, `item` + `effect`, `code` + `description` (gimmicks).
  Kinds: `floor` (variants incl. shadowed floor), `hard_block`, `wall`, `border` (BG2
  cells outside the grid: side columns, HUD rows), `soft_block`, `soft_destroy`,
  `soft_regrow` (stage 10), `bomb`, `flame`, `item`, `item_burn`, `pressure_block`
  (sudden-death block), `gimmick_XX` (stage-specific grid code XX).
  Bombs, flames, soft-block destruction and item burn exist in the 4 owner palettes
  1..4 (white, black, red, blue: the game colours an explosion / burning block by the
  bomb's owner) and are baked over each stage's floor colour, so they are per stage.
  Families that the COMs never showed are still included (rendered from VRAM, same
  layout on every stage) with `observed_frames` 0.
- `grid_start[13][15]`: metatile ids at match start; `grid_codes_start[13][15]`: the
  game's grid codes ($7FC000 map); `grid_empty`: the floor-only copy (BG2 screen 2);
  `view_bg2_cells`: ids of BG2 cells x 0..16, y 0..15 (the whole visible screen incl.
  side borders and the rows under the HUD).
- `animations{}`: `soft_destroy_pP`, `item_burn_pP`, `bomb_<type>_pP` (loop; + 
  `first_frame_duration`, `granted_by_item`), `flame_<piece>_pP` (pieces: center,
  arm_h, arm_v, end_up/down/left/right; frames 0,1,2,3,4,3,4,3,4,3,2,1,0 x 2 frames =
  26), `soft_regrow` (stage 10): `frames[{metatile, duration}]`, `loop`, `then`.
- `tile_animations[]`: `tiles` (char numbers rewritten by the game), `metatiles` that use
  them, `phases`, `atlas` (anim_tiles.png: row = metatile, column = phase), `sequence`
  [{phase, duration}] (one cycle).
- `palette_animations[]`: `cgram_index`, `palette`, `colour`, `loop`, `sequence`
  [{bgr555, rgb, duration}] (one cycle). Colour 95 (palette 5 colour 15 = the item
  icon border, red/blue every 4 frames) on every stage; stages 8 and 9 cycle colours
  97-101 (+125-127 on stage 8): conveyors / panels animate by palette.
- `gimmick_transitions`: observed cell changes involving gimmick cells.
- `bg1_used_during_match`: max non-empty BG1 entries in the COM run (stage 5 only).

## data/sb2/assets/sprites/

- `bombers_{white,black,red,blue}.png`: the same layout for the four colours (OBJ
  palettes 0..3). Bomber shapes are de-duplicated by SHAPE (colour index within the
  palette + transparency), so one shape = one pose for all colours.
- `fx.png`: every other OAM piece (one 8x8 / 16x16 entry each, flips baked), in the
  palette it was first seen with.
- `sprites.json`:
  - `bomber_shapes[]`: `id`, `category` (`bomber` = in the arena, `screen_bomber` =
    scoreboard / DRAW / VICTORY / roulette), `rect`, `w`, `h`, `anchor` [dx, dy],
    `colours_seen`, `used_in` (animation names), `from_lab`, `first_seen`, `count`,
    `pieces[]` = the OAM entries {dx, dy (relative to the image top-left), tile, w, h,
    hflip, vflip, pal, prio}. `tile` is the VRAM slot the game streamed the pose into
    that frame (bomber i uses slots 4i and 4i+2 and rewrites them every frame), not a
    stable graphics id.
  - Anchor: image top-left minus (x − 8, y − 7), (x, y) = player logical position
    ($7E8010 / $7E8018 + $100·i, previous frame). For a bomber centred on cell (c, r),
    (x − 8, y − 7) is the cell's top-left on screen → anchor = where to draw the frame
    relative to the cell (bombers stand with their feet in the cell and the head 10-12
    px above it).
  - `animations{colour}{name}`: `[{shape, duration, anchor}]`. Names: `idle_down_start`,
    `walk_{down,up,left,right}` (one cycle), `idle_{dir}`, `death`, `kick_sequence`,
    `glove_lift_carry`, `glove_walk_carry_<dir>`, `glove_throw`, `draw_screen`,
    `scoreboard_winner`, `scoreboard_loser`, `white_wins_scoreboard_roundN`,
    `white_wins_victory_screen`, `white_wins_after_victory_N` (roulette).
  - `animations_identical_across_colours{name}`: same shapes + durations for all four.
  - `fx_pieces[]`: `id`, `rect`, `w`, `h`, `palettes_seen`, `first_seen`, `count`, `oam`.
  - `fx_events[]`: per-frame piece lists {frame, pieces[{piece, x, y, pal, prio}]} for
    the labs (kicked bomb, thrown bomb, item scatter, death, scoreboard trophies,
    VICTORY letters/confetti) and the COM run's special effects (palette >= 4: "Hurry!"
    banner, falling sudden-death block, item-scatter puffs).
  - `obj_palettes{colour}`, `obj_palettes_all[8]`, `obsel` (8x8 small / 16x16 large).

## data/sb2/assets/hud/

- `hud_start.png` (256x24, BG3 rows 0-2 at match start), `glyphs.png` (digits 0-9 and
  ':' as 8x16 = BG3 row 1 + row 2), `faces.png` (each player's face: alive, then dead),
  `hud_chars.png` (every BG3 char used by the bar), `hud_fNNNN.png` (bar during the idle
  match at frame NNNN, e.g. sudden death / time-up).
- `hud.json`: `bg3` registers, `rows` (raw entries of the 3 rows at start), `cells`
  (columns of faces / win digits / timer), `glyphs{digit: {top, bottom, rect}}`, `colon`,
  `faces{colour: [{first_frame, entries}]}`, `chars[]`, `palettes_bg3[8][4]`,
  `timer_frames_per_second` (65 frames per displayed second, measured; = 65 ticks).
- `screens/` + `screens.json`: key frames (full frames + decoded BG layers) of every
  non-arena screen: scoreboard (trophies), DRAW, VICTORY!!, roulette and what follows,
  with frame numbers and PPU registers. Sprites on those screens are in sprites.json.

## data/sb2/assets/audio/

- `music/<name>.spc`: APU snapshot right after the play command (SPC v0.30, plays in any
  SPC player); `<name>.ogg`: harness recording from the first audible sample (vorbis q6,
  32040 Hz stereo); `<name>_loop.ogg`: intro + exactly one loop.
- `sfx/<name>.ogg`: the effect alone (A − B residual of two identical runs with / without
  the action, so the music cancels); `<name>_with_music.ogg`: the raw mix.
- `audio.json`: `music[]` {name, spc, ogg, stage, command_frame, recorded_seconds,
  loop_start_sample, loop_length_samples, loop_start_s, loop_length_s, loop_correlation,
  loop_method, same_song_as, note}; `sfx[]` {name, sound_id ($ id sent on APU port 0),
  ogg, ogg_with_music, seconds, peak, command_frame, method, note}.
- Loop points are found in the recording: autocorrelation picks the loop length, the
  start is where consecutive 1 s windows start correlating with the audio one loop
  later. Repeats are close but not sample-identical (correlation 0.85-0.97), so
  treat loop_start as ±10 ms.

## WRAM / hardware facts used (measured here; NOTES-re.md is authoritative)

- Bomber VRAM streaming: bomber i = OBJ palette i drawn with two 16x16 sprites in slots
  4i (+16 rows) and 4i+2, rewritten every frame → poses must be rendered from the VRAM
  of the same frame (verified: rendered composite == emulator frame, 40/40 frames).
- End-of-frame OAM/VRAM equal what the frame showed (verified pixel-exact).
- Player logical position $7E8010/$7E8018 (+$100·i); OAM lags it by one frame.
  ($7E8082/84 are the OAM position of one sprite piece and toggle by 16 — don't use.)
- Grid $7FC000 (one word per cell, row stride $80), BG2 mirror $7FA000.
- Sound: command id = APU port 0 & $7F (bit 7 toggles for repeats); `$7E1C82` = last
  requested id, `$7E1C86` = last sent.
- Timer freeze: $7E5E20 bit 15 (used to record long music without time-up).

## Coverage
(filled in at the end of the run: see the report section below)
