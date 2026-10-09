# Screenshot viewer and comparison modes

Scope: `apps/web/src/components/screenshot-viewer.tsx`, the viewer parts of `apps/web/src/review/review-workspace.tsx`, `apps/web/src/review/use-evidence.ts`, and the related CSS. All paths below are relative to the repository root unless they start with `/`.

Method: I read the source, then drove the fixture harness on port 4311 with Playwright (Chrome channel, device scale factor 1). I captured 39 states in four combinations (dark and light, 1440 x 900 and 390 x 844) and ran a measurement script. I replaced the stock SVG fixtures with canvas-made PNG images that have the real mask format (opaque red on transparent) so that the Difference mode shows what production shows.

Short verdict: the viewer is correct about evidence (it blocks review until the right pixels are decoded), but it is weak at its main job. A reviewer cannot see quickly what changed. The image gets about a quarter of the window, the Difference mode has no context, small changes are a few screen pixels, and zoom opens far from the change.

## How it works (map)

There is no viewer CSS. `apps/web/src/review.css` has two lines (`@import "tailwindcss"; @import "./components/ariakit/styles/ui.css";`). All `review-*` class names in the viewer (`review-pane`, `review-image-viewport`, `review-image-fit`, `review-image-actual`, `review-empty-image`, `review-viewer`, `review-evidence`, `review-view-controls`) are test hooks only. All styling is Tailwind utilities in `className` strings.

Sequence for one selected variant:

1. `ReviewSession` holds the view state in React state: `mode` starts as `"side"` and `zoom` starts as `"fit"` (`apps/web/src/review/review-workspace.tsx:197-198`). The types are `ReviewMode = "side" | "diff" | "new" | "original"` and `ReviewZoom = "fit" | 1 | 2` (`apps/web/src/review/model.ts:2-3`). The state is not in the URL and not in storage.
2. `effectiveMode` falls back from `"diff"` to `"side"` when one image is absent (`review-workspace.tsx:294-295`).
3. `useEvidence` builds an identity key from the comparison id, the variant id, the three image objects, and a retry counter (`apps/web/src/review/use-evidence.ts:18-31`). It lists the required roles: `reference` unless the variant is `added`, `candidate` unless `removed` or (`unchanged` and `candidateOmitted`), and `diff` only in Difference mode (`use-evidence.ts:76-103`). Status is `ready` only when each required role reported `ready` (`use-evidence.ts:104-115`). A `pending` variant is always `loading` (`use-evidence.ts:66-75`).
4. The toolbar is one `Frame` row above the viewer (`review-workspace.tsx:817-923`). Left: a `ButtonGroup` "Image view" with four `aria-pressed` buttons (Compare `S`, Difference `D`, Current `F`, Baseline `G`) and a `ButtonGlider`. Right: a `ButtonGroup` "Image zoom" with Fit, 100%, 200%.
5. `ScreenshotViewer` renders up to three `ImagePane` elements in a CSS grid (`apps/web/src/components/screenshot-viewer.tsx:209-263`). The grid has two columns only in Compare mode and only from the `md` viewport breakpoint. The reference and candidate panes are always mounted; the `hidden` attribute hides them by mode (`screenshot-viewer.tsx:221`, `:236`). The diff pane mounts on the first use of Difference for the current identity (`screenshot-viewer.tsx:205-208`, `:242`).
6. Each `ImagePane` is a `<figure>` with a `<figcaption>` (icon, caption, dimensions, and four pan buttons when zoom is not Fit) and a scroll container (`screenshot-viewer.tsx:82-145`). The scroll container has a fixed height `h-[min(56vh,650px)] min-h-80`, padding 18 px, and a checkerboard background (`screenshot-viewer.tsx:134`).
7. The `<img>` has `width` and `height` set to natural size times zoom (`screenshot-viewer.tsx:152-153`). At Fit, CSS limits it with `max-w-full h-auto max-h-full object-contain`. At 100% and 200% it uses `max-w-none` and `[image-rendering:pixelated]` (`screenshot-viewer.tsx:162`).
8. On `load`, the pane calls `decode()`, compares `naturalWidth` and `naturalHeight` with the model, and reports `ready` or an error with reason `load`, `decode`, or `dimensions` (`screenshot-viewer.tsx:49-72`, `:155-161`). The image has `invisible` until it is ready (`screenshot-viewer.tsx:162`).
9. Pan: each pan button scrolls its own pane by half of the pane size (`screenshot-viewer.tsx:73-80`). Each pane keeps its own scroll position in a ref, restores it after a mode or zoom change, and resets it to 0,0 when the identity changes (`screenshot-viewer.tsx:35-48`, `:138-144`).
10. Keyboard: one `keydown` listener on the document (`review-workspace.tsx:395-448`). `S`, `D`, `F`, `G` set the mode. Arrow keys select the item or the variant. `1` to `6` select a variant. There is no key for zoom and no key for pan.
11. Status: a loading row or an error row is inserted above the panes (`review-workspace.tsx:940-991`), and each pane shows its own text (`screenshot-viewer.tsx:166-180`). "Retry images" increments `retry`, which changes the identity and remounts the images (`review-workspace.tsx:974`).
12. Image bytes come from `/images/:id`. The response is public and immutable for one year (`apps/web/src/api/images.ts:48-57`). Each first request costs one D1 `SELECT` and one R2 read (`images.ts:24-40`). Limits: 2,100,000 pixels, 8192 px per side, 2 MiB encoded (`packages/compare/src/types.ts:9-14`).
13. Mask format: opaque red on transparent. Local engine: `pixelmatch` with `diffMask: true` (`packages/cli/src/png-comparison.ts:67-75`), and no mask at all when the sizes differ (`png-comparison.ts:64-66`). Legacy server engine: red for each changed pixel, and red for every pixel when the sizes differ (`packages/compare/src/compare.ts:110-119`).

## Findings

### VIEW-01 · Difference mode shows the mask alone: no screenshot context and no image boundary

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: S (minimal) to M
- Evidence: `apps/web/src/components/screenshot-viewer.tsx:242-261` renders only `variant.diff` in the diff pane. The mask is transparent except for changed pixels: `packages/cli/src/png-comparison.ts:74` `{ threshold: comparison.threshold, includeAA: false, diffMask: true }` and `packages/compare/src/compare.ts:117-118` `data[offset] = 255; data[offset + 3] = 255;`. Screens: `03-difference-fit-dark-1440.png`, `03-difference-fit-light-1440.png`, `12-difference-fit-large-change-dark-1440.png`, `42-change-crops-4x-dark-1440.png`.
- What happens: Difference shows red pixels on the stage checkerboard. The reviewer does not see the screenshot under the red pixels. The mask image has no border, so the reviewer also cannot see where the image starts and ends.
- Impact: The reviewer sees that something changed at a place on an empty rectangle. To learn what changed, the reviewer must go back to Compare and find the same place by eye. In `12-difference-fit-large-change-dark-1440.png` the two red lines and the red block have no relation to any UI element.
- Recommendation: Draw the mask on top of a dimmed copy of the current image. This needs no new data.

```tsx
<div className="relative">
  <img src={candidate.url} className="grayscale opacity-35" alt="" />
  <img src={diff.url} className="absolute inset-0 size-full" alt="Changed pixels" />
</div>
```

- Alternatives: (a) Minimal: only add a 1 px outline around the mask image so that its bounds are visible. (b) Tint: render the mask as a CSS `mask-image` over a solid magenta layer so that the highlight color and opacity are adjustable. (c) Full: one stage with layers (baseline, current, mask) and a shared transform, see the redesign ideas.
- Maintainer decision needed: yes. Is the dimmed-context overlay the new default for Difference, or is the raw mask kept as a separate option?

### VIEW-02 · A small change is a few screen pixels, and nothing points to it

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence: Measurements M1 and M2. A 12 x 10 px change (120 pixels) on a 1280 x 720 image at 1440 x 900: Compare renders the image at scale 0.4332, so the change is about 5 x 4 screen pixels. Difference at Fit renders at scale 0.65: 56 reddish screen pixels in a 1182 x 485 stage (0.0098%). A 1 px wide, 120 px tall change: 0 strong red pixels, 78 faint ones. The same 12 x 10 block on a 640 x 3200 image: 4 reddish pixels. On a 256 x 8192 image: 1 pixel. Screens: `02-compare-fit-dark-1440.png`, `42-change-crops-4x-dark-1440.png`, `17-tall-image-difference-dark-1440.png` (the stage looks empty), `10-difference-200-dark-1440.png` (empty at 200% because the view opens at the top left corner).
- What happens: The viewer always opens in Compare at Fit (`review-workspace.tsx:197-198`). There is no bounding box, no marker, no change list, no "jump to change", and no automatic zoom. Zoom 100% and 200% open at scroll 0,0 (`screenshot-viewer.tsx:39-41`), so the change is usually outside the view.
- Impact: This is the main task of the product. A reviewer can approve a variant without seeing the change. For tall images the Difference mode at Fit can show nothing at all.
- Recommendation: Compute change regions from the mask in the browser and use them for boxes, a counter, and "next change" navigation with automatic zoom. The mask has at most 2.1 MP (`packages/compare/src/types.ts:11`), so one pass is cheap. The images are same-origin (`apps/web/src/api/images.ts:55` `"Cross-Origin-Resource-Policy": "same-origin"`), so a canvas can read them.

```ts
// One pass over the mask. Merge changed pixels that are closer than `gap`.
function changeRegions(mask: ImageData, gap = 12): Rect[] {
  const cells = new Map<string, Rect>(); // coarse grid, cell size = gap
  // 1. For each pixel with alpha > 0, grow the rect of its grid cell.
  // 2. Union rects of neighbor cells (flood fill on the grid).
  // 3. Return the rects, sorted top to bottom, then left to right.
}
```

