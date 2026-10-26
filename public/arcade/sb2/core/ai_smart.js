// COM level ★ — a new CPU player (not in the original game). Levels 1..9 are the
// original's AI (ai.js, a faithful transliteration); ★ is a separate decision module that
// plays a bomber THROUGH ITS PAD, exactly like a human with a controller:
//   - the ★ slot is a MAN slot in the core ($5C4C = 0, +04 b0 = 0): the original COM AI
//     never runs for it, and its pad goes through the human input path (C01602) — same
//     rules, speed, items, diseases, edge-triggered A — nothing in the game logic changes;
//   - fillPads() runs before every tick and writes the ★ slots' pad masks (libretro bit
//     order, like game.tick's pads);
//   - perception: only what the screen shows — the arena cells (floor / blocks / items /
//     bombs / fire / gimmick tiles), the bombs (position, fuse = the time since a human
//     saw it placed, range = the owner's fire, which a human tracks from the pickups),
//     moving bombs, the bombers' positions and stats (their pickups). Never another
//     bomber's pad / input word, never what is hidden under a soft block (the deck);
//   - human-like: a reaction delay of 6..10 ticks for everything others do (bombs placed,
//     kicked or thrown by others; their positions), occasional small mistakes (a
//     hesitation, a less-than-best target), no wall-hacks.
// The ★ slots are marked in the WRAM image ($7E7001 bit i, a byte the original never
// uses — like the tall flag $7E7000), so they survive save()/load(). The planner's own
// memory lives in plain typed arrays per game (no per-tick allocations).
//
// The planner (per tick, per ★ bomber):
//   1. world: cells, bombs with a time window for their detonation [Dlo, Dhi] from the
//      fuse (measured: D = now + 2*fuse - 1 .. + 8; one detonation per even update),
//      chain reactions (a ray that reaches a bomb sets it off 2..8 ticks later), moving
//      (kicked / thrown / conveyed) bombs swept along their path, the stage-4 fuse ring,
//      the sudden-death block schedule; -> per cell up to two LETHAL intervals of ticks;
//   2. a time-dependent earliest-arrival search (Dijkstra on (cell, time) with waiting)
//      at the bomber's speed: a cell is entered only if it is not lethal while the
//      bomber's centre is in it (margins of 2 ticks), so a path never walks into fire;
//   3. danger: if the cell it stands in will be lethal, run to the nearest cell that is
//      never lethal again (fewer dead ends / foes nearby preferred);
//   4. otherwise pick a goal by value - time: items (speed / bombs / fire / kick /
//      glove ..., skulls avoided), bombing spots (soft blocks not already doomed by
//      another blast), attack spots (a foe in line, in a corridor), stage pads;
//   5. a bomb is placed only with a GUARANTEED escape: the same search with the new
//      bomb (and every chain it causes) must reach a never-lethal cell; attacks are
//      scored by how many safe cells the foe still has after the bomb (0 = trapped);
//   6. kick a bomb into a foe's line, lift+throw (glove) onto a foe in line;
//   7. stage gimmicks: ice (velocity control), holes / stop pads avoided, teleporters as
//      graph edges, tunnels (stage 3, bombers solid), conveyors (bombs swept along the
//      belt), stage 10 Y-jump over a bomb when cornered.
// Cost: a few 10 k simple operations per ★ bomber per tick (tools/sb2/ai-eval/perf).
import { isTall } from './geom.js';
import { sdOrderNow } from './round.js';

export const debug = { on: false };   // tools: per-bot decision tags in bot.dbg
export const STAR_LEVEL = 10;            // players[i].level / the menu's ★ (after 9)
export const STAR_FLAG = 0x7001;         // $7E7001: bit i = slot i is a ★ COM
// pacing: the original COM AI's work meter (COST group 20, C0C54B) per living COM per
// tick, measured (tools/sb2/ai-eval/starcost.mjs); a ★ tick is charged the same
export const STAR_COST = 50;            // (measured 49.5 at level 5, 10 stages x 2 layouts)

// libretro pad bits
const B_UP = 16, B_DOWN = 32, B_LEFT = 64, B_RIGHT = 128, B_A = 256, B_Y = 2;
const DIRBIT = [B_UP, B_DOWN, B_LEFT, B_RIGHT];
const DC = [-32, 32, -1, 1];             // cell index delta per direction (32 cells per row)
const DX = [0, 0, -1, 1], DY = [-1, 1, 0, 0];
const OPP = [1, 0, 3, 2];
const SPEED = [0.5, 1.25, 1.5, 2.0, 2.5, 2.75, 3.0, 0.8125, 0, 0.375, 3.5];   // $C5FB07

const NC = 1024;                         // cells: cy * 32 + cx
const INF = 0x3FFFFFFF;
// margin (ticks) around a lethal interval: 2 normally, 4 when planning a bomb's escape
// (robust), -2 in an emergency (the model is ~2 ticks early about the fire: fire is
// written at D+2 and kills from D+3, the window starts at D_lo+1)
let MARG = 2;
const MAXWAIT = 240;
// searches per tick for all ★ bombers together (~15-25 us each on the Jetson): a bomb /
// kick / throw evaluation that does not fit waits for the next tick (escapes always run)
const SEARCH_BUDGET = 36;

// item tile low byte -> value (view.js ITEM_NAMES)
const IT_BOMB = 0x00, IT_FIRE = 0x02, IT_FULL = 0x06, IT_SKULL = 0x0A, IT_SPEED = 0x22,
  IT_KICK = 0x24, IT_GLOVE = 0x26, IT_RUBBER = 0x28, IT_POWER = 0x2A;

// ---- memory ---------------------------------------------------------------------------
let m = null;
const g16 = (a) => m[a] | (m[a + 1] << 8);
const cellCode = (c) => m[0x1C000 + ((c >> 5) << 7) + ((c & 31) << 1)];
const cellUnder = (c) => m[0x1D000 + ((c >> 5) << 7) + ((c & 31) << 1)];
const cellTile = (c) => g16(0x1A000 + ((c >> 5) << 6) + ((c & 31) << 1));
const giToCell = (gi) => ((gi >> 7) << 5) | ((gi & 0x7F) >> 1);
const cellToGi = (c) => ((c >> 5) << 7) | ((c & 31) << 1);

export function isStar(mem, slot) { return ((mem[STAR_FLAG] >> slot) & 1) === 1; }

// ---- small deterministic RNG (the game's RNG is never touched) --------------------------
function rnd(s) { s.r = (Math.imul(s.r ^ (s.r >>> 15), 0x2C1B3C6D) + 0x6D2B79F5) | 0; return ((s.r >>> 8) & 0xFFFF) / 65536; }

// ======================================================================================
// per-game world tracking (shared by the ★ bombers of a game)
// ======================================================================================
function makeWorld() {
  return {
    tick: -1,
    bombSeen: new Int32Array(40).fill(-1),   // tick a bomb slot was first seen (this life)
    bombKey: new Int32Array(40).fill(-1),    // cell | 0x10000 * type, to tell a new bomb
    bombDet: new Int32Array(40).fill(-1),    // tick it was first seen exploding
    moverSeen: new Int32Array(32).fill(-1),  // tick a moving bomb (mover) was first seen
    moverPX: new Int32Array(32), moverPY: new Int32Array(32),
    moverVX: new Float64Array(32), moverVY: new Float64Array(32),
    fireSeen: new Int32Array(NC).fill(-1),
    burnT: new Int32Array(NC).fill(-1),      // tick a soft block was last seen burning
    walk: new Uint8Array(NC),                // this tick: a bomber's centre may enter (walkable())
    belt: new Uint8Array(NC),                // stage 8 conveyor cells
    skull: new Uint8Array(NC),               // this tick: a skull lies there
    posX: new Int32Array(4 * 32), posY: new Int32Array(4 * 32),   // ring of 32 ticks
    lastX: new Int32Array(4), lastY: new Int32Array(4),
    ring: new Uint8Array(NC), ringN: 0,      // stage-4 fuse ring cells
    tele: new Int16Array(NC).fill(-1),       // stage-6 teleporter partner cell
    rows: 15, tall: false, stageId: 0,
    roundKey: -1,
    budget: 0,                               // searches left this tick (all ★ bombers)
    ringList: new Int16Array(64), ringN2: 0,
  };
}

function worldRound(W) {
  W.tall = isTall();
  W.rows = W.tall ? 29 : 15;
  W.stageId = g16(0x1A);
  W.bombSeen.fill(-1); W.bombKey.fill(-1); W.bombDet.fill(-1); W.moverSeen.fill(-1);
  W.fireSeen.fill(-1);
  W.ring.fill(0); W.ringN = 0; W.ringN2 = 0; W.tele.fill(-1);
  for (let cy = 3; cy <= W.rows; cy++) for (let cx = 1; cx <= 15; cx++) {
    const c = cy * 32 + cx;
    if (W.stageId === 5 && (cellUnder(c) === 0x0E || cellCode(c) === 0x0E)) { W.ring[c] = 1; W.ringN++; if (W.ringN2 < 64) W.ringList[W.ringN2++] = c; }
  }
  if (W.stageId === 7) {                   // teleporters: partner = the pad with the same tile
    const pads = [];
    for (let cy = 3; cy <= W.rows; cy++) for (let cx = 1; cx <= 15; cx++) { const c = cy * 32 + cx; if (cellCode(c) === 0x50) pads.push(c); }
    for (const a of pads) for (const b of pads) if (a !== b && (cellTile(a) & 0x3FF) === (cellTile(b) & 0x3FF)) W.tele[a] = b;
  }
  for (let i = 0; i < 4; i++) {
    const p = 0x8000 + 0x100 * i, x = g16(p + 0x10), y = g16(p + 0x18);
    for (let k = 0; k < 32; k++) { W.posX[i * 32 + k] = x; W.posY[i * 32 + k] = y; }
    W.lastX[i] = x; W.lastY[i] = y;
  }
}

