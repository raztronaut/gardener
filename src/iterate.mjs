// The Gardener™ — the daily iteration loop (the brain).
//
// Runs (scheduled ~06:00 PT, or manually). Compiles the day's feedback, lets the
// Claude Agent SDK tend the garden, then independently verifies with smoke tests
// + a headless screenshot + a vision review. Deploys ONLY on green (git commit +
// version bump → kiosk auto-reloads); otherwise reverts the working tree to the
// last known-good commit. Crash-safe: any failure or abort leaves HEAD intact.
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { appendFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config, paths } from './config.mjs';
import {
  getPendingFeedback, createIteration, finishIteration, updateIteration,
  acquireLock, releaseLock, refreshLock, recentIterations, finalizeDeployTx,
} from './db.mjs';
import * as git from './gitlib.mjs';
import { recover } from './recover.mjs';
import { buildSystemPrompt, buildUserPrompt } from './systemPrompt.mjs';
import { captureUrl } from './screenshot.mjs';
import { reviewScreenshot } from './visualReview.mjs';

const pExecFile = promisify(execFile);
const REVIEW_PORT = 8795;
const MAX_FIX = 2;
const AGENT_TIMEOUT_MS = 25 * 60 * 1000;
const FIX_TIMEOUT_MS = 12 * 60 * 1000;

let logFile = paths.ITERATE_LOG;
function log(msg) {
  const line = `[${new Date().toISOString()}] [iterate] ${msg}\n`;
  try { appendFileSync(logFile, line); } catch { /* ignore */ }
  process.stdout.write(line);
}

// ---- subagents the Gardener may fan out to --------------------------------
const AGENTS = {
  'api-scout': {
    description: 'Researches free, keyless, reputable public APIs and reports exact endpoints, params, response shapes, and whether CORS/proxy is needed. Use for any unfamiliar data source.',
    tools: ['WebSearch', 'WebFetch', 'Read', 'Bash'],
    prompt: 'You research public data APIs. Find FREE, KEYLESS, reputable JSON APIs. Report the exact request URL, query params, an example response shape, rate limits, and the hostname to add to the proxy allowlist. Be concrete and verified.',
  },
  'widget-builder': {
    description: 'Builds or substantially revises ONE self-contained vanilla-JS dashboard widget end to end against the widget contract, including graceful loading/error states. Use for non-trivial widgets.',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch'],
    prompt: 'You build a single self-contained ES-module widget for The Gardener (see public/app.js contract and existing widgets for the pattern). No frameworks, no npm deps, no build step. Always render loading then data, with a graceful error/empty state. Use the theme CSS variables. Keep it within the 900×1600 9:16 canvas.',
  },
  'designer': {
    description: 'Refines visual design, layout, typography, spacing, color and micro-animation for the locked 900×1600 9:16 canvas without breaking functionality. Use for beautification passes.',
    tools: ['Read', 'Edit', 'Glob', 'Grep'],
    prompt: 'You are a meticulous visual designer for a wall-mounted 900×1600 (9:16) ambient display. Improve hierarchy, balance, legibility-from-distance, spacing, and tasteful motion using the existing CSS variables. Never break layout or overflow the frame.',
  },
  'bug-fixer': {
    description: 'Diagnoses and fixes failing smoke tests or runtime errors quickly and surgically. Use when `npm run smoke` is red.',
    tools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep'],
    prompt: 'You fix failures fast and surgically. Read the failing smoke output, find the root cause, make the minimal correct fix, and re-run `npm run smoke` until it is green. Do not introduce new features.',
  },
};

