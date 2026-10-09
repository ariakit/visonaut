# The unexplained part of the wait: run model at production scale, and cold first requests

Lane `gap-unexplained-waits`. Repository commit `f83fef6`. Dates: 2026-10-05 and 2026-10-06 (UTC). Read-only audit. All probes, fixtures, and raw outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-unexplained-waits/` (named `<scratch>` below).

## How it works (map)

### Short answer

- A production-shaped run (3,832 captures, built from the real Ariakit CI manifest with the real code) gives a model of 5,332,792 bytes. The production sample is 5,331,211 bytes. The difference is 0.03%.
- Each `GET /api/runs/:id` downloads **24.3 MB from R2 in two sequential reads** (12.15 MB for the run, 12.15 MB for the baseline). The objects are not compressed.
- The CPU work for one request is **0.70 s in local workerd and 0.87 s in Node** on an Apple M4 Pro. 84% (workerd) to 95% (Node) of it is the read, check, and validation of the two inventories. All other work of the request is 5 to 16%.
- So the measured production wait of 5.25 to 5.68 s is: 1.3 to 1.5 s of D1 round trips (known), at least 0.7 s of CPU (measured here), and **3.0 to 3.7 s that I cannot split from outside**: the transfer of 24.3 MB from R2, plus the speed difference between an M4 Pro core and a Workers core. One invocation log (CPU time) or one trace separates the two.
- A read that keeps the digest check and skips the second validation takes 0.13 s in place of 0.87 s in Node, and 0.16 s in place of 0.70 s in workerd. It returns the same bytes.
- The run that is on the page today is at **72% of the 16 MiB inventory limit**. A run with about 5,270 captures (1.38 times today) cannot be stored. The CLI accepts that run.
- Cold first request: the wait is on the **first Worker request of a new connection** after 10 s or more with no request: about 0.2 s more in 26 of 37 samples. Cloudflare's own `server-timing` header puts it before the Worker code runs (`cfEdge`), not in the Worker and not in D1. It is not the asset, not D1, and not a recent deploy (WAIT-08).
- A click on a GitHub check link after an idle period costs about 9 to 11 s to the first visible review content; `GET /api/runs/:id` is about 60% of it (M10).

### The request `GET /api/runs/:id`

1. `apps/web/src/api/index.ts:86-227` (`handleApi`). Prelude for each private request: project read (`:125`), Better Auth instance (`:130`), GitHub client (`:191`), `requireMaintainer` (`:194-205`). This is 6 D1 round trips in sequence (project, 2 for the schema check, session, user, account). Other lanes measured this part.
2. `apps/web/src/api/review.ts:785-790` calls `reviewModel` and returns `Response.json(model)`.
3. `reviewModel` (`review.ts:227-617`):
   - `:232` run row. `:242` `readClosedSummary` when `detail_archived = 1` (`apps/web/src/operations/closed-summary.ts:21-60`, one check and one batch of 4).
   - `:276-307` one `Promise.all`: a batch of 3, the project, the status chain, the comparison.
   - `:323-365` one `Promise.all`: comparison rows, a batch of 5, eligible approvals, and `readReviewInventory` (`:364`, for each run with `inventory_key`).
4. `readReviewInventory` (`apps/web/src/api/review-inventory.ts:43-93`). The two reads run one after the other:

   ```ts
   // review-inventory.ts:44-48
   const inventory = await readRunInventory(context, runId);
   if (!inventory) return null;
   const referenceInventory = inventory.referenceSnapshotId
     ? await readSnapshotInventory(context, inventory.referenceSnapshotId)
     : null;
   ```

   Each read is: one D1 header read (`apps/web/src/inventory-records.ts:45-49` or `:70-73`), then one R2 `get`, then `readCaptureInventoryDocument` (`apps/web/src/capture-inventory.ts:521-566`).

5. `readCaptureInventoryDocument` for one object:
   - `:543` R2 `get`. `:492-508` copy the stream into one buffer.
   - `:509` SHA-256 of the buffer. `sha256()` copies the buffer first (`packages/protocol/src/hash.ts:47`: `crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))`).
   - `:512` UTF-8 decode. `:513` `JSON.parse`. `:514` canonical check: `canonicalJson(parsed) !== encoded` builds the complete 12 MB string again.
   - `:553` `expandInventory` (`:363-394`): `parseManifest` (`:369`), then restore the metadata of each capture from the manifest and the receipt.
   - `:553` `validatedInventory` (`:396-450`): `assertInventory` (`:165-195`, which calls `parseManifest` a second time at `:193`), 3 SHA-256 digests for each profile (`:402-410`), identity, order, and image checks for each capture (`:416-439`), manifest profile compare (`:440-447`), `validateReceipt` (`:215-283`).
6. Back in `readReviewInventory`: `JSON.stringify(capture.metadata)` for each capture of the two inventories (`review-inventory.ts:30`), and two identity maps.
7. `completeReviewRows` (`review-inventory.ts:95-168`) makes one synthetic row for each capture that D1 does not store (3,828 of 3,832 in the fixture).
8. Model loop (`review.ts:433-553`): three `JSON.parse` calls for each row (`:436`, `:447`, `:455`), then `compactReviewModel` (`:616`, `apps/web/src/review/compact-model.ts`).
9. `Response.json(model)` serializes 5.3 MB. The edge compresses the body.

### What D1 and R2 hold for one run

`docs/current-contract.md:26`: "New storage uses one complete, immutable R2 inventory per run. D1 keeps run and snapshot pointers, changed capture and comparison rows, decisions, and image ownership pins. Review reads the full inventory to show unchanged items."

Measured on the fixture (`<scratch>/raw/a2-fixture-x1.json`): D1 has 5 capture rows and 5 comparison rows for the run. R2 has one 12,154,546-byte JSON object for the run and one 12,153,016-byte object for the baseline. The inventory is written with `store.put(objectKey, encoded, { httpMetadata: { contentType: "application/json" }, sha256: digest })` (`capture-inventory.ts:481-484`): plain JSON, no compression.

### Where the same read runs

`reviewModel` runs for the run page (`review.ts:789`), each ready receipt (`:814`), each direct save and Undo (`:637-639`), and each conflict (`:683`). `readCaptureInventory` also runs in materialization (`workflow-materialize.ts:389`), promotion (`operations/promotions.ts:304`), recovery (`operations/recovery.ts:173`), and history packing (`operations/history.ts:530`).

### The write side and its limits

`materializeBundle` builds the inventory from the submitted manifest (`workflow-materialize.ts:298-386`) and calls `writeCaptureInventory` (`:403`). `writeCaptureInventory` validates, compacts, and rejects more than 16 MiB (`capture-inventory.ts:465-470`).

### Cold first request

A new connection needs DNS, TCP, and TLS. `/favicon.svg` is a static asset (no Worker code). `/health` runs the Worker with no D1 (`apps/web/src/server.ts:60`). `/images/<uuid>` runs the Worker and one D1 read (`apps/web/src/api/images.ts:24-36`). Each production response has a `server-timing` header with `cfEdge` and, for Worker requests, `cfWorker`.

## Findings

All local times are medians on one Apple M4 Pro (Node 24.18.0; workerd 1.20260921.1 through Miniflare 5.20260921.0-alpha). They are not Workers CPU times. "Fixture" means the production-shaped run of measurement M2. "State (a)" is an active run that needs review with 4 changed captures. "State (b)" is `active = 0` (the state of the production samples). "State (c)" is `detail_archived = 1` with a ready closed summary.

### WAIT-01 · Each model read validates two 12 MB inventories again; this is 84 to 95% of the request time on a local machine

- Kind: performance
- Severity: high. Confidence: high (local cost), medium (share of the production wait). Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/capture-inventory.ts:552-553`: `const document = await readInventoryValue(object.body, pointer); const inventory = await validatedInventory(expandInventory(document));`
  - `capture-inventory.ts:514`: `if (canonicalJson(parsed) !== encoded) {`. This builds the complete document again as a string.
  - `capture-inventory.ts:402-410`: three digests for each profile (`digestJson`, `digestRenderingProfile`, `digestEnvironmentProfile`). The real run has 3,613 profiles, so one model read computes 3 x 3,613 x 2 = 21,678 SHA-256 digests of canonical JSON.
  - `capture-inventory.ts:369` and `:193`: `parseManifest` runs two times for each inventory, so four times for each model read.
  - Node split, state (b), `<scratch>/raw/a3-node-split-x1.json`, median of 9:

    ```text
    total                          870.1 ms
    R2 read (memory copy only)       1.1
    SHA-256 (2 objects, 24.3 MB)     9.4
    decode                           1.0
    JSON.parse                      34.8
    canonical check                125.4
    expand and validate            636.7
    review rows (stringify, maps)   14.1
    D1 (local SQLite)                0.5
    completeReviewRows               6.5
    model build and compact         28.9
    JSON output (5.33 MB)           11.9
    ```

  - workerd, state (b), wall time around `dispatchFetch`, median of 7 to 9, `<scratch>/raw/a4-workerd-x1.json`:

    ```text
    GET /api/runs/:id through handleApi (memory store)   696.4 ms
    GET /api/runs/:id through handleApi (local R2)       666.3
    readReviewInventory only                             585.8   (84% of the request)
    decode + JSON.parse + canonical check, 2 objects     137.1
    SHA-256, 2 objects                                    10.0
    reviewModel without the JSON body                    650.1
    reviewModel with the JSON body                       686.5
    ```

  - workerd CPU profile of the same request (inspector, 100 us sampling, 3 requests, `<scratch>/raw/a4-workerd-x1.cpuprofile`), per request, 663 ms active:

    ```text
    profile digests (3 SHA-256 for each profile)   127.9 ms
    canonical check of the document                 96.1
    validate: identity, image, profile compare      73.1
    other (native code, not attributed)             67.4
    garbage collector                               55.4
    assertInventory                                 42.0
    parseManifest in expandInventory                41.9
    read, decode, JSON.parse                        40.1
    parseManifest, second time                      26.6
    model build loop                                18.5
    validateReceipt                                 17.9
    auth, handleApi other                           19.1
    SHA-256 of the two objects                       9.1
    review rows, expand, compact, complete rows     27.3
    ```

  - Lever "keep the digest check, skip the canonical check and the validation" (module mock, Node, `<scratch>/raw/a7-levers-x1.json`): 869.5 ms becomes 128.7 ms. The response is byte-identical (`responseEqualsCurrentCode: true`, 5,332,792 bytes).
  - The same lever in workerd, through the real `handleApi` (three lines replaced when the probe Worker is bundled: `capture-inventory.ts:514`, `:369`, `:553`; `<scratch>/raw/a4-workerd-x1-skipvalidate.json`): 696.4 ms becomes 158.1 ms (memory store), 666.3 ms becomes 162.7 ms (local R2). `readReviewInventory` goes from 585.8 ms to 89.9 ms. The response has the same size (5,332,792 bytes raw, 681,328 gzip).
