// Hearth — household app frontend (vanilla, no build, no deps).
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
  const t = $('#noteText'), btn = $('#noteSend'), msg = $('#noteMsg');
  btn.addEventListener('click', async () => {
    const text = t.value.trim();
    if (!text) { t.focus(); return; }
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Planting…';
    try {
      await api('/api/feedback', { method: 'POST', body: JSON.stringify({ text }) });
      t.value = ''; msg.className = 'msg ok'; msg.textContent = 'Planted 🌱  the Gardener will tend to it.';
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
      el('span', { class: 'at', html: `You're in <b>Clean Mode</b> — tap to log chores` }),
      el('span', { class: 'arrow' }, '›')));
  } else { wrap.replaceChildren(); $('#sessionArea').replaceChildren(); }
}

let sessionOpen = false;
async function openSession() {
  if (!activeSession) return;
  sessionOpen = true;
  await loadChores();
  const area = $('#sessionArea');
  let done = {};
  try { const r = await api('/api/house/session?id=' + activeSession.id); for (const c of r.chores) done[c.chore] = (done[c.chore] || 0) + 1; } catch { /* ignore */ }
  const list = el('div', { class: 'checklist' });
  for (const ch of CHORES) {
    if (ch.freeText) {
      const inp = el('input', { type: 'text', maxlength: '120', placeholder: 'What else did you do?' });
      const add = el('button', { class: 'primary', type: 'button' }, 'Log');
      add.addEventListener('click', async () => {
        const note = inp.value.trim(); if (!note) return;
        add.disabled = true;
        try { await logChore(ch.key, note); inp.value = ''; flash(add, '✓'); } catch (e) { alert(e.message); } finally { add.disabled = false; }
      });
      list.appendChild(el('div', { class: 'check', style: 'cursor:default; flex-wrap:wrap;' },
        el('span', { class: 'emoji' }, ch.emoji), el('span', { class: 'label' }, ch.label),
        el('div', { class: 'otherwrap' }, inp, add)));
      continue;
    }
    const cnt = done[ch.key] || 0;
    const row = el('div', { class: 'check' + (cnt ? ' done' : '') },
      el('span', { class: 'box' }, cnt ? '✓' : ''),
      el('span', { class: 'emoji' }, ch.emoji),
      el('span', { class: 'label' }, ch.label),
      cnt > 1 ? el('span', { class: 'count' }, '×' + cnt) : null);
    row.addEventListener('click', async () => {
      row.style.pointerEvents = 'none';
      try { await logChore(ch.key); const n = (done[ch.key] || 0) + 1; done[ch.key] = n; row.classList.add('done'); $('.box', row).textContent = '✓';
        if (n > 1) { let c = $('.count', row); if (!c) { c = el('span', { class: 'count' }); row.appendChild(c); } c.textContent = '×' + n; } }
      catch (e) { alert(e.message); } finally { row.style.pointerEvents = ''; }
    });
    list.appendChild(row);
  }
  const end = el('button', { class: 'ghost', type: 'button' }, 'End cleaning session');
  end.addEventListener('click', async () => {
    end.disabled = true;
    try { await api('/api/house/session/end', { method: 'POST', body: JSON.stringify({ sessionId: activeSession.id }) }); activeSession = null; sessionOpen = false; area.replaceChildren(); await refreshActiveState(); }
    catch (e) { end.disabled = false; alert(e.message); }
  });
  area.replaceChildren(el('div', { class: 'card' },
    el('h2', {}, '✅ What did you do?'),
    el('p', { class: 'lead', style: 'margin-bottom:14px' }, 'Tap each chore you finished. Each one is logged and the household is notified.'),
    list, el('div', { style: 'height:14px' }), end));
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function logChore(chore, note) {
  return api('/api/house/chore', { method: 'POST', body: JSON.stringify({ userId: currentUser.id, name: currentUser.name, sessionId: activeSession ? activeSession.id : null, chore, note }) });
}
function flash(btn, txt) { const old = btn.textContent; btn.textContent = txt; setTimeout(() => { btn.textContent = old; }, 900); }

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
  // Leaderboard
  const board = (range === 'day' ? status.day : status.week);
  const list = $('#rankList');
  list.replaceChildren(...(board.length ? board.map((p, i) =>
    el('div', { class: 'rank' + (i === 0 ? ' top' : '') },
      el('div', { class: 'pos' }, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1)),
      el('div', { class: 'nm' }, p.name, el('small', {}, `${p.chores} ${p.chores === 1 ? 'chore' : 'chores'} · last ${fmtAgo(p.lastTs)}`)),
      el('div', { class: 'pts' }, String(p.points), el('small', {}, ' pts'))))
    : [el('div', { class: 'empty' }, range === 'day' ? 'No chores logged today yet.' : 'No chores logged this week yet.')]));

  // Cleaning now
  const now = $('#cleaningNow');
  now.replaceChildren(...(status.cleaning.length ? status.cleaning.map((c) =>
    el('div', { class: 'pill' }, el('span', { class: 'pulse' }), el('span', { html: `<b>${escapeHtml(c.name)}</b> is cleaning · since ${fmtClock(c.startedAt)}` })))
    : [el('div', { class: 'empty' }, 'Nobody is cleaning right now.')]));

  // Activity feed
  const feed = $('#activityFeed');
  feed.replaceChildren(...(status.activity.length ? status.activity.map((a) => {
    const def = (CHORES.find((c) => c.key === a.chore)) || { emoji: '•', label: a.chore };
    const what = a.chore === 'other' && a.note ? a.note : def.label;
    return el('div', { class: 'row' }, el('span', { class: 'e' }, def.emoji),
      el('span', { class: 'txt' }, `${a.name} — ${what}`, el('small', {}, fmtAgo(a.ts))));
  }) : [el('div', { class: 'empty' }, 'No activity yet.')]));

  // Notifications
  const nf = $('#notifFeed');
  nf.replaceChildren(...(status.notifications.length ? status.notifications.map((n) =>
    el('div', { class: 'row' }, el('span', { class: 'e' }, '🔔'),
      el('span', { class: 'txt' }, n.text, el('small', {}, fmtAgo(n.ts)))))
    : [el('div', { class: 'empty' }, 'No notifications yet.')]));

  updateMacroBadge(status);
}
function renderEmptyDash() {
  $('#rankList').replaceChildren(el('div', { class: 'empty' }, 'Could not reach the household — try again.'));
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
