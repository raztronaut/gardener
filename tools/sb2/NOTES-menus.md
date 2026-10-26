# NOTES — the original battle menus (extraction + measurements)

    python3 tools/sb2/extract/menus.py           # screens, elements, sprites, timings (~2 min)
    python3 tools/sb2/extract/menus.py --sound   # + menu music and SFX (audio/, audio.json)

Output: `data/sb2/assets/menus/` (gitignored). Everything was MEASURED in the harness
(snes9x, 60.0988 Hz) on 2026-10-25 from the harness `title` state (cursor on NORMAL GAME)
and from derived states `assets/cache/menu_{title,mode,players,rules,stage}.state`
(built by `build_states`: DOWN, START, then START on each screen). Frame counts in a
measurement start at the press frame (0 = the frame of the press, as S.step returns).

## Screen flow (button behaviour, measured with one tap of each of the 12 buttons)

| screen | items / values | d-pad | A / START | B | others |
|---|---|---|---|---|---|
| title | NORMAL GAME / BATTLE GAME / PASSWORD; bomb sprite cursor at y 144/160/176, x 54 | UP/DOWN, clamp (no wrap, no sound at the ends); LEFT/RIGHT nothing | confirm ($52), fade out | nothing | nothing; any button resets the attract timer (1024 idle frames -> fade to the demo) |
| mode | SINGLE MATCH / TAG MATCH (rows 4 and 6) | UP/DOWN clamp | -> players, switch in 2 frames, no fade | nothing | nothing |
| players | 1P..4P; 1P/2P: MAN -> COM -> OFF (wrap), 3P/4P: COM <-> OFF; LEFT runs the cycle backwards | UP/DOWN clamp; LEFT/RIGHT change the value ($51) | -> rules (3 frames) | -> mode (2 frames, no sound) | nothing |
| rules | COM LEVEL 1..9 (default 5), BATTLE 1..5 (3), TIME 2:00 -> 3:00 -> 5:00 -> infinity -> 1:00 (2:00), G-BOMBER ON/OFF (ON); values wrap both ways | as players | -> stage select (3 frames) | -> players (2 frames) | nothing |
| stage | STAGE 1..10, wraps (LEFT on 1 -> 10) | LEFT/RIGHT: preview change animation, NO sound; UP/DOWN nothing | confirm ($52 at +2), 98 frames still, then fade to the match | -> rules (3 frames) | nothing |

