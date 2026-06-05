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

export default db;
