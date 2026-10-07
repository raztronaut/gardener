// The Gardener™ — Liquid Glass for floating surfaces (the fullscreen panel).
//
// Real refraction, Apple-style: the wall BEHIND the panel is bent through a curved
// bezel. Chromium (the kiosk engine) accepts an SVG filter as `backdrop-filter`,
// so we build a displacement map for the panel's size — a squircle bezel profile
// ray-traced with Snell's law (n = 1.5): red/green encode the x/y pull toward the
// centre — and feed it to <feDisplacementMap>, then a light blur for legibility.
// Only the bezel ring is computed (interior is neutral), and maps are cached per
// size, so opening a panel costs a few ms. The filter runs only while a panel is
// open over a static wall.

const BEZEL = 44, THICK = 60, N = 1.5, BLUR = 6;
const cache = new Map(); // "WxH" → filter id
let svg = null;

const LUT = (() => {
  const out = new Float32Array(BEZEL + 1);
  const hgt = (u) => Math.pow(1 - Math.pow(1 - u, 4), 0.25);
  for (let i = 0; i <= BEZEL; i++) {
    const t = Math.min(0.999, i / BEZEL), e = 1e-3;
    const slope = (hgt(Math.min(1, t + e)) - hgt(Math.max(0, t - e))) / (2 * e) * (THICK / BEZEL);
    const a1 = Math.atan(slope), a2 = Math.asin(Math.sin(a1) / N);
    out[i] = THICK * Math.tan(a1 - a2);
  }
  return out;
})();
const MAX = Math.max(...LUT);

function sdf(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r), qy = Math.abs(y - h / 2) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
  let nx, ny;
  if (qx > 0 && qy > 0) { const l = Math.hypot(ox, oy) || 1; nx = ox / l; ny = oy / l; }
  else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
  return [d, nx * (x < w / 2 ? -1 : 1), ny * (y < h / 2 ? -1 : 1)];
}

function mapURL(w, h, r) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,0)'; g.fillRect(0, 0, w, h);           // neutral = no shift
  const img = g.getImageData(0, 0, w, h), D = img.data;
  const scale = MAX * 2;
  const px = (x, y) => {
    const [d, nx, ny] = sdf(x + 0.5, y + 0.5, w, h, r);
    const depth = -d;
    if (depth < 0 || depth >= BEZEL) return;
    const s = LUT[Math.round(depth)];
    const o = (y * w + x) * 4;
    // convex lens: each rim pixel shows the backdrop from further INWARD
    D[o] = 128 + (-nx * s / scale) * 255;
    D[o + 1] = 128 + (-ny * s / scale) * 255;
  };
  // only the bezel ring (+ rounded corners) — the interior stays neutral
  const B = BEZEL + r;
  for (let y = 0; y < h; y++) {
    if (y < B || y >= h - B) { for (let x = 0; x < w; x++) px(x, y); }
    else { for (let x = 0; x < B; x++) px(x, y); for (let x = w - B; x < w; x++) px(x, y); }
  }
  g.putImageData(img, 0, 0);
  return { url: c.toDataURL('image/png'), scale };
}

function filterFor(w, h, r) {
  const key = `${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    document.body.appendChild(svg);
  }
  const { url, scale } = mapURL(w, h, r);
  const id = `lg-${key}`;
  svg.insertAdjacentHTML('beforeend', `
    <filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse"
      primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale.toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="bent"/>
      <feGaussianBlur in="bent" stdDeviation="${BLUR}"/>
    </filter>`);
  cache.set(key, id);
  return id;
}

// Apply (and keep applied across resizes) liquid glass to a floating element.
export function liquidGlass(el) {
  const apply = () => {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < 60 || h < 60) return;
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 28;
    el.style.backdropFilter = `url(#${filterFor(w, h, r)})`;
    el.classList.add('lglass');
  };
  apply();
  if (!el._lgRO && 'ResizeObserver' in window) {
    let t; el._lgRO = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(apply, 60); });
    el._lgRO.observe(el);
  }
}
