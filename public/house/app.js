// Arbor — household app frontend (vanilla, no build, no deps).
// A separate, hand-maintained side project (the daily tending must NOT touch this).
// Three screens behind a bottom tab bar: Plant a Note · Community Macros · Dashboard.
'use strict';

const LS_USER = 'hearth.user'; // { id, name }
const TZ = 'America/Los_Angeles';

// ---- tiny helpers -----------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; n.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid))); }
  return n;
}
async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) { let detail = ''; try { detail = (await r.json()).error || ''; } catch { /* ignore */ } throw new Error(detail || ('HTTP ' + r.status)); }
  return r.json();
}
function fmtAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
function fmtClock(ts) { try { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(ts); } catch { return ''; } }

// ---- local user state -------------------------------------------------------
function getUser() { try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); } catch { return null; } }
function setUser(u) { try { localStorage.setItem(LS_USER, JSON.stringify(u)); } catch { /* ignore */ } currentUser = u; renderWho(); }
let currentUser = getUser();

function renderWho() {
  const w = $('#who');
  w.innerHTML = currentUser ? `cleaning as <b>${escapeHtml(currentUser.name)}</b>` : '';
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Deterministic per-person avatar: an initial + a hue derived from the name, so
// the same person always gets the same colored bubble across the leaderboard.
const AVATAR_HUES = [150, 168, 186, 42, 200, 128, 96, 18];
function avatarFor(name) {
  const n = String(name || '?').trim();
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return { initial: (n[0] || '?').toUpperCase(), bg: `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 28) % 360} 72% 52%))` };
}
// A charming empty state: emoji + line + optional sub-line.
function emptyState(emoji, line, sub) {
  return el('div', { class: 'empty' }, el('span', { class: 'emoji' }, emoji), el('span', {}, line), sub ? el('span', { class: 'sub' }, sub) : null);
}

// ---- tab navigation ---------------------------------------------------------
let activeSession = null; // {id, name} when this user is mid-clean
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.screen === name));
  if (name === 'macros') renderMacros();
  if (name === 'dash') refreshDashboard();
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));

// =============================================================================
// Screen 1 — Plant a Note
// =============================================================================
(function wireNote() {
  const t = $('#noteText'), btn = $('#noteSend'), msg = $('#noteMsg'), count = $('#noteCount');
  const max = parseInt(t.getAttribute('maxlength') || '500', 10);
  const updateCount = () => { if (count) count.textContent = (max - t.value.length) + ' left'; };
  t.addEventListener('input', updateCount); updateCount();
  btn.addEventListener('click', async () => {
    const text = t.value.trim();
    if (!text) { t.focus(); return; }
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Planting…';
    try {
      await api('/api/feedback', { method: 'POST', body: JSON.stringify({ text }) });
      t.value = ''; updateCount(); msg.className = 'msg ok'; msg.textContent = 'Planted 🌱  the Gardener will tend to it.';
    } catch {
      msg.className = 'msg err'; msg.textContent = 'Could not reach the Gardener — try again.';
    } finally { btn.disabled = false; }
  });
})();

// =============================================================================
// Screen 2 — Community Macros (identity → Start Clean Mode → checklist)
// =============================================================================
let CHORES = [];
async function loadChores() { if (CHORES.length) return CHORES; try { CHORES = (await api('/api/house/chores')).chores; } catch { /* ignore */ } return CHORES; }

async function renderMacros() {
  await loadChores();
  const idCard = $('#identityCard'), area = $('#macrosArea');
  if (currentUser) { idCard.hidden = true; area.hidden = false; }
  else { idCard.hidden = false; area.hidden = true; await renderNamePicker(); return; }
  await refreshActiveState();
  refreshNotifyUi();
}

async function renderNamePicker() {
  const grid = $('#nameGrid');
  grid.replaceChildren(el('span', { class: 'muted' }, 'loading names…'));
  let users = [];
  try { users = (await api('/api/house/users')).users; } catch { /* offline */ }
  grid.replaceChildren(...(users.length ? users.map((u) =>
    el('button', { class: 'chip', type: 'button', onclick: () => pickName(u.name) }, u.name))
    : [el('span', { class: 'muted' }, 'No one yet — be the first below.')]));
}
async function pickName(name) {
  const msg = $('#nameMsg'); msg.className = 'msg'; msg.textContent = 'Saving…';
  try {
    const { user } = await api('/api/house/users', { method: 'POST', body: JSON.stringify({ name }) });
    setUser({ id: user.id, name: user.name });
    msg.textContent = '';
    renderMacros();
  } catch (e) { msg.className = 'msg err'; msg.textContent = e.message || 'Could not save name.'; }
}
$('#addName').addEventListener('click', () => { const v = $('#newName').value.trim(); if (v) { $('#newName').value = ''; pickName(v); } });
$('#newName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addName').click(); });

