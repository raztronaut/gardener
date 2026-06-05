// Out in SF — real, upcoming things to do around the city, sourced from SF RATS
// (sfrats.com). Shows the next few events on the dashboard; the full, scrollable
// list lives behind the /events (or /e) command. Data sourcing, cleaning, de-duping
// and PAST-EVENT PRUNING all live in /lib/events.js so the card and the modal agree.
import { fetchEvents, TZ, MON } from '/lib/events.js';

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

    const render = (evs) => {
      const picks = evs.slice(0, 4);
      if (!picks.length) { body.replaceChildren(ctx.error('no upcoming events right now')); return; }
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

    // Fetch BEFORE touching the DOM so a failed refresh keeps the last good render.
    const refresh = async () => { const evs = await fetchEvents(ctx.fetchJSON); render(evs); };

    // Retry the initial load a few times before showing an error (flaky networks).
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try { await refresh(); ok = true; }
      catch { await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
    }
    if (!ok) body.replaceChildren(ctx.error('events unavailable'));
    // Refresh every 15 min so events that have already passed drop off the list.
    ctx.interval(() => refresh().catch(() => {}), 15 * 60 * 1000);
  },
};
