// The Gardener™ — durable persistence (SQLite, WAL, synchronous=FULL).
// Holds the precious user feedback + the iteration history + key/value state.
// WAL + FULL fsync gives crash-consistent durability: a power loss never loses
// an acknowledged feedback write and never leaves a torn DB.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { paths, ensureDirs } from './config.mjs';

ensureDirs();

// Identity of this boot — lets us treat a lock/pid from a previous boot as dead
// (Linux recycles PIDs across reboots).
const BOOT_ID = (() => {
  try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return 'nb'; }
})();

const db = new Database(paths.DB);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            INTEGER NOT NULL,
    text          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'ui',
    consumed_by   INTEGER            -- iteration id that consumed it (NULL = pending)
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_pending ON feedback(consumed_by);

  CREATE TABLE IF NOT EXISTS iterations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at     INTEGER NOT NULL,
    finished_at    INTEGER,
    status         TEXT NOT NULL,   -- running|testing|reviewing|committed|failed|crashed|skipped
    trigger        TEXT NOT NULL,   -- scheduled|manual|catchup
    base_commit    TEXT,
    result_commit  TEXT,
    feedback_count INTEGER NOT NULL DEFAULT 0,
    summary        TEXT,
    error          TEXT,
    review_ok      INTEGER,
    review_score   REAL,
    review_notes   TEXT,
    screenshot     TEXT,
    pid            INTEGER
  );

  CREATE TABLE IF NOT EXISTS kv (
    key    TEXT PRIMARY KEY,
    value  TEXT
  );

  -- ====================================================================
  -- "Hearth" — the household side app (a separate, hand-maintained side
  -- project; the daily tending must NOT touch these tables or its code).
  -- Served on the PUBLIC plant-server surface; surfaced read-only on the wall.
  -- ====================================================================
  CREATE TABLE IF NOT EXISTS house_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clean_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES house_users(id),
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER                      -- NULL = still cleaning
  );
  CREATE INDEX IF NOT EXISTS idx_clean_active ON clean_sessions(ended_at);
  CREATE TABLE IF NOT EXISTS chore_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES house_users(id),
    session_id  INTEGER REFERENCES clean_sessions(id),
    chore       TEXT NOT NULL,                -- canonical chore key (e.g. 'vacuum')
    note        TEXT,                         -- free text for the 'other' chore
    ts          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chore_ts ON chore_events(ts);
  CREATE TABLE IF NOT EXISTS house_notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    text        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'info'  -- session_start|chore|session_end|info
  );
  CREATE INDEX IF NOT EXISTS idx_notif_ts ON house_notifications(ts);
  -- Web Push subscriptions (one row per browser/device that opted in). The
  -- endpoint is the unique key; p256dh/auth are the encryption keys the push
  -- service needs. Dead endpoints are pruned on 404/410 when we try to send.
  CREATE TABLE IF NOT EXISTS house_push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES house_users(id),  -- who subscribed (nullable)
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_endpoint ON house_push_subscriptions(endpoint);
`);

// ---- key/value state -------------------------------------------------------
const _get = db.prepare('SELECT value FROM kv WHERE key = ?');
const _set = db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
export function getKV(key, fallback = null) {
  const row = _get.get(key);
  return row ? row.value : fallback;
}
export function setKV(key, value) { _set.run(key, String(value)); }

export function getUiVersion() { return parseInt(getKV('ui_version', '1'), 10) || 1; }
export function bumpUiVersion() {
  const v = getUiVersion() + 1;
  setKV('ui_version', v);
  return v;
}

export function getNight() { return getKV('night', '0') === '1'; }
export function setNight(on) { setKV('night', on ? '1' : '0'); }

// ---- feedback --------------------------------------------------------------
const _addFeedback = db.prepare('INSERT INTO feedback(ts, text, source) VALUES(?,?,?)');
export function addFeedback(text, source = 'ui') {
  const info = _addFeedback.run(Date.now(), String(text), source);
  return info.lastInsertRowid;
}
const _pending = db.prepare('SELECT id, ts, text, source FROM feedback WHERE consumed_by IS NULL ORDER BY ts ASC');
export function getPendingFeedback() { return _pending.all(); }
const _recent = db.prepare('SELECT id, ts, text, source, consumed_by FROM feedback ORDER BY ts DESC LIMIT ?');
export function getRecentFeedback(limit = 25) { return _recent.all(limit); }
// Delete a still-pending note (the human can prune notes before they're tended).
// Only ever removes PENDING feedback — once a note has been grown into the garden
// (consumed_by set) it's part of history and stays.
const _deletePending = db.prepare('DELETE FROM feedback WHERE id = ? AND consumed_by IS NULL');
export function deletePendingFeedback(id) { return _deletePending.run(id).changes; }
const _consume = db.prepare('UPDATE feedback SET consumed_by = ? WHERE consumed_by IS NULL');
export function consumePendingFeedback(iterationId) { return _consume.run(iterationId).changes; }
// Consume ONLY the specific feedback ids the agent actually saw, so feedback
// that arrives mid-iteration stays pending for the next run (no silent loss).
export function consumeFeedbackIds(iterationId, ids) {
  if (!ids || !ids.length) return 0;
  const ph = ids.map(() => '?').join(',');
  return db.prepare(`UPDATE feedback SET consumed_by = ? WHERE consumed_by IS NULL AND id IN (${ph})`)
    .run(iterationId, ...ids).changes;
}
export function countPendingFeedback() {
  return db.prepare('SELECT COUNT(*) n FROM feedback WHERE consumed_by IS NULL').get().n;
}

// ---- iterations ------------------------------------------------------------
const _createIter = db.prepare(
  `INSERT INTO iterations(started_at, status, trigger, base_commit, feedback_count, pid)
   VALUES(?,?,?,?,?,?)`);
export function createIteration({ trigger, baseCommit, feedbackCount, pid }) {
  return _createIter.run(Date.now(), 'running', trigger, baseCommit || null, feedbackCount || 0, pid || process.pid)
    .lastInsertRowid;
}
export function updateIteration(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE iterations SET ${set} WHERE id = @id`).run({ ...fields, id });
}
export function finishIteration(id, status, extra = {}) {
  updateIteration(id, { status, finished_at: Date.now(), ...extra });
}
const _getIter = db.prepare('SELECT * FROM iterations WHERE id = ?');
export function getIteration(id) { return _getIter.get(id); }
export function latestIteration() {
  return db.prepare('SELECT * FROM iterations ORDER BY id DESC LIMIT 1').get();
}
export function latestCommitted() {
  return db.prepare("SELECT * FROM iterations WHERE status='committed' ORDER BY id DESC LIMIT 1").get();
}
export function recentIterations(limit = 10) {
  return db.prepare('SELECT * FROM iterations ORDER BY id DESC LIMIT ?').all(limit);
}
// Any iteration left mid-flight (process died) — used for crash recovery.
export function unfinishedIterations() {
  return db.prepare("SELECT * FROM iterations WHERE status IN ('running','testing','reviewing')").all();
}

