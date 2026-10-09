# Production-shaped data: real run scale, item names, variant matrix, image sizes, and fields that production never sends

Lane `gap-real-data`. Finding prefix `REAL`. Scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-real-data/` (named `SCRATCH` below). Repository paths are relative to `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. Paths that start with `/Users/diegohaz/Developer/ariakit` are the Ariakit consumer (read-only).

Short verdict: the nine UI lanes judged a product that production does not show. A census of the consumer source gives exactly the observed run: 626 items and 3,832 variants. With that data, the current UI shows 9 of 626 list rows, 2 of 6 variant chips, the same image two times for an unchanged item, and a card crop that covers a median of 24% of its pane. Production sends no title, no thumbnail, no display name, and no viewport or style field. The design lab fixtures have all four.

Three things in this report are reusable by the lab task: the census (`SCRATCH/census/inventory.json`), six run answers in the compact wire format (`SCRATCH/data/api/`), and real Ariakit captures with pixelmatch masks (`SCRATCH/data/images/`, `SCRATCH/data/pairs/`).

## How it works (map)

### Sequence: from a test to a list row

1. A test calls the consumer helper `visual()` (`/Users/diegohaz/Developer/ariakit/app/src/test-utils/visual.ts:394-523`). The helper loops over viewports and styles and builds one variant for each combination. The key is a join of seven values (`visual.ts:477-487`):

   ```ts
   key: [framework, testInfo.project.name, viewportName, styleName,
         media.colorScheme, media.contrast, media.forcedColors].filter(Boolean).join("-"),
   dimensions: { project: testInfo.project.name, viewport: viewportName, style: styleName },
   ```

2. 503 of the 626 items come from one helper, `capturePage()` (`/Users/diegohaz/Developer/ariakit/app/src/test-utils/ariakit-ui.ts:114-150`). It takes one full-page capture of a sandbox and crops one region for each example card (`main > article`) with an 8 px margin. The item key is `<sandbox>/page/<slug of the card title>`.
3. The other items are element clips with a 16 px margin (`visual.ts:12`, `:199-201`), overlay clips with a 64 px margin (`ariakit-ui.ts:34`), and viewport captures (`ariakit-ui.ts:95-104`).
4. The Visonaut adapter takes each screenshot at CSS scale (`packages/playwright/src/visual.ts:170`: `scale: options.screenshot?.scale ?? "css"`). So one image pixel is one CSS pixel in all three browsers, also in Safari, where the Playwright device has a device scale factor of 2.
5. The reporter numbers the captures in the order of `suite.allTests()` (`packages/playwright/src/reporter.ts:148`, `:230-234`). The CLI joins the shards in command order and numbers them again (`packages/cli/src/bundles.ts:83-102`; the command is `visonaut submit --shard linux --shard safari`, `/Users/diegohaz/Developer/ariakit/.github/workflows/app.yml:259`).
6. The CLI compares each capture with the accepted reference (`packages/cli/src/local-comparison.ts:209-335`). A new capture is `changed` with `ratio: 1` and no mask (`:245-252`). A capture with the same digest is `unchanged` (`:260-273`). All others go through `comparePixels` (`packages/cli/src/png-comparison.ts:57-102`): pixelmatch with `{ threshold, includeAA: false, diffMask: true }`, and no mask at all when the sizes differ (`:64-66`).
7. The server stores one row only for a changed or removed result (`packages/service/src/local-comparison.ts:172-249`). For an unchanged capture it keeps the reference image as the capture image (`apps/web/src/api/workflow-materialize.ts:303-306`) and it adds the row again at read time (`apps/web/src/api/review-inventory.ts:95-168`). The display name is `capture.name ?? capture.itemKey` (`workflow-materialize.ts:334`). The consumer never passes `name`.
8. `GET /api/runs/:id` builds one variant view for each row (`apps/web/src/api/review.ts:432-553`), builds the label from five variant fields and the key (`:469-482`), and sends the whole model in the compact format (`:616`, `apps/web/src/review/compact-model.ts:30-92`).
9. The client puts every item in one flat list in server order (`apps/web/src/review/item-list.tsx:91-101`), in two groups: attention and "Accepted" (`apps/web/src/review/navigation.ts:34-47`). Rows are virtual with an estimated height of 76 px (`item-list.tsx:348`, `:389`).
10. The variant strip renders one chip for each variant (`apps/web/src/review/review-workspace.tsx:732-780`). A chip shows an icon and a word for each label part, and then the key text in a box of at most 12 rem (`apps/web/src/review/variant-summary.tsx:97-123`).

### Table A1. Item names

Source: `SCRATCH/census/census.mjs` (reads the Ariakit test files and sandbox pages; runs no test). Raw output: `SCRATCH/census/census.out.txt`.

| Fact                                                                                      | Value                                                                                        | Basis                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Items                                                                                     | 626                                                                                          | counted from source. Observed in live-authenticated.md: 626                                                                              |
| Variants                                                                                  | 3,832                                                                                        | counted from source. Observed in live-authenticated.md: 3,832                                                                            |
| Test files that send captures                                                             | 33                                                                                           | counted from source                                                                                                                      |
| Items from a literal `item:` string                                                       | 63 (10%)                                                                                     | counted from source                                                                                                                      |
| Items from a loop in test code (for example `` `ariakit-ui-tabs/forced-colors/${key}` ``) | 60 (10%)                                                                                     | counted from source                                                                                                                      |
| Items from page regions (`capturePage`, one for each example card)                        | 503 (80%)                                                                                    | counted from source: 473 cards in 23 sandboxes, plus 30 cards of `ariakit-ui-list/forced-colors/page`                                    |
| Items from the `previews/${name}` loop                                                    | 3                                                                                            | counted from source (`examples` has 3 previews) and from `GET http://localhost:4321/previews` of a local server                          |
| Families (first path segment)                                                             | 26                                                                                           | counted from source                                                                                                                      |
| Name length in characters                                                                 | minimum 23, median 37, 90th percentile 48, longest 68                                        | counted from source                                                                                                                      |
| Last segment length                                                                       | median 13, 90th percentile 22, longest 43                                                    | counted from source                                                                                                                      |
| Path segments                                                                             | 2 segments: 60 items. 3 segments: 536. 4 segments: 30                                        | counted from source                                                                                                                      |
| Share of all name characters that is the path before the last segment                     | 62.4% (14,929 of 23,925)                                                                     | counted from source                                                                                                                      |
| Second segment values                                                                     | `page` 473, `forced-colors` 60, then 12 values with 1 to 8 items                             | counted from source                                                                                                                      |
| Last segments used by more than one item                                                  | 84 names cover 211 items (`default` 21 times, `on-a-brand-layer` 11 times)                   | counted from source                                                                                                                      |
| Item order in the model                                                                   | test file path, then position of the capture call. Not alphabetical. Removed items come last | estimated from `reporter.ts:148`, `bundles.ts:83-102`, `review-inventory.ts:165-167`, `packages/service/src/local-comparison.ts:228-233` |

The longest name is `ariakit-ui-combobox/page/combobox-select-content-conditional-content`.

Items for each family (counted from source):

| Family                                                | Items   | Variants | Variants per item |
| ----------------------------------------------------- | ------- | -------- | ----------------- |
| ariakit-ui-button                                     | 106     | 604      | 4 to 6            |
| ariakit-ui-list                                       | 60      | 300      | 4 to 6            |
| ariakit-ui-table                                      | 47      | 282      | 6                 |
| ariakit-ui-tabs                                       | 43      | 244      | 4 to 6            |
| ariakit-ui-nav                                        | 38      | 228      | 6                 |
| ariakit-ui-combobox                                   | 37      | 394      | 4 to 12           |
| ariakit-ui-input                                      | 32      | 192      | 6                 |
| ariakit-ui-disclosure                                 | 28      | 168      | 6                 |
| ariakit-ui-checkbox                                   | 27      | 162      | 6                 |
| ariakit-ui-badge                                      | 26      | 152      | 4 to 6            |
| ariakit-ui-progress                                   | 23      | 138      | 6                 |
| ariakit-ui-shell                                      | 23      | 154      | 4 to 12           |
| ariakit-ui-radio                                      | 17      | 102      | 6                 |
| ariakit-ui-link                                       | 14      | 84       | 6                 |
| ariakit-ui-popover                                    | 14      | 82       | 4 to 6            |
| ariakit-ui-dialog                                     | 13      | 78       | 6                 |
| ariakit-ui-code, ariakit-ui-kbd, ariakit-ui-separator | 12 each | 72 each  | 6                 |
| ariakit-ui-tooltip                                    | 11      | 66       | 6                 |
| ariakit-tailwind-7466                                 | 10      | 30       | 3                 |
| ariakit-ui-heading                                    | 10      | 60       | 6                 |
| ariakit-ui-prose                                      | 5       | 30       | 6                 |
| previews                                              | 3       | 48       | 12 to 24          |
| ariakit-ui-text-frame                                 | 2       | 12       | 6                 |
| ariakit-ui-layer                                      | 1       | 6        | 6                 |

The five largest families hold 294 items (47%). 23 of the 26 family names start with `ariakit-ui-`.

### Table A2. Variant axes

All values are counted from source.

| Axis                                   | Sent to the client             | Values (variants)                                        | Changes inside one item                        |
| -------------------------------------- | ------------------------------ | -------------------------------------------------------- | ---------------------------------------------- |
| Browser (`variant.browser`)            | yes, label part `browser`      | chromium 1,316, firefox 1,316, webkit 1,200              | 626 items (100%)                               |
| Color scheme (`variant.colorScheme`)   | yes, label part `colorScheme`  | light 1,946, dark 1,886                                  | 613 items (97.9%)                              |
| Forced colors (`variant.forcedColors`) | yes, label part `forcedColors` | none 3,414, active 418                                   | 29 items (4.6%)                                |
| Contrast (`variant.contrast`)          | yes, label part `contrast`     | no-preference 3,814, more 18                             | 0 items                                        |
| Framework (`variant.framework`)        | yes, label part `framework`    | react 3,820, solid 12                                    | 1 item                                         |
| Project (`dimensions.project`)         | no (only inside the key)       | chrome 1,316, firefox 1,316, safari 1,200                | the same as browser                            |
| Viewport (`dimensions.viewport`)       | no (only inside the key)       | desktop 3,664, wide 66, mobile 36, narrow 36, default 30 | 6 items (1.0%)                                 |
| Style (`dimensions.style`)             | no (only inside the key)       | light 1,901, dark 1,901, default 30                      | 616 items (it follows the color scheme in 613) |

Variants for each item (counted from source; the mean is 6.12, and 3,832 / 626 = 6.12 was observed):

| Variants | Items | Share | Which axes change                                                               |
| -------- | ----- | ----- | ------------------------------------------------------------------------------- |
| 3        | 10    | 1.6%  | browser                                                                         |
| 4        | 58    | 9.3%  | browser (chrome and firefox only) and color scheme. All are forced-colors items |
| 6        | 523   | 83.5% | browser and color scheme                                                        |
| 12       | 34    | 5.4%  | browser, color scheme, and forced colors (29 items) or viewport (5 items)       |
| 24       | 1     | 0.2%  | framework, browser, viewport, and style                                         |

There are 66 distinct variant keys. Key length: minimum 40, median 50, maximum 54 characters. Six keys cover 84% of all variants.

Five real examples, with the exact `key` and the exact `labelParts` that `review.ts:469-482` builds (taken from `SCRATCH/data/api/run.archived-all-accepted.json`):

