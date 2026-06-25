// Air Quality — a compact square tile: the US AQI reading, its category, and PM2.5.
// Keyless Open-Meteo air-quality API (through the proxy). Sized 'sq' (quarter-width
// square) so two small tiles fit where one half-width card used to.
const CATS = [
  { max: 50, short: 'Good', color: '#74f7b0' },
  { max: 100, short: 'Moderate', color: '#f7d774' },
  { max: 150, short: 'Sensitive', color: '#f7a374' },
  { max: 200, short: 'Unhealthy', color: '#f77474' },
  { max: 300, short: 'Very bad', color: '#c074f7' },
  { max: Infinity, short: 'Hazardous', color: '#f74a74' },
];
const aqiCat = (v) => CATS.find((c) => v <= c.max) || CATS[CATS.length - 1];

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
      .aqs .num { font-family:var(--font-display); font-weight:700; font-size:40px; line-height:.85;
        color:var(--aqs-c, var(--ink)); }
      .aqs .cat { font-size:14px; font-weight:700; color:var(--aqs-c, var(--ink)); line-height:1;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .aqs .pm { font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); letter-spacing:.06em; }
    `);
    body.classList.add('aqs');
    body.appendChild(ctx.loading('air…'));

    const render = async () => {
      try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
          + `&longitude=${lon}&current=us_aqi,pm2_5&timezone=${encodeURIComponent(tz)}`;
        const d = await ctx.fetchJSON(url);
        const aqi = d && d.current && d.current.us_aqi;
        const pm = d && d.current && d.current.pm2_5;
        if (aqi == null) {
          if (!body.dataset.loaded) body.replaceChildren(ctx.error('no reading'));
          return;
        }
        const cat = aqiCat(aqi);
        body.style.setProperty('--aqs-c', cat.color);
        body.replaceChildren(
          h('div', { class: 'num' }, String(Math.round(aqi))),
          h('div', { class: 'cat', title: 'US AQI · SF' }, cat.short),
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