// Atomic deploy finalization: bump version + consume the seen feedback +
// mark committed, all in one SQLite transaction so a crash can't apply a
// partial deploy (e.g. consume feedback but lose the version bump).
export const finalizeDeployTx = db.transaction((p) => {
  const version = bumpUiVersion();
  consumeFeedbackIds(p.iterId, p.feedbackIds);
  finishIteration(p.iterId, 'committed', {
    result_commit: p.resultCommit, summary: p.summary,
    review_ok: p.reviewOk, review_score: p.reviewScore,
    review_notes: p.reviewNotes, screenshot: p.screenshot,
  });
  return version;
});

// ---- iteration lock (single-writer guarantee across processes) -------------
// A lock holder is "alive" only if its pid is live AND from THIS boot. We never
// steal a live holder's lock until a generous hard-cap TTL (covers a wedged
// process); a healthy run heartbeats its ts so it never looks stale.
const LOCK_KEY = 'iteration_lock';
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function lockHeldByOther(ttlMs) {
  const cur = getKV(LOCK_KEY, null);
  if (!cur) return false;
  try {
    const { pid, ts, boot } = JSON.parse(cur);
    if (pid === process.pid) return false;
    const fresh = (Date.now() - ts) < ttlMs;
    return pidAlive(pid) && boot === BOOT_ID && fresh;
  } catch { return false; } // corrupt lock → free to claim
}
// Atomic claim (BEGIN IMMEDIATE) so two iterate processes can't both win.
const _claim = db.transaction((ttlMs) => {
  if (lockHeldByOther(ttlMs)) return false;
  setKV(LOCK_KEY, JSON.stringify({ pid: process.pid, ts: Date.now(), boot: BOOT_ID }));
  return true;
});
export function acquireLock(ttlMs = 135 * 60 * 1000) { return _claim.immediate(ttlMs); }
export function refreshLock() {
  const cur = getKV(LOCK_KEY, null);
  try { if (cur && JSON.parse(cur).pid === process.pid) setKV(LOCK_KEY, JSON.stringify({ pid: process.pid, ts: Date.now(), boot: BOOT_ID })); }
  catch { /* ignore */ }
}
export function releaseLock() {
  const cur = getKV(LOCK_KEY, null);
  if (!cur) return;
  try { if (JSON.parse(cur).pid === process.pid) setKV(LOCK_KEY, ''); }
  catch { setKV(LOCK_KEY, ''); }
}
export function clearStaleLock() {
  const cur = getKV(LOCK_KEY, null);
  if (!cur) return;
  try {
    const { pid, boot } = JSON.parse(cur);
    if (!pidAlive(pid) || boot !== BOOT_ID) setKV(LOCK_KEY, '');
  } catch { setKV(LOCK_KEY, ''); }
}

