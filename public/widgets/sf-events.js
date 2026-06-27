// What's On — a two-mode card the humans can toggle between:
//   ⚽ World Cup  — the FIFA World Cup 2026 schedule (next matches, venue + city),
//                   sourced from TheSportsDB (see /lib/worldcup.js).
//   🎉 Out in SF  — upcoming free events around the city, from SF RATS
//                   (see /lib/events.js).
// During the World Cup (through 2026-07-19) it DEFAULTS to the match schedule;
// outside the tournament it defaults to SF events. An explicit toggle is
// remembered (localStorage), and the full lists live behind /worldcup and /events.
import { fetchEvents, TZ, MON } from '/lib/events.js';
import { fetchUpcoming, isFinished, isLive, WC_END, broadcastLabel } from '/lib/worldcup.js';

const MODE_KEY = 'garden.whatsonMode';

// Default mode: World Cup while the tournament is on, otherwise SF events. An
// explicit user choice (stored) always wins.
function defaultMode() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return today <= WC_END ? 'wc' : 'sf';
}
function readMode() {
  let stored = null;
  try { stored = localStorage.getItem(MODE_KEY); } catch { /* ignore */ }
  return stored === 'wc' || stored === 'sf' ? stored : defaultMode();
}

export default {
  id: 'sf-events',
  title: "What's On",
  icon: '⚽',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .won { display:flex; flex-direction:column; gap:11px; height:100%; }
      .won-tabs { flex:0 0 auto; display:flex; gap:6px; }
      .won-tab { flex:1; display:flex; align-items:center; justify-content:center; gap:6px;
        font-family:var(--font-mono); font-size:11.5px; font-weight:600; letter-spacing:.05em;
        color:var(--ink-faint); background:var(--glass-2); border:1px solid var(--stroke);
        border-radius:999px; padding:6px 4px; cursor:pointer; white-space:nowrap; overflow:hidden;
        text-overflow:ellipsis; transition:color .15s, background .15s, border-color .15s; }
      .won-tab.on { color:#06281c; background:linear-gradient(120deg,var(--mint),var(--mint-2));
        border-color:transparent; }
      .won-list { flex:1; display:flex; flex-direction:column; gap:11px; min-height:0; }
      .won-ev { flex:1; display:flex; gap:12px; align-items:flex-start;
        padding-bottom:10px; border-bottom:1px solid var(--stroke); min-height:0; }
      .won-ev:last-child { border-bottom:none; padding-bottom:0; }
      .won-date { flex:0 0 auto; width:54px; text-align:center; line-height:1; padding-top:2px; }
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
      .won-pill.score { color:var(--ink); }
      .won-pill.live { color:#06281c; background:linear-gradient(120deg,var(--mint),var(--mint-2)); border-color:transparent; }
      .won-empty { flex:1; display:flex; align-items:center; justify-content:center; text-align:center;
        color:var(--ink-faint); font-size:13px; padding:0 10px; }
      /* Compact World Cup rows: more fixtures fit, each tagged with its US channel. */
      .won-list.wc { gap:7px; }
      .won-ev.wc { padding-bottom:7px; }
      .won-ev.wc .won-name { font-size:14.5px; -webkit-line-clamp:1; }
      .won-ev.wc .won-meta { margin-top:3px; gap:6px; }
      .won-tv { font-family:var(--font-mono); font-size:10px; letter-spacing:.03em; font-weight:600;
        color:#9fe0ff; background:rgba(120,190,255,.13); border:1px solid rgba(120,190,255,.30);
        border-radius:999px; padding:2px 8px; white-space:nowrap; }
      .won-foot { flex:0 0 auto; text-align:center; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.08em; color:var(--ink-faint); padding-top:2px; }
    `);

    let mode = readMode();
    window.__WHATS_ON_MODE = mode;

    const startOfToday = (() => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; })();
    const dayMs = 864e5;
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

    // Shared date column: today shows the kickoff/start TIME; otherwise day + month.
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
      return ctx.h('div', { class: 'won-date' },
        ctx.h('div', { class: 'd' }, String(when.getDate())),
        ctx.h('div', { class: 'm' }, MON[when.getMonth()]));
    };

    const list = ctx.h('div', { class: 'won-list' });
    const foot = ctx.h('div', { class: 'won-foot', style: 'display:none' });

    const tab = (key, label) => ctx.h('div', {
      class: 'won-tab' + (mode === key ? ' on' : ''),
      onClick: (e) => { e.stopPropagation(); if (mode !== key) switchMode(key); },
    }, label);
    const tabs = ctx.h('div', { class: 'won-tabs' });
    const renderTabs = () => tabs.replaceChildren(tab('wc', '⚽ World Cup'), tab('sf', '🎉 Out in SF'));
    renderTabs();
    body.replaceChildren(ctx.h('div', { class: 'won' }, tabs, list, foot));

    // ---- renderers -----------------------------------------------------------
    const renderSF = (evs) => {
      list.className = 'won-list';
      foot.style.display = 'none';
      const picks = (evs || []).slice(0, 4);
      if (!picks.length) { list.replaceChildren(ctx.h('div', { class: 'won-empty' }, 'No upcoming events right now')); return; }
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
    };

    const renderWC = (matches) => {
      list.className = 'won-list wc';
      const all = matches || [];
      const picks = all.slice(0, 6);
      if (!picks.length) { foot.style.display = 'none'; list.replaceChildren(ctx.h('div', { class: 'won-empty' }, 'Next fixtures will appear as the bracket fills in')); return; }
      list.replaceChildren(...picks.map((m) => {
        const place = [m.venue, m.city].filter(Boolean).join(' · ');
        const tv = broadcastLabel(m);
        let pill = null;
        if (isLive(m)) pill = ctx.h('span', { class: 'won-pill live' }, `LIVE ${m.homeScore ?? 0}–${m.awayScore ?? 0}`);
        else if (isFinished(m)) pill = ctx.h('span', { class: 'won-pill score' }, `${m.homeScore ?? 0}–${m.awayScore ?? 0}`);
        else if (m.when) {
          const isToday = Math.round((new Date(dayKeyFmt.format(m.when) + 'T00:00:00') - startOfToday) / dayMs) <= 0;
          if (!isToday) pill = ctx.h('span', { class: 'won-pill' }, timeFmt.format(m.when).replace(' ', ''));
        }
        const meta = ctx.h('div', { class: 'won-meta' });
        if (place) meta.appendChild(ctx.h('span', { class: 'won-place' }, `📍 ${place}`));
        if (tv) meta.appendChild(ctx.h('span', { class: 'won-tv' }, `📺 ${tv}`));
        if (pill) meta.appendChild(pill);
        return ctx.h('div', { class: 'won-ev wc' },
          dateCol(m.when, false),
          ctx.h('div', { class: 'won-main' },
            ctx.h('div', { class: 'won-name' }, `${m.home} v ${m.away}`),
            meta.childNodes.length ? meta : null));
      }));
      foot.textContent = all.length > picks.length
        ? `+ more — tap for all ${all.length}+ fixtures`
        : 'tap for the full schedule';
      foot.style.display = '';
    };

    // ---- data: fetch BEFORE touching the list so a failed refresh keeps it ----
    const refreshSF = async () => { const evs = await fetchEvents(ctx.fetchJSON); renderSF(evs); };
    const refreshWC = async () => { const ms = await fetchUpcoming(ctx.fetchJSON, { count: 6 }); renderWC(ms); };

    let loadedOnce = { wc: false, sf: false };
    const loadFor = async (which) => {
      const refresh = which === 'wc' ? refreshWC : refreshSF;
      // If we've already shown this mode once, just refresh (keep last good on fail).
      if (loadedOnce[which]) { try { await refresh(); } catch { /* keep last */ } return; }
      list.replaceChildren(ctx.loading(which === 'wc' ? 'checking the fixtures…' : 'checking the city…'));
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try { await refresh(); ok = true; loadedOnce[which] = true; }
        catch { await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
      }
      if (!ok) list.replaceChildren(ctx.h('div', { class: 'won-empty' }, which === 'wc' ? 'World Cup schedule unavailable' : 'events unavailable'));
    };

    function switchMode(key) {
      mode = key;
      window.__WHATS_ON_MODE = key;
      try { localStorage.setItem(MODE_KEY, key); } catch { /* ignore */ }
      renderTabs();
      loadFor(key);
    }

    await loadFor(mode);
    // Periodic refresh of the ACTIVE mode (drops past events / updates live scores).
    ctx.interval(() => { (mode === 'wc' ? refreshWC() : refreshSF()).catch(() => {}); }, 5 * 60 * 1000);
  },
};
