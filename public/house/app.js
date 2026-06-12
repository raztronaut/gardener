// Roots — household app frontend (vanilla, no build, no deps).
// A separate, hand-maintained side project (the daily tending must NOT touch this).
// Five screens behind a bottom tab bar:
// Plant a Note · Community Macros · Dashboard · Wall (live) · You (account).
'use strict';

const LS_USER = 'hearth.user';   // { id, name }
const LS_TOKEN = 'hearth.token'; // opaque session token (sent as x-roots-token)
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
  const headers = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (tok) headers['x-roots-token'] = tok; // sessions enrich identity on every call
  const r = await fetch(path, { headers, ...opts });
  if (!r.ok) { let detail = ''; try { detail = (await r.json()).error || ''; } catch { /* ignore */ } const e = new Error(detail || ('HTTP ' + r.status)); e.status = r.status; throw e; }
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

// ---- login session (token in localStorage, identity from GET /api/house/me) --
function getToken() { try { return localStorage.getItem(LS_TOKEN) || ''; } catch { return ''; } }
function setToken(t) { try { t ? localStorage.setItem(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN); } catch { /* ignore */ } }
let currentSession = null; // { user, provider, email, picture } from /me
// Validate the stored token on boot. A dead token is silently dropped — the
// localStorage name identity keeps working exactly as before (backward compat).
async function loadMe() {
  if (!getToken()) { currentSession = null; return null; }
  try {
    currentSession = await api('/api/house/me');
    if (currentSession && currentSession.user) setUser({ id: currentSession.user.id, name: currentSession.user.name });
  } catch (e) {
    if (e.status === 401) setToken('');
    currentSession = null;
  }
  return currentSession;
}

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

