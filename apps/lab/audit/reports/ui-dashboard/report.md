# Dashboard: review queue, run history, sign-in, loading, error, forbidden, and empty states

Lane key: `ui-dashboard`. Finding prefix: `DASH`. Scope: `apps/web/src/routes/index.tsx` (752 lines), `apps/web/src/api/dashboard.ts`, and the code that these two files call.

All paths are relative to `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel` unless they start with `/`. Screens are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-dashboard/screens`.

Skills used for this lane: `ariakit-general-workflow` (invoked), `ariakit-ariakit-ui-styles` and `ariakit-ariakit-tailwind` (read as design context). The lane is read-only, so no code-style, test, or changeset skill applied.

## How it works (map)

### Files

| File                                                     | Role                                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/routes/index.tsx`                          | One route (`/`) with three views selected by `?view=`: queue (default), `history`, `service`. Holds all state, all copy, and all markup for the dashboard. |
| `apps/web/src/components/app-shell.tsx`                  | `AppHeader`: logo, repository name, the three navigation links.                                                                                            |
| `apps/web/src/components/user-menu.tsx`                  | Account popover with one action (Sign out).                                                                                                                |
| `apps/web/src/components/operations-attention/index.tsx` | Bell popover in the header, and the full page for `?view=service`.                                                                                         |
| `apps/web/src/api/dashboard.ts`                          | `dashboard()`: one D1 batch that returns `runs` (latest 100), `actionable` (all open work), and `project`.                                                 |
| `apps/web/src/api/index.ts`                              | `handleApi()`: origin check, session and repository-permission check, then `handleReview()`.                                                               |
| `apps/web/src/api/review.ts:732-734`                     | `GET /api/runs` calls `dashboard(context)`.                                                                                                                |
| `apps/web/src/review/preview-fixtures.ts:79-102`         | Fixed `/api/runs` answer for the preview environment.                                                                                                      |
| `packages/security/src/authorization.ts`                 | `requireMaintainer()`: session, linked account, GitHub permission (cached 60 s for reads).                                                                 |

### State machine (`index.tsx:59-69`, `159-245`)

```ts
type DashboardState =
  | { status: "loading" | "guest" }
  | { status: "error" | "forbidden"; message: string }
  | { status: "ready"; runs; actionable; repository; baselineRevision; preview };
```

- Initial state is `loading` on the server and on the client (`index.tsx:161`). The route has no loader.
- One `useEffect` (`index.tsx:176-210`) calls `fetch("/api/runs", { cache: "no-store" })`. `401` gives `guest`. `403` gives `forbidden`. Any other failure gives `error`. A good answer goes through `parseDashboard` (`index.tsx:75-121`).
- `refresh()` (`index.tsx:242-245`) sets the state back to `loading` and runs the effect again.

### What each state renders

| State            | Markup                                                                                                   | Lines                |
| ---------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| loading          | One paragraph: "Checking access and loading runs…"                                                       | `275-279`            |
| guest            | Two-column hero plus a sign-in card                                                                      | `280-320`            |
| error, forbidden | One centered card with Retry (and "Use another account" for forbidden)                                   | `321-355`            |
| ready, queue     | Page header, three counters, "Ready to review" cards, "In progress" rows, "Needs attention" rows, footer | `417-558`, `560-603` |
| ready, history   | Page header, search field, result select, table, footnote                                                | `605-752`            |
| ready, service   | `OperationsAttention layout="page"`                                                                      | `363-364`            |
| preview notice   | "Preview fixtures · GitHub login is disabled" above the view                                             | `358-362`            |

The queue splits `actionable` into three groups on the client (`index.tsx:418-422`): in progress (`comparing`, `incomplete`), recovery (`needs-recompare`, `failed`, `superseded`), and review (all other states).

### Data that the API returns (`dashboard.ts:12-24`, `137-146`)

Per run: `id`, `kind` (`main`, `pull_request`, `merge_group`), `testedSha`, `state`, `attempt`, `createdAt`, `comparisonId`, `pending`, `rejected`, and for pull requests `pullRequestNumber` and `title`.
Per project: `repository`, `baselineRevision`, `snapshotId`, `promotionId`.

The client does not use `comparisonId`, `snapshotId`, or `promotionId`. The API has no author, no branch, no total view count, no thumbnail, no update time, and no GitHub URL. The viewer login is known on the server (`identity.login`) but is not in the answer.

### Request walk-through: first load of `/` for a signed-in maintainer

1. Browser requests `GET /`. `server.ts:106-118` sends every non-API path to `render(request)`. No session check runs for the document. The server renders `Index` with the `loading` state. The HTML contains the header and the text "Checking access and loading runs…" and no run data (measured, see Measurements M1).
2. Browser downloads the scripts and hydrates.
3. After hydration, the effect at `index.tsx:176-210` sends `GET /api/runs`.
4. Server side of `/api/runs`, in order (all sequential):
   1. `api/index.ts:110-112` origin check.
   2. `api/index.ts:123-126` skips `assertConfiguredProject` for this route (one D1 read saved).
   3. `api/index.ts:130` `createAuth(...)`.
   4. `api/index.ts:191` `createGitHubClient(...)`. It hashes the private key with SHA-256 (`packages/security/src/github.ts:116-119`). No network.
   5. `api/index.ts:194-205` `requireMaintainer(...)`:
      - `auth.api.getSession` with `disableCookieCache: true` (`authorization.ts:32-36`). At least one D1 round trip.
      - `SELECT accountId FROM account ...` (`authorization.ts:40-43`). One D1 round trip.
      - Permission cache per isolate, 60 s for reads (`authorization.ts:21`, `60-70`). On a miss: GitHub installation token if not cached (`github.ts:134-143`), `GET /user/{id}` if there is no login hint (`github.ts:251`), `GET /repos/{repo}/collaborators/{login}/permission` (`github.ts:214-219`). That is 1 to 3 GitHub requests, one after the other.
   6. `review.ts:732-734` calls `dashboard()`. One D1 batch with three statements (`dashboard.ts:68-81`).
5. Client parses the answer and renders the queue.
6. Only now does `OperationsAttention` mount (`index.tsx:254-256`, it needs `state.status === "ready"`). It sends `GET /api/operations`. The server runs `requireMaintainer` again (session read plus account read), then the alert queries. It repeats every 60 s (`operations-attention/index.tsx:280`).

Count for one dashboard load on a warm isolate: 1 document, 2 API requests in sequence, at least 6 D1 round trips (3 for each API request). On a cold isolate add up to 3 GitHub requests.

### What happens after the first load

- Header link "Run history" or "Service status": the links are plain anchors (`app-shell.tsx:15-19`, `52-63`). The browser loads a new document. Steps 1 to 6 run again (measured, M3).
- In-page link "View history": a router `Link` (`index.tsx:549`). No request. The table shows at once (measured, M3).
- "Refresh runs": the state goes to `loading`. The whole page body and three header items disappear until the answer arrives. `OperationsAttention` unmounts, mounts again, and requests `/api/operations` again (measured, M4).
- "Review changes" or "Open run": router `Link` to `/runs/$runId`. That route starts its own fetch and shows "Checking access and loading this run…" (`runs.$runId.tsx:70`).
- Nothing polls `/api/runs`. A run that is "Comparing images" stays like that until the maintainer clicks "Refresh runs".

## Findings

### DASH-01 · The dashboard HTML has no data; content waits for hydration and then for `/api/runs`

- Kind: performance
- Severity: high. Confidence: high. Measured: yes (local dev server only). Effort: M
- Evidence:
  - `apps/web/src/routes/index.tsx:39-44`: the route has `validateSearch` and `component` only. There is no `loader`.
  - `apps/web/src/routes/index.tsx:161`: `useState<DashboardState>({ status: "loading" })`.
  - `apps/web/src/routes/index.tsx:176-184`: `useEffect(() => { ... await fetch("/api/runs", { credentials: "same-origin", cache: "no-store", ...`.
  - `apps/web/src/routes/index.tsx:275-279`: `<Text render={<p />} className="py-12 ak-ink-60" role="status">Checking access and loading runs…</Text>`.
  - M1: the server HTML for `/` contains "Checking access and loading runs…" one time and no run text.
  - M2: on the local dev server the loading text paints at about 76 ms, the `/api/runs` request starts at about 235 ms, and the content shows at about 268 ms. With 600 ms added to `/api/runs`, content shows at about 909 ms. Content time = hydration time + API time + about 30 ms.
  - Screens: `01-loading--dark-desktop.png`, `01-loading--light-desktop.png`, `sheets/mobile-01.png`.
- What happens: The server sends a page that says "Checking access and loading runs…". The browser must download and run the JavaScript before it can even ask for the runs. Then the API does its session check, its account check, maybe a GitHub call, and the query. Only then does the page show something useful. The loading state is one line of gray text in the top-left corner of an empty page. When the data arrives, the whole layout appears at once.
- Impact: Every visit pays two network round trips in sequence plus hydration before the first useful paint. The text "Checking access" tells the maintainer that the app is slow because of a security check. This is the maintainer's complaint 1. The same pattern is in `runs.$runId.tsx:70` and `pulls.$pullNumber.tsx:179`.
- Recommendation: Load the dashboard data during the document request, so that the first HTML already has the queue or the sign-in screen. In TanStack Start this is a route `loader` that calls a server function. The server function runs `requireMaintainer` and `dashboard()` in the Worker that already renders the page.

  ```tsx
  // sketch
  const loadDashboard = createServerFn({ method: "GET" }).handler(async () => {
    // 401 -> { status: "guest" }, 403 -> { status: "forbidden" }, else { status: "ready", ... }
  });
  export const Route = createFileRoute("/")({
    validateSearch,
    loader: () => loadDashboard(),
    staleTime: 15_000, // keeps queue <-> history <-> run navigation instant
    component: Index,
  });
  ```

  Show a skeleton with the final row geometry for the cases that still wait (client navigation with a cold cache).

- Alternatives:
  1. Minimal: keep the client fetch but start it before hydration. Put a small inline script in `<head>` (the nonce is available, see `__root.tsx:23-26`) that does `window.__runs = fetch("/api/runs", ...)`. The effect then awaits that promise. The API request then runs in parallel with the script download. Add a skeleton.
  2. Keep the last good answer in memory (or `sessionStorage`) and paint it at once, then revalidate. This makes back navigation from a run instant.
  3. Change only the copy and the visual: a skeleton and no "Checking access" text. This does not shorten the wait.
- Maintainer decision needed: yes. Is it acceptable to do the session and permission check during the document request (server render with data), or must the document stay data-free?

