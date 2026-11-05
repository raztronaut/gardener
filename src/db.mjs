// The Gardener™ — durable persistence (SQLite, WAL, synchronous=FULL).
// Holds the precious user feedback + the iteration history + key/value state.
// WAL + FULL fsync gives crash-consistent durability: a power loss never loses
// an acknowledged feedback write and never leaves a torn DB.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
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
  -- App login sessions (one row per signed-in device). The token is an opaque
  -- bearer secret the client stores in localStorage and sends as the
  -- 'x-roots-token' header. provider is 'name' (picked/typed a name) or
  -- 'google' (verified Google ID token); email/picture only set for google.
  CREATE TABLE IF NOT EXISTS house_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES house_users(id),
    provider    TEXT NOT NULL DEFAULT 'name',   -- 'name' | 'google'
    email       TEXT,
    picture     TEXT,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_house_sessions_token ON house_sessions(token);
  CREATE INDEX IF NOT EXISTS idx_house_sessions_seen ON house_sessions(last_seen);

  -- Shared availability calendar (Roots, June 2026). One table holds every
  -- member's BUSY intervals, tagged by where they came from:
  --   source='google' — busy blocks pushed up from the member's REAL Google
  --                      Calendar via the freeBusy API (the OAuth access-token
  --                      flow runs in the browser; we only ever store the busy
  --                      intervals, NEVER the token, and never event titles).
  --                      A reconnect REPLACES that member's google rows.
  --   source='manual' — busy time the member typed in by hand (start/end epoch
  --                      ms + optional label) for anything Google doesn't cover.
  -- A member's busy time is the union of their google + manual rows; the
  -- household's shared FREE windows are computed from everyone's union.
  CREATE TABLE IF NOT EXISTS house_busy (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES house_users(id),
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual', -- 'google' | 'manual'
    label       TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_busy_user ON house_busy(user_id);
  CREATE INDEX IF NOT EXISTS idx_busy_end ON house_busy(end_ms);

  -- Drop the dead iCal-era tables (replaced by Google Calendar + house_busy).
  -- The old .ics-paste sync was removed in favour of real Google Calendar OAuth.
  DROP TABLE IF EXISTS house_calendars;
  DROP TABLE IF EXISTS house_busy_blocks;
`);

// Idempotent migration: a chosen avatar for each house_user. Stored value is
// either 'google' / null (use the Google account photo if any, else the colored
// initial bubble) or 'preset:<id>' (a client-rendered, deterministic avatar — no
// files are ever uploaded/stored on the public surface). Wrapped in try/catch so
// re-running on an already-migrated DB is a no-op.
try { db.exec('ALTER TABLE house_users ADD COLUMN avatar TEXT'); } catch { /* column already exists */ }
// Uploaded profile photo (Roots, June 2026). When `avatar` is 'upload', the
// user has a REAL uploaded picture: `avatar_file` is its on-disk filename under
// <GARDENER_DATA>/avatars/ (image bytes are NEVER stored in SQLite) and
// `avatar_v` is a monotonic version stamp the API folds into the served URL
// (?v=…) so caches bust when the photo changes. Both idempotent (try/catch).
try { db.exec('ALTER TABLE house_users ADD COLUMN avatar_file TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE house_users ADD COLUMN avatar_v INTEGER'); } catch { /* exists */ }

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
export function getSnoozeUntil() { return Number(getKV('display_snooze_until', '0')) || 0; }
export function setSnoozeUntil(until) { setKV('display_snooze_until', String(until)); }


// ---- hand edits ("pruning"): persistent text overrides for template/widget
// chrome (titles, brand, subtitle), keyed by slot; stored in kv as edit:<slot>.
// An empty value deletes the override (reverts to the natural text).
export function getEdits() {
  const out = {};
  for (const r of db.prepare("SELECT key, value FROM kv WHERE key LIKE 'edit:%' AND value != ''").all()) {
    out[r.key.slice(5)] = r.value;
  }
  return out;
}
export function setEdit(slot, value) {
  if (value) setKV('edit:' + slot, value);
  else db.prepare('DELETE FROM kv WHERE key = ?').run('edit:' + slot);
}

// ---- feedback --------------------------------------------------------------
// `dashboard`: which dashboard the seed was planted on ('main' = the common wall);
// each dashboard's notes are tended by its own agent run (iterate.mjs).
try { db.exec("ALTER TABLE feedback ADD COLUMN dashboard TEXT NOT NULL DEFAULT 'main'"); } catch { /* exists */ }
const _addFeedback = db.prepare('INSERT INTO feedback(ts, text, source, dashboard) VALUES(?,?,?,?)');
export function addFeedback(text, source = 'ui', dashboard = 'main') {
  const info = _addFeedback.run(Date.now(), String(text), source, /^[a-z0-9-]{1,24}$/.test(dashboard) ? dashboard : 'main');
  return info.lastInsertRowid;
}
const _pending = db.prepare('SELECT id, ts, text, source, dashboard FROM feedback WHERE consumed_by IS NULL ORDER BY ts ASC');
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
// Is a tending cycle running right now? True iff the lock is held by a LIVE
// process from THIS boot (BOOT_ID is the kernel boot id, shared across processes,
// so the wall server can see the separate iterate process's lock). Powers /grow.
export function isIterating() {
  const cur = getKV(LOCK_KEY, null);
  if (!cur) return false;
  try { const { pid, boot } = JSON.parse(cur); return !!pid && boot === BOOT_ID && pidAlive(pid); }
  catch { return false; }
}

// ============================================================================
// "Hearth" household app — data helpers. Separate, hand-maintained side project.
// All writes are validated/rate-limited at the (internet-exposed) HTTP layer.
// ============================================================================

// ---- users -----------------------------------------------------------------
const _houseUsers = db.prepare('SELECT id, name, avatar, avatar_file, avatar_v, created_at FROM house_users ORDER BY name COLLATE NOCASE ASC');
export function listHouseUsers() { return _houseUsers.all(); }
const _houseUserByName = db.prepare('SELECT id, name, avatar, avatar_file, avatar_v, created_at FROM house_users WHERE name = ? COLLATE NOCASE');
export function getHouseUserByName(name) { return _houseUserByName.get(String(name)); }
const _houseUserById = db.prepare('SELECT id, name, avatar, avatar_file, avatar_v, created_at FROM house_users WHERE id = ?');
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
// Rename a user IN PLACE (same row, so the UNIQUE constraint is happy and every
// join — leaderboard/household/notifications read the live name — propagates).
// Returns { ok } on success, { collision } if another user already owns the
// (case-insensitive) name. Scoped by id so a session can only rename its OWN row.
const _renameHouseUser = db.prepare('UPDATE house_users SET name = ? WHERE id = ?');
export function renameHouseUser(id, name) {
  const clean = String(name).trim().slice(0, 40);
  if (!clean) return { error: 'blank' };
  const owner = _houseUserByName.get(clean);
  if (owner && owner.id !== id) return { collision: true };
  // A no-op (same name, maybe just a case change) still applies cleanly.
  try { _renameHouseUser.run(clean, id); return { ok: true, user: getHouseUser(id) }; }
  catch { return { collision: true }; } // lost a UNIQUE race
}
// Persist the chosen avatar spec for a user. Values: null/'google' (use the
// Google account photo if any, else the colored-initial bubble) or 'upload' (a
// real uploaded photo whose on-disk filename lives in avatar_file). Setting any
// value OTHER than 'upload' clears avatar_file so the old picture is forgotten.
const _setHouseUserAvatar = db.prepare('UPDATE house_users SET avatar = ?, avatar_file = NULL WHERE id = ?');
export function setHouseUserAvatar(id, avatar) {
  _setHouseUserAvatar.run(avatar == null ? null : String(avatar).slice(0, 40), id);
  return getHouseUser(id);
}
// Point a user at a freshly-uploaded photo: store the filename, mark avatar
// 'upload', and bump the version stamp (so the served URL's ?v= busts caches).
const _setHouseUserAvatarFile = db.prepare(
  "UPDATE house_users SET avatar = 'upload', avatar_file = ?, avatar_v = COALESCE(avatar_v, 0) + 1 WHERE id = ?");
export function setHouseUserAvatarFile(id, file) {
  _setHouseUserAvatarFile.run(String(file).slice(0, 200), id);
  return getHouseUser(id);
}
// The most-recent Google account photo per user (from house_sessions), so any
// surface can fall back to it when the user's avatar is 'google'/unset. Returns
// a Map(userId → pictureUrl). One small query; callers cache it per request.
const _googlePics = db.prepare(`
  SELECT s.user_id AS user_id, s.picture AS picture
  FROM house_sessions s
  WHERE s.provider = 'google' AND s.picture IS NOT NULL
  ORDER BY s.last_seen ASC`);
export function googlePictureByUser() {
  const m = new Map();
  for (const r of _googlePics.all()) if (r.picture) m.set(r.user_id, r.picture); // ASC → newest wins
  return m;
}

// ---- clean sessions ---------------------------------------------------------
const _activeSessionForUser = db.prepare('SELECT * FROM clean_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1');
export function activeSessionForUser(userId) { return _activeSessionForUser.get(userId); }
const _activeSessions = db.prepare(`
  SELECT s.id, s.user_id, s.started_at, u.name, u.avatar, u.avatar_file, u.avatar_v
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

// Batch-log several chores in ONE transaction (the "Confirm" action). Each entry
// is { chore, note }. Returns the inserted row ids (used as the undo "batch").
const _addChoresTx = db.transaction((userId, sessionId, entries) => {
  const ids = [];
  for (const e of entries) {
    const info = _addChore.run(userId, sessionId || null, String(e.chore), e.note ? String(e.note).slice(0, 200) : null, Date.now());
    ids.push(info.lastInsertRowid);
  }
  return ids;
});
export function addChoreEvents({ userId, sessionId, entries }) {
  if (!Array.isArray(entries) || !entries.length) return [];
  return _addChoresTx(userId, sessionId, entries);
}

// Undo / clear (the "decrease" the user asked for). Either delete a specific set
// of just-logged ids (batch undo), or all of a user's chores since `sinceMs`
// (clear-today). Both are scoped to the given user so one person can only ever
// remove their OWN events. Returns the number of rows removed.
const _delChoreByIdForUser = db.prepare('DELETE FROM chore_events WHERE id = ? AND user_id = ?');
const _delChoresBatchTx = db.transaction((userId, ids) => {
  let n = 0;
  for (const id of ids) n += _delChoreByIdForUser.run(parseInt(id, 10), userId).changes;
  return n;
});
export function deleteChoreEvents({ userId, ids }) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  return _delChoresBatchTx(userId, ids);
}
const _delChoresSinceForUser = db.prepare('DELETE FROM chore_events WHERE user_id = ? AND ts >= ?');
export function deleteChoreEventsSince({ userId, sinceMs }) {
  return _delChoresSinceForUser.run(userId, sinceMs).changes;
}

