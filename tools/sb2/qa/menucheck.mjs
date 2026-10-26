#!/usr/bin/env node
// Pixel check of the re-laid out menus against the original (harness frames from
// tools/sb2/extract/menus.py, data/sb2/assets/menus/ref/): renders each screen with
// public/arcade/sb2/menu.js in Node and writes raw frames for menucheck.py to compare the
// regions that are the original's own (the panels, the title's logo / items / sprites).
//   node tools/sb2/qa/menucheck.mjs && python3 tools/sb2/qa/menucheck.py
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACK = path.join(ROOT, 'data', 'sb2', 'assets', 'pack');
const OUT = path.join(ROOT, 'data', 'sb2', 'qa', 'menucheck');
fs.mkdirSync(OUT, { recursive: true });
const { createMenu } = await import(path.join(ROOT, 'public/arcade/sb2/menu.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(PACK, 'menu.json'), 'utf8'));
const bin = new Uint8Array(fs.readFileSync(path.join(PACK, manifest.bin)));
const blob = (n) => { const e = manifest.blobs[n]; return bin.subarray(e[0], e[0] + e[1]); };
const BT = { UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, A: 256, B: 1 };

// the harness captures: 1P MAN 2P MAN 3P COM 4P COM, rules defaults, stage 1
const set = { players: ['human', 'human', 'cpu', 'cpu'], level: 5, wins: 3, time: 2, gbomber: true, stage: 1, layout: 'classic' };
const menu = createMenu({ manifest, blob, mini: null }, { settings: set });
const run = (n) => { for (let i = 0; i < n; i++) menu.frame(0); };
const dump = (name) => { fs.writeFileSync(path.join(OUT, name + '.rgba'), Buffer.from(menu.out.buffer)); console.log('wrote', name); };

run(5); menu.press(BT.UP); run(20); dump('title');                // cursor on NORMAL GAME like the ref
for (const name of ['mode', 'players', 'rules']) {
  menu.show(name); run(40);
  if (name === 'mode') { const p = menu._ppu; p.L[2].hofs = manifest.ppu.mode.bg2_hofs; p.L[2].force = true; p.render(menu.out); }   // the ref's scroll phase
  dump(name);
}
menu.show('stage'); run(60); dump('stage');