### DASH-02 · Header navigation reloads the whole document, although both lists are already in memory

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/components/app-shell.tsx:15-19`: `{ id: "history", href: "/?view=history", ... }`.
  - `apps/web/src/components/app-shell.tsx:52-57`: `<NavLink key={id} href={href} aria-label={label} aria-current={...}>`. No router `Link`.
  - `apps/web/src/components/app-shell.tsx:29`: `<ControlButton $p={1} render={<a href="/" />} aria-label="Visonaut review queue">`.
  - `apps/web/src/routes/index.tsx:549`: `render={<Link to="/" search={{ view: "history" }} />}` (the footer link, which is a client navigation).
  - `apps/web/src/routes/index.tsx:365-373`: queue and history both render from the same `state` (`state.actionable`, `state.runs`).
  - M3: a click on the header link "Run history" makes a new document request and new `/api/runs` requests. A click on the footer link "View history" makes none.
- What happens: "Review queue", "Run history", and "Service status" are three views of one route. The data for queue and history comes from one answer. But the header links are plain `<a href>` elements. Each click throws the page away, renders "Checking access and loading runs…" again, hydrates again, and fetches the same data again.
- Impact: Moving between the two main views costs a full page load each time. The footer link proves that the same move can be instant.
- Recommendation: Render the header links through the router.

  ```tsx
  <NavLink
    key={id}
    render={<Link to="/" search={{ view: id === "queue" ? undefined : id }} />}
    aria-current={active === id ? "page" : undefined}
  >
  ```

  The logo link needs the same change. On the run page, the same header then also needs the dashboard data cache from DASH-01 to be instant.

- Alternatives:
  1. Keep anchors but add `router.preloadRoute` on hover. This still reloads the document.
  2. Merge queue and history into one view (see Redesign idea 5). Then there is no navigation at all.
- Maintainer decision needed: no.

### DASH-03 · "Refresh runs" blanks the page and three header items, and reloads the alerts

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:242-245`: `const refresh = () => { setState({ status: "loading" }); setReload((value) => value + 1); };`
  - `apps/web/src/routes/index.tsx:251`: `repository={state.status === "ready" ? state.repository : undefined}`.
  - `apps/web/src/routes/index.tsx:254-257`: the bell needs `state.status === "ready"`, and the account menu needs `state.status !== "loading"`.
  - Screens: `22-refresh-reloading--dark-desktop.png` against `11-queue-8--dark-desktop.png`.
  - M4: `/api/operations` loads go from 1 to 2 after one click on "Refresh runs".
- What happens: A click on "Refresh runs" removes the list, the counters, the page title, the repository name in the header, the bell, and the account menu. The page shows "Checking access and loading runs…" until the answer arrives. The scroll position is lost. The bell component mounts again and sends its own request. The history search text and filter are also lost, because `RunHistory` unmounts.
- Impact: Refresh is the only way to see progress of a running capture (see DASH-19), so the maintainer uses it often. Each use is a full visual reset.
- Recommendation: Keep the current state on screen while the new answer loads. Replace the state only when the answer arrives. Show the busy state on the button.

  ```tsx
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => { setRefreshing(true); setReload((value) => value + 1); };
  // in load(): on success setState(parseDashboard(data)); in finally setRefreshing(false)
  <Button $border onClick={refresh} aria-busy={refreshing} disabled={refreshing}>
  ```

  On a failed refresh keep the stale list and show one inline message with Retry.

- Alternatives:
  1. Thin progress bar at the top of the list (the upstream `Progress` primitive) and no button state.
  2. Remove the button and refresh on window focus and on an interval (see DASH-19).
- Maintainer decision needed: no.

### DASH-04 · `/api/operations` waits for `/api/runs`, and the service view loads runs that it does not use

- Kind: performance
- Severity: medium. Confidence: high. Measured: no (counted from code). Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:254-256`: `{state.status === "ready" && !state.preview && view !== "service" && (<OperationsAttention onAccessDenied={onAccessDenied} />)}`.
  - `apps/web/src/routes/index.tsx:356-364`: the service page is inside the `state.status === "ready"` branch.
  - `apps/web/src/api/index.ts:194-205`: every private API request runs `requireMaintainer` (session read and account read).
- What happens: The alert request starts only after the runs request ends. For `?view=service`, the page first loads up to 100 history runs and all actionable runs, uses only `repository` and `preview` from that answer, and then starts the alert request.
- Impact: Two authenticated requests in sequence on each load. Count from the code: at least 3 D1 round trips for each request (session, account, data), so 6 or more for one dashboard load. The service page shows its content after two sequential API calls.
- Recommendation: Start both requests at the same time, or return the alert summary in the same answer as the runs. For the service view, do not call `dashboard()`.

  ```ts
  // one answer for the header and the list
  return { runs, actionable, project, viewer: { login }, alerts: { count, hasMore } };
  ```

- Alternatives:
  1. Minimal: mount `OperationsAttention` during `loading` too, and let it handle `401` and `403` as it already does (`operations-attention/index.tsx:239-242`).
  2. Add a small `GET /api/session` use (the endpoint exists at `review.ts:713-721`) for identity, and load runs and alerts in parallel.
- Maintainer decision needed: no.

### DASH-05 · Pull request titles are erased when the webhook is processed, so the queue shows "Pull request" as the title

- Kind: bug
- Severity: high. Confidence: high. Measured: yes (SQL behavior reproduced locally; production data not read). Effort: M
- Evidence:
  - `apps/web/src/api/dashboard.ts:57-62`: the title comes from `json_extract(delivery.payload_json,'$.pull_request.title') FROM github_webhook_delivery delivery WHERE delivery.event='pull_request' AND CAST(json_extract(delivery.payload_json,'$.repository.id') AS TEXT)=project.repository_id AND ...`.
  - `apps/web/src/api/review.ts:288`: the review page reads the title with the same query.
  - `apps/web/src/api/webhooks.ts:330-335`: at the end of `processWebhook`, for every event: `"UPDATE github_webhook_delivery SET processed_at = ?, payload_json = '{}' WHERE delivery_id = ? AND payload_digest = ?"`.
  - `apps/web/src/api/webhooks.ts:349-358`: `receiveWebhook` stores the delivery and calls `processWebhook` in `waitUntil` at once.
  - `docs/operations/compact-processed-webhooks.md`: "New deliveries retain their full JSON while `processed_at` is null and clear it in the same write that marks them processed."
  - History: `339926d` (Sep 28, "Compact processed webhook payloads (#129)") added the clearing. `5712036` (Sep 30, "#155") added the title query and the index `apps/web/migrations/0028_pr_title_index.sql`.
  - `apps/web/src/api/dashboard.test.ts:42-56`: the test inserts deliveries that are processed and still have the full payload. The production code cannot produce that row.
  - M5: after the processing `UPDATE`, the title query matches 0 rows and returns `NULL`.
  - `apps/web/src/routes/index.tsx:499`: `{run.title ?? kindLabel(run.kind)}`.
  - Screen: `12-queue-8-no-titles--dark-desktop--full.png` shows the result.
- What happens: The title lives only in the raw webhook payload. The payload is replaced by `{}` a moment after it arrives. After that, the query finds no row for the pull request. The API returns no `title`. The card then prints the kind as its title. Every pull request card has the heading "Pull request" in 24 px bold. The only thing that tells two cards apart is the small gray "#5300".
- Impact: The largest text on each card carries no information. The maintainer cannot scan the queue by topic. The history table shows "#5297 · Pull request" for each row. The review page falls back to "#N · Pull request visual review" (`review.ts:561`). Any redesign that depends on titles will look good with fixtures and bad in production until this is fixed.
- Recommendation: Store the title where it survives. The `pull_request` branch of `processWebhook` already fetches the pull request from GitHub (`webhooks.ts:282`: `const pull = object(await github.request(...))`), so `pull.title` is at hand.

  ```sql
  -- option A: keep only the three fields that the index and the query read
  UPDATE github_webhook_delivery
  SET processed_at = ?,
      payload_json = CASE WHEN event = 'pull_request' THEN json_object(
        'repository', json_object('id', json_extract(payload_json, '$.repository.id')),
        'pull_request', json_object(
          'number', json_extract(payload_json, '$.pull_request.number'),
          'title', json_extract(payload_json, '$.pull_request.title')))
      ELSE '{}' END
  WHERE delivery_id = ? AND payload_digest = ?;
  ```

- Alternatives:
  1. Option B: a small table `visonaut_pull_requests(project_id, number, title, author_login, head_ref, updated_at)` that the `pull_request` branch upserts. It also gives author and branch to the UI. The dashboard query then joins one table and the JSON index can go.
  2. Option C: a `title` column on `visonaut_runs`, written when the run is reserved. The title is then the title at capture time.
  3. Minimal: no storage change. Stop showing the kind as a heading when there is no title, and make "#5300" the heading.
- Maintainer decision needed: yes. Which store for the title: trimmed receipt (A), a pull request table (B), or a column on the run (C)? Old rows are already compacted, so old titles are gone in every option.

### DASH-06 · `ak-ink-danger`, `ak-ink-warning`, and `ak-ink-success` do not exist; errors and status icons have no color

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/node_modules/@ariakit/tailwind/src/output.css:816-821`: `@utility ak-ink-* { --_ak-text-alpha: calc(--value(number, "0", "5", ... "100") / 100); --_ak-text-alpha: --value([*]); ...`. The utility accepts a number or an arbitrary value. It has no color names.
  - `@ariakit/tailwind/readme.md:624`: "`ak-ink-<number>` | Requests a text alpha (`0`–`100`)". Line 226 shows the correct form: `class="ak-text ak-text-warning ak-text-25"`.
  - Uses: `apps/web/src/routes/index.tsx:271` (`ak-ink-danger`), `:331` (`ak-ink-warning`), `:531` (`ak-ink-success`); `apps/web/src/components/user-menu.tsx:66`; `apps/web/src/components/operations-attention/index.tsx:370`, `:501`.
  - M6: the page has 0 CSS rules for these three class names. The sign-in error has the computed color `oklch(1 0 0)` in dark and `oklch(0 0 0)` in light, the same as the body text.
  - Screens: `04-guest-sign-in-error--dark-desktop.png` (white error text), `05-forbidden--dark-desktop.png` (white warning icon), `08-queue-empty-baseline--dark-desktop.png` (white check icon), `24-user-menu-sign-out-error--dark-desktop.png`.
- What happens: Six elements ask for a danger, warning, or success color with a class that Tailwind does not generate. They render in the normal text color.
- Impact: Error messages do not look like errors. The warning icon and the success icon look the same as any other icon. The intent of the author is lost without any build error.
- Recommendation: Use the text recipe or the documented utilities.

  ```tsx
  <Text render={<p />} $text="danger" role="alert">{actionError}</Text>
  <CircleAlertIcon className="ak-text ak-text-warning" aria-hidden="true" />
  ```

- Alternatives:
  1. Put the message in a tinted layer (`<Frame $layer="danger" $mix={15}>`), as the badge recipe does.
  2. Add a lint rule or a test that fails on `ak-ink-[a-z]` class names.
- Maintainer decision needed: no.

### DASH-07 · `$layer="primary"` is not a recipe color; the main buttons paint a fixed pale gray in both schemes

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/components/ariakit/utils/styles.ts:6-13`: `COLOR_VALUES = ["canvas", "brand", "secondary", "success", "warning", "danger"]`. There is no `"primary"`.
  - `apps/web/src/routes/index.tsx:301`, `:310`, `:346`, `:508`: `$layer="primary"`. Also `apps/web/src/routes/pulls.$pullNumber.tsx:194`, `:226`.
  - `apps/web/src/review/review-workspace.tsx:1081`, `:1283` and `apps/web/src/components/app-shell.tsx:30` use `$layer="brand"`.
  - M6: the "Review changes" link has the inline style `--layer-color: primary;` and the computed background `oklch(0.949994 0.0000497986 23.7884)` in dark and in light. The logo slot with `$layer="brand"` has `oklch(0.515341 0.1546 248.516)`.
  - Screens: `02-guest--light-desktop.png`, `05-forbidden--light-desktop.png`, `11-queue-8--light-desktop.png`.
- What happens: The recipe treats an unknown string as a raw CSS color. `primary` is not a CSS color, so the layer falls back to a near-white gray. In dark mode this looks like a white button, which works by accident. In light mode the "primary" button is a pale gray box on a white card. In the forbidden card, "Retry" (white with a border) and "Use another account" (gray fill) have almost the same weight. In light mode the shield icon box on the sign-in card is invisible.
- Impact: The main action on each screen has little or no emphasis in light mode. The brand color shows only in the logo. The review workspace uses `brand`, so the two pages do not match.
- Recommendation: Use a name that the recipe knows.

  ```tsx
  <Button $layer="brand" render={<Link to="/runs/$runId" params={{ runId: run.id }} />}>
  ```

- Alternatives:
  1. Decide that the main action is a neutral high-contrast button, and express that with documented variants (for example `$layer $contrast`), not with an invalid color.
  2. Make the variant type reject unknown names (`ColorValues | \`var(--${string})\` | \`#${string}\``) so that this fails in `tsc`.