// ---- notifications ----------------------------------------------------------
const _addNotif = db.prepare('INSERT INTO house_notifications(ts, text, kind) VALUES(?,?,?)');
export function addHouseNotification(text, kind = 'info') {
  const info = _addNotif.run(Date.now(), String(text).slice(0, 280), String(kind));
  return info.lastInsertRowid;
}
const _recentNotifs = db.prepare('SELECT id, ts, text, kind FROM house_notifications ORDER BY ts DESC LIMIT ?');
export function recentHouseNotifications(limit = 30) { return _recentNotifs.all(Math.min(limit, 100)); }

// ---- app login sessions -------------------------------------------------------
// One row per signed-in device/browser. The token is the only credential: an
// unguessable opaque string (UUID + 32 hex chars of CSPRNG) the client keeps in
// localStorage and presents via the 'x-roots-token' header. Reading a session
// by token "touches" last_seen, so the Account screen can show which devices
// have been active recently. "Active" = last_seen within 30 days.
const HOUSE_SESSION_ACTIVE_MS = 30 * 24 * 3600 * 1000;
const _addHouseSession = db.prepare(`
  INSERT INTO house_sessions(token, user_id, provider, email, picture, created_at, last_seen)
  VALUES(@token, @user_id, @provider, @email, @picture, @created_at, @last_seen)`);
