# Verification: Pull request page and service status (operations attention)

Lane key: `ui-pull-ops`. Verified report: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-pull-ops/report.md`. Verification date: 2026-10-05. Read-only.

Method:

- I opened each cited file and compared the quoted lines with the source.
- I ran my own scripts against the dev server on port 4310 (Chrome through Playwright). I did not reuse the auditor's output. Scripts and raw output are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-pull-ops/verify/` (`verify.mjs`, `verify-output.json`, `popover.mjs`, `popover-output.json`, `popover2.mjs`, `waterfall.mjs`, `words.mjs`, `plan-index.mjs`, `tw-token.mjs`).
- I read 16 of the auditor's screenshots. Each one shows what its caption says.
- Root for relative paths: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`.

Limits that apply to all re-measurements: the server is the Vite dev server in preview mode. React StrictMode sends each effect request two times. Absolute times are not production times.

Summary of verdicts:

| ID      | Verdict                                      | Auditor severity | My severity |
| ------- | -------------------------------------------- | ---------------- | ----------- |
| PULL-01 | partly-confirmed                             | high             | medium      |
| PULL-02 | confirmed                                    | high             | medium      |
| PULL-03 | confirmed, recommendation needs a guard      | medium           | medium      |
| PULL-04 | partly-confirmed                             | medium           | low         |
| PULL-05 | confirmed                                    | medium           | medium      |
| PULL-06 | confirmed                                    | medium           | medium      |
| PULL-07 | confirmed                                    | medium           | medium      |
| PULL-08 | confirmed                                    | low              | low         |
| PULL-09 | confirmed, impact too strong for dark scheme | high             | medium      |
| PULL-10 | confirmed                                    | medium           | medium      |
| PULL-11 | confirmed, one wrong citation                | medium           | low         |
| PULL-12 | confirmed                                    | medium           | medium      |
| PULL-13 | confirmed                                    | low              | low         |
| PULL-14 | confirmed                                    | high             | medium      |
| PULL-15 | confirmed, word count off by 6               | medium           | medium      |
| PULL-16 | confirmed                                    | medium           | medium      |
| PULL-17 | confirmed                                    | medium           | medium      |
| PULL-18 | confirmed                                    | medium           | medium      |
| PULL-19 | confirmed                                    | low              | low         |
| PULL-20 | confirmed                                    | medium           | medium      |
| PULL-21 | partly-confirmed                             | medium           | low         |
| PULL-22 | confirmed                                    | medium           | medium      |
| PULL-23 | confirmed                                    | low              | low         |
| PULL-24 | confirmed                                    | low              | low         |

No finding is refuted in full. Three findings contain a factual error that changes priority or the recommendation: PULL-01, PULL-04, and PULL-21.

## PULL-01 · The pull request page is a client-side redirect hop in front of every review

- Verdict: partly-confirmed.
- Corrected severity: medium (auditor: high).
- Confirmed:
  - `apps/web/src/routes/pulls.$pullNumber.tsx:47-58` starts the lookup in `useEffect`. Line 82 is `await navigate({ to: "/runs/$runId", params: { runId }, replace: true });`.
  - `apps/web/src/api/review.ts:742-772` runs two D1 queries in sequence.
  - `apps/web/src/api/pre-run-checks.ts:508-514` sets the first `details_url` to `/pulls/<n>?check=<id>`.
  - Request order and the cost of the hop. `node verify/waterfall.mjs`, two runs each:
    ```
    pull   delay=300: visible at 1326ms | /pulls/7 · 256ms /api/pulls/7 · 563ms /api/runs/<id>
    direct delay=300: visible at  825ms | /runs/<id> · 227ms /api/runs/<id>
    pull   delay=0:   visible at  542ms    direct delay=0: visible at 537ms
    ```
  - Chunk sizes: `gzip -c apps/web/dist/client/assets/runs._runId-QUJlDVZ1.js | wc -c` gives `43939`. `badge.ariakit.react` gives `19381`.
  - SSR HTML contains "Finding this pull request’s visual review…" (`curl` against port 4310).
- Not confirmed. The report says: "this page is the first screen for almost every reviewer who comes from GitHub" and "before every review that starts from GitHub". The code says something different:
  - `apps/web/src/operations/checks.ts:28-30`:
    ```ts
    function reviewDetailsUrl(run: { id: string }, origin: string) {
      return new URL(`/runs/${encodeURIComponent(run.id)}`, origin).href;
    }
    ```
  - `apps/web/src/operations/checks.ts:211-217` prepares a status intent with that URL for each eligible run.
  - `packages/security/src/checks.ts:188-195` sends it to the same GitHub check: `body: JSON.stringify({ name: CHECK_NAME, details_url: href, … })`. `reviewUrl()` at `:28-41` accepts only `/runs/<id>`.
  - `packages/service/src/run-admission.ts:202-206` binds the pre-run check to the run (`INSERT INTO operations_check_creations … 'complete'`), so the status delivery updates the check that had the `/pulls/` link.
  - `apps/web/src/api/ingest.ts:59-63` sends `{ kind: "status" }` when the comparison becomes ready for review. `apps/web/src/operations/index.ts:62` runs `checks` for a status message.
  - Test: `apps/web/src/operations/operations.test.ts:240-252`, "opens the exact run from check creation and later status delivery", expects `details_url` to be `https://visonaut.example/runs/run`.
  - `docs/current-contract.md:236`: "The single App check links to the review run and updates after durable decisions settle."
