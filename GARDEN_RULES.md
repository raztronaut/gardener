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
