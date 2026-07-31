// Weather — current conditions + sunrise/sunset + length of day (with a quiet
// day-over-day trend as the seasons turn) + tomorrow's outlook carrying a
// glanceable warmer/cooler-than-today cue + a linear hourly temperature timeline
// whose after-dark hours are gently shaded so the evening reads at a glance,
// via keyless Open-Meteo (proxy). Temperature shown in °F and °C.
// [label, icon-slug] — slugs map to self-hosted animated Meteocons SVGs in
// public/assets/weather/ (clouds drift, the sun slowly radiates; transparent).
// Clear & partly-cloudy skies also have calm, static star-lit night faces that are
// used after dark (see nightSlug + Open-Meteo's is_day flag).
const WMO = (c) => c === 0 ? ['Clear', 'clear-day'] : (c <= 2) ? ['Partly cloudy', 'partly-cloudy-day'] : c === 3 ? ['Overcast', 'overcast']
  : (c >= 45 && c <= 48) ? ['Fog', 'fog'] : (c >= 51 && c <= 57) ? ['Drizzle', 'drizzle']
  : (c >= 61 && c <= 67) ? ['Rain', 'rain'] : (c >= 71 && c <= 77) ? ['Snow', 'snow']
  : (c >= 80 && c <= 82) ? ['Showers', 'rain'] : (c >= 85 && c <= 86) ? ['Snow', 'snow']
  : (c >= 95) ? ['Storm', 'thunderstorms'] : ['—', 'thermometer'];

// Day/night-aware icon: a radiating sun at 10pm looks wrong on an evening wall.
// Open-Meteo's is_day flag (1 day / 0 night) lets clear & partly-cloudy skies swap
// to calm star-lit night glyphs; every other condition looks the same after dark,
// so it keeps its single icon. Unknown/undefined is_day defaults to the day icon.
const nightSlug = (slug, isDay) => isDay !== 0 ? slug
  : slug === 'clear-day' ? 'clear-night'
  : slug === 'partly-cloudy-day' ? 'partly-cloudy-night'
  : slug;

const fToC = (f) => Math.round((f - 32) * 5 / 9);