- Alternatives: (a) Minimal: draw the mask with a CSS `drop-shadow` or a dilate filter so that each change is at least 12 screen pixels, and start 100% and 200% centered on the first red pixel. (b) Server side: the CLI writes the regions into the signed local result. This avoids the mask download but changes the receipt format. (c) Crop gallery: show each region as an enlarged crop, see redesign idea R5.
- Maintainer decision needed: yes. Are change regions computed in the browser from the mask (one more image request for each changed variant), or are they added to the comparison result?

### VIEW-03 · Panes do not share pan; zoom, mode, and variant changes lose the inspected place

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence: `screenshot-viewer.tsx:35` `const position = useRef({ left: 0, top: 0 });` is local to each pane. `screenshot-viewer.tsx:46-47` restores raw offsets after a zoom change: `element.scrollLeft = position.current.left;`. `screenshot-viewer.tsx:39-41` resets on identity change. Measurements: M4 `{"baseline":[400,200],"current":[0,0]}` after a scroll of the baseline pane. M5: after 100% to 200% the scroll stays `[400,200]`, so the image point in the center moves from `[678,434]` to `[339,217]`. M6: Compare to Difference at 200% gives `{"currentPaneBefore":[1200,400],"differencePane":[0,0]}`. M7: the next variant gives `{"baseline":[0,0],"current":[0,0],"zoom":["200%"]}`.
- What happens: In Compare at 100% or 200% the reviewer must pan each pane separately with its own four buttons. A zoom change jumps to a different part of the image. A switch to Difference shows the top left corner. The next variant of the same item keeps the zoom but resets the pan.
- Impact: Side by side comparison at zoom is not practical. The common task "check the same button in 7 variants" needs a new pan for each variant.
- Recommendation: Keep one view state for the whole viewer and apply it to all layers. Zoom around the pointer or the center. Keep the place across variants of the same item when the sizes are equal.

```tsx
const [view, setView] = useState({ scale: 1, x: 0, y: 0 }); // image coordinates
<Stage view={view} onViewChange={setView}>
  <Layer image={baseline} />
  <Layer image={current} />
  <Layer image={mask} />
</Stage>;
```

- Alternatives: (a) Minimal: keep the scroll containers, mirror `scrollLeft` and `scrollTop` between panes in `onScroll`, and multiply the stored offsets by the zoom ratio. (b) Keep per-pane pan but add a "link panes" toggle that is on by default.
- Maintainer decision needed: yes. Does the pan position stay when the reviewer moves to the next variant of the same item?

### VIEW-04 · The image gets about a quarter of the window, and Fit does not fit the visible area

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence: `screenshot-viewer.tsx:134` `h-[min(56vh,650px)] min-h-80 overflow-auto p-4.5`. Measurement M1 for a 1280 x 720 image. At 1440 x 900: the first image pixel is at y = 432 (408 without the 24 px label of the fixture), the sticky action bar starts at y = 841, Compare shows two images of 555 x 312 (13.4% of the window each), and Current shows 832 x 468 (26.2%). In Current the fitted image ends at y = 900, so its last 59 px are under the action bar. At 1280 x 720: Current is 653 x 367 and ends at y = 799, the action bar starts at 661, so 138 px (38% of the image height) are hidden. At 2560 x 1440: the stage is capped at 650 px, a 1280 x 720 image is shown at scale 0.853, and the image share is 18.2%. The document still scrolls (`documentScrollHeight` 1464 for a 1440 px window). Screens: `05-current-fit-dark-1440.png`, `40-details-open-compare-dark-1440.png`.
- What happens: Seven rows are above the image: app header, run header, commit strip, title block, variant row, toolbar, and pane caption. The stage height is a fixed share of the viewport height, not the space that remains. The review action bar is sticky and covers the bottom of the stage. The page scrolls, and the pane also scrolls when zoomed.
- Impact: The reviewer inspects a small picture in a large window. On a 13 inch laptop the bottom of each fitted image is hidden until the page is scrolled. On a large monitor most of the window is empty.
- Recommendation: Make the workspace a fixed-height grid and let the stage take the remaining height. Then Fit can use the real stage box. Move the toolbar into the stage and the captions onto the image corners.

```tsx
<Shell className="h-dvh grid grid-rows-[auto_minmax(0,1fr)_auto]">
  <Header /> {/* one row: back, run, item, variant, progress */}
  <Stage className="min-h-0" /> {/* no h-[min(56vh,650px)] */}
  <ReviewActions />
</Shell>
```

- Alternatives: (a) Minimal: replace the fixed height with `calc(100dvh - <chrome above> - <action bar>)` so that Fit ends above the action bar. (b) Add a "focus" toggle (`.` key) that hides the headers and the sidebar. (c) Stack the two panes vertically when the images are wide and the panes are narrow (see `40-details-open-compare-dark-1440.png`: 427 px wide panes with about 170 px of empty stage below each image).
- Maintainer decision needed: yes. May the review page stop using document scroll and become a fixed-height app layout?

### VIEW-05 · Comparison techniques that are missing

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence: `apps/web/src/review/model.ts:2-3` lists all modes and zoom values. `screenshot-viewer.tsx` has no pointer handlers. Measurement M10: a mouse drag leaves the scroll at `[0,0]`, Ctrl plus wheel leaves the zoom at `200%`, and the cursor is `auto`.
- What happens: The table gives the state of each technique.

| Technique                                             | State today                                                                                                                                                                                                                            | Evidence                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Overlay with opacity slider (onion skin)              | Absent                                                                                                                                                                                                                                 | No mode in `model.ts:2`         |
| Swipe or split slider                                 | Absent                                                                                                                                                                                                                                 | No mode in `model.ts:2`         |
| Blink toggle                                          | Not a feature. `F` then `G` shows current then baseline at the same place at Fit when the sizes are equal (`05-current-fit-dark-1440.png`, `06-baseline-fit-dark-1440.png`). It breaks at zoom because each pane has its own pan (M4). | `review-workspace.tsx:434-437`  |
| Diff highlight boxes, jump to change                  | Absent                                                                                                                                                                                                                                 | VIEW-02                         |
| Synchronized zoom and pan                             | Zoom is shared, pan is not                                                                                                                                                                                                             | M4                              |
| Pixel inspector (coordinates, color before and after) | Absent                                                                                                                                                                                                                                 | No pointer handlers             |
| 1:1 device pixel mode                                 | Absent. 100% means CSS pixels (`screenshot-viewer.tsx:152`), so a display with device pixel ratio 2 doubles each image pixel.                                                                                                          | `screenshot-viewer.tsx:152-153` |
| Focus-on-change automatic zoom                        | Absent                                                                                                                                                                                                                                 | M6                              |
| Free zoom (wheel, pinch, more levels)                 | Absent. Three fixed levels.                                                                                                                                                                                                            | `model.ts:3`, M10               |
| Drag to pan                                           | Absent                                                                                                                                                                                                                                 | M10                             |

- Impact: Each missing technique is a different way to see a change fast. Swipe and blink are the fastest for layout shifts. A pixel inspector is the only exact way to judge a color change such as `#2563eb` to `#1d4ed8` (`14-small-image-compare-dark-1440.png`, the two circles look the same).
- Recommendation: Build the viewer as one stage with layers and a shared view transform (VIEW-03). Then each technique is a small layer rule: swipe is `clip-path` on the current layer, onion skin is `opacity`, blink is a timed or held swap, the inspector reads two `ImageData` buffers.
- Alternatives: (a) Minimal: add only blink (hold `Space` to show the baseline in place of the current image) and synchronized pan. (b) Add swipe and onion skin as two more buttons in the current toolbar and keep the scroll panes. (c) All techniques, see the redesign ideas.
- Maintainer decision needed: yes. Which techniques are in scope for the first redesign?

### VIEW-06 · Arrow keys never pan, there are no zoom keys, and the mouse cannot drag

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S to M
- Evidence: The pane is focusable and tells the user to scroll: `screenshot-viewer.tsx:135-136` `tabIndex={0}` and ``aria-label={`${label}. Use pan controls or scroll to inspect the image.`}``. The shortcut filter does not exclude it: `review-workspace.tsx:94-96` lists inputs, menus, dialogs, tab lists, `.review-variants`, and the search field. Measurement M3 with the pane focused at 200%: `ArrowRight` changes the variant from `row-React` to `row-Solid` and the scroll stays `[0,0]`; `ArrowDown` changes the item to "Open menu"; `PageDown`, `Space`, `End`, `Home` scroll the pane; `+`, `-`, `0` do nothing; `2` selects variant 2. The help text confirms it: `review-workspace.tsx:162-163` "Use the visible pan buttons to move zoomed images."
- What happens: A keyboard user at zoom must Tab to four 25 x 25 px buttons for each pane (M14 `"panButtonSize":[[25,25]]`). In Compare at 200% the viewer has 10 tab stops (2 panes and 8 pan buttons) before the review actions. The pan step is fixed at half of the pane. No scrollbar is visible in the captures (`08-compare-200-dark-1440.png`), so the pan buttons are the only visible hint that the pane scrolls.
- Impact: Zoomed inspection is slow with the keyboard and unusual with the mouse. The number keys are taken by variants, so the common zoom keys `1`, `2`, `0` are not free.
- Recommendation: When the stage has focus and the image is larger than the stage, let the arrow keys pan and let `Escape` return to item and variant navigation. Add `+`, `-`, `0` for zoom, `Z` for "zoom to next change", drag to pan, and wheel or pinch to zoom. Show the keys in `Kbd` slots and in the help dialog.
- Alternatives: (a) Minimal: `Shift` plus arrow keys pan all panes. (b) `W`, `A`... is not possible because `A` approves; use `H`, `J`, `K`, `L` for pan. (c) Keep buttons only, but make one shared pan pad for all panes.
- Maintainer decision needed: yes. Which keys pan, given that the arrow keys and `1` to `6` are used for navigation?