- What happens: the inventory is validated when it is written (`capture-inventory.ts:465`). Its key contains its digest (`:479`) and the read checks the digest (`:509`). Then each read does the complete validation again: the canonical form, the manifest schema (two times), all profile digests, and the receipt. All other work of the request (auth, D1 calls on a local database, row completion, model build, JSON output) is 5 to 16%.
- Impact: 0.59 s (workerd) to 0.82 s (Node) of CPU for each run page load, each receipt, each Undo, and each conflict response, on an M4 Pro. Assumption: a Workers core is not faster than an M4 Pro core; then production pays at least this. The cost grows in proportion to the capture count: 0.70 s, 1.27 s, and 1.91 s in workerd at 1, 2, and 3 times the real count (`<scratch>/raw/a4-workerd-x2-lift.json`, `-x3-lift.json`).
- Recommendation: add a read for review that proves identity (size and digest) and expands the compact form, with no second validation. Keep `readCaptureInventory` unchanged for materialization, promotion, and recovery.

  ```ts
  // capture-inventory.ts (sketch)
  export async function readVerifiedCaptureInventory(store, pointer) {
    const object = await store.get(pointer.objectKey);
    if (!object || object.size !== pointer.bytes)
      throw new Error("Capture inventory is unavailable.");
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if ((await sha256(bytes)) !== pointer.digest)
      throw new Error("Capture inventory checksum differs.");
    const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return expandStoredInventory(document); // restore metadata; no schema, digest, or receipt checks
  }
  ```

  Measured saving: 741 ms of 870 ms in Node (85%), and 538 ms of 696 ms in workerd (77%).

- Alternatives:
  - Minimal: validate one time for each isolate and digest. Keep a `Set` of digests that passed `readCaptureInventory` in this isolate (digests only, no objects). The first read of an object in an isolate pays the full cost. Later reads pay the short path. The baseline object is the same for all open runs, so it profits most. This keeps validation on first use. It saves nothing on a cold isolate.
  - Keep the validation and remove the repeated work: one `parseManifest` in place of two (about 27 to 42 ms), no copy in `sha256()`, one canonical pass that also gives the profile digests. This is a smaller saving (not measured as a whole) with no trust change.
  - Do the work one time at materialization: write a review-ready object, or keep the unchanged rows in a form that needs no validation. This is the largest change and it touches `docs/current-contract.md:26`.
- Maintainer decision needed: yes. `docs/current-contract.md:24` says "The service validates signed provenance, reference binding, receipt metrics, and image bytes before importing the result." Is a digest match on an immutable object enough for a review read, or must each read apply the current validation rules again? One real difference: validation on read applies today's rules to objects that an older version wrote.

### WAIT-02 · About 3.0 to 3.7 s of the production wait is not split yet: 24.3 MB from R2 in two sequential reads, and the speed of a Workers core

- Kind: performance
- Severity: high. Confidence: medium. Measured: yes (bytes, sequence, local CPU); the production split is not measured. Effort: M
- Evidence:
  - Real `handleApi` on the fixture, all three states: `r2Gets: 2`, `r2Bytes: 24,307,562` (`<scratch>/raw/a4-workerd-x1.json`, `nodeHandleApiFirst`).
  - `apps/web/src/api/review-inventory.ts:44-48`: the second read waits for the first.
  - `capture-inventory.ts:481-484`: the object is stored as plain JSON.
  - Size if compressed, same object (`<scratch>/raw/a7-compress-cost.json`): 12,154,546 bytes raw, 1,506,911 bytes gzip (level 6), 1,236,209 bytes brotli (quality 5). Decompression: 9.7 ms (`gunzipSync`), 20.6 ms (`DecompressionStream("gzip")`), Node.
  - Lever "start the two reads together" with an injected wait of 300 ms for each R2 `get` (`<scratch>/raw/a7-levers-x1.json`): 1,491.3 ms becomes 1,168.0 ms. With no injected wait the result does not change (869.5 and 862.5 ms), because the CPU work is on one thread.
  - Known from earlier lanes: production server wait 5,251 to 5,680 ms; D1 round trips 1.3 to 1.5 s (`audit/second-lens-2.md`, Fact 3).
- What happens: the sum is

  ```text
  production server wait (3 samples)            5.25 to 5.68 s
  - D1 round trips (count x 125 to 145 ms)      1.3  to 1.5  s   known
  - CPU, if a Workers core = an M4 Pro core     0.66 to 0.70 s   measured here (workerd)
  = not split                                   3.0  to 3.7  s
  ```

  The remainder has two parts that I cannot separate from outside. Part 1 is the R2 transfer: two sequential reads of 12.15 MB each, from a Worker in `GRU` to a bucket whose location is not recorded. Part 2 is the CPU speed: for each 1x of slowdown of a Workers core against an M4 Pro core, the wait grows by 0.7 s. Examples: if the factor is 2, R2 is 2.3 to 3.0 s; if the factor is 3, R2 is 1.7 to 2.3 s; if the factor is 4, R2 is 1.0 to 1.6 s.

- Impact: this is the largest part of the slowest page, and no number in the repository or in this audit shows which of the two parts is larger. The fix is different for each part: WAIT-01 removes CPU, and the options below remove transfer.
- Recommendation: get the split first. It needs no code change. The Worker has `observability.enabled: true` with traces (`apps/web/wrangler.jsonc:15-20`). For one `GET /api/runs/<id>`: read the CPU time and the wall time of the invocation, and the duration of the two R2 `get` spans. CPU time divided by 0.67 s is the speed factor. Then select:
  - If the transfer is the larger part: store the inventory compressed. The two reads become 3.0 MB in place of 24.3 MB.

    ```ts
    // write (sketch): compress the canonical bytes; the pointer digest stays the digest of the canonical JSON
    const body = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    // read: decompress, then check size and digest of the canonical bytes as today
    const canonical = object.body.pipeThrough(new DecompressionStream("gzip"));
    ```

  - If the CPU is the larger part: WAIT-01.
- Alternatives:
  - Minimal: start the two reads together. `visonaut_comparisons.reference_snapshot_id` has the baseline ID before the first read (`audit/second-lens-2.md`, REVIEW-04, Option 1). It saves the time of the shorter read. It keeps 24.3 MB of transfer and puts two 12 MB buffers in memory at the same time (see WAIT-06).
  - Run the Worker near the bucket and the database (placement, `audit/second-lens-2.md`, REVIEW-02). The result depends on the bucket location, which is not known.
  - Do not read the inventories for the first response (WAIT-03).
- Maintainer decision needed: yes. Can you read one invocation log or trace for `GET /api/runs/<id>` in production (CPU time, wall time, R2 span durations)? That one reading closes this finding.

### WAIT-03 · The first response carries 3,828 unchanged variants to show 4 changed ones: 5.33 MB against 7.5 KB

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - Fixture model: 626 items, 3,832 variants, 3,828 of kind `unchanged` (`<scratch>/raw/a2-fixture-x1.json`).
  - Lever "return only the rows that D1 stores" (`readReviewInventory` returns `null`, module mock, `<scratch>/raw/a7-levers-x1.json`):

    ```text
                              current      D1 rows only
    response bytes            5,332,792    7,483
    gzip bytes                  681,328    2,150
    R2 reads / bytes          2 / 24.3 MB  0 / 0
    D1 round trips in model   10           8
    reviewModel + JSON, Node  869.5 ms     0.3 ms
    variants                  3,832        4
    with a reference image    3,832        0
    ```

  - Where the 5.33 MB go (`<scratch>/raw/a3-model-bytes-x1.json`): `items` 3,061,896 bytes (57.4%), `metadata` 1,322,359 (24.8%), `images` 947,744 (17.8%). In `items`: `labelParts` 1,100,513 bytes, `id` 559,472, `label` 441,409 (the same text as `labelParts`, joined), `key` 227,913.
  - `review.ts:442-446`: the reference capture of a stored row comes from `row.reference_capture_id` or from the inventory. `packages/service/src/local-comparison.ts:325-327` inserts sparse rows with `reference_capture_id` `NULL`. The row keeps the reference digest in `tuple_json`, but `visonaut_images` has no index on `digest` (`apps/web/migrations/0014_visonaut_brand.sql:52` creates `visonaut_images_run` only; `0032_upload_indexes.sql:1` drops the other one).
- What happens: the page needs the changed captures first. The API returns all captures of the run in one response, so each load pays the two R2 reads, the validation, and 5.3 MB of JSON. With D1 rows only, the changed variants have their candidate image and diff, but no reference image: D1 does not store which baseline image belongs to a changed row. That link is only in the baseline inventory.
- Impact: almost all of the server wait of the run page, the 692 KB transfer, and the client parse (measured by lane frontend-perf) serve items that the reviewer did not ask to see. The same cost returns with each receipt.
- Recommendation: split the read. A first response with the run header and the stored rows (changed, added, removed), and a second request for the unchanged items when the reviewer opens that group. To make the first response complete, store the reference image identity with the changed row at comparison time (the service has it in `referenceCaptures`, `local-comparison.ts:117`).

  ```ts
  // GET /api/runs/:id             header + rows that D1 stores; no R2
  // GET /api/runs/:id/unchanged   the complete inventory view, on demand
  ```

