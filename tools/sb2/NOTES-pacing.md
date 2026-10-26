# NOTES — game speed: the original's lag frames (pacing model)

The port used to run one logic tick per 60 Hz display frame. The original does not: its
main loop (C0FB11) runs a tick and waits for the next NMI; a tick that overruns the frame
loses it (the NMI finds `$16 = 0`: no picture upload, no tick starts, that frame's pads are
never read). So the real game is slower than 60.0988 ticks/s, the more so the busier it is.
The wall now reproduces those lost frames (`public/arcade/sb2/pacing.js`, used by `app.js`).

## 1. Measuring the original's cost per tick (harness)

`tools/sb2/harness/sb2_shim.cpp` hooks v2 (inert unless enabled): every traced instruction
carries the running master-cycle count (`V*H_Max + H`, unwrapped; a small negative step is
snes9x's line bookkeeping and is kept signed); a set of exact PCs can be traced; master
cycles can be summed per ROM offset. `tools/sb2/re/lagcost.py` replays every vector with
these PCs traced: NMI entry 00FD84 / `$16` test 00FDA5 / RTI 00FDEE, the main loop's wait
exit C0FB23, every JSL of the loop C0FB39..C0FB89, INC `$16` C0FB8D, the wait C0FB18, and
every call site of the per-object loop C01E3C..C01E98. Output `data/sb2/re/lag/<vector>.json`:
per tick the work (cycles C0FB23 -> C0FB18, NMI time inside removed), per routine and per
object segment, and every NMI (duration, `$16` flag).

Measured (46 vectors, 62 753 ticks):
- frame = 262 x 1364 = **357 368** master cycles. NMI handler: **26.3k** cycles, **35.1k**
  when the previous tick streamed a bomber pose (C0211A).
- a tick's work: median ~240k (humans) .. 290k (4 COMs) cycles; ~55k of it is the object
  loop overhead, per bomber ~12k standing / ~21k walking / ~31k walking diagonally into a
  corner slide (movement C0A474), ~11k OAM build (C09C7B) + ~20k when its animation steps
  (the pose graphics are copied again), COM AI 0.3k..37k (mostly 5-8k).
- **the frame rule**: `frames = floor((nmi + work) / 357368) + 1` gives the original's tick
  lengths (the gaps between the frames in which ticks complete) for **99.9 %** of the ticks.
  A tick that ends between `INC $16` and the wait lets the NMI hit before the wait: that is
  the `$32` double increment of SPEC §0, and also costs the frame (hence C0FB18, not C0FB8D).
- spikes: when a dead bomber's death animation ends, C09712 scans the grid for 128 free
  cells for its items, wrapping around until it has them: ~430 cycles per iteration,
  0.6M..4.2M cycles (2..12 frames: the visible hitch when a bomber disappears); item
  scatter puffs (effect objects C10CAF) ~17k each; explosions end with a grid restore.

## 2. Predicting it from the port

The port's core is the same routines, so what it did in a tick tells what the original
spent. `pacing.js vector()` (41 inputs) after each `game.tick` + `display.frame`:
- the core's **work meter**: `core/mem.js COST` counts every memory access of the logic per
  routine group (`loop.js` sets the group before each routine of C0FB39..C0FB89;
  `bombers.js` separates the COM AI C0C54B and the movement C0A474). Counting only, the
  logic is unchanged (46/46).
- display work the port does in `render/`: bombers' pose pieces (ROM count byte at the pose
  pointer), animation steps (pose streaming) x pieces, pose changes, movers' pieces, active
  effect objects, `newFrame` (display.js `stats`).
- counts: C09712 iterations (simulated exactly, `scatterScan`), RNG draws (`$D6` recurrence
  steps), item scatters, even tick, exploding bombs on even ticks, explosion ranges, grid
  cells changed, bombers active/gone/dying/moving/busy, movers, fade.
