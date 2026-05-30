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
      .clk .time .ap { font-size:34px; -webkit-text-fill-color:var(--ink-soft); font-family:var(--font); font-weight:600; }
      .clk .date { color: var(--ink); font-size:22px; opacity:.92; }
    `);
    const greet = root.appendChild(ctx.h('div', { class: 'greet' }));
    const time = root.appendChild(ctx.h('div', { class: 'time' }));
    const date = root.appendChild(ctx.h('div', { class: 'date' }));
    root.parentElement?.classList.add('clk-wrap');
    root.classList.add('clk');

    const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });

    // We show HH:MM (no seconds), so only TOUCH THE DOM when a value actually
    // changes — i.e. ~once a minute, not 60×. Repainting the 104px gradient-clipped
    // time text every second pegs this Jetson's software renderer. The 10s tick is
    // cheap (string compare, no repaint) and flips the minute within ~10s of :00.
    let lastT = '', lastD = '', lastG = '';
    const tick = () => {
      const now = new Date();
      const parts = fmtTime.formatToParts(now);
      const hhmm = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
      const ap = (parts.find((p) => p.type === 'dayPeriod')?.value || '').toUpperCase();
      const t = `${hhmm}|${ap}`;
      if (t !== lastT) { lastT = t; time.replaceChildren(ctx.h('span', {}, hhmm), ctx.h('span', { class: 'ap' }, ap)); }
      const d = fmtDate.format(now);
      if (d !== lastD) { lastD = d; date.textContent = d; }
      const h = parseInt(hourOf.format(now), 10);
      const g = h < 5 ? 'A quiet night in the garden'
        : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon'
        : h < 21 ? 'Good evening' : 'Good night';
      if (g !== lastG) { lastG = g; greet.textContent = g; }
    };
    ctx.interval(tick, 10000);
  },
};
