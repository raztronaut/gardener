# Garden Directive signs

Say **“Hey Garden, make a sign.”** Garden asks what it should help people do,
then listens for the answer. You can include the whole brief immediately.
No typing is required. `/sign` remains an optional shortcut; **Edit by hand**
is collapsed by default.

Spoken examples:

- “Make a sign defining this shelf as the place for clean mugs.”
- “The XML key should be ontology.”
- “The exception for short trips is missing.”
- “That picture is bad. Generate a new one showing a hand turning the lock.”
- “Yes, print it.” / “No.” / “Cancel.”
- “Review this sign.” / “Retry printing.”

The copy agent fills the semantic category, headline, exception/subphrase and
original illustration prompt. `ontology` names categories, states or where things
belong; `algorithm` gives a procedure or condition/action. The key is a category,
not a topic label or unfilled placeholder. Invalid XML names are rejected.

After a visible preview, Garden asks aloud and starts bounded follow-up capture.
The voice is local neural **Kokoro v1.0, af_heart**; eSpeak is no longer used for
sign prompts. Later replies can start with “Hey Garden”. Silence never prints.
Closing the preview stops its browser-owned speech playback immediately.

**Every GardenOS print is black and white**, including the original logo. The
approved JPEG, displayed preview and downloadable PDF are already grayscale;
the printer job explicitly requests `print-color-mode=monochrome`. Older color
previews are rejected at submission and must be revised first.

## Source assets and composition

Original archive:
`/home/talbot/.paseo/uploads/garden-directive-53338d0a7b41/The Garden.zip`.
SHA-256: `53338d0a7b4116d7b922e272c19fed3ffd76859d06c72a4753b81c3ca56742b3`.
Selected PSDs, PNG examples and the memo are under `data/signs/reference/`.
The archive, reference material, generated artwork and household signs stay private.

The source is 3300×2550, landscape Letter at 300 dpi. The exact Directive lockup
comes from the source smart-object raster, cropped to ink bounds without changing
its proportions; it is rendered monochrome under the user's newer print policy.
`the garden logo.png` is not substituted. The source's Helvetica-Bold font was not
supplied, so installed Nimbus Sans Bold is the disclosed Helvetica-compatible
substitute. The memo informs concise copy about shared protocols, visible state,
affordances and feedback, without moralizing chores.

`tools/signs/render.py` composes text, XML key, illustration and logo separately.
Long copy wraps and fits a bounded block; impossible copy fails before clipping.
No image model draws the text or layout. Each immutable version contains:

- `print.jpg`: retained grayscale image, rotated for the portrait-only printer.
- `preview.png`: exactly those decoded JPEG pixels, rotated for landscape viewing.
- `sign.pdf`: one landscape Letter page using the same approved raster.
- `render.json` / `layout.json`: private inputs and measured text bounds.

The renderer has no hand-drawn illustration fallback. An image is required unless
the user explicitly requests no illustration.

## Models and on-demand image generation

Copy uses `GARDENER_SIGN_TEXT_MODEL`, then `GARDENER_VOICE_MODEL`, then
`claude-haiku-5-5`, with the existing Anthropic key and structured `compose_sign`
tool. It selects a semantic XML category and describes a new visual concept.

There is **no OpenAI API key configured**. `src/sign-image-agent.mjs` reuses the
local Paseo MCP transport from `src/botanist.mjs` and a dedicated authenticated
Codex image worker. Its built-in `image_gen.imagegen` capability was verified with
real generation. `data/signs/image-agent.json` stores the worker ID and capability
receipt, not account credentials. The currently configured worker is
`8462e665-f62d-41ca-aa1b-fa64f0c274e5` in the existing Botanist workspace.

Each request writes `image-request.json` in its version directory. The worker
makes a new PNG with OpenAI, then writes `image-result.json` with the matching
request ID. The app checks the receipt and image before composing. Requests are
serialized. Cancellation aborts only the owned image task. Missing capability,
permissions, timeouts or generation errors produce an honest failure, never a
placeholder. The worker must not edit source, print or read credentials.