function worldUpdate(W) {
  const t = g16(0x32);
  if (t === W.tick) return;
  const key = g16(0x5C40) * 7 + g16(0x5E66) + g16(0x5E68) * 3 + g16(0x5E6A) * 5 + g16(0x5E6C) * 11;
  if (t < W.tick || W.tick < 0 || key !== W.roundKey) { worldRound(W); W.roundKey = key; }
  W.tick = t;
  W.budget = SEARCH_BUDGET;
  for (let k = 0; k < 40; k++) {
    const b = 0x12000 + 0x100 * k, f = g16(b);
    if (!(f & 0x8000)) { W.bombSeen[k] = -1; W.bombKey[k] = -1; W.bombDet[k] = -1; continue; }
    const kk = g16(b + 0x0A) | ((f & 0x0F) << 16);
    if (W.bombSeen[k] < 0) { W.bombSeen[k] = t; W.bombKey[k] = kk; }
    if ((f & 0x4000) && W.bombDet[k] < 0) W.bombDet[k] = t;
  }
  for (let s = 4; s < 32; s++) {
    const o = 0x8000 + 0x100 * s, f = g16(o);
    const isBomb = (f & 0x8000) && ((g16(o + 0x7E) >> 8) & 0x0F) === 1;
    const x = g16(o + 0x10), y = g16(o + 0x18);
    if (!isBomb) { W.moverSeen[s] = -1; continue; }
    if (W.moverSeen[s] < 0) { W.moverSeen[s] = t; W.moverVX[s] = 0; W.moverVY[s] = 0; }
    else { W.moverVX[s] = W.moverVX[s] * 0.5 + (((x - W.moverPX[s]) << 16) >> 16) * 0.5; W.moverVY[s] = W.moverVY[s] * 0.5 + (((y - W.moverPY[s]) << 16) >> 16) * 0.5; }
    W.moverPX[s] = x; W.moverPY[s] = y;
  }
  for (let cy = 3; cy <= W.rows; cy++) for (let cx = 1; cx <= 15; cx++) {
    const c = cy * 32 + cx, v = cellCode(c);
    if (v === 0x01 || v === 0x41) { if (W.fireSeen[c] < 0) W.fireSeen[c] = t; }
    else W.fireSeen[c] = -1;
  }
  W.walk.fill(0); W.skull.fill(0);
  for (let cy = 3; cy <= W.rows; cy++) for (let cx = 1; cx <= 15; cx++) {
    const c = cy * 32 + cx;
    W.walk[c] = walkable(c, W) ? 1 : 0;
    W.belt[c] = isBelt(W, c) ? 1 : 0;
    if (cellCode(c) === 0x44 && (cellTile(c) & 0xFF) === IT_SKULL) W.skull[c] = 1;
  }
  // burning soft blocks (the burn list $7F0000; visible: the block's burning frames)
  for (let e = 0; e < 32; e++) {
    const a = 0x10000 + 16 * e;
    if (g16(a) & 0x8000) continue;
    W.burnT[giToCell(g16(a + 2))] = t;
  }
  const k = t & 31;
  for (let i = 0; i < 4; i++) {
    const p = 0x8000 + 0x100 * i;
    const f04 = g16(p + 4), f = g16(p);
    // a hidden bomber (blink disease, tunnel) keeps its last seen position
    if (!(f04 & 0x40) && !(f & 0x2000)) { W.lastX[i] = g16(p + 0x10); W.lastY[i] = g16(p + 0x18); }
    W.posX[i * 32 + k] = W.lastX[i]; W.posY[i * 32 + k] = W.lastY[i];
  }
}

// ======================================================================================
// a ★ bomber
// ======================================================================================
function makeBot(slot, seed) {
  const bot = {
    slot, p: 0x8000 + 0x100 * slot,
    rs: { r: (seed * 2654435761 + slot * 97 + 1) | 0 },
    react: 8,
    // lethal intervals per cell, two sets (A = the world, B = with a hypothetical bomb)
    A: mkDanger(), B: mkDanger(),
    // search results (two buffers: own / foe)
    S: mkSearch(), O: mkSearch(),
    // bombs gathered for the danger build
    nb: 0, bc: new Int16Array(64), bLo: new Int32Array(64), bHi: new Int32Array(64),
    cLo: new Int32Array(64), cHi: new Int32Array(64),    // windows after chains (per build)
    bR: new Int8Array(64), bPierce: new Uint8Array(64), bOwn: new Uint8Array(64),
    bMove: new Int8Array(64), bDir: new Int8Array(64), bLen: new Int8Array(64),
    bSp: new Float64Array(64), bOff: new Float64Array(64),   // moving: px/tick, px past the cell centre
    bombAt: new Int16Array(NC).fill(-1),
    doomed: new Int32Array(NC),          // stamp: soft block hit by a blast of the last build
    doomT: new Int32Array(NC),           // ... the earliest tick it is hit (this build)
    order: new Int16Array(64),           // bombs by detonation window (rays in that order)
    stamp: 1,
    doomBase: new Int32Array(NC), baseStamp: 1,   // ... of the world map (no hypothetical bomb)
    doomTA: new Int32Array(NC),
    foeMin: new Int32Array(NC), foeMinS: new Int32Array(NC), foeStamp: 0,   // foes' earliest arrival
    aLo: new Int32Array(64), aHi: new Int32Array(64),          // world map windows (after chains)
    atMap: new Int16Array(NC).fill(-1), atList: new Int16Array(64), nAt: 0,   // world map: bomb at cell
    blocked: new Uint8Array(NC),         // per-search: extra blocked cells (bombers on stage 3)
    // decisions
    goal: -1, goalUntil: 0, goalKind: 0, goalScore: 0,
    aHeld: false, lastA: -100, hesitate: 0, holdLift: false, liftAt: -100,
    yAt: -100, lastCell: -1, cellSince: 0, prevX: 0, prevY: 0, vx: 0, vy: 0,
    attackSkip: 0, mode: 0, hLo: -1, hHi: -1, liftT: -100,
  };
  bot.react = 6 + Math.floor(rnd(bot.rs) * 5);
  return bot;
}
function mkDanger() {
  return { s0: new Int32Array(NC), e0: new Int32Array(NC), s1: new Int32Array(NC), e1: new Int32Array(NC) };
}
function mkSearch() {
  return {
    arr: new Int32Array(NC), first: new Int8Array(NC), dep: new Int32Array(NC), stamp: new Int32Array(NC), cur: 0,
    hc: new Int16Array(4096), ht: new Int32Array(4096), hn: 0,
    list: new Int16Array(NC), n: 0,
  };
}

// ---- lethal intervals --------------------------------------------------------------------
function dClear(D, rows) {
  for (let cy = 2; cy <= rows + 1; cy++) for (let cx = 0; cx <= 16; cx++) {
    const c = cy * 32 + cx;
    D.s0[c] = INF; D.e0[c] = INF; D.s1[c] = INF; D.e1[c] = INF;
  }
}
function dAdd(D, c, s, e) {
  if (e < s) return;
  // merge with an overlapping / touching interval, else fill a free one, else merge into
  // the closer one (conservative)
  if (D.s0[c] !== INF && s <= D.e0[c] + 4 && e >= D.s0[c] - 4) { if (s < D.s0[c]) D.s0[c] = s; if (e > D.e0[c]) D.e0[c] = e; return dNorm(D, c); }
  if (D.s1[c] !== INF && s <= D.e1[c] + 4 && e >= D.s1[c] - 4) { if (s < D.s1[c]) D.s1[c] = s; if (e > D.e1[c]) D.e1[c] = e; return dNorm(D, c); }
  if (D.s0[c] === INF) { D.s0[c] = s; D.e0[c] = e; return dNorm(D, c); }
  if (D.s1[c] === INF) { D.s1[c] = s; D.e1[c] = e; return dNorm(D, c); }
  const d0 = Math.abs(s - D.s0[c]), d1 = Math.abs(s - D.s1[c]);
  if (d0 <= d1) { D.s0[c] = Math.min(s, D.s0[c]); D.e0[c] = Math.max(e, D.e0[c]); }
  else { D.s1[c] = Math.min(s, D.s1[c]); D.e1[c] = Math.max(e, D.e1[c]); }
  dNorm(D, c);
}
function dNorm(D, c) {                   // keep s0 <= s1, merge if they overlap
  if (D.s1[c] !== INF && D.s1[c] < D.s0[c]) {
    let t = D.s0[c]; D.s0[c] = D.s1[c]; D.s1[c] = t; t = D.e0[c]; D.e0[c] = D.e1[c]; D.e1[c] = t;
  }
  if (D.s1[c] !== INF && D.s1[c] <= D.e0[c] + 4) { if (D.e1[c] > D.e0[c]) D.e0[c] = D.e1[c]; D.s1[c] = INF; D.e1[c] = INF; }
}
// first lethal interval overlapping [a, b]: returns its end, or -1
function dHit(D, c, a, b) {
  if (D.s0[c] !== INF && D.s0[c] - MARG <= b && D.e0[c] + MARG >= a) return D.e0[c] + MARG;
  if (D.s1[c] !== INF && D.s1[c] - MARG <= b && D.e1[c] + MARG >= a) return D.e1[c] + MARG;
  return -1;
}
// never lethal from t on
const dFree = (D, c, t) => (D.s0[c] === INF || D.e0[c] + MARG < t) && (D.s1[c] === INF || D.e1[c] + MARG < t);
// first lethal tick >= t (INF if none)
function dNext(D, c, t) {
  if (D.s0[c] !== INF && D.e0[c] + MARG >= t) return Math.max(t, D.s0[c] - MARG);
  if (D.s1[c] !== INF && D.e1[c] + MARG >= t) return Math.max(t, D.s1[c] - MARG);
  return INF;
}

