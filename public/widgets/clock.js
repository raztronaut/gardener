// Clock — the garden's heartbeat. A luminous hero time + date + greeting, with a
// quiet seasonal marker tucked to the right of the greeting line.
// (The Tuesday trash reminder used to live here as a small pill; it was retired
// in favour of the full-screen #trashalarm takeover wired in app.js, which is the
// single, unmissable trash-night warning.)

// Northern-hemisphere season for a given calendar date, plus which day of that
// season it is AND a gentle countdown to the next turn of the year — an ambient
// touch that grounds the wall in the seasons.
// Boundaries use the usual astronomical dates (good enough for a quiet label).
const SEASONS = [
  { name: 'Winter', icon: '❄️', m: 12, d: 21 },
  { name: 'Spring', icon: '🌱', m: 3, d: 20 },
  { name: 'Summer', icon: '☀️', m: 6, d: 21 },
  { name: 'Autumn', icon: '🍂', m: 9, d: 22 },
];
// A warm, day-of-week-aware greeting. The base is the time of day, but weekends
// and Fridays get their own gentle phrasing so the wall feels a little more like
// home ("Happy Saturday" on a slow morning, not a flat "Good afternoon"). Fully
// offline and deterministic — it only changes as the hour band or the weekday
// turns over, so it's free to render on this low-power kiosk.
function greetingFor(h, weekday) {
  const weekend = weekday === 'Saturday' || weekday === 'Sunday';
  const friday = weekday === 'Friday';
  if (h < 5) return 'A quiet night in the garden';        // the small hours, unchanged
  if (h < 12) return weekend ? `A slow ${weekday} morning` : 'Good morning';
  if (h < 17) return weekend ? `Happy ${weekday}` : friday ? 'Happy Friday' : 'Good afternoon';
  if (h < 21) return weekend ? `A gentle ${weekday} evening` : friday ? 'Happy Friday' : 'Good evening';
  return weekend ? `A cosy ${weekday} night` : 'Good night';
}

