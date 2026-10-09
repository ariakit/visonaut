# Pull request page and service status (operations attention)

Lane key: `ui-pull-ops`. Finding prefix: `PULL`. Audit date: 2026-10-05. Read-only audit.

Scope:

- `apps/web/src/routes/pulls.$pullNumber.tsx` and its data source, the `GET /api/pulls/:number` handler in `apps/web/src/api/review.ts`.
- `apps/web/src/components/operations-attention/index.tsx` in the two layouts (header popover, and the page at `/?view=service`), and `apps/web/src/api/operations.ts`.

A note about the task text: it names `apps/web/src/api/lineage.ts` as the data source of the pull request page. That file verifies commit lineage for ingest. It does not serve the page. The page reads `GET /api/pulls/:number`, which is in `apps/web/src/api/review.ts:735-784`.

Short names used below:

- `pulls.$pullNumber.tsx` is `apps/web/src/routes/pulls.$pullNumber.tsx`.
- `routes/index.tsx` is `apps/web/src/routes/index.tsx` (the dashboard).
- `operations-attention/index.tsx` is `apps/web/src/components/operations-attention/index.tsx`.
- `review.ts` is `apps/web/src/api/review.ts`.
- Other paths are relative to the repository root unless they start with `/`.

Scratch files (scripts, raw output, screenshots) are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-pull-ops/`.

## How it works (map)

### A. Pull request page

Entry point. GitHub check runs point their "Details" link to this page:

- `apps/web/src/api/pre-run-checks.ts:508-514` sets `details_url` to `/pulls/<number>?check=<external id>` for pull request checks.
- `apps/web/src/operations/review-links.ts:63-67` builds the same URL for the mirror check "Open Visonaut review".

So this page is the first screen for almost every reviewer who comes from GitHub.

Request walk-through for a ready review:

1. Browser: `GET /pulls/7?check=visonaut:pre:<sha>`. The Worker renders the route on the server (`apps/web/src/server.ts:118`). The route has no loader, so the HTML always contains the loading state: "Finding this pull request's visual review…" (`pulls.$pullNumber.tsx:179-183`). Measured: the SSR HTML contains that text and the static title `Visonaut`.
2. Browser loads CSS and JS and hydrates. Sizes from the existing `apps/web/dist` build (gzip): `index` 101.3 KB, `app-shell` 40.2 KB, `react` 11.6 KB, `pulls._pullNumber` 2.4 KB, CSS 60.1 KB.
3. After hydration, an effect calls `GET /api/pulls/7?check=…` (`pulls.$pullNumber.tsx:47-58`).
4. Worker, `handleApi` (`apps/web/src/api/index.ts`):
   1. `assertConfiguredProject` (`apps/web/src/api/index.ts:123-126`): 1 D1 query (`SELECT * FROM visonaut_projects WHERE id = ?`, `packages/service/src/service.ts:104-106`).
   2. `createAuth` and `createGitHubClient` (`apps/web/src/api/index.ts:130`, `:191`).
   3. `requireMaintainer` (`packages/security/src/authorization.ts:32-83`): a live session lookup with the cookie cache off (at least 1 D1 query), 1 D1 query for the linked account, then the permission cache. On a cache miss: GitHub `GET /repos/<repo>/collaborators/<login>/permission`. On a cold isolate also `GET /user/<id>` and a new installation token (`packages/security/src/github.ts:134-158`, `:251-261`). That is 0 to 3 GitHub round trips, one after the other.
   4. `handleReview` (`review.ts:742-772`): 1 D1 query on `pre_run_checks`, then 1 D1 query on `visonaut_runs`.
5. The handler returns `{ repository, pullNumber, runId, state }` (`review.ts:778-783`). `state` is `ready`, `pending`, `failed`, or `not-required`.
6. If `runId` is a string, the client calls `navigate({ to: "/runs/$runId", replace: true })` (`pulls.$pullNumber.tsx:80-84`).
7. The router loads the run route chunk (`runs._runId` 43.9 KB gzip, plus `badge.ariakit.react` 19.4 KB gzip). Then the run loader calls `GET /api/runs/<id>` (`apps/web/src/routes/runs.$runId.tsx:37-47`). The Worker repeats steps 4.1 to 4.3 and builds the review model.

Other states of the page (`PageState`, `pulls.$pullNumber.tsx:30-37`):

| State                      | Trigger                                                   | What the user sees                                                                                                                       |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`                  | Before the first answer                                   | Icon, eyebrow, "Finding this pull request's visual review…"                                                                              |
| `guest`                    | HTTP 401                                                  | "Sign in to review pull request #7", one paragraph, "Sign in with GitHub"                                                                |
| `forbidden`                | HTTP 403                                                  | "Repository access required", "Use another account"                                                                                      |
| `error`                    | HTTP 404, any other failure, a failed sign-in or sign-out | "Review unavailable", message, "Retry"                                                                                                   |
| `pending` + `pending`      | No sealed run yet                                         | "Waiting for screenshots.", "Check again", "Open on GitHub". Polls every 15 s while the tab is visible (`pulls.$pullNumber.tsx:105-119`) |
| `pending` + `failed`       | Check or run failed                                       | Yellow block "Visual capture failed.", "Check again", "Open on GitHub"                                                                   |
| `pending` + `not-required` | Docs-only pull request                                    | "No visual review needed.", "Open on GitHub"                                                                                             |

The header on this page is `AppHeader` with no `end` slot (`pulls.$pullNumber.tsx:152`). It has no account menu and no service bell.

### B. Service status page (`/?view=service`)

The page is not a route. It is a branch of the dashboard component (`routes/index.tsx:363-364`).

1. Browser: `GET /?view=service`. SSR renders "Checking access and loading runs…" (measured in the SSR HTML).
2. After hydration: `GET /api/runs` (`routes/index.tsx:176-210`). This is the full dashboard query: two run lists and the project row (`apps/web/src/api/dashboard.ts:68-81`).
3. Only when `/api/runs` succeeds, the page mounts `<OperationsAttention layout="page" />` (`routes/index.tsx:356-364`).
4. The component calls `GET /api/operations` (`operations-attention/index.tsx:233-237`) and then again every 60 s (`operations-attention/index.tsx:280`).
5. Worker for `/api/operations`: the same access path as A.4.1 to A.4.3, then `operationsStatus` (`apps/web/src/api/operations.ts`): 1 query for the project guard (`:16-18`), 1 query for the events (`:30-36`, `LIMIT 51`), 1 query for the capacity cursor (`:45-47`). The three queries run one after the other.

### C. Header popover ("Service attention")

- Mounted only on the queue and history views, only when the run list is ready, and never in preview: `state.status === "ready" && !state.preview && view !== "service"` (`routes/index.tsx:254-256`).
- Not mounted on the run page (`apps/web/src/routes/runs.$runId.tsx:206-213` passes only `UserMenu`) or on the pull request page.
- Same component, `layout="popover"` (the default). The trigger is a bell button with a count badge (`operations-attention/index.tsx:480-507`).
- The same polling runs while the popover is closed. A hidden live region announces changes (`operations-attention/index.tsx:473-475`).

### D. Alert content

- The server sends `kind`, `code`, `subject`, `firstSeenAt`, `lastSeenAt` for each unresolved row of `operations_events`.
- The client maps `kind` and `code` to a title and a recovery paragraph in `recovery()` (`operations-attention/index.tsx:98-199`).
- "Technical details" is a native `<details>` element with kind, code, subject, and two absolute times (`operations-attention/index.tsx:413-422`).
- One button links to `https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md` (`operations-attention/index.tsx:452-462`).

### E. How the surfaces connect today

- GitHub to pull page: the check "Details" link. Pull page to run page: automatic client redirect with `replace: true`, so the browser Back button returns to GitHub.
- Pull page to queue: a "Review queue" button above the card and the header link. Queue to pull page: no link. Run page to pull page: no link.
- Queue "In progress" rows link to the run page ("Open run"). The pull page shows "Waiting for screenshots" for the same run and has no link to it, because the API returns `runId` only for a sealed run (`review.ts:781`).
- Service alerts do not link to runs, checks, or GitHub. The run page and the pull page show no service signal.

## Findings

### PULL-01 · The pull request page is a client-side redirect hop in front of every review

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `pulls.$pullNumber.tsx:47-58`: the lookup starts in a `useEffect`, after hydration.
    ```ts
    const response = await fetch(
      `/api/pulls/${encodeURIComponent(pullNumber)}?check=${encodeURIComponent(check ?? "")}`,
    ```
  - `pulls.$pullNumber.tsx:80-84`: `await navigate({ to: "/runs/$runId", params: { runId }, replace: true });`
  - `review.ts:742-772`: two D1 queries, one after the other, for one answer.
  - `apps/web/src/api/pre-run-checks.ts:508-514`: this URL is the `details_url` of the GitHub check.
  - Measurement M1. With 300 ms added to each API response: pull URL to visible workspace 1341 ms, direct run URL 854 ms. Request order: `/pulls/7`, then `/api/pulls/7`, then `/api/runs/<id>`.
  - Measurement M2: the run chunk (43.9 KB gzip) and `badge.ariakit.react` (19.4 KB gzip) are requested only after `/api/pulls` answers.
- What happens: A reviewer clicks "Details" on GitHub. The Worker renders a page that cannot contain the answer. The browser downloads the app, hydrates, and asks `/api/pulls`. The Worker does a full access check. The client then navigates to the run route, downloads the run chunk, and asks `/api/runs/<id>`. The Worker does the access check again.
- Impact: One extra sequential API round trip (at least 4 D1 queries plus 0 to 3 GitHub requests, counted from code) and one throwaway screen before every review that starts from GitHub. The run chunk and the review model cannot start loading in parallel with the lookup. This is the main path of the "wait around checking access" complaint in this lane.
- Recommendation: Resolve the check on the server in the same request that serves the document, and redirect when the run is ready. The lookup needs only D1, and the session cookie is on the document request. Sketch:
  ```ts
  // routes/pulls.$pullNumber.tsx (sketch)
  export const Route = createFileRoute("/pulls/$pullNumber")({
    validateSearch,
    loaderDeps: ({ search }) => ({ check: search.check }),
    loader: async ({ params, deps }) => {
      const result = await resolvePullCheck({ data: { ...params, ...deps } }); // server function
      if (result.status === "ready") {
        throw redirect({ to: "/runs/$runId", params: { runId: result.runId }, replace: true });
      }
      return result; // guest | forbidden | pending | failed | not-required | not-found
    },
  });
  ```
  The server function can call the same code as `handleReview`. It must keep the access rules of `requireMaintainer`.
- Alternatives:
  - Minimal: keep the client flow, preload the run route chunk while `/api/pulls` is in flight, and merge the two D1 queries into one `LEFT JOIN`. This saves the chunk wait and one D1 round trip, not the API hop.
  - Let the run loader accept the check: `GET /api/runs/by-check?pull=7&check=…` returns the review model, or a small "not ready" object. The pull route then renders the run route component. One API round trip instead of two.
  - Let the Worker answer `/pulls/:n` with an HTTP 302 when the session and the run are valid, before React renders. Fastest for the ready case. The not-ready states still need a page.
- Maintainer decision needed: yes. Is a server-side lookup with the session cookie on a document request acceptable under the access contract (`docs/current-contract.md:186`), or must private reads stay behind `fetch` calls to `/api/*`?

### PULL-02 · The service status page waits for the run list, and it disappears when the run list fails

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `routes/index.tsx:356-364`:
    ```tsx
    {state.status === "ready" && (
      <>
        …
        {view === "service" ? (
          <OperationsAttention onAccessDenied={onAccessDenied} layout="page" />
    ```
  - `routes/index.tsx:321-355`: any `/api/runs` failure renders "The review queue could not be loaded", also on `/?view=service`.
  - `routes/index.tsx:275-279`: the loading text on the service page is "Checking access and loading runs…".
  - Measurement M3: with 300 ms added to each API response, `/api/runs` starts at 308 ms, `/api/operations` starts at 632 ms (after `/api/runs` ends), alert list visible at 1338 ms.
  - Screenshot `screens/svc-12-run-list-failed-hides-status--desktop-dark.png`: `/?view=service` with a failing `/api/runs` shows only "The review queue could not be loaded".
