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
- **`GARDEN_RULES.md` is the garden's long-term memory** — durable standing orders from
  the humans (e.g. banned widgets like tides) so they don't have to repeat themselves in
  feedback notes. `buildSystemPrompt()` injects it into EVERY tending as inviolable,
  highest-priority law; the agent may append rules but never weaken them. When the user
  says "stop adding X for good" / "I keep removing X", record it there.

## Dashboards (GardenOS)
`public/dashboards.json` lists dashboards: `main` (the common wall,
`public/widgets/manifest.json`) plus custom ones, each with a controller **combo** of
3+ shoulder buttons and its own `public/dashboards/<id>/manifest.json` + `widgets/`
(manifest `file`s are absolute, e.g. `/dashboards/gui/widgets/reasons.js`).
- `src/pad.mjs`: holding 3+ shoulders sends `dash<code>` when the LAST is released
  (L1=a R1=b L2=c R2=d, sorted: L1+R1+L2+R2 → `dashabcd`). L2 alone = back, on release.
- `app.js switchDashboard(id)`: unmounts every card except the pinned clock (the
  GardenOS header stays too), mounts the dashboard's widgets; the SAME combo again
  returns to main. `?dash=<id>` opens one directly (QA / review screenshots).
- Current: **arcade** (L1+R1+L2+R2 — the game library screen; in a game Select+Start
  returns to the library) and **gui** (L1+R1+L2 — Gui Dávid's love notes for Louise;
  all text in `public/dashboards/gui/love.js`).
- Seeds planted while a dashboard is open are stored with that `dashboard`
  (feedback column). `iterate.mjs` tends main (always) and then each dashboard that
  has seeds, each as its OWN agent run (own context, prompt, iteration, commit),
  scoped to `public/dashboards/<id>/` — out-of-scope edits are reverted.

## Liquid glass (baked)
`public/lib/glassbake.js` reproduces liquid-glass-react's look (MIT; backdrop blur 6px
+ saturate 140%, then the library's displacement map per colour channel at scales
70/77/84) ONCE in JS and shows it as a plain image (`.gb-img`), so there is no
per-frame filter cost — nothing behind the glass moves. Cards bake from the static
`aurora-blur.jpg`; the fullscreen panel bakes from a wall screenshot
(`GET /api/wall-snapshot`, server → kiosk debug port 9223) refreshed every minute
while no panel is open, cached per panel size. Only the cursor-lit rims are live.
Measured on the kiosk: panel opens 33 ms, glass appears ~250 ms later, 60 fps.
`lib/lgr.js` (the live port) is kept for reference but unused (29 / 13 fps).
`#panel` must NOT animate opacity/filter (backdrop root).

## GPU kiosk
The snap chromium can't see the Tegra NVIDIA libs (snap confinement) → SwiftShader.
`scripts/gardener.sh kiosk` runs a non-snap Chromium (Chrome for Testing arm64 in
`~/.local/share/gardener-chrome/`, from Playwright) with `--ignore-gpu-blocklist
--use-gl=angle --use-angle=$GARDENER_ANGLE` (.env; now `gl` → OpenGL 4.5 via GLX —
`gles-egl` stalled presentation for seconds under load), GPU compositing/raster/WebGL
on; `GARDENER_CHROME_EXTRA` (.env) appends experiment flags. `GARDENER_KIOSK=snap`
falls back to the snap. The launcher deletes the profile's `Sessions/` first: the
kiosk is killed, not quit, so Chrome otherwise restores every old tab — hidden wall
copies that all obey the pad (each toggling dashboards, each running an emulator).
**Measure the screen, not the page:** in-page fps / CDP screenshots / x11grab all
looked fine while the glass was frozen. Ground truth = the camera watching a
CDP-injected blink (plain-X baseline ≈75 ms incl. camera). GPU-composited frames
can sit unpresented until the next frame pushes them out (idle wall: 0–1 s late;
animating game: ~100–190 ms steady). `--disable-gpu-compositing` fixes idle lag
but caps WebGL games at ~33 fps — don't. Also: never use animated SVG icons on the wall (the Meteocons'
SMIL animation kept the kiosk's GPU process at ~100% CPU; weather uses
`assets/weather/still/`). `#panel` must NOT animate
opacity/filter — that makes it a backdrop root and the glass would only see the veil.

