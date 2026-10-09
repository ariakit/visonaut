# Cloudflare configuration, CI/CD, release, and tooling configuration

Audit date: 2026-10-05. Source: worktree `serialized-dazzling-pixel` at commit `f83fef6` (same commit as `origin/main`).
Paths are relative to the repository root. All measurements came from São Paulo (Cloudflare edge `GRU`).
The scratch scripts and raw outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/infra/`.

Three results matter most for the page-load complaint:

1. **INFRA-01**: each request that touches auth runs a database schema check first (2 extra D1 round trips, one with 75 statements). This is measured.
2. **INFRA-02**: the Worker runs at the visitor's edge and has no placement setting. Each D1 query and each GitHub call is a long round trip.
3. **INFRA-03**: the browser revalidates all 10 static files on each page load, because hashed assets have `max-age=0`.

## How it works (map)

### Workers and configuration

| Worker                | Config                                              | Name                       | Public address                                                    | Bindings                                                                                                                       |
| --------------------- | --------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Web, preview          | `apps/web/wrangler.jsonc:3-45` (top level)          | `visonaut-preview`         | `preview.visonaut.com` and `visonaut-preview.ariakit.workers.dev` | None. Fixtures only (`apps/web/wrangler.jsonc:31-37`)                                                                          |
| Web, production       | `apps/web/wrangler.jsonc:46-123` (`env.production`) | `visonaut`                 | `visonaut.com` and `visonaut.ariakit.workers.dev`                 | `DB` (D1), `IMAGES`, `QUARANTINE` (R2), `COMPARATOR` (service), `OPERATIONS` (queue producer and consumer), cron `*/5 * * * *` |
| Validator, local      | `apps/compare/wrangler.jsonc:3-30` (top level)      | `visonaut-compare-local`   | None (`workers_dev: false`)                                       | None                                                                                                                           |
| Validator, production | `apps/compare/wrangler.jsonc:31-62`                 | `visonaut-compare`         | None. Reached through the `COMPARATOR` service binding only       | `DB`, `IMAGES`, `OPERATIONS` (declared, not used by code, see INFRA-11)                                                        |
| Codec probe           | `apps/compare/wrangler.probe.jsonc`                 | `visonaut-codec-probe`     | `workers.dev`, token protected                                    | None                                                                                                                           |
| Container probe       | `apps/compare/wrangler.container-probe.jsonc`       | `visonaut-container-probe` | `workers.dev`, token protected                                    | Container Durable Object                                                                                                       |

Verified facts about the web configuration:

- The top level is the preview service. `env.production` is production. Wrangler copies only the inheritable keys into an environment. For this file, production inherits `main`, `compatibility_date`, `compatibility_flags`, `observability`, `preview_urls`, and `limits`. It repeats `vars`, `d1_databases`, `r2_buckets`, `services`, `queues`, and `secrets` because those keys are not inheritable ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
- `preview_urls` is `false` for both web services and for the validator (`apps/web/wrangler.jsonc:38`, `apps/compare/wrangler.jsonc:30`). This is correct. A preview URL would expose a version with production bindings.
- Logs and traces are on for all four configs (`apps/web/wrangler.jsonc:15-20`). There is no sampling, export, or tail consumer setting.
- Secrets are not in the config. `env.production.secrets.required` lists 5 names (`apps/web/wrangler.jsonc:113-121`). The same 5 names are the ones that `apps/web/src/runtime.ts:122-131,236,240` reads. `vars` contains only public identifiers.
- The Cloudflare Vite plugin makes the deployable config. The build writes `apps/web/dist/server/wrangler.json` (flat, one environment) and adds `"assets": { "directory": "../client" }`. `CLOUDFLARE_ENV` selects the environment at build time ([Vite plugin environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)).

### Request walk-through (production)

1. The browser connects to the nearest Cloudflare location.
2. If the path matches a file in `dist/client`, Cloudflare serves the file. The Worker does not run. The response has `cache-control: public, max-age=0, must-revalidate` (measured).
3. For other paths, the Worker `visonaut` runs **in that same location**. There is no `placement` key.
4. `apps/web/src/server.ts:60-71`: `/health` returns static JSON.
5. `apps/web/src/server.ts:82-117`: `/api/auth/*`, `/api/me`, `/api/*`, `/v1/*`, `/images/*`, and `/webhooks/github` go to auth or to `handleApi`. Each of these paths calls `createAuth(...)` again (`apps/web/src/server.ts:85`, `:93`, `apps/web/src/api/index.ts:130`).
6. `apps/web/src/server.ts:118`: all other paths get the server-rendered shell. The shell has no data. Its text is "Checking access and loading runs…" (measured). The client then loads 1 CSS file and 8 JS files and calls `/api/runs`.
7. Cron runs each 5 minutes. `scheduled()` only sends `{ kind: "recovery" }` to the queue (`apps/web/src/server.ts:129-139`). The queue consumer does the work, one message at a time (`apps/web/wrangler.jsonc:98-107`).

### Deploy walk-through (push to `main`)

1. `deploy.yml:39-47` calls `checks.yml` again (lint, typecheck, build, 3 test shards, browser, release guards, gate).
2. `deploy.yml:48-133` then runs the `deploy` job:
   1. Install, then `pnpm build` with `CLOUDFLARE_ENV=production` (builds all workspaces).
   2. `deploy-source.mjs` requires that the run commit is still the tip of `main`, and that the generated config has name `visonaut`.
   3. `deploy-scope.mjs`, then two Infisical OIDC reads (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_MIGRATIONS_API_TOKEN`), then `deploy-credentials.mjs`.
   4. `deploy-infrastructure.mjs` (1 Cloudflare API read) and `deploy-comparison-retirement.mjs` (2 Cloudflare API reads).
   5. `wrangler d1 migrations apply DB --remote --env production`.
   6. `wrangler deploy` for the validator, then `wrangler deploy` for the web Worker.
3. `release.yml` runs at the same time. It opens or updates the "Version packages" pull request, or publishes to npm.
4. Manual `workflow_dispatch` actions: `migrate`, `preview-web`, `production-fence` (`deploy.yml:6-29`). Preview deploys **only** through `preview-web`.

### Tooling

- pnpm 12.5.1 workspace (`apps/*`, `packages/*`), Node 24.18.0, exact versions everywhere, `saveExact: true`.
- `apps/compare/container` is a separate npm project with its own `package-lock.json`.
- Lint: `oxlint` (category `correctness`) and `oxfmt --check`. Lefthook runs `pnpm lint` before each commit.
- Tests: one root `vitest.config.ts`; browser tests through Playwright with Google Chrome; release guards through `node --test`.
- Release: Changesets. Private workspaces also get versions and changelogs (`.changeset/config.json:9`).

## Findings

### INFRA-01 · Each request that uses auth runs a full schema check against D1 first

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/auth.ts:15-16`: "Create inside each request so a D1 binding cannot cross request ownership." `createAuth` has 3 call sites, all for each request: `apps/web/src/server.ts:85`, `apps/web/src/server.ts:93`, `apps/web/src/api/index.ts:130`.
  - Library, `@better-auth/core@1.7.5` `dist/db/schema-check.mjs:4-9`: "Whether the adapter validates its schema. Enabled in every environment unless explicitly disabled." `return options.advanced?.database?.validateSchema !== false;`
  - Library, `@better-auth/kysely-adapter@1.7.5` `dist/index.mjs:712`: each adapter instance registers its own check. The "clean" result is kept in a closure for that instance (`schema-check.mjs:58`, `let clean = false`). A new instance starts again.
  - Library, `better-auth@1.7.5` `dist/api/to-auth-endpoints.mjs:41-42` and `dist/api/index.mjs:169-170`: each API call awaits `checkSchema()` before its own work.
  - Local probe with the repository functions (`authprobe/probe.test.ts`, result in `authprobe/result.json`). The probe wraps the D1 binding and records each statement:
    - Request with no session: `select "name", "type", "sql" from "sqlite_master" …` and then `BATCH(75)`. No other statement. The schema has 76 tables and views.
    - Request with a valid session, cold permission cache: the same 2 schema calls, then `session`, `user`, and `account` selects (5 D1 round trips), then 2 GitHub requests.
    - An auth instance that is created and never used also runs the 2 schema calls in the background.
    - One reused instance: the second call makes 0 D1 calls. Local median 0.0 ms compared with 433.5 ms for a new instance on each call (local numbers; not production timing).
    - Same options plus `validateSchema: false`: 0 D1 calls for a request with no session, and 2 (`session`, `user`) for a valid session.
  - Production, 12 samples each, new connection each time: `GET https://visonaut.com/api/me` with no cookie returns 401 in 0.367 s minimum and 0.442 s median. A response that exits before `createAuth` (`GET https://visonaut.ariakit.workers.dev/api/me`, 403) takes 0.077 s minimum and 0.131 s median.
- What happens: Better Auth 1.7.5 compares the live database with its expected tables. It reads `sqlite_master` and then sends one batch with a statement for each table. The result is cached in the auth instance. Visonaut makes a new instance for each request, so the cache is always empty.
- Impact:
  - Each `/api/*` request waits for 2 extra D1 round trips before the session lookup. In production the unauthenticated path costs about 0.29 s more than a response that does not create auth. The only D1 work on that path is the schema check.
  - A page load makes several API calls (`/api/runs`, `/api/operations`, `/api/runs/:id`). Each call pays this cost again.
  - `apps/web/src/api/index.ts:130` creates the instance before the `/v1/*` upload routes. These routes do not use the session. Each CLI upload request still starts the 76-statement check in the background. This adds D1 load and 2 subrequests for each upload request.
- Recommendation: turn the runtime check off. The deploy applies migrations before it deploys code, and `packages/security/test/auth-d1.test.ts` runs Better Auth against the same migrations.

  ```ts
  // packages/security/src/auth.ts
  advanced: {
    cookiePrefix: `visonaut-${configuration.environment}`,
    useSecureCookies: configuration.environment !== "local",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    database: { validateSchema: false },
  },
  ```

- Alternatives:
  - Keep the check, but keep one auth instance for each isolate (for example a `WeakMap<D1Database, VisonautAuth>`). The check then runs one time for each isolate. This also removes the construction cost for each request. The code comment gives request ownership as the reason for the current design, so this needs a test in the Workers runtime.
  - Minimal: create the auth instance only on routes that read the session (move `apps/web/src/api/index.ts:130` below the `/v1/*` branches). This removes the cost from CLI uploads only.
- Maintainer decision needed: yes. Do you want the runtime schema check off (migrations and tests are the guard), or do you want one cached auth instance for each isolate?

### INFRA-02 · The Worker has no placement setting, so each D1 query and GitHub call is a long round trip

- Kind: performance
- Severity: high. Confidence: medium. Measured: yes. Effort: S
- Evidence:
  - `apps/web/wrangler.jsonc:1-125` has no `placement` key. Production responses have no `cf-placement` header (headers recorded in the Measurements section). Cloudflare adds that header "to all requests when placement is enabled" ([placement](https://developers.cloudflare.com/workers/configuration/placement/)).
  - Sequential work before the first data query, counted from code and from the probe: 2 schema calls (INFRA-01), `session` select, `user` select, `account` select (`packages/security/src/authorization.ts:32-43`), and on a cold cache 2 GitHub requests (`packages/security/src/authorization.ts:73`, `packages/security/src/github.ts:214-218`), plus 1 more GitHub request to mint an installation token when the isolate has none (`packages/security/src/github.ts:133-141`).
  - Production: the 2 schema calls cost about 0.29 s together from `GRU` (INFRA-01). This is an indirect estimate of about 0.1 s to 0.15 s for each D1 round trip. It is not a direct D1 measurement.
  - D1 has no South America region. Replica and primary regions are "ENAM, WNAM, WEUR, EEUR, APAC, OC" ([D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)).
- What happens: the Worker runs in the Cloudflare location nearest to the visitor. Each `env.DB` call and each `api.github.com` call then crosses the distance to the database region or to GitHub. The calls are sequential.
- Impact: after INFRA-01 is fixed, a signed-in API request still makes at least 3 D1 round trips before its first data query, and 2 to 3 GitHub calls when the permission cache is cold (the cache lives 60 s for each isolate, `packages/security/src/authorization.ts:21`). At about 0.1 s each, the access check alone is about 0.3 s to 0.6 s. The benefit of a placement change is not measured.
- Recommendation: put the Worker near the database with an explicit placement hint. First read the database region (see Open questions). Then set, for example:

  ```jsonc
  // apps/web/wrangler.jsonc, inside env.production ("placement" is inheritable; keep preview at the edge)
  "placement": { "region": "aws:us-east-1" }
  ```

  Static assets stay at the edge: "Static assets are always served from the location nearest to the incoming request." Placement "only affects the execution of fetch event handlers" ([placement](https://developers.cloudflare.com/workers/configuration/placement/)). Compare the `/api/runs` trace before and after. Traces are already on.

- Alternatives:
  - `"placement": { "mode": "smart" }`. Cloudflare states that it "requires consistent traffic to the Worker from multiple locations to make a placement decision". This service has few users, so Smart Placement can stay undecided. The explicit hint is deterministic.
  - No placement change. Reduce the number of round trips in code instead (one joined query for session, user, and account; a signed short-lived permission cookie). This is service work.
  - Minimal: only measure. Open one `/api/runs` trace in the dashboard and read the span times for D1 and `fetch`.
- Maintainer decision needed: yes. In which region is the D1 database, and do you accept that server rendering moves away from the visitor so that the data calls become short?

### INFRA-03 · The browser revalidates all hashed static files on each page load

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `curl -sI https://visonaut.com/assets/index-CXm4JU5N.css` → `cache-control: public, max-age=0, must-revalidate`, `etag: W/"9e4cfd69…"`, `cf-cache-status: HIT`. The same header is on `/assets/index-MxeSnhFR.js` and `/favicon.svg`.
  - A conditional request returns `304` in 0.094 s (new connection).
  - `apps/web/public/` contains only `favicon.svg`. There is no `_headers` file.
  - The home page HTML references 10 static files: 1 stylesheet, 8 `modulepreload` scripts, 1 icon.
  - Cloudflare default: "Cache-Control: public, max-age=0, must-revalidate". Custom headers come from a `_headers` file in the assets directory ([static assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)). The Vite plugin supports `_headers` in `public` "at build, preview and deploy time" ([Vite plugin static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)).
- What happens: Vite gives each file a content hash in its name, so a file never changes. The server still tells the browser to ask again each time.
- Impact: each visit sends 10 conditional requests before the browser can use its cached copies. The stylesheet blocks rendering, so the first paint waits for at least one more round trip (about 0.09 s measured, more on a slow link). First-visit transfer is 43,813 bytes (brotli) for the CSS and 102,706 bytes for the entry script.
- Recommendation: add `apps/web/public/_headers`:

  ```
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```

  Keep the default for `/favicon.svg` because its name has no hash.

- Alternatives:
  - A shorter lifetime (`max-age=86400`) if you want a time limit. `immutable` is safe only for hashed names.
  - No change. The cost is one parallel round trip for each file on each visit.
- Maintainer decision needed: no.

### INFRA-04 · A missing asset URL runs the full server render, and production deploys about 13 times each day

- Kind: performance
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `curl -s -D - https://visonaut.com/assets/runs._runId-OLDHASH0.js` → `HTTP/2 404`, `content-type: text/html; charset=utf-8`, 2,414 bytes, time to first byte 1.448 s on the first try. A second unknown asset took 0.211 s.
  - `apps/web/src/server.ts:106-118`: a path that is not an API path goes to `render(request)`.
  - Deploy history: 67 successful production deploys between 2026-10-01 18:00 UTC and 2026-10-05 18:47 UTC (`gh run list --workflow deploy.yml`).
  - Cloudflare describes the same skew for gradual rollouts: a request for a file that the new version does not have gives "a 404 error and a broken page" ([gradual rollouts and assets](https://developers.cloudflare.com/workers/static-assets/routing/advanced/gradual-rollouts/)).
- What happens: after a deploy, an open tab still has the old HTML. When it navigates to a route that loads a lazy chunk (`runs._runId-*.js`, 137,841 bytes), the old file name no longer exists. The Worker renders an HTML 404 page for a script URL.
- Impact: the navigation fails or the page reloads. A reload clears the local Undo stack (`docs/development.md:57`). Each such request also runs server rendering for nothing.
- Recommendation: answer unknown `/assets/*` paths before the render, with a plain 404.

  ```ts
  // apps/web/src/server.ts, before requireBackendBindings(env)
  if (url.pathname.startsWith("/assets/")) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  ```

  Then decide how the client reacts to a failed chunk (one automatic reload, or a "new version" notice).

- Alternatives:
  - Deploy less often (INFRA-07). This lowers how often skew occurs.
  - Keep the previous build's assets in the upload for one release. This needs a custom build step.
- Maintainer decision needed: yes. Is one automatic reload acceptable in the review page, or must the page keep its local state?

### INFRA-05 · D1 read replication is not in use, and it gives little for the current users

- Kind: performance
- Severity: low. Confidence: medium. Measured: no. Effort: L
- Evidence:
  - `rg withSession apps packages` returns no match. Cloudflare: "To use read replication, you must use the D1 Sessions API… otherwise all queries will continue to be executed only by the primary database instance." ([D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)).
  - Replica regions are "ENAM, WNAM, WEUR, EEUR, APAC, OC". There is none in South America. "A read replica may be arbitrarily out of date."
  - "D1 read replication is built into D1, so you don't pay extra storage or compute costs for read replicas."
- What happens: all queries go to the primary database.
- Impact: none today. Replication helps only when maintainers are far from the primary and near another region. For a visitor in São Paulo the nearest replica is probably in the same region as the primary. The review flow also needs read-after-write, so each session must carry a bookmark.
- Recommendation: do INFRA-01 and INFRA-02 first. Use replication only if a maintainer in another continent reports slow reads after that.
- Alternatives:
  - Use `env.DB.withSession("first-unconstrained")` only for the read-only dashboard list and keep the primary for review writes.
  - No change.
- Maintainer decision needed: no.

### INFRA-06 · Deploy runs the full check suite again; 87% of deploy time is this second run, and superseded runs end as failures

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `deploy.yml:39-47`: `verify` uses `./.github/workflows/checks.yml`. `deploy.yml:49`: `needs: verify`.
  - Run 37357689984 (commit `f83fef6`): total 433 s. `verify / Test 2/3` 366 s, then `Gate` 10 s. The `deploy` job itself took 50 s (build 9 s, validator deploy 7 s, web deploy 8 s).
  - The same tree passed CI on the pull request 5 minutes before (run 37357042248, 284 s).
  - Push deploys since 2026-10-01: 78 runs, 67 success, 9 failure, 2 cancelled. Median success 257 s, p90 352 s, maximum 451 s.
  - 3 of 3 sampled failures (runs 37068376656, 37067424143, 37007425513) failed in the step "Require the current main commit and production build" (`deploy.yml:77-80`, `.github/workflows/scripts/deploy-source.mjs:17-21`: "A newer main commit supersedes this deployment").
- What happens: each merge runs all checks a second time on `main`, and deploys only after that. When two merges are close together, the older run finishes its checks and then fails by design.
- Impact: a merged change reaches production 4.5 to 7.5 minutes after the merge. The deploy step needs under 1 minute. `main` shows red runs that are not real failures (9 of 78).
- Recommendation: keep one verification of the exact merged tree and make a superseded run end as skipped, not failed. A merge queue does this: checks run on the merge group, so `main` receives only verified commits.

  ```yaml
  # checks.yml
  on:
    pull_request:
    merge_group:
    workflow_call:
  ```

- Alternatives:
  - Keep the second run, but move the "current main" check to the start of the workflow as a separate job with an output, and use `if:` on the later jobs. A superseded run then skips its work and stays green.
  - Skip `verify` when the merge commit tree equals a tree that already passed CI (compare `git rev-parse HEAD^{tree}` with the pull request's merge ref).
  - Minimal: no change in behavior. Only make the superseded exit neutral.
- Maintainer decision needed: yes. Must the checks run a second time on `main`, or is one run on the exact merged tree enough?

### INFRA-07 · Each push redeploys both Workers, and each change with a changeset causes a second CI and deploy cycle

- Kind: cost
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `deploy.yml:3-5` has no path filter. `deploy.yml:130-133` deploys the validator and the web Worker each time.
  - Last 120 commits on `origin/main` (2026-09-28 to 2026-10-05, `commit-scope.mjs`): 43 changed no deployable runtime file; 12 changed only `CHANGELOG.md`, `package.json`, or `.changeset`; 7 changed only docs; 8 touched the validator source or config.
  - `.changeset/config.json:9`: `"privatePackages": { "version": true, "tag": false }`. A changeset for the private web app opens a "Version packages" pull request.
  - 33 of the last 200 CI runs were on `changeset-release/main`. 3 of the last 11 push deploys were for "Version packages" commits (#243, #246, #248). Pull request #253 is open now.
- What happens: a web change with a changeset gives this chain: CI on the pull request, deploy (with the full checks), CI on the version pull request, then a second deploy that changes only version numbers and changelogs.
- Impact: about 36% of production deploys ship no runtime change. Each deploy makes a new Worker version, so warm isolates and the validator's loaded WASM codecs are dropped. Each deploy can also cause the asset skew in INFRA-04.
- Recommendation: deploy only when a deployable path changed, and decide if private workspaces need versions.

  ```yaml
  # deploy.yml (the release-guard tests read this file; update them together)
  on:
    push:
      branches: [main]
      paths:
        - "apps/**"
        - "packages/**"
        - "pnpm-lock.yaml"
        - ".github/workflows/**"
        - "!**/*.md"
  ```

- Alternatives:
  - Keep one workflow, but deploy the validator only when `apps/compare/**` or `packages/compare/**` changed.
  - Set `privatePackages.version` to `false`, or list the private workspaces in `ignore`. Then only the two public packages create version pull requests.
  - Minimal: no change to triggers. Add `[skip deploy]` handling for the version commit only.
- Maintainer decision needed: yes. Do the private workspaces (`@visonaut/web`, `@visonaut/service`, and others) need versions and changelogs?

### INFRA-08 · CI wall time went from about 210 s to about 294 s in 3 days; shards are unbalanced and old runs are not cancelled

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - CI success duration: median 210 s for 84 runs on 2026-10-01 and 2026-10-02; median 294 s (249 to 316) for 11 runs since 2026-10-04.
  - Run 37357042248: `Test 1/3` 218 s, `Test 2/3` 268 s, `Test 3/3` 140 s, `Browser` 222 s. The other jobs take 23 s to 35 s.
  - `vitest run --shard` step times in the same run: 155 s, 201 s, 80 s. On the merge commit: 149 s, 292 s, 72 s.
  - "Initialize containers" takes 26 s to 40 s in each shard (`checks.yml:78-80`). Only 2 test files start a browser (`packages/playwright/test/clients.test.ts:16`, `packages/playwright/test/comparison.test.ts:12`).
  - Browser tests took 75 s to 101 s on 2026-10-02 (`docs/evidence/issue-204-ci/README.md`) and 118 s to 153 s now.
  - `checks.yml:1-13` has no `concurrency` key. A new push to a pull request does not cancel the run for the old commit.
  - `pnpm build` in each shard takes 5 s to 10 s. This repeat is not important.
- What happens: Vitest splits files by count, not by time. The slowest shard sets the wall time. Each shard also pulls the Playwright image.
- Impact: the feedback time for each push is the time of the slowest shard plus the gate. Deploy time grows by the same amount (INFRA-06). Each run uses about 16 runner minutes.
- Recommendation:
  - Run the 2 browser-dependent test files in one job with the container. Run the other files on the plain runner. This removes about 30 s from each of the other shards.
  - Use 4 shards, or give the heavy files to named jobs.
  - Cancel superseded pull request runs. Do not cancel when `checks.yml` is called from `deploy.yml`:

  ```yaml
  concurrency:
    group: ci-${{ github.event.pull_request.number || github.run_id }}
    cancel-in-progress: ${{ github.event_name == 'pull_request' }}
  ```

- Alternatives:
  - Minimal: only add the `concurrency` block.
  - Find the slow files first (`vitest run --reporter=json` in one CI run) and split only those.
- Maintainer decision needed: no.

### INFRA-09 · The normal deploy has no check after deploy, no version identity, and a weaker config guard than the manual path

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `deploy.yml:125-133`: migrations, validator deploy, web deploy. There is no later step.
  - `GET https://visonaut.com/health` → `{"service":"visonaut","status":"ready","launchEnabled":true,"environment":"production","fixtureMode":false}`. There is no commit or version. I could identify the live build only by the CSS file hash.
  - `.github/workflows/scripts/deploy-source.mjs:22-27`: the push path checks 3 values (`name`, `VISONAUT_ENVIRONMENT`, `VISONAUT_ALLOW_MAIN_DISPATCH`). `deploy.yml:306-370`: the manual path checks about 20 values (database ID, buckets, service, queue settings, cron, routes, observability).
  - The deploy output shows only `Current Version ID: 2034b3ca-…`. `wrangler deploy --help` (4.136.1) lists `--tag`, `--message`, and `--strict`.
  - `.github/workflows/README.md:7`: "Worker rollback does not undo D1 migrations or resource changes."
- What happens: the workflow ends when Wrangler returns. Nothing reads the live service. A bad deploy stays live until a person sees it.
- Impact: with about 13 deploys each day, a runtime failure after deploy (for example a missing binding or a wrong variable) is found by a user or by the Ariakit CI. There is no automatic rollback.
- Recommendation:
  1. Record the commit in the version, and expose it.

     ```sh
     pnpm exec wrangler deploy --config apps/web/dist/server/wrangler.json --tag "$GITHUB_SHA" --message "$GITHUB_SHA"
     ```

     ```jsonc
     // apps/web/wrangler.jsonc, inside env.production
     "version_metadata": { "binding": "CF_VERSION_METADATA" }
     ```

     The binding gives `id`, `tag`, and `timestamp` ([version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)). Return the tag from `/health`.

  2. After deploy, request `/health` and compare the tag with `$GITHUB_SHA`. If the check fails, run `wrangler rollback` and fail the job.
  3. Use one guard script for both paths (see INFRA-20).
- Alternatives:
  - Gradual deployment: `wrangler versions upload`, then `wrangler versions deploy` with a percentage ([gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/)). With few users a percentage gives little signal. It also adds the asset skew that Cloudflare documents, unless version affinity is set.
  - Minimal: only add the health request after deploy, without rollback.
- Maintainer decision needed: yes. Do you want automatic rollback when the check after deploy fails?

### INFRA-10 · Each deploy depends on two retired queues and runs one-time cutover gates

- Kind: simplification
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `.github/workflows/scripts/deploy-comparison-retirement.mjs:5-10`: two fixed queue IDs for `visonaut-production-comparisons` and `visonaut-production-comparison-dead-letter`. Line 32: `assert(response.ok, "Cannot read the comparison queue");`
  - `deploy.yml:117-124` runs this script and `deploy-infrastructure.mjs` in each production deploy.
  - `.github/workflows/scripts/deploy-infrastructure.mjs:7-8`: `if (!container) return;`. The deploy log shows that the validator has no `CODEC_CONTAINER` binding, so this gate now does nothing.
  - `apps/compare/README.md:5`: "This Worker has no queue handler or cron."
- What happens: each deploy makes 3 Cloudflare API reads for a cutover that is complete. The queue check fails when a queue does not answer.
- Impact: if someone deletes the two unused comparison queues, all production deploys fail at "Require detached comparison consumers before handler retirement". The deploy token also needs queue and Worker-settings read access only for these gates.
- Recommendation: remove both gate steps, their scripts, and their tests after you confirm that the cutover is closed. Then delete the unused queues.
- Alternatives:
  - Keep the queue gate, but accept HTTP 404 as "detached".
  - Move both gates to the manual `workflow_dispatch` path only.
- Maintainer decision needed: yes. Is the comparison retirement complete, so that these gates and the two comparison queues can go?

### INFRA-11 · The production validator Worker has D1, R2, and queue bindings that its code does not use

- Kind: security
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/compare/wrangler.jsonc:38-59` binds `DB` (the production database), `IMAGES`, and `OPERATIONS`.
  - Deploy log, run 37357689984: "env.OPERATIONS (inherited) Queue", "env.DB (visonaut) D1 Database", "env.IMAGES (visonaut-images) R2 Bucket" for `visonaut-compare`.
  - `apps/compare/src/index.ts:4-8`: the handler is `validateRequest(request, await codecsReady)`. It does not read `env`. `rg "env\." apps/compare/src` matches only the probe files.
  - `apps/compare/README.md:18`: "The production Wrangler environment retains the provisioned D1, R2, and OPERATIONS bindings."
- What happens: the Worker that decodes untrusted PNG and WebP bytes can read and write the production database, the image bucket, and the operations queue.
- Impact: there is no functional effect. It is a least-privilege gap in the component with the largest parsing surface. A removed binding does not delete the resource.
- Recommendation: remove the three bindings from `env.production`.

  ```jsonc
  "env": {
    "production": {
      "name": "visonaut-compare",
      "migrations": [ /* keep both tags */ ]
    }
  }
  ```

- Alternatives:
  - Keep the bindings and write the reason in the README, if a planned feature needs them.
- Maintainer decision needed: yes. Is there a planned use for these bindings?

### INFRA-12 · Production also answers on `visonaut.ariakit.workers.dev`

- Kind: security
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/wrangler.jsonc:48`: `"workers_dev": true` inside `env.production`. `deploy.yml:360` asserts `configuration.workers_dev === true`.
  - Deploy log: "https://visonaut.ariakit.workers.dev" and "visonaut.com (custom domain)".
  - `GET https://visonaut.ariakit.workers.dev/health` → 200, production JSON. `GET /` → 200, the full 28,538-byte HTML shell. `GET /api/runs` → 403 `wrong_origin`.
  - `https://visonaut-compare.ariakit.workers.dev/` → 404 `error code: 1042` (correctly closed).
  - No document gives a reason. The key came with commit `bc78b85`, which only made the inherited value explicit.
