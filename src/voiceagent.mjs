// The Gardener™ — the "Hey Garden" agent: one spoken request (already text — the audio
// never leaves the machine, see src/voice.mjs) → Claude with tools that do anything the
// wall does by tap / click / controller, the web (search + fetch, run by the API), and an
// info sheet (`show`: a fullscreen panel built from a few primitives) → a short reply.
// It answers anything — not only wall commands. A few recent exchanges are kept in RAM
// (3 min) so follow-ups ("and tomorrow?") work.
//
// Fast path: the model is asked to call its tools AND write its one-line reply in the SAME
// turn, so a plain command ("open the weather") is a single model call; a second turn only
// happens when a tool fails or returns something the reply depends on.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.mjs';

const MODEL = process.env.GARDENER_VOICE_MODEL || 'claude-haiku-5-5';
const MAX_ROUNDS = 4;
let client = null;

const SYSTEM = `You are the voice of GardenOS, a calm smart display (a 9:16 portrait wall) in a San Francisco home, built by Gui Dávid. People speak to it by saying "Hey Garden" and then a request. You get the request as speech-to-text (it may have small recognition errors — infer what they meant) plus a JSON snapshot of what the wall shows right now.

You are a capable, friendly assistant, not only a remote control: answer any question — general knowledge, advice, ideas, maths, conversation. Your reply is shown as a short caption (people read it from across the room), so:
- Simple answers: a few plain sentences — as long as the answer needs, at most ~500 tokens; no markdown, no emojis. Most should be one to three sentences.
- Use web_search for anything current or that you aren't sure of (news, scores, prices, hours, recent events, people, weather elsewhere); web_fetch to read a specific page. Don't search for things you know well.
- When the answer is long or structured — a recipe, steps, a comparison, a list of options, a news roundup, details someone will want to read — call show with a well-organised sheet (a clear title, then the blocks that fit: text, list, steps, facts, table, quote, image, sources) and keep your caption to a few words. Don't use show for a one-line answer, and never just to repeat the caption. Cite sources (titles + urls) on sheets built from the web.

The speech-to-text doesn't know the wall's names — expect them misheard: Gardyn (the indoor garden widget) as "garden", "gardening", "open me"; Bomberman as "bomber man" or dropped ("play super, the garden edition" = Super Bomberman: The Garden Edition); Hacker News as "hacker", "the news"; Out in SF as "outing", "out in essay", "events"; the Trihourly Fractal as "fractal", "the art"; Painting of the Day as "the painting"; rainforest places (Amazon, Mata Atlântica = "atlantic", Borneo, Daintree, Olympic, Yosemite). Match to the closest real thing.

Act through your tools: they do exactly what tapping, clicking or the game controller does on the wall. Use the FEWEST calls — usually exactly one; never call a tool without its arguments, and never repeat a call. A request to DO something must always be done with a tool call — never answer it with words only. Rules:
- In the SAME response, call the tools you need AND write the reply: one short, warm sentence (at most ~10 words) saying what you did or answering, e.g. "Opening the weather." / "Volume down to 30%." / "It's 54° and clear tonight." No emojis, no markdown.
- Questions about what's on the wall (weather, air, events, news, the painting, the garden, the time): answer from the snapshot in at most ~20 words; open the widget too only if they ask to see it.
- To play a game: open the arcade AND select the game by name in the same response (names in arcadeGames).
- "Open X" while something else is open: just open X — it replaces what's open (never close first).
- "Go back to the menu", "the main menu", "home", "GardenOS", "the wall", "exit the arcade" = dashboard main — from anywhere, also from the Arcade or a game (it stops the game). That is ONE call: dashboard(main); nothing else.
- In a game, "close the game", "quit", "stop the game", "back to the games" = close (leaves the game, back to the Arcade library).
- "Close", "go back", "never mind", "stop": close what's open. "Scroll"/"next"/"down": press. "Open the third story" / "the pub crawl": select by its text or number.
- Volume: "louder"/"quieter" = change by ±10 unless they say how much; "mute" = set 0.
- Only plant a seed note when they ask to tell/ask the gardener something or to change/improve the wall — the note is their words, cleaned up.
- If something isn't possible, say so kindly in a few words. Never invent widgets, commands or facts that aren't in the snapshot or your sources.`;

