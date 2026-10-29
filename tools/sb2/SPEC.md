# Super Bomberman 2 — BATTLE MODE specification (measured)

Status: phase 2b. Every rule below is tagged:
- **[code]**: read from the 65816 routine named.
- **[meas]**: measured in the instrumented harness. Most are reproduced by a test vector
  in `data/sb2/vectors/` (generator: `tools/sb2/re/vectors.py`).
- **[infer]**: inferred and not independently confirmed.

Addresses, RAM layouts and routine lists: `NOTES-re.md`. Sub-notes:
- `re/notes-ai.md`: the CPU AI in full;
- `re/notes-stages.md`: stage maps and gimmicks;
- `re/notes-round.md`: round flow.

---------------------------------------------------------------------------------
## 0. Units and conventions

- **tick**: one execution of the game's main loop. The SNES runs at 60.0988 video
  frames/s.
  - A tick is normally one frame. When a tick overruns, the game drops a frame (a lag
    frame) and the next tick starts one frame late.
  - Rules are defined in ticks. ~~The port should run exactly one tick per 60 Hz frame and
    ignore lag.~~ **Corrected:** the game SPEED is set by the lag: the port reproduces the
    original's lost frames from a measured cost model (`tools/sb2/NOTES-pacing.md`,
    `public/arcade/sb2/pacing.js`); the rules themselves stay per tick.
  - Vectors record the tick counter, so the original's frames can be mapped to ticks.
    [code `C0FB11`, NMI `00FD84`]
  - **Corrected in phase 3a [code + meas]:** the NMI increments `$32` at the START of a
    frame when the previous tick has completed (`$16 != 0`); the tick then runs with
    `$32` = its own index (the even/odd rule uses that value). A round's first tick runs
    with `$32 = 0` (round init clears `$16`). `$32` can be **double-incremented**: when a
    tick ends right before vblank the NMI lands between `INC $16` and the main loop's
    wait, so the next NMI counts the same tick again — that `$32` value never runs (its
    parity is skipped). After the round's last tick one more NMI increment happens
    (C0FBB3), so the scoreboard and the next round init run with `$32` = last + 1.
- **Even/odd ticks.** Bombs and explosions update only on even ticks (`tick & 1 == 0`).
  Burning soft blocks update only on odd ticks. Sprite animations mostly run at 30 Hz.
  [code `C0E0AA`, `C0DCB4`]
- **Positions** are 16.16 fixed point, in arena pixels. A bomber's logical position (x, y)
  is such that:
  - **cell = ((x + 8) >> 4, (y + 23) >> 4)**;
  - a bomber centred in cell (cx, cy) has **x = 16·cx, y = 16·cy − 16**.
  - Equivalently, use "arena coordinates" left = x, top = y + 16: cell (cx, cy) spans
    pixels [16cx, 16cx+15] × [16cy, 16cy+15], and the bomber's solid box is exactly one
    cell-sized square [left, left+15] × [top, top+15].
  - Measured: P1 starts at (32, 48) = cell (2, 4). [code `C0BFE2`, meas]
- **Grid** (see §2): the arena is columns 1..15 × rows 3..15, including the border
  ring. The playfield is columns 2..14 × rows 4..14 (13 × 11).
- **Screen** (256×224): the HUD occupies rows 0..24 (row 24 is a black separator line).
  - Cell (cx, cy) is drawn at screen x = 16·cx − 8, y = 16·cy − 23.
  - The arena shows the top wall (y 25..40), 11 inner rows (41..216), and only the top
    7 px of the bottom wall (217..223). 8 px of outside area show at the left and right
    edges.
  - A bomber sprite is 16×32. Its bottom edge is the bottom of its cell.
  - [meas: framebuffer + OAM in battle_start]

---------------------------------------------------------------------------------
## 1. Tick order (what happens within one tick)
[code, main loop `C0FB39..C0FB89`]
1. Read the pads (`C01602`). Each human bomber's +6E = its pad (SNES bit order).
2. Stage/HUD housekeeping.
3. **Bombers**, in slot order P1, P2, P3, P4 (`C01E1D`). Each bomber, only while the
   round runs (`$30 & $0F == $0F`) and the bomber is controllable:
   1. cell lookup;
   2. COM AI (COM only);
   3. disease effects;
   4. movement + collision;
   5. item pickup;
   6. bomb button / remote / stop-kick buttons;
   7. animation.
4. Burning soft blocks: odd ticks only.
5. **Bombs**: even ticks only, in bomb-slot order (§5).
6. Danger-map decay (AI).
7. Moving objects: kicked/thrown bombs. Then disease swaps between touching bombers.
8. RNG step (§16), sprites, sound.

Consequence: fire written in step 5 kills a bomber on the *next* tick (step 3). Measured:
fire appears on tick T, P1 dies on tick T+1.

---------------------------------------------------------------------------------
## 2. Arena grid and cell types
[code `C0BFE2`, `C0DDF7`; meas dumps]

- Logical grid: 64 × 32 words at `$7FC000` (one word per cell, row stride 64 cells).
  An underlay grid at `$7FD000` holds what a cell reverts to when a bomb, fire or item
  leaves it.
- Cell byte layout: bit 7 = solid, bit 6 = "object", bits 0..5 = type.

| value | meaning | blocks bombers | stops fire |
|---|---|---|---|
| `$00` | floor | no | no |
| `$C2` | soft block (type 2) | yes (unless wall-pass) | yes; is destroyed |
| `$C5` | hard block / outside the arena | yes | yes |
| `$C6` | border wall | yes | yes |
| `$43` | bomb (type 3) | special (§4.4) | triggers that bomb |
| `$44` | item (type 4) | no (picked up) | burns it, stops |
| `$41` | burning item (type 1 = fire) | no — kills | — |
| `$01` | fire | no — kills | no |
| others | stage gimmicks (`$09`, `$0B`, `$0E`, `$0F`, `$11`, `$16`, `$22`, `$26`, `$49`, `$50`, `$55`, …) | see `re/notes-stages.md` | `$09`/`$0F` let fire through; `$0B`/`$26` stop it |

---------------------------------------------------------------------------------
## 3. Bomber stats
[code item handlers `C098C2..C09C5B`, bomb code `C03082`; meas: item_* vectors]

Per bomber there are "base" values and "current" values. A disease changes the current
values; curing restores them from the base values.

| stat | field (current/base) | start | max | effect |
|---|---|---|---|---|
| speed level | +F0 / +E0 | 1 | 5 (base), 6 = fast disease, 0 = slow | speed table below |
| bomb capacity | +E1 | 1 | 9 | bombs in hand +F1 = cap − bombs out (+F8) |
| fire | +F2 / +E2 | 1 | 9 | blast reaches **fire + 1** cells per direction |
| bomb type | +F3 | 0 | — | 1 remote, 2 power, 4 pierce, 8 rubber. **Only one type at a time: the latest pickup replaces it.** |
| kick | +FF | 0 | — | non-zero = can kick |
| glove | +FE | 0 | — | non-zero = can lift/throw own bombs |
| wall-pass | +FB | 0 | — | soft blocks are passable |
| bomb-pass | +FA | 0 | — | lets the bomber step onto bomb cells during slides |
| shield | +EF | 0 | — | absorbs a fire hit (flicker instead of death); counts down |
| disease | +F5 | 0 | — | §9 |

**Speed table** `$C5FB07`, px/tick [code; meas levels 0, 1, 5, 6]:

