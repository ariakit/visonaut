# Object storage life cycle: what is written to R2, what protects it, what deletes it, and what a restore loses

Lane: `gap-storage-lifecycle`. Commit `f83fef6`. All paths are relative to the repository root. `api/`, `operations/`, and `review/` mean `apps/web/src/api/`, `apps/web/src/operations/`, and `apps/web/src/review/`.

Method: source reading, plus probes that run the real repository code with a controlled clock. The probes use the repository test doubles (`node:sqlite` with all migrations, and the in-memory `MemoryStore`), the real baseline import tool, and one real Ariakit capture set (3,832 captures, from workflow run 37342354710). No probe touched production. This audit changed no repository file. All scripts and raw results are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-storage-lifecycle/`.

## How it works (map)

### The two buckets today

`apps/web/wrangler.jsonc:75-84` binds `IMAGES` (`visonaut-images`) and `QUARANTINE` (`visonaut-quarantine`). The entries have only `bucket_name` and `binding`. The repository has no life-cycle rule, no bucket lock, and no versioning setting (search result in Measurements, M9).

Three facts differ from what the names suggest:

1. No image is written to `QUARANTINE`. An upload goes directly to `IMAGES` (`api/workflow-owned.ts:1103`: `await context.images.put(image.object_key, bytes, …)`). The column `ingest_staged_images.quarantine_key` (`api/workflow-evidence.ts:87`) is only the identity of the upload ticket. It is never an R2 key.
2. An image in `IMAGES` is public only when D1 has a row for it (`api/images.ts:26`: `… FROM visonaut_images WHERE id = ? AND validated = 1`). That row is written at materialization, after trusted Submit. So D1 is the quarantine boundary, not the bucket.
3. `IMAGES` also holds private metadata: run inventories (test file paths, profiles, the signed manifest), the import plan, and old history archives.

### Key map

Sizes marked "real" come from the real capture set (M1). "By code" means not measured.

| #   | Key pattern (bucket)                                                                                                               | Writer                                                                                                                                      | Content and size                                                                                                                                                                            | Readers                                                                                                                                                                                                                                                          | D1 pointer                                                                                                                                                        | What protects it                                                                                                                             | Deleter and condition                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `runs/<run>/images/<imageId>` (IMAGES)                                                                                             | Upload: `api/workflow-owned.ts:1103`. Reuse copy: `api/workflow-owned.ts:969`.                                                              | One PNG original or one mask. Only changed captures are uploaded (`packages/protocol/src/validate.ts:477`). Real: 3,695 files, 71,075,268 bytes; p50 12,201, p90 28,705, max 210,405 bytes. | Public route `api/images.ts:39-40`. Materialize `api/workflow-materialize.ts:106` (list), `:218`. Reuse source `api/workflow-owned.ts:935`. Promotion check `operations/promotions.ts:87`. Recovery `operations/recovery.ts:98`, `:200`.                         | Before materialization: `ingest_staged_images.object_key`. After: `visonaut_images.object_key`, and `captures[].image.objectKey` in each inventory that names it. | Staging: `ingest_staged_runs.retention_state='live'` and the 6-hour lease. After: `work_retained_runs.byte_state` and `work_retention_pins`. | (a) `api/workflow-retention.ts:199`, when the stage is 24 hours old and has no `visonaut_runs` row. (b) `operations/retention.ts:86-104`, 30 days after the run closed, with no pin and a ready closed summary.                                           |
| 2   | `runs/<run>/inventory/<sha256>.json` (IMAGES)                                                                                      | `capture-inventory.ts:481`, called at `api/workflow-materialize.ts:403`.                                                                    | Full capture list plus the signed manifest. Real: 11,662,476 bytes for an unchanged run, 11,417,201 for a first run (M1).                                                                   | Review model `api/review-inventory.ts:44-47`. Reference pages and images `api/local-comparison.ts:60-103`. Promotion `operations/promotions.ts:304`. Sealed-run recovery `api/workflow-materialize.ts:389`, `:517`. Recovery check `operations/recovery.ts:173`. | `visonaut_runs.inventory_key` (+ digest, bytes, count). The accepted snapshot reuses the same object: `visonaut_snapshots.inventory_key`.                         | Nothing is necessary. No code deletes it.                                                                                                    | **None** when `inventory_key` is set (`operations/retention.ts:22`, `:46`: "Keep sparse review inventories after their original images expire."). If the D1 commit never happened, the full `runs/<run>/` prefix is deleted with the run (M5, probe R4c). |
| 3   | `baselines/import/<importId>/images/<digest>.<ext>` (IMAGES)                                                                       | `apps/web/tooling/baseline-reset/reset.ts:619`.                                                                                             | Copy of each original of the imported baseline.                                                                                                                                             | Same as row 1.                                                                                                                                                                                                                                                   | `visonaut_images.object_key`; the import inventory.                                                                                                               | `work_retention_pins` on the synthetic import run.                                                                                           | `operations/retention.ts:24-43` (the import branch of `imagePrefix`), when the import run has no pin.                                                                                                                                                     |
| 4   | `baselines/import/<importId>/inventory/<sha256>.json`, `plan.json`, `copies/<n>.json` (IMAGES)                                     | `reset.ts:451`, `:469`, `:669`.                                                                                                             | Import inventory, import plan, one receipt for each copy page. One time.                                                                                                                    | Inventory: as row 2. `plan.json` and `copies/`: only the import tool.                                                                                                                                                                                            | Inventory: `visonaut_runs` and `visonaut_snapshots`. Others: none.                                                                                                | Nothing.                                                                                                                                     | **None.**                                                                                                                                                                                                                                                 |
| 5   | `quarantine/staged/<run>/<job>/manifests/<digest>.json` (QUARANTINE)                                                               | `api/workflow-evidence.ts:203`.                                                                                                             | Canonical combined manifest with the local receipt. Real: 7,017,547 bytes (M1; the receipt part is synthetic).                                                                              | `api/workflow-evidence.ts:185`, `:258` (declare, finalize, reconcile).                                                                                                                                                                                           | `ingest_staged_manifests.manifest_object_key`. After materialization also `ingest_manifests.object_key` (`api/workflow-materialize.ts:445-448`).                  | `ingest_staged_runs.retention_state='live'`, the lease, and the eligibility rule `api/workflow-retention.ts:21-36`.                          | `api/workflow-retention.ts:201`: 24 hours after the stage was created, lease ended, run sealed with a comparison (or inactive, or never materialized).                                                                                                    |
| 6   | `plans/workflow/<jobSetDigest>.json` (QUARANTINE)                                                                                  | `api/workflow-materialize.ts:707`.                                                                                                          | Plan evidence. 545 bytes (M6).                                                                                                                                                              | Only `operations/history.ts:503-537`, which has no production caller (M9).                                                                                                                                                                                       | `ingest_run_provenance.plan_object_key`.                                                                                                                          | Nothing.                                                                                                                                     | **None.**                                                                                                                                                                                                                                                 |
| 7   | `history/<run>/<generation>/…` (IMAGES)                                                                                            | `operations/history.ts:241`. The callers `archiveClosedRuns` and `archiveHistoricalComparisons` have no production caller (M9).             | Old closed-run archives.                                                                                                                                                                    | `operations/closed-summary.ts:82-128` (conversion of old archives).                                                                                                                                                                                              | `operations_run_archives.object_key`, `operations_comparison_archives.object_key`.                                                                                | Nothing.                                                                                                                                     | **None.**                                                                                                                                                                                                                                                 |
| 8   | `baselines/<digest>/…` (IMAGES), protected copies                                                                                  | No writer in current code. Promotion "writes no protected image copy" (`operations/README.md:22`).                                          | Old form.                                                                                                                                                                                   | —                                                                                                                                                                                                                                                                | `visonaut_snapshots.prefix` with `storage_mode='protected'`.                                                                                                      | `visonaut_snapshot_retention`, `visonaut_pins`.                                                                                              | `operations/snapshot-retention.ts:134-139`. It selects only `storage_mode='protected'` (`:91`). New snapshots are `'source'` (`packages/service/src/baseline-promotion.ts:154`), so this step has no R2 work on new data.                                 |
| 9   | `derived/<run>/…` (IMAGES); `quarantine/<run>/…`, `manifests/<run>/…` (QUARANTINE); `exports/<id>/…`, `exports/<id>.json` (IMAGES) | No writer in the web Worker. `apps/compare/src/process.ts:86-87` writes `derived/`, but `apps/compare/src/index.ts:1-2` does not import it. | Old forms.                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                | Old tables.                                                                                                                                                       | —                                                                                                                                            | `operations/retention.ts:88-90`, `api/workflow-retention.ts:203`, `operations/exports.ts:18-26`.                                                                                                                                                          |

### The pin chain

`work_retained_runs` has one row for each run: `object_prefix`, `closed_at`, `byte_state` (`live` → `deleting` → `deleted`). `work_retention_pins(run_id, owner, reason)` holds the pins. Four triggers enforce the rules:

- `work_pin_requires_live_insert` and `_update` (`apps/web/migrations/0002_work.sql:72-77`): no new pin on a run whose bytes are not `live`.
- `work_delete_requires_unpinned` (`0002_work.sql:78-80`): `byte_state` cannot leave `live` while a pin exists.
- `work_no_byte_resurrection` (`0002_work.sql:81-83`, changed in `0024_core_simplification.sql:55-63`): a run cannot go back to `live`.
- `visonaut_snapshot_no_new_pin` (`0014_visonaut_brand.sql:88-89`): no new snapshot pin when the snapshot bytes are not `live`.

| Pin owner                                                    | Put on                                                     | Created                                                 | Released                                                                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review:<run>`                                               | the run                                                    | `packages/service/src/run-admission.ts:171-175`         | When the run closes (`run-retirement.ts:58-62`, `:119-123`; `baseline-promotion.ts:473-477`).                                                                                             |
| `submit:<stagedRun>`                                         | each owner in the reference inventory                      | First reference page, `api/local-comparison.ts:382-392` | When the staged attempt is deleted, `api/workflow-retention.ts:269-271` (24 hours or more).                                                                                               |
| `inherited-by:<run>`                                         | each other run that owns an image in this run's inventory  | `run-admission.ts:634-641`                              | **Only** when the bytes of `<run>` are deleted: `packages/service/src/retention.ts:206-210`.                                                                                              |
| `comparison:<comparisonId>`                                  | the run of the reference snapshot and each reference owner | `packages/service/src/local-comparison.ts:280-289`      | 30 days after the borrowing run closed: `retention.ts:20-24`.                                                                                                                             |
| `promotion:<snapshot>` (reason `promotion`, then `baseline`) | the promoted run and each owner in its inventory           | `baseline-promotion.ts:183-193`; `:448-454`             | `retention.ts:95-97`, called by `retireSourceBaselines` (`operations/snapshot-retention.ts:197-215`): the snapshot's run closed 30 days ago and the snapshot is not the project baseline. |
| `operations:<snapshot>`                                      | the candidate run                                          | Promotion lease, `packages/service/src/work.ts:748-763` | End of each promotion step.                                                                                                                                                               |

