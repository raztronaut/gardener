# Garden generative UI — agent interface

The Garden uses the official pinned `@a2ui/web_core` and `@a2ui/lit` 0.15.0 packages,
with the **A2UI v0.9** wire protocol and a Garden catalog. The renderer is a locally
bundled lazy dependency. It does not replace the household's existing app runtime.
The source runtime and reproducible bundle command are `tools/genui/runtime.js`
and `node tools/genui/build.mjs`.

## Discovery

Use `node tools/wall-ui.mjs capabilities` for supported wall actions and the catalog
URL, `node tools/wall-ui.mjs context` for current widgets/pages/commands, or
`node tools/wall-ui.mjs audit` for read-only geometry checks. The browser equivalents
are `window.gardenWall.capabilities()`, `.context()` and `.auditLayout()`.

`await (await import('/lib/a2ui-surface.js')).a2uiCatalog()` returns protocol,
catalogId, component names, typed action descriptions and the official catalog's
JSON schema. Read the current schema rather than guessing component properties.
The advertised static catalog is `/genui/catalog.json`.

A concrete request file is sent through `node tools/wall-ui.mjs request.json`, or
`window.gardenWall.act(request)`. Voice, typed commands and Paseo use these same wall
handlers. Action results determine success; an intended action is not proof it ran.

## A2UI messages

The wall request is `{name:'a2ui',input:{title,status,messages:[...]}}`.
The `messages` array accepts these A2UI v0.9 envelopes:

- `{version:'v0.9',createSurface:{surfaceId,catalogId}}`
- `{version:'v0.9',updateComponents:{surfaceId,components:[{id,component,...props}]}}`
- `{version:'v0.9',updateDataModel:{surfaceId,path,value}}`
- `{version:'v0.9',deleteSurface:{surfaceId}}`

Use catalogId `https://garden.local/catalogs/house-v1.json`, a fresh surfaceId for
each new composition, and a `root` component. References are component IDs; a Column
or Row's children are IDs, not embedded HTML. Bound values use `{path:'/field'}`;
updates to the data model update all bindings without replacing stable inputs.

```json
{
  "name": "a2ui",
  "input": {
    "title": "One small thing at a time.",
    "messages": [
      {"version":"v0.9","createSurface":{"surfaceId":"example-unique-id","catalogId":"https://garden.local/catalogs/house-v1.json"}},
      {"version":"v0.9","updateDataModel":{"surfaceId":"example-unique-id","path":"/","value":{"minutes":"5"}}},
      {"version":"v0.9","updateComponents":{"surfaceId":"example-unique-id","components":[
        {"id":"root","component":"Column","children":["title","duration","start"]},
        {"id":"title","component":"Text","text":"A little focus session","variant":"h2"},
        {"id":"duration","component":"TextField","label":"Minutes","value":{"path":"/minutes"}},
        {"id":"start","component":"Button","child":"start-label","action":{"event":{"name":"garden.timer","context":{"duration":{"path":"/minutes"}}}}},
        {"id":"start-label","component":"Text","text":"Start my timer"}
      ]}}
    ]
  }
}
```

Send the useful shell first; send independent component/data updates as information
arrives. `streamA2ui(chunks,ctx,{title,signal})` in `a2ui-surface.js` consumes JSONL
from an async iterable of strings or UTF-8 byte chunks. Its context is
`{h,openPanel,act,isOpen}` from the wall runtime. It frames complete JSON objects
before dispatch and honors cancellation. Agent tool JSON uses `A2uiToolDecoder` to
extract only complete message objects from a progressively arriving messages array.
Incomplete JSON must never trigger an action. Generated controls run actions only
when a person activates them.

Current limits are 1–200 messages per request, 160 components per surface/update,
128 KiB per message, 1 MiB per stream and bounded nesting. Closed/deleted/replaced
surfaces reject late messages; reuse a fresh ID. Function-call expressions are not
part of the Garden catalog. URLs must be local assets or HTTPS; missing or untrusted
external data must not become fabricated readings.

## Components and bindings

The actual schema is authoritative. Standard primitives include Text, Image, Icon,
Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField, CheckBox,
ChoicePicker, Slider and DateTimeInput when advertised by the catalog. Garden adds
room-scale metric, notice, progress, step, table and bar-chart components. Media
availability follows the advertised runtime rather than a guessed full upstream
catalog. A chart's generated layout is not evidence that its numbers are real.

