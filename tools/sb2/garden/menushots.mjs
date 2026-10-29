#!/usr/bin/env node
// Garden Edition: the menu screens rendered in Node by menu.js (classic and garden skins),
// for review. Writes <out>/menus_<skin>.png (title, mode, players, rules, stage TALL,
// stage CLASSIC, results side by side, native 256 x 455 each).
//   node tools/sb2/garden/menushots.mjs [--out data/sb2/garden] [--scale 1] [--stage 3]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../render/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createMenu } = await import(path.join(ROOT, 'public/arcade/sb2/menu.js'));
const { skinMenuPack } = await import(path.join(ROOT, 'public/arcade/sb2/render/skin.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const outDir = path.resolve(ROOT, arg('out', 'data/sb2/garden'));
const scale = +arg('scale', '1');
const stageNo = +arg('stage', '3');

// minimal PNG decoder (8-bit RGB / RGBA, non-interlaced) -> { w, h, px: Uint32Array }
export function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp;
  const out = new Uint8Array(w * h * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[o++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { const d = (y * w + x) * 4; out[d] = cur[x * bpp]; out[d + 1] = cur[x * bpp + 1]; out[d + 2] = cur[x * bpp + 2]; out[d + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    prev.set(cur);
  }
  return { w, h, px: new Uint32Array(out.buffer) };
}

function loadMenuPackFS() {
  const dir = path.join(ROOT, 'data/sb2/assets/pack');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'menu.json'), 'utf8'));
  const bin = new Uint8Array(fs.readFileSync(path.join(dir, manifest.bin)));
  const blob = (n) => { const e = manifest.blobs[n]; return bin.subarray(e[0], e[0] + e[1]); };
  const mini = decodePNG(fs.readFileSync(path.join(dir, manifest.mini.atlas)));
  return { manifest, blob, mini };
}
function loadSkinFS() {
  const dir = path.join(ROOT, 'public/arcade/sb2/garden');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'garden.json'), 'utf8'));
  return { manifest, bin: new Uint8Array(fs.readFileSync(path.join(dir, manifest.bin))), base: dir + '/' };
}

const mp = loadMenuPackFS();
const sk = loadSkinFS();
const gmini = sk.manifest.menu && sk.manifest.menu.mini ? decodePNG(fs.readFileSync(path.join(sk.base, sk.manifest.menu.mini))) : null;
const gminiOrig = sk.manifest.menu && sk.manifest.menu.miniOrig ? decodePNG(fs.readFileSync(path.join(sk.base, sk.manifest.menu.miniOrig))) : null;
const packs = { classic: mp, garden: skinMenuPack(mp, sk, gmini, gminiOrig) };

for (const skin of ['classic', 'garden']) {
  const set = { players: ['human', 'cpu', 'cpu', 'off'], level: 10, wins: 3, time: 2, gbomber: true, stage: stageNo, layout: 'tall', skin };
  const menu = createMenu(packs[skin], { settings: set, skins: ['garden', 'classic'] });
  const shots = [];
  const run = (n) => { for (let i = 0; i < n; i++) menu.frame(0); return new Uint8Array(menu.out.buffer.slice(0)); };
  menu.show('title'); shots.push(run(40));
  menu.show('mode'); shots.push(run(20));
  menu.show('players'); shots.push(run(20));
  menu.show('rules'); shots.push(run(20));
  menu.show('stage', { row: 2 }); shots.push(run(60));
  set.layout = 'classic'; menu.show('stage', { row: 1 }); shots.push(run(60)); set.layout = 'tall';
  menu.showResults({ wins: [2, 1, 0, 0], winner: 0, figure: null, onDone: () => {} }); shots.push(run(40));
  const W = 256 * shots.length + 6 * (shots.length - 1), H = 455;
  const sheet = new Uint8Array(W * H * 4);
  shots.forEach((px, k) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < 256; x++) {
      const s = (y * 256 + x) * 4, d = (y * W + k * 262 + x) * 4;
      sheet[d] = px[s]; sheet[d + 1] = px[s + 1]; sheet[d + 2] = px[s + 2]; sheet[d + 3] = 255;
    }
  });
  const out = path.join(outDir, `menus_${skin}.png`);
  fs.writeFileSync(out, encodePNG(sheet, W, H, scale));
  console.log(out);
}

// the Arcade shelf cover: the garden title around its logo, lines 72..247 of the tall
// title (176 lines, like the original cover's 0..175), x2 -> public/arcade/sb2/garden/cover.png
if (process.argv.includes('--cover')) {
  const set = { players: ['human', 'cpu', 'cpu', 'cpu'], level: 10, wins: 3, time: 2, gbomber: true, stage: 1, layout: 'tall', skin: 'garden' };
  const menu = createMenu(packs.garden, { settings: set, skins: ['garden', 'classic'] });
  menu.show('title');
  for (let i = 0; i < 40; i++) menu.frame(0);
  const px = new Uint8Array(menu.out.buffer.slice(0));
  const y0 = +arg('cover-y', '72'), H = 176;
  const crop = new Uint8Array(256 * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < 256; x++) {
    const s = ((y0 + y) * 256 + x) * 4, d = (y * 256 + x) * 4;
    crop[d] = px[s]; crop[d + 1] = px[s + 1]; crop[d + 2] = px[s + 2]; crop[d + 3] = 255;
  }
  const out = path.join(ROOT, 'public/arcade/sb2/garden/cover.png');
  fs.writeFileSync(out, encodePNG(crop, 256, H, 2));
  console.log(out);
}

if (process.argv.includes('--go')) {
  const set = { players: ['human', 'cpu', 'cpu', 'cpu'], level: 10, wins: 3, time: 2, gbomber: true, stage: 4, layout: 'tall', skin: 'garden' };
  const menu = createMenu(packs.garden, { settings: set, skins: ['garden', 'classic'], onStart: () => {} });
  const shots = [];
  menu.show('title'); for (let i = 0; i < 10; i++) menu.frame(0);
  menu.press(256);                                   // A on BATTLE GAME: the pod blooms
  for (let i = 0; i < 12; i++) { menu.frame(0); if (i === 3 || i === 9) shots.push(new Uint8Array(menu.out.buffer.slice(0))); }
  menu.show('stage'); for (let i = 0; i < 60; i++) menu.frame(0);
  menu.press(256);                                   // START: the gardeners walk off
  for (let i = 0; i < 100; i++) { menu.frame(0); if (i === 30 || i === 70) shots.push(new Uint8Array(menu.out.buffer.slice(0))); }
  const W = 256 * shots.length + 6 * (shots.length - 1), H = 455, sheet = new Uint8Array(W * H * 4);
  shots.forEach((px, k) => { for (let y = 0; y < H; y++) for (let x = 0; x < 256; x++) { const s2 = (y * 256 + x) * 4, d = (y * W + k * 262 + x) * 4; sheet[d] = px[s2]; sheet[d + 1] = px[s2 + 1]; sheet[d + 2] = px[s2 + 2]; sheet[d + 3] = 255; } });
  fs.writeFileSync(path.join(outDir, 'menus_go.png'), encodePNG(sheet, W, H, scale));
  console.log(path.join(outDir, 'menus_go.png'));
}