### Life of one image X (numbered walk-through)

1. Trusted Submit of run A uploads X to `runs/A/images/<id>` (`api/workflow-owned.ts:1103`). D1 has only the staged row. The public route returns 404.
2. Materialization registers X in `visonaut_images`, writes the inventory of A, and commits (`api/workflow-materialize.ts:283-439`). X is now public.
3. A becomes the baseline. `preparePromotion` pins A and each image owner with `promotion:<snapshot A>` (`baseline-promotion.ts:183-193`).
4. Run B does not change X. The CLI sees the same digest and does not download or upload X (`packages/cli/src/local-comparison.ts:261-276`). The inventory of B names `runs/A/images/<id>` with `image.runId = "A"`. `commitShard` asserts that A is `live` and adds `inherited-by:B` on A in the same batch (`run-admission.ts:629-641`).
5. B becomes the baseline. `promotion:<snapshot B>` is put on B **and on A** (the pin list comes from `inventory.captures[].image.runId`, `operations/promotions.ts:319`).
6. 30 days later: `summarizeClosedRuns` archives A and B, `expireComparisonReferences` releases the `comparison:` pins, `retireSourceBaselines` retires snapshot A and releases `promotion:<snapshot A>`. A still has two pins: `inherited-by:B` and `promotion:<snapshot B>`. `expireRunImages` does not select A. X stays (M2, scenario S1).
7. A later baseline replaces X. When no retained run names A, A has no pin, and `expireRunImages` deletes `runs/A/images/` and keeps `runs/A/inventory/`.

### The delete paths

- **Run images**, `expireRunImages` (`operations/retention.ts:47-148`). Candidates: a ready closed summary, no pin, and (`live` and closed 30 days ago, or `deleting` with an expired lease), `ORDER BY closed_at,id LIMIT 25`. It claims the run (`byte_state='deleting'`, new `deletion_token`, `deletion_until = now + 12 minutes`), lists and deletes four prefixes with a budget of 1,000 objects for each pass, then sets `bytes_present=0`, `byte_state='deleted'`, and releases the pins that this run owned.
- **Staged attempts**, `expireStagedAttempts` (`api/workflow-retention.ts:109-291`). Same claim pattern on `ingest_staged_runs`.
- **Protected snapshot copies**, `expireSnapshotImages`. No R2 work on new data (key map, row 8).
- **Exports**, `expireExports`. No writer remains.

### Windows of partial failure (R4)

| Path                                                | R2 done, D1 not done                                                                                                                               | D1 done, R2 not done                                    | What removes the remainder                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Upload (`workflow-owned.ts:1103-1120`)              | Object exists, staged row has `complete=0`. A retry writes the same key again.                                                                     | Not possible: R2 is first.                              | With the stage after 24 hours (`workflow-retention.ts:199`), or with the run at 30 days.                           |
| Reuse copy (`workflow-owned.ts:965-1000`)           | Same as upload.                                                                                                                                    | Not possible.                                           | Same as upload.                                                                                                    |
| Inventory write (`workflow-materialize.ts:403-439`) | `runs/<run>/inventory/<digest>.json` exists, `inventory_key` is NULL. A retry with the same facts writes the same key.                             | Not possible.                                           | If the run never commits: deleted with the full `runs/<run>/` prefix 30 days after close (M5, R4c: `objects: []`). |
| Staged manifest (`workflow-evidence.ts:184-208`)    | Not possible: the D1 row is first.                                                                                                                 | Row exists, object missing: the next declare writes it. | With the stage after 24 hours.                                                                                     |
| Plan evidence (`workflow-materialize.ts:706-757`)   | Object exists, no provenance row.                                                                                                                  | Not possible.                                           | **Nothing** (STORE-09).                                                                                            |
| Snapshot copy                                       | No R2 write in current code.                                                                                                                       | —                                                       | —                                                                                                                  |
| Delete run images                                   | Some or all objects gone, row is `deleting`, `bytes_present` still 1. The public route returns 404 for the missing objects and 200 for the others. | Not possible: R2 is first.                              | The next pass after the lease ends (see below).                                                                    |
| Delete staged attempt                               | Same shape.                                                                                                                                        | —                                                       | Next pass after the lease ends.                                                                                    |
| Delete exports                                      | Objects gone, row `failed`.                                                                                                                        | —                                                       | Next pass selects `state!='expired'`.                                                                              |

`deletion_until` and `deletion_token` when a pass stops (M5, probe R4b, production lease of 720,000 ms):

- A pass that throws, or a Worker that stops, leaves `byte_state='deleting'`, the token, and `deletion_until = claim time + 12 minutes`. The catch block only records the alert `retention:<run>:delete-failed` (`retention.ts:137-144`). It does not shorten the lease.
- The run is not selected again until `deletion_until <= now`. With the 5-minute cron, that is the third tick. Measured: no retry at +0 and +5 minutes, complete at +13 minutes, alert resolved.
- A pass that runs out of object budget sets `deletion_until = now` (`retention.ts:110-113`), so the next pass continues at once.
- `deletion_token` is not cleared after completion (`has_token: 1` with `byte_state: "deleted"`). It has no effect.

### Answers to R3 (all measured, M2 to M4)

| Scenario                                                                                             | Public image route                                                    | Review model                                                              | CLI reference download                                                                                             |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| S1. A uploads X. B keeps X and becomes the baseline. 31 days later, all steps until no `hasMore`.    | X: 200. Old Y (replaced by B): 200.                                   | A new pull request against B contains X; its image returns 200.           | 200.                                                                                                               |
| S2. Pull request P uses the older snapshot A. Main moves to B, which replaces all images of A.       | While P is open (31 days): 200. 30 days after P closed: 404.          | P open: all images 200. P closed 30 days: summary, `imagesExpired: true`. | To snapshot A, after it was retired: "The accepted reference is no longer available." This is the designed result. |
| S3. Imported baseline (`baselines/import/`). B keeps the imported image. Later baselines replace it. | 200 at each stage, also when no current baseline names it (STORE-03). | A new pull request against B shows the imported image with 200.           | 200.                                                                                                               |
| S4. Closed run with a stored historical comparison.                                                  | Image kept at 31 days and at 396 days.                                | —                                                                         | —                                                                                                                  |