- Alternatives:
  - Minimal, no contract change: keep one response and make it smaller. Remove `label` (the client can join `labelParts`), and send the long `id` prefix one time. This removes about 0.44 MB plus about 0.28 MB of 5.33 MB. The server wait does not change.
  - Keep one response and add counts only for unchanged items (item key and variant count), with details on demand.
  - Receipts without the model (`audit/second-lens-2.md` names REVIEW-06): removes the repeats, not the first load.
- Maintainer decision needed: yes. `docs/current-contract.md:26` says "Review reads the full inventory to show unchanged items", and decision P01 is "One compact complete model". Can the unchanged items load on demand?

### WAIT-04 · Almost each capture has its own profile, because the clip rectangle is part of the profile

- Kind: cost
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - Real manifests of Ariakit CI run 37342354710 (`<scratch>/raw/a1-manifest-stats.json`): linux has 2,632 captures and 2,486 profiles; without `captureOptions.clip` these are 54 distinct profiles. Safari: 1,200 captures, 1,127 profiles, 27 distinct without the clip. Combined: 3,832 captures, 3,613 profiles.
  - `packages/playwright/src/visual.ts:173`: `...(options.screenshot?.clip ? { clip: { ...options.screenshot.clip } } : {}),` inside `screenshotOptions`, which becomes `profile.captureOptions`.
  - `packages/protocol/src/hash.ts:97-103`: `digestEnvironmentProfile` already removes the clip ("Content clipping can change with a defect without a trusted-plan rollout").
  - Sizes: profiles are 2,645,645 bytes of the 5,639,996-byte combined manifest (47%) and 21.8% of each 12.15 MB inventory (`<scratch>/raw/a2-combined-manifest.json`, `a2-inventory-bytes-x1.json`).
  - Model: the shared `metadata` table has 3,613 entries for 3,832 variants. Without the two profile digests it has 1 distinct entry (`<scratch>/raw/a3-model-bytes-x1.json`: `distinctMetadataWithoutProfiles: 1`).
- What happens: a profile is meant to be a small dictionary that many captures share. The clip rectangle (x, y, width, height of one screenshot) is in the profile, so the dictionary has one entry for almost each capture. Each place that handles profiles then scales with the capture count: the manifest, the inventory, the 21,678 digests of WAIT-01, and the `compact-review-1` metadata table (`apps/web/src/review/compact-model.ts`), which does not share anything in real data.
- Impact: about 2.6 MB in each manifest and each inventory, about 1.3 MB in each model response, 128 ms (workerd) to 186 ms (Node) of digest work for each model read, and the profile limit of 10,000 (`packages/protocol/src/validate.ts:273`) is reached at about 10,600 captures (2.77 times today).
- Recommendation: decide where the clip belongs. If the clip is a fact of one capture, move it to the capture record and keep it out of the profile and its digest. Then the real run has about 81 profiles in place of 3,613. This is a protocol and adapter change (`@visonaut/playwright`, the manifest schema, the profile digest of stored baselines), so it needs a migration plan for accepted baselines.
- Alternatives:
  - Minimal, service only: in the model, key the shared metadata without the profile digests and send the two digests for a variant only on demand (the "evidence" panel). This removes about 1.3 MB of the response. It does not change the manifest or the inventory.
  - Keep the data and cut the CPU: compute the three profile digests in one pass, or skip them on review reads (WAIT-01).
- Maintainer decision needed: yes. Is the clip rectangle part of the rendering identity that approval reuse needs (`docs/current-contract.md:184`: "exact image, rendering profile, comparison policy, item, variant"), or is it a capture detail?

### WAIT-05 · A run with more than about 5,270 captures cannot be stored (1.38 times today), and the limits do not agree

- Kind: bug
- Severity: high. Confidence: high (the limit), medium (what happens after it; read in the code, not run). Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/capture-inventory.ts:55-56`: `// Leave room for the decoded JSON and capture graph in a 128 MiB Worker.` `export const maximumCaptureInventoryBytes = 16 * 1024 * 1024;` and `:468-470`: `if (bytes.byteLength > maximumBytes) { throw new Error("Capture inventory exceeds its size limit."); }`
  - Fixture with the real code (`<scratch>/raw/a2-fixture-x*.json`):

    ```text
    captures   run inventory bytes   of 16,777,216   result
    3,832      12,154,546            72.4%           stored
    5,250      16,705,886            99.6%           stored
    5,326      -                     -               Error: Capture inventory exceeds its size limit.
    7,664      -                     -               Error: Capture inventory exceeds its size limit.
    ```

  - The same data against the other limits (computed from the measured bytes for each capture):

    ```text
    limit                                         source                                    today    reached at
    inventory 16 MiB                              capture-inventory.ts:56                   72.4%    about 5,270 captures (1.38x)
    CLI manifest 8 MiB (combined, compact JSON)   packages/cli/src/files.ts:9, engine.ts:778 67.2%   about 5,700 (1.49x)
    CLI manifest 8 MiB (linux shard, as uploaded) files.ts:9, artifact-archive.ts:10        66.6%    about 3,950 in that shard (1.50x)
    server manifest 16 MiB                        apps/web/src/runtime-defaults.ts:12       41.8%    about 9,160 (2.39x)
    profiles 10,000                               packages/protocol/src/validate.ts:273     36.1%    about 10,600 (2.77x)
    captures 40,000                               runtime-defaults.ts:14                     9.6%    not reachable
    captures 100,000                              capture-inventory.ts:181                   3.8%    not reachable
    image 2 MiB                                   packages/compare/src/types.ts:10          10.0%    (largest image 210,405 bytes)
    image 2.1 megapixels                          packages/compare/src/types.ts:11          73.7%    (largest image 1248 x 1240)
    ```

  - What the service does with the error, by code reading: `workflow-materialize.ts:403` throws a plain `Error`. `reconcileStagedWorkflows` catches it (`:900-904`), counts up to 5 failures (`:905`), and records `retry-delayed` (`:927-934`). The run is failed only for `stale_reference` or a missing original (`:912-924`). The query at `:869-880` selects the stage again after one hour (`delayedRetryMs`, `:826`).
- What happens: the inventory limit is the first limit that a growing test suite reaches, at 38% more captures than today. The CLI and the upload route accept that run: the manifest is under their limits. All images upload. Then materialization throws in `writeCaptureInventory`. The error is not a terminal failure in the reconcile loop, so the service tries again each hour while the stage is live (24 hours, `apps/web/src/api/workflow-retention.ts:6`) and shows a `retry-delayed` alert. I did not run this path; what the GitHub check shows is not verified.
- Impact: the configured `maximumCaptures: 40_000` is 7.6 times more than the service can store. The real stop is not written in any limit that the CI job sees before it uploads. The Ariakit run grows with each new example and each new browser project.
- Recommendation: make the smallest limit visible and early, with one clear message. The inventory size is a stable function of the submitted manifest (measured ratio 1.73 at 3,832 and at 5,250 captures), so `declareStaged` can reject a run that cannot be stored before any image upload, and materialization can fail the run with a named reason.

  ```ts
  // workflow-materialize.ts (sketch): a size error is terminal, not a retry
  class InventoryTooLargeError extends IncompleteError {}
  // reconcile: treat it like "original-unavailable": failRun with a reason that names the limit
  ```

- Alternatives:
  - Minimal: only document the real limit (about 5,200 captures for the current data shape) next to `maximumCaptures`, and lower `maximumCaptures` to a value that the storage can hold.
  - Raise the capacity: a compressed or split inventory, or fewer bytes for each capture (WAIT-04 removes about 22% of the inventory; the image record with its 64-character ID and 157-character object key is 1.69 MB, 14%). Memory then becomes the limit (WAIT-06).
- Maintainer decision needed: yes. What capture count must one run support in the next year? The answer selects between "fail early at about 5,200" and a new inventory format.

### WAIT-06 · Three model reads at the same time need 105 to 109 MB of live JavaScript heap at today's size; the isolate limit is 128 MB

- Kind: performance
- Severity: medium. Confidence: medium. Measured: yes (V8 in Node; not the hosted accounting). Effort: M
- Evidence:
  - Method: a standalone Node process (esbuild bundle of `reviewModel` and the saved fixture, no test runner), one warm-up read, then N reads at the same time, under different `--max-old-space-size` caps, with `--trace-gc` (`<scratch>/probe/heap-driver.mjs`, `<scratch>/raw/a5-heap-caps-x*.json`). "Live heap" is the largest heap size after a full collection.

    ```text
    captures   reads at the same time   largest cap that fails   smallest cap that completes   live heap after full GC
    3,832      1                        48 MiB                   56 MiB                        44 to 51 MB
    3,832      2                        80                       88                            71 to 80
    3,832      3                        104                      112                           105 to 109
    7,664      1                        80                       88                            82 to 90
    7,664      2                        128                      144                           137 to 147
    7,664      3                        192                      208                           194 to 201
    11,496     1                        128                      136                           121 to 131
    11,496     2                        208                      224                           212 to 224
    ```

  - Buffers outside the JavaScript heap: `capture-inventory.ts:492` allocates the complete object, and `packages/protocol/src/hash.ts:47` copies it for the digest: `crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))`. That is 2 x 12.15 MB = 23.2 MiB for each read at the digest moment. The probe saw 34.8 MiB for each read, because its memory store adds one more copy.
  - workerd inspector (`<scratch>/raw/a4-workerd-x1.json`, `workerdHeap`): committed heap up to 122.2 MiB during one read and 146.8 MiB during three reads. This number includes garbage. The inspector answered only 2 to 4 times during a request, and `HeapProfiler.collectGarbage` gave no answer, so workerd gives no live-heap number.
  - `docs/evidence/worker-memory/README.md` says that local numbers "do not establish a hosted Worker isolate peak below 128 MiB".
  - Platform text (copy of the Cloudflare limits page in `audit/second-lens-2/docs/workers-limits.md:123-129`): "Each isolate can consume up to 128 MB of memory, including the JavaScript heap and WebAssembly allocations. This limit is per-isolate, not per-invocation. A single isolate can handle many concurrent requests." and "When an isolate exceeds 128 MB, the Workers runtime lets in-flight requests complete and creates a new isolate for subsequent requests." and "When a Worker exceeds its memory limit, Cloudflare returns Error 1102".
