#!/usr/bin/env node
// Pacing-model dataset: the port's per-tick model inputs (public/arcade/sb2/pacing.js
// vector(): the core's work meter, display work, event counts) next to the original's
// MEASURED per-tick cost (tools/sb2/re/lagcost.py -> data/sb2/re/lag/<name>.json).
//
//   node tools/sb2/conformance/lagdata.mjs [names...]   -> data/sb2/re/lagfit/<name>.json
//
// The port replays each vector tick-exactly (run.mjs), so its state after every tick is
// the original's. Ticks are paired with the harness measurement by the frame in which the
// tick completed. Fit: lagfit.py; validation: lagcheck.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVector } from './run.mjs';
import { createPacer } from '../../../public/arcade/sb2/pacing.js';
import { loadPack } from '../render/shot.mjs';
import { createDisplay } from '../../../public/arcade/sb2/render/display.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LAG = path.join(ROOT, 'data', 'sb2', 're', 'lag');
const OUT = path.join(ROOT, 'data', 'sb2', 're', 'lagfit');
const PACK = loadPack();

export function dataset(name) {
  const m = JSON.parse(fs.readFileSync(path.join(LAG, name + '.json'), 'utf8'));
  const byDone = new Map();
  for (const t of m.ticks) if (t.work_wait != null) byDone.set(t.done_frame, t);
  const nmis = m.nmis;            // [start, end, $16 flag, frame]
  const rows = [];
  const pacer = createPacer({ rom8: PACK.rom8 });
  let disp = null, paired = 0, unpaired = 0;
  const r = runVector(name, {
    max: 1,
    onTick: ({ i, game }) => {
      if (!disp) disp = createDisplay(PACK, { layout: 'original' });
      disp.frame(game, game.events);
      const f = Array.from(pacer.vector(game, disp));
      const t = byDone.get(i);
      if (!t) { unpaired++; return; }
      paired++;
      let prev = null;            // the NMI whose end started this tick
      for (let k = nmis.length - 1; k >= 0; k--) if (nmis[k][0] <= t.start) { prev = nmis[k]; break; }
      rows.push({ frame: i, f, work: t.work_wait, startOff: prev ? t.start - prev[0] : null,
        routines: t.routines, obj: t.obj });
    },
  });
  return { name, ok: r.ok, ticks: r.ticks, paired, unpaired, names: pacer.featureNames, rows };
}

function main() {
  let names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!names.length) names = fs.readdirSync(LAG).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  fs.mkdirSync(OUT, { recursive: true });
  for (const n of names) {
    const d = dataset(n);
    fs.writeFileSync(path.join(OUT, n + '.json'), JSON.stringify(d));
    console.log(`${n.padEnd(22)} ${d.ok ? 'ok ' : 'BAD'} ticks ${d.ticks} paired ${d.paired} unpaired ${d.unpaired}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
