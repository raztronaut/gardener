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
const SIZE_CLASS = { sm: '', md: '', lg: 'span-2', full: 'span-2', tall: 'tall', wide: 'span-2' };
const WIDGET_MODS = {}; // id → widget module object (filled by loadWidgets)

// Load ALL widgets CONCURRENTLY while preserving visual order: modules are
// imported in parallel, then cards are created synchronously in manifest order,
// then every mount() (the data-fetching part) runs in parallel. Sequential
// awaiting made the remote Wall mirror serialize ~21 tunnel round-trips
// (~10s boot); parallel collapses that to roughly the slowest single widget.
async function loadWidgets(enabled, mountPoint) {
  const mods = await Promise.all(enabled.map((entry) =>
    import(`/widgets/${entry.file}?v=${window.__GARDEN_VERSION}`).catch((e) => ({ __importError: e }))));
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
    const card = h('div', { class: `card ${SIZE_CLASS[w.size] || ''} ${bare ? 'bare' : ''}`.trim(), 'data-wid': entry.id });
    // Click a widget to open it fullscreen — same path as the controller's
    // highlight+A (openWidgetPanel). Skip clicks the widget handled itself
    // (e.g. Mario's grow toy calls stopPropagation) and right-click edits.
    card.addEventListener('click', (e) => {
      if (e.button !== 0 || e.target.closest('[contenteditable="true"], [data-editable].pruning')) return;
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
    mountPoint.appendChild(card);
    mounts.push((async () => {
      try {
        const cleanup = await w.mount(body, makeCtx(w.id));
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      } catch (e) {
        markError('mount', `${entry.id}: ${e.stack || e.message}`);
        body.appendChild(h('div', { class: 'widget-error' }, '⚠', 'widget crashed on mount'));
      }
    })());
  });
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
  setIterBadge(state.iteration);
  // Restore the controller-set zoom level (L1/R1) across reloads.
  try {
    const lvl = parseInt(localStorage.getItem('garden.zoomlvl') || '0', 10) || 0;
    if (lvl !== 0) setZoomLevel(lvl);
  } catch { /* ignore */ }

  // Load manifest + widgets.
  const garden = document.getElementById('garden');
  let manifest = { widgets: [] };
  try {
    manifest = await (await fetch(`/widgets/manifest.json?v=${window.__GARDEN_VERSION}`, { cache: 'no-store' })).json();
  } catch (e) { markError('core', `manifest: ${e.message}`); }

  const enabled = (manifest.widgets || [])
    .filter((w) => w.enabled !== false)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

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
  // Per-card INTERNAL clipping: every .card is overflow:hidden, so content taller
  // than the card is silently cut off. Measure each and surface the worst, plus
  // the names of clipped widgets — smoke fails on this so clipping can't ship.
  let maxClip = 0; const clipped = [];
  for (const card of garden.querySelectorAll(':scope > .card')) {
    const clip = Math.round(card.scrollHeight - card.clientHeight);
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
function setNight(on) { document.body.classList.toggle('night', !!on && !SCREENSHOT); }

// ---- growth bloom beside the wordmark (the tending count) -------------------
function setIterBadge(n) {
  const b = document.getElementById('iterBadge');
  if (!b) return;
  const c = Number(n) || 0;
  b.textContent = `❀ ${c} tending${c === 1 ? '' : 's'}`;
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
function openPanel(title, bodyEl, { keepStack = false } = {}) {
  const p = document.getElementById('panel'); if (!p) return;
  if (!keepStack) { panelStack.length = 0; stopPanelWidget(); } // fresh top-level view resets any stacked detail
  document.getElementById('panelTitle').textContent = title;
  // Content goes inside a transform-scrolled wrapper: native scrollTop scrolling
  // CPU-rasterizes the whole panel every frame in WebKitGTK (measured 3.7fps on
  // the Jetson), while translateY runs on the compositor (~57fps). All panel
  // scrolling goes through panelScrollBy() below.
  document.getElementById('panelBody').replaceChildren(h('div', { class: 'panel-inner' }, bodyEl));
  panelScroll.cur = 0; panelScroll.target = 0;
  panelRowIdx = -1; // fresh row selection per panel view
  document.getElementById('panelBody')?.classList.remove('reading'); // cleared unless openReader re-adds it
  p.classList.add('open'); p.setAttribute('aria-hidden', 'false');
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
  stopPanelWidget();
  const prev = panelStack.pop();
  if (prev) { // restore the underlying list view
    document.getElementById('panelTitle').textContent = prev.title;
    const pb = document.getElementById('panelBody');
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
  focusInput();
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
      cmd('/iterations', 'changelog of every tending so far'),
      cmd('/notes', 'notes you’ve planted — and delete any before tending'),
      cmd('shift + T', 'mark “take trash out” done (on trash day)'),
      cmd('/night', 'toggle the dark screen-saver veil'),
      cmd('/refresh', 'reload the garden now'),
      cmd('esc', 'close this panel'))));
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

// Full-screen, scrollable list of ALL upcoming SF events (the /events · /e command).
// Arrow keys / PageUp-Down / Home-End scroll the list; Esc returns to the dashboard.
async function showEvents() {
  openPanel('Out in SF — upcoming events', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'checking the city…')));
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const TZ = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
  const fetchJSON = (url) => fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  let evs = [];
  try {
    const lib = await import(`/lib/events.js?v=${window.__GARDEN_VERSION}`);
    evs = await lib.fetchEvents(fetchJSON, { limit: 80 });
  } catch {
    return openPanel('Out in SF — upcoming events', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'Events are unavailable right now — try again shortly.')));
  }
  if (!evs.length) {
    return openPanel('Out in SF — upcoming events', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'No upcoming events listed right now.')));
  }
  const rows = evs.map((e) => {
    let when = 'Soon';
    if (e.when) {
      when = `${dayFmt.format(e.when)} ${MON[e.when.getMonth()]} ${e.when.getDate()}`;
      if (!e.allDay) when += ` · ${timeFmt.format(e.when).replace(' ', '')}`; // all-day rows have no real clock time
    }
    return h('div', { class: 'cl-row ev-row clickable', onclick: () => showEventDetail(e) },
      h('div', { class: 'ev-when' }, when),
      h('div', { class: 'cl-main' },
        h('div', { class: 'cl-phrase' }, `${e.emoji ? e.emoji + ' ' : ''}${e.name}`),
        e.place ? h('div', { class: 'cl-meta' }, `📍 ${e.place}`) : null));
  });
  openPanel(`Out in SF — ${evs.length} upcoming events`, h('div', { class: 'cl' }, ...rows));
}

