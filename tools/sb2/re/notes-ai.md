# SB2 battle CPU (COM) AI — reverse-engineered

Phase 2b sub-notes (merged into NOTES-re.md / SPEC.md by the parent). All addresses
are CPU addresses; player fields are offsets into the bomber object
(`$7E8000 + $100*slot`, slot 0..3 = P1 white, P2 black, P3 red, P4 blue). "tick" =
one executed game frame (`$32` increments). Tools: `ai_trace.py` (per-tick AI state
log), `ai_levels.py` (all-COM rounds per level), `ai_escape_check.py` (escape model
vs game).

**Status:** the whole decision path below was read from the 65816 code. These parts
were also checked by measurement:
- the escape choice model: 400 random danger maps, the plan matched exactly in every
  case once the "trapped" detail below is included;
- the bomb-near-enemy distance: strict `<`, exact at COM levels 1, 5 and 9;
- item-seek priority and step count;
- where the COM level is stored, and its range;
- the chase / soft-block-bomb / escape sequence in `ai_trace.py` logs.

## Where the AI runs, and its output

- Entry `C0C54B`, called from the per-bomber pipeline `C01E64` each tick, only when
  `$30&$0F==$0F` and `+7E` high byte == 0. It also returns early unless:
  `+00` bit 15 is set (active), `+00` bit 11 is clear (not dying), `+52` bit 0 is
  clear, and `+04` bit 0 is set. **`+04` bit 0 = COM** (copied from `$5C4C+2*slot`
  at round init, `C01BCA..`).
- The human input routine `C01625..C0172A` writes `+6E` only for bombers with
  `+04` bit 0 clear. For a COM, `+6E` is written only by the AI and **persists
  between ticks**. The movement and bomb code then treats it exactly like a pad:
  `$0800` U, `$0400` D, `$0200` L, `$0100` R, `$0080` A (bomb), `$4000` Y.
- To get a new bomb, the AI clears the A-edge latch `+0E` bit `$0400` and sets `+6E`
  bit `$0080`. A then stays held (nothing releases it except the glove throw), so
  "press A" means "place a bomb on this tick if possible". Y is pressed the same way
  with latch `+0E` bit `$0100`, and is cleared again on every tick (`C0C5DB`).
- Order of the 7 steps in one AI tick (`C0C54B`):
  1. `C106D8` stuck-in-cell timer
  2. `C0CE32` planners
  3. `C0C990` danger/escape
  4. `C0CC97` stall handling
  5. `C0CD53` plan executor (writes the direction bits)
  6. `C0C843` bombing an enemy / glove throw
  7. `C0C5DB` periodic Y

## AI state (per bomber)

| field | meaning |
|---|---|
| `+BE` | bit 15 = a plan is active, bit 14 = escape mode (danger checks suspended) |
| plan buffer | `$000500 + $100*slot` (pointer table `$C5D5B6`). Entries are 4 bytes: direction word (0/$100/$200/$400/$800), count word (cells still to walk). `$FFFF` ends the list. |
| `+DC` | ticks since the last cell arrival while executing (stall counter) |
| `+DE` | grid index of the last cell the plan "arrived" in |
| `+38`, `+EC` | last cell, ticks spent in it (stuck timer) |
| `+D2` | COM level index 0..8 |
| `+D4` | target bomber pointer |
| `+D6` | glove hold timer |
| `+D8` | bomb cooldown: counts 0 → $80. Reset to 0 when the AI presses A and has no glove. |
| `+EE` (byte) | Y-press cycle counter (0..$3F) |
| `+A8` | own grid index (cell = `cy*$80 + cx*2`); neighbour deltas ±2 (L/R), ±$80 (U/D) |

## COM level

- Menu variable `$7E1CA5` holds the level index **0..8**, shown as **COM LEVEL 1..9**.
  It wraps, and the menu needs a held Right/Left (a 1-frame tap does nothing).
  Default is 4 (level 5).
- `CC0380` copies it to `$7E5C58`. Round init copies that into every bomber's `+D2`.
  `+D2` is read only in the 4 tables below; nothing else in the AI depends on it.

