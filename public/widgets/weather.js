// Weather — current conditions + sunrise/sunset + a linear hourly temperature
// timeline, via keyless Open-Meteo (proxy). Temperature shown in °F and °C.
// [label, icon-slug] — slugs map to self-hosted animated Meteocons SVGs in
// public/assets/weather/ (clouds drift, the sun slowly radiates; transparent).
const WMO = (c) => c === 0 ? ['Clear', 'clear-day'] : (c <= 2) ? ['Partly cloudy', 'partly-cloudy-day'] : c === 3 ? ['Overcast', 'overcast']
  : (c >= 45 && c <= 48) ? ['Fog', 'fog'] : (c >= 51 && c <= 57) ? ['Drizzle', 'drizzle']
  : (c >= 61 && c <= 67) ? ['Rain', 'rain'] : (c >= 71 && c <= 77) ? ['Snow', 'snow']
  : (c >= 80 && c <= 82) ? ['Showers', 'rain'] : (c >= 85 && c <= 86) ? ['Snow', 'snow']
  : (c >= 95) ? ['Storm', 'thunderstorms'] : ['—', 'thermometer'];

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
  size: 'hero',
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .wx { display:flex; flex-direction:column; height:100%; gap:18px; }
      .wx-top { display:flex; align-items:center; gap:16px; }
      .wx-emoji { width:72px; height:72px; flex:none; filter:drop-shadow(0 4px 12px rgba(0,0,0,.4));
        animation:wxfloat 5s ease-in-out infinite; }
      /* the cloud/sun itself gently floats — subtle, compositor-only (transform) */
      @keyframes wxfloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
      @media (prefers-reduced-motion: reduce) { .wx-emoji { animation:none; } }
      .wx-icon { display:block; }
      .wx-temp { display:flex; align-items:baseline; gap:12px; }
      .wx-temp .f { font-family:var(--font-display); font-size:52px; font-weight:600; line-height:.85;
        background:linear-gradient(120deg,#fff,var(--mint)); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .wx-temp .c { font-family:var(--font-display); font-size:30px; font-weight:600; color:var(--ink-soft); line-height:1; }
      .wx-meta { margin-left:auto; text-align:right; display:flex; flex-direction:column; gap:5px; }
      .wx-meta .cond { font-size:22px; font-weight:600; color:var(--ink); }
      .wx-meta .range { font-family:var(--font-mono); font-size:14px; color:var(--ink-faint); letter-spacing:.02em; }
      .wx-meta .sun { font-family:var(--font-mono); font-size:14px; color:var(--ink-soft); letter-spacing:.02em; }
      .wx-stats { display:flex; gap:12px; }
      .wx-stat { flex:1; background:rgba(255,255,255,.04); border:1px solid var(--stroke); border-radius:14px;
        padding:10px 15px; display:flex; flex-direction:column; gap:3px; }
      .wx-stat .k { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint); }
      .wx-stat .v { font-family:var(--font-display); font-size:20px; font-weight:600; color:var(--ink); line-height:1.05; }

      /* linear hourly timeline — sits in its own panel, clearly divided from the
         stat rows above so the floating temp labels can never collide with them. */
      .wx-tl { margin-top:auto; display:flex; flex-direction:column; gap:0;
        padding-top:22px; border-top:1px solid var(--stroke); }
      .wx-plot { position:relative; height:46px; }
      .wx-plot svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .wx-pt { position:absolute; transform:translate(-50%,-50%); width:0; height:0; }
      .wx-pt .dot { position:absolute; left:-5px; top:-5px; width:10px; height:10px; border-radius:50%;
        background:var(--mint); box-shadow:0 0 8px rgba(116,247,176,.7); }
      .wx-pt .tv { position:absolute; left:50%; bottom:12px; transform:translateX(-50%);
        font-family:var(--font-mono); font-size:15px; font-weight:600; color:var(--ink); white-space:nowrap; }
      .wx-axis { display:flex; margin-top:6px; }
      .wx-axis .hr { flex:1; text-align:center; display:flex; flex-direction:column; align-items:center; gap:3px; }
      .wx-axis .hr .e { font-size:15px; line-height:1; }
      .wx-axis .hr .t { font-size:12px; color:var(--ink-faint); font-family:var(--font-mono); }
      /* rain-chance: a quiet blue line beneath each hour. Reserves its height even
         when empty so the axis row never jumps; only speaks up when rain is likely. */
      .wx-axis .hr .p { font-family:var(--font-mono); font-size:11px; line-height:1; min-height:11px;
        color:#9cc0ff; letter-spacing:.01em; }
      .wx-axis .hr .p.dry { visibility:hidden; }
    `);
    body.appendChild(ctx.loading('reading the sky…'));

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m`
        + `&hourly=temperature_2m,weather_code,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset`
        + `&temperature_unit=fahrenheit&wind_speed_unit=mph`
        + `&timezone=${encodeURIComponent(tz)}&forecast_days=2`;

      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const cur = d.current;
        const [cond, iconSlug] = WMO(cur.weather_code);
        const wxIcon = (slug, px) => ctx.h('img', { class: 'wx-icon', src: `/assets/weather/${slug}.svg`, width: px, height: px, alt: '' });
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
          const popRaw = d.hourly.precipitation_probability?.[j];
          const pop = Number.isFinite(popRaw) ? popRaw : null;
          pts.push({ t, code: d.hourly.weather_code[j], hr, pop, first: i === 0 });
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
          const [, slug] = WMO(p.code);
          const label = p.first ? 'now' : `${((p.hr + 11) % 12) + 1}${p.hr < 12 ? 'a' : 'p'}`;
          // Show rain chance only when it's worth a glance (>=25%); otherwise the
          // line stays in the layout but invisible, so the row never shifts.
          const wet = p.pop != null && p.pop >= 25;
          return ctx.h('div', { class: 'hr' },
            ctx.h('div', { class: 'e' }, wxIcon(slug, 22)),
            ctx.h('div', { class: 't' }, label),
            ctx.h('div', { class: `p${wet ? '' : ' dry'}` }, wet ? `💧${p.pop}%` : '0'));
        });

        const plot = ctx.h('div', { class: 'wx-plot', html: svg });
        dots.forEach((dt) => plot.appendChild(dt));

        body.replaceChildren(ctx.h('div', { class: 'wx' },
          ctx.h('div', { class: 'wx-top' },
            ctx.h('div', { class: 'wx-emoji' }, wxIcon(iconSlug, 72)),
            ctx.h('div', { class: 'wx-temp' },
              ctx.h('div', { class: 'f' }, `${tF}°F`),
              ctx.h('div', { class: 'c' }, `${fToC(tF)}°C`)),
            ctx.h('div', { class: 'wx-meta' },
              ctx.h('div', { class: 'cond' }, cond),
              ctx.h('div', { class: 'range' }, `H ${hi}°  ·  L ${lo}°`),
              ctx.h('div', { class: 'sun' }, `Sunrise: ${sunrise}   Sunset: ${sunset}`))),
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
      // Initial load: a few attempts so one slow/aborted response doesn't blank
      // the widget for a whole refresh cycle.
      let loaded = false;
      for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
        try { await refresh(); loaded = true; }
        catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 2500)); }
      }
      if (!loaded) body.replaceChildren(ctx.error('weather unavailable — retrying…'));
      // Steady refresh; on failure KEEP the last good reading (don't blank).
      ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('weather unavailable'));
    }
  },
};
