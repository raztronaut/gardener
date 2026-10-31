// Weather — a calm, clearly-sectioned read of the sky via keyless Open-Meteo (proxy).
// 2026-10-01 rewrite after "too dense and confusing" feedback: one idea per row,
// every section labelled, and BOTH °F and °C on the current reading AND on the
// forecast days (the humans asked for tomorrow's prediction in Celsius too).
// 2026-10-30: the TILE is only "now", the next sun event and the next hours (humans: "too
// dense … mostly clear about next hours and when sunset is, no UV, no humidity"); the
// next days, humidity and UV live in the maximized view only.
//   1. Now        — icon, °F / °C, and the next sun event (sunset, or sunrise after dark)
//   2. Sun        — [full] plain-words sunrise / sunset (this line predates and is separate
//                   from the banned Sun & Moon widget — it stays)
//   3. Stats      — [full] Humidity · UV
//   4. Next days  — [full] Tomorrow + the two days after: icon, temps at 10 am · 3 pm · 8 pm (°F, °C)
//   5. Hourly     — bars (a histogram) every 2 h, the temperature on top of each bar
// Icons are self-hosted Meteocons SVGs in public/assets/weather/.
//
// Fullscreen (openFull): the tile's reading reflowed into two columns, then a
// RAIN & SUN map of the city — Open-Meteo sampled on an 8×10 grid over the map,
// bicubic-smoothed into one field: gold = sun, grey haze = fog/cloud, blue = rain.
// Static (Now / +3h / +6h / +12h toggles, no animation); fetched only when opened.
import { staticMap, svgEl } from '/lib/staticmap.js';

const HOME = [37.7484, -122.4766]; // 408 Quintara St
const GRID_C = 8, GRID_R = 10, HOURS_AHEAD = [0, 3, 6, 12];
let GRID_CACHE = null; // { key, t, pts } — re-opening within 20 min reuses it

