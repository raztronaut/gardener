// The Gardener™ — frontend runtime (stable template).
// Loads widgets from /widgets/manifest.json, mounts them into #garden, polls
// the backend for version/night changes, and handles the feedback bar.
//
// WIDGET CONTRACT  (see AGENTS.md): each widget is an ES module at
//   /widgets/<id>.js  default-exporting:
//   {
//     id: 'clock', title: 'Clock', icon: '🕰',
//     size: 'sm' | 'md' | 'lg' | 'full' | 'tall',   // grid footprint
//     chrome: true,                                  // false = bare (no card)
//     async mount(body, ctx) { ... return optionalCleanup }
//   }
// mount() MUST NOT throw. Do network in async with try/catch and render
// loading / error / empty states. Use ctx.* helpers below.

const qs = new URLSearchParams(location.search);
const SCREENSHOT = qs.has('screenshot');
let UI_SOUND = () => {}; // interface sounds — set once lib/uisound.js loads (see below)

// ---- global error markers (read by smoke test via --dump-dom) --------------
const counters = { core: 0, import: 0, mount: 0 };
function markError(kind, detail) {
  counters[kind] = (counters[kind] || 0) + 1;
  const total = counters.core + counters.import + counters.mount;
  document.documentElement.dataset.gardenerError = String(total);
  document.documentElement.dataset.gardenerCore = String(counters.core);
  document.documentElement.dataset.gardenerImport = String(counters.import);
  document.documentElement.dataset.gardenerMount = String(counters.mount);
  // eslint-disable-next-line no-console
  console.error(`[gardener:${kind}]`, detail);
}
window.addEventListener('error', (e) => markError('core', e.message || e.error));
window.addEventListener('unhandledrejection', (e) => markError('core', e.reason));

// ---- tiny DOM + data helpers (the widget context) --------------------------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return el;
}

