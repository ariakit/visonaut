# Second-lens check 3: REVIEW-05, REVIEW-06, REVIEW-08, AUTH-01

Lens: platform facts, real impact, and fix feasibility. Read-only. Repository commit `f83fef6`. Date 2026-10-05.

No file in the repository was changed. All probe files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-3/`.

## Verdict summary

| ID        | Verdict          | Severity | One line                                                                                                                                      |
| --------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| REVIEW-05 | partly-confirmed | high     | The defect is real. The stated fix ("D1 only, no R2") is not possible with the data that D1 holds today.                                      |
| REVIEW-06 | partly-confirmed | high     | The defect is real and is larger than stated at production scale. The stored receipt is sufficient for a save. It is not sufficient for Undo. |
| REVIEW-08 | partly-confirmed | medium   | The facts are correct. An edge cache does not help the first view, which is the case that the title names.                                    |
| AUTH-01   | confirmed        | high     | Measured in production: about 0.33 s for each request. The option exists in the installed version.                                            |

## Evidence that I made

| File                                                             | What it is                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `second-lens-3/production-timing.txt`                            | 19 signed-out production requests on one connection (`curl -w`), 6 rounds.                                                                                |
| `second-lens-3/production-image-headers.txt`                     | Response headers of one production `/images/<unknown id>` request.                                                                                        |
| `second-lens-3/second-lens-3582.json`                            | Probe on a 3,582-capture inventory run: what D1 holds, sizes, and the receipt test.                                                                       |
| `second-lens-3/second-lens-chain.json`                           | Four decisions in a chain. The page result is compared with the server model after each one.                                                              |
| `second-lens-3/second-lens-heap.json`                            | Live heap at the end of one model build (Node, not workerd).                                                                                              |
| `second-lens-3/auth-schema.json`                                 | Real `createAuth` on Miniflare D1: the default schema check with a matching schema and with one column removed.                                           |
| `second-lens-3/tail.ts.txt`, `generate.mjs`, `vitest.config.mjs` | Probe source. It uses the first verifier's `sparseRun` fixture and the real `reviewModel`, `enqueueReview`, `processReviewQueue`, and `applySavedReview`. |
| `second-lens-3/auth-schema.lens.ts`, `vitest.auth.config.mjs`    | Source of the auth schema probe.                                                                                                                          |

Run commands:

- `node <repo>/node_modules/vitest/vitest.mjs run --config <scratch>/second-lens-3/vitest.config.mjs` (3 tests passed).
- `node <repo>/node_modules/vitest/vitest.mjs run --config <scratch>/second-lens-3/vitest.auth.config.mjs` (1 test passed).

Limits of the probes: Node 24.18.0 on the audit machine. The review probe uses in-memory SQLite and an in-memory object store. The auth probe uses Miniflare D1 with in-memory storage. Counts, sizes, and equality results do not depend on the machine. No time from a probe is used in this file. `git status --short` is the same before and after (`M pnpm-lock.yaml`, `?? apps/lab/`, both from before this lane).

## Production numbers that this file uses

My measurement, 6 rounds on one warm connection (`production-timing.txt`). Time to first byte, in seconds:

```text
/health                      0.0227 0.1201 0.0223 0.0271 0.0211 0.0229   median 0.0228   no D1
/images/<unknown uuid>  404  0.1620 0.1724 0.1519 0.1484 0.1549 0.1562   median 0.1556   1 D1 round trip
/api/runs               401  0.3682 0.3532 0.3485 0.3617 0.3600 0.3510   median 0.3566   2 D1 round trips
```

- One D1 round trip: 0.1556 - 0.0228 = **0.133 s**.
- The two round trips of the schema check: 0.3566 - 0.0228 = **0.334 s** (0.167 s for each).
- The first `/health` request (0.225 s, new connection) is not in the table.
- The Worker ran at `GRU`: `cf-ray: a45f2f7d5ee4f24f-GRU`. No `cf-placement` header.
- The round-trip counts (1 and 2) come from the code and from the first verifier's local count (`review-load/verify/api-path-verify.json`). They are not from a production trace.
- One location, one day. The numbers are for a Worker at GRU. A maintainer in a different region gets different numbers.

Signed-in production numbers come from the orchestrator (`audit/live-authenticated.md`): `/api/runs/<id>` has a server wait of 5.25 to 5.68 s, 692 KB transferred, 5.3 to 6.0 MB decoded, for 3,832 variants.

## Platform facts (official documentation)

| Fact                                                                                                                                                                                                                   | Source                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| D1 has no published latency number. "Users located further away from the primary database instance experience longer request latency due to network round-trip time."                                                  | https://developers.cloudflare.com/d1/best-practices/read-replication/           |
| "D1 location hints are not currently supported for South America (`sam`), Africa (`afr`), and the Middle East (`me`). D1 databases do not run in these locations."                                                     | https://developers.cloudflare.com/d1/configuration/data-location/               |
| `batch()`: "Sends multiple SQL statements inside a single call to the database. This can have a huge performance impact as it reduces latency from network round trips to D1."                                         | https://developers.cloudflare.com/d1/worker-api/d1-database/                    |
| D1 rows read: Workers Paid includes 25 billion each month, then $0.001 for each million. Workers Free: 5 million each day.                                                                                             | https://developers.cloudflare.com/d1/platform/pricing/                          |
| R2 location hints are `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`. South America is not in the list.                                                                                                                  | https://developers.cloudflare.com/r2/reference/data-location/                   |
| "Cloudflare Workers run before the cache". "Cache API is local to a data center". "The Cache API is not compatible with tiered caching."                                                                               | https://developers.cloudflare.com/workers/reference/how-the-cache-works/        |
| "Workers deployed to custom domains have access to functional cache operations." `cache.delete` "only purges content of the cache in the data center that the Worker was invoked." `cache.put` honors `Cache-Control`. | https://developers.cloudflare.com/workers/runtime-apis/cache/                   |
| Memory per isolate is 128 MB. "This limit is per-isolate, not per-invocation. A single isolate can handle many concurrent requests." CPU on Workers Free is 10 ms for each request.                                    | https://developers.cloudflare.com/workers/platform/limits/                      |
| Placement: `"placement": { "mode": "smart" }` or `"region": "aws:us-east-1"`. Status `INSUFFICIENT_INVOCATIONS` means "not received enough requests from multiple locations". The page does not name D1.               | https://developers.cloudflare.com/workers/configuration/placement/              |
| GitHub publishes rate limits (5,000 requests each hour for an installation token), not latency.                                                                                                                        | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| Workers Web Crypto supports `RSASSA-PKCS1-v1_5` `sign` and `importKey`. No latency number is published.                                                                                                                | https://developers.cloudflare.com/workers/runtime-apis/web-crypto/              |

GitHub API time and RSA signing time are not measured in this audit. They are not on the path of REVIEW-05, REVIEW-08, or AUTH-01. For REVIEW-06 they apply only to the first decision of a page visit and to each Undo (a live permission check).

Assumption: the account is on Workers Paid. `apps/web/wrangler.jsonc:39-42` sets `"cpu_ms": 240000`, which Workers Free does not permit. I did not read the account.

---

## REVIEW-05: The first response contains each unchanged capture

**Verdict: partly-confirmed. Severity: high. Confidence: high for the facts, medium for the size of the gain.**

### 1. Hot path

- Production (`apps/web/wrangler.jsonc:46-122`) has the D1 binding `DB` and the R2 binding `IMAGES`. `VISONAUT_ENVIRONMENT` is `production`, so `apps/web/src/server.ts:73-80` (preview fixtures) does not run.
- `apps/web/src/routes/runs.$runId.tsx:37-39`: the route loader calls `loadReviewModel`. This is one `GET /api/runs/<id>` for each run page load.
- `apps/web/src/api/review.ts:785-791`: the route returns `reviewModel(...)`.
- `review.ts:364`: `run.inventory_key ? readReviewInventory(context, run.id) : null`. `review.ts:371-374`: `completeReviewRows(inventory, storedRows, comparison.id)` adds one row for each unchanged capture.
- The same `reviewModel` call runs again for each decision receipt and each Undo (REVIEW-06), for each conflict (`review.ts:682-683`), and for the comparison-ready poll (`use-review-session.ts:210`).

Frequency: one time for each run page load, and one time or more for each decision.

### 2. Magnitude

Measured (my probe, 3,582 captures, 4 changed):

```text
full model            2,153,156 bytes   205,102 gzip
attention-only model      4,580 bytes     1,301 gzip
name-only index of the unchanged items   499,039 bytes   20,635 gzip
reviewModel I/O: 15 D1 round trips, 2 R2 gets
```

Measured in production by the orchestrator: server wait 5.25 to 5.68 s, download 0.05 to 0.33 s (response end minus response start), then 1.1 to 1.75 s until content is visible (background tab, so this part can be too high).

So the transfer is not the bottleneck. The server wait is.

Estimate of the server wait, by count: the complete request has 15 D1 round trips in sequence (first verifier, `verify/inventory-depth-3582.json`). At 0.133 s for each, that is about 2.0 s. About 3.2 to 3.7 s remain for the two R2 reads, the hash, the two validations, the model build, and the JSON output. This split is a subtraction. It is not a trace. Workers traces are enabled (`wrangler.jsonc:15-20`) and can give the real split.

Memory, measured in Node: one model build holds about 16 MB of live objects at its end for 9.4 MB of inventory JSON (`second-lens-heap.json`). The peak is higher and is not measured. The isolate limit is 128 MB for all concurrent requests.

### 3. Fix feasibility

The finding says that an attention-first response "needs D1 only and no R2". **This is not correct for the code today.** Two facts:

1. The stored rows have no reference capture. `packages/service/src/local-comparison.ts:325-327`:

   ```sql
   INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,reference_capture_id,candidate_capture_id,tuple_json,outcome,result_json)
     SELECT json_extract(value,'$.id'),?,...,json_extract(value,'$.ordinal'),NULL,json_extract(value,'$.candidateId'),...
   ```

   The model then gets the reference from the baseline inventory in R2. `review.ts:442-446`:

   ```ts
   : ((row.reference_capture_id ? captureById.get(row.reference_capture_id) : null) ??
     inventory?.referenceByIdentity.get(identity));
   ```

2. Measured (`second-lens-3582.json`):

   ```text
   storedComparisonRows                           4
   storedRowsWithReferenceCaptureId               0
   storedRowsWithCandidateCaptureId               4
   changedVariantsWithReferenceImage              4
   referenceImagesAvailableFromTheD1ModelQueries  0
   candidateImagesAvailableFromTheD1ModelQueries  4
   digestLookupPlan   SCAN visonaut_images
   ```

   D1 holds the candidate image of each changed row. It holds only the digest of the reference image (`tuple_json.referenceDigest`). `visonaut_images` has no index on `digest`, so a lookup by digest reads the full table. A removed row has no candidate, so its name and variant labels also come from the baseline inventory.

So an attention-first response needs one of these:

| Option                                                                                               | What changes                                                                                                                                                                   | R2 reads for the first response         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| A. Store the reference image ID (and the name for a removed row) with each changed row at Submit     | One new column or table, written in `createSparseComparison` where `reference.image` is in memory (`local-comparison.ts:175`). Old runs need a fallback to the inventory.      | 0                                       |
| B. Look up the reference image by digest                                                             | One index on `visonaut_images(digest)` (a migration), or accept the scan. More than one row can have the same digest, so the query must select a row with `bytes_present = 1`. | 0                                       |
| C. Read only the baseline inventory first                                                            | No schema change.                                                                                                                                                              | 1 (the baseline, 3.4 MB in the fixture) |
| D. Keep one complete model, but make it cheap (REVIEW-04): write a small review projection at Submit | No change to P01.                                                                                                                                                              | 1 small object                          |

Other things that can go wrong:

- `completeReviewRows` is also an integrity check. It throws "A changed capture is missing its persisted review row." (`review-inventory.ts:135-137`). With an attention-first response, the page can show Approve before that check runs. The maintainer must decide if review actions stay disabled until the complete list arrives.
- The sidebar count is a count of items ("Accepted (626)"). D1 has `capture_count`, which is a count of captures. The item count needs the inventory.
- A deep link to an unchanged item (`?item=…&variant=…`) must wait for the second response, or the first request must name the item.
- Two responses can have different `comparisonRevision` values when a decision commits between them. The page needs a merge rule.
- The second request pays the complete prelude again (6 D1 round trips) until AUTH-01 and the related findings are done.
- TanStack Router can render before all data is ready. `defer` and `Await` exist in the installed version (`@tanstack/react-router` 1.170.38, `dist/esm/index.d.ts:1,5`). "As soon as any awaited promises are resolved, the next route will begin rendering while the deferred promises continue to resolve." (https://tanstack.com/router/latest/docs/framework/react/guide/deferred-data-loading). The route is client-only (`ssr: false`), so no streaming server setup is necessary.

Contract:

- No security rule changes. Session, account, and permission checks stay the same.
- `docs/current-contract.md:26` says "Review reads the full inventory to show unchanged items." A later read keeps this true.
- `docs/current-contract.md:148`: "P01 | One compact complete model". The decision record rejected "Summary plus selected evidence". Its reopen clause is: "A route measurement shows that complete-model reads or parse time exceed the selected budget after compression and simple query cleanup, or representative client memory is excessive." It also says: "Preserve archived identity, row revisions, deep links, full navigation, whole-item review and pre-promotion Undo."
- No budget exists. `docs/development.md:70-72` says that local timing "is not ... a performance budget" and "Do not ... infer a budget from a developer laptop." So the reopen clause cannot be evaluated until the maintainer sets a budget or decides directly.

### 4. Strongest counter-argument

P01 is an approved decision, and its own text gives the order: "simple query cleanup" first. About 2.0 s of the 5.3 to 5.7 s is D1 round trips that other findings remove with small changes (AUTH-01, REVIEW-02, REVIEW-03). The remaining part is mostly the inventory read and validation, and option D removes that with no second protocol. A split response adds a second request, a merge rule, a loading state for the list, and new tests in the most delicate part of the client. In the three production samples each item was in "Accepted (626)", so an attention-first response would show an empty review area first. By this argument, a new measurement after the small fixes is necessary before P01 can be reopened. The maintainer decides.

### Corrections to the finding

- "needs D1 only and no R2" is wrong today (see section 3).
- The first verifier wrote that "the unchanged rows are the only reason to read the two inventories". That is also wrong: the reference image of each changed row and all data of a removed row come from the baseline inventory.
- The response size (633 KB to 2.15 MB raw) is not the main cost. The measured download is 0.05 to 0.33 s.

---

## REVIEW-06: Each saved decision and each Undo builds and returns the complete model again

**Verdict: partly-confirmed. Severity: high. Confidence: high.**

The defect is confirmed. The statement "the stored receipt is sufficient" is correct for a save and incorrect for Undo.

### 1. Hot path

- `apps/web/src/review/client.ts:313-318`: the page always sends `queued: true`. So each Approve and each Reject uses the queue and then reads the receipt.
- `client.ts:326-336`: after the `202`, the page waits 500 ms and calls `GET /api/commands/<id>/queued`.
- `apps/web/src/api/review.ts:812-832`:

  ```ts
  if (task.state === "complete" || task.state === "dead") {
    // Other decisions can finish before the browser reads this receipt.
    const model = await reviewModel(context, run.id);
    // A review committed during model construction requires another poll.
    if ((await context.service.run(run.id)).revision === model.comparisonRevision) {
      ...
      return Response.json({ ...result, model });
    }
  }
  return Response.json({ queued: true, commandId: input.commandId }, { status: 202 });
  ```

- Undo: `review.ts:938-939` calls `commandResult`, and `review.ts:637-639` is `Response.json({ ...result, model: await reviewModel(context, runId) })`.

Frequency: one complete model for each decision, at minimum. One for each Undo.

### 2. Magnitude

Measured (my probe, 3,582 captures; handler work only, the 6 prelude round trips are not included):

```text
receipt as coded          19 D1 round trips, 2 R2 gets, 2,153,615 bytes (205,256 gzip)
receipt without a model    3 D1 round trips, 0 R2 gets,       425 bytes
```

With the prelude: 25 round trips against 9.

Production, by inference: the receipt builds the same model as the run page, so its server wait is about the same 5.25 to 5.68 s, plus 692 KB and 5 to 6 MB of JSON to parse on the main thread. This happens for **each decision**. No production measurement of a save exists.

Two effects that the finding does not state:

1. **Discard loop.** If one more decision commits while the model is built, line 816 is false, the model is discarded, and the answer is `202`. The page waits 500 ms and the server builds the model again. A model build takes about 5 s in production. A reviewer who decides faster than one decision each 5 s keeps the earlier receipts in this loop. "Saved" appears only after a pause. Each discarded build repeats the two R2 reads. This is an inference from the code and the measured model time. It is not measured in production.
2. **Concurrent builds.** Admission is serialized, but each receipt poll runs independently (`client.ts:307-336`). Several model builds can run at the same time in one isolate. One build holds about 16 MB at its end in Node (`second-lens-heap.json`), with a higher peak. The isolate limit is 128 MB for all concurrent requests. The risk is not measured in workerd.

What the user sees: the page moves to the next variant immediately (`use-review-session.ts:312-317`), so the next image does not wait. The "Saved" message waits, and Undo is not available while a save is in progress (`use-review-session.ts:448`: `if (session.saving) return;`).

### 3. Fix feasibility

**Save receipts: feasible. Measured.**

- The stored receipt (`apps/web/src/operations/review-queue.ts:127`) has these keys: `baselineRevision, commandId, previousRunRevision, promotionId, reviewer, revisions, runRevision, runStatus, selection`.
- `apps/web/src/review/navigation.ts:85-142` (`applySavedReview`) uses exactly these when no model is present.
- I applied the receipt on the page model and compared the result with a new server model. They are equal, field for field, for approve, reject, and a chain of four approvals that ends with run status `passed`:

  ```text
  second-lens-3582.json   firstDecision.appliedEqualsServerModel  true   secondDecision.appliedEqualsServerModel  true
  second-lens-chain.json  steps 1 to 4  appliedEqualsServerModel  true   (step 4: receiptRunStatus "passed", serverRunStatus "passed")
  ```

- In each step, `receipt.previousRunRevision` is equal to the page's `comparisonRevision` before the decision. So the page can detect a change by a different actor with one comparison.

What can go wrong:

1. **A different reviewer.** `apps/web/src/api/api.test.ts:1272-1289` tests that a receipt shows a later decision of "other-reviewer". A receipt without a model does not show it. The stored receipt has `previousRunRevision` and `runRevision` for my decision only. To keep the behavior, the response must also carry the current run revision. The route already has it: `projectRun` at `review.ts:810` returns the run row. Sketch:

   ```ts
   // review.ts, receipt route (sketch): no model on the clean path
   return Response.json({ ...result, currentRunRevision: run.revision });

   // page (sketch): one refresh only when a different actor changed the run
   if (result.previousRunRevision !== currentModel.comparisonRevision)
     currentModel = await commands.refresh();
   // after the last queued receipt: if (currentRunRevision !== currentModel.comparisonRevision) refresh one time
   ```

   `saveResult` in `client.ts:235-252` does not read `previousRunRevision` today. It must be added.

2. **Tests.** `api.test.ts:1253-1320` asserts `toHaveProperty("model")` on a clean receipt, the `202` during a concurrent change, and the stable model. It must be rewritten. `api.test.ts:1912-1943` tests the conflict receipt with a model. It stays valid if conflict receipts keep the model. On the page side, a browser test already answers `/queued` with a receipt that has no model, and the page applies it (`review/__tests__/route.browser.test.ts:47-58`: `commandId, selection, revisions, baselineRevision, promotionId, runRevision, reviewer, runStatus`).
3. **Conflict and error receipts** (`review.ts:817-830`) must keep the model. The page needs fresh evidence after a conflict.
4. **Promotion after the last approval** changes fields that a receipt does not carry (`archived`, the disabled reasons). This is the same today when promotion happens after the receipt is read. The next write returns a conflict with a model.

**Undo: the receipt is not sufficient.** Measured: the Undo result has only `baselineRevision, commandId, promotionId, revisions, selection` (`second-lens-3582.json`, `undoResultKeys`). It has no restored verdict, no reviewer, no `runRevision`, and no `runStatus` (`packages/service/src/review-commands.ts:377-383`). `applySavedReview` sets `verdict: command.verdict`, so it cannot restore an earlier verdict. Undo needs a new small response (the restored rows, the run revision, the run status), or it keeps the complete model. Undo is rare, so to keep the model there is a reasonable option.

Platform: nothing new is necessary. No API, binding, or limit is involved.

Contract: no security rule changes. The receipt stays private to the actor (`review.ts:806-808`). `docs/current-contract.md:192` ("Only server-confirmed decisions count as saved") holds, because a completed task with a stored result is the server confirmation. `docs/current-contract.md:196` and D08/D09 (`:53`) require the page to keep "multiple rapid decisions, pending overlays, newer route-model handling, Retry, Undo, focus, and navigation". The change is in that code, so those browser tests are the gate. The contract does not require the model in the receipt.

### 4. Strongest counter-argument

The model in the receipt is deliberate ("Other decisions can finish before the browser reads this receipt"). It makes the page correct after each decision with no merge logic, for each case: a second reviewer, a status change, a promotion. The save does not block the reviewer, because the page already shows the next variant. W09 made this client code stable only a few days ago (`docs/current-contract.md:198`). If REVIEW-04 and the D1 findings make the model cheap (a few hundred ms), the simple design costs little and the risk of a wrong page state is zero. By this argument, the receipt change has value only if a save is still slow after the model is cheap. The maintainer decides.

### Corrections to the finding

- "the stored receipt is sufficient" is not correct for Undo.
- "23 and 30 D1 round trips" come from a fixture with no inventory. For an inventory-backed run the receipt is 25 round trips and 2 R2 reads (6 + 19). By count from the code, Undo is about 32 round trips, 2 R2 reads, and one live GitHub permission request. I did not measure Undo.
- The light save response that the server already has (`review.ts:879-904`) cannot be reached from the page. The first verifier said this too.

---

## REVIEW-08: Each first view of an image goes through the Worker, D1, and R2 with no edge cache

**Verdict: partly-confirmed. Severity: medium. Confidence: high for the path, low for the R2 time.**

The path and the missing cache are confirmed. The implied fix (an edge cache) does not help a first view.

### 1. Hot path

- `apps/web/src/server.ts:106-116` sends `/images/*` to `handleApi`. `apps/web/src/api/index.ts:113-116` calls `publicImage` before the project check and before `createAuth`. So an image request has no session work and no schema check.
- `apps/web/src/api/images.ts:24-28`: one D1 read. `images.ts:39-40`: one R2 `get` (or `head` for `HEAD` and a matching `If-None-Match`). `images.ts:52`: `"Cache-Control": "public, max-age=31536000, immutable"`.
- No Cache API call exists. My search `rg "caches\.|cache\.put|cache\.match"` in `apps/web/src` and `packages` returns nothing.
- Workers run before the cache, so the zone cache never sees these responses (see Platform facts).
- `apps/web/src/review/use-evidence.ts:76-114` and `review-workspace.tsx:302-307`: Approve and Reject are disabled until the reference and the candidate are loaded and decoded.

Frequency: one request for each image that the browser does not have. For a variant that needs review that is 2 images, in parallel, plus 1 when the diff view is opened. A reference image that the reviewer saw in an earlier run comes from the browser cache.

### 2. Magnitude

- D1 lookup: 0.133 s (measured, see the table at the top).
- R2 read: **not measured.** The bucket location is not known (reading it needs a remote command). R2 has no South America location, so the read leaves the continent for a Worker at GRU.
- Total for a new variant: at minimum 0.16 s to the first byte of the 404-equivalent path, plus the R2 read, the download, and the decode. The two images load in parallel, so the wait is the slower one, not the sum.
- Cost in money: one Worker request, one D1 row read, and one R2 class B operation for each image. Negligible at this traffic.

### 3. Fix feasibility

**Cache API: the platform permits it. The gain is small.**

- Production uses a custom domain (`wrangler.jsonc:49`), so `caches.default` works.
- The response is cacheable: `public, max-age=31536000`, no `Set-Cookie`, status 200. `cache.match` honors `If-None-Match` and `Range`.
- `publicImage` does not receive `waitUntil` today. `handleApi` has it (`index.ts:89-92`) and must pass it. Unit tests run in Node, where `caches` does not exist, so the cache must be an injected dependency like `ObjectStorage`.

  ```ts
  // sketch
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = new Response(stored.body, { headers });
  lifetime.waitUntil(cache.put(request, response.clone()));
  return response;
  ```

- But "Cache API is local to a data center" and "not compatible with tiered caching". The first view by a reviewer is always a miss. A later view by the same reviewer already comes from the browser cache. The only hit is a second person at the same data center, or the same person with a new browser profile. This service has few reviewers.

What can go wrong, and the contract:

- Byte expiry. When `bytes_present` is 0, the handler answers 404 (`images.ts:40-41`). An edge copy still answers 200. `cache.delete` "only purges content of the cache in the data center that the Worker was invoked", so the Worker cannot purge all copies. The decision record for P06 (`docs/current-contract.md:152`) lists this risk for the origin: "Returning 304 from the D1 row alone could hide an object removed from R2." A shorter edge lifetime (`s-maxage`) limits it. The browser cache has the same effect for one year today.
- D16 (`docs/current-contract.md:59`): "Keep public validated image bytes and private metadata... A URL is not authorization; access revocation cannot recall copied pixels." So an edge copy does not break an access rule. It is a retention decision, and the maintainer makes it.
- A public R2 domain with the zone cache is **not** an option. The `IMAGES` bucket also holds the private inventories (`runs/<id>/inventory/<digest>`, read through `context.images` in `apps/web/src/inventory-records.ts:55`). D16 keeps that metadata private.

Options that change the first view:

| Option                                                         | Effect                                                                      | Note                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Preload the two images of the next pending variant (REVIEW-09) | The wait overlaps the time that the reviewer looks at the current variant.  | CSP permits it. It is new optional work, so P02 and U06 apply.                        |
| Move the Worker near D1 and R2 (REVIEW-02)                     | The D1 trip and the R2 read become short. One long hop from the user stays. | About neutral for an image alone. Large for API requests.                             |
| Remove the D1 lookup                                           | Saves 0.133 s for each image.                                               | Needs a storage layout in which the object key comes from the image ID. Large change. |

### 4. Strongest counter-argument

The current design is the result of an approved decision (P06: stream from R2, "without adding a cache service", "No new bucket or database") and it is correct and simple. The cost is about 0.13 s plus one R2 read, one time for each image and browser. `immutable` already removes all repeat cost. An edge cache adds a retention question and gives almost no hits for one or two reviewers. A preload removes the visible wait with three lines and no new infrastructure.

### Corrections to the finding

- "154 ms TTFB in production" is the complete time to first byte of a 404 for an unknown ID. The D1 part is about 0.13 s. No real first view of an image was measured, by any lane.
- "`immutable` helps only one browser" is true, but one browser is the normal case here.
- Severity: medium, not high. The same as the first verifier.

---

## AUTH-01: Better Auth checks the full database schema on each request

**Verdict: confirmed. Severity: high. Confidence: high.**

### 1. Hot path

- `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });`. This runs for each `/api/*` and `/v1/*` request that is not an image or a webhook. `apps/web/src/server.ts:85` and `:93` do the same for `/api/auth/*` and `/api/me`.
- `packages/security/src/auth.ts:47-51`: `advanced` has no `database` key. A search for `validateSchema` in `apps` and `packages` returns nothing.
- Installed `@better-auth/core` 1.7.5, `dist/db/schema-check.mjs:7-9`:

  ```js
  function checksSchema(options) {
    return options.advanced?.database?.validateSchema !== false;
  }
  ```

- `@better-auth/kysely-adapter` 1.7.5, `dist/index.mjs:712`: each adapter instance registers a new check. `schema-check.mjs:57-59`: `clean` and `verdict` are closure variables of that instance. The `WeakMap` keyed by the database holds only a revision counter.
- `better-auth` 1.7.5, `dist/api/to-auth-endpoints.mjs:41-42`: `auth.api.getSession` awaits the check. `dist/api/index.mjs:169-170`: `auth.handler` awaits it too. `dist/auth/base.mjs:15`: creation starts it and does not await it, so `/v1/*` ingest requests run it in the background.
- `dist/d1-sqlite-dialect-*.mjs:88-98`: one `sqlite_master` query, then `this.#d1.batch(statements)` with one `pragma_table_info` for each table.
- `packages/security/src/authorization.ts:32-36`: `requireMaintainer` calls `auth.api.getSession` first.

Frequency for each page (from the code and from `audit/live-authenticated.md`):

| Page or action    | Private requests                        | Schema checks awaited |
| ----------------- | --------------------------------------- | --------------------- |
| Dashboard         | `/api/runs`, then `/api/operations`     | 2, in sequence        |
| Run page          | `/api/runs/<id>`                        | 1                     |
| Pull-request link | `/api/pulls/<n>`, then `/api/runs/<id>` | 2, in sequence        |
| One decision      | admission, then one receipt or more     | 2 or more             |
| Dashboard open    | `/api/operations` each 60 s             | 1 for each poll       |

### 2. Magnitude

**Measured in production: about 0.33 s for each request** (0.3566 s for the signed-out `/api/runs`, which does only the two check round trips, minus 0.0228 s for `/health`). Six samples, range 0.349 to 0.368 s.

Why the signed-out `/api/runs` is only the check: `index.ts:123-126` skips the project read for this path, `auth.api.getSession` awaits the check, and a request with no cookie then gets `sign_in_required` with no session query (first verifier's local count: 2 round trips, 76 statements).

Why this number applies to a signed-in request: the check is awaited before the session lookup, so the same two round trips are at the start of each private request.

- Dashboard: about 0.67 s of the measured 2.6 to 3.7 s.
- Run page: about 0.33 s of about 7 s.
- One decision: about 0.67 s or more.
- D1 billing: 856 rows read for each request (auth lane, local workerd). On Workers Paid this is negligible. On Workers Free (5 million rows each day) it would be the limit at about 5,800 requests each day.

Uncertainty: one location (GRU). The 0.167 s for each of these two trips is higher than the 0.133 s of a one-row read, probably because the batch returns about 85 KB. A cold isolate and a warm isolate pay the same, because the result is never kept.

### 3. Fix feasibility

**Option A: disable the runtime check. The option exists in the installed version.**

- Type: `@better-auth/core/dist/types/init-options.d.mts:390-400`: "Set `false` to disable runtime schema validation. `@default true`".
- With `false`, `index.mjs:712` does not register a check, `ctx.checkSchema` is `undefined`, and all three call sites are no-ops.
- The auth lane measured the effect: `getSession` goes from 4 round trips and 78 statements to 2 round trips and 2 statements.
- Better Auth says the same: "Set `advanced.database.validateSchema` to `false` to disable runtime checks" and "Validation is enabled by default, including in production, and caches a clean result or mismatch per adapter instance." (https://better-auth.com/docs/concepts/database). The cache is for one instance, and this app makes one instance for each request.
- Upstream issue https://github.com/better-auth/better-auth/issues/11346 ("1.7.3+: runtime schema validation breaks every request on Cloudflare D1") says the check was added in 1.7.3 and gives the same workaround. The fix (PR 11366) merged on 2026-09-23. So this check is new, it runs on each request for per-request instances, and it made each auth request fail for a D1 user of the external `kysely-d1` dialect. Visonaut passes the D1 binding directly and uses the built-in dialect, which works (the production requests above answer 401, not 503).

What can go wrong:

- A Better Auth upgrade that changes the schema is found later. Today all private requests fail with a clear logged message. After the change, only the queries that touch the changed column fail, with a raw SQL error.
- **The test suite loses its guard, unless a test keeps the check on.** This corrects the first verifier, who wrote that no test compares the migrations with the Better Auth schema. `packages/security/test/auth-d1.test.ts:9-31` uses the real `createAuth` on Miniflare D1 with all migrations applied, and `:55` calls `auth.api.getSession`. That call awaits the check and fails when the schema does not match. So CI checks the schema today, implicitly. Measured with the same setup (`second-lens-3/auth-schema.json`, real `createAuth`, Miniflare D1, all migrations):

  ```text
  matching schema                          getSession resolves null
  after ALTER TABLE "session" DROP COLUMN "userAgent"
                                           getSession rejects: BetterAuthError
                                           "Database schema mismatch ... Missing columns session.userAgent"
  ```

  If `validateSchema: false` is hard-coded, this stops. Keep it as a parameter:

  ```ts
  // packages/security/src/auth.ts (sketch)
  advanced: {
    cookiePrefix: `visonaut-${configuration.environment}`,
    useSecureCookies: configuration.environment !== "local",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    // A new instance for each request would read all table definitions each time.
    database: { validateSchema: configuration.validateSchema ?? false },
  },

  // packages/security/test/auth-d1.test.ts (sketch)
  it("matches the Better Auth schema", async () => {
    const auth = createAuth({ ...configuration, validateSchema: true });
    await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
  });
  ```

**Option B: check one time for each isolate.** Feasible. The package already keeps isolate state keyed by the D1 binding: `packages/security/src/authorization.ts:19` is `new WeakMap<D1Database, Map<string, PrivatePermission>>()`, and the permission cache works, so the binding object is the same for each request of an isolate. A `WeakSet<D1Database>` holds no I/O object, so it does not break the rule at `auth.ts:15` ("Create inside each request so a D1 binding cannot cross request ownership").

```ts
// sketch
const validated = new WeakSet<D1Database>();
const validate = !validated.has(configuration.database);
const auth = betterAuth({ ..., advanced: { ..., database: { validateSchema: validate } } });
if (validate) {
  void auth.$context
    .then((context) => context.checkSchema?.())
    .then(() => validated.add(configuration.database), () => {});
}
```

`checkSchema` is a typed field of the auth context in the installed version (`@better-auth/core/dist/types/context.d.mts:270-276`: "Shared by initialization and requests for this adapter instance; returns nothing once the schema is known to be clean... Absent when the check is disabled"). A second call shares the pending promise, so the sketch adds no query. I did not run this sketch.

Option B keeps a runtime guard and costs 0.33 s on the first request of each isolate. How frequently an isolate is new is not known.

Contract: no rule in `docs/current-contract.md` names the schema check. `:186` ("Live session and linked-account checks still run for every request") is not affected: the session query and the account query stay. `packages/security/README.md:5` ("Construct Better Auth inside each production Worker request") is not affected by option A or option B.

### 4. Strongest counter-argument

The migration `0003_auth.sql` is maintained by hand for an exact Better Auth version. The runtime check is the only guard that runs against the real production database, where a migration can be missing although the tests pass. Option A removes that guard. Also, the cost is latency, not work: with the Worker near D1 (REVIEW-02) the two round trips cost a few milliseconds, and the guard can stay. If the maintainer changes the placement first, AUTH-01 has a small gain.

My assessment of that argument: the placement result is not sure (`INSUFFICIENT_INVOCATIONS` is possible, and the page does not name D1), and the placement adds one long hop to each request. Option A is one line with a measured 0.33 s, and option B keeps the production guard. The two changes do not conflict.

### Corrections to the finding

- "about 85 KB" and "856 rows" are local numbers. They are consistent with production timing, but they are not production numbers.
- "validateSchema:false cuts getSession from 4 round trips to 2" is correct. In production terms the two removed trips are 0.33 s (measured).
- The recommendation must include the test, or the implicit CI guard disappears.

---

## Missed (from this lens)

1. **Receipt discard loop.** `review.ts:814-835` discards a built model when one more decision commits during the build, and the page asks again after 500 ms. With a 5 s model build, fast decisions keep earlier receipts unconfirmed until the reviewer pauses. Each discarded build repeats 2 R2 reads. Inference from code plus the measured model time.
2. **Changed rows have no reference capture in D1.** `packages/service/src/local-comparison.ts:327` writes `NULL` for `reference_capture_id`, and `visonaut_images` has no index on `digest` (`EXPLAIN QUERY PLAN`: `SCAN visonaut_images`). Each summary or attention endpoint needs the baseline inventory from R2, or a data change at Submit. Measured: 0 of 4 reference images are in the D1 result.
3. **The test suite checks the auth schema implicitly.** `packages/security/test/auth-d1.test.ts` uses the real `createAuth` with the default validation on Miniflare D1. AUTH-01 option A removes this unless a test keeps validation on.
4. **Private inventories and public images are in one bucket.** `runs/<id>/inventory/<digest>` objects are in `IMAGES`. So an R2 public domain with the zone cache is not available for images without a second bucket (D16).
5. **P01 has a reopen clause with no budget.** The clause names "the selected budget". `docs/development.md:70-72` says that no budget exists. The maintainer must set one or decide directly.
6. **Concurrent complete-model builds use one 128 MB isolate.** One build holds about 16 MB at its end in Node for a 3,582-capture run. Each decision starts one build, and they can overlap. Not measured in workerd.
7. **The stored receipt already has `previousRunRevision`, and the page ignores it.** `client.ts:235-252` does not parse it. It is the field that lets the page detect a change by a different actor without a model.