| Item                                                    | Key                                                     | `labelParts` values in order (framework, browser, colorScheme, contrast, forcedColors, key)            |
| ------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ariakit-ui-button/page/default`                        | `react-chrome-desktop-light-light-no-preference-none`   | react, chromium, light, no-preference, none, `react-chrome-desktop-light-light-no-preference-none`     |
| `ariakit-ui-button/page/default`                        | `react-safari-desktop-dark-dark-no-preference-none`     | react, webkit, dark, no-preference, none, `react-safari-desktop-dark-dark-no-preference-none`          |
| `ariakit-ui-combobox/page/default`                      | `react-chrome-desktop-light-light-no-preference-active` | react, chromium, light, no-preference, active, `react-chrome-desktop-light-light-no-preference-active` |
| `ariakit-tailwind-7466/border-dark-contrast-week-hover` | `react-firefox-default-default-dark-more-none`          | react, firefox, dark, more, none, `react-firefox-default-default-dark-more-none`                       |
| `previews/separator/_component`                         | `solid-firefox-desktop-dark-light-no-preference-none`   | solid, firefox, light, no-preference, none, `solid-firefox-desktop-dark-light-no-preference-none`      |

The `label` is the six values joined with `·`. Note the last row: the style is `dark` but the color scheme is `light`, because the preview test changes one CSS variable and does not emulate the dark scheme (`/Users/diegohaz/Developer/ariakit/app/src/tests/previews-browser.ts:36-40`, `visual.ts:91-94`, `:464-474`).

### Table A3. Image sizes

Sizes come from real captures of a local Ariakit preview server (Chrome, 1280 x 800 viewport, CSS scale, the crop rule of `capturePage`). See M3 for the method and its limits.

| Size class                                                              | Items | Share | Size in pixels                                                                                                    | Basis                                                                                      |
| ----------------------------------------------------------------------- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Card crop, 8 px margin (`capturePage` region)                           | 486   | 77.6% | 416 wide. Height 98 to 640, median 178, 90th percentile 368                                                       | measured: 946 crops of 473 cards                                                           |
| Card clip, 16 px margin (element capture of one card)                   | 69    | 11.0% | 432 wide. Height about 114 to 546                                                                                 | 8 derived from a measured card crop plus 16 px. 61 estimated as a typical card (432 x 152) |
| Small clip (a control group, an overlay with a 64 px margin, a preview) | 19    | 3.0%  | 317 x 80, 345 x 280, 320 x 106                                                                                    | measured for one example of each kind                                                      |
| Wide card crop or clip (the card spans all columns)                     | 24    | 3.8%  | 1248 or 1264 wide. Height 136 to 1,238                                                                            | 15 measured, 9 derived from a measured card crop plus 16 px                                |
| Two-column card crop                                                    | 2     | 0.3%  | 624 wide                                                                                                          | measured                                                                                   |
| Viewport capture, desktop                                               | 13    | 2.1%  | 1280 x 800                                                                                                        | counted from source (exact)                                                                |
| Viewport capture, wide                                                  | 10    | 1.6%  | 1440 x 900 (two of these items also have 560 x 900 variants)                                                      | counted from source (exact)                                                                |
| Viewport capture, narrow                                                | 3     | 0.5%  | 560 x 400                                                                                                         | counted from source (exact)                                                                |
| Full-page capture stored as one image                                   | 0     | 0%    | does not exist                                                                                                    | counted from source                                                                        |
| 390 px wide page capture                                                | 0     | 0%    | does not exist. The `mobile` viewport is used for 3 preview items and 2 combobox items, and all 5 are small clips | counted from source                                                                        |

Other facts:

- Device scale factor: not relevant. Images are in CSS pixels (`packages/playwright/src/visual.ts:170`).
- Largest batch source: 1280 x 5,942 px, 7.6 megapixels, 625 KB (the `ariakit-ui-table` page, dark scheme; measured in Chrome). The consumer limit for a source is 32 megapixels (`visual.ts:21-22`). The source is never stored. Only the crops are.
- Largest stored image: 1248 x 1,238 px, 1.55 megapixels (`ariakit-ui-layer/page/layer-color-values`). The service limit is 2.1 megapixels and 2 MiB (`packages/compare/src/types.ts:9-14`).
- Encoded size: card crops have a median of 11.9 KB and a maximum of 76 KB. Viewport captures have 44 to 172 KB.
- The dark capture of a card is 2 px taller than the light capture for 372 of 473 cards, and 4 to 66 px taller for the other 101. This is not a problem for review, because light and dark are different variants.

### Table B. Field truth table

"Production" means: a run that the Ariakit consumer sends through the local comparison path (`localMode: "local-v1"`), which is the only path for new runs (`docs/current-contract.md:77`).

Run list answer, `GET /api/runs` (`apps/web/src/api/dashboard.ts`):

| Field                                                                                                                    | In production                                                                                              | Proof                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `kind`, `testedSha`, `state`, `attempt`, `createdAt` (number, milliseconds), `comparisonId`, `pending`, `rejected` | always                                                                                                     | `dashboard.ts:121-134`                                                                                                                                                  |
| `pullRequestNumber`                                                                                                      | always for `pull_request` runs, never for `main`                                                           | `dashboard.ts:56`, `:131-132`                                                                                                                                           |
| `title`                                                                                                                  | never, after the webhook is processed                                                                      | `dashboard.ts:57-62` reads `payload_json`; `apps/web/src/api/webhooks.ts:330-335` sets `payload_json = '{}'`. Observed in live-authenticated.md: `#7746 · Pull request` |
| `kind: "merge_group"`                                                                                                    | never from Ariakit today                                                                                   | counted from source: `/Users/diegohaz/Developer/ariakit/.github/workflows/ci.yml:3-7` has only `push` and `pull_request`                                                |
| `state` values                                                                                                           | `incomplete`, `comparing`, `needs-review`, `rejected`, `passed`, `failed`, `superseded`, `needs-recompare` | `packages/service/src/review-status.ts:50-58`, `:76-95`                                                                                                                 |
| `state` of a closed run                                                                                                  | `passed` if the run was accepted, `superseded` for every other closed run                                  | `review-status.ts:77`: `if (!run.active) return empty(run.state === "accepted" ? "passed" : "superseded")`                                                              |
| `actionable`                                                                                                             | open runs that are not passed                                                                              | `dashboard.ts:70-75`, `:139`                                                                                                                                            |
| `project.repository`, `baselineRevision`, `snapshotId`, `promotionId`                                                    | always                                                                                                     | `dashboard.ts:140-145`                                                                                                                                                  |
| Author, branch, commit message, counts by kind, progress, duration, previews                                             | never                                                                                                      | not in `DashboardRun` (`dashboard.ts:12-24`)                                                                                                                            |

Review model, `GET /api/runs/:id` (`apps/web/src/api/review.ts`):

| Field                                                                                                     | In production                                                                 | Proof                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `format: "compact-review-1"`, `images[]`, `metadata[]`                                                    | always                                                                        | `review.ts:616`, `compact-model.ts:91`                                                         |
| `run.id`, `repository`, `kind`, `testedSha`, `attempt`, `status`                                          | always                                                                        | `review.ts:555-572`                                                                            |
| `run.title`                                                                                               | only for pull requests, and always the text `#N · Pull request visual review` | `review.ts:559-563` with `webhooks.ts:330-335`                                                 |
| `run.createdAt`                                                                                           | never                                                                         | no such key in `review.ts:555-576` (the client type has it: `apps/web/src/review/model.ts:79`) |
| `run.error`                                                                                               | only for a failed historical comparison                                       | `review.ts:573-575`                                                                            |
| `archived`, `readOnlyReason`                                                                              | when the run is closed, accepted, historical, or summarized                   | `review.ts:577-588`                                                                            |
| `evidenceState: "summary"`, `imagesExpired`                                                               | only after a closed run is summarized, 30 days after it closed                | `review.ts:242`, `:589-591`; `packages/service/src/work.ts:695`                                |
| `recompareAllowed`                                                                                        | always `false`                                                                | `review.ts:592`                                                                                |
| `recompareDisabledReason`                                                                                 | always, one of three texts                                                    | `review.ts:593-598`                                                                            |
| `historicalComparisons`                                                                                   | always an array; empty for local runs                                         | `review.ts:283`, `:599`; server recompare is retired (`review.ts:986`)                         |
| `comparisonId`, `comparisonState`, `comparisonRevision`, `reviewReady`, `baselineRevision`, `promotionId` | always                                                                        | `review.ts:600-613`                                                                            |
| `preview`                                                                                                 | never                                                                         | not set in `review.ts:554-615`                                                                 |
| `items[].name`                                                                                            | always, and always equal to `items[].key`                                     | `workflow-materialize.ts:334`; the consumer passes no `name` (`visual.ts:345-392`, `:514-518`) |
| `pullRequest`, `counts`, `progress`, `supersededBy`                                                       | never                                                                         | not in the model                                                                               |

Variant fields:

| Field                                                                       | In production                                                                                                                         | Proof                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `key`, `label`, `labelParts`, `kind`, `revision`, `verdict`, `source` | always                                                                                                                                | `review.ts:483-499`                                                                                                                                                                                                                                                      |
| `labelParts` kinds                                                          | `framework`, `browser`, `colorScheme`, `contrast`, `forcedColors`, `key`: all six, always, for Ariakit                                | `review.ts:469-481`; `visual.ts:488-490`                                                                                                                                                                                                                                 |
| `dimensions` (project, viewport, style)                                     | never                                                                                                                                 | `review.ts:469-482` reads five fields and the key. `variant.dimensions` is stored but not read                                                                                                                                                                           |
| `kind` values                                                               | `added`, `removed`, `changed`, `unchanged`. `pending` and `error` only for runs of the retired server engine                          | `review.ts:488-496`; sparse rows are inserted as `'changed'` (`packages/service/src/local-comparison.ts:172-249`, `:318-323`); read-time rows are `unchanged` (`review-inventory.ts:158`)                                                                                |
| `reviewer`                                                                  | only with a human decision. The value is the numeric GitHub user identifier, not the login                                            | `review.ts:500`                                                                                                                                                                                                                                                          |
| `reference`                                                                 | `null` for `added`                                                                                                                    | `review.ts:442-446`, `:501`                                                                                                                                                                                                                                              |
| `candidate`                                                                 | `null` for `removed` and for `candidateOmitted`. For an unchanged capture with equal bytes it is the same image object as `reference` | `review.ts:502`; `workflow-materialize.ts:303-306`                                                                                                                                                                                                                       |
| `candidateOmitted`                                                          | sometimes: unchanged, but the bytes differ                                                                                            | `review.ts:450-454`                                                                                                                                                                                                                                                      |
| `diff`                                                                      | only for `changed` with a mask. `null` when the sizes differ                                                                          | `review.ts:504`; `png-comparison.ts:64-66`                                                                                                                                                                                                                               |
| `thumbnail`                                                                 | never                                                                                                                                 | `review.ts:505-507` needs `result.thumbnailImageId`. The only writers are in the retired engine: `apps/compare/src/process.ts:191`, `:206`, `:228` and `apps/compare/container/transport.ts:207`. The local result has no such field (`workflow-materialize.ts:345-353`) |
| `changedPixels`, `ratio` for `added`                                        | always: all candidate pixels, and `1`                                                                                                 | `packages/cli/src/local-comparison.ts:245-252`                                                                                                                                                                                                                           |
| `changedPixels`, `ratio` for `removed`                                      | never                                                                                                                                 | `packages/service/src/local-comparison.ts:247`: `resultJson: null`                                                                                                                                                                                                       |
| `changedPixels`, `ratio` for `unchanged`                                    | always `0` and `0` for Ariakit, also with `candidateOmitted`                                                                          | `local-comparison.ts` (CLI) `:266-272`; `png-comparison.ts:77-92` with `maxDiffPixels: 0` (`/Users/diegohaz/Developer/ariakit/app/playwright.config.ts:53-56`)                                                                                                           |
| `changedPixels`, `ratio` for a size change                                  | always: all candidate pixels, and `1`                                                                                                 | `png-comparison.ts:64-66`                                                                                                                                                                                                                                                |
| `maskExpected`                                                              | `true` with a mask. `false` for unchanged, added, and size change. Absent for removed                                                 | `workflow-materialize.ts:351`; `review.ts:509-515`                                                                                                                                                                                                                       |
| `engine`, `codec`                                                           | `playwright-pixelmatch-1.63.0`, `pngjs-7.0.0`. Absent for removed                                                                     | `packages/protocol/src/types.ts:130-131`; `review.ts:517-518`                                                                                                                                                                                                            |
| `threshold`                                                                 | always the text `Color threshold 0.2; maximum 0 pixels; ` (it ends with a separator)                                                  | `review.ts:523-526`                                                                                                                                                                                                                                                      |
| `policy`, `referenceProfile`, `candidateProfile`                            | 64-character digests. The profile digest includes the clip, so it differs for each capture                                            | `review.ts:519-532`; `packages/protocol/src/hash.ts:82-95`                                                                                                                                                                                                               |
| `error`                                                                     | only for kind `error`                                                                                                                 | `review.ts:533-537`                                                                                                                                                                                                                                                      |
| `rejectDisabledReason`, `approveDisabledReason`                             | only for summarized runs and runs in the baseline                                                                                     | `review.ts:538-549`                                                                                                                                                                                                                                                      |
| `diffPreview`, `regions`, `reviewerLogin`, `decidedAt`, `axes`              | never                                                                                                                                 | not in `VariantView` (`review.ts:33-63`)                                                                                                                                                                                                                                 |

## Findings

Measurement labels (M1 to M10) refer to the section "Measurements". Screen names refer to files in `SCRATCH/screens/`. All UI measurements use the real route tree of the fixture server on port 4311 with mocked answers (see M6). No request went to production or to GitHub.

### REAL-01 · Viewport and style do not reach the client. They exist only inside the cut key text, so 84 variants in 6 items have chips that read the same

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - The consumer sends three named dimensions: `/Users/diegohaz/Developer/ariakit/app/src/test-utils/visual.ts:491-495`: `dimensions: { project: testInfo.project.name, viewport: viewportName, style: styleName }`.
  - The server builds the label from five fixed fields and the key: `apps/web/src/api/review.ts:470-477`: `["framework", variant.framework], ["browser", variant.browser], ["colorScheme", variant.colorScheme], ["contrast", variant.contrast], ["forcedColors", variant.forcedColors], ["key", row.variant_key]`. It does not read `variant.dimensions`.
  - The chip cuts the key text: `apps/web/src/review/variant-summary.tsx:117`: `className="review-variant-title min-w-0 max-w-48 truncate text-xs"`.
  - M6: the key text gets 144 px of the 317 px that it needs. The visible part is `react-chrome-desktop-…`.
  - M1: in 6 items, two or more variants have five equal label parts and differ only in the key. These groups hold 84 variants.
  - Screens: `22-strip-24-variants-previews-dark-1440.png` (chips 1 and 2 show the same text), `22b-strip-24-variants-previews-scrolled-dark-1440.png` (the picture is dark and every chip says "Light"), `23-strip-12-variants-shell-responsive-dark-1440.png`.
- What happens: `previews/separator/_component` has 24 variants. Chips 1 and 2 both read "React, Chromium, Light, react-chrome-desktop-…". The keys differ after the cut (`…desktop-light-light…` and `…desktop-dark-light…`). In `ariakit-ui-shell/docs-responsive`, the 1440 px capture and the 560 px capture differ only by the words `wide` and `narrow` inside the key. In the three preview items, the `dark` style has the color scheme `light`, so a dark picture has a sun icon and the word "Light".
- Impact: The reviewer cannot tell from a chip which viewport or style it is. The earlier lanes recommend to remove the key text from the chip (COPY-04, WORK-24). With the current answer that removes the only place that has the viewport and the style.
- Recommendation: Send the dimensions as label parts, and let the client show a part only when it differs inside the item.

  ```ts
  // apps/web/src/api/review.ts, after the five fixed parts
  const dimensions =
    variant.dimensions && typeof variant.dimensions === "object" ? object(variant.dimensions) : {};
  for (const [name, value] of Object.entries(dimensions)) {
    if (name === "project") continue; // the browser part has the same information
    if (typeof value === "string") labelParts.push({ kind: "dimension", name, value });
  }
  ```

