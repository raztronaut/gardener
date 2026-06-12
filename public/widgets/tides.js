// Tides & Ocean — San Francisco (NOAA CO-OPS station 9414290) high/low tide
// predictions drawn as a smooth tide curve with a live "now" marker, plus the
// next tide headline and ocean temperature + swell from keyless Open-Meteo.
// All keyless, fetched through the SSRF-safe proxy. Graceful loading/error,
// retries the initial load, and keeps the last good render on a failed refresh.

const STATION = '9414290'; // San Francisco (Presidio), CA
const TZ = 'America/Los_Angeles';
// Theme literals (var() is unreliable inside SVG presentation attributes on WebKitGTK).
const C = { mint: '#74f7b0', tide: '#8fd0ff', faint: '#6f9388', mono: 'ui-monospace, "JetBrains Mono", Menlo, monospace' };

// "YYYYMMDD" for *today* in the station's timezone (independent of kiosk locale).
function stationDateStr(now) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}${p.month}${p.day}`;
}

// NOAA returns local-to-station times like "2026-06-12 21:34". Parse into a Date
// using the numbers directly (kiosk runs in the station tz, so this aligns with now).
function parseNoaa(t) {
  const m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(t || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function fmtTime(d) {
  let h = d.getHours(); const min = d.getMinutes();
  const ap = h < 12 ? 'a' : 'p'; h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')}${ap}`;
}

// Cosine interpolation of tide height (ft) between consecutive hi/lo extremes.
function tideHeight(t, ev) {
  if (t <= ev[0].time) return ev[0].v;
  const last = ev[ev.length - 1];
  if (t >= last.time) return last.v;
  for (let i = 0; i < ev.length - 1; i++) {
    const a = ev[i], b = ev[i + 1];
    if (t >= a.time && t <= b.time) {
      const f = (t - a.time) / (b.time - a.time);
      return a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2;
    }
  }
  return last.v;
}

