// Daily Almanac — three stacked "of the day" sections that roll over at midnight:
//   🖼 Painting of the day — one public-domain artwork about gardens, flowers,
//        forests, jungles and the living world, from a CURATED list
//        (public/lib/paintings.js, generated + verified against the Art Institute of
//        Chicago and Met open-access APIs by tools/paintings.mjs). Rotates
//        deterministically by day of year (pickByDay). The image loads straight from
//        the museum's image server (no proxy), small for the tile and ~843 px only in
//        fullscreen; it fades in once decoded, inside a box that is always full size.
//        Replaced the Word of the Day on 2026-10-28 (humans' request).
//   📜 On this day        — a rotating mix of today's historical events plus the
//        notable people born and who died on this date, from Wikipedia's keyless
//        onthisday feed; each birth/death is tagged so it reads unambiguously.
//        Gracefully falls back to an embedded "Fact of the day" when the network
//        is unavailable, so it never blanks.
//   ❝  Quote of the day   — zenquotes.io/today, embedded fallback.
// Sits beside the Weather card (both 'tall'). Network is best-effort: initial load
// retries with short backoff, periodic refresh fetches BEFORE replacing the DOM so a
// failure keeps the last good render. Embedded data guarantees content fully offline.

// ---- FACT OF THE DAY — embedded fallback -----------------------------------
const FACTS = [
  'Honey never spoils — archaeologists have found 3,000-year-old jars in Egyptian tombs still perfectly edible.',
  'Octopuses have three hearts and blue blood; two hearts pump to the gills and one to the body.',
  'A day on Venus is longer than its year — it rotates slower than it orbits the Sun.',
  'Bananas are berries, but strawberries are not, botanically speaking.',
  'The Eiffel Tower can grow more than 15 cm taller in summer as the iron expands in the heat.',
  'Wombats produce cube-shaped droppings, which keep them from rolling off the rocks they mark.',
  'There are more possible games of chess than there are atoms in the observable universe.',
  'Sharks existed before trees — they have been around for over 400 million years.',
  'A group of flamingos is called a “flamboyance.”',
  'Hot water can freeze faster than cold water under some conditions — the Mpemba effect.',
  'The shortest war in history lasted about 38 minutes, between Britain and Zanzibar in 1896.',
  'Sea otters hold hands while sleeping so they do not drift apart on the water.',
  'A single bolt of lightning is roughly five times hotter than the surface of the Sun.',
  'The human nose can distinguish more than one trillion different scents.',
  'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
  'Tardigrades can survive the vacuum of space, extreme radiation, and being boiled or frozen.',
  'A teaspoon of neutron star material would weigh about six billion tons on Earth.',
  'The dot over a lowercase “i” or “j” is called a tittle.',
  'Bees can recognise human faces by combining their facial features the way we do.',
  'The Great Wall of China is not visible from space with the naked eye, despite the myth.',
  'A jiffy is an actual unit of time — one hundredth of a second.',
  'Some turtles can breathe through their rear ends while hibernating underwater.',
  'The longest place name on Earth has 85 letters, a hill in New Zealand.',
  'Cows have best friends and can become stressed when they are separated from them.',
  'The inventor of the frisbee was turned into a frisbee — his ashes were molded into discs.',
  'Venus is the only planet in our solar system that spins clockwise.',
  'A bolt of lightning contains enough energy to toast about 100,000 slices of bread.',
  'Scotland’s national animal is the unicorn.',
  'Your stomach lining replaces itself every few days to avoid digesting itself.',
  'Saturn would float in water if there were a bathtub big enough — it is less dense than water.',
  'Butterflies taste with their feet to find out whether a leaf is good for laying eggs.',
  'The hashtag symbol is technically called an octothorpe.',
];