| level | 0 | **1** | 2 | 3 | 4 | 5 | 6 | (7) | (8) | (9) | (10) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| px/tick | 0.5 | **1.25** | 1.5 | 2.0 | 2.5 | 2.75 | 3.0 | 0.8125 | 0 | 0.375 | 3.5 |

- Levels 1..5 are reachable with Speed Up. 0 = slow disease, 6 = fast disease. 7..10
  are used elsewhere (gimmicks or the normal game).
- Measured in vector speed_levels: exactly 0.5 / 1.25 / 2.75 / 3.0 px per tick (16.16
  accumulation; e.g. level 1 shows +1, +1, +1, +2 px).

---------------------------------------------------------------------------------
## 4. Movement
[code `C0A474`, `C0C2CE`, `C0A98E` and handlers `C0AED4` R, `C0B2DE` L, `C0B40C` D,
`C0B854` U, `C0B62D` R+D, `C0B6A8` L+D, `C0B723` R+U, `C0B79E` L+U; meas: vectors
corner_offsets, walk_cleared, walk_natural]

Per tick, for each controllable bomber:

1. Save the old position (x, y and their fractions).
2. **Velocity from input.**
   - Up or Down held → vy = speed (sign from the direction); otherwise vy = 0.
   - Left or Right held → vx = speed; otherwise vx = 0.
   - Opposite pairs are filtered for humans by the input routine (C01625: L+R and U+D
     both cleared, phase 3a); the dispatcher also ignores them.
3. **Integrate**: x += vx, y += vy (16.16).
4. **Dispatch** on the motion direction: R=1, L=2, D=4, U=8, from the velocity (or from
   the input when the velocity is 0).
   - Combinations with 3 or 4 directions, or opposite pairs, do nothing.
   - **Diagonals R+D, L+D, R+U, L+U never move diagonally.** Each tick they resolve to
     one cardinal move. R+D (`C0B62D`) is shown; the others mirror it.
     1. "R blocked" = both right corners (x+7, y+8) and (x+7, y−7) are solid.
        "D blocked" = both bottom corners (x+7, y+8) and (x−8, y+8) are solid.
        The blocked axis has its move undone.
     2. Only R blocked → run the D handler. Only D blocked → run the R handler. Both
        blocked → stay.
     3. Neither blocked:
        - facing down (+5E = 8): if either right corner is solid → D handler, else R
          handler;
        - otherwise: if either bottom corner is solid → R handler, else D handler.
     4. In words: keep going the way you face, and **turn into the other held direction
        as soon as it is completely open**. The chosen handler still does its corner
        slide.
     - Measured: holding R+D from (2,6) runs right along row 6 and turns down exactly at
       x = 64 (the first open column).
     - Facing codes +5E: 2 R, 4 L, 8 D, `$10` U.
5. **Right handler** (the others are mirrored; probe offsets below):
   1. Cancel vertical velocity.
   2. If another mobile object (kicked/thrown bomb, rider, …) is within |dy| < 8 and
      0 < dx < 15 ahead, undo the X move and stop.
   3. `front` = cell at (x+7, y), the front edge at the vertical centre line.
      `lower` = cell at (x+7, y+8); `upper` = cell at (x+7, y−7).
      - A soft block counts as `$40` (passable) for a wall-pass bomber.
   4. Bomb rules (§4.4).
   5. If **lower and upper are both solid**: walk x back 1 px at a time until `front`
      is no longer solid, then stop (velocity 0). This snaps the bomber flush against
      the block.
   6. Else if **exactly one corner is solid**: **corner slide**.
      1. If `front` is solid, undo the X move.
      2. Move perpendicular, away from the solid corner, by the full speed:
         y' = old_y ∓ speed, in 16.16 from the saved position.
      3. Then, while the leading corner on that side is solid, step 1 px back.
      4. A bomb at the leading corner stops the slide.
   7. Else: free move.
6. Probe offsets. The bomber's solid box is the 16×16 square [x−8, x+7] × [y−7, y+8].
   - Right: front (x+7, y), corners y+8 / y−7.
   - Left: front (x−8, y), corners y+8 / y−7.
   - Down: front (x, y+8), corners x+7 / x−8.
   - Up: front (x, y−7), corners x+7 / x−8.

Net effect, measured. Holding RIGHT next to a pillar while off-centre by d px (−8..+8,
d ≠ 0):
- the bomber slides toward the open row at full speed (1.25 px/tick at level 1);
- X starts advancing on the tick the front-centre probe leaves the pillar's row;
- at d = 0 the bomber is stuck.

There is **no alignment pull in open space**: with neither corner blocked, a bomber may
stay off-centre. Because every row borders pillars, the slide happens constantly in
practice.

**4.4 Bombs vs movement.**
- A bomber standing on a bomb (just placed, or bomb-pass) may walk off it, but cannot
  walk onto another bomb cell (`C10169`).
- A bomb in front blocks like a solid block. With **kick** the bomb is kicked instead
  (§10).
- A bomb at a slide corner stops the slide.

---------------------------------------------------------------------------------
## 5. Bombs
[code `C03082` place, `C034C0` spawn, `C0E0AA` + `C0E980` update; meas: bomb_single,
bomb_chain]

- **Button A** (SNES A, libretro `A`) places a bomb. It is edge-triggered: holding A
  does nothing more.
  - B = remote detonation (§8). X = stop your kicked bomb (§10). Y is stage-specific
    (see `re/notes-stages.md`).
- **Placement fails** if:
  - the bomber's centre cell is an object cell (bomb or item) — with the glove and the
    bomber's own bomb there, A lifts it instead (§11);
  - ~~the cell is fire~~ — **corrected: placing on a fire cell is allowed** (C031EB: type 1
    is OK; the running fire sets the bomb off on its next even update); only cell type
    `$11` (stage-3 tunnel) forbids placement;
  - a bomb already occupies the tile;
  - a moving object occupies it;
  - bombs in hand = 0.
- **Placement**: bombs in hand −1, bombs out +1. The bomb takes the lowest free bomb
  slot (40 slots). The cell becomes `$43`. The bomb is placed in the bomber's *centre
  cell*.
  - range = the bomber's fire stat.
  - Power-bomb type: range 9 if the bomber has no other bomb out.
  - Some stage-5 tiles also give range 9.
  - type = the bomber's bomb type.
- **Fuse**: counter = 72, decremented on every **even** tick, including the placement
  tick if it is even. Detonation on the update where it reaches 0.
  - Placement on an even tick T → detonation T+142. Placement on an odd tick T →
    detonation T+143.
  - Measured: placed tick 18 → detonated 162; placed tick 19 → detonated 162 (fire
    appears 164).
- **Remote bombs** (type 1) do not count down (§8). Bombs being lifted, carried or
  flying do not use this fuse (§10, §11).
- **Update order and the one-detonation rule**: each even tick, bombs are processed in
  slot order (0..39).
  - An already-exploding bomb advances its explosion.
  - Otherwise: if its cell is fire → detonate now; else count down.
  - **When a bomb detonates, the rest of the list is skipped for that tick.** So at most
    one new detonation happens per even tick, and bombs after it in the list do not
    count down that tick. [code `C0E0E0`]
  - Measured in bomb_same_tick: two bombs placed on the same tick, far apart. Slot 0 went
    off at tick 162; slot 1 kept fuse 1 and went off at 164.
- **Ray order** (phase 3a): detonation walks up, down, RIGHT, LEFT (C0EAA7, C0EB8E,
  C0EC68 = `+C4` table, C0ED42 = `+88`); this decides the burn-list order and therefore
  which block draws which deck card. The ray tables are built at placement; detonation
  only cuts them where they stop.
