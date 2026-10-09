# Verification of lane `gap-unexplained-waits`

Verifier: a second auditor, with no part in the first report. Date: 2026-10-06 (UTC). Repository commit `f83fef6`. Read-only.

Report under test: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-unexplained-waits/report.md`.
My scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-unexplained-waits/verify/` (named `<verify>` below). `<repo>` is the worktree.

## Short result

| ID      | Verdict                                                      | Auditor severity | My severity |
| ------- | ------------------------------------------------------------ | ---------------- | ----------- |
| WAIT-01 | confirmed                                                    | high             | high        |
| WAIT-02 | partly-confirmed                                             | high             | high        |
| WAIT-03 | confirmed                                                    | high             | high        |
| WAIT-04 | confirmed                                                    | medium           | medium      |
| WAIT-05 | confirmed (the limit); the failure path is code reading only | high             | high        |
| WAIT-06 | partly-confirmed                                             | medium           | medium      |
| WAIT-07 | partly-confirmed                                             | medium           | low         |
| WAIT-08 | partly-confirmed                                             | medium           | low         |

The local measurements of the auditor are sound. I built the fixture again with the real code and got the same bytes. I ran the main probes again and got the same counts and times within 5 to 14%.

The largest corrections are these:

1. WAIT-02: the "not split" part has three possible parts, not two. GitHub calls (0 to 1.0 s) are not excluded. The compression sketch fails on R2 as written (measured).
2. WAIT-06: the memory table comes from Node. Local workerd stores the same objects in about half the bytes, and the parsed inventories in 15 to 21% fewer bytes (measured). The table is an upper bound for workerd, not an estimate. The `sha256` sketch does not pass the repository type check (measured).
3. WAIT-07: the comment that the finding calls inconsistent is about another R2 object class. The inventory read for closed runs is deliberate. Without it, a closed run has no images at all (measured).
4. WAIT-08: my own 12 requests, at another edge location, show the wait on `/health` in 1 of 4 samples and on the static asset in 2 of 4. "The asset is not slow" does not hold in general. The recommended static shell moves the wait; it does not remove it.

## Method and limits

- I opened each cited file and line. All quoted code exists at the cited lines. I name each exception in the finding.
- I copied the probes to `<verify>/probe/` and changed only the scratch path (`<verify>/copy-probes.mjs`). No auditor output was overwritten.
- Production: 12 anonymous GET requests recorded (`<verify>/raw/cold-verify.log`). A first start of the same script was stopped by a session limit before it wrote a record; at most 3 more requests can have left the machine. Total: at most 15 of the 20 allowed. No POST, no cookie, no `/api/auth/*`.
- GitHub: 4 read-only `gh` calls.
- Not run again: the two CPU profiles, the Node heap-cap series, the 2x and 3x fixtures, and the 45 cold samples of the auditor. For these I checked the raw files against the tables.
- All local times are from one Apple M4 Pro. They are not Workers CPU times.

### What I ran again

Command form: `pnpm --dir <repo> exec vitest run --config <verify>/probe/vitest.config.mjs <probe>` with the same environment variables as the auditor.

| Measurement                                            | Auditor                           | Mine                                               | Raw file in `<verify>/raw/`             |
| ------------------------------------------------------ | --------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Run inventory bytes                                    | 12,154,546                        | 12,154,546                                         | `a2-fixture-x1.json`                    |
| Baseline inventory bytes                               | 12,153,016                        | 12,153,016                                         | `a2-fixture-x1.json`                    |
| Model bytes, state (a) / (b) / (c)                     | 5,332,737 / 5,332,792 / 6,347,544 | the same                                           | `a3-node-split-x1.json`                 |
| Node total, state (a) / (b) / (c)                      | 866.3 / 870.1 / 912.1 ms          | 850.9 / 829.6 / 822.4 ms                           | `a3-node-split-x1.json`                 |
| Node, canonical check, state (b)                       | 125.4 ms                          | 115.2 ms                                           | `a3-node-split-x1.json`                 |
| Node, expand and validate, state (b)                   | 636.7 ms                          | 605.4 ms                                           | `a3-node-split-x1.json`                 |
| D1 round trips in the model, (a) / (b) / (c)           | 15 / 10 / 8                       | 15 / 10 / 8                                        | `a3-node-split-x1.json`                 |
| D1 round trips, complete request, state (b)            | 16                                | 16 (96 statements)                                 | `a4-workerd-x1.json`                    |
| R2 reads and bytes, all states                         | 2 / 24,307,562                    | 2 / 24,307,562                                     | `a3-node-split-x1.json`                 |
| workerd `handleApi`, memory store, state (b)           | 696.4 ms                          | 598.0 ms (591 to 618)                              | `a4-workerd-x1.json`                    |
| workerd `handleApi`, local R2, state (b)               | 666.3 ms                          | 603.1 ms                                           | `a4-workerd-x1.json`                    |
| workerd `readReviewInventory`                          | 585.8 ms                          | 512.2 ms                                           | `a4-workerd-x1.json`                    |
| workerd, digest-only lever, `handleApi` memory / R2    | 158.1 / 162.7 ms                  | 158.4 / 162.7 ms                                   | `a4-workerd-x1-skipvalidate.json`       |
| Node, digest-only lever                                | 128.7 ms, same bytes              | 124.6 ms, same bytes                               | `a7-levers-x1.json`                     |
| Node, D1 rows only                                     | 7,483 bytes, 0 R2, 8 D1           | 7,483 bytes, 0 R2, 8 D1                            | `a7-levers-x1.json`                     |
| Fixture at 1.37x (5,250 captures)                      | 16,705,886 bytes, stored          | 16,705,886 bytes, stored                           | `a2-fixture-x1_37.json`                 |
| Fixture at 1.39x (5,326 captures)                      | throws                            | throws `Capture inventory exceeds its size limit.` | `a2-fixture-x1_39.json`                 |
| Calls in sequence in the model, D1, (a) / (b) / (c)    | 9.1 / 4.3 / 6.0                   | 9.0 / 4.1 / 5.9                                    | `a3-node-depth-x1.json`                 |
| gzip of the run inventory, level 6                     | 1,506,911 bytes                   | 1,506,911 bytes                                    | `checks.json`                           |
| Manifests: captures / profiles / distinct without clip | 3,832 / 3,613 / 81                | 3,832 / 3,613 / 81                                 | output of `<verify>/manifest-check.mjs` |

