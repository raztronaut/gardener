// Plant a Note remotely — a QR code that opens the mobile note-planting page so
// anyone in the room can grow the garden from their phone. The QR encodes the
// public base URL (set GARDENER_PUBLIC_URL to an ngrok tunnel for off-LAN access),
// falling back to this page's own origin. Honors: "add a qrcode with ngrok that
// allows users to plant notes remotely."
//
// The QR image is rendered by the keyless api.qrserver.com service through the
// SSRF-safe proxy; if it can't be reached the widget shows the link as text so
// it still works.

export default {
  id: 'qr-notes',
  title: 'Plant a Note',
  icon: '\u{1F4F1}',
  size: 'full',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .qrn { display:flex; align-items:center; gap:24px; height:100%; }
      .qrn-code { flex:0 0 auto; width:132px; height:132px; border-radius:16px; background:#fff;
        padding:9px; display:grid; place-items:center; box-shadow:0 6px 18px rgba(0,0,0,.35); }
      .qrn-code img { width:100%; height:100%; display:block; image-rendering:pixelated; }
      .qrn-fallback { font-family:var(--font-mono); font-size:10px; color:#04140d; text-align:center;
        word-break:break-all; line-height:1.3; padding:4px; }
      .qrn-info { min-width:0; flex:1; }
      .qrn-h { font-family:var(--font-display); font-size:23px; line-height:1.12; color:var(--ink); }
      .qrn-sub { margin-top:8px; font-size:15px; line-height:1.42; color:var(--ink-soft); }
      .qrn-url { margin-top:11px; display:inline-block; max-width:100%; font-family:var(--font-mono);
        font-size:12px; color:var(--mint); background:rgba(120,247,176,.08);
        border:1px solid var(--stroke); border-radius:999px; padding:5px 13px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    `);
    body.appendChild(ctx.loading('printing a QR…'));

    // Resolve the destination: configured public (ngrok) URL, else this origin.
    let base = (ctx.config && ctx.config.publicUrl) || '';
    if (!base) { try { base = location.origin; } catch { base = ''; } }
    base = String(base).replace(/\/+$/, '');
    const target = `${base}/plant.html`;
    const pretty = target.replace(/^https?:\/\//, '');

    const tile = ctx.h('div', { class: 'qrn-code' });
    const info = ctx.h('div', { class: 'qrn-info' },
      ctx.h('div', { class: 'qrn-h' }, 'Plant a note from your phone'),
      ctx.h('div', { class: 'qrn-sub' }, 'Scan to grow the garden — your note is tended in at the next morning’s tending.'),
      ctx.h('a', { class: 'qrn-url', href: target }, pretty));

    // Build the QR via the keyless service (through the proxy). Fall back to a
    // readable text link inside the tile if the image fails to load.
    const showFallback = () => tile.replaceChildren(ctx.h('div', { class: 'qrn-fallback' }, pretty));
    const qrSrc = ctx.proxyUrl(
      `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=1&ecc=M&data=${encodeURIComponent(target)}`);
    const img = ctx.h('img', { alt: 'QR code to plant a note', src: qrSrc, onerror: showFallback });
    tile.appendChild(img);

    body.replaceChildren(ctx.h('div', { class: 'qrn' }, tile, info));
  },
};