- What happens: one read holds two parsed inventories, their restored metadata, the review rows with one JSON string for each capture, the model, and the response string. One read needs about 47 MB of live heap at today's size, and each more read at the same time adds about 28 to 32 MB. A page load and receipts that overlap share one isolate. The client lets receipts overlap: `apps/web/src/review/client.ts:306` says "Only admission is serialized. Processing belongs to the server queue.", and each saved decision polls its own receipt each 500 ms (`client.ts:326-335`). Each ready receipt builds the complete model (`review.ts:814`).
- Impact: at today's size, three reads at the same time are at 82 to 85% of the limit before the buffers. By linear interpolation of the table, three reads cross 128 MB at about 4,500 to 4,700 captures (1.17 to 1.23 times today), two reads at about 6,600 to 6,900 (1.7 to 1.8 times), and one read at about 10,900 to 11,700 (2.8 to 3.0 times). The comment at `capture-inventory.ts:55` holds for one read at 16 MiB (about 62 MB of live heap by the table). For two reads at 16 MiB the table gives about 100 MB of live heap before the buffers, and for three reads about 140 MB. What the hosted runtime does above the limit, and how it counts buffers, is not measured here.
- Recommendation: decrease the live set of one read, then the count of reads. WAIT-01 (no second canonical string, no second manifest parse) and WAIT-03 (no inventory for the first response and for receipts) do both. One local change is free: hash the buffer without a copy.

  ```ts
  // packages/protocol/src/hash.ts:47 (sketch): digest() does not change its input
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  ```

- Alternatives:
  - Minimal: only remove the copy in `sha256()` (11.6 MiB for each read at the digest moment).
  - Limit model reads to one at a time for each isolate (a small queue). It protects memory and makes overlapping receipts wait.
  - Read the hosted memory use from the dashboard for the Worker and compare it with this table before any change.
- Maintainer decision needed: yes. Do receipts need the complete model? If not, the case "three reads at the same time" goes away.

### WAIT-07 · A run with a closed summary still reads both inventories from R2, and its response is the largest

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/operations/closed-summary.ts:20`: `/** The API reads only D1 summaries. R2 archive reading belongs to the one-time converter. */`
  - `apps/web/src/api/review.ts:364`: `run.inventory_key ? readReviewInventory(context, run.id) : null,`. There is no check of `archive` or `run.detail_archived` on this line.
  - Real `handleApi`, state (c), fixture (`<scratch>/raw/a4-workerd-x1.json`, `a3-node-split-x1.json`):

    ```text
    state                         D1 trips (request / model)   R2 gets   R2 bytes     Node total   workerd handleApi   response raw / gzip / brotli
    (a) active, needs review      21 / 15                      2         24,307,562   866.3 ms     748.1 ms            5,332,737 / 681,308 / 559,411
    (b) active = 0                16 / 10                      2         24,307,562   870.1        696.4               5,332,792 / 681,328 / 559,307
    (c) closed summary ready      14 / 8                       2         24,307,562   912.1        672.7               6,347,544 / 689,189 / 559,556
    ```

  - `review.ts:538-542`: each variant of an archived run gets `rejectDisabledReason` and `approveDisabledReason`. For state (c) both are the same 106-character sentence (`closed-summary.ts:17-18`). That is 265 bytes x 3,832 variants = 1.01 MB.
  - The third production sample (5,974,885 bytes) equals state (b) plus the two "promoted history" strings of `review.ts:545-547` on each variant: 5,332,792 + 168 x 3,832 = 5,976,568 bytes (0.03% more).
- What happens: the closed summary moves the changed rows and decisions to compact D1 tables. For a run that has an inventory, the model still downloads and validates the run inventory and the baseline inventory to list the unchanged items. So the oldest, read-only runs pay the same R2 and CPU cost as an open review, and return 1.0 MB more JSON because one sentence is repeated two times for each variant. State (c) also has more D1 calls in sequence than state (b): 6 against 4 in the model, measured with an injected wait of 200 ms (`<scratch>/raw/a3-node-depth-x1.json`), so 12 against 10 with the 6 prelude calls. The summary check and its batch run before the main `Promise.all`.
- Impact: history rows open as slowly as live reviews. The comment at `closed-summary.ts:20` and `docs/current-contract.md:184` ("Closed-run summaries must not promise image replay after unpinned bytes expire") describe a small summary; the response is the largest of the three states.
- Recommendation: send a read-only reason one time in the model header (the model already has `readOnlyReason`, `review.ts:580-586`) and let the client apply it to all variants. Then decide if a closed run needs the unchanged list at all.

  ```ts
  // model header, one time (sketch)
  { archived: true, readOnlyReason, decisionsDisabledReason: readOnlyReason }
  // variant: no rejectDisabledReason and no approveDisabledReason when the complete run is read-only
  ```

- Alternatives:
  - Minimal: only correct the comment at `closed-summary.ts:20`.
  - For `detail_archived = 1`, return the summary rows only (no R2), with a count of unchanged captures from `visonaut_runs.capture_count`.
- Maintainer decision needed: yes. Must a closed summary list all unchanged items, or is the count enough?

### WAIT-08 · After 10 s or more with no request, the first Worker request on a new connection waits about 0.2 s more in 70% of the samples; Cloudflare reports the time before the Worker code runs

- Kind: performance
- Severity: medium. Confidence: medium (the measurement is clear; the cause is an inference). Measured: yes. Effort: M
- Evidence:
  - Probe `<scratch>/cold/cold-probe.mjs`: each sample opens one new connection to `https://visonaut.com` and sends `/favicon.svg`, `/health`, `/images/00000000-0000-4000-8000-000000000000`, then the same three again as the warm reference. 45 samples, 270 anonymous GET requests, 2026-10-05T21:05Z to 2026-10-06T02:33Z. Raw: `<scratch>/cold/samples.jsonl`, `samples-burst.jsonl`; summary `summary.json`, `tables.md`.
  - Samples where cold `/health` is more than 100 ms slower than warm `/health` on the same connection:

    ```text
    idle gap before the sample   slow samples   penalty median / p90 (ms)
    1 s                          1 of 8         -1 / 134
    10 s                         4 of 9         65 / 179
    60 s                         7 of 9         166 / 277
    300 s                        6 of 9         165 / 425
    900 s                        7 of 8         216 / 268
    about 2.4 h                  1 of 1         268
    all gaps of 10 s or more     26 of 37       when slow: median 185, p90 268, max 425
    ```

  - Cloudflare's own header in the 27 slow samples: `cfEdge` is 135 to 363 ms and `cfWorker` is 0 or 1 ms. In the 18 fast samples `cfEdge` is 16 ms or less. Example, same connection: cold `server-timing: cfEdge;dur=192,cfOrigin;dur=0,cfWorker;dur=0`, warm `cfEdge;dur=7,cfOrigin;dur=0,cfWorker;dur=0`.
  - The static asset is not slow: 1 of 45 samples has an asset penalty of more than 100 ms (one `cf-cache-status: MISS` after 900 s, edge `GIG`).
  - D1 is not the cause: the image 404 (one D1 read) has `cfWorker` 115 to 144 ms in 82 of 90 requests (median 125). The other 8 requests (177 to 304 ms) are all first reads on a new connection, so D1 has a small first-read cost of 50 to 180 ms in 8 of 45 samples. After 900 s the first read has a median of 144 ms and a p90 of 194 ms (warm 126 / 132).
  - Document first (`COLD_SEQUENCE=/,/health,/`, 5 samples, 60 s idle, `<scratch>/cold/summary-document.json`): cold document time to first byte 257, 242, 238, 89, 47 ms; warm 36 to 43 ms. In the three slow samples `cfEdge` is 153 to 165 ms (warm 5 to 9). `cfWorker` of the cold document is 53 to 60 ms in four of five samples; warm it is 7 to 12 ms.
  - Deploys (`gh run list --repo ariakit/visonaut --workflow deploy.yml`, `<scratch>/cold/deploys.json`): the last deploy ended at 2026-10-05T18:47:27Z. No sample is in the 10 minutes after a deploy. The slow samples are 138 to 466 minutes after it.
  - Deploy log (`audit/infra/deploy-37357689984.log:6971-6972`): "Total Upload: 4007.84 KiB / gzip: 856.53 KiB" and "Worker Startup Time: 47 ms". Platform text (`audit/second-lens-2/docs/workers-limits.md:272`): "Larger Worker bundles can impact startup time."
