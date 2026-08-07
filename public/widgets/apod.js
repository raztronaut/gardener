// Astronomy Photo of the Day — NASA's daily space image, framed like a picture
// on the wall. Sits in the tall (half-width × 2-row) slot vacated by a camera
// widget. The image fills the card (object-fit:cover); the title + date float on
// a bottom gradient scrim. Data via the keyless DEMO_KEY endpoint through the
// SSRF-safe proxy; the image itself is also fetched through the proxy and only
// swapped in on a CLEAN decode (never a broken-image icon). APOD updates once a
// day, so we refresh every 6 hours and KEEP the last good render if a refresh
// fails. No perpetual animation — a single one-shot fade-in on image load.
//
// media_type may be "video" (~1 day in 20). We DON'T embed it (no iframe / no
// autoplay on this low-power kiosk): a calm placeholder card carries the title,
// date and a small "🎬 video — view on nasa.gov" caption instead.

const API = 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY';

// "2026-07-28" → "July 28, 2026" (parsed as a plain date, no timezone drift).
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const MON = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const mon = MON[parseInt(m[2], 10) - 1] || '';
  return `${mon} ${parseInt(m[3], 10)}, ${m[1]}`;
}

// NASA's explanation arrives as one long paragraph, sometimes with double spaces
// and stray line breaks. Collapse it to a single clean run of text; the CSS
// line-clamp handles length, so we keep the full string for the tooltip.
function tidy(text) {
  return (text || '').toString().replace(/\s+/g, ' ').trim();
}

// A quiet freshness label for the picture's date, relative to "today" in the
// display timezone. NASA publishes a new APOD once a day, so this tells the wall
// at a glance whether it's looking at the very latest image. The two freshest
// days read in bright mint ("TODAY" / "YESTERDAY"); an older picture — the feed
// hasn't refreshed — reads as a muted "N DAYS AGO" so staleness is honest without
// shouting. A not-yet-local "tomorrow" edge case near midnight (days < 0) stays
// unlabelled. Returns { text, stale } or null.
function freshnessTag(iso, tz) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!a) return null;
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(todayStr);
  if (!b) return null;
  const days = Math.round(
    (Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 864e5);
  if (days < 0) return null;
  if (days === 0) return { text: 'TODAY', stale: false };
  if (days === 1) return { text: 'YESTERDAY', stale: false };
  return { text: `${days} DAYS AGO`, stale: true };
}