### VIEW-07 · Difference says "within the comparison tolerance" for an image whose size changed

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: The local engine returns no mask when the sizes differ: `packages/cli/src/png-comparison.ts:64-66` `return { outcome: "changed" as const, changedPixels: pixels, ratio: 1, sizeChanged: true };`. The service rejects a mask in that case: `apps/web/src/api/local-comparison.ts:584-591` (`sizeChanged ||` in the mask check). The stored result gets `maskExpected: !!result.mask` (`apps/web/src/api/workflow-materialize.ts:351`), and the review API passes it on (`apps/web/src/api/review.ts:509-512`). The viewer then picks the wrong text: `screenshot-viewer.tsx:249-253` `variant.changedPixels === 0 ? "No pixels changed." : variant.maskExpected === false ? "Pixel changes are within the comparison tolerance." : "Pixel diff unavailable"`. `use-evidence.ts:98` treats the same case as complete. Screen: `22-size-changed-difference-local-no-mask-dark-1440.png` shows "100.00% changed · 1,100,800 changed pixels", the badge "Needs review", and the sentence "Pixel changes are within the comparison tolerance."
- What happens: For a changed variant with different image sizes, the Difference button is enabled and the pane states the opposite of the truth. I reproduced it in the fixture with the model shape that the code path produces. I did not read a production record.
- Impact: A reviewer can read the sentence as "safe to approve". Related: with the legacy server engine the same case shows one solid red rectangle (`21-size-changed-difference-server-mask-dark-1440.png`), which gives no information.
- Recommendation: Detect the size change in the viewer and show a size-change state in place of a pixel diff.

```tsx
const sizeChanged =
  variant.reference &&
  variant.candidate &&
  (variant.reference.width !== variant.candidate.width ||
    variant.reference.height !== variant.candidate.height);
// Difference pane: "Size changed: 1280 × 720 → 1280 × 860. A pixel diff is not available."
```

- Alternatives: (a) Minimal: change only the text branch. (b) Disable Difference when the sizes differ and show the size change as a badge next to the dimensions. (c) Compute a client diff after an alignment at the top left corner and mark the added or removed band.
- Maintainer decision needed: no.

### VIEW-08 · Images with different sizes get different scales in Compare, and nothing marks the size change

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S to M
- Evidence: Each pane fits its own image (`screenshot-viewer.tsx:162`). Measurement M12 for 1280 x 720 and 1280 x 1600 at 1440 x 900: baseline scale 0.4332 (555 x 312), current scale 0.2925 (374 x 468). The only sign of the size change is the caption text in `text-[10px] ... ak-ink-50` (`screenshot-viewer.tsx:103-105`). Screen: `20-size-changed-compare-dark-1440.png`.
- What happens: The same button is 43% of its size on the left and 29% on the right. Elements look smaller in the current image although only the height changed.
- Impact: The reviewer can read a scale difference as a visual regression, or can miss that the capture size changed.
- Recommendation: Use one scale for both images (the smaller of the two fit scales) and align them at the top left corner. Show a clear size badge, for example a warning `Badge` "Size 1280 × 720 → 1280 × 1600".
- Alternatives: (a) Minimal: only add the badge. (b) Overlay the two images at the same scale and hatch the band that exists in only one of them.
- Maintainer decision needed: no.

### VIEW-09 · Added, removed, and locally matched variants keep the two-pane layout with an empty pane

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: Pane visibility depends only on the mode: `screenshot-viewer.tsx:221` `hidden={mode !== "side" && mode !== "original"}` and `:236` `hidden={mode === "diff" || mode === "original"}`. `review-workspace.tsx:294-295` corrects only the `diff` mode. Screens: `23-added-compare-dark-1440.png` (left half empty: "New image, no reference"), `25-added-baseline-dark-1440.png` (whole stage empty), `27-removed-compare-dark-1440.png`, `36-local-comparison-compare-dark-1440.png` (right half empty: "New image not uploaded"), `37-local-comparison-current-dark-1440.png` (whole stage empty), `23-added-compare-dark-390.png` (on a phone the empty pane is first and the new image is about 430 px lower).
- What happens: A new item shows its only image in half of the stage. The Baseline button stays enabled for a new item and the Current button stays enabled for a removed item and for a locally matched item, and each shows an empty stage. Locally matched variants are the normal case for unchanged items, so the empty right pane is the common view of the Accepted list.
- Impact: Half of a small stage is lost exactly where a reviewer has only one image to judge. Empty modes look like errors.
- Recommendation: Derive the layout from the available images. With one image, show one full-width pane with a state label ("New", "Removed", "Matched locally: same as baseline") and hide or disable the modes that have no image.

```tsx
const single = !variant.reference || !variant.candidate;
const layout = single ? "single" : mode;
```

- Alternatives: (a) Minimal: for a single image force the mode to `new` or `original` and keep the buttons. (b) Keep two panes but shrink the empty one to a narrow labelled strip.
- Maintainer decision needed: no.

### VIEW-10 · Status rows and pan buttons move the image by 9 to 54 px

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: Measurement M8, top of the image stage at 1440 x 900: `{"ready":414,"readyZoomed":423,"loading":455,"loadError":468,"added":439}`. Sources: the loading row and the error row are inserted above the viewer (`review-workspace.tsx:940-991`), the hint line is inserted above it (`review-workspace.tsx:924-930`), and the caption grows when the pan buttons appear (`screenshot-viewer.tsx:95` `min-h-12 flex-wrap`, `:108-130`). Screens: `30-loading-dark-1440.png`, `31-load-error-dark-1440.png`, `23-added-compare-dark-1440.png`, `08-compare-200-dark-1440.png`.
- What happens: Each time a variant with uncached images is selected, the stage moves down 41 px and then up 41 px. A zoom change moves it 9 px. The loading text is shown three times (one row and one text in each pane).
- Impact: The image jumps during the most frequent action (next variant). The eye loses its place.
- Recommendation: Put loading, error, and hint states inside the stage as an overlay, and reserve the space for pan controls. Use a fixed-height caption.
- Alternatives: (a) Minimal: give the status row a fixed height that is always present. (b) Use a toast-like `Badge` in a stage corner for loading and a centered card for errors.
- Maintainer decision needed: no.

### VIEW-11 · No preload and no placeholder: each variant change shows an empty stage until two full images load and decode

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S (preload) to M (placeholder)
- Evidence: Measurement M13. After the first variant is ready: requests `["/probe-v0-reference.png","/probe-v0-candidate.png"]` and nothing for the next variant. After the next variant is selected: `["/probe-v1-reference.png","/probe-v1-candidate.png"]`. After the first Difference: `["/probe-v1-diff.png"]`. The image is remounted and hidden until decoded: `screenshot-viewer.tsx:148` `key={identity}` and `:162` `${ready ? "visible" : "invisible"}`. A low-resolution image already exists in the model: `apps/web/src/review/model.ts:36` `thumbnail?: string;` (made by `createThumbnail`, at most 256 px, `packages/compare/src/compare.ts:127-147`).
- What happens: The review loop "Approve and next" always waits for 2 image requests (3 in Difference) after the selection changes. Each first request is one Worker call with one D1 query and one R2 read (`apps/web/src/api/images.ts:24-40`). The old images are removed at once, so the stage is empty during the wait. I did not measure production latency.
- Impact: The wait is paid once for each variant, at the moment the reviewer wants the next picture. With 2 MiB images on a slow link this is the main delay of the review loop. This is part of the "pages load slowly" complaint as the reviewer feels it.
- Recommendation: Preload the images of the next pending variant and of the next and previous variant of the current item. The responses are immutable, so a preload is safe.

```ts
useEffect(() => {
  for (const image of neighborImages(model, selection)) new Image().src = image.url;
}, [model.comparisonId, selection.itemKey, selection.variantKey]);
```

- Alternatives: (a) Keep the previous image visible until the new one is decoded, then swap. (b) Show the thumbnail, scaled to the known width and height, as a blurred placeholder. (c) Minimal: reserve the exact image box from `width` and `height` and show a skeleton, so that only the pixels appear.
- Maintainer decision needed: no.

### VIEW-12 · The image has no visible boundary, and the checkerboard does not mean transparency

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: The checkerboard is the background of the whole scroll container, not of the image: `screenshot-viewer.tsx:134` `bg-[repeating-conic-gradient(color-mix(in_oklch,currentColor_6%,transparent)_0%_25%,transparent_0%_50%)] bg-size-[20px_20px]`. The `<img>` has no border, ring, or shadow (`screenshot-viewer.tsx:162`). Screens: `02-compare-fit-light-1440.png` (white screenshots merge with the light stage), `41-preview-app-run-dark-1440.png` (dark screenshots merge with the dark stage), `03-difference-fit-dark-1440.png` (the mask bounds are not visible).
- What happens: A light screenshot on the light theme and a dark screenshot on the dark theme have no edge. The checkerboard covers the area outside the image too, so it cannot show which image pixels are transparent. With the default `background-attachment`, the pattern does not move when the image is panned. At Fit, the `<img>` box can be wider than the picture (`max-h-full` with `object-contain`), so a CSS border on the element would not match the picture.
- Impact: The reviewer cannot see where a capture ends. Missing bottom rows or a size change are easy to miss. Ariakit captures are light and dark variants of the same UI, so one of the two themes always has this problem.
- Recommendation: Make the stage a recessed surface with a plain color, size the image box to the picture, and give the image a 1 px ring from the edge color. Draw the checkerboard only behind the image.