- What happens: the API rejects the second host name (`apps/web/src/api/index.ts:110-112`). The render path and `/health` do not check the host.
- Impact: there is a second public entry that zone rules (WAF, rate limits, Access) on `visonaut.com` do not cover. It serves a page that cannot work, and it can use CPU. The risk is low because the API checks the origin.
- Recommendation: set `"workers_dev": false` in `env.production` and change the assertion at `deploy.yml:360` and the test fixture. Keep it `true` for preview only if you use that address.
- Alternatives:
  - Keep it, and add the origin check before `render(request)` for production, as preview has at `apps/web/src/server.ts:74-76`.
- Maintainer decision needed: yes. Does anything use the production `workers.dev` address?

### INFRA-13 · The raised CPU and subrequest limits apply to all handlers and to the preview Worker

- Kind: cost
- Severity: low. Confidence: medium. Measured: no. Effort: S
- Evidence:
  - `apps/web/wrangler.jsonc:39-42`: `"cpu_ms": 240000`, `"subrequests": 250000`, at the top level. `limits` is inheritable, so production has the same values. The generated preview config contains the same `limits` block (measured in `dist/server/wrangler.json`).
  - Both values are in the first commit (`43552ce`) and never changed. No document gives a reason for the numbers.
  - Cloudflare: HTTP requests have "5 min (default: 30 seconds)" CPU; queue consumer CPU is 30 seconds by default and "configurable to 5 minutes"; subrequests are "10,000/request (up to 10M)" on the paid plan ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)).
  - `apps/web/src/server.ts:133`: "Frequent cron triggers have a 30-second CPU limit; the queue runs the work."