const _houseSessionByToken = db.prepare(`
  SELECT s.*, u.name FROM house_sessions s JOIN house_users u ON u.id = s.user_id
  WHERE s.token = ?`);
const _touchHouseSession = db.prepare('UPDATE house_sessions SET last_seen = ? WHERE id = ?');
export function createHouseSession({ userId, provider = 'name', email = null, picture = null }) {
  const token = randomUUID() + randomBytes(16).toString('hex');
  const now = Date.now();
  _addHouseSession.run({
    token, user_id: userId, provider: String(provider),
    email: email ? String(email).slice(0, 200) : null,
    picture: picture ? String(picture).slice(0, 500) : null,
    created_at: now, last_seen: now,
  });
  return _houseSessionByToken.get(token);
}
export function getHouseSessionByToken(token, { touch = true } = {}) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const s = _houseSessionByToken.get(token);
  if (!s) return null;
  if (touch) { try { _touchHouseSession.run(Date.now(), s.id); s.last_seen = Date.now(); } catch { /* read-only fs etc. */ } }
  return s;
}
const _delHouseSession = db.prepare('DELETE FROM house_sessions WHERE token = ?');
export function deleteHouseSession(token) { return _delHouseSession.run(String(token || '')).changes; }
// Sessions seen within the active window, joined to users (newest first).
const _activeHouseSessions = db.prepare(`
  SELECT s.id, s.user_id, s.provider, s.email, s.picture, s.created_at, s.last_seen, u.name
  FROM house_sessions s JOIN house_users u ON u.id = s.user_id
  WHERE s.last_seen >= ? ORDER BY s.last_seen DESC`);