function seasonInfo(y, m, d) {
  const key = m * 100 + d;
  // Find the season whose start is the most recent one on/before today, and the
  // index of the one that follows it (wrapping around the year).
  let i, startY = y;
  if (key >= 1221 || key < 320) { i = 0; if (key < 320) startY = y - 1; }
  else if (key < 621) i = 1;
  else if (key < 922) i = 2;
  else i = 3;
  const s = SEASONS[i];
  const next = SEASONS[(i + 1) % SEASONS.length];
  // The next season starts in this year, except winter→spring wraps to next year.
  const nextY = next.m > s.m ? startY : startY + 1;
  const startUTC = Date.UTC(startY, s.m - 1, s.d);
  const nextUTC = Date.UTC(nextY, next.m - 1, next.d);
  const todayUTC = Date.UTC(y, m - 1, d);
  const day = Math.floor((todayUTC - startUTC) / 864e5) + 1;
  const toNext = Math.round((nextUTC - todayUTC) / 864e5);
  // Where we sit within the season, as a fraction (0 at the turn, →1 near the
  // next). We read this as an evocative "Early"/"Late" phase — a warmer, more
  // human note than a bare "day N" on an ambient wall ("Late Summer" as autumn
  // nears). Split at the halfway point so every day wears a natural adjective.
  const frac = (todayUTC - startUTC) / (nextUTC - startUTC);
  const phase = frac < 0.5 ? 'Early' : 'Late';
  return { name: s.name, icon: s.icon, day, toNext, phase, nextName: next.name, nextIcon: next.icon };
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
      /* countdown to the next turn of the year — a quiet mint clause */
      .clk .season .to { color:var(--mint); }
      .clk .timerow { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
      .clk .time { font-family: var(--font-display); font-weight:600; letter-spacing:-.01em;
        font-size: 82px; line-height:.92; background:linear-gradient(120deg,#fff,var(--mint));
        -webkit-background-clip:text; background-clip:text; color:transparent; display:flex; align-items:baseline; gap:12px; }
      .clk .time .ap { font-size:30px; -webkit-text-fill-color:var(--ink-soft); font-family:var(--font); font-weight:600; }
      .clk .date { color: var(--ink); font-size:22px; opacity:.92; }
      /* Year-progress rail — a hushed ambient reading of how far the calendar year
         has run, pinned to the BOTTOM of the card (margin-top:auto) so it fills the
         breathing room beneath the date rather than leaving an empty band. Distinct
         from the seasonal countdown above: that reads the turn of the SEASON, this
         reads the whole year at a glance ("Day 228 · 62%"). Recomputed only when the
         day rolls over, and the fill is a STATIC gradient — free to render, no
         animation. */
      .clk .year { margin-top:auto; display:flex; flex-direction:column; gap:6px; padding-top:12px; }
      .clk .year .yr-head { display:flex; align-items:baseline; justify-content:space-between;
        font-family:var(--font-mono); font-size:12px; letter-spacing:.06em; color:var(--ink-faint); }
      .clk .year .yr-head .doy { color:var(--ink-soft); }
      .clk .year .yr-head .pct { color:var(--mint); font-weight:600; letter-spacing:.02em; }
      .clk .year .yr-rail { position:relative; height:5px; border-radius:3px;
        background:rgba(255,255,255,.07); overflow:hidden; }
      .clk .year .yr-rail .yr-fill { position:absolute; left:0; top:0; bottom:0; border-radius:3px;
        background:linear-gradient(90deg, var(--mint-2), var(--mint)); }
    `);
    const topline = root.appendChild(ctx.h('div', { class: 'topline' }));
    const greet = topline.appendChild(ctx.h('div', { class: 'greet' }));
    const season = topline.appendChild(ctx.h('div', { class: 'season' }));
    const timerow = root.appendChild(ctx.h('div', { class: 'timerow' }));
    const time = timerow.appendChild(ctx.h('div', { class: 'time' }));
    const date = root.appendChild(ctx.h('div', { class: 'date' }));
    // Year-progress rail, pinned to the bottom of the card (see .clk .year CSS).
    const year = root.appendChild(ctx.h('div', { class: 'year' }));
    const yrHead = year.appendChild(ctx.h('div', { class: 'yr-head' }));
    const doyEl = yrHead.appendChild(ctx.h('span', { class: 'doy' }));
    const pctEl = yrHead.appendChild(ctx.h('span', { class: 'pct' }));
    const yrRail = year.appendChild(ctx.h('div', { class: 'yr-rail' }));
    const yrFill = yrRail.appendChild(ctx.h('div', { class: 'yr-fill' }));
    root.parentElement?.classList.add('clk-wrap');
    root.classList.add('clk');

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
    const fmtWeekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' });
    // Y/M/D in the display timezone, for a correct seasonal marker regardless of
    // the host clock's own zone.
    const fmtYMD = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

    // We show HH:MM (no seconds), so only TOUCH THE DOM when a value actually
    // changes — i.e. ~once a minute, not 60×. Repainting the 96px gradient-clipped
    // time text every second pegs this Jetson's software renderer. The 10s tick is
    // cheap (string compare, no repaint) and flips the minute within ~10s of :00.
    let lastT = '', lastD = '', lastG = '', lastS = '', lastY = '';
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
      // Day-of-week-aware greeting (weekends & Fridays get their own warmth),
      // read in the display tz so it turns over correctly at local midnight.
      const g = greetingFor(h, fmtWeekday.format(now));
      if (g !== lastG) { lastG = g; greet.textContent = g; }
      // Seasonal marker — recomputed from the tz-local date; only repaints when the
      // day (and therefore the "day N of season") actually changes.
      const [yy, mm, dd] = fmtYMD.format(now).split('-').map((n) => parseInt(n, 10));
      const s = seasonInfo(yy, mm, dd);
      const sKey = `${s.phase}|${s.name}|${s.toNext}`;
      if (sKey !== lastS) {
        lastS = sKey;
        // An evocative "Early/Late <Season>" phase (e.g. "Late Summer") reads more
        // like home than a numeric "day N", and a mint countdown to the next turn
        // of the year keeps the change gently anticipated — the nearer it is, the
        // more the small number speaks for itself.
        const toLabel = `${s.toNext}d to ${s.nextName.toLowerCase()} ${s.nextIcon}`;
        season.title = `${s.phase} ${s.name} · day ${s.day} · ${toLabel}`;
        season.replaceChildren(
          ctx.h('span', { class: 'ic' }, s.icon),
          ctx.h('b', {}, `${s.phase} ${s.name}`),
          ctx.h('span', { class: 'to' }, `· ${toLabel}`));
      }
      // Year progress — day-of-year and the fraction of the calendar year elapsed,
      // from the SAME tz-local date, so it rolls over at local midnight. A quiet
      // ambient reading distinct from the seasonal marker; only repaints on a
      // day-change (a static gradient fill, no animation).
      const isLeap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
      const totalDays = isLeap ? 366 : 365;
      const doy = Math.floor((Date.UTC(yy, mm - 1, dd) - Date.UTC(yy, 0, 1)) / 864e5) + 1;
      const yKey = `${yy}-${doy}`;
      if (yKey !== lastY) {
        lastY = yKey;
        const frac = doy / totalDays;
        const pct = Math.round(frac * 100);
        doyEl.textContent = `Day ${doy} of ${yy}`;
        pctEl.textContent = `${pct}%`;
        yrFill.style.width = `${(frac * 100).toFixed(1)}%`;
        year.title = `Day ${doy} of ${totalDays} · ${pct}% through ${yy}`;
      }
    };
    ctx.interval(tick, 10000);
  },
};
