// Out in SF — a calm concierge line of free events around the city, sourced from
// SF RATS / FunCheap (see /lib/events.js). The full scrollable list lives behind
// the /events command (and opening this card fullscreen).
//
// The card is now HALF width (it shares the bottom band with the Seismic card),
// so the old three-equal-columns strip has become a hierarchy: ONE featured pick
// gets room to breathe over two lines with its venue and a live countdown, and
// two quieter one-liners sit beneath it, each led by its start time. The day and
// the size of the full listing are said ONCE in the heading.
//
// Events happening TODAY carry a live countdown pill ("in 2h 15m" → "on now"),
// updated each minute (a cheap text-only rebuild of the ≤3 shown rows — no images,
// no network), so a glance across the room answers "what can we do tonight?".
import { fetchEvents, TZ, MON } from '/lib/events.js';

export default {
  id: 'sf-events',
  title: 'Out in SF',
  icon: '🎉',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .won { display:flex; flex-direction:column; height:100%; gap:8px; }

      /* Shared heading: the featured pick's day said once, a hairline rule to
         carry the eye across, and the size of the full listing at the far right
         (which is why the card no longer needs a separate footer line). */
      .won-hd { flex:0 0 auto; display:flex; align-items:center; gap:9px;
        font-family:var(--font-mono); font-size:10px; letter-spacing:.13em;
        color:var(--ink-faint); white-space:nowrap; }
      .won-hd .tdy { color:var(--mint); font-weight:700; }
      .won-hd .rule { flex:1; height:1px; background:var(--stroke); min-width:8px; }
      .won-hd .all { opacity:.8; }

      .won-list { flex:1; display:flex; flex-direction:column; gap:7px; min-height:0; }

      /* The featured pick — the one plan the card is actually recommending. */
      .won-feat { flex:0 0 auto; min-width:0; }
      .won-name { font-size:15.5px; font-weight:600; line-height:1.2; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .won-meta { margin-top:4px; display:flex; align-items:center; gap:7px;
        min-width:0; white-space:nowrap; overflow:hidden; }
      .won-place { font-size:11.5px; color:var(--ink-soft); overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; min-width:0; }
      .won-pill { flex:0 0 auto; font-family:var(--font-mono); font-size:9.5px;
        letter-spacing:.04em; font-weight:600; color:var(--mint);
        background:rgba(120,247,176,.12); border:1px solid var(--stroke);
        border-radius:999px; padding:2px 8px; white-space:nowrap; }
      /* interest pill — a quiet gold star + count on the event drawing the biggest
         crowd (relative to today's shown picks), so a glance finds the popular plan.
         Stays hidden on a low-interest day; speaks up only when something's buzzing. */
      .won-pill.hot { color:var(--gold); background:rgba(255,217,138,.12); }
      /* live countdown pill — on events happening TODAY. A future start reads as a
         calm mint "in 2h 15m"; an event under way reads as a warm gold "● on now"
         so the eye finds tonight's live plans first. Text-only, ticks each minute. */
      .won-pill.soon { color:var(--mint); background:rgba(120,247,176,.12); }
      .won-pill.live { color:var(--gold); background:rgba(255,217,138,.16); font-weight:700; }
      .won-pill.live .dot { font-size:7px; vertical-align:1px; margin-right:1px; }
      /* "how soon" pill — a hushed neutral countdown on an UPCOMING (not-today) pick
         ("tomorrow" / "in 5 days" / "in 2 wks"), so a glance answers how far off a
         plan is without parsing the date — the same grounds-a-date-in-lived-time
         idiom the clock, weather and HN feed already use. Quiet and un-tinted so it
         never competes with today's mint/gold live pill. */
      .won-pill.upc { color:var(--ink-soft); background:rgba(255,255,255,.05); }

      /* The two quieter picks — one line each, led by a mono start-time token so
         the evening reads in order. Titles ellipsize rather than clamp: at this
         width a wrapped second line would cost the row below it. */
      .won-also { flex:0 0 auto; display:flex; align-items:baseline; gap:9px; min-width:0; }
      .won-when { flex:0 0 42px; font-family:var(--font-mono); font-size:9.5px;
        letter-spacing:.04em; color:var(--ink-faint); text-align:right; }
      .won-when.now { color:var(--mint); font-weight:600; }
      .won-also .t { flex:1; min-width:0; font-size:12.5px; line-height:1.25;
        color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

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

    // Compact clock label for the wall: "7:00 PM" → "7p", "7:30 PM" → "7:30p".
    const shortTime = (when) => timeFmt.format(when)
      .replace(/:00\s/, ' ')
      .replace(/\s?AM$/, 'a').replace(/\s?PM$/, 'p')
      .replace(/\s+/g, '');

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
    // date in lived time at a glance ("tomorrow" / "in 5 days" / "in 2 wks").
    // Returns the label string or null (today / past / undated), so the pill simply
    // hides when there's nothing to say.
    const relWhen = (when, isToday) => {
      if (!when || isNaN(when) || isToday) return null;
      const days = dayOffset(when);
      if (days == null || days <= 0) return null;
      if (days === 1) return 'tomorrow';
      if (days < 7) return `in ${days} days`;
      const wk = Math.round(days / 7);
      return wk <= 1 ? 'next week' : `in ${wk} wks`;
    };

    // The heading: a mint "TODAY" / "TOMORROW" (or bare date) for the featured
    // pick's day, then the written date, then the size of the full listing.
    const dayHead = (when) => {
      const diff = dayOffset(when);
      if (diff == null) return ['SOON', ''];
      const wd = wdayFmt.format(when).toUpperCase();
      const dm = `${wd} ${when.getDate()} ${MON[when.getMonth()]}`;
      return [diff <= 0 ? 'TODAY' : (diff === 1 ? 'TOMORROW' : null), dm];
    };

    // The one-line token leading a quieter pick: its start time when it has one,
    // its day when that differs from the heading's, else a hushed bullet.
    const alsoToken = (e, headDay) => {
      const off = dayOffset(e.when);
      if (off != null && off !== headDay) {
        if (off === 1) return { txt: 'TMRW', now: false };
        if (off > 1) return { txt: `${e.when.getDate()} ${MON[e.when.getMonth()]}`, now: false };
      }
      if (e.when && !e.allDay && !isNaN(e.when)) {
        return { txt: shortTime(e.when), now: off != null && off <= 0 };
      }
      return { txt: '·', now: false };
    };

    const head = ctx.h('div', { class: 'won-hd', style: 'display:none' });
    const list = ctx.h('div', { class: 'won-list' });
    body.replaceChildren(ctx.h('div', { class: 'won' }, head, list));

    const render = (evs) => {
      const all = evs || [];
      const picks = all.slice(0, 3);
      if (!picks.length) {
        head.style.display = 'none';
        list.replaceChildren(ctx.h('div', { class: 'won-empty' }, 'No upcoming events right now'));
        return;
      }

      const feat = picks[0];
      const [cap, dm] = dayHead(feat.when);
      head.replaceChildren(
        cap ? ctx.h('span', { class: 'tdy' }, cap) : null,
        dm ? ctx.h('span', {}, dm) : null,
        ctx.h('span', { class: 'rule' }),
        ctx.h('span', { class: 'all' }, all.length > 1 ? `${all.length} FREE` : '1 FREE'));
      head.style.display = '';

      // How busy is the busiest shown event? The interest star is surfaced only for
      // the featured pick and only when it's near that peak, so the flag reads as
      // "this is one of the popular ones" rather than decorating every row.
      const maxInterest = Math.max(0, ...picks.map((e) => (Number.isFinite(e.interest) ? e.interest : 0)));
      const featInterest = Number.isFinite(feat.interest) ? feat.interest : 0;

      const isToday = (e) => { const o = dayOffset(e.when); return o != null && o <= 0; };
      const featToday = isToday(feat);
      const live = liveCountdown(feat.when, feat.allDay, featToday);
      const rel = !live ? relWhen(feat.when, featToday) : null;
      const time = (feat.when && !feat.allDay && !isNaN(feat.when)) ? shortTime(feat.when) : '';
      const hot = maxInterest >= 8 && featInterest >= Math.max(8, maxInterest * 0.5);

      const metaKids = [
        feat.place ? ctx.h('span', { class: 'won-place' }, `📍 ${feat.place}`) : null,
        live ? ctx.h('span', {
          class: `won-pill ${live.cls}`,
          title: live.cls === 'live' ? 'happening now' : `starts ${timeFmt.format(feat.when)}`,
        }, ...(live.cls === 'live' ? [ctx.h('span', { class: 'dot' }, '●'), ' on now'] : [live.txt])) : null,
        rel ? ctx.h('span', {
          class: 'won-pill upc',
          title: feat.when ? `starts ${feat.when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })}` : '',
        }, rel) : null,
        time ? ctx.h('span', { class: 'won-pill' }, time) : null,
        hot ? ctx.h('span', { class: 'won-pill hot', title: `${featInterest} people interested` }, `★ ${featInterest}`) : null,
      ].filter(Boolean);

      const headDay = dayOffset(feat.when);
      const also = picks.slice(1).map((e) => {
        const tok = alsoToken(e, headDay);
        return ctx.h('div', { class: 'won-also' },
          ctx.h('div', { class: `won-when${tok.now ? ' now' : ''}` }, tok.txt),
          ctx.h('div', { class: 't', title: e.name }, `${e.emoji ? e.emoji + ' ' : ''}${e.name}`));
      });

      list.replaceChildren(
        ctx.h('div', { class: 'won-feat' },
          ctx.h('div', { class: 'won-name', title: feat.name }, `${feat.emoji ? feat.emoji + ' ' : ''}${feat.name}`),
          metaKids.length ? ctx.h('div', { class: 'won-meta' }, ...metaKids) : null),
        ...also);
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
    // rebuild of ≤3 rows with no images/network, so it's cheap on the kiosk. No-op
    // until the first successful load populates lastEvents.
    ctx.interval(() => { if (lastEvents) render(lastEvents); }, 60 * 1000);
  },
};