// ---- run the agent (one query) --------------------------------------------
async function runAgent({ prompt, timeoutMs, transcriptPath, label }) {
  const ac = new AbortController();
  const timer = setTimeout(() => { log(`${label}: timeout ${Math.round(timeoutMs / 60000)}m — aborting`); ac.abort(); }, timeoutMs);
  let summary = '';
  let lastAssistantText = '';
  let success = false;
  let turns = 0;
  try {
    const q = query({
      prompt,
      options: {
        cwd: paths.ROOT,
        model: config.model,
        systemPrompt: buildSystemPrompt(),
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent', 'TodoWrite'],
        agents: AGENTS,
        settingSources: [],
        maxTurns: 80,
        abortController: ac,
        env: { ...process.env, ANTHROPIC_API_KEY: config.apiKey },
      },
    });
    for await (const m of q) {
      try { appendFileSync(transcriptPath, JSON.stringify(m) + '\n'); } catch { /* ignore */ }
      if (m.type === 'assistant' && m.message?.content) {
        const txt = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (txt.trim()) { lastAssistantText = txt; }
        turns++;
      } else if (m.type === 'result') {
        success = m.subtype === 'success';
        if (typeof m.result === 'string' && m.result.trim()) summary = m.result;
      }
    }
  } catch (e) {
    log(`${label}: agent error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  return { summary: (summary || lastAssistantText || '').slice(0, 4000), success, turns };
}

// ---- independent smoke run -------------------------------------------------
async function runSmoke() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(paths.ROOT, 'smoke', 'smoke.mjs')], {
      cwd: paths.ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 150000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, output: out }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, output: 'spawn error: ' + e.message }); });
  });
}

// ---- headless screenshot + vision review -----------------------------------
async function captureAndReview(iterDir) {
  // GARDENER_NO_RECOVER=1: this child must NEVER run crash recovery, or it would
  // revert the very (uncommitted) work we are about to screenshot.
  const server = spawn(process.execPath, [join(paths.ROOT, 'src', 'server.mjs')], {
    cwd: paths.ROOT, env: { ...process.env, GARDENER_PORT: String(REVIEW_PORT), GARDENER_NO_RECOVER: '1' }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    // wait for health — fail loudly if the review server never binds (e.g. port
    // clash), so a connection-error page can't masquerade as a layout defect.
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://127.0.0.1:${REVIEW_PORT}/api/health`); if (r.ok) { healthy = true; break; } } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!healthy) throw new Error(`review server did not become healthy on ${REVIEW_PORT}`);
    const shot = join(iterDir, 'screenshot.png');
    await captureUrl(`http://127.0.0.1:${REVIEW_PORT}/?screenshot=1`, shot, { waitMs: 7000 });
    try { copyFileSync(shot, join(paths.SCREENSHOTS, 'latest.png')); } catch { /* ignore */ }
    let verdict = { ok: true, score: null, issues: [], notes: 'review skipped' };
    try { verdict = await reviewScreenshot(shot); } catch (e) { log(`visual review failed (non-blocking): ${e.message}`); }
    return { shot, verdict };
  } finally {
    try { server.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

function summarizeIssues(verdict) {
  return (verdict.issues || []).map((i) => `- [${i.severity}] ${i.description}${i.fix ? ` → fix: ${i.fix}` : ''}`).join('\n');
}

// ---- main ------------------------------------------------------------------
async function main() {
  const trigger = process.argv[2] || 'manual';
  recover();
  if (!acquireLock()) { log('another iteration holds the lock — exiting'); process.exit(0); }
  // Heartbeat the lock so a long-but-healthy run is never seen as stale/stealable.
  const heartbeat = setInterval(() => { try { refreshLock(); } catch { /* ignore */ } }, 60 * 1000);

  // Start from a clean, known-good base (HEAD). Discard any stray working changes.
  if (git.isRepo() && git.isDirty()) { log('working tree dirty at start — resetting to HEAD'); git.resetHard('HEAD'); }
  const baseCommit = git.head();

  const feedbackItems = getPendingFeedback();
  const feedbackIds = feedbackItems.map((f) => f.id); // consume ONLY these at deploy; mid-run feedback stays pending
  const date = new Date().toLocaleDateString('en-US', { timeZone: config.tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const iterId = createIteration({ trigger, baseCommit, feedbackCount: feedbackItems.length });
  const iterDir = join(paths.ITERATIONS, String(iterId));
  mkdirSync(iterDir, { recursive: true });
  logFile = join(iterDir, 'iterate.log');
  const transcript = join(iterDir, 'transcript.jsonl');

  log(`=== iteration #${iterId} (${trigger}) base=${baseCommit?.slice(0, 8)} feedback=${feedbackItems.length} ===`);

  const history = recentIterations(5).filter((it) => it.id !== iterId)
    .map((it) => `#${it.id} ${it.status}: ${(it.summary || it.error || '').slice(0, 160)}`).join('\n');
  const userPrompt = buildUserPrompt({ feedbackItems, date, history });
  writeFileSync(join(iterDir, 'prompt.md'), userPrompt);

  let deployed = false;
  let finalSummary = '';
  let lastVerdict = null;
  try {
    // 1) Main tending pass
    const run = await runAgent({ prompt: userPrompt, timeoutMs: AGENT_TIMEOUT_MS, transcriptPath: transcript, label: 'tend' });
    finalSummary = run.summary;
    log(`tend complete (turns=${run.turns}, success=${run.success}); summary: ${finalSummary.slice(0, 200)}`);

    // 2) Verify + bounded self-heal on smoke failures
    updateIteration(iterId, { status: 'testing' });
    let smoke = await runSmoke();
    log(`smoke: ${smoke.ok ? 'GREEN' : 'RED'}`);
    for (let attempt = 1; !smoke.ok && attempt <= MAX_FIX; attempt++) {
      const failTail = smoke.output.split('\n').slice(-40).join('\n');
      log(`smoke red — self-heal attempt ${attempt}/${MAX_FIX}`);
      await runAgent({
        prompt: `\`npm run smoke\` is FAILING and must be fixed. Use the bug-fixer subagent if helpful.\n\n`
          + `Here is the failing output:\n\n\`\`\`\n${failTail}\n\`\`\`\n\n`
          + `Find the root cause, make the minimal correct fix, and run \`npm run smoke\` until it is GREEN. Do not add features.`,
        timeoutMs: FIX_TIMEOUT_MS, transcriptPath: transcript, label: `fix-smoke-${attempt}`,
      });
      smoke = await runSmoke();
      log(`smoke after fix ${attempt}: ${smoke.ok ? 'GREEN' : 'RED'}`);
    }
    if (!smoke.ok) {
      writeFileSync(join(iterDir, 'smoke-fail.txt'), smoke.output);
      throw new Error('smoke tests still failing after self-heal — reverting');
    }

    // 3) Visual review (BEST-EFFORT) + bounded self-heal on critical defects.
    //    Smoke (incl. render integrity) is the hard deploy gate. Review-infra
    //    failures (e.g. port clash, screenshot error) are non-blocking — they
    //    must never roll back a green tree. But a visual fix that BREAKS smoke
    //    is a real regression → hard fail → rollback.
    updateIteration(iterId, { status: 'reviewing' });
    let smokeBrokenByFix = false;
    try {
      let { verdict } = await captureAndReview(iterDir);
      lastVerdict = verdict;
      log(`visual review: ok=${verdict.ok} score=${verdict.score} notes="${(verdict.notes || '').slice(0, 160)}"`);
      let critical = (verdict.issues || []).filter((i) => i.severity === 'critical');
      for (let attempt = 1; critical.length && attempt <= MAX_FIX; attempt++) {
        log(`visual critical issues (${critical.length}) — refine attempt ${attempt}/${MAX_FIX}`);
        await runAgent({
          prompt: `A vision review of the rendered 900×1600 dashboard found CRITICAL visual defects. Fix them, then run \`npm run smoke\` and keep it GREEN.\n\n`
            + `Issues:\n${summarizeIssues({ issues: critical })}\n\nFull notes: ${verdict.notes || ''}\n\n`
            + `Use the designer subagent if helpful. Keep changes surgical and within the 9:16 canvas.`,
          timeoutMs: FIX_TIMEOUT_MS, transcriptPath: transcript, label: `fix-visual-${attempt}`,
        });
        const reSmoke = await runSmoke();
        if (!reSmoke.ok) { writeFileSync(join(iterDir, 'smoke-fail.txt'), reSmoke.output); smokeBrokenByFix = true; break; }
        ({ verdict } = await captureAndReview(iterDir));
        lastVerdict = verdict;
        critical = (verdict.issues || []).filter((i) => i.severity === 'critical');
        log(`visual review after refine ${attempt}: ok=${verdict.ok} score=${verdict.score} critical=${critical.length}`);
      }
    } catch (e) {
      log(`visual review infra failed (non-blocking — keeping the green tree): ${e.message}`);
    }
    if (smokeBrokenByFix) throw new Error('a visual fix broke smoke — reverting');

    // 4) Deploy on green. git commit is the point of no return; record the
    //    result_commit durably BEFORE finalizing, then bump+consume+mark in one
    //    atomic transaction (so a crash can't apply a partial deploy).
    const resultCommit = git.commitAll(
      `tend #${iterId}: ${(finalSummary.split('\n')[0] || 'self-directed improvement').slice(0, 72)}\n\n`
      + `${finalSummary.slice(0, 1500)}\n\nGardener iteration ${iterId} (${trigger}, ${feedbackItems.length} feedback).`);
    updateIteration(iterId, { result_commit: resultCommit });
    const unresolved = (lastVerdict?.issues || []).filter((i) => i.severity === 'critical').length;
    const version = finalizeDeployTx({
      iterId, resultCommit, feedbackIds,
      summary: finalSummary.slice(0, 4000),
      reviewOk: lastVerdict?.ok ? 1 : 0,
      reviewScore: lastVerdict?.score ?? null,
      reviewNotes: (lastVerdict?.notes || '') + (unresolved ? ` | unresolved critical:${unresolved}` : ''),
      screenshot: join(iterDir, 'screenshot.png'),
    });
    deployed = true;
    log(`DEPLOYED iteration #${iterId} → commit ${resultCommit?.slice(0, 8)}, ui v${version}, consumed ${feedbackIds.length} feedback`);
  } catch (e) {
    log(`iteration FAILED: ${e.message} — rolling back to ${baseCommit?.slice(0, 8)}`);
    try { if (baseCommit) git.resetHard(baseCommit); else git.resetHard('HEAD'); } catch (re) { log(`rollback error: ${re.message}`); }
    finishIteration(iterId, 'failed', { error: e.message.slice(0, 1000), summary: finalSummary.slice(0, 2000), review_notes: lastVerdict ? summarizeIssues(lastVerdict).slice(0, 1000) : null });
  } finally {
    clearInterval(heartbeat);
    releaseLock();
  }
  log(`=== iteration #${iterId} done (deployed=${deployed}) ===`);
  process.exit(0);
}

main().catch((e) => { log(`fatal: ${e.stack || e}`); try { releaseLock(); } catch { /* ignore */ } process.exit(1); });