- **The bomb list `$7E2960` is rebuilt only at the start of each even-tick update**
  (placement/remote/pickup read a possibly stale list). A power-bomb owner placing while
  another bomb is out gets a plain bomb (type 0).
- **Chain reaction**: when a blast ray reaches a bomb, that bomb is triggered at once:
  - its fuse is set to 2 and it is forced to count down (even if remote);
  - its ray pointing back at the trigger is cut;
  - the triggering ray stops at it (fire does not enter the bomb's cell).
  - The triggered bomb therefore detonates **4 ticks** later (2 updates), or earlier if
    its cell becomes fire.
  - Measured (bomb_chain, bombs 2 cells apart, reach 3): detonations at ticks 162, 166,
    170, 174.

---------------------------------------------------------------------------------
## 6. Explosions and fire
[code `C0EA83`, `C0EAA7`.., `C0E0F0`, `C0E14F`; meas]

- **On detonation** (even tick D), each of the 4 rays (up, down, left, right) walks up to
  **range + 1** cells from the bomb:

| cell | effect on the ray |
|---|---|
| `$09` or `$0F` gimmick | passes |
| bomb | triggers it (above), stops |
| soft block / item / `$0B` | queued to burn (§7), stops — pierce bombs continue |
| any other solid, or `$26` / `$04` / `$0B` | stops before it |
| anything else | becomes fire |

  The ray lengths are fixed at D. Later changes (blocks appearing, bombs moving) do not
  re-shape them.
- **Fire**: on each of the next **13 even ticks** (D+2 … D+26), the centre and every ray
  cell are (re)written as fire (`$01`) with the flame tile for that phase.
  - Phases cycle the flame animation 1 update each (table `$C5F415`).
  - On D+28 the cells are restored from the underlay (usually floor) and the bomb slot is
    freed. The owner's bombs out −1 / in hand +1 happen at detonation (`C0E46C`).
  - So **fire exists for 26 ticks, from D+2 to D+27** (cell = `$01`), and kills on the
    tick after it appears.
  - Measured: fire on ticks 164..189, cleared at 190, for D = 162.
- **Overlapping explosions**: a shared cell is simply rewritten `$01` by each explosion.
  When one explosion ends, it restores the underlay on all its cells, including shared
  ones; any explosion still running re-writes its cells on its next update.
  - Within one even tick, explosions are processed in slot order. If the ending
    explosion has the lower slot, the other re-writes the shared cell in the same tick:
    no gap.
  - If the ending explosion has the higher slot, the shared cell is floor for 2 ticks
    (until the next even tick). [code; the first case is measured]
  - Measured (fire_overlap): bombs in slots 0 and 1 share (2,6). Slot 0 ended on tick 190
    and cleared (2,5), but (2,6) stayed fire until slot 1 ended on tick 202.
- Fire on an item: the item burns and the fire does not pass (pierce: passes).
- Bomber in fire: dies (§12).

---------------------------------------------------------------------------------
## 7. Soft blocks, burning and the item deck
[code `C0EF44` queue, `C0DCB4`/`C0DCDA` burn, `C0DE13` reveal, `C01CEA` deck; meas]

- A soft block hit at detonation tick D is queued in the burn list (32 entries). The cell
  stays `$C2` (solid; stops other fire) while burning.
  - Burning advances on odd ticks: 6 frames, 6 ticks each, the first at D+1.
  - At **D+37** the block disappears.
- **Item deck**: at round start the game builds a deck of **64 cards** (`$7E3C48`).
  - It starts all "nothing" (`$8000`).
  - For each item kind k, count[stage][k] cards are dropped into random empty positions:
    position = RNG() & 63, retried while that position is taken.
  - When a soft block finishes burning, the **next card** (left to right, skipping used
    ones) is consumed. Item → the cell becomes `$44` with that item tile. Nothing → floor.
  - So drops depend on the *order* in which soft blocks are destroyed, not on which
    block. The deck does not reshuffle and ends after 64 blocks.
  - Measured: the decks in all 10 battle states match the per-stage counts below exactly.
- **Burning item** (hit by fire): becomes `$41` (type 1 = fire: it kills) on D+1. It
  burns 7 frames × 6 ticks and is gone (floor) at **D+43**. It does not draw a card.
  Measured in vector item_burn: `$41` on 163, floor on 205, D = 162.

**Item counts per battle stage** (the rest of the 64 cards are blanks)
[code table `$C5F225`, ROM; meas decks]:

| stage (id) | bomb up | fire up | full fire | speed up | skull | glove | kick | power bomb | rubber bomb | total |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 (0) | 7 | 6 | 0 | 5 | 1 | 3 | 3 | 0 | 0 | 25 |
| 2 (1) | 6 | 7 | 0 | 5 | 1 | 2 | 2 | 1 | 0 | 24 |
| 3 (2) | 6 | 6 | 1 | 4 | 1 | 3 | 0 | 1 | 0 | 22 |
| 4 (5) | 5 | 5 | 0 | 5 | 1 | 2 | 2 | 0 | 0 | 20 |
| 5 (6) | 6 | 2 | 0 | 5 | 1 | 0 | 3 | 0 | 2 | 19 |
| 6 (7) | 5 | 5 | 0 | 5 | 1 | 0 | 4 | 1 | 3 | 24 |
| 7 (8) | 6 | 6 | 1 | 0 | 1 | 3 | 0 | 0 | 0 | 17 |
| 8 (9) | 6 | 6 | 0 | 6 | 1 | 2 | 2 | 1 | 2 | 26 |
| 9 (A) | 6 | 6 | 0 | 5 | 1 | 0 | 5 | 1 | 1 | 25 |
| 10 (B) | 7 | 5 | 1 | 5 | 1 | 3 | 2 | 1 | 2 | 27 |

- The deck order of kinds (k = 0..10) is: bomb up `1600`, (pierce `1604`), fire up `1602`,
  full fire `1606`, speed up `1622`, (remote `160E`), skull `160A`, glove `1626`, kick
  `1624`, power bomb `162A`, rubber bomb `1628`.
- Pierce and remote have 0 cards on every battle stage. They exist only in the unused
  id 3/4 tables. So SB2 battle never drops remote, pierce, wall-pass, bomb-pass or heart.
  Their effects are still implemented (vectors item_*).
- The RNG draw order matters for exact decks: kinds in table order; per card, retries
  draw again.

---------------------------------------------------------------------------------
## 8. Items (pickup and effects)
[code jump table `$C5F145` → handlers; meas: one vector per item, all confirmed]

- **Pickup**: when the bomber's centre cell holds an item (`$44`), on that bomber's tick.
  The cell reverts to the underlay at once.
  - Measured: walking right from x = 32, the pickup happens at x = 40 (centre enters
    the cell).
- **Any pickup first cures a disease** (+F5 = 0, stats restored), then applies the item.

| tile | item | effect |
|---|---|---|
| `1600` | Bomb Up | capacity +1 (max 9); in hand = capacity − out |
| `1602` | Fire Up | fire +1 (max 9) |
| `1606` | Full Fire | fire = 9 |
| `1622` | Speed Up | speed level +1 (max 5) |
| `1624` | Kick | can kick bombs (§10) |
| `1626` | Power Glove | can lift and throw own bombs (§11) |
| `160A` | Skull | random disease (§9) |
| `162A` | Power Bomb | type 2: a bomb placed with no other bomb out gets range 9 |
| `1628` | Rubber Bomb | type 8: a kicked/thrown bomb that hits an obstacle picks a random new direction (RNG `$0408 & $1E` → table `$C5FC6D`) instead of stopping |
| `160E` | Remote Control | type 1: bombs never count down; **B** detonates the oldest live remote bomb (fuse := 2, forced). Not in battle decks. |
| `1604` | Pierce | type 4: blast passes through soft blocks and items (burning them all). Not in battle decks. |
| `1620` | Wall Pass | soft blocks passable. Not in battle decks. |
| `1608` | Bomb Pass | Not in battle decks. |
| `1640` | Heart | shield +1. Not in battle decks. |

Bomb types are exclusive: picking up power, rubber, remote or pierce replaces the
previous type.

---------------------------------------------------------------------------------
## 9. Diseases (Skull)
[code `C099DF`, `C03686`, `C0362B`, `C030A6`, `C002AB`/`C00445`/`C0055A`; meas:
item_skull, skull_swap]

- **Picking a skull**: disease = table[RNG & 15], with RNG from `$0400` this tick.
  - Normal table `$C5EEB5` = 1 2 3 4 5 6 1 2 3 4 5 6 2 4 5 6.
  - Stage 7 uses `$C5EEC5` = 1 2 3 1 2 6 1 2 3 6 3 6 2 1 3 6.
  - A bomber with a shield uses `$C5EED5` = 1 4 3 4 5 6 1 4 3 4 5 6 4 4 5 6.
  - Disease 3 becomes 2 for COM bombers.

| id | disease | effect |
|---|---|---|
| 1 | blink | the sprite toggles visible/invisible on a growing schedule. Table `$C5EE5D` gives the durations as alternating (hidden, visible) pairs: (1,1)×5, (2,2)×5, (2,4)×2, (3,6)×2, (4,8)×3, (6,10)×3, … Logic is unaffected. |
| 2 | diarrhea | tries to place a bomb automatically every 2nd tick |
| 3 | constipation | cannot place bombs (in hand = 0) |
| 4 | fast | speed level 6 (3.0 px/tick) |
| 5 | slow | speed level 0 (0.5 px/tick) |
| 6 | weak | fire 0 (reach 1), in hand = 1 if no bomb is out else 0 |

- **Duration**: **no timer**. It lasts until the bomber picks up any item, swaps it away,
  or dies.
  - Code: no other writer of +F5.
  - Measured: disease 5 still active after 4000 ticks.
- All six effects were measured by forcing the skull roll (`$0400` poked).
  - Speeds measured: 3.0 / 0.5 px per tick.
  - Disease 2 drops a bomb at once; 3 never drops one; 6 gives fire 0.
- **Contagion**: when two living bombers share a centre cell (equal +A8), their diseases
  (and +E9 counters) are **swapped**. This is edge-triggered once per contact, per pair
  (6 pairs), and stats are re-derived.

---------------------------------------------------------------------------------
## 10. Kick
[code `C0AFAF`, moving-object code `C08230..`; meas: kick vector]

- A bomber with kick walking into a bomb cell (front probe on a bomb):
  - its velocity is zeroed;
  - the bomb is converted into a moving object that travels **2 px/tick** in the
    bomber's facing direction;
  - its grid cell is freed while it travels.
- The bomb's fuse keeps running while it slides: it is decremented every 2 ticks by the
  mover. Measured: 64 → 63 → … during the slide.
- It stops when the next cell is blocked: solid, bomb, bomber or other mover. It snaps to
  its current cell and becomes a normal bomb again.
  - Rubber bombs re-aim randomly instead.
- **It rolls over items and destroys them** (no pickup).
- **Rolling into a fire cell detonates it at once.**
- Measured, bomb kicked down column 2 from (2,5):
  - an item at (2,9) was erased when the bomb passed;
  - a soft block at (2,9) stopped it at (2,8);
  - a fire cell at (2,9) detonated it on entry (flags `$C080`, at grid (2,9));
  - P4 at (2,14) stopped it at (2,13).
- **X** stops your own sliding bomb **at once, in the cell under its centre** (`C029FD` →
  `C08BDA`; corrected in phase 3a).
- Phase 3a details (NOTES-core-movers.md): the kicked bomb's fuse is decremented by the
  mover on ODD ticks and never below 1; kicking needs exactly one direction held and a
  bomb ahead with fuse ≥ 3; a rubber bomb kicked into an obstacle rolls BACK (random
  re-aim only when landing after a throw); items under a kicked bomb are erased except a
  skull, which flies 3 cells in a random direction.
- The kicker cannot follow into the bomb's previous tile until it has moved on (mover
  collision).