Result: the deletion paths did not remove a needed image in any scenario. They keep more than the contract describes (STORE-03).

## Findings

### STORE-01 · The real run inventory uses 69.5% of its 16 MiB write limit; at about 5,500 captures each Submit fails

- Kind: bug
- Severity: high. Confidence: high (size), medium (date). Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/capture-inventory.ts:56`: `export const maximumCaptureInventoryBytes = 16 * 1024 * 1024;`. Lines `468-470`: `if (bytes.byteLength > maximumBytes) { throw new Error("Capture inventory exceeds its size limit."); }`. The read path has the same limit (`:530`).
  - `api/workflow-materialize.ts:377-386` puts the full signed manifest into each inventory (`manifest,`), and `:403` writes it.
  - Measurement M1 (real writer, real capture set of run 37342354710: 3,832 captures, 3,613 profiles, 307 tests):

    ```json
    "inventoryBytes": {
      "first full run (every image owned by the run)": 11417201,
      "unchanged run (every image owned by the reference owner)": 11662476,
      "same unchanged inventory before compaction (v1 JSON)": 18222530 },
    "usedPercentOfLimit": 69.5, "bytesPerCapture": 3043,
    "share that is the embedded manifest": 60.2, "gzip": 1446402
    ```

  - 16,777,216 / 3,043 = 5,513 captures (computed from the measured ratio).
  - The review-load lane measured 1,673 bytes for each capture with a fixture that has one profile and one test, and saw the failure at 10,580 captures. The real set has one profile for almost each capture (3,613 for 3,832), so the real ratio is 1.8 times larger.
  - `docs/simplification-audit/contract-issue-1.md:338`: "Plan for approximately **10,580 images per full run**".
- What happens: the inventory is one JSON object that must stay under 16 MiB. With the real Ariakit data it is 11.7 MB today. When the capture count grows by 44%, `writeCaptureInventory` throws inside materialization. `reconcileStagedWorkflows` then retries, records `staged-reconciliation`, and no run of any pull request or of main gets a result.
- Impact: a hard stop for all visual checks at a size that is below the planning number of the contract. The stop comes from normal growth of the test suite in Ariakit, not from a Visonaut change, so nobody is looking at Visonaut when it happens. The capture count is already 3.6 times the 1,058 that the planning text used.
- Recommendation: make the object smaller first, because 60% of it is a second copy of data.
  - The manifest is in the inventory, and the `captures` array repeats its identities. The 3,613 profiles differ mostly by `captureOptions.clip` (lane gap-unexplained-waits counted 54 distinct profiles without the clip in the linux shard, `raw/a1-manifest-stats.json`; the packages lane names the same cause). Moving the clip out of the profile record, or storing profiles as a base plus a clip, removes most of the profile bytes in both the manifest and the inventory.
  - Add a size alert before the limit, in the same place as the write:

    ```ts
    // api/workflow-materialize.ts, after writeCaptureInventory
    if (inventory.bytes > maximumCaptureInventoryBytes * 0.8) {
      await recordEvent(context.database, {
        kind: "inventory-size",
        subject: run.id,
        code: "near-limit",
        now: Date.now(),
      });
    }
    ```

- Alternatives:
  - Minimal: raise the constant. The comment at `capture-inventory.ts:55` says the limit protects a 128 MiB Worker. The second-lens-3 check measured about 16 MB of live objects for 9.4 MB of JSON, so a larger limit needs a memory measurement in a Worker first.
  - Split the inventory into pages (for example 1,000 captures for each object). This removes the limit but changes every reader.
  - Keep the format and make the adapter fail at capture time with a clear message when the planned inventory would pass the limit.
- Maintainer decision needed: yes. Which capture count must the service support (the contract says 10,580), and is a format change acceptable now, while only a few days of inventories exist?

### STORE-02 · One Submit reads and validates the complete reference inventory at least 27 times

- Kind: performance
- Severity: medium. Confidence: high (count), low (production time). Measured: yes (count for each call; the total is computed). Effort: S
- Evidence:
  - `api/local-comparison.ts:45`: `const pageSize = 200;`. Each `POST /v1/runs/:id/reference` page calls `referenceCaptures` (`:432`), which calls `referenceInventory` → `readSnapshotInventory` (`:184`, `:94`). No cache is used on this path.
  - The first page reads three times: `:334` (`referenceCaptures`), `:335` (`referenceInventory`), `:432`.
  - `validateLocalSubmission` reads it again (`:512`) at declare (`api/workflow-owned.ts:546`), at finalize (`api/workflow-owned.ts:1143`), and at materialization (`api/workflow-materialize.ts:273`).
  - `referenceCaptureInputs` reads it at `api/workflow-materialize.ts:275` and again at `:809`.
  - Probe M6 (counting wrapper on the store): `referenceCaptures`, one page → `"inventoryGets": 1`; next page → `1`; `referenceCaptureInputs` → `1`.
  - Total for 3,832 captures: 20 pages → 3 + 19 = 22, plus 3 (validation) plus 2 (inputs) = **27 reads**.
  - Each read downloads the object, hashes it, parses it, checks canonical form, expands it, and validates all profiles (`capture-inventory.ts:488-566`). M1: `readCaptureInventory` of the real-size object takes a median of 396 ms in Node on this machine with an in-memory store. This is not a Worker time.
  - The image route on the same path already has a cache: `api/local-comparison.ts:54-57`, "Retain one verified ID set per bucket, bounded by the inventory's limits."
- What happens: for one run, the Worker downloads about 27 × 11.5 MB ≈ 310 MB from R2 and repeats the same validation of an immutable object 27 times. Twenty of these are in sequential CLI requests.
- Impact: Submit time in CI. `docs/evidence/submit-reuse-local.md:9` records Submit steps of "6m28s to 16m42s". The share of these reads in that time is not measured. The R2 price is not relevant (27 Class B reads).
- Recommendation: keep the sorted reference capture list for the current pointer in the isolate, with the same key rule as `referenceImageMemberships`. The list is small (identity, digests, sizes; no profiles, no manifest).

  ```ts
  // api/local-comparison.ts
  const referenceLists = new WeakMap<
    ApiContext["images"],
    { key: string; captures: LocalReferenceCapture[] }
  >();
  // key = JSON.stringify(header): object key, digest, bytes, count, owner. Paths are added for each run.
  ```

- Alternatives:
  - Minimal: remove the duplicates inside one request (first page 3 → 1; materialization 3 → 1). That gives 23 reads without a cache.
  - Send the complete reference list in one response. The 200-capture page exists to bound a response; 3,832 entries are about 1.2 MB.
  - Write one small "reference list" object beside the inventory at promotion, and read that object for pages.
  - Verify the digest and skip the second validation for an object that the service wrote itself (the same option as REVIEW-04 in `second-lens-2.md`).
- Maintainer decision needed: no.

### STORE-03 · `inherited-by:` pins form a chain, so replaced baseline images and the imported baseline do not expire after 30 days

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/service/src/run-admission.ts:634-641`: `INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason) SELECT value,?,'comparison' FROM json_each(?)` with owner `` `inherited-by:${run.id}` ``.
  - The only release is at the deletion of the borrowing run: `packages/service/src/retention.ts:206-210`, `DELETE FROM work_retention_pins WHERE owner = ? OR owner IN (…)` with `` `inherited-by:${input.id}` ``. `releaseExpiredComparisonReferences` (`retention.ts:20-24`) releases only `comparison:` pins.
  - Probe M3 (scenario S3). Import → B keeps imported X, adds Z → C replaces X, keeps Z → D replaces Z. 31 days after D became the baseline, and after three more passes:

    ```text
    work pins: ["<import> <- inherited-by:run-b (comparison)",
                "run-b <- inherited-by:run-c (comparison)",
                "run-c <- inherited-by:run-d (comparison)",
                "run-c <- promotion:snapshot-D (baseline)", "run-d <- promotion:snapshot-D (baseline)"]
    IMAGES objects: baselines/import/…/images/5956….png, runs/run-b/images/d3b4…, runs/run-c/images/291a…, runs/run-d/images/fe37…
    publicImageImported: 200
    ```

    The inventory of D names only images of C and D. The image of B and the imported image are replaced, their runs closed more than 60 and 90 days ago, and both are still stored and public.

  - Contract: `docs/current-contract.md:50` keeps "the 30-day byte window, owner pins". `docs/simplification-audit/contract-issue-1.md:336`: "Closed, unpinned run images remain available for **30 days**."
