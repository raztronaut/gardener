#!/usr/bin/env node
// Headless CPU-only match for quick debugging: prints the events of every tick and the
// round results.
//   node tools/sb2/conformance/sim.mjs [--stage N] [--tall] [--seed S] [--rounds K]
//        [--level L] [--wins W] [--time M] [--quiet] [--all-events] [--max-ticks T]
//        [--sd pace]   (tall: sudden death from 0:33 at 9 ticks/block instead of 0:47 at 15)
// --quiet prints only round results; by default the per-tick 'clock' events are hidden
// (--all-events shows them). Exits non-zero on an exception. SB2_CORE=<dir> selects
// another core directory (see snapcore.sh).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIR = process.env.SB2_CORE ? path.resolve(process.env.SB2_CORE) : path.resolve(HERE, '../../../public/arcade/sb2/core');
const { createGame } = await import(path.join(CORE_DIR, 'index.js'));

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const stage = +opt('--stage', 1), seed = +opt('--seed', 0), rounds = +opt('--rounds', 1);
const level = +opt('--level', 5), wins = +opt('--wins', 3), time = opt('--time', '2');
const quiet = a.includes('--quiet'), all = a.includes('--all-events');
const maxTicks = +opt('--max-ticks', 20000);

const fmt = (e) => Object.entries(e).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${typeof v === 'number' && k === 'sfx' ? '$' + v.toString(16) : JSON.stringify(v)}`).join(' ');

try {
  const game = createGame({
    stage, layout: a.includes('--tall') ? 'tall' : 'original', seed,
    players: [0, 1, 2, 3].map(() => ({ type: 'cpu', level })),
    rules: { wins, time: time === 'inf' ? Infinity : +time, comLevel: level, gbomber: false, tallSuddenDeath: opt('--sd', 'clock') },
  });
  console.log(`stage ${stage} ${game.layout.tall ? 'tall 13x25' : 'original 13x11'} seed ${seed} level ${level}`);
  for (let r = 1; r <= rounds; r++) {
    let t = 0;
    while (!game.finished && t < maxTicks) {
      const ev = game.tick([0, 0, 0, 0]);
      t++;
      if (quiet) continue;
      for (const e of ev) if (all || e.type !== 'clock') console.log(`r${r} t${String(game.state.tick).padStart(5)} ${e.type} ${fmt(e)}`);
    }
    const s = game.state;
    const res = game.finished ? game.nextRound() : null;
    console.log(`round ${r}: ${t} ticks, ${res ? (res.winner == null ? 'DRAW' : 'winner P' + (res.winner + 1)) : 'NOT FINISHED'}, wins ${s.wins.join('-')}` +
      (res ? ` -> ${res.wins.join('-')}${res.matchOver ? ' (match over)' : ''}` : ''));
    if (!res || res.matchOver) break;
  }
} catch (e) {
  console.error('EXCEPTION', e.stack);
  process.exit(1);
}
