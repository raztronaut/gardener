// Sun & Moon — sunrise/sunset plus the evening's GOLDEN HOUR and BLUE HOUR
// windows (the magic light photographers chase), from keyless sunrise-sunset.org
// (through the proxy), and a locally-computed moon phase, illumination and a
// countdown to the next full moon. The moon needs no network, so it always
// renders even if the sun fetch fails.

const PHASES = [
  ['New moon', '🌑'], ['Waxing crescent', '🌒'], ['First quarter', '🌓'], ['Waxing gibbous', '🌔'],
  ['Full moon', '🌕'], ['Waning gibbous', '🌖'], ['Last quarter', '🌗'], ['Waning crescent', '🌘'],
];

const SYNODIC = 29.530588853;                       // mean synodic month, days
const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14, 0);  // reference new moon (UTC)

function moonInfo(date) {
  const days = (date.getTime() - KNOWN_NEW) / 86400000;
  let age = days % SYNODIC; if (age < 0) age += SYNODIC;
  const frac = age / SYNODIC;                        // 0..1 through the cycle
  const illum = Math.round(((1 - Math.cos(2 * Math.PI * frac)) / 2) * 100);
  const idx = Math.floor(frac * 8 + 0.5) % 8;
  const [name, emoji] = PHASES[idx];
  // days until the next full moon (frac = 0.5)
  let toFull = (0.5 - frac); if (toFull < 0) toFull += 1;
  const fullDate = new Date(date.getTime() + toFull * SYNODIC * 86400000);
  return { name, emoji, illum, age: Math.round(age * 10) / 10, daysToFull: toFull * SYNODIC, fullDate };
}

