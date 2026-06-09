// House Cleaning — wall widget for the "Arbor" household app.
// Shows who is currently in Clean Mode (live) + the day's top cleaners + a few
// recent completions, reading the localhost server's read-only /api/house/status.
//
// NOTE: this widget belongs to the Arbor side project (hand-maintained). The
// daily tending may restyle it but should not remove the household feature.
export default {
  id: 'house-cleaning',
  title: 'The House',
  icon: '🧹',
  size: 'lg',
  chrome: false, // bare card — keeps this 7th full-width row within the locked canvas
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .hc { display:flex; flex-direction:column; gap:9px; }
      @keyframes hcpulse { 0%{box-shadow:0 0 0 0 rgba(116,247,176,.6);} 70%{box-shadow:0 0 0 11px rgba(116,247,176,0);} 100%{box-shadow:0 0 0 0 rgba(116,247,176,0);} }
      .hc .hdr { display:flex; align-items:center; gap:9px; font-family:var(--font-display); font-size:18px; color:var(--ink); }
      .hc .hdr .ic { font-size:19px; }
      .hc .hdr .ttl { font-weight:600; }
      .hc .hdr .dot { width:9px; height:9px; border-radius:50%; background:var(--mint); flex:none; margin-left:auto;
        box-shadow:0 0 0 0 rgba(116,247,176,.6); animation:hcpulse 1.8s infinite; }
      .hc .hdr .live { font-family:var(--font); font-size:15px; color:var(--ink-soft); }
      .hc .hdr .live b { color:var(--mint); }
      .hc .hdr .idle { font-family:var(--font); font-size:14px; color:var(--ink-faint); margin-left:auto; }
      .hc .cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start; }
      .hc .col { display:flex; flex-direction:column; gap:2px; }
      .hc .quiet { color:var(--ink-faint); font-size:15px; }
      .hc .brow { display:flex; align-items:center; gap:9px; font-size:18px; }
      .hc .brow .pos { width:24px; text-align:center; }
      .hc .brow .nm { flex:1; font-weight:600; }
      .hc .brow .pts { font-family:var(--font-display); color:var(--mint); font-size:19px; }
      .hc .recent .r { font-size:14px; color:var(--ink-soft); display:flex; gap:7px; line-height:1.25; }
      .hc .recent .r .e { font-size:15px; flex:none; }
      .hc .recent .r .rt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* Bare card → trim padding so this 7th full-width row stays inside the locked canvas. */
      .card.hc-card { padding:13px 18px; }
    `);
    body.classList.add('hc');
    body.parentElement?.classList.add('hc-card');

    const CHORE_EMOJI = { trash: '🗑', counters: '🧽', vacuum: '🧹', dishwasher_run: '🍽', dishwasher_empty: '🧼', curb: '♻️', other: '✍️' };
    const CHORE_LABEL = { trash: 'took the trash out', counters: 'wiped counters', vacuum: 'vacuumed', dishwasher_run: 'ran the dishwasher', dishwasher_empty: 'put dishes away', curb: 'trash to the curb', other: 'a chore' };
    const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };

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

      // Header line doubles as the live "cleaning now" status (no extra row).
      const cleaning = (s.cleaning || []);
      const status = cleaning.length
        ? h('span', { class: 'live', html: `${cleaning.map((c) => '<b>' + esc(c.name) + '</b>').join(', ')} cleaning` })
        : h('span', { class: 'idle' }, 'idle');
      const hdr = h('div', { class: 'hdr' },
        h('span', { class: 'ic' }, '🧹'), h('span', { class: 'ttl' }, 'The House'),
        cleaning.length ? h('span', { class: 'dot' }) : null, status);

      const cols = h('div', { class: 'cols' });
      // Left: today's top-2 leaderboard.
      const board = (s.day || []).slice(0, 2);
      const left = h('div', { class: 'col board' });
      if (board.length) {
        board.forEach((p, i) => left.appendChild(h('div', { class: 'brow' + (i === 0 ? ' top' : '') },
          h('span', { class: 'pos' }, i === 0 ? '🥇' : '🥈'),
          h('span', { class: 'nm' }, p.name),
          h('span', { class: 'pts' }, `${p.points}`))));
      } else { left.appendChild(h('div', { class: 'quiet' }, 'No chores logged today')); }
      // Right: the two most recent completions.
      const recent = (s.activity || []).slice(0, 2);
      const right = h('div', { class: 'col recent' });
      for (const a of recent) {
        const what = a.chore === 'other' && a.note ? a.note : (CHORE_LABEL[a.chore] || a.chore);
        right.appendChild(h('div', { class: 'r' }, h('span', { class: 'e' }, CHORE_EMOJI[a.chore] || '✓'), h('span', { class: 'rt' }, `${a.name} ${what} · ${ago(a.ts)}`)));
      }
      cols.appendChild(left);
      if (recent.length) cols.appendChild(right);

      body.replaceChildren(hdr, cols);
    };
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    ctx.interval(render, 15000);
  },
};