- What happens: a main run that owns one image of the current baseline stays pinned. Its `inherited-by:` pins then hold all owners that its own inventory named at that time, also owners whose images are no longer in any baseline. Those owners hold their owners. The chain goes back to the import. A link breaks only when a later run replaces every image of one owner.
- Impact:
  - Each image that was accepted on main stays in R2 and stays public at `/images/<id>` for as long as the chain holds. For a component library where different pull requests change different components, that is the normal case.
  - The bytes are small (an average of 19,236 bytes for each image, M1). The growth depends on how many images change on main each month. That number needs production data.
  - `imagePrefix` for the import (`operations/retention.ts:24-43`) and the test "collects an unpinned imported baseline's images" (`operations/sparse-storage.test.ts:401`) describe a clean-up that the chain prevents in normal use. The test has no later run in its database, and it clears the project baseline by hand (`UPDATE visonaut_projects SET snapshot_id=NULL`).
- Recommendation: release `inherited-by:<run>` with the other reference pins, 30 days after the borrowing run closed. From that time the run is a closed summary, and the contract says a summary does not promise image replay (`docs/current-contract.md:184`). While the run is a baseline, its owners are still held by `promotion:<snapshot>`.

  ```ts
  // packages/service/src/retention.ts, releaseExpiredComparisonReferences, same batch
  statement(database, "DELETE FROM work_retention_pins WHERE owner=? AND reason='comparison'", [
    `inherited-by:${input.runId}`,
  ]),
  ```

- Alternatives:
  - Keep the behavior and write it down: "accepted main images are kept while any retained inventory names their owner". Then the 30-day text in the contract applies only to pull request runs.
  - Keep the pins and add a number to the Service view: bytes held only by `inherited-by:` pins.
- Maintainer decision needed: yes. Is the 30-day window meant for replaced baseline images too, or is "keep all accepted main images" the wanted rule?

### STORE-04 · After a D1 restore, objects written after the restore point have no row, no check finds them, and no step deletes them

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes (local model of a rewind). Effort: M
- Evidence:
  - Probe M7: a real SQLite backup is taken at day 29.5. In the next 24 hours one pull request run and one main run are created and promoted, and retention deletes three images. The database is then replaced by the backup. R2 keeps its content.

    ```text
    rows pointing to deleted objects (before sanitize): runs/run-a0/images/50db…, runs/run-a0/images/a90a…, runs/run-o/images/6673…
    objects with no row: runs/run-m2/images/96bc…, runs/run-m2/inventory/e66f….json,
                         runs/run-p2/images/2f59…, runs/run-p2/inventory/bcbb….json
    inspectRecoveryImages: {"checked":5,"missing":[3 image IDs],"corrupt":[],"calls":1}
    inspectRecoveryInventories: {"checkedInventories":5,"checkedImages":4,"missing":[2 keys of run-a0],"corrupt":[]}
    objectsWithNoRow: all four → "reported": false
    31 days after reactivation: objects with no row → the same four keys
    ```

  - `operations/recovery.ts` reads only `context.images` (`:98`, `:200`, `:220`). It has no `list` call and no `context.quarantine` call. `inspectRecoveryImages` selects `role='original'` (`:91`), so masks are not checked.
  - `sanitizeRestoredDatabase` (`recovery.ts:29-85`) does not change `visonaut_images.bytes_present`, `work_retained_runs`, or accepted snapshots. In the probe, the restored database still listed the old snapshot as a reference candidate, and the CLI reference download for one of its images returned 404.
  - `docs/current-contract.md:244`: "hosted restore remains **UNVERIFIED** and is not a required drill". `operations/README.md:74`: "It does not recreate expired image bytes."
- What happens, for a restore to 24 hours earlier:
  - Rows that point to deleted objects: the images that retention deleted in the window. `inspectRecoveryImages` finds all of them. After reactivation, the ordinary passes delete them again by the same time rule, and D1 is correct again (probe: 3 rows before, 0 after the first pass). For a 24-hour window I found no case where a deletion in the window is not derived again, because each deletion needs a 30-day mark and each release in the window that is not time-based is held by a `comparison:` pin for 30 more days. This is reasoning from the code, plus one probe.
  - Objects with no row: all images, inventories, staged manifests, and plan evidence of runs that were created in the window. No D1 row names their prefix, so `expireRunImages` and `expireStagedAttempts` never list them. They are not public, because the image route needs a D1 row.
- Impact: a permanent, silent remainder in both buckets after each restore. For 24 hours at the measured run rate (M8): about 23 inventories and 23 staged manifests, about 420 MB (estimate), plus the uploaded images. The larger cost is doubt during recovery: the operator cannot prove that the buckets match the database.
- Recommendation: add an "objects with no row" report to the recovery tooling that OPS-15 asks for. It lists `runs/` and `quarantine/staged/` by delimiter and compares the run IDs with `work_retained_runs` and `ingest_staged_runs`. It reports and does not delete.

  ```ts
  // one page: run prefixes in R2 that D1 does not know
  const page = await images.list({ prefix: "runs/", delimiter: "/", cursor });
  const unknown = await database
    .prepare(
      "SELECT value FROM json_each(?) WHERE value NOT IN (SELECT object_prefix FROM work_retained_runs)",
    )
    .bind(JSON.stringify(page.delimitedPrefixes))
    .all();
  ```

  (`ObjectStore.list` in `operations/types.ts:34-39` has no `delimiter` option today.)

- Alternatives:
  - Minimal: write in the runbook that objects of runs created after the bookmark stay in R2, and give the two list commands.
  - An age-based life-cycle rule on `QUARANTINE` (see STORE-05 and STORE-09) removes the staged manifests and plan evidence without code.
  - Add `role='mask'` and the staged objects of live stages to the inspection.
- Maintainer decision needed: yes. Should recovery prove that R2 has no unknown objects, or is "D1 rows are all readable" enough?

### STORE-05 · The `QUARANTINE` bucket no longer holds images; facts and options for the two-bucket rule (S01, D16)

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Writes to `QUARANTINE` in current code are only two: the staged manifest (`api/workflow-evidence.ts:203`) and the plan evidence (`api/workflow-materialize.ts:707`). Search result in M9.
  - Images go to `IMAGES` at upload: `api/workflow-owned.ts:1103`, key `runs/<run>/images/<imageId>` (`api/workflow-evidence.ts:86`). `quarantineKey` (`workflow-evidence.ts:87`) is compared with the ticket (`workflow-owned.ts:1021-1023`) and is never passed to R2.
  - For `local-v1`, the only mode that new runs can use (`workflow-owned.ts:182-187`), the upload checks size and SHA-256 and does not call the validator (`workflow-owned.ts:1066`, `:1090-1106`). The compare lane has this as CMP-01.
  - The gated repository cost test (M6), mode `changed`: `upload → images.put x2`; no `quarantine.put` for an image in any mode.
  - Reads of `QUARANTINE` after a run is sealed: none in production. Sealed-run recovery for inventory runs reads the inventory in `IMAGES` (`api/workflow-materialize.ts:516-537`). `operations/history.ts:537` reads `QUARANTINE`, and has no production caller.
  - Nothing moves from `QUARANTINE` to `IMAGES`. No code copies between the buckets.
  - Private metadata in `IMAGES`: inventories (key map rows 2 and 4), import plan, history archives.
  - Contract: `docs/current-contract.md:134` (S01: "One D1 plus two R2 buckets"), `:59` (D16: "Keep public validated image bytes and private metadata, export files, and quarantine."), `:188` ("separate IMAGES and QUARANTINE R2 buckets"). `docs/simplification-audit/contract-issue-1.md:334`: "never expose a mixed quarantine bucket". `:336`: "Quarantine can use short age-based lifecycle rules; accepted originals cannot expire solely by object age."
  - `docs/evidence/e02-quarantine-boundary.md`: both buckets had no public endpoint on 2026-09-23. The current buckets have new names (`e277a91`), so that record does not cover them.