## Widget contract
**Layout stability:** a loading card must already have its loaded size (app.js
reserves each card's settled height; no collapsed loading states; no size/position
animation — content only fades in). See GARDEN_RULES.md.
See the top of `public/app.js`. A widget default-exports `{ id, title, icon, size,
chrome, async mount(body, ctx) }`. `mount` must not throw; do network via `ctx.fetchJSON`
(through the SSRF-safe proxy) with loading/error/empty states. Add external hosts to
`src/proxy-allowlist.json`.

## Commands
- `npm start` — run the server (port 8787).
- `npm run smoke` — run the smoke tests.
- `npm run iterate -- manual` — run one tending iteration now.
- `npm run day | night | display-sync` — display energy control.

## /rainforest ambience (real field recordings)
`public/lib/rainforest.js` plays openly licensed field recordings (CC0 / PD / CC BY / CC BY-SA)
from the gitignored `data/ambience/` (`manifest.json`: per place `beds` + `accents`;
`credits.json`), served read-only by `GET /api/ambience/<path>` (.ogg/.json, path-guarded).
Beds: shuffled, 14 s equal-power crossfades; accents: sparse single calls, random pan/level.
Only the active place is decoded (AudioContext at 32 kHz). `/credits` shows the attribution
CC BY/BY-SA require — keep it. Rebuild/extend with `tools/ambience/` (recipe: `plan.json`,
`cands.tsv`; levels: beds -28 LUFS, calls -25 LUFS; reject hissy/traffic/voice takes).
Never commit audio. A missing `data/ambience/` = silent rainforest + a toast, not a crash.

## Super Bomberman 2 · Tall (native port, first on the Arcade shelf)
A faithful 9:16 re-implementation of SB2 battle mode: `public/arcade/sb2/` (core = line-by-line
rewrite of the original routines, 46/46 tick-exact conformance vectors; render = pixel-exact vs
the original), assets extracted from the user's ROM into `data/sb2/` (gitignored, never commit),
served by `/api/sb2/asset/`. Tooling + specs in `tools/sb2/` (README, SPEC.md, NOTES-*.md).
**The tending must not modify `public/arcade/sb2/` or `tools/sb2/`** — any change there must keep
`node tools/sb2/conformance/run.mjs` at 46/46. Fresh clone: `tools/sb2/build-rom-data.sh`.
On the shelf it is **Super Bomberman: The Garden Edition** (by Gui Dávid): the Garden Edition skin (default; GARDEN / CLASSIC row on the
stage select) = original pixel art in `public/arcade/sb2/garden/` built by `tools/sb2/garden/make.sh`
(sources in `tools/sb2/garden/src/`, tools/sb2/NOTES-garden.md).

## "Hey Garden" — voice control (hand-maintained; the tending must not modify it)
`src/voice.mjs` (gardener-voice.service, MemoryMax 900M) listens on the USB mic through
PulseAudio, 16 kHz, **audio only in RAM** (a 2.5 s ring + a ≤12 s request buffer, zeroed after
use; never written, never sent). Wake word = sherpa-onnx keyword spotter ("HEY GARDEN") then a
second check by the speech model (Parakeet TDT 110M, worker thread `src/voice-asr-worker.mjs`) on
the last 2 s; the request ends on silence (silero VAD). Only the TEXT goes to
`src/voiceagent.mjs` (Claude Haiku 5.5, tools: open / close / select / press / volume / command /
dashboard / zoom / plant) — one model call in the common case (the wall supplies the reply when
the model writes none). Transcripts are not logged. The wall side is `public/lib/voice.js`
(Siri-style WebGL edge glow on a half-res canvas drawn only while active, live words, closure
sounds in lib/uisound.js) + `voiceContext` / `voiceAct` at the end of app.js (the same functions a
tap / click / pad press uses). SSE + replies on 127.0.0.1:8797 (wall origins only). `/voice`
turns it off (mic closed). Models + QA: tools/voice/README.md. Keep `src/voice*.mjs`,
`public/lib/voice.js` and `voiceAct` working; never add audio storage or upload.

