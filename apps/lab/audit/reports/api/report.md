# HTTP API surface and ingest pipeline

Scope: `apps/web/src/api/*.ts` (25 production modules, 9,798 lines; 10 test files, 13,655 lines), the Worker entry `apps/web/src/server.ts`, and the parts of `packages/security` and `packages/service` that every request uses.

All paths below are relative to the repository root. `api/` means `apps/web/src/api/`.

Read-only audit. Nothing in the repository was changed. Probes live in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/api/`.

## How it works (map)

### Request entry

1. `apps/web/src/server.ts:56-128` is the Worker `fetch` handler.
   - `/health` returns a label (`server.ts:60-71`).
   - In `preview`, the Worker serves fixtures and the app only (`server.ts:73-80`).
   - `/api/auth/*` goes to Better Auth (`server.ts:82-87`).
   - `/api/me` runs the maintainer check and returns `{ userId }` (`server.ts:88-105`).
   - `/api/*`, `/v1/*`, `/images/*`, `/webhooks/github` go to `handleApi` (`server.ts:106-117`).
   - All other paths go to the TanStack Start renderer (`server.ts:118`).
2. `handleApi` (`api/index.ts:86-227`) is one `if` chain. The order sets the auth zone:
   1. Origin check (`index.ts:110-112`).
   2. Public images (`index.ts:113-122`). No auth.
   3. `assertConfiguredProject`: 1 D1 read (`index.ts:123-126`). Skipped for `/api/auth/*` and `GET /api/runs`.
   4. Webhook receiver (`index.ts:127-129`). HMAC only.
   5. `createAuth(...)` builds a new Better Auth instance for this request (`index.ts:130`).
   6. Capture routes under `/v1` (`index.ts:134-189`). GitHub OIDC or a short-lived capability token.
   7. `createGitHubClient` + `requireMaintainer` (`index.ts:191-205`). Session, linked account, and repository write permission.
   8. `requireSameOrigin` for non-GET methods (`index.ts:206-208`).
   9. `GET /v1/runs/:id` or `handleReview` (`index.ts:209-213`), then a 404 fallback (`index.ts:214-219`).
   10. Every thrown error goes through `errorResponse` (`index.ts:35-84`, `224-226`).
3. `handleReview` (`api/review.ts:699-989`) is a second `if` chain for the browser API.

### Route table

Auth legend: **none**; **HMAC** = GitHub webhook signature; **OIDC** = GitHub Actions ID token verified by `verifyGitHubOidc`; **cap** = ingest capability JWT, 10 minutes (`packages/security/src/capabilities.ts:138-144`); **read / review / write** = maintainer session with the permission cache class in `packages/security/src/authorization.ts:21-23,61-63`.

| #   | Method    | Path                                            | Auth                  | Handler                                                     | Purpose                                                | Status                                                                                                                                                      |
| --- | --------- | ----------------------------------------------- | --------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GET       | `/health`                                       | none                  | `server.ts:60-71`                                           | Environment label                                      | current                                                                                                                                                     |
| 2   | any       | `/api/auth/*`                                   | Better Auth           | `server.ts:82-87`                                           | Sign in, sign out, session                             | current. The copy at `index.ts:131-133` is not reachable from `server.ts`                                                                                   |
| 3   | GET       | `/api/me`                                       | read                  | `server.ts:88-105`                                          | `{ userId }`                                           | no caller in `apps/web/src`; used by `apps/web/tooling/review-scale/local-routes.mjs:273` only                                                              |
| 4   | GET, HEAD | `/images/:id`                                   | none                  | `images.ts:11-67`                                           | Validated image bytes                                  | current                                                                                                                                                     |
| 5   | POST      | `/v1/webhooks`                                  | HMAC                  | `webhooks.ts:338-360`                                       | GitHub App deliveries                                  | current                                                                                                                                                     |
| 6   | POST      | `/webhooks/github`                              | HMAC                  | same (`index.ts:127`)                                       | Old receiver URL                                       | legacy alias                                                                                                                                                |
| 7   | POST      | `/v1/plan`                                      | OIDC (Plan job)       | `pre-run.ts:49-157`                                         | Signed "no visual capture" result                      | current                                                                                                                                                     |
| 8   | POST      | `/v1/runs/{githubRunId}/begin`                  | OIDC (Submit job)     | `workflow-owned.ts:293-325`                                 | Create or bind the App check before Submit work        | current                                                                                                                                                     |
| 9   | POST      | `/v1/runs`                                      | OIDC (Submit job)     | `workflow-owned.ts:327-395`                                 | Reserve a staged run, return a capability              | current. Non-local mode is rejected (`workflow-owned.ts:175-187`)                                                                                           |
| 10  | POST      | `/v1/runs/{runUuid}/reference`                  | cap                   | `workflow-owned.ts:277-280` → `local-comparison.ts:291-450` | Select and page the reference inventory (200 per page) | current                                                                                                                                                     |
| 11  | GET, HEAD | `/v1/runs/{runUuid}/reference/images/{imageId}` | cap with reference    | `workflow-owned.ts:282-290` → `local-comparison.ts:452-486` | Reference image bytes for the CLI                      | current                                                                                                                                                     |
| 12  | POST      | `/v1/runs/{runUuid}/shards/{key}`               | cap                   | `workflow-owned.ts:476-759`                                 | Declare the manifest and the local receipt             | current. Only `combined` is accepted (`workflow-owned.ts:153-165`)                                                                                          |
| 13  | POST      | `/v1/runs/{runUuid}/reuse`                      | cap                   | `workflow-owned.ts:807-1003`                                | Copy already-stored bytes after a proof                | current                                                                                                                                                     |
| 14  | PUT       | `/v1/uploads/{ticket}`                          | cap + upload ticket   | `workflow-owned.ts:1005-1122`                               | Upload one image                                       | current. The comparator call inside is not reachable (API-12)                                                                                               |
| 15  | POST      | `/v1/runs/{runUuid}/finalize`                   | cap                   | `workflow-owned.ts:1124-1171`                               | Mark the staged manifest complete                      | current                                                                                                                                                     |
| 16  | POST      | `/v1/runs/{githubRunId}/submit`                 | OIDC (Submit job)     | `workflow-owned.ts:1173-1289`                               | Record signed Submit, wake the queue                   | current                                                                                                                                                     |
| 17  | GET       | `/v1/runs/{runUuid}`                            | read (bearer session) | `ingest.ts:27-56`                                           | CLI `visonaut status`                                  | current                                                                                                                                                     |
| 18  | GET       | `/api/runs`                                     | read                  | `dashboard.ts:32-147`                                       | Dashboard lists                                        | current                                                                                                                                                     |
| 19  | GET       | `/api/operations`                               | read                  | `operations.ts:6-54`                                        | Service alerts                                         | current                                                                                                                                                     |
| 20  | GET       | `/api/session`                                  | read                  | `review.ts:713-721`                                         | `{ user }`                                             | no caller found in the repository                                                                                                                           |
| 21  | POST      | `/api/review-sessions`                          | write (live check)    | `review.ts:722-731`                                         | Bind later commands to this sign-in                    | current                                                                                                                                                     |
| 22  | GET       | `/api/pulls/:number?check=`                     | read                  | `review.ts:735-784`                                         | Map an App check to its run                            | current. See API-03                                                                                                                                         |
| 23  | GET       | `/api/runs/:id[?comparison=]`                   | read                  | `review.ts:785-791` → `reviewModel` `227-617`               | Review model                                           | current                                                                                                                                                     |
| 24  | GET       | `/api/runs/:id/state`                           | read                  | `review.ts:792-798` → `reviewPollState` `104-149`           | Poll while a run is not ready                          | current                                                                                                                                                     |
| 25  | POST      | `/api/comparisons/:id/commands`                 | review (10 s cache)   | `review.ts:837-914`                                         | Approve or reject                                      | current. The web client always sends `queued: true` (`apps/web/src/review/client.ts:317`); the synchronous branch `review.ts:879-904` has no product caller |
| 26  | GET       | `/api/commands/:id/queued`                      | read                  | `review.ts:799-836`                                         | Receipt for a queued decision                          | current                                                                                                                                                     |
| 27  | POST      | `/api/commands/:id/undo`                        | write (live check)    | `review.ts:915-949`                                         | Undo                                                   | current                                                                                                                                                     |
| 28  | POST      | `/api/runs/:id/recompare`                       | write (live check)    | `review.ts:950-987`                                         | Always throws 409                                      | tombstone (`docs/operations/retire-server-comparison.md:17`)                                                                                                |

`docs/current-contract.md:34` records that the two product export endpoints are removed. No export route remains in `api/`.

### Capture and Submit sequence (one visual run)

1. Plan job, only when no visual work is needed: `POST /v1/plan` (`pre-run.ts:49`). It verifies OIDC, reads the Plan job from GitHub, and completes the App check (`pre-run-plan.ts:165-196`).
2. Submit job: `POST /v1/runs/{githubRunId}/begin` (`workflow-owned.ts:293`). OIDC, then `ensureSignedAttemptCheck` (`pre-run-attempts.ts:690-879`) creates or binds the `Visonaut` check.
3. `POST /v1/runs` (`workflow-owned.ts:327`). OIDC again. Inserts `ingest_staged_runs` and `ingest_staged_bundles`. Returns a capability.
4. `POST /v1/runs/{uuid}/reference`, once per 200 reference captures (`local-comparison.ts:45,423-449`). The first call selects the reference: `verifyAncestry` (`ingest.ts:6-25`), pins, and a write to `verified_json.localReference` (`local-comparison.ts:308-411`). Each call returns a new capability that carries the reference.
5. The CLI compares locally. It downloads a reference image only when the digest differs (`packages/cli/src/local-comparison.ts:260-281`).
6. `POST /v1/runs/{uuid}/shards/combined` (`workflow-owned.ts:476`). Validates provenance and the local receipt (`local-comparison.ts:488-602`), stores the manifest in the QUARANTINE bucket (`workflow-evidence.ts:178-209`), inserts image descriptors, returns upload tickets and a reuse challenge.
7. `POST /v1/runs/{uuid}/reuse` in pages of 32 (`workflow-owned.ts:104,807`), then `PUT /v1/uploads/{ticket}` for the rest (`workflow-owned.ts:1005`).
8. `POST /v1/runs/{uuid}/finalize` (`workflow-owned.ts:1124`).
9. `POST /v1/runs/{githubRunId}/submit` (`workflow-owned.ts:1173`). OIDC a third time. Sets `submitted_at` and sends `{ kind: "ingest" }` to the OPERATIONS queue (`workflow-owned.ts:1279`).
10. Materialization (`workflow-materialize.ts:494-820`). Three triggers start it: the queue message from step 9, the `check_run` webhook (`webhooks.ts:225-250`), and the `workflow_run` webhook, which calls it inline (`webhooks.ts:267-275`). The cron recovery also retries it (`apps/web/src/runtime.ts:368-374`).
    It reconciles the GitHub job set (`workflow-reconcile.ts:198-373`), verifies lineage (`lineage.ts:546-594`) and ancestry (`ingest.ts:6-25`), reserves the service run, registers images, writes the R2 inventory, commits, seals, creates the comparison, and finalizes it.

### Webhook sequence

1. `receiveWebhook` (`webhooks.ts:338-360`): verify HMAC (`packages/security/src/webhooks.ts:19-81`), check scope (`webhooks.ts:34-106`), `INSERT` then `SELECT` the delivery (`packages/security/src/webhooks.ts:84-115`), answer `202`.
2. `processWebhook` runs in `waitUntil` (`webhooks.ts:350-357`). It runs the project check again (`webhooks.ts:157`), reads the restore fence (`webhooks.ts:159-177`), does the event work, then sets `processed_at` and replaces the payload with `'{}'` (`webhooks.ts:330-335`).
3. A failed delivery stays with `processed_at IS NULL`. `reconcileWebhooks` (`webhooks.ts:362-395`) retries up to 25 of them on every recovery message. The cron sends one every 5 minutes (`apps/web/wrangler.jsonc:110`).

GitHub requests per event, counted from the code (not measured):

| Event                                        | GitHub requests                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `push` to main                               | 2: main ref (`pre-run-candidates.ts:29`), workflow file (`pre-run-checks.ts:66`)                                                                                                                                                      |
| `pull_request`, any action                   | at least 1: the pull (`webhooks.ts:282`)                                                                                                                                                                                              |
| `pull_request` opened / synchronize / edited | at least 6: pull twice (`webhooks.ts:282`, `pre-run-candidates.ts:58`), `mergeBaseForHead` = 3 (`merge.ts:44-58`), merge ref (`pre-run-candidates.ts:84`). Add 4 for each active run on an older merge commit (`webhooks.ts:295-315`) |
| `workflow_run` for the CI workflow           | 1 run read (`pre-run-attempts.ts:893`) plus candidate checks; on `completed` + success it runs the whole materialization inline                                                                                                       |
| `check_run` completed for the Submit job     | 0, 1 queue message (`webhooks.ts:248`)                                                                                                                                                                                                |
| any other event                              | 0                                                                                                                                                                                                                                     |

### Browser API sequence (one page view)

Measured with the real handlers on local D1 (see Measurements, M1).

| Page                | Request                                       | D1 round trips before the response                                                                                                            |
| ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard           | `GET /api/runs`                               | 6                                                                                                                                             |
| Dashboard header    | `GET /api/operations` (sent at the same time) | 9                                                                                                                                             |
| Run page            | `GET /api/runs/:id`                           | 19 for a run without an R2 inventory. A run with an inventory adds 2 D1 reads and 2 complete R2 inventory reads (`review-inventory.ts:43-48`) |
| Run page, not ready | `GET /api/runs/:id/state` every poll          | 13                                                                                                                                            |
| Pull page           | `GET /api/pulls/:n?check=`                    | 8                                                                                                                                             |

The first 6 round trips are the same for every private request: project, 2 for the Better Auth schema check (API-01), session, user, account.

## Findings

### API-01 · Better Auth scans the database schema on every private request

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/auth.ts:15-21`: `/** Create inside each request so a D1 binding cannot cross request ownership. */ export function createAuth(...) { ... return betterAuth({`. No `advanced.database` option is set (`auth.ts:47-51`).
  - Callers build one instance per request: `api/index.ts:130`, `server.ts:85`, `server.ts:93`.
  - Better Auth 1.7.5 validates the schema once per instance and waits for it. `better-auth/dist/api/to-auth-endpoints.mjs:40-41`: `const pendingSchemaCheck = rawContext.checkSchema?.(); if (pendingSchemaCheck) await pendingSchemaCheck;`. `@better-auth/core/dist/db/schema-check.mjs:7-9`: `return options.advanced?.database?.validateSchema !== false;`. The D1 dialect reads `sqlite_master` and then sends one `pragma_table_info(?)` statement per table (`@better-auth/kysely-adapter/dist/d1-sqlite-dialect-*.mjs:88-97`).
  - M1: every private request starts with `select "name","type","sql" from "sqlite_master" ...` and a batch of 75 `SELECT * FROM pragma_table_info(?)`. A request with no session at all: `GET /api/runs → 401`, 2 round trips, 76 statements, 856 rows read.
  - M2: the same request with `validateSchema: false` goes from 6 round trips and 80 statements to 4 round trips and 4 statements.
- What happens: the schema check result is cached inside the auth instance. Visonaut makes a new instance for each request, so the cache is always empty. `auth.api.getSession` waits for the scan before it reads the session.
- Impact: 2 extra serial D1 round trips and about 856 rows read before the access check starts, on every dashboard, review, poll, and command request. The queued-decision poll runs every 500 ms (`apps/web/src/review/client.ts:326-336`), so one reviewer can cause two 75-statement batches per second. Unauthenticated requests pay the same cost. This is a direct part of the "wait around checking access" delay. Production latency per round trip was not measured.
- Recommendation: turn the check off. Migrations are applied by Wrangler, and the security tests already apply the same schema.

  ```ts
  // packages/security/src/auth.ts
  advanced: {
    database: { validateSchema: false },
    cookiePrefix: `visonaut-${configuration.environment}`,
    // ...
  },
  ```

- Alternatives:
  - Keep the check but reuse one auth instance per isolate, in a `WeakMap` keyed by the D1 binding. M5 shows that `env.DB` is the same object across requests in local workerd. This also removes the per-request Better Auth setup work. It needs care with the "no pending I/O across requests" rule that `packages/security/src/github.ts:106` follows.
  - Run the schema check once in CI or in the deploy workflow.
- Maintainer decision needed: yes. Is the runtime schema check wanted at all? If not, the one-line option is enough.

### API-02 · Pull request titles cannot be found after the webhook is processed

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Readers take the title from the stored payload. `api/dashboard.ts:57-62`: `(SELECT json_extract(delivery.payload_json,'$.pull_request.title') FROM github_webhook_delivery delivery WHERE delivery.event='pull_request' AND CAST(json_extract(delivery.payload_json,'$.repository.id') AS TEXT)=project.repository_id ...`. `api/review.ts:288` has the same query.
  - The writer deletes the payload when the delivery is done. `api/webhooks.ts:330-335`: `"UPDATE github_webhook_delivery SET processed_at = ?, payload_json = '{}' WHERE delivery_id = ? AND payload_digest = ?"`. Also `webhooks.ts:150`, `webhooks.ts:172`.
  - History: payload compaction is commit `339926d` (2026-09-28, #129). The title index `apps/web/migrations/0028_pr_title_index.sql` and the readers came later in `5712036` (2026-09-30, #155).
  - M3 (SQLite): the lookup returns `Fix dialog focus` while the delivery is pending and an empty result after the settle statement.
  - The test hides the problem: `api/dashboard.test.ts:46-55` inserts a full payload together with a non-null `processed_at`. Production code never writes that state.
- What happens: a `pull_request` delivery is normally processed a few seconds after receipt. After that, no row matches the title query.
- Impact: the dashboard shows the generic kind label (`apps/web/src/routes/index.tsx:499,586,714`: `run.title ?? kindLabel(run.kind)`) and the run page shows `#123 · Pull request visual review` (`review.ts:561`). Search by title in the dashboard (`index.tsx:619`) finds nothing. Not verified against production data.
- Recommendation: keep the three small fields that the readers need when a `pull_request` delivery is settled. The current index and both readers keep working.

  ```sql
  UPDATE github_webhook_delivery
  SET processed_at = ?,
      payload_json = CASE WHEN event = 'pull_request' THEN json_object(
          'repository', json_object('id', json_extract(payload_json, '$.repository.id')),
          'pull_request', json_object(
            'number', json_extract(payload_json, '$.pull_request.number'),
            'title', json_extract(payload_json, '$.pull_request.title')))
        ELSE '{}' END
  WHERE delivery_id = ? AND payload_digest = ?
  ```

- Alternatives:
  - Store the title in its own place, for example a `title` column on `pre_run_checks` or a small `pull_requests(number, title, updated_at)` table, written in `processWebhook` where the pull is already fetched (`webhooks.ts:282`). The readers then stop parsing JSON.
  - Minimal: change the fixture in `dashboard.test.ts` to the real settled state so the test fails, then decide.
- Maintainer decision needed: yes. Should the title live in the delivery row or in a real column?

### API-03 · The pull page waits forever when the Plan selected no visual capture

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `api/review.ts:773-777`: `let state = "pending"; if (run?.state === "failed") state = "failed"; else if (run && run.sealedAt !== null) state = "ready"; else if (current?.state === "failed") state = "failed"; else if (current?.docsOnly) state = "not-required";`
  - No production code sets `docs_only` to 1. Every candidate has `docsOnly: false` (`pre-run-candidates.ts:38,99,128,197`, `pre-run-attempts.ts:753,822`), and `pre-run-attempts.ts:667` inserts `0`. The only writer of `docs_only=1` is a test `UPDATE` (`api/api.test.ts:752-757`).
  - The current no-visual path writes `plan_visual_required=0` (`pre-run.ts:140-152`) and `state='docs_complete'` (`pre-run-plan.ts:190-195`). The endpoint reads neither value for this purpose.
  - The check links to this page. `pre-run-checks.ts:508-514` sets `details_url` to `/pulls/{n}?check=...`. `completeNoVisualPlan` completes the check without a new `details_url` (`pre-run-plan.ts:178-189`).
  - M1: with a row in that exact state, `GET /api/pulls/43?check=...` returns `{"runId":null,"state":"pending"}`.
- What happens: the maintainer opens "Details" on a successful "Visual capture is not required" check. The page shows "Waiting for screenshots." and polls every 15 seconds (`apps/web/src/routes/pulls.$pullNumber.tsx:105-119,261`). It never changes.
- Impact: wrong message on every pull request without visual work, plus one full authenticated request every 15 seconds while the tab is visible. Assumption: GitHub keeps `details_url` when a PATCH omits it.
- Recommendation:

  ```ts
  // review.ts, select plan_visual_required AS planVisualRequired too
  else if (current.docsOnly || (current.state === "docs_complete" && current.planVisualRequired === 0))
    state = "not-required";
  ```

- Alternatives:
  - Set a different `details_url` (the pull request or the origin) when `completeNoVisualPlan` completes the check.
  - Remove `docs_only` from the code path entirely and derive the state from `plan_visual_required` (see API-13).
- Maintainer decision needed: no.

### API-04 · A missing run or comparison returns 409 `incomplete`, not 404

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/service/src/service.ts:92-98`: `if (!row) { throw new IncompleteError("The requested record does not exist."); }`.
  - `api/index.ts:55-66` maps `IncompleteError` to `409` with code `incomplete`.
  - `api/review.ts:89-95` (`projectRun`) calls `context.service.run(runId)` first and can only reach its own 404 when the row exists in another project.
  - M4: `GET /api/runs/<random uuid>` → `409 {"schemaVersion":"1.0","error":{"code":"incomplete","message":"The requested record does not exist."}}`.
- What happens: a wrong or expired run link is reported as a conflict.
- Impact: the review client marks every 409 as a conflict (`apps/web/src/review/client.ts:275`). The run page shows "The requested record does not exist." with a Retry button (`apps/web/src/routes/runs.$runId.tsx:76-107`). The same mapping applies to `service.comparison` and `service.project`.
- Recommendation: look up with the project in the query and throw the 404 that the handler already intends.

  ```ts
  const run = await context.database
    .prepare("SELECT * FROM visonaut_runs WHERE id = ? AND project_id = ?")
    .bind(runId, context.configuration.projectId)
    .first<RunRow>();
  if (!run) throw new SecurityError("not_found", 404, "The run was not found.");
  ```

- Alternatives: add a `NotFoundError` to `@visonaut/service` and map it to 404 in `errorResponse`. Minimal: leave the status and change only the client text.
- Maintainer decision needed: no.

### API-05 · Each private request repeats the same serial reads

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence (M1, statement order for `GET /api/runs/:id`):
  1. `visonaut_projects` (`index.ts:125`)
  2. and 3. schema scan (API-01)
  3. `session`, 5. `user` (`authorization.ts:32-36`)
  4. `account` (`authorization.ts:40-43`)
  5. `visonaut_runs` (`review.ts:90`)
  6. `visonaut_projects` again (`review.ts:292`)
  7. `visonaut_runs` again, 10. `visonaut_comparisons` (`run-status.ts:27,45`)
  8. batch of 3 (`review.ts:277-291`)
  9. `visonaut_comparisons` again (`review.ts:305`)
  10. `work_tasks`, 14. counts, 15. `visonaut_projects` a third time (`run-status.ts:48-61`)
  11. capture probe (`review.ts:315-322`)
  12. rows, 18. eligible approvals, 19. batch of 5 (`review.ts:323-365`)
  - Totals: 19 round trips, 99 statements. `GET /api/runs/:id/state`: 13 round trips, 2 reads of `visonaut_runs`, 2 of `visonaut_comparisons`. `GET /api/operations`: 9 round trips, the project is checked twice (`index.ts:125` and `operations.ts:16-29`). `GET /api/commands/:id/queued` when complete: 23 round trips, 4 reads of `visonaut_runs`.
  - The first decision in a review costs two live GitHub permission requests in a row: `POST /api/review-sessions` (write class) and then `POST /api/comparisons/:id/commands`. A write check deletes the cached entry and does not store a new one (`authorization.ts:71-82`). M1 shows 1 GitHub request for each.
- What happens: helpers each load their own rows. `service.status` reloads the run that the caller already has. The project is read once for the configuration check, once for the model, and once inside the status.
- Impact: the request waits for about 14 round trips in sequence on the run page (the two `Promise.all` groups overlap, the rest is serial). The serial depth, not the SQL cost, sets the wait. Production latency was not measured.
- Recommendation: load the shared rows once and pass them down. A sketch for the review model:

  ```ts
  const [runRow, projectRow, comparisonRow, counts, retained, historical, title] =
    await context.database.batch([/* run, project, comparison, review counts, ... */]);
  // reviewStatus({ run, comparison, pending, rejected, ... }) is already a pure function
  // (packages/service/src/review-status.ts); dashboard.ts:100-120 uses it this way.
  ```

  `dashboard.ts:68-90` is the model to follow: one batch that also verifies the project, so `index.ts:123` can skip the separate project read.

- Alternatives:
  - Minimal: skip `assertConfiguredProject` for the GET routes whose handler reads the project anyway, and let `reviewPollState` and `reviewModel` pass the loaded `run` into a `status` variant. This removes 3 to 4 round trips with small edits.
  - Larger: return the first model inside the document (server loader) so the browser does not make a second authenticated request. That is a page-architecture change outside this lane.
  - For the first decision: let a successful write-class check store the positive result for the 10-second review class.
- Maintainer decision needed: yes. May a live write check seed the 10-second decision cache? `docs/current-contract.md:204` says only that other writes "retain a live repository-permission check".

### API-06 · A cold isolate asks GitHub three times, and parallel requests repeat the work

- Kind: performance
- Severity: medium. Confidence: high for counts, low for production frequency. Measured: yes (counts). Effort: M
- Evidence:
  - Caches are module state in one isolate: `packages/security/src/github.ts:102` (installation token), `github.ts:193` (login hint), `packages/security/src/authorization.ts:19` (permission, 60 s).
  - M1, first request: `GET /api/session` makes 3 GitHub requests: `POST /app/installations/1/access_tokens`, `GET /user/42`, `GET /repos/.../collaborators/maintainer/permission`.
  - M1, cold isolate with the two dashboard requests in parallel: 6 GitHub requests (each of the three, twice) and 15 D1 round trips.
  - The dashboard sends both requests: `apps/web/src/routes/index.tsx:180` and `apps/web/src/components/operations-attention/index.tsx:233`.
- What happens: token, login, and permission are fetched in sequence before the handler runs. The in-flight token promise is per client object (`github.ts:133,169`), so two requests in the same isolate do not share it.
- Impact: on a cold isolate the user waits for 3 serial GitHub API calls plus the D1 prologue before any data loads. After 60 seconds without a request, one permission call returns. How often production isolates start cold was not measured.
- Recommendation: make one request per page do the access check. For the dashboard, return the alert summary in the `GET /api/runs` response, or load alerts after the list succeeds.
- Alternatives:
  - Store the login hint beside the account at sign-in, so the `/user/:id` call is not needed on a cold start.
  - Store the last positive permission time in D1 for the session, so a new isolate can honor the same 60-second rule without a GitHub call. This costs one D1 write per minute per active session.
  - Minimal: no code change; accept the cold path.
- Maintainer decision needed: yes. Is a D1-backed 60-second permission record acceptable under the rule in `docs/current-contract.md:186`?

### API-07 · Reference selection checks ancestry with up to 100 serial GitHub requests and does not stop early

- Kind: performance
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `api/ingest.ts:7-23`: `"SELECT DISTINCT tested_sha FROM visonaut_snapshots WHERE project_id = ? AND reference_eligible = 1 ORDER BY created_at DESC LIMIT 100"`, then `for (const snapshot of snapshots.results) { const comparison = object(await github.request(\`/repos/${github.repository}/compare/${snapshot.tested_sha}...${testedSha}\`)); ...`.
  - Callers: the first `/reference` page (`local-comparison.ts:313`) and every materialization (`workflow-materialize.ts:618`).
  - The first caller needs one answer. `local-comparison.ts:315-322` keeps the project snapshot if it is an ancestor, else the newest ancestor. For a main run only the project snapshot can qualify (`local-comparison.ts:317`).
  - The sibling function does it differently: `lineage.ts:453-465` orders the project snapshot first, returns at the first hit, and adds `?per_page=1`. `merge.ts:39` also adds `?per_page=1`. `ingest.ts:17` does not.
  - Snapshots stay eligible until 30 days after their run closes (`apps/web/src/operations/snapshot-retention.ts:198-204`, `packages/service/src/work.ts:695`). `docs/current-contract.md:236` records baseline revision 27 on 2026-10-03.
- What happens: one compare request per eligible snapshot commit, one after the other. Without `per_page`, each response can carry up to 250 commits and the file list.
- Impact: the CLI waits on the first reference page for N GitHub calls, where N is the number of accepted baselines in the last 30 days (capped at 100). Materialization pays the same N again. The response body limit is 4 MiB (`packages/security/src/github.ts:89`); a larger compare response fails as `github_unavailable`. Request times were not measured.
- Recommendation: for reference selection, test the project snapshot first and stop at the first ancestor. Add `?per_page=1`.

  ```ts
  for (const snapshot of orderedCurrentFirst) {
    if (await isAncestor(github, snapshot.tested_sha, testedSha)) return snapshot;
  }
  ```

- Alternatives:
  - Keep the full list for materialization (it feeds `verifiedAncestorShas`, `workflow-materialize.ts:681`) but run the calls with bounded concurrency, for example 6 at a time.
  - Ancestry between two fixed commits never changes. Store each positive or negative pair in D1 and skip known pairs.
  - Minimal: add `?per_page=1` only.
- Maintainer decision needed: yes. Does any rule need every eligible ancestor in `visonaut_ancestry`, or only the selected reference? The SQL guards read one snapshot (`packages/service/src/local-comparison.ts:417`, `baseline-promotion.ts:405`).

### API-08 · The complete R2 inventory is read and validated again for each reference page and each review read

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes (local CPU proxy). Effort: M
- Evidence:
  - One read does: full body, SHA-256, `JSON.parse`, a full canonical re-serialization, and validation (`apps/web/src/capture-inventory.ts:509-517,552-553`).
  - Reference paging: `local-comparison.ts:432` calls `referenceCaptures` for every page; it loads the whole inventory and sorts it (`local-comparison.ts:184-193`). The first page reads it three times (`local-comparison.ts:334,335,432`).
  - Also once in `validateLocalSubmission` for declare and for finalize (`local-comparison.ts:512`, called from `workflow-owned.ts:546,1143`), and three times in materialization (`workflow-materialize.ts:273,275,809`).
  - Review: `review-inventory.ts:43-48` reads the run inventory and the reference inventory for every `GET /api/runs/:id`, every completed receipt poll (`review.ts:814`), and every conflict response (`review.ts:683`).
  - M6: one read on local Node 24: 1,000 captures, 1.41 MB, 16 ms; 3,582 captures, 5.05 MB, 50 ms; 10,580 captures, 14.95 MB, 151 ms. The sizes are the repository's scale fixture sizes (`apps/web/tooling/review-scale/README.md`).
- What happens: for 3,582 reference captures a Submit makes 18 page requests and about 25 complete inventory reads. Each review model read makes 2.
- Impact: CPU and R2 transfer grow with pages times inventory size. The review model pays two reads before it can answer. Worker CPU time was not measured; local Node is faster than a Worker isolate.
- Recommendation: keep a per-isolate cache of the parsed, validated inventory keyed by the pointer digest. The object is immutable and content-addressed (`capture-inventory.ts:532`). `local-comparison.ts:54-77` already does this for image IDs. Bound it to one or two entries.
- Alternatives:
  - Return the complete reference list in one response (a 3,582-capture list is smaller than the inventory itself) and drop paging. This changes the CLI protocol.
  - Store a second, small "reference page" object beside the inventory when a baseline is accepted.
  - Minimal: reuse the inventory inside one request (first page: 3 reads → 1).
- Maintainer decision needed: no for the in-request reuse; yes for a protocol change.

### API-09 · The `workflow_run` webhook runs the full materialization inside `waitUntil`, in addition to the queue

- Kind: performance
- Severity: medium. Confidence: medium. Measured: no. Effort: S
- Evidence:
  - `api/webhooks.ts:350-357`: `lifetime.waitUntil(processWebhook(context, webhook).catch(() => { console.error(...) }))`.
  - `api/webhooks.ts:267-275`: on `workflow_run` completed with success: `for (const row of staged.results) { await materializeWorkflowRun(context, row.id); }`.
  - The queue already owns the same work: `workflow-owned.ts:1279` and `webhooks.ts:248` send `{ kind: "ingest" }`; `apps/web/src/runtime.ts:375-376` runs `reconcileStagedWorkflows`.
  - `leaseStagedSources` extends a lease but does not exclude a second worker (`workflow-materialize.ts:159-164`).
  - One materialization makes at least 30 GitHub requests plus one per eligible snapshot (API-07), an R2 list, image checks, and many D1 batches. The module logs its own phase times (`workflow-materialize.ts:777-799`).
- What happens: the same staged run can be materialized by the queue consumer and by the webhook at the same time. The webhook copy runs under the `waitUntil` time limit. Cloudflare documents 30 seconds after the response; verify for this account.
- Impact: duplicate GitHub, R2, and D1 work. If the webhook copy is cut off, the delivery stays pending and the 5-minute recovery repeats it. The statements are written to be repeat-safe, so this is cost and delay, not a known correctness fault.
- Recommendation: let the webhook only wake the queue, as the `check_run` branch does.

  ```ts
  if (staged.results.length) await context.operations.send({ kind: "ingest" });
  ```

- Alternatives: keep the inline call but skip it when the run is already sealed or leased. Minimal: read the `workflow_materialized` log lines in production first and compare `totalMs` with the limit.
- Maintainer decision needed: yes. Is there a reason to keep the inline path, for example a faster first result on main?

### API-10 · Every webhook delivery costs 6 D1 round trips and 4 row writes, including events with no handler

- Kind: cost
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - M1: `check_run` created, `workflow_run` for another workflow file, and `check_suite` each use 3 round trips before the `202` (`visonaut_projects`, `INSERT`, `SELECT`) and 3 more in `waitUntil` (`visonaut_projects`, restore fence, `UPDATE`). Rows written: 4.
  - `packages/security/src/webhooks.ts:85-102` does `INSERT ... ON CONFLICT DO NOTHING` and then a separate `SELECT`.
  - `processWebhook` has work only for nine event names (`webhooks.ts:37-38,53,182-329`).
  - Volume: `docs/operations/compact-processed-webhooks.md:5` records 30,562 processed receipts on 2026-09-28.
- What happens: the full payload is stored, the delivery is processed as a no-op, and the payload is then replaced with `'{}'`.
- Impact: D1 writes and Worker time for deliveries that cannot change anything. The table has no retention; it grows with every delivery.
- Recommendation: decide the event's handler before the insert. For an event or action with no handler, insert the receipt as already processed with an empty payload in one statement and skip `waitUntil`.

  ```sql
  INSERT INTO github_webhook_delivery (delivery_id, event, payload_digest, payload_json, received_at, processed_at)
  VALUES (?, ?, ?, '{}', ?, ?)
  ON CONFLICT(delivery_id) DO NOTHING
  ```

- Alternatives:
  - Use `INSERT ... ON CONFLICT DO UPDATE SET delivery_id = delivery_id RETURNING event, payload_digest, processed_at` to remove the second round trip for all events.
  - Drop the first `assertConfiguredProject` for the webhook route; the repository ID is already checked against configuration (`packages/security/src/webhooks.ts:65-75`, `webhooks.ts:54`).
  - Reduce the App's event subscriptions in GitHub. This is an external change.
  - Add a retention rule for old processed receipts.
- Maintainer decision needed: yes. Must a receipt row exist for events that have no handler? `apps/web/src/operations/github-deliveries.ts:230` reads receipts during upstream delivery recovery.

### API-11 · A delivery that cannot be processed is retried every 5 minutes without a limit, and the reason is not logged

- Kind: bug
- Severity: medium. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `api/webhooks.ts:362-395`: `reconcileWebhooks` selects `WHERE processed_at IS NULL ORDER BY last_attempt_at, received_at LIMIT ?`. There is no attempt count, no age limit, and no terminal state. The `catch` has no binding: `} catch { pending.push(row.delivery_id); }`.
  - First-pass failures log only the ID: `webhooks.ts:352-356`: `console.error(JSON.stringify({ event: "webhook-processing-pending", deliveryId: webhook.deliveryId }))`.
  - Any pending delivery sets an alert on each recovery: `apps/web/src/runtime.ts:380-395` records `reconciliation-failed` when `pending.length > 0`.
  - Example path: `pre-run-candidates.ts:73-87` throws `merge_not_ready` while the pull request has no current test merge commit, its merge base is not in main, or its merge ref differs.
- What happens: a `pull_request` delivery for an open pull request that GitHub cannot merge (conflict) keeps throwing `merge_not_ready`. It is retried until the pull request changes or closes. Assumption: GitHub returns no current `merge_commit_sha` for a conflicted pull request; this was not checked against GitHub.
- Impact: repeated GitHub requests, a permanent "webhooks" service alert, and slots taken from the 25 per step. The logs do not say which error keeps a delivery pending.
- Recommendation: record `attempts` and the last error code on the delivery row. Treat known "not applicable" states as settled, not as failures. After N attempts or an age limit, mark the delivery as abandoned and raise one alert that names the delivery and the code.
- Alternatives:
  - Minimal: log `error.code` in both `catch` blocks, as `logOperationFailure` does for API requests (`api/index.ts:67-72`).
  - In `candidateForWebhook`, return `null` when the pull request is not mergeable instead of throwing.
- Maintainer decision needed: yes. Which webhook errors are final? Run this first:
  `SELECT event, COUNT(*) AS pending, MIN(received_at) AS oldest FROM github_webhook_delivery WHERE processed_at IS NULL GROUP BY event;`

### API-12 · Server-comparison branches are still in the upload path, and the comparator binding has no reachable caller

- Kind: dead-code
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence:
  - New reservations must be local: `api/workflow-owned.ts:182-187` throws `local_comparison_required` otherwise. Both places that issue a capability set the local mode (`workflow-owned.ts:372-384`, `local-comparison.ts:297,444-447`). A capability lives at most 15 minutes (`packages/security/src/capabilities.ts:98,123`).
  - Branches that need a non-local capability: `workflow-owned.ts:549-554`, the `? 2 : 1` at `558`, `770-778`, and `1066-1089`.
  - The only use of the comparator in `apps/web/src`: `workflow-owned.ts:1067`: `const validation = await context.comparator.fetch("https://compare.internal/validate", {`. It is inside `if (capability.comparisonMode !== LOCAL_COMPARISON_MODE)`.
  - The binding is still required at startup (`apps/web/src/runtime.ts:49`) and configured (`apps/web/wrangler.jsonc:85-90`).
  - The contract describes it as live: `docs/current-contract.md:32`: "The private Worker validates PNG/WebP through fetch"; `docs/operations/retire-server-comparison.md:39,59`.
- What happens: on the current path the service checks an uploaded image by byte length and SHA-256 only (`workflow-owned.ts:1042`). It does not decode it. The trusted CLI decodes each candidate before upload (`packages/cli/src/local-comparison.ts:239`).
- Impact: about 60 lines and one deployed service binding exist for a path that cannot run. The contract text and the code disagree about who validates image bytes.
- Recommendation: decide the rule first, then make code and document agree. If CLI decoding is the rule, remove the four branches, the `comparator` binding from `ApiBindings`, and the startup requirement, and correct the contract row.
- Alternatives: if server-side decoding is wanted, call `/validate` for local uploads too (one service call per uploaded image). Minimal: keep the code and add a comment that the branch is retained for rollback only.
- Maintainer decision needed: yes. Should the service decode uploaded images, or is the signed CLI the validator?

### API-13 · Routes, exports, and settings with no product caller

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes (static scan M7). Effort: M
- Evidence:
  - `GET /api/me` (`server.ts:88-105`): no caller in `apps/web/src`. Browser tests assert that it is not called (`apps/web/src/review/__tests__/route.browser.test.ts:103`). `docs/review-evidence-plan.md:62` still says the routes call it first.
  - `GET /api/session` (`review.ts:713-721`): no caller in the repository.
  - `POST /webhooks/github` (`index.ts:127`): old receiver URL beside `/v1/webhooks`.
  - `/api/auth/*` branch in `handleApi` (`index.ts:131-133`): `server.ts:82-87` answers first.
  - `POST /api/runs/:id/recompare` (`review.ts:950-987`): every path throws. The model always carries `recompareAllowed: false` (`review.ts:592`). The run page still renders a disabled "Recompare stored run" button and its reason text (`apps/web/src/review/review-workspace.tsx:1186-1201`).
  - Synchronous command branch (`review.ts:879-904`): the client always sends `queued: true` (`apps/web/src/review/client.ts:317`).
  - `matchPath` (`input.ts:48-50`): no reference anywhere. `ensurePreRunCheck` (`pre-run.ts:31-46`): 50 references, all in `webhooks.test.ts`.
  - `ApiBindings.history` (`context.ts:86-96`, built in `apps/web/src/runtime.ts:272-300`): no reader in `apps/web/src`. Two of its four functions only throw.
  - `limits.maximumPlanBytes` (`context.ts:40`, `apps/web/src/runtime-defaults.ts:13`): no reader.
  - `docsOnly` / `docs_only`: 24 references in four modules; always `false` / `0` on write (see API-03).
  - `verifyAncestry` is the only ingest logic in `ingest.ts`; the file name no longer matches its content.
- What happens: these parts are compiled, tested, and read by every new contributor, but no product flow reaches them.
- Impact: extra surface to secure and to keep in tests. The recompare button and text add to the text load on the run page.
- Recommendation: remove them in one change per group: (1) recompare route, model fields, button, and text; (2) `/api/me`, `/api/session`, the inner `/api/auth` branch; (3) unused exports, binding, and setting; (4) `docs_only` after API-03.
- Alternatives: keep `/webhooks/github` until the GitHub App URL is confirmed. Keep one identity endpoint if the tooling needs it (`local-routes.mjs:273`).
- Maintainer decision needed: yes. Is the GitHub App webhook URL `/v1/webhooks` in production now? Is the recompare tombstone still needed for old clients?

### API-14 · Upload evidence "version 2" (D1 pages) has readers and a writer function, but nothing creates it

- Kind: dead-code
- Severity: low. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - The only `INSERT` into `ingest_staged_manifests` writes the literal `1`: `api/workflow-owned.ts:589`: `"... created_at, evidence_version, evidence_bytes, capture_manifest_digest) SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ? FROM ingest_staged_runs ..."`.
  - Version 2 code: `workflow-evidence.ts:211-235` (`writeEvidencePages`), `282-348` (paged read), `workflow-owned.ts:654-656,667-669`, `workflow-materialize.ts:445-448,687-710`, `workflow-retention.ts:24-30`, table and triggers in `apps/web/migrations/0033_d1_upload_evidence.sql`.
  - History: `863ffc2` (2026-10-03, #241) introduced version 2; `6219fdf` (2026-10-04, #247) returned new manifests to version 1.
  - Staged rows live 24 hours plus a 6-hour lease (`workflow-retention.ts:6-7`).
- What happens: `writeEvidencePages` can run only for a manifest row that already has version 2. Such a row needs a capability from before #247, and capabilities expire in 15 minutes.
- Impact: about 150 lines and one table remain for rows that existed for one day. Stored `ingest_manifests.storage_version = 2` and `ingest_run_provenance.storage_version = 2` rows still need their readers (`apps/web/src/operations/history.ts:504-505`).
- Recommendation: after one retention window, confirm `SELECT COUNT(*) FROM ingest_staged_manifests WHERE evidence_version = 2` is 0, then remove the writer and the paged reader. Keep the `storage_version` column checks for imported rows.
- Alternatives: keep the reader for one release as rollback material and remove only `writeEvidencePages`.
- Maintainer decision needed: yes. Was the return to R2 manifests in #247 final?

### API-15 · Error responses have several shapes, and the same code maps to different statuses

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence (M4 and M8):
  - With `schemaVersion`: all thrown errors (`index.ts:35-84`). Without: the 404 fallback `{"error":{...}}` (`index.ts:216-219`), review conflicts `{"error","model","reviewer"}` (`review.ts:689-696,818-830`), and outer failures (`server.ts:34-53`).
  - `server.ts:49` sends `Retry-After: 1` for every status. `index.ts:42` sends it only for 503. `server.ts:75,84,91` answer with an empty body.
  - Images answer in plain text: `404 text/plain "Not found"` (`images.ts:17-21`).
  - An unknown `/v1` path or a wrong method answers `401 sign_in_required "Sign in with GitHub."` (M4: `GET /v1/nope`, `GET /v1/plan`). The request falls through to the session check (`index.ts:190-205`).
  - `ProtocolError` always becomes `invalid_manifest` (`index.ts:46-54`), also for a bad digest in a reuse or finalize body (`workflow-owned.ts:813-814,1127-1128`). `ProtocolError` has its own `code` (`packages/protocol/src/validate.ts:21-29`) that is dropped.
  - GitHub response shape errors use the request-body validator: 51 calls like `object(await github.request(...))` in 14 modules. `input.ts:19-24` throws `invalid_body`, 400, "The request body is invalid." The security package uses 503 `invalid_metadata` for the same case (`packages/security/src/errors.ts:12-17`).
  - M8: 254 `new SecurityError(...)` sites, 108 distinct codes. 10 codes use two statuses, for example `local_comparison_required` 409 and 403, `pre_run_check` 503 and 409, `comparison_mode` 403 and 400, `reference_scope` 403 and 404.
  - `SecurityError` is the class for every HTTP error, including `not_found` and validation.
  - `requireSameOrigin` runs after the session and permission work (`index.ts:194-208`), although `packages/security/src/http.ts:20` describes it as a first step.
- What happens: clients must handle each shape. The CLI can read "Sign in with GitHub" for a path error, and "request body is invalid" for a GitHub outage.
- Impact: harder client code and harder support. A 400 for an upstream fault tells the CLI not to retry.
- Recommendation: one error builder with one shape, one code-to-status table, and one `upstream()` validator for GitHub responses.

  ```ts
  // api/errors.ts
  export const fail = (code: ErrorCode, message: string) =>
    new HttpError(code, STATUS[code], message);
  // api/input.ts
  export const upstream = (value: unknown) => {
    try {
      return object(value);
    } catch {
      throw fail("github_unavailable", "GitHub returned unexpected data.");
    }
  };
  ```

- Alternatives: minimal set: add `schemaVersion` to the two body shapes that lack it, return 404 for unmatched `/v1` and `/api` paths before the session check, and pass `error.code` through for `ProtocolError`.
- Maintainer decision needed: yes. Is the error body part of the public CLI contract (`packages/protocol/src/types.ts:342-345`)? If yes, code changes need a compatible rollout.

### API-16 · The API has no route table, a few very large functions, and two ID spaces under `/v1/runs/:id`

- Kind: simplification
- Severity: medium. Confidence: high. Measured: yes (line counts). Effort: L
- Evidence:
  - Routing is 21 regular expressions in two `if` chains (`index.ts:113-209`, `review.ts:704-950`). The auth class of a route depends on where its `if` stands in the chain.
  - Module sizes (`wc -l`): `workflow-owned.ts` 1,289; `pre-run-attempts.ts` 1,034; `review.ts` 989; `workflow-materialize.ts` 960; `pre-run-checks.ts` 724. Tests: `workflow-owned.test.ts` 5,053; `webhooks.test.ts` 4,672.
  - Function sizes: `reviewModel` 391 lines (`review.ts:227-617`), `verifyLineage` 361 (`lineage.ts:82-442`), `materializeWorkflowRun` 327 (`workflow-materialize.ts:494-820`), `handleReview` 291 (`review.ts:699-989`), `declareStaged` 284 (`workflow-owned.ts:476-759`).
  - `/v1/runs/{id}/begin` and `/submit` take the GitHub run number (`index.ts:140,186`). `/v1/runs/{id}/reference`, `/shards`, `/reuse`, `/finalize`, and `GET /v1/runs/{id}` take the service UUID (`index.ts:144-184,209`).
  - Names from earlier designs remain: `shards/{key}` with one legal key, `capture_job_prefix` holding a template (`workflow-owned.ts:70-71`), `docs_complete` for "no visual work", "staged", "workflow-owned", "pre-run".
  - Two more validator sets beside `input.ts`: `packages/security/src/errors.ts:12-34` and `@visonaut/protocol` (`validateDigest`, `validateKey`, `validateVersion`).
- What happens: a reader must run the chain in the head to learn a route's method, auth, and handler.
- Impact: slow reviews and a real chance to place a new route in the wrong auth zone.
- Recommendation: one declarative table that the dispatcher walks. Each row names its auth class.

  ```ts
  const routes: Route[] = [
    {
      method: "POST",
      path: "/v1/runs/:runId/finalize",
      auth: "capability",
      handler: finalizeStaged,
    },
    { method: "GET", path: "/api/runs/:runId", auth: "read", handler: readReviewModel },
    // ...
  ];
  ```

  Then split `review.ts` into the model reader and the command handlers, and move the run and project loading into one place (API-05).

- Alternatives: keep the chains and add a generated route list test that fails when a route is added without an entry. Minimal: put the route table from this report in `docs/`.
- Maintainer decision needed: yes. `docs/current-contract.md:53` (D08/D09) says "No new workflow framework". Does a plain route table count as allowed refactoring?

### API-17 · Repeated GitHub requests inside one webhook or one materialization

- Kind: performance
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `workflow-reconcile.ts:234-235`: `await workflowAttempt(github, submit); const attempt = await workflowAttempt(github, submit, run.workflow_attempt > 1);`. For attempt 1 both lines request the same URL. The same URL is requested again at `workflow-reconcile.ts:353` and `workflow-materialize.ts:769`.
  - `webhooks.ts:282` and `pre-run-candidates.ts:58` both request the same pull for one `pull_request` delivery. `mergeBaseForHead` requests the main ref each time (`merge.ts:25-29,55`).
  - `relatedRunEvidence` calls `verifyLineage` twice (`lineage.ts:554,581`). Both calls validate the target again: for a pull request 8 requests each (`lineage.ts:159-195`); for a merge group the queue GraphQL pages each time (`lineage.ts:196-315`). The caches are local to one call (`lineage.ts:96-97`).
  - The pull is fetched for every `pull_request` action, also for `labeled` or `assigned` (`webhooks.ts:279-282`); only `candidateForWebhook` filters the action (`pre-run-candidates.ts:42`).
- What happens: the same immutable or just-read GitHub object is fetched again a few lines later.
- Impact: extra serial calls on paths that already make many. The last-moment re-checks before sealing are deliberate and should stay.
- Recommendation: remove the adjacent duplicate at `workflow-reconcile.ts:234`; pass the fetched pull into `candidateForWebhook`; pass the first lineage proof as `frozen` into the second call when the target did not change.
- Alternatives: a small per-invocation GET cache in the GitHub client for immutable paths (`/git/commits/:sha`).
- Maintainer decision needed: no.

### API-18 · Each image view costs one D1 read and one R2 read; the response is cacheable only in the browser

- Kind: performance
- Severity: low. Confidence: medium. Measured: yes (1 D1 + 1 R2 per request). Effort: S
- Evidence: `api/images.ts:24-40` reads `visonaut_images`, then R2. `images.ts:52`: `"Cache-Control": "public, max-age=31536000, immutable"`. M1: `GET /images/:id` → 1 D1 round trip, 1 `images.get`.
- What happens: the header lets a browser keep the image. A Worker response is not stored in the Cloudflare edge cache unless the Worker uses the Cache API. Assumption from Cloudflare's documentation; not tested here.
- Impact: a new reviewer, a new device, or a cleared cache reads every image through D1 and R2 again.
- Recommendation: use `caches.default` for `GET /images/:id` with a bounded TTL.
- Alternatives: keep as is. Note the tradeoff: an edge copy can outlive image retention (`docs/current-contract.md:184`), so the TTL must be shorter than the retention promise, or expiry must purge.
- Maintainer decision needed: yes. May an expired image stay readable from an edge cache for the TTL?

## Measurements (command, raw result, limits)

All probe files and raw outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/api/`. The Vitest probes use `vitest.probe.config.mjs` (root = repository, test directory = scratch). They import repository source and write only to the scratch directory. `git status --short` after the runs shows only ` M pnpm-lock.yaml` and `?? apps/lab/`; both have timestamps from before the first probe (16:25 against 16:32) and come from another task.

### M1 · Storage and GitHub round trips per request

- Command: `pnpm --dir <repo> exec vitest run --config <scratch>/vitest.probe.config.mjs roundtrips`
- Probe: `roundtrips.probe.ts`. Real `handleApi`, Miniflare D1 with all numbered migrations, real Better Auth session, a pull-request run with 3 pending variants seeded through `Service` and `tooling/legacy-comparison-fixture.ts`. A proxy counts each `first/all/run` and each `batch` as one round trip and reads native `rows_read` / `rows_written`.
- Raw result (`roundtrips.result.txt`; full SQL per trip in `roundtrips.result.json`):

  ```text
  label | request | status | D1 round trips before response | D1 statements before response | D1 round trips after response (waitUntil) | rows read | rows written | R2 calls | GitHub requests | response bytes
  no session (401) | GET /api/runs | 401 | 2 | 76 | 0 | 856 | 0 | 0 | 0 | 92
  session, cold permission cache | GET /api/session | 200 | 6 | 80 | 0 | 860 | 0 | 0 | 3 | 91
  session, warm permission cache | GET /api/session | 200 | 6 | 80 | 0 | 860 | 0 | 0 | 0 | 91
  dashboard | GET /api/runs | 200 | 6 | 82 | 0 | 907 | 0 | 0 | 0 | 407
  operations attention | GET /api/operations | 200 | 9 | 83 | 0 | 863 | 0 | 0 | 0 | 71
  review model (dense run, 3 pending variants) | GET /api/runs/:runId | 200 | 19 | 99 | 0 | 952 | 0 | 0 | 0 | 2364
  review poll state | GET /api/runs/:runId/state | 200 | 13 | 87 | 0 | 875 | 0 | 0 | 0 | 89
  pull request check lookup | GET /api/pulls/42?check=... | 200 | 8 | 82 | 0 | 862 | 0 | 0 | 0 | 111
  public image | GET /images/:id | 200 | 1 | 1 | 0 | 1 | 0 | 1 | 0 | 44
  create review session (write) | POST /api/review-sessions | 201 | 7 | 81 | 0 | 860 | 2 | 0 | 1 | 58
  queued approve (as the web client sends it) | POST /api/comparisons/:id/commands | 202 | 11 | 87 | 13 | 916 | 28 | 0 | 1 | 66
  queued command receipt poll | GET /api/commands/:id/queued | 200 | 23 | 103 | 0 | 956 | 0 | 0 | 0 | 2802
  webhook: check_run created (no handler work) | POST /v1/webhooks | 202 | 3 | 3 | 3 | 5 | 4 | 0 | 0 | 17
  webhook: workflow_run for another workflow file | POST /v1/webhooks | 202 | 3 | 3 | 3 | 5 | 4 | 0 | 0 | 17
  webhook: check_suite (event with no branch) | POST /v1/webhooks | 202 | 3 | 3 | 3 | 5 | 4 | 0 | 0 | 17
  ```

- Cold isolate, `GET /api/runs` and `GET /api/operations` in parallel (`roundtrips.cold.json`): GitHub requests `access_tokens` ×2, `/user/42` ×2, `/collaborators/maintainer/permission` ×2; 15 D1 round trips; 165 statements.
- No-visual pull check (`errors.result.json`, last entry): `GET /api/pulls/43?check=visonaut:pre:eee…` → `200 {"repository":"ariakit/ariakit","pullNumber":43,"runId":null,"state":"pending"}`.
- Limits: counts only. Miniflare timing is not production timing, so no times are reported. The run has no R2 inventory, so the inventory reads of a current run are not in the 19. The 75 `pragma_table_info` statements equal the table count of the committed migrations; production can differ by a few. The fixture GitHub server answers at once.

### M2 · Effect of `validateSchema: false`

- Command: `pnpm --dir <repo> exec vitest run --config <scratch>/vitest.probe.config.mjs schema-check`
- Probe: `schema-check.probe.ts`. A module mock adds the option to `betterAuth(...)`; no repository file changes. Request: `GET /api/session`.
- Raw result (`schema-check.result.json`): default → `d1RoundTrips: 6, d1Statements: 80`; `validateSchema: false` → `d1RoundTrips: 4, d1Statements: 4` (project, session, user, account). Both `200`.
- Limits: same as M1.

### M3 · PR title lookup after settlement

- Command: `sqlite3 -header -column ":memory:" < <scratch>/title-lookup.sql`
- Raw result:

  ```text
  pending delivery -> title    Fix dialog focus
  processed delivery -> title  (empty)
  rows that still carry a title  0
  ```

- Limits: local SQLite with the table, the `last_attempt_at` column, and index `0028`. Not checked against production rows.

### M4 · Error shapes

- Same probe run as M1; raw output `errors.result.json`. Selected lines:

  ```text
  unknown /api path, signed in | GET /api/nope | 404 | keys ["error"]
  unknown /v1 path, no credential | GET /v1/nope | 401 | {"schemaVersion":"1.0","error":{"code":"sign_in_required","message":"Sign in with GitHub."}}
  known /v1 path, wrong method | GET /v1/plan | 401 | sign_in_required
  missing run | GET /api/runs/<uuid> | 409 | {"schemaVersion":"1.0","error":{"code":"incomplete","message":"The requested record does not exist."}}
  missing image | GET /images/<uuid> | 404 | text/plain "Not found" | cache-control: no-store
  stale review command | POST /api/comparisons/:id/commands | 409 | keys ["error","model","reviewer"]
  recompare tombstone | POST /api/runs/:runId/recompare | 409 | local_comparison_required
  reserve without local mode | POST /v1/runs | 409 | local_comparison_required
  ```

- Limits: `handleApi` only. The shapes in `server.ts` were read from the code, not run.

### M5 · Binding identity across requests

- Command: `node <scratch>/env-identity.mjs`
- Raw result: request 1 `{"sameEnvObject":null,...,"weakMapHitOnD1":false}`; requests 2 and 3 `{"sameEnvObject":true,"sameD1Binding":true,"sameR2Binding":true,"weakMapHitOnD1":true}`.
- Limits: local workerd through Miniflare. It shows that the `WeakMap` caches keyed by `env.DB` can hit inside one isolate. It says nothing about how long production isolates live.

### M6 · One inventory read

- Command: `pnpm --dir <repo> exec vitest run --config <scratch>/vitest.probe.config.mjs inventory`
- Probe: `inventory.probe.ts`. `writeCaptureInventory` then 7 timed `readCaptureInventory` calls with an in-memory store.
- Raw result (`inventory.result.json`, Node v24.18.0, darwin arm64):

  ```text
  captures 1000   bytes 1405766   samples ms [14.7, 15, 16.4, 16.4, 18.2, 19.5, 22.4]        median 16.4
  captures 3582   bytes 5054132   samples ms [47.6, 48.1, 49.1, 49.8, 51.7, 52.6, 57.1]      median 49.8
  captures 10580  bytes 14954946  samples ms [147.4, 149, 149.7, 150.9, 150.9, 154.7, 178]   median 150.9
  ```

- Limits: synthetic inventory without a manifest, one profile, one image per capture. Real inventories with a manifest use the compact `baseline-delta-v2` form and have other sizes. Local Node CPU is not Worker CPU. No R2 transfer is included.

### M7 · Exports without a production caller

- Command: `node <scratch>/exports.mjs`
- Raw result: 113 exports in `api/`; 15 have no reference in another production file. With no same-file use either: `input.ts :: matchPath` (0 references) and `pre-run.ts :: ensurePreRunCheck` (50 test references).
- Limits: text match by name in `apps/web/src`, `apps/web/tooling`, `apps/compare/src`.

### M8 · Error codes

- Command: `node <scratch>/error-codes.mjs`
- Raw result: `SecurityError constructions: 254; distinct codes: 108`; distinct codes per status `{"400":14,"401":8,"403":28,"404":2,"409":30,"413":2,"415":1,"422":3,"500":1,"503":29}`; 10 codes with two statuses: `comparison_mode`, `invalid_capability`, `invalid_challenge`, `invalid_ticket`, `invalid_webhook`, `local_comparison_required`, `missing_receipt`, `pre_run_check`, `reference_scope`, `workflow_conflict`.
- Limits: regular-expression scan of `api/` and `packages/security/src`.

## Open questions and items not verified

1. Production latency of one Worker-to-D1 round trip and of one GitHub API call was not measured. All "wait" statements are counts.
2. API-02 was not checked against production rows. Check: `SELECT COUNT(*) FROM github_webhook_delivery WHERE event='pull_request' AND json_extract(payload_json,'$.pull_request.title') IS NOT NULL;`
3. API-03 assumes that GitHub keeps a check run's `details_url` when a PATCH omits it.
4. API-11 assumes that GitHub gives no current test merge commit for a conflicted pull request. The number and age of pending deliveries in production are unknown.
5. API-07: the number of `reference_eligible` snapshot commits in production is unknown. The document value is baseline revision 27 on 2026-10-03.
6. API-09: the `waitUntil` limit and the real `totalMs` of materialization were not read from production logs.
7. API-10: the list of events that the GitHub App subscribes to is not in the repository.
8. API-14: no production count of `evidence_version = 2` rows.
9. API-18: the edge-cache statement comes from Cloudflare documentation and was not tested.
10. `apps/web/wrangler.jsonc:39-42` sets `limits` (`cpu_ms: 240000`, `subrequests: 250000`) at the top level only. Whether the `production` environment inherits them was not verified.
11. The synthetic inventory of 10,580 captures is 14.95 MB, close to the 16 MiB limit (`apps/web/src/capture-inventory.ts:56`). Real inventory sizes at that scale were not measured.
12. The synchronous command branch (`review.ts:879-904`) has no caller in this repository. An external script could still use it; that was not checked.
13. `settlePreRunWorkflow` (`pre-run-attempts.ts:882-1034`) throws retryable 503 errors for several "not ready yet" states. How many `workflow_run` deliveries fail their first pass in production was not measured.
14. Not audited in depth: OIDC verification (`packages/security/src/oidc.ts`), the service write transactions, and the operations steps. They belong to other lanes.
