// Motion — a filmstrip of recent motion-detected camera snapshots, styled like an
// iOS Photos row. A Python blinkpy daemon (src/blink/) saves motion clips and
// thumbnails; this widget reads the localhost read-only /api/blink/motion feed
// (same-origin, NOT the external proxy) and lays the newest thumbnails out in a
// single full-width row, newest first, left→right. Only events that carry a
// `thumb` render an image tile; each tile shows a small relative-time caption and
// handles a missing/broken image without breaking the row. Degrades gracefully:
//   • initial API error  → retry a few times, then a calm "unavailable" line
//   • empty events array  → a quiet "No motion captured yet" state (common case)
//   • failed refresh      → keeps the last good render (fetch BEFORE replacing DOM)
// Tapping the card opens a fullscreen grid of ALL recent thumbnails.
const MOTION_URL = '/api/blink/motion';
const thumbSrc = (t) => `/api/blink/motion/${encodeURIComponent(t)}`;

// Relative-time caption, kept terse for the small corner label.
function ago(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// Full timestamp for the fullscreen grid (e.g. "Jul 11 · 2:14 PM").
function fullWhen(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  try {
    return new Date(t).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return ''; }
}

// Fetch the motion feed with a short retry/backoff for the INITIAL load. Returns
// the events array (newest first) or throws after exhausting retries.
async function fetchMotion({ retries = 0 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(MOTION_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      return Array.isArray(data && data.events) ? data.events : [];
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((res) => setTimeout(res, 400 + attempt * 500));
    }
  }
  throw lastErr || new Error('motion feed unavailable');
}

// An <img> that hides itself on error, leaving a calm placeholder tile — so a
// missing file on disk never breaks the row layout.
function tileImage(ctx, thumb, alt) {
  const { h } = ctx;
  const img = h('img', { class: 'mg-img', src: thumbSrc(thumb), alt: alt || '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('load', () => { img.style.opacity = '1'; });
  img.addEventListener('error', () => { img.style.display = 'none'; });
  return img;
}

export default {
  id: 'motion-gallery',
  title: 'Motion',
  icon: '📸',
  size: 'lg', // full-width single-row card
  chrome: true,

  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      /* The card gets a definite height from the grid row, so height:100% + flex
         fill it; the strip flexes and the absolutely-filled tiles get real height. */
      .mg { display:flex; flex-direction:column; gap:9px; height:100%; min-height:0; }

      /* header line — "Motion · recent" with a total count on the right */
      .mg-head { display:flex; align-items:baseline; gap:8px; flex:0 0 auto; }
      .mg-head .lbl { font-family:var(--font-mono); font-size:10px; letter-spacing:.16em;
        text-transform:uppercase; color:var(--ink-faint); }
      .mg-head .sub { font-family:var(--font-mono); font-size:10px; letter-spacing:.08em;
        color:var(--ink-faint); opacity:.7; }
      .mg-head .count { margin-left:auto; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.08em; color:var(--ink-soft); }

      /* the filmstrip — a single row of equal tiles filling the card width */
      .mg-strip { display:flex; gap:10px; flex:1 1 auto; min-height:0; align-items:stretch; }
      .mg-tile { position:relative; flex:1 1 0; min-width:0; border-radius:14px; overflow:hidden;
        background:#06140f; border:1px solid var(--stroke); }
      .mg-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;
        opacity:0; transition:opacity .45s ease; }
      /* placeholder shown behind every image — a quiet camera glyph on dark green,
         so a hidden/broken <img> still reads as an intentional tile */
      .mg-ph { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        font-size:22px; color:var(--ink-faint); opacity:.4;
        background:radial-gradient(120% 90% at 50% 40%, #0c2419, #06140f); }
      /* corner time caption over a small scrim */
      .mg-cap { position:absolute; left:0; right:0; bottom:0; padding:14px 8px 6px;
        font-family:var(--font-mono); font-size:10.5px; letter-spacing:.03em; color:rgba(255,255,255,.92);
        background:linear-gradient(to top, rgba(0,0,0,.7), transparent); pointer-events:none; }
      .mg-cam { display:block; font-size:9px; color:rgba(255,255,255,.72); letter-spacing:.02em;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* "+N more" overlay on the last tile */
      .mg-more { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        background:rgba(6,20,15,.62); font-family:var(--font-display); font-weight:700;
        font-size:22px; color:var(--ink); }
      .mg-more span { font-family:var(--font-mono); font-size:11px; color:var(--ink-soft);
        letter-spacing:.06em; margin-left:4px; font-weight:400; }

      /* fade-in for tiles (one-shot, no perpetual animation) */
      .mg-tile { animation:mg-in .45s ease both; }
      @keyframes mg-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
    `);
    body.classList.add('mg');

    // Per the humans' standing preference, this widget is CONDITIONAL: it only
    // occupies the wall when there is motion to show. When the feed is empty (the
    // common case) or unreachable on the first load, we hide the entire card so it
    // leaves no empty placeholder behind; it reappears the moment a clip arrives.
    const card = body.closest('.card');
    const setHidden = (hide) => { if (card) card.style.display = hide ? 'none' : ''; };

    // How many tiles fit in one full-width row. Computed from the card width, with
    // a sensible clamp so it stays legible (never one giant tile, never a dozen
    // slivers). Falls back to 6 before layout is known.
    const TILE_MIN = 132; // px — target minimum tile width including the gap
    const tileCount = () => {
      const w = body.clientWidth || 0;
      if (!w) return 6;
      return Math.max(4, Math.min(7, Math.floor((w + 10) / TILE_MIN)));
    };

    const render = (events) => {
      const withThumb = events.filter((e) => e && e.thumb);

      // No motion → the widget removes itself from the wall entirely.
      if (!withThumb.length) {
        setHidden(true);
        body.replaceChildren();
        return;
      }
      setHidden(false);

      const head = h('div', { class: 'mg-head' },
        h('span', { class: 'lbl' }, 'Motion'),
        h('span', { class: 'sub' }, '· recent'),
        h('span', { class: 'count' },
          `${withThumb.length} clip${withThumb.length === 1 ? '' : 's'}`));

      const n = tileCount();
      const shown = withThumb.slice(0, n);
      const overflow = withThumb.length - shown.length;
      const strip = h('div', { class: 'mg-strip' });

      shown.forEach((ev, i) => {
        const isLast = i === shown.length - 1;
        const cap = h('div', { class: 'mg-cap' },
          ago(ev.ts),
          ev.camera ? h('span', { class: 'mg-cam' }, ev.camera) : null);
        const kids = [
          h('div', { class: 'mg-ph' }, '📷'),
          tileImage(ctx, ev.thumb, ev.camera),
          cap,
        ];
        // The last tile absorbs the "+N more" overlay when there are extra events.
        if (isLast && overflow > 0) {
          kids.push(h('div', { class: 'mg-more' }, `+${overflow}`, h('span', {}, 'more')));
        }
        strip.appendChild(h('div', { class: 'mg-tile' }, ...kids));
      });

      body.replaceChildren(head, strip);
    };

    // Periodic refresh: fetch BEFORE touching the DOM so a failed poll keeps the
    // last good render. The very first poll retries a few times before showing a
    // calm error, and treats an empty array as the (common) empty state.
    let firstLoad = true;
    const poll = async () => {
      try {
        const events = await fetchMotion({ retries: firstLoad ? 3 : 0 });
        body.dataset.loaded = '1';
        render(events);
      } catch {
        // If we've never rendered anything good, there is nothing to show — hide
        // the card (no motion, no clutter). If we HAD a good render, keep the last
        // good strip on screen and just skip this failed poll.
        if (!body.dataset.loaded) {
          setHidden(true);
          body.replaceChildren();
        }
      } finally {
        firstLoad = false;
      }
    };

    body.appendChild(ctx.loading('reaching the cameras…'));
    ctx.interval(poll, 30000);
  },

  // Fullscreen gallery — a responsive grid of ALL recent motion thumbnails (capped),
  // each with camera name + full timestamp. Tapping a tile enlarges it, iOS-style.
  async openFull(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .mgf { display:flex; flex-direction:column; height:100%; min-height:0; gap:14px; }
      .mgf-head { flex:0 0 auto; font-family:var(--font-mono); font-size:13px; letter-spacing:.06em;
        color:var(--ink-soft); }
      .mgf-grid { flex:1; min-height:0; overflow:auto; display:grid;
        grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:14px; align-content:start;
        padding-right:4px; }
      .mgf-cell { position:relative; aspect-ratio:4/3; border-radius:16px; overflow:hidden; cursor:pointer;
        background:#06140f; border:1px solid var(--stroke); }
      .mgf-cell .mgf-ph { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        font-size:30px; color:var(--ink-faint); opacity:.4;
        background:radial-gradient(120% 90% at 50% 40%, #0c2419, #06140f); }
      .mgf-cell img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;
        opacity:0; transition:opacity .45s ease; }
      .mgf-meta { position:absolute; left:0; right:0; bottom:0; padding:22px 12px 9px;
        background:linear-gradient(to top, rgba(0,0,0,.74), transparent); pointer-events:none; }
      .mgf-meta .cam { font-family:var(--font-display); font-weight:700; font-size:15px; color:#fff;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .mgf-meta .when { font-family:var(--font-mono); font-size:11px; color:rgba(255,255,255,.82);
        letter-spacing:.03em; margin-top:2px; }

      .mgf-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:12px; text-align:center; color:var(--ink-soft); }
      .mgf-empty .ic { font-size:44px; opacity:.6; }
      .mgf-empty .t { font-size:20px; color:var(--ink); font-weight:600; }
      .mgf-empty .d { font-size:15px; color:var(--ink-faint); }

      /* iOS-style fullscreen lightbox for a single enlarged frame */
      .mgf-light { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:14px; padding:24px;
        background:rgba(4,12,9,.94); }
      .mgf-light img { max-width:100%; max-height:80%; object-fit:contain; border-radius:14px;
        border:1px solid var(--stroke); }
      .mgf-light .cap { font-family:var(--font-mono); font-size:14px; color:var(--ink-soft);
        letter-spacing:.05em; text-align:center; }
      .mgf-light .hint { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); }
    `);
    body.classList.add('mgf');
    body.replaceChildren(h('div', { class: 'mgf-head' }, 'loading recent motion…'));

    let events;
    try {
      events = await fetchMotion({ retries: 2 });
    } catch {
      body.replaceChildren(h('div', { class: 'mgf-empty' },
        h('div', { class: 'ic' }, '📷'),
        h('div', { class: 't' }, 'Motion feed unavailable'),
        h('div', { class: 'd' }, 'The camera service is not reachable right now — try again shortly.')));
      return;
    }

    const withThumb = events.filter((e) => e && e.thumb).slice(0, 60);
    if (!withThumb.length) {
      body.replaceChildren(h('div', { class: 'mgf-empty' },
        h('div', { class: 'ic' }, '📸'),
        h('div', { class: 't' }, 'No motion captured yet'),
        h('div', { class: 'd' }, 'Snapshots appear here when a camera sees movement.')));
      return;
    }

    // Enlarge a single frame, centered, dismiss on tap.
    const openLight = (ev) => {
      const big = h('img', { src: thumbSrc(ev.thumb), alt: ev.camera || '' });
      big.addEventListener('load', () => { big.style.opacity = '1'; });
      const light = h('div', { class: 'mgf-light' },
        big,
        h('div', { class: 'cap' }, [ev.camera, fullWhen(ev.ts)].filter(Boolean).join('  ·  ')),
        h('div', { class: 'hint' }, 'tap to close'));
      big.style.opacity = '0';
      light.addEventListener('click', () => light.remove());
      body.appendChild(light);
    };

    const grid = h('div', { class: 'mgf-grid' });
    withThumb.forEach((ev) => {
      const img = h('img', { src: thumbSrc(ev.thumb), alt: ev.camera || '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('load', () => { img.style.opacity = '1'; });
      img.addEventListener('error', () => { img.style.display = 'none'; });
      grid.appendChild(h('div', { class: 'mgf-cell', onclick: () => openLight(ev) },
        h('div', { class: 'mgf-ph' }, '📷'),
        img,
        h('div', { class: 'mgf-meta' },
          h('div', { class: 'cam' }, ev.camera || 'Camera'),
          h('div', { class: 'when' }, fullWhen(ev.ts)))));
    });

    body.replaceChildren(
      h('div', { class: 'mgf-head' }, `${withThumb.length} recent motion snapshot${withThumb.length === 1 ? '' : 's'} · tap any frame to enlarge`),
      grid);
  },
};
