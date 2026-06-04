// Plant a Note remotely — a QR code that opens the mobile note-planting page so
// anyone in the room can grow the garden from their phone.
//
// Honors: "the plant a note needs to be on ngrok otherwise it wont work." A QR to
// a localhost/LAN address is useless on a phone, so the QR encodes a PUBLIC base
// URL. The backend now auto-detects a running ngrok tunnel (see server.mjs) and
// exposes it as state.publicUrl; GARDENER_PUBLIC_URL still overrides if set. We
// fetch the freshest /api/state at mount so a tunnel started after boot is picked
// up without waiting for a full reload. If no public URL is available yet, the
// widget shows a clear "start an ngrok tunnel" prompt instead of a dead QR.
//
// The QR image is rendered by the keyless api.qrserver.com service through the
// SSRF-safe proxy; if it can't be reached the widget shows the link as text.

const isPublic = (u) => {
  try {
    const h = new URL(u).hostname;
    return !/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i.test(h);
  } catch { return false; }
};

export default {
  id: 'qr-notes',
  title: 'Plant a Note',
  icon: '\u{1F4F1}',
  size: 'sm',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .qrn { display:flex; align-items:center; gap:15px; height:100%; }
      .qrn-code { flex:0 0 auto; width:84px; height:84px; border-radius:12px; background:#fff;
        padding:6px; display:grid; place-items:center; box-shadow:0 4px 12px rgba(0,0,0,.35); }
      .qrn-code img { width:100%; height:100%; display:block; image-rendering:pixelated; }
      .qrn-fallback { font-family:var(--font-mono); font-size:8px; color:#04140d; text-align:center;
        word-break:break-all; line-height:1.25; }
      .qrn-wait { flex:0 0 auto; width:84px; height:84px; border-radius:12px;
        background:rgba(120,247,176,.08); border:1px dashed var(--stroke);
        display:grid; place-items:center; font-size:30px; }
      .qrn-info { min-width:0; flex:1; }
      .qrn-h { font-family:var(--font-display); font-size:17px; line-height:1.14; color:var(--ink); }
      .qrn-sub { margin-top:6px; font-size:12.5px; line-height:1.35; color:var(--ink-soft);
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    `);
    body.appendChild(ctx.loading('printing a QR…'));

    // Resolve the public destination. Prefer the freshest server state (which now
    // includes any auto-detected ngrok tunnel), then the boot-time config, then —
    // only if it's genuinely public — this page's own origin.
    let base = '';
    try {
      const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
      if (s && s.publicUrl) base = s.publicUrl;
    } catch { /* fall through to ctx.config */ }
    if (!base) base = (ctx.config && ctx.config.publicUrl) || '';
    if (!base) { try { if (isPublic(location.origin)) base = location.origin; } catch { /* ignore */ } }
    base = String(base).replace(/\/+$/, '');

    // No reachable public URL → tell the human exactly how to enable it.
    if (!base) {
      body.replaceChildren(ctx.h('div', { class: 'qrn' },
        ctx.h('div', { class: 'qrn-wait' }, '📡'),
        ctx.h('div', { class: 'qrn-info' },
          ctx.h('div', { class: 'qrn-h' }, 'Plant a note'),
          ctx.h('div', { class: 'qrn-sub' }, 'Run an ngrok tunnel (ngrok http 8787) to publish a QR phones can scan.'))));
      return;
    }

    const target = `${base}/plant.html`;
    const pretty = target.replace(/^https?:\/\//, '');

    const tile = ctx.h('div', { class: 'qrn-code' });
    const info = ctx.h('div', { class: 'qrn-info' },
      ctx.h('div', { class: 'qrn-h' }, 'Plant a note'),
      ctx.h('div', { class: 'qrn-sub' }, 'Scan with your phone to grow the garden — tended in next morning.'));

    const showFallback = () => tile.replaceChildren(ctx.h('div', { class: 'qrn-fallback' }, pretty));
    const qrSrc = ctx.proxyUrl(
      `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=1&ecc=M&data=${encodeURIComponent(target)}`);
    const img = ctx.h('img', { alt: 'QR code to plant a note', src: qrSrc, onerror: showFallback });
    tile.appendChild(img);

    body.replaceChildren(ctx.h('div', { class: 'qrn' }, tile, info));
  },
};
