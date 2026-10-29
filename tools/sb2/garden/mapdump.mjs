#!/usr/bin/env node
// The BG2 map of every stage at match start, both layouts (the core's tile mirror $7FA000):
// the build places each wall / border cell from where the game puts it.
//   node tools/sb2/garden/mapdump.mjs <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createGame } = await import(path.join(ROOT, 'public/arcade/sb2/core/index.js'));
const out = {};
for (const layout of ['tall', 'original']) for (let stage = 1; stage <= 10; stage++) {
  const g = createGame({ stage, layout, seed: 1, players: [0,1,2,3].map(() => ({ type: 'cpu', level: 5 })), rules: { wins: 3, time: 3, gbomber: false } });
  g.tick([0,0,0,0]);
  const M = g.mem, rows = [];
  for (let r = 0; r < 32; r++) { const row = []; for (let c = 0; c < 32; c++) { const a = 0x1A000 + r * 64 + c * 2; row.push(M[a] | (M[a+1] << 8)); } rows.push(row); }
  out[layout + stage] = rows;
}
fs.writeFileSync(process.argv[2] || path.join(ROOT, 'data/sb2/garden/maps.json'), JSON.stringify(out));
