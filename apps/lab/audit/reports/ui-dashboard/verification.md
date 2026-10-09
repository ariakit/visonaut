# Verification: `ui-dashboard` lane (DASH-01 to DASH-26)

Verifier: adversarial pass, read-only. Date: 2026-10-05.
Repository root: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. Paths below are relative to it unless they start with `/`.

Skills used: `ariakit-general-workflow` (invoked). `ariakit-ariakit-ui-styles` and `ariakit-ariakit-tailwind` were not needed as workflows; the recipe facts were checked in the vendored source and in `node_modules/@ariakit/tailwind`. No code, test, or changeset skill applied, because nothing in the repository was changed.

## Read this first

1. **`report.md` does not exist.** The harness refused the auditor's Write call. I recovered the text from the auditor's transcript:
   - `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-dashboard/verify/structured-summary.md` (the final text that the auditor returned; I verified this one)
   - `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-dashboard/verify/recovered-report.md` (the refused Write; an earlier draft)
2. **My measurements** are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-dashboard/verify/`: `vprobe.json`, `vprobe2.json`, `vprobe3.json`, `vprobe4.json` (scripts `vprobe*.mjs`), `m5-title.sql`, `ssr-index.html`. Browser: Chrome through Playwright. Servers: the two local dev servers. No number of mine describes production.
3. **Production numbers that I cite are not mine.** They come from the orchestrator's record `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live-authenticated.md`. I mark them "orchestrator record".
4. **Result.** No finding is refuted. 20 are confirmed. 5 are partly confirmed (DASH-01, DASH-08, DASH-16, DASH-22, DASH-26). 1 is a judgment (DASH-15). The most important corrections:
   - DASH-01: the run route already uses the router loader that the contract selected (P03). The dashboard is the outlier. The recommended server loader removes only the hydration gap (about 0.24 to 0.36 s in production, orchestrator record); the 0.9 to 2.0 s server wait stays, and a blocking loader moves it before the first byte.
   - DASH-05: the repository's own design record already said that the webhook payload is not a usable title source, and already selected the store (a nullable title on the run row). Option A of the auditor has a side effect that the auditor did not see.
   - DASH-11 and DASH-26: the two badge shapes and the two button radii have one cause, the documented concentric-radius rule of `$rounded`. The fix is `$forceRounded`.
   - DASH-04: `/api/operations` is at least 6 sequential D1 round trips by code, not 3.

## Verdict table

| ID      | Verdict          | Auditor severity | My severity |
| ------- | ---------------- | ---------------- | ----------- |
| DASH-01 | partly-confirmed | high             | high        |
| DASH-02 | confirmed        | high             | high        |
| DASH-03 | confirmed        | medium           | medium      |
| DASH-04 | confirmed        | medium           | medium      |
| DASH-05 | confirmed        | high             | high        |
| DASH-06 | confirmed        | medium           | medium      |
| DASH-07 | confirmed        | medium           | medium      |
| DASH-08 | partly-confirmed | high             | medium      |
| DASH-09 | confirmed        | high             | high        |
| DASH-10 | confirmed        | medium           | medium      |
| DASH-11 | confirmed        | medium           | medium      |
| DASH-12 | confirmed        | medium           | medium      |
| DASH-13 | confirmed        | low              | low         |
| DASH-14 | confirmed        | medium           | medium      |
| DASH-15 | judgment         | medium           | low         |
| DASH-16 | partly-confirmed | medium           | low         |
| DASH-17 | confirmed        | medium           | low         |
| DASH-18 | confirmed        | medium           | medium      |
| DASH-19 | confirmed        | medium           | medium      |
| DASH-20 | confirmed        | medium           | medium      |
| DASH-21 | confirmed        | low              | low         |
| DASH-22 | partly-confirmed | low              | low         |
| DASH-23 | confirmed        | low              | low         |
| DASH-24 | confirmed        | medium           | medium      |
| DASH-25 | confirmed        | low              | low         |
| DASH-26 | partly-confirmed | low              | low         |

## DASH-01 · The dashboard HTML has no data; content waits for hydration and then for `/api/runs`

- Verdict: **partly-confirmed**. The facts are right. One comparison is wrong, and the expected gain of the recommendation is overstated.
- Severity: high (same). This is the maintainer's complaint 1.
- Proof checked:
  - `apps/web/src/routes/index.tsx:39-44` has `validateSearch` and `component` only. `:161` starts in `loading`. `:176-210` is the `useEffect` fetch. `:275-279` is the loading text. All as quoted.
  - M1 re-run: `curl http://127.0.0.1:4310/` gives `status=200 bytes=27700`. The HTML has "Checking access and loading runs…" one time and no run text (`verify/ssr-index.html`).
  - M2 re-run (`verify/vprobe3.json`, 5 runs): document end 11 to 13 ms, first contentful paint 68 to 80 ms, `/api/runs` start 228 to 249 ms, end 233 to 255 ms. With 600 ms added: start 259 to 272 ms, end 869 to 881 ms. The order of events is as the auditor says.
  - Orchestrator record (production, signed in): `/api/runs` starts at 240 to 359 ms and waits 0.9 to 2.0 s on the server. The page shows the loading text for all that time.