- What happens: the wait is on the Worker, not on the connection and not on D1. When this client sent no request for 10 s or more, the first request that needs the Worker on a new connection waits 135 to 363 ms at the edge before the Worker code starts. The next requests on that connection are fast. With 1 s between new connections the wait is almost never there. The likely reason is that the edge server has no ready instance of this Worker and must start one; Cloudflare does not name the reason in the header, so this is an inference. For a document there is a second, smaller cost: the first render in a new instance takes about 55 ms of Worker time against about 10 ms.
- Impact: about 0.2 s (sometimes 0.4 s) more for the first document of a visit, in about 70 to 80% of visits after an idle period. It is small against the 5 to 8 s of the run page. It is visible on the dashboard document (41 to 119 ms when warm). It is not related to a recent deploy in these samples; the minutes after a deploy are not measured. The earlier reports of 0.6 to 1.4 s on a first request are not explained by this finding alone; they need the GitHub calls of a cold isolate (0.7 to 1.0 s, `audit/second-lens-4.md`) on top.
- Recommendation: do not treat this as a defect of the application code. Decrease what waits for it. The page shell before sign-in is the same for each visitor, so it can be a static asset that the edge serves without the Worker; then the Worker start overlaps with the download of the JavaScript files and delays only the first API request.

  ```jsonc
  // apps/web/wrangler.jsonc (sketch): a prebuilt shell for navigation requests; the Worker for data routes
  "assets": {
    "directory": "../client",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/v1/*", "/images/*", "/webhooks/*", "/health"]
  }
  ```

  This changes how the document gets its CSP nonce and its server-rendered state, so it is a design change, not a setting.

- Alternatives:
  - Minimal: record the number and do nothing. Each fix of the run page (WAIT-01 to WAIT-03) is worth more.
  - Make the Worker start cheaper: load Better Auth and the server renderer only in the routes that need them, and measure the effect with this probe. The result is not known: the reported startup time is already 47 ms, so the wait can be the fetch and compile of the 4.0 MB script, which lazy loading does not remove.
  - A keep-warm request each few seconds from one place. It probably does not help: the wait returns after 10 s of idle time and a new connection can reach another edge server. It also adds permanent traffic.
- Maintainer decision needed: yes. Is 0.2 to 0.4 s on the first request of a visit worth a design change of the document, or is it accepted as a platform cost?

## Measurements (command, raw result, limits)

`<scratch>` is `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-unexplained-waits`. `<repo>` is the worktree. Probes run with the repository's Vitest and a scratch config:

```sh
pnpm --dir <repo> exec vitest run --config <scratch>/probe/vitest.config.mjs <probe name>
```

Environment variables select the case: `FACTOR` (capture count scale), `PROBE_MODE` (`split`, `depth`, `profile`, `levers`), `LIFT_LIMITS=1` (load two modules with larger limits; see M8), `LEVER_SKIP_VALIDATE=1` (lever 2; see M7), `WORKERD_LIGHT=1` (state (b) only, fewer probes).

### M1 · Real capture data (A1)

Commands:

```sh
gh run download 37342354710 --repo ariakit/ariakit --name visonaut-capture-37342354710-1-linux  --dir <scratch>/artifacts/linux
gh run download 37342354710 --repo ariakit/ariakit --name visonaut-capture-37342354710-1-safari --dir <scratch>/artifacts/safari
node <scratch>/probe/manifest-stats.mjs        # -> <scratch>/raw/a1-manifest-stats.json
```

The run is `CI` on `main`, commit `643a23af`, 2026-10-05T16:38:13Z, conclusion `success`. The artifacts were not expired.

| Value                                                          | linux                                     | safari                                    | combined                     | Limit                                          | Used          | Headroom      |
| -------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ---------------------------- | ---------------------------------------------- | ------------- | ------------- |
| Captures                                                       | 2,632                                     | 1,200                                     | 3,832                        | 40,000 (`runtime-defaults.ts:14`)              | 9.6%          | 90.4%         |
| Items                                                          | 626                                       | 568                                       | 626                          | none                                           |               |               |
| Tests                                                          | 212                                       | 95                                        | 307                          | none                                           |               |               |
| Manifest file bytes (as uploaded, indented JSON)               | 5,585,113                                 | 2,528,370                                 |                              | 8 MiB (`files.ts:9`, `artifact-archive.ts:10`) | 66.6% / 30.1% | 33.4% / 69.9% |
| Combined manifest bytes (after `combineBundles`, compact JSON) |                                           |                                           | 5,639,996                    | 8 MiB (`files.ts:9` through `engine.ts:778`)   | 67.2%         | 32.8%         |
| Profiles                                                       | 2,486                                     | 1,127                                     | 3,613                        | 10,000 (`validate.ts:273`)                     | 36.1%         | 63.9%         |
| Profiles that are distinct without `clip`                      | 54                                        | 27                                        | 81                           |                                                |               |               |
| Bytes for each profile (compact JSON)                          | 679 to 747                                | 677 to 736                                |                              |                                                |               |               |
| Bytes for each capture record in the manifest                  | 734 to 790                                | 731 to 786                                |                              |                                                |               |               |
| Item key length (characters)                                   |                                           |                                           | 23 to 68, median 37          | 256 (`validate.ts`, `validateKey`)             | 26.6%         | 73.4%         |
| Variant key length                                             |                                           |                                           | 40 to 54, median 51          | 256                                            | 21.1%         | 78.9%         |
| Metadata bytes for each capture in the inventory (expanded)    |                                           |                                           | 1,181 to 1,367, median 1,238 | none                                           |               |               |
| Image files                                                    | 2,520                                     | 1,175                                     | 3,695 distinct digests       |                                                |               |               |
| Image bytes: min / median / p90 / p99 / max                    | 265 / 12,001 / 28,062 / 170,521 / 194,921 | 673 / 13,018 / 30,747 / 186,254 / 210,405 | max 210,405                  | 2 MiB (`compare/src/types.ts:10`)              | 10.0%         | 90.0%         |
| Image bytes, sum                                               | 46,448,464                                | 24,626,804                                | 71,075,268                   | 2 GiB for one run (`runtime-defaults.ts:10`)   | 3.3%          | 96.7%         |
| Largest image in pixels                                        | 1,547,520                                 | 1,547,520                                 | 1,547,520 (1248 x 1240)      | 2,100,000 (`compare/src/types.ts:11`)          | 73.7%         | 26.3%         |
| Run inventory bytes (fixture, M2)                              |                                           |                                           | 12,154,546                   | 16 MiB (`capture-inventory.ts:56`)             | 72.4%         | 27.6%         |

The smallest headroom values are the pixel limit (26.3%) and the inventory limit (27.6%). A screenshot of 1440 x 1459 pixels is over the pixel limit.

### M2 · Production-shaped fixture (A2)

Files: `<scratch>/probe/combine.probe.ts`, `fixture.ts`, `build.probe.ts`. Raw: `<scratch>/raw/a2-combined-manifest.json`, `a2-fixture-x1.json`, `a2-model-x1.json`, `a2-inventory-bytes-x1.json`. Saved fixture: `<scratch>/fixture-x1/` (SQLite file and R2 objects).

- Real code: `combineBundles` (CLI) on the two real bundles; `writeCaptureInventory`; `storeCaptureProfiles`; `Service.reserveRun`, `registerImages`, `commitShard` (with `verifiedDiscovery`, the plan shape of `workflow-materialize.ts:639-661`), `sealRun`, `createComparison` (with `referenceCaptures`), `finalizeComparison`, `retireRun`; `promoteBaselines`; `summarizeClosedRuns`.
- Copied logic: the capture mapping of `workflow-materialize.ts:298-359`, because `materializeBundle` is not exported and needs signed GitHub evidence.
- Not real: the local comparison receipt (4 captures `changed` with a mask, all others `unchanged`), the image IDs, and the baseline run. Unchanged captures use baseline images with the identity of the imported baseline (64-character ID and `baselines/import/<id>/images/<digest>.png`, `apps/web/tooling/baseline-reset/reset.ts:411-421`).
- Assumption: the production baseline inventory has the same shape as a run inventory (an accepted main run with a manifest). If the baseline is still the imported object with no manifest, its size and its validation cost are different.

Result:

```text
captures 3,832   profiles 3,613   tests 307   changed 4
submitted manifest, canonical JSON     7,018,634 bytes   (receipt 1,378,620)
run inventory (baseline-delta-v2)     12,154,546 bytes   72.4% of 16 MiB   gzip 1,506,911   brotli (quality 11) 905,699
baseline inventory                    12,153,016 bytes   72.4%
same inventory, not compacted (v1)    18,713,944 bytes
D1 rows: visonaut_captures 5, visonaut_comparison_rows 5, visonaut_images 3,704, visonaut_capture_profiles 4
model, state (a): 626 items, 3,832 variants, 3,703 images, 3,613 metadata entries
model JSON 5,332,737 bytes   gzip 681,308   brotli 559,411
```

Inventory bytes by part: inventory capture records 5,135,629 (42.3%), `manifest.captures` 2,910,750 (23.9%), `manifest.profiles` 2,645,645 (21.8%), receipt 1,378,620 (11.3%), tests 82,844 (0.7%).

Check against production (`audit/live-authenticated.md`): 5,331,211 bytes decoded for run `5f5138d3`; the fixture in state (b) is 5,332,792 bytes (+0.03%). 5,974,885 bytes for run `543dd81a`; state (b) plus the two "promoted history" strings is 5,976,568 bytes (+0.03%). Transfer 691,954 to 692,862 bytes; fixture gzip 681,328 bytes (the production value includes headers, and its content encoding was not recorded).

### M3 · Time split and I/O for three run states (A3)

Probe: `PROBE_MODE=split ... node-model` (`<scratch>/probe/node-model.probe.ts`, timers through module mocks, no repository change). Raw: `<scratch>/raw/a3-node-split-x1.json`. Counts through the real `handleApi` on Miniflare D1 and R2: `<scratch>/raw/a4-workerd-x1.json` (`nodeHandleApiFirst`).