export function activeHouseSessions(sinceMs = Date.now() - HOUSE_SESSION_ACTIVE_MS) {
  return _activeHouseSessions.all(sinceMs);
}
// Most-recent session for a Google email — how a returning Google account is
// linked back to the same house_user even if their display name has drifted.
const _houseSessionByEmail = db.prepare(`
  SELECT s.*, u.name FROM house_sessions s JOIN house_users u ON u.id = s.user_id
  WHERE s.email = ? COLLATE NOCASE ORDER BY s.last_seen DESC LIMIT 1`);
export function latestHouseSessionByEmail(email) {
  if (!email) return null;
  return _houseSessionByEmail.get(String(email));
}
// Cleanup helper (used by smoke/maintenance only — not exposed over HTTP).
const _delSessionsForUser = db.prepare('DELETE FROM house_sessions WHERE user_id = ?');
export function deleteHouseSessionsForUser(userId) { return _delSessionsForUser.run(userId).changes; }

// Per-user "last activity" for the Account screen's household list: the latest
// chore each member logged (NULL if they never logged one).
const _usersWithActivity = db.prepare(`
  SELECT u.id, u.name, u.avatar, u.avatar_file, u.avatar_v, u.created_at,
    (SELECT MAX(e.ts) FROM chore_events e WHERE e.user_id = u.id) AS last_chore_ts
  FROM house_users u ORDER BY u.name COLLATE NOCASE ASC`);