- What happens: the queue consumer needs a long CPU budget. The same budget (8 times the default) also applies to each HTTP request. The preview Worker serves fixtures and has the same limits.
- Impact: a request that loops can use 240 s of billed CPU, not 30 s. One invocation can make 250,000 subrequests, 25 times the default. I did not measure real CPU or subrequest use.
- Recommendation: read the p99 CPU time and the maximum subrequest count for the queue consumer in the Workers metrics. Then set the values from that data, and give preview the defaults.
- Alternatives:
  - Move the queue consumer and cron to a second Worker with the high limits. The HTTP Worker then keeps the defaults. This also lets you place the two Workers differently.
  - Minimal: move `limits` from the top level into `env.production`, so that preview has the defaults.
- Maintainer decision needed: yes. Which code path needs more than 10,000 subrequests in one invocation?

### INFRA-14 · The environment model (top level is preview, `env.production` is production) has specific risks

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/wrangler.jsonc:3` (`visonaut-preview`) and `:112` (`visonaut`).
  - `apps/web/package.json:11-13`: `"deploy": "pnpm build && wrangler deploy"`, `"db:local": "wrangler d1 migrations apply DB --local --env production"`.
  - `wrangler types` on a copy of the config (scratch `web/worker-configuration.d.ts`) gives `DB?: D1Database`, `OPERATIONS?: Queue`, `GITHUB_CLIENT_ID?: …` on `Env`, and a second interface `Cloudflare.ProductionEnv` where all are required.
  - `apps/web/src/runtime.ts:40-54`: the hand-written `BackendEnv` and `requireBackendBindings` repeat what `Cloudflare.ProductionEnv` already states.
  - `apps/compare/wrangler.jsonc:3` uses a different rule: its top level is `visonaut-compare-local`, which is never deployed.
- What happens and the risks:
  1. Safe default: a command with no environment goes to preview. `pnpm --filter @visonaut/web deploy` deploys preview. This is the good side of the model.
  2. A command for production needs the environment in two different ways: `CLOUDFLARE_ENV=production` at build time for the web app, and `--env production` for D1 and for the validator. `wrangler secret put NAME` with no `--env` puts the secret on preview.
  3. There is no local environment with bindings. `pnpm dev` is always fixture mode. Full-stack local work must use the production environment name, the production database ID as the local name, and the origin `https://visonaut.com`.
  4. Five variables are written two times (`VISONAUT_REPOSITORY`, `GITHUB_REPOSITORY_ID`, `VISONAUT_PROJECT_ID`, `VISONAUT_API_LIMITS`, `VISONAUT_OPERATIONS_BUDGET`) because `vars` is not inheritable.
  5. All bindings are optional in the `Env` type. Each production code path needs a runtime assertion first.
  6. Preview is on `preview.visonaut.com`, a subdomain of production. Both are the same site for `SameSite` cookies, and a subdomain can set a cookie for the parent domain. The preview code is the same code, so the risk is low.
  7. Verified as not a risk: with a build redirect present, `wrangler d1 migrations list DB --local --env production` still reads the source config and lists all 33 migrations (scratch reproduction).