- Result: the "Details" link on GitHub goes to `/pulls/…` only until the first status delivery for the run. After that it goes to `/runs/<id>`. The pull request page is mainly a waiting room. The hop affects a user who opens "Details" while the capture runs, a user who clicks in the short time between the seal and the check update, and a user with an old link. The exception is the legacy mirror check (`apps/web/src/operations/review-links.ts:63-67`, skipped for new attempts at `:174`).
- I did not measure how long that window is in production.
- Corrections to the recommendation:
  - A server-side lookup is feasible. The session cookie is `sameSite: "lax"` (`packages/security/src/auth.ts:50`), so the browser sends it on a top-level navigation from github.com. TanStack Start answers a loader `redirect` with an HTTP redirect during SSR (`@tanstack/start-server-core`, `createStartHandler.ts:735-736`: `if (routerInstance._serverResult?.type === 'redirect') return normalizeSsrResponse(…)`).
  - It does not remove a round trip. It replaces the API hop with a second document request. The run route has `ssr: false` (`apps/web/src/routes/runs.$runId.tsx:31`), so the review model still loads from the client after the second document. The gain is: no hydration before the lookup, and no late chunk request.
  - The simplest form is the last alternative in the report: answer `/pulls/:n` with a 302 in `apps/web/src/server.ts` before `render(request)`. It needs no server function.
  - "This is the main path of the 'wait around checking access' complaint in this lane" is not supported by the code. Since GitHub links to `/runs/<id>` after the first delivery, the run route and the dashboard are the common entry points.

## PULL-02 · The service status page waits for the run list, and it disappears when the run list fails

- Verdict: confirmed.
- Corrected severity: medium (auditor: high). The defect is real and cheap to correct. The page is a secondary page with few visits, and the run list must fail alone for the page to disappear.
- Proof:
  - `apps/web/src/routes/index.tsx:356-364` mounts `<OperationsAttention … layout="page" />` only when `state.status === "ready"`. `:321-355` renders "The review queue could not be loaded" for each `/api/runs` failure.
  - `node verify/verify.mjs`, 300 ms added to each API answer:
    ```
    7ms document /?view=service · 290ms fetch /api/runs · 617ms fetch /api/operations · 1390ms visible alert list
    runsFail: { heading: "The review queue could not be loaded", operationsRequests: 0 }
    ```
  - Screenshot `screens/svc-12-run-list-failed-hides-status--desktop-dark.png` shows the queue error on the service view.
- Corrections: none. Note for the option "let `/api/operations` return `repository` and `preview`": the handler already has `context.configuration.github.repository` (`apps/web/src/api/review.ts:779` uses it).

## PULL-03 · Header links to "Service status" reload the document and fetch everything again

