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
  size: 'full',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .dq { display:flex; flex-direction:column; justify-content:center; align-items:center;
        height:100%; max-height:100%; text-align:center; padding:2px 10px; overflow:hidden; }
      /* inner wrapper is NOT height-constrained, so we can measure its true
         (unclipped) height to auto-fit the quote into the card. */
      .dq-inner { display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; }
      .dq-mark { font-family:var(--font-display); font-size:34px; line-height:1; color:var(--mint);
        opacity:.4; margin-bottom:-18px; user-select:none;
        filter:drop-shadow(0 4px 12px rgba(0,0,0,.35)); }
      .dq-quote { font-family:var(--font-display); font-weight:500; font-size:30px; line-height:1.3;
        letter-spacing:.2px; color:var(--ink); max-width:54ch; text-wrap:balance; margin:0; }
      .dq-author { font-family:var(--font); font-size:14px; letter-spacing:1.4px; text-transform:uppercase;
        color:var(--ink-soft); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    `);
    body.appendChild(ctx.loading('gathering a thought…'));

    const decode = (s) => {
      if (!s) return s;
      const t = document.createElement('textarea');
      t.innerHTML = s;
      return t.value;
    };

    // Shrink the quote's font-size until the content fits the card's real height.
    // We measure .dq-inner (unconstrained) against .dq (the clipped cell) so a
    // long quote is always shown in full, never cut off at the frame edge.
    const fit = () => {
      const dq = body.querySelector('.dq');
      const inner = body.querySelector('.dq-inner');
      const ql = body.querySelector('.dq-quote');
      if (!dq || !inner || !ql || !dq.clientHeight) return;
      let size = 30;
      ql.style.fontSize = size + 'px';
      let guard = 0;
      while (inner.offsetHeight > dq.clientHeight && size > 13 && guard++ < 40) {
        size -= 1;
        ql.style.fontSize = size + 'px';
      }
    };

    const render = (q, a) => {
      body.replaceChildren(ctx.h('div', { class: 'dq' },
        ctx.h('div', { class: 'dq-inner' },
          ctx.h('div', { class: 'dq-mark', 'aria-hidden': 'true' }, '“'),
          ctx.h('p', { class: 'dq-quote' }, q),
          ctx.h('div', { class: 'dq-author' }, a ? `— ${a}` : '— Unknown'))));
      // Fit now, and again after layout/fonts settle.
      fit();
      requestAnimationFrame(fit);
      setTimeout(fit, 400);
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