New signs generate their own artwork. Text-only revisions retain the image when
the visual prompt is unchanged; asking for a new/better picture forces generation.
Copy is retained through image failure so spoken retries keep the brief. Generation
usually takes a minute or two and uses the account's Codex image allowance; this is
not a claim of unlimited free generation.

If an OpenAI API key is added privately later, the direct API path resolves an
available GPT Image model; `GARDENER_SIGN_IMAGE_MODEL` optionally pins one. It
requests only illustration artwork. API failures also never use a placeholder.
[Official image API guide](https://developers.openai.com/api/docs/guides/image-generation).

## Local voice and printer setup

Runtime uses existing Node dependencies, system Python/Pillow, Nimbus Sans Bold
and small cached neural speech WAVs. No new resident model server or CUPS daemon.

- `data/signs/templates.json`: named templates, measurements and logo registry.
- `data/signs/assets/directive-lockup.png`: original private source-derived logo.
- `data/signs/printer.json`: HP OfficeJet Pro 6970 at `ipp://192.168.4.30:631/ipp/print`.
  Re-discover with `avahi-browse -rt _ipp._tcp` if its address changes.
- `data/voice/tts-models/kokoro-int8-multi-lang-v1_0/`: local neural speech model,
  from the [official sherpa Kokoro release](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html).
- `data/signs/speech/`: clips and manifest. Run `node tools/signs/prepare-voice.mjs`
  after changing prompts. It synthesizes changed phrases locally and exits.

The printer reports Letter loaded/default, one-sided, 600 dpi and minimum margins
of 2.96 mm. The template reserves 6.35 mm. It accepts JPEG but not direct PDF and
advertises portrait orientation, so the entire approved image rotates once.
Paper/device defaults remain, but monochrome overrides the device's automatic-color
setting on every job. The submitter requires a grayscale JPEG and confirmed
monochrome support. A read-only Validate-Job for this option succeeded.

## Approval and retry safety

A 90-second token binds the current preview version to its SHA-256. It is issued
only after the image loads visibly. Edits, closure, cancellation and silence
invalidate it. The model cannot approve printing or simulate approval through
select/OK. A voice turn started before the current preview cannot approve it.

State transitions are serialized. Submission intent persists before transmission;
repeated approvals cannot send twice. Backend restart does not resend unresolved
jobs. Definite failure permits fresh approval and retry of the exact artifact.
A possibly transmitted but unconfirmed job remains uncertain; checking the queue
uses its unique job name. “Accepted” means a real job ID, not observed paper output.

## Validation and current sample

- `node --test tools/signs/workflow.test.mjs`: state safety, voice routing, generated
  image bridge/cancellation, no-placeholder failures and monochrome enforcement.
- `node tools/signs/browser.cjs`: actual Garden panel and voice-agent routing,
  spoken create/revise/approve/cancel flow with fixture printer/audio transport.
  Uses external Playwright; override `PLAYWRIGHT_MODULE` if needed.
- Existing voice destination, mouse-dictation and TV delegation tests.
- `npm run design:check`.
- Actual Anthropic category checks: shelf → ontology; door procedure → algorithm.
- Actual OpenAI/Codex generation with a unique receipt; retained artwork across
  a text-only revision. Preview pixels equal the grayscale approved JPEG.
- Actual kiosk WAV decoding and 900×1600 viewport; no live test print.

Current sample: `data/signs/jobs/dedb700a-4870-4d15-aa19-008354640f54/v2/`.
Key: `ontology`; headline: “Clean mugs go here”; newly generated mugs illustration.
Preview screenshot: `data/signs/qa/voice-live-studio.png`.
The sample is opened silently for inspection. “Hey Garden, review this sign” starts
spoken review. Physical paper output remains unverified; no development print job
was sent to the real printer.
