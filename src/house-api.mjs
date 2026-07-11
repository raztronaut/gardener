// "Hearth" — household app backend (a separate, hand-maintained side project).
// A small router + the household status snapshot, imported by the PUBLIC
// plant-server (full read+write API) and by the localhost wall server
// (read-only status for the cleaning widget). The daily tending must NOT
// modify this file or anything under public/house/.
import {
  listHouseUsers, upsertHouseUser, getHouseUser,
  startCleanSession, endCleanSession, getCleanSession, activeSessions,
  activeSessionForUser, addChoreEvents, choresForSession,
  deleteChoreEvents, deleteChoreEventsSince,
  addHouseNotification, recentHouseNotifications,
  rankingSince, recentActivity,
  addPushSubscription, removePushSubscription,
  createHouseSession, getHouseSessionByToken, deleteHouseSession,
  activeHouseSessions, latestHouseSessionByEmail, listHouseUsersWithActivity,
  renameHouseUser, setHouseUserAvatar, setHouseUserAvatarFile, googlePictureByUser,
  addBusyBlock, deleteBusyBlock, busyBlocksForUser, busyBlocksInWindow,
  connectedMemberIds, replaceGoogleBusy, clearGoogleBusy,
} from './db.mjs';
import { config, paths } from './config.mjs';
import { getVapidPublicKey, sendToAll } from './push.mjs';
import { promises as fsp } from 'node:fs';
import { statSync, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

// Canonical chore catalog. `key` is stored; `label`/`emoji` drive the UI and the
// notification text. The last item is free-text ("other"). Edit here only.
export const CHORES = [
  { key: 'trash', label: 'Took trash out', emoji: '🗑', past: 'took the trash out' },
  { key: 'counters', label: 'Wiped counters', emoji: '🧽', past: 'wiped the counters' },
  { key: 'vacuum', label: 'Vacuumed floor', emoji: '🧹', past: 'vacuumed the floor' },
  { key: 'dishwasher_run', label: 'Ran the dishes in dishwasher', emoji: '🍽', past: 'ran the dishwasher' },
  { key: 'dishwasher_empty', label: 'Put dishes away (from dishwasher)', emoji: '🧼', past: 'put the dishes away' },
  { key: 'curb', label: 'Put trash to the curb', emoji: '♻️', past: 'put the trash to the curb' },
  { key: 'other', label: 'Other', emoji: '✍️', past: 'did', freeText: true },
];
const CHORE_BY_KEY = new Map(CHORES.map((c) => [c.key, c]));

// Curated avatar presets — the ONLY values the avatar picker may set besides
// 'google' (use the Google account photo / colored-initial fallback). NO file
// uploads: every preset is a deterministic, client-rendered spec (gradient
// monogram or an inline-SVG mint glyph), so nothing is ever stored as an image
// on the public surface. The client renders these by id; the server only needs
// the id set to validate writes. Keep this list in sync with renderAvatar() in
// public/house/app.js. 4 gradient-hue monograms + 6 glyphs = 10 options.
export const AVATAR_PRESETS = [
  'preset:hue-mint', 'preset:hue-teal', 'preset:hue-gold', 'preset:hue-rose',
  'preset:leaf', 'preset:sprout', 'preset:sun', 'preset:moon', 'preset:star', 'preset:drop',
];
const AVATAR_VALUES = new Set(['google', ...AVATAR_PRESETS]);

// ---- uploaded profile photos ------------------------------------------------
// REAL photo uploads (the user wants their own picture, not a template). The
// client reads a File, downscales + center-crops it on a canvas to ~256×256 and
// sends a base64 data URL; we decode it with Buffer, validate type + size hard
// (internet-exposed surface), and write one file per user under the gitignored
// <GARDENER_DATA>/avatars/ dir — image bytes NEVER touch SQLite. The DB keeps
// avatar='upload' + the filename + a version stamp; the served URL embeds ?v=
// so caches bust on change. Served only by integer userId (path-traversal safe).
const PHOTO_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const PHOTO_MAX_BYTES = 512 * 1024;          // decoded image cap (client downscales first)
const PHOTO_MAX_DATAURL = 1024 * 1024;       // raw request body cap (base64 inflates ~33%)

// Resolve the URL a client should render for a person's avatar, in priority:
//   1. an uploaded photo  → /api/house/avatar/<id>?v=<stamp>
//   2. a Google photo     → that https url
//   3. neither            → null (the client draws the colored-initial bubble)
// Works off whatever shape the row has (avatar/avatar_file/avatar_v + a resolved
// googlePicture). Additive + backward-compatible — the wall widget reads this.
function avatarUrlFor(row, googlePicture) {
  if (row && row.avatar === 'upload' && row.avatar_file) {
    const id = row.id != null ? row.id : row.user_id;
    return `/api/house/avatar/${id}?v=${row.avatar_v || 1}`;
  }
  return googlePicture || null;
}

// ---- time windows (documented choice) --------------------------------------
// Day  = since local midnight in America/Los_Angeles (the wall's timezone).
// Week = a rolling 7-day window (now - 7d), which is simplest and always shows
//        a full week of activity regardless of the current weekday.
const TZ = 'America/Los_Angeles';
export function dayStartMs(now = new Date()) {
  // Midnight today in TZ, computed without extra deps: read the TZ wall-clock
  // parts and subtract them from `now`.
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  const h = (parseInt(parts.hour, 10) % 24), m = parseInt(parts.minute, 10), s = parseInt(parts.second, 10);
  return now.getTime() - ((h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds());
}
export function weekStartMs(now = new Date()) { return now.getTime() - 7 * 24 * 3600 * 1000; }

// ---- household status snapshot (shared by app dashboard + wall widget) ------
export function houseStatus() {
  // The most-recent Google photo per user, so every surface (Roots screens AND
  // the wall widget) can render the right avatar from status alone. Computed
  // once per snapshot and merged in additively — old fields are untouched, so
  // this stays backward-compatible with the wall widget.
  const pics = googlePictureByUser();
  const withAv = (row) => {
    const googlePicture = pics.get(row.user_id) || null;
    return { ...row, avatar: row.avatar || null, googlePicture, avatarUrl: avatarUrlFor({ ...row, id: row.user_id }, googlePicture) };
  };
  const cleaning = activeSessions().map((s) => {
    const googlePicture = pics.get(s.user_id) || null;
    return {
      name: s.name, sessionId: s.id, startedAt: s.started_at,
      avatar: s.avatar || null, googlePicture,
      avatarUrl: avatarUrlFor({ ...s, id: s.user_id }, googlePicture),
    };
  });
  return {
    cleaning,
    day: rankingSince(dayStartMs()).map(withAv),
    week: rankingSince(weekStartMs()).map(withAv),
    activity: recentActivity(12).map(withAv),
    notifications: recentHouseNotifications(12),
    now: Date.now(),
  };
}

// ============================================================================
// Shared availability calendar — the "main garden calendar".
//
// Each member's BUSY time is the union of (a) intervals synced from their REAL
// Google Calendar and (b) manual busy blocks they typed in Roots. The Google
// side runs ENTIRELY in the browser: Roots uses Google Identity Services'
// OAuth token client to get a calendar.readonly ACCESS TOKEN, calls the
// Calendar freeBusy API client-side (which returns busy intervals WITHOUT event
// titles — good for privacy), and POSTs only the resulting intervals here. The
// access token never touches this server. The household's shared FREE windows
// are the daytime gaps where everyone has no busy block, scanned across the next
// few days.
// ============================================================================
const CAL_TZ = TZ;                              // America/Los_Angeles
const CAL_DAYS = 5;                             // scan the next 5 days
const CAL_DAY_START_H = 8;                      // daytime window: 8am
const CAL_DAY_END_H = 22;                       // …to 10pm (local)
const CAL_SLOT_MS = 30 * 60 * 1000;             // 30-minute granularity
const CAL_MAX_WINDOWS = 6;                      // at most ~6 windows returned
const CAL_MAX_INTERVALS = 1000;                 // cap on a single google push
const CAL_HORIZON_MS = 30 * 24 * 3600 * 1000;   // store busy ≤30 days out

// Merge overlapping/adjacent [start,end] intervals into a sorted, disjoint set.
function mergeIntervals(list) {
  const ivs = list.filter((i) => i && i.end > i.start).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of ivs) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ start: iv.start, end: iv.end });
  }
  return merged;
}