const cleanups = [];
function makeCtx(widgetId) {
  const intervals = [];
  const ctx = {
    config: window.__GARDEN_STATE || {},
    h,
    proxyUrl: (url) => `/api/proxy?url=${encodeURIComponent(url)}`,
    // Fetch JSON through the SSRF-safe backend proxy by default.
    async fetchJSON(url, { viaProxy = true, timeout = 24000 } = {}) {
      const target = viaProxy ? `/api/proxy?url=${encodeURIComponent(url)}` : url;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      try {
        const r = await fetch(target, { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    },
    async fetchText(url, { viaProxy = true, timeout = 24000 } = {}) {
      const target = viaProxy ? `/api/proxy?url=${encodeURIComponent(url)}` : url;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      try {
        const r = await fetch(target, { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.text();
      } finally { clearTimeout(t); }
    },
    // Repeating timer that fires immediately and is auto-cleared on reload.
    interval(fn, ms) {
      const run = () => { try { fn(); } catch (e) { markError('mount', `[${widgetId}] ${e.message}`); } };
      run();
      const id = setInterval(run, ms);
      intervals.push(id);
      return id;
    },
    // Scoped style injection (deduped per widget).
    style(cssText) {
      const sid = `style-${widgetId}`;
      if (document.getElementById(sid)) return;
      document.head.appendChild(h('style', { id: sid, html: cssText }));
    },
    // A TEMPORARY replacement widget (manifest "replaces" + "until") may end its own
    // run early: retire(at) persists "hand the slot back at `at`" (the earliest call
    // wins), and the wall swaps the original card back by itself (see REPLACEMENTS).
    retire(at = Date.now()) {
      try {
        const k = RETIRE_KEY(widgetId.split(':')[0]), prev = Number(localStorage.getItem(k));
        if (!(prev > 0 && prev <= at)) localStorage.setItem(k, String(Math.round(at)));
      } catch { /* storage unavailable: the manifest's "until" still ends it */ }
    },
    loading: (msg = 'growing…') => h('div', { class: 'widget-loading' }, h('span', { class: 'spinner' }), msg),
    error: (msg = 'unavailable') => h('div', { class: 'widget-error' }, '⚠', msg),
  };
  cleanups.push(() => intervals.forEach(clearInterval));
  // Stop handle for short-lived mounts (the fullscreen widget panel): clears
  // this ctx's timers without waiting for a page reload.
  ctx._stop = () => intervals.forEach(clearInterval);
  return ctx;
}

// ---- widget loader ----------------------------------------------------------
// 4-col grid: '' = half width (span 2), 'q' = quarter-width square (span 1),
// 'w4' = full width (span 4), 'tall'/'r2' add a second row.
const SIZE_CLASS = { sq: 'q', sm: '', md: '', lg: 'w4', full: 'w4', wide: 'w4', tall: 'tall', hero: 'w4 tall', stage: 'w4 stage' };
const WIDGET_MODS = {}; // id → widget module object (filled by loadWidgets)

// ---- one-day surprise: a single widget gets "taken over" for exactly one day ----
// On PRANK.date (one random day this month), the PRANK.widget card renders a message
// instead of its normal contents — a private in-joke for Max. Any other day it mounts
// normally. (?pranktest=1 forces it on for a look.) Rendered in place of the real
// mount so the widget never overwrites it.
const PRANK = {
  date: '2026-08-14',                 // a random day within the month after this tending
  widget: 'hacker-news',              // the (arbitrarily chosen) widget that gets taken over
  head: 'MAX !!!!',
  body: 'stop fucking in the couch — i can see you in the hidden camera bro',
  foot: '· 👀 hidden camera ·',
};
function prankDayKey() {
  const tz = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function prankActiveFor(id) {
  const on = (typeof qs !== 'undefined' && qs.has('pranktest')) || prankDayKey() === PRANK.date;
  return on && id === PRANK.widget;
}
function renderPrank(body) {
  body.replaceChildren(h('div', {
    style: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', gap: '18px', padding: '10px' },
  },
    h('div', { style: { fontFamily: 'var(--font-display)', fontWeight: '800', fontSize: '46px',
      lineHeight: '1', letterSpacing: '.02em', color: '#ff5a5a', textShadow: '0 4px 20px rgba(0,0,0,.35)' } }, PRANK.head),
    h('div', { style: { fontSize: '22px', lineHeight: '1.35', fontWeight: '600', color: 'var(--ink)', maxWidth: '92%' } }, PRANK.body),
    h('div', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px', letterSpacing: '.1em', color: 'var(--ink-faint)' } }, PRANK.foot)));
}

// Load ALL widgets CONCURRENTLY while preserving visual order: modules are
// imported in parallel, then cards are created synchronously in manifest order,
// then every mount() (the data-fetching part) runs in parallel. Sequential
// awaiting made the remote Wall mirror serialize ~21 tunnel round-trips
// (~10s boot); parallel collapses that to roughly the slowest single widget.
async function loadWidgets(enabled, mountPoint, { before = null } = {}) {
  const mods = await Promise.all(enabled.map((entry) =>
    import(`${entry.file.startsWith('/') ? entry.file : `/widgets/${entry.file}`}?v=${window.__GARDEN_VERSION}`).catch((e) => ({ __importError: e }))));
  const mounts = [];
  mods.forEach((mod, index) => {
    const entry = enabled[index];
    if (mod.__importError) {
      markError('import', `${entry.file}: ${mod.__importError.message}`);
      mountPoint.appendChild(h('div', { class: 'card' },
        h('div', { class: 'widget-error' }, '⚠', `widget "${entry.id}" failed to load`)));
      return;
    }
    const w = mod.default || mod.widget || mod;
    if (!w || typeof w.mount !== 'function') {
      markError('import', `${entry.file}: no default export with mount()`);
      return;
    }
    const bare = w.chrome === false;
    WIDGET_MODS[entry.id] = w; // registry for fullscreen remounts (click / right-stick open)
    // frame:false = no glass/background/border but the corner title stays (the
    // zigzag of open cards); chrome:false = fully bare (no title either).
    const card = h('div', { class: `card ${SIZE_CLASS[w.size] || ''} ${bare ? 'bare' : ''} ${w.frame === false ? 'unframed' : ''}`.replace(/\s+/g, ' ').trim(), 'data-wid': entry.id });
    // Click a widget to open it fullscreen — same path as the controller's
    // highlight+A (openWidgetPanel). Skip clicks the widget handled itself
    // (e.g. Mario's grow toy calls stopPropagation) and right-click edits.
    card.addEventListener('click', (e) => {
      if (e.button !== 0 || e.target.closest('[contenteditable="true"], [data-editable].pruning')) return;
      // a full-screen 'stage' card (the Arcade) is already its own big view: a tap inside
      // it (a game tile) must not open a second copy of it in the panel
      if (w.size === 'stage') return;
      openWidgetPanel(entry.id);
    });
    // Staggered wake-up: each card eases in slightly after the previous one.
    // Cap the index so a large garden can't drag the entrance out too long.
    card.style.setProperty('--enter-index', String(Math.min(index, 16)));
    let body = card;
    if (!bare) {
      // Title text is an editable slot — right-click to hand-prune it. The
      // override (if any) wins over the widget's natural title.
      const slot = 'widget-title:' + (w.id || entry.id);
      const titleText = (window.__GARDEN_EDITS || {})[slot] ?? (w.title || w.id);
      // No icon/emoji — titles are bare mono labels tucked into the corner.
      card.appendChild(h('div', { class: 'card-title' },
        h('span', { 'data-editable': slot }, titleText)));
      body = h('div', { class: 'card-body' });
      card.appendChild(body);
    }
    if (before && before.parentNode === mountPoint) mountPoint.insertBefore(card, before); else mountPoint.appendChild(card);
    // One-day takeover: on its day, this widget shows the surprise message instead
    // of mounting normally (so nothing overwrites it). Every other day: mount as usual.
    if (prankActiveFor(entry.id)) { try { renderPrank(body); } catch { /* never break boot */ } return; }
    mounts.push((async () => {
      try {
        // LAYOUT-STABILITY RULE: an empty (still-fetching) card must already have
        // its loaded size. We remember each card's settled height and reserve it as
        // min-height on the next boot, so data arriving never resizes or shifts the
        // grid; the content just fades into the reserved space.
        reserveCardSize(card, entry.id);
        // Glass + content appear TOGETHER: a framed card stays invisible until its
        // baked glass is decoded AND its widget has its data (or 3 s pass).
        if (!SCREENSHOT && !card.classList.contains('bare') && !card.classList.contains('unframed') && !card._gate) {
          card._gate = { glass: false, content: false };
          card.classList.add('awaiting-glass');
          const reveal = () => { if (card._gate.glass && card._gate.content) card.classList.remove('awaiting-glass'); };
          card.addEventListener('glass-ready', () => { card._gate.glass = true; reveal(); }, { once: true });
          card._reveal = () => { card._gate.content = true; reveal(); };
          setTimeout(() => { card._gate.glass = card._gate.content = true; reveal(); }, 3000);
          GB_READY.then((gb) => gb && gb.bakeCards([card]));
        }
        const fail = setTimeout(() => body.classList.add('ready'), 4000);
        const wctx = makeCtx(w.id);
        card._unmount = () => { try { wctx._stop(); } catch { /* ignore */ } };
        const cleanup = await w.mount(body, wctx);
        if (typeof cleanup === 'function') { const s = card._unmount; card._unmount = () => { s(); try { cleanup(); } catch { /* ignore */ } }; }
        clearTimeout(fail); body.classList.add('ready'); card._reveal?.();
        settleCardSize(card, entry.id);
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      } catch (e) {
        body.classList.add('ready'); card._reveal?.();
        markError('mount', `${entry.id}: ${e.stack || e.message}`);
        body.appendChild(h('div', { class: 'widget-error' }, '⚠', 'widget crashed on mount'));
      }
    })());
  });
  // Every widget card is now in the DOM (each showing its own loading→data/error
  // state), so the garden is STRUCTURALLY ready. Publish the contract markers here
  // — before awaiting the data-fetching mounts — so a slow/stalled external API
  // fetch can't push readiness past the headless render budget. The fetches keep
  // resolving in the background; boot()'s finally re-affirms these same markers.
  if (!before) {
    document.documentElement.dataset.gardenerWidgetCount = String(enabled.length);
    document.documentElement.dataset.gardenerReady = 'true';
    document.documentElement.dataset.gardenerBoot = 'ready';
  }
  await Promise.all(mounts);
}

async function boot() {
  // Pull state (version, night, location, canvas) first.
  let state = {};
  try { state = await (await fetch('/api/state', { cache: 'no-store' })).json(); } catch (e) { markError('core', `state: ${e.message}`); }
  window.__GARDEN_STATE = state;
  window.__GARDEN_VERSION = state.version || Date.now(); // cache-bust token
  // Only a REAL numeric version becomes the reload baseline (a failed boot must
  // not fabricate one and trigger an endless reload loop).
  window.__GARDEN_BOOT_VERSION = typeof state.version === 'number' ? state.version : null;
  setNight(!!state.night);
  window.__GARDEN_EDITS = state.edits || {}; // hand-pruned overrides, applied at render
  const sub = document.getElementById('subtitle');
  if (sub) sub.textContent = window.__GARDEN_EDITS.subtitle ?? (state.location || sub.textContent);
  const brand = document.querySelector('[data-editable="brand"]');
  if (brand && window.__GARDEN_EDITS.brand) brand.textContent = window.__GARDEN_EDITS.brand;
  setIterBadge(state.iteration, state.agentModel);
  // A refresh/reload RESETS zoom to 100% (per request) — don't restore a stale
  // controller zoom. Clears the persisted level so it can't get stuck.
  try { localStorage.removeItem('garden.zoomlvl'); setZoomLevel(0); } catch { /* ignore */ }

  // Dashboards (public/dashboards.json): 'main' is the common wall; each other
  // dashboard is bound to a controller shoulder combo that TOGGLES to it and back.
  try { DASHBOARDS = (await (await fetch(`/dashboards.json?v=${window.__GARDEN_VERSION}`, { cache: 'no-store' })).json()).dashboards || DASHBOARDS; } catch (e) { markError('core', `dashboards: ${e.message}`); }
  const startDash = DASHBOARDS.find((d) => d.id === qs.get('dash')) ? qs.get('dash') : 'main';

  // Load manifest + widgets.
  const garden = document.getElementById('garden');
  const enabled = await dashboardWidgets(startDash);
  setDashAttr(startDash);

  // Concurrent load (order preserved inside loadWidgets) — see its comment.
  try {
    await loadWidgets(enabled, garden);
  } finally {
    // Always publish the contract markers smoke depends on, even on partial failure.
    document.documentElement.dataset.gardenerReady = 'true';
    document.documentElement.dataset.gardenerWidgetCount = String(enabled.length);
    document.documentElement.dataset.gardenerBoot = 'ready';
    checkOverflow();
    // Re-check after async widget content settles (lists/quotes can grow).
    setTimeout(checkOverflow, 3000);
    setTimeout(checkOverflow, 6500);
    startPolling();
    setInterval(() => { checkReplacements().catch(() => {}); }, 60 * 1000);
    // Note bar: baked glass too — its backdrop (the bottom of the wall) never changes
    // while typing (the text sits ON the glass), so one cached bake is exact. No rim
    // highlight and no per-keystroke effect here (too heavy on the seed box).
    GB_READY.then((gb) => {
      const f = document.getElementById('feedbackForm');
      if (gb && f) gb.bakeCards([f]);
    });
    // Panel glass: a wall snapshot refreshed every 10 min while no panel is open.
    // (Card glass is baked as the cards are created — see loadWidgets.)
    setTimeout(() => GB_READY.then((gb) => {
      if (!SCREENSHOT) {
        // Every 10 min (each snapshot is a GPU readback on the kiosk), then pre-bake the
        // glass for every panel size the wall remembers, so panels open with it ready.
        const snapNow = async () => {
          if (panelOpen() || document.body.classList.contains('arcade-full')) return;
          await gb.refreshSnapshot();
          const busy = () => panelOpen() || paletteOpen() || document.body.classList.contains('arcade-full');
          gb.prebakePanels(panelRects(), busy).then(() => gb.prebakePanels(palRects(), busy, { veil: PAL_VEIL }));
        };
        setTimeout(snapNow, 2500); setInterval(snapNow, 10 * 60 * 1000);
      }
    }), 800);
    // QA: ?open=<widget id> opens that widget's fullscreen view (headless captures only).
    if (qs.get('open')) { document.body.classList.add('qa-open'); setTimeout(() => openWidgetPanel(qs.get('open')), 300); }
  }
}

// ---- dashboards -----------------------------------------------------------------
let DASHBOARDS = [{ id: 'main', name: 'GardenOS', manifest: '/widgets/manifest.json' }];
let CURRENT_DASH = 'main';
const PINNED = ['clock']; // stays on every dashboard (GardenOS header + time)
function setDashAttr(id) {
  CURRENT_DASH = id; window.__DASH = id;
  document.body.dataset.dash = id;
  document.body.classList.toggle('alt-dash', id !== 'main');
}
async function dashboardWidgets(id) {
  const d = DASHBOARDS.find((x) => x.id === id) || DASHBOARDS[0];
  let manifest = { widgets: [] };
  try { manifest = await (await fetch(`${d.manifest}?v=${window.__GARDEN_VERSION}`, { cache: 'no-store' })).json(); }
  catch (e) { markError('core', `manifest(${id}): ${e.message}`); }
  let list = applyReplacements((manifest.widgets || []).filter((w) => w.enabled !== false)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  if (id === 'main') REPLACEMENTS = (manifest.widgets || []).filter((w) => w.enabled !== false && w.replaces);
  if (id !== 'main') list = [{ id: 'clock', file: 'clock.js', order: 0 }, ...list.filter((w) => !PINNED.includes(w.id))];
  return list;
}
// ---- temporary replacements ------------------------------------------------------
// A manifest entry with "replaces": "<id>", "until": "<ISO time>" takes that widget's
// place on the wall (give it the same "order") until `until`, or earlier once the
// widget calls ctx.retire(at) (persisted in localStorage). Then the original returns by
// itself: on the next boot / dashboard switch, and live via checkReplacements(), which
// swaps the card in place once nothing is open. Exactly one of each pair is mounted.
const RETIRE_KEY = (id) => `garden.retire.${id}`;
let REPLACEMENTS = [];
function replacementLive(w, now = Date.now()) {
  let end = Date.parse(w.until);
  if (!Number.isFinite(end)) return false; // a malformed date never hides the original
  try { const r = Number(localStorage.getItem(RETIRE_KEY(w.id))); if (r > 0) end = Math.min(end, r); } catch { /* ignore */ }
  return now < end;
}
function applyReplacements(list) {
  const hide = new Set();
  for (const w of list) if (w.replaces) hide.add(replacementLive(w) ? w.replaces : w.id);
  return list.filter((w) => !hide.has(w.id));
}
async function checkReplacements() {
  if (CURRENT_DASH !== 'main' || panelOpen() || document.body.classList.contains('arcade-full')) return;
  const garden = document.getElementById('garden');
  for (const w of REPLACEMENTS) {
    if (replacementLive(w)) continue;
    const old = garden?.querySelector(`:scope > .card[data-wid="${CSS.escape(w.id)}"]`);
    if (!old) continue;
    const orig = (await dashboardWidgets('main')).find((x) => x.id === w.replaces);
    if (!orig || !old.isConnected) continue;
    try { old._unmount?.(); } catch { /* ignore */ }
    const anchor = document.createComment(`was ${w.id}`);
    old.replaceWith(anchor);
    await loadWidgets([orig], garden, { before: anchor });
    anchor.remove();
    setTimeout(checkOverflow, 1500);
  }
}

// Controller combo code: L1=a R1=b L2=c R2=d, sorted ("L1+R1+L2" → "abc").
const comboCode = (combo) => (combo || '').split('+').map((b) => ({ L1: 'a', R1: 'b', L2: 'c', R2: 'd' })[b.trim()] || '').sort().join('');
// Switches are QUEUED: a second combo pressed while the first switch is still loading its
// cards used to see the old CURRENT_DASH, toggle the wrong way and run two loads over each
// other (the wall ended up with only the clock). Now each switch runs after the last.
let dashQueue = Promise.resolve();
function switchDashboard(id) {
  dashQueue = dashQueue.then(() => doSwitchDashboard(id)).catch(() => {});
  return dashQueue;
}
async function doSwitchDashboard(id) {
  if (id === CURRENT_DASH) id = 'main';                 // same combo again → back to the common wall
  if (!DASHBOARDS.find((d) => d.id === id)) return;
  if (panelOpen()) closePanel();
  try { window.__GARDEN_GAME?.stop?.(); } catch { /* ignore */ }
  try { window.__SB2?.stop?.(); } catch { /* ignore */ } // the native SB2 port, belt and braces (its music must never outlive the Arcade)
  window.__GARDEN_GAME = null;
  document.body.classList.remove('arcade-full');
  const garden = document.getElementById('garden');
  for (const card of [...garden.querySelectorAll(':scope > .card')]) {
    if (PINNED.includes(card.dataset.wid)) continue;
    try { card._unmount?.(); } catch { /* ignore */ }
    card.remove();
  }
  const list = (await dashboardWidgets(id)).filter((w) => !PINNED.includes(w.id));
  setDashAttr(id);
  await loadWidgets(list, garden);
  setTimeout(checkOverflow, 1500);
  const d = DASHBOARDS.find((x) => x.id === id);
  toast(id === 'main' ? 'GardenOS' : d.name);
}

// ---- layout stability: reserve each card's loaded size before its data arrives ----
// Settled heights persist in localStorage (per widget id, per canvas zoom level) so
// the very first paint after a reload already has every card at its final size.
const CARD_H_KEY = (id) => `garden.cardH.${id}`;
function reserveCardSize(card, id) {
  if (SCREENSHOT) return; // QA captures measure natural layout
  try {
    const hgt = parseInt(localStorage.getItem(CARD_H_KEY(id)) || '0', 10);
    if (hgt > 40 && hgt < 1600) card.style.minHeight = `${hgt}px`;
  } catch { /* storage unavailable */ }
}
function settleCardSize(card, id) {
  if (SCREENSHOT) return;
  // Measure after the content has painted, then hand layout back to the grid.
  setTimeout(() => {
    const hgt = Math.round(card.getBoundingClientRect().height);
    try { if (hgt > 40) localStorage.setItem(CARD_H_KEY(id), String(hgt)); } catch { /* ignore */ }
    card.style.minHeight = '';
  }, 600);
}

// Detect when widgets exceed the locked 900×1600 canvas (overflow:hidden would
// otherwise clip them silently). Publishes data-gardener-overflow; smoke fails
// if it exceeds tolerance, so the daily agent can't ship a clipped garden.
function checkOverflow() {
  const garden = document.getElementById('garden');
  if (!garden) return;
  const over = Math.max(0, garden.scrollHeight - garden.clientHeight);
  document.documentElement.dataset.gardenerOverflow = String(over);
  // Per-card INTERNAL clipping: every .card is overflow:hidden, so content taller
  // than the card is silently cut off. Measure each and surface the worst, plus
  // the names of clipped widgets — smoke fails on this so clipping can't ship.
  let maxClip = 0; const clipped = [];
  for (const card of garden.querySelectorAll(':scope > .card')) {
    let clip = Math.round(card.scrollHeight - card.clientHeight);
    // scrollHeight can't see UPWARD spill: a vertically-centred body whose content
    // outgrows it overflows both ways, sliding under the card title (the Air card
    // hid its "AIR" title behind the big number this way, 2026-10-21). Count how
    // far the body's direct children rise above the body's own top edge too.
    const cbody = card.querySelector(':scope > .card-body');
    if (cbody && card.querySelector(':scope > .card-title')) {
      const top = cbody.getBoundingClientRect().top;
      for (const kid of cbody.children) {
        const r = kid.getBoundingClientRect();
        if (r.height > 0) clip = Math.max(clip, Math.round(top - r.top));
      }
    }
    if (clip > maxClip) maxClip = clip;
    if (clip > 8) {
      const name = (card.querySelector('.card-title')?.textContent || 'widget').trim().replace(/\s+/g, ' ').slice(0, 24);
      clipped.push(`${name}(${clip})`);
    }
  }
  document.documentElement.dataset.gardenerCardClip = String(maxClip);
  document.documentElement.dataset.gardenerClipped = clipped.join(', ');
}

// ---- night veil -------------------------------------------------------------
function setNight(on) {
  const was = document.body.classList.contains('night');
  document.body.classList.toggle('night', !!on && !SCREENSHOT);
  if (was && !on) UI_SOUND('wake'); // the wall wakes up (07:00 / leaving night mode)
}

// ---- growth bloom beside the wordmark (the tending count) -------------------
function setIterBadge(n, model) {
  const b = document.getElementById('iterBadge');
  if (!b) return;
  const c = Number(n) || 0;
  b.textContent = `❀ ${c} tending${c === 1 ? '' : 's'}`;
  const m = document.getElementById('agentModel');
  if (m && model) { m.textContent = `agent model: ${model}`; m.hidden = false; }
}

// ---- backend polling: reload on version change, react to night --------------
function startPolling() {
  let baseline = window.__GARDEN_BOOT_VERSION; // may be null if boot state failed
  setInterval(async () => {
    try {
      const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
      setNight(!!s.night);
      setIterBadge(s.iteration, s.agentModel);
      checkOverflow();
      if (typeof s.version === 'number') {
        if (baseline == null) baseline = s.version;            // adopt baseline, no reload
        else if (s.version !== baseline) location.reload();    // a new garden was grown
      }
    } catch { /* offline blip — ignore */ }
  }, 8000);
}

// ---- feedback bar -----------------------------------------------------------
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}
// ---- command panel (/iterations changelog, /help) --------------------------
function focusInput() {
  const i = document.getElementById('feedbackInput');
  if (i && document.activeElement !== i) { try { i.focus(); } catch { /* ignore */ } }
}
function panelOpen() { return !!document.getElementById('panel')?.classList.contains('open'); }
// The panel's close affordance adapts to how you're driving the wall: with a
// controller it shows an "L2 · leave" keycap; with mouse/keyboard, "esc · close".
let padMode = false;
function updateCloseHint() {
  const b = document.getElementById('panelClose');
  if (!b) return;
  // A plain × (no text). With the controller, a quiet key hint joins it:
  // pages close with Y; games use Y in-game, so L2 leaves.
  const x = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  b.innerHTML = !padMode ? x : `${x}<kbd>${window.__GARDEN_GAME ? 'L2' : 'Y'}</kbd>`;
}
function setPadMode(on) { if (padMode !== on) { padMode = on; updateCloseHint(); } }

// Each panel (keyed by its title's first part) remembers its settled height and
// opens at it, so content arriving never grows the panel; then it fits content.
const PANEL_KEY = (t) => `garden.panelH.${String(t).split(' — ')[0].replace(/\s+\d+.*$/, '').trim()}`;
// The rect a panel of height h occupies (bottom-aligned in #panel's padding box,
// full width, capped at the available height) — what bakePanel() will measure.
function panelRects() {
  const p = document.getElementById('panel'), root = p && p.parentElement; if (!root) return [];
  const cs = getComputedStyle(p), rb = root.getBoundingClientRect(), z = rb.width / (root.offsetWidth || rb.width) || 1;
  const pt = parseFloat(cs.paddingTop) * z, pr = parseFloat(cs.paddingRight) * z, pb = parseFloat(cs.paddingBottom) * z, pl = parseFloat(cs.paddingLeft) * z;
  const maxH = rb.height - pt - pb, bottom = rb.top + rb.height - pb, hs = new Set();
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PANEL_KEY(''))) { const v = parseInt(localStorage.getItem(k), 10); if (v > 120) hs.add(Math.min(maxH, v * z)); } } } catch { /* ignore */ }
  hs.add(maxH); // fullscreen widgets
  return [...hs].map((h) => ({ left: rb.left + pl, top: bottom - h, width: rb.width - pl - pr, height: h }));
}
function reservePanelSize(title) {
  const card = document.querySelector('#panel .panel-card'); if (!card || SCREENSHOT) return;
  let hgt = 0; try { hgt = parseInt(localStorage.getItem(PANEL_KEY(title)) || '0', 10); } catch { /* ignore */ }
  card.style.minHeight = hgt > 120 ? `${hgt}px` : '';
  clearTimeout(reservePanelSize.t);
  reservePanelSize.t = setTimeout(() => {
    card.style.minHeight = '';
    const h2 = Math.round(card.getBoundingClientRect().height);
    try { if (h2 > 120) localStorage.setItem(PANEL_KEY(title), String(h2)); } catch { /* ignore */ }
  }, 1500);
}
// Baked liquid glass (lib/glassbake.js) — computed once, shown as an image.
// (The live version, lib/lgr.js, ran the panel at 29 fps / cards at 13 fps.)
let GB = null;
// Arcade volume: entering the Arcade remembers the wall's speaker level and switches to
// the Arcade's (42 % by default); leaving keeps whatever level the game ended at as the
// Arcade's next default and restores the wall's.
let wallVol = null;
async function arcadeVolume(entering) {
  const get = async () => { try { return (await (await fetch('/api/volume', { cache: 'no-store' })).json()).volume; } catch { return null; } };
  const set = (v) => fetch('/api/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volume: v }) }).catch(() => {});
  if (entering) {
    wallVol = await get();
    if (wallVol != null) try { localStorage.setItem('garden.wallVol', String(wallVol)); } catch { /* ignore */ }
    let av = 42; try { av = parseInt(localStorage.getItem('garden.arcadeVol') || '42', 10); } catch { /* ignore */ }
    if (Number.isFinite(av)) set(av);
  } else {
    const now = await get();
    if (now != null) try { localStorage.setItem('garden.arcadeVol', String(now)); } catch { /* ignore */ }
    if (wallVol == null) try { wallVol = parseInt(localStorage.getItem('garden.wallVol') || '', 10); } catch { /* ignore */ } // reloaded mid-game
    if (Number.isFinite(wallVol)) set(wallVol);
    wallVol = null;
  }
}

// Volume pill (MX Master thumb wheel → pad.mjs → 'volup'/'voldown'): speaker icon, a bar
// and the percent, fading in at the top of the wall and out ~1.4 s after the last notch.
let volEl = null, volT = 0;
async function showVolume() {
  let v = null; try { v = await (await fetch('/api/volume', { cache: 'no-store' })).json(); } catch { /* ignore */ }
  if (!v || v.volume == null) return;
  if (!volEl) {
    volEl = h('div', { id: 'volpill' });
    (document.getElementById('zoomroot') || document.body).appendChild(volEl);
  }
  const pct = Math.max(0, Math.min(100, v.volume));
  volEl.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${volIcon(pct, v.mute)}"/></svg><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}</b>`;
  updateVolButton(pct, v.mute);
  volEl.classList.add('on');
  UI_SOUND('nav'); // hear the new level
  clearTimeout(volT); volT = setTimeout(() => volEl.classList.remove('on'), 1400);
}

const volIcon = (pct, mute) => (mute || pct === 0 ? 'M3 9v6h4l5 4V5L7 9H3zm13.6 3 2.7-2.7-1.3-1.3-2.7 2.7-2.7-2.7-1.3 1.3 2.7 2.7-2.7 2.7 1.3 1.3 2.7-2.7 2.7 2.7 1.3-1.3z'
  : pct < 50 ? 'M3 9v6h4l5 4V5L7 9H3zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z'
  : 'M3 9v6h4l5 4V5L7 9H3zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM12 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z');

// Top-right speaker button (left of the rainforest bird): click opens a slider popover
// (− / slider / + / percent); the mouse wheel over the button or popover nudges 2 %;
// the controller reaches it by stick focus — A opens, ←/→ (or ↑/↓) adjust, B closes.
let volNow = null, volPostT = 0, volTouched = 0;
// a level read from the server, unless the user has changed it since the read began
const volRead = () => { const t0 = Date.now(); fetch('/api/volume', { cache: 'no-store' }).then((x) => x.json())
  .then((v) => { if (v && v.volume != null && volTouched < t0) updateVolButton(v.volume, v.mute); }).catch(() => {}); };
function updateVolButton(pct, mute) {
  const b = document.getElementById('volBtn'); if (!b) return;
  if (pct != null) volNow = pct;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${volIcon(volNow ?? 50, mute)}"/></svg>`;
  b.title = volNow == null ? 'Volume' : `Volume ${volNow}%`;
  const m = document.getElementById('volMenu');
  if (m && volNow != null) {
    const r = m.querySelector('input'); if (r && document.activeElement !== r) r.value = String(volNow);
    m.querySelector('b').textContent = `${volNow}%`;
    m.style.setProperty('--v', `${volNow}%`);
  }
}
function setVolume(v) {
  v = Math.max(0, Math.min(100, Math.round(v)));
  volTouched = Date.now();
  updateVolButton(v, false);
  clearTimeout(volPostT); // coalesce a drag into a few pactl calls
  volPostT = setTimeout(() => fetch('/api/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volume: v }) })
    .then(() => UI_SOUND('nav')).catch(() => {}), 70);
}
function closeVolMenu() { document.getElementById('volMenu')?.remove(); document.getElementById('volBtn')?.classList.remove('open'); }
const volMenuOpen = () => !!document.getElementById('volMenu');
function volumeMenu() {
  const b = document.getElementById('volBtn'); if (!b) return;
  if (volMenuOpen()) { closeVolMenu(); return; }
  closeRfMenu();
  const root = document.getElementById('zoomroot') || document.body;
  const close = () => { closeVolMenu(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = (e) => { const m = document.getElementById('volMenu'); if (m && !m.contains(e.target) && !b.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const range = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(volNow ?? 50), 'aria-label': 'Volume',
    oninput: (e) => setVolume(+e.target.value) });
  const step = (d) => setVolume((volNow ?? 50) + d);
  const menu = h('div', { id: 'volMenu', onwheel: (e) => { e.preventDefault(); step(e.deltaY < 0 ? 2 : -2); } },
    h('button', { class: 'vm-step', type: 'button', 'aria-label': 'Quieter', onclick: () => step(-5) }, '−'),
    range,
    h('button', { class: 'vm-step', type: 'button', 'aria-label': 'Louder', onclick: () => step(5) }, '+'),
    h('b', {}, volNow == null ? '—' : `${volNow}%`));
  root.appendChild(menu);
  b.classList.add('open');
  const r = b.getBoundingClientRect(), rb = root.getBoundingClientRect(), z = rb.width / (root.offsetWidth || rb.width) || 1;
  menu.style.top = `${Math.round((r.bottom - rb.top) / z + 8)}px`;
  menu.style.right = `${Math.round((rb.right - r.right) / z)}px`;
  updateVolButton(null);
  volRead();
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
}
function volMenuNav(action) {
  if (!volMenuOpen()) return false;
  if (/^f?(right|up)$/.test(action)) setVolume((volNow ?? 50) + 4);
  else if (/^f?(left|down)$/.test(action)) setVolume((volNow ?? 50) - 4);
  else if (action === 'ok' || action === 'fopen' || action === 'back' || action === 'events' || action === 'hn') closeVolMenu();
  else return false;
  return true;
}
function wireVolumeButton() {
  const b = document.getElementById('volBtn'); if (!b) return;
  b.addEventListener('click', () => volumeMenu());
  b.addEventListener('wheel', (e) => { e.preventDefault(); setVolume((volNow ?? 50) + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
  updateVolButton(null);
  volRead();
}

// /rainforest — forest ambience from real field recordings (lib/rainforest.js; audio in the
// gitignored data/ambience/, credits via /credits). Its on/off state survives reloads; it
// ducks out while an Arcade game owns the speakers.
let RF = null;
// line icons per forest (24×24, stroke) for the top-right button and its menu
const RF_ICON = {
  default: 'M3.5 15.5c3 1.8 7.5 2 10.5-.5 2-1.7 3-4 3.3-6.5l3.2-1-3.3-1.3c-1-1.6-3.2-2-4.7-.6-1.3 1.2-1.4 3.2-.5 4.6L7 13.5zM14.6 7.6h.01M9.5 17.6 8.8 20.5M12.2 17.4l.4 3.1',
  amazon: 'M12.5 21c0-4.5.4-7.6 1.6-10.6M14 10.4c-1.8-2.7-5.6-3-7.8-1M14 10.4c.9-2.9 4.6-4 7-2.1M14 10.4c-3 .2-5.8 2.2-6.8 5M14 10.4c3 .1 5.6 2 6.3 4.8',
  atlantic: 'M5 19C5 11 10 5 19 5c0 9-6 14-14 14zM5 19l9.5-9.5M9.5 14.5l-.3-3.4M12 12l3.2.2',
  borneo: 'M12 21v-7M7.4 14a3.8 3.8 0 0 1 .2-7.6 4.6 4.6 0 0 1 8.8 0 3.8 3.8 0 0 1 .2 7.6z',
  daintree: 'M6 20.5c3.2-2.2 6.3-6.4 8.2-14.5M8.4 16.8 5.4 15.6M10.4 13.8 7.6 11.8M12 10.8 10.2 8M10.2 16l3.2-.2M12.1 12.8l3.1-.7M13.3 9.5l2.7-1.2',
  olympic: 'M12 2.8l4.8 6.6h-2.9l3.9 5.6h-3.6l3.1 4.3H6.7l3.1-4.3H6.2l3.9-5.6H7.2zM12 19.3V22',
  yosemite: 'M2.5 19.5 8.6 9l3.9 6.2 2.4-3.6 6.6 7.9zM8.6 9c.6-2.6 2.6-4.4 5.4-4.4',
};
const rfSvg = (k, px = 24) => `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${RF_ICON[k] || RF_ICON.default}"/></svg>`;
// top-right button: shows the playing forest's icon (mint) or the last one (dimmed)
function updateRfButton() {
  const b = document.getElementById('rfBtn'); if (!b) return;
  let last = 'default'; try { last = localStorage.getItem('garden.rainforest.place') || 'default'; } catch { /* ignore */ }
  const playing = RF && RF.isOn() ? RF.current() : null;
  b.innerHTML = rfSvg(playing || last, 28);
  b.classList.toggle('on', !!playing);
}
function rainforestMenu() {
  const b = document.getElementById('rfBtn'); if (!b) return;
  document.getElementById('rfMenu')?.remove();
  const playing = RF && RF.isOn() ? RF.current() : null;
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== b && !b.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const row = (key, label, desc, run, on) => h('button', { class: 'rfm-row' + (on ? ' on' : ''), type: 'button', onclick: () => { close(); run(); } },
    h('span', { class: 'ic', html: key === 'off' ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>' : rfSvg(key) }),
    h('span', { class: 'tx' }, h('b', {}, label), h('small', {}, desc)));
  const menu = h('div', { id: 'rfMenu' },
    ...(playing ? [row('off', 'Off', 'stop the rainforest', () => toggleRainforest('off'), false)] : []),
    ...RAINFOREST_PLACES.map(([k, , label, desc]) => row(k, label, desc, () => toggleRainforest(k), playing === k)));
  (document.getElementById('zoomroot') || document.body).appendChild(menu);
  const r = b.getBoundingClientRect(), root = (document.getElementById('zoomroot') || document.body).getBoundingClientRect();
  const z = root.width / ((document.getElementById('zoomroot') || document.body).offsetWidth || root.width) || 1;
  menu.style.top = `${Math.round((r.bottom - root.top) / z + 8)}px`;
  menu.style.right = `${Math.round((root.right - r.right) / z)}px`;
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
}
// The forest menu from the controller: A on the focused sound button opens it with a row
// selected; up/down move, A picks (Off / a forest), B or L2 closes.
let rfSel = -1;
const rfRows = () => [...document.querySelectorAll('#rfMenu .rfm-row')];
function closeRfMenu() { document.getElementById('rfMenu')?.remove(); rfSel = -1; }
function setRfSel(i) {
  const rows = rfRows(); if (!rows.length) return;
  rfSel = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle('sel', k === rfSel));
}
async function openRfMenuPad() {
  RF ||= await import(`/lib/rainforest.js?v=${window.__GARDEN_VERSION || ''}`);
  rainforestMenu();
  const rows = rfRows(), on = rows.findIndex((r) => r.classList.contains('on'));
  setRfSel(on >= 0 ? on : 0);
}
function rfMenuNav(action) {
  if (!document.getElementById('rfMenu')) { rfSel = -1; return false; }
  if (rfSel < 0) setRfSel(0);
  if (/^f?(up|left)$/.test(action)) setRfSel(rfSel - 1);
  else if (/^f?(down|right)$/.test(action)) setRfSel(rfSel + 1);
  else if (action === 'ok' || action === 'fopen') { const r = rfRows()[rfSel]; if (r) r.click(); rfSel = -1; }
  else if (action === 'back' || action === 'events' || action === 'hn') closeRfMenu();
  else return false;
  return true;
}
function wireRainforestButton() {
  const b = document.getElementById('rfBtn'); if (!b) return;
  b.addEventListener('click', () => toggleRainforest());
  b.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    RF ||= await import(`/lib/rainforest.js?v=${window.__GARDEN_VERSION || ''}`);
    rainforestMenu();
  });
  updateRfButton();
}
const RAINFOREST_PLACES = [ // [arg, icon, label, description] — the presets in lib/rainforest.js
  ['default', '🐦', 'Forest morning', 'dawn chorus in European woods: thrushes, robins, blackbirds, wrens, a nightingale'],
  ['amazon', '🦜', 'Amazon', 'Peru & Brazil rainforest: caciques, oropendolas, toucans, titi monkeys, soft insects'],
  ['atlantic', '🌿', 'Mata Atlântica', 'Brazil: sabiá-laranjeira, distant bugio howlers, wind in the trees, a dawn river'],
  ['borneo', '🐒', 'Borneo', 'Sarawak: Kubah frog pool at dusk, magpie-robins, trogons, gibbon song'],
  ['daintree', '🐦', 'Daintree', 'Cape Tribulation morning + Blue Mountains forest: whipbirds, kookaburras, king parrots'],
  ['olympic', '🌲', 'Olympic', 'Pacific Northwest spring: Pacific wren, varied & hermit thrushes, Steller\'s jay, a creek'],
  ['yosemite', '🏔', 'Yosemite', 'mountain conifer dawns: Clark\'s nutcracker, hermit thrush, jays, wind in pines, a creek'],
];
// /rainforest → toggle (last place, default first); /rainforest amazon → that place
// (switches with a crossfade if another is playing; the same one again turns it off).
async function toggleRainforest(arg = '', force) {
  RF ||= await import(`/lib/rainforest.js?v=${window.__GARDEN_VERSION || ''}`);
  let last = 'default'; try { last = localStorage.getItem('garden.rainforest.place') || 'default'; } catch { /* ignore */ }
  if (arg === 'off') { RF.stop(); try { localStorage.setItem('garden.rainforest', '0'); } catch { /* ignore */ } toast('Rainforest off'); updateRfButton(); return; }
  const key = arg ? RF.resolve(arg) : null;
  if (arg && !key) { toast(`No forest "${arg}" — try ${Object.keys(RF.PRESETS).join(', ')}`); return; }
  const want = force ?? (key ? RF.current() !== key : !RF.isOn());
  const place = key || last;
  if (want) { RF.start(place); setTimeout(() => { const s = RF.status?.(); if (s && s.on && s.error) toast(`Rainforest: ${s.error}`); }, 9000); } else RF.stop();
  try { localStorage.setItem('garden.rainforest', want ? '1' : '0'); localStorage.setItem('garden.rainforest.place', place); } catch { /* ignore */ }
  if (force === undefined) toast(want ? `🌿 ${RF.PRESETS[place].label}` : 'Rainforest off');
  updateRfButton();
}
if (!SCREENSHOT) {
  setTimeout(wireRainforestButton, 0);
  setTimeout(wireVolumeButton, 0);
  try { if (localStorage.getItem('garden.rainforest') === '1') setTimeout(() => toggleRainforest('', true), 1500); } catch { /* ignore */ }
  let ducked = false; // only act when a game starts or ends, not on every class change (idle, night…)
  new MutationObserver(() => { const g = document.body.classList.contains('arcade-full'); if (g !== ducked) { ducked = g; if (RF && RF.isOn()) RF.duck(g); arcadeVolume(g); } })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
// Interface sounds (lib/uisound.js): loaded once, then fire-and-forget.
if (!SCREENSHOT) import(`/lib/uisound.js?v=${window.__GARDEN_VERSION || ''}`).then((m) => { UI_SOUND = m.uiSound; m.wireClickSounds(); }).catch(() => {});
const GB_READY = import(`/lib/glassbake.js?v=${window.__GARDEN_VERSION || ''}`).then((m) => (GB = m)).catch(() => null);
function openPanel(title, bodyEl, { keepStack = false } = {}) {
  const p = document.getElementById('panel'); if (!p) return;
  UI_SOUND(keepStack || panelOpen() ? 'tick' : 'open');
  if (!keepStack) reservePanelSize(title);
  if (!keepStack) { panelStack.length = 0; stopPanelWidget(); } // fresh top-level view resets any stacked detail
  updateCloseHint();
  setTimeout(updateCloseHint, 60); // re-check after a game widget may set __GARDEN_GAME
  document.getElementById('panelTitle').textContent = title;
  // Content goes inside a transform-scrolled wrapper: native scrollTop scrolling
  // CPU-rasterizes the whole panel every frame in WebKitGTK (measured 3.7fps on
  // the Jetson), while translateY runs on the compositor (~57fps). All panel
  // scrolling goes through panelScrollBy() below.
  document.getElementById('panelBody').replaceChildren(h('div', { class: 'panel-inner' }, bodyEl));
  panelScroll.cur = 0; panelScroll.target = 0;
  panelRowIdx = -1; // fresh row selection per panel view
  readerFrame = null;
  document.getElementById('panelBody')?.classList.remove('reading'); // cleared unless openReader re-adds it
  p.classList.add('open'); p.setAttribute('aria-hidden', 'false');
  // Baked liquid glass on the panel: tint + rims now, the baked image a frame later.
  const pc = p.querySelector('.panel-card');
  if (GB) {
    GB.glassLayers(pc);
    clearTimeout(openPanel.gbT); clearTimeout(openPanel.gbMax);
    // Glass + content appear TOGETHER: a fresh panel stays hidden until its baked glass
    // is decoded, then both fade in over the same .15 s (capped — never held > 500 ms).
    // Stacked views (keepStack) keep the visible glass until the new bake swaps in.
    const reveal = () => { clearTimeout(openPanel.gbMax); p.classList.remove('gb-wait'); };
    if (!keepStack) { p.classList.add('gb-wait'); openPanel.gbMax = setTimeout(reveal, 500); }
    openPanel.gbT = setTimeout(() => GB.bakePanel(pc).then((ok) => { pc.classList.toggle('nosnap', !ok); requestAnimationFrame(reveal); }, reveal), 30);
  }
  // Move keyboard focus onto a REAL focusable control (the close button) so Esc
  // works without clicking first. surf/WebKitGTK doesn't route key events to the
  // page until something focusable holds focus; a <button> reliably does, where a
  // tabindex=-1 div sometimes didn't. Focus on the next frame so display:flex has
  // taken effect (you can't focus a display:none element).
  requestAnimationFrame(() => {
    (document.getElementById('panelClose') || p.querySelector('.panel-card'))?.focus();
  });
}
// Panel stack: a detail view opened FROM a list (event detail, article reader)
// pushes the list; closing (Esc/L2/B) restores it instead of dismissing.
const panelStack = [];
// ---- live camera (USB webcam on the Jetson) ------------------------------------
// The kiosk browser reads the camera directly (getUserMedia; the kiosk launches with
// --use-fake-ui-for-media-stream so no permission prompt). Full frame rate, nothing
// recorded or sent anywhere; the stream is stopped the moment the panel closes.
async function showCamera() {
  const video = h('video', { class: 'cam-video', autoplay: true, muted: true, playsinline: true });
  const status = h('div', { class: 'cam-status' }, '');
  openPanel('Camera', h('div', { class: 'cam' }, video, status));
  let stream = null;
  panelWidgetStop = () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } stream = null; };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
    if (!panelOpen()) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    const s = stream.getVideoTracks()[0]?.getSettings?.() || {};
    status.textContent = s.width ? `${s.width}×${s.height} · ${Math.round(s.frameRate || 0)} fps · live` : 'live';
  } catch (e) {
    status.textContent = `Camera unavailable — ${e.name || e.message}`;
  }
}

let panelWidgetStop = null; // stops a fullscreen-mounted widget's timers
function stopPanelWidget() { try { panelWidgetStop?.(); } catch { /* ignore */ } panelWidgetStop = null; }
function openSubPanel(title, bodyEl) {
  const pb = document.getElementById('panelBody');
  const pt = document.getElementById('panelTitle');
  if (pb && pt && panelOpen()) panelStack.push({ title: pt.textContent, nodes: [...pb.childNodes], scroll: pb.scrollTop });
  openPanel(title, bodyEl, { keepStack: true });
}
function closePanel() {
  const p = document.getElementById('panel'); if (!p) return;
  if (panelOpen()) UI_SOUND(panelStack.length ? 'tick' : 'close');
  stopPanelWidget();
  const prev = panelStack.pop();
  if (prev) { // restore the underlying list view
    document.getElementById('panelTitle').textContent = prev.title;
    const pb = document.getElementById('panelBody');
    pb.classList.remove('reading'); // reader set this; the restored list must scroll again
    readerFrame = null;
    pb.replaceChildren(...prev.nodes);
    pb.scrollTop = prev.scroll || 0;
    // The reader iframe had grabbed keyboard focus; pull it back to the panel so
    // arrows/Esc work IMMEDIATELY (no phantom second press) and re-assert the row
    // highlight that the restored DOM nodes still carry.
    document.getElementById('panelClose')?.focus();
    setPanelRow(panelRowIdx >= 0 ? panelRowIdx : 0, false);
    return;
  }
  p.classList.remove('open'); p.setAttribute('aria-hidden', 'true');
  // In keyboard selection mode, closing a panel returns to the widget highlight
  // (staying in selection mode) rather than jumping back to the writing console.
  if (selectMode) setFocus(focusIdx < 0 ? 0 : focusIdx); else focusInput();
}
function fmtWhen(ms) { try { return ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; } catch { return ''; } }

async function showIterations() {
  let data = { iterations: [] };
  try { data = await (await fetch('/api/iterations', { cache: 'no-store' })).json(); } catch { /* offline */ }
  const list = (data.iterations || []).slice(); // API is already newest-first (ORDER BY id DESC)
  const rows = list.length
    ? list.map((it) => h('div', { class: 'cl-row' },
        h('div', { class: 'cl-id' }, `#${it.id}`),
        h('div', { class: 'cl-main' },
          h('div', { class: 'cl-phrase' }, it.phrase || 'self-directed improvement'),
          h('div', { class: 'cl-meta' }, `${fmtWhen(it.at)}${it.feedback ? ` · ${it.feedback} feedback` : ' · self-directed'}`))))
    : [h('div', { class: 'cl-empty' }, 'No tendings yet — the garden grows each morning.')];
  openPanel('Changelog — how the garden has grown', h('div', { class: 'cl' }, ...rows));
}

function showHelp() {
  const cmd = (c, d) => h('div', { class: 'help-cmd' }, h('code', {}, c), h('span', {}, d));
  openPanel('The Gardener — help', h('div', { class: 'help' },
    h('p', { class: 'help-lead' }, 'This display tends itself. Every morning the gardener reads your notes and grows the garden — adding, refining, and fixing its widgets.'),
    h('p', { class: 'help-lead' }, 'Just start typing to leave a note; it gets grown into the garden at the next tending (tomorrow morning).'),
    h('div', { class: 'help-cmds' },
      cmd('/help', 'show this panel'),
      cmd('/events  ·  /e', 'full-screen list of upcoming SF events (↑ ↓ to scroll)'),
      cmd('/architecture', 'how the gardener works & iterates'),
      cmd('/tendings', 'changelog of every tending so far'),
      cmd('/notes', 'notes you’ve planted — and delete any before tending'),
      cmd('/grow', 'tend the garden now on the notes you’ve planted'),
      cmd('shift + T', 'mark “take trash out” done (on trash day)'),
      cmd('/botanist  ·  /desk', 'the Botanist: what to say, how it uses the screen'),
      cmd('/timer', 'two-minute countdown card in the top-left (/timer 5, /timer off)'),
      cmd('/night', 'toggle the dark screen-saver veil'),
      cmd('/refresh', 'reload the garden now'),
      cmd('esc', 'close this panel'))));
}

// /botanist (/desk) — the Botanist: the coding agent in Paseo ("Commands from the OS")
// that "Hey Garden, botanist, ..." talks to (src/botanist.mjs), and desk, the command it
// sees and drives this screen with (tools/desk/desk). Keep in step with desk --help.
function showBotanist() {
  const cmd = (c, d) => h('div', { class: 'help-cmd' }, h('code', {}, c), h('span', {}, d));
  const head = (t) => h('div', { class: 'help-h' }, t);
  openPanel('The Botanist — voice & the screen', h('div', { class: 'help' },
    h('p', { class: 'help-lead' }, 'The Botanist is a coding agent running on this computer. Hey Garden passes it anything the wall can’t do itself: change code, run things, fix and build, and use the screen like a person — look, click, type.'),
    head('Say'),
    h('div', { class: 'help-cmds' },
      cmd('“Hey Garden, botanist, …”', 'hand it a task in your own words — also “tell / ask the botanist …”'),
      cmd('“What is the botanist doing?”', 'busy, idle, or waiting for your OK'),
      cmd('“Allow it”  ·  “deny it”', 'answer when it asks permission'),
      cmd('“Stop the botanist”', 'cancel what it’s doing')),
    head('Try'),
    h('div', { class: 'help-cmds' },
      cmd('“…open the calculator and work out 12 times 7”', 'it opens the app, clicks the buttons, reads the answer, closes it'),
      cmd('“…how much disk space is free?”', 'runs a command and tells you'),
      cmd('“…add a 7-day forecast to the weather card”', 'changes GardenOS itself')),
    head('On the wall'),
    h('div', { class: 'help-cmds' },
      cmd('a quiet edge glow', 'it’s working on your request — stays until it’s done'),
      cmd('mint card', 'done — its answer, top of the wall'),
      cmd('gold card', 'it needs your OK (“allow it” / “deny it”)'),
      cmd('rose card', 'it stopped or something failed')),
    head('desk — how it sees and uses the screen'),
    h('p', { class: 'help-lead' }, 'One screen: this wall (900 × 1600). Apps it opens appear over the garden; it closes them when done. Coordinates are screen pixels from the top-left.'),
    h('div', { class: 'help-cmds' },
      cmd('desk shot', 'screenshot to /tmp/desk.png — it looks before it clicks'),
      cmd('desk click X Y', 'click (--right, --double)'),
      cmd('desk move X Y  ·  desk scroll up / down', 'move the pointer · scroll'),
      cmd('desk type "text"', 'type into the focused window (plain characters)'),
      cmd('desk key ctrl+s', 'keys and combos — Return, Escape, alt+F4 …'),
      cmd('desk windows', 'list open windows'),
      cmd('desk focus · desk close <title>', 'bring a window forward · close it'),
      cmd('desk --help', 'the full reference')),
    h('p', { class: 'help-note' }, 'It runs with full access: anyone who says “Hey Garden, botanist” can have it act on this computer. To approve each step, set its Paseo workspace (Commands from the OS) to Auto — then answer with “allow it” / “deny it”.')));
}

// Show the feedback the humans have planted (pending vs already grown in).
// Pending notes can be DELETED here (pruned before the next tending); notes already
// grown into the garden are history and have no delete control.
async function showNotes() {
  let data = { feedback: [] };
  try { data = await (await fetch('/api/feedback?limit=14', { cache: 'no-store' })).json(); } catch { /* offline */ }
  const list = data.feedback || [];
  const rows = list.length
    ? list.map((f) => {
        const pending = f.consumed_by == null;
        const del = pending
          ? h('button', { class: 'note-del', type: 'button', title: 'delete this note',
              onClick: async (e) => {
                e.stopPropagation();
                const btn = e.currentTarget; btn.disabled = true;
                try {
                  const r = await fetch(`/api/feedback?id=${f.id}`, { method: 'DELETE' });
                  if (!r.ok) throw new Error('HTTP ' + r.status);
                  toast('Note deleted 🥀'); showNotes();
                } catch { btn.disabled = false; toast('Could not delete — try again'); }
              } }, '🗑')
          : null;
        return h('div', { class: 'cl-row' },
          h('div', { class: 'cl-id' }, pending ? '🌱' : '🌿'),
          h('div', { class: 'cl-main' },
            h('div', { class: 'cl-phrase' }, f.text),
            h('div', { class: 'cl-meta' }, `${fmtWhen(f.ts)} · ${pending ? 'awaiting next tending' : 'grown in'}`)),
          del);
      })
    : [h('div', { class: 'cl-empty' }, 'No notes yet — just start typing to plant one.')];
  openPanel('Planted notes — delete any you’ve changed your mind about', h('div', { class: 'cl' }, ...rows));
}

// /credits — the field recordists behind /rainforest (data/ambience/credits.json). CC BY and
// CC BY-SA ask for attribution; this is where it lives on the wall.
async function showCredits() {
  let data = { sources: [] };
  try { data = await (await fetch('/api/ambience/credits.json', { cache: 'no-store' })).json(); } catch { /* not built */ }
  const PLACE = Object.fromEntries(RAINFOREST_PLACES.map(([k, , label]) => [k, label]));
  const list = (data.sources || []).slice().sort((x, y) => String(x.author || '').localeCompare(String(y.author || '')));
  const rows = list.length
    ? list.map((c) => h('div', { class: 'cl-row' },
        h('div', { class: 'cl-id' }, '🎙'),
        h('div', { class: 'cl-main' },
          h('div', { class: 'cl-phrase' }, `${c.title}`),
          h('div', { class: 'cl-meta' }, `${c.author || 'unknown'} · ${c.license}${c.note ? ' · ' + c.note : ''} · ${c.source} · ${[...new Set((c.used_in || []).map((u) => PLACE[u.place] || u.place))].join(', ')}`),
          h('div', { class: 'cl-meta' }, c.url || ''))))
    : [h('div', { class: 'cl-empty' }, 'No recordings installed yet.')];
  openPanel('Sound credits — field recordings used by /rainforest (processed: trimmed, filtered, level-matched)', h('div', { class: 'cl' }, ...rows));
}

// /grow — run a tending cycle right now on the currently-planted notes. Shows the
// SELECTION (the pending notes this tending will act on) and lets you prune it
// before growing, so you control exactly what gets grown in.
async function showGrow() {
  const box = h('div', { class: 'grow' });
  openPanel('Grow the garden now', box);
  const render = async () => {
    let status = { running: false, pending: 0 };
    try { status = await (await fetch('/api/grow', { cache: 'no-store' })).json(); } catch { /* offline */ }
    let fb = { feedback: [] };
    try { fb = await (await fetch('/api/feedback?limit=40', { cache: 'no-store' })).json(); } catch { /* offline */ }
    const pending = (fb.feedback || []).filter((f) => f.consumed_by == null);

    const intro = h('p', { class: 'grow-lead' },
      'Tending normally runs every morning. ', h('b', {}, '/grow'),
      ' starts one right now on the notes below — it takes a few minutes, then the garden reloads itself with whatever changed.');

    const selHdr = h('div', { class: 'grow-sec' },
      pending.length ? `${pending.length} note${pending.length === 1 ? '' : 's'} selected to grow` : 'No notes planted');

    const noteRows = pending.length
      ? pending.map((f) => h('div', { class: 'cl-row' },
          h('div', { class: 'cl-id' }, '🌱'),
          h('div', { class: 'cl-main' },
            h('div', { class: 'cl-phrase' }, f.text),
            h('div', { class: 'cl-meta' }, fmtWhen(f.ts))),
          status.running ? null : h('button', {
            class: 'note-del', type: 'button', title: 'remove this note from the selection',
            onClick: async (e) => {
              e.stopPropagation();
              const btn = e.currentTarget; btn.disabled = true;
              try {
                const r = await fetch(`/api/feedback?id=${f.id}`, { method: 'DELETE' });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                toast('Note removed 🥀'); render();
              } catch { btn.disabled = false; toast('Could not remove — try again'); }
            },
          }, '🗑')))
      : [h('div', { class: 'cl-empty' }, 'A /grow with no notes runs a self-directed tending — the gardener improves something of its own choosing.')];

    let action;
    if (status.running) {
      action = h('div', { class: 'grow-running' },
        '🌿 A tending is already growing — the garden will reload itself when it finishes (usually a few minutes).');
    } else {
      const btn = h('button', { class: 'grow-go', type: 'button' }, '🌱 Grow now');
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Starting…';
        try {
          const r = await fetch('/api/grow', { method: 'POST' });
          const d = await r.json().catch(() => ({}));
          if ((r.ok && d.ok) || r.status === 409) { toast(r.status === 409 ? 'Already growing 🌿' : 'Tending started 🌱'); render(); }
          else throw new Error('start failed');
        } catch { btn.disabled = false; btn.textContent = '🌱 Grow now'; toast('Could not start — try again'); }
      });
      action = btn;
    }

    box.replaceChildren(intro, selHdr, h('div', { class: 'cl' }, ...noteRows), h('div', { class: 'grow-foot' }, action));
  };
  render();
}

// Full-screen, scrollable list of ALL upcoming SF events (the /events · /e command).
// Arrow keys / PageUp-Down / Home-End scroll the list; Esc returns to the dashboard.
// Stale-while-revalidate like Hacker News: the last event list renders instantly
// (prefetched on boot + every 15 min); the fresh one swaps in place.
let EVENTS_CACHE = null;
let EVENT_SHORT = {}; // title → plain short name (lib/events.js shortNames → server eventnames.mjs)
const shortFor = (e) => EVENT_SHORT[e.name] || e.name;
// a tap on an event row in the Out in SF card → that event's full details
window.addEventListener('garden:event', (ev) => { if (ev.detail) showEventDetail(ev.detail); });
if (!SCREENSHOT) {
  const pre = async () => { try { const lib = await import(`/lib/events.js?v=${window.__GARDEN_VERSION}`);
    const evs = await lib.fetchEvents((url) => fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }));
    if (evs.length) { EVENTS_CACHE = evs; ensureTravel(evs); EVENT_SHORT = await lib.shortNames(evs).catch(() => EVENT_SHORT); } } catch { /* keep last */ } };
  setTimeout(pre, 10000); setInterval(pre, 15 * 60 * 1000);
}
async function showEvents() {
  const tok = (showEvents.tok = {}); // a newer open / a close invalidates this fetch
  if (EVENTS_CACHE) renderEvents(EVENTS_CACHE);
  else openPanel('Out in SF', h('div', { class: 'cl' })); // no loading text (layout rule)
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const TZ = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
  const fetchJSON = (url) => fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  let evs = [];
  try {
    const lib = await import(`/lib/events.js?v=${window.__GARDEN_VERSION}`);
    evs = await lib.fetchEvents(fetchJSON); // shared default window — see lib/events.js
  } catch {
    if (EVENTS_CACHE || showEvents.tok !== tok || !panelOpen()) return; // keep the cached list / closed
    return openPanel('Out in SF — upcoming events', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'Events are unavailable right now — try again shortly.')));
  }
  if (!evs.length) {
    if (EVENTS_CACHE) return;
    return openPanel('Out in SF — upcoming events', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'No upcoming events listed right now.')));
  }
  EVENTS_CACHE = evs;
  try { EVENT_SHORT = await (await import(`/lib/events.js?v=${window.__GARDEN_VERSION}`)).shortNames(evs); } catch { /* original titles */ }
  if (showEvents.tok !== tok || !panelOpen()) return; // closed meanwhile — don't reopen
  renderEvents(evs);
}
// Today's events get a map (numbered pins + home at 408 Quintara) and a drive
// column: free-flow drive minutes and the latest time to leave to arrive by the
// start (server: /api/sf-travel → src/travel.mjs, geocodes + routes cached on disk).
// The map box and the drive column are reserved up front and filled in place —
// the panel never grows or reflows when the travel data lands.
const TRAVEL = new Map(); // event name → { lat, lon, mins, km } | null
const isTodayEv = (e) => { const f = new Intl.DateTimeFormat('en-CA', { timeZone: (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles' }); return !!e.when && f.format(e.when) <= f.format(new Date()); };
// Venue lookups are 1 req/s on the server (Nominatim), so they're fetched in the
// background whenever the event list refreshes — opening the panel is then instant.
let travelInFlight = null;
function ensureTravel(evs) {
  const missing = evs.filter((e) => isTodayEv(e) && !TRAVEL.has(e.name));
  if (!missing.length) return Promise.resolve();
  if (travelInFlight) return travelInFlight.then(() => ensureTravel(evs));
  travelInFlight = fetch('/api/sf-travel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: missing.map((e) => ({ key: e.name, name: e.name, placeFull: e.placeFull, description: e.description })) }) })
    .then((r) => r.json()).then((j) => { for (const e of missing) TRAVEL.set(e.name, j.results ? j.results[e.name] ?? null : null); })
    .catch(() => {}).finally(() => { travelInFlight = null; });
  return travelInFlight;
}
const EV_MAP_BOX = [37.695, -122.525, 37.845, -122.245]; // SF + Oakland's edge
function renderEvents(evs) {
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const TZ = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const todayKey = keyFmt.format(new Date());
  const isToday = (e) => !!e.when && keyFmt.format(e.when) <= todayKey;
  const today = evs.filter(isToday);
  const drives = new Map(); // event → its drive cell
  let n = 0;
  const pinNo = new Map();
  const rows = evs.map((e) => {
    let when = 'Soon';
    if (e.when) {
      when = `${dayFmt.format(e.when)} ${MON[e.when.getMonth()]} ${e.when.getDate()}`;
      if (!e.allDay) when += ` · ${timeFmt.format(e.when).replace(' ', '')}`; // all-day rows have no real clock time
    }
    const t = isToday(e);
    if (t) pinNo.set(e, ++n);
    const drive = t ? h('div', { class: 'ev-drive' }) : null;
    if (drive) drives.set(e, drive);
    return h('div', { class: `cl-row ev-row clickable${t ? ' today' : ''}`, onclick: () => showEventDetail(e) },
      h('div', { class: 'ev-when' }, when),
      h('div', { class: 'cl-main' },
        h('div', { class: 'cl-phrase' }, t ? h('span', { class: 'ev-no' }, String(pinNo.get(e))) : null, `${e.emoji ? e.emoji + ' ' : ''}${shortFor(e)}`),
        // recurring listings (lib/events.js recurrence) wear a small quiet tag
        e.place || e.recur ? h('div', { class: 'cl-meta' }, e.place ? h('span', {}, `📍 ${e.place}`) : null,
          e.recur ? h('span', { class: 'ev-rec' }, e.recur.label) : null) : null),
      drive);
  });
  const list = h('div', { class: 'cl ev-list' }, ...rows);
  const mapBox = h('div', { class: 'ev-map' });
  const wrap = h('div', { class: 'ev-wrap' }, today.length ? mapBox : null, list);
  // Re-render in place if the events panel is already showing (keeps scroll position).
  const cur = document.querySelector('#panel.open .ev-wrap');
  if (cur) cur.replaceWith(wrap);
  else openPanel(`Out in SF — ${evs.length} upcoming events`, wrap);
  if (!today.length) return;

  const fill = () => {
    for (const [e, cell] of drives) {
      const r = TRAVEL.get(e.name);
      if (!r || r.mins == null) { cell.replaceChildren(); continue; }
      const kids = [h('div', { class: 'ev-mins' }, CAR_SVG(), `${r.mins} min`)];
      if (e.when && !e.allDay) {
        const leave = new Date(e.when.getTime() - r.mins * 60000);
        leave.setMinutes(Math.floor(leave.getMinutes() / 5) * 5, 0, 0); // round down to 5 min
        const past = leave < new Date() && e.when > new Date();
        kids.push(h('div', { class: `ev-leave${past ? ' late' : ''}` }, past ? 'leave now' : `leave ${timeFmt.format(leave).replace(' ', '').toLowerCase()}`));
      }
      cell.replaceChildren(...kids);
      cell.classList.add('on');
    }
  };
  const drawMap = async () => {
    const W = Math.round(mapBox.clientWidth) || 780, H = Math.round(mapBox.clientHeight) || 520;
    const { staticMap, svgEl } = await import('/lib/staticmap.js');
    // Fit home + today's in-city venues (padded), so the pins spread over the frame;
    // venues outside SF/Oakland (Mountain View…) keep their drive time but no pin.
    const HOME = [37.74838, -122.47659];
    const pts = [HOME];
    for (const e of today) { const r = TRAVEL.get(e.name); if (r && r.lat >= EV_MAP_BOX[0] && r.lat <= EV_MAP_BOX[2] && r.lon >= EV_MAP_BOX[1] && r.lon <= EV_MAP_BOX[3]) pts.push([r.lat, r.lon]); }
    let [s0, w0, n0, e0] = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const padLat = Math.max(0.012, (n0 - s0) * 0.14), padLon = Math.max(0.015, (e0 - w0) * 0.1);
    const m = staticMap({ bbox: [s0 - padLat, w0 - padLon, n0 + padLat, e0 + padLon], width: W, height: H });
    const home = m.project(...HOME);
    const g = svgEl('g', { transform: `translate(${home[0].toFixed(1)},${home[1].toFixed(1)})` });
    g.append(svgEl('circle', { r: 17, fill: 'rgba(116,247,176,.18)' }),
      svgEl('path', { d: 'M-8 1 L0 -7 L8 1 M-6 -1 V8 H6 V-1', fill: 'none', stroke: '#74f7b0', 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const pins = [];
    for (const e of today) {
      const r = TRAVEL.get(e.name);
      if (!r) continue;
      const [x, y] = m.project(r.lat, r.lon);
      if (x < 12 || y < 12 || x > W - 12 || y > H - 12) continue; // off the city map (Mountain View etc.)
      pins.push({ x, y, no: pinNo.get(e) });
    }
    // co-located venues (same block) fan out so every number stays readable
    // (a few relaxation passes push overlapping pins apart; a hairline ties each moved
    // pin back to its true spot)
    pins.forEach((p, i) => { p.ox = p.x; p.oy = p.y; p.x += Math.cos(i * 2.4) * 0.5; p.y += Math.sin(i * 2.4) * 0.5; });
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i], b = pins[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        if (d < 27) { const f = (27 - d) / 2 / d; a.x -= dx * f; a.y -= dy * f; b.x += dx * f; b.y += dy * f; }
      }
    }
    for (const p of pins) if (Math.hypot(p.x - p.ox, p.y - p.oy) > 6) {
      m.svg.append(svgEl('line', { x1: p.ox.toFixed(1), y1: p.oy.toFixed(1), x2: p.x.toFixed(1), y2: p.y.toFixed(1), stroke: 'rgba(116,247,176,.55)', 'stroke-width': 1.2 }),
        svgEl('circle', { cx: p.ox.toFixed(1), cy: p.oy.toFixed(1), r: 2.2, fill: '#74f7b0' }));
    }
    for (const p of pins) {
      const pg = svgEl('g', { transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})` });
      const label = svgEl('text', { y: 4.5, 'text-anchor': 'middle', class: 'ev-pin-t' }); label.textContent = String(p.no);
      pg.append(svgEl('circle', { r: 12, class: 'ev-pin' }), label);
      m.svg.append(pg);
    }
    m.svg.append(g);
    await m.ready;
    m.el.classList.add('ev-mapimg');
    mapBox.append(m.el);
    requestAnimationFrame(() => { m.el.classList.add('on'); mapBox.classList.add('on'); });
    setTimeout(() => mapBox.querySelector('.ev-load')?.remove(), 700);
  };
  if (today.every((e) => TRAVEL.has(e.name))) { fill(); drawMap(); return; }
  mapBox.append(mapLoader()); // a soft ping from home while the venues are looked up
  ensureTravel(today).then(() => { if (wrap.isConnected) { fill(); drawMap(); } });
}
// Loading state for the reserved map box: the house, and slow rings radiating from it
// (no text, no sliding — just a calm pulse until the map fades in over it).
function mapLoader() {
  const el = h('div', { class: 'ev-load' });
  el.innerHTML = '<span class="ring"></span><span class="ring r2"></span><span class="ring r3"></span>'
    + '<svg viewBox="-12 -12 24 24"><path d="M-8 1 L0 -7 L8 1 M-6 -1 V8 H6 V-1" fill="none" stroke="#74f7b0" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  return el;
}
const CAR_SVG = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ev-car');
  s.innerHTML = '<path d="M3 15.5v-3l2.2-4.6A2 2 0 0 1 7 6.8h10a2 2 0 0 1 1.8 1.1L21 12.5v3a1 1 0 0 1-1 1h-1M3 15.5a1 1 0 0 0 1 1h1M9 16.5h6M3.5 12.5h17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="16.8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17" cy="16.8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.7"/>';
  return s;
};

// Full Hacker News front page in a panel (the /hn command; controller: Y).
// Stale-while-revalidate: the last front page is kept in memory (prefetched on
// boot and every 10 min), so the panel opens INSTANTLY with real stories — never a
// "loading…" message — and swaps in the fresh list in place when it arrives.
let HN_CACHE = null;
// The widget module owns the HN helpers (profanity guard, badges, momentum) so the
// fullscreen front page and the tile agree. Loaded lazily; null if it fails.
let HN_LIB = null;
const hnLib = () => (HN_LIB ||= import(`/widgets/hacker-news.js?v=${window.__GARDEN_VERSION}`).catch(() => null));
async function fetchHN() {
  const fetchJSON = (url) => fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  const lib = await hnLib();
  const ids = (await fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 18);
  const stories = (await Promise.all(ids.map((id) =>
    fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null))))
    // An unattended wall: drop crude titles here too, exactly as the tile does
    // (fail closed — if the guard didn't load, show nothing rather than unfiltered).
    .filter((x) => x && x.title && lib && lib.isClean(x.title))
    .slice(0, 15);
  if (stories.length) HN_CACHE = { stories, lib };
  return HN_CACHE ? HN_CACHE.stories : [];
}
// The fullscreen front page (2026-11-01): what the calm tile leaves out — comments,
// age, the ASK/SHOW/JOB kind, and plain-words cues for a fast climber or a lively
// thread — one story per row, tap to read.
function hnRows(stories, lib) {
  const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'news.ycombinator.com'; } };
  return stories.map((st, i) => {
    const badge = lib?.badgeOf?.(st);
    const age = lib?.ageOf?.(st.time);
    const rate = lib?.risingRate?.(st) || 0;
    const debate = lib?.debateRate?.(st) || 0;
    const bits = [`▲ ${st.score || 0} points`, `💬 ${st.descendants || 0}`];
    if (age) bits.push(`${age} ago`);
    bits.push(badge && !st.url ? badge.label.toLowerCase() : domainOf(st.url));
    const cues = [rate ? `🔥 climbing fast · ~${rate} points an hour` : '', debate ? '🗣 lively discussion' : ''].filter(Boolean);
    return h('div', {
      class: 'cl-row clickable',
      onclick: () => openReader(st.url || `https://news.ycombinator.com/item?id=${st.id}`, st.title),
    },
      h('div', { class: 'cl-id' }, String(i + 1)),
      h('div', { class: 'cl-main' },
        h('div', { class: 'cl-phrase' }, st.title),
        h('div', { class: 'cl-meta' }, bits.join(' · ')),
        cues.length ? h('div', { class: 'cl-meta hn-cue' }, cues.join('   ')) : null));
  });
}
async function showHackerNews() {
  const list = h('div', { class: 'cl' }, ...(HN_CACHE ? hnRows(HN_CACHE.stories, HN_CACHE.lib) : []));
  openPanel('Hacker News', list);
  try {
    const fresh = await fetchHN();
    if (list.isConnected && fresh.length) list.replaceChildren(...hnRows(fresh, HN_CACHE.lib));
  } catch {
    if (!HN_CACHE && list.isConnected) list.replaceChildren(h('div', { class: 'cl-empty' }, 'Hacker News is unavailable right now — try again shortly.'));
  }
}
if (!SCREENSHOT) { setTimeout(() => fetchHN().catch(() => {}), 8000); setInterval(() => fetchHN().catch(() => {}), 10 * 60 * 1000); }

// Controller button map (the /controls command; controller: HOLD R2).
// A static SN30-Pro-style diagram with label callouts — idle-friendly.
function showPadMap() {
  const W = 760, H = 440;
  const lab = (x, y, anchor, lines) => lines.map((t, i) =>
    `<text x="${x}" y="${y + i * 17}" text-anchor="${anchor}" font-size="13.5" font-family="Inter,sans-serif"
       fill="${i === 0 ? '#74f7b0' : '#a8c8bd'}" font-weight="${i === 0 ? '700' : '400'}">${t}</text>`).join('');
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(140,240,195,.35)" stroke-width="1.2"/>`;
  const dot = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#74f7b0" opacity=".9"/>`;
  // Official 8BitDo front render (public/assets/sn30pro.png, 430×175) placed at
  // (165,120); callout anchors below are measured button positions in the photo.
  const svg = `
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
    <image href="/assets/sn30pro.png?v=${window.__GARDEN_VERSION}" x="165" y="120" width="430" height="175"/>
    <!-- callouts: left column -->
    ${dot(225, 134)}${line(225, 134, 150, 52)}${lab(142, 56, 'end', ['L2 — back', 'close panel / palette (Esc)'])}
    ${dot(245, 150)}${line(245, 150, 150, 102)}${lab(142, 106, 'end', ['L1 − / R1 + — zoom', 'both together: 100%'])}
    ${dot(262, 190)}${line(262, 190, 150, 179)}${lab(142, 183, 'end', ['D-pad / stick', 'select &amp; scroll'])}
    ${dot(345, 194)}${line(345, 194, 150, 250)}${lab(142, 254, 'end', ['SELECT — changelog', 'START — help'])}
    <!-- callouts: right column -->
    ${dot(535, 134)}${line(535, 134, 612, 52)}${lab(620, 56, 'start', ['R2 — hold to peek', 'this map (release to close)'])}
    ${dot(495, 161)}${line(495, 161, 612, 124)}${lab(620, 128, 'start', ['X — palette'])}
    ${dot(533, 190)}${line(533, 190, 612, 176)}${lab(620, 180, 'start', ['A — run selected'])}
    ${dot(495, 221)}${line(495, 221, 612, 224)}${lab(620, 228, 'start', ['B — events panel'])}
    ${dot(457, 190)}${line(457, 190, 430, 296)}${lab(430, 314, 'middle', ['Y — Hacker News'])}
    ${dot(415, 248)}${line(415, 248, 560, 312)}${lab(560, 330, 'middle', ['right stick — highlight widgets', 'A opens the highlighted one'])}
    <text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-size="12" fill="#6f9388" font-family="Inter,sans-serif">controller off? hold START + B, then wait ~5 seconds — it re-pairs by itself</text>
    <text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-size="12" fill="#6f9388" font-family="Inter,sans-serif">8BitDo SN30 Pro · Bluetooth · also type /controls</text>
  </svg>`;
  openPanel('Controller — button map', h('div', { class: 'cl', html: svg }));
}

// A technical system + data-flow diagram of how the gardener works (the
// /architecture command). Static inline SVG — idle-friendly (no animation).
function showArchitecture() {
  const box = (x, y, w, hgt, o = {}) => {
    const cx = x + w / 2;
    const fill = o.accent ? 'rgba(120,247,176,.13)' : 'rgba(120,247,176,.05)';
    const stroke = o.accent ? '#78f7b0' : 'rgba(120,247,176,.30)';
    const ty = o.sub ? y + hgt / 2 - 3 : y + hgt / 2 + 6;
    return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`
      + `<text x="${cx}" y="${ty}" text-anchor="middle" class="an-t${o.accent ? ' an-acc' : ''}">${o.title}</text>`
      + (o.sub ? `<text x="${cx}" y="${y + hgt / 2 + 16}" text-anchor="middle" class="an-s">${o.sub}</text>` : '');
  };
  const arr = (x1, y1, x2, y2, label) => {
    let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="an-a" marker-end="url(#ah)"/>`;
    if (label) s += `<text x="${(x1 + x2) / 2 + 9}" y="${(y1 + y2) / 2 + 4}" class="an-l">${label}</text>`;
    return s;
  };
  const svg = `<svg class="arch-svg" viewBox="0 0 800 640" role="img" aria-label="System architecture diagram" preserveAspectRatio="xMidYMid meet">
    <defs><marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5f9e86"/></marker></defs>
    <text x="225" y="-2" text-anchor="middle" class="an-cap">inputs</text>
    ${box(70, 8, 300, 58, { title: '📱 Phone', sub: 'scans corner QR → plant.html' })}
    ${box(430, 8, 300, 58, { title: '⌨ Wall display', sub: 'type a note in the bar' })}
    ${arr(225, 66, 362, 102)}
    ${arr(575, 66, 438, 102)}
    ${box(120, 104, 560, 66, { title: 'Node http server · :8787', sub: 'SSRF-safe allowlisted proxy · serves static widgets' })}
    ${arr(400, 170, 400, 204)}
    ${box(260, 206, 280, 52, { title: '🗄 SQLite — notes + state' })}
    ${arr(400, 258, 400, 292, 'reads notes')}
    ${box(110, 294, 580, 70, { accent: true, title: '🤖 Gardener agent — Claude · full FS + shell', sub: '⏰ woken daily at 6 AM by a systemd timer' })}
    ${arr(400, 364, 400, 396, 'builds')}
    ${box(240, 398, 320, 52, { title: '🛠 edits widgets/*.js + manifest.json' })}
    ${arr(400, 450, 268, 484)}
    ${arr(400, 450, 532, 484)}
    ${box(150, 486, 230, 54, { title: '✅ npm run smoke' })}
    ${box(420, 486, 230, 54, { title: '👁 vision review', sub: '900×1600 screenshot' })}
    ${arr(265, 540, 362, 572, 'pass')}
    ${arr(535, 540, 438, 572)}
    <path d="M650,513 C778,498 778,360 694,332" class="an-a" fill="none" marker-end="url(#ah)"/>
    <text x="772" y="424" text-anchor="middle" class="an-l">✗ retry</text>
    ${box(230, 574, 340, 54, { title: '🌿 git commit · version++', sub: 'every kiosk live-reloads' })}
  </svg>`;
  openPanel('Architecture — how the gardener works', h('div', { class: 'arch' },
    h('p', { class: 'help-lead' }, 'A self-tending wall display. Notes flow in from phones and the on-screen bar into SQLite; once a day an autonomous Claude agent reads them, rebuilds the vanilla-JS widgets, and only ships a tree that passes smoke + a vision review.'),
    h('div', { class: 'arch-diagram', html: svg }),
    h('p', { class: 'arch-foot' }, 'No build step, no frameworks, no npm deps — static ES-module widgets served by Node + SQLite behind an allowlisted proxy, rendered by a surf / WebKitGTK kiosk on a Jetson.')));
}

// Toggle the night veil (dim the wall display) — acts immediately.
async function toggleNight() {
  try {
    const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
    const next = !s.night;
    await fetch('/api/night', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: next }) });
    setNight(next);
    toast(next ? 'Night mode on 🌙 — screen dimmed' : 'Night mode off ☀️ — good morning');
  } catch { toast('Could not reach the gardener — try again'); }
}

// ---- Tuesday curb-trash reminder -------------------------------------------
// Trash goes to the curb on Tuesday NIGHT (pickup Wednesday morning). Two pieces,
// one acknowledgement:
//   • a quiet dashboard PILL (header) that's available all day Tuesday so anyone
//     can put the bins out early and mark it done; and
//   • the full-screen flashing-red TAKEOVER that fires from 17:00 (5 PM) onwards,
//     the unmissable last call — runs until Wednesday 07:00 or until acknowledged.
// (The humans asked for the big, flashing, impossible-to-miss takeover from 5 PM on
// Tuesday, since pickup is very early Wednesday morning — mornings/afternoons before
// 5 PM just show the small button.) Acknowledgement is stamped with the trash cycle's
// Tuesday date in localStorage, so EITHER control dismisses BOTH for the week and
// it re-arms automatically next Tuesday. (?alarmtest=1 forces the takeover on for
// QA.) The takeover is hidden in screenshot mode so QA captures the dashboard.
const TRASH_ACK = 'garden.trashCurbAck';
const TRASH_NIGHT_HOUR = 17; // 5 PM — the takeover's "it's trash night" threshold (humans' request, 2026-07-29)
function tzNow(parts) {
  const tz = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...parts });
}
// Identity of the current trash cycle (the Tuesday date), valid for the whole
// window Tue 00:00 → Wed 07:00; null otherwise. Used as the ack key.
function trashWeekKey(now) {
  const wd = tzNow({ weekday: 'short' }).format(now);
  const hr = parseInt(tzNow({ hour: 'numeric', hour12: false }).format(now), 10);
  const dayOf = (d) => new Intl.DateTimeFormat('en-CA', {
    timeZone: (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  if (wd === 'Tue') return dayOf(now);                                       // all Tuesday
  if (wd === 'Wed' && hr < 7) return dayOf(new Date(now.getTime() - 864e5)); // before Wed 7AM → yesterday (Tue)
  return null;
}
// Is it the NIGHT takeover window? Tue from 17:00 (5 PM), through Wed 07:00.
function isTrashNight(now) {
  const wd = tzNow({ weekday: 'short' }).format(now);
  const hr = parseInt(tzNow({ hour: 'numeric', hour12: false }).format(now), 10);
  if (wd === 'Tue' && hr >= TRASH_NIGHT_HOUR) return true;
  if (wd === 'Wed' && hr < 7) return true;
  return false;
}
function refreshTrashAlarm() {
  const el = document.getElementById('trashalarm');
  const pill = document.getElementById('trashpill');
  const test = qs.has('alarmtest');
  const now = new Date();
  const key = test ? 'test' : trashWeekKey(now);
  const night = test ? true : isTrashNight(now);
  let acked = false;
  try { acked = !!key && localStorage.getItem(TRASH_ACK) === key; } catch { /* ignore */ }
  // Full-screen takeover: only at night, hidden in screenshot mode.
  if (el) {
    const show = !!key && !acked && night && !SCREENSHOT;
    el._key = key;
    el.classList.toggle('on', show);
    el.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  // Dashboard pill: the always-there daytime button on trash day (the takeover
  // covers it at night). Kept visible in screenshots — it's a real affordance.
  if (pill) {
    const showPill = !!key && !acked && !night;
    pill._key = key;
    pill.hidden = !showPill;
  }
}
// Mark this trash cycle done (from the pill, the takeover button, or shift+T).
function ackTrash() {
  const el = document.getElementById('trashalarm');
  const key = (el && el._key) || document.getElementById('trashpill')?._key;
  try { if (key) localStorage.setItem(TRASH_ACK, key); } catch { /* ignore */ }
  refreshTrashAlarm();
  toast('Thanks — bins are at the curb 🗑');
}
function wireTrashAlarm() {
  document.getElementById('trashAck')?.addEventListener('click', ackTrash);
  document.getElementById('trashpill')?.addEventListener('click', ackTrash);
  refreshTrashAlarm();
  setInterval(refreshTrashAlarm, 30000);
}

// ---- street-cleaning car alarm ---------------------------------------------
// Move-your-car reminder for street sweeping: the 1st & 3rd Monday AND Wednesday of
// every month, from 11:00 until 13:00 (PT). Full-screen persistent takeover until
// acknowledged (else: a ticket). Ack is stamped with the day's date in localStorage,
// so it stays dismissed that day and re-arms automatically next sweep day.
// (?streettest=1 forces it on for QA.) Hidden in screenshot mode.
const STREET_ACK = 'garden.streetCarAck';
function streetKey(now) {
  const tz = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const hr = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now), 10);
  const dom = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(now), 10);
  const nth = Math.ceil(dom / 7); // 1st..5th occurrence of this weekday in the month
  const isSweepDay = (wd === 'Mon' || wd === 'Wed') && (nth === 1 || nth === 3);
  if (!isSweepDay || hr < 11 || hr >= 13) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function refreshStreetAlarm() {
  const el = document.getElementById('streetalarm');
  if (!el) return;
  const key = qs.has('streettest') ? 'test' : streetKey(new Date());
  let acked = false;
  try { acked = !!key && localStorage.getItem(STREET_ACK) === key; } catch { /* ignore */ }
  const show = !!key && !acked && !SCREENSHOT;
  el._key = key;
  el.classList.toggle('on', show);
  el.setAttribute('aria-hidden', show ? 'false' : 'true');
}
// Mark today's street-sweep done (from the button or Enter/Esc on the takeover).
function ackStreet() {
  const el = document.getElementById('streetalarm');
  try { if (el && el._key) localStorage.setItem(STREET_ACK, el._key); } catch { /* ignore */ }
  refreshStreetAlarm();
  toast('Thanks — car moved 🚗');
}
function wireStreetAlarm() {
  document.getElementById('streetAck')?.addEventListener('click', ackStreet);
  refreshStreetAlarm();
  setInterval(refreshStreetAlarm, 30000);
}

// ---- fortnightly plant-watering reminder -----------------------------------
// A friendly full-screen GREEN nudge to water the house plants, every two weeks,
// anchored to PLANT_START. Shows all day on a watering day until acknowledged
// (button or Enter/Esc), then re-arms two weeks later. Ack is stamped with that
// occurrence's date in localStorage. (?planttest=1 forces it on for QA.) Hidden in
// screenshot mode so QA captures the dashboard.
const PLANT_ACK = 'garden.plantWaterAck';
const PLANT_START = '2026-07-31'; // anchor date for the fortnightly cadence
const PLANT_EVERY_DAYS = 14;
// Local YYYY-MM-DD in the garden's timezone.
function plantDayKey(now) {
  const tz = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
// True if today is a watering day (every PLANT_EVERY_DAYS from PLANT_START, local).
function isPlantDay(now) {
  const startMs = Date.parse(PLANT_START + 'T00:00:00Z');
  const todayMs = Date.parse(plantDayKey(now) + 'T00:00:00Z');
  if (!Number.isFinite(startMs) || !Number.isFinite(todayMs)) return false;
  const days = Math.round((todayMs - startMs) / 864e5);
  return days >= 0 && days % PLANT_EVERY_DAYS === 0;
}
function refreshPlantAlarm() {
  const el = document.getElementById('plantalarm');
  if (!el) return;
  const test = qs.get('planttest');
  const now = new Date();
  const key = test != null ? 'test' : (isPlantDay(now) ? plantDayKey(now) : null);
  let acked = false;
  try { acked = !!key && localStorage.getItem(PLANT_ACK) === key; } catch { /* ignore */ }
  const show = key != null && !acked && !SCREENSHOT;
  el._key = key;
  el.classList.toggle('on', show);
  el.setAttribute('aria-hidden', show ? 'false' : 'true');
}
function ackPlant() {
  const el = document.getElementById('plantalarm');
  try { if (el && el._key) localStorage.setItem(PLANT_ACK, el._key); } catch { /* ignore */ }
  refreshPlantAlarm();
  toast('Thanks — the plants will be happy 🪴');
}
function wirePlantAlarm() {
  document.getElementById('plantAck')?.addEventListener('click', ackPlant);
  refreshPlantAlarm();
  setInterval(refreshPlantAlarm, 30000);
}

// ---- slash-command registry + palette ---------------------------------------
// One source of truth for every /command: the submit dispatcher and the
// Claude-Code-style autocomplete palette both read from here.
const COMMANDS = [
  { cmd: 'help', aliases: ['?'], icon: '🌿', desc: 'how the garden works' , run: () => showHelp() },
  { cmd: 'tendings', aliases: ['iterations', 'changelog'], icon: '❀', desc: 'changelog — how the garden has grown', run: () => showIterations() },
  { cmd: 'grow', aliases: [], icon: '🌱', desc: 'run a tending cycle now on the planted notes', run: () => showGrow() },
  { cmd: 'notes', aliases: ['planted'], icon: '🌿', desc: 'recently planted notes', run: () => showNotes() },
  { cmd: 'events', aliases: ['e'], icon: '🎉', desc: 'all upcoming SF events', run: () => showEvents() },
  { cmd: 'rainforest', aliases: ['rain', 'forest', 'birds'], icon: '🌿', desc: 'forest sounds (real recordings) — pick a place', run: (arg) => toggleRainforest(arg),
    options: () => {
      const playing = RF && RF.isOn() ? RF.current() : null;
      const opts = RAINFOREST_PLACES.map(([arg, icon, label, desc]) => ({ arg, icon, label, desc: (playing === arg ? '▶ playing · ' : '') + label + ' — ' + desc, on: playing === arg }));
      return playing ? [{ arg: 'off', icon: '⏹', label: 'Off', desc: 'stop the rainforest' }, ...opts] : opts;
    } },
  { cmd: 'touch', aliases: ['calibrate'], icon: '👆', desc: 'calibrate camera touch (9 targets)', run: () => { if (panelOpen()) closePanel(); import(`/lib/touch.js?v=${window.__GARDEN_VERSION}`).then((m) => m.runSession()); } },
  { cmd: 'camera', aliases: ['cam', 'live'], icon: '📷', desc: 'live camera feed', run: () => showCamera() },
  { cmd: 'hn', aliases: ['hackernews'], icon: '📰', desc: 'Hacker News front page', run: () => showHackerNews() },
  { cmd: 'controls', aliases: ['controller', 'pad'], icon: '🎮', desc: 'controller button map', run: () => showPadMap() },
  { cmd: 'credits', aliases: ['sounds'], icon: '🎙', desc: 'who recorded the forest sounds (licences)', run: () => showCredits() },
  { cmd: 'fps', aliases: ['fpstest'], icon: '⏱', desc: 'run the 60fps render test', run: () => runFpsTest() },
  { cmd: 'architecture', aliases: ['arch'], icon: '🛠', desc: 'how this system is built', run: () => showArchitecture() },
  { cmd: 'timer', aliases: ['countdown'], icon: '⏱', desc: 'countdown card in the top-left — default 2 minutes; /timer 5, /timer 90s, /timer off', run: (arg) => runTimer(arg),
    options: () => [{ arg: '2', icon: '⏱', label: '2 minutes', desc: 'two-minute countdown' }, { arg: '5', icon: '⏱', label: '5 minutes', desc: 'five-minute countdown' }, { arg: 'off', icon: '⏹', label: 'Off', desc: 'stop the countdown' }] },
  { cmd: 'botanist', aliases: ['desk', 'agent'], icon: '🌿', desc: 'the Botanist — what to say, and how it uses the screen (desk)', run: () => showBotanist() },
  { cmd: 'night', aliases: ['sleep', 'dim'], icon: '🌙', desc: 'toggle the night veil', run: () => toggleNight() },
  { cmd: 'voice', aliases: ['mic', 'listen', 'heygarden'], icon: '🎙', desc: '"Hey Garden" voice control on / off (off = the mic is closed)',
    run: (arg) => { if (!VOICE) { toast('Voice is not running on this screen'); return; } if (/^cal/.test(arg || '')) { VOICE.calibrate(60); return; } VOICE.setEnabled(!VOICE.enabled()); },
    options: () => [{ arg: 'calibrate', icon: '🎚', label: 'Calibrate', desc: 'one minute: say “Hey Garden” around the house, it tunes itself to your voice' }, { arg: 'toggle', icon: '🎙', label: 'On / off', desc: 'turn listening on or off (off = the mic is closed)' }] },
  { cmd: 'refresh', aliases: ['reload'], icon: '🔃', desc: 'reload the garden', run: () => { toast('Refreshing the garden…'); setTimeout(() => location.reload(), 250); } },
];

// Left-aligned above the note bar, as wide as the commands (humans, 2026-10-30): the
// command list on baked liquid glass, and under it a glass bar of the same width with
// the selected command's explanation in bright, contrasting words.
let palEl = null, palMatches = [], palSel = 0, palCmds = null, palDesc = null;
const PAL_VEIL = 0.58; // darker than a panel's glass: the wall behind is busy, rows must read
function ensurePalette() {
  if (palEl) return palEl;
  palCmds = h('div', { class: 'cp-list' });
  palDesc = h('div', { class: 'cp-desc' });
  palEl = h('div', { id: 'cmdpal', hidden: true },
    h('div', { class: 'cp-cmds cp-glass' }, palCmds), h('div', { class: 'cp-explain cp-glass' }, palDesc));
  (document.getElementById('zoomroot') || document.body).appendChild(palEl); // scales with the page
  return palEl;
}
// the explanation bar follows the selection (arrows, the pad, or the pointer)
function setPalSel(i) {
  palSel = i;
  [...palCmds.children].forEach((r, k) => r.classList.toggle('sel', k === i));
  const m = palMatches[i];
  palDesc.textContent = m ? (m.opt ? m.opt.desc : m.c.desc) : '';
}
// glass for both boxes at their current size: cached per size + wall snapshot
// (glassbake's panel cache); every palette size seen is pre-baked again after each
// new snapshot, so it is normally ready before the palette opens
let palGlassT = 0;
const PAL_SIZES_KEY = 'garden.palRects';
function palRects() { try { return JSON.parse(localStorage.getItem(PAL_SIZES_KEY) || '[]'); } catch { return []; } }
function palGlass() {
  if (!GB || SCREENSHOT) return;
  const boxes = palEl ? [...palEl.querySelectorAll('.cp-glass')] : []; if (!boxes.length) return;
  boxes.forEach((b) => GB.glassLayers(b));
  clearTimeout(palGlassT);
  palGlassT = setTimeout(() => {
    if (!paletteOpen()) return;
    for (const box of boxes) {
      const r = box.getBoundingClientRect(), rr = { left: r.left, top: r.top, width: r.width, height: r.height };
      GB.bakePanel(box, { veil: PAL_VEIL }).then((ok) => { box.classList.toggle('nosnap', !ok); }, () => box.classList.add('nosnap'));
      try { // remember this size for the next pre-bake (most recent first, up to 16)
        const list = palRects().filter((x) => Math.round(x.width) !== Math.round(rr.width) || Math.round(x.height) !== Math.round(rr.height) || Math.round(x.top) !== Math.round(rr.top) || Math.round(x.left) !== Math.round(rr.left));
        localStorage.setItem(PAL_SIZES_KEY, JSON.stringify([rr, ...list].slice(0, 16)));
      } catch { /* ignore */ }
    }
  }, 40);
}
function hidePalette() { if (palEl) { palEl.hidden = true; palEl._n = 0; } palMatches = []; palSel = 0; }
function paletteOpen() { return !!palEl && !palEl.hidden && palMatches.length > 0; }

// Show/filter the palette for the current input value: "/frag" lists matching commands;
// a command that has options() ("/rainforest", "/rainforest am…") lists its options
// instead. palMatches holds { c, opt } rows (opt null = the bare command).
function updatePalette(input) {
  const v = input.value;
  const m = /^\/([a-z?]*)(\s+([a-z-]*))?$/i.exec(v.trim() === '/' ? '/' : v.replace(/^\s+/, ''));
  if (!m || document.body.classList.contains('night')) { hidePalette(); return; }
  const frag = m[1].toLowerCase(), hasSpace = m[2] !== undefined, argFrag = (m[3] || '').toLowerCase();
  const exact = COMMANDS.find((c) => c.options && (c.cmd === frag || c.aliases.includes(frag)));
  if (exact) {
    palMatches = exact.options().filter((o) => !argFrag || o.arg.startsWith(argFrag) || (o.label || '').toLowerCase().startsWith(argFrag)).map((opt) => ({ c: exact, opt }));
  } else if (hasSpace) { hidePalette(); return; }
  else palMatches = COMMANDS.filter((c) => c.cmd.startsWith(frag) || c.aliases.some((a) => a.startsWith(frag))).map((c) => ({ c, opt: null }));
  if (!palMatches.length) { hidePalette(); return; }
  palSel = Math.min(palSel, palMatches.length - 1);
  const el = ensurePalette();
  const row = (i, opt, ...kids) => h('div', {
    class: 'cp-row' + (opt && opt.on ? ' on' : ''),
    onmousedown: (ev) => { ev.preventDefault(); runPaletteCmd(input, palMatches[i]); }, // mousedown: beat the blur
    onmouseenter: () => { if (!document.body.classList.contains('idle')) setPalSel(i); },
  }, ...kids);
  palCmds.replaceChildren(...palMatches.map(({ c, opt }, i) => row(i, opt,
    h('span', { class: 'cp-ic' }, opt ? opt.icon : c.icon),
    h('code', { class: 'cp-cmd' }, '/' + c.cmd + (opt && opt.arg ? ' ' + opt.arg : '')),
    !opt && c.aliases.length ? h('span', { class: 'cp-alias' }, c.aliases.map((a) => '/' + a).join(' ')) : null)));
  setPalSel(palSel);
  const wasHidden = el.hidden;
  el.hidden = false;
  if (wasHidden || el._n !== palMatches.length) palGlass(); // a new size → its glass
  el._n = palMatches.length;
}
function runPaletteCmd(input, row) {
  input.value = '';
  hidePalette();
  if (!row) return;
  if (row.opt) row.c.run(row.opt.arg); else row.c.run('');
}
// Keyboard: ↑/↓ select · Enter run · Tab complete · Esc close. Attached to the
// input so it wins before the form submit / global Esc handlers.
function wireCommandPalette(input) {
  input.addEventListener('input', () => { palSel = 0; updatePalette(input); });
  input.addEventListener('keydown', (e) => {
    if (!paletteOpen()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); palSel = (palSel + 1) % palMatches.length; updatePalette(input); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = (palSel - 1 + palMatches.length) % palMatches.length; updatePalette(input); }
    else if (e.key === 'Enter') { e.preventDefault(); runPaletteCmd(input, palMatches[palSel]); }
    else if (e.key === 'Tab') { e.preventDefault(); const r = palMatches[palSel]; input.value = '/' + r.c.cmd + (r.opt ? (r.opt.arg ? ' ' + r.opt.arg : '') : (r.c.options ? ' ' : '')); updatePalette(input); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePalette(); }
  });
}

// ---- page zoom (controller L1/R1; chord = 100%) -------------------------------
// transform:scale() on the ROOT element: a transformed element becomes the
// containing block for fixed-position descendants, so the cursor/panels/QR all
// scale uniformly with the page (the thing plain CSS body-zoom got wrong).
// Zoom-in magnifies from the top-center (edges crop); zoom-out shrinks with the
// theme-dark backdrop showing around it — never a white letterbox.
function setZoomLevel(lvl) {
  const z = Math.pow(1.2, lvl); // Chrome's zoom ladder
  const root = document.getElementById('zoomroot');
  if (!root) return z;
  if (lvl === 0) { root.style.zoom = ''; root.style.width = ''; root.style.height = ''; }
  else {
    root.style.zoom = z.toFixed(4);
    root.style.width = (900 / z).toFixed(1) + 'px';   // compensated → zoomed layout
    root.style.height = (1600 / z).toFixed(1) + 'px'; //   is exactly the screen
  }
  checkOverflow(); // reflow changes fit — keep the guards honest
  return z;
}
function applyZoom(dir) {
  let lvl = parseInt(localStorage.getItem('garden.zoomlvl') || '0', 10) || 0;
  lvl = dir === 0 ? 0 : Math.max(-5, Math.min(5, lvl + dir));
  const z = setZoomLevel(lvl);
  try { localStorage.setItem('garden.zoomlvl', String(lvl)); } catch { /* ignore */ }
  toast(`🔍 ${Math.round(z * 100)}%`);
}

// ---- panel scrolling ----------------------------------------------------------
// Single entry point for pad/keyboard/wheel scrolling of the open panel. Native
// scrollBy: the chromium kiosk composites scrolling off the main thread (60fps).
const panelScroll = { cur: 0, target: 0 }; // retained for openPanel reset compat
function panelScrollBy(px) {
  const body = document.getElementById('panelBody');
  if (body) body.scrollBy({ top: px, behavior: 'smooth' });
}
// Mouse wheel already scrolls a native overflow container; nothing to intercept.

// ---- FPS test (/fps, pad action 'fpstest') -----------------------------------
// Measures REAL requestAnimationFrame rates in this renderer (surf/WebKitGTK on
// the wall) across three scenarios: idle, panel scrolling, and a transform
// animation. Results render in a panel and POST to /api/fps-result so the
// outside world (Claude, scripts) can read what the wall actually achieves.
function fpsMeasure(ms, onFrame) {
  return new Promise((resolve) => {
    let frames = 0, t0 = 0, last = 0, worst = 0, over20 = 0;
    function tick(t) {
      if (!t0) { t0 = t; last = t; requestAnimationFrame(tick); return; }
      frames++;
      const d = t - last; last = t;
      if (d > worst) worst = d;
      if (d > 20) over20++; // frames that missed the 60fps budget (16.7ms)
      if (onFrame) { try { onFrame(t); } catch { /* keep measuring */ } }
      if (t - t0 < ms) requestAnimationFrame(tick);
      else resolve({ fps: +(frames / ((t - t0) / 1000)).toFixed(1), worstMs: Math.round(worst), missed: over20, frames });
    }
    requestAnimationFrame(tick);
  });
}
async function runFpsTest() {
  toast('⏱ measuring — 10s, don’t touch');
  closePanel(); hidePalette();
  const idle = await fpsMeasure(2500);
  // scroll scenario: real content (the changelog panel), scrolled EXACTLY the
  // way users scroll it — smooth glides via panelScrollBy (compositor-animated
  // in chromium). rAF is sampled across three full glides.
  await showIterations();
  await new Promise((r) => setTimeout(r, 900));
  let dir = 1, lastKick = 0;
  const scroll = await fpsMeasure(3000, (t) => {
    if (t - lastKick > 950) { lastKick = t; panelScrollBy(1200 * dir); dir = -dir; }
  });
  closePanel();
  // transform scenario: a GPU-layer card sweeping back and forth
  const probe = h('div', { style: { position: 'fixed', left: '0', top: '42%', width: '220px', height: '130px',
    background: 'var(--glass-2)', border: '1px solid var(--stroke-strong)', borderRadius: '22px',
    zIndex: '150', willChange: 'transform' } });
  document.body.appendChild(probe);
  const anim = await fpsMeasure(3000, (t) => { probe.style.transform = `translateX(${Math.round((Math.sin(t / 280) + 1) * 330)}px)`; });
  probe.remove();
  const result = { idle, scroll, anim };
  fetch('/api/fps-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) }).catch(() => {});
  const row = (k, m) => h('div', { class: 'cl-row' },
    h('div', { class: 'cl-id' }, m.fps >= 55 ? '✓' : m.fps >= 40 ? '~' : '✗'),
    h('div', { class: 'cl-main' },
      h('div', { class: 'cl-phrase' }, `${k}: ${m.fps} fps`),
      h('div', { class: 'cl-meta' }, `worst frame ${m.worstMs}ms · ${m.missed} frames missed the 60fps budget`)));
  openPanel('Render performance — 60fps test', h('div', { class: 'cl' }, row('idle', idle), row('scrolling', scroll), row('animation', anim)));
  return result;
}

// Deep scroll diagnosis (pad action 'fpstestb'): discriminates layer-SIZE from
// layer-NESTING as the reason panel scrolling won't composite.
async function runFpsTestB() {
  toast('⏱ deep scroll diagnosis');
  // A: BIG (840×1300) fixed text layer translated per frame — tests pure size.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(h('div', { style: { padding: '10px 0', borderBottom: '1px solid rgba(140,240,195,.16)', fontSize: '15px' } }, `Row ${i} — the quick brown fox jumps over the lazy dog`));
  const layer = h('div', { style: { willChange: 'transform' } }, ...rows);
  const big = h('div', { style: { position: 'fixed', left: '30px', top: '40px', width: '840px', height: '1300px', overflow: 'hidden', zIndex: '140', background: 'rgba(12,32,27,.92)' } }, layer);
  document.body.appendChild(big);
  let y = 0, dir = 1;
  const bigfixed = await fpsMeasure(2500, () => { y += 8 * dir; if (y > 600 || y < 0) dir = -dir; layer.style.transform = `translateY(${-y}px)`; });
  big.remove();
  // B: the real panel path, but with position:relative + translateZ forced.
  await showIterations();
  await new Promise((r) => setTimeout(r, 900));
  const inner = document.querySelector('#panel .panel-inner');
  if (inner) { inner.style.position = 'relative'; inner.style.transform = 'translateZ(0)'; }
  let steps = 0, dir2 = 1;
  const nested3d = await fpsMeasure(2500, () => { panelScrollBy(8 * dir2); if (++steps % 80 === 0) dir2 = -dir2; });
  closePanel();
  const result = { bigfixed, nested3d };
  fetch('/api/fps-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) }).catch(() => {});
  return result;
}

// Size-bisect + tiling validation (pad action 'fpstestc'): at what layer size
// does compositor promotion die, and do small composited TILES inside a moving
// parent stay on the GPU?
async function runFpsTestC() {
  toast('⏱ size/tiling diagnosis');
  const mkRows = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(h('div', { style: { padding: '9px 0', borderBottom: '1px solid rgba(140,240,195,.16)', fontSize: '15px' } }, `Row ${i} — the quick brown fox jumps over the lazy dog`)); return a; };
  const sweep = async (layer) => { let y = 0, dir = 1; return fpsMeasure(2200, () => { y += 8 * dir; if (y > 250 || y < 0) dir = -dir; layer.style.transform = `translateY(${-y}px)`; }); };
  const host = (hgt, kid) => h('div', { style: { position: 'fixed', left: '30px', top: '40px', width: '840px', height: hgt + 'px', overflow: 'hidden', zIndex: '140', background: 'rgba(12,32,27,.92)' } }, kid);
  const out = {};
  for (const [key, hgt, rows] of [['h400', 400, 13], ['h800', 800, 25]]) {
    const layer = h('div', { style: { willChange: 'transform' } }, ...mkRows(rows));
    const box = host(hgt, layer);
    document.body.appendChild(box);
    out[key] = await sweep(layer);
    box.remove();
  }
  // tiled: parent translated, five ~260px children each its own composited layer
  const tiles = [];
  for (let t = 0; t < 5; t++) tiles.push(h('div', { style: { willChange: 'transform', transform: 'translateZ(0)' } }, ...mkRows(8)));
  const parent = h('div', {}, ...tiles);
  const box = host(1300, parent);
  document.body.appendChild(box);
  out.tiled = await sweep(parent);
  box.remove();
  fetch('/api/fps-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) }).catch(() => {});
  return out;
}

// ---- hand pruning: right-click any [data-editable] text to edit it in place --
// The caret lands at the clicked character (blinking, contentEditable), Enter or
// clicking away saves, Esc cancels, Ctrl+Z undoes committed prunings. Overrides
// persist via POST /api/edits and re-apply at render — only template/widget
// chrome carries data-editable; fetched content (HN titles, events…) never does.
const undoPrunes = [];
let pruning = null; // { el, slot, prev }
function wireEditing() {
  document.addEventListener('contextmenu', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-editable]') : null;
    if (!el || document.body.classList.contains('night')) return;
    e.preventDefault();
    if (pruning && pruning.el !== el) pruning.el.blur();
    pruning = { el, slot: el.dataset.editable, prev: el.textContent };
    el.setAttribute('contenteditable', 'plaintext-only');
    if (!el.isContentEditable) el.setAttribute('contenteditable', 'true'); // engine fallback
    el.classList.add('pruning');
    el.focus();
    try { // place the blinking caret exactly where the user clicked
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    } catch { /* caret falls to start — still editable */ }
  });
  document.addEventListener('keydown', (e) => {
    if (!pruning || e.target !== pruning.el) return;
    if (e.key === 'Enter') { e.preventDefault(); pruning.el.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pruning.el.textContent = pruning.prev; pruning.el.blur(); }
  }, true);
  document.addEventListener('focusout', (e) => {
    if (!pruning || e.target !== pruning.el) return;
    const { el, slot, prev } = pruning;
    pruning = null;
    el.removeAttribute('contenteditable');
    el.classList.remove('pruning');
    const next = (el.textContent || '').trim().slice(0, 120);
    el.textContent = next || prev; // never commit an empty label
    setTimeout(focusInput, 0);     // hand the kiosk focus back to the note bar
    if (!next || next === prev) return;
    undoPrunes.push({ slot, prev });
    (window.__GARDEN_EDITS || (window.__GARDEN_EDITS = {}))[slot] = next;
    saveEdit(slot, next, 'pruned ✂️');
  });
  // Ctrl+Z — undo the most recent committed pruning (skipped while actively
  // editing, where the browser's native text undo applies, or mid-note).
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || pruning) return;
    const input = document.getElementById('feedbackInput');
    if (input && document.activeElement === input && input.value) return;
    const u = undoPrunes.pop();
    if (!u) return;
    e.preventDefault();
    const el = document.querySelector(`[data-editable="${u.slot}"]`);
    if (el) el.textContent = u.prev;
    (window.__GARDEN_EDITS || {})[u.slot] = u.prev;
    saveEdit(u.slot, u.prev, '↩ pruning undone');
  }, true);
}
function saveEdit(slot, value, msg) {
  fetch('/api/edits', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, value }),
  }).then((r) => toast(r.ok ? msg : 'could not save the pruning'))
    .catch(() => toast('could not save the pruning'));
}