// ============================================================================
// "Hearth" household app — data helpers. Separate, hand-maintained side project.
// All writes are validated/rate-limited at the (internet-exposed) HTTP layer.
// ============================================================================

// ---- users -----------------------------------------------------------------
const _houseUsers = db.prepare('SELECT id, name, created_at FROM house_users ORDER BY name COLLATE NOCASE ASC');
export function listHouseUsers() { return _houseUsers.all(); }
const _houseUserByName = db.prepare('SELECT id, name, created_at FROM house_users WHERE name = ? COLLATE NOCASE');
export function getHouseUserByName(name) { return _houseUserByName.get(String(name)); }
const _houseUserById = db.prepare('SELECT id, name, created_at FROM house_users WHERE id = ?');
export function getHouseUser(id) { return _houseUserById.get(id); }
const _addHouseUser = db.prepare('INSERT INTO house_users(name, created_at) VALUES(?,?)');
// Create-or-get by (case-insensitive) name; returns the canonical row.
export function upsertHouseUser(name) {
  const clean = String(name).trim().slice(0, 40);
  if (!clean) return null;
  const existing = _houseUserByName.get(clean);
  if (existing) return existing;
  try {
    const info = _addHouseUser.run(clean, Date.now());
    return getHouseUser(info.lastInsertRowid);
  } catch {
    return _houseUserByName.get(clean); // raced an insert → return the winner
  }
}

// ---- clean sessions ---------------------------------------------------------
const _activeSessionForUser = db.prepare('SELECT * FROM clean_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1');
export function activeSessionForUser(userId) { return _activeSessionForUser.get(userId); }
const _activeSessions = db.prepare(`
  SELECT s.id, s.user_id, s.started_at, u.name
  FROM clean_sessions s JOIN house_users u ON u.id = s.user_id
  WHERE s.ended_at IS NULL ORDER BY s.started_at ASC`);
export function activeSessions() { return _activeSessions.all(); }
const _startSession = db.prepare('INSERT INTO clean_sessions(user_id, started_at) VALUES(?,?)');
// Idempotent start: reuse an already-open session rather than stacking them.
export function startCleanSession(userId) {
  const open = _activeSessionForUser.get(userId);
  if (open) return open;
  const info = _startSession.run(userId, Date.now());
  return db.prepare('SELECT * FROM clean_sessions WHERE id = ?').get(info.lastInsertRowid);
}
const _endSession = db.prepare('UPDATE clean_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL');
export function endCleanSession(sessionId) { return _endSession.run(Date.now(), sessionId).changes; }
const _getSession = db.prepare('SELECT * FROM clean_sessions WHERE id = ?');
export function getCleanSession(id) { return _getSession.get(id); }

