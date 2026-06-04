// Out in SF — real, upcoming things to do around the city, sourced from SF RATS
// (sfrats.com): "a working field guide to free events around the Bay Area, posted
// by neighbors and curated by AI." Honors the note: "for the events in sf, search
// the sfrats api and use that."
//
// SF RATS is a Supabase-backed app; its public PostgREST endpoint is keyless (the
// anon key ships in the site's own JS bundle) and fully CORS-open. We fetch the
// "Events" category, upcoming-only, soonest-first, through the SSRF-safe proxy.
// The anon key is passed as the `apikey` query param (Supabase's gateway accepts
// it there), so no custom headers are needed.
const SUPA = 'https://uflkltmvzvhziysheccd.supabase.co/rest/v1/items';
// Public anon key, role "anon" — published in sfrats.com's client bundle. Not a secret.
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmbGtsdG12enZoeml5c2hlY2NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMTEzNTYsImV4cCI6MjA5Mzg4NzM1Nn0.4rnQa5rCJNzmnfzjUg0B-ecJ-dxCnJamrA9tu8eiBWU';
const TZ = 'America/Los_Angeles';
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const tidy = (s) => String(s || '').trim().replace(/\s+/g, ' ');

// Titles from scraped sources look like "6/20/26: Name (Venue) - FREE". The real
// date lives in available_from, so strip the leading date prefix and trailing price
// tag, leaving a clean human name. Native titles (e.g. "OpenClaw @ GitHub") pass
// through untouched.
function cleanName(raw) {
  let t = tidy(raw);
  t = t.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}:\s*/, '');
  t = t.replace(/\s[-–—]\s*(FREE\b.*|\$[\d.,].*)$/i, '');
  return tidy(t).replace(/[\s:–-]+$/, '');
}

// Trim the location to the neighborhood: drop generic ", San Francisco[, CA]" tails.
function cleanPlace(raw) {
  let t = tidy(raw);
  if (/^san francisco(,?\s*ca)?$/i.test(t)) return '';
  t = t.replace(/,?\s*san francisco(,?\s*ca)?\.?$/i, '');
  return tidy(t);
}

// "today" in SF as YYYY-MM-DD, for the available_from filter.
function sfToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p;
}

export default {
  id: 'sf-events',
  title: 'Out in SF',
  icon: '🎉',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .sfe { display:flex; flex-direction:column; gap:12px; height:100%; }
      .sfe-ev { flex:1; display:flex; gap:13px; align-items:flex-start;
        padding-bottom:11px; border-bottom:1px solid var(--stroke); min-height:0; }
      .sfe-ev:last-child { border-bottom:none; padding-bottom:0; }
      .sfe-date { flex:0 0 auto; width:58px; text-align:center; line-height:1; padding-top:2px; }
      .sfe-date .em { font-size:20px; }
      .sfe-date .d { font-family:var(--font-display); font-weight:700; font-size:29px; color:var(--mint); }
      .sfe-date .m { font-family:var(--font-mono); font-size:11px; letter-spacing:.12em; color:var(--ink-faint); margin-top:3px; }
      .sfe-date.soon .d { font-size:17px; line-height:1.1; }
      .sfe-main { flex:1; min-width:0; }
      .sfe-name { font-size:16.5px; font-weight:600; line-height:1.22; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .sfe-meta { margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .sfe-place { font-size:13px; color:var(--ink-soft); overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; max-width:62%; }
      .sfe-time { font-family:var(--font-mono); font-size:11px; letter-spacing:.04em; font-weight:600;
        color:var(--mint); background:rgba(120,247,176,.12); border:1px solid var(--stroke);
        border-radius:999px; padding:2px 9px; white-space:nowrap; }
    `);
    body.appendChild(ctx.loading('checking the city…'));

    const startOfToday = (() => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; })();
    const dayMs = 864e5;
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

    const refresh = async () => {
      const params = new URLSearchParams({
        select: 'id,title,location_address,available_from,emoji',
        category: 'eq.Events',
        available_from: `gte.${sfToday()}`,
        order: 'available_from.asc',
        limit: '40',
        apikey: ANON,
      });
      const rows = await ctx.fetchJSON(`${SUPA}?${params.toString()}`);
      if (!Array.isArray(rows)) { body.replaceChildren(ctx.error('events unavailable')); return; }

      // Dedup near-identical listings (the feed often has "X with Y", "X w/ Y",
      // "X w/ Y at Venue" as separate rows). Collapse on a normalized prefix.
      const dedupKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
      const seen = new Set();
      const evs = [];
      for (const r of rows) {
        const name = cleanName(r.title);
        if (!name || /^__SCRAPER_RUN__/.test(r.title || '')) continue;
        const key = dedupKey(name);
        if (seen.has(key)) continue;
        seen.add(key);
        const when = r.available_from ? new Date(r.available_from) : null;
        evs.push({ name, when: when && !isNaN(when) ? when : null, place: cleanPlace(r.location_address), emoji: tidy(r.emoji) });
      }
      const picks = evs.slice(0, 4);
      if (!picks.length) { body.replaceChildren(ctx.error('no events listed right now')); return; }

      const els = picks.map((e) => {
        let dateEl;
        if (e.when) {
          const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(e.when);
          const diff = Math.round((new Date(dayKey + 'T00:00:00') - startOfToday) / dayMs);
          if (diff <= 0) dateEl = ctx.h('div', { class: 'sfe-date soon' }, ctx.h('div', { class: 'd' }, 'Today'));
          else if (diff === 1) dateEl = ctx.h('div', { class: 'sfe-date soon' }, ctx.h('div', { class: 'd' }, 'Tmrw'));
          else dateEl = ctx.h('div', { class: 'sfe-date' },
            ctx.h('div', { class: 'd' }, String(e.when.getDate())),
            ctx.h('div', { class: 'm' }, MON[e.when.getMonth()]));
        } else {
          dateEl = ctx.h('div', { class: 'sfe-date soon' },
            e.emoji ? ctx.h('div', { class: 'em' }, e.emoji) : ctx.h('div', { class: 'd' }, 'Soon'));
        }
        const time = e.when ? timeFmt.format(e.when).replace(' ', '') : '';
        return ctx.h('div', { class: 'sfe-ev' },
          dateEl,
          ctx.h('div', { class: 'sfe-main' },
            ctx.h('div', { class: 'sfe-name' }, `${e.emoji ? e.emoji + ' ' : ''}${e.name}`),
            (e.place || time) ? ctx.h('div', { class: 'sfe-meta' },
              e.place ? ctx.h('span', { class: 'sfe-place' }, `📍 ${e.place}`) : null,
              time ? ctx.h('span', { class: 'sfe-time' }, time) : null) : null));
      });
      body.replaceChildren(ctx.h('div', { class: 'sfe' }, ...els));
    };

    try {
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 3 * 60 * 60 * 1000);
    } catch {
      body.replaceChildren(ctx.error('events unavailable'));
    }
  },
};
