# NOTES — core: stage 2 (ice) and stage 3 (beach) gimmicks

Code: `public/arcade/sb2/core/stage2.js`, `stage3.js` (handlers exported under their ROM
address, routed by `stage.js`). Verified: `cpu_stage02` (3894 ticks) and `cpu_stage03`
(3218 ticks) match the original's WRAM tick for tick (run.mjs + wdiff, all logic ranges);
stage 3 needs the bombers.js quirk below.

## Stage 2 ($1A = 1)
- **Ice input C0C09E**: as SPEC, plus: the latches live in +52 b15 (X) / b14 (Y), the latched
  input in +54 / +AC and the sign in +AE / +CE; releasing keeps the velocity (no accel);
  the opposite input sets the deceleration flag until the integer part reaches 0, then the
  axis is zeroed and the latch dropped. Quirk: the Y "same direction" path clears +00 b2
  (the X deceleration flag), not b3. The routine also writes +3A / +32 (0 for level 1).
- **Push C0ACD4**: guarded by `$1A == 1` itself. The soft block ahead must not be in the
  burn list; the cell beyond must be non-object or an item ($44) — fire ($01) and floor
  pass — and no object stands there. Quirk: the new mover gets the pusher's +00 low
  nibble (velocity sign bits) ORed in. The block mover itself is movers.js (C094B4).
- **Holes** (underlay $49, type 9) — SPEC is incomplete. Real mechanism:
  1. C04468 (bombers only, not in sudden death unless already in the system): fall in
     (C04599: snap, drop a carried bomb, +52 = $0801, +02 = $0800, anim set 4, sfx $5E);
     wait for the fall animation (+0C = $FFF), rise anim, then C044E3 moves the bomber 8 px
     toward the arena centre (rows < 9: down, else up) and sets +52 b8 = **riding**.
  2. Riding (C05763 → C05841/C05977): the bomber travels at 2 px/tick along the
     underground track cells (underlay 8, junctions $0A, holes $49 — the `,` cells of the
     map). At the end of a straight it snaps and turns (prefers the perpendicular cell with
     underlay 8). At a $0A junction it turns randomly: dir = $C5EB4D[$0406 & $1E]; if that
     is the reverse of the facing, the retry reads $C5EB4D[facing + 2] (quirk).
  3. Entering a hole cell while riding → launch C04386: vy 8 up, decelerating 0.5/tick²,
     shadow object (mode 4, +C8), landing cell = below the hole (above if solid/object).
     When vy's integer part hits 0: +52 b13, accel 1/16 downwards. Landing when +A8 ==
     +CC: snap, remove the shadow, +52 &= $C000, +02 b11 off. A top-row hole launches
     immediately (the 8 px move stays on the hole); a bottom-row hole rides the track first.
  4. Landing on a bomb sets $5D02 = 1 and hops off (C0838C). $5D02 is never cleared on this
     stage (only the stage-10 jump code writes it), so every later landing hops (quirk).
- C04623 / C046E3 (cell types $0B / $0C) are never reached in battle (no such cells).

## Stage 3 ($1A = 2)
- **Walking velocity**: computed in the per-tick routine C0426E → C069D8 (before the
  objects run), not in C0C01C (which returns after saving the position). Every bomber:
  speed from level, velocity 0, +CA = 0; touching pairs (|dx| < 13, |dy| < 15, other not
  dying) set bits in $5C8C; bombers in no pair get the normal C0C2CE input velocity.
- **Collision groups**: $C5EA65[$5C8C] gives a group nibble per bomber (1 / 2); group 1 →
  $5C90.., group 2 → $5C98.. (a second, separate pair). Lists sorted descending by y
  ($3F88) and x ($3F98) with the C028A7 sort. Per-bomber blocked directions +CA b4..b7
  (C06FE3: cell beyond solid and aligned, or a bomb, or off-centre on the other axis;
  all blocked while busy). Pairs: same row / same column → the pusher moves both at
  0.5 px/tick (sfx $49) unless the other walks away or can sidestep; otherwise only
  moving apart is allowed. 3–4 bombers: in a line → walking directions are voted
  ($5E positive / $5C negative) and the winners push the chain (+CA b8 / b9 set on the
  pushed); not in a line → only the outermost may walk outwards. Quirk: the first vote
  of a column (C07B64) masks the second bomber with $0300 (X bits) when the first walks up.
- **Tunnels C04DE1** (underlay $11 at rows 2 / 16, cx 4 / 12): teleport to the other end
  (y = $EF going up, $11 going down), exit cell closed ($FB) until the bomber leaves the
  $11 cells (C042D9 / C0427B re-open them), input forced (+52 |= $0801, vy = speed or 2).
  Blocked (exit closed / occupied / another transit) → pushed back by the depth into the
  $11 cells (a grouped bomber pushes its group). Quirk: the "tunnel busy" test is
  `$5D04 & 3` for both tunnels (the cx-12 tunnel checks the cx-4 bits). Kicked bombs
  (+52 b5) use tunnels too.

## Core-wide finding (bombers.js, owned by the parent)
- **C022E2 quirk**: C02348 is `LDA #$0052` followed by `LDA [$6A],Y` with Y = $0E, so the
  velocity-sign update C02357 is gated by **+0E bit 0** (the animation "new frame" flag),
  not by +52 bit 0. Matters for busy bombers (stage-3 tunnel transit reverses the vy sign
  on the next tick). Measured: cpu_stage03 frame 392, write to P2+00 at C023F0 with
  +52 = $0801.