- Verdict: confirmed. The recommendation needs a guard.
- Corrected severity: medium.
- Proof:
  - `apps/web/src/components/app-shell.tsx:52-64` passes `href` to `NavLink`. `apps/web/src/components/ariakit/components/nav.ariakit.react.tsx:601` renders `ak.Role.a`.
  - `node verify/verify.mjs`: a click on the header link gives `document /?view=service`, `fetch /api/runs`, `fetch /api/operations`. A click on the in-page router link "View history" gives no request.
- Correction to the recommendation. `AppHeader` is also rendered by `ReviewWorkspace` (`apps/web/src/review/review-workspace.tsx:535`). The fixture harness renders `ReviewWorkspace` with no router (`apps/web/src/review/__tests__/fixture.tsx:146-154` calls `createRoot(element)` and renders the workspace directly). The workspace guards its own router links for that reason (`review-workspace.tsx:749-759`: `route ? <Link … /> : undefined`). An unconditional `<Link>` in `AppHeader` breaks that harness and its browser tests. Use the same guard, or give the fixture a router:
  ```tsx
  // sketch
  <NavLink href={router ? undefined : href} render={router ? <Link to="/" search={search} /> : undefined}>
  ```
- Addition: the logo link is also a plain anchor (`app-shell.tsx:29`, `render={<a href="/" />}`).

## PULL-04 · The alert poll never pauses, misses the permission cache on idle tabs, and scans the whole event table

- Verdict: partly-confirmed.
- Corrected severity: low (auditor: medium). The polls are background requests. They do not slow a page.
- Confirmed:
  - `apps/web/src/components/operations-attention/index.tsx:277-282` has no visibility check. `node verify/verify.mjs` with `document.visibilityState` forced to `hidden` and a fake clock: `{ afterLoad: 2, afterFiveHiddenMinutes: 7 }`.
  - Cache miss on an idle tab, from code: `packages/security/src/authorization.ts:21` (`privateReadLifetime = 60_000`), `:63` (`cached.checkedAt + lifetime > Date.now()`), `:72` (`checkedAt` is set before the GitHub request). The client waits 60 000 ms after the answer (`index.tsx:280`). A cache hit does not renew `checkedAt` (`:64-70`). Not measured.
  - Three sequential reads in `apps/web/src/api/operations.ts:16-18`, `:30-36`, `:45-47`.
  - Query plan: `node --experimental-sqlite verify/plan-index.mjs` gives `SCAN operations_events` and `USE TEMP B-TREE FOR ORDER BY`.
  - No statement deletes from `operations_events` (`rg "operations_events"` in `apps/web/src` and `packages`: only INSERT, UPDATE, and SELECT).
  - The partial index of the recommendation works. With it the plan is `SCAN operations_events USING INDEX operations_events_open` and the temp B-tree is gone. With 200 000 rows and 3 open alerts: 0.007 ms with the index, 4.881 ms without (local SQLite). D1 supports partial indexes: https://developers.cloudflare.com/d1/best-practices/use-indexes/ . D1 bills each scanned row: https://developers.cloudflare.com/d1/platform/pricing/ .
- Corrections:
  - "the cost grows with the age of the deployment" is too strong. `recordEvent` is an upsert on a fixed ID (`apps/web/src/operations/common.ts:20-24`): `` const id = `${input.kind}:${input.subject}:${input.code}` `` with `ON CONFLICT(id) DO UPDATE`. The table has one row for each different kind, subject, and code that ever failed. A repeated failure adds no row. The table grows with the number of different failed subjects.
  - "drop the second project query" is not equivalent. `apps/web/src/api/operations.ts:16-23` reads `ORDER BY id LIMIT 2` and requires `projects.results?.length !== 1` to be false. That is a single-project guard. `assertConfiguredProject` (`apps/web/src/api/context.ts:128-141`) reads only the configured project. Keep the guard, or move it into the batch.
  - "1440 Worker requests" for each tab and day is an upper limit. Browsers slow down or freeze timers in hidden tabs. `docs/review-guide.md:9` already says: "Browser suspension can delay a refresh."
  - "at least 8640 D1 queries" is correct arithmetic (6 × 1440) for that upper limit.

## PULL-05 · One failed background poll ends the waiting state, and waiting has no upper bound

