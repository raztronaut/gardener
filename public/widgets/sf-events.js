// Out in SF — a calm concierge line of free events around the city, sourced from
// SF RATS / FunCheap (see /lib/events.js). The full scrollable list lives behind
// the /events command (and opening this card fullscreen).
//
// The card is TALL (half width, two rows) and reads like a day agenda: every
// event today: timed plans first beside a fixed time column, then all-day listings
// full-width under one "ALL DAY" sub-heading — the full event
// name over up to two lines, and its venue beneath. As many as fit are shown;
// overflow rows are trimmed, never clipped. With nothing left today it falls
// back to the next upcoming events. On a light day, the room left under today's
// rows carries on into the coming days under small "TOMORROW · TUE" headings.
// There, an all-day listing keeps the time column (a hushed "all day") so names
// line up with the timed rows, and leftover height is shared out as row spacing.
//
// Each row carries a small picture of the event (its page's og:image, cropped and
// cached server-side by /api/event-image): the box is always reserved, the picture
// fades in once decoded, and an event without one keeps a quiet empty box.
//
// One-off events earn the card's slots first. Recurring listings (lib/events.js
// recurrence(): the Japanese Tea Garden's free hour, "every Thursday" karaoke,
// weekly markets) rank after them, and an ALL-DAY recurring listing is only kept
// when today's one-offs AND the coming days' one-offs leave room for it.
//
// Events happening TODAY carry a live countdown pill ("in 2h 15m" → "on now"),
// updated each minute (a cheap text-only rebuild of the ≤3 shown rows — no images,
// no network), so a glance across the room answers "what can we do tonight?".
import { fetchEvents, splitTitle, localeRank, shortNames, TZ, MON } from '/lib/events.js';

