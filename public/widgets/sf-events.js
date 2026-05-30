// Today in SF — notable civic / cultural / community events happening in San
// Francisco today, via the keyless DataSF "Our415 Events & Activities" dataset
// (Socrata SODA API) through the SSRF-safe proxy.
//   https://data.sfgov.org/resource/8i3s-ih2a.json
const RESOURCE = 'https://data.sfgov.org/resource/8i3s-ih2a.json';

// Title-case a SHOUTY or messy string, leaving short connectors lowercase.
function tidy(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

export default {
  id: 'sf-events',
  title: 'Today in SF',
  icon: '🌉',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .sfe { display:flex; flex-direction:column; gap:13px; }
      .sfe-ev { padding-bottom:13px; border-bottom:1px solid var(--stroke); }
      .sfe-ev:last-child { border-bottom:none; padding-bottom:0; }
      .sfe-name { font-size:18px; font-weight:600; line-height:1.28; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .sfe-meta { margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        font-size:13px; color:var(--ink-faint); }
      .sfe-cat { font-family:var(--font-mono); font-size:11px; letter-spacing:.04em;
        color:var(--mint); background:rgba(120,247,176,.1); border:1px solid var(--stroke);
        border-radius:999px; padding:3px 9px; white-space:nowrap; }
      .sfe-where { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
    `);
    body.appendChild(ctx.loading('checking the city…'));

    // Today's date (SF timezone) as YYYY-MM-DD.
    let day;
    try {
      day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date());
    } catch {
      day = new Date().toISOString().slice(0, 10);
    }

    const where = `event_start_date <= '${day}T23:59:59' AND event_end_date >= '${day}T00:00:00'`;
    const url = `${RESOURCE}`
      + `?$select=event_name,events_category,org_name,site_location_name,analysis_neighborhood,event_start_date,event_end_date`
      + `&$where=${where}`
      + `&$order=event_start_date&$limit=60`;

    try {
      const span = (r) => {
        const a = Date.parse(r && r.event_start_date), b = Date.parse(r && r.event_end_date);
        return (Number.isFinite(a) && Number.isFinite(b)) ? Math.max(0, b - a) : Infinity;
      };

      const refresh = async () => {
        const rows = await ctx.fetchJSON(url);
        const list = Array.isArray(rows) ? rows : [];
        // Shortest-running events first: a one-day happening is more "notable"
        // than a year-long recurring program, which would otherwise dominate.
        list.sort((a, b) => span(a) - span(b));

        // Dedupe by event name, prefer entries that carry a category/location.
        const seen = new Set();
        const picks = [];
        for (const r of list) {
          const name = tidy(r && r.event_name);
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          picks.push(r);
          if (picks.length >= 4) break;
        }

        if (!picks.length) {
          body.replaceChildren(ctx.error('no events listed for today'));
          return;
        }

        const rowsEl = picks.map((r) => {
          const cat = tidy(r.events_category);
          const where = tidy(r.analysis_neighborhood) || tidy(r.site_location_name) || tidy(r.org_name);
          return ctx.h('div', { class: 'sfe-ev' },
            ctx.h('div', { class: 'sfe-name' }, tidy(r.event_name)),
            ctx.h('div', { class: 'sfe-meta' },
              cat ? ctx.h('span', { class: 'sfe-cat' }, cat) : null,
              where ? ctx.h('span', { class: 'sfe-where' }, where) : null));
        });

        body.replaceChildren(ctx.h('div', { class: 'sfe' }, ...rowsEl));
      };
      await refresh();
      // City listings change slowly — refresh a few times a day.
      ctx.interval(() => refresh().catch(() => {}), 6 * 60 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('events unavailable'));
    }
  },
};