## Arcade — retro-console emulator widget
**PS1 runs natively** (2026-11-03): `src/native.mjs` launches RetroArch + PCSX-ReARMed
fullscreen over the kiosk (`/api/arcade/native`, one game at a time; Select+Start quits, the
4-shoulder chord / heart / voice stop it); EmulatorJS's WASM psx ran ~15–25 fps. Binaries:
tools/arcade/README.md.
`public/widgets/emulator.js` (replaced the old Mario widget). **Off-grid since
2026-10-01:** it is `enabled:false` in the manifest (no wall tile) and opens only
via the controller chord **L1 + R1 + L2 + R2** held together (`src/pad.mjs` sends
`arcade` → `openArcade()` in `app.js`, which imports the module on demand). `openFull` shows a ROM **picker**
(navigable by mouse and controller) then boots **EmulatorJS** (loaded at runtime
from `cdn.emulatorjs.org/stable/data/` — cores are large, never vendored) for the
chosen game. The card stays light (no EmulatorJS, no animation) so the headless
smoke render is cheap.
- **ROMs go in `data/roms/`** (`<GARDENER_DATA>/roms/`, `paths.ROMS` in
  `config.mjs`, auto-created, gitignored — we never ship ROMs). See
  `public/widgets/EMULATOR.md` for the extension→console table.
- Server endpoints (localhost wall server, `src/server.mjs`): `GET /api/roms`
  → `{ roms: [{name, file, system}] }` (system inferred from extension; dotfiles
  / unknown extensions ignored; sorted by name) and `GET /roms/<file>` →
  streams the ROM bytes read-only (basename-guarded, `application/octet-stream`,
  cache-friendly, 404 if missing). Extension→system→core map lives in both
  `server.mjs` (`ROM_SYSTEMS`) and the widget (`CORE`).
- Controller in-game (2026-10-07): pad.mjs also streams RAW edges — `jb<idx a..p><d|u>`
  for every button press/release and `jx<l|c|r>` / `jy<u|c|d>` for direction changes.
  app.js routes them only to `window.__GARDEN_GAME.raw`, which maps the SN30 Pro to
  EmulatorJS's default RetroPad keys (A=z B=x X=a Y=s L=q R=e Select=v Start=Enter,
  arrows) with true hold/release. L2 (and Esc) leaves the game.
- A running game is fullscreen (`body.arcade-full`: no panel chrome, black, z 300) and
  renders at native resolution (900×675, 4:3) — the half-res SwiftShader scaling is
  gone now that the kiosk has the GPU. Measured: 59 fps emulation (Super Bomberman).
- Controller: the SN30 Pro is a browser Gamepad, so EmulatorJS reads it natively
  in-game. The widget sets `window.__GARDEN_GAME = {input, stop}`; in the picker
  `input()` drives selection, in-game it's a no-op (EmulatorJS owns the pad).
  L2/Esc → the parent calls `stop()`, which HARD-STOPS the emulator AND its audio
  by **removing the iframe** (destroys the document, WASM core and Web Audio
  context in one shot — a fresh, fully-disposable world per boot).

