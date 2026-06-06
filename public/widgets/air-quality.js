// Air Quality — current US AQI + PM2.5, via keyless Open-Meteo (through proxy).
// AQI category breakpoints + color per US EPA scale.
const CATS = [
  { max: 50,  label: 'Good',                           color: '#74f7b0' },
  { max: 100, label: 'Moderate',                        color: '#f7d774' },
  { max: 150, label: 'Unhealthy for Sensitive Groups',  color: '#f7a374' },
  { max: 200, label: 'Unhealthy',                        color: '#f77474' },
  { max: 300, label: 'Very Unhealthy',                   color: '#c074f7' },
  { max: Infinity, label: 'Hazardous',                   color: '#f74a74' },
];
const aqiCat = (v) => CATS.find((c) => v <= c.max) || CATS[CATS.length - 1];

export default {
  id: 'air-quality',
  title: 'Air Quality',
  icon: '🌬',
  size: 'sm',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .aq { display:flex; align-items:center; gap:16px; height:100%; }
      .aq-num { font-family:var(--font-display); font-size:58px; font-weight:700; line-height:.85;
        color:var(--aq-color, var(--ink)); text-shadow:0 4px 16px rgba(0,0,0,.4); }
      .aq-side { flex:1; min-width:0; display:flex; flex-direction:column; gap:7px; }
      .aq-unit { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint); letter-spacing:.08em; }
      .aq-cat { font-size:16px; font-weight:600; color:var(--aq-color, var(--ink)); line-height:1.18;
        display:flex; align-items:flex-start; gap:7px; }
      .aq-cat .aq-dot { margin-top:5px; }
      .aq-pm { display:flex; align-items:baseline; gap:6px; font-size:13px; color:var(--ink-soft); }
      .aq-pm .v { font-family:var(--font-mono); font-weight:600; color:var(--ink); font-size:15px; }
      .aq-pm .u { font-size:11px; color:var(--ink-faint); }
      .aq-dot { flex:0 0 auto; width:9px; height:9px; border-radius:50%; background:var(--aq-color, var(--ink-faint));
        box-shadow:0 0 9px var(--aq-color, transparent); }
    `);
    body.appendChild(ctx.loading('sampling the air…'));

    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
        + `&longitude=${lon}&current=us_aqi,pm2_5&timezone=${encodeURIComponent(tz)}`;
      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const cur = d && d.current;
        const aqi = cur ? cur.us_aqi : null;
        const pm = cur ? cur.pm2_5 : null;
        if (aqi == null) {
          body.replaceChildren(ctx.error('no air-quality reading'));
          return;
        }
        const cat = aqiCat(aqi);
        const card = ctx.h('div', { class: 'aq', style: { '--aq-color': cat.color } },
          ctx.h('div', { class: 'aq-num' }, String(Math.round(aqi))),
          ctx.h('div', { class: 'aq-side' },
            ctx.h('div', { class: 'aq-unit' }, 'US AQI'),
            ctx.h('div', { class: 'aq-cat' },
              ctx.h('span', { class: 'aq-dot' }), cat.label),
            ctx.h('div', { class: 'aq-pm' },
              'PM2.5',
              ctx.h('span', { class: 'v' }, pm == null ? '—' : pm.toFixed(1)),
              ctx.h('span', { class: 'u' }, 'µg/m³'))));
        body.replaceChildren(card);
      };
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('air quality unavailable'));
    }
  },
};
