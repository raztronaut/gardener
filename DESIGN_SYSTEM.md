# GardenOS — agent design interface

The person describes the outcome. You choose the design implementation. Do not
send them to numeric controls or ask for padding/color/font CSS values.

## Default scope and cross-theme review

Design requests target Garden Classic only by default, regardless of the displayed theme. A different named theme or an explicit multi-theme request overrides that default. For substantial changes, or changes worth extending to other themes, prepare isolated before/after screenshot previews for each proposed additional theme and ask the user which themes to update. Do not apply those additional-theme changes until approved; never edit a live auto-reloading theme file just to create an unapproved preview. Preserve the frozen original archive.

The currently displayed theme is context, not an implicit target. “Make buttons
darker yellow” and “make the clock 2 by 2” target Classic unless the person names
another theme. “In Moonstone...” targets Moonstone. An explicit “all themes”
request authorizes those named themes; do not ask again for already granted scope.

Complete the authorized Classic change and verify it. For substantial work
(new/restructured widgets, layout, typography or interaction changes), also assess
whether other themes would benefit or must adapt. Propose those changes separately:
1. Capture the current appearance of each proposed additional theme.
2. Render its proposed result in an isolated preview checkout/server. Never use
   the live polled JSON files for unapproved experiments.
3. Show labelled BEFORE and AFTER screenshots of each theme, including affected
   fullscreens/menus where relevant. State the visual/functional differences.
4. Ask which additional themes should receive the change, with the screenshots
   attached or visibly linked in the approval request. A text-only description
   is insufficient. In voice/Botanist mode make screenshots available on the wall
   or in Paseo for review, and wait for an explicit response.
5. Apply only the approved additional-theme changes. No response is not approval.

For shared widget/runtime work, first test every existing theme for unintended
visual changes. Isolate any necessary adaptation, show its screenshots and ask
before releasing it into an unrequested theme. Keep that shared change staged if
it cannot safely be released to Classic alone. Purely internal changes with no
visual impact do not require an extra design approval.

## Architecture and source of truth

| Layer | Source | Ownership |
| --- | --- | --- |
| Registry | public/lib/theme-registry.js | Runtime, picker, CLI, remote asset allowlist |
| Contract | public/lib/design-contract.js | Semantic roles, groups, descriptions, CSS types, aliases |
| Palette | themes/<id>.json tokens.palette | Theme-local primitive colors |
| Semantic roles | tokens.colors/typography/spacing/shape/materials/cursor | UI meaning: text, accents, surfaces, type, spacing |
| Components | components.<name>.selector/style | Named recipes and interaction states |
| Widget presentation | widgets.<id>.style/tokens/parts | Local card and content exceptions |
| Shared fallback | registered fallback CSS | Legacy foundation; avoid theme-specific edits |
| Deep inventory | style-tokens.js and token-inventory.json | Legacy declarations exposed as --ds-* exceptions |
| Drawing bridge | design-values.js / ctx.design | Values for canvas and WebGL |

Each theme owns its values. Themes do not inherit from one another. Classic now
has explicit semantic values matching its fallback foundation. Moonstone owns a
separate palette and recipes. The original archive remains immutable.

Use canonical roles: --color-accent, --color-text-primary, --color-text-muted,
--font-body, --font-heading, --space-card-padding, --space-grid-gap, --radius-card.
Old --mint, --ink, --font-display and related names are generated compatibility
aliases, not a second source of truth. Aliases are emitted locally for widget
token overrides as well as at the root.

New reusable roles belong in design-contract.js with a group, description and
cssProperty. Add values only to the intended theme. Regenerate the editor schema:
  node tools/design.mjs schema --write

Find roles with:
  node tools/design.mjs roles button
  node tools/design.mjs roles font
  node tools/design.mjs audit classic

The browser remembers only theme selection. There are no browser-specific design
overrides. window.gardenDesign.context() exposes scope policy, source paths,
loaded grid/widgets, status and error. Window.gardenDesign.roles exposes the
contract; window.gardenDesign.tokens exposes mounted legacy declarations.

## Natural-language operations

“Make buttons slightly darker yellow”:
In classic.json add named button component rules and semantic fill/hover/text
tokens as needed. For an explicitly requested Moonstone change, edit its existing
--color-button-fill, --color-button-hover and --color-button-text tokens. Appearance choices use separate --choice-* tokens, so a
button recolor cannot silently ruin their descriptions.

“Make the clock 2 by 2”:
First inspect window.gardenWall.context().layout. Classic and Moonstone now use one finite
four-track × seven-row grid: two Small cards across, seven Small rows high.
`widget-layout.js` owns packing and physical footprint calculations. Theme JSON
opts in with `--home-grid-mode: standard`; unapproved themes keep their authored
layout. Do not add competing content-driven rows or per-variant pixel heights.
For an authorized live arrangement:
  window.gardenWall.act({name:'layout',input:{
    action:'resize',widget:'clock',columns:2,rows:1
  }})
Check its response and screen. Never fake resizing by scaling or clipping text.
The 2026-11-05 request explicitly authorizes snapping original outer frames to
the nearest named footprint. Default preserves authored typography, materials,
charts and content; it uses Small for Clock/Air/Transit and Medium otherwise
unless the widget declares `homeSize`. Optional compositions remain opt-in.
Normal/edit/loading states must have identical card geometry. New cards overflow
to an existing page before a new one. Requested page/order and effective overflow
placement are separate; theme-local versioned storage preserves both across reload.
See tools/widget-layout/GRID_AUDIT.md for the measurements and contract.

“Change the clock's number size”:
Edit widgets.clock.parts[".time"]["font-size"]. A part is scoped to that widget.
For fullscreen-specific styling use a component selector under .panel-widget;
widget part rules intentionally target wall tiles only.