export function listHouseUsersWithActivity() { return _usersWithActivity.all(); }

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
  SELECT e.user_id, u.name, u.avatar, u.avatar_file, u.avatar_v, e.chore, e.ts
  FROM chore_events e JOIN house_users u ON u.id = e.user_id
  WHERE e.ts >= ? ORDER BY e.ts ASC`);
export function rankingSince(sinceMs) {
  const rows = _eventsSince.all(sinceMs);
  const by = new Map();
  for (const r of rows) {
    let agg = by.get(r.user_id);
    if (!agg) { agg = { user_id: r.user_id, name: r.name, avatar: r.avatar || null, avatar_file: r.avatar_file || null, avatar_v: r.avatar_v || null, points: 0, chores: 0, lastTs: 0 }; by.set(r.user_id, agg); }
    agg.points += chorePoints(r.chore);
    agg.chores += 1;
    if (r.ts > agg.lastTs) agg.lastTs = r.ts;
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.lastTs - a.lastTs);
}
const _recentActivity = db.prepare(`
  SELECT e.id, e.chore, e.note, e.ts, e.user_id, u.name, u.avatar, u.avatar_file, u.avatar_v
  FROM chore_events e JOIN house_users u ON u.id = e.user_id
  ORDER BY e.ts DESC LIMIT ?`);
export function recentActivity(limit = 20) { return _recentActivity.all(Math.min(limit, 100)); }

// ---- shared availability calendar -------------------------------------------
// Busy intervals are stored in one table (house_busy), tagged by source:
//   'manual' — typed in by hand (optional label), added/deleted one at a time.
//   'google' — pulled from the member's real Google Calendar (freeBusy API) in
//              the browser and pushed up in bulk; a reconnect REPLACES that
//              member's google rows wholesale.
// start/end are epoch ms (end > start).

// Add one MANUAL busy block. Returns the new row id.
const _addBusy = db.prepare("INSERT INTO house_busy(user_id, start_ms, end_ms, source, label, created_at) VALUES(?,?,?,'manual',?,?)");
export function addBusyBlock({ userId, startMs, endMs, label }) {
  const info = _addBusy.run(userId, startMs, endMs, label ? String(label).slice(0, 120) : null, Date.now());
  return info.lastInsertRowid;
}
// Delete one of a user's OWN MANUAL blocks (google rows are not user-deletable —
// they're owned by the sync). Returns rows removed.
const _delBusyForUser = db.prepare("DELETE FROM house_busy WHERE id = ? AND user_id = ? AND source = 'manual'");
export function deleteBusyBlock({ userId, id }) { return _delBusyForUser.run(parseInt(id, 10), userId).changes; }

// REPLACE a user's google-sourced busy intervals with a fresh set (the browser
// re-runs freeBusy on every connect/refresh). Done in one transaction so the
// member's availability is never momentarily empty. `intervals` is [{start,end}]
// epoch ms. Returns how many rows were written.
const _delGoogleForUser = db.prepare("DELETE FROM house_busy WHERE user_id = ? AND source = 'google'");
const _addGoogle = db.prepare("INSERT INTO house_busy(user_id, start_ms, end_ms, source, label, created_at) VALUES(?,?,?,'google',NULL,?)");
const _replaceGoogle = db.transaction((userId, intervals) => {
  _delGoogleForUser.run(userId);
  const now = Date.now();
  for (const iv of intervals) _addGoogle.run(userId, iv.start, iv.end, now);
  return intervals.length;
});
export function replaceGoogleBusy(userId, intervals) { return _replaceGoogle(userId, intervals || []); }
// Forget a user's google busy intervals (disconnect). Returns rows removed.
export function clearGoogleBusy(userId) { return _delGoogleForUser.run(userId).changes; }

// A user's own blocks that haven't fully ended yet (upcoming/ongoing), with source.
const _busyForUser = db.prepare('SELECT id, start_ms, end_ms, source, label FROM house_busy WHERE user_id = ? AND end_ms >= ? ORDER BY start_ms ASC');
export function busyBlocksForUser(userId, sinceMs = Date.now()) { return _busyForUser.all(userId, sinceMs); }
// Count a user's google-sourced rows that are still relevant (for "connected").
const _googleCountForUser = db.prepare("SELECT COUNT(*) n FROM house_busy WHERE user_id = ? AND source = 'google' AND end_ms >= ?");
export function googleBusyCount(userId, sinceMs = Date.now()) { return _googleCountForUser.get(userId, sinceMs).n; }
// Every member's blocks overlapping [fromMs, toMs] (for the free-window calc).
const _busyInWindow = db.prepare('SELECT user_id, start_ms, end_ms, source FROM house_busy WHERE end_ms >= ? AND start_ms <= ?');
export function busyBlocksInWindow(fromMs, toMs) { return _busyInWindow.all(fromMs, toMs); }
// Which members have a calendar CONNECTION right now — i.e. any busy row (google
// OR manual) that hasn't fully ended yet. This is deliberately independent of the
// short free-window scan: a member who synced Google but happens to be free for
// the next few days is still "connected" (they just have no upcoming busy time),
// so the wall widget shows their availability instead of "sync a calendar".
const _connectedMembers = db.prepare('SELECT DISTINCT user_id FROM house_busy WHERE end_ms >= ?');
export function connectedMemberIds(sinceMs = Date.now()) {
  return new Set(_connectedMembers.all(sinceMs).map((r) => r.user_id));
}
// Prune busy blocks that ended before `beforeMs` (housekeeping; not exposed).
const _pruneBusy = db.prepare('DELETE FROM house_busy WHERE end_ms < ?');
export function pruneBusyBlocks(beforeMs) { return _pruneBusy.run(beforeMs).changes; }

export default db;