- Verdict: confirmed.
- Corrected severity: medium. After the PULL-01 correction, waiting is the main job of this page, so this finding has more weight than PULL-01.
- Proof:
  - `apps/web/src/routes/pulls.$pullNumber.tsx:93-99` sets `status: "error"` for each failure. `:105-106` stops the poll when the state is not `pending`. `:114` is `timer = setTimeout(refresh, 15_000)`.
  - `node verify/verify.mjs` with a fake clock:
    ```
    pull05: { afterLoad: 2, afterOnePoll: 3, afterFailedPoll: 4,
              headingAfterFailedPoll: "Review unavailable", afterOneMoreMinute: 4, requestsInTenMinutes: 40 }
    ```
- Corrections: none. Addition: a 503 from the API has `Retry-After: 1` (`apps/web/src/api/index.ts:42`, `:82`). The page does not use it.

## PULL-06 · The page is bound to one check attempt and cannot find the current review of the pull request

- Verdict: confirmed.
- Corrected severity: medium.
- Proof:
  - `apps/web/src/api/review.ts:739-741` answers 404 without a valid `check`. `:742-746` selects by `external_id` only.
  - `apps/web/src/api/api.test.ts:832-841` keeps the old check on `ready` and the rerun on `pending`. The test name at `:772` is "keeps a check link on its sealed run after an older merge webhook arrives late". The binding is deliberate. The report says so and asks for a decision.
  - `node verify/verify.mjs`: `/pulls/7` sends `?check=`, gets 404, shows "This Visonaut check was not found. Open the latest check on GitHub.", and has one button, "Retry".
- Corrections: none. `docs/current-contract.md` has no rule for this page (`rg "/pulls/" docs/current-contract.md`: no match), so the contract does not block a "newer attempt exists" notice.

## PULL-07 · Several states are dead ends or give no feedback

- Verdict: confirmed.
- Corrected severity: medium.
- Proof:
  - `pulls.$pullNumber.tsx:70-72` and `:216-223`: the 404 text tells the user to open GitHub, and the only button is "Retry". Screenshot `screens/pull-06-check-not-found--desktop-dark.png` shows it.
  - `node verify/verify.mjs`, "Check again": `{ requestSent: true, markupChangedDuring: false, disabledDuring: false, markupChangedAfter: false }`.
  - `node verify/words.mjs`, failed sign-in: `{ heading: "Review unavailable", message: "Sign-in could not start. Please retry.", buttons: ["Retry"] }`. After "Retry" the heading is "Sign in to review pull request #7".
  - `review.ts:744` reads `workflowRunId` and `workflowAttempt`. `:778-783` does not return them.
- Corrections:
  - "Return `repository` also with 404 and 403 answers" needs a decision for the 403 case. The 403 comes from `requireMaintainer` (`packages/security/src/github.ts:227`), before the handler. It goes to a signed-in user with no write access. The 404 comes after the access check (`review.ts:740`, `:755`), so it is safe there.
  - "A rerun gets a new check ID, so this URL does not become ready" is plausible (`api.test.ts:817`), but I did not prove that `failed` is final for one external ID. The report lists this as not verified. It stays not verified.
  - `workflowRunId` can be `null` for a failed check with no bound workflow run (`review.ts:751`). The "open failing workflow run" link needs a fallback to the pull request.

## PULL-08 · Preview shows false messages on both surfaces

- Verdict: confirmed.
- Corrected severity: low.
- Proof:
  - `curl -s http://127.0.0.1:4310/api/operations` gives `{"events":[],"checkedAt":0,"hasMore":false}`.
  - `curl -s -w "%{http_code}" "http://127.0.0.1:4310/api/pulls/7?check=visonaut:pre:ddd…"` gives `{"error":{"code":"preview_fixtures_only",…}}` and `403`.
  - `apps/web/src/review/preview-fixtures.ts:106-112`. Screenshots `screens/svc-01-…` ("Last checked Dec 31, 1969, 9:00 PM.") and `screens/pull-11-…` ("Repository access required", "Use another account").
  - Preview is a public deployment: `apps/web/wrangler.jsonc:10` (`preview.visonaut.com`) and `docs/current-contract.md:188` ("The public preview serves synthetic read-only fixtures").
- Corrections: none.

## PULL-09 · `$layer="primary"` is not a layer color, so primary buttons are neutral gray

