# Lane data-02, round 3: research record for D-DATA-02 (the capture list of a run, at hundreds of thousands of captures)

Date: 2026-10-06. Repository commit: `f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90`. The repository was read only. All files of this lane are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round3/data-02/`.

Loaded skills: `ariakit-general-workflow`, `ariakit-general-code-style`, `ariakit-ariakit-api-design`. The remote is `https://github.com/ariakit/visonaut.git`.

This record builds on the round before (`apps/lab/audit/reports/round-2/data-02/notes.md`). It uses the same real data (`tmp/round2/data-02/data/`) and the same row prototype (`check/pack-deep.ts` of that round, copied to `probe/pack-deep.ts`).

## The note and the answer

The maintainer selected "Pages of captures" (`paged-objects`) and wrote: "I feel like this is the most scalable option, right? We may have hundreds of thousands of screenshots in the future."

**Answer: partly.**

1. Yes: pages are the only form with no size limit for the stored list. One object must go through one Worker of 128 MB.
2. No: the option as revision r2 defined it (the records of today, split into objects) does not reach the number. It removes one stop of 13. The run still stops at about 5,700 captures in CLI 0.5.4. A page of 5,000 records has 16.06 MB (17.86 MB when every capture changed, which the real reader refuses). 100,000 captures are 320 MB.
3. The two ideas of r2 together reach it: rows inside pages, from the CLI to storage. 100,000 captures are 50 pages of about 0.83 MB (41.7 MB). 500,000 are 250 pages (224 MB). One step holds about 26 MB at most.
4. The capture list is not the only stop: 14 limits are at or below 100,000 captures (the independent check added the time of a capture job). Pages of rows with page-by-page readers remove 6. The 8 others are constants and settings.

**Recommendation (not a decision), as corrected by the independent check:** a path with two steps. Step 1 now: the format and the CLI become pages of rows, the review page reads one page at a time, the steps of Submit keep their code, stated limit about 20,000 captures (one Submit holds 56 MB there, in Node). Step 2 later: the steps of Submit page by page, service only. Option id `row-pages-staged`.

The sections below are the record of the first agent. Where the independent check corrected a number, the section "Independent check" at the end has the correct one. The largest correction: with the reader code of today, a review read holds 119 MB at 20,000 captures, not 48 MB.

**One question that changes the answer:** does "hundreds of thousands of screenshots" mean one run of that size, or the service in total over many repositories? Each limit is for one run. 30 repositories like Ariakit are 115,000 captures in the baselines, and no run is larger than today.

## A premise of the task text that the code corrects

The task text says "the 40,000 captures that the service accepts" as the last stop. Three stops are between 18,800 and 40,000 that r2 did not name:

- The Worker memory at declare (about 17,000, from the r2 measurement).
- The image bytes of one Submit: `maximumShardBytes` is 512 MiB (`apps/web/src/runtime-defaults.ts:9`), and the declare step compares the bytes of the image of each capture with it (`workflow-owned.ts:381`, `:538`, `:563`). At 18,548 bytes for each capture that is about 28,900 captures, also when no capture changed.
- So the r2 sentence "40,000 when few changed" was too high: about 28,900 with the settings of today.

## Facts from the code (read at commit f83fef6)

| Fact                                                                                                                                                                                                                                                                                                             | Source                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The inventory accepts 100,000 captures at most, and a pointer names 100,000 at most.                                                                                                                                                                                                                             | `apps/web/src/capture-inventory.ts:181`, `:367`, `:531`                                                                            |
| The protocol lists (tests, captures, local results, removals) accept 100,000 entries by default. `captureCount` of a reference is 0 to 100,000.                                                                                                                                                                  | `packages/protocol/src/validate.ts:114`, `:285`, `:304`, `:398`, `:408`, `:440`                                                    |
| Profiles: 10,000 in one manifest. The capture adapter validates its own manifest with the same function.                                                                                                                                                                                                         | `validate.ts:273`; `packages/playwright/src/reporter.ts:237-253`                                                                   |
| The capture adapter writes its manifest with an indent of 2.                                                                                                                                                                                                                                                     | `reporter.ts:254`                                                                                                                  |
| CLI: 8 MiB for each manifest file, 20 MiB for an image, 1 GiB of image bytes for one shard (also the combined one).                                                                                                                                                                                              | `packages/cli/src/files.ts:9-11`, `:112-120`; `bundles.ts:43-44`, `:130`                                                           |
| CLI: 1 to 16 capture bundles in one Submit.                                                                                                                                                                                                                                                                      | `bundles.ts:27`                                                                                                                    |
| CLI: an archive of a capture job has 5,000 entries at most, 4 MiB of directory, 1 GiB expanded.                                                                                                                                                                                                                  | `packages/cli/src/artifact-archive.ts:7-11`, `:59-65`                                                                              |
| CLI: the comparison runs in the CLI. It decodes the PNG of each capture before it compares the digests.                                                                                                                                                                                                          | `packages/cli/src/local-comparison.ts:215-256`                                                                                     |
| CLI: the declare request sends the complete manifest, and again after each renewal of the credentials.                                                                                                                                                                                                           | `packages/cli/src/engine.ts:463`, `:474-488`                                                                                       |
| Service limits: image 2 MiB, shard 512 MiB, run 2 GiB, staged 8 GiB, manifest 16 MiB, 40,000 captures, database admission 2 GiB, 5 active runs. Production uses the defaults.                                                                                                                                    | `apps/web/src/runtime-defaults.ts:7-18`; `apps/web/wrangler.jsonc:28`, `:64`                                                       |
| Worker limits in the configuration: `cpu_ms` 240,000 and `subrequests` 250,000.                                                                                                                                                                                                                                  | `apps/web/wrangler.jsonc:39-42`                                                                                                    |
| New runs need local comparison: "Server comparison no longer accepts new submissions." So `apps/compare` is not in the path of a new run.                                                                                                                                                                        | `apps/web/src/api/workflow-owned.ts:181-187`                                                                                       |
| Declare: parses the manifest, validates it against the complete baseline list, counts image bytes, writes one row in `ingest_staged_manifests`, stores the manifest in QUARANTINE, and inserts one row in `ingest_staged_images` for each image to upload. The answer has one upload ticket for each such image. | `workflow-owned.ts:476-759`; `workflow-evidence.ts:60-104`, `:178-209`                                                             |
| Baseline list for the CLI: 200 captures in each answer. Each answer reads the complete baseline inventory and sorts it.                                                                                                                                                                                          | `apps/web/src/api/local-comparison.ts:45`, `:177-241`, `:432-435`                                                                  |
| Submit validation: complete manifest, complete baseline list, 2 maps. For each capture it searches the profile list with `Array.find`.                                                                                                                                                                           | `local-comparison.ts:488-602`, `:540`                                                                                              |
| Materialization: builds each capture with `Promise.all`, searches the profile list and the test list for each capture, hashes 4 values for each capture, and gives the complete list to `commitShard`.                                                                                                           | `apps/web/src/api/workflow-materialize.ts:263-491`, `:298-359`, `:307`, `:337`                                                     |
| `commitShard`: one D1 batch (a read) for each 100 captures of the run, then one batch with an insert for each 100 changed captures, then the pointer update.                                                                                                                                                     | `packages/service/src/run-admission.ts:542-565`, `:568-613`, `:644`                                                                |
| Review: reads the run inventory and the baseline inventory, builds 2 lists and 2 maps, and returns one record for each capture.                                                                                                                                                                                  | `apps/web/src/api/review-inventory.ts:43-168`                                                                                      |
| The screenshot list of the review page draws only visible rows. Its test uses 1,000 items.                                                                                                                                                                                                                       | `apps/web/src/review/__tests__/scale.browser.test.ts:18-36`                                                                        |
| Promotion: reads the inventory with all checks, verifies 50 images that the run owns in one step, and reads the inventory again in the next step.                                                                                                                                                                | `apps/web/src/operations/promotions.ts:20`, `:41-111`, `:250-251`, `:302-321`                                                      |
| Recovery check: one inventory in each step, 50 of its images.                                                                                                                                                                                                                                                    | `apps/web/src/operations/recovery.ts:146-215`                                                                                      |
| History export: the stored document in parts of 128 KiB.                                                                                                                                                                                                                                                         | `apps/web/src/operations/history.ts:526-551`                                                                                       |
| A queue message is `{ kind: "ingest" }`.                                                                                                                                                                                                                                                                         | `workflow-owned.ts:1279`                                                                                                           |
| The Submit job of Ariakit has `timeout-minutes: 90`. It installs `visonaut@0.5.4`. The adapter is `@visonaut/playwright` 0.5.0.                                                                                                                                                                                  | `gh api repos/ariakit/ariakit/contents/.github/workflows/app.yml` lines 225-258, and `app/package.json:110` (GET, read 2026-10-06) |
| A test of the repository: "keeps native D1 writes constant as unchanged captures grow".                                                                                                                                                                                                                          | `apps/web/src/api/workflow-owned.test.ts:1399`                                                                                     |

