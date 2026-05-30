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
    async fetchJSON(url, { viaProxy = true, timeout = 12000 } = {}) {
      const target = viaProxy ? `/api/proxy?url=${encodeURIComponent(url)}` : url;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      try {
        const r = await fetch(target, { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    },
    async fetchText(url, { viaProxy = true, timeout = 12000 } = {}) {
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
    loading: (msg = 'growing…') => h('div', { class: 'widget-loading' }, h('span', { class: 'spinner' }), msg),
    error: (msg = 'unavailable') => h('div', { class: 'widget-error' }, '⚠', msg),
  };
  cleanups.push(() => intervals.forEach(clearInterval));
  return ctx;
}

// ---- widget loader ----------------------------------------------------------
const SIZE_CLASS = { sm: '', md: '', lg: 'span-2', full: 'span-2', tall: 'tall', wide: 'span-2' };

async function loadWidget(entry, mountPoint, index = 0) {
  let mod;
  try {
    mod = await import(`/widgets/${entry.file}?v=${window.__GARDEN_VERSION}`);
  } catch (e) {
    markError('import', `${entry.file}: ${e.message}`);
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
  const card = h('div', { class: `card ${SIZE_CLASS[w.size] || ''} ${bare ? 'bare' : ''}`.trim() });
  // Staggered wake-up: each card eases in slightly after the previous one.
  // Cap the index so a large garden can't drag the entrance out too long.
  card.style.setProperty('--enter-index', String(Math.min(index, 16)));
  let body = card;
  if (!bare) {
    card.appendChild(h('div', { class: 'card-title' },
      w.icon ? h('span', { class: 'ic' }, w.icon) : null, w.title || w.id));
    body = h('div', { class: 'card-body' });
    card.appendChild(body);
  }
  mountPoint.appendChild(card);
  try {
    const cleanup = await w.mount(body, makeCtx(w.id));
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  } catch (e) {
    markError('mount', `${entry.id}: ${e.stack || e.message}`);
    body.appendChild(h('div', { class: 'widget-error' }, '⚠', 'widget crashed on mount'));
  }
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
  if (state.location) {
    const sub = document.getElementById('subtitle');
    if (sub) sub.textContent = state.location;
  }
  setIterBadge(state.iteration);

  // Load manifest + widgets.
  const garden = document.getElementById('garden');
  let manifest = { widgets: [] };
  try {
    manifest = await (await fetch(`/widgets/manifest.json?v=${window.__GARDEN_VERSION}`, { cache: 'no-store' })).json();
  } catch (e) { markError('core', `manifest: ${e.message}`); }

  const enabled = (manifest.widgets || [])
    .filter((w) => w.enabled !== false)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  // Mount sequentially to preserve order (cheap; mounts are async-light).
  try {
    let i = 0;
    for (const entry of enabled) await loadWidget(entry, garden, i++);
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
  }
}

// Detect when widgets exceed the locked 900×1600 canvas (overflow:hidden would
// otherwise clip them silently). Publishes data-gardener-overflow; smoke fails
// if it exceeds tolerance, so the daily agent can't ship a clipped garden.
function checkOverflow() {
  const garden = document.getElementById('garden');
  if (!garden) return;
  const over = Math.max(0, garden.scrollHeight - garden.clientHeight);
  document.documentElement.dataset.gardenerOverflow = String(over);
}

// ---- night veil -------------------------------------------------------------
function setNight(on) { document.body.classList.toggle('night', !!on && !SCREENSHOT); }

// ---- header growth badge (the tending number) ------------------------------
function setIterBadge(n) {
  const b = document.getElementById('iterBadge');
  if (b) b.innerHTML = `❀&nbsp;#${Number(n) || 0}`;
}

// ---- backend polling: reload on version change, react to night --------------
function startPolling() {
  let baseline = window.__GARDEN_BOOT_VERSION; // may be null if boot state failed
  setInterval(async () => {
    try {
      const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
      setNight(!!s.night);
      setIterBadge(s.iteration);
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
function openPanel(title, bodyEl) {
  const p = document.getElementById('panel'); if (!p) return;
  document.getElementById('panelTitle').textContent = title;
  document.getElementById('panelBody').replaceChildren(bodyEl);
  p.classList.add('open'); p.setAttribute('aria-hidden', 'false');
  // Move keyboard focus into the panel so Esc works without clicking first
  // (surf doesn't always give the page keyboard focus until interaction).
  setTimeout(() => p.querySelector('.panel-card')?.focus(), 0);
}
function closePanel() {
  const p = document.getElementById('panel'); if (!p) return;
  p.classList.remove('open'); p.setAttribute('aria-hidden', 'true');
  focusInput();
}
function fmtWhen(ms) { try { return ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; } catch { return ''; } }

async function showIterations() {
  let data = { iterations: [] };
  try { data = await (await fetch('/api/iterations', { cache: 'no-store' })).json(); } catch { /* offline */ }
  const list = (data.iterations || []).slice().reverse(); // newest first
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
      cmd('/iterations', 'changelog of every tending so far'),
      cmd('esc', 'close this panel'))));
}

// ---- feedback bar -----------------------------------------------------------
function wireFeedback() {
  const form = document.getElementById('feedbackForm');
  const input = document.getElementById('feedbackInput');
  if (!form || !input) return;
  focusInput();

  // Type anywhere → the note field (no clicking needed); Esc closes a panel.
  // Capture phase so Esc is caught even when focus is on a button or the panel.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (panelOpen()) { e.preventDefault(); closePanel(); } return; }
    if (panelOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement !== input && e.key.length === 1) focusInput();
  }, true);
  // Refocus if the field ever loses focus (kiosk: always ready to type).
  input.addEventListener('blur', () => { if (!panelOpen()) setTimeout(focusInput, 0); });
  document.getElementById('iterBadge')?.addEventListener('click', showIterations);
  document.getElementById('panelClose')?.addEventListener('click', closePanel);
  document.getElementById('panel')?.addEventListener('click', (e) => { if (e.target.id === 'panel') closePanel(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (text[0] === '/') { // slash command, not feedback
      const cmd = text.slice(1).toLowerCase().split(/\s+/)[0];
      input.value = '';
      if (cmd === 'iterations' || cmd === 'changelog') return showIterations();
      if (cmd === 'help' || cmd === '?') return showHelp();
      toast(`Unknown command "/${cmd}" — try /help`);
      return;
    }
    input.value = '';
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast('Planted 🌱  — the gardener will tend to it');
    } catch {
      input.value = text;
      toast('Could not reach the gardener — try again');
    }
  });
}

// ---- custom green-dot cursor ------------------------------------------------
function wireCursor() {
  const cur = document.getElementById('cursor');
  if (!cur) return;
  let on = false, hideT;
  window.addEventListener('mousemove', (e) => {
    cur.style.left = `${e.clientX}px`;
    cur.style.top = `${e.clientY}px`;
    if (!on) { // first move after stillness → fade in big, then shrink to default
      on = true;
      cur.classList.remove('on'); void cur.offsetWidth; cur.classList.add('on');
    }
    clearTimeout(hideT);
    hideT = setTimeout(() => { on = false; cur.classList.remove('on'); }, 1500);
  }, { passive: true });
}

if (SCREENSHOT) document.body.classList.add('screenshot');
wireFeedback();
wireCursor();
boot();
