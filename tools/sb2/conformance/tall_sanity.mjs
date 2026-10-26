#!/usr/bin/env node
// Sanity checks of the TALL (13x25) layouts, for every stage:
//   conn   every spawn reaches every other one after the round-start soft-block removal
//          (BFS; soft blocks count as passable, hard blocks / walls / water do not)
//   sym    the generated map (before the random removal) is mirror-symmetric where the
//          original stage map is (checked per stage against the original: L/R and T/B on
//          grid + underlay codes)
//   pocket no gimmick cell and no soft block in a spawn pocket (spawn + the 2 cells along
//          each wall; stage 4: spawn + its 4 neighbours), except gimmicks the original has
//          in the same pocket (stage 9's corner arrows)
//   deck   145 cards with the per-stage counts x25/11
//   round  a CPU-only tall round (4 COM, level 5) runs to the end (round over + 256 ticks
//          or time up) without an exception, for several seeds (note: seeds s and s|1
//          give the same RNG stream: the generator ORs 1 into the seed)
//   node tools/sb2/conformance/tall_sanity.mjs [--seeds 1,2,3] [--stage N]
// SB2_CORE=<dir> selects another core directory (snapcore.sh).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = process.env.SB2_CORE ? path.resolve(process.env.SB2_CORE) : path.resolve(HERE, '../../../public/arcade/sb2/core');
const { createGame } = await import(path.join(CORE, 'index.js'));
const mem = await import(path.join(CORE, 'mem.js'));
const tall = await import(path.join(CORE, 'tall.js'));
const { STAGE_MAPS } = await import(path.join(CORE, 'layout_data.js'));
const { STAGE_IDS, DECK } = await import(path.join(CORE, 'layout.js'));

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const seeds = opt('--seeds', '1,2,4').split(',').map(Number);
const stages = opt('--stage') ? [+opt('--stage')] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const cpu = () => [0, 1, 2, 3].map(() => ({ type: 'cpu', level: 5 }));

const isSolid = (g) => (g & 0x80) && g !== 0xC2;
const GIMMICK = (g, u) => {
  const t = g & 0x3F, v = u & 0x3F;
  return [0x09, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14].includes(t) || (t >= 0x17 && t <= 0x1E) ||
    g === 0x49 || g === 0x50 || [0x09, 0x0E, 0x14].includes(v) || (v >= 0x3C && v <= 0x3F) || u === 0x50;
};

function readMap(rows) {                 // {g, u}[cy][cx] for cx 1..15
  const m = [];
  for (let cy = 0; cy <= rows; cy++) {
    m[cy] = [];
    for (let cx = 0; cx <= 16; cx++) m[cy][cx] = { g: mem.r16(0x1C000 + cy * 0x80 + cx * 2) & 0xFF, u: mem.r16(0x1D000 + cy * 0x80 + cx * 2) & 0xFF };
  }
  return m;
}
function origMap(sid) {
  const M = STAGE_MAPS[sid], m = [];
  for (let cy = 0; cy < M.grid.length; cy++) {
    m[cy] = [];
    for (let cx = 0; cx <= 16; cx++) m[cy][cx] = { g: parseInt(M.grid[cy].substr(cx * 2, 2), 16), u: parseInt(M.under[cy].substr(cx * 2, 2), 16) };
  }
  return m;
}
function symmetric(m, y0, y1) {          // [L/R, T/B] over the inner field cx 2..14
  let lr = true, tb = true;
  for (let cy = y0; cy <= y1; cy++) for (let cx = 2; cx <= 14; cx++) {
    const c = m[cy][cx], h = m[cy][16 - cx], v = m[y0 + y1 - cy][cx];
    if (c.g !== h.g || c.u !== h.u) lr = false;
    if (c.g !== v.g || c.u !== v.u) tb = false;
  }
  return [lr, tb];
}
function spawnCells(game) { return game.state.bombers.map((b) => [b.cx, b.cy]); }
function pockets(stage, sp, y1) {
  if (stage === 4) return sp.map(([x, y]) => [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]);
  return sp.map(([x, y]) => {
    const dx = x === 2 ? 1 : -1, dy = y === 4 ? 1 : -1;
    return [[x, y], [x + dx, y], [x + 2 * dx, y], [x, y + dy], [x, y + 2 * dy]];
  });
}
// jump: stage 10's Y-jump crosses one solid inner cell (it lands in it and hops out)
function connected(m, sp, jump, y1) {
  const seen = new Set(), q = [sp[0]];
  seen.add(sp[0].join());
  const inField = (x, y) => x >= 2 && x <= 14 && y >= 4 && y <= y1;
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = x + dx, ny = y + dy;
      if (!m[ny] || !m[ny][nx]) continue;
      if (isSolid(m[ny][nx].g)) {
        if (!jump || !inField(nx, ny) || !inField(nx + dx, ny + dy)) continue;
        nx += dx; ny += dy;
        if (isSolid(m[ny][nx].g)) continue;
      }
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return sp.every((s) => seen.has(s.join()));
}

