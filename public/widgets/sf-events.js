// Today in SF — specific cultural / civic / community happenings in San Francisco
// today, via the keyless DataSF "Our415 Events & Activities" dataset (Socrata SODA
// API) through the SSRF-safe proxy. Shows each event's time + location.
//   https://data.sfgov.org/resource/8i3s-ih2a.json
// (Aggregators like Luma/Eventbrite need API keys, so aren't usable keyless; DataSF
//  is the reputable keyless civic feed. We drop generic drop-in sports/rec entries
//  and favour one-off, place-specific events.)
const RESOURCE = 'https://data.sfgov.org/resource/8i3s-ih2a.json';

const tidy = (s) => String(s || '').trim().replace(/\s+/g, ' ');

// Skip recurring drop-in sports / fitness / generic recreation — not "events".
const SKIP = /\b(sport|sports|athletic|fitness|recreation|drop[\s-]?in|basketball|soccer|volleyball|pickleball|softball|baseball|tennis|workout|bootcamp|zumba|aerobics|gym)\b/i;

// "18:00:00" -> "6 PM" / "6:30 PM"
function fmtT(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  let h = +m[1]; const mm = m[2]; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
  return mm === '00' ? `${h} ${ap}` : `${h}:${mm} ${ap}`;
}

export default {
  id: 'sf-events',
  title: 'Today in SF',
  icon: '🌉',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    const { tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .sfe { display:flex; flex-direction:column; gap:12px; height:100%; }
      .sfe-ev { flex:1; display:flex; flex-direction:column; justify-content:center;
        padding-bottom:11px; border-bottom:1px solid var(--stroke); }
      .sfe-ev:last-child { border-bottom:none; padding-bottom:0; }
      .sfe-name { font-size:17px; font-weight:600; line-height:1.24; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .sfe-meta { margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .sfe-time { font-family:var(--font-mono); font-size:13px; color:var(--gold); white-space:nowrap; }
      .sfe-cat { font-family:var(--font-mono); font-size:11px; letter-spacing:.03em;
        color:var(--mint); background:rgba(120,247,176,.1); border:1px solid var(--stroke);
        border-radius:999px; padding:2px 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:62%; }
      .sfe-addr { margin-top:4px; font-size:13px; color:var(--ink-faint);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    `);
    body.appendChild(ctx.loading('checking the city…'));

    let day;
    try {
      day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch { day = new Date().toISOString().slice(0, 10); }

    const where = `event_start_date <= '${day}T23:59:59' AND event_end_date >= '${day}T00:00:00'`;
    const url = `${RESOURCE}`
      + `?$select=event_name,events_category,org_name,site_location_name,site_address,analysis_neighborhood,start_time,end_time,event_start_date,event_end_date`
      + `&$where=${where}`
      + `&$order=event_start_date&$limit=120`;

    try {
      const span = (r) => {
        const a = Date.parse(r && r.event_start_date), b = Date.parse(r && r.event_end_date);
        return (Number.isFinite(a) && Number.isFinite(b)) ? Math.max(0, b - a) : Infinity;
      };
      const refresh = async () => {
        const rows = await ctx.fetchJSON(url);
        const list = (Array.isArray(rows) ? rows : []).slice();
        list.sort((a, b) => span(a) - span(b)); // one-off happenings before year-long programs
        const seen = new Set(); const picks = [];
        for (const r of list) {
          const name = tidy(r && r.event_name);
          if (!name) continue;
          const cat = tidy(r && r.events_category);
          if (SKIP.test(name) || SKIP.test(cat)) continue; // drop generic sports/rec
          const k = name.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k); picks.push(r);
          if (picks.length >= 5) break;
        }
        if (!picks.length) { body.replaceChildren(ctx.error('no events listed for today')); return; }

        const rowsEl = picks.map((r) => {
          const cat = tidy(r.events_category);
          const s = fmtT(r.start_time), e = fmtT(r.end_time);
          const time = s ? (e && e !== s ? `${s} – ${e}` : s) : 'All day';
          const addr = tidy(r.site_address) || tidy(r.site_location_name) || tidy(r.analysis_neighborhood);
          return ctx.h('div', { class: 'sfe-ev' },
            ctx.h('div', { class: 'sfe-name' }, tidy(r.event_name)),
            ctx.h('div', { class: 'sfe-meta' },
              ctx.h('span', { class: 'sfe-time' }, `🕒 ${time}`),
              cat ? ctx.h('span', { class: 'sfe-cat' }, cat) : null),
            addr ? ctx.h('div', { class: 'sfe-addr' }, `📍 ${addr}`) : null);
        });
        body.replaceChildren(ctx.h('div', { class: 'sfe' }, ...rowsEl));
      };
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 6 * 60 * 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('events unavailable'));
    }
  },
};
