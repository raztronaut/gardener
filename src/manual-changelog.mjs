// Manual work is a daily digest of completed work in Paseo chats, separate from
// autonomous tendings. Only user/assistant text is read; no tools or reasoning.
import { promises as fs, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { config } from './config.mjs';
import { getKV } from './db.mjs';

const KEY = 'manual_changelog_v1';
export const dayKey = (t) => new Intl.DateTimeFormat('en-CA', {
  timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(t));
export function manualEntries() {
  try { return JSON.parse(getKV(KEY, '[]')); } catch { return []; }
}
async function files(dir, suffix) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) out.push(...await files(join(dir, e.name), suffix));
    else if (e.name.endsWith(suffix)) out.push(join(dir, e.name));
  }
  return out;
}
export function chatMessage(d) {
  if (d.type === 'response_item' && d.payload?.type === 'message') {
    const p = d.payload;
    if (!['user', 'assistant'].includes(p.role) || (p.role === 'assistant' && p.phase !== 'final_answer')) return null;
    return { role: p.role, text: (p.content || []).filter(c => ['input_text', 'output_text'].includes(c.type)).map(c => c.text).join('\n') };
  }
  if (['user', 'assistant'].includes(d.type) && d.message && !d.isSidechain) {
    const c = d.message.content;
    return { role: d.type, text: typeof c === 'string' ? c : (c || []).filter(c => c.type === 'text').map(c => c.text).join('\n') };
  }
  return null;
}
const redact = (s) => s.replace(/\b(?:sk-[\w-]{12,}|Bearer\s+[\w.-]{12,})/gi, '[redacted]')
  .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');

export async function collectManualDays({ home = homedir(), days = 7, now = Date.now() } = {}) {
  const wanted = new Set(Array.from({ length: days }, (_, n) => dayKey(now - n * 86400000)));
  const agents = [];
  for (const path of await files(join(home, '.paseo/agents'), '.json')) {
    try {
      const a = JSON.parse(await fs.readFile(path, 'utf8'));
      // Internal agents / nightly tending are never manual sessions.
      if (Date.parse(a.lastActivityAt || a.updatedAt || a.createdAt) < now - (days + 1) * 86400000) continue;
      if (a.internal || a.labels?.['paseo.schedule-id'] || /daily tending|nightly tending|^tend #|changelog editor|reading room editor/i.test(a.title || '')) continue;
      const id = a.runtimeInfo?.sessionId || a.persistence?.sessionId;
      if (id) agents.push({ id, title: a.title || '', cwd: a.cwd || '' });
    } catch { /* an agent may be removed while scanning */ }
  }
  const paths = [...await files(join(home, '.codex/sessions'), '.jsonl'),
    ...await files(join(home, '.codex/archived_sessions'), '.jsonl'),
    ...await files(join(home, '.claude/projects'), '.jsonl')];
  const byDay = new Map();
  for (const a of agents) {
    const logs = paths.filter(p => p.includes(a.id));
    const messages = [];
    for (const path of logs) {
      if ((await fs.stat(path)).mtimeMs < now - (days + 1) * 86400000) continue;
      for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
        let d; try { d = JSON.parse(line); } catch { continue; }
        if (!d.timestamp || !Number.isFinite(Date.parse(d.timestamp))) continue;
        const day = dayKey(d.timestamp);
        if (!wanted.has(day)) continue;
        const m = chatMessage(d);
        if (m?.text) messages.push({ day, at: Date.parse(d.timestamp), ...m });
      }
    }
    // Root-workspace chats count when their actual messages concern GardenOS.
    // Environment/tool instructions are not evidence of relevant work.
    const relevant = /gardenos|gardener|garden os/i.test(a.title + ' ' + a.cwd) ||
      messages.some(m => /gardenos|\/home\/talbot\/gardener\b|garden os/i.test(m.text.replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')));
    if (!relevant) continue;
    for (const m of messages) {
      // Don't send bootstrap instructions or tool transcripts to the writer.
      if (/<environment_context>|^# (?:AGENTS|Instructions)|<instructions>/i.test(m.text)) continue;
      const list = byDay.get(m.day) || [];
      list.push({ at: m.at, session: a.id, role: m.role, text: redact(m.text) });
      byDay.set(m.day, list);
    }
  }
  return byDay;
}

