# Garden dependency review

Reviewed November 5, 2026 against the live source, the pre-install HEAD lockfile,
the current installed package graph, npm audit, and official project documentation.
This is an architectural review. Recommendations below are not claims that packages
were installed or that a proposed replacement has been benchmarked.

## What should have been different

Dependency approval should have been considered explicitly once the requirement
became reusable, interactive, progressively rendered UI. The earlier four-block
surface was a useful narrow native fast path, but hand-building an entire form,
binding, layout and streaming ecosystem would repeat solved work. A maintained
protocol/runtime plus Garden's own catalog is the better division of responsibility.

The same applies to article extraction and interactive maps: preserve Garden's
identity and domain actions, while using maintained implementations for difficult
parsing, input and map interaction behavior. A dependency is justified by a concrete
failure or capability, not by its popularity.

## Priorities

| Priority | Change | Why it fits Garden | Acceptance evidence |
| --- | --- | --- | --- |
| Now | A2UI core + Lit, lazy loaded with a pinned local bundle | Custom Elements fit the existing vanilla application; shared bindings, component references and lifecycle replace improvised rich-surface plumbing. Keep native controls immediate. | Chunked protocol tests, first useful render/cached patch latency, stable form focus, cancel/closed-surface rejection, bundle raw/gzip size. |
| Now | One typed action registry shared by generated controls and wall handlers | A widget, voice request and generated button should request the same operation and receive its actual result. The UI framework does not implement timers, transit or household permissions. | Stub action sinks; check parameter validation, failures/retry, duplicate clicks, and that no arbitrary command or device action is available. |
| Now | Real provider-to-renderer streaming | A2UI handles incremental messages only when the producer actually sends them early. The reviewed `voiceagent.mjs` originally awaited `client.messages.create()` before dispatching all tools. | Feed delayed synthetic tool deltas; verify the first useful component appears before the final provider event. Measure this separately from rendering an already-complete JSON object. |
| Next | Mozilla Readability with an isolated server-side DOM parser | Current `reader.mjs` uses regex stripping, choosing the longest article/main, and may spawn Chromium for up to 20 seconds. Better document extraction can reduce irrelevant text and unnecessary browser fallbacks. | Representative publisher fixtures, extracted text quality/coverage, cold and warm latency, worker RSS, time and document-size limits. |
| Next | Leaflet for the transit fullscreen | Existing static-map/SVG code has useful route overlays but lacks mature pan/zoom, fitBounds and marker interaction. Leaflet can provide those without a separate WebGL scene. | Touch/wheel/keyboard use, route fit, first tile/position latency, panel cleanup, GPU/CPU deltas. Keep compact home maps static if that wins. |
| Next | A real pedestrian routing service/engine behind the planner | Current walks use straight-line distance multiplied by 1.3 and a walking-speed estimate. A map library does not make these street routes. | Known local journeys and station access, real walking geometry/minutes, missed connections, realtime trip identity and provider failures. |
| Next | Small phase telemetry, with optional OpenTelemetry API later | `performance.now()` browser timings, provider/model timing and bounded counters answer most current questions. Shared trace/turn IDs would explain where a slow interaction spent its time. | Warm/cold sample distributions, consistent spans, cancelled-turn accounting, bounded memory; no household speech or transcript logging. |
| Before unattended source editing resumes | Git worktrees and isolated preview/deploy integration | The recent destructive-reset incident was an ownership/isolation failure. Git already supplies separate working trees. Another task orchestration npm package would not fix shared-checkout ownership. | Crash/restart and competing-edit fixtures; the live working tree remains byte-identical until reviewed integration. |

