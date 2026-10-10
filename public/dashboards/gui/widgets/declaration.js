// "Para Louise" — the day's line, full width, in The Garden face. The text is fitted
// to the card (largest size that fits in at most three lines), never clipped.
import { DECLARATIONS, FROM, TO, daily } from '/dashboards/gui/love.js';

export default {
  id: 'declaration',
  title: `Para ${TO}`,
  size: 'wide',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .lv-hero { height:190px; display:flex; flex-direction:column; justify-content:center; align-items:center;
        text-align:center; gap:12px; padding:0 26px; }
      .lv-hero .q { font-family:var(--font-display); line-height:1.12; color:#fff; text-wrap:balance; }
      .lv-hero .from { display:flex; align-items:center; gap:10px; font-size:16px; color:var(--rose); letter-spacing:.06em; }
      .lv-hero .from svg { width:16px; height:16px; }
    `);
    const heart = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>';
    const render = () => {
      const q = ctx.h('div', { class: 'q' }, daily(DECLARATIONS));
      const root = ctx.h('div', { class: 'lv-hero' }, q, ctx.h('div', { class: 'from', html: `${heart}<span>${FROM}</span>` }));
      body.replaceChildren(root);
      // fit: biggest size whose text stays within the space left by the signature
      requestAnimationFrame(() => {
        for (let px = 44; px >= 24; px -= 2) {
          q.style.fontSize = px + 'px';
          if (q.scrollHeight <= 190 - 40 && q.scrollHeight <= px * 1.12 * 3 + 2) break;
        }
      });
    };
    render();
    ctx.interval(render, 60 * 60 * 1000);
  },
};
