// On This Day — a few notable historical events for today's month/day,
// via the keyless Wikipedia "onthisday" feed (through the SSRF-safe proxy).
export default {
  id: 'on-this-day',
  title: 'On This Day',
  icon: '📜',
  size: 'full',
  chrome: true,
  async mount(body, ctx) {
    const { tz = 'America/Los_Angeles' } = ctx.config || {};

    ctx.style(`
      .otd { display:flex; gap:24px; height:100%; align-items:stretch; }
      .otd-ev { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; }
      .otd-ev + .otd-ev { border-left:1px solid var(--stroke); padding-left:24px; }
      .otd-year { font-family:var(--font-display); font-weight:700; font-size:21px; line-height:1;
        color:var(--mint); font-variant-numeric:tabular-nums; }
      .otd-desc { margin-top:6px; font-size:14px; line-height:1.32; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
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

      // Pick the oldest couple — the most enduring / interesting moments.
      const picks = usable
        .slice()
        .sort((a, b) => a.year - b.year)
        .slice(0, 2);

      const rows = picks.map((e) => {
        const text = e.text.trim();
        const yearLabel = e.year < 0 ? `${Math.abs(e.year)} BC` : String(e.year);
        return ctx.h('div', { class: 'otd-ev' },
          ctx.h('div', { class: 'otd-year' }, yearLabel),
          ctx.h('div', { class: 'otd-desc' }, text));
      });

      body.replaceChildren(ctx.h('div', { class: 'otd' }, ...rows));
    } catch (e) {
      body.replaceChildren(ctx.error('history unavailable'));
    }
  },
};