// ---- QUOTE OF THE DAY — embedded fallback ----------------------------------
const QUOTES = [
  { q: 'The only way to do great work is to love what you do.', a: 'Steve Jobs' },
  { q: 'In the middle of difficulty lies opportunity.', a: 'Albert Einstein' },
  { q: 'What we think, we become.', a: 'Buddha' },
  { q: 'The best way to predict the future is to invent it.', a: 'Alan Kay' },
  { q: 'It always seems impossible until it’s done.', a: 'Nelson Mandela' },
  { q: 'Whether you think you can or you think you can’t, you’re right.', a: 'Henry Ford' },
  { q: 'The journey of a thousand miles begins with one step.', a: 'Lao Tzu' },
  { q: 'Happiness is not something ready made. It comes from your own actions.', a: 'Dalai Lama' },
  { q: 'Do what you can, with what you have, where you are.', a: 'Theodore Roosevelt' },
  { q: 'The mind is everything. What you think you become.', a: 'Buddha' },
  { q: 'An unexamined life is not worth living.', a: 'Socrates' },
  { q: 'Simplicity is the ultimate sophistication.', a: 'Leonardo da Vinci' },
  { q: 'We are what we repeatedly do. Excellence, then, is a habit.', a: 'Aristotle' },
  { q: 'Turn your wounds into wisdom.', a: 'Oprah Winfrey' },
  { q: 'The only limit to our realization of tomorrow is our doubts of today.', a: 'Franklin D. Roosevelt' },
  { q: 'Everything you can imagine is real.', a: 'Pablo Picasso' },
  { q: 'Life is what happens when you’re busy making other plans.', a: 'John Lennon' },
  { q: 'It does not matter how slowly you go as long as you do not stop.', a: 'Confucius' },
  { q: 'The future belongs to those who believe in the beauty of their dreams.', a: 'Eleanor Roosevelt' },
  { q: 'You miss 100% of the shots you don’t take.', a: 'Wayne Gretzky' },
  { q: 'Act as if what you do makes a difference. It does.', a: 'William James' },
  { q: 'Quality is not an act, it is a habit.', a: 'Aristotle' },
  { q: 'If you want to lift yourself up, lift up someone else.', a: 'Booker T. Washington' },
  { q: 'Wherever you go, go with all your heart.', a: 'Confucius' },
  { q: 'Keep your face always toward the sunshine, and shadows will fall behind you.', a: 'Walt Whitman' },
  { q: 'A room without books is like a body without a soul.', a: 'Cicero' },
  { q: 'The best revenge is massive success.', a: 'Frank Sinatra' },
  { q: 'Nothing is impossible, the word itself says “I’m possible.”', a: 'Audrey Hepburn' },
  { q: 'Dream big and dare to fail.', a: 'Norman Vaughan' },
  { q: 'Stay hungry, stay foolish.', a: 'Stewart Brand' },
  { q: 'What you do speaks so loudly that I cannot hear what you say.', a: 'Ralph Waldo Emerson' },
];

// ---- QUOTE AUTHORS — a quiet role/era for each embedded author (offline, keyed
// by name). A separate map so QUOTES is never
// touched, and a missing entry (e.g. an unfamiliar author from the live feed)
// simply renders no role tag. Concise — one or two words that place the voice.
const AUTHORS = {
  'Steve Jobs': 'Apple co-founder',
  'Albert Einstein': 'physicist',
  'Buddha': 'spiritual teacher',
  'Alan Kay': 'computer scientist',
  'Nelson Mandela': 'statesman',
  'Henry Ford': 'industrialist',
  'Lao Tzu': 'Taoist sage',
  'Dalai Lama': 'spiritual leader',
  'Theodore Roosevelt': 'US president',
  'Socrates': 'philosopher',
  'Leonardo da Vinci': 'polymath',
  'Aristotle': 'philosopher',
  'Oprah Winfrey': 'broadcaster',
  'Franklin D. Roosevelt': 'US president',
  'Pablo Picasso': 'painter',
  'John Lennon': 'musician',
  'Confucius': 'philosopher',
  'Eleanor Roosevelt': 'diplomat',
  'Wayne Gretzky': 'hockey great',
  'William James': 'psychologist',
  'Booker T. Washington': 'educator',
  'Walt Whitman': 'poet',
  'Cicero': 'Roman orator',
  'Frank Sinatra': 'singer',
  'Audrey Hepburn': 'actor',
  'Norman Vaughan': 'explorer',
  'Stewart Brand': 'writer',
  'Ralph Waldo Emerson': 'essayist',
};