## Facts from documents (each read 2026-10-06)

| Fact                                                                                                                                                                                                                                                                               | Source                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Workers Paid: "Each isolate can consume up to 128 MB of memory". CPU: 5 min at most for one HTTP request, 30 s by default. Subrequests: 10,000, up to 10 million. Request body: 100 MB on Free and Pro, 200 MB on Business. Queue consumer: 15 min of wall time.                   | https://developers.cloudflare.com/workers/platform/limits/ |
| R2: 5 TiB for one object, 5 GiB for a single-part upload, objects in a bucket: unlimited.                                                                                                                                                                                          | https://developers.cloudflare.com/r2/platform/limits/      |
| R2 standard storage: 0.015 USD for one GB-month. Class A: 4.50 USD for one million. Class B: 0.36 USD for one million. Free each month: 10 GB, 1 million Class A, 10 million Class B. Delete is free. PutObject and ListObjects are Class A. GetObject and HeadObject are Class B. | https://developers.cloudflare.com/r2/pricing/              |
| D1 Workers Paid: database 10 GB ("cannot be further increased"), "Queries per Worker invocation (read subrequest limits): 1000", 2 MB for one row or string, 100 bound parameters.                                                                                                 | https://developers.cloudflare.com/d1/platform/limits/      |
| D1 rows written: 50 million each month included, then 1.00 USD for one million. An index adds one row.                                                                                                                                                                             | https://developers.cloudflare.com/d1/platform/pricing/     |
| Queues: 128 KB for one message, consumer wall time 15 min, CPU up to 5 min with `limits.cpu_ms`.                                                                                                                                                                                   | https://developers.cloudflare.com/queues/platform/limits/  |
| GitHub Actions: 6 hours for one job on a GitHub-hosted runner, 256 jobs for one matrix.                                                                                                                                                                                            | https://docs.github.com/en/actions/reference/limits        |

The pages were read with a fetch tool that gives a summary of the page. Each number that the section uses was asked for as an exact quote. The D1 row "Queries per Worker invocation" has the words "(read subrequest limits)". The lane did not test if the raised subrequest limit of `wrangler.jsonc:41` raises it. The section says so and labels it as an assumption.

## Facts of earlier rounds that this lane used and did not measure again

- Sizes of the two formats for each capture: 3,172 to 3,190 bytes today, 400 as rows, 361 and 490 more for a changed capture (round 2, E2, E4, C1).
- Manifest: 1,472 bytes for each capture in the combined file, 1,832 in the request, 2,087 when every capture changed (round 2, E4, C1). The file of a capture job: about 2,122 bytes for each capture (round 2, C6, an estimate).
- The declare step holds 28.6 MB at 3,832 captures, 79.3 MB at 10,580, 150 MB at 20,000 (round 2, E7).
- One review read: 45.0 MiB at its largest point in workerd (audit, WAIT-06). The real reader holds 14.1 MB for one inventory (round 2, E7).
- D1: 66 rows written for a run of 100 unchanged captures through promotion (recorded probe of the repository). 64 rows plus 2 for the capacity check for a Submit with no change, and about 31 for each changed capture with a mask (round 2, lane d1-writes, `results/submit.txt`, one changed capture).
- CI times: step "Test visual" on Linux 9 min 24 s (median, n = 63), on Safari 10 min 20 s. Step "Submit captures" 2 min 27 s (median, n = 50). Source: audit lane gap-consumer-pipeline.
- The review model has about 600 bytes for each capture (audit, REVIEW-05).
- 3,613 profile digests with the real `digestJson`: 57 to 71 ms (round 2, E6). That is 17 µs for each.

## Experiments

Machine: Node v24.18.0, darwin arm64 (Apple M4 Pro), in-memory. Not a Worker. Run: `pnpm exec vitest run --config <lane>/probe/vitest.config.mjs` from the repository root. The cache and all outputs stay in the lane folder.