// ---- avatars (preset specs + central renderer) ------------------------------
// The curated preset set — MUST stay in sync with AVATAR_PRESETS in
// src/house-api.mjs (the server validates writes against the same ids). Two
// kinds: gradient monograms (a fixed hue, the person's initial) and mint glyphs
// (an inline SVG stroke on a tinted disc). No images are stored server-side;
// everything here is rendered deterministically client-side. Emoji-free.
const GLYPH_PATHS = {
  leaf: 'M19 5c0 7-4.5 11-11 12 0-7 4.5-11 11-12ZM8 17c2-3 5-5.5 8-6.5',
  sprout: 'M12 20v-7.5M12 12.5C12 9.2 14.4 7 17.8 7c0 3.3-2.4 5.5-5.8 5.5ZM12 10.5C12 7.7 10 5.7 7 5.7 7 8.5 9 10.5 12 10.5Z',
  sun: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5Z',
  star: 'M12 4l2.3 5.2 5.7.5-4.3 3.8 1.3 5.5L12 16.7 7 19.3l1.3-5.5L4 10l5.7-.5Z',
  drop: 'M12 4.5c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9Z',
};
const AVATAR_PRESET_HUE = { 'hue-mint': 150, 'hue-teal': 186, 'hue-gold': 42, 'hue-rose': 350 };
// The picker's display order + labels (gradient monograms first, then glyphs).
const AVATAR_PRESETS = [
  { id: 'preset:hue-mint', kind: 'mono', label: 'Mint' },
  { id: 'preset:hue-teal', kind: 'mono', label: 'Teal' },
  { id: 'preset:hue-gold', kind: 'mono', label: 'Gold' },
  { id: 'preset:hue-rose', kind: 'mono', label: 'Rose' },
  { id: 'preset:leaf', kind: 'glyph', glyph: 'leaf', label: 'Leaf' },
  { id: 'preset:sprout', kind: 'glyph', glyph: 'sprout', label: 'Sprout' },
  { id: 'preset:sun', kind: 'glyph', glyph: 'sun', label: 'Sun' },
  { id: 'preset:moon', kind: 'glyph', glyph: 'moon', label: 'Moon' },
  { id: 'preset:star', kind: 'glyph', glyph: 'star', label: 'Star' },
  { id: 'preset:drop', kind: 'glyph', glyph: 'drop', label: 'Drop' },
];
const AVATAR_PRESET_BY_ID = new Map(AVATAR_PRESETS.map((p) => [p.id, p]));
function glyphSvg(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GLYPH_PATHS[name] || GLYPH_PATHS.leaf);
  svg.appendChild(path); return svg;
}
// THE central avatar renderer used by every surface (profile card, household,
// leaderboard, activity rows, preview). Resolves a person to an image or bubble:
//   1. avatarUrl (an UPLOADED photo, or a Google photo the server resolved) → <img>
//   2. a Google photo (googlePicture, when avatarUrl wasn't supplied)        → <img>
//   3. a dormant 'preset:<id>' spec (legacy rows only — no longer offered)   → glyph/mono
//   4. else                                                                  → colored-initial bubble
// `cls` is the base class (e.g. 'av' or 'avatar-lg'); extra classes append.
function renderAvatar(person, cls = 'av') {
  const name = (person && person.name) || '?';
  const avatar = person && person.avatar;
  // Prefer the server-resolved avatarUrl (uploaded photo > google photo). Fall
  // back to a bare googlePicture for any surface that doesn't supply avatarUrl.
  const url = (person && person.avatarUrl) || (person && person.googlePicture) || null;
  if (url) return el('img', { class: cls, src: url, alt: '', referrerpolicy: 'no-referrer' });
  // Legacy preset rows (the picker is gone, but old DB values still render).
  if (avatar && avatar.indexOf('preset:') === 0) {
    const spec = AVATAR_PRESET_BY_ID.get(avatar);
    if (spec && spec.kind === 'glyph') {
      const n = el('div', { class: cls + ' glyph' }); n.appendChild(glyphSvg(spec.glyph)); return n;
    }
    if (spec && spec.kind === 'mono') {
      const hue = AVATAR_PRESET_HUE[avatar.slice('preset:'.length)] || 150;
      const bg = `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 28) % 360} 72% 52%))`;
      return el('div', { class: cls, style: `background:${bg}` }, (String(name)[0] || '?').toUpperCase());
    }
  }
  const av = avatarFor(name);
  return el('div', { class: cls, style: `background:${av.bg}` }, av.initial);
}
// A quiet empty state: a line + optional mono sub-line (no emoji — the app
// mirrors the wall's strict no-emoji chrome).
function emptyState(line, sub) {
  return el('div', { class: 'empty' }, el('span', {}, line), sub ? el('span', { class: 'sub' }, sub) : null);
}
// Tiny inline SVG strokes for feed-row icons (UI chrome stays emoji-free).
const ICON_PATHS = {
  check: 'M5 12.5l4.2 4.3L19 7.2',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15ZM10.3 18.5a1.8 1.8 0 0 0 3.4 0',
};
function icon(name, size = 15) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.check);
  svg.appendChild(path);
  return svg;
}

