import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as core from './core.mjs';
const path = new URL('../../data/bw/conformance/', import.meta.url);
const bytes = fs.readFileSync(new URL('grid.bin', path));
const grid = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const cases = JSON.parse(fs.readFileSync(new URL('helpers.json', path)));
for (const c of cases) {
  const args = c.name.startsWith('cell') ? [grid, ...c.args] : c.args;
  const result = Number(core[c.name](...args)) >>> 0;
  assert.equal(result, c.result, `${c.name}(${c.args.join(',')})`);
}
console.log(`${cases.length}/${cases.length} original-machine-code helper cases match`);