- Alternatives: (a) Minimal: no server change. Print the key in full on a second line of the chip, or in a tooltip of the upstream `Tooltip` primitive. (b) Consumer side: do not name the style after the color scheme, and set the real color scheme for the `dark` preview style, so that the five fixed parts are enough for 620 of 626 items. (c) Contract change: a typed `viewport` field with `width` and `height` in the adapter.
- Maintainer decision needed: yes. Is `dimensions` a display contract (the UI shows each entry as an axis), or an opaque bag that only makes the key unique?

### REAL-02 · Every item name is its key: a path of 23 to 68 characters. 62% of the characters repeat the family, and a list row takes three lines

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/api/workflow-materialize.ts:334`: `name: capture.name ?? capture.itemKey`.
  - The consumer passes `item` and no `name`: `/Users/diegohaz/Developer/ariakit/app/src/test-utils/visual.ts:359` (`return { item: \`${item}/${region.name}\`, clip: … }`) and `:514-518`.
  - The row prints the name with free wrapping: `apps/web/src/review/item-list.tsx:246-248`: `<ButtonLabel $truncate={false} className="text-xs font-medium wrap-anywhere">{entry.name}</ButtonLabel>`.
  - M1: median 37 characters, 90th percentile 48, longest 68. 62.4% of all name characters are the path before the last segment. 23 of 26 families start with `ariakit-ui-`.
  - M6 (`10-sidebar-all-accepted-dark-1440`): row heights `[76,76,76,76,76,76,76,76,76]`, name lines `[3,3,3,3,3,3,3,3,3]`, row width 201 px, 9 rows fully visible, list height 689 px, list content 44,714 px (65 screens).
  - M6 (`82-items-dialog-all-accepted-dark-390`): on a phone the rows are 60 px (two lines) and 10 rows are visible.
  - Screens: `10-sidebar-all-accepted-dark-1440.png`, `11-sidebar-typical-pr-dark-1440.png` (the name breaks inside a word: `ariakit-ui-button/page/segmente` / `d-control`), `25-heading-longest-name-dark-1440.png` (the heading pushes the Details buttons to a second row and the image starts at 519 px in place of 472 px).
- What happens: The list shows 9 names at a time, and each name starts with the same 23 or so characters. The part that tells two rows apart is the last segment (median 13 characters). The page heading is the same path in 28 px text.
- Impact: The list is the main navigation of a run with 626 items. The earlier lanes measured 44 px rows and 15 visible rows with short fixture names (WORK-23). With real names the list shows 40% fewer rows.
- Recommendation: Split the key in the client. Show the family and the second segment as group headers (REAL-03) and only the last segment in the row, on one line. The consumer can also send a real display name: the card title exists where the region is made, and a batch item accepts `name` (`packages/playwright/src/visual.ts:40-42`).

  ```ts
  // Consumer, /Users/diegohaz/Developer/ariakit/app/src/test-utils/ariakit-ui.ts:140
  regions.push({ name: slugify(title), title, element: box });
  // Consumer, visual.ts:359
  return { item: `${item}/${region.name}`, name: region.title, clip: getRectsClip([clip], 0) };
  ```

- Alternatives: (a) Minimal: one line with truncation in the middle (`ariakit-ui-button/…/thick-focus-ring`) and the full name in a tooltip. (b) Remove the longest prefix that all visible rows share. (c) A tree with three levels (idea 1).
- Maintainer decision needed: yes. Does the display name come from the consumer (`name`), or from a client rule that splits the key?