// Day-of-year (1..366) in local time — stable for the whole day, rolls at midnight.
function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 864e5);
}
const pickByDay = (arr) => arr[dayOfYear() % arr.length];
// Stable per-day key (local time) — caches the day's Wikidata notability lookup.
const todayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// Wikipedia returns negative years for BC — render legibly, never as "-480".
const fmtYear = (y) => (y < 0 ? `${-y} BC` : String(y));
const p2 = (n) => String(n).padStart(2, '0');
// A relative "how long ago" phrase for a historical year — grounds a bare date
// in lived time ("1906 · 120 yrs ago"). BC years land far in the past, which is
// correct; the off-by-one from the missing year 0 is immaterial for an ambient wall.
const relYears = (y, nowY = new Date().getFullYear()) => {
  const n = nowY - y;
  if (n <= 0) return 'this year';
  return `${n.toLocaleString()} ${n === 1 ? 'yr' : 'yrs'} ago`;
};
// A "round anniversary" of a historical year — exactly a multiple of 25 years ago
// to the day (the 25th, 50th, 100th, 150th…). On an ambient almanac this turns an
// ordinary date into a quiet occasion. It fires RARELY (only when a rotating
// moment happens to land on a milestone), so the section stays calm and speaks up
// only when there's a genuine anniversary to mark. Returns { years } or null
// (this-year / non-round); the BC off-by-one is immaterial for a wall. Exported
// for smoke — the "multiple of 25, ≥ 25" rule is the invariant.
export function milestoneOf(year, nowY = new Date().getFullYear()) {
  if (!Number.isFinite(year)) return null;
  const n = nowY - year;
  if (n >= 25 && n % 25 === 0) return { years: n };
  return null;
}

