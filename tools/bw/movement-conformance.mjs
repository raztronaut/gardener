import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tickBombFuse } from './bombs.mjs';
import { WorldMovement } from './movement.mjs';
const root = new URL('../../data/bw/conformance/movement/', import.meta.url);
const baseline = fs.readFileSync(new URL('baseline.ram', root));
const { cases, observed_range: [lo, hi] } = JSON.parse(fs.readFileSync(new URL('cases.json', root)));
let count = 0;
const groups = {};
for (const c of cases) {
  const bytes = Uint8Array.from(baseline), ram = new DataView(bytes.buffer);
  for (const [address, size, value] of c.patches) {
    ram[`setUint${size * 8}`](address & 0x1fffff, value, true);
  }
  const before = bytes.slice(lo, hi);
  const engine = new WorldMovement(ram);
  const result = c.name === 'tickBombFuse' ? tickBombFuse(ram, ...c.args) : engine[c.name](...c.args);
  const label = `${count} ${c.name} ${c.label} ${JSON.stringify(c.args)}`;
  if (c.result !== null) assert.equal(Number(result) >>> 0, c.result, label + ' return');
  const writes = [];
  for (let i = lo; i < hi; i++) if (bytes[i] !== before[i - lo]) writes.push([i, bytes[i]]);
  assert.deepEqual(writes, c.writes, label + ' memory writes');
  count++; groups[c.name] = (groups[c.name] || 0) + 1;
}
console.log(`${count}/${cases.length} original-machine-code movement/collision cases match`);
console.log(JSON.stringify(groups));
const hashes = Object.fromEntries(['movement.mjs', 'bombs.mjs', 'movement-oracle.py'].map(name => [name,
  createHash('sha256').update(fs.readFileSync(new URL(name, import.meta.url))).digest('hex')]));
fs.writeFileSync(new URL('verification.json', root), JSON.stringify({
  checkedAt: new Date().toISOString(), cases: count, groups, sourceHashes: hashes,
  scope: 'Original routine return values and writes in battle grid/actor/bomb RAM; not whole-game conformance',
}, null, 2) + '\n');
