// When We're Free — the household's shared "garden calendar", promoted to a tall
// MAIN widget. In the Roots app (You page) each member connects their real Google
// Calendar (OAuth, browser-side freeBusy → busy intervals) or adds busy blocks by
// hand; the backend merges everyone's busy time and computes the next windows when
// the household is actually free.
//
// This wall widget shows the household roster as avatars (real photos when set,
// colored-initial bubbles otherwise), a big "next free window" hero, and a calm
// vertical list of upcoming windows — each with the avatars of who's free.
//
// Reads the localhost read-only /api/house/calendar (same-origin, NOT the external
// proxy). The endpoint returns 200 with empty arrays when there's no data yet, so
// we degrade to a gentle "sync a calendar in Roots" prompt rather than an error.
// Each window carries freeIds (preferred) / freeNames so we can map to avatars.
// Keeps the last good render if a refresh fails.
const PALETTE = ['#74f7b0', '#74c0f7', '#f7b074', '#c074f7', '#f77498', '#74f7e0', '#f7d774', '#9c8cf7'];
const colorFor = (key) => {
  let h = 0;
  const s = String(key || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initialOf = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

export default {
  id: 'calendar',
  title: "When We're Free",
  icon: '📅',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    const { tz = 'America/Los_Angeles' } = ctx.config || {};

    ctx.style(`
      .cal { display:flex; flex-direction:column; height:100%; gap:9px; min-height:0; }

      /* household roster strip */
      .cal-roster { display:flex; align-items:center; gap:10px; flex:0 0 auto; }
      .cal-roster .lbl { font-family:var(--font-mono); font-size:9.5px; letter-spacing:.15em;
        text-transform:uppercase; color:var(--ink-faint); flex:0 0 auto; }
      .cal-faces { display:flex; align-items:center; }
      .cal-faces .av { margin-left:-7px; }
      .cal-faces .av:first-child { margin-left:0; }
      .cal-roster .synced { margin-left:auto; flex:0 0 auto; font-family:var(--font-mono);
        font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint); }
      .cal-roster .synced b { color:var(--mint); font-weight:700; }

      /* a circular avatar (photo over a colored-initial fallback) */
      .av { position:relative; border-radius:50%; flex:0 0 auto; overflow:hidden;
        display:flex; align-items:center; justify-content:center; color:#0b0f0d; font-weight:800;
        font-family:var(--font-display); box-shadow:0 1px 4px rgba(0,0,0,.45);
        border:2px solid var(--bg-1); }
      .av.dim { opacity:.4; filter:grayscale(.5); }
      .av img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }

      .cal-div { height:1px; background:var(--stroke); flex:0 0 auto; }

      /* hero — the next free window */
      .cal-hero { display:flex; flex-direction:column; gap:7px; flex:0 0 auto; }
      .cal-hero .top { display:flex; align-items:baseline; gap:10px; min-width:0; }
      .cal-hero .day { font-family:var(--font-display); font-weight:800; font-size:27px; line-height:1;
        background:linear-gradient(120deg,var(--mint),var(--mint-2));
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; flex:0 0 auto; }
      .cal-hero .time { font-family:var(--font-mono); font-size:15px; color:var(--ink-soft); letter-spacing:.01em;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cal-hero .who { display:flex; align-items:center; gap:10px; }
      .cal-hero .who .tag { font-size:14px; font-weight:700; color:var(--mint); white-space:nowrap; }
      .cal-hero .who .tag.some { color:var(--ink-soft); font-weight:600; }

      /* upcoming list — flexes to fill the tall card; rows share the height evenly */
      .cal-list { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
      .cal-up { font-family:var(--font-mono); font-size:9px; letter-spacing:.16em; text-transform:uppercase;
        color:var(--ink-faint); flex:0 0 auto; margin-bottom:2px; }
      .cal-ev { display:flex; align-items:center; gap:9px; min-width:0; flex:1 1 0; min-height:0;
        border-top:1px solid var(--stroke); }
      .cal-ev .day { flex:0 0 40px; font-family:var(--font-display); font-weight:700; font-size:14px;
        color:var(--ink); line-height:1; }
      .cal-ev .time { flex:0 0 auto; font-family:var(--font-mono); font-size:11px; color:var(--ink-soft);
        white-space:nowrap; }
      /* availability bar — how much of the household is free in this window */
      .cal-bar { flex:1 1 auto; height:6px; min-width:24px; border-radius:3px; background:var(--stroke);
        overflow:hidden; }
      .cal-bar > i { display:block; height:100%; border-radius:3px;
        background:linear-gradient(90deg,var(--mint-2),var(--mint)); }
      .cal-bar.all > i { background:linear-gradient(90deg,var(--mint),var(--mint)); }
      .cal-ev .faces { display:flex; flex:0 0 auto; }
      .cal-ev .faces .av { margin-left:-7px; }
      .cal-ev .faces .av:first-child { margin-left:0; }
      .cal-ev .free { flex:0 0 auto; font-size:11px; color:var(--ink-faint); min-width:34px; text-align:right;
        white-space:nowrap; }
      .cal-ev .free.all { color:var(--mint); font-weight:700; }

      .cal-msg { font-size:15px; line-height:1.5; color:var(--ink-soft); }
      .cal-msg .em { color:var(--mint); font-weight:700; }
    `);
    body.classList.add('cal');
    body.appendChild(ctx.loading('checking the calendar…'));

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
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

    // One avatar bubble: colored-initial fallback, with a real photo layered on
    // top when available (photo failures fall back to the initial underneath).
    const avatar = (m, px, { dim = false } = {}) => {
      const el = h('div', {
        class: 'av' + (dim ? ' dim' : ''),
        title: m.name || '',
        style: { width: px + 'px', height: px + 'px', fontSize: Math.round(px * 0.42) + 'px',
          background: colorFor(m.id || m.name) },
      }, initialOf(m.name));
      if (m.avatarUrl) {
        const img = h('img', { src: m.avatarUrl, alt: '', loading: 'lazy' });
        img.addEventListener('error', () => img.remove());
        el.appendChild(img);
      }
      return el;
    };

    const facesOf = (list, px, max = 5) => {
      const shown = list.slice(0, max);
      const kids = shown.map((m) => avatar(m, px));
      if (list.length > max) {
        kids.push(h('div', {
          class: 'av',
          style: { width: px + 'px', height: px + 'px', fontSize: Math.round(px * 0.36) + 'px',
            background: 'var(--glass)', color: 'var(--ink-soft)' },
        }, '+' + (list.length - max)));
      }
      return h('div', { class: 'faces' }, ...kids);
    };

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
      const byId = new Map(members.map((m) => [String(m.id), m]));
      const byName = new Map(members.map((m) => [m.name, m]));
      const windows = (Array.isArray(d.windows) ? d.windows : []);
      const connected = members.filter((m) => m.connected !== false).length;

      // Resolve a window's free members → member objects (prefer ids, fall back
      // to names, and finally synthesize a stub so a bubble still renders).
      const freeMembers = (w) => {
        const ids = Array.isArray(w.freeIds) ? w.freeIds : null;
        if (ids && ids.length) return ids.map((id) => byId.get(String(id))).filter(Boolean);
        const names = Array.isArray(w.freeNames) ? w.freeNames : [];
        return names.map((n) => byName.get(n) || { id: n, name: n, avatarUrl: null });
      };

      const rosterEl = members.length
        ? h('div', { class: 'cal-roster' },
            h('span', { class: 'lbl' }, 'Household'),
            h('div', { class: 'cal-faces' },
              ...members.slice(0, 7).map((m) => avatar(m, 30, { dim: m.connected === false }))),
            h('div', { class: 'synced' }, h('b', {}, String(connected)), ' synced'))
        : null;

      // Nobody synced anything yet → invite into Roots, but still show any faces
      // we have so the card has presence.
      if (!connected) {
        body.replaceChildren(
          rosterEl || h('div', {}),
          h('div', { class: 'cal-div' }),
          h('div', { class: 'cal-msg' },
            'Sync a calendar in ', h('span', { class: 'em' }, 'Roots'),
            ' to see when everyone is free.'));
        return;
      }

      if (!windows.length) {
        body.replaceChildren(
          rosterEl,
          h('div', { class: 'cal-div' }),
          h('div', { class: 'cal-msg' }, 'No shared free time in the next few days — enjoy the calm.'));
        return;
      }

      const heroW = windows[0];
      const rest = windows.slice(1, 6);

      const heroFree = freeMembers(heroW);
      const heroAll = heroW.totalCount > 0 && (heroW.freeCount || heroFree.length) >= heroW.totalCount;
      const hs = new Date(heroW.start), he = new Date(heroW.end);
      const heroEl = h('div', { class: 'cal-hero' },
        h('div', { class: 'top' },
          h('div', { class: 'day' }, dayLabel(hs)),
          h('div', { class: 'time' }, `${tidy(hs)} – ${tidy(he)}`)),
        h('div', { class: 'who' },
          facesOf(heroFree, 30, 6),
          h('div', { class: 'tag' + (heroAll ? '' : ' some') },
            heroAll ? 'everyone free' : `${heroW.freeCount || heroFree.length} free`)));

      const rows = rest.map((w) => {
        const s = new Date(w.start), e = new Date(w.end);
        const fm = freeMembers(w);
        const total = w.totalCount || connected;
        const free = w.freeCount != null ? w.freeCount : fm.length;
        const all = total > 0 && free >= total;
        const pct = total > 0 ? Math.max(6, Math.round((free / total) * 100)) : 0;
        return h('div', { class: 'cal-ev' },
          h('div', { class: 'day' }, dayLabel(s)),
          h('div', { class: 'time' }, `${tidy(s)}–${tidy(e)}`),
          h('div', { class: 'cal-bar' + (all ? ' all' : '') }, h('i', { style: { width: pct + '%' } })),
          facesOf(fm, 20, 3),
          h('div', { class: 'free' + (all ? ' all' : '') }, all ? 'all' : `${free}/${total}`));
      });

      const children = [rosterEl, h('div', { class: 'cal-div' }), heroEl];
      if (rows.length) {
        children.push(h('div', { class: 'cal-list' },
          h('div', { class: 'cal-up' }, 'Then'),
          ...rows));
      }
      body.replaceChildren(...children);
    };

    ctx.interval(render, 60000);
  },

  // Full-screen view (tap / controller-open): the same data given room to breathe —
  // a generous "next free" hero with named faces, then a calm list of upcoming
  // windows. Reuses the localhost /api/house/calendar read; degrades gracefully.
  async openFull(body, ctx) {
    const { h } = ctx;
    const { tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .calf { display:flex; flex-direction:column; gap:22px; padding:4px 6px 24px; }
      .calf-roster { display:flex; flex-wrap:wrap; align-items:center; gap:16px 22px; }
      .calf-mem { display:flex; align-items:center; gap:10px; }
      .calf-mem .nm { font-size:17px; color:var(--ink-soft); }
      .calf-mem.off .nm { color:var(--ink-faint); }
      .calf-synced { margin-left:auto; font-family:var(--font-mono); font-size:13px; letter-spacing:.08em;
        text-transform:uppercase; color:var(--ink-faint); }
      .calf-synced b { color:var(--mint); }

      .calf-hero { border:1px solid var(--stroke); border-radius:var(--radius);
        background:rgba(116,247,176,.05); padding:24px 26px; display:flex; flex-direction:column; gap:16px; }
      .calf-lead { font-family:var(--font-mono); font-size:12px; letter-spacing:.18em; text-transform:uppercase;
        color:var(--ink-faint); }
      .calf-hero .when { display:flex; align-items:baseline; gap:18px; flex-wrap:wrap; }
      .calf-hero .day { font-family:var(--font-display); font-weight:800; font-size:52px; line-height:.95;
        background:linear-gradient(120deg,var(--mint),var(--mint-2));
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
      .calf-hero .time { font-family:var(--font-mono); font-size:24px; color:var(--ink-soft); }
      .calf-hero .who { display:flex; flex-wrap:wrap; align-items:center; gap:14px 18px; }
      .calf-hero .tag { font-size:18px; font-weight:700; color:var(--mint); }
      .calf-hero .tag.some { color:var(--ink-soft); }

      .calf-sec { font-family:var(--font-mono); font-size:12px; letter-spacing:.18em; text-transform:uppercase;
        color:var(--ink-faint); margin-bottom:-6px; }
      .calf-list { display:flex; flex-direction:column; }
      .calf-row { display:flex; align-items:center; gap:18px; padding:18px 4px; border-top:1px solid var(--stroke); }
      .calf-row .day { flex:0 0 92px; font-family:var(--font-display); font-weight:700; font-size:23px; color:var(--ink); }
      .calf-row .time { flex:1; min-width:0; font-family:var(--font-mono); font-size:18px; color:var(--ink-soft);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .calf-row .faces { display:flex; flex:0 0 auto; }
      .calf-row .faces .av { margin-left:-9px; }
      .calf-row .faces .av:first-child { margin-left:0; }
      .calf-row .free { flex:0 0 auto; font-size:16px; color:var(--ink-faint); min-width:64px; text-align:right; }
      .calf-row .free.all { color:var(--mint); font-weight:700; }

      .calf .av { position:relative; border-radius:50%; flex:0 0 auto; overflow:hidden;
        display:flex; align-items:center; justify-content:center; color:#0b0f0d; font-weight:800;
        font-family:var(--font-display); box-shadow:0 1px 4px rgba(0,0,0,.45); border:2px solid var(--bg-1); }
      .calf .av.dim { opacity:.4; filter:grayscale(.5); }
      .calf .av img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
      .calf-msg { font-size:21px; line-height:1.55; color:var(--ink-soft); padding:30px 4px; }
      .calf-msg .em { color:var(--mint); font-weight:700; }
    `);
    body.appendChild(ctx.loading('checking the calendar…'));

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    const tidy = (d) => fmtTime.format(d).toLowerCase().replace(':00', '').replace(/\s/g, '');
    const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const weekdayLong = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
    const weekdayShort = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
    const dayLabel = (start, long = false) => {
      const now = new Date();
      const k = dayKey(start), today = dayKey(now);
      const tmrw = dayKey(new Date(now.getTime() + 86400000));
      if (k === today) return 'Today';
      if (k === tmrw) return 'Tomorrow';
      return long ? weekdayLong(start) : weekdayShort(start);
    };
    const avatar = (m, px, { dim = false } = {}) => {
      const el = h('div', { class: 'av' + (dim ? ' dim' : ''), title: m.name || '',
        style: { width: px + 'px', height: px + 'px', fontSize: Math.round(px * 0.42) + 'px', background: colorFor(m.id || m.name) } },
        initialOf(m.name));
      if (m.avatarUrl) { const img = h('img', { src: m.avatarUrl, alt: '', loading: 'lazy' }); img.addEventListener('error', () => img.remove()); el.appendChild(img); }
      return el;
    };
    const facesOf = (list, px, max = 8) => {
      const shown = list.slice(0, max);
      const kids = shown.map((m) => avatar(m, px));
      if (list.length > max) kids.push(h('div', { class: 'av',
        style: { width: px + 'px', height: px + 'px', fontSize: Math.round(px * 0.36) + 'px', background: 'var(--glass)', color: 'var(--ink-soft)' } }, '+' + (list.length - max)));
      return h('div', { class: 'faces' }, ...kids);
    };

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
      const byId = new Map(members.map((m) => [String(m.id), m]));
      const byName = new Map(members.map((m) => [m.name, m]));
      const windows = Array.isArray(d.windows) ? d.windows : [];
      const connected = members.filter((m) => m.connected !== false).length;
      const freeMembers = (w) => {
        const ids = Array.isArray(w.freeIds) ? w.freeIds : null;
        if (ids && ids.length) return ids.map((id) => byId.get(String(id))).filter(Boolean);
        const names = Array.isArray(w.freeNames) ? w.freeNames : [];
        return names.map((n) => byName.get(n) || { id: n, name: n, avatarUrl: null });
      };

      const roster = h('div', { class: 'calf-roster' },
        ...members.map((m) => h('div', { class: 'calf-mem' + (m.connected === false ? ' off' : '') },
          avatar(m, 40, { dim: m.connected === false }),
          h('span', { class: 'nm' }, m.name || '—'))),
        h('div', { class: 'calf-synced' }, h('b', {}, String(connected)), ' synced'));

      if (!connected) {
        body.replaceChildren(h('div', { class: 'calf' }, roster,
          h('div', { class: 'calf-msg' }, 'Sync a calendar in ', h('span', { class: 'em' }, 'Roots'),
            ' to see when everyone is free.')));
        return;
      }
      if (!windows.length) {
        body.replaceChildren(h('div', { class: 'calf' }, roster,
          h('div', { class: 'calf-msg' }, 'No shared free time in the next few days — enjoy the calm.')));
        return;
      }

      const heroW = windows[0];
      const heroFree = freeMembers(heroW);
      const heroAll = heroW.totalCount > 0 && (heroW.freeCount || heroFree.length) >= heroW.totalCount;
      const hs = new Date(heroW.start), he = new Date(heroW.end);
      const hero = h('div', { class: 'calf-hero' },
        h('div', { class: 'calf-lead' }, 'Next free window'),
        h('div', { class: 'when' },
          h('div', { class: 'day' }, dayLabel(hs, true)),
          h('div', { class: 'time' }, `${tidy(hs)} – ${tidy(he)}`)),
        h('div', { class: 'who' },
          facesOf(heroFree, 44, 10),
          h('div', { class: 'tag' + (heroAll ? '' : ' some') },
            heroAll ? 'everyone free' : `${heroW.freeCount || heroFree.length} of ${heroW.totalCount || connected} free`)));

      const rest = windows.slice(1, 9);
      const rows = rest.map((w) => {
        const s = new Date(w.start), e = new Date(w.end);
        const fm = freeMembers(w);
        const total = w.totalCount || connected;
        const free = w.freeCount != null ? w.freeCount : fm.length;
        const all = total > 0 && free >= total;
        return h('div', { class: 'calf-row' },
          h('div', { class: 'day' }, dayLabel(s)),
          h('div', { class: 'time' }, `${tidy(s)} – ${tidy(e)}`),
          facesOf(fm, 32, 6),
          h('div', { class: 'free' + (all ? ' all' : '') }, all ? 'all free' : `${free} free`));
      });

      const kids = [roster, hero];
      if (rows.length) kids.push(h('div', { class: 'calf-sec' }, 'Then'), h('div', { class: 'calf-list' }, ...rows));
      body.replaceChildren(h('div', { class: 'calf' }, ...kids));
    };

    ctx.interval(render, 60000);
  },
};