### X1. The shape of the real capture set

- Script: `probe/suite-shape.mjs`. Result: `results/suite-shape.json`.
- Expected: the task text says 626 screenshots in 3 browsers and 2 themes.
- Observed: 3,832 captures, 626 items, 66 variants, 6.12 captures for each item (523 items have 6, 58 have 4, 34 have 12). Chromium 1,316, Firefox 1,316, WebKit 1,200. Two capture jobs: linux 2,632 captures (2,520 different images, 2,486 profiles, 48.7 MB), safari 1,200 (1,175 images, 25.3 MB). 3,695 different images, 71,075,268 bytes, mean 19,236 bytes for an image, which is 18,548 bytes for each capture. Largest image 210,405 bytes. 12.48 captures for each test.

### X2. One page in both forms, at five page sizes

- Script: `probe/pages.probe.ts`. Result: `results/pages.json`. Log: `results/pages.log`.
- Method: the real inventory repeated to 100,000 captures (`scaleInventory` of round 2), put in the order of the capture identity (item, then variant, in byte order). Each page is self-contained: its rows and the lists that they name (tests, variants, profiles without the clip, comparison settings, image owners). Each row has one more column for the position in the capture order of the run. The record form of a page is the stored form of today for the same captures (`todayDocument`, the copy of the writer that round 2 checked against the stored bytes). Two cases: few changed captures (4 of each 3,832), and every capture changed (the synthetic form of round 2, C1).
- Check inside the probe: `canonicalJson(unpackInventory(page))` equals the canonical JSON of the same captures, for the fourth page at each size and in both cases. It passed.
- Expected: rows about 410 bytes for each capture and a small cost for the lists that each page repeats. Records about 3,200 bytes for each capture. A read of records much slower than a read of rows.
- Observed, the fourth page of the run, few changed and every changed:

| Page size |           Rows: bytes | Rows: digest, parse, build list | Rows: canonical check | Rows: bytes + text + parsed + list |          Records: bytes | Records: real read | Records: held by the real read |
| --------: | --------------------: | ------------------------------: | --------------------: | ---------------------------------: | ----------------------: | -----------------: | -----------------------------: |
|       500 |     213,167 / 459,075 |                  0.89 / 2.32 ms |        1.07 / 3.27 ms |                     1.23 / 2.08 MB |   1,617,376 / 1,798,288 |     51.6 / 51.1 ms |                 1.91 / 2.01 MB |
|     1,000 |     399,482 / 891,234 |                   1.57 / 4.2 ms |        1.97 / 6.71 ms |                     2.38 / 4.07 MB |   3,214,062 / 3,575,662 |   103.1 / 119.3 ms |                 3.71 / 3.99 MB |
|     2,000 |   837,598 / 1,821,325 |                  4.16 / 8.15 ms |       4.52 / 14.07 ms |                     4.83 / 6.43 MB |   6,473,490 / 7,197,040 |   217.1 / 396.5 ms |                 7.47 / 8.03 MB |
|     5,000 | 1,924,511 / 4,371,320 |                 6.71 / 19.02 ms |       10.0 / 34.44 ms |                    9.59 / 15.66 MB | 16,061,952 / 17,862,060 | 627.9 ms / refused |             18.52 MB / refused |
|    10,000 | 4,039,764 / 8,958,443 |                13.75 / 42.13 ms |      22.48 / 71.15 ms |                   19.61 / 31.81 MB | 32,028,308 / 35,644,826 |            refused |                        refused |

- "Refused": the real `readCaptureInventory` throws for a pointer above 16 MiB (`capture-inventory.ts:530`). The first run of the probe failed with that error. That is a finding: a page of 5,000 records is at the limit of one object.
- Totals at 100,000 captures (few / every changed):

| Page size | Pages |  Rows, all pages | Mean page | Largest page | Rows without the lists | Request pages, all | Largest request page | Records, all pages |  Index |
| --------: | ----: | ---------------: | --------: | -----------: | ---------------------: | -----------------: | -------------------: | -----------------: | -----: |
|       500 |   200 | 45.29 / 94.43 MB |   226,450 |      361,534 |               38.11 MB |   31.34 / 72.39 MB |              291,543 |   324.6 / 360.8 MB | 44,559 |
|     1,000 |   100 | 42.85 / 91.99 MB |   428,479 |      662,989 |               38.12 MB |   28.96 / 70.02 MB |              523,730 |   322.4 / 358.5 MB | 22,552 |
|     2,000 |    50 | 41.74 / 90.89 MB |   834,795 |    1,064,517 |               38.15 MB |   27.88 / 68.94 MB |              786,856 |   321.4 / 357.5 MB | 11,419 |
|     5,000 |    20 | 40.95 / 90.10 MB | 2,047,573 |    2,299,196 |               38.19 MB |   27.12 / 68.17 MB |            1,606,329 |   320.4 / 356.5 MB |  4,743 |
|    10,000 |    10 | 40.75 / 89.90 MB | 4,075,406 |    4,319,844 |               38.25 MB |   26.93 / 67.99 MB |            2,936,977 |   320.2 / 356.4 MB |  2,529 |

- Totals of larger runs (measured, not multiplied): 250,000 captures in pages of 2,000: 125 pages, 107.1 / 230.0 MB, index 28 KB. 500,000: 250 pages, 224.5 / 470.2 MB, largest page 1.41 / 2.39 MB, index 56 KB. With pages of 5,000: 103.8 / 226.7 MB and 211.6 / 457.4 MB.
- The suite of today (3,832): pages of 2,000 are 2 pages, 1,613,401 bytes (3,496,589 when every capture changed). One page of 5,000 is 1,598,684 bytes. The one object of round 2 is 1,583,117 bytes.
- Reading: the lists that each page repeats cost 8.6% at 2,000 and 6.7% at 5,000. The bytes for each capture grow a little with the run (417 at 100,000, 449 at 500,000 with pages of 2,000), because the names and the positions of the scaled data get longer. The calculator uses 420 and 490.
- One part of this probe is not used: `whole` (one object of rows at 100,000 captures) was measured on the sorted data, where the prototype stores the capture order of each capture in its last column. That inflates the object (46.7 MB). X3 measures it correctly (40.1 MB).

### X3. A reader that holds every capture

