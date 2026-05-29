// On This Day — a few notable historical events for today's month/day,
// via the keyless Wikipedia "onthisday" feed (through the SSRF-safe proxy).
export default {
  id: 'on-this-day',
  title: 'On This Day',
  icon: '📜',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { tz = 'America/Los_Angeles' } = ctx.config || {};

    ctx.style(`
      .otd { display:flex; flex-direction:column; gap:16px; }
      .otd-ev { display:flex; gap:16px; align-items:baseline;
        padding-bottom:16px; border-bottom:1px solid var(--stroke); }
      .otd-ev:last-child { border-bottom:none; padding-bottom:0; }
      .otd-year { flex:0 0 auto; min-width:74px; font-family:var(--font-display);
        font-weight:600; font-size:30px; line-height:1; color:var(--mint);
        font-variant-numeric:tabular-nums; }
      .otd-text { flex:1; font-size:17px; line-height:1.4; color:var(--ink); }
      .otd-ago { display:block; margin-top:4px; font-size:13px; color:var(--ink-faint); }
    `);

    body.appendChild(ctx.loading('leafing through history…'));

    try {
      // Compute zero-padded MM/DD for the configured timezone.
      const now = new Date();
      let mm, dd;
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, month: '2-digit', day: '2-digit',
        }).formatToParts(now);
        mm = parts.find((p) => p.type === 'month').value;
        dd = parts.find((p) => p.type === 'day').value;
      } catch (_) {
        mm = String(now.getMonth() + 1).padStart(2, '0');
        dd = String(now.getDate()).padStart(2, '0');
      }
      const thisYear = now.getFullYear();

      const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`;
      const data = await ctx.fetchJSON(url);
      const events = Array.isArray(data && data.events) ? data.events : [];

      const usable = events
        .filter((e) => e && typeof e.year === 'number' && typeof e.text === 'string' && e.text.trim());
      if (!usable.length) {
        body.replaceChildren(ctx.error('nothing noted for today'));
        return;
      }

      // Pick the oldest few — the most enduring / interesting moments.
      const picks = usable
        .slice()
        .sort((a, b) => a.year - b.year)
        .slice(0, 3);

      const rows = picks.map((e) => {
        const ago = thisYear - e.year;
        const text = e.text.trim();
        return ctx.h('div', { class: 'otd-ev' },
          ctx.h('div', { class: 'otd-year' }, String(e.year)),
          ctx.h('div', { class: 'otd-text' },
            text,
            ago > 0
              ? ctx.h('span', { class: 'otd-ago' }, `${ago} year${ago === 1 ? '' : 's'} ago`)
              : null));
      });

      body.replaceChildren(ctx.h('div', { class: 'otd' }, ...rows));
    } catch (e) {
      body.replaceChildren(ctx.error('history unavailable'));
    }
  },
};
