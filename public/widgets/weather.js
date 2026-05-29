// Weather — current conditions + next hours, via keyless Open-Meteo (through proxy).
const WMO = (c) => c === 0 ? ['Clear', '☀️'] : (c <= 2) ? ['Partly cloudy', '🌤️'] : c === 3 ? ['Overcast', '☁️']
  : (c >= 45 && c <= 48) ? ['Fog', '🌫️'] : (c >= 51 && c <= 57) ? ['Drizzle', '🌦️']
  : (c >= 61 && c <= 67) ? ['Rain', '🌧️'] : (c >= 71 && c <= 77) ? ['Snow', '🌨️']
  : (c >= 80 && c <= 82) ? ['Showers', '🌧️'] : (c >= 85 && c <= 86) ? ['Snow', '🌨️']
  : (c >= 95) ? ['Storm', '⛈️'] : ['—', '🌡️'];

export default {
  id: 'weather',
  title: 'Weather',
  icon: '🌤',
  size: 'full',
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .wx { display:flex; flex-direction:column; gap:18px; }
      .wx-now { display:flex; align-items:center; gap:20px; }
      .wx-now .emoji { font-size:64px; line-height:1; filter:drop-shadow(0 4px 10px rgba(0,0,0,.4)); }
      .wx-now .temp { font-family:var(--font-display); font-size:64px; font-weight:600; line-height:1; }
      .wx-now .meta { display:flex; flex-direction:column; gap:4px; }
      .wx-now .cond { font-size:18px; color:var(--ink); }
      .wx-now .range { font-size:14px; color:var(--ink-faint); }
      .wx-hours { display:flex; gap:10px; justify-content:space-between; }
      .wx-hours .hr { flex:1; text-align:center; background:rgba(255,255,255,.04);
        border:1px solid var(--stroke); border-radius:16px; padding:12px 6px; display:flex; flex-direction:column; gap:6px; }
      .wx-hours .hr .t { font-size:12px; color:var(--ink-faint); }
      .wx-hours .hr .e { font-size:24px; } .wx-hours .hr .d { font-size:15px; font-weight:600; }
    `);
    body.appendChild(ctx.loading('reading the sky…'));

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code`
        + `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit`
        + `&timezone=${encodeURIComponent(tz)}&forecast_days=2`;
      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const [cond, emoji] = WMO(d.current.weather_code);
        const hi = Math.round(d.daily.temperature_2m_max[0]);
        const lo = Math.round(d.daily.temperature_2m_min[0]);
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
          ctx.h('div', { class: 'wx-now' },
            ctx.h('div', { class: 'emoji' }, emoji),
            ctx.h('div', { class: 'temp' }, `${Math.round(d.current.temperature_2m)}°`),
            ctx.h('div', { class: 'meta' },
              ctx.h('div', { class: 'cond' }, cond),
              ctx.h('div', { class: 'range' }, `H:${hi}°  L:${lo}°`))),
          ctx.h('div', { class: 'wx-hours' }, ...hours)));
      };
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('weather unavailable'));
    }
  },
};
