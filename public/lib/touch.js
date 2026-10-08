// The Gardener™ — camera touch calibration session (/touch).
//
// A webcam looks at the (vertical) wall from below. Like the classic single-webcam
// "any screen → touchscreen" projects: (1) a homography maps the camera image to
// screen pixels, learned from 4 corner markers flashed one at a time; (2) a hand /
// finger is found as whatever DIFFERS from a clean reference frame of the same
// screen; (3) the touch point is the blob's far tip (the end away from where the arm
// enters). A touch = the tip holding still ~0.6 s. The 9-target session records
// detected tip vs. true target for each point (+ camera frames) to the server so the
// error field and touch-vs-hover behaviour can be measured and corrected.

const W = 900, H = 1600;           // screen (kiosk window) px
const PW = 640, PH = 360;          // processing resolution (camera downscaled)
const MARK = [[60, 60], [W - 60, 60], [W - 60, H - 60], [60, H - 60]];
const TARGETS = [[0.12, 0.08], [0.5, 0.08], [0.88, 0.08], [0.12, 0.5], [0.5, 0.5], [0.88, 0.5], [0.12, 0.92], [0.5, 0.92], [0.88, 0.92]]
  .map(([x, y]) => [Math.round(x * W), Math.round(y * H)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (body) => fetch('/api/touch/log', { method: 'POST', body: JSON.stringify(body) }).catch(() => {});

// ---- homography (4-point DLT, solved with Gaussian elimination) ---------------
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const hh = b.map((v, i) => v / A[i][i]);
  return [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1];
}
export const apply = (Hm, x, y) => { const w = Hm[6] * x + Hm[7] * y + Hm[8]; return [(Hm[0] * x + Hm[1] * y + Hm[2]) / w, (Hm[3] * x + Hm[4] * y + Hm[5]) / w]; };

// ---- camera frames -------------------------------------------------------------
let video, cv, cx;
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
  video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();
  cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
  cx = cv.getContext('2d', { willReadFrequently: true });
  return stream;
}
function grab() { // grayscale Float32 at PW×PH
  cx.drawImage(video, 0, 0, PW, PH);
  const d = cx.getImageData(0, 0, PW, PH).data, g = new Float32Array(PW * PH);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}
async function grabAvg(n = 4) { const acc = new Float32Array(PW * PH); for (let k = 0; k < n; k++) { const g = grab(); for (let i = 0; i < acc.length; i++) acc[i] += g[i] / n; await sleep(40); } return acc; }
function jpeg() { const c = document.createElement('canvas'); c.width = 960; c.height = 540; c.getContext('2d').drawImage(video, 0, 0, 960, 540); return c.toDataURL('image/jpeg', 0.8); }

// ---- UI ---------------------------------------------------------------------------
let root;
function ui() {
  root = document.createElement('div');
  root.id = 'touchcal';
  root.innerHTML = '<div class="tc-msg"></div>';
  document.body.appendChild(root);
}
const msg = (t) => { root.querySelector('.tc-msg').innerHTML = t; };
function dot(x, y, cls, r = 40) {
  const d = document.createElement('div'); d.className = `tc-dot ${cls || ''}`;
  d.style.cssText = `left:${x - r}px;top:${y - r}px;width:${2 * r}px;height:${2 * r}px`;
  root.appendChild(d); return d;
}
const clearDots = () => root.querySelectorAll('.tc-dot,.tc-tip').forEach((e) => e.remove());

// ---- 1. corner calibration ------------------------------------------------------
async function calibrateCorners() {
  msg('Calibrating — keep hands away from the screen');
  clearDots(); await sleep(900);
  const black = await grabAvg(6);
  const cam = [];
  for (const [x, y] of MARK) {
    const d = dot(x, y, 'mark', 46); await sleep(500);
    const lit = await grabAvg(4); d.remove();
    let max = 0; const diff = new Float32Array(PW * PH);
    for (let i = 0; i < diff.length; i++) { diff[i] = Math.max(0, lit[i] - black[i]); if (diff[i] > max) max = diff[i]; }
    if (max < 25) throw new Error('marker not visible to the camera — is the dashboard in front and the camera aimed at the screen?');
    let sx = 0, sy = 0, sw = 0; const th = max * 0.5;
    for (let yy = 0; yy < PH; yy++) for (let xx = 0; xx < PW; xx++) { const v = diff[yy * PW + xx]; if (v > th) { sx += xx * v; sy += yy * v; sw += v; } }
    cam.push([sx / sw, sy / sw]);
    await sleep(150);
  }
  const C2S = homography(cam, MARK), S2C = homography(MARK, cam);
  post({ kind: 'corners', cam, screen: MARK, C2S, frame: jpeg() });
  return { C2S, S2C, cam };
}

