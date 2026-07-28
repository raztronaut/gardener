# Garden House Rules — standing orders from the humans (INVIOLABLE)

This file is the garden's long-term memory. The humans cannot repeat themselves in
a feedback note every single day, so durable preferences live here instead. Every
daily tending loads this file and MUST obey it — these rules outrank your own
self-directed taste and outrank the "add a new widget" suggestions in the prompt.

Rules never expire on their own. A rule is only lifted when a NEW feedback note
explicitly asks for it (e.g. "actually, bring tides back"). Until then, honour it
every day, including quiet no-feedback days.

## Banned widgets — NEVER add or re-add these (the humans removed them on purpose)
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

## Standing behaviours the humans asked for (keep these working)
- **Full-screen reminders are Enter/Esc-dismissible** — the trash, street-sweeping car, and plant
  reminders must always be dismissible by pressing Enter or Esc (not just the on-screen button).
  (Requested 2026-07-26.)
- **Weekly plant-watering reminder** — a friendly full-screen GREEN reminder to water the plants,
  once a week starting 2026-07-31 (#plantalarm in index.html + wirePlantAlarm in app.js). The FIRST
  occurrence shows Gui's personal note; later weeks show the short nudge. Keep it weekly. (Requested 2026-07-26.)

## General standing rules
- Do NOT re-introduce ANY widget the humans have asked to remove. Removal is permanent
  unless a later note explicitly says to bring it back. When you remove a widget because
  of feedback, ADD it to the "Banned widgets" list above in the same tending.
- On quiet (no-feedback) days, prefer DEEPENING existing widgets over inventing new ones.
  Only add a brand-new widget if it's clearly something the humans would welcome and it
  does not duplicate or resurrect anything on the banned list.

## How to maintain this file (you may append, never weaken)
- When a feedback note expresses a STANDING preference — anything phrased as "never",
  "always", "stop adding", "from now on", "for good", or a repeated removal — record it
  here as a new bullet so it survives future tendings.
- You may ADD rules. You may NOT delete, weaken, or contradict an existing rule unless a
  feedback note explicitly revokes it (and then update the bullet to reflect that).
- Keep entries short and concrete. Date removals so the history is legible.