export default {
  id: 'daily',
  title: 'Today',
  icon: '🖼️',
  size: 'tall',
  chrome: true,
  frame: false, // zigzag of open cards (2026-10-06)
  // Fullscreen: the day's painting large and uncropped (object-fit: contain in a
  // fixed-height stage, so the panel's size never depends on the picture), with
  // title, artist, date, medium · museum, the blurb and a QR to the museum's page;
  // On This Day + the quote follow at ~1.4× type, natural height (no flex thirds,
  // no clamping) — the panel sizes to it, so there's no empty space.
  async openFull(body, ctx) {
    const wrap = ctx.h('div', { class: 'dly-full' });
    body.replaceChildren(wrap);
    // own <style> (ctx.style is deduped per widget, so it can't add a 2nd sheet)
    if (!document.getElementById('style-daily-full')) {
      const st = document.createElement('style'); st.id = 'style-daily-full'; st.textContent = `
      .dly-full { padding:0 4px 8px; }
      .dly-full .dly { height:auto; gap:30px; }
      .dly-full .dly > * { flex:none !important; overflow:visible !important; min-height:0; }
      .dly-full * { -webkit-line-clamp:unset !important; max-height:none !important; }
      .dly-full .dly-fact-sec, .dly-full .dly-quote-sec, .dly-full .dly-paint-sec > .dly-lbl { zoom:1.4; }
      .dly-full .dly-paint-sec > .dly-lbl { margin-bottom:10px; }
      .dly-pfull { display:flex; flex-direction:column; gap:22px; }
      .dly-pfull .dly-pimg { width:100%; height:700px; border-radius:0; background:none; }
      .dly-pfull .dly-pimg::after { display:none; }
      .dly-pfull .dly-pic { object-fit:contain; object-position:50% 50% !important; }
      .dly-pmeta { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:30px; align-items:start; }
      .dly-pfull .dly-pcap { gap:6px; }
      .dly-pfull .dly-ptitle { font-size:36px; line-height:1.1; }
      .dly-pfull .dly-partist { font-size:21px; white-space:normal; }
      .dly-pfull .dly-pdate { font-size:17px; white-space:normal; }
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
      /* Three sections split the tall card into FIXED, non-overlapping regions
         (flex thirds). Because a 'tall' card's height is coupled to the grid, it
         can shrink in production; equal regions + per-region overflow:hidden mean
         each block always ends in a clean ellipsis WITHIN its own region rather
         than being cut at the card's bottom edge. Content is vertically centred so
         the leftover slack reads as balanced breathing room, not an empty gap. */
      .dly { display:flex; flex-direction:column; height:100%; min-height:0;
        animation:dlyfade .22s linear both; }
      @keyframes dlyfade { from{opacity:0} to{opacity:1} }
      @media (prefers-reduced-motion: reduce) { .dly { animation:none; } }
      .dly-sec { display:flex; flex-direction:column; justify-content:safe center;
        min-height:0; overflow:hidden; padding:3px 0; }
      /* Never squash a line mid-glyph (2026-10-09): the flex children inside a
         region keep their natural height — clamped blocks end in a clean
         ellipsis instead of being shrunk and sliced through the middle. */
      .dly-sec > *, .dly-sec > * > * { flex-shrink:0; }
      /* basis:auto → each region is sized by its own content (so the card keeps
         its generous 'tall' height and stays full); grow shares any extra space,
         shrink lets a region give way gracefully if the grid ever forces the card
         shorter — clamping within its region instead of at the card's edge. */
      .dly-paint-sec { flex:1.15 0 auto; }
      .dly-fact-sec { flex:1 1 auto; }
      .dly-quote-sec { flex:1 1 auto; }
      .dly-sec + .dly-sec { border-top:1px solid var(--stroke); }
      .dly-lbl { font-family:var(--font-mono); font-size:12.5px; font-weight:600; letter-spacing:.2em;
        text-transform:uppercase; color:var(--ink-faint); margin-bottom:5px; flex:none; }

      /* PAINTING — the hero. A fixed image frame (cover-cropped at the entry's
         focal point) beside a caption: title in the display face, then artist
         and date. The frame is full size from the first paint; the picture
         fades in only once it has decoded (no loading text, nothing grows). */
      .dly-paint { display:flex; align-items:center; gap:14px; min-height:0; }
      .dly-pimg { position:relative; flex:none; width:158px; height:102px; border-radius:12px;
        overflow:hidden; background:rgba(255,255,255,.035); }
      .dly-pimg::after { content:''; position:absolute; inset:0; border-radius:inherit;
        box-shadow:inset 0 0 0 1px var(--stroke); pointer-events:none; }
      .dly-pic { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
        opacity:0; transition:opacity .7s linear; }
      .dly-pic.on { opacity:1; }
      @media (prefers-reduced-motion: reduce) { .dly-pic { transition:none; } }
      .dly-pcap { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:4px; }
      .dly-ptitle { font-family:var(--font-display); font-weight:400; font-size:21px; line-height:1.12;
        color:var(--mint); background:linear-gradient(120deg,#fff,var(--mint)); -webkit-background-clip:text;
        background-clip:text; -webkit-text-fill-color:transparent; text-wrap:balance;
        overflow-wrap:break-word; padding-bottom:1px;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-partist { font-size:14px; line-height:1.25; color:var(--ink);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dly-pdate { font-family:var(--font-mono); font-size:12.5px; line-height:1.2; color:var(--ink-faint);
        letter-spacing:.02em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* ON THIS DAY (falls back to a plain fact when offline). The text is the
         flexible middle of its region and clamps with an ellipsis. */
      .dly-fact { font-size:14px; line-height:1.36; color:var(--ink); flex:none;
        max-height:calc(14px * 1.36 * 3); padding-bottom:0;
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-fact .yr { font-family:var(--font-display); font-weight:700; color:var(--mint);
        margin-right:8px; letter-spacing:.01em; }
      /* relative "how long ago" — a hushed mono caption beside the year, so the
         moment reads as both dated and grounded in lived time at a glance. */
      .dly-fact .ago { font-family:var(--font-mono); font-size:12.5px; color:var(--ink-faint);
        margin-right:8px; letter-spacing:.02em; white-space:nowrap; }
      /* round-anniversary marker — a moment falling exactly a multiple of 25 years
         ago to the day turns its "how long ago" clause warm gold with a ✦, so the
         almanac quietly marks the occasion. Inline on the existing meta line (adds
         no height, can't clip); fires rarely, keeping the section calm. */
      .dly-fact .ago.ms { color:var(--gold); font-weight:600; }
      /* kind tag — a quiet "born"/"died" caption that leads a birthday or memorial
         entry, so the rotating history reads unambiguously (a life, not an event).
         Plain events carry no tag; the "On This Day" label already implies them. */
      .dly-fact .kind { font-family:var(--font-mono); font-size:12px; font-weight:700;
        letter-spacing:.1em; text-transform:uppercase; margin-right:8px; }
      .dly-fact .kind.born { color:var(--mint); }
      .dly-fact .kind.died { color:var(--ink-soft); }
      /* Almanac layout (2026-10-08): a live moment sets its date as a small
         stacked margin note — kind / year / how-long-ago — with the sentence in a
         hanging column beside it, so wrapped lines align under the text instead
         of sliding back beneath the year. Same 3-line footprint as before. */
      .dly-fact.has-meta { display:grid; grid-template-columns:auto minmax(0,1fr); column-gap:14px;
        align-items:start; max-height:none; -webkit-line-clamp:unset; }
      .dly-fact .meta { display:flex; flex-direction:column; align-items:flex-start; gap:4px;
        padding-top:2px; min-width:58px; }
      .dly-fact .meta > * { margin-right:0; line-height:1; }
      .dly-fact .meta .yr { font-size:22px; }
      .dly-fact .meta .ago { font-size:12px; }
      .dly-fact .txt { align-self:center; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;
        overflow:hidden; max-height:calc(14px * 1.36 * 3); }
      /* rotation indicator — a hushed "moment N of M today" caption with a slim
         progress rail, revealing that On This Day quietly cycles through all of
         today's notable moments over the day (advances every half-hour). Bounded
         width + fixed tiny height (flex:none), so it never grows the region or
         clips; static, no animation. Hidden entirely in the offline fact fallback. */
      .dly-otd-nav { display:flex; align-items:center; gap:9px; margin-top:7px; flex:none; }
      .dly-otd-nav .rail { position:relative; flex:1 1 auto; height:2px; border-radius:2px;
        background:rgba(255,255,255,.08); overflow:hidden; }
      .dly-otd-nav .rail .fill { position:absolute; left:0; top:0; bottom:0; border-radius:2px;
        background:var(--mint); opacity:.75; }
      .dly-otd-nav .rail .fill.born { background:var(--mint); }
      .dly-otd-nav .rail .fill.died { background:var(--ink-soft); }
      .dly-otd-nav .lbl { flex:0 0 auto; font-family:var(--font-mono); font-size:12px;
        letter-spacing:.1em; color:var(--ink-faint); white-space:nowrap; }
      .dly-otd-nav .lbl b { color:var(--ink-soft); font-weight:600; }

      /* QUOTE — the quote clamps and the attribution is pinned as a fixed footer
         inside this region (margin-top:auto), so it can never overlap the block
         above nor slip past the card's bottom edge. A soft mint blockquote rule
         and mint-tinted quotation marks give the day's quote its own presence, so
         it reads distinctly from the painting/fact sections above rather than as one
         more label-plus-text block. Purely decorative — static, adds no height. */
      .dly-quote { font-family:var(--font-display); font-style:normal; font-size:16.5px; line-height:1.3;
        color:var(--ink); min-height:0; text-wrap:balance; /* no lone last word */
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; padding-bottom:3px; }
      .dly-quote .qm { color:var(--mint); font-weight:600; font-style:normal; }
      .dly-auth { margin-top:5px; text-align:right; font-family:var(--font-mono); font-size:12.5px;
        color:var(--mint); letter-spacing:.02em; flex:none;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* author's role/era — a hushed caption trailing the attribution ("· poet"),
         so the day's quote is placed by a voice, not just a name. Faint and
         un-tinted so it never competes with the mint author; on the SAME line,
         ellipsised, so it adds no height and can't clip. Hidden when unknown. */
      .dly-auth .role { color:var(--ink-faint); font-weight:400; letter-spacing:.01em; }
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
    const paintBody = full
      ? h('div', { class: 'dly-pfull' }, imgBox,
        h('div', { class: 'dly-pmeta' },
          h('div', { class: 'dly-pcap' }, titleEl, artistEl, dateEl, museumEl, blurbEl),
          h('div', { class: 'dly-pqrbox' }, qrImg, qrCap)))
      : h('div', { class: 'dly-paint' }, imgBox, h('div', { class: 'dly-pcap' }, titleEl, artistEl, dateEl));
    const paintSec = h('div', { class: 'dly-sec dly-paint-sec' },
      h('div', { class: 'dly-lbl' }, 'Painting of the Day'), paintBody);
    let shownId = '';
    const showPainting = (p) => {
      if (!p || p.id === shownId) return;
      shownId = p.id;
      titleEl.textContent = p.title; titleEl.title = p.title;
      artistEl.textContent = p.artist || 'Unknown artist';
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
    loadPaintings().then((l) => l && showPainting(pickByDay(l))).catch(() => {});

    // ---- ON THIS DAY + QUOTE: start from embedded fallback, upgrade from network
    // The middle section shows a dated historical moment when Wikipedia answers,
    // and degrades to an embedded "Fact of the Day" when offline — so it always
    // holds something rather than blanking.
    const otdLbl = h('div', { class: 'dly-lbl' }, 'Fact of the Day');
    const factEl = h('div', { class: 'dly-fact' }, pickByDay(FACTS));
    // Rotation indicator (hidden until a live "On This Day" list is loaded): a slim
    // progress rail + "N of M today" caption showing where the half-hourly rotation
    // currently sits within all of today's notable moments.
    const otdFill = h('div', { class: 'fill' });
    const otdLblPos = h('div', { class: 'lbl' });
    const otdNav = h('div', { class: 'dly-otd-nav', style: 'display:none' },
      h('div', { class: 'rail' }, otdFill), otdLblPos);
    const factSec = h('div', { class: 'dly-sec dly-fact-sec' }, otdLbl, factEl, otdNav);

    const quoteEl = h('div', { class: 'dly-quote' });
    const authEl = h('div', { class: 'dly-auth' });
    const quoteSec = h('div', { class: 'dly-sec dly-quote-sec' },
      h('div', { class: 'dly-lbl' }, 'Quote of the Day'), quoteEl, authEl);
    const applyQuoteObj = ({ q, a }) => {
      // Build the quote with mint-tinted opening/closing marks (a span each) rather
      // than a plain string, so the quotation reads as a quotation at a glance.
      quoteEl.replaceChildren(h('span', { class: 'qm' }, '“'), q, h('span', { class: 'qm' }, '”'));
      // Place the voice with a quiet role/era when we know it (offline map); an
      // unfamiliar author from the live feed simply shows the bare name.
      const role = AUTHORS[a];
      quoteEl.title = role ? `“${q}” — ${a} · ${role}` : `“${q}” — ${a}`;
      // Filter falsy: native replaceChildren would render a bare `null` text node
      // for the missing-role case (e.g. an unfamiliar author from the live feed),
      // printing "— Denis Waitleynull". ctx.h drops nulls; the raw call does not.
      authEl.replaceChildren(...[`— ${a}`,
        role ? h('span', { class: 'role' }, ` · ${role}`) : null].filter(Boolean));
      authEl.title = role ? `${a} · ${role}` : a;
    };
    applyQuoteObj(pickByDay(QUOTES));

    body.replaceChildren(h('div', { class: 'dly' }, paintSec, factSec, quoteSec));

    // Network fetchers — each returns parsed content or throws. Never touch the DOM
    // until we have a good value, so a failure simply keeps the last good render.
    // Notability for the day's people: ONE Wikidata SPARQL call returns each
    // person's sitelink count (number of Wikipedia language editions with an
    // article) — a calm, durable fame signal that favours Eisenhower and Hannah
    // Arendt over this week's trending names. Cached per date in memory so the
    // half-hourly refresh doesn't repeat it. Resolves to Map(Qid → count).
    let fameCache = { key: '', map: null };
    const fameOf = async (ids) => {
      const key = todayKey();
      if (fameCache.key === key && fameCache.map) return fameCache.map;
      const uniq = [...new Set(ids.filter(Boolean))].slice(0, 400);
      if (!uniq.length) return null;
      const q = `SELECT ?i ?n WHERE { VALUES ?i { ${uniq.map((x) => `wd:${x}`).join(' ')} } ?i wikibase:sitelinks ?n }`;
      const r = await ctx.fetchJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`);
      const rows = r && r.results && Array.isArray(r.results.bindings) ? r.results.bindings : [];
      const map = new Map();
      for (const b of rows) {
        const id = b && b.i && String(b.i.value || '').split('/').pop();
        const n = b && b.n ? Number(b.n.value) : NaN;
        if (id && Number.isFinite(n)) map.set(id, n);
      }
      if (map.size) fameCache = { key, map };
      return map;
    };
    const fetchOnThisDay = async () => {
      const now = new Date();
      // The combined "all" feed carries events, curated highlights, and notable
      // births/deaths for today's date in a single keyless call — a richer, more
      // human read of the day than events alone.
      const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${p2(now.getMonth() + 1)}/${p2(now.getDate())}`;
      const d = await ctx.fetchJSON(url) || {};
      const clean = (arr, kind) => (Array.isArray(arr) ? arr : [])
        .filter((e) => e && e.text && Number.isFinite(e.year))
        .map((e) => ({ kind, year: e.year,
          wid: Array.isArray(e.pages) && e.pages[0] && /^Q\d+$/.test(e.pages[0].wikibase_item || '') ? e.pages[0].wikibase_item : '',
          // Wikipedia's "(pictured)" / "(pictured right)" caption cues point at a photo
          // the wall never shows — drop them so the line reads as plain prose.
          text: e.text.toString().replace(/\s*\((?:also\s+)?pictured(?:[^()]{0,24})?\)/gi, '').replace(/\s+([,.;])/g, '$1').trim() }))
        .sort((a, b) => b.year - a.year); // newest → oldest within a kind
      // Prefer Wikipedia's curated "selected" highlights for the event stream
      // (the day's most notable moments); fall back to the raw events list.
      const selected = clean(d.selected, 'event');
      const events = (selected.length ? selected : clean(d.events, 'event')).slice(0, 12);
      // Births/deaths arrive newest-first, so a plain slice was all recent
      // athletes ("Quinn Hughes, 1999"). Rank them by lasting notability instead
      // (how many language Wikipedias cover the person — see fameOf); if that
      // lookup fails, fall back to the old newest-first slice.
      let births = clean(d.births, 'born');
      let deaths = clean(d.deaths, 'died');
      const fame = await fameOf([...births, ...deaths].map((e) => e.wid)).catch(() => null);
      if (fame && fame.size) {
        const nowY = now.getFullYear();
        const byFame = (a, b) => (fame.get(b.wid) || 0) - (fame.get(a.wid) || 0) || b.year - a.year;
        // An almanac reads best with lives that have settled into history: prefer
        // births at least 40 years back (fills from the rest only if it runs short).
        const settled = births.filter((e) => e.year <= nowY - 40);
        births = (settled.length >= 8 ? settled : births).slice().sort(byFame);
        deaths = deaths.slice().sort(byFame);
      }
      births = births.slice(0, 8).sort((a, b) => b.year - a.year);
      deaths = deaths.slice(0, 8).sort((a, b) => b.year - a.year);
      if (!events.length && !births.length && !deaths.length) throw new Error('no entries');
      // Interleave the three kinds so the half-hourly rotation alternates
      // event → born → died for varied texture, rather than a long run of one.
      const mixed = [];
      const max = Math.max(events.length, births.length, deaths.length);
      for (let i = 0; i < max; i++) {
        if (i < events.length) mixed.push(events[i]);
        if (i < births.length) mixed.push(births[i]);
        if (i < deaths.length) mixed.push(deaths[i]);
      }
      return mixed;
    };
    const fetchQuote = async () => {
      const d = await ctx.fetchJSON('https://zenquotes.io/api/today');
      const item = Array.isArray(d) ? d[0] : null;
      const q = item && (item.q || '').toString().trim();
      const a = item && (item.a || '').toString().trim();
      if (!q) throw new Error('empty quote');
      return { q, a: a || 'Unknown' };
    };

    // Embedded fallback fact (offline): plain text under the "Fact of the Day" label.
    const applyFact = (text) => { otdLbl.textContent = 'Fact of the Day'; factEl.classList.remove('has-meta'); factEl.textContent = text; otdNav.style.display = 'none'; };

    // Live historical moments: we hold the whole "on this day" list and rotate
    // through it over the day, so a glance at the wall lands on a different moment
    // each half-hour rather than the same fixed event. otdLive tracks that we have
    // a good live render; otdDateKey lets us keep our rotation position when the
    // network refresh returns the SAME date, and reset only when the day rolls over.
    let otdEvents = [];
    let otdIdx = 0;
    let otdDateKey = '';
    let otdLive = false;
    const renderOnThisDay = () => {
      if (!otdEvents.length) return;
      const n = otdEvents.length;
      const { kind, year, text } = otdEvents[((otdIdx % n) + n) % n];
      otdLbl.textContent = 'On This Day';
      const ago = relYears(year);
      // Round anniversary (exactly a multiple of 25 years ago to the day): the
      // "how long ago" clause turns a warm gold with a ✦, so the almanac quietly
      // marks the occasion. Fires rarely; inline on the existing line, so it adds
      // no height and can't clip.
      const ms = milestoneOf(year);
      const meta = [];
      if (kind === 'born') meta.push(h('span', { class: 'kind born' }, 'born'));
      else if (kind === 'died') meta.push(h('span', { class: 'kind died' }, 'died'));
      meta.push(
        h('span', { class: 'yr' }, fmtYear(year)),
        h('span', {
          class: `ago${ms ? ' ms' : ''}`,
          title: ms ? `A round anniversary — ${ms.years} years ago to the day` : '',
        }, ms ? `✦ ${ago}` : ago));
      factEl.classList.add('has-meta');
      factEl.replaceChildren(h('div', { class: 'meta' }, ...meta), h('div', { class: 'txt' }, text));
      const lead = kind === 'born' ? 'Born ' : kind === 'died' ? 'Died ' : '';
      factEl.title = `${lead}${fmtYear(year)} (${ago}${ms ? ` · ${ms.years}th anniversary` : ''}) — ${text}`;
      // Position indicator: which moment of today's M we're showing. Only shown
      // when there's more than one moment to rotate through; the rail is tinted to
      // the current entry's kind so the caption echoes the moment above it.
      const pos = (((otdIdx % n) + n) % n) + 1;
      if (n > 1) {
        otdFill.className = `fill${kind === 'born' ? ' born' : kind === 'died' ? ' died' : ''}`;
        otdFill.style.width = `${Math.round((pos / n) * 100)}%`;
        otdLblPos.replaceChildren(h('b', {}, String(pos)), ` of ${n} today`);
        otdNav.style.display = '';
      } else {
        otdNav.style.display = 'none';
      }
      otdLive = true;
    };
    // Install a freshly fetched list. On a new date (or first load), seed the
    // rotation deterministically by day-of-year; on the same date, preserve where
    // the rotation currently sits so a background refresh doesn't jump the reader.
    const loadOnThisDay = (list) => {
      const now = new Date();
      const key = `${now.getMonth() + 1}-${now.getDate()}`;
      if (key !== otdDateKey) { otdDateKey = key; otdIdx = dayOfYear() % list.length; }
      otdEvents = list;
      renderOnThisDay();
    };
    const applyQuote = applyQuoteObj;

    // Initial load: a few attempts with short backoff before settling on embedded.
    const tryLoad = async (fetcher, apply) => {
      for (let i = 0; i < 3; i++) {
        try { apply(await fetcher()); return; }
        catch { await new Promise((r) => setTimeout(r, 700 * (i + 1))); }
      }
      // give up — embedded fallback already on screen
    };
    // Don't let one slow section block the other.
    tryLoad(fetchOnThisDay, loadOnThisDay);
    tryLoad(fetchQuote, applyQuote);

    // Periodic refresh (every 30 min, so content rolls over at midnight):
    //   - re-pick the day's painting (a no-op until the date changes);
    //   - re-pick the embedded fact/quote first (covers a day-change while offline),
    //     then try the network and upgrade in place only if it succeeds (keeps the
    //     last good render on failure — network calls never blank the section);
    //   - ADVANCE the "On This Day" rotation so each half-hour surfaces a fresh
    //     moment from today's date (works offline once the list is loaded).
    let firstTick = true;
    ctx.interval(() => {
      // ctx.interval fires immediately; the initial network load is handled by
      // tryLoad above (with retry backoff), so skip the network on this first tick.
      if (firstTick) { firstTick = false; return; }
      loadPaintings().then((l) => l && showPainting(pickByDay(l))).catch(() => {});
      if (otdLive && otdEvents.length) {
        // Step to the next historical moment we already hold — no network needed.
        otdIdx += 1;
        renderOnThisDay();
      } else {
        // Still offline for history — keep a rolling embedded fact on screen.
        applyFact(pickByDay(FACTS));
      }
      applyQuote(pickByDay(QUOTES));
      // Refresh the list from the network (covers the midnight day-change in place);
      // loadOnThisDay preserves the rotation position within the same day.
      fetchOnThisDay().then(loadOnThisDay).catch(() => {});
      fetchQuote().then(applyQuote).catch(() => {});
    }, 30 * 60 * 1000);
  },
};
