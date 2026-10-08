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
export function quadMask(S2C) {
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
// ---- 2. hand segmentation (background subtraction, shadow-aware) -----------------
// What the camera-touchscreen literature + OpenCV's MOG2 do, adapted to a fixed scene:
//  • compare against a CLEAN reference of the same screen (verified hand-free);
//  • compensate global auto-exposure gain;
//  • reject SHADOWS by chromaticity: a shadow darkens a surface but keeps its colour
//    (rg-chromaticity ≈ same, brightness ratio 0.35–0.97); a hand changes colour;
//  • inside the (dark) screen a lit hand is BRIGHTER — darker-only changes there are
//    shadows/reflections; outside (arm over the bright wall) either way counts;
//  • morphological opening (3×3 erode → dilate) removes thin noise: bezel-edge
//    shimmer, refresh bands, single-pixel flicker;
//  • keep the biggest blob that ENTERS FROM OUTSIDE the screen and reaches inside;
//    the touch point is the inside end of it farthest from where it enters.
function grabRGB() {
  cx.drawImage(video, 0, 0, PW, PH);
  const d = cx.getImageData(0, 0, PW, PH).data, n = PW * PH;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { r[i] = d[i * 4]; g[i] = d[i * 4 + 1]; b[i] = d[i * 4 + 2]; }
  return { r, g, b };
}
async function grabRGBAvg(k = 5) {
  const n = PW * PH, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let t = 0; t < k; t++) { const f = grabRGB(); for (let i = 0; i < n; i++) { r[i] += f.r[i] / k; g[i] += f.g[i] / k; b[i] += f.b[i] / k; } await sleep(40); }
  return { r, g, b };
}
// Detector settings — tuned offline against recorded sessions with simulated noise
// (exposure, sensor noise, body shadows, reflection changes, camera shake).
export const P = { skinW: 4, chg: 34, yMin: 4, notRefSkin: 1, useGlare: 0, glareK: 2.6, open: 0, bridge: 0, minIn: 20, minOut: 15, edge: 12, needOut: 0, bigArm: 150 }; // swept 2026-10-08 on session 3 × 7 noise conditions: 70% <90 px, median 63 px; with LOO affine correction median 53 px
let inScreen = null; // camera px inside the screen rectangle (rebuilt per calibration)
export function detectRGB(F, R, mask, C2S, opts = {}) {
  const n = PW * PH;
  if (!detectRGB._core || detectRGB._coreC2S !== C2S || detectRGB._coreE !== P.edge) { const cm = new Uint8Array(n); for (let i = 0; i < n; i++) { const [u, v] = apply(C2S, i % PW, (i / PW) | 0); cm[i] = u > P.edge && u < W - P.edge && v > P.edge && v < H - P.edge ? 1 : 0; } detectRGB._core = cm; detectRGB._coreC2S = C2S; detectRGB._coreE = P.edge; }
  const inCore = detectRGB._core;
  if (!detectRGB._band || detectRGB._bandC2S !== C2S) { const bm = new Uint8Array(n); for (let i = 0; i < n; i++) { const [u, v] = apply(C2S, i % PW, (i / PW) | 0); bm[i] = u > -160 && u < W + 160 && v > -420 && v < H + 60 ? 1 : 0; } detectRGB._band = bm; detectRGB._bandC2S = C2S; }
  const inBand = (i) => detectRGB._band[i] === 1;
  if (!inScreen || inScreen._C2S !== C2S) { inScreen = new Uint8Array(n); inScreen._C2S = C2S; for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const [u, v] = apply(C2S, x, y); if (u >= 0 && u <= W && v >= 0 && v <= H) inScreen[y * PW + x] = 1; } }
  // global gain from non-screen + screen pixels (robust ratio of sums)
  let a = 0, b2 = 0; for (let i = 0; i < n; i += 9) if (mask[i]) { a += F.r[i] + F.g[i] + F.b[i]; b2 += R.r[i] + R.g[i] + R.b[i]; }
  const gain = b2 > 0 ? a / b2 : 1;
  // REFLECTION zone: inside the screen, wherever the reference is much brighter than
  // the black stage's typical level, the light is the room lamp reflected off the
  // glass — it changes when anyone moves, so it's unusable. Ignore it.
  if (!inScreen._glare || inScreen._R !== R || inScreen._gk !== P.glareK) {
    inScreen._gk = P.glareK;
    const vals = []; for (let i = 0; i < n; i += 5) if (inScreen[i]) vals.push(R.r[i] + R.g[i] + R.b[i]);
    vals.sort((p, q) => p - q); const med = vals[vals.length >> 1] || 90;
    inScreen._glare = new Uint8Array(n); inScreen._R = R;
    for (let i = 0; i < n; i++) if (inScreen[i] && R.r[i] + R.g[i] + R.b[i] > Math.max(med * P.glareK, med + 120)) inScreen._glare[i] = 1;
  }
  const glare = inScreen._glare;
  // SKIN ∧ CHANGED. Skin is "warm" in YCbCr (Cr − Cb > skinW) even when the hand is
  // dark/backlit; the navy screen, white wall, lamp reflections and shadows are not.
  // "Changed" (vs. the hand-free reference, gain-compensated) drops warm static things
  // (wood, the wall's warm tint). Shadows, glare and refresh bands fail one test or both.
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i] || (P.useGlare && glare[i])) continue;
    const fr = F.r[i], fgc = F.g[i], fb = F.b[i], rr = R.r[i] * gain, rg = R.g[i] * gain, rb = R.b[i] * gain;
    const Yf = 0.299 * fr + 0.587 * fgc + 0.114 * fb;
    if (Yf < P.yMin || Yf > 235) continue;
    const Cbf = -0.168736 * fr - 0.331264 * fgc + 0.5 * fb, Crf = 0.5 * fr - 0.418688 * fgc - 0.081312 * fb;
    if (Crf - Cbf < P.skinW) continue;                                   // not skin-warm
    const Yr = 0.299 * rr + 0.587 * rg + 0.114 * rb, Cbr = -0.168736 * rr - 0.331264 * rg + 0.5 * rb, Crr = 0.5 * rr - 0.418688 * rg - 0.081312 * rb;
    if (P.notRefSkin && Crr - Cbr >= P.skinW && Yr >= P.yMin) continue;  // was already skin-warm (wall tint, wood)
    if (Math.abs(Yf - Yr) + Math.abs(Cbf - Cbr) + Math.abs(Crf - Crr) < P.chg) continue; // unchanged
    fg[i] = 1;
  }
  // evaluation hook: ignore discs (screen px) — e.g. the target ring offline
  if (opts.ignore) for (let i = 0; i < n; i++) if (fg[i]) { const [u, v] = apply(C2S, i % PW, (i / PW) | 0); for (const [iu, iv, ir] of opts.ignore) if ((u - iu) ** 2 + (v - iv) ** 2 < ir * ir) { fg[i] = 0; break; } }
  {
  }
  // opening: erode (all 8 neighbours set) then dilate
  const er = new Uint8Array(n);
  for (let y = 1; y < PH - 1; y++) for (let x = 1; x < PW - 1; x++) {
    const i = y * PW + x; if (!fg[i]) continue;
    if (fg[i - 1] && fg[i + 1] && fg[i - PW] && fg[i + PW] && fg[i - PW - 1] && fg[i - PW + 1] && fg[i + PW - 1] && fg[i + PW + 1]) er[i] = 1;
  }
  let op = new Uint8Array(n);
  for (let y = 1; y < PH - 1; y++) for (let x = 1; x < PW - 1; x++) {
    const i = y * PW + x;
    if (er[i] || er[i - 1] || er[i + 1] || er[i - PW] || er[i + PW] || er[i - PW - 1] || er[i - PW + 1] || er[i + PW - 1] || er[i + PW + 1]) op[i] = 1;
  }
  if (!P.open) op = fg;
  // BRIDGES: excluded zones (the live-preview box, the reflection zone) connect a blob
  // across them — an arm crossing the preview stays one piece — but never count as
  // blob pixels themselves (no tip, no area).
  const bridge = new Uint8Array(n);
  if (P.bridge) for (let i = 0; i < n; i++) if ((glare[i] || (inBand(i) && !mask[i])) && !op[i]) bridge[i] = 1;
  // components: biggest one entering from outside and reaching ≥40 px inside
  const lab = new Int32Array(n); let best = 0, bestN = 0, cur = 0; const st = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (!op[s0] || lab[s0]) continue; cur++; let cnt = 0, out = 0, inn = 0, core = 0; st.push(s0); lab[s0] = cur;
    const go = (q) => { if ((op[q] || bridge[q]) && !lab[q]) { lab[q] = cur; st.push(q); } };
    while (st.length) { const p = st.pop(); const x = p % PW, y = (p / PW) | 0;
      if (op[p]) { cnt++; if (inScreen[p]) { inn++; if (inCore[p]) core++; } else { const [, v] = apply(C2S, x, y); if (v < H * 0.65) out++; } } // arms come from above / upper sides
      if (x > 0) go(p - 1); if (x < PW - 1) go(p + 1); if (y > 0) go(p - PW); if (y < PH - 1) go(p + PW); }
    // the hand = the blob with the most area well INSIDE the screen (not the biggest
    // overall — a body shadow on the wall can be bigger than the arm)
    // a fingertip at the top edge leaves only a few px inside — fine if a big arm is attached outside
    const ok = core >= P.minIn || (core >= 6 && out >= P.bigArm);
    if ((!P.needOut || out >= P.minOut) && ok && core + out * 0.05 > bestN) { bestN = core + out * 0.05; best = cur; }
  }
  if (!best) return null;
  let ex = 0, ey = 0, en = 0; const ins = [];
  for (let p = 0; p < n; p++) if (lab[p] === best && op[p]) {
    const [u, v] = apply(C2S, p % PW, (p / PW) | 0);
    if (inCore[p]) ins.push([u, v]); else if (v < H * 0.65) { ex += u; ey += v; en++; }
  }
  if (en) { ex /= en; ey /= en; }
  else { // not connected to the outside: the arm side is the blob's top (arms come from above)
    const byV = [...ins].sort((p, q) => p[1] - q[1]).slice(0, Math.max(5, Math.floor(ins.length * 0.15)));
    ex = byV.reduce((a1, p) => a1 + p[0], 0) / byV.length; ey = byV.reduce((a1, p) => a1 + p[1], 0) / byV.length - 1;
  }
  // tip = mean of the 12 inside pixels farthest from the entry (steadier than 1 px)
  ins.sort((p, q) => ((q[0] - ex) ** 2 + (q[1] - ey) ** 2) - ((p[0] - ex) ** 2 + (p[1] - ey) ** 2));
  const top = ins.slice(0, 12);
  const tip = [top.reduce((s1, p) => s1 + p[0], 0) / top.length, top.reduce((s1, p) => s1 + p[1], 0) / top.length];
  return { tip, area: bestN, entry: [ex, ey], fg: opts.wantMask ? op : undefined, lab: opts.wantMask ? lab : undefined, best };
}