- Script: `probe/whole.probe.ts`. Result: `results/whole.json`.
- Question: at which size must the simple readers of step 1 stop?
- Expected: the straight line of round 2 (1.2 KB for each capture in a capture list).
- Observed (live heap and buffers, Node):

| Captures | One object of rows | Capture list from one object | Bytes + text + parsed + list of one object | The same list, built from pages of 2,000 |
| -------: | -----------------: | ---------------------------: | -----------------------------------------: | ---------------------------------------: |
|    3,832 |          1,578,043 |                       4.7 MB |                                     7.6 MB |                                   4.6 MB |
|   10,000 |          4,031,481 |                      12.1 MB |                                    19.6 MB |                                  12.2 MB |
|   20,000 |          8,021,269 |                      24.1 MB |                                    38.9 MB |                                  24.3 MB |
|   40,000 |         16,014,127 |                      48.3 MB |                                    77.9 MB |                                  48.5 MB |
|  100,000 |         40,093,620 |                     120.8 MB |                                   193.5 MB |                                 121.4 MB |

- Reading: 1.21 KB for each capture, the same from one object and from pages. A review read holds two lists (run and baseline): 48 MB at 20,000, 97 MB at 40,000, 242 MB at 100,000. So the limit of step 1 is 20,000 as a proposal: 48 MB is 38% of 128 MB, in Node. With pages, a reader never holds the text of the complete list, so its largest point is lower than with one object (38.9 MB for one object at 20,000).

### X4. The example, and how many baseline pages one page needs

- Script: `probe/example.probe.ts`. Result: `results/example.json`.
- The real run in pages of 2,000: 2 pages of 830,885 and 782,492 bytes, and an index of 913 bytes (with the first and the last capture identity of each page). First page: 154 tests, 30 variants, 40 profiles without the clip, 1 comparison setting, 2 image owners. Second page: 155 tests, 51 variants, 61 profiles. The section shows this index.
- Overlap test: a new run with the captures of the baseline, without each 20th item and with one new item of 6 variants for each 25 items. Both lists in identity order.
- Expected: about 2 baseline pages for each page of the new run.
- Observed: mean 1.98 and largest 3 with pages of 2,000 at 100,000 captures (99 reads for 50 pages). Mean 2.0 and largest 3 at 500,000. With pages of 5,000: largest 2 at 100,000 and 3 at 500,000.
- Reading: one step holds one page of the run and up to 3 pages of the baseline: 4 x 6.43 = 26 MB with 2,000 rows when every capture changed, 4 x 15.66 = 63 MB with 5,000.

### X5. The search of the profile list

- Script: `probe/quadratic.mjs`. Result: `results/quadratic.json`.
- Question: `local-comparison.ts:540` and `workflow-materialize.ts:307` call `manifest.profiles.find` for each capture. With 0.943 profiles for each capture the work grows with the square of the count. Is that a stop?
- Expected: seconds at 100,000 captures.
- Observed (the lookup alone, each 5th to 50th capture timed and multiplied): 28 ms at 3,832 captures, 569 ms at 20,000, 15.6 s at 100,000, 100 s at 250,000, 428 s at 500,000.
- Reading: materialization has 2 such passes in one invocation with 240 s of CPU: the stop is at about 280,000 captures, in Node. With rows the list has 40 to 81 entries and a row names its profile by position, so the search goes away.

### X6. Build, check, and browser

- `node apps/lab/audit/build.mjs --strict --content <lane>/content --out <lane>/out`: passed (16 sections, 52 decisions, 558 findings, 279 terms, 76 demos).
- `node apps/lab/audit/check.mjs --dir <lane>/out`: all checks passed (`results/check.log`).
- `probe/view.mjs` opened `out/index.html` in Chrome at 1440 px and at 400 px: no console error, no page overflow. It used both compare demos (each panel), the calculator of the path (100,000 captures and 16 jobs, Reset), the sequence (Next to step 11, Reset), and the calculator of the options (100,000 with 1% changed; 500,000 with every capture changed and pages of 5,000; 20,000; Reset). Each Reset gave the start state again. Text of each state: `results/view.json`. Pictures: `shots/`.
- The first view showed three tables wider than the column: a number cell does not wrap. `probe/edit-part-3.py` made the number cells short. The second view was correct.
- The section file is formatted with `pnpm exec oxfmt`.

## The path of one run: each stop, in the order in which a growing suite meets it

Formats and limits of today, few changed captures, two capture jobs with the split of today (the Linux job has 68.7%).

|   # | Stop                                       | Limit                               |                              Stops at | At 100,000                   | Removed by                                                      |
| --: | ------------------------------------------ | ----------------------------------- | ------------------------------------: | ---------------------------- | --------------------------------------------------------------- |
|   1 | Inventory as one object                    | 16 MiB                              |           5,260 (4,750 every changed) | 320 MB                       | pages (step 1)                                                  |
|   2 | Combined manifest file of the CLI          | 8 MiB                               |                                 5,700 | 147 MB                       | CLI writes pages (step 1)                                       |
|   3 | Manifest file of one capture job           | 8 MiB, 2,122 bytes for each capture |              5,750 (3,950 in one job) | 146 MB for the Linux job     | higher CLI limit, or more jobs                                  |
|   4 | Files in the archive of one capture job    | 5,000                               |              7,600 (5,200 in one job) | 65,800 files                 | higher CLI limit, or more jobs                                  |
|   5 | Manifest request                           | 16 MiB (and 100 MB of the platform) |                         9,150 (8,000) | 183 MB                       | CLI sends pages (step 1)                                        |
|   6 | Profiles in one manifest                   | 10,000                              |                                10,600 | 94,300                       | rows (step 1); a higher limit for the file of a job             |
|   7 | The complete list in each reader           | 128 MB                              | 10,400 (45.0 MiB at 3,832 in workerd) | 242 MB for two lists as rows | rows move it to 20,000 or more; page readers remove it (step 2) |
|   8 | Worker memory at declare                   | 128 MB, 7.46 KB for each capture    |                                17,000 | 746 MB                       | pages (step 1)                                                  |
|   9 | Image bytes of one Submit                  | 512 MiB                             |                                28,900 | 1.85 GB                      | setting                                                         |
|  10 | Captures that the service accepts          | 40,000                              |                                40,001 | refused                      | setting                                                         |
|  11 | Image bytes in the CLI                     | 1 GiB                               |                                55,600 | 1.93 GB                      | constant                                                        |
|  12 | Capture jobs                               | 16                                  |                  63,200 (with stop 3) | 13.3 MB for each job file    | constant, after stop 3                                          |
|  13 | Lists of the protocol and of the inventory | 100,000                             |                               100,001 | accepted                     | per page with pages                                             |
|  14 | Image bytes of one run                     | 2 GiB                               |                               115,800 | 86%                          | setting                                                         |
|  15 | Time of the Submit job                     | 90 min in Ariakit (6 h in GitHub)   |                     140,000 (560,000) | 64 min                       | one line in Ariakit, then not designed                          |
|  16 | Search of the profile list                 | 240 s of CPU                        |                               280,000 | 15.6 s for one pass          | rows (step 1)                                                   |
|  17 | Review model in one response               | none                                |                                  none | 60 MB                        | D-RUN-02, then pages (step 2)                                   |