// Full Hacker News front page in a panel (the /hn command; controller: Y).
async function showHackerNews() {
  openPanel('Hacker News — front page', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'reading the front page…')));
  const fetchJSON = (url) => fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  let stories = [];
  try {
    const ids = (await fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 15);
    stories = (await Promise.all(ids.map((id) =>
      fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null))))
      .filter((s) => s && s.title);
  } catch {
    return openPanel('Hacker News — front page', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'Hacker News is unavailable right now — try again shortly.')));
  }
  if (!stories.length) {
    return openPanel('Hacker News — front page', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'No stories right now.')));
  }
  const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'news.ycombinator.com'; } };
  const rows = stories.map((s, i) => h('div', {
    class: 'cl-row clickable',
    onclick: () => openReader(s.url || `https://news.ycombinator.com/item?id=${s.id}`, s.title),
  },
    h('div', { class: 'cl-id' }, String(i + 1)),
    h('div', { class: 'cl-main' },
      h('div', { class: 'cl-phrase' }, s.title),
      h('div', { class: 'cl-meta' }, `▲ ${s.score || 0} · 💬 ${s.descendants || 0} · ${domainOf(s.url)} · tap to read`))));
  openPanel(`Hacker News — top ${stories.length}`, h('div', { class: 'cl' }, ...rows));
}

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