// share of the band (screen + around it, minus the target ring) that changed vs. the
// clean stage — a hand anywhere near the screen, even above it, raises it
export function changedFraction(F, R, mask, ring, C2S) {
  const n = PW * PH; let a = 0, b2 = 0;
  for (let i = 0; i < n; i += 9) if (mask[i]) { a += F.r[i] + F.g[i] + F.b[i]; b2 += R.r[i] + R.g[i] + R.b[i]; }
  const gain = b2 > 0 ? a / b2 : 1; let ch = 0, tot = 0;
  for (let i = 0; i < n; i += 2) {
    if (!mask[i]) continue;
    if (ring) { const [u, v] = apply(C2S, i % PW, (i / PW) | 0); if ((u - ring[0]) ** 2 + (v - ring[1]) ** 2 < 70 * 70) continue; }
    tot++; if (Math.abs((F.r[i] + F.g[i] + F.b[i]) / 3 - (R.r[i] + R.g[i] + R.b[i]) / 3 * gain) > 30) ch++;
  }
  return tot ? ch / tot : 0;
}

// pixels that are skin-warm now but weren't in the clean stage (a hand anywhere in the
// band, even above the screen) — lighting shifts and shadows don't create skin
export function newSkin(F, R, mask) {
  const n = PW * PH; let c = 0;
  for (let i = 0; i < n; i += 2) {
    if (!mask[i]) continue;
    const Yf = 0.299 * F.r[i] + 0.587 * F.g[i] + 0.114 * F.b[i]; if (Yf < P.yMin || Yf > 235) continue;
    const wf = 0.5 * F.r[i] - 0.418688 * F.g[i] - 0.081312 * F.b[i] - (-0.168736 * F.r[i] - 0.331264 * F.g[i] + 0.5 * F.b[i]);
    const wr = 0.5 * R.r[i] - 0.418688 * R.g[i] - 0.081312 * R.b[i] - (-0.168736 * R.r[i] - 0.331264 * R.g[i] + 0.5 * R.b[i]);
    if (wf >= P.skinW + 4 && wr < P.skinW) c++;
  }
  return c;
}

