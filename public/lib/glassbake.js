// The Gardener™ — BAKED liquid glass (no per-frame cost).
//
// Live liquid glass (lib/lgr.js — the liquid-glass-react port) re-runs an SVG
// filter on every repaint. But nothing behind our glass moves, so we compute the
// exact same picture ONCE and show it as a plain image:
//   backdrop  → blur(6px) saturate(140%)            (the library's backdrop-filter)
//             → displaced per colour channel by the library's displacement map,
//               R/G/B at scales 70/77/84 (its chromatic aberration)
//   → a static <span> background. Only the cursor-lit rims stay live (cheap gradients).
// Backdrops: cards sit on the static aurora (assets/aurora-blur.jpg); the fullscreen
// panel sits on the wall itself — a recent screenshot from the server
// (GET /api/wall-snapshot, captured through the kiosk's debug port).
import { DISPLACEMENT_MAP } from './lgr-map.js';

const BLUR = 6, SAT = 140, SCALE = 70, AB = 2;
const SCALES = [SCALE, SCALE * (1 + AB * 0.05), SCALE * (1 + AB * 0.1)]; // R, G, B
const PAD = 40;

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
let mapImg = null;
const getMap = async () => (mapImg ||= await loadImg(DISPLACEMENT_MAP));

// Bake: src = image/canvas covering the 900×1600 viewport; rect in viewport px.
export async function bake(src, rect, { veil = 0, light = null, scale = 1 } = {}) {
  const w = Math.round(rect.width), h = Math.round(rect.height);
  const x0 = Math.round(rect.left), y0 = Math.round(rect.top);
  // 1. blurred + saturated backdrop crop (with padding so the blur has context)
  const A = document.createElement('canvas'); A.width = w + PAD * 2; A.height = h + PAD * 2;
  const a = A.getContext('2d', { willReadFrequently: true });
  a.filter = `blur(${BLUR}px) saturate(${SAT}%)`;
  a.drawImage(src, x0 - PAD, y0 - PAD, A.width, A.height, 0, 0, A.width, A.height);
  a.filter = 'none';
  if (veil) { a.fillStyle = `rgba(2,10,8,${veil})`; a.fillRect(0, 0, A.width, A.height); }
  // optional light source INSIDE the glass (e.g. the note bar's text): drawn in the
  // padded canvas space, then refracted with everything else below
  if (light) light(a, PAD, PAD);
  const S = a.getImageData(0, 0, A.width, A.height).data, SW = A.width, SH = A.height;
  // 2. the library's displacement map, cover-fitted to the element (xMidYMid slice)
  const map = await getMap();
  const M = document.createElement('canvas'); M.width = w; M.height = h;
  const m = M.getContext('2d', { willReadFrequently: true });
  const k = Math.max(w / map.width, h / map.height), mw = map.width * k, mh = map.height * k;
  m.drawImage(map, (w - mw) / 2, (h - mh) / 2, mw, mh);
  const D = m.getImageData(0, 0, w, h).data;
  // 3. per-channel displacement (feDisplacementMap: P' = P + scale·(C/255 − ½);
  //    the library uses negative scales, i.e. it samples AGAINST the map vector)
  const O = new ImageData(w, h), Od = O.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, dx = D[i] / 255 - 0.5, dy = D[i + 2] / 255 - 0.5;
      for (let c = 0; c < 3; c++) {
        let sx = Math.round(x + PAD - SCALES[c] * scale * dx), sy = Math.round(y + PAD - SCALES[c] * scale * dy);
        sx = sx < 0 ? 0 : sx >= SW ? SW - 1 : sx; sy = sy < 0 ? 0 : sy >= SH ? SH - 1 : sy;
        Od[i + c] = S[(sy * SW + sx) * 4 + c];
      }
      Od[i + 3] = 255;
    }
  }
  const C = document.createElement('canvas'); C.width = w; C.height = h;
  C.getContext('2d').putImageData(O, 0, 0);
  const blob = await new Promise((r) => C.toBlob(r, 'image/jpeg', 0.92));
  return URL.createObjectURL(blob);
}

const rimBg = (ox, oy, k) => `linear-gradient(${135 + ox * 1.2}deg, rgba(255,255,255,0) 0%,
  rgba(255,255,255,${k[0] + Math.abs(ox) * 0.003}) ${Math.max(10, 33 + oy * 0.3)}%,
  rgba(255,255,255,${k[1] + Math.abs(ox) * 0.005}) ${Math.min(90, 66 + oy * 0.4)}%, rgba(255,255,255,0) 100%)`;
const rimEls = new Map(); // el → its rim spans
let rimHooked = false;
function hookRims() {
  if (rimHooked) return; rimHooked = true;
  let raf = 0, last = null;
  window.addEventListener('mousemove', (e) => {
    last = e; if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const [el, rims] of rimEls) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        const ox = ((last.clientX - (r.left + r.width / 2)) / r.width) * 100;
        const oy = ((last.clientY - (r.top + r.height / 2)) / r.height) * 100;
        for (const s of rims) s.style.background = rimBg(ox, oy, s._k);
      }
    });
  }, { passive: true });
}

// Give `el` the glass layers (image + tint + rims) once; returns the image span.
export function glassLayers(el) {
  if (el._gb) return el._gb;
  const img = document.createElement('span'); img.className = 'gb-img';
  const tint = document.createElement('span'); tint.className = 'lgr-tint';
  const rims = [[0.05, 0.16], [0.06, 0.11]].map((k) => {
    const s = document.createElement('span'); s.className = 'lgr-rim'; s._k = k; s.style.background = rimBg(0, 0, k); return s;
  });
  el.prepend(img, tint); el.append(...rims); el.classList.add('lgr', 'baked');
  rimEls.set(el, rims); hookRims();
  el._gb = img;
  return img;
}
export function setGlass(el, url, { own = true } = {}) {
  const img = glassLayers(el);
  const prev = img._own ? img._url : null;
  img._url = url; img._own = own;
  img.style.backgroundImage = `url(${url})`; img.classList.add('in');
  if (prev && prev !== url) setTimeout(() => URL.revokeObjectURL(prev), 3000);
}

