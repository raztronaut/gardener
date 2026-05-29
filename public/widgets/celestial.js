// Sun & Moon — sunrise/sunset + daylight via keyless Open-Meteo (proxy);
// moon phase computed locally (no API).

// --- Local moon phase (synodic age in days, 0..29.53) -----------------------
// Reference new moon: 2000-01-06 18:14 UTC. Synodic month ~29.530588853 days.
const SYNODIC = 29.530588853;
function moonInfo(date = new Date()) {
  const ref = Date.UTC(2000, 0, 6, 18, 14, 0); // known new moon
  const days = (date.getTime() - ref) / 86400000;
  let age = days % SYNODIC;
  if (age < 0) age += SYNODIC;
  const frac = age / SYNODIC; // 0..1 through the cycle
  // 8 named phases; new/full/quarters are narrow windows around their exact point.
  const PHASES = [
    ['New Moon', '🌑'], ['Waxing Crescent', '🌒'], ['First Quarter', '🌓'],
    ['Waxing Gibbous', '🌔'], ['Full Moon', '🌕'], ['Waning Gibbous', '🌖'],
    ['Last Quarter', '🌗'], ['Waning Crescent', '🌘'],
  ];
  // Index by eighths, with small snap windows for the four principal phases.
  let idx = Math.floor(frac * 8 + 0.5) % 8;
  const [name, emoji] = PHASES[idx];
  // Illumination fraction (0=new, 1=full) via cosine of phase angle.
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;
  return { name, emoji, illum: Math.round(illum * 100), age: Math.round(age * 10) / 10 };
}

function fmtTime(iso) {
  // iso like "2026-05-28T05:51" (already local to requested tz). Parse fields directly.
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return '—';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export default {
  id: 'celestial',
  title: 'Sun & Moon',
  icon: '🌙',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .cel { display:flex; flex-direction:column; gap:20px; }
      .cel-sun { display:flex; gap:14px; }
      .cel-sun .card { flex:1; background:rgba(255,255,255,.04); border:1px solid var(--stroke);
        border-radius:16px; padding:16px 14px; display:flex; flex-direction:column; gap:6px; align-items:center; }
      .cel-sun .card .ico { font-size:34px; line-height:1; filter:drop-shadow(0 4px 10px rgba(0,0,0,.4)); }
      .cel-sun .card .lbl { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-faint); }
      .cel-sun .card .val { font-family:var(--font-display); font-size:30px; font-weight:600; line-height:1; color:var(--ink); }
      .cel-day { display:flex; align-items:center; justify-content:center; gap:10px;
        font-size:16px; color:var(--ink-soft); }
      .cel-day .n { font-family:var(--font-mono); font-size:20px; color:var(--gold); font-weight:600; }
      .cel-moon { display:flex; align-items:center; gap:18px; padding-top:16px; border-top:1px solid var(--stroke); }
      .cel-moon .emoji { font-size:60px; line-height:1; filter:drop-shadow(0 4px 12px rgba(0,0,0,.45)); }
      .cel-moon .meta { display:flex; flex-direction:column; gap:5px; }
      .cel-moon .name { font-family:var(--font-display); font-size:24px; font-weight:600; line-height:1; color:var(--mint); }
      .cel-moon .sub { font-size:14px; color:var(--ink-faint); }
    `);
    body.appendChild(ctx.loading('charting sun & moon…'));

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&daily=sunrise,sunset,daylight_duration`
        + `&timezone=${encodeURIComponent(tz)}&forecast_days=1`;

      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const day = d && d.daily;
        const sunrise = day && day.sunrise && day.sunrise[0];
        const sunset = day && day.sunset && day.sunset[0];
        const dur = day && day.daylight_duration && day.daylight_duration[0];
        if (!sunrise || !sunset) {
          body.replaceChildren(ctx.error('no sun data'));
          return;
        }
        const moon = moonInfo(new Date());

        body.replaceChildren(ctx.h('div', { class: 'cel' },
          ctx.h('div', { class: 'cel-sun' },
            ctx.h('div', { class: 'card' },
              ctx.h('div', { class: 'ico' }, '🌅'),
              ctx.h('div', { class: 'lbl' }, 'Sunrise'),
              ctx.h('div', { class: 'val' }, fmtTime(sunrise))),
            ctx.h('div', { class: 'card' },
              ctx.h('div', { class: 'ico' }, '🌇'),
              ctx.h('div', { class: 'lbl' }, 'Sunset'),
              ctx.h('div', { class: 'val' }, fmtTime(sunset)))),
          ctx.h('div', { class: 'cel-day' },
            ctx.h('span', {}, '☀️ Daylight'),
            ctx.h('span', { class: 'n' }, fmtDuration(dur))),
          ctx.h('div', { class: 'cel-moon' },
            ctx.h('div', { class: 'emoji' }, moon.emoji),
            ctx.h('div', { class: 'meta' },
              ctx.h('div', { class: 'name' }, moon.name),
              ctx.h('div', { class: 'sub' }, `${moon.illum}% illuminated`),
              ctx.h('div', { class: 'sub' }, `${moon.age} days into cycle`)))));
      };

      await refresh();
      // Sun times change daily; moon phase drifts slowly. Refresh hourly.
      ctx.interval(() => refresh().catch(() => {}), 60 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('sun & moon unavailable'));
    }
  },
};
