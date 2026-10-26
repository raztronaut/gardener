# SB2 battle core — API, `game.state` and `game.events`

ES modules, no dependencies, no DOM: runs in the browser and in Node.

## API (`index.js`)

```js
import { createGame } from './core/index.js';
const game = createGame({
  stage: 1..10,                        // select-screen order
  layout: 'original' | 'tall',         // 13x11 or 13x25 playfield
  players: [{ type: 'human' | 'cpu', level: 1..9 }, ... x4],   // P1 white, P2 black, P3 red, P4 blue
  rules: { wins: 1..5, time: 1|2|3|5|Infinity, gbomber: bool, comLevel: 1..9,
           champion: slot|null, bonus: 0..5 },                 // G-BOMBER of the previous match
  seed: 0..65535,                      // RNG seed ($00D6) at round init; 0 = like power-on
});
game.tick(pads);   // exactly ONE original logic tick. pads = 4 masks in the harness's
                   // libretro bit order: B=1 Y=2 SELECT=4 START=8 UP=16 DOWN=32 LEFT=64
                   // RIGHT=128 A=256 X=512 L=1024 R=2048 (null = no controller).
                   // A = bomb / lift+throw (glove), B = remote detonation, X = stop your
                   // kicked bomb, Y = stage action (stage 10 jump).
game.events        // events of the last tick (see below)
game.state         // renderer view (below), cached per tick
game.finished      // round over AND its 256 extra ticks have run
game.nextRound()   // scoreboard bookkeeping + next round init; returns {winner, wins, matchOver}
game.newMatch({ champion, bonus, stage })   // next match (champion = gold bomber)
game.save() / game.load(s)                  // full serialisation (JSON-safe)
game.mem           // the authoritative state: a 128 KiB image laid out like the original
                   // WRAM (see mem.js and tools/sb2/NOTES-re.md); the logic reads/writes
                   // only this, so a saved image replays identically.
```

Timing: the original runs one logic tick per 60.1 Hz video frame (it drops frames on
overrun; ignore that — call `tick()` once per frame). For the first 16 ticks of a round
the screen fades in and the bombers are frozen (`state.frozen`); the clock and bombs
already run.

## `game.state`

All coordinates are the original's: cell (cx, cy) with the playfield at cx 2..14,
cy 4..14 (tall: cy 4..28); the border ring is cx 1/15, cy 3/15 (tall 3/29). A bomber at
pixel position (x, y) stands in cell ((x+8)>>4, (y+23)>>4); its 16x16 solid box is
[x-8, x+7] x [y-7, y+8]; its 16x32 sprite's bottom edge is the bottom of its cell.
Screen (original): cell (cx, cy) is drawn at (16cx-8, 16cy-23) incl. the 25 px HUD;
sprite pixel (x-8, y-24) top-left.

| field | meaning |
|---|---|
| `tick` | ticks of this round (`$32`) |
| `rng` | RNG seed |
| `stage`, `stageId`, `layout` | 1..10, the original's id (`$1A`), `'original'`/`'tall'` |
| `brightness`, `frozen` | fade-in 0..15; bombers frozen until 15 |
| `clock` | `{min, sec, sub, infinite, timeUp, stopped}`; one displayed second = 65 ticks |
| `hurry` | the "Hurry!" banner has been triggered (0:38) |
| `suddenDeath` | falling blocks running |
| `roundOver`, `overTicksLeft`, `finished` | ≥ 3 bombers dying → round over, 256 more ticks |
| `winner` | after the round: slot 0..3 or `'draw'` |
| `wins` | win counters P1..P4 |
| `grid` | `{cols:[0,16], rows:[2,16] (tall [2,30]), width, height, code[], under[], tile[]}` row-major arrays: `code` = collision byte (`$00` floor, `$C2` soft, `$C5` hard, `$C6` wall, `$43` bomb, `$44` item, `$01` fire, `$41` burning item, `$C1` sudden-death block, stage gimmick codes — SPEC §2, notes-stages), `under` = what the cell reverts to, `tile` = the BG tile word the game wrote for the cell (item icons, flame pieces/phases, burning-block frames, gimmick tiles — match them to `stage.json` metatile `entry`/`entries`) |
| `items[]` | `{cx, cy, tile, kind}` kind = `bomb_up fire_up full_fire speed_up skull glove kick power_bomb rubber_bomb remote pierce wall_pass bomb_pass heart` |
| `fire[]` | `{cx, cy, tile, burningItem}` cells currently fire (tile = flame piece + phase) |
| `burning[]` | `{cx, cy, item, frame, timer, owner}` soft blocks / items burning |
| `bombers[4]` | see below |
| `bombs[]` | `{slot, cx, cy, owner, fuse, range, type, exploding, moving, triggered, timer, frame, tile, flags}` — fuse counts bomb updates (2 ticks each); `frame`/`timer` = the fizz animation; a bomb being kicked/thrown/carried has `moving` and is drawn from its mover |
| `movers[]` | other objects: `{slot, kind: 'bomb'|'item'|'block'|'object', x, y, height, state, facing, anim, bomb}` — kicked/thrown/carried/conveyed bombs, flying items (scattered, skull fly-off), pushed blocks (stage 2) |
| `events` | same as `game.events` |

