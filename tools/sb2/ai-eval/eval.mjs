#!/usr/bin/env node
// Headless CPU behaviour metrics, original 13x11 vs tall 13x25 (findings: tools/sb2/NOTES-core-ai.md).
//   node tools/sb2/ai-eval/eval.mjs [--core DIR] [--stages 1-10] [--seeds 6] [--rounds 3]
//        [--level 5] [--time 3] [--modes cpu4,human3] [--layouts original,tall]
//        [--jobs 5] [--out file.json] [--label name]
// Runs every (layout, mode, stage, seed) game in worker threads, plays --rounds rounds
// (a new match starts when one ends) and accumulates per-CPU metrics. Prints a table and
// writes the raw totals as JSON (report.mjs compares several JSON files).
// Modes: cpu4 = four COMs; human3 = scripted human P1 (human.mjs) + three COMs.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEF_CORE = path.resolve(HERE, '../../../public/arcade/sb2/core');

// ---------------------------------------------------------------------------------------
// one game: metrics per CPU-round, summed into `acc`
// ---------------------------------------------------------------------------------------
export const NEAR = 3;                   // "near an opponent": Manhattan distance <= 3 cells
const FIELDS = ['rounds', 'cpuRounds', 'ticks', 'alive', 'deaths', 'selfKill', 'oppKill', 'blockKill', 'unkKill',
  'walkedIn', 'kills', 'idle', 'stuck', 'moves', 'reversals', 'bombs', 'soft', 'softInit', 'items',
  'near', 'nearBase', 'isolated', 'sealed', 'sealedRounds', 'samples', 'draws', 'timeUp', 'cpuWins', 'humanWins',
  'humanDeaths', 'humanKilledByCpu', 'firstKillTicks', 'firstKills', 'survivedRounds', 'cells'];
export const zero = () => Object.fromEntries(FIELDS.map((k) => [k, 0]));

export async function runGame(core, job, acc) {
  const { createGame } = core;
  const { makeHuman } = await import(pathToFileURL(path.join(HERE, 'human.mjs')).href);
  const human = job.mode === 'human3';
  const game = createGame({
    stage: job.stage, layout: job.layout, seed: job.seed,
    players: [0, 1, 2, 3].map((i) => (human && i === 0 ? { type: 'human' } : { type: 'cpu', level: job.level })),
    rules: { wins: 3, time: job.time, comLevel: job.level, gbomber: false },
  });
  const bot = human ? makeHuman(0) : null;
  const cpus = human ? [1, 2, 3] : [0, 1, 2, 3];
  for (let r = 0; r < job.rounds; r++) {
    playRound(game, job, acc, bot, cpus);
    const res = game.nextRound();
    if (res && res.matchOver) game.newMatch({});
  }
}

