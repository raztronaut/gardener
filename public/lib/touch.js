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
// on-screen live preview rect (screen px) — excluded from detection
const FEED = [210, 928, 690, 1198];
const MARK = [[60, 60], [W - 60, 60], [W - 60, H - 60], [60, H - 60]];
const TARGETS = [[0.12, 0.08], [0.5, 0.08], [0.88, 0.08], [0.12, 0.5], [0.5, 0.5], [0.88, 0.5], [0.12, 0.92], [0.5, 0.92], [0.88, 0.92]]
  .map(([x, y]) => [Math.round(x * W), Math.round(y * H)]);
let LAST_CAL = null; // previous calibration's camera→screen map (masks the live preview)
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
// Wait until the camera's auto-exposure has settled (frame mean stable ±2% for
// ~0.6 s, at least 1.5 s after opening) — a baseline taken mid-ramp is too dark.
async function settle(maxMs = 6000) {
  const t0 = performance.now(); const hist = [];
  while (performance.now() - t0 < maxMs) {
    const g = grab(); let m = 0; for (let i = 0; i < g.length; i += 13) m += g[i]; m /= g.length / 13;
    hist.push(m); if (hist.length > 18) hist.shift();
    if (performance.now() - t0 > 1500 && hist.length >= 18 && Math.max(...hist) - Math.min(...hist) < Math.max(2, m * 0.02)) return;
    await sleep(33);
  }
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
// Each marker BLINKS (on/off × CYCLES); a pixel counts only if it's brighter in every
// "on" frame than in the "off" frames around it — slow exposure / white-balance
// drift and anything moving outside the screen cancel out. The candidate region is
// limited to where the screen is (dark while the stage is black, vs. the lit room).
const CYCLES = 2;
// The screen's display pipeline delays changes by 0.2–1.0 s (jittery; the camera
// itself adds only ~20 ms), so fixed waits miss. Instead WATCH the camera: after
// showing a marker, grab frames until a bright blob has appeared in the screen
// region (vs. the black baseline); after hiding it, until it's gone.
// 4×4 block-averaged positive difference (160×90): a solid marker survives, the
// camera's rolling refresh bands / sensor noise (thin, sparse) are averaged away.
const BW = PW / 4, BH = PH / 4;
function blockDiff(a, b, region) {
  const out = new Float32Array(BW * BH);
  for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
    let sum = 0, n = 0;
    for (let y = by * 4; y < by * 4 + 4; y++) for (let x = bx * 4; x < bx * 4 + 4; x++) { const i = y * PW + x; if (region[i]) { sum += a[i] - b[i]; n++; } }
    out[by * BW + bx] = n ? sum / n : 0;
  }
  return out;
}
async function waitFor(base, region, appear, timeout = 2500) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const bd = blockDiff(grab(), base, region); let m = 0;
    for (const v of bd) if (v > m) m = v;
    if (appear ? m > 90 : m < 40) { await sleep(150); return true; }
    await sleep(33);
  }
  return false;
}
async function blinkDiff(x, y, base, region) {
  const acc = new Float32Array(PW * PH).fill(Infinity);
  for (let c = 0; c < CYCLES; c++) {
    const d = dot(x, y, 'mark', 54);
    const seen = await waitFor(base, region, true);
    const on = await grabAvg(3); d.remove();
    await waitFor(base, region, false);
    const off = await grabAvg(3);
    if (!seen) continue; // this cycle never showed the marker — skip it rather than poison the min
    for (let i = 0; i < acc.length; i++) acc[i] = Math.min(acc[i], on[i] - off[i]);
  }
  for (let i = 0; i < acc.length; i++) if (acc[i] === Infinity) acc[i] = 0;
  return acc;
}
function centroid(diff, region) {
  // brightest 4×4 block, then a weighted centroid in a 28 px window around it
  const bd = new Float32Array(BW * BH);
  for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
    let sum = 0; for (let y = by * 4; y < by * 4 + 4; y++) for (let x = bx * 4; x < bx * 4 + 4; x++) { const i = y * PW + x; if (region[i]) sum += diff[i]; }
    bd[by * BW + bx] = sum / 16;
  }
  let mb = 0, at = 0; for (let i = 0; i < bd.length; i++) if (bd[i] > mb) { mb = bd[i]; at = i; }
  if (mb < 40) return null;
  const cx0 = (at % BW) * 4 + 2, cy0 = ((at / BW) | 0) * 4 + 2;
  let max = 0;
  for (let y = Math.max(0, cy0 - 14); y < Math.min(PH, cy0 + 14); y++) for (let x = Math.max(0, cx0 - 14); x < Math.min(PW, cx0 + 14); x++) max = Math.max(max, diff[y * PW + x]);
  let sx = 0, sy = 0, sw = 0; const th = max * 0.5;
  for (let y = Math.max(0, cy0 - 14); y < Math.min(PH, cy0 + 14); y++) for (let x = Math.max(0, cx0 - 14); x < Math.min(PW, cx0 + 14); x++) { const v = diff[y * PW + x]; if (v > th) { sx += x * v; sy += y * v; sw += v; } }
  return sw ? [sx / sw, sy / sw, mb] : null;
}
async function calibrateCorners() {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await calibrateOnce(attempt); } catch (e) { last = e; post({ kind: 'corner-retry', attempt, message: e.message }); }
  }
  throw last;
}
async function calibrateOnce(attempt) {
  msg(attempt === 1 ? 'Calibrating — keep hands away from the screen' : `Calibrating (try ${attempt}) — keep hands away`);
  clearDots(); await settle(); await sleep(300);
  // the screen region: dark (stage is black) in the camera, relative to the room
  const black = await grabAvg(6);
  let sum = 0; for (const v of black) sum += v;
  const mean = sum / black.length;
  const region = new Uint8Array(PW * PH);
  // whole frame except saturated spots (lamps): screen glare made a darkness-based
  // region drop the bottom corners. The appear/disappear handshake handles drift.
  for (let i = 0; i < region.length; i++) region[i] = black[i] < 235 ? 1 : 0;
  // the live preview box changes constantly — exclude where it sits (from the last calibration)
  if (LAST_CAL) { for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const [u, v] = apply(LAST_CAL, x, y); if (u > FEED[0] - 30 && u < FEED[2] + 30 && v > FEED[1] - 30 && v < FEED[3] + 30) region[y * PW + x] = 0; } }
  const cam = [], strength = [];
  let regionFrac = 0; for (const v of region) regionFrac += v; regionFrac /= region.length;
  for (const [x, y] of MARK) {
    const df = await blinkDiff(x, y, black, region);
    let mIn = 0, mAll = 0, at = 0; for (let i = 0; i < df.length; i++) { if (df[i] > mAll) { mAll = df[i]; at = i; } if (region[i] && df[i] > mIn) mIn = df[i]; }
    post({ kind: 'corner-debug', marker: [x, y], maxInRegion: Math.round(mIn), maxAll: Math.round(mAll), maxAt: [at % PW, (at / PW) | 0], regionFrac: Math.round(regionFrac * 100) / 100, mean: Math.round(mean) });
    const c = centroid(df, region);
    if (!c) { post({ kind: 'corner-fail', frame: jpeg() }); throw new Error('a corner marker was not visible to the camera — is the dashboard in front and the whole screen in frame?'); }
    cam.push([c[0], c[1]]); strength.push(Math.round(c[2]));
  }
  // sanity: the 4 points must form a convex quad in the right order (TL,TR,BR,BL clockwise)
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const s0 = Math.sign(cross(cam[0], cam[1], cam[2]));
  const convex = [0, 1, 2, 3].every((k) => Math.sign(cross(cam[k], cam[(k + 1) % 4], cam[(k + 2) % 4])) === s0);
  post({ kind: 'corners', cam, strength, convex, screen: MARK, frame: jpeg() });
  if (!convex) throw new Error('corner markers came out in an impossible order — check the camera framing');
  const C2S = homography(cam, MARK), S2C = homography(MARK, cam);
  return { C2S, S2C, cam };
}

