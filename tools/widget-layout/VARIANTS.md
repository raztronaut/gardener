# Widget size designs

Default uses the existing authored tile content. In the standard Classic/Moonstone grid its
outer frame resolves to the widget’s named default footprint (see GRID_AUDIT.md);
legacy themes retain the authored outer size. A new composition is enabled only when
`public/lib/widget-variants.js` defines a composition for that widget and size.
The size picker and voice layout tool share this registry. New/unknown widgets
therefore offer Original only; unsupported choices stay visible but disabled.

The tile and fullscreen views were inspected before making these compositions:

| Widget | Fullscreen content reviewed | Designed choices beyond Original |
| --- | --- | --- |
| Clock | Local time/date/poem, world clocks, year, seasons, occasions | Small: time/date/poem. Wide: time with New York and London. No year progress or seasons on the wall. |
| Air | Current AQI, category, pollutant drivers, 24-hour outlook, pollutant concentrations | Small: AQI/category. Wide: current AQI and six actual hourly forecasts. Health advice and the pollutant reference table stay fullscreen. |
| Weather | Now, next sun event, hours, next days, humidity/UV, rain/cloud map | Small: now/sun event. Medium: now plus three hours. Wide: now beside six two-hour samples. Days, humidity, UV and maps stay fullscreen. |
| Painting | Whole artwork, title, artist, year, medium, museum, short story, museum QR | Medium: artwork/caption. Tall: portrait with artist/date. Wide: image and museum label side by side. Large: spacious art and the actual story. No Small: the art and attribution deserve room. |
| Hacker News | Full front page, points/comments/age/domain, article reader | Small: leading story. Medium: three headlines. Wide: four in two columns. Large: six in two columns. Quiet points/domain metadata; articles and discussion detail stay fullscreen. |
| Gardyn | Day/stage, actual care log, plant trajectories, all plants/pods, feeding and milestones | Small: day/stage. Medium: ready crops, flowers, next milestone. Wide: the original grouped growth chart. Large: every plant and estimated stage in two columns. No Tall: it adds little beyond the original chart. |
| Fractal | Live sculpture, name, palette, generation time/countdown | Medium/Tall/Large: the original live scene in appropriately proportioned frames. No extra wall copy. Previews use the same sculpture's still image. |
| Out in SF | Event list and event details, time, place, description and source | Small: one plan. Wide: three side by side. Tall: five-event agenda. Long event detail remains fullscreen. |
| Transit | Predictions with stops/distance, freshness, provider notices, vehicle schematic, covered stops | Small: two departures. Wide: three with stops. Tall: five and source freshness. Scheduled estimates retain `~`; missing predictions aren't presented as service shutdown. |
| Midterms | Chamber totals, map, closest races and results | Original only. Temporary card; other sizes have not been designed. |

## Implementation boundaries

- Original mount/fullscreen markup and baseline CSS remain intact; Classic and Moonstone’s
  themes own standard outer frames and shared content/title insets. Lightweight data getters
  publish already-fetched content; previews make no extra feed/API calls.
- Previews and selected variants use the exact same renderer and size-specific
  theme recipes. Preview stages lay out at actual card dimensions before scaling.
- The original body stays mounted while a variant is shown, preserving timers,
  data refresh and original behavior. Returning to Original unhides it.
- The fractal keeps its existing live WebGL renderer on the wall; its preview is
  a static representation, so the picker doesn't create more WebGL scenes.
- Large variants move to a less crowded page when necessary. Returning to Original
  restores an automatically changed page. Explicit page moves take precedence.
- Variant colors/typography/layout live in each approved theme JSON, scoped to
  `.wv` or `[data-wsize]`. They never match the default Original cards.

## Checks

`node tools/widget-layout/test.mjs` checks finite packing, direct speech grammar
and explicit size availability. Browser checks exercised every designed choice in
Classic and Moonstone, disabled unsupported choices, preview/live text equality,
Original restoration, card/body/home overflow, and the visible 1.5-second edge cue.

Run the optional grid integration regression with externally installed tools:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
GARDENER_TEST_BROWSER=/path/to/chrome \
node tools/widget-layout/browser-check.cjs
```

It uses fresh isolated browser storage, the Classic theme and read-only real data.
It checks physical grid bounds/collisions, overflow/restoration, rejected-action
rollback, manual page intent, reload stability and dragging from card content.