// ---- cells ----------------------------------------------------------------------------------
// can a bomber's centre be in this cell (ignoring fire, which is timed)?
function walkable(c, W) {
  const v = cellCode(c);
  if (v & 0x80) return false;
  if (v === 0x43) return false;                         // bomb
  if (v & 0x40) return v === 0x44 || v === 0x41 || v === 0x50;   // item / burning item / teleporter
  if (v === 0x0F && W.stageId === 8) {                   // stage 7 pads: never the stop / slow ones
    const t = cellTile(c);
    return t === 0x1C2C || t === 0x1C2E || t === 0x1C48;
  }
  return true;
}

// stage 8: a conveyor cell (it carries bombers and bombs: no standing still there)
const isBelt = (W, c) => W.stageId === 9 && (cellCode(c) - 0x17 & 0xFF) <= 7;
// a cell to stay in (refuge / goal)
const stayable = (W, c) => !isBelt(W, c);

// fire passes / stops (bombs.js ray): returns 0 = fire, 1 = fire and stop (bomb / burn),
// 2 = stop before
function rayKind(c, pierce) {
  const v = cellCode(c);
  const t = v & 0x3F;
  if (t === 0x0F || t === 0x09) return 0;
  if (t === 0x03) return 1;
  if (t === 0x02 || t === 0x04 || t === 0x0B) { if (pierce && t !== 0x05) return 3; }
  if (v & 0x80) return t === 0x02 ? 4 : 2;              // soft block: burns, stops (4)
  if (t === 0x26 || t === 0x0B) return 2;
  if (t === 0x04) return 5;                             // item: burns (lethal longer), stops
  return 0;
}

// ======================================================================================
// danger build: bombs (+ an optional hypothetical bomb at cell hc) -> lethal intervals
// ======================================================================================
function gatherBombs(bot, W, now) {
  bot.nb = 0;
  const me = bot.slot;
  for (let k = 0; k < 40; k++) {
    const b = 0x12000 + 0x100 * k, f = g16(b);
    if (!(f & 0x8000)) continue;
    const own = (m[b + 6] & 3) === me;
    if (!own && W.bombSeen[k] >= 0 && now - W.bombSeen[k] < bot.react) continue;   // not perceived yet
    if (f & 0x1000) continue;           // carried / moving: from its mover below
    const i = bot.nb++;
    bot.bc[i] = giToCell(g16(b + 0x0A));
    bot.bR[i] = m[b + 7] + 1;
    bot.bPierce[i] = (f & 0x0F) === 4 ? 1 : 0;
    bot.bOwn[i] = own ? 1 : 0;
    bot.bMove[i] = -1;
    const fuse = m[b + 4];
    if (f & 0x4000) { const d = W.bombDet[k] >= 0 ? W.bombDet[k] : now; bot.bLo[i] = d; bot.bHi[i] = d; }
    else { bot.bLo[i] = now + 2 * fuse - 1; bot.bHi[i] = now + 2 * fuse + 8; }
    if (bot.nb >= 60) return;
  }
  // moving bombs (kicked / thrown / conveyed): swept along their way
  for (let s = 4; s < 32; s++) {
    if (W.moverSeen[s] < 0) continue;
    const o = 0x8000 + 0x100 * s;
    const bk = g16(o + 0x40);
    if (bk < 0x2000 || bk >= 0x4800) continue;
    const b = 0x10000 + bk, k = (bk - 0x2000) >> 8;
    const own = (m[b + 6] & 3) === me;
    if (!own && now - W.moverSeen[s] < bot.react) continue;
    const i = bot.nb++;
    const x = W.moverPX[s], y = W.moverPY[s];
    bot.bc[i] = (((y + 23) >> 4) & 31) * 32 + (((x + 8) >> 4) & 31);
    bot.bR[i] = m[b + 7] + 1;
    bot.bPierce[i] = (g16(b) & 0x0F) === 4 ? 1 : 0;
    bot.bOwn[i] = own ? 1 : 0;
    const fuse = m[b + 4];
    bot.bLo[i] = now + Math.max(2, 2 * fuse - 30); bot.bHi[i] = now + 2 * Math.max(fuse, 1) + 12;
    const vx = W.moverVX[s], vy = W.moverVY[s];
    let sp = Math.abs(vx) + Math.abs(vy);
    const d = sp < 0.05 ? -1 : Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 3 : 2) : (vy > 0 ? 1 : 0);
    if (d < 0) { bot.bMove[i] = -1; continue; }   // carried / about to land: as a bomb where it is
    // speeds are fixed: kicked 2, thrown 4, conveyed 0.5625 / 2.3125 (the switch state)
    if (W.stageId === 9 && beltDir(bot.bc[i]) >= 0) sp = (g16(0x5CBE) & 1) ? 2.3125 : 0.5625;
    else sp = sp > 3 ? 4 : 2;
    bot.bMove[i] = d; bot.bSp[i] = sp;
    const cxp = 16 * (bot.bc[i] & 31), cyp = 16 * (bot.bc[i] >> 5) - 16;
    bot.bOff[i] = d === 3 ? x - cxp : d === 2 ? cxp - x : d === 1 ? y - cyp : cyp - y;
    if (bot.nb >= 60) return;
  }
}

// belt direction at a cell (stage 8), or -1
function beltDir(c) {
  const v = cellCode(c), rev = (g16(0x5CBE) & 2) !== 0;
  switch (v) {
    case 0x17: return rev ? 2 : 3;
    case 0x18: return rev ? 3 : 2;
    case 0x19: return rev ? 1 : 0;
    case 0x1A: return rev ? 0 : 1;
    case 0x1D: return rev ? 1 : 3;
    case 0x1B: return rev ? 2 : 1;
    case 0x1C: return rev ? 0 : 2;
    case 0x1E: return rev ? 3 : 0;
    default: return -1;
  }
}

// rays of bomb i from cell c0: marks lethal intervals; chains other bombs (lowers their
// window); ring: returns 1 if a ray reaches the stage-4 fuse ring
function rays(bot, W, D, i, c0, lo, hi, chain) {
  let ring = W.ring[c0];
  if (D) dAdd(D, c0, lo + 1, hi + 30);
  const R = bot.bR[i], pierce = bot.bPierce[i];
  for (let d = 0; d < 4; d++) {
    let c = c0;
    for (let k = 1; k <= R; k++) {
      c += DC[d];
      if ((c >> 5) < 2 || (c >> 5) > W.rows + 1) break;
      const rk = rayKind(c, pierce);
      if (rk === 2) break;
      if (rk === 1) {                    // a bomb: set off
        if (chain) { const j = bot.bombAt[c]; if (j >= 0 && j !== i) { if (lo + 2 < bot.cLo[j]) { bot.cLo[j] = lo + 2; chain.changed = true; } if (hi + 8 < bot.cHi[j]) { bot.cHi[j] = hi + 8; chain.changed = true; } } }
        break;
      }
      if (rk === 4) {
        // a soft block: it stops the ray unless it is already burning, or doomed by an
        // earlier blast and gone (37 ticks after the hit) before this one goes off
        const burning = W.burnT[c] === W.tick;
        const gone = burning || (bot.doomed[c] === bot.stamp && bot.doomT[c] + 36 <= hi);
        if (!gone) {
          if (D) { if (bot.doomed[c] !== bot.stamp || lo < bot.doomT[c]) { bot.doomed[c] = bot.stamp; bot.doomT[c] = lo; } }
          break;
        }
        if (!D) continue;
        dAdd(D, c, lo + 1, hi + 30);
        continue;
      }
      if (!D) { if (rk === 5) break; continue; }
      if (rk === 3) { dAdd(D, c, lo + 1, hi + 44); continue; }   // pierce through soft / item
      if (rk === 5) { dAdd(D, c, lo + 1, hi + 44); break; }       // item burns (kills) longer
      dAdd(D, c, lo + 1, hi + 30);
      if (W.ring[c]) ring = 1;
    }
  }
  return ring;
}

