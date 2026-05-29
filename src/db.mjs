// The Gardener™ — durable persistence (SQLite, WAL, synchronous=FULL).
// Holds the precious user feedback + the iteration history + key/value state.
// WAL + FULL fsync gives crash-consistent durability: a power loss never loses
// an acknowledged feedback write and never leaves a torn DB.
import Database from 'better-sqlite3';
import { paths, ensureDirs } from './config.mjs';

ensureDirs();

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
const _consume = db.prepare('UPDATE feedback SET consumed_by = ? WHERE consumed_by IS NULL');
export function consumePendingFeedback(iterationId) { return _consume.run(iterationId).changes; }
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

// ---- iteration lock (single-writer guarantee across processes) -------------
const LOCK_KEY = 'iteration_lock';
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function acquireLock(ttlMs = 45 * 60 * 1000) {
  const cur = getKV(LOCK_KEY, null);
  if (cur) {
    try {
      const { pid, ts } = JSON.parse(cur);
      if (pidAlive(pid) && Date.now() - ts < ttlMs) return false; // genuinely held
    } catch { /* corrupt lock — steal it */ }
  }
  setKV(LOCK_KEY, JSON.stringify({ pid: process.pid, ts: Date.now() }));
  return true;
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
    const { pid } = JSON.parse(cur);
    if (!pidAlive(pid)) setKV(LOCK_KEY, '');
  } catch { setKV(LOCK_KEY, ''); }
}

export default db;