### REAL-03 · The list is flat and in test-file order: 626 rows, 26 families, one "Accepted (626)" group, and "0 of 6 need review" on every row

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/review/item-list.tsx:91-101` keeps the server order and makes two groups. `apps/web/src/review/navigation.ts:34-47` puts every item without a pending or rejected variant in `accepted`.
  - `item-list.tsx:256`: `` `${pending} of ${entry.variants.length} need review` `` for every row. `:378`: `Accepted ({accepted.length})`.
  - Item order is the order of the test files and of the capture calls (Table A1). Example from `SCRATCH/census/inventory.json`: in `ariakit-ui-table`, `cell-edge/hover` and six more state captures come before the 32 `page/*` cards. In `ariakit-ui-button`, the 16 `forced-colors/*` items come after `shared-edge-hover/*`.
  - M6: the all-accepted run shows the label "Accepted (626)". M8: the text "N of M need review" is on screen 9 times in the all-accepted run, 12 times in the token change, and 11 times in the browser regression.
  - M6 (`13-sidebar-token-change-dark-1440`): 41 changed items make a list of 2,601 px in a 689 px area (3.8 screens). Every row reads "6 of 6 need review".
  - M6 (`11b-sidebar-typical-pr-accepted-open-dark-1440`): with the Accepted group open, the attention list gets 415 px and the accepted list gets 270 px. 3 accepted rows are fully visible.
  - Screens: `10-sidebar-all-accepted-light-1440.png`, `11b-sidebar-typical-pr-accepted-open-dark-1440.png`, `13-sidebar-token-change-dark-1440.png`.
- What happens: The reviewer cannot see which families a run covers, how many items a family has, or that a token change touched 3 families and not the other 23. The word "Accepted" names 626 items that nobody accepted. They are unchanged.
- Impact: For a typical pull request (3 changed items) the list works. For the two other real cases (no changes, and one change in many items) it is a long scroll of rows that look the same.
- Recommendation: Group by family, show counts on the group, open only the groups that have changes, and put no status text on unchanged rows. See ideas 1, 2, and 6.
- Alternatives: (a) Minimal: sort by key, add sticky family headers, and print the status text only when a row has something to review. (b) Name the group "Unchanged (626)" when no item in it has a decision. (c) Show only changed items by default and put all other items behind a link "Browse all 626".
- Maintainer decision needed: yes. Tree, or flat list with headers? Is "Accepted" the right word for unchanged items?

### REAL-04 · Production has no thumbnails. Every row draws an empty "—" tile

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/api/review.ts:505-507` sends `thumbnail` only when the comparison result has `thumbnailImageId`.
  - The only code that writes `thumbnailImageId` is the retired server engine: `apps/compare/src/process.ts:191`, `:206`, `:228` and `apps/compare/container/transport.ts:207`. The local result has `outcome`, `changedPixels`, `ratio`, `engineVersion`, `codecVersion`, `maskExpected`, and `maskImageId` (`apps/web/src/api/workflow-materialize.ts:345-353`).
  - `apps/web/src/review/item-list.tsx:231-244` renders a 26 px slot with `—` when no thumbnail exists.
  - M6: `thumbnails 0`, and `empty slots` equal to the number of mounted rows, in all 40 workspace captures (the phone captures mount no list).
- What happens: Each row starts with a 26 px placeholder and a 12 px gap. That is 38 px of a 201 px row.
- Impact: The names wrap sooner (REAL-02). WORK-23 said that the thumbnail has no information. In production there is no thumbnail at all. A lab variant that puts a thumbnail in each row needs a data source that does not exist today.
- Recommendation: Remove the slot, or give it a real source. The stored images are small enough to use directly for most items: a card crop has a median of 11.9 KB (M2).
- Alternatives: (a) Remove the slot and `itemThumbnail` (`navigation.ts:177-179`). (b) Use the candidate or reference image as a lazy thumbnail for items up to 432 px wide (91.7% of items), and no thumbnail for viewport captures. (c) Show the mask as the preview of a changed item (a mask is 0.3 to 10 KB, M10). (d) Let the CLI make thumbnails. This changes the signed receipt.
- Maintainer decision needed: yes. Are list thumbnails wanted? If yes, from which image?

### REAL-05 · A run with no changes opens as a full review workspace: the same image two times, four read-only statements, and a brand "Approve & next" button

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - M6 (`10-sidebar-all-accepted-dark-1440`): progress text "0 of 3832 need review" with value 3832 of 3832, badge "Unchanged", metric "0.00% changed · 0 changed pixels", first image at 472 px of 900 px.
  - M8: 186 words above the fold. The words "need review" appear 10 times. Four statements say that the run is closed: "A newer attempt is active", "This run is archived. Decisions show the state at archive time and are read-only.", "Comparison superseded", and "A newer attempt replaced this comparison. Its evidence cannot be reviewed."
  - The two panes show the same image object. For an unchanged capture the server keeps the reference image as the capture image (`apps/web/src/api/workflow-materialize.ts:303-306`), so `reference` and `candidate` have the same index in the compact answer.
  - The decision bar renders "All 0 changed views…", "Reject view", and "Approve & next" in the brand fill (disabled).
  - Screens: `10-sidebar-all-accepted-dark-1440.png`, `10-sidebar-all-accepted-light-1440.png`, `81-workspace-all-accepted-dark-390.png` (on a phone the image starts at 744 px of 844 px).
- What happens: The page that live-authenticated.md describes (626 items, all accepted, archived) has nothing to review and nothing to decide. It still renders the list, the strip, the view modes, two copies of one image, and the decision bar. The sentence "Its evidence cannot be reviewed" is directly above the evidence.
- Impact: This is the heaviest page of the product and it is the page with the least to do. A maintainer who opens an old run gets the answer "nothing changed" only by reading small gray text.
- Recommendation: Give a run without reviewable variants its own first state: one sentence, and the families with counts. Open the viewer only when the user selects an item, with one image for an unchanged variant. See idea 2.
- Alternatives: (a) Minimal: when `reference.id === candidate.id`, render one pane with the caption "Unchanged". Hide the decision bar when the run is archived. Keep one of the four statements. (b) Do not send the items of a closed run until the user asks for them. The other audit track owns that cost.
- Maintainer decision needed: yes. What must a closed run, or a run without changes, show first?

### REAL-06 · One status, `superseded`, covers four causes, and the UI says "A newer attempt replaced this comparison" for all of them

- Kind: ux
- Severity: medium. Confidence: high. Measured: no. Effort: M (S for a copy-only change)
- Evidence:
  - `packages/service/src/review-status.ts:77`: `if (!run.active) return empty(run.state === "accepted" ? "passed" : "superseded");`.
  - Cause 1, a new attempt of the same workflow run: `packages/service/src/run-admission.ts:122`: `UPDATE visonaut_runs SET active = 0, state = 'superseded' … WHERE project_id = ? AND external_run_id = ? AND active = 1`.
  - Cause 2, the pull request is closed or merged, or its head changed: `apps/web/src/api/webhooks.ts:316-318` calls `retireRun`, and `packages/service/src/run-retirement.ts:37` sets `active = 0, state = 'superseded'`.
  - Cause 3, a run that never completed: `run-retirement.ts:111` sets `active = 0, state = 'failed'`. The status rule above then returns `superseded`.
  - Cause 4, an old accepted main run after retention: `packages/service/src/retention.ts:100-102` sets `active=0,state='superseded'`.
  - The labels: `apps/web/src/routes/index.tsx:138` ("Replaced by a newer run"), `apps/web/src/review/use-review-session.ts:73-74` ("A newer attempt is active"), `apps/web/src/review/review-workspace.tsx:136-137` ("A newer attempt replaced this comparison. Its evidence cannot be reviewed.").
  - Observed in live-authenticated.md: "Most history rows read 'Replaced by a newer run'; main runs read 'Passed'."
- What happens: A pull request run that was approved and merged is closed by cause 2. From then on it reads "Replaced by a newer run", although no newer run exists. A closed pull request run can never read "Passed", because only a promoted run has the state `accepted`. A run that failed and expired reads the same text.
- Impact: The history cannot answer "what was the result of this pull request?". With no titles (DASH-05), a history page is a column of the same gray badge (screen `72-history-dark-1440.png`).
- Recommendation: Keep the reason and the last review result when a run closes, and send both.

  ```ts
  // packages/service/src/review-status.ts
  type ClosedReason = "replaced" | "pull-request-closed" | "expired" | "baseline-retired";
  // GET /api/runs row: { state: "closed", closedReason, lastStatus: "passed" | "rejected" | "needs-review" | … }
  ```

- Alternatives: (a) Copy only: "Closed" in the history and "This run is closed and read-only." in the workspace. (b) Derive cause 1 in the dashboard query: a closed run is "replaced" only if a newer run with the same `lineage_key` exists.
- Maintainer decision needed: yes. Which closed states must the history tell apart?

### REAL-07 · 89% of production images are card crops that Fit shows at 100%. The picture covers a median of 24% of a Compare pane, and Fit cannot enlarge it

- Kind: ux
- Severity: high. Confidence: high for Chrome sizes, medium for the other two browsers. Measured: yes. Effort: M
- Evidence:
  - Sizes: Table A3 and M2. 574 of 626 items (91.7%) are at most 432 px wide.
  - M4: at 1440 x 900, Fit renders 558 of 626 items (89.1%) at scale 1. The picture covers 16.8% (10th percentile), 23.7% (median), and 54.2% (90th percentile) of one 591 x 504 Compare stage. 322 items (51.4%) cover less than 25%.
  - M6 (`10-sidebar-all-accepted-dark-1440`): a 317 x 80 clip renders at 317 x 80 and covers 8.5% of its stage. In a single-image mode it covers 4.3% of the 1182 x 504 stage (`40-fit-small-clip-current-dark-1440`).
  - M6 (`41-zoom-200-small-clip-compare-dark-1440`): at 200% the 634 px wide image does not fit the 555 px picture area, and the right edge is cut.
  - `apps/web/src/components/screenshot-viewer.tsx:152-153` sets the natural size, and `:162` adds only `max-w-full … max-h-full`. `apps/web/src/review/model.ts:3` allows `"fit" | 1 | 2`.
  - M4: a zoom of 2 fits one Compare pane for 0 items. A zoom of 2 fits one full-width stage (1146 x 468) for 404 items (64.5%), and a zoom of 3 for 13 more.
- What happens: For nine of ten items, Fit, 100%, and "as small as it gets" are the same view: a small picture at the top of a large empty checkerboard, two times. The side-by-side layout is the reason that the picture cannot be larger.
- Impact: This is VIEW-14 as the normal case, not as an edge case. The reviewer must find a 1 px border change in a 416 px picture at 1:1 (see the re-test of VIEW-02).
- Recommendation: Make Fit choose the largest whole-number zoom that fits, with pixelated rendering. Choose the layout from the size class: one stage with a flip or an overlay for crops, side by side for viewport captures. See idea 5.

  ```ts
  // The largest whole-number zoom that fits. Below 1, plain "contain".
  const contain = Math.min(stage.width / image.width, stage.height / image.height);
  const zoom = contain >= 1 ? Math.floor(contain) : contain;
  ```

- Alternatives: (a) Minimal: add 300% and 400%, and center the image at each zoom. (b) Stack the two panes (baseline above current) at full width when the image is wider than it is tall. (c) Keep side by side and make the list collapsible so that each pane gets 700 px.
- Maintainer decision needed: yes. What is the default comparison layout for a small crop: two panes at 1x, or one stage at 2x with a flip?

### REAL-08 · When only Firefox or Safari variants changed, the selected chip is off screen at load, and no other text names the browser

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - M7, scenario `safari-regression` (the two WebKit variants of 12 items changed): the selected chip is number 5 of 6. Its left edge is at 1,624 px. The strip is 1,120 px wide in a 1440 px window and 1,600 px wide in a 1920 px window. `scrollLeft` is 0. The number of text nodes outside the strip that name a browser is 0.
  - `apps/web/src/review/review-workspace.tsx:457` selects the first variant that needs review. `:713-730` renders the strip with `max-w-full` and no code that reveals the selection.
  - M6: chip widths `[413,408,390,388,392,390]`. 2 chips are fully visible.
  - Screen: `14b-safari-regression-selected-chip-off-screen-dark-1440.png`.
- What happens: The page shows the badge "Needs review", a picture, and two chips that say "Chromium · Light" and "Chromium · Dark". Both are unchanged and neither is selected. The picture is the WebKit capture. Nothing on screen says so.
- Impact: A regression in one browser is a main reason to capture three browsers (1,200 of the 3,832 variants are WebKit). WORK-02 found that the selected chip can scroll out of view. With real chip widths that is the first state of this scenario, and of every item where the first pending variant is the third or a later one.
- Recommendation: Replace the strip with a matrix that fits without scroll (idea 3). As a first step, reveal the selected chip and name the selected variant next to the heading.

  ```tsx
  useLayoutEffect(() => {
    document.getElementById(variant.id)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [variant.id]);
  ```

- Alternatives: (a) Put the variants that need review first in the strip. (b) Print "WebKit · Light" as plain text under the item name.
- Maintainer decision needed: no.

### REAL-09 · A direct link to an item far down the list does not bring its row into view

- Kind: bug
- Severity: medium. Confidence: medium. Measured: yes. Effort: S
- Evidence:
  - M7, run with 626 accepted items, entry `/runs/<id>?item=<key>&variant=<key>` for 9 positions. The selected row is fully visible for index 0, 12, and 350. It is outside the 689 px list for index 60, 150, 250, 450, and 550 (the row is 701 to 1,715 px below the top of the list). It is cut for index 625. The result is the same after 8 more seconds.
  - After one click on "Next screenshot" the next row is at 620 to 636 px, so its last 7 to 23 px are cut.
  - `apps/web/src/review/item-list.tsx:141-176` scrolls to the selected row one time for each selection. `:348` and `:389` set `estimatedItemSize={76}`. M6: real row heights are 60, 76, and 92 px.
  - Screen: `15-direct-link-selected-row-out-of-view-dark-1440.png` (the heading is `ariakit-ui-progress/page/ring-with-label`; the list shows `ariakit-ui-popover/…` rows).
- What happens: The page opens on the right item, but the list shows other rows. The probable cause is that the list scrolls with estimated row positions, and the rows then get their real heights. I did not prove the cause.
- Impact: A link to one item (for example from a pull request comment) loses the place in the list. The earlier lanes did not see this, because their lists had 4 to 24 rows.
- Recommendation: Reveal the row again after the list measured its rows, or give all rows one height (one-line rows, REAL-02), so that the estimate is exact.
- Alternatives: (a) Ask the virtual list to scroll to the index, if the renderer has such a call. (b) Group by family (idea 1): the selected group is short and needs no virtual list.
- Maintainer decision needed: no.

### REAL-10 · The search reads variant keys and labels, so a browser, scheme, or framework word matches almost every item

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/item-list.tsx:46-54` searches `item.name`, `item.key`, and for each variant `variant.key`, `variant.label`, and each label part.
  - M6 (`12c-sidebar-search-safari-dark-1440`): the search "safari" gives "Accepted (568)".
  - M9 (the same rule in a script over the 626 items): `dark` matches 619 items (4 have it in the name), `light` 623 (8), `chrome` 626 (0), `firefox` 626 (0), `react` 626 (0), `desktop` 600 (0), `none` 566 (0). Name words work: `hover` 27, `focus` 28, `forced` 60, `ariakit-ui-button` 106.
- What happens: A search for `dark` to find `border-dark-week-hover` returns 619 of 626 items.
- Impact: Words that are both an axis value and a part of a name (`dark`, `light`, `default`, `active`, `contrast`) cannot find names.
- Recommendation: Search names only. Offer the axes as filters that select variants (Browser, Scheme, Forced colors), not as search text.
- Alternatives: (a) A prefix syntax, `browser:safari`. (b) Keep the rule, but list name matches first and say "568 items have a Safari variant".
- Maintainer decision needed: no.

### REAL-11 · The pixel metric line is wrong or empty for four of the five variant kinds that production sends

- Kind: copy
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/review-workspace.tsx:646-647`: `{variant.ratio != null ? (variant.ratio * 100).toFixed(2) + "% changed · " : ""}{variant.changedPixels?.toLocaleString() ?? "—"} changed pixels`.
  - Field values by kind: Table B.
  - M6: added: "100.00% changed · 56,576 changed pixels" (`60-added-item-dark-1440.png`). Removed: "— changed pixels" (`61-removed-item-dark-1440.png`). Size change of 2 px in height: "100.00% changed · 57,408 changed pixels", and the Difference view says "Pixel changes are within the comparison tolerance." (`62-…`, `63-size-changed-difference-dark-1440.png`). Unchanged: "0.00% changed · 0 changed pixels". One changed pixel: "0.00% changed · 1 changed pixels" (`36-difference-1px-region-crop-416x136-fit-dark-1440.png`).
- What happens: The line is correct only for a changed variant with equal sizes and more than about 0.005% changed pixels.
- Impact: It is the only number on the page. VIEW-07 and COPY-08 reported two of these texts. With the production field values the whole set is known.
- Recommendation: Choose the text from the kind.

  ```ts
  const sizeChanged =
    reference &&
    candidate &&
    (reference.width !== candidate.width || reference.height !== candidate.height);
  const metric =
    variant.kind === "added"
      ? "New screenshot"
      : variant.kind === "removed"
        ? "Removed"
        : sizeChanged
          ? `Size ${reference.width} × ${reference.height} → ${candidate.width} × ${candidate.height}`
          : variant.kind === "unchanged"
            ? null
            : `${variant.changedPixels?.toLocaleString()} px changed`;
  ```

- Alternatives: (a) Hide the line unless the kind is `changed` and the sizes are equal. (b) Show "< 0.01%" for small ratios and use the singular for one pixel.
- Maintainer decision needed: no.

### REAL-12 · The design lab fixtures do not have the production shapes. A variant that works with them can fail with real data

- Kind: dx
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence: the gap list in "Measurements", M11. The main differences: the lab "large" run has 120 items and 600 variants with five variants for each item, human names ("Dialog with initial focus"), keys of two segments (`dialog/default`), variant keys such as `react-chromium-light`, a thumbnail for every variant, a pull request title, a mask for a size change, and vector images of 320 x 120 to 1280 x 720. Production has 626 items and 3,832 variants in a 3 x 2 matrix, names equal to keys of three segments, variant keys of 50 characters, no thumbnail, no title, no mask for a size change, and raster crops of 416 px.
- What happens: A lab variant can depend on a field that production does not send (`thumbnail`, `title`, `name`), or on a shape that production does not have (short keys, five loose variants, sharp vector zoom).
- Impact: The maintainer chooses a design in the lab. If the lab data is easier than the real data, the chosen design can fail on the first real run. The two worst cases are list rows (names) and variant pickers (keys and axes).
- Recommendation: Add production-shaped scenarios to the lab from the generated data of this lane (paths in M5). Make one of them the default scenario of the review workspace.
- Alternatives: (a) Minimal: add one scenario, "production: no changes", and one, "production: typical pull request", and mark `thumbnail`, `title`, and `name` in `apps/lab/src/fixtures/types.ts` as "never in production". (b) Keep the lab data and add a check list to `apps/lab/docs/fixtures.md` with the facts of Table B.
- Maintainer decision needed: yes. Must each lab variant pass with production-shaped data before it can be selected?

## Measurements (command, raw result, limits)

All scripts are in `SCRATCH`. They write only there. Run them with plain `node <file>`.

### M1. Census of the consumer source

- Command: `node SCRATCH/census/census.mjs` (output saved in `SCRATCH/census/census.out.txt`, data in `SCRATCH/census/inventory.json`).
- Raw result (first lines):

  ```
  items 626  variants 3832  variants/item 6.12
  observed 626 items, 3832 variants, 6.12 variants/item
  difference items 0  variants 0
  ...
  # variants per item (count -> items)
  3	10	1.6%
  4	58	9.3%
  6	523	83.5%
  12	34	5.4%
  24	1	0.2%
  ...
  # axes that change inside one item (items where the axis has more than one value)
  framework	1	0.2%
  browser	626	100.0%
  colorScheme	613	97.9%
  contrast	0	0.0%
  forcedColors	29	4.6%
  viewport	6	1.0%
  style	616	98.4%
  ```

- Method: The script reads each `ariakit-ui-*/index.react.tsx`, counts the `<Example title="…">` cards (and expands the four `.map()` loops that make cards), and makes the region names with the same `kebabCase` function that the consumer uses. The explicit captures are a hand-made list. Each entry names its test file.
- Limits: The source is the checkout `/Users/diegohaz/Developer/ariakit` at commit `643a23af` (2026-10-05). The item order is an estimate (Playwright project order, then file path, then call position). One assumption: the forced-colors page capture of `ariakit-ui-combobox` also runs in the `safari` project (the file is `test-browser.ts`). The two totals are equal to the observed totals only with this assumption, which supports it. A second check: live-authenticated.md quotes the chip text `react-chrome-default-d…`, and that is the key of the first variant of the first item in the inferred order (`ariakit-tailwind-7466/applied-light-week-hover`).

### M2. Sizes of real card crops

- Command: `node SCRATCH/census/sizes-report.mjs` (output in `SCRATCH/census/sizes-report.out.txt`).
- Raw result:

  ```
  crops 946 (cards x 2 color schemes)
  width -> crops [[416,912],[624,4],[1248,30]]
  narrow crops 912: height min 98 p10 122 median 178 p90 368 max 640
  narrow crops: bytes min 3470 p10 6257 median 11877 p90 26102 max 76203
  wide crops 34: height min 136 p10 171 median 233 p90 600 max 1240
  height buckets of narrow crops
  <= 150	364	39.9%
  151-250	329	36.1%
  251-400	161	17.7%
  401-600	52	5.7%
  601-800	6	0.7%
  light and dark crops of the same card with different sizes
  473 of 473 cards
  full-page batch sources (not stored)
  largest ariakit-ui-table dark: 1280x5942 = 7605760 px, 625205 B
  census region items 473, real cards 473, missing 0
  ```

- Limits: see M3.

### M3. Real captures

- Commands: `node SCRATCH/gen/capture-ariakit.mjs` (all 23 sandboxes, light and dark), then `--variant token --only ariakit-ui-badge,ariakit-ui-kbd,ariakit-ui-prose`, `--variant shift --only ariakit-ui-link`, `--variant weight --only ariakit-ui-button`. `node SCRATCH/gen/capture-extra.mjs` and `node SCRATCH/gen/capture-extra.mjs --changed` (element clips, overlay clips, viewport captures, preview clips).
- Raw result (examples): `baseline ariakit-ui-button light: 85 cards, page 1280x4890, client width 1280, source 1280x4890 452185 B`. `baseline viewport-desktop-1280x800 light: 1280x800 148493 B`. `baseline element-group light: 317x80 3240 B`.
- Method: The scripts open pages of a preview server that already ran on `http://localhost:4321`. I did not start it. Its working directory is `/Users/diegohaz/Developer/ariakit-ui/app` (another checkout of Ariakit, commit `996418ac`, 2026-10-02). The scripts send only GET requests and run no Ariakit test. The crop rule is a copy of `capturePage` (one full-page screenshot at CSS scale, one crop for each `main > article` with an 8 px margin). All 473 cards of the census exist on that server (`missing 0` in M2).
- The "changed" pictures are the same pages with one injected CSS rule: a heavier button label (`weight`), a wider letter spacing of the card titles (`token`), a 1 px move of the card titles (`shift`). `node SCRATCH/gen/probe-css.mjs` chose the rule: `radius: 111 changed pixels in the first viewport`, `weight: 8266`, `padding: 15167`.
- Limits: Chrome only, on macOS. Linux CI can give other text heights, and Firefox and Safari were not captured. The CSS rules are stand-ins for real pull requests. The preview "dark" picture uses the emulated dark scheme, not the one CSS variable that the consumer sets. One element clip (`element-field`) was not captured, because its selector found nothing.

