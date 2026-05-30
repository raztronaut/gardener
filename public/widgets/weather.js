// Weather — current conditions + detail + next hours, via keyless Open-Meteo (proxy).
// Shows temperature in BOTH Fahrenheit and Celsius.
const WMO = (c) => c === 0 ? ['Clear', '☀️'] : (c <= 2) ? ['Partly cloudy', '🌤️'] : c === 3 ? ['Overcast', '☁️']
  : (c >= 45 && c <= 48) ? ['Fog', '🌫️'] : (c >= 51 && c <= 57) ? ['Drizzle', '🌦️']
  : (c >= 61 && c <= 67) ? ['Rain', '🌧️'] : (c >= 71 && c <= 77) ? ['Snow', '🌨️']
  : (c >= 80 && c <= 82) ? ['Showers', '🌧️'] : (c >= 85 && c <= 86) ? ['Snow', '🌨️']
  : (c >= 95) ? ['Storm', '⛈️'] : ['—', '🌡️'];

const fToC = (f) => Math.round((f - 32) * 5 / 9);

export default {
  id: 'weather',
  title: 'Weather',
  icon: '🌤',
  size: 'full',
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .wx { display:flex; flex-direction:column; gap:13px; }
      .wx-top { display:flex; align-items:center; gap:18px; }
      .wx-emoji { font-size:50px; line-height:1; filter:drop-shadow(0 4px 12px rgba(0,0,0,.4)); }
      .wx-temp { display:flex; align-items:baseline; gap:14px; }
      .wx-temp .f { font-family:var(--font-display); font-size:54px; font-weight:600; line-height:.85;
        background:linear-gradient(120deg,#fff,var(--mint)); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .wx-temp .c { font-family:var(--font-display); font-size:34px; font-weight:600; color:var(--ink-soft); line-height:1; }
      .wx-meta { margin-left:auto; text-align:right; display:flex; flex-direction:column; gap:7px; }
      .wx-meta .cond { font-size:21px; font-weight:600; color:var(--ink); }
      .wx-meta .range { font-family:var(--font-mono); font-size:15px; color:var(--ink-faint); letter-spacing:.02em; }
      .wx-stats { display:flex; gap:10px; }
      .wx-stat { flex:1; background:rgba(255,255,255,.04); border:1px solid var(--stroke); border-radius:14px;
        padding:10px 14px; display:flex; flex-direction:column; gap:3px; }
      .wx-stat .k { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint); }
      .wx-stat .v { font-family:var(--font-display); font-size:20px; font-weight:600; color:var(--ink); line-height:1.05; }
      .wx-hours { display:flex; gap:10px; justify-content:space-between; }
      .wx-hours .hr { flex:1; text-align:center; background:rgba(255,255,255,.04);
        border:1px solid var(--stroke); border-radius:16px; padding:12px 6px; display:flex; flex-direction:column; gap:6px; }
      .wx-hours .hr .t { font-size:12px; color:var(--ink-faint); }
      .wx-hours .hr .e { font-size:26px; line-height:1; } .wx-hours .hr .d { font-size:16px; font-weight:600; }
    `);
    body.appendChild(ctx.loading('reading the sky…'));

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m`
        + `&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min`
        + `&temperature_unit=fahrenheit&wind_speed_unit=mph`
        + `&timezone=${encodeURIComponent(tz)}&forecast_days=2`;
      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const cur = d.current;
        const [cond, emoji] = WMO(cur.weather_code);
        const tF = Math.round(cur.temperature_2m);
        const hi = Math.round(d.daily.temperature_2m_max[0]);
        const lo = Math.round(d.daily.temperature_2m_min[0]);
        const feels = Math.round(cur.apparent_temperature);
        const hum = Math.round(cur.relative_humidity_2m);
        const wind = Math.round(cur.wind_speed_10m);
        const idx = new Date().getHours();
        const hours = d.hourly.time.slice(idx, idx + 5).map((t, i) => {
          const [, e] = WMO(d.hourly.weather_code[idx + i]);
          const hr = new Date(t).getHours();
          const label = i === 0 ? 'now' : `${((hr + 11) % 12) + 1}${hr < 12 ? 'a' : 'p'}`;
          return ctx.h('div', { class: 'hr' },
            ctx.h('div', { class: 't' }, label),
            ctx.h('div', { class: 'e' }, e),
            ctx.h('div', { class: 'd' }, `${Math.round(d.hourly.temperature_2m[idx + i])}°`));
        });
        body.replaceChildren(ctx.h('div', { class: 'wx' },
          ctx.h('div', { class: 'wx-top' },
            ctx.h('div', { class: 'wx-emoji' }, emoji),
            ctx.h('div', { class: 'wx-temp' },
              ctx.h('div', { class: 'f' }, `${tF}°F`),
              ctx.h('div', { class: 'c' }, `${fToC(tF)}°C`)),
            ctx.h('div', { class: 'wx-meta' },
              ctx.h('div', { class: 'cond' }, cond),
              ctx.h('div', { class: 'range' }, `H ${hi}°  ·  L ${lo}°`))),
          ctx.h('div', { class: 'wx-stats' },
            ctx.h('div', { class: 'wx-stat' },
              ctx.h('div', { class: 'k' }, 'Feels like'),
              ctx.h('div', { class: 'v' }, `${feels}°F · ${fToC(feels)}°C`)),
            ctx.h('div', { class: 'wx-stat' },
              ctx.h('div', { class: 'k' }, 'Humidity'),
              ctx.h('div', { class: 'v' }, `${hum}%`)),
            ctx.h('div', { class: 'wx-stat' },
              ctx.h('div', { class: 'k' }, 'Wind'),
              ctx.h('div', { class: 'v' }, `${wind} mph`))),
          ctx.h('div', { class: 'wx-hours' }, ...hours)));
      };
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('weather unavailable'));
    }
  },
};
