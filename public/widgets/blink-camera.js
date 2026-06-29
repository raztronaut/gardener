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

  // Fullscreen = REAL-TIME live video (Blink Live View → MJPEG via the server).
  // The session starts when this <img> connects and is torn down on close.
  openFull(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .bk-live { position:relative; width:100%; height:100%; background:#000;
        display:flex; align-items:center; justify-content:center; }
      .bk-live img { width:100%; height:100%; object-fit:contain; display:block; }
      .bk-live .lv-badge { position:absolute; top:18px; left:18px; display:flex; align-items:center; gap:8px;
        padding:6px 13px; border-radius:999px; background:rgba(8,20,15,.6); border:1px solid var(--stroke-strong);
        font-family:var(--font-mono); font-size:13px; letter-spacing:.1em; color:#ff6b6b; }
      .bk-live .lv-badge .dot { width:9px; height:9px; border-radius:50%; background:#ff5b5b; box-shadow:0 0 10px #ff5b5b; }
      .bk-live .lv-badge.snap { color:var(--ink-soft); }
      .bk-live .lv-badge.snap .dot { background:var(--ink-faint); box-shadow:none; }
      .bk-live .lv-hint { position:absolute; bottom:16px; left:0; right:0; text-align:center;
        font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); letter-spacing:.06em; }
      .bk-live .lv-msg { color:var(--ink-soft); font-size:16px; text-align:center; padding:0 30px; line-height:1.5; }
    `);
    const img = h('img', { alt: 'camera' });
    const msg = h('div', { class: 'lv-msg' }, 'Connecting to live view…');
    const badgeTxt = h('span', {}, 'LIVE');
    const badge = h('div', { class: 'lv-badge' }, h('span', { class: 'dot' }), badgeTxt);
    const hint = h('div', { class: 'lv-hint' }, 'real-time · ~1–2s delay');
    body.classList.add('bk-live');
    body.replaceChildren(img, msg, badge, hint);

    // Continuously PROBE the live frame. When one decodes → real-time mode (rapid
    // re-poll). When live stays unavailable (Blink throttling / session down) we
    // DON'T sit on a black "connecting…" screen — we fall back to the latest
    // SNAPSHOT (refreshed periodically) while still probing live in the background,
    // so the feed resumes the instant it returns. Never a permanent black screen.
    let stopped = false, mode = 'connecting', liveFails = 0, timer = null;
    const showLive = (src) => {
      msg.remove(); img.src = src; mode = 'live'; liveFails = 0;
      badge.classList.remove('snap'); badgeTxt.textContent = 'LIVE';
      hint.textContent = 'real-time · ~1–2s delay';
    };
    const showSnap = () => {
      msg.remove();
      const sp = new Image();
      sp.onload = () => { if (!stopped && mode === 'snap') img.src = sp.src; };
      sp.src = `/api/blink/image?t=${Date.now()}`;
      badge.classList.add('snap'); badgeTxt.textContent = 'SNAPSHOT';
      hint.textContent = 'Live view unavailable — showing the latest snapshot';
    };
    const probe = () => {
      if (stopped) return;
      const pre = new Image();
      pre.onload = () => { if (stopped) return; showLive(pre.src); timer = setTimeout(probe, 110); };
      pre.onerror = () => {
        if (stopped) return;
        liveFails++;
        if (liveFails >= 6) {                 // ~3.5s of no live → fall back to snapshot
          const firstDrop = mode !== 'snap';
          mode = 'snap';
          if (firstDrop || liveFails % 20 === 0) showSnap();   // refresh snapshot ~every 60s
        }
        timer = setTimeout(probe, liveFails < 6 ? 600 : 3000);
      };
      pre.src = `/api/blink/live.jpg?t=${Date.now()}`;
    };
    probe();
    // Closing the panel → stop polling; the server's idle watchdog ends the session.
    window.__GARDEN_GAME = { input() {}, stop() { stopped = true; if (timer) clearTimeout(timer); try { img.src = ''; } catch { /* */ } } };
  },

  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .bk { position:relative; height:100%; min-height:0; display:flex; flex-direction:column; gap:0; }
      /* the snapshot fills the card; rounded to sit inside the glass frame */
      .bk-imgwrap { position:relative; flex:1; min-height:0; border-radius:16px; overflow:hidden;
        background:#06140f; border:1px solid var(--stroke); }
      .bk-img { width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .5s ease; }
      /* calm placeholder shown until a live frame arrives (or while it's down) —
         a quiet camera glyph on the garden's dark-green, never a broken image */
      .bk-ph { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
        justify-content:center; gap:9px; text-align:center; color:var(--ink-soft);
        background:radial-gradient(120% 90% at 50% 38%, #0c2419, #06140f); transition:opacity .5s ease; }
      .bk-ph .ic { font-size:34px; opacity:.55; }
      .bk-ph .t { font-family:var(--font-mono); font-size:12px; letter-spacing:.08em; color:var(--ink-faint); }
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

    // The TILE shows the REAL-TIME live feed (rapid-poll the live frame the always-
    // on daemon keeps fresh). When live momentarily drops (reconnect / Blink
    // throttle), it falls back to the latest SNAPSHOT so it's never blank or
    // "unavailable" — then resumes live automatically. Frames preload into a
    // detached <img> and only swap on a clean decode (no broken-image flashes).
    let imgEl = null, phEl = null, subEl = null, badgeEl = null, mode = null;
    let liveStopped = false, liveTimer = null, liveFails = 0, gotAny = false, snapV = null, liveUp = false;
    const swap = (src) => { if (!imgEl) return; imgEl.src = src; imgEl.style.opacity = '1'; if (phEl) phEl.style.opacity = '0'; gotAny = true; };
    const fallbackSnap = () => {
      if (snapV == null) return;
      const sp = new Image();
      sp.onload = () => { if (!liveStopped) swap(sp.src); };
      sp.src = `/api/blink/image?v=${snapV}`;
    };
    const nextLive = () => {
      if (liveStopped || !imgEl) return;
      const pre = new Image();
      pre.onload = () => { if (liveStopped) return; liveFails = 0; liveUp = true; swap(pre.src); liveTimer = setTimeout(nextLive, 120); };
      pre.onerror = () => {
        if (liveStopped) return;
        liveFails++;
        if (liveFails >= 3) { liveUp = false; fallbackSnap(); } // sustained drop → show snapshot
        // Brief blips: retry fast and stay live. When live is genuinely down
        // (Blink throttling / session offline) probe slowly so we don't hammer a
        // 503 endpoint forever on the low-power kiosk; a single success resumes live.
        liveTimer = setTimeout(nextLive, liveFails < 3 ? 200 : 5000);
      };
      pre.src = `/api/blink/live.jpg?t=${Date.now()}`;
    };
    const liveOk = () => liveUp && liveFails === 0; // truly streaming right now
    const buildView = () => {
      imgEl = h('img', { class: 'bk-img', alt: '' });
      phEl = h('div', { class: 'bk-ph' }, h('div', { class: 'ic' }, '📷'), h('div', { class: 't' }, 'connecting…'));
      subEl = h('div', { class: 'bk-sub' });
      badgeEl = h('div', { class: 'bk-badge' }, h('span', { class: 'dot' }), h('span', {}));
      gotAny = false; liveStopped = false;
      body.replaceChildren(h('div', { class: 'bk-imgwrap' },
        imgEl, phEl, h('div', { class: 'bk-scrim' }),
        h('div', { class: 'bk-cap' }, subEl, badgeEl)));
      mode = 'view';
      nextLive(); // start the realtime loop
    };

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
        if (mode !== 'login') { liveStopped = true; body.replaceChildren(msg('📷', 'Connect Blink',
          'Run <code>src/blink/blink_login.py</code> on the wall to sign in.')); mode = 'login'; }
        return;
      }
      if (mode !== 'view') buildView();
      if (s.hasImage) snapV = s.imageVersion;            // keep the snapshot fallback fresh
      if (!gotAny && snapV != null) fallbackSnap();       // show something immediately while live warms

      const when = ago(s.motionAt);
      const motionFresh = s.motionAt && (Date.now() - Date.parse(s.motionAt)) < 5 * 60 * 1000;
      const ok = liveOk();
      const extra = [];
      if (s.savedMotion) extra.push(`▶ ${s.savedMotion} saved`);
      if (s.temperature != null) extra.push(`${Math.round(s.temperature)}°`);
      // When we're showing a snapshot (live down), say how fresh it is rather than
      // implying a broken live feed — the picture is real and recent.
      if (!ok && gotAny) { const u = ago(s.updatedAt); if (u) extra.push(`updated ${u}`); }
      subEl.textContent = extra.join(' · ');
      badgeEl.className = `bk-badge ${motionFresh || ok ? '' : 'stale'}`;
      // Honest, calm states: LIVE when truly streaming, SNAPSHOT when showing the
      // latest still — never a permanent "reconnecting…" over a perfectly good frame.
      badgeEl.lastChild.textContent = when && motionFresh ? `motion ${when}`
        : ok ? 'LIVE' : !gotAny ? 'connecting…' : 'SNAPSHOT';
    };

    body.appendChild(ctx.loading('reaching the cameras…'));
    ctx.interval(render, 4000);
    return () => { liveStopped = true; if (liveTimer) clearTimeout(liveTimer); };
  },
};
