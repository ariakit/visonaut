SCREENSHOT VIEWER GROUP: SHARED RULES. Each variant spec assumes these rules.

REAL DATA THAT SHAPED THE SCENARIOS

- 78% of real Ariakit screenshots are 416 px wide clips with a median height of 178 px (census of 626 items in the gap-real-data lane: /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-real-data/census/fit-report.out.txt). About 6% are 1248 to 1440 px wide.
- At 1440 x 900 today, 89% show at scale 1 and the median picture covers 24% of its pane. In one stage, 64% can show at 2x.
- So the first scenario of each surface is a small clip, Fit must enlarge small images by whole steps, and a one-stage technique shows most real images at two or three times the size of side by side.

TERMS (ui-copy terminology table)

- screenshot, variant, baseline, current, diff, side by side, added, removed, Retry, images.
- A 'change' is a variant that needs a verdict. A changed place inside one image is a 'region' ('changed region' in tooltips and accessible names). The counter shows `2 / 5` with no word.
- Mode names: `Side by side`, `Diff`, `Swipe`, `Blink`, `Current`, `Baseline`.

ONE KEY MAP FOR THE GROUP (contract keys stay; the others come from the lab hook and from key map C of the gap-contract-map lane)

- S side by side, D diff, F current, G baseline (app today). W swipe, B blink (lab hook).
- H: region marks or diff tint on or off (lab hook: highlight).
- C / Shift+C: next / previous changed region. Key map C used N and P, but the lab hook binds N to 'next that needs review'. C is free in both maps.
- - or =: zoom in. -: zoom out. 0: fit.
- Shift+Arrows: pan all layers. Arrow keys alone keep their meaning (screenshot and variant) from every focus, so decision U04 stays. This needs a Shift branch in the key handler.
- T: hold to show the other image (needs keydown and keyup). Q / E: move the swipe divider. V: open the view popover (one variant). ?: keys.
- Not bound: Space, brackets, Escape as a mode, Cmd/Ctrl+K, digits (they select variants), N, J, K, R.
- A component surface shows several variants in one document. Bind keys with onKeyDown on the focusable root of the variant (tabIndex 0, role group), not on the document, and do not call useReviewShortcuts without a scope.
- Show each key in a Tooltip with a Kbd. Put the key in aria-keyshortcuts, not in the accessible name. Hide the Kbd hints when shortcuts are off.

BUILD RULES

- Stage: Frame $darken (a recessed plain surface). No checkerboard outside the image. Image box: a Frame with $border and $rounded='none', sized from the width and height of the image times the scale; the img fills it. A checkerboard, if any, is under the image only (repeating-conic-gradient with currentColor at 6%).
- One view state (scale, x, y) for all layers and panes of a stage. A zoom keeps the point under the pointer (the stage center for keys). The position stays across modes, and across variants of one screenshot when the sizes are equal. It resets for a new screenshot. On a selection change, cover the old pixels at once (rule A24).
- Fit: contain. An image smaller than half of the stage on both axes is enlarged by whole steps (2x, 3x, 4x) with pixelated rendering. Other images never go above 100% at Fit. If the contained image is narrower than 40% of the stage width, Fit means fit width with vertical pan. Two images with different sizes use one scale and a top-left anchor.
- Diff tint: draw the stored mask as CSS mask-image on a Layer with $layer='danger', so that the color is a theme token. Never show the mask alone: the current image is under it. If mask-image does not work with the fixture SVG, draw the diff img and say so.
- A region mark is at least 24 screen px. A region larger than 40% of the image gets corner brackets, not a full box.
- States and controls overlay the stage or use reserved space. Nothing moves the image when a state changes.
- Motion: one-shot, under 400 ms, and off under prefers-reduced-motion.
- Colors: only $layer names, $mix, $lightnessOffset, $edge, and ak-ink-* classes. Spacing steps and named radii only (w-90 is 22.5em, h-120 is 30em). The only pixel value is the lab-only 390 px device width of a narrow scenario.
- Overlays that must cover the image are painted: Frame or ButtonGroup with $lighten and $border.
- Helper code that several variants share (view state, image box, tint, region mark, counter) must not be in a surface folder, because the registry glob reads every file there as a variant. Use a folder such as src/explorations/shared/viewer/.

FIXTURES

- getScreenshotSet({ scene, scheme }) gives baseline, current, diff, regions, changedPixels, ratio, sizeChanged. useViewer(subject, options) gives mode, zoom, region, highlight, swipePosition, overlayOpacity, and the blink state. brokenImageUrl fails to load. useSimulatedLoad gives a wait. usePreview().theme gives the page theme.
- Fixture images are SVG, so they stay sharp at each zoom. Real PNG images show pixels.
- `regions` and `diffPreview` are not in the API today. A browser can compute regions from the mask, but only after the mask loads.
- Lab-only data is marked in the scenario text (23 synthetic regions; a 160 x 60 image).

EARLIER DECISIONS THAT SOME VARIANTS REOPEN (named in their tradeoffs)

- P02: the diff loads only when Diff is selected ('eager' and 'idle' were rejected). A variant that shows the mask or the regions at first paint reopens it. The mask is then shown evidence and must be in the approval gate (invariant I1).
- A21 and D30: side by side shows a labeled empty pane for an added or removed variant, and such a variant gets no mask.
- A19: zoom is fit, 100%, 200%. K13: S, D, F are modes. A16: the diff is red.
- U04: arrows navigate from every focus, and pan uses buttons. A27 and D53: the narrow layout stacks the images, and phone review is not certified.
- Swipe and overlay were deferred in design r9 ('can follow later if needed'). They were not rejected.

LEAD RECOMMENDATION (the maintainer decides)

- Stage: Diff first, with Linked pair on S. Real screenshots are small, so one stage shows them at 2x to 3x.
- Marks: Outline boxes. Toolbar: Floating pill or Status chip. Zoom: Intent zoom. States: State chip. Summary: One line. Frame: Ring.
