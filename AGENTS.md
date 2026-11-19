# GardenOS

Read CLAUDE.md and GARDEN_RULES.md before changing the app.
For visual, theme, widget-size or layout requests read DESIGN_SYSTEM.md first.
Design requests target Garden Classic only by default, regardless of the displayed theme. A different named theme or an explicit multi-theme request overrides that default. For substantial changes, or changes worth extending to other themes, prepare isolated before/after screenshot previews for each proposed additional theme and ask the user which themes to update. Do not apply those additional-theme changes until approved; never edit a live auto-reloading theme file just to create an unapproved preview. Preserve the frozen original archive.
Use public/themes/classic.json by default. Scope all design changes to the
target theme's JSON; shared baseline edits can silently change other themes.
Do not build manual token/settings forms or browser-specific design overrides.
Validate the theme file and inspect the resulting screen before reporting done.

Garden-specific agent skills are installed under `/home/talbot/.codex/skills/`
(and linked from `/home/talbot/.claude/skills/`). Use the relevant entrypoint only:
`garden-design` for theme work; `garden-widget-sizes` for defaults, compositions and
layout defects; `garden-performance` for measured voice/render/host optimization;
`garden-native-ui` for immediate controls and incremental surfaces;
`garden-data-integrations` for feeds/transit; `garden-arcade` for games/controllers.
Read that skill’s SKILL.md when relevant. The current project contracts and human
instructions remain authoritative; these skills do not widen task authorization.
