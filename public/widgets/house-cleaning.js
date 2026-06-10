// Roots — the household app's widget on the wall. A proper card (standard chrome)
// whose body stays ADAPTIVE: it collapses to one quiet line when nothing is
// happening and shows at most two rows when busy, so it never crowds the canvas:
//   quiet   → "the house is quiet today · scan the corner code to join ↗"
//   active  → live pill "● Name cleaning · 12m" (pulsing)
//   chores  → inline leaderboard chips (🥇🥈) + most recent completion
// Reads the localhost read-only /api/house/status. (The QR that opens Roots on a
// phone lives in the header corner — see #cornerqr in the template.)
//
// NOTE: this widget belongs to the Roots side project (hand-maintained). The
// daily tending may restyle it but must keep the widget present and working.
export default {
  id: 'house-cleaning',
  title: 'Roots',
  icon: '🌱',
  size: 'lg',
  chrome: true, // standard widget card — title bar + glass box like its neighbours
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .rt { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
        max-height:72px; overflow:hidden; }
      .rt .sep { width:1px; height:22px; background:var(--stroke); flex:none; }
      @keyframes rtpulse { 0%{box-shadow:0 0 0 0 rgba(116,247,176,.55);} 70%{box-shadow:0 0 0 9px rgba(116,247,176,0);} 100%{box-shadow:0 0 0 0 rgba(116,247,176,0);} }
      .rt .live { display:flex; align-items:center; gap:8px; flex:none;
        font-size:14.5px; font-weight:600; color:var(--mint);
        background:rgba(116,247,176,.09); border:1px solid var(--stroke);
        border-radius:999px; padding:5px 13px; }
      .rt .live .dot { width:8px; height:8px; border-radius:50%; background:var(--mint);
        animation:rtpulse 1.8s infinite; }
      .rt .live .t { font-family:var(--font-mono); font-size:12px; color:var(--ink-soft); font-weight:400; }
      .rt .chip { display:flex; align-items:center; gap:7px; flex:none;
        font-size:14.5px; color:var(--ink); background:rgba(255,255,255,.045);
        border:1px solid var(--stroke); border-radius:999px; padding:5px 12px; }
      .rt .chip .pts { font-family:var(--font-display); font-weight:700; color:var(--mint); font-size:15.5px; }
      .rt .recent { font-size:13.5px; color:var(--ink-faint); display:flex; align-items:center; gap:6px;
        min-width:0; overflow:hidden; }
      .rt .recent .rtxt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .rt .quiet { font-size:14.5px; color:var(--ink-faint); }
      .rt .quiet i { font-style:normal; opacity:.75; }
    `);
    body.classList.add('rt');

    const CHORE_EMOJI = { trash: '🗑', counters: '🧽', vacuum: '🧹', dishwasher_run: '🍽', dishwasher_empty: '🧼', curb: '♻️', other: '✍️' };
    const CHORE_LABEL = { trash: 'took the trash out', counters: 'wiped counters', vacuum: 'vacuumed', dishwasher_run: 'ran the dishwasher', dishwasher_empty: 'put dishes away', curb: 'trash to the curb', other: 'a chore' };
    const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
    const MEDAL = ['🥇', '🥈'];

    const render = async () => {
      let s;
      try {
        // Same-origin localhost read — NOT through the external-only proxy.
        const r = await fetch('/api/house/status', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        s = await r.json();
      } catch {
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('household unavailable'));
        return;
      }
      body.dataset.loaded = '1';

      const parts = [];

      // Priority 1 — live cleaning pill(s).
      const cleaning = s.cleaning || [];
      for (const c of cleaning.slice(0, 2)) {
        const mins = c.started_at ? Math.max(1, Math.round((Date.now() - c.started_at) / 60000)) : null;
        parts.push(h('div', { class: 'live' },
          h('span', { class: 'dot' }), `${c.name} cleaning`,
          mins ? h('span', { class: 't' }, `${mins}m`) : null));
      }

      // Priority 2 — today's top cleaners as inline chips.
      const board = (s.day || []).slice(0, 2);
      if (board.length) {
        if (parts.length) parts.push(h('div', { class: 'sep' }));
        board.forEach((p, i) => parts.push(h('div', { class: 'chip' },
          MEDAL[i] || '', p.name, h('span', { class: 'pts' }, String(p.points)))));
      }

      // Priority 3 — the single most recent completion.
      const a = (s.activity || [])[0];
      if (a) {
        const what = a.chore === 'other' && a.note ? a.note : (CHORE_LABEL[a.chore] || a.chore);
        parts.push(h('div', { class: 'recent' },
          h('span', {}, CHORE_EMOJI[a.chore] || '✓'),
          h('span', { class: 'rtxt' }, `${a.name} ${what} · ${ago(a.ts)}`)));
      }

      // Collapsed quiet state — nothing live, nothing today.
      if (!cleaning.length && !board.length && !a) {
        parts.push(h('div', { class: 'quiet' }, 'the house is quiet today · ', h('i', {}, 'scan the corner code to join ↗')));
      }

      body.replaceChildren(...parts);
    };

    ctx.interval(render, 15000);
  },
};