---------------------------------------------------------------------------------
## 11. Power Glove (lift and throw)
[code `C02F6E` lift, `C02CAF` throw, `C02DCF` distance; meas: glove_throw, ad-hoc]

1. **Lift**: press A while standing on **your own** bomb whose fuse is ≥ 4.
   - The bomb is picked up (cell freed, +52 = 3); its fuse freezes while carried.
   - Lift animation: 15 ticks, then +52 = 6 (carrying).
   - The bomber can walk while carrying.
2. **Throw**: release A.
   - The bomb flies in the facing direction from the bomber's position, 16 px above the
     ground:
     - 4 px/tick along the axis;
     - a vertical arc (sprite height);
     - normally **3 cells (12 ticks)**.
   - If a bomber stands 2..5 cells ahead in the line, the distance is shortened to land
     on it (`C02E0E` scans 4 cells).
   - The fuse runs again during the flight.
3. **Wrap-around**: a bomb thrown off the arena edge re-enters from the opposite side.
   - Measured: thrown left from (2,4) it lands at (14,4); thrown up from (2,4) it ends
     at (2,13).
4. **Bounce**: if the landing cell is occupied (wall, block, bomb, bomber), the bomb
   hops one more cell (16 px at 2 px/tick, 8 ticks) and checks again.
   - A bomber it lands on is **stunned for 28 ticks**: +52 = `$81`, no movement.
     - Measured: thrown from (2,4) at P2 on (5,4). The bomb hit P2 on tick 60, P2 was
       frozen through tick 87 and moved on 88. The bomb bounced on to (6,4).
5. It then becomes a normal bomb with its remaining fuse. Measured: thrown at fuse 68,
   it landed with 61. **A landing bomb with fuse < $38 gets $38** (C10734, phase 3a).
