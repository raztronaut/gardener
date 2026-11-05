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
