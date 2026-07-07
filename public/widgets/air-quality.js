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

// Trend over the next ~6h from the hourly US-AQI series. Semantic colours: air
// getting cleaner reads mint (down = good for pollution), worsening reads rose,
// steady stays quiet. Returns null when there isn't enough data to be honest.
function aqiTrend(hourly, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const nowH = new Date().getHours();
  // Find the hour index matching "now" (times are local to the requested tz).
  let i = times.findIndex((t) => new Date(t).getHours() === nowH);
  if (i < 0) i = 0;
  const cur = vals[i];
  const ahead = vals[i + 6];
  if (!Number.isFinite(cur) || !Number.isFinite(ahead)) return null;
  const diff = ahead - cur;
  if (diff <= -8) return { arrow: '↘', color: '#74f7b0', label: 'easing' };
  if (diff >= 8) return { arrow: '↗', color: '#f7a374', label: 'rising' };
  return { arrow: '→', color: 'var(--ink-faint)', label: 'steady' };
}

export default {
  id: 'air-quality',
  title: 'Air',
  icon: '🌬',
  size: 'sq',
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .aqs { display:flex; flex-direction:column; justify-content:center; gap:6px; height:100%; min-height:0; }
      .aqs .numrow { display:flex; align-items:baseline; gap:8px; }
      .aqs .num { font-family:var(--font-display); font-weight:700; font-size:40px; line-height:.85;
        color:var(--aqs-c, var(--ink)); }
      /* trend arrow beside the number — glanceable sense of where the air is headed */
      .aqs .trend { display:inline-flex; align-items:baseline; gap:3px; line-height:1; }
      .aqs .trend .ar { font-size:22px; font-weight:700; color:var(--ink-faint); }
      .aqs .trend .tl { font-family:var(--font-mono); font-size:9px; letter-spacing:.05em;
        color:var(--ink-faint); text-transform:lowercase; }
      .aqs .cat { font-size:14px; font-weight:700; color:var(--aqs-c, var(--ink)); line-height:1;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* quiet health cue under the category — clamped to 2 lines so it never
         pushes the scale/PM rows out of the small square tile. */
      .aqs .tip { font-size:11px; line-height:1.28; color:var(--ink-soft); margin-top:-1px;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      /* static gradient AQI scale (0→300+) with a marker showing today's position —
         a glanceable sense of how close we are to unhealthy. No animation. */
      .aqs .scale { position:relative; height:6px; border-radius:3px; margin:3px 0 2px;
        background:linear-gradient(90deg,
          #74f7b0 0%, #74f7b0 13%,
          #f7d774 21%, #f7d774 30%,
          #f7a374 41%, #f7a374 47%,
          #f77474 57%, #f77474 64%,
          #c074f7 80%, #c074f7 88%,
          #f74a74 100%); }
      .aqs .scale .mark { position:absolute; top:-3px; width:3px; height:12px; border-radius:2px;
        background:#fff; box-shadow:0 0 4px rgba(0,0,0,.65); transform:translateX(-50%); }
      .aqs .pm { font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); letter-spacing:.06em; }
    `);
    body.classList.add('aqs');
    body.appendChild(ctx.loading('air…'));

    const render = async () => {
      try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
          + `&longitude=${lon}&current=us_aqi,pm2_5&hourly=us_aqi&forecast_days=1`
          + `&timezone=${encodeURIComponent(tz)}`;
        const d = await ctx.fetchJSON(url);
        const aqi = d && d.current && d.current.us_aqi;
        const pm = d && d.current && d.current.pm2_5;
        if (aqi == null) {
          if (!body.dataset.loaded) body.replaceChildren(ctx.error('no reading'));
          return;
        }
        const cat = aqiCat(aqi);
        body.style.setProperty('--aqs-c', cat.color);
        // Marker position on a 0–300 scale, clamped just inside the bar's edges.
        const pos = Math.max(2, Math.min(98, (Math.min(aqi, 300) / 300) * 100));
        const trend = aqiTrend(d.hourly, tz);
        const numrow = h('div', { class: 'numrow' }, h('div', { class: 'num' }, String(Math.round(aqi))));
        if (trend) {
          numrow.appendChild(h('div', {
            class: 'trend',
            title: `Air quality ${trend.label} over the next 6 hours`,
          }, h('span', { class: 'ar', style: { color: trend.color } }, trend.arrow),
            h('span', { class: 'tl' }, trend.label)));
        }
        body.replaceChildren(
          numrow,
          h('div', { class: 'cat', title: 'US AQI · SF' }, cat.short),
          h('div', { class: 'tip', title: cat.tip }, cat.tip),
          h('div', { class: 'scale', title: 'AQI 0–300+ scale' },
            h('div', { class: 'mark', style: { left: `${pos}%` } })),
          h('div', { class: 'pm' }, pm == null ? 'PM2.5 —' : `PM2.5 ${pm.toFixed(1)}`));
        body.dataset.loaded = '1';
      } catch {
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('air unavailable'));
      }
    };
    render();
    ctx.interval(render, 15 * 60 * 1000);
  },
};
