# Adversarial verification: lane `gap-real-data` (REAL-01 to REAL-12)

Verifier scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-real-data/verify/` (named `VERIFY` below). The auditor's scratch directory is `SCRATCH` = `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-real-data/`. Repository paths are relative to `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`.

Skill invoked at the start: `ariakit-general-workflow`. No repository file was changed. No request went to production or to GitHub. All browser probes used the fixture server on port 4311 with mocked answers.

## Method and limits

1. I opened each cited file and compared the quoted lines.
2. I ran new probes (my own scripts, with a copy of the auditor's harness that reads the auditor's data read-only):
   - `VERIFY/census-check.mjs` → `census-check.out.txt` (recount from `SCRATCH/census/inventory.json` and from the generated compact answer).
   - `VERIFY/ui/probe-reveal.mjs` → `probe-reveal.out.txt` (REAL-08, REAL-09, with a timeline of the row position).
   - `VERIFY/ui/probe-cause.mjs` → `probe-cause.out.txt` (second reveal, phone dialog, keyboard navigation, `scrollIntoView` side effect, native tooltips).
   - `VERIFY/ui/probe-uniform.mjs` → `probe-uniform.out.txt` (REAL-09 with rows of one height).
   - `VERIFY/ui/probe-misc.mjs` → `probe-misc.out.txt` (row geometry, image sources, disabled state, statements, progress).
   - A copy of the auditor's `probe-text.mjs` (same result: 186, 114, 175, 168 words).
   - A re-run of `SCRATCH/census/fit-report.mjs` and `sizes-report.mjs`: the output is identical to the recorded output (`diff` is empty).
3. Limits that apply to every UI number in this lane (the auditor's numbers and mine):
   - The data is generated. The census is a model of the Ariakit source with a hand-made list of explicit captures. Its two totals (626 items, 3,832 variants) are equal to the two totals in `live-authenticated.md`. No per-item production data was read.
   - The Ariakit checkout is now at commit `8f018501e`. The auditor used `643a23aff`. `git diff --stat 643a23af HEAD -- app/src` is empty, so the census source did not change.
   - Image sizes come from Chrome on macOS, from a preview server of another Ariakit checkout.
   - The fixture page is the Vite development build of the real route tree, at device scale factor 1. It is not the built Worker.
4. Overlap with earlier lanes: REAL-04 = RULE-02 and REVIEW-14. REAL-08 is the production-width case of WORK-02 (high, confirmed). REAL-07 is the production-shape case of VIEW-14 and VIEW-04. REAL-11 contains VIEW-07 and parts of COPY-08. REAL-06 contains PKG-07.
5. The report cites no earlier maintainer decision. Several of its options reopen recorded decisions. I name them in each section and in "Missed".

## REAL-01 · Viewport and style do not reach the client

- Verdict: **partly-confirmed**.
- Severity: **low** for the current UI (auditor: medium). It becomes medium only if the key text is removed from the chip (COPY-04, WORK-24) before the server sends the dimensions.
- Proof that I checked:
  - Consumer sends `dimensions`: `/Users/diegohaz/Developer/ariakit/app/src/test-utils/visual.ts:491-495` (`dimensions: { project: testInfo.project.name, viewport: viewportName, style: styleName }`).
  - Server reads five fields and the key: `apps/web/src/api/review.ts:469-482`. The stored metadata has the whole variant (`apps/web/src/api/workflow-materialize.ts:335`: `variant: capture.variant`), so `dimensions` is available at read time and is not read.
  - Chip cut: `apps/web/src/review/variant-summary.tsx:117` (`max-w-48 truncate`). My probe: `"keyTextBox": { "client": 144, "scroll": 317 }`.
  - Count: `census-check.out.txt`: `REAL-01 items with equal five-part labels 6 variants in such groups 84` (three `ariakit-ui-shell` items, three `previews` items). `variants where style (light/dark) differs from colorScheme 24` in the three preview items.
  - Preview test does not emulate the dark scheme: `/Users/diegohaz/Developer/ariakit/app/src/tests/previews-browser.ts:36-40` passes `viewports` and no `styles`, so `defaultStyles` sets only `--color-canvas` (`visual.ts:91-94`).
  - Screens `22-…` and `22b-…` show what the finding says.
- Corrections:
  1. "They exist only inside the cut key text" is too strong. The full key is in four more places today: a native tooltip on the key text (`variant-summary.tsx:119`, `title={title}`), a native tooltip on the chip (`review-workspace.tsx:747`), the chip `aria-label` (`:776`), and the Details panel (`:463-465` prints `variant.label`). My probe read `chipTitles: ["react · chromium · light · no-preference · none · react-chrome-desktop-light-light-no-preference-none · Unchanged", "… react-chrome-desktop-dark-light-no-preference-none · Unchanged"]`. So a mouse user can tell the two chips apart by hover. A keyboard user must open Details.
  2. The scope is 6 of 626 items (1.0%) and 84 of 3,832 variants (2.2%).
  3. The server snippet alone breaks the client. The client parser accepts only six part kinds and throws for any other value:

     ```ts
     // apps/web/src/review/client.ts:80-93
     kind: oneOf(data.kind, ["framework", "browser", "colorScheme", "contrast", "forcedColors", "key"]),
     // oneOf throws: "The service returned an unsupported review state."
     ```

     `variant-summary.tsx:30-41` also indexes `iconValuesByKind[part.kind]`, which is `undefined` for a new kind. A correct change touches `review.ts:37-40` (type), `client.ts:80-93`, `model.ts:20`, `variant-summary.tsx:30-41`, and the fixtures. A tab that holds the old bundle and reads the model again after a deploy fails to parse it, so the client must accept the new kind first, or the format name `compact-review-1` must change.

  4. Each new part is repeated for each of the 3,832 variants. In the generated answer, `label` and `labelParts` already use 1,522,762 of 5,212,685 characters (29.2%) for 66 distinct label sets (see "Missed" 3). Send a dimension only when it differs inside the item, or share the label sets.
  5. `dimensions` values can be strings, booleans, or finite numbers (`packages/protocol/src/validate.ts:217-230`). The snippet handles strings only. That is correct for Ariakit today.
  6. Alternative (a) "a tooltip" exists already as a native `title`. The real gap is that the difference is not visible without hover.

## REAL-02 · Every item name is its key

- Verdict: **confirmed** (facts). The severity is a judgment.
- Severity: **medium** (auditor: high). Names wrap in full, so no information is lost. The main work list (items that need review) is short for a typical pull request. WORK-23 and WORK-24 (same row and chip class) are medium after verification.
- Proof that I checked:
  - `apps/web/src/api/workflow-materialize.ts:334`: `name: capture.name ?? capture.itemKey`. Also `apps/web/src/api/review.ts:466` and `apps/web/src/capture-inventory.ts:309`.
  - Consumer passes no `name`: `visual.ts:359` and `:514-518`.
  - `apps/web/src/review/item-list.tsx:246-248` (`$truncate={false}`, `wrap-anywhere`).
  - Recount: `name length min 23 median 37 p90 48 max 68`, `path prefix share 14929 of 23925 62.4%`, longest `ariakit-ui-combobox/page/combobox-select-content-conditional-content`.
  - My probe (`probe-misc.out.txt`, all-accepted run): `"row": {"width": 200.6, "height": 76}`, `"nameLines": 3`, `"visibleRows": 9`, `"listHeight": 689`, `"listScrollHeight": 44714`. Screen `25-…` shows the second heading row.
- Corrections:
  1. "23 of 26 families start with `ariakit-ui-`" is wrong. It is 24 of 26 (`census-check.out.txt`: `families 26 start with ariakit-ui- 24`; the report's own family table lists 24).
  2. "Row width 201 px" is the row. The name column is 124.6 px wide in the Accepted group and 139 px in the main list (`"name": {"width": 124.6}`). The empty tile (26 px) plus the gap (14.9 px, not 12 px) plus the status dot take the rest.
  3. 44,714 px is the estimate of the virtual list, not a measured height. It changed between 43,820 and 46,622 px in my runs, when other rows were measured.
  4. With one-line names (CSS injected in my probe, no code change) a row is 44 px and 626 rows are 27,544 px: `{"rowHeight":44,"scrollHeight":27544}`. That is the 44 px row of WORK-23.
  5. The consumer option is feasible: `name` is in the protocol (`packages/protocol/src/types.ts:95`, `validate.ts:310-311`), in the adapter (`packages/playwright/src/visual.ts:21`, `:41`, `:228`, `:459`), and the compact inventory restores it (`capture-inventory.ts:309`). `ScreenshotRegion` in the consumer has only `name` and `element` (`visual.ts:40-44`), so the `title` field of the sketch is new there. A display name alone is ambiguous: 84 last segments are shared by 211 items (`default` 21 times). It needs the family next to it.
  6. A client split on `/` is safe for all consumers: keys are `[a-zA-Z0-9][a-zA-Z0-9._/-]*` with no empty segment (`packages/protocol/src/validate.ts:131-139`). Removing `ariakit-ui-` is a rule for one consumer.

## REAL-03 · The list is flat and in test-file order

- Verdict: **judgment**. Every factual part is confirmed. Three of the four criticized behaviors are recorded decisions.
- Severity: **medium**.
- Proof that I checked: `item-list.tsx:91-101`, `:256`, `:378`; `navigation.ts:17-47`; `apps/web/src/api/review-inventory.ts:165-167` (sort by `ordinal`); `live-authenticated.md:38` ("626 items in one 'Accepted (626)' section"); my probe: token change `"listScrollHeight": 2601`, `"visibleRows": 10`.
- Corrections (the finding does not cite these rules):
  1. The order is a selected rule (D29). `docs/simplification-audit/contract-issue-1.md:262`: "Build the list from the union of reference and candidate identities: candidate order first, then reference-only entries in reference order." `docs/design-r9.html:29` marks it "Selected · D29". Alternative (a) "sort by key" reopens D29.
  2. "Accepted" for unchanged items is a dated maintainer decision. `docs/current-contract.md:194`: "On 2026-10-02, the maintainer requested … Ordinary accepted and unchanged items stay under **Accepted**." Also `docs/review-guide.md:25`. Alternative (b) "Unchanged (626)" reopens it.
  3. The row text is contract text. `contract-issue-1.md:261`: "Show counts such as '2 of 6 need review,' not only 'changed.' Counts and text must accompany color." The option "no status text on unchanged rows" changes that rule.
  4. Grouping by family is not covered by any rule that I found (`contract-issue-1.md:262` says only "One sidebar item groups all variants"). It is a new question.
  5. The token-change case (41 rows, "6 of 6 need review") is a constructed scenario. How many items one real pull request touches is not known (the auditor says so in open question 4).

## REAL-04 · Production has no thumbnails

- Verdict: **confirmed**. Duplicate of RULE-02 and REVIEW-14.
- Severity: **low**.
- Proof that I checked: `review.ts:505-507`; the only writers of `thumbnailImageId` are `apps/compare/src/process.ts:191`, `:206`, `:228` and `apps/compare/container/transport.ts:207` (grep over `apps` and `packages`; nothing in `packages/cli` or `packages/protocol`); the local result has no such field (`workflow-materialize.ts:345-353`); `docs/current-contract.md:77` makes local comparison the only path for new runs; `item-list.tsx:231-244`; my probe: `"thumbnails": 0, "emptySlots": 13, "mountedRows": 13`.
- Corrections:
  1. The tile and its gap take 40.9 px (26 + 14.9), not 38 px.
  2. Two documents still describe the thumbnail: `docs/review-guide.md:27` and `contract-issue-1.md:262` ("Thumbnail always uses the item's first declared candidate variant"). Option (a) "remove the slot" changes a contract rule and needs the guide change.
  3. Option (b) (use the stored image) sends one request to the Worker and one R2 read for each mounted row: 13 at load and up to 626 when the user scrolls the whole list. At 26 px a 416 px card is not readable (WORK-23). Option (d) changes the signed receipt, as the auditor says.

## REAL-05 · A run with no changes opens as a full review workspace

- Verdict: **confirmed** (facts). The recommendation is a design judgment.
- Severity: **medium**.
- Proof that I checked:
  - My probe (`probe-misc.out.txt`): `"metric": "0.00% changed · 0 changed pixels"`, `"progress": {"value": 3832, "max": 3832, "text": "0 of 3832 need review"}`, both images have `"src": "/images/0e53b327-85a0-4127-8838-a01ed93cc577"`, `"Approve & nextA": {"disabled": true, "background": "oklch(0.515341 0.1546 248.516)"}`, statements: "This run is archived. …", "Comparison superseded", "A newer attempt replaced this comparison. Its evidence cannot be reviewed.", and "A newer attempt is active".
  - Text count re-run: `archived-all-accepted: words {"total":186,…} | "need(s) review" 10 | "N of M need review" 9 | read-only statements 4`.
  - Same image object: `workflow-materialize.ts:303-306` keeps the reference image for an unchanged capture; `review.ts:450-454` and `:502` send the candidate unless the digests differ; `compact-model.ts:35-57` gives one index for one image id. `census-check.out.txt`: `reference index === candidate index 3832` in the generated answer.
  - Sources of the four texts: `review.ts:97-98`, `use-review-session.ts:73-74`, `review-workspace.tsx:136-137`, `:694-699`.
- Corrections:
  1. The "same image two times" holds for a capture whose bytes are equal to the reference. A capture that differs under the threshold shows an empty right pane ("New image not uploaded", `review.ts:450-454`). The production rate of each case is not known.
  2. The tested state is a closed pull request run with status `superseded`. The more common state, an open run with no change (status `passed`), and a main run in the baseline (other read-only text, `review.ts:584-585`), were not built or tested. The four statements belong to the closed state only.
  3. The brand fill of the disabled button is PRIM-06.
  4. Alternative (a) "hide the decision bar when the run is archived" touches the layout rule `contract-issue-1.md:260` ("review actions next to the result"). One pane for an unchanged variant does not conflict with `contract-issue-1.md:265`, which covers additions and removals only.

## REAL-06 · One status, `superseded`, covers four causes

- Verdict: **confirmed**, with corrections. Not measured (code reading), as the auditor says.
- Severity: **medium**.
- Proof that I checked: `packages/service/src/review-status.ts:77`; `run-admission.ts:122`; `apps/web/src/api/webhooks.ts:310-323`; `run-retirement.ts:37` and `:111`; `retention.ts:100-102`; `apps/web/src/routes/index.tsx:138`; `use-review-session.ts:73-74`; `review-workspace.tsx:136-137`. A pull request run can never be `accepted`: promotion asserts `kind = 'main'` (`packages/service/src/baseline-promotion.ts:380`, also `:114`). `docs/current-contract.md` has no rule for the text of a closed run.
- Corrections:
  1. The text is false for two causes, not four. Closed or merged pull request (cause 2): false, and this is the normal end of every pull request run. Expired incomplete run (cause 3): false (this is PKG-07). New attempt (cause 1) and head changed: true. Old main baseline after retention (cause 4, `retention.ts:100-102`, only for `state='accepted'` runs that are not the current snapshot): "Replaced by a newer run" is close to true.
  2. Cause 3 needs no new column. The row keeps `state = 'failed'` with `active = 0` (`run-retirement.ts:111`). Only `reviewStatus` hides it.
  3. The last result can be derived for runs that still have their rows: the dashboard query already selects `pending` and `rejected` for each run (`apps/web/src/api/dashboard.ts:38-44`, `:55`), and `reviewStatus` drops them for a closed run (`empty(...)`). For a summarized run (`detail_archived`, 30 days after the close) check where the rows are before you use this. I did not check that path.
  4. Alternative (b) has a short window: the webhook closes the old run (`webhooks.ts:316-318`) before the new run exists.
  5. A stored `closedReason` needs a D1 migration and three writers (`run-admission.ts:122`, `run-retirement.ts:37`, `retention.ts:100`).

## REAL-07 · 89% of production images are card crops that Fit shows at 100%

- Verdict: **confirmed** for Chrome sizes at device scale factor 1.
- Severity: **medium** (auditor: high). A 1:1 view is a true view, and 200% exists. VIEW-14 is low and VIEW-04 is high after verification; the production share moves VIEW-14 up, not to high.
- Proof that I checked:
  - `apps/web/src/components/screenshot-viewer.tsx:152-153` (natural size), `:162` (`max-w-full h-auto max-h-full object-contain`), `apps/web/src/review/model.ts:3` (`"fit" | 1 | 2`).
  - Re-run of `fit-report.mjs`: identical output. `scale 1 … 558 (89.1%)`, `p10 16.8% median 23.7% p90 54.2%`, `2x 0 (0.0%)` for a Compare pane, `2x 404 (64.5%)` for one stage.
  - My probe: a 416 x 136 crop renders at 416 x 136 in a 591 x 504 stage at 1440 x 900, and in a 511 x 403 stage at 1280 x 720.
  - Images are in CSS pixels: `packages/playwright/src/visual.ts:170` (`scale: options.screenshot?.scale ?? "css"`). Installed Playwright 1.63.0 types: "When set to `"css"`, screenshot will have a single pixel per each css pixel on the page."
- Corrections:
  1. The guide says another thing than the code. `docs/review-guide.md:35`: "Fit | Image scaled to the available viewer width". The code does not enlarge. For 89% of items the guide is wrong today. This supports the finding.
  2. The reviewer can enlarge today with two controls: 200% and a single-image mode (`F`, `G`, or `D`). An 832 px picture fits the 1146 px stage. So "the picture cannot be larger" is true only for Compare.
  3. The contract names the three levels (`contract-issue-1.md:264`: "Provide fit/100%/200% inspection without changing stored reference pixels"). A new meaning of Fit, or 300% and 400%, is a contract change.
  4. All measurements are at device scale factor 1. On a high-density screen each image pixel covers 2 x 2 device pixels. In Fit the browser smooths them (`image-rendering: auto`, measured: `"rendering": "auto"`); at 100% and 200% the class sets `pixelated` (`screenshot-viewer.tsx:162`). So "a 1 px change is exactly 1 screen pixel" holds only at factor 1. Not measured at factor 2.
  5. The sizes are from Chrome on macOS. 80 items use a class size (the auditor says so).

## REAL-08 · The selected chip is off screen at load

- Verdict: **confirmed**. It is WORK-02 with production widths, and the scope is wider than the finding says.
- Severity: **high**.
- Proof that I checked:
  - My probe (`probe-reveal.out.txt`): `safari-regression-1440 {"index":5,"chips":6,…,"fullyVisible":false,"partlyVisible":false,"chipLeft":1624,"chipWidths":[410,408,390,388,395,390],"stripWidth":1120,"stripScrollWidth":2419,"scrollLeft":0,"overflowX":"auto","browserTextOutsideStrip":[]}` and the same with `"stripWidth":1600` at 1920 px.
  - Selection rule: `review-workspace.tsx:123-132` and `:285-290` (first variant that needs review). The only reveal code is in the key handler of the strip itself (`:119`). `grep scrollIntoView|scrollLeft` over `apps/web/src` finds no other code.
  - Variant order: `census-check.out.txt`: `6-variant orders [["chrome/light,chrome/dark,firefox/light,firefox/dark,safari/light,safari/dark",523]]`.
  - Rule that this breaks: `contract-issue-1.md:261` ("Prioritize run identity, item name, full variant label, …") and `docs/review-guide.md:23` ("The full variant label and result appear above the image controls").
- Corrections:
  1. The scope is wider. Every selection that does not come from a key press inside the strip leaves the strip at `scrollLeft` 0: arrow keys from the workspace, the digit keys, and (same code path, `select()`) Approve & next. My probe on the typical pull request:

     ```
     {"presses":2,"index":3,"fullyVisible":false,"partlyVisible":true,"chipLeft":834,"chipRight":1226,"stripWidth":1120,"scrollLeft":0}
     {"presses":3,"index":4,"fullyVisible":false,"partlyVisible":false,"chipLeft":1230,"chipRight":1620,"stripWidth":1120,"scrollLeft":0}
     {"presses":5,"index":6,"fullyVisible":false,"partlyVisible":false,"chipLeft":2022,"chipRight":2415,"stripWidth":1120,"scrollLeft":0}
     ```

     So at 1440 px, chips 4, 5, and 6 are off screen for 523 of 626 items when the reviewer goes through all six variants.

  2. "The third or a later one" is not exact. The third chip is cut (834 to 1,226 px in a 1,120 px strip). The fourth and later chips are fully off screen.
  3. The recommended call moves the page, not only the strip. `scrollIntoView` scrolls all scrollable ancestors (MDN: "scrolls the element's ancestor containers"; the `container` option has the default `all`, "including the viewport": https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView). Measured in a 1440 x 600 window with the page scrolled down: `"before": html scrollTop 226`, `"after": html scrollTop 125`, `"stripScrollLeftAfter": 1261`. The installed TypeScript 6.0.3 DOM types have no `container` option. Use the same method as the item list (`item-list.tsx:159-167`) on the horizontal axis:

     ```tsx
     useLayoutEffect(() => {
       const strip = variants.current; // the element with class "review-variants"
       const chip = variant ? strip?.ownerDocument.getElementById(variant.id) : null;
       if (!strip || !chip) return;
       const box = strip.getBoundingClientRect();
       const rect = chip.getBoundingClientRect();
       if (rect.left < box.left) strip.scrollLeft -= box.left - rect.left;
       else if (rect.right > box.right) strip.scrollLeft += rect.right - box.right;
     }, [variant?.id]);
     ```

     I did not run this snippet in the app.

  4. The matrix sketch (idea 3) uses `ak.RadioGroup`. `docs/current-contract.md:192` says: "Run views and variants use navigation links with a bar glider; variant links replace the original U03 tabs." `contract-issue-1.md:280` says: "do not add grid semantics unless the interaction is actually a grid." A matrix must keep links, or it reopens that decision.
  5. The contract says "First visit uses its first variant" (`contract-issue-1.md:271`, `docs/review-guide.md:82`). The code selects the first variant that needs review (RULE-03). The reveal is needed with either rule.
  6. The scenario "only the WebKit variants changed" is constructed. Its rate in real pull requests is not known.

## REAL-09 · A direct link to an item far down the list does not bring its row into view

- Verdict: **confirmed**. I reproduced every number, and I proved the cause that the auditor left open.
- Severity: **medium**. Confidence is now high.
- Proof that I checked:
  - Same result as the auditor (`probe-reveal.out.txt`): index 0, 12, 350 visible; index 60, 150, 250, 450, 550 outside (`rowTop` 701, 1000, 873, 1614, 1715 in a 689 px list); index 625 cut (`rowTop 658`, row 60 px). After "Next screenshot": `"rowTop":636,"rowHeight":76,"listHeight":689` (cut by 23 px).
  - Cause, part 1 (timeline, index 550): the scroll position is set one time, then the row moves:

    ```
    {"t":26,"rowTop":2290,"scrollTop":38680,"scrollHeight":46622}
    {"t":65,"rowTop":1656,"scrollTop":38680,"scrollHeight":45907}
    {"t":99,"rowTop":1715,"scrollTop":38680,"scrollHeight":45973}
    ```

  - Cause, part 2 (code): the virtual list gives each row that it did not measure the average of the rows that it measured, and starts from `estimatedItemSize` (`apps/web/node_modules/@ariakit/react-components/src/collection/collection-renderer.tsx:254-286` `getAverageSize`, `:512-547` `getData`; package version 0.6.1). The app reveals one time for each change of its dependencies (`item-list.tsx:141-176`), and they do not change when rows are measured.
  - Cause, part 3 (second reveal with the app's own rule, run from the page): one more step is enough in 3 of 3 cases. `index 450: step 0 rowTop 1614 fullyVisible false → step 1 rowTop 613 fullyVisible true`.
  - Cause, part 4 (rows of one height, CSS injected, `estimatedItemSize` still 76): the row is fully visible for all 7 positions (60, 150, 250, 350, 450, 550, 625): `{"index":450,"fullyVisible":true,"rowTop":645,"rowHeight":44,"listHeight":689}`.
- Corrections:
  1. The cause is proved: rows of three heights (60, 76, 92 px) and one reveal. The exact text is "a running average that starts at 76 px", not "the 76 px estimate".
  2. The example "a link from a pull request comment" does not exist today. The only code that builds item links is `item-list.tsx:205-214` and `review-workspace.tsx:750-758`. The real triggers are a page reload, a copied address, and Back or Forward. The address always has `item` and `variant` after a selection, so a reload on a far item shows the bug.
  3. Alternative (a) is not available: `collection-renderer.tsx` has no call that scrolls to an index (no match for `scrollTo` or `scrollIntoView`). It has a fixed `itemSize` prop (`:1184`), which removes all measuring when rows have one height.
  4. The recommendation "one row height" works, also without a change of the estimate (part 4). The recommendation "reveal again" works (part 3). A repeated reveal must stop when the user scrolls. I did not test such a loop.
  5. The bug shows in long lists only: a closed or unchanged run (626 rows) or a large change. The list of a typical pull request (3 rows) is not affected.
  6. Not tested: the built app, Firefox, Safari.

## REAL-10 · The search reads variant keys and labels

- Verdict: **confirmed**.
- Severity: **low**.
- Proof that I checked: `item-list.tsx:45-64`. Recount with the same rule over the inventory (`census-check.out.txt`): `dark 619 | in name 4`, `light 623 | 8`, `safari 568 | 0`, `webkit 568 | 0`, `chrome 626 | 0`, `desktop 600 | 0`, `none 566 | 0`, `default 38 | 28`, `active 90 | 1`, `hover 27 | 27`, `forced 60 | 60`, `ariakit-ui-button 106 | 106`. Screen `12c-…` shows "Accepted (568)". No document names the scope of the search (grep over `docs/current-contract.md`, `contract-issue-1.md`, `docs/review-guide.md`). The browser tests search names only (`review.browser.test.ts:1897`, `:1921`).
- Corrections:
  1. "Cannot find names" is too strong. A name part with its hyphen works: `border-dark` is not in any variant key (keys have `desktop-dark-dark`). Terms are joined with AND (`item-list.tsx:57-63`), so `border dark` returns all `border` items.
  2. The count for `safari` comes from the project name inside the key. The label part says `webkit`.

## REAL-11 · The pixel metric line is wrong or empty for four of five kinds

- Verdict: **partly-confirmed**.
- Severity: **low**.
- Proof that I checked: `review-workspace.tsx:644-649`; added: `packages/cli/src/local-comparison.ts:245-252` (`changedPixels: candidate.width * candidate.height, ratio: 1`); removed: `packages/service/src/local-comparison.ts:247` (`resultJson: null`); size change: `packages/cli/src/png-comparison.ts:64-66` and `workflow-materialize.ts:351` (`maskExpected: !!result.mask`), then `screenshot-viewer.tsx:249-253`. Screens `60-…` ("100.00% changed · 56,576 changed pixels"; 416 x 136 = 56,576), `61-…` ("— changed pixels"), `63-…` ("Pixel changes are within the comparison tolerance." with "100.00% changed · 57,408 changed pixels").
- Corrections:
  1. The title counts too much. Wrong: the Difference text for a size change (this is VIEW-07). Empty: removed. True by the definition of the CLI, but not useful: added and size change ("100.00% changed"). True: unchanged ("0.00% changed · 0 changed pixels"). Rounding and grammar: "0.00% changed · 1 changed pixels". The Details panel prints four decimals (`review-workspace.tsx:494`).
  2. Additions and removals get an automatic approval in the normal path (`packages/service/src/local-comparison.ts:592-634`), so the line has low weight there.
  3. The snippet prints "undefined px changed" when `changedPixels` is absent (kinds `pending` and `error`, and old rows):

     ```ts
     : variant.changedPixels == null ? null
     : `${variant.changedPixels.toLocaleString()} px changed`;
     ```

  4. The client must derive the size change from the two images, as the snippet does. The server drops the `sizeChanged` flag of the receipt (`workflow-materialize.ts:345-353`).

## REAL-12 · The design lab fixtures do not have the production shapes

- Verdict: **confirmed**, with one wrong item in the gap list.
- Severity: **medium** (for the design task only; `apps/lab` is temporary and not tracked by git).
- Proof that I checked: `apps/lab/docs/fixtures.md:73-74` (12 items and 40 variants; 120 items and 600 variants), `:105` (SVG data URI), `:117`, `:119` (mask marks every pixel for a size change); `apps/lab/src/fixtures/data/review-builder.ts:82-85` (engine, codec, threshold), `:97-106` (short keys), `:157-172` (added without metrics; `candidateOmitted` with 2 to 9 pixels), `:219` and `:239` (thumbnail), `:248-253` (disabled reasons); `apps/lab/src/fixtures/data/review.ts:142-173`, `:178` (five variants), `:201-204` (key of two segments, human name). The production side: `packages/protocol/src/types.ts:130-131` (`playwright-pixelmatch-1.63.0`, `pngjs-7.0.0`), `review.ts:523-526`, `png-comparison.ts:64-66`. The lab files were last changed before the report was written (17:05 to 17:55; report 21:14).
- Corrections:
  1. Gap 11 ("Review data where `reference` and `candidate` are the same image object") is wrong. The lab does this for every unchanged variant:

     ```ts
     // apps/lab/src/fixtures/data/review-builder.ts:151-153
     const baseline = image("baseline", set.baseline, "baseline");
     let reference: ReviewImage | null = baseline;
     let candidate: ReviewImage | null = baseline;
     ```

  2. The replacement data is a model too (see "Method and limits"). It has no open run with zero changes and no main run (see "Missed" 4). Firefox and Safari variants reuse the Chrome picture.
  3. The 5 MB answers must not go into the lab bundle as they are. The auditor says so.

## Missed

1. **On a phone, the Screenshots dialog does not reveal the selected row at all.** Direct link to item 451 at 390 x 844, then "Screenshots": `{"fullyVisible":false,"rowTop":24304,"listHeight":627,"scrollTop":0,"scrollHeight":33804}` (`VERIFY/screens/v-phone-dialog-index-450.png`). The auditor did not test the dialog. Mobile is outside the launch validation scope (`docs/review-guide.md:94`).
2. **A removed item is hard to find at production scale.** A removal gets an automatic approval (`packages/service/src/local-comparison.ts:592-634`), so the item is "accepted" (`navigation.ts:17-41`) and goes into the closed Accepted group, as the last rows (`packages/service/src/local-comparison.ts:228-234`: `ordinal: receipt.captures.length + index`), with a green dot and "0 of 6 need review". The header says "0 of N need review". Nothing on the first screen says that screenshots were removed. `contract-issue-1.md:263` says that such items "remain visible". Screen `61-…` shows the row state; the generated data keeps the removed item in its old place, so the screen does not show the real position. Related: TRUST-04.
3. **The compact answer does not get small with production-shaped data, and the load lane's estimate is 2.3 to 2.6 times too low.** Production: 5,331,211 and 5,974,885 bytes for 3,832 variants (1,391 to 1,559 bytes for each variant, `live-authenticated.md:31-32`). The review-load lane measured 2,153,156 bytes for 3,582 synthetic captures (601 bytes each). In the generated answer, `label` plus `labelParts` are 1,522,762 of 5,212,685 characters (29.2%) for 66 distinct label sets, and `metadata` has 3,832 entries (1,402,513 characters, 26.9%), because the rendering profile digest includes the clip (`packages/protocol/src/hash.ts:82-95`; `packages/playwright/src/visual.ts:173`, `:233-235`), so almost no two variants share an entry (`compact-model.ts:74-81`). The metadata count comes from generated digests and from code reading, not from a production answer.
4. **The most common real state was not built or tested: an open run with no change (status `passed`), and a main run in the baseline.** The only no-change scenario is a closed pull request attempt with status `superseded`. The four read-only statements of REAL-05 do not apply to the open state.
5. **All UI measurements use device scale factor 1.** On a high-density screen, Fit and 100% have the same size for 89% of items but not the same rendering (smooth in Fit, `pixelated` at 100%; `screenshot-viewer.tsx:162`). The statements about the screen size of a 1 px change need a second measurement at factor 2.
6. **Options that reopen recorded decisions are not marked.** Item order (D29, `contract-issue-1.md:262`), the word "Accepted" (`docs/current-contract.md:194`, 2026-10-02), the count text (`contract-issue-1.md:261`), the thumbnail rule (`:262`), the zoom levels (`:264`), and variant links in place of tabs or radios (`docs/current-contract.md:192`). RULE-25 and RULE-26 list the same problem for the earlier lanes.
7. **The guide describes two behaviors that production does not have.** `docs/review-guide.md:27` (thumbnail rule) and `:35` ("Fit | Image scaled to the available viewer width").