“Change all typography / cards / buttons / menus / cursor / spacing”:
tokens groups are colors, typography, spacing, shape, materials, cursor, overrides.
components contains named selectors and ordinary CSS declaration objects. Every
component selector is nested under the target theme, including comma lists and
pseudo classes. Change any CSS property here. Add component entries as needed.
Do not put style decisions into app.js or per-widget source.

## Deep styling without hunting hardcoded literals

The runtime exposes authored shell and widget CSS declarations as --ds-* custom
properties, with the exact original value as fallback. New ctx.style() widget
styles are automatically inventoried. This includes fonts, sizes, borders,
padding, shadows, colors, flex/grid geometry, widths/heights and cursors.
Shorthands are preserved; do not expand and mutate their longhands individually.

Find a specific declaration:
  node tools/design.mjs tokens classic "clock"
  node tools/design.mjs tokens classic "font-size"
Each result identifies owner, selector, property and default value.
Override its --ds-* token in tokens.overrides (global to this theme) or
widgets.<id>.tokens (one card). Prefer semantic tokens or named parts when they
already exist; generated tokens are for deep exceptions. Dynamic data (charts,
weather conditions, alarm state, game rendering) is behavior, not a theme token.
For dynamically set inline styles use a deliberate parts rule with !important
when required, without altering the widget's data or state.

## New widgets

A request to add a widget is a feature request, not a theme recolor. Use
public/widgets/manifest.json + the ctx contract in CLAUDE.md. Fetch real data via
ctx.fetchJSON; keep loading/error states and reserved height. Never invent local
stops, live departures or locations. Resolve ambiguous location from existing
config and available data, asking only if it cannot be established.
Read GARDEN_RULES.md: a specific new human request can lift a prior widget ban;
an example quoted while discussing the design system is not a request to add it.
Register the widget and give the requested theme an explicit grid footprint.
Preview any visual impact on other themes and obtain approval before propagation.
All injected widget CSS is tokenized automatically.

## Validation, inventory and live updates

  npm run design:check
  npm run design:catalog
  node tools/design/catalog.mjs --check
  node tools/design.mjs audit moonstone
  node tools/design.mjs roles overlay
  node tools/design.mjs surfaces
  npm run smoke

Design checks also reject raw component paint literals: put reusable colors and
shadows into semantic role values rather than burying them in selectors.
Validation rejects unknown fields, misspelled/wrongly grouped roles, duplicates,
missing references, dependency cycles, invalid spans and unsafe declarations.
The browser also validates CSS property values and selectors before applying CSS.
Each selected theme refreshes every five seconds without remounting widgets.
Requests are deduplicated and time-limited; every theme has its own last-valid
cache. Stale requests cannot overwrite a new selection or its error state.
Check window.gardenDesign.context().status/error and html[data-theme-error].

The source inventory is reproducible from registered fallback CSS and static
widget CSS templates, including potential tile/full/panel namespaces. Its
companion token-inventory.sources.json records hashes, blocks and any skipped
dynamic templates. It never executes widget code. Rebuild after CSS changes.
This is static possibility coverage; window.gardenDesign.tokens is authoritative
for currently mounted states. Conditional declarations have distinct context
keys. Font-face and keyframes remain authored. Preserve quoted braces/semicolons
and deferred shorthands; never mutate CSSOM longhands one by one.

Generated --ds-* keys are a deep escape hatch. Prefer semantic roles, named
components and widget parts. Canvas/WebGL code reads the same roles through
ctx.design.value()/color() or design-values.js. Optional roles cover voice glow
palette/success/error, map backgrounds/credits and calibration colors. Missing
roles retain exact existing defaults. Read drawing values on events/setup,
never on each animation frame. Preserve data, game and alarm color meanings.

Optional browser integration checks live in tools/design/browser-check.cjs.
Set PLAYWRIGHT_MODULE and GARDENER_TEST_BROWSER to an externally installed test
tool/browser; the app itself has no new test dependency.

Preview at http://127.0.0.1:8787/?theme=moonstone without saving a preference.
Review public/themes/review-surfaces.json: wall-only screenshots are insufficient.
Use isolated before/after previews for other-theme approval. Inspect fullscreens,
menus, hover/selection/focus, descriptions, cursor, loading/error, scrollbars and
layout. Use inert fixtures for voice, permissions and reminders. Do not send real
requests or acknowledge alarms to take a screenshot.

## Theme completeness checklist

A wall screenshot alone cannot verify a whole theme. Open the forest picker and
volume popover; inspect their hover, keyboard selection, active state, slider
thumb and description contrast. Also check the slash palette, note editor, widget
edit bar/gallery, fullscreen panels, toast, countdown, voice caption, Botanist
reply/permission/error cards and calibration surface. Use inert fixtures for
voice states rather than sending real requests or granting permissions.

Moonstone's floating surfaces use --surface-overlay, --surface-raised,
--surface-hover, --surface-selected, --overlay-ink and --overlay-description.
Its accent washes/rings use --accent-wash and --accent-ring. Add named component
rules for new overlays; do not inherit green baked-glass fallback surfaces.
Keep semantic warning/error/reminder colors and game/data colors intentional.
Verify the actual opened menu and capture screenshots, not only CSS variables.

## New themes and recovery

Copy moonstone.json, give it a new id and label, register it once in
public/lib/theme-registry.js, including optional assets. The theme file is
independent of Classic. The remote Wall
allowlist derives registered theme files/assets from that same registry.

Frozen original: design-snapshots/garden-classic-2026-11-04.tar.gz (full public/
at the start of theme work, including the person's uncommitted changes).
Verify with sha256sum -c design-snapshots/SHA256SUMS. Inspect in a temporary
directory. Never extract over the working app to undo an alternative theme.
