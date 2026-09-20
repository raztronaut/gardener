// Out in SF — a calm list of upcoming free events around the city, sourced from
// SF RATS / FunCheap (see /lib/events.js). The full scrollable list lives behind
// the /events command (and opening this card fullscreen).
//
// Events happening TODAY carry a live countdown pill ("in 2h 15m" → "on now"),
// updated each minute (a cheap text-only rebuild of the ≤6 shown rows — no images,
// no network), so a glance across the room answers "what can we do tonight?".
import { fetchEvents, TZ, MON } from '/lib/events.js';

export default {
  id: 'sf-events',
  title: 'Out in SF',
  icon: '🎉',
  size: 'wide',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .won { display:flex; flex-direction:column; gap:10px; height:100%; }
      /* full-width single-row strip → three upcoming events side by side, so the
         bottom band reads as a calm "what's on tonight" concierge line beside the
         transit board above it. Vertical rules separate the columns. */
      .won-list { flex:1; display:grid; grid-template-columns:repeat(3,minmax(0,1fr));
        gap:0 26px; min-height:0; }
      .won-ev { display:flex; gap:12px; align-items:center;
        padding-right:26px; border-right:1px solid var(--stroke); min-width:0; min-height:0; }
      /* drop the rule after the last column */
      .won-ev:last-child { border-right:none; padding-right:0; }
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
      .won-name { font-size:17.5px; font-weight:600; line-height:1.24; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .won-meta { margin-top:5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .won-place { font-size:12.5px; color:var(--ink-soft); overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; max-width:62%; }
      .won-pill { font-family:var(--font-mono); font-size:10.5px; letter-spacing:.04em; font-weight:600;
        color:var(--mint); background:rgba(120,247,176,.12); border:1px solid var(--stroke);
        border-radius:999px; padding:2px 9px; white-space:nowrap; }
      /* interest pill — a quiet gold star + count on the events drawing the biggest
         crowd (relative to today's shown picks), so a glance finds the popular plans.
         Stays hidden on a low-interest day; speaks up only when something's buzzing. */
      .won-pill.hot { color:var(--gold); background:rgba(255,217,138,.12); }
      /* live countdown pill — on events happening TODAY. A future start reads as a
         calm mint "in 2h 15m"; an event under way reads as a warm gold "● on now"
         so the eye finds tonight's live plans first. Text-only, ticks each minute. */
      .won-pill.soon { color:var(--mint); background:rgba(120,247,176,.12); }
      .won-pill.live { color:var(--gold); background:rgba(255,217,138,.16); font-weight:700; }
      .won-pill.live .dot { font-size:8px; vertical-align:1px; margin-right:1px; }
      /* "how soon" pill — a hushed neutral countdown on UPCOMING (not-today) events
         ("tomorrow" / "in 5 days" / "in 2 wks"), so a glance answers how far off a
         plan is without parsing the date column — the same grounds-a-date-in-lived-
         time idiom the clock, weather and HN feed already use. Quiet and un-tinted so
         it never competes with today's mint/gold live pill; sits on the existing meta
         line, so it adds no height and can't clip. */
      .won-pill.upc { color:var(--ink-soft); background:rgba(255,255,255,.05); }
      .won-empty { grid-column:1/-1; flex:1; display:flex; align-items:center; justify-content:center; text-align:center;
        color:var(--ink-faint); font-size:13px; padding:0 10px; }
      .won-foot { flex:0 0 auto; text-align:center; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.08em; color:var(--ink-faint); padding-top:2px; }

      /* Shared day heading. Now that the city's listings actually arrive in
         chronological order, all three picks usually fall on the SAME day — and
         three identical "Today" blocks were three wasted inches of a card whose
         titles were being clamped to "SF's Chinatown "Autumn Moon…". Say the day
         ONCE here, hand the whole column width back to the event names, and let
         them breathe over three lines. A hairline rule carries the eye across. */
      .won-hd { flex:0 0 auto; display:flex; align-items:center; gap:10px;
        font-family:var(--font-mono); font-size:10.5px; letter-spacing:.14em;
        color:var(--ink-faint); }
      .won-hd .tdy { color:var(--mint); font-weight:700; }
      .won-hd .rule { flex:1; height:1px; background:var(--stroke); }
      /* day-less rows: the name owns the full column and may run to three lines. */
      .won-list.oneday .won-name { -webkit-line-clamp:3; font-size:18px; }
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

    // A compact "how soon" phrase for an UPCOMING (not-today) event, grounding the
    // date column in lived time at a glance ("tomorrow" / "in 5 days" / "in 2 wks").
    // Whole-day diff read in SF time, so it rolls over cleanly at local midnight.
    // Returns the label string or null (today / past / undated), so the pill simply
    // hides when there's nothing to say.
    const relWhen = (when, isToday) => {
      if (!when || isNaN(when) || isToday) return null;
      const days = Math.round((new Date(dayKeyFmt.format(when) + 'T00:00:00') - startOfToday) / dayMs);
      if (days <= 0) return null;
      if (days === 1) return 'tomorrow';
      if (days < 7) return `in ${days} days`;
      const wk = Math.round(days / 7);
      return wk <= 1 ? 'next week' : `in ${wk} wks`;
    };

    // The shared day heading shown when every pick falls on one day: a mint
    // "TODAY" (or "TOMORROW") followed by the written date, then a hairline rule.
    const dayHead = (when) => {
      const diff = Math.round((new Date(dayKeyFmt.format(when) + 'T00:00:00') - startOfToday) / dayMs);
      const wd = wdayFmt.format(when).toUpperCase();
      const dm = `${wd} ${when.getDate()} ${MON[when.getMonth()]}`;
      const cap = diff <= 0 ? 'TODAY' : (diff === 1 ? 'TOMORROW' : null);
      return [cap, cap ? dm : dm];
    };

    const head = ctx.h('div', { class: 'won-hd', style: 'display:none' });
    const list = ctx.h('div', { class: 'won-list' });
    const foot = ctx.h('div', { class: 'won-foot', style: 'display:none' });
    body.replaceChildren(ctx.h('div', { class: 'won' }, head, list, foot));

    const render = (evs) => {
      const all = evs || [];
      const picks = all.slice(0, 3);
      if (!picks.length) { foot.style.display = 'none'; head.style.display = 'none'; list.classList.remove('oneday'); list.replaceChildren(ctx.h('div', { class: 'won-empty' }, 'No upcoming events right now')); return; }

      // Do all the picks share a single day? Then the per-row date column is pure
      // repetition — hoist it into one heading and drop the columns.
      const keys = picks.map((e) => (e.when && !isNaN(e.when) ? dayKeyFmt.format(e.when) : null));
      const oneDay = !!keys[0] && keys.every((k) => k === keys[0]);
      list.classList.toggle('oneday', oneDay);
      if (oneDay) {
        const [cap, dm] = dayHead(picks[0].when);
        head.replaceChildren(
          cap ? ctx.h('span', { class: 'tdy' }, cap) : null,
          ctx.h('span', {}, dm),
          ctx.h('span', { class: 'rule' }));
        head.style.display = '';
      } else {
        head.style.display = 'none';
      }
      // How busy is the busiest shown event? The interest star is surfaced only for
      // events near that peak (and above a small floor), so the flag reads as "one
      // of the popular ones" — quiet when nothing's buzzing, informative when it is.
      const maxInterest = Math.max(0, ...picks.map((e) => (Number.isFinite(e.interest) ? e.interest : 0)));
      const hotFloor = Math.max(8, Math.round(maxInterest * 0.5));
      list.replaceChildren(...picks.map((e) => {
        const isToday = e.when && Math.round((new Date(dayKeyFmt.format(e.when) + 'T00:00:00') - startOfToday) / dayMs) <= 0;
        // With the date column hoisted into the shared heading, a timed event has
        // nowhere else to show its clock time — so surface it on the meta line.
        const time = (e.when && !e.allDay && (oneDay || !isToday)) ? timeFmt.format(e.when).replace(' ', '') : '';
        // A live "in 2h 15m" / "on now" pill for today's timed events, so tonight's
        // plans read at a glance (the date column already shows the clock time).
        const live = liveCountdown(e.when, e.allDay, isToday);
        // "how soon" cue for upcoming (not-today) events — shown only when there's no
        // live today-countdown to defer to, so the two never both appear on one row.
        const rel = !live ? relWhen(e.when, isToday) : null;
        const interest = Number.isFinite(e.interest) ? e.interest : 0;
        const hot = maxInterest > 0 && interest >= hotFloor;
        return ctx.h('div', { class: 'won-ev' },
          oneDay ? null : dateCol(e.when, e.allDay),
          ctx.h('div', { class: 'won-main' },
            ctx.h('div', { class: 'won-name' }, `${e.emoji ? e.emoji + ' ' : ''}${e.name}`),
            (e.place || time || live || rel || hot) ? ctx.h('div', { class: 'won-meta' },
              e.place ? ctx.h('span', { class: 'won-place' }, `📍 ${e.place}`) : null,
              live ? ctx.h('span', {
                class: `won-pill ${live.cls}`,
                title: live.cls === 'live' ? 'happening now' : `starts ${timeFmt.format(e.when)}`,
              }, ...(live.cls === 'live' ? [ctx.h('span', { class: 'dot' }, '●'), ' on now'] : [live.txt])) : null,
              rel ? ctx.h('span', {
                class: 'won-pill upc',
                title: e.when ? `starts ${e.when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })}` : '',
              }, rel) : null,
              time ? ctx.h('span', { class: 'won-pill' }, time) : null,
              hot ? ctx.h('span', {
                class: 'won-pill hot',
                title: `${interest} people interested`,
              }, `★ ${interest}`) : null) : null));
      }));
      foot.textContent = all.length > picks.length ? `+ more — tap for all ${all.length} events` : 'tap for the full list';
      foot.style.display = '';
    };

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
    // rebuild of ≤6 rows with no images/network, so it's cheap on the kiosk. No-op
    // until the first successful load populates lastEvents.
    ctx.interval(() => { if (lastEvents) render(lastEvents); }, 60 * 1000);
  },
};
