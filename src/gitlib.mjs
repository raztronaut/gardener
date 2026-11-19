// Thin git wrapper — git is The Gardener's consistency substrate.
// This checkout is shared with humans and other agents. Automated callers must
// preserve working files and newer commits, including after a failed iteration.
import { execFileSync } from 'node:child_process';
import { ROOT } from './config.mjs';

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

export function isRepo() {
  try { return git(['rev-parse', '--is-inside-work-tree']) === 'true'; } catch { return false; }
}
export function head() {
  try { return git(['rev-parse', 'HEAD']); } catch { return null; }
}
export function isDirty() {
  return git(['status', '--porcelain', '--untracked-files=all']).length > 0;
}
export function commitAll(message) {
  git(['add', '-A']);
  // Nothing staged? skip (avoids "nothing to commit" error).
  const staged = git(['diff', '--cached', '--name-only']);
  if (!staged) return head();
  git(['commit', '-m', message, '--no-verify']);
  return head();
}
export function resetHard() {
  // A status check followed by reset/clean has a race with concurrent editing.
  // Keep this fail-closed API for old callers; no automated destructive reset.
  throw new Error('Automatic reset/clean is disabled in the shared Garden checkout. Working files are preserved.');
}
export function shortLog(n = 10) {
  try { return git(['log', `-${n}`, '--pretty=format:%h %ad %s', '--date=short']); } catch { return ''; }
}
