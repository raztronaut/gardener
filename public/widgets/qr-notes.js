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
      .qrn-info { min-width:0; flex:1; }
      .qrn-h { font-family:var(--font-display); font-size:17px; line-height:1.14; color:var(--ink); }
      .qrn-sub { margin-top:6px; font-size:12.5px; line-height:1.35; color:var(--ink-soft);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
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
      ctx.h('div', { class: 'qrn-h' }, 'Plant a note'),
      ctx.h('div', { class: 'qrn-sub' }, 'Scan with your phone to grow the garden — tended in next morning.'));

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