- Verdict: confirmed. The impact text is too strong for the dark scheme.
- Corrected severity: medium (auditor: high).
- Proof:
  - `apps/web/src/components/ariakit/utils/styles.ts:6-13` has no `primary`. `apps/web/src/components/ariakit/components/layer.ariakit.react.tsx:97-100` puts any other string into `--layer-color`.
  - Six uses: `pulls.$pullNumber.tsx:194`, `:226`; `routes/index.tsx:301`, `:310`, `:346`, `:508`.
  - `node verify/verify.mjs`, both schemes: `style="--layer-color: primary; …"`, `CSS.supports("color", "primary")` is `false`, background `oklch(0.949994 0.0000497986 23.7884)` = `rgb(238, 238, 238)`. Brand element: `oklch(0.515341 0.1546 248.516)`. Light card: `rgb(254, 255, 255)`, so 1.16:1 is correct.
  - The first fix works. With `ak-layer-brand` on the live button the background is `rgb(0, 106, 187)` in both schemes.
- Corrections:
  - "Every main call to action … looks like a secondary button" is true only in the light scheme. In the dark scheme the same value is a near-white button on a dark card (`rgb(238, 238, 238)` on `rgb(23, 25, 29)`). It is the strongest element on the screen. See `screens/pull-02-guest--desktop-dark.png` and `screens/svc-13-access-denied-on-alerts--desktop-dark.png`. It is still not the brand color.
  - "The theme defines `--color-primary`" is true in the source (`apps/web/src/components/ariakit/styles/ui.css:6`), but the variable is not in the CSS that the browser gets today: `getComputedStyle(document.documentElement).getPropertyValue("--color-primary")` is `""`. Tailwind 4 emits a theme variable only when something uses it. The second fix (`$layer="var(--color-primary)"`) still works, because Tailwind finds the string in the source file. `node verify/tw-token.mjs` with tailwindcss 4.3.3: a file that contains `var(--color-primary)` gives `emitsColorPrimary: true`; a file with `$layer="primary"` gives `false`. A value that is built at run time does not work.

## PULL-10 · `ak-ink-danger`, `ak-ink-warning`, and `ak-ink-success` do not exist, so error text has no color

- Verdict: confirmed.
- Corrected severity: medium.
- Proof:
  - `apps/web/node_modules/@ariakit/tailwind/src/output.css:816-821`: `ak-ink-*` accepts a number or a bracket value.
  - Six uses: `operations-attention/index.tsx:370`, `:501`; `user-menu.tsx:66`; `routes/index.tsx:271`, `:331`, `:531`.
  - `node verify/verify.mjs`: the alert paragraph is `oklch(1 0 0)` (dark) and `oklch(0 0 0)` (light), the same as the `h1`. No loaded style rule has `ak-ink-danger`, `ak-ink-warning`, or `ak-ink-success` in its selector (`matchingRules: []`).
  - `rg -c "ak-ink-danger" apps/web/dist/client/assets/index-CXm4JU5N.css`: no match.
  - The fix works. With `class="ak-text ak-text-danger"` on the live paragraph the color is `rgb(255, 100, 103)` (dark) and `rgb(197, 31, 23)` (light). `apps/web/src/routes/runs.$runId.tsx:232` already uses these classes.
- Corrections: none.

## PULL-11 · The service page column moves with its content

- Verdict: confirmed. One citation is wrong.
- Corrected severity: low (auditor: medium). It is a one-class defect on a page with few visits.
- Proof: `node verify/verify.mjs` at 1440 px:
  ```
  empty: h1 left 398, panel 643 · one: 372, 696 · two: 290, 861 · many: 272, 896
  ```
  The parent is a grid, and the panel is in the `content` column.
- The minimal alternative works. With `mx-auto` removed and `width: 100%; justify-self: center` on the live panel, all four states give `h1 left 272, panel 896`.
- Correction: the quoted comment at `apps/web/src/components/ariakit/styles/shell.ts:728-733` documents `mainBand` (the parts `ShellMainContent`, `ShellMainPopout`, `ShellMainFeature`, `ShellMainFull`). The panel is a plain child of `ShellMainBody`. The cause is standard grid behavior: an item with auto inline margins does not stretch, so its width is the width of its content. The recommendation is still correct.