function buildDanger(bot, W, D, now, hc, hR, fc, fR) {
  stats.builds++;
  dClear(D, W.rows);
  bot.stamp++;
  const n0 = bot.nb;
  let n = n0;
  if (hc >= 0) {                          // hypothetical bomb of ours at hc, placed now
    bot.bc[n] = hc; bot.bR[n] = hR; bot.bPierce[n] = 0; bot.bOwn[n] = 1; bot.bMove[n] = -1;
    bot.bLo[n] = bot.hLo >= 0 ? bot.hLo : now + 141; bot.bHi[n] = bot.hHi >= 0 ? bot.hHi : now + 152; n++;
  }
  if (fc >= 0 && fc !== hc && cellCode(fc) !== 0x43) {   // ... and a foe's, placed now too
    bot.bc[n] = fc; bot.bR[n] = fR; bot.bPierce[n] = 0; bot.bOwn[n] = 0; bot.bMove[n] = -1;
    bot.bLo[n] = now + 141; bot.bHi[n] = now + 152; n++;
  }
  // chain relaxation (static bombs only) on working copies of the windows
  for (let i = 0; i < n; i++) { bot.cLo[i] = bot.bLo[i]; bot.cHi[i] = bot.bHi[i]; if (bot.bMove[i] < 0) bot.bombAt[bot.bc[i]] = i; }
  const chain = CHAIN;
  chain.changed = true;
  for (let it = 0; it < 8 && chain.changed; it++) {
    chain.changed = false;
    for (let i = 0; i < n; i++) if (bot.bMove[i] < 0) rays(bot, W, null, i, bot.bc[i], bot.cLo[i], bot.cHi[i], chain);
  }
  let ringLo = INF, ringHi = -1;
  // rays in detonation order (a block doomed by an earlier blast may be gone)
  for (let i = 0; i < n; i++) {
    let j = i;
    while (j > 0 && bot.cLo[bot.order[j - 1]] > bot.cLo[i]) { bot.order[j] = bot.order[j - 1]; j--; }
    bot.order[j] = i;
  }
  for (let oi = 0; oi < n; oi++) {
    const i = bot.order[oi];
    const lo = bot.cLo[i], hi = bot.cHi[i];
    if (bot.bMove[i] < 0) {
      if (rays(bot, W, D, i, bot.bc[i], lo, hi, null)) { if (lo < ringLo) ringLo = lo; if (hi > ringHi) ringHi = hi; }
    } else {
      // moving: follow its way (the belt's turns; it stops before an obstacle; fire on
      // the way sets it off) and mark the rays from where it can be between lo and hi
      let c = bot.bc[i], d = bot.bMove[i];
      let pos = -bot.bOff[i];                       // px travelled to reach c's centre
      const sp = bot.bSp[i];
      let lo2 = lo, hi2 = hi;
      for (let k = 0; k < 24; k++) {
        const tc = now + pos / sp;                  // when its centre is at c
        if (tc > hi2 + 16 / sp) break;
        if (tc >= lo2 - 16 / sp) {
          if (rays(bot, W, D, i, c, Math.max(lo2, Math.floor(tc - 16 / sp)), hi2, null)) { if (lo2 < ringLo) ringLo = lo2; if (hi2 > ringHi) ringHi = hi2; }
        }
        const bd = W.stageId === 9 ? beltDir(c) : -1;
        if (bd >= 0) d = bd;
        const nc = c + DC[d];
        const v = cellCode(nc);
        if ((v & 0x80) || v === 0x43 || v === 0x44) {   // stops here (a kicked bomb snaps to c)
          if (tc < lo2) rays(bot, W, D, i, c, lo2, hi2, null);
          break;
        }
        if (v === 0x01 || v === 0x41) { const t2 = Math.ceil(tc + 8 / sp); if (t2 < hi2) { lo2 = Math.min(lo2, t2 - 2); hi2 = t2 + 4; } }
        c = nc; pos += 16;
      }
    }
  }
  for (let i = 0; i < n; i++) if (bot.bMove[i] < 0) bot.bombAt[bot.bc[i]] = -1;
  if (ringHi >= 0) for (let k = 0; k < W.ringN2; k++) dAdd(D, W.ringList[k], ringLo + 1, ringHi + 36);
  // fire on the screen now
  for (let cy = 3; cy <= W.rows; cy++) for (let cx = 1; cx <= 15; cx++) {
    const c = cy * 32 + cx, v = cellCode(c);
    if (v === 0x01) dAdd(D, c, now, Math.max(W.fireSeen[c] + 28, now + 2));
    else if (v === 0x41) dAdd(D, c, now, Math.max(W.fireSeen[c] + 44, now + 2));
  }
  // sudden death: the next blocks of the (known, visible) spiral
  suddenDeath(W, D, now);
  return n0;
}
const CHAIN = { changed: false };

// the world map (bot.A) plus hypothetical bombs placed now: ours at hc (reach hR) and / or a
// foe's at fc (reach fR), each with the chain reactions it causes. Into bot.B.
function hypo(bot, W, now, hc, hR, fc, fR) {
  const A = bot.A, B = bot.B;
  B.s0.set(A.s0); B.e0.set(A.e0); B.s1.set(A.s1); B.e1.set(A.e1);
  if (hc >= 0) {
    let lo = bot.hLo >= 0 ? bot.hLo : now + 141, hi = bot.hHi >= 0 ? bot.hHi : now + 152;
    // a blast already due here sets it off early (fire reaches it: + 2 .. 8 ticks)
    const s0 = A.s0[hc];
    if (s0 !== INF && s0 + 1 < lo) { lo = s0 + 1; hi = Math.min(hi, s0 + 7); }
    addBomb(bot, W, B, hc, hR, 0, lo, hi, 0);
  }
  if (fc >= 0 && fc !== hc && cellCode(fc) !== 0x43) {
    let lo = now + 141, hi = now + 152;
    const s0 = A.s0[fc];
    if (s0 !== INF && s0 + 1 < lo) { lo = s0 + 1; hi = Math.min(hi, s0 + 7); }
    addBomb(bot, W, B, fc, fR, 0, lo, hi, 0);
  }
}
function addBomb(bot, W, D, c0, R, pierce, lo, hi, depth) {
  dAdd(D, c0, lo + 1, hi + 30);
  let ring = W.ring[c0];
  for (let d = 0; d < 4; d++) {
    let c = c0;
    for (let k = 1; k <= R; k++) {
      c += DC[d];
      if ((c >> 5) < 2 || (c >> 5) > W.rows + 1) break;
      const rk = rayKind(c, pierce);
      if (rk === 2) break;
      if (rk === 1) {
        const j = bot.atMap[c];
        if (j >= 0 && depth < 6 && lo + 2 < bot.aLo[j]) addBomb(bot, W, D, bot.bc[j], bot.bR[j], bot.bPierce[j], lo + 2, Math.min(hi + 8, bot.aHi[j]), depth + 1);
        break;
      }
      if (rk === 4) {
        const gone = W.burnT[c] === W.tick || (bot.doomBase[c] === bot.baseStamp && bot.doomTA[c] + 36 <= hi);
        if (!gone) break;
        dAdd(D, c, lo + 1, hi + 30);
        continue;
      }
      if (rk === 3) { dAdd(D, c, lo + 1, hi + 44); continue; }
      if (rk === 5) { dAdd(D, c, lo + 1, hi + 44); break; }
      dAdd(D, c, lo + 1, hi + 30);
      if (W.ring[c]) ring = 1;
    }
  }
  if (ring) for (let k = 0; k < W.ringN2; k++) dAdd(D, W.ringList[k], lo + 1, hi + 36);
}

function suddenDeath(W, D, now) {
  if (g16(0x5C54) === 4) return;
  const f = g16(0x5D0E);
  let t0;
  if (f & 1) { if (f & 2) return; t0 = now + (g16(0x5D0E) & 4 ? 15 : Math.max(1, g16(0x5D10))); }
  else {
    // before it starts: the clock (65 ticks a second) to 0:33 (tall 0:47)
    const sdSec = W.tall && (m[0x7000] & 3) !== 3 ? 47 : 33;
    const secs = g16(0x5E04) * 60 + g16(0x5E06) * 10 + g16(0x5E08);
    const left = (secs - sdSec) * 65;
    if (left > 900 || left < -65) return;
    t0 = now + Math.max(0, left);
  }
  const per = W.tall && (m[0x7000] & 3) === 3 ? 9 : 15;
  const order = sdOrderNow();
  let k = (f & 1) ? g16(0x5D12) : 0, j = 0;
  if ((f & 1) && (f & 4)) { const gi = g16(0x5D16); const c = giToCell(gi); dAdd(D, c, now, INF - 1); }
  for (; j < 48; k++) {
    const v = order[k];
    if (v === undefined || v === 0xFF || v === 0xFE) break;
    const gi = g16(0x10B10 + v * 2);
    const c = giToCell(gi);
    dAdd(D, c, t0 + per * j - 4, INF - 1);
    j++;
  }
}

