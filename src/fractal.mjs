// The Gardener™ — fractal art: a raymarched 3D fractal still, regenerated every
// 3 hours. Rendered on the BACKEND in a worker thread (the kiosk has no GPU and a
// browser raymarch would freeze the wall), encoded to PNG with node:zlib (no deps),
// and served to the "Fractal" widget at GET /api/fractal(.png).
//
// Each 3-hour slot is a deterministic seed → fractal family (Mandelbulb, Mandelbox,
// quaternion Julia, Menger sponge) + its parameters, camera orbit, light and a
// palette drawn from the wall's own colours. Same slot ⇒ same picture.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { deflateSync } from 'node:zlib';
import { writeFileSync, renameSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SLOT_MS = 3 * 60 * 60 * 1000;
export const W = 900, H = 700;
export const slotOf = (t = Date.now()) => Math.floor(t / SLOT_MS);

// ---- tiny vec3 helpers (plain arrays; hot loops inline the maths) ------------
const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
// ACES filmic tone curve → sRGB gamma.
const aces = (c) => { const v = Math.max(0, (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)); return Math.pow(Math.min(1, v), 1 / 2.2); };

// Deterministic PRNG (mulberry32) from the slot number.
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Palettes from the wall's colours (dark ground → mint / teal / violet / gold / rose).
const PALETTES = [
  { name: 'Aurora', a: [0.02, 0.18, 0.16], b: [0.20, 0.90, 0.55], c: [0.55, 0.30, 1.00] },
  { name: 'Lagoon', a: [0.01, 0.08, 0.16], b: [0.05, 0.75, 0.70], c: [0.55, 0.85, 1.00] },
  { name: 'Ember', a: [0.14, 0.03, 0.02], b: [1.00, 0.62, 0.18], c: [1.00, 0.25, 0.45] },
  { name: 'Orchid', a: [0.08, 0.02, 0.16], b: [0.55, 0.30, 1.00], c: [1.00, 0.55, 0.80] },
  { name: 'Moss', a: [0.02, 0.10, 0.04], b: [0.30, 0.90, 0.40], c: [1.00, 0.80, 0.30] },
];

// Fractal families: distance estimator + orbit trap + framing.
function makeScene(seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const fam = ['bulb', 'bulb', 'julia', 'box', 'menger'][seed % 5];
  const pal = PALETTES[Math.floor(r() * PALETTES.length) % PALETTES.length];
  let de, dist, name, fov = 0.9, maxIt;
  if (fam === 'bulb') {
    const power = pick([3, 4, 5, 6, 7, 8, 8, 9]);
    maxIt = 10;
    name = `Mandelbulb · power ${power}`;
    dist = 1.75 + r() * 0.45;
    de = (px, py, pz, out) => {
      let x = px, y = py, z = pz, dr = 1, rr = 0, trap = 1e9;
      for (let i = 0; i < maxIt; i++) {
        rr = len(x, y, z);
        if (rr > 2) break;
        const th = Math.acos(Math.max(-1, Math.min(1, z / rr))) * power;
        const ph = Math.atan2(y, x) * power;
        const zr = rr ** power;
        dr = rr ** (power - 1) * power * dr + 1;
        const st = Math.sin(th);
        x = zr * st * Math.cos(ph) + px; y = zr * st * Math.sin(ph) + py; z = zr * Math.cos(th) + pz;
        trap = Math.min(trap, x * x + y * y + z * z);
      }
      out[0] = trap;
      return 0.5 * Math.log(rr) * rr / dr;
    };
  } else if (fam === 'julia') {
    const c = [-0.2 + r() * -0.25, 0.6 + r() * 0.25, 0.2 * (r() - 0.5), 0.15 * (r() - 0.5)];
    maxIt = 11;
    name = 'Quaternion Julia';
    dist = 1.9 + r() * 0.4;
    de = (px, py, pz, out) => {
      let a = px, b = py, cc = pz, d = 0, da = 1, db = 0, dc = 0, dd = 0, trap = 1e9, m2 = 0;
      for (let i = 0; i < maxIt; i++) {
        // dz = 2 z dz
        const na = 2 * (a * da - b * db - cc * dc - d * dd), nb = 2 * (a * db + b * da + cc * dd - d * dc);
        const nc = 2 * (a * dc - b * dd + cc * da + d * db), nd = 2 * (a * dd + b * dc - cc * db + d * da);
        da = na; db = nb; dc = nc; dd = nd;
        // z = z² + c
        const za = a * a - b * b - cc * cc - d * d + c[0], zb = 2 * a * b + c[1], zc = 2 * a * cc + c[2], zd = 2 * a * d + c[3];
        a = za; b = zb; cc = zc; d = zd;
        m2 = a * a + b * b + cc * cc + d * d;
        trap = Math.min(trap, m2);
        if (m2 > 16) break;
      }
      out[0] = trap;
      const mz = Math.sqrt(m2), mdz = Math.sqrt(da * da + db * db + dc * dc + dd * dd) || 1e-9;
      return 0.5 * mz * Math.log(mz) / mdz;
    };
  } else if (fam === 'box') {
    const scale = pick([-1.5, -1.75, -2.0, 2.0, 2.4]);
    maxIt = 11;
    name = `Mandelbox · scale ${scale}`;
    dist = scale < 0 ? 3.4 + r() * 0.8 : 6.2 + r() * 1.0;
    fov = 0.85;
    de = (px, py, pz, out) => {
      let x = px, y = py, z = pz, dr = 1, trap = 1e9;
      for (let i = 0; i < maxIt; i++) {
        x = Math.max(-1, Math.min(1, x)) * 2 - x; y = Math.max(-1, Math.min(1, y)) * 2 - y; z = Math.max(-1, Math.min(1, z)) * 2 - z;
        const r2 = x * x + y * y + z * z;
        if (r2 < 0.25) { x *= 4; y *= 4; z *= 4; dr *= 4; } else if (r2 < 1) { x /= r2; y /= r2; z /= r2; dr /= r2; }
        x = x * scale + px; y = y * scale + py; z = z * scale + pz; dr = dr * Math.abs(scale) + 1;
        trap = Math.min(trap, x * x + y * y + z * z);
      }
      out[0] = Math.sqrt(trap) * 0.25;
      return len(x, y, z) / Math.abs(dr);
    };
  } else {
    maxIt = 5;
    name = 'Menger sponge';
    dist = 2.3 + r() * 0.5;
    de = (px, py, pz, out) => {
      let x = Math.abs(px), y = Math.abs(py), z = Math.abs(pz);
      let d = Math.max(x - 1, y - 1, z - 1), s = 1, trap = 1e9;
      for (let i = 0; i < maxIt; i++) {
        const ax = ((px * s) % 2 + 2) % 2 - 1, ay = ((py * s) % 2 + 2) % 2 - 1, az = ((pz * s) % 2 + 2) % 2 - 1;
        s *= 3;
        const rx = Math.abs(1 - 3 * Math.abs(ax)), ry = Math.abs(1 - 3 * Math.abs(ay)), rz = Math.abs(1 - 3 * Math.abs(az));
        const da = Math.max(rx, ry), db = Math.max(ry, rz), dc = Math.max(rz, rx);
        const c = (Math.min(da, db, dc) - 1) / s;
        if (c > d) { d = c; trap = Math.min(trap, i / maxIt); }
      }
      out[0] = trap + 0.2 * len(px, py, pz);
      return d;
    };
  }
  // Camera on a sphere around the origin, light from upper-left of the camera.
  const yaw = r() * Math.PI * 2, pitch = 0.15 + r() * 0.6;
  const cam = [dist * Math.cos(pitch) * Math.cos(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.sin(yaw)];
  const hue = r();
  return { fam, name, pal, de, cam, fov, hue, palName: pal.name };
}

// Render the scene into an RGBA buffer (rows [y0, y1) only — lets workers split it).
function renderRows(seed, w, h, y0, y1) {
  const S = makeScene(seed);
  const { de, cam, fov, pal } = S;
  // camera basis (look at origin, world up y)
  let fx = -cam[0], fy = -cam[1], fz = -cam[2];
  let fl = len(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = fz, ry = 0, rz = -fx; let rl = len(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl; // right = f × up
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  // light direction (camera-relative upper-left-front)
  let lx = -rx * 0.6 + ux * 0.8 - fx * 0.4, ly = -ry * 0.6 + uy * 0.8 - fy * 0.4, lz = -rz * 0.6 + uz * 0.8 - fz * 0.4;
  const ll = len(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  const out = new Uint8ClampedArray(w * (y1 - y0) * 4);
  const tr = [0];
  const MAXD = len(cam[0], cam[1], cam[2]) + 4, STEPS = 150;
  const pix = (fov * 2) / h; // angular size of a pixel → cone-scaled epsilon
  const mix = (a, b, t) => a + (b - a) * t;
  for (let py = y0; py < y1; py++) {
    for (let px = 0; px < w; px++) {
      const sx = ((px + 0.5) / w * 2 - 1) * (w / h) * fov, sy = (1 - (py + 0.5) / h * 2) * fov;
      let dx = fx + rx * sx + ux * sy, dy = fy + ry * sx + uy * sy, dz = fz + rz * sx + uz * sy;
      const dl = len(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      let t = 0, hit = false, steps = 0, x = 0, y = 0, z = 0, dd = 0;
      for (; steps < STEPS; steps++) {
        x = cam[0] + dx * t; y = cam[1] + dy * t; z = cam[2] + dz * t;
        dd = de(x, y, z, tr);
        const eps = Math.max(0.0004, t * pix * 0.6);
        if (dd < eps) { hit = true; break; }
        t += dd * 0.9;
        if (t > MAXD) break;
      }
      // background: the wall's deep green, a soft vertical glow and vignette
      const vy = py / h, vx = px / w;
      const vig = 1 - 0.55 * ((vx - 0.5) ** 2 + (vy - 0.5) ** 2) * 2;
      // Fully transparent background — no halo, no haze: only the fractal itself.
      let cr = 0, cg = 0, cb = 0, alpha = 0;
      if (hit) {
        const trap = tr[0];
        // normal by central differences
        const e = Math.max(0.0005, t * pix * 0.6), tmp = [0];
        const nx = de(x + e, y, z, tmp) - de(x - e, y, z, tmp);
        const ny = de(x, y + e, z, tmp) - de(x, y - e, z, tmp);
        const nz = de(x, y, z + e, tmp) - de(x, y, z - e, tmp);
        const nl = len(nx, ny, nz) || 1; const Nx = nx / nl, Ny = ny / nl, Nz = nz / nl;
        // ambient occlusion: 5 samples along the normal
        let ao = 0, sc = 1;
        for (let k = 1; k <= 5; k++) { const hh = 0.02 * k * (1 + t * 0.15); ao += (hh - de(x + Nx * hh, y + Ny * hh, z + Nz * hh, tmp)) * sc; sc *= 0.6; }
        ao = Math.max(0, Math.min(1, 1 - ao * 3.2));
        const diff = Math.max(0, Nx * lx + Ny * ly + Nz * lz);
        // Blinn specular
        let hx = lx - dx, hy = ly - dy, hz = lz - dz; const hl = len(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
        const spec = Math.max(0, Nx * hx + Ny * hy + Nz * hz) ** 28;
        const rim = (1 - Math.max(0, -(Nx * dx + Ny * dy + Nz * dz))) ** 3;
        // orbit-trap colour: blend the palette's base → mid → highlight
        const k = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, trap)) * 0.9));
        const t1 = Math.min(1, k * 2), t2 = Math.max(0, k * 2 - 1);
        const br = mix(mix(pal.a[0], pal.b[0], t1), pal.c[0], t2), bg = mix(mix(pal.a[1], pal.b[1], t1), pal.c[1], t2), bb = mix(mix(pal.a[2], pal.b[2], t1), pal.c[2], t2);
        const fill = Math.max(0, -(Nx * lx + Ny * ly + Nz * lz)) * 0.25 + Math.max(0, -Ny) * 0.12;
        const amb = 0.06 + 0.06 * (Ny * 0.5 + 0.5);
        const L = (amb + diff * 1.25) * ao * ao;
        let sr = br * L + pal.c[0] * fill * ao + spec * 0.8 * ao + rim * pal.c[0] * 0.45 * ao;
        let sg = bg * L + pal.c[1] * fill * ao + spec * 0.8 * ao + rim * pal.c[1] * 0.45 * ao;
        let sb = bb * L + pal.c[2] * fill * ao + spec * 0.8 * ao + rim * pal.c[2] * 0.45 * ao;
        // depth fog toward the background
        const fog = Math.min(1, Math.max(0, (t - (MAXD - 4) * 0.55) / (MAXD * 0.6)));
        cr = sr; cg = sg; cb = sb; alpha = 1 - fog * 0.6; // distance fades out, not to a colour
      }
      // tone map + gamma
      const o = ((py - y0) * w + px) * 4;
      out[o] = 255 * aces(cr * 1.4); out[o + 1] = 255 * aces(cg * 1.4); out[o + 2] = 255 * aces(cb * 1.4);
      out[o + 3] = 255 * alpha;
    }
  }
  return out;
}

// ---- minimal PNG encoder (RGBA8, zlib from node) -----------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 8 })), chunk('IEND', Buffer.alloc(0))]);
}

export function sceneInfo(seed) { const s = makeScene(seed); return { name: s.name, palette: s.palName, family: s.fam }; }

// Render a slot using N worker threads (row bands), resolve to a PNG buffer.
export async function renderSlot(seed, { w: ow = W, h: oh = H, threads = 4, ss = 2 } = {}) {
  const self = fileURLToPath(import.meta.url);
  // Supersample: render ss× larger, then box-filter down (smooth fractal edges).
  const w = ow * ss, h = oh * ss;
  const band = Math.ceil(h / threads);
  const parts = await Promise.all(Array.from({ length: threads }, (_, i) => new Promise((resolve, reject) => {
    const y0 = i * band, y1 = Math.min(h, y0 + band);
    const wk = new Worker(self, { workerData: { seed, w, h, y0, y1 }, execArgv: [] });
    wk.once('message', (buf) => resolve({ y0, buf }));
    wk.once('error', reject);
  })));
  const big = new Uint8ClampedArray(w * h * 4);
  for (const p of parts) big.set(new Uint8ClampedArray(p.buf), p.y0 * w * 4);
  if (ss === 1) return encodePNG(w, h, big);
  const rgba = new Uint8ClampedArray(ow * oh * 4), n = ss * ss;
  // Premultiplied average, then un-premultiply (no dark fringes at transparent edges).
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const k = ((y * ss + j) * w + (x * ss + i)) * 4, al = big[k + 3];
      r += big[k] * al; g += big[k + 1] * al; b += big[k + 2] * al; a += al;
    }
    const o = (y * ow + x) * 4;
    if (a > 0) { rgba[o] = r / a; rgba[o + 1] = g / a; rgba[o + 2] = b / a; }
    rgba[o + 3] = a / n;
  }
  return encodePNG(ow, oh, rgba);
}

