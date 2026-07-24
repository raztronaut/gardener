// Out in SF — a calm list of upcoming free events around the city, sourced from
// SF RATS / FunCheap (see /lib/events.js). The full scrollable list lives behind
// the /events command (and opening this card fullscreen).
import { fetchEvents, TZ, MON } from '/lib/events.js';

export default {
  id: 'sf-events',
  title: 'Out in SF',
  icon: '🎉',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .won { display:flex; flex-direction:column; gap:14px; height:100%; }
      .won-list { flex:1; display:flex; flex-direction:column; gap:14px; min-height:0; }
      .won-ev { flex:1; display:flex; gap:12px; align-items:flex-start;
        padding-bottom:13px; border-bottom:1px solid var(--stroke); min-height:0; }
      .won-ev:last-child { border-bottom:none; padding-bottom:0; }
      .won-date { flex:0 0 auto; width:54px; text-align:center; line-height:1; padding-top:2px; }
      /* weekday cap above the day number — lets a glance tell a weekend from a
         weeknight; weekend days are accented in mint since they're likelier plans. */
      .won-date .wd { font-family:var(--font-mono); font-size:10.5px; letter-spacing:.12em;
        color:var(--ink-faint); margin-bottom:3px; }
      .won-date .wd.wknd { color:var(--mint); }
      .won-date .d { font-family:var(--font-display); font-weight:700; font-size:27px; color:var(--mint); }
      .won-date .m { font-family:var(--font-mono); font-size:10.5px; letter-spacing:.12em; color:var(--ink-faint); margin-top:3px; }
      .won-date.soon .d { font-size:16px; line-height:1.1; }
      .won-date.now .d { font-size:18px; line-height:1; white-space:nowrap; }
      .won-date.now .ap { font-family:var(--font-mono); font-size:10.5px; letter-spacing:.1em; color:var(--mint); margin-top:3px; }
      .won-main { flex:1; min-width:0; }
      .won-name { font-size:16px; font-weight:600; line-height:1.22; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .won-meta { margin-top:5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .won-place { font-size:12.5px; color:var(--ink-soft); overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; max-width:62%; }
      .won-pill { font-family:var(--font-mono); font-size:10.5px; letter-spacing:.04em; font-weight:600;
        color:var(--mint); background:rgba(120,247,176,.12); border:1px solid var(--stroke);
        border-radius:999px; padding:2px 9px; white-space:nowrap; }
      .won-empty { flex:1; display:flex; align-items:center; justify-content:center; text-align:center;
        color:var(--ink-faint); font-size:13px; padding:0 10px; }
      .won-foot { flex:0 0 auto; text-align:center; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.08em; color:var(--ink-faint); padding-top:2px; }
    `);

    const startOfToday = (() => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; })();
    const dayMs = 864e5;
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    // Weekday cap ("SAT") read in SF time, so a glance tells a weekend from a
    // weeknight even for events weeks out.
    const wdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

    // Date column: today shows the start TIME; otherwise day + month.
    const dateCol = (when, allDay) => {
      if (!when) return ctx.h('div', { class: 'won-date soon' }, ctx.h('div', { class: 'd' }, 'Soon'));
      const diff = Math.round((new Date(dayKeyFmt.format(when) + 'T00:00:00') - startOfToday) / dayMs);
      if (diff <= 0 && !allDay) {
        const [hhmm, ap = ''] = timeFmt.format(when).split(' ');
        return ctx.h('div', { class: 'won-date soon now' },
          ctx.h('div', { class: 'd' }, hhmm), ap ? ctx.h('div', { class: 'ap' }, ap) : null);
      }
      if (diff <= 0) return ctx.h('div', { class: 'won-date soon' }, ctx.h('div', { class: 'd' }, 'Today'));
      if (diff === 1) return ctx.h('div', { class: 'won-date soon' }, ctx.h('div', { class: 'd' }, 'Tmrw'));
      const wd = wdayFmt.format(when).toUpperCase(); // "SAT"
      const wknd = wd === 'SAT' || wd === 'SUN';
      return ctx.h('div', { class: 'won-date' },
        ctx.h('div', { class: `wd${wknd ? ' wknd' : ''}` }, wd),
        ctx.h('div', { class: 'd' }, String(when.getDate())),
        ctx.h('div', { class: 'm' }, MON[when.getMonth()]));
    };

    const list = ctx.h('div', { class: 'won-list' });
    const foot = ctx.h('div', { class: 'won-foot', style: 'display:none' });
    body.replaceChildren(ctx.h('div', { class: 'won' }, list, foot));

    const render = (evs) => {
      const all = evs || [];
      const picks = all.slice(0, 5);
      if (!picks.length) { foot.style.display = 'none'; list.replaceChildren(ctx.h('div', { class: 'won-empty' }, 'No upcoming events right now')); return; }
      list.replaceChildren(...picks.map((e) => {
        const isToday = e.when && Math.round((new Date(dayKeyFmt.format(e.when) + 'T00:00:00') - startOfToday) / dayMs) <= 0;
        const time = (e.when && !e.allDay && !isToday) ? timeFmt.format(e.when).replace(' ', '') : '';
        return ctx.h('div', { class: 'won-ev' },
          dateCol(e.when, e.allDay),
          ctx.h('div', { class: 'won-main' },
            ctx.h('div', { class: 'won-name' }, `${e.emoji ? e.emoji + ' ' : ''}${e.name}`),
            (e.place || time) ? ctx.h('div', { class: 'won-meta' },
              e.place ? ctx.h('span', { class: 'won-place' }, `📍 ${e.place}`) : null,
              time ? ctx.h('span', { class: 'won-pill' }, time) : null) : null));
      }));
      foot.textContent = all.length > picks.length ? `+ more — tap for all ${all.length} events` : 'tap for the full list';
      foot.style.display = '';
    };

    // Fetch BEFORE touching the list so a failed refresh keeps the last good render.
    const refresh = async () => { const evs = await fetchEvents(ctx.fetchJSON); render(evs); };

    let loadedOnce = false;
    list.replaceChildren(ctx.loading('checking the city…'));
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try { await refresh(); ok = true; loadedOnce = true; }
      catch { await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
    }
    if (!ok) list.replaceChildren(ctx.h('div', { class: 'won-empty' }, 'events unavailable'));

    // Periodic refresh (drops past events); keep last good on failure.
    ctx.interval(() => { if (loadedOnce) refresh().catch(() => {}); }, 5 * 60 * 1000);
  },
};