// ======================================================================================
// time-dependent earliest-arrival search
// ======================================================================================
// From cell c0 at tick t0 at `speed` px/tick (ox / oy: the bomber's offset from c0's
// centre). Results: S.arr[c] (tick the centre reaches c), S.first[c] (first direction),
// S.dep[c] (tick it leaves c0), S.list = reached cells.
export const stats = { searches: 0, builds: 0 };
// stopAt > 0: stop once that many never-lethal cells (refuges) have been reached
function search(bot, W, D, S, c0, t0, speed, ox, oy, maxT, isFoe, stopAt = 0) {
  stats.searches++;
  W.budget--;
  S.cur++;
  const st = S.cur;
  S.hn = 0; S.n = 0;
  const step = 16 / Math.max(0.25, speed);
  S.arr[c0] = t0; S.stamp[c0] = st; S.first[c0] = -1; S.dep[c0] = t0;
  hpush(S, c0, t0);
  const bl = bot.blocked;
  while (S.hn) {
    const u = S.hc[0], tu = S.ht[0];
    hpop(S);
    if (S.stamp[u] !== st || tu > S.arr[u]) continue;
    S.list[S.n++] = u;
    if (stopAt && dFree(D, u, tu) && !W.belt[u] && --stopAt === 0) { S.hn = 0; return; }
    if (tu > maxT) continue;
    for (let d = 0; d < 4; d++) {
      let v = u + DC[d];
      const vy = v >> 5;
      if (vy < 3 || vy > W.rows) continue;
      if (!W.walk[v] || bl[v]) continue;
      if (!isFoe && W.skull[v] && bot.mode !== 2) continue;
      let land = v;
      // stage 6: a pad moves you to its partner, unless a bomb is there or fire burns on
      // the pad (the flame tile replaces the pad colour): then you stay on the pad
      if (W.tele[v] >= 0 && cellCode(W.tele[v]) !== 0x43) land = W.tele[v];
      // first step from an off-centre start: shorter / longer
      let s = step, half = step / 2;
      if (u === c0) {
        const off = d === 0 ? -oy : d === 1 ? oy : d === 2 ? -ox : ox;
        s = Math.max(1, (16 - off) / Math.max(0.25, speed)); half = Math.max(0.5, (8 - off) / Math.max(0.25, speed));
      }
      // earliest departure: v must be clear while the centre is in it
      let td = tu, ok = false;
      const noWait = W.stageId === 9 && W.belt[u] === 1;
      for (let r = 0; r < 4; r++) {
        const e = dHit(D, land, Math.floor(td + half), Math.ceil(td + s + half));
        if (e < 0) { ok = true; break; }
        td = e - half + 1;
        if (td - tu > MAXWAIT || noWait) break;
      }
      if (!ok) continue;
      if (land !== v && dHit(D, v, Math.floor(td + half) - 2, Math.ceil(td + half) + 2) >= 0) continue;   // the pad itself
      // ... and u while waiting there and until the centre has left it
      if (dHit(D, u, tu, Math.ceil(td + half)) >= 0) continue;
      const tv = Math.ceil(td + s);
      if (S.stamp[land] === st && S.arr[land] <= tv) continue;
      S.stamp[land] = st; S.arr[land] = tv;
      S.first[land] = u === c0 ? d : S.first[u];
      S.dep[land] = u === c0 ? Math.floor(td) : S.dep[u];
      hpush(S, land, tv);
    }
  }
}
function hpush(S, c, t) {
  if (S.hn >= 4096) return;
  let i = S.hn++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (S.ht[p] <= t) break;
    S.hc[i] = S.hc[p]; S.ht[i] = S.ht[p]; i = p;
  }
  S.hc[i] = c; S.ht[i] = t;
}
function hpop(S) {
  const n = --S.hn;
  if (n <= 0) return;
  const c = S.hc[n], t = S.ht[n];
  let i = 0;
  for (;;) {
    let l = 2 * i + 1;
    if (l >= n) break;
    if (l + 1 < n && S.ht[l + 1] < S.ht[l]) l++;
    if (S.ht[l] >= t) break;
    S.hc[i] = S.hc[l]; S.ht[i] = S.ht[l]; i = l;
  }
  S.hc[i] = c; S.ht[i] = t;
}

// open neighbours (walkable) of a cell
function exits(c, W) { let n = 0; for (let d = 0; d < 4; d++) if (W.walk[c + DC[d]]) n++; return n; }

// best never-lethal cell reached in a search: earliest, few dead ends, away from foes
function bestRefuge(bot, W, D, S, foeX, foeY, nFoe) {
  let best = -1, bs = INF;
  for (let i = 0; i < S.n; i++) {
    const c = S.list[i], t = S.arr[c];
    if (!dFree(D, c, t) || !stayable(W, c)) continue;
    let sc = t;
    const ex = exits(c, W);
    if (ex <= 1) sc += 14;
    for (let f = 0; f < nFoe; f++) { const dd = Math.abs((c & 31) - foeX[f]) + Math.abs((c >> 5) - foeY[f]); if (dd <= 2) sc += 12 - 4 * dd; }
    if (sc < bs) { bs = sc; best = c; }
  }
  return best;
}
function countRefuges(D, S, cap, W) {
  let n = 0;
  for (let i = 0; i < S.n; i++) { const c = S.list[i]; if (dFree(D, c, S.arr[c]) && (!W || stayable(W, c))) { if (++n >= cap) break; } }
  return n;
}

// ======================================================================================
// decisions
// ======================================================================================
const foeX = new Int32Array(4), foeY = new Int32Array(4), foeS = new Int32Array(4), foeSp = new Float64Array(4);
let nFoe = 0;

function perceiveFoes(bot, W, now) {
  nFoe = 0;
  const k = (now - bot.react) & 31;
  for (let i = 0; i < 4; i++) {
    if (i === bot.slot) continue;
    const p = 0x8000 + 0x100 * i, f = g16(p);
    if (!(f & 0x8000) || (f & 0x0800) || (g16(p + 0x60) & 0x0800)) continue;
    const x = W.posX[i * 32 + k], y = W.posY[i * 32 + k];
    foeX[nFoe] = (x + 8) >> 4; foeY[nFoe] = (y + 23) >> 4; foeS[nFoe] = i;
    foeSp[nFoe] = SPEED[m[p + 0xF0]] || 1.25;
    nFoe++;
  }
}

function itemValue(bot, c) {
  const p = bot.p, k = cellTile(c) & 0xFF;
  switch (k) {
    case IT_BOMB: return m[p + 0xE1] < 4 ? 60 : m[p + 0xE1] < 7 ? 35 : 10;
    case IT_FIRE: return m[p + 0xF2] < 3 ? 55 : m[p + 0xF2] < 6 ? 30 : 8;
    case IT_FULL: return m[p + 0xF2] < 6 ? 60 : 10;
    case IT_SPEED: return m[p + 0xE0] < 3 ? 70 : m[p + 0xE0] < 5 ? 35 : 0;
    case IT_KICK: return m[p + 0xFF] ? 5 : 45;
    case IT_GLOVE: return m[p + 0xFE] ? 5 : 30;
    case IT_POWER: return 25;
    case IT_RUBBER: return 4;
    case IT_SKULL: return -200;
    default: return 15;
  }
}

// soft blocks a bomb at c (reach R) would hit that no known blast already dooms
function softHits(bot, W, c, R) {
  let n = 0;
  for (let d = 0; d < 4; d++) {
    let x = c;
    for (let k = 1; k <= R; k++) {
      x += DC[d];
      const v = cellCode(x);
      if (v === 0xC2) { if (bot.doomed[x] !== bot.stamp) n++; break; }
      if ((v & 0x80) || v === 0x43 || v === 0x44) break;
    }
  }
  return n;
}
// a foe in a clear line within reach R of c?
function inLine(W, c, R, fc) {
  if ((c & 31) !== (fc & 31) && (c >> 5) !== (fc >> 5)) return false;
  if (c === fc) return true;
  const d = (c & 31) === (fc & 31) ? ((fc >> 5) > (c >> 5) ? 1 : 0) : ((fc & 31) > (c & 31) ? 3 : 2);
  let x = c;
  for (let k = 1; k <= R; k++) {
    x += DC[d];
    if (x === fc) return true;
    const v = cellCode(x);
    if ((v & 0x80) || v === 0x43 || v === 0x44) return false;
  }
  return false;
}

// the bomb this bomber would place now: its reach (+1) at cell c
function myReach(bot, W, c) {
  const p = bot.p;
  if (W.stageId === 6 && cellUnder(c) === 0x14) return 10;          // stage 5 power tiles
  if ((m[p + 0xF3] & 0x0F) === 2 && m[p + 0xF8] === 0) return 10;   // power bomb, none out
  return m[p + 0xF2] + 1;
}