// Keep <dir>/fractal.png + fractal.json current for this slot. Returns the meta.
let rendering = null;
export function ensureFractal(dir, now = Date.now()) {
  const slot = slotOf(now);
  const metaPath = join(dir, 'fractal.json');
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (meta.slot === slot && existsSync(join(dir, 'fractal.png'))) return Promise.resolve(meta);
  } catch { /* none yet */ }
  if (rendering) return rendering;
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  rendering = renderSlot(slot, { threads: 5 }).then((png) => {
    const tmp = join(dir, 'fractal.png.tmp');
    writeFileSync(tmp, png); renameSync(tmp, join(dir, 'fractal.png'));
    const meta = { slot, ...sceneInfo(slot), generatedAt: Date.now(), nextAt: (slot + 1) * SLOT_MS, renderMs: Date.now() - t0, w: W, h: H };
    writeFileSync(metaPath, JSON.stringify(meta));
    return meta;
  }).finally(() => { rendering = null; });
  return rendering;
}

// Worker entry: render one band and post the pixels back.
if (!isMainThread && workerData && workerData.seed != null) {
  const { seed, w, h, y0, y1 } = workerData;
  const px = renderRows(seed, w, h, y0, y1);
  parentPort.postMessage(px.buffer, [px.buffer]);
}
