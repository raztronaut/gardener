// "De São Paulo a São Francisco" — her journey: the real route on a map (the great
// circle GRU → SFO, 10.427 km), both cities' clocks, and the day's haiku about it.
import { HAIKUS, daily } from '/dashboards/gui/love.js';
import { staticMap, svgEl } from '/lib/staticmap.js';

const SP = { lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo', name: 'São Paulo' };
const SF = { lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles', name: 'São Francisco' };

// points along the great circle (spherical interpolation)
function greatCircle(a, b, n = 64) {
  const r = Math.PI / 180, v = (p) => [Math.cos(p.lat * r) * Math.cos(p.lon * r), Math.cos(p.lat * r) * Math.sin(p.lon * r), Math.sin(p.lat * r)];
  const A = v(a), B = v(b), om = Math.acos(A[0] * B[0] + A[1] * B[1] + A[2] * B[2]);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om);
    const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
    out.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
  }
  return out;
}

export default {
  id: 'haiku',
  title: 'De São Paulo a São Francisco',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .lv-hk { height:476px; display:flex; flex-direction:column; gap:16px; opacity:0; transition:opacity .5s ease; }
      .lv-hk.on { opacity:1; }
      .lv-hk .mapw { flex:none; height:262px; border-radius:14px; overflow:hidden; position:relative; }
      .lv-hk .city { font: 600 12px var(--font); letter-spacing:.12em; text-transform:uppercase; fill:#fff; }
      .lv-hk .tm { font: 500 13px var(--font); fill:var(--rose); }
      .lv-hk .km { font: 600 12.5px var(--font); letter-spacing:.08em; fill:rgba(255,255,255,.75); }
      .lv-hk .poem { flex:1; display:flex; flex-direction:column; justify-content:center; gap:6px; padding:0 6px; }
      .lv-hk .poem div { font-family:var(--font-display); font-size:33px; line-height:1.12; color:#fff; }
      .lv-hk .poem div:nth-child(2) { padding-left:26px; }
      .lv-hk .poem div:nth-child(3) { padding-left:52px; color:var(--rose); }
    `);
    const root = ctx.h('div', { class: 'lv-hk' });
    body.replaceChildren(root);
    const mapw = ctx.h('div', { class: 'mapw' });
    const poem = ctx.h('div', { class: 'poem' });
    root.append(mapw, poem);
    const W = Math.round(mapw.clientWidth) || 380, H = 262;

    const m = staticMap({ bbox: [-38, -128, 45, -36], width: W, height: H, labels: false, dim: 0.75 });
    const pts = greatCircle(SP, SF).map(([la, lo]) => m.project(la, lo));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    m.svg.append(svgEl('path', { d, fill: 'none', stroke: 'rgba(255,155,176,.25)', 'stroke-width': 6, 'stroke-linecap': 'round' }),
      svgEl('path', { d, fill: 'none', stroke: '#ff9bb0', 'stroke-width': 1.8, 'stroke-dasharray': '2 6', 'stroke-linecap': 'round' }));
    const [sx, sy] = m.project(SP.lat, SP.lon), [fx, fy] = m.project(SF.lat, SF.lon);
    for (const [x, y] of [[sx, sy], [fx, fy]]) m.svg.append(svgEl('circle', { cx: x, cy: y, r: 9, fill: 'rgba(255,155,176,.22)' }), svgEl('circle', { cx: x, cy: y, r: 4, fill: '#ff9bb0' }));
    const label = (x, y, anchor, city) => {
      const t1 = svgEl('text', { x, y, 'text-anchor': anchor, class: 'city' }); t1.textContent = city.name;
      const t2 = svgEl('text', { x, y: y + 17, 'text-anchor': anchor, class: 'tm' });
      m.svg.append(t1, t2);
      return t2;
    };
    const spT = label(sx - 14, sy + 4, 'end', SP), sfT = label(fx + 14, fy - 6, 'start', SF); // SF's label sits above the route as it leaves
    const mid = pts[Math.round(pts.length / 2)];
    const km = svgEl('text', { x: mid[0] + 12, y: mid[1], class: 'km' }); km.textContent = '10.427 km';
    m.svg.append(km);
    mapw.append(m.el);

    const fmt = (tz) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date());
    const tick = () => { spT.textContent = fmt(SP.tz); sfT.textContent = fmt(SF.tz); };
    const render = () => { poem.replaceChildren(...daily(HAIKUS).map((l) => ctx.h('div', {}, l))); tick(); };
    render();
    ctx.interval(tick, 20 * 1000);
    ctx.interval(render, 60 * 60 * 1000);
    await m.ready;
    root.classList.add('on'); // map + poem fade in together, once the tiles are in
  },
};