Not stops: the queue message (it has no capture data), the GitHub check (counts only), R2 (object size and object count), the comparison Worker (`apps/compare` is not in the path of a new run).

Not verified: D1 documents 1,000 queries for each Worker invocation. `commitShard` sends one D1 batch for each 100 captures, which is 1,000 at 100,000 captures.

Changed captures add their own costs, which no format changes: about 31 D1 rows, 2 image uploads, 2 upload tickets in the declare answer, and one step of promotion for each 50 changed images of a main run (each step reads the complete inventory again today).

## Readers: who needs every capture at one time

None needs it when both lists are in identity order and the index holds the facts of the whole run (count, first and last identity of each page, digests). The section has the table. The checks that look like whole-run checks, and how they work with constant state:

- Each identity one time: the rows of a page are in strict order, and the first identity of a page is after the last identity of the page before. The index has both.
- Each capture ID one time: the ID is the run ID and the digest of the identity, so it follows from the line above.
- Removed captures: a baseline row with no new row in the key range of a page. The ranges of the pages cover all names.
- Totals (captures, changed, removed, images to upload): sums of the page results.
- The digest of the list: the digest of the index, which holds the digest of each page. D-RUN-03 (check the digest only) becomes the digest of the index and of each page that a read uses.

Open in this design, and named in the section as not built: the same image ID with two descriptions (`capture-inventory.ts:430-437`) needs a map of all image IDs today; the test list of a run (40,000 tests at 500,000 captures) and the check "each required test passed"; the capture order (`ordinal`) is a column, so a list in capture order needs a sort or a second index; a search by a part of a name in the unchanged list reads each page.

## D1

- The run writes 66 rows with no changed capture, in each option. The pointer update has 4 values (`run-admission.ts:644`). With pages they name the index.
- Each changed capture: about 31 rows (estimate from one capture). 100,000 captures: 66 rows with no change, about 31,000 at 1%, about 3.1 million when every capture changed (3.10 USD above the included amount).
- Pages add 0 rows. The pages that the CLI sends are objects in QUARANTINE, found by digest. Materialization writes run pages under keys that it can find again, so it needs no cursor row. A design with one D1 row for each page would add 50 rows at 100,000 captures (76% more than 66): rejected.
- Counted from code, not measured: `work_retention_pins` gets one row for each run that owns an image of the baseline, 2 times for a run (`local-comparison.ts:377-397`, `run-admission.ts:634-641`). That grows with the number of owner runs, not with the capture count and not with the format.
- Not measured: the bytes that a changed capture adds to the database (10 GB limit, admission stop at 2,048 MiB).
- The cutover of the baseline is as in round 2: 0 D1 writes when the reader of today stays for the baseline until the next main run, or 2 row updates with a conversion script.

## R2 cost of the capture list (prices of 2026-10-06)

- 100,000 captures, pages of 2,000: 50 request pages and 1 request index in QUARANTINE, 50 run pages and 1 index in IMAGES: 102 Class A operations = 0.00046 USD. Reads: 51 by the CLI, about 100 baseline reads at declare, 50 checks of stored pages, about 150 in materialization, 3 for a review page: about 355 Class B = 0.00013 USD. Storage: 41.7 MB = 0.0006 USD each month.
- 500,000 captures: 5 times that.
- The suite of today: 6 writes for a run in place of 2. With 680 runs each month that is 2,720 more writes: inside the free million.
- For comparison: 1,000 changed captures write 2,000 image objects: 0.009 USD.

## Options

| Option                                                                        | Largest run                                | D1 rows  | Changes                                                                                                                                 | Ariakit                                    | Effort |
| ----------------------------------------------------------------------------- | ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| `keep-format-refuse-early` (id kept, meaning kept)                            | 5,260 (4,750)                              | as today | alerts and one refusal                                                                                                                  | nothing                                    | S      |
| `row-pages-staged` (new, recommended; first named `row-pages-simple-readers`) | about 20,000, a stated limit               | as today | protocol, CLI (4 places), declare requests, `capture-inventory.ts`, the read of the review page, 3 limits of the job files, import tool | one pull request: CLI and adapter versions | L      |
| `row-pages-page-readers` (new)                                                | no limit from the list; next stops 9 to 15 | as today | step 1, and Submit validation, materialization, review list and API, promotion, recovery, history                                       | the same pull request                      | XL     |

Why the recommendation:

- The parts that need Ariakit (the format and the requests of the CLI) change one time. A second format later would need a second release, a second pull request in Ariakit, and a second change of the baseline.
- Step 2 is the large part, and the suite does not need it: 3,832 captures today, about 19 more each day, 20,000 in about 2.3 years.
- Step 1 costs little more than the one object of r2: 3 objects in place of 1, 1.61 MB in place of 1.58 MB, 6 R2 writes in place of 2.
- The page size is not in the format (the index names the count of each page), so 2,000 can change with no conversion.

What makes it wrong: a suite above 20,000 captures in the next year; a measurement in a Worker with much more memory than Node for two lists; a build of the CLI part that shows that the signed digest cannot be a digest of page digests.

Page size 2,000, not 5,000: one step holds 26 MB in place of 63 MB (4 pages, every capture changed); the suite of today is 2 pages, so the code for more than one page runs from the first day; the cost is 8.6% of repeated lists in place of 6.7% and 50 objects in place of 20 at 100,000 captures.

## Options and directions that left, with the reason