// ---- chore events -----------------------------------------------------------
const _addChore = db.prepare('INSERT INTO chore_events(user_id, session_id, chore, note, ts) VALUES(?,?,?,?,?)');
export function addChoreEvent({ userId, sessionId, chore, note }) {
  const info = _addChore.run(userId, sessionId || null, String(chore), note ? String(note).slice(0, 200) : null, Date.now());
  return info.lastInsertRowid;
}
// Chores logged within a given session (for the active-session checklist view).
const _choresForSession = db.prepare('SELECT id, chore, note, ts FROM chore_events WHERE session_id = ? ORDER BY ts ASC');
export function choresForSession(sessionId) { return _choresForSession.all(sessionId); }

// ---- notifications ----------------------------------------------------------
const _addNotif = db.prepare('INSERT INTO house_notifications(ts, text, kind) VALUES(?,?,?)');
export function addHouseNotification(text, kind = 'info') {
  const info = _addNotif.run(Date.now(), String(text).slice(0, 280), String(kind));
  return info.lastInsertRowid;
}
const _recentNotifs = db.prepare('SELECT id, ts, text, kind FROM house_notifications ORDER BY ts DESC LIMIT ?');
export function recentHouseNotifications(limit = 30) { return _recentNotifs.all(Math.min(limit, 100)); }

// ---- web push subscriptions -------------------------------------------------
// Upsert by endpoint (re-subscribing the same browser refreshes its keys rather
// than stacking rows). Returns the stored row.
const _addSub = db.prepare(`
  INSERT INTO house_push_subscriptions(user_id, endpoint, p256dh, auth, created_at)
  VALUES(@user_id, @endpoint, @p256dh, @auth, @created_at)
  ON CONFLICT(endpoint) DO UPDATE SET
    p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id`);
const _subByEndpoint = db.prepare('SELECT * FROM house_push_subscriptions WHERE endpoint = ?');
export function addPushSubscription({ userId, endpoint, p256dh, auth }) {
  _addSub.run({ user_id: userId || null, endpoint: String(endpoint), p256dh: String(p256dh), auth: String(auth), created_at: Date.now() });
  return _subByEndpoint.get(String(endpoint));
}
const _allSubs = db.prepare('SELECT id, user_id, endpoint, p256dh, auth FROM house_push_subscriptions');
export function allPushSubscriptions() { return _allSubs.all(); }
const _delSub = db.prepare('DELETE FROM house_push_subscriptions WHERE endpoint = ?');
export function removePushSubscription(endpoint) { return _delSub.run(String(endpoint)).changes; }
export function countPushSubscriptions() { return db.prepare('SELECT COUNT(*) n FROM house_push_subscriptions').get().n; }

// ---- rankings / activity ----------------------------------------------------
// Points: 1 per chore; 'curb' (trash to the curb) and 'vacuum' (vacuum floor)
// are worth 2 (the heavier lifts). Tie-break is most-recent activity. The HTTP
// layer passes a `sinceMs` window (day = local PT midnight, week = rolling 7d).
const CHORE_POINTS = { curb: 2, vacuum: 2 };
export function chorePoints(chore) { return CHORE_POINTS[chore] || 1; }
const _eventsSince = db.prepare(`
  SELECT e.user_id, u.name, e.chore, e.ts
  FROM chore_events e JOIN house_users u ON u.id = e.user_id
  WHERE e.ts >= ? ORDER BY e.ts ASC`);
export function rankingSince(sinceMs) {
  const rows = _eventsSince.all(sinceMs);
  const by = new Map();
  for (const r of rows) {
    let agg = by.get(r.user_id);
    if (!agg) { agg = { user_id: r.user_id, name: r.name, points: 0, chores: 0, lastTs: 0 }; by.set(r.user_id, agg); }
    agg.points += chorePoints(r.chore);
    agg.chores += 1;
    if (r.ts > agg.lastTs) agg.lastTs = r.ts;
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.lastTs - a.lastTs);
}
const _recentActivity = db.prepare(`
  SELECT e.id, e.chore, e.note, e.ts, u.name
  FROM chore_events e JOIN house_users u ON u.id = e.user_id
  ORDER BY e.ts DESC LIMIT ?`);
export function recentActivity(limit = 20) { return _recentActivity.all(Math.min(limit, 100)); }

export default db;
