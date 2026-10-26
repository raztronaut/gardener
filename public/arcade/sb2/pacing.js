// Super Bomberman 2 · Tall — the original's game speed: which display frames are LAG frames.
//
// The SNES game does not run one logic tick per video frame. Its main loop (C0FB11) runs
// a tick, then waits for the next NMI; when a tick's work does not fit in the frame, the
// NMI finds it unfinished ($16 = 0), skips the picture upload and the frame is lost: no
// tick starts, the old picture stays, and the pads of that frame are never read. So the
// real game runs slower than 60.0988 ticks/s, and slower the busier it is (0-1 % lost
// frames with humans only, up to ~12 % with 4 COMs on stage 3).
//
// Basis (all measured in the harness; tools/sb2/NOTES-pacing.md):
//   frames(tick) = floor((nmi + work) / 357368) + 1
//     357368 = 262 lines x 1364 master cycles = one NTSC frame;
//     nmi  = master cycles of the NMI handler that starts the tick (26.3k, +8.8k when a
//            bomber pose was streamed by the previous tick), work = master cycles from
//            the end of the main loop's wait (C0FB23) back to the wait (C0FB18).
//     From the MEASURED cycles this rule gives the original's tick lengths 99.9 % of the
//     time (tools/sb2/re/lagcost.py: cycle-stamped traces of every vector).
//   work and nmi are predicted from what the port's logic did this tick (a line-by-line
//   rewrite of those routines):
//     - the core's work meter (core/mem.js COST): memory accesses per routine group
//       (C00C36, C01602, ..., the COM AI C0C54B, movement C0A474, ...),
//     - what the original does only for the picture and the port does in render/
//       (OAM build C09C7B: pose pieces and pose streaming; effect objects C10CAF),
//     - a few counts (item-scatter scan C09712 iterations, explosions, RNG draws, grid
//       cells changed). No per-stage terms: the stage routines' work is in the meters
//       (a fit with per-stage constants was better in-sample but worse on a held-out
//       stage, and the tall arena is "unseen" by construction).
//   The weights are a ridge least-squares fit to the measured cycles of ~62 700 ticks
//   (46 vectors), generated into pacing_coef.js by tools/sb2/conformance/lagfit.py.
//   Validation (tools/sb2/conformance/lagcheck.mjs): NOTES-pacing.md.
// Tall: the same model; the tall arena's extra work shows up in the meters.
//
//   const pacer = createPacer({ rom8 });           // pack.rom8 (pose piece counts)
//   game.tick(pads); disp.frame(game, ev);
//   const frames = pacer.after(game, disp);        // 1 = on time, n > 1: n - 1 lag frames
//   pacer.reset();                                  // a new round
import { COST } from './core/mem.js';
import { W, WN } from './pacing_coef.js';

export const FRAME_CYCLES = 262 * 1364;
const r16 = (m, a) => m[a] | (m[a + 1] << 8);
const r24 = (m, a) => m[a] | (m[a + 1] << 8) | (m[a + 2] << 16);
export const ACC_TAGS = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21];
export const FEATURE_NAMES = ['nAct', 'pieces', 'animStep', 'stepPieces', 'poseCh', 'fx', 'newFrame', 'movPieces',
  'rngSteps', 'itemScattered', 'even', 'evenExpl', 'explRange', 'gridCh', 'scanIt',
  ...ACC_TAGS.map((t) => 'acc' + t),
  'nGone', 'nDying', 'nmov', 'frozen', 'nMoved', 'nBusy'];

// C09712 (free-cell scan for a dead bomber's items): loop iterations as the original runs
// them (it wraps until it has 128 cells; ~430 master cycles per iteration)
function scatterScan(m, tall) {
  const end = tall ? 0x0F00 : 0x800, mask = tall ? 0x0FFF : 0x7FF;
  let first = 0xFFFF, n = 0, i = 0x0204, x = 0, it = 0;
  for (;;) {
    if (i >= end) { if (first === 0xFFFF) break; i = 0x0204; }
    x = i & mask;
    const c = r16(m, 0x1C000 + x);
    it++;
    if (c === 0 || !(c === 0x12 || c === 0x13 || c === 0x11 || c === 0x44 || c === 0x01 || (c & 0xC0))) {
      if (n === 0) first = x;
      x = n; n += 2;
      if (n >= 0x100) break;
    }
    i += 2;
    if (i < end) continue;
    if (r16(m, 0x1E000 + x) & 0x8000) break;   // C0977E (the scan left this list in WRAM)
    if (it > 200000) break;
  }
  return it;
}

