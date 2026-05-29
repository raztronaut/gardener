// Daily Quote — a single elegant inspirational quote, via keyless ZenQuotes (through proxy).
// API: https://zenquotes.io/api/today -> [{ q, a, i, h, date }]. Falls back to a built-in set.

const FALLBACK = [
  { q: 'The best time to plant a tree was twenty years ago. The second best time is now.', a: 'Chinese Proverb' },
  { q: 'What we think, we become.', a: 'Buddha' },
  { q: 'It always seems impossible until it’s done.', a: 'Nelson Mandela' },
  { q: 'The quieter you become, the more you are able to hear.', a: 'Rumi' },
  { q: 'Adopt the pace of nature: her secret is patience.', a: 'Ralph Waldo Emerson' },
  { q: 'Simplicity is the ultimate sophistication.', a: 'Leonardo da Vinci' },
  { q: 'Wherever you go, go with all your heart.', a: 'Confucius' },
  { q: 'In the middle of difficulty lies opportunity.', a: 'Albert Einstein' },
];

export default {
  id: 'daily-quote',
  title: 'Daily Quote',
  icon: '🌿',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .dq { display:flex; flex-direction:column; justify-content:center; align-items:center;
        gap:20px; height:100%; min-height:200px; text-align:center; padding:8px 4px; }
      .dq-mark { font-family:var(--font-display); font-size:88px; line-height:.4; color:var(--mint);
        opacity:.45; height:36px; user-select:none; filter:drop-shadow(0 4px 12px rgba(0,0,0,.35)); }
      .dq-quote { font-family:var(--font-display); font-weight:500; font-size:28px; line-height:1.34;
        letter-spacing:.2px; color:var(--ink); max-width:16ch; text-wrap:balance; margin:0; }
      .dq-rule { width:56px; height:2px; border:0; margin:0;
        background:linear-gradient(90deg, transparent, var(--gold, var(--mint)), transparent); opacity:.7; }
      .dq-author { font-family:var(--font); font-size:15px; letter-spacing:1.4px; text-transform:uppercase;
        color:var(--ink-soft); }
    `);
    body.appendChild(ctx.loading('gathering a thought…'));

    const decode = (s) => {
      if (!s) return s;
      const t = document.createElement('textarea');
      t.innerHTML = s;
      return t.value;
    };

    const render = (q, a) => {
      body.replaceChildren(ctx.h('div', { class: 'dq' },
        ctx.h('div', { class: 'dq-mark', 'aria-hidden': 'true' }, '“'),
        ctx.h('p', { class: 'dq-quote' }, q),
        ctx.h('hr', { class: 'dq-rule' }),
        ctx.h('div', { class: 'dq-author' }, a ? `— ${a}` : '— Unknown')));
    };

    const pickFallback = () => {
      // Deterministic per-day pick so the quote is stable across refreshes.
      const day = Math.floor(Date.now() / 86400000);
      return FALLBACK[day % FALLBACK.length];
    };

    try {
      const data = await ctx.fetchJSON('https://zenquotes.io/api/today');
      const item = Array.isArray(data) ? data[0] : null;
      const q = decode(item && item.q);
      const a = decode(item && item.a);
      if (q && q.trim()) render(q.trim(), (a || '').trim());
      else { const f = pickFallback(); render(f.q, f.a); }
    } catch (e) {
      const f = pickFallback();
      render(f.q, f.a);
    }
  },
};