export default {
  id: 'sun-moon',
  title: 'Sun & Moon',
  icon: '🌙',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};

    // Compact local time like "7:42p" (matches the garden's clock voice).
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtTime = (d) => {
      const p = Object.fromEntries(timeFmt.formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.hour}:${p.minute}${(p.dayPeriod || '').slice(0, 1).toLowerCase()}`;
    };
    const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' });

    ctx.style(`
      .sm { display:flex; flex-direction:column; height:100%; justify-content:center; gap:12px; }
      .sm-rs { display:flex; gap:18px; }
      .sm-rs .t { display:flex; align-items:center; gap:10px; }
      .sm-rs .em { font-size:24px; line-height:1; }
      .sm-rs .col { display:flex; flex-direction:column; gap:1px; }
      .sm-rs .v { font-family:var(--font-display); font-size:23px; font-weight:600; color:var(--ink); line-height:1; }
      .sm-rs .k { font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); }

      .sm-magic { display:flex; flex-direction:column; gap:6px; }
      .sm-mag { display:flex; align-items:center; gap:9px; padding:5px 9px; border-radius:10px;
        background:rgba(255,255,255,.035); border:1px solid var(--stroke); }
      .sm-mag.now { background:rgba(247,201,116,.12); border-color:rgba(247,201,116,.4); }
      .sm-mag.blue.now { background:rgba(116,166,247,.13); border-color:rgba(116,166,247,.42); }
      .sm-mag .dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
      .sm-mag.gold .dot { background:var(--gold,#f7c974); box-shadow:0 0 9px rgba(247,201,116,.7); }
      .sm-mag.blue .dot { background:#74a6f7; box-shadow:0 0 9px rgba(116,166,247,.7); }
      .sm-mag .lab { font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); flex:1; min-width:0; }
      .sm-mag .rng { font-family:var(--font-mono); font-size:13px; font-weight:600; color:var(--ink); white-space:nowrap; }
      .sm-mag .live { font-family:var(--font-mono); font-size:9px; letter-spacing:.14em; color:var(--gold,#f7c974); }
      .sm-mag.blue .live { color:#9cc0ff; }
      .sm-daylight { font-size:11px; color:var(--ink-faint); }
      .sm-daylight b { font-family:var(--font-mono); color:var(--ink-soft); font-weight:600; }
      .sm-na { font-size:12.5px; color:var(--ink-faint); }

      .sm-div { height:1px; background:var(--stroke); }
      .sm-moon { display:flex; align-items:center; gap:15px; }
      .sm-moon .em { font-size:44px; line-height:1; filter:drop-shadow(0 3px 11px rgba(0,0,0,.45)); }
      .sm-moon .info { display:flex; flex-direction:column; gap:3px; min-width:0; }
      .sm-moon .ph { font-family:var(--font-display); font-size:20px; font-weight:600; color:var(--ink); line-height:1;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .sm-moon .sub { font-family:var(--font-mono); font-size:11.5px; color:var(--ink-faint); letter-spacing:.02em; }
    `);
    body.appendChild(ctx.loading('charting the sky…'));

    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0&date=today`;

    const sunBlock = (sun) => {
      if (!sun) return ctx.h('div', { class: 'sm-na' }, '🌥 sun times unavailable');
      const { rise, set, goldStart, blueEnd, dayLabel, now } = sun;
      const within = (a, b) => now >= a.getTime() && now <= b.getTime();
      const goldNow = within(goldStart, set);
      const blueNow = within(set, blueEnd);
      const magRow = (cls, label, a, b, live) =>
        ctx.h('div', { class: `sm-mag ${cls}${live ? ' now' : ''}` },
          ctx.h('span', { class: 'dot' }),
          ctx.h('span', { class: 'lab' }, label),
          live ? ctx.h('span', { class: 'live' }, 'NOW') : null,
          ctx.h('span', { class: 'rng' }, `${fmtTime(a)}–${fmtTime(b)}`));
      return ctx.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '11px' } },
        ctx.h('div', { class: 'sm-rs' },
          ctx.h('div', { class: 't' },
            ctx.h('span', { class: 'em' }, '🌅'),
            ctx.h('div', { class: 'col' },
              ctx.h('div', { class: 'v' }, fmtTime(rise)),
              ctx.h('div', { class: 'k' }, 'Sunrise'))),
          ctx.h('div', { class: 't' },
            ctx.h('span', { class: 'em' }, '🌇'),
            ctx.h('div', { class: 'col' },
              ctx.h('div', { class: 'v' }, fmtTime(set)),
              ctx.h('div', { class: 'k' }, 'Sunset')))),
        ctx.h('div', { class: 'sm-magic' },
          magRow('gold', 'Golden hour', goldStart, set, goldNow),
          magRow('blue', 'Blue hour', set, blueEnd, blueNow)),
        ctx.h('div', { class: 'sm-daylight' }, 'Daylight ', ctx.h('b', {}, dayLabel)));
    };

    const render = (sun) => {
      const m = moonInfo(new Date());
      const fullTxt = m.daysToFull < 0.75
        ? 'full tonight'
        : `full ${dateFmt.format(m.fullDate)}`;
      body.replaceChildren(ctx.h('div', { class: 'sm' },
        sunBlock(sun),
        ctx.h('div', { class: 'sm-div' }),
        ctx.h('div', { class: 'sm-moon' },
          ctx.h('span', { class: 'em' }, m.emoji),
          ctx.h('div', { class: 'info' },
            ctx.h('div', { class: 'ph', title: m.name }, m.name),
            ctx.h('div', { class: 'sub' }, `${m.illum}% lit · ${fullTxt}`)))));
    };

    const fetchSun = async () => {
      const d = await ctx.fetchJSON(url);
      const r = d && d.results;
      if (!r || d.status !== 'OK') throw new Error('no sun data');
      const rise = new Date(r.sunrise);
      const set = new Date(r.sunset);
      const civilEnd = new Date(r.civil_twilight_end);   // sun reaches -6° (end of blue hour)
      if (isNaN(rise) || isNaN(set) || isNaN(civilEnd)) throw new Error('bad sun data');
      // Blue hour: sunset → civil dusk. Golden hour: the equal span BEFORE sunset
      // (the sun's elevation changes at a near-symmetric rate around the horizon),
      // so golden hour ≈ as long as it takes to fall from the horizon to -6°.
      const blueEnd = civilEnd;
      const goldStart = new Date(set.getTime() - (civilEnd.getTime() - set.getTime()));
      // Day length from the API (seconds), formatted "14h 32m".
      const secs = Math.round(d.results.day_length || (set - rise) / 1000);
      const dayLabel = `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
      return { rise, set, goldStart, blueEnd, dayLabel, now: Date.now() };
    };

    let lastSun = null;
    try {
      // Initial load: a few attempts so one slow response doesn't blank the sun.
      for (let attempt = 1; attempt <= 3 && !lastSun; attempt++) {
        try { lastSun = await fetchSun(); }
        catch { if (attempt < 3) await new Promise((res) => setTimeout(res, 2000)); }
      }
      render(lastSun); // moon always renders; sun shows a graceful note if null
      // Refresh: sun times barely move hour-to-hour; re-render keeps the moon and
      // the golden/blue-hour "NOW" highlight current. Keep last good on failure.
      ctx.interval(async () => {
        try {
          const next = await fetchSun();
          lastSun = next;
        } catch { if (lastSun) lastSun = { ...lastSun, now: Date.now() }; }
        render(lastSun);
      }, 5 * 60 * 1000);
    } catch (e) {
      render(null);
    }
  },
};
