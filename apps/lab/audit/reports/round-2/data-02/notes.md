# Lane data-02: research record for D-DATA-02 (format of the run inventory)

Date: 2026-10-06. Repository commit: `f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90`. The repository was read only. All files of this lane are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/data-02/`.

Loaded skills: `ariakit-general-workflow`, `ariakit-general-code-style`, `ariakit-ariakit-api-design`. The remote is `https://github.com/ariakit/visonaut.git`.

> **Read the section "Independent check" at the end first.** A second agent checked this record on 2026-10-06. It confirmed the measurements and corrected 6 claims. The corrected claims are marked "[corrected]" below.

## Result in four sentences

1. The inventory is large because it says each fact 2 to 6 times. With each fact stored one time ("one row for each capture") the same production-shaped inventory has 1,583,117 bytes in place of 12,154,546, and no fact is lost (measured with a prototype). [corrected] This is true for an inventory with a manifest. For an inventory with no manifest the prototype loses the profile list (check C2).
2. No D1 statement depends on the format. Each option writes the same D1 rows as today.
3. The stop at about 6,000 captures is not in the inventory. CLI 0.5.4 refuses a manifest file above 8 MiB (about 5,700 captures). A new inventory format alone moves the first stop from about 5,260 to about 5,700.
4. So the recommendation is the rows from the CLI to storage. Its service part is the same as the service-only option and can ship first.

## Facts from the code

