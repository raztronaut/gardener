# Voice and host audit — 2026-11-05

## Delivered

- RSS is now an actual wall card (`public/widgets/rss.js`), not only the previous `/rss`
  command. It shows one NASA headline; fullscreen offers NASA/HN and the existing article
  reader. It appears on whichever page has room. “Open feed reader” and `/rss` still work.
- Partial recognition is displayed during listening and the accepted/corrected request is
  shown before execution. The text may revise, as recognizers do. It clears after the turn.
  Cancel button and Escape discard the active utterance. No household transcript storage.
- Explicit spoken cancellation is separate from named actions: “cancel this message” discards
  voice input; “stop the timer” acts on the timer. “Open weather, actually open Hacker News”
  and timer-number repairs retain only the corrected command. Quoted/dictated cancellation
  phrases and questions/negations are protected from the local cancellation shortcut.
- Incomplete phrases/corrections get a 2.2-second silence allowance rather than the ordinary
  750 ms. If still incomplete, the system asks for the full request and performs no action.
  These are conservative local cues, **not a full semantic VAD model**.
- Audio/VAD keep running during final decode. Speech resumed during decode returns to
  listening instead of executing the premature final. Stale partials cannot enter a later
  capture. New push-to-talk or a verified new wake can interrupt a thinking request.
- Abort signals now propagate into model requests, context/tool waits, and the Botanist
  handoff. Timeouts cancel the underlying request rather than just abandoning a Promise.race.
  Browser batches check cancellation before subsequent actions. Already completed actions,
  or tasks already sent to Paseo, cannot be undone by cancelling a voice utterance; stop the
  Botanist explicitly for an already handed-off task.
- Stable model instructions/tool prefix are explicitly cached. A slow routing result no
  longer delays a model response that is already ready. Local exact handlers remain first.
- The optional previous-reply probe before a Paseo handoff is capped at 250 ms, because the
  local activity endpoint had a 3.32-second cold sample. A timeout disables the quick-reply
  shortcut for that task; ordinary status polling and its conservative fallback remain.

## Measurements

All raw files beside this document contain the tested examples and methodology.

| Test | Sample | Result |
| --- | --- | --- |
| Turn grammar / correction / direct-handler eval | 78 labeled text examples | 78 passed |
| Cloud model-routed tasks | 12 before + 12 after, interleaved | 24/24 correct |
| Cloud task elapsed median | 12 per condition | 1,035.5 ms before; 879 ms after |
| Cloud task elapsed p95, nearest rank | 12 per condition | 2,235 ms before; 1,548 ms after |
| ASR decoder comparison | 36 decodes; 2 samples × clean/quiet/noise × 1/2/4 threads × 2 | Median 427 ms / 340.5 ms / 340.5 ms for 1/2/4 threads |
| ASR exact transcript match | 36 | 30/36; all six differences were the same “any more” → “anymore” spelling under noise |
| Local Paseo MCP | 15 status + 5 activity reads | status 22–119 ms; activity warm 30–81 ms; first activity 3,319 ms |
| Audio pipeline | Three synthetic Flite utterances through paced PCM, VAD, Parakeet and stub tools | Live partials, news repair, timer repair, spoken cancel, no abandoned weather action: all passed |
| Real voice service cancellation | Isolated service; delayed context | Cancel blocks action, obsolete reply ignored, corrected next turn works |
| Browser QA | Classic + Moonstone | RSS card → article; partial updates; cancel; transcript clearing; no page errors |
| Full smoke suite | Current working tree | 179 checks passed |

The cloud sample used actual existing API models but stubbed wall actions. It measures the
whole request, not raw tokens/second. The observed ~15% median change is not an isolated
causal proof: prompt text and cache state changed, and network/host load vary. Cache counters
verified an approximately 8.6k-token prefix being reused. The previous API path had no explicit
cache breakpoint. A focused mock test also verified a 35 ms model response is not held until a
550 ms router response; actual test elapsed included SDK initialization (~150–165 ms).