// evaluate placing a bomb at the bomber's cell now. Returns a value (<= 0: don't), with
// a guaranteed escape (else -1).
function evalBomb(bot, W, now, c, ox, oy, speed, attackOnly) {
  if (W.budget < 4 + 3 * nFoe) return -2;          // no time left this tick: next tick
  MARG = 4;
  const v = evalBomb2(bot, W, now, c, ox, oy, speed, attackOnly);
  MARG = 2;
  return v;
}
function evalBomb2(bot, W, now, c, ox, oy, speed, attackOnly) {
  const R = myReach(bot, W, c);
  const S = bot.S;
  // a foe close by may answer with a bomb of his own right away (where he stands now):
  // our escape must work in that case too (one ply of look-ahead per close foe)
  // (he is seen ~8 ticks late: his cell and the cells next to it)
  for (let f = 0; f < nFoe; f++) {
    const dd = Math.abs((c & 31) - foeX[f]) + Math.abs((c >> 5) - foeY[f]);
    if (dd > 5 || !foeHasBomb(foeS[f])) continue;
    const f0 = foeY[f] * 32 + foeX[f], fR = m[0x8000 + 0x100 * foeS[f] + 0xF2] + 1;
    for (let k = -1; k < 4; k++) {
      const fc = k < 0 ? f0 : f0 + DC[k];
      if (fc === c || (k >= 0 && !walkable(fc, W))) continue;
      if (k >= 0 && (dd > 3 || Math.abs((c & 31) - (fc & 31)) + Math.abs((c >> 5) - (fc >> 5)) > 4)) continue;
      hypo(bot, W, now, c, R, fc, fR);
      bot.blocked[fc] = 1;
      search(bot, W, bot.B, S, c, now + 1, speed, ox, oy, now + 200, false, 1);
      bot.blocked[fc] = 0;
      if (countRefuges(bot.B, S, 1, W) === 0) return -1;
    }
  }
  hypo(bot, W, now, c, R, -1, 0);
  // own escape: start next tick, from the bomb cell (we may walk off our own bomb)
  search(bot, W, bot.B, S, c, now + 1, speed, ox, oy, now + 200, false);
  // ... to a refuge we reach well before any foe close by can (he could stand there, or
  // drop a bomb on the way: corridors)
  const fs = ++bot.foeStamp;
  for (let f = 0; f < nFoe; f++) {
    if (Math.abs((c & 31) - foeX[f]) + Math.abs((c >> 5) - foeY[f]) > 6) continue;
    const O = bot.O;
    search(bot, W, bot.B, O, foeY[f] * 32 + foeX[f], now + 2, foeSp[f], 0, 0, now + 110, true);
    for (let i = 0; i < O.n; i++) { const q = O.list[i]; if (bot.foeMinS[q] !== fs || O.arr[q] < bot.foeMin[q]) { bot.foeMinS[q] = fs; bot.foeMin[q] = O.arr[q]; } }
  }
  let ref = 0;
  for (let i = 0; i < S.n && ref < 3; i++) {
    const q = S.list[i];
    if (!dFree(bot.B, q, S.arr[q]) || W.belt[q]) continue;
    if (bot.foeMinS[q] === fs && bot.foeMin[q] < S.arr[q] + 10) continue;
    ref++;
  }
  if (debug.on) bot.lastRef = ref + '/' + S.n;
  if (ref === 0) return -1;
  let val = 0;
  if (!attackOnly) {
    const hits = softHitsBase(bot, W, c, R);
    val += hits ? 30 + 12 * Math.min(hits, 3) : 0;
  }
  // attack: how many safe cells does each foe keep (our bomb cell blocks them)?
  bot.blocked[c] = 1;
  for (let f = 0; f < nFoe; f++) {
    const fc = foeY[f] * 32 + foeX[f];
    const dd = Math.abs((c & 31) - foeX[f]) + Math.abs((c >> 5) - foeY[f]);
    if (dd > R + 4) continue;
    // pressure: a foe in the blast must move (and may run into a corner)
    if (inLine(W, c, R, fc)) val += 45;
    const O = bot.O;
    search(bot, W, bot.B, O, fc, now + 2, foeSp[f], 0, 0, now + 180, true, 12);
    const after = countRefuges(bot.B, O, 12);
    if (after >= 12) continue;
    search(bot, W, bot.A, O, fc, now + 2, foeSp[f], 0, 0, now + 180, true, 12);
    const before = countRefuges(bot.A, O, 12);
    if (after === 0 && before > 0) val += 600;
    else if (after < before) val += 160 * (before - after) / before + (after <= 2 ? 80 : 0);
  }
  bot.blocked[c] = 0;
  return val;
}
// soft blocks hit, not doomed in the base map (bot.baseStamp)
function softHitsBase(bot, W, c, R) {
  let n = 0;
  for (let d = 0; d < 4; d++) {
    let x = c;
    for (let k = 1; k <= R; k++) {
      x += DC[d];
      const v = cellCode(x);
      if (v === 0xC2) { if (bot.doomBase[x] !== bot.baseStamp) n++; break; }
      if ((v & 0x80) || v === 0x43 || v === 0x44) break;
    }
  }
  return n;
}

// ======================================================================================
// the pad of one ★ bomber for the coming tick
// ======================================================================================
function decide(bot, W) {
  const p = bot.p, now = W.tick;
  const f = g16(p);
  if (!(f & 0x8000) || (f & 0x0800) || (f & 0x2000)) { bot.aHeld = false; return 0; }
  if ((m[0x30] & 0x0F) !== 0x0F) { bot.aHeld = false; return 0; }
  const s52 = g16(p + 0x52);
  const x = g16(p + 0x10), y = g16(p + 0x18);
  const cx = (x + 8) >> 4, cy = (y + 23) >> 4, c = cy * 32 + cx;
  const ox = x - 16 * cx, oy = y - (16 * cy - 16);
  // velocity (px/tick, with the 16.16 fractions: ice slides)
  const fx = x + g16(p + 0x12) / 65536, fy = y + g16(p + 0x1A) / 65536;
  bot.vx = fx - bot.prevX; bot.vy = fy - bot.prevY;
  if (Math.abs(bot.vx) > 8) bot.vx = 0;
  if (Math.abs(bot.vy) > 8) bot.vy = 0;
  bot.prevX = fx; bot.prevY = fy;
  if (c !== bot.lastCell) { bot.lastCell = c; bot.cellSince = now; }
  const carrying = (s52 & 0x7F) === 6 || (s52 & 4) !== 0;
  if (s52 & 1) return bot.holdLift ? B_A : 0;          // busy (lift / jump / stun / hole)
  let speed = SPEED[m[p + 0xF0]] || 1.25;
  if (W.stageId === 1) speed = 1.25;                 // ice: level 1, accelerating

  // ---- world + perception ----
  perceiveFoes(bot, W, now);
  bot.blocked.fill(0);
  if (W.stageId === 2) for (let i = 0; i < 4; i++) {   // stage 3: bombers are solid
    if (i === bot.slot) continue;
    const q = 0x8000 + 0x100 * i, fq = g16(q);
    if (!(fq & 0x8000) || (fq & 0x0800)) continue;
    const qc = (((g16(q + 0x18) + 23) >> 4) << 5) | ((g16(q + 0x10) + 8) >> 4);
    if (qc !== c) bot.blocked[qc] = 1;
  }
  gatherBombs(bot, W, now);
  buildDanger(bot, W, bot.A, now, -1, 0, -1, 0);
  bot.baseStamp++;
  for (let i = 0; i < NC; i++) if (bot.doomed[i] === bot.stamp) { bot.doomBase[i] = bot.baseStamp; bot.doomTA[i] = bot.doomT[i]; }
  // the world map's bombs, for the incremental hypothetical bombs (hypo / addBomb)
  for (let i = 0; i < bot.nAt; i++) bot.atMap[bot.atList[i]] = -1;
  bot.nAt = 0;
  for (let i = 0; i < bot.nb; i++) {
    bot.aLo[i] = bot.cLo[i]; bot.aHi[i] = bot.cHi[i];
    if (bot.bMove[i] < 0) { bot.atMap[bot.bc[i]] = i; bot.atList[bot.nAt++] = bot.bc[i]; }
  }

  const S = bot.S;
  search(bot, W, bot.A, S, c, now, speed, ox, oy, now + 260, false);
  // ---- carrying (glove): throw at a foe in line ----
  if (carrying) return carryPad(bot, W, now, c, ox, oy, speed, S);
  bot.holdLift = false;

  // ---- glove: lift the bomb we just placed (A released one tick, then pressed) ----
  if (bot.liftAt >= now - 1 && bot.liftAt <= now + 1 && cellCode(c) === 0x43) {
    if (bot.liftAt > now) { bot.aHeld = false; return 0; }
    bot.liftAt = -100;
    // the lift takes 15 ticks standing here: only with nothing else coming
    if (throwLine(bot, W, c) >= 0 && dNext(bot.A, c, now) > now + 70) { bot.holdLift = true; bot.aHeld = true; bot.lastA = now; bot.liftT = now; return B_A; }
  }

  let target = -1;
  const safeHere = dFree(bot.A, c, now);
  // ---- kick a bomb next to us at a foe (also a way out of its line) ----
  const kp = kickPad(bot, W, now, c, ox, oy, speed);
  if (kp) { bot.aHeld = false; return kp; }
  if (debug.on) bot.dbg = '';
  const goalOk = bot.goal >= 0 && bot.goal !== c && S.stamp[bot.goal] === S.cur && dFree(bot.A, bot.goal, S.arr[bot.goal]);
  if (!safeHere && goalOk) {
    // the cell we stand in turns lethal later: the path to the goal (timed safe by the
    // search) leaves it in time
    target = bot.goal;
    if (debug.on) bot.dbg = 'via';
  } else if (!safeHere) {
    // ---- escape ----
    target = bestRefuge(bot, W, bot.A, S, foeX, foeY, nFoe);
    if (debug.on) bot.dbg = 'esc>' + (target < 0 ? '-' : (target & 31) + ',' + (target >> 5));
    bot.goal = target; bot.goalWait = false; bot.goalUntil = now + 12;
    if (target < 0) {
      // emergency: the same with the relaxed margin
      MARG = -2;
      search(bot, W, bot.A, S, c, now, speed, ox, oy, now + 260, false);
      target = bestRefuge(bot, W, bot.A, S, foeX, foeY, nFoe);
      MARG = 2;
      if (target >= 0 && debug.on) bot.dbg = 'emerg>' + (target & 31) + ',' + (target >> 5);
    }
    if (target < 0) {
      if (W.stageId === 0xB) { const j = jumpOut(bot, W, now, c); if (j) { bot.aHeld = false; return j; } }
      // nothing never-lethal: the cell that turns lethal the latest
      let bt = -1;
      for (let i = 0; i < S.n; i++) { const q = S.list[i]; const t = dNext(bot.A, q, S.arr[q]); if (t > bt) { bt = t; target = q; } }
    }
  } else {
    // ---- bomb here? ----
    const hand = m[p + 0xF1];
    const v = cellCode(c);
    const atGoal = bot.goal === c;
    // arrived: centre in the cell first (a bomb goes in the centre cell; ice slides)
    if (atGoal && W.stageId === 1) {
      const st = iceStop(bot, W, c, ox, oy);
      if (st) { bot.aHeld = false; return st; }
    } else if (atGoal && (Math.abs(ox) > 3 || Math.abs(oy) > 3) && now - bot.cellSince < 24) {
      bot.aHeld = false;
      return Math.abs(ox) >= Math.abs(oy) ? (ox > 0 ? B_LEFT : B_RIGHT) : (oy > 0 ? B_UP : B_DOWN);
    }
    if (hand > 0 && v !== 0x43 && v !== 0x44 && (cellUnder(c) & 0x3F) !== 0x11 && !isBelt(W, c) && !bot.aHeld && now - bot.lastA > 3
      && Math.abs(ox) <= 6 && Math.abs(oy) <= 6 && (atGoal || foeNear(c, m[p + 0xF2] + 4))
      && (!bot.goalWait || (now + bot.slot) % 3 === 0)) {
      const val = evalBomb(bot, W, now, c, ox, oy, speed, !atGoal);
      if (debug.on) bot.dbg = 'val' + val.toFixed(0) + ' ref' + bot.lastRef;
      const need = atGoal ? 20 : 120;
      if (val >= need) {
        if (val < 300 && bot.hesitate > 0) bot.hesitate--;
        else if (val < 300 && rnd(bot.rs) < 0.05) bot.hesitate = 1 + Math.floor(rnd(bot.rs) * 3);
        else {
          bot.aHeld = true; bot.lastA = now; bot.goal = -1;
          // glove: lift it right away and throw it at a foe in line (if nothing else
          // threatens this cell meanwhile)
          if (m[p + 0xFE] && val < 600 && throwLine(bot, W, c) >= 0 && dNext(bot.A, c, now) > now + 80) bot.liftAt = now + 2;
          return B_A;
        }
      }
      // evalBomb overwrote the search buffer: search again
      search(bot, W, bot.A, S, c, now, speed, ox, oy, now + 260, false);
    }
    // ---- goal ----
    if (bot.goal < 0 || now >= bot.goalUntil || S.stamp[bot.goal] !== S.cur || !dFree(bot.A, bot.goal, S.arr[bot.goal]) || (bot.goal === c && !bot.goalWait)) pickGoal(bot, W, now, c, speed);
    target = bot.goal;
    if (target === c) target = -1;
  }
  bot.aHeld = false;
  let pad = 0;
  if (target >= 0 && S.stamp[target] === S.cur && S.first[target] >= 0) {
    if (S.dep[target] > now + 1) { pad = W.stageId === 1 ? iceStop(bot, W, c, ox, oy) : 0; bot.why = 1; }   // wait here for a blast to pass
    else pad = steer(bot, W, S.first[target], ox, oy, c, target, speed);
  } else if (W.stageId === 1) { pad = iceStop(bot, W, c, ox, oy); bot.why = 5; }
  else if (isBelt(W, c) && !safeHere) {
    // stage 8: standing still on a belt is being carried: hold the cell against it
    const bd = beltDir(c);
    if (bd >= 0) pad = DIRBIT[OPP[bd]];
  }
  else bot.why = target < 0 && !safeHere ? 2 : bot.goalWait ? (m[p + 0xF8] ? 6 : m[p + 0xF1] ? 3 : 4) : 5;
  return pad;
}
// does this bomber have a bomb to place? (visible: its pickups minus its bombs out)
function foeHasBomb(i) { const q = 0x8000 + 0x100 * i; return m[q + 0xF1] > 0 && m[q + 0xF5] !== 3; }
function foeNear(c, r) {
  for (let f = 0; f < nFoe; f++) if (Math.abs((c & 31) - foeX[f]) + Math.abs((c >> 5) - foeY[f]) <= r) return true;
  return false;
}

