// The Gardener™ — visual review.
// Sends a rendered screenshot to Claude (vision) and asks for a strict-JSON
// verdict on whether the 9:16 dashboard renders correctly and looks good.
// This gates deployment and feeds concrete fix instructions back to the agent.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { config } from './config.mjs';

const PROMPT = `You are the discerning art director for "The Gardener", a 24/7 ambient
wall dashboard rendered in a LOCKED 900×1600 portrait (9:16) window.

You are looking at a screenshot of the current build. Judge ONLY what you can see.
Flag rendering/layout defects, prioritising the critical ones:
- elements overlapping, clipped, cut off at edges, or overflowing the 900×1600 frame
- large empty/blank/black regions, or a widget area that rendered nothing
- text that is unreadable: too small, low contrast, truncated, or colliding
- broken or skewed layout, misaligned cards, scrollbars, default-browser ugliness
- anything that looks like an error state or a half-loaded widget

Also judge aesthetics: balance, hierarchy, legibility from across a room, polish.

Return ONLY strict minified JSON, no prose, in this exact shape:
{"ok": <true|false>, "score": <0-10 number>, "issues": [{"severity":"critical|major|minor","description":"...","fix":"concrete suggestion"}], "notes":"one-sentence overall impression"}

Set "ok" to false if there is ANY critical issue (broken/overlapping/blank/illegible).
Set "ok" to true only if the dashboard renders cleanly and looks good.`;

export async function reviewScreenshot(pngPath) {
  const client = new Anthropic({ apiKey: config.apiKey });
  const b64 = readFileSync(pngPath).toString('base64');
  const msg = await client.messages.create({
    model: config.model,
    max_tokens: 1500,
    output_config: { effort: config.effort },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const verdict = extractJson(text);
  if (!verdict) return { ok: true, score: null, issues: [], notes: 'review unparseable; not blocking', raw: text };
  verdict.issues = Array.isArray(verdict.issues) ? verdict.issues : [];
  return verdict;
}

function extractJson(text) {
  // Tolerate code fences or stray prose around the JSON object.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}
