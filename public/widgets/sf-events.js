// Out in SF — real, upcoming, fun things to do around the city: parties, music,
// art openings, festivals, free stuff, night markets, DJ sets. Source: Funcheap SF
// ("Free & Cheap Things to Do in San Francisco"), a reputable keyless RSS feed,
// fetched through the SSRF-safe proxy. The previous DataSF civic feed only ever
// returned after-school programs / library storytime / parent-child playgroups —
// nothing a hacker house would call "shit happening" — so we switched sources.
//
// Funcheap item titles look like:  "6/4/26: Chinatown Night Market (SF) - FREE"
// We parse the leading M/D/YY date, the trailing price ("- FREE" / "- $20"), and a
// trailing "(Neighborhood)" hint, then show the soonest few upcoming events.
const FEED = 'https://feeds.feedburner.com/funcheapsf_recent_added_events/';

const tidy = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// "6/4/26: Name (SF) - FREE" → { when:Date|null, name, place, price }
function parseTitle(raw) {
  let t = tidy(raw);
  let when = null;
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}):\s*(.*)$/.exec(t);
  if (dm) {
    let [, mo, da, yr, rest] = dm;
    yr = +yr; if (yr < 100) yr += 2000;
    const d = new Date(yr, +mo - 1, +da);
    if (!isNaN(d)) when = d;
    t = rest;
  }
  // trailing price / FREE tag
  let price = '';
  const pm = /\s[-–—]\s*(FREE\b[^-–—]*|\$[\d.,]+(?:\s*[-–—]\s*\$?[\d.,]+)?\+?[^-–—]*)$/i.exec(t);
  if (pm) { price = tidy(pm[1]).toUpperCase().startsWith('FREE') ? 'FREE' : tidy(pm[1]); t = t.slice(0, pm.index); }
  // trailing "(Neighborhood / City)"
  let place = '';
  const lm = /\(([^()]{2,28})\)\s*$/.exec(tidy(t));
  if (lm) { place = tidy(lm[1]); t = tidy(t).slice(0, lm.index); }
  return { when, name: tidy(t).replace(/[\s:–-]+$/, ''), place, price };
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
      .sfe-ev { flex:1; display:flex; gap:14px; align-items:flex-start;
        padding-bottom:11px; border-bottom:1px solid var(--stroke); }
      .sfe-ev:last-child { border-bottom:none; padding-bottom:0; }
      .sfe-date { flex:0 0 auto; width:62px; text-align:center; line-height:1; padding-top:2px; }
      .sfe-date .d { font-family:var(--font-display); font-weight:700; font-size:30px; color:var(--mint); }
      .sfe-date .m { font-family:var(--font-mono); font-size:11px; letter-spacing:.12em; color:var(--ink-faint); margin-top:3px; }
      .sfe-date.soon .d { font-size:17px; line-height:1.1; }
      .sfe-main { flex:1; min-width:0; }
      .sfe-name { font-size:17px; font-weight:600; line-height:1.24; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .sfe-meta { margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .sfe-place { font-size:13px; color:var(--ink-soft); overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; max-width:60%; }
      .sfe-price { font-family:var(--font-mono); font-size:11px; letter-spacing:.04em; font-weight:600;
        color:var(--gold); background:rgba(255,217,138,.1); border:1px solid var(--stroke);
        border-radius:999px; padding:2px 9px; white-space:nowrap; }
      .sfe-price.free { color:var(--mint); background:rgba(120,247,176,.12); }
    `);
    body.appendChild(ctx.loading('checking the city…'));

    const startOfToday = (() => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; })();

    const refresh = async () => {
      const xml = await ctx.fetchText(FEED);
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const items = Array.from(doc.querySelectorAll('item'));
      const seen = new Set();
      const evs = [];
      for (const it of items) {
        const parsed = parseTitle(it.querySelector('title')?.textContent || '');
        if (!parsed.name) continue;
        const key = parsed.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        evs.push(parsed);
      }
      // Prefer upcoming events (today onward), soonest first; undated go last.
      const upcoming = evs.filter((e) => e.when && e.when >= startOfToday);
      const pool = upcoming.length ? upcoming : evs;
      pool.sort((a, b) => (a.when ? a.when.getTime() : Infinity) - (b.when ? b.when.getTime() : Infinity));
      const picks = pool.slice(0, 4);
      if (!picks.length) { body.replaceChildren(ctx.error('no events listed right now')); return; }

      const dayMs = 864e5;
      const rows = picks.map((e) => {
        let dateEl;
        if (e.when) {
          const diff = Math.round((e.when - startOfToday) / dayMs);
          if (diff <= 0) dateEl = ctx.h('div', { class: 'sfe-date soon' }, ctx.h('div', { class: 'd' }, 'Today'));
          else if (diff === 1) dateEl = ctx.h('div', { class: 'sfe-date soon' }, ctx.h('div', { class: 'd' }, 'Tmrw'));
          else dateEl = ctx.h('div', { class: 'sfe-date' },
            ctx.h('div', { class: 'd' }, String(e.when.getDate())),
            ctx.h('div', { class: 'm' }, MON[e.when.getMonth()]));
        } else {
          dateEl = ctx.h('div', { class: 'sfe-date soon' }, ctx.h('div', { class: 'd' }, 'Soon'));
        }
        const isFree = /^free$/i.test(e.price);
        return ctx.h('div', { class: 'sfe-ev' },
          dateEl,
          ctx.h('div', { class: 'sfe-main' },
            ctx.h('div', { class: 'sfe-name' }, e.name),
            (e.place || e.price) ? ctx.h('div', { class: 'sfe-meta' },
              e.place ? ctx.h('span', { class: 'sfe-place' }, `📍 ${e.place}`) : null,
              e.price ? ctx.h('span', { class: `sfe-price ${isFree ? 'free' : ''}`.trim() }, e.price) : null) : null));
      });
      body.replaceChildren(ctx.h('div', { class: 'sfe' }, ...rows));
    };

    try {
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 3 * 60 * 60 * 1000);
    } catch {
      body.replaceChildren(ctx.error('events unavailable'));
    }
  },
};