// steering toward the first step (direction d)
function steer(bot, W, d, ox, oy, c, target, speed) {
  if (W.stageId !== 1) return DIRBIT[d];
  // ice (measured in the core): the held axis gains 0.25 px/tick per tick up to 2.0, no
  // friction; the opposite input takes 0.25 off per tick (2.0 -> 0 in 8 ticks, 8 px); a
  // perpendicular input cancels the other axis (but next to a pillar its corner slide
  // keeps going). So: run straight on, and brake (opposite) in time to stop at a cell's
  // centre before a turn or the goal.
  const nc = c + DC[d];
  const straight = target !== nc && lineTo(c, target, d) && pathStraight(bot, c, target, d);
  if (straight) return DIRBIT[d];
  const offAlong = d === 0 ? -oy : d === 1 ? oy : d === 2 ? -ox : ox;
  const v = d >= 2 ? bot.vx * (d === 3 ? 1 : -1) : bot.vy * (d === 1 ? 1 : -1);
  return iceAxis(v, 16 - offAlong, d);
}
// 1-D: reach the point dist px ahead along d and stop there (v = speed along d)
function iceAxis(v, dist, d) {
  if (Math.abs(dist) < 1.5 && Math.abs(v) < 0.3) return v > 0.01 ? DIRBIT[OPP[d]] : v < -0.01 ? DIRBIT[d] : 0;
  if (dist > 0) {
    if (v > 0 && dist <= 2 * v * v + v * 0.5) return DIRBIT[OPP[d]];   // brake
    return v < 2 ? DIRBIT[d] : 0;
  }
  if (v < 0 && -dist <= 2 * v * v - v * 0.5) return DIRBIT[d];
  return v > -2 ? DIRBIT[OPP[d]] : 0;
}
// the path to target goes straight along d all the way?
function pathStraight(bot, c, target, d) {
  let q = c;
  for (let k = 0; k < 30; k++) { q += DC[d]; if (q === target) return true; if (!(bot.S.stamp[q] === bot.S.cur)) return false; }
  return false;
}
// ice: come to a stop at this cell's centre (no input does NOT stop on ice)
function iceStop(bot, W, c, ox, oy) {
  if (Math.abs(bot.vx) >= Math.abs(bot.vy)) {
    if (Math.abs(bot.vx) < 0.05 && Math.abs(ox) < 2) return 0;
    return iceAxis(bot.vx, -ox, 3);
  }
  if (Math.abs(bot.vy) < 0.05 && Math.abs(oy) < 2) return 0;
  return iceAxis(bot.vy, -oy, 1);
}
function lineTo(c, t, d) {
  if (d >= 2) return (c >> 5) === (t >> 5) && (d === 3 ? (t & 31) > (c & 31) : (t & 31) < (c & 31));
  return (c & 31) === (t & 31) && (d === 1 ? (t >> 5) > (c >> 5) : (t >> 5) < (c >> 5));
}

function pickGoal(bot, W, now, c, speed) {
  const p = bot.p, S = bot.S;
  const hand = m[p + 0xF1];
  const R = m[p + 0xF2] + 1;
  let best = -1, bs = -INF, second = -1, ss = -INF, here = -INF;
  // nearest foe distance field (Manhattan) for the hunt
  for (let i = 0; i < S.n; i++) {
    const q = S.list[i], t = S.arr[q];
    if (!dFree(bot.A, q, t)) continue;
    const v = cellCode(q);
    if (!stayable(W, q) && v !== 0x44) continue;
    let sc = -0.15 * (t - now);
    if (v === 0x44) sc += itemValue(bot, q);
    if (hand > 0 || m[p + 0xF8] > 0) {
      const hits = softHitsBase(bot, W, q, W.stageId === 6 && cellUnder(q) === 0x14 ? 10 : R);
      if (hits) sc += (hand > 0 ? 34 : 12) + 10 * Math.min(hits, 3);
    }
    let dmin = 99;
    for (let f = 0; f < nFoe; f++) {
      const fc = foeY[f] * 32 + foeX[f];
      const dd = Math.abs((q & 31) - foeX[f]) + Math.abs((q >> 5) - foeY[f]);
      if (dd < dmin) dmin = dd;
      if (hand > 0 && inLine(W, q, R, fc)) sc += 45 + (exits(fc, W) <= 2 ? 25 : 0);
    }
    if (nFoe) sc -= 3.5 * Math.min(Math.max(0, dmin - 2), 24);
    if (dmin <= 1) sc -= 10;                         // not into a foe's arms
    if (exits(q, W) <= 1) sc -= 6;
    // stage 7: fast pads when slow
    if (W.stageId === 8 && v === 0x0F && m[p + 0xE0] < 4) { const tl = cellTile(q); if (tl === 0x1C2E || tl === 0x1C48) sc += 40; }
    if (q === c) here = sc;
    else if (q === bot.goal) sc += 4;                // keep the current goal (no dithering)
    if (sc > bs) { second = best; ss = bs; bs = sc; best = q; } else if (sc > ss) { ss = sc; second = q; }
  }
  // nothing clearly better than where we stand: wait here (a blast to clear, a bomb to
  // come back to the hand)
  if (here > -INF && bs < here + 6) { bot.goal = c; bot.goalWait = true; bot.goalScore = here; bot.goalUntil = now + 6; return; }
  bot.goalWait = false;
  // small mistakes: now and then the second best
  if (second >= 0 && ss > bs - 25 && rnd(bot.rs) < 0.1) best = second;
  bot.goal = best; bot.goalScore = bs;
  bot.goalUntil = now + 10 + Math.floor(rnd(bot.rs) * 6);
}

