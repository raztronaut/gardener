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
// WHO UV-index bands — colour-matched to the same palette as the AQI scale.
const UV = [
  { max: 2,        short: 'Low',       color: '#74f7b0' },
  { max: 5,        short: 'Moderate',  color: '#f7d774' },
  { max: 7,        short: 'High',      color: '#f7a374' },
  { max: 10,       short: 'Very high', color: '#f77474' },
  { max: Infinity, short: 'Extreme',   color: '#c074f7' },
];
const uvCat = (v) => UV.find((c) => v <= c.max) || UV[UV.length - 1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: 'air-quality',
  title: 'Air Quality',
  icon: '🌬',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .aq { display:flex; flex-direction:column; gap:14px; height:100%; justify-content:center; }
      /* top row: the AQI reading at left, PM2.5 as a tidy stat block at right */
      .aq-head { display:flex; align-items:center; gap:16px; }
      .aq-read { display:flex; align-items:baseline; gap:12px; min-width:0; flex:1; }
      .aq-num { font-family:var(--font-display); font-size:58px; font-weight:700; line-height:.82;
        color:var(--aq-color, var(--ink)); flex:0 0 auto; }
      .aq-meta { display:flex; flex-direction:column; gap:4px; min-width:0; }
      .aq-unit { font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); letter-spacing:.16em; }
      .aq-cat { font-size:20px; font-weight:700; color:var(--aq-color, var(--ink)); line-height:1.05;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* PM2.5 stat block, right-aligned, divided from the reading */
      .aq-pm { flex:0 0 auto; display:flex; flex-direction:column; align-items:flex-end; gap:3px;
        padding-left:16px; border-left:1px solid var(--stroke); }
      .aq-pm .v { font-family:var(--font-mono); font-weight:700; color:var(--ink); font-size:21px; line-height:1; }
      .aq-pm .k { font-family:var(--font-mono); font-size:9.5px; color:var(--ink-faint); letter-spacing:.12em; }
      /* health note — a calm full-width line keyed to the category colour, with
         a colour-coded UV-index pill tucked at the right (sun matters in SF). */
      .aq-tip { font-size:14px; line-height:1.3; color:var(--ink-soft); display:flex; align-items:center; gap:9px; }
      .aq-tip .pip { flex:0 0 auto; width:8px; height:8px; border-radius:50%; background:var(--aq-color, var(--ink-faint));
        box-shadow:0 0 10px var(--aq-color, transparent); }
      .aq-tip .txt { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .aq-uv { flex:0 0 auto; display:flex; align-items:center; gap:7px; padding:3px 11px; border-radius:999px;
        background:rgba(255,255,255,.045); border:1px solid var(--stroke); }
      .aq-uv .d { width:8px; height:8px; border-radius:50%; background:var(--uv-color); box-shadow:0 0 8px var(--uv-color); }
      .aq-uv .v { font-family:var(--font-mono); font-weight:700; font-size:13px; color:var(--ink); line-height:1; }
      .aq-uv .l { font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-faint); }
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
        + `&longitude=${lon}&current=us_aqi,pm2_5,uv_index&timezone=${encodeURIComponent(tz)}`;
      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const cur = d && d.current;
        const aqi = cur ? cur.us_aqi : null;
        const pm = cur ? cur.pm2_5 : null;
        const uv = cur && cur.uv_index != null ? cur.uv_index : null;
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
            ctx.h('div', { class: 'aq-read' },
              ctx.h('div', { class: 'aq-num' }, String(Math.round(aqi))),
              ctx.h('div', { class: 'aq-meta' },
                ctx.h('div', { class: 'aq-unit' }, 'US AQI · SF'),
                ctx.h('div', { class: 'aq-cat', title: cat.label }, cat.short))),
            ctx.h('div', { class: 'aq-pm' },
              ctx.h('span', { class: 'v' }, pm == null ? '—' : pm.toFixed(1)),
              ctx.h('span', { class: 'k' }, 'PM2.5 µg/m³'))),
          ctx.h('div', { class: 'aq-tip', title: cat.tip },
            ctx.h('span', { class: 'pip' }),
            ctx.h('span', { class: 'txt' }, cat.tip),
            uv == null ? null : (() => {
              const u = uvCat(uv);
              return ctx.h('div', { class: 'aq-uv', style: { '--uv-color': u.color },
                title: `UV index ${uv.toFixed(1)} — ${u.short}` },
                ctx.h('span', { class: 'd' }),
                ctx.h('span', { class: 'v' }, `UV ${Math.round(uv)}`),
                ctx.h('span', { class: 'l' }, u.short));
            })()),
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
