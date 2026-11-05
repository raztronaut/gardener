# The Gardener™ 🌱

A self-cultivating, always-on **ambient dashboard** for a wall-mounted 900×1600 (9:16)
display. It runs 24/7 on this NVIDIA Jetson Orin Nano. Each morning an autonomous Claude
agent **tends the garden** — improving its widgets based on the day's feedback (or its own
good taste when there's none) — gated by smoke tests and a visual review, and deployed only
when everything is green.

```
            ┌──────────────────────────────────────────────────────────┐
            │  surf (kiosk, fullscreen)  ──HTTP──►  Node server :8787    │
            │        ▲ auto-reloads on new version       │ serves        │
            │        │                                    ▼               │
            │   900×1600 vanilla UI  ◄── widgets/*.js ── public/          │
            └───────────────────────────────┬──────────────────────────┘
                                             │ feedback (SQLite, WAL)
        06:00 PT  ┌──────────────────────────▼─────────────────────────┐
        daily ───►│ iterate.mjs:  compile feedback → Claude Agent SDK   │
                  │  (opus-4-8, subagents) → npm run smoke → headless   │
                  │  screenshot → vision review → commit-on-green       │
                  │  (else git reset --hard → yesterday's good garden)  │
                  └─────────────────────────────────────────────────────┘
```

## Why it's built this way
- **No build step, vanilla JS.** An agent that edits the UI daily can't break a compiler that
  doesn't exist. Widgets are browser ES modules; edits take effect instantly; smoke tests are trivial.
- **git is the consistency substrate.** HEAD is always a known-good, smoke-tested state. The working
  tree only diverges during an iteration; any crash or failure reverts it. The wall never shows a broken garden.
- **Deterministic visual QA.** Screenshots are rendered in headless Chromium at exactly 900×1600 —
  independent of the physical display's power state (so it works even at 06:00 when the screen is asleep).
- **Three-layer energy saving** (no sudo, no special hardware): an opaque overlay + `xset dpms force off`
  (real power-down) + `xrandr --brightness 0`.

## Layout
| Path | What |
|---|---|
| `public/` | live frontend — `index.html` (shell), `styles.css`, `app.js` (runtime), `widgets/` |
| `src/server.mjs` | HTTP server: static UI + JSON API + SSRF-safe proxy (localhost-only) |
| `src/db.mjs` | SQLite (WAL, synchronous=FULL) — feedback + iteration history + state |
| `src/iterate.mjs` | the daily tending loop |
| `src/systemPrompt.mjs` | the agent's brief + the widget contract |
| `src/screenshot.mjs` · `visualReview.mjs` | headless render + vision critique |
| `src/display.mjs` | day / night / sync energy control |
| `src/gitlib.mjs` · `recover.mjs` | versioning + crash recovery |
| `smoke/smoke.mjs` | the safety net (60+ checks) |
| `systemd/` · `scripts/` | service units + entrypoint + installers |
| `data/` | runtime state (gitignored): DB, screenshots, per-iteration transcripts |

## Daily rhythm (Pacific time)
- **00:00** — night: opaque overlay on, screen powered down.
- **06:00** — the tending iteration runs (headless; screen stays asleep).
- **07:00** — day: screen wakes, overlay clears.

## Run it
```bash
cd ~/gardener
npm run smoke                 # 60+ checks — should be green
npm start                     # serve on :8787 (or use the service below)
npm run iterate -- manual     # run one tending now (uses the API)

# Install as always-on services + schedulers (no sudo):
./scripts/setup-gnome.sh      # stop GNOME auto-blank/lock fighting our schedule
./scripts/install.sh          # backend + kiosk now; iterate/night/day timers

# One-time, for unattended reboot (needs sudo):
sudo ./scripts/setup-autologin.sh
```

## Giving feedback
Type into the **"Plant a thought…"** bar at the bottom of the screen. It's stored durably and
compiled into the next morning's tending. No feedback? The gardener improves things on its own.

## Adding/extending widgets (the contract)
A widget is `public/widgets/<id>.js` default-exporting `{ id, title, icon, size, chrome, mount(body, ctx) }`.
`mount` must not throw; fetch external data via `ctx.fetchJSON(url)` (through the SSRF-safe proxy — add
its host to `src/proxy-allowlist.json`) with loading/error/empty states. See `public/app.js` header and
the existing widgets. Register it in `public/widgets/manifest.json`.

## Security notes
- The Anthropic API key lives only in `.env` (chmod 600, gitignored). **It was shared in chat during
  setup — consider rotating it** at console.anthropic.com.
- The server binds to `127.0.0.1` only. The proxy is allowlisted and blocks private-IP/SSRF targets.
- The daily agent runs autonomously with broad permissions in this project dir. Feedback is treated as
  direction, so only trusted people should have physical access to the input bar.

## Troubleshooting
- Logs: `data/server.log`, `data/iterate.log`, and per-run `data/iterations/<id>/`.
- Service status: `systemctl --user status gardener-backend` · `journalctl --user -u gardener-iterate`.
- Latest QA screenshot: `data/screenshots/latest.png`.
- Force a state: `npm run day` / `npm run night` / `npm run display-sync`.
- Roll back manually: `git log`, then `git reset --hard <good-commit>` (the kiosk reloads on next version bump).

## Headline game and Garden mood
- `/headlines` mixes live Hacker News posts with authored fictional headlines. Tap Real/Fake,
  then Next; `/headlines real`, `/headlines fake`, and `/headlines next` also work through the
  command interface used by voice. Reveals link real stories back to HN. Household scores
  persist in this browser; fiction stays inside the game, never the news feed.
- `/mood` or `/mood on` enables ambient tinting (on by default); `/mood off` restores the
  original visuals. Every 15 minutes a shared, cached Jev choice reads time and public widget
  text. It tints fractal art and the idle background, and switches the rainforest location
  only if sounds are already playing. Missing Jev uses a time-based fallback. No new service,
  agent, dependency, image generation, or camera access is needed.