| table | used for | idx 0..8 (COM LEVEL 1..9) |
|---|---|---|
| `$C1CE94` | chase threshold (px) | $18 $20 $28 $30 $38 $40 $48 $50 $50 |
| `$C1CEA6` | bomb-near-enemy box half-size (px) | $18 $20 $28 $30 $38 $40 $48 $50 $50 |
| `$C1CE02` | stuck-in-cell limit (ticks) | $C0 $C0 $80 $80 $80 $40 $40 $20 $10 |
| `$C1CDF0` | glove hold time before throw (ticks) | $C0 $C0 $C0 $80 $80 $40 $40 $20 $10 |

Measured by `ai_levels.py` (all four bombers COM, 4000 frames, stages 1, 3 and 6):
higher levels place somewhat more bombs, but survival barely changes. The level only
scales these four numbers.

## Danger map `$7F8000`

One word per cell, in the same layout as the grid; non-zero means "in a blast line".
- **Bomb placed** (`C03185`, `C0323F`, `C032E5`, `C03386`, `C03423`): the bomb's cell
  and each of its 4 rays are marked `$FFFF`. A ray covers up to range+1 cells and
  stops *before* a solid cell (bit 7, so soft blocks too), an item ($44) or a bomb ($43).
- **Refresh** (`C0E174`, from the bomb tick `C0E980`): the same cells are re-marked
  every time the bomb's animation timer wraps, i.e. every 2 bomb updates (4 ticks).
  The marks stay through the explosion.
- **Explosion ends** (`C0E303` → `C0E318..`): the bomb's centre and ray cells are set
  back to 0. This can briefly erase overlapping marks from other bombs until their
  next refresh.
- **No bombs on the field** (`$7E2960` empty), `C0E076`: one cell per tick is zeroed,
  walking the 113-entry list `$C5D46A` (every non-pillar inner cell) with index
  `$5DDC`. A full pass takes 113 ticks.
- Fire cells ($01) are **not** in the danger map. The AI tests fire through the grid.

## Per-tick algorithm (pseudocode)

```
AI_TICK(p):                                   # C0C54B, COM only
  # 1. stuck timer                           C106D8
  if p.cell == p.lastCell:
      p.inCell += 1
      if p.inCell > STUCK[p.lvl]:
          p.inCell = 0; cancel_plan(p)        # BE &= $3FFF, plan[0] = $FFFF
  else:
      p.lastCell = p.cell; p.inCell = 0

  # 2. planners, only if no plan               C0CE32
  if not p.BE.plan:
      p.arrCell = p.cell
      ph = tick & 3
      if ph == 3: plan_softblock(p)           # C0D112
      if ph == 2: plan_item(p)                # C0D0E7
      if ph == 1: pick_target(p); plan_chase(p)   # C0CE59
      if ph != 0 and not p.BE.plan: plan_random(p)  # C0D441

  # 3. danger                                  C0C990
  if not p.BE.escape and danger[p.cell]: escape(p)

  # 4. stall                                   C0CC97
  if p.input.dirs == 0:
      if danger[p.cell]: escape(p)            # re-evaluated even in escape mode
  elif p.stall >= 16:
      cancel_plan(p)
      if grid[p.cell + facing(p)] == $C2 and not p.holding and grid[p.cell] != $0E:
          press_A(p); if not p.glove: p.D8 = 0          # C0CCCC
      plan_random(p)                                    # still needs tick&3 != 0

  # 5. execute plan                            C0CD53
  e = first plan entry with count != 0         # count==0 entries are skipped
  if e is END: cancel_plan(p)                  # direction bits are NOT cleared
  else:
      p.input = (p.input & ~$0F00) | e.dir; p.stall += 1
      if not p.BE.escape:                      # C0CDF1
          nxt = p.cell + facing(p)
          if (grid[nxt] in ($01, $43) or danger[nxt]) and near_centre(p, p.cell, 4):
              p.input &= ~$0F00
              e.count = p.input                # quirk: becomes $0080 if A is held, else 0
      if p.cell != p.arrCell and near_centre(p, p.cell, CENTRE[p.speed & 7]):
          p.arrCell = p.cell; p.stall = 0; e.count -= 1   # if not already 0

  # 6. bombing / glove                         C0C843
  if p.holding:                                # +52 bit 1 (glove)
      p.D6 += 1
      if p.D6 > HOLD[p.lvl]:
          aim_at_aligned_human(p)              # C0C66E
          p.input &= $0F00                     # release A/Y = throw
          p.D6 = 0
  else:
      p.D6 = 0
      if p.D8 < $80: p.D8 += 1
      else:
          for q in other bombers not dying:    # slot order 0..3; humans and COMs
              if |p.x-q.x| < BOMBDIST[p.lvl] and |p.y-q.y| < BOMBDIST[p.lvl]:
                  if not p.holding and grid[p.cell] != $0E:
                      press_A(p); if not p.glove: p.D8 = 0
                  break

  # 7. periodic Y                              C0C5DB
  p.EE += 1
  if p.EE < $40: p.input &= ~$4000
  else:
      p.EE = 0
      if grid[p.cell + facing(p)] & $80 and not p.holding: press_Y(p)
```