const TOOLS = [
  { name: 'open', description: 'Open a widget fullscreen or a panel. target = a widget id from the snapshot (e.g. weather, air-quality, clock, daily = the painting, hacker-news, sf-events, gardyn, fractal) or one of: arcade, events, hn, help, tendings, notes, controls, credits, architecture, camera.',
    input_schema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } },
  { name: 'close', description: 'Close whatever is open: the fullscreen panel, a menu, the palette, or the running game (back to the wall).',
    input_schema: { type: 'object', properties: {} } },
  { name: 'select', description: 'Click an item in what is open (a story, an event, a game in the Arcade, a row, a button), by its visible text or by its 1-based position.',
    input_schema: { type: 'object', properties: { text: { type: 'string', description: 'words from the item' }, index: { type: 'integer', minimum: 1 } } } },
  { name: 'press', description: 'Press a controller button like the game pad does: up/down/left/right move the selection or scroll, ok = select, back = go back, page_up/page_down scroll a page.',
    input_schema: { type: 'object', properties: { button: { type: 'string', enum: ['up', 'down', 'left', 'right', 'ok', 'back', 'page_up', 'page_down'] }, times: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['button'] } },
  { name: 'volume', description: 'Speaker volume 0-100: set it, or change it by a signed amount.',
    input_schema: { type: 'object', properties: { set: { type: 'integer', minimum: 0, maximum: 100 }, change: { type: 'integer', minimum: -100, maximum: 100 } } } },
  { name: 'command', description: 'Run one of the wall\'s slash commands (the list is in the snapshot), with an optional argument — e.g. rainforest + amazon / off, night, refresh, grow, fps.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, arg: { type: 'string' } }, required: ['name'] } },
  { name: 'dashboard', description: 'Switch to a dashboard: main (the wall), arcade (the game library), gui (Gui\'s notes for Louise).',
    input_schema: { type: 'object', properties: { id: { type: 'string', enum: ['main', 'arcade', 'gui'] } }, required: ['id'] } },
  { name: 'zoom', description: 'Zoom the wall in, out, or back to 100%.',
    input_schema: { type: 'object', properties: { to: { type: 'string', enum: ['in', 'out', 'reset'] } }, required: ['to'] } },
  { name: 'plant', description: 'Plant a seed note for tonight\'s tending (how people ask the gardener to change or add something to the wall).',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'show', description: 'Open an info sheet fullscreen on the wall for answers worth reading (recipes, steps, comparisons, lists, news, details). Built from blocks, in order.',
    input_schema: { type: 'object', required: ['title', 'blocks'], properties: {
      title: { type: 'string', description: 'short, plain title' },
      subtitle: { type: 'string', description: 'optional one-line context (a date, a place, a source)' },
      blocks: { type: 'array', maxItems: 14, items: { type: 'object', required: ['type'], properties: {
        type: { type: 'string', enum: ['text', 'list', 'steps', 'facts', 'table', 'quote', 'image', 'sources'] },
        heading: { type: 'string', description: 'optional small heading above the block' },
        text: { type: 'string', description: 'text: a paragraph (2-4 sentences); quote: the quote' },
        by: { type: 'string', description: 'quote: who said it' },
        items: { type: 'array', items: {}, description: 'list / steps: strings; facts: {label, value}; sources: {title, url}' },
        columns: { type: 'array', items: { type: 'string' }, description: 'table: column names' },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table: rows of cells' },
        url: { type: 'string', description: 'image: an https image url from your sources' },
        caption: { type: 'string', description: 'image: a short caption' },
      } } },
    } } },
  // run by the API (results come back inside the same response)
  { type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'San Francisco', region: 'California', country: 'US', timezone: 'America/Los_Angeles' } },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2 },
];

const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
// recent exchanges (text only, RAM only) for follow-up questions
const HISTORY_MS = 3 * 60 * 1000;
let history = [];