const rows = [];
let bad = 0;
for (const st of stages) {
  const sid = STAGE_IDS[st - 1];
  const r = { stage: st };
  try {
    // generated map before the removal
    const g0 = createGame({ stage: st, layout: 'tall', seed: seeds[0], players: cpu() });
    mem.use(g0.mem);
    tall.loadTallMap(sid);
    const full = readMap(31);
    const [olr, otb] = symmetric(origMap(sid), 4, 14);
    const [tlr, ttb] = symmetric(full, 4, 28);
    r.sym = `${olr ? (tlr ? 'LR' : 'LR!') : 'lr-'}${otb ? (ttb ? ' TB' : ' TB!') : ' tb-'}`;
    const symOk = (!olr || tlr) && (!otb || ttb);
    // round-start map (fresh game, after the removal)
    const g = createGame({ stage: st, layout: 'tall', seed: seeds[0], players: cpu() });
    mem.use(g.mem);
    const m = readMap(31), om = origMap(sid), sp = spawnCells(g);
    // stage 10 needs the jump (its original map is only connected through it, too)
    r.conn = connected(m, sp, st === 10, 28) ? (st === 10 ? 'ok (jump)' : 'ok') : 'FAIL';
    if (!connected(origMap(sid), st === 4 ? [[6, 8], [10, 10], [10, 8], [6, 10]] : [[2, 4], [14, 14], [14, 4], [2, 14]], st === 10, 14)) r.conn += ' (orig FAIL)';
    const pk = pockets(st, sp, 28), opk = pockets(st, st === 4 ? [[6, 8], [10, 10], [10, 8], [6, 10]] : [[2, 4], [14, 14], [14, 4], [2, 14]]);
    const viol = [];
    pk.forEach((cells, i) => cells.forEach(([x, y], j) => {
      const c = m[y][x], [ox, oy] = opk[i][j], o = om[oy][ox];
      if (c.g === 0xC2) viol.push(`soft(${x},${y})`);
      else if (GIMMICK(c.g, c.u) && !GIMMICK(o.g, o.u)) viol.push(`gimmick(${x},${y})`);
    }));
    const kept = pk.flat().filter(([x, y]) => GIMMICK(m[y][x].g, m[y][x].u)).length;
    r.pocket = viol.length ? 'FAIL ' + viol.join(' ') : kept ? `ok (${kept} as orig)` : 'ok';
    // deck
    const want = tall.tallDeckCounts(sid);
    let n = 0; const got = {};
    for (let x = DECK; mem.r16(x) !== 0xFFFF && n < 400; x += 2, n++) got[mem.r16(x)] = (got[mem.r16(x)] || 0) + 1;
    const tiles = [0x1600, 0x1604, 0x1602, 0x1606, 0x1622, 0x160E, 0x160A, 0x1626, 0x1624, 0x162A, 0x1628];
    const countsOk = tiles.every((t, k) => (got[t] || 0) === want[k]);
    r.deck = n === 145 && countsOk ? `145 (${want.reduce((s, v) => s + v, 0)} items)` : `FAIL n=${n}`;
    // rounds
    const res = [];
    let roundsOk = true;
    for (const seed of seeds) {
      try {
        const gr = createGame({ stage: st, layout: 'tall', seed, players: cpu() });
        let t = 0;
        while (!gr.finished && t < 9000) { gr.tick([0, 0, 0, 0]); t++; }
        const s = gr.state;
        if (!gr.finished) { roundsOk = false; res.push(`s${seed}:unfinished`); continue; }
        res.push(`s${seed}:${t}t ${s.winner === 'draw' ? 'draw' : 'P' + (s.winner + 1)}`);
      } catch (e) { roundsOk = false; res.push(`s${seed}:EXC ${e.message}`); }
    }
    r.round = res.join(', ');
    const ok = symOk && r.conn.startsWith('ok') && !r.conn.includes('orig') && !viol.length && r.deck.startsWith('145') && roundsOk;
    r.ok = ok ? 'PASS' : 'FAIL';
    if (!ok) bad++;
  } catch (e) { r.ok = 'FAIL'; r.round = 'EXC ' + e.stack.split('\n').slice(0, 3).join(' | '); bad++; }
  rows.push(r);
  console.log(`${r.ok}  stage ${String(st).padStart(2)}  conn ${r.conn}  sym ${r.sym}  pocket ${r.pocket}  deck ${r.deck}  rounds ${r.round}`);
}
console.log(`\n${rows.length - bad}/${rows.length} stages pass  (sym: LR/TB = symmetric like the original; lr-/tb- = not symmetric in the original either)`);
process.exitCode = bad ? 1 : 0;