// screen-quad mask in camera px (a little inside the edges)
function quadMask(S2C) {
  const m = new Uint8Array(PW * PH), C2S = homography(MARK.map(([x, y]) => apply(S2C, x, y)), MARK);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const [u, v] = apply(C2S, x, y); if (u > -40 && u < W + 40 && v > -40 && v < H + 40) m[y * PW + x] = 1; }
  return m;
}

// ---- 2. foreground blob + tip -----------------------------------------------------
function detect(frame, ref, mask, C2S) {
  const fg = new Uint8Array(PW * PH);
  // global brightness drift (auto-exposure) compensation: median-ish mean ratio
  let a = 0, b = 0; for (let i = 0; i < frame.length; i += 7) if (mask[i]) { a += frame[i]; b += ref[i]; }
  const gain = b > 0 ? a / b : 1;
  for (let i = 0; i < fg.length; i++) if (mask[i] && Math.abs(frame[i] - ref[i] * gain) > 32) fg[i] = 1;
  // keep the biggest 4-connected blob
  const lab = new Int32Array(PW * PH); let best = 0, bestN = 0, cur = 0; const st = [];
  for (let s = 0; s < fg.length; s++) {
    if (!fg[s] || lab[s]) continue; cur++; let n = 0; st.push(s); lab[s] = cur;
    while (st.length) { const p = st.pop(); n++; const x = p % PW, y = (p / PW) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < PW - 1 ? p + 1 : -1, y > 0 ? p - PW : -1, y < PH - 1 ? p + PW : -1])
        if (q >= 0 && fg[q] && !lab[q]) { lab[q] = cur; st.push(q); } }
    if (n > bestN) { bestN = n; best = cur; }
  }
  if (bestN < 60) return null;
  // entry = centroid of blob pixels at the screen boundary (or the blob end lowest on screen)
  let ex = 0, ey = 0, en = 0; const pts = [];
  for (let p = 0; p < lab.length; p++) if (lab[p] === best) {
    const [u, v] = apply(C2S, p % PW, (p / PW) | 0); pts.push([u, v]);
    if (u < 10 || u > W - 10 || v < 10 || v > H - 10) { ex += u; ey += v; en++; }
  }
  if (en) { ex /= en; ey /= en; } else { ex = W / 2; ey = H + 200; }
  let tip = null, far = -1;
  for (const [u, v] of pts) { if (u < 0 || u > W || v < 0 || v > H) continue; const d = (u - ex) ** 2 + (v - ey) ** 2; if (d > far) { far = d; tip = [u, v]; } }
  return tip ? { tip, area: bestN, entry: [ex, ey] } : null;
}

// ---- 3. the 9-target session --------------------------------------------------------
async function targetRun(cal, mask) {
  const results = [];
  for (let k = 0; k < TARGETS.length; k++) {
    const [tx, ty] = TARGETS[k];
    clearDots();
    const ring = dot(tx, ty, 'target wait', 44);
    msg(`Target ${k + 1} of 9 — hands away…`);
    await sleep(700);
    const ref = await grabAvg(5);
    ring.classList.remove('wait');
    msg(`Target ${k + 1} of 9 — touch the circle and hold`);
    const tipEl = document.createElement('div'); tipEl.className = 'tc-tip'; root.appendChild(tipEl);
    const hist = []; const samples = []; let done = null; const t0 = performance.now();
    while (!done && performance.now() - t0 < 20000) {
      const f = grab(); const r = detect(f, ref, mask, cal.C2S); const now = performance.now();
      if (r) {
        tipEl.style.display = 'block'; tipEl.style.left = `${r.tip[0] - 10}px`; tipEl.style.top = `${r.tip[1] - 10}px`;
        hist.push({ t: now, p: r.tip }); samples.push({ t: Math.round(now - t0), tip: r.tip.map(Math.round), area: r.area });
        while (hist.length && now - hist[0].t > 600) hist.shift();
        if (hist.length > 6 && now - hist[0].t > 550) {
          const xs = hist.map((h) => h.p[0]), ys = hist.map((h) => h.p[1]);
          if (Math.max(...xs) - Math.min(...xs) < 18 && Math.max(...ys) - Math.min(...ys) < 26) {
            done = { tip: [xs.reduce((a, b) => a + b) / xs.length, ys.reduce((a, b) => a + b) / ys.length], area: r.area };
          }
        }
      } else { tipEl.style.display = 'none'; hist.length = 0; }
      await sleep(30);
    }
    ring.classList.add(done ? 'ok' : 'miss');
    const err = done ? [done.tip[0] - tx, done.tip[1] - ty] : null;
    results.push({ target: [tx, ty], tip: done && done.tip.map(Math.round), err: err && err.map(Math.round), area: done && done.area });
    post({ kind: 'target', k, target: [tx, ty], result: results[k], samples: samples.slice(-150), frame: jpeg() });
    await sleep(500);
  }
  return results;
}