$('#startClean').addEventListener('click', async () => {
  if (!currentUser) return;
  const m = $('#startClean'); m.style.pointerEvents = 'none';
  try {
    const { session } = await api('/api/house/session/start', { method: 'POST', body: JSON.stringify({ userId: currentUser.id, name: currentUser.name }) });
    activeSession = { id: session.id, name: currentUser.name };
    await refreshActiveState();
    openSession();
  } catch (e) { alert(e.message || 'Could not start clean mode.'); }
  finally { m.style.pointerEvents = ''; }
});

// Find this user's currently-open session (so a reload re-enters it).
async function refreshActiveState() {
  const wrap = $('#activeArea');
  let status = null;
  try { status = await api('/api/house/status'); } catch { /* offline */ }
  const mine = status && currentUser ? status.cleaning.find((c) => c.name === currentUser.name) : null;
  activeSession = mine ? { id: mine.sessionId, name: mine.name } : (activeSession && status && status.cleaning.some((c) => c.sessionId === activeSession.id) ? activeSession : null);
  if (activeSession) {
    wrap.replaceChildren(el('div', { class: 'active-banner', onclick: openSession },
      el('span', { class: 'pulse' }),
      el('span', { class: 'at', html: `You're in <b>Clean Mode</b> — tap to check off chores` }),
      el('span', { class: 'arrow' }, '›')));
  } else { wrap.replaceChildren(); $('#sessionArea').replaceChildren(); }
}

