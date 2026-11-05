# Home grid audit — 2026-11-05

The human explicitly requested an audit and nearest-footprint original frames,
while preserving the original cards' identity. This supersedes the previous
rejection of fixed outer tracks for Classic; it does not authorize a new visual
identity or replacing the original content with optional variant renderers.

## Findings

At 900×1600 with the saved human arrangement, News measured 382.42px high and
Out in SF 418.45px. The mismatch existed in normal mode too; the dashed editing
outlines made it obvious. Entering editing did not itself change those rectangles.
News had an explicit Medium height; SF used its content-driven Original height.

Four systems competed: authored spans/auto rows, variant pixel heights, a 13-card
page count, and a DOM fit heuristic. The tested finite packer was not the live
placement authority. Counting cards does not enforce area when cards vary in size.
The toolbar also used radius22/padding8×12/buttonRadius14, so its nested edges
could not share a center or even consistent insets.

## Contract and implementation

- Classic and Moonstone opt into `--home-grid-mode: standard` in its own theme JSON. Other
  themes retain their authored presentation pending review. Moonstone was applied
  after explicit approval of its isolated before/after previews. Grid geometry rules
  additionally require `data-layout=standard` from the compatible controller.
- One four-track × seven-row grid, gap9px, padding2px; Small spans two tracks
  and one row. Track dimensions derive from the available home rectangle with
  padding and all gaps deducted. Every size uses integer spans on those tracks.
- Default Clock/Air/Transit: Small. Default Weather/Painting/News/Events/Gardyn/
  Fractal and unknown cards: Medium, unless a widget supplies `homeSize`.
  `original` remains a compatibility alias for authored content in that frame.
  Default does not substitute an optional composition or change original type,
  colors, chart semantics or materials. Original loading content remains mounted.
- Packing owns both page allocation and explicit CSS placement. Overflow uses
  existing pages before adding a page (maximum20). Clock is pinned on each page.
  New cards take available room after existing cards. A deliberate resize/move
  reserves its requested area. Requested page and actual overflow page are
  distinct so shrinking restores room without undoing explicit page choices.
- Theme-local v3 storage migrates previous page/order/hidden/size choices and
  drops obsolete heuristic return-page bookkeeping. Persistent packing priority
  makes edit/go/reload deterministic. Failed actions restore the entire state.
- Normal/editing use identical grid, card padding and title coordinates. No home
  scrollbar. Dragging can start anywhere in a card's content. Visual edit circles
  have44px interaction targets and reserve title room in both modes.
- Classic's26px card radius informs the26px shared left inset. Header/body are
  separated by a consistent gap. Bare Clock/Fractal retain their special content.
  Nested adjacent rounded rectangles use innerR = outerR − inset − border:
  toolbar31px, inset8px +1px border, button22px. The gallery/picker follows the
  same relation. Independent thumbnails/circles keep purpose-specific shapes.
- Preview frames use actual grid dimensions before thumbnail scaling, and the
  same content/variant renderer as the live card. Unsupported sizes stay disabled.

## Verification

The fixed Medium frame is381.28px at the tested viewport; News and SF match
exactly. Every card's normal/editing rectangle matches exactly. Browser checks
cover every page's actual/declared dimensions, bounds, collisions and overflow;
resize overflow/restoration; manual page intent; persistence/reload; add/remove
and page actions; dragging from content; every offered variant; disabled-size
rejection; preview/live text equality; and the visible1.5-second edge cue.

Before/after artifacts for this run are under `/tmp/garden-grid-audit/`.
The frozen original archive is untouched. No API data was fabricated, no new
browser dependency was added to the application, and previews use isolated
storage and a read-only server.

Corner guidance: https://developer.apple.com/videos/play/wwdc2023/10076/

Moonstone approval follow-up: the same grid/corner-spacing recipes were applied
to Moonstone after the human approved the previews. Its palette, typography and
widget styles remain theme-owned. Grid dimensions still use Moonstone’s own gap.
