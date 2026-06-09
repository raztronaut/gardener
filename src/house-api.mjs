// "Hearth" — household app backend (a separate, hand-maintained side project).
// A small router + the household status snapshot, imported by the PUBLIC
// plant-server (full read+write API) and by the localhost wall server
// (read-only status for the cleaning widget). The daily tending must NOT
// modify this file or anything under public/house/.
import {
  listHouseUsers, upsertHouseUser, getHouseUser,
  startCleanSession, endCleanSession, getCleanSession, activeSessions,
  activeSessionForUser, addChoreEvents, choresForSession,
  deleteChoreEvents, deleteChoreEventsSince,
  addHouseNotification, recentHouseNotifications,
  rankingSince, recentActivity,
  addPushSubscription, removePushSubscription,
} from './db.mjs';
import { getVapidPublicKey, sendToAll } from './push.mjs';

// Canonical chore catalog. `key` is stored; `label`/`emoji` drive the UI and the
// notification text. The last item is free-text ("other"). Edit here only.
export const CHORES = [
  { key: 'trash', label: 'Took trash out', emoji: '🗑', past: 'took the trash out' },
  { key: 'counters', label: 'Wiped counters', emoji: '🧽', past: 'wiped the counters' },
  { key: 'vacuum', label: 'Vacuumed floor', emoji: '🧹', past: 'vacuumed the floor' },
  { key: 'dishwasher_run', label: 'Ran the dishes in dishwasher', emoji: '🍽', past: 'ran the dishwasher' },
  { key: 'dishwasher_empty', label: 'Put dishes away (from dishwasher)', emoji: '🧼', past: 'put the dishes away' },
  { key: 'curb', label: 'Put trash to the curb', emoji: '♻️', past: 'put the trash to the curb' },
  { key: 'other', label: 'Other', emoji: '✍️', past: 'did', freeText: true },
];
const CHORE_BY_KEY = new Map(CHORES.map((c) => [c.key, c]));

// ---- time windows (documented choice) --------------------------------------
// Day  = since local midnight in America/Los_Angeles (the wall's timezone).
// Week = a rolling 7-day window (now - 7d), which is simplest and always shows
//        a full week of activity regardless of the current weekday.
const TZ = 'America/Los_Angeles';
export function dayStartMs(now = new Date()) {
  // Midnight today in TZ, computed without extra deps: read the TZ wall-clock
  // parts and subtract them from `now`.
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  const h = (parseInt(parts.hour, 10) % 24), m = parseInt(parts.minute, 10), s = parseInt(parts.second, 10);
  return now.getTime() - ((h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds());
}
export function weekStartMs(now = new Date()) { return now.getTime() - 7 * 24 * 3600 * 1000; }

// ---- household status snapshot (shared by app dashboard + wall widget) ------
export function houseStatus() {
  const cleaning = activeSessions().map((s) => ({
    name: s.name, sessionId: s.id, startedAt: s.started_at,
  }));
  return {
    cleaning,
    day: rankingSince(dayStartMs()),
    week: rankingSince(weekStartMs()),
    activity: recentActivity(12),
    notifications: recentHouseNotifications(12),
    now: Date.now(),
  };
}

// ---- request helpers --------------------------------------------------------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function parseJson(req) {
  try { return JSON.parse(await readBody(req) || '{}'); } catch { return null; }
}

