// Air Quality — current US AQI + PM2.5 (Open-Meteo) plus a pollen index
// (pollen.com, keyed by SF ZIP) — all keyless, through the SSRF-safe proxy.

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

// pollen.com uses a 0–12 index. Collapse to readable bands.
function pollenCat(v) {
  if (v == null) return { label: '—', color: 'var(--ink-faint)' };
  if (v <= 2.4) return { label: 'Low',       color: '#74f7b0' };
  if (v <= 4.8) return { label: 'Low–Med',   color: '#bff77a' };
  if (v <= 7.2) return { label: 'Moderate',  color: '#f7d774' };
  if (v <= 9.6) return { label: 'High',      color: '#f7a374' };
  return { label: 'Very High', color: '#f77474' };
}

export default {
  id: 'air-quality',
  title: 'Air Quality',
  icon: '🌬',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    const ZIP = '94121'; // San Francisco (Outer Richmond) — pollen.com keys by ZIP
    ctx.style(`
      .aq { display:flex; flex-direction:column; gap:16px; }
      .aq-main { display:flex; align-items:baseline; gap:14px; }
      .aq-num { font-family:var(--font-display); font-size:64px; font-weight:700; line-height:.9;
        color:var(--aq-color, var(--ink)); text-shadow:0 4px 16px rgba(0,0,0,.4); }
      .aq-unit { font-family:var(--font-mono); font-size:14px; color:var(--ink-faint); letter-spacing:.05em; }
      .aq-cat { font-size:18px; font-weight:600; color:var(--aq-color, var(--ink)); line-height:1.2;
        display:flex; align-items:center; gap:8px; }
      .aq-dot { width:10px; height:10px; border-radius:50%; background:var(--aq-color, var(--ink-faint));
        box-shadow:0 0 10px var(--aq-color, transparent); flex:0 0 auto; }
      .aq-rows { display:flex; flex-direction:column; gap:10px; border-top:1px solid var(--stroke); padding-top:14px; }
      .aq-row { display:flex; align-items:baseline; gap:10px; font-size:15px; color:var(--ink-soft); }
      .aq-row .lbl { flex:0 0 64px; color:var(--ink-faint); letter-spacing:.04em; }
      .aq-row .v { font-family:var(--font-mono); font-weight:600; color:var(--ink); }
      .aq-row .u { font-size:12px; color:var(--ink-faint); }
      .aq-row .tag { font-weight:600; }
      .aq-row .trig { margin-left:auto; font-size:12px; color:var(--ink-faint);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:50%; }
    `);
    body.appendChild(ctx.loading('sampling the air…'));

    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
      + `&longitude=${lon}&current=us_aqi,pm2_5&timezone=${encodeURIComponent(tz)}`;
    const pollenUrl = `https://www.pollen.com/api/forecast/current/pollen/${ZIP}`;

    // Pollen is a fragile unofficial endpoint — fetch it independently so a
    // failure only blanks the pollen row, never the whole widget.
    async function getPollen() {
      try {
        const d = await ctx.fetchJSON(pollenUrl);
        const periods = d && d.Location && Array.isArray(d.Location.periods) ? d.Location.periods : [];
        const today = periods.find((p) => p && p.Type === 'Today') || periods[0];
        if (!today || typeof today.Index !== 'number') return null;
        const triggers = Array.isArray(today.Triggers)
          ? today.Triggers.map((t) => t && t.Name).filter(Boolean) : [];
        return { index: today.Index, triggers };
      } catch { return null; }
    }

    try {
      const refresh = async () => {
        const [aqData, pollen] = await Promise.all([ctx.fetchJSON(aqUrl), getPollen()]);
        const cur = aqData && aqData.current;
        const aqi = cur ? cur.us_aqi : null;
        const pm = cur ? cur.pm2_5 : null;
        if (aqi == null) { body.replaceChildren(ctx.error('no air-quality reading')); return; }
        const cat = aqiCat(aqi);
        const pc = pollenCat(pollen ? pollen.index : null);
        const trig = pollen && pollen.triggers.length ? pollen.triggers.slice(0, 2).join(', ') : '';

        body.replaceChildren(ctx.h('div', { class: 'aq', style: { '--aq-color': cat.color } },
          ctx.h('div', { class: 'aq-main' },
            ctx.h('div', { class: 'aq-num' }, String(Math.round(aqi))),
            ctx.h('div', { class: 'aq-unit' }, 'US AQI')),
          ctx.h('div', { class: 'aq-cat' }, ctx.h('span', { class: 'aq-dot' }), cat.label),
          ctx.h('div', { class: 'aq-rows' },
            ctx.h('div', { class: 'aq-row' },
              ctx.h('span', { class: 'lbl' }, 'PM2.5'),
              ctx.h('span', { class: 'v' }, pm == null ? '—' : pm.toFixed(1)),
              ctx.h('span', { class: 'u' }, 'µg/m³')),
            ctx.h('div', { class: 'aq-row' },
              ctx.h('span', { class: 'lbl' }, 'Pollen'),
              ctx.h('span', { class: 'v' }, pollen ? pollen.index.toFixed(1) : '—'),
              ctx.h('span', { class: 'tag', style: { color: pc.color } }, pc.label),
              trig ? ctx.h('span', { class: 'trig' }, trig) : null))));
      };
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 30 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('air quality unavailable'));
    }
  },
};
