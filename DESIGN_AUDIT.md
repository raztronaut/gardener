# Design system audit — 2026-11-04

This pass reorganized theme infrastructure while preserving appearance.
Classic remains the default design target; unrequested cross-theme visual
changes still require isolated before/after screenshots and explicit approval.

## Changes

- A single registry now drives the picker/runtime, tooling and remote asset list.
- Palette primitives, named semantic roles, component recipes and widget
  exceptions have separate responsibilities.
- Classic's previously implicit fallback values are explicit semantic values.
- Legacy CSS variables are generated aliases, including widget-local overrides.
- The role contract includes descriptions and CSS types; the editor schema is
  generated from that same contract.
- Validation catches unknown fields, wrong/misspelled roles, missing references,
  cycles, duplicate aliases, invalid layout values and malformed declarations.
  Browsers additionally validate real CSS values and selectors.
- Raw color/shadow literals in component recipes fail the design lint.
- Legacy CSS inventory uses a structure-aware scanner. Media/supports/container
  contexts have distinct keys; strings, shorthand, fonts and keyframes survive.
- The source catalog can be rebuilt with provenance and skipped-template reports.
  It includes potential tile/fullscreen/panel namespaces.
- Theme refreshes use independent last-valid caches, deduplicated requests,
  timeouts, and selection-aware response/error handling.
- Canvas/WebGL can read optional semantic roles through the same value bridge.
  Missing optional roles preserve current rendering defaults.
- A review-state manifest covers menus, overlays, widgets, editing and voice.

## Verification

- 12 compiler/contract/parser regression tests passed.
- Both themes validated with zero deprecated token keys and zero component
  color/shadow literals.
- Generated schema and source catalog checks passed.
- Real-browser checks passed for semantic aliases, valid live changes, invalid
  update retention, cached restoration, stale responses, drawing colors, and
  the real forest picker.
- Canonical-versus-legacy computed-style comparisons passed for both themes.
- The full 175-check smoke suite passed on isolated ports. Isolation avoided
  another running test server on a fixed household-test port.
- The frozen original archive checksum remained valid.

## Boundaries to retain

The legacy fallback CSS still has authored literals. Its --ds-* adapter is a
compatibility/inventory layer, not the public semantic vocabulary. Prefer named
roles and parts; do not present thousands of generated keys as human controls.

The static source catalog lists possible styles, not every mounted state.
The runtime inventory is authoritative for mounted CSS. Inline/data-driven
drawing and third-party/game content need deliberate role integration and state
review; do not globally recolor data or alarm meanings.

The finite-page packer owns saved live placement. A theme presentation rule is
not a substitute for the layout API. Inspect scope before changing shared
behavior, and follow the screenshot approval policy for other themes.