- What happens: the split that S01 and D16 describe (unchecked bytes in one bucket, validated public bytes in the other) is not what the code does. The real boundary is the D1 row. `QUARANTINE` is a store for two kinds of JSON: one lives about one day, the other has no reader and no deleter.
- Impact: the contract and the bucket names describe a protection that is not there. A person who makes the `IMAGES` bucket public (custom domain or `r2.dev`) because "it holds validated public images" would also publish unvalidated uploads of the last 24 hours and all inventories. Each new storage feature must also decide again which bucket to use, with no rule that matches the code.
- Recommendation: none selected. The task asks for options only. The options are in the next field.
- Alternatives (materially different):
  1. Keep two buckets and change the words. State in the contract that `IMAGES` is a private bucket that the Worker serves through D1, and that `QUARANTINE` holds staged evidence only. Cost: text only. The mixed content of `IMAGES` stays.
  2. Put the rule back in code: upload to `QUARANTINE`, and copy to `IMAGES` at materialization. Cost: one more R2 read and write for each changed image (M6 shows the price of such a copy: 1 `get` and 1 `put`), and a copy step that can fail. Gain: `IMAGES` holds only bytes that a signed Submit admitted.
  3. One bucket with prefixes (the S01 option "one-bucket"). The two staged JSON objects move under a prefix of `IMAGES`. Cost: a binding change in the web Worker and in the deploy check (`.github/workflows/deploy.yml:348-350`), and an audit of each `list` and `delete` prefix. Gain: one binding less, and the names stop promising a split.
  4. Empty `QUARANTINE` without a bucket change: stop writing plan evidence (no reader), and keep the manifest only in the inventory after materialization. The bucket then holds at most one day of manifests. An age-based life-cycle rule (allowed by the saved requirement quoted above) can then be the only deleter.
  5. Split `IMAGES` by privacy instead: public image bytes in one bucket, inventories and other JSON in a private bucket. This matches the words of D16, and it makes a prefix life-cycle rule for inventories possible (STORE-07).
- Maintainer decision needed: yes. Which statement must be true: "unvalidated bytes never enter the image bucket", "private metadata never shares a bucket with public bytes", or neither?

### STORE-06 · The full operations pass and most retention steps have no test on runs with an inventory

- Kind: dx
- Severity: medium. Confidence: medium (the classification is by script, checked by reading the fixtures). Measured: yes. Effort: M
- Evidence:
  - Census M9 (`test-census.mjs`): for each test that calls a retention, promotion, or recovery function, the script checks if the test builds an inventory run (`sparseFixture(`, `writeCaptureInventory(`, `inventory:`, `inventory_key=`, `prepareReset(`, `materializeWorkflowRun(`).

    | Function                                        | Tests | With an inventory run |
    | ----------------------------------------------- | ----- | --------------------- |
    | `runOperations` (the complete pass)             | 6     | 0                     |
    | `expireRunImages`                               | 12    | 3                     |
    | `expireSnapshotImages`                          | 6     | 1                     |
    | `retireSourceBaselines`                         | 2     | 1                     |
    | `expireComparisonReferences`                    | 2     | 0                     |
    | `summarizeClosedRuns`                           | 25    | 3                     |
    | `promoteBaselines`                              | 23    | 8                     |
    | `claimExpiredRun`, `completeRetiredRunDeletion` | 5, 2  | 0                     |
    | `claimRetiredSnapshotDeletion`                  | 2     | 1                     |
    | `expireStagedAttempts`                          | 8     | 6                     |
    | `inspectRecoveryInventories`                    | 3     | 3                     |
    | `inspectRecoveryImages`                         | 3     | 0                     |
    | `sanitizeRestoredDatabase`                      | 21    | 0                     |

  - Tests that run retention on a run with `inventory_key` set: `operations/sparse-storage.test.ts:401` (import, `expireRunImages` and `retireSourceBaselines`), `:612` and `:633` (`expireRunImages` after close), `operations/snapshot-retention.test.ts:35` (`expireSnapshotImages`; it sets `inventory_key` with an `UPDATE` on an old-form snapshot), `packages/service/src/service.test.ts:585` (`retireSnapshot`, `claimRetiredSnapshotDeletion`). Promotion with an inventory: `sparse-storage.test.ts:469`, `:504`, `:527`, `:544`, `:568`, `:597`, `:701`, `:737`.
  - Tests that use only the old form: all of `operations/operations.test.ts`, `core-storage.test.ts`, `promotions.test.ts`, `main-retirement.test.ts`, `recovery.test.ts`, `history.test.ts`, the other five tests of `snapshot-retention.test.ts`, and the retention tests in `packages/service/src/work.test.ts` and `service.test.ts:2994`, `:3228`, `:3272`. They build runs with `captured()` (`operations/test-fixtures.ts:268-287`: `commitShard` with no `inventory`).
  - The sparse fixture is a mix: its baseline is an old-form run (`sparse-storage.test.ts:58`: `captured(fixture.context, "seed", "main")`). The baseline gets an inventory only with `referenceInventory: true` (`:124-162`), and one test sets that flag (`:644`).
  - The production database was replaced on 2026-10-04 and 2026-10-05 and has no run that is 30 days old (lane context). The deletion paths have not run in production on the inventory form.
- What happens: the form that production writes (inventory run against an inventory baseline) reaches the retention code in a few tests of one file. No test runs the ordered list of steps (`operations/index.ts:47-61`) on such data. The cases that this audit had to build were not covered: an image of an earlier run that survives the pass and is then used by a new pull request (S1), the pin chain over three baselines (S3), 25 unsafe candidates (R4a), and a rewind with inventory runs (R7).
- Impact: the first real execution of these paths is in production, about 30 days after the cutover (from 2026-11-03). This audit found no deletion of a needed image, but it found behavior that no test states (STORE-03, STORE-08).
- Recommendation: add one fixture that builds inventory runs against an inventory baseline (the `world.ts` helper in the scratch directory is 500 lines and uses only public service calls), and one test file that runs `runOperations` to quiescence for S1, S2, and S3 with assertions on the public image route. Then move the shared `captured()` fixture, as PKG-10 proposes.
- Alternatives:
  - Minimal: three tests in `sparse-storage.test.ts` for S1, S3, and R4a.
  - Keep the tests and add a production read-only check before 2026-11-03: list the runs that `expireRunImages` would select, and confirm by hand that no live inventory names them.
- Maintainer decision needed: no.

### STORE-07 · No code deletes run inventories: 11.7 MB for each run, about 5 to 8 GB each month, and the key layout prevents a prefix rule

- Kind: cost
- Severity: low. Confidence: high (size and code), medium (rate). Measured: yes (size, run count); the monthly number is an estimate. Effort: S
- Evidence:
  - `operations/retention.ts:22`: `return owner.inventory_key ? `${owner.object_prefix}images/` : owner.object_prefix;` and `:46`: "Keep sparse review inventories after their original images expire." No other `delete` call names an inventory key (M9).
  - Size M1: 11,662,476 bytes for one unchanged run of the real set; 1,446,402 bytes with gzip.
  - Rate M8: 200 `ci.yml` runs in 3.82 days (52.3 each day). In a sample of 60 runs, 25 have a successful `App / Visual Submit` job (pull requests 17 of 50, pushes 8 of 10). Estimate: 160 × 0.34 + 40 × 0.80 = 86 service runs in 3.82 days = 22.6 each day. The last three days alone give about 15 each day.
  - Estimate: 450 to 680 runs each month × 11.66 MB = 5.3 to 7.9 GB each month. After 12 months: 63 to 95 GB.
  - Price (Cloudflare pricing page, read on 2026-10-05, M10): Standard "$0.015 / GB-month", free "10 GB-month / month". Infrequent Access "$0.01 / GB-month", "Data Retrieval: $0.01 / GB", minimum duration "30 days". At 95 GB in Standard: (95 − 10) × 0.015 = 1.27 USD each month (estimate).
  - Each pull request attempt keeps its own complete inventory, also when the run failed, was replaced by a new attempt, or changed nothing.
  - Key layout: inventories are at `runs/<run>/inventory/`, images at `runs/<run>/images/`. A life-cycle rule selects by prefix ("you can specify which prefix you would like it to apply to", Cloudflare object life-cycle page, M10). No prefix selects all inventories and no images.
  - Other classes with no deleter (key map): `plans/workflow/*.json` (545 bytes each run, about 0.4 MB each month), the three import files (one time), `history/` (no production writer).
- What happens: the bucket grows by one 11.7 MB JSON object for each run, without end. The money is small. The count is not: `inspectRecoveryInventories` reads and validates each inventory in one call (`operations/recovery.ts:154-178`), so a restore check after one year is about 5,000 to 8,000 calls and 63 to 95 GB of reads.
- Impact: slow storage growth with no upper limit, a recovery check that grows with it, and no cheap way to add a bucket rule later.
- Recommendation: store the inventory compressed. The measured ratio is 8 to 1. The digest can stay on the canonical JSON. The same change makes each read smaller (27 reads for each Submit in STORE-02, 2 for each review model read).

  ```ts
  // capture-inventory.ts, writeCaptureInventory
  const body = new Blob([encoded]).stream().pipeThrough(new CompressionStream("gzip"));
  await store.put(`${prefix}/inventory/${digest}.json.gz`, body, {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
  });
  ```