My workerd times for the current code are 10 to 14% lower than the auditor's. The lever times are equal. The machine load was probably different. The conclusion does not change.

## WAIT-01 · Each model read validates two 12 MB inventories again

**Verdict: confirmed. Severity: high** (the auditor gave high). Confidence: high for the local cost, medium for the share of the production wait.

### Proof that I checked

- `apps/web/src/capture-inventory.ts:552-553`: `const document = await readInventoryValue(object.body, pointer);` then `const inventory = await validatedInventory(expandInventory(document));`. Present.
- `:514`: `if (canonicalJson(parsed) !== encoded) {`. Present. `packages/protocol/src/hash.ts:4-44` builds the complete string again.
- `:402-410`: `digestJson`, `digestRenderingProfile`, `digestEnvironmentProfile` for each profile. 3 x 3,613 x 2 = 21,678. Correct.
- `:369` and `:193`: `parseManifest` runs two times for each inventory. `expandInventory` returns `{...value, ...}`, so `value.manifest` stays the raw object and `assertInventory` parses it again. Correct.
- `:465`: `await validatedInventory(inventory);` on write. `:479`: the key has the digest. `:509`: the read checks the digest. Correct.
- Times: see the table above. In my Node run, `readReviewInventory` is 780.7 ms of 829.6 ms (94%). In my workerd run it is 512.2 ms of 598.0 ms (86%).
- Lever: 598.0 ms becomes 158.4 ms in workerd (74%; the auditor measured 77%). 825.4 ms becomes 124.6 ms in Node (85%). The response is byte-identical (`responseEqualsCurrentCode: true`, 5,332,792 bytes).

### What I looked for to refute it

- A cache: none. I read `apps/web/src/capture-inventory.ts`, `apps/web/src/inventory-records.ts`, and `apps/web/src/api/review-inventory.ts` in full. No map or cache holds a read inventory or a validated digest.
- A test fixture that differs from production: the fixture model is 5,332,792 bytes and the production sample is 5,331,211 bytes. The second production sample (5,974,885) is the fixture plus the two "promoted history" strings: 168 bytes x 3,832 = 643,776, total 5,976,568. Both production values are about 1.6 KB smaller than the fixture (1,581 and 1,683 bytes). So the shape matches.
- A deliberate rule: yes, partly. The read validation is tested behavior. `apps/web/src/capture-inventory.test.ts:677-720` is named "validates expanded %s before returning public facts", and `:636-675` and `:722-739` test the compact form on read. The comment at `capture-inventory.ts:520` says "Verify the original wire document as well as its complete capture facts." So the cost is a design choice, not an accident. The auditor asks for a maintainer decision; that is correct.

### Corrections and additions

1. **Add this evidence for the recommendation.** The service already keeps a durable "validated" mark for the baseline half. `packages/service/src/baseline-promotion.ts:342` sets `inventory_verified=1` after promotion read and validated the object (`apps/web/src/operations/promotions.ts:304`). `apps/web/src/inventory-records.ts:87` refuses a snapshot without that mark. Then `:103` validates the same immutable object again on each read.

   ```ts
   // inventory-records.ts:87-89 and :103
   if (snapshot.inventory_verified !== 1) {
     throw new IncompleteError("The baseline inventory has not been verified.");
   }
   const inventory = await readCaptureInventory(context.images, header, maximumBytes);
   ```