- Corrections:
  1. **"The same pattern is in `runs.$runId.tsx:70`" is wrong about the mechanism.** The run route uses a router loader (`runs.$runId.tsx:31-49`: `ssr: false`, `loader`, `pendingComponent`, `errorComponent`, abort signal). That is contract decision P03, "Use the existing router loaders" (`docs/current-contract.md:150`, `docs/simplification-implementation.md:95`). The dashboard is the route that does not follow P03. The visible result is the same (a loading line until the client fetch ends). The pull route does use an effect; its loading text is at `pulls.$pullNumber.tsx:181` (not 179) and reads "Finding this pull request’s visual review…".
  2. **The gain is smaller than the text suggests.** In production the request starts about 0.24 to 0.36 s after navigation and then waits 0.9 to 2.0 s on the server (orchestrator record). A server loader removes the first part and one network round trip. It does not shorten the server wait. If the loader blocks, the 0.9 to 2.0 s moves before the first byte, and the maintainer sees a blank tab in place of a loading line. Use streaming (return the promise and render it under `Suspense`) or keep a skeleton shell. The larger lever is the server time of `/api/runs`, which other lanes own.
  3. **The repository already scoped this.** `docs/simplification-audit/evidence/feedback-performance.md:30`: "If server-rendered review data is wanted, use an authenticated server function and return the model from it. That is a separate increase in scope, not a requirement for P03." So the recommendation is feasible and is a known scope increase.
  4. **Three things the recommendation must handle:**
     - Session cookies. `requireMaintainer` returns `sessionHeaders` and the API copies them to the response (`apps/web/src/api/index.ts:220-222`). A server function must copy them to the document response, or session renewal is lost.
     - Dates. `runDate` uses `toLocaleString(undefined, …)` (`index.tsx:156`). On the server (Worker locale and UTC) and in the browser this gives different text. Server-rendered dates will cause hydration mismatches.
     - Client cache lifetime. `docs/simplification-audit/evidence/feedback-quality.md:18`: "O05 permission caching must not acquire an additional unbounded client-cache lifetime." `staleTime: 15_000` is bounded and fits. Alternative 2 (paint the last answer from `sessionStorage`) shows protected data before the access check; it needs a bound and a clear on `401` and `403`.
  5. Platform facts: TanStack Start loaders are isomorphic, and a server function called in a loader runs directly during SSR and as a request during client navigation (https://tanstack.com/start/latest/docs/framework/react/guide/execution-model). Alternative 1 (inline script with the nonce) is allowed by the measured CSP: `script-src 'self' 'nonce-…'; connect-src 'self'`.
  6. The smallest consistent step is not in the report: move the dashboard to the same client loader as the run route. It gives abort, pending and error components, and a bounded cache for back navigation. It does not put data in the HTML.

## DASH-02 · Header navigation reloads the whole document

- Verdict: **confirmed**.
- Severity: high (same).
- Proof checked:
  - `apps/web/src/components/app-shell.tsx:15-19`, `:29`, `:52-57` as quoted. `NavLink` renders `ak.Role.a` and spreads the rest of the props (`components/ariakit/components/nav.ariakit.react.tsx:588-609`), so `render={<Link … />}` works.
  - M3 re-run in the other order (`verify/vprobe.json`, `navigation`): footer "View history" first: documents 1 to 1, `/api/runs` 2 to 2. Header "Review queue": documents 2, requests 4. Header "Run history": documents 3, requests 6. (Two requests per load is React StrictMode in development.)
  - Orchestrator record: a load of `/?view=history` in production shows content after about 1.2 s and is stable after about 2.7 s. That is the cost of each header click.
  - `git log` shows that `app-shell.tsx` is new in `f83fef6` (2026-10-05). The commit has no body. No test asserts a full reload. I found no contract rule that needs plain anchors.
- Corrections:
  - `aria-current` keeps working, because the app passes it explicitly (`app-shell.tsx:57`); `NavLink` computes it from `href` only as a default.
  - All three views have the same document title "Visonaut" (`routes/__root.tsx:10`, measured). After the change to client navigation, nothing tells a screen reader user that the view changed. Add a title for each view.
  - The response header is `cache-control: no-store, private` for the document (measured). I did not test the back/forward cache.

## DASH-03 · "Refresh runs" blanks the page and three header items, and reloads the alerts

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked:
  - `index.tsx:242-245`, `:251`, `:254-257` as quoted.
  - Re-measured (`verify/vprobe.json`, `refresh`): before the click the header text is "visonaut. ariakit/ariakit Review queue Run history Service status … Account" with the buttons "Service attention: no alerts" and "Account menu". During the reload the header text is "visonaut. Review queue Run history Service status" with no buttons, and `main` is only the loading line. `scrollY` goes from 600 to 0. Page height goes from 1,880 to 900.
  - M4 re-run: `/api/operations` loads 1 to 2 when the refresh answers.
  - History search text is lost after a refresh (`verify/vprobe4.json`: `queryAfterRefresh: ""`).
- Corrections:
  - One more effect that the report does not name: keyboard focus goes to `<body>` after a refresh by keyboard (`vprobe4.json`: `activeTag: "BODY"`), because the button unmounts.
  - The sketch uses `disabled={refreshing}`. A native `disabled` on the focused button can drop focus again. Use `aria-busy` alone, or Ariakit's `accessibleWhenDisabled`.

## DASH-04 · `/api/operations` waits for `/api/runs`, and the service view loads runs that it does not use

- Verdict: **confirmed**. The count is too low.
- Severity: medium (same). For `?view=service` alone it is high: the page content is the second request.
- Proof checked:
  - `index.tsx:254-256` and `:356-364` as quoted. `OperationsAttention` mounts only in the `ready` state.
  - Orchestrator record (production): `/api/operations` starts 66 to 250 ms after `/api/runs` ends, in every sample. `/?view=service`: `/api/runs` 595 to 1,461 ms, then `/api/operations` 1,527 to 2,744 ms. The auditor marked this "not measured"; the order is measured in production by the orchestrator.
- Corrections:
  - "At least 3 D1 round trips for each request" is right for `/api/runs` and too low for `/api/operations`. By code `/api/operations` has at least 6, all sequential: `assertConfiguredProject` (`api/index.ts:123-126` skips it for `/api/runs` only; it is one project read, `api/context.ts:128-141`), the session read, the account read (`packages/security/src/authorization.ts:32-43`), and three queries in `apps/web/src/api/operations.ts:16-18`, `:30-37`, `:45-47`. The total for one dashboard load is at least 9, not 6. This matches the production record, where the 554-byte alert answer waits longer (1.2 to 1.3 s) than the 2,285-byte run answer.
  - Alternative 2 (use `GET /api/session`) adds a third authenticated request. The test "dashboard loads its protected run list without a separate identity request" (`apps/web/src/review/__tests__/route.browser.test.ts:88-103`) shows that a separate identity request was removed on purpose. Prefer one answer, or two requests in parallel.
  - Alternative 1 (mount the bell during `loading`) works in the preview too (`review/preview-fixtures.ts:106-108` answers `/api/operations`), but `state.preview` is not known while loading, so the bell would show in the preview.

## DASH-05 · Pull request titles are erased when the webhook is processed

- Verdict: **confirmed**. This is the strongest finding of the lane.
- Severity: high (same).
- Proof checked:
  - `apps/web/src/api/dashboard.ts:57-62`, `apps/web/src/api/review.ts:288` and `:561`, `apps/web/src/api/webhooks.ts:330-335` and `:349-358`, `docs/operations/compact-processed-webhooks.md:3`, `apps/web/src/api/dashboard.test.ts:42-56` and `:66`. All as quoted.
  - `git log -S`: the clearing came in `339926d` (2026-09-28, #129). The title query and `migrations/0028_pr_title_index.sql` came in `5712036` (2026-09-30, #155). Confirmed.
  - M5 re-run with SQLite 3.51.0 (`verify/m5-title.sql`):

    ```text
    before processing|Fix dialog focus ring
    after processing, matching rows|0
    after processing, title IS NULL|1
    ```

  - Orchestrator record (production): "History rows show `#7746 · Pull request` because no pull request title is available". This is the production check that the auditor did not have.
  - The repository's own design record said this before the code was written. `docs/simplification-audit/evidence/feedback-ui.md:134`: "Processed webhook JSON is cleared. Therefore reading old webhook payloads is not a viable title source."
- Corrections:
  1. **The store is already selected.** `feedback-ui.md:139`: "Add one nullable display-title field to the existing run row. … do not add a new PR table, title polling job, or fetch per dashboard row." That is the auditor's option C. Option B (a pull request table) is ruled out by the same line. The "maintainer decision needed" is, in effect, a question of whether that record still stands.
  2. **Option A has a side effect.** Its SQL works (re-run: the title comes back). But the documented backfill and its completion check use `processed_at IS NOT NULL AND payload_json != '{}'` (`docs/operations/compact-processed-webhooks.md:10-12`, `compact-processed-webhooks.sql:6`). That predicate matches the trimmed rows (re-run: 1 row). A later run of the backfill would erase the titles again, and the "remaining" count would never reach zero. Option A must also change `webhooks.ts:150`, `webhooks.ts:172`, `operations/recovery.ts:73`, and the tests at `webhooks.test.ts:3694` and `:3714`. Option A also contradicts `compact-processed-webhooks.md:3`, which lists the five columns to keep.
  3. The title is visible only between receipt and the end of `processWebhook`, or while processing keeps failing (for example `merge_not_ready`, `webhooks.ts:306`).
  4. The selected display rule is `PR #123 · Fix dialog focus`, with the number as the fallback heading (`feedback-ui.md:125`, `:165`). The code prints the kind (`index.tsx:499`). The "minimal" alternative of the auditor is that rule.
  5. After the fix, the correlated subquery and the index `0028` have no use.

## DASH-06 · `ak-ink-danger`, `ak-ink-warning`, and `ak-ink-success` do not exist

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked:
  - `apps/web/node_modules/@ariakit/tailwind/src/output.css:816-821`: `@utility ak-ink-*` takes a number or `[*]`. `readme.md:226` and `:624` as quoted.
  - Uses at `index.tsx:271`, `:331`, `:531`, `components/user-menu.tsx:66`, `components/operations-attention/index.tsx:370`, `:501`. Confirmed with `rg`.
  - Re-measured (`verify/vprobe.json`): 0 CSS rules for the three names; 2 rules for `ak-ink-60`. Sign-in error color `oklch(1 0 0)` dark and `oklch(0 0 0)` light, equal to the body. The forbidden icon (`class="… ak-ink-warning"`) has the body color in both schemes.
  - Screens `04-guest-sign-in-error--dark-desktop.png`, `05-forbidden--light-desktop.png`, `08-queue-empty-baseline--dark-desktop.png` show it.
- Corrections: none to the facts. The correct form is already in the repository: `routes/runs.$runId.tsx:232` (`ak-text ak-text-danger`) and `review/item-list.tsx:272`. So this is also an inconsistency between pages.

## DASH-07 · `$layer="primary"` is not a recipe color

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked:
  - `components/ariakit/utils/styles.ts:6-13` has no `primary`. `components/ariakit/components/layer.ariakit.react.tsx:79-100`: a string that is not in the map becomes `class: "ak-layer ak-layer-color-(--layer-color)"` with `style: { "--layer-color": value }`.
  - Re-measured on the real preview server and on the fixture: inline style `--layer-color: primary;`, background `oklch(0.949994 0.0000497986 23.7884)` and text `oklch(0 0 0)` in dark and in light. Logo slot `oklch(0.515341 0.1546 248.516)`.
  - Light sign-in card (`verify/vprobe2.json`): the shield box is `oklch(0.999994 …)` on a card of `oklch(1 0.0011 197.14)`. It is invisible, as the report says.
- Corrections:
  - The intent is in the theme: `components/ariakit/styles/ui.css:6` declares `--color-primary: var(--color-brand);`. But that token is not in the output CSS (`getComputedStyle(document.documentElement).getPropertyValue("--color-primary")` is empty; `--color-brand` is present). So `$layer="var(--color-primary)"` would not work. `$layer="brand"` is the working value.
  - Alternative 2 (reject unknown names in the type) changes vendored upstream code. The type is `"transparent" | ColorValues | (string & {}) | boolean` on purpose (raw CSS colors), and the `NOTICE` file says "The source behavior is retained". A lint rule or a test is the smaller change.

## DASH-08 · Review cards are 240 px tall; a queue of 40 runs is 8.5 screens long

- Verdict: **partly-confirmed**. The geometry is right. The 40-run queue is a stress case, not an observed state.
- Severity: medium (auditor: high).
- Proof checked:
  - `index.tsx:475-484`, `:495-499` as quoted. `dashboard.ts:70-75` has no `LIMIT`. `dashboard.test.ts:66` expects 101.
  - Re-measured (`verify/vprobe.json`, `vprobe2.json`): cards 240 / 272 / 240 / 240 px at y = 361 (dark; 238 / 270 in light). Page 1,880 px with 8 runs and 7,608 px with 40. Phone: first card at 398, cards 236 to 376 px, 2,293 px and 9,245 px. History row 64 px.
- Corrections:
  - The production answer of `/api/runs` was 2,285 bytes (orchestrator record). That is a few runs in total. "8.5 screens" comes from the synthetic file `data.mjs`. The report says this only in its open questions.
  - The missing bound is a defect of its own. `feedback-ui.md:143` says: "Use a bounded, paged query". See "Missed".

## DASH-09 · The same facts are stated two to five times

- Verdict: **confirmed**. The list of words to remove is a design opinion.
- Severity: high (same). This is the maintainer's complaint 2.
- Proof checked:
  - Word counts re-measured: sign-in 34, empty queue 38, queue with 1 run 55 (the text matches the report word for word), queue with 8 runs 222, preview queue 59.
  - Lines `index.tsx:437`, `:452-454`, `:471`, `:492`, `:502`, `:512`, `:429-431`, `:360`, `:440`, `:533`, `:432-434`, `:630-632`, `:634`, `:658`, `:748`, `:549-554` and `app-shell.tsx:37-41`. All as quoted.
- Corrections:
  - "Count of runs, three times": the third item (`:471`) is a heading without a number. It is two counts and one list.
  - The "words that carry data" column is an estimate ("about"). Treat it as such.

## DASH-10 · Failed and stale runs are at the bottom, with a clock icon and no color

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked: `index.tsx:542-543`, `:580-582`, `:588-590` as quoted. Screen `11-queue-8--dark-desktop--full.png` shows "Run failed · Attempt 1" with the same clock and gray text as "Comparing images · Attempt 1".
- Corrections:
  - Position: in the 40-run fixture "Needs attention" starts at y = 6,698 of 7,608 (`verify/vprobe.json`, `queueForty`). The report says "about 6,540" (the draft said 6,650).
  - Alternative 1 (move "Needs attention" above "Ready to review") changes a selected contract rule: U05, "List review work first with a history view" (`docs/current-contract.md:147`). The maintainer said that patterns can change; this one is in the contract.
  - A run whose own state is `failed` is never in the queue: the query has `state NOT IN ('failed','superseded','accepted')` (`dashboard.ts:71`). The "Run failed" rows in the queue come only from dead comparison tasks (`dashboard.ts:53-54`, `packages/service/src/review-status.ts:81`). A run with the state `failed` shows in history only.

## DASH-11 · Eight run states share four looks, and the same badge has two shapes

- Verdict: **confirmed**. The cause of the two shapes was not found by the auditor.
- Severity: medium (same).
- Proof checked:
  - `index.tsx:132`, `:142-151`, `:385-386`, `:388`; `packages/service/src/review-status.ts:50-58`; `review/preview-fixtures.ts:84`. All as quoted.
  - M9 re-run (`verify/vprobe2.json`): badge radius `3.35544e+07px` in a card and `2px` in the table. Same classes, no `ak-frame-force`.
- Corrections:
  - **Cause.** `$rounded` is concentric by design: "If the frame is nested, this value will be adjusted to stay concentric with the parent unless `$forceRounded` is used or the parent padding plus the child margin is at least 1rem" (`components/ariakit/components/frame.ariakit.react.tsx:116-122`; CSS at `@ariakit/tailwind/src/output.css:1062-1065`). In the table the parent frame is the `tr` (radius 0, padding 0), so the badge gets the 2 px floor. In the card the parent padding is 21 px, which is more than 1rem, so the rule is off and the pill stays.
  - **Fix.** One prop, no recipe change:

    ```tsx
    <Badge $layer={color ?? true} $rounded="full" $forceRounded className="text-xs max-w-full">
    ```

  - `reviewing` is a real raw run state in the database (`review-status.ts:5`). The dashboard API never sends it, because it sends the derived status. `feedback-ui.md:135` warns against labels on the raw state. The preview fixture does that.

## DASH-12 · Only 1.7% of a review card is clickable

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked: `index.tsx:507-516`, `:707-711`, `:405`. Re-measured: card 1120 x 240, link 142 x 33, share 0.0174. History row 1118 x 64, link 608 x 42 (36%). Order of controls in `main`: Refresh runs, Review changes x4, Open run x4, View history. `<time>` has no `datetime`.
- Corrections:
  - The link is larger than the 24 x 24 px minimum of WCAG 2.2. The small target is an efficiency problem, not a conformance failure. The repeated link names are the accessibility part.
  - Alternative 2 (`Nav` with `NavLink` rows) is technically possible (`NavList`, `NavGroup`, `NavGroupLabel`, `NavIcon` are vendored). It adds a `navigation` landmark around a data list. A list or the table is the closer semantic.

## DASH-13 · Runs without a title print the kind twice; the icon is always a pull request; nothing links to GitHub

- Verdict: **confirmed**.
- Severity: low (same).
- Proof checked: `index.tsx:487`, `:490`, `:499`, `:402`, `:404`, `:153-157`. Screen `11-queue-8--dark-desktop--full.png`: the fourth card reads "Main" and "Main" with the pull request icon; "Merge queue" has no commit and no time.
- Corrections: the selected display rule already covers the fallback (`feedback-ui.md:125`: "Keep the PR number visible when the title is missing"). The measured CSP has no rule that blocks links to github.com.

## DASH-14 · Copy defects

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked:
  - `index.tsx:502`: the DOM has "1 view await approval." in the 40-run fixture.
  - `index.tsx:171`, `:192`, `:196`; `api/index.ts:111`, `:73-83`; `packages/security/src/authorization.ts:46`; `packages/security/src/github.ts:227`; `dashboard.ts:83`, `:85-89`. All as quoted.
  - Re-measured: a `503` with a `reference` and a `409 incomplete` both show "The run list is temporarily unavailable. Please retry." The sign-in error is at x = 160, y = 69. The button moves from y = 325 to y = 363 (38 px).
  - `route.browser.test.ts:75` expects `Reference: ${reference}.` on the review page. Confirmed.
- Corrections:
  - `403 wrong_origin` cannot reach a same-origin browser request unless the configured origin differs from the host. The realistic 403 cases are `not_maintainer` and `invalid_identity`.
  - The `409` needs a missing project row. It is a setup error.
  - To name the repository on `401` and `403`, the server must add it to the error body (`errorResponse` at `api/index.ts:35-45` has no repository today; `bindings.configuration` is in scope in `handleApi`).

## DASH-15 · The sign-in screen is a marketing page for one button

- Verdict: **judgment**. The facts under it are right.
- Severity: low (auditor: medium). A maintainer who uses the app sees this screen rarely: the session lasts 7 days and is extended on use (`expiresIn` and `updateAge`, `packages/security/src/auth.ts:43-44`).
- Proof checked: `index.tsx:281-319` as quoted. Re-measured: 34 words in `main`; the three navigation links render for a guest; the button is at y = 325. Screens `02-guest--light-desktop.png` and `04-guest-sign-in-error--dark-desktop.png` match.
- Corrections: alternative 2 (redirect to GitHub with no click) is not a small change. `signIn.social` is a POST that returns the URL and sets state. A redirect on a GET document request needs a server call and the DASH-01 server check. It also removes the place where a signed-out person can choose not to sign in, and it interacts with DASH-16.

## DASH-16 · "Use another account" probably returns the same account

- Verdict: **partly-confirmed**. The code facts are right. The behavior is not observed. The affected case is narrower than the text says.
- Severity: low (auditor: medium).
- Proof checked:
  - `index.tsx:344-351` calls `signOut()`. `packages/security/src/auth.ts:29-35` sets `clientId`, `clientSecret`, `scope` only.
  - The forbidden screen shows the account menu too (measured: header button "Account menu").
  - GitHub documentation for the web application flow: `prompt` "Forces the account picker to appear if set to `select_account`. The account picker will also appear if the user has multiple accounts signed in." (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- Corrections:
  - A person with two GitHub accounts signed in on github.com gets the picker without any change. The loop can affect only a browser with one GitHub account signed in. Nobody observed it.
  - The fix is feasible for this one path with the installed better-auth 1.7.5. The sign-in body takes `additionalParams` and passes them to the authorize URL (`better-auth/dist/api/routes/sign-in.mjs:110`, `:231`; `@better-auth/core/dist/oauth2/create-authorization-url.mjs:54-57`):

    ```ts
    await createAuthClient().signIn.social({
      provider: "github",
      callbackURL,
      additionalParams: { prompt: "select_account" },
    });
    ```

    The provider option `prompt` (`@better-auth/core/dist/social-providers/github.mjs:27`) would show the picker on every sign-in.

## DASH-17 · The account menu never shows who is signed in

- Verdict: **confirmed**.
- Severity: low (auditor: medium).
- Proof checked: `components/user-menu.tsx:24`. Callers at `index.tsx:258-263` and `runs.$runId.tsx:207-212` pass no `login`. `api/review.ts:713-721` returns `login`; `server.ts:88-105` returns `userId`; `rg` finds no client call of either. Screen `23-user-menu-open--dark-desktop.png` matches.
- Corrections:
  - The avatar idea does not work today. The measured CSP is `img-src 'self' data:`. An image from github.com is blocked until the CSP changes.
  - `viewer.login` in the `/api/runs` answer agrees with the test at `route.browser.test.ts:88-103` (no separate identity request).

## DASH-18 · History: client-side search over 100 rows, explained three times, with a layout that moves with the data

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked:
  - `dashboard.ts:69`; `index.tsx:616-622`, `:681`, `:661`, `:645-688`.
  - Re-measured: `table-layout: auto`. Filter control 148 / 172 / 236 px for 0 / 1 / 8 runs (light; the report read 150 / 174 / 238 from dark screens). Header cells 715 / 226 / 177 px. Options in data order: All results, Passed, Needs review, Replaced by a newer run, Changes rejected. On focus the input has `outline-style: none` and `text-decoration-line: underline`; the wrapper has no outline and no ring. Row 1118 x 64. Commit weight 600. Phone: rows 83 to 243 px, 3 rows in the first screen, 12,782 px for 100 rows. The search field and the filter show with 0 runs.
  - Upstream has `Input`, `InputGroup`, `InputSlot` (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components/input.ariakit.react.tsx:21`, `:39`, `:83`).
- Corrections: one more defect, see "Missed": the search does not match the text that the row shows.

## DASH-19 · The run list never updates on its own

- Verdict: **confirmed**.
- Severity: medium (same).
- Proof checked: `index.tsx:176-210` depends on `[reload]` only. `components/operations-attention/index.tsx:280` is `timeout = setTimeout(load, 60000);`.
- Corrections:
  - The recommended pattern is already in the repository. `routes/pulls.$pullNumber.tsx:105-119` polls every 15 s while the tab is visible and refreshes on `visibilitychange`. Reuse it.
  - One poll is not cheap in production: 0.9 to 2.0 s of server wait for `/api/runs` (orchestrator record). An interval of 10 to 15 s is the lower limit that makes sense.

## DASH-20 · The dashboard hand-writes typography, fields, and lists

- Verdict: **confirmed**. "Does not look like an Ariakit UI page" is an opinion.
- Severity: medium (same).
- Proof checked:
  - M10 re-run with `rg -o … | wc -l`: `<div` 18, `<input` 1, `<select` 1, `<code` 2, `<section` 3, `<Text` 38, `<Frame` 11, `<Badge` 3, `ak-ink-60` 24, `uppercase tracking-widest` 5, `text-3xl sm:text-4xl` 2, `render={<h` 11, `render={<p` 16. Identical.
  - `dashboard` and `dashboard-main` have no CSS rule and no test selector (`rg` over `apps/web/src`).
  - Vendored components: 13 files. Upstream has 27 and includes every primitive that the report names.
  - Third copy of the page header: `components/operations-attention/index.tsx:310-323`.
- Corrections: the contract supports the direction: U01, "Use the copied components throughout" (`docs/current-contract.md:142`). I did not check that a newer upstream pin works with the installed `@ariakit/tailwind` 0.2.8.

## DASH-21 · Client and server disagree on the run contract

- Verdict: **confirmed**.
- Severity: low (same).
- Proof checked: `dashboard.ts:12-24` against `index.tsx:46-57`. `index.tsx:106` fallback; only tests omit `actionable` (`route.browser.test.ts:97`, `:147`, `:190-203`; `:527` and `:562` send it). `superseded` cannot be in the queue (`dashboard.ts:70` needs `active=1`; `review-status.ts:77` returns `superseded` only when the run is not active). `index.tsx` never reads `comparisonId`, `snapshotId`, `promotionId`. No other consumer of `GET /api/runs` exists in `packages/` or `.github/`.
- Corrections: none.

## DASH-22 · Sign-in and sign-out code is written three times

- Verdict: **partly-confirmed**. Three copies exist. They are not identical.
- Severity: low (same).
- Proof checked: `index.tsx:212-240`, `runs.$runId.tsx:165-198`, `pulls.$pullNumber.tsx:121-149`. `createAuthClient()` is called at `index.tsx:216`, `:232`, `runs.$runId.tsx:175`, `:191`, `pulls.$pullNumber.tsx:124`, `:138`.
- Corrections:
  - "The same error strings" is not exact. The pull route says "Sign-in could not start. Please retry." (`pulls.$pullNumber.tsx:130`); the others say "… Please try again."
  - The pull route has no `actionError` state. It puts the error in the page state and uses a boolean `action`.
  - After sign-out the three routes differ: guest state (`index.tsx:234`), `window.location.assign("/")` (`runs.$runId.tsx:193`), guest state (`pulls.$pullNumber.tsx:142`).
  - The drift makes the case for one shared hook stronger.

## DASH-23 · Preview: the notice repeats, and the fixture renders odd values

- Verdict: **confirmed**.
- Severity: low (same).
- Proof checked: `review/preview-fixtures.ts:83-86`, `:96`; `index.tsx:358-362`; `user-menu.tsx:24`. Screen `25-preview-queue--dark-desktop.png` shows "Preview fixtures" three times plus "Preview account", the commit `000000000000`, "Jan 1, 1970, 12:00 AM", a gray "Needs review", and "Pull request" in place of a number.
- Corrections: the captures use the UTC time zone. West of UTC the date reads "Dec 31, 1969". The preview without sign-in is contract decision O11 (`docs/current-contract.md:174`); a richer fixture does not conflict with it.

## DASH-24 · Phone layout

- Verdict: **confirmed**.
- Severity: medium (same). It depends on whether maintainers triage on a phone; nobody measured that.
- Proof checked: `index.tsx:578`, `:583`, `:549`, `:645`. Re-measured at 390 x 844: first card at y = 398 (47% of the screen), one card fits, title column in "In progress" 163 px wide with 3 and 4 lines, no horizontal overflow. Screens `11-queue-8--dark-mobile--full.png` and `17-history-1--dark-mobile.png` show "Attempt" and "1" on two lines, "View history" beside "Baseline revision 42", the cut placeholder ("Search loaded histor"), and a badge on two lines.
- Corrections: none.

## DASH-25 · The three counters are ambiguous and are not a list for assistive technology

- Verdict: **confirmed**.
- Severity: low (same).
- Proof checked: `index.tsx:423-424`, `:450-464`. The markup is two `<span>` elements for each counter. The block is 92 px tall. Rejected views are inside `pending`: `packages/service/src/review-status.ts:34-38`, and `dashboard.test.ts:67-72` expects `pending: 2, rejected: 1` for one pending row and one rejected row.
- Corrections: "they are zero most of the time" is not measured.

## DASH-26 · Small visual inconsistencies

- Verdict: **partly-confirmed**. Three details are wrong, and the main item has a known cause.
- Severity: low (same).
- Proof checked: re-measured radius 6.5 px for "Review changes" and 2 px for "Open run". Error cards 531 px (forbidden) and 433 px (error) wide. Heading punctuation as listed.
- Corrections:
  1. **The radius difference is the same rule as in DASH-11.** "Open run" sits in a frame with 14 px padding and a 10.5 px radius. The padding is less than 1rem, so the child is made concentric: 10.5 − 14 is below zero, and the floor is 2 px. "Review changes" sits in a card with 21 px padding, so the rule is off and the button keeps 6.5 px. Use `$forceRounded`, or give the row a radius larger than its padding.
  2. The gap before "In progress" is 56 px, and the gap before "Ready to review" is 28 px (`verify/vprobe2.json`). The report says about 64 and 36. The spacing unit is `0.25em`, which is 3.5 px at 14 px text, not 4 px.
  3. The page has four card paddings (4, 6, 7, 8), not five.
  4. The card width changes because the card is a grid item with `mx-auto`; it shrinks to its content up to `max-w-xl`.

## Missed

Each item is in the scope of this lane and is not a finding in the report.

1. **The dashboard does not follow contract decision P03.** The run route has a router loader, a pending component, an error component, and an abort signal (`routes/runs.$runId.tsx:31-49`). The dashboard has a hand-written effect and state machine (`routes/index.tsx:159-245`).
2. **The title source was rejected in the design record before it was built.** `docs/simplification-audit/evidence/feedback-ui.md:134` and `:139-141` against commit `5712036`. The test at `dashboard.test.ts:42-56` passes because it inserts a row that production cannot produce.
3. **Focus is lost after "Refresh runs".** `document.activeElement` is `<body>` after a refresh by keyboard (`verify/vprobe4.json`).
4. **History search does not match the visible text.** "#5300" gives "No matching runs" although the row shows "#5300"; "5300" matches. "Passed" and "Oct 5" also give no rows (`index.tsx:619`, `verify/vprobe4.json`).
5. **One document title for all views.** `/`, `/?view=history`, and `/?view=service` all have the title "Visonaut" (`routes/__root.tsx:10`, measured).
6. **The actionable list has no bound.** `dashboard.ts:70-75` has no `LIMIT`, against "Use a bounded, paged query" (`feedback-ui.md:143`). A run that is recent and actionable is sent two times in one answer.
7. **`/api/operations` is the slower half of the load.** At least 6 sequential D1 round trips by code (`api/index.ts:124-126`, `packages/security/src/authorization.ts:32-43`, `api/operations.ts:16-47`), and 1.2 to 1.3 s in production (orchestrator record). The 60 s poll has no visibility check (`components/operations-attention/index.tsx:280`). Another lane may own this.
8. **`--color-primary` is a dead theme token.** It is declared at `components/ariakit/styles/ui.css:6`, is not in the output CSS, and invites `$layer="primary"`.
9. **Dates are not ready for server rendering.** `toLocaleString(undefined, …)` at `index.tsx:156` gives different text on the Worker and in the browser. This blocks the DASH-01 recommendation until it is handled.
10. **A run with the state `failed` never shows in the queue.** `dashboard.ts:71` removes it from the actionable list. Only dead comparison tasks produce "Run failed" there. `dashboard.test.ts` has no case for a failed run (`rg "failed|dead"` finds nothing). Whether the exclusion is intended is a maintainer question.