No auto-repeat beyond: a held direction acts on the press, again after **19** frames, then
every **17** frames (rules COM LEVEL held RIGHT: changes at 0, 19, 36, 53, ...; cursor DOWN
held: 0, 19, 36). On stage select a held LEFT/RIGHT starts the next change as soon as the
previous change animation ends (starts at 2, 50, 97, 145, 193).
Earliest accepted input after a switch: players +1 frame after the mode START, rules +2,
stage select +46 (input ignored during the preview's mosaic intro), mode screen +192 after
the title START (= when the fade-in reaches 15).
The default player table is 1P MAN 2P MAN 3P COM 4P COM (no multitap; with the multitap
all MAN, NOTES-harness.md). After a whole match the original goes scoreboard -> VICTORY!!
-> roulette (G-BOMBER on) -> **the mode screen** (menus.json `after_match`).
TAG MATCH and the NORMAL GAME / PASSWORD paths were not followed.

## Sounds (APU port 0 & $7F)
- `$51` cursor move AND value change (also the title cursor) -> `audio/sfx/menu_cursor.ogg`
  (0.47 s, voice 0, isolated in a quiet moment of the music).
- `$52` confirm (A / START, title and menus) -> `audio/sfx/menu_confirm.ogg` (trimmed to
  0.9 s: the effect uses voices 0+1, which the menu song never leaves silent for its
  length, so after ~0.85 s the residual is the displaced music voice).
- B (back) and stage LEFT/RIGHT: no sound.
- Music: `title` (upload + play $01 when the intro is skipped; loop 121.88 s from 3.42 s,
  found with a relaxed correlation, the repeats vary more than the stage songs) and `menu`
  (upload during the black after BATTLE GAME, play $03 at +132 frames; loop 81.818 s from
  0.06 s; the same song on mode / players / rules / stage select, and again after a match).
  `.spc` + `.ogg` + `_loop.ogg` in `audio/music/`, entries appended to `audio.json`.

## Timing (frames)
- title -> mode: confirm at +1; brightness 15 -> 0 one step per frame (+1..+15); black 148
  frames (menu song upload); fade-in one step every 2 frames (+163..+191, 15 at +191).
- mode <-> players <-> rules <-> stage: instant (BG1 scroll), no fade.
- stage -> match: $52 at +2; nothing but the "go" sprites for 98 frames (same from any
  phase of the bottom loop); fade-out one step per frame (+98..+112); black/forced blank
  with the battle upload (song play $01 at +314); fade-in one step per frame +317..+331;
  first bright battle frame +331 (= `battle_start` state).
- Stage preview change (LEFT/RIGHT; also on entering stage select from rules): mosaic on
  BG2 only, size 1,2,..15 one per frame (+2..+16), held at 15 until +30 (from +21 BG2 is
  scrolled to an empty area: the preview hole shows the panel green), at +31 the new stage
  at size 15, then 14..0 one per frame (+46 sharp). During the mosaic BG2 is scrolled +1 px
  in x and y every 2 frames (and back), so the mosaic blocks stay centred.
  Per-frame values: `stage_select.change_transition` / `enter_transition`; pictures of
  every frame: `ref/stage_change_fNN.png`.
- Cursor (BG cells, cols 1..2 of the item row): 4 frames x 8 frames, period 32
  (`elements.cursor_anim`, entries $1280 $1264 $1268 $126C). Stage arrows (cells (4,10)
  hflipped and (4,12)): $1204 $1206 $1208 $120A x 8 frames each.
- Title cursor (sprite 0, 16x16, pal 0): tiles 2,4,2,0 for 9/15/13/16 frames (53-frame
  cycle). Confirm: tiles $108, $11F, $102 x3, $106 x2, $10E x2, $10A x2 (the bomb bursts
  into a flame; positions per frame in `sprites.title_cursor.confirm`), then it is gone.
- Bottom strip (every menu screen, sprites): white bomber at x 44..76, black at 180..212,
  y 180..212 (2x2 16x16 pieces), shadows 16 px higher (palette 4, priority 0); the bomb
  (16x16 at y 196) rolls 5 px/frame between them, each kicks it; loop **52 frames**.
  Shadows: hidden on the main screen (under BG1), on the sub screen (TS = OBJ) and colour
  math SUBTRACTS them from BG1 (CGWSEL $02, CGADSUB $81): pixel = max(0, BG1 - OBJ) per
  5-bit channel. After START on stage select the strip plays the "go" frames
  (`stage_select.go`).
- Title idle: 1024 frames -> fade to the attract demo (any button restarts the count).

## Graphics / layout facts
- All menu screens: mode 1, BG3 priority, BG1 + BG2 16x16 tiles (`bgmode_raw` $39), BG1
  map $4000 64x64 cells (1024x1024 px), BG2 map $5000 64x64; OBSEL 3 (16x16 / 32x32 sprites;
  everything here uses 16x16). TM = BG1+BG2+OBJ, TS = OBJ.
- The four menu screens sit side by side in BG1 at x = 0 (mode), 256 (players), 512
  (rules), 768 (stage), vofs 1023 (screen y = BG y); switching = changing BG1 hofs.
  Rows (16 px cells): 0..9 the panel on the stone wall, 10 wall top, 11 kerb, 12 road with
  the white line, 13 road. Rows 0..9 outside the panel (cols 0 and 15) and rows 10..13
  are the repeatable texture (`texture_rows`: distinct entries per row; rows 10..13 are
  2..5 distinct entries, row 13 a single one). The panel frame = 1222/1244/122A/1228/
  1226/122C/1224/1242/120E/1220/120C/1200 pieces (rows 1..9), so a taller panel is
  made by repeating the "item row + separator" pairs (rows 2..3 pattern).
- Stage select: BG1 has a 112x112 hole at (32, 32) (cells cols 2..8, rows 2..8); the
  preview is BG2 behind it. All 10 previews are pre-drawn in BG2 at different scrolls
  (`stage_select.stages[].bg2_hofs/vofs`); the BG2 palettes are reloaded per stage (each
  `screens/stage_NN/` has its own CGRAM). A preview is a 7x7 grid of 16x16 cells drawn
  with the stage's own art: a border ring (corner / edge pieces, row 0 and 6, cols 0 and
  6) and a stylised 5x5 inside (floor, hard block, soft block, gimmicks) — not the real
  13x11 map. `stage_select.preview[]`: `cells` (7x7 BG2 entries), `tiles` (each distinct
  entry -> PNG + a best-match label from the stage's arena metatiles, `stages/stageNN/
  stage.json`, with the mean RGB difference: 0 = the same art).
  A tall (portrait) preview can keep the 7 columns and repeat inner rows / the side edge
  pieces, or use the arena metatiles at the same 16 px cell size.
- STAGE number: one 16x16 BG1 cell at (4,11) = screen (176, 64): $1160+2(n-1) for 1..8,
  $1180 = 9, $1182 = "10" (`elements/stage_number_NN.png`). Rules digits use the same
  font ($1160 = 1 ... $1180 = 9).
- Title: BG1 = logo + the three items + copyright (static), BG2 = sky, clouds and the
  buildings in the bottom corners (static: no scroll or palette animation over 600
  frames), 65 static sprites (logo bomb, the two Bombermen) + the cursor.

## menus.json schema (top level)
- `screens{title,mode,players,rules,stage}`: dir of the dump.
  `screens/<key>/screen.json`: `ppu` (registers), `palettes` (bgr555[256], rgb), `layers.bgN`
  {sc_base, sc_size, char_base, bpp, tile_px, hofs, vofs, width, height, on_main, on_sub,
  image, entries[H][W] raw words}, `sprites[]` (decoded OAM + w/h); files `frame.png`,
  `bg1..3.png` (whole layers, RGBA, alpha 0 = transparent), `obj.png` (sprites composed,
  256x224), `chars_bg12.png` / `chars_bg3.png` (INDEXED, value = colour in palette),
  `vram.bin`, `cgram.bin`. Also `screens/stage_01..10/`.
- `input.buttons[screen][button]` {goes_to, sound, map_changed}; `input.hold_repeat`;
  `input.earliest_input_after_switch`.
- `elements`: `cursor_anim`, `cursor_png`, `players_values` / `rules_values`
  [{item, row, cols, bbox_px [x,y,w,h], variants [{name, entries, png}], sounds}],
  `*_values_left` (cycle order with LEFT), `*_items` (labels).
- `sprites`: `bottom_strip` {period_frames, pieces[] (atlas `sprites/bottom_NNN.png`),
  frames[] {pieces [[id, x, y, prio]...], duration}}, `title_cursor` {idle, confirm, files},
  `title`.
- `stage_select`: preview_hole_px, change_transition[], enter_transition[], stages[]
  {stage, bg2_hofs, bg2_vofs, bg1_map, bg2_visible, preview_png, number_png, screen},
  number_cell, arrows_anim, arrows_png, arrows_cells, left_from_1_shows,
  hold_right_change_starts, go {runs[{idle_frames_before_start,
  fade_starts_frames_after_press, frames}], pieces (atlas `sprites/go_NNN.png`)}, preview[].
- `timing`: title_idle_to_attract_fade, title_to_mode, mode_to_players, players_to_rules,
  rules_to_stage, *_back_to_*, stage_to_match (brightness / forced-blank runs
  [first_frame, value, frames], sounds `$id@frame`, port3 upload markers).
- `texture_rows[screen]`: the visible BG1 rows with their entries and distinct counts.
- `after_match`: the screens after a won match (multitap run), key frames
  `ref/after_match_f*.png`.
- `ref/`: comparison frames (each screen, each cursor position, every stage, the change
  animation, after the match).

## Not extracted / caveats
- TAG MATCH flow, NORMAL GAME, PASSWORD screens (only the title look).
- Sprite priorities are not composed in `obj.png` (all sprites over each other); use
  `sprites[]` / the strip frames with their priority for the shadow subtraction.
- The 1P/2P "MAN" option needs a controller per player; the wall has one pad.

## The wall's front end (public/arcade/sb2/menu.js, packed by tools/sb2/extract/menupack.py)
- The menus are re-run on the battle PPU (render/ppu.js) from the original's VRAM / CGRAM
  (`pack/menu.json` + `menu.bin`): title VRAM, menu VRAM (+ the stage screen's BG1 cells),
  per stage the preview chars 0..255 + CGRAM; the strip / "go" pieces as colour indices.
  ppu.js gained the menus' colour math: CGADSUB $81 = BG1 minus the sub-screen sprite
  (the shadows on the wall).
- Re-layout for 256 x 455, cell by cell (16 px), nothing scaled:
  - mode / players / rules: panel (original rows 1..9) at rows 8..16, the wall top / kerb /
    road (rows 10..13) at 25..28, stone wall elsewhere (the original's stone tiles); the
    strip sprites 240 px lower. BG2 (the mode screen's text colours, scrolled 1 px every 4
    frames, measured) moves down with the panel.
  - title: logo / items / copyright and the 65 sprites 96 px lower (rows 6..19), sky with
    clouds above and below, the buildings and the ground at rows 24..28.
  - stage select: panel rows 2..18: preview hole 7 x 7 cells (CLASSIC: the original
    preview) or 7 x 13 (TALL: the real tall arena at round start, rendered by the port,
    1 px in 2 = 8 px per cell, `mini_tall.png`), STAGE / number with arrows in the right
    column, a separator and the wall's extra row "TALL" / "CLASSIC" below. UP/DOWN picks
    the row ($51); the active row's arrows animate; LEFT/RIGHT on either row runs the
    original preview transition (mosaic, 46 frames, silent).
  - "TALL" / "CLASSIC" and the results' "0": new 16x16 cells composed from the original's
    own label font (glyphs = letter body components + their outline, cut out of STAGE,
    BATTLE, TIME, COM LEVEL, G-BOMBER, 1PLAYER) / the "0" of TIME 2:00, written into
    tiles no map or animation uses.
- Check: `node tools/sb2/qa/menucheck.mjs && python3 tools/sb2/qa/menucheck.py` — every
  region kept from the original (the three panels, the stage panel's right column and
  preview, the title's logo / items / sprites) is pixel-identical to the harness frames
  (143 104 / 143 104 px). Timings in Node (menu frames): title A -> mode fully bright
  +192 (original +191), switches +2 / +3 / +3, stage select input from +46, stage START ->
  match +316 then the core's 15-tick fade-in (first bright frame +331, as the original).
- Differences from the original, on purpose: the title starts on BATTLE GAME and only it
  goes on (NORMAL GAME / PASSWORD keep their look, do nothing); TAG MATCH does nothing;
  B on the title leaves for the Arcade shelf; 2P defaults to COM (one pad on the wall; a
  2P MAN stands still); no attract demo; the results are the player table with each
  one's wins (the round / match winner marked by the cursor, his cheering figure above)
  instead of the scoreboard / VICTORY!! / roulette screens; G-BOMBER ON makes the match
  winner the next match's gold bomber with a random bonus (the roulette's pick).
