// The Gardener™ — Jev: TypeSafe's fast "System One" decision model, through OpenRouter's
// decisions endpoint (/api/alpha/decisions, model ~typesafe/jev-latest). ~0.4 s, ~$0.00001
// per decision. It answers structured questions (choice / score / box / noul) with
// probabilities and a confidence, so callers can act when it's sure and defer when it isn't.
//
// Used by "Hey Garden" to route a spoken request without the person having to say
// "botanist" (src/voiceagent.mjs). Always fails OPEN: no key, a timeout or an error = null,
// and the caller carries on exactly as before. Only text is ever sent.
import './config.mjs'; // loads .env into process.env (OPENROUTER_API_KEY)
import { execFileSync } from 'node:child_process';

const URL = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = process.env.GARDENER_JEV_MODEL || '~typesafe/jev-latest';

// decide(state, questions, { timeoutMs }) → { answers, model, ms } | null
export async function decide(state, questions, { timeoutMs = 1200 } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'X-Title': 'GardenOS' },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.answers ? { answers: j.answers, model: j.model, ms: Date.now() - t0 } : null;
  } catch { return null; }
}

// Where a spoken request should go. Tuned on 28 labelled requests: 27/28, median ~0.39 s;
// the one miss came back at low confidence — so act only when it's sure.
export const ROUTES = {
  wall: 'Operate the wall display AS IT IS NOW, the way a tap or remote would: open/close/show a widget or panel, scroll, select, volume, mute, start/stop a timer or countdown, switch dashboards, play a game, play rainforest sounds, night mode, zoom; or leave a note for tonight\'s gardener when they say "tell the gardener". It does NOT change, add to, fix, or build anything.',
  answer: 'A question or chat answered in words from general knowledge or the web: facts, advice, maths, weather, news, scores, events, recipes, ideas. Not about this computer\'s own state, and nothing gets changed.',
  botanist: 'Act ON this computer with a capable agent: change, add to, fix, or build anything (a new feature or change on the wall, a broken card, code), run commands, inspect this computer\'s own state (why it is slow, disk, memory, processes, network, logs, what is running), use desktop apps, files, downloads, installs, settings, or anything needing to look at the screen and click or type.',
};

export async function routeRequest(text, opts) {
  const out = await decide(`Spoken to a smart wall display (speech-to-text, may have small errors): "${String(text).slice(0, 500)}"`,
    { route: { type: 'choice', instructions: 'Which handler should take this spoken request?', criteria: ROUTES } }, opts);
  const a = out && out.answers && out.answers.route;
  return a ? { route: a.choice, confidence: a.confidence ?? 0, p: a.probabilities || {}, ms: out.ms } : null;
}

// A screenshot (PNG/JPEG bytes) + a line of context, as Jev's state. Jev reads images only in
// the OpenAI content-parts shape (measured: 0.5 s; the {type:'image'} shape is slow and wrong).
export function imageState(text, bytes, mime) {
  mime ||= bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` } }];
}

// ---- the Botanist gatekeeper: how risky is this request / this tool call? -------------------
export const RISK = {
  harmless: 'Only looks, reads, checks, answers, calculates, opens or uses an app, takes a screenshot, or makes a small reversible change that is easy to undo — nothing important is lost, sent, bought or exposed.',
  ask: 'Changes something that matters: edits or creates code or files, changes GardenOS, installs or updates software, deletes a few files, restarts services or apps, changes settings, sends a message or email, or touches accounts — fine if the person confirms.',
  block: 'Destructive, irreversible or security-sensitive: wiping or mass-deleting files, rm -rf on home or system folders, git reset --hard / force-push, formatting disks, disabling security or the firewall, revealing or sending passwords, keys or secrets, spending money, or anything that could brick the computer.',
};
export async function riskOf(what, opts) {
  const out = await decide(`A request for an AI agent with full access to a home computer (the GardenOS wall): ${String(what).slice(0, 1500)}`,
    { risk: { type: 'choice', instructions: 'How risky is it to do this without asking the owner first?', criteria: RISK } }, opts);
  const a = out && out.answers && out.answers.risk;
  return a ? { risk: a.choice, confidence: a.confidence ?? 0, p: a.probabilities || {}, ms: out.ms } : null;
}

// ---- false wakes: was this really said TO the wall? ------------------------------------------
export async function meantForWall(text, opts) {
  const out = await decide(`After the wake word "Hey Garden", a home wall display's microphone transcribed: "${String(text).slice(0, 400)}"`,
    { addressed: { type: 'noul', instructions: 'Probability (0-1) that this is a person deliberately asking the wall assistant something or telling it to do something — rather than a TV, music, a phone call, or people talking to each other, picked up by mistake.' } }, opts);
  const v = out && out.answers && out.answers.addressed;
  return v && typeof v.noul === 'number' ? { p: v.noul, ms: out.ms } : null;
}

// ---- caption or sheet: how should an answer be shown? ----------------------------------------
export async function answerFormat(question, reply, opts) {
  const out = await decide(`Someone asked a wall display across the room: "${String(question).slice(0, 300)}". The answer: "${String(reply).slice(0, 1800)}"`,
    { format: { type: 'choice', instructions: 'How should this answer be shown on the wall?', criteria: {
      caption: 'A short caption read at a glance from across the room: one idea, a fact, a sentence or two of conversation — even if it runs a little long.',
      sheet: 'A full-screen sheet to read up close: several parts, steps, a list, a comparison, numbers to look at, or detail someone will want to scan and come back to.',
    } } }, opts);
  const a = out && out.answers && out.answers.format;
  return a ? { format: a.choice, confidence: a.confidence ?? 0, ms: out.ms } : null;
}

// Jev rejects big images ("Invalid image dimensions"; 900x1600 fails, 450x800 works): scale to a
// longest side of 800 with the system's Python/PIL (no npm deps). null = couldn't (skip Jev).
export function fitForJev(bytes, maxSide = 800) {
  try {
    return execFileSync('python3', ['-I', '-c', 'import sys,io\nfrom PIL import Image\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")\nim.thumbnail((%d,%d))\no=io.BytesIO(); im.save(o,"PNG"); sys.stdout.buffer.write(o.getvalue())'.replace(/%d/g, String(maxSide))],
      { input: bytes, maxBuffer: 16 << 20, timeout: 10000 });
  } catch { return null; }
}

// ---- the nightly tending's fast first look at a build screenshot ------------------------------
export async function screenshotPrecheck(bytes, opts = {}) {
  bytes = fitForJev(bytes);
  if (!bytes) return null;
  const out = await decide(imageState('A screenshot of a 900x1600 portrait wall dashboard build (cards of widgets on a dark green background).', bytes),
    { layout: { type: 'choice', instructions: 'Does the layout render cleanly?', criteria: {
        clean: 'Every card renders fully: nothing overlaps, nothing is clipped or cut off at an edge, no blank or broken widget area, text fits.',
        defect: 'Something is visibly wrong: overlapping or clipped elements, content cut off at an edge or overflowing, a blank/black/broken widget area, text truncated or colliding.' } },
      where: { type: 'box', instructions: 'The single most visibly broken, clipped, overlapping or blank area (if none, the least polished area).' },
      legible: { type: 'noul', instructions: 'How legible is the text from across a room (0 = unreadable, 1 = effortless)?' } },
    { timeoutMs: opts.timeoutMs || 8000 });
  const A = out && out.answers;
  return A ? { layout: A.layout?.choice, p: A.layout?.probabilities || {}, confidence: A.layout?.confidence ?? 0, where: A.where?.box || null, legible: A.legible?.noul ?? null, ms: out.ms } : null;
}
