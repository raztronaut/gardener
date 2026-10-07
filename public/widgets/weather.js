// Weather — a calm, clearly-sectioned read of the sky via keyless Open-Meteo (proxy).
// 2026-10-01 rewrite after "too dense and confusing" feedback: one idea per row,
// every section labelled, and BOTH °F and °C on the current reading AND on the
// forecast days (the humans asked for tomorrow's prediction in Celsius too).
//   1. Now        — icon, °F / °C, condition, today's high/low
//   2. Sun        — plain-words sunrise / sunset (this line predates and is separate
//                   from the banned Sun & Moon widget — it stays)
//   3. Stats      — Feels like · Humidity · UV
//   4. Next days  — Tomorrow + the two days after: icon, high & low in °F and °C
//   5. Hourly     — a smooth temperature curve with temps / icons / times beneath
// Icons are self-hosted Meteocons SVGs in public/assets/weather/.

const WMO = (c) => c === 0 ? ['Clear', 'clear-day'] : (c <= 2) ? ['Partly cloudy', 'partly-cloudy-day'] : c === 3 ? ['Overcast', 'overcast']
  : (c >= 45 && c <= 48) ? ['Fog', 'fog'] : (c >= 51 && c <= 57) ? ['Drizzle', 'drizzle']
  : (c >= 61 && c <= 67) ? ['Rain', 'rain'] : (c >= 71 && c <= 77) ? ['Snow', 'snow']
  : (c >= 80 && c <= 82) ? ['Showers', 'rain'] : (c >= 85 && c <= 86) ? ['Snow', 'snow']
  : (c >= 95) ? ['Storm', 'thunderstorms'] : ['—', 'thermometer'];

// After dark, clear & partly-cloudy skies swap to calm star-lit faces.
const nightSlug = (slug, isDay) => isDay !== 0 ? slug
  : slug === 'clear-day' ? 'clear-night'
  : slug === 'partly-cloudy-day' ? 'partly-cloudy-night'
  : slug;

const fToC = (f) => Math.round((f - 32) * 5 / 9);

// Wind: meteorological degrees (direction the wind blows FROM) → 8-point compass.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => Number.isFinite(deg) ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : '';
// Static arrow pointing the way the wind is GOING (FROM + 180°) — read like a flag.
const windArrow = (deg) => `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
  style="transform:rotate(${((deg + 180) % 360).toFixed(0)}deg)"><path d="M12 3 L18 19 L12 15 L6 19 Z"
  fill="currentColor"/></svg>`;

// UV index → [label, colour] (WHO bands).
const uvBand = (u) => u == null ? ['—', 'var(--ink-faint)']
  : u < 3 ? ['Low', '#74f7b0'] : u < 6 ? ['Moderate', '#f7d774']
  : u < 8 ? ['High', '#f7a374'] : u < 11 ? ['Very high', '#f77474'] : ['Extreme', '#c074f7'];

