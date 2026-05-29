// Thin git wrapper — git is The Gardener's consistency substrate.
// Invariant: HEAD is ALWAYS a known-good, smoke-tested UI state.
// The working tree only diverges from HEAD during an active iteration; any
// crash or failure resets it back to HEAD (or the iteration's base commit).
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
  try { return git(['status', '--porcelain']).length > 0; } catch { return false; }
}
export function commitAll(message) {
  git(['add', '-A']);
  // Nothing staged? skip (avoids "nothing to commit" error).
  const staged = git(['diff', '--cached', '--name-only']);
  if (!staged) return head();
  git(['commit', '-m', message, '--no-verify']);
  return head();
}
export function resetHard(ref = 'HEAD') {
  git(['reset', '--hard', ref]);
  git(['clean', '-fd']); // remove untracked files/dirs; gitignored (data/, node_modules, .env) are preserved
}
export function shortLog(n = 10) {
  try { return git(['log', `-${n}`, '--pretty=format:%h %ad %s', '--date=short']); } catch { return ''; }
}