// Corner calibration alone (no human needed): returns the points + saves a frame
// with the detected quad so the mapping can be checked.
export async function testCorners() {
  ui();
  let stream;
  try {
    stream = await startCamera();
    const cal = await calibrateCorners();
    return { ok: true, cam: cal.cam.map((p) => p.map((v) => Math.round(v * 10) / 10)) };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } root.remove(); }
}

// screen-quad mask in camera px (a little inside the edges)
function quadMask(S2C) {
  const m = new Uint8Array(PW * PH), C2S = homography(MARK.map(([x, y]) => apply(S2C, x, y)), MARK);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const [u, v] = apply(C2S, x, y);
    const inFeed = u > FEED[0] - 20 && u < FEED[2] + 20 && v > FEED[1] - 20 && v < FEED[3] + 20; // the on-screen preview changes live — ignore it
    // generous band around the screen — above it most (arms reach down from there)
    if (u > -160 && u < W + 160 && v > -420 && v < H + 60 && !inFeed) m[y * PW + x] = 1;
  }
  return m;
}

// ---- live feed preview (realtime camera + detected screen outline + tip) -----------
let feedTip = null, feedCal = null;
function showFeed(cal) {
  feedCal = cal;
  if (root.querySelector('.tc-feed')) return;
  const box = document.createElement('div'); box.className = 'tc-feed';
  video.className = 'tc-video'; box.appendChild(video);
  const ov = document.createElement('canvas'); ov.width = PW; ov.height = PH; ov.className = 'tc-ov'; box.appendChild(ov);
  root.appendChild(box);
  const g = ov.getContext('2d');
  const draw = () => {
    if (!box.isConnected) return;
    g.clearRect(0, 0, PW, PH);
    if (feedCal) {
      const quad = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => apply(feedCal.S2C, x, y));
      g.strokeStyle = '#74f7b0'; g.lineWidth = 2; g.beginPath(); quad.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
      if (feedTip) { const [x, y] = apply(feedCal.S2C, feedTip[0], feedTip[1]); g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    }
    requestAnimationFrame(draw);
  };
  draw();
}

