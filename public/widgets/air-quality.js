// Air Quality — a compact square tile: the US AQI reading, its category, and PM2.5.
// Keyless Open-Meteo air-quality API (through the proxy). Sized 'sq' (quarter-width
// square) so two small tiles fit where one half-width card used to.
// Each band carries a short, plain-English health cue — genuinely useful on an
// ambient wall during SF's summer/fall wildfire-smoke spells, not just a number.
const CATS = [
  { max: 50, short: 'Good', color: '#74f7b0', tip: 'Fresh air — enjoy the outdoors' },
  { max: 100, short: 'Moderate', color: '#f7d774', tip: 'Fine for most; sensitive folks take note' },
  { max: 150, short: 'Sensitive', color: '#f7a374', tip: 'Sensitive groups should ease up outside' },
  { max: 200, short: 'Unhealthy', color: '#f77474', tip: 'Limit prolonged time outdoors' },
  { max: 300, short: 'Very bad', color: '#c074f7', tip: 'Avoid outdoor exertion' },
  { max: Infinity, short: 'Hazardous', color: '#f74a74', tip: 'Stay indoors; keep windows shut' },
];
const aqiCat = (v) => CATS.find((c) => v <= c.max) || CATS[CATS.length - 1];

// The US AQI is, by definition, the WORST of several per-pollutant sub-indices.
// Naming that driver turns a bare number into a story: high PM2.5 means wildfire
// smoke, high ozone means a hot smoggy afternoon — a meaningful distinction in SF.
// Open-Meteo exposes each pollutant's own US-AQI, so the dominant one is just the max.
const POLLUTANTS = [
  { key: 'us_aqi_pm2_5', label: 'PM2.5' },
  { key: 'us_aqi_pm10', label: 'PM10' },
  { key: 'us_aqi_ozone', label: 'O₃' },
  { key: 'us_aqi_nitrogen_dioxide', label: 'NO₂' },
  { key: 'us_aqi_sulphur_dioxide', label: 'SO₂' },
  { key: 'us_aqi_carbon_monoxide', label: 'CO' },
];
function dominant(cur) {
  let best = null;
  for (const p of POLLUTANTS) {
    const v = cur && cur[p.key];
    if (Number.isFinite(v) && (!best || v > best.val)) best = { label: p.label, val: v };
  }
  return best;
}

// The hourly US-AQI series is local to the requested tz. Find the index of the
// entry for the current tz-local DATE and hour, so both the trend and the
// forecast peak start from the present moment. This is date-aware (not just
// hour-matched) so it stays correct even when the series carries past days —
// otherwise a bare hour match would land on YESTERDAY's same hour. Falls back to
// a plain hour match, then the series start, if the date prefix isn't found.
function nowIndex(times, tz) {
  if (!Array.isArray(times)) return 0;
  if (tz) {
    try {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date());
      const g = (t) => p.find((x) => x.type === t)?.value;
      const prefix = `${g('year')}-${g('month')}-${g('day')}T${g('hour')}`;
      const j = times.findIndex((t) => typeof t === 'string' && t.startsWith(prefix));
      if (j >= 0) return j;
    } catch { /* fall through to hour match */ }
  }
  const nowH = new Date().getHours();
  const i = times.findIndex((t) => new Date(t).getHours() === nowH);
  return i < 0 ? 0 : i;
}

// How today's air compares to the SAME HOUR yesterday — a genuinely SF-useful
// read during fire season, distinct from the short-term "next 6h" trend. Reads
// the past day from the hourly series (24 entries back from "now") and reports a
// meaningful shift only (≥10 AQI), so the tile stays calm on steady days and
// speaks up when the smoke actually thickened or cleared overnight. Returns
// { word, arrow, color, delta } or null.
function vsYesterday(hourly, current, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const i = nowIndex(times, tz);
  const y = vals[i - 24];
  if (!Number.isFinite(current) || !Number.isFinite(y)) return null;
  const delta = Math.round(current - y);
  if (Math.abs(delta) < 10) return null;
  return delta < 0
    ? { word: 'Clearer than yesterday', arrow: '↓', color: '#74f7b0', delta: -delta, was: Math.round(y) }
    : { word: 'Hazier than yesterday', arrow: '↑', color: '#f7a374', delta, was: Math.round(y) };
}

