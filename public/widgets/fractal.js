// Fractal — a raymarched 3D fractal still that regenerates every 3 hours.
// The backend renders it (src/fractal.mjs, worker threads — the kiosk has no GPU)
// and serves GET /api/fractal (meta) + /api/fractal.png. The card shows the image
// full-bleed with its name and when the next one grows. Each 3-hour slot picks a
// family (Mandelbulb, Mandelbox, quaternion Julia, Menger sponge), camera, light
// and a palette from the wall's own colours. Replaced the Astronomy Photo card.
//
// It turns, very slowly: once the backend has rendered the slot's turntable (TURN_N
// orbit frames, /api/fractal/turn/<slot>/<i>.png), the card steps one frame every
// STEP_MS with a linear crossfade — one revolution every 8 minutes. The frame shown
// is picked from the clock, so the card and the fullscreen always agree.

// "1h 12m 34s" — live, ticking every second.
const fmtLeft = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h ? `${h}h ` : ''}${h || m ? `${m}m ` : ''}${sec}s`;
};

const STYLE = `
  .frc { position:relative; width:100%; height:100%; min-height:0; overflow:hidden; }
  .frc img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:block;
    opacity:0; transition:opacity .9s ease; }
  .frc img.in { opacity:1; }
  .frc img.sp, .frf .stage img.sp { transition:opacity 1.9s linear; } /* turntable frames crossfade */
  .frf .stage { position:relative; width:100%; aspect-ratio:900/700; }
  .frf .stage img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; border-radius:20px; opacity:0; }
  .frf .stage img.in { opacity:1; }
  body.screenshot .frc img.in { transition:none; } /* QA captures: no mid-fade frame */
  /* Same look + spot as the other cards' corner titles (the card itself is bare). */
  .frc .ttl { position:absolute; top:1px; left:11px; z-index:1; font-family:var(--font-display); font-size:14px;
    font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft); pointer-events:none; }
  .frc .cap { position:absolute; left:0; right:0; bottom:0; padding:28px 16px 13px;
    background:linear-gradient(to top, rgba(4,12,9,.82), transparent);
    display:flex; align-items:flex-end; justify-content:space-between; gap:10px; }
  .frc .nm { font-family:var(--font-display); font-size:20px; color:var(--ink); line-height:1.1; }
  .frc .nx { font-size:13px; color:var(--ink-soft); white-space:nowrap; }
  .frc .wait { position:absolute; inset:0; display:grid; place-items:center; color:var(--ink-faint); font-size:14px; }
  .frf { height:100%; display:flex; flex-direction:column; gap:14px; padding:4px 30px 30px; }
  .frf img { width:100%; border-radius:20px; display:block; }
  .frf .row { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
  .frf .nm { font-family:var(--font-display); font-size:30px; color:var(--ink); }
  .frf .meta { font-size:14px; color:var(--ink-soft); }
  .frf .meta .live { color:var(--mint); font-variant-numeric:tabular-nums; }
`;

const REV_MS = 8 * 60 * 1000;
// Spin `stage` (position:relative; holds absolutely-positioned <img>s) through the
// turntable. Returns a stop function. Each new frame is decoded first, laid over the
// current one and faded in; the one beneath is dropped once it's covered.
function spin(stage, slot, n, cls) {
  const step = REV_MS / n;
  let alive = true, t = 0, cur = null;
  const show = async () => {
    if (!alive) return;
    const i = Math.floor(Date.now() / step) % n;
    const im = new Image();
    im.alt = ''; im.className = cls; im.src = `/api/fractal/turn/${slot}/${i}.png`;
    try { await im.decode(); } catch { t = setTimeout(show, step); return; }
    if (!alive || !stage.isConnected) { alive = false; return; } // panel closed / card unmounted
    stage.append(im);
    requestAnimationFrame(() => im.classList.add('in'));
    const below = [...stage.querySelectorAll('img')].filter((x) => x !== im);
    setTimeout(() => below.forEach((x) => x.remove()), step * 0.97 + 50);
    cur = im;
    t = setTimeout(show, step - (Date.now() % step) + 5); // next frame boundary
  };
  show();
  return () => { alive = false; clearTimeout(t); return cur; };
}

async function getMeta() {
  const r = await fetch('/api/fractal', { cache: 'no-store' });
  if (!r.ok) throw new Error(`fractal ${r.status}`);
  return r.json();
}

export default {
  id: 'fractal',
  title: 'Trihourly Fractal', // a new one every three hours
  icon: '❋',
  size: 'tall',
  chrome: false, // bare: no card frame/glass/title — the art sits on the wall itself

  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(STYLE);
    const img = h('img', { alt: '' });
    const nm = h('div', { class: 'nm' }, '');
    const nx = h('div', { class: 'nx' }, '');
    const wait = h('div', { class: 'wait' }, '');
    // Picture only — no caption over the art (name + timing live in the tooltip / fullscreen).
    const box = h('div', { class: 'frc' }, wait, img, h('div', { class: 'ttl' }, 'Trihourly Fractal'));
    body.replaceChildren(box);
    img.addEventListener('load', () => { img.classList.add('in'); wait.remove(); });
    let slot = null, nextAt = 0, spinning = null, stop = null;
    const refresh = async () => {
      try {
        const { meta, turn, now } = await getMeta();
        if (!meta) { nm.textContent = ''; nx.textContent = ''; return; }
        nextAt = meta.nextAt + (Date.now() - now); // align to the server clock
        if (meta.slot !== slot) {
          slot = meta.slot;
          if (stop) { stop(); stop = null; spinning = null; }
          box.querySelectorAll('img.sp').forEach((x) => x.remove());
          img.src = `/api/fractal.png?s=${slot}`;
        }
        // the turntable for this slot is ready → start turning (the still stays beneath)
        if (turn && turn.n && spinning !== slot) { spinning = slot; stop = spin(box, slot, turn.n, 'sp'); }
        nm.textContent = meta.name;
        nx.textContent = `new in ${fmtLeft(nextAt - Date.now())}`;
        box.title = `${meta.name} · new in ${fmtLeft(nextAt - Date.now())}`;
      } catch { /* keep the last picture */ }
    };
    await refresh();
    ctx.interval(refresh, 60 * 1000);
    // live seconds in the hover text (a browser only redraws an OPEN tooltip on re-hover)
    ctx.interval(() => { if (nm.textContent) box.title = `${nm.textContent} · new in ${fmtLeft(nextAt - Date.now())}`; }, 1000);
  },

  async openFull(body, ctx) {
    const { h } = ctx;
    ctx.style(STYLE);
    let meta = null, turn = null; try { ({ meta, turn } = await getMeta()); } catch { /* none */ }
    if (!meta) { body.replaceChildren(h('div', { class: 'frf' }, h('div', { class: 'meta' }, 'growing a new fractal…'))); return; }
    const stage = h('div', { class: 'stage' }, h('img', { src: `/api/fractal.png?s=${meta.slot}`, alt: meta.name, class: 'in' }));
    if (turn && turn.n) spin(stage, meta.slot, turn.n, 'sp'); // stops itself once the panel closes
    const made = new Date(meta.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const live = h('span', { class: 'live' }, '');
    body.replaceChildren(h('div', { class: 'frf' },
      stage,
      h('div', { class: 'row' },
        h('div', { class: 'nm' }, meta.name),
        h('div', { class: 'meta' }, `${meta.palette} palette · grown ${made} · next in `, live))));
    const tick = () => { live.textContent = fmtLeft(meta.nextAt - Date.now()); };
    tick(); ctx.interval(tick, 1000);
  },
};
