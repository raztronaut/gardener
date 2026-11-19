# Rich article readers

HN's `openReader` and Reading Room fullscreen request `/api/readable?read=1&rich=1&theme=<active id>`; the split RSS preview uses `/api/feeds/article`. Both receive inert HTML from `src/rich-article.mjs` / `tools/feeds/parse-article.py`. RSS/Atom/JSON Feed entries retain sanitized HTML as the immediate and failure fallback, alongside text for summaries and editorial consumers.

The stdlib Python parser keeps article structure, resolves relative assets, selects responsive/lazy images, removes executable content and publisher styling, and allowlists output tags and attributes. No external dependencies. Never insert raw publisher markup into the wall. The existing sandboxed original-page toggle remains separate. HTTPS full-page fetching uses DNS-pinned `fetchFeedURL`, with existing response/time/redirect limits. Publisher restrictions still require an honest fallback; this is not a paywall bypass.

Every registered theme owns `article-*` component recipes in its JSON. Fullscreen frames use the active registered theme (unrecognized ids fall back to Classic) and embedded local fonts because null-origin sandbox frames cannot load same-origin webfonts. Keep the trusted controller-scroll bridge. Reader fallback cache version changes when rich content is introduced.

Validation:

```
node --test tools/reader/rich-article.test.mjs
node tools/reader/browser-check.cjs
npm run design:check
GARDENER_CHROMIUM=/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome npm run smoke
```

The optional browser check uses the external QA Playwright installation, real Guardian content, and a deterministic HN listing linking that real article. It checks both registered themes, image loading, preview and fullscreen overflow, controller scrolling, and the HN click path. Screenshots go to `/tmp/reader-{theme}-{preview,fullscreen}.png`. Publisher changes or network outages can fail this integration check without implying a local regression.
