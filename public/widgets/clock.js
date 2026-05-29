// Clock — the garden's heartbeat. A luminous hero time + date + greeting.
export default {
  id: 'clock',
  title: 'Time',
  icon: '🕰',
  size: 'full',
  chrome: false,
  async mount(root, ctx) {
    const tz = ctx.config?.tz || 'America/Los_Angeles';
    ctx.style(`
      .clk { display:flex; flex-direction:column; gap:8px; padding:14px 10px 6px; }
      .clk .greet { color: var(--ink-soft); font-size:17px; letter-spacing:.04em; }
      .clk .time { font-family: var(--font-display); font-weight:600; letter-spacing:-.01em;
        font-size: 104px; line-height:.92; background:linear-gradient(120deg,#fff,var(--mint));
        -webkit-background-clip:text; background-clip:text; color:transparent; display:flex; align-items:baseline; gap:14px; }
      .clk .time .sec { font-family:var(--font-mono); font-size:30px; -webkit-text-fill-color:var(--ink-faint); }
      .clk .time .ap { font-size:34px; -webkit-text-fill-color:var(--ink-soft); font-family:var(--font); font-weight:600; }
      .clk .date { color: var(--ink); font-size:22px; opacity:.92; }
    `);
    const greet = root.appendChild(ctx.h('div', { class: 'greet' }));
    const time = root.appendChild(ctx.h('div', { class: 'time' }));
    const date = root.appendChild(ctx.h('div', { class: 'date' }));
    root.parentElement?.classList.add('clk-wrap');
    root.classList.add('clk');

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtSec = new Intl.DateTimeFormat('en-US', { timeZone: tz, second: '2-digit' });
    const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });

    ctx.interval(() => {
      const now = new Date();
      const parts = fmtTime.formatToParts(now);
      const hhmm = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
      const ap = (parts.find((p) => p.type === 'dayPeriod')?.value || '').toUpperCase();
      const sec = fmtSec.format(now);
      time.replaceChildren(
        ctx.h('span', {}, hhmm),
        ctx.h('span', { class: 'sec' }, ':' + sec),
        ctx.h('span', { class: 'ap' }, ap),
      );
      date.textContent = fmtDate.format(now);
      const h = parseInt(hourOf.format(now), 10);
      greet.textContent = h < 5 ? 'A quiet night in the garden'
        : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon'
        : h < 21 ? 'Good evening' : 'Good night';
    }, 1000);
  },
};