- Alternatives:
  - Minimal: keep all inventories and write the decision in the contract with the measured rate.
  - Delete the inventory of a run that never became a baseline, some time after its images expire. The closed view then lists only the changed rows from D1. This reverses the choice in `retention.ts:46`, and the review model must accept a missing inventory.
  - Move inventories to their own prefix (`inventories/<run>/…`) or bucket, then add a rule that moves them to Infrequent Access after 30 days. Reads of old runs then pay the retrieval price.
- Maintainer decision needed: yes. Must the complete list of unchanged items of each closed run stay readable without end?

### STORE-08 · 25 candidates that cannot be deleted stop all later image deletions

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `operations/retention.ts:50-57`: the candidate query has no cursor: `… ORDER BY closed_at,id LIMIT ?` with `budget.tasksPerStep` (25, `apps/web/src/runtime-defaults.ts:20-26`).
  - `operations/retention.ts:65-75`: a candidate with an unsafe prefix gets an alert and `continue`. Its row does not change, so the next pass selects it again.
  - Probe M5 (R4a): 25 closed runs with a changed `object_prefix`, then one normal closed run, all 31 days old. Six cron ticks and three direct calls:

    ```json
    "directCalls": [{ "completed": [], "attentionCount": 25, "hasMore": false }, … same …],
    "states": [{ "byte_state": "live", "runs": 26 }],
    "normalRun": { "id": "run-25", "object_prefix": "runs/run-25/", "byte_state": "live", "summary": "ready" },
    "normalImagesLeft": 1,
    "openEvents": [{ "kind": "retention", "code": "unsafe-prefix", "open": 25 }]
    ```

  - The same shape is in `api/workflow-retention.ts:145-170` (`ORDER BY created_at, id LIMIT ?`, then `unsafe-prefix` and `continue`). I did not probe that one.
  - A candidate whose R2 delete fails each time is also selected again after each lease (`retention.ts:53-54`, `byte_state='deleting' AND deletion_until<=?`).
- What happens: the first 25 rows of the order fill the page in each pass. The step reports `hasMore: false`, so no continuation runs. Later runs are never deleted. The only signal is 25 alerts for the blocked rows; no alert says that other deletions stopped.
- Impact: low probability today. Current code writes only `runs/<uuid>/` (`packages/service/src/run-admission.ts:169`) and the import prefix, and both pass the check. It needs a manual data change, a future prefix form, or 25 objects that R2 cannot delete. When it happens, image storage grows without end and nothing shows the cause.
- Recommendation: do not select rows that already have an open `unsafe-prefix` alert, so that they cannot fill the page.

  ```sql
  AND NOT EXISTS (SELECT 1 FROM operations_events event
    WHERE event.id = 'retention:' || work_retained_runs.id || ':unsafe-prefix' AND event.resolved_at IS NULL)
  ```

- Alternatives:
  - Page by `(closed_at, id)` with a cursor in `operations_cursors`, as the other retention steps do (OPS-20 lists the paging styles).
  - Put the prefix rule in SQL (`object_prefix = 'runs/' || id || '/'` or the import form), so that the query returns only rows that can be claimed.
  - Minimal: when a page has only skipped rows, record one alert `retention:scheduler:blocked`.
- Maintainer decision needed: no.

### STORE-09 · Plan evidence in `QUARANTINE` has no reader and no deleter, and `ingest_manifests.object_key` points to an object that is deleted after one day

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `api/workflow-materialize.ts:687-710`: `storageVersion` is 1 when a bundle has `evidenceVersion` 1, and then `await context.quarantine.put(planObjectKey, JSON.stringify(planEvidence), …)` with key `` `plans/workflow/${jobSetDigest}.json` ``. New declarations always use version 1 (`api/workflow-owned.ts:589`: `… SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ? …`).
  - The key is not under a prefix that a deleter lists: `operations/retention.ts:89-90` (`quarantine/<run>/`, `manifests/<run>/`), `api/workflow-retention.ts:201-204` (`quarantine/staged/<run>/`, `manifests/<run>/`).
  - The only reader of `plan_object_key` is `operations/history.ts:503-537`. Its callers `archiveClosedRuns` and `archiveHistoricalComparisons` have no production caller (M9; OPS-14 lists this code as reachable only from tests).
  - `api/workflow-materialize.ts:445-451` stores the staged manifest key in `ingest_manifests.object_key`. `api/workflow-retention.ts:201` deletes that prefix. `hasReferencedManifest` (`:98-106`) protects only the old `manifests/<run>/%` form.
  - Gated repository test M6, each mode: `materialize-total → … quarantine.put x1 (545 B) …`, then `retire → quarantine.list x4, quarantine.delete x1`. One put is never matched by a delete.
  - The same JSON is in D1: `ingest_run_provenance.verified_json` holds `bundles`, `jobSetDigest`, `workflowSourceDigest` (`workflow-materialize.ts:742-752`).
- What happens: each run leaves one small object in `QUARANTINE` that nothing reads, and one D1 pointer that is wrong after about 24 hours.
- Impact: about 0.4 MB each month (estimate), so no cost. The effect is on trust in the data model: the cutover runbook tells the operator to build a keep list from `SELECT run_id,plan_object_key FROM ingest_run_provenance WHERE storage_version=1` and `SELECT run_id,object_key FROM ingest_manifests WHERE storage_version=1` (`docs/baseline-delta-cutover.md`, section "Measure and select legacy R2 cleanup"). The second query returns keys of deleted objects.
- Recommendation: stop the R2 write and store the D1 form of the key for all new runs (the code has it already: `` `d1:provenance/${staged.id}/${jobSetDigest}` ``). Store `d1:manifest/…` or the inventory key in `ingest_manifests.object_key` for inventory runs, because the inventory holds the manifest.
- Alternatives:
  - Minimal: an age-based life-cycle rule on the `QUARANTINE` bucket (for example 7 days). No production reader needs an object there after the 24-hour stage window plus the 6-hour lease. `docs/simplification-audit/contract-issue-1.md:336` allows this: "Quarantine can use short age-based lifecycle rules".
  - Keep both, and add the prefix `plans/workflow/` to a deleter with the run.
- Maintainer decision needed: no.

### STORE-10 · On the sparse path the reuse endpoint handles only changed images; an unchanged run costs no image operation

- Kind: simplification
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Unchanged captures are not in the upload set: `packages/protocol/src/validate.ts:477`: `if (!manifest.localComparison || result?.outcome !== "unchanged") add(capture.image);`. The declare step stages only that set (`api/workflow-owned.ts:547-548`). The CLI marks a capture unchanged without a download when the digests are equal (`packages/cli/src/local-comparison.ts:261-268`).
  - Gated repository test M6, one capture. Mode `unchanged`: `upload → -`, no reuse phase, and one `images.put` (the inventory). Mode `reuse-hit`: `reuse → images.get x1 (94 B), images.put x1 (94 B)`.
  - R2 operations for one unchanged full run of the real set, without retries (counts by code and M6; sizes from M1): `QUARANTINE` 2 puts (7.0 MB manifest, 545 bytes plan), 4 gets (21 MB), and later 4 lists and 1 delete. `IMAGES` 1 put (inventory, 11.7 MB), 1 list, 27 gets of the reference inventory (STORE-02), **0 image puts, 0 image gets, 0 reuse copies**.
  - A reuse source must be a staged image of another submitted run of the same repository with `retention_state = 'live'` (`workflow-owned.ts:880-899`). Staged rows are deleted after 24 hours plus the lease, so a source is at most about 30 hours old.
  - Is the byte copy necessary? With the current rules, yes. A changed capture must be owned by its run: `packages/service/src/run-admission.ts:553` accepts another owner only for `outcome='unchanged'`. `capture-inventory.ts:128-133` requires the key under `runs/<image.runId>/`. Promotion verifies only the images of the run itself (`operations/promotions.ts:52-55`). A pointer to the source is possible in principle only when the source run is materialized and `live`, so that it can be pinned. A staged source can belong to a run that was never materialized and has no `work_retained_runs` row.
  - `docs/evidence/submit-reuse-local.md:3`: the recorded benefit ("67 distinct PNG originals … 71 HTTP requests … 8 requests") is from the time when all originals were uploaded.
- What happens: reuse now applies only when a run uploads a changed image or mask whose bytes were uploaded in the last day by another run. The probable case is the main run after a merge, or a second Submit of the same commit. For each hit the Worker reads the object into memory and writes it again. The CLI and the server keep a challenge and proof protocol for this (`reuseStagedImages` is about 200 lines, `workflow-owned.ts:806-1003`, plus the CLI part in `packages/cli/src/engine.ts:495-560`).
- Impact: no cost problem. One hit is 1 Class B read and 1 Class A write. The question is code size against a small saving: without reuse, a run uploads its changed images again (some tens of small files).
- Recommendation: measure before a change. Log `reused` and `uploaded` counts for each Submit for two weeks (the CLI already has `reusedImages`, `engine.ts:449`). If hits are rare, remove the endpoint and the proof protocol.
- Alternatives:
  - Keep it as it is. It is tested (`api/workflow-owned.test.ts:577-829`) and it works.
  - Replace the copy with a pointer for sources that are materialized and `live`: allow a changed capture to name another owner, and pin it with `inherited-by:`. This removes the copy and adds one more ownership case to `commitShard`, promotion, and recovery.
