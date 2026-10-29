// The Gardener™ — plain names for "Out in SF" events. Scraped listing titles are often
// cryptic ("TERRORiums! Special Halloween Edition"); a small, cheap Claude model rewrites
// each NEW title into a few plain words saying what the event is ("Halloween terrarium
// workshop"), short enough to always fit on one line of the card. The full original
// title, time, place and description stay one tap away (the event's detail view).
//
// - Once a day (and at startup when stale), the server fetches the events itself and
//   names any title it hasn't seen; titles that appear later in the day are named
//   lazily when the wall asks (rate-limited). Names are cached forever per title in
//   data/event-names.json, so a weekly event is named once.
// - Model: Claude Haiku 5.5 through the official SDK, structured JSON output (zod).
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config, paths } from './config.mjs';
import { fetchEvents } from '../public/lib/events.js';

const FILE = join(paths.DATA, 'event-names.json');
const MODEL = 'claude-haiku-5-5';
const MAX_LEN = 28;          // fits one line of the card at its type size
const BATCH = 40;
const LAZY_GAP_MS = 10 * 60 * 1000;

let cache = null, saving = null, running = null, lastLazy = 0;
async function load() {
  if (cache) return cache;
  try { cache = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { cache = {}; }
  cache.names ||= {}; cache.lastDaily ||= 0;
  return cache;
}
// writes are chained (never two at once) and awaited, so a name is never lost to an exit
function save() {
  saving = (saving || Promise.resolve()).then(() => fs.writeFile(FILE + '.tmp', JSON.stringify(cache)))
    .then(() => fs.rename(FILE + '.tmp', FILE)).catch(() => {});
  return saving;
}
// the key is the event's cleaned title (lib/events.js cleanName) — same title, same name
const keyOf = (title) => String(title || '').trim().toLowerCase();

const SYSTEM = `You rename San Francisco event listings into short, plain names that say what the event is, for a calm home dashboard.
Rules for every name:
- At most ${MAX_LEN} characters, including spaces. Count carefully.
- Plain words describing the activity, e.g. "Halloween terrarium workshop", "Free standup comedy night", "Art projection on Market St", "Wastewater plant tour", "Board game night".
- No dates, days, times, prices, emojis, hashtags, exclamation marks or ALL CAPS.
- Drop venue names and promoter branding unless the venue IS the event (e.g. "Golden Gate Park" walk).
- Keep a proper name only when it is the point (e.g. "Fleet Week airshow").
- Sentence case. Never just repeat a cryptic title — say what people actually do there.`;

const Schema = z.object({ names: z.array(z.object({ id: z.number().int(), name: z.string() })) });

let client = null;
async function nameBatch(items) {
  client ||= new Anthropic({ apiKey: config.apiKey || undefined });
  const listing = items.map((e, i) => `${i}. ${e.title}${e.place ? ` — at ${e.place}` : ''}${e.description ? ` — ${e.description.replace(/\s+/g, ' ').slice(0, 220)}` : ''}`).join('\n');
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(Schema) },
    messages: [{ role: 'user', content: `Name each event (use its number as id):\n${listing}` }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) return {};
  const out = {};
  for (const { id, name } of res.parsed_output.names) {
    const e = items[id]; if (!e) continue;
    let n = String(name || '').replace(/\s+/g, ' ').replace(/[!#]/g, '').trim();
    if (n.length > MAX_LEN) n = n.slice(0, MAX_LEN + 1).replace(/\s+\S*$/, '').trim(); // cut at a word
    if (n.length >= 3) out[keyOf(e.title)] = n;
  }
  return out;
}

// Name every event whose title isn't cached yet. Returns how many were named.
export async function nameEvents(events, log = () => {}) {
  if (!config.apiKey) return 0;
  const c = await load();
  const todo = [], seen = new Set();
  for (const e of events) {
    const k = keyOf(e.title);
    if (!k || c.names[k] || seen.has(k)) continue;
    seen.add(k); todo.push(e);
  }
  let named = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    try {
      const got = await nameBatch(todo.slice(i, i + BATCH));
      for (const [k, n] of Object.entries(got)) { c.names[k] = { name: n, at: Date.now() }; named++; }
    } catch (err) { log(`event names: ${err.message || err}`); break; }
  }
  if (named) await save();
  return named;
}

// The daily pass: fetch the listings server-side (same source + cleaning as the wall)
// and name what's new.
export async function dailyNames(log = () => {}) {
  if (running) return running;
  running = (async () => {
    const c = await load();
    const fetchJSON = (url) => fetch(url, { signal: AbortSignal.timeout(20000) }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const evs = await fetchEvents(fetchJSON);
    const n = await nameEvents(evs.map((e) => ({ title: e.name, place: e.place, description: e.description })), log);
    c.lastDaily = Date.now(); await save();
    log(`event names: daily pass — ${evs.length} events, ${n} newly named`);
    return n;
  })().finally(() => { running = null; });
  return running;
}
export async function dailyIsStale() { const c = await load(); return Date.now() - c.lastDaily > 20 * 3600 * 1000; }

// For the wall: names for the given titles; unknown ones are named in the background
// (at most every LAZY_GAP_MS), so they show on a later refresh.
export async function namesFor(titles, log = () => {}) {
  const c = await load();
  const out = {}, missing = [];
  for (const t of titles) { const k = keyOf(t); if (c.names[k]) out[t] = c.names[k].name; else if (k) missing.push({ title: t }); }
  if (missing.length && Date.now() - lastLazy > LAZY_GAP_MS && !running) {
    lastLazy = Date.now();
    nameEvents(missing, log).then((n) => n && log(`event names: ${n} named on demand`)).catch(() => {});
  }
  return out;
}
