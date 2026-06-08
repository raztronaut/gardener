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

## "Hearth" — household side app (HAND-MAINTAINED — daily tending MUST NOT modify)
There is a separate, mobile-first household web app called **Hearth** ("The House")
served on the PUBLIC plant-server surface (the tunnel) at `/` (with `/plant.html`
kept as a fallback). It is a hand-maintained side project and is **NOT part of the
self-tending loop**: the daily tending agent must NOT edit, refactor, or delete its
files, tables, endpoints, or its wall widget. Leave it strictly alone.
Its files (all clearly namespaced):
- `public/house/` — the Hearth app (`index.html`, `app.js`, `house.css`): three
  screens behind a bottom tab bar — Plant a Note · Community Macros (Start Clean
  Mode + chore checklist + identity) · Dashboard (leaderboard, day/week toggle,
  cleaning-now, activity, notifications).
- `src/house-api.mjs` — the household JSON API router (chore catalog, validation,
  rankings, `houseStatus()`). Imported by `plant-server.mjs` (full read+write,
  rate-limited) and `server.mjs` (read-only `/api/house/status` for the widget).
- `db.mjs` — the `house_users / clean_sessions / chore_events / house_notifications`
  tables + helpers (in the clearly-marked Hearth section). Do not touch them.
- `public/widgets/house-cleaning.js` — the ONE wall widget that surfaces Hearth on
  the dashboard ("🧹 \<name\> is cleaning" + today's top cleaners + recent chores),
  reading the localhost read-only `/api/house/status`. The agent may restyle the
  garden but must keep this widget present and working.
- `smoke/house-smoke.mjs` — Hearth's own smoke (folded into `npm run smoke`).
Points: 1 per chore; "put trash to the curb" and "vacuumed floor" are worth 2.
Day = since local PT midnight; Week = rolling 7 days. Web Push is deferred (in-app +
wall notifications only).
