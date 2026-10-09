# Verification of lane `gap-storage-lifecycle` (R2 storage map and life cycle)

Commit `f83fef6`. Repository root: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. All repository paths below are relative to that root. `V/` means my scratch directory `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-storage-lifecycle/verify/`.

## Method

- I opened each cited file and compared the quoted code with the lines.
- I copied the auditor's probes to `V/probe/` and ran them again with my own Vitest config (`V/vitest.probe.config.mjs`, root = repository, cache in scratch). Command: `pnpm exec vitest run --config V/vitest.probe.config.mjs <name>`. All nine probes passed again. Raw results: `V/results/`.
- I wrote five new probes: `V/probe/v03-fix-emulation.probe.ts`, `V/scripts/reference-list-size.mjs`, `V/scripts/manifest-sections.mjs`, `V/scripts/r2-gzip-put.mjs` (local workerd 1.20260921.1 through Miniflare), and `V/scripts/submit-logs.mjs` (public GitHub job logs).
- I read three Cloudflare pages on 2026-10-05: [R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [object life cycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- Limits of my work: no production request, no Cloudflare account read, 25 read-only GitHub API calls. `git status --short` after my last probe: `M pnpm-lock.yaml`, `?? apps/lab/` (the same as before I started).

## Summary table

| ID       | Verdict                                                              | Auditor severity | My severity |
| -------- | -------------------------------------------------------------------- | ---------------- | ----------- |
| STORE-01 | partly-confirmed (finding correct, two option statements corrected)  | high             | high        |
| STORE-02 | partly-confirmed (count correct, one alternative has a wrong number) | medium           | medium      |
| STORE-03 | confirmed                                                            | medium           | low         |
| STORE-04 | confirmed (one sub-statement corrected)                              | medium           | low         |
| STORE-05 | confirmed (facts); the options are a judgment                        | medium           | low         |
| STORE-06 | confirmed                                                            | medium           | medium      |
| STORE-07 | partly-confirmed (facts correct, the code snippet fails on R2)       | low              | low         |
| STORE-08 | confirmed (the first recommendation has a side effect)               | low              | low         |
| STORE-09 | confirmed                                                            | low              | low         |
| STORE-10 | confirmed, with production data added                                | low              | low         |
| STORE-11 | confirmed (facts); the recommendation is a product judgment          | low              | low         |

No finding is refuted.

## STORE-01 · Inventory at 69.5% of its 16 MiB write limit

**Verdict: partly-confirmed. Severity: high.**

What I checked:

- `apps/web/src/capture-inventory.ts:56` has `export const maximumCaptureInventoryBytes = 16 * 1024 * 1024;`. Lines `468-470` throw `"Capture inventory exceeds its size limit."`. Line `530` applies the same limit on read. `apps/web/src/api/workflow-materialize.ts:377-386` puts `manifest` into the facts and `:403` writes them. All quotes are correct.
- I ran `inv-size` again. Result `V/results/inventory-size.json`: `"unchanged run": 11662476`, `"first full run": 11417201`, `"usedPercentOfLimit": 69.5`, `"bytesPerCapture": 3043`. The numbers are equal to the report. The gzip size was 1,446,560 (report: 1,446,402); the image IDs are random, so a small difference is normal.
- The failure path is as described. `reconcileStagedWorkflows` (`workflow-materialize.ts:894-949`) catches the error, counts it, and records `staged-reconciliation` with code `retry-delayed` after five failures. It does not fail the run. The run row already exists (`reserveRun` at `:721` is before the write at `:403`), so the run stays in `uploading`.
- The planning number is in `docs/simplification-audit/contract-issue-1.md:338`. `docs/current-contract.md:7` makes that file binding. The same paragraph group says that D54 selects "measure first, then approve numeric limits" (`contract-issue-1.md:340`). So 10,580 is a binding planning number, not an asserted limit.

What I searched for and did not find: an earlier clear check at declare time. `declareStaged` (`workflow-owned.ts:559-570`) checks only `maximumCaptures`, image counts, and bytes. The default `maximumCaptures` is 40,000 (`apps/web/src/runtime-defaults.ts:14`), which is seven times more than one inventory can hold.

Corrections:

1. **Two more limits are immediately behind this one, in the published CLI.** The finding does not name them. Measured with `V/scripts/manifest-sections.mjs` (`V/results/manifest-sections.json`):

   ```json
   "growthFactorToLimit": {
     "inventory 16 MiB": 1.439,
     "combined manifest file 8 MiB (CLI loadCapture)": 1.487,
     "linux shard manifest file 8 MiB (CLI loadCapture and archive)": 1.502,
     "profiles 10,000 (protocol validate.ts:273)": 2.768 }
   ```

   Sources: `packages/cli/src/files.ts:9` (`const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;`), used at `files.ts:46`, called at `engine.ts:778`, `bundles.ts:43`, `github-artifacts.ts:242`; and `packages/cli/src/artifact-archive.ts:10`. File sizes: combined 5,639,996 bytes, linux shard 5,585,113 bytes. Lane `gap-unexplained-waits` has the same numbers in `raw/a1-manifest-stats.json` and `raw/a2-combined-manifest.json`.

   Effect on the option "Minimal: raise the constant": it moves the stop from about 5,510 captures to about 5,700 (plus 3%). Then the CLI rejects the manifest with "A capture file is empty, is not a regular file, or exceeds its size limit." A CLI limit change needs a package release and a new pin in Ariakit.

2. **The first recommendation does not reach 10,580.** Estimate from the measured section sizes (same script): with the clip moved out of the profile, the inventory is about 9.50 MB, which gives about 6,760 captures at 16 MiB. With no profile bytes at all, the lower bound is 9.02 MB and 7,130 captures. 10,580 captures need 1,585 bytes for each capture or less. Today the value is 3,043.
3. The sentence "60% of it is a second copy of data" is not exact. After compaction (`compactInventory`, `capture-inventory.ts:330-361`) the embedded manifest is the only copy of the profiles and of the comparison settings. The repeated data is the identity of each capture in `captures`. The manifest is 60.2% of the object; that part is correct.
4. In the combined set, 3,613 profiles become 81 distinct profiles when the clip is removed (the finding quotes 54, which is the linux shard only).
5. The raw file `results/inventory-size.json` has a read median of 373 ms; the report says 396 ms. My run: 398 ms. This has no effect on the finding.

Feasibility of the alert snippet: correct. `recordEvent` (`apps/web/src/operations/common.ts:16-27`) takes `{ kind, subject, code, now }`. At 69.5% the alert at 80% does not fire today.

## STORE-02 · One Submit reads the complete reference inventory at least 27 times

**Verdict: partly-confirmed. Severity: medium.**

What I checked:

- `apps/web/src/api/local-comparison.ts:45` (`pageSize = 200`), `:334`, `:335`, `:432`, `:512`. `apps/web/src/inventory-records.ts` has no cache; each call goes to `readCaptureInventory`. The only cache is `referenceImageMemberships` (`local-comparison.ts:54-57`), used only by `referenceImage`.
- Callers of `validateLocalSubmission`: `workflow-owned.ts:546` (declare), `:1143` (finalize), `workflow-materialize.ts:273`. Callers of `referenceCaptureInputs`: `workflow-materialize.ts:275` and `:809`.
- The count: first page 3, pages 2 to 20 one each (19), validation 3, inputs 2. Total 27. Correct for 3,832 captures.
- I ran `r5-reference-reads` again: one page → `"inventoryGets": 1`; `referenceCaptureInputs` → 1. Equal to the report.

Corrections:

1. **27 is the minimum, and the finding does not name the multiplier.** Each credential renewal in the CLI reads all reference pages again:

   ```ts
   // packages/cli/src/engine.ts:416-431
   const reservation = await reserve(params);
   if (!reference) return reservation;
   const selected = await readReference({ ...params, reservation });
   ```

   A page response is valid for 600 s (`local-comparison.ts:448`). Renewals are at `engine.ts:810`, `:824`, `:583`, `:678`, `:842`. One renewal adds 20 page reads. A renewal inside the upload loop (`:583`, `:678`) also declares again (`engine.ts:475-490`), which adds one more. So a Submit with one renewal reads the inventory 47 or 48 times (computed from the call sites, not run).

2. **The alternative "Send the complete reference list in one response … about 1.2 MB" has a wrong number and does not work with the current CLI.** Measured with the real set (`V/scripts/reference-list-size.mjs`):

   ```json
   {
     "captures": 3832,
     "completeListBytes": 2395231,
     "bytesPerEntry": 625,
     "cliMaxResponseBytes": 2097152,
     "capturesAtCliLimit": 3355
   }
   ```

   The CLI stops a response above 2 MiB (`packages/cli/src/http.ts:3`, `:53-76`; `readReference` passes no larger limit). A larger page is possible only up to about 3,300 captures, or after a CLI release.

3. Production time, which the finding says is not measured, has a first bound. From six recent Ariakit runs with a successful `App / Visual Submit` job (`V/results/submit-logs.json`, public job logs):

   | Run         | Event        | Step "Submit captures" | CLI line                                                    |
   | ----------- | ------------ | ---------------------- | ----------------------------------------------------------- |
   | 37332053157 | push         | 157 s                  | `Visonaut staged 0 originals (0 reused, 0 uploaded) in 7s.` |
   | 37327336972 | pull_request | 175 s                  | `… in 6s.`                                                  |
   | 37257174700 | pull_request | 164 s                  | `… in 7s.`                                                  |
   | 37245978280 | push         | 227 s                  | `… in 11s.`                                                 |
   | 37246273066 | pull_request | 167 s                  | `… in 6s.`                                                  |
   | 37244087746 | pull_request | 179 s                  | `… in 11s.`                                                 |

   In run 37332053157 the CLI started at `15:46:10.4` and printed the staged line at `15:48:38.1` (`V/results/submit-job-111848936466.log:301-315`). So about 141 s pass before the upload phase of a run that uploads nothing. This time contains the artifact download, the combine step, the local decode of 3,832 images, and the 20 reference pages. The log does not separate them. The share of the inventory reads is still not measured.

4. The recommended cache is feasible and matches the existing pattern at `local-comparison.ts:57`. Two limits: a module cache is for one isolate only, and materialization runs from the queue or cron, so the five reads outside the page loop can be in another isolate. The D1 check of `reference_eligible` (`local-comparison.ts:85-93`) must stay outside the cache.

## STORE-03 · `inherited-by:` pins form a chain

**Verdict: confirmed. Severity: low (auditor: medium).**

What I checked:

- `packages/service/src/run-admission.ts:634-641` inserts `inherited-by:${run.id}` with reason `comparison` on each other owner. The only delete is `packages/service/src/retention.ts:206-210` in `completeRetiredRunDeletion`. `releaseExpiredComparisonReferences` (`retention.ts:20-24`) deletes only `comparison:` owners. I searched all sources for `inherited-by`; no other release exists.
- I ran `s3-imported-baseline` again. Final stage in `V/results/s3-imported-baseline.json`: pins `<import> <- inherited-by:run-b`, `run-b <- inherited-by:run-c`, `run-c <- inherited-by:run-d`, `run-c <- promotion:snapshot-D (baseline)`, `run-d <- promotion:snapshot-D (baseline)`; the imported image and the image of B are still stored; `publicImageImported: 200`. Equal to the report.
- I searched `docs/current-contract.md`, `apps/web/src/operations/README.md`, and `docs/baseline-delta-cutover.md` for a statement that makes this deliberate. I found none.

Why I lower the severity: the saved requirement says "Closed, **unpinned** run images remain available for 30 days" (`contract-issue-1.md:336`). These runs are pinned, so the text is not broken in the strict sense. The images are validated public images by design (D16). The kept bytes are only replaced main images (changed captures), which are small. The import itself stays for a correct reason as long as the current baseline names one of its images.

Corrections:

1. The condition that breaks a link is stricter than "a later run replaces every image of one owner". An owner is free only when each run that named it in an inventory has had its own bytes deleted. In the probe, `run-b` has no image in baseline D and is still held, because `run-c` is held.
2. I emulated the recommended change without a repository edit (`V/probe/v03-fix-emulation.probe.ts`): after each operations drain, one statement deletes `inherited-by:` pins of runs with `references_released_at` set. Results:
   - `V/results/v03a-main-chain-with-release.json`: chain A → B → C → D. Replaced images return 404, the two images of baseline D return 200, a new pull request against D shows all images with 200, the CLI reference download returns 200, runs A and B are `deleted`.
   - `V/results/v03b-open-pull-request-with-release.json`: a pull request open for 31 days against an older snapshot keeps all images (200) and the CLI reference (200), because `promotion:<snapshot>` and `comparison:` pins still hold the owners. After the pull request closes and 31 days pass, the images are deleted.

   So the recommendation works in these two cases. Not tested: old-form runs, workflow reruns that inherit shards (`run-admission.ts:331-335` uses the same owner name), and a run with a `manual` pin (the assertion at `retention.ts:14-18` blocks the release there).

3. The recommended statement runs only in the batch that sets `references_released_at`. A run that passed that step before the change keeps its pins. Production has no 30-day-old run now, so this has no effect today. A later change needs a one-time release.

## STORE-04 · After a D1 restore, objects written after the restore point have no row

**Verdict: confirmed. Severity: low (auditor: medium).**

What I checked:

- `apps/web/src/operations/recovery.ts`: `get` calls at `:98`, `:200`, `:220`; no `list`; no `quarantine`; `role='original'` at `:91`. Correct.
- I ran `r7-restore` again (`V/results/r7-restore.json`): three rows that point to deleted objects, four objects with no row, `inspectRecoveryImages` reports the three, no inspection reports the four (`"reported": false`), and the four remain 31 days later. `cliReferenceToSnapshotA0` is `404` before the first ordinary pass. Equal to the report.
- Platform: the R2 `list` call supports `delimiter` and returns `delimitedPrefixes` ("If a delimiter has been specified, contains all prefixes between the specified prefix and the next occurrence of the delimiter", R2 Workers API reference). The installed types have both (`apps/web/node_modules/@cloudflare/workers-types/index.d.ts:2482`, `:2623`, version 5.20260922.1). The recommendation is feasible. `ObjectStore.list` is at `apps/web/src/operations/types.ts:35-40` and has no `delimiter` field, as the finding says.

Why I lower the severity: the objects are private (the image route needs a D1 row), the amount is one restore window, and `docs/current-contract.md:244` says that hosted restore "remains **UNVERIFIED** and is not a required drill". The real gap is proof, not damage. One sentence of the saved requirement supports the finding and is not quoted in it: "Reconcile orphaned objects and interrupted imports" (`contract-issue-1.md:336`).

Corrections:

1. The sentence "`sanitizeRestoredDatabase` does not change … `work_retained_runs`" is not exact. It sets `closed_at`:

   ```ts
   // recovery.ts:62-65
   `UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,
     (SELECT closed_at FROM visonaut_runs WHERE id=work_retained_runs.id))`;
   ```

   It does not change `byte_state`, which is the fact that the finding needs.

2. The 420 MB number is an estimate from the run rate. I did not check it.

## STORE-05 · The `QUARANTINE` bucket no longer holds images

**Verdict: confirmed for all facts. The options are a judgment. Severity: low (auditor: medium).**

What I checked:

- Search for R2 writes in `apps`, `packages`, tooling (tests excluded): `quarantine.put` only at `apps/web/src/api/workflow-evidence.ts:203` and `apps/web/src/api/workflow-materialize.ts:707`. Images are written at `workflow-owned.ts:969` and `:1103` to `context.images`.
- `workflow-evidence.ts:86-87`: `objectKey: \`runs/${runId}/images/${imageId}\``and`quarantineKey: \`quarantine/staged/${runId}/${jobId}/${image.digest}\``. The second value is compared with the ticket at `workflow-owned.ts:1021-1023` and is not an R2 key.
- `workflow-owned.ts:182-187` rejects each new admission that is not `local-v1`. For `local-v1`, lines `1066-1106` skip the comparator call. Correct.
- `api/images.ts:24-27` reads `visonaut_images … WHERE id = ? AND validated = 1`. `README.md:15` says the same: "The public route serves only validated image records, not arbitrary bucket paths."
- History: direct upload to `IMAGES` started on 2026-09-24 (`git log -S'context.images.put(image.object_key'` → `494718f`, "Stage signed workflow captures until GitHub jobs complete (#19)"). The commit text gives no reason. I found no recorded decision that accepts the mixed bucket.

Why I lower the severity: nothing is exposed today. The exposure in the Impact field needs an operator to make `IMAGES` public, and the saved requirement forbids that ("never expose a mixed quarantine bucket or use development `r2.dev` as production delivery", `contract-issue-1.md:334`). The live bucket settings are not known to me or to the auditor.

Notes on the options:

- Option 2 is correct about the cost: the R2 Worker binding has no copy call, so a move between buckets is one `get` and one `put` in the Worker.
- Option 4 and the life-cycle idea: a rule for the complete bucket also deletes old-form objects under `manifests/<run>/`, which `hasReferencedManifest` (`workflow-retention.ts:98-106`) protects on purpose. A rule with the prefix `quarantine/staged/` and one with `plans/` does not have this problem. Rules select by prefix and apply to existing objects ("existing objects may experience a delay", object life-cycle page).

## STORE-06 · The full operations pass has no test on inventory runs

**Verdict: confirmed. Severity: medium.**

What I checked:

- I ran the census again from a copy (`V/scripts/test-census.mjs`, result `V/results/test-census.json`). The table is equal: `runOperations` 0 of 6, `expireRunImages` 3 of 12, `expireComparisonReferences` 0 of 2, `sanitizeRestoredDatabase` 0 of 21, `promoteBaselines` 8 of 23.
- I checked for indirect coverage that the script cannot see. `runOperations(` appears only in `core-storage.test.ts`, `main-retirement.test.ts`, and `operations.test.ts`; none of them has `sparseFixture` or an inventory. No test under `apps/web/src/api/` calls `expireRunImages` or `runOperations`.
- `apps/web/src/operations/sparse-storage.test.ts`: `captured(...)` builds the baseline; `referenceInventory: true` appears once (`:644`). The three tests that call `expireRunImages` on an inventory run are at `:401`, `:613`, `:634`.
- The import writes `closed_at = context.now()` (`apps/web/tooling/baseline-reset/reset.ts:298-311`), so no row in the new database can be 30 days old before 30 days after the import.

Limits: the census counts direct calls in the body of a test. The date "from 2026-11-03" comes from commit dates (`0b629ce`, 2026-10-04 23:42 -03:00). The real import time in production is not verified.

## STORE-07 · No code deletes run inventories

**Verdict: partly-confirmed. Severity: low.**

Confirmed facts:

- `apps/web/src/operations/retention.ts:22` returns `${owner.object_prefix}images/` when `inventory_key` is set; the comment at `:46` says "Keep sparse review inventories after their original images expire." No `delete` call names an inventory key. This is a deliberate rule (`docs/current-contract.md:26`: "Review reads the full inventory to show unchanged items").
- Size: measured again (11,662,476 bytes).
- Rate: computed again from `ci-runs.json` and `ci-jobs-sample.json`: 200 runs in 3.824 days; pull requests 17 of 50 and pushes 8 of 10 with a successful Submit; 86.4 service runs; 22.6 each day; 678 each month; 7.9 GB each month. Equal to the upper value of the report.
- Price: R2 pricing page: "Standard storage | $0.015 / GB-month", "Infrequent Access storage | $0.01 / GB-month", "Data Retrieval (processing) … $0.01 / GB", minimum "30 days", free "10 GB-month / month". Equal to the report.
- Life-cycle rules select by prefix only; the page shows no suffix or size filter and says "object lifecycles currently has a 1000 rule maximum". So no rule can select `runs/<run>/inventory/` for all runs.

Corrections:

1. **The recommended code does not work on R2.** I ran it in local workerd (`V/scripts/r2-gzip-put.mjs`, result `V/results/r2-gzip-put.json`):

   ```json
   {
     "streamPut": "TypeError: Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)",
     "bufferedPut": "ok",
     "plainBytes": 42904,
     "storedSize": 4954,
     "getReturnsGzipBytes": true,
     "storedContentEncoding": "gzip",
     "roundTripEqual": true,
     "gzipPutWithPlainSha256": "Error: put: The SHA-256 checksum you specified did not match what we received. …"
   }
   ```

   Three consequences:
   - The compressed bytes must be collected first, for example `await new Response(stream).arrayBuffer()`, and then written.
   - The current `sha256: digest` option (`capture-inventory.ts:481-484`) is the digest of the canonical JSON. With a gzip body, R2 rejects the write. The option must be removed or changed to the digest of the stored bytes.
   - `get` returns the gzip bytes and `size` is the compressed size. The reader checks `object.size !== pointer.bytes` and allocates `pointer.bytes` (`capture-inventory.ts:492`, `:547`). The pointer needs both sizes, and the reader needs `DecompressionStream`. `InventoryStore.put` accepts only a string today (`capture-inventory.ts:42-46`).

2. The Infrequent Access alternative saves $0.005 for each GB-month. At 95 GB that is about 0.43 USD each month (computed from the page prices), and each read then pays the retrieval price. The saving does not pay for a key migration.
3. The count in "What happens" for `inspectRecoveryInventories` is too low. See item 3 in "Missed".

## STORE-08 · 25 candidates that cannot be deleted stop all later image deletions

**Verdict: confirmed. Severity: low.**

What I checked:

- `apps/web/src/operations/retention.ts:50-57`: no cursor, `ORDER BY closed_at,id LIMIT ?`. Lines `65-75`: alert and `continue`, no state change. `hasMore` is set only at `:61` and `:109`.
- `claimExpiredRun` (`packages/service/src/work.ts:783-802`) has the same conditions as the candidate query, so no hidden second filter exists.
- I ran `r4-windows` again. `V/results/r4a-unsafe-prefix.json`: each call returns `"completed": [], "attentionCount": 25, "hasMore": false`; the normal run is still `live`; `"normalImagesLeft": 1`. Equal to the report.
- The same shape is at `apps/web/src/api/workflow-retention.ts:145-170`. Confirmed by reading; not run.
- Probability: current code writes only `runs/<uuid>/` and the import prefix, and both pass `imagePrefix`. I agree that the trigger needs a manual data change or a future prefix form.

Corrections:

1. The sentence about a delete that fails each time is true, but such rows do not stop the queue. A failed row is `deleting` with a 12-minute lease and is not a candidate during the lease, so later rows get their turn.
2. **The first recommendation adds a new stuck state.** No code resolves `retention:<id>:unsafe-prefix` except `resolveEvents` after a complete deletion (`retention.ts:134`), and `apps/web/src/api/operations.ts` has no action that resolves an event. If the query skips rows with an open alert, a row stays skipped also after an operator corrects its prefix. The alternative "put the prefix rule in SQL" or a cursor on `(closed_at, id)` does not have this effect.

## STORE-09 · Plan evidence has no reader and no deleter; `ingest_manifests.object_key` points to a deleted object

**Verdict: confirmed. Severity: low.**

What I checked:

- `apps/web/src/api/workflow-materialize.ts:687-710`: the plan key and the `quarantine.put`. `workflow-owned.ts:589` inserts `evidence_version` 1 for each new declaration, so `storageVersion` is 1.
- Search for `plan_object_key` in sources without tests: the only reader is `apps/web/src/operations/history.ts:503`. `archiveClosedRuns(` and `archiveHistoricalComparisons(` have no call site outside their own definitions.
- `workflow-materialize.ts:445-451` stores `bundle.manifestObjectKey` (`quarantine/staged/<run>/<job>/manifests/<digest>.json`, `workflow-owned.ts:581-583`). `workflow-retention.ts:201` deletes `quarantine/staged/<run>/`. `hasReferencedManifest` (`:98-106`) matches only `manifests/<run>/%`.
- Raw cost output (`results/upload-costs.jsonl`): each mode has `"store":"quarantine","operation":"put","bytes":545` in `materialize-total`, and the `retire` phase has one `quarantine.delete`.
- `docs/baseline-delta-cutover.md:148-149` has the two keep-list queries.

Corrections:

1. The effect on the runbook is smaller than the text suggests. A keep list that names objects that do not exist cannot cause a wrong deletion.
2. History that matters for the recommendation: `863ffc2` (#241, 2026-10-03) moved new evidence to D1 (version 2), and `6219fdf` (#247, 2026-10-04) made new declarations version 1 again. The D1 key forms in the code are from the first change. The recommendation to use them for the plan key is feasible, because `ingest_run_provenance.verified_json` already holds the same fields (`workflow-materialize.ts:742-752`).
3. For the life-cycle alternative, see the note in STORE-05 (use a prefix, not the complete bucket).

## STORE-10 · On the sparse path the reuse endpoint handles only changed images

**Verdict: confirmed. The keep-or-remove question is a judgment. Severity: low.**

What I checked:

- `packages/protocol/src/validate.ts:477`: `if (!manifest.localComparison || result?.outcome !== "unchanged") add(capture.image);`. `workflow-owned.ts:546-548` stages only that set. `packages/cli/src/local-comparison.ts:261-276` marks equal digests as `unchanged` with no download.
- `workflow-owned.ts:880-899` (source conditions), `:935-969` (`get` then `put`). `packages/service/src/run-admission.ts:553` accepts another owner only for `unchanged`. `capture-inventory.ts:128-133` requires the key under `runs/<image.runId>/`. `apps/web/src/operations/promotions.ts:51-55` verifies only images with `capture.image.runId === inventory.runId`. All correct.
- Raw cost output: `unchanged` has no `upload` and no `reuse` phase; `reuse-hit:reuse` is one `images.get` and one `images.put` of 94 bytes.

Addition from production (public job logs, `V/results/submit-logs.json`): six of six sampled Submit jobs on 2026-10-04 and 2026-10-05 printed `Visonaut staged 0 originals (0 reused, 0 uploaded)`. This confirms the title with real runs.

Correction to the recommendation: no new logging is necessary. The CLI already prints the two counts in each Submit job (`packages/cli/src/engine.ts:653-655`) and returns them in JSON mode (`:881-882`). The measurement is a read of existing job logs.

One more fact for the decision: when the service offers a reuse challenge, the CLI computes a proof and sends a reuse request for each upload page before any upload (`engine.ts:495-566`), also when no source exists.

## STORE-11 · A closed summary hides images that still exist

**Verdict: confirmed for all facts. The main recommendation is a product judgment. Severity: low.**

What I checked:

- `apps/web/src/api/review.ts:242` (`archive` from `run.detail_archived`), `:589-591` (`evidenceState: "summary"`, `imagesExpired: retained?.byte_state !== "live"`), `:364` (the inventories are read also for a summary).
- `apps/web/src/review/review-workspace.tsx:298` and `:805-813`: the text "Closed review summary" or "Image history expired", then "This view does not contain image bytes." The component is used by `apps/web/src/routes/runs.$runId.tsx:19`.
- `apps/web/src/api/review-inventory.ts:39`: `bytes_present: 1`.
- My runs: `V/results/s1-main-chain.json` → the current baseline has `"evidenceState":"summary","imagesExpired":false` and all image statuses 200. `V/results/s2-old-reference.json` → baseline B has `"imagesExpired":false`, both reference images 404, both candidates 200.
- `ui-copy/report.md:1051` has the proposed text "The images for this run are deleted. The decisions remain."

What the finding does not say: the summary without images is documented as deliberate. `apps/web/src/operations/README.md:28`: "At expiry, the read path serves a terminal summary. It does not rehydrate captures … A baseline can retain originals after its detailed review has closed." `docs/current-contract.md:184`: "Closed-run summaries must not promise image replay after unpinned bytes expire." So the two real defects are the meaning of the flag and the proposed text. To show images in a summary is a change of a selected behavior, not a bug correction.

## Missed

1. **The CLI manifest limit is the next hard stop after the inventory limit.** The combined manifest file is 67.2% and the linux shard manifest is 66.6% of the 8 MiB limit in the published CLI (`packages/cli/src/files.ts:9`, `artifact-archive.ts:10`). A change needs a CLI release and a new pin in Ariakit.
2. **Each CLI credential renewal reads all reference pages again** (`packages/cli/src/engine.ts:416-431`): 20 more complete inventory reads and one more declare for each renewal.
3. **`inspectRecoveryInventories` reads and validates the complete inventory again for each page of 50 images** (`apps/web/src/operations/recovery.ts:173`, `:197-217`). For one baseline with 3,695 images that is 74 complete reads, about 863 MB (computed, not run).
4. **R2 `put` rejects a stream of unknown length, and `get` returns stored gzip bytes without decompression** (measured in local workerd). Each compression design for inventories or manifests must buffer, and must change the `sha256` option and the size checks.
5. **An unchanged Submit takes 157 to 227 s in production with zero uploads** (six runs), and the CLI prints no time for the phases before upload. One timing line for each phase (download, combine, reference pages, local comparison) gives the missing share for STORE-02.
6. **The service advertises limits that one inventory cannot hold.** `maximumCaptures` is 40,000 (`runtime-defaults.ts:14`) and the inventory accepts 100,000 captures (`capture-inventory.ts:181`), but 16 MiB holds about 5,500 real captures. The profile limit of 10,000 (`packages/protocol/src/validate.ts:273`, `capture-inventory.ts:186`) is reached at about 10,600 captures with the current 0.94 profiles for each capture, which is the planning number itself.
7. **Each CLI request has a total limit of 30 s** (`packages/cli/src/http.ts:4`, `:135-151`). One declare request takes 6 to 11 s in production today (the "staged … in Ns" line), and the first reference page does three inventory reads in one request. The time of that first page is not measured.
8. **The complete reference list is 2.40 MB for the real set** (625 bytes for each entry), above the 2 MiB response limit of the CLI. A larger page size is limited to about 3,300 captures without a CLI release.
