// Daily Almanac — three stacked "of the day" sections that roll over at midnight:
//   📖 Word of the day   — fully OFFLINE, deterministic by day-of-year (never fails).
//   📜 On this day        — a dated historical moment from Wikipedia's keyless
//        onthisday feed; gracefully falls back to an embedded "Fact of the day"
//        (uselessfacts-style) when the network is unavailable, so it never blanks.
//   ❝  Quote of the day   — zenquotes.io/today, embedded fallback.
// Sits beside the Weather card (both 'tall'). Network is best-effort: initial load
// retries with short backoff, periodic refresh fetches BEFORE replacing the DOM so a
// failure keeps the last good render. Embedded data guarantees content fully offline.

// ---- WORD OF THE DAY — curated, deterministic, no network ------------------
const WORDS = [
  { word: 'serendipity', pron: '/ˌsɛrənˈdɪpɪti/', pos: 'noun', def: 'The occurrence of happy or beneficial events by chance, in a fortunate accident.' },
  { word: 'petrichor', pron: '/ˈpɛtrɪkɔːr/', pos: 'noun', def: 'The earthy scent produced when rain falls on dry soil after a warm, dry spell.' },
  { word: 'ephemeral', pron: '/ɪˈfɛmərəl/', pos: 'adjective', def: 'Lasting for a very short time; fleeting and quick to fade away.' },
  { word: 'sonder', pron: '/ˈsɒndər/', pos: 'noun', def: 'The realization that each passer-by is living a life as vivid and complex as your own.' },
  { word: 'limerence', pron: '/ˈlɪmərəns/', pos: 'noun', def: 'The state of being infatuated, marked by an involuntary longing for reciprocation.' },
  { word: 'mellifluous', pron: '/mɛˈlɪfluəs/', pos: 'adjective', def: 'Sweet or musical; pleasant to hear, as a smooth and flowing voice or sound.' },
  { word: 'halcyon', pron: '/ˈhælsiən/', pos: 'adjective', def: 'Denoting a period that is idyllically happy and peaceful, often in fond memory.' },
  { word: 'susurrus', pron: '/suːˈsʌrəs/', pos: 'noun', def: 'A soft, whispering or rustling sound, like leaves or hushed voices.' },
  { word: 'apricity', pron: '/əˈprɪsɪti/', pos: 'noun', def: 'The warmth of the sun felt on a cold winter day.' },
  { word: 'nepenthe', pron: '/nɪˈpɛnθi/', pos: 'noun', def: 'A drug or thing that brings forgetfulness of grief or suffering.' },
  { word: 'eloquence', pron: '/ˈɛləkwəns/', pos: 'noun', def: 'Fluent, persuasive, and graceful speaking or writing.' },
  { word: 'quixotic', pron: '/kwɪkˈsɒtɪk/', pos: 'adjective', def: 'Exceedingly idealistic; unrealistic and impractical in a romantic, lofty way.' },
  { word: 'sublime', pron: '/səˈblaɪm/', pos: 'adjective', def: 'Of such excellence or beauty as to inspire great admiration or awe.' },
  { word: 'ineffable', pron: '/ɪnˈɛfəbl/', pos: 'adjective', def: 'Too great or extreme to be expressed or described in words.' },
  { word: 'luminescence', pron: '/ˌluːmɪˈnɛsns/', pos: 'noun', def: 'The emission of light by a substance that has not been heated, as a soft glow.' },
  { word: 'wanderlust', pron: '/ˈwɒndəlʌst/', pos: 'noun', def: 'A strong, innate desire to travel and explore the world.' },
  { word: 'effervescent', pron: '/ˌɛfəˈvɛsnt/', pos: 'adjective', def: 'Vivacious and enthusiastic; bubbling with high spirits.' },
  { word: 'solitude', pron: '/ˈsɒlɪtjuːd/', pos: 'noun', def: 'The state of being alone, often by choice and felt as restful.' },
  { word: 'aurora', pron: '/ɔːˈrɔːrə/', pos: 'noun', def: 'A natural light display in the sky, mainly seen in high-latitude regions.' },
  { word: 'reverie', pron: '/ˈrɛvəri/', pos: 'noun', def: 'A state of being pleasantly lost in one’s thoughts; a daydream.' },
  { word: 'gossamer', pron: '/ˈɡɒsəmər/', pos: 'noun', def: 'A fine, filmy substance of cobwebs; anything delicate, light, and insubstantial.' },
  { word: 'incandescent', pron: '/ˌɪnkænˈdɛsnt/', pos: 'adjective', def: 'Emitting light from being heated; full of strong, intense emotion.' },
  { word: 'vellichor', pron: '/ˈvɛlɪkɔːr/', pos: 'noun', def: 'The strange wistfulness of used bookstores, steeped in time and old paper.' },
  { word: 'numinous', pron: '/ˈnjuːmɪnəs/', pos: 'adjective', def: 'Having a strong religious or spiritual quality; suggesting the presence of divinity.' },
  { word: 'evanescent', pron: '/ˌɛvəˈnɛsnt/', pos: 'adjective', def: 'Soon passing out of sight, memory, or existence; quickly fading.' },
  { word: 'plethora', pron: '/ˈplɛθərə/', pos: 'noun', def: 'A very large or excessive amount of something; an abundance.' },
  { word: 'panacea', pron: '/ˌpænəˈsiːə/', pos: 'noun', def: 'A solution or remedy supposed to cure all problems or diseases.' },
  { word: 'zephyr', pron: '/ˈzɛfər/', pos: 'noun', def: 'A soft, gentle breeze, especially one from the west.' },
  { word: 'felicity', pron: '/fɪˈlɪsɪti/', pos: 'noun', def: 'Intense happiness; the ability to find apt and pleasing expression.' },
  { word: 'verdant', pron: '/ˈvɜːdnt/', pos: 'adjective', def: 'Green with growing plants and vegetation; lush and flourishing.' },
  { word: 'sanguine', pron: '/ˈsæŋɡwɪn/', pos: 'adjective', def: 'Optimistic or positive, especially in an apparently difficult situation.' },
  { word: 'aplomb', pron: '/əˈplɒm/', pos: 'noun', def: 'Self-confidence or assurance, especially in a demanding situation; poise.' },
  { word: 'lagom', pron: '/ˈlɑːɡɒm/', pos: 'noun', def: 'Swedish: not too much and not too little — the comfortable balance of just right.' },
  { word: 'hiraeth', pron: '/ˈhɪraɪθ/', pos: 'noun', def: 'A Welsh longing or homesickness for a home you cannot return to, or never was.' },
  { word: 'meraki', pron: '/meˈraki/', pos: 'noun', def: 'Greek: to do something with soul, creativity, and love; to put yourself into it.' },
  { word: 'fernweh', pron: '/ˈfɛrnveː/', pos: 'noun', def: 'German: a deep ache or longing for far-off places one has yet to visit.' },
  { word: 'pellucid', pron: '/pɪˈluːsɪd/', pos: 'adjective', def: 'Transparently clear in style or meaning; easy to understand.' },
  { word: 'redolent', pron: '/ˈrɛdələnt/', pos: 'adjective', def: 'Strongly reminiscent or suggestive of something; fragrant or sweet-smelling.' },
  { word: 'lissome', pron: '/ˈlɪsəm/', pos: 'adjective', def: 'Thin, supple, and graceful in movement.' },
  { word: 'ethereal', pron: '/ɪˈθɪəriəl/', pos: 'adjective', def: 'Extremely delicate and light, seemingly too perfect for this world.' },
  { word: 'cynosure', pron: '/ˈsɪnəzjʊər/', pos: 'noun', def: 'A person or thing that is the centre of attention or admiration.' },
  { word: 'denouement', pron: '/deɪˈnuːmɒ̃/', pos: 'noun', def: 'The final part of a story in which strands are drawn together and resolved.' },
  { word: 'sempiternal', pron: '/ˌsɛmpɪˈtɜːnl/', pos: 'adjective', def: 'Eternal and unchanging; everlasting.' },
  { word: 'oneiric', pron: '/əˈnaɪrɪk/', pos: 'adjective', def: 'Relating to dreams or dreaming; having a dreamlike quality.' },
  { word: 'tarantism', pron: '/ˈtærəntɪzəm/', pos: 'noun', def: 'An uncontrollable urge to dance, historically thought caused by a spider’s bite.' },
  { word: 'syzygy', pron: '/ˈsɪzɪdʒi/', pos: 'noun', def: 'An alignment of three celestial bodies in a straight line, as in an eclipse.' },
  { word: 'ebullient', pron: '/ɪˈbʌliənt/', pos: 'adjective', def: 'Cheerful and full of energy; overflowing with excitement.' },
  { word: 'scintilla', pron: '/sɪnˈtɪlə/', pos: 'noun', def: 'A tiny trace or spark of a specified quality or feeling.' },
];

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