ASR keeps two threads. This broader mixed-length run **did not establish a speed advantage
over four**; two tied four while using fewer worker threads. No model substitution was made.
The reference samples and synthetic speech are not a household accuracy, accent or false-wake
benchmark. No household audio was recorded. Synthetic audio deliberately bypasses wake with
push-to-talk, so it does not validate real-room wake/barge-in accuracy.

Initial audio QA failed because a wall-clock PTT release could get ahead of paced PCM under
load. The harness now uses delivered-audio markers. A synthetic “cancel that” was also
misrecognized; we did not add an unsafe fuzzy-cancellation rule. The passing run uses the
clearer “please cancel this message”. The logs preserve the passing real recognizer outputs.
RSS initially triggered a ResizeObserver feedback warning; its tile is now a fixed one-story
glance and that observer was removed. The final smoke/browser checks are clean.

## Host findings and limits

The five-second host sample was taken during an active chat/work session. Paseo's GPU and
renderer processes used approximately 100% + 106% of one core on this six-core Jetson.
The voice process used about 20% of one core; other Chromium, desktop and compositor work
also competed for CPU. About 1.93 GiB of memory was available; about 2.10 GiB of swap was in
use. Swap occupancy alone does not establish active paging. No memory-pressure interface
was available under `/proc/pressure` on this kernel. No unrelated processes were killed and
no graphics/power settings were changed based on this short, non-idle sample. The current
Paseo theme's custom layer uses static backgrounds; inspection did not find an animation
that could responsibly be removed as the cause of the CPU sample.

Your $200 subscription does not include Ultrafast; Pro $500 and eligible Enterprise/Edu do.
Terra low/Fast remains the command agent. This is not a Terra/Sol throughput comparison;
no unsupported subscription setting or separate OpenAI credential path was used. Exact local
commands avoid an LLM entirely. Open-ended questions still use the configured Haiku API
(and its separate API billing), with Jev assisting routing. ChatGPT subscription changes do
not automatically change those existing Anthropic/OpenRouter services.

The biggest unmeasured opportunities are (1) true incremental on-device ASR to avoid decoding
an ever-growing utterance for each partial, (2) a larger, consented household speech eval for
wake, corrections and interruptions, and (3) longer idle/active profiling of Paseo's renderer
and GPU. Streaming ASR needs a compatible streaming model; the current Parakeet worker is
an offline recognizer. No untested model swap was deployed as a supposed speed improvement.
The current partial display therefore has recognition latency and is not word-synchronous.

## Research basis

OpenAI's voice guidance distinguishes silence-based VAD from semantic completion, and
separates turn detection, response creation and interruption. We applied that separation
locally: partial text is display-only, an accepted final submits once, and cancellation
invalidates the pending turn. We did not migrate household audio to a cloud speech service.

- https://developers.openai.com/api/docs/guides/realtime-vad
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/cookbook/examples/realtime_eval_guide
- https://learn.chatgpt.com/docs/agent-configuration/speed
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_streaming_asr.html

## Reproduce

Run from the repository root, sequentially when comparing CPU performance:

```
node tools/performance/v2/eval-turns.mjs
node tools/performance/v2/test-router-race.mjs
node tools/performance/v2/test-live-cancel.mjs
node tools/performance/v2/bench-cloud.mjs
node tools/performance/v2/bench-asr.mjs
node tools/performance/v2/bench-paseo.mjs
node tools/performance/v2/audit-host.mjs
node tools/performance/v2/test-audio.mjs
npm run smoke
node tools/design.mjs validate-all
```

Cloud benchmarks make paid requests to the existing APIs. Audio tests require existing
ffmpeg/Flite and packaged speech models, use synthetic speech in temporary directories, and
run isolated services on 8857/8858. They do not use the household microphone or execute real
wall actions. Host, cloud and ASR tests are small reproducible diagnostics, not a universal
“fastest model” ranking. Browser snapshots used mocked voice events and actual feed APIs.

UI evidence: [Classic](transcription-classic.png) and [Moonstone](transcription-moonstone.png).
The screenshots use synthetic transcript events, not a household recording.