```tsx
<Layer className="ak-layer-darken-2 grid place-items-center">
  {" "}
  {/* recessed stage */}
  <div
    className="ring-1 ring-(--ak-edge) [background:var(--checkerboard)]"
    style={{ aspectRatio: `${image.width} / ${image.height}`, width: fitWidth }}
  >
    <img src={image.url} className="block size-full" />
  </div>
</Layer>
```

- Alternatives: (a) Minimal: add `outline-1 outline-(--ak-edge)` to the image and accept the mismatch at Fit for tall images. (b) Offer a stage background switch (auto, light, dark, checkerboard) in the toolbar.
- Maintainer decision needed: no.

### VIEW-13 · Four vocabularies for the same four views

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: Toolbar labels: "Compare", "Difference", "Current", "Baseline" (`review-workspace.tsx:845`, `:860`, `:874`, `:888`). Pane captions: "Baseline", "Current", "Difference" (`screenshot-viewer.tsx:37-38`). Image `alt` and `aria-label`: "Reference", "New image", "Pixel diff · red pixels changed" (`screenshot-viewer.tsx:219`, `:229`, `:245`). Empty texts: "New image, no reference", "Removed, no new image", "New image not uploaded" (`screenshot-viewer.tsx:220`, `:231-233`). Help dialog: "Side by side, red pixel diff, new image only, or original only." (`review-workspace.tsx:174-175`). Live message: "Pixel diff requires both a reference and a new image." (`review-workspace.tsx:378-380`, `:928`). Guide: "Side by side", "Pixel diff", "New only", "Original only" (`docs/review-guide.md:29-37`, `:76-77`). Code: `side`, `diff`, `new`, `original`, `reference`, `candidate` (`apps/web/src/review/model.ts:2`, `:33-35`). Measurement M14 shows captions `["Baseline","Current"]` next to alt texts `["Reference","New image"]`, and a pan button with `"label":"Pan Reference left","title":"Pan baseline left"`.
- What happens: The same picture is "Baseline", "Reference", and "Original". The other one is "Current", "New image", "New", and "candidate".
- Impact: A sighted user reads "Baseline" and a screen reader user hears "Reference". The guide does not match the buttons. The guide also says "Fit: Image scaled to the available viewer width" (`docs/review-guide.md:35`), but the code also limits the height and never enlarges.
- Recommendation: Choose one pair of user words (for example Baseline and Current) and one name for each mode, then use them in labels, alt text, announcements, help, and the guide. Keep `reference` and `candidate` as code names only.
- Alternatives: (a) Minimal: fix only the accessible names so that they match the visible captions. (b) Rename the code enum too (`side` to `compare`, `new` to `current`, `original` to `baseline`).
- Maintainer decision needed: yes. Which words are the product terms: Baseline and Current, or Reference and New?

### VIEW-14 · Fit never enlarges small images and squeezes tall or wide images; zoom has three fixed levels

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S to M
- Evidence: `screenshot-viewer.tsx:152-153` sets the natural size and `:162` only adds `max-w-full ... max-h-full`. Measurement M11: a 32 x 32 image at Fit is rendered at `{"w":32,"h":32}`, scale 1, in a 591 x 504 pane. Screens: `14-small-image-compare-dark-1440.png`, `16-tall-image-compare-dark-1440.png` (a 640 x 3200 image is a strip about 94 px wide, scale 0.146), `19-wide-image-compare-dark-1440.png` (a 3200 x 600 image is 555 x 104 with about 360 px of empty stage below). `apps/web/src/review/model.ts:3` allows only `"fit" | 1 | 2`.
- What happens: A small component capture stays small in a large stage. A tall capture is fitted by height and becomes unreadable; there is no "fit width". There is no level below 100% other than Fit and no level above 200%. At 100% on a display with device pixel ratio 2, each image pixel covers 2 x 2 device pixels, so there is no true 1:1 view.
- Impact: Small component captures are a normal case for Ariakit examples. The reviewer must switch to 200% (which is still small for a 32 px icon) and then pan.
- Recommendation: Make Fit mean "contain, and enlarge by whole steps (2x, 3x, 4x) with pixelated rendering when the image is small". Add "fit width" for tall images. Replace the three buttons with a zoom stepper (`−`, value, `+`) with presets from 25% to 800%, and add a "1:1 device pixels" preset.
- Alternatives: (a) Minimal: add 400% and "fit width". (b) Automatic first zoom: pick the level from the image size and the size of the change region.
- Maintainer decision needed: no.

### VIEW-15 · Phone layout: the first image starts at 63% of the screen, and the two images are never visible together

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: Measurement M15 at 390 x 844: the baseline image is at y = 535 to 734 (scale 0.2766, 354 x 199), the current image starts at y = 1057, the action bar starts at y = 757 and is 89 px tall, the page is 1638 px tall, the toolbar block is 92 px tall, and the mode group has `scrollWidth` 401 for `clientWidth` 366. The grid stacks below `md`: `screenshot-viewer.tsx:211` `data-[mode=side]:md:grid-cols-2 max-md:grid-cols-1!`. Each stacked pane keeps `min-h-80` and 56vh (`screenshot-viewer.tsx:134`). Measurement M14: mode buttons are 25 px tall, zoom buttons 46 x 25, pan buttons 25 x 25. Screens: `02-compare-fit-dark-390.png`, `08-compare-200-dark-390.png`, `sheet-dark-390-a.png`.
- What happens: On a phone, Compare puts the baseline in one 473 px tall pane and the current image 522 px lower in a second pane, with about 270 px of empty stage between them. The "Baseline" button is cut at the right edge. At 100% and 200% the pane scrolls in two directions inside a page that scrolls.
- Impact: Side by side comparison does not exist on a phone. Touch targets are small.
- Recommendation: Use one stage on narrow screens. Show the current image and let the reviewer press and hold (or tap a two-state switch) to see the baseline in the same place. Use pinch to zoom and drag to pan. Put the mode switch in the bottom bar.
- Alternatives: (a) Minimal: size each stacked pane to its image (no `min-h-80`, no 56vh) so that both images fit on one screen. (b) Use a vertical swipe divider.
- Maintainer decision needed: yes. Is phone review a supported use case, or is "read only on a phone" enough?

### VIEW-16 · The disabled Approve button looks enabled while images load or fail

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: Measurement M9. Enabled: background `oklch(0.515341 0.1546 248.516)`, text `oklch(1 0 0)`. Disabled during loading: `"disabled":true`, the same background, opacity `1`, text `oklch(1 0 0 / 0.733357)`. The Reject button changes more (text alpha 0.449). Source: `review-workspace.tsx:1080-1097` (`$layer="brand"` with `disabled={!ready || ...}`). Screens: `30-loading-dark-1440.png`, `31-load-error-light-1440.png`, `28-tolerated-difference-dark-1440.png`, `41-preview-app-run-dark-1440.png`.
- What happens: The brand button keeps its full blue fill when it is disabled. Only the label loses some opacity.
- Impact: During loading, on errors, on unchanged variants, and on read-only runs, the primary action looks ready. A click does nothing and gives no reason. This finding is about the action bar, but the viewer states cause it. It can overlap with the workspace lane.
- Recommendation: Give the disabled brand button a neutral surface (drop `$layer="brand"` while disabled), and show the reason near it ("Loading images", "Read only").
- Alternatives: (a) Minimal: reduce the fill with a disabled style in the recipe. (b) Replace the button content with a `Progress` indicator while the evidence loads.
- Maintainer decision needed: no.

### VIEW-17 · Accessible names and roles in the viewer

- Kind: accessibility
- Severity: low. Confidence: medium. Measured: yes. Effort: S
- Evidence: Measurement M14. The scroll container is focusable with an `aria-label` but has no role: `"viewportLabel":[{"role":null,"label":"Reference. Use pan controls or scroll to inspect the image."}]` (`screenshot-viewer.tsx:132-137`). The mode buttons have the shortcut letter inside the accessible name and no `aria-keyshortcuts`: `{"text":"Compare S","pressed":"true","keyshortcuts":null}` (`review-workspace.tsx:845-846`). The pan buttons use `title` for the tooltip (`screenshot-viewer.tsx:121`). The diff image name is "Pixel diff · red pixels changed" and it is reused in the pan names: "Pan Pixel diff · red pixels changed right" (`screenshot-viewer.tsx:109`, `:120`, `:245`). The four mode buttons are exclusive but use `aria-pressed` toggles. The Difference button uses `aria-disabled` and a click gives only a screen-reader message (`review-workspace.tsx:377-381`, `:1202-1204`).
- What happens: A screen reader can skip the label of the scroll region (a `div` without a role). It reads "Compare S". The caption icon of the Current pane is green (`screenshot-viewer.tsx:98` `$text={role === "candidate" ? "success" : true}`), which looks like a success state but has no meaning.
- Impact: Small friction for assistive technology users and a color that suggests a status.
- Recommendation: Give the stage `role="group"` or `role="img"` with a short name, move the shortcut letter to `aria-keyshortcuts` and a `Kbd` slot that is `aria-hidden`, use the `Tooltip` primitive in place of `title`, and model the modes as a radio group or as tabs. I did not test with a screen reader.
- Alternatives: (a) Minimal: add `role="group"` and `aria-keyshortcuts`. (b) Use the `Tabs` primitive for the modes, which also gives arrow-key movement inside the group.
- Maintainer decision needed: no.

### VIEW-18 · View state is not shareable and not remembered

- Kind: ux
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence: `review-workspace.tsx:197-198` `useState<ReviewMode>("side")` and `useState<ReviewZoom>("fit")`. The route search carries only `comparison`, `item`, and `variant` (`review-workspace.tsx:753-757`). The sidebar state, in contrast, is stored (`review-workspace.tsx:226-233`).
- What happens: A reload returns to Compare at Fit. A link cannot say "this variant in Difference at 200% at this place". A reviewer who prefers Difference must press `D` again after each reload.
- Impact: Small, repeated cost. Links in pull request comments cannot point at the evidence.
- Recommendation: Store the preferred mode and zoom in `localStorage` (like the sidebar), and add optional search parameters (`view`, `zoom`, `at=x,y`) for links.
- Alternatives: (a) Only persist the preference. (b) Only add a "Copy link to this view" action.
- Maintainer decision needed: no.

