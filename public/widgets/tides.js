// Tides — next high/low water for San Francisco (Golden Gate, NOAA station
// 9414290) via the keyless NOAA CO-OPS API (through the proxy). A calm, local,
// ambient strip: current trend + a smooth static tide curve with a "now" line.
// Heights are feet above MLLW; times are local (lst_ldt).
const STATION = '9414290'; // San Francisco, CA (Golden Gate)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "2026-06-15 03:21" (local) -> Date in the browser's local tz.
function parseT(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
function fmtTime(d) {
  let h = d.getHours(); const min = String(d.getMinutes()).padStart(2, '0');
  const ap = h < 12 ? 'a' : 'p'; h = h % 12; if (h === 0) h = 12;
  return `${h}:${min}${ap}`;
}
function fmtIn(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), mm = m % 60;
  if (h <= 0) return `${mm}m`;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

export default {
  id: 'tides',
  title: 'Tides',
  icon: '🌊',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .td { display:flex; flex-direction:column; gap:9px; height:100%; justify-content:center; }
      .td-top { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; }
      .td-trend { display:flex; align-items:center; gap:8px; }
      .td-arrow { font-size:22px; line-height:1; color:var(--td-accent); filter:drop-shadow(0 0 10px var(--td-accent)); }
      .td-trend .t { font-family:var(--font-display); font-size:26px; font-weight:700; color:var(--ink); line-height:1; }
      .td-next { font-size:13px; color:var(--ink-soft); text-align:right; line-height:1.2; }
      .td-next b { color:var(--td-accent); font-weight:700; }
      .td-chart { height:54px; position:relative; }
      .td-chart svg { width:100%; height:100%; display:block; }
      .td-chips { display:flex; gap:8px; }
      .td-chip { flex:1; min-width:0; display:flex; align-items:baseline; gap:6px;
        background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.07);
        border-radius:11px; padding:5px 11px; }
      .td-chip .ar { font-size:12px; line-height:1; color:var(--td-accent); }
      .td-chip .k { font-family:var(--font-mono); font-size:10px; letter-spacing:.1em;
        text-transform:uppercase; color:var(--ink-faint); }
      .td-chip .tm { font-family:var(--font-display); font-weight:700; font-size:16px; color:var(--ink); }
      .td-chip .ht { font-family:var(--font-mono); font-size:11.5px; color:var(--ink-soft); margin-left:auto; }
    `);
    body.appendChild(ctx.loading('reading the tide…'));

    const buildUrl = () => {
      const n = new Date();
      const bd = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
      return 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
        + `?product=predictions&application=gardenos&begin_date=${bd}&range=48`
        + `&datum=MLLW&station=${STATION}&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
    };
    const fetchEvents = async () => {
      const d = await ctx.fetchJSON(buildUrl());
      const evs = (d && d.predictions || [])
        .map((p) => ({ t: parseT(p.t), v: parseFloat(p.v), type: p.type }))
        .filter((e) => e.t && Number.isFinite(e.v));
      if (evs.length < 2) throw new Error('no tide predictions');
      return evs;
    };

    // Cosine interpolation between surrounding hi/lo events → a smooth curve.
    const interp = (events, t) => {
      if (t <= events[0].t) return events[0].v;
      const last = events[events.length - 1];
      if (t >= last.t) return last.v;
      for (let i = 0; i < events.length - 1; i++) {
        const a = events[i], b = events[i + 1];
        if (t >= a.t && t <= b.t) {
          const f = (t - a.t) / (b.t - a.t);
          return a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2;
        }
      }
      return last.v;
    };

    const draw = (events) => {
      const now = new Date();
      const wStart = +now - 1 * 3600e3;          // 12-hour window: 1h back, 11h ahead
      const wEnd = +now + 11 * 3600e3;
      const next = events.find((e) => +e.t > +now) || events[events.length - 1];
      const rising = next.type === 'H';
      const accent = rising ? '#74e6c8' : '#7cc4f0';
      const nextHigh = events.find((e) => +e.t > +now && e.type === 'H');
      const nextLow = events.find((e) => +e.t > +now && e.type === 'L');

      // sample the curve across the window for the path + y-scale
      const N = 90, xs = [];
      for (let i = 0; i <= N; i++) {
        const t = wStart + (wEnd - wStart) * (i / N);
        xs.push({ t, v: interp(events, new Date(t)) });
      }
      let vmin = Infinity, vmax = -Infinity;
      for (const s of xs) { if (s.v < vmin) vmin = s.v; if (s.v > vmax) vmax = s.v; }
      if (vmax - vmin < 0.5) { const m = (vmax + vmin) / 2; vmin = m - 0.5; vmax = m + 0.5; }
      const VBW = 1000, VBH = 100, yTop = 16, yBot = 84;
      const xOf = (t) => ((t - wStart) / (wEnd - wStart)) * VBW;
      const yOf = (v) => yTop + (1 - (v - vmin) / (vmax - vmin)) * (yBot - yTop);

      let line = '';
      xs.forEach((s, i) => { line += `${i ? 'L' : 'M'}${xOf(s.t).toFixed(1)},${yOf(s.v).toFixed(1)} `; });
      const area = `M${xOf(xs[0].t).toFixed(1)},${VBH} ` + xs.map((s) => `L${xOf(s.t).toFixed(1)},${yOf(s.v).toFixed(1)}`).join(' ')
        + ` L${xOf(xs[xs.length - 1].t).toFixed(1)},${VBH} Z`;
      const nowX = xOf(+now).toFixed(1);

      const svg = `
        <svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tdFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${accent}" stop-opacity="0.30"/>
              <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${area}" fill="url(#tdFill)"/>
          <path d="${line}" fill="none" stroke="${accent}" stroke-width="2.5"
            stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          <line x1="${nowX}" y1="6" x2="${nowX}" y2="${VBH}" stroke="#ffffff" stroke-opacity="0.5"
            stroke-width="1.5" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
        </svg>`;

      const chip = (key, ar, ev) => ctx.h('div', { class: 'td-chip' },
        ctx.h('span', { class: 'ar' }, ar),
        ctx.h('span', { class: 'k' }, key),
        ctx.h('span', { class: 'tm' }, ev ? fmtTime(ev.t) : '—'),
        ctx.h('span', { class: 'ht' }, ev ? `${ev.v.toFixed(1)} ft` : ''));

      body.replaceChildren(ctx.h('div', { class: 'td', style: { '--td-accent': accent } },
        ctx.h('div', { class: 'td-top' },
          ctx.h('div', { class: 'td-trend' },
            ctx.h('span', { class: 'td-arrow' }, rising ? '▲' : '▼'),
            ctx.h('span', { class: 't' }, rising ? 'Rising' : 'Falling')),
          ctx.h('div', { class: 'td-next', html: `${rising ? 'High' : 'Low'} in <b>${fmtIn(+next.t - +now)}</b>` })),
        ctx.h('div', { class: 'td-chart', html: svg }),
        ctx.h('div', { class: 'td-chips' },
          chip('High', '▲', nextHigh),
          chip('Low', '▼', nextLow))));
    };

    // Initial load with a few retries; periodic refresh keeps last good data.
    let events = null;
    for (let a = 0; a < 3 && !events; a++) {
      try { events = await fetchEvents(); }
      catch { if (a < 2) await sleep(700 * (a + 1)); }
    }
    if (!events) { body.replaceChildren(ctx.error('tides unavailable')); return; }
    draw(events);

    let first = true;
    ctx.interval(async () => {
      if (first) { first = false; return; }        // immediate fire: keep initial render
      try { events = await fetchEvents(); } catch { /* keep last good */ }
      if (events) draw(events);                     // also advances the "now" line
    }, 15 * 60 * 1000);
  },
};