// Build the household's shared availability snapshot. members[] + windows[] +
// updatedAt, exactly the shape the wall widget consumes. Never throws for "no
// data" — returns empty arrays. `members` is the household roster; each carries
// connected=true once they have ANY busy interval (google-synced OR manual).
async function houseCalendar(log = () => {}) {
  const now = Date.now();
  const fromMs = now;
  const toMs = now + CAL_DAYS * 24 * 3600 * 1000;
  const pics = googlePictureByUser();
  const users = listHouseUsersWithActivity();

  // Every busy interval (google + manual) in the scan window, bucketed by user.
  const blocksByUser = new Map();
  for (const b of busyBlocksInWindow(fromMs, toMs)) {
    if (!blocksByUser.has(b.user_id)) blocksByUser.set(b.user_id, []);
    blocksByUser.get(b.user_id).push({ start: b.start_ms, end: b.end_ms });
  }

  // Per-user merged (overlap-coalesced) busy set.
  const busyByUser = new Map();
  for (const u of users) {
    busyByUser.set(u.id, mergeIntervals(blocksByUser.get(u.id) || []));
  }

  // "Connected" = the member has a live calendar connection (any busy row, google
  // or manual, that hasn't fully ended) — NOT merely "has busy time in the next
  // few days". A member who synced Google but is free for the whole scan window is
  // still connected; the widget then shows them as free instead of "sync a
  // calendar". This looks across the full stored horizon, not just the scan days.
  const connectedIds = connectedMemberIds(now);
  const members = users.map((u) => {
    const gp = pics.get(u.id) || null;
    const connected = connectedIds.has(u.id);
    return { id: String(u.id), name: u.name, avatarUrl: avatarUrlFor(u, gp), connected };
  });
  const totalCount = members.length;

  // Scan 30-min daytime slots; for each, count members who are free (no busy
  // interval covers the slot). Coalesce consecutive slots with the SAME free
  // set into windows. Prefer all-free windows; include partials too.
  const isBusy = (uid, slotStart, slotEnd) => {
    const ivs = busyByUser.get(uid) || [];
    for (const iv of ivs) if (iv.start < slotEnd && iv.end > slotStart) return true;
    return false;
  };
  const rawWindows = [];
  if (totalCount > 0) {
    let cur = null; // { start, end, freeIds:Set }
    for (let day = 0; day < CAL_DAYS; day++) {
      const dayBase = localDayStartMs(now + day * 24 * 3600 * 1000);
      for (let h = CAL_DAY_START_H; h < CAL_DAY_END_H; h++) {
        for (let half = 0; half < 2; half++) {
          const slotStart = dayBase + (h * 3600 + half * 1800) * 1000;
          const slotEnd = slotStart + CAL_SLOT_MS;
          if (slotEnd <= now) continue; // skip slots already in the past
          const freeIds = members.filter((m) => !isBusy(+m.id, slotStart, slotEnd)).map((m) => +m.id);
          const key = freeIds.slice().sort((a, b) => a - b).join(',');
          if (freeIds.length === 0) { if (cur) { rawWindows.push(cur); cur = null; } continue; }
          if (cur && cur.key === key && cur.end === slotStart) { cur.end = slotEnd; }
          else { if (cur) rawWindows.push(cur); cur = { start: slotStart, end: slotEnd, key, freeIds }; }
        }
      }
      if (cur) { rawWindows.push(cur); cur = null; } // don't span midnight
    }
    if (cur) rawWindows.push(cur);
  }

  const nameById = new Map(members.map((m) => [+m.id, m.name]));
  const windows = rawWindows
    .filter((w) => w.end - w.start >= 30 * 60 * 1000) // at least 30 min
    .map((w) => ({
      start: w.start, end: w.end,
      freeCount: w.freeIds.length, totalCount,
      // ids (as strings, matching members[].id) so the wall widget can render
      // each free person's avatar; names kept for non-avatar contexts.
      freeIds: w.freeIds.map((id) => String(id)),
      freeNames: w.freeIds.map((id) => nameById.get(id)).filter(Boolean),
    }))
    // soonest first (the widget wants upcoming windows in chronological order;
    // both all-free and partial windows are included).
    .sort((a, b) => a.start - b.start)
    .slice(0, CAL_MAX_WINDOWS);

  return { members, windows, updatedAt: now };
}
// Local (CAL_TZ) midnight for the day containing `ms`.
function localDayStartMs(ms) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: CAL_TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  const h = (+p.hour) % 24, mi = +p.minute, s = +p.second;
  return ms - (h * 3600 + mi * 60 + s) * 1000 - (ms % 1000);
}

