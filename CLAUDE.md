# The Gardener™ — project guide

A self-cultivating 24/7 ambient dashboard. A tiny Node server serves a **no-build**
vanilla HTML/CSS/JS frontend in a locked **900×1600 (9:16)** kiosk window. Once a day
an autonomous Claude agent ("the daily tending") improves the **widgets** based on the
day's user feedback (or self-directed when there's none), gated by smoke tests + a
visual review, and deployed only on green via git.

## Layout
- `public/` — the live frontend (served statically).
  - `index.html` stable shell · `styles.css` theme + CSS vars · `app.js` widget runtime.
  - `widgets/manifest.json` registry · `widgets/<id>.js` one self-contained widget each.
- `src/` — backend: `server.mjs` (http+API+proxy), `db.mjs` (SQLite WAL), `iterate.mjs`
  (daily loop), `systemPrompt.mjs`, `screenshot.mjs`, `visualReview.mjs`, `display.mjs`
  (day/night energy), `gitlib.mjs`/`recover.mjs` (consistency & crash recovery),
  `proxy-allowlist.json` (hosts widgets may fetch).
- `smoke/smoke.mjs` — the safety net (must stay green). `data/` — runtime state (gitignored).

## Invariants
- **git HEAD is always known-good.** Deploy = commit-on-green; failure = `git reset --hard` base.
- **No build step, no npm deps in widgets, no frameworks.** Widgets are browser ES modules.
- **The 9:16 canvas is locked at 900×1600.** Design for legibility from across a room.
- Secrets live only in `.env` (chmod 600, gitignored). Never commit or echo the API key.

## Widget contract
See the top of `public/app.js`. A widget default-exports `{ id, title, icon, size,
chrome, async mount(body, ctx) }`. `mount` must not throw; do network via `ctx.fetchJSON`
(through the SSRF-safe proxy) with loading/error/empty states. Add external hosts to
`src/proxy-allowlist.json`.

## Commands
- `npm start` — run the server (port 8787).
- `npm run smoke` — run the smoke tests.
- `npm run iterate -- manual` — run one tending iteration now.
- `npm run day | night | display-sync` — display energy control.

