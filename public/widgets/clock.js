// Clock — the garden's heartbeat. A luminous hero time + date + greeting, with a
// quiet seasonal marker tucked to the right of the greeting line.
// (The Tuesday trash reminder used to live here as a small pill; it was retired
// in favour of the full-screen #trashalarm takeover wired in app.js, which is the
// single, unmissable trash-night warning.)

// Northern-hemisphere season for a given calendar date, plus which day of that
// season it is — an ambient touch that grounds the wall in the turn of the year.
// Boundaries use the usual astronomical dates (good enough for a quiet label).
const SEASONS = [
  { name: 'Winter', icon: '❄️', m: 12, d: 21 },
  { name: 'Spring', icon: '🌱', m: 3, d: 20 },
  { name: 'Summer', icon: '☀️', m: 6, d: 21 },
  { name: 'Autumn', icon: '🍂', m: 9, d: 22 },
];
function seasonInfo(y, m, d) {
  const key = m * 100 + d;
  // Find the season whose start is the most recent one on/before today.
  let s, startY = y;
  if (key >= 1221 || key < 320) { s = SEASONS[0]; if (key < 320) startY = y - 1; }
  else if (key < 621) s = SEASONS[1];
  else if (key < 922) s = SEASONS[2];
  else s = SEASONS[3];
  const startUTC = Date.UTC(startY, s.m - 1, s.d);
  const todayUTC = Date.UTC(y, m - 1, d);
  const day = Math.floor((todayUTC - startUTC) / 864e5) + 1;
  return { name: s.name, icon: s.icon, day };
}

export default {
  id: 'clock',
  title: 'Time',
  icon: '🕰',
  size: 'md', // half width — shares the top row with the Arcade + Air squares
  chrome: false,
  async mount(root, ctx) {
    const tz = ctx.config?.tz || 'America/Los_Angeles';
    ctx.style(`
      .clk { display:flex; flex-direction:column; gap:6px; padding:8px 10px 4px; }
      .clk .topline { display:flex; align-items:center; justify-content:space-between; gap:18px; min-height:34px; }
      .clk .greet { color: var(--ink-soft); font-size:17px; letter-spacing:.04em;
        flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* Seasonal marker — a hushed companion to the greeting; never competes with
         the hero time. Changes only at midnight, so it's free to render. */
      .clk .season { display:flex; align-items:center; gap:8px; white-space:nowrap; flex:0 0 auto;
        font-family:var(--font-mono); font-size:12.5px; letter-spacing:.04em; color:var(--ink-faint); }
      .clk .season .ic { font-size:15px; line-height:1; }
      .clk .season b { color:var(--ink-soft); font-weight:600; letter-spacing:.02em; }
      .clk .timerow { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
      .clk .time { font-family: var(--font-display); font-weight:600; letter-spacing:-.01em;
        font-size: 82px; line-height:.92; background:linear-gradient(120deg,#fff,var(--mint));
        -webkit-background-clip:text; background-clip:text; color:transparent; display:flex; align-items:baseline; gap:12px; }
      .clk .time .ap { font-size:30px; -webkit-text-fill-color:var(--ink-soft); font-family:var(--font); font-weight:600; }
      .clk .date { color: var(--ink); font-size:22px; opacity:.92; }
    `);
    const topline = root.appendChild(ctx.h('div', { class: 'topline' }));
    const greet = topline.appendChild(ctx.h('div', { class: 'greet' }));
    const season = topline.appendChild(ctx.h('div', { class: 'season' }));
    const timerow = root.appendChild(ctx.h('div', { class: 'timerow' }));
    const time = timerow.appendChild(ctx.h('div', { class: 'time' }));
    const date = root.appendChild(ctx.h('div', { class: 'date' }));
    root.parentElement?.classList.add('clk-wrap');
    root.classList.add('clk');

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
    // Y/M/D in the display timezone, for a correct seasonal marker regardless of
    // the host clock's own zone.
    const fmtYMD = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

    // We show HH:MM (no seconds), so only TOUCH THE DOM when a value actually
    // changes — i.e. ~once a minute, not 60×. Repainting the 96px gradient-clipped
    // time text every second pegs this Jetson's software renderer. The 10s tick is
    // cheap (string compare, no repaint) and flips the minute within ~10s of :00.
    let lastT = '', lastD = '', lastG = '', lastS = '';
    const tick = () => {
      const now = new Date();
      const parts = fmtTime.formatToParts(now);
      const hhmm = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
      const ap = (parts.find((p) => p.type === 'dayPeriod')?.value || '').toUpperCase();
      const t = `${hhmm}|${ap}`;
      if (t !== lastT) { lastT = t; time.replaceChildren(ctx.h('span', {}, hhmm), ctx.h('span', { class: 'ap' }, ap)); }
      const d = fmtDate.format(now);
      if (d !== lastD) { lastD = d; date.textContent = d; }
      const h = parseInt(hourOf.format(now), 10);
      const g = h < 5 ? 'A quiet night in the garden'
        : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon'
        : h < 21 ? 'Good evening' : 'Good night';
      if (g !== lastG) { lastG = g; greet.textContent = g; }
      // Seasonal marker — recomputed from the tz-local date; only repaints when the
      // day (and therefore the "day N of season") actually changes.
      const [yy, mm, dd] = fmtYMD.format(now).split('-').map((n) => parseInt(n, 10));
      const s = seasonInfo(yy, mm, dd);
      const sKey = `${s.name}|${s.day}`;
      if (sKey !== lastS) {
        lastS = sKey;
        season.replaceChildren(
          ctx.h('span', { class: 'ic' }, s.icon),
          ctx.h('b', {}, s.name),
          ctx.h('span', {}, `· day ${s.day}`));
      }
    };
    ctx.interval(tick, 10000);
  },
};
