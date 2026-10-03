// Out in SF — a calm concierge line of free events around the city, sourced from
// SF RATS / FunCheap (see /lib/events.js). The full scrollable list lives behind
// the /events command (and opening this card fullscreen).
//
// The card is TALL (half width, two rows) and reads like a day agenda: every
// event today in time order — a fixed time column (or ALL DAY), the full event
// name over up to two lines, and its venue beneath. As many as fit are shown;
// overflow rows are trimmed, never clipped. With nothing left today it falls
// back to the next upcoming events.
//
// Events happening TODAY carry a live countdown pill ("in 2h 15m" → "on now"),
// updated each minute (a cheap text-only rebuild of the ≤3 shown rows — no images,
// no network), so a glance across the room answers "what can we do tonight?".
import { fetchEvents, splitTitle, TZ, MON } from '/lib/events.js';

export default {
  id: 'sf-events',
  title: 'Out in SF',
  icon: '🎉',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .won { display:flex; flex-direction:column; height:100%; gap:8px; }

      /* Shared heading: the featured pick's day said once, a hairline rule to
         carry the eye across, and the size of the full listing at the far right
         (which is why the card no longer needs a separate footer line). */
      .won-hd { flex:0 0 auto; display:flex; align-items:center; gap:9px;
        font-family:var(--font-mono); font-size:12px; letter-spacing:.13em;
        color:var(--ink-faint); white-space:nowrap; }
      .won-hd .tdy { color:var(--mint); font-weight:700; }
      .won-hd .rule { flex:1; height:1px; background:var(--stroke); min-width:8px; }
      .won-hd .all { opacity:.8; }

      .won-list { --sp:9px; flex:1 1 0; display:flex; flex-direction:column; gap:var(--sp); min-height:0; overflow:hidden; }

      /* Agenda rows — the readable day view: a fixed time column, then the full
         event name over up to two lines with its venue beneath. */
      .won-ag { flex:0 0 auto; display:grid; grid-template-columns:62px 1fr; column-gap:12px; min-width:0;
        padding-bottom:var(--sp); border-bottom:1px solid var(--stroke); }
      .won-ag:last-child { border-bottom:none; }
      .won-ag .tm { font-family:var(--font-mono); font-size:13px; font-weight:600; color:var(--ink);
        letter-spacing:.02em; padding-top:2px; white-space:nowrap; }
      .won-ag .tm.all { font-size:12px; color:var(--ink-faint); letter-spacing:.08em; }
      .won-ag .tm .lv { display:block; margin-top:4px; font-size:11.5px; font-weight:700; color:var(--gold); letter-spacing:.04em; }
      .won-ag .tm .lv.soon { color:var(--mint); font-weight:600; }
      .won-ag .nm { font-size:14.5px; font-weight:600; line-height:1.25; color:var(--ink); min-width:0;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .won-ag .pl { margin-top:3px; font-size:13px; color:var(--ink-faint); white-space:nowrap;
        overflow:hidden; text-overflow:ellipsis; }
      .won-empty { flex:1; display:flex; align-items:center; justify-content:center;
        text-align:center; color:var(--ink-faint); font-size:13px; padding:0 10px; }
    `);

    const startOfToday = (() => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; })();
    const dayMs = 864e5;
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    // Weekday cap ("SAT") read in SF time, so a glance tells a weekend from a
    // weeknight even for events weeks out.
    const wdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

    // Whole-day offset from today, read in SF time so it rolls over cleanly at
    // local midnight. 0 = today, 1 = tomorrow, negative = already begun.
    const dayOffset = (when) => (when && !isNaN(when)
      ? Math.round((new Date(dayKeyFmt.format(when) + 'T00:00:00') - startOfToday) / dayMs)
      : null);

    // Live countdown for a today-event's start. Future → a calm "in 2h 15m" /
    // "in 40m"; under way (start passed, but the events lib's 2h grace keeps it in
    // the list) → a warm "on now". Returns { txt, cls } or null when not applicable.
    const liveCountdown = (when, allDay, isToday) => {
      if (!isToday || allDay || !when || isNaN(when)) return null;
      const mins = Math.round((when.getTime() - Date.now()) / 60000);
      if (mins >= 1) {
        if (mins < 60) return { txt: `in ${mins}m`, cls: 'soon' };
        const h = Math.floor(mins / 60), m = mins % 60;
        return { txt: m ? `in ${h}h ${m}m` : `in ${h}h`, cls: 'soon' };
      }
      return { txt: 'on now', cls: 'live' };
    };

    const head = ctx.h('div', { class: 'won-hd', style: 'display:none' });
    const list = ctx.h('div', { class: 'won-list' });
    body.replaceChildren(ctx.h('div', { class: 'won' }, head, list));

    const render = (evs) => {
      const all = evs || [];
      const todayEvs = all.filter((e) => { const o = dayOffset(e.when); return o != null && o <= 0; });
      const showingToday = todayEvs.length > 0;
      const picks = (showingToday ? todayEvs : all.slice(0, 10)).slice();
      if (!picks.length) {
        head.style.display = 'none';
        rows = [];
        list.replaceChildren(ctx.h('div', { class: 'won-empty' }, 'No upcoming events right now'));
        return;
      }
      // Chronological: all-day / undated first, then by start time.
      const timed = (e) => e.when && !e.allDay && !isNaN(e.when);
      picks.sort((x, y) => (timed(x) ? x.when.getTime() : 0) - (timed(y) ? y.when.getTime() : 0));

      const first = picks[0];
      const cap = showingToday ? 'TODAY' : (dayOffset(first.when) === 1 ? 'TOMORROW' : 'COMING UP');
      const dm = first.when && !isNaN(first.when) ? `${wdayFmt.format(first.when).toUpperCase()} ${first.when.getDate()} ${MON[first.when.getMonth()]}` : '';
      head.replaceChildren(
        ctx.h('span', { class: 'tdy' }, cap),
        dm ? ctx.h('span', {}, dm) : null,
        ctx.h('span', { class: 'rule' }),
        ctx.h('span', { class: 'all' }, `${picks.length} EVENT${picks.length === 1 ? '' : 'S'}`));
      head.style.display = '';

      let prevAllDay = false;
      rows = picks.map((e) => {
        const isT = (() => { const o = dayOffset(e.when); return o != null && o <= 0; })();
        const live = liveCountdown(e.when, e.allDay, isT);
        // Tidy the scraped title: its trailing "(SF)" / "(2026)" / "(7p + 9p)" /
        // "(Yerba Buena Gardens)" tags move to the time column and venue line.
        const t = splitTitle(e.name);
        const sub = [e.place || t.where, t.note].filter(Boolean).join(' · ');
        let tm;
        if (timed(e)) {
          const clock = timeFmt.format(e.when).replace(':00', '');
          const dayTag = !isT && showingToday === false && dayOffset(e.when) > 1
            ? `${e.when.getDate()} ${MON[e.when.getMonth()]}` : null;
          tm = ctx.h('div', { class: 'tm' }, dayTag || clock,
            live ? ctx.h('span', { class: `lv${live.cls === 'soon' ? ' soon' : ''}` }, live.cls === 'live' ? '● ON NOW' : live.txt) : null);
        } else if (t.time) {
          tm = ctx.h('div', { class: 'tm' }, t.time);
        } else {
          // Say "ALL DAY" once for the run of all-day events, not on every row —
          // the repeated label read as noise down the time column.
          tm = ctx.h('div', { class: 'tm all' }, prevAllDay ? '' : 'ALL DAY');
        }
        prevAllDay = !timed(e) && !t.time;
        return ctx.h('div', { class: 'won-ag', title: e.name },
          tm,
          ctx.h('div', { style: 'min-width:0' },
            ctx.h('div', { class: 'nm' }, t.name || e.name),
            sub ? ctx.h('div', { class: 'pl' }, sub) : null));
      });
      fit();
    };

    // Fit: lay out EVERY row, then drop trailing rows until the list no longer
    // overflows. Re-run whenever the card's height changes — the grid settles as
    // neighbouring widgets load, and fitting only once (against an early, shorter
    // card) used to strand the list at 3–4 rows above a tall empty gap.
    let rows = [];
    const fit = () => {
      if (!rows.length) return;
      list.style.removeProperty('--sp');
      list.replaceChildren(...rows);
      while (list.children.length > 1 && list.scrollHeight > list.clientHeight + 1) list.lastChild.remove();
      // When rows were trimmed, share the leftover height out as extra spacing
      // between the survivors (gap + rule padding), so the agenda fills the card
      // to its foot instead of stopping short above an empty band.
      const n = list.children.length;
      if (n > 1 && n < rows.length) {
        const slack = list.getBoundingClientRect().bottom - list.lastChild.getBoundingClientRect().bottom;
        if (slack > 2) list.style.setProperty('--sp', `${(9 + Math.min(14, (slack - 2) / (2 * n - 1))).toFixed(1)}px`);
      }
    };
    let lastH = -1, fitQueued = false;
    try {
      new ResizeObserver(() => {
        const hgt = list.clientHeight;
        if (hgt === lastH || fitQueued) return;
        lastH = hgt; fitQueued = true;
        requestAnimationFrame(() => { fitQueued = false; fit(); });
      }).observe(list);
    } catch { /* no ResizeObserver — the minute re-render still refits */ }

    // Fetch BEFORE touching the list so a failed refresh keeps the last good render.
    // Keep the last good events so the minute-tick below can re-render the live
    // "today" countdowns without re-hitting the network.
    let lastEvents = null;
    const refresh = async () => { const evs = await fetchEvents(ctx.fetchJSON); lastEvents = evs; render(evs); };

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
    // Minute tick — re-render the last good events (fresh `now`) so today's live
    // countdowns stay accurate between the 5-minute data refreshes. Text-only
    // rebuild of ≤3 rows with no images/network, so it's cheap on the kiosk. No-op
    // until the first successful load populates lastEvents.
    ctx.interval(() => { if (lastEvents) render(lastEvents); }, 60 * 1000);
  },
};