|                                                                                                  | (a) active, needs review        | (b) `active = 0`                | (c) closed summary |
| ------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------- | ------------------ |
| D1 round trips, complete request                                                                 | 21 (existing count; reproduced) | 16 (existing count; reproduced) | **14**             |
| D1 round trips in `reviewModel`                                                                  | 15                              | 10                              | **8**              |
| D1 statements, complete request                                                                  | 101                             | 96                              | 93                 |
| D1 calls in sequence in the model (200 ms injected, `PROBE_MODE=depth`, `a3-node-depth-x1.json`) | 9.1                             | 4.3 (lowest sample 4.1)         | **6.0**            |
| R2 reads in sequence (the same method)                                                           | 2.1                             | 2.1                             | 2.0                |
| D1 calls in sequence, complete request (model + 6 prelude calls)                                 | 15                              | 10                              | **12**             |
| R2 reads                                                                                         | 2                               | 2                               | 2                  |
| R2 bytes                                                                                         | 24,307,562                      | 24,307,562                      | 24,307,562         |
| Node total (model + JSON body), median of 9                                                      | 866.3 ms                        | 870.1 ms                        | 912.1 ms           |
| R2 read (memory copy, no network)                                                                | 1.0                             | 1.1                             | 1.0                |
| SHA-256                                                                                          | 9.4                             | 9.4                             | 9.6                |
| decode                                                                                           | 1.0                             | 1.0                             | 1.0                |
| `JSON.parse`                                                                                     | 33.4                            | 34.8                            | 35.3               |
| canonical check                                                                                  | 118.3                           | 125.4                           | 127.8              |
| expand and validate                                                                              | 637.9                           | 636.7                           | 672.4              |
| review rows from the inventory                                                                   | 14.8                            | 14.1                            | 14.8               |
| D1 (local SQLite, no network)                                                                    | 0.6                             | 0.5                             | 0.4                |
| `completeReviewRows`                                                                             | 6.2                             | 6.5                             | 6.4                |
| model build and compact                                                                          | 30.8                            | 28.9                            | 30.4               |
| JSON output                                                                                      | 12.6                            | 11.9                            | 13.3               |
| Response bytes raw                                                                               | 5,332,737                       | 5,332,792                       | 6,347,544          |
| gzip                                                                                             | 681,308                         | 681,328                         | 689,189            |
| brotli                                                                                           | 559,411                         | 559,307                         | 559,556            |

D1 order for state (c), model part: run row; closed summary check; batch of 4 (run, comparisons, summary rows, summary decisions); batch of 3; project; run (status chain); run inventory header; snapshot inventory header.

Node CPU profile, state (b) (`PROBE_MODE=profile`, `<scratch>/raw/a3-node-profile-x1.json`, 5 requests): 731.7 ms active and 107.4 ms idle for each request. The idle time is the wait for the WebCrypto thread pool. Largest phases: profile digests 185.5 ms, canonical check 112.8, other validation 83.4, `parseManifest` 44.7 + 42.7.

### M4 · The same request in workerd (A4)

Probe: `<scratch>/probe/workerd.probe.ts` and `worker-entry.ts`. An esbuild bundle (2,407,017 bytes) imports the same modules as the production Worker (`handleApi`, `reviewModel`, `readReviewInventory`) and runs in workerd 1.20260921.1 through Miniflare with local D1 and R2. The built Worker in `apps/web/dist/server` is the preview build with no D1 or R2 binding, so I did not use it.

Method for time: wall time around `Miniflare.dispatchFetch` plus the complete body read, in the Node process. No timer inside the Worker is used. `/probe/noop` takes 0.6 to 0.8 ms, so the transport is not a relevant part.

| Scope (state (b), median)                 | Node     | workerd  | workerd / Node |
| ----------------------------------------- | -------- | -------- | -------------- |
| `reviewModel` + JSON body, 3,832 captures | 870.1 ms | 686.5 ms | 0.79           |
| the same, state (a)                       | 866.3    | 815.2    | 0.94           |
| the same, state (c)                       | 912.1    | 687.3    | 0.75           |
| the same, 7,664 captures                  | 1,673.2  | 1,242.4  | 0.74           |
| the same, 11,496 captures                 | 2,506.2  | 1,913.8  | 0.76           |

workerd is 6 to 26% faster than Node on the same machine for this request. The profiles show the reason: Node waits 107 ms for each request on the WebCrypto thread pool and spends 185 ms in the profile digests; workerd spends 128 ms there and has 29 ms idle.

All workerd medians, 3,832 captures (`<scratch>/raw/a4-workerd-x1.json`):

```text
                                          (a)       (b)       (c)
two R2 reads in sequence (local disk)     41.3      37.8      37.5
two R2 reads together                     39.2      35.7      38.1
SHA-256, both objects                     10.5      10.0      10.8
decode, both                               2.8       1.9       2.3
decode + JSON.parse, both                 23.9      21.3      23.6
decode + parse + canonical check, both   136.0     137.1     146.3
readReviewInventory (memory store)       616.5     585.8     574.2
readReviewInventory (local R2)           601.4     577.4     572.8
reviewModel (memory store)               696.8     650.1     623.6
reviewModel + JSON body                  815.2     686.5     687.3
handleApi (memory store)                 748.1     696.4     672.7
handleApi (local R2)                     712.8     666.3     647.9
```

CPU profile through the Miniflare inspector (`Profiler.start`, 100 us interval, 3 requests of `handleApi`, state (b)): `<scratch>/raw/a4-workerd-x1.cpuprofile`; summary in `a4-workerd-x1.json` (`workerdProfile`) and in WAIT-01. Outside wall time 675.4 ms for each request; profile active time 662.6 ms; idle 28.9 ms.

### M5 · Memory (A5)

Read first: `docs/evidence/worker-memory/README.md`. It says that local numbers do not prove a hosted peak, and that the inspector does not see WebAssembly memory.

- V8 heap caps in Node: table in WAIT-06. Command: `node <scratch>/probe/heap-driver.mjs 1 24,32,...,4096` and, for 2 and 3 times, `LIFT_LIMITS=1 node <scratch>/probe/heap-driver.mjs 2-lift ...`. Raw: `<scratch>/raw/a5-heap-caps-x1.json`, `-x2-lift.json`, `-x3-lift.json`. `--max-old-space-size` caps the old generation; the young generation can add up to 6 MiB (`--max-semi-space-size=2`); buffers are outside the cap. Wall time under a tight cap grows by 10 to 15% (three reads: 2,081 ms with no cap, 2,364 ms at 112 MiB).
- Buffers at the digest moment: 34.8 MiB for each read in the probe (one copy in the memory store, one read buffer, one copy in `sha256()`); 23.2 MiB for each read with R2 streaming, by the code.
- workerd inspector, `Runtime.getHeapUsage` polled from Node:

  ```text
  scenario                                               samples   committed heap peak   used (with garbage)   buffers
  one model read (memory store)                          2         122.2 MiB             56.1 MiB              35.7 MiB
  one model read (local R2)                              2         100.6                 56.1                  35.7
  three model reads in one isolate (memory store)        3         146.8                 64.3                  35.7
  three GET /api/runs/:id at the same time (local R2)    4         146.8                 64.3                  35.7
  ```

  Limits of this table: 24.1 MiB of the buffers is the probe's own copy of the two objects; workerd answered the inspector only 2 to 4 times for each request; `HeapProfiler.collectGarbage` gave no answer, so "used" includes garbage. Local workerd does not apply the hosted 128 MB limit.

- A worker-thread inspector session (`connectToMainThread`) cannot sample the main isolate during synchronous work in Node 24 (`<scratch>/heap/sampler-test.mjs`: 0 samples while busy). The cap method replaces it.

### M6 · R2 time and the explained sum (A6)

- Image IDs cannot be derived from the public artifact. Run images get `crypto.randomUUID()` (`apps/web/src/api/workflow-evidence.ts:77`). Imported baseline images get `digestJson([importId, digest])` (`apps/web/tooling/baseline-reset/reset.ts:412`); the import ID is a digest over the two database UUIDs, the project ID, and the source snapshot ID, revision, and SHA (`reset.ts:342-347`). The source snapshot ID is not in the repository. So an ID never equals the SHA-256 of a PNG, and I made **no image request**. The public image route (`apps/web/src/api/images.ts:16`) accepts the 64-character form, but I have no valid ID.
- No other anonymous route reads R2. So I have no R2 time from this location.
- One D1 read measured by Cloudflare: `cfWorker` of the `/images/<unknown uuid>` request is 115 to 144 ms in all 45 warm requests of M9 (median 119 to 131 ms for each gap). This agrees with the 125 to 145 ms of the earlier lanes.
- Sum: see WAIT-02. Explained: 1.3 to 1.5 s (D1) + 0.66 to 0.70 s (CPU at M4 Pro speed) = 2.0 to 2.2 s of 5.25 to 5.68 s. Not split: 3.0 to 3.7 s (R2 transfer of 24.3 MB in two sequential reads, plus the CPU speed difference). A GitHub permission call (about 0.2 to 0.3 s, `audit/second-lens-4.md`) can be in one sample, not in three in sequence.

### M7 · Three levers (A7)

Probe: `PROBE_MODE=levers ... node-model`, module mocks of `capture-inventory.ts` and `api/review-inventory.ts` in scratch. Raw: `<scratch>/raw/a7-levers-x1.json`. State (b), Node, median of 7.

| Lever                                                                                                                                   | Total                   | Saved time            | Response bytes     | R2               | D1 trips in model   | Same response                      | Contract lines                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------- | ------------------ | ---------------- | ------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Current code                                                                                                                            | 869.5 ms                |                       | 5,332,792          | 2 reads, 24.3 MB | 10                  |                                    |                                                                                          |
| 1. Start the two R2 reads together, no injected wait                                                                                    | 862.5                   | 0 (CPU on one thread) | 5,332,792          | 2 reads, 24.3 MB | 10 (11 in the mock) | yes                                | none; `:26` stays true                                                                   |
| 1. The same with 300 ms injected for each R2 `get`                                                                                      | 1,168.0 against 1,491.3 | 323 ms (one R2 wait)  | 5,332,792          | 2 reads          |                     | yes                                | none                                                                                     |
| 2. Keep the digest check, skip the canonical check and the validation                                                                   | 128.7                   | 740.8 ms (85%)        | 5,332,792          | 2 reads, 24.3 MB | 10                  | yes                                | `:24` ("validates ... before importing the result")                                      |
| 2. The same in workerd, real `handleApi` (`LEVER_SKIP_VALIDATE=1 WORKERD_LIGHT=1 ... workerd.probe`, `a4-workerd-x1-skipvalidate.json`) | 158.1 against 696.4     | 538.3 ms (77%)        | 5,332,792          | 2 reads, 24.3 MB | 10                  | same size, same gzip size          | `:24`                                                                                    |
| 3. Only the rows that D1 stores                                                                                                         | 0.3                     | 869 ms                | 7,483 (gzip 2,150) | 0                | 8                   | no: 4 variants, no reference image | `:26` ("Review reads the full inventory to show unchanged items"), decision P01 (`:148`) |