- weights: ridge least squares (standardised, lambda 1, the constant meter group unpenalised)
  on the measured work, and on the next NMI's length, `tools/sb2/conformance/lagfit.py` ->
  `public/arcade/sb2/pacing_coef.js` (generated). Fit residual 2.6k cycles rms in play
  (the margin to the frame budget is typically 30-80k). No per-stage terms: with them the
  fit was better in-sample but held-out stages were off by up to 6 %; without them every
  held-out stage is within 0.9 % except stage 10 (+2.9 %: its regrowth routine C0D8E8 is
  the only one of its kind).

## 3. Validation (`node tools/sb2/conformance/lagcheck.mjs`, the JS model as the wall runs it)

Predicted vs actual frames per tick on every vector (round-boundary ticks excluded):

| vector | ticks | actual frames | predicted | speed error | ticks matched |
|---|---|---|---|---|---|
| cpu_round (4 COM, stage 1, full round + round 2) | 8189 | 8484 | 8469 | +0.18 % | 99.33 % |
| cpu_round_1p (1 human + 3 COM) | 4975 | 4998 | 4998 | 0.00 % | 99.88 % |
| cpu_stage02 .. cpu_stage10 (4 COM) | 3216-3896 | | | -0.20 .. +0.55 % | 98.39-99.79 % |
| stage03_sudden_death | 2565 | 2698 | 2704 | -0.22 % | 99.30 % |
| timeout_sudden_death | 2595 | 2614 | 2613 | +0.04 % | 99.92 % |
| walk_cleared / walk_natural (humans) | 1190 / 899 | 1199 / 899 | 1199 / 899 | 0.00 % | 100 % |
| all 46 vectors | 62705 | 65061 | 65015 | +0.07 % | |

Actual rate on stage 3 with 4 COMs: 52.79 ticks/s (12.2 % of frames lost) — the model 52.84;
stage 1 (cpu_round) 58.01 vs 58.11; 1 human + 3 COM 59.82 vs 59.82.
Leave-one-vector-out (`lagfit.py --loo`): every vector within 0.9 % except cpu_stage10 +2.9 %.

Scenarios on the port (`lagcheck.mjs --sim`, stages 1..10, 3600 ticks each, model rate):

| scenario | original layout | tall |
|---|---|---|
| 1 human walking + 3 idle | 60.03 ticks/s (0.1 % lag) | 60.01 |
| 1 human + 1 CPU (+2 idle) | 59.92 (0.3 %) | 59.95 |
| 1 human + 3 CPU | 58.47 (2.7 %) | 58.77 |
| 4 CPU | 57.47 (4.4 %) | 57.37 |
| sudden death rounds (1 H + 3 CPU) | 57.79 (3.8 %) | 57.31 |

## 4. The live loop (app.js)

- One SNES frame per display frame. `sacc` counts SNES frames due at 60.0988 Hz from the
  rAF timestamps (dt clamped to 3 frames: a hiccup never fast-forwards).
- After a tick, `pacer.after()` = the frames the original spends on it. The `n - 1` lag
  frames that follow: no tick, no input (a press made only during them is dropped, like
  the original), the old picture stays; the tick's picture is shown when its last lag
  frame passes (like the original's NMI upload after the tick completes).
- Never two ticks in one display frame. The wall's 60.00 Hz is 0.16 % slower than the
  SNES: a lag frame due while a frame of debt is pending is consumed without spending a
  display frame, so with COMs (lag every ~20-50 frames) the long-run rate is exactly the
  original's; with humans only (almost no lag) the debt is dropped (60.00 instead of
  60.10 ticks/s, -0.16 %).
- The previous loop ran 60.00 ticks/s whatever happened: 3-14 % faster than the original
  with COMs (14 % on stage 3), which is what the user saw.

## Rebuild

    python3 tools/sb2/re/lagcost.py                 # ~10 min (4 in parallel: split the names)
    node tools/sb2/conformance/lagdata.mjs
    python3 tools/sb2/conformance/lagfit.py --loo   # writes pacing_coef.js
    node tools/sb2/conformance/lagcheck.mjs --sim