export default {
  id: 'apod',
  title: 'Astronomy Photo',
  icon: '🔭',
  size: 'tall', // half-width × 2 rows — a framed portrait-ish space photo
  chrome: true,

  async mount(body, ctx) {
    const { h } = ctx;
    const tz = ctx.config?.tz || 'America/Los_Angeles';
    ctx.style(`
      .apod { position:relative; width:100%; height:100%; min-height:0; border-radius:16px;
        overflow:hidden; background:#05070f; border:1px solid var(--stroke); }
      /* the photo fills the whole card; only fades in once it has cleanly decoded */
      .apod-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
        display:block; opacity:0; transition:opacity .7s ease; }
      .apod-img.in { opacity:1; }
      /* calm placeholder — a deep starfield wash beneath everything, shown until a
         frame decodes (and for video days). Never a bare black box / broken image. */
      .apod-ph { position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:10px; text-align:center;
        color:var(--ink-soft); padding:24px;
        background:radial-gradient(130% 100% at 50% 30%, #16204a 0%, #0a0f28 48%, #05070f 100%); }
      .apod-ph .ic { font-size:38px; opacity:.7; filter:drop-shadow(0 2px 10px rgba(0,0,0,.5)); }
      .apod-ph .t { font-family:var(--font-mono); font-size:12px; letter-spacing:.06em;
        color:var(--ink-faint); }
      /* video-day placeholder carries the real title + date + a small caption */
      .apod-ph.vid .vt { font-family:var(--font-display); font-weight:700; font-size:18px;
        line-height:1.2; color:var(--ink); max-width:92%;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .apod-ph.vid .vd { font-family:var(--font-mono); font-size:11px; letter-spacing:.05em;
        color:var(--ink-soft); }
      .apod-ph.vid .vc { display:inline-flex; align-items:center; gap:6px; margin-top:4px;
        padding:5px 12px; border-radius:999px; background:rgba(8,14,34,.6);
        border:1px solid var(--stroke-strong); font-family:var(--font-mono);
        font-size:10.5px; letter-spacing:.06em; color:var(--ink-soft); }
      /* bottom scrim + caption overlaid on the photo — absolutely positioned so it
         can never push the card taller than its fixed 9:16 slot. */
      .apod-scrim { position:absolute; left:0; right:0; bottom:0; height:52%; pointer-events:none;
        background:linear-gradient(to top, rgba(0,0,0,.82) 0%, rgba(0,0,0,.5) 42%, transparent 100%); }
      .apod-cap { position:absolute; left:15px; right:15px; bottom:13px; }
      .apod-title { font-family:var(--font-display); font-weight:700; font-size:18px; line-height:1.22;
        color:#fff; text-shadow:0 1px 8px rgba(0,0,0,.7);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .apod-date { margin-top:5px; font-family:var(--font-mono); font-size:11px; letter-spacing:.05em;
        color:rgba(234,255,244,.72); text-shadow:0 1px 5px rgba(0,0,0,.7);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .apod-date .cr { color:rgba(234,255,244,.5); }
      /* freshness chip — a hushed pill naming how recent the picture is, so a
         glance tells whether the wall is showing today's newest image. */
      .apod-fresh { display:inline-block; margin-right:8px; padding:1px 7px; border-radius:999px;
        font-family:var(--font-mono); font-size:9.5px; font-weight:700; letter-spacing:.1em;
        color:var(--mint); background:rgba(120,247,176,.16); border:1px solid rgba(120,247,176,.34);
        vertical-align:1px; text-shadow:none; }
      /* stale (2+ days old) — the feed hasn't refreshed; a hushed neutral pill
         so it's honest but never alarming. */
      .apod-fresh.stale { color:rgba(234,255,244,.6); background:rgba(255,255,255,.08);
        border-color:rgba(255,255,255,.16); }
      /* a quiet museum caption — NASA's own words on today's image, clamped to two
         lines so the photo stays the hero. Hidden entirely when absent. Sits over
         the scrim (absolutely positioned) so it can never grow the card's height. */
      .apod-desc { margin-top:8px; font-size:12.5px; line-height:1.42; font-weight:400;
        color:rgba(234,255,244,.84); text-shadow:0 1px 6px rgba(0,0,0,.85);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      /* the same caption, styled for the video-day placeholder card */
      .apod-ph.vid .vx { margin-top:2px; max-width:92%; font-size:12.5px; line-height:1.42;
        color:var(--ink-soft);
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    `);
    body.classList.add('apod');

    // Placeholder shown until the first clean decode; stays in the DOM (behind the
    // image) so a decode failure just leaves the calm starfield, never blank.
    const phTxt = h('div', { class: 't' }, 'reaching for the stars…');
    const ph = h('div', { class: 'apod-ph' }, h('div', { class: 'ic' }, '🔭'), phTxt);
    const img = h('img', { class: 'apod-img', alt: '' });
    const titleEl = h('div', { class: 'apod-title' });
    const dateEl = h('div', { class: 'apod-date' });
    const descEl = h('div', { class: 'apod-desc' });
    const cap = h('div', { class: 'apod-cap' }, titleEl, dateEl, descEl);
    const scrim = h('div', { class: 'apod-scrim' });

    // Decode an image THROUGH the proxy into a detached Image; resolve only on a
    // clean load so we never swap in a broken frame. Reject on error/timeout.
    const decode = (src) => new Promise((resolve, reject) => {
      const pre = new Image();
      const to = setTimeout(() => { pre.onload = pre.onerror = null; reject(new Error('timeout')); }, 22000);
      pre.onload = () => { clearTimeout(to); resolve(pre.src); };
      pre.onerror = () => { clearTimeout(to); reject(new Error('decode')); };
      pre.src = ctx.proxyUrl(src);
    });

    // Render an IMAGE day: preload+decode FIRST, then reveal — so a failed refresh
    // never wipes a good picture already on screen.
    const renderPhoto = async (d) => {
      const src = await decode(d.url); // rejects → caller keeps the last good render
      img.src = src;
      titleEl.textContent = d.title || 'Astronomy Picture of the Day';
      const fresh = freshnessTag(d.date, tz);
      dateEl.replaceChildren(
        fresh ? h('span', { class: `apod-fresh${fresh.stale ? ' stale' : ''}` }, fresh.text) : null,
        fmtDate(d.date), d.copyright
          ? h('span', { class: 'cr' }, `  ·  © ${String(d.copyright).replace(/\s+/g, ' ').trim()}`) : null);
      // Museum caption — NASA's own words, clamped to two lines. Hidden when absent.
      const blurb = tidy(d.explanation);
      descEl.textContent = blurb;
      descEl.title = blurb;
      descEl.style.display = blurb ? '' : 'none';
      body.replaceChildren(img, scrim, cap);
      // one-shot fade-in (next frame so the transition takes)
      requestAnimationFrame(() => img.classList.add('in'));
    };

    // Render a VIDEO day (or an image with no usable url): a calm placeholder that
    // still shows the title + date. No iframe, no autoplay.
    const renderVideo = (d) => {
      const blurb = tidy(d.explanation);
      const fresh = freshnessTag(d.date, tz);
      body.replaceChildren(h('div', { class: 'apod-ph vid' },
        h('div', { class: 'ic' }, '🎬'),
        h('div', { class: 'vt' }, d.title || 'Astronomy Video of the Day'),
        h('div', { class: 'vd' },
          fresh ? h('span', { class: `apod-fresh${fresh.stale ? ' stale' : ''}` }, fresh.text) : null, fmtDate(d.date)),
        blurb ? h('div', { class: 'vx', title: blurb }, blurb) : null,
        h('div', { class: 'vc' }, '🎬 video — view on nasa.gov')));
    };

    const render = async (d) => {
      if (!d || (!d.url && d.media_type !== 'video')) throw new Error('empty');
      if (d.media_type === 'video' || !d.url) renderVideo(d);
      else await renderPhoto(d);
      body.dataset.loaded = '1';
    };

    const fetchApod = () => ctx.fetchJSON(API);

    try {
      body.replaceChildren(ph);

      // Initial load: retry a few times with short backoff so one slow/aborted
      // response doesn't leave a graceful error up for a whole refresh cycle.
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try { await render(await fetchApod()); ok = true; }
        catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt)); }
      }
      if (!ok && !body.dataset.loaded) {
        // Graceful error that FILLS the card (never a bare black box).
        phTxt.textContent = 'Astronomy photo unavailable';
        body.replaceChildren(ph);
      }

      // APOD changes once/day; check every 6 hours. On failure KEEP the last good
      // render (render() only replaces the DOM after a clean fetch + decode).
      // ctx.interval fires immediately, so skip that first synchronous tick — the
      // initial retry loop above already produced (or is producing) the first paint.
      let firstTick = true;
      ctx.interval(() => {
        if (firstTick) { firstTick = false; return; }
        fetchApod().then(render).catch(() => {});
      }, 6 * 60 * 60 * 1000);
    } catch (e) {
      // mount() must never throw.
      phTxt.textContent = 'Astronomy photo unavailable';
      body.replaceChildren(ph);
    }
  },
};
