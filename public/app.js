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

async function loadWidget(entry, mountPoint) {
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
  window.__GARDEN_VERSION = state.version || Date.now();
  setNight(!!state.night);
  if (state.location) {
    const sub = document.getElementById('subtitle');
    if (sub) sub.textContent = state.location;
  }

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
  for (const entry of enabled) await loadWidget(entry, garden);

  document.documentElement.dataset.gardenerReady = 'true';
  document.documentElement.dataset.gardenerWidgetCount = String(enabled.length);
  document.documentElement.dataset.gardenerBoot = 'ready';

  startPolling();
}

// ---- night veil -------------------------------------------------------------
function setNight(on) { document.body.classList.toggle('night', !!on && !SCREENSHOT); }

// ---- backend polling: reload on version change, react to night --------------
function startPolling() {
  const initial = window.__GARDEN_VERSION;
  setInterval(async () => {
    try {
      const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
      setNight(!!s.night);
      if (s.version && s.version !== initial) location.reload(); // a new garden was grown
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
function wireFeedback() {
  const form = document.getElementById('feedbackForm');
  const input = document.getElementById('feedbackInput');
  if (!form || !input) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
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

if (SCREENSHOT) document.body.classList.add('screenshot');
wireFeedback();
boot();
