#!/usr/bin/env node
// Port side of the visual conformance (visual.py): replays a vector through the JS core
// (run.mjs runVector) and the renderer (public/arcade/sb2/render/), and writes the
// rendered original-layout frame (256x224 RGBA, raw) after the tick that completed in
// each requested vector frame.
//
//   node tools/sb2/conformance/visual_render.mjs <vector> <outdir> <frame> [<frame> ...]
//   node tools/sb2/conformance/visual_render.mjs --ticks <vector>   # frame,tick list (JSON)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVector } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const R = path.join(ROOT, 'public', 'arcade', 'sb2', 'render');
const { makePack } = await import(path.join(R, 'pack.js'));
const { createDisplay } = await import(path.join(R, 'display.js'));

export function loadPackSync() {
  const dir = path.join(ROOT, 'data', 'sb2', 'assets', 'pack');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
  return makePack(manifest, new Uint8Array(fs.readFileSync(path.join(dir, manifest.bin))));
}

function main() {
  const a = process.argv.slice(2);
  if (a[0] === '--ticks') {
    const list = [];
    runVector(a[1], { max: 1e9, onTick: ({ i, t }) => list.push([i, t.tick]) });
    process.stdout.write(JSON.stringify(list));
    return;
  }
  const [name, outdir, ...fr] = a;
  const want = new Set(fr.map(Number));
  fs.mkdirSync(outdir, { recursive: true });
  const pack = loadPackSync();
  let disp = null;
  const t0 = process.hrtime.bigint();
  let ticks = 0, renderNs = 0n, frameNs = 0n;
  const r = runVector(name, {
    max: 1e9,
    onTick: ({ i, game }) => {
      if (!disp) { disp = createDisplay(pack, { layout: 'original' }); disp.ppu.state.snes9x565 = !process.env.SB2_HW_BLEND; }
      const a0 = process.hrtime.bigint();
      disp.frame(game, game.events);
      const a1 = process.hrtime.bigint();
      frameNs += a1 - a0;
      ticks++;
      if (want.has(i)) {
        const b0 = process.hrtime.bigint();
        const out = disp.render();
        renderNs += process.hrtime.bigint() - b0;
        fs.writeFileSync(path.join(outdir, `port_${i}.rgba`), Buffer.from(out.buffer, out.byteOffset, out.byteLength));
      }
    },
  });
  const total = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stdout.write(JSON.stringify({ ok: r.ok, ticks, first: r.first, ms: total,
    frameMsPerTick: Number(frameNs) / 1e6 / Math.max(1, ticks), renderMs: Number(renderNs) / 1e6 / Math.max(1, want.size) }) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