// ---- widget focus (right stick) + fullscreen widget views --------------------
// The right stick walks a highlight across the widgets; A (or stick-click)
// opens the highlighted widget as a fullscreen panel. HN and events open their
// rich panels; everything else re-mounts the same widget module at panel size.
let focusIdx = -1, focusClearT = 0, selectMode = false;
// the widgets + the top-right sound (rainforest) button, reached by moving up past the top row
function focusCards() {
  const top = ['volBtn', 'rfBtn'].map((id) => document.getElementById(id)).filter((b) => b && b.offsetParent);
  return [...document.querySelectorAll('#garden > .card[data-wid]'), ...top];
}
function setFocus(i) {
  const cards = focusCards();
  if (!cards.length) return;
  const prevIdx = focusIdx;
  focusIdx = Math.max(-1, Math.min(cards.length - 1, i));
  if (focusIdx !== prevIdx && focusIdx >= 0) UI_SOUND('nav');
  cards.forEach((c, k) => c.classList.toggle('focused', k === focusIdx));
  clearTimeout(focusClearT);
  // In keyboard selection mode the highlight stays put; the right-stick highlight
  // still fades on its own after idle.
  if (focusIdx >= 0 && !selectMode) focusClearT = setTimeout(() => setFocus(-1), 14000);
}
// Directional (spatial) widget focus for the d-pad / arrow keys. The grid is
// two columns with mixed-size cards, so a flat "next/prev" made ↓ behave like →.
// Instead, pick the geometrically-nearest card in the pressed direction using the
// rendered layout, so ↓ really moves DOWN a row, ↑ up, ← / → sideways.
function moveFocusDir(dir) {
  if (panelOpen() || paletteOpen()) return;
  const cards = focusCards();
  if (!cards.length) return;
  if (focusIdx < 0) { setFocus(0); return; }
  const cur = cards[focusIdx].getBoundingClientRect();
  const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
  let best = -1, bestScore = Infinity;
  cards.forEach((c, i) => {
    if (i === focusIdx) return;
    const r = c.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - cx, dy = (r.top + r.height / 2) - cy;
    let along, across;
    if (dir === 'down') { if (dy <= 4) return; along = dy; across = Math.abs(dx); }
    else if (dir === 'up') { if (dy >= -4) return; along = -dy; across = Math.abs(dx); }
    else if (dir === 'right') { if (dx <= 4) return; along = dx; across = Math.abs(dy); }
    else { if (dx >= -4) return; along = -dx; across = Math.abs(dy); } // left
    const score = along + across * 2; // prefer nearest along travel, penalise lateral drift
    if (score < bestScore) { bestScore = score; best = i; }
  });
  if (best >= 0) setFocus(best);
}
// ---- keyboard selection mode (Esc at the top level toggles it) ---------------
// The wall is normally in "writing mode": type anywhere and it lands in the note
// console. Pressing Esc when nothing is open flips into "selection mode": arrows
// move a highlight across the widgets and Enter opens the focused one. Esc again
// returns to writing mode. (Esc still backs out of any open panel first.)
function enterSelectMode() {
  selectMode = true;
  document.getElementById('feedbackInput')?.blur();
  setFocus(focusIdx < 0 ? 0 : focusIdx);
  toast('Selection mode · arrows move · Enter opens · Esc to write');
}
function exitSelectMode() {
  selectMode = false;
  setFocus(-1);
  focusInput();
  toast('Writing mode · type a note · Esc to select');
}
function toggleSelectMode() { selectMode ? exitSelectMode() : enterSelectMode(); }
function openFocusedWidget() {
  const card = focusCards()[focusIdx];
  if (!card) return false;
  if (card.id === 'rfBtn') { openRfMenuPad(); return true; }
  if (card.id === 'volBtn') { volumeMenu(); return true; }
  openWidgetPanel(card.dataset.wid);
  return true;
}
// The Arcade (emulator) lives off-grid: load its module on first use, then open
// its fullscreen picker like any widget.
async function openArcade() {
  if (!WIDGET_MODS.emulator) {
    try {
      const mod = await import(`/widgets/emulator.js?v=${window.__GARDEN_VERSION}`);
      WIDGET_MODS.emulator = mod.default || mod;
    } catch (e) { markError('import', `emulator.js: ${e.message}`); toast('Arcade failed to load'); return; }
  }
  openWidgetPanel('emulator');
}
function openWidgetPanel(id) {
  if (id === 'hacker-news') return showHackerNews();
  if (id === 'sf-events') return showEvents();
  if (id === 'house-cleaning') return showRootsChores();
  const w = WIDGET_MODS[id];
  if (!w) return;
  // A widget may export openFull(body, ctx) for a custom fullscreen experience
  // (e.g. the Mario game). It can set window.__GARDEN_GAME = {input, stop} to
  // take over controller input while open (see wirePad).
  if (typeof w.openFull === 'function') {
    const body = h('div', { class: 'panel-widget panel-game' });
    openPanel(w.title || id, body);
    const ctx = makeCtx(w.id + ':full');
    panelWidgetStop = () => {
      try { ctx._stop(); } catch { /* ignore */ }
      try { window.__GARDEN_GAME?.stop?.(); } catch { /* ignore */ }
      window.__GARDEN_GAME = null;
    };
    Promise.resolve(w.openFull(body, ctx)).catch(() => {
      body.replaceChildren(h('div', { class: 'widget-error' }, 'could not open this widget'));
    });
    return;
  }
  if (typeof w.mount !== 'function') return;
  const body = h('div', { class: 'panel-widget' });
  openPanel(w.title || id, body);
  const ctx = makeCtx(w.id + ':panel');
  panelWidgetStop = ctx._stop;
  Promise.resolve(w.mount(body, ctx)).catch(() => {
    body.replaceChildren(h('div', { class: 'widget-error' }, 'could not open this widget'));
  });
}