- What happens: The service page needs nothing from the run list except the repository name for the header and the `preview` flag. It still waits for the complete dashboard query. If that query fails, the page shows a queue error and never asks for alerts.
- Impact: The page that explains service problems is unavailable when the run list has a problem. In the normal case it pays two sequential API round trips and two access checks.
- Recommendation: Give the service view its own route and its own data. Load alerts without the run list. Sketch:
  ```tsx
  // routes/status.tsx (sketch)
  export const Route = createFileRoute("/status")({ component: ServiceStatus });
  function ServiceStatus() {
    const operations = useOperationsStatus(); // fetch and poll, no dependency on /api/runs
    return <StatusPage operations={operations} />;
  }
  ```
  Let `/api/operations` return `repository` and `preview` if the header needs them.
- Alternatives:
  - Minimal: in the dashboard component, start both requests at the same time when `view === "service"`, and render the service panel also when `/api/runs` failed.
  - Add an alert summary (count, highest severity) to the `/api/runs` response, so that the header badge needs no second request. Keep `/api/operations` for the full list.
- Maintainer decision needed: yes. Should service status be a route of its own (for example `/status`) with data that does not depend on the run list?

### PULL-03 · Header links to "Service status" reload the document and fetch everything again

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/components/app-shell.tsx:52-64`: the header uses `<NavLink href={href}>`, a plain anchor, not the router `Link`.
  - Measurement M4. Click on header "Service status" from the queue: `document /?view=service`, then `/api/runs`, then `/api/operations`. Click on the in-page router link "View history": no request.
  - `routes/index.tsx:254-256`: the bell on the queue already holds the alert data before the click.
- What happens: The queue page loads the alerts for the bell. A click on "Service status" drops the page, renders the document again, hydrates, loads the run list again, and loads the alerts again.
- Impact: The slowest possible path to data that the browser already has. Each header click costs a document render plus two API round trips with two access checks.
- Recommendation: Render the header links through the router (`<NavLink render={<Link to="/" search={{ view: "service" }} />}>`), and keep the alert state above the view switch so that the page layout can reuse it.
- Alternatives:
  - Minimal: only replace the anchors with router links. The run list state then survives, because the three views share one component.
  - Move queue, history, and service to separate routes with a shared layout route that owns the header data.
- Maintainer decision needed: no.

### PULL-04 · The alert poll never pauses, misses the permission cache on idle tabs, and scans the whole event table

- Kind: cost
- Severity: medium. Confidence: medium. Measured: yes (hidden-tab polling and the query plan; the cache miss is from code). Effort: S
- Evidence:
  - `operations-attention/index.tsx:277-282`: the next poll is scheduled without a visibility check.
    ```ts
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        timeout = setTimeout(load, 60000);
    ```
  - Measurement M5: with `document.visibilityState` set to `hidden`, 5 more requests in 5 minutes.
  - `packages/security/src/authorization.ts:21` and `:63`: `const privateReadLifetime = 60_000;` and `cached.checkedAt + lifetime > Date.now()`. The next poll starts 60 000 ms after the previous response ended, so it is always later than `checkedAt + 60 000`. A cache hit does not renew `checkedAt` (`:64-70`).
  - `apps/web/src/api/operations.ts:16-18`, `:30-36`, `:45-47`: three `await database.prepare(...)` calls in sequence. `apps/web/src/api/index.ts:123-126` already loaded and checked the same project row.
  - Measurement M6 (query plan on a scratch database built from the migrations): `SCAN operations_events` and `USE TEMP B-TREE FOR ORDER BY`. The table has only its primary key index.
  - No code deletes rows from `operations_events` (search for `DELETE FROM operations_events` in `apps/web/src` and `packages`: no result). Resolved rows stay.
- What happens: Each open dashboard tab asks for alerts every 60 s, also in the background. On a tab with no other traffic, each poll runs the GitHub permission request again. Each poll runs at least 6 D1 queries (project, session, account, project again, events, capacity). The events query reads every row of the table, resolved or not.
- Impact: Background cost for each open tab per day: 1440 Worker requests, up to 1440 GitHub permission requests (from code), and at least 8640 D1 queries. D1 bills rows read, and the events query reads the full table on each poll, so the cost grows with the age of the deployment, not with the number of open alerts. The row count in production was not measured.
- Recommendation:
  - Pause the poll when the tab is hidden and refresh when it becomes visible. The pull request page already does this (`pulls.$pullNumber.tsx:105-119`).
  - Add a partial index, for example:
    ```sql
    CREATE INDEX operations_events_open
      ON operations_events(last_seen_at DESC, id) WHERE resolved_at IS NULL;
    ```
  - Run the three reads in one `database.batch([...])`, as `apps/web/src/api/dashboard.ts:68` does, and drop the second project query.
- Alternatives:
  - Minimal: only the visibility pause.
  - Poll a small `GET /api/operations/summary` (count and newest `last_seen_at`) and load the full list only when the popover or the page is open.
  - Poll less often, for example every 5 minutes. The scheduler runs on `*/5 * * * *` (`apps/web/wrangler.jsonc`), so most alert state changes at most every 5 minutes.
- Maintainer decision needed: yes. Is a 60 s refresh a product requirement (`docs/review-guide.md:9` states "Alerts refresh every minute"), or can the period follow the 5-minute scheduler?

### PULL-05 · One failed background poll ends the waiting state, and waiting has no upper bound

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `pulls.$pullNumber.tsx:93-99`: every failure of `load` sets `status: "error"`, also when the page already showed `pending`.
  - `pulls.$pullNumber.tsx:105-106`: `if (state.status !== "pending" || state.capture !== "pending") return;` so polling stops in the error state.
  - Measurement M7: after one HTTP 503 on a background poll the heading is "Review unavailable", and there are 0 further requests in the next minute.
  - Measurement M7: 40 requests in 10 visible minutes. No backoff and no limit in the code (`pulls.$pullNumber.tsx:114`: `timer = setTimeout(refresh, 15_000)`).
- What happens: The page promises "This page updates automatically when the review is ready." A single network error during a background poll replaces that screen with an error card. Auto-update stops until the user presses "Retry". In the other direction, a check that never gets a run is polled every 15 s for as long as the tab is visible.
- Impact: A reviewer who waits can come back to an error card and no review. A visible tab on a dead check costs 240 requests per hour, each with the access path of PULL-01.
- Recommendation: Keep the last good state during background polls. Count failures and show a small "Could not refresh, retrying" note. Back off (15 s, 30 s, 60 s) and stop after a limit with a manual action.
  ```ts
  // sketch
  catch (error) {
    if (controller.signal.aborted) return;
    if (previous.status === "pending") { setRefreshFailed(true); return; } // keep the screen
    setState({ status: "error", message });
  }
  ```
- Alternatives:
  - Minimal: ignore failures of background polls and keep the 15 s period.
  - Replace polling with one long-lived request (server-sent events) that ends when the run is sealed. This needs a Worker design decision.
- Maintainer decision needed: no.

### PULL-06 · The page is bound to one check attempt and cannot find the current review of the pull request

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes (missing `check`); the stale-attempt case is from code and tests. Effort: M
- Evidence:
  - `review.ts:739-741`: without a valid `check` the answer is 404.
  - `review.ts:742-746`: the lookup uses only `external_id=?`. It never compares with newer checks of the same pull request.
  - `apps/web/src/api/api.test.ts:832-841`: the test expects the old check to stay `ready` on the old run while the rerun check is `pending`.
  - Measurement M8: `/pulls/7` sends `?check=`, gets 404, and shows "This Visonaut check was not found. Open the latest check on GitHub." with no GitHub link.
- What happens: The URL looks like "the page of pull request 7". It is the page of one check generation. An old link (an older commit in the GitHub checks list, a link pasted in chat, a rerun) shows the old result: a superseded run, a permanent "failed", or a permanent "Waiting for screenshots". The page never says that a newer capture exists. `/pulls/7` alone does not work.
- Impact: Reviewers can review or wait on the wrong attempt. The pending state then polls without end (PULL-05).
- Recommendation: Let the API also return the newest check of the same pull request, and show a notice when the opened check is not the newest. Let `/pulls/:number` without `check` resolve to the newest check.
  ```ts
  // sketch of the response
  { repository, pullNumber, state, runId, latest: { check: "visonaut:pre:<sha>:1", state: "ready", runId } | null }
  ```
- Alternatives:
  - Minimal: when the opened check is not the newest, return a new state `superseded` with a link to the newest check URL.
  - Make `/pulls/:number` a real pull request page that lists every visual run of that pull request (Redesign ideas, P4).
- Maintainer decision needed: yes. Must an old check link keep showing its own attempt (as the test at `apps/web/src/api/api.test.ts:832-841` fixes), or may it point to the newest attempt?

### PULL-07 · Several states are dead ends or give no feedback

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Not found: `pulls.$pullNumber.tsx:70-72` says "Open the latest check on GitHub.", but the error state renders only "Retry" (`:216-223`). The repository name is unknown in the error state (`:152`, `:281`). Screenshot `screens/pull-06-check-not-found--desktop-dark.png`. A retry returns the same 404.
  - Failed capture: `pulls.$pullNumber.tsx:273-277` shows "Check again" whenever `capture !== "not-required"`. A rerun gets a new check ID with a `:1` suffix (`apps/web/src/api/api.test.ts:817`), so this URL does not become ready through a rerun.
  - "Check again": `pulls.$pullNumber.tsx:274` is `onClick={() => setReload((value) => value + 1)}`. Measurement M7: request sent, markup unchanged during and after the request, button not disabled.
  - Failed sign-in: `pulls.$pullNumber.tsx:128-131` sets `status: "error"` with "Sign-in could not start. Please retry.". The heading is then "Review unavailable", and "Retry" reloads the lookup, which returns to the sign-in card. Screenshot `screens/pull-04-sign-in-failed--desktop-dark.png`.
  - Failed capture copy: "Open the pull request on GitHub to inspect the failing check." The API reads `workflowRunId` and `workflowAttempt` (`review.ts:744`), but does not return them. The button opens the pull request, not the failing run.
- What happens: The user gets an instruction without the means to follow it, a button that cannot change the result, or a button with no visible effect.
- Impact: Extra clicks and doubt at the moment when the user already has a problem.
- Recommendation:
  - Return `repository` (or a ready `githubUrl`) also with 404 and 403 answers, and show "Open on GitHub" in every state.
  - In the failed state, replace "Check again" with a link to the workflow run: `https://github.com/<repo>/actions/runs/<workflowRunId>/attempts/<attempt>`.
  - Give "Check again" a busy state and show "Checked 5 s ago".
  - Keep a failed sign-in inside the sign-in card with an inline error, as `apps/web/src/routes/runs.$runId.tsx:231-235` does.
- Alternatives:
  - Minimal: remove "Check again" from the failed state and add the GitHub link to the error state.
  - Remove manual refresh completely and show only the automatic refresh indicator with its last check time.
- Maintainer decision needed: no.