// ---- kick (with the kick item): a bomb next to us, a foe in the lines where it stops ------
function kickPad(bot, W, now, c, ox, oy, speed) {
  const p = bot.p;
  if (!m[p + 0xFF] || nFoe === 0) return 0;
  if (Math.abs(ox) > 5 || Math.abs(oy) > 5) return 0;
  for (let d = 0; d < 4; d++) {
    const bc = c + DC[d];
    if (cellCode(bc) !== 0x43) continue;
    let k = -1;
    for (let j = 0; j < bot.nb; j++) if (bot.bc[j] === bc && bot.bMove[j] < 0) { k = j; break; }
    if (k < 0) continue;
    const tl = bot.cLo[k] - now;
    if (tl < 20 || tl > 150) continue;
    // where it stops: before the first obstacle / bomber (2 px a tick: 8 ticks a cell)
    let x = bc, n = 0, hit = false;
    for (;;) {
      const nx = x + DC[d];
      const v = cellCode(nx);
      if ((v & 0x80) || v === 0x43 || v === 0x44 || (v & 0x40)) break;
      let bomber = false;
      for (let f = 0; f < nFoe; f++) if (foeY[f] * 32 + foeX[f] === nx) bomber = true;
      if (bomber) { hit = true; break; }
      x = nx; n++;
      if (n * 8 > tl - 8) break;
    }
    if (n === 0) continue;
    let good = hit;
    if (!good) for (let f = 0; f < nFoe; f++) if (inLine(W, x, bot.bR[k], foeY[f] * 32 + foeX[f])) good = true;
    if (!good) continue;
    // simulate the bomb at its stop cell: we need a refuge
    if (W.budget < 2) return 0;
    const save = bot.bc[k];
    bot.bc[k] = x;
    buildDanger(bot, W, bot.B, now, -1, 0, -1, 0);
    bot.bc[k] = save;
    search(bot, W, bot.B, bot.O, c, now + 4, speed, 0, 0, now + 200, false, 1);
    if (countRefuges(bot.B, bot.O, 2, W) < 1) continue;
    bot.goal = -1;
    return DIRBIT[d];
  }
  return 0;
}

// ---- glove ---------------------------------------------------------------------------------
// direction to throw from c: a foe 2..5 cells away in line (the throw lands on him)
function throwLine(bot, W, c) {
  for (let f = 0; f < nFoe; f++) {
    const dx = foeX[f] - (c & 31), dy = foeY[f] - (c >> 5);
    if (dx === 0 && Math.abs(dy) >= 2 && Math.abs(dy) <= 5) return dy > 0 ? 1 : 0;
    if (dy === 0 && Math.abs(dx) >= 2 && Math.abs(dx) <= 5) return dx > 0 ? 3 : 2;
  }
  return -1;
}
// where a bomb thrown from c in direction d lands (C02DCF: 3 cells, or on a bomber 2..5
// cells ahead; an occupied cell makes it hop on), -1 if it would leave the field (wrap)
function throwLanding(bot, W, c, d) {
  let n = 3;
  for (let k = 2; k <= 5; k++) {
    const q = c + DC[d] * k;
    for (let i = 0; i < 4; i++) {
      const o = 0x8000 + 0x100 * i, fo = g16(o);
      if (i === bot.slot || !(fo & 0x8000) || (fo & 0x0800)) continue;
      if (((((g16(o + 0x18) + 23) >> 4) << 5) | ((g16(o + 0x10) + 8) >> 4)) === q) { n = k; k = 9; break; }
    }
  }
  let q = c + DC[d] * n;
  for (let hop = 0; hop < 8; hop++) {
    const qy = q >> 5, qx = q & 31;
    if (qy < 4 || qy > W.rows - 1 || qx < 2 || qx > 14) return -1;
    const v = cellCode(q);
    let busy = (v & 0x80) || v === 0x43;
    if (!busy) for (let i = 0; i < 4; i++) {
      const o = 0x8000 + 0x100 * i, fo = g16(o);
      if (i === bot.slot || !(fo & 0x8000) || (fo & 0x0800)) continue;
      if (((((g16(o + 0x18) + 23) >> 4) << 5) | ((g16(o + 0x10) + 8) >> 4)) === q) busy = true;
    }
    if (!busy) return q;
    q += DC[d];
  }
  return -1;
}
// is throwing in direction d safe for us (the landed bomb + everything else)?
function throwSafe(bot, W, now, c, d, speed) {
  const L = throwLanding(bot, W, c, d);
  if (L < 0 || W.budget < 1) return -1;
  const bk = g16(bot.p + 0x40);
  const fuse = bk >= 0x2000 && bk < 0x4800 ? m[0x10000 + bk + 4] : 0x38;
  bot.hLo = now + 2 * Math.max(fuse, 0x38) - 12; bot.hHi = now + 2 * Math.max(fuse, 0x38) + 40;
  // landing in fire (or a blast at landing time) sets it off at once
  const dist = Math.abs((L & 31) - (c & 31)) + Math.abs((L >> 5) - (c >> 5));
  const tl = now + 2 + 4 * dist;
  if (dHit(bot.A, L, now, tl + 8) >= 0) { bot.hLo = tl - 2; bot.hHi = tl + 8; }
  hypo(bot, W, now, L, m[bot.p + 0xF2] + 1, -1, 0);
  bot.hLo = -1; bot.hHi = -1;
  search(bot, W, bot.B, bot.O, c, now + 2, speed, 0, 0, now + 200, false, 1);
  return countRefuges(bot.B, bot.O, 1, W) ? L : -1;
}
const facingDir = (p) => { const f = g16(p + 0x5E); return f === 2 ? 3 : f === 4 ? 2 : f === 8 ? 1 : 0; };
// carrying our bomb: throw it onto a foe in line (stun) when that is safe; meanwhile keep
// out of danger with A held; never carry it for long
function carryPad(bot, W, now, c, ox, oy, speed, S) {
  const fd = facingDir(bot.p);
  bot.holdLift = true;
  const held = now - bot.liftT;
  let d = throwLine(bot, W, c);
  if (d >= 0 && throwSafe(bot, W, now, c, d, speed) < 0) d = -1;
  if (d < 0 && held > 40) {
    // no target: throw where it is safe, preferably towards the nearest foe
    let best = -1, bd = 99;
    for (let k = 0; k < 4; k++) {
      const L = throwSafe(bot, W, now, c, k, speed);
      if (L < 0) continue;
      let dm = 50;
      for (let f = 0; f < nFoe; f++) dm = Math.min(dm, Math.abs((L & 31) - foeX[f]) + Math.abs((L >> 5) - foeY[f]));
      if (dm < bd) { bd = dm; best = k; }
    }
    d = best;
  }
  if (d >= 0) {
    if (fd === d) { bot.holdLift = false; bot.aHeld = false; return 0; }   // release A: throw
    return B_A | DIRBIT[d];                       // turn (and step) while holding
  }
  // keep out of danger while carrying
  if (!dFree(bot.A, c, now)) {
    const t = bestRefuge(bot, W, bot.A, S, foeX, foeY, nFoe);
    if (t >= 0 && S.first[t] >= 0 && S.dep[t] <= now + 1) return B_A | DIRBIT[S.first[t]];
  }
  return B_A;
}

// ---- stage 10: jump (Y) over an adjacent bomb when cornered ----------------------------------
function jumpOut(bot, W, now, c) {
  if (now - bot.yAt < 40) return 0;
  const facing = g16(bot.p + 0x5E);
  const fd = facing === 2 ? 3 : facing === 4 ? 2 : facing === 8 ? 1 : 0;
  for (let d = 0; d < 4; d++) {
    const b = c + DC[d], l = b + DC[d];
    if (cellCode(b) !== 0x43 || !walkable(l, W)) continue;
    if (!dFree(bot.A, l, now + 34) && dHit(bot.A, l, now + 30, now + 40) >= 0) continue;
    if (fd !== d) return DIRBIT[d];               // face it (walking into the bomb turns us)
    bot.yAt = now;
    return B_Y;
  }
  return 0;
}

// ======================================================================================
// public: fill the pads of the ★ slots (before game.tick)
// ======================================================================================
export function fillPads(game, pads, out) {
  m = game.mem;
  let W = game._smartWorld;
  if (!W) { W = game._smartWorld = makeWorld(); game._smartBots = [null, null, null, null]; }
  worldUpdate(W);
  for (let i = 0; i < 4; i++) {
    out[i] = pads ? pads[i] : 0;
    if (out[i] === undefined) out[i] = null;
    if (!((m[STAR_FLAG] >> i) & 1)) continue;
    let bot = game._smartBots[i];
    if (!bot) bot = game._smartBots[i] = makeBot(i, (game.opts && game.opts.seed) || 1);
    if (bot.round !== W.roundKey || bot.lastTick > W.tick) {
      bot.round = W.roundKey; bot.goal = -1; bot.aHeld = false; bot.holdLift = false;
      bot.lastA = -100; bot.liftAt = -100; bot.yAt = -100; bot.goalUntil = 0; bot.cellSince = 0; bot.lastCell = -1; bot.hesitate = 0; bot.react = 6 + Math.floor(rnd(bot.rs) * 5); bot.prevX = g16(bot.p + 0x10); bot.prevY = g16(bot.p + 0x18); }
    out[i] = decide(bot, W);
    bot.lastTick = W.tick;
  }
  return out;
}
