// Sun & Moon — sunrise/sunset, daylight length and evening golden hour from
// keyless Open-Meteo (proxy), plus a locally-computed moon phase + illumination.
// The moon needs no network, so it always renders even if the sun fetch fails.

const PHASES = [
  ['New moon', '🌑'], ['Waxing crescent', '🌒'], ['First quarter', '🌓'], ['Waxing gibbous', '🌔'],
  ['Full moon', '🌕'], ['Waning gibbous', '🌖'], ['Last quarter', '🌗'], ['Waning crescent', '🌘'],
];

function moonInfo(date) {
  const SYNODIC = 29.530588853;             // mean synodic month, days
  const knownNew = Date.UTC(2000, 0, 6, 18, 14, 0); // reference new moon
  const days = (date.getTime() - knownNew) / 86400000;
  let age = days % SYNODIC; if (age < 0) age += SYNODIC;
  const frac = age / SYNODIC;               // 0..1 through the cycle
  const illum = Math.round(((1 - Math.cos(2 * Math.PI * frac)) / 2) * 100);
  const idx = Math.floor(frac * 8 + 0.5) % 8;
  const [name, emoji] = PHASES[idx];
  return { name, emoji, illum, age: Math.round(age * 10) / 10 };
}

const minsOf = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(iso || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function fmtMins(t) {
  let h = Math.floor(t / 60) % 24; const min = t % 60;
  const ap = h < 12 ? 'a' : 'p'; h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')}${ap}`;
}

export default {
  id: 'sun-moon',
  title: 'Sun & Moon',
  icon: '🌙',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .sm { display:flex; flex-direction:column; height:100%; justify-content:center; gap:13px; }
      .sm-rs { display:flex; gap:18px; }
      .sm-rs .t { display:flex; align-items:center; gap:10px; }
      .sm-rs .em { font-size:24px; line-height:1; }
      .sm-rs .col { display:flex; flex-direction:column; gap:1px; }
      .sm-rs .v { font-family:var(--font-display); font-size:23px; font-weight:600; color:var(--ink); line-height:1; }
      .sm-rs .k { font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); }
      .sm-meta { display:flex; gap:8px 16px; flex-wrap:wrap; font-size:13px; }
      .sm-meta .it { display:flex; align-items:baseline; gap:6px; }
      .sm-meta .lab { font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint); }
      .sm-meta .val { font-family:var(--font-mono); font-weight:600; color:var(--ink); }
      .sm-meta .gold .val { color:var(--gold); }
      .sm-na { font-size:12.5px; color:var(--ink-faint); }
      .sm-div { height:1px; background:var(--stroke); }
      .sm-moon { display:flex; align-items:center; gap:15px; }
      .sm-moon .em { font-size:46px; line-height:1; filter:drop-shadow(0 3px 11px rgba(0,0,0,.45)); }
      .sm-moon .info { display:flex; flex-direction:column; gap:4px; min-width:0; }
      .sm-moon .ph { font-family:var(--font-display); font-size:21px; font-weight:600; color:var(--ink); line-height:1;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .sm-moon .sub { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); letter-spacing:.03em; }
    `);
    body.appendChild(ctx.loading('charting the sky…'));

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=sunrise,sunset,daylight_duration&timezone=${encodeURIComponent(tz)}&forecast_days=1`;

    const sunBlock = (sun) => {
      if (!sun) {
        return ctx.h('div', { class: 'sm-na' }, '🌥 sun times unavailable');
      }
      const { riseMins, setMins, dayH, dayM, ghStart, ghEnd } = sun;
      return ctx.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '11px' } },
        ctx.h('div', { class: 'sm-rs' },
          ctx.h('div', { class: 't' },
            ctx.h('span', { class: 'em' }, '🌅'),
            ctx.h('div', { class: 'col' },
              ctx.h('div', { class: 'v' }, fmtMins(riseMins)),
              ctx.h('div', { class: 'k' }, 'Sunrise'))),
          ctx.h('div', { class: 't' },
            ctx.h('span', { class: 'em' }, '🌇'),
            ctx.h('div', { class: 'col' },
              ctx.h('div', { class: 'v' }, fmtMins(setMins)),
              ctx.h('div', { class: 'k' }, 'Sunset')))),
        ctx.h('div', { class: 'sm-meta' },
          ctx.h('div', { class: 'it' },
            ctx.h('span', { class: 'lab' }, 'Daylight'),
            ctx.h('span', { class: 'val' }, `${dayH}h ${dayM}m`)),
          ctx.h('div', { class: 'it gold' },
            ctx.h('span', { class: 'lab' }, 'Golden hr'),
            ctx.h('span', { class: 'val' }, `${fmtMins(ghStart)}–${fmtMins(ghEnd)}`))));
    };

    const render = (sun) => {
      const m = moonInfo(new Date());
      body.replaceChildren(ctx.h('div', { class: 'sm' },
        sunBlock(sun),
        ctx.h('div', { class: 'sm-div' }),
        ctx.h('div', { class: 'sm-moon' },
          ctx.h('span', { class: 'em' }, m.emoji),
          ctx.h('div', { class: 'info' },
            ctx.h('div', { class: 'ph', title: m.name }, m.name),
            ctx.h('div', { class: 'sub' }, `${m.illum}% lit · ${m.age}d old`)))));
    };

    const fetchSun = async () => {
      const d = await ctx.fetchJSON(url);
      const dy = d && d.daily;
      const riseMins = minsOf(dy?.sunrise?.[0]);
      const setMins = minsOf(dy?.sunset?.[0]);
      if (riseMins == null || setMins == null) throw new Error('no sun data');
      const dur = dy.daylight_duration?.[0] != null
        ? Math.round(dy.daylight_duration[0])
        : (setMins - riseMins) * 60;
      const dayH = Math.floor(dur / 3600);
      const dayM = Math.round((dur % 3600) / 60);
      return { riseMins, setMins, dayH, dayM, ghStart: setMins - 60, ghEnd: setMins };
    };

    let lastSun = null;
    try {
      // Initial load: a few attempts so one slow response doesn't blank the sun.
      for (let attempt = 1; attempt <= 3 && !lastSun; attempt++) {
        try { lastSun = await fetchSun(); }
        catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 2000)); }
      }
      render(lastSun); // moon always renders; sun shows graceful note if null
      // Refresh: sun ~hourly (times barely move), and re-render keeps the moon current.
      // On a failed fetch, KEEP the last good sun reading.
      ctx.interval(async () => {
        try { lastSun = await fetchSun(); } catch { /* keep last good */ }
        render(lastSun);
      }, 60 * 60 * 1000);
    } catch (e) {
      render(null);
    }
  },
};