The Readability package is Mozilla's standalone extraction library. Its own security
guidance recommends sanitizing returned HTML; using its plain text output is the
smallest fit for Garden's existing text reader. Do not enable external resource
loading or scripts in a DOM parser. Source: [Mozilla Readability](https://github.com/mozilla/readability).

Leaflet supplies interactive maps; OpenTripPlanner supplies a separate multimodal
routing engine using transit and street data. An OTP instance is a larger service
than a frontend package; benchmark its resource footprint or use a suitable existing
provider before placing it on the Jetson. Sources: [Leaflet](https://github.com/Leaflet/Leaflet),
[OpenTripPlanner](https://github.com/opentripplanner/OpenTripPlanner).

## A2UI versus OpenUI

A2UI's official web core provides the message processor, state and binding foundation;
Lit supplies its maintained web renderer. Use the actual versioned protocol and a
real Garden catalog rather than labelling arbitrary JSON as A2UI. Garden should
publish the catalog and action schemas for agents to discover, and preserve stable
component IDs through partial updates. Source: [A2UI renderer guide](https://github.com/a2ui-project/a2ui/blob/main/docs/public/guides/renderer-development.md).

Current OpenUI is **not React-only**: its README lists framework-agnostic
`@openuidev/lang-core` and first-party React, Vue, Svelte and Angular runtimes.
Its compact OpenUI Lang and prompt generation are worth comparing if model output
size or grammar success becomes a bottleneck. A2UI/Lit is the more direct match for
this existing Custom-Element-capable vanilla app. Neither framework is proven faster
here solely from documentation; that needs the same model/input/transport benchmark.
Source: [OpenUI packages](https://github.com/thesysdev/openui).

## Dependencies that do not yet earn their cost

- A full React application migration is unnecessary for using Lit/A2UI inside the
  existing shell. Keep the runtime lazy so the wall and simple controls do not pay
  its parse/initialization cost on every boot.
- A second voice recognition runtime or a larger local speech model is not implied
  by UI dependency approval. Keep the measured local ASR path unless a representative
  household recognition evaluation justifies replacement.
- A general agent framework, Redis or a cloud orchestration platform would add
  operating burden to a single-house Jetson before establishing a concrete need.
  Current SQLite, native services and Paseo sessions already cover much of this.
- TanStack Query has a framework-independent core and could unify many independent
  source caches, but the existing forecast cache already has useful single-flight
  and last-good behavior. Adopt it only when a shared query layer measurably reduces
  duplicated work; replacing a functioning small cache is not itself a speed gain.
  [TanStack Query](https://github.com/TanStack/query)
- Full charting libraries are optional for the initial benchmark page. SVG/CSS bars
  with raw samples, units and accessible tables are sufficient. Add a focused chart
  dependency if interaction/zoom/distribution requirements exceed that.
- Prefer the model provider SDK's event decoder for its streaming transport. Garden
  still needs bounded application JSONL framing. If supporting multiple partial-JSON
  grammars grows complex, evaluate a maintained incremental parser against escaped
  strings, arbitrary UTF-8 splits, malformed/truncated inputs and CPU bounds instead
  of indefinitely extending a bespoke parser.

## Audit of the installation

At review time the current lockfile audit reported **11 vulnerable dependency nodes**:
2 moderate, 8 high and 1 critical. Comparing exact installed versions against
`git show HEAD:package-lock.json` shows that the critical finding and the MCP/HTTP
findings were already present. New A2UI entries inherit a Zod finding; the root Zod
was already affected too. Advisory counts are not exploit counts, and a transitive
server package being installed does not prove Garden uses its affected server path.

| Finding | Installed at review | Before this install? | Action |
| --- | --- | --- | --- |
| `proxy-addr` critical, GHSA-jqcg-44mw-7w3h | 2.0.7 via Express → MCP SDK | Yes, same version | Targeted SDK/transitive patch refresh; test the MCP path and preserve the lockfile diff. |
| MCP SDK high advisories | 1.29.0 | Yes, same version | Evaluate current compatible SDK ≥1.32.0 and rerun actual Paseo client/transport tests. Do not assume OAuth/server-task findings apply to the local client path. |
| Hono, node-server, body-parser, fast-uri, ip-address, qs | Listed in the captured audit | Yes, same versions | Refresh supported patch/minor dependencies in a separate controlled lockfile update, then test affected transports. |
| Zod memory-exhaustion advisory, GHSA-mrhx-c7xc-m3w5 | Root 4.4.3; new A2UI nested 3.25.76 | Root yes; two A2UI dependency chains are new | Root can be evaluated at exact 4.6.7 (patched minimum 4.6.6). There was no compatible patched v3 published at review time. Preserve byte/shape budgets before Zod. |

The Zod advisory concerns memory exhaustion while validating oversized collections.
It is not sufficient to rely on a schema `.max()` after accepting a huge payload:
cap raw bytes, nesting depth, aggregate nodes, keys, array lengths and string lengths
before invoking the library. Include component-reference depth/cycle and total
surface size budgets. Basic catalog `openUrl` and media URLs also need explicit
policy; ordinary UI schema validation does not grant arbitrary OS or network access.
Source: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

Do not force A2UI's v3 dependency to Zod v4 with a blanket override: its imports and
schema-to-JSON tooling expect v3 semantics. Do not accept npm audit's suggested
A2UI downgrade to 0.8.3 as an automatic fix. Keep explicit A2UI pins, apply boundary
limits, and track a supported upstream Zod migration/backport. The review does not
change packages or claim all audit findings have been remediated.

Audit evidence was captured outside the checkout at
`/tmp/garden-dependency-audit.json` and `/tmp/garden-dependency-baseline-audit.json`;
the exact pre-install lockfile was retained at `/tmp/garden-base-package-lock.json`.
Those files contain dependency metadata, not household content.

## Practical next decision

Finish and benchmark the A2UI integration, source-backed domain components and shared
controls first. Then prioritize Readability and interactive maps through isolated
comparisons. Keep protocol correctness, layout quality, action success, first useful
paint, cancellation and total resource cost as separate acceptance criteria.