export default {
  id: 'sf-events',
  title: 'Out in SF',
  icon: '🎉',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .won { display:flex; flex-direction:column; height:100%; gap:8px; }

      /* Heading: the day in words — "Tonight" / "Today" / "Tomorrow" in the title face,
         the date beside it. (The event count and its hairline were removed
         2026-10-30: the humans found that line noisy.) */
      .won-hd { flex:0 0 auto; display:flex; align-items:baseline; gap:10px; white-space:nowrap; margin-bottom:2px; }
      .won-hd .tdy { font-family:var(--font-display); font-size:24px; line-height:1; color:var(--mint); }
      .won-hd .dt { font-size:15px; color:var(--ink-soft); overflow:hidden; text-overflow:ellipsis; }

      .won-list { --sp:9px; flex:1 1 0; display:flex; flex-direction:column; gap:var(--sp); min-height:0; overflow:hidden; }

      /* Agenda rows — the readable day view: a fixed time column, then the full
         event name over up to two lines with its venue beneath. */
      .won-ag { flex:0 0 auto; display:grid; grid-template-columns:60px 62px 1fr; column-gap:12px; min-width:0;
        align-items:center; padding-bottom:var(--sp); border-bottom:1px solid var(--stroke); }
      /* The picture box: always reserved (same size with or without a picture), a
         quiet tint when empty; the picture only fades in once decoded. */
      .won-ag .th { width:60px; height:40px; border-radius:8px; overflow:hidden; background:rgba(255,255,255,.045); }
      .won-ag .th img { display:block; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .6s ease; }
      .won-ag .th img.on { opacity:1; }
      .won-ag:last-child { border-bottom:none; }
      /* All-day listings: no time column (it only ever held an empty cell or a
         repeated label) — the name takes the full width under one small
         "ALL DAY" sub-heading, so the group reads as "also on today". */
      .won-ag.wide { grid-template-columns:60px 1fr; }
      /* sub-headings: "Top 3" (today's all-day picks), then the coming days */
      .won-sub { flex:0 0 auto; display:flex; align-items:center; gap:9px; margin-top:2px;
        font-size:13.5px; font-weight:600; letter-spacing:.02em;
        color:var(--ink-soft); white-space:nowrap; }
      .won-sub.later { margin-top:6px; color:var(--mint); opacity:.9; }
      .won-sub .rule { flex:1; height:1px; background:var(--stroke); min-width:8px; }
      .won-ag.wide .nm { font-size:14px; }
      .won-ag.pre { border-bottom:none; }
      .won-ag .tm { font-family:var(--font-mono); font-size:13px; font-weight:600; color:var(--ink);
        letter-spacing:.02em; padding-top:2px; white-space:nowrap; }
      .won-ag .tm .lv { display:block; margin-top:4px; font-size:11.5px; font-weight:700; color:var(--gold); letter-spacing:.04em; }
      .won-ag .tm .lv.soon { color:var(--mint); font-weight:600; }
      /* Same start time as the row above: the time is said once — repeats fade to
         a hushed echo and drop their countdown, so three "5 PM · in 11h"
         stacks read as one group instead of a stutter. */
      .won-ag.dup .tm { color:var(--ink-faint); font-weight:500; }
      .won-ag .tm.ad { color:var(--ink-faint); font-weight:500; }
      .won-ag.dup .tm .lv { display:none; }
      .won-ag { cursor:var(--c-hand); }
      .won-ag .nm { font-size:14.5px; font-weight:600; line-height:1.25; color:var(--ink); min-width:0;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } /* one line, always */
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
    const longFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });
    const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });

    // Whole-day offset from today, read in SF time so it rolls over cleanly at
    // local midnight. 0 = today, 1 = tomorrow, negative = already begun.
    const dayOffset = (when) => (when && !isNaN(when)
      ? Math.round((new Date(dayKeyFmt.format(when) + 'T00:00:00') - startOfToday) / dayMs)
      : null);

    // Live countdown for a today-event's start. Future → a calm "in 11h" /
    // "in 2h 15m" / "in 40m"; under way (start passed, but the events lib's 2h grace keeps it in
    // the list) → a warm "on now". Returns { txt, cls } or null when not applicable.
    const liveCountdown = (when, allDay, isToday) => {
      if (!isToday || allDay || !when || isNaN(when)) return null;
      const mins = Math.round((when.getTime() - Date.now()) / 60000);
      if (mins >= 1) {
        if (mins < 60) return { txt: `in ${mins}m`, cls: 'soon' };
        // Far-off starts round to whole hours ("in 11h", not "in 10h 58m"):
        // minute precision half a day out is noise from across the room and
        // made every row tick. Within 3h the exact "2h 15m" earns its keep.
        if (mins >= 180) return { txt: `in ${Math.round(mins / 60)}h`, cls: 'soon' };
        const h = Math.floor(mins / 60), m = mins % 60;
        return { txt: m ? `in ${h}h ${m}m` : `in ${h}h`, cls: 'soon' };
      }
      return { txt: 'on now', cls: 'live' };
    };

    // Event pictures, kept across re-renders (the minute tick rebuilds every row) so a
    // picture loads and fades in once, never again each minute. 404 → stays empty.
    const thumbs = new Map();
    const thumbFor = (e) => {
      const k = e.url || e.image;
      if (!k) return null;
      let img = thumbs.get(k);
      if (!img) {
        img = new Image();
        img.alt = ''; img.decoding = 'async'; img.draggable = false;
        img.onload = () => Promise.resolve(img.decode ? img.decode() : null).catch(() => {}).then(() => img.classList.add('on'));
        img.onerror = () => { img.dataset.none = '1'; img.remove(); };
        img.src = `/api/event-image?u=${encodeURIComponent(e.url || e.image)}${e.image ? `&img=${encodeURIComponent(e.image)}` : ''}`;
        thumbs.set(k, img);
      }
      return img.dataset.none ? null : img;
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
      const evening = parseInt(hourFmt.format(new Date()), 10) >= 17;
      const cap = showingToday ? (evening ? 'Tonight' : 'Today') : (dayOffset(first.when) === 1 ? 'Tomorrow' : 'Coming up');
      const dm = first.when && !isNaN(first.when) ? longFmt.format(first.when) : '';
      head.replaceChildren(
        ctx.h('span', { class: 'tdy' }, cap),
        dm ? ctx.h('span', { class: 'dt' }, dm) : null);
      head.style.display = '';

      const makeRow = (e) => {
        const isT = (() => { const o = dayOffset(e.when); return o != null && o <= 0; })();
        const live = liveCountdown(e.when, e.allDay, isT);
        // Tidy the scraped title: its trailing "(SF)" / "(2026)" / "(7p + 9p)" /
        // "(Yerba Buena Gardens)" tags move to the time column and venue line.
        const t = splitTitle(e.name);
        // Street addresses arrive in full ("1310 Haight Street, San Francisco, CA
        // 94117"); on an SF card the city/state/ZIP tail is noise, so drop it.
        // Feeds vary: "2825 Diamond Street San Francisco , CA 94131 United States"
        // (stray space before the comma, no comma before the city, a country tail).
        const place = String(e.place || '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ')
          .replace(/,?\s*(United States( of America)?|USA|US)\.?\s*$/i, '')
          .replace(/,?\s*(San Francisco,?\s*)?CA,?\s*(\d{5}(-\d{4})?)?\s*$/i, '')
          .replace(/,?\s*San Francisco\s*$/i, '').replace(/[,\s]+$/, '').trim()
          // House style is the short form ("3349 20th St"), so match it after a number.
          .replace(/(\b\d+[A-Z]?\s+[^,\s][^,]*?\s)(Street|Avenue|Boulevard|Drive|Place)\b\.?/i,
            (_, a, w) => a + ({ street: 'St', avenue: 'Ave', boulevard: 'Blvd', drive: 'Dr', place: 'Pl' })[w.toLowerCase()]);
        const sub = [place || t.where, t.note].filter(Boolean).join(' · ');
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
          // All-day: no time cell — the row goes full width and fit() puts one
          // "ALL DAY" sub-heading above the surviving group.
          tm = null;
        }
        // tap a row → that event's full details (original title, time, place, description)
        const row = ctx.h('div', { class: `won-ag${tm ? '' : ' wide'}`, title: e.name,
          onclick: (ev) => { ev.stopPropagation(); window.dispatchEvent(new CustomEvent('garden:event', { detail: e })); } },
          ctx.h('div', { class: 'th' }, thumbFor(e)),
          tm,
          ctx.h('div', { style: 'min-width:0' },
            ctx.h('div', { class: 'nm' }, short[e.name] || t.name || e.name), // the plain short name (eventnames.mjs)
            sub ? ctx.h('div', { class: 'pl' }, sub) : null));
        // Which rows earn the card's few slots: ONE-OFF events first (a recurring
        // listing will be there next week too; monthly ones sit between), then
        // tonight's TIMED plans (they
        // are what "what can we do tonight?" is really asking, and sorting all-day
        // listings ahead of them used to trim every timed event off the card),
        // then San Francisco over unstated over elsewhere-in-the-Bay. Survivors
        // are still SHOWN chronologically — this only decides who is kept.
        const tier = !e.recur ? 0 : e.recur.kind === 'monthly' ? 1 : 2;
        const pr = tier * 10 + (timed(e) || t.time ? 0 : 3) + localeRank(e);
        const tkey = tm ? tm.firstChild && tm.firstChild.textContent : null;
        // an all-day recurring listing is filler: kept only if everything else fits
        return { el: row, allDay: !tm, pr, tkey, filler: !tm && !!e.recur };
      };
      rows = picks.map(makeRow);
      rows.forEach((r, i) => { r.idx = i; });
      // A light day leaves the tall card mostly empty — so after today's plans
      // the agenda carries on into the next days, each under a small day
      // sub-heading ("TOMORROW", "WED 21 OCT"). fit() only appends these while
      // they fit, chronologically, after every one of today's rows is kept.
      later = [];
      if (showingToday) {
        const ahead = all.filter((e) => { const o = dayOffset(e.when); return o != null && o >= 1 && !e.recur; })
          .sort((x, y) => x.when - y.when).slice(0, 14);
        ahead.forEach((e) => {
          const o = dayOffset(e.when);
          const label = o === 1 ? `Tomorrow · ${wdayFmt.format(e.when)}`
            : `${wdayFmt.format(e.when)}, ${MON[e.when.getMonth()]} ${e.when.getDate()}`;
          const r = makeRow(e);
          // In a coming-day group, an all-day listing sits among timed rows: keep
          // the time column (a hushed "all day") so every name starts on one line.
          if (r.allDay) {
            r.el.classList.remove('wide');
            r.el.insertBefore(ctx.h('div', { class: 'tm ad' }, 'all day'), r.el.children[1]);
          }
          later.push({ ...r, label });
        });
      }
      // forget pictures of events no longer listed
      const live = new Set(all.map((e) => e.url || e.image));
      for (const k of thumbs.keys()) if (!live.has(k)) thumbs.delete(k);
      fit();
    };

    // Fit: keep as many rows as fit, chosen by priority (timed tonight → SF →
    // elsewhere) rather than by trimming the chronological tail. Re-run whenever the card's height changes — the grid settles as
    // neighbouring widgets load, and fitting only once (against an early, shorter
    // card) used to strand the list at 3–4 rows above a tall empty gap.
    let rows = [];
    let later = [];
    const fit = () => {
      if (!rows.length) return;
      list.style.removeProperty('--sp');
      // Grow the kept set in priority order (stable on ties) until the next row
      // would overflow, laying the survivors out chronologically each time.
      const order = (a, b) => a.pr - b.pr || a.idx - b.idx;
      const core = rows.filter((r) => !r.filler).sort(order);
      const filler = rows.filter((r) => r.filler).sort(order);
      const fits = () => list.scrollHeight <= list.clientHeight + 1;
      const show = (set, ext = []) => {
        // Tonight's timed plans lead (chronological); the all-day group follows
        // under its own sub-heading.
        const kept = set.slice().sort((a, b) => (a.allDay - b.allDay) || a.idx - b.idx);
        const els = [];
        kept.forEach((r, i) => {
          // The row just above the sub-heading drops its rule (the heading
          // carries its own), so the hairlines never double up.
          const next = kept[i + 1];
          r.el.classList.toggle('pre', !r.allDay && !!next && next.allDay);
          const prevR = kept[i - 1];
          r.el.classList.toggle('dup', !r.allDay && !!r.tkey && !!prevR && !prevR.allDay && prevR.tkey === r.tkey);
          if (r.allDay && (i === 0 || !kept[i - 1].allDay)) {
            // "Top 3" — the day's best all-day picks (fewer kept → "Top 2" / "Top 1")
            els.push(ctx.h('div', { class: 'won-sub' }, `Top ${kept.filter((k) => k.allDay).length}`, ctx.h('span', { class: 'rule' })));
          }
          els.push(r.el);
        });
        if (ext.length && kept.length) kept[kept.length - 1].el.classList.add('pre');
        ext.forEach((r, i) => {
          r.el.classList.remove('pre', 'dup');
          const prevR = ext[i - 1];
          if (!prevR || prevR.label !== r.label) {
            els.push(ctx.h('div', { class: 'won-sub later' }, r.label, ctx.h('span', { class: 'rule' })));
          }
          const nextR = ext[i + 1];
          if (nextR && nextR.label !== r.label) r.el.classList.add('pre');
          else if (!r.allDay && r.tkey && prevR && prevR.label === r.label && !prevR.allDay && prevR.tkey === r.tkey) r.el.classList.add('dup');
          els.push(r.el);
        });
        list.replaceChildren(...els);
      };
      // Greedy in priority order: a row that would overflow is skipped (not a
      // full stop), so a shorter, lower-priority listing can still use the
      // space a long two-line title couldn't.
      // at most TOP all-day picks for the day (its "Top 3"); the rest stay in /events
      const TOP = 3;
      const full = (set) => set.filter((k) => k.allDay).length >= TOP;
      const seed = core[0] || filler[0];
      let kept = [seed];
      for (const r of core) { r.capped = false; }
      for (const r of core) {
        if (r === seed) continue;
        if (r.allDay && full(kept)) { r.capped = true; continue; }
        show([...kept, r]);
        if (fits()) kept.push(r);
      }
      // Every one of today's (non-filler) rows fit → carry on into the coming
      // days' one-off events while there's room, chronologically; a row too tall
      // to fit is skipped so a shorter one can take the space.
      let ext = [];
      if (core.every((r) => kept.includes(r) || r.capped) && later.length) {
        for (const r of later) {
          show(kept, [...ext, r]);
          if (fits()) ext.push(r);
        }
      }
      // Today's all-day recurring listings only take whatever room is left.
      for (const r of filler) {
        if (r === seed || full(kept)) continue;
        show([...kept, r], ext);
        if (fits()) kept.push(r);
      }
      show(kept, ext);
      // When rows were trimmed, share the leftover height out as extra spacing
      // between the survivors (gap + rule padding), so the agenda fills the card
      // to its foot instead of stopping short above an empty band.
      const n = list.querySelectorAll('.won-ag').length;
      if (n > 1 && n < rows.length + later.length) {
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
    let short = {}; // plain short names for the titles (server-side Claude Haiku, daily)
    const refresh = async () => {
      const evs = await fetchEvents(ctx.fetchJSON); lastEvents = evs;
      try { short = await shortNames(evs); } catch { /* original titles */ }
      render(evs);
    };

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