// Trend over the next ~6h from the hourly US-AQI series. Semantic colours: air
// getting cleaner reads mint (down = good for pollution), worsening reads rose,
// steady stays quiet. Returns null when there isn't enough data to be honest.
// (We fetch 2 forecast days so this lookahead stays valid late in the evening,
// when a single-day series would run off its end and silently drop the arrow.)
function aqiTrend(hourly, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const i = nowIndex(times, tz);
  const cur = vals[i];
  const ahead = vals[i + 6];
  if (!Number.isFinite(cur) || !Number.isFinite(ahead)) return null;
  const diff = ahead - cur;
  if (diff <= -8) return { arrow: '↘', color: '#74f7b0', label: 'easing' };
  if (diff >= 8) return { arrow: '↗', color: '#f7a374', label: 'rising' };
  return { arrow: '→', color: 'var(--ink-faint)', label: 'steady' };
}

// The worst AQI coming over the next ~12h, with the hour it lands. Lets the tile
// hint — with a quiet ghost tick on the scale — how far the air is expected to
// climb before the day is out; genuinely useful when SF smoke is building.
// Returns null without enough data to be honest.
function aqiPeak(hourly, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const i = nowIndex(times, tz);
  let peak = -Infinity, peakIdx = -1;
  for (let j = i; j < Math.min(i + 12, vals.length); j++) {
    if (Number.isFinite(vals[j]) && vals[j] > peak) { peak = vals[j]; peakIdx = j; }
  }
  if (peakIdx < 0) return null;
  return { val: peak, hour: new Date(times[peakIdx]).getHours() };
}

// ---- Fullscreen (openFull, 2026-10-31) ---------------------------------------
// The tile stays a glance (number, word, scale). Up close the panel answers the
// next questions in order: how is it now and why (hero), where is it headed (the
// next 24 hours as category-coloured bars), what's actually in the air (each
// pollutant's own sub-index + concentration, the driver lit), and what the
// numbers mean (the six AQI bands, today's highlighted). Static — no animation.
const POLL_INFO = {
  'PM2.5': { name: 'Fine particles', what: 'smoke, exhaust', conc: 'pm2_5', unit: 'µg/m³' },
  PM10: { name: 'Coarse particles', what: 'dust, pollen', conc: 'pm10', unit: 'µg/m³' },
  'O₃': { name: 'Ozone', what: 'sunny-afternoon smog', conc: 'ozone', unit: 'µg/m³' },
  'NO₂': { name: 'Nitrogen dioxide', what: 'traffic', conc: 'nitrogen_dioxide', unit: 'µg/m³' },
  'SO₂': { name: 'Sulphur dioxide', what: 'ships, industry', conc: 'sulphur_dioxide', unit: 'µg/m³' },
  CO: { name: 'Carbon monoxide', what: 'combustion', conc: 'carbon_monoxide', unit: 'µg/m³' },
};
const BAND_RANGES = ['0–50', '51–100', '101–150', '151–200', '201–300', '301+'];
const BAND_NAMES = ['Good', 'Moderate', 'Unhealthy for sensitive groups', 'Unhealthy', 'Very unhealthy', 'Hazardous'];
const hourOfIso = (iso) => { const m = /T(\d{2})/.exec(iso || ''); return m ? parseInt(m[1], 10) : null; };
const hrLabel = (hh) => hh === 0 ? 'midnight' : hh === 12 ? 'noon' : `${((hh + 11) % 12) + 1} ${hh < 12 ? 'am' : 'pm'}`;
const hrShort = (hh) => `${((hh + 11) % 12) + 1}${hh < 12 ? 'a' : 'p'}`;