// ---- Roots quick chore log (open the Roots widget fullscreen on the wall) -----
// Pick who you are, tap chores, Log — writes to the localhost house API (the
// same data the phone app and leaderboard use). The wall server permits ONLY
// this write (it's localhost-only). The Roots phone app remains the richer flow.
let rootsLogWho = '';
async function showRootsChores() {
  openPanel('Roots — log a chore', h('div', { class: 'cl' })); // no loading text (layout rule)
  let chores = [], users = [], status = null;
  try {
    [chores, users, status] = await Promise.all([
      fetch('/api/house/chores').then((r) => r.json()).then((d) => d.chores || []),
      fetch('/api/house/users').then((r) => r.json()).then((d) => d.users || []),
      fetch('/api/house/status').then((r) => r.json()).catch(() => null),
    ]);
  } catch {
    return openPanel('Roots — log a chore', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'Roots is unavailable right now.')));
  }
  const picked = new Set();
  const body = h('div', { class: 'rc' });
  const render = () => {
    if (!rootsLogWho && users[0]) rootsLogWho = users[0].name;
    const who = h('div', { class: 'rc-who' }, ...users.map((u) =>
      h('button', { class: 'rc-chip' + (u.name === rootsLogWho ? ' on' : ''), type: 'button', 'data-psel': '1',
        onclick: () => { rootsLogWho = u.name; render(); } }, u.name)));
    const ptOf = (k) => (k === 'curb' || k === 'vacuum') ? 2 : 1; // matches the API's scoring
    const grid = h('div', { class: 'rc-grid' }, ...chores.filter((c) => !c.freeText).map((c) =>
      h('button', { class: 'rc-chore' + (picked.has(c.key) ? ' on' : ''), type: 'button', 'data-psel': '1',
        onclick: () => { picked.has(c.key) ? picked.delete(c.key) : picked.add(c.key); render(); } },
        h('span', { class: 'rc-lbl' }, c.label), h('span', { class: 'rc-pt' }, `+${ptOf(c.key)}`))));
    const n = picked.size;
    const logBtn = h('button', { class: 'rc-log', type: 'button', disabled: !n || !rootsLogWho, 'data-psel': '1',
      onclick: doLog }, n ? `Log ${n} chore${n === 1 ? '' : 's'}` : 'Pick chores to log');
    const top = (status?.day || []).slice(0, 3)
      .map((r, i) => h('span', { class: 'rc-rank' }, `${i + 1} ${r.name} ${r.points}`));
    body.replaceChildren(
      h('div', { class: 'rc-sec' }, 'WHO'), who,
      h('div', { class: 'rc-sec' }, 'CHORES'), grid,
      logBtn,
      top.length ? h('div', { class: 'rc-board' }, h('span', { class: 'rc-sec' }, 'TODAY'), ...top) : null);
    // re-apply the controller selection after the rebuild (order is stable)
    if (panelRowIdx >= 0) setPanelRow(panelRowIdx, false);
  };
  async function doLog() {
    const list = [...picked];
    if (!list.length || !rootsLogWho) return;
    try {
      const r = await fetch('/api/house/chores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rootsLogWho, chores: list }),
      });
      if (!r.ok) throw new Error('failed');
      toast(`Logged ${list.length} for ${rootsLogWho}`);
      picked.clear();
      try { status = await fetch('/api/house/status').then((x) => x.json()); } catch { /* ignore */ }
      render();
    } catch { toast('Could not log — try the Roots app'); }
  }
  render();
  openPanel('Roots — log a chore', body);
}