### How a game actually boots (the architecture that makes it RUN)
The widget boots a game by pointing an iframe at a **served same-origin page**,
`GET /emu-frame.html?core=<id>&rom=<file>&name=<label>` (`serveEmuFrame` in
`server.mjs`), NOT a `srcdoc` — it validates the core + that the ROM is a real
file in `data/roms/`, then emits the `EJS_*` setup + the CDN `loader.js`. Three
non-obvious things were required to get a live, playing canvas on this Jetson:
1. **No hardware GL → software WebGL.** The Tegra GPU is blocklisted in the snap
   Chromium and `--ignore-gpu-blocklist` does NOT recover it (NOGL). Chrome 149
   also disabled the automatic software-WebGL fallback. So the kiosk launcher
   (`scripts/gardener.sh`) passes **`--enable-unsafe-swiftshader`** — without it
   EmulatorJS aborts with `Failed to initialize webgl` / `GLctx undefined` and a
   `0×0` canvas. (This only affects pages that request a WebGL context; the
   dashboard's CSS compositing is unchanged — verified 7 widgets, smoke green.)
2. **Force WebGL2.** Under SwiftShader RetroArch's WebGL1 path renders a black
   frame; `EJS_defaultOptions={ webgl2Enabled:'enabled' }` makes it present.
3. **The audio gesture gate (the real "freeze").** RetroArch's audio-synced main
   loop blocks until its Web Audio context is `running`, but that context is
   created INSIDE the iframe, which never gets a user gesture (the picker click
   lands in the parent), so autoplay policy keeps it `suspended` and the loop
   stalls after ~4 frames on a black screen. Fix: the served page hooks
   `AudioContext` and resumes every context it makes (immediately, on a poll
   until running, on local input, and on the `emu-kick` `postMessage` the widget
   fires repeatedly from within its real boot gesture for the first ~6s).
- **Performance:** software SwiftShader fill scales with canvas pixels, so the
  served page renders into a HALF-resolution `#game` and scales it 2× with a CSS
  transform (`image-rendering:pixelated`) — ~20fps vs ~13fps at native size.
  Threaded core (`EJS_threads=true`) is on; it needs SharedArrayBuffer, which is
  why the wall page keeps **COOP:same-origin + COEP:credentialless** (in
  `serveStatic`; `/emu-frame.html` sends the same headers). credentialless keeps
  the CDN cores + cross-origin avatar images loading. The threaded core is a
  small win here (the bottleneck is the software compositor, not emulation) but
  COOP/COEP was already verified harmless to the dashboard + Roots Wall mirror,
  so it stays.

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

**Mandatory Google login GATE (when configured).** When `auth-config` returns a
`googleClientId`, the app raises a full-screen, on-brand login gate (aurora bg,
Space Grotesk "Roots" wordmark, ONLY a "Sign in with Google" button) on boot and
keeps the tab bar + every screen hidden (`body.gated`) until there's a valid
`/me` session. After a successful `google-login` the gate is dismissed, the app
revealed, and the current user set from the session; Sign out (You tab) returns
to the gate. SAFETY FALLBACK: when `auth-config` returns `{}` (dev / unconfigured)
the gate NEVER shows and the classic name-pick / type-your-name login runs exactly
as before, so an unconfigured install is never bricked. The read-only wall
surface (`/api/house/status`) is unaffected — the gate is purely client-side.

**Rename yourself + profile picture (Roots, June 2026).**
- Columns on `house_users` (all idempotent try/catch `ALTER TABLE … ADD COLUMN`):
  `avatar TEXT`, `avatar_file TEXT`, `avatar_v INTEGER`. Semantics of `avatar`:
  `'google'`/`NULL` → the Google account photo (latest `house_sessions.picture`
  for that user) if present, else the colored-initial bubble; `'upload'` → a REAL
  uploaded profile photo (filename in `avatar_file`, version stamp in `avatar_v`).
  `'preset:<id>'` values are DORMANT legacy (still render, but the UI no longer
  offers the template picker — the user wanted a real photo). Image bytes are
  NEVER stored in SQLite; uploaded files live one-per-user under the gitignored
  `<GARDENER_DATA>/avatars/` dir (path via `paths.AVATARS` in `config.mjs`).
- **Uploaded profile photos.** The You tab shows a round preview + "Upload a
  photo" (`<input type=file accept=image/* capture>` — phones can use the camera)
  + "Use my Google photo" / "Remove photo". On select the client reads the File,
  downscales + center-crops it to 256×256 on a canvas, exports JPEG ~0.85, and
  POSTs a base64 data URL. The bubble is the only non-photo fallback.
- Session-gated, rate-limited write endpoints (own row only — the body can't
  target another user; the session's `user_id` is authoritative):
  - `POST /api/house/profile/name { name }` — rename in place (1–24 chars; another
    member's name → **409**; missing token → 401).
  - `POST /api/house/profile/photo { dataUrl }` — base64 image upload. Validates
    content-type ∈ {image/jpeg, image/png, image/webp}, magic bytes, decoded size
    ≤ 512 KB (→ **413**), raw body ≤ 1 MB. Writes atomically to `avatars/`
    (`user-<id>-<rand>.<ext>`), sets `avatar='upload'` + bumps `avatar_v`, unlinks
    the old file, returns the new `avatarUrl`. Non-image/mislabelled → 400; no
    token → 401.
  - `POST /api/house/profile/avatar { avatar }` — `'google'`/`'remove'` (stored as
    NULL, clears + unlinks any uploaded file) or a dormant preset id; arbitrary
    urls → 400; no token → 401.
- `GET /api/house/avatar/<userId>` — streams the stored photo with the right
  content-type + a long immutable cache (the URL carries `?v=<avatar_v>` so it
  busts on change). Keyed by integer userId, basename-guarded (path-traversal
  safe), 404 when there's no uploaded photo. Mounted read-only on BOTH the public
  plant-server AND the localhost wall server (the cleaning widget reads it).
- `GET /api/house/me`, `/api/house/household`, and `houseStatus()` (so BOTH
  servers' `/api/house/status`) now ADD `avatar` + `googlePicture` + **`avatarUrl`**
  to each user / leaderboard / activity / cleaning row. `avatarUrl` resolves
  uploaded photo → Google photo → null (additive; the wall widget already consumes
  `avatarUrl`). `renderAvatar()` renders `avatarUrl`/`googlePicture` as an `<img>`,
  else the colored-initial bubble (dormant presets still draw for legacy rows).
  Rename + photo upload are both inline on the profile card (optimistic + toast).

**Shared availability calendar — REAL Google Calendar (Roots, June 2026).**
The "garden calendar" finds when the whole household is free. Each member's BUSY
time is the union of their **real Google Calendar** busy intervals + any **manual**
busy blocks they typed. The Note-screen pane + the wall widget
(`public/widgets/calendar.js`, "When We're Free") render the computed shared free
windows. (This REPLACED an earlier iCal-`.ics`-paste sync — there is no iCal code
anymore: no `house_calendars` table, no `parseIcsBusy`, no `/calendar/ics`.)
- **DB:** one table `house_busy(id, user_id, start_ms, end_ms, source 'google'|
  'manual', label, created_at)` (in `db.mjs`, Roots section). A reconnect REPLACES
  that user's `source='google'` rows in one transaction; manual rows are
  independently add/delete-able. The legacy `house_calendars`/`house_busy_blocks`
  tables are dropped on startup (idempotent `DROP TABLE IF EXISTS`).
- **The OAuth token flow runs ENTIRELY in the browser (Roots, You tab).** Sign-in
  gives only an ID token; reading calendars needs an ACCESS token. The "Connect
  Google Calendar" button uses GIS `google.accounts.oauth2.initTokenClient({
  client_id, scope:'https://www.googleapis.com/auth/calendar.readonly', callback })`
  + `.requestAccessToken()` (reusing the already-loaded `gsi/client`). With the
  token the browser calls `GET …/calendar/v3/users/me/calendarList` then `POST
  …/calendar/v3/freeBusy` over the next 14 days, collecting BUSY intervals (no
  event titles — privacy-safe). It then POSTs ONLY the intervals to the server —
  **the access token never leaves the browser.**
- **Endpoints (`src/house-api.mjs`, session-gated via `x-roots-token`):**
  - `POST /api/house/calendar/busy/google { intervals:[{start,end}], source:'google' }`
    — validates/clamps (finite, end>start, within a 30-day horizon, drops past),
    caps 1000, and REPLACES the user's google rows. Empty array = disconnect.
  - `POST /api/house/calendar/disconnect` — forgets the user's google rows.
  - `POST /api/house/calendar/busy { start, end, label? }` — add ONE manual block.
  - `POST /api/house/calendar/busy/delete { id }` — delete one of YOUR manual
    blocks (google rows aren't user-deletable).
  - `GET /api/house/calendar/mine` — `{ connected, eventCount, blocks }` (blocks =
    manual only; connected/eventCount reflect the google sync).
  - `GET /api/house/calendar` — the merged household view `{ members, windows,
    updatedAt }`; `windows` are upcoming shared free slots (8am–10pm, 30-min
    granularity, ≤6). Read-only, mounted on BOTH servers, ALWAYS 200 (empty arrays
    when there's no data) so the wall widget degrades gracefully.
- **CONSOLE REQUIREMENT (user must do this — not doable from code).** The
  access-token flow only works once, in Google Cloud Console for this OAuth
  client/project: (1) **enable the Google Calendar API**; (2) on the **OAuth
  consent screen** add the scope `…/auth/calendar.readonly` and add the user as a
  **Test user** (while the app is in Testing); (3) the request only succeeds from a
  **registered Authorized JavaScript origin** — the permanent ngrok domain
  `https://spiritless-karissa-attent.ngrok-free.dev`. Until all three are done,
  Google rejects the token request; Roots CATCHES that and shows "Couldn't
  connect — calendar access may not be enabled yet" without breaking the app.

**Wall view (read-only passthrough).** The plant-server proxies `GET /wall` →
`http://127.0.0.1:8787/?screenshot=1` (screenshot mode hides the input bar +
cursor, so it's view-only) plus a STRICT GET-only allowlist of the wall page's
needs: `/app.js`, `/styles.css`, `/widgets/*` (.js + manifest.json), `/lib/*.js`,
`/api/state`, `/api/version`, `/api/iterations`, `/api/proxy`,
`/api/house/status`, `/api/pad/stream` (SSE, streamed). POSTs are never
forwarded and nothing else (no `/api/feedback` GET, `/api/night`,
`/api/pad/action`) is exposed. The Roots Wall tab embeds it in a scaled iframe
that exists only while the tab is open.