### M4. Fit scale of each production item

- Command: `node SCRATCH/census/fit-report.mjs` (output in `SCRATCH/census/fit-report.out.txt`).
- Raw result:

  ```
  items with a size 626 of 626, measured from a real crop or an exact viewport: 546
  # Fit in Compare at 1440 x 900 (picture area 555 x 468)
  scale 1 (not scaled, not enlarged)	558 (89.1%)	3378 (88.2%)
  scaled down	68 (10.9%)	454 (11.8%)
  scaled below 0.5	47 (7.5%)
  share of one Compare stage that the picture covers: p10 16.8% median 23.7% p90 54.2%
  picture covers less than 25% of its Compare stage	322 (51.4%)
  picture covers less than 50% of its Compare stage	539 (86.1%)
  # whole-number zoom that would still fit one Compare pane
  1x	558 (89.1%)
  2x	0 (0.0%)
  # whole-number zoom that would fit ONE stage (overlay, swipe, or a single image; 1146 x 468)
  1x	146 (23.3%)
  2x	404 (64.5%)
  3x	13 (2.1%)
  scaled down in one stage	63 (10.1%)
  ```

- Method: the picture area is the measured stage (591 x 504 in Compare, 1182 x 504 in the other modes, M6) minus the 18 px padding.
- Limits: 80 items use a class size and not their own measured size. The result is for a 1440 x 900 window.

### M5. Production-shaped data (task C)

- Command: `node SCRATCH/gen/build-data.mjs`.
- Raw result:

  ```
  archived-all-accepted: run 7f761661-… 5231846 B, images 3832, metadata 3832, {"items":626,"variants":3832,"unchanged":3832,"changed":0,…}
  typical-pr: run f2feee98-… 5235585 B, images 3850, {"unchanged":3823,"changed":9,…,"pending":9}
  token-change: run 94773e19-… 5335103 B, images 4324, {"unchanged":3586,"changed":246,…,"pending":246}
  safari-regression: run 378957c3-… 5241827 B, images 3880, {"unchanged":3808,"changed":24,…,"pending":24}
  mixed-kinds: run 4ee29e75-… 5245059 B, images 3871, {"items":627,"variants":3838,"unchanged":3808,"changed":18,"added":6,"removed":6,"sizeChanged":3,"pending":15}
  pixel-probes: run 6cb1c749-… 5265150 B, images 3892, {"items":629,"variants":3850,"changed":21,"candidateOmitted":1,…}
  run list: {"rows":100,"actionable":4,"bytes":29623,"states":{"pull_request:rejected":1,"pull_request:needs-review":3,"pull_request:superseded":87,"main:passed":9},"pullRequests":29}
  ```

- Files, all under `SCRATCH/data/`:

  | File                                                                                                  | Content                                                                                                                                                                                                                     |
  | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `api/run.archived-all-accepted.json`                                                                  | The observed case: 626 items, 3,832 unchanged variants, status `superseded`, `archived: true`                                                                                                                               |
  | `api/run.typical-pr.json`                                                                             | 9 changed variants in 3 `ariakit-ui-button` cards (all 6 variants of one, the 2 WebKit variants of one, 1 Chromium dark variant of one)                                                                                     |
  | `api/run.token-change.json`                                                                           | The same small change in 41 cards of 3 families (badge 24, kbd 12, prose 5) and all their 246 variants                                                                                                                      |
  | `api/run.safari-regression.json`                                                                      | Only the 2 WebKit variants of the 12 `ariakit-ui-link` cards (24 variants)                                                                                                                                                  |
  | `api/run.mixed-kinds.json`                                                                            | Every kind in one run: 6 added (approved automatically), 6 removed, 3 with a size change (no mask), 2 approved by a person, 1 rejected, and 6 changed variants of a 1280 x 800 capture. Status `rejected`                   |
  | `api/run.pixel-probes.json`                                                                           | One item for each size class with a 1 px change, a 2 x 2 px change, and a real change. Three items named `lab-only/*` have sizes that the consumer does not send today                                                      |
  | `api/run.<scenario>.images.json`                                                                      | For each scenario: image identifier to PNG path (relative to `SCRATCH/data/`)                                                                                                                                               |
  | `api/runs.json`, `api/runs.quiet.json`                                                                | `GET /api/runs`: 100 rows without titles (4 open pull request runs, 87 closed attempts of 29 pull requests, 9 main runs), and the same list with no open work                                                               |
  | `api/operations.json`                                                                                 | `GET /api/operations` with one alert and the capacity values of live-authenticated.md                                                                                                                                       |
  | `images/real/baseline/<sandbox>/<slug>.<scheme>.png`                                                  | 946 real card crops                                                                                                                                                                                                         |
  | `images/real/{token,shift,weight}/…`, `images/real/{baseline,changed}/_classes/…`                     | The changed pictures, and the other size classes                                                                                                                                                                            |
  | `images/masks/<scenario>/*.png`                                                                       | Masks from pixelmatch with the options of `comparePixels`                                                                                                                                                                   |
  | `pairs/<class>/{reference,candidate-1px,candidate-2px,candidate-real,mask-*}.png`, `pairs/pairs.json` | One pair for each size class: `element-clip-small` (317 x 80), `region-crop` (416 x 136), `region-crop-wide` (1248 x 348), `page-1280x800`, `page-1440x900`, `page-narrow-560x900`, `mobile-390x844`, `full-page-1280x1640` |
  | `SCRATCH/census/inventory.json`                                                                       | The 626 items with their variants (key, browser, framework, media, dimensions), the capture kind, and the source file                                                                                                       |

- Checks: The app parsed all six run answers without an error (`parseReviewModel`, `apps/web/src/review/client.ts:155-207`), and the 50 captures of M6 recorded 0 console errors. The answer has 5.23 MB. live-authenticated.md records 5.33 and 5.97 MB for the real runs. This is a check of the shape, not a performance result.
- Limits: Identifiers and digests are synthetic. Firefox and Safari variants reuse the Chrome picture. Forced-colors and high-contrast variants reuse the normal light or dark picture. The 123 items that are not page regions use one real picture for each size class (for example, every viewport item shows the same shell page). A removed item keeps its place in the list (in production it comes last). The share of closed attempts in the run list is an estimate.
- How the lab can load a run answer: the file is the compact wire format. `variant.reference`, `candidate`, and `diff` are indexes into `images`, and `variant.metadata` is an index into `metadata` (`apps/web/src/review/compact-model.ts:12-27`).

### M6. The current UI with this data (task D)

- Command: `node SCRATCH/ui/capture.mjs` (screenshots in `SCRATCH/screens/`, raw values in `SCRATCH/ui/measurements.json`, a readable form in `SCRATCH/ui/measurements.txt` from `node SCRATCH/ui/report-measurements.mjs`).
- Method: Playwright opens `http://127.0.0.1:4311/src/review/__tests__/route-fixture.html?entry=<path>`. `page.route` answers `/api/runs`, `/api/runs/:id`, `/api/runs/:id/state`, `/api/operations`, and `/images/:id` from the files of M5 (`SCRATCH/ui/harness.mjs`). Window 1440 x 900, or 390 x 844 with touch. Device scale factor 1.
- Raw results:

  | Measure                              | Result                                                                                                                                                                      |
  | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Chip widths, 3 variants              | `[413,390,392]`. Strip content 1,215 px in 1,120 px. 2 chips fully visible                                                                                                  |
  | Chip widths, 6 variants              | `[413,408,390,388,392,390]`. Strip content 2,420 px. 2 fully visible                                                                                                        |
  | Chip widths, 12 variants             | `[413,408,390,388,390,388,362,360,384,382,364,362]`. Strip content 4,666 px (4,783 px for the item with two viewports). 2 fully visible                                     |
  | Chip widths, 24 variants             | 377 to 413 px. Strip content 9,484 px. 2 fully visible                                                                                                                      |
  | Key text in a chip                   | 144 px shown of 317 px needed                                                                                                                                               |
  | Accessible name of a chip            | `1. react · chromium · light · no-preference · none · react-chrome-desktop-light-light-no-preference-none. Needs review`                                                    |
  | List rows fully visible              | 9 (626 accepted), 3 (typical pull request), 10 (token change), 9 (browser regression), 10 (search `ariakit-ui-button`, 106 results), 8 (search `forced-colors`, 60 results) |
  | Row height                           | 60 px (2 name lines), 76 px (3 lines), 92 px (4 lines). Row width 201 to 215 px                                                                                             |
  | List content height, 626 rows        | 44,714 px in a 689 px area                                                                                                                                                  |
  | Small clip (317 x 80) at Fit         | 317 x 80 px, scale 1. 8.5% of the Compare stage, 4.3% of the single stage                                                                                                   |
  | Card crop (416 x 136) at Fit         | scale 1. 19% of the Compare stage, 9.5% of the single stage                                                                                                                 |
  | Viewport capture (1280 x 800) at Fit | scale 0.433 in Compare (64.6% of the stage), 0.585 in Difference                                                                                                            |
  | Wide card (1248 x 348) at Fit        | scale 0.444 in Compare (28.8%)                                                                                                                                              |
  | Largest card (1248 x 1,238) at Fit   | scale 0.378 in Compare                                                                                                                                                      |
  | Progress at the start                | typical pull request: 3,823 of 3,832 = 99.77%. Token change: 93.58%. Browser regression: 99.37%. Run with a rejected variant: 99.61%. No changes: 100%                      |
  | Words above the fold                 | 186 (626 accepted), 114 (typical pull request), 175 (token change), 168 (browser regression), 185 (details panel open), 62 (phone, typical pull request)                    |
  | First image starts at                | 390 px (typical pull request), 472 px (archived run), 519 px (longest name), 415 px (added or removed). Phone: 538 px, and 744 px for the archived run                      |
  | Queue                                | 4 cards of 240 px, the first at 361 px, page height 1,439 px, 83 words above the fold                                                                                       |
  | History                              | 100 rows of 64 px, 9 in the first screen, page height 6,763 px. Phone: rows of 99 px, 4 in the first screen, 10,362 px                                                      |

- Limits: headless Chrome with the fonts of this machine (the app ships no font, PRIM-16). The fixture page is the real route tree, but not the deployed Worker. Widths can differ by a few pixels in another browser.

### M7. Probes: selection in view, and the screen size of small changes

- Commands: `node SCRATCH/ui/probes.mjs` (raw values in `SCRATCH/ui/probes.json`) and `node SCRATCH/ui/probe-reveal-time.mjs`.
- Raw result, direct link to an item in the run with 626 items:

  ```
  index 0    fully visible true   row top 0     scrollTop 0/44714
  index 12   fully visible true   row top 613   scrollTop 251/43820
  index 60   fully visible false  row top 701   scrollTop 3680/45849
  index 150  fully visible false  row top 1000  scrollTop 10108/46324
  index 250  fully visible false  row top 873   scrollTop 17251/45385
  index 350  fully visible true   row top 492   scrollTop 24394/44571
  index 450  fully visible false  row top 1614  scrollTop 31537/46110
  index 550  fully visible false  row top 1715  scrollTop 38680/45973
  index 625  fully visible false  partly true   row top 658
  index 450 after +5000 ms {"fullyVisible":false,"rowTop":1614,"listHeight":689,"scrollTop":31537}
  index 450 after Next     {"fullyVisible":false,"rowTop":636,"listHeight":689,"scrollTop":32614}
  ```

  40 clicks on "Next screenshot" from the first item keep the row fully visible (5 samples).

- Raw result, selected chip in the browser regression scenario:

  ```
  1440: {"index":5,"chips":6,"fullyVisible":false,"partlyVisible":false,"chipLeft":1624,"stripWidth":1120,"scrollLeft":0,"browserWordsOutsideStrip":0}
  1920: {"index":5,"chips":6,"fullyVisible":false,"partlyVisible":false,"chipLeft":1624,"stripWidth":1600,"scrollLeft":0,"browserWordsOutsideStrip":0}
  ```

- Raw result, red screen pixels in the Difference view at Fit, 1440 x 900 ("strong": red above 200 and green and blue below 60; "faint": red at least 40 above green and blue):

  | Size class                        | Scale in Compare | Scale in Difference | 1 px change (strong, faint)     | 2 x 2 px change (strong, faint) | Real change                      |
  | --------------------------------- | ---------------- | ------------------- | ------------------------------- | ------------------------------- | -------------------------------- |
  | Small clip, 317 x 80              | 1                | 1                   | 1, 0                            | 4, 0                            | 249 changed pixels: 249, 0       |
  | Card crop, 416 x 136              | 1                | 1                   | 1, 0                            | 4, 0                            | 107 changed pixels: 107, 0       |
  | Wide card, 1248 x 348             | 0.444            | 0.918               | 1, 0                            | 3, 1                            | not made                         |
  | Viewport, 1280 x 800              | 0.433            | 0.585               | 0, 1                            | 1, 0                            | 3,898 changed pixels: 517, 1,270 |
  | Viewport, 1440 x 900              | 0.385            | 0.520               | under the threshold, so no mask | 0, 1                            | 3,898 changed pixels: 377, 1,390 |
  | Narrow page, 560 x 900 (lab only) | 0.520            | 0.520               | 0, 1                            | 1, 0                            | 2,296 changed pixels: 165, 935   |
  | Phone page, 390 x 844 (lab only)  | 0.555            | 0.555               | 0, 1                            | 1, 0                            | 1,763 changed pixels: 211, 674   |
  | Full page, 1280 x 1640 (lab only) | 0.285            | 0.285               | 0, 0                            | 0, 1                            | not made                         |

  In Compare there is no red. A 1 px change at scale 0.433 covers 0.19 of a screen pixel (computed).

- Limits: The 1 px and 2 x 2 px changes are at the center of the picture, in black or white. A change with less contrast is weaker. The reveal result comes from the fixture page.

