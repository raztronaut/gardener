#!/usr/bin/env node
// Conformance runner: replays every recorded vector (data/sb2/vectors/*.json, made from
// the original game by tools/sb2/re/vectors.py) through the JS core and compares the
// per-tick ground truth.
//
//   node tools/sb2/conformance/run.mjs [names...] [--verbose] [--max N] [--only a,b]
//
// Start state: the original's WRAM right after the vector's settle frames and pokes
// (data/sb2/conformance/start/<name>.wram, written by vcover.py from the vector's
// start.state + start.pokes). The JSON 'initial' snapshot is checked against it.
// Frame -> tick mapping (SPEC §18): a frame whose truth.tick advanced ran one tick,
// which read that frame's pads; frames where it did not advance are lag frames (or the
// frozen screens after a round) and are skipped. A tick-counter reset = a new round.
// Compared per tick: tick, rng, g30, clock/round words, the 22 per-bomber fields,
// active bombs, movers, the grid window (cols 0..16 x rows 2..16) and deaths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The core under test: SB2_CORE=<dir> overrides (e.g. a snapshot copy, see snapcore.sh).
const CORE_DIR = process.env.SB2_CORE ? path.resolve(process.env.SB2_CORE) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/arcade/sb2/core');
const { createGame } = await import(path.join(CORE_DIR, 'index.js'));
const { use, r8, r16, w16 } = await import(path.join(CORE_DIR, 'mem.js'));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const VEC = path.join(ROOT, 'data', 'sb2', 'vectors');
const START = path.join(ROOT, 'data', 'sb2', 'conformance', 'start');

export const ROUND_ADDRS = [0x5E10, 0x5E12, 0x5E14, 0x5C56, 0x5E20, 0x00B9, 0x00BE, 0x5D0E,
  0x5C3E, 0x5E66, 0x5E68, 0x5E6A, 0x5E6C];
export const PFIELDS = [['x', 0x10, 2], ['xf', 0x12, 2], ['y', 0x18, 2], ['yf', 0x1A, 2],
  ['f00', 0x00, 2], ['f52', 0x52, 2], ['f7e', 0x7E, 2], ['inp', 0x6E, 2], ['cell', 0xA8, 2],
  ['speed', 0xF0, 1], ['speed_max', 0xE0, 1], ['bombs_cap', 0xE1, 1], ['bombs_hand', 0xF1, 1],
  ['bombs_out', 0xF8, 1], ['fire', 0xF2, 1], ['btype', 0xF3, 1], ['disease', 0xF5, 1],
  ['kick', 0xFF, 1], ['glove', 0xFE, 1], ['wallpass', 0xFB, 1], ['bombpass', 0xFA, 1],
  ['shield', 0xEF, 1]];

const rd = (a, s) => (s === 2 ? r16(a) : r8(a));

