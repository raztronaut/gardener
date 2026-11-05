# GardenOS latency measurements — 2026-11-04 PT

Changes are live: narrow deterministic voice handlers; serialized 500 ms completion polling
(250 ms first check); detection of short tasks missed between polls using changed reply;
two ASR threads; no 90 ms trailing pause after single wall actions; SSE observer connections
that cannot steal the primary wall connection. The existing Haiku answer model and
Terra/low/Fast Paseo command agent remain selected. Jev handles ambiguous requests as before.
No additional resident agents or models were installed.

## Results

| Measurement | Before | After | Scope |
|---|---:|---:|---|
| Six common typed commands, dispatch median | 928 ms | 0.5 ms | Actual model APIs before; stubbed wall calls in both; not microphone-to-screen |
| Four-second task completion | 6,024 ms | 4,290 ms | Simulated agent over mocked MCP; includes watcher startup and polling |
| Long bundled ASR sample, median | 1,532 ms (4 threads) | 727 ms (2 threads) | 8 decodes each, alternating batches; identical transcripts |
| Live command acknowledgement | No valid baseline | 12–80 ms | Four real voice-service → kiosk calls; final optimized path |

The live `/say` test adds a deliberate 600 ms before thinking. Total endpoint-to-idle times
were 624–701 ms; the 12–80 ms values exclude that QA delay. An earlier baseline observer
stole the primary connection and timed out; those failures are excluded, not passed off as
performance wins. The observer-mode fix now prevents this problem.

The short bundled ASR sample also favored two threads: four-thread decodes 267–513 ms,
two-thread 104–117 ms, one-thread 146–159 ms. These are packaged English speech samples,
not household speech or recognition accuracy tests. No private audio was recorded or retained.
Wake verification, 750 ms end-of-speech threshold and false-wake filtering remain unchanged.
Real microphone latency still includes those stages. ASR final turnaround is now logged
without audio or transcript, to support later in-room comparisons.

500 ms polling costs roughly two status RPCs per second while a task is active, rather than
one every three seconds. Only one poll runs at a time. No polling runs when idle. The existing
15-second fallback remains when there is no observed running state or changed final reply.

## Reproduce

From the repository root:

- `node tools/performance/test-speed.mjs` — positive and negative command grammar, failures,
  no context/model request for recognized commands, serial polling and cancellation.
- `node tools/performance/bench-voice.mjs /tmp/voice.json` — typed dispatch, stubbed wall.
- `node tools/performance/bench-completion.mjs` — original vs current mocked bridge.
- `node tools/performance/bench-asr.mjs` — short bundled speech at 4, 2 and 1 threads.
- `node tools/performance/bench-asr-repeat.mjs` — longer speech, alternating 2/4-thread batches.
- `node tools/performance/bench-live.mjs /tmp/live.json` — opens/closes weather and HN on the
  actual kiosk; requires voice service and kiosk, and uses observer-only SSE.
- `npm run smoke` and `node tools/design.mjs validate moonstone`.

Raw results are the JSON files beside this report. Small sample counts and variable Jetson
load/network conditions limit precision. This is not a Terra/Sol token-throughput comparison.
Paseo's inspected Codex provider offers only Normal/Fast even for Sol; the draft Ultrafast
setting is normalized to Normal. No unsupported setting was persisted. Official docs:
https://developers.openai.com/api/docs/guides/ultrafast-mode

## RSS experiment and transit

`/rss` (also `/feeds`, or say “open feed reader”) opens Hacker News and NASA feeds. Server
fetches are bounded, restricted to fixed sources, deduplicated and cached for five minutes;
failed refreshes keep a labeled stale copy. XML is parsed with Python's standard library;
DTD/entity declarations are rejected and titles render as text. Articles use the existing
sandboxed reader. Browser QA verified 20 HN stories, 10 NASA stories, source switching and
opening the reader. Cached backend retrieval was under 1 ms in the initial probe.

No transit widget was added: 511 arrivals/vehicle monitoring require an API token and a
meaningful nearby stop/intersection is still needed. None is configured. Existing SF weather
coordinates are approximate and are not silently treated as the household's transit stop.
https://511.org/open-data/transit