export async function runAgent(text, { context, call, log = () => {} }) {
  if (!config.apiKey) return { ok: false, reply: 'I need an API key to do that.' };
  client ||= new Anthropic({ apiKey: config.apiKey });
  const t0 = Date.now();
  const snap = await context();
  if (process.env.GARDENER_VOICE_DEBUG === '1') log(`QA request: ${JSON.stringify(text)} snapshot: ${JSON.stringify(snap).slice(0, 300)}`);
  const now = new Intl.DateTimeFormat('en-US', { timeZone: config.tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date());
  const openNow = snap && snap.open ? `the "${snap.open.title}" panel is open` : snap && snap.dashboard && snap.dashboard !== 'main' ? `the ${snap.dashboard} dashboard is showing` : 'nothing is open (the main wall)';
  history = history.filter((h) => Date.now() - h.at < HISTORY_MS).slice(-6);
  const past = history.flatMap((h) => [{ role: 'user', content: `(earlier) "${h.q}"` }, { role: 'assistant', content: h.a || 'Done.' }]);
  const messages = [...past, { role: 'user', content: `It is ${now}. Right now ${openNow}${snap && snap.game && snap.game.playing ? ' and a game is running' : ''}. The wall:\n${clip(JSON.stringify(snap), 9000)}\n\nThe request: "${clip(text, 500)}"` }];
  let reply = '', lastFailed = false, acted = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 3000, system: SYSTEM, tools: TOOLS, messages });
    log(`model round ${round + 1}: ${Date.now() - t0} ms, ${res.usage?.input_tokens ?? '?'} in / ${res.usage?.output_tokens ?? '?'} out`);
    const said = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    if (said) reply = said;
    // a long server-side search can pause the turn: hand it back to carry on
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    // one call per tool per turn (a second select/open after the first one navigated is
    // always a misfire); presses may repeat
    const seen = new Set();
    let uses = res.content.filter((b) => b.type === 'tool_use' && (b.name === 'press' || !seen.has(b.name)) && seen.add(b.name));
    // opening something replaces what's open — a close in the same turn would undo it
    if (uses.some((u) => u.name === 'open' || u.name === 'dashboard')) uses = uses.filter((u) => u.name !== 'close');
    if (!uses.length) break;                     // answered (or explained a failure)
    const got = await call(uses.map((u) => ({ name: u.name, input: u.input })));
    const list = Array.isArray(got) ? got : uses.map(() => got);
    // tool names + ok/failed only; the inputs (which can carry the person's words) only with
    // GARDENER_VOICE_DEBUG=1 (QA) — never in normal running
    log(`tools: ${uses.map((u, i) => `${u.name}${process.env.GARDENER_VOICE_DEBUG === '1' ? JSON.stringify(u.input) + '→' + JSON.stringify(list[i]) : list[i]?.ok === false ? ' (failed)' : ''}`).join(', ')}`);
    lastFailed = list.some((r) => !r || r.ok === false);
    if (list.some((r) => r && r.ok !== false && !r.info)) acted = true;
    const informative = list.some((r) => r && r.info);
    // the fast path — one model call: everything worked, nothing to read back; the reply is
    // the model's own line, else the wall's plain description of what it did
    if (!lastFailed && !informative) { if (!said) reply = list.map((r) => r && r.say).filter(Boolean).pop() || ''; break; } // the last step says it
    if (round === MAX_ROUNDS - 1) break;
    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: uses.map((u, i) => ({ type: 'tool_result', tool_use_id: u.id, is_error: !list[i] || list[i].ok === false,
      content: clip(!list[i] || list[i].ok === false ? (list[i]?.error || 'failed') : (list[i].info || 'done'), 2000) })) });
  }
  const ok = !lastFailed;
  reply = clip(reply.replace(/\s+/g, ' ').replace(/[*_#`]/g, ''), 2400); // shown whole (long ones as a sheet, lib/voice.js)
  history.push({ q: clip(text, 300), a: acted ? `(did it${reply ? ': ' + reply : ''})` : reply, at: Date.now() });
  // an action that happened speaks for itself (the glow + the chime close it): words only
  // for answers and for things that couldn't be done (humans, 2026-11-03)
  if (ok && acted) return { ok, reply: '' };
  return { ok, reply: reply || (ok ? '' : 'Sorry — I couldn’t do that.') };
}