// Per-route rate limiter (a stranger with the public URL must not flood writes).
function makeLimiter(max, windowMs) {
  const hits = [];
  return () => {
    const now = Date.now();
    while (hits.length && now - hits[0] > windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}
const writeLimit = makeLimiter(60, 60_000); // 60 writes / minute across the surface

// ---- the router -------------------------------------------------------------
// Handles every path under /api/house/*. Returns true if it handled the request
// (so the caller can fall through to its own routes otherwise). `opts.readOnly`
// disables all writes (used by the localhost wall server, which only needs status).
export async function handleHouseApi(req, res, url, opts = {}) {
  const p = url.pathname;
  if (!p.startsWith('/api/house')) return false;
  const readOnly = !!opts.readOnly;
  const log = opts.log || (() => {});

  try {
    // ----- reads -----
    if (req.method === 'GET' && p === '/api/house/status') { json(res, 200, houseStatus()); return true; }
    if (req.method === 'GET' && p === '/api/house/users') { json(res, 200, { users: listHouseUsers() }); return true; }
    if (req.method === 'GET' && p === '/api/house/chores') { json(res, 200, { chores: CHORES }); return true; }
    if (req.method === 'GET' && p === '/api/house/notifications') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 100);
      json(res, 200, { notifications: recentHouseNotifications(limit) }); return true;
    }
    if (req.method === 'GET' && p === '/api/house/rankings') {
      json(res, 200, { day: rankingSince(dayStartMs()), week: rankingSince(weekStartMs()) }); return true;
    }
    // Web Push: the VAPID public key the browser needs to subscribe. A read, so
    // it's available everywhere the API is mounted (the wall server never sends).
    if (req.method === 'GET' && p === '/api/house/vapid-public') {
      let key = '';
      try { key = getVapidPublicKey(); } catch (e) { log(`vapid key error: ${e}`); }
      if (!key) { json(res, 503, { error: 'push not configured' }); return true; }
      json(res, 200, { publicKey: key }); return true;
    }
    if (req.method === 'GET' && p === '/api/house/session') {
      const id = parseInt(url.searchParams.get('id') || '', 10);
      const s = id ? getCleanSession(id) : null;
      if (!s) { json(res, 404, { error: 'no such session' }); return true; }
      const u = getHouseUser(s.user_id);
      json(res, 200, { session: { ...s, name: u?.name }, chores: choresForSession(s.id) }); return true;
    }

    if (readOnly) { json(res, 403, { error: 'read-only surface' }); return true; }

    // ----- writes (validated + rate-limited) -----
    if (!writeLimit()) { json(res, 429, { error: 'slow down — too many requests' }); return true; }

    if (req.method === 'POST' && p === '/api/house/users') {
      const b = await parseJson(req);
      const name = (b && b.name || '').toString().trim().slice(0, 40);
      if (!name || name.length < 1) { json(res, 400, { error: 'name required' }); return true; }
      if (!/^[\p{L}\p{N} '._-]{1,40}$/u.test(name)) { json(res, 400, { error: 'invalid name' }); return true; }
      const user = upsertHouseUser(name);
      if (!user) { json(res, 400, { error: 'invalid name' }); return true; }
      json(res, 200, { ok: true, user }); return true;
    }

    if (req.method === 'POST' && p === '/api/house/session/start') {
      const b = await parseJson(req);
      const user = resolveUser(b);
      if (!user) { json(res, 400, { error: 'unknown user' }); return true; }
      const fresh = !activeSessionForUser(user.id);
      const session = startCleanSession(user.id);
      if (fresh) {
        const text = `${user.name} started cleaning the house 🧹`;
        addHouseNotification(text, 'session_start');
        log(`session #${session.id} started by ${user.name}`);
        pushAll({ title: 'Clean Mode started 🧹', body: text, tag: 'session' }, b, log);
      }
      json(res, 200, { ok: true, session, chores: choresForSession(session.id) }); return true;
    }

    if (req.method === 'POST' && p === '/api/house/session/end') {
      const b = await parseJson(req);
      const session = b && b.sessionId ? getCleanSession(parseInt(b.sessionId, 10)) : null;
      if (!session) { json(res, 404, { error: 'no such session' }); return true; }
      const changed = endCleanSession(session.id);
      if (changed) {
        const u = getHouseUser(session.user_id);
        const done = choresForSession(session.id).length;
        addHouseNotification(`${u?.name || 'Someone'} finished cleaning — ${done} ${done === 1 ? 'chore' : 'chores'} done ✨`, 'session_end');
        log(`session #${session.id} ended (${done} chores)`);
      }
      json(res, 200, { ok: true }); return true;
    }

    // Batch-log the chores the user SELECTED and then CONFIRMED. Takes
    // { userId|name, sessionId?, chores:[{chore,note?} | "key"], note? } and
    // inserts them all in one transaction, emitting exactly ONE summary
    // notification (and ONE push) for the whole batch — not one per chore. This
    // replaces the old per-tap /api/house/chore auto-log (selection happens
    // client-side now; nothing is logged until Confirm).
    if (req.method === 'POST' && p === '/api/house/chores') {
      const b = await parseJson(req);
      const user = resolveUser(b);
      if (!user) { json(res, 400, { error: 'unknown user' }); return true; }
      const raw = Array.isArray(b && b.chores) ? b.chores : [];
      if (!raw.length || raw.length > 50) { json(res, 400, { error: 'select at least one chore' }); return true; }
      // Normalize + validate each selection; dedupe non-free-text keys so the
      // same toggle can't be double-counted in a single confirm.
      const entries = []; const seen = new Set(); const labels = [];
      for (const item of raw) {
        const key = (typeof item === 'string' ? item : (item && item.chore) || '').toString();
        const def = CHORE_BY_KEY.get(key);
        if (!def) { json(res, 400, { error: 'unknown chore' }); return true; }
        let note = ((typeof item === 'object' && item && item.note) || '').toString().trim().slice(0, 200);
        if (def.freeText) {
          if (!note) { json(res, 400, { error: 'describe what you did' }); return true; }
        } else {
          if (seen.has(def.key)) continue; // collapse duplicate toggles
          seen.add(def.key);
          note = '';
        }
        entries.push({ chore: def.key, note: note || null });
        labels.push(def.freeText ? note : def.past);
      }
      if (!entries.length) { json(res, 400, { error: 'select at least one chore' }); return true; }
      const session = b && b.sessionId ? getCleanSession(parseInt(b.sessionId, 10)) : null;
      const ids = addChoreEvents({ userId: user.id, sessionId: session ? session.id : null, entries });
      // One summary notification for the whole confirmed batch.
      const summary = labels.length === 1 ? labels[0]
        : labels.slice(0, -1).join(', ') + ' & ' + labels[labels.length - 1];
      const text = `${user.name} cleaned: ${summary} 🧹`;
      addHouseNotification(text, 'chore');
      log(`batch ${ids.length} chore(s) by ${user.name}: ${entries.map((e) => e.chore).join(',')}`);
      pushAll({ title: `🧹 ${user.name} cleaned`, body: summary, tag: 'chore' }, b, log);
      json(res, 200, { ok: true, ids, count: ids.length }); return true;
    }

    // Undo / clear (the "decrease"/reset the user asked for). Scoped to the
    // caller's OWN events only. scope:"batch" removes the ids just returned by a
    // confirm; scope:"today" wipes all of this user's chores since local midnight
    // (resetting their points). DELETE is accepted as an alias for POST.
    if ((req.method === 'POST' || req.method === 'DELETE') && p === '/api/house/chores/undo') {
      const b = await parseJson(req);
      const user = resolveUser(b);
      if (!user) { json(res, 400, { error: 'unknown user' }); return true; }
      const scope = (b && b.scope || 'batch').toString();
      let removed = 0;
      if (scope === 'today') {
        removed = deleteChoreEventsSince({ userId: user.id, sinceMs: dayStartMs() });
        if (removed) { addHouseNotification(`${user.name} cleared their chores for today 🧽`, 'info'); log(`cleared today: ${removed} chore(s) by ${user.name}`); }
      } else {
        const ids = Array.isArray(b && b.ids) ? b.ids.slice(0, 50) : [];
        if (!ids.length) { json(res, 400, { error: 'nothing to undo' }); return true; }
        removed = deleteChoreEvents({ userId: user.id, ids });
        if (removed) log(`undo batch: ${removed} chore(s) by ${user.name}`);
      }
      json(res, 200, { ok: true, removed }); return true;
    }

    // ----- web push subscribe / unsubscribe -----
    if (req.method === 'POST' && p === '/api/house/subscribe') {
      const b = await parseJson(req);
      const sub = b && b.subscription;
      const endpoint = (sub && sub.endpoint || '').toString();
      const p256dh = (sub && sub.keys && sub.keys.p256dh || '').toString();
      const auth = (sub && sub.keys && sub.keys.auth || '').toString();
      // Must be a real push endpoint with both encryption keys.
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1024 || !p256dh || !auth) {
        json(res, 400, { error: 'invalid subscription' }); return true;
      }
      const user = b && (b.userId || b.name) ? resolveUser(b) : null;
      try {
        addPushSubscription({ userId: user ? user.id : null, endpoint, p256dh, auth });
        log(`push subscribe${user ? ` (${user.name})` : ''}: …${endpoint.slice(-12)}`);
        json(res, 200, { ok: true }); return true;
      } catch (e) { log(`subscribe error: ${e}`); json(res, 500, { error: 'could not subscribe' }); return true; }
    }

    if (req.method === 'POST' && p === '/api/house/unsubscribe') {
      const b = await parseJson(req);
      const endpoint = (b && b.endpoint || '').toString();
      if (!/^https:\/\//.test(endpoint)) { json(res, 400, { error: 'invalid endpoint' }); return true; }
      removePushSubscription(endpoint);
      json(res, 200, { ok: true }); return true;
    }

    json(res, 404, { error: 'no such house route' });
    return true;
  } catch (e) {
    log(`house api error: ${e.stack || e}`);
    try { json(res, 500, { error: 'house error' }); } catch { /* ignore */ }
    return true;
  }
}

// Fire-and-forget Web Push fan-out to all stored subscriptions. We don't await
// it (the HTTP response shouldn't block on the push services) and never let a
// push failure surface to the caller. The actor's own device is skipped when
// the client includes its `endpoint` in the request body. The tunnel URL is the
// canonical place to open notifications, so we point clicks at it when known.
const PUBLIC_BASE = (process.env.GARDENER_PUBLIC_URL || '').replace(/\/+$/, '');
function pushAll(payload, body, log) {
  const skipEndpoint = body && typeof body.endpoint === 'string' ? body.endpoint : null;
  const url = PUBLIC_BASE || '/';
  Promise.resolve()
    .then(() => sendToAll({ ...payload, url }, { skipEndpoint, log }))
    .catch((e) => log(`push fan-out error: ${e}`));
}

// Resolve a user from {userId} or {name} (creating by name if needed) — lets the
// client pass whichever it has cached locally.
function resolveUser(b) {
  if (!b) return null;
  if (b.userId) { const u = getHouseUser(parseInt(b.userId, 10)); if (u) return u; }
  if (b.name) return upsertHouseUser(b.name);
  return null;
}
