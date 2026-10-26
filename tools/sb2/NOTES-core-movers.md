# NOTES — core: moving objects (public/arcade/sb2/core/movers.js)

Transliteration of the original's mover code (all addresses read from the 65816; the
vectors kick, glove_throw, glove_stun, item_kick, item_glove, item_rubber_bomb pass and
the mover slots $7E8400..$9FFF match the original's WRAM byte for byte on them).

## Structure
- `C08230` runs for every object in the list; it dispatches on +7E bits 8-11 (table
  `$C0826D`, 4-byte entries): 0 bombers `C08282`, 1 bomb in motion `C08974`, 2 flying
  item `C093F6`, 3 pushed soft block (stage 2) `C094B4`, 4 static (RTL).
- Movers live in slots $7E8400.. (28, `C02F1B`), initialised from templates at
  `$C20151` (+00, +04, +10, +18, +7E, +06/+2A, +50; 14 bytes each: bomb, item, block,
  static) by `C02196`/`C02401`, which also restarts the animation (`C021B0`/`C021DC`).
  `C02F1B` saves the current object in $5BFE/$5C00.
- Positions are integrated by the normal movement routine (`C0A474`): `C0C01C` skips the
  input→velocity step for objects with +7E hi ≠ 0 (unless +02 b9), so movers keep the
  velocities they set (+14 / +1C, signs in +00 b0/b1).
- Thrown / bouncing objects follow motion scripts: +43..+45 = ROM pointer to
  (flags, vx, vy) words, one triple per tick, $FFFF = landed. Pointer tables
  `$C5CAA0` (throw/hop, n = cells), `$C5C9B0` (deflect / rubber re-aim), `$C5C0B6`
  (flying items), each [n][facing*2] → 3-byte pointer. Generated into
  `movers_tables.js` by `tools/sb2/conformance/gen/mover_tables.py`.

## Rules found (SPEC corrections / additions)
- **Kicked bomb fuse**: decremented by the mover on ODD ticks (`C089A0`), never below 1;
  a remote bomb only when forced and fuse < 4. Rolling onto fire: fuse := 1 and it
  becomes a bomb there (`C08A20`).
- **Kick stop rule** (`C08537`, `C0895F`): when within 4 px of its cell centre, the
  bomb stops if the next cell has bit 6 set (solid or object) other than an item ($44)
  / $50, or if any object stands on / heads into the next cell. A rubber bomb (type 8)
  rolls BACK instead (`C08613`, reverses +00 sign bits and the facing) — it does not
  pick a random direction when kicked. Next cell `$C0` → rolls back too. If the bomb's
  own cell holds a bomb ($43) it turns into a 1-cell hop (`C10000`).
- **Items under a kicked bomb** are erased — except a **skull, which flies 3 cells in a
  random direction** (`C0EE71`). The explosion code does the same for a bombed skull
  (`C0EF44` → `C0EE71`): skulls are never burnt.
- **Kick conditions** (`C0AFAF`): kick ability; exactly one direction held; a bomb on
  the next cell with fuse ≥ 3 that is not held/exploding (`C0B1F8`); the cell beyond
  must not have bit 6 (except $44/$50) and no object on it (`C0B155`). Kicking a POWER
  bomb into a bomber stuns that bomber (unused in battle decks). Speed 2 px/tick.
- **X stop** (`C029FD` → `C08BDA`): the bomb stops at once in the cell under its centre
  (it is re-placed there; no "next boundary").
- **Throw** (`C02CAF`): distance `C02DCF` = 2..5 if any bomber's cell (+A8, any state)
  is 2..5 cells ahead in the facing direction, else 3; facing 0 → down. Speed and arc
  from the script; the thrower is busy (+52 = 1) for the throw animation.
- **Landing** (`C08B65`): sound $45 (the "throw" sfx in NOTES-extract is the landing);
  bounces one more cell (script `$C5CAA0[0]`) if another mover is on / heading into
  the cell (`C104A0`, scans from the 5th list entry), on a conveyor bomb, on cell $11
  or any bit-6 cell. A **rubber bomb re-aims at random** only here: facing
  `$C5FC6D[$0408 & $1E]`, distance `$C5EE0F[$0404 & $1E]` (1..5), script `$C5C9B0`.
  A landing bomb with fuse < $38 gets fuse $38 (`C10734`).
- **Thrown bomb on a bomber** (`C08D6A`): the bomber is stunned (`C08E82`: +52 = 1,
  anim set 4 / id $10 → 28 ticks) and the bomb bounces on. If the victim carries a
  bomb, the thrown bomb is deflected back instead (`C08E0A`), unless the thrown one is a
  power bomb and the carried one is not (then the victim drops its bomb and is stunned).
- **A stunned bomber loses items** (`C0914A`, +52 |= $80): count `$C5EDFF[$0404 & 15]`
  (1..3); its carried skulls (+E9, or 1 if diseased) fly out first and the disease is
  cleared without restoring stats; then kinds are tried from `$0404 & 15` round-robin
  through 12 handlers (`$C5EDDD`/`$C5EDAD`: speed (not stage 7), bomb, fire, full fire,
  glove, kick, pierce, remote, power, rubber, bomb pass, wall pass), each taking one
  level off the stat; each item flies out (`C09231`, mode 2, distance 1..5) and lands as
  a normal item unless the cell is solid/object/fire/$11-$13 (then hops again).
- **Lift** (`C02F6E`): your own bomb on your cell, fuse ≥ 4, not held/exploding; the
  bomb's danger marks are cleared even when it is not yours; sound $48. +52 3 → 6 is the
  lift animation's end (anim.js).
- **Wrap-around** (`C12F6C`): a mover over a cell whose BG tile word & $3FF is 0
  (outside the arena) is moved 16 px at a time in its facing direction until over a real
  tile; x is masked by $5D3E ($FF) in `C0A146`. Movers whose +42 has bit 3 (rubber)
  never wrap (quirk).
- **Bomber inside a solid cell** (`C0838C`): hops out (+52 = $0809) one cell, 1 px/tick,
  facing away from the arena edge (`C0843E`, edge limits y $28/$D7, x $19/$E7 — must
  follow the arena size for the tall layout); a falling block landing on it during the
  hop kills (or costs a shield, `C08302`).
- **Dying carrier** (`C0A743`): its bomb hops one cell in a random direction.

## Interfaces
- move.js → `movers.kick(p)` (C0AFAF after C0AF76), `movers.dropCarried(p)` (C0A743);
  the "mover ahead" checks C0AB0F/C0AB8B/C0AA13/C0AA93 live in move.js.
- bombs.js → `movers.lift(p)` (C02F6E), `movers.throwRelease(p)` (C02CAF),
  `movers.stopKicked(o)` (C029C0 → C08BDA, velocities zeroed by the caller).
- explosion code may call `movers.skullFly()` (C0EE71, $5C0E/$5C10 = cell/tile);
  item code may call `movers.spawnFlyingItem(src)` (C09231) / `movers.skullOut(src)`
  (C09850). (items.js currently has its own copies of these spawns.)
- Exported helpers: `toBomb(o)` (C08BDA), `hop(o)` (C093D1), `snapCentre(p)` (C0456D),
  `initObject(o, kind)` (C02196), `dropItems(q)` (C0914A).