// ---- correction: least-squares affine on the residuals (screen → screen) -----------
function fitAffine(pairs) { // pairs: [[detX,detY],[trueX,trueY]] — solve true = A·[x,y,1]
  const solve = (idx) => {
    let s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
    for (const [[x, y], t] of pairs) { const v = [x, y, 1]; for (let i = 0; i < 3; i++) { r[i] += v[i] * t[idx]; for (let j = 0; j < 3; j++) s[i][j] += v[i] * v[j]; } }
    // 3×3 solve
    const m = s.map((row, i) => [...row, r[i]]);
    for (let c = 0; c < 3; c++) { let p = c; for (let k = c + 1; k < 3; k++) if (Math.abs(m[k][c]) > Math.abs(m[p][c])) p = k; [m[c], m[p]] = [m[p], m[c]];
      for (let k = 0; k < 3; k++) if (k !== c) { const f = m[k][c] / m[c][c]; for (let j = c; j < 4; j++) m[k][j] -= f * m[c][j]; } }
    return m.map((row, i) => row[3] / row[i]);
  };
  return [solve(0), solve(1)];
}

export async function runSession() {
  if (document.getElementById('touchcal')) return;
  ui();
  let stream = null;
  const stop = () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); stop(); } };
  window.addEventListener('keydown', onKey, true);
  try {
    msg('Starting the camera…');
    stream = await startCamera();
    const s = stream.getVideoTracks()[0].getSettings();
    post({ kind: 'start', camera: `${s.width}x${s.height}@${Math.round(s.frameRate || 0)}`, screen: [W, H] });
    const cal = await calibrateCorners();
    const mask = quadMask(cal.S2C);
    const results = await targetRun(cal, mask);
    const ok = results.filter((r) => r.tip);
    const errs = ok.map((r) => Math.hypot(r.err[0], r.err[1]));
    const mean = errs.length ? errs.reduce((a, b) => a + b) / errs.length : null;
    const corr = ok.length >= 4 ? fitAffine(ok.map((r) => [r.tip, r.target])) : null;
    let after = null;
    if (corr) { const e2 = ok.map((r) => { const [x, y] = r.tip; return Math.hypot(corr[0][0] * x + corr[0][1] * y + corr[0][2] - r.target[0], corr[1][0] * x + corr[1][1] * y + corr[1][2] - r.target[1]); }); after = e2.reduce((a, b) => a + b) / e2.length; }
    try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } // camera off
    const calibration = { at: Date.now(), C2S: cal.C2S, corners: cal.cam, correction: corr, results, meanErr: mean, meanErrCorrected: after };
    await fetch('/api/touch/calibration', { method: 'POST', body: JSON.stringify(calibration) });
    post({ kind: 'end', meanErr: mean, meanErrCorrected: after, hits: ok.length });
    clearDots();
    results.forEach((r) => { const d = dot(r.target[0], r.target[1], r.tip ? 'ok' : 'miss', 30); if (r.tip) { const t = document.createElement('div'); t.className = 'tc-tip'; t.style.cssText = `display:block;left:${r.tip[0] - 10}px;top:${r.tip[1] - 10}px`; root.appendChild(t); } });
    msg(`Done — ${ok.length}/9 touches detected · average error ${mean ? Math.round(mean) : '—'} px${after != null ? ` → ${Math.round(after)} px after correction` : ''}<br><small>Esc to close</small>`);
  } catch (e) {
    msg(`Calibration stopped: ${e.message}<br><small>Esc to close</small>`);
    post({ kind: 'error', message: String(e.message || e) });
  }
}
