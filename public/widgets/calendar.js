// When We're Free — the household's shared "garden calendar". In the Roots app
// (profile page) each member syncs their Google Calendar (private iCal URL) or
// adds busy blocks by hand; the backend merges everyone's busy time and computes
// the next few windows when the household is actually free. This wall widget shows
// those upcoming windows as a calm vertical list.
//
// Reads the localhost read-only /api/house/calendar (same-origin, NOT the external
// proxy). The endpoint returns 200 with empty arrays when there's no data yet, so
// we degrade to a gentle "sync a calendar in Roots" prompt rather than an error.
// Keeps the last good render if a refresh fails.
export default {
  id: 'calendar',
  title: "When We're Free",
  icon: '📅',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    const { tz = 'America/Los_Angeles' } = ctx.config || {};

    ctx.style(`
      .cal { display:flex; flex-direction:column; height:100%; justify-content:center; gap:10px; min-height:0; }
      .cal-sub { display:flex; align-items:center; gap:8px; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.16em; text-transform:uppercase; color:var(--ink-faint); }
      .cal-sub b { color:var(--mint); font-weight:700; }
      .cal-list { display:flex; flex-direction:column; gap:8px; min-height:0; }
      .cal-ev { display:flex; align-items:baseline; gap:11px; min-width:0; }
      .cal-day { flex:0 0 auto; min-width:62px; font-family:var(--font-display); font-weight:700;
        font-size:17px; line-height:1.05;
        background:linear-gradient(120deg,var(--mint),var(--mint-2));
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
      .cal-main { flex:1; min-width:0; display:flex; align-items:baseline; gap:8px; }
      .cal-time { flex:0 0 auto; font-family:var(--font-mono); font-size:13.5px; color:var(--ink); letter-spacing:.01em; }
      .cal-free { flex:1; min-width:0; font-size:12px; color:var(--ink-soft); line-height:1.2;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cal-free.all { color:var(--mint); }
      .cal-msg { font-size:14px; line-height:1.4; color:var(--ink-faint); text-align:center; padding:0 4px; }
      .cal-msg .em { color:var(--mint); }
    `);
    body.classList.add('cal');
    body.appendChild(ctx.loading('checking the calendar…'));

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    // "6:00 PM" → "6pm", "6:30 PM" → "6:30pm"
    const tidy = (d) => fmtTime.format(d).toLowerCase().replace(':00', '').replace(/\s/g, '');
    const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const weekday = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
    const dayLabel = (start) => {
      const now = new Date();
      const k = dayKey(start), today = dayKey(now);
      const tmrw = dayKey(new Date(now.getTime() + 86400000));
      if (k === today) return 'Today';
      if (k === tmrw) return 'Tmrw';
      return weekday(start);
    };

    const msg = (...kids) => body.replaceChildren(h('div', { class: 'cal-msg' }, ...kids));

    const render = async () => {
      let d;
      try {
        const r = await fetch('/api/house/calendar', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        d = await r.json();
      } catch {
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('calendar unavailable'));
        return;
      }
      body.dataset.loaded = '1';

      const members = Array.isArray(d.members) ? d.members : [];
      const windows = (Array.isArray(d.windows) ? d.windows : []).slice(0, 3);
      const connected = members.filter((m) => m.connected !== false).length;

      // Nobody has synced anything yet → invite them into Roots.
      if (!connected) {
        msg('Sync a calendar in Roots ', h('span', { class: 'em' }, '→'), ' to find when everyone is free.');
        return;
      }
      if (!windows.length) {
        msg('No shared free time in the next few days.');
        return;
      }

      const rows = windows.map((w) => {
        const s = new Date(w.start), e = new Date(w.end);
        const total = w.totalCount || connected;
        const free = w.freeCount != null ? w.freeCount : total;
        const all = total > 0 && free >= total;
        const names = Array.isArray(w.freeNames) ? w.freeNames : [];
        const freeText = all ? 'everyone free'
          : names.length ? names.slice(0, 3).join(', ')
          : `${free} of ${total} free`;
        return h('div', { class: 'cal-ev' },
          h('div', { class: 'cal-day' }, dayLabel(s)),
          h('div', { class: 'cal-main' },
            h('div', { class: 'cal-time' }, `${tidy(s)}–${tidy(e)}`),
            h('div', { class: 'cal-free' + (all ? ' all' : '') }, freeText)));
      });

      body.replaceChildren(
        h('div', { class: 'cal-sub' }, 'Shared free time · ', h('b', {}, String(connected)), ' synced'),
        h('div', { class: 'cal-list' }, ...rows));
    };

    ctx.interval(render, 60000);
  },
};