// ---- event detail (tap a row in the events panel) -----------------------------
function showEventDetail(e) {
  const TZ2 = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  const dt = new Intl.DateTimeFormat('en-US', { timeZone: TZ2, weekday: 'long', month: 'long', day: 'numeric' });
  const tm = new Intl.DateTimeFormat('en-US', { timeZone: TZ2, hour: 'numeric', minute: '2-digit' });
  let when = 'Soon';
  if (e.when) {
    when = dt.format(e.when);
    if (!e.allDay) {
      when += ` · ${tm.format(e.when)}`;
      if (e.until && !isNaN(e.until) && e.until > e.when) when += ` – ${tm.format(e.until)}`;
    }
  }
  // The event's picture (/api/event-image, server-cropped from its page's og:image):
  // a fixed box beside the name, so nothing moves when it fades in; no picture → the
  // box just stays empty.
  let pic = null;
  if (e.url || e.image) {
    const img = h('img', { alt: '', decoding: 'async',
      src: `/api/event-image?s=l&u=${encodeURIComponent(e.url || e.image)}${e.image ? `&img=${encodeURIComponent(e.image)}` : ''}` });
    img.onload = () => Promise.resolve(img.decode ? img.decode() : null).catch(() => {}).then(() => img.classList.add('on'));
    img.onerror = () => img.remove();
    pic = h('div', { class: 'evd-pic' }, img);
  }
  const kids = [
    h('div', { class: 'evd-top' },
      h('div', { class: 'evd-head' },
        h('div', { class: 'evd-name' }, `${e.emoji ? e.emoji + ' ' : ''}${e.name}`),
        h('div', { class: 'evd-meta' }, when + (e.recur ? ` · ${e.recur.label}` : '')),
        e.placeFull ? h('div', { class: 'evd-meta' }, e.placeFull) : null),
      pic),
    e.description ? h('p', { class: 'evd-desc' }, e.description) : h('p', { class: 'evd-desc dim' }, 'No description provided.'),
  ];
  if (e.url) {
    const qr = `/api/proxy?url=${encodeURIComponent(`https://quickchart.io/qr?text=${encodeURIComponent(e.url)}&dark=eafff4&light=00000000&ecLevel=M&margin=1&size=180&format=png`)}`;
    kids.push(h('div', { class: 'evd-qr' },
      h('img', { src: qr, alt: 'event link' }),
      h('div', { class: 'evd-qrcap' }, 'scan for the event page')));
  }
  openSubPanel('Event', h('div', { class: 'evd' }, ...kids.filter(Boolean)));
}

