// The Gardener™ — static maps for the wall. No map library, no panning, no motion:
// a fixed lat/lon box is covered with Esri Dark Gray Canvas tiles (served + disk-cached
// by /api/tile/…; street/place labels are a separate layer, `labels: false` drops
// them), and an SVG overlay in the SAME pixel space carries the data. The zoom is
// fractional (tiles of the next level up, scaled down), so any box fills the frame.
//
//   const m = staticMap({ bbox: [south, west, north, east], width, height });
//   el.append(m.el);                 // a positioned div, exactly width × height
//   const [x, y] = m.project(lat, lon);  // → overlay pixel coords
//   m.svg.append(...);               // draw markers/fields in those coords
//
// The box is centred and fits exactly on its tighter axis (the visible area can be a
// little larger than bbox on the other — never smaller).
const TILE = 256;
const SVGNS = 'http://www.w3.org/2000/svg';

const wx = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const wy = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

export function staticMap({ bbox, width, height, labels = true, maxZoom = 16, dim = 0.62 }) {
  const [s, w, n, e] = bbox;
  // fractional zoom that fits the box: span at z=0, then log2 of the room we have
  const fz = Math.min(maxZoom, Math.log2(Math.min(width / (wx(e, 0) - wx(w, 0)), height / (wy(s, 0) - wy(n, 0)))));
  const z = Math.max(1, Math.ceil(fz)); // fetch this level's tiles…
  const k = 2 ** (fz - z);             // …drawn at this scale (≤ 1)
  const T = TILE * k;
  const W = (lon) => wx(lon, z) * k, Y = (lat) => wy(lat, z) * k; // world px at the fractional zoom
  const cx = (W(w) + W(e)) / 2, cy = (Y(n) + Y(s)) / 2;
  const ox = cx - width / 2, oy = cy - height / 2; // world px of the top-left corner

  const el = document.createElement('div');
  el.className = 'smap';
  el.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:var(--color-map-canvas, #070b0a)`;
  const layer = (style, op) => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;inset:0;opacity:${op}`;
    for (let ty = Math.floor(oy / T); ty * T < oy + height; ty++) {
      for (let tx = Math.floor(ox / T); tx * T < ox + width; tx++) {
        if (ty < 0 || ty >= 2 ** z) continue;
        const img = new Image();
        img.decoding = 'async';
        img.src = `/api/tile/${style}/${z}/${((tx % 2 ** z) + 2 ** z) % 2 ** z}/${ty}.png`;
        const l = Math.floor(tx * T - ox), t = Math.floor(ty * T - oy);
        img.style.cssText = `position:absolute;left:${l}px;top:${t}px;width:${Math.ceil((tx + 1) * T - ox) - l}px;height:${Math.ceil((ty + 1) * T - oy) - t}px`;
        d.append(img);
      }
    }
    return d;
  };
  const tiles = layer('dark', dim);
  const lab = labels ? layer('labels', 0.75) : null;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.cssText = 'position:absolute;inset:0;overflow:visible';
  const credit = document.createElement('div');
  credit.textContent = 'Esri, HERE, Garmin, © OpenStreetMap';
  credit.style.cssText = 'position:absolute;right:6px;bottom:4px;font-size:10px;color:var(--color-map-credit, rgba(255,255,255,.35));font-family:var(--font)';
  el.append(tiles, ...(lab ? [lab] : []), svg, credit);

  const project = (lat, lon) => [W(lon) - ox, Y(lat) - oy];
  // Inverse (pixel → lat/lon), for gridded data fields.
  const unproject = (x, y) => {
    const X = (x + ox) / (T * 2 ** z), Yn = (y + oy) / (T * 2 ** z);
    return [(Math.atan(Math.sinh(Math.PI * (1 - 2 * Yn))) * 180) / Math.PI, X * 360 - 180];
  };
  // Resolves once every tile has loaded (or failed) — so a card can fade the map in
  // whole, never tile by tile.
  const ready = Promise.all([...tiles.children, ...(lab ? lab.children : [])].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  return { el, svg, tiles, labels: lab, project, unproject, zoom: fz, ready };
}

export const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};