Helpers:
- `facing(p)` (`C0CD2C`), from the current input: L → −2, else R → +2, else U → −$80,
  else +$80. With no direction pressed it gives +$80 (down).
- `near_centre(p, cell, n)` (`C19BFB`): |x − cx| < n and |y − cy| < n, where (cx, cy)
  is the pixel centre of `cell` (`C0EE1C`).
- `CENTRE` = `$C5D900`, indexed by speed level & 7: 2 3 4 5 6 6 6 6 (px).
- A new plan sets `+BE = $8000` (planners) or `|= $C000` (escape), and `+DC = 0`.

### Planners (a different one on each tick phase; only while no plan is active)

- **Soft-block seek** (`C0D112`, phase 3):
  - Scan straight lines from the bomber's cell in the order R, L, U, D (`C0D344`,
    `C0D382`, `C0D3C0`, `C0D403`).
  - Each scan counts the free cells passed. It stops on $C2 (found, at distance n)
    or on a bomb ($43) / any solid cell (not found). The up scan also stops at
    index ≥ $2000.
  - Pick in priority order **D, U, L, R**: the first direction that found a block.
  - If that block is adjacent (n = 0), **no plan is made**, even if other directions
    found blocks too.
  - Otherwise the plan is `[dir, n+1]`. The walk then stalls against the block, and
    the stall rule (step 4) presses A. This is how COMs bomb soft blocks.
- **Item seek** (`C0D0E7`, phase 2):
  - The same four line scans, looking for an item ($44). Bombs and solid cells stop
    a scan. Fire and danger do not.
  - Priority **D, U, L, R**; the plan is `[dir, n+1]`, which ends on the item.
- **Target + chase** (`C0CE59`, phase 1):
  - Target `+D4` is the first bomber that is not dying in a fixed order per slot:
    slot 0 → 2,1,3; slot 1 → 3,0,2; slot 2 → 0,3,1; slot 3 → 1,2,0.
  - Then `C0CE91` computes dx = self.x − tgt.x. If |dx| ≥ CHASE[lvl], the plan is
    `[L if dx ≥ 0 else R, 4]`.
  - Otherwise, with dy = self.y − tgt.y: if |dy| ≥ CHASE[lvl], the plan is
    `[U if dy ≥ 0 else D, 4]`. Otherwise no plan is made.
  - (`C0CF08`, an alternative "already aligned" chase, is never called.)
- **Random walk** (`C0D441`, ticks with phase ≠ 0, still no plan):
  1. Call the RNG (`C00CAA`) and take r = `$0400`.
  2. Direction = `$C1CE14[r & $1E]`: the table repeats U, D, L, R, so it depends on
     r bits 1–2.
  3. If the neighbour in that direction (`$C1CE34[r & $1E]`) is solid (bit 7):
     clear the direction bits and make the plan `[0, 16]`. That is "stand". A
     standing COM only moves again via the stuck timer or danger.
  4. Otherwise the plan is `[dir, COUNT[$0402 & $1E]]`:
     - `$C1CE54` = 8 8 8 8 8 8 8 8 9 9 9 9 10 11 12 13 on most stages;
     - `$C1CE74` = 3 4 5 6 3 4 5 6 3 4 5 6 7 8 9 10 on stage 4 (`$1A == 5`).
  5. `$0402` is the RNG value from the last tick with (`$32` & $1E) == 2, so the
     count index changes only once every 32 ticks.