// ---- request helpers --------------------------------------------------------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function parseJson(req) {
  try { return JSON.parse(await readBody(req) || '{}'); } catch { return null; }
}
// Like parseJson but with a larger body cap (profile-photo uploads are bigger
// than the 8 KB JSON default). Returns 'TOO_LARGE' when the cap is exceeded so
// the caller can answer 413, or null on parse failure.
async function parseJsonLarge(req, limit) {
  let raw;
  try { raw = await readBody(req, limit); } catch (e) { return /too large/.test(e.message) ? 'TOO_LARGE' : null; }
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}
// Best-effort magic-byte check that a decoded buffer actually IS the declared
// image type (so a mislabelled blob is never written to the served avatars dir).
function sniffImage(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (ext === 'png') return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (ext === 'jpg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === 'webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
// Unlink an orphaned uploaded avatar file (best-effort; basename-guarded so a
// stray DB value can never reach outside the avatars dir). Fire-and-forget.
function deleteAvatarFile(file, log) {
  if (!file) return;
  const target = join(paths.AVATARS, basename(String(file)));
  fsp.unlink(target).catch((e) => { if (e && e.code !== 'ENOENT') log(`avatar unlink: ${e}`); });
}

// Per-route rate limiter (a stranger with the public URL must not flood writes).
function makeLimiter(max, windowMs) {
  const hits = [];
  return () => {
    const now = Date.now();
    while (hits.length && now - hits[0] > windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}
const writeLimit = makeLimiter(90, 60_000); // 90 writes / minute across the surface
// google-login does an outbound verification fetch — keep it on a tighter leash
// so a stranger can't use us as a tokeninfo relay.
const googleLimit = makeLimiter(10, 60_000);

// ---- login sessions ----------------------------------------------------------
// The opaque bearer token rides in the 'x-roots-token' header. Sessions ENRICH
// identity (provider/email/picture, "active devices") — they are deliberately
// NOT required for writes, so a household member without one is never locked out.
function sessionFromReq(req, { touch = true } = {}) {
  const token = (req.headers['x-roots-token'] || '').toString();
  if (!token) return null;
  try { return getHouseSessionByToken(token, { touch }); } catch { return null; }
}
function sessionPublic(s) {
  // Enrich with the user's chosen avatar + their best Google photo so the You
  // profile card (and anything reading /me) can render the right image. The
  // google photo prefers THIS session's picture, falling back to any stored one.
  const u = getHouseUser(s.user_id);
  const pics = googlePictureByUser();
  const googlePicture = s.picture || pics.get(s.user_id) || null;
  // Resolve the user's effective avatar URL (uploaded photo > google photo >
  // null) so the You profile card renders the real picture from /me alone.
  const avatarUrl = avatarUrlFor(u || { id: s.user_id }, googlePicture);
  return {
    user: { id: s.user_id, name: s.name, avatar: (u && u.avatar) || null, googlePicture, avatarUrl },
    provider: s.provider, email: s.email || null, picture: s.picture || null,
    avatar: (u && u.avatar) || null, googlePicture, avatarUrl,
    createdAt: s.created_at, lastSeen: s.last_seen,
  };
}

// Verify a Google ID token via Google's tokeninfo endpoint (no deps). Returns
// the payload object on success, or null. We check the audience, expiry and
// that Google verified the email — tokeninfo itself validates the signature.
async function verifyGoogleIdToken(idToken, clientId, log) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { signal: ac.signal });
    if (!r.ok) return null;
    const p = await r.json();
    if (!p || p.aud !== clientId) return null;
    if (!p.exp || parseInt(p.exp, 10) * 1000 < Date.now()) return null;
    if (p.email_verified !== 'true' && p.email_verified !== true) return null;
    if (!p.sub || !p.email) return null;
    return p;
  } catch (e) { log(`google tokeninfo error: ${e.message || e}`); return null; }
  finally { clearTimeout(timer); }
}

// ---- the router -------------------------------------------------------------
// Handles every path under /api/house/*. Returns true if it handled the request
// (so the caller can fall through to its own routes otherwise). `opts.readOnly`
// disables all writes (used by the localhost wall server, which only needs status).
export async function handleHouseApi(req, res, url, opts = {}) {
  const p = url.pathname;
  if (!p.startsWith('/api/house')) return false;
  const readOnly = !!opts.readOnly;
  const log = opts.log || (() => {});

  try {
    // ----- reads -----
    if (req.method === 'GET' && p === '/api/house/status') { json(res, 200, houseStatus()); return true; }
    // The "main garden calendar": the household's shared free windows + roster.
    // Read-only + same-origin, so it's mounted on BOTH the public plant-server
    // AND the localhost wall server (the wall widget consumes it). ALWAYS 200
    // with empty arrays when there's no data yet — never 500 — so the widget
    // degrades gracefully. May fetch connected ICS feeds (cached ~5 min).
    if (req.method === 'GET' && p === '/api/house/calendar') {
      let payload;
      try { payload = await houseCalendar(log); }
      catch (e) { log(`calendar build error: ${e.stack || e}`); payload = { members: [], windows: [], updatedAt: Date.now() }; }
      json(res, 200, payload); return true;
    }
    // The signed-in user's OWN calendar view: whether their Google Calendar is
    // synced (any google-sourced busy rows) + their MANUAL busy blocks (the only
    // ones they can hand-edit). Session-gated (own data only).
    if (req.method === 'GET' && p === '/api/house/calendar/mine') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to manage your calendar' }); return true; }
      const rows = busyBlocksForUser(s.user_id);
      const manual = rows.filter((b) => b.source === 'manual')
        .map((b) => ({ id: b.id, start: b.start_ms, end: b.end_ms, label: b.label || null }));
      const googleCount = rows.filter((b) => b.source === 'google').length;
      json(res, 200, {
        connected: googleCount > 0,
        eventCount: googleCount,   // # of busy intervals currently synced from Google
        blocks: manual,            // hand-edited blocks only
      }); return true;
    }
    if (req.method === 'GET' && p === '/api/house/users') { json(res, 200, { users: listHouseUsers() }); return true; }
    if (req.method === 'GET' && p === '/api/house/chores') { json(res, 200, { chores: CHORES }); return true; }
    if (req.method === 'GET' && p === '/api/house/notifications') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 100);
      json(res, 200, { notifications: recentHouseNotifications(limit) }); return true;
    }
    if (req.method === 'GET' && p === '/api/house/rankings') {
      json(res, 200, { day: rankingSince(dayStartMs()), week: rankingSince(weekStartMs()) }); return true;
    }
    // Auth surface the client probes on boot: {googleClientId} when Google
    // sign-in is configured, {} otherwise (name login stays primary either way).
    if (req.method === 'GET' && p === '/api/house/auth-config') {
      json(res, 200, config.googleClientId ? { googleClientId: config.googleClientId } : {}); return true;
    }
    // Who am I? Token → identity (and touch last_seen so the device shows as
    // active). 401 when the token is missing/unknown — the client then falls
    // back to its localStorage name identity.
    if (req.method === 'GET' && p === '/api/house/me') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'no session' }); return true; }
      json(res, 200, sessionPublic(s)); return true;
    }
    // The Account screen's "household" view: every member + their last logged
    // chore + whether they're cleaning right now, plus recently-active app
    // sessions (who's signed in on a device, last 30 days).
    if (req.method === 'GET' && p === '/api/house/household') {
      const cleaningIds = new Set(activeSessions().map((s) => s.user_id));
      const pics = googlePictureByUser();
      const users = listHouseUsersWithActivity().map((u) => {
        const googlePicture = pics.get(u.id) || null;
        return {
          id: u.id, name: u.name, createdAt: u.created_at,
          avatar: u.avatar || null, googlePicture, avatarUrl: avatarUrlFor(u, googlePicture),
          lastChoreTs: u.last_chore_ts || null,
          cleaningNow: cleaningIds.has(u.id),
        };
      });
      const sessions = activeHouseSessions().map((s) => ({
        userId: s.user_id, name: s.name, provider: s.provider,
        email: s.email || null, picture: s.picture || null,
        createdAt: s.created_at, lastSeen: s.last_seen,
      }));
      json(res, 200, { users, sessions, now: Date.now() }); return true;
    }
    // Web Push: the VAPID public key the browser needs to subscribe. A read, so
    // it's available everywhere the API is mounted (the wall server never sends).
    if (req.method === 'GET' && p === '/api/house/vapid-public') {
      let key = '';
      try { key = getVapidPublicKey(); } catch (e) { log(`vapid key error: ${e}`); }
      if (!key) { json(res, 503, { error: 'push not configured' }); return true; }
      json(res, 200, { publicKey: key }); return true;
    }
    if (req.method === 'GET' && p === '/api/house/session') {
      const id = parseInt(url.searchParams.get('id') || '', 10);
      const s = id ? getCleanSession(id) : null;
      if (!s) { json(res, 404, { error: 'no such session' }); return true; }
      const u = getHouseUser(s.user_id);
      json(res, 200, { session: { ...s, name: u?.name }, chores: choresForSession(s.id) }); return true;
    }
    // Serve a user's uploaded profile photo. Read-only, so it's mounted on BOTH
    // the public plant-server AND the localhost wall server (the wall widget
    // renders avatarUrl). Keyed ONLY by integer userId — no client filename ever
    // reaches the filesystem — and the stored name is basename()'d as a belt-and
    // -braces traversal guard. 404 when the user has no uploaded photo / no file.
    if (req.method === 'GET' && p.startsWith('/api/house/avatar/')) {
      const id = parseInt(p.slice('/api/house/avatar/'.length), 10);
      const u = id > 0 ? getHouseUser(id) : null;
      if (!u || u.avatar !== 'upload' || !u.avatar_file) { json(res, 404, { error: 'no photo' }); return true; }
      const file = join(paths.AVATARS, basename(String(u.avatar_file)));
      let st = null; try { st = statSync(file); } catch { /* missing */ }
      if (!st || !st.isFile()) { json(res, 404, { error: 'no photo' }); return true; }
      const ext = (u.avatar_file.split('.').pop() || '').toLowerCase();
      res.writeHead(200, {
        'Content-Type': EXT_MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        // Long cache — the URL carries ?v=<stamp> that changes on every upload.
        'Cache-Control': 'public, max-age=604800, immutable',
      });
      if (req.method === 'HEAD') { res.end(); return true; }
      createReadStream(file).pipe(res);
      return true;
    }

    if (readOnly) { json(res, 403, { error: 'read-only surface' }); return true; }

    // ----- writes (validated + rate-limited) -----
    if (!writeLimit()) { json(res, 429, { error: 'slow down — too many requests' }); return true; }

    if (req.method === 'POST' && p === '/api/house/users') {
      const b = await parseJson(req);
      const name = (b && b.name || '').toString().trim().slice(0, 40);
      if (!name || name.length < 1) { json(res, 400, { error: 'name required' }); return true; }
      if (!/^[\p{L}\p{N} '._-]{1,40}$/u.test(name)) { json(res, 400, { error: 'invalid name' }); return true; }
      const user = upsertHouseUser(name);
      if (!user) { json(res, 400, { error: 'invalid name' }); return true; }
      // Name pick/create doubles as login: mint a session so this device gets
      // durable identity (the client stores the token + sends it on writes).
      let session = null;
      try { session = createHouseSession({ userId: user.id, provider: 'name' }); }
      catch (e) { log(`session create failed: ${e}`); }
      json(res, 200, { ok: true, user, token: session ? session.token : null, session: session ? sessionPublic(session) : null }); return true;
    }

    // Sign out this device: forget the presented token. Always "ok" — a missing
    // or already-deleted token is just as signed-out.
    if (req.method === 'POST' && p === '/api/house/logout') {
      const token = (req.headers['x-roots-token'] || '').toString();
      let removed = 0;
      if (token) removed = deleteHouseSession(token);
      json(res, 200, { ok: true, removed }); return true;
    }

    // Sign in with Google: the GIS button POSTs its ID token (credential) here.
    // We verify it server-side against Google's tokeninfo endpoint, then
    // find-or-create the house_user and mint a provider:'google' session.
    if (req.method === 'POST' && p === '/api/house/google-login') {
      if (!config.googleClientId) { json(res, 400, { error: 'google sign-in not configured' }); return true; }
      if (!googleLimit()) { json(res, 429, { error: 'slow down' }); return true; }
      const b = await parseJson(req);
      const credential = (b && b.credential || '').toString();
      // An ID token is a three-part JWT; sanity-check shape before phoning Google.
      if (!credential || credential.length > 4096 || credential.split('.').length !== 3) {
        json(res, 400, { error: 'invalid credential' }); return true;
      }
      const payload = await verifyGoogleIdToken(credential, config.googleClientId, log);
      if (!payload) { json(res, 401, { error: 'google token rejected' }); return true; }
      // Link back to an existing member: a previous google session with the
      // same email wins; otherwise dedupe by display name (given_name) via the
      // case-insensitive upsert — "Gui" signing in with Google stays "Gui".
      let user = null;
      const prior = latestHouseSessionByEmail(payload.email);
      if (prior) user = getHouseUser(prior.user_id);
      if (!user) {
        const display = (payload.given_name || payload.name || payload.email.split('@')[0] || '').toString().trim().slice(0, 40);
        user = upsertHouseUser(display.replace(/[^\p{L}\p{N} '._-]/gu, '').trim() || 'Guest');
      }
      if (!user) { json(res, 400, { error: 'could not create user' }); return true; }
      const picture = /^https:\/\//.test(payload.picture || '') ? payload.picture.slice(0, 500) : null;
      const session = createHouseSession({ userId: user.id, provider: 'google', email: payload.email, picture });
      log(`google login: ${user.name} <${payload.email}>`);
      json(res, 200, { ok: true, user, token: session.token, session: sessionPublic(session) }); return true;
    }

    // Rename yourself. SESSION-GATED: only a signed-in user may rename, and only
    // their OWN row (the session's user_id — the body can't target anyone else).
    // 1–24 chars, trimmed, non-blank; a name another member already owns → 409.
    if (req.method === 'POST' && p === '/api/house/profile/name') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to rename' }); return true; }
      const b = await parseJson(req);
      const name = (b && b.name || '').toString().trim().slice(0, 24);
      if (!name) { json(res, 400, { error: 'name required' }); return true; }
      if (!/^[\p{L}\p{N} '._-]{1,24}$/u.test(name)) { json(res, 400, { error: 'invalid name' }); return true; }
      const r = renameHouseUser(s.user_id, name);
      if (r.collision) { json(res, 409, { error: 'that name is taken' }); return true; }
      if (!r.ok) { json(res, 400, { error: 'could not rename' }); return true; }
      log(`rename: user #${s.user_id} → ${r.user.name}`);
      // Return a refreshed session view so the client can re-sync identity.
      const fresh = sessionFromReq(req, { touch: false });
      json(res, 200, { ok: true, user: { id: r.user.id, name: r.user.name }, session: fresh ? sessionPublic(fresh) : null }); return true;
    }

    // Choose your NON-photo avatar. SESSION-GATED (own row only). The value must
    // be 'google'/'remove' (use the Google photo / colored-initial fallback) —
    // the dormant presets stay accepted for backward-compat, but the UI no longer
    // offers them: the primary, visible choice is now a real uploaded photo (see
    // POST /api/house/profile/photo). Never an arbitrary string/url. 'remove' (or
    // 'google') also forgets any uploaded photo. Persisted to house_users.avatar.
    if (req.method === 'POST' && p === '/api/house/profile/avatar') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to set an avatar' }); return true; }
      const b = await parseJson(req);
      let avatar = (b && b.avatar != null ? b.avatar : '').toString();
      if (avatar === '' || avatar === 'google' || avatar === 'remove') avatar = 'google';
      if (!AVATAR_VALUES.has(avatar)) { json(res, 400, { error: 'invalid avatar' }); return true; }
      const before = getHouseUser(s.user_id);
      // Forget any uploaded photo when switching away from it (the column is
      // cleared by setHouseUserAvatar; also unlink the orphaned file from disk).
      const prevFile = before && before.avatar === 'upload' ? before.avatar_file : null;
      // Store null for the default ('google') so an unset user reads the same.
      const user = setHouseUserAvatar(s.user_id, avatar === 'google' ? null : avatar);
      if (prevFile) deleteAvatarFile(prevFile, log);
      const fresh = sessionFromReq(req, { touch: false });
      log(`avatar: user #${s.user_id} → ${avatar}`);
      json(res, 200, { ok: true, user: { id: user.id, name: user.name, avatar: user.avatar || null }, session: fresh ? sessionPublic(fresh) : null }); return true;
    }

    // Upload a REAL profile photo. SESSION-GATED (own row only — the session's
    // user_id is authoritative; the body can't target another user). The client
    // downscales + center-crops on a canvas and sends a base64 data URL; we
    // validate the declared type, decode with Buffer, enforce the decoded-size
    // cap, write the file atomically under <DATA>/avatars/, then point the DB at
    // it (bumping the version stamp so the served URL busts caches).
    if (req.method === 'POST' && p === '/api/house/profile/photo') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to upload a photo' }); return true; }
      const b = await parseJsonLarge(req, PHOTO_MAX_DATAURL);
      if (b === 'TOO_LARGE') { json(res, 413, { error: 'image too large' }); return true; }
      const dataUrl = (b && b.dataUrl != null ? b.dataUrl : '').toString();
      const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
      if (!m) { json(res, 400, { error: 'expected a base64 image data URL' }); return true; }
      const mime = m[1].toLowerCase();
      const ext = PHOTO_MIME[mime];
      if (!ext) { json(res, 400, { error: 'image must be JPEG, PNG or WebP' }); return true; }
      let buf;
      try { buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64'); } catch { buf = null; }
      if (!buf || !buf.length) { json(res, 400, { error: 'could not decode image' }); return true; }
      if (buf.length > PHOTO_MAX_BYTES) { json(res, 413, { error: 'image too large (max 512 KB)' }); return true; }
      // Sanity-check the magic bytes match the declared type (don't trust the
      // header alone — never write a mislabelled blob to the served avatars dir).
      if (!sniffImage(buf, ext)) { json(res, 400, { error: 'not a valid image' }); return true; }
      const before = getHouseUser(s.user_id);
      const prevFile = before && before.avatar === 'upload' ? before.avatar_file : null;
      // Content-addressed-ish unique name (userId + random) so a stale cached
      // URL never resolves to a new photo; the old file is unlinked below.
      const fname = `user-${s.user_id}-${randomBytes(6).toString('hex')}.${ext}`;
      const dest = join(paths.AVATARS, fname);
      try {
        await fsp.mkdir(paths.AVATARS, { recursive: true });
        // Atomic write: a temp file in the same dir, then rename into place.
        const tmp = dest + '.tmp';
        await fsp.writeFile(tmp, buf, { mode: 0o644 });
        await fsp.rename(tmp, dest);
      } catch (e) { log(`avatar write error: ${e}`); json(res, 500, { error: 'could not save photo' }); return true; }
      const user = setHouseUserAvatarFile(s.user_id, fname);
      if (prevFile && prevFile !== fname) deleteAvatarFile(prevFile, log);
      const fresh = sessionFromReq(req, { touch: false });
      const pics = googlePictureByUser();
      const avatarUrl = avatarUrlFor(user, pics.get(s.user_id) || null);
      log(`avatar upload: user #${s.user_id} → ${fname} (${buf.length}b)`);
      json(res, 200, { ok: true, avatarUrl, user: { id: user.id, name: user.name, avatar: 'upload', avatarUrl }, session: fresh ? sessionPublic(fresh) : null }); return true;
    }

    // ----- calendar: Google sync (busy intervals) + manual busy blocks -------
    // Push up the signed-in user's REAL Google Calendar busy intervals. The
    // OAuth access-token flow + Calendar freeBusy call all happen IN THE BROWSER
    // (Roots); we receive ONLY the resulting busy intervals — never the token,
    // never event titles. SESSION-GATED (own data). Body:
    //   { intervals:[{start,end},…], source:'google' }
    // This REPLACES the user's google-sourced rows (a reconnect/refresh is
    // authoritative). An empty intervals array disconnects (forgets them).
    if (req.method === 'POST' && p === '/api/house/calendar/busy/google') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to connect a calendar' }); return true; }
      const b = await parseJson(req);
      if (!b || (b.source && b.source !== 'google')) { json(res, 400, { error: 'expected source:google' }); return true; }
      const raw = Array.isArray(b.intervals) ? b.intervals : null;
      if (!raw) { json(res, 400, { error: 'need an intervals array' }); return true; }
      if (raw.length > CAL_MAX_INTERVALS) { json(res, 400, { error: 'too many intervals' }); return true; }
      const now = Date.now();
      const horizon = now + CAL_HORIZON_MS;
      // Validate + clamp every interval: finite, end>start, within the storage
      // horizon, and not already fully past. Drop anything malformed.
      const clean = [];
      for (const iv of raw) {
        const start = parseInt(iv && iv.start, 10), end = parseInt(iv && iv.end, 10);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        if (end <= now || start >= horizon) continue;
        clean.push({ start: Math.max(start, now - 24 * 3600 * 1000), end: Math.min(end, horizon) });
      }
      const written = replaceGoogleBusy(s.user_id, clean);
      log(`google calendar synced: user #${s.user_id} (${written} busy intervals)`);
      json(res, 200, { ok: true, connected: written > 0, eventCount: written }); return true;
    }
    // Disconnect Google Calendar — forget the user's google-sourced busy rows.
    if (req.method === 'POST' && p === '/api/house/calendar/disconnect') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to disconnect' }); return true; }
      const removed = clearGoogleBusy(s.user_id);
      log(`google calendar disconnected: user #${s.user_id} (${removed} intervals)`);
      json(res, 200, { ok: true, connected: false, removed }); return true;
    }

    // Add a manual busy block. SESSION-GATED (own row). { start, end, label? }
    // are epoch ms (end > start). For the calendar to find shared free time even
    // when Google Calendar is missing some of a person's commitments.
    if (req.method === 'POST' && p === '/api/house/calendar/busy') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to add busy time' }); return true; }
      const b = await parseJson(req);
      const start = parseInt(b && b.start, 10), end = parseInt(b && b.end, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { json(res, 400, { error: 'need a valid start + end' }); return true; }
      // Bound the span: no block longer than 14 days, none starting >120 days out.
      if (end - start > 14 * 24 * 3600 * 1000) { json(res, 400, { error: 'that block is too long' }); return true; }
      if (start > Date.now() + 120 * 24 * 3600 * 1000) { json(res, 400, { error: 'that is too far in the future' }); return true; }
      const label = (b && b.label || '').toString().trim().slice(0, 120) || null;
      const id = addBusyBlock({ userId: s.user_id, startMs: start, endMs: end, label });
      log(`busy block #${id} by user #${s.user_id}`);
      json(res, 200, { ok: true, id }); return true;
    }
    // Delete one of YOUR OWN manual busy blocks. SESSION-GATED + id-scoped.
    if ((req.method === 'POST' || req.method === 'DELETE') && p === '/api/house/calendar/busy/delete') {
      const s = sessionFromReq(req);
      if (!s) { json(res, 401, { error: 'sign in to remove busy time' }); return true; }
      const b = await parseJson(req);
      const id = parseInt(b && b.id, 10);
      if (!Number.isFinite(id)) { json(res, 400, { error: 'which block?' }); return true; }
      const removed = deleteBusyBlock({ userId: s.user_id, id });
      json(res, 200, { ok: true, removed }); return true;
    }

    if (req.method === 'POST' && p === '/api/house/session/start') {
      const b = await parseJson(req);
      const user = resolveUser(b);
      if (!user) { json(res, 400, { error: 'unknown user' }); return true; }
      const fresh = !activeSessionForUser(user.id);
      const session = startCleanSession(user.id);
      if (fresh) {
        const text = `${user.name} started cleaning the house 🧹`;
        addHouseNotification(text, 'session_start');
        log(`session #${session.id} started by ${user.name}`);
        pushAll({ title: 'Clean Mode started 🧹', body: text, tag: 'session' }, b, log);
      }
      json(res, 200, { ok: true, session, chores: choresForSession(session.id) }); return true;
    }

    if (req.method === 'POST' && p === '/api/house/session/end') {
      const b = await parseJson(req);
      const session = b && b.sessionId ? getCleanSession(parseInt(b.sessionId, 10)) : null;
      if (!session) { json(res, 404, { error: 'no such session' }); return true; }
      const changed = endCleanSession(session.id);
      if (changed) {
        const u = getHouseUser(session.user_id);
        const done = choresForSession(session.id).length;
        addHouseNotification(`${u?.name || 'Someone'} finished cleaning — ${done} ${done === 1 ? 'chore' : 'chores'} done ✨`, 'session_end');
        log(`session #${session.id} ended (${done} chores)`);
      }
      json(res, 200, { ok: true }); return true;
    }

    // Batch-log the chores the user SELECTED and then CONFIRMED. Takes
    // { userId|name, sessionId?, chores:[{chore,note?} | "key"], note? } and
    // inserts them all in one transaction, emitting exactly ONE summary
    // notification (and ONE push) for the whole batch — not one per chore. This
    // replaces the old per-tap /api/house/chore auto-log (selection happens
    // client-side now; nothing is logged until Confirm).
    if (req.method === 'POST' && p === '/api/house/chores') {
      const b = await parseJson(req);
      const user = resolveUser(b);
      if (!user) { json(res, 400, { error: 'unknown user' }); return true; }
      const raw = Array.isArray(b && b.chores) ? b.chores : [];
      if (!raw.length || raw.length > 50) { json(res, 400, { error: 'select at least one chore' }); return true; }
      // Normalize + validate each selection; dedupe non-free-text keys so the
      // same toggle can't be double-counted in a single confirm.
      const entries = []; const seen = new Set(); const labels = [];
      for (const item of raw) {
        const key = (typeof item === 'string' ? item : (item && item.chore) || '').toString();
        const def = CHORE_BY_KEY.get(key);
        if (!def) { json(res, 400, { error: 'unknown chore' }); return true; }
        let note = ((typeof item === 'object' && item && item.note) || '').toString().trim().slice(0, 200);
        if (def.freeText) {
          if (!note) { json(res, 400, { error: 'describe what you did' }); return true; }
        } else {
          if (seen.has(def.key)) continue; // collapse duplicate toggles
          seen.add(def.key);
          note = '';
        }
        entries.push({ chore: def.key, note: note || null });
        labels.push(def.freeText ? note : def.past);
      }
      if (!entries.length) { json(res, 400, { error: 'select at least one chore' }); return true; }
      const session = b && b.sessionId ? getCleanSession(parseInt(b.sessionId, 10)) : null;
      const ids = addChoreEvents({ userId: user.id, sessionId: session ? session.id : null, entries });
      // One summary notification for the whole confirmed batch.
      const summary = labels.length === 1 ? labels[0]
        : labels.slice(0, -1).join(', ') + ' & ' + labels[labels.length - 1];
      const text = `${user.name} cleaned: ${summary} 🧹`;
      addHouseNotification(text, 'chore');
      log(`batch ${ids.length} chore(s) by ${user.name}: ${entries.map((e) => e.chore).join(',')}`);
      pushAll({ title: `🧹 ${user.name} cleaned`, body: summary, tag: 'chore' }, b, log);
      json(res, 200, { ok: true, ids, count: ids.length }); return true;
    }

    // Undo / clear (the "decrease"/reset the user asked for). Scoped to the
    // caller's OWN events only. scope:"batch" removes the ids just returned by a
    // confirm; scope:"today" wipes all of this user's chores since local midnight
    // (resetting their points). DELETE is accepted as an alias for POST.
    if ((req.method === 'POST' || req.method === 'DELETE') && p === '/api/house/chores/undo') {
      const b = await parseJson(req);
      const user = resolveUser(b);
      if (!user) { json(res, 400, { error: 'unknown user' }); return true; }
      const scope = (b && b.scope || 'batch').toString();
      let removed = 0;
      if (scope === 'today') {
        removed = deleteChoreEventsSince({ userId: user.id, sinceMs: dayStartMs() });
        if (removed) { addHouseNotification(`${user.name} cleared their chores for today 🧽`, 'info'); log(`cleared today: ${removed} chore(s) by ${user.name}`); }
      } else {
        const ids = Array.isArray(b && b.ids) ? b.ids.slice(0, 50) : [];
        if (!ids.length) { json(res, 400, { error: 'nothing to undo' }); return true; }
        removed = deleteChoreEvents({ userId: user.id, ids });
        if (removed) log(`undo batch: ${removed} chore(s) by ${user.name}`);
      }
      json(res, 200, { ok: true, removed }); return true;
    }

    // ----- web push subscribe / unsubscribe -----
    if (req.method === 'POST' && p === '/api/house/subscribe') {
      const b = await parseJson(req);
      const sub = b && b.subscription;
      const endpoint = (sub && sub.endpoint || '').toString();
      const p256dh = (sub && sub.keys && sub.keys.p256dh || '').toString();
      const auth = (sub && sub.keys && sub.keys.auth || '').toString();
      // Must be a real push endpoint with both encryption keys.
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1024 || !p256dh || !auth) {
        json(res, 400, { error: 'invalid subscription' }); return true;
      }
      // Who owns this device? Prefer an explicit userId/name from the body, but
      // fall back to the login session automatically (so a signed-in device is
      // associated with its user even if the client sends nothing).
      let user = b && (b.userId || b.name) ? resolveUser(b) : null;
      if (!user) { const s = sessionFromReq(req, { touch: false }); if (s) user = getHouseUser(s.user_id); }
      try {
        addPushSubscription({ userId: user ? user.id : null, endpoint, p256dh, auth });
        log(`push subscribe${user ? ` (${user.name})` : ''}: …${endpoint.slice(-12)}`);
        json(res, 200, { ok: true }); return true;
      } catch (e) { log(`subscribe error: ${e}`); json(res, 500, { error: 'could not subscribe' }); return true; }
    }

    if (req.method === 'POST' && p === '/api/house/unsubscribe') {
      const b = await parseJson(req);
      const endpoint = (b && b.endpoint || '').toString();
      if (!/^https:\/\//.test(endpoint)) { json(res, 400, { error: 'invalid endpoint' }); return true; }
      removePushSubscription(endpoint);
      json(res, 200, { ok: true }); return true;
    }

    json(res, 404, { error: 'no such house route' });
    return true;
  } catch (e) {
    log(`house api error: ${e.stack || e}`);
    try { json(res, 500, { error: 'house error' }); } catch { /* ignore */ }
    return true;
  }
}

// Fire-and-forget Web Push fan-out to all stored subscriptions. We don't await
// it (the HTTP response shouldn't block on the push services) and never let a
// push failure surface to the caller. The actor's own device is skipped when
// the client includes its `endpoint` in the request body. The tunnel URL is the
// canonical place to open notifications, so we point clicks at it when known.
const PUBLIC_BASE = (process.env.GARDENER_PUBLIC_URL || '').replace(/\/+$/, '');
function pushAll(payload, body, log) {
  const skipEndpoint = body && typeof body.endpoint === 'string' ? body.endpoint : null;
  const url = PUBLIC_BASE || '/';
  Promise.resolve()
    .then(() => sendToAll({ ...payload, url }, { skipEndpoint, log }))
    .catch((e) => log(`push fan-out error: ${e}`));
}

// Resolve a user from {userId} or {name} (creating by name if needed) — lets the
// client pass whichever it has cached locally.
function resolveUser(b) {
  if (!b) return null;
  if (b.userId) { const u = getHouseUser(parseInt(b.userId, 10)); if (u) return u; }
  if (b.name) return upsertHouseUser(b.name);
  return null;
}