const FULL_STYLE = `
  .aqf { display:flex; flex-direction:column; gap:26px; height:1220px; padding:4px 0 0;
    opacity:0; transition:opacity .25s linear; }
  .aqf.on { opacity:1; }
  .aqf > * { flex:none; }
  .aqf .sec { font-size:13px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint);
    margin-bottom:12px; display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
  .aqf .sec .key { letter-spacing:.04em; text-transform:none; font-size:14px; }
  .aqf-hero { display:flex; align-items:center; gap:30px; min-height:150px; }
  .aqf-hero .num { font-family:var(--font-display); font-size:136px; line-height:.82; color:var(--aqf-c, var(--ink)); }
  .aqf-hero .tx { display:flex; flex-direction:column; gap:8px; min-width:0; }
  .aqf-hero .cat { font-family:var(--font-display); font-size:38px; line-height:1; color:var(--aqf-c, var(--ink)); }
  .aqf-hero .tip { font-size:21px; line-height:1.3; color:var(--ink); }
  .aqf-hero .why { font-size:17px; line-height:1.3; color:var(--ink-soft); }
  .aqf-hero .why b { color:var(--ink); font-weight:600; }
  /* next 24 hours: one bar per hour, coloured by its band; thresholds as hairlines */
  .aqf-chart { position:relative; height:190px; margin-top:26px; }
  .aqf-chart .bars { position:absolute; inset:0; display:flex; align-items:flex-end; gap:5px; }
  .aqf-chart .b { flex:1; border-radius:5px 5px 2px 2px; min-height:4px; opacity:.78; position:relative; }
  .aqf-chart .b.now { opacity:1; box-shadow:0 0 0 2px rgba(255,255,255,.85); }
  .aqf-chart .b .v { position:absolute; bottom:100%; left:50%; transform:translateX(-50%); margin-bottom:6px;
    font-family:var(--font-display); font-size:20px; color:var(--ink); white-space:nowrap; }
  .aqf-chart .th { position:absolute; left:0; right:0; border-top:1px dashed rgba(234,255,244,.18); }
  .aqf-chart .th span { position:absolute; right:0; bottom:3px; font-size:12px; color:var(--ink-faint); }
  .aqf-hrs { display:flex; gap:5px; margin-top:8px; }
  .aqf-hrs span { flex:1; text-align:center; font-size:13px; color:var(--ink-faint); white-space:nowrap; overflow:visible; }
  /* pollutants: name + plain words left, sub-index bar middle, concentration right */
  .aqf-pol { display:flex; flex-direction:column; gap:4px; }
  .aqf-pol .r { display:grid; grid-template-columns:250px 1fr 54px 118px; align-items:center; column-gap:18px;
    padding:9px 0; border-bottom:1px solid rgba(234,255,244,.07); color:var(--ink-soft); }
  .aqf-pol .r:last-child { border-bottom:0; }
  .aqf-pol .nm { font-size:20px; color:var(--ink-soft); line-height:1.1; }
  .aqf-pol .nm small { display:block; font-size:14px; color:var(--ink-faint); margin-top:2px; }
  .aqf-pol .tr { height:8px; border-radius:4px; background:rgba(234,255,244,.08); position:relative; overflow:hidden; }
  .aqf-pol .tr i { position:absolute; left:0; top:0; bottom:0; border-radius:4px; }
  .aqf-pol .ix { font-family:var(--font-display); font-size:24px; text-align:right; }
  .aqf-pol .cc { font-size:15px; color:var(--ink-faint); text-align:right; white-space:nowrap; }
  .aqf-pol .r.lead .nm { color:var(--ink); }
  .aqf-pol .nm small b { font-weight:500; color:var(--aqf-c, var(--mint)); }
  /* the scale, explained */
  .aqf-bands { display:flex; flex-direction:column; }
  .aqf-bands .r { display:grid; grid-template-columns:16px 92px 1fr; align-items:baseline; column-gap:16px;
    padding:7px 0; opacity:.5; }
  .aqf-bands .r.on { opacity:1; }
  .aqf-bands .dot { width:12px; height:12px; border-radius:50%; align-self:center; }
  .aqf-bands .rg { font-family:var(--font-display); font-size:19px; color:var(--ink); }
  .aqf-bands .nm { font-size:18px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .aqf-bands .nm small { font-size:15px; color:var(--ink-soft); margin-left:10px; }
  .aqf-ft { margin-top:auto; font-size:14px; color:var(--ink-faint); }
  .aqf-msg { margin:auto; font-size:20px; color:var(--ink-soft); }
`;

