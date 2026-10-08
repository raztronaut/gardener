// Offline evaluation + noise simulation + parameter sweep on the recorded session.
import fs from 'node:fs';
const t = await import('/home/talbot/gardener/public/lib/touch.js');
const c = JSON.parse(fs.readFileSync('/tmp/tt_corners.json'));
const C2S = t.homography(c.cam, c.screen), S2C = t.homography(c.screen, c.cam);
const mask = t.quadMask(S2C);
const N = 640 * 360;
const load = (f) => { const b = fs.readFileSync(f), r = new Float32Array(N), g = new Float32Array(N), bl = new Float32Array(N); for (let i = 0; i < N; i++) { r[i] = b[i * 3]; g[i] = b[i * 3 + 1]; bl[i] = b[i * 3 + 2]; } return { r, g, b: bl }; };
const T = [[0.12,0.08],[0.5,0.08],[0.88,0.08],[0.12,0.5],[0.5,0.5],[0.88,0.5],[0.12,0.92],[0.5,0.92],[0.88,0.92]].map(([x,y])=>[Math.round(x*900),Math.round(y*1600)]);
const REF = load('/tmp/tt_ref_0.rgb');          // the cleanest reference of the session
const frames = T.map((_, k) => load(`/tmp/tt_target_${k}.rgb`));
// deterministic RNG
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const AUG = {
  none: (F) => F,
  exposure_dark: (F) => map(F, (v) => v * 0.8),
  exposure_bright: (F) => map(F, (v) => v * 1.2),
  noise: (F) => map(F, (v) => v + gauss() * 6),
  shadow: (F) => { // a big soft ellipse darkened 45%, colour kept (a body shadow)
    const cx = 380, cy = 230, rx = 170, ry = 120;
    return mapXY(F, (v, x, y) => { const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; return d < 1 ? v * (0.55 + 0.45 * d) : v; });
  },
  glare_dim: (F) => mapXY(F, (v, x, y) => (REFsum(x, y) > 330 ? v * 0.7 : v)),
  shake: (F) => shift(F, 1, 1),
};
function REFsum(x, y) { const i = y * 640 + x; return REF.r[i] + REF.g[i] + REF.b[i]; }
function map(F, f) { const o = { r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) }; for (const ch of ['r', 'g', 'b']) for (let i = 0; i < N; i++) o[ch][i] = clamp(f(F[ch][i])); return o; }
function mapXY(F, f) { const o = { r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) }; for (let i = 0; i < N; i++) { const x = i % 640, y = (i / 640) | 0; for (const ch of ['r', 'g', 'b']) o[ch][i] = clamp(f(F[ch][i], x, y)); } return o; }
function shift(F, dx, dy) { const o = { r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) }; for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) { const sx = Math.min(639, Math.max(0, x - dx)), sy = Math.min(359, Math.max(0, y - dy)); for (const ch of ['r', 'g', 'b']) o[ch][y * 640 + x] = F[ch][sy * 640 + sx]; } return o; }
const augFrames = {}; for (const [a, f] of Object.entries(AUG)) augFrames[a] = frames.map(f);
function score(label) {
  const errs = [], per = {};
  for (const a of Object.keys(AUG)) { per[a] = []; for (let k = 0; k < 9; k++) {
    // the ring at target k is in the frame but not the reference — ignore its disc
    const r = t.detectRGB(augFrames[a][k], REF, mask, C2S, { ignore: [[T[k][0], T[k][1], 30], [T[0][0], T[0][1], 52]] });
    const e = r ? Math.hypot(r.tip[0] - T[k][0], r.tip[1] - T[k][1]) : 999; errs.push(e); per[a].push(Math.round(e)); } }
  errs.sort((p, q) => p - q);
  const hit = errs.filter((e) => e < 90).length / errs.length;
  return { label, median: Math.round(errs[errs.length >> 1]), hit: Math.round(hit * 100), per };
}
const base = { ...t.P };
const results = [];
const grid = { dYin: [24, 34, 44], dcIn: [0.07, 0.1, 0.14], minIn: [40, 80, 160], edge: [12, 22, 40], needOut: [0, 1] };
const keys = Object.keys(grid);
const combos = keys.reduce((acc, k) => acc.flatMap((c) => grid[k].map((v) => ({ ...c, [k]: v }))), [{}]);
const t0 = Date.now();
for (const cmb of combos) { Object.assign(t.P, base, cmb); results.push({ ...score(JSON.stringify(cmb)), cmb }); }
results.sort((a, b) => b.hit - a.hit || a.median - b.median);
console.log(`swept ${combos.length} settings × ${Object.keys(AUG).length} noise conditions × 9 touches in ${Math.round((Date.now() - t0) / 1000)} s`);
Object.assign(t.P, base); const cur = score('current'); console.log('CURRENT', cur.label, 'hit<90px', cur.hit + '%', 'median', cur.median);
for (const r of results.slice(0, 5)) console.log('TOP', 'hit<90px', r.hit + '%', 'median', r.median, r.label);
const best = results[0]; console.log('best per condition (err px per target):'); for (const [a, v] of Object.entries(best.per)) console.log('  ', a.padEnd(16), v.join(' '));
fs.writeFileSync('/tmp/sweep_best.json', JSON.stringify(best.cmb));