Use controls for real interactions, not simulated forms that pretend to submit.
Keep stable IDs when updating values, retain focus and typed input, and make
loading/error/empty states useful. The fullscreen owns scrolling; saved widget
compositions use designed Medium/Wide/Large content budgets. Read the sizing skill
before authoring another footprint.

## Typed Garden actions

A standard Button uses `action.event` with a name and context. Bind input values
through data paths in the context. `public/lib/garden-actions.js` is the shared
allowlist and resolver; an unknown action or invalid value returns an error.

| Event name | Context | Effect |
| --- | --- | --- |
| `garden.open` | `target` | Existing widget or panel |
| `garden.close` | none | Close the current view |
| `garden.home` | none | Return to the house wall |
| `garden.volume` | integer `set` 0–100 | Set speaker volume |
| `garden.layout` | `action`, optional `widget`, `size`, `page`, `before`, `after` | Arrange existing widgets/pages |
| `garden.theme` | `theme`: classic or moonstone | Switch an existing theme |
| `garden.timer` | `duration`, e.g. 5, 90s, off | Start/stop the countdown |
| `garden.ambience` | `place`, including off | Select an existing field recording |
| `garden.directions` | `destination` | Real journey planner, with destination disambiguation |
| `garden.feeds` | `query`, e.g. add TechCrunch or manage | Discover/manage RSS sources |
| `garden.briefing` | optional `sections` | Real weather/news/departures composition |
| `garden.pin` | none | Keep the open composition as a widget |
| `garden.demo` | `flow` | An implemented GenUI scenario |

These are house-display controls, not arbitrary shell, network or future smart-home
device capabilities. A new device adapter needs its own actual integration and user
scope; UI components do not create those capabilities by themselves.

## Keeping useful things

`/pin`, the surface's save button, or “make this a new widget” stores the current
composition. Known briefing recipes refresh real sources. A saved arbitrary A2UI
composition preserves its components and data with fresh IDs when reopened; it is
not automatically a live external integration. Do not describe it as one.

## Benchmark discovery

`/benchmarks` (aliases `/performance` and `/performance-lab`) opens the Performance
lab. Voice examples: “show me the benchmarks”, “open the performance lab”, or
“show the genui performance demo”. The benchmark widget can be resized by voice,
e.g. “make the performance lab wide”. Its page reads completed measured artifacts;
it does not run resource-heavy benchmark jobs on the household display.


## Implemented scenario flows

`/genui` defaults to home. Use `/genui <flow>` or voice “show me the genui
<flow> demo”. The exact implemented IDs are:

| Flow | What people can actually do |
| --- | --- |
| `home` | Discover the implemented scenarios and open one |
| `briefing` | Watch weather, departures and news appear independently; save a known live recipe |
| `commute` | Read weather/departures, type a destination and open real directions |
| `controls` | Use bound destination/volume controls, ambience, existing widgets, layout editing and home |
| `focus` | Choose a duration, start/stop the real timer and select forest ambience |
| `packing` | Edit and check an interactive packing list |
| `catalog` | Explore the 24-component overview with real metric/progress/slider/step/table/bar examples |
| `performance` or `benchmarks` | Open the Performance lab |

The earlier `/briefing` remains the compact immediate native brief. `/genui briefing`
uses the actual A2UI composition path. Both read real sources and support saving;
neither turns a missing feed into invented news. A plan or checklist generated from
a conversation can use A2UI without launching a coding task.


## Provider buffering and validation
The Anthropic `a2ui` tool must set `eager_input_streaming: true`. Merely calling `messages.stream()` still buffers tool arguments at the provider. A real provider check caught this; see `docs/performance/v6/live-model-buffered.json` and `live-model.json`. The latter is a single observation, not a speed distribution. The official reference is https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming.

Before official schema parsing, the host bounds UTF-8 bytes, strings, collection size, depth and total nodes, rejects prototype paths/keys and function calls, and allows literal HTTPS/local asset URLs only. Component graphs cannot cycle and accumulated data has a budget. The runtime catalog intentionally omits callable functions.

Validation commands: `node --test tools/genui/test-stream.mjs tools/genui/voice-stream.test.mjs`, `node tools/genui/test-studio.cjs`, `node tools/genui/test-host.cjs`, and `node tools/genui/bench-all.mjs`. `node tools/genui/bench-live-model.mjs --run` is opt-in and makes one paid provider request with a synthetic prompt in an isolated browser. Never run it on a timer or as a page refresh action.