// ---- tab navigation ---------------------------------------------------------
let activeSession = null; // {id, name} when this user is mid-clean
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.screen === name));
  if (name === 'wall') mountWall(); else parkWall(); // lazy iframe; kept warm 3 min
  if (name === 'macros') renderMacros();
  if (name === 'dash') refreshDashboard();
  if (name === 'you') renderYou();
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
      t.value = ''; updateCount(); msg.className = 'msg ok'; msg.textContent = 'Planted — the Gardener will tend to it.';
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
async function pickName(name, msgEl) {
  const msg = msgEl || $('#nameMsg'); msg.className = 'msg'; msg.textContent = 'Saving…';
  try {
    const r = await api('/api/house/users', { method: 'POST', body: JSON.stringify({ name }) });
    // Name pick/create is also a login: the server minted a session for this
    // device — keep its token so identity survives and writes carry it.
    if (r.token) { setToken(r.token); currentSession = r.session || null; }
    setUser({ id: r.user.id, name: r.user.name });
    msg.textContent = '';
    if ($('#screen-macros').classList.contains('active')) renderMacros();
    if ($('#screen-you').classList.contains('active')) renderYou();
  } catch (e) { msg.className = 'msg err'; msg.textContent = e.message || 'Could not save name.'; }
}
$('#addName').addEventListener('click', () => { const v = $('#newName').value.trim(); if (v) { $('#newName').value = ''; pickName(v); } });
$('#newName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addName').click(); });
$('#manageAccount').addEventListener('click', () => showScreen('you'));

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
        el('span', { class: 'label' }, ch.label),
        el('div', { class: 'otherwrap' }, inp)));
      continue;
    }
    const row = el('div', { class: 'check', role: 'button', 'aria-pressed': 'false' },
      el('span', { class: 'box' }, ''),
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
    el('h2', {}, 'What did you do?'),
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
      hint.textContent = 'On iPhone/iPad: tap the Share button, then “Add to Home Screen”, and open Roots from that icon to enable notifications (iOS 16.4+).';
      setNotifyMsg('');
    } else {
      btn.disabled = true; btn.textContent = 'Notifications not supported';
      setNotifyMsg('This browser can’t do web push. Open Roots in Chrome (Android) or an installed PWA (iOS).', 'err');
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
    btn.textContent = 'Enable notifications';
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
// Screen 4 — Wall (a live mirror of the wall dashboard)
// The iframe loads the REAL dashboard page (screenshot mode = no input bar or
// cursor) through the plant-server's read-only passthrough; the page self-polls
// and uses SSE, so it is inherently always in sync. Lazy-mounted on first open;
// on leaving the tab it is PARKED (hidden but alive) for 3 minutes so flipping
// back is instant — the initial boot costs ~20 tunnel round-trips, so tearing
// it down on every tab switch made re-opens painfully slow.
// =============================================================================
const WALL_W = 900, WALL_H = 1600;
const WALL_PARK_MS = 3 * 60 * 1000;
let wallFrame = null, wallParkTimer = null;
function mountWall() {
  const wrap = $('#wallWrap');
  if (!wrap) return;
  clearTimeout(wallParkTimer); wallParkTimer = null;
  if (!wallFrame) {
    // ?screenshot=1 must be on the IFRAME url too: the wall app reads its own
    // location.search to enter screenshot mode (hides the input bar + cursor).
    wallFrame = el('iframe', { class: 'wallframe', src: '/wall?screenshot=1', title: 'live wall dashboard' });
    wrap.replaceChildren(wallFrame);
  }
  wallFrame.style.visibility = '';
  requestAnimationFrame(sizeWall);
}
// Hide but keep warm; fully destroy only after the park window (battery/quota).
function parkWall() {
  if (!wallFrame) return;
  wallFrame.style.visibility = 'hidden';
  clearTimeout(wallParkTimer);
  wallParkTimer = setTimeout(() => { wallFrame?.remove(); wallFrame = null; }, WALL_PARK_MS);
}
// The 900×1600 page is scaled down to the card's width; the wrapper takes the
// scaled height so the screen scrolls naturally.
function sizeWall() {
  const wrap = $('#wallWrap');
  if (!wrap || !wallFrame) return;
  const scale = (wrap.clientWidth || 1) / WALL_W;
  wallFrame.style.transform = `scale(${scale})`;
  wrap.style.height = Math.round(WALL_H * scale) + 'px';
}
window.addEventListener('resize', sizeWall);

// =============================================================================
// Screen 5 — You (account: profile, optional Google sign-in, household, sign out)
// =============================================================================
let authConfig = null; // { googleClientId? } — probed once per app load
async function loadAuthConfig() {
  if (authConfig) return authConfig;
  try { authConfig = await api('/api/house/auth-config'); } catch { authConfig = {}; }
  return authConfig;
}

// =============================================================================
// Login gate — MANDATORY Google sign-in when configured.
// When auth-config returns a googleClientId, the whole app sits behind a
// full-screen gate until there's a valid /me session. When it returns {} (dev /
// unconfigured), the gate never shows and the classic name-login flow runs
// exactly as before — so an unconfigured install is never bricked.
// =============================================================================
function googleConfigured() { return !!(authConfig && authConfig.googleClientId); }
function showGate(show) {
  const gate = $('#loginGate');
  document.body.classList.toggle('gated', !!show);
  if (gate) gate.hidden = !show;
  if (show) renderGateButton();
}
function renderGateButton() {
  const host = $('#gateGsi'); const cid = authConfig && authConfig.googleClientId;
  if (!host || !cid) return;
  ensureGis(() => {
    try {
      window.google.accounts.id.initialize({ client_id: cid, callback: onGoogleCredential });
      window.google.accounts.id.renderButton(host, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
    } catch { host.textContent = 'Google sign-in could not load — reload the page.'; }
  });
}
// Boot auth: probe auth-config + validate any stored token, then decide whether
// to raise the gate (configured + no session) or let the app through.
async function bootAuth() {
  await loadAuthConfig();
  if (getToken()) { try { await loadMe(); } catch { /* ignore */ } }
  if (googleConfigured() && !currentSession) { showGate(true); return false; }
  showGate(false);
  return true;
}

async function renderYou() {
  await loadAuthConfig();
  if (getToken() && !currentSession) await loadMe();
  renderYouProfile();
  renderGoogleCard();
  refreshNotifyUi();
  renderHousehold();
}

function providerBadge(provider) {
  return el('span', { class: 'badge' + (provider === 'google' ? ' google' : '') },
    provider === 'google' ? 'Google' : 'name');
}

function renderYouProfile() {
  const body = $('#youBody');
  if (!currentUser) {
    // Signed out → the name picker IS the login (primary, always available).
    const msg = el('div', { class: 'msg', role: 'status' });
    const grid = el('div', { class: 'namegrid' }, el('span', { class: 'muted' }, 'loading names…'));
    api('/api/house/users').then(({ users }) => {
      grid.replaceChildren(...(users.length ? users.map((u) =>
        el('button', { class: 'chip', type: 'button', onclick: () => pickName(u.name, msg) }, u.name))
        : [el('span', { class: 'muted' }, 'No one yet — type your name below.')]));
    }).catch(() => grid.replaceChildren(el('span', { class: 'muted' }, 'Could not load names — check the connection.')));
    const inp = el('input', { type: 'text', maxlength: '40', placeholder: '…or type your name' });
    const add = el('button', { class: 'primary', type: 'button', onclick: () => { const v = inp.value.trim(); if (v) { inp.value = ''; pickName(v, msg); } } }, 'Add');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
    body.replaceChildren(
      el('p', { class: 'lead' }, 'Pick your name to sign in — that’s all it takes.'),
      grid, el('div', { class: 'namerow' }, inp, add), msg);
    return;
  }
  const provider = currentSession ? currentSession.provider : 'name';
  const email = currentSession && currentSession.email;
  // Resolve the current user's avatar from the live session (avatar spec +
  // google photo) — the same {avatar, googlePicture, name} shape every surface uses.
  const me = profilePerson();
  const avatar = renderAvatar(me, 'avatar-lg');
  avatar.id = 'profileAvatar'; // the uploader updates this preview in place

  // The name line is either a static display (with a pencil edit affordance) or
  // an inline editor (text field + Save/Cancel) when editing.
  const nameLine = el('div', { class: 'pname' });
  function showNameDisplay() {
    const pencil = el('button', { class: 'nameedit', type: 'button', title: 'Rename', 'aria-label': 'Rename' });
    pencil.appendChild(editIcon());
    pencil.addEventListener('click', showNameEditor);
    nameLine.replaceChildren(currentUser.name, providerBadge(provider), pencil);
  }
  function showNameEditor() {
    const inp = el('input', { type: 'text', maxlength: '24', value: currentUser.name });
    const save = el('button', { class: 'primary slim rsave', type: 'button' }, 'Save');
    const cancel = el('button', { class: 'ghost rcancel', type: 'button' }, 'Cancel');
    const row = el('div', { class: 'renamerow' }, inp, save, cancel);
    nameLine.replaceChildren(row);
    inp.focus(); inp.select();
    cancel.addEventListener('click', showNameDisplay);
    const submit = async () => {
      const next = inp.value.trim();
      if (!next) { inp.focus(); return; }
      if (next === currentUser.name) { showNameDisplay(); return; }
      save.disabled = true;
      const prev = currentUser.name;
      // Optimistic: reflect immediately, roll back + toast on error/409.
      setUser({ id: currentUser.id, name: next }); showNameDisplay();
      try {
        const r = await api('/api/house/profile/name', { method: 'POST', body: JSON.stringify({ name: next }) });
        if (r.session) currentSession = r.session;
        setUser({ id: r.user.id, name: r.user.name });
        showNameDisplay();
      } catch (e) {
        setUser({ id: currentUser.id, name: prev }); showNameDisplay();
        toast(e.status === 409 ? 'That name is already taken.' : (e.message || 'Could not rename.'), 'err');
      }
    };
    save.addEventListener('click', submit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') showNameDisplay(); });
  }
  showNameDisplay();

  body.replaceChildren(
    el('div', { class: 'profile' },
      avatar,
      el('div', { class: 'pmeta' },
        nameLine,
        el('div', { class: 'pemail' }, email || 'signed in on this device'))),
    renderAvatarUploader(),
    el('div', { style: 'height:14px' }),
    el('button', { class: 'ghost', type: 'button', onclick: doSignOut }, 'Sign out'));
}

// The current user as the {avatar, googlePicture, name} shape renderAvatar wants.
function profilePerson() {
  return {
    name: currentUser ? currentUser.name : '?',
    avatar: currentSession ? currentSession.avatar : null,
    avatarUrl: currentSession ? currentSession.avatarUrl : null,
    googlePicture: currentSession ? (currentSession.googlePicture || currentSession.picture) : null,
  };
}
// A small pencil/edit glyph (inline SVG, emoji-free).
function editIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M14.5 6.5l3 3M4 20l1-3.5L16 5.5a1.6 1.6 0 0 1 2.3 0l.2.2a1.6 1.6 0 0 1 0 2.3L7.5 19 4 20Z');
  svg.appendChild(p); return svg;
}
// A tiny non-blocking toast (e.g. a 409 rename collision). One at a time.
let toastTimer = null;
function toast(text, kind) {
  let t = $('#rootsToast');
  if (!t) { t = el('div', { id: 'rootsToast' }); document.body.appendChild(t); }
  t.className = 'msg ' + (kind || ''); t.textContent = text;
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(var(--tabbar-h) + 22px);transform:translateX(-50%);z-index:60;'
    + 'background:rgba(4,16,12,.96);border:1px solid var(--stroke-strong);border-radius:999px;padding:10px 18px;max-width:90%;';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.remove(); }, 3200);
}