### PULL-08 · Preview shows false messages on both surfaces

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/preview-fixtures.ts:109-112`: every unknown API path returns 403 `preview_fixtures_only`.
  - `pulls.$pullNumber.tsx:63-69`: 403 becomes "Write access to this repository is required to open its review." with "Use another account". Screenshot `screens/pull-11-preview-environment-default--desktop-dark.png`.
  - `apps/web/src/review/preview-fixtures.ts:106-108`: `return Response.json({ events: [], checkedAt: 0, hasMore: false });`. Screenshot `screens/svc-01-preview-environment-default--desktop-dark.png` shows "Last checked Dec 31, 1969, 9:00 PM." (local time zone of the capture machine).
  - `apps/web/src/review/__tests__/route.browser.test.ts:552-571` asserts that preview on `/` makes no operations request. `/?view=service` in preview does make one.
- What happens: In preview, the pull request page claims a permission problem and offers an account switch that cannot help. The service page shows a 1969 timestamp.
- Impact: Wrong information on the public preview.
- Recommendation: Add preview fixtures for `/api/pulls/:n` (for example the pending state, and a ready state that points to the preview run), and return `checkedAt: Date.now()` in the operations fixture. Or do not show the service view in preview.
- Alternatives:
  - Minimal: map the `preview_fixtures_only` code to a "Preview fixtures are read-only" message on the page.
- Maintainer decision needed: no.

### PULL-09 · `$layer="primary"` is not a layer color, so primary buttons are neutral gray

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `pulls.$pullNumber.tsx:193-195` and `:225-227`: `$layer="primary"`. Also `routes/index.tsx:301`, `:310`, `:346`, `:508`.
  - `apps/web/src/components/ariakit/utils/styles.ts:6-13`: the named colors are `canvas`, `brand`, `secondary`, `success`, `warning`, `danger`. There is no `primary`.
  - `apps/web/src/components/ariakit/components/layer.ariakit.react.tsx:96-99`: any other string becomes a raw CSS color.
    ```ts
    return {
      class: "ak-layer ak-layer-color-(--layer-color)",
      style: { "--layer-color": value },
    };
    ```
  - Measurement M9: the sign-in button has `style="--layer-color: primary; …"`, `CSS.supports("color", "primary")` is `false`, and the computed background is `oklch(0.949994 0.0000497986 23.7884)` (light gray) in both color schemes. The brand element in the header is `oklch(0.515341 0.1546 248.516)` (blue).
  - Measurement M9: in light mode the button background against the card background is 1.16:1.
  - `apps/web/src/review/review-workspace.tsx:1081` and `:1283` use `$layer="brand"` and render blue.
- What happens: The theme defines `--color-primary` (`apps/web/src/components/ariakit/styles/ui.css`), but the `$layer` prop reads only the six names above. `primary` reaches CSS as an invalid color, and the layer falls back to a neutral surface.
- Impact: Every main call to action outside the review workspace looks like a secondary button. In light mode the primary button of the sign-in card has almost no visible boundary. This is a large part of the flat, unclear look of these pages.
- Recommendation: Use `$layer="brand"` (the supported name), or pass the token: `$layer="var(--color-primary)"`.
- Alternatives:
  - Add `primary` to `COLOR_VALUES` and to the color map in the vendored copy. This diverges from upstream, which also has no `primary`.
  - Add a small `PrimaryButton` wrapper next to `ControlButton`, so that pages do not choose layer values by hand.
- Maintainer decision needed: yes. Should the product call to action be the brand blue, or is a neutral high-contrast button the intended style?

### PULL-10 · `ak-ink-danger`, `ak-ink-warning`, and `ak-ink-success` do not exist, so error text has no color

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `operations-attention/index.tsx:370`: `<p className="ak-ink-danger" role="alert">`. `operations-attention/index.tsx:501`: `className="dashboard-alert-error-mark ak-ink-danger font-bold"`.
  - The same class in `apps/web/src/components/user-menu.tsx:66` and `routes/index.tsx:271`. `routes/index.tsx:331` uses `ak-ink-warning`, and `routes/index.tsx:531` uses `ak-ink-success`.
  - `apps/web/node_modules/@ariakit/tailwind/src/output.css:816-821`: `ak-ink-*` takes a number (text alpha) or an arbitrary value. It is not a color utility.
  - Measurement M10: the built CSS contains `.ak-ink-60` and `.ak-text-danger`, and no rule for `ak-ink-danger`, `ak-ink-warning`, or `ak-ink-success`.
  - Measurement M10: the alert paragraph and the "!" mark compute to `oklch(1 0 0)` in dark mode and `oklch(0 0 0)` in light mode, the same as the page heading.
- What happens: Tailwind emits nothing for these class names. Error text, the bell error mark, and the warning and success icons render in the normal text color.
- Impact: The only signal for "alert status unavailable" on the bell is a white or black "!" of the same color as the bell. Error paragraphs look like normal body text.
- Recommendation: Use the text system: `<Text $text="danger" render={<p />}>` (`apps/web/src/components/ariakit/components/text.ariakit.react.tsx:39-59`), or the classes `ak-text ak-text-danger`.
- Alternatives:
  - Use a `Frame $layer="danger"` callout for errors, so that the error has a surface and not only a text color.
- Maintainer decision needed: no.

### PULL-11 · The service page column moves with its content

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `operations-attention/index.tsx:304-306`: `layout === "page" ? "flex flex-col gap-5 max-w-4xl mx-auto" : …`.
  - Measurement M11 at 1440 px: heading left edge 398 px (no alerts), 372 px (one alert), 290 px (two alerts), 272 px (seven alerts). Panel width 643, 696, 861, 896 px.
  - Measurement M11: the parent is the Shell grid (`grid-template-columns: [full-start] 88px [feature-start] 56px [popout-start] 16px [content-start] 1120px …`). With `mx-auto` removed in the live page, the panel is 896 px wide at a fixed left edge.
  - `apps/web/src/components/ariakit/styles/shell.ts:728-733`: "Do not add a query container, auto margins, or inline padding: each breaks the inherited column alignment."
  - The same effect on the dashboard error cards: `screens/svc-12-run-list-failed-hides-status--desktop-dark.png` and `screens/svc-13-access-denied-on-alerts--desktop-dark.png` show two different card widths.
- What happens: A grid item with automatic inline margins takes the width of its content. The panel is therefore as wide as its longest line. When alerts appear or resolve, the heading and every line jump sideways. The preview note (`routes/index.tsx:358-362`) sits at the main column edge, far to the left of the heading (`screens/svc-01-preview-environment-default--desktop-dark.png`).
- Impact: The page looks unstable on each refresh that changes the list. Left edges do not line up.
- Recommendation: Use the Shell bands. Put the page in `ShellMainContent` and set the width with `ShellMain $maxWidth`. Do not use `mx-auto` on Shell children.
- Alternatives:
  - Minimal: replace `max-w-4xl mx-auto` with `w-full max-w-4xl justify-self-center`.
- Maintainer decision needed: no.

### PULL-12 · The alert text catalogue does not match the alerts that the service emits

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes (the generic rendering); the kind lists are from code. Effort: M
- Evidence:
  - UI catalogue: `operations-attention/index.tsx:98-199`.
  - Emitted kinds with no UI branch (they get "A service operation needs attention"):
    - `staged-retention` (`apps/web/src/api/workflow-retention.ts:136-140`, `apps/web/src/runtime.ts:423-427`)
    - `runtime` (`apps/web/src/runtime.ts:470-474`)
    - `history` (`apps/web/src/operations/closed-summary.ts:424-428`, `apps/web/src/operations/history.ts:949-953`)
    - `historical-archive` (`apps/web/src/operations/history-supplement.ts:168-172`)
    - `webhooks`, `check-aliases`, `staged` (`apps/web/src/runtime.ts:368-374`, `:390-394`)
    - `review-decisions`, `review-links`, `source-retention` (step names, `apps/web/src/operations/index.ts:47-61`, `:82-86`)
  - UI branches with no emitter: `backup` (`operations-attention/index.tsx:117-123`) and `backup-retention` (`operations-attention/index.tsx:175`). `apps/web/src/operations/README.md:60` records "before retiring the backup and restore source".
  - One text for three codes: `database-capacity` has `measurement-unavailable`, `admission-blocked`, and `headroom-warning` (`apps/web/src/capacity.ts:48-52`, `:74-78`, `:81-85`). The UI text for all three is "New capture runs pause at the admission limit…" (`operations-attention/index.tsx:110-116`).
  - The browser tests use the retired kind as their main fixture: `apps/web/src/review/__tests__/operations.browser.test.ts:7` (`kind: "backup"`) and `apps/web/src/review/__tests__/route.browser.test.ts:213`.
  - `docs/review-guide.md:7`: "The dashboard shows unresolved backup, GitHub check, baseline, storage, and recovery alerts."
  - Screenshot `screens/svc-15-unmapped-alert-kinds--desktop-dark.png`: five real kinds, five identical cards.
- What happens: The emitters and the UI share only strings. Ten emitted kinds fall through to one generic card. Two UI branches describe a retired feature. A capacity measurement failure is described as a full database.
- Impact: The alerts that are hardest to diagnose (scheduler, runtime, retention) are the ones with no specific text. Tests and the guide document an alert that cannot occur.
- Recommendation: Create one typed catalogue that both sides import, so that the type check fails when an emitter uses an unknown kind.
  ```ts
  // apps/web/src/operations/alerts.ts (sketch)
  export const alerts = {
    "check-delivery": {
      system: "github-checks",
      severity: "high",
      affectsReviews: true,
      title: "Check delivery failed",
      steps: ["…"],
      guide: "#check-delivery",
    },
    "staged-retention": {
      system: "storage",
      severity: "low",
      affectsReviews: false,
      title: "Staged upload cleanup failed",
      steps: ["…"],
      guide: "#staged-retention",
    },
  } as const;
  export type AlertKind = keyof typeof alerts;
  export function recordEvent(
    db: Database,
    input: { kind: AlertKind; subject: string; code: string; now: number },
  ) {}
  ```
- Alternatives:
  - Minimal: add the missing branches, remove `backup` and `backup-retention`, split the capacity text by code, and change the test fixtures to a live kind.
  - Let the API return `title`, `steps`, `severity`, and `system` for each event, so that the client holds no copy.
- Maintainer decision needed: yes. Should alert copy live on the server (the API returns text) or in the client (the API returns keys)?

### PULL-13 · A malformed capacity snapshot hides every alert

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/api/operations.ts:52`: `capacity: capacity ? (JSON.parse(capacity.value) as unknown) : null` (no validation on the server).
  - `operations-attention/index.tsx:74-94`: any missing or non-integer capacity field throws "Database capacity could not be read.", which discards the whole response, events included.
  - Screenshot `screens/svc-16-malformed-capacity-hides-alerts--desktop-dark.png`: seven alerts in the response, zero on screen, text "The current alert state is unknown."
- What happens: The optional capacity block and the alert list fail together.
- Impact: Low probability, because the same code writes the cursor. If the policy shape changes in a later release, old cursors can blank the alert list until the next sample.
- Recommendation: Parse capacity on its own. On failure keep the alerts and show "Capacity unavailable".
- Alternatives:
  - Validate and normalize the cursor on the server and send `capacity: null` when it is not valid.
- Maintainer decision needed: no.

### PULL-14 · Alert cards do not say what is affected, since when, or how bad it is

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - `operations-attention/index.tsx:397-423`: each card is a title, one paragraph, and a closed `<details>`. No icon, no color, no time, and no subject outside `<details>`.
  - The table column `occurrences` exists (`apps/web/migrations/0005_operations.sql:33-42`), but `apps/web/src/api/operations.ts:31` does not select it.
  - Titles repeat: "A GitHub check needs attention" covers `check-creation`, `check-delivery`, and `checks` with any code (`operations-attention/index.tsx:124-136`).
  - Measurement M12: seven alerts make a 1528 px page with 258 words. The popover list viewport is 435 px high for 1327 px of content: 2 of 7 cards fully visible on desktop, 1 of 7 on mobile.
  - Screenshots `screens/svc-07-many-alerts-with-capacity--desktop-dark.png`, `screens/svc-09-fifty-alerts-has-more--desktop-dark.png` (50 cards; the note "Showing the 50 most recently reported unresolved alerts." is at the very end), and `screens/pop-04-open-many-alerts-with-capacity--mobile-dark.png`.
  - Subjects are IDs that the app could link: a workflow run and attempt for `staged-reconciliation` (`packages/service/src/run-retirement.ts:135-143`), a comparison or task ID, a GitHub delivery GUID. None is a link.
- What happens: All alerts have the same weight. The intro says "Unresolved alerts and what they mean for your reviews", but no alert says whether reviews are affected. The time of an alert is one disclosure away and absolute. Two alerts of the same kind are identical until the user opens both.
- Impact: The user must read every paragraph to find the one alert that matters. With many alerts the page is a wall of similar text, and the popover is a small window on that wall.
- Recommendation: Change the unit from a prose card to a scannable row, and move prose to an expanded view. Each row needs a severity mark, a short specific title, the subject as a link, a relative time ("since 14:55, seen 14 times"), and a one-line effect on reviews. Group by system. See Redesign ideas S1 to S5 and C1.
- Alternatives:
  - Minimal: show kind, subject, and "last seen 4 min ago" on the card face, open the details by default on the page layout, and add the occurrence count to the API.
  - Collapse alerts of the same kind and code into one row with a count ("Check delivery failed · 17 runs").
- Maintainer decision needed: yes. Who is the reader of this surface: every reviewer, or only the operator? The answer decides how much recovery text belongs on the first level.

