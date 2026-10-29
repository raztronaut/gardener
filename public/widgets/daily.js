// Painting of the Day — one public-domain artwork about gardens, flowers, forests,
// jungles and the living world, from a CURATED list (public/lib/paintings.js,
// generated + verified against the Art Institute of Chicago and Met open-access APIs
// by tools/paintings.mjs). Rotates deterministically by day of year.
// The tile IS the painting (shown whole, fitted — never cropped) with a single
// caption line — title · artist; fullscreen shows it whole with date, medium, museum,
// a short plain-language story and a QR to the museum's page. The image loads
// straight from the museum (small for the tile, ~843 px only in fullscreen) and fades
// in once decoded inside a frame that is always full size.
// (Replaced Word of the Day 2026-10-28; On This Day + Quote removed 2026-10-29 —
// humans' request: the painting takes the front, very little text.)

// Day-of-year (1..366) in local time — stable for the whole day, rolls at midnight.
function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 864e5);
}
// The day's pick from a list (exported for smoke: deterministic per day).
export const pickByDay = (arr, d = new Date()) => arr[dayOfYear(d) % arr.length];

export default {
  id: 'daily',
  title: 'Painting of the Day',
  icon: '🖼️',
  size: 'tall',
  chrome: true,
  frame: false, // zigzag of open cards (2026-10-06)
  // Fullscreen: the painting large and uncropped (object-fit: contain in a fixed-height
  // stage, so the panel's size never depends on the picture), then title, artist,
  // date, medium · museum, the story and a QR to the museum's page.
  async openFull(body, ctx) {
    const wrap = ctx.h('div', { class: 'dly-full' });
    body.replaceChildren(wrap);
    if (!document.getElementById('style-daily-full')) {
      const st = document.createElement('style'); st.id = 'style-daily-full'; st.textContent = `
      .dly-full { padding:0 4px 8px; }
      .dly-pfull { display:flex; flex-direction:column; gap:22px; }
      .dly-pfull .dly-pimg { width:100%; height:820px; border-radius:0; background:none; }
      .dly-pfull .dly-pimg::after { display:none; }
      .dly-pfull .dly-pic { object-fit:contain; object-position:50% 50% !important; }
      .dly-pmeta { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:30px; align-items:start; }
      .dly-pcap { display:flex; flex-direction:column; gap:6px; min-width:0; }
      .dly-pfull .dly-ptitle { font-family:var(--font-display); font-size:36px; line-height:1.1; color:#fff; text-wrap:balance; }
      .dly-pfull .dly-partist { font-size:21px; color:var(--ink); }
      .dly-pfull .dly-pdate { font-family:var(--font-mono); font-size:17px; color:var(--ink-faint); }
      .dly-pmuseum { font-family:var(--font-mono); font-size:14px; letter-spacing:.16em; text-transform:uppercase;
        color:var(--ink-faint); margin-top:4px; }
      .dly-pblurb { margin-top:10px; font-size:19px; line-height:1.45; color:var(--ink-soft); text-wrap:pretty; }
      .dly-pblurb:empty { display:none; }
      .dly-pqrbox { display:flex; flex-direction:column; align-items:center; gap:8px; padding-top:6px; }
      .dly-pqr { width:120px; height:120px; image-rendering:pixelated; }
      .dly-pqrcap { max-width:132px; text-align:center; font-family:var(--font-mono); font-size:11.5px; line-height:1.35;
        letter-spacing:.16em; text-transform:uppercase; color:var(--ink-faint); }
    `; document.head.appendChild(st);
    }
    await this.mount(wrap, ctx, { full: true });
  },
  async mount(body, ctx, opts = {}) {
    const { h } = ctx;
    ctx.style(`
      /* The tile is the painting: a frame filling the card (cover-cropped at the entry's
         focal point) and one quiet caption line under it. Full size from the first
         paint; the picture fades in only once decoded (no loading text). */
      .dly-tile { display:flex; flex-direction:column; gap:10px; height:100%; min-height:0; }
      .dly-tile .dly-pimg { flex:1 1 auto; min-height:0; }
      /* the whole painting, never cropped: fitted into the frame (contain), centred,
         the rounding and hairline on the picture itself; the frame stays invisible */
      .dly-tile .dly-pimg { display:flex; align-items:center; justify-content:center; background:none; border-radius:0; overflow:visible; }
      .dly-tile .dly-pimg::after { display:none; }
      .dly-tile .dly-pic { position:static; width:auto; height:auto; max-width:100%; max-height:100%;
        object-fit:contain; border-radius:10px; box-shadow:0 0 0 1px var(--stroke), 0 10px 26px rgba(0,0,0,.35); }
      .dly-pimg { position:relative; border-radius:14px; overflow:hidden; background:rgba(255,255,255,.035); }
      .dly-pimg::after { content:''; position:absolute; inset:0; border-radius:inherit;
        box-shadow:inset 0 0 0 1px var(--stroke); pointer-events:none; }
      .dly-pic { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
        opacity:0; transition:opacity .7s linear; }
      .dly-pic.on { opacity:1; }
      @media (prefers-reduced-motion: reduce) { .dly-pic { transition:none; } }
      .dly-line { flex:none; font-size:14.5px; line-height:1.3; color:var(--ink-soft);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .dly-line b { font-weight:600; color:var(--ink); }
    `);

    // ---- PAINTING OF THE DAY: curated list, one per day -------------------------
    // The list is a local module (lib/paintings.js, imported on demand so the smoke
    // test can still import this file in Node). The section is built at its final
    // size up front: a fixed frame + caption lines; text fills in as soon as the
    // module resolves, the picture fades in once decoded. A failed image simply
    // leaves the quiet empty frame (never a broken-image icon or loading text).
    const full = !!opts.full;
    const imgBox = h('div', { class: 'dly-pimg' });
    const titleEl = h('div', { class: 'dly-ptitle' });
    const artistEl = h('div', { class: 'dly-partist' });
    const dateEl = h('div', { class: 'dly-pdate' });
    // Fullscreen-only extras: museum line, blurb, and a QR to the museum's page.
    const museumEl = h('div', { class: 'dly-pmuseum' });
    const blurbEl = h('div', { class: 'dly-pblurb' });
    const qrImg = h('img', { class: 'dly-pqr', alt: 'museum page' });
    qrImg.onerror = () => { qrImg.style.visibility = 'hidden'; };
    const qrCap = h('div', { class: 'dly-pqrcap' }, 'scan for the museum page');
    const lineEl = h('div', { class: 'dly-line' });
    const root = full
      ? h('div', { class: 'dly-pfull' }, imgBox,
        h('div', { class: 'dly-pmeta' },
          h('div', { class: 'dly-pcap' }, titleEl, artistEl, dateEl, museumEl, blurbEl),
          h('div', { class: 'dly-pqrbox' }, qrImg, qrCap)))
      : h('div', { class: 'dly-tile' }, imgBox, lineEl);
    body.replaceChildren(root);
    let shownId = '';
    const showPainting = (p) => {
      if (!p || p.id === shownId) return;
      shownId = p.id;
      titleEl.textContent = p.title;
      artistEl.textContent = p.artist || 'Unknown artist';
      lineEl.replaceChildren(h('b', {}, p.title), ` · ${p.artist || 'Unknown artist'}`);
      dateEl.textContent = full ? (p.date || '') : [p.date, p.museumShort].filter(Boolean).join(' · ');
      if (full) {
        museumEl.textContent = [p.medium, p.museum].filter(Boolean).join(' · ');
        blurbEl.textContent = p.blurb || p.note || '';
        qrImg.src = `/api/proxy?url=${encodeURIComponent(`https://quickchart.io/qr?text=${encodeURIComponent(p.url)}&dark=eafff4&light=00000000&ecLevel=M&margin=1&size=180&format=png`)}`;
      }
      // Load + decode off-screen, then swap in and fade (the frame never resizes).
      // Straight from the museum first (browser-cached, no server hop); if that is
      // refused — the AIC's Cloudflare turns away headless browsers, e.g. the
      // tending's screenshot review — retry once through the allowlisted proxy.
      const src = full ? p.full : p.img;
      const load = (url, noRef) => {
        const img = new Image();
        img.className = 'dly-pic';
        img.alt = `${p.title}, ${p.artist}`;
        img.decoding = 'async';
        // No Referer: the AIC image CDN answers 403 to a localhost referer.
        if (noRef) img.referrerPolicy = 'no-referrer';
        img.style.objectPosition = p.focus || '50% 50%';
        img.src = url;
        return img.decode().then(() => img);
      };
      load(src, true)
        .catch(() => load(`/api/proxy?url=${encodeURIComponent(src)}`, false))
        .then((img) => {
          if (shownId !== p.id) return;           // the day rolled over meanwhile
          imgBox.replaceChildren(img);
          requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('on')));
        })
        .catch(() => { /* keep the quiet empty frame */ });
    };
    let paintings = null;
    const loadPaintings = async () => {
      if (paintings) return paintings;
      const mod = await import(`/lib/paintings.js?v=${window.__GARDEN_VERSION || ''}`);
      const list = mod && mod.default && Array.isArray(mod.default.paintings) ? mod.default.paintings : [];
      if (list.length) paintings = list;
      return paintings;
    };
    const today = () => loadPaintings().then((l) => l && showPainting(pickByDay(l))).catch(() => {});
    today();
    // roll over at midnight (cheap: a no-op until the day's pick changes)
    ctx.interval(today, 10 * 60 * 1000);
  },
};
