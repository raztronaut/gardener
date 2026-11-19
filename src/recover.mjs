// Crash recovery — run on every boot (by the main server) and before each
// iteration. Preserves shared work and reconciles iteration bookkeeping.
//
// Safety rules (hardened after adversarial review):
//   - NEVER touch an iteration whose owning process is still alive (e.g. the
//     review render-harness, or a genuinely-running iteration). Only dead ones.
//   - If a dead iteration's deploy commit already landed (HEAD == result_commit),
//     finalize it as committed rather than reverting shipped, tested work.
//   - Otherwise mark interrupted; never reset, clean, or rewind the shared checkout.
import { unfinishedIterations, finishIteration, clearStaleLock, pidAlive } from './db.mjs';
import * as git from './gitlib.mjs';
import { appendFileSync } from 'node:fs';
import { paths } from './config.mjs';

function log(msg) {
  const line = `[${new Date().toISOString()}] [recover] ${msg}\n`;
  try { appendFileSync(paths.ITERATE_LOG, line); } catch { /* ignore */ }
  process.stderr.write(line);
}

export function recover() {
  clearStaleLock();
  if (!git.isRepo()) { log('not a git repo yet — skipping tree recovery'); return; }

  const stuck = unfinishedIterations();
  if (stuck.length === 0) {
    if (git.isDirty()) log('working tree dirty but no iteration in flight — leaving as-is');
    return;
  }

  for (const it of stuck) {
    // Owner still alive? Leave it completely alone (this is the common false
    // alarm: a child server boot, or recovery racing a live iteration).
    if (it.pid && pidAlive(it.pid)) {
      log(`iteration #${it.id} still owned by live pid ${it.pid} — skipping`);
      continue;
    }
    // Dead owner whose deploy commit already landed → accept it, don't revert.
    if (it.result_commit && git.head() === it.result_commit) {
      log(`iteration #${it.id} deploy commit ${it.result_commit.slice(0, 8)} already at HEAD — finalizing as committed`);
      finishIteration(it.id, 'committed', { error: 'finalized on recovery (commit had landed)' });
      continue;
    }
    // Neither dirty work nor a clean, newer HEAD belongs to this dead process.
    log(`iteration #${it.id} interrupted; preserving working files and current HEAD`);
    finishIteration(it.id, 'crashed', {error:'Interrupted; working files and HEAD preserved for review.'});
  }
  log(`recovery complete (${stuck.length} stuck iteration(s) examined)`);
}