Bomber: `{slot, active, dying, gone (death animation finished, removed), x, y, xf, yf,
cx, cy, facing ('up'|'down'|'left'|'right'), moving, input, anim:{set, id, timer, script,
pose}, state (+52), busy, carrying, lifting, stunned, jumping, com, level, gold, hidden
(skull blink: don't draw), flicker (shield hit), offscreen, speedLevel, speedBase,
bombsCap, bombsHand, bombsOut, fire (reach = fire+1), bombType, kick, glove, wallPass,
bombPass, shield, disease (blink|diarrhea|constipation|fast|slow|weak|null), wins}`.

Animation: `anim.pose` is the 24-bit id of the sprite frame the original would show
(its OAM frame pointer, changes exactly when the game changes frames); `anim.id` the
animation (facing code 2/4/8/$10 for walking/standing, $1E death …), `anim.set` the
animation set (+50), `anim.timer` the frames left in the current pose ($FFF = held).
Bombs: `frame` is the fizz phase. Flames and burning blocks animate through
`grid.tile`. Stage gimmick animation states are in `grid.tile` (conveyors, pads,
teleporters, fuse ring) plus the per-stage events.

## `game.events`

Each event: `{type, tick, ...}`; a `cell` (grid index) also comes as `cx`/`cy`;
`player`/`slot` = bomber slot 0..3; `sfx` = the original's sound-effect id when the
event plays one. Bomb place $48, explosion $42, item $4C (kick item $61, skull $55),
kick $44, lift $48, throw $43, land $45, hurry $4E, falling block $72, draw $46.

| type | when |
|---|---|
| `roundStart` | round initialised |
| `clock` | displayed second changed (`min`, `sec`) |
| `hurry` | 0:38 banner |
| `suddenDeath` | falling blocks start |
| `blockFell` | one sudden-death block landed (`cx`, `cy`) |
| `bombPlaced` | (`slot` = player, cell) |
| `bombExploded` | (`bomb` slot, cell) |
| `chain` | a bomb was set off by another's blast |
| `remote` | B detonation |
| `itemRevealed` | a burnt soft block revealed an item |
| `itemGot` | pickup (`slot`, item tile/kind) |
| `itemScattered`, `itemFly`, `itemLand` | dead bomber's items / skull fly-off / stun item drop |
| `disease`, `cured`, `diseaseSwap` | skull effects |
| `kick`, `kickStop`, `lift`, `throw`, `bounce`, `land`, `stun` | movers |
| `shieldHit` | heart absorbed a hit |
| `died` | a bomber started dying (`player`) |
| `roundOver` | ≥ 3 bombers dying |
| `roundEnd`, `roundResult`, `matchOver` | after the 256 ticks / scoreboard |
| `fuseRing` | stage 4 ring ignites |
| stage events | `blockPushed` (stage 2 push), `holeFall` / `holeLaunch` / `holeLand` (stage 2), `bombersBump` (stage 3 push), `tunnelEnter` / `tunnelExit` (stage 3), `fuseRing` (stage 4), `stageAnim` (stage 5 plate shine phase), `teleport` (stage 6), `speedPad` / `stopPad` (stage 7), `conveyorSwitch` (stage 8: direction / fast), `jump` (stage 10), `blockRegrow` (stage 10), `sfx` (other sound effects by id) |

Stage gimmick animation states the renderer may need beyond `grid.tile`: stage 5 plate
shine phase `$5E2A` b0 (event `stageAnim`); stage 8 belt scroll phase `$5CBA` (0..3) and
switch animations `$5CC4..$5CCA`; stage 9 panel colour cycle `$5CC2`; stage 10 regrowth
frames come through `grid.tile`. Read them with `game.mem` (`mem[0x5CBA]`…) or add them
to view.js when 3b needs them.

Tall layout (`layout: 'tall'`): rows 3..29 (playfield cy 4..28); `grid.rows = [2, 30]`
(the stage-3 tunnels use rows 2/30); positions are not masked to 8 bits (y up to 448);
dead bombers park at y $1F0. The renderer composes the arena from metatiles: every tall
row copies one row of the original map, so `grid.tile` holds original tile words.
