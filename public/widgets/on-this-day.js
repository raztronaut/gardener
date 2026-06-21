// On This Day — notable historical events for today's date, via Wikipedia's
// keyless REST feed (through the SSRF-safe proxy).
//   https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/<MM>/<DD>
//     -> { events: [ { year, text, pages:[...] }, ... ] }
// A calm ambient almanac that fills the lower-right md slot beside the emulator.

const COUNT = 2;            // events shown — tuned to fit the md card without clipping
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pad to 2 digits
const p2 = (n) => String(n).padStart(2, '0');

export default {
  id: 'on-this-day',
  title: 'On This Day',
  icon: '📜',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .otd { display:flex; flex-direction:column; gap:8px; height:100%; }
      .otd-ev { display:flex; gap:13px; align-items:flex-start; flex:1;
        padding:9px 13px; background:rgba(255,255,255,.04);
        border:1px solid var(--stroke); border-radius:16px; min-height:0; }
      .otd-year { font-family:var(--font-display); font-weight:700; line-height:1;
        color:var(--mint); flex:0 0 auto; text-align:right; min-width:50px;
        filter:drop-shadow(0 3px 8px rgba(0,0,0,.4)); }
      .otd-year .y { font-size:22px; }
      .otd-year .ago { display:block; margin-top:4px; font-family:var(--font-mono);
        font-size:9px; letter-spacing:.04em; color:var(--ink-faint); white-space:nowrap; }
      .otd-text { font-size:14.5px; line-height:1.3; color:var(--ink); min-width:0; flex:1;
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    `);
    body.appendChild(ctx.loading('leafing through history…'));

    const now = new Date();
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${p2(now.getMonth() + 1)}/${p2(now.getDate())}`;
    const thisYear = now.getFullYear();

    const refresh = async () => {
      const d = await ctx.fetchJSON(url);
      const events = Array.isArray(d && d.events) ? d.events : [];
      if (events.length === 0) {
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('no events for today'));
        return;
      }
      // Most recent first → the freshest, most relatable history reads at top.
      const picked = events
        .filter((e) => e && e.text && Number.isFinite(e.year))
        .sort((a, b) => b.year - a.year)
        .slice(0, COUNT);
      if (picked.length === 0) {
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('no events for today'));
        return;
      }
      const rows = picked.map((e) => {
        const ago = Math.max(0, thisYear - e.year);
        return ctx.h('div', { class: 'otd-ev' },
          ctx.h('div', { class: 'otd-year' },
            ctx.h('span', { class: 'y' }, String(e.year)),
            ctx.h('span', { class: 'ago' }, ago === 0 ? 'this year' : `${ago} yr${ago === 1 ? '' : 's'} ago`)),
          ctx.h('div', { class: 'otd-text', title: e.text }, e.text));
      });
      body.replaceChildren(ctx.h('div', { class: 'otd' }, ...rows));
      body.dataset.loaded = '1';
    };

    try {
      let loaded = false;
      for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
        try { await refresh(); loaded = true; }
        catch { if (attempt < 3) await sleep(900 * attempt); }
      }
      if (!loaded) body.replaceChildren(ctx.error('on this day unavailable — retrying…'));
      // Refresh a few times a day; on failure KEEP the last good render (don't blank).
      ctx.interval(() => refresh().catch(() => {}), 6 * 60 * 60 * 1000);
    } catch {
      body.replaceChildren(ctx.error('on this day unavailable'));
    }
  },
};