function playRound(game, job, acc, bot, cpus) {
  let s = game.state;
  const W = s.grid.width, r0 = s.grid.rows[0], H = s.grid.height;
  const cell = (x, y) => (y - r0) * W + x;
  let softInit = 0;
  for (const v of s.grid.code) if (v === 0xC2) softInit++;
  // arena-size baseline for "near": q = P(a random open-or-soft cell lies within NEAR of
  // another one); with k living foes a randomly placed bomber is near one with 1-(1-q)^k
  const open = [];
  for (let k = 0; k < s.grid.code.length; k++) { const v = s.grid.code[k]; if (!(v & 0x80) || v === 0xC2) open.push([k % W, Math.floor(k / W)]); }
  let qn = 0;
  for (const [x, y] of open) for (const [x2, y2] of open) if ((x !== x2 || y !== y2) && Math.abs(x - x2) + Math.abs(y - y2) <= NEAR) qn++;
  const qNear = qn / (open.length * (open.length - 1));
  acc.rounds++; acc.cpuRounds += cpus.length; acc.softInit += softInit * cpus.length;

  const fireStart = new Int32Array(W * H).fill(-1);   // tick a cell became fire
  const fireOwner = new Int8Array(W * H).fill(-1);
  const blockAt = new Int32Array(W * H).fill(-1);     // sudden-death block landing tick
  const expl = [];                                   // recent explosions {owner, cx, cy, range, t}
  const per = [0, 1, 2, 3].map(() => ({ enter: 0, cell: -1, prevCell: -1, x: -1, y: -1, dead: false, sealed: false }));
  let firstKill = -1, t = 0, prevCode = s.grid.code.slice();
  const maxT = 40000;
  while (!game.finished && t < maxT) {
    const pads = [bot ? bot(game.state) : 0, 0, 0, 0];
    const ev = game.tick(pads);
    t++;
    s = game.state;
    const code = s.grid.code;
    for (const e of ev) {
      if (e.type === 'bombExploded') expl.push({ owner: e.owner, cx: e.cx, cy: e.cy, range: e.range, t });
      else if (e.type === 'blockFell') blockAt[cell(e.cx, e.cy)] = t;
      else if (e.type === 'bombPlaced' && cpus.includes(e.slot)) acc.bombs++;
      else if (e.type === 'blockBurn' && cpus.includes(e.owner)) acc.soft++;
      else if (e.type === 'itemGot' && cpus.includes(e.slot)) acc.items++;
    }
    while (expl.length && t - expl[0].t > 200) expl.shift();
    // fire onset + owner (most recent explosion aligned within reach)
    for (let k = 0; k < code.length; k++) {
      const f = code[k] === 0x01 || code[k] === 0x41, pf = prevCode[k] === 0x01 || prevCode[k] === 0x41;
      if (f && !pf) {
        fireStart[k] = t;
        const cx = k % W, cy = Math.floor(k / W) + r0;
        let best = null;
        for (let i = expl.length - 1; i >= 0; i--) {
          const x = expl[i];
          const d = x.cx === cx ? Math.abs(x.cy - cy) : x.cy === cy ? Math.abs(x.cx - cx) : 99;
          if (d <= x.range + 1) { best = x; break; }
        }
        fireOwner[k] = best ? best.owner : -1;
      } else if (!f) fireStart[k] = -1;
    }
    prevCode = code.slice();
    if (s.frozen) continue;
    const alive = s.bombers.filter((b) => b.active && !b.dying);
    for (const e of ev) {
      if (e.type !== 'died') continue;
      const p = e.player, b = s.bombers[p], k = cell(b.cx, b.cy);
      per[p].dead = true;
      const owner = blockAt[k] >= 0 && t - blockAt[k] < 8 ? 'block' : fireOwner[k];
      const isCpu = cpus.includes(p);
      if (firstKill < 0) firstKill = t;
      if (typeof owner === 'number' && owner >= 0 && owner !== p && cpus.includes(owner)) acc.kills++;
      if (!isCpu) {
        acc.humanDeaths++;
        if (typeof owner === 'number' && cpus.includes(owner)) acc.humanKilledByCpu++;
        continue;
      }
      acc.deaths++;
      if (owner === 'block') acc.blockKill++;
      else if (owner === p) acc.selfKill++;
      else if (owner >= 0) acc.oppKill++;
      else acc.unkKill++;
      const enterT = k !== per[p].cell ? t : per[p].enter;
      if (owner !== 'block' && fireStart[k] >= 0 && fireStart[k] < enterT) acc.walkedIn++;
    }
    const sample = (t & 31) === 0;
    for (const p of cpus) {
      const b = s.bombers[p], q = per[p];
      if (!b.active || b.dying) continue;
      acc.alive++;
      const k = cell(b.cx, b.cy);
      if (k !== q.cell) {
        if (q.cell >= 0) { acc.moves++; if (k === q.prevCell) acc.reversals++; }
        q.prevCell = q.cell; q.cell = k; q.enter = t;
      }
      const dirs = b.input & 0x0F00;
      if (!dirs) acc.idle++;
      else if (b.x === q.x && b.y === q.y) acc.stuck++;
      q.x = b.x; q.y = b.y;
      const foes = alive.filter((o) => o.slot !== p);
      if (foes.some((o) => Math.abs(o.cx - b.cx) + Math.abs(o.cy - b.cy) <= NEAR)) acc.near++;
      acc.nearBase += 1 - Math.pow(1 - qNear, foes.length);
      if (sample) {
        acc.samples++;
        const reg = region(code, W, H, r0, b.cx, b.cy);
        const hasFoe = foes.some((o) => reg.cells.has(cell(o.cx, o.cy)));
        if (!hasFoe) acc.isolated++;
        if (!hasFoe && !reg.soft && foes.length) { acc.sealed++; q.sealed = true; }
      }
    }
  }
  acc.ticks += t;
  for (const p of cpus) { if (per[p].sealed) acc.sealedRounds++; if (!per[p].dead) acc.survivedRounds++; }
  if (firstKill >= 0) { acc.firstKillTicks += firstKill; acc.firstKills++; }
  const w = s.winner;
  if (w === 'draw' || w === null) { acc.draws++; if (s.clock.timeUp) acc.timeUp++; }
  else if (cpus.includes(w)) acc.cpuWins++; else acc.humanWins++;
  acc.cells += W * H;
}

// passable region from (x, y): every non-solid cell (bombs, fire, items count as passable)
function region(code, W, H, r0, x, y) {
  const cells = new Set(), st = [(y - r0) * W + x];
  let soft = false;
  cells.add(st[0]);
  while (st.length) {
    const k = st.pop(), cx = k % W, cy = Math.floor(k / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const n = ny * W + nx, v = code[n];
      if (v === 0xC2) { soft = true; continue; }
      if (v & 0x80) continue;
      if (!cells.has(n)) { cells.add(n); st.push(n); }
    }
  }
  return { cells, soft };
}

