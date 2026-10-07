// The Gardener™ — baked Liquid Glass.
//
// Apple-style glass = the backdrop REFRACTED through a curved bezel + a specular
// rim of light. Browsers do that live (SVG feDisplacementMap as backdrop-filter),
// which re-filters every repaint — far too heavy for this Jetson (live blur
// measured 7fps). But our backdrop is a STATIC image (the pre-blurred aurora,
// exactly 900×1600 = the locked canvas) and every card sits at a fixed spot, so we
// can compute each card's glass ONCE: ray-trace a squircle bezel profile with
// Snell's law (n = 1.5) to displace the aurora near the edges, add a directional
// rim highlight, and hand the result to the card as a plain background image.
// Zero per-frame cost; re-baked only if a card's size/position changes.

const SRC = '/assets/aurora-blur.jpg';
const BEZEL = 30;      // px of curved rim
const THICK = 40;      // glass thickness (px) — scales the refraction offset
const N = 1.5;         // refractive index (glass)
const LIGHT = [-0.55, -0.83]; // light from upper-left (normalised below)

let srcPx = null;                 // ImageData of the 900×1600 backdrop
const baked = new WeakMap();      // card → signature of the last bake
let ro = null, timer = null;

function loadSource() {
  if (srcPx) return Promise.resolve(srcPx);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 1600;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 900, 1600);
      srcPx = g.getImageData(0, 0, 900, 1600);
      resolve(srcPx);
    };
    img.onerror = reject;
    img.src = SRC;
  });
}

// Signed distance to a rounded rect (negative inside), plus its outward normal.
function sdf(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r), qy = Math.abs(y - h / 2) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
  let nx, ny;
  if (qx > 0 && qy > 0) { const l = Math.hypot(ox, oy) || 1; nx = ox / l; ny = oy / l; }
  else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
  return { d, nx: nx * Math.sign(x - w / 2 || 1), ny: ny * Math.sign(y - h / 2 || 1) };
}

// Bezel profile: squircle height h(t) = (1 - (1 - t)^4)^(1/4), t = depth into bezel.
// Returns the lateral refraction offset (px) for a ray entering at depth t.
const offsetLUT = (() => {
  const out = new Float32Array(BEZEL + 1);
  for (let i = 0; i <= BEZEL; i++) {
    const t = Math.min(0.999, i / BEZEL), e = 1e-3;
    const hgt = (u) => Math.pow(1 - Math.pow(1 - u, 4), 0.25);
    const slope = (hgt(Math.min(1, t + e)) - hgt(Math.max(0, t - e))) / (2 * e) * (THICK / BEZEL);
    const th1 = Math.atan(slope);                  // angle of incidence vs surface normal
    const th2 = Math.asin(Math.sin(th1) / N);      // Snell
    out[i] = THICK * Math.tan(th1 - th2);          // lateral shift through the slab
  }
  return out;
})();

function bakeCard(card, src) {
  const rect = card.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  if (w < 40 || h < 40) return;
  const z = rect.width / w || 1;                   // controller zoom (CSS zoom on #zoomroot)
  const sig = `${Math.round(rect.left)},${Math.round(rect.top)},${w}x${h},${z.toFixed(3)}`;
  if (baked.get(card) === sig) return;
  baked.set(card, sig);
  const r = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 26;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const out = g.createImageData(w, h);
  const S = src.data, O = out.data, SW = src.width, SH = src.height;
  const ll = Math.hypot(LIGHT[0], LIGHT[1]), lx = LIGHT[0] / ll, ly = LIGHT[1] / ll;
  const sample = (vx, vy, o) => {             // bilinear read of the backdrop
    vx = Math.min(SW - 1.001, Math.max(0, vx)); vy = Math.min(SH - 1.001, Math.max(0, vy));
    const x0 = vx | 0, y0 = vy | 0, fx = vx - x0, fy = vy - y0, i = (y0 * SW + x0) * 4;
    for (let k = 0; k < 3; k++) {
      const a = S[i + k] + (S[i + 4 + k] - S[i + k]) * fx;
      const b = S[i + SW * 4 + k] + (S[i + SW * 4 + 4 + k] - S[i + SW * 4 + k]) * fx;
      O[o + k] = a + (b - a) * fy;
    }
    O[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const vx = rect.left + (x + 0.5) * z, vy = rect.top + (y + 0.5) * z;
      // cheap reject: far from every edge → straight copy
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge > BEZEL + r * 0.3) { sample(vx, vy, o); continue; }
      const { d, nx, ny } = sdf(x + 0.5, y + 0.5, w, h, r);
      const depth = -d;                             // px inside the edge
      if (depth >= BEZEL || depth < 0) { sample(vx, vy, o); continue; }
      const t = depth / BEZEL;
      const shift = offsetLUT[Math.round(depth)] || 0;
      // convex lens: the rim shows backdrop pulled from further inward
      sample(vx - nx * shift * z, vy - ny * shift * z, o);
      // specular rim: brightest at the very edge facing the light, a fainter
      // counter-glint on the opposite edge (light passing through the glass)
      const facing = nx * lx + ny * ly;
      const rim = Math.pow(1 - t, 2.4);
      const spec = rim * (Math.max(0, -facing) * 0.95 + Math.max(0, facing) * 0.35 + 0.12) * 190;
      // the lens edge: a soft darker band just inside the lit rim (where the bezel
      // bends light away), then the flat interior — the cue that reads as "thick glass"
      const band = Math.exp(-Math.pow((t - 0.42) / 0.16, 2)) * 0.22;
      for (let k = 0; k < 3; k++) O[o + k] = Math.min(255, O[o + k] * (1 - band) + spec * (k === 2 ? 0.95 : 1));
    }
  }
  g.putImageData(out, 0, 0);
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const prev = card.dataset.glassUrl;
    card.style.setProperty('--glass-img', `url(${url})`);
    card.classList.add('baked-glass');
    card.dataset.glassUrl = url;
    if (prev) setTimeout(() => URL.revokeObjectURL(prev), 2000);
  }, 'image/png');
}

export async function bakeGlass(root = document) {
  let src;
  try { src = await loadSource(); } catch { return; }
  const cards = [...root.querySelectorAll('#garden > .card:not(.bare):not(.unframed)')];
  for (const card of cards) {
    // one card per idle slice — never blocks input
    await new Promise((r) => (window.requestIdleCallback || setTimeout)(r, { timeout: 300 }));
    try { bakeCard(card, src); } catch { /* keep the plain glass */ }
  }
  if (!ro && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => bakeGlass(root), 700); });
    cards.forEach((c) => ro.observe(c));
  }
}