// The avatar UPLOADER (replaces the old preset grid — the user wants a REAL
// photo, not a template). A round preview + "Upload a photo" (a file input; the
// `capture` hint lets phones use the camera) + "Use my Google photo" (when one
// exists) + "Remove photo". On select we read the File, downscale + center-crop
// it to ~256×256 on a canvas, export JPEG ~0.85, and POST the data URL — the
// preview updates optimistically. The colored-initial bubble is the only
// non-photo fallback (no preset glyphs anywhere in the UI now).
const AV_TARGET = 256;        // exported square edge (px)
const AV_QUALITY = 0.85;      // JPEG/WebP quality
function renderAvatarUploader() {
  const me = profilePerson();
  const wrap = el('div', { class: 'avup' });
  wrap.appendChild(el('div', { class: 'avpicker-head' }, el('span', { class: 'lbl' }, 'Profile photo')));

  const preview = renderAvatar(me, 'avatar-lg'); preview.classList.add('avup-preview');
  const fileInput = el('input', { type: 'file', accept: 'image/*', capture: 'user', style: 'display:none' });
  const uploadBtn = el('button', { class: 'primary slim', type: 'button' }, 'Upload a photo');
  uploadBtn.addEventListener('click', () => fileInput.click());

  const actions = el('div', { class: 'avup-actions' });
  // "Use my Google photo" only when a Google photo is available to fall back to.
  if (me.googlePicture) {
    const gBtn = el('button', { class: 'ghost slim', type: 'button' }, 'Use my Google photo');
    gBtn.addEventListener('click', () => setNonPhotoAvatar('google', preview));
    actions.appendChild(gBtn);
  }
  // "Remove photo" only when there IS an uploaded photo to remove.
  if (me.avatar === 'upload') {
    const rmBtn = el('button', { class: 'ghost slim', type: 'button' }, 'Remove photo');
    rmBtn.addEventListener('click', () => setNonPhotoAvatar('remove', preview));
    actions.appendChild(rmBtn);
  }

  const msg = el('div', { class: 'msg', role: 'status' });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow re-selecting the same file
    if (f) uploadPhoto(f, preview, msg);
  });

  wrap.append(
    el('div', { class: 'avup-row' }, preview, el('div', { class: 'avup-ctl' }, uploadBtn, actions)),
    fileInput, msg);
  return wrap;
}