## "Roots" — household side app (HAND-MAINTAINED — daily tending MUST NOT modify)
There is a separate, mobile-first household web app called **Roots** ("The House")
served on the PUBLIC plant-server surface (the tunnel) at `/` (with `/plant.html`
kept as a fallback). It is a hand-maintained side project and is **NOT part of the
self-tending loop**: the daily tending agent must NOT edit, refactor, or delete its
files, tables, endpoints, or its wall widget. Leave it strictly alone.
("Roots" is the display name only — internal identifiers stay as-is: the
`public/house/` dir, `src/house-api.mjs`, `src/push.mjs`, the `house_*` tables, the
`/api/house/*` routes, `GARDENER_*` env names, and the `hearth-icon-*.png` assets.)
Its files (all clearly namespaced):
- `public/house/` — the Roots app (`index.html`, `app.js`, `house.css`): five
  screens behind a bottom tab bar — Plant a Note · Community Macros (Start Clean
  Mode + a chore checklist of toggle checkboxes that batch-log on Confirm, plus
  Undo/Clear-today + identity mini-flow) · Dashboard (leaderboard, day/week
  toggle, cleaning-now, activity, notifications) · **Wall** (a live mirror of the
  wall dashboard in an iframe of `/wall`, scaled 900×1600 → phone width,
  mounted only while the tab is open) · **You** (account: profile + provider
  badge, optional Google sign-in, the "Enable notifications" card, the
  household list with last activity + signed-in devices, Sign out).
  Also the PWA pieces: `sw.js` (push service worker) + `manifest.webmanifest`.
  **Design: Roots mirrors the wall's design system exactly** (public/styles.css
  is the source of truth): flat transparent cards (1px var(--stroke) border,
  radius 26px, no glass/shadows/sheens), JetBrains Mono 11px uppercase corner
  card titles, the same aurora gradient backdrop + palette tokens, Space Grotesk
  display / Inter body / JetBrains Mono labels+data, and NO emojis anywhere in
  the UI chrome (tiny inline SVG strokes where an icon is needed; leaderboard
  positions are plain mono numerals). Push-notification message TEXT may keep
  emoji — those are strings, not chrome. The fonts are the same local woff2
  files under public/assets/fonts/; plant-server.mjs's /assets/ route serves
  them with the right MIME (`.woff2` → font/woff2; it previously only allowed
  image extensions, so fonts 404'd through the tunnel and phones silently fell
  back to system fonts — that's fixed and smoke-tested now).
- `src/house-api.mjs` — the household JSON API router (chore catalog, validation,
  rankings, `houseStatus()`, push subscribe/unsubscribe, VAPID public key, login
  sessions: `/api/house/me·logout·auth-config·google-login·household`).
  Imported by `plant-server.mjs` (full read+write, rate-limited) and `server.mjs`
  (read-only `/api/house/status` + `/api/house/vapid-public` for the widget).
- `src/push.mjs` — Web Push helpers: owns the VAPID keypair and the fan-out send.
- `db.mjs` — the `house_users / clean_sessions / chore_events / house_notifications
  / house_push_subscriptions / house_sessions` tables + helpers (in the
  clearly-marked Roots section). Do not touch them.
- `public/widgets/house-cleaning.js` — the ONE wall widget that surfaces Roots on
  the dashboard ("🧹 \<name\> is cleaning" + today's top cleaners + recent chores),
  reading the localhost read-only `/api/house/status`. The agent may restyle the
  garden but must keep this widget present and working.
- `smoke/house-smoke.mjs` — Roots's own smoke (folded into `npm run smoke`).
Points: 1 per chore; "put trash to the curb" and "vacuumed floor" are worth 2.
Day = since local PT midnight; Week = rolling 7 days.

**Web Push (real phone notifications, app-closed).** Backend dep `web-push` was
added (BACKEND only — widgets still take none). A VAPID keypair is generated on
first startup and persisted to gitignored `data/vapid.json` (or override via
`GARDENER_VAPID_PUBLIC`/`GARDENER_VAPID_PRIVATE` in `.env`); both the plant-server
and the wall server read the same file so the sender and the subscribed public key
never diverge. New table `house_push_subscriptions(id, user_id, endpoint UNIQUE,
p256dh, auth, created_at)`. New public endpoints (validated + within the existing
rate limit): `GET /api/house/vapid-public`, `POST /api/house/subscribe`,
`POST /api/house/unsubscribe`. A push fires to ALL stored subscriptions (skipping
the actor's own device) when someone **starts Clean Mode** and when a **chore is
logged** — same text as the in-app notification; dead subscriptions are pruned on
404/410. **HTTPS is required for push**, so phones MUST open the **tunnel URL**
(https, in `data/public-url.txt`), not localhost. **Android Chrome** can subscribe
directly. **iOS (16.4+) only delivers web push to an INSTALLED PWA** — the user
must use Share → "Add to Home Screen" and open Roots from that icon before the
"Enable notifications" button works (the UI shows that hint on iOS Safari).

**Login sessions + optional Google Sign-In.** Picking/typing a name on the
identity flow now ALSO mints a server-side session (`house_sessions` table:
token UNIQUE, user_id, provider `name`|`google`, email, picture, created_at,
last_seen). The client stores the opaque token in localStorage (`hearth.token`)
and sends it as the `x-roots-token` header on every API call; `GET
/api/house/me` resolves it (touching last_seen), `POST /api/house/logout`
deletes it. Sessions ENRICH identity — requests WITHOUT a token still work
exactly as before (the household is never locked out), and push subscribe calls
fall back to the session's user when no userId is sent. `GET
/api/house/household` powers the You tab (all members + last chore/session
activity + cleaning-now, plus sessions seen in the last 30 days).
Google Sign-In is OPTIONAL and currently UNCONFIGURED — everything degrades
gracefully: `GET /api/house/auth-config` returns `{}` and the You tab shows a
quiet note instead of the button. To enable it:
1. In Google Cloud Console → APIs & Services → Credentials, create an **OAuth
   client ID** of type *Web application*.
2. Add the authorized JavaScript origin
   `https://spiritless-karissa-attent.ngrok-free.dev` (the permanent tunnel).
3. Put `GARDENER_GOOGLE_CLIENT_ID=<the client id>` in `.env` and restart
   `gardener-plant.service`.
The Account screen then lazily loads GIS (`https://accounts.google.com/gsi/client`)
and renders the button; the credential is POSTed to `/api/house/google-login`,
verified server-side via Google's tokeninfo endpoint (aud/exp/email_verified —
no new deps), linked to an existing member by prior session email or by
given_name (case-insensitive upsert), and answered with a `provider:google`
session carrying email + photo.

**Wall view (read-only passthrough).** The plant-server proxies `GET /wall` →
`http://127.0.0.1:8787/?screenshot=1` (screenshot mode hides the input bar +
cursor, so it's view-only) plus a STRICT GET-only allowlist of the wall page's
needs: `/app.js`, `/styles.css`, `/widgets/*` (.js + manifest.json), `/lib/*.js`,
`/api/state`, `/api/version`, `/api/iterations`, `/api/proxy`,
`/api/house/status`, `/api/pad/stream` (SSE, streamed). POSTs are never
forwarded and nothing else (no `/api/feedback` GET, `/api/night`,
`/api/pad/action`) is exposed. The Roots Wall tab embeds it in a scaled iframe
that exists only while the tab is open.
