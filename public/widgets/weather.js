// Weather — current conditions + sunrise/sunset + a linear hourly temperature
// timeline, via keyless Open-Meteo (proxy). Temperature shown in °F and °C.
const WMO = (c) => c === 0 ? ['Clear', '☀️'] : (c <= 2) ? ['Partly cloudy', '🌤️'] : c === 3 ? ['Overcast', '☁️']
  : (c >= 45 && c <= 48) ? ['Fog', '🌫️'] : (c >= 51 && c <= 57) ? ['Drizzle', '🌦️']
  : (c >= 61 && c <= 67) ? ['Rain', '🌧️'] : (c >= 71 && c <= 77) ? ['Snow', '🌨️']
  : (c >= 80 && c <= 82) ? ['Showers', '🌧️'] : (c >= 85 && c <= 86) ? ['Snow', '🌨️']
  : (c >= 95) ? ['Storm', '⛈️'] : ['—', '🌡️'];

const fToC = (f) => Math.round((f - 32) * 5 / 9);

// "2026-05-31T05:51" (already local to requested tz) -> "5:51a"
function fmtClock(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return '—';
  let h = parseInt(m[1], 10); const min = m[2];
  const ap = h < 12 ? 'a' : 'p'; h = h % 12; if (h === 0) h = 12;
  return `${h}:${min}${ap}`;
}

export default {
  id: 'weather',
  title: 'Weather',
  icon: '🌤',
  size: 'full',
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .wx { display:flex; flex-direction:column; gap:11px; height:100%; justify-content:space-between; }
      .wx-top { display:flex; align-items:center; gap:16px; }
      .wx-emoji { font-size:48px; line-height:1; filter:drop-shadow(0 4px 12px rgba(0,0,0,.4)); }
      .wx-temp { display:flex; align-items:baseline; gap:12px; }
      .wx-temp .f { font-family:var(--font-display); font-size:52px; font-weight:600; line-height:.85;
        background:linear-gradient(120deg,#fff,var(--mint)); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .wx-temp .c { font-family:var(--font-display); font-size:30px; font-weight:600; color:var(--ink-soft); line-height:1; }
      .wx-meta { margin-left:auto; text-align:right; display:flex; flex-direction:column; gap:5px; }
      .wx-meta .cond { font-size:20px; font-weight:600; color:var(--ink); }
      .wx-meta .range { font-family:var(--font-mono); font-size:14px; color:var(--ink-faint); letter-spacing:.02em; }
      .wx-meta .sun { font-family:var(--font-mono); font-size:14px; color:var(--gold); letter-spacing:.02em; }
      .wx-stats { display:flex; gap:10px; }
      .wx-stat { flex:1; background:rgba(255,255,255,.04); border:1px solid var(--stroke); border-radius:14px;
        padding:8px 13px; display:flex; flex-direction:column; gap:2px; }
      .wx-stat .k { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint); }
      .wx-stat .v { font-family:var(--font-display); font-size:18px; font-weight:600; color:var(--ink); line-height:1.05; }

      /* linear hourly timeline */
      .wx-tl { display:flex; flex-direction:column; gap:0; }
      .wx-plot { position:relative; height:52px; }
      .wx-plot svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .wx-pt { position:absolute; transform:translate(-50%,-50%); width:0; height:0; }
      .wx-pt .dot { position:absolute; left:-5px; top:-5px; width:10px; height:10px; border-radius:50%;
        background:var(--mint); box-shadow:0 0 8px rgba(116,247,176,.7); }
      .wx-pt .tv { position:absolute; left:50%; bottom:11px; transform:translateX(-50%);
        font-family:var(--font-mono); font-size:14px; font-weight:600; color:var(--ink); white-space:nowrap; }
      .wx-axis { display:flex; margin-top:4px; }
      .wx-axis .hr { flex:1; text-align:center; display:flex; flex-direction:column; gap:1px; }
      .wx-axis .hr .e { font-size:16px; line-height:1; }
      .wx-axis .hr .t { font-size:12px; color:var(--ink-faint); font-family:var(--font-mono); }
    `);
    body.appendChild(ctx.loading('reading the sky…'));

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m`
        + `&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset`
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
        const sunrise = fmtClock(d.daily.sunrise?.[0]);
        const sunset = fmtClock(d.daily.sunset?.[0]);

        // Sample the next ~14h every 2 hours for a linear timeline.
        const idx = new Date().getHours();
        const STEP = 2, N = 8;
        const pts = [];
        for (let i = 0; i < N; i++) {
          const j = idx + i * STEP;
          if (j >= d.hourly.time.length) break;
          const t = Math.round(d.hourly.temperature_2m[j]);
          const hr = new Date(d.hourly.time[j]).getHours();
          pts.push({ t, code: d.hourly.weather_code[j], hr, first: i === 0 });
        }
        const temps = pts.map((p) => p.t);
        const tMin = Math.min(...temps), tMax = Math.max(...temps);
        const span = (tMax - tMin) || 1;
        // y as a percentage from top; warm sits high, cool sits low, padded so
        // temp labels above the dots never clip the plot.
        const yOf = (t) => 80 - ((t - tMin) / span) * 52; // 28%..80%
        const xOf = (i) => (N === 1 ? 50 : (i / (pts.length - 1)) * 100);

        const linePts = pts.map((p, i) => `${xOf(i)},${yOf(p.t)}`).join(' ');
        const areaPts = `0,100 ${linePts} 100,100`;
        const svg = `
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="wxfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgba(116,247,176,.28)"/>
                <stop offset="1" stop-color="rgba(116,247,176,0)"/>
              </linearGradient>
            </defs>
            <polygon points="${areaPts}" fill="url(#wxfill)"/>
            <polyline points="${linePts}" fill="none" stroke="var(--mint)" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          </svg>`;

        const dots = pts.map((p, i) => ctx.h('div', {
          class: 'wx-pt', style: { left: `${xOf(i)}%`, top: `${yOf(p.t)}%` },
        }, ctx.h('div', { class: 'tv' }, `${p.t}°`), ctx.h('div', { class: 'dot' })));

        const axis = pts.map((p) => {
          const [, e] = WMO(p.code);
          const label = p.first ? 'now' : `${((p.hr + 11) % 12) + 1}${p.hr < 12 ? 'a' : 'p'}`;
          return ctx.h('div', { class: 'hr' },
            ctx.h('div', { class: 'e' }, e),
            ctx.h('div', { class: 't' }, label));
        });

        const plot = ctx.h('div', { class: 'wx-plot', html: svg });
        dots.forEach((dt) => plot.appendChild(dt));

        body.replaceChildren(ctx.h('div', { class: 'wx' },
          ctx.h('div', { class: 'wx-top' },
            ctx.h('div', { class: 'wx-emoji' }, emoji),
            ctx.h('div', { class: 'wx-temp' },
              ctx.h('div', { class: 'f' }, `${tF}°F`),
              ctx.h('div', { class: 'c' }, `${fToC(tF)}°C`)),
            ctx.h('div', { class: 'wx-meta' },
              ctx.h('div', { class: 'cond' }, cond),
              ctx.h('div', { class: 'range' }, `H ${hi}°  ·  L ${lo}°`),
              ctx.h('div', { class: 'sun' }, `🌅 ${sunrise}   🌇 ${sunset}`))),
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
          ctx.h('div', { class: 'wx-tl' },
            plot,
            ctx.h('div', { class: 'wx-axis' }, ...axis))));
      };
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('weather unavailable'));
    }
  },
};