## PULL-12 · The alert text catalogue does not match the alerts that the service emits

- Verdict: confirmed.
- Corrected severity: medium.
- Proof: I listed each `recordEvent` call and each direct `INSERT INTO operations_events` (`rg -U "recordEvent\([^)]*?kind"` and `rg "operations_events"`). Kinds with no branch in `recovery()` (`operations-attention/index.tsx:98-199`): `staged-retention`, `runtime`, `history`, `historical-archive`, `webhooks`, `check-aliases`, `staged`, `review-decisions`, `review-links`, `source-retention`. That is ten, as the report says. No code emits `backup` or `backup-retention`. `apps/web/src/capacity.ts:48-52`, `:74-78`, `:81-85` emit three codes, and the UI has one text.
- Corrections and additions:
  - Before the `backup` and `backup-retention` branches are removed, check production for open rows from the retired feature: `SELECT COUNT(*) FROM operations_events WHERE kind IN ('backup','backup-retention') AND resolved_at IS NULL`. Not checked here.
  - `admission-blocked` is also emitted when the active-run limit is reached, not only when the database is full (`capacity.ts:25-30`: `snapshot.activeRuns >= snapshot.maximumActiveRuns`). The UI text speaks only about database size.
  - `docs/current-contract.md:186` requires "an actionable alert" after failed delivery recovery. A generic card for ten kinds does not meet the intent of that sentence.

## PULL-13 · A malformed capacity snapshot hides every alert

- Verdict: confirmed.
- Corrected severity: low.
- Proof: `node verify/verify.mjs` with `capacity: { databaseBytes: 1.5 }` and seven events: `{ alert: "Database capacity could not be read. The current alert state is unknown.", alertCards: 0 }`. Source: `operations-attention/index.tsx:74-94`.
- Addition: the server has the same coupling. `apps/web/src/api/operations.ts:52` calls `JSON.parse(capacity.value)` with no `try`. Invalid JSON in the cursor gives a 503 for the full endpoint.

## PULL-14 · Alert cards do not say what is affected, since when, or how bad it is

- Verdict: confirmed (the facts). The size of the redesign is a design choice.
- Corrected severity: medium (auditor: high). The surface is for operators and has few visits. It is a main source of the "bloated with text" complaint.
- Proof:
  - `operations-attention/index.tsx:397-423`: title, one paragraph, closed `<details>`.
  - `apps/web/migrations/0005_operations.sql:40` has `occurrences`. `apps/web/src/api/operations.ts:31` does not select it.
  - `node verify/popover.mjs`: the popover list is 435 px high for 614 px of content with only 3 alerts.
  - Screenshots `screens/svc-07-…` and `screens/pop-04-…--mobile-dark.png` show what the report says.
- Correction to the recommendation "seen 14 times": two writers do not increase `occurrences`. `packages/service/src/run-retirement.ts:136-142` (`ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, resolved_at = NULL`) and `apps/web/src/operations/recovery.ts:79`. A count in the UI is wrong for those alerts until the writers are aligned.

## PULL-15 · Both surfaces say the same thing several times

- Verdict: confirmed (the facts). The fix is a copy decision.
- Corrected severity: medium.
- Proof: each quoted line exists at the cited lines of `operations-attention/index.tsx`. Screenshots `screens/svc-04-empty--desktop-dark.png` and `screens/svc-03-loading-alerts--desktop-dark.png` show the repeated text.
- Correction: the "64 words" for the empty service page include the screen-reader announcement "Service attention: no unresolved service alerts." (6 words, `sr-only`). `node verify/words.mjs` prints the text. The visible count is 58 words. The pull request card in the pending state has 34 words. 36 includes the "Review queue" link.
- `docs/current-contract.md` does not require the three disclaimers on screen (`rg -i "notification" docs/current-contract.md`: no match). Only `docs/review-guide.md:9-11` documents them.

## PULL-16 · One concept has five names and two entry points in the same header

- Verdict: confirmed.
- Corrected severity: medium.
- Proof: each cited string exists at the cited line. `node verify/verify.mjs`: the open popover has one link, the guide (`target: null`, `rel: null`), and no link to `/?view=service`. `apps/web/src/capacity.ts:112` has "a maintainer must check Service attention".
- Corrections: none.

