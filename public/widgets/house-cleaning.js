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
      .rt { display:flex; flex-direction:column; justify-content:center; gap:11px; height:100%; min-height:0; }

      /* live banner — someone is cleaning right now (static glow, no animation) */
      .rt-live { display:flex; align-items:center; gap:10px; flex:0 0 auto;
        font-size:15px; font-weight:600; color:var(--mint); }
      .rt-live .dot { width:9px; height:9px; border-radius:50%; background:var(--mint); flex:0 0 auto;
        box-shadow:0 0 10px rgba(116,247,176,.9); }
      .rt-live .nm { color:var(--ink); font-weight:700; }
      .rt-live .t { margin-left:auto; font-family:var(--font-mono); font-size:12px; color:var(--ink-soft); flex:0 0 auto; }

      /* today's leaderboard — a clean ranked row, each cleaner a tidy unit */
      .rt-board { display:flex; align-items:stretch; gap:0; flex:0 0 auto; min-width:0; }
      .rt-ent { display:flex; align-items:center; gap:9px; min-width:0; flex:1;
        padding:0 16px; border-left:1px solid var(--stroke); }
      .rt-ent:first-child { padding-left:0; border-left:none; }
      .rt-rank { font-size:17px; flex:0 0 auto; line-height:1; }
      .rt-who { display:flex; flex-direction:column; gap:2px; min-width:0; }
      .rt-who .nm { font-size:14px; font-weight:600; color:var(--ink);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .rt-who .pts { font-family:var(--font-display); font-weight:700; color:var(--mint); font-size:17px; line-height:1; }
      .rt-who .pts span { font-family:var(--font-mono); font-size:9.5px; font-weight:400; color:var(--ink-faint);
        letter-spacing:.08em; margin-left:3px; }

      /* profile avatar — Google photo or a colored initial bubble */
      .rt .av { width:30px; height:30px; border-radius:50%; flex:none; object-fit:cover;
        display:flex; align-items:center; justify-content:center;
        font-size:13px; font-weight:700; color:#0b1f17; }
      .rt-live .av { width:26px; height:26px; }

      /* most-recent completion — a calm footer line */
      .rt-foot { display:flex; align-items:center; gap:8px; flex:0 0 auto; min-width:0;
        font-size:13px; color:var(--ink-faint); }
      .rt-foot .rtxt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .rt-div { height:1px; background:var(--stroke); flex:0 0 auto; }

      .rt-quiet { font-size:15px; color:var(--ink-soft); line-height:1.45; }
      .rt-quiet i { font-style:normal; color:var(--ink-faint); }
    `);
    body.classList.add('rt');

    const CHORE_EMOJI = { trash: '🗑', counters: '🧽', vacuum: '🧹', dishwasher_run: '🍽', dishwasher_empty: '🧼', curb: '♻️', other: '✍️' };
    const CHORE_LABEL = { trash: 'took the trash out', counters: 'wiped counters', vacuum: 'vacuumed', dishwasher_run: 'ran the dishwasher', dishwasher_empty: 'put dishes away', curb: 'trash to the curb', other: 'a chore' };
    const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
    const MEDAL = ['🥇', '🥈', '🥉'];
    // A small avatar: the user's chosen picture (uploaded photo or Google photo),
    // else a deterministic colored-initial bubble. `avatarUrl` is resolved by the
    // API (uploaded > google); googlePicture is the legacy fallback field.
    const AV_HUES = [150, 168, 186, 42, 200, 128, 96, 18];
    const avatar = (u) => {
      const url = (u && u.avatarUrl) || (u && u.googlePicture);
      if (url) return h('img', { class: 'av', src: url, alt: '', referrerpolicy: 'no-referrer' });
      const name = String((u && u.name) || '?');
      let hsh = 0; for (let i = 0; i < name.length; i++) hsh = (hsh * 31 + name.charCodeAt(i)) >>> 0;
      const hue = AV_HUES[hsh % AV_HUES.length];
      return h('span', { class: 'av', style: `background:linear-gradient(135deg,hsl(${hue} 70% 62%),hsl(${(hue + 28) % 360} 72% 52%))` }, (name[0] || '?').toUpperCase());
    };

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

      const cleaning = s.cleaning || [];
      const board = (s.day || []).slice(0, 3);
      const recent = (s.activity || [])[0];
      const parts = [];

      // Top — a live banner when someone is actively cleaning.
      if (cleaning.length) {
        const c = cleaning[0];
        const mins = c.started_at ? Math.max(1, Math.round((Date.now() - c.started_at) / 60000)) : null;
        const more = cleaning.length - 1;
        parts.push(h('div', { class: 'rt-live' },
          h('span', { class: 'dot' }), avatar(c),
          h('span', {}, h('span', { class: 'nm' }, c.name), ' is cleaning',
            more > 0 ? ` +${more}` : ''),
          mins ? h('span', { class: 't' }, `${mins}m`) : null));
      }

      // Heart of the card — today's leaderboard as a clean ranked row.
      if (board.length) {
        parts.push(h('div', { class: 'rt-board' },
          ...board.map((p, i) => h('div', { class: 'rt-ent' },
            h('span', { class: 'rt-rank' }, MEDAL[i] || `${i + 1}`),
            avatar(p),
            h('div', { class: 'rt-who' },
              h('div', { class: 'nm' }, p.name),
              h('div', { class: 'pts' }, String(p.points), h('span', {}, 'pts')))))));
      }

      // Footer — the single most recent completion (skipped if it crowds a busy card).
      if (recent && !(cleaning.length && board.length)) {
        const what = recent.chore === 'other' && recent.note ? recent.note : (CHORE_LABEL[recent.chore] || recent.chore);
        if (parts.length) parts.push(h('div', { class: 'rt-div' }));
        parts.push(h('div', { class: 'rt-foot' },
          h('span', {}, CHORE_EMOJI[recent.chore] || '✓'),
          h('span', { class: 'rtxt' }, `${recent.name} ${what} · ${ago(recent.ts)}`)));
      }

      // Quiet state — nothing live, nobody on the board, no activity.
      if (!parts.length) {
        parts.push(h('div', { class: 'rt-quiet' },
          'The house is quiet today.', h('br'), h('i', {}, 'Scan the corner code to join Roots ↗')));
      }

      body.replaceChildren(...parts);
    };

    ctx.interval(render, 15000);
  },
};