### M8. Text above the fold

- Command: `node SCRATCH/ui/probe-text.mjs` (raw values in `SCRATCH/ui/probe-text.json`).
- Raw result:

  ```
  archived-all-accepted: words {"total":186,"sidebar":73,"main":104,"header":9} | "need(s) review" 10 | "N of M need review" 9 | read-only statements 4 | family prefixes on screen 11 | sidebar name characters 466, of which path prefix 220
  typical-pr: words {"total":114,"sidebar":29,"main":76,"header":9} | "need(s) review" 6 | "N of M need review" 3 | read-only statements 0
  token-change: words {"total":175,"sidebar":90,"main":76,"header":9} | "need(s) review" 15 | "N of M need review" 12
  safari-regression: words {"total":168,"sidebar":83,"main":76,"header":9} | "need(s) review" 14 | "N of M need review" 11
  ```

- Limits: A "word" is a run of characters without a space, so a path counts as one word. Text in `title` attributes and in screen-reader-only elements is not counted.

### M9. Search matches

- Command: `node SCRATCH/ui/search-matches.mjs` (the rule of `item-list.tsx:45-64` over the 626 items).
- Raw result:

  ```
  dark     search matches  619 | in the item name    4
  light    search matches  623 | in the item name    8
  safari   search matches  568 | in the item name    0
  chrome   search matches  626 | in the item name    0
  desktop  search matches  600 | in the item name    0
  none     search matches  566 | in the item name    0
  default  search matches   38 | in the item name   28
  active   search matches   90 | in the item name    1
  hover    search matches   27 | in the item name   27
  ```

- The UI gives the same count for `safari`: "Accepted (568)" (`12c-sidebar-search-safari-dark-1440.png`).

### M10. Mask format

- Command: `node SCRATCH/gen/mask-format.mjs`.
- Raw result (distinct RGBA values and their pixel counts):

  ```
  region-crop/mask-real.png 416x136 [["0,0,0,0",56469],["255,0,0,255",107]] 511 B
  page-1280x800/mask-real.png 1280x800 [["0,0,0,0",1020102],["255,0,0,255",3898]] 9837 B
  region-crop/mask-1px.png 416x136 [["0,0,0,0",56575],["255,0,0,255",1]] 303 B
  ```

- The masks come from `pixelmatch` 5.3.0 with `{ threshold: 0.2, includeAA: false, diffMask: true }`, the options of `packages/cli/src/png-comparison.ts:68-75`. The red pixel count is equal to `changedPixels`.

### M11. Lab fixture gap list (task F)

Source: `apps/lab/docs/fixtures.md`, `apps/lab/src/fixtures/types.ts`, `apps/lab/src/fixtures/data/review-builder.ts`, `apps/lab/src/fixtures/data/review.ts`, `apps/lab/src/fixtures/data/runs.ts`. I read these files. I did not run the lab and I did not change it.

Fields and shapes that differ:

| Lab                                                                                                      | Production                                                                                                                                                              | Proof                                    |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| "large" run: 120 items, 600 variants (`fixtures.md:74`)                                                  | 626 items, 3,832 variants                                                                                                                                               | Table A1                                 |
| 5 variants for each item: React Chromium light, dark, Firefox, WebKit, Solid (`review.ts:178`)           | 6 for 83.5% of items, as a full 3 browsers x 2 schemes matrix. Solid in 1 item of 626                                                                                   | Table A2                                 |
| Item key `dialog/default`, 2 segments, 20 components x 6 examples (`review.ts:142-173`, `:201`)          | `ariakit-ui-button/page/default`, 3 segments, median 37 characters, 26 families of 1 to 106 items                                                                       | Table A1                                 |
| Item name "Dialog with initial focus" (`review.ts:32`)                                                   | The name is the key                                                                                                                                                     | Table B                                  |
| Variant key `react-chromium-light` (`review-builder.ts:97-106`)                                          | `react-chrome-desktop-light-light-no-preference-none`: the project name (`chrome`, `safari`), the viewport, the style, and all three media values. Median 50 characters | Table A2                                 |
| `axes` has framework, browser, color scheme, contrast, forced colors (`types.ts:291-297`)                | The same five reach the client. Viewport (5 values) and style (3 values) exist but are not sent                                                                         | REAL-01                                  |
| `thumbnail` on every variant (`review-builder.ts:219`, `:239`)                                           | never                                                                                                                                                                   | REAL-04                                  |
| Added variant: no `changedPixels`, no `ratio` (`review-builder.ts:157-159`)                              | `changedPixels` = all pixels, `ratio` = 1, `maskExpected: false`                                                                                                        | Table B                                  |
| Size change: "the mask marks every pixel and `ratio` is 1" (`fixtures.md:119`)                           | `ratio` is 1, but there is no mask and `diff` is `null`. The full red mask is the retired server engine (`packages/compare/src/compare.ts:110-119`)                     | `png-comparison.ts:64-66`                |
| `candidateOmitted` with 2 to 9 changed pixels (`review-builder.ts:164-172`)                              | `changedPixels` is 0, because the consumer allows 0 different pixels                                                                                                    | Table B                                  |
| `engine: "rgba-visible-1"`, `codec: "jsquash-png-3.1.1-webp-1.5.0"` (`review-builder.ts:82-83`)          | `playwright-pixelmatch-1.63.0`, `pngjs-7.0.0`                                                                                                                           | `packages/protocol/src/types.ts:130-131` |
| `threshold: "Color threshold 0.2; maximum 0 pixels; ratio 0"` (`review-builder.ts:85`)                   | `Color threshold 0.2; maximum 0 pixels; `                                                                                                                               | `review.ts:523-526`                      |
| Disabled reasons on each variant of a read-only run (`review-builder.ts:248-253`)                        | Only on summarized runs and runs in the baseline. A closed attempt has `archived` and `readOnlyReason` on the model only                                                | `review.ts:538-549`                      |
| Run title "#4863 · <pull request title>" (`review-builder.ts:375`), `Run.title` (`types.ts:99-100`)      | Review title is always `#N · Pull request visual review`. The run list has no title                                                                                     | DASH-05, Table B                         |
| Images are vector data URIs, sharp at every zoom (`fixtures.md:105`)                                     | PNG files in CSS pixels. Zoom shows pixels                                                                                                                              | Table A3                                 |
| Scene sizes 320 x 120, 640 x 400, 1280 x 720, 800 x 1600 (`fixtures.md:141-156`)                         | 416 px wide cards (77.6%), 432 px clips (11%), 1280 x 800 and 1440 x 900 viewports. No 1280 x 720, no tall page                                                         | Table A3                                 |
| The mask is made in the browser with a blend mode and a filter (`fixtures.md:117`)                       | pixelmatch without anti-aliased pixels: thin fragments of glyph edges                                                                                                   | M10, screen `31-…`                       |
| History: 40 runs, one earlier attempt for 30% of the pull requests, merge queue runs (`runs.ts:280-335`) | 100 rows. Most are closed attempts with the label "Replaced by a newer run". No merge queue runs from Ariakit                                                           | live-authenticated.md, Table B           |
| No `recompareAllowed` field (`types.ts:397-437`)                                                         | Always `false` with a reason. Correct to leave out, because the control is dead (COPY-01, WORK-18)                                                                      | `review.ts:592-598`                      |

Production cases that the lab has no scenario for:

1. A run with 626 items and no change, closed and read-only (the observed case). The lab "passed" scenario is the 12-item run with every change approved.
2. A run with 3,832 variants and 9 changes, where 99.8% of the content is not work.
3. One small change in 41 items of 3 families (246 variants with the same kind of change).
4. A regression in one browser only, where the first variant to review is the fifth of six.
5. Items with 12 and 24 variants that differ by forced colors, viewport, or style.
6. Real names: keys as names, with a shared prefix and a long last segment.
7. Small card crops as the normal image, and real raster masks.
8. No titles in the queue and in the history.
9. A history where one pull request has up to five closed attempts.
10. A size change of 2 px with no mask and the metric "100% changed".
11. Review data where `reference` and `candidate` are the same image object.

The data for all of these cases is in `SCRATCH/data/` (M5). Do not copy the 5 MB answers into the lab bundle as they are. A lab builder can make them from `SCRATCH/census/inventory.json` (1.5 MB as written; it has only 626 item keys and 66 distinct variant keys, so a builder can be small) and the picture folders.

### M12. Re-test of the earlier findings (task E)

| Earlier finding                                                                      | Result                                                    | New numbers with production-shaped data                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COPY-04: variant labels repeat every part; the accessible name is a raw token string | holds                                                     | Chips are 388 to 413 px for the six common variants. 2 of 6 fit. The accessible name is `1. react · chromium · light · no-preference · none · react-chrome-desktop-light-light-no-preference-none. Needs review`. Correction: 84% of the variants have a key with `desktop-light-light` or `desktop-dark-dark`, not `default-default`. Correction to the recommendation: the key text cannot go before the server sends viewport and style (REAL-01) |
| WORK-13: status and counts in up to 11 places; "need review" 6 times; 145 words      | changes                                                   | 186 words and 10 times "need review" on the observed run. 114 words and 6 times on a typical pull request. 175 words and 15 times on a token change                                                                                                                                                                                                                                                                                                  |
| WORK-14: the progress bar is full on a rejected run and starts almost full           | holds, now measured                                       | Typical pull request: 99.77% at the start (the earlier value, 99.4%, was computed for a guessed run). The 9 pending variants are 0.15 px of the 64 px bar. Token change: 93.58%. A run with a rejected variant: 99.61% and green                                                                                                                                                                                                                     |
| WORK-23: a 26 px thumbnail; 44 px rows; 15 rows visible                              | changes                                                   | No thumbnail exists (REAL-04). Rows are 60 to 92 px. 9 rows are visible. 626 rows are 44,714 px. An unchanged row says "0 of 6 need review"                                                                                                                                                                                                                                                                                                          |
| WORK-24: chips are 265 to 307 px; 12 variants need about 3,500 px                    | changes                                                   | Chips are 360 to 413 px. 6 variants need 2,420 px, 12 need 4,666 to 4,783 px, 24 need 9,484 px                                                                                                                                                                                                                                                                                                                                                       |
| VIEW-01: Difference shows the mask alone                                             | holds                                                     | A real mask is a few thin red fragments on an empty stage: 107 red pixels for a card crop, 249 for a small clip, 518 strong red screen pixels for a viewport capture. No picture and no image edge (`31-…`, `33-…`, `35-…`)                                                                                                                                                                                                                          |
| VIEW-02: a small change is a few screen pixels (scale 0.43)                          | changes                                                   | The scale 0.43 applies to 10.9% of the items. For 89.1% the scale is 1: a 1 px change is 1 screen pixel and a 2 x 2 px change is 4. On a 1280 x 800 capture a 1 px change gives 0 strong red pixels. At 1280 x 1640 it gives none at all. Real changes are small: the median is 107, 246, and 266 changed pixels in the three change scenarios (M7)                                                                                                  |
| VIEW-08: images with different sizes get different scales                            | does not hold for 89% of the items; the second half holds | Card crops render at scale 1, so the two scales are equal. A real size change is small (2 px). The only signs are the captions `416 × 136` and `416 × 138` in 10 px text. The metric says "100.00% changed" (REAL-11)                                                                                                                                                                                                                                |
| VIEW-09: added, removed, and locally matched variants keep an empty pane             | holds for added and removed; changes for unchanged        | An unchanged variant with equal bytes shows the same image two times (REAL-05). The empty pane "New image not uploaded" is only for an unchanged variant whose bytes differ under the threshold (`65-…`). Its rate in production is not known                                                                                                                                                                                                        |
| VIEW-14: Fit never enlarges small images and squeezes tall images                    | holds, and it is the normal case                          | 89.1% of the items are at scale 1 and cover a median of 23.7% of a pane (REAL-07). The tall cases of the earlier lane (640 x 3200, 256 x 8192) do not exist: no full page is stored, and the tallest shape is 560 x 900                                                                                                                                                                                                                              |
| DASH-05: pull request titles are erased                                              | holds                                                     | All four queue cards have the heading "Pull request". History rows read `#7754 · Pull request`. The workspace title is `#7751 · Pull request visual review`                                                                                                                                                                                                                                                                                          |
| DASH-08: cards are 240 px tall                                                       | holds                                                     | 240 px cards, the first at 361 px, 4 runs make 1,439 px. The history has 64 px rows, 9 in the first screen, 6,763 px for 100 rows. The number of open runs on a normal day is still not known                                                                                                                                                                                                                                                        |
| DASH-13: the kind is printed twice; nothing links to GitHub                          | holds                                                     | A card reads `#7754`, then "Pull request". In the generated history, 91 of 100 rows are attempts of 29 pull requests, and 87 read "Replaced by a newer run" (an estimate that follows live-authenticated.md; see REAL-06)                                                                                                                                                                                                                            |
| BENCH-05: the strip hides the verdict and holds three variants                       | changes                                                   | The strip holds 2 variants. The verdict part holds: an approved, a rejected, and a pending chip look the same (`64-…`)                                                                                                                                                                                                                                                                                                                               |
| PRIM-19: 7 variants need 2,079 px in a 1,120 px strip; shortcuts cover six variants  | changes                                                   | 6 variants need 2,420 px. The keys 1 to 6 reach every variant for 591 items (94.4%); 35 items have 12 or 24 variants. New: the selected chip is off screen at load in the browser regression scenario (REAL-08)                                                                                                                                                                                                                                      |