## PULL-17 · The pull request page has no pull request context and no stage information

- Verdict: confirmed (code reading, as the report states).
- Corrected severity: medium. After the PULL-01 correction this is one of the main findings for the page, because waiting is its main job.
- Proof: `apps/web/src/api/review.ts:773-783` (response fields and the `pending` default). `apps/web/src/api/dashboard.ts:57-62` reads the title from stored webhook payloads. Screenshot `screens/pull-08-pending--desktop-dark.png`.
- Caveat on the recommendation: I did not check that a stage such as "5 of 8 shards" is available before the run row exists. `review.ts:759-772` finds a run only after the check has a workflow run and attempt. Treat shard progress as not verified. Title, commit, attempt, and the workflow run URL are available from the rows that the handler already reads.

## PULL-18 · Three different sign-in and access-denied designs, and three different headers

- Verdict: confirmed.
- Corrected severity: medium.
- Proof: `apps/web/src/routes/index.tsx:280-354`, `apps/web/src/routes/runs.$runId.tsx:76-108`, `:227-243`, `pulls.$pullNumber.tsx:186-233`. `apps/web/src/components/user-menu.tsx:24` falls back to "Account", and no caller passes `login` (`routes/index.tsx:258-263`, `runs.$runId.tsx:207-212`). Screenshots `screens/svc-14-guest--desktop-dark.png` and `screens/pull-02-guest--desktop-dark.png`.
- Addition: `GET /api/session` returns the login (`apps/web/src/api/review.ts:713-720`), and no client code calls it (`rg "api/session" apps/web/src`: only the handler). The data for "Signed in as @name" exists.

## PULL-19 · Layout and style defects on the pull request page

- Verdict: confirmed (the measured facts). Some items are taste, for example "Review queue is not back".
- Corrected severity: low.
- Proof: `node verify/verify.mjs`: back link 424 to 1016 px (592 px), `justify-content: center`; card 424 to 1016 px; heading left 453; status text left 501; status frame background `oklch(0.2134 0.0091 264.28)`, the same as the card; "Open on GitHub" has `target: null`; the body is 672 px wide and the card is 592 px.
- Corrections: none.

## PULL-20 · The surfaces bypass primitives that the vendored copy already has

- Verdict: confirmed.
- Corrected severity: medium. The maintainer names primitive use as a goal.
- Proof: `<Text` count is 9 + 11 = 20 (`rg -c "<Text\b"`). No CSS file has `dashboard`, `dashboard-main`, or `dashboard-alert-*` (`rg` in `apps/web/src` with `*.css`: no match). The vendored copy has `Disclosure` (`disclosure.ariakit.react.tsx:588`), `PopoverScroll` (`popover.ariakit.react.tsx:121`), and the Shell bands (`shell.ariakit.react.tsx:254-385`). It has no `progress`, `list`, `heading`, `tooltip`, `separator`, `link`, or `code` file. Upstream has them.
- Corrections: none.

## PULL-21 · Accessibility gaps

- Verdict: partly-confirmed.
- Corrected severity: low (auditor: medium). `docs/review-guide.md:94` puts screen-reader certification out of the launch scope. The title item affects all users.
- Confirmed:
  - `node verify/verify.mjs`: service page headings are `H1 Service status.` then `H3`. Each route has the title `Visonaut` (`apps/web/src/routes/__root.tsx:10`).
  - `node verify/popover.mjs`: "Refresh runs" adds requests to `/api/operations` and sets the announcement again ("Service attention: 3 unresolved service alerts.").
  - `node verify/words.mjs`: after a failed sign-in, `document.activeElement` is `BODY`. This part was "from code" in the report. It is now measured.
- Not confirmed: "A second `H1` is in the document … `H1 Account` on every page". The element exists, but its dialog has the `hidden` attribute and `display: none` while it is closed (`accountHeadingVisible: { dialogDisplay: "none", dialogHiddenAttr: true }`). Assistive technology does not get it. A second `H1` is exposed only while a popover is open. That is the default of Ariakit `PopoverHeading`.