// ---- article reader (tap a story in the HN panel) -----------------------------
// Render the article's ORIGINAL page (its real HTML/CSS) inside a SANDBOXED,
// scripts-disabled iframe served same-origin through /api/readable?raw=1 — so
// it looks like the real site, is read-only (no scripts, links inert), and you
// just scroll. The iframe is the full panel; on load failure, a QR to the phone.
function openReader(url, title) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const frame = h('iframe', {
    class: 'rd-frame', tabindex: '-1', // don't grab keyboard focus (so Esc/Back works on the FIRST press)
    // allow-scripts so JS-rendered pages work, but NO allow-same-origin → the
    // page runs in an opaque/null origin and can't touch our origin, cookies,
    // localStorage or APIs. (No top-navigation/popups either — read-only.)
    sandbox: 'allow-scripts',
    src: `/api/readable?read=1&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}`, // clean reader by default
    referrerpolicy: 'no-referrer', loading: 'eager', title: title || 'article',
  });
  frame.addEventListener('load', () => { document.getElementById('panelClose')?.focus(); });
  frame.addEventListener('error', () => {
    const qr = `/api/proxy?url=${encodeURIComponent(`https://quickchart.io/qr?text=${encodeURIComponent(url)}&dark=eafff4&light=00000000&ecLevel=M&margin=1&size=200&format=png`)}`;
    box.replaceChildren(h('div', { class: 'cl-empty' }, 'Couldn’t load this page — scan to read it on your phone.'),
      h('div', { class: 'evd-qr' }, h('img', { src: qr, alt: 'article link' })));
  });
  // Reader ↔ original page toggle (the original runs the site's own scripts in the
  // sandbox — sometimes richer, sometimes blank; the reader always works).
  let raw = false;
  const toggle = h('button', { class: 'gbtn quiet rd-toggle', type: 'button' }, 'Original page');
  toggle.addEventListener('click', () => {
    raw = !raw;
    frame.src = `/api/readable?${raw ? 'raw' : 'read'}=1&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}`;
    toggle.textContent = raw ? 'Reader view' : 'Original page';
  });
  const box = h('div', { class: 'reader-frame-wrap' },
    h('div', { class: 'rd-src' }, h('span', {}, host || 'reading'), toggle), frame);
  openSubPanel(title || 'Reading…', box);
  document.getElementById('panelBody')?.classList.add('reading'); // panel stops scrolling; iframe scrolls
  // Set readerFrame AFTER openSubPanel — openPanel() nulls it, so assigning
  // before (the old bug) left it null and the joypad couldn't scroll the article.
  readerFrame = frame;
  document.getElementById('panelClose')?.focus(); // keep keys on the parent, not the iframe
}
// True while the article reader is the open view; lets the controller scroll it.
// The reader iframe is now cross-origin (null-origin sandbox so its JS can run
// safely), so we can't call its scrollBy directly — we postMessage the injected
// scroll bridge instead (see serveReadable).
let readerFrame = null;
function readerScroll(dy) {
  try { readerFrame?.contentWindow?.postMessage({ __readerScroll: dy }, '*'); return true; } catch { return false; }
}