- Maintainer decision needed: yes. Keep the reuse protocol, or remove it after a measurement?

### STORE-11 · A closed summary hides images that still exist, and the "expired" flag looks only at the run's own bytes

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `api/review.ts:589-591`: `...(archive ? { evidenceState: "summary" as const, imagesExpired: retained?.byte_state !== "live" } : {})`. `archive` exists when `run.detail_archived` is set (`:242`). `summarizeClosedRuns` sets it 30 days after close for each run, also for the current baseline.
  - `review/review-workspace.tsx:298`: `variant: model.evidenceState === "summary" ? undefined : variant`. Lines `805-813` show "Closed review summary" or "Image history expired", and in both cases "This view does not contain image bytes."
  - Probe M2 (S1), the current baseline 31 days after promotion: `"evidenceState":"summary","imagesExpired":false`, and all four image URLs of the model return 200.
  - Probe M4 (S2), the current baseline after its reference owner was deleted: `"imagesExpired":false`, both reference images return 404, both candidate images return 200.
  - `api/review-inventory.ts:39`: `bytes_present: 1,` for each inventory image, without a check.
  - The ui-copy lane proposes this text for the box: "The images for this run are deleted. The decisions remain." (`ui-copy/report.md:1051`). For `imagesExpired: false` that text is false.
- What happens: 30 days after a run closes, its page shows no image, also when all images are stored and public. For the current baseline that is 30 days after promotion. The model still carries each image URL, and the server reads two inventories to build it. `imagesExpired` is true only when the run's own prefix is deleted. It says nothing about reference images or unchanged images of other owners.
- Impact: a maintainer who opens the baseline run to see what the baseline looks like gets a text box. The flag name suggests a meaning that it does not have, and one UI text proposal already depends on that meaning.
- Recommendation: show the images of a summary when `imagesExpired` is false, and let the image element show "not stored" when the URL returns 404.
- Alternatives:
  - Minimal: keep the box and make the paragraph depend on the flag ("Images are stored but this closed view does not show them" or "The images of this run are deleted").
  - Remove the image fields from the summary model, so that the model matches what the view shows. This also makes the model smaller.
  - Compute the flag for each image from the owner's `byte_state`.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

Scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-storage-lifecycle/` (called `S/` below). All probes run with:

```sh
pnpm exec vitest run --config S/vitest.probe.config.mjs <probe name>
```

The config has `root` = repository and `cacheDir` in scratch. `git status --short` after the last probe: `M pnpm-lock.yaml` and `?? apps/lab/`, both from another lane.

Limits that apply to all probes: the database is `node:sqlite` with all migrations (`operations/test-fixtures.ts`, `TestDatabase`), not D1. R2 is the in-memory `MemoryStore`. The clock is the fixture clock. Runs are built with the public service calls (`reserveRun`, `registerImage`, `writeCaptureInventory`, `commitShard`, `sealRun`, `createComparison`, `review`, `promoteBaselines`) in the same order as `materializeBundle`, not through HTTP (`S/probe/world.ts`). The operations budget is the production default (25 tasks, 1,000 objects, 720,000 ms lease). "Drain" means: call `runOperations(context, { kind: "recovery" })` until no step reports `hasMore`.

- **M1. Inventory size with the real capture set.** Probe `inv-size`. Input: the combined manifest of the public Ariakit artifacts of workflow run 37342354710 (3,832 captures; lane gap-unexplained-waits made it with the real `combineBundles`). The probe builds the capture facts as `api/workflow-materialize.ts:298-386` does and calls the real `writeCaptureInventory` and `readCaptureInventory`. Raw result `S/results/inventory-size.json`:

  ```json
  {
    "captures": 3832,
    "profiles": 3613,
    "tests": 307,
    "distinctImages": 3695,
    "distinctImageBytes": 71075268,
    "averageImageBytes": 19236,
    "manifestEvidenceBytes": {
      "canonical manifest with receipt (the QUARANTINE object)": 7017547,
      "canonical manifest without receipt": 5639995
    },
    "inventoryBytes": {
      "first full run": 11417201,
      "unchanged run": 11662476,
      "same unchanged inventory before compaction (v1 JSON)": 18222530
    },
    "unchangedInventoryCompressedBytes": {
      "gzip": 1446402,
      "share that is the embedded manifest": 60.2
    },
    "usedPercentOfLimit": 69.5,
    "bytesPerCapture": 3043,
    "readCaptureInventoryMs": { "runs": [392, 373, 396, 399, 446], "median": 396 }
  }
  ```

  Image file sizes of the same set: 3,695 files, min 265, p50 12,201, p90 28,705, max 210,405 bytes. Limits: the local receipt is synthetic (all captures "changed" for the first run, all "unchanged" for the second). The image owner IDs are synthetic UUIDs. The read time is Node on this machine, not a Worker.

- **M2. Scenario S1 (main chain).** Probe `s1-main-chain`, raw result `S/results/s1-main-chain.json`. After 31 days, 3 passes, then 1 more pass 13 minutes later:

  ```text
  AFTER pins: run-a <- inherited-by:run-b (comparison); run-a <- promotion:snapshot-573b… (baseline); run-b <- promotion:snapshot-573b… (baseline)
  AFTER objects: runs/run-a/images/15df…, runs/run-a/images/70b3…, runs/run-a/inventory/b79d….json, runs/run-b/images/e17b…, runs/run-b/inventory/79dc….json
  public X 200, oldY 200, newY 200
  newPR: built true, xInInventory "runs/run-a/images/15df…", review variants: x unchanged 200/200, y unchanged 200/200, z added 200
  cli: {"status":200}
  ```

- **M3. Scenario S3 (imported baseline).** Probe `s3-imported-baseline`, raw result `S/results/s3-imported-baseline.json`. The import uses the real `prepareReset`, `copyResetPage`, and `activateReset`. The final stage is quoted in STORE-03. The passes at +13, +26, and +39 minutes after the last 31-day step report no work (`[{}]`).

- **M4. Scenarios S2 and S4.** Probes `s2-old-reference` and `s4-historical`, raw results `S/results/s2-old-reference.json`, `S/results/s4-historical.json`.
  - S2, pull request open for 31 days: `source-retention … "deferred":["snapshot-d702…"]`, all three images 200, CLI reference 200. On the day the run closes: snapshot A retired, images still 200, CLI reference to A: `IncompleteError: The accepted reference is no longer available.` 31 days after close: `retention completed ["run-p"]`, then `["run-a"]` in the pass 13 minutes later (the candidate list of the first pass was read before the pins of P were released); all three images 404; only the three inventories and the images of B remain.
  - S4, a stored historical comparison (seeded with `tooling/legacy-comparison-fixture.ts`, because no production code creates one): at 31 and at 396 days, `reference-retention … "deferred":["closed"]`, pin `closed <- historical:native-history (manual)`, image kept. The release is in `compactHistoricalComparison` (`packages/service/src/historical.ts:271`), which has no production caller.

- **M5. Partial failure (R4).** Probe `r4-windows`, raw results `S/results/r4a-unsafe-prefix.json`, `r4b-interrupted-delete.json`, `r4c-orphan-inventory.json`.
  - R4a is quoted in STORE-08.
  - R4b (the first `delete` call removes one of three objects and throws):

    ```text
    after the failing pass:  row {"byte_state":"deleting","has_token":1,"deletion_until":…}, leaseRemainingMs 720000, imagesInR2 2, bytesPresentRows 3, review imagesExpired true, image statuses [200,200,404], openEvents ["retention:run-p:delete-failed"]
    next pass, same time:    no retention work
    after 5 minutes:         same row, leaseRemainingMs 420000
    13 minutes after:        row {"byte_state":"deleted","has_token":1,"deletion_until":null}, imagesInR2 0, bytesPresentRows 0, statuses [404,404,404], openEvents []
    ```

  - R4c (inventory object written, D1 commit never done, run expired by `expireIncompleteWorkflowRun`): before `["runs/run-orphan/images/uploaded","runs/run-orphan/inventory/c1e6….json"]`, `inventory_key: null`; 31 days later `retention completed ["run-orphan"]`, `byte_state: "deleted"`, `objects: []`.

- **M6. R2 operations of one run (R5).**
  - The repository's gated cost test, with the report path in scratch: `VISONAUT_UPLOAD_COST_REPORT=S/results/upload-costs.jsonl pnpm exec vitest run --config S/vitest.repo-test.config.mjs -t "records one-capture native costs"` → 6 passed, 109 skipped. It uses Miniflare D1 and R2 and the counting store in `api/test-upload-costs.ts`. One capture for each mode:

    ```text
    unchanged   declare: quarantine.get x2, quarantine.put x1 (2799 B) | upload: - | finalize: quarantine.get x1
                materialize-total: quarantine.get x1, quarantine.put x1 (545 B), images.list x1, images.put x1 (4170 B)
                review: images.get x1 | retire: quarantine.list x4, quarantine.delete x1
    changed     upload: images.put x2 (457 B)   (image and mask; no quarantine.put for an image)
    reuse-hit   reuse: images.get x1 (94 B), images.put x1 (94 B) | upload: -
    reuse-miss  reuse: - | upload: images.put x1 (94 B)
    ```

    Limit: the reference baseline of this test is in the old form, so reads of a reference inventory do not appear.

  - Probe `r5-reference-reads` (counting wrapper on `MemoryStore.get`), raw result `S/results/r5-reference-reads.json`: `referenceCaptures` one page → 1 inventory get; next page → 1; `referenceCaptureInputs` → 1; reference image download, first in the isolate → 1 inventory get and 1 image get; second → 0 and 1. The total of 27 in STORE-02 is these counts times the call sites in the code. It was not run end to end.

- **M7. Restore (R7).** Probe `r7-restore`, raw result `S/results/r7-restore.json`. The restore point is a real SQLite backup (`node:sqlite` `backup`), as in `operations/recovery.test.ts:417`. The key lines are quoted in STORE-04. Two more observations:
  - After `sanitizeRestoredDatabase`, the first ordinary pass repeated the deletions of the window: `retention completed ["run-a0","run-o"]`, then `rows pointing to deleted objects: []`.
  - After `sanitizeRestoredDatabase`, the `checks` step reported `hasMore: true` with `attention: ["1","1"]` in each of 100 passes, at +13 minutes and at +31 days. This is the loop of OPS-02; `recovery.ts:47` sets `ambiguous=1` on each check.
  - Limits: one rewind of 24 hours on a small data set. D1 Time Travel itself was not used.

- **M8. Run rate.** `gh run list --repo ariakit/ariakit --workflow ci.yml --limit 200 --json createdAt,event,conclusion,databaseId,headBranch` (1 API call), raw result `S/ci-runs.json`:

  ```text
  runs 200, first 2026-10-02T01:06:05Z, last 2026-10-05T20:53:06Z, span 3.82 days, 52.3 runs/day
  events {"pull_request":160,"push":40}; conclusions {"success":115,"cancelled":45,"failure":36,"startup_failure":1,"(none)":3}
  2026-10-02: 95 (16 push, 79 PR) | 10-03: 35 (6, 29) | 10-04: 39 (9, 30) | 10-05: 31 (9, 22)
  ```

  `node S/sample-jobs.mjs` reads the jobs of each third run (60 API calls), raw result `S/ci-jobs-sample.json`: `{"sampled":60,"submitSuccess":25,"byEvent":{"pull_request":{"sampled":50,"submitSuccess":17,"submitAny":30},"push":{"sampled":10,"submitSuccess":8,"submitAny":9}}}`. Limits: four days, one of them with 95 runs. Job re-runs make more attempts than runs, and each attempt is a new service run; they are not counted. GitHub calls used by this lane: 61.

- **M9. Searches and the test census.**
  - `rg -n "\.(put|delete|list|head|get)\(" apps/web/src` filtered to `images`, `quarantine`, `store`, tests excluded: the call sites in the key map. `quarantine.put` appears only at `api/workflow-evidence.ts:203` and `api/workflow-materialize.ts:707`.
  - `rg -n "archiveClosedRuns\(|archiveHistoricalComparisons\(|writeHistoryStep\("` in `apps` and `packages`, tests excluded: only the definitions and the calls inside `operations/history.ts` and `operations/history-supplement.ts`.
  - `rg -n -i "lifecycle|life-cycle|versioning|object lock|bucket lock|retention polic|r2 bucket"` in the repository without `node_modules`, `dist`, the lock file, and the old audit HTML: no R2 bucket setting. The hits are unrelated (container life cycle, package versioning, App life-cycle webhooks). `apps/web/wrangler.jsonc:75-84` and `.github/workflows/deploy.yml:348-350` name only bucket and binding.
  - `node S/test-census.mjs` → `S/results/test-census.json`: the table in STORE-06 and one line for each test (file, line, functions, form). Limit: the form is detected by text markers in the test body; I checked the operations fixtures by reading.

- **M10. Cloudflare documentation, read on 2026-10-05 through the fetch tool (a summary model returns the quotes).**
  - `https://developers.cloudflare.com/r2/pricing/`: Standard "$0.015 / GB-month", Class A "$4.50 / million requests", Class B "$0.36 / million requests". Infrequent Access "$0.01 / GB-month", "$9.00", "$0.90", "Data Retrieval: $0.01 / GB", minimum "30 days". Free (Standard only): "10 GB-month / month", "1 million", "10 million". Free operations: "DeleteObject, DeleteBucket and AbortMultipartUpload". "Cloudflare rounds up your usage to the next billing unit."
  - `https://developers.cloudflare.com/r2/buckets/object-lifecycles/`: rules can "delete objects after 90 days", "transition objects to Infrequent Access storage after 30 days", and abort multipart uploads; "you can specify which prefix you would like it to apply to"; Wrangler `r2 bucket lifecycle add/set/list/remove`; "Buckets have a default lifecycle rule to expire multipart uploads seven days after initiation."; "Objects will typically be removed from a bucket within 24 hours". The page does not mention object versioning.

