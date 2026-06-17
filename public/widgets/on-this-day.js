// On This Day — a warm daily window into history: the people born on today's
// date, from Wikipedia's keyless on-this-day "births" feed (through the proxy).
// Two notable figures, the year set large in mint beside their name and a one-line
// role. Births read gently on an always-on display (no raw tragedy), and we bias
// toward people with a Wikipedia portrait + description so the picks stay dignified
// and recognizable. Keeps the last good render if a later fetch fails.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const trim = (s, n) => {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
};

export default {
  id: 'on-this-day',
  title: 'On This Day',
  icon: '🎂',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .otd { display:flex; flex-direction:column; height:100%; justify-content:center; gap:11px; }
      .otd-sub { font-family:var(--font-mono); font-size:10px; letter-spacing:.16em;
        text-transform:uppercase; color:var(--ink-faint); }
      .otd-ev { display:flex; align-items:baseline; gap:13px; min-width:0; }
      .otd-yr { flex:0 0 auto; min-width:56px; font-family:var(--font-display); font-weight:700;
        font-size:25px; line-height:1; text-align:right;
        background:linear-gradient(120deg,var(--mint),var(--mint-2));
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
      .otd-main { flex:1; min-width:0; }
      .otd-name { font-size:16px; font-weight:600; color:var(--ink); line-height:1.15;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .otd-role { font-size:12.5px; color:var(--ink-soft); line-height:1.2; margin-top:2px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .otd-na { font-size:13px; color:var(--ink-faint); }
    `);
    body.appendChild(ctx.loading('leafing through history…'));

    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',
      { timeZone: tz, month: '2-digit', day: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
    const MM = parts.month, DD = parts.day;
    const subtitle = `Born · ${MONTHS[parseInt(MM, 10) - 1]} ${parseInt(DD, 10)}`;
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/births/${MM}/${DD}`;

    // Keep the wall calm: skip figures defined by grim/unsavoury roles.
    const NEG = /murder|serial killer|criminal|dictator|war crim|nazi|terror|rapist|gangster|mobster|executioner|slave trader/i;

    // Two figures spread across the eras: the earliest dignified pick and a more
    // recent, broadly-recognisable one — so each day pairs an old name with a
    // newer one and the big mint years span centuries.
    const choose = (births) => {
      const page = (e) => (e.pages && e.pages[0]) || {};
      const clean = (e) => !NEG.test(page(e).description || e.text || '');
      let cand = births.filter((e) => {
        const p = page(e);
        return e.year && e.year >= 1500 && e.year <= 1950 && p.thumbnail && p.description && clean(e);
      });
      if (cand.length < 2) cand = births.filter((e) => { const p = page(e); return e.year && p.thumbnail && p.description && clean(e); });
      if (cand.length < 2) cand = births.filter((e) => e.year && page(e).description && clean(e));
      if (cand.length < 2) cand = births.filter((e) => e.year);
      cand.sort((a, b) => a.year - b.year);
      if (cand.length <= 1) return cand;
      const a = cand[0];
      const b = cand[Math.min(cand.length - 1, Math.floor(cand.length * 0.8))];
      return [a, b === a ? cand[cand.length - 1] : b];
    };

    const nameOf = (e) => {
      const p = (e.pages && e.pages[0]) || {};
      if (p.normalizedtitle) return p.normalizedtitle;
      // Fall back to the leading name in the feed text ("Igor Stravinsky, Russian…").
      return (e.text || '').split(',')[0].trim() || 'Unknown';
    };
    const roleOf = (e) => {
      const p = (e.pages && e.pages[0]) || {};
      if (p.description) return cap(p.description);
      const rest = (e.text || '').split(',').slice(1).join(',').trim();
      return cap(rest);
    };

    const render = (births) => {
      const picks = choose(births || []);
      if (!picks.length) {
        body.replaceChildren(ctx.h('div', { class: 'otd' },
          ctx.h('div', { class: 'otd-sub' }, subtitle),
          ctx.h('div', { class: 'otd-na' }, 'no notable birthdays found')));
        return;
      }
      body.replaceChildren(ctx.h('div', { class: 'otd' },
        ctx.h('div', { class: 'otd-sub' }, subtitle),
        ...picks.map((e) => ctx.h('div', { class: 'otd-ev' },
          ctx.h('div', { class: 'otd-yr' }, String(e.year)),
          ctx.h('div', { class: 'otd-main' },
            ctx.h('div', { class: 'otd-name', title: nameOf(e) }, trim(nameOf(e), 42)),
            ctx.h('div', { class: 'otd-role' }, trim(roleOf(e), 48)))))));
      body.dataset.loaded = '1';
    };

    // Fetch BEFORE touching the DOM so a failed refresh keeps the last good render.
    const refresh = async () => {
      const d = await ctx.fetchJSON(url);
      render((d && d.births) || []);
    };

    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try { await refresh(); ok = true; }
      catch { if (i < 2) await sleep(900 * (i + 1)); }
    }
    if (!ok && !body.dataset.loaded) body.replaceChildren(ctx.error('history unavailable'));
    // "Today" only rolls over at local midnight — an hourly refresh keeps the date
    // current without hammering the API. Keep last good on failure.
    ctx.interval(() => refresh().catch(() => {}), 60 * 60 * 1000);
  },
};
