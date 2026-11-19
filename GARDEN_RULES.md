# Garden House Rules — standing orders from the humans (INVIOLABLE)

This file is the garden's long-term memory. The humans cannot repeat themselves in
a feedback note every single day, so durable preferences live here instead. Every
daily tending loads this file and MUST obey it — these rules outrank your own
self-directed taste and outrank the "add a new widget" suggestions in the prompt.

Rules never expire on their own. A rule is only lifted when a NEW feedback note
explicitly asks for it (e.g. "actually, bring tides back"). Until then, honour it
every day, including quiet no-feedback days.

## Banned widgets — NEVER add or re-add these (the humans removed them on purpose)
- **Astronomy Photo (NASA APOD)** — replaced by the Fractal card (3D fractal art regenerated every 3 h). Removed 2026-10-01. The Fractal is BARE
  (chrome:false, transparent PNG): no card frame, caption, backdrop or halo — the art sits on the wall itself.
  Its only text is the corner title "Trihourly Fractal" (added 2026-10-06 at the humans' request).
- **tides** — do not add a tides / tide-chart / marine / NOAA-currents widget in any
  form. The humans have removed it repeatedly and do not want it. (Removed 2026-06-20.)
- **sun-moon** — do not add a "Sun & Moon" widget (sunrise/sunset + golden/blue hour +
  moon phase) in any form. The humans removed it on request. (Removed 2026-06-14; logged
  here 2026-06-21 after finding the removal was never recorded. Note: the Weather widget's
  own sunrise/sunset line predates and is separate from this — it stays.)
- **roots / house-cleaning wall widget** — do not add the "Roots" chore/leaderboard card
  (public/widgets/house-cleaning.js) back to the wall grid. The humans asked to remove it.
  IMPORTANT: keep the corner Roots QR code (#cornerqr in app.js) — that is NOT the widget and
  stays. The Roots household app itself (public/house, house-api) is unaffected. (Removed 2026-07-11.)
- **World Cup** — do not add a FIFA World Cup schedule/scores widget, a "World Cup" tab/mode on
  the "What's On" card, or a /worldcup panel in any form. The humans asked to remove it after the
  2026 tournament. The "What's On" card is now SF-events-only ("Out in SF"). (Removed 2026-07-20.)
- **voice / mic audio capture** — do not re-add a microphone / voice-dictation / SpeechRecognition
  "speak your note" affordance to the feedback bar (or anywhere). The humans asked to remove audio
  capture. Notes are typed only. (Added 2026-07-19, removed on request 2026-07-20.)
- **When We're Free / shared calendar wall widget** — do not add the "When We're Free" household
  free-time / availability card (public/widgets/calendar.js) back to the wall grid in any form. The
  humans asked to remove it. (Removed 2026-07-26.)
- **Blink camera / motion gallery** — do not add back the "Camera" live-view widget
  (public/widgets/blink-camera.js), the "Motion" filmstrip (public/widgets/motion-gallery.js), the
  Python blinkpy sidecar (src/blink/), the /api/blink/* endpoints, or the gardener-blink /
  gardener-blink-live services in any form. The humans asked to remove the Blink camera and stop the
  system connecting to it. (Removed 2026-07-28.)

- **BART / transit departure board** — do not add a BART, Muni, transit, or train/bus departure
  widget (public/widgets/transit.js) in any form. The humans asked to remove it. (Removed 2026-09-23.)
- **Seismic / earthquakes** — do not add an earthquake, seismic, or USGS quake widget
  (public/widgets/quakes.js) in any form. The humans asked to remove it. (Removed 2026-09-23.)

## Standing behaviours the humans asked for (keep these working)
- **Full-screen reminders are Enter/Esc-dismissible** — the trash, street-sweeping car, and plant
  reminders must always be dismissible by pressing Enter or Esc (not just the on-screen button).
  (Requested 2026-07-26.)
- **Fortnightly plant-watering reminder** — a friendly full-screen GREEN "time to water the plants"
  reminder EVERY TWO WEEKS (anchored 2026-07-31; #plantalarm in index.html + wirePlantAlarm in app.js).
  Generic wording only — no personal note, no names ("Max"). Do not make it weekly again.
  (Requested 2026-07-26; changed to fortnightly + generic 2026-09-23.)
- **Tuesday curb-trash takeover must be big, red, flashing, and start at 5 PM** — every Tuesday the
  trash goes to the curb for very-early-Wednesday pickup, so the full-screen flashing-red TAKEOVER
  (#trashalarm) must fire from 17:00 (5 PM) onwards until acknowledged — unmissable, not just the
  small header pill. Governed by TRASH_NIGHT_HOUR in app.js (must stay ≤ 17; smoke guards this). Do
  NOT push the start time later. (Requested 2026-07-29.)

## General standing rules
- **Midterms card is temporary (2026-11-03 → 2026-11-06 noon PT)**: `midterms` takes Out in SF's
  slot via the manifest's `replaces`/`until`; leave both entries (and sf-events enabled) alone —
  it hands the slot back by itself. After 2026-11-06 the entry may be deleted.
- **The Clock's top line is the day's two-word garden poem** (2026-10-30), not a greeting:
  written once a day by the tending run (src/poem.mjs, the last 100 poems in its prompt so it
  never repeats), served by GET /api/poem. Keep it; the greeting is only its fallback.
- **Calm tiles, rich fullscreen (2026-10-30, the humans pruning "a bunch of BS agents keep
  adding"):** the wall tile is a GLANCE — prune it to the one or two things that matter (e.g.
  Weather: now, the next sun event, the next hours; Clock: the time and date). Every extra line
  is cognitive load: when you want to add information, add it to the widget's FULLSCREEN view,
  not the tile. The fullscreen view (`openFull`) is its OWN design, not the tile resized: show
  more there, with good cognitive scaffolding (labelled sections, a clear hierarchy, one idea per
  row, the most important thing first). Model: gardyn.js (tile = day + growth stage + today's
  task; fullscreen = the full log) and weather.js (tile = now / sunset / next-hours bars;
  fullscreen = + sunrise, humidity, UV, next days, the rain & sun map). Don't move pruned items
  back onto a tile, and when you deepen a widget, deepen its fullscreen.
  Already pruned from tiles by the humans: Weather humidity / UV / next days (fullscreen only);
  the Clock's world clocks, its "Day N · N left … %" year line and its season line ("Early
  Autumn · 52d to winter") (fullscreen only); the Air
  card's health-tip / "vs yesterday" line under the reading (tooltip only).
- **Dashboards are the humans' own spaces** (public/dashboards.json, 2026-10-07). The main
  tending must not edit, restyle or remove any dashboard under public/dashboards/ or
  change their combos — each dashboard is tended only by its own scoped agent, and only
  when a seed was planted on it.
- **Layout stability (2026-10-07, mandatory):** a widget that is still fetching must
  occupy EXACTLY the size it will have once loaded — never render a smaller empty card
  that grows when data arrives. app.js reserves each card's last settled height
  (reserveCardSize / settleCardSize); widgets must also keep their own placeholders at
  full size (no collapsed loading states), and must not animate size or position —
  content only fades in.
- **No wind on the Weather card** (removed 2026-10-01, re-added by tend #140, removed again
  2026-10-06). No wind speed, direction, arrow or gusts anywhere on the wall.
- **No accent bars on card/row edges** (2026-10-01: "very vibecoded"). No coloured
  border-left / border-top stripes, side "equalizer" bars or edge highlights to mark
  items. Use an icon, colour on the text/number itself, or spacing instead.
- **The Arcade has no tile on the wall** (2026-10-01). It opens only when the controller
  chord L1 + R1 + L2 + R2 is held (pad.mjs → `arcade` → openArcade()). Keep emulator.js
  and the chord working, but never put the Arcade card back on the grid.
- Do NOT re-introduce ANY widget the humans have asked to remove. Removal is permanent
  unless a later note explicitly says to bring it back. When you remove a widget because
  of feedback, ADD it to the "Banned widgets" list above in the same tending.
- On quiet (no-feedback) days, prefer DEEPENING existing widgets over inventing new ones.
  Only add a brand-new widget if it's clearly something the humans would welcome and it
  does not duplicate or resurrect anything on the banned list.
- No year-progress BAR on the Time card — the humans disliked the percentage bar/rail that
  sat behind the "Day N" year reading. Keep the year reading as a quiet TEXT line only
  ("Day 262 · 103 left … 72%"); do not re-add a rail/fill/gauge behind it. (Removed 2026-09-19.)
- (Superseded 2026-09-23: the BART board was removed entirely — see Banned widgets.)
- **"The Garden" is the TITLE typeface** (public/assets/fonts/thegarden-regular.woff2,
  supplied by the humans 2026-09-23): brand ("GardenOS"), card titles, headlines and big
  numbers — i.e. `--font-display` in styles.css. Body text is NOT The Garden (`--font`); the
  humans tried The Garden as body copy and didn't like it. Don't swap titles back to
  Space Grotesk/mono, and don't make The Garden the body font.
  The dashboard is a TWO-FAMILY system — The Garden + Barlow Semi Condensed (2026-09-23,
  "harmonize the fonts"; Inter felt off next to The Garden and is now only a glyph
  fallback). `--font` and `--font-mono` both resolve to Barlow Semi Condensed; do not
  bring back Inter/JetBrains Mono as visible faces, serifs, or any third face in widgets.
  Use regular weight for The Garden (one weight; synthesized bold looks muddy).

## How to maintain this file (you may append, never weaken)
- When a feedback note expresses a STANDING preference — anything phrased as "never",
  "always", "stop adding", "from now on", "for good", or a repeated removal — record it
  here as a new bullet so it survives future tendings.
- You may ADD rules. You may NOT delete, weaken, or contradict an existing rule unless a
  feedback note explicitly revokes it (and then update the bullet to reflect that).
- Keep entries short and concrete. Date removals so the history is legible.

- **Preserve Garden Classic (2026-11-04):** the original design must always remain available via the theme switcher and /theme classic. New design experiments belong in separate named themes in public/themes/themes.css; never overwrite Classic to create an alternative. The full pre-theme frontend is archived in design-snapshots/garden-classic-2026-11-04.tar.gz. See public/themes/README.md for the editing contract.

- **Independent theme design (2026-11-04):** the humans explicitly allow Moonstone and future alternative themes to change fonts, sizes, layouts, card internals, radiuses, buttons and spacing. The original typography/design rules remain the Classic baseline; theme-specific alternatives must be scoped and must never alter Classic.

- **AI-first design changes (2026-11-04):** humans describe outcomes to Paseo or the Botanist; never make them edit numeric token/settings forms. Alternative design lives in public/themes/<id>.json, including widget spans and internals. Preserve Classic. Read DESIGN_SYSTEM.md and verify contrast/cursor/layout visually.

- **Wall pages and widget editing (2026-11-04):** keep page navigation as tiny clickable dots above the chat input (updated on request 2026-11-04). No top-left page buttons or Widgets button. `/widgets` opens in-place editing with remove controls, drag rearranging, width choices and a visual bottom gallery; do not restore the old widget-management list. Keep Ctrl+Shift+Left/Right, MX thumb-rest horizontal gestures, L3+left/right, touch swipes and deliberate edge dwell for page changes.

- **Transit reauthorized (2026-11-04):** the humans requested nearby bus/train arrivals and locations and supplied a location and 511 token. This explicitly lifts the earlier transit ban for the new `transit` widget. Keep it based on real provider data, with freshness and missing-data states; credentials remain server-side.

- **Design target and cross-theme approval (2026-11-04, supersedes earlier Classic-freeze/active-alternative instructions):** Design requests target Garden Classic only by default, regardless of the displayed theme. A different named theme or an explicit multi-theme request overrides that default. For substantial changes, or changes worth extending to other themes, prepare isolated before/after screenshot previews for each proposed additional theme and ask the user which themes to update. Do not apply those additional-theme changes until approved; never edit a live auto-reloading theme file just to create an unapproved preview. Preserve the frozen original archive. Use public/themes/classic.json for ongoing Classic design changes; the archived original remains immutable.

- **Fixed home pages and direct layout controls (2026-11-04):** Classic and Moonstone use two small-widget columns by seven small-widget rows (14 small slots including the clock). Home never scrolls, including during editing. Overflow uses another existing page before creating a new page. Holding a card must not change the viewport or card geometry; drag from anywhere on a card. Small/medium/wide/tall/large variants adapt their contents and can grow vertically. Existing-widget resize/reorder/add/remove/move/page operations are immediate voice layout actions, not Botanist coding tasks.

- **Default widget footprint (2026-11-04):** choose the best starting size for each widget’s content. Do not force every widget to Small. New widgets declare `homeSize`; saved human size choices win.

- **Restore and protect the original card designs (2026-11-04, explicit correction):** the fixed home-grid redesign and footprint-specific card restyling were rejected. Original authored card typography, padding, content, charts and layout are the default again. Do not hide information, force seven equal-height tracks, or standardize widget internals to implement pages/editing. Keep behavioral controls separate from presentation. Token/schema work must preserve computed appearance and be compared with the frozen original archive before it is claimed safe. Saved size choices from the rejected redesign must not reapply on default load. This correction supersedes conflicting earlier fixed-grid/variant design instructions.

- **Designed opt-in sizes and previews (2026-11-05):** keep Original card designs as the default. Inspect both tile and fullscreen content before adding a size. Only explicitly authored, content-appropriate variants may be selectable; grey out undesigned sizes. Size choices must show real widget previews using the same renderer/data as the selected card. Edge dwell needs a visible indicator and switches after 1.5 seconds (once per entry).

- **Live voice transcription (2026-11-05):** show the active utterance as it is recognized, including revisions, with a clear Cancel action. Clear it after the turn; do not persist household transcripts. Spoken cancellation discards the voice request; named actions such as “stop the timer” remain actions.

- **Standard outer frames, original card identity (2026-11-05, explicit correction):** the humans now authorize moving original card sizes up/down to the nearest suitable named footprint after auditing grid jank. This supersedes the earlier prohibition on equal tracks for Classic's home grid. Preserve authored typography, materials, charts and information; Default uses the authored content inside a standard frame. Editing/loading must not alter geometry. Titles and content share a consistent safe inset; nested rounded containers derive inner radii from outer radius minus inset/border. Apply other-theme changes only within approved scope.

- **Moonstone grid approved (2026-11-05):** the humans approved extending the audited standard grid, stable editor geometry, title/content insets and nested corner-spacing fixes to Moonstone after reviewing before/after previews. Keep its own palette and typography.

- **Purposeful sizes, no accidental clipping (2026-11-05):** choose and explain every new widget's default footprint; offer additional sizes only when each has a useful composition. Different sizes may use different information, graphics and hierarchy. Do not merely scale or cram content, or force every possible size. Verify defaults, optional sizes and every page with long/many/empty/loading data; keep controls reachable and outer frames stable while editing/loading. Summaries with explicit remaining counts are welcome; cut-off rows and instructions are not. See `tools/widget-layout/SIZE_DESIGN.md` and the layout regression checks.

- **Reading sources (2026-11-05):** do not duplicate Hacker News in the general RSS card; it has its own reader. Include The Guardian and the Old Farmer's Almanac, retaining an honest unavailable state if a publisher has removed its feed. Keep discovery and feed management easy to use by voice or touch.

- **Changelogs have a headline and expandable detail (2026-11-05):** keep the short
  `CHANGELOG:` sentence plus `CHANGELOG_DETAILS:` with concise, well-formatted bullets
  for all completed changes. Clicking the changelog number expands the details;
  never shorten the stored detail to fit the list. Manual human/agent work gets
  one daily summary across relevant Paseo chats, distinct from nightly tendings.
  Summarize completed work, not requests or plans; preserve this daily digest.

- **Manual changelog numbering and scope (2026-11-05):** number manual entries
  as decimal increments of the preceding tending: #171, #171.1, #171.2, #172.
  Leave GitHub repo publishing, history imports, URLs and related repository
  housekeeping out of the changelog, including its headline and expanded details.

- **Paseo editorial jobs (2026-11-05):** changelog editing and daily Reading Room
  editions run through subscription-authenticated Paseo/Codex GPT-6 Luna at medium,
  publishing validated data via `tools/editorial/job.mjs`. Do not re-add direct model
  API calls or backend model-generation timers for these jobs. Follow their editable
  rules in `tools/editorial/CHANGELOG.md` and `READING.md`. Changelogs use confident,
  forward-looking headlines and bold feature names: emphasize capabilities, omit
  mundane layout/padding/page moves and same-day development fixes. Daily news is
  inviting prose with original article links and explicit excerpt limitations.
  Preserve the Classic Reading Room Daily button and dated notification bell;
  reading an edition opens the widget's daily page and acknowledges that edition.

- **Richer editorial coverage and RSS reader (2026-11-05):** earlier short editorial
  limits were too restrictive. Changelogs should retain all significant, cool and
  fun completed capabilities, using broader readable headlines and fuller bold-feature
  explanations; use older published summaries as a coverage checklist. Keep minor
  polish/repo housekeeping and same-day development fixes out. Daily editions need a
  substantial overall overview, core categories with their own summaries and several
  linked stories, finishing with The Wild Side. The Daily button becomes Go back and
  restores the previous reader view. Classic has a horizontal source selector with
  All first, top-of-preview original/fullscreen controls, and Razi's personal RSS
  collection in Discover. Keep about ten active sources; the remaining personal feeds
  and further recommendations are available to add, not auto-subscribed.

- **Reading and Small to-dos (2026-11-05):** the Classic reader gives the article
  column more width and uses smaller list/preview typography. Fetch public article
  text automatically rather than stopping at RSS excerpts; show an honest excerpt
  fallback when a publisher restricts access. Almanac category RSS URLs can exist
  but be empty: keep an explicitly labelled publisher-website fallback, not a false
  claim that the whole source is unavailable. Small To do shows two task checkboxes
  with concise title summaries and a remaining count; complete titles remain in
  fullscreen and tooltips. Weather variants must read values from forecast data,
  not rely on hidden source markup, and failed initial fetches should retry promptly.

- **Daily briefing voice and type (2026-11-05):** write like a smart friend:
  casual, fun, chill and clear, while staying accurate and substantive. Avoid stiff
  editorial language and forced jokes. Keep the briefing typography smaller and
  comfortable for reading long editions; preserve the larger headline hierarchy.


- **Shared checkout preservation (2026-11-05):** the scheduled tending once erased active work with reset/clean. Skip tending when any tracked, staged, or untracked edits exist. Fail closed when Git status cannot be read. Crash recovery and failed/scope-invalid runs must preserve working files and newer commits; never run automatic reset, clean, checkout-overwrite, or delete out-of-scope files. Keep recovery archives outside the checkout. Use an isolated worktree for future unattended code editing; review its integration before changing the shared wall.


## Generative UI dependencies (human instruction, 2026-11-05)
The humans explicitly approved A2UI/OpenUI dependencies for progressive generated interfaces. Garden uses official A2UI core + Lit, pinned and locally bundled, with Garden catalog components and existing typed house actions. Keep the dependency and actual provider streaming; do not replace it with a merely animated completed response. Existing native fast paths remain useful. Every saved composition must distinguish live source recipes from snapshots.

## Home-page zigzag order (human correction, 2026-11-05)
Preserve the familiar first-page pairs in their authored default sizes: Clock / Air, Weather / Painting of the Day, Hacker News / Out in SF, Gardyn / Trihourly Fractal. This creates the alternating framed/bare zigzag. Hacker News and Out in SF belong on page 1 and must remain visible. Put excess/new widgets (currently To do, Nearby transit, Reading room and Performance lab) on the next page instead of displacing these pairs. Respect a later explicit human rearrangement.

- **Rich articles in every theme (2026-11-05):** Hacker News and Reading Room must preserve article images at their full aspect ratio, captions, headings, paragraphs, emphasis, links, lists, quotes, tables and code. Use the active theme’s own typography and colors. Keep sanitized feed HTML as a fallback when publisher fetching fails; never silently replace rich articles with flattened text. Preserve the original-page control and clearly explain blocked/partial articles.

- **Resident messaging must cost $0 (2026-11-05):** use only the free Photon shared plan for explicit sends. Never add billing, upgrade, enable paid fallback or silently spend money when limits change. Fail closed and explain a sending failure. Keep automatic reminders out until explicitly requested. Dictated resident notes are an authorized use of the existing voice mode; this does not reintroduce the old microphone feedback-note feature.

- **No tunnel warning screens for resident messages (2026-11-05):** send full summaries, itineraries and notes directly in Messages. Do not make residents pass an ngrok warning to read shared content. Original publisher and directions links may accompany the content.

## Foreground mouse dictation (2026-11-07)
- When a Paseo / Botanist conversation is foreground, the MX Master button beneath the wheel must target Paseo native dictation, not Garden voice commands. It toggles recording with each press (Ctrl+D); Escape cancels. Elsewhere preserve Garden hold-to-talk/release-to-send. Keep releases paired to their original destination.


## TV preferences (2026-11-07)
- Keep the Insignia TV home free of advertisements, recommendation feeds, oversized
  app-logo tiles. The explicitly chosen Garden TV companion uses Apple-like glass
  with Garden typography/green styling, useful shared widgets, and direct access
  to the main streaming services and Garden. Keep Alexa/remote voice,
  HDMI inputs, Bluetooth, casting, streaming DRM and Settings working.
- F1, Roku, Tubi and the Brazilian TV apps (Globo, TV Aberta Brasil and TV Aberta ao
  Vivo) are unwanted and disabled; do not restore them without a later explicit request.
  Keep the main streaming services, including Prime Video, Netflix, YouTube, Twitch,
  Disney+, Hulu, Apple TV, Peacock and Paramount+, available.
- Garden on the TV should ultimately provide extra landscape workspace and playable
  games while retaining the portrait wall. Wireless is preferred; a cable is acceptable
  when it materially improves gameplay. Preserve all four existing Garden input devices.

- **TV companion and atmosphere (2026-11-07):** the humans chose a lightweight native
  Garden TV companion instead of Monet and its paid styling limits. The Home redirect
  was revoked on 2026-11-11; open Garden explicitly as an app, with a dedicated remote
  shortcut where supported. Screensaver defaults to real San Francisco sunset photos.
  Offer a separate Fun mode using the six supplied company-parody images, plus easy
  mode/timing/clock/preview controls. SF-city weather is explicitly authorized. Do not
  enable a notification listener merely for a media widget. Keep heavy computation
  and game execution on Garden, with a lightweight native TV home.

- **Bomberman World Garden Edition (2026-11-08):** preserve the original World
  assets and battle behavior while extending the playable arena to the portrait
  display. Do not substitute stretched emulation or an SB2 reskin. The playable
  battle port is hand-maintained in `public/arcade/bw/`; daily tending must not
  rewrite it or `tools/bw/`. Keep original binaries/assets private under `data/bw/`
  and preserve the original PS1 Arcade entry. See `tools/bw/README.md` for scope
  and required original-code/gameplay checks.

- **GardenTV consistency and no screensaver (2026-11-08):** the humans rejected separately recreated TV widgets. GardenTV must reuse the canonical GardenOS clock, weather, air, Hacker News, to-do and live rotating fractal code, fonts, Aurora palette and glass material. The fractal stays bare with its original corner title only; no TV caption/name/description. No “Connected to Garden” label or CPU/memory/time status bar; use the real clock widget. Dock logos must be complete and padded. Automatic screensavers, including Fun/mock ads, are Off until explicitly re-enabled; preserve supplied images privately.

- **Official Twitch and transient TV voice (2026-11-08):** use the genuine Amazon-installed Twitch app (`tv.twitch.android.viewer`) for GardenTV dock and voice; S0undTV is unwanted. TV voice should show live, readable captions and listening/working animation, then clear promptly. Do not keep unsolicited Botanist/permission messages or a persistent Paseo/type control popup over the TV. Preserve explicit cancellation and local-only room audio.

- **Streaming launch routing (2026-11-09):** ordinary launches of the known streaming apps default to GardenTV, including TV-prefix phrasing and speech-formatted T V / T.V. qualifiers. Explicit Garden/browser requests retain their target. Existing TV controls must never become a coding-agent task; preserve the final native-control guard even if a model proposes a Botanist handoff.

- **Bomberman World perspective (2026-11-09):** preserve its original oblique
  projection, coherent ground pattern, original HUD and menu artwork when extending
  the arena. Do not flatten the coordinates while retaining angled blocks, repeat
  arbitrary background rectangles, or call a partial battle build a full game port.

- **World continuous arena and wall faces (human follow-up, 2026-11-09):** the
  stepped/zigzag border is rejected. Use a continuous rectangular arena with
  coherent perspective on every face, including the right sides of walls. A
  shallower portrait camera must reproject ground, tops, fronts and sides together;
  never flatten placement alone. Use the game's distinct original border pieces
  and original menu composition/lettering rather than a redesigned menu.

- **GardenOS TV branding (2026-11-09):** the TV dashboard must use the same GardenOS™ wordmark as the wall, including The Garden typography, canonical gradient and superscript trademark. Do not replace the visible brand with “GardenTV OS” or invent a separate TV logo.

- **World border, opening and portrait menus (2026-11-09 follow-up):** all four
  arena sides need visible raised walls with consistent block proportions. The
  nearly invisible right rim and tall bottom slab are rejected. Starting spawn
  spaces must be bounded and balanced; no long free P1 corridor, and never erase
  permanent pillars for spawn clearance. Menus must use the full 9:16 screen,
  retaining the proportions of the original lettering and character artwork.

- **World items, stages and controller page edges (2026-11-10):** start with the original one-bomb capacity; upgrades must come from visible items released by destroyed crates and work when collected. Offer the other original battle stages with their gameplay and assets, not merely renamed arena skins. Preserve native special terrain and stage objects. GardenOS left/right controller navigation must change pages at widget-row edges, keep focus useful, stop at the ends, and never rearrange the saved home layout. Games and panels retain ownership of their input.

- **Native TV Home and HDMI ownership (2026-11-11, clarified):** GardenOS TV should open automatically once when the TV powers on or wakes. After that, Home must return to the original Fire TV menu, and selecting HDMI or another app must stay there. Do not repeatedly reclaim the screen, intercept Home, or relaunch on an ordinary service restart while the TV is already on. Home on Fire remains disabled for user 0 with its accessibility redirect removed; use the companion's power-on-only receiver instead. Preserve GardenOS TV, streaming apps, HDMI/CEC and the wall services.

- **Garden Directive signs (2026-11-11, Guilherme):** Use the supplied Directive PSDs, examples and memo: white landscape Letter, bold black type, short XML-like key/eyebrow, practical main phrase and subphrase, a small monochrome illustration above, and the original green Directive lockup. The eyebrow is explicitly requested for these signs. Keep text/layout/logo deterministic and separately editable. Copy should clarify shared protocols, visible state and low-friction actions, without moralizing. Generate only illustrations with the latest available configured GPT Image model, or disclose a programmatic line-art fallback. Show the actual version, ask aloud, and print only on explicit approval of that version; edits, cancellation, ambiguity, silence and expired/stale approvals never print. Keep the approved artifact, suppress duplicate submissions, and permit retry of a definite printer failure without regenerating. Never physically print a development fixture without the human approving its exact preview.

- **Directive voice and generated artwork (2026-11-12, clarified):** Sign creation, semantic XML-key selection, revisions, image regeneration, approval and cancellation must work by conversation; typing is optional. Generate illustrations on demand with an image model, never a fixed illustration vocabulary or code-drawn substitute. Use the existing authenticated OpenAI/Codex connection when no API key is configured. Replace the robotic eSpeak sign voice with natural neural speech. This supersedes the earlier programmatic-illustration fallback.

- **Black-and-white printing only (2026-11-12):** Every requested print from GardenOS must be monochrome, including Directive signs and their original logo. The preview and approved artifact must already be black and white; request monochrome in the printer job too. Never quietly send color or alter an already-approved colored preview at submission time.

- **Replacement Samsung wall display (2026-11-18):** Use 1600×900 rotated left on DP-0 (logical 900×1600). Right rotation is upside down on its physical mount. Preserve GNOME’s saved monitor-specific configuration.