| Left                                                                  | Reason                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paged-objects` (the selection of the maintainer)                     | Its r2 meaning is "the records of today, split". Measured: it removes stop 1 only, the CLI stops the run at about 5,700, a page of 5,000 records has 16.06 MB, a read of 1,000 records takes 103 ms, 100,000 captures are 320 MB. No reasonable reader selects it over pages of rows. The two new options carry the intent of the note. The id is not used again. |
| `capture-rows-from-cli` (recommended in r2)                           | It is step 1 without the index: one object of rows, 16 MiB, about 18,800 captures that all changed. With the new fact about scale, pages later would need a second format and a second pull request in Ariakit. The new option costs 2 small objects more.                                                                                                        |
| `capture-rows` (rows in the service only)                             | It is the part of step 1 that can ship first. As an end state it stops at about 5,700.                                                                                                                                                                                                                                                                            |
| `capture-rows-cli-limits`                                             | Stops at 8,000 to 9,150, below the planning number, and the Worker holds 79 MB for the request at 10,580.                                                                                                                                                                                                                                                         |
| Capture rows in D1                                                    | 1,866 rows written against 66 for 100 unchanged captures. Standing rule 1.                                                                                                                                                                                                                                                                                        |
| One D1 row for each page                                              | 50 rows more at 100,000 captures. Standing rule 1. R2 shows the place of the work.                                                                                                                                                                                                                                                                                |
| One run for each capture job                                          | 66 D1 rows for each part run, and the baseline is still one list. Standing rule 1.                                                                                                                                                                                                                                                                                |
| A page that two runs share when no capture in it changed              | Saves most of the stored bytes (0.0006 USD each month for a run of 100,000), but a page then has more than one owner and each deletion rule must follow that. Possible later: the index already names pages by digest.                                                                                                                                            |
| gzip, with the format of today                                        | The limit protects memory, and the parsed size does not change (round 2).                                                                                                                                                                                                                                                                                         |
| One object, read as a stream of lines                                 | A read of one part cannot check the digest of the object, and a reader cannot jump to a range of names. Pages give both.                                                                                                                                                                                                                                          |
| The CLI sends one request of rows in step 1, and pages only in step 2 | Possible: one request of rows holds 20,000 captures (5.3 to 13.5 MB). But step 2 then needs a CLI release and a pin change in Ariakit. The lane kept the requests in pages from step 1 for that reason.                                                                                                                                                           |
| Pages of 5,000 rows                                                   | See "Page size" above. The suite of today would be one page.                                                                                                                                                                                                                                                                                                      |

## What changed in the content copy

- `content/sections/40-data-storage.html`: only the part from `<h3 id="data-inventory">` to the D-DATA-02 panel. The text before and after it is byte-identical to r2 (checked). The part has 72 KB in place of 58 KB.
- Left the part: the timeline of one read, the table of the bytes of one capture, the two size tables, the memory table, the table of the three answers of the run page, the list "What the rows cost", the alert code (it wrote a D1 event, which the settled form of D-DATA-01 does not do), and the table "Other hard limits of a run" (its facts are in the top table of the section and in the run page section).
- New ids in the part: `data-inventory-sizes`, `data-inventory-pages`, `data-inventory-page-size`, `data-inventory-path`, `data-inventory-readers`, `data-inventory-d1`, `data-inventory-outside`. Ids that left: `data-inventory-why`, `data-inventory-stops`, `data-inventory-fit`. No other file links to them (checked with grep).
- Demos: `demo-data-inventory-row` (compare, kept and updated), `demo-data-inventory-pages` (compare, new), `demo-data-inventory-path` (calculator, new), `demo-data-inventory-run` (sequence, new), `demo-data-inventory-size` (calculator, new content under the old id). `demo-data-inventory-read` (timeline) left.
- `decisions.patch.json`: 3 options. `terms.patch.json`: 6 new terms (capture page, page index, capture identity, Class A operation, Class B operation, subrequest) and 2 changed definitions (shared list, run inventory).
- The scripts `probe/edit-part-*.py`, `probe/path-rows.html`, `probe/path-outputs.json.txt`, and `probe/splice.mjs` are how the part was assembled. `section-part.html` is the part before formatting.

## For the coordinator: text outside this lane that the new state touches

1. `40-data-storage.html`, the lead and the stats at the top: still correct. The top table row of STORE-01 says "Format: D-DATA-02", still correct.
2. `15-your-answers.html` lines 56-62: the short question of D-DATA-02 is still right. Lines 545-551 ("the baseline in a new form: 0 or 2") are still right.
3. `15-your-answers.html` line 1432 (order of work: "D-DATA-02. Then D-RUN-02. Then measure one review read again before D-RUN-03"): still right. With step 2, D-RUN-02 and the unchanged list in pages are the same work.
4. `25-run-load.html` names gzip beside D-DATA-02 (round 2 question 4): still open.
5. The saved selection `paged-objects` of the maintainer is not a current option. The page clears it and shows the decision as open. `incorporated["D-DATA-02"]` must have `"selection": null` and the note of this round, or the build warns.
6. D-OPS-04 (API keys) changes how a CLI release reaches Ariakit. If the pins go away, a second CLI release costs less, and the argument "the CLI sends pages from step 1" gets weaker. The recommendation stays, because a second format also means a second change of the baseline.
7. The contract line 26 and decision D54 (numeric limits wait for measurements and a later approval): the recommended option states 20,000 as the capture limit of one run.

## Limits of what the lane checked

- Nothing ran in workerd or in production. All times and memory values are from Node on one laptop. The audit measured that workerd holds parsed objects in 15 to 21% fewer bytes, and not text or buffers.
- Nothing of the design is built: not the page and index requests of the CLI, not the staged pages in QUARANTINE, not the page-by-page steps. The sequence in the section is a design with counts from measurements.
- The data above 3,832 captures is the real inventory repeated with new names, digests, and clip rectangles. A real suite of 100,000 captures can have other name lengths, another share of profiles, and other captures for each test.
- The changed captures are synthetic (the form of the 4 changed captures of the fixture).
- The estimate for the manifest file of a capture job (2,122 bytes for each capture) comes from the combined manifest, not from a real job file.
- The times in CI (38 ms for each capture in the Submit step, 4.67 captures each second) are medians of today multiplied by the count. They are estimates.
- The D1 limit of 1,000 queries for each invocation was read, not tested.
- The transfer time of R2 in production is not known (audit, WAIT-02). The lane makes no time claim for it.
- The platform pages were read through a tool that summarizes them. The numbers agree with the round before where both read the same page.
- The lane sent no request to production. It read `ariakit/ariakit` with three GET requests of the GitHub API.

## Independent check (second agent, 2026-10-06)

The checker did not see the reasoning of the first agent, only its files. Loaded skills: `ariakit-general-workflow`, `ariakit-general-code-style` (remote `https://github.com/ariakit/visonaut.git`). The repository was not changed. All files of the check are in `check/`. The first draft is kept in `check/first-draft/`.