// ---- cards: backdrop = the static aurora ------------------------------------
let aurora = null;
// Baked card glass is cached on the wall (Cache Storage, keyed by the card's
// position + size), so after a reload it's ready instantly. Each card fires
// 'glass-ready' once its image is DECODED — app.js reveals glass + content together.
const CACHE = 'gardener-glass-v1';
async function cachedBake(sig, make) {
  const key = `/__glass/${encodeURIComponent(sig)}`;
  let cache = null; try { cache = await caches.open(CACHE); } catch { /* no Cache API */ }
  const hit = cache && await cache.match(key);
  if (hit) return URL.createObjectURL(await hit.blob());
  const url = await make();
  try { if (cache) await cache.put(key, new Response(await (await fetch(url)).blob(), { headers: { 'Content-Type': 'image/jpeg' } })); } catch { /* ignore */ }
  return url;
}
export async function bakeCards(cards) {
  aurora ||= await loadImg('/assets/aurora-blur.jpg');
  await Promise.all(cards.map(async (card) => {
    const r = card.getBoundingClientRect(), z = r.width / card.offsetWidth || 1;
    const sig = `${Math.round(r.left / z)},${Math.round(r.top / z)},${card.offsetWidth}x${card.offsetHeight}`;
    if (card._gbSig === sig) return;
    card._gbSig = sig;
    try {
      const url = await cachedBake(sig, () => bake(aurora, { left: r.left / z, top: r.top / z, width: card.offsetWidth, height: card.offsetHeight }));
      const im = new Image(); im.src = url; await im.decode();   // decoded → no flash
      setGlass(card, url);
    } catch { /* keep the plain frosted glass */ }
    card.dispatchEvent(new Event('glass-ready'));
  }));
}

// ---- panel: backdrop = a recent snapshot of the wall ------------------------
let snap = null, snapAt = 0;
const panelCache = new Map(); // `${snapAt}:${w}x${h}` → url
export async function refreshSnapshot() {
  try {
    const r = await fetch('/api/wall-snapshot', { cache: 'no-store' });
    if (!r.ok) return;
    const bmp = await createImageBitmap(await r.blob());
    snap = bmp; snapAt = Date.now();
    const old = [...panelCache.values()]; panelCache.clear();
    setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 5000);
  } catch { /* no snapshot available (QA / no kiosk) */ }
}
export async function bakePanel(card) {
  if (!snap) return false;
  const rect = card.getBoundingClientRect();
  const key = `${snapAt}:${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.top)}`;
  let url = panelCache.get(key);
  if (!url) { url = await bake(snap, rect, { veil: 0.30 }); panelCache.set(key, url); }
  if (card.isConnected) setGlass(card, url, { own: false }); // cached — not revoked on swap
  return true;
}

// ---- note bar: the TEXT you type lights the glass ---------------------------
// While typing, each keystroke (rAF-throttled) re-bakes the bar with the input's
// text drawn as a soft mint glow inside the glass — blurred and refracted at the
// rim like light passing through it. ~a few ms per bake (the bar is ~840×60);
// canvases are throwaway and the previous image URL is revoked, so memory stays
// flat. Leaving the box restores the cached idle glass.
export function liveTextGlass(form, input) {
  let pending = false, idleUrl = null;
  const render = async () => {
    pending = false;
    aurora ||= await loadImg('/assets/aurora-blur.jpg');
    const r = form.getBoundingClientRect(), z = r.width / form.offsetWidth || 1;
    const ir = input.getBoundingClientRect(), cs = getComputedStyle(input);
    const text = input.value;
    const tx = (ir.left - r.left) / z + parseFloat(cs.paddingLeft || 0), ty = (ir.top - r.top + ir.height / 2) / z;
    const light = (g, ox, oy) => {
      if (!text) return;
      g.save();
      g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      g.textBaseline = 'middle';
      g.globalCompositeOperation = 'lighter';
      // a wide halo, a bright core, and a mirrored reflection pulled toward the rim
      g.filter = 'blur(16px)'; g.fillStyle = 'rgba(116,247,176,1)'; g.fillText(text, ox + tx, oy + ty); g.fillText(text, ox + tx, oy + ty);
      g.filter = 'blur(5px)'; g.fillStyle = 'rgba(200,255,230,.9)'; g.fillText(text, ox + tx, oy + ty);
      g.filter = 'blur(3px)'; g.fillStyle = 'rgba(160,255,210,.35)'; g.save(); g.translate(0, (oy + ty) * 2); g.scale(1, -1); g.fillText(text, ox + tx, oy + ty); g.restore();
      g.restore();
    };
    const url = await bake(aurora, { left: r.left / z, top: r.top / z, width: form.offsetWidth, height: form.offsetHeight }, { light, scale: 1.0 });
    if (document.activeElement === input) setGlass(form, url); else URL.revokeObjectURL(url);
  };
  const queue = () => { if (!pending) { pending = true; requestAnimationFrame(render); } };
  input.addEventListener('focus', () => { if (form._gb) { idleUrl = form._gb._url; form._gb._own = false; } queue(); }); // keep the idle image alive
  input.addEventListener('input', queue);
  input.addEventListener('blur', () => { if (idleUrl) setGlass(form, idleUrl, { own: false }); });
}