// ---- Tuesday curb-trash alarm ----------------------------------------------
// A full-screen flashing-red takeover that runs ALL of Tuesday (from 07:00, once
// the day is up) until Wednesday 07:00 — local SF time — and PERSISTS until
// someone acknowledges it. This is the single, unmissable trash reminder (the old
// small clock pill was retired in favour of it). Acknowledgement
// is stamped with the alarm's Tuesday date in localStorage, so it stays dismissed
// for that week and re-arms automatically next Tuesday. (?alarmtest=1 forces it
// on for QA.) Hidden in screenshot mode so QA captures the dashboard itself.
const TRASH_ACK = 'garden.trashCurbAck';
function tzNow(parts) {
  const tz = (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...parts });
}
function alarmKey(now) {
  const wd = tzNow({ weekday: 'short' }).format(now);
  const hr = parseInt(tzNow({ hour: 'numeric', hour12: false }).format(now), 10);
  const dayOf = (d) => new Intl.DateTimeFormat('en-CA', {
    timeZone: (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  if (wd === 'Tue' && hr >= 7) return dayOf(now);                        // all Tuesday from 7AM
  if (wd === 'Wed' && hr < 7) return dayOf(new Date(now.getTime() - 864e5)); // before Wed 7AM → yesterday (Tue)
  return null;
}
function refreshTrashAlarm() {
  const el = document.getElementById('trashalarm');
  if (!el) return;
  const key = qs.has('alarmtest') ? 'test' : alarmKey(new Date());
  let acked = false;
  try { acked = !!key && localStorage.getItem(TRASH_ACK) === key; } catch { /* ignore */ }
  const show = !!key && !acked && !SCREENSHOT;
  el._key = key;
  el.classList.toggle('on', show);
  el.setAttribute('aria-hidden', show ? 'false' : 'true');
}
function wireTrashAlarm() {
  document.getElementById('trashAck')?.addEventListener('click', () => {
    const el = document.getElementById('trashalarm');
    try { if (el && el._key) localStorage.setItem(TRASH_ACK, el._key); } catch { /* ignore */ }
    refreshTrashAlarm();
    toast('Thanks — trash acknowledged 🗑');
  });
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
function wireStreetAlarm() {
  document.getElementById('streetAck')?.addEventListener('click', () => {
    const el = document.getElementById('streetalarm');
    try { if (el && el._key) localStorage.setItem(STREET_ACK, el._key); } catch { /* ignore */ }
    refreshStreetAlarm();
    toast('Thanks — car moved 🚗');
  });
  refreshStreetAlarm();
  setInterval(refreshStreetAlarm, 30000);
}

// ---- slash-command registry + palette ---------------------------------------
// One source of truth for every /command: the submit dispatcher and the
// Claude-Code-style autocomplete palette both read from here.
const COMMANDS = [
  { cmd: 'help', aliases: ['?'], icon: '🌿', desc: 'how the garden works' , run: () => showHelp() },
  { cmd: 'iterations', aliases: ['changelog'], icon: '❀', desc: 'changelog — how the garden has grown', run: () => showIterations() },
  { cmd: 'notes', aliases: ['planted'], icon: '🌱', desc: 'recently planted notes', run: () => showNotes() },
  { cmd: 'events', aliases: ['e'], icon: '🎉', desc: 'all upcoming SF events', run: () => showEvents() },
  { cmd: 'hn', aliases: ['hackernews'], icon: '📰', desc: 'Hacker News front page', run: () => showHackerNews() },
  { cmd: 'controls', aliases: ['controller', 'pad'], icon: '🎮', desc: 'controller button map', run: () => showPadMap() },
  { cmd: 'fps', aliases: ['fpstest'], icon: '⏱', desc: 'run the 60fps render test', run: () => runFpsTest() },
  { cmd: 'architecture', aliases: ['arch'], icon: '🛠', desc: 'how this system is built', run: () => showArchitecture() },
  { cmd: 'night', aliases: ['sleep', 'dim'], icon: '🌙', desc: 'toggle the night veil', run: () => toggleNight() },
  { cmd: 'refresh', aliases: ['reload'], icon: '🔃', desc: 'reload the garden', run: () => { toast('Refreshing the garden…'); setTimeout(() => location.reload(), 250); } },
];

let palEl = null, palMatches = [], palSel = 0;
function ensurePalette() {
  if (palEl) return palEl;
  palEl = h('div', { id: 'cmdpal', hidden: true });
  (document.getElementById('zoomroot') || document.body).appendChild(palEl); // scales with the page
  return palEl;
}
function hidePalette() { if (palEl) { palEl.hidden = true; } palMatches = []; palSel = 0; }
function paletteOpen() { return !!palEl && !palEl.hidden && palMatches.length > 0; }

// Show/filter the palette for the current input value. Visible only while the
// value is a bare "/fragment" (no spaces) — exactly like a command box.
function updatePalette(input) {
  const v = input.value;
  const m = /^\/([a-z?]*)$/i.exec(v.trim());
  if (!m || document.body.classList.contains('night')) { hidePalette(); return; }
  const frag = m[1].toLowerCase();
  palMatches = COMMANDS.filter((c) => c.cmd.startsWith(frag) || c.aliases.some((a) => a.startsWith(frag)));
  if (!palMatches.length) { hidePalette(); return; }
  palSel = Math.min(palSel, palMatches.length - 1);
  const el = ensurePalette();
  el.replaceChildren(...palMatches.map((c, i) => h('div', {
    class: 'cp-row' + (i === palSel ? ' sel' : ''),
    onmousedown: (ev) => { ev.preventDefault(); runPaletteCmd(input, c); }, // mousedown: beat the blur
  },
    h('span', { class: 'cp-ic' }, c.icon),
    h('code', { class: 'cp-cmd' }, '/' + c.cmd),
    c.aliases.length ? h('span', { class: 'cp-alias' }, c.aliases.map((a) => '/' + a).join(' ')) : null,
    h('span', { class: 'cp-desc' }, c.desc))));
  el.hidden = false;
}
function runPaletteCmd(input, c) {
  input.value = '';
  hidePalette();
  c.run();
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
    else if (e.key === 'Tab') { e.preventDefault(); input.value = '/' + palMatches[palSel].cmd; updatePalette(input); }
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
let focusIdx = -1, focusClearT = 0;
function focusCards() { return [...document.querySelectorAll('#garden > .card[data-wid]')]; }
function setFocus(i) {
  const cards = focusCards();
  if (!cards.length) return;
  focusIdx = Math.max(-1, Math.min(cards.length - 1, i));
  cards.forEach((c, k) => c.classList.toggle('focused', k === focusIdx));
  clearTimeout(focusClearT);
  if (focusIdx >= 0) focusClearT = setTimeout(() => setFocus(-1), 14000); // fade after idle
}
function moveFocus(delta) {
  if (panelOpen() || paletteOpen()) return;
  setFocus(focusIdx < 0 ? 0 : focusIdx + delta);
}
function openFocusedWidget() {
  const card = focusCards()[focusIdx];
  if (!card) return false;
  openWidgetPanel(card.dataset.wid);
  return true;
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
  openPanel('Roots — log a chore', h('div', { class: 'cl' }, h('div', { class: 'cl-empty' }, 'loading…')));
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
      h('button', { class: 'rc-chip' + (u.name === rootsLogWho ? ' on' : ''), type: 'button',
        onclick: () => { rootsLogWho = u.name; render(); } }, u.name)));
    const ptOf = (k) => (k === 'curb' || k === 'vacuum') ? 2 : 1; // matches the API's scoring
    const grid = h('div', { class: 'rc-grid' }, ...chores.filter((c) => !c.freeText).map((c) =>
      h('button', { class: 'rc-chore' + (picked.has(c.key) ? ' on' : ''), type: 'button',
        onclick: () => { picked.has(c.key) ? picked.delete(c.key) : picked.add(c.key); render(); } },
        h('span', { class: 'rc-lbl' }, c.label), h('span', { class: 'rc-pt' }, `+${ptOf(c.key)}`))));
    const n = picked.size;
    const logBtn = h('button', { class: 'rc-log', type: 'button', disabled: !n || !rootsLogWho,
      onclick: doLog }, n ? `Log ${n} chore${n === 1 ? '' : 's'}` : 'Pick chores to log');
    const top = (status?.day || []).slice(0, 3)
      .map((r, i) => h('span', { class: 'rc-rank' }, `${i + 1} ${r.name} ${r.points}`));
    body.replaceChildren(
      h('div', { class: 'rc-sec' }, 'WHO'), who,
      h('div', { class: 'rc-sec' }, 'CHORES'), grid,
      logBtn,
      top.length ? h('div', { class: 'rc-board' }, h('span', { class: 'rc-sec' }, 'TODAY'), ...top) : null);
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
  const kids = [
    h('div', { class: 'evd-name' }, `${e.emoji ? e.emoji + ' ' : ''}${e.name}`),
    h('div', { class: 'evd-meta' }, when),
    e.placeFull ? h('div', { class: 'evd-meta' }, e.placeFull) : null,
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
    class: 'rd-frame',
    sandbox: 'allow-same-origin', // render + style + load assets; NO scripts, NO navigation
    src: `/api/readable?raw=1&url=${encodeURIComponent(url)}`,
    referrerpolicy: 'no-referrer', loading: 'eager', title: title || 'article',
  });
  frame.addEventListener('error', () => {
    const qr = `/api/proxy?url=${encodeURIComponent(`https://quickchart.io/qr?text=${encodeURIComponent(url)}&dark=eafff4&light=00000000&ecLevel=M&margin=1&size=200&format=png`)}`;
    box.replaceChildren(h('div', { class: 'cl-empty' }, 'Couldn’t load this page — scan to read it on your phone.'),
      h('div', { class: 'evd-qr' }, h('img', { src: qr, alt: 'article link' })));
  });
  const box = h('div', { class: 'reader-frame-wrap' },
    h('div', { class: 'rd-src' }, host || 'reading'), frame);
  openSubPanel(title || 'Reading…', box);
  document.getElementById('panelBody')?.classList.add('reading'); // panel stops scrolling; iframe scrolls
}

// ---- unified panel-row selection --------------------------------------------
// A panel that lists .clickable rows (events, Hacker News) is navigable: up/down
// move a highlighted row, and "select" ACTIVATES it by calling .click() — the
// EXACT same path as a mouse tap, so controller and pointer share one behavior.
// Used by both the SSE controller bridge and the keyboard.
function panelRows() {
  const pb = document.getElementById('panelBody');
  return pb ? [...pb.querySelectorAll('.cl-row.clickable')] : [];
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
  const apply = (action) => {
    // A running game OVERWRITES all control mappings except 'back' (L2/Esc).
    if (window.__GARDEN_GAME) {
      if (action === 'back') { closePanel(); return; }
      try { window.__GARDEN_GAME.input(action); } catch { /* ignore */ }
      return;
    }
    const pal = paletteOpen();
    switch (action) {
      case 'palette':
        if (pal) { hidePalette(); break; }
        if (panelOpen()) closePanel();
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
        } else if (panelOpen()) {
          // a panel with rows → MOVE THE SELECTION (left/right too); else scroll.
          if (!movePanelRow(delta)) panelScrollBy(delta * 160);
        } else {
          moveFocus(delta); // on the wall → move the widget highlight (d-pad or stick)
        }
        break;
      }
      case 'ok': // A — unified "select/press"
        if (pal && palMatches[palSel]) runPaletteCmd(input, palMatches[palSel]);
        else if (panelOpen()) activatePanelRow();      // click the selected row (== mouse tap)
        else if (!openFocusedWidget()) { /* nothing focused */ }
        break;
      case 'fup': moveFocus(-1); break;
      case 'fdown': moveFocus(+1); break;
      case 'fleft': moveFocus(-1); break;
      case 'fright': moveFocus(+1); break;
      case 'fopen':
        if (pal) break;
        if (panelOpen()) activatePanelRow(); else openFocusedWidget();
        break;
      case 'events':
        if (pal) { hidePalette(); if (input) input.value = ''; }
        showEvents();
        break;
      case 'hn':
        if (pal) { hidePalette(); if (input) input.value = ''; }
        showHackerNews();
        break;
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
  const connect = () => {
    const es = new EventSource('/api/pad/stream');
    es.onmessage = (e) => { try { apply(JSON.parse(e.data).action); } catch { /* ignore */ } };
    es.onerror = () => { es.close(); setTimeout(connect, 5000); }; // server restart → reconnect
  };
  connect();
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
    if (window.__GARDEN_GAME) return; // a running game handles its own keys
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Shift+T → trash shortcut. Only fires when the note field is empty, so a
    // capital T typed mid-note never toggles it (the requested no-typing-conflict).
    if (e.shiftKey && (e.key === 'T' || e.key === 't') && input.value.trim() === '') {
      e.preventDefault();
      const alarm = document.getElementById('trashalarm');
      if (alarm && alarm.classList.contains('on')) {
        document.getElementById('trashAck')?.click();                  // dismiss the active alarm
      } else if (alarm && alarm._key) {
        try { localStorage.removeItem(TRASH_ACK); } catch { /* ignore */ } // re-arm: bring it back today
        refreshTrashAlarm();
        toast('Trash reminder re-armed 🗑  (shift+T)');
      } else {
        toast('No trash reminder right now 🗑');
      }
      return;
    }
    if (window.__GARDEN_GAME) return; // a running game owns the keyboard
    if (document.activeElement && document.activeElement.isContentEditable) return; // hand-pruning in progress
    if (document.activeElement !== input && e.key.length === 1) focusInput();
  }, true);
  // Refocus if the field ever loses focus (kiosk: always ready to type).
  input.addEventListener('blur', () => setTimeout(() => {
    // Don't steal focus back while a panel is open or a hand-pruning edit is active.
    if (!panelOpen() && !(document.activeElement && document.activeElement.isContentEditable)) focusInput();
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (text[0] === '/') { // slash command, not feedback
      const cmd = text.slice(1).toLowerCase().split(/\s+/)[0];
      input.value = '';
      hidePalette();
      const found = COMMANDS.find((c) => c.cmd === cmd || c.aliases.includes(cmd));
      if (found) return found.run();
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
    hideT = setTimeout(() => { on = false; cur.classList.remove('on'); }, 2000);
  }, { passive: true });
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
setInterval(() => { wireCornerQr().catch(() => {}); }, 60000);

// The kiosk page must NEVER scroll: focusing the note bar auto-scrolls the root
// scroller over zoom-scaled content (even with overflow:hidden), exposing raw
// canvas. Pin it at the origin.
window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); }, { passive: true });

if (SCREENSHOT) document.body.classList.add('screenshot');
wireFeedback();
wireEditing(); // right-click hand-pruning of titles/labels
if (!SCREENSHOT) wirePad(); // controller bridge (skip in QA captures)
wireTrashAlarm();
wireStreetAlarm();
wireCursor();
wireCornerQr();
boot();