2. **The production share is not measured.** The confirmed floor is 0.44 s (my workerd run) to 0.54 s (the auditor's run) of a 5.25 to 5.68 s wait, if a Workers core equals an M4 Pro core. No one measured the real factor. The title number (84 to 95%) is true only on a local machine with no network.
3. **The baseline shape is an assumption** (the report says so in open item 3). If the production baseline is the imported object with no manifest, the baseline half has no `parseManifest` and no `validateReceipt`, and the saving is smaller. One read-only query of `visonaut_snapshots.inventory_key` closes this.
4. **The "one time for each isolate" alternative depends on WAIT-08.** If the edge often starts a new instance after 10 s with no request (the inference of WAIT-08), a per-isolate `Set` helps receipts in a review session and almost never helps a page load.
5. **The sketch** drops the pointer checks of `:526-542` and the capture count check of `:561`. Keep them; they cost nothing. The new reader needs its own tests, because the tests above pin `readCaptureInventory`.
6. The 2x and 3x times (1.27 s and 1.91 s) come from a build with lifted limits. The real service cannot store those runs (WAIT-05).

## WAIT-02 · About 3.0 to 3.7 s of the production wait is not split

**Verdict: partly-confirmed. Severity: high** (the auditor gave high). The measured facts are correct. The split has a third possible part, and the compression sketch does not work as written.

### Proof that I checked

- 2 R2 reads, 24,307,562 bytes, in all three states. Reproduced.
- `apps/web/src/api/review-inventory.ts:44-48`: the second read waits for the first. Present.
- `capture-inventory.ts:481-484`: `store.put(objectKey, encoded, { httpMetadata: { contentType: "application/json" }, sha256: digest })`. Plain JSON. Present.
- gzip level 6: 1,506,911 bytes. `gunzipSync` 9.9 ms, `DecompressionStream` 20.3 ms (`<verify>/raw/checks.json`). Reproduced.
- Lever "two reads together" with 300 ms injected for each `get`: 1,446.5 ms becomes 1,122.2 ms. With no injected wait: 825.4 and 821.0 ms. Reproduced.
- Arithmetic: 5.25 - 1.5 - 0.70 = 3.05 and 5.68 - 1.3 - 0.66 = 3.72. Correct. With my workerd time (0.60 s) the range is 3.05 to 3.78 s.
- `apps/web/wrangler.jsonc:15-20` has `observability.enabled` and `traces.enabled`. `observability` is an inheritable key in the installed Wrangler 4.136.1 (`node_modules/wrangler/wrangler-dist/cli.js`, `observability: inheritable(...)`), so `env.production` has it.
- Platform: automatic tracing covers "Binding calls — Interactions with various Worker bindings such as KV reads and writes, R2 object storage operations" (https://developers.cloudflare.com/workers/observability/traces/). The same page says that automatic tracing is in "early beta". Log retention is "7 Days" (https://developers.cloudflare.com/workers/observability/logs/workers-logs/). I did not find the names of the CPU time and wall time fields on these two pages, so I cannot confirm the exact field names. The maintainer must look in the dashboard.

### Corrections

1. **The remainder can contain GitHub calls.** The report says that a GitHub permission call "can be in one sample, not in three in sequence". That is an assumption. The permission cache and the installation token are in isolate memory:

   ```ts
   // packages/security/src/authorization.ts:19-21
   const privatePermissions = new WeakMap<D1Database, Map<string, PrivatePermission>>();
   const privateReadLifetime = 60_000;
   // packages/security/src/github.ts:102
   const installationTokens = new WeakMap<typeof fetch, Map<string, InstallationToken>>();
   ```

   A request on a new isolate makes three GitHub requests in sequence (0.7 to 1.0 s, `audit/second-lens-4.md`, AUTH-03). A warm isolate with a grant older than 60 s makes one (0.2 to 0.3 s). `live-authenticated.md` does not record the time between the three run page samples. Also, WAIT-08 of the same report infers that the edge starts a new instance after 10 s with no request in most samples. If that is true, the three GitHub requests are in most page loads. The two statements cannot both hold. So the remainder has three possible parts: R2, CPU speed, and GitHub (0 to 1.0 s). The same trace shows all three: count the `fetch` spans to `api.github.com`.

2. **The compression sketch fails on R2 as written.** Measured in local workerd 1.20260921.1 (`<verify>/r2-stream-check.mjs`, raw output `<verify>/raw/r2-stream-check.json`):

   ```text
   put(key, <CompressionStream output>)
     TypeError: Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)
   put(key, <compressed bytes>, { sha256: <digest of the canonical JSON> })
     Error: put: The SHA-256 checksum you specified did not match what we received.
   put(key, <compressed bytes>, { sha256: <digest of the compressed bytes> })
     stored; size 245 for 200,012 raw bytes; after DecompressionStream the digest equals the canonical digest
   ```

   So a real change must: collect the compressed bytes in a buffer before `put`; pass the digest of the compressed bytes (or no `sha256`) to `put`; and change the size check at `capture-inventory.ts:547` (`object.size !== pointer.bytes`), because the stored size is no longer the canonical size. The pointer needs two sizes, or the check must move after decompression. The `InventoryStore.put` type (`capture-inventory.ts:42-46`) accepts only `string` today. Old objects stay uncompressed, so the reader must accept both forms. This is effort M, as the report says, but the sketch hides these four points.

3. **Local CPU varies by run.** The auditor measured 0.66 to 0.70 s; I measured 0.60 s. Use 0.6 to 0.7 s.
4. The option "start the two reads together" is correct. `visonaut_comparisons.reference_snapshot_id` exists before the first read, and for a closed summary the batch at `closed-summary.ts:32` already returns it.

## WAIT-03 · The first response carries 3,828 unchanged variants to show 4 changed ones

**Verdict: confirmed. Severity: high** (the auditor gave high). It needs a contract decision, as the report says.

### Proof that I checked

- Lever "D1 rows only", my run (`<verify>/raw/a7-levers-x1.json`): 7,483 bytes (gzip 2,150), 0 R2 reads, 8 D1 round trips in the model, 4 variants, 0 with a reference image, 4 with a candidate image. Current code: 5,332,792 bytes (gzip 681,328), 2 R2 reads, 10 D1 round trips. Equal to the report.
- `apps/web/src/api/review.ts:442-446`: the reference comes from `row.reference_capture_id` or from the inventory. Present.
- `packages/service/src/local-comparison.ts:325-327`: the insert writes `NULL` for `reference_capture_id`. Present.
- `apps/web/migrations/0014_visonaut_brand.sql:52` creates `visonaut_images_run`; `:54` creates `visonaut_images_run_role_key`; `0032_upload_indexes.sql:1` drops it. The table itself (`0001_service.sql:62-74`, renamed at `0014_visonaut_brand.sql:21`) has the primary key `id` and a unique `object_key`. No index on `digest` exists. Correct.
- Model bytes, my count on the rebuilt model: `images` 947,744, `metadata` 1,322,359, `label` about 0.44 MB, `id` prefix 283,568 (`comparisonId:runId:` is 74 characters x 3,832). Equal to the report.
- `docs/current-contract.md:26`: "Review reads the full inventory to show unchanged items." `:148`: P01 "One compact complete model". Present.

### Corrections and additions

1. **"4 changed" is invented fixture data** (the report says so in open item 4). The production samples had all 626 items in "Accepted" (`live-authenticated.md:38`). The ratio in the title is a property of the fixture.
2. **The decision P01 asked for a measurement before a new endpoint.** `docs/simplification-audit/audit-data.json`, P01, recommendation: "Keep one request while reducing proven repetition. ... A new page/detail protocol should have a measured reason." The numbers of this lane are that reason. This supports the question to the maintainer; it does not answer it.
3. **A D1-only response is also incomplete for removed captures.** By code reading: for a removed row the candidate is `null` and the reference comes only from the inventory (`review.ts:437-447`). Without it, `metadata` is `{}`, so the item name falls back to the item key, the label has only the variant key, and the row has no image. The recommendation "store the reference image identity with the changed row" must also store the name and the variant of a removed capture. The fixture has no removed capture, so this is not measured.
4. **A cheaper minimal step exists and is not in the report.** In the rebuilt model, `images[].url` repeats `images[].id` (`"/images/" + id`): 299,719 bytes, 5.6% of the response. All 3,613 `metadata` entries have the same value for `referenceProfile` and `candidateProfile`. Sending one value when the two are equal needs no new endpoint.
5. Contract `:194` (decision of 2026-10-02) keeps items with a new variant in the main list. Those are stored rows, so a split response keeps them in the first response. No conflict.

## WAIT-04 · Almost each capture has its own profile, because the clip rectangle is part of the profile

**Verdict: confirmed. Severity: medium** (the auditor gave medium). The recommendation changes a contract rule that the report does not cite.

### Proof that I checked

- My count on the two real manifests (`<verify>/manifest-check.mjs`): linux 2,632 captures, 2,486 profiles, 54 distinct without the clip; safari 1,200, 1,127, 27; combined 3,832, 3,613, 81. All 3,613 profiles have a `clip`. 3,096 have `captureMethod: "shared-full-page-crop-v1"`. 78 linux profiles and 39 safari profiles serve more than one capture (maximum 9).
- `packages/playwright/src/visual.ts:173`: `...(options.screenshot?.clip ? { clip: { ...options.screenshot.clip } } : {}),`. Present. `:154` puts it in `profile.captureOptions`.
- `packages/protocol/src/hash.ts:97-103`: `digestEnvironmentProfile` removes the clip. Present.
- Bytes: `manifest.profiles` is 2,645,645 bytes of the stored 12,154,546-byte inventory (21.8%). My count (`<verify>/raw/checks.json`). The combined manifest file is 5,639,996 bytes.
- Model: 3,613 `metadata` entries, 1,322,359 bytes. Reproduced.
- 10,000 / 3,613 x 3,832 = 10,606 captures for the profile limit. Correct.

### Corrections and additions

1. **The clip in the rendering identity is a written rule today.** `docs/current-contract.md:107`: "Rendering identity records the browser, OS, fonts, viewport, locale, media, and screenshot settings." `:124`: "A profile change with nonzero changed pixels requires review even within the pixel caps." The CLI implements it:

   ```ts
   // packages/cli/src/local-comparison.ts:290
   profileChanged: capture.profileDigest !== accepted.profileDigest,
   // packages/cli/src/png-comparison.ts:82
   (profileChanged && changedPixels !== 0) ||
   ```

   So moving the clip out of the profile changes two behaviors: approval reuse (`:184`, cited by the report) and the rule of `:124` for a clip-only change. The report cites `:184` only.

2. **With the present consumer settings the second behavior does not change a result.** All 3,832 captures have the same comparison (`"threshold": 0.2, "maxDiffPixels": 0`; the model has 1 distinct metadata entry without the profile digests). With an allowance of 0 pixels, `profileChanged` cannot change an outcome. It matters only for a consumer with a pixel allowance.
3. **The maintainers already treat the clip as a special case.** `hash.ts:97`: "Content clipping can change with a defect without a trusted-plan rollout." `packages/protocol/src/types.ts:201`: "Effective content clip bounds are excluded." So the present state is a partial, deliberate choice, not an oversight.
4. **The digest times are CPU profile shares, not wall time.** I timed the 21,678 digests alone in Node with my own canonical function: 374.6 ms of wall time (`<verify>/raw/checks.json`). In Node each digest waits for the thread pool. The report's 128 ms (workerd) and 186 ms (Node) are active CPU from the profiles, which I did not run again.
5. The minimal alternative "send the two digests on demand" needs a new endpoint. See WAIT-03, addition 4, for a step that needs none.

## WAIT-05 · A run with more than about 5,270 captures cannot be stored

**Verdict: confirmed for the limit and for the disagreement of the limits. The failure path is confirmed by code reading only; neither the auditor nor I ran it. Severity: high** (the auditor gave high). It is a capacity limit with a bad failure mode, not a defect that occurs today.

### Proof that I checked

- `apps/web/src/capture-inventory.ts:55-56` and `:468-470`. Present.
- My rebuild: 5,250 captures give 16,705,886 bytes (99.6%, ratio inventory/manifest 1.729). 5,326 captures throw `Error: Capture inventory exceeds its size limit.` (`<verify>/raw/a2-fixture-x1_37.json`, `a2-fixture-x1_39.json`).
- Each row of the limits table: `packages/cli/src/files.ts:9` (8 MiB), `packages/cli/src/engine.ts:778` (`loadCapture`), `packages/cli/src/bundles.ts:126` (compact JSON), `packages/cli/src/artifact-archive.ts:10` (8 MiB), `apps/web/src/runtime-defaults.ts:12` and `:14`, `packages/protocol/src/validate.ts:273`, `capture-inventory.ts:181`, `packages/compare/src/types.ts:10-11`. All present with the cited values. The computed percentages are correct.
- The failure path, by code reading: `workflow-materialize.ts:403` throws a plain `Error`. In `reconcileStagedWorkflows`, `:900-909` counts the failure; the error is not a `SecurityError` with `stale_reference` and not a `StagedOriginalUnavailableError`, so `run` is `null` at `:913-921`, `terminalFailure` is `false`, and `:927-934` records `retry-delayed`. The query at `:871` takes the stage again when `last_checked_at` is older than one hour (`:826`), while the stage is younger than 24 hours (`workflow-retention.ts:6`). This agrees with the report.

### Corrections and additions

1. **The window with the bad failure is narrow: about 5,270 to 5,700 captures.** Above about 5,700 the CLI stops first, before any upload, with a size error (`files.ts:25-28`: "A capture file is empty, is not a regular file, or exceeds its size limit."). The report's table shows this, but the title does not.
2. **One change of the consumer's matrix reaches the limit.** The real run has three projects: linux chromium 1,316 captures, linux firefox 1,316, safari 1,200 (`<verify>/raw/checks.json`). One more project of 1,316 captures gives 5,148, about 97% of the limit (computed from the measured bytes for each capture). One more theme or viewport for all items is over the limit. This supports the severity.
3. **A run that fails this way keeps a capacity slot** (code reading, not run). `reserveRun` runs before `materializeBundle` (`workflow-materialize.ts:721`, then `:766`), so the run stays `active = 1` and `state = 'uploading'`. The admission count includes it:

   ```ts
   // apps/web/src/capacity.ts:41
   (SELECT COUNT(*) FROM visonaut_runs WHERE active=1 AND state IN ('uploading','comparing')) AS active_runs
   ```

   With `maximumActiveRuns: 5` (`runtime-defaults.ts:17`), five such runs pause all new runs (`capacity.ts:108-113`). When the test suite is over the limit, each pull request makes such a run.

4. **The ratio 1.73 is not a constant.** It depends on the image identity. With run-owned image identities (UUID and `runs/<uuid>/images/<uuid>`) in place of the import identities, the same inventory is 11,664,562 bytes, 4.0% smaller (`<verify>/raw/checks.json`, computed). A check before the upload must use a safe bound, not the measured ratio.
5. Kind: I would call it a limit and a failure mode, not a bug. No run fails today (72.4%).

## WAIT-06 · Three model reads at the same time need 105 to 109 MB of live JavaScript heap

**Verdict: partly-confirmed. Severity: medium** (the auditor gave medium). The Node numbers are consistent with the raw data. They do not transfer to workerd as written.

### Proof that I checked

- The table against `raw/a5-heap-caps-x1.json`: one read fails at 48 MiB and completes at 56; two reads fail at 80 and complete at 88; three reads fail at 104 and complete at 112. The heap after a full collection in the completed runs is 44.1 to 50.7, 71.3 to 80.0, and 105.3 to 108.6 MB. Equal to the report. I did not run this series again.
- `capture-inventory.ts:492` (buffer), `packages/protocol/src/hash.ts:47` (copy), `apps/web/src/review/client.ts:306` and `:326-336` (admission in sequence, one poll loop for each command), `apps/web/src/api/review.ts:814` (model for each ready receipt). All present.
- The client does start overlapping saves: `apps/web/src/review/use-review-session.ts:286-305` calls `commands.save` for each queued entry at once. So three model builds at the same time are a normal case of fast keyboard review, not a rare case.
- Platform text: "Each isolate can consume up to 128 MB of memory, including the JavaScript heap and WebAssembly allocations.", "This limit is per-isolate, not per-invocation.", "When an isolate exceeds 128 MB, the Workers runtime lets in-flight requests complete and creates a new isolate for subsequent requests." (https://developers.cloudflare.com/workers/platform/limits/). Equal to the report.

### Corrections

1. **Node overstates the workerd heap.** workerd uses compressed pointers; Node 24 does not. Cloudflare states it ("Cloudflare Workers ... has been running in a ... configuration of v8 that enables pointer compression", https://github.com/nodejs/node/issues/55735). I measured it (`<verify>/pc-check.mjs`, `<verify>/pc-check3.mjs`; raw `pc-check.json`, `pc-check3.json`):

   ```text
                                                        Node 24.18.0   workerd 1.20260921.1   ratio
   2,000,000 objects { a, b }, bytes for each           48.0           23.9                   0.50
   the two real inventories after JSON.parse, MiB       25.3           20.1                   0.79
   the same plus one JSON string for each capture, MiB  35.3           30.0                   0.85
   ```

   Method for workerd: `Runtime.getHeapUsage` after `HeapProfiler.takeHeapSnapshot`, which makes a full collection (the control after a clear is 0.4 MiB, equal to the empty isolate). This also answers the report's limit "workerd gives no live-heap number": the snapshot call works where `HeapProfiler.collectGarbage` does not.

   So "105 to 109 MB" and "82 to 85% of the limit" are an upper bound for the workerd JavaScript heap. With the two measured ratios the same three reads are about 83 to 93 MB. This is a scale of a Node number by a ratio from a part of the data, so it is an estimate, not a measurement. The capture counts in the impact text (4,500 to 4,700 for three reads) move up by the same share, to near or over the 5,270 limit of WAIT-05. I did not measure a complete read in workerd.

2. **Buffers and the hosted count stay open.** Both the report and `docs/evidence/worker-memory/README.md` say so. I have no better number.
3. **The `sha256` sketch does not pass the type check.** Measured with the repository compiler (`node_modules/.bin/tsc6`, TypeScript 6.0.2, `<verify>/typecheck/sketch.ts`):

   ```text
   error TS2345: Argument of type 'Uint8Array<ArrayBufferLike>' is not assignable to parameter of type 'BufferSource'.
   ```

   The copy at `hash.ts:47` is probably a way around this error. The version that compiles needs a narrower parameter type, as `packages/compare/src/binary.ts:35-36` has:

   ```ts
   export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
     const digest = await crypto.subtle.digest("SHA-256", bytes);
   ```

   Callers that pass a Node `Buffer` then need a change. So the fix is small, but it is not "free".

4. **The option "one model read at a time for each isolate"** needs care on Workers. One request then waits for a promise that another request resolves. If the first request is cancelled, the queue can stop. The report does not name this risk.

## WAIT-07 · A run with a closed summary still reads both inventories from R2

**Verdict: partly-confirmed. Severity: low** (the auditor gave medium). The measurements are correct. The "inconsistency" is a wrong reading of the comment, and the read is deliberate.

### Proof that I checked

- State (c), my run: 2 R2 reads, 24,307,562 bytes, 8 D1 round trips in the model, 6,347,544 bytes (gzip 689,189). Reproduced.
- `review.ts:364`: `run.inventory_key ? readReviewInventory(context, run.id) : null,`. No check of `archive`. Present.
- `review.ts:538-542` and `closed-summary.ts:17-18`: the 106-character reason, two times for each variant. My count: 265 bytes x 3,832 = 1,015,480 (`<verify>/raw/checks.json`).
- Calls in sequence: 5.9 for state (c) against 4.1 for state (b) (`<verify>/raw/a3-node-depth-x1.json`). Reproduced.

### Corrections

1. **The comment is not about the inventory.** `closed-summary.ts:20` says: "The API reads only D1 summaries. R2 archive reading belongs to the one-time converter." The "R2 archive" is the old history archive (`operations_run_archives`, read by `readHistoryManifest` in `convertLegacySummary`, `closed-summary.ts:80-87`). `readClosedSummary` does read only D1, as the comment says. The capture inventory is another object. So the comment is true, and "only correct the comment" is not a needed step.
2. **The inventory of a closed run is kept on purpose, for review.** `apps/web/src/operations/retention.ts:46`: "Keep sparse review inventories after their original images expire." `:22` deletes only `images/` under the run prefix when the run has an inventory. `apps/web/src/operations/snapshot-retention.ts:85`: "sparse snapshots keep their review inventory." Contract `:33`: "Existing links, decisions, approval tuples, available images, and terminal states remain readable."
3. **Without the inventory a closed run has no images at all.** The summary gives captures with an empty image ID (`closed-summary.ts:51-55`: `image_id: ""`). The image of a changed row comes from the inventory candidate that replaces that entry in the map (`review.ts:400-403`, `:416`). Measured (`<verify>/probe/closed-d1only.probe.ts`, raw `closed-d1only.json`):

   ```text
   state (c)                 bytes       variants   changed rows with candidate / reference / diff image
   with the inventory        6,347,544   3,832      4 / 4 / 0
   without the inventory     7,041       4          0 / 0 / 0
   ```

   So the alternative "for `detail_archived = 1`, return the summary rows only" removes all images from a closed run, not only the unchanged list. The report does not say this. It is a product decision about closed history, with contract `:33` and `:184` on the table.

4. **The 1.0 MB is almost nothing on the wire.** gzip is 689,189 bytes for state (c) and 681,328 for state (b): 7,861 bytes more. The cost is the client parse of 1.0 MB of repeated text. The recommendation (send the reason one time) is correct and small.
5. Why low: the cost for each open is the same as for an open review (WAIT-01 to WAIT-03 cover it), closed runs older than 30 days are opened rarely, and the extra transfer is 8 KB.

## WAIT-08 · After 10 s or more with no request, the first Worker request on a new connection waits about 0.2 s more

**Verdict: partly-confirmed. Severity: low** (the auditor gave medium). The recorded samples support the numbers. My small independent sample shows the same signature, but not the same rate, and it shows the wait on the static asset too. The cause is an inference, as the report says. The recommendation moves the wait; it does not remove it.

### Proof that I checked

- I counted the raw samples again (`<verify>/cold-recount.mjs` on `cold/samples.jsonl` and `cold/samples-burst.jsonl`): 45 samples, 270 requests. Slow `/health` samples: 1 of 8 at 1 s, 4 of 9 at 10 s, 7 of 9 at 60 s, 6 of 9 at 300 s, 7 of 8 at 900 s. 27 slow samples with a penalty median of 185 ms, p90 268, minimum 132, maximum 425, `cfEdge` 135 to 363 ms, `cfWorker` at most 1 ms. 18 fast samples with `cfEdge` at most 16 ms. `cfWorker` of the image 404: 82 of 90 between 115 and 144 ms, median 125. All equal to the report. (For an even count my median is the upper middle value, so I get 246 where the report has 216 for 900 s. Both are valid.)
- "26 of 37 for gaps of 10 s or more" contains two samples with no controlled gap ("first" and "resume"). With controlled gaps only, it is 24 of 35.
- `apps/web/src/server.ts:60` (`/health`, no D1) and `apps/web/src/api/images.ts:23-28` (one D1 read). Present.
- Deploys: the last one ended at 2026-10-05T18:47:27Z (my `gh run list`). `audit/infra/deploy-37357689984.log:6971-6972`: "Total Upload: 4007.84 KiB / gzip: 856.53 KiB" and "Worker Startup Time: 47 ms". Present.
- `cfWorker` is "Time spent in Worker execution, including subrequests but excluding origin fetch time" (https://developers.cloudflare.com/changelog/post/2026-02-18-cfworker-server-timing). The page does not say where the start of a Worker instance is counted. So the cause stays an inference.

### My own sample

`node <verify>/cold-verify.mjs`: 4 new connections, each with `/favicon.svg`, `/health`, `/health`; 60 s between them; 2026-10-06T04:57Z to 05:01Z. All answers came from `CWB`, not from `GRU` or `GIG`. Raw: `<verify>/raw/cold-verify.log`.

```text
sample   gap    asset: TTFB / cfEdge / cache   first /health: TTFB / cfEdge / cfWorker   second /health: TTFB / cfEdge
0        none   410.7 / 392 / MISS             144.9 / 133 / 0                           29.2 / 17
1        60 s    38.1 /  14 / HIT               21.5 /   9 / 0                           27.3 / 17
2        60 s    39.7 /  23 / HIT               15.9 /   3 / 0                           16.4 /  5
3        60 s   159.9 / 142 / HIT               25.0 /   4 / 0                           21.7 /  8
```

- The signature is there: sample 0 has a first `/health` with `cfEdge` 133 ms and `cfWorker` 0.
- The rate is not: after 60 s with no request, 0 of 3 samples are slow on `/health`. The report has 7 of 9. Four samples are few, and the edge location and the hour are different. So the "70%" is a fact of that location and that evening, not a general rate.
- The asset can pay the same wait: sample 3 has `cfEdge` 142 ms on a cache HIT, and then `/health` is fast. Sample 0 has 392 ms on a cache MISS. So "the wait is on the Worker, not on the connection" does not hold in general. A reading that fits both data sets: the first request that reaches an edge server with no ready state for this zone or script pays the wait, on the asset path or on the Worker path.

### Corrections to the recommendation

1. **The static shell does not remove the wait for data.** The report says that "the Worker start overlaps with the download of the JavaScript files". Nothing starts the Worker during that download. The first Worker request is then the first API call, after the JavaScript runs, and it pays the same wait. The shell arrives about 0.2 s sooner; the first data arrive at about the same time. An early request from the shell (a `fetch` in the document head, for example to `/api/session`) is needed to get an overlap.
2. **The sketch is not enough to serve a shell.** `not_found_handling: "single-page-application"` serves `/index.html` (https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/). The client build has no such file: `apps/web/dist/client` contains only `assets` and `favicon.svg`. The installed TanStack Start (`@tanstack/start-plugin-core` 1.171.47) can write a shell, with the default path `/_shell` (`dist/esm/schema.js:113`); it must be set to `/index.html`. `apps/web/vite.config.ts` calls `tanstackStart()` with no options.
3. **`directory` does not belong in the source config.** The Cloudflare Vite plugin writes `"assets": { "directory": "../client" }` into `apps/web/dist/server/wrangler.json`. In `apps/web/wrangler.jsonc` the same value points to `apps/client`.
4. `run_worker_first` as a list is valid in the installed Wrangler 4.136.1 (`node_modules/wrangler/config-schema.json`, `Assets.run_worker_first`) and needs "Wrangler v4.20.0 and above" by the same page. With the repository's compatibility date, "navigation requests will not invoke the Worker script", so the list must contain each path that a browser opens directly and that the Worker must answer. `/api/*` covers the OAuth callback.
5. **The document loses its headers.** `securePrivateResponse` (`packages/security/src/http.ts:31-43`) sets the CSP with a nonce for each request. A static shell needs a `_headers` file and a CSP with no nonce. The report says that this is a design change. I agree.
6. Why low: about 0.2 s, not on each visit, no defect in the application code, and no cheap fix. The first alternative of the report ("record the number and do nothing") fits the evidence.

## Notes on the summary and on M10

- "A production-shaped run gives a model of 5,332,792 bytes; production is 5,331,211 bytes." Reproduced. The same offset (about 1.6 KB) appears for the second production sample, which makes the match stronger than the report says.
- "A GitHub check link after an idle period costs about 9 to 11 s." The sum of the rows is 9.4 to 11.4 s. It is an estimate from parts of four lanes. Step 7 (an active run that needs review) has no production sample. Step 5 (GitHub calls) is in this sum but not in the sum of WAIT-02; see WAIT-02, correction 1.
- The auditor sent 286 anonymous GET requests to production (its index records a limit of 300).

## Missed

1. **A receipt poll can build the complete model and then throw it away.** `review.ts:812-835`: when the run revision changed during the model build, the route answers 202 and the client polls again after 500 ms. Each poll of a finished command reads 24.3 MB and validates again. Fast review multiplies WAIT-01 and WAIT-02. Code reading; not measured.
2. **The unsplit part of WAIT-02 can contain GitHub calls, and WAIT-02 conflicts with WAIT-08.** The permission and token caches are in isolate memory (`authorization.ts:19-21`, `github.ts:102`). If the edge starts new instances as often as WAIT-08 infers, most page loads pay 0.7 to 1.0 s for GitHub.
3. **The Node heap numbers are an upper bound for workerd.** workerd uses compressed pointers: 23.9 against 48 bytes for a small object, and 0.79 to 0.85 of the Node heap for the parsed inventories (measured).
4. **A heap snapshot gives a live-heap number in local workerd.** `HeapProfiler.takeHeapSnapshot` forces a full collection where `HeapProfiler.collectGarbage` does not answer. The memory question of WAIT-06 can be measured for a complete read with this method.
5. **A closed run gets all its images from the inventory.** Without the inventory read, the changed rows of a closed summary have no candidate, no reference, and no diff image (measured). Any plan to skip R2 for closed runs must decide this first.
6. **An oversized run keeps one of the five active-run slots.** It stays `uploading` and `active`, and `capacity.ts:41` counts it. Five such runs pause all new runs (code reading).
7. **The baseline already has a durable "verified" mark.** `inventory_verified` is set one time at promotion and is required on read, and then the read validates again (`baseline-promotion.ts:342`, `inventory-records.ts:87`, `:103`).
8. **The compression option needs more than a stream.** R2 refuses a stream with no known length, and the `sha256` option checks the stored bytes; the size check at `capture-inventory.ts:547` must change (measured in local workerd).
9. **The model repeats data that needs no new endpoint to remove.** `images[].url` repeats `images[].id` (299,719 bytes), and `referenceProfile` equals `candidateProfile` in all 3,613 metadata entries.
10. **A D1-only first response has no name and no image for a removed capture** (`review.ts:437-449`, code reading). The stored row needs the reference name, variant, and image, not only the image identity.
11. **The inventory size depends on the image identity.** With run-owned identities the same inventory is 4.0% smaller (computed). The limit in captures and the ratio 1.73 move with it.
12. **The write side is not measured.** Materialization runs the same validation (`capture-inventory.ts:465`), plus a `find` over all profiles and all tests for each capture (`workflow-materialize.ts:307`, `:337`) and four digests for each capture. It sets the time from Submit to the check.