Verdict: sound after repairs. The answer to the note ("partly") is right and does not flatter. One number that carried the recommendation was wrong, and the recommended option changed its content because of it.

### What the check confirmed

- **Bytes.** `pages.probe.ts`, `whole.probe.ts`, and `example.probe.ts` ran again (418 s). Each byte count, each page count, and each memory value is the same as in the first run (`check/results-first/` against `results/`). 592 of 657 values of `pages.json` are identical, and each different value is a time.
- **Code lines.** Each cited line was opened at commit `f83fef6`: `capture-inventory.ts:55-56`, `:181`, `:186`, `:367-368`, `:430-437`, `:530-531`; `cli/files.ts:9-11`, `:112-120`; `cli/artifact-archive.ts:7-11`, `:59-65`; `cli/bundles.ts:27`, `:126`, `:130`; `runtime-defaults.ts:7-18`; `wrangler.jsonc:39-42`; `workflow-owned.ts:181-187`, `:381`, `:538`, `:563`, `:1279`; `local-comparison.ts:45`, `:177-241`, `:488-602`, `:540`; `workflow-materialize.ts:263-420`, `:307`, `:337`; `run-admission.ts:542-565`, `:568-613`, `:644`; `promotions.ts:20`, `:304`; `recovery.ts:146-215`; `history.ts:530`, `:549-551`; `reporter.ts:237-254`; `validate.ts:114`, `:273`, `:398`; `baseline-reset/reset.ts:32`; `workflow-owned.test.ts:1398-1399`. All are as the draft says. Submit validation has 3 calls for one run (`workflow-owned.ts:546`, `:1143`, `workflow-materialize.ts:273`).
- **Documents.** The checker downloaded the Markdown source of each Cloudflare page with `curl` (not a summary) on 2026-10-06, into `check/cf-*.md`: 128 MB "per-isolate, not per-invocation"; request body 100 MB on Free and Pro; R2 4.50 and 0.36 USD for one million and 0.015 USD for one GB-month; object 5 TiB; D1 10 GB, 1,000 queries for each invocation, 50 million rows written included and 1.00 USD for one million; Queues 128 KB and 15 minutes. GitHub: "Each job in a workflow can run for up to 6 hours of execution time."
- **Ariakit.** `gh api repos/ariakit/ariakit/contents/.github/workflows/app.yml` (GET): `timeout-minutes: 90` at line 228 and `visonaut@0.5.4` at line 252. Copy in `check/ariakit-app.yml`.
- **Arithmetic.** Each "Stops at" value of the path table was calculated again from its formula.
- **D1.** No write statement of declare, Submit, or materialization depends on the unchanged captures: `ingest_staged_images` and `visonaut_captures` get rows for uploaded images and changed captures only. `stagedCapability` (`workflow-owned.ts:250-275`) only reads, so a request for one page needs no D1 write. Pages add no row.
- **Retention.** The deletion of a run removes the prefix `runs/<id>/images/` when the run has an inventory (`operations/retention.ts:17-23`). Pages beside the index stay, as the one file stays today.

### What the check corrected

1. **The limit of step 1 (the claim that carried the recommendation).** The draft said: the readers keep their code, and a review read then holds two lists, 48 MB at 20,000 captures. Expected by the checker: more, because `readReviewInventory` builds more than the two lists. Measured (`check/review.probe.ts`, `check/review.json`): the real `completeReviewRows` on a copy of `readReviewInventory`, with both lists built from pages of 2,000 rows.

   | Captures | Two lists | With the values of `readReviewInventory` | With the review rows |
   | -------: | --------: | ---------------------------------------: | -------------------: |
   |    3,832 |    9.3 MB |                                  18.6 MB |              22.6 MB |
   |   10,000 |   24.2 MB |                                  48.6 MB |              59.3 MB |
   |   20,000 |   48.5 MB |                                  97.9 MB |             119.2 MB |
   |   40,000 |   97.1 MB |                                 195.9 MB |             238.6 MB |

   That is 5.96 KB for each capture, not 2.42 KB. The code makes `JSON.stringify(capture.metadata)` for each capture of both lists (`review-inventory.ts:23-31`) and one row with two JSON texts for each unchanged capture (`:138-163`). The review model and the response text are not in these numbers. With this reader the honest limit of step 1 is about 7,000 captures (three reads at the same time, finding WAIT-06), which is too near 5,700.

   Repair: the review read works page by page in step 1. It is the read that the settled answer of D-RUN-02 changes. The other steps keep their code.

2. **What the steps of Submit hold** was not measured in the draft. Measured (`check/submit.probe.ts`, `check/submit.json`), with the shapes of `validateLocalSubmission` and `materializeBundle` on a complete manifest and a complete baseline list from pages:

   | Captures | Manifest | Validation, baseline list alive | Materialization |
   | -------: | -------: | ------------------------------: | --------------: |
   |    3,832 |   3.9 MB |                         10.3 MB |         10.6 MB |
   |   10,000 |  10.1 MB |                         27.3 MB |         27.8 MB |
   |   20,000 |  20.1 MB |                         54.6 MB |         55.6 MB |
   |   40,000 |  40.1 MB |                        109.1 MB |        111.0 MB |

   That is 2.78 KB for each capture. The limit "about 20,000" now has this basis: one Submit holds 56 MB there, and two at the same time in one isolate hold 111 MB. The canonical texts and the D1 statements are not in the numbers. The number is not final until a Worker measurement (decision D54).

3. **The recommended option** got a new id and a new content: `row-pages-staged` ("Pages of rows now, Submit page by page later") in place of `row-pages-simple-readers`. The id was never published, so no saved selection exists for it.

4. **A stop was missing.** The capture job of Ariakit has `timeout-minutes: 120` (`app.yml:156`). At 4.67 captures each second, one job makes about 33,600 captures, and the Linux job has 68.7% of a run: the stop is at about 48,900 captures. The table has 18 rows now, and 14 limits are at or below 100,000 captures (8 stay with page readers).