### PULL-15 · Both surfaces say the same thing several times

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence (service page, empty state, `screens/svc-04-empty--desktop-dark.png`, 64 words in M12). Line numbers are in `operations-attention/index.tsx`:
  1. "OPERATIONS" (`:311-316`)
  2. "Service status." (`:317-322`)
  3. "Unresolved alerts and what they mean for your reviews. This page checks for updates every minute." (`:330-333`)
  4. "No unresolved operation alerts. Last checked …" (`:341-347`)
  5. "Refresh alerts" (`:359-361`)
  6. "No unresolved alerts." (`:438-440`), the same fact as item 4
  7. "This view reports operation alerts. It does not test every service dependency." (`:441-443`)
  8. "Open the operations and recovery guide" (`:459-461`)
  9. "No external notifications are sent." (`:463-467`)
- Evidence (popover, empty state, `screens/pop-02-open-no-alerts--desktop-dark.png`): heading, "Alerts refresh every minute while this dashboard is open. No external notifications are sent." (`operations-attention/index.tsx:336-337`), the summary line, the refresh button, and the guide button.
- Evidence (pull request page): the pull request number appears twice in one card in the sign-in state and in the three capture states: the eyebrow "Visual review · Pull request #7" (`pulls.$pullNumber.tsx:177`) and the heading "Pull request #7" (`:239`) or "Sign in to review pull request #7" (`:187`). The heading adds no information. The pending state has 36 words (M12).
- Evidence (loading): the service page shows "Checking for unresolved operation alerts…" and "Checking alerts…" side by side (`screens/svc-03-loading-alerts--desktop-dark.png`).
- What happens: Three disclaimers (refresh period, no notifications, not a dependency test) are always visible. The all-clear fact is stated twice. Headings repeat the eyebrow.
- Impact: The one useful fact ("all clear" or "2 alerts") does not stand out. This matches the "bloated with text" complaint.
- Recommendation: One status sentence for each state. Move the three disclaimers behind one "About this page" control (a `Popover` or a tooltip). On the pull request page, remove the eyebrow or the heading and show the pull request title.
  ```
  Before (empty service page): 9 text blocks, 64 words
  After:  ● All clear · checked 12 s ago  ⟳  ⓘ       (6 words, 2 icon buttons)
  ```
- Alternatives:
  - Keep the disclaimers, but as one footnote line in small text.
- Maintainer decision needed: yes. `docs/review-guide.md:9-11` documents "No external notifications are sent" and "It does not certify every service dependency". Must these sentences stay visible on the surface, or may they move to the guide and a help popover?

### PULL-16 · One concept has five names and two entry points in the same header

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - "Service status": nav label (`apps/web/src/components/app-shell.tsx:18`) and page heading (`operations-attention/index.tsx:321`).
  - "Service attention": popover heading (`operations-attention/index.tsx:325`), every `aria-label` of the bell (`:292-300`), the live announcements (`:251-264`), and a server error message (`apps/web/src/capacity.ts:112`: "a maintainer must check Service attention").
  - "Operations": page eyebrow (`operations-attention/index.tsx:315`), the guide button, file names.
  - "operation alerts": summary lines (`operations-attention/index.tsx:343`) and errors (`:243`).
  - "service alert": announcements (`operations-attention/index.tsx:253`, `:259`).
  - `docs/review-guide.md:5-11` calls it "service attention", "the dashboard", and "the panel". It does not name the "Service status" page.
  - Two triggers in the same header bar: the nav link with an activity icon, and the bell (`screens/pop-01-closed-no-alerts--desktop-dark.png`). The bell is hidden on the service view (`routes/index.tsx:254`) and absent on the run and pull pages.
  - The bell icon means notifications, and the first sentence in the popover says that no notifications are sent.
  - The popover has no link to the page (M12: `linkToServicePage: false`).
- What happens: The same alert list is reachable in two ways under two names, and the two are not linked.
- Impact: Users cannot tell whether the bell and the page are different things. Documentation and UI use different words.
- Recommendation: Choose one name and one entry point. For example: the name "Service status", the nav link with a status dot or count as the entry point, and a compact popover or banner only as a preview that links to the page. See Redesign ideas T1 to T4.
- Alternatives:
  - Keep both, rename the popover "Service status", change the bell to the same activity icon, and add "Open service status" to the popover.
- Maintainer decision needed: yes. Which name is the product term: "Service status" or "Service attention"?

### PULL-17 · The pull request page has no pull request context and no stage information

- Kind: ux
- Severity: medium. Confidence: high. Measured: no (code reading; the screenshots confirm the absence). Effort: M
- Evidence:
  - `review.ts:778-783`: the response has only `repository`, `pullNumber`, `runId`, and `state`.
  - `review.ts:773-777`: `pending` is the default. It covers a check with no workflow run bound yet, a bound run that still uploads or compares (`run.sealedAt === null`), and a check that never gets a run.
  - The dashboard query already resolves pull request titles from stored webhook payloads (`apps/web/src/api/dashboard.ts:57-62`).
  - The queue shows a different design for the same situation: "In progress" rows with "Waiting for screenshots" or "Comparing images" and an "Open run" link (`routes/index.tsx:130-134`, `:542`, `:560-603`).
  - Screenshot `screens/pull-08-pending--desktop-dark.png`: no title, no commit, no attempt, no time.
- What happens: The page cannot say which pull request it is beyond a number, which commit it waits for, what stage the capture is in, or how long it has waited. When an unsealed run exists, the queue links to it and this page does not.
- Impact: "Waiting for screenshots." is the same sentence for "CI has not started" and "the comparison finishes in a few seconds". The user cannot judge whether to wait.
- Recommendation: Extend the response with what the server already has: title, tested commit, attempt, stage (`planned`, `capturing`, `comparing`, `ready`, `failed`, `not-required`), stage start time, and the workflow run URL. Show the stages as a short stepper (Redesign ideas P2).
- Alternatives:
  - Minimal: add the title and the tested commit to the response, and show "Checked 5 s ago".
  - Do not design a waiting page. Open the run page for any bound run and show the stage there (Redesign ideas P1).
- Maintainer decision needed: no.

### PULL-18 · Three different sign-in and access-denied designs, and three different headers

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Sign-in:
    - Dashboard: a two-column hero "Every change. A clear decision." with a card and a full-width button (`routes/index.tsx:280-320`, `screens/svc-14-guest--desktop-dark.png`).
    - Run: "Sign in to review this run", "This review is available to Ariakit maintainers.", a flat button with a log-in icon (`apps/web/src/routes/runs.$runId.tsx:227-243`).
    - Pull: "Sign in to review pull request #7", two sentences, a button with an external-link arrow (`pulls.$pullNumber.tsx:186-203`, `screens/pull-02-guest--desktop-dark.png`).
  - Access denied:
    - Dashboard: "Repository access required", "Your repository access changed. Write access to this repository is required.", "Retry" and "Use another account" (`routes/index.tsx:321-354`).
    - Run: "This run could not be opened", "Write access to this repository is required to open this run.", only "Retry" (`apps/web/src/routes/runs.$runId.tsx:76-108`).
    - Pull: "Repository access required", "Write access to this repository is required to open its review.", only "Use another account" (`pulls.$pullNumber.tsx:206-233`).
  - Sign-out: the pull page sets local state (`pulls.$pullNumber.tsx:138-142`), and the run page calls `window.location.assign("/")` (`apps/web/src/routes/runs.$runId.tsx:193`).
  - Headers (M12): the pull page has the logo and three nav links only. The dashboard adds the bell and "Account". The run page adds "Account". During loading the dashboard header has neither (`routes/index.tsx:257`, `screens/svc-02-loading-runs--desktop-dark.png`).
  - The account menu never shows who is signed in: `UserMenu` gets no `login` prop (`routes/index.tsx:258-263`), and `apps/web/src/components/user-menu.tsx:24` falls back to "Account". On "Repository access required" the user cannot see which account was refused.
  - The repository label in the header appears only in some states (`pulls.$pullNumber.tsx:152`), so the header content changes between loading and loaded.
  - `createAuthClient()` is called inside each click handler in three files (`pulls.$pullNumber.tsx:124`, `:138`; `routes/index.tsx:216`, `:232`; `apps/web/src/routes/runs.$runId.tsx:175`, `:191`).
- What happens: The same two situations have three designs, three texts, and three button sets.
- Impact: More copy to maintain, and the user learns nothing from one screen that helps on the next. The denied screens hide the one fact that helps: the refused account.
- Recommendation: One `AccessGate` component for all routes with fixed parts: what you tried to open, which account is signed in, one primary action, one secondary action. One header for all routes with stable slots. The server already knows the login (`review.ts:713-720`). Return it with 403 answers and with `/api/runs`.
- Alternatives:
  - Minimal: align the copy and the button sets, and pass `login` to `UserMenu`.
- Maintainer decision needed: no.

### PULL-19 · Layout and style defects on the pull request page

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Back link: `pulls.$pullNumber.tsx:155-160` is a flat button in a grid. Measurement M12: the link is 592 px wide (424 to 1016), the same as the card, and its label is centered. All card content is left aligned. Screenshot `screens/pull-08-pending--desktop-dark.png`.
  - The user came from GitHub, so "Review queue" is not "back". The header directly above already has a "Review queue" link.
  - Status frame: `pulls.$pullNumber.tsx:241-247` uses `$layer={state.capture === "failed" ? "warning" : true}`. Measurement M12: in the pending state the frame background equals the card background (`oklch(0.2134 0.0091 264.28)`), so the frame is invisible, and its text starts 48 px to the right of the heading (501 px against 453 px).
  - Failed state: a saturated yellow block, `rgb(253, 199, 0)` in dark mode (`screens/pull-09-capture-failed--desktop-dark.png`). The queue shows failed runs with the danger color (`routes/index.tsx:147-149`).
  - The icon tile (`pulls.$pullNumber.tsx:170-172`, `$darken={3}`) is a gray square in light mode that looks like a disabled control (`screens/pull-02-guest--desktop-light.png`).
  - "Sign in with GitHub" has an external-link arrow (`pulls.$pullNumber.tsx:200-202`) but navigates in the same tab. "Open on GitHub" has the same arrow and also opens in the same tab (M12: `target: null`).
  - The card is 592 px wide although the class says `max-w-2xl` (672 px), because the `ShellMain` padding and the body width apply together (`pulls.$pullNumber.tsx:153-154`).
  - Headings end with a period on the service page ("Service status.", "No unresolved alerts.") and not on the pull page.
- What happens: Small errors of alignment, emphasis, and meaning add up to an unpolished card.
- Impact: Visual quality.
- Recommendation: Remove the back link (the header has it). Remove the icon tile and the eyebrow. Use one status row with an icon and a tinted surface for each state. Use `danger` for failure. Use the arrow icon only for links that leave the app, and decide whether they open a new tab.
- Alternatives:
  - Minimal: left-align the back link (`justify-self-start`), give the status frame `$lighten` or `$border`, and switch the failed layer to `danger`.
- Maintainer decision needed: no.