// Read → downscale + center-crop → export a small JPEG data URL → POST it.
async function uploadPhoto(file, preview, msg) {
  if (!/^image\//.test(file.type || '')) { msg.className = 'msg err'; msg.textContent = 'Pick an image file.'; return; }
  msg.className = 'msg'; msg.textContent = 'Resizing…';
  let dataUrl;
  try { dataUrl = await downscaleToDataUrl(file); }
  catch { msg.className = 'msg err'; msg.textContent = 'Could not read that image.'; return; }
  // Optimistic preview from the freshly-rendered local data URL.
  swapPreview(preview, el('img', { class: 'avatar-lg avup-preview', src: dataUrl, alt: '' }));
  msg.textContent = 'Uploading…';
  try {
    const r = await api('/api/house/profile/photo', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    if (r.session) currentSession = r.session;
    else if (currentSession) { currentSession.avatar = 'upload'; currentSession.avatarUrl = r.avatarUrl; }
    msg.className = 'msg ok'; msg.textContent = 'Photo updated.';
    renderYouProfile(); // re-render so the served URL + Remove button appear
  } catch (e) {
    renderYouProfile(); // roll back the optimistic preview to the real state
    toast(e.status === 413 ? 'That image is too large.' : (e.message || 'Could not upload photo.'), 'err');
  }
}

// Revert to a non-photo avatar: 'google' (use the Google photo) or 'remove'
// (drop the uploaded photo → google/bubble). Both go through /profile/avatar.
async function setNonPhotoAvatar(which, preview) {
  try {
    const r = await api('/api/house/profile/avatar', { method: 'POST', body: JSON.stringify({ avatar: which }) });
    if (r.session) currentSession = r.session;
    else if (currentSession) { currentSession.avatar = null; currentSession.avatarUrl = null; }
    renderYouProfile();
  } catch (e) { toast(e.message || 'Could not update avatar.', 'err'); }
}

// Swap the preview node in place (keeps id/classes the layout depends on).
function swapPreview(oldNode, newNode) {
  newNode.id = oldNode.id || 'profileAvatar';
  if (oldNode.parentNode) oldNode.parentNode.replaceChild(newNode, oldNode);
}

// Draw the image onto a square canvas, center-cropped + downscaled to AV_TARGET,
// and export it as a compact JPEG data URL (well under the server's 512 KB cap).
function downscaleToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
        const c = document.createElement('canvas');
        c.width = AV_TARGET; c.height = AV_TARGET;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AV_TARGET, AV_TARGET);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', AV_QUALITY));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

async function doSignOut() {
  try { if (getToken()) await api('/api/house/logout', { method: 'POST' }); } catch { /* best effort */ }
  setToken(''); currentSession = null;
  try { localStorage.removeItem(LS_USER); } catch { /* ignore */ }
  currentUser = null; renderWho();
  // When Google is the gate, signing out returns to it. Otherwise the You
  // profile card falls back to the classic name picker exactly as before.
  if (googleConfigured()) { showGate(true); }
  else renderYou();
}

// --- optional Google Sign-In (Google Identity Services) ----------------------
// GIS is loaded ONLY when the server says a client id is configured AND the
// Account screen is open. Unconfigured (today's reality): a quiet note instead.
function renderGoogleCard() {
  const card = $('#googleCard'), body = $('#googleBody');
  if (currentSession && currentSession.provider === 'google') { card.hidden = true; return; } // already linked
  card.hidden = false;
  const cid = authConfig && authConfig.googleClientId;
  if (!cid) {
    body.replaceChildren(el('p', { class: 'muted' }, 'Google sign-in activates at the permanent address once configured.'));
    return;
  }
  const host = el('div', { class: 'gsi-host' });
  body.replaceChildren(
    el('p', { class: 'lead' }, currentUser
      ? 'Sign in with Google to verify this device — your profile photo and email come along.'
      : 'Or sign in with your Google account.'),
    host);
  ensureGis(() => {
    try {
      window.google.accounts.id.initialize({ client_id: cid, callback: onGoogleCredential });
      window.google.accounts.id.renderButton(host, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
    } catch { host.textContent = 'Google sign-in could not load.'; }
  });
}
function ensureGis(cb) {
  if (window.google && window.google.accounts && window.google.accounts.id) { cb(); return; }
  let s = document.getElementById('gsiScript');
  if (!s) {
    s = el('script', { id: 'gsiScript', src: 'https://accounts.google.com/gsi/client', async: 'true', defer: 'true' });
    document.head.appendChild(s);
  }
  s.addEventListener('load', () => cb(), { once: true });
}
async function onGoogleCredential(resp) {
  // This callback fires both from the You-tab button and the boot gate, so we
  // surface errors into whichever message slot is on screen.
  const gated = document.body.classList.contains('gated');
  const errSlot = gated ? $('#gateMsg') : $('#googleBody');
  if (gated && errSlot) { errSlot.className = 'msg'; errSlot.textContent = 'Signing in…'; }
  try {
    const r = await api('/api/house/google-login', { method: 'POST', body: JSON.stringify({ credential: resp && resp.credential }) });
    setToken(r.token); currentSession = r.session || null;
    setUser({ id: r.user.id, name: r.user.name });
    if (gated) {
      // Successful sign-in dismisses the gate and reveals the app on the
      // default screen (You stays in sync via renderYou on its next open).
      showGate(false); renderWho();
      if (!$('.screen.active')) showScreen('dash'); else showScreen($('.screen.active').id.replace('screen-', ''));
    } else {
      renderYou();
    }
  } catch (e) {
    const msg = e.message || 'Google sign-in failed — try again.';
    if (gated) { if (errSlot) { errSlot.className = 'msg err'; errSlot.textContent = msg; } }
    else if ($('#googleBody')) $('#googleBody').appendChild(el('div', { class: 'msg err' }, msg));
  }
}

// --- household: every member + last activity, and signed-in devices ----------
async function renderHousehold() {
  const list = $('#householdList');
  let hh = null;
  try { hh = await api('/api/house/household'); }
  catch { list.replaceChildren(emptyState('Could not load the household.', 'Check your connection and try again.')); return; }
  // Latest app-session per user feeds into "last activity" alongside chores.
  const lastSeenByUser = new Map();
  for (const s of hh.sessions) {
    if ((lastSeenByUser.get(s.userId) || 0) < s.lastSeen) lastSeenByUser.set(s.userId, s.lastSeen);
  }
  const rows = hh.users.map((u) => {
    const lastTs = Math.max(u.lastChoreTs || 0, lastSeenByUser.get(u.id) || 0);
    const status = u.cleaningNow
      ? el('small', { class: 'now' }, 'cleaning now')
      : el('small', {}, lastTs ? 'active ' + fmtAgo(lastTs) : 'no activity yet');
    return el('div', { class: 'member' },
      renderAvatar(u, 'av'),
      el('div', { class: 'mn' }, u.name, status),
      currentUser && u.id === currentUser.id ? el('span', { class: 'youtag' }, 'you') : null);
  });
  const devHead = el('div', { class: 'subhead' }, 'Signed in on a device · last 30 days');
  const devs = hh.sessions.length ? hh.sessions.map((s) => el('div', { class: 'member dev' },
    renderAvatar({ name: s.name, avatar: null, googlePicture: s.picture }, 'av'),
    el('div', { class: 'mn' }, s.name,
      el('small', {}, (s.provider === 'google' && s.email ? s.email + ' · ' : '') + 'seen ' + fmtAgo(s.lastSeen))),
    providerBadge(s.provider)))
    : [el('div', { class: 'muted', style: 'padding:4px 0 2px' }, 'No app sessions yet.')];
  list.replaceChildren(
    ...(rows.length ? rows : [emptyState('No one in the household yet.', 'Pick a name above to be the first.')]),
    devHead, ...devs);
}

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
  // Leaderboard — ranked rows with plain mono numerals, colored avatars, point pills.
  const board = (range === 'day' ? status.day : status.week);
  const list = $('#rankList');
  list.replaceChildren(...(board.length ? board.map((p, i) => {
    return el('div', { class: 'rank' + (i === 0 ? ' top' : '') },
      el('div', { class: 'pos' }, String(i + 1)),
      renderAvatar(p, 'av'),
      el('div', { class: 'nm' }, p.name, el('small', {}, `${p.chores} ${p.chores === 1 ? 'chore' : 'chores'} · last ${fmtAgo(p.lastTs)}`)),
      el('div', { class: 'pts' }, String(p.points), el('small', {}, 'pts')));
  }) : [emptyState(range === 'day' ? 'No chores logged today yet.' : 'No chores logged this week yet.', 'Start Clean Mode to get on the board.')]));

  // Cleaning now
  const now = $('#cleaningNow');
  now.replaceChildren(...(status.cleaning.length ? status.cleaning.map((c) =>
    el('div', { class: 'pill' }, el('span', { class: 'pulse' }),
      el('span', { html: `<b>${escapeHtml(c.name)}</b> is cleaning <small>· since ${fmtClock(c.startedAt)}</small>` })))
    : [emptyState('Nobody is cleaning right now.', 'The house is at rest.')]));

  // Activity feed
  const feed = $('#activityFeed');
  feed.replaceChildren(...(status.activity.length ? status.activity.map((a) => {
    const def = (CHORES.find((c) => c.key === a.chore)) || { label: a.chore };
    const what = a.chore === 'other' && a.note ? a.note : def.label;
    // The row's leading mark is now the actor's avatar (avatar spec / google
    // photo / colored initial) — same shape every surface uses.
    const av = renderAvatar(a, 'e av');
    return el('div', { class: 'row' }, av,
      el('span', { class: 'txt', html: `<b>${escapeHtml(a.name)}</b> — ${escapeHtml(what)}` }, el('small', {}, fmtAgo(a.ts))));
  }) : [emptyState('No activity yet.', 'Logged chores will show up here.')]));

  // Notifications
  const nf = $('#notifFeed');
  nf.replaceChildren(...(status.notifications.length ? status.notifications.map((n) =>
    el('div', { class: 'row' }, el('span', { class: 'e' }, icon('bell')),
      el('span', { class: 'txt' }, n.text, el('small', {}, fmtAgo(n.ts)))))
    : [emptyState('No notifications yet.', 'Household pings will appear here.')]));

  updateMacroBadge(status);
}
function renderEmptyDash() {
  $('#rankList').replaceChildren(emptyState('Could not reach the household.', 'Check your connection and try again.'));
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
// Deep-link: /#note /#macros /#dash /#wall /#you open that screen (default: dash).
const bootScreen = ['note', 'macros', 'dash', 'wall', 'you'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dash';
// Boot auth FIRST: probe auth-config + validate any stored token. When Google
// is configured and there's no session, raise the gate and don't reveal a
// screen yet (onGoogleCredential opens one after a successful sign-in). When
// it's not configured, the gate stays down and everything works as before.
bootAuth().then((through) => {
  renderWho();
  if (!through) return; // gate is up; wait for sign-in
  showScreen(bootScreen);
  if ($('#screen-you').classList.contains('active')) renderYou();
}).catch(() => { showScreen(bootScreen); });
loadChores();
// Poll for live "currently cleaning" + leaderboard updates while the app is open.
// 30s (not 7s) and ONLY while the tab is visible: every request goes through the
// public tunnel, and an idle phone left open at 7s once burned ngrok's entire
// monthly free quota (~20k connections → ERR_NGROK_727, tunnel dead for a month).
function liveTick() {
  const dashActive = $('#screen-dash').classList.contains('active');
  if (dashActive) refreshDashboard();
  else api('/api/house/status').then(updateMacroBadge).catch(() => {});
  // Keep the macros active-banner in sync if that screen is showing.
  if ($('#screen-macros').classList.contains('active') && currentUser && !sessionOpen) refreshActiveState();
}
setInterval(() => { if (!document.hidden) liveTick(); }, 30000);
// Refresh immediately when the user returns to the app (makes 30s feel instant).
document.addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });
