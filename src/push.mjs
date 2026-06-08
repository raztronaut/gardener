// "Hearth" — Web Push helpers (a separate, hand-maintained side project).
// Owns the VAPID keypair (generate-once, persisted) and fan-out sending to every
// stored subscription, pruning dead endpoints (404/410) as it goes. Used by the
// PUBLIC plant-server so household phones get a real push when someone starts
// Clean Mode or logs a chore — even with the app closed.
//
// VAPID keys are read in this priority order:
//   1) GARDENER_VAPID_PUBLIC / GARDENER_VAPID_PRIVATE (env / .env)
//   2) data/vapid.json (gitignored runtime state) — generated on first use
// Generating on first startup means there's nothing to configure; the keypair
// survives the daily `git reset --hard HEAD` because data/ is gitignored.
import webpush from 'web-push';
import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { allPushSubscriptions, removePushSubscription } from './db.mjs';

const VAPID_FILE = join(paths.DATA, 'vapid.json');
// A mailto/URL "subject" is required by the spec; push services use it to reach
// the app operator. The localhost public URL is fine as a contact of last resort.
const SUBJECT = process.env.GARDENER_VAPID_SUBJECT || 'mailto:hearth@thegardener.local';

let _keys = null;

function loadOrCreateKeys() {
  if (_keys) return _keys;
  // 1) explicit env override
  const ePub = (process.env.GARDENER_VAPID_PUBLIC || '').trim();
  const ePriv = (process.env.GARDENER_VAPID_PRIVATE || '').trim();
  if (ePub && ePriv) { _keys = { publicKey: ePub, privateKey: ePriv }; return _keys; }
  // 2) persisted runtime file
  try {
    if (existsSync(VAPID_FILE)) {
      const j = JSON.parse(readFileSync(VAPID_FILE, 'utf8'));
      if (j && j.publicKey && j.privateKey) { _keys = { publicKey: j.publicKey, privateKey: j.privateKey }; return _keys; }
    }
  } catch { /* corrupt → regenerate below */ }
  // 3) generate once and persist. Two processes (plant + wall server) could race
  // on a cold start; write via temp+rename so the file is never torn, then RE-READ
  // it so every process adopts the single keypair that actually won the rename
  // (otherwise the sender and the subscribed public key could diverge).
  const fresh = webpush.generateVAPIDKeys();
  try {
    const tmp = `${VAPID_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(fresh, null, 2));
    chmodSync(tmp, 0o600); // it's a private key — keep it owner-only
    if (!existsSync(VAPID_FILE)) renameSync(tmp, VAPID_FILE);
    else try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    const won = JSON.parse(readFileSync(VAPID_FILE, 'utf8'));
    _keys = (won && won.publicKey && won.privateKey) ? { publicKey: won.publicKey, privateKey: won.privateKey } : fresh;
  } catch { _keys = fresh; } // best effort; keys still usable in-memory this run
  return _keys;
}

// The public key the browser needs to subscribe (urlsafe-base64, ~87 chars).
export function getVapidPublicKey() { return loadOrCreateKeys().publicKey; }

function configured() {
  const k = loadOrCreateKeys();
  webpush.setVapidDetails(SUBJECT, k.publicKey, k.privateKey);
  return k;
}

// Send {title, body, url, tag} to ALL stored subscriptions. Optionally skip the
// actor's own device (by endpoint) so they don't get pushed their own action.
// Prunes endpoints the push service reports as gone (404/410). Fire-and-forget:
// callers don't await the network (the HTTP response shouldn't block on it).
export async function sendToAll(payload, { skipEndpoint = null, log = () => {} } = {}) {
  let subs;
  try { subs = allPushSubscriptions(); } catch (e) { log(`push: cannot read subs: ${e}`); return { sent: 0, pruned: 0 }; }
  if (!subs.length) return { sent: 0, pruned: 0 };
  configured();
  const body = JSON.stringify({
    title: payload.title || 'Hive',
    body: payload.body || '',
    url: payload.url || '/',
    tag: payload.tag || 'hearth',
  });
  let sent = 0, pruned = 0;
  await Promise.all(subs.map(async (s) => {
    if (skipEndpoint && s.endpoint === skipEndpoint) return;
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, body, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) { // gone — the browser unsubscribed/expired
        try { removePushSubscription(s.endpoint); pruned++; } catch { /* ignore */ }
      } else {
        log(`push send failed (${code || '?'}): ${(e && e.message) || e}`);
      }
    }
  }));
  if (sent || pruned) log(`push: sent ${sent}, pruned ${pruned}`);
  return { sent, pruned };
}