const airUrl = (lat, lon, tz) => `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
  + `&longitude=${lon}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,`
  + POLLUTANTS.map((p) => p.key).join(',')
  + `&hourly=us_aqi&forecast_days=2&past_days=1&timezone=${encodeURIComponent(tz)}`;

function renderFull(h, d, tz) {
  const cur = d.current || {};
  const aqi = cur.us_aqi;
  const cat = aqiCat(aqi);
  const lead = dominant(cur);
  const leadInfo = lead && POLL_INFO[lead.label];
  const vsy = vsYesterday(d.hourly, aqi, tz);
  const times = (d.hourly && d.hourly.time) || [];
  const vals = (d.hourly && d.hourly.us_aqi) || [];
  const i0 = nowIndex(times, tz);
  const next = [];
  for (let j = i0; j < Math.min(i0 + 24, vals.length); j++) next.push({ v: vals[j], hh: hourOfIso(times[j]) });
  const finite = next.filter((x) => Number.isFinite(x.v));
  const top = Math.max(110, ...finite.map((x) => x.v)) * 1.12;
  let peakI = -1;
  next.forEach((x, k) => { if (Number.isFinite(x.v) && (peakI < 0 || x.v > next[peakI].v)) peakI = k; });
  let lowI = -1;
  next.forEach((x, k) => { if (Number.isFinite(x.v) && (lowI < 0 || x.v < next[lowI].v)) lowI = k; });

  // Hero sentences — "why" names the driver; then how it compares with yesterday.
  const why = [];
  if (leadInfo) why.push(h('div', { class: 'why' }, 'Mostly ', h('b', {}, `${leadInfo.name.toLowerCase()} (${lead.label})`), ` — ${leadInfo.what}`));
  if (vsy) why.push(h('div', { class: 'why' }, `${vsy.word} — it was about ${vsy.was} at this hour`));
  else if (Number.isFinite(vals[i0 - 24])) why.push(h('div', { class: 'why' }, `About the same as this time yesterday (${Math.round(vals[i0 - 24])})`));

  const ahead = finite.length && peakI >= 0
    ? `peak ${Math.round(next[peakI].v)} at ${hrLabel(next[peakI].hh)} · cleanest ${Math.round(next[lowI].v)} at ${hrLabel(next[lowI].hh)}`
    : '';
  const chart = h('div', { class: 'aqf-chart' },
    ...[50, 100].filter((t) => t < top).map((t) => h('div', { class: 'th', style: { bottom: `${(t / top) * 100}%` } },
      h('span', {}, t === 50 ? '50 · good' : '100 · moderate'))),
    h('div', { class: 'bars' }, ...next.map((x, k) => {
      const ok = Number.isFinite(x.v);
      const b = h('div', {
        class: `b${k === 0 ? ' now' : ''}`,
        title: ok ? `${hrLabel(x.hh)} · AQI ${Math.round(x.v)} (${aqiCat(x.v).short})` : `${hrLabel(x.hh)} · no data`,
        style: { height: ok ? `${Math.max(2, (x.v / top) * 100)}%` : '2%', background: ok ? aqiCat(x.v).color : 'rgba(234,255,244,.12)' },
      });
      if (ok && (k === 0 || (k === peakI && x.v - next[0].v >= 5))) b.appendChild(h('span', { class: 'v' }, String(Math.round(x.v))));
      return b;
    })));
  const hrs = h('div', { class: 'aqf-hrs' }, ...next.map((x, k) =>
    h('span', {}, k === 0 ? 'now' : (k % 3 === 0 && x.hh != null ? hrShort(x.hh) : ''))));

  const pol = h('div', { class: 'aqf-pol' }, ...POLLUTANTS.map((p) => {
    const info = POLL_INFO[p.label];
    const ix = cur[p.key];
    const cc = cur[info.conc];
    const ok = Number.isFinite(ix);
    const col = ok ? aqiCat(ix).color : 'var(--ink-faint)';
    const isLead = lead && lead.label === p.label && aqi >= 20;
    return h('div', { class: `r${isLead ? ' lead' : ''}` },
      h('div', { class: 'nm' }, `${info.name} · ${p.label}`, h('small', {}, info.what, isLead ? h('b', {}, ' · drives the AQI') : null)),
      h('div', { class: 'tr' }, h('i', { style: { width: ok ? `${Math.max(1.5, Math.min(100, (ix / 300) * 100))}%` : '0', background: col } })),
      h('div', { class: 'ix', style: { color: col } }, ok ? String(Math.round(ix)) : '—'),
      h('div', { class: 'cc' }, Number.isFinite(cc) ? `${cc >= 100 ? Math.round(cc) : cc.toFixed(1)} ${info.unit}` : '—'));
  }));

  const curBand = CATS.indexOf(cat);
  const bands = h('div', { class: 'aqf-bands' }, ...CATS.map((c, k) => h('div', { class: `r${k === curBand ? ' on' : ''}` },
    h('span', { class: 'dot', style: { background: c.color } }),
    h('span', { class: 'rg' }, BAND_RANGES[k]),
    h('span', { class: 'nm' }, BAND_NAMES[k], h('small', {}, c.tip)))));

  const upd = cur.time ? hourOfIso(cur.time) : null;
  return [
    h('div', { class: 'aqf-hero' },
      h('div', { class: 'num' }, String(Math.round(aqi))),
      h('div', { class: 'tx' }, h('div', { class: 'cat' }, cat.short === 'Sensitive' ? 'Unhealthy for sensitive groups' : BAND_NAMES[curBand]),
        h('div', { class: 'tip' }, `${cat.tip}.`), ...why)),
    h('section', {}, h('div', { class: 'sec' }, h('span', {}, 'Next 24 hours'), h('span', { class: 'key' }, ahead)), chart, hrs),
    h('section', {}, h('div', { class: 'sec' }, h('span', {}, "What's in the air"), h('span', { class: 'key' }, 'sub-index (0–300) · concentration')), pol),
    h('section', {}, h('div', { class: 'sec' }, h('span', {}, 'What the numbers mean'), h('span', { class: 'key' }, 'US AQI')), bands),
    h('div', { class: 'aqf-ft' }, `US AQI is the worst of the pollutant sub-indices · Open-Meteo (CAMS model)${upd != null ? ` · as of ${hrLabel(upd)}` : ''}`),
  ];
}

export default {
  id: 'air-quality',
  title: 'Air',
  icon: '🌬',
  size: 'md', // half width — shares the top row with the clock (Arcade moved off-grid 2026-10-01)
  chrome: true,
  async openFull(body, ctx) {
    const { h } = ctx;
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(FULL_STYLE);
    // Full-size from the first frame (layout-stability rule): the root keeps its
    // fixed height while loading; content only fades in.
    const root = h('div', { class: 'aqf' });
    body.replaceChildren(root);
    let d = null;
    for (let attempt = 1; attempt <= 3 && !d; attempt++) {
      try {
        const r = await ctx.fetchJSON(airUrl(lat, lon, tz));
        if (r && r.current && Number.isFinite(r.current.us_aqi)) d = r;
      } catch { /* retry */ }
      if (!d && attempt < 3) await new Promise((res) => setTimeout(res, 1200 * attempt));
    }
    if (!body.isConnected) return;
    if (!d) {
      root.replaceChildren(h('div', { class: 'aqf-msg' }, 'Air quality is unavailable right now — try again in a few minutes.'));
    } else {
      body.style.setProperty('--aqf-c', aqiCat(d.current.us_aqi).color);
      root.replaceChildren(...renderFull(h, d, tz));
    }
    requestAnimationFrame(() => root.classList.add('on'));
  },
  async mount(body, ctx) {
    const { h } = ctx;
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .aqs { display:flex; flex-direction:column; justify-content:safe center; gap:5px; height:100%; min-height:0; }
      .aqs > * { flex-shrink:0; }
      .aqs .numrow { display:flex; align-items:center; gap:12px; }
      /* category word + trend stacked beside the number (2026-10-21) — folds the
         old standalone category row into the number row so the tile fits its
         frame instead of spilling up under the "AIR" title. */
      .aqs .side { display:flex; flex-direction:column; gap:5px; min-width:0; }
      .aqs .numrow .pm { align-self:flex-start; margin-top:4px; }
      .aqs .numrow .pm { margin-left:auto; min-width:0; }
      .aqs .num { font-family:var(--font-display); font-weight:400; font-size:60px; line-height:.85;
        color:var(--aqs-c, var(--ink)); }
      /* trend arrow beside the number — glanceable sense of where the air is headed */
      .aqs .trend { display:inline-flex; align-items:baseline; gap:3px; line-height:1; }
      .aqs .trend .ar { font-size:26px; font-weight:700; color:var(--ink-faint); }
      .aqs .trend .tl { font-family:var(--font-mono); font-size:13px; letter-spacing:.05em;
        color:var(--ink-faint); text-transform:lowercase; }
      .aqs .cat { font-family:var(--font-display); font-weight:400; font-size:24px; color:var(--aqs-c, var(--ink)); line-height:1;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* quiet health cue — one ellipsized line so it never pushes the scale out
         of the tile. */
      .aqs .tip { font-size:14.5px; line-height:1.28; color:var(--ink-soft); margin-top:-1px;
        display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
      /* "vs. yesterday" cue — a compact coloured line shown only when the air
         shifted notably from the same hour yesterday. It REPLACES the health tip
         (which moves to its tooltip) so the tile always has exactly one cue line.
         A mint ↓ reads "cleared overnight"; a warm ↑ reads "smokier than yesterday". */
      .aqs .vsy { font-size:14.5px; line-height:1.28; font-weight:700; letter-spacing:.01em;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex;
        align-items:baseline; gap:4px; }
      .aqs .vsy .ar { font-weight:700; flex:0 0 auto; }
      .aqs .vsy .was { font-weight:500; opacity:.72; flex:0 0 auto; }
      .aqs .tip.one { -webkit-line-clamp:1; }
      /* static gradient AQI scale (0→300+) with a marker showing today's position —
         a glanceable sense of how close we are to unhealthy. No animation. */
      .aqs .scale { position:relative; height:7px; border-radius:4px; margin:8px 0 0;
        background:linear-gradient(90deg,
          #74f7b0 0%, #74f7b0 13%,
          #f7d774 21%, #f7d774 30%,
          #f7a374 41%, #f7a374 47%,
          #f77474 57%, #f77474 64%,
          #c074f7 80%, #c074f7 88%,
          #f74a74 100%); }
      .aqs .scale .mark { position:absolute; top:-3px; width:3px; height:12px; border-radius:2px;
        background:#fff; box-shadow:0 0 4px rgba(0,0,0,.65); transform:translateX(-50%); }
      /* forecast-peak tick — where today's air is headed at its worst. Slimmer,
         hollow-feeling and tinted to the peak's own category so it reads as a
         quiet "later" marker distinct from the solid white "now" tick. Sits
         inside the bar's bounds, adding no height. */
      .aqs .scale .peak { position:absolute; top:-2px; width:2px; height:10px; border-radius:2px;
        background:var(--aqs-peak, #fff); opacity:.9; transform:translateX(-50%);
        box-shadow:0 0 5px var(--aqs-peak, rgba(255,255,255,.7)); }
      .aqs .scale .peak::after { content:''; position:absolute; left:50%; top:-4px;
        width:5px; height:5px; border-radius:50%; transform:translateX(-50%);
        background:var(--aqs-peak, #fff); box-shadow:0 0 5px var(--aqs-peak, rgba(255,255,255,.7)); }
      /* band ticks under the scale — the category boundaries named in quiet
         numerals, so the white marker's position reads as a number at a glance. */
      .aqs .ticks { position:relative; height:13px; margin-top:3px; }
      .aqs .ticks span { position:absolute; top:0; transform:translateX(-50%); font-family:var(--font-mono);
        font-size:11.5px; line-height:1; color:var(--ink-faint); letter-spacing:.02em; white-space:nowrap; }
      .aqs .ticks span:first-child { transform:none; }
      .aqs .ticks span:last-child { transform:translateX(-100%); }
      /* footer: PM2.5 concentration, plus a quiet tag naming the pollutant that
         actually drives today's reading — but only when it ISN'T PM2.5, so the line
         stays calm on ordinary days and speaks up only when there's a reason to. */
      .aqs .pm { font-family:var(--font-mono); font-size:13.5px; color:var(--ink-faint);
        letter-spacing:.06em; display:flex; align-items:baseline; gap:6px; white-space:nowrap;
        overflow:hidden; text-overflow:ellipsis; }
      .aqs .pm .lead { color:var(--aqs-c, var(--ink-soft)); font-weight:700; letter-spacing:.04em; flex:0 0 auto; }
      .aqs .pm .val { overflow:hidden; text-overflow:ellipsis; }
    `);
    body.classList.add('aqs');
    body.appendChild(ctx.loading('air…'));

    const render = async ({ retry = false } = {}) => {
      try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
          + `&longitude=${lon}&current=us_aqi,pm2_5,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,`
          + `us_aqi_nitrogen_dioxide,us_aqi_sulphur_dioxide,us_aqi_carbon_monoxide`
          + `&hourly=us_aqi&forecast_days=2&past_days=1`
          + `&timezone=${encodeURIComponent(tz)}`;
        const d = await ctx.fetchJSON(url);
        const aqi = d && d.current && d.current.us_aqi;
        const pm = d && d.current && d.current.pm2_5;
        if (aqi == null) {
          if (retry) throw new Error('no reading');
          if (!body.dataset.loaded) body.replaceChildren(ctx.error('no reading'));
          return;
        }
        const cat = aqiCat(aqi);
        body.style.setProperty('--aqs-c', cat.color);
        // Position on a 0–300 scale, clamped just inside the bar's edges.
        const posOf = (v) => Math.max(2, Math.min(98, (Math.min(v, 300) / 300) * 100));
        const pos = posOf(aqi);
        const trend = aqiTrend(d.hourly, tz);
        // Forecast peak: only surfaced when the air is expected to climb a full
        // category-ish step (≥15 AQI) above now — so the tile stays calm on
        // steady days and speaks up only when there's a reason to.
        const peak = aqiPeak(d.hourly, tz);
        const showPeak = peak && peak.val - aqi >= 15;
        if (showPeak) body.style.setProperty('--aqs-peak', aqiCat(peak.val).color);
        // How the air compares to the same hour yesterday (overnight shift). Shown
        // above the health tip only when it moved notably; the tip then drops to a
        // single line so the pair keeps the tip's original two-line footprint.
        const vsy = vsYesterday(d.hourly, aqi, tz);
        const hr12 = (hh) => `${((hh + 11) % 12) + 1}${hh < 12 ? 'a' : 'p'}`;
        // Which pollutant is driving the AQI? Only surfaced when it's NOT PM2.5
        // (which is already shown) and the air is at least worth a glance.
        const lead = dominant(d.current);
        const showLead = lead && lead.label !== 'PM2.5' && aqi >= 40;
        const side = h('div', { class: 'side' }, h('div', { class: 'cat', title: 'US AQI · SF' }, cat.short));
        const numrow = h('div', { class: 'numrow', title: vsy ? `${cat.tip} · ${vsy.word}, was ~${vsy.was} at this hour yesterday` : cat.tip },
          h('div', { class: 'num' }, String(Math.round(aqi))), side);
        const pmEl = h('div', {
            class: 'pm',
            title: showLead
              ? `${lead.label} is the main pollutant today · PM2.5 ${pm == null ? '—' : pm.toFixed(1)} µg/m³`
              : 'PM2.5 · fine particulate (µg/m³)',
          },
            showLead ? h('span', { class: 'lead' }, `${lead.label} lead`) : null,
            h('span', { class: 'val' }, pm == null ? 'PM2.5 —' : `PM2.5 ${pm.toFixed(1)}`));
        if (trend && trend.label !== 'steady') { // only when the air is changing ("steady" removed 2026-10-30)
          side.appendChild(h('div', {
            class: 'trend',
            title: `Air quality ${trend.label} over the next 6 hours`,
          }, h('span', { class: 'ar', style: { color: trend.color } }, trend.arrow),
            h('span', { class: 'tl' }, trend.label)));
        }
        numrow.appendChild(pmEl);
        // NOTE: native Node.replaceChildren coerces a null argument to the text
        // node "null" (unlike ctx.h, which drops null children). So build the
        // top-level children as an array and filter falsy entries out — otherwise
        // the calm-air day (no "vs. yesterday" cue) prints a stray "null" line.
        body.replaceChildren(...[
          numrow,
          // (the health-tip / "vs yesterday" line under the reading removed 2026-10-30 at the
          // humans' request — the tip stays as the reading's tooltip)
          h('div', {
            class: 'scale',
            title: showPeak
              ? `AQI ${Math.round(aqi)} now · up to ~${Math.round(peak.val)} by ${hr12(peak.hour)} (${aqiCat(peak.val).short})`
              : 'AQI 0–300+ scale',
          },
            showPeak ? h('div', {
              class: 'peak',
              style: { left: `${posOf(peak.val)}%` },
            }) : null,
            h('div', { class: 'mark', style: { left: `${pos}%` } })),
          h('div', { class: 'ticks', 'aria-hidden': 'true' },
            ...[0, 50, 100, 150, 200, 300].map((v) => h('span', { style: { left: `${(v / 300) * 100}%` } },
              v === 300 ? '300+' : String(v)))),
          // (12-hour outlook bars removed 2026-10-07 at the humans' request)
        ].filter(Boolean));
        body.dataset.loaded = '1';
      } catch (e) {
        if (retry) throw e;
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('air unavailable'));
      }
    };
    // Initial load: a few attempts with short backoff so one slow/aborted response
    // doesn't drop the tile to an error for a whole 15-minute refresh cycle.
    (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await render({ retry: true }); return; }
        catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt)); }
      }
      if (!body.dataset.loaded) body.replaceChildren(ctx.error('air unavailable'));
    })();
    // Steady refresh; on failure KEEP the last good reading (don't blank). The
    // initial load above already fetched, so skip this interval's immediate tick.
    let firstTick = true;
    ctx.interval(() => {
      if (firstTick) { firstTick = false; return; }
      render().catch(() => {});
    }, 15 * 60 * 1000);
  },
};
