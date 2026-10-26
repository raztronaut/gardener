# NOTES — phase 3a core: bombs, explosions, burning, items, diseases

Files: `public/arcade/sb2/core/bombs.js`, `burn.js`, `items.js`, `disease.js`. Every
function is a transliteration of the 65816 routine named in its comment and works on
the WRAM image (see `core/mem.js`). Verified with `tools/sb2/conformance/run.mjs`
(bomb_*, item_*, fire_overlap, remote_detonate, skull_swap, speed_levels) and with a
WRAM-level isolation run on the COM vectors (everything outside these modules' bytes
synced from the original each tick): bomb slots, bomb list, burn list, deck, scatter
lists, grid / underlay / tiles / danger and the bomber stat bytes match tick for tick.

## Findings that SPEC.md gets wrong or omits

1. **Placing a bomb on a fire cell is allowed** (C031EB: cell type 1 → "OK", the
   bomb scan is skipped). The bomb overwrites the cell with `$43`; the running
   explosion writes `$01` over it again on its next phase update, and the bomb goes off
   on the first even update that sees its cell as fire (code-read). Only cell type
   `$11` (stage-3 tunnel) forbids placement. SPEC §5 says "the cell is fire" fails.
2. **Ray order** at detonation (C0EA83) is up, down, RIGHT, LEFT (C0EC68 walks the
   `+C4` table, C0ED42 the `+88` table). It decides the burn-list order of blocks hit
   by one bomb (and therefore which block draws which deck card first). Drawing and
   restoring the flames use up, down, left, right.
3. **Ray tables are built at placement** (C0323F/C032E5/C03386/C03423 write all
   range+1 entries: tile, grid, piece 5/6, last entry 1..4). At detonation the rays
   only cut themselves (`$FFFF` in the entry's tile word) where they stop. A chained
   bomb's back ray is cut entirely (its first entry).
4. **Pierce** (type 4) continues through soft blocks / items / `$0B` (queued to burn)
   and those cells are drawn as fire too (they are part of the ray).
5. **Power bomb**: a power-bomb owner placing while another bomb is out gets a plain
   bomb (type 0), not just range = fire (C034E5).
6. **Bomb list `$7E2960` is rebuilt only at the start of each even-tick bomb update**
   (C0DEE7), not at placement. Placement / remote / pickup checks read the possibly
   stale list.
7. **Bombs re-assert their cell** (`$43`) on every even update unless flags `$0020`;
   the fizz animation advances every 2 updates and re-marks the danger lines then.
8. **Burn list**: first free entry wins before the duplicate check of later entries;
   blocks burn 6 frames × 3 odd ticks; the cell is rewritten `$C2` / `$41` every odd
   tick; a sudden-death block (`$C1` underlay) ends the burn immediately (no card).
9. **A bombed skull item is not burnt**: C0EF44 → C0EE71 turns it into a flying object
   (template `$C2015F`, item tile `$160A`, random direction from `$0400 + $5C12`, flight
   script `$C5CAA0[3]`) and frees the cell; it lands elsewhere as an item (movers).
10. **Cure on pickup** (C0980D): picking any item while sick clears the disease and
    throws a skull object off the bomber (C09231, same template, direction and
    distance from `$0400`). The stats are restored on the bomber's next tick by C03686
    (bit `$0080` of +04), not at pickup.
11. **Diseases, quirks kept**: picking a skull while sick first cures (above), then
    C09ACD restores nothing (disease already 0). Disease 5 (slow) skips the fire /
    bombs-in-hand refresh in C001EE and C099DF; after a swap to disease 6 the hand is
    `1 if no bomb out`. Restoring disease 6 via C09ACD sets in-hand = capacity (not
    capacity − out). COMs roll 3 → 2.
12. **Contagion latch quirk**: for a pair whose second bomber is dying or busy
    (`+52` bit 0) the pair's latch bit in `$5C5E` is NOT cleared.
13. **Items of a dead bomber** (C097A0 at the end of the death animation, C09615 one
    per tick): counts from the stat bytes (bomb/fire/speed minus their start value 1,
    full fire restores fire to the fire-up count first; no skull/heart), placed at a
    random entry (`$0400 & $FE`) of a 128-entry free-cell list built by scanning grid
    indices `$204..$7FE` (C09712, repeated until the list is full, cells are reused);
    an entry beyond the list or an occupied cell loses the item. No speed-ups on stage 7.
14. **Danger decay list `$C5D46A`** has a typo: `$049C` where `$069C` belongs, so
    cell (14,13) never decays by this path.
15. Explosion end restores tiles/cells from the underlay along every non-cut ray cell,
    then clears the danger marks of the centre and all ray cells (C0E303) even where
    another bomb still marks them (refreshed on that bomb's next fizz frame).
16. **Remote (B)**: the oldest remote bomb by per-bomber serial (+05), skipping ones
    being kicked/carried (flags `$1000`), gets fuse 2 + flags `$0080`; with flags `$80`
    it still stops counting after the round is over (unlike chain-triggered `$C0`).
17. **Tick counter**: `$32` can be double-incremented for one tick (a tick ending right
    before vblank lets two NMIs count it); bombs/burns follow `$32` parity, so the
    port must use the original's `$32` sequence when replaying (runner handles it).

## Interfaces
- `items.pickup(p)` (C0986A) and `items.deathScatter(p)` (C097A0) are called from
  move.js; `bombs.refundBomb(b)` / `bombs.dangerClear(b)` for bombs removed without
  exploding (sudden death); `burn.restore(g, tile)` = C0DDF7.
- Calls out: `movers.lift / throwRelease / stopKicked`, `stage.conveyorBomb` (C0DF87),
  `stage.regrowEntry` (C0DA60), `anim.initObject` (C021B0+C021DC for new objects),
  `move.inputVelocity` (C0C2CE). Missing exports are skipped.
- Tall layout hooks: `bombs.setLayoutTables({decay, fuse})`, `burn.setDeckAddr(a)`
  (a 145-card deck needs room outside `$3C48..$3CC9`), `items.setScatterScan(end, mask)`.
