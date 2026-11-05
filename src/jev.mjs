// The Gardener™ — Jev: TypeSafe's fast "System One" decision model, through OpenRouter's
// decisions endpoint (/api/alpha/decisions, model ~typesafe/jev-latest). ~0.4 s, ~$0.00001
// per decision. It answers structured questions (choice / score / box / noul) with
// probabilities and a confidence, so callers can act when it's sure and defer when it isn't.
//
// Used by "Hey Garden" to route a spoken request without the person having to say
// "botanist" (src/voiceagent.mjs). Always fails OPEN: no key, a timeout or an error = null,
// and the caller carries on exactly as before. Only text is ever sent.
import './config.mjs'; // loads .env into process.env (OPENROUTER_API_KEY)

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
