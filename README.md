# The Gardener™ 🌱

For this computer's project locations, services, and Paseo root workspace, see
[the host guide](docs/host/GARDENOS.md) and [agent startup instructions](docs/host/AGENTS.md).
Install those instructions at `/` with `sudo bash scripts/install-host-docs.sh`
on the dedicated GardenOS computer; the installer preserves existing root docs.

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

## To-do card
The wall's **To do** card starts with Gui's task to install the host agent docs.
Click its command to copy it, then open a terminal in this Paseo workspace with
**Ctrl+Shift+T** or **+ → Terminal** in the workspace toolbar. Copying never runs
the command. Mark the task done after running it. Open the card to add tasks or
review completed ones; the list and completion state persist in this wall browser.

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

### Widget pages

On the main GardenOS wall, swipe horizontally across the widget area or use the
numbered buttons under the title to change pages. Page 2 starts empty. Open
**Widgets** to see the full active widget catalog, assign widgets to pages, move
them up/down, remove them, or add removed widgets back onto the current page.
The clock stays on every page. You can add pages, or remove the last extra page
and move its widgets back. Layout changes save in this browser's local storage;
they do not change the manifest or personal dashboards. New widgets registered
in the main manifest appear on page 1. Temporary replacements share their
original widget's saved position.

### Wall pages and arranging widgets

Tiny dots above the chat input show the current page. Switch with a touch swipe,
Ctrl+Shift+Left/Right, the MX thumb-rest gesture button held while moving left/right
(and releasing), or L3 held with left/right on the controller D-pad or left stick.
A mouse held at a side edge in the middle of the screen switches after 2.2 seconds,
once per entry. Panels and games keep their own controls.

Use `/widgets` or hold a widget for half a second to edit it on the wall. The ×
removes it; the middle handle drags it; ↔ toggles standard/full width where offered.
The Add widgets drawer shows previews of available widgets; choosing an existing
widget on another page moves it here. Drag a widget to an edge to move it between
pages. A focused drag handle also accepts arrow keys to reorder, or Ctrl+Left/Right
to move between pages. Done or Escape ends editing. Layouts save in this browser.

The home grid in Classic and Moonstone is two small-widget columns by seven rows
(14 small slots including the pinned clock). Pages never scroll, even while
editing; overflow uses another page and only creates one when needed. Hold a
widget to edit and drag from its body; the layout commits on drop. The bottom
editing bar overlays the chat area without changing the home grid. The size
picker offers Small (2×1 grid units), Medium (2×2), Wide (4×2), Tall (2×3), and
Large (4×4), with different content arrangements for each footprint.

Voice layout commands run directly, e.g. “make the weather taller”, “make the
clock two by two”, “move the painting to page two”, “remove the weather widget”,
“add weather”, “move weather before air”, and “next page”. The voice model has a
batch `layout` tool; Jev routes layout requests to the wall. The Botanist receives
the runtime layout snapshot when a request needs new code. Trusted local scripts
can inspect `window.gardenWall.context().layout` and use the same operations via
`window.gardenWall.act({name:'layout',input:{changes:[...]}})`.

Validate finite layout and direct voice grammar with
`node tools/widget-layout/test.mjs`.

New widgets should declare `homeSize` as small, medium, wide, tall, or large,
chosen for their contents, plus corresponding footprint-specific designs in the
shared theme data. Saved user size choices take precedence.

**Original presentation restored (2026-11-04):** the equal-track home redesign and
footprint-specific content/style overrides were reverted after review. Cards
use their original authored grid, typography, padding and contents by default.
The page/editor/voice controls remain; `Original` in the size picker restores
a card’s authored size. The rejected arrangement is preserved under the old
browser storage key; the restored presentation uses a separate layout key.

Widget size choices now show previews of the current content and disable
undesigned sizes. The availability/design registry is `public/lib/widget-variants.js`;
see `tools/widget-layout/VARIANTS.md` for content rationale and checks. Original
remains the default. Hovering at a side edge shows its progress cue and changes
pages after 1.5 seconds, once per entry.

### Keep the screen awake for an hour
Press **Ctrl + Shift + Space**, or hold **Start + Select for five seconds** on the
SN30 Pro. Each use resets the deadline to one hour from now, wakes the panel and
restores brightness. Night timers and idle checks respect this override; it
survives backend restarts. A warning appears one minute before the normal display
schedule resumes. Quick controller taps retain Help / Changelog; a quick combined
press retains Arcade exit. Native PS1 games also exit on the held combo because
RetroArch reads the controller directly; use the keyboard shortcut during PS1 play.
The GNOME global shortcut runs `scripts/snooze-screen.sh` (localhost port 8787).
Validation: `node tools/display-snooze.test.mjs`.
