// The Gardener™ — the Botanist bridge: "Hey Garden" → the Botanist, a Claude Code session
// running in Paseo on this machine (the agent that can change the system itself).
//
// Talks to the local Paseo daemon's MCP endpoint (HTTP JSON-RPC on 127.0.0.1:6767) — no
// child processes, no deps, ~0 MB (the `paseo` CLI costs ~200 MB + 2 s per call, too heavy
// for the voice service's 900 MB cap; it is only the fallback if the endpoint refuses).
//
// A Botanist task takes minutes, but a voice request is capped at 20 s, so it is async:
// ask() hands the words over and returns at once; a light watcher (one status call every
// 3 s, only while a voice task is in flight) reports back through `notify` when the Botanist
// needs a permission, and when it is done (its last message, shown on the wall).
//
// Only TEXT crosses this bridge (the transcript of the request, the Botanist's reply).
// The target agent: GARDENER_BOTANIST_AGENT, else data/voice/botanist.json { agentId }.
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { paths } from './config.mjs';

const MCP_URL = process.env.GARDENER_PASEO_MCP || 'http://127.0.0.1:6767/mcp/agents';
const PASEO_CLI = process.env.GARDENER_PASEO_CLI || join(homedir(), '.local/bin/paseo');
const POLL_MS = 3000, WATCH_MAX_MS = 45 * 60 * 1000;

export function botanistId() {
  if (process.env.GARDENER_BOTANIST_AGENT) return process.env.GARDENER_BOTANIST_AGENT;
  try { return JSON.parse(readFileSync(join(paths.DATA, 'voice', 'botanist.json'), 'utf8')).agentId || null; } catch { return null; }
}

let rpcId = 0;
async function mcp(name, args, timeoutMs = 8000) {
  const res = await fetch(MCP_URL, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`paseo mcp ${res.status}`);
  const body = await res.text();
  // streamable HTTP: either plain JSON or one SSE "data:" line
  const line = body.trim().startsWith('{') ? body : (body.split('\n').find((l) => l.startsWith('data:')) || '').slice(5);
  const msg = JSON.parse(line);
  if (msg.error) throw new Error(msg.error.message || 'paseo mcp error');
  const r = msg.result || {};
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text || 'paseo tool failed');
  try { return r.structuredContent || JSON.parse(text); } catch { return text; }
}

const cli = (args, timeoutMs = 15000) => new Promise((resolve, reject) => {
  execFile(PASEO_CLI, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, out) => (err ? reject(err) : resolve(out)));
});

const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
const tidy = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();

async function status(id) {
  const s = await mcp('get_agent_status', { agentId: id });
  const snap = s.snapshot || s;
  const perms = snap.pendingPermissions || s.pendingPermissions || [];
  return { status: String(s.status || snap.status || 'unknown'), perms, title: snap.title || '' };
}

// The Botanist's latest words: the most recent assistant message in its timeline.
// The timeline is one text: "[Message received] <sender>\n<prompt lines>\n<reply lines>",
// "[Shell] <command>\n<reply lines>", ... oldest first. The reply = the lines after the last
// "[...]" header, minus that header's own line(s) — for a received message, its prompt.
async function lastReply(id, sentPrompt = '') {
  const a = await mcp('get_agent_activity', { agentId: id, limit: 12 });
  const text = String(typeof a === 'string' ? a : a.content || a.activity || '');
  const lines = text.split('\n');
  let h = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^\[[A-Z][^\]]*\]/.test(lines[i])) { h = i; break; }
  if (h < 0) return '';
  let rest = lines.slice(h + 1);
  if (/^\[Message received\]/.test(lines[h])) {
    const sent = new Set(String(sentPrompt).split('\n').map((l) => l.trim()).filter(Boolean));
    rest = rest.filter((l) => !sent.has(l.trim()));
  }
  return tidy(rest.join('\n'));
}

// true while a voice-sent request is in flight (the wall asks on connect: its glow survives a reload)
export const botanistWorking = () => !!watching;
let watching = null; // { id, since, timer, prompt }
const announced = new Set(); // permission ids already shown (across watchers: never twice)

