// Tides — San Francisco (Golden Gate, NOAA station 9414290) high/low predictions
// via the keyless NOAA Tides & Currents API (through the proxy). One fetch gives
// the day's hi/lo extremes; the smooth tide curve and the live "current height"
// are COSINE-INTERPOLATED locally from those points (tides are very nearly
// sinusoidal between extremes), so the sparkline, the now-marker and the current
// reading all come from a single network call. SF lives by the water — when's
// the next high tide?

const STATION = '9414290';            // San Francisco, Golden Gate
const SEA = '#6cc6e8';                // tide accent (a calm bay blue)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

// NOAA returns naive local timestamps ("2026-06-20 03:50") already in the
// station's local time (lst_ldt). The kiosk runs in Pacific, so parsing as
// local time is correct.
const parseT = (s) => new Date(s.replace(' ', 'T'));

// Cosine interpolation of height at time t between two extremes (a → b).
function interp(t, a, b) {
  if (t <= a.t) return a.v;
  if (t >= b.t) return b.v;
  const frac = (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * frac)) / 2;
}

export default {
  id: 'tides',
  title: 'Tides',
  icon: '🌊',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const tz = (ctx.config && ctx.config.tz) || 'America/Los_Angeles';
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtTime = (d) => {
      const p = Object.fromEntries(timeFmt.formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.hour}:${p.minute}${(p.dayPeriod || '').slice(0, 1).toLowerCase()}`;
    };
    const fmtDur = (ms) => {
      const m = Math.max(0, Math.round(ms / 60000));
      const h = Math.floor(m / 60);
      return h > 0 ? `${h}h ${pad2(m % 60)}m` : `${m}m`;
    };

    ctx.style(`
      .td { display:flex; flex-direction:column; height:100%; justify-content:center; gap:11px; }
      .td-chart { position:relative; width:100%; flex:0 0 auto; }
      .td-chart svg { display:block; width:100%; height:62px; }
      .td-row { display:flex; align-items:center; gap:13px; }
      .td-arr { font-size:30px; line-height:1; color:var(--td); flex:0 0 auto; }
      .td-lab { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; }
      .td-hd { font-family:var(--font-display); font-size:23px; font-weight:700; color:var(--ink); line-height:1; }
      .td-hd b { color:var(--td); font-weight:700; }
      .td-sub { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); letter-spacing:.01em;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .td-cur { flex:0 0 auto; text-align:right; display:flex; flex-direction:column; gap:2px;
        padding-left:13px; border-left:1px solid var(--stroke); }
      .td-cur .v { font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--ink); line-height:1; }
      .td-cur .k { font-family:var(--font-mono); font-size:9px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-faint); }
      .td-na { font-size:13px; color:var(--ink-faint); }
    `);
    body.appendChild(ctx.loading('reading the tide…'));

    const now = new Date();
    const ymd = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
    const begin = new Date(now.getTime() - 18 * 3600 * 1000);
    const end = new Date(now.getTime() + 40 * 3600 * 1000);
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
      + `?product=predictions&application=gardener_garden&datum=MLLW&station=${STATION}`
      + `&time_zone=lst_ldt&units=english&interval=hilo&format=json`
      + `&begin_date=${ymd(begin)}&end_date=${ymd(end)}`;

    const fetchTides = async () => {
      const d = await ctx.fetchJSON(url);
      const preds = d && d.predictions;
      if (!Array.isArray(preds) || !preds.length) throw new Error('no tide data');
      const ex = preds.map((p) => ({ t: parseT(p.t).getTime(), v: parseFloat(p.v), type: p.type }))
        .filter((p) => isFinite(p.t) && isFinite(p.v))
        .sort((a, b) => a.t - b.t);
      if (ex.length < 2) throw new Error('thin tide data');
      return ex;
    };

    const render = (ex) => {
      const nowMs = Date.now();
      let seg = 0;
      while (seg < ex.length - 2 && ex[seg + 1].t <= nowMs) seg++;
      const curH = interp(nowMs, ex[seg], ex[seg + 1]);
      const next = ex.find((p) => p.t > nowMs) || ex[ex.length - 1];
      const rising = next.type === 'H';

      // ---- tide sparkline (sampled cosine interpolation across an 18h window) ----
      const W = 400, H = 62, padX = 8, padTop = 9, padBot = 11;
      const winStart = nowMs - 5 * 3600 * 1000;
      const winEnd = nowMs + 13 * 3600 * 1000;
      const N = 96;
      const samples = [];
      for (let i = 0; i <= N; i++) {
        const t = winStart + (winEnd - winStart) * (i / N);
        let s = 0;
        while (s < ex.length - 2 && ex[s + 1].t <= t) s++;
        samples.push({ t, v: interp(t, ex[s], ex[s + 1]) });
      }
      let lo = Infinity, hi = -Infinity;
      for (const s of samples) { if (s.v < lo) lo = s.v; if (s.v > hi) hi = s.v; }
      const span = Math.max(0.5, hi - lo);
      lo -= span * 0.10; hi += span * 0.22;
      const X = (t) => padX + (W - 2 * padX) * (t - winStart) / (winEnd - winStart);
      const Y = (v) => padTop + (H - padTop - padBot) * (1 - (v - lo) / (hi - lo));
      const pts = samples.map((s) => `${X(s.t).toFixed(1)},${Y(s.v).toFixed(1)}`);
      const line = 'M' + pts.join(' L');
      const area = `${line} L${X(winEnd).toFixed(1)},${(H - padBot).toFixed(1)} L${X(winStart).toFixed(1)},${(H - padBot).toFixed(1)} Z`;
      const nowX = X(nowMs), nowY = Y(curH);

      const inWin = ex.filter((p) => p.t >= winStart && p.t <= winEnd);
      const dots = inWin.map((p) =>
        `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.4" fill="${p.type === 'H' ? SEA : '#7f9aa6'}"/>`).join('');
      const labels = inWin.map((p) => {
        const y = Y(p.v) + (p.type === 'H' ? -5 : 11);
        return `<text x="${X(p.t).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle"
          font-family="ui-monospace,monospace" font-size="8" fill="#8fb0bd" opacity=".9">${fmtTime(new Date(p.t))}</text>`;
      }).join('');

      const svg = `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="tdfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${SEA}" stop-opacity=".30"/>
              <stop offset="100%" stop-color="${SEA}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${area}" fill="url(#tdfill)"/>
          <path d="${line}" fill="none" stroke="${SEA}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <line x1="${nowX.toFixed(1)}" y1="${padTop - 3}" x2="${nowX.toFixed(1)}" y2="${H - padBot}"
            stroke="#ffffff" stroke-opacity=".22" stroke-width="1" stroke-dasharray="2 3"/>
          ${dots}${labels}
          <circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="4" fill="#fff"/>
          <circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="4" fill="none" stroke="${SEA}" stroke-width="2"/>
        </svg>`;

      body.replaceChildren(ctx.h('div', { class: 'td', style: { '--td': SEA } },
        ctx.h('div', { class: 'td-chart', html: svg }),
        ctx.h('div', { class: 'td-row' },
          ctx.h('span', { class: 'td-arr' }, rising ? '▲' : '▼'),
          ctx.h('div', { class: 'td-lab' },
            ctx.h('div', { class: 'td-hd', html: `${rising ? 'High' : 'Low'} <b>${next.v.toFixed(1)}ft</b>` }),
            ctx.h('div', { class: 'td-sub' }, `${rising ? 'rising' : 'falling'} · in ${fmtDur(next.t - nowMs)} · ${fmtTime(new Date(next.t))}`)),
          ctx.h('div', { class: 'td-cur' },
            ctx.h('div', { class: 'v' }, `${curH.toFixed(1)}ft`),
            ctx.h('div', { class: 'k' }, 'now')))));
      body.dataset.loaded = '1';
    };

    let last = null;
    try {
      for (let attempt = 1; attempt <= 3 && !last; attempt++) {
        try { last = await fetchTides(); }
        catch { if (attempt < 3) await sleep(900 * attempt); }
      }
      if (!last) { body.replaceChildren(ctx.error('tides unavailable — retrying…')); }
      else render(last);
      // Refresh: re-fetch hourly to roll the window forward; the cheap re-render
      // (every 5 min) keeps the now-marker, countdown and live height current.
      let ticks = 0;
      ctx.interval(async () => {
        ticks++;
        if (ticks % 12 === 0) {                 // ~hourly: pull fresh predictions
          try { last = await fetchTides(); } catch { /* keep last good */ }
        }
        if (last) render(last);                 // ~5 min: refresh the marker/clock
      }, 5 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('tides unavailable'));
    }
  },
};
