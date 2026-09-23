# E07: Review UI scale

The production review component was measured in desktop Chrome with 3,582, 10,580, and 35,820 synthetic captures. The sidebar renders at most 50 item rows. Navigation, remembered variants, review auto-advance, pending wrap, and Undo still use the complete review model.

## Recorded result

The run started on 2026-09-22 at 08:45:57 UTC. Environment: Chrome 154.0.8037.44, headless desktop, Apple M4 Pro, 14 logical CPUs, 48 GiB RAM, macOS Darwin 25.6.0, Node 24.18.0, 1280 × 900 viewport, and device scale factor 1. The fixture used a production React build and localhost HTTP without CPU or network throttling. This was a developer laptop, not an isolated benchmark machine.

Each size has two excluded mount warmups and 20 measured mounts in fresh browser contexts. Each measured mount warms forward/back navigation, then measures two next-variant and two previous-variant transitions. The next-variant column has 40 samples per size. Percentiles use nearest rank, `ceil(p × n)`.

Values are milliseconds: **p50 / p95 / maximum**. The table is generated from the raw samples in [measurements.json](./measurements.json), without relying on its stored summary fields.

| Captures | Items |               List |        Current images | Cached next variant |
| -------: | ----: | -----------------: | --------------------: | ------------------: |
|    3,582 |   597 | 60.2 / 62.6 / 63.3 | 102.4 / 104.4 / 105.3 |  32.5 / 33.9 / 34.3 |
|   10,580 | 1,764 | 61.9 / 69.4 / 71.1 | 102.3 / 114.9 / 120.7 |  32.5 / 34.1 / 34.6 |
|   35,820 | 5,970 | 64.1 / 65.4 / 65.5 |  92.8 / 112.4 / 113.9 |  32.4 / 34.4 / 34.6 |

No browser page error occurred. Each first page had 441 DOM elements. All measured next-variant transitions added zero resource timing entries. Raw mount samples, excluded warmups, navigation samples, long tasks, environment, and measured source hashes are preserved. The compact JSON omits per-resource records and intermediate phase logs; its `originalArtifactSha256` identifies the original local artifact.

## What the numbers measure

- **List:** from immediately before `createRoot.render` to the second animation frame after a mutation observer sees the expected sidebar row count.
- **Current images:** from render start to the second animation frame after the real component reports `data-evidence="ready"` and its candidate image has loaded at the expected width. The component decodes the required images and checks their dimensions.
- **Cached next variant:** from dispatch of a bubbling `ArrowRight` keyboard event on the focused workspace to the second animation frame after the selected tab changes and its evidence becomes ready. This excludes physical keyboard and Playwright input-dispatch delay.

Two animation frames provide a **paint opportunity proxy**, not a physical display timestamp. Render timings start after the model is fetched and parsed. This evidence does not measure deployed authorization, Workers, D1, R2, review writes, network transfer, or end-to-end production latency. It does not establish a production SLO or a supported capture limit. The separate backend evidence must be assessed on its own.

## Synthetic fixture

Each item has six variants: React with Chromium, Firefox, and WebKit in Light and Dark, at 1280 × 720. The final item can be partial. All captures are changed and pending. Item names cycle through dialog, menu, popover, combobox, select, and tooltip examples. The actual `ReviewWorkspace`, image viewer, CSS, and image-readiness checks run unchanged.

The local server returns deterministic models and PNG images with unique URLs for each capture and role. Originals are 1280 × 720 and 10,273 bytes each. Thumbnails are 160 × 90 and 342 bytes. These simple generated UI-like images do not represent real screenshot transfer sizes or decode complexity. Uncompressed model JSON sizes are 3,156,970; 9,356,222; and 31,972,612 bytes. All model records remain in client memory; sidebar paging only bounds rendered rows.

Before paging, bounded pilots observed a 24,247.2 ms first-image display and 15,412.6 / 15,375.7 ms cached adjacent transitions at 10,580 captures. The 35,820-capture pilot did not reach image readiness within its 120,000 ms wait. These were diagnosis samples, not percentile estimates. The committed measurements contain the final successful run.

## Regression checks and source match

All 36 Chrome browser regressions passed after the final fix. Coverage includes page boundaries, focus, both scroll axes at 800 px width, long item names, remembered variants, auto-advance, Undo, pending wrap, removal of the focused item, and removal of every item. Web TypeScript checks, targeted oxlint, and formatting checks passed.

The only product change after the timed run adds `tabIndex={items.length ? undefined : 0}` to make an empty list focusable during its layout effect. The [hash validation](./empty-focus-validation.json) confirms that removal of this line exactly reproduces the measured item-list source and that the other timed source hashes still match. Nonempty benchmark lists do not take that branch, so performance was not rerun for it. The validation file's `redEvidence` path names an uncommitted local failure artifact; the regression itself is committed in [scale.browser.test.ts](../../../apps/web/src/review/__tests__/scale.browser.test.ts).

## Reproduce

Use the repository's declared Node and pnpm versions, install its locked dependencies, and install Google Chrome. Run these commands from the repository root. The harness uses the web workspace's Vite, React, and Tailwind dependencies. The browser command explicitly supplies Chromium from the root workspace's declared Playwright dependency.

Build and start the local fixture:

```sh
pnpm --filter @ariviso/web exec vite build --config tooling/review-scale/vite.config.mjs
pnpm exec node apps/web/tooling/review-scale/server.mjs
```

In another terminal, collect the default sample:

```sh
pnpm exec node --input-type=module -e '
import { chromium } from "@playwright/test";
import { run } from "./apps/web/tooling/review-scale/run.mjs";
await run(chromium);
'
```

The server binds only `127.0.0.1:4181`. Set `REVIEW_SCALE_PORT` to the same value in both terminals if that port is in use. Results go to ignored `artifacts/review-scale/measurements.json`; `REVIEW_SCALE_OUTPUT` changes that directory. `COUNTS` selects a comma-separated subset of the three fixture sizes. `SAMPLES` and `WARMUPS` change the sample counts. `REVIEW_SCALE_SCREENSHOTS=1` saves optional screenshots in the output directory. The fixture generates PNGs in memory; no image or video binary is needed in the repository.

Regenerate this table from the committed measurements, or pass a result file as the final argument:

```sh
pnpm exec node apps/web/tooling/review-scale/table.mjs
pnpm exec node apps/web/tooling/review-scale/table.mjs artifacts/review-scale/measurements.json
```

Run the review regressions with `pnpm test:browser`. The portable harness build was validated after packaging; that packaging step did not replace the recorded run with new measurements.
