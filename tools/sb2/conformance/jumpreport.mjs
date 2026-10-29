#!/usr/bin/env node
// What the original did in the stage-10 jump vectors (jump_vectors.py): per bomber, every
// change of cell / +52 state / +02-derived phase, deaths, the Y presses and the fire at its
// cell.   node tools/sb2/conformance/jumpreport.mjs [names...] [--all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../../data/sb2/conformance/jump_vectors');
const a = process.argv.slice(2);
const names = a.filter((x) => !x.startsWith('--'));
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && (!names.length || names.includes(f.slice(0, -5))));
const btn = (p) => ['B', 'Y', 'SEL', 'ST', 'U', 'D', 'L', 'R', 'A', 'X', 'L1', 'R1'].filter((_, i) => p & (1 << i)).join('+') || '-';
for (const f of files) {
  const v = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  console.log(`\n== ${v.name}: ${v.description}`);
  const grid = new Map();                        // "cx,cy" -> code (changes only)
  for (let r = 0; r < v.initial.grid.length; r++) for (let c = 0; c < v.initial.grid[r].length; c++) grid.set(`${c},${r + 2}`, v.initial.grid[r][c]);
  const prev = [null, null, null, null];
  for (const fr of v.frames) {
    const T = fr.truth;
    for (const [cx, cy, val] of T.grid) grid.set(`${cx},${cy}`, val);
    for (let k = 0; k < 4; k++) {
      const p = T.players[k];
      const cx = (p.x + 8) >> 4, cy = (p.y + 23) >> 4;
      const code = grid.get(`${cx},${cy}`);
      const key = `${cx},${cy} f52=${p.f52.toString(16)}${p.f00 & 0x800 ? ' DYING' : ''}`;
      const pad = fr.pads[k];
      if (key !== prev[k] || (pad & 2) || a.includes('--all')) {
        console.log(`  t${String(T.tick).padStart(4)} P${k + 1} ${btn(pad).padEnd(8)} x=${p.x} y=${p.y} cell ${key} under=${(code ?? 0).toString(16)}${T.deaths.includes(k) ? '  DIED' : ''}`);
        prev[k] = key;
      }
    }
  }
}
