// Crash recovery — run on every boot (by the server) and before each iteration.
// Guarantees the served UI is a consistent, committed, known-good state.
//
// The only situation we auto-revert the working tree is when an iteration was
// in flight when the process died. A dirty tree with NO in-flight iteration is
// left untouched (it may be intentional manual editing during development).
import { unfinishedIterations, finishIteration, clearStaleLock } from './db.mjs';
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
    if (git.isDirty()) log('working tree is dirty but no iteration was in flight — leaving as-is');
    return;
  }

  for (const it of stuck) {
    const target = it.base_commit || git.head();
    log(`iteration #${it.id} was in flight (status=${it.status}); reverting tree to ${target?.slice(0, 8)}`);
    try {
      if (target) git.resetHard(target);
      else git.resetHard('HEAD');
    } catch (e) {
      log(`reset failed: ${e.message}`);
    }
    finishIteration(it.id, 'crashed', { error: 'process died mid-iteration; tree reverted on recovery' });
  }
  log(`recovery complete (${stuck.length} stuck iteration(s) cleared)`);
}