## Screenshots

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-real-data/screens/`. I opened and read each one. Names end with the scheme and the window width. The pictures inside the viewer are real Ariakit captures (M3).

| File                                                           | Caption                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-smoke-archived-all-accepted-dark-1440.png`                 | First check that the app parses the generated answer. The same state as `10-…`.                                                                                                                                                                                                  |
| `00-smoke-typical-pr-dark-1440.png`                            | First check of the typical pull request. The same state as `11-…`.                                                                                                                                                                                                               |
| `10-sidebar-all-accepted-dark-1440.png`                        | The observed case: 626 accepted items. 9 rows are visible. Each name takes three lines and starts with `ariakit-tailwind-7466/`. Each row has an empty "—" tile and the text "0 of 3 need review". Two copies of one 317 x 80 image. Three sentences say that the run is closed. |
| `10-sidebar-all-accepted-light-1440.png`                       | The same in the light scheme. The selected row is almost not visible.                                                                                                                                                                                                            |
| `11-sidebar-typical-pr-dark-1440.png`                          | Typical pull request: 3 rows in the list, then empty space, then "Accepted (623)" closed at the bottom. "9 of 3832 need review" and a full green bar. Two of six chips are visible. The bold "Cancel" is the change.                                                             |
| `11-sidebar-typical-pr-light-1440.png`                         | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `11b-sidebar-typical-pr-accepted-open-dark-1440.png`           | The Accepted group is open. It gets 270 px: 3 rows of 623.                                                                                                                                                                                                                       |
| `12-sidebar-search-button-family-dark-1440.png`                | Search `ariakit-ui-button`: "Accepted (106)". Every row repeats `ariakit-ui-button/page/`.                                                                                                                                                                                       |
| `12b-sidebar-search-forced-colors-dark-1440.png`               | Search `forced-colors`: 60 results. Names take three or four lines.                                                                                                                                                                                                              |
| `12c-sidebar-search-safari-dark-1440.png`                      | Search `safari`: "Accepted (568)". The search matched variant keys, not names.                                                                                                                                                                                                   |
| `13-sidebar-token-change-dark-1440.png`                        | Token change: 41 rows that all read "6 of 6 need review". "246 of 3832 need review" and a bar that is 94% full.                                                                                                                                                                  |
| `13-sidebar-token-change-light-1440.png`                       | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `14-sidebar-safari-regression-dark-1440.png`                   | Browser regression: 12 rows that read "2 of 6 need review".                                                                                                                                                                                                                      |
| `14b-safari-regression-selected-chip-off-screen-dark-1440.png` | The same state. The selected variant is WebKit light (chip 5). The strip shows chips 1 and 2 (Chromium) and a part of chip 3. Nothing names the selected browser.                                                                                                                |
| `15-direct-link-selected-row-out-of-view-dark-1440.png`        | Direct link to item 451 of 626. The heading is `ariakit-ui-progress/page/ring-with-label`. The list shows `ariakit-ui-popover/…` rows. The selected row is not in view.                                                                                                          |
| `21-strip-12-variants-combobox-dark-1440.png`                  | An item with 12 variants (forced colors). Chip 3 reads "React, Chromium, Light, active · rea…": the forced-colors value is plain text before the cut key.                                                                                                                        |
| `22-strip-24-variants-previews-dark-1440.png`                  | The item with 24 variants. Chips 1 and 2 read the same. The strip is 9,484 px long.                                                                                                                                                                                              |
| `22b-strip-24-variants-previews-scrolled-dark-1440.png`        | The same item with a `dark` style variant selected. The picture is dark. Every chip says "Light" with a sun icon.                                                                                                                                                                |
| `23-strip-12-variants-shell-responsive-dark-1440.png`          | An item with two viewports. The only difference between chip 1 and chip 2 is `wide` and `narrow` inside the key. The 1440 x 900 capture renders at scale 0.385.                                                                                                                  |
| `24-strip-contrast-more-dark-1440.png`                         | A high-contrast item. The chip reads "more · react-chrome-d…".                                                                                                                                                                                                                   |
| `25-heading-longest-name-dark-1440.png`                        | The longest name (68 characters). The Details buttons go to a second row, and the image starts at 519 px.                                                                                                                                                                        |
| `31-difference-region-crop-fit-dark-1440.png`                  | Difference with a real mask on a card crop: 107 red pixels in the middle of an empty 1182 x 504 stage. No picture, no image edge.                                                                                                                                                |
| `31-difference-region-crop-fit-light-1440.png`                 | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `32-compare-page-1280x800-fit-dark-1440.png`                   | Compare with a 1280 x 800 viewport capture at scale 0.433. The change (bold link text) is hard to see.                                                                                                                                                                           |
| `32-compare-page-1280x800-fit-light-1440.png`                  | The same in the light scheme. The white picture has no visible edge on the light stage.                                                                                                                                                                                          |
| `33-difference-page-1280x800-fit-dark-1440.png`                | Difference with the real mask of the viewport capture: thin red text fragments at scale 0.585.                                                                                                                                                                                   |
| `33-difference-page-1280x800-fit-light-1440.png`               | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `34-compare-small-clip-fit-dark-1440.png`                      | Compare with a 317 x 80 clip and a real change. Each picture covers 8.5% of its pane.                                                                                                                                                                                            |
| `35-difference-small-clip-fit-dark-1440.png`                   | Difference for the same clip: 249 red pixels as three small word shapes.                                                                                                                                                                                                         |
| `36-difference-1px-region-crop-416x136-fit-dark-1440.png`      | A 1 px change on a card crop: one red pixel in the stage. The metric says "0.00% changed · 1 changed pixels".                                                                                                                                                                    |
| `36-difference-2px-page-1280x800-fit-dark-1440.png`            | A 2 x 2 px change on a viewport capture: one red screen pixel.                                                                                                                                                                                                                   |
| `36-difference-1px-full-page-1280x1640-fit-dark-1440.png`      | A 1 px change on a 1280 x 1640 image (a size that the consumer does not send today): nothing is visible.                                                                                                                                                                         |
| `40-fit-small-clip-current-dark-1440.png`                      | "Current" at Fit for a 317 x 80 clip: the picture covers 4.3% of the stage.                                                                                                                                                                                                      |
| `41-zoom-200-small-clip-compare-dark-1440.png`                 | 200% in Compare: the 634 px picture is cut at the right edge of each pane, and pan buttons appear.                                                                                                                                                                               |
| `42-fit-wide-region-crop-compare-dark-1440.png`                | A wide card (1248 x 348) at scale 0.444. The text is hard to read.                                                                                                                                                                                                               |
| `43-fit-tallest-region-crop-compare-dark-1440.png`             | The largest card (1248 x 1,238) at scale 0.378.                                                                                                                                                                                                                                  |
| `50-whole-item-dialog-dark-1440.png`                           | The whole-item dialog with real labels: each of the 6 rows prints the 11 tokens of the label on two lines.                                                                                                                                                                       |
| `50-whole-item-dialog-light-1440.png`                          | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `51-details-panel-dark-1440.png`                               | The details panel: the raw label, the threshold text that ends with a separator, and three 64-character digests.                                                                                                                                                                 |
| `60-added-item-dark-1440.png`                                  | An added item: an empty left pane, "Accepted automatically", and "100.00% changed · 56,576 changed pixels".                                                                                                                                                                      |
| `61-removed-item-dark-1440.png`                                | A removed item: an empty right pane and "— changed pixels".                                                                                                                                                                                                                      |
| `62-size-changed-compare-dark-1440.png`                        | A size change of 2 px (416 x 136 to 416 x 138). The current picture is the dark capture of the same card, used as a stand-in to get a real size difference. The metric says "100.00% changed · 57,408 changed pixels".                                                           |
| `63-size-changed-difference-dark-1440.png`                     | Difference for the size change: "Pixel changes are within the comparison tolerance."                                                                                                                                                                                             |
| `64-human-decisions-strip-dark-1440.png`                       | An item with two approved variants, one rejected variant, and three pending variants. The visible chips look the same.                                                                                                                                                           |
| `65-candidate-omitted-dark-1440.png`                           | An unchanged variant whose bytes differ under the threshold: "Matched locally. The new image was not uploaded." and an empty right pane.                                                                                                                                         |
| `70-queue-dark-1440.png`                                       | The queue with production-shaped rows: every card has the heading "Pull request". Two cards fit.                                                                                                                                                                                 |
| `70-queue-light-1440.png`                                      | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `70-queue-dark-390.png`                                        | The queue on a phone: one card fits.                                                                                                                                                                                                                                             |
| `70b-queue-full-dark-1440.png`                                 | The whole queue page: four cards that differ only in the number, the count, the commit, and the time.                                                                                                                                                                            |
| `71-queue-quiet-dark-1440.png`                                 | The queue with no open work: three zeros and "All reviews are complete."                                                                                                                                                                                                         |
| `72-history-dark-1440.png`                                     | The history: rows read "#7750 · Pull request" five times with "Replaced by a newer run".                                                                                                                                                                                         |
| `72-history-light-1440.png`                                    | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `72-history-dark-390.png`                                      | The history on a phone: four rows fit.                                                                                                                                                                                                                                           |
| `72b-history-full-dark-1440.png`                               | The whole history page: 100 rows, 6,763 px. 87 gray badges, 9 green, 4 colored.                                                                                                                                                                                                  |
| `73-service-dark-1440.png`                                     | The service status page with the one alert and the capacity values of live-authenticated.md.                                                                                                                                                                                     |
| `80-workspace-typical-pr-dark-390.png`                         | The workspace on a phone: the image starts at 538 px. One chip is visible and cut.                                                                                                                                                                                               |
| `80-workspace-typical-pr-light-390.png`                        | The same in the light scheme.                                                                                                                                                                                                                                                    |
| `81-workspace-all-accepted-dark-390.png`                       | The observed case on a phone: the name takes two lines, and the image starts at 744 px of 844 px.                                                                                                                                                                                |
| `82-items-dialog-all-accepted-dark-390.png`                    | The Screenshots dialog on a phone: 10 rows of 626, each with two name lines and an empty tile.                                                                                                                                                                                   |
| `83-workspace-page-capture-dark-390.png`                       | A 1280 x 800 capture on a phone at scale 0.275.                                                                                                                                                                                                                                  |

## Redesign ideas

Each idea starts from a number in this report. The JSX uses only props that `apps/lab/docs/primitives.md` documents. Widths in the sketches that are not in M6 are estimates.

### Idea 1 · A family tree in place of the flat list

- What changes: The client splits each key into family, group, and leaf. It removes the prefix `ariakit-ui-` that 23 of 26 families share. A row shows only the leaf, on one line with a fixed height. A group row shows its counts. Only groups with something to review are open.
- Why it is better: 62% of the name characters are the path, and a row takes three lines (REAL-02). The leaf has a median of 13 characters and fits on one line of a 215 px row. With 28 px rows, 24 rows fit in the 689 px list. Today 9 fit. A fixed row height also removes the probable cause of REAL-09. The 26 family rows fit on one screen, so a run with no changes is one screen and not 65.
- Data: families and sizes in Table A1. The second segment is `page` for 473 items and `forced-colors` for 60.

```
SCREENSHOTS                     3 changed · 626 total
[ Search names…                                    ]
v button                               3 changed / 106
    v page                                    3 / 85
        default                              ●●●●●●
        pill                                 ○○○○●●
        segmented-control                    ○●○○○○
    > forced-colors                               16
    > states                                       5
> list                                            60
> table                                           47
> tabs                                            43
… 22 more families, all unchanged
```

```tsx
<Nav aria-label="Screenshots" $slotSize={4} glider={[{ $state: "hover" }, {}]}>
  <NavDisclosure
    defaultOpen
    button={<NavDisclosureButton>button · 3 changed of 106</NavDisclosureButton>}
  >
    <NavList>
      <NavLink
        render={
          <RouterLink
            to="/runs/$runId"
            params={{ runId }}
            search={{ item: "ariakit-ui-button/page/default" }}
          />
        }
      >
        <NavLinkLabel>default</NavLinkLabel>
        <NavSlot $kind="badge" className="ms-auto">
          6
        </NavSlot>
      </NavLink>
    </NavList>
  </NavDisclosure>
  <NavDisclosure button={<NavDisclosureButton>list · 60</NavDisclosureButton>}>
    <NavList>{/* mounted only when the group is open */}</NavList>
  </NavDisclosure>
</Nav>
```

### Idea 2 · A first state for a run with nothing to review

- What changes: A run with no reviewable variant opens on a summary: one sentence, why the run is closed, and a table of families. The viewer opens only when the user selects an item, and it shows one image for an unchanged variant.
- Why it is better: The observed run has 186 words, four read-only statements, two copies of one image, and a decision bar, and it has nothing to decide (REAL-05). The summary answers the one question of this page ("did anything change?") in one line.
- Data: 3,832 unchanged variants in 626 items and 26 families. `reference` and `candidate` are the same image object for an unchanged variant.

```
#7746 · attempt 1 · closed                                    [ Open the pull request ]
No visual changes.
3,832 screenshots in 626 items match baseline revision 412.

Family      Items   Screenshots   Browsers
button        106       604       Chrome, Firefox, Safari
list           60       300       Chrome, Firefox, Safari
table          47       282       Chrome, Firefox, Safari
…                                                             [ Browse all screenshots ]
```

```tsx
<Frame $lighten $border $rounded="xl" $p="1rem" className="grid gap-3">
  <Text className="text-lg font-semibold">No visual changes</Text>
  <Text className="ak-ink-60 text-sm tabular-nums">
    3,832 screenshots in 626 items match baseline revision 412.
  </Text>
  <Table
    aria-label="Families"
    container={{ $border: true }}
    $borderInline={false}
    rows={[
      {
        group: "head",
        family: { children: "Family", $grow: true },
        items: { children: "Items", numeric: true, $fit: true },
        shots: { children: "Screenshots", numeric: true, $fit: true },
      },
      { key: "button", family: "button", items: 106, shots: 604 },
      { key: "list", family: "list", items: 60, shots: 300 },
    ]}
  />
</Frame>
```

