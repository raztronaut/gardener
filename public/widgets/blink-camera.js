// Blink Camera — shows the most recent motion snapshot from your Blink cameras.
// A Python blinkpy daemon (src/blink/) authenticates once, then polls for motion
// and writes the latest frame; this widget reads the localhost /api/blink/latest
// endpoint (NOT the external proxy) and displays the picture with a "motion · Ns
// ago" badge. Degrades gracefully: shows a calm "connect Blink" note before login,
// and "watching for motion" once connected but before the first event.
export default {
  id: 'blink-camera',
  title: 'Camera',
  icon: '📷',
  size: 'tall', // half-width × 2 rows — a roomy landscape view of the camera
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .bk { position:relative; height:100%; min-height:0; display:flex; flex-direction:column; gap:0; }
      /* the snapshot fills the card; rounded to sit inside the glass frame */
      .bk-imgwrap { position:relative; flex:1; min-height:0; border-radius:16px; overflow:hidden;
        background:#06140f; border:1px solid var(--stroke); }
      .bk-img { width:100%; height:100%; object-fit:cover; display:block; }
      /* gradient scrim so the caption is legible over any frame */
      .bk-scrim { position:absolute; left:0; right:0; bottom:0; height:46%;
        background:linear-gradient(to top, rgba(0,0,0,.72), transparent); pointer-events:none; }
      .bk-cap { position:absolute; left:14px; right:14px; bottom:11px; display:flex; align-items:flex-end;
        justify-content:space-between; gap:10px; }
      .bk-cam { font-family:var(--font-display); font-weight:700; font-size:19px; color:#fff;
        text-shadow:0 1px 6px rgba(0,0,0,.6); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .bk-sub { font-family:var(--font-mono); font-size:11px; color:rgba(255,255,255,.8); letter-spacing:.04em; margin-top:2px; }
      /* motion badge — a live mint pill (static, no animation) */
      .bk-badge { flex:0 0 auto; display:flex; align-items:center; gap:7px; padding:5px 11px; border-radius:999px;
        background:rgba(8,20,15,.6); border:1px solid var(--stroke-strong); font-family:var(--font-mono);
        font-size:11px; letter-spacing:.04em; color:var(--mint); }
      .bk-badge .dot { width:8px; height:8px; border-radius:50%; background:var(--mint); box-shadow:0 0 9px rgba(116,247,176,.9); }
      .bk-badge.stale { color:var(--ink-soft); }
      .bk-badge.stale .dot { background:var(--ink-faint); box-shadow:none; }
      /* empty / login states */
      .bk-msg { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
        text-align:center; color:var(--ink-soft); border-radius:16px; border:1px dashed var(--stroke); background:#06140f; }
      .bk-msg .ic { font-size:30px; opacity:.7; }
      .bk-msg .t { font-size:16px; color:var(--ink); font-weight:600; }
      .bk-msg .d { font-size:12.5px; color:var(--ink-faint); line-height:1.4; max-width:80%; }
      .bk-msg code { font-family:var(--font-mono); font-size:11.5px; color:var(--mint); }
    `);
    body.classList.add('bk');

    const ago = (iso) => {
      if (!iso) return null;
      const t = Date.parse(iso); if (Number.isNaN(t)) return null;
      const s = Math.max(0, Math.round((Date.now() - t) / 1000));
      return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago`
        : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
    };

    const msg = (icon, title, detail) => h('div', { class: 'bk-msg' },
      h('div', { class: 'ic' }, icon),
      h('div', { class: 't' }, title),
      detail ? h('div', { class: 'd', html: detail }) : null);

    const render = async () => {
      let s;
      try {
        const r = await fetch('/api/blink/latest', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        s = await r.json();
      } catch {
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('camera service unavailable'));
        return;
      }
      body.dataset.loaded = '1';

      if (s.state === 'needs-login') {
        body.replaceChildren(msg('📷', 'Connect Blink',
          'Run <code>src/blink/blink_login.py</code> on the wall to sign in, then motion snapshots appear here.'));
        return;
      }
      if (!s.hasImage) {
        body.replaceChildren(msg('👁', 'Watching for motion',
          s.camera ? `Connected to ${s.camera} — the latest motion clip will show here.` : 'Connected — waiting for the first motion event.'));
        return;
      }

      const when = ago(s.motionAt);
      // "fresh" = a motion event within the last 5 min → bright pill; else muted.
      const fresh = s.motionAt && (Date.now() - Date.parse(s.motionAt)) < 5 * 60 * 1000;
      const extra = [];
      if (s.temperature != null) extra.push(`${Math.round(s.temperature)}°`);
      if (s.battery) extra.push(String(s.battery));

      body.replaceChildren(h('div', { class: 'bk-imgwrap' },
        h('img', { class: 'bk-img', src: `/api/blink/image?v=${s.imageVersion || 0}`, alt: 'latest camera snapshot' }),
        h('div', { class: 'bk-scrim' }),
        h('div', { class: 'bk-cap' },
          extra.length ? h('div', { class: 'bk-sub' }, extra.join(' · ')) : h('span', {}),
          h('div', { class: `bk-badge ${fresh ? '' : 'stale'}` },
            h('span', { class: 'dot' }),
            h('span', {}, when ? `motion ${when}` : 'no recent motion')))));
    };

    body.appendChild(ctx.loading('reaching the cameras…'));
    ctx.interval(render, 20000); // poll the local file endpoint (daemon refreshes ~60s)
  },
};