export default {
  id: 'tides',
  title: 'Tides',
  icon: '🌊',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.8074, lon = -122.4659 } = ctx.config || {};
    ctx.style(`
      .td { display:flex; flex-direction:column; height:100%; justify-content:center; gap:12px; }
      .td-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .td-next { min-width:0; }
      .td-next .lab { font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); }
      .td-next .hl { display:flex; align-items:baseline; gap:8px; margin-top:3px; }
      .td-next .arrow { font-size:20px; line-height:1; color:var(--mint); }
      .td-next .arrow.fall { color:#8fd0ff; }
      .td-next .v { font-family:var(--font-display); font-size:27px; font-weight:600; color:var(--ink); line-height:1; }
      .td-next .at { font-family:var(--font-mono); font-size:13px; color:var(--ink-soft); }
      .td-ocean { display:flex; flex-direction:column; align-items:flex-end; gap:3px; flex:none; }
      .td-ocean .o { display:flex; align-items:baseline; gap:5px; }
      .td-ocean .ov { font-family:var(--font-mono); font-weight:600; color:var(--ink); font-size:14px; }
      .td-ocean .ok { font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint); }
      .td-curve { width:100%; }
      .td-curve svg { display:block; width:100%; height:auto; }
      .td-na { font-size:12.5px; color:var(--ink-faint); }
    `);
    body.appendChild(ctx.loading('reading the tide…'));

    const beginDate = stationDateStr(new Date());
    const tideUrl = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
      + `?product=predictions&application=gardener&begin_date=${beginDate}&range=48`
      + `&datum=MLLW&station=${STATION}&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
    const oceanUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
      + '&current=wave_height,sea_surface_temperature&temperature_unit=fahrenheit&length_unit=metric';

    const fetchTides = async () => {
      const d = await ctx.fetchJSON(tideUrl);
      const ev = (d?.predictions || [])
        .map((p) => ({ time: parseNoaa(p.t), v: parseFloat(p.v), type: p.type }))
        .filter((p) => p.time && Number.isFinite(p.v))
        .sort((a, b) => a.time - b.time);
      if (ev.length < 2) throw new Error('no tide data');
      return ev;
    };
    const fetchOcean = async () => {
      const d = await ctx.fetchJSON(oceanUrl);
      const c = d?.current; if (!c) return null;
      return {
        temp: Number.isFinite(c.sea_surface_temperature) ? Math.round(c.sea_surface_temperature) : null,
        swellFt: Number.isFinite(c.wave_height) ? Math.round(c.wave_height * 3.281 * 10) / 10 : null,
      };
    };

    // Smooth tide-curve SVG across a ~15h window centred a little before "now".
    function curveSvg(ev, now) {
      const W = 300, H = 96, padX = 10, top = 16, bot = 74;
      const start = now.getTime() - 2.5 * 3600e3;
      const end = now.getTime() + 12.5 * 3600e3;
      const span = end - start;
      const xOf = (t) => padX + ((t - start) / span) * (W - 2 * padX);
      // y-scale from the extremes visible in-window (plus margin)
      const win = ev.filter((e) => e.time.getTime() >= start - 6 * 3600e3 && e.time.getTime() <= end + 6 * 3600e3);
      const vs = win.map((e) => e.v);
      let lo = Math.min(...vs), hi = Math.max(...vs);
      if (!(hi > lo)) { hi = lo + 1; }
      lo -= (hi - lo) * 0.18; hi += (hi - lo) * 0.12;
      const yOf = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);

      const N = 80; let dpath = '';
      for (let i = 0; i <= N; i++) {
        const t = start + (span * i) / N;
        const x = xOf(t).toFixed(1), y = yOf(tideHeight(t, ev)).toFixed(1);
        dpath += (i ? 'L' : 'M') + x + ' ' + y + ' ';
      }
      const areaPath = dpath + `L${xOf(end).toFixed(1)} ${bot} L${xOf(start).toFixed(1)} ${bot} Z`;
      const nowX = xOf(now.getTime()), nowY = yOf(tideHeight(now.getTime(), ev));

      // hi/lo extreme dots + labels inside the window
      const marks = ev
        .filter((e) => e.time.getTime() >= start && e.time.getTime() <= end)
        .map((e) => {
          const x = xOf(e.time.getTime()), y = yOf(e.v), isHi = e.type === 'H';
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${isHi ? C.mint : C.tide}"/>`
            + `<text x="${x.toFixed(1)}" y="${(isHi ? y - 7 : y + 13).toFixed(1)}" text-anchor="middle" `
            + `font-family='${C.mono}' font-size="9" fill="${C.faint}">${fmtTime(e.time)}</text>`;
        }).join('');

      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="tide curve">
        <defs>
          <linearGradient id="tdfill-${STATION}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${C.mint}" stop-opacity="0.22"/>
            <stop offset="1" stop-color="${C.mint}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#tdfill-${STATION})"/>
        <path d="${dpath}" fill="none" stroke="${C.mint}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
        <line x1="${nowX.toFixed(1)}" y1="${top}" x2="${nowX.toFixed(1)}" y2="${bot}" stroke="${C.faint}" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>
        ${marks}
        <circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="4.5" fill="#fff"/>
        <circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="4.5" fill="none" stroke="${C.mint}" stroke-width="1.5"/>
      </svg>`;
    }

    const render = (ev, ocean) => {
      const now = new Date();
      const next = ev.find((e) => e.time.getTime() >= now.getTime()) || ev[ev.length - 1];
      const rising = next.type === 'H';
      const oceanEl = ocean && (ocean.temp != null || ocean.swellFt != null)
        ? ctx.h('div', { class: 'td-ocean' },
            ocean.temp != null ? ctx.h('div', { class: 'o' },
              ctx.h('span', { class: 'ov' }, `${ocean.temp}°`), ctx.h('span', { class: 'ok' }, 'Water')) : null,
            ocean.swellFt != null ? ctx.h('div', { class: 'o' },
              ctx.h('span', { class: 'ov' }, `${ocean.swellFt}ft`), ctx.h('span', { class: 'ok' }, 'Swell')) : null)
        : null;

      const curve = ctx.h('div', { class: 'td-curve', html: curveSvg(ev, now) });
      body.replaceChildren(ctx.h('div', { class: 'td' },
        ctx.h('div', { class: 'td-top' },
          ctx.h('div', { class: 'td-next' },
            ctx.h('div', { class: 'lab' }, rising ? 'Next · High tide' : 'Next · Low tide'),
            ctx.h('div', { class: 'hl' },
              ctx.h('span', { class: 'arrow' + (rising ? '' : ' fall') }, rising ? '▲' : '▼'),
              ctx.h('span', { class: 'v' }, `${next.v.toFixed(1)}ft`),
              ctx.h('span', { class: 'at' }, fmtTime(next.time)))),
          oceanEl),
        curve));
    };

    let ev = null, ocean = null;
    try {
      for (let attempt = 1; attempt <= 3 && !ev; attempt++) {
        try { ev = await fetchTides(); }
        catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 1800)); }
      }
      if (!ev) { body.replaceChildren(ctx.error('tide data unavailable')); return; }
      try { ocean = await fetchOcean(); } catch { /* optional */ }
      render(ev, ocean);
      // Re-render every ~10 min so the "now" marker and next-tide stay current.
      // Refresh predictions every ~3h; keep last good data on any failed fetch.
      let ticks = 0;
      ctx.interval(async () => {
        ticks++;
        if (ticks % 18 === 0) { // ~every 3h
          try { ev = await fetchTides(); } catch { /* keep last good */ }
          try { const o = await fetchOcean(); if (o) ocean = o; } catch { /* keep */ }
        }
        render(ev, ocean);
      }, 10 * 60 * 1000);
    } catch {
      body.replaceChildren(ctx.error('tide data unavailable'));
    }
  },
};
