// Clock — the garden's heartbeat. A luminous hero time + date + greeting, with a
// quiet seasonal marker tucked to the right of the greeting line, a hushed row of
// world-city clocks filling the band beneath the date (each carrying a "+1d"/"−1d"
// chip when it's already tomorrow / still yesterday there), and a quiet one-line
// year reading at the foot ("Day 262 · 103 left … 72%"). Everything is pure offline
// Intl formatting — no network, no animation.
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
  // Which astronomical event opened this season — an equinox for spring/autumn,
  // a solstice for summer/winter. Named so the four turning days of the year can
  // announce themselves properly instead of reading as a flat "Early Autumn".
  const turn = (s.name === 'Spring' || s.name === 'Autumn') ? 'equinox' : 'solstice';
  return { name: s.name, icon: s.icon, day, toNext, phase, turn, nextName: next.name, nextIcon: next.icon };
}

export default {
  id: 'clock',
  title: 'Time',
  icon: '🕰',
  size: 'md', // half width — shares the top row with Air
  chrome: false,
  async mount(root, ctx) {
    const tz = ctx.config?.tz || 'America/Los_Angeles';
    ctx.style(`
      /* Cards are overflow:hidden, so the height-locked grid may squeeze them below their
         content; pin the clock to its content so the other rows give way instead. */
      .card[data-wid="clock"] { min-height:max-content; }
      .clk { display:flex; flex-direction:column; gap:3px; padding:6px 10px 4px; }
      .clk .topline { display:flex; align-items:center; justify-content:space-between; gap:18px; min-height:28px; }
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
      /* the four turning days (an equinox / a solstice) warm to gold for the day */
      .clk .season.turning b, .clk .season.turning .to { color:var(--gold); }
      .clk .timerow { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
      .clk .time { font-family: var(--font-display); font-weight:600; letter-spacing:-.01em;
        font-size: 78px; line-height:.92; background:linear-gradient(120deg,#fff,var(--mint));
        -webkit-background-clip:text; background-clip:text; color:transparent; display:flex; align-items:baseline; gap:12px; }
      .clk .time .ap { font-size:30px; -webkit-text-fill-color:var(--ink-soft); font-family:var(--font); font-weight:600; }
      .clk .date { color: var(--ink); font-size:20px; opacity:.92; }
      /* World clocks — a hushed row of a few far-flung city times, anchored toward
         the bottom of the card (margin-top:auto) so it fills the breathing room
         beneath the date. Fully offline & deterministic (pure Intl formatting), so
         it costs nothing to render; it only repaints when a city's minute rolls over.
         A tiny ☀/☾ glyph tells day from night there at a glance — a quiet sense of
         the wider world keeping time alongside home. */
      .clk .world { margin-top:auto; display:flex; gap:13px; padding-top:6px; flex-wrap:nowrap; min-width:0; }
      .clk .world .wc { display:flex; align-items:baseline; gap:6px; min-width:0; }
      .clk .world .wc .lbl { font-family:var(--font-mono); font-size:12.5px; font-weight:700; letter-spacing:.08em;
        color:var(--ink-faint); flex:0 0 auto; }
      .clk .world .wc .wt { font-family:var(--font-mono); font-size:12.5px; color:var(--ink-soft); letter-spacing:.01em;
        white-space:nowrap; }
      .clk .world .wc .g { font-size:12px; line-height:1; opacity:.7; flex:0 0 auto; }
      .clk .world .wc .g.day { color:var(--gold); }
      .clk .world .wc .g.night { color:#9cc0ff; }
      /* day-offset chip — appears beside a city ONLY when its calendar date differs
         from home's, quietly telling that it's already "+1d" (tomorrow) there, or
         still "−1d" (yesterday). A hushed mint-2 note that turns the row from three
         bare times into a real sense of the world running a day ahead/behind; tiny
         and flex:none, so it never grows the row's height, and hidden entirely on
         the common same-day case so it adds nothing when there's nothing to say. */
      .clk .world .wc .dd { font-family:var(--font-mono); font-size:11.5px; font-weight:700; letter-spacing:.02em;
        color:var(--mint-2); flex:0 0 auto; opacity:.9; }
      /* Year-in-numbers — a hushed one-line reading of how far the calendar year has
         run ("Day 262 · 103 left … 72%"), sitting beneath the world-clocks row. The
         humans asked to drop the progress BAR that used to sit behind it (2026-09-19),
         so this is text only now: no rail, no fill, nothing to render or animate. */
      .clk .year { margin-top:0; padding-top:7px; }
      .clk .year .yr-head { display:flex; align-items:baseline; justify-content:space-between;
        font-family:var(--font-mono); font-size:12.5px; letter-spacing:.06em; color:var(--ink-faint); }
      .clk .year .yr-head .doy { color:var(--ink-soft); }
      .clk .year .yr-head .pct { color:var(--mint); font-weight:600; letter-spacing:.02em; }
      /* Clock-change heads-up — appears in the middle of the year line only in the
         ~10 days before a daylight-saving switch in the home zone ("Clocks fall back
         Sun · 8d"), warming to gold on the eve/day itself. Text only, no motion. */
      .clk .year .yr-head .dst { flex:1 1 auto; min-width:0; text-align:center; padding:0 10px;
        color:var(--ink-soft); letter-spacing:.03em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .clk .year .yr-head .dst b { color:var(--mint); font-weight:600; }
      .clk .year .yr-head .dst.soon b { color:var(--gold); }
    `);
    const topline = root.appendChild(ctx.h('div', { class: 'topline' }));
    const greet = topline.appendChild(ctx.h('div', { class: 'greet' }));
    const season = topline.appendChild(ctx.h('div', { class: 'season' }));
    const timerow = root.appendChild(ctx.h('div', { class: 'timerow' }));
    const time = timerow.appendChild(ctx.h('div', { class: 'time' }));
    const date = root.appendChild(ctx.h('div', { class: 'date' }));
    // World clocks — a few far-flung cities keeping time alongside home. Built once;
    // each tick refreshes only the cells whose minute changed (see below). The list
    // deliberately skips the home zone (the hero time above already tells it) and
    // spans a wide longitudinal spread so the row reads as "the world right now".
    const WORLD = [
      { lbl: 'NYC', tz: 'America/New_York' },
      { lbl: 'LDN', tz: 'Europe/London' },
      { lbl: 'TYO', tz: 'Asia/Tokyo' },
    ];
    const world = root.appendChild(ctx.h('div', { class: 'world' }));
    const worldCells = WORLD.map((c) => {
      const wt = ctx.h('span', { class: 'wt' });
      const g = ctx.h('span', { class: 'g' });
      const dd = ctx.h('span', { class: 'dd', style: 'display:none' });
      world.appendChild(ctx.h('div', { class: 'wc', title: c.tz.replace(/_/g, ' ') },
        ctx.h('span', { class: 'lbl' }, c.lbl), wt, g, dd));
      return {
        wt, g, dd, last: '',
        fmt: new Intl.DateTimeFormat('en-US', { timeZone: c.tz, hour: 'numeric', minute: '2-digit', hour12: true }),
        hourFmt: new Intl.DateTimeFormat('en-US', { timeZone: c.tz, hour: 'numeric', hour12: false }),
        // City's calendar date (en-CA → "YYYY-MM-DD"), for comparing against home's
        // date to reveal when a city has crossed midnight ahead of / behind home.
        dateFmt: new Intl.DateTimeFormat('en-CA', { timeZone: c.tz, year: 'numeric', month: '2-digit', day: '2-digit' }),
      };
    });
    // Whole-day number for a "YYYY-MM-DD" string (days since epoch, UTC) — lets us
    // diff two calendar dates as a plain integer without any timezone drift.
    const dayNum = (ymd) => {
      const m = /(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
      return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
    };
    // Year-in-numbers line, pinned to the bottom of the card (see .clk .year CSS).
    const year = root.appendChild(ctx.h('div', { class: 'year' }));
    const yrHead = year.appendChild(ctx.h('div', { class: 'yr-head' }));
    const doyEl = yrHead.appendChild(ctx.h('span', { class: 'doy' }));
    const dstEl = yrHead.appendChild(ctx.h('span', { class: 'dst', style: 'display:none' }));
    const pctEl = yrHead.appendChild(ctx.h('span', { class: 'pct' }));
    root.parentElement?.classList.add('clk-wrap');
    root.classList.add('clk');

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
    const fmtWeekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' });
    // Y/M/D in the display timezone, for a correct seasonal marker regardless of
    // the host clock's own zone.
    const fmtYMD = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

    // Daylight-saving heads-up. The home zone's UTC offset (minutes) at instant t,
    // read from Intl parts — no shortOffset dependency, works on older WebKit.
    const offFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const offsetAt = (t) => {
      const p = {}; for (const x of offFmt.formatToParts(new Date(t))) p[x.type] = +x.value;
      const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
      return Math.round((asUTC - Math.floor(t / 60000) * 60000) / 60000);
    };
    // Next offset change within `days` (or one that happened in the last 20 h, so
    // the day itself can say "Clocks fell back today"). Day-steps, then a binary
    // search to the minute. Cached per local day — ~25 formats, once a day.
    const findShift = (now, days = 10) => {
      const H = 3600000, start = now - 20 * H;
      let a = start, oa = offsetAt(a);
      for (let t = start + 6 * H; t <= now + days * 24 * H; t += 6 * H) {
        const ot = offsetAt(t);
        if (ot !== oa) {
          let lo = a, hi = t;
          while (hi - lo > 60000) { const m = (lo + hi) / 2; if (offsetAt(m) === oa) lo = m; else hi = m; }
          return { at: hi, back: ot < oa, mins: Math.abs(ot - oa) };
        }
        a = t; oa = ot;
      }
      return null;
    };
    const fmtShiftDay = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const fmtShiftFull = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
    let shift = null, shiftDay = '', lastDst = '';
    const dstLabel = (now, homeDay) => {
      if (!shift) return null;
      const verb = shift.back ? 'fall back' : 'spring forward';
      const d = dayNum(fmtYMD.format(new Date(shift.at))) - homeDay;
      const h = parseInt(hourOf.format(now), 10);
      if (shift.at <= now) return d === 0 ? { pre: 'Clocks ', b: shift.back ? 'fell back' : 'sprang forward', post: ' today', soon: true } : null;
      if (d <= 0 || (d === 1 && h >= 17)) return { pre: 'Clocks ', b: verb, post: ' tonight', soon: true };
      if (d === 1) return { pre: 'Clocks ', b: verb, post: ' tomorrow', soon: true };
      return { pre: 'Clocks ', b: verb, post: ` ${fmtShiftDay.format(new Date(shift.at))} · ${d}d`, soon: false };
    };

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
      let toplineDirty = false;
      if (g !== lastG) { lastG = g; greet.textContent = g; toplineDirty = true; }
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
        // Four days a year the season doesn't just "continue" — it TURNS. On day
        // one, the marker drops the Early/Late phrasing and simply announces it
        // ("Autumn begins today · the equinox"), warmed to gold so the eye catches
        // the once-a-quarter moment. Every other day reads as before.
        const turning = s.day === 1;
        const toLabel = turning
          ? `the ${s.turn}`
          : `${s.toNext}d to ${s.nextName.toLowerCase()}`; // no emojis (2026-10-07)
        const toShort = turning ? s.turn : `${s.toNext}d`; // compact fallback when the row is tight
        season.classList.toggle('turning', turning);
        season.title = turning
          ? `${s.name} begins today — the ${s.turn}`
          : `${s.phase} ${s.name} · day ${s.day} · ${toLabel}`;
        season.replaceChildren(
          ctx.h('b', {}, turning ? `${s.name} begins today` : `${s.phase} ${s.name}`),
          ctx.h('span', { class: 'to', 'data-full': `· ${toLabel}`, 'data-short': `· ${toShort}` }, `· ${toLabel}`));
        toplineDirty = true;
      }
      // Keep the greeting whole. The greeting and the seasonal marker share one
      // line on a half-width card; when they'd collide, the greeting used to get
      // ellipsised ("Good morni…"). Instead, let the season COUNTDOWN yield first —
      // "Late Summer" always stays. We step it down gracefully: full clause
      // ("· 32d to autumn 🍂") → compact ("· 32d 🍂") → hidden, taking only as much
      // room as the greeting actually needs. Measured only when a line changed
      // (cheap; the 900px canvas is fixed).
      if (toplineDirty) {
        const to = season.querySelector('.to');
        if (to) {
          const overflow = () => greet.scrollWidth > greet.clientWidth + 1;
          to.style.display = '';
          to.textContent = to.dataset.full;
          if (overflow()) {
            to.textContent = to.dataset.short;
            if (overflow()) to.style.display = 'none';
          }
        }
      }
      // World clocks — each city repaints only when its own minute (or its day
      // relative to home) rolls over (string compare, no layout thrash). A compact
      // "9:07 AM"→"9:07a" reading with a tiny day/night glyph (day = 06:00–18:59
      // local there) and, when the city sits on a DIFFERENT calendar day than home,
      // a hushed "+1d"/"−1d" chip. Pure Intl, no network.
      const homeDayNum = dayNum(fmtYMD.format(now));
      for (const c of worldCells) {
        const parts = c.fmt.formatToParts(now);
        const hhmm = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
        const ap = (parts.find((p) => p.type === 'dayPeriod')?.value || '').toLowerCase()[0] || '';
        const label = `${hhmm}${ap}`;
        const hr = parseInt(c.hourFmt.format(now), 10);
        const night = !(hr >= 6 && hr < 19);
        // How far this city's calendar date is from home's (usually 0; +1 when it's
        // already tomorrow there, −1 when still yesterday). Longitudinal spread means
        // at most one or two cities ever differ at once, so the row stays uncrowded.
        const cityDayNum = dayNum(c.dateFmt.format(now));
        const diff = (cityDayNum != null && homeDayNum != null) ? cityDayNum - homeDayNum : 0;
        const key = `${label}|${night}|${diff}`;
        if (key !== c.last) {
          c.last = key;
          c.wt.textContent = label;
          c.g.textContent = night ? '☾' : '☀';
          c.g.className = `g ${night ? 'night' : 'day'}`;
          if (diff === 0) {
            c.dd.textContent = '';
            c.dd.style.display = 'none';
          } else {
            c.dd.textContent = diff > 0 ? `+${diff}d` : `${diff}d`;
            c.dd.style.display = '';
            c.dd.title = diff > 0
              ? `already ${diff === 1 ? 'tomorrow' : `${diff} days ahead`} there`
              : `still ${diff === -1 ? 'yesterday' : `${-diff} days behind`} there`;
          }
        }
      }
      // Year progress — day-of-year and the fraction of the calendar year elapsed,
      // from the SAME tz-local date, so it rolls over at local midnight. A quiet
      // one-line ambient reading distinct from the seasonal marker; only repaints on
      // a day-change (text only — the progress bar was retired 2026-09-19).
      const isLeap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
      const totalDays = isLeap ? 366 : 365;
      const doy = Math.floor((Date.UTC(yy, mm - 1, dd) - Date.UTC(yy, 0, 1)) / 864e5) + 1;
      const yKey = `${yy}-${doy}`;
      if (yKey !== lastY) {
        lastY = yKey;
        const frac = doy / totalDays;
        const pct = Math.round(frac * 100);
        // The year is already spelled out on the date line above, so "of 2026" here
        // was redundant. Trade it for a warmer, glanceable "days left in the year" —
        // a gentle sense of the calendar winding down. On Dec 31 it reads "last day".
        const daysLeft = totalDays - doy;
        doyEl.textContent = daysLeft > 0 ? `Day ${doy} · ${daysLeft} left` : `Day ${doy} · last day`;
        pctEl.textContent = `${pct}%`;
        year.title = `Day ${doy} of ${totalDays} · ${daysLeft} left · ${pct}% through ${yy}`;
      }
      // Clock-change heads-up (recompute the transition once per local day).
      if (yKey !== shiftDay) { shiftDay = yKey; try { shift = findShift(now.getTime()); } catch { shift = null; } }
      const lab = dstLabel(now, homeDayNum);
      const dKey = lab ? `${lab.b}|${lab.post}` : '';
      if (dKey !== lastDst) {
        lastDst = dKey;
        if (!lab) { dstEl.style.display = 'none'; dstEl.replaceChildren(); }
        else {
          dstEl.style.display = '';
          dstEl.classList.toggle('soon', lab.soon);
          dstEl.replaceChildren(lab.pre, ctx.h('b', {}, lab.b), lab.post);
          const when = fmtShiftFull.format(new Date(shift.at));
          dstEl.title = `Daylight saving ${shift.back ? 'ends' : 'begins'} ${when} — clocks go ${shift.back ? 'back' : 'forward'} ${shift.mins === 60 ? 'an hour' : `${shift.mins} min`}`;
        }
      }
    };
    ctx.interval(tick, 10000);
  },
};