// Day-of-year (1..366) in local time — stable for the whole day, rolls at midnight.
function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 864e5);
}
const pickByDay = (arr) => arr[dayOfYear() % arr.length];

// Wikipedia returns negative years for BC — render legibly, never as "-480".
const fmtYear = (y) => (y < 0 ? `${-y} BC` : String(y));
const p2 = (n) => String(n).padStart(2, '0');

export default {
  id: 'daily',
  title: 'Today',
  icon: '📖',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      /* Three sections distributed evenly down the tall card. Sections size to their
         OWN content (no rigid equal thirds) and the slack is shared as even gaps, so
         the word never floats in a half-empty box and nothing is squeezed. */
      .dly { display:flex; flex-direction:column; height:100%; min-height:0;
        justify-content:space-between; gap:10px; animation:dlyfade .6s ease-out both; }
      @keyframes dlyfade { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
      @media (prefers-reduced-motion: reduce) { .dly { animation:none; } }
      .dly-sec { display:flex; flex-direction:column; min-height:0; padding:11px 0; }
      .dly-sec + .dly-sec { border-top:1px solid var(--stroke); }
      .dly-sec:first-child { padding-top:0; }
      .dly-sec:last-child { padding-bottom:0; }
      .dly-lbl { font-family:var(--font-mono); font-size:11px; font-weight:600; letter-spacing:.2em;
        text-transform:uppercase; color:var(--ink-faint); margin-bottom:7px; }

      /* WORD — the hero. Wraps to a 2nd line for long entries (no more ellipsis cut-off). */
      .dly-word { font-family:var(--font-display); font-weight:600; font-size:28px; line-height:1.12;
        padding:2px 0; color:var(--mint);
        background:linear-gradient(120deg,#fff,var(--mint)); -webkit-background-clip:text;
        background-clip:text; -webkit-text-fill-color:transparent;
        overflow-wrap:break-word; word-break:break-word; }
      .dly-wmeta { margin-top:7px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
      .dly-pron { font-family:var(--font-mono); font-size:13px; color:var(--ink-faint); }
      .dly-pos { font-style:italic; font-size:13.5px; color:var(--ink-soft); }
      .dly-def { margin-top:7px; font-size:15px; line-height:1.38; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

      /* ON THIS DAY (falls back to a plain fact when offline) */
      .dly-fact { font-size:15px; line-height:1.38; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-fact .yr { font-family:var(--font-display); font-weight:700; color:var(--mint);
        margin-right:8px; letter-spacing:.01em; }

      /* QUOTE */
      .dly-quote { font-family:var(--font-display); font-style:italic; font-size:17px; line-height:1.36;
        color:var(--ink); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-auth { margin-top:7px; text-align:right; font-family:var(--font-mono); font-size:12.5px;
        color:var(--mint); letter-spacing:.02em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    `);

    // ---- WORD: fully offline, never fails ------------------------------------
    const wordEl = h('div', { class: 'dly-word' });
    const pronEl = h('span', { class: 'dly-pron' });
    const posEl = h('span', { class: 'dly-pos' });
    const defEl = h('div', { class: 'dly-def' });
    const wordSec = h('div', { class: 'dly-sec' },
      h('div', { class: 'dly-lbl' }, 'Word of the Day'),
      wordEl,
      h('div', { class: 'dly-wmeta' }, pronEl, posEl),
      defEl);
    const applyWord = (w) => {
      wordEl.textContent = w.word; wordEl.title = w.word;
      pronEl.textContent = w.pron; posEl.textContent = w.pos; defEl.textContent = w.def;
    };
    applyWord(pickByDay(WORDS));

    // ---- ON THIS DAY + QUOTE: start from embedded fallback, upgrade from network
    // The middle section shows a dated historical moment when Wikipedia answers,
    // and degrades to an embedded "Fact of the Day" when offline — so it always
    // holds something rather than blanking.
    const otdLbl = h('div', { class: 'dly-lbl' }, 'Fact of the Day');
    const factEl = h('div', { class: 'dly-fact' }, pickByDay(FACTS));
    const factSec = h('div', { class: 'dly-sec' }, otdLbl, factEl);

    const quoteEl = h('div', { class: 'dly-quote' });
    const authEl = h('div', { class: 'dly-auth' });
    const quoteSec = h('div', { class: 'dly-sec' },
      h('div', { class: 'dly-lbl' }, 'Quote of the Day'), quoteEl, authEl);
    const applyQuoteObj = ({ q, a }) => { quoteEl.textContent = `“${q}”`; authEl.textContent = `— ${a}`; };
    applyQuoteObj(pickByDay(QUOTES));

    body.replaceChildren(h('div', { class: 'dly' }, wordSec, factSec, quoteSec));

    // Network fetchers — each returns parsed content or throws. Never touch the DOM
    // until we have a good value, so a failure simply keeps the last good render.
    const fetchOnThisDay = async () => {
      const now = new Date();
      const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${p2(now.getMonth() + 1)}/${p2(now.getDate())}`;
      const d = await ctx.fetchJSON(url);
      const events = Array.isArray(d && d.events) ? d.events : [];
      const valid = events
        .filter((e) => e && e.text && Number.isFinite(e.year))
        .sort((a, b) => b.year - a.year); // newest → oldest
      if (valid.length === 0) throw new Error('no events');
      // Deterministic pick by day-of-year — stable across refreshes within a day,
      // and ranges across the whole list (not just the most recent decades).
      const e = valid[dayOfYear() % valid.length];
      return { year: e.year, text: e.text.toString().trim() };
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
    const applyFact = (text) => { otdLbl.textContent = 'Fact of the Day'; factEl.textContent = text; };
    // Live historical moment: a mint year accent followed by the event text, under
    // the "On This Day" label. Tracks that we have a good live render.
    let otdLive = false;
    const applyOnThisDay = ({ year, text }) => {
      otdLbl.textContent = 'On This Day';
      factEl.replaceChildren(h('span', { class: 'yr' }, fmtYear(year)), text);
      factEl.title = `${fmtYear(year)} — ${text}`;
      otdLive = true;
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
    tryLoad(fetchOnThisDay, applyOnThisDay);
    tryLoad(fetchQuote, applyQuote);

    // Periodic refresh (every 30 min, so content rolls over at midnight):
    //   - re-pick the OFFLINE word so it always reflects the current day;
    //   - re-pick the embedded fact/quote first (covers a day-change while offline),
    //     then try the network and upgrade in place only if it succeeds (keeps the
    //     last good render on failure — network calls never blank the section).
    let firstTick = true;
    ctx.interval(() => {
      // ctx.interval fires immediately; the initial network load is handled by
      // tryLoad above (with retry backoff), so skip the network on this first tick.
      if (firstTick) { firstTick = false; return; }
      applyWord(pickByDay(WORDS));
      // Only reset the middle section to an embedded fact if we don't yet have a
      // live "On This Day" — otherwise keep the last good historical moment and let
      // the network call below refresh it (covers the midnight day-change in place).
      if (!otdLive) applyFact(pickByDay(FACTS));
      applyQuote(pickByDay(QUOTES));
      fetchOnThisDay().then(applyOnThisDay).catch(() => {});
      fetchQuote().then(applyQuote).catch(() => {});
    }, 30 * 60 * 1000);
  },
};