- Maintainer decision needed: yes. Should the main action be brand blue or a neutral inverted button?

### DASH-08 · Review cards are 240 px tall; a queue of 40 runs is 8.5 screens long

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/routes/index.tsx:475-484`: each run is `<Frame $layer $lighten $border $rounded="2xl" $p={6} render={<article />} className="grid gap-5">`.
  - `apps/web/src/routes/index.tsx:495-499`: the title is `text-xl sm:text-2xl font-semibold`.
  - M7: card height 240 px (272 px with a two-line title) at 1440 px wide. First card starts at y = 361 of 900. Two cards fit in the first screen. On a 390 px phone the first card starts at y = 398 of 844, cards are 236 to 376 px tall, and one card fits.
  - M7: 8 actionable runs give a 1,880 px page. 40 actionable runs give 7,608 px on desktop (8.5 screens) and 9,245 px on mobile (11 screens).
  - `apps/web/src/api/dashboard.ts:70-75`: the actionable query has no `LIMIT`. `dashboard.test.ts:66` expects 101 rows.
  - Screens: `11-queue-8--dark-desktop--full.png`, `13-queue-40--dark-desktop--full.png`, `13-queue-40--dark-mobile--full.png`.
- What happens: Each run to review is a large card with five rows: icon and badge, title, sentence, identity line, button. The card holds five facts (number, title, pending count, commit, time). The first 40% of the first screen is page header and counters.
- Impact: The maintainer sees one or two runs at a time and must scroll to learn what is in the queue. The history table shows the same facts in 64 px. The queue, which is the work list, is the least dense view of the app.
- Recommendation: Use one row for each run, 40 to 56 px tall, with the whole row as the link. See Redesign ideas 1, 3, and 5. With 44 px rows, 40 runs fit in about 2 screens.
- Alternatives:
  1. Keep cards but make them two lines (title line, meta line) at about 72 px.
  2. Keep one large card only for the next run and compact rows for the rest (Redesign idea 2).
  3. Minimal: reduce padding to `$p={4}`, the title to `text-base`, and drop the sentence and the icon box. About 120 px.
- Maintainer decision needed: yes. How many runs wait in the queue on a normal day? The right density depends on that number.

### DASH-09 · The same facts are stated two to five times; most words on screen can go

- Kind: copy
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence (word counts from `document.querySelector("main").innerText`, M8):

  | State             | Words in main | Words that carry data     |
  | ----------------- | ------------- | ------------------------- |
  | Loading           | 5             | 0                         |
  | Sign-in           | 34            | 4 ("Sign in with GitHub") |
  | Forbidden         | 18            | about 8                   |
  | Error             | 16 to 19      | about 8                   |
  | Queue, empty      | 38            | about 5                   |
  | Queue, 1 run      | 55            | about 18                  |
  | Queue, 8 runs     | 222           | about 110                 |
  | Queue, 40 runs    | 926           | about 470                 |
  | History, 0 runs   | 42            | 0                         |
  | History, 1 run    | 61            | about 17                  |
  | History, 100 runs | 2,082         | about 2,040               |
  - Count of runs, three times: `index.tsx:437` "4 runs are ready for review.", `:452` "4 / Runs to review", `:471` "Ready to review" above four cards.
  - State of one run, three times in each card: `:492` badge "Needs review", `:502` "3 views await approval.", `:512` button "Review changes".
  - Repository, two times at 1280 px and wider: `app-shell.tsx:37-41` and `index.tsx:429-431`. Three times in preview: header "Preview fixtures", notice "Preview fixtures · GitHub login is disabled" (`index.tsx:360`), eyebrow "PREVIEW FIXTURES" (screen `25-preview-queue--dark-desktop.png`).
  - "Nothing to do", five times in the empty queue: "No runs need a decision or recovery." (`:440`), three zero counters (`:452-454`), "All reviews are complete." (`:533`). Screen `08-queue-empty-baseline--dark-desktop.png`.
  - Page name, two times: nav item "Review queue" and `h1` "Your review queue." (`:432-434`). Same for "Run history" (`:630-632`).
  - History scope, three times: "Results for the latest 100 runs." (`:634`), placeholder "Search loaded history…" (`:658`), "Search and filters apply to the loaded runs." (`:748`).
  - History link, two times: nav item and footer button "View history" (`:549-554`).

- What happens: The page explains itself in sentences and then shows the same thing as numbers and again as a list.
- Impact: This is the maintainer's complaint 2. With one run in the queue, 55 words are on screen and 18 are data. The fixed page chrome is 30 words before the first run.
- Recommendation: Remove these words (queue with one run, 55 words):

  | Text                                                                      | Words | Why it can go                                                               |
  | ------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------- |
  | "ARIAKIT/ARIAKIT" eyebrow                                                 | 1     | Already in the header                                                       |
  | "Your review queue."                                                      | 3     | Same as the active nav item                                                 |
  | "1 run is ready for review."                                              | 6     | Same as the counter and the list                                            |
  | "Runs to review", "Awaiting approval", "Rejected views" and three numbers | 10    | The list shows it; keep one inline summary or put the counts in filter tabs |
  | "READY TO REVIEW"                                                         | 3     | Not needed when there is one group                                          |
  | "Needs review" badge                                                      | 2     | Implied by the group; keep a badge only for exceptions such as "Rejected"   |
  | "views await approval."                                                   | 3     | Replace with "3 views"                                                      |
  | "Attempt"                                                                 | 1     | Show only when the attempt is 2 or more                                     |
  | "2026,"                                                                   | 1     | Use a relative time ("6m")                                                  |
  | "Review changes"                                                          | 2     | The row is the link                                                         |
  | "Baseline revision 42"                                                    | 3     | Belongs to Service status or a tooltip                                      |
  | "View history"                                                            | 2     | Same as the nav item                                                        |
  | "Refresh runs"                                                            | 2     | Icon button with the label "Refresh"                                        |

  What stays: `#5300 Fix Combobox popover position inside a scrolling Dialog · 3 views · ede2f70 · 6m`. That is about 16 words for one run, down from 55.

- Alternatives:
  1. Keep the counters and remove the sentence and the section label.
  2. Keep the sentence and remove the counters.
  3. Hide zero counters only.
- Maintainer decision needed: yes. Is the `h1` required on each page for brand voice, or can the navigation be the page title (with a visually hidden `h1` for assistive technology)?

### DASH-10 · Failed and stale runs are at the bottom, with a clock icon and no color

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:542-543`: `{inProgress.length > 0 && <RunGroup title="In progress" ... />}` then `{recovery.length > 0 && <RunGroup title="Needs attention" ... />}`, both after the review cards.
  - `apps/web/src/routes/index.tsx:580-582`: every row in both groups uses `<Clock3Icon size={18} aria-hidden="true" />`.
  - `apps/web/src/routes/index.tsx:588-590`: `{stateLabel(run.state)} · Attempt {run.attempt}` in `text-xs ak-ink-60`. No commit, no time, no color.
  - Screen `13-queue-40--dark-desktop--full.png`: "Needs attention" starts at about y = 6,650 of 7,608.
  - Screen `11-queue-8--dark-desktop--full.png`: "Run failed · Attempt 1" looks the same as "Comparing images · Attempt 1".
- What happens: A run that failed and a run that is still comparing have the same icon and the same gray text. The group named "Needs attention" is the last thing on the page.
- Impact: The maintainer can miss a failed run. With a long queue it is several screens below the fold.
- Recommendation: Give each state its own mark and color (see DASH-11), show commit and age in every row, and let the maintainer see the count of failed runs without scrolling (group headers with counts, or filter tabs).
- Alternatives:
  1. Move "Needs attention" above "Ready to review".
  2. Keep the order and add a one-line summary at the top: "2 runs need attention" that jumps to the group.
- Maintainer decision needed: yes. Which group comes first: work to review or work that is broken?

### DASH-11 · Eight run states share four looks, and the same badge has two shapes

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:142-151`: `needs-review`, `comparing`, `incomplete` all return `"warning"`. `failed`, `rejected`, `needs-recompare` all return `"danger"`. Other states return `undefined`.
  - `apps/web/src/routes/index.tsx:385-386`: the icon is a check for `passed`, an alert for danger, and a clock for everything else.
  - `apps/web/src/routes/index.tsx:132`: `if (state === "needs-review" || state === "reviewing") return "Needs review";` but `stateColor` has no `reviewing` branch.
  - `packages/service/src/review-status.ts:50-58`: the server type has no `"reviewing"` status. `apps/web/src/review/preview-fixtures.ts:84` sends `state: "reviewing"`.
  - M9: the `RunStatus` badge has a border radius of `3.35544e+07px` (a pill) in a queue card and `2px` in the history table. Same component, same `$rounded="full"` (`index.tsx:388`).
  - Screens: `19-history-100--dark-desktop--full.png` (yellow clock for "Needs review", "Comparing images", and "Waiting for screenshots"), `25-preview-queue--dark-desktop.png` (gray "Needs review") against `10-queue-1--dark-desktop.png` (yellow "Needs review"), `18-history-8--dark-desktop.png` (square badges).
- What happens: Yellow with a clock means "you must act" and also "the system is working". Red with an alert means "a person rejected this", "the run broke", and "the baseline moved". In the preview, "Needs review" is gray. In the table the pill becomes a rectangle.
- Impact: Color and icon do not help the maintainer scan. The label must be read each time.
- Recommendation: One mark for each state, one mapping in one place, and the same shape everywhere.

  | State             | Label     | Mark                                  | Tone    |
  | ----------------- | --------- | ------------------------------------- | ------- |
  | `needs-review`    | Review    | filled dot                            | warning |
  | `rejected`        | Rejected  | cross                                 | danger  |
  | `comparing`       | Comparing | spinner (upstream `ProgressCircular`) | neutral |
  | `incomplete`      | Capturing | dashed circle                         | neutral |
  | `needs-recompare` | Recapture | refresh arrow                         | warning |
  | `failed`          | Failed    | alert                                 | danger  |
  | `passed`          | Passed    | check                                 | success |
  | `superseded`      | Replaced  | forward arrow                         | muted   |

- Alternatives:
  1. Text only with a colored dot in front (no badge surface). Less ink in a dense list.
  2. Icon only with a tooltip (upstream `Tooltip`), label visible on wide screens.
- Maintainer decision needed: no.