// Length of day from Open-Meteo's daily daylight_duration (seconds) → "14h 32m".
const fmtDayLen = (secs) => {
  const m = Math.round(secs / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
// Day-over-day change in daylight (today → tomorrow), the seasons quietly turning.
// After the summer solstice this reads negative (shorter); before it, positive.
// "1m 12s" — minutes dropped when zero. Sign is carried by the arrow, not the text.
const fmtDayDelta = (secs) => {
  const a = Math.abs(Math.round(secs));
  const m = Math.floor(a / 60), s = a % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};

// Meteorological wind direction (degrees the wind blows FROM) → 8-point cardinal.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const windCardinal = (deg) => Number.isFinite(deg) ? COMPASS[Math.round(deg / 45) % 8] : null;

// UV index → [label, color]. Standard WHO bands; color-coded so the risk reads
// at a glance from across the room. Night-time UV is 0 → "Low", which is correct.
const uvBand = (u) => u == null ? ['—', 'var(--ink-faint)']
  : u < 3 ? ['Low', '#74f7b0'] : u < 6 ? ['Moderate', '#f7d774']
  : u < 8 ? ['High', '#f7a374'] : u < 11 ? ['Very high', '#f77474'] : ['Extreme', '#c074f7'];

// "2026-05-31T05:51" (already local to requested tz) -> "5:51a"
function fmtClock(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return '—';
  let h = parseInt(m[1], 10); const min = m[2];
  const ap = h < 12 ? 'a' : 'p'; h = h % 12; if (h === 0) h = 12;
  return `${h}:${min}${ap}`;
}
// Minutes past local midnight for an Open-Meteo local ISO time ("…T06:12").
// Both the sun times and "now" are read in the SAME display tz and compared as
// minutes-past-midnight, so the countdown is immune to the host clock's own zone.
function minutesOf(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
// "3h 12m" / "48m" — a compact duration from a minute count (minutes dropped at 0).
const fmtDur = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };

export default {
  id: 'weather',
  title: 'Weather',
  icon: '🌤',
  size: 'tall', // half width × 2 rows — sits beside the Daily Almanac
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      /* half-width × 2 rows: wasted horizontal space collapsed, every reading kept */
      .wx { display:flex; flex-direction:column; height:100%; gap:12px; }
      .wx-top { display:flex; align-items:center; gap:12px; }
      .wx-emoji { width:58px; height:58px; flex:none; filter:drop-shadow(0 4px 12px rgba(0,0,0,.4));
        animation:wxfloat .9s ease-out both; }
      /* one-shot entrance only — the icon settles into place and the page stops
         scheduling frames (no perpetual animation on this low-power kiosk). */
      @keyframes wxfloat { from{transform:translateY(-8px);opacity:0} to{transform:translateY(0);opacity:1} }
      @media (prefers-reduced-motion: reduce) { .wx-emoji { animation:none; } }
      .wx-icon { display:block; }
      .wx-temp { display:flex; align-items:baseline; gap:8px; flex:none; }
      .wx-temp .f { font-family:var(--font-display); font-size:42px; font-weight:600; line-height:.85;
        background:linear-gradient(120deg,#fff,var(--mint)); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .wx-temp .c { font-family:var(--font-display); font-size:22px; font-weight:600; color:var(--ink-soft); line-height:1; }
      .wx-meta { margin-left:auto; text-align:right; display:flex; flex-direction:column; gap:3px; min-width:0; }
      .wx-meta .cond { font-size:18px; font-weight:600; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wx-meta .range { font-family:var(--font-mono); font-size:12.5px; color:var(--ink-faint); letter-spacing:.02em; }
      /* sunrise/sunset + tomorrow on their own compact line below — full width,
         so nothing is dropped when the header row narrows. */
      .wx-sky { display:flex; flex-wrap:wrap; gap:4px 14px; font-family:var(--font-mono); font-size:12.5px; letter-spacing:.02em; }
      .wx-sky .sun { color:var(--ink-soft); }
      /* which sun event is next, and how soon — a live mint clause beside the
         sunrise/sunset times, updated each minute (cheap text-only repaint). It
         turns a pair of fixed clock times into an at-a-glance "sunset in 3h 12m". */
      .wx-sky .nextsun { color:var(--mint); white-space:nowrap; }
      /* length of day — derived from sunrise/sunset; the trend clause is a hushed
         mono caption so it never competes with the hero readings above. */
      .wx-sky .day { color:var(--ink-soft); display:inline-flex; align-items:baseline; gap:5px; white-space:nowrap; }
      .wx-sky .day b { color:var(--ink); font-weight:600; }
      .wx-sky .day .tr { color:var(--ink-faint); letter-spacing:.01em; }
      .wx-sky .tmrw { color:var(--mint); }
      /* tomorrow's warmer/cooler cue — a quiet caret + word tinted gold (warmer)
         or blue (cooler), echoing the timeline's peak/trough colours. */
      .wx-sky .tmrw .tt { font-weight:600; letter-spacing:.01em; white-space:nowrap; }
      .wx-sky .uv { color:var(--ink-soft); display:inline-flex; align-items:center; gap:5px; }
      .wx-sky .uv .dot { width:8px; height:8px; border-radius:50%; flex:none; }
      .wx-sky .uv b { color:var(--ink); font-weight:600; }
      .wx-stats { display:flex; gap:8px; }
      .wx-stat { flex:1; min-width:0; background:rgba(255,255,255,.04); border:1px solid var(--stroke); border-radius:12px;
        padding:8px 10px; display:flex; flex-direction:column; gap:2px; }
      .wx-stat .k { font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-faint); white-space:nowrap; }
      .wx-stat .v { font-family:var(--font-display); font-size:15.5px; font-weight:600; color:var(--ink); line-height:1.05;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:baseline; gap:3px; }
      /* wind arrow — points the way the wind blows; static rotation, no animation */
      .wx-stat .wx-wdir { display:inline-block; font-size:14px; line-height:1; color:var(--mint);
        transform-origin:center; flex:none; }
      .wx-stat .wx-wu { font-size:11px; font-weight:600; color:var(--ink-faint); letter-spacing:.02em;
        overflow:hidden; text-overflow:ellipsis; }

      /* linear hourly timeline — sits in its own panel, clearly divided from the
         stat rows above so the floating temp labels can never collide with them. */
      .wx-tl { margin-top:auto; display:flex; flex-direction:column; gap:0;
        padding-top:14px; border-top:1px solid var(--stroke); }
      .wx-plot { position:relative; height:40px; }
      .wx-plot svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .wx-pt { position:absolute; transform:translate(-50%,-50%); width:0; height:0; }
      .wx-pt .dot { position:absolute; left:-4px; top:-4px; width:9px; height:9px; border-radius:50%;
        background:var(--mint); box-shadow:0 0 8px rgba(116,247,176,.7); }
      .wx-pt .tv { position:absolute; left:50%; bottom:11px; transform:translateX(-50%);
        font-family:var(--font-mono); font-size:13px; font-weight:600; color:var(--ink); white-space:nowrap; }
      /* Warmest / coolest hour ahead — the curve's own peak and trough, tinted so
         the day's temperature arc reads at a glance across the room. Colour + a
         caret in the label carry the meaning; no extra height, no animation. */
      .wx-pt .dot.hi { background:var(--gold); box-shadow:0 0 10px rgba(255,217,138,.85); }
      .wx-pt .dot.lo { background:#9cc0ff; box-shadow:0 0 10px rgba(156,192,255,.85); }
      .wx-pt .tv.hi { color:var(--gold); }
      .wx-pt .tv.lo { color:#9cc0ff; }
      .wx-pt .tv .cr { font-size:10px; margin-right:1px; vertical-align:1px; }
      .wx-axis { display:flex; margin-top:5px; }
      .wx-axis .hr { flex:1; text-align:center; display:flex; flex-direction:column; align-items:center; gap:2px; }
      .wx-axis .hr .e { font-size:13px; line-height:1; }
      .wx-axis .hr .t { font-size:11px; color:var(--ink-faint); font-family:var(--font-mono); }
      /* rain-chance: a quiet blue line beneath each hour. Reserves its height even
         when empty so the axis row never jumps; only speaks up when rain is likely. */
      .wx-axis .hr .p { font-family:var(--font-mono); font-size:10px; line-height:1; min-height:10px;
        color:#9cc0ff; letter-spacing:.01em; }
      .wx-axis .hr .p.dry { visibility:hidden; }
    `);
    body.appendChild(ctx.loading('reading the sky…'));

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day`
        + `&hourly=temperature_2m,weather_code,precipitation_probability,uv_index,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,daylight_duration`
        + `&temperature_unit=fahrenheit&wind_speed_unit=mph`
        + `&timezone=${encodeURIComponent(tz)}&forecast_days=2`;

      // Live "next sun event" countdown. sunMins holds today's sunrise/sunset as
      // minutes-past-midnight (display tz); sunNextEl is the span we update each
      // minute. Comparing against "now" (also read in the display tz) keeps the
      // countdown correct no matter what zone the host clock runs in.
      let sunMins = null;
      let sunNextEl = null;
      const nowFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const nowMinutes = () => {
        const p = nowFmt.formatToParts(new Date());
        const hh = parseInt(p.find((x) => x.type === 'hour')?.value || '0', 10);
        const mm = parseInt(p.find((x) => x.type === 'minute')?.value || '0', 10);
        return hh * 60 + mm;
      };
      const updateSunNext = () => {
        if (!sunNextEl || !sunMins) return;
        const { sunrise, sunset } = sunMins;
        const now = nowMinutes();
        let ev = null;
        if (sunrise != null && now < sunrise) ev = { name: 'sunrise', at: sunrise };
        else if (sunset != null && now < sunset) ev = { name: 'sunset', at: sunset };
        else if (sunrise != null) ev = { name: 'sunrise', at: sunrise + 1440 }; // tomorrow (≈ same time)
        if (!ev) { sunNextEl.textContent = ''; sunNextEl.title = ''; return; }
        const txt = `${ev.name} in ${fmtDur(ev.at - now)}`;
        sunNextEl.textContent = `· ${txt}`;
        sunNextEl.title = `Next: ${txt}`;
      };

      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const cur = d.current;
        const [cond, baseSlug] = WMO(cur.weather_code);
        // Now: pick the day or night face of the current condition.
        const iconSlug = nightSlug(baseSlug, cur.is_day);
        const wxIcon = (slug, px) => ctx.h('img', { class: 'wx-icon', src: `/assets/weather/${slug}.svg`, width: px, height: px, alt: '' });
        const tF = Math.round(cur.temperature_2m);
        const hi = Math.round(d.daily.temperature_2m_max[0]);
        const lo = Math.round(d.daily.temperature_2m_min[0]);
        const feels = Math.round(cur.apparent_temperature);
        const hum = Math.round(cur.relative_humidity_2m);
        const wind = Math.round(cur.wind_speed_10m);
        // Wind direction: an arrow pointing the way the wind BLOWS (from-dir + 180°),
        // labelled with the cardinal it comes from. Rotation is a one-shot static
        // transform — no animation, free to render.
        const windDir = cur.wind_direction_10m;
        const windCard = windCardinal(windDir);
        const sunrise = fmtClock(d.daily.sunrise?.[0]);
        const sunset = fmtClock(d.daily.sunset?.[0]);
        const sunriseMin = minutesOf(d.daily.sunrise?.[0]);
        const sunsetMin = minutesOf(d.daily.sunset?.[0]);

        // Length of day + how it's changing — a quiet, seasonal reading derived
        // from the sunrise/sunset the widget already shows. daylight_duration is
        // in seconds; the day-over-day delta (today→tomorrow) shows the year turning.
        const dayLenSecs = d.daily.daylight_duration?.[0];
        const tmrwLenSecs = d.daily.daylight_duration?.[1];
        const dayLen = Number.isFinite(dayLenSecs) ? fmtDayLen(dayLenSecs) : null;
        const dayDeltaSecs = (Number.isFinite(dayLenSecs) && Number.isFinite(tmrwLenSecs))
          ? tmrwLenSecs - dayLenSecs : null;
        // Ignore sub-15s wobble (rounding near a solstice) so the arrow is honest.
        const dayTrend = (dayDeltaSecs != null && Math.abs(dayDeltaSecs) >= 15)
          ? (dayDeltaSecs > 0
            ? { arrow: '↑', word: 'longer' }
            : { arrow: '↓', word: 'shorter' })
          : null;

        // UV index — current hour's reading, with the day's peak for context.
        const hNow = new Date().getHours();
        const uvNowRaw = d.hourly.uv_index?.[hNow];
        const uvNow = Number.isFinite(uvNowRaw) ? Math.round(uvNowRaw) : null;
        const uvPeakRaw = d.daily.uv_index_max?.[0];
        const uvPeak = Number.isFinite(uvPeakRaw) ? Math.round(uvPeakRaw) : null;
        const [uvLabel, uvColor] = uvBand(uvNow);

        // Tomorrow's outlook — condition + high/low from the second daily entry
        // (forecast_days=2 guarantees it's present). What the humans actually
        // wanted here: "what's it going to be like tomorrow", not a countdown.
        const tmrwCode = d.daily.weather_code?.[1];
        const tmrwHi = d.daily.temperature_2m_max?.[1];
        const tmrwLabel = (tmrwCode != null && tmrwHi != null)
          ? `${WMO(tmrwCode)[0]} · H ${Math.round(tmrwHi)}° L ${Math.round(d.daily.temperature_2m_min[1])}°`
          : '—';
        // …and how tomorrow's high compares to today's — a glanceable "dress
        // warmer / lighter" cue. Uses the SAME gold-▲ (warmer) / blue-▼ (cooler)
        // language as the hourly timeline's peak/trough, so it reads instantly.
        // Only spoken when the swing is worth noting (≥3°F); a similar day stays
        // a hushed word so the line doesn't cry wolf over a 1° wobble.
        const tmrwDelta = (tmrwHi != null && Number.isFinite(hi)) ? Math.round(tmrwHi) - hi : null;
        const tmrwTrend = tmrwDelta == null ? null
          : tmrwDelta >= 3 ? { car: '▲', word: `${tmrwDelta}° warmer`, color: 'var(--gold)' }
          : tmrwDelta <= -3 ? { car: '▼', word: `${-tmrwDelta}° cooler`, color: '#9cc0ff' }
          : { car: '', word: 'about the same', color: 'var(--ink-faint)' };

        // Sample the next ~14h every 2 hours for a linear timeline.
        const idx = new Date().getHours();
        const STEP = 2, N = 6;
        const pts = [];
        for (let i = 0; i < N; i++) {
          const j = idx + i * STEP;
          if (j >= d.hourly.time.length) break;
          const t = Math.round(d.hourly.temperature_2m[j]);
          const hr = new Date(d.hourly.time[j]).getHours();
          const popRaw = d.hourly.precipitation_probability?.[j];
          const pop = Number.isFinite(popRaw) ? popRaw : null;
          pts.push({ t, code: d.hourly.weather_code[j], hr, pop, first: i === 0, isDay: d.hourly.is_day?.[j] });
        }
        const temps = pts.map((p) => p.t);
        const tMin = Math.min(...temps), tMax = Math.max(...temps);
        const span = (tMax - tMin) || 1;
        // The warmest and coolest sampled hours ahead — the curve's peak/trough.
        // Only flagged when there's a real spread (≥3°F) so a flat day stays calm;
        // ties resolve to the FIRST/EARLIEST occurrence (the soonest peak/low).
        let hiIdx = 0, loIdx = 0;
        pts.forEach((p, i) => { if (p.t > pts[hiIdx].t) hiIdx = i; if (p.t < pts[loIdx].t) loIdx = i; });
        const markExtremes = (tMax - tMin) >= 3 && hiIdx !== loIdx;
        // y as a percentage from top; warm sits high, cool sits low, padded so
        // temp labels above the dots never clip the plot.
        const yOf = (t) => 80 - ((t - tMin) / span) * 52; // 28%..80%
        const xOf = (i) => (N === 1 ? 50 : (i / (pts.length - 1)) * 100);

        const linePts = pts.map((p, i) => `${xOf(i)},${yOf(p.t)}`).join(' ');
        const areaPts = `0,100 ${linePts} 100,100`;

        // Night shading — a static, cool wash behind the hours that fall after
        // sunset / before sunrise, so the evening reads at a glance on the temp
        // curve (it echoes the star-lit night icons already used on the axis).
        // Purely additive to the SVG; adds NO height, so the card can't clip.
        // Each sample owns the span to the midpoint of its neighbours; runs of
        // night samples merge into one rect, and internal day↔night edges get a
        // hushed vertical divider marking the moment the sun crosses.
        // Midpoint between samples i-1 and i (valid for 1..len-1); a column's left
        // edge is the midpoint to its previous neighbour, its right edge the
        // midpoint to the next — with the plot's 0/100 edges capping the ends.
        const mid = (i) => (xOf(i - 1) + xOf(i)) / 2;
        const colOf = (i) => [
          i === 0 ? 0 : mid(i),
          i === pts.length - 1 ? 100 : mid(i + 1),
        ];
        const isNight = (p) => p.isDay === 0;
        let nightRects = '', edgeLines = '', k = 0;
        while (k < pts.length) {
          if (isNight(pts[k])) {
            const [start] = colOf(k);
            let e = k;
            while (e + 1 < pts.length && isNight(pts[e + 1])) e++;
            const [, end] = colOf(e);
            nightRects += `<rect x="${start}" y="0" width="${Math.max(0, end - start)}" height="100" fill="url(#wxnight)"/>`;
            // A faint divider at an interior sun-crossing (skip the plot edges).
            if (start > 0.5) edgeLines += `<line x1="${start}" y1="0" x2="${start}" y2="100" stroke="rgba(180,196,255,.28)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
            if (end < 99.5) edgeLines += `<line x1="${end}" y1="0" x2="${end}" y2="100" stroke="rgba(180,196,255,.28)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
            k = e + 1;
          } else k++;
        }

        const svg = `
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="wxfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgba(116,247,176,.28)"/>
                <stop offset="1" stop-color="rgba(116,247,176,0)"/>
              </linearGradient>
              <linearGradient id="wxnight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgba(84,102,170,.26)"/>
                <stop offset="1" stop-color="rgba(60,74,130,.10)"/>
              </linearGradient>
            </defs>
            ${nightRects}
            <polygon points="${areaPts}" fill="url(#wxfill)"/>
            ${edgeLines}
            <polyline points="${linePts}" fill="none" stroke="var(--mint)" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          </svg>`;

        const hr12 = (hh) => `${((hh + 11) % 12) + 1}${hh < 12 ? 'a' : 'p'}`;
        const dots = pts.map((p, i) => {
          const isHi = markExtremes && i === hiIdx;
          const isLo = markExtremes && i === loIdx;
          const kind = isHi ? ' hi' : isLo ? ' lo' : '';
          const when = p.first ? 'now' : hr12(p.hr);
          const title = isHi ? `Warmest ahead · ${p.t}°F at ${when}`
            : isLo ? `Coolest ahead · ${p.t}°F at ${when}` : '';
          return ctx.h('div', {
            class: 'wx-pt', style: { left: `${xOf(i)}%`, top: `${yOf(p.t)}%` }, title,
          },
            ctx.h('div', { class: `tv${kind}` },
              (isHi || isLo) ? ctx.h('span', { class: 'cr' }, isHi ? '▲' : '▼') : null,
              `${p.t}°`),
            ctx.h('div', { class: `dot${kind}` }));
        });

        const axis = pts.map((p) => {
          const slug = nightSlug(WMO(p.code)[1], p.isDay);
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
              ctx.h('div', { class: 'range' }, `H ${hi}°  ·  L ${lo}°`))),
          ctx.h('div', { class: 'wx-sky' },
            dayLen ? ctx.h('span', {
              class: 'day',
              title: dayTrend
                ? `${dayLen} of daylight · ${fmtDayDelta(dayDeltaSecs)} ${dayTrend.word} tomorrow`
                : `${dayLen} of daylight`,
            }, '☀ ', ctx.h('b', {}, dayLen),
              dayTrend ? ctx.h('span', { class: 'tr' },
                `${dayTrend.arrow} ${fmtDayDelta(dayDeltaSecs)}`) : null) : null,
            ctx.h('span', { class: 'sun' }, `↑ ${sunrise}  ↓ ${sunset} `,
              ctx.h('span', { class: 'nextsun' })),
            ctx.h('span', {
              class: 'uv',
              title: uvPeak != null ? `UV index now ${uvNow ?? '—'} · peak ${uvPeak} today` : 'UV index',
            }, ctx.h('span', { class: 'dot', style: { background: uvColor, boxShadow: `0 0 6px ${uvColor}` } }),
              'UV ', ctx.h('b', {}, `${uvNow ?? '—'}`), ` ${uvLabel}`),
            ctx.h('span', {
              class: 'tmrw',
              title: tmrwTrend && tmrwTrend.car
                ? `Tomorrow — ${tmrwLabel} · ${tmrwTrend.word} than today`
                : `Tomorrow — ${tmrwLabel}`,
            }, `Tomorrow: ${tmrwLabel}`,
              tmrwTrend ? ctx.h('span', { class: 'tt', style: { color: tmrwTrend.color } },
                ` ${tmrwTrend.car ? tmrwTrend.car + ' ' : ''}${tmrwTrend.word}`) : null)),
          ctx.h('div', { class: 'wx-stats' },
            ctx.h('div', { class: 'wx-stat' },
              ctx.h('div', { class: 'k' }, 'Feels like'),
              ctx.h('div', { class: 'v' }, `${feels}°F · ${fToC(feels)}°C`)),
            ctx.h('div', { class: 'wx-stat' },
              ctx.h('div', { class: 'k' }, 'Humidity'),
              ctx.h('div', { class: 'v' }, `${hum}%`)),
            ctx.h('div', { class: 'wx-stat' },
              ctx.h('div', { class: 'k' }, 'Wind'),
              ctx.h('div', {
                class: 'v',
                title: windCard ? `From the ${windCard} · ${wind} mph` : `${wind} mph`,
              },
                windCard ? ctx.h('span', {
                  class: 'wx-wdir',
                  style: { transform: `rotate(${windDir + 180}deg)` },
                }, '↑') : null,
                `${wind}`,
                ctx.h('span', { class: 'wx-wu' }, windCard ? ` mph ${windCard}` : ' mph')))),
          ctx.h('div', { class: 'wx-tl' },
            plot,
            ctx.h('div', { class: 'wx-axis' }, ...axis))));

        // Wire up the live "next sun event" countdown against this fresh render.
        sunMins = { sunrise: sunriseMin, sunset: sunsetMin };
        sunNextEl = body.querySelector('.nextsun');
        updateSunNext();
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
      // Tick the "next sun event" countdown each minute (cheap text-only update)
      // so it stays live between the 15-minute data refreshes; no-ops until loaded.
      ctx.interval(updateSunNext, 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('weather unavailable'));
    }
  },
};