| Fact                                                                                                                                                                                      | Source                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The limit is `maximumCaptureInventoryBytes = 16 * 1024 * 1024`. Its comment: "Leave room for the decoded JSON and capture graph in a 128 MiB Worker."                                     | `apps/web/src/capture-inventory.ts:55-56`                                                                                                                    |
| The write encodes the compact form, then throws "Capture inventory exceeds its size limit." above the limit.                                                                              | `capture-inventory.ts:466-470`                                                                                                                               |
| The read refuses a pointer with more bytes than the limit, and a body that is longer than the pointer says.                                                                               | `capture-inventory.ts:499-502`, `:530`                                                                                                                       |
| One read = full body, SHA-256, `JSON.parse`, canonical check, expand (with `parseManifest`), full validation.                                                                             | `capture-inventory.ts:488-518`, `:552-553`, `:363-394`, `:396-450`                                                                                           |
| The stored form today is `baseline-delta-v2`: capture records with `metadataEncoding: "manifest-v1"`, plus the complete manifest. The reader fills the capture details from the manifest. | `capture-inventory.ts:285-394` (pull request #249)                                                                                                           |
| One writer: materialization.                                                                                                                                                              | `apps/web/src/api/workflow-materialize.ts:403`                                                                                                               |
| The baseline import tool is a second caller of the writer. Its inventory has no manifest.                                                                                                 | `apps/web/tooling/baseline-reset/reset.ts:380-450`                                                                                                           |
| Reader 1, review: run inventory and baseline inventory, one after the other.                                                                                                              | `apps/web/src/api/review-inventory.ts:43-48`, `review.ts:364`                                                                                                |
| Reader 2, reference pages and Submit validation.                                                                                                                                          | `apps/web/src/api/local-comparison.ts:60-77`, `:94`, `:186-206`, `:512`                                                                                      |
| Reader 3, materialization (retry check, sealed retry, reference inputs).                                                                                                                  | `workflow-materialize.ts:273`, `:275`, `:389`, `:517`, `:809`                                                                                                |
| Reader 4, promotion.                                                                                                                                                                      | `apps/web/src/operations/promotions.ts:304`                                                                                                                  |
| Reader 5, recovery check. It reads each run and snapshot with an inventory key, one in each step. A read that throws marks the object corrupt or missing.                                 | `apps/web/src/operations/recovery.ts:140-215`                                                                                                                |
| Reader 6, history export. It needs the stored document as it is.                                                                                                                          | `apps/web/src/operations/history.ts:530`                                                                                                                     |
| D1 gets the pointer in one `UPDATE visonaut_runs SET inventory_key=?,inventory_digest=?,inventory_bytes=?,capture_count=?,...`.                                                           | `packages/service/src/run-admission.ts:644`                                                                                                                  |
| The snapshot row gets the same four values in its `INSERT`.                                                                                                                               | `packages/service/src/baseline-promotion.ts:154`                                                                                                             |
| CLI: `MAX_MANIFEST_BYTES = 8 * 1024 * 1024`, used by `loadCapture` for each shard manifest and for the combined manifest.                                                                 | `packages/cli/src/files.ts:9`, `:46`; `engine.ts:778`; `bundles.ts:43`                                                                                       |
| CLI: `maximumMetadataBytes = 8 * 1024 * 1024` for `manifest.json` in a downloaded artifact.                                                                                               | `packages/cli/src/artifact-archive.ts:10`, `:100`                                                                                                            |
| CLI places that write, send, or read the combined manifest: 4.                                                                                                                            | `bundles.ts:126`, `signed-context.ts:118`, `engine.ts:463`, `files.ts:47`                                                                                    |
| The capture adapter writes each shard manifest with an indent of 2 (`JSON.stringify(manifest, null, 2)`). The combined manifest of the CLI has no indent.                                 | `packages/playwright/src/reporter.ts:254`, `packages/cli/src/bundles.ts:126`                                                                                 |
| Service: `maximumManifestBytes: 16 * 1024 * 1024` for the manifest request, `maximumCaptures: 40_000`. Production uses the defaults (`VISONAUT_API_LIMITS` is `{}`).                      | `apps/web/src/runtime-defaults.ts:12`, `:14`; `apps/web/wrangler.jsonc` (production vars); `workflow-owned.ts:487-489`, `:560`                               |
| Protocol: `list(profiles, "profiles", 1, 10_000)`. The CLI and the service use the same validator.                                                                                        | `packages/protocol/src/validate.ts:273`                                                                                                                      |
| "Unknown optional fields survive parsing and contribute to the payload digest." So a packed form must keep unknown fields.                                                                | `packages/protocol/src/validate.ts:385-390`                                                                                                                  |
| The rendering digest is the digest of the profile without two old comparison fields. The environment digest is the digest without the clip.                                               | `packages/protocol/src/hash.ts:81-103`                                                                                                                       |
| The staged manifest object is deleted by retention (`quarantine/staged/<run>/`). So the embedded manifest is the durable copy.                                                            | `apps/web/src/api/workflow-retention.ts:201`, `workflow-owned.ts:582-583`                                                                                    |
| The consumer pins the CLI in 2 workflow lines and one package digest. The service pins the workflow file and the package digest.                                                          | audit copy of `ariakit/ariakit` `app.yml:11`, `:252`, `ci.yml:70`; `apps/web/wrangler.jsonc` (`VISONAUT_WORKFLOW_OWNED`, `VISONAUT_TRUSTED_EXECUTOR_DIGEST`) |

## Facts from documents

| Fact                                                                                                                                                                                                                                                                                               | Source                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "New storage uses one complete, immutable R2 inventory per run. ... Review reads the full inventory to show unchanged items. ... The inventory is flat, so reading a baseline does not follow older baseline chains."                                                                              | `docs/current-contract.md:26`                                                                                             |
| "Plan for approximately 10,580 images per full run, roughly 10× the measured count".                                                                                                                                                                                                               | `docs/simplification-audit/contract-issue-1.md:340`                                                                       |
| "D43 comparator thresholds and D54 numeric budgets await measurements and later approval".                                                                                                                                                                                                         | `docs/design-verification.md:82`                                                                                          |
| Pull request #247 (merged 2026-10-04T21:06:31Z): inventory in R2, changed items in D1. "The complete inventory is bounded at 16 MiB. ... This is document-size and behavior evidence, not a measured Worker heap limit." Its probe: 1,866 to 66 rows written for 100 unchanged items.              | `gh pr view 247` (read 2026-10-06)                                                                                        |
| Pull request #249 (merged 2026-10-04T22:45:55Z): the first submission had 18.8 MB, above 16 MiB. The compact form stores 12,222,666 bytes in production.                                                                                                                                           | `gh pr view 249` (read 2026-10-06)                                                                                        |
| Recorded D1 cost probe: sparse mode, 100 captures, 0 changed: 66 rows written (commitShard 4, sealRun 8, createComparison 15, finalizeComparison 9, preparePromotion 10, recordInventoryVerification 1, promote 19). With 1 changed capture and its approval: 90. Dense mode, 100 captures: 1,866. | `apps/web/tooling/baseline-delta-cost/recorded/summary.json`, read with `probe/d1-cost.mjs`. The probe was not run again. |
| 3 statements of the 66 write an inventory fact: the pointer update of the run (1 row), the snapshot insert (6 rows with its indexes), and `inventory_verified=1` (1 row).                                                                                                                          | `recorded/statements.json.gz`, read with `probe/d1-cost.mjs`                                                              |
| Workers: "Each isolate can consume up to 128 MB of memory". Request body: 100 MB (Free and Pro). Subrequests on Workers Paid: 10,000. R2 calls count as subrequests.                                                                                                                               | https://developers.cloudflare.com/workers/platform/limits/ (read 2026-10-06)                                              |
| R2: 5 TiB for each object, 5 GiB for a single-part upload, 1,024 bytes for a key.                                                                                                                                                                                                                  | https://developers.cloudflare.com/r2/platform/limits/ (read 2026-10-06)                                                   |
| D1 on Workers Paid: rows written "First 50 million / month included + $1.00 / million rows". A write to an indexed table counts one more row for each index.                                                                                                                                       | https://developers.cloudflare.com/d1/platform/pricing/ (read 2026-10-06)                                                  |

## Facts from the audit that this lane used and did not measure again

- Production inventory: 12,222,666 bytes, 72.9% of the limit (pull request #249, findings STORE-01).
- 5,250 captures stored at 99.6%, 5,326 throw, with the real writer (WAIT-05). This lane measured 16,720,720 bytes (99.7%) at 5,260 scaled captures, which agrees.
- 27 reads of the baseline inventory in one Submit: first page 3, pages 2 to 20 one each, declare 1, finalize 1, materialization 3 (STORE-02, API-08).
- One review read holds 45.0 MiB at its largest point in local workerd. workerd holds parsed objects in 15 to 21% fewer bytes than Node (WAIT-06).
- R2 `put` refused a stream of unknown length in local workerd, and the `sha256` option checks the stored bytes (STORE-07, WAIT-02).
- The capture count grew from 3,582 to 3,832 in 13 days (second lens of STORE-01).
- The failure above the limit: retries each hour for 24 hours, no final check state, one active-run place held (WAIT-05, second lens ran it).

## Data of the experiments

- `data/run-inventory.json`: copy of `tmp/audit/gap-unexplained-waits/fixture-x1/objects/10.bin`. The audit built it with the real combined manifest of Ariakit CI run 37342354710 (3,832 captures, 3,613 profiles) and the real writer. Invented in it: the comparison results (4 changed captures), the image IDs, and the baseline run.
- `data/manifest.json`: the real combined manifest, 5,639,996 bytes.
- Machine: Node v24.18.0, darwin arm64 (Apple M4 Pro, from the audit). In-memory store. Not a Worker.
- Run all probes: `pnpm exec vitest run --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/data-02/probe/vitest.config.mjs` from the repository root. The cache and all outputs stay in the lane folder.

## Experiments

### E1. Does the copy of the writer give the stored bytes?

- File: `probe/shapes.ts` (`todayDocument`), checked in `probe/measure.probe.ts`.
- Why: the real writer refuses more than 16 MiB, so the sizes of today at 10,580 and 20,000 captures need a copy of `compactInventory`.
- Expected: 12,154,546 bytes and the same SHA-256 as the stored object.
- Observed: the same bytes and the same digest. The copy is correct for this data.

### E2. How small is the inventory with each fact one time?

- Files: `probe/pack.ts` (`packInventory`, `unpackInventory`), `probe/measure.probe.ts`. Results: `results/measure.json`, `results/rows-3832.json`.
- Form: a header, shared lists (tests, variants, rendering profiles without the clip, environment digests, comparison settings, image owners), and one row of 17 columns for each capture. Column 17 keeps each fact that no other column gives back.
- Expected before the run: about 385 bytes for each capture (three digests and one image ID of 64 characters are 264 bytes of it).
- Observed at 3,832 captures: 1,583,117 bytes, 413 bytes for each capture (shared lists 151,721 bytes). gzip: 649,673 bytes.
- Observed parts: tests 82,844; variants 15,819 (66); profiles 45,568 (81); environment digests 5,428; owners 271 (2); manifest header 1,164. Columns: item 156,756; profile digest 256,744; image digest 256,744; capture ID 256,744; kept image 271,960; clip 69,260.
- Other encodings of the same facts: the column name in each row 2,058,176 bytes; one list for each column 1,575,637 bytes. So lists for each column give 0.5% and cost readability. Named rows cost 30%.

### E3. Is a fact lost?

- Expected: `canonicalJson(unpackInventory(packInventory(x)))` equals `canonicalJson(x)`, and the manifest has the same `digestJson`.
- Observed: equal at 3,832 captures (the real reader gave `x`), and equal for the scaled inventories of 5,260, 10,580, and 20,000 captures. 40,000 was not compared (size only).
- 4 of 3,832 rows use the last column: the 4 changed captures, whose stored metadata has a mask image ID.
- Limit: an inventory with no manifest (the imported baseline) was not run. [corrected] The check ran it: the round trip fails on the field `profiles` (the prototype returns an empty list), and the rows have 6,754,138 bytes (1,763 for each capture). See C2.

### E4. Sizes at other capture counts

- Method: `scaleInventory` repeats the real inventory. Each copy gets new item names, test IDs, image digests, image IDs, and a moved clip (so a new profile digest). Profiles for each capture stay at 0.944, as in the real data.

| Captures | Profiles | Today, bytes | Share of 16 MiB | Today, gzip | Rows, bytes | Share | Rows, gzip | Manifest file | Manifest request | Request as rows |
| -------: | -------: | -----------: | --------------: | ----------: | ----------: | ----: | ---------: | ------------: | ---------------: | --------------: |
|    3,832 |    3,613 |   12,154,546 |           72.4% |   1,506,911 |   1,583,117 |  9.4% |    649,673 |     5,639,995 |        7,018,634 |       1,043,178 |
|    5,260 |    4,967 |   16,720,720 |           99.7% |   2,072,399 |   2,152,801 | 12.8% |    891,928 |     7,766,653 |        9,662,821 |       1,414,407 |
|   10,580 |    9,993 |   33,686,792 |          200.8% |   4,154,728 |   4,278,616 | 25.5% |  1,780,143 |    15,637,594 |       19,464,209 |       2,797,947 |
|   20,000 |   18,882 |   63,741,778 |          379.9% |   7,856,087 |   8,048,045 | 48.0% |  3,362,505 |    29,583,529 |       36,825,932 |       5,253,843 |
|   40,000 |   37,734 |  127,552,584 |          760.3% |  15,703,264 |  16,067,650 | 95.8% |  6,716,679 |    59,187,591 |       73,684,341 |      10,485,000 |

- Straight line for the rows: 400 bytes for each capture plus 50,000 bytes, exact within 0.2% at the five counts. The calculator uses it.
- Stops from these numbers: inventory of today at about 5,260; CLI file at 8,388,608 / 1,472 = about 5,700; manifest request at 16,777,216 / 1,832 = about 9,150; 10,000 profiles at about 10,600 captures; rows at 16 MiB at about 41,800 captures. [corrected] These are the stops for a run with few changes (4 of 3,832). When every capture changed: inventory of today about 4,750, manifest request about 8,000, rows at 16 MiB about 18,800 (check C1).

### E5. Does the validator stop at 10,000 profiles?

- Expected: `parseManifest` refuses the scaled manifest of 20,000 captures.
- Observed: `ProtocolError: profiles must be an array with 1–10000 entries` (18,882 profiles). The manifest of 10,580 captures has 9,993 profiles and passes.

### E6. Time of a read

- Files: `probe/expand.probe.ts`, `probe/wire.probe.ts`, `probe/measure.probe.ts`. Results: `results/expand.json`, `results/wire.json`, `results/measure.json`.
- Today, 3,832 captures, median of 9: complete real read 384.5 ms (358.3 ms in another run of 5). Steps: digest 4.1, parse 14.3, canonical check 56.3, fill details without checks 3.1, one manifest validation 19.9. The rest, about 307 ms, is the validation (a difference, not a direct measurement).
- Rows, median of 9: digest 0.5, parse 1.6, canonical check 6.7, build the capture list 2.6 (1.2 to 3.6 in other runs), 3,613 profile digests with the real `digestJson` 57.4 and 66.7 in two runs. Sum: about 73 ms.
- Read with the digest check only (the selected D-RUN-03): 21.5 ms today, 4.7 ms with rows.
- Reading the reference rows directly from the rows, with no capture objects: 0.1 ms.
- Write: pack and encode 141 ms; the writer copy of today 150 ms.
- Expected: rows faster in each step. Observed: yes. After D-RUN-03 the CPU gain for a review read is small (17 ms), so for the review page the gain is bytes and memory. For Submit, which keeps all checks, it is about 5 times.

### E7. Memory

- File: `probe/memory.probe.ts`. Result: `results/memory.json`. Live V8 heap plus array buffers that one value adds, after 4 collections.

| Captures | File of today, parsed | Rows, parsed | Rows as capture list | Rows as capture list and manifest | Manifest request of today, held by the declare step |
| -------: | --------------------: | -----------: | -------------------: | --------------------------------: | --------------------------------------------------: |
|    3,832 |               13.3 MB |       2.9 MB |               4.6 MB |                            7.0 MB |                                             28.6 MB |
|   10,580 |               37.0 MB |       8.0 MB |              12.8 MB |                           19.3 MB |                                             79.3 MB |
|   20,000 |               70.0 MB |      15.1 MB |              24.2 MB |                           36.3 MB |                                            150.0 MB |
|   40,000 |              140.1 MB |      30.1 MB |              48.3 MB |                           72.7 MB |                                            300.2 MB |

- The real reader of today holds 14.1 MB for one inventory at 3,832 captures.
- The declare column adds what `declareStaged` holds at one time: body bytes, decoded text, parsed manifest, canonical text, and encoded bytes (`workflow-owned.ts:487-489`, `workflow-evidence.ts`). Above 10,000 profiles the probe used `JSON.parse` in place of `parseManifest`.
- Expected: the unpacked rows are much smaller than the parsed file of today. Observed: 2 to 3 times smaller, not 7.7 times, because the unpack builds each capture object again. Shared values are one object for many captures.
- Reading: with the formats of today, the manifest request alone holds 79 MB at 10,580 captures. So a higher limit in the CLI and in the service does not reach the planning number with a safe margin. This is the main reason for the rows in the request.
- Limit: Node, not workerd. The numbers for 40,000 captures say that a reader must use the rows directly at that size (30 MB parsed for each inventory), not the capture list of today (48 MB for each).

### E8. Does the manifest alone go into rows and back?

- File: `probe/wire.probe.ts`. The first 14 columns and the last column are what the CLI can build (no capture ID, no kept image).
- Expected: the same canonical JSON and the same `digestJson` as the manifest.
- Observed: equal. 1,043,166 bytes at 3,832 captures (272 for each capture), against 7,018,634 for the request of today and 5,639,995 for the file. gzip of the request of today: 749,114 bytes.
- Limit: this is not a CLI build. The CLI part of the option is not prototyped.

## Options and why

| Option                                         |                    3,832 |                              10,580 |                              20,000 | Largest run                                                                                                                                             | D1 rows written against today | Changes                                                                                                                      | Effort | Reverse                                |
| ---------------------------------------------- | -----------------------: | ----------------------------------: | ----------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------- |
| `keep-format-refuse-early`                     |                 12.15 MB |                33.69 MB, not stored |                63.74 MB, not stored | about 5,260                                                                                                                                             | 0                             | alerts and one refusal                                                                                                       | S      | revert                                 |
| `capture-rows` (service only)                  |                  1.58 MB |                             4.28 MB |                             8.05 MB | inventory 40,000; the run stops at about 5,700 in the CLI                                                                                               | 0                             | `capture-inventory.ts` and its tests; the import tool gets the form through the writer; one conversion of stored inventories | M      | conversion in the other direction      |
| `capture-rows-cli-limits` (added by the check) | 1.58 MB, request 7.02 MB | 4.28 MB, request 19.46 MB (refused) | 8.05 MB, request 36.83 MB (refused) | about 9,150; about 8,000 when every capture changed (request limit of the service)                                                                      | 0                             | the service part, 2 CLI constants, a CLI release, one pull request in Ariakit, new pins in the service                       | M + XS | earlier CLI version                    |
| `capture-rows-from-cli` (recommended)          | 1.58 MB, request 1.04 MB |            4.28 MB, request 2.80 MB |            8.05 MB, request 5.25 MB | [corrected] about 18,800 when every capture changed (inventory at 16 MiB); 40,000 (service setting) when few changed; memory measured in Node to 20,000 | 0                             | the service part, 4 CLI places, 3 limits, a CLI release, one pull request in Ariakit, new pins in the service                | L      | earlier CLI version and the conversion |
| `paged-objects`                                |      12.15 MB in 4 pages |                      33.69 MB in 11 |                      63.74 MB in 20 | no byte limit; about 5,700 in the CLI; memory stops the readers that need each capture                                                                  | 0                             | 6 readers, retention, recovery, history; contract line 26                                                                    | L      | hard                                   |

Code that the rows delete in `capture-inventory.ts`: `metadataProfile` (197-213), `validateReceipt` (215-283, the checks between the two copies), `CompactCapture`, `CompactInventory`, `receiptMetadata`, `compactInventory`, `expandInventory` (285-394), and the top-level `profiles` copy. About 200 lines. The prototype has about 520 lines with its types and the handling of unknown fields, so the file does not get shorter.

Limits that stay:

- `keep-format-refuse-early`: all.
- `capture-rows`: the CLI file (about 5,700), the manifest request (about 9,150), the 10,000 profiles (about 10,600), the 40,000 captures, the isolate memory.
- `capture-rows-from-cli`: [corrected] the 16 MiB of the inventory (about 18,800 captures that all changed), the 40,000 captures, the isolate memory. The profile list has 81 entries, so its limit of 10,000 is far. The CLI must also read the shard manifests of the capture adapter, which keep the form of today: the same release raises that file limit and the profile limit for the CLI, which runs on a GitHub runner and not in a Worker.
- `paged-objects`: as `capture-rows`, and the memory of each reader that needs all captures.

Why the recommendation is `capture-rows-from-cli`:

- It is the only option that removes each stop below the planning number of the contract.
- Each way past about 5,700 captures needs a new CLI version in Ariakit, also a release that only raises the two constants. So the cost for the consumer repository is the same pull request.
- A release that only raises constants reaches about 9,150 (request limit) and then about 10,600 (profiles), and the Worker holds 79 MB for the request at 10,580 captures (E7). That is a second CLI release later.
- Its service part is `capture-rows`, which is measured and needs nothing from Ariakit.

What makes it wrong:

- The capture count stays below about 5,000 for the next year. Then `capture-rows` is enough.
- A measurement in a Worker shows that a read of rows at 10,580 or 20,000 captures needs much more memory than Node shows.
- A build of the CLI part shows that the manifest digest and the signed evidence cannot use the rows in a simple way.

## Directions that are not options, with the reason

| Direction                                                               | Evidence                                                                                                         | Reason                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smaller-object` (profile as base and clip only)                        | 10.1 MB, about 6,390 captures (audit estimate)                                                                   | The note of the maintainer rejects it. The rows contain this split.                                                                                                           |
| `d1-rows` (capture rows in D1)                                          | 1,866 rows written against 66 for 100 unchanged captures (recorded probe)                                        | Standing rule 1: it adds about 18 D1 rows written for each capture.                                                                                                           |
| gzip in R2 with the format of today                                     | 1.51 MB at 3,832, 4.15 MB at 10,580 (E4); parsed 37 MB at 10,580 (E7)                                            | The limit protects memory. R2 also needs a known length.                                                                                                                      |
| gzip on top of the rows                                                 | 0.65 MB against 1.58 MB at 3,832                                                                                 | Not needed. It adds a second digest question (stored bytes against content).                                                                                                  |
| A higher or no limit with the format of today                           | 45.0 MiB peak for one review read in workerd at 3,832 (audit); about 124 MiB at 10,580 (straight line, estimate) | The CLI stops at about 5,700, then memory stops the review page.                                                                                                              |
| A stream of lines with a partial read                                   | not built                                                                                                        | The readers that matter need each capture. A Worker has no line reader for JSON. With 1.58 MB there is nothing to stream. A range read cannot check the digest of the object. |
| A small object for the changed captures beside the complete one         | not built                                                                                                        | D1 holds the changed captures, and D-RUN-02 reads them there with no R2 read. A second object adds a write and a deletion rule, and the complete file keeps its limit.        |
| The manifest as its own R2 object, not embedded                         | not built                                                                                                        | Two objects for each run, and the capture list still needs a packed form for the review details. The rows give one object.                                                    |
| A CLI release that only raises the two constants                        | request 19.5 MB and 79 MB held at 10,580 (E7)                                                                    | It moves the stop to about 9,150, then to about 10,600. It needs the same pull request in Ariakit as the rows.                                                                |
| The clip out of the rendering identity (protocol and contract change)   | audit: lines 107, 124, 184 of the contract                                                                       | Not needed. The rows keep the digest of each profile with its clip, so the rendering identity does not change.                                                                |
| Images stored by content digest, so that a row needs no image ID        | not built                                                                                                        | It changes the retention model, which uses the owner run of each image.                                                                                                       |
| Derive the capture ID and the profile digest in the reader (not stored) | 264 of 413 bytes for each capture are four values of 64 characters                                               | A read with the digest check only would need 3,832 hashes or more. Bytes are no longer scarce.                                                                                |

## Fit with the selected answers of the run page

- D-RUN-02 (attention-first response): the first response reads D1 only. The rows do not change that. The second request (unchanged list) reads two inventories: 3.2 MB in place of 24.3 MB.
- D-RUN-03 (check the digest only): the short read is digest, parse, and build the list: 4.7 ms with rows, 21.5 ms today (E6). With one copy of each fact, the read has no cross-check to skip.
- D-RUN-05 (decision receipt with no model): a saved decision reads no inventory. No interaction.

## What the lane did not check

- No measurement in workerd or in production. Time and memory are from Node on one laptop.
- The transfer time of R2 in production is not known (WAIT-02). The lane makes no time claim for it.
- The CLI part of `capture-rows-from-cli` is not built. The lane did not design where the digest of the manifest is taken. The note in the section says that it must be the digest of the rows.
- The fixture has synthetic comparison results, image IDs of the import form, and 4 changed captures. A run with many changed captures has longer rows for those captures (the result and the metadata difference).
- The scaled inventories repeat the real one. Real growth can have another mix of item name lengths and profiles.
- The imported baseline (no manifest) was not packed. [corrected] The check packed it: see C2.
- The cutover is not designed. Two ways exist: a script that converts the stored inventories that a new run or an open pull request can still read (one R2 write and one pointer update for each, one time), or the old reader stays for 30 days and is then deleted. [corrected] The pointer update is a D1 write (one time, the run row and the snapshot row). The way with the old reader writes nothing to D1. The section text now says both. The recovery check marks an inventory that it cannot read as corrupt, so the cutover must handle the old objects.
- The prototype is not repository code and has no tests of its own beyond the round trip.
- `paged-objects` was not built. Its memory statement comes from the parsed size of the format of today.

## Questions for the maintainer or the coordinator

1. Which capture count must the service support in the next year? Below about 5,000, `capture-rows` is enough.
2. Cutover: a conversion script, or the old reader for 30 days?
3. The lead and the stats at the top of `40-data-storage.html` are outside this lane. They are still correct. If D-DATA-02 is settled, the stat "Captures until the stop" needs the new number.
4. `25-run-load.html` names gzip "beside D-DATA-02". With rows, gzip is not needed. That sentence is outside this lane.

## Independent check (second agent, 2026-10-06)

Loaded skills: `ariakit-general-workflow`, `ariakit-general-code-style`. The remote is `https://github.com/ariakit/visonaut.git`. The repository was read only. All checker files are in `check/` of the lane folder.

### What the check confirmed

| Claim                                          | How                                                                                                                                                                                           | Result                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All byte counts of E1 to E4 and E8             | Ran `probe/*.probe.ts` again (`check/rerun.log`), compared with the first results (`check/results-first/`)                                                                                    | The same bytes in each file. `rows-3832.json` is identical.                                                                                                                                                                                                                 |
| Memory table E7                                | The same run                                                                                                                                                                                  | The same numbers in each cell.                                                                                                                                                                                                                                              |
| Times of E6                                    | The same run                                                                                                                                                                                  | Within noise. Complete real read: 369, 390, 410 ms (first agent: 358, 385). Profile digests of the rows: 71 ms (first agent: 57, 67). So "about 385 ms" and "about 75 ms (69 to 83)".                                                                                       |
| The limit constant, its comment, and the throw | Read `apps/web/src/capture-inventory.ts:55-56`, `:466-470`, `:499-502`, `:530`                                                                                                                | Correct.                                                                                                                                                                                                                                                                    |
| 1 writer and 6 reader places                   | `grep` of each caller at commit f83fef6                                                                                                                                                       | Correct: `review-inventory.ts:44-47`, `local-comparison.ts:60-94`, `workflow-materialize.ts:389` and `:517`, `promotions.ts:304`, `recovery.ts:173`, `history.ts:530`. The import tool reads and writes too (`tooling/baseline-reset/reset.ts:451`, `:501`).                |
| CLI limits                                     | Read `packages/cli/src/files.ts:9`, `:46`, `artifact-archive.ts:10`, `:100`, `bundles.ts:43`, `:126`, `engine.ts:778`, `:816-817`                                                             | Correct. The combined manifest is written with no receipt (5.64 MB) and read with the 8 MiB limit. The receipt is added after that read.                                                                                                                                    |
| Service limits and production settings         | Read `apps/web/src/runtime-defaults.ts:12`, `:14`, `apps/web/wrangler.jsonc:64` (`VISONAUT_API_LIMITS` is `{}`), `workflow-owned.ts:487-489`, `:560`, `:575-578`                              | Correct.                                                                                                                                                                                                                                                                    |
| 10,000 profiles                                | Read `packages/protocol/src/validate.ts:273`                                                                                                                                                  | Correct. A second place: `apps/web/src/capture-inventory.ts:186` and `:368` check the same number on the inventory.                                                                                                                                                         |
| D1 rows written                                | Ran `probe/d1-cost.mjs` on the recorded probe                                                                                                                                                 | 66 (sparse, 100 captures, 0 changed), 90 (1 changed), 1,866 (dense). The 3 statements with an inventory fact write 1, 6, and 1 rows. Correct.                                                                                                                               |
| Contract, planning number, D54                 | Read `docs/current-contract.md:26`, `docs/simplification-audit/contract-issue-1.md:340`, `docs/design-verification.md:82`, `docs/design-r9.json` (D54, answer `measure`)                      | Correct.                                                                                                                                                                                                                                                                    |
| Pull requests #247 and #249                    | `gh pr view` (read 2026-10-06)                                                                                                                                                                | Quotes correct. #247 also says: the imported baseline inventory had 10,089,976 bytes, and the cutover used a fresh D1 database with `docs/baseline-delta-cutover.md`.                                                                                                       |
| Platform limits                                | https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/r2/platform/limits/ , https://developers.cloudflare.com/d1/platform/pricing/ (read 2026-10-06) | "Each isolate can consume up to 128 MB of memory, including the JavaScript heap and WebAssembly allocations." "5 TiB per object". "First 50 million / month included + $1.00 / million rows". Correct.                                                                      |
| Ariakit pins                                   | `gh api repos/ariakit/ariakit/contents/.github/workflows/app.yml` and `ci.yml` (GET, read 2026-10-06)                                                                                         | `app.yml:11` (package digest), `:252` (`visonaut@0.5.4`), `ci.yml:70` (`visonaut@0.5.4`). Correct.                                                                                                                                                                          |
| First capture example                          | `node` on `data/run-inventory.json`                                                                                                                                                           | Records 1,345 + 768 + 706 + 369 = 3,188 bytes; row 378 bytes; image digest 6 times. The profile digest is 9 times in the file, because a second capture has the same profile. In the four records of this capture it is 5 times. The text now says "the four records hold". |

### What the check corrected

**C1. "The 16 MiB limit holds 40,000 captures" is true only when few captures changed.**

- Expected: a changed capture needs some more bytes for its result.
- Experiment: `check/changed.probe.ts` makes each capture a changed capture, in the form of the 4 changed captures of the fixture (result with mask and baseline digest, image owned by the run, `maskImageId`). The real `writeCaptureInventory` validated and encoded the result at 3,832 captures. Result: `check/changed.json`.
- Observed, format of today: 13,540,316 bytes at 3,832 captures (80.7% of 16 MiB), 3,533 bytes for each capture. So the inventory of today stops at about 4,750 captures that all changed, not 5,260.
- Observed, first prototype: 8,260,887 bytes at 3,832 captures, 2,156 bytes for each changed capture. 16 MiB hold about 7,780. Reason: `difference()` in `probe/pack.ts` compares only the top keys, so one new key (`metadata.localResult.maskImageId`) stores the complete metadata again in the last column.
- Repair for the measurement: `check/pack-deep.ts` is a copy of the prototype with a nested difference. Round trip equal (canonical JSON and manifest digest) up to 10,580 changed captures. 3,461,390 bytes at 3,832 (903 for each), 9,464,461 at 10,580, 17,850,967 at 20,000 (106.4%), 35,673,609 at 40,000. Straight line: 890 bytes for each changed capture plus 50,000. 16 MiB hold about 18,800.
- The 4 real changed rows of the fixture: 2,112 to 2,166 bytes in the first prototype, 859 to 880 with the nested difference (`check/sample.json`).
- Manifest request when every capture changed: 7,998,732 bytes today at 3,832 (2,087 for each, stop at about 8,000), 2,616,616 as rows (683 for each, 16 MiB hold about 24,900).
- Changed in the text: the lead, the stops table (new column), a second size table, the option table, the calculator (new input "Captures that changed"), the alert sentence, the decision.
- Not measured: memory of a run in which every capture changed. A mask column with only digest and bytes (estimate: about 600 bytes for a changed row) was not built.

**C2. "The prototype keeps the facts of an imported baseline" is wrong.**

- Experiment: `check/imported.probe.ts` removes the manifest from the inventory (the form that the import tool writes) and packs it. The real writer accepted the input: 11,695,298 bytes in the format of today. Result: `check/imported.json`.
- Observed: the round trip differs in the field `profiles`. `unpackInventory` collects profiles only when the manifest header exists (`probe/pack.ts:498`), so the list comes back empty. The rows have 6,754,138 bytes, 1,763 for each capture, because the metadata of each capture goes into the last column.
- Changed in the text: the sentence after the example, the item "Not built and not measured", the option `capture-rows`.

**C3. "The profile digest is in the file 5 times."** It is 9 times in the file and 5 times in the four records of the capture. Text changed.

**C4. The minimal way past 5,700 captures was not an option.** A CLI release that only raises the file limit was in the table of rejected directions of this record, and it was not in the section. It is materially different (2 constants in place of a new request format), so it is now the option `capture-rows-cli-limits`. Its bounds are measured: about 9,150 captures, and about 8,000 when every capture changed (request limit of the service, 16 MiB). It is not the recommendation, because it does not hold the 10,580 captures of the contract, and because a higher request limit meets the memory of the isolate (79 MB at 10,580 in Node).

**C5. A hidden D1 write in the cutover.** "One pointer update for each" converted inventory is a D1 write. It is one time and not for each run, so standing rule 1 is not broken, but the text must say it. The text now gives the way with 0 D1 writes too (the reader of today stays for the baseline until the next main run replaces it).

**C6. Limits that the record did not name.**

- `apps/web/src/capture-inventory.ts:186` and `:368`: the inventory checks 10,000 profiles too.
- `apps/web/tooling/baseline-reset/reset.ts:32`: the import tool accepts 10,000 captures.
- The manifest file of each capture job has an indent of 2 (`packages/playwright/src/reporter.ts:254`) and the same 8 MiB limit. Estimate from the combined manifest: the Linux job (2,632 captures, 2,486 profiles) writes about 5,585,123 bytes, 66.6% of the limit, and passes it when the run has about 5,755 captures at the same split. It passes 10,000 profiles when the run has about 15,400 captures. So `capture-rows-from-cli` must raise the file limit and the profile limit of the CLI in the same release ("3 limits").
- A review read of two inventories as rows is 97 MB at 40,000 captures in Node (2 x 48.3), so 40,000 is not a safe size for the review page.

### Attempts to refute the recommendation

| Attack                                                       | Result                                                                                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A run in which every capture changed                         | The option still holds 10,580 captures (inventory 9.46 MB, 56.4%; request 7.14 MB, 42.6%). It does not hold 20,000 such captures (106.4%). The claim "40,000" is now "about 18,800 to 40,000".        |
| A hidden D1 write                                            | None in a run: no statement holds a format fact. The declare step writes the same row in `ingest_staged_manifests`. The cutover has a one-time pointer update (C5).                                   |
| A limit that stays                                           | The 16 MiB constant stays and the write above it still throws, with the same bad failure. So the alert and the early refusal stay necessary. Text added ("The limit stays a constant").               |
| A rule of the contract                                       | Line 26 ("one complete, immutable R2 inventory per run") stays. The rendering identity does not change, because each row keeps the profile digest.                                                    |
| A simpler option                                             | `capture-rows-cli-limits` (C4). It is simpler and stops at about 8,000 to 9,150. The recommendation stays, with this option named as the simpler one when about 8,000 captures are enough.            |
| "Each way past 5,700 needs the same pull request in Ariakit" | Confirmed: the CLI version is pinned in `app.yml:252` and `ci.yml:70`, the package digest in `app.yml:11`, and the service pins the workflow commit and the package digest in `wrangler.jsonc:61-62`. |
| The digest question of the CLI part                          | Still open. Two ways exist (the digest of the rows, or the digest of today calculated piece by piece). Neither is built. This is the largest doubt of the recommendation.                             |

### Standing rules against each option

| Option                     | D1 writes for each run | Backward compatibility                                               | Simpler?                                                                             |
| -------------------------- | ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `keep-format-refuse-early` | the same               | not needed                                                           | The smallest change. The note of the maintainer rejects its limit.                   |
| `capture-rows`             | the same               | no old reader is necessary; the baseline needs the new form one time | One file changes. The data is simpler (each fact one time). The code is not shorter. |
| `capture-rows-cli-limits`  | the same               | the same                                                             | The service part and 2 constants.                                                    |
| `capture-rows-from-cli`    | the same               | the same; a new CLI version in Ariakit                               | The largest change. One format from the CLI to storage.                              |
| `paged-objects`            | the same               | the same                                                             | More objects, 6 readers change. Not simpler.                                         |

### Build, check, and browser

- `node apps/lab/audit/build.mjs --strict --content <lane>/content --out <lane>/out`: passed (15 sections, 51 decisions, 253 terms, 59 demos).
- `node apps/lab/audit/check.mjs --dir <lane>/out`: all checks passed (`check/check.log`).
- `check/view.mjs` opened `out/index.html` in Chrome at 1440 px and at 400 px: no console error, no page overflow. It used the compare demo (3 panels), the timeline (both changes, Reset), and the calculator (10,580 and 20,000 captures at 100% changed, 9,160 at 0%, Reset). Pictures: `check/shots/`.

### Limits of the check

- All measurements are in Node v24.18.0 on one laptop. Nothing ran in workerd.
- The changed captures of C1 are synthetic. Real changed captures can have other mask sizes and other result fields.
- The estimate of the manifest file of each capture job comes from the combined manifest, not from real files of the jobs.
- The check did not build the CLI part and did not design the cutover.
- The check sent no request to production. It read `ariakit/ariakit` with two GET requests of the GitHub API.
- `check/pack-deep.ts` is a measurement tool. It is not a proposal for the encoding of the last column.