// ---- 3. the 9-target session --------------------------------------------------------
async function targetRun(cal, mask) {
  const results = [];
  // one verified-clean reference of the black stage (no ring) for checking per-target refs
  msg('Hands away — taking a clean picture of the screen…');
  await sleep(1200);
  const clean = await grabRGBAvg(6);
  for (let k = 0; k < TARGETS.length; k++) {
    const [tx, ty] = TARGETS[k];
    clearDots();
    const ring = dot(tx, ty, 'target', 44); // same look before & during — no state change for the camera to see
    msg(`Target ${k + 1} of 9 — hands away…`);
    // reference WITH this ring, verified hand-free against the clean stage
    let ref = null;
    for (let tries = 0; tries < 12 && !ref; tries++) {
      await sleep(tries ? 500 : 1100); // > display delay so the ring is in the picture
      const cand = await grabRGBAvg(5);
      if (newSkin(cand, clean, mask) > 150) { msg(`Target ${k + 1} of 9 — move your hand away from the screen…`); continue; }
      ref = cand;
    }
    if (!ref) ref = await grabRGBAvg(5);
    post({ kind: 'ref', k, frame: jpeg() });
    msg(`Target ${k + 1} of 9 — touch the dot and hold`);
    const tipEl = document.createElement('div'); tipEl.className = 'tc-tip'; root.appendChild(tipEl);
    const hist = []; const samples = []; let done = null; const t0 = performance.now();
    while (!done && performance.now() - t0 < 20000) {
      const r = detectRGB(grabRGB(), ref, mask, cal.C2S); const now = performance.now();
      feedTip = r ? r.tip : null;
      if (r) {
        tipEl.style.display = 'block'; tipEl.style.left = `${r.tip[0] - 10}px`; tipEl.style.top = `${r.tip[1] - 10}px`;
        hist.push({ t: now, p: r.tip }); samples.push({ t: Math.round(now - t0), tip: r.tip.map(Math.round), area: r.area });
        while (hist.length && now - hist[0].t > 700) hist.shift();
        if (hist.length > 6 && now - hist[0].t > 600) {
          const xs = hist.map((h) => h.p[0]).sort((p, q) => p - q), ys = hist.map((h) => h.p[1]).sort((p, q) => p - q);
          const q = (arr, f) => arr[Math.floor((arr.length - 1) * f)];
          if (q(xs, 0.85) - q(xs, 0.15) < 24 && q(ys, 0.85) - q(ys, 0.15) < 32) done = { tip: [q(xs, 0.5), q(ys, 0.5)], area: r.area };
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