export function createPacer(opts = {}) {
  const rom8 = opts.rom8 || (() => 0);
  const prevX = new Int32Array(4), prevY = new Int32Array(4), prevPose = new Int32Array(4);
  const prevT = new Int32Array(4).fill(-1), prevGone = new Uint8Array(4);
  const prevGrid = new Uint8Array(0x1000);
  let prevRng = -1, primed = false;
  let nmiNext = 26270;                 // the NMI that starts the next tick
  const f = new Float64Array(FEATURE_NAMES.length);
  // (the fit tools only use vector(); a stale pacing_coef.js disables after())
  const usable = W.length === f.length && WN.length === f.length;

  // the model's inputs for the tick just run (game.mem after game.tick, disp after frame())
  function vector(game, disp) {
    const m = game.mem;
    const tall = !!(game.layout && game.layout.tall);
    f.fill(0);
    if (!primed) {                     // first tick after reset(): no "changed since" counts
      primed = true;
      prevGrid.set(m.subarray(0x1C000, 0x1D000));
      for (let i = 0; i < 4; i++) {
        const p = 0x8000 + 0x100 * i;
        prevX[i] = r16(m, p + 0x10); prevY[i] = r16(m, p + 0x18); prevPose[i] = r24(m, p + 0x79);
        prevGone[i] = (r16(m, p + 0x60) & 0x0800) ? 1 : 0;
      }
    }
    const even = (r16(m, 0x32) & 1) === 0 ? 1 : 0;
    let nAct = 0, pieces = 0, animStep = 0, stepPieces = 0, poseCh = 0, scanIt = 0;
    let nGone = 0, nDying = 0, nMoved = 0, nBusy = 0;
    const b9 = r16(m, 0xB9);
    for (let i = 0; i < 4; i++) {
      const p = 0x8000 + 0x100 * i;
      const fl = r16(m, p), gone = (r16(m, p + 0x60) & 0x0800) ? 1 : 0;
      const x = r16(m, p + 0x10), y = r16(m, p + 0x18), pose = r24(m, p + 0x79);
      const act = (fl & 0x8000) && !gone ? 1 : 0;
      nAct += act;
      if (act) pieces += rom8(pose);
      // the animation stepped: C09E7D streams the pose graphics again (display.js newFrame)
      const t = r16(m, p + 0x0C), pt = prevT[i];
      const st = (fl & 0xA000) === 0x8000 && pt >= 0 && !(pt === 0x0FFF && t === 0x0FFF) && !(pt > 0 && pt !== 0x0FFF && t === pt - 1) ? 1 : 0;
      animStep += st;
      if (st) stepPieces += rom8(pose);
      if (pose !== prevPose[i]) poseCh++;
      if (gone && !prevGone[i] && (b9 & 0x8000)) scanIt += scatterScan(m, tall);
      nGone += gone;
      if (fl & 0x0800) nDying++;
      if (x !== prevX[i] || y !== prevY[i]) nMoved++;
      if (r16(m, p + 0x52) & 1) nBusy++;
      prevT[i] = t; prevX[i] = x; prevY[i] = y; prevPose[i] = pose; prevGone[i] = gone;
    }
    let nmov = 0, movPieces = 0;
    for (let s = 0; s < 64; s++) {
      const p = r16(m, 0x2620 + 2 * s);
      if (p === 0xFFFF) break;
      if (p >= 0x8400) { nmov++; if (p < 0xA000) movPieces += rom8(r24(m, p + 0x79)); }
    }
    let nexpl = 0;
    for (let b = 0; b < 40; b++) if ((r16(m, 0x12000 + 0x100 * b) & 0xC000) === 0xC000) nexpl++;
    const rowsEnd = tall ? 29 : 15;
    let gridCh = 0;
    for (let y = 2; y <= rowsEnd + 1; y++) for (let x = 0; x <= 16; x++) {
      const a = y * 0x80 + x * 2, c = m[0x1C000 + a];
      if (c !== prevGrid[a]) { gridCh++; prevGrid[a] = c; }
    }
    const rv = r16(m, 0xD6);
    let rngSteps = 0;
    if (prevRng >= 0) { let sd = prevRng; while (sd !== rv && rngSteps < 64) { sd = ((sd | 1) * 0x0383) & 0xFFFF; rngSteps++; } }
    prevRng = rv;
    let itemScattered = 0, explRange = 0;
    const ev = game.events || [];
    for (let k = 0; k < ev.length; k++) {
      const e = ev[k];
      if (e.type === 'itemScattered') itemScattered++;
      else if (e.type === 'bombExploded') explRange += m[0x12000 + 0x100 * (e.bomb || 0) + 7];
    }
    let k = 0;
    f[k++] = nAct; f[k++] = pieces; f[k++] = animStep; f[k++] = stepPieces; f[k++] = poseCh;
    f[k++] = disp ? disp.stats.fx : 0; f[k++] = disp ? disp.stats.newFrame : 0; f[k++] = movPieces;
    f[k++] = rngSteps; f[k++] = itemScattered; f[k++] = even; f[k++] = even * nexpl; f[k++] = explRange;
    f[k++] = gridCh; f[k++] = scanIt;
    for (let j = 0; j < ACC_TAGS.length; j++) f[k++] = COST.last[ACC_TAGS[j]];
    f[k++] = nGone; f[k++] = nDying; f[k++] = nmov; f[k++] = (m[0x30] & 0x0F) !== 0x0F ? 1 : 0;
    f[k++] = nMoved; f[k++] = nBusy;
    return f;
  }

  const dot = (w, x) => { let s = 0; for (let i = 0; i < x.length; i++) s += w[i] * x[i]; return s; };
  const pacer = {
    featureNames: FEATURE_NAMES,
    vector,
    last: { work: 0, nmi: 0, frames: 1 },
    // after each tick: the display frames the original spends on it (1 = no lag)
    after(game, disp) {
      const x = vector(game, disp);
      if (!usable) return 1;
      const work = dot(W, x);
      const nmi = nmiNext;
      nmiNext = Math.max(20000, dot(WN, x));
      let frames = Math.floor((nmi + work) / FRAME_CYCLES) + 1;
      if (!(frames >= 1)) frames = 1;
      if (frames > 12) frames = 12;
      pacer.last.work = work; pacer.last.nmi = nmi; pacer.last.frames = frames;
      return frames;
    },
    // a new round: forget the previous tick (round init clears $16; the first tick
    // starts after the init's own NMI)
    reset() { prevT.fill(-1); prevRng = -1; nmiNext = 26270; primed = false; },
  };
  return pacer;
}
