// Air Quality — current US AQI + PM2.5, via keyless Open-Meteo (through proxy).
// Full-width bottom strip: big reading at left, EPA color scale across the row,
// plus a short category-aware health note so the number actually means something.
// AQI breakpoints + color per US EPA.
const CATS = [
  { max: 50,  label: 'Good',                          short: 'Good',        color: '#74f7b0', tip: 'Clean air — breathe easy' },
  { max: 100, label: 'Moderate',                       short: 'Moderate',    color: '#f7d774', tip: 'Fine for most — sensitive folks take note' },
  { max: 150, label: 'Unhealthy for sensitive groups', short: 'Sensitive',   color: '#f7a374', tip: 'Sensitive groups: ease up outdoors' },
  { max: 200, label: 'Unhealthy',                       short: 'Unhealthy',   color: '#f77474', tip: 'Limit prolonged time outdoors' },
  { max: 300, label: 'Very unhealthy',                  short: 'Very bad',    color: '#c074f7', tip: 'Avoid outdoor exertion' },
  { max: Infinity, label: 'Hazardous',                  short: 'Hazardous',   color: '#f74a74', tip: 'Stay indoors if you can' },
];
const aqiCat = (v) => CATS.find((c) => v <= c.max) || CATS[CATS.length - 1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: 'air-quality',
  title: 'Air Quality',
  icon: '🌬',
  size: 'lg',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .aq { display:flex; flex-direction:column; gap:11px; height:100%; justify-content:center; }
      .aq-head { display:flex; align-items:center; gap:14px; }
      .aq-num { font-family:var(--font-display); font-size:50px; font-weight:700; line-height:.82;
        color:var(--aq-color, var(--ink)); text-shadow:0 4px 16px rgba(0,0,0,.4); }
      .aq-side { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
      .aq-unit { font-family:var(--font-mono); font-size:10.5px; color:var(--ink-faint); letter-spacing:.1em; }
      .aq-cat { font-size:18px; font-weight:700; color:var(--aq-color, var(--ink)); line-height:1.05;
        display:flex; align-items:center; gap:8px; }
      .aq-cat .lbl { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .aq-pm { display:flex; align-items:baseline; gap:6px; font-size:13px; color:var(--ink-soft); }
      .aq-pm .v { font-family:var(--font-mono); font-weight:600; color:var(--ink); font-size:15px; }
      .aq-pm .u { font-size:10px; color:var(--ink-faint); }
      .aq-tip { font-size:13.5px; line-height:1.25; color:var(--ink-soft); display:flex; align-items:center; gap:8px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .aq-tip .pip { flex:0 0 auto; width:6px; height:6px; border-radius:50%; background:var(--aq-color, var(--ink-faint)); }
      .aq-dot { flex:0 0 auto; width:10px; height:10px; border-radius:50%; background:var(--aq-color, var(--ink-faint));
        box-shadow:0 0 11px var(--aq-color, transparent); }
      .aq-scalewrap { width:100%; }
      .aq-scale { position:relative; height:11px; border-radius:999px;
        background:linear-gradient(90deg,#74f7b0 0%,#f7d774 25%,#f7a374 42%,#f77474 58%,#c074f7 78%,#f74a74 100%);
        opacity:.92; }
      .aq-mark { position:absolute; top:50%; width:17px; height:17px; border-radius:50%;
        transform:translate(-50%,-50%); background:var(--ink); border:3px solid var(--aq-color,#fff);
        box-shadow:0 2px 8px rgba(0,0,0,.5); }
      .aq-ticks { display:flex; justify-content:space-between; font-family:var(--font-mono);
        font-size:9.5px; color:var(--ink-faint); letter-spacing:.02em; margin-top:3px; }
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
        // A bad/empty reading should not blank a card that already has good data.
        if (aqi == null) {
          if (!body.dataset.loaded) body.replaceChildren(ctx.error('no air-quality reading'));
          return;
        }
        const cat = aqiCat(aqi);
        // Scale spans 0–300 (clamped); matches the gradient stops above.
        const pct = Math.max(2, Math.min(98, (Math.min(aqi, 300) / 300) * 100));
        const card = ctx.h('div', { class: 'aq', style: { '--aq-color': cat.color } },
          ctx.h('div', { class: 'aq-head' },
            ctx.h('div', { class: 'aq-num' }, String(Math.round(aqi))),
            ctx.h('div', { class: 'aq-side' },
              ctx.h('div', { class: 'aq-unit' }, 'US AQI · SF'),
              ctx.h('div', { class: 'aq-cat' },
                ctx.h('span', { class: 'aq-dot' }),
                ctx.h('span', { class: 'lbl', title: cat.label }, cat.short)),
              ctx.h('div', { class: 'aq-pm' },
                'PM2.5',
                ctx.h('span', { class: 'v' }, pm == null ? '—' : pm.toFixed(1)),
                ctx.h('span', { class: 'u' }, 'µg/m³')))),
          ctx.h('div', { class: 'aq-tip', title: cat.tip },
            ctx.h('span', { class: 'pip' }),
            ctx.h('span', {}, cat.tip)),
          ctx.h('div', { class: 'aq-scalewrap' },
            ctx.h('div', { class: 'aq-scale' },
              ctx.h('div', { class: 'aq-mark', style: { left: pct + '%' } })),
            ctx.h('div', { class: 'aq-ticks' },
              ctx.h('span', {}, 'Good'),
              ctx.h('span', {}, 'Moderate'),
              ctx.h('span', {}, 'Unhealthy'),
              ctx.h('span', {}, 'Hazardous'))));
        body.replaceChildren(card);
        body.dataset.loaded = '1';
      };
      // Initial load: a few attempts so one slow/aborted response doesn't blank
      // the widget for a whole refresh cycle.
      let loaded = false;
      for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
        try { await refresh(); loaded = true; }
        catch { if (attempt < 3) await sleep(900 * attempt); }
      }
      if (!loaded) body.replaceChildren(ctx.error('air quality unavailable — retrying…'));
      // Steady refresh; on failure KEEP the last good reading (don't blank).
      ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('air quality unavailable'));
    }
  },
};