// ---------------------------------------------------------------------------------------
// derived metrics
// ---------------------------------------------------------------------------------------
const MIN = 60.1 * 60;                   // ticks per minute
export function derive(a) {
  const pct = (x, y) => (y ? (100 * x) / y : 0);
  return {
    'rounds': a.rounds,
    'round length (s)': a.ticks / a.rounds / 60.1,
    'time-up draws %': pct(a.timeUp, a.rounds),
    'all draws %': pct(a.draws, a.rounds),
    'first kill (s)': a.firstKills ? a.firstKillTicks / a.firstKills / 60.1 : 0,
    'CPU deaths / CPU-round': a.deaths / a.cpuRounds,
    '  by own bomb %deaths': pct(a.selfKill, a.deaths),
    '  by opponent %deaths': pct(a.oppKill, a.deaths),
    '  by SD block %deaths': pct(a.blockKill, a.deaths),
    '  walked into fire %deaths': pct(a.walkedIn, a.deaths),
    'self-kills / CPU-minute': a.selfKill / (a.alive / MIN),
    'opp kills / CPU-minute': a.kills / (a.alive / MIN),
    'idle %': pct(a.idle, a.alive),
    'stuck (dir held, no motion) %': pct(a.stuck, a.alive),
    'cells moved / s': a.moves / (a.alive / 60.1),
    'reversals % of moves': pct(a.reversals, a.moves),
    'bombs / min': a.bombs / (a.alive / MIN),
    'soft destroyed / min': a.soft / (a.alive / MIN),
    'soft destroyed / min / 100 soft': (100 * a.soft) / (a.alive / MIN) / (a.softInit / a.cpuRounds),
    'items / min': a.items / (a.alive / MIN),
    [`near foe (<=${NEAR}) %`]: pct(a.near, a.alive),
    '  near / random-placement baseline': a.nearBase ? a.near / a.nearBase : 0,
    'isolated from all foes %': pct(a.isolated, a.samples),
    'sealed (no soft exit, no foe) %': pct(a.sealed, a.samples),
    'CPU survived round %': pct(a.survivedRounds, a.cpuRounds),
    'human deaths / round': a.humanDeaths / a.rounds,
    'human wins %': pct(a.humanWins, a.rounds),
  };
}

export function table(cols) {            // cols: [{name, acc}]
  const rows = Object.keys(derive(zero()));
  const D = cols.map((c) => derive(c.acc));
  const w0 = Math.max(...rows.map((r) => r.length)) + 2;
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2));
  let out = ''.padEnd(w0) + cols.map((c) => c.name.padStart(14)).join('') + '\n';
  for (const r of rows) out += r.padEnd(w0) + D.map((d) => fmt(d[r]).padStart(14)).join('') + '\n';
  return out;
}

// ---------------------------------------------------------------------------------------
// main / workers
// ---------------------------------------------------------------------------------------
function parseList(s) {
  return s.split(',').flatMap((p) => { const m = p.match(/^(\d+)-(\d+)$/); if (!m) return [isNaN(+p) ? p : +p]; const o = []; for (let i = +m[1]; i <= +m[2]; i++) o.push(i); return o; });
}

if (!isMainThread) {
  const { coreDir, jobs } = workerData;
  const core = await import(pathToFileURL(path.join(coreDir, 'index.js')).href);
  for (const job of jobs) {
    const acc = zero();
    try { await runGame(core, job, acc); } catch (e) { parentPort.postMessage({ job, error: e.stack }); continue; }
    parentPort.postMessage({ job, acc });
  }
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const coreDir = path.resolve(opt('--core', process.env.SB2_CORE || DEF_CORE));
  const stages = parseList(opt('--stages', '1-10'));
  const nSeeds = +opt('--seeds', 6), rounds = +opt('--rounds', 3), level = +opt('--level', 5);
  const time = opt('--time', '3') === 'inf' ? Infinity : +opt('--time', '3');
  const modes = opt('--modes', 'cpu4,human3').split(','), layouts = opt('--layouts', 'original,tall').split(',');
  const nJobs = +opt('--jobs', Math.max(1, os.cpus().length - 1));
  const jobs = [];
  for (const layout of layouts) for (const mode of modes) for (const stage of stages) for (let i = 0; i < nSeeds; i++)
    jobs.push({ layout, mode, stage, seed: 1000 + 2 * i * 7919 % 60000, rounds, level, time });
  const t0 = Date.now();
  const results = [];
  await Promise.all(Array.from({ length: nJobs }, (_, w) => new Promise((res, rej) => {
    const mine = jobs.filter((_, i) => i % nJobs === w);
    if (!mine.length) return res();
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { coreDir, jobs: mine } });
    wk.on('message', (m) => { if (m.error) console.error('ERROR', JSON.stringify(m.job), m.error); else results.push(m); });
    wk.on('error', rej); wk.on('exit', res);
  })));
  const group = (f) => { const g = {}; for (const r of results) { const k = f(r.job); g[k] ||= zero(); for (const x in r.acc) g[k][x] += r.acc[x]; } return g; };
  const byLM = group((j) => `${j.layout}/${j.mode}`);
  const byStage = group((j) => `${j.layout}/${j.mode}/${j.stage}`);
  const cols = Object.keys(byLM).sort().map((k) => ({ name: k, acc: byLM[k] }));
  console.log(`core ${coreDir}  level ${level}  time ${time}  ${jobs.length} games x ${rounds} rounds  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(table(cols));
  const out = opt('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ label: opt('--label', path.basename(coreDir)), coreDir, level, time, rounds, nSeeds, stages, byLM, byStage }, null, 1));
}