6. Phase 3a: a bomb thrown at a bomber who carries a bomb is deflected back (unless it is
   a power bomb and the carried one is not); a stunned bomber loses 1..3 items
   (`$C5EDFF[$0404 & 15]`; skulls/disease first) which fly 1..5 cells; sounds: lift $48,
   throw $43, landing $45 (NOTES-extract's lift/throw labels are swapped).

---------------------------------------------------------------------------------
## 12. Death
[code `C0A5C9`/`C0A675`; meas: death_own_bomb, death_two]

- A bomber whose **centre cell** is fire (`$01` or `$41`) on its tick:
  - with shield > 0: the shield is decremented and the bomber flickers invulnerable (+B9
    timer `$C0`);
  - else it starts dying: +00 bit 11, +52 = `$0801`, death animation `$1E`.
- It stops being controllable immediately. Its bombs stay on the field.
- Measured: fire appears tick 164 → death flagged tick 165.
- Phase 3a: the death animation's end (`+0C == $0FFF`, C0A7FA) parks the bomber at
  (0, $F0) and queues its items (C097A0): counts from its stats (bomb/fire/speed − 1, no
  skull/heart, no speed-up on stage 7) re-appear one per tick (C09615) at a random entry
  (`$0400 & $FE`) of a 128-cell free-cell list built from grid indices `$204..$7FF`; an
  entry past the list or an occupied cell loses the item. (Missing from the first SPEC.)

---------------------------------------------------------------------------------
## 13. Round flow
[code + meas, details in `re/notes-round.md`; vectors timeout_sudden_death, round_win,
cpu_round]

- **Settings** (menu → RAM):
  - COM LEVEL 1..9 → `$5C58` = level−1;
  - BATTLE 1..5 → `$5C5A` = wins needed;
  - TIME 1:00 / 2:00 / 3:00 / 5:00 / ∞ → `$5C54` = 0..4;
  - G-BOMBER → `$5C5C`.
  - Defaults: level 5, 3 wins, 2:00, G-BOMBER on.
- **Round start**:
  - Every round fully resets the bombers: all stats and items back to the start values.
  - The tick counter restarts at 0.
  - There is **no READY/GO countdown**. The screen fades in, brightness `$30` +1 per tick,
    15 at tick 16.
  - **Bombers are frozen until brightness is 15** (first movement on tick 16). The clock
    and bombs run from tick 0.
  - The soft-block layout is re-generated each round (see stages); spawn corners are
    fixed per match.
- **Clock** (`$5E10` min, `$5E12` sec, `$5E14` sub-counter): **1 displayed second = 65
  ticks**.
  - The first decrement is at tick 64, then every 65 ticks.
  - 65 ticks after 0:00 is shown → time up (`$5C56 = 0`); for 2:00 that is tick 7864.
  - TIME = ∞ never counts down, and has no sudden death.
- **"Hurry!"** at 0:38: banner + sound only.
- **Sudden death** starts when the clock shows **0:33**:
  - One block per **15 ticks**. For 2:00, block n lands at tick 5656 + 15n.
  - Order: a clockwise spiral starting at (2,4) — top row left to right, right column
    down, bottom row right to left, left column up — then the second ring the same way.
  - **80 blocks** (the two outer rings), then it stops. The full 143-cell spiral exists
    behind a hidden option `$1C68`.
  - Cell order n = 0..79:
    - (2..14, 4)
    - (14, 5..14)
    - (13..2, 14)
    - (2, 13..5)
    - (3..13, 5)
    - (13, 6..13)
    - (12..3, 13)
    - (3, 12..6)
  - A landing block makes the cell `$C1` (solid, type 1) in both grids on its first tick.
    It overwrites floor, soft blocks (their item is lost), items and hard blocks; `$4C`
    cells are skipped.
  - A bomber whose centre cell it is **dies that tick** (type 1 = fire for the death
    check).
  - A bomb there is **deleted without exploding** and returned to its owner.
  - A running explosion keeps rewriting its fire over the block until it ends, then
    restores `$C1`.
  - Stage 3 also closes its 4 two-deep border tunnels at sudden-death start.
  - Measured: block cells at ticks 150, 165, 180, … in timeout_sudden_death (clock poked
    to 0:35).
- **Time up**: every bomber is killed through the normal death routine → no survivor →
  **draw**. Measured: all four die on tick 2359 of the vector.
- **Round end**:
  - Each tick, count bombers flagged dying (+00 bit 11).
  - **When ≥ 3 are flagged**: the round is over (`$B9` bit 14), the clock stops, and the
    battle continues for **256 more ticks**:
    - bombers can still move and act;
    - falling blocks stop;
    - ordinary bombs stop counting down, but chain-triggered bombs and running explosions
      continue, so the "winner" can still die.
  - Then the winner is the first slot not flagged (`$5C3E`), or a **draw** if all four
    are flagged.
  - Measured round_win: 3 deaths on tick 165, exit on tick 422 (256 later), P1's win
    counter → 1.
- **Match**:
  - win counters `$5E66 + 2·slot`;
  - the match ends when one reaches the BATTLE setting;
  - ≈ 510 frames of scoreboard/loading between rounds;
  - same stage all match.
- **G-BOMBER**: the previous match's champion plays the next match as the gold bomber,
  with a per-round roulette bonus (`$5C42`): 0 extra bomb, 1 speed up, 2 glove, 3 kick,
  4 protection (+EF), 5 speed down. Code-read; the gold bomber and "extra bomb" case were
  seen. Icon mapping and stop rule are uncertain.

---------------------------------------------------------------------------------
## 14. Stages
[code + meas, full maps and addresses in `re/notes-stages.md`]

Battle stage ids (`$1A`) for select-screen stages 1..10: 0, 1, 2, 5, 6, 7, 8, 9, $A, $B.

- **Spawns** (`C01AF3`, all stages except 4):
  - P1 (2,4), P2 (14,14), P3 (14,4), P4 (2,14);
  - i.e. x/y = $20/$30, $E0/$D0, $E0/$30, $20/$D0.
  - **Stage 4** spawns in the centre: P1 (6,8), P2 (10,10), P3 (10,8), P4 (6,10).
- **Layout**:
  - Each stage has a fixed ROM map (RLE metatiles → collision grid + underlay +
    BG tiles). The clear cells around the spawns are part of the map (no runtime rule):
    the spawn cell plus 2 cells along each wall.
  - Then a **random soft-block removal** (`C0F50D`), N = 12 / 16 / 30 / 23 (no effect) /
    8 for stages 1 / 2 / 5 / 7 / 9 (others 0).
    - Scan cells row-major over the whole 16×16 range, wrapping, forever.
    - For each soft cell: r = RNG(); if r ≥ $80, restore the underlay (floor) and N −= 1.
    - Stop at N = 0.
  - Because the RNG carries over from the previous rounds, every round gets a new layout.
    It is reproduced exactly by `stages_softsim.py` (seed 0 at the first round after
    power-on).
- **Hard lattice**: classic pillars at odd cx 3..13 × odd cy 5..13 on stages 1, 2, 4, 5,
  6, 8 and 9. Stages 3, 7 and 10 are hand-drawn. Symmetry: stages 1–6 are mirror-symmetric
  both ways; stage 7 L/R only; 8, 9 and 10 are not symmetric.

| stage | gimmick | exact rules |
|---|---|---|
| 1 | none | plain lattice, 93 soft blocks − 12 random |
| 2 ice | **ice**, push blocks, holes | Ice integrator: speed forced to level 1. The held axis accelerates 0.25 px/tick², capped at 2.0. **No friction**: you slide until a collision. Opposite input decelerates 0.25/tick. A perpendicular input cancels the other axis. Blocked by a non-burning soft block whose next cell is free (or an item) → the block slides 2 px/tick until blocked. Holes at (4,6) (8,6) (12,6) (4,12) (8,12) (12,12): entering one snaps you to the centre, falls ~12 ticks, launches up (vy 8 decelerating 0.5) off the top, lands one row below the hole (above if blocked). 91 ticks without control. |
| 3 beach | tunnels, solid bombers | Border gaps at cx 4 and 12 link top and bottom. Exit (4,3) → re-enter at (4,15) walking up, and vice versa: 6-tick transit, one bomber per tunnel, blocked if a bomber stands at the exit. **Bombers are solid to each other** (|dx| < 13, \|dy\| < 15): pushing a standing bomber moves both at 0.5 px/tick. 20 fixed soft blocks. Sudden death closes the tunnels. |
| 4 barrels | fuse ring | 28 fuse cells `$0E` (ring cx 4..12 × cy 6..12). Fire touching any fuse ignites the ring if idle: all 28 cells are fire for **10 phases × 3 ticks (30 ticks)**, the 11th phase re-arms (phase 3a). The first ring of a round starts the tick after ignition, later ones 3 ticks after. Quirk: the ring writes its tile word into the AI danger map. Centre spawns. |
| 5 garden | power tiles | 11 tiles `$14`: (8,4) (4,6) (12,6) (6,8) (10,8) (8,9) (6,10) (10,10) (4,12) (12,12) (8,14). A bomb placed on one gets range 9. Some start under soft blocks. Graphics toggle every 160 ticks (cosmetic). |
| 6 pink | teleporters | `$50` at (4,6)↔(12,12) and (12,6)↔(4,12). Entering moves you to the partner centre unless **a bomb or a kicked-bomb mover** is there (C10456; bombers do NOT block — phase 3a). Kicked bombs teleport too. You must leave the pad before re-use. |
| 7 race | speed pads | Pads `$0F` at (3,9) (8,9) (13,9) set speed+base by tile: 0.375 / 0.8125 / 1.25 / 3.0 / 3.5 px/tick, or "stop" (input locked 128 ticks). After use, a non-stop pad re-rolls its tile from `$C5E871[(RNG & $E)/2]` = {1.25, 0.375, 0.8125, 3.0, 3.5, 3.5, 3.0, 1.25 tiles}. At round start (3,9) and (13,9) are normal and (8,9) is stop. One permanent soft block at (8,8) → no items ever drop. |
| 8 factory | conveyor ring | Ring row 6 / col 12 / row 12 / col 4, clockwise. Carries bombers and bombs at 0.5625 px/tick. Switch (8,8) reverses the direction; (8,10) toggles fast mode, 2.3125 px/tick. Both are latched until you step off. |
| 9 tech | arrows | 12 arrow cells (see notes). Bombers are unaffected. A kicked bomb entering one is redirected (code only). 8 random removals. |
| 10 forest | jump | **Y (edge) = jump** to the next cell in the direction of the pad (human: the pad on the first airborne tick that has one; none = in place), standing or walking: 32 ticks L/R (0.5 px/tick, x ±16 exactly), 28-30 U (-14..-16 px), 37-40 D (+16..+21 px). **Not blocked**: landing on a solid cell (rock, soft, border, SD block) or a bomb starts a hop at 1 px/tick in the jump direction through every solid / bomb cell, wrapping at the border, until the first free cell (snapped to its centre 8 + 16(k-1) ticks after the landing). No death check airborne or hopping (fire under / at take-off does not kill; the landing cell / hop end does); a hop through a $C1 kills. Carrying: the bomb drops and flies off at random. Hand-drawn layout, 57 fixed soft blocks that regrow. Measured: tools/sb2/conformance/jump_vectors.py, NOTES-core-ai.md "Stage 10 jump". |

---------------------------------------------------------------------------------
## 15. CPU AI
[code, fully read; key parts measured — details and quirks in `re/notes-ai.md`]

- **Who runs it and how.** COM = bomber +04 bit 0. The AI runs once per tick per living
  COM. It writes the bomber's +6E input word, which persists and is consumed by the
  normal movement and bomb code exactly like a pad.
  - "Press A" = clear the A-edge latch and set A.
- **Plans** are queues of [direction, cells] per bomber (`$0500 + $100·slot`). Plan
  active/escape flags live in +BE.
- **COM LEVEL** (`$7E1CA5`, 0..8 = levels 1..9, default 4) only indexes 4 tables:

| level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| chase threshold / bomb half-box (px) | 24 | 32 | 40 | 48 | 56 | 64 | 72 | 80 | 80 |
| stuck-in-cell limit (ticks) | 192 | 192 | 128 | 128 | 128 | 64 | 64 | 32 | 16 |
| glove hold time (ticks) | 192 | 192 | 192 | 128 | 128 | 64 | 64 | 32 | 16 |

- **Danger map** `$7F8000` (word per cell, `$FFFF` = in a blast line):
  - set at placement for the bomb cell + range+1 cells per direction, stopping before
    solid cells, items and bombs;
  - re-marked every 4 ticks;
  - cleared along the lines when the explosion ends;
  - when no bombs exist, zeroed one cell per tick via the list `$C5D46A`.
  - Fire is read from the grid itself.

**Per tick:**
1. **Stuck timer**: if the bomber stays in one cell longer than the level limit, drop the
   plan.
2. **Planners** — only without an active plan, one per tick phase (`tick & 3`):
   - Phase 3, soft-block seek: scan straight lines D, U, L, R for a soft block. If found
     and not adjacent, plan [dir, n+1].
   - Phase 2, item seek: same scan, for items.
   - Phase 1, chase:
     - target = first living bomber in a fixed per-slot order: 0→2,1,3; 1→3,0,2;
       2→0,3,1; 3→1,2,0;
     - if |dx| ≥ threshold, walk 4 cells horizontally toward it; else if |dy| ≥
       threshold, 4 vertically.
   - On phases 1–3, if there is still no plan, **random walk**:
     - one RNG call; direction from `$C1CE14` by r bits 1–2;
     - blocked neighbour → stand [0,16];
     - else walk `$C1CE54[$0402 & $1E]` cells (8,8,8,8,8,8,8,8,9,9,9,9,10,11,12,13;
       stage 4 uses `$C1CE74`).
   - Phase 0: nothing.
3. **Danger check**: if the bomber's own cell is dangerous and it is not already
   escaping, escape:
   - Scan R, L, U, D cell by cell. A scan fails at `$0E`, a bomb, fire or a solid cell.
   - A direction is safe if it reaches a non-dangerous cell, or a cell with a safe
     side-neighbour (perpendicular).
   - Farther exits win within an axis; ties go R/D. The vertical choice is used only if
     strictly shorter than the horizontal.
   - Plan [dir, n] (+[turn, 1]).
   - **Trapped**: step onto an adjacent `$55`/`$49`/`$50` gimmick cell, else press Y and
     stand.
4. **Stall**:
   - standing in danger → re-escape;
   - moving but no cell progress for ≥ 16 ticks → cancel the plan; if facing a soft
     block, press A; then random replan.
5. **Execute the plan**: set direction bits from the first non-empty entry.
   - Outside escape mode, stop if the next cell is fire, a bomb or danger and the bomber
     is within 4 px of its cell centre.
   - A cell counts as reached when it is entered and the bomber is within
     2,3,4,5,6,6,6,6 px (by speed level) of its centre.
6. **Attack**:
   - A bomb cooldown +D8 counts up to `$80`. Then press A if another living bomber is
     within the level's half-box on both axes (strict <).
   - Holding a bomb (glove): after the level's hold time, face a *human* on the same
     row or column (never a COM), then throw.
7. **Every 64 ticks**: press Y if facing a solid cell.

- COMs never kick deliberately.
- Each random-walk decision consumes one extra RNG step. This matters for exact replay.

---------------------------------------------------------------------------------
## 16. RNG
[code `C00CDF`/`C00CAA`; meas]

```
seed (16-bit, $00D6)
next(range):  seed = ((seed | 1) * 0x0383) & 0xFFFF
              return (seed * (range & 0xFF)) >> 16
tick():       r = next(range = previous seed & 0xFF)   # once per tick, end of main loop
              $0400 = r ; $0400 + (tick & 0x1E) = r ; bomber[(k++) & 3].+BA = r
```
- Extra calls happen in the same tick from: the AI random walk, the deck shuffle at round
  init, and stage gimmicks.
- Consumers read `$0400` (item deck: & 63; skull: & 15), `$0402`/`$0408` (AI walk
  length, rubber bounce), and +BA.
- Measured over 3000 frames: the seed sequence follows the recurrence exactly.

---------------------------------------------------------------------------------
## 17. TALL arena proposal (256 × 455, same pixel scale)

**Screen budget.**
- Original: HUD 25 px (incl. separator), arena top wall 16 px, 11 inner rows × 16 px,
  and 7 px of the bottom wall.
- Tall: **HUD 25 + top wall 16 + 25 rows × 16 (= 400) + 14 px of bottom wall = 455**.
  Like the original, the bottom wall is cropped (14 of 16 px shown instead of 7).
- **Grid: 13 × 25 playfield (15 × 27 with the border ring).**
- 25 is odd, so the pillar lattice stays symmetric:
  - pillars on every odd inner row and column;
  - 12 pillar rows (original: 5);
  - corners stay pillar-free.
- It even fits the original's logical grid: rows 3..29 of the 32-row `$7FC000` array.
  The cell formula cy = (y + 23) >> 4 is unchanged.
- Alternative if the whole bottom wall must show: 13 × 23 (HUD 25 + 16 + 368 + 16 =
  425, 30 px left for a taller HUD or a footer).

**HUD.** Keep it at the top, 25 px, exactly as the original: P1–P4 faces with win
counts, and the clock centred between them. The 9:16 canvas is much taller than wide, so
alternatives are:
- (a) keep the HUD at the top and put an identical-style 25 px strip at the bottom with
  the stage name / match score;
- (b) leave the bottom 14 px as wall, as above.

The arena scrolls never; the whole 13 × 25 field is always visible.

**Concrete numbers for 13 × 25** (inner rows cy 4..28, border rows 3 and 29):
- Corner spawns: P1 (2,4), P2 (14,28), P3 (14,4), P4 (2,28), i.e. y = 16cy − 16.
- Stage 4 centre spawns: centre row cy 16 instead of 9 → P1 (6,15), P2 (10,17), P3 (10,15),
  P4 (6,17).
- Sudden death:
  - the two outer rings of a 13 × 25 field are 72 + 64 = 136 blocks (original 44 + 36 =
    80);
  - at 15 ticks per block that takes 2040 ticks instead of 1200.
  - Either start it at 0:47 instead of 0:33 so it ends at the same clock time, or keep
    0:33 and use 9 ticks per block (136 × 9 = 1224). The spiral rule is unchanged:
    clockwise from the top-left inner cell, outer ring then second ring.
- Item deck: soft blocks scale ≈ 2.27×. Use a 145-card deck with each per-stage count
  ×25/11, rounded (e.g. stage 1: bomb 16, fire 14, speed 11, skull 2, glove 7, kick 7).
- Random soft removal N scales with the soft-block count (stage 1: 12/93 of the blocks).

**Rules that scale with the taller field.**
- **Spawns**: the four corners of the 13 × 25 field — (2,4), (14,4), (2,28), (14,28).
  - Keep each corner's L-shaped 3-cell clearance: the corner + 2 cells along each wall.
  - Stage 4 (centre spawns) needs its centre-ring layout re-centred (see notes-stages).
- **Soft blocks**: same placement rule as the stage (fixed map or random fill, per
  notes-stages), applied to the extra rows with the same density. More blocks mean more
  item draws.
  - **The deck must grow**: scale the 64 cards and the per-stage counts by ≈ 2.27
    (25/11), rounded, so the item density per block stays the same. Pierce/remote stay
    0.
- **Gimmicks** (per stage, from `re/notes-stages.md`), keeping symmetry about the middle
  row (cy 16) where the stage is symmetric:

| stage | how to extend |
|---|---|
| 1, 5, 9 | lattice + soft fill like rows 7–11 |
| 2 | holes at cx 4/8/12 every 6 rows: cy 6, 12, 20, 26, keeping T/B symmetry around 16 (the two original hole rows are 2 rows from each end) |
| 3 | tunnels stay at cx 4/12 in the top/bottom border; stretch the hard frame columns and the central water band |
| 4 | keep centre spawns; stretch the fuse ring vertically into one taller loop (cy 6..26) |
| 5 | power tiles on the diamond pattern repeated |
| 6 | teleporters at (4,6), (12,6), (4,26), (12,26) |
| 7 | add straight track segments vertically; pads on the middle row cy 16 |
| 8 | stretch the conveyor ring (rows 6 and 26, columns 4 and 12); switches at (8,15) and (8,17) |
| 9 | keep the corner loop and the rotation-symmetric inner arrows |
| 10 | repeat its rows 6..12 block pattern |
- **Sudden death**: the falling-block order must be regenerated for 13 × 25 (same spiral
  rule, see notes-round), and its timing scaled so the field closes in the same time as
  the original, or with the same per-block interval (design choice: same interval = a
  longer finale).
- **AI**: nothing grid-size-specific except scan lengths. The chase threshold in px is
  unchanged; the random-walk lengths (8–13 cells) are already longer than 11 rows.
- **Thrown-bomb wrap** uses the new height.

---------------------------------------------------------------------------------
## 18. Test vectors

`data/sb2/vectors/*.json` (gitignored). Regenerate with `python3 tools/sb2/re/vectors.py`
and check determinism with `python3 tools/sb2/re/vectors.py --verify`. The format is
documented in the script's header.
- Each vector starts from a harness state, settles 1 frame, then applies explicit WRAM
  pokes.
  - The pokes clear soft blocks, place an item, or set stats. They are listed in
    `start.pokes`.
  - The resulting `initial` snapshot gives the port its starting conditions.
- Then come per-frame pads for 5 ports, and per-frame truth: tick, RNG seed, all 4
  bombers, bombs, movers, grid changes, deaths.
- Most use the 4-human multitap state, so no AI is involved and humans that are not
  driven stand still.
- **Mapping frames to ticks** (for conformance): `truth.tick` is the number of
  completed ticks.
  - A frame where it does not advance is a lag frame. Measured lag rate:
    - 0–1 % with humans only;
    - 2–19 % with 4 COMs (stage 3, 4, 8 and 10 are heaviest);
    - 52 % in round_win, mostly the frozen post-round screens.
  - **The tick that completes in frame i reads frame i's pads.** The pads of a lag frame
    (no tick completes) are never read.
    - Measured on battle_stage03 around a lag frame f: a 1-frame A tap at f−1 or f+1
      placed a bomb in that same frame; a tap at f was lost.
  - Compare the port against the truth per tick, not per frame.

| vector | covers |
|---|---|
| walk_natural, walk_cleared, corner_offsets | walking, blocking, corner slides in all directions (cleared = soft blocks removed) |
| speed_levels | speed levels 0, 1, 5, 6 |
| bomb_single | fuse 144, fire 26 ticks |
| bomb_chain | 4-bomb chain, 4-tick steps, ray cut |
| bomb_softblocks | soft blocks burning 37 ticks, deck draws, pickups |
| item_<name> × 14 | every item effect, including the non-battle ones |
| item_burn | item burnt by fire (`$41`, 43 ticks) |
| skull_swap | skull + contagion |
| kick | kick slide, X stop |
| glove_throw | lift, carry, throw, wrap, bounce |
| glove_stun | thrown bomb lands on P2 → 28-tick stun, bounce |
| bomb_same_tick | two fuses expiring together → one detonation per update |
| remote_detonate | remote bombs + B (oldest first, fuse 2) + chain |
| fire_overlap | two explosions sharing a cell, first one ends |
| death_own_bomb, death_two | death, simultaneous death |
| cpu_round | 4 COM, level 5: a full round + the start of round 2 |
| cpu_round_1p | battle_start: 1 human walker + 3 COM |
| timeout_sudden_death | clock poked to 0:35: sudden-death spiral (80 blocks, 15 ticks each), time-up kills all → draw, 256-tick end phase |
| round_win | 3 bombers die → round over → 256 ticks → P1 wins (counter +1) |

---------------------------------------------------------------------------------
## 19. Verified vs inferred (summary)

- **Verified by code + measurement**:
  - coordinates/cells, the speed table (level 1 measured), the collision box and corner
    slide;
  - fuse, the even-tick bomb update, the chain step;
  - one detonation per update (bomb_same_tick);
  - remote detonation via B (remote_detonate: B on tick 93 → detonation on 96);
  - fire lifetime, soft-block burn and reveal timing;
  - the deck build and per-stage counts;
  - every item effect;
  - the death trigger and the tick order;
  - the RNG recurrence;
  - kick speed;
  - throw distance, speed and wrap.
- **Code only**:
  - contagion (vector recorded, see skull_swap);
  - rubber-bomb re-aim;
  - throw shortening onto bombers;
  - the AI (see notes-ai for its own split).
- **Measured too**:
  - all 6 diseases and the absence of a disease timer;
  - the clock (65 ticks/s), the sudden-death order and interval, time up = draw;
  - the 256-tick round-over phase and win counting.
- **Code only**: the 2-tick fire gap when the higher-slot explosion ends first.
- **Measured ad hoc** (no vector): the 28-tick stun from a thrown bomb.

---------------------------------------------------------------------------------
## 20. Phase 3a corrections (JS core transliteration, verified by conformance)

The JS core (`public/arcade/sb2/core/`) transliterates the battle code routine by
routine and replays all recorded vectors identically (`tools/sb2/conformance/run.mjs`);
the WRAM matches the original tick for tick in all logic ranges (`wdiff.mjs`). What that
work found beyond / against the sections above, with evidence in the per-area notes
`tools/sb2/NOTES-core-{bombs,movers,round,ai,stages23,stages47,stages810,tall}.md`:

- **Ticks** (§0): `$32` semantics, the double increment, the uncounted first tick and the
  extra increment after the last tick (see §0). Frame→tick rule for vectors: group frames
  by truth.tick; the tick reads the pads of the group's first frame and is complete at
  the last frame still showing the group's first `$B9`; a group whose RNG equals the
  previous tick's ran no tick.
- **Input** (§4): humans' L+R / U+D are cleared by the input routine. **C022E2 quirk**:
  the velocity-sign update is gated by +0E bit 0 (`LDA #$0052` then `LDA [$6A],Y` with
  Y = $0E), not by +52.
- **Movement** (§4): walking from outside onto a bomb cell is undone and the bomber is
  snapped to its cell centre (C10169 family); a bomb at a slide corner snaps to the cell
  centre unless the bomber has bomb-pass. Off-screen objects without +04 b10 are erased
  (C0A146).
- **Animation** drives logic: object animation scripts (C0249D, decoded into
  `animdata.js`) time the death animation (its end removes the bomber and scatters its
  items), the throw/lift/stun busy states (+0C = $0FFF) and the stop pad.
- **Bombs** (§5/§6): placement on fire allowed; ray order up/down/right/left; stale bomb
  list; power bomb with another out = type 0; pierce burns through and draws fire on
  soft/items; bombs re-assert `$43` every update; burn: first free entry wins, 6 frames ×
  3 odd ticks, a sudden-death block ends a burn with no card; danger-decay table typo
  (`$049C` for `$069C`). Remote: oldest by per-bomber serial, skipping held/kicked.
- **Items / diseases** (§8/§9): a bombed skull is never burnt — it flies 3 cells; picking
  any item while sick cures and throws a skull off (stats restored on the next tick by
  C03686); disease quirks (slow skips the refresh, restoring weak sets in-hand = cap,
  COMs roll 3 → 2); the contagion latch is not cleared for a dying/busy partner; dead
  bombers' items re-appear (§12).
- **Deck** (§7): a free position is drawn before the kind's count is checked, so every
  kind (zero-count kinds too) and the terminator waste one extra successful draw.
- **Kick / glove** (§10/§11): see those sections; skulls under a kicked bomb fly off;
  kicked bombs use stage-3 tunnels, stage-6 teleporters and stage-7 pads; bombs resting
  on stage-8 belts become carried movers; a bomber inside a solid cell hops out (C0838C).
- **Round** (§13): round init uses the RNG only for the soft-block removal and the deck
  (seed 0 after power-on, never advanced by menus); `$5D10` (sudden-death step counter)
  is not reset between rounds (first block 0..2 ticks late); sound $72 on every block;
  each block re-writes `$C1` on 4 steps; corner danger marks store `$FFFF` only in the
  corner cell and grid indices after it (C0D6FC), and the 8th corner never matches; a
  block deletes a bomb unless exploding/held and cancels a pending stage-10 regrow; the
  battle loop exits at the end of the last tick (winner, fade). Stage-3 tunnel closing
  runs through the cell-animation list C0DA42/C0DA60 (vector stage03_sudden_death).
- **Stages** (§14): stage 2 holes lead into an underground track ridden at 2 px/tick
  with random junction turns, then a launch (NOTES-core-stages23); ice latches in +52
  b15/b14; push block inherits the pusher's sign bits; stage 3 bomber collision groups,
  voting, tunnel-busy quirk (`$5D04 & 3` for both); stage 4 ring as in the table; stage 5
  tile list built on the first tick, graphics toggle counts per object; stage 6
  teleporters blocked by bombs only; stage 7 pads set +F0 and +E0, stop pad = 128-tick
  busy; stage 8 switches act one tick after stepping on, belts carry resting bombs;
  stage 10 jump has no take-off block check (landing on a bomb hops out) and **soft
  blocks regrow** after 64..1280 ticks on empty cells of the init list with no object
  on or next to them (missing from the first SPEC).
- **AI** (§15; NOTES-core-ai.md; every one of ~136 000 recorded COM AI calls over the 11
  CPU vectors is reproduced exactly, scratch registers included — `aisnap.py` +
  `aicheck.mjs`): chase quirk C0CE91 — on the negative branch A is reloaded with the
  step constant before the threshold compare, so a target to the RIGHT is never chased
  horizontally and a target BELOW is always chased down whatever the distance (only
  "left ≥ threshold" / "above ≥ threshold" use the threshold); soft-block seek writes
  the direction into plan[0] even when the block is adjacent (no plan), and a made plan
  gets no $FFFF terminator (the walk continues into old buffer entries); bombing an
  enemy checks all four slots (A may be pressed repeatedly); glove aim: the LAST aligned
  human in slot order wins; trapped exit: a $55 neighbour in any direction gives [R, 1];
  the stuck timer drops the plan when the counter exceeds the limit; the stall handler's
  random walk still checks the tick phase; the "arrived" test also runs in escape mode.
- **Tall layout** (§17): implemented as specified; sudden death defaults to start at 0:47
  at 15 ticks/block over 136 blocks ("Hurry!" at 0:52), option `'pace'` = 0:33 at 9
  ticks/block; 145-card deck at `$7E3C48`; details in NOTES-core-tall.md.
