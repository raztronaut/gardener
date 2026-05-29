// Tides — the bay's slow breath. Sea-level-vs-MSL curve for San Francisco via the
// keyless Open-Meteo Marine API (through the proxy). Shows current height + trend,
// an SVG tide curve with a "now" marker, and the next high & low tides.
const M_TO_FT = 3.28084;

function fmtClock(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return '—';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

const ft = (m) => (m * M_TO_FT);
const fmtFt = (m) => `${m >= 0 ? '+' : '−'}${Math.abs(ft(m)).toFixed(1)} ft`;

// First local extremum of the requested kind at/after index `from`.
function nextExtremum(vals, from, kind) {
  for (let i = Math.max(1, from); i < vals.length - 1; i++) {
    const a = vals[i - 1], b = vals[i], c = vals[i + 1];
    if (kind === 'high' && b >= a && b >= c && b > Math.min(a, c)) return i;
    if (kind === 'low' && b <= a && b <= c && b < Math.max(a, c)) return i;
  }
  return -1;
}

export default {
  id: 'tides',
  title: 'Tides',
  icon: '🌊',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .tide { display:flex; flex-direction:column; gap:16px; }
      .tide-now { display:flex; align-items:baseline; gap:14px; }
      .tide-now .h { font-family:var(--font-display); font-size:46px; font-weight:600; line-height:.9; color:var(--ink); }
      .tide-now .chip { font-size:13px; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
        padding:5px 11px; border-radius:999px; border:1px solid var(--stroke); }
      .tide-now .chip.rising { color:var(--mint); background:rgba(120,230,200,.08); }
      .tide-now .chip.falling { color:var(--gold); background:rgba(230,200,120,.08); }
      .tide-now .ref { margin-left:auto; align-self:flex-end; font-size:12px; color:var(--ink-faint); letter-spacing:.04em; }
      .tide-chart { position:relative; width:100%; }
      .tide-chart svg { display:block; width:100%; height:96px; overflow:visible; }
      .tide-ext { display:flex; gap:14px; }
      .tide-ext .card { flex:1; background:rgba(255,255,255,.04); border:1px solid var(--stroke);
        border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
      .tide-ext .lbl { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-faint);
        display:flex; align-items:center; gap:6px; }
      .tide-ext .time { font-family:var(--font-display); font-size:24px; font-weight:600; line-height:1; color:var(--ink); }
      .tide-ext .amt { font-family:var(--font-mono); font-size:13px; color:var(--ink-soft); }
    `);
    body.appendChild(ctx.loading('reading the bay…'));

    try {
      const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
        + `&hourly=sea_level_height_msl&timezone=${encodeURIComponent(tz)}&forecast_days=2`;

      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const times = d && d.hourly && d.hourly.time;
        const vals = d && d.hourly && d.hourly.sea_level_height_msl;
        if (!Array.isArray(times) || !Array.isArray(vals) || vals.length < 6) {
          body.replaceChildren(ctx.error('no tide data'));
          return;
        }
        // hourly[0] is 00:00 local today; current hour-of-day indexes into it
        // (matches the weather widget's convention for the SF kiosk).
        const idx = Math.min(vals.length - 2, Math.max(0, new Date().getHours()));
        const cur = vals[idx];
        const slope = vals[idx + 1] - vals[idx];
        const rising = slope >= 0;

        const hiI = nextExtremum(vals, idx + 1, 'high');
        const loI = nextExtremum(vals, idx + 1, 'low');

        // Curve window: a little past + the day ahead.
        const start = Math.max(0, idx - 4);
        const end = Math.min(vals.length - 1, idx + 20);
        const win = vals.slice(start, end + 1);
        let lo = Math.min(...win), hi = Math.max(...win);
        if (hi - lo < 0.001) { hi += 0.5; lo -= 0.5; }
        const W = 300, H = 96, padY = 12;
        const X = (i) => ((i - start) / (end - start)) * W;
        const Y = (v) => padY + (1 - (v - lo) / (hi - lo)) * (H - 2 * padY);

        let line = '';
        for (let i = start; i <= end; i++) line += `${i === start ? 'M' : 'L'}${X(i).toFixed(1)} ${Y(vals[i]).toFixed(1)} `;
        const area = `${line}L${W} ${H} L0 ${H} Z`;
        const nowX = X(idx).toFixed(1), nowY = Y(cur).toFixed(1);

        const marker = (i, color) => i < 0 ? '' :
          `<circle cx="${X(i).toFixed(1)}" cy="${Y(vals[i]).toFixed(1)}" r="3.5" fill="${color}" opacity=".9"/>`;

        const svg = `
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--mint)" stop-opacity=".34"/>
                <stop offset="100%" stop-color="var(--mint)" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="${area}" fill="url(#tideFill)"/>
            <path d="${line}" fill="none" stroke="var(--mint)" stroke-width="2.4"
                  stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            ${marker(hiI, 'var(--gold)')}
            ${marker(loI, 'var(--ink-faint)')}
            <line x1="${nowX}" y1="0" x2="${nowX}" y2="${H}" stroke="var(--ink)" stroke-opacity=".18" stroke-width="1" stroke-dasharray="3 4"/>
            <circle cx="${nowX}" cy="${nowY}" r="5" fill="var(--ink)"/>
            <circle cx="${nowX}" cy="${nowY}" r="9" fill="none" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1.5"/>
          </svg>`;

        const extCard = (icon, lbl, color, i) => ctx.h('div', { class: 'card' },
          ctx.h('div', { class: 'lbl', style: { color } }, `${icon} ${lbl}`),
          ctx.h('div', { class: 'time' }, i < 0 ? '—' : fmtClock(times[i])),
          ctx.h('div', { class: 'amt' }, i < 0 ? '' : fmtFt(vals[i])));

        // Order the two extremum cards by which comes first.
        const highFirst = hiI >= 0 && (loI < 0 || hiI <= loI);
        const cards = highFirst
          ? [extCard('▲', 'High', 'var(--gold)', hiI), extCard('▼', 'Low', 'var(--ink-soft)', loI)]
          : [extCard('▼', 'Low', 'var(--ink-soft)', loI), extCard('▲', 'High', 'var(--gold)', hiI)];

        body.replaceChildren(ctx.h('div', { class: 'tide' },
          ctx.h('div', { class: 'tide-now' },
            ctx.h('div', { class: 'h' }, fmtFt(cur)),
            ctx.h('div', { class: `chip ${rising ? 'rising' : 'falling'}` }, rising ? '↑ Rising' : '↓ Falling'),
            ctx.h('div', { class: 'ref' }, 'vs. mean sea level')),
          ctx.h('div', { class: 'tide-chart', html: svg }),
          ctx.h('div', { class: 'tide-ext' }, ...cards)));
      };

      await refresh();
      // Tide curve shifts slowly; refresh every 20 min keeps the "now" marker honest.
      ctx.interval(() => refresh().catch(() => {}), 20 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('tides unavailable'));
    }
  },
};
