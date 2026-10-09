LANE review-load. REPORT FILE NOT WRITTEN: the harness rejected the Write call for report.md ("Subagents should return findings as text, not write report files"). I did not bypass that guard. The complete report text is below in this field, in the required structure. The orchestrator can save it to reportPath. All raw evidence files exist in /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/review-load/ (routes/measurements.json, probe/api-path.json, probe/inventory-scale.json, production-timing-clean.txt, production-run-shell.html, screens/*.png, and the probe scripts).

SHORT SUMMARY

- The slow "Checking access and loading this run…" wait is mostly sequential D1 round trips from a Worker that runs near the user. Measured in production from this machine (Cloudflare GRU, signed out): /health 23-34 ms, a path with 1 D1 query 154 ms, a path with 2 D1 round trips 343-402 ms, a path with 3 round trips 444-586 ms. One sequential D1 round trip costs about 125-165 ms.
- GET /api/runs/:id makes 21 D1 round trips with a sequential depth of 15, plus 2 sequential R2 reads of complete inventories, plus 0-3 GitHub calls. Estimate: 1.9-2.5 s of D1 wait alone.
- better-auth 1.7.5 runs a schema check (1 sqlite_master read plus a batch of 75 PRAGMA statements) on every private request, because the app makes a new auth instance per request. This is 2 sequential round trips and 856 of the 941 rows read. One config line removes it.
- Each model read downloads, hashes, parses, and validates two complete R2 inventories (9.4 MB at 3,582 captures) and returns one record for each unchanged capture (2.15 MB raw, 205 KB gzip) while only 4 need review. Every decision receipt and every Undo repeats that work.
- Images are public and immutable but each first view goes Worker -> D1 -> R2 with no edge cache and no preload of the next variant. Approve stays disabled until both images decode.
- Save confirmation has a fixed 500 ms first poll, a late review-session request, and a permission cache that write requests clear (48 GitHub permission calls for 12 approve/undo cycles in the route probe).
- The pull-request page adds a second authenticated round trip (8 D1 round trips) and 4 lazy chunks before the run starts to load.

==================== FULL REPORT ====================

# Run review and pull-request page load path

Audited commit: `f83fef6` (worktree `serialized-dazzling-pixel`). Production serves this same build: the production HTML shell lists `index-MxeSnhFR.js`, `runs._runId-QUJlDVZ1.js`, and `index-CXm4JU5N.css`, which are the files in `apps/web/dist/client/assets`.

Words used in this report:

- **Round trip**: one awaited call from the Worker to D1. A `batch()` is one round trip with many statements.
- **Sequential depth**: the number of round trips that must run one after the other. Parallel round trips count once.
- **Inventory run**: a run that has `inventory_key` (the current `local-v1` storage). The complete capture list is one JSON object in R2.
- **Measured** means that I ran it. **Estimate** means a measured unit cost multiplied by a count from the code.

## How it works (map)

### The fixed cost of each private API request

Each request to `/api/*` (not `/api/auth/*`, not `/images/*`) runs this preamble in `handleApi` before the route code. All steps are sequential.

| #   | Step                                              | Where                                                                                     |                                 D1 round trips | GitHub calls |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------: | -----------: |
| 1   | Check that the project matches the repository     | `apps/web/src/api/index.ts:123-126`, `apps/web/src/api/context.ts:128-141`                |                                              1 |            0 |
| 2   | Create a new better-auth instance                 | `apps/web/src/api/index.ts:130`, `packages/security/src/auth.ts:15-21`                    |                                              0 |            0 |
| 3   | better-auth schema check, awaited by `getSession` | better-auth 1.7.5 default `validateSchema: true`                                          | 2 (1 statement, then a batch of 75 statements) |            0 |
| 4   | Read session, then user                           | `packages/security/src/authorization.ts:32-36`                                            |                                              2 |            0 |
| 5   | Read the linked GitHub account                    | `packages/security/src/authorization.ts:40-43`                                            |                                              1 |            0 |
| 6   | Repository permission                             | `packages/security/src/authorization.ts:60-83`, `packages/security/src/github.ts:107-262` |                                              0 |       0 to 3 |

Total: **6 sequential D1 round trips and 80 statements** before the route code starts. Measured with the real `handleApi` (see Measurements, M2).

Step 6 uses three caches that live in isolate memory only:

- Permission result: 60 s for `GET`, 10 s for Approve and Reject, never for other writes (`authorization.ts:21-23`, `60-70`).
- Installation token (`github.ts:102-104`, `166-173`).
- Login hint for the numeric GitHub user ID (`github.ts:193-205`, `231-250`).

A cold isolate makes 3 sequential GitHub calls: `POST /app/installations/:id/access_tokens`, `GET /user/:id`, `GET /repos/:repo/collaborators/:login/permission`. A warm isolate with an expired permission makes 1 call.

### Sequence A: open run to first screenshot painted

| #   | What happens                                                                                                                                                                                                         | Requests | D1 round trips (sequential depth) | R2 reads | GitHub | What the user sees                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | --------------------------------: | -------: | -----: | ------------------------------------------------------------------------ |
| A1  | `GET /runs/:id`. The Worker renders only the pending shell, because the route has `ssr: false` (`apps/web/src/routes/runs.$runId.tsx:31`, `66-74`). No auth, D1, R2, or GitHub. The response is `no-store, private`. |        1 |                                 0 |        0 |      0 | Blank, then header and one grey line                                     |
| A2  | The browser loads 1 CSS file, 9 JS modules (from `modulepreload` links), and the favicon. Total for this page: 1,163,571 bytes raw, 229,877 bytes with brotli.                                                       |       11 |                                 0 |        0 |      0 | Header and "Checking access and loading this run…"                       |
| A3  | JS runs and hydrates. The router then starts the loader in the browser (`runs.$runId.tsx:37-47`).                                                                                                                    |        0 |                                 0 |        0 |      0 | Same                                                                     |
| A4  | `GET /api/runs/:id` with `cache: "no-store"` (`apps/web/src/review/client.ts:254-262`, `365-373`). Preamble, then `reviewModel` (`apps/web/src/api/review.ts:227-617`).                                              |        1 |       21 total, **15 sequential** |        2 | 0 to 3 | Same                                                                     |
| A5  | The browser parses the model and renders the workspace. It mounts 2 `<img>` elements for the first variant that needs review (`apps/web/src/components/screenshot-viewer.tsx:146-164`).                              |        0 |                                 0 |        0 |      0 | Workspace, "Loading this comparison's images…", and 2 × "Loading image…" |
| A6  | `GET /images/:id` × 2 in parallel. Each one reads D1, then R2 (`apps/web/src/api/images.ts:24-41`).                                                                                                                  |        2 |                        2 (1 each) |        2 |      0 | Same. Approve and Reject are disabled                                    |
| A7  | `onLoad`, then `img.decode()`, then a size check (`screenshot-viewer.tsx:49-72`). The pane becomes visible.                                                                                                          |        0 |                                 0 |        0 |      0 | Screenshots. The viewer moves up by 41 px                                |

Totals to the first screenshot: **15 requests, 23 D1 round trips, 4 R2 reads, 0 to 3 GitHub calls.**

Details of step A4 for an inventory run (measured order, M3):

```text
 1 run                                   projectRun                       review.ts:232
   -- Promise.all (review.ts:276-307) --
 2 batch[3] retained, history, PR title
 3 project                               (second read of the project row)
 4 run                                   readRunStatus (second read)      run-status.ts:27
 5 comparison
 6 comparison                            readRunStatus (second read)      run-status.ts:45
 7 failures (work_tasks join)                                             run-status.ts:48-52
 8 counts                                                                 run-status.ts:56-60
 9 project                               (third read)                     run-status.ts:61
10 current promotion                                                      run-status.ts:62-68
   -- Promise.all (review.ts:323-365) --
11 comparison rows
12 batch[5] policy, captures, images, decisions, promotion
13 eligible approval rows
14 run inventory header                  (third read of the run row)      inventory-records.ts:45-49
   R2 GET run inventory, SHA-256, JSON.parse, canonical re-serialize, validate
15 baseline inventory header                                              inventory-records.ts:70-81
   R2 GET baseline inventory, same checks
```

Sequential depth: 6 (preamble) + 1 (run) + 6 (status chain 4, 6, 7, 8, 9, 10) + 2 (inventory headers) = **15**. The two R2 reads are also sequential (`apps/web/src/api/review-inventory.ts:43-48`).

Payload of step A4, measured with a synthetic inventory run with 4 changed captures (M3):

| Captures | R2 bytes read per model request | Model JSON raw |    gzip |  brotli | `reviewModel` CPU, Node on M4 Pro |
| -------: | ------------------------------: | -------------: | ------: | ------: | --------------------------------: |
|      600 |                       1,564,706 |        358,747 |  36,142 |  25,503 |                             29 ms |
|    1,058 |                       2,761,640 |        632,742 |  62,207 |  43,795 |                             46 ms |
|    3,582 |                       9,384,684 |      2,153,156 | 205,102 | 143,985 |                            166 ms |
|    7,164 |                      18,790,701 |      4,311,393 | 407,671 | 286,616 |                            332 ms |

The model has one record for each capture, also for unchanged captures. A recorded production pull request had 1,058 variants and 4 images to review (`docs/evidence/e05-production-ariakit-review.md`).

### Sequence B: Approve to next screenshot painted

| #   | What happens                                                                                                                                                                                                   |                 Requests | D1 round trips |     R2 | GitHub | What the user sees                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------: | -------------: | -----: | -----: | ----------------------------------------------------------------------- |
| B1  | The user presses `A`. This works only when the current images are decoded (`apps/web/src/review/review-workspace.tsx:302-307`, `385-389`).                                                                     |                        0 |              0 |      0 |      0 |                                                                         |
| B2  | The same tick: optimistic verdict, then `onSelect(next)` (`apps/web/src/review/use-review-session.ts:306-317`). The route search changes with `replace`. The loader does not run again (`runs.$runId.tsx:34`). | 1 (favicon revalidation) |              0 |      0 |      0 | Next variant, "Loading this comparison's images…", 2 × "Loading image…" |
| B3  | `GET /images/:id` × 2 for the next variant. Measured: the request starts 0.1 ms after the click (M1). No request if the browser saw the image before (`immutable`).                                            |                   0 to 2 |         0 to 2 | 0 to 2 |      0 | Same. Approve is disabled until both images are decoded                 |
| B4  | Decode and size check.                                                                                                                                                                                         |                        0 |              0 |      0 |      0 | **Next screenshot.** The viewer moves up by 41 px                       |

In parallel, not blocking the next screenshot:

| #   | What happens                                                                                                                                                                                      |  Requests |                                                            D1 round trips |                     R2 | GitHub | Footer text                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------------: | ---------------------: | -----: | ------------------------------------------------ |
| B5  | First decision on the page only: `POST /api/review-sessions` (`client.ts:295-303`). Always a live permission check.                                                                               |         1 |                                                                         7 |                      0 |      1 | "Sending 1 decision…"                            |
| B6  | `POST /api/comparisons/:id/commands` with `queued: true` (`client.ts:305-322`, `review.ts:837-878`). Returns 202.                                                                                 |         1 |                                                      11 to 12 at response |                      0 | 0 or 1 | "1 queued on server. You can close this window." |
| B7  | Server, in `waitUntil`: `processReviewQueue` (`review.ts:641-667`, `apps/web/src/operations/review-queue.ts:69-164`).                                                                             |         0 |                                                                  13 to 14 |                      0 |      0 | Same                                             |
| B8  | Fixed 500 ms wait, then `GET /api/commands/:id/queued` (`client.ts:326-336`). Not complete: 9 round trips and 202. Complete: the server builds the full review model again (`review.ts:812-833`). | 1 or more | 9 each while pending. 23 (legacy run) or 25 (inventory run) when complete | 2 for an inventory run |      0 | "1 variant approved. Saved."                     |

Totals for one Approve in a steady state on an inventory run: 2 or more requests, about 50 D1 round trips, 2 R2 reads of the full inventories, and one more download of the full model.

Undo (`client.ts:339-348`, `review.ts:915-949`, `packages/service/src/review-commands.ts:319-467`): 1 request, 30 D1 round trips (measured, legacy run), 1 live GitHub call, and the full model in the response. All review actions are blocked while it runs (`use-review-session.ts:455-456`, `137-138`).

### Sequence C: pull-request page

| #   | What happens                                                                                                                                                                                                                                                                                                      | Requests |     D1 round trips | GitHub | What the user sees                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | -----------------: | -----: | ------------------------------------------------------ |
| C1  | `GET /pulls/:n?check=…`. Server-rendered card in the loading state.                                                                                                                                                                                                                                               |        1 |                  0 |      0 | Card with "Finding this pull request's visual review…" |
| C2  | 1 CSS file, 7 JS modules, and the favicon (route manifest in `apps/web/dist/server/assets/_tanstack-start-manifest_v-BWj36htj.js`).                                                                                                                                                                               |        9 |                  0 |      0 | Same                                                   |
| C3  | After hydration, an effect calls `GET /api/pulls/:n?check=…` (`apps/web/src/routes/pulls.$pullNumber.tsx:47-58`, `review.ts:735-784`).                                                                                                                                                                            |        1 | 8 (6 preamble + 2) | 0 to 3 | Same                                                   |
| C4  | `navigate({ to: "/runs/$runId", replace: true })` (`pulls.$pullNumber.tsx:80-84`). The run route needs 4 chunks that the pull-request page did not preload: `runs._runId-6tHAE8eb.js`, `runs._runId-QUJlDVZ1.js`, `rotate-ccw-DxwNi5rf.js`, `badge.ariakit.react-CyMRzBLT.js` (192,339 bytes raw, 56,613 brotli). |        4 |                  0 |      0 | "Checking access and loading this run…"                |
| C5  | Sequence A from step A4. The preamble runs again.                                                                                                                                                                                                                                                                 |        3 |                 23 | 0 to 1 | As in sequence A                                       |

The pull-request path adds 1 API round trip, 8 D1 round trips, and 4 lazy chunks before sequence A starts.

### Image delivery

- URL: `/images/<image id>`. The ID is a UUID or a 64-hex digest (`images.ts:16`). No session is necessary (`apps/web/src/api/index.ts:113-116`). The contract keeps validated image bytes public (`docs/current-contract.md:59`).
- Each request: 1 D1 query on `visonaut_images`, then `R2.get` (or `R2.head` for `HEAD` and `If-None-Match`) (`images.ts:24-41`).
- Headers: `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<digest>"`, `Cross-Origin-Resource-Policy: same-origin` (`images.ts:48-57`).
- The Worker does not use the Cache API. No file in `apps/` or `packages/` contains `caches.default`. Thus the header helps only the browser cache of one user. Each first view goes to the Worker, D1, and R2.
- The browser loads only the images of the selected variant. There is no preload of the next or previous variant. The diff image mounts only after the user opens the Difference view (`screenshot-viewer.tsx:205-208`, `242`).
- The image is the full original PNG. There is no resized variant.
- Sidebar thumbnails use `loading="lazy"` (`apps/web/src/review/item-list.tsx:231-243`), but current runs have no thumbnail (REVIEW-14).
- Reveal: the `<img>` stays `invisible` until `decode()` resolves and the natural size equals the model size (`screenshot-viewer.tsx:49-72`, `162`).

### Unit costs measured in production (signed out, from the audit machine)

The audit machine reaches Cloudflare at `GRU` (São Paulo) (`cf-ray: …-GRU`). These are time-to-first-byte values on one reused connection (M5).

| Request                          | D1 round trips on that path |               TTFB |
| -------------------------------- | --------------------------: | -----------------: |
| `GET /health`                    |                           0 |        23 to 34 ms |
| `GET /runs/<id>` (HTML shell)    |                           0 |       56 to 151 ms |
| `GET /images/<unknown id>` (404) |                           1 | 154 ms (3 samples) |
| `GET /api/runs` (401)            |            2 (schema check) |      343 to 402 ms |
| `GET /api/operations` (401)      |                           3 |      444 to 524 ms |
| `GET /api/runs/<id>` (401)       |                           3 |      515 to 569 ms |
| `GET /api/pulls/1?check=x` (401) |                           3 |             586 ms |

One sequential D1 round trip costs about **125 to 165 ms** from this location. Estimate for the signed-in `GET /api/runs/:id` on an inventory run: 15 sequential round trips × 125 to 165 ms = **1.9 to 2.5 s of D1 wait**, before R2 reads, CPU, GitHub calls, and the download.

## Findings

### REVIEW-01 · better-auth checks the database schema on each private API request

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/auth.ts:15-21`: `/** Create inside each request so a D1 binding cannot cross request ownership. */ export function createAuth(configuration: AuthConfiguration) { … return betterAuth({`. There is no `advanced.database.validateSchema` option in this file.
  - `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });`. `apps/web/src/server.ts:85` and `93` do the same.
  - better-auth 1.7.5 types, `@better-auth/core/dist/types/init-options.d.mts:391-400`: `Validate the schema during initialization … Authentication requests await the same check … Kysely introspects the database … Set false to disable runtime schema validation. @default true`.
  - Built server bundle `apps/web/dist/server/index.js:35675-35677`: `const rawContext = await ctx; const pendingSchemaCheck = rawContext.checkSchema?.(); if (pendingSchemaCheck) await pendingSchemaCheck;`.
  - M2, each private request starts with: `all[1] select "name", "type", "sql" from "sqlite_master" … (read 231)` and then `batch[75] SELECT * FROM pragma_table_info(?) …`.
  - M5, production, signed out: `GET /health` 23 to 34 ms. `GET /api/runs` (401) 343 to 402 ms. The only D1 work on that 401 path is this check.
- What happens: The result of the check is cached for one better-auth adapter instance. The app makes a new instance for each request. Thus each request reads `sqlite_master` and then runs 75 `pragma_table_info` statements, before the session lookup starts.
- Impact: 2 more sequential D1 round trips, 76 statements, and 856 rows read on each private request. 856 of the 941 rows that `GET /api/runs/:id` reads are this check. In production the two round trips cost about 310 to 370 ms (M5). One Approve makes 2 or 3 private requests. A signed-out visitor waits about 0.5 s for the 401.
- Recommendation: Disable the runtime check. The schema comes from the committed migration `apps/web/migrations/0003_auth.sql`. A test can keep the default check.

  ```ts
  // packages/security/src/auth.ts
  return betterAuth({
    // …
    advanced: {
      database: { validateSchema: false },
      cookiePrefix: `visonaut-${configuration.environment}`,
      // …
    },
  });
  ```

- Alternatives:
  - Minimal: the one option above.
  - Keep one better-auth instance for each isolate (a module-level `WeakMap` keyed by `env.DB`). The check then runs one time for each isolate. This changes the "create inside each request" decision in `auth.ts:15`.
  - Keep the check and run it in the deploy workflow as a smoke request.
- Maintainer decision needed: yes. Is the runtime schema check wanted in production, or is the migration plus a test sufficient?

### REVIEW-02 · The Worker runs near the user while each D1 round trip costs about 125 to 165 ms

- Kind: performance
- Severity: high. Confidence: medium. Measured: yes (unit latency and counts). Effort: S
- Evidence:
  - `apps/web/wrangler.jsonc:1-125` has no `placement` block. `rg -n "placement|caches\.default|withSession" apps packages` finds no match in source or configuration.
  - M5: `GET /images/<unknown id>` (1 D1 query, no R2) has a TTFB of 154 ms. `GET /health` (no D1) has 23 to 34 ms.
  - M5: response header `cf-ray: a45ee5ddfe164812-GRU`.
  - Sequence A, step A4: 15 sequential D1 round trips.
- What happens: The Worker starts in the Cloudflare location nearest to the browser. Each D1 statement or batch then travels to the D1 primary and back. The code awaits many small reads one after the other.
- Impact: Estimate for `GET /api/runs/:id`: 15 × 125 to 165 ms = 1.9 to 2.5 s. Estimate for `GET /api/pulls/:n`: 8 × 125 to 165 ms = 1.0 to 1.3 s. Estimate for the last receipt poll after Approve: about 20 sequential round trips = 2.5 to 3.3 s. Each image adds one round trip (about 125 ms) before R2 starts.
- Recommendation: Run the code that talks to D1 near D1. The smallest change is Smart Placement for the production environment. Then verify with the traces that are already enabled (`wrangler.jsonc:15-20`).

  ```jsonc
  // apps/web/wrangler.jsonc, env.production
  "placement": { "mode": "smart" },
  ```

- Alternatives:
  - Minimal: do REVIEW-01 and REVIEW-03 only. This lowers the count from 15 to about 4 and keeps the Worker at the edge.
  - Move `/api/*` and `/images/*` to a second Worker with Smart Placement, and call it through a service binding. The HTML shell and assets stay at the edge.
  - D1 read replication with the Sessions API. This helps only if a replica is near the user. It also needs bookmark handling for read-after-write.
- Maintainer decision needed: yes. Smart Placement moves all `fetch` work of this Worker, also the HTML shell (0 D1 calls today). Is one more hop for the shell acceptable?

### REVIEW-03 · The run model reads the same rows again and awaits 15 round trips in sequence

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - M2, `GET /api/runs/:id`: `SELECT * FROM visonaut_projects WHERE id = ?` runs 3 times (lines 1, 8, 15). `SELECT * FROM visonaut_runs WHERE id = ?` runs 2 times (7, 9). `SELECT * FROM visonaut_comparisons WHERE id = ?` runs 2 times (10, 12).
  - M3, inventory run: a third run read, `SELECT id,project_id,tested_sha,inventory_key,… FROM visonaut_runs WHERE id=?` (`apps/web/src/inventory-records.ts:45-49`).
  - `packages/service/src/run-status.ts:26-27`: `export async function readRunStatus(service: Service, runId: string) { const run = await service.run(runId);`, then `:45`, `:48`, `:56`, `:61`, `:62` each await one more read.
  - `apps/web/src/api/index.ts:123-126`: `await assertConfiguredProject(context);` runs before auth and not in parallel with it.
  - `packages/security/src/authorization.ts:32-43`: session, then user, then `SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'`.
  - `apps/web/src/api/review-inventory.ts:43-48`: `const inventory = await readRunInventory(context, runId); … ? await readSnapshotInventory(context, inventory.referenceSnapshotId)`. The two R2 reads are sequential.
- What happens: `reviewModel` loads the run, and then calls helpers that load the same run, project, and comparison again. `readRunStatus` awaits six reads one by one. The second inventory read waits for the first one, only to get `referenceSnapshotId`. That ID is also in D1 (`visonaut_comparisons.reference_snapshot_id`).
- Impact: 21 round trips with a sequential depth of 15 for one read. All inputs are keyed by the run ID, so one batch can read them.
- Recommendation: Read all D1 inputs of the model in one batch keyed by the run ID. Pass loaded rows to the helpers. Start both R2 reads together.

  ```ts
  // Sketch: one round trip for all D1 inputs of the review model.
  const comparison = "(SELECT comparison_id FROM visonaut_runs WHERE id = ?1)";
  const [run, project, current, counts, failures, rows, captures, images, decisions, retained] =
    await context.database.batch([
      sql("SELECT * FROM visonaut_runs WHERE id = ?1", runId),
      sql("SELECT p.* FROM visonaut_projects p JOIN visonaut_runs r ON r.project_id = p.id WHERE r.id = ?1", runId),
      sql(`SELECT * FROM visonaut_comparisons WHERE id = ${comparison}`, runId),
      sql(`SELECT ${pendingReviewCountSql} AS pending, ${rejectedReviewCountSql} AS rejected FROM … WHERE row.comparison_id = ${comparison}`, runId),
      // failures, rows, captures, images, decisions, retained, history, title …
    ]);
  const status = reviewStatus({ run, comparison: current, ...counts, … }); // pure function, already exists
  const [runInventory, baselineInventory] = await Promise.all([
    readCaptureInventory(context.images, inventoryPointer(run)),
    readSnapshotInventory(context, current.reference_snapshot_id),
  ]);
  ```

  For the preamble: run `assertConfiguredProject` in parallel with `requireMaintainer`. Read the account in parallel with the user (`WHERE userId = (SELECT userId FROM session WHERE token = ?)`), or enable better-auth `experimental.joins`.

- Alternatives:
  - Minimal: change `readRunStatus(service, runId)` to accept the loaded `run`, `comparison`, and `project`. This removes 3 sequential round trips. Pass the loaded run to `readRunInventory`. This removes 1.
  - Medium: the minimal change plus `Promise.all` for the project check and the two R2 reads.
  - Full: the single batch above. Sequential depth for the model: 1 D1 round trip plus parallel R2.
- Maintainer decision needed: no.

### REVIEW-04 · Each model read downloads, hashes, and validates two complete inventories from R2

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/api/review.ts:364`: `run.inventory_key ? readReviewInventory(context, run.id) : null,`.
  - `apps/web/src/capture-inventory.ts:509-516`: `if (offset !== pointer.bytes || (await sha256(bytes)) !== pointer.digest) { … } const encoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); const parsed: unknown = JSON.parse(encoded); if (canonicalJson(parsed) !== encoded) {`.
  - `apps/web/src/capture-inventory.ts:552-553`: `const document = await readInventoryValue(object.body, pointer); const inventory = await validatedInventory(expandInventory(document));`. `validatedInventory` (`:396-450`) checks each profile digest and each capture, and `validateReceipt` (`:215-283`) calls `canonicalJson` for each capture.
  - `apps/web/src/api/review-inventory.ts:30`: `metadata_json: JSON.stringify(capture.metadata),`, and then `apps/web/src/api/review.ts:447`: `const metadata = object(JSON.parse((candidate ?? reference)?.metadata_json ?? "{}"));`.
  - `apps/web/src/api/review-inventory.ts:146-159` builds `tuple_json` and `result_json` strings for each unchanged capture. `review.ts:436` and `455` parse them again.
  - M3: 3,582 captures: 2 R2 GETs, 9,384,684 bytes, 166 ms median in Node. 7,164 captures: 18,790,701 bytes, 332 ms.
  - Callers: `review.ts:789` (page open), `:814` (each completed receipt), `:638` (each Undo), `:683` (each conflict).
- What happens: The inventories are immutable. Their keys contain the SHA-256 digest. But each model read gets both objects again, hashes all bytes, parses the JSON, serializes it again to compare the text, and validates each capture. Then it converts each capture to a JSON string and back.
- Impact: The server cost of one page open grows with the complete capture count, not with the count of changed captures. The same cost repeats for each decision receipt and each Undo. In the synthetic shape of M3, one run inventory uses about 1,673 bytes for each capture. The 16 MiB limit (`capture-inventory.ts:56`) is reached at about 10,000 captures.
- Recommendation: Do the trust checks one time, at Submit (they already run in `writeCaptureInventory`, `capture-inventory.ts:465`). For review reads, use a small derived object.

  ```ts
  // Sketch: derived at Submit, keyed by the immutable inventory digest.
  // runs/<runId>/review-index/<inventoryDigest>.json
  interface ReviewIndexEntry {
    itemKey: string;
    variantKey: string;
    name: string;
    variant: { framework?: string; browser?: string; colorScheme?: string };
    image: { id: string; digest: string; width: number; height: number };
    observedDigest: string;
    renderingProfileDigest: string;
  }
  ```

- Alternatives:
  - Minimal: keep the code, and add a module-level LRU keyed by `pointer.digest` that holds the validated result for the isolate. The content cannot change for one digest. Keep only the fields that the review needs, to protect the 128 MiB isolate limit.
  - Small: use the R2 checksum that the write already sets (`sha256: digest`, `capture-inventory.ts:481-484`) and skip the second hash and the canonical text comparison on review reads.
  - Small: build variant views from the inventory objects directly. Remove the `JSON.stringify` and `JSON.parse` pairs.
  - Structural: do not read inventories on the first request (REVIEW-05).
- Maintainer decision needed: yes. Must the review read verify the full inventory each time, or is verification at Submit and promotion sufficient?

### REVIEW-05 · The first response contains each unchanged capture, although the page needs only the changed ones first

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - `apps/web/src/api/review.ts:371-374`: `const rows = inventory && comparison && !importedBaseline ? completeReviewRows(inventory, storedRows, comparison.id) : storedRows;`, then `:433` `for (const row of rows) {` builds one view for each row.
  - `apps/web/src/review/navigation.ts:34-47`: unchanged items go to the `accepted` group. `apps/web/src/review/item-list.tsx:105-107`: `const [acceptedOpen, setAcceptedOpen] = useState(() => accepted.some((entry) => entry.index === selectedIndex));`. The group is closed at the start.
  - M3: 1,058 captures with 4 changed: 632,742 bytes raw, 62,207 gzip. 3,582 captures: 2,153,156 bytes raw, 205,102 gzip. M2: a model with 3 variants is 3,028 bytes.
  - `docs/current-contract.md:26`: "Review reads the full inventory to show unchanged items."
- What happens: The API returns one variant record (about 600 bytes raw) for each capture of the run. The page shows the items that need attention and hides the others in a closed "Accepted (N)" group.
- Impact: The first screenshot waits for the two R2 reads of REVIEW-04, for the JSON build, and for the download and parse of a payload that is 200 to 700 times larger than the visible part. On the "slow" profile of M1 (4 × CPU, 150 ms latency), 555 ms pass between the end of a 3 KB model response and the first image request.
- Recommendation: Split the read. The first response has the run header, the counts, and the rows that D1 already stores (changed, added, removed, error). `visonaut_runs.capture_count` gives the total. Load the unchanged list when the user opens "Accepted", searches, or after the first screenshot is on screen.

  ```ts
  // GET /api/runs/:id            -> header, counts, attention items (D1 only, no R2)
  // GET /api/runs/:id/unchanged  -> the complete list from the inventory (lazy, cacheable by digest)
  ```

- Alternatives:
  - Minimal: keep one endpoint and one shape, but send the attention items first with a streamed response (NDJSON or two JSON chunks). The server still does all the work.
  - Medium: `GET /api/runs/:id?scope=attention` for the first paint, then the current full request in the background. No change to the review commands.
  - The `unchanged` response is immutable for one inventory digest. It can use a URL with the digest and `Cache-Control: private, max-age=31536000, immutable`.
- Maintainer decision needed: yes. The contract says that review reads the full inventory. Is a lazy read of unchanged items inside that rule?

### REVIEW-06 · Each saved decision and each Undo builds and returns the complete model again

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/api/review.ts:812-832`: `if (task.state === "complete" || task.state === "dead") { // Other decisions can finish before the browser reads this receipt. const model = await reviewModel(context, run.id); … return Response.json({ ...result, model });`.
  - `apps/web/src/api/review.ts:637-639`: `async function commandResult(…) { return Response.json({ ...result, model: await reviewModel(context, runId) }); }`, used by Undo at `:939`.
  - `apps/web/src/operations/review-queue.ts:127`: the stored receipt is already complete: `result: JSON.stringify({ ...result, reviewer: input.actorId, runStatus: status.status }),`.
  - `apps/web/src/review/navigation.ts:85-142`: `applySavedReview` applies a receipt that has no `model`.
  - `apps/web/src/api/review.ts:879-904`: the path without `queued` returns the small receipt. `apps/web/src/review/client.ts:317` always sends `queued: true`, so the web client does not use that path.
  - M2: completed receipt: 23 round trips, 103 statements, 3,420 bytes for 3 variants. Undo: 30 round trips, 3,336 bytes.
- What happens: The queue stores a small receipt. The receipt endpoint ignores that it is sufficient, builds the full model (REVIEW-03, REVIEW-04), and sends it. The client replaces its model with it.
- Impact: For a run with 3,582 captures, each Approve costs one more read of 9.4 MB from R2 and one more download of 205 KB gzip. Four fast decisions start four model builds. The "Saved" text waits for this work.
- Recommendation: Return the stored receipt. Add `previousRunRevision` to the client check. If the client model is not at that revision, the client calls `refresh()` one time.

  ```ts
  // review.ts, receipt endpoint
  if (task.state === "complete" && result && !result.error) return Response.json(result);
  // navigation.ts, applySavedReview
  if (result.previousRunRevision !== model.comparisonRevision) throw new StaleModelError(); // caller refreshes
  ```

- Alternatives:
  - Minimal: keep `model` in the response but build it without the inventories (only D1 rows). The client merges changed rows into its model.
  - Keep the full model only for conflict (409) and dead receipts.
  - Remove the non-queued branch at `review.ts:879-904` if no client uses it. Two paths for one command have different response shapes today.
- Maintainer decision needed: yes. The comment at `review.ts:813` shows that the full model is a deliberate guard against interleaved decisions. Is a revision check on the client an acceptable replacement?

### REVIEW-07 · Save confirmation has a fixed 500 ms wait, a late session request, and a permission cache that write requests clear

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/client.ts:326-328`: `while (result.queued === true) { options?.signal?.throwIfAborted(); await new Promise((resolve) => setTimeout(resolve, 500));`.
  - `apps/web/src/review/client.ts:295-296`: `const reviewSession = () => { sessionPromise ??= request("/api/review-sessions", {})`, first called inside `save` (`:310`).
  - `packages/security/src/authorization.ts:71-82`: `permissions.delete(key); const checkedAt = Date.now(); const identity = await requireRepositoryWrite(github, githubUserId); if (access !== "write") { … permissions.set(key, { identity, checkedAt }); }`.
  - M1, local Worker, no latency: Approve to "Saved" has a p50 of 892 to 916 ms. Resource timing of one sample: `POST /api/review-sessions` ends at 1026.6 ms, `POST …/commands` ends at 1050 ms, and the app's `GET …/queued` starts at 1551.4 ms.
  - M1, GitHub request log: 48 permission calls for 12 open, approve, undo cycles (4 for each cycle).
  - M2: `POST /api/review-sessions` makes 1 GitHub call. The `POST …/commands` that follows makes 1 more, although the page open cached a result seconds before. "open run right after a write request" makes 1 call.
- What happens:
  1. The first poll always waits 500 ms, also when the server finished in 10 ms.
  2. The review session is created on the first Approve, as a separate request before the command.
  3. A request with `access: "write"` (session create, Undo) deletes the cached permission and does not store the new positive result. The next read or decision must ask GitHub again.
- Impact: The first decision on a page: 3 sequential requests, 2 GitHub calls, and 500 ms. Later decisions: 500 ms plus 2 requests. Each Undo forces one more GitHub call on the next request. The footer shows "Sending…" and "queued on server" for that time.
- Recommendation:
  - Store the positive result after a live write check. It is a newer proof than the one it replaces.

    ```ts
    // authorization.ts
    const identity = await requireRepositoryWrite(github, githubUserId);
    permissions.set(key, { identity, checkedAt }); // also when access === "write"
    ```

  - Poll with a short first delay and back-off: for example 100, 200, 400, 800 ms.
  - Create the review session when the first images of a review-ready run are decoded, or let the command endpoint create it when `reviewSessionId` is absent.
- Alternatives:
  - Minimal: change only the first delay (`500` to `100`).
  - Let `POST …/commands` await `processReviewQueue` for a short budget (for example 1 s) and return the receipt when it is complete, else 202. The contract says that queued submissions return 202 after admission (`docs/current-contract.md:196`), so this needs a decision.
  - Keep the session request lazy. The record in `docs/evidence/review-decision-latency/README.md` gives the reason: no authenticated write for pages where no decision is made.
- Maintainer decision needed: yes. Two questions: can a live write check refresh the cache that reads and decisions use, and can the command endpoint return 200 with a completed receipt?

### REVIEW-08 · Each first view of an image goes through the Worker, D1, and R2. There is no edge cache

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/api/images.ts:24-28`: `const image = await context.database.prepare("SELECT id, object_key, content_type, digest, bytes_present FROM visonaut_images WHERE id = ? AND validated = 1")`, then `:40`: `const stored = image.bytes_present ? await read(image.object_key) : null;`.
  - `apps/web/src/api/images.ts:52`: `"Cache-Control": "public, max-age=31536000, immutable",`.
  - No `caches.default`, `caches.open`, or `cf: { cacheEverything }` in `apps/` or `packages/`.
  - M2: `GET /images/<id>`: 1 D1 round trip and 1 R2 GET. With `If-None-Match`: 1 D1 round trip and 1 R2 HEAD.
  - M5: production `GET /images/<unknown id>` (the D1 lookup only) has a TTFB of 154 ms. `/health` has 23 to 34 ms.
- What happens: A Worker `fetch` handler runs before the Cloudflare cache. A response from the handler is not stored in the edge cache unless the code uses the Cache API. The `immutable` header thus helps only the browser of one user.
- Impact: Each uncached image costs at least one D1 round trip (about 125 ms here) and then the R2 read and the transfer. The first screenshot and each "next screenshot" wait for 2 such requests. Approve stays disabled until both are decoded.
- Recommendation: Put the Cache API in front of the lookup. The content for one ID does not change.

  ```ts
  // images.ts (GET only)
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await buildImageResponse(/* D1 + R2 as today */);
  if (response.status === 200) lifetime.waitUntil(cache.put(request, response.clone()));
  return response;
  ```

- Alternatives:
  - Minimal: the code above with a short edge lifetime, for example `s-maxage=86400`, and keep `max-age=31536000` for the browser.
  - Skip D1 on the image path: put the object key or digest in the URL and read R2 directly. The `validated` and `bytes_present` checks then need a different guard.
  - Serve images from an R2 custom domain with cache rules. The app no longer runs for image bytes. The private headers (`Cross-Origin-Resource-Policy`, `Content-Security-Policy: sandbox`) then need a Transform Rule.
- Maintainer decision needed: yes. An edge copy can stay available after retention deletes the R2 bytes. What edge lifetime is acceptable? (`docs/current-contract.md:59` says that access removal cannot recall copied pixels.)

### REVIEW-09 · The page does not preload the next images

- Kind: performance
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `rg -n -i "preload|prefetch|new Image\(|fetchpriority" apps/web/src` finds no match outside the generated route tree.
  - `apps/web/src/components/screenshot-viewer.tsx:147-149`: `<img key={identity} src={image.url}`. This is the only place that requests an evidence image.
  - `apps/web/src/components/screenshot-viewer.tsx:205-208`, `242`: `{diffState.opened && (<ImagePane image={variant.diff}`. The diff image is requested only after the first press of `D`.
  - `apps/web/src/review/navigation.ts:144-163`: `nextPending` already computes the variant that Approve selects next.
  - M1: the next image request starts 0.1 ms after the Approve click, not before.
- What happens: The page knows the next variant while the user looks at the current one. It requests those images only after the decision.
- Impact: Each Approve, Reject, arrow key, and first `D` press has a visible wait of at least one image request (REVIEW-08). Approve and Reject are disabled for that time (`review-workspace.tsx:1080-1090`), so fast keyboard review stops at each step.
- Recommendation: When the current evidence becomes ready, warm the browser cache for the next pending variant, the adjacent variants of the item, and the diff image of the current variant.

  ```ts
  // After evidence.status === "ready"
  const next = nextPending(model.items, selection);
  for (const image of imagesFor(next, ["reference", "candidate"])) {
    const preload = new Image();
    preload.decoding = "async";
    preload.src = image.url; // same URL, immutable: the visible <img> reuses the bytes
  }
  ```

- Alternatives:
  - Minimal: preload only the next pending variant.
  - Also preload on hover or focus of a variant tab or a sidebar row.
  - Keep the next variant mounted and hidden (`visibility: hidden`), so decode is done too. This uses more memory for large screenshots.
- Maintainer decision needed: no.

### REVIEW-10 · The model request can start only after all JavaScript is loaded and hydrated

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/routes/runs.$runId.tsx:31-39`: `ssr: false, // Do not hold the hydrated loading shell after the model is ready. pendingMinMs: 0, … loader: async ({ params, deps, abortController }) => { … const model = await loadReviewModel(params.runId, deps.comparison, abortController.signal);`.
  - M1, "local" profile, cold cache: all assets end by 42.8 ms. `fetch /api/runs/…` starts at 243.5 ms.
  - M1, "slow" profile (4 × CPU, 150 ms latency, 200 KB/s), cold cache: assets end at 1793.8 ms. `fetch /api/runs/…` starts at 1874.7 ms and ends at 2041.2 ms. The first image request starts at 2596.4 ms. Total 2,874 ms.
  - Run page assets: 1,163,571 bytes raw, 283,275 gzip, 229,877 brotli. The CSS file is 464,666 bytes raw (32,868 brotli).
- What happens: The chain is strictly serial: HTML, then assets, then hydration, then the API, then render, then images. Nothing in the HTML starts the API request or the first images.
- Impact: The API wait (REVIEW-01 to REVIEW-05) is added to the asset and hydration time instead of running at the same time. With the estimate of REVIEW-02, about 2 s of API time could overlap with 0.3 to 1.8 s of asset time.
- Recommendation: Start the model request from the HTML shell. The loader then awaits that promise.

  ```tsx
  // __root.tsx or the run route head: an inline script with the existing nonce.
  // The run ID comes from location.pathname, so the server does not need the session.
  <script
    nonce={nonce}
    dangerouslySetInnerHTML={{
      __html: `var m=location.pathname.match(/^\\/runs\\/([a-f0-9-]+)$/);
     if(m)window.__review=fetch("/api/runs/"+m[1]+location.search.replace(/[?&](item|variant)=[^&]*/g,""),
       {credentials:"same-origin",cache:"no-store"});`,
    }}
  />
  // client.ts: use window.__review once, then fall back to fetch.
  ```

- Alternatives:
  - Minimal: the inline script above. It is a small change and keeps `ssr: false`.
  - Server loader with streaming SSR: the Worker runs the model read during the document request and sends the shell first. The HTML can then contain `<link rel="preload" as="image">` for the first two images. This needs the small first model of REVIEW-05, because the data is serialized into the HTML.
  - Keep the model in `sessionStorage` or the router cache for back and forward navigation (`gcTime: 0` at `runs.$runId.tsx:35` drops it today).
- Maintainer decision needed: yes. Why is `ssr: false` set on this route? If the reason is the model size or the CSP nonce, the inline script is the smaller change.

### REVIEW-11 · The pull-request page makes a second authenticated round trip before the run starts to load

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes (counts). Effort: M
- Evidence:
  - `apps/web/src/routes/pulls.$pullNumber.tsx:47-58`: `useEffect(() => { … const response = await fetch(`/api/pulls/${…}?check=${…}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });`.
  - `apps/web/src/routes/pulls.$pullNumber.tsx:80-84`: `if (typeof runId === "string") { … await navigate({ to: "/runs/$runId", params: { runId }, replace: true });`.
  - M2: `GET /api/pulls/1?check=…`: 8 round trips, 82 statements, 3 GitHub calls on a cold isolate. Then `GET /api/runs/:id`: 19 round trips with the same 6-step preamble.
  - Route manifest `apps/web/dist/server/assets/_tanstack-start-manifest_v-BWj36htj.js`: the `/pulls/$pullNumber` preloads do not include the two `runs._runId-*` chunks, `rotate-ccw`, or `badge.ariakit.react`.
  - The link is a normal entry point: `apps/web/src/api/pre-run-checks.ts:511` and `apps/web/src/operations/review-links.ts:65` build `/pulls/<n>?check=<id>`.
  - The run ID is not secret: `apps/web/src/operations/checks.ts:29` puts `/runs/<id>` in the check details URL.
- What happens: The page loads, hydrates, asks for the run ID, navigates in the client, loads the run route chunks, and then asks for the model. The session, account, and schema checks run two times.
- Impact: Estimate with the unit cost of REVIEW-02: 8 × 125 to 165 ms = 1.0 to 1.3 s more before sequence A starts, plus 4 lazy chunks (56,613 bytes brotli). The user reads two different loading texts in a row.
- Recommendation: Resolve the check on the server during the document request and answer with a redirect when a run is ready.

  ```ts
  // server.ts, before render(request)
  const pull = /^\/pulls\/([1-9][0-9]{0,9})$/.exec(url.pathname);
  if (pull && request.method === "GET") {
    const runId = await readyRunForCheck(env.DB, Number(pull[1]), url.searchParams.get("check"));
    if (runId) return Response.redirect(new URL(`/runs/${runId}`, url.origin), 302);
  }
  ```

  The two D1 reads at `review.ts:742-771` can be one joined statement.

- Alternatives:
  - Minimal: keep the page, and let `GET /api/pulls/:n` return the review model when the run is ready. The client seeds the run route with it. This removes the second preamble.
  - Preload the run route chunks on the pull-request page (`router.preloadRoute`) while the lookup runs.
  - Start the lookup from an inline script, as in REVIEW-10.
- Maintainer decision needed: yes. The redirect answers without a session. Is it acceptable that a valid check ID resolves to its run ID for a signed-out visitor?

### REVIEW-12 · Hashed assets are revalidated on each load, and main navigation reloads the document

- Kind: performance
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - M5: `curl -sI https://preview.visonaut.com/assets/index-B_S44ggR.js` returns `cache-control: public, max-age=0, must-revalidate` and `cf-cache-status: HIT`. The CSS file and `/favicon.svg` return the same header.
  - `apps/web/public/` contains only `favicon.svg`. There is no `_headers` file.
  - M1, warm cache: each of the 10 assets has `transferSize: 300` and `encodedBodySize: 0` (a 304 response).
  - M1: `/favicon.svg` appears again in the resources of each save sample, after the route search changes.
  - `apps/web/src/components/app-shell.tsx:53-58`: `<NavLink key={id} href={href} …>`. `apps/web/src/review/review-workspace.tsx:580`: `<Button $p={1} render={<a href="/" />}>`. These are plain anchors, not router links.
  - `apps/web/src/router.tsx:8`: `createRouter({ routeTree, scrollRestoration: true, ssr: { nonce: scriptNonce() } })`. No `defaultPreload`.
- What happens: File names contain a content hash, but the default asset header makes the browser ask "did this change?" for each file on each load. The header navigation and the "Queue" button load a new document, so this happens on each page change. Links from the queue to a run are router links, but they do not preload.
- Impact: 10 conditional requests for each document load, and 1 favicon request for each variant change. Each is one edge round trip (about 25 to 35 ms here). The cost is small beside the API cost, but it is on each navigation.
- Recommendation: Add a `_headers` file, use router links in the header, and enable intent preload.

  ```text
  # apps/web/public/_headers
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  /favicon.svg
    Cache-Control: public, max-age=86400
  ```

  ```ts
  createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true, ssr: { nonce } });
  ```

- Alternatives:
  - Minimal: only the `_headers` file.
  - Keep plain anchors if a full reload between sections is intended (it resets all client state).
- Maintainer decision needed: no.

### REVIEW-13 · The waits show text only, the layout moves, and a signed-out visitor waits for a 401

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/routes/runs.$runId.tsx:66-74`: `<Text render={<p />} role="status" className="text-sm opacity-60"> Checking access and loading this run… </Text>`. Screenshot `screens/run-1-checking-access-dark.png`: the page has the header and one grey line at x = 336, y = 70. There is no sidebar, toolbar, or viewer frame.
  - `apps/web/src/review/review-workspace.tsx:940-949`: `{evidence.status === "loading" && !terminalComparison && (<div … role="status"> … "Loading this comparison's images…"`, and `apps/web/src/components/screenshot-viewer.tsx:173-180`: `"Loading image…"` in each pane. Screenshot `screens/run-2-loading-images-dark.png` shows three loading texts at the same time.
  - Screenshots `run-2-loading-images-dark.png` and `run-3-images-ready-dark.png` at 1440 × 900: the "Baseline" pane caption is at y = 448 while loading and at y = 407 when ready.
  - `apps/web/src/routes/runs.$runId.tsx:42-44`: `if (error instanceof ReviewCommandError && error.status === 401) { return { status: "guest" as const }; }`. M5: the 401 for `GET /api/runs/<id>` takes 515 to 569 ms in production.
  - `apps/web/src/routes/pulls.$pullNumber.tsx:180-182`: `Finding this pull request's visual review…`, and then the run page shows its own text.
- What happens:
  1. While the model loads, the page has no shape of the workspace. When the model arrives, the full layout changes in one step.
  2. For each variant change with images that are not cached, a status row appears above the panes and goes away. The panes move down and up by 41 px.
  3. A visitor without a session cookie sees "Checking access and loading this run…" until the API answers 401. Then the sign-in card appears.
- Impact: The wait feels longer because nothing stable is on screen. The image jump happens on each step of a review. A first-time visitor from a GitHub check waits for a request that cannot succeed.
- Recommendation:
  - Render the workspace frame (sidebar column, title bar, toolbar, two empty panes) as the pending component. Fill it when data arrives.
  - Reserve the status row, or put the loading state inside the panes only. One loading signal is sufficient.
  - On the server, when the request has no session cookie, mark the shell so the client shows the sign-in card at once.

    ```ts
    // server.ts render path: no D1 call, only a cookie name check.
    const signedOut = !request.headers.get("cookie")?.includes(".session_token=");
    // Expose it to the client, for example <html data-session="absent">; the loader returns { status: "guest" }.
    ```

- Alternatives:
  - Minimal: reserve the height of the status row (`min-height`) so the panes do not move.
  - Show the previous variant's images dimmed until the new ones are decoded, in place of an empty pane.
  - Keep the text, but shorten it to one word with a spinner.
- Maintainer decision needed: no.

### REVIEW-14 · The sidebar thumbnail has no source in current runs

- Kind: dead-code
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `apps/web/src/api/review.ts:505-507`: `...(typeof result.thumbnailImageId === "string" && imageById.has(result.thumbnailImageId) ? { thumbnail: `/images/${result.thumbnailImageId}` } : {}),`.
  - The only writers of `thumbnailImageId` are in the retired comparison Worker: `apps/compare/src/process.ts:191`, `206`, `228` and `apps/compare/container/transport.ts:207`.
  - The current result has no such field: `apps/web/src/api/workflow-materialize.ts:345-353`: `localResult: { outcome: …, changedPixels: …, ratio: …, engineVersion: …, codecVersion: …, maskExpected: !!result.mask, ...(result.mask ? { maskImageId: … } : {}), },`.
  - `apps/web/src/review/item-list.tsx:232-243`: `{thumbnail ? (<img className="review-thumbnail …" src={thumbnail} alt="" loading="lazy" />) : (<span className="review-thumbnail review-thumbnail-empty …"> — </span>)}`.
  - Screenshot `routes/saved-confirmation.png` (real Worker, M1): the sidebar row shows "—".
  - The browser test fixture has thumbnails: `apps/web/src/review/__tests__/fixture-model.ts:27`.
- What happens: New comparisons come only from local Submit receipts (`docs/current-contract.md:32`). Those results have no thumbnail. Each sidebar row of a current run shows a dash in a 2xl avatar slot.
- Impact: The slot uses sidebar width and shows nothing. The test fixture shows a state that a new production run cannot reach. If thumbnails come back as separate images, each one costs a Worker, D1, and R2 request (REVIEW-08).
- Recommendation: Decide the purpose of the slot. If rows need a picture, derive it from the candidate image of the first changed variant.
- Alternatives:
  - Minimal: remove the slot and `itemThumbnail` (`apps/web/src/review/navigation.ts:177-179`).
  - Use the candidate image URL with CSS scaling and `loading="lazy"`. No new storage, but full-size downloads.
  - Use Cloudflare image resizing in front of `/images/:id` (`/cdn-cgi/image/width=96/…`). This needs the zone feature and a cacheable image route (REVIEW-08).
  - Make a thumbnail in the trusted Submit job and add its ID to the local result.
- Maintainer decision needed: yes. Should sidebar rows show a picture?

### REVIEW-15 · A cold isolate makes three GitHub calls in sequence before any data is read

- Kind: performance
- Severity: medium. Confidence: medium. Measured: yes (counts). Effort: M
- Evidence:
  - `packages/security/src/github.ts:102`: `const installationTokens = new WeakMap<typeof fetch, Map<string, InstallationToken>>();` and `:193`: `const loginHints = new Map<string, string>();`. Both live in module memory.
  - `packages/security/src/github.ts:251-256`: `const user = record(await client.request(`/user/${id}`)); … const identity = await checkPermission(login);`.
  - M2, cold: `githubRequests: ["/app/installations/34/access_tokens", "/user/42", "/repos/fixture/repository/collaborators/fixture-maintainer/permission"]`.
  - `packages/security/src/github.ts:78`: `signal: init?.signal ?? AbortSignal.timeout(15_000),`.
- What happens: After an isolate starts, the first private request signs an App JWT, gets an installation token, resolves the login from the numeric ID, and then reads the permission. The three calls are sequential. The repository permission wait is part of "Checking access".
- Impact: Three more network round trips on the first request after an idle period or a deploy. I did not measure how often production isolates are cold, and I did not measure the latency of the GitHub API from the Worker.
- Recommendation: Store the login at sign-in (better-auth has the GitHub profile then) and read it with the account row. That removes `GET /user/:id` on cold isolates. Get the installation token in parallel with the session lookup.
- Alternatives:
  - Minimal: start `authorize()` (token) at the same time as `auth.api.getSession`, and discard it when there is no session. The comment at `github.ts:165` says the token is minted only after a verified session, so this needs a decision.
  - Persist the login hint in D1 after the first successful check.
  - Keep the current behavior and rely on REVIEW-02 to make the other waits small.
- Maintainer decision needed: yes. Can the App token be minted before the session is verified?

## Measurements (command, raw result, limits)

All outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/review-load/`. No file in the repository was written (`git status --short` shows only `pnpm-lock.yaml` and `apps/lab/` from another task).

### M1 · Built Worker route probe (existing tool, existing build)

Command (the existing `apps/web/dist` build from 16:23 was used; no build was run):

```sh
env REVIEW_ROUTE_PORT=4193 REVIEW_ROUTE_OUTPUT=<scratch>/routes SAMPLES=3 \
  node apps/web/tooling/review-scale/local-routes.mjs
node <scratch>/summarize-routes.mjs <scratch>/routes/measurements.json
```

Raw result (`routes/measurements.json`, 12 samples, Chrome 154.0.8037.98, Apple M4 Pro, 1280 × 900):

| Profile                          | Cache | Open run to first image, p50 / max | Approve to "Saved", p50 / max |
| -------------------------------- | ----- | ---------------------------------: | ----------------------------: |
| local                            | cold  |                       271 / 522 ms |                892 / 1,353 ms |
| local                            | warm  |                       229 / 248 ms |                  916 / 984 ms |
| slow (4 × CPU, 150 ms, 200 KB/s) | cold  |                   2,777 / 2,874 ms |              1,555 / 1,559 ms |
| slow                             | warm  |                   1,198 / 1,230 ms |              1,486 / 1,486 ms |

One "slow, cold" sample, resource timing in ms (start, end):

```text
/assets/index-CXm4JU5N.css        168.6  1582.6   transfer 60425
/assets/index-MxeSnhFR.js         169.2  1793.8   transfer 101615
/assets/runs._runId-QUJlDVZ1.js   169.3  1515.9   transfer 44374
/api/runs/<id>                   1874.7  2041.2   transfer 1277
/images/<id>                     2596.4  2752.3   transfer 394
-- after Approve at 3067 --
/api/review-sessions             3067.0  3240.5
/images/<id> (next variant)      3067.1  3225.8
/api/comparisons/<id>/commands   3277.4  3450.2
/api/commands/<id>/queued        3952.4  4118.9   (the app's first poll, 500 ms after the 202)
```

GitHub requests recorded by the harness for 12 cycles: 1 token, 1 `/user/42`, 48 permission, 5 check-run reads.

Limits: a synthetic run with 3 variants and one 94-byte image. Legacy storage (no R2 inventory). Local D1 and R2 with no network latency. The harness also polls the receipt by itself, so its "Approve to Saved" value includes harness time. Use the resource timing for the app's own requests.

### M2 · D1, R2, and GitHub counts for each HTTP path (scratch probe)

Command:

```sh
pnpm exec vitest run --config <scratch>/probe/vitest.config.ts api-path
```

The probe (`probe/api-path.cost.ts`) calls the real `handleApi` with native Miniflare D1 and R2, a local GitHub responder, and a signed session cookie. It uses the same 3-variant fixture as M1. A proxy records each `first`, `all`, `run`, and `batch` call with the native `rows_read` and `rows_written`. Raw result (`probe/api-path.json`, which also has the ordered SQL for each request):

| Request                                      | Status | D1 round trips at response | Statements |          With `waitUntil` work | Rows read |     R2 | GitHub |
| -------------------------------------------- | -----: | -------------------------: | ---------: | -----------------------------: | --------: | -----: | -----: |
| `GET /api/runs/:id`, cold isolate            |    200 |                         19 |         99 |                             19 |       941 |      0 |      3 |
| `GET /api/runs/:id`, permission cached       |    200 |                         19 |         99 |                             19 |       941 |      0 |      0 |
| `GET /api/runs/:id/state`                    |    200 |                         13 |         87 |                             13 |       869 |      0 |      0 |
| `GET /images/:id`                            |    200 |                          1 |          1 |                              1 |         1 |  1 get |      0 |
| `GET /images/:id` with `If-None-Match`       |    304 |                          1 |          1 |                              1 |         1 | 1 head |      0 |
| `GET /api/pulls/:n?check=…`, cold isolate    |    200 |                          8 |         82 |                              8 |       862 |      0 |      3 |
| `POST /api/review-sessions`                  |    201 |                          7 |         81 |                              7 |       860 |      0 |      1 |
| `POST /api/comparisons/:id/commands` (first) |    202 |                         11 |         87 | 24 round trips, 117 statements |       911 |      0 |      1 |
| `GET /api/commands/:id/queued` (complete)    |    200 |                         23 |        103 |                             23 |       950 |      0 |      0 |
| `POST …/commands` (second, under 10 s)       |    202 |                         12 |         88 | 26 round trips, 119 statements |       916 |      0 |      0 |
| `POST /api/commands/:id/undo`                |    200 |                         30 |        125 |                             30 |       973 |      0 |      1 |
| `GET /api/runs/:id` right after a write      |    200 |                         19 |         99 |                             19 |       946 |      0 |      1 |

The schema check is 2 round trips, 76 statements, and 856 rows read in each private request.

Limits: counts only. Local timing has no meaning for production. The fixture is a legacy run, so `reviewModel` has 13 round trips here and 15 for an inventory run (M3). The first version of the probe used a session that expired in 1 hour, which made better-auth write a session refresh. The final run uses a 7-day session.

### M3 · Review model cost for inventory runs at scale (scratch probe)

Command:

```sh
pnpm exec vitest run --config <scratch>/probe/vitest.config.ts inventory-scale
```

The probe (`probe/inventory-scale.cost.ts`) adapts `sparseFixture` from `apps/web/src/operations/sparse-storage.test.ts`. It builds a baseline inventory and a run inventory with the real `writeCaptureInventory`, commits the run with the real service, and calls the real `reviewModel` 6 times. Raw result (`probe/inventory-scale.json`):

| Captures | Changed | Run inventory bytes | Baseline inventory bytes | D1 round trips | R2 GETs | Model bytes raw / gzip / brotli | First call | Median of next 5 | Client parse |
| -------: | ------: | ------------------: | -----------------------: | -------------: | ------: | ------------------------------- | ---------: | ---------------: | -----------: |
|      600 |       4 |             999,613 |                  565,093 |             15 |       2 | 358,747 / 36,142 / 25,503       |      33 ms |            29 ms |       1.4 ms |
|    1,058 |       4 |           1,764,153 |                  997,487 |             15 |       2 | 632,742 / 62,207 / 43,795       |      49 ms |            46 ms |       1.5 ms |
|    3,582 |       4 |           5,993,161 |                3,391,523 |             15 |       2 | 2,153,156 / 205,102 / 143,985   |     186 ms |           166 ms |       4.4 ms |
|    7,164 |       4 |          11,999,368 |                6,791,333 |             15 |       2 | 4,311,393 / 407,671 / 286,616   |     320 ms |           332 ms |       7.6 ms |

A scenario with 10,580 captures failed in `writeCaptureInventory` with "Capture inventory exceeds its size limit." (16 MiB).

Limits: the database is the in-memory `node:sqlite` test database and R2 is the in-memory `MemoryStore`, so the times are CPU in Node on an M4 Pro, not Workers CPU and not network. The fixture uses one capture profile, one test, 6 variants for each item, and item keys of about 45 characters. Real inventories have other key lengths and more profiles and tests. Byte sizes are thus an order of magnitude, not exact.

### M4 · Screenshots of each wait

Command: `node <scratch>/loading-states.mjs`. It delays `/api/runs/*`, `/images/*`, and `/api/pulls/*` in the browser with Playwright routes against the preview server at `127.0.0.1:4310`. For the image state, it rewrites the fixture image URLs to `/images/<uuid>` in the browser.

Result: 8 files in `screens/` (dark and light). Position of the "Baseline" caption at 1440 × 900: y = 448 while images load, y = 407 when ready.

Limits: preview fixtures (1 item, 2 variants). The delays are artificial.

### M5 · Signed-out production timing and public headers

Commands (plain `GET` and `HEAD`, no credentials, 29 requests to `visonaut.com` and 4 to `preview.visonaut.com`):

```sh
curl -sS -o /dev/null -w "%{url_effective} http=%{response_code} ttfb=%{time_starttransfer}\n" \
  https://visonaut.com/health https://visonaut.com/api/runs https://visonaut.com/api/operations …
curl -sI https://preview.visonaut.com/assets/index-B_S44ggR.js
```

Raw result (`production-timing-clean.txt`), TTFB in seconds on a reused connection:

```text
/health                                   0.023 0.034 0.031 0.033            (first on the connection: 0.109)
/api/runs                 401             0.363 0.343 0.352 0.402            (first: 0.589)
/api/operations           401             0.488 0.524 0.458 0.444 0.517
/runs/<uuid>              200 (HTML)      0.151 0.097 0.056
/pulls/1?check=x          200 (HTML)      0.049 0.046
/api/runs/<uuid>          401             0.515 0.569
/api/pulls/1?check=x      401             0.586
/images/<uuid>            404             0.154 0.154 0.154
cf-ray: a45ee5ddfe164812-GRU
preview asset: cache-control: public, max-age=0, must-revalidate; cf-cache-status: HIT; content-encoding: br
```

The production HTML shell (`production-run-shell.html`) contains "Checking access and loading this run…", 1 stylesheet link, and 9 `modulepreload` links.

Limits: 2 to 5 samples for each path, from one machine and one network. Only signed-out paths. No signed-in request, no real image, and no R2 read was timed. The asset header was read on the preview deployment, which serves an older build than production.

### M6 · Client asset sizes

Command: a Node one-liner that reads `apps/web/dist/client/assets` and computes gzip (level 9) and brotli sizes.

| File                              |           Raw |        gzip |      brotli |
| --------------------------------- | ------------: | ----------: | ----------: |
| `index-CXm4JU5N.css`              |       464,666 |      59,500 |      32,868 |
| `index-MxeSnhFR.js`               |       319,611 |     101,143 |      88,286 |
| `app-shell-rQLLgOsf.js`           |       139,641 |      40,104 |      35,550 |
| `runs._runId-QUJlDVZ1.js`         |       137,841 |      43,996 |      38,500 |
| `badge.ariakit.react-CyMRzBLT.js` |        53,323 |      19,375 |      17,471 |
| `react-Dfu8Q4go.js`               |        31,168 |      11,684 |      10,453 |
| `preload-helper-B-8p3_4s.js`      |        15,947 |       6,536 |       5,951 |
| 3 small chunks                    |         1,374 |         937 |         798 |
| **Run page total**                | **1,163,571** | **283,275** | **229,877** |

Limits: the build was made by another task at 16:23. I did not rebuild it. Its file names match production.

## Open questions and items not verified

1. **D1 primary location.** I did not run `wrangler d1 info` (remote command). The 125 to 165 ms unit cost is consistent with a database that is far from `GRU`, but the location is not verified.
2. **Signed-in production timing.** All estimates for signed-in requests are "counted round trips × measured unit cost". A production trace of one `GET /api/runs/:id` (traces are enabled in `apps/web/wrangler.jsonc:15-20`) gives the real number and the R2 and GitHub parts.
3. **R2 latency.** I did not time a real inventory read or a real image read. The bucket location is not verified.
4. **GitHub API latency from the Worker**, and how often production isolates are cold. Not measured.
5. **Real inventory and model sizes.** M3 is synthetic. Production values are in `visonaut_runs.inventory_bytes` and in the `content-length` of `/api/runs/:id`.
6. **Compression of the model response.** HTML is compressed at the edge (`content-encoding: br` and `gzip` seen). I assume the same for `application/json`, but I did not see a large signed-in JSON response.
7. **Smart Placement effect.** The recommendation in REVIEW-02 is from the counts and the unit cost. Its effect on this Worker is not measured.
8. **Workers CPU time** for `reviewModel` at scale. M3 is Node on an M4 Pro.
9. **Edge cache rules on the zone.** I read only response headers. A zone-level Cache Rule for `/images/*` could exist. `cf-cache-status` was not checked for a real image because image IDs come only from signed-in models.
10. **Why `ssr: false`** is set for the run route. The comment explains `pendingMinMs`, not the SSR choice.
11. **The preview deployment** (`preview.visonaut.com`) serves an older build (its header shows "All runs" and other asset names). This is outside this lane. I did not check the deploy workflow.
12. **`apps/web/tooling/review-scale/fixtures.mjs`** builds the non-compact model shape and gives it directly to `ReviewWorkspace`. The scale evidence in `docs/evidence/review-scale/README.md` thus does not include `parseReviewModel` or the `compact-review-1` wire format, and its byte sizes are for the old shape.
13. **Report file.** The harness blocked the write of `report.md` for this subagent. This text is the report.
