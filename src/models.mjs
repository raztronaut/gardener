// The Gardener™ — "always the latest Opus". Each tending asks the Models API for
// the newest claude-opus-* model and uses it (agent + vision review), recording
// the id + display name in kv so the wall can show "agent model: Opus x.x".
// Falls back to config.model (GARDENER_MODEL) if the lookup fails.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.mjs';
import { setKV, getKV } from './db.mjs';

// "claude-opus-5-5" → "Opus 5.5" (used when the API gives no display name).
export const prettyModel = (id) => {
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id || '');
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}` : (id || '');
};

export async function resolveLatestOpus() {
  let id = config.model, name = prettyModel(config.model);
  try {
    const client = new Anthropic({ apiKey: config.apiKey });
    const opus = [];
    for await (const m of client.models.list({ limit: 100 })) if (/^claude-opus-/.test(m.id)) opus.push(m);
    opus.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    if (opus[0]) { id = opus[0].id; name = (opus[0].display_name || prettyModel(id)).replace(/^Claude\s+/i, ''); }
  } catch (e) { console.error(`[models] latest-opus lookup failed, using ${id}: ${e.message}`); }
  setKV('agent_model', JSON.stringify({ id, name, at: Date.now() }));
  return { id, name };
}

export function agentModel() {
  try { const v = JSON.parse(getKV('agent_model', '') || 'null'); if (v?.id) return v; } catch { /* none yet */ }
  return { id: config.model, name: prettyModel(config.model) };
}
