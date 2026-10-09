# Verification: Run review and pull-request page load path

Verifier: adversarial pass, 2026-10-05. Read-only. Repository commit `f83fef6`.

## Read this first

**The audited report does not exist.** `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/review-load/report.md` is not on disk (`ls` shows only probes, raw measurements, and screenshots in that directory). The auditor returned a findings index (15 IDs and titles) but did not write the report.

So this verification has these limits:

- I checked each finding **by its title**, against the code, against the auditor's raw artifacts, and against new measurements that I made.
- I could **not** check the auditor's quoted excerpts, line citations, or recommendation text. They are not available.
- Where a recommendation matters, I list the options that I checked for feasibility. The maintainer decides.

Auditor artifacts that I used as raw evidence (not as proof):

- `review-load/probe/api-path.cost.ts` and `api-path.json` (real `handleApi`, native Miniflare D1 and R2, local GitHub responder).
- `review-load/probe/inventory-scale.cost.ts` and `inventory-scale.json` (`reviewModel` on inventory-backed runs).
- `review-load/routes/measurements.json` (built Worker, Chrome, `apps/web/tooling/review-scale/local-routes.mjs`).
- `review-load/production-timing-clean.txt`, `production-run-shell.html`, `production-run-shell.headers`, `screens/*.png`.
- `audit/live-authenticated.md` (the orchestrator's signed-in production measurements).

My own measurements (all files in `review-load/verify/`):

| File                        | What it is                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `production-timing.txt`     | 21 signed-out production requests on one connection (`curl -w`).                                                         |
| `api-path-verify.json`      | Re-run of the HTTP path probe, plus signed-out requests.                                                                 |
| `inventory-depth-3582.json` | `reviewModel` on a 3,582-capture inventory run: counts, duplicates, sequential depth with an injected delay, time split. |
| `ui-checks.json`            | Chrome against `127.0.0.1:4310`: main navigation reload, viewer movement, document text.                                 |
| `pending-threshold.json`    | Chrome against `127.0.0.1:4310`: time until the pending text appears after a client navigation.                          |

Key numbers that several findings use:

```text
# verify/production-timing.txt (ttfb, warm connection, 4 samples each)
/health                       0.024 0.028 0.027 0.027   no D1
/images/<unknown uuid>  404   0.152 0.151 0.269 0.157   1 D1 round trip
/api/runs               401   0.376 0.332 0.721 0.338   2 D1 round trips
/api/operations         401   0.482 0.511 0.497 0.420   3 D1 round trips
/api/runs/<uuid>        401   0.436 0.576 0.524 0.446   3 D1 round trips
```

The round-trip counts come from `verify/api-path-verify.json` (same code, native D1):

```text
signed out GET /api/runs        tripsAtResponse=2 statements=76 rowsRead=856
signed out GET /api/operations  tripsAtResponse=3 statements=77
signed out GET /api/runs/<id>   tripsAtResponse=3 statements=77
```

Per-trip cost by subtraction: (0.152 - 0.027) = 125 ms, (0.335 - 0.027) / 2 = 154 ms, (0.49 - 0.027) / 3 = 154 ms. Outliers: 269 ms and 721 ms.

---

## REVIEW-01: better-auth checks the database schema on each private API request

**Verdict: confirmed. Severity: high.**

Proof:

- `packages/security/src/auth.ts:15-21`: `/** Create inside each request so a D1 binding cannot cross request ownership. */` then `return betterAuth({ ... database: configuration.database, ...`. No `advanced.database.validateSchema` key (`auth.ts:47-51` lists `cookiePrefix`, `useSecureCookies`, `defaultCookieAttributes` only).
- `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });` runs for each non-image, non-webhook request. `apps/web/src/server.ts:85` and `:93` do the same for `/api/auth/*` and `/api/me`.
- Installed better-auth 1.7.5, `@better-auth/core/dist/db/schema-check.mjs:7-9`: `return options.advanced?.database?.validateSchema !== false;` with the comment "Enabled in every environment unless explicitly disabled."
- `@better-auth/kysely-adapter/dist/index.mjs:712`: each adapter instance registers a new check: `registerSchemaCheck(instance, createSchemaCheck(() => findSchemaProblems(...)))`. The `clean` flag is a closure variable of that instance (`schema-check.mjs:58-78`), so a new `betterAuth()` call starts with `clean = false`.
- `better-auth/dist/api/to-auth-endpoints.mjs:41-42`: `const pendingSchemaCheck = rawContext.checkSchema?.(); if (pendingSchemaCheck) await pendingSchemaCheck;`. The endpoint **awaits** the check before it reads the session.
- `@better-auth/kysely-adapter/dist/d1-sqlite-dialect-*.mjs` `getTables()`: one `sqlite_master` query, then `this.#d1.batch(statements)` with one `pragma_table_info` for each table.
- Measurement (`verify/api-path-verify.json`): each request shows trips `select "name", "type", "sql" from "sqlite_master" ...` then `batch[75] SELECT * FROM pragma_table_info(?)`. This repeats in the same isolate ("signed in: open run, same isolate" has the same two trips). 76 statements and about 856 rows read for each request.
- Production: signed-out `GET /api/runs` does only these two trips and takes 332 to 376 ms (see table above), against 24 to 28 ms for `/health`.

Corrections to the finding text:

- The check also runs for **signed-out** requests, for `/api/auth/*`, and for `/api/me`. It is not only "private API requests". For a signed-out visitor the two trips are the complete cost of the 401.
- The per-request construction is deliberate (`packages/security/README.md`: "Construct Better Auth inside each production Worker request."). The repeated check is a side effect of that rule plus a better-auth default.
- The public better-auth options page says the default is "`true` outside production". The installed 1.7.5 code does not look at the environment. The installed type documentation says `@default true` (`@better-auth/core/dist/types/init-options.d.mts:390-400`). Trust the installed code.

Options (both feasible):

```ts
// Option A: one line. Loses the runtime guard against schema drift.
advanced: { ..., database: { validateSchema: false } },

// Option B: validate one time for each isolate and database, then skip.
const validated = new WeakSet<D1Database>();
// createAuth({ validateSchema: !validated.has(database) }) and add after the first good request
```

Fact for option B: `env.DB` is the same object for each request in one workerd isolate (run of `audit/load/env-identity.mjs`: request 2 and 3 print `"sameDatabaseBinding":true,"weakMapHit":true`).

## REVIEW-02: The Worker runs near the user while each D1 round trip costs about 125 to 165 ms

**Verdict: confirmed. Severity: high.**

Proof:

- `apps/web/wrangler.jsonc:1-125` has no `placement` key. Production responses have `cf-ray: ...-GRU` and no `cf-placement` header (my `curl -D -` of `/api/runs`, `/images/<id>`, and `/runs/<id>`).
- My production timing gives 125 to 154 ms for each trip (table above). The auditor's file gives the same range. The trip counts are verified, not assumed.
- The same per-trip cost is consistent with the signed-in numbers in `audit/live-authenticated.md`: `/api/runs` (dashboard) has 5 prelude trips (about 0.7 s by count) plus the dashboard queries, and its measured server wait is 0.87 to 1.08 s. This is an inference, not a trace.

Corrections and limits:

- The number is derived by subtraction. No trace of a single D1 call exists. The Worker has `observability.traces.enabled: true` (`wrangler.jsonc:15-20`), so the maintainer can read the real spans.
- The D1 region is **not verified**. `wrangler d1 info` is a remote command, which this audit must not run.
- Platform fact that the finding should state: D1 location hints are `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc` only (https://developers.cloudflare.com/d1/configuration/data-location/). There is no South America location. A Worker that runs at GRU cannot have a near D1 primary, and read replicas are in the same regions. The only two levers are: move the Worker, or decrease the number of round trips.

Feasibility of "move the Worker" (https://developers.cloudflare.com/workers/configuration/placement/):

- `"placement": { "mode": "smart" }` exists. The page does not name D1. It reports the status `INSUFFICIENT_INVOCATIONS` when "the Worker has not received enough requests from multiple locations". This app has few users in few locations, so Smart Placement can stay inactive. Treat the result as unknown until the status is read.
- The same page documents explicit hints, for example `"placement": { "region": "aws:us-east-1" }`. This is deterministic but needs the D1 region first.
- "Static assets are always served from the location nearest to the incoming request", so placement does not slow the JavaScript and CSS.
- Placement adds one long hop between the user and the Worker to each dynamic request, including each image and each document. For a request with 15 sequential D1 trips this is a large net gain. For `/health` or a cached image it is a small loss.

## REVIEW-03: The run model reads the same rows again and awaits 15 round trips in sequence

**Verdict: partly-confirmed. Severity: high.**

Confirmed:

- Duplicate reads inside one `reviewModel` call (`verify/inventory-depth-3582.json`, `repeatedStatements`): `SELECT * FROM visonaut_runs WHERE id = ?` 2 times, `SELECT * FROM visonaut_projects WHERE id = ?` 2 times, `SELECT * FROM visonaut_comparisons WHERE id = ?` 2 times.
- Sources: `apps/web/src/api/review.ts:89-90` (`projectRun` reads the run), `review.ts:292-306` (`service.project`, `service.status`, `service.comparison` in one `Promise.all`), `packages/service/src/run-status.ts:27,45,61` (`readRunStatus` reads the run, the comparison, and the project again). `apps/web/src/api/index.ts:125` reads the project a third time before auth. `apps/web/src/inventory-records.ts:45-49` reads the run row a third time for the inventory pointer.
- 15 D1 round trips for `reviewModel` on an inventory-backed run with a current promotion. Re-measured: `"d1RoundTrips": 15, "r2Gets": 2`.

Correction: the 15 trips are **not all in sequence**.

- `review.ts:276` and `review.ts:323` each start four branches with `Promise.all`.
- I injected a fixed delay into each D1 trip and each R2 `get` and divided the added time by the delay: `"sequentialIoSteps": { "delay20": 13.12, "delay40": 11.69 }`. The expected chain from the code is 11: run (1), status chain (6: run, comparison, dead tasks, counts, project, promotion), inventory chain (4: run pointer, R2, snapshot header, R2).
- For the complete HTTP request the numbers are: 21 D1 trips in total, of which 15 are in sequence (6 prelude: project, 2 schema, session, user, account; then 9 in the model), plus 2 sequential R2 reads. So "15 in sequence" is true only for the complete request, not for the model alone.

```text
# verify/inventory-depth-3582.json, order of I/O in reviewModel
 1 run                       7 dead tasks        13 eligible approvals
 2 batch[3] metadata         8 counts            14 run inventory pointer
 3 project                   9 project (again)   15 r2.get run inventory
 4 run (again)              10 promotion         16 snapshot inventory header
 5 comparison               11 comparison rows   17 r2.get baseline inventory
 6 comparison (again)       12 batch[5] metadata
```

Feasibility note: `database.batch([...])` is one round trip, and the code already uses it (`review.ts:277`, `:335`). The run, project, and comparison rows that `reviewModel` already holds can be passed to the status function. Neither change conflicts with the contract.

## REVIEW-04: Each model read downloads, hashes, and validates two complete inventories from R2

**Verdict: confirmed. Severity: high.**

Proof:

- `apps/web/src/api/review.ts:364`: `run.inventory_key ? readReviewInventory(context, run.id) : null`.
- `apps/web/src/api/review-inventory.ts:44-48`: `readRunInventory`, then `await readSnapshotInventory(context, inventory.referenceSnapshotId)`. Two reads, one after the other.
- `apps/web/src/capture-inventory.ts:492-517`: reads all bytes, `(await sha256(bytes)) !== pointer.digest`, `JSON.parse(encoded)`, then `canonicalJson(parsed) !== encoded` (a second full serialization).
- `capture-inventory.ts:553`: `validatedInventory(expandInventory(document))`, which runs the profile digests and `validateReceipt` for each capture (`capture-inventory.ts:396-450`, `:215-283`).
- No cache: `rg "readReviewInventory|readCaptureInventory\("` finds no memo or map on the review path.
- Re-measured for 3,582 captures: `"r2Gets": 2`, inventories 5,993,161 + 3,391,523 bytes, `"readReviewInventoryMsMedian": 128` of `"reviewModelMsMedian": 168`. The inventory work is about 76% of the model time (Node 24 on an Apple M4 Pro, memory store, not Workers CPU time).

Corrections and limits:

- The read is partly deliberate. `docs/current-contract.md:26`: "Review reads the full inventory to show unchanged items." The contract does not require the service to hash and validate the object again on each read.
- No production number exists for this step. The 5.3 to 5.7 s server wait in `audit/live-authenticated.md` minus about 2.1 s of sequential D1 trips leaves about 3 s for the two R2 downloads, validation, model build, and JSON output. That split is an estimate, not a measurement.
- A per-isolate cache of parsed inventories has a memory risk. `capture-inventory.ts:55-56` says "Leave room for the decoded JSON and capture graph in a 128 MiB Worker" and permits 16 MiB for each object. A smaller review projection written at materialization time does not have this risk.
- The model is built again for each saved decision and Undo (REVIEW-06), so the two downloads repeat for each decision.

## REVIEW-05: The first response contains each unchanged capture, although the page needs only the changed ones first

**Verdict: partly-confirmed. Severity: high.**

Confirmed:

- `apps/web/src/api/review.ts:371-374`: `completeReviewRows(inventory, storedRows, comparison.id)`. `apps/web/src/api/review-inventory.ts:105-163` adds one `unchanged` row for each inventory capture that has no stored row.
- Re-measured: 3,582 variants in the model, 3,578 unchanged, 4 that need review, 2,153,156 bytes of JSON (205,102 bytes gzip).
- Production (`audit/live-authenticated.md`): 5.3 to 6.0 MB decoded, about 692 KB transferred, for 3,832 variants.
- The Accepted group is closed at first unless the selected item is in it: `apps/web/src/review/item-list.tsx:105-107`.

Corrections:

- This is an approved decision, not an oversight. `docs/current-contract.md:148`: "P01 | One compact complete model". The decision record (`docs/simplification-audit/audit-data.json`, `P01`) rejected "Summary plus selected evidence" and states when to reopen: "A route measurement shows that complete-model reads or parse time exceed the selected budget after compression and simple query cleanup". The production numbers are that measurement. The finding must name P01 and its reopen clause. A change needs a new decision from the maintainer.
- "The page needs only the changed ones first" is not always true. The sidebar count `Accepted (N)`, the search filter, and the keyboard order use all items. When the selection is in the Accepted group, the group opens at once. The three production samples were runs with all 626 items in "Accepted (626)".
- The response size is not the main measured cost. The server wait (5.3 to 5.7 s) is much larger than the transfer. The link to REVIEW-04 is the important part: the unchanged rows are the only reason to read the two inventories.

## REVIEW-06: Each saved decision and each Undo builds and returns the complete model again

**Verdict: confirmed. Severity: high.**

Proof:

- Receipt: `apps/web/src/api/review.ts:812-832`: `const model = await reviewModel(context, run.id);` then `return Response.json({ ...result, model });`.
- Undo: `review.ts:938-939` calls `commandResult`, and `review.ts:637-639` is `Response.json({ ...result, model: await reviewModel(context, runId) })`.
- Client: `apps/web/src/review/client.ts:250`: `model: data.model == null ? undefined : parseReviewModel(data.model)`.
- Auditor probe (`probe/api-path.json`): receipt 3,420 bytes against a 3,028-byte model, 23 D1 trips. Undo 3,336 bytes, 30 D1 trips.

Additions:

- The server has a light response with no model for a clean save (`review.ts:881-904`). The browser never reaches it, because `client.ts:313-318` always sends `queued: true`. Each decision takes the queued path and gets the complete model.
- `review.ts:816`: after the model is built, the run is read again. If the revision changed, the model is discarded and the response is a 202. The browser then waits 500 ms and the server builds the model again.
- The contract keeps the queue and the receipt (`docs/current-contract.md:196`). It does not require the complete model in the receipt.

## REVIEW-07: Save confirmation has a fixed 500 ms wait, a late session request, and a permission cache that write requests clear

**Verdict: confirmed. Severity: medium.**

Proof:

- Fixed wait: `apps/web/src/review/client.ts:326-328`: `while (result.queued === true) { ... await new Promise((resolve) => setTimeout(resolve, 500));`. The wait comes before the first receipt read. In `routes/measurements.json` the gap between the end of the admission POST and the start of the app's receipt GET is 501.4 ms, 501.7 ms, and 502.2 ms. (The earlier receipt GET in that file comes from the test harness: `apps/web/tooling/review-scale/run-routes.mjs:80`.)
- Late session: `client.ts:295-303` and `:310`. `POST /api/review-sessions` is sent on the first save, before the admission POST. In the measurements it adds one sequential request (7 D1 trips and 1 GitHub call in `probe/api-path.json`).
- Cache cleared by writes: `packages/security/src/authorization.ts:63` skips the cache for `access === "write"`, `:71` runs `permissions.delete(key);`, and `:74` stores the new grant only `if (access !== "write")`. Probe: after `POST /api/review-sessions` the next admission calls GitHub again, and "open run right after a write request" calls GitHub again.

Corrections and limits:

- The local numbers (0.88 to 0.98 s to confirmation) have almost no D1 latency. No production number exists. By count, one decision is at least 11 trips (admission) plus 500 ms plus 23 trips (receipt with the model).
- The page moves to the next variant before the confirmation (`docs/current-contract.md:192`). The wait delays the "Saved" message, not the next image.
- The contract requires a live check for writes (`docs/current-contract.md:186`, `:204`). It does not require a successful write to remove the read grant. `packages/security/README.md` says only: "A failed live check removes the cached grant". The tests in `packages/security/test/auth-d1.test.ts:225-273` and `:324-373` do not assert the removal after a successful write. To store the fresh positive result after a successful write is compatible with both. This is a security rule, so the maintainer decides.

## REVIEW-08: Each first view of an image goes through the Worker, D1, and R2 with no edge cache

**Verdict: confirmed. Severity: medium (the auditor said high).**

Proof:

- `apps/web/src/api/images.ts:24-28`: one D1 read, `SELECT id, object_key, content_type, digest, bytes_present FROM visonaut_images WHERE id = ? AND validated = 1`. `images.ts:39-40`: one R2 `get` (or `head` for a 304). `images.ts:52`: `"Cache-Control": "public, max-age=31536000, immutable"`.
- No Cache API in the app: `rg "caches\.|cache\.put|cache\.match" apps/web/src packages` returns nothing.
- The generated deploy configuration serves only `../client` as assets (`apps/web/dist/server/wrangler.json`: `"assets":{"directory":"../client"}`), so `/images/*` always runs the Worker.
- Production: `/images/<unknown uuid>` takes 151 to 157 ms (one D1 trip) and has no `cf-cache-status` header. Static assets have `cf-cache-status: HIT`.

Corrections:

- No production measurement of a **real first image view** exists. The orchestrator's sample was a browser cache hit ("served from cache in about 1 ms"). The auditor's "measured" part is the local count (1 D1, 1 R2) and the 404 timing.
- An edge cache gives little for first views here. "Cache API is local to a data center" (https://developers.cloudflare.com/workers/reference/how-the-cache-works/), and the app has few viewers. The first view by the reviewer is a miss unless something fills the cache before. The browser already keeps each image for one year.
- The cost that can change is the D1 lookup for each image (about 125 to 155 ms) and the missing preload (REVIEW-09). The finding should say that.
- An edge copy also keeps bytes after the service deletes them (`bytes_present = 0`). `docs/current-contract.md:184` has rules for expired bytes. A cache needs a purge rule.

## REVIEW-09: The page does not preload the next images

**Verdict: confirmed. Severity: medium.** (The auditor marked it as not measured. That is correct.)

Proof:

- `rg "preload|prefetch|new Image\(|rel=\"pre" apps/web/src` (tests and `routeTree.gen.ts` excluded) returns nothing.
- `apps/web/src/components/screenshot-viewer.tsx:146-149`: the only evidence image is `<img key={identity} src={image.url} ...>` for the selected variant. `apps/web/src/review/item-list.tsx:233-238` has only lazy thumbnails, and they have no source in current runs (REVIEW-14).
- `apps/web/src/router.tsx` sets no `defaultPreload`.

Notes:

- CSP permits a preload: `img-src 'self' data:` (`packages/security/src/http.ts:43`).
- Related approved decisions: `P02` "Load diff when selected" removed optional image work, and `U06` says "Measure arrow-to-image display before claiming no delay." A preload of the next pending variant's two required images is new optional work. The maintainer decides.

```ts
// Smallest form: warm the browser cache for the next pending variant.
for (const image of [next.reference, next.candidate]) if (image) new Image().src = image.url;
```

## REVIEW-10: The model request can start only after all JavaScript is loaded and hydrated

**Verdict: partly-confirmed. Severity: low now (the auditor said medium).**

Confirmed:

- `apps/web/src/routes/runs.$runId.tsx:31`: `ssr: false,`. `:37-39`: the loader calls `loadReviewModel(...)`, which is a browser `fetch` (`apps/web/src/review/client.ts:254-262`).
- The server document has only the pending text. `production-run-shell.html` contains "Checking access and loading this run…" and nine `modulepreload` links. My check of the local document gives `"documentHasLoadingText": true`.
- Production (`audit/live-authenticated.md`): the model request starts 206 to 300 ms after navigation start, with warm assets.

Corrections:

- "All JavaScript" is too strong. In the auditor's own slow warm sample the model fetch starts at 483.4 ms, and three chunks end later (501.5, 508.9, 516.8 ms). The request waits for the entry chunk and the route chunk, not for each chunk.
- The cost today is 0.2 to 0.3 s of a 6.7 to 7.8 s wait, about 4%. It is 1.9 s only in the auditor's cold, throttled profile. It becomes a larger share after the server wait is fixed.
- The client-only loader is an approved decision. `docs/current-contract.md:150`: "P03 | Use the existing router loaders". The record says: "Keep this browser-oriented route client-only initially; server loading would need a separately scoped authenticated server read."

Feasibility: an inline script with the existing nonce can start the request before the modules load. `apps/web/src/routes/__root.tsx:23-26` already emits one inline script with `nonce={router.options.ssr?.nonce}`, and CSP has `connect-src 'self'`. A `<link rel="preload" as="fetch">` is a poor fit, because the loader uses `cache: "no-store"` and credentials.

## REVIEW-11: The pull-request page makes a second authenticated round trip before the run starts to load

**Verdict: confirmed. Severity: medium.**

Proof:

- `apps/web/src/routes/pulls.$pullNumber.tsx:47-58`: the page fetches `/api/pulls/<n>?check=...` in a `useEffect`, so it starts after hydration. `:80-82`: `await navigate({ to: "/runs/$runId", params: { runId }, replace: true });`. Then the run loader fetches `/api/runs/<id>`.
- Server: `apps/web/src/api/review.ts:735-784` (two D1 reads). Each request pays the complete prelude (`apps/web/src/api/index.ts:125-205`).
- Counts (`probe/api-path.json`): pull lookup 8 D1 trips and 82 statements, then the run 19 D1 trips. At about 140 ms for each trip, the lookup is about 1.1 s before the run request can start. That is a count, not a production measurement.

Additions:

- The run route chunks are not in the pull page's preload list. My `curl` of `https://visonaut.com/pulls/1?check=x` lists seven `modulepreload` links and none of them is a `runs._runId-*` file. The main run chunk (`runs._runId-QUJlDVZ1.js`, 44,074 bytes encoded in `routes/measurements.json`) loads after the lookup returns.
- After `navigate`, the pull card stays for about 1 s more before the run pending text replaces it (see Missed, item 1).
- A server answer is feasible: the Worker can resolve the check and answer `GET /pulls/<n>?check=...` with a redirect to `/runs/<id>` when the session is valid and the run is ready. The route is public today, so the signed-out page must stay.

## REVIEW-12: Hashed assets are revalidated on each load, and main navigation reloads the document

**Verdict: confirmed. Severity: low.**

Proof:

- Production headers, my `curl -sI https://visonaut.com/assets/index-MxeSnhFR.js`: `cache-control: public, max-age=0, must-revalidate`, `etag: "1353ea0a..."`, `cf-cache-status: HIT`.
- `apps/web/public/` contains only `favicon.svg`. There is no `_headers` file.
- Platform: the default for Workers static assets is "Cache-Control: public, max-age=0, must-revalidate", and a `_headers` file in the asset directory can change it (https://developers.cloudflare.com/workers/static-assets/headers/).
- Warm samples in `routes/measurements.json`: each asset has `transferSize` 300 and `encodedBodySize` 0, which is a 304.
- Main navigation: `apps/web/src/components/app-shell.tsx:15-19` and `:53-58` use `<NavLink href={href}>`, and `:29` uses `render={<a href="/" />}`. `apps/web/src/review/review-workspace.tsx:580` uses `render={<a href="/" />}` for the back button.
- My check (`verify/ui-checks.json`): a click on "Run history" gives `"documentRequestsAfterClick": ["/?view=history"], "markerSurvived": false`. A router `Link` to a run gives `[]` and `true`.

```text
# apps/web/public/_headers (feasible; Vite asset names contain a content hash)
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Notes:

- The revalidation costs one short round trip to the near edge for each file, in parallel. It is small.
- The document reload matters more on the dashboard than on this path: each view change loads `/api/runs` and then `/api/operations` again (2.6 to 3.7 s in `audit/live-authenticated.md`). That belongs to the dashboard lane.

## REVIEW-13: The waits show text only, the layout moves, and a signed-out visitor waits for a 401

**Verdict: confirmed. Severity: medium.** (The facts are confirmed. "Text only is a problem" is a design opinion.)

Proof:

- Text only: `apps/web/src/routes/runs.$runId.tsx:66-74` ("Checking access and loading this run…"), `apps/web/src/routes/pulls.$pullNumber.tsx:179-183` ("Finding this pull request’s visual review…"). Screenshots: `screens/run-1-checking-access-dark.png`, `screens/pull-1-finding-review-dark.png`, `screens/run-2-loading-images-dark.png`.
- Layout movement, measured (`verify/ui-checks.json`): the "Baseline" pane label is at 437 px while the images load and at 396 px when they are ready. `"movedPixels": 41`, one layout-shift entry of 0.0135. The cause is the status row "Loading this comparison’s images…" above the panes. It repeats for each variant whose images are not in the browser cache.
- Signed-out wait: the loader maps a 401 to the guest state (`runs.$runId.tsx:42-44`). Production `GET /api/runs/<uuid>` with no cookie takes 436 to 576 ms, after the JavaScript loads. All three D1 trips on that path are avoidable: `apps/web/src/api/index.ts:125` reads the project before auth, and the other two are the schema check (REVIEW-01).

Notes:

- The layout shift value is in the "good" range of Core Web Vitals. The movement is visible but small. Do not present it as a large shift.
- The Worker renders the document and receives the cookies. It can see that no session cookie exists and render the sign-in state with no D1 read.

## REVIEW-14: The sidebar thumbnail has no source in current runs

**Verdict: confirmed. Severity: low.**

Proof:

- The model sets a thumbnail only from `result.thumbnailImageId`: `apps/web/src/api/review.ts:505-507`.
- The only producer of `thumbnailImageId` is `apps/compare/src/process.ts:191,206,228` (and the container probe). The production entry `apps/compare/src/index.ts:1-7` imports only `./codecs.ts` and `./validate.ts`.
- The current path writes `localResult` with `outcome`, `changedPixels`, `ratio`, `engineVersion`, `codecVersion`, `maskExpected`, and an optional `maskImageId`: `apps/web/src/api/workflow-materialize.ts:345-353`. No thumbnail.
- The sidebar then shows a dash tile for each item: `apps/web/src/review/item-list.tsx:239-243`. It is visible in `screens/run-2-loading-images-dark.png`.

Note: a real thumbnail image costs one Worker, D1, and R2 request for each visible row (REVIEW-08). The finding should say that a new thumbnail source needs a cheap delivery path first.

## REVIEW-15: A cold isolate makes three GitHub calls in sequence before any data is read

**Verdict: confirmed. Severity: medium.**

Proof:

- `packages/security/src/github.ts:164-173`: the first `request` mints a token (`authorize()`, `:134-158`, `POST /app/installations/<id>/access_tokens`). `:251`: `client.request(`/user/${id}`)` when no login hint exists. `:256` then `:216-218`: the permission request.
- The caches are module state: `installationTokens` (`github.ts:102`), `loginHints` (`github.ts:193`), `privatePermissions` (`packages/security/src/authorization.ts:19`).
- Re-measured (`verify/api-path-verify.json`): cold isolate `github=["/app/installations/34/access_tokens","/user/42","/repos/fixture/repository/collaborators/fixture-maintainer/permission"]`, same isolate `github=[]`.

Corrections and limits:

- "Before any data is read" is loose. Six D1 trips come first (project, 2 schema, session, user, account). The three GitHub calls come before the **run** data.
- No production timing exists for these calls, and no data shows how often a request meets a cold isolate. Both are unknown.
- In a warm isolate, a read after more than 60 s still makes one GitHub call (`authorization.ts:21`, `:61-63`). That case is more frequent than the cold case.
- The permission call does not depend on the run data. It can run in parallel with the data reads, and the response can wait for both. The 60 s and 10 s rules in `docs/current-contract.md:186` stay as they are.

---

## Missed

Findings in this lane that the index does not show. Each has evidence, but none is a full finding.

1. **A click on a run shows no change for about 1 second.** After a client navigation the old page stays until TanStack Router's default `pendingMs` (1,000 ms) ends. Measured 1,019 to 1,021 ms from click to the pending text (`verify/pending-threshold.json`). The route sets only `pendingMinMs: 0` (`apps/web/src/routes/runs.$runId.tsx:33`). The same delay applies after the pull-request lookup.
2. **Each private request spends three sequential D1 trips on identity** (session, user, account) after the schema check: trips 4 to 6 in `verify/api-path-verify.json`. One joined query, or better-auth's `advanced.database.joins`, can make it one trip.
3. **The project row is read before auth on each request**, including signed-out requests (`apps/web/src/api/index.ts:125`), and then two more times in the model. One trip of about 140 ms on each 401.
4. **The status poll costs 13 sequential D1 trips, and it repeats 2 seconds after each answer** while a comparison is pending (`probe/api-path.json`, "poll run state": 13 trips, 869 rows read; `apps/web/src/review/use-review-session.ts:241,252`). By count that is about 1.8 s of server wait for each poll at 140 ms for each trip. Not measured in production.
5. **Each "not ready" receipt poll costs 9 D1 trips by count** (6 prelude, task, comparison, run), and a ready receipt discards its model when the run revision changed (`apps/web/src/api/review.ts:801-835`).
6. **The light save response is unreachable from the page.** `apps/web/src/review/client.ts:317` always sends `queued: true`, so `apps/web/src/api/review.ts:879-904` runs only in tests.
7. **The pull-request title query in the model finds nothing after the webhook is processed.** `apps/web/src/api/review.ts:286-290` reads `payload_json`, and `apps/web/src/api/webhooks.ts:150` replaces it with `'{}'`. `audit/load/pr-title.json` shows the title before processing and no title after. The run header shows "#N · Pull request visual review".
8. **No production measurement exists for a save, an Undo, or a first image view.** All save numbers are local with near-zero D1 latency. Workers traces are enabled (`apps/web/wrangler.jsonc:15-20`) and can give the real split of the 5.3 to 5.7 s model wait.
9. **D1 has no South America location.** This is a platform limit that changes the options for REVIEW-02 (see that section).