Lever 1 saves the time of the shorter R2 read in production; that time is not known (WAIT-02). The mock for lever 1 reads the baseline key with one more D1 query; the real change does not need it, because the comparison row has the snapshot ID.

One more measured option (not in the task list): store the object compressed. 12,154,546 bytes become 1,506,911 (gzip 6) or 1,236,209 (brotli 5); decompression 9.7 to 20.6 ms in Node (`<scratch>/raw/a7-compress-cost.json`).

### M8 · Two and three times the real capture count (A8)

`fixture.ts` repeats the real manifest. Each copy has new item keys, test IDs, image digests, and profiles, because in the real data almost each capture has its own profile.

With the real limits (`FACTOR=2 ... build.probe`, `FACTOR=1.37`, `FACTOR=1.39`): the fixture at 5,250 captures is stored (16,705,886 bytes); at 5,326 and at 7,664 the real `writeCaptureInventory` throws `Capture inventory exceeds its size limit.` (`<scratch>/raw/a2-fixture-x1_37.json`, `-x1_39.json`, `-x2.json`).

To see what comes after that limit, `LIFT_LIMITS=1` loads `capture-inventory.ts` and `validate.ts` with larger limits (16 MiB becomes 256 MiB; 10,000 profiles become 100,000). The text is replaced when Vite or esbuild loads the module (`<scratch>/probe/lift-limits.mjs`). No file in the repository changes.

|                                              | 3,832 captures      | 7,664 (limits lifted)  | 11,496 (limits lifted) |
| -------------------------------------------- | ------------------- | ---------------------- | ---------------------- |
| Profiles                                     | 3,613               | 7,226                  | 10,839                 |
| Submitted manifest                           | 7,018,634           | 14,122,128             | 21,227,119             |
| Run inventory bytes                          | 12,154,546          | 24,417,342             | 36,683,131             |
| R2 bytes for one model read                  | 24,307,562          | 48,833,154             | 73,364,732             |
| Model JSON raw / gzip, state (b)             | 5,332,792 / 681,328 | 10,670,258 / 1,360,847 | 16,010,949 / 2,040,752 |
| Node total, state (a) / (b) / (c)            | 866 / 870 / 912 ms  | 1,687 / 1,673 / 1,644  | 2,598 / 2,506 / 2,547  |
| workerd `handleApi`, state (b), memory store | 696.4 ms            | 1,272.1                | 1,911.0                |
| workerd `readReviewInventory`                | 585.8               | 1,111.1                | 1,716.7                |
| D1 round trips, request, state (b)           | 16                  | 16                     | 16                     |
| Live heap, one read                          | 44 to 51 MB         | 82 to 90               | 121 to 131             |
| Live heap, two reads                         | 71 to 80            | 137 to 147             | 212 to 224             |
| Live heap, three reads                       | 105 to 109          | 194 to 201             | not run                |

What fails first, in order of capture count (same data shape):

| At about                        | What                                                                                        | Kind of evidence                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 4,500 to 4,700 (1.17x to 1.23x) | Three model reads at the same time need more than 128 MB of live heap                       | interpolation of measured V8 caps; hosted accounting not known |
| 5,270 (1.38x)                   | The 16 MiB inventory write. Each run fails.                                                 | measured with the real code                                    |
| 5,700 (1.49x)                   | The CLI 8 MiB manifest limit (combined manifest); 3,950 captures in the linux shard (1.50x) | computed from measured bytes                                   |
| 6,600 to 6,900 (1.7x to 1.8x)   | Two model reads at the same time over 128 MB                                                | interpolation                                                  |
| 9,160 (2.39x)                   | The server 16 MiB manifest limit                                                            | computed                                                       |
| 10,600 (2.77x)                  | 10,000 profiles                                                                             | computed; at 3x the real `parseManifest` rejects the manifest  |
| 10,900 to 11,700 (2.8x to 3.0x) | One model read over 128 MB                                                                  | measured V8 caps at 3x                                         |

CPU does not fail: the time grows in a straight line (0.70 s, 1.27 s, 1.91 s in local workerd), and `apps/web/wrangler.jsonc:40` sets `cpu_ms` to 240,000. D1 does not limit this read path: D1 holds only the changed rows, and the round trip count is 16 at all three sizes.

### M9 · Cold first requests (B1 to B3)

Commands:

```sh
node <scratch>/cold/cold-probe.mjs <scratch>/cold/samples.jsonl 8        # first run, stopped after 8 samples by the session interruption
node <scratch>/cold/cold-probe.mjs <scratch>/cold/samples.jsonl 7        # resumed: 29 more samples
node <scratch>/cold/final-sequence.mjs                                    # 5 document-first samples, then 8 samples 1 s apart
gh run list --repo ariakit/visonaut --workflow deploy.yml --limit 30 --json databaseId,conclusion,createdAt,updatedAt,headSha,event
node <scratch>/cold/analyze.mjs 100 ; node <scratch>/cold/table.mjs ; node <scratch>/cold/analyze-document.mjs
```

Method: Node `https` with one new `Agent` (one new TCP and TLS connection) for each sample, HTTP/1.1, no cookie, no credentials. DNS, TCP, and TLS times come from the socket events `lookup`, `connect`, and `secureConnect`. Time to first byte is from the end of the TLS handshake (first request) or from the request start (later requests) to the response headers. The idle gap is the time from the end of the previous sample of this client. Traffic of other clients is not controlled.

Request budget: 1 (a first start that stopped on a script error after one request) + 37 x 6 + 5 x 3 + 8 x 6 = **286 anonymous GET requests of the 300 allowed**. No image request (M6). No POST, no cookie.

Time to first byte in ms, median / p90. "Cold" is the first request of its kind on a new connection. "Warm" is the same request again on the same connection.

| Idle gap before the sample                 | Samples | DNS       | TCP      | TLS      | Asset cold | Asset warm | `/health` cold | `/health` warm | Image 404 cold | Image 404 warm |
| ------------------------------------------ | ------- | --------- | -------- | -------- | ---------- | ---------- | -------------- | -------------- | -------------- | -------------- |
| 1 s                                        | 8       | 4 / 15    | 21 / 97  | 32 / 41  | 41 / 53    | 34 / 113   | 25 / 156       | 27 / 103       | 178 / 272      | 149 / 207      |
| 10 s                                       | 9       | 3 / 4     | 17 / 98  | 34 / 49  | 49 / 87    | 41 / 85    | 96 / 233       | 34 / 111       | 166 / 221      | 149 / 290      |
| 60 s                                       | 9       | 2 / 711   | 19 / 628 | 35 / 298 | 51 / 127   | 39 / 71    | 191 / 307      | 29 / 60        | 155 / 263      | 158 / 204      |
| 300 s                                      | 9       | 4 / 290   | 27 / 113 | 34 / 55  | 60 / 132   | 42 / 165   | 259 / 452      | 35 / 115       | 196 / 287      | 154 / 233      |
| 900 s                                      | 8       | 275 / 314 | 16 / 177 | 36 / 168 | 49 / 224   | 43 / 265   | 256 / 326      | 26 / 59        | 219 / 394      | 182 / 515      |
| resume (about 2.4 h idle from this client) | 1       | 283 / 283 | 17 / 17  | 30 / 30  | 55 / 55    | 38 / 38    | 299 / 299      | 31 / 31        | 158 / 158      | 154 / 154      |
| first (no controlled gap)                  | 1       | 9 / 9     | 18 / 18  | 49 / 49  | 45 / 45    | 33 / 33    | 220 / 220      | 28 / 28        | 332 / 332      | 247 / 247      |

Penalty = cold minus warm in the same sample, in ms, median / p90. The last three columns count the samples with a penalty of more than 100 ms.

| Idle gap                                   | Samples | Asset penalty | Worker penalty (`/health`) | D1 penalty (image 404) | `cfEdge` of cold `/health` | `cfEdge` of warm `/health` | `cfWorker` of image 404, cold | warm      | Asset slow | Worker slow | D1 slow |
| ------------------------------------------ | ------- | ------------- | -------------------------- | ---------------------- | -------------------------- | -------------------------- | ----------------------------- | --------- | ---------- | ----------- | ------- |
| 1 s                                        | 8       | 5 / 22        | -1 / 134                   | 33 / 120               | 5 / 138                    | 4 / 5                      | 118 / 177                     | 119 / 121 | 0 of 8     | 1 of 8      | 1 of 8  |
| 10 s                                       | 9       | 2 / 60        | 65 / 179                   | 12 / 76                | 12 / 174                   | 10 / 20                    | 124 / 132                     | 122 / 133 | 0 of 9     | 4 of 9      | 0 of 9  |
| 60 s                                       | 9       | 10 / 92       | 166 / 277                  | 7 / 65                 | 159 / 243                  | 9 / 30                     | 128 / 143                     | 122 / 131 | 0 of 9     | 7 of 9      | 0 of 9  |
| 300 s                                      | 9       | 10 / 64       | 165 / 425                  | 7 / 133                | 167 / 363                  | 7 / 14                     | 132 / 208                     | 126 / 138 | 0 of 9     | 6 of 9      | 1 of 9  |
| 900 s                                      | 8       | 13 / 163      | 216 / 268                  | 42 / 243               | 204 / 279                  | 7 / 19                     | 144 / 194                     | 126 / 132 | 1 of 8     | 7 of 8      | 1 of 8  |
| resume (about 2.4 h idle from this client) | 1       | 17 / 17       | 268 / 268                  | 4 / 4                  | 253 / 253                  | 8 / 8                      | 132 / 132                     | 129 / 129 | 0 of 1     | 1 of 1      | 0 of 1  |
| first (no controlled gap)                  | 1       | 12 / 12       | 192 / 192                  | 85 / 85                | 192 / 192                  | 7 / 7                      | 304 / 304                     | 119 / 119 | 0 of 1     | 1 of 1      | 0 of 1  |