## PULL-22 · "Open the operations and recovery guide" does not lead to recovery steps for the alert

- Verdict: confirmed.
- Corrected severity: medium.
- Proof: `apps/web/src/operations/README.md` has the sections "Durable decisions and sealed recovery", "Baselines and closed history", "Conversion before deployment", "Manual evidence export", and "Native database recovery". It has no steps to reconcile a check, resume delivery, or retry promotion. Line 3: "This runbook describes source behavior before the selected retirements."
- The open item of the report is now closed: the repository is public. `gh repo view ariakit/visonaut --json visibility` gives `"PUBLIC"`, and `curl` on the README URL gives `200` with no session.

## PULL-23 · One component holds polling, announcements, copy, and two layouts, and the page layout has no test

- Verdict: confirmed.
- Corrected severity: low.
- Proof: `wc -l` gives 518 lines. `rg -l "view=service|layout=\"page\"|Service status"` in the test files: no match. `apps/web/src/review/__tests__/pulls.browser.test.ts` has five tests (lines 8, 32, 56, 99, 116). None covers `not-required`, `forbidden`, not found, or "Use another account". `operations-attention/index.tsx:472` wraps the page layout in `PopoverProvider`.
- Corrections: none.

## PULL-24 · Timestamps and sizes are hard to read

- Verdict: confirmed (the facts). The preferred format is a design choice.
- Corrected severity: low.
- Proof: `operations-attention/index.tsx:201-207`. `apps/web/src/runtime-defaults.ts:15-16` (1536 MiB and 2 GiB). Screenshot `screens/svc-07-…` shows "Database: 1612.4 MiB used; 435.6 MiB before new runs pause."
- Corrections: none.

## Missed

- **The GitHub check link changes to the run page.** After the first status delivery the "Details" link is `/runs/<id>` (`apps/web/src/operations/checks.ts:28-30`, `:211-217`; `packages/security/src/checks.ts:188-195`). The pull request page is a waiting room, so PULL-05, PULL-06, and PULL-17 have more weight than PULL-01.
- **`space-y-3` does nothing in the popover list.** `.ak-frame { margin: var(--ak-frame-margin) }` wins over the zero-specificity `:where(.space-y-3 > …)` rule, so the capacity block touches the first alert card (`verify/popover2.mjs`: `computedMarginBottom: "0px"`; `screens/pop-04-…--desktop-dark.png`).
- **Alert cards have square corners in the popover.** The same `$rounded="xl"` gives a 2 px radius in the popover and 10.5 px on the page (`verify/popover-output.json`). My capture at 2x shows the two popover defects: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-pull-ops/verify/screens/v-popover-dialog-2x.png`.
- **Clients ignore `error.code`.** Each 403 (`not_maintainer`, `invalid_identity`, `wrong_origin`, `preview_fixtures_only`) shows the write-access text and "Use another account" (`pulls.$pullNumber.tsx:63-69`, `routes/index.tsx:189-195`). PULL-08 covers only the preview case.
- **`GET /api/session` is not used.** It returns the login (`apps/web/src/api/review.ts:713-720`), and the account menu shows "Account".
- **`occurrences` is not reliable.** Two writers do not increase it (`packages/service/src/run-retirement.ts:136-142`, `apps/web/src/operations/recovery.ts:79`).
- **The capacity alert text is wrong for the active-run limit.** `admission-blocked` is also emitted at the active-run limit (`apps/web/src/capacity.ts:25-30`), and the text speaks only about database size.
- **Requests that can only fail.** `/pulls/7` with no `check`, and `/pulls/abc`, each send an API request that passes the full access check and then answers 404. The route does not validate `pullNumber`, and the page prints the raw value ("PULL REQUEST #ABC" in `screens/pull-13-…`).
- **Invalid capacity JSON fails on the server too.** `JSON.parse(capacity.value)` at `apps/web/src/api/operations.ts:52` has no `try`, so the full alerts endpoint answers 503.
- **The header logo also reloads the document.** `apps/web/src/components/app-shell.tsx:29` is a plain anchor, as the three nav links are.
- **`Retry-After` is not used.** The API sends `Retry-After: 1` with each 503 (`apps/web/src/api/index.ts:42`, `:82`). The two polls do not read it.