export function snapshot() {     // same fields as vectors.py truth (from the core memory)
  const players = [];
  for (let i = 0; i < 4; i++) {
    const b = 0x8000 + 0x100 * i;
    const o = {};
    for (const [k, off, s] of PFIELDS) o[k] = rd(b + off, s);
    players.push(o);
  }
  const bombs = [];
  for (let k = 0; k < 40; k++) {
    const b = 0x12000 + 0x100 * k;
    const f = r16(b);
    if (f & 0x8000) bombs.push([k, f, r16(b + 0xA), r8(b + 4), r8(b + 7), r8(b + 6), r8(b + 8), r8(b + 9)]);
  }
  const movers = [];
  for (let k = 0; k < 64; k++) {
    const p = r16(0x2620 + 2 * k);
    if (p === 0xFFFF) break;
    if (p >= 0x8400) movers.push([p, r16(p + 0x10), r16(p + 0x18), r16(p + 0x52), r16(p)]);
  }
  const grid = [];
  for (let y = 2; y < 17; y++) { const row = []; for (let x = 0; x < 17; x++) row.push(r8(0x1C000 + y * 0x80 + x * 2)); grid.push(row); }
  return {
    tick: r16(0x32), rng: r16(0xD6), g30: r16(0x30), stage: r16(0x1A),
    timer: ROUND_ADDRS.map((a) => r16(a)), players, bombs, movers, grid,
  };
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function compare(exp, got, expGrid, only) {
  const want = (k) => !only || only.includes(k);
  const d = [];
  if (want('tick') && exp.tick !== got.tick) d.push(['tick', exp.tick, got.tick]);
  if (want('rng') && exp.rng !== got.rng) d.push(['rng', exp.rng, got.rng]);
  if (want('g30') && exp.g30 !== got.g30) d.push(['g30', exp.g30, got.g30]);
  if (want('timer')) exp.timer.forEach((v, i) => { if (v !== got.timer[i]) d.push(['timer $' + ROUND_ADDRS[i].toString(16).toUpperCase(), v, got.timer[i]]); });
  if (want('players')) for (let i = 0; i < 4; i++) for (const [k] of PFIELDS) {
    if (exp.players[i][k] !== got.players[i][k]) d.push([`P${i + 1}.${k}`, exp.players[i][k], got.players[i][k]]);
  }
  if (want('bombs') && !eq(exp.bombs, got.bombs)) d.push(['bombs', exp.bombs, got.bombs]);
  if (want('movers') && !eq(exp.movers, got.movers)) d.push(['movers', exp.movers, got.movers]);
  if (want('grid')) for (let y = 0; y < expGrid.length; y++) for (let x = 0; x < 17; x++) {
    if (expGrid[y][x] !== got.grid[y][x]) d.push([`grid(${x},${y + 2})`, expGrid[y][x], got.grid[y][x]]);
  }
  return d;
}

const fmt = (v) => (typeof v === 'number' ? (v > 9 ? `${v} ($${v.toString(16).toUpperCase()})` : `${v}`) : JSON.stringify(v));

export function runVector(name, { verbose = false, max = 1, only = null, onTick = null } = {}) {
  const v = JSON.parse(fs.readFileSync(path.join(VEC, name + '.json'), 'utf8'));
  const wpath = path.join(START, name + '.wram');
  if (!fs.existsSync(wpath)) return { name, ok: false, ticks: 0, first: 'missing start WRAM (run vcover.py)' };
  const wram = new Uint8Array(fs.readFileSync(wpath));
  const game = createGame({ wram });
  use(game.mem);
  const init = v.initial;
  const frames = v.frames;
  // start/<name>.meta.json: skip = leading frames consumed to complete a lagged tick
  const mpath = path.join(START, name + '.meta.json');
  const skip = fs.existsSync(mpath) ? JSON.parse(fs.readFileSync(mpath, 'utf8')).skip : 0;
  const expGrid = init.grid.map((r) => r.slice());
  let applied = -1;                              // grid changes applied through this frame
  const applyTo = (k) => { for (; applied < k; ) { applied++; for (const [cx, cy, val] of frames[applied].truth.grid) expGrid[cy - 2][cx] = val; } };
  // sanity: the reference snapshot must agree with the start WRAM
  const ref = skip ? { rng: frames[skip - 1].truth.rng, tick: frames[skip - 1].truth.tick, players: frames[skip - 1].truth.players }
    : { rng: init.globals.rng, tick: init.globals.tick, players: init.players };
  const s0 = snapshot();
  if (s0.rng !== ref.rng || s0.tick !== ref.tick || !eq(s0.players, ref.players)) {
    return { name, ok: false, ticks: 0, first: 'start WRAM does not match the vector snapshot' };
  }
  if (skip) applyTo(skip - 1);
  let prevTick = ref.tick;
  let prevRng = ref.rng;
  let ticks = 0;
  const diffs = [];
  let rounds = 1;
  let i = skip;
  if (i < frames.length && frames[i].truth.tick === prevTick) {
    return { name, ok: false, ticks: 0, first: 'start WRAM is mid-tick (re-run vcover.py)' };
  }
  while (i < frames.length) {
    const t0 = frames[i].truth.tick;
    if (t0 === prevTick) { i++; continue; }
    // group of frames with this tick value: pads of the first, state complete at the last
    // (2-frame group = lag), or at the first for long groups (frozen post-round screens)
    let j = i;
    while (j + 1 < frames.length && frames[j + 1].truth.tick === t0) j++;
    // last frame of the group that still shows the same mode word $B9: long ticks (lag)
    // complete at the group's end; after the final tick of a round $B9 changes (exit to
    // the scoreboard) and the frozen screens are not part of the battle state
    let c = i;
    while (c < j && frames[c + 1].truth.timer[5] === frames[i].truth.timer[5]) c++;
    const fr = frames[i];
    if (t0 > prevTick && game.finished) {        // after the battle loop: scoreboard frames
      prevTick = t0; i = j + 1; continue;
    }
    if (t0 < prevTick) {                         // tick counter reset: next round
      rounds++;
      if (!game.nextRound) { diffs.push({ frame: i, tick: t0, d: [['round', 'next round', 'nextRound() not implemented']] }); break; }
      game.nextRound();
      // the group starts with the loading frames of the round init ($32 = 0 already);
      // the round's first tick (run with $32 = 0, not counted) completes in its last frame
      game.tick(frames[c].pads.slice(0, 4).map((p, k) => (v.start.multitap || k < 2 ? p : null)));
    } else {
      // no tick ran in this group (rng unchanged): $32 was double-incremented (the NMI hit
      // between INC $16 and the main loop's wait); the skipped value never runs
      if (frames[c].truth.rng === prevRng) { prevTick = t0; i = j + 1; continue; }
      if (t0 !== prevTick + 1 && t0 !== prevTick + 2) { diffs.push({ frame: i, tick: t0, d: [['tick', 'one tick per frame', `jump ${prevTick}->${t0}`]] }); break; }
      // the running tick sees $32 = truth.tick (also after a double increment)
      use(game.mem); w16(0x32, (t0 - 1) & 0xFFFF); w16(0x16, 1);
      game.tick(fr.pads.slice(0, 4).map((p, k) => (v.start.multitap || k < 2 ? p : null)));
    }
    prevRng = frames[c].truth.rng;
    prevTick = t0;
    ticks++;
    applyTo(c);
    use(game.mem);
    const got = snapshot();
    const t = frames[c].truth;
    const d = compare(t, got, expGrid, only);
    if (onTick) onTick({ i: c, t, got, d, game });
    if (d.length) {
      diffs.push({ frame: c, tick: t0, d });
      if (diffs.length >= max) break;
    }
    i = j + 1;
  }
  const first = diffs.length ? diffs[0] : null;
  return {
    name, ok: !first, ticks, rounds, diffs,
    first: first ? `frame ${first.frame} tick ${first.tick}: ` + first.d.slice(0, verbose ? 50 : 3).map(([k, e, g]) => `${k} exp ${fmt(e)} got ${fmt(g)}`).join('; ') + (first.d.length > 3 && !verbose ? ` (+${first.d.length - 3})` : '') : '',
  };
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const mi = args.indexOf('--max');
  const max = mi >= 0 ? +args[mi + 1] : 1;
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? args[oi + 1].split(',') : null;
  const skip = new Set([mi >= 0 ? args[mi + 1] : null, oi >= 0 ? args[oi + 1] : null]);
  let names = args.filter((a) => !a.startsWith('--') && !skip.has(a));
  if (!names.length) names = fs.readdirSync(VEC).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  const rows = [];
  for (const n of names) {
    let r;
    try { r = runVector(n, { verbose, max, only }); } catch (e) { r = { name: n, ok: false, ticks: 0, first: 'EXCEPTION ' + (verbose ? e.stack : e.message) }; }
    rows.push(r);
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${n.padEnd(22)} ${String(r.ticks).padStart(5)} ticks  ${r.first || ''}`);
    if (verbose && r.diffs) for (const x of r.diffs.slice(1)) console.log('      also frame', x.frame, 'tick', x.tick, x.d.slice(0, 6).map(([k, e, g]) => `${k} exp ${fmt(e)} got ${fmt(g)}`).join('; '));
  }
  const pass = rows.filter((r) => r.ok).length;
  console.log(`\n${pass}/${rows.length} vectors pass`);
  process.exitCode = pass === rows.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