### Idea 3 · A variant matrix: browsers as columns, schemes as rows

- What changes: The chip strip becomes a small grid. The columns are the browsers and the rows are the color schemes. Each cell is one variant and shows its state. Extra row groups appear only when the item has them (forced colors, a second viewport).
- Why it is better: 523 items (83.5%) are exactly 3 browsers x 2 schemes. 58 more are 2 x 2, and 10 are 3 x 1. So one grid shape covers 591 of 626 items. The grid is about 200 px wide. The strip needs 2,420 px for the same six variants and shows two (M6). The selected cell is always in view (REAL-08), and a browser regression is one colored column.
- Data: Table A2. The capture order is Chrome light, Chrome dark, Firefox light, Firefox dark, Safari light, Safari dark, so the keys 1 to 6 go down each column.

```
              Chrome    Firefox    Safari
Light          · 1        · 3      [● 5]      · unchanged   ● needs review
Dark           · 2        · 4       ● 6       ✓ approved    ✕ rejected

12 variants (29 items):          2 viewports (5 items):
              Chrome  Firefox  Safari          Chrome  Firefox  Safari
Light           ·       ·       ·      wide  L   ·       ·        ·
Dark            ·       ·       ·            D   ·       ·        ·
Forced light    ●       ·       ·      narrow L  ·       ·        ·
Forced dark     ●       ·       ·             D  ·       ·        ·
```

```tsx
<ak.RadioProvider value={variant.key} setValue={selectVariant}>
  <ak.RadioGroup
    aria-label="Variants"
    className="grid grid-cols-[auto_repeat(3,auto)] items-center gap-1"
  >
    <span />
    <Text className="ak-ink-60 text-xs">Chrome</Text>
    <Text className="ak-ink-60 text-xs">Firefox</Text>
    <Text className="ak-ink-60 text-xs">Safari</Text>
    <Text className="ak-ink-60 text-xs">Light</Text>
    {lightVariants.map((entry) => (
      <ak.Radio
        key={entry.key}
        value={entry.key}
        render={
          <Button
            $size="sm"
            $border
            $lightnessOffset={entry.key === variant.key ? 2 : undefined}
            $text={needsReview(entry) ? "warning" : undefined}
            aria-label={`${browserName(entry)}, light, ${verdictLabel(entry)}`}
          />
        }
      >
        <ButtonSlot>{statusIcon(entry)}</ButtonSlot>
        <ButtonSlot $kind="shortcut">
          <kbd>{shortcut(entry)}</kbd>
        </ButtonSlot>
      </ak.Radio>
    ))}
  </ak.RadioGroup>
</ak.RadioProvider>
```

### Idea 4 · Labels that show only the axes that differ inside the item

- What changes: A chip, a dialog row, and an accessible name show only the axes that have more than one value in this item. The axes with one value go to one caption for the whole item.
- Why it is better: The framework is `react` for 3,820 of 3,832 variants. The contrast never changes inside an item. The forced-colors value changes inside 29 items. So "React", the contrast icon, the forced-colors icon, and the key are the same text on every chip of 591 items. The label "Chrome · Light" is about 110 px in place of 413 px, so six chips fit in about 700 px (estimate).
- Data: the axis table of M1 (browser 626 items, color scheme 613, forced colors 29, viewport 6, framework 1, contrast 0). It needs the viewport and the style from the server (REAL-01).

```ts
const axes = [
  "framework",
  "browser",
  "colorScheme",
  "contrast",
  "forcedColors",
  "viewport",
  "style",
] as const;
const differs = (axis: Axis) =>
  new Set(item.variants.map((entry) => axisValue(entry, axis))).size > 1;
// 591 of 626 items: ["browser", "colorScheme"]. The style is left out when it is equal to the color scheme.
const varying = axes.filter(differs);
// One caption for the item, for example "React · 1280 × 800".
const constant = axes.filter((axis) => !differs(axis) && !isDefaultValue(item.variants[0], axis));
```

```
ariakit-ui-button/page/default              React · desktop
( Chrome · Light 1 ) ( Chrome · Dark 2 ) ( Firefox · Light 3 ) ( Firefox · Dark 4 ) ( Safari · Light 5 ) ( Safari · Dark 6 )
accessible name: "Safari, light. Needs review."
```

### Idea 5 · Fit by size class: one stage at 2x with a flip for crops, two panes for page captures

- What changes: Fit means the largest whole-number zoom that fits, with pixelated rendering. The default layout depends on the image size. A crop of up to 573 px in width opens in one full-width stage at 2x, and the reviewer flips between baseline and current in place (hold a key, or click). A viewport capture opens side by side.
- Why it is better: 89.1% of the items render at scale 1 and cover a median of 23.7% of a pane (REAL-07). A zoom of 2 fits one stage for 64.5% of the items and a zoom of 3 for 2.1% more, but it fits a Compare pane for none. A flip at 2x shows a 1 px change as 2 x 2 screen pixels that blink in place. That is easier to see than two static copies.
- Data: M4. The stage is 1182 x 504 at 1440 x 900.

```
( Flip  B ) ( Overlay ) ( Side by side )                         ( − ) Fit 2× ( + )
┌────────────────────────────────────────────────────────────────────────────────┐
│                      ┌──────────────────────────────────┐                      │
│                      │  DEFAULT                     (i) │   416 × 136 at 2×    │
│                      │   Cancel                         │                      │
│                      └──────────────────────────────────┘                      │
│   Showing: Current · hold B for Baseline            1 change: 107 px  [ Next ] │
└────────────────────────────────────────────────────────────────────────────────┘
```

```tsx
<ak.RadioProvider value={mode} setValue={setMode}>
  <ak.RadioGroup aria-label="Comparison mode" render={<ButtonGroup $border />}>
    <ak.Radio value="flip" render={<Button />}>
      Flip
    </ak.Radio>
    <ak.Radio value="overlay" render={<Button />}>
      Overlay
    </ak.Radio>
    <ak.Radio value="side" render={<Button />}>
      Side by side
    </ak.Radio>
    <ButtonGlider />
  </ak.RadioGroup>
</ak.RadioProvider>
```

### Idea 6 · Progress and batch actions that count changes, not screenshots

- What changes: The run header counts reviewed changes of all changes. The denominator is the number of changed variants. When one family has many changes, the header offers the family as one unit of review.
- Why it is better: At the start of a typical pull request the bar is 99.77% full, and the 9 open variants are 0.15 px of it (M6). In the token change, 246 variants in 41 items of 3 families have the same kind of change. Today that is 246 "Approve & next" actions, or 41 whole-item actions. By family it is 3.
- Data: scenario counts in M5.

```
#7751   0 of 9 changes reviewed   ○○○○○○○○○            3 items · button
#7752   0 of 246 changes reviewed  ░░░░░░░░░░░░░░░░░░   41 items · badge 144 · kbd 72 · prose 30
        [ Review badge as a sheet ]   [ Approve all 144 in badge… ]
```

```tsx
<div className="flex items-center gap-3">
  <Text className="text-sm tabular-nums">0 of 9 changes reviewed</Text>
  <div className="w-32">
    <Progress
      aria-label="Reviewed changes"
      value={reviewed / changed}
      $thickness={1}
      fill={{ $layer: rejected ? "danger" : "success" }}
    />
  </div>
  <Badge $layer="warning" $forceRounded>
    <BadgeLabel>9 to review</BadgeLabel>
  </Badge>
</div>
```

### Idea 7 · A contact sheet for a group of changed card crops

- What changes: A group (a family, or the search result) opens as a grid of tiles. Each tile is one changed item at 50% scale with its mask over a dimmed picture, and a small row of variant dots. A click opens the item in the viewer.
- Why it is better: A card crop is 416 px wide with a median height of 178 px, so a tile of 208 px is still readable, and 5 tiles fit in one row of the 1146 px stage. The 41 changed items of the token change are 9 rows, about two screens, and the reviewer sees at once that the change is the same in all of them. A mask is 0.3 to 10 KB (M10), and a card crop has a median of 11.9 KB (M2).
- Data: sizes in Table A3; the token change scenario in M5.

```
badge · 24 changed items                                   [ Approve all 144 ]  [ Reject… ]
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ DEFAULT │ │ BRAND   │ │ CUSTOM… │ │ SOLID   │ │ INVERT… │
│ ▒▒▒     │ │ ▒▒▒     │ │ ▒▒▒     │ │ ▒▒▒     │ │ ▒▒▒     │   ▒ = mask over the dimmed picture
│ ●●●●●●  │ │ ●●●●●●  │ │ ●●●●●●  │ │ ●●●●●●  │ │ ●●●●●●  │   ● = one variant
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

```tsx
<div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
  <Frame $border $rounded="xl" $p={1} className="grid gap-1">
    <Frame $darken className="relative overflow-clip">
      <img
        src={candidate.url}
        width={candidate.width / 2}
        height={candidate.height / 2}
        alt=""
        className="opacity-40"
      />
      <img src={diff.url} alt="Changed pixels" className="absolute inset-0 size-full" />
    </Frame>
    <Text className="truncate px-2 text-sm font-medium">default</Text>
  </Frame>
</div>
```

### Idea 8 · A history that has one row for each pull request

- What changes: The history groups the attempts of one pull request into one row. The row shows the result of the newest attempt, and the older attempts open below it. A closed attempt names its cause (REAL-06): replaced, pull request closed, or expired.
- Why it is better: In the generated history, 91 of 100 rows are attempts of 29 pull requests, and 87 rows have the same gray badge. One row for each pull request gives 38 rows in place of 100 (about 2,400 px of rows in place of 6,400 px, at 64 px per row). The share is an estimate; live-authenticated.md says only that most rows read "Replaced by a newer run".
- Data: `SCRATCH/data/api/runs.json`; `packages/service/src/review-status.ts:77`.

```
Run                                  Result                 Last run
#7754   3 attempts                   ● Changes rejected     12:16
#7753   1 attempt                    ● Needs review         12:07
#7750   5 attempts                   Closed · passed        09:58   v
          attempt 5   d2e2733        Closed with the pull request
          attempt 4   88f174b        Replaced by attempt 5
main    21a01a8                      ✓ Passed               yesterday
```

### Idea 9 · Search for names, filter by axes

- What changes: The search field reads names only. Three small filters select variants: browser, color scheme, and "changed only". A filter changes which variants count in each row and in the matrix.
- Why it is better: Today the word `dark` matches 619 of 626 items and `safari` matches 568, because the search reads variant keys (REAL-10). As a filter, "Safari" answers a real question: "show me what changed in Safari".
- Data: M9.

```
[ Search names…            ]   Browser ( All | Chrome | Firefox | Safari )   Scheme ( All | Light | Dark )   [x] Changed only
```

```tsx
<ak.RadioProvider value={browser} setValue={setBrowser}>
  <ak.RadioGroup aria-label="Browser" render={<ButtonGroup $border $size="sm" />}>
    <ak.Radio value="all" render={<Button />}>
      All
    </ak.Radio>
    <ak.Radio value="chromium" render={<Button />}>
      Chrome
    </ak.Radio>
    <ak.Radio value="firefox" render={<Button />}>
      Firefox
    </ak.Radio>
    <ak.Radio value="webkit" render={<Button />}>
      Safari
    </ak.Radio>
    <ButtonGlider />
  </ak.RadioGroup>
</ak.RadioProvider>
```

## Open questions and items not verified

Verified facts are in the findings and in Tables A and B. The items below are not verified.

1. Item order in production. The order in `inventory.json` is an inference from the reporter and the CLI. Two observed facts agree with it: the name `ariakit-tailwind-7466/applied-light-week-hover` and the chip text `react-chrome-default-d…` are the first item and its first variant in the inferred order. The order of the other 625 items is not confirmed.
2. Image sizes in Firefox and Safari, and on the Linux and macOS runners. I measured Chrome on one macOS machine. The card width (416 px) comes from the page layout and is probably the same. Heights can differ by a few pixels.
3. The captures come from a preview server of another Ariakit checkout (`/Users/diegohaz/Developer/ariakit-ui/app`, commit `996418ac`), not from the checkout that the census reads (`643a23af`). The card sets are equal (473 of 473), but a card can have another height at the commit of the observed run.
4. How real pull requests change pictures. The three change scenarios are injected CSS rules. The sizes of real masks, and how many items one real pull request touches, are not known. "9 changed variants in 3 items" is the scenario that the lane text gave, not a measured average.
5. The rate of unchanged variants whose bytes differ under the threshold (`candidateOmitted`). It decides how often the empty right pane of VIEW-09 appears. Production data is needed.
6. The real mix of the history: how many attempts a pull request has, and which of the four causes of `superseded` is the common one (REAL-06). The 87% in the generated list is an estimate.
7. How many runs wait in the queue on a normal day (the open question of DASH-08 stays open).
8. Whether the forced-colors captures of `test-browser.ts` files run in the `safari` project. The census totals are equal to the observed totals only if they do, but a comment in `/Users/diegohaz/Developer/ariakit/app/src/sandbox/ariakit-ui-shell/test-chrome-firefox.ts:62-63` says that WebKit cannot emulate forced colors.
9. The cause of REAL-09. The measurement is repeatable, but I did not prove that the row estimate is the cause, and I did not test another browser or the phone dialog.
10. The summary state of a closed run (`evidenceState: "summary"`, 30 days after the close). I did not build production-shaped data for it. The lab scenario `expired` covers it.
11. Runs of kind `merge_group`. The Ariakit workflow has no merge queue trigger today. If the maintainer adds one, such runs appear, and their shape was not checked.
12. Light-scheme captures exist for the main states (list, strip, Compare, Difference, dialog, queue, history) and not for every state.
13. I did not run the lab app. The gap list compares its documents and source with Tables A and B.
14. The dimensions of 80 items are class sizes and not their own sizes (M4). The exact share of items at scale 1 can move by about one point.
