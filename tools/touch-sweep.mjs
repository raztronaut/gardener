// Offline evaluation + noise simulation + parameter sweep on the recorded session.
import fs from 'node:fs';
const t = await import('/home/talbot/gardener/public/lib/touch.js');
const c = JSON.parse(fs.readFileSync('/tmp/s3_corners.json'));
const C2S = t.homography(c.cam, c.screen), S2C = t.homography(c.screen, c.cam);
const mask = t.quadMask(S2C);
const N = 640 * 360;
const load = (f) => { const b = fs.readFileSync(f), r = new Float32Array(N), g = new Float32Array(N), bl = new Float32Array(N); for (let i = 0; i < N; i++) { r[i] = b[i * 3]; g[i] = b[i * 3 + 1]; bl[i] = b[i * 3 + 2]; } return { r, g, b: bl }; };
const T = [[0.12,0.08],[0.5,0.08],[0.88,0.08],[0.12,0.5],[0.5,0.5],[0.88,0.5],[0.12,0.92],[0.5,0.92],[0.88,0.92]].map(([x,y])=>[Math.round(x*900),Math.round(y*1600)]);
const REF = load('/tmp/s3_ref_0.rgb'); const REFS = T.map(() => REF);
const frames = T.map((_, k) => load(`/tmp/s3_target_${k}.rgb`));
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
function fitAff(pairs) { const sol = (idx) => { const s2 = [[0,0,0],[0,0,0],[0,0,0]], r2 = [0,0,0]; for (const [[x, y], tt] of pairs) { const v = [x, y, 1]; for (let i = 0; i < 3; i++) { r2[i] += v[i] * tt[idx]; for (let j = 0; j < 3; j++) s2[i][j] += v[i] * v[j]; } } const m = s2.map((row, i) => [...row, r2[i]]); for (let c2 = 0; c2 < 3; c2++) { let p2 = c2; for (let k2 = c2 + 1; k2 < 3; k2++) if (Math.abs(m[k2][c2]) > Math.abs(m[p2][c2])) p2 = k2; [m[c2], m[p2]] = [m[p2], m[c2]]; for (let k2 = 0; k2 < 3; k2++) if (k2 !== c2) { const f = m[k2][c2] / m[c2][c2]; for (let j = c2; j < 4; j++) m[k2][j] -= f * m[c2][j]; } } return m.map((row, i) => row[3] / row[i]); }; return [sol(0), sol(1)]; }
function score(label) {
  const errs = [], per = {}, tips = {};
  for (const a of Object.keys(AUG)) { per[a] = []; for (let k = 0; k < 9; k++) {
    // the ring at target k is in the frame but not the reference — ignore its disc
    const r = t.detectRGB(augFrames[a][k], REFS[k], mask, C2S);
    tips[a] = tips[a] || []; tips[a][k] = r ? r.tip : null;
    const e = r ? Math.hypot(r.tip[0] - T[k][0], r.tip[1] - T[k][1]) : 999; errs.push(e); per[a].push(Math.round(e)); } }
  // leave-one-out affine correction (fit on the other targets' detections in the
  // SAME condition, apply to the held-out one) — the honest post-calibration error
  const loo = [];
  for (const a of Object.keys(AUG)) for (let k = 0; k < 9; k++) {
    const tr = tips[a].map((tp, j) => (j !== k && tp ? [tp, T[j]] : null)).filter(Boolean);
    if (!tips[a][k] || tr.length < 4) { loo.push(999); continue; }
    const A = fitAff(tr); const [x, y] = tips[a][k];
    loo.push(Math.hypot(A[0][0] * x + A[0][1] * y + A[0][2] - T[k][0], A[1][0] * x + A[1][1] * y + A[1][2] - T[k][1]));
  }
  loo.sort((p, q) => p - q);
  errs.sort((p, q) => p - q);
  const hit = errs.filter((e) => e < 90).length / errs.length;
  return { label, median: Math.round(errs[errs.length >> 1]), hit: Math.round(hit * 100), per, looMedian: Math.round(loo[loo.length >> 1]), looHit: Math.round(loo.filter((e) => e < 60).length / loo.length * 100) };
}
const base = { ...t.P };
const results = [];
const grid = { skinW: [2, 4, 6, 8], chg: [26, 34, 44, 56], yMin: [4, 8], minIn: [12, 20, 30], edge: [6, 12] };
const keys = Object.keys(grid);
const combos = keys.reduce((acc, k) => acc.flatMap((c) => grid[k].map((v) => ({ ...c, [k]: v }))), [{}]);
const t0 = Date.now();
for (const cmb of combos) { Object.assign(t.P, base, { open: 0, notRefSkin: 1 }, cmb); results.push({ ...score(JSON.stringify(cmb)), cmb }); }
results.sort((a, b) => b.looHit - a.looHit || a.looMedian - b.looMedian);
console.log(`swept ${combos.length} settings × ${Object.keys(AUG).length} noise conditions × 9 touches in ${Math.round((Date.now() - t0) / 1000)} s`);
Object.assign(t.P, base); const cur = score('current'); console.log('CURRENT', cur.label, 'hit<90px', cur.hit + '%', 'median', cur.median, '| corrected (leave-one-out): median', cur.looMedian, 'px, <60px', cur.looHit + '%');
for (const r of results.slice(0, 5)) console.log('TOP', 'hit<90px', r.hit + '%', 'median', r.median, '| corrected LOO median', r.looMedian, '<60px', r.looHit + '%', r.label);
const best = results[0]; console.log('best per condition (err px per target):'); for (const [a, v] of Object.entries(best.per)) console.log('  ', a.padEnd(16), v.join(' '));
fs.writeFileSync('/tmp/sweep_best.json', JSON.stringify(best.cmb));