// ---- 2. foreground blob + tip -----------------------------------------------------
let inScreen = null; // camera px inside the screen rectangle (built once per calibration)
function detect(frame, ref, mask, C2S) {
  if (!inScreen) { inScreen = new Uint8Array(PW * PH); for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const [u, v] = apply(C2S, x, y); if (u >= 0 && u <= W && v >= 0 && v <= H) inScreen[y * PW + x] = 1; } }
  const fg = new Uint8Array(PW * PH);
  // global brightness drift (auto-exposure) compensation: median-ish mean ratio
  let a = 0, b = 0; for (let i = 0; i < frame.length; i += 7) if (mask[i]) { a += frame[i]; b += ref[i]; }
  const gain = b > 0 ? a / b : 1;
  // saturated spots (lamp glare) carry no information — skip them
  // Shadows only DARKEN. On the (dark) screen a lit hand is BRIGHTER than the
  // reference, so inside the screen only positive changes count — the user's shadow
  // can't make a blob there. Outside (arm against the bright wall) darker counts too.
  for (let i = 0; i < fg.length; i++) {
    if (!mask[i] || ref[i] >= 225) continue;
    const d = frame[i] - ref[i] * gain;
    if (inScreen[i] ? d > 28 : Math.abs(d) > 32) fg[i] = 1;
  }
  // the biggest 4-connected blob that ENTERS FROM OUTSIDE the screen (an arm/hand
  // does; screen glare and refresh noise stay inside) and also reaches inside it
  const lab = new Int32Array(PW * PH); let best = 0, bestN = 0, cur = 0; const st = [];
  for (let s = 0; s < fg.length; s++) {
    if (!fg[s] || lab[s]) continue; cur++; let n = 0, out = 0, inn = 0; st.push(s); lab[s] = cur;
    while (st.length) { const p = st.pop(); n++; const x = p % PW, y = (p / PW) | 0;
      const [u, v] = apply(C2S, x, y); if (u < 0 || u > W || v < 0 || v > H) out++; else inn++;
      for (const q of [x > 0 ? p - 1 : -1, x < PW - 1 ? p + 1 : -1, y > 0 ? p - PW : -1, y < PH - 1 ? p + PW : -1])
        if (q >= 0 && fg[q] && !lab[q]) { lab[q] = cur; st.push(q); } }
    if (out >= 8 && inn >= 8 && n > bestN) { bestN = n; best = cur; }
  }
  if (bestN < 60) return null;
  // entry = centroid of blob pixels at the screen boundary (or the blob end lowest on screen)
  let ex = 0, ey = 0, en = 0; const pts = [];
  for (let p = 0; p < lab.length; p++) if (lab[p] === best) {
    const [u, v] = apply(C2S, p % PW, (p / PW) | 0); pts.push([u, v]);
    if (u < 0 || u > W || v < 0 || v > H) { ex += u; ey += v; en++; } // the part outside = where the arm comes from
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
    await sleep(1100); // > the display delay, so the reference shows this ring
    const ref = await grabAvg(5);
    post({ kind: 'ref', k, frame: jpeg() }); // the clean reference (for offline analysis)
    ring.classList.remove('wait');
    msg(`Target ${k + 1} of 9 — touch the circle and hold`);
    const tipEl = document.createElement('div'); tipEl.className = 'tc-tip'; root.appendChild(tipEl);
    const hist = []; const samples = []; let done = null; const t0 = performance.now();
    while (!done && performance.now() - t0 < 20000) {
      const f = grab(); const r = detect(f, ref, mask, cal.C2S); const now = performance.now();
      feedTip = r ? r.tip : null;
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
    try { const prev = await (await fetch('/api/touch/calibration')).json(); if (prev && prev.C2S) LAST_CAL = prev.C2S; } catch { /* first time */ }
    showFeed(null); // live camera view from the start (dimmed while corners blink)
    root.classList.add('cal-phase');
    const cal = await calibrateCorners();
    root.classList.remove('cal-phase');
    inScreen = null;
    fetch('/api/touch/calibration', { method: 'POST', body: JSON.stringify({ at: Date.now(), C2S: cal.C2S, corners: cal.cam, partial: true }) }).catch(() => {});
    const mask = quadMask(cal.S2C);
    showFeed(cal); // live camera view (with the screen outline) during the targets
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