All samples together:

```text
samples 45   requests 270   colos {"GRU":43,"GIG":2}   statuses 200,200,404,200,200,404
setup ms (median / p90 / max):  DNS 4 / 286 / 711   TCP 19 / 98 / 628   TLS 34 / 55 / 298
penalty ms (median / p90 / max): asset 8 / 60 / 163   worker 137 / 268 / 425   D1 13 / 85 / 243
samples with a penalty over 100 ms: asset 1, worker 27, D1 3 of 45
worker penalty when it is over 100 ms: median 185, p90 268, min 132, max 425 (n=27)
asset cache MISS in samples: [12]   cf-placement headers: []
samples in the 10 minutes after a deploy: 0   minutes after the last deploy: min 138, max 466
cfWorker of /health (cold): max 1 ms
cfWorker of image 404 (one D1 read), all 90 requests: min 115, median 125, p90 144, max 304
```

The row "resume" is the first sample after the session interruption (8,628 s after the previous sample). The row "first" is the first sample of the lane.

Document first (5 samples, 60 s idle before each; the first one had about 4 minutes; `<scratch>/cold/summary-document.json`):

```text
sample   document cold: TTFB / cfEdge / cfWorker   /health after it: TTFB   document warm: TTFB / cfEdge / cfWorker
0        257.3 / 162 / 60 ms                       34.6                     42.7 / 9 / 7
1        241.7 / 165 / 53                          32.4                     36.4 / 7 / 10
2        237.9 / 153 / 57                          28.0                     42.6 / 9 / 9
3         88.5 /  15 / 54                          27.9                     35.7 / 7 / 11
4         47.1 /  12 / 12                          25.9                     35.6 / 5 / 12
```

Deploys: 30 runs of `deploy.yml` read. The last two are 2026-10-05T17:46:30Z to 17:53:24Z and 18:40:14Z to 18:47:27Z (commit `f83fef6`). All samples are 138 to 466 minutes after the last deploy, so **no sample is in the 10 minutes after a deploy**.

Answers to B3:

- **Connection:** not the cause. The asset on the new connection is slow in 1 of 45 samples. TCP has a median of 19 ms and TLS of 34 ms. DNS is 1.5 to 9 ms when the answer is in the local cache and 257 to 314 ms when it is not: 0 of 9 samples after 10 s, 3 of 9 after 300 s, and 7 of 8 after 900 s (one sample after 60 s had 711 ms). This DNS time is a cost of the client resolver, and it is part of a maintainer's wait after an idle period.
- **Worker:** yes. Cold `/health` is more than 100 ms slower than warm `/health` in 1 of 8 samples at 1 s, 4 of 9 at 10 s, 7 of 9 at 60 s, 6 of 9 at 300 s, and 7 of 8 at 900 s. When it is slow: median 185 ms, p90 268 ms, maximum 425 ms. Cloudflare reports all of it as `cfEdge` (135 to 363 ms) with `cfWorker` 0 or 1 ms.
- **D1:** small. One D1 read is 115 to 144 ms of `cfWorker` in 82 of 90 requests. 8 first reads on a new connection take 177 to 304 ms.
- **Deploys:** the penalty is there with no deploy in the 2.3 hours before the first sample. The effect of a deploy itself is not measured.
- **Median and p90 for each gap:** in the two tables above.

### M10 · The entry of a maintainer from a GitHub check link (B4)

Case: a click on the check link `https://visonaut.com/pulls/<n>?check=...` after 15 minutes or more with no request, for an active run that needs review.

| Step                                                                                                                                    | Value                                                                                                                                                   | Measured or estimated                                                                                                | Source                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. DNS, TCP, TLS for a new connection                                                                                                   | median 326 ms after 900 s idle (228 to 512 ms; DNS is 265 to 314 ms of it). 63 to 69 ms when the DNS answer is in the local cache.                      | measured                                                                                                             | M9                                                                |
| 2. Document (Worker, server render, no D1), first request of the connection                                                             | 238 ms median time to first byte (47 to 257 ms). Warm: 36 to 43 ms.                                                                                     | measured on `/` as a guest after 60 s idle; the signed-in pull page is not measured                                  | M9, document first                                                |
| 3. JavaScript files                                                                                                                     | all finished about 240 ms after navigation start when they are in the browser cache                                                                     | measured by the orchestrator (repeat visit)                                                                          | `audit/live-authenticated.md`                                     |
| 4. `GET /api/pulls/<n>`: 8 D1 round trips in sequence                                                                                   | 0.99 to 1.23 s                                                                                                                                          | estimated: 30 ms + 333 ms + 6 x 105 to 145 ms. The count of 8 is measured.                                           | `audit/review-load/probe/api-path.json`, `audit/second-lens-4.md` |
| 5. The same request with a cold permission cache: 3 GitHub requests in sequence                                                         | 0.7 to 1.0 s more                                                                                                                                       | estimated for the Worker; measured from a client in São Paulo                                                        | `audit/second-lens-4.md`                                          |
| 6. Client navigation to `/runs/<id>`                                                                                                    | no document request                                                                                                                                     | code                                                                                                                 | `apps/web/src/routes/pulls.$pullNumber.tsx:82`                    |
| 7. `GET /api/runs/<id>`, active run that needs review: 15 D1 round trips in sequence, 2 R2 reads of 24.3 MB, validation, 5.3 MB of JSON | 5.8 to 6.4 s                                                                                                                                            | estimated: 5.25 to 5.68 s measured for archived runs (10 D1 calls in sequence), plus 5 more D1 calls x 105 to 145 ms | `audit/live-authenticated.md`, M3, WAIT-02                        |
| 8. Download of 692 KB, parse, first render                                                                                              | 1.1 to 1.8 s from the end of the response to visible content                                                                                            | measured (background tab)                                                                                            | `audit/live-authenticated.md`                                     |
| **Sum**                                                                                                                                 | **about 9 to 11 s from the click to the first visible review content** (8.2 to 9.7 s with a warm DNS cache, a warm Worker, and a warm permission cache) | sum of the rows                                                                                                      |                                                                   |

Step 7 is about 60% of the sum. Steps 1 and 2 together are about 0.5 s, and the cold Worker is about 0.2 s of that.

## Open questions and items not verified

1. **The split of the 3.0 to 3.7 s (WAIT-02).** I have no R2 time and no Workers CPU time. One production invocation log or trace of `GET /api/runs/<id>` gives both (CPU time, wall time, the two R2 `get` spans). The bucket location is not recorded in the repository.
2. **The real inventory sizes in production.** The fixture gives 12,154,546 bytes for the run and 12,153,016 bytes for the baseline. The model bytes agree with production within 0.03%, so the run inventory is probably close. I did not read `visonaut_runs.inventory_bytes` or `visonaut_snapshots.inventory_bytes` from production. A read-only D1 query confirms it.
3. **The shape of the production baseline inventory.** I assumed a run-shaped inventory with a manifest. If the baseline is still the imported object (no manifest), its size and validation cost are different.
4. **The receipt is invented.** The fixture has 4 changed captures of 3,832. The cost of the model depends on the total count, not on the changed count, but real receipts can have other field values.
5. **Hosted memory accounting (WAIT-06).** The numbers are V8 heap caps in Node. I did not measure how the hosted runtime counts buffers, when it collects, or what a request sees when the isolate is over 128 MB. Local workerd gave no usable live-heap number.
6. **What happens after the inventory limit (WAIT-05).** The limit itself is measured with the real code. The retry and alert path is read in the code and not run. What the GitHub check shows for such a run is not verified.
7. **Scale fixtures repeat the real data.** At 2 and 3 times, each copy has new item keys, test IDs, digests, and profiles. Real growth can have other key lengths or fewer profiles, so the count for each limit can move by some percent.
8. **Lever 2 in workerd** is measured with three lines replaced at bundle time. A real implementation can differ by some milliseconds.
9. **The workerd profile has 67 ms for each request that is not attributed** (native code: stream reads, `JSON.stringify` of the response, HTTP transport).
10. **No production measurement exists for an active run that needs review.** All three production samples are archived runs. The estimate for an active run in M10 adds 5 D1 calls in sequence by the count model.
11. **The pixel limit.** The largest real image uses 73.7% of 2,100,000 pixels. The CLI applies the limit to reference metadata (`packages/cli/src/local-comparison.ts:81`) and the image validator has it (`packages/compare/src/types.ts:59`). I did not run a candidate image over the limit through the upload path.
12. **Cold first request (WAIT-08).** One client location and one network (São Paulo; the edge answered from `GRU` and `GIG`). `/health` stands in for the Worker in the main probe; the document on a new connection has only 5 samples, as a guest on `/`. The reason for the `cfEdge` time is an inference: Cloudflare does not name it in the header. Other clients were not controlled: an open dashboard tab polls each 60 s and can keep an isolate warm at its own edge server. No deploy happened in the sample window, so the first 10 minutes after a deploy are not measured.
13. **Image IDs.** I could not derive a valid image ID from public data, so I made no image request and have no R2 read time from this location.
14. **The Node heap sampler.** A worker-thread inspector session cannot sample the main isolate during synchronous work in Node 24, so there is no time series of the heap, only caps and the size after each full collection.
