# Theme data

Read DESIGN_SYSTEM.md in the repository root.
Classic is the default design target. Other themes require explicit scope or
approval with before/after screenshots. Preview unapproved changes in isolation.

Palette → semantic roles → named components → widget parts.
Contract: public/lib/design-contract.js.
Registry: public/lib/theme-registry.js (including asset paths).
Schema: schema/theme.schema.json, generated from the contract.
Review states: review-surfaces.json.
Deep catalog: token-inventory.json; provenance: token-inventory.sources.json.

Legacy CSS aliases are generated for compatibility. Values remain theme-local;
there is no cross-theme inheritance or browser-specific design-settings layer.

Checks: npm run design:check
Audit: node tools/design.mjs audit classic
Find roles: node tools/design.mjs roles button
Rebuild catalog: npm run design:catalog
Theme files refresh live; invalid updates retain that theme's last valid design.
The frozen original remains in design-snapshots/.