5. **A reader was missing.** `referenceImageIds` (`local-comparison.ts:59-77`, used at `:470`) keeps a set of each image ID of the baseline in the isolate and reads the complete baseline to build it. The request of the CLI for a baseline image must name the page from step 1, or a later change needs a CLI release.

6. **The D1 query limit.** The draft said that nobody knows if the subrequest limit raises the 1,000 queries. The Workers page (updated 2026-09-05) says: "Subrequests to internal services: 1,000 [Free], Matches configured limit (default 10,000) [Paid]". The D1 page (updated 2026-04-21) says 1,000. The text names both and stays an assumption.

7. **The profile search** is not stable: 15.6, 37.7, and 16.8 s for one pass at 100,000 captures in three runs (`check/quadratic-second.json`, `check/quadratic-third.json`). The stop is "180,000 to 280,000", not "280,000".

8. **Two times of the page table** came from one noisy run: 397 ms for a page of 2,000 changed records was 225 ms in the second run, and 628 ms for 5,000 was 577 ms. The table says "about 220 ms" and "about 600 ms".

9. **"3.10 USD above the included amount"** was wrong as written: 3.1 million rows are 6% of the 50 million rows that the plan includes each month. They cost 3.10 USD only when the month is above that amount.

10. **The growth estimate** (20,000 captures in 2.3 years) assumes a straight line. The text now says that one new dimension in Ariakit doubles the count in one day, and the decision asks for the plan of the maintainer.

11. **Decision D54.** The draft said "You approve that number with the option". The text now says: the option approves the path, and the number is a setting that waits for a Worker measurement.

12. **Small things.** "The service part first needs one more change of the stored form" had no basis and left. The term "capture page" said 5,000 captures in a page, and the proposal is 2,000. The row "the review model" said step 2 for the unchanged list.

13. **Length and wording.** The decision text is shorter (the consequences of the recommended option had 276 words, now 245). The row names of the path table are short, so the table is less tall. Cut: the list of the three options (the panel explains them), two rows of the page table (10,000), the D1 column of the option table, one row of the directions, and two items of the last list. The part has 78 KB against 72 KB of the first draft, because of the new memory table, the new stop, and the new reader.

### Attempts to refute the recommendation

- **"The full design now is the right step, because the maintainer wants scale."** Not supported: also the full design stops at about 28,900 captures (512 MiB of images, a setting) and has 8 limits at or below 100,000. Its extra part is a rewrite of the two steps that check the trust of a run. The suite has 3,832 captures. It becomes right when Ariakit plans more than about 20,000 captures in the next year.
- **"A smaller step exists: one request of rows, pages only in storage."** True, and the first agent named it. The request of rows holds about 20,000 captures (5.3 to 13.5 MB), the same as the limit of step 1. It saves the page requests of the CLI now and costs a second CLI release and a second pull request in Ariakit later. Standing rule 3 (simpler for the consumer first) keeps the pages in the CLI. If D-OPS-04 removes the pins, this alternative gets cheaper. It is a real judgment, and the section names it in the item "What needs Ariakit happens one time".
- **A hidden D1 write.** None found. See "What the check confirmed".
- **A pull request from a fork.** No difference: the trusted Submit job builds the pages. The capture job still writes the file of today.
- **A run at 500,000 captures.** Step 2 holds 26 MB for one step. A large removal at one place needs more baseline pages for one page of the run, which is more reads and not more memory with a walk. Not solved by any option: the 5 h 20 min of the Submit step, 30 hours of capture time, 9.3 GB of images, and about 15 million D1 rows when every capture changed.
- **The contract.** Line 26 changes (stated). D54 is respected after correction 11.

### Standing rules and new facts against each option

| Rule                                | Keep the format                          | Pages now, Submit later                             | Pages and page readers now             |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| 1. No more D1 writes                | same                                     | same (0 or 2 row updates one time for the baseline) | same                                   |
| 2. No backward compatibility needed | not used                                 | used: old runs lose their list                      | used                                   |
| 3. Simpler, consumer first          | nothing for Ariakit, but the limit stays | one pull request                                    | the same pull request, XL service work |
| 4. Hundreds of thousands            | no                                       | format yes, steps later                             | list yes, 8 other limits stay          |
| 5. Other repositories               | no effect                                | limit can be a value of each project                | the same                               |

### Build, check, and browser

- `node apps/lab/audit/build.mjs --strict --content <lane>/content --out <lane>/out`: passed (16 sections, 52 decisions, 558 findings, 279 terms, 76 demos).
- `node apps/lab/audit/check.mjs --dir <lane>/out`: all checks passed (`check/check-final.log`).
- `check/view.mjs` in Chrome at 1440 px and 400 px: no console error, no page overflow, each demo of the part used (2 compare demos with each panel, the path calculator at 100,000 captures and 16 jobs, the sequence to its last step, the option calculator at 100,000, at 500,000 with every capture changed, and at 20,000), each Reset gives the start state. Pictures in `check/shots/`, text of each state in `check/view.json`.
- `check/outside-part.py`: the section copy is byte-identical to the record before the heading of the part and after its decision panel.
- `check/apply-patches.py` builds `content/decisions.json` and `content/terms.json` from the files of the record and the two patch files. The 51 other decisions are identical to the record.

### Limits of the check

- Nothing ran in workerd. Each memory value is live heap in Node. The audit saw 15 to 21% less for parsed objects in workerd, so the numbers are more likely high than low, but that is not measured here.
- The two new probes copy the loops of the service. Only `completeReviewRows` is the real function. The run and the baseline of the probes are the same captures.
- The design of the page requests, of the staged pages, and of the digests is still not built. The checker did not build it.
- The rows `3. Manifest file of a capture job` and `4. Archive of a capture job` still use the estimates of round 2 (2,122 bytes for each capture, 0.957 files for each capture).
- The archive reader of the CLI reads a 16-bit entry count (`artifact-archive.ts:56`), so one archive has 65,535 entries at most also with a higher constant. That is above each size of step 1 and is not in the section.

### For the coordinator

- The option ids of the patch are `keep-format-refuse-early`, `row-pages-staged` (recommended), and `row-pages-page-readers`. The id `row-pages-simple-readers` of the first result does not exist.
- `incorporated["D-DATA-02"]` needs `"selection": null` and the note of this round. The selection `paged-objects` is not a current option.
- `results/pages.json`, `results/whole.json`, and `results/example.json` are now the second run. The first run is in `check/results-first/`. `results/quadratic.json` is the first run.