- Impact: an operator must remember which command needs which environment form. The model blocks a normal local backend.
- Recommendation: keep the safe default, and name the environments. Add a `local` (or `development`) environment with local bindings, and replace `BackendEnv` with the generated type.

  ```ts
  // apps/web/src/runtime.ts
  export type BackendEnv = Cloudflare.ProductionEnv;
  ```

- Alternatives:
  - Top level has no deployable name (as the validator does). Both `preview` and `production` are named environments. Each command must then name its target.
  - Split preview into its own small config file (`wrangler.preview.jsonc`). The main file then describes only the real service.
  - Minimal: no structural change. Document the three command forms in `docs/development.md`.
- Maintainer decision needed: yes. Do you want a local environment with real bindings for `pnpm dev`?

### INFRA-15 · The public preview deploys only by manual dispatch and is behind `main`

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `GET https://preview.visonaut.com/` references `/assets/review-D6dKKXbW.css` and `/assets/index-CaJ_2b8I.css`, and `<html lang="en">` has no class.
  - `GET https://visonaut.com/` references `/assets/index-CXm4JU5N.css`, and `<html lang="en" class="[font-synthesis:none]">`. The local build of `f83fef6` produces the same `index-CXm4JU5N.css`.
  - `deploy.yml:263-270`: preview deploys only for `workflow_dispatch` with `action == 'preview-web'`.