### Escape (`C0C9A8`; entered from step 3, or from step 4 when the bomber is standing still)

1. Scan the 4 directions (`C17EB5` R, `C17E08` L, `C17CA9` U, `C17D5B` D). Each scan:
   ```
   n = 0; c = own cell
   loop: c += d
         if grid[c] in ($0E, $43, $01) or grid[c] & $80: fail (no safe exit this way)
         n += 1
         if danger[c] == 0:                      → safe straight ahead, result (S, n)
         side1 = c + s1; side2 = c + s2          # R/L scans: s1 = up, s2 = down;
                                                 # U/D scans: s1 = left, s2 = right
         if side1 not ($43/$01/solid) and danger[side1]==0 → (S+turn1, n)
         if side2 not ($43/$01/solid) and danger[side2]==0 → (S+turn2, n)
   ```
   The side cells do not check $0E.
2. If no direction succeeded, the bomber is **trapped** (`C0CBCC`):
   - if an adjacent cell (checked R, L, U, D) is of type $55, $49 or $50 (stage
     gimmick cells), plan `[dir, 1]` in escape mode (`C0CBF2`);
   - otherwise press Y and set escape mode. If the current plan's first direction is
     not 0, replace it with `[0, $0FFF]` (stand); if it is already 0, keep the plan.
3. Otherwise choose the direction (`C0CA75`, `C0CA26`, `C0CA11`):
   - horizontal = R if R succeeded and (L failed or nR ≥ nL), else L if L succeeded.
     So the **farther** exit wins, and R wins ties.
   - vertical = D if D succeeded and (U failed or nD ≥ nU), else U if U succeeded.
   - Take the vertical choice only if its n < the horizontal n (a missing axis counts
     as ∞). Otherwise take the horizontal choice.
4. The plan is `[dir, n]`, followed by `[turn, 1]` if the safe cell was a side cell.
   turn1/turn2 are U/D for horizontal scans and L/R for vertical scans. Set escape
   mode (`+BE |= $C000`, `+DC = 0`).
   - While in escape mode the executor's fire/bomb/danger stop is skipped.
   - The plan is not re-evaluated, except by the stand-still check in step 4 or the
     stuck timer, until it ends.

### Glove aiming (`C0C66E`; only for COMs holding a bomb)

Check bombers in slot order. A candidate must be another bomber that is **human**
(`+04` bit 0 clear) and not dying.
- Same 8-px column (`x & $F8` equal): face U if self.y ≥ them, else D.
- Same 8-px row: face L if self.x ≥ them, else R.

The first match sets the direction bits; then `C0C63D` releases the buttons (throw).
COMs never aim throws at other COMs.

## Notes for a port

- COMs use only the RNG for random walks (`C0D45C` → `C00CAA`), which advances the
  shared seed and its per-player `+BA` rotation. Nothing else in the AI is random, so
  a faithful port must call the RNG in the same order: once per random-walk decision,
  plus the global once-per-tick call.
- Kick is never chosen on purpose. Escape scans treat bombs as walls, and the
  executor stops before bomb cells, so a COM kicks only by accident (when it reaches a
  bomb more than 4 px from its cell centre with a kick item).
- Y (`$4000`) only has an effect where `C065F1` is active: when `$1C6E != 0` on
  stages other than 2 and 3, or on stage 10 (`$1A == $B`) when `$1C6E == 0`. Which
  action Y triggers there belongs to the item/gimmick notes.
- What cell types $0E, $55, $49, $50 are (stage gimmicks) is for the stage notes;
  the AI treats $0E as a forward-blocking cell where it will not bomb.