// Catmull-Rom bicubic sample of a cols×rows grid at fractional (gx, gy), clamped.
function bicubic(g, cols, rows, gx, gy) {
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy;
  const at = (i, j) => g[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
  const row = (j) => cr(at(ix - 1, j), at(ix, j), at(ix + 1, j), at(ix + 2, j), tx);
  return cr(row(iy - 1), row(iy), row(iy + 1), row(iy + 2), ty);
}

const WMO = (c) => c === 0 ? ['Clear', 'clear-day'] : (c <= 2) ? ['Partly cloudy', 'partly-cloudy-day'] : c === 3 ? ['Overcast', 'overcast']
  : (c >= 45 && c <= 48) ? ['Fog', 'fog'] : (c >= 51 && c <= 57) ? ['Drizzle', 'drizzle']
  : (c >= 61 && c <= 67) ? ['Rain', 'rain'] : (c >= 71 && c <= 77) ? ['Snow', 'snow']
  : (c >= 80 && c <= 82) ? ['Showers', 'rain'] : (c >= 85 && c <= 86) ? ['Snow', 'snow']
  : (c >= 95) ? ['Storm', 'thunderstorms'] : ['—', 'thermometer'];

// After dark, clear & partly-cloudy skies swap to calm star-lit faces.
const nightSlug = (slug, isDay) => isDay !== 0 ? slug
  : slug === 'clear-day' ? 'clear-night'
  : slug === 'partly-cloudy-day' ? 'partly-cloudy-night'
  : slug;

const fToC = (f) => Math.round((f - 32) * 5 / 9);

// Warmth tint (2026-10-15) — colour on the NUMBER itself (no bars/badges) so an
// unusual day jumps out from across the room. Keyed to San Francisco norms: most
// days (46–79°F) stay neutral ink, so the card is calm; a heat spike reads warm
// amber, a scorcher coral, and a genuinely cold reading icy blue. Returns a
// class suffix ('' when ordinary) plus a plain-English hint for the tooltip.
export function warmth(f) {
  if (!Number.isFinite(f)) return { cls: '', hint: '' };
  if (f >= 90) return { cls: 'hot2', hint: 'a scorcher for San Francisco' };
  if (f >= 80) return { cls: 'hot', hint: 'unusually warm for San Francisco' };
  if (f <= 45) return { cls: 'cold', hint: 'a cold one for San Francisco' };
  return { cls: '', hint: '' };
}

// UV index → [label, colour] (WHO bands).
const uvBand = (u) => u == null ? ['—', 'var(--ink-faint)']
  : u < 3 ? ['Low', '#74f7b0'] : u < 6 ? ['Moderate', '#f7d774']
  : u < 8 ? ['High', '#f7a374'] : u < 11 ? ['Very high', '#f77474'] : ['Extreme', '#c074f7'];

// "2026-05-31T05:51" (already local to the requested tz) → "5:51 am"
function fmtClock(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return '—';
  let h = parseInt(m[1], 10);
  const ap = h < 12 ? 'am' : 'pm'; h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ap}`;
}
// Hour (0–23) from a local ISO time, read from the string (host-tz independent).
const hourOf = (iso) => { const m = /T(\d{2})/.exec(iso || ''); return m ? parseInt(m[1], 10) : null; };
const hr12 = (hh) => `${((hh + 11) % 12) + 1}${hh < 12 ? 'a' : 'p'}`;

// Weekday for a plain local ISO date, computed in UTC from the date parts.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayIdx = (iso) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : null;
};

export default {
  id: 'weather',
  title: 'Weather',
  icon: '🌤',
  size: 'tall', // half width × 2 rows — sits beside the Daily Almanac
  async openFull(body, ctx) {
    const h = ctx.h;
    if (!document.getElementById('style-weather-full')) {
      const st = document.createElement('style'); st.id = 'style-weather-full'; st.textContent = `
      .wxf { display:flex; flex-direction:column; gap:16px; padding:6px 0 0; opacity:0; transition:opacity .25s linear; }
      .wxf.on { opacity:1; }
      /* the tile's reading, reflowed: now/sun/stats left, next days right, hours beneath */
      .wxf-top { flex:none; }
      .wxf-top .wx-bars { --wxbar:120px; }
      .wxf-top .wx { display:grid; grid-template-columns:1fr 1fr; column-gap:44px; row-gap:10px; height:100%;
        grid-template-areas:"now days" "sun days" "stats days" "hours hours"; grid-template-rows:auto auto 1fr auto; }
      .wxf-top .wx-now { grid-area:now; } .wxf-top .wx-sun { grid-area:sun; margin:0; }
      .wxf-top .wx-stats { grid-area:stats; align-self:start; }
      .wxf-top .wx > div:not([class]) { grid-area:days; align-self:center; }
      .wxf-top .wx-hours { grid-area:hours; margin:0; }
      .wxf-hd { flex:none; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
      .wxf-hd .wx-sec { margin:0 0 4px; }
      .wxf-cap { font-size:19px; color:var(--ink); line-height:1.2; }
      .wxf-cap .dim { color:var(--ink-soft); }
      .wxf-tg { display:flex; gap:4px; flex:none; }
      .wxf-tg .gbtn { font-size:15px; padding:6px 12px; border-radius:999px; color:var(--ink-soft); }
      .wxf-tg .gbtn.sel { color:var(--mint); background:rgba(116,247,176,.10); font-weight:600; }
      .wxf-map { flex:none; position:relative; border-radius:18px; overflow:hidden; isolation:isolate; }
      /* screen blend: the field LIGHTS the map (sun glows, fog hazes) instead of tinting it mud */
      .wxf-map canvas { position:absolute; inset:0; mix-blend-mode:screen; }
      .wxf-map .smap > svg text { font-family:var(--font); font-size:14px; font-weight:600; fill:#fff;
        paint-order:stroke; stroke:rgba(0,0,0,.65); stroke-width:3px; }
      .wxf-ft { flex:none; display:flex; align-items:center; justify-content:space-between; gap:16px;
        font-size:14px; color:var(--ink-soft); }
      .wxf-lg { display:flex; gap:18px; }
      .wxf-lg i { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:7px; vertical-align:0; }
    `; document.head.appendChild(st);
    }
    const W = Math.floor(body.clientWidth) || 786;
    // Fill the panel exactly: the card may grow to #panel's inner height; the map
    // takes whatever the fixed rows leave (no scroll, no empty band).
    const TOP = 292, HD = 50, FT = 22, GAPS = 3 * 16 + 6;
    let mapH = 900;
    try {
      const pnl = document.getElementById('panel'), pcs = getComputedStyle(pnl);
      const card = pnl.querySelector('.panel-card'), pb = card.querySelector('.panel-body'), bcs = getComputedStyle(pb);
      const head = card.querySelector('.panel-head');
      const avail = pnl.clientHeight - parseFloat(pcs.paddingTop) - parseFloat(pcs.paddingBottom)
        - (head ? head.offsetHeight : 80) - parseFloat(bcs.paddingTop) - parseFloat(bcs.paddingBottom) - 4;
      if (avail > 500) mapH = Math.floor(avail - TOP - HD - FT - GAPS);
    } catch { /* keep the default */ }

    const top = h('div', { class: 'wxf-top' });
    const cap = h('div', { class: 'wxf-cap' });
    const tg = h('div', { class: 'wxf-tg' });
    const mapBox = h('div', { class: 'wxf-map', style: { width: `${W}px`, height: `${mapH}px` } });
    const home = h('span', {});
    const wrap = h('div', { class: 'wxf' }, top,
      h('div', { class: 'wxf-hd' }, h('div', {}, h('div', { class: 'wx-sec' }, 'Rain & sun'), cap), tg),
      mapBox,
      h('div', { class: 'wxf-ft' },
        h('div', { class: 'wxf-lg' },
          h('span', {}, h('i', { style: { background: '#f7c948' } }), 'Sun'),
          h('span', {}, h('i', { style: { background: '#c8d4dc' } }), 'Fog & cloud'),
          h('span', {}, h('i', { style: { background: '#5aa9ff' } }), 'Rain')),
        home));
    body.replaceChildren(wrap);

    // Basemap → the data field → labels on top (readable through the colour).
    // Fractional zoom: the city's width (Ocean Beach → the Bay shore) fills the frame.
    const base = staticMap({ bbox: [37.70, -122.525, 37.82, -122.355], width: W, height: mapH, labels: true });
    const FS = 4; // field resolution: 1 value per 4 px, scaled up smoothly
    const cv = h('canvas', { width: Math.ceil(W / FS), height: Math.ceil(mapH / FS), style: { width: `${W}px`, height: `${mapH}px` } });
    base.el.insertBefore(cv, base.labels || base.svg);
    const [hx, hy] = base.project(...HOME);
    const house = svgEl('g', { transform: `translate(${hx.toFixed(1)},${hy.toFixed(1)})` });
    house.append(
      svgEl('circle', { r: 15, fill: 'rgba(8,20,16,.85)', stroke: '#74f7b0', 'stroke-width': 2 }),
      svgEl('path', { d: 'M-7,1 L0,-6 L7,1 M-5,-1 V7 H5 V-1', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      Object.assign(svgEl('text', { x: 21, y: 5 }), { textContent: 'Home' }));
    base.svg.append(house);
    mapBox.append(base.el);

    // Grid sample points at the centres of an 8×10 lattice over the visible map.
    const pts = [];
    for (let j = 0; j < GRID_R; j++) for (let i = 0; i < GRID_C; i++) pts.push(base.unproject((i + 0.5) * W / GRID_C, (j + 0.5) * mapH / GRID_R).map((v) => +v.toFixed(3)));
    let hi = 0; // home's nearest grid cell
    pts.forEach((p, k) => { if (Math.hypot(p[0] - HOME[0], p[1] - HOME[1]) < Math.hypot(pts[hi][0] - HOME[0], pts[hi][1] - HOME[1])) hi = k; });
    const { tz = 'America/Los_Angeles' } = ctx.config || {};
    const key = pts.map((p) => p.join(',')).join(';');
    const loadGrid = async () => {
      if (GRID_CACHE && GRID_CACHE.key === key && Date.now() - GRID_CACHE.t < 20 * 60 * 1000) return GRID_CACHE.d;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${pts.map((p) => p[0]).join(',')}&longitude=${pts.map((p) => p[1]).join(',')}`
        + `&hourly=precipitation,precipitation_probability,cloud_cover,shortwave_radiation,is_day&timezone=${encodeURIComponent(tz)}&forecast_hours=13`;
      const d = await ctx.fetchJSON(url);
      if (!Array.isArray(d) || d.length !== pts.length) throw new Error('bad grid');
      GRID_CACHE = { key, t: Date.now(), d };
      return d;
    };

    const draw = (d, k) => {
      const col = (name) => d.map((p) => { const v = p.hourly?.[name]?.[k]; return Number.isFinite(v) ? v : 0; });
      const rain = col('precipitation'), cloud = col('cloud_cover'), prob = col('precipitation_probability');
      const day = (d[hi].hourly?.is_day?.[k] ?? 1) === 1;
      const c2 = cv.getContext('2d'), fw = cv.width, fh = cv.height, img = c2.createImageData(fw, fh), px = img.data;
      for (let y = 0; y < fh; y++) {
        const gy = ((y + 0.5) / fh) * GRID_R - 0.5;
        for (let x = 0; x < fw; x++) {
          const gx = ((x + 0.5) / fw) * GRID_C - 0.5;
          const c = Math.min(1, Math.max(0, bicubic(cloud, GRID_C, GRID_R, gx, gy) / 100));
          const p = Math.max(0, bicubic(rain, GRID_C, GRID_R, gx, gy));
          // layers (premultiplied "over"): sun (day only) → cloud haze → rain
          let r = 0, g = 0, b = 0, a = 0;
          const over = (cr, cg, cb, ca) => { r = cr * ca + r * (1 - ca); g = cg * ca + g * (1 - ca); b = cb * ca + b * (1 - ca); a = ca + a * (1 - ca); };
          if (day) over(255, 205, 110, 0.085 * Math.pow(1 - c, 1.3)); // faint: a clear day should warm the map, not wash it sepia
          over(190, 205, 215, 0.40 * c);
          if (p > 0.02) { // soft edge: fades in over 0.02–0.3 mm/h, then deepens with intensity
            const e = Math.min(1, (p - 0.02) / 0.28), soft = e * e * (3 - 2 * e);
            over(70, 150, 255, soft * Math.min(0.9, 0.35 + 0.25 * Math.log1p(p * 4)));
          }
          const o = (y * fw + x) * 4;
          px[o] = a ? r / a : 0; px[o + 1] = a ? g / a : 0; px[o + 2] = a ? b / a : 0; px[o + 3] = a * 255;
        }
      }
      c2.putImageData(img, 0, 0);

      // One plain sentence: rain first (it matters most), then the sky's shape.
      const maxP = Math.max(...rain), wetFrac = rain.filter((v) => v >= 0.1).length / rain.length, maxProb = Math.max(...prob);
      const half = (side) => { const v = cloud.filter((_, n) => (n % GRID_C < GRID_C / 2) === (side === 'w')); return v.reduce((s, x) => s + x, 0) / v.length; };
      const cw = half('w'), ce = half('e'), cm = (cw + ce) / 2;
      const rainTxt = maxP < 0.1 ? (maxProb >= 30 ? `Dry · ${Math.round(maxProb)}% chance of rain` : 'Dry across the city')
        : `${wetFrac > 0.6 ? 'Rain over most of the city' : 'Showers in parts of the city'} · up to ${maxP.toFixed(1)} mm/h`;
      const skyTxt = day
        ? (cm < 25 ? 'sunny everywhere' : cm > 75 ? 'grey skies' : cw > ce + 30 ? 'fog in the west, sun in the east'
          : ce > cw + 30 ? 'sun in the west, cloud in the east' : 'patchy sun')
        : (cm < 25 ? 'clear night' : cm > 75 ? 'cloudy night' : cw > ce + 30 ? 'fog rolling in from the west' : 'patchy cloud tonight');
      cap.replaceChildren(rainTxt, h('span', { class: 'dim' }, ` · ${skyTxt}`));
      const rad = d[hi].hourly?.shortwave_radiation?.[k];
      home.textContent = `Home · ${Math.round(cloud[hi])}% cloud${day && Number.isFinite(rad) ? ` · ${Math.round(rad)} W/m²` : ''} · ${rain[hi].toFixed(1)} mm`;
    };

    const mounted = this.mount(top, ctx, { full: true }); // the full reading (own fetch + 15-min refresh)
    let grid = null;
    try { grid = await loadGrid(); }
    catch { cap.textContent = 'The rain & sun map is unavailable right now'; }
    if (grid) {
      const times = grid[hi].hourly?.time || [];
      let sel = 0;
      const btns = HOURS_AHEAD.filter((k) => times[k]).map((k, n) => {
        const hh = hourOf(times[k]);
        const b = h('button', { class: `gbtn${n === 0 ? ' sel' : ''}`, type: 'button',
          onclick: () => { if (sel === n) return; sel = n; btns.forEach((x, m) => x.classList.toggle('sel', m === n)); draw(grid, k); } },
          k === 0 ? 'Now' : `${((hh + 11) % 12) + 1} ${hh < 12 ? 'am' : 'pm'}`);
        return b;
      });
      tg.replaceChildren(...btns);
      draw(grid, 0);
    }
    // glass + content together: reveal once the reading, the tiles and the field are all in
    await Promise.all([mounted.catch(() => {}), base.ready]);
    wrap.classList.add('on');
  },
  async mount(body, ctx, { full = false } = {}) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .wx { display:flex; flex-direction:column; height:100%; gap:4px; }
      .wx-sec { font-size:12.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); margin-bottom:4px; }

      /* 1 · now */
      .wx-now { display:flex; align-items:center; gap:12px; }
      .wx-now .ic { width:56px; height:56px; flex:none; filter:drop-shadow(0 4px 12px rgba(0,0,0,.4));
        animation:wxin .22s linear both; }
      @keyframes wxin { from{opacity:0} to{opacity:1} }
      @media (prefers-reduced-motion: reduce) { .wx-now .ic { animation:none; } }
      .wx-now .ic img { display:block; }
      .wx-now .tmp { display:flex; align-items:baseline; gap:8px; flex:none; }
      .wx-now .f { font-family:var(--font-display); font-size:54px; line-height:.9; color:#fff; }
      .wx-now .c { font-family:var(--font-display); font-size:20px; line-height:1; color:var(--ink-soft); }

      /* 2 · sun */
      .wx-sun { display:flex; gap:16px; font-size:14px; color:var(--ink-soft); margin-top:-4px; }
      .wx-sun b { color:var(--ink); font-weight:600; }
      .wx-sun .dl { margin-left:auto; color:var(--ink-faint); white-space:nowrap; }
      .wx-sun .dl b { color:var(--ink-soft); }
      .wx-sun .dl i { font-style:normal; color:var(--mint); }

      /* 3 · stats — open columns, no boxes */
      .wx-stats { display:flex; }
      .wx-stat { flex:1; min-width:0; display:flex; align-items:baseline; gap:8px; } /* label + value on one line */
      .wx-stat .k { font-size:12.5px; letter-spacing:.04em; color:var(--ink-faint); white-space:nowrap; }
      .wx-stat .v { font-family:var(--font-display); font-size:20px; color:var(--ink); line-height:1.05;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wx-stat .v small { font-family:var(--font); font-size:14px; color:var(--ink-soft); margin-left:4px; }

      /* 4 · next days — a small table, tomorrow first, °F with °C beside it */
      .wx-days { display:grid; grid-template-columns:minmax(0,1fr) 26px repeat(3, 66px); column-gap:8px; row-gap:0; align-items:center; }
      .wx-days .h { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-faint); text-align:right; }
      .wx-days .wx-sec { margin:0; text-align:left; grid-column:1 / 3; }
      .wx-days .dn { font-size:16px; line-height:27px; color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wx-days .dn.tm { color:var(--ink); font-weight:600; }
      .wx-days .dn .pp { color:#9cc0ff; font-size:13px; font-weight:600; margin-left:6px; }
      .wx-days img { display:block; width:26px; height:26px; }
      .wx-days .t { white-space:nowrap; display:flex; align-items:baseline; justify-content:flex-end; gap:4px; line-height:27px; }
      .wx-days .t span { line-height:1; }
      .wx-days .t .f { font-family:var(--font-display); font-size:20px; color:var(--ink); }
      .wx-days .t .c { font-size:11.5px; color:var(--ink-faint); }

      /* 1b · the next sun event, beside the reading (tile) */
      .wx-now .nx { margin-left:auto; text-align:right; display:flex; flex-direction:column; gap:3px; }
      .wx-now .nx .k { font-size:12.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); }
      .wx-now .nx .v { font-family:var(--font-display); font-size:26px; line-height:1; color:#ffd59a; white-space:nowrap; }
      .wx-now .nx .v small { font-size:15px; color:var(--ink-soft); margin-left:3px; }
      .wx-now .nx .in { font-size:13px; color:var(--ink-faint); }

      /* 5 · hourly bars — the temperature sits on top of each bar */
      .wx-hours { margin-top:auto; }
      .wx.tile .wx-hours { flex:1; display:flex; flex-direction:column; margin-top:18px; min-height:0; }
      .wx.tile .wx-bars { flex:1; height:auto; min-height:120px; }
      .wx-bars { display:flex; align-items:flex-end; height:var(--wxbar, 118px); margin-top:4px; }
      .wx-bars .col { flex:1; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; }
      .wx-bars .tt { font-family:var(--font-display); font-size:19px; color:var(--ink); line-height:1; }
      .wx-bars .tc { font-size:11.5px; color:var(--ink-faint); line-height:1; margin:2px 0 5px; }
      .wx-bars .b { width:62%; border-radius:7px 7px 2px 2px; background:linear-gradient(to top, rgba(116,247,176,.10), rgba(116,247,176,.42)); }
      .wx-bars .col:first-child .b { background:linear-gradient(to top, rgba(255,255,255,.12), rgba(255,255,255,.55)); }
      .wx-bars .col:first-child .tt { color:#fff; }
      .wx-axis { display:flex; margin-top:6px; padding-top:6px; border-top:1px solid var(--stroke); }
      .wx-axis .hr { flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; }
      .wx-axis .tt { font-family:var(--font-display); font-size:17px; color:var(--ink); line-height:1; }
      .wx-axis .tc { font-size:11.5px; color:var(--ink-faint); line-height:1; margin-top:3px; } /* °C under each hour's °F */
      .wx-axis .hr:first-child .tt { color:#fff; }
      /* warmth tint (see warmth()) — static colour on the number only */
      .wx .w-hot { color:#f7b074 !important; }
      .wx .w-hot2 { color:#ff8a6b !important; }
      .wx .w-cold { color:#9cc0ff !important; }
      .wx-axis img { display:block; }
      .wx-axis .t { font-size:12.5px; color:var(--ink-faint); line-height:1; }
      .wx-axis .p { font-size:12px; color:#9cc0ff; line-height:1; }

      .wx-fallback { display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:10px; height:100%; text-align:center; }
      .wx-fallback .i { font-size:40px; opacity:.55; line-height:1; }
      .wx-fallback .m { font-size:15px; color:var(--ink); }
      .wx-fallback .s { font-size:13px; color:var(--ink-faint); }
    `);

    const h = ctx.h;
    const icon = (slug, px) => h('img', { src: `/assets/weather/still/${slug}.svg` /* static (no SMIL/CSS animation): animated icons kept the GPU-less kiosk repainting at ~100% CPU */, width: px, height: px, alt: '' });
    const fallback = (msg, sub) => h('div', { class: 'wx-fallback' },
      h('div', { class: 'i' }, '🌤'), h('div', { class: 'm' }, msg), h('div', { class: 's' }, sub));
    body.appendChild(ctx.loading('reading the sky…'));

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day`
      + `&hourly=temperature_2m,weather_code,precipitation_probability,uv_index,is_day`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max`
      + `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(tz)}&forecast_days=4`;

    // Current hour index into the hourly series (which starts at local midnight
    // in the display tz) — read the hour in that tz, not the host's.
    const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
    const nowHour = () => parseInt(hourFmt.format(new Date()), 10) || 0;

    const render = (d) => {
      const cur = d.current;
      const [, slug] = WMO(cur.weather_code);
      const tF = Math.round(cur.temperature_2m);
      const hum = Math.round(cur.relative_humidity_2m);
      const hNow = nowHour();
      // UV that answers "do we need sunscreen?": a bare "0 Low" at dawn or
      // after dark says nothing, so the cell reads the day's PEAK (and its hour)
      // until the peak passes, then the live value, then — once the sun's done —
      // tomorrow's peak. The hourly series starts at today's local midnight.
      const uvAt = (j) => { const v = d.hourly.uv_index?.[j]; return Number.isFinite(v) ? v : null; };
      const uvPeakOf = (from, to) => {
        let best = null;
        for (let j = from; j < Math.min(to, d.hourly.time.length); j++) {
          const v = uvAt(j);
          if (v != null && (!best || v > best.v)) best = { v, hr: hourOf(d.hourly.time[j]) };
        }
        return best;
      };
      const uvNowRaw = uvAt(hNow);
      const peakToday = uvPeakOf(0, 24);
      let uvKey = 'UV index', uvVal = uvNowRaw;
      if (peakToday && Math.round(peakToday.v) >= 1 && hNow < peakToday.hr) {
        uvKey = `UV peak · ${hr12(peakToday.hr)}`; uvVal = peakToday.v;
      } else if (uvNowRaw == null || Math.round(uvNowRaw) < 1) {
        const peakTmrw = uvPeakOf(24, 48);
        if (peakTmrw && Math.round(peakTmrw.v) >= 1) { uvKey = 'UV tomorrow'; uvVal = peakTmrw.v; }
      }
      const uv = uvVal == null ? null : Math.round(uvVal);
      const [uvLabel, uvColor] = uvBand(uv);
      // Next days: tomorrow + two more — the temperature at 10 am, 3 pm and 8 pm (from the
      // hourly forecast; °F with °C under it), instead of high/low (humans, 2026-10-29).
      const AT = [10, 15, 20];
      const hourIdx = new Map((d.hourly.time || []).map((t, k) => [t, k]));
      const tAt = (iso, hr) => { const k = hourIdx.get(`${iso}T${String(hr).padStart(2, '0')}:00`); const v = k == null ? null : d.hourly.temperature_2m[k]; return Number.isFinite(v) ? Math.round(v) : null; };
      const days = [];
      for (let i = 1; i <= 3; i++) {
        const iso = d.daily.time?.[i];
        if (iso == null) continue;
        const temps = AT.map((hr) => tAt(iso, hr));
        if (temps.every((v) => v == null)) continue;
        const pp = d.daily.precipitation_probability_max?.[i];
        days.push({ i, iso, code: d.daily.weather_code?.[i], temps, pp: Number.isFinite(pp) ? Math.round(pp) : null });
      }
      const wcls = (f) => { const w = warmth(f); return w.cls ? ` w-${w.cls}` : ''; };
      const tempCell = (f) => (f == null ? h('div', { class: 't' }, '—') : h('div', { class: 't', title: warmth(f).hint || null },
        h('span', { class: `f${wcls(f)}` }, `${f}°`), h('span', { class: 'c' }, `${fToC(f)}°C`)));
      const dayRows = days.flatMap((x) => {
        const wd = weekdayIdx(x.iso);
        const [lbl, s] = WMO(x.code);
        const wet = x.pp != null && x.pp >= 30;
        return [
          h('div', { class: `dn${x.i === 1 ? ' tm' : ''}`, title: `${wd == null ? '' : WD_FULL[wd] + ' · '}${lbl}` },
            x.i === 1 ? 'Tomorrow' : (wd == null ? '—' : WD[wd]),
            wet ? h('span', { class: 'pp' }, `💧${x.pp}%`) : null),
          h('div', { title: lbl }, icon(s, 26)),
          ...x.temps.map((f) => tempCell(f)),
        ];
      });

      // Hourly: labelled every 2 h for ~10 h, curve through every hour.
      const STEP = 2, N = 6;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const j = hNow + i * STEP;
        if (j >= d.hourly.time.length || !Number.isFinite(d.hourly.temperature_2m[j])) break;
        const pop = d.hourly.precipitation_probability?.[j];
        pts.push({ t: Math.round(d.hourly.temperature_2m[j]), code: d.hourly.weather_code[j],
          hr: hourOf(d.hourly.time[j]), pop: Number.isFinite(pop) ? pop : null, isDay: d.hourly.is_day?.[j] });
      }
      const anyWet = pts.some((p) => p.pop != null && p.pop >= 25); // rain line only when it matters
      let hoursEl = null;
      if (pts.length >= 2) {
        const vs = pts.map((p) => p.t);
        const tMin = Math.min(...vs), span = Math.max(...vs) - tMin;
        // bar height: 30% for the coolest hour, +70% across at least a 10°F spread (so a
        // 2-degree wobble reads as one, not as a cliff)
        const hOf = (v) => 30 + ((v - tMin) / Math.max(span, 10)) * 70;
        hoursEl = h('div', { class: 'wx-hours' },
          h('div', { class: 'wx-sec' }, 'Next hours'),
          h('div', { class: 'wx-bars' }, ...pts.map((p) => h('div', { class: 'col' },
            h('div', { class: `tt${wcls(p.t)}` }, `${p.t}°`),
            h('div', { class: 'tc' }, `${fToC(p.t)}°C`),
            h('div', { class: 'b', style: { height: `calc((100% - 44px) * ${(hOf(p.t) / 100).toFixed(3)})` } })))),
          h('div', { class: 'wx-axis' }, ...pts.map((p, i) => {
            const wet = p.pop != null && p.pop >= 25;
            return h('div', { class: 'hr' },
              icon(nightSlug(WMO(p.code)[1], p.isDay), 26),
              h('div', { class: 't' }, i === 0 ? 'now' : hr12(p.hr)),
              anyWet ? h('div', { class: 'p' }, wet ? `💧${p.pop}%` : '') : null);
          })));
      }

      // the next sun event: today's sunset, or after dark tomorrow's sunrise
      // (the series' times are local wall-clock strings in tz: compare them as strings, and
      // diff them as if both were UTC)
      const nowIso = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T').slice(0, 16);
      const setIso = d.daily.sunset?.[0];
      const riseIso = (d.daily.sunrise?.[0] || '') > nowIso ? d.daily.sunrise?.[0] : d.daily.sunrise?.[1];
      const beforeSet = !!setIso && setIso > nowIso;
      const nextIso = beforeSet ? setIso : riseIso;
      const inMin = nextIso ? Math.round((Date.parse(nextIso + 'Z') - Date.parse(nowIso + 'Z')) / 60000) : NaN;
      const [clk, ap] = String(fmtClock(nextIso)).split(/\s+(?=[ap]\.?m)/i);
      const nx = nextIso ? h('div', { class: 'nx' },
        h('div', { class: 'k' }, beforeSet ? 'Sunset' : 'Sunrise'),
        h('div', { class: 'v' }, clk, ap ? h('small', {}, ap) : null),
        Number.isFinite(inMin) && inMin > 0 && inMin < 12 * 60 ? h('div', { class: 'in' }, inMin < 60 ? `in ${inMin} min` : `in ${Math.floor(inMin / 60)} h ${String(inMin % 60).padStart(2, '0')}`) : null) : null;

      body.replaceChildren(h('div', { class: full ? 'wx full' : 'wx tile' },
        h('div', { class: 'wx-now' },
          h('div', { class: 'ic' }, icon(nightSlug(slug, cur.is_day), 56)),
          h('div', { class: 'tmp' },
            h('div', { class: `f${wcls(tF)}`, title: warmth(tF).hint || null }, `${tF}°F`),
            h('div', { class: 'c' }, `${fToC(tF)}°C`)),
          // (condition word, today's high/low and the daylight line removed 2026-10-29 —
          // humans: "too cognitively dense"; the icon says the condition)
          full ? null : nx),
        // humidity, UV and the next days: the maximized view only (2026-10-30)
        !full ? null : h('div', { class: 'wx-sun' },
          h('span', {}, 'Sunrise ', h('b', {}, fmtClock(d.daily.sunrise?.[0]))),
          h('span', {}, 'Sunset ', h('b', {}, fmtClock(d.daily.sunset?.[0])))),
          // (no wind — the humans removed it twice; see GARDEN_RULES.md)
        !full ? null : h('div', { class: 'wx-stats' },
          h('div', { class: 'wx-stat' }, h('div', { class: 'k' }, 'Humidity'),
            h('div', { class: 'v' }, `${hum}%`)),
          h('div', { class: 'wx-stat' }, h('div', { class: 'k', title: uvKey === 'UV index' ? 'UV index now' : uvKey === 'UV tomorrow' ? "Tomorrow's peak UV" : "Today's peak UV and when it lands" }, uvKey),
            h('div', { class: 'v' }, `${uv ?? '—'}`, h('small', { style: { color: uvColor } }, uvLabel)))),
        full && days.length ? h('div', {},
          h('div', { class: 'wx-days' },
            h('div', { class: 'wx-sec' }, 'Next days'), h('div', { class: 'h' }, '10a'), h('div', { class: 'h' }, '3p'), h('div', { class: 'h' }, '8p'),
            ...dayRows)) : null,
        hoursEl));
    };

    const refresh = async () => render(await ctx.fetchJSON(url)); // fetch first → failure keeps last render
    let loaded = false;
    for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
      try { await refresh(); loaded = true; }
      catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 2500)); }
    }
    if (!loaded) body.replaceChildren(fallback('The sky is quiet', 'reconnecting to the forecast…'));
    ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
  },
};
