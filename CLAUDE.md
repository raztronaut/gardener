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
