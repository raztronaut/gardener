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
      .clk { display:flex; flex-direction:column; gap:6px; padding:8px 10px 4px; }
      .clk .topline { display:flex; align-items:center; justify-content:space-between; gap:18px; min-height:34px; }
      .clk .greet { color: var(--ink-soft); font-size:17px; letter-spacing:.04em; }
      .clk .timerow { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
      .clk .time { font-family: var(--font-display); font-weight:600; letter-spacing:-.01em;
        font-size: 96px; line-height:.92; background:linear-gradient(120deg,#fff,var(--mint));
        -webkit-background-clip:text; background-clip:text; color:transparent; display:flex; align-items:baseline; gap:14px; }
      .clk .time .ap { font-size:34px; -webkit-text-fill-color:var(--ink-soft); font-family:var(--font); font-weight:600; }
      .clk .date { color: var(--ink); font-size:22px; opacity:.92; }
      /* Tuesday bin-night nudge — a bold RED pill on the right. shift+T toggles done. */
      .clk .trash { display:inline-flex; align-items:center; gap:10px; cursor:pointer;
        padding:11px 20px; border-radius:999px; font-size:19px; font-weight:800; letter-spacing:.01em;
        color:#fff; background:linear-gradient(135deg,#ff5a52,#d8261b);
        border:1px solid rgba(255,140,130,.6); box-shadow:0 8px 26px rgba(216,38,27,.38);
        transition:opacity .2s ease, filter .2s ease; }
      .clk .trash .lbl { white-space:nowrap; }
      .clk .trash .hint { font-family:var(--font-mono); font-size:11px; color:rgba(255,255,255,.85);
        opacity:.9; letter-spacing:.02em; font-weight:600; }
      .clk .trash.done { color:var(--ink-faint); background:rgba(120,247,176,.07); font-weight:600;
        border-color:var(--stroke); box-shadow:none; }
      .clk .trash.done .lbl { text-decoration:line-through; }
    `);
    const topline = root.appendChild(ctx.h('div', { class: 'topline' }));
    const greet = topline.appendChild(ctx.h('div', { class: 'greet' }));
    const timerow = root.appendChild(ctx.h('div', { class: 'timerow' }));
    const time = timerow.appendChild(ctx.h('div', { class: 'time' }));
    const date = root.appendChild(ctx.h('div', { class: 'date' }));
    root.parentElement?.classList.add('clk-wrap');
    root.classList.add('clk');

    // ---- Tuesday "take the trash out" reminder -------------------------------
    // Visible only on Tuesdays. Toggles between TODO and done; the done state is
    // remembered for the day (localStorage, stamped with the date so it resets
    // each Tuesday). Toggle by tapping the pill OR typing /trash in the bar
    // (a slash command, so it never clashes with type-anywhere note taking).
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const weekdayOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const STORE = 'garden.trashDone';
    let trashEl = null;
    const isDone = () => {
      try { return localStorage.getItem(STORE) === dayKey.format(new Date()); } catch { return false; }
    };
    const setDone = (on) => {
      try { on ? localStorage.setItem(STORE, dayKey.format(new Date())) : localStorage.removeItem(STORE); } catch { /* ignore */ }
      paintTrash();
    };
    function paintTrash() {
      const tuesday = weekdayOf.format(new Date()) === 'Tue';
      if (!tuesday) { if (trashEl) { trashEl.remove(); trashEl = null; } return; }
      const done = isDone();
      if (!trashEl) {
        trashEl = ctx.h('button', { class: 'trash', type: 'button', title: 'tap or press shift+T to toggle',
          onClick: () => setDone(!isDone()) });
        topline.appendChild(trashEl);
      }
      trashEl.classList.toggle('done', done);
      trashEl.replaceChildren(
        ctx.h('span', {}, done ? '✅' : '🗑'),
        ctx.h('span', { class: 'lbl' }, done ? 'Trash taken out' : 'TODAY IS TRASH DAY!!'),
        ctx.h('span', { class: 'hint' }, done ? 'undo · shift+T' : 'shift+T'));
    }
    // React to the /trash command dispatched from the feedback bar.
    const onToggle = () => setDone(!isDone());
    window.addEventListener('garden:trash-toggle', onToggle);

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
      paintTrash();
    };
    ctx.interval(tick, 10000);
    return () => window.removeEventListener('garden:trash-toggle', onToggle);
  },
};
