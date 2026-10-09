# Verification: Authentication, authorization, and GitHub client cost

Verifier lane. Read-only. No file in the repository was changed.

## Read this first

- `audit/auth/report.md` does not exist. The harness refused the auditor's write ("Subagents should return findings as text, not write report files"). I recovered the exact text that the auditor tried to write from the auditor's transcript. The copy is `audit/auth/verify/recovered-report.md`. All line references below are checked against that text.
- I ran the auditor's harness again. All round-trip counts, statement counts, GitHub request lists, and header lists are the same. Output: `audit/auth/verify/rerun-measure-auth.out.txt`.
- I wrote one new probe: `audit/auth/verify/probe-auth-routes.mjs`, output `probe-auth-routes.out.txt`. It gives three results that the report does not contain. They change AUTH-03, AUTH-09, and AUTH-16.
- Limits are the same as the auditor's: Node 24.18.0, in-process SQLite with a D1-shaped wrapper, a stub for GitHub. Counts and route behavior do not depend on the machine. No time in this file is a production time, except the numbers that I quote from `audit/live-authenticated.md`.

Verdict summary:

| ID      | Verdict                    | Auditor severity | My severity |
| ------- | -------------------------- | ---------------- | ----------- |
| AUTH-01 | confirmed                  | high             | high        |
| AUTH-02 | confirmed                  | medium           | medium      |
| AUTH-03 | partly-confirmed           | high             | high        |
| AUTH-04 | confirmed                  | medium           | medium      |
| AUTH-05 | judgment (facts confirmed) | medium           | medium      |
| AUTH-06 | confirmed                  | medium           | medium      |
| AUTH-07 | confirmed                  | medium           | low         |
| AUTH-08 | partly-confirmed           | low              | low         |
| AUTH-09 | partly-confirmed           | medium           | medium      |
| AUTH-10 | confirmed                  | low              | low         |
| AUTH-11 | confirmed                  | low              | low         |
| AUTH-12 | partly-confirmed           | low              | low         |
| AUTH-13 | judgment (facts confirmed) | low              | low         |
| AUTH-14 | confirmed                  | low              | low         |
| AUTH-15 | partly-confirmed           | medium           | low         |
| AUTH-16 | partly-confirmed           | low              | medium      |
| AUTH-17 | confirmed                  | low              | low         |

No finding is refuted. Four findings contain a wrong statement (AUTH-03, AUTH-09, AUTH-15, AUTH-16). One recommendation breaks an existing test that the report does not name (AUTH-08). One finding (AUTH-12) calls something drift that a document says is deliberate.

- I wrote two new probes. `probe-auth-routes.mjs` is described above. `probe-origin-order.mjs` (output `probe-origin-order.out.txt`) tests the AUTH-08 change against an existing test.

## AUTH-01 · Better Auth checks the full database schema on each request

Verdict: confirmed. Severity: high.

Proof that I checked:

- `packages/security/src/auth.ts:47-51`: `advanced` has no `database` key.
- `@better-auth/core/dist/types/init-options.d.mts:390-400`: `validateSchema`, `@default true`, "Authentication requests await the same check".
- `better-auth/dist/api/to-auth-endpoints.mjs:41-42`:

  ```js
  const pendingSchemaCheck = rawContext.checkSchema?.();
  if (pendingSchemaCheck) await pendingSchemaCheck;
  ```