- What happens: production has the Inbox interface (#252). The preview fixture site still shows an older interface.
- Impact: the preview is the only public place to see the interface without a login. It does not show the current state, and it does not help with review of a UI pull request.
- Recommendation: deploy preview in the push workflow after the production deploy. The preview Worker has no bindings and no secrets, so the risk is low.
- Alternatives:
  - A preview for each pull request: `wrangler versions upload` for the preview Worker with `preview_urls: true` on that Worker only. This needs a change to the origin check at `apps/web/src/server.ts:74-76`.
  - Remove the hosted preview and use only the local fixture harness.
- Maintainer decision needed: yes. Is the hosted preview still wanted? If yes, must it follow `main`?

### INFRA-16 · Renovate is configured but has opened no pull request; pins are behind, and 8 release-age exclusions are stale

- Kind: dx
- Severity: medium. Confidence: medium. Measured: yes. Effort: S
- Evidence:
  - `renovate.json:1-9` exists (`config:recommended`, `helpers:pinGitHubActionDigests`, `rangeStrategy: pin`).
  - `gh pr list --state all --limit 400`: 233 pull requests; authors are `diegohaz` (222) and `app/ariakito` (11). None is from Renovate. `gh issue list --search "Dependency Dashboard in:title"` returns `[]`.
  - npm registry on 2026-10-05: `wrangler` latest 4.147.0 (pinned 4.136.1); `@cloudflare/vite-plugin` 1.62.5 (pinned 1.57.1); `miniflare` 5.20261001.0-alpha (pinned 5.20260921.0-alpha); `@cloudflare/workers-types` 5.20261005.1 (pinned 5.20260922.1); `@tanstack/react-start` 1.168.60 (pinned 1.168.57).
  - `pnpm-workspace.yaml:13-21`: 8 exact versions in `minimumReleaseAgeExclude`. All 8 were published 13.8 to 14.3 days ago. pnpm's `minimumReleaseAge` default is "1440 (since v11)" minutes ([pnpm settings](https://pnpm.io/settings/dependency-resolution)).
- What happens: no bot updates dependencies or action digests. The maintainer adds a release-age exclusion by hand when a pin is younger than 1 day, and the entry stays.
- Impact: 14 exact pins and 6 action digests change only by hand. The 8 exclusions do nothing now. Assumption: the Renovate app is not installed for this repository. I cannot read the installation list.
- Recommendation: install the Renovate app for the repository, or delete `renovate.json`. If you keep Renovate, give it the same delay as pnpm and remove the exclusions:

  ```json
  { "minimumReleaseAge": "3 days", "internalChecksFilter": "strict" }
  ```

- Alternatives:
  - Minimal: delete the 8 stale lines in `pnpm-workspace.yaml`.
  - Use a scheduled manual update (the `ariakit-general-dependency-update` skill exists for this) and remove `renovate.json`.
- Maintainer decision needed: yes. Is Renovate meant to run on this repository?

### INFRA-17 · Version constants and resource identifiers are repeated by hand, and the compatibility date has 3 values

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:

  | Value                                       | Copies                                                                                                                                                                                                         |
  | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Node `24.18.0`                              | 14 `node-version` lines in 3 workflows; `package.json:34`; `apps/compare/container/package.json:12`; `packages/playwright/package.json:58`; `packages/cli/package.json:47` (as a range); the Docker digest     |
  | pnpm `12.5.1`                               | 13 `version:` lines in 3 workflows; `package.json:36`                                                                                                                                                          |
  | Playwright `1.63.0`                         | 3 manifests; the image tag and digest at `checks.yml:79`                                                                                                                                                       |
  | Setup block (checkout, pnpm, Node, install) | 13 copies in 3 workflows, in 2 different orders                                                                                                                                                                |
  | Compatibility date                          | `2026-09-22` (`apps/web/wrangler.jsonc:5`, `apps/compare/wrangler.jsonc:5`), `2026-09-21` (`wrangler.probe.jsonc:5`), `2026-09-29` (`wrangler.container-probe.jsonc:5`); also a literal in about 20 test files |
  | Cloudflare account ID                       | `deploy.yml:151`, `:184`, `:279`; `deploy-comparison-retirement.mjs:19`; `wrangler.container-probe.jsonc:12`; and the GitHub variable at `deploy.yml:60`                                                       |
  | D1 database ID                              | `apps/web/wrangler.jsonc:71`; `apps/compare/wrangler.jsonc:42`; `deploy.yml:202`, `:346`                                                                                                                       |
  - The installed runtime (`workerd` 1.20260921.1) accepts dates up to `2026-09-28`. A Miniflare instance with `2026-09-29` fails: "This Worker requires compatibility date "2026-09-29", but the newest date supported by this server binary is "2026-09-28"." (`compat.mjs`).
  - `renovate.json:7` groups only the npm names `@playwright/test` and `playwright`. The container image has another name, so the two can go out of step.

- What happens: one version change needs edits in many files. The `deploy` job reads the account from a variable; the two manual jobs use a literal.
- Impact: a partial edit breaks CI or gives two different runtimes. The container probe config cannot start in direct Miniflare with the pinned runtime. I did not test `wrangler dev` with that config.
- Recommendation:
  - One composite action for setup (`.github/actions/setup/action.yml`) that reads Node from `package.json` (`node-version-file: package.json`) and pnpm from `packageManager`.
  - One compatibility date. Tests can read it from the config with `unstable_readConfig`, as `apps/web/src/server.test.ts:30-32` already does for `vars`.
  - One source for the account ID: either the variable or the literal.
- Alternatives:
  - Minimal: set `wrangler.container-probe.jsonc` to `2026-09-22`, and add the image name to the Renovate group.
- Maintainer decision needed: no.

### INFRA-18 · 20 TypeScript files are in no checked project, and the tsconfig files differ

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `package.json:8`: `"typecheck": "pnpm -r --if-present typecheck"`. The root itself has no project.
  - Files outside each `include`: `apps/web/tooling/**` (7 files; `apps/web/tsconfig.json:4` includes only `src`), `apps/compare/test/**` and `apps/compare/container/*.ts` (7 files; `apps/compare/tsconfig.json:13`), `packages/protocol/test/**` (2 files; `packages/protocol/tsconfig.json:12`), root `tooling/*.ts` (4 files), and `vitest.config.ts`. `tsc6 -p apps/compare/tsconfig.json --listFilesOnly` confirms that no test or container file is listed.
  - `apps/compare/package.json:12` has `typecheck:container`. No workflow runs it.
  - `apps/web/src/api/tsconfig.json` and `apps/web/tooling/baseline-reset/tsconfig.json` are used by no script. An editor uses the nearest file, so the 38 files in `src/api` have other types in the editor (`@cloudflare/workers-types`) than in CI (generated runtime types).
  - 5 of 8 package projects do not extend the root file. Targets are `ES2022` (security), `ES2023` (root, protocol), and `ES2024` (cli, compare, compare worker). `verbatimModuleSyntax` is only in the root file and in `packages/cli/tsconfig.json`.
  - Workspace packages export source (`"exports": { ".": "./src/index.ts" }`), so each consumer checks the same file again with its own options. `packages/service/src` is checked in 3 projects.
- What happens: the imported part of the unlisted files is checked through imports. Test files and tooling entry files are not.
- Impact: a type error in these files does not fail CI. A file can pass in one project and fail in another.
- Recommendation: one base file that all projects extend, and add the missing folders to `include`. Add `typecheck:container` to the `typecheck` script of the compare worker. Delete the two unused tsconfig files, or add scripts that run them.
- Alternatives:
  - Minimal: add `"test"` and `"tooling"` to the three `include` lists.
- Maintainer decision needed: no.

### INFRA-19 · No version drift between workspaces, but some workspaces use dependencies that only the root declares

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `deps.mjs`: 44 distinct dependencies in 10 manifests. 17 are in more than one manifest. **None has two versions.** All ranges are exact, `workspace:*`, or an exact npm alias. The 17 shared ones are: `@cloudflare/workers-types` 5.20260922.1, `@jsquash/png` 3.1.1, `@jsquash/webp` 1.5.0, `@playwright/test` 1.63.0, `@types/node` 24.13.6, `@types/pngjs` 6.0.5, `@visonaut/compare`, `@visonaut/protocol`, `@visonaut/service`, `better-auth` 1.7.5, `jose` 6.2.12, `miniflare` 5.20260921.0-alpha, `pngjs` 7.0.0, `tsup` 8.5.1, `typescript` (alias to `@typescript/typescript6@6.0.2`), `vitest` 5.0.1, `wrangler` 4.136.1.
  - `undeclared.mjs`: `apps/web` imports `vitest` (50 files) and `@playwright/test` (6 files) and declares neither. `packages/service` and `packages/compare` have no `devDependencies` and use `vitest`, `tsc6`, and `@types/node` from the root. `packages/compare/scripts/browser-study.ts` and `packages/cli/test/local-comparison.test.ts` use `@playwright/test`.
  - The shared Ariakit rule (`ariakit-general-workflow`, Dependencies): "Each workspace must declare every dependency it uses in its own `package.json`. Do not rely on root hoisting."
  - Lockfile (`lock.mjs`): 496 resolved packages; 49 names have two or more resolved versions, all transitive (for example `esbuild` 0.27.7 and 0.28.1, `lightningcss` 1.32.0 and 1.33.0, `pngjs` 6.0.0 and 7.0.0).
  - Engines differ between the two public packages: `packages/playwright/package.json:58` is exactly `24.18.0`; `packages/cli/package.json:47` is `>=24.18.0 <25`.
- What happens: the commands work because pnpm puts the root `node_modules/.bin` on the path and Node resolves upward.
- Impact: a workspace cannot be installed or filtered alone. The exact engine value on the adapter warns a consumer on Node 24.19.
- Recommendation: add the missing `devDependencies` to `apps/web`, `packages/service`, `packages/compare`, and `packages/cli`. Decide on one engine form for the public packages.
- Alternatives:
  - State in `docs/development.md` that test tools come from the root, as an explicit exception to the shared rule.
- Maintainer decision needed: yes. Must the adapter require exactly Node 24.18.0?

### INFRA-20 · Deploy guards are inline JavaScript in YAML, and tests cut them out with a regular expression

- Kind: simplification
- Severity: low. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `deploy.yml:179-191`, `:193-204`, `:309-370`, `:252-258`: four `node --input-type=module <<'JS'` blocks.
  - `.github/workflows/scripts/deploy-web-target.test.mjs:17-34`: the test reads `deploy.yml`, matches `/- name: Check the exact web target before loading secrets[\s\S]*?<<'JS'\n([\s\S]*?)\n          JS/`, removes the `import` lines, and compiles the rest with `compileFunction`.
  - `.github/workflows/scripts/deploy-migrations.test.mjs:39-42` does the same with `new Function`.
  - The guard at `deploy.yml:324-366` repeats the production values of `apps/web/wrangler.jsonc` (queue settings, bucket names, database ID, routes, cron).
- What happens: a rename of a step, or a change of indentation, breaks the tests. A config change needs the same edit in the config, in the YAML guard, and sometimes in the test.
- Impact: the strongest guard is hard to change, and it runs only on manual actions (INFRA-09).
- Recommendation: move each block to a `.mjs` file with an exported function, as `deploy-infrastructure.mjs` already does. The workflow calls the file. The test imports the function. Run the same config guard in the push path.
- Alternatives:
  - Delete `production-fence` and its guard if the cutover use is over (the file `apps/web/src/cutover-fence.ts:1` says "Temporary entrypoint").
- Maintainer decision needed: yes. Are the `production-fence` action and the manual `migrate` action still needed?

### INFRA-21 · Logs and traces use defaults only; there is no export and no alert from outside the service

- Kind: dx
- Severity: low. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `apps/web/wrangler.jsonc:15-20`: `observability.enabled` and `traces.enabled`. No `logpush`, no `tail_consumers`, no sampling.
  - Cloudflare: Workers Logs keep "7 Days" on the paid plan; "20 million included per month" and "$0.60 per additional million"; export options are "OpenTelemetry export (recommended), Workers Logpush, or Tail Workers" ([Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)).
  - Failures go to the D1 table `operations_events` and show in the app (`apps/web/src/runtime.ts:467-479`). The dead-letter queue has no consumer (`apps/web/wrangler.jsonc:105`).
  - `/health` is static (`apps/web/src/server.ts:60-71`). It does not read D1.
- What happens: all alerts are inside the service that they describe.
- Impact: if the Worker cannot start, or D1 is not available, nothing tells the maintainer. Logs older than 7 days are gone. A message in the dead-letter queue is not seen; the cron sends a new recovery message each 5 minutes, so no work is lost.
- Recommendation: use what is already there first. Open the trace for a slow `/api/runs` request to answer the latency question. Then add one outside signal: a scheduled GitHub workflow that requests `/health` and fails, or a Cloudflare notification for the Worker error rate.
- Alternatives:
  - A Tail Worker that sends error events to a webhook.
  - Logpush to an R2 bucket for longer retention.
  - No change. Accept 7 days and in-app alerts.
- Maintainer decision needed: yes. Do you need alerts outside the app, or logs older than 7 days?

### INFRA-22 · Several names no longer match what the thing does

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `apps/compare/src/index.ts:6` only validates images. Its names say "compare": directory `apps/compare`, package `@visonaut/compare-worker`, Worker `visonaut-compare`, binding `COMPARATOR` (`apps/web/wrangler.jsonc:87`), README title "Comparison Worker".
  - Three things share one stem: `apps/compare` (Worker), `packages/compare` (library `@visonaut/compare`), and the retired comparison queues.
  - Storage names lost the environment part in #251 (`visonaut`, `visonaut-images`, `visonaut-quarantine`). The queues kept it (`visonaut-production-operations`, `visonaut-production-dead-letter`, `apps/web/wrangler.jsonc:95-105`).
  - The npm package `visonaut` is the CLI. The Worker `visonaut` is the web service.
  - Routes differ in form: preview has `zone_name` (`apps/web/wrangler.jsonc:9-13`), production does not (`:49`).
  - Both `/v1/webhooks` and `/webhooks/github` are routed (`apps/web/src/api/index.ts:126`). The README names only `/v1/webhooks`.
- What happens: a reader must learn that "compare" means "validate".
- Impact: confusion only. A rename of a Worker or a queue is a resource migration, not a text change.
- Recommendation: rename in code first where it is free (binding `COMPARATOR` to `VALIDATOR`, README title, package name). Leave deployed resource names until another migration touches them.
- Alternatives:
  - No renames. Add one line to each README that states the current role.
- Maintainer decision needed: yes. Is a Worker rename worth a new service binding and a new deploy order?

### INFRA-23 · Small configuration items

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence and what happens:
  1. `.changeset/config.json:2` points to the schema of `@changesets/config@3.1.1`. The installed version is 4.0.1 (`lock.mjs`).
  2. `apps/compare/container/Dockerfile:1` is `FROM docker.io/library/node@sha256:d45d78e7…` with no tag. A Docker Hub lookup shows that this digest is the `linux/amd64` image of `node:24.18.0-bookworm-slim`. A reader cannot see that. Renovate keeps the tag "for readability" ([Renovate Docker](https://docs.renovatebot.com/docker/)).
  3. `.infisical.json:2-3` points to workspace `fb5ba4be-…` with `defaultEnvironment: "dev"`. The deploy uses project `2e3bd11a-…` (`deploy-scope.mjs:10`). `docs/current-contract.md:165` says "Keep Infisical only for deploy credentials". No document says what the `dev` project is for.
  4. `lefthook.yml:1` sets `glob_matcher: doublestar`, but no job uses a glob.
  5. `package.json:13`: `pnpm check` does not run `test:release-guards` or `check:packages`. CI runs both.
  6. Each production build prints "Missing required secrets: BETTER_AUTH_SECRET, CAPABILITY_SECRET, …" (deploy log, build step). The secrets are not needed at build time.
  7. `apps/compare/wrangler.jsonc:13-15` sets `cpu_ms: 30000`, which is the default.
  8. `apps/web/wrangler.jsonc:61` holds a JSON object as an escaped string. Wrangler `vars` can hold an object. `VISONAUT_API_LIMITS` and `VISONAUT_OPERATIONS_BUDGET` are `"{}"` in both environments.
  9. Both deployment tokens are exported to the job environment (`deploy.yml:100`, `:114`). All later steps can read both. Only the migration step needs the second one.
  10. `checks.yml:150-153`: the Gate job installs Node only to run 10 lines of script (6 s of its 10 s).
  11. The package `test` scripts run `vitest run` in the package folder. The root config (`vitest.config.ts:8`, 15 s timeout and the browser-test exclusion) applies only when Vitest starts at the root. Assumption from Vitest config lookup; not run.
- Impact: small, one by one. Together they add reading time and doubt.
- Recommendation: fix items 1, 2, 4, 5, 7, and 10 directly. For item 2: `FROM docker.io/library/node:24.18.0-bookworm-slim@sha256:d45d78e7…`.
- Alternatives: none needed.
- Maintainer decision needed: yes, for item 3 only. Is the Infisical `dev` project still in use?

## Measurements (command, raw result, limits)

All commands ran on 2026-10-05 between 19:30 and 19:50 UTC. Network timings use a new TLS connection for each request (about 0.055 s of each value is the handshake). They are from one location and are not a performance budget.

### M1. Production response headers and timing

Command: `curl -sS -o /dev/null -D - -w 'ttfb=%{time_starttransfer} …' <url>`, and `ttfb.sh <url> 6` for samples.

| URL                                              | Status | Samples | Min (s) | Median (s) | Max (s) |
| ------------------------------------------------ | ------ | ------- | ------- | ---------- | ------- |
| `https://visonaut.com/health`                    | 200    | 6       | 0.078   | 0.133      | 0.248   |
| `https://visonaut.com/` (shell, 28,538 bytes)    | 200    | 6       | 0.109   | 0.146      | 1.280   |
| `https://visonaut.com/api/me` (no cookie)        | 401    | 12      | 0.367   | 0.442      | 1.756   |
| `https://visonaut.com/api/runs` (no cookie)      | 401    | 6       | 0.413   | 0.474      | 0.517   |
| `https://visonaut.com/assets/index-CXm4JU5N.css` | 200    | 6       | 0.088   | 0.094      | 0.217   |
| `https://visonaut.ariakit.workers.dev/health`    | 200    | 6       | 0.081   | 0.097      | 0.186   |
| `https://visonaut.ariakit.workers.dev/api/me`    | 403    | 6       | 0.077   | 0.131      | 0.423   |
| `https://visonaut.ariakit.workers.dev/api/runs`  | 403    | 6       | 0.082   | 0.151      | 1.048   |

Raw headers:

```
GET https://visonaut.com/                 cache-control: no-store, private   (no cf-placement header)
GET https://visonaut.com/assets/index-CXm4JU5N.css
  content-type: text/css
  cf-cache-status: HIT
  cache-control: public, max-age=0, must-revalidate
  etag: W/"9e4cfd6955347432dd08ee4c96daa415"
  content-encoding: br            size_download=43813
GET https://visonaut.com/assets/index-MxeSnhFR.js   same cache-control   size_download=102706
GET (If-None-Match) …/index-CXm4JU5N.css  HTTP/2 304  ttfb=0.094485
GET https://visonaut.com/assets/runs._runId-OLDHASH0.js
  HTTP/2 404  content-type: text/html; charset=utf-8  size=2414  ttfb=1.447610
GET https://visonaut-compare.ariakit.workers.dev/   HTTP/2 404  error code: 1042
GET https://visonaut-preview.ariakit.workers.dev/   HTTP/2 403
```

Limits: no signed-in request was measured. The outliers above 1 s are not explained.

### M2. Access-check probe (local)

Command: `node node_modules/vitest/vitest.mjs run --root …/authprobe --config …/authprobe/vitest.config.ts`. The test imports `createAuth` and `requireMaintainer` from `packages/security/src`, uses Miniflare D1 with all 33 migrations, and wraps the binding to record each statement.

```
unused instance (created, never called): sqlite_master select, BATCH(75)
no session:                              sqlite_master select, BATCH(75)
valid session, cold permission cache:    sqlite_master select, BATCH(75), session select, user select,
                                         account select; GitHub: /user/42, /repos/…/collaborators/…/permission
valid session, warm permission cache:    same 5 D1 calls; GitHub: none
one reused instance, second call:        no D1 call
unwrapped binding, no session:           new instance each call median 433.5 ms; reused instance median 0.0 ms
tables and views in the schema:          76
validateSchema: false, no session:       no D1 call (44.9 ms)
validateSchema: false, valid session:    session select, user select (session found)
```

Limits: local times include the Miniflare proxy and are not production times. The GitHub client is a stub.

### M3. Build output (existing `apps/web/dist`, preview build of `f83fef6`)

Command: `node sizes.mjs apps/web/dist/client` and `… dist/server`.

```
client: 16 files, 1,250,721 bytes raw, 308,708 gzip -9, 251,940 brotli 11
  assets/index-CXm4JU5N.css   464,666 raw   59,500 gzip   32,868 brotli
  assets/index-MxeSnhFR.js    319,611 raw  101,143 gzip
  assets/app-shell-*.js       139,641 raw   40,104 gzip
  assets/runs._runId-*.js     137,841 raw   43,996 gzip
server: 37 files, 4,621,437 bytes raw, 958,746 gzip (not minified; index.js 2,098,892 bytes)
```

Deploy log, run 37357689984: web "Total Upload: 4007.84 KiB / gzip: 856.53 KiB", "Worker Startup Time: 47 ms"; validator "Total Upload: 397.24 KiB / gzip: 152.42 KiB", "Worker Startup Time: 12 ms". Start-up time is not a problem.

### M4. CI and deploy history

Command: `gh run list --repo ariakit/visonaut …` and `gh run view <id> --json jobs`.

```
Deploy (push): 78 runs; success 67, failure 9, cancelled 2; success seconds: min 46, median 257, p90 352, max 451
CI (last 200): success 195, failure 4, cancelled 1; success seconds: median 221, p90 288
CI 2026-10-01..02: 84 runs, median 210 s      CI since 2026-10-04: 11 runs, median 294 s (249..316)
CI runs on changeset-release/main: 33 of 200
Run 37357689984 (Deploy): verify / Test 2/3 366 s; Gate 10 s; deploy 50 s; total 433 s
Run 37357042248 (CI): Typecheck 35, Lint 27, Build 33, Release guards 23, Test 218/268/140, Browser 222, Gate 10
```

Commit scope, `git log -n 120 --name-only origin/main | node commit-scope.mjs`:

```
commits analysed: 120
docs/markdown/evidence only: 7
version files only (CHANGELOG, package.json, .changeset): 12
no deployable runtime file changed: 43
comparator source or config changed: 8
```

Limits: the "deployable" path list is my own filter. Job durations include queue time inside a job, not before it.

### M5. Tooling checks

```
node deps.mjs        -> drift count: 0 of 17 shared deps; total distinct deps: 44
node undeclared.mjs  -> apps/web: UNDECLARED vitest (50 files), @playwright/test (6 files)
                        packages/service: UNDECLARED vitest; packages/compare: UNDECLARED vitest, @playwright/test
node lock.mjs        -> resolved packages: 496; names with more than one resolved version: 49
                        workerd 1.20260921.1; @changesets/config 4.0.1; wrangler 4.136.1
node compat.mjs      -> 2026-09-21 ok; 2026-09-22 ok; 2026-09-29 fails (newest supported "2026-09-28")
node release-age.mjs -> all 8 excluded versions published 2026-09-21 or 2026-09-22 (13.8 to 14.3 days)
wrangler types (copy of the web config) -> Env has DB?: D1Database …; Cloudflare.ProductionEnv has DB: D1Database …
wrangler d1 migrations list DB --local --env production (scratch copy with a preview build redirect)
                     -> lists 0001_service.sql … (33 files); the redirect is not used
gh pr list --state all --limit 400 -> 233 pull requests; authors diegohaz 222, app/ariakito 11
Docker Hub tag lookup -> digest d45d78e7… is in the images of node:24.18.0-slim and node:24.18.0-bookworm-slim
```

## Open questions and items not verified

1. **D1 region and replication mode.** Not read, because remote Wrangler commands are outside this audit. `pnpm exec wrangler d1 info visonaut` shows both. INFRA-02 depends on it.
2. **Cause split of the 0.29 s.** The production difference between the 401 path and the 403 path is measured. That the schema check is the only D1 work on that path is measured locally. The exact production time of each D1 call is not measured. One trace of `/api/me` in the dashboard gives it.
3. **Signed-in page load.** I measured no signed-in request. The number of API calls and their order on each page are for the service and UI lanes.
4. **Real CPU and subrequest use** of the queue consumer (INFRA-13). Read it in the Workers metrics.
5. **Renovate app installation** (INFRA-16). Inferred from zero pull requests and no dashboard issue.
6. **State of the old queues.** `docs/simplification-implementation.md:173` lists eight queues. I did not read the account, so I do not know which of the preview queues and comparison queues still exist.
7. **Outliers above 1 s** on `/`, `/api/me`, and the missing-asset request. Start-up time is 47 ms, so the cause is something else. Not investigated.
8. **`wrangler dev` with the container probe config** (compatibility date `2026-09-29`). Only direct Miniflare was tested.
9. **Why production keeps `workers_dev: true`** (INFRA-12). No document states a reason.
10. **`apps/lab`** is a new, untracked directory from another task in this run. It is not part of this audit.