### PULL-20 · The surfaces bypass primitives that the vendored copy already has

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: no (code reading). Effort: M
- Evidence:
  - Native `<details>` and `<summary>` (`operations-attention/index.tsx:413-422`). The vendored copy has `Disclosure`, `DisclosureButton`, and `DisclosureContent` (`apps/web/src/components/ariakit/components/disclosure.ariakit.react.tsx:588-794`).
  - A hand-made scroll area `min-h-0 max-h-[50dvh] overflow-auto space-y-3` (`operations-attention/index.tsx:366`). The vendored copy has `PopoverScroll` (`apps/web/src/components/ariakit/components/popover.ariakit.react.tsx:112-124`).
  - `max-w-4xl mx-auto` and `mx-auto w-full max-w-2xl` for page width (`operations-attention/index.tsx:305`, `pulls.$pullNumber.tsx:154`). The Shell has `ShellMainIntro`, `ShellMainContent`, and `ShellMainPopout` (`apps/web/src/components/ariakit/components/shell.ariakit.react.tsx:254-385`).
  - `Text` is used 20 times in the two files, each time only as an element with raw classes, for example `className="text-xs uppercase tracking-widest font-medium ak-ink-60"` (`pulls.$pullNumber.tsx:175`). There is no shared heading, eyebrow, or caption style.
  - Plain `<p>` elements beside `Text` in the same block (`operations-attention/index.tsx:341`, `:370`).
  - Class names with no CSS that exist only as test hooks: `dashboard-alert-count` and `dashboard-alert-error-mark` (`operations-attention/index.tsx:493`, `:501`, used by `apps/web/src/review/__tests__/operations.browser.test.ts:157-158`), `dashboard` and `dashboard-main` (`routes/index.tsx:248`, `:269`, `apps/web/src/components/operations-attention/__tests__/fixture.tsx:9`).
  - `Badge` gets radius, size, and padding overrides to become a counter: `className="dashboard-alert-count min-w-[18px] min-h-[18px] px-0.5 rounded-full! text-[10px] leading-none"` (`operations-attention/index.tsx:493`).
  - The capacity block is two sentences in a `Frame` (`operations-attention/index.tsx:375-391`). Upstream has `Progress` and `ProgressCircular` (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components/progress.ariakit.react.tsx`). The vendored copy does not include them.
  - The list of alerts is a raw `<ul className="list-none m-0 p-0 grid gap-4">` (`operations-attention/index.tsx:393`). Upstream has `List`, `ListItem`, `ListItemMarker`, and `ListDisclosure`.
- What happens: The pages use Frame, Text, Button, Badge, Popover, and Shell as thin wrappers, then rebuild layout, typography, lists, disclosure, and scrolling with raw Tailwind classes.
- Impact: The two surfaces do not look or behave like the review workspace. PULL-09, PULL-10, and PULL-11 all come from values that the primitives do not accept.
- Recommendation: In the redesign, set page structure with Shell parts, typography with a small set of text recipes (heading, eyebrow, caption), lists with `List` or `Table`, disclosure with `Disclosure`, and capacity with `Progress`. Update the vendored copy to an upstream commit that has `heading`, `list`, `progress`, `separator`, `tooltip`, `link`, and `code`.
- Alternatives:
  - Minimal: replace `<details>` with `Disclosure`, replace the scroll element with `PopoverScroll`, and move the test hooks to roles or `data-testid`.
- Maintainer decision needed: yes. May the vendored copy move to a newer upstream commit for the redesign?

### PULL-21 · Accessibility gaps

- Kind: accessibility
- Severity: medium. Confidence: medium. Measured: yes (heading outline, titles, link attributes); focus behavior is from code. Effort: S
- Evidence:
  - Heading outline (M12). Service page with alerts: `H1 Service status.` then one `H3` for each alert, no `H2`. The same in the popover: `H1 Service attention` then `H3`. Source: `operations-attention/index.tsx:407` (`render={<h3 />}`).
  - A second `H1` is in the document from each popover heading: `H1 Account` on every page with the account menu (M12), and `H1 Service attention` while that popover is open.
  - Every route has the same document title `Visonaut` (M9; `apps/web/src/routes/__root.tsx:10`). A user with a pull request tab, a run tab, and the queue cannot tell the tabs apart. The pull request page does not put its state in the title, so a background tab cannot show "ready".
  - On each mount the live region announces the alert count (`operations-attention/index.tsx:250-255`). "Refresh runs" unmounts and remounts the component (`routes/index.tsx:242-245`, `:254`). `apps/web/src/review/__tests__/route.browser.test.ts:241-243` expects a second load and the announcement, so the same sentence is announced again.
  - State changes on the pull page replace the focused button (`pulls.$pullNumber.tsx:184-235`) and do not move focus. After a failed sign-in the focused element is removed.
  - The guide button is a link that leaves the app in the same tab, without an icon or text that says so (`operations-attention/index.tsx:452-462`; M12: `target: null`).
  - The bell has no visible label and no tooltip. Its accessible name is long and correct (`operations-attention/index.tsx:292-300`).
  - The badge text is 10 px (`operations-attention/index.tsx:493`). Its contrast is good (7.04:1 dark, 9.05:1 light, M12).
- What happens: Structure and naming problems. No color-contrast failure was found for text.
- Impact: Screen reader users get a broken outline and repeated announcements. All users get identical tab titles.
- Recommendation: Use heading levels in order (upstream `Heading` and `HeadingLevel` do this). Render popover headings as `h2`. Set a title for each route and state, for example "#5123 Waiting for screenshots · Visonaut". Keep the operations state above the refresh so that it does not remount. Move focus to the new heading after a state change.
- Alternatives:
  - Minimal: change `h3` to `h2`, and set route titles in `head`.
- Maintainer decision needed: no.

### PULL-22 · "Open the operations and recovery guide" does not lead to recovery steps for the alert

- Kind: ux
- Severity: medium. Confidence: medium. Measured: no (document reading). Effort: M
- Evidence:
  - `operations-attention/index.tsx:452-462`: one fixed link for all alerts, `https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md`.
  - Alert texts that send the user there: "Follow the recovery guide to reconcile the check for this exact commit before retrying its delivery." (`operations-attention/index.tsx:133`), "follow the recovery guide to resume the check" (`:134`), "Follow the recovery guide before retrying promotion." (`:169`), "Use the recovery guide to resume the affected operation." (`:197`).
  - `apps/web/src/operations/README.md` has these sections: "Durable decisions and sealed recovery", "Baselines and closed history", "Conversion before deployment", "Manual evidence export", "Native database recovery". It has no section on reconciling a check, resuming check delivery, or retrying promotion. Its first paragraph says: "This runbook describes source behavior before the selected retirements."
  - The link target is a file in a GitHub repository. Whether every user who can sign in can read `ariakit/visonaut` was not verified.
- What happens: The main action of the surface opens a long design and cutover document. The user must search it for a step that is not there.
- Impact: The alert tells the operator to do something that no document describes.
- Recommendation: Write a short runbook with one anchor for each alert kind, and link each alert to its anchor. Or put the steps in the catalogue of PULL-12 and show them in the expanded alert, so that no external document is needed.
- Alternatives:
  - Minimal: remove the "follow the recovery guide" sentences that have no target, and keep the link as "Operations notes".
- Maintainer decision needed: yes. Is an operator runbook in scope, and where should it live (in the app, in `docs/`, or in this README)?

### PULL-23 · One component holds polling, announcements, copy, and two layouts, and the page layout has no test

- Kind: dx
- Severity: low. Confidence: high. Measured: no (code reading and test search). Effort: M
- Evidence:
  - `operations-attention/index.tsx` is 518 lines: response parsing (`:32-96`), the copy catalogue (`:98-199`), formatters (`:201-211`), the polling effect with the announcement logic (`:228-289`), and one JSX tree with 8 layout branches (`:305`, `:309`, `:327`, `:329`, `:366`, `:428`, `:463`, `:476`).
  - The page layout is wrapped in `PopoverProvider` although it has no popover (`operations-attention/index.tsx:472`).
  - No browser test opens `/?view=service` or passes `layout="page"` (search in `apps/web/src` test files for `view=service`, `layout="page"`, and "Service status": no match).
  - The operations fixture renders the component on a bare page without the Shell (`apps/web/src/components/operations-attention/__tests__/fixture.tsx:9-14`; `screens/pop-10-harness-bare-fixture--desktop-dark.png`), so tests never see the popover in the header.
  - The pull page tests do not cover the `not-required`, `forbidden`, and not-found screens or "Use another account" (`apps/web/src/review/__tests__/pulls.browser.test.ts` has five tests, none for these).
  - `refresh()` in the dashboard sets the whole page to loading, which unmounts the bell and the account menu and fetches alerts again (`routes/index.tsx:242-245`, `:254-264`).
- What happens: Any change to one layout risks the other, and half of the surface has no test.
- Impact: Slower and riskier changes. The redesign will touch all of it.
- Recommendation: Split into a data hook (`useOperationsStatus`), the shared catalogue (PULL-12), and two small views. Add fixture states for the page layout.
- Alternatives:
  - Minimal: add one browser test for `/?view=service` (empty, alerts, error).
- Maintainer decision needed: no.

### PULL-24 · Timestamps and sizes are hard to read

- Kind: ux
- Severity: low. Confidence: high. Measured: yes (screenshots). Effort: S
- Evidence:
  - `operations-attention/index.tsx:205-207`: every time is `toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })`, for example "First seen Oct 5, 2026, 2:55 PM · Last seen Oct 5, 2026, 4:26 PM" (`screens/svc-08-details-open--desktop-dark.png`).
  - Two clocks on one screen: "Last checked Oct 5, 2026, 4:30 PM." and "Capacity sampled Oct 5, 2026, 4:27 PM." (`screens/svc-05-empty-with-capacity--desktop-dark.png`).
  - `operations-attention/index.tsx:201-203`: sizes are always MiB with one decimal: "Database: 1612.4 MiB used; 435.6 MiB before new runs pause." The default limits are 1536 MiB (warning) and 2048 MiB (admission) (`apps/web/src/runtime-defaults.ts:15-16`).
  - Times are text, not `<time dateTime>`.
- What happens: The user must compute "how long ago" and "how full" by hand.
- Impact: Slower reading of the two facts that matter most: age and headroom.
- Recommendation: Relative times with the absolute time in a tooltip ("4 min ago"), a duration for open alerts ("for 1 h 31 min"), and a meter for capacity ("79% of 2 GiB · new runs pause at 100%") with a mark at the warning threshold.
- Alternatives:
  - Minimal: drop the year and the date when the time is today.
- Maintainer decision needed: no.

## Measurements

All measurements ran on 2026-10-05 against the two running dev servers with Chrome through Playwright. Scripts and raw output are in the scratch directory (`capture.mjs`, `sheets.mjs`, `measure.mjs`, `measure2.mjs`, `measure3.mjs`, `measure4.mjs`, `query-plan.mjs`, `measurements.json`, `measure*-output.txt`, `query-plan-output.txt`).

Limits that apply to all of them:

- The app server on port 4310 is the Vite dev server in preview mode. Absolute times are not production times. Only request order, request count, and differences between runs are meaningful.
- The dev server runs React StrictMode, so each effect fetch appears twice in the logs (the first one is aborted). This is not expected in a production build. Not verified in production.
- API answers for non-preview states were supplied with request interception. No production data was used.

**M1. Pull URL to review workspace, compared with a direct run URL.**
Command: `node measure.mjs` (section 6). Raw result:

```
waterfall-pull-to-run-delay-0ms   4ms request /pulls/7 · 266ms request /api/pulls/7 · 273ms response 200 · 275ms request /api/runs/<id> · 287ms response 200 · 526ms visible Review workspace
waterfall-direct-run-delay-0ms    6ms request /runs/<id> · 244ms request /api/runs/<id> · 514ms visible Review workspace
waterfall-pull-to-run-delay-300ms 6ms request /pulls/7 · 286ms request /api/pulls/7 · 588ms response 200 · 592ms request /api/runs/<id> · 899ms response 200 · 1341ms visible Review workspace
waterfall-direct-run-delay-300ms  6ms request /runs/<id> · 243ms request /api/runs/<id> · 854ms visible Review workspace
```

Reading: with 300 ms added to each API answer, the pull URL is 487 ms slower than the direct run URL. With 0 ms added the two are equal, because the local API answers in a few milliseconds.

**M2. Client chunk sizes** (from the existing `apps/web/dist/client/assets`; `gzip -c <file> | wc -c`):

| File                              | Bytes   | gzip bytes |
| --------------------------------- | ------- | ---------- |
| `index-MxeSnhFR.js`               | 319 611 | 101 302    |
| `app-shell-rQLLgOsf.js`           | 139 641 | 40 214     |
| `runs._runId-QUJlDVZ1.js`         | 137 841 | 43 939     |
| `badge.ariakit.react-CyMRzBLT.js` | 53 323  | 19 381     |
| `routes-DOmkFmT0.js`              | 41 664  | 12 030     |
| `react-Dfu8Q4go.js`               | 31 168  | 11 624     |
| `pulls._pullNumber-pnMUd0Nl.js`   | 6 716   | 2 423      |
| `index-CXm4JU5N.css`              | 464 666 | 60 063     |

Limit: I did not build. The output was already present. I did not check that it matches the current source.

**M3. Service page request order.** `node measure.mjs` (section 7):

```
waterfall-service-delay-0ms   6ms request / · 290ms request /api/runs · 313ms request /api/operations · 344ms visible alert list
waterfall-service-delay-300ms 9ms request / · 308ms request /api/runs · 632ms request /api/operations · 1338ms visible alert list
```

**M4. Header navigation.** `node measure4.mjs`:

```
click header "Service status": document /?view=service, fetch /api/runs, fetch /api/operations
click header "Review queue":   document /, fetch /api/runs, fetch /api/operations
click in-page "View history":  (no request)
navLink: { tag: "A", href: "/?view=service" }
```

**M5. Alert polling in a hidden tab.** `node measure.mjs` (section 8), fake clock, `document.visibilityState` forced to `hidden`:

```
operations-polling-while-hidden: { requestsAfterLoad: 2, requestsAfterFiveHiddenMinutes: 7 }
```

**M6. Query plans.** `node --experimental-sqlite query-plan.mjs`. The script builds a scratch SQLite database from `apps/web/migrations/*.sql` and uses the SQL text of `apps/web/src/api/operations.ts`, `apps/web/src/operations/check-state.ts`, and `apps/web/src/operations/staged-alerts.ts`.

```
operations_events indexes: ["operations_events","sqlite_autoindex_operations_events_1"]
[GET /api/operations: events]
4 <- 0: SCAN operations_events
… (correlated subqueries, evaluated only for matching kinds; they include SCAN creation, SCAN staged, SCAN snapshot)
464 <- 0: USE TEMP B-TREE FOR ORDER BY
[GET /api/operations: project guard]
SCAN visonaut_projects USING INDEX sqlite_autoindex_visonaut_projects_1
[GET /api/operations: capacity]
SEARCH operations_cursors USING INDEX sqlite_autoindex_operations_cursors_1 (id=?)
[GET /api/pulls: check]
SEARCH pre_run_checks USING INDEX sqlite_autoindex_pre_run_checks_1 (external_id=?)
[GET /api/pulls: run]
SEARCH visonaut_runs USING INDEX sqlite_autoindex_visonaut_runs_2 (project_id=? AND external_run_id=? AND attempt=?)
rows in table: 1000;  open alerts returned: 3; local elapsed: 0.05 ms
rows in table: 10000; open alerts returned: 3; local elapsed: 0.22 ms
```

Limit: local SQLite, not D1. The production row count of `operations_events` is unknown.

**M7. Pull page polling and manual refresh.** `node measure3.mjs`:

```
transientPollFailure: { requestsAfterLoad: 2, requestsAfterFailedPoll: 3, headingAfterFailedPoll: "Review unavailable", requestsAfterOneMoreMinute: 3, pollingContinued: false }
checkAgainFeedback:   { requestSent: true, markupChangedWhileLoading: false, buttonDisabledWhileLoading: false, markupChangedAfterResponse: false }
pendingPolling:       { requestsInTenVisibleMinutes: 40 }
```

**M8. Missing `check` parameter.** `node measure3.mjs`:

```
missingCheckParameter: { querySentToApi: "?check=", message: "This Visonaut check was not found. Open the latest check on GitHub.", links: ["Review queue"], buttons: ["Retry"] }
```

**M9. `$layer="primary"` and document titles.** `node measure2.mjs`:

```
buttonStyleAttribute: "--layer-color: primary; --layer-lightness-offset: …"
buttonBackground: "oklch(0.949994 0.0000497986 23.7884)"
brandElementBackground: "oklch(0.515341 0.1546 248.516)"
supportsPrimaryAsColor: false
title-queue / title-history / title-service / title-run / title-pull: "Visonaut"
```

From `node measure.mjs`, light mode: button background `rgb(238, 238, 238)`, card background `rgb(254, 255, 255)`, button against card 1.16:1, button text 18.1:1. Dark mode: button against card 15.17:1.

**M10. Semantic text colors.** `node measure.mjs` (section 2) and a search of the built CSS:

```
error-colors-dark:  alertClass "ak-ink-danger", alertInk oklch(1 0 0), headingInk oklch(1 0 0)
error-colors-light: alertClass "ak-ink-danger", alertInk oklch(0 0 0), headingInk oklch(0 0 0)
warning-icon-dark:  iconClass "… ak-ink-warning", iconInk oklch(1 0 0)
trigger-dark unavailable: mark { ink oklch(1 0 0), class "dashboard-alert-error-mark ak-ink-danger font-bold" }
rg -c "ak-ink-danger" apps/web/dist/client/assets/index-CXm4JU5N.css                 → no match
rg -c "ak-ink-warning|ak-ink-success" apps/web/dist/client/assets/index-CXm4JU5N.css → no match
```

**M11. Service page column.** `node measure.mjs` (section 1) and `node measure2.mjs`, viewport 1440 × 900:

| State                                    | `h1` left | Panel width |
| ---------------------------------------- | --------- | ----------- |
| No alerts                                | 398 px    | 643 px      |
| 1 alert                                  | 372 px    | 696 px      |
| 2 alerts                                 | 290 px    | 861 px      |
| 7 alerts and capacity                    | 272 px    | 896 px      |
| No alerts, `mx-auto` removed in the page | 160 px    | 896 px      |

Parent: `display: grid`, `grid-template-columns: [full-start] 88px [feature-start] 56px [popout-start] 16px [content-start] 1120px [content-end] 16px [popout-end] 56px [feature-end] 88px [full-end]`.

**M12. Other DOM values.** `node measure.mjs`:

- Text volume: service page 64 words (empty), 72 (1 alert), 100 (2 alerts), 258 (7 alerts). Popover with 7 alerts: 244 words. Pull page pending: 36 words.
- Page height with 7 alerts: 1528 px (dark), 1510 px (light).
- Popover with 7 alerts: dialog 460 × 648 px, list viewport 435 px for 1327 px of content, 2 of 7 cards fully visible. Mobile (390 × 844): dialog 366 × 608 px, list 352 px for 1526 px, 1 of 7 cards fully visible.
- Popover links: guide link `target: null`, `rel: null`; no link to `/?view=service`.
- Headings: service page `["H1:Service status.", "H3:…" for each alert, "H1:Account"]`; popover `["H1:Service attention", "H3:…" for each alert]`.
- Bell width: 36 px (no alerts), 55 px (1 or 7), 62 px ("50+"), 44 px (unavailable). The left edge moves from 1283 px to 1257 px. Badge: 10 px text, 15 × 20 px, contrast 7.04:1 (dark) and 9.05:1 (light).
- Pull page: back link 424 to 1016 px (592 px wide), card 424 to 1016 px, heading left 453 px, status text left 501 px. The pending status frame background equals the card background. Header controls: `["Visonaut review queue", "Review queue", "Run history", "Service status"]`. "Open on GitHub": `target: null`.
- Text contrast with alpha applied (computed from the sampled colors): failed block body 6.60:1 (dark) and 6.77:1 (light); pending body 6.97:1 (dark) and 5.73:1 (light). No text contrast failure.

**M13. SSR content.** `curl -s "http://127.0.0.1:4310/pulls/7?check=…"` contains "Finding this pull request's visual review…" and `<title>Visonaut</title>`. `curl -s "http://127.0.0.1:4310/?view=service"` contains "Checking access and loading runs…". The preview API returns `403 {"error":{"code":"preview_fixtures_only",…}}` for `/api/pulls/7` and `{"events":[],"checkedAt":0,"hasMore":false}` for `/api/operations`.

## Open questions and items not verified

- Production timings. No production or remote measurement was made. The D1 and GitHub round-trip counts in PULL-01 and PULL-04 come from code. The number of D1 queries inside `auth.api.getSession` was not counted ("at least 1").
- The claim that an idle alert poll always misses the 60 s permission cache (PULL-04) is from code reading. It also assumes that the request reaches an isolate that holds the cache. Not measured.
- The row count of `operations_events` in production is unknown. The full-scan cost in PULL-04 depends on it.
- Whether production behaves differently from dev for the double effect fetch (StrictMode) was not verified. The audit assumes single fetches in production.
- Whether `https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md` is readable by every user who can sign in (PULL-22) was not checked.
- Whether a `failed` pre-run check can become ready again under the same external ID was checked only by reading the state updates (`apps/web/src/api/pre-run-checks.ts:110`, `apps/web/src/api/pre-run-attempts.ts:84`, `:633`, `:998`, `:1030`). I found no path back to `active`. A maintainer should confirm.
- The exact situations behind `state: "pending"` (PULL-17) were derived from the handler. I did not trace every writer of `pre_run_checks`.
- The existing `apps/web/dist` output was used for chunk sizes. I did not confirm that it was built from the current commit.
- The mobile captures use a 390 × 844 viewport with touch enabled in desktop Chrome. Real device rendering was not tested.
- I did not test with a screen reader. The accessibility findings come from the DOM and the code.
- The contract (`docs/current-contract.md:186`) limits permission reuse to 60 s for private reads. The options in PULL-01 and PULL-04 keep that rule, but the maintainer must confirm that a server-side lookup during document rendering counts as a private read.
- `docs/review-guide.md` documents the visible strings "Refresh alerts", "Retry alerts", "Open the operations and recovery guide", and "No unresolved operation alerts". A redesign changes them, so the guide must change with it.

## Screenshots

Individual captures are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-pull-ops/screens/`. Each file name is `<state>--<viewport>-<scheme>.png`, with `desktop` (1440 × 900) or `mobile` (390 × 844), and `dark` or `light`. "4" in the tables means all four combinations. Contact sheets (desktop and mobile side by side, one for each state and scheme) are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-pull-ops/sheets/<state>--<scheme>.png`. There are 166 captures and 74 sheets. I read every contact sheet, so I saw every capture.

Pull request page (app on port 4310 with intercepted `/api/pulls`):

| State file prefix                     | Variants                  | Caption                                                              |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `pull-01-loading`                     | 4                         | Loading state. The same content that SSR sends.                      |
| `pull-02-guest`                       | 4                         | HTTP 401. Sign-in card. The "primary" button is gray.                |
| `pull-03-guest-signing-in`            | 4                         | After a click on sign-in: disabled "Opening GitHub…".                |
| `pull-04-sign-in-failed`              | 4                         | Sign-in request failed: heading "Review unavailable", "Retry".       |
| `pull-05-forbidden`                   | 4                         | HTTP 403: "Repository access required", only "Use another account".  |
| `pull-06-check-not-found`             | 4                         | HTTP 404: tells the user to open GitHub, has no GitHub link.         |
| `pull-07-service-unavailable`         | 4                         | HTTP 503: "The pull request could not be loaded. Please retry."      |
| `pull-08-pending`                     | 4                         | Waiting for screenshots. Centered back link, invisible status frame. |
| `pull-09-capture-failed`              | 4                         | Failed capture: saturated yellow block, "Check again".               |
| `pull-10-not-required`                | 4                         | Docs-only pull request: "No visual review needed."                   |
| `pull-11-preview-environment-default` | 4                         | Preview without interception: false "Repository access required".    |
| `pull-12-ready-redirected-to-run`     | 4                         | Ready: the page redirected to the run workspace.                     |
| `pull-13-invalid-pull-number`         | desktop-dark, mobile-dark | `/pulls/abc`: the eyebrow shows "PULL REQUEST #ABC".                 |
| `pull-14-harness-pending`             | desktop-dark              | The same pending state in the fixture harness on port 4311.          |

Service status page (`/?view=service`, intercepted `/api/runs` and `/api/operations`):

| State file prefix                        | Variants                             | Caption                                                                                                          |
| ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `svc-01-preview-environment-default`     | 4                                    | Preview without interception: "Last checked Dec 31, 1969". The preview note is not aligned with the page column. |
| `svc-02-loading-runs`                    | 4                                    | Waiting for `/api/runs`: "Checking access and loading runs…", no account menu.                                   |
| `svc-03-loading-alerts`                  | 4                                    | Run list ready, alerts loading: two loading texts.                                                               |
| `svc-04-empty`                           | 4                                    | No alerts, no capacity: nine text blocks.                                                                        |
| `svc-05-empty-with-capacity`             | 4                                    | No alerts, capacity sentence above the empty card.                                                               |
| `svc-06-one-alert`                       | 4                                    | One alert. The column is wider than in the empty state.                                                          |
| `svc-07-many-alerts-with-capacity`       | 4, full page                         | Seven alerts of six kinds, and capacity.                                                                         |
| `svc-08-details-open`                    | 4, full page                         | Two alerts with "Technical details" open.                                                                        |
| `svc-09-fifty-alerts-has-more`           | desktop-dark, mobile-dark, full page | Fifty alerts with `hasMore`.                                                                                     |
| `svc-10-alerts-unavailable-first-load`   | 4                                    | `/api/operations` fails on first load. The error text has no danger color.                                       |
| `svc-11-refresh-failed-cached-alerts`    | 4, full page                         | Refresh failed after a good load: stale alerts and "Retry alerts".                                               |
| `svc-12-run-list-failed-hides-status`    | 4                                    | `/api/runs` fails: the service page shows a queue error only.                                                    |
| `svc-13-access-denied-on-alerts`         | 4                                    | `/api/operations` returns 403: the whole page is replaced.                                                       |
| `svc-14-guest`                           | 4                                    | `/api/runs` returns 401 on the service view: marketing hero.                                                     |
| `svc-15-unmapped-alert-kinds`            | desktop-dark, mobile-dark, full page | Five real alert kinds with no specific text: five identical cards.                                               |
| `svc-16-malformed-capacity-hides-alerts` | desktop-dark                         | Bad capacity value: all seven alerts hidden.                                                                     |

Header popover and bell (queue page `/` with a non-preview run list):

| State file prefix                              | Variants                        | Caption                                                                                   |
| ---------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| `pop-01-closed-no-alerts`                      | 4                               | Queue with the bell closed. The bell and the nav link "Service status" are in one header. |
| `pop-02-open-no-alerts`                        | 4                               | Popover, no alerts: four text blocks to say "all clear".                                  |
| `pop-03-open-one-alert`                        | 4                               | Popover with one alert.                                                                   |
| `pop-04-open-many-alerts-with-capacity`        | 4                               | Popover with seven alerts: two visible on desktop, one on mobile.                         |
| `pop-05-open-fifty-has-more`                   | desktop-dark, mobile-dark       | Popover with fifty alerts. Badge "50+".                                                   |
| `pop-06-open-loading`                          | 4                               | Popover while the first request is pending.                                               |
| `pop-07-open-unavailable-first-load`           | 4                               | Popover with a failed first load. The bell shows "!" in the text color.                   |
| `pop-08-open-refresh-failed-cached`            | 4                               | Popover with stale alerts after a failed refresh. The bell shows the count and "!".       |
| `pop-09-open-details-expanded`                 | desktop-dark, mobile-dark       | Popover with "Technical details" open.                                                    |
| `pop-10-harness-bare-fixture`                  | desktop-dark, desktop-light     | The operations fixture on port 4311: no Shell around the bell.                            |
| `trigger-01-no-alerts` to `trigger-06-loading` | 4 each, header strip 64 px high | Bell states: none, 1, 7, 50+, unavailable, loading. Sheet: `sheets/triggers.png`.         |

## Redesign ideas

The ideas below are for the design-exploration phase. Primitive names refer to the vendored copy when it has the part (`Shell`, `Frame`, `Text`, `Button`, `Badge`, `Table`, `Disclosure`, `Popover`, `Nav`), and to upstream (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src`) for `Heading`, `List`, `Progress`, `Separator`, `Tooltip`, `Link`, `Code`, and `Dialog`.

Sample data for the design lab. These are real kinds and codes from the emitters (see PULL-12). The titles are proposals.

```ts
const alerts = [
  {
    kind: "check-delivery",
    code: "exhausted",
    system: "GitHub checks",
    severity: "high",
    affectsReviews: true,
    title: "Check delivery failed",
    subject: "run #5123",
    since: "14:55",
    lastSeen: "4 min ago",
    count: 14,
  },
  {
    kind: "upstream-webhook",
    code: "redelivery-exhausted",
    system: "Webhooks",
    severity: "high",
    affectsReviews: true,
    title: "Webhook redelivery failed",
    subject: "delivery 3f2a1c9e",
    since: "12:30",
    lastSeen: "12 min ago",
    count: 3,
  },
  {
    kind: "database-capacity",
    code: "headroom-warning",
    system: "Database",
    severity: "medium",
    affectsReviews: false,
    title: "Database above warning level",
    subject: "79% of 2 GiB",
    since: "Oct 3",
    lastSeen: "3 min ago",
    count: 576,
  },
  {
    kind: "comparison-task",
    code: "attempts-exhausted",
    system: "Comparison",
    severity: "medium",
    affectsReviews: true,
    title: "Comparison retries used",
    subject: "comparison 0b7d0e3c",
    since: "15:30",
    lastSeen: "35 min ago",
    count: 5,
  },
  {
    kind: "staged-reconciliation",
    code: "retry-delayed",
    system: "Capture and ingest",
    severity: "low",
    affectsReviews: false,
    title: "Capture upload waits for retry",
    subject: "workflow run 18244077123, attempt 2",
    since: "13:30",
    lastSeen: "55 min ago",
    count: 3,
  },
  {
    kind: "promotion",
    code: "original-missing",
    system: "Baseline",
    severity: "high",
    affectsReviews: false,
    title: "Baseline update blocked",
    subject: "snapshot a9c1f3d2",
    since: "11:30",
    lastSeen: "58 min ago",
    count: 60,
  },
  {
    kind: "staged-retention",
    code: "delete-failed",
    system: "Storage",
    severity: "low",
    affectsReviews: false,
    title: "Staged upload cleanup failed",
    subject: "scheduler",
    since: "04:30",
    lastSeen: "5 min ago",
    count: 144,
  },
];
const capacity = {
  databaseBytes: 1.57 * 2 ** 30,
  warningBytes: 1.5 * 2 ** 30,
  admissionBytes: 2 * 2 ** 30,
  activeRuns: 2,
  maximumActiveRuns: 5,
};
const pull = {
  number: 5123,
  title: "Fix Combobox popover flipping on small viewports",
  repository: "ariakit/ariakit",
  commit: "4f1c9e0",
  attempt: 2,
  stage: "capturing",
  shards: { done: 5, total: 8 },
  startedAgo: "2 min",
};
```

### Pull request page: page designs

#### P1 · No page: the check link opens the review, and "not ready" is a state of the run workspace

- What changes: `/pulls/:n?check=` resolves on the server. When a run exists (sealed or not), the browser gets the run route. The run workspace shows its normal chrome with a centered stage message in the image area. Only "no run yet", "not required", and access problems need a small standalone screen.
- Why it is better: One design for "capture not ready" instead of two (queue row, pull card). No throwaway screen. The reviewer sees the real workspace frame fill in.
- Sketch:
  ```
  ┌ visonaut. ariakit/ariakit        Review queue  Run history  Service status      ● @diegohaz ┐
  ├ ← Queue  #5123 Fix Combobox popover flipping            capturing · attempt 2 · 4f1c9e0 ────┤
  │ SCREENSHOTS      │                                                                          │
  │ ░░░░░░░░░░░░░░   │                 ◷  Capturing screenshots                                 │
  │ ░░░░░░░░░░░░░░   │                 5 of 8 shards uploaded · started 2 min ago               │
  │ ░░░░░░░░░░░░░░   │                 ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░                                      │
  │ (skeleton rows)  │                 View workflow run ↗                                      │
  └──────────────────┴──────────────────────────────────────────────────────────────────────────┘
  ```

#### P2 · Pipeline stepper card

- What changes: A compact block with the pull request title, a meta row, and four steps: Plan, Capture, Compare, Review. The current step has one line of detail. One primary action that becomes enabled when the review is ready (and the page opens it automatically).
- Why it is better: It replaces "Waiting for screenshots." with the actual stage. The failed state points at the step that failed. It uses `List` with `ListItem checked` and `progress`.
- Sketch:
  ```
  #5123  Fix Combobox popover flipping on small viewports
  ariakit/ariakit · 4f1c9e0 · attempt 2                                  Open on GitHub ↗

   ✓  Plan        visual changes expected
   ◐  Capture     5 of 8 shards · 2 min
   ○  Compare
   ○  Review

  [ Open review ]  (disabled until ready)                       Checked 5 s ago ⟳
  ```
  ```tsx
  <ShellMainContent>
    <Heading>#5123 Fix Combobox popover flipping on small viewports</Heading>
    <Text className="ak-ink-60">
      ariakit/ariakit · <Code>4f1c9e0</Code> · attempt 2
    </Text>
    <List>
      <ListItem checked>
        Plan <Text className="ak-ink-60">visual changes expected</Text>
      </ListItem>
      <ListItem progress={5 / 8}>
        Capture <Text className="ak-ink-60">5 of 8 shards · 2 min</Text>
      </ListItem>
      <ListItem>Compare</ListItem>
      <ListItem>Review</ListItem>
    </List>
    <Button $layer="brand" disabled={!ready}>
      Open review
    </Button>
  </ShellMainContent>
  ```

#### P3 · One status line, no card

- What changes: No card, no icon tile, no eyebrow, no back link. A centered status mark, one sentence, one meta line, one action. About 12 words.
- Why it is better: The smallest text volume. The page is seen for a few seconds, so it must read in one glance. The same layout works for every state (loading, waiting, failed, not required, sign-in, denied).
- Sketch:
  ```
                         ◷
               Waiting for screenshots
     #5123 Fix Combobox popover flipping · 4f1c9e0 · attempt 2
                  checked 5 s ago · opens automatically

                    [ View on GitHub ↗ ]
  ```
  Failed:
  ```
                         ✕
                Visual capture failed
     #5123 Fix Combobox popover flipping · 4f1c9e0 · attempt 2

        [ Open failing workflow run ↗ ]   View pull request
  ```
  Not required:
  ```
                         ✓
               No visual review needed
          #5123 changes documentation only

                    [ Back to GitHub ↗ ]
  ```

#### P4 · A real pull request page with all its visual runs

- What changes: `/pulls/:n` works without `check`. It shows the pull request title and a table of every visual run for that pull request (commit, attempt, state, pending count, time). The row of the opened check is marked. The newest ready run has the primary action.
- Why it is better: It fixes stale links (PULL-06). It connects the page to the queue and the run page: the queue row can link here, and the run page can link back. It uses `Table`.
- Sketch:
  ```
  #5123  Fix Combobox popover flipping on small viewports          Open on GitHub ↗
  ariakit/ariakit · 3 visual runs

   Commit    Attempt  State             Views        When
   a81b6c2   1        ◐ Capturing       —            2 min ago      ← this check
   4f1c9e0   2        ● Needs review    6 pending    1 h ago        [ Review ]
   4f1c9e0   1        ○ Superseded      —            2 h ago
  ```

#### P5 · The queue with the pull request pinned

- What changes: When the review is not ready, the page is the queue. A pinned first row shows this pull request and its stage. The rest of the queue is below, so the reviewer can do other work while waiting. When the run is ready the pinned row becomes "Review now".
- Why it is better: No dead time. One list design for all "in progress" items. The "Review queue" back link is not needed.
- Sketch:
  ```
  ┌ From GitHub ───────────────────────────────────────────────────────────────┐
  │ ◐ #5130 Add Tooltip arrow offset option   capturing · 5/8 shards · 2 min    │
  │   This row opens the review when it is ready.            View on GitHub ↗  │
  └────────────────────────────────────────────────────────────────────────────┘
  Ready to review (1)
   ● #5123 Fix Combobox popover flipping   6 pending · 1 rejected      Review →
  In progress (1)
   ◐ #5131 Refactor Select store            comparing
  ```

#### P6 · Shared access gate (one component for all three routes)

- What changes: One component for "sign in" and "access denied" on the dashboard, the run page, and the pull page. Fixed slots: target, account, primary action, secondary action.
- Why it is better: One design and one text set instead of three (PULL-18). It shows the refused account.
- Sketch:
  ```
  Sign in to review #5123                     Access required
  ariakit/ariakit                             ariakit/ariakit
                                              Signed in as @octocat. This account
  [  Sign in with GitHub  ]                   has no write access.

                                              [ Use another account ]   Try again
  ```

### Service status: page designs

#### S1 · Status board by system

- What changes: Fixed rows for the systems of the service: GitHub checks, Webhooks, Capture and ingest, Comparison, Baseline, Storage, Database. Each row has a status mark, a short state, and the number of open alerts. A row opens to its alerts. One line at the top states the overall result. Unknown alert kinds go to "Other".
- Why it is better: The all-clear state shows what is watched, without a disclaimer. With alerts, the reader sees at once which part is affected. It needs the `system` field of the catalogue (PULL-12).
- Sketch:
  ```
  Service status                                        checked 12 s ago  ⟳  ⓘ
  ▲ 2 systems need attention

   ●  GitHub checks       2 alerts · since 14:55                     ⌄
        Check delivery failed · run #5123 · 14 attempts · 4 min ago
        Check creation ambiguous · 4f1c9e0 · 30 min ago
   ●  Webhooks            Operational
   ●  Capture and ingest  Operational
   ●  Comparison          Operational
   ●  Baseline            Operational
   ●  Storage             1 alert · since 04:30                      ⌄
   ◔  Database            79% of 2 GiB · 2 of 5 captures   ▓▓▓▓▓▓▓▓░░
  ```
  ```tsx
  <DisclosureGroup>
    {systems.map((system) => (
      <Disclosure
        key={system.id}
        button={<SystemRow system={system} />}
        disabled={!system.alerts.length}
      >
        <List>
          {system.alerts.map((alert) => (
            <AlertLine key={alert.id} alert={alert} />
          ))}
        </List>
      </Disclosure>
    ))}
  </DisclosureGroup>
  ```

#### S2 · Incident table

- What changes: A dense `Table`: severity, alert, subject (a link), first seen, last seen, count. A row expands to recovery steps and identifiers. Filter chips for system and severity. Sort by last seen.
- Why it is better: It scales to 50 rows on one or two screens (the current design needs about 6000 px for 50 alerts). The operator can scan times and counts in columns.
- Sketch:
  ```
  Service status · 7 open alerts                         [All] [Checks 2] [Storage 1] …   ⟳

      Alert                       Subject                 Since      Last seen   Count
   ▲  Check delivery failed       run #5123 ↗             1 h 31 m   4 min ago   14
   ▲  Webhook redelivery failed   delivery 3f2a1c9e ↗     4 h        12 min ago  3
   △  Database near limit         79% of 2 GiB            2 d        3 min ago   576
   △  Comparison retries used     comparison 0b7d0e3c ↗   1 h        35 min ago  5
   ⌄ expanded row: what it means for reviews · steps 1-3 · kind/code/subject (copy)
  ```
  ```tsx
  <Table
    caption={{ children: "Open alerts", className: "sr-only" }}
    container={{ $layer: true, $lighten: true, $border: true, $rounded: "xl" }}
    $borderBlock
  >
    <TableRowGroup group="head">
      <TableRow>
        <TableCell>Alert</TableCell>
        <TableCell>Subject</TableCell>
        <TableCell>Since</TableCell>
        <TableCell>Last seen</TableCell>
        <TableCell>Count</TableCell>
      </TableRow>
    </TableRowGroup>
    <TableRowGroup>
      {alerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} />
      ))}
    </TableRowGroup>
  </Table>
  ```

#### S3 · Master and detail (inbox)

- What changes: A list of compact alert rows on the left and a detail pane on the right. The detail has: what happened, effect on reviews, numbered recovery steps, links (workflow run, GitHub App deliveries, run page), and identifiers in `Code` with a copy button. On mobile the list opens the detail as a second screen.
- Why it is better: It is the same pattern as the review workspace (list and viewer), so the app feels like one product. Prose is shown for one alert at a time.
- Sketch:
  ```
  ┌ Alerts (7) ───────────────┬ Check delivery failed ──────────────────────────────┐
  │ ▲ Check delivery failed   │ GitHub checks · since 14:55 (1 h 31 m) · 14 attempts │
  │   run #5123 · 4 min       │                                                       │
  │ ▲ Webhook redelivery …    │ Effect on reviews                                     │
  │   3f2a1c9e · 12 min       │ Approvals on run #5123 do not reach the GitHub check. │
  │ △ Database near limit     │                                                       │
  │   79% · 3 min             │ What to do                                            │
  │ △ Comparison retries …    │ 1. Open the GitHub App installation ↗                 │
  │   0b7d0e3c · 35 min       │ 2. Check the "Checks: write" permission               │
  │ …                         │ 3. The scheduler retries every 5 minutes              │
  │                           │                                                       │
  │ ◔ Database 79%            │ check-delivery · exhausted · 71402233915        ⧉    │
  └───────────────────────────┴───────────────────────────────────────────────────────┘
  ```

#### S4 · Health header and timeline

- What changes: Three stat tiles at the top (open alerts, database headroom as a meter, active captures as "2 of 5"). Below, one time-ordered list of alert events with a guide line (`List` with markers). Resolved events of the last 24 hours are in a collapsed group. That group needs an API change to return recent resolved rows.
- Why it is better: It shows recency and trend, not only a snapshot. Capacity becomes a first-class number instead of a caption.
- Sketch:
  ```
  ┌ Open alerts ┐  ┌ Database ──────────────┐  ┌ Captures ┐
  │      7      │  │ 1.57 of 2 GiB  ▓▓▓▓▓▓░ │  │  2 of 5  │
  └─────────────┘  └─ warns at 1.5 GiB ─────┘  └──────────┘

  Today
   16:26 ● Check delivery failed · run #5123 · still failing (14×)
   16:18 ● Webhook redelivery failed · delivery 3f2a1c9e
   15:55 ● Comparison retries used · comparison 0b7d0e3c
  Earlier
   Oct 3 ● Database above warning level · 79%
  ▸ Resolved in the last 24 h (3)
  ```

#### S5 · Quiet by default

- What changes: With no alerts the page is one line and the capacity meter. With alerts it is a list of one-line rows. The guide link moves into each alert. The three disclaimers move behind one ⓘ control.
- Why it is better: The smallest text volume: 6 words in the normal state against 64 today.
- Sketch:
  ```
  Service status
  ● All clear · checked 12 s ago  ⟳  ⓘ
  Database  ▓▓▓▓▓▓▓▓░░  79% of 2 GiB      Captures 2 of 5
  ```
  With alerts:
  ```
  Service status
  ▲ 2 alerts · checked 12 s ago  ⟳  ⓘ
   ▲ Check delivery failed · run #5123 · 4 min ago            Steps ⌄
   △ Database near limit · 79% of 2 GiB · 3 min ago           Steps ⌄
  ```

### Service status: entry point in the header

#### T1 · Status dot on the nav link, no bell

- What changes: Remove the bell. The "Service status" nav item gets a small dot or a count when alerts are open.
- Why it is better: One entry point and one name (PULL-16). The header keeps a fixed width (the bell changes from 36 px to 62 px today).
- Sketch:
  ```
  Review queue   Run history   Service status ●2                          ● @diegohaz
  ```

#### T2 · Health pill with a short preview popover

- What changes: A pill in the header end slot: "● All clear" (muted, or hidden) or "▲ 2 alerts". The popover shows at most three one-line rows and a link to the page. No prose in the popover.
- Why it is better: The popover becomes a preview: about 20 words instead of 244, and it links to the page.
- Sketch:
  ```
                                         [ ▲ 2 alerts ]
  ┌ Service status ─────────────── ✕ ┐
  │ ▲ Check delivery failed · 4 min   │
  │ △ Database near limit · 3 min     │
  │ Open service status →             │
  └───────────────────────────────────┘
  ```

#### T3 · Page banner only for alerts that affect reviews

- What changes: No bell and no popover. When an open alert has `affectsReviews`, every page (queue, run, pull) shows one slim band under the header with one sentence and a link.
- Why it is better: Reviewers see only what changes their work, in the place where they work. The run page and the pull page have no service signal today.
- Sketch:
  ```
  ┌ visonaut. … Review queue  Run history  Service status ───────────────────────────────┐
  ├ ▲ Check delivery is failing. Decisions are saved, GitHub can show an old state. Details → ┤
  ```
  ```tsx
  <ShellMainHeader $layer="warning" $sticky>
    <Text>Check delivery is failing. Decisions are saved, GitHub can show an old state.</Text>
    <Button render={<Link to="/status" />}>
      <ButtonLabel>Details</ButtonLabel>
    </Button>
  </ShellMainHeader>
  ```

#### T4 · Keep the trigger, but as a compact list with relative times

- What changes: The smallest change. The same trigger and popover, with one-line rows, a relative time for each row, the count overlaid on the icon (fixed button width), an activity icon in place of the bell, `PopoverScroll` for the list, and a footer link "View all (7)".
- Why it is better: It fixes the visible defects without a new navigation concept.
- Sketch:
  ```
  ┌ Service status ──────────── ⟳ ✕ ┐
  │ ▲ Check delivery failed    4 min │
  │ ▲ Webhook redelivery …    12 min │
  │ △ Database near limit      3 min │
  │ △ Comparison retries …    35 min │
  │ +3 more · View all →             │
  └──────────────────────────────────┘
  ```

### Component variants

#### C1 · Alert item (four densities)

- What changes: One alert data shape, four renderings to compare side by side.
- Why it is better: The design lab can compare density directly with the same seven alerts.
- Sketch:
  ```
  (a) One line     ▲ Check delivery failed · run #5123 · 4 min ago                    ⌄
  (b) Two lines    ▲ Check delivery failed                                  4 min ago
                     run #5123 · 14 attempts since 14:55 · approvals do not reach GitHub
  (c) Card         title + effect sentence + numbered steps + identifiers
  (d) Table row    severity │ title │ subject link │ since │ last seen │ count
  ```

#### C2 · Capacity (four forms)

- What changes: Replace the two-sentence block with a meter.
- Why it is better: "79%" and a bar read faster than "1612.4 MiB used; 435.6 MiB before new runs pause".
- Sketch:
  ```
  (a) Bar     Database  ▓▓▓▓▓▓▓▓░░  1.57 of 2 GiB · warns at 1.5 GiB
  (b) Ring    ◔ 79%  Database        ◔ 2/5  Captures
  (c) Tiles   two stat tiles, as in S4
  (d) Inline  Database 79% · Captures 2 of 5        (text only, in the status line)
  ```
  ```tsx
  <Progress value={databaseBytes / admissionBytes} aria-label="Database capacity" $thickness={3} />
  <div className="size-12"><ProgressCircular value={activeRuns / maximumActiveRuns} aria-label="Active captures" /></div>
  ```

#### C3 · Overall status line

- What changes: One component for the first line of the page and of the popover, with four states.
- Why it is better: It replaces the summary sentence, the empty card, and the error paragraph with one element that always sits in the same place.
- Sketch:
  ```
  ● All clear · checked 12 s ago
  ▲ 2 alerts · checked 12 s ago
  ? Status unknown · last good check 16:26 · Retry
  ◌ Checking…
  ```

#### C4 · Technical details

- What changes: Replace `<details>` with a `Disclosure`, and show identifiers as a small key and value list with `Code` and a copy button.
- Why it is better: The values line up, the subject can be copied, and the time shows age and count.
- Sketch:
  ```
  ⌄ Details
    Kind      check-delivery
    Code      exhausted
    Subject   71402233915                 ⧉
    Since     Oct 5, 14:55 (1 h 31 m)
    Seen      14 times, last 4 min ago
  ```

#### C5 · Status trigger (four forms)

- What changes: Four forms of the header trigger to compare.
- Why it is better: The lab can test fixed width, wording, and icon meaning in the real header.
- Sketch:
  ```
  (a) Icon with overlaid count     [ ⌁² ]      fixed 36 px
  (b) Pill with text               [ ▲ 2 alerts ]
  (c) Dot on the nav item          Service status ●
  (d) No trigger, banner only      (see T3)
  ```

#### C6 · Refresh control and freshness

- What changes: Replace the button whose label changes ("Refresh alerts", "Checking alerts…", "Retry alerts") with an icon button and a freshness text that counts up.
- Why it is better: The control keeps its width and position. The freshness text answers "is this current?" without a click.
- Sketch:
  ```
  checked 12 s ago  ⟳      →      checking…  ◌      →      could not refresh · retry ⟳
  ```

#### C7 · Pull request stage indicator (three forms)

- What changes: Three forms of the stage display for the pull request page and for "In progress" rows in the queue.
- Why it is better: The same component can serve the pull page, the queue row, and the run page header.
- Sketch:
  ```
  (a) Vertical stepper     ✓ Plan / ◐ Capture 5 of 8 / ○ Compare / ○ Review
  (b) Horizontal segments  Plan ━━ Capture ━━ Compare ── Review
  (c) Single progress bar  ▓▓▓▓▓▓▓▓░░░░░░░  Capture · 5 of 8 shards
  ```

#### C8 · State message (one pattern for empty, error, denied, and not found)

- What changes: One small component with an icon, a title, one sentence, and at most two actions. It replaces the pull card, the dashboard error card, the run error card, and the empty alert card.
- Why it is better: Four hand-made cards become one pattern with one width rule (PULL-11, PULL-18, PULL-19).
- Sketch:
  ```
        ✕                              ⃠                               ?
  Review not found            Access required                 Could not load
  This check link is old.     @octocat has no write access.   The service did not answer.
  [ Open pull request ↗ ]     [ Use another account ]         [ Try again ]
  ```