- `@better-auth/core/dist/db/schema-check.mjs:57-68`: `clean` and `verdict` are closure variables of one adapter instance. The `WeakMap` in that file holds only a revision counter, not the result. So a new instance always runs the check again.
- `@better-auth/kysely-adapter/dist/d1-sqlite-dialect-*.mjs:89-98`: one `sqlite_master` query, then `this.#d1.batch(...)` with one `pragma_table_info` statement for each table.
- `apps/web/src/api/index.ts:130`, `apps/web/src/server.ts:85`, `:93`: a new instance for each request.
- Rerun, scenario A1: the first two round trips are the `sqlite_master` query and `batch of 75 x: SELECT * FROM pragma_table_info(?)`. Scenario L: `current options` 4 round trips and 78 statements; `validateSchema = false` 2 round trips and 2 statements.
- Platform: Cloudflare says `batch()` "sends multiple SQL statements inside a single call to the database" (https://developers.cloudflare.com/d1/worker-api/d1-database/). So the 75 statements are one round trip. This agrees with the count of 2.

What I looked for to refute it, and did not find: a cache of the instance, a `validateSchema` setting in another file, a production path that skips `createAuth`. A search for `validateSchema` in the repository finds nothing.

Corrections:

1. The summary says "The check has no effect on the result of the request." That is true only while the schema matches. If the schema does not match, the request fails. That is the purpose of the check.
2. The check is the only guard that exists today. No test and no deploy step compares `apps/web/migrations/0003_auth.sql` with the Better Auth schema (search of `packages/security/test` and `apps/web/src/**/*.test.ts` finds none). The report lists such a test as an alternative. If the runtime check is disabled, the test must be part of the same change. Without it, a Better Auth upgrade that adds a column fails later with a raw SQL error.
3. The alternative "one instance for each isolate" contradicts two deliberate statements: `auth.ts:15` ("Create inside each request so a D1 binding cannot cross request ownership") and `packages/security/README.md:5` ("Construct Better Auth inside each production Worker request"). The auditor says this. I agree that it needs its own workerd test and I did not run one.

The recommendation is feasible. The option exists in the installed version, and the rerun shows the effect.

## AUTH-02 · Session, user, account, and project checks are four more sequential round trips

Verdict: confirmed. Severity: medium.

Proof that I checked:

- Rerun, scenario A3: project row, schema check x2, session, user, account, then the first handler query. The order matches the report.
- `better-auth/dist/db/internal-adapter.mjs:343-350`: `findOne({ model: "session", …, join: { user: true } })`.
- `packages/security/src/authorization.ts:40-43`: the account query runs after `getSession`.
- `apps/web/src/api/index.ts:123-126`: the project check runs alone, before authentication.
- Repeat inside handlers: `apps/web/src/api/operations.ts:16-18` (`SELECT id,repository_id FROM visonaut_projects ORDER BY id LIMIT 2`) and `apps/web/src/api/pre-run.ts:50` (`await assertConfiguredProject(context);`). `apps/web/src/api/webhooks.ts:157` and `apps/web/src/api/workflow-materialize.ts:495` call it again too. The report does not list the last two.
- Rerun, scenario L: `validateSchema = false and joins = true` gives 1 round trip, with a joined query.
- Contract: `docs/current-contract.md:186`, "Live session and linked-account checks still run for every request." The recommendation keeps both checks and only joins them, so it is inside the contract.

Corrections:

1. The count is 3 on the dashboard read and 4 on all other paths. `index.ts:123` skips the project check for `GET /api/runs`.
2. The sketch that starts the project check at the same time as `getSession` changes one answer. Today an anonymous request to a deployment with a wrong project gets `503 repository_configuration`. With the sketch it gets `401`. That is an improvement, but it is a behavior change and a test can depend on it.
3. `joins: true` is not tested in workerd, and no project test covers it. The auditor says this. I agree. Treat the 1-round-trip number as a SQLite result.

## AUTH-03 · A cold isolate makes three sequential GitHub requests, and nothing is persisted

Verdict: partly-confirmed. Severity: high for the cold case, with medium confidence in the size.

Confirmed:

- `packages/security/src/github.ts:102`, `:193`, and `packages/security/src/authorization.ts:19`: three module-memory caches, nothing else.
- `github.ts:133` and `:169-172`: `pendingToken` belongs to one client object. `github.ts:106` says this is deliberate: "pending I/O stays within the request's client".
- Rerun, scenario A1: `POST /app/installations/1/access_tokens`, `GET /user/42`, `GET /repos/ariakit/ariakit/collaborators/maintainer/permission`, in that order. Scenario H1: 2 + 2 + 2 for two parallel cold requests.
- The two contract quotations are exact. They are at `docs/current-contract.md:186` and `:204`.
- I found no contract or README text that forbids persistence of the token, the login hint, or the grant. So options A, B, and C are not against a written rule. They are new decisions.

Corrections:

1. "This is the 'checking access' wait" is too strong. The production samples in `audit/live-authenticated.md` show:
   - `/api/runs` with a warm isolate: 865 to 1077 ms of server wait (four samples). No GitHub request is expected in these.
   - `/api/runs` in one sample: 1967 ms. This fits a cold isolate, about 1 s more. It is one sample.
   - `/api/runs/<id>` on a run page: 5251 to 5680 ms, for 5 to 6 MB of JSON.

   So the wait has three parts. The D1 path (AUTH-01, AUTH-02) is about 1 s on each request. The cold GitHub path adds about 1 s on the first request. On a run page the model size is the largest part and it is not in this lane.

2. The page table says that the operations poll makes "0, or 1 after 60 s" GitHub requests. I measured 1 on each poll (see Missed, item 3). The poll period is 60 s (`apps/web/src/components/operations-attention/index.tsx:280`, `setTimeout(load, 60000)`), and the grant test is `cached.checkedAt + lifetime > Date.now()` with a lifetime of 60 000 ms (`authorization.ts:21`, `:63`). The grant is always expired when the next poll arrives.
3. Option C says "one D1 write for each live check". With the poll result above, that is one D1 write each 60 s for each open dashboard. It is small, but it is not zero.

Checks on the recommendation:

- Option A stores a repository token at rest. The existing code already treats database copies as sensitive: `apps/web/src/operations/recovery.ts:35-41` deletes sessions and OAuth tokens in a restored database. A new token table must be added to that list.
- Option B at sign-in needs a Better Auth profile mapping. `auth.ts:29-34` has none today. This part is confirmed.

## AUTH-04 · A write deletes the cached grant and does not store the new positive result

Verdict: confirmed. Severity: medium.

Proof that I checked:

- `packages/security/src/authorization.ts:71-82`: the quoted code is exact. `permissions.delete(key)` runs before the live check, and `permissions.set` is inside `if (access !== "write")`.
- Rerun, scenario C: C1 (`POST /api/review-sessions`) 1 permission request, C2 (`GET /api/runs` next) 1 permission request, C3 0.
- `apps/web/src/review/client.ts:296` and `:310-313`: the first save calls `reviewSession()` (`POST /api/review-sessions`, access `write`), then `POST /api/comparisons/:id/commands` (access `review`). So the first decision makes two live checks, one after the other.
- `client.ts:340`: Undo also goes through a `write` request, which removes the grant.

What I looked for to refute it:

- A test that requires a write not to store a grant. There is none. `packages/security/test/auth-d1.test.ts:253-256` and `:364-367` test only that a failed write removes the grant. The proposed change keeps that. I also read the API tests that change the stubbed permission (`apps/web/src/api/api.test.ts:591-634`, `:762-770`, `:1070-1143`, `:1750-1758`). Each uses a denied write to remove the grant, so they hold too. I read them; I did not run the suite with the change.
- A contract rule. `docs/current-contract.md:186` permits reuse of "a positive GitHub permission result". It does not limit which request made the result. `packages/security/README.md:19` and `:26` describe reads and decisions as the sources, as the auditor says. The decision that the auditor asks for is correct.

No correction.

## AUTH-05 · The access check and the data read run one after the other, and the entry path repeats the check

Verdict: judgment for the proposal. All facts are confirmed. Severity: medium.

Facts that I checked:

- `apps/web/src/api/index.ts:194-213`: `requireMaintainer` finishes before the handler starts.
- `apps/web/src/server.ts:118`: the document request starts no access check.
- `apps/web/src/routes/runs.$runId.tsx:31` `ssr: false`, `:37-39` loader, `:66-74` "Checking access and loading this run…".
- `apps/web/src/routes/pulls.$pullNumber.tsx:51-84`: `fetch('/api/pulls/…')`, then `navigate({ to: "/runs/$runId", … })`.
- `apps/web/src/api/pre-run-checks.ts:509-512`: the check link is `/pulls/:n?check=`.

Comments on the proposal:

1. Option E (check and read at the same time) is feasible on Workers. The gain depends on the GitHub time, which is zero when the grant is warm. So it helps the cold request and the request after 60 s.
2. Option F needs a grant that other isolates can see. The auditor says this. Without it, the gain depends on the same isolate serving both requests.
3. On the run page the measured wait is 5.3 to 5.7 s for 5 to 6 MB of JSON. The access check is a small part of that. The entry-path change (one request in place of two from a PR link) is the part of this finding with the clearest gain: it removes one full set of 6 round trips.

## AUTH-06 · Ingest routes build Better Auth and never use it

Verdict: confirmed. Severity: medium.

Proof that I checked:

- `apps/web/src/api/index.ts:130` is before the `/v1/*` routes at `:134-189`. `auth` is used only at `:132` and `:196`.
- `better-auth/dist/auth/base.mjs:15`: `const pendingSchemaCheck = ctx.checkSchema?.();` runs at creation and is not awaited.
- Rerun, scenario K: `POST /v1/runs` and `PUT /v1/uploads/abc` show 1 round trip before the response and 3 after 50 ms. `POST /webhooks/github` shows 1 and 1.
- `apps/web/src/server.test.ts:68-71`: the comment and the workaround exist.

Corrections:

1. The line for the second use of `auth` is `:196`, not `:194`. `:194` is the start of the call.
2. The money cost is small. The Worker sets `limits.cpu_ms` to 240000 (`apps/web/wrangler.jsonc:39-42`). I assume from this value that the account is on a paid plan; I did not check the account. The real cost is two more calls on the busiest path and work on a database that runs one statement at a time.
3. The auditor's open question 6 is important and I cannot close it: a Worker can stop work that is not passed to `waitUntil` when the response ends. Ingest handlers make several of their own round trips, so the check normally has time to start. How many finish in production is not known.

The recommendation (move the line down) is correct and has no risk that I can find.

## AUTH-07 · Anonymous requests cost D1 work before the 401

Verdict: confirmed. Severity: low (the auditor says medium).

Proof that I checked:

- Rerun, scenario B1: status 401, 2 round trips, 76 statements. Scenario B2: status 401, 3 round trips, 77 statements.
- `apps/web/src/api/index.ts:123-126` is before `:194`.
- The Better Auth limiter runs only in the router. Scenario M shows the `rateLimit` queries for `auth.handler`. Scenarios A and B show none for the API.

Why I lower the severity: anonymous traffic to a private tool is small, and after AUTH-01 the cost is 0 round trips on the dashboard read and 1 on other paths. The report says this in its alternatives.

Corrections:

1. "A signed-out visitor waits for 3 RTs" is 2 on the dashboard (`GET /api/runs` skips the project check) and 3 on a run page.
2. The sketch tests `request.headers.has("authorization")`. That is necessary because the bearer plugin accepts that header. If AUTH-09 removes the plugin, the test can be removed too.

## AUTH-08 · For mutations, the origin check runs after the session and GitHub checks

Verdict: partly-confirmed. The finding is correct. The report says that the change needs no decision and has no alternative; an existing test fails after the change. Severity: low.

Proof that I checked:

- `apps/web/src/api/index.ts:194-208`: `requireMaintainer`, then `requireSameOrigin`.
- Rerun, scenario D1: status 403 `invalid_origin`, 6 round trips, 1 permission request. Scenario E0 after it: 1 more permission request, so the grant was removed.

Corrections:

1. An existing test depends on the current order. `apps/web/src/api/api.test.ts:575-590` ("rechecks permissions and rejects cross-origin review writes"):

   ```ts
   expect((await test.send("/api/runs", { headers })).status).toBe(200);
   // POST /api/review-sessions with origin "https://evil.example" → 403
   test.setPermission("read");
   expect((await test.send("/api/runs", { headers })).status).toBe(403);
   ```

   The last line passes today only because the refused write removed the read grant. With the origin check first, the grant stays and the read is answered from it. Measured (`probe-origin-order.out.txt`):

   ```text
   A: current code                       GET 200, POST 403, GET after permission change 403   permission_requests 3
   B: grant state after the AUTH-08 change  GET 200, POST 403, GET after permission change 200   permission_requests 1
   ```

   Sequence B leaves out the refused POST, because after the change it does not reach `requireMaintainer`. So the change needs an edit of that test (for example a clock step of 60 s before the last read). "Maintainer decision needed: no" is too strong.

2. The same result shows a small behavior change, not only a test change. Today a refused cross-origin write forces the next read to ask GitHub again. After the change it does not. Both are inside the 60 s rule of the contract.
3. The report uses `http.ts:20` ("Apply to cookie-authenticated mutations, before reading the request body") as evidence of an inconsistency. The code does not break that comment. The handlers read the body after `index.ts:207`. This is an optimization and a small hardening, not a broken rule.
4. Moving the check first changes one more answer: an anonymous cross-origin POST gets 401 today and 403 after the change.
5. The same-site example is correct in principle. The cookie is `SameSite=Lax` with no `Domain`. A page on `preview.visonaut.com` is same-site, so a simple POST from it carries the cookie. It needs script injection on that host first.

## AUTH-09 · The signed session token reaches page scripts, and the raw database token works as a credential

Verdict: partly-confirmed. The two stated facts are correct. The exposure is wider than the report says, and one part of the recommendation is not sufficient. Severity: medium.

Confirmed:

- `packages/security/src/auth.ts:53`: `plugins: [bearer()]`.
- `better-auth/dist/plugins/bearer/index.mjs:34-37`: a token with no signature is signed by the server unless `requireSignature` is set. `:52-66`: the plugin adds `set-auth-token` and `Access-Control-Expose-Headers`.
- `apps/web/src/api/index.ts:220-222`: all session headers are forwarded.
- Rerun, scenario F1: the response has `set-auth-token` and `access-control-expose-headers`. Scenario G1: `Authorization: Bearer <session.token>` returns 200. Scenario I: `set_auth_token_equals_cookie_value: true`.

Corrections:

1. Page scripts do not need the daily renewal to get a credential. Better Auth returns the raw token in JSON from two built-in routes, at any time. Measured (`probe-auth-routes.out.txt`):

   ```text
   GET /api/auth/get-session   200  {"session":{"expiresAt":"…","token":"Be06R4iL…", …
   GET /api/auth/list-sessions 200  [{"expiresAt":"…","token":"Be06R4iL…", …
   ```

   With the plugin default, that raw value is a full credential (scenario G1). So "one time per day" understates part 1.

2. For the same reason, "forward only `Set-Cookie`" does not close the exposure. `requireSignature: true` is the part that does: after it, the raw token from those two routes is not sufficient without `BETTER_AUTH_SECRET`.
3. Impact line: "plus decisions from a browser context" is too narrow. `requireSameOrigin` (`packages/security/src/http.ts:21-29`) compares the `Origin` header. A client that is not a browser can send any `Origin`. So a stolen token permits Approve and Reject from any client.
4. Cost of the recommendation: all tests in `packages/security/test/auth-d1.test.ts` use `authorization: Bearer ${session.token}` with the raw token (for example `:53`, `:240`, `:292`). They must sign the token after the change. The test at `:51` is named "stores sessions, accepts bearer reads, and revokes logout", so raw bearer reads are tested behavior today.
5. The bearer path is a documented public feature: `packages/cli/README.md:31` ("`status` requires `VISONAUT_TOKEN` with a valid maintainer session") and `packages/cli/src/engine.ts:733-746`. No document says how to get the token. After `requireSignature: true` the usable value is the signed cookie value, which a maintainer can copy from the browser tools.

The decision question in the report is the correct one.

## AUTH-10 · The origin rule differs for each route, and production also answers on workers.dev

Verdict: confirmed. Severity: low.

Proof that I checked:

- `apps/web/src/server.ts:73-76` (preview, all paths), `:83-84`, `:89-92`, and `apps/web/src/api/index.ts:110-112`.
- `apps/web/src/server.ts:118`: pages have no origin rule in production.
- `apps/web/wrangler.jsonc:48`: `"workers_dev": true` in `env.production`. `apps/compare/wrangler.jsonc:6`: `false`.

I found no document that says the production `workers.dev` address is necessary. The references to `workers.dev` in `docs/` and `tooling/` are for diagnostic and probe Workers with other names.

Note: preview also has `workers_dev: true` (`wrangler.jsonc:7`), but preview refuses all paths on a wrong origin, so only production shows the half-working page. "No data exposure found" agrees with what I read.

## AUTH-11 · Private failures have several shapes

Verdict: confirmed. Severity: low.

Proof that I checked:

- `apps/web/src/api/index.ts:38-44`: `schemaVersion` plus `error`, `Retry-After` only for 503.
- `apps/web/src/server.ts:34-53`: no `schemaVersion`, `Retry-After: 1` for all statuses.
- `apps/web/src/server.test.ts:214-219`: expects status 401 with `Retry-After` `"1"`.
- `apps/web/src/api/index.ts:216-218`: the 404 has no `schemaVersion`.
- `apps/web/src/api/review.ts:682-696`: the conflict body is `{ error, model, reviewer }`.
- Rerun, scenario A3: a missing run answers `409` with code `incomplete`.

No correction. The 409 for a missing record comes from `Service.one` in `packages/service/src/service.ts:104-106`. Other lanes may report it as an API finding.

## AUTH-12 · Duplicate and unused identity routes, and document drift

Verdict: partly-confirmed. Severity: low.

Confirmed:

- `/api/me` (`apps/web/src/server.ts:88-105`): no app code calls it. Five browser tests assert that it is not called.
- `/api/session` (`apps/web/src/api/review.ts:713-721`): a search finds no caller and no test.
- `apps/web/src/api/index.ts:124` and `:131-133`: not reachable in production, because `server.ts:82-87` answers `/api/auth/*` first. No test reaches that branch through `handleApi`.
- `docs/review-evidence-plan.md:62` still says that routes call `GET /api/me` first.
- `diff packages/security/migrations/0001_auth.sql apps/web/migrations/0003_auth.sql` prints nothing.

Corrections:

1. `/webhooks/github` is not drift. Two documents say that it is kept on purpose: `docs/simplification-implementation.md:228` ("the old URL remains an alias for the coordinated cutover") and `docs/operations/simplification-cutover.md:47` ("Preserve the old URL and Worker as rollback material until these checks pass"). The open question is only if the cutover is complete.
2. `/api/me` has more users than the report lists. Recorded operational probes use it: `docs/evidence/e02-final-auth.md:9-19`, `docs/evidence/deployed-review-readonly.md:6`, and the runbook that the auditor names. So it is an operational probe, not dead code. `/api/session` is the dead one.

## AUTH-13 · The access level comes from the HTTP method and a copied pattern

Verdict: judgment. The facts are confirmed. Severity: low.

- `apps/web/src/api/index.ts:192-204`: the quoted code is exact.
- `apps/web/src/api/review.ts:837`: the same pattern, with a capture group.
- No wrong level exists today. I agree with the auditor on that.

The smaller alternative (export one pattern and use it in both files) removes the only real risk with a few lines. The route table is a larger design choice.

## AUTH-14 · Rate limiting covers only the auth routes, uses D1, and takes the client address from `X-Forwarded-For`

Verdict: confirmed. Severity: low.

Proof that I checked:

- `packages/security/src/auth.ts:52`, and no `advanced.ipAddress` key.
- `@better-auth/core/dist/utils/ip.mjs:190` (`if (forwardedIps.length !== 1) return null;`) and `:196` (`const DEFAULT_IP_HEADERS = ["x-forwarded-for"];`).
- Rerun, scenario M: 2 limiter round trips for one auth request, and the rows `203.0.113.7|/get-session` (1) and `no-trusted-ip|/get-session` (2).
- Platform: Cloudflare documents the header. "If there was no existing `X-Forwarded-For` header in the request sent to Cloudflare, `X-Forwarded-For` has an identical value to the `CF-Connecting-IP` header." If one exists, "Cloudflare will append the IP address of the HTTP proxy connecting to Cloudflare to the header." (https://developers.cloudflare.com/fundamentals/reference/http-headers/). This supports the auditor's assumption in open question 3. I did not test it on a deployed Worker.

Clarification, not a correction: this is not a way to avoid the limit. A client that sends its own `X-Forwarded-For` gets two addresses in the header and goes to the shared `no-trusted-ip` bucket, which has the same limit. The effect is that such clients can fill the bucket that real users behind a forwarding proxy share. The report says this correctly.

## AUTH-15 · Each OIDC verification gets the GitHub key set again and makes 9 to 12 sequential GitHub requests

Verdict: partly-confirmed. Severity: low (the auditor says medium).

Confirmed:

- `packages/security/src/oidc.ts:120-124`: `createRemoteJWKSet` is called inside the function.
- The request count for a pull request with the production configuration is 9 to 12. I counted: `:165`, `:190`, `:240`, `:243`, `:258` (1 or more pages), `:295`, `:303`, `:311`, `:313`, then `:320`, `:324`, `:330` when their conditions apply.
- `jose` 6.2.12 exports `jwksCache` and `JWKSCacheInput` (`jose/dist/types/index.d.ts:31-32`). The recommended code is valid.

Corrections:

1. "One CI run verifies at Plan, at each shard reservation, at Begin, and at Submit" is wrong, and so is "GitHub App rate budget is used for each shard". Only one reservation is possible. `apps/web/src/api/workflow-owned.ts:153-165`:

   ```ts
   if (shardKey !== "combined") {
     throw new SecurityError(
       "unsupported_capture_path",
       403,
       "Only signed combined Submit is supported.",
     );
   }
   ```

   Also, Plan is sent only when no visual work is necessary. `apps/web/src/api/pre-run.ts:55` refuses a body unless `visualRequired === false`. So a visual run verifies 3 times (Begin, one Reserve, Submit), and a run with no visual work verifies 1 time (Plan). The total for a visual run is about 3 key set requests and 27 to 36 GitHub requests, not a number that grows with shards.

2. The Plan call sets `trustedWorkflowPath` equal to `workflowPath` (`pre-run.ts:89-93`), so it skips the request at `oidc.ts:190`. Plan makes one request fewer.
3. The module-level key cache helps only when one isolate serves more than one verification. The three calls of one CI run are minutes apart. The gain is small.
4. `Promise.all` for the reads is feasible. It has two side effects that the report does not state: a request that would fail early now makes all the GitHub requests, and the `oidc_rejected` log line can name a different first check.

I lower the severity because this path is CI, not a maintainer page, and the frequency is 3 for each run.

## AUTH-16 · GitHub OAuth user tokens are stored and never read

Verdict: partly-confirmed. The title is wrong in one important way. Severity: medium (the auditor says low).

Confirmed:

- `packages/security/src/auth.ts:36-41`: `encryptOAuthTokens: true, updateAccountOnSignIn: true`.
- A search of `apps/web/src`, `packages/*/src`, and `apps/compare/src` (tests excluded) finds only the two statements that set the columns to `NULL`: `packages/security/src/webhooks.ts:137` and `apps/web/src/operations/recovery.ts:40`. No app code reads the tokens.
- `packages/security/src/github.ts:208-262`: permission checks use the App installation token.

Corrections:

1. "Never read" is false for the deployed surface. Better Auth has a built-in route that decrypts the token and returns it. `apps/web/src/server.ts:82-87` sends all of `/api/auth/*` to `auth.handler` with no path filter. Measured with the production options and only a session cookie (`probe-auth-routes.out.txt`):

   ```text
   {"stored_token_is_encrypted":true,"stored_token_length":154}
   POST /api/auth/get-access-token  200  returns_plaintext_token: true
   body: {"accessToken":"<the plaintext token>","scopes":["read:user","user:email"]}
   ```

   Source: `better-auth/dist/api/routes/account.mjs:408-439` (`/get-access-token`) and `:351-406` (`getValidAccessToken`, which calls `decryptOAuthToken` at `:396`). So the encryption at rest does not protect the token from a script that runs with the user's session.

2. "Narrow scope" is not correct for this client. `GITHUB_CLIENT_ID` is `Iv23lihLxwLZeW7tlh5u` (`apps/web/wrangler.jsonc:55`). The `Iv23` prefix and the `GITHUB_APP_ID` next to it show a GitHub App client, not a classic OAuth App. GitHub says: "Unlike a traditional OAuth token, the user access token does not use scopes. Instead, it uses fine-grained permissions", and "A user access token only has permissions that both the user and the app have." (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app). The `scope` list in `auth.ts:33` has no effect on the token. For a maintainer, the token can do what the App can do on the repository as that user.
3. The same GitHub page says that the token lasts 8 hours and the refresh token 6 months when expiration is enabled. If it is enabled for this App, a refresh token is stored too. I cannot see the App setting, so this is not verified.
4. The recommendation (clear the columns in `databaseHooks`) is feasible and correct, and with it the route has nothing to return. I recommend that the route is also disabled (see Missed, item 1), so that a later change of the hook does not open it again.

## AUTH-17 · Small gaps in the response headers

Verdict: confirmed. Severity: low.

Proof that I checked:

- `packages/security/src/http.ts:31-50`: no `Cross-Origin-Resource-Policy`. `:39`: `max-age=31536000` with no `includeSubDomains`.
- `apps/web/src/api/images.ts:55`: `"Cross-Origin-Resource-Policy": "same-origin"`.
- `better-auth/dist/api/routes/session.mjs:33-34`: `cache-control: no-store` and `pragma: no-cache`. Rerun, scenario A1, shows `pragma: no-cache` in the API response.
- `apps/web/src/server.ts:60-71`: `/health` sets only `Cache-Control`.

No correction. `includeSubDomains` is a decision for all hosts under `visonaut.com`, so it is not a pure code change.

## Missed

These are in the lane scope and are not in the report. Items 1 and 3 are measured. The others are from reading.

1. **Better Auth built-in routes are open with no allowlist.** `server.ts:82-87` passes all of `/api/auth/*` to the handler. Measured with a session cookie only: `get-access-token` returns the plaintext GitHub user token, `get-session` and `list-sessions` return the raw session token, and `update-user` changes the user row (`user_name_after_update_user: "Changed by the probe"`). The app needs only sign-in, callback, sign-out, and get-session.
2. **Sign-in is open to all GitHub users.** `auth.ts` has no sign-up limit and no user-create hook. The maintainer check runs only in `requireMaintainer`, after the rows exist. Each sign-in by any GitHub account writes `user`, `account`, `session`, and `auth_audit` rows, and gets access to the routes in item 1. Not exercised against GitHub.
3. **The 60 s operations poll never uses the 60 s grant.** Poll period `60000` (`operations-attention/index.tsx:280`), grant lifetime `60_000` with a strict `>` test (`authorization.ts:21`, `:63`). Measured: `permission_requests_for_each_of_5_polls_60s_apart: [1,1,1,1,1]`. Each open dashboard makes one live GitHub permission request each minute. Limit: another read in the same isolate inside the 60 s refreshes the grant.
4. **No Worker placement and no D1 session setting.** `apps/web/wrangler.jsonc` has no `placement` key, and no code calls `withSession`. The production samples fit about 100 ms for each added D1 round trip: 6 round trips took 865 to 1077 ms and 9 took 1204 to 1299 ms. This is an estimate from two request types, not a direct measurement. Smart Placement exists for a Worker that makes many requests to one back end (https://developers.cloudflare.com/workers/configuration/placement/); that page does not name D1, so the gain for D1 must be measured. This changes the weight of each round-trip finding in this lane.
5. **The runtime schema check is the only schema guard.** No test compares migration `0003_auth.sql` with the Better Auth schema. AUTH-01 removes the runtime check, so the test must come with it.
6. **A stolen session token is sufficient for decisions.** `requireSameOrigin` trusts the `Origin` header, which only a browser protects. With the bearer plugin, a token from a database copy plus a forged `Origin` header can send Approve and Reject. This belongs with AUTH-09.
7. **More repeated project checks than the report lists.** `apps/web/src/api/webhooks.ts:157` and `apps/web/src/api/workflow-materialize.ts:495` call `assertConfiguredProject` after `index.ts:125` already did.