// The checklist is a SELECTION, not a log. Tapping toggles a chore on/off;
// nothing is written until the user presses Confirm, which batch-logs everything
// in one request and fires ONE summary notification. After confirming we offer
// an Undo for that batch, and a persistent "Clear my activity today" reset.
let sessionOpen = false;
async function openSession() {
  if (!activeSession) return;
  sessionOpen = true;
  await loadChores();
  const area = $('#sessionArea');

  const selected = new Set();        // chore keys currently toggled on
  let otherNote = '';                // free-text "other" value (counts if non-empty)
  let lastBatchIds = [];             // ids from the most recent confirm (for Undo)

  const list = el('div', { class: 'checklist' });
  const rows = new Map();
  for (const ch of CHORES) {
    if (ch.freeText) {
      const inp = el('input', { type: 'text', maxlength: '120', placeholder: 'What else did you do?' });
      inp.addEventListener('input', () => { otherNote = inp.value.trim(); updateConfirm(); });
      list.appendChild(el('div', { class: 'check other' },
        el('span', { class: 'emoji' }, ch.emoji), el('span', { class: 'label' }, ch.label),
        el('div', { class: 'otherwrap' }, inp)));
      continue;
    }
    const row = el('div', { class: 'check', role: 'button', 'aria-pressed': 'false' },
      el('span', { class: 'box' }, ''),
      el('span', { class: 'emoji' }, ch.emoji),
      el('span', { class: 'label' }, ch.label));
    row.addEventListener('click', () => {
      const on = selected.has(ch.key);
      if (on) { selected.delete(ch.key); row.classList.remove('done'); row.setAttribute('aria-pressed', 'false'); $('.box', row).textContent = ''; }
      else { selected.add(ch.key); row.classList.add('done'); row.setAttribute('aria-pressed', 'true'); $('.box', row).textContent = '✓'; }
      updateConfirm();
    });
    rows.set(ch.key, row);
    list.appendChild(row);
  }

  const confirm = el('button', { class: 'primary', type: 'button', disabled: true }, 'Log these ✓');
  const confirmMsg = el('div', { class: 'msg', role: 'status' });
  const selCount = () => selected.size + (otherNote ? 1 : 0);
  function updateConfirm() {
    const n = selCount();
    confirm.disabled = n === 0;
    confirm.textContent = n === 0 ? 'Log these ✓' : `Log ${n} ${n === 1 ? 'chore' : 'chores'} ✓`;
  }
  function clearSelection() {
    selected.clear(); otherNote = '';
    for (const row of rows.values()) { row.classList.remove('done'); row.setAttribute('aria-pressed', 'false'); $('.box', row).textContent = ''; }
    const inp = $('.check.other input', list); if (inp) inp.value = '';
    updateConfirm();
  }
  confirm.addEventListener('click', async () => {
    const chores = [...selected].map((key) => ({ chore: key }));
    if (otherNote) chores.push({ chore: 'other', note: otherNote });
    if (!chores.length) return;
    confirm.disabled = true; confirmMsg.className = 'msg'; confirmMsg.textContent = 'Logging…';
    try {
      const r = await api('/api/house/chores', { method: 'POST', body: JSON.stringify({ userId: currentUser.id, name: currentUser.name, sessionId: activeSession ? activeSession.id : null, chores }) });
      lastBatchIds = r.ids || [];
      const n = r.count || chores.length;
      clearSelection();
      confirmMsg.className = 'msg ok';
      confirmMsg.replaceChildren(el('span', {}, `Logged ${n} ${n === 1 ? 'chore' : 'chores'} ✓  `),
        lastBatchIds.length ? el('button', { class: 'linkbtn', type: 'button', onclick: undoLast }, 'Undo') : null);
    } catch (e) {
      confirmMsg.className = 'msg err'; confirmMsg.textContent = e.message || 'Could not log — try again.';
    } finally { updateConfirm(); }
  });
  async function undoLast() {
    if (!lastBatchIds.length) return;
    confirmMsg.className = 'msg'; confirmMsg.textContent = 'Undoing…';
    try {
      await api('/api/house/chores/undo', { method: 'POST', body: JSON.stringify({ userId: currentUser.id, name: currentUser.name, scope: 'batch', ids: lastBatchIds }) });
      lastBatchIds = [];
      confirmMsg.className = 'msg'; confirmMsg.textContent = 'Undone.';
    } catch (e) { confirmMsg.className = 'msg err'; confirmMsg.textContent = e.message || 'Could not undo.'; }
  }

  const clearToday = el('button', { class: 'ghost', type: 'button' }, 'Clear my activity today');
  clearToday.addEventListener('click', async () => {
    if (!window.confirm('Remove ALL of your logged chores from today? This resets your points.')) return;
    clearToday.disabled = true;
    try {
      const r = await api('/api/house/chores/undo', { method: 'POST', body: JSON.stringify({ userId: currentUser.id, name: currentUser.name, scope: 'today' }) });
      lastBatchIds = [];
      confirmMsg.className = 'msg ok'; confirmMsg.textContent = r.removed ? `Cleared ${r.removed} ${r.removed === 1 ? 'chore' : 'chores'} from today.` : 'Nothing logged today.';
    } catch (e) { confirmMsg.className = 'msg err'; confirmMsg.textContent = e.message || 'Could not clear.'; }
    finally { clearToday.disabled = false; }
  });

  const end = el('button', { class: 'ghost', type: 'button' }, 'End cleaning session');
  end.addEventListener('click', async () => {
    end.disabled = true;
    try { await api('/api/house/session/end', { method: 'POST', body: JSON.stringify({ sessionId: activeSession.id }) }); activeSession = null; sessionOpen = false; area.replaceChildren(); await refreshActiveState(); }
    catch (e) { end.disabled = false; alert(e.message); }
  });

  updateConfirm();
  area.replaceChildren(el('div', { class: 'card' },
    el('h2', {}, '✅ What did you do?'),
    el('p', { class: 'lead', style: 'margin-bottom:14px' }, 'Check off everything you finished, then press Confirm. Tap a chore again to deselect it.'),
    list,
    el('div', { style: 'height:14px' }), confirm, confirmMsg,
    el('div', { class: 'session-actions' }, clearToday, end)));
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// =============================================================================
// Web Push — phone notifications (works with the app CLOSED).
// Android Chrome subscribes directly. iOS (16.4+) only allows web push once the
// site is "Added to Home Screen" as a PWA and opened from that icon — until then
// the browser exposes no PushManager / permission, so we show the install hint.
// HTTPS is required: phones MUST open the tunnel URL (https), not localhost.
// =============================================================================
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// Detect an iOS device viewing in Safari (not yet installed as a PWA).
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

let swReg = null;
async function ensureSW() {
  if (!('serviceWorker' in navigator)) return null;
  if (swReg) return swReg;
  try { swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch { swReg = null; }
  return swReg;
}
// Register the SW eagerly (so the PWA is installable) — harmless if push is unused.
ensureSW();

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function setNotifyMsg(text, kind) { const m = $('#notifyMsg'); if (!m) return; m.className = 'msg' + (kind ? ' ' + kind : ''); m.textContent = text || ''; }

// Reflect the current subscription/permission state in the Macros notify card.
async function refreshNotifyUi() {
  const card = $('#notifyCard'); if (!card) return;
  const btn = $('#notifyBtn'); const hint = $('#notifyHint');
  hint.style.display = 'none'; hint.textContent = '';
  if (!pushSupported()) {
    // On iOS Safari, PushManager only appears inside an installed PWA.
    if (isIOS() && !isStandalone()) {
      btn.disabled = true; btn.textContent = 'Add to Home Screen first';
      hint.style.display = 'block';
      hint.textContent = 'On iPhone/iPad: tap the Share button, then “Add to Home Screen”, and open Arbor from that icon to enable notifications (iOS 16.4+).';
      setNotifyMsg('');
    } else {
      btn.disabled = true; btn.textContent = 'Notifications not supported';
      setNotifyMsg('This browser can’t do web push. Open Arbor in Chrome (Android) or an installed PWA (iOS).', 'err');
    }
    return;
  }
  btn.disabled = false;
  if (Notification.permission === 'denied') {
    btn.textContent = 'Notifications blocked';
    setNotifyMsg('Notifications are blocked in your browser settings — re-enable them for this site to opt in.', 'err');
    return;
  }
  const reg = await ensureSW();
  let sub = null; try { sub = reg && (await reg.pushManager.getSubscription()); } catch { /* ignore */ }
  if (sub) {
    btn.textContent = 'Disable notifications';
    setNotifyMsg('You’ll get a push when someone cleans or logs a chore. ✓', 'ok');
  } else {
    btn.textContent = 'Enable notifications 🔔';
    setNotifyMsg('');
  }
}

async function enableNotifications() {
  const reg = await ensureSW();
  if (!reg) { setNotifyMsg('Could not start the notification worker. Make sure you opened the https tunnel URL.', 'err'); return; }
  setNotifyMsg('Requesting permission…');
  let perm;
  try { perm = await Notification.requestPermission(); } catch { perm = Notification.permission; }
  if (perm !== 'granted') { setNotifyMsg(perm === 'denied' ? 'Permission denied — enable it in your browser settings to opt in.' : 'Permission was not granted.', 'err'); refreshNotifyUi(); return; }
  setNotifyMsg('Subscribing…');
  try {
    const { publicKey } = await api('/api/house/vapid-public');
    if (!publicKey) throw new Error('push not configured on the server');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await api('/api/house/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), userId: currentUser && currentUser.id, name: currentUser && currentUser.name }) });
    setNotifyMsg('Notifications on — you’ll be pinged when the house gets tidy. ✓', 'ok');
  } catch (e) {
    setNotifyMsg(e.message || 'Could not subscribe — try again.', 'err');
  }
  refreshNotifyUi();
}

async function disableNotifications() {
  const reg = await ensureSW();
  setNotifyMsg('Turning off…');
  try {
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      try { await api('/api/house/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch { /* server prune is best-effort */ }
      await sub.unsubscribe();
    }
    setNotifyMsg('Notifications off.', 'ok');
  } catch (e) { setNotifyMsg(e.message || 'Could not turn off.', 'err'); }
  refreshNotifyUi();
}

(function wireNotify() {
  const btn = $('#notifyBtn'); if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const reg = await ensureSW();
    let sub = null; try { sub = reg && (await reg.pushManager.getSubscription()); } catch { /* ignore */ }
    try { if (sub) await disableNotifications(); else await enableNotifications(); }
    finally { btn.disabled = false; }
  });
})();

// =============================================================================
// Screen 3 — Dashboard (leaderboard + day/week toggle + activity + notifs)
// =============================================================================
let range = 'day';
$$('#rangeToggle button').forEach((b) => b.addEventListener('click', () => {
  range = b.dataset.range;
  $$('#rangeToggle button').forEach((x) => x.classList.toggle('on', x === b));
  $('#rangeNote').textContent = range === 'day' ? 'Today (since midnight, PT)' : 'Last 7 days';
  refreshDashboard();
}));

async function refreshDashboard() {
  let status = null;
  try { status = await api('/api/house/status'); } catch { renderEmptyDash(); return; }
  // Leaderboard — ranked rows with medals, colored avatars, point pills.
  const board = (range === 'day' ? status.day : status.week);
  const list = $('#rankList');
  const medals = ['🥇', '🥈', '🥉'];
  list.replaceChildren(...(board.length ? board.map((p, i) => {
    const av = avatarFor(p.name);
    return el('div', { class: 'rank' + (i === 0 ? ' top' : '') },
      el('div', { class: 'pos' + (i < 3 ? ' medal' : '') }, i < 3 ? medals[i] : String(i + 1)),
      el('div', { class: 'av', style: `background:${av.bg}` }, av.initial),
      el('div', { class: 'nm' }, p.name, el('small', {}, `${p.chores} ${p.chores === 1 ? 'chore' : 'chores'} · last ${fmtAgo(p.lastTs)}`)),
      el('div', { class: 'pts' }, String(p.points), el('small', {}, 'pts')));
  }) : [emptyState('🧺', range === 'day' ? 'No chores logged today yet.' : 'No chores logged this week yet.', 'Start Clean Mode to get on the board.')]));

  // Cleaning now
  const now = $('#cleaningNow');
  now.replaceChildren(...(status.cleaning.length ? status.cleaning.map((c) =>
    el('div', { class: 'pill' }, el('span', { class: 'pulse' }),
      el('span', { html: `<b>${escapeHtml(c.name)}</b> is cleaning <small>· since ${fmtClock(c.startedAt)}</small>` })))
    : [emptyState('🛋️', 'Nobody is cleaning right now.', 'The house is at rest.')]));

  // Activity feed
  const feed = $('#activityFeed');
  feed.replaceChildren(...(status.activity.length ? status.activity.map((a) => {
    const def = (CHORES.find((c) => c.key === a.chore)) || { emoji: '•', label: a.chore };
    const what = a.chore === 'other' && a.note ? a.note : def.label;
    return el('div', { class: 'row' }, el('span', { class: 'e' }, def.emoji),
      el('span', { class: 'txt', html: `<b>${escapeHtml(a.name)}</b> — ${escapeHtml(what)}` }, el('small', {}, fmtAgo(a.ts))));
  }) : [emptyState('🌙', 'No activity yet.', 'Logged chores will show up here.')]));

  // Notifications
  const nf = $('#notifFeed');
  nf.replaceChildren(...(status.notifications.length ? status.notifications.map((n) =>
    el('div', { class: 'row' }, el('span', { class: 'e' }, '🔔'),
      el('span', { class: 'txt' }, n.text, el('small', {}, fmtAgo(n.ts)))))
    : [emptyState('🔕', 'No notifications yet.', 'Household pings will appear here.')]));

  updateMacroBadge(status);
}
function renderEmptyDash() {
  $('#rankList').replaceChildren(emptyState('📡', 'Could not reach the household.', 'Check your connection and try again.'));
}
// Surface a dot on the Macros tab when someone (else) is cleaning.
function updateMacroBadge(status) {
  const btn = $('.tabbar button[data-screen=macros]');
  const others = status.cleaning.filter((c) => !currentUser || c.name !== currentUser.name);
  let dot = $('.dot', btn);
  if (others.length) { if (!dot) btn.appendChild(el('span', { class: 'dot' })); }
  else if (dot) dot.remove();
}

// ---- boot + live refresh ----------------------------------------------------
renderWho();
showScreen('dash');
loadChores();
// Poll for live "currently cleaning" + leaderboard updates while the app is open.
setInterval(() => {
  const dashActive = $('#screen-dash').classList.contains('active');
  if (dashActive) refreshDashboard();
  else api('/api/house/status').then(updateMacroBadge).catch(() => {});
  // Keep the macros active-banner in sync if that screen is showing.
  if ($('#screen-macros').classList.contains('active') && currentUser && !sessionOpen) refreshActiveState();
}, 7000);