### DASH-12 · Only 1.7% of a review card is clickable; history rows link the text block only; link names repeat

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:507-516`: the only link in a card is the "Review changes" button.
  - `apps/web/src/routes/index.tsx:707-711`: the history link is in the first cell with `max-w-[38rem]`.
  - M9: card 1120 x 240 px, link 142 x 33 px, share 0.017. History row 1118 x 64 px, link 608 x 42 px (36% of the row).
  - M9 tab order: `a: Review changes` four times, then `a: Open run` four times.
  - `apps/web/src/routes/index.tsx:405`: `<Text render={<time />}>` has no `dateTime` attribute (M9: `dateTime: null`).
- What happens: A click on the title, the badge, or the card does nothing. In the history table a click on the badge or the date does nothing. A screen reader user who lists the links hears "Review changes" four times with no run name.
- Impact: Slower pointer use (small target, Fitts's law) and ambiguous link names.
- Recommendation: Make the title the link and stretch it over the row, or render the row itself as a link. Put the title in the link name.

  ```tsx
  <li className="relative">
    <Link to="/runs/$runId" params={{ runId: run.id }} className="after:absolute after:inset-0">
      #{run.pullRequestNumber} {run.title}
    </Link>
    <time dateTime={new Date(run.createdAt).toISOString()}>{ago(run.createdAt)}</time>
  </li>
  ```

- Alternatives:
  1. Keep the button and add `aria-describedby` that points to the title.
  2. Use the vendored `NavLink` rows inside a vertical `Nav`, which already gives full-row hit areas, hover, and a focus ring.
- Maintainer decision needed: no.

### DASH-13 · Runs without a title print the kind twice; the icon is always a pull request; nothing links to GitHub

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:487`: `<GitPullRequestIcon size={18} aria-hidden="true" />` for every review card.
  - `apps/web/src/routes/index.tsx:490`: `{run.pullRequestNumber ? \`#${run.pullRequestNumber}\` : kindLabel(run.kind)}`and`:499`: `{run.title ?? kindLabel(run.kind)}`.
  - `apps/web/src/routes/index.tsx:402`: `<code title={run.testedSha}>{run.testedSha.slice(0, 12)}</code>`. Plain text.
  - `apps/web/src/routes/index.tsx:404`: `<Text>Attempt {run.attempt}</Text>` always.
  - `apps/web/src/routes/index.tsx:153-157`: `date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })`.
  - Screen `11-queue-8--dark-desktop--full.png`: the fourth card reads "Main" (label) and "Main" (title) with a pull request icon. "Merge queue" in "Needs attention" has no commit and no time.
- What happens: A run on `main` shows "Main" two times and nothing else that identifies it. The pull request number and the commit are not links, although the repository name is known. The date is absolute and has the year.
- Impact: Small costs on each scan. The maintainer cannot jump to the pull request on GitHub.
- Recommendation: For `main` and merge-queue runs use the short commit as the title. Link `#5300` to `https://github.com/{repository}/pull/5300` and the commit to `/commit/{sha}` (upstream `Link` primitive). Use 7 characters for the commit. Show the attempt only when it is 2 or more. Show a relative time with the absolute time in `title` and `dateTime`.
- Alternatives:
  1. Add the commit subject to the API so that `main` runs have a real title.
  2. Keep absolute times in history and relative times in the queue.
- Maintainer decision needed: no.

### DASH-14 · Copy defects: wrong plural, wrong claim for a first-time visitor, lost server message, error far from its button

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:502`: `{run.pending} view{run.pending === 1 ? "" : "s"} await approval`. Screen `13-queue-40--dark-desktop.png`: "1 view await approval."
  - `apps/web/src/routes/index.tsx:171` and `:192`: "Your repository access changed. Write access to this repository is required." for every `403`.
  - `apps/web/src/api/index.ts:111`: `throw new SecurityError("wrong_origin", 403, "The application origin is not allowed.")`. `packages/security/src/authorization.ts:46`: `"invalid_identity", 403, "A GitHub identity is required."`. `packages/security/src/github.ts:227`: `"not_maintainer", 403, "Repository write permission is required."`. All three give the same text on screen.
  - `apps/web/src/routes/index.tsx:196`: `if (!response.ok) throw new Error("The run list is temporarily unavailable. Please retry.")`. The body is not read. `apps/web/src/api/index.ts:73-83` sends `reference: failure.correlationId` in the 503 body. `dashboard.ts:83` can send `409 incomplete` and `dashboard.ts:85-89` a `503 repository_configuration`; both show "temporarily unavailable. Please retry."
  - `apps/web/src/routes/index.tsx:270-274`: the sign-in error renders at the top of `main`. M6: the error is at x = 160, y = 69; the button is at x = 774, y = 363. Screen `04-guest-sign-in-error--dark-desktop.png`.
  - `apps/web/src/routes/index.tsx:333-335`: "Repository access required" does not name the repository, because `repository` is known only in the `ready` state.
- What happens: "1 view await approval." is wrong grammar. A person who never had access reads "Your repository access changed". A configuration error asks the maintainer to retry. The support reference that the server sends is dropped, although the review page shows it (`route.browser.test.ts:75`). The sign-in error appears in a corner and pushes the page down by 38 px.
- Impact: Wrong or unhelpful messages at the moments when the maintainer needs help.
- Recommendation:

  ```tsx
  // count
  `${run.pending} ${run.pending === 1 ? "view" : "views"}`;
  // 403
  ("Write access to ariakit/ariakit is required.");
  // other failures: read the body
  const body = await response.json().catch(() => null);
  throw new DashboardError(
    body?.error?.message ?? "The service is unavailable.",
    body?.error?.reference,
  );
  ```

  Put the sign-in error under the sign-in button. Send the repository name with the `401` and `403` answers, or put it in the server-rendered page.

- Alternatives:
  1. Map error codes to messages on the client and keep the server text out of the UI.
  2. Minimal: fix the plural and the 403 sentence only.
- Maintainer decision needed: no.

### DASH-15 · The sign-in screen is a marketing page for one button

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:281-319`: eyebrow "Visual regression review", `h1` "Every change. A clear decision.", a paragraph, then a card with an icon box, an `h2` "Review visual changes.", a second paragraph, and the button.
  - M8: 34 words; the action is 4 of them.
  - `apps/web/src/routes/index.tsx:249-251` and `app-shell.tsx:52-63`: the header shows "Review queue", "Run history", "Service status" to a guest. Each link reloads the same sign-in screen (DASH-02).
  - Screens: `02-guest--dark-desktop.png`, `02-guest--light-desktop.png`, `sheets/mobile-01.png`. The content sits in the top third of the screen. On mobile the button is the last element.
- What happens: A person who opened a review link from a GitHub check sees a slogan, two headings, and two paragraphs. The repository is not named. The navigation offers three places that the guest cannot open.
- Impact: This is an internal tool behind a GitHub login. The copy sells a product to someone who already uses it. The requirement that matters ("write access to this repository") does not say which repository.
- Recommendation: One centered card: product mark, "Sign in with GitHub", and one line: "Requires write access to ariakit/ariakit." Hide the navigation for guests. Keep the return path in the button, as today (`index.tsx:218`).
- Alternatives:
  1. Split layout with a real product screenshot on one side.
  2. Skip the screen: when the document request has no session, redirect to the GitHub sign-in at once and return to the same URL. This needs the server-side check from DASH-01.
- Maintainer decision needed: yes. Is the slogan wanted, and may a signed-out visitor be sent to GitHub without a click?

### DASH-16 · "Use another account" probably returns the same account

- Kind: ux
- Severity: medium. Confidence: medium. Measured: no. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:344-351`: the button calls `signOut()`, which ends the Visonaut session and shows the sign-in screen.
  - `packages/security/src/auth.ts:29-35`: the GitHub provider has `clientId`, `clientSecret`, and `scope` only. It does not set `prompt`.
  - Not verified against GitHub: GitHub's authorize page reuses the browser's GitHub session unless `prompt=select_account` is sent.
  - `apps/web/src/routes/index.tsx:257-263`: the forbidden screen also shows the account menu, so there are two sign-out paths on the screen.
- What happens (expected, not observed): The maintainer clicks "Use another account", then "Sign in with GitHub". GitHub signs in the same GitHub user without a question. The forbidden screen returns.
- Impact: A loop for the person who has two GitHub accounts. The screen also does not say which account is signed in (DASH-17).
- Recommendation: Send `prompt: "select_account"` for this path, and show the signed-in login on the forbidden screen: "Signed in as @login. Write access to ariakit/ariakit is required."
- Alternatives:
  1. Replace the button with the text "Sign out, then switch accounts on github.com".
  2. Link to the repository settings page for access requests.
- Maintainer decision needed: yes. Please confirm the GitHub behavior in a real browser before any change.

### DASH-17 · The account menu never shows who is signed in

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/components/user-menu.tsx:24`: `const accountLabel = preview ? "Preview account" : login ? \`@${login}\` : "Account";`
  - `apps/web/src/routes/index.tsx:258-263` and `apps/web/src/routes/runs.$runId.tsx:207-212`: no caller passes `login`.
  - `apps/web/src/api/review.ts:713-721`: `GET /api/session` returns `login`. `apps/web/src/server.ts:88-105`: `GET /api/me` returns `userId`. No client code calls either (`rg '/api/session|api/me' apps/web/src` finds only the two server definitions).
  - `packages/security/src/github.ts:229`: the identity for each private request has `login` and `role`.
  - Screens: `23-user-menu-open--dark-desktop.png`: a popover with the heading "Account", the text "Manage your GitHub session.", and one item "Sign out".
- What happens: The header says "Account". The popover says "Account" again, explains itself, and has one action. The server knows the login during `/api/runs` but does not send it. The `@login` branch in `UserMenu` is dead code.
- Impact: The maintainer cannot check which GitHub account is active. This matters on the forbidden screen. The popover is 8 words of chrome for one action.
- Recommendation: Add `viewer: { login }` to the `/api/runs` answer (no extra query: `context.identity.login` is in scope at `review.ts:732`). Show the avatar (`https://github.com/{login}.png?size=40`, check the CSP first) and the login. Remove the description line.
- Alternatives:
  1. Replace the popover with an icon button "Sign out" that has a tooltip.
  2. Remove `/api/me` and `/api/session` if nothing external uses them (another lane may own this).
- Maintainer decision needed: no.

### DASH-18 · History: client-side search over 100 rows, explained three times, with a layout that moves with the data

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/api/dashboard.ts:69`: `readRuns("ORDER BY created_at DESC LIMIT 100")`. There is no page parameter.
  - `apps/web/src/routes/index.tsx:616-622`: the filter compares `run.state === filter` and searches title, number, full commit, and kind label.
  - `apps/web/src/routes/index.tsx:681`: options come from `[...new Set(runs.map((run) => run.state))]` in data order.
  - `apps/web/src/routes/index.tsx:661`: the search input has `outline-none focus-visible:underline`. M6: on focus the input has `text-decoration: underline`, the wrapper has `outline-style: none`.
  - M6 and screens `16-history-0`, `17-history-1`, `18-history-8`: the select is 150, 174, and 238 px wide for 0, 1, and 8 runs. Header cells are 715 / 226 / 177 px with 8 runs and 435 / 324 / 360 px in the preview (`26-preview-history--dark-desktop.png`). `table-layout` is `auto`.
  - M7: rows are 64 px on desktop (8 in the first screen) and 83 to 243 px on mobile (3 in the first screen). 100 rows are 6,963 px on desktop and 12,782 px on mobile.
  - M9: the commit in the row header cell has `font-weight: 600`.
  - `apps/web/src/routes/index.tsx:645-688`: the search field and the select show also when there are 0 runs (screen `16-history-0--dark-desktop.png`).
- What happens: The history page loads the latest 100 runs and filters them in the browser. Three texts explain that limit. Runs older than the latest 100 cannot be reached unless they still need work. The result filter lists only the states that happen to be in the data, in the order that they happen to appear, so the control changes width and order between visits. The table columns move when the filter changes. The only focus sign on the search field is an underline under the typed text. There is no count such as "7 of 100". On a phone a row is 123 px or more and the badge wraps to two lines.
- Impact: The page is hard to scan on a phone, unstable on desktop, and silent about how much it shows.
- Recommendation: Fixed filter set as tabs or chips with counts ("All 100 · Review 6 · Passed 61 · Failed 8"), a search field built with the upstream `Input` primitive (it has a focus ring on the wrapper), fixed column widths (`table-fixed` with `<colgroup>`), a count line, and a "Load older" control or a `before=` cursor in the API. On a phone use a list row and not a two-column table.
- Alternatives:
  1. Merge history into the queue page (Redesign idea 5).
  2. Group by pull request with attempts nested (Redesign idea 7).
  3. Minimal: fixed option list, `table-fixed`, a visible focus ring, and one explanation ("Latest 100 runs").
- Maintainer decision needed: yes. Is history beyond 100 runs needed in the UI? If yes, the API needs a cursor.

### DASH-19 · The run list never updates on its own

- Kind: ux
- Severity: medium. Confidence: high. Measured: no (read from code). Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:176-210`: the effect depends on `[reload]` only. No timer, no focus listener.
  - `apps/web/src/components/operations-attention/index.tsx:280`: `timeout = setTimeout(load, 60000);` (the alerts do poll).
  - `apps/web/src/routes/index.tsx:133-134`: states "Waiting for screenshots" and "Comparing images" exist to show progress.