## Open questions and items not verified

1. **Live bucket settings.** I could not read them. Unknown for `visonaut-images` and `visonaut-quarantine`: life-cycle rules, default storage class, public access (custom domain, `r2.dev`), bucket locks. The buckets got new names on 2026-10-05 (`e277a91`), so the public-access record of 2026-09-23 (`docs/evidence/e02-quarantine-boundary.md`) does not cover them. One read-only command for each bucket answers the first point: `wrangler r2 bucket lifecycle list <bucket>`.
2. **The earlier buckets.** `e277a91` changed `visonaut-production-images` and `visonaut-production-quarantine` to the new names. I did not verify how the objects moved, or if the earlier buckets still exist with a full copy. The cutover runbook says to keep old objects until the operator ends the rollback hold. If they exist, they are the largest unowned storage of the project.
3. **Production counts.** Not known: the number and bytes of inventories, the number of image-owning main runs, and how many images change on main each month. The last number decides how much STORE-03 keeps. A list of `runs/` with sizes, or two D1 counts, gives the answer.
4. **Old-form rows in the new database.** I assume that it has no snapshot with `storage_mode='protected'`, no historical comparison, and no row in `operations_run_archives`, because the cutover copied no old run. If one historical comparison exists, its `manual` pin is never released (M4, S4).
5. **Worker cost of an inventory read.** The 396 ms is Node on a laptop. The CPU time and memory of `readCaptureInventory` for an 11.7 MB object in a Worker are not measured. One trace of one `POST /v1/runs/:id/reference` shows it, and also shows the share of STORE-02 in the Submit time.
6. **The total of 27 reads** is a count of call sites times a measured count for each call. I did not run one complete Submit with an inventory baseline and the real set.
7. **Run rate.** Four days of data, without job re-runs. The monthly numbers are estimates with a range of about 450 to 680 runs.
8. **Restore windows longer than 24 hours.** My reasoning that each deletion in the window is derived again after the rewind holds for 24 hours. I did not analyze a rewind of several days, where pin releases and promotions inside the window can combine.
9. **Real R2 behavior.** `MemoryStore` deletes all keys of one call or none (unless the probe injects a failure). I did not verify the batch size limit and the partial-failure behavior of a real R2 `delete` with 1,000 keys.
10. **R2 object versioning and bucket locks.** The life-cycle page does not mention versioning. I did not read other product pages, so I make no statement about what R2 offers to recover a deleted object.
11. **Overlap with other lanes.** STORE-01 extends a number of the review-load lane (failure at 10,580 captures with a small fixture). STORE-02 is on the Submit path that lane gap-unexplained-waits also studies; its report was not complete when I wrote this. STORE-06 extends PKG-10. STORE-04 extends OPS-15. STORE-09 touches OPS-13 and OPS-14.
