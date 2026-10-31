// The Gardener™ — the clock's two-word garden poem (three words until 2026-10-30) (it replaced "Good night" /
// "Good morning", humans 2026-10-30). One a DAY, written by the daily tending
// (iterate.mjs → tendPoem) for that day (season, the date); the server writes it as a
// fallback when the tending didn't (from 07:00). The last 100 poems go into the prompt
// so it never repeats itself or settles into a favourite image. data/poems.json.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config, paths } from './config.mjs';

const FILE = join(paths.DATA, 'poems.json');
const MODEL = 'claude-opus-5-5';
const LAST_P = 100;               // how many past poems the prompt sees
const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

let state = null, running = null, client = null;
// read fresh every time: the tending (iterate.mjs) and the server are separate processes
async function load() {
  try { state = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { state = {}; }
  state.poems ||= [];
  return state;
}
async function save() {
  await fs.writeFile(FILE + '.tmp', JSON.stringify(state));
  await fs.rename(FILE + '.tmp', FILE);
}

const SYSTEM = `You write two-word poems for a garden dashboard on a wall in a San Francisco home. One poem a day appears above the clock, in place of "Good morning".
Rules:
- Exactly two words, written as one sentence: the first word capitalized, ending with a period. No title, quotation marks, emojis or hashtags.
- It must be FUNNY — a real laugh or at least a grin: wit, absurdity, deadpan, a pun, a garden creature or plant with an attitude. Clever, never mean or crude.
- About gardens, plants, soil, weather, seasons, bugs and small creatures — the living garden.
- Fit the day you are given (the season, the month, a holiday near it) without naming the date.
- Be original: no clichés, no stock jokes. It must not repeat, closely echo, or reuse the key words or the joke of any recent poem you are shown — find a new angle each day.`;

const Schema = z.object({ poem: z.string() });
const words = (s) => s.trim().split(/\s+/).filter(Boolean);

async function write(now = new Date()) {
  client ||= new Anthropic({ apiKey: config.apiKey || undefined });
  const s = await load();
  const tz = config.tz || 'America/Los_Angeles';
  const moment = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
  const recent = s.poems.slice(-LAST_P).map((p) => p.text);
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(Schema) },
    messages: [{ role: 'user', content: `The day: ${moment} in San Francisco.\n\n`
      + (recent.length ? `The last ${recent.length} poems (do not repeat or echo them):\n${recent.join('\n')}\n\n` : '')
      + 'Write the next poem.' }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error('no poem');
  let text = String(res.parsed_output.poem).replace(/["“”#]/g, '').replace(/\s+/g, ' ').trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);        // capitalized…
  text = text.replace(/[.!?…,;:]*$/, '') + '.';                // …and ending with a period
  if (words(text).length !== 2 || text.length > 32) throw new Error(`not two words: ${text}`);
  if (recent.some((p) => p.toLowerCase() === text.toLowerCase())) throw new Error(`repeat: ${text}`);
  s.poems.push({ text, at: now.getTime() });
  s.poems = s.poems.slice(-LAST_P);
  await save();
  return text;
}

// Write today's poem unless there already is one. { fallback: true } (the server's
// check) waits until 07:00 so the 06:00 tending gets to write it first.
export function tendPoem(log = () => {}, { fallback = false } = {}) {
  if (!config.apiKey) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    const s = await load();
    const last = s.poems[s.poems.length - 1];
    if (last && dayKey(last.at) === dayKey(Date.now())) return;
    const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: config.tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()), 10);
    if (fallback && last && hour < 7) return; // (the very first poem doesn't wait)
    try { log(`poem: ${await write()}`); }
    catch (e) { log(`poem: ${e.message || e}`); }
  })().finally(() => { running = null; });
  return running;
}
export async function currentPoem() {
  const s = await load();
  return s.poems[s.poems.length - 1] || null;
}