function watch(id, notify, log, prompt = '') {
  if (watching) clearInterval(watching.timer);
  const w = watching = { id, since: Date.now(), started: false, timer: null, prompt };
  const tick = async () => {
    if (watching !== w) return;
    if (Date.now() - w.since > WATCH_MAX_MS) { clearInterval(w.timer); watching = null; notify({ kind: 'idle' }); return; }
    let s;
    try { s = await status(id); } catch (err) { log(`botanist: status failed (${err.message})`); return; }
    for (const p of s.perms) {
      const key = p.id || p.requestId || JSON.stringify(p).slice(0, 80);
      if (announced.has(key)) continue;
      announced.add(key); if (announced.size > 200) announced.delete(announced.values().next().value);
      const what = p.name || p.toolName || p.title || 'something';
      // a command is shown as-is (its symbols matter); a description is tidied
      const cmd = p.input?.command || p.detail?.command;
      const why = cmd ? String(cmd).replace(/\s+/g, ' ').trim() : tidy(p.input?.description || (p.description !== '-' && p.description) || p.input?.file_path || '');
      notify({ kind: 'permission', text: `The Botanist asks to use ${what}${why ? `: ${clip(why, 140)}` : ''}. Say "Hey Garden, allow it" or "deny it".` });
    }
    const busy = /running|busy|working|thinking|initializ/i.test(s.status);
    if (busy) w.started = true;
    // done = idle again after it started (or idle well after the hand-over)
    if (!busy && !s.perms.length && (w.started || Date.now() - w.since > 15000)) {
      clearInterval(w.timer); watching = null;
      let reply = '';
      try { reply = await lastReply(id, w.prompt); } catch (err) { log(`botanist: activity failed (${err.message})`); }
      notify({ kind: /error|fail/i.test(s.status) ? 'error' : 'done', text: clip(reply || 'The Botanist is done.', 2400) });
    }
  };
  w.timer = setInterval(tick, POLL_MS);
  setTimeout(tick, 2500); // delivery happens after ~2 quiet seconds
}

// action: ask | status | allow | deny | stop
export async function botanist({ action = 'ask', task = '' } = {}, { notify = () => {}, log = () => {} } = {}) {
  const id = botanistId();
  if (!id) return { ok: false, error: 'The Botanist is not connected (no agent id set).' };
  try {
    if (action === 'ask') {
      if (!task.trim()) return { ok: false, error: 'no task' };
      const prompt = `Voice request via Hey Garden (spoken on the GardenOS wall; speech-to-text, so expect small recognition errors): "${clip(task, 1500)}"\n\nDo it. Your last message is shown on the wall to someone across the room: end with a short plain-language summary (1-3 sentences, no markdown, no code).`;
      try { await mcp('send_agent_prompt', { agentId: id, prompt, activeTurnBehavior: 'steer', notifyOnFinish: false }, 10000); }
      catch (err) { log(`botanist: mcp send failed (${err.message}) — using the CLI`); await cli(['send', id, '--no-wait', '--behavior', 'steer', '--prompt', prompt]); }
      watch(id, notify, log, prompt);
      notify({ kind: 'working' }); // the wall's quiet glow, until this request is done
      return { ok: true, say: 'Sent to the Botanist.' };
    }
    if (action === 'status') {
      const s = await status(id);
      let last = '';
      try { last = await lastReply(id); } catch { /* optional */ }
      const state = s.perms.length ? `waiting for your permission (${s.perms.map((p) => p.name || p.toolName || 'a tool').join(', ')})` : /running|busy|working/i.test(s.status) ? 'working on it' : 'idle';
      return { ok: true, info: `The Botanist is ${state}.${last ? ` Its latest message: ${clip(last, 600)}` : ''}` };
    }
    if (action === 'allow' || action === 'deny') {
      const s = await status(id);
      if (!s.perms.length) return { ok: false, error: 'The Botanist is not waiting for a permission.' };
      for (const p of s.perms) {
        await mcp('respond_to_permission', { agentId: id, requestId: p.id || p.requestId,
          response: action === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied by voice from the GardenOS wall.' } });
      }
      if (!watching) watch(id, notify, log);
      return { ok: true, say: action === 'allow' ? 'Allowed.' : 'Denied.' };
    }
    if (action === 'stop') {
      await mcp('cancel_agent', { agentId: id });
      if (watching) { clearInterval(watching.timer); watching = null; }
      notify({ kind: 'idle' });
      return { ok: true, say: 'The Botanist stopped.' };
    }
    return { ok: false, error: `unknown action ${action}` };
  } catch (err) {
    log(`botanist: ${action} failed (${err.message})`);
    return { ok: false, error: 'I couldn’t reach the Botanist.' };
  }
}
