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
                  │  (else preserve working files for review)  │
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
- Recovery: preserve shared edits and consult `docs/recovery/2026-11-05.md`. Automatic reset/clean is disabled.

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

Editorial content is produced by subscription-authenticated **Paseo schedules**, using
Codex GPT-6 Luna / medium. There is no direct model API fallback for these jobs.
- Changelog: 09:00, 12:00, 15:00, 18:00, 21:00 PT; final pass 23:45 PT.
- Reading Room: daily at 07:00 PT, using currently connected RSS feeds.
The Paseo daemon and computer must be running at execution time.

Job rules and CLI live in `tools/editorial/`. Each agent prepares source snapshots,
writes JSON, publishes through validation, and verifies the saved state. The final
Paseo message is a receipt; `publish` writes the content GardenOS actually displays.
Manual entries revise one day at a time with #171.1-style numbering; nightly tendings
remain separate. Bold feature bullets emphasize meaningful finished capabilities,
not tiny adjustments or same-day implementation fixes. The daily reading edition
has themed sections, original article links, honest excerpt coverage and a dated
bell notification. Reading an edition acknowledges it in that browser; revisions do
not duplicate its notification. The last successful content survives job failures.

Schedule IDs are saved in `data/editorial-*-schedule.json` (runtime, gitignored).
Inspect/run/pause them with Paseo's schedule tools. Validate publishing with
`node --test tools/editorial/test.mjs tools/changelog.test.mjs`.
The pre-migration source and changelog content backup is at
`data/backups/editor-migration-20261105/`; its README explains selective restoration.

Editorial v2 preserves fuller changelog coverage (including fun/seasonal capabilities)
and grouped daily news editions: an overall overview, category summaries, linked
story capsules, and The Wild Side. Old flat editions remain readable. The editor's
source snapshot now includes up to 40 recent items per subscribed feed with bounded
excerpts; it fetches selected original articles separately.

Classic Reading Room uses a horizontal source selector with All pinned first,
a Daily/Go back toggle preserving the selected source and story, and top article
actions for original-page and fullscreen reader views. Discover includes 141 unique
feeds imported from raztronaut/personal-rss under "Razi's RSS Feeds List", with their
original categories, plus additional science/security/culture recommendations.
The selected subscription set has ten sources including the existing unavailable
Almanac entry. Catalog sources are checked when connected, not silently subscribed.
JSON Feed support retains the same bounded text sanitization and public-link checks
as RSS/Atom. The source catalog is in `src/feed-catalog.json`.

Reader reliability updates: the split pane now fetches full public article text
through `/api/feeds/article`, with source-membership validation, pinned-DNS public
fetching, bounded content, single-flight requests and a 12-hour cache. Restricted
or unavailable articles retain an explicitly labelled excerpt and original link.
The article pane is wider, with smaller text. Daily briefings use a relaxed,
smart-friend voice and smaller reading typography; editing job rules now invalidates
the editorial fingerprint so new voice/structure preferences take effect.

Almanac category RSS URLs currently return empty RSS rather than useful entries.
The selected gardening source falls back to a labelled publisher website edition;
Weather and Astronomy Almanac choices are available in Discover with the same
transparent fallback. Website items without dates stay undated.
Small To do now offers two compact checkbox rows and a remaining count. Weather
variants derive readings from forecast data independently of source DOM, and failed
initial loads retry each minute until the usual forecast interval resumes.

## Resident messaging

Open `/residents` on the GardenOS wall to add, edit or remove message recipients and see each phone's activation instructions. Voice can send the daily summary, the open item, or a dictated note to a named resident. See [Resident messaging setup](docs/messaging/README.md) for onboarding, the free Photon project setup, and recovery instructions. Credentials and resident phone numbers stay in private, gitignored runtime state.
