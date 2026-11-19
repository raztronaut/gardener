# Design sizes, protect boundaries

The user’s November 5 examples distinguish **size** from **purpose**. Spotify’s
small play card becomes a horizontal recent-items composition. Ultrahuman’s
battery, scores and movement history solve different questions even at similar
sizes. Garden should preserve that freedom. It should not generate five enlarged
copies, or require every card to become a dense list.

Before creating a widget, choose the question its default answers from across the
room. Pick `homeSize` deliberately. Record the default rationale, per-size purpose,
composition tradeoffs and overflow behavior in `public/lib/widget-size-plans.js`.
The matching offered sizes/renderers live in `widget-variants.js`; unimplemented
sizes stay unavailable. The plan is review evidence, not a substitute for a real
renderer. New enabled home widgets without a plan fail smoke.

A useful design review answers:

- Why does this default earn its footprint? What is the dominant reading/action?
- Does each optional size improve a use case? A horizontal comparison, longer
  horizon, artwork plus label, focused action, or short agenda can be distinct.
- Is a different-purpose view better than another size? Describe it explicitly;
  do not silently substitute unrelated content when a person merely resizes.
- Which content belongs only in fullscreen? Setup instructions must remain whole
  there. A card can show three task summaries and “+5 more”; it cannot cut through
  the fourth task or hide its checkbox below the card.
- What happens with zero, one, many, long, missing, stale and loading values?
  Use complete rows, bounded title summaries, explicit counts and readable errors.
  Do not solve overflow by shrinking all type or masking an entire content region.

## The enforceable boundary

`widget-layout.js` defines one finite grid and named footprints. `homeSize`,
rendered default, selected variant, real-size preview, layout snapshot and voice
choices must agree. Loading/data/editing transitions preserve the outer frame.
The packer handles existing-page overflow, pinned clock, manual page intent and
atomic rejection; widgets do not invent a second height/packing system.

`check-contract.mjs` fails for missing design intent, unknown footprints, duplicate
variant purposes, or mismatched registry/plan choices. It runs inside smoke.
`window.gardenWall.auditLayout()` checks the current page for card collisions,
viewport overflow, content overflow and controls/counts outside their card.
It is read-only and event-invoked, not a new background animation/polling loop.

`content-check.cjs` runs each offered size, default pages, editor frame stability,
and an eight-task long-text fixture in fresh browser storage. It also injects a
displaced card to ensure the audit detects a regression. `browser-check.cjs` covers
packing, manual page intent, reload, restoration and drag behavior. Both use the
actual renderers, not a hand-copied mock of the layout.

```bash
node tools/widget-layout/check-contract.mjs
node tools/widget-layout/test.mjs
PLAYWRIGHT_MODULE=/tmp/garden-browser-qa/node_modules/playwright \
GARDENER_TEST_BROWSER=/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome \
node tools/widget-layout/content-check.cjs
```

Those QA dependencies are external to the no-build app; use their actual installed
paths if this machine changes. Run packing checks when page behavior changes,
and inspect screenshots of the default, changed variants, actual picker and
fullscreen. Add representative widget-specific stress fixtures when the data can
break a composition. A fixture must not write into household browser storage or
execute real model/device actions.

Automation cannot decide whether an interesting design is good. Keep human/agent
visual review for hierarchy, useful whitespace, room-scale readability, chart
meaning and purpose. The geometry gate prevents unusable output; it does not
prescribe typography, colors, graphics or a universal card template. Theme scope
and cross-theme preview requirements remain in DESIGN_SYSTEM.md.

## Classic page-two composition (2026-11-09)
The household's second page now uses Clock + Small transit in the first row,
Large Reading room across four rows, then Medium To do + Medium Performance lab.
That fills the existing seven-row page without adding a page. First-page widget
order, sizes, visibility and assignments were compared before/after and preserved;
the hidden Daily brief remains hidden. Changes use the native layout API.

Classic Large Reading room is an editorial four-story spread, preferring distinct
subscribed sources with real summaries and a source count. Its typography,
dividers and spacing live in classic.json. Medium/Tall empty To do has an explicit
completion state; populated rows, checkboxes and remaining count retain their
behavior. Performance lab adds the existing recorded sample-distribution renderer
and record date, not a live performance claim. Renderer additions are Classic-only;
other themes retain their prior output.

Evidence: isolated previews with real glass and empty/four-long-task fixtures,
then a real kiosk screenshot at900×1600 and clean live page-two layout audit.
Design validation/lint/schema/tests and layout contract/packer checks pass.
The55-check browser content suite has no runtime errors and no new issues;
it still flags an existing7px `sf-events`/`won-list` overflow on page1. Repeating
that suite against the saved pre-change theme/renderers reproduced the exact same
issue. Do not describe that broad suite as fully passing. Source data and the
first-page SF event card were not changed as part of this design task.
Private review artifacts stay under /tmp/garden-page2-*.png; original source
backups are /tmp/garden-page2-backup and household layout snapshots are
/tmp/garden-page2-layout-before.json and /tmp/garden-page2-layout-after.json.