// ---- unified panel-row selection --------------------------------------------
// A panel that lists .clickable rows (events, Hacker News) is navigable: up/down
// move a highlighted row, and "select" ACTIVATES it by calling .click() — the
// EXACT same path as a mouse tap, so controller and pointer share one behavior.
// Used by both the SSE controller bridge and the keyboard.
function panelRows() {
  const pb = document.getElementById('panelBody');
  // Any clickable list row OR an explicitly-marked control ([data-psel]) is
  // controller/keyboard navigable — so the Roots chore logger's chips/buttons
  // work the same as the events/HN rows.
  return pb ? [...pb.querySelectorAll('.cl-row.clickable, [data-psel]')] : [];
}
let panelRowIdx = -1;
function setPanelRow(i, scroll = true) {
  const rows = panelRows();
  if (!rows.length) { panelRowIdx = -1; return false; }
  panelRowIdx = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle('row-sel', k === panelRowIdx));
  if (scroll) rows[panelRowIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}
function movePanelRow(delta) {
  const rows = panelRows();
  if (!rows.length) return false;
  setPanelRow(panelRowIdx < 0 ? (delta > 0 ? 0 : rows.length - 1) : panelRowIdx + delta);
  return true;
}
function activatePanelRow() {
  const rows = panelRows();
  const row = rows[panelRowIdx] || rows[0];
  if (row) { row.click(); return true; }
  return false;
}
// Cursor hover and controller selection share ONE state: hovering a row makes it
// the selected row (so the same highlight shows and A acts on what you point at).
document.addEventListener('mouseover', (e) => {
  const row = e.target?.closest?.('#panelBody .cl-row.clickable');
  if (!row) return;
  const i = panelRows().indexOf(row);
  if (i >= 0 && i !== panelRowIdx) setPanelRow(i, false);
}, true);

// ---- game-controller bridge (SN30 Pro via /api/pad/stream SSE) --------------
// R2/X→palette · stick/d-pad→select or scroll · A/B(ok)→run · L2/Y→back ·
// L1/R1→page · Start→help · Select→changelog. Actions arrive from the pad
// service through the backend; this maps them onto the same UI paths the
// keyboard uses, so controller and keys always behave identically.
function wirePad() {
  const input = document.getElementById('feedbackInput');
  const panelBody = () => document.querySelector('#panel .panel-body');
  let padMapPeek = false; // true while the controller map is held open by R2
  window.__gardenPadApply = (action) => apply(action); // "Hey Garden" presses buttons the same way
  const apply = (action) => {
    if (action === 'volup' || action === 'voldown' || action === 'volshow') { showVolume(); return; } // MX thumb wheel / R2+L1 + right stick (pad.mjs set it)
    // the heart (Home) button: open the Arcade from anywhere, or close it (and any game)
    if (action === 'arcadetoggle') { if (paletteOpen()) { hidePalette(); if (input) input.value = ''; } closeRfMenu(); padMapPeek = false; switchDashboard('arcade'); return; }
    // controller sounds: a soft tick on moves, a brighter press on A (silent in games — uisound)
    if (/^f?(up|down|left|right)$/.test(action)) UI_SOUND('nav');
    else if (action === 'ok' || action === 'fopen') UI_SOUND('select');
    // Dashboard combos ('dash' + combo code) always win — they toggle dashboards
    // even mid-game (the same combo that opened a dashboard closes it).
    if (/^dash[a-d]+$/.test(action)) {
      const d = DASHBOARDS.find((x) => x.combo && comboCode(x.combo) === action.slice(4));
      if (d) switchDashboard(d.id);
      return;
    }
    // Raw controller edges (jb…/jx…/jy…) only matter to a running game.
    if (/^[jq][bxy]/.test(action)) { try { window.__GARDEN_GAME?.raw?.(action); } catch { /* ignore */ } return; } // j = player 1, q = player 2
    // player 2 (an Xbox controller, pad.mjs) came or went: games give it the second seat
    if (action === 'ptwoon' || action === 'ptwooff') { const on = action === 'ptwoon'; if (on !== !!window.__GARDEN_P2) toast(on ? 'Player 2 controller connected' : 'Player 2 controller disconnected'); window.__GARDEN_P2 = on; return; }
    // A running game OVERWRITES all control mappings. Leaving: hold all four
    // shoulder buttons (L1+R1+L2+R2 → 'arcade'); in the game list L2 still works.
    if (window.__GARDEN_GAME) {
      const inGame = window.__GARDEN_GAME.inGame?.();
      if (action === 'arcade' || (action === 'back' && !inGame)) { closePanel(); return; }
      try { window.__GARDEN_GAME.input(action); } catch { /* ignore */ }
      return;
    }
    const pal = paletteOpen();
    if (rfMenuNav(action)) return;   // the forest menu opened from the controller owns the pad
    if (volMenuNav(action)) return;  // …and so does the volume popover
    switch (action) {
      case 'palette':
        if (pal) { hidePalette(); break; }
        // X opens the palette ONLY from the wall — it never closes a panel (that read
        // as "back + palette" and knocked people out of the Arcade).
        if (panelOpen()) break;
        if (input) { input.value = '/'; focusInput(); palSel = 0; updatePalette(input); }
        break;
      case 'up':
      case 'down':
      case 'left':
      case 'right': {
        const delta = (action === 'down' || action === 'right') ? 1 : -1;
        if (pal && palMatches.length) { // palette: move selection
          palSel = (palSel + delta + palMatches.length) % palMatches.length;
          updatePalette(input);
        } else if (document.getElementById('panelBody')?.classList.contains('reading')) {
          readerScroll(delta * 220); // controller scrolls the article inside the reader iframe
        } else if (panelOpen()) {
          // a panel with rows → MOVE THE SELECTION (left/right too); else scroll.
          if (!movePanelRow(delta)) panelScrollBy(delta * 160);
        } else {
          moveFocusDir(action); // on the wall → move the highlight SPATIALLY (↓ = down a row)
        }
        break;
      }
      case 'ok': // A — unified "select/press"
        if (pal && palMatches[palSel]) runPaletteCmd(input, palMatches[palSel]);
        else if (panelOpen()) activatePanelRow();      // click the selected row (== mouse tap)
        else if (!openFocusedWidget()) { /* nothing focused */ }
        break;
      // Right stick = free SCROLL whenever a panel/reader is open (a guaranteed
      // scroll method regardless of list selection), else move the widget focus.
      case 'fup':
      case 'fdown': {
        const dir = action === 'fdown' ? 1 : -1;
        if (document.getElementById('panelBody')?.classList.contains('reading')) readerScroll(dir * 220);
        else if (panelOpen()) panelScrollBy(dir * 200);
        else moveFocusDir(action === 'fdown' ? 'down' : 'up');
        break;
      }
      case 'fleft': moveFocusDir('left'); break;
      case 'fright': moveFocusDir('right'); break;
      case 'fopen':
        if (pal) break;
        if (panelOpen()) activatePanelRow(); else openFocusedWidget();
        break;
      case 'events':
        if (pal) { hidePalette(); if (input) input.value = ''; }
        showEvents();
        break;
      case 'hn':
        // Y is BACK when a page panel is open (controller-natural), else opens HN.
        // (In games __GARDEN_GAME intercepts before here, so Y stays a game button.)
        if (panelOpen()) { closePanel(); break; }
        if (pal) { hidePalette(); if (input) input.value = ''; }
        showHackerNews();
        break;
      case 'arcade': // L1+R1+L2+R2 chord — the Arcade isn't on the grid; open it on demand
        if (pal) { hidePalette(); if (input) input.value = ''; }
        padMapPeek = false;
        switchDashboard('arcade');
        break;
      case 'mxup': mouseForward(); break;   // MX Master top thumb button (via pad.mjs)
      case 'mxdown': mouseBack(); break;    // MX Master bottom thumb button
      case 'padmap': // R2 down — peek the controller map instantly
        if (pal) { hidePalette(); if (input) input.value = ''; }
        showPadMap();
        padMapPeek = true;
        break;
      case 'padmapend': // R2 released — close the peeked map
        if (padMapPeek) { padMapPeek = false; if (panelOpen()) closePanel(); }
        break;
      case 'back':
        if (pal) { hidePalette(); if (input) input.value = ''; }
        else if (panelOpen()) closePanel();
        else if (focusIdx >= 0) setFocus(-1); // clear widget highlight
        break;
      case 'pageup':
      case 'pagedown':
        if (panelOpen()) panelScrollBy(action === 'pagedown' ? 540 : -540);
        break;
      case 'zoomin': applyZoom(+1); break;
      case 'zoomout': applyZoom(-1); break;
      case 'zoomreset': applyZoom(0); break;
      case 'help': panelOpen() ? closePanel() : showHelp(); break;
      case 'changelog': panelOpen() ? closePanel() : showIterations(); break;
      case 'fpstest': runFpsTest(); break;
      case 'fpstestb': runFpsTestB(); break;
      case 'fpstestc': runFpsTestC(); break;
      default: break; // left/right/noop — unused for now
    }
  };
  // Real mouse/keyboard switches the close hint back to "esc · close". (The pad
  // bridge dispatches keys into the emulator iframe, not the main doc, so a
  // main-document keydown is always a real keyboard.)
  window.addEventListener('pointerdown', () => setPadMode(false), true);
  window.addEventListener('keydown', () => setPadMode(false), true);
  const connect = () => {
    const es = new EventSource('/api/pad/stream');
    es.onmessage = (e) => { try { const a = JSON.parse(e.data).action; if (!a.startsWith('mx') && !/^j[bxy]/.test(a)) setPadMode(true); apply(a); } catch { /* ignore */ } };
    es.onerror = () => { es.close(); setTimeout(connect, 5000); }; // server restart → reconnect
  };
  connect();
}

// ---- feedback bar -----------------------------------------------------------
// ---- MX Master 3 thumb buttons -----------------------------------------------
// The two side buttons arrive as mouse buttons 4 (forward = TOP) and 3 (back =
// BOTTOM). Top: press "Done" on a big announcement if one is up (trash to curb,
// move the car, water the plants), otherwise open Gardyn fullscreen. Bottom: go
// back — out of a Gardyn how-to, then close the panel. We swallow every event
// phase so the browser never treats them as history back/forward.
function mouseForward() {
  const alarm = ['trashalarm', 'streetalarm', 'plantalarm'].map((id) => document.getElementById(id))
    .find((el) => el && el.classList.contains('on'));
  if (alarm) { alarm.querySelector('button')?.click(); return; }
  if (paletteOpen()) hidePalette();
  if (!(panelOpen() && document.querySelector('#panel .gx'))) openWidgetPanel('gardyn');
}
function mouseBack() {
  if (paletteOpen()) { hidePalette(); return; }
  const hw = document.querySelector('#panel .hw-back');
  if (hw) { hw.click(); return; }
  if (panelOpen()) closePanel();
}
// If the browser ever does deliver the DOM events, handle them too (and stop
// history navigation). On this kiosk they arrive via the pad bridge instead.
function wireMouseSide() {
  const onBtn = (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'mouseup') (e.button === 4 ? mouseForward : mouseBack)();
  };
  for (const t of ['mousedown', 'mouseup', 'auxclick', 'pointerdown', 'pointerup', 'click']) window.addEventListener(t, onBtn, true);
}

// ---- Cmd/Ctrl + ↑ : expand the command line into a larger writing window ------
// Just a bigger plain-text box for longer notes. Enter plants (Shift+Enter makes
// a newline); Cmd/Ctrl + ↓ or Esc returns to the command line. No markdown.
let mdEl = null;
function openMdEditor() {
  if (mdEl) return;
  const input = document.getElementById('feedbackInput');
  const ta = h('textarea', { class: 'md-ta', spellcheck: 'false',
    placeholder: 'Write a note for the gardener…  Enter to plant · Shift+Enter for a new line' });
  ta.value = input ? input.value : '';
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); plantMd(ta.value); }
    else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') { e.preventDefault(); closeMdEditor(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMdEditor(); }
  });
  mdEl = h('div', { class: 'mdeditor' },
    h('div', { class: 'md-head' },
      h('span', { class: 'md-ttl' }, 'NOTE'),
      h('span', { class: 'md-hint' }, '↵ plant · ⇧↵ new line · ⌘↓ back to command line')),
    ta);
  mdEl._ta = ta;
  document.body.appendChild(mdEl); // outside #zoomroot → fixed viewport overlay, immune to controller zoom
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
}
function closeMdEditor() {
  if (!mdEl) return;
  const input = document.getElementById('feedbackInput');
  if (input && mdEl._ta) input.value = mdEl._ta.value; // carry text back to the command line
  mdEl.remove(); mdEl = null;
  focusInput();
}
async function plantMd(text) {
  text = String(text || '').trim();
  if (!text) { closeMdEditor(); return; }
  if (strayNote(text)) { toast('Looks like a stray key — type a little more to plant a note'); return; }
  try {
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, dashboard: CURRENT_DASH }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('Planted 🌱  — the gardener will tend to it');
    const input = document.getElementById('feedbackInput'); if (input) input.value = '';
    mdEl?.remove(); mdEl = null; focusInput();
  } catch { toast('Could not reach the gardener — try again'); }
}

// A one-character note ("x") is almost always a brushed key + Enter on the wall
// keyboard, not a request — don't plant it (the text stays in the field so a real
// note can carry on). 2026-10-30, after a lone "x" arrived as the day's feedback.
function strayNote(text) { return Array.from(String(text || '').trim()).length < 2; }

function wireFeedback() {
  const form = document.getElementById('feedbackForm');
  const input = document.getElementById('feedbackInput');
  if (!form || !input) return;
  focusInput();

  // Type anywhere → the note field (no clicking needed); Esc closes a panel.
  // Capture phase so Esc is caught even when focus is on a button or the panel.
  window.addEventListener('keydown', (e) => {
    // Full-screen alarms (trash / street car / plant watering) are dismissible with
    // Enter or Esc — highest priority, before anything else can claim the key.
    if (e.key === 'Enter' || e.key === 'Escape') {
      const alarm = document.querySelector('#trashalarm.on, #streetalarm.on, #plantalarm.on');
      if (alarm) {
        e.preventDefault(); e.stopPropagation();
        if (alarm.id === 'trashalarm') ackTrash();
        else if (alarm.id === 'streetalarm') ackStreet();
        else if (alarm.id === 'plantalarm') ackPlant();
        return;
      }
    }
    if (mdEl) return; // markdown editor open → its textarea owns the keyboard
    // The top-right popovers (volume slider, forest menu) own the arrows while open:
    // ↑/→ louder · ↓/← quieter (volume) or move the row (forests), Enter picks, Esc closes.
    if (volMenuOpen() || document.getElementById('rfMenu')) {
      const act = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'back' }[e.key];
      if (act && (volMenuNav(act) || rfMenuNav(act))) { e.preventDefault(); e.stopPropagation(); return; }
    }
    // Esc backs out of an open panel first; once nothing is open it toggles
    // between writing mode (the note console) and keyboard selection mode.
    if (e.key === 'Escape') {
      e.preventDefault();
      if (panelOpen()) { closePanel(); return; }
      if (paletteOpen()) { hidePalette(); return; }
      toggleSelectMode();
      return;
    }
    if (window.__GARDEN_GAME) return; // a running game handles its own keys
    // Cmd/Ctrl + ↑ expands the command line into a full markdown editor.
    if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp' && !panelOpen()) { e.preventDefault(); openMdEditor(); return; }
    // While a panel is open: arrows move the row SELECTION when it has clickable
    // rows (Enter activates — same as a tap), else they scroll. Page/Home/End scroll.
    if (panelOpen()) {
      const sb = document.getElementById('panelBody');
      if (!sb) return;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && panelRows().length) {
        e.preventDefault(); movePanelRow(e.key === 'ArrowDown' ? 1 : -1); return;
      }
      if (e.key === 'Enter' && panelRows().length) { e.preventDefault(); activatePanelRow(); return; }
      const page = sb.clientHeight - 60;
      const moves = { ArrowDown: 64, ArrowUp: -64, PageDown: page, PageUp: -page,
        Home: -1e9, End: 1e9, ' ': page };
      if (e.key in moves) { e.preventDefault(); panelScrollBy(moves[e.key]); }
      return;
    }
    // Dashboard selection mode: arrows walk the widget highlight, Enter opens it.
    if (selectMode) {
      if (e.key === 'ArrowRight') { e.preventDefault(); moveFocusDir('right'); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocusDir('left'); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveFocusDir('down'); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveFocusDir('up'); return; }
      if (e.key === 'Enter') { e.preventDefault(); openFocusedWidget(); return; }
      // Any printable key drops back to writing mode and starts the note.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) { exitSelectMode(); return; }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Shift+T → trash shortcut. Only fires when the note field is empty, so a
    // capital T typed mid-note never toggles it (the requested no-typing-conflict).
    if (e.shiftKey && (e.key === 'T' || e.key === 't') && input.value.trim() === '') {
      e.preventDefault();
      const key = trashWeekKey(new Date());
      if (!key) { toast('No trash reminder right now 🗑'); return; }
      let acked = false;
      try { acked = localStorage.getItem(TRASH_ACK) === key; } catch { /* ignore */ }
      if (acked) {
        try { localStorage.removeItem(TRASH_ACK); } catch { /* ignore */ } // re-arm: bring it back today
        refreshTrashAlarm();
        toast('Trash reminder re-armed 🗑  (shift+T)');
      } else {
        ackTrash();                                                    // mark this cycle done
      }
      return;
    }
    if (window.__GARDEN_GAME) return; // a running game owns the keyboard
    if (document.activeElement && document.activeElement.isContentEditable) return; // hand-pruning in progress
    if (document.activeElement !== input && e.key.length === 1) focusInput();
  }, true);
  // Refocus if the field ever loses focus (kiosk: always ready to type).
  input.addEventListener('blur', () => setTimeout(() => {
    // Don't steal focus back while a panel/editor is open, a hand-pruning edit is
    // active, or the wall is in keyboard selection mode.
    if (!panelOpen() && !mdEl && !selectMode && !(document.activeElement && document.activeElement.isContentEditable)) focusInput();
  }, 0));
  document.getElementById('iterBadge')?.addEventListener('click', showIterations);
  document.getElementById('panelClose')?.addEventListener('click', closePanel);
  document.getElementById('panel')?.addEventListener('click', (e) => { if (e.target.id === 'panel') closePanel(); });
  // Belt-and-suspenders: also catch Esc on the panel itself (in case the window
  // capture listener missed focus). The close button lives here, so it has focus.
  document.getElementById('panel')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
  });

  wireCommandPalette(input);

  // The HN reader is a CROSS-ORIGIN iframe (null-origin sandbox keeps its JS safe),
  // so a keypress while it holds focus can't reach the wall — that's why Esc/Back
  // needed two presses after you clicked the article. Clicking a cross-origin
  // iframe blurs the top window; when that happens and the reader frame is what
  // took focus, bounce focus back to the panel so Esc/Back works on the FIRST
  // press. (The reader is read-only: wheel + controller still scroll it.)
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (readerFrame && document.activeElement === readerFrame) {
        document.getElementById('panelClose')?.focus();
      }
    }, 0);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    UI_SOUND(text[0] === '/' ? 'tick' : 'confirm');
    if (text[0] === '/') { // slash command, not feedback
      const cmd = text.slice(1).toLowerCase().split(/\s+/)[0];
      input.value = '';
      hidePalette();
      const found = COMMANDS.find((c) => c.cmd === cmd || c.aliases.includes(cmd));
      if (found) return found.run(text.slice(1).trim().split(/\s+/).slice(1).join(' ').toLowerCase());
      toast(`Unknown command "/${cmd}" — try /help`);
      return;
    }
    if (strayNote(text)) { toast('Looks like a stray key — type a little more to plant a note'); return; }
    input.value = '';
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, dashboard: CURRENT_DASH }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast(CURRENT_DASH === 'main' ? 'Planted — it grows tomorrow morning' : `Planted in ${(DASHBOARDS.find((d) => d.id === CURRENT_DASH) || {}).name} — its own gardener tends it`);
    } catch {
      input.value = text;
      toast('Could not reach the gardener — try again');
    }
  });
}

