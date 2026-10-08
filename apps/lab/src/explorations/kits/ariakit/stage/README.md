# Stage (folio kit)

The one stage engine of the review page, and the parts of the variant row that belong to it. The reference surface `image-states` renders the whole stage in each state that a page scenario does not reach.

```tsx
const stored = useStoredView();
const view = useStageView({ variant, mode: stored.mode, expired: review.imagesExpired });

<ChangeLine variant={variant} />
<DetailsButton review={review} item={item} variant={variant} />
<ReviewStage
  variant={variant}
  item={item}
  view={view}
  mode={stored.mode}
  mask={stored.mask}
  gutterBottom={4}
  className="flex-1"
/>
<ReviewBar session={session} view={view} stored={stored} />
```

## Exports

| File                | Export                                           | Use                                                                    |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `view.ts`           | `useStageView`, `StageEngine`                    | The view of one stage. The bar reads its `StageView` part              |
| `stage.tsx`         | `ReviewStage`                                    | The well with the images, the mask, the boxes, the labels and the chip |
| `chip.tsx`          | `StateChip`, `getChipState`, `ChipState`         | The state chip alone, for a place that is not the stage                |
| `summary.tsx`       | `ChangeLine`, `getChangeFacts`, `getChangeProof` | The numbers of a change: `0.19% · 107 px · 1 region`                   |
| `details.tsx`       | `DetailsButton`                                  | The button `Details` with its popover                                  |
| `details-model.ts`  | `getDetails`                                     | The facts of the popover as a pure function                            |
| `cover-picture.tsx` | `CoverPicture`                                   | The picture of one cell of the cover                                   |
| `images.ts`         | `useStageImages`, `StageImages`, `useLoadClock`  | The state of the image requests                                        |
| `model.ts`          | `getStageSubject`, `getStageMode`, `modeNames`   | What a variant can show                                                |
| `canvas.tsx`        | `Picture`, `Tint`, `RegionBoxes`, `ImageLabel`   | The pieces that the stage draws with                                   |

## Rules of the stage

- **One place for both images.** The baseline and the current image share one box, so `F` and `G` change the pixels and nothing else. Two sizes share the top-left corner.
- **Modes.** `new` (current), `original` (baseline), `side` (two panes with one pan and zoom), `swipe`, and `overlay` (the current image at 50% over the baseline). A variant with one image shows that image in every mode. The stored mode does not change: `view.mode` is the mode on screen.
- **The mask lies on the current image.** The switch turns on the tint at 50%, the boxes, and the band of a size change, wherever the current image shows. The baseline is always plain. The color is `diffColor`.
- **Fit.** The whole image, enlarged by whole steps to 200% at most. An image that is taller than 1.5 stages fits the width, at 100% at most, and pans. It opens on its first changed region.
- **Zoom.** The steps are 50, 100, 200, 400, and 800% (`zoomSteps` in `view-types.ts`), with Fit between them. `Fit width` and `Actual pixels` are levels of `setLevel`. The grid of the image pixels shows at 800%. The level stays between variants and screenshots, and the place starts again with each variant. A zoom from an image that shows whole goes to the change.
- **Regions.** A box is at least 24 screen pixels, and boxes that would cross give way. A region of more than 40% of the image gets corner brackets. A click on a box, and `goToRegion` of the bar, zoom by whole steps until the region takes about a third of the stage, at 400% at most.
- **Gestures, no keys.** A drag pans. The wheel pans an image that is larger than the stage. The wheel with Ctrl or Command, and a trackpad pinch, zoom at the pointer. The page binds the keys and calls `stored.setMode`, `stored.setMask`, and the view.
- **`gutterBottom`.** The height that the floating bar covers: a number of rem, or a CSS length. An image that would reach under the bar fits the stage without this height. A smaller image stays in the middle of the full stage.
- **Each fact has one place.** The label at the image has its name and its size. The chip has the state. `ChangeLine` has the numbers of a comparison of pixels, and nothing for a variant that the chip describes. `DetailsButton` has the rest.

## The chip

`getChipState(view.subject, view.images)` gives the state, in this order: a failed request (`Current could not load`, with Retry), a slow request after 6 s (a spinner with Retry), a request that runs for 400 ms (a spinner), then `Images expired`, `Comparing`, `Comparison failed`, `Added`, `Removed`, `No visible change` (CI did not upload the current image), and the size difference (`+2 px`). It is null for one or two loaded images of equal size. The second fact of a chip is in its tooltip, and the chip takes the focus.

The chip is the stock badge at its stock size, as `StatusPill`. The two chips with Retry are one step larger, so that the button has a target of 27 px.

## For the page

- `view.images.failed` names the side whose image did not load. Turn the decisions off while it is not null.
- `view.images.loading` is true while a request runs.
- `view.regionCount`, `view.region`, and `view.goToRegion(1)` are the region stepper of the bar.
- Pass `expired` to `useStageView` for a run whose images are deleted. The stage is then empty with the chip `Images expired`. A stage without an image has no zoom: `view.scale` is null, and `view.canZoomIn` and `view.canZoomOut` are false.
- `useStageView({ images })` takes another state of the requests. The reference surface uses it for a load that does not end.
- The stage takes the room of its parent: give it `flex-1`, or a height.
- A label that lies on pixels (a zoomed image) is a badge. A label gives way to the chip when both are in the top row: it keeps its corner and ends before the chip, without the size when the room is only enough for the name.

## Pitfalls

- The well is a `Frame` with a radius. In a sheet without padding it takes the radius of the sheet.
- `overflow: clip` on a pane keeps the browser from scrolling it when a box takes the focus. Do not change it to `hidden`.
- An image element has a key with its URL and its attempt. Without it, the load event of the earlier image can end the request of the next one.
- The end of an image request is state of the stage (`setRequests` in `images.ts`). The set of the images that the document has shown only answers for a request that the stage did not start, and never in the render that takes over the server markup: the server cannot know it. Without the state, a loaded image stays hidden until the next timer of the load clock, which can be 6 s. Without the hydration rule, a page with two stages of one image fails hydration.
