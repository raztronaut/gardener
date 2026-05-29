// Markets — BTC & ETH USD price + 24h % change, via keyless CoinGecko (through proxy).
const COINS = [
  { id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', emoji: '₿' },
  { id: 'ethereum', sym: 'ETH', name: 'Ethereum', emoji: 'Ξ' },
];

const fmtPrice = (n) => '$' + n.toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtChange = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

export default {
  id: 'markets',
  title: 'Markets',
  icon: '📈',
  size: 'sm',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .mkt { display:flex; flex-direction:column; gap:14px; }
      .mkt-row { display:flex; align-items:center; gap:14px; }
      .mkt-row .coin { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
      .mkt-row .badge { font-family:var(--font-display); font-size:26px; line-height:1;
        width:42px; height:42px; flex:none; display:flex; align-items:center; justify-content:center;
        background:rgba(255,255,255,.05); border:1px solid var(--stroke); border-radius:12px; }
      .mkt-row .id { display:flex; flex-direction:column; gap:2px; min-width:0; }
      .mkt-row .sym { font-family:var(--font-mono); font-size:15px; font-weight:600; color:var(--ink); letter-spacing:.04em; }
      .mkt-row .nm { font-size:12px; color:var(--ink-faint); }
      .mkt-row .nums { text-align:right; display:flex; flex-direction:column; gap:2px; flex:none; }
      .mkt-row .price { font-family:var(--font-display); font-size:22px; font-weight:600; line-height:1; color:var(--ink); }
      .mkt-row .chg { font-family:var(--font-mono); font-size:13px; font-weight:600; line-height:1; }
      .mkt-row .chg.up { color:var(--mint); }
      .mkt-row .chg.down { color:#ff6b6b; }
    `);
    body.appendChild(ctx.loading('checking the markets…'));

    try {
      const url = 'https://api.coingecko.com/api/v3/simple/price'
        + '?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';

      const refresh = async () => {
        const d = await ctx.fetchJSON(url);
        const rows = COINS
          .map((c) => {
            const q = d && d[c.id];
            if (!q || typeof q.usd !== 'number') return null;
            const chg = typeof q.usd_24h_change === 'number' ? q.usd_24h_change : 0;
            const up = chg >= 0;
            return ctx.h('div', { class: 'mkt-row' },
              ctx.h('div', { class: 'coin' },
                ctx.h('div', { class: 'badge' }, c.emoji),
                ctx.h('div', { class: 'id' },
                  ctx.h('div', { class: 'sym' }, c.sym),
                  ctx.h('div', { class: 'nm' }, c.name))),
              ctx.h('div', { class: 'nums' },
                ctx.h('div', { class: 'price' }, fmtPrice(q.usd)),
                ctx.h('div', { class: `chg ${up ? 'up' : 'down'}` },
                  `${up ? '▲' : '▼'} ${fmtChange(chg)}`)));
          })
          .filter(Boolean);

        if (!rows.length) {
          body.replaceChildren(ctx.error('no market data'));
          return;
        }
        body.replaceChildren(ctx.h('div', { class: 'mkt' }, ...rows));
      };

      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 60 * 1000);
    } catch (e) {
      body.replaceChildren(ctx.error('markets unavailable'));
    }
  },
};