// "2026-05-31T05:51" (already local to the requested tz) → "5:51 am"
function fmtClock(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return '—';
  let h = parseInt(m[1], 10);
  const ap = h < 12 ? 'am' : 'pm'; h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ap}`;
}
// Hour (0–23) from a local ISO time, read from the string (host-tz independent).
const hourOf = (iso) => { const m = /T(\d{2})/.exec(iso || ''); return m ? parseInt(m[1], 10) : null; };
const hr12 = (hh) => `${((hh + 11) % 12) + 1}${hh < 12 ? 'a' : 'p'}`;

// Weekday for a plain local ISO date, computed in UTC from the date parts.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayIdx = (iso) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : null;
};

// Monotone cubic (Fritsch–Carlson) path: smooth, never overshoots the data.
function smoothPath(P) {
  const n = P.length;
  if (!n) return '';
  if (n < 2) return `M${P[0][0]},${P[0][1]}`;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = (P[i + 1][1] - P[i][1]) / (dx[i] || 1); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h2 = a * a + b * b;
    if (h2 > 9) { const k = 3 / Math.sqrt(h2); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const f = (v) => v.toFixed(2);
  let d = `M${f(P[0][0])},${f(P[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += ` C${f(P[i][0] + c)},${f(P[i][1] + t[i] * c)} ${f(P[i + 1][0] - c)},${f(P[i + 1][1] - t[i + 1] * c)} ${f(P[i + 1][0])},${f(P[i + 1][1])}`;
  }
  return d;
}

export default {
  id: 'weather',
  title: 'Weather',
  icon: '🌤',
  size: 'tall', // half width × 2 rows — sits beside the Daily Almanac
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .wx { display:flex; flex-direction:column; height:100%; gap:10px; }
      .wx-sec { font-size:12.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); margin-bottom:4px; }

      /* 1 · now */
      .wx-now { display:flex; align-items:center; gap:12px; }
      .wx-now .ic { width:56px; height:56px; flex:none; filter:drop-shadow(0 4px 12px rgba(0,0,0,.4));
        animation:wxin .22s linear both; }
      @keyframes wxin { from{opacity:0} to{opacity:1} }
      @media (prefers-reduced-motion: reduce) { .wx-now .ic { animation:none; } }
      .wx-now .ic img { display:block; }
      .wx-now .tmp { display:flex; align-items:baseline; gap:8px; flex:none; }
      .wx-now .f { font-family:var(--font-display); font-size:54px; line-height:.9; color:#fff; }
      .wx-now .c { font-family:var(--font-display); font-size:20px; line-height:1; color:var(--ink-soft); }
      .wx-now .meta { margin-left:auto; text-align:right; display:flex; flex-direction:column; gap:4px; min-width:0; }
      .wx-now .cond { font-family:var(--font-display); font-size:24px; color:var(--ink);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wx-now .rng { font-size:14px; color:var(--ink-soft); white-space:nowrap; }

      /* 2 · sun */
      .wx-sun { display:flex; gap:16px; font-size:14px; color:var(--ink-soft); margin-top:-4px; }
      .wx-sun b { color:var(--ink); font-weight:600; }
      .wx-sun .wind { margin-left:auto; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
      .wx-sun .wind .ar { display:inline-flex; color:var(--mint); }
      .wx-sun .wind .gu { color:var(--ink-faint); }

      /* 3 · stats — open columns, no boxes */
      .wx-stats { display:flex; }
      .wx-stat { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
      .wx-stat .k { font-size:12.5px; letter-spacing:.04em; color:var(--ink-faint); white-space:nowrap; }
      .wx-stat .v { font-family:var(--font-display); font-size:22px; color:var(--ink); line-height:1.05;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wx-stat .v small { font-family:var(--font); font-size:14px; color:var(--ink-soft); margin-left:4px; }

      /* 4 · next days — a small table, tomorrow first, °F with °C beside it */
      .wx-days { display:grid; grid-template-columns:minmax(0,1fr) 26px auto auto; column-gap:12px; row-gap:0; align-items:center; }
      .wx-days .h { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-faint); text-align:right; }
      .wx-days .wx-sec { margin:0; text-align:left; grid-column:1 / 3; }
      .wx-days .dn { font-size:16px; color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wx-days .dn.tm { color:var(--ink); font-weight:600; }
      .wx-days .dn .pp { color:#9cc0ff; font-size:13px; font-weight:600; margin-left:6px; }
      .wx-days img { display:block; width:26px; height:26px; }
      .wx-days .t { text-align:right; white-space:nowrap; }
      .wx-days .t .f { font-family:var(--font-display); font-size:20px; color:var(--ink); }
      .wx-days .t.lo .f { color:var(--ink-soft); }
      .wx-days .t .c { font-size:13.5px; color:var(--ink-faint); margin-left:5px; }

      /* 5 · hourly curve */
      .wx-hours { margin-top:auto; }
      .wx-plot { position:relative; height:30px; margin:0 6px; }
      .wx-plot svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .wx-plot .now { position:absolute; width:9px; height:9px; margin:-4.5px 0 0 -4.5px; border-radius:50%;
        background:#fff; box-shadow:0 0 0 2px #10261f; }
      .wx-axis { display:flex; margin-top:6px; }
      .wx-axis .hr { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; }
      .wx-axis .tt { font-family:var(--font-display); font-size:17px; color:var(--ink); line-height:1; }
      .wx-axis .hr:first-child .tt { color:#fff; }
      .wx-axis img { display:block; }
      .wx-axis .t { font-size:12.5px; color:var(--ink-faint); line-height:1; }
      .wx-axis .p { font-size:12px; color:#9cc0ff; line-height:1; }

      .wx-fallback { display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:10px; height:100%; text-align:center; }
      .wx-fallback .i { font-size:40px; opacity:.55; line-height:1; }
      .wx-fallback .m { font-size:15px; color:var(--ink); }
      .wx-fallback .s { font-size:13px; color:var(--ink-faint); }
    `);

    const h = ctx.h;
    const icon = (slug, px) => h('img', { src: `/assets/weather/${slug}.svg`, width: px, height: px, alt: '' });
    const fallback = (msg, sub) => h('div', { class: 'wx-fallback' },
      h('div', { class: 'i' }, '🌤'), h('div', { class: 'm' }, msg), h('div', { class: 's' }, sub));
    body.appendChild(ctx.loading('reading the sky…'));

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m`
      + `&wind_speed_unit=mph`
      + `&hourly=temperature_2m,weather_code,precipitation_probability,uv_index,is_day`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max`
      + `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(tz)}&forecast_days=4`;

    // Current hour index into the hourly series (which starts at local midnight
    // in the display tz) — read the hour in that tz, not the host's.
    const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
    const nowHour = () => parseInt(hourFmt.format(new Date()), 10) || 0;

    const render = (d) => {
      const cur = d.current;
      const [cond, slug] = WMO(cur.weather_code);
      const tF = Math.round(cur.temperature_2m);
      const hi = Math.round(d.daily.temperature_2m_max[0]);
      const lo = Math.round(d.daily.temperature_2m_min[0]);
      const feels = Math.round(cur.apparent_temperature);
      const hum = Math.round(cur.relative_humidity_2m);
      const hNow = nowHour();
      const uvRaw = d.hourly.uv_index?.[hNow];
      const uv = Number.isFinite(uvRaw) ? Math.round(uvRaw) : null;
      const [uvLabel, uvColor] = uvBand(uv);
      // Wind (mph). Gusts only when they meaningfully exceed the sustained speed.
      const ws = Number.isFinite(cur.wind_speed_10m) ? Math.round(cur.wind_speed_10m) : null;
      const wg = Number.isFinite(cur.wind_gusts_10m) ? Math.round(cur.wind_gusts_10m) : null;
      const wd = cur.wind_direction_10m;
      const windEl = ws == null ? null : h('span', { class: 'wind', title: `Wind ${ws} mph${compass(wd) ? ' from the ' + compass(wd) : ''}${wg ? ' · gusts ' + wg + ' mph' : ''}` },
        ws > 0 && Number.isFinite(wd) ? h('span', { class: 'ar', html: windArrow(wd) }) : null,
        h('b', {}, ws === 0 ? 'calm' : `${ws} mph ${compass(wd)}`.trim()),
        wg != null && ws > 0 && wg >= ws + 5 ? h('span', { class: 'gu' }, `gust ${wg}`) : null);

      // Next days: tomorrow + two more, each in °F and °C.
      const days = [];
      for (let i = 1; i <= 3; i++) {
        const iso = d.daily.time?.[i];
        const dhi = d.daily.temperature_2m_max?.[i], dlo = d.daily.temperature_2m_min?.[i];
        if (iso == null || !Number.isFinite(dhi) || !Number.isFinite(dlo)) continue;
        const pp = d.daily.precipitation_probability_max?.[i];
        days.push({ i, iso, code: d.daily.weather_code?.[i], hi: Math.round(dhi), lo: Math.round(dlo),
          pp: Number.isFinite(pp) ? Math.round(pp) : null });
      }
      const tempCell = (f, cls) => h('div', { class: `t ${cls}` },
        h('span', { class: 'f' }, `${f}°F`), h('span', { class: 'c' }, `${fToC(f)}°C`));
      const dayRows = days.flatMap((x) => {
        const wd = weekdayIdx(x.iso);
        const [lbl, s] = WMO(x.code);
        const wet = x.pp != null && x.pp >= 30;
        return [
          h('div', { class: `dn${x.i === 1 ? ' tm' : ''}`, title: `${wd == null ? '' : WD_FULL[wd] + ' · '}${lbl}` },
            x.i === 1 ? 'Tomorrow' : (wd == null ? '—' : WD[wd]),
            wet ? h('span', { class: 'pp' }, `💧${x.pp}%`) : null),
          h('div', { title: lbl }, icon(s, 26)),
          tempCell(x.hi, 'hi'),
          tempCell(x.lo, 'lo'),
        ];
      });

      // Hourly: labelled every 2 h for ~10 h, curve through every hour.
      const STEP = 2, N = 6;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const j = hNow + i * STEP;
        if (j >= d.hourly.time.length || !Number.isFinite(d.hourly.temperature_2m[j])) break;
        const pop = d.hourly.precipitation_probability?.[j];
        pts.push({ t: Math.round(d.hourly.temperature_2m[j]), code: d.hourly.weather_code[j],
          hr: hourOf(d.hourly.time[j]), pop: Number.isFinite(pop) ? pop : null, isDay: d.hourly.is_day?.[j] });
      }
      const HOURS = Math.max(1, (pts.length - 1) * STEP);
      const fine = [];
      for (let k = 0; k <= HOURS; k++) {
        const v = d.hourly.temperature_2m[hNow + k];
        if (Number.isFinite(v)) fine.push([k, v]);
      }
      const anyWet = pts.some((p) => p.pop != null && p.pop >= 25); // rain line only when it matters
      let hoursEl = null;
      if (pts.length >= 2 && fine.length >= 2) {
        const vs = fine.map((f) => f[1]);
        const tMin = Math.min(...vs), span = (Math.max(...vs) - tMin) || 1;
        const yOf = (v) => 80 - ((v - tMin) / span) * 60; // 20%..80%
        const P = fine.map(([k, v]) => [(k / HOURS) * 100, yOf(v)]);
        const line = smoothPath(P);
        const area = `${line} L${P[P.length - 1][0].toFixed(2)},100 L${P[0][0].toFixed(2)},100 Z`;
        const plot = h('div', { class: 'wx-plot', html: `
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="wxfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="rgba(116,247,176,.22)"/><stop offset="1" stop-color="rgba(116,247,176,0)"/>
            </linearGradient></defs>
            <path d="${area}" fill="url(#wxfill)"/>
            <path d="${line}" fill="none" stroke="var(--mint)" stroke-width="2.4" stroke-linejoin="round"
              stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          </svg>` });
        plot.appendChild(h('div', { class: 'now', style: { left: '0%', top: `${P[0][1]}%` } }));
        hoursEl = h('div', { class: 'wx-hours' },
          anyWet ? null : h('div', { class: 'wx-sec' }, 'Next hours'), // label yields its row to the rain line
          plot,
          h('div', { class: 'wx-axis' }, ...pts.map((p, i) => {
            const wet = p.pop != null && p.pop >= 25;
            return h('div', { class: 'hr' },
              h('div', { class: 'tt' }, `${p.t}°`),
              icon(nightSlug(WMO(p.code)[1], p.isDay), 28),
              h('div', { class: 't' }, i === 0 ? 'now' : hr12(p.hr)),
              anyWet ? h('div', { class: 'p' }, wet ? `💧${p.pop}%` : '') : null);
          })));
      }

      body.replaceChildren(h('div', { class: 'wx' },
        h('div', { class: 'wx-now' },
          h('div', { class: 'ic' }, icon(nightSlug(slug, cur.is_day), 56)),
          h('div', { class: 'tmp' },
            h('div', { class: 'f' }, `${tF}°F`),
            h('div', { class: 'c' }, `${fToC(tF)}°C`)),
          h('div', { class: 'meta' },
            h('div', { class: 'cond' }, cond),
            h('div', { class: 'rng', title: `High ${hi}°F / ${fToC(hi)}°C · Low ${lo}°F / ${fToC(lo)}°C` },
              `High ${hi}° · Low ${lo}°`))),
        h('div', { class: 'wx-sun' },
          h('span', {}, 'Sunrise ', h('b', {}, fmtClock(d.daily.sunrise?.[0]))),
          h('span', {}, 'Sunset ', h('b', {}, fmtClock(d.daily.sunset?.[0])))),
          // (no wind — the humans removed it twice; see GARDEN_RULES.md)
        h('div', { class: 'wx-stats' },
          h('div', { class: 'wx-stat' }, h('div', { class: 'k' }, 'Feels like'),
            h('div', { class: 'v' }, `${feels}°F`, h('small', {}, `${fToC(feels)}°C`))),
          h('div', { class: 'wx-stat' }, h('div', { class: 'k' }, 'Humidity'),
            h('div', { class: 'v' }, `${hum}%`)),
          h('div', { class: 'wx-stat' }, h('div', { class: 'k' }, 'UV index'),
            h('div', { class: 'v' }, `${uv ?? '—'}`, h('small', { style: { color: uvColor } }, uvLabel)))),
        days.length ? h('div', {},
          h('div', { class: 'wx-days' },
            h('div', { class: 'wx-sec' }, 'Next days'), h('div', { class: 'h' }, 'High'), h('div', { class: 'h' }, 'Low'),
            ...dayRows)) : null,
        hoursEl));
    };

    const refresh = async () => render(await ctx.fetchJSON(url)); // fetch first → failure keeps last render
    let loaded = false;
    for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
      try { await refresh(); loaded = true; }
      catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 2500)); }
    }
    if (!loaded) body.replaceChildren(fallback('The sky is quiet', 'reconnecting to the forecast…'));
    ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
  },
};
