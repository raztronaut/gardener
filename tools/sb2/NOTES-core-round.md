# NOTES — phase 3a: round flow and round/match setup in the JS core

Files: `public/arcade/sb2/core/round.js` (clock, fade, Hurry, sudden death, round end,
battle-loop exit), `setup.js` (settings, round init, between rounds, new match),
`layout.js` + generated `layout_data.js` (stage maps, soft-block removal, deck, lists),
`index.js` (`createGame` from scratch, `nextRound`, `newMatch`).
Tools (tools/sb2/conformance/): `capstages.py` (round-1 init of every stage, real ROM and
`--nosoft` ROM), `capinit.py` (WRAM + every write over a frame window of a vector),
`capgold.py` (G-BOMBER match init), `gen_layout.py` (→ layout_data.js), `check_init.mjs`.

## API
```js
createGame({ stage: 1..10, layout: 'original',
             players: [{ type: 'human'|'cpu', level? }, x4],
             rules: { wins: 1..5 (3), time: 1|2|3|5|Infinity (2), gbomber: bool (true),
                      comLevel: 1..9 (5), champion: slot|null, bonus: 0..5 },
             seed })            // seed = $D6 at round init (0 after power-on)
game.tick(pads)                 // the round's first tick runs with $32 = 0
game.finished                   // battle loop over (256 ticks after the round-over)
game.nextRound()                // -> { winner|null, wins[4], matchOver }; starts the next
                                //    round unless the match is over
game.newMatch({ champion, bonus, stage })   // next match; champion = gold bomber
game.result
```
`players[i].level` overrides that bomber's +D2 (the original has one level for all COMs).
Events (game.events): `roundStart`, `clock {min, sec}`, `hurry {sfx $4E}`,
`suddenDeath`, `blockFell {cx, cy, sfx $72}`, `roundOver` (3+ bombers dying),
`roundEnd {winner, draw, sfx $46 on draw}` (last tick), `roundResult {winner, draw, wins}`
and `matchOver {winner, wins}` (from nextRound()).

## Verification (all measured)
- `check_init.mjs`: createGame() vs the original's WRAM at the end of its round init
  (frame where $18 returns to 0, before the first tick), over every logic range
  (objects $7E8000-$7EFFFF, grids/underlay/$7FE000 copy, tiles, deck, lists, danger map,
  $5Cxx-$5Exx globals, RNG): **identical on all 10 stages with 4 COM, 1P+3COM stage 1,
  4 humans (multitap) stage 1, the round-2 init of cpu_round (nextRound() from the
  original's last round-1 tick, incl. win counter, $5C3E, RNG-driven layout + deck), and
  a G-BOMBER match (P3 champion, roulette 4).** 14/14.
  Ignored: bomb-slot bytes other than the flags word (graphics scratch), the stage-10
  regrow lists on other stages (scoreboard scratch); for the gold case the previous
  match's leftovers outside the game state.
- Vectors: `timeout_sudden_death` (2597 ticks: Hurry, 80 blocks, time-up draw, 256-tick
  phase, exit) and `round_win` (403 ticks, exit, winner) pass with the full core.
  cpu_round's round-2 start is reached once the AI is exact.

## Findings / SPEC corrections
1. **Round init consumes RNG only in the soft-block removal (C0F50D) and the deck
   (C01CEA)**; nothing between the scoreboard and the first tick. Seed 0 at power-on and
   the menus never advance it (all 12 captures: seed 0).
2. **Deck quirk (C01CEA)**: a free position is drawn *before* the kind's count is checked,
   so each kind (including kinds with 0 cards) and the final terminator consume one extra
   successful draw (plus its retries). SPEC §7 "retries draw again" is incomplete.
3. **The round's first tick runs with $32 = 0** and is not counted: round init clears $16
   (C00D55 `STZ $16`), the NMI only counts a tick when $16 ≠ 0 (loop.js now models $16).
   Truth: cpu_round frames 4105-4109 show tick 0 (loading), the first tick completes in
   4109, $32 = 1 from 4110.
4. **Battle-loop exit happens at the end of the round's last tick** (when $BE reaches 0):
   $B9 |= $0800, winner $5C3E (C00B05), fade-out to $30 = $80, all before the next NMI;
   the frozen scoreboard frames then still count one more tick (INC $16 at C0FBB3).
   The scoreboard (CC4C7D) adds the win ($5E66 + 2·slot) and ends the match at ≥ $5C5A.
5. **Sudden-death sound $72 plays for every block** (C0D689: when the block's step $5D14
   is 0), not only the first. The cell is (re)written as $C1 on 4 consecutive steps
   (ticks +0, +3, +6, +9 of the block's 15), each time also zeroing its danger mark and
   running the ring-corner danger marks (C0D6A8; the 8th corner compares $1E06, which is no
   ring cell — (3,13) would be $0686 — so the second ring's last side is never pre-marked).
   [code]
6. **$5D10 (the 3-tick step counter) is not reset at round init**: a leftover value from
   the previous round shifts the first block by 0-2 ticks (1 or 0 → step at once, 2 → one
   tick later). SPEC's "block n at 5656 + 15n" holds for the leftover in that capture. [code]
7. A block on a bomb deletes it only if the bomb is not exploding/held ($5000), returning
   it to its owner (C0E42E: out −1; in hand = cap − out, 0 with disease 3, 1/0 with 6).
   A block on a pending stage-10 regrow cell cancels the regrow (C0D7CC).
8. Stage-3 tunnel closing (C0D52B) only queues 8 cell animations in $7E3D88 (script
   $C5E264, cells $C5E286, tiles $C5E296); the cells turn $C1 through the C0DA42 list.
9. G-BOMBER: C00B8A turns $5C3C (champion slot) into the object pointer every round; it
   is restored from $1CAF between rounds (CC2763). Bonus (C019CB, table $C5D5C2):
   0 → +F1/+E1 +1, 1 → +F0/+E0 +1, 2 → +FE +1, 3 → +FF +1, 4 → +EF +1, 5 → +F0/+E0 −1.
   Measured: roulette 4 → P3 +EF = 1, +04 b8, +50 = 2.
10. Bomber start records are constant (C02153/C02401 templates): +00 $8000, +04 $0600 |
    COM, +06/+0A/+2A slot, anim pointers +70 $C20399 / +76 $C20375; stats C0190D (all
    stages but id 4); spawns $C5E51C / $C5E52C; empty slot (+04 b1) parks at (0, $F0).
11. Stage maps: the per-stage map (layout_data.js) is decoded from the ROM by running the
    original with the removal table zeroed; grid high bytes are always 0 (C0F5AF masks
    them), every cell outside cols 0..16 × rows 0..17 is $C5 / tile 0. Only stage id 7 has
    an initial tile-animation list ($2BF0, C135A6).
12. The inner-field list $7F0B10/$7F0D10 (C0F4A1) is row-major on every stage; the
    sudden-death order $C5E1C9 (145 bytes, $FE after 80) indexes it.