- What happens: A run that is "Comparing images" stays like that. A new run does not appear. The maintainer must click "Refresh runs", which blanks the page (DASH-03).
- Impact: The maintainer waits on a screen that does not change, or refreshes again and again.
- Recommendation: Revalidate on window focus, and poll every 10 to 15 s while at least one run is `comparing` or `incomplete` and the tab is visible. Show "Updated 12 s ago". One poll costs the same as one `/api/runs` (at least 3 D1 round trips), so stop when nothing is in progress.
- Alternatives:
  1. Poll at the same 60 s as the alerts, in the same request (see DASH-04).
  2. A small `GET /api/runs/changes?since=` endpoint that returns only a revision number, so that most polls are one cheap read.
- Maintainer decision needed: yes. What polling cost is acceptable?

### DASH-20 · The dashboard hand-writes typography, fields, and lists; the matching primitives are not vendored

- Kind: simplification
- Severity: medium. Confidence: high. Measured: yes (counts). Effort: L
- Evidence (counts with `rg -c` on `apps/web/src/routes/index.tsx`, M10):
  - 38 `<Text` uses; 27 of them carry `render={<h…/>}` or `render={<p />}` with Tailwind type classes such as `text-3xl sm:text-4xl font-semibold tracking-tight mt-3`.
  - 24 uses of `ak-ink-60`. 5 copies of `text-xs uppercase tracking-widest ...`.
  - 18 raw `<div>` wrappers for layout.
  - `apps/web/src/routes/index.tsx:646-663`: a native `<input>` inside `<Frame render={<label />}>`. `:664-687`: a native `<select>` inside a second `Frame`.
  - `apps/web/src/routes/index.tsx:427-449` and `:625-644`: the page header block (eyebrow, `h1`, paragraph, Refresh button) is written two times. `operations-attention/index.tsx:310-323` has a third copy.
  - `apps/web/src/routes/index.tsx:248`, `:269`: class names `dashboard` and `dashboard-main` have no CSS (`rg 'dashboard' apps/web/src --glob '*.css'` finds nothing; `apps/web/src/review.css` has two `@import` lines).
  - Vendored components (`apps/web/src/components/ariakit/components`): badge, button, disclosure, frame, kbd, layer, nav, popover, shell, table, tabs, text-frame, text. Upstream also has checkbox, code, combobox, dialog, heading, input, link, list, option, progress, prose, radio, separator, tooltip (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components`).
- What happens: The page uses `Frame`, `Text`, `Button`, `Badge`, and `Table`, but most of the look comes from Tailwind classes on `Text` and from raw elements. Headings, the search field, the run lists, the links, and the dividers have no primitive in the vendored copy, so each one is written by hand.
- Impact: The page does not look like an Ariakit UI page. The same class strings repeat. The search field has no proper focus ring (DASH-18). A change to the type scale needs edits in many places.
- Recommendation: Vendor `heading`, `input`, `link`, `list`, `separator`, `progress`, `tooltip`, and `code` from upstream (the NOTICE file pins `fc85b809`; a newer pin may be needed). Then build three small app components and use them on all pages: `PageHeader`, `RunRow`, `StatusMark`. Remove the dead class names.

  ```tsx
  <InputGroup>
    <InputSlot><SearchIcon /></InputSlot>
    <Input type="search" aria-label="Search runs" placeholder="Search" value={query} onChange={...} />
    <InputSlot><Kbd>/</Kbd></InputSlot>
  </InputGroup>
  ```

- Alternatives:
  1. Keep the vendored set and write local `PageHeader`, `RunRow`, `Field` components with the recipes that exist (`control`, `frame`, `text`).
  2. Depend on a published `@ariakit/ui` package when one exists, and delete the vendored copy.
- Maintainer decision needed: yes. Vendor more primitives now, or wait for a package?

### DASH-21 · Client and server disagree on the run contract; some branches cannot run

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `apps/web/src/api/dashboard.ts:12-24` exports `DashboardRun` with `kind: "main" | "pull_request" | "merge_group"` and `createdAt: number`. `apps/web/src/routes/index.tsx:46-57` declares its own `DashboardRun` with `kind: string`, `createdAt: string | number`, and no `comparisonId`.
  - `apps/web/src/routes/index.tsx:106`: `const actionable = Array.isArray(value.actionable) ? value.actionable.map(parseRun) : runs;`. The server always sends `actionable` (`dashboard.ts:139`). Only tests omit it (`route.browser.test.ts:97`, `:147`, `:190-203`). With the fallback, a `passed` run would be listed under "Ready to review" with a "Review changes" button (`index.tsx:422`).
  - `apps/web/src/routes/index.tsx:419-421`: the recovery filter includes `"superseded"`. The actionable query requires `active=1` (`dashboard.ts:70`) and `reviewStatus` returns `superseded` only when `!run.active` (`packages/service/src/review-status.ts:77`). The branch cannot match.
  - `apps/web/src/routes/index.tsx:132`: the `"reviewing"` label exists only for the preview fixture (`preview-fixtures.ts:84`).
  - `apps/web/src/api/dashboard.ts:128`, `:143-144`: `comparisonId`, `snapshotId`, `promotionId` are sent and never read by the client.
  - `apps/web/src/routes/index.tsx:139`: unknown states print as raw text (`state.replaceAll(...)`).
- What happens: The page validates the answer by hand against a type that it declares itself. The fixture and three tests use shapes that the server never sends.
- Impact: A change on the server does not fail the client build. The tests cover a fallback that production does not use.
- Recommendation: Move the response type to one shared module (for example `apps/web/src/api/dashboard-contract.ts` with types and one parser) and import it in the route, the fixture, and the tests. Remove the `actionable` fallback and the `superseded` and `reviewing` branches. Make the fixture send `needs-review`.
- Alternatives:
  1. Keep two types and add a type-level test (`expectTypeOf`) that the server type is assignable to the client type.
  2. Remove the three unused fields from the answer.
- Maintainer decision needed: no.

### DASH-22 · Sign-in and sign-out code is written three times

- Kind: simplification
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:212-240`, `apps/web/src/routes/runs.$runId.tsx:175`, `:191`, `apps/web/src/routes/pulls.$pullNumber.tsx:124`, `:138`: each route has its own `signIn` and `signOut` with `createAuthClient()` called on each click and the same error strings.
  - `apps/web/src/routes/index.tsx:165-174` and `:189-195`: the 403 state and its message are written two times in one file.
- What happens: Three routes carry the same two functions and the same `action` and `actionError` state.
- Impact: A copy change needs three edits. Each route bundle imports `better-auth/react` for two POST requests.
- Recommendation: One hook, for example `useSession()` in `apps/web/src/session.ts`, that returns `{ signIn(callbackURL), signOut(), action, error }` and holds one client instance.
- Alternatives:
  1. Replace the client library with two plain `fetch` calls to `/api/auth/sign-in/social` and `/api/auth/sign-out` (the tests already mock these paths, `route.browser.test.ts:134`, `:413`).
- Maintainer decision needed: no.

### DASH-23 · Preview: the notice repeats, and the fixture renders odd values

- Kind: copy
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/preview-fixtures.ts:96`: `repository: "Preview fixtures"`. `apps/web/src/routes/index.tsx:358-362`: "Preview fixtures · GitHub login is disabled". `apps/web/src/components/user-menu.tsx:24`: "Preview account".
  - `apps/web/src/review/preview-fixtures.ts:83-86`: `testedSha: "0".repeat(40)`, `state: "reviewing"`, `createdAt: 0`.
  - Screen `25-preview-queue--dark-desktop.png`: "Preview fixtures" in the header, in the notice, and as the eyebrow; "Preview account"; commit "000000000000"; date "Jan 1, 1970, 12:00 AM"; a gray "Needs review" badge; "Pull request" in place of a number.
- What happens: The preview says "preview" four times and shows a date from 1970.
- Impact: The preview is what a visitor without access sees first. It is also what the maintainer sees on the local server. It shows one run in a state that production does not have, so it hides the density and status problems.
- Recommendation: One "Preview" badge in the header. A fixture with 6 to 8 runs in all states, real-looking commits, a `createdAt` near the current time, and a pull request number.
- Alternatives:
  1. Keep the single run and fix only the date and the state.
- Maintainer decision needed: no.

### DASH-24 · Phone layout: squeezed rows, a floating footer link, and one run per screen

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/routes/index.tsx:578`: `className="flex flex-wrap items-center gap-4"` with `:583` `className="flex-1 min-w-40"` and a button that does not shrink.
  - `apps/web/src/routes/index.tsx:549`: `className="sm:ml-auto"` on "View history".
  - `apps/web/src/routes/index.tsx:645`: `className="flex flex-wrap items-center gap-3 mt-8 mb-5"` for the history controls.
  - Screens: `11-queue-8--dark-mobile--full.png`: in "In progress" the title wraps to four lines in a column about 170 px wide and "Attempt 1" breaks after "Attempt". `sheets/mobile-04.png`: "View history" sits next to "Baseline revision 42" in the middle of the row. `sheets/mobile-09.png`: with 1 run the search and filter share a row and the placeholder is cut ("Search loaded histor"); with 8 runs the filter drops to a second row.
  - M7: on a 390 x 844 screen the first run starts at y = 398 and one card fits.
- What happens: The phone layout is the desktop layout with wraps. The header, title, sentence, button, and counters take the first 47% of the first screen.
- Impact: Triage on a phone (open the link from a GitHub notification, check what waits) needs a lot of scrolling.
- Recommendation: Design the run row for 390 px first: title on one or two lines, meta on one line, whole row as the link, no button. Put the counters in a horizontal tab strip. Make the footer one line or remove it.
- Alternatives:
  1. Minimal: stack the "Open run" rows (`flex-col` under `sm`), right-align "View history" with `ml-auto` at all sizes, and make the search field full width.
- Maintainer decision needed: no.

### DASH-25 · The three counters are ambiguous and are not a list for assistive technology

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:423-424`: `pending` and `rejected` are sums over all actionable runs.
  - `apps/web/src/routes/index.tsx:450-464`: `[review.length, "Runs to review"], [pending, "Awaiting approval"], [rejected, "Rejected views"]` rendered as two `<span>` elements each (M9 `statsMarkup`).
  - `packages/service/src/review-status.ts:34-38`: `pending` counts rows that are not approved, so rejected views are inside `pending` too.
  - Screen `11-queue-8--dark-desktop.png`: "4 Runs to review · 29 Awaiting approval · 2 Rejected views".
- What happens: "29 Awaiting approval" does not say 29 of what. The 2 rejected views are also inside the 29. The numbers are the largest text after the title, and they are zero most of the time.
- Impact: The counters take 92 px of height and do not help the maintainer decide what to do next.
- Recommendation: Remove the row, or turn it into filter tabs that do work ("Review 4 · In progress 2 · Attention 2"). If totals stay, write one sentence: "29 views in 4 runs, 2 rejected". Use `<dl>` or a list for the markup.
- Alternatives:
  1. Show the counters only when at least one is not zero.
- Maintainer decision needed: no.

### DASH-26 · Small visual inconsistencies

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - M6: the "Review changes" button has a 6.5 px radius and the "Open run" button has a 2 px radius. Both are `ControlButton` with `$rounded="lg"` (`control-button.tsx:8`); the second one is inside a `$p={4}` `$rounded="xl"` row (`index.tsx:571-578`, `:592`).
  - Screens `05-forbidden--dark-desktop.png` and `06-error-503--dark-desktop.png`: the card is about 530 px wide for one message and about 430 px for the other (same markup, `index.tsx:322-330`).
  - `apps/web/src/routes/index.tsx:300` (`$rounded="2xl" $p={7}`), `:327` (`$p={6}`), `:480-481` (`$rounded="2xl" $p={6}`), `:527-528` (`$p={8}`), `:576-577` (`$rounded="xl" $p={4}`), `:736` (`$rounded="xl" $p={7}`): six card paddings and two radii on one page.
  - `apps/web/src/routes/index.tsx:486-488`, `:580-582`: an icon in a darkened square in every row. The icon carries no information (DASH-10, DASH-13).
  - Screen `14-queue-in-progress-only--dark-desktop.png`: the gap between the counters and "In progress" is 64 px (`my-8` plus `mt-8`), and 28 px before "Ready to review".
  - Headings end with a period ("Your review queue.", "Run history.", "All reviews are complete.") but "No runs yet", "No matching runs", and "Repository access required" do not.
- What happens: Radius, padding, card width, spacing, and punctuation change from block to block.
- Impact: The page looks assembled from parts. Each item is small.
- Recommendation: One card recipe (one padding, one radius), one row recipe, one spacing scale for sections, and one rule for heading punctuation.
- Alternatives: none needed.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All scripts are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-dashboard`. Browser: Chrome through Playwright. The two servers are local development servers. No number here describes production.

### M1 · Server HTML for `/`

Command:

```sh
curl -s -o ssr-index.html -w 'status=%{http_code} bytes=%{size_download} ttfb=%{time_starttransfer}s total=%{time_total}s\n' http://127.0.0.1:4310/
rg -a -o "Checking access and loading runs…|Your review queue|Preview fixtures|Sign in with GitHub|role=\"status\"" ssr-index.html | sort | uniq -c
```

Result:

```text
status=200 bytes=27700 ttfb=0.011677s total=0.011868s
   1 Checking access and loading runs…
   1 role="status"
```

Limit: preview environment on the local dev server.

### M2 · Load timeline on `http://127.0.0.1:4310/` (`probe2.mjs`, 7 runs each, milliseconds after navigation start)

| Mark                                  | No added delay (median, range) | `/api/runs` +600 ms (median, range) |
| ------------------------------------- | ------------------------------ | ----------------------------------- |
| Document response end                 | 12 (10 to 16)                  | 12 (11 to 15)                       |
| First contentful paint (loading text) | 76 (72 to 84)                  | 84 (80 to 92)                       |
| `/api/runs` request start             | 235 (225 to 262)               | 271 (259 to 282)                    |
| `/api/runs` response end              | 242 (231 to 269)               | 880 (867 to 892)                    |
| "Ready to review" in the DOM          | 268 (258 to 297)               | 909 (895 to 925)                    |

Raw data: `probe2.json` (`timelineNoDelay`, `timelineApi600`).
Limits: Vite dev server on localhost (220 script requests, no bundling, no network latency), fixture API with no database and no GitHub call. In development React StrictMode runs the effect two times, so there are two `/api/runs` requests (the first is aborted); the default client entry of `@tanstack/react-start` wraps the app in `StrictMode`. A production build sends one. The table shows the order of events, not production times.

### M3 · Navigation requests (`probe.mjs`, `navigation` in `probe.json`)

```text
initial:           documents ["/"]                        api: 2 x /api/runs (StrictMode, dev only)
header "Run history":  documents ["/", "/?view=history"]      api: 4 x /api/runs
header "Review queue": documents ["/", "/?view=history", "/"] api: 6 x /api/runs
footer "View history": documents unchanged                    api: unchanged (6)
```

### M4 · Refresh (`probe.mjs`, `refresh` in `probe.json`, fixture harness on port 4311)

```text
before click: runsLoads 1, operationsLoads 1
after click:  runsLoads 2, operationsLoads 2
```

### M5 · Title lookup after webhook processing (sqlite3, in-memory)

Command (shortened; full text in the session log): create `github_webhook_delivery` and the index from `0028_pr_title_index.sql`, insert one unprocessed `pull_request` delivery with a title, run the dashboard title query, run the `UPDATE` from `webhooks.ts:332`, run the query again.

Result:

```text
before processing:|Fix dialog focus ring
after processing rows matched:|0
after processing title:|1        (1 = the subquery result IS NULL)
```

Limit: this proves the SQL behavior. Production rows were not read.

### M6 · Computed styles (`probe.mjs`, `probe.json`)

```text
CSS rules whose selector has ak-ink-danger|warning|success: []   (dark and light)
sign-in error:  class "text mb-5 text-sm ak-ink-danger", color oklch(1 0 0) dark / oklch(0 0 0) light (= body color)
                position x=160 y=69; sign-in button x=774 y=363
"Review changes": style "--layer-color: primary; ...", background oklch(0.949994 0.0000497986 23.7884) in dark and in light, radius 6.5px
"Open run":       radius 2px
logo slot ($layer="brand"): background oklch(0.515341 0.1546 248.516)
history: table-layout auto; select width 168px (8 runs, light); row 1118x64; row link 608x42; commit font-weight 600
search input on focus: outline-style none, text-decoration underline; wrapper outline-style none
```

### M7 · Geometry by state (`capture.mjs`, `metrics-*.json`)

| State                         | Viewport   | Page height | First run at y | Item height | Items fully in first screen |
| ----------------------------- | ---------- | ----------- | -------------- | ----------- | --------------------------- |
| Queue, 1 run                  | 1440 x 900 | 900         | 361            | 240         | 1                           |
| Queue, 8 runs (4 to review)   | 1440 x 900 | 1,880       | 361            | 240 / 272   | 2                           |
| Queue, 40 runs (22 to review) | 1440 x 900 | 7,608       | 361            | 240 / 272   | 2                           |
| Queue, 8 runs                 | 390 x 844  | 2,293       | 398            | 236 to 376  | 1                           |
| Queue, 40 runs                | 390 x 844  | 9,245       | 398            | 236 to 376  | 1                           |
| History, 8 rows               | 1440 x 900 | 915         | 314            | 64 / 104    | 8                           |
| History, 100 rows             | 1440 x 900 | 6,963       | 314            | 64 / 104    | 8                           |
| History, 100 rows             | 390 x 844  | 12,782      | 420            | 83 to 243   | 3                           |

No state has horizontal overflow (`scrollWidth` equals the viewport width in all 104 captures). No page error was logged; the console errors are the expected 401, 403, 400, and 503 answers.

### M8 · Words on screen (`innerText` of `header` and `main`, dark desktop)

| State                     | Header | Main  |
| ------------------------- | ------ | ----- |
| Loading                   | 7      | 5     |
| Sign-in                   | 7      | 34    |
| Sign-in error             | 7      | 41    |
| Forbidden                 | 8      | 18    |
| Error (503)               | 8      | 16    |
| Error (bad payload)       | 8      | 19    |
| Queue, empty, baseline    | 15     | 38    |
| Queue, empty, no baseline | 15     | 41    |
| Queue, 1 run              | 15     | 55    |
| Queue, 8 runs             | 15     | 222   |
| Queue, 8 runs, no titles  | 15     | 156   |
| Queue, 40 runs            | 15     | 926   |
| Queue, in progress only   | 15     | 68    |
| History, 0                | 15     | 42    |
| History, 1                | 15     | 61    |
| History, 8                | 15     | 222   |
| History, 100              | 15     | 2,082 |
| History, no match         | 15     | 51    |
| Preview queue             | 11     | 59    |

The header count of 15 has 7 words from the hidden live region ("Service attention: no unresolved service alerts."). Eight header words are visible.

Text of the queue with one run:

```text
ARIAKIT/ARIAKIT | Your review queue. | 1 run is ready for review. | Refresh runs | 1 | Runs to review | 3 | Awaiting approval | 0 | Rejected views | READY TO REVIEW | #5300 | Needs review | Fix Combobox popover position inside a scrolling Dialog | 3 views await approval. | ede2f700a81b | Attempt 1 | Oct 5, 2026, 2:24 PM | Review changes | Baseline revision 42 | View history
```

### M9 · Hit areas, semantics, badge shape (`probe2.mjs`, `probe3.mjs`)

```text
review card 1120x240, link 142x33, share 0.017
<time> elements: dateTime null
tab order in main: Refresh runs, Review changes x4, Open run x4, View history
counters markup: <span class="text block text-3xl ...">4</span><span class="text block text-xs ak-ink-60 mt-1">Runs to review</span>
queue badges:   radius 3.35544e+07px, height 22
history badges: radius 2px, height 22
history select options (8 runs): All results, Passed, Needs review, Replaced by a newer run, Changes rejected
header cell widths (8 runs): 715, 226, 177
```

### M10 · Source counts in `apps/web/src/routes/index.tsx`

```text
<div 18 | <input 1 | <select 1 | <code 2 | <section 3 | <Text 38 | <Frame 11 | <Badge 3
ak-ink-60 24 | "uppercase tracking-widest" 5 | "text-3xl sm:text-4xl" 2 | render={<h 11 | render={<p 16
```

### M11 · Size of the `/api/runs` answer (synthetic data from `data.mjs`)

```text
1 run:                    903 bytes,   405 gzip
8 history + 8 actionable: 5,673 bytes, 1,588 gzip (6 runs are in both lists)
100 history + 40 actionable: 47,334 bytes, 11,643 gzip (40 runs are in both lists)
```

Limit: synthetic titles and counts. Runs that are both recent and actionable are sent two times.

## Screenshots

Folder: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-dashboard/screens`. Each state has four files: `<state>--dark-desktop.png`, `<state>--light-desktop.png` (1440 x 900), `<state>--dark-mobile.png`, `<state>--light-mobile.png` (390 x 844 at 2x). All 26 states use the real route. States 01 to 24 use the fixture harness on port 4311 with `page.route` for `/api/runs`, `/api/operations`, and `/api/auth/*`. States 25 and 26 use the preview server on port 4310.

| State                         | Caption                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `01-loading`                  | `/api/runs` never answers. One line of text.                                                         |
| `02-guest`                    | `401`. Sign-in hero and card.                                                                        |
| `03-guest-opening-github`     | After a click on "Sign in with GitHub" while the request is open.                                    |
| `04-guest-sign-in-error`      | Sign-in request fails. The error is at the top-left, in the body text color.                         |
| `05-forbidden`                | `403`. "Repository access required".                                                                 |
| `06-error-503`                | `503` with a `reference` in the body. The reference is not shown.                                    |
| `07-error-invalid-payload`    | `200` with a wrong shape.                                                                            |
| `08-queue-empty-baseline`     | No actionable runs, baseline revision 42.                                                            |
| `09-queue-empty-no-baseline`  | No runs, no baseline.                                                                                |
| `10-queue-1`                  | One run to review.                                                                                   |
| `11-queue-8`                  | Four to review (one long title, one rejected, one `main`), two in progress, two that need attention. |
| `12-queue-8-no-titles`        | Same runs without titles. This is the expected production look (DASH-05).                            |
| `13-queue-40`                 | 22 to review, 8 in progress, 10 that need attention.                                                 |
| `14-queue-in-progress-only`   | Two runs in progress, none to review.                                                                |
| `15-queue-8-alerts`           | Queue with two service alerts on the bell.                                                           |
| `16-history-0`                | History with no runs.                                                                                |
| `17-history-1`                | History with one run.                                                                                |
| `18-history-8`                | History with eight runs in mixed states.                                                             |
| `19-history-100`              | History with 100 runs.                                                                               |
| `20-history-no-match`         | Search for "carousel".                                                                               |
| `21-history-filtered`         | Search for "dialog" and result "Passed".                                                             |
| `22-refresh-reloading`        | After a click on "Refresh runs" while the request is open.                                           |
| `23-user-menu-open`           | Account popover.                                                                                     |
| `24-user-menu-sign-out-error` | Account popover after a failed sign-out.                                                             |
| `25-preview-queue`            | Preview fixtures on port 4310, queue.                                                                |
| `26-preview-history`          | Preview fixtures on port 4310, history.                                                              |

Full-page captures:

| File                                           | Caption                             |
| ---------------------------------------------- | ----------------------------------- |
| `11-queue-8--dark-desktop--full.png`           | Whole queue with 8 runs, 1,880 px.  |
| `11-queue-8--dark-mobile--full.png`            | Same on a phone, 2,293 px.          |
| `12-queue-8-no-titles--dark-desktop--full.png` | Whole queue without titles.         |
| `13-queue-40--dark-desktop--full.png`          | Whole queue with 40 runs, 7,608 px. |
| `13-queue-40--dark-mobile--full.png`           | Same on a phone, 9,245 px.          |
| `19-history-100--dark-desktop--full.png`       | Whole history, 6,963 px.            |
| `19-history-100--dark-mobile--full.png`        | Same on a phone, 12,782 px.         |

Contact sheets (used to review every capture): `sheets/light-desktop-01.png` to `sheets/light-desktop-06.png` (four light desktop states per sheet at 50%) and `sheets/mobile-01.png` to `sheets/mobile-13.png` (two states per sheet, dark and light side by side at 100%).

## Redesign ideas

The ideas use the vendored primitives (`Shell`, `Nav`, `Frame`, `Layer`, `Text`, `Button`, `Badge`, `Table`, `Tabs`, `Disclosure`, `Popover`, `Kbd`) and the upstream primitives that are not yet vendored (`Heading`, `Input`, `List`, `Link`, `Separator`, `Progress`, `Tooltip`, `Code`). Each idea says which data it needs. "Needs new data" means a change in `dashboard.ts`.

Legend for the sketches: `●` review, `✕` rejected, `◌` in progress, `!` failed or stale, `✓` passed, `↻` recapture.

### Idea 1 · Inbox list: one dense list, the row is the link

- What changes: No page title, no counter row, no cards. One list with three group headers that carry the counts. Each run is one 44 px row. The whole row is a link. Keyboard: `j` and `k` move, `Enter` opens, `r` refreshes.
- Why it is better: 16 rows fit in the first screen in place of 2. One mark, one title, one number, one age per row. 40 runs need about 2 screens in place of 8.5.
- Data: works with the current answer. Titles need DASH-05.

```text
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ visonaut  ariakit/ariakit        Inbox 4    History    Status       ⟳   🔔  @haz │
├────────────────────────────────────────────────────────────────────────────────────┤
│ To review · 4                                                 29 views, 2 rejected │
│ ●  #5300  Fix Combobox popover position inside a scrolling Dialog    3 views   6m │
│ ●  #5285  Refactor the composite store so that items do not re-re…  18 views   1h │
│ ✕  #5294  Menu: keep the submenu open while the pointer crosses …  6 · 2 rej.  3h │
│ ●  main   a225ac0                                                   2 views    4h │
│ In progress · 2                                                                    │
│ ◌  #5291  Update Select typeahead to skip disabled items          Comparing    4m │
│ ◌  #5288  Tooltip: delay hide when the pointer moves between a…   Capturing    2m │
│ Needs attention · 2                                                                │
│ ↻  #5282  Bump the dependencies group across 1 directory with …   Recapture    1d │
│ !  merge  27b78d0                                                 Failed       2d │
└────────────────────────────────────────────────────────────────────────────────────┘
```

```tsx
<Nav aria-label="Runs to review" $layout="vertical">
  <NavGroup>
    <NavGroupLabel>To review · {review.length}</NavGroupLabel>
    <NavList>
      {review.map((run) => (
        <NavLink key={run.id} render={<Link to="/runs/$runId" params={{ runId: run.id }} />}>
          <NavIcon>
            <StatusMark state={run.state} />
          </NavIcon>
          <Text className="w-16 tabular-nums ak-ink-60">{runNumber(run)}</Text>
          <ButtonLabel className="flex-1 truncate">{runTitle(run)}</ButtonLabel>
          <Text className="ak-ink-60 tabular-nums">{viewCount(run)}</Text>
          <Text render={<time dateTime={iso(run.createdAt)} />} className="w-10 text-end ak-ink-60">
            {ago(run.createdAt)}
          </Text>
        </NavLink>
      ))}
    </NavList>
  </NavGroup>
</Nav>
```

### Idea 2 · Focus: one "Next up" card, the rest as a short list

- What changes: The page answers one question: what do I review now? The oldest or the most urgent run is one card with a strip of thumbnails of its changed views and one main button. All other runs are compact rows under "Then". In progress and attention collapse to one summary line with a disclosure.
- Why it is better: Most visits have 0 to 5 runs. The maintainer starts work with one key press. The thumbnails show the size of the job before the click.
- Data: needs new data for thumbnails (image ids of the first changed rows; image URLs are already public by URL, see `docs/review-guide.md:3`). Works without thumbnails as a text card.

```text
│                                                                                │
│   Next up · 1 of 4                                                             │
│   ┌────────────────────────────────────────────────────────────────────────┐   │
│   │ #5300  Fix Combobox popover position inside a scrolling Dialog         │   │
│   │ 3 views · ede2f70 · 6 min ago                                          │   │
│   │ ┌──────────┐ ┌──────────┐ ┌──────────┐                                 │   │
│   │ │ Combobox │ │ Combobox │ │ Dialog   │        [ Start review   ↵ ]     │   │
│   │ │ light    │ │ dark     │ │ light    │                                 │   │
│   │ └──────────┘ └──────────┘ └──────────┘                                 │   │
│   └────────────────────────────────────────────────────────────────────────┘   │
│   Then                                                                         │
│   ●  #5285  Refactor the composite store so that items do n…   18 views   1h   │
│   ✕  #5294  Menu: keep the submenu open while the pointer c…   6 · 2 rej. 3h   │
│   ●  main   a225ac0                                            2 views    4h   │
│   ▸  2 in progress · 2 need attention                                          │
```

```tsx
<Frame $layer $lighten $border $rounded="xl" $p={5} render={<article />}>
  <Heading render={<h2 />} $level={3}>
    {runNumber(next)} {runTitle(next)}
  </Heading>
  <Text className="ak-ink-60">
    {viewCount(next)} · <Code>{next.testedSha.slice(0, 7)}</Code> · {ago(next.createdAt)}
  </Text>
  <ThumbnailStrip images={next.preview} />
  <Button $layer="brand" render={<Link to="/runs/$runId" params={{ runId: next.id }} />}>
    <ButtonLabel>Start review</ButtonLabel>
    <ButtonSlot>
      <Kbd>↵</Kbd>
    </ButtonSlot>
  </Button>
</Frame>
```

### Idea 3 · Split inbox: list on the left, selected run on the right

- What changes: The dashboard uses the same `Shell` with a sidebar as the review workspace. The sidebar is the run list. The main area shows a summary of the selected run: changed views as a thumbnail grid, counts, commit, links to GitHub, and the start button. Opening the review replaces only the main area.
- Why it is better: The list stays in place while the maintainer moves from run to run. There is no page change between "which run" and "review this run", so the two loading screens become one frame. It uses the wide screen.
- Data: thumbnails need new data, or the page can load `/api/runs/{id}` for the selected run.

```text
┌──────────────────────────────┬─────────────────────────────────────────────────────┐
│ Inbox 4                  ⟳   │ #5300  Fix Combobox popover position inside a scro… │
│ ▌●  #5300 Fix Combobox…   3  │ ede2f70 · attempt 1 · 6 min ago · GitHub ↗          │
│  ●  #5285 Refactor the…  18  │                                                     │
│  ✕  #5294 Menu: keep t…   6  │ 3 changed views                                     │
│  ●  main a225ac0          2  │ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│ In progress 2                │ │            │ │            │ │            │        │
│  ◌  #5291 Update Selec…      │ │  Combobox  │ │  Combobox  │ │   Dialog   │        │
│  ◌  #5288 Tooltip: del…      │ │  light     │ │  dark      │ │   light    │        │
│ Needs attention 2            │ └────────────┘ └────────────┘ └────────────┘        │
│  ↻  #5282 Bump the dep…      │                                                     │
│  !  merge 27b78d0            │                         [ Review 3 views   ↵ ]      │
└──────────────────────────────┴─────────────────────────────────────────────────────┘
```

```tsx
<Shell $layer="canvas">
  <AppHeader ... />
  <ShellSidebar>
    <ShellSidebarHeader>Inbox {review.length}</ShellSidebarHeader>
    <ShellSidebarBody><RunNav runs={actionable} selected={selectedId} /></ShellSidebarBody>
  </ShellSidebar>
  <ShellMain>
    <ShellMainBody><RunSummary run={selected} /></ShellMainBody>
  </ShellMain>
</Shell>
```

On a phone the sidebar is the page and the summary is skipped.

### Idea 4 · Board: three lanes

- What changes: Three columns side by side: "To review", "In progress", "Needs attention". An optional fourth column "Done today". Cards are two lines. On a phone the lanes become `Tabs`.
- Why it is better: The whole pipeline is visible without scrolling. A failed run is at the top of its own column, not under 22 cards. Lane headers carry the counts, so the counter row goes away.
- Data: works with the current answer. "Done today" uses `runs` filtered by `passed` and date.

```text
│ To review 4               │ In progress 2             │ Needs attention 2         │ Done today 6      │
│ ┌───────────────────────┐ │ ┌───────────────────────┐ │ ┌───────────────────────┐ │ ✓ #5297 Add `unm… │
│ │ #5300 Fix Combobox p… │ │ │ #5291 Update Select … │ │ │ #5282 Bump the depen… │ │ ✓ #5291 Update S… │
│ │ 3 views · 6m          │ │ │ ◌ Comparing · 4m      │ │ │ ↻ Recapture · 1d      │ │ ✓ #5276 Fix Dial… │
│ └───────────────────────┘ │ └───────────────────────┘ │ └───────────────────────┘ │ ✓ merge 27b78d0   │
│ ┌───────────────────────┐ │ ┌───────────────────────┐ │ ┌───────────────────────┐ │ …                 │
│ │ #5285 Refactor the c… │ │ │ #5288 Tooltip: delay… │ │ │ merge 27b78d0         │ │                   │
│ │ 18 views · 1h         │ │ │ ◌ Capturing · 2m      │ │ │ ! Failed · 2d         │ │                   │
│ └───────────────────────┘ │ └───────────────────────┘ │ └───────────────────────┘ │                   │
```

```tsx
<div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
  {lanes.map((lane) => (
    <Frame
      key={lane.id}
      $layer
      $darken={1}
      $rounded="xl"
      $p={2}
      render={<section aria-labelledby={lane.id} />}
    >
      <Text render={<h2 id={lane.id} />} className="px-2 py-1 text-xs ak-ink-60">
        {lane.title} {lane.runs.length}
      </Text>
      {lane.runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </Frame>
  ))}
</div>
```

### Idea 5 · One table for everything: queue and history merged, counts as tabs

- What changes: One page named "Runs". A tab strip filters one table: "Needs you 6", "In progress 2", "Passed 61", "All 100". The default tab is "Needs you". Search is always there. Columns: status, run, views, commit, age. The table uses the vendored `Table` with its sort buttons.
- Why it is better: One navigation item less. No second page header. The counters become controls. The maintainer learns one layout. Queue and history can never disagree.
- Data: works with the current answer (`actionable` plus `runs`, with duplicates removed by `id`).

```text
│ Runs    ┌ Needs you 6 ┐  In progress 2   Passed 61   All 100           / Search     ⟳ │
│ ────────┴─────────────┴──────────────────────────────────────────────────────────── │
│ Status        Run                                                Views    Commit   Age │
│ ● Review      #5300 Fix Combobox popover position inside a scr…  3        ede2f70   6m │
│ ● Review      #5285 Refactor the composite store so that items…  18       ba90300   1h │
│ ✕ Rejected    #5294 Menu: keep the submenu open while the poin…  6 (2)    2b4cb20   3h │
│ ● Review      main                                               2        a225ac0   4h │
│ ↻ Recapture   #5282 Bump the dependencies group across 1 direc…  —        8d4ac30   1d │
│ ! Failed      merge queue                                        —        27b78d0   2d │
```

```tsx
<Tabs>
  <TabList aria-label="Filter runs">
    {filters.map((filter) => (
      <Tab key={filter.id} id={filter.id}>
        <TabLabel>{filter.label}</TabLabel>
        <TabSlot><Badge>{filter.count}</Badge></TabSlot>
      </Tab>
    ))}
  </TabList>
</Tabs>
<Table className="w-full table-fixed" container={{ $layer: true, $lighten: true, $border: true, $rounded: "xl" }}>
  <TableRowGroup group="head">
    <TableRow>
      <TableCell className="w-32">Status</TableCell>
      <TableCell>Run</TableCell>
      <TableCell numeric className="w-24">Views</TableCell>
      <TableCell className="w-24">Commit</TableCell>
      <TableCell sort={sort} className="w-16">Age</TableCell>
    </TableRow>
  </TableRowGroup>
  ...
</Table>
```

### Idea 6 · Activity timeline: pinned work on top, then days

- What changes: The top block "Needs you" holds the runs that wait. Under it, all runs are grouped by day ("Today", "Yesterday", date) with the time of day in a narrow column and one status mark on a vertical rail.
- Why it is better: It answers "what happened since I last looked". Days give the eye anchors that 100 equal rows do not give. Passed runs get little ink.
- Data: works with the current answer.

```text
│ Needs you                                                                          │
│   ●  #5300  Fix Combobox popover position inside a scrolling Dialog    3 views  6m │
│   ●  #5285  Refactor the composite store so that items do not re-r…   18 views  1h │
│ Today                                                                              │
│   14:24  ✓  #5297  Add `unmountOnHide` to TabPanel                        passed   │
│   14:20  ◌  #5291  Update Select typeahead to skip disabled items         comparing│
│   11:16  →  main 7e8ca38                                                  replaced │
│ Yesterday                                                                          │
│   19:36  ✓  #5228  Fix Dialog backdrop flash on unmount                   passed   │
│   16:02  !  merge 27b78d0                                                 failed   │
```

```tsx
<List>
  {days.map((day) => (
    <ListItem key={day.key}>
      <Heading render={<h2 />} $level={5}>
        {day.label}
      </Heading>
      <List>
        {day.runs.map((run) => (
          <ListItem key={run.id}>
            <ListItemMarker>
              <StatusMark state={run.state} />
            </ListItemMarker>
            <RunLine run={run} time="clock" />
          </ListItem>
        ))}
      </List>
    </ListItem>
  ))}
</List>
```

### Idea 7 · History grouped by pull request, attempts inside a disclosure

- What changes: One row for each pull request (or for `main`, or for the merge queue) with its latest state and the number of runs. Opening the row shows the attempts.
- Why it is better: 100 runs are often 20 to 30 pull requests. "Replaced by a newer run" rows stop being noise; they move inside their pull request.
- Data: works with the current answer (group by `pullRequestNumber` or `kind`). A full view needs runs beyond the latest 100.

```text
│ ▸  #5300  Fix Combobox popover position inside a scrolling Dialog   ● review    3 runs   6m │
│ ▾  #5294  Menu: keep the submenu open while the pointer crosses …   ✕ rejected  2 runs   3h │
│        attempt 2   2b4cb20   ✕ 6 views, 2 rejected     today 11:20                          │
│        attempt 1   9e22c90   → replaced                today 09:02                          │
│ ▸  main                                                             ✓ passed    12 runs  4h │
│ ▸  merge queue                                                      ! failed    3 runs   2d │
```

```tsx
<Disclosure>
  <DisclosureButton>
    <StatusMark state={group.latest.state} />
    <ButtonLabel className="flex-1 truncate">{group.label}</ButtonLabel>
    <Text className="ak-ink-60">{group.runs.length} runs</Text>
  </DisclosureButton>
  <DisclosureContent>
    {group.runs.map((run) => (
      <RunLine key={run.id} run={run} />
    ))}
  </DisclosureContent>
</Disclosure>
```

### Component ideas

#### C1 · Run row, four variants

- What changes: One `RunRow` component with a `density` variant, used by every list.
- Why it is better: The queue, the history, and the sidebar show a run in the same way.

```text
a) one line, 40 px     ●  #5300  Fix Combobox popover position inside a scro…   3 views   6m
b) two lines, 60 px    ●  Fix Combobox popover position inside a scrolling Dialog          3
                          #5300 · ede2f70 · 6 min ago
c) with thumbnails     ●  Fix Combobox popover position inside a scrolling Dialog   [▢][▢][▢]
                          #5300 · 3 views · 6 min ago
d) with progress       ●  Fix Combobox popover position inside a scrolling Dialog   ▓▓▓░░ 9/12
                          #5300 · ede2f70 · 6 min ago
```

Variant d needs the total and approved counts (new data: `COUNT(*)` and the approved sum in the `counts` CTE at `dashboard.ts:37-44`). It uses the upstream `Progress` primitive.

#### C2 · Status mark, four variants

- What changes: One `StatusMark` with a `kind` variant and the mapping from DASH-11.
- Why it is better: Eight states get eight marks. The shape is the same in a card, a row, and a table.

```text
dot + label     ● Review      ✕ Rejected     ◌ Comparing     ! Failed     ✓ Passed
icon only       ●  ✕  ◌  !  ✓            (label in a Tooltip and in aria-label)
pill badge      ( ● Review )  ( ✕ Rejected )
left edge       ▌#5300 Fix Combobox…      (3 px bar in the state color at the row start)
```

```tsx
<Badge $layer={tone} $rounded="full">
  <BadgeSlot>
    <Icon />
  </BadgeSlot>
  <BadgeLabel>{label}</BadgeLabel>
</Badge>
```

#### C3 · Page header, three variants

```text
none            the active nav item is the title; a visually hidden <h1> stays
inline          Inbox  4                                                   ⟳
breadcrumb      ariakit/ariakit  /  Inbox                                  ⟳   Updated 12 s ago
```

- Why it is better: The current header block costs 140 px and 12 words on each page.

#### C4 · Counts as filters

```text
[ All 8 ]  [ Review 4 ]  [ In progress 2 ]  [ Attention 2 ]
```

- What changes: The three large counters become a `TabList` or a row of toggle buttons with a `Badge` count.
- Why it is better: The number is also a control. Zero counts can hide.

#### C5 · Empty states, three variants

```text
one line        ✓  All caught up.   Baseline 42 · last run passed 2 h ago
with context    ✓  All caught up.
                Recently passed
                ✓ #5297 Add `unmountOnHide` to TabPanel      1h
                ✓ #5291 Update Select typeahead…             2h
first run       No captures yet.   Run the "Visual tests" workflow on main to make a baseline.   [ Open workflow ↗ ]
```

- Why it is better: The current empty queue uses 38 words and 5 statements for "nothing to do". The second variant makes the empty page useful.

#### C6 · Loading and refresh

```text
skeleton        ▁▁▁  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁   ▁▁▁  ▁▁     (5 rows, same height as real rows)
refresh         real rows stay; a 2 px Progress bar runs under the header; the ⟳ button shows a spinner
stale           "Could not refresh. Showing data from 14:02."   [ Retry ]
```

- Why it is better: No blank page, no layout jump, no "Checking access" text.

#### C7 · Sign-in, three variants

```text
card            ┌──────────────────────────────┐
                │  ◎ visonaut                  │
                │  [  Sign in with GitHub  ]   │
                │  Requires write access to    │
                │  ariakit/ariakit.            │
                └──────────────────────────────┘
split           left: the same card; right: a real screenshot of a review (two images and a diff)
redirect        no screen; a signed-out visit goes to GitHub and comes back to the same URL
```

#### C8 · Forbidden and error

```text
forbidden       Signed in as @someone.  Write access to ariakit/ariakit is required.
                [ Switch account ]   [ Try again ]
error (inline)  ⚠ The service did not answer.  Reference af4a9c01.   [ Retry ]      (above the stale list)
error (page)    same content in one card when there is no stale data
```

#### C9 · History toolbar

```text
[ / Search runs                    ]   All 100 · Review 6 · Passed 61 · Failed 8 · Replaced 14        7 of 100
```

- What changes: `InputGroup` with a `Kbd` hint, a fixed set of filter chips with counts, and a result count.
- Why it is better: The controls do not change width or order with the data, and the count replaces three sentences.

#### C10 · Preview marker

```text
◎ visonaut  ( Preview )        Inbox   History   Status
```

- What changes: One `Badge` next to the logo, with a tooltip "Sample data. Sign-in is off."
- Why it is better: One mark in place of four texts.

#### C11 · Account menu

```text
header          (avatar) haz ▾
popover         @haz · write access
                Sign out
```

- Data: `viewer.login` in the `/api/runs` answer (DASH-17).

#### C12 · Keyboard

```text
j / k   move        ↵   open        r   refresh        /   search        g i / g h   inbox / history
```

- What changes: Key hints with the vendored `Kbd` in a footer or in a `?` popover.
- Why it is better: The review workspace already has keys for approve and reject ("Approve & next A", "Reject view X"). The list before it has none.

## Open questions and items not verified

1. Production timing was not measured. No access to the deployed service was used. The cost of `/api/runs` in production (D1 latency, how often the GitHub permission check misses the 60 s cache) is unknown here.
2. DASH-05 was not checked against production data. A read-only query would confirm it: `SELECT COUNT(*) FROM github_webhook_delivery WHERE event='pull_request' AND payload_json != '{}'`. If the count is near zero, no pull request has a title.
3. DASH-16 (GitHub reuses the same account) was not tested with a real GitHub sign-in.
4. How many runs wait in the queue on a normal day? The density decision (DASH-08) and the choice between ideas 1, 2, and 5 depend on it.
5. Is "newest first" the intended order for the queue (`dashboard.ts:66`)? In a work queue the oldest waiting run may be the most urgent.
6. Can `/api/runs` return image ids for a few changed views of each run? Ideas 2 and 3 are much stronger with thumbnails. The cost of that query was not studied.
7. Can the project row be missing on a fresh deployment? `dashboard.ts:83` would then answer `409` and the page would say "temporarily unavailable. Please retry." `Service.createProject` has no caller outside tests in this repository.
8. Are `/api/me` and `/api/session` used by anything outside this repository? No client code here calls them.
9. Not tested: Safari, Firefox, forced-colors and high-contrast modes, a screen reader, 200% zoom, and right-to-left text.
10. The `?view=service` page and the bell popover are in another lane. This report covers them only where they affect the dashboard load (DASH-03, DASH-04).
11. The header layout (logo alignment, icon-only navigation on a phone) is in the shell lane and is not judged here.