### VIEW-19 · The viewer goes around the primitives, and its class hooks have no styles

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence: Raw type sizes and ink values on `Text`: `screenshot-viewer.tsx:101` `text-xs font-medium`, `:103` `text-[10px] tabular-nums ak-ink-50`, `:168` `text-[13px] ak-ink-60`. Plain elements for status: `review-workspace.tsx:925` `<p className="text-xs ak-ink-60 px-3 pb-3">`, `:941-943` `<div className="flex flex-wrap justify-center items-center gap-2 p-3 text-sm ak-ink-60" role="status">`. A 170 character arbitrary background value in the class string (`screenshot-viewer.tsx:134`). Native `title` tooltips (`screenshot-viewer.tsx:121`, `review-workspace.tsx:575`). A native `<progress>` in the header (`review-workspace.tsx:599-604`). The class names `review-pane`, `review-image-fit`, `review-image-actual`, `review-empty-image`, `review-viewer`, `review-evidence`, `review-view-controls` have no CSS rule (`apps/web/src/review.css` is two `@import` lines) and exist for tests (`apps/web/src/review/__tests__/review.browser.test.ts:1298`, `:1719`, `:1787`). The same `review-empty-image` class is used for the empty text and for the loading overlay (`screenshot-viewer.tsx:168`, `:176`). The stage uses `Layer $layer="canvas"`, the same surface as the page (`screenshot-viewer.tsx:132-133`), so the stage is not a distinct material.
- What happens: The viewer is styled with one-off utilities. The upstream package now has `Tooltip`, `Progress`, `Separator`, `Kbd`, `Heading`, and `Dialog` primitives that the vendored copy does not have (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components`).
- Impact: Inconsistent type scale (10, 11, 12, 13 px in one screen), and the tests are tied to class names that look like styling hooks.
- Recommendation: Build small viewer parts on the primitives: `ViewerStage` (recessed `Layer`), `ViewerLabel` (`Badge`), `ViewerToolbar` (`ButtonGroup` or `Tabs` with `Kbd`), `ViewerStatus` (`Frame` with `Progress`). Use `data-*` attributes or roles for test hooks.
- Alternatives: (a) Minimal: move the checkerboard to a `@utility` or a CSS variable and replace `title` with `Tooltip`. (b) Leave as is until the redesign replaces the component.
- Maintainer decision needed: no.

### VIEW-20 · Small text and state defects around the viewer

- Kind: copy
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence and what happens, one item for each line:
  - The change ratio is rounded to two decimals in the heading: `review-workspace.tsx:646` `(variant.ratio * 100).toFixed(2) + "% changed · "`. The details panel uses four decimals (`review-workspace.tsx:494`). Screens show "0.00% changed · 3 changed pixels" (`28-tolerated-difference-dark-1440.png`) and "0.00% changed · 1 changed pixels" (`36-local-comparison-compare-dark-1440.png`, also a plural error).
  - A pending variant shows "— changed pixels" (`33-pending-comparison-dark-1440.png`, `review-workspace.tsx:647`).
  - For a locally matched variant, a click on the `aria-disabled` Difference button announces "Pixel diff requires both a reference and a new image" (`review-workspace.tsx:377-381`), but the visible hint for that case is "Matched locally. The new image was not uploaded." (`review-workspace.tsx:926-927`).
  - Difference stays enabled for an unchanged variant and shows one sentence on a full-size stage: "Pixel changes are within the comparison tolerance." or "No pixels changed." (`28-tolerated-difference-dark-1440.png`, `29-zero-pixels-difference-dark-1440.png`). Tolerated pixels cannot be inspected because no mask is stored for an unchanged pair (`packages/compare/src/compare.ts:106-108`).
  - "Retry images" and "Recompare now" are flat buttons with no border inside a centered text row, so they look like text (`31-load-error-dark-1440.png`, `review-workspace.tsx:971-988`).
  - After "Retry images" the stored pan position is reset but the real scroll position is not, because the reset effect depends on `identity` and the restore effect does not (`screenshot-viewer.tsx:39-48`). The next mode change then jumps to 0,0. I derived this from the code and did not reproduce it.
- Impact: Each item is small. Together they make the states harder to trust.
- Recommendation: Format the ratio with significant digits ("< 0.01%"), handle singular and pending text, align the announcement with the visible hint, disable Difference when there is nothing to show, and give recovery actions a border.
- Alternatives: Fix only the ratio text and the plural.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All scripts are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-viewer/`. Commands:

- `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-viewer/capture.mjs` (all screenshots; `states.mjs` defines the states; result: `failures: 0`)
- `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-viewer/measure.mjs` (raw output in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-viewer/measure-output.txt`, stderr empty)
- `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-viewer/explore.mjs` (first geometry pass)
- `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-viewer/crops.mjs` (enlarged crops)

Raw results (shortened to the fields that the findings use; the file has the full lines):

```text
M1 compare-fit 1280x720   viewerTop 366, actionsTop 661, each image 475x267, scale 0.3707, visibleImageShare 0.1178 per pane
M1 current-fit 1280x720   image 653x367 at y 432, scale 0.51, visibleImageShare 0.1619
M1 compare-fit 1440x900   viewerTop 366, actionsTop 841, stage 591x504 at y 414, each image 555x312, scale 0.4332, visibleImageShare 0.1336 per pane
M1 current-fit 1440x900   stage 1182x504, image 832x468 at y 432, scale 0.65, visibleImageShare 0.2622
M1 compare-fit 1920x1080  each image 795x447, scale 0.6207, visibleImageShare 0.1714 per pane
M1 current-fit 1920x1080  image 1011x569, scale 0.79, visibleImageShare 0.2774
M1 compare-fit 2560x1440  stage height 650, each image 1092x614, scale 0.8528, visibleImageShare 0.1819 per pane, documentScrollHeight 1464
M1 current-fit 2560x1440  image 1092x614, scale 0.8528, visibleImageShare 0.1819
M2 difference-fit block-12x10 1280x720  dark  {"scale":0.65,"clip":[1182,485],"strongRed":48,"reddish":56,"bounds":[8,7],"shareOfClip":0.000098}
M2 difference-fit line-60x2 1280x720    dark  {"scale":0.65,"strongRed":38,"reddish":78,"bounds":[39,2]}
M2 difference-fit vline-1x120 1280x720  dark  {"scale":0.65,"strongRed":0,"reddish":78,"bounds":[1,78]}
M2 difference-fit block-12x10 640x3200  dark  {"scale":0.1462,"strongRed":2,"reddish":4,"bounds":[2,2]}
M2 difference-fit block-12x10 256x8192  dark  {"scale":0.0571,"strongRed":0,"reddish":1,"bounds":[1,1]}
M2 difference-fit block-12x10 3200x600  dark  {"scale":0.3581,"strongRed":12,"reddish":19,"bounds":[5,4]}
   (light scheme: the same counts within 1 pixel)
M3 before                                  {"scroll":[0,0],"variant":"row-React","item":"Success dialog"}
M3 after ArrowRight on focused viewport    {"scroll":[0,0],"variant":"row-Solid","item":"Success dialog"}
M3 after ArrowDown on focused viewport     {"scroll":[0,0],"variant":"row-Menu","item":"Open menu"}
M3 other keys: PageDown [0,0]->[0,464]; Space ->[0,928]; End ->[0,972]; Home ->[0,0]; "+", "-", "0": no change, zoom stays 200%; "2": variant row-React -> row-Solid
M4 after scrolling baseline to 400,200 at 100%  {"baseline":[400,200],"current":[0,0]}
M4 after one Pan right on baseline              {"baseline":[696,200],"current":[0,0]}
M5 zoom 100% to 200% keeps raw scroll offsets   {"scrollAfter":[400,200],"imagePointAtCenterBefore":[678,434],"imagePointAtCenterAfter":[339,217]}
M6 switch Compare to Difference at 200%         {"currentPaneBefore":[1200,400],"differencePane":[0,0]}
M7 after next variant                           {"baseline":[0,0],"current":[0,0],"zoom":["200%"],"panes":2}
M8 top of the image viewport by state (1440x900) {"ready":414,"readyZoomed":423,"loading":455,"loadError":468,"added":439}
M9 enabled        Approve: disabled false, opacity 1, background oklch(0.515341 0.1546 248.516), color oklch(1 0 0)
M9 while loading  Approve: disabled true,  opacity 1, background oklch(0.515341 0.1546 248.516), color oklch(1 0 0 / 0.733357)
                  Reject:  disabled true,  color oklch(1 0 0 / 0.449234)
M10 pointer {"afterDrag":[0,0],"afterWheel":[0,300],"pageScrollAfterWheel":0,"zoomAfterCtrlWheel":["200%"],"cursor":"auto"}
M11 small 32x32 at Fit [{"content":{"x":536,"y":432,"w":32,"h":32},"scale":1},{"content":{"x":1128,"y":432,"w":32,"h":32},"scale":1}]
M12 1280x720 vs 1280x1600 at Fit: Baseline 555x312 scale 0.4332; Current 374x468 scale 0.2925
M13 requests after first variant is ready (Compare) ["/probe-v0-reference.png","/probe-v0-candidate.png"]
M13 requests after switching to Current only []
M13 requests after next variant in Current only ["/probe-v1-reference.png","/probe-v1-candidate.png"]
M13 requests after first Difference ["/probe-v1-diff.png"]
M14 names: captions ["Baseline","Current"]; imageAlt ["Reference","New image"]; viewport role null; pan {"label":"Pan Reference left","title":"Pan baseline left"}; mode buttons text "Compare S" with keyshortcuts null; zoom buttons 46x25, 49x25, 51x25; pan button 25x25; mode buttons 25 px tall
M15 mobile compare-fit 390x844: viewerTop 469, actionsTop 757, documentScrollHeight 1638; Baseline image 354x199 at y 535, scale 0.2766; Current image at y 1057
M15 mobile toolbar {"modeGroupClientWidth":366,"modeGroupScrollWidth":401,"controlsHeight":92,"actionsHeight":89}
Preview app (port 4310, /runs/00000000-0000-4000-8000-000000000001): {"viewer":true,"top":431.296875,"h":504,"evidence":"ready"}
```

Limits:

- The fixture page has a 24 px test label ("Outside search") above the app. Subtract 24 px from each y value to get the real route. The preview app measurement (stage top 431 px with one read-only banner) confirms the same layout.
- Images are synthetic. The reference and current images are canvas drawings. The mask uses the real format, but its content is a filled rectangle. Real anti-aliased changes are thinner.
- Chrome only (Playwright, `channel: "chrome"`), headless, device scale factor 1, macOS. No Firefox or Safari check. No real touch device.
- "Reddish" means red minus the larger of green and blue is more than 40. "Strong red" means red above 200 and green and blue below 60. The counts are screen pixels of the visible part of the stage.
- No production latency was measured. VIEW-11 counts requests only.
- The tall test images are 640 x 3200 and 256 x 8192, which are inside `imageLimits`. A first run with 1280 x 4800 was outside the limits and I replaced it.

## Open questions and items not verified

- I did not read a production comparison record. The size-change case in VIEW-07 is derived from the code path and reproduced with an equal model in the fixture.
- I did not test with a screen reader. VIEW-17 is from the DOM and from ARIA rules.
- I did not measure memory or paint cost at 200% for a 2.1 MP image on a display with device pixel ratio 2.
- I did not verify how often captures differ in size, how many captures are small component clips, or what device scale factor the Ariakit captures use. These facts change the priority of VIEW-08 and VIEW-14.
- Tolerated changes: for an unchanged pair no mask exists (`packages/compare/src/compare.ts:106-108`), and for a locally matched pair the current image is not stored. Is it acceptable that a reviewer cannot inspect tolerated pixels? If not, the storage contract must change, which is outside the viewer.
- The stale pan position after "Retry images" (VIEW-20) is from code reading only.
- In the light theme, the selected variant chip has no visible border while the other chips have one (`02-compare-fit-light-1440.png`). This belongs to the workspace lane. I did not analyze it.
- The mode shortcuts `S`, `D`, `F`, `G` are by key position, not by name. I did not find a statement of this intent in the docs.

## Screenshots

Directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-viewer/screens/`. Each state below exists as four files with the suffixes `-dark-1440.png`, `-light-1440.png`, `-dark-390.png`, `-light-390.png` (state 39 has only the two desktop files). I read the dark desktop files one by one or on a 3-column sheet, and the other combinations on contact sheets, with single reads where a sheet showed something to check.

| File prefix                                | Caption                                                              |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `01-compare-fit-fixture`                   | Compare, Fit, stock fixture (600 x 400 SVG)                          |
| `02-compare-fit`                           | Compare, Fit, 1280 x 720 PNG with a 120 pixel change                 |
| `03-difference-fit`                        | Difference, Fit, real mask format, 12 x 10 block                     |
| `04-difference-fit-line`                   | Difference, Fit, real mask format, 60 x 2 line                       |
| `05-current-fit`                           | Current only, Fit. The image ends under the action bar.              |
| `06-baseline-fit`                          | Baseline only, Fit                                                   |
| `07-compare-100`                           | Compare, 100%, with pan buttons                                      |
| `08-compare-200`                           | Compare, 200%. The change is outside both panes.                     |
| `09-difference-100`                        | Difference, 100%                                                     |
| `10-difference-200`                        | Difference, 200%. The stage is empty.                                |
| `11-current-200`                           | Current only, 200%                                                   |
| `12-difference-fit-large-change`           | Difference, Fit, large change (two lines and a block)                |
| `13-compare-fit-large-change`              | Compare, Fit, large change                                           |
| `14-small-image-compare`                   | 32 x 32 image, Compare, Fit (not enlarged)                           |
| `15-small-image-difference`                | 32 x 32 image, Difference, Fit                                       |
| `16-tall-image-compare`                    | 640 x 3200 image, Compare, Fit (narrow strip)                        |
| `17-tall-image-difference`                 | 640 x 3200 image, Difference, Fit (looks empty)                      |
| `18-tall-image-compare-100`                | 640 x 3200 image, Compare, 100%                                      |
| `19-wide-image-compare`                    | 3200 x 600 image, Compare, Fit                                       |
| `20-size-changed-compare`                  | 1280 x 720 to 1280 x 860, Compare, Fit                               |
| `21-size-changed-difference-server-mask`   | Size change, Difference, legacy server mask (all red)                |
| `22-size-changed-difference-local-no-mask` | Size change, Difference, local engine: wrong "within tolerance" text |
| `23-added-compare`                         | New item without baseline, Compare (left half empty)                 |
| `24-added-current`                         | New item, Current only                                               |
| `25-added-baseline`                        | New item, Baseline only (stage empty)                                |
| `26-added-difference-attempt`              | New item after a click on the disabled Difference button             |
| `27-removed-compare`                       | Removed item, Compare (right half empty)                             |
| `28-tolerated-difference`                  | Unchanged within tolerance, Difference (text only)                   |
| `29-zero-pixels-difference`                | Zero changed pixels, Difference (text only)                          |
| `30-loading`                               | Images loading: status row and two pane texts                        |
| `31-load-error`                            | Load error with "Retry images"                                       |
| `32-dimension-error`                       | Decoded size differs from the record, "Recompare now"                |
| `33-pending-comparison`                    | Comparison still running                                             |
| `34-terminal-failed`                       | Failed comparison                                                    |
| `35-closed-summary`                        | Closed review summary without images                                 |
| `36-local-comparison-compare`              | `?localComparison`, Compare (right half empty)                       |
| `37-local-comparison-current`              | `?localComparison`, Current only (stage empty)                       |
| `38-local-comparison-baseline`             | `?localComparison`, Baseline only                                    |
| `39-keyboard-help`                         | Keyboard help dialog (desktop only)                                  |
| `40-details-open-compare`                  | Compare with the Details sidebar open (427 px panes)                 |

Single files:

| File                                                                   | Caption                                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `41-preview-app-run-dark-1440.png`                                     | Real route on port 4310 with the preview fixture: dark screenshots merge with the dark stage         |
| `42-change-crops-4x-dark-1440.png`                                     | 160 x 100 screen pixels around the 120 pixel change, enlarged 4 times: baseline, current, difference |
| `sheet-dark-1440-rest.png`                                             | Contact sheet: dark desktop states 06, 09, 11, 15, 18, 24, 29, 35, 38                                |
| `sheet-tall-640x3200.png`                                              | Contact sheet: dark desktop states 16, 17, 18 after the size correction                              |
| `sheet-light-1440-a.png`, `sheet-light-1440-b.png`                     | Contact sheets: selected light desktop states                                                        |
| `sheet-dark-390-a.png`, `sheet-dark-390-b.png`, `sheet-dark-390-c.png` | Contact sheets: selected dark phone states at full width                                             |
| `sheet-light-390.png`                                                  | Contact sheet: selected light phone states at full width                                             |
| `all-light-1440-1.png` to `all-light-1440-4.png`                       | Contact sheets: all light desktop states                                                             |
| `all-dark-390-1.png` to `all-dark-390-4.png`                           | Contact sheets: all dark phone states                                                                |
| `all-light-390-1.png` to `all-light-390-4.png`                         | Contact sheets: all light phone states                                                               |

Phone files are full-page captures. The sticky action bar is drawn at the bottom of the first screen (y 757 to 844) in each of them.

## Redesign ideas

The ideas are for the design exploration app. R1 is a base layout. R2 to R10 are viewer designs that differ in how the reviewer finds and judges a change. T1 to T5 are toolbar alternatives. C1 to C7 are component variants. Each design can use the same data that the page has today (two image URLs, one mask URL, sizes, changed pixel count).

### R1 · Stage-first layout

- What changes: The review page becomes a fixed-height grid. One 40 px header row holds back, run title, item name, variant picker, and progress. The stage takes all remaining height. The toolbar floats in the stage. Captions become corner badges on the images. The review actions are one 48 px row.
- Why it is better: At 1440 x 900 the stage grows from 427 visible px to about 810 px of height. Fit means "fits the stage" and nothing is under the action bar. No document scroll, no nested scroll.

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← Queue   Dialog focus styles › Success dialog   [React·Chromium·Light ▾] 3/11 │ 40
├────────────┬──────────────────────────────────────────────────────────────────┤
│ Screenshots│ ╭Baseline 1280×720╮                         ╭Current 1280×720╮   │
│ ▸ Success  │ ┌─────────────────────────────┐ ┌─────────────────────────────┐  │
│   Open menu│ │                             │ │                    ▢1       │  │
│   New item │ │           image             │ │           image             │  │
│            │ └─────────────────────────────┘ └─────────────────────────────┘  │
│            │        ╭ 2-up │ Swipe │ Onion │ Diff ╮ ╭ − 62% + ╮ ╭ ◂ 1/3 ▸ ╮    │
├────────────┴──────────────────────────────────────────────────────────────────┤
│ ↶ Undo   All 7 views ▾                         ✕ Reject  X     ✓ Approve  A   │ 48
└───────────────────────────────────────────────────────────────────────────────┘
```

```tsx
<Shell className="h-dvh grid grid-rows-[auto_minmax(0,1fr)_auto]">
  <ShellMainHeader $height="sm" $border>
    …
  </ShellMainHeader>
  <Layer className="relative min-h-0 ak-layer-darken-2">
    {" "}
    {/* recessed stage */}
    <ViewerLayers />
    <ViewerToolbar className="absolute bottom-3 left-1/2 -translate-x-1/2" />
  </Layer>
  <Frame $border $p={2} role="region" aria-label="Review actions">
    …
  </Frame>
</Shell>
```

### R2 · Swipe (split slider)

- What changes: One stage. The baseline is left of a vertical divider and the current image is right of it. The reviewer drags the divider, or the divider follows the pointer while `Shift` is down. `[` and `]` move it with the keyboard. Labels stay at the two top corners.
- Why it is better: Both images are at full stage size and at the same place. A layout shift shows as a break at the divider. No pan sync problem exists because there is one view.

```text
┌──────────────────────────────────────────────────────────────┐
│ Baseline                         ┃                   Current │
│  Section 1 heading               ┃ ction 1 heading           │
│  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬          ┃▬▬▬▬▬▬▬▬▬                  │
│  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                ⟨┃⟩            [ Continue ] │
│                                  ┃                           │
└──────────────────────────────────┻───────────────────────────┘
        ◂──────────────── drag, or [ and ] ────────────────▸
```

```tsx
<img src={baseline.url} className="absolute inset-0 size-full" />
<img src={current.url} className="absolute inset-0 size-full"
     style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
<Button role="slider" aria-label="Split position" aria-valuenow={split}
        className="absolute inset-y-0 w-0.5 ak-layer-brand cursor-ew-resize"
        style={{ left: `${split}%` }} />
```

### R3 · Onion skin with hold-to-blink

- What changes: One stage with the current image on top of the baseline. An opacity slider (0 to 100) fades the top image. Hold `Space` to show only the baseline; release to show the current image. An "auto blink" toggle swaps each 500 ms. A switch shows the mask as a tint.
- Why it is better: Blink is the fastest way to see small moves and color changes: the eye sees the flicker at the place of change. It works on a phone with press and hold.

```text
┌──────────────────────────────────────────────────────────────┐
│ Current over baseline · 60%                    [hold ␣ = base]│
│                                                              │
│              image (both layers, same place)                 │
│                                                              │
│  Baseline ○━━━━━━━━━━━━●━━━━━━━○ Current    ☐ Blink  ☑ Mask   │
└──────────────────────────────────────────────────────────────┘
```

```tsx
<img src={baseline.url} className="absolute inset-0" />
<img src={current.url} className="absolute inset-0" style={{ opacity: held ? 0 : mix }} />
<img src={mask.url} className="absolute inset-0 mix-blend-multiply" hidden={!showMask} />
```

### R4 · Diff overlay with context, region boxes, and jump to change

- What changes: Difference shows the current image in grayscale at low opacity with the mask on top in a strong color (magenta, adjustable). Each change region has a numbered box with a minimum size of 24 screen pixels. A counter "1 / 3" with previous and next buttons (`N`, `P`) moves and zooms to each region. A summary line says "3 regions · 120 px · largest 12 × 10 at 700, 300".
- Why it is better: The reviewer sees where the change is, on what, and how many places there are, in the first second. A 1 px change is still a visible box. This solves VIEW-01 and VIEW-02 together.

```text
┌──────────────────────────────────────────────────────────────┐
│ Difference · 3 regions · 120 px                    ◂ 1 / 3 ▸ │
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│   ░░ Section 1 heading ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│   ░░░░░░░░░░░░░░░░░░░░░░░░┌──┐1░░░░░░░░░░░░░░┌────────┐2░░   │
│   ░░░░░░░░░░░░░░░░░░░░░░░░│▓▓│░░░░░░░░░░░░░░░│▓▓▓▓▓▓▓▓│░░░   │
│   ░░░░░░░░░░░░░░░░░░░░░░░░└──┘░░░░░░░░░░░░░░░└────────┘░░░   │
└──────────────────────────────────────────────────────────────┘
```

```tsx
{
  regions.map((region, index) => (
    <Button
      key={index}
      $kind="flat"
      aria-label={`Change ${index + 1} of ${regions.length}`}
      className="absolute ring-2 ring-secondary min-w-6 min-h-6"
      style={toStageRect(region, view)}
      onClick={() => zoomTo(region)}
    >
      <Badge $layer="secondary" className="absolute -top-2 -right-2">
        {index + 1}
      </Badge>
    </Button>
  ));
}
```

### R5 · Hotspot crops (change gallery)

- What changes: The default view is not the whole image. It is a list of cards, one for each change region. Each card shows the region with some margin at 2x to 8x: baseline crop, current crop, and the crop with the mask. A small whole-image map on the side shows where each region is. A click on a card opens the full stage at that place.
- Why it is better: For a 120 pixel change the reviewer sees the change large, with no zoom and no pan. Many small changes in a tall image become a short list. Approval can happen from this view.

```text
┌───────────────────────────────────────────────────────┬──────┐
│ 1 · 12×10 at 700,300                                  │ map  │
│ ┌ Baseline ───┐  ┌ Current ────┐  ┌ Difference ──┐    │ ┌──┐ │
│ │             │  │      ▪      │  │      █       │ 6× │ │ ·1│ │
│ └─────────────┘  └─────────────┘  └──────────────┘    │ │   │ │
│ 2 · 160×40 at 1040,286                                │ │ ·2│ │
│ ┌ Baseline ───┐  ┌ Current ────┐  ┌ Difference ──┐    │ │   │ │
│ │ [Continue]  │  │ [        ]  │  │ ████████████ │ 2× │ └──┘ │
│ └─────────────┘  └─────────────┘  └──────────────┘    │      │
└───────────────────────────────────────────────────────┴──────┘
```

```tsx
<Frame $p={3} $border $rounded="lg" className="grid grid-cols-3 gap-3">
  {["baseline", "current", "difference"].map((layer) => (
    <Crop key={layer} layer={layer} region={region} scale={cropScale(region)} />
  ))}
</Frame>
// Crop: a div with overflow hidden and the full image moved by a CSS transform.
```

### R6 · Synchronized 2-up or 3-up with a linked crosshair

- What changes: Keep side by side, but with one shared view. Pan or zoom in one pane moves all panes. A crosshair follows the pointer in all panes. A third pane (Difference with context) can be added on wide windows. The layout picks columns or rows from the image aspect ratio and the stage size.
- Why it is better: It keeps the familiar layout and removes its main defect (VIEW-03). The crosshair gives an exact "same place" reference. Wide images stack top and bottom and use the stage better (see `40-details-open-compare-dark-1440.png`).

```text
landscape stage, landscape images            narrow panes or wide images
┌───────────┬───────────┬───────────┐        ┌─────────────────────────────┐
│ Baseline  │ Difference│ Current   │        │ Baseline          ┼         │
│     ┼     │     ┼     │     ┼     │        ├─────────────────────────────┤
│           │   ▢1      │           │        │ Current           ┼         │
└───────────┴───────────┴───────────┘        └─────────────────────────────┘
        one pan, one zoom, one crosshair
```

```tsx
<div
  className="grid gap-px bg-(--ak-edge)"
  style={{ gridTemplate: stacked ? "repeat(3, 1fr) / 1fr" : "1fr / repeat(3, 1fr)" }}
>
  {layers.map((layer) => (
    <Pane key={layer} layer={layer} view={view} pointer={pointer} />
  ))}
</div>
```

### R7 · Loupe and pixel inspector

- What changes: Hover or keyboard focus on any point shows a round loupe at 8x in both images at the same place. A readout shows the coordinates and the color of the pixel in the baseline and in the current image, with the difference for each channel. A click pins the loupe. `I` toggles the inspector.
- Why it is better: The reviewer can judge sub-pixel and color changes without a zoom level. It answers "is this 1 px of anti-aliasing or a real color change" with numbers.

```text
┌───────────────────────────────┬───────────────────────────────┐
│ Baseline          ╭─────╮     │ Current           ╭─────╮     │
│                   │ ▒▒█ │     │                   │ ▒██ │     │
│                   ╰──┼──╯     │                   ╰──┼──╯     │
├───────────────────────────────┴───────────────────────────────┤
│ x 706  y 305   #F6F7F9 → #DFE6F5   ΔR −23  ΔG −17  ΔB −4      │
└───────────────────────────────────────────────────────────────┘
```

```tsx
const pixel = (data: ImageData, x: number, y: number) =>
  data.data.subarray((y * data.width + x) * 4, (y * data.width + x) * 4 + 4);
<Frame $border $p={2} className="font-mono text-xs tabular-nums">
  <Text>
    x {x} y {y}
  </Text>{" "}
  <Swatch color={before} /> → <Swatch color={after} />
</Frame>;
```

### R8 · Minimap rail for tall and wide images

- What changes: A narrow rail at the side of the stage shows the whole image, the current view rectangle, and a mark for each change region. The stage defaults to "fit width". A click or drag on the rail moves the view.
- Why it is better: Tall captures become readable at once. The reviewer always knows where the view is and where the changes are (VIEW-14 and VIEW-02).

```text
┌─────────────────────────────────────────────────────┬─────┐
│                                                     │ ┌─┐ │
│        stage at fit-width (readable text)           │ │ │ │
│                                                     │ │▣│◂ view
│                                    ▢1               │ │•│◂ change 1
│                                                     │ │ │ │
│                                                     │ │•│◂ change 2
└─────────────────────────────────────────────────────┴─┴─┴─┘
```

```tsx
<aside className="w-16 relative" aria-label="Image map">
  <img src={thumbnail ?? current.url} className="w-full" alt="" />
  <div className="absolute inset-x-0 ring-2 ring-brand" style={viewRect} />
  {regions.map((region) => (
    <span className="absolute size-1.5 rounded-full bg-secondary" style={dot(region)} />
  ))}
</aside>
```

### R9 · Variant matrix (the same hotspot in all variants)

- What changes: For one item, show all variants as a grid of small cards. Each card shows the same region (the first change region, or a region that the reviewer picks) as a blink or swipe crop, with the variant icons and the verdict. Select several cards and approve them together.
- Why it is better: One code change usually changes all variants in the same way. The reviewer checks 7 variants in one look and uses the batch action with evidence on screen.

```text
┌ Success dialog · 7 variants · region 1 ─────────────────────────┐
│ ┌React·Chr·Light┐ ┌Solid·Chr·Light┐ ┌React·Chr·Dark ┐ ┌Firefox ┐ │
│ │   [crop ⇄]    │ │   [crop ⇄]    │ │   [crop ⇄]    │ │[crop ⇄]│ │
│ │ ○ needs review│ │ ○ needs review│ │ ✓ approved    │ │ ○      │ │
│ └───────────────┘ └───────────────┘ └───────────────┘ └────────┘ │
│ ☑ select all changed                      ✕ Reject 6   ✓ Approve 6│
└──────────────────────────────────────────────────────────────────┘
```

### R10 · Phone: single stage with press and hold

- What changes: On narrow screens the stage is one image at fit-width, directly under a one-line header. Press and hold shows the baseline. A two-state switch does the same for assistive technology. Pinch zooms, drag pans. The bottom bar has the mode switch and the two review actions in one row.
- Why it is better: Both images are compared at the same place with no scroll. The first image pixel is near the top of the screen and not at 63% (VIEW-15).

```text
┌──────────────────────────┐
│ ← Success dialog   3/11  │
│ React · Chromium · Light ▾│
├──────────────────────────┤
│                          │
│   image (fit width)      │
│   press and hold =       │
│   baseline               │
│                    ▢1    │
├──────────────────────────┤
│ [Current|Baseline|Diff]  │
│ ✕ Reject      ✓ Approve  │
└──────────────────────────┘
```

### T1 · Floating pill toolbar in the stage

- What changes: One rounded `ButtonGroup` at the bottom center of the stage, icon-only buttons with `Tooltip` and `Kbd`, a zoom stepper, and the change counter. It fades when the pointer is idle.
- Why it is better: No toolbar row above the image (55 px saved), and the controls are next to the pixels.

```tsx
<ButtonGroup
  $rounded="full"
  $p={1}
  $layer
  className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
>
  <Button aria-pressed={mode === "swipe"} aria-keyshortcuts="S">
    <ButtonSlot>
      <SplitIcon />
    </ButtonSlot>
  </Button>
  …
  <ButtonSeparator />
  <Button aria-label="Zoom out">−</Button>
  <ButtonLabel>62%</ButtonLabel>
  <Button aria-label="Zoom in">+</Button>
  <ButtonGlider $rounded="full" />
</ButtonGroup>
```

### T2 · Tabs header on the stage

- What changes: Use the `Tabs` primitive as the stage header: tabs "2-up", "Swipe", "Onion", "Difference", with the image dimensions and size badge in the same row and the zoom control at the right end.
- Why it is better: Correct semantics for exclusive views (tab list with arrow keys), one row in place of two (toolbar and caption), and the labels explain the modes.

```text
┌ 2-up │ Swipe │ Onion │ Difference ─── 1280×720 → 1280×720 ── − 62% + ┐
│                                stage                                 │
```

### T3 · Vertical tool rail

- What changes: A 40 px icon rail at the left edge of the stage, like a design tool: modes at the top, zoom in the middle, inspector and background at the bottom.
- Why it is better: Screens are wide, and the image needs height. The rail costs no vertical space and can hold more tools than a row.

```text
┌──┬───────────────────────────────────────────────┐
│▣ │                                               │
│⇄ │                                               │
│◐ │                    stage                      │
│± │                                               │
│──│                                               │
│＋│                                               │
│－│                                               │
│⌖ │                                               │
└──┴───────────────────────────────────────────────┘
```

### T4 · Status chip with a popover (keyboard first)

- What changes: No toolbar. A small chip in a stage corner shows the state: "Swipe · 62% · change 1/3". A click or `V` opens a `Popover` with all view settings and their keys. Expert users use only the keyboard.
- Why it is better: The lowest amount of interface. It fits the keyboard-driven review loop that the page already has.

```tsx
<PopoverProvider>
  <PopoverDisclosure render={<Button $size="xs" $rounded="full" />}>
    Swipe · 62% · 1/3
  </PopoverDisclosure>
  <Popover>
    <PopoverHeading>View</PopoverHeading>
    {modes.map((entry) => (
      <Button key={entry.id}>
        {entry.label}
        <Kbd>{entry.key}</Kbd>
      </Button>
    ))}
  </Popover>
</PopoverProvider>
```

### T5 · One bottom bar for view and review

- What changes: Merge the view controls into the sticky review bar: Undo and batch on the left, view mode and zoom in the center, Reject and Approve on the right.
- Why it is better: One bar in place of two. All frequent controls are in one place near the bottom, which is also the right place on a phone.

```text
│ ↶ Undo  All 7 ▾ │   2-up  Swipe  Onion  Diff   − 62% +   ◂ 1/3 ▸   │ ✕ Reject  ✓ Approve │
```

### C1 · Zoom control variants

- What changes: Four options to compare in the design app: (a) segmented Fit, 100%, 200% as today; (b) stepper `−`, value, `+` with a preset menu (Fit, Fit width, 50%, 100%, 200%, 400%, 800%, 1:1 device pixels); (c) a slider with snap points; (d) no control, only wheel, pinch, and keys, with the value in the status chip.
- Why it is better: The stepper with presets covers small and tall images (VIEW-14) in the width of the present control.

```text
(a) [ Fit │ 100% │ 200% ]   (b) [ − │ 62% ▾ │ + ]   (c) Fit ○──●────○ 800%   (d) 62%
```

### C2 · Pane label variants

- What changes: Replace the 48 px caption row with a `Badge` on the image corner: role, size, and state. Options: (a) corner badge "Baseline · 1280 × 720"; (b) a thin colored top edge for each role with the label in the toolbar; (c) label only on hover or focus.
- Why it is better: 48 px of height go back to the image for each pane, and the size change can be part of the label.

```tsx
<Badge $rounded="full" $p={2} className="absolute top-2 left-2 text-[11px]">
  <BadgeLabel>Baseline</BadgeLabel>
  <Text className="tabular-nums ak-ink-60">1280 × 720</Text>
</Badge>
```

### C3 · Single-image states (new, removed, matched locally)

- What changes: One full-width image with a state badge and one sentence: "New screenshot. There is no baseline." or "Removed. This is the last baseline." or "Matched locally. The current image is equal within tolerance and was not uploaded." The mode switch is hidden.
- Why it is better: The only image gets the whole stage (VIEW-09), and the state reads as a fact, not as a missing picture.

```text
┌──────────────────────────────────────────────────────────────┐
│ ╭ + New ╮  No baseline. Approve to add it.                   │
│                 ┌──────────────────────────┐                 │
│                 │       the one image      │                 │
│                 └──────────────────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

### C4 · Loading and error inside the stage

- What changes: The stage keeps the exact image box from the known width and height. While loading, it shows the thumbnail (blurred) or a skeleton and a thin `Progress` bar at the top edge of the stage. Errors are a centered card in the stage with a bordered button.
- Why it is better: No layout shift (VIEW-10), one loading signal in place of three, and the recovery action looks like a button.

```tsx
<Frame
  $border
  $rounded="lg"
  $p={4}
  role="alert"
  className="absolute inset-0 m-auto size-fit max-w-sm"
>
  <Text render={<h3 />} className="font-medium">
    The current image did not load
  </Text>
  <Text render={<p />} className="ak-ink-60">
    Check the connection, then try again.
  </Text>
  <Button $border onClick={retry}>
    Retry images
  </Button>
</Frame>
```

### C5 · Size-change banner

- What changes: When the sizes differ, show a warning `Badge` in the stage header ("Size changed · 1280 × 720 → 1280 × 860 · +140 px height"), draw both images at one scale, and hatch the band that exists in only one image.
- Why it is better: The most important fact of that comparison is stated in words and in the picture (VIEW-07, VIEW-08).

```text
┌ Baseline 1280×720 ──────────┐ ┌ Current 1280×860 ───────────┐
│                             │ │                             │
│                             │ │                             │
└─────────────────────────────┘ │╱╱╱╱╱╱╱╱ +140 px ╱╱╱╱╱╱╱╱╱╱╱╱│
                                └─────────────────────────────┘
```

### C6 · Change list panel

- What changes: A collapsible list (in the Details sidebar or under the stage) with one row for each region: index, size, position, pixel count, and a tiny crop. The selected row is the region in view. Use the `Table` or `List` primitive.
- Why it is better: It gives an overview for images with many changes and gives keyboard users a simple way to move between changes.

```text
#  Size      At          Pixels
1  12 × 10   700, 300    120      [crop]
2  160 × 40  1040, 286   6,400    [crop]
3  980 × 4   260, 96     3,920    [crop]
```

### C7 · Mask color and stage background options

- What changes: A small menu for the highlight color (red, magenta, cyan, high-contrast yellow and black) and for the stage background (auto, light, dark, checkerboard under the image only).
- Why it is better: Red on a red UI is not visible, and red and green are hard for many people. A background choice fixes the missing image edge (VIEW-12) for transparent captures.

```tsx
<div
  style={{ background: maskColor, maskImage: `url(${mask.url})`, maskSize: "100% 100%" }}
  className="absolute inset-0"
/>
```