// ---- custom green-dot cursor ------------------------------------------------
function wireCursor() {
  // The cursor itself is a CSS image (drawn by the OS — no lag). This only hides it
  // after 2 s of stillness and brings it back on the next move.
  let hideT;
  const wake = () => {
    if (document.body.classList.contains('idle')) document.body.classList.remove('idle');
    clearTimeout(hideT);
    hideT = setTimeout(() => document.body.classList.add('idle'), 2000);
  };
  window.addEventListener('mousemove', wake, { passive: true });
  // No native tooltips on the wall: the moment the cursor reaches an element with a
  // `title`, move it to data-title (the browser never shows the popup).
  document.addEventListener('mouseover', (e) => {
    for (let el = e.target; el && el !== document; el = el.parentElement) {
      if (el.hasAttribute && el.hasAttribute('title')) { el.dataset.title = el.getAttribute('title'); el.removeAttribute('title'); }
    }
  }, true);
  window.addEventListener('pointerdown', wake, { passive: true });
  document.body.classList.add('idle');
}

// ---- corner Plant-a-Note QR -------------------------------------------------
// The QR used to be a grid widget; the humans asked for it to live quietly in the
// top-right corner — just the code, no card, no copy. It now renders as WHITE
// modules on a TRANSPARENT background so it floats slickly over the aurora. It
// encodes the PUBLIC tunnel URL (state.publicUrl) so a phone can actually reach
// it; if no public URL exists yet, the corner stays empty rather than show a dead code.
const isPublicUrl = (u) => {
  try { return !/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i.test(new URL(u).hostname); }
  catch { return false; }
};
let cornerQrTarget = null; // re-render only when the public URL actually changes
async function wireCornerQr() {
  const el = document.getElementById('cornerqr');
  if (!el) return;
  let base = '';
  try {
    const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
    if (s && s.publicUrl) base = s.publicUrl;
  } catch { /* offline — leave empty */ }
  if (!base && window.__GARDEN_STATE && window.__GARDEN_STATE.publicUrl) base = window.__GARDEN_STATE.publicUrl;
  if (!base) { try { if (isPublicUrl(location.origin)) base = location.origin; } catch { /* ignore */ } }
  base = String(base || '').replace(/\/+$/, '');
  if (!base) { el.hidden = true; cornerQrTarget = null; return; }
  // The QR opens ARBOR — the household app is the front door at `/`
  // (notes, clean mode, leaderboard). /plant.html still exists as a fallback page.
  const target = base;
  if (target === cornerQrTarget) return; // unchanged — don't refetch the PNG
  cornerQrTarget = target;
  // Dark-green modules straight on the aurora — NO white plate (per feedback).
  // ecLevel=H adds redundancy since dark-on-dark is contrast-poor for scanners.
  const src = `/api/proxy?url=${encodeURIComponent(
    `https://quickchart.io/qr?text=${encodeURIComponent(target)}&dark=0c5c34&light=00000000&ecLevel=H&margin=1&size=240&format=png`)}`;
  const img = h('img', { alt: 'Scan to open Roots', src });
  img.addEventListener('error', () => { el.hidden = true; cornerQrTarget = null; });
  el.replaceChildren(img, h('span', { class: 'qr-label' }, 'Roots'));
  el.setAttribute('href', target);
  el.setAttribute('aria-label', 'Scan to open Roots');
  el.hidden = false;
}
// The tunnel URL can rotate (cloudflared fallback restarts) without a version
// bump/page reload — re-check periodically so the wall QR never goes stale.
// (corner Roots QR removed 2026-10-07 — Roots is at /roots on the public URL)

// The kiosk page must NEVER scroll: focusing the note bar auto-scrolls the root
// scroller over zoom-scaled content (even with overflow:hidden), exposing raw
// canvas. Pin it at the origin.
window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); }, { passive: true });

if (SCREENSHOT) document.body.classList.add('screenshot');
if (SCREENSHOT && qs.has('bar')) document.body.classList.add('qa-bar'); // QA: show the note bar in captures
wireFeedback();
wireEditing(); // right-click hand-pruning of titles/labels
if (!SCREENSHOT) wirePad(); // controller bridge (skip in QA captures)
wireMouseSide(); // MX Master thumb buttons: top = Gardyn / confirm, bottom = back
wireTrashAlarm();
wireStreetAlarm();
wirePlantAlarm();
wireCursor();
boot();
wireVoice();
// countdown card (lib/countdown.js): loaded once, resumes a countdown that was running before a reload
let COUNTDOWN = null;
const loadCountdown = () => (COUNTDOWN ||= import(`/lib/countdown.js?v=${window.__GARDEN_VERSION || ''}`).then((m) => { m.init({ sound: (k) => UI_SOUND(k, { force: true }) }); return m; }));
function runTimer(arg) {
  loadCountdown().then((m) => {
    const a = String(arg || '').trim().toLowerCase();
    if (['off', 'stop', 'cancel', 'clear'].includes(a)) { m.stop(); toast('Countdown stopped'); return; }
    const secs = m.parse(a);
    if (!secs) { toast(`Try /timer 2, /timer 90s or /timer off`); return; }
    m.start(secs);
  }).catch(() => toast('The countdown could not load'));
}
if (!SCREENSHOT) { try { if (localStorage.getItem('garden.countdown')) loadCountdown(); } catch { /* ignore */ } }

// ---- "Hey Garden" (lib/voice.js on the wall, src/voice.mjs + src/voiceagent.mjs behind it) ----
// The agent sees a snapshot of the wall (voiceContext) and acts through voiceAct, which
// only calls the same functions a tap, click or controller press would.
let VOICE = null, VOICE_GAMES = [];
const vClip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const vNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function voiceContext() {
  const cards = [...document.querySelectorAll('#garden > .card[data-wid]')].map((c) => {
    const id = c.dataset.wid, w = WIDGET_MODS[id] || {};
    return { id, title: w.title || id, text: vClip(c.innerText, 260) };
  });
  const open = panelOpen();
  const game = window.__GARDEN_GAME;
  return {
    dashboard: CURRENT_DASH,
    dashboards: DASHBOARDS.map((d) => ({ id: d.id, name: d.name })),
    widgets: cards,
    open: open ? { title: document.getElementById('panelTitle')?.textContent || '', items: panelRows().slice(0, 16).map((r, i) => `${i + 1}. ${vClip(r.dataset.name || r.getAttribute('aria-label') || r.innerText, 90)}`), text: vClip(document.getElementById('panelBody')?.innerText, 700) } : null,
    game: game ? { playing: !!game.inGame?.() } : null,
    arcadeGames: VOICE_GAMES, // open('arcade') + select(text: a game) starts one
    palette: paletteOpen(),
    volume: volNow,
    rainforest: RF && RF.isOn() ? RF.current() : 'off',
    night: document.body.classList.contains('night'),
    commands: COMMANDS.map((c) => ({ name: c.cmd, desc: c.desc, ...(c.options ? { args: c.options().map((o) => o.arg) } : {}) })),
  };
}
// fuzzy "which thing did they mean": the best word overlap between the request and a label
function vBest(items, label, want) {
  const w = vNorm(want).split(' ').filter((x) => x.length > 1 && !['the', 'a', 'an', 'my', 'one', 'please', 'open'].includes(x));
  let best = null, score = 0;
  for (const it of items) {
    const l = vNorm(label(it));
    if (!l) continue;
    let sc = 0;
    if (l === vNorm(want)) sc += 10;
    if (vNorm(want) && l.includes(vNorm(want))) sc += 4;
    for (const x of w) if (l.split(' ').some((y) => y.startsWith(x) || x.startsWith(y))) sc += 1;
    if (sc > score) { score = sc; best = it; }
  }
  return best;
}
const VOICE_PANELS = { events: () => showEvents(), hn: () => showHackerNews(), 'hacker news': () => showHackerNews(), help: () => showHelp(),
  tendings: () => showIterations(), changelog: () => showIterations(), notes: () => showNotes(), controls: () => showPadMap(),
  credits: () => showCredits(), architecture: () => showArchitecture(), camera: () => showCamera() };
const vWait = (ms) => new Promise((r) => setTimeout(r, ms));
async function voiceAct({ name, input = {} }) {
  const game = window.__GARDEN_GAME;
  switch (name) {
    case 'open': {
      const t = vNorm(input.target);
      if (t === 'arcade' || t === 'games') { if (CURRENT_DASH !== 'arcade') await switchDashboard('arcade'); return { ok: true, say: 'Opening the Arcade.' }; }
      if (VOICE_PANELS[t]) { VOICE_PANELS[t](); return { ok: true, say: `Opening ${t === 'hn' ? 'Hacker News' : t}.` }; }
      const ids = Object.keys(WIDGET_MODS).filter((id) => id !== 'emulator');
      const id = ids.includes(input.target) ? input.target : vBest(ids, (i) => `${i.replace(/-/g, ' ')} ${WIDGET_MODS[i].title || ''}${i === 'daily' ? ' painting art' : ''}${i === 'sf-events' ? ' events out in sf' : ''}`, input.target);
      if (!id) return { ok: false, error: `no widget or panel called "${input.target}"` };
      if (paletteOpen()) hidePalette();
      openWidgetPanel(id);
      return { ok: true, say: `Opening ${WIDGET_MODS[id].title || id}.` };
    }
    case 'close': {
      closeRfMenu(); closeVolMenu();
      if (game && game.inGame?.() && input.to !== 'wall') { // in a game: leave it, back to the library
        try { await game.toLibrary(); } catch { /* ignore */ }
        try { window.__SB2?.stop?.(); } catch { /* ignore */ } // (the native port's sound must never linger)
        return { ok: true, say: 'Closed the game.' };
      }
      if (paletteOpen()) { hidePalette(); const i = document.getElementById('feedbackInput'); if (i) i.value = ''; return { ok: true, say: 'Closed.' }; }
      if (panelOpen()) { closePanel(); return { ok: true, say: 'Closed.' }; }
      if (CURRENT_DASH !== 'main') { await switchDashboard(CURRENT_DASH); return { ok: true, say: 'Back to the garden.' }; } // the same id toggles back to main
      return { ok: true, info: 'nothing was open' };
    }
    case 'select': {
      // what can be chosen: the open panel's rows, else the Arcade shelf, else the widgets;
      // right after an open() the panel / shelf may still be rendering — wait a moment
      const pick = () => (panelOpen() && panelRows().length ? panelRows() : document.querySelector('.ax-tile') ? [...document.querySelectorAll('.ax-tile')] : panelOpen() ? [] : focusCards());
      let rows = pick();
      for (let k = 0; k < 25 && (!rows.length || (CURRENT_DASH === 'arcade' && !document.querySelector('.ax-tile'))); k++) { await vWait(100); rows = pick(); }
      if (!rows.length) return { ok: false, error: 'nothing to choose from is open' };
      let el = null;
      if (Number.isInteger(input.index)) el = rows[input.index - 1] || null;
      if (!el && input.text) el = vBest(rows, (r) => `${r.dataset.name || ''} ${r.getAttribute('aria-label') || ''} ${r.dataset.wid ? (WIDGET_MODS[r.dataset.wid]?.title || r.dataset.wid) : ''} ${r.innerText || ''}`, input.text);
      if (!el) return { ok: false, error: `couldn't find "${input.text ?? input.index}" — the items are: ${rows.slice(0, 12).map((r) => vClip(r.dataset.name || r.innerText, 40)).join(' | ')}` };
      if (el.dataset.wid && !panelOpen()) { openWidgetPanel(el.dataset.wid); return { ok: true }; }
      if (el.classList.contains('ax-tile')) { // a tile starts on its second tap (the first selects it)
        if (!el.classList.contains('row-sel')) { el.click(); await vWait(120); }
        if (!document.body.classList.contains('arcade-full')) el.click();
        return { ok: true, say: `Starting ${el.dataset.name || 'the game'}.` };
      }
      el.click();
      return { ok: true, say: 'Done.' };
    }
    case 'press': {
      const map = { page_up: 'pageup', page_down: 'pagedown' };
      const n = Math.max(1, Math.min(10, input.times || 1));
      for (let i = 0; i < n; i++) { window.__gardenPadApply?.(map[input.button] || input.button); await vWait(110); }
      return { ok: true, say: 'Done.' };
    }
    case 'volume': {
      const cur = Number.isFinite(volNow) ? volNow : await fetch('/api/volume', { cache: 'no-store' }).then((r) => r.json()).then((v) => v.volume).catch(() => null);
      if (!Number.isFinite(input.set) && !Number.isFinite(cur)) return { ok: false, error: 'could not read the current volume' };
      const v = Number.isFinite(input.set) ? input.set : cur + (Number.isFinite(input.change) ? input.change : 0);
      setVolume(v);
      setTimeout(showVolume, 250); // after the level has reached the speakers
      return { ok: true, say: `Volume ${Math.max(0, Math.min(100, Math.round(v)))}%.` };
    }
    case 'command': {
      const c = COMMANDS.find((x) => x.cmd === vNorm(input.name) || x.aliases.includes(vNorm(input.name)));
      if (!c) return { ok: false, error: `no command "${input.name}"` };
      c.run(String(input.arg || '').toLowerCase());
      return { ok: true, say: 'Done.' };
    }
    case 'dashboard': {
      if (!DASHBOARDS.find((d) => d.id === input.id)) return { ok: false, error: `no dashboard "${input.id}"` };
      if (input.id === 'main' && CURRENT_DASH === 'main') { // already home: just clear whatever is on top
        closeRfMenu(); closeVolMenu(); if (paletteOpen()) hidePalette(); if (panelOpen()) closePanel();
        return { ok: true, say: 'Back to the garden.' };
      }
      if (CURRENT_DASH !== input.id) await switchDashboard(input.id === 'main' ? CURRENT_DASH : input.id);
      return { ok: true, say: input.id === 'main' ? 'Back to the garden.' : `Opening ${(DASHBOARDS.find((d) => d.id === input.id) || {}).name || input.id}.` };
    }
    case 'zoom': applyZoom(input.to === 'in' ? 1 : input.to === 'out' ? -1 : 0); return { ok: true, say: input.to === 'reset' ? 'Back to 100%.' : `Zoomed ${input.to}.` };
    case 'plant': {
      const text = vClip(input.text, 800);
      if (text.length < 3) return { ok: false, error: 'the note is empty' };
      const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, dashboard: CURRENT_DASH }) }).catch(() => null);
      if (!r || !r.ok) return { ok: false, error: 'could not reach the gardener' };
      toast('Planted — it grows tomorrow morning');
      return { ok: true, say: 'Planted — it grows tomorrow morning.' };
    }
    case 'show': { // an info sheet from the agent: a fullscreen panel built from a few primitives
      const sheet = voiceSheet(input);
      if (!sheet) return { ok: false, error: 'the sheet was empty' };
      if (paletteOpen()) hidePalette();
      openPanel(vClip(input.title, 80) || 'Garden', sheet);
      return { ok: true, say: '' };
    }
    default: return { ok: false, error: `unknown tool ${name}` };
  }
}
// The sheet: title in the panel head, then the blocks in order. Plain DOM text only (no
// HTML from the model); links become their domain (the wall has no pointer browsing).
function voiceSheet({ subtitle, blocks } = {}) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const dom = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? (v.text || v.title || v.label || '') : String(v));
  const els = [];
  if (subtitle) els.push(h('div', { class: 'vs-sub' }, vClip(subtitle, 160)));
  for (const b of blocks.slice(0, 14)) {
    const kids = [];
    if (b.heading) kids.push(h('div', { class: 'vs-h' }, vClip(b.heading, 80)));
    const items = Array.isArray(b.items) ? b.items.slice(0, 24) : [];
    if (b.type === 'text' && b.text) kids.push(h('p', { class: 'vs-p' }, vClip(b.text, 2400)));
    else if (b.type === 'list') kids.push(h('ul', { class: 'vs-list' }, ...items.map((it) => h('li', {}, vClip(str(it), 220)))));
    else if (b.type === 'steps') kids.push(h('ol', { class: 'vs-steps' }, ...items.map((it, i) => h('li', {}, h('b', {}, String(i + 1)), h('span', {}, vClip(str(it), 260))))));
    else if (b.type === 'facts') kids.push(h('div', { class: 'vs-facts' }, ...items.flatMap((it) => [h('div', { class: 'k' }, vClip(it && it.label, 40)), h('div', { class: 'v' }, vClip(it && it.value, 160))])));
    else if (b.type === 'table' && Array.isArray(b.rows)) {
      const cols = Array.isArray(b.columns) ? b.columns.slice(0, 6) : [];
      kids.push(h('table', { class: 'vs-table' },
        cols.length ? h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', {}, vClip(c, 40))))) : null,
        h('tbody', {}, ...b.rows.slice(0, 14).map((r) => h('tr', {}, ...(Array.isArray(r) ? r : [r]).slice(0, 6).map((c) => h('td', {}, vClip(str(c), 80))))))));
    } else if (b.type === 'quote' && b.text) kids.push(h('blockquote', { class: 'vs-quote' }, vClip(b.text, 400), b.by ? h('cite', {}, `— ${vClip(b.by, 60)}`) : null));
    else if (b.type === 'image' && /^https:\/\//.test(b.url || '')) {
      const img = h('img', { src: b.url, alt: '', referrerpolicy: 'no-referrer', loading: 'eager' });
      img.onerror = () => fig.remove();
      const fig = h('figure', { class: 'vs-img' }, img, b.caption ? h('figcaption', {}, vClip(b.caption, 120)) : null);
      kids.push(fig);
    } else if (b.type === 'sources') kids.push(h('div', { class: 'vs-src' }, ...items.slice(0, 6).map((it) => h('span', {}, vClip(it && it.title, 70), h('i', {}, dom(it && it.url))))));
    if (kids.length) els.push(h('section', { class: `vs-b vs-${b.type}` }, ...kids));
  }
  return h('div', { class: 'vs' }, ...els);
}
function wireVoice() {
  // only the wall itself listens (the kiosk on this machine) — not QA captures or the Roots mirror
  if (SCREENSHOT || !['127.0.0.1', 'localhost'].includes(location.hostname)) return;
  fetch('/api/roms').then((r) => r.json()).then((d) => { VOICE_GAMES = ['Super Bomberman: The Garden Edition', ...(d.roms || []).map((r) => r.name)]; }).catch(() => {});
  import(`/lib/voice.js?v=${window.__GARDEN_VERSION || ''}`).then((m) => {
    VOICE = m.startVoice({
      context: voiceContext,
      act: voiceAct,
      sound: (k) => UI_SOUND(k, { force: true }),
      toast,
      showText: (text) => { // a long answer, whole, as paragraphs of a few sentences
        const sentences = String(text).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [String(text)];
        const paras = []; let cur = '';
        for (const x of sentences) { if (cur && (cur + x).length > 320) { paras.push(cur.trim()); cur = ''; } cur += x; }
        if (cur.trim()) paras.push(cur.trim());
        if (paletteOpen()) hidePalette();
        openPanel('Garden', voiceSheet({ blocks: paras.slice(0, 14).map((t) => ({ type: 'text', text: t })) }));
      },
      // the caption on liquid glass: baked once per size (it keeps a fixed width; its height
      // steps by lines) and cached like the panels' glass
      glass: (el) => { if (!GB || SCREENSHOT) return; GB.glassLayers(el); GB.bakePanel(el, { veil: 0.5 }).then((ok) => el.classList.toggle('nosnap', !ok), () => el.classList.add('nosnap')); },
      duck: (down) => { try { if (RF && RF.isOn()) RF.duck(down); } catch { /* ignore */ } },
    });
    if (qs.has('voicedemo')) setTimeout(() => VOICE.demo(), 1500);
  }).catch(() => {});
}
