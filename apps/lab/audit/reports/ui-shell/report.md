# Shell, header, navigation, information architecture, and URL model

Lane key: `ui-shell`. Finding prefix: `SHELL`. This audit is read-only. All repository paths are relative to `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. All scratch files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-shell/`.

Two sources supply the measurements. "Real app" is the preview-fixture server on `http://127.0.0.1:4310`. "Fixture" is the browser-test harness on `http://127.0.0.1:4311/src/review/__tests__/route-fixture.html`, with `/api/**` answers that my script supplies through Playwright routing. Both are Vite dev servers. Use the order and count of events from them. Do not use their times as production times.

## How it works (map)

### Files

| Part                                                     | File                                                     | Lines    |
| -------------------------------------------------------- | -------------------------------------------------------- | -------- |
| Document, head, title, inline script                     | `apps/web/src/routes/__root.tsx`                         | 5-35     |
| Router options                                           | `apps/web/src/router.tsx`                                | 7-9      |
| Global header                                            | `apps/web/src/components/app-shell.tsx`                  | 15-71    |
| Account popover                                          | `apps/web/src/components/user-menu.tsx`                  | 22-81    |
| Default button look                                      | `apps/web/src/components/control-button.tsx`             | 4-13     |
| Queue, history, and service views                        | `apps/web/src/routes/index.tsx`                          | 39-381   |
| Run route (loader, loading, error, guest)                | `apps/web/src/routes/runs.$runId.tsx`                    | 23-247   |
| Pull request resolver page                               | `apps/web/src/routes/pulls.$pullNumber.tsx`              | 23-297   |
| Review workspace shell (second header, sidebars, footer) | `apps/web/src/review/review-workspace.tsx`               | 527-1299 |
| Sidebar item links                                       | `apps/web/src/review/item-list.tsx`                      | 189-277  |
| Sidebar preference script                                | `apps/web/src/review/sidebar-preference.ts`              | 1-9      |
| Alerts bell and service page                             | `apps/web/src/components/operations-attention/index.tsx` | 213-518  |
| Shell recipe (vendored)                                  | `apps/web/src/components/ariakit/styles/shell.ts`        | 12-767   |

### Routes

The route tree is flat. `routeTree.gen.ts:16-30` registers `/`, `/pulls/$pullNumber`, and `/runs/$runId` directly below the root. The root component renders only `<Outlet />` (`__root.tsx:30`). There is no layout route. Each route builds its own `<Shell>` and its own `<AppHeader>`.

| URL                                       | Route file              | What the user sees                      | Data source                                                                   |
| ----------------------------------------- | ----------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `/`                                       | `index.tsx`             | Review queue                            | `GET /api/runs` in a client effect (`index.tsx:176-184`)                      |
| `/?view=history`                          | `index.tsx`             | Run history, the latest 100 runs        | The same `GET /api/runs` answer                                               |
| `/?view=service`                          | `index.tsx`             | Service status                          | `GET /api/runs`, then `GET /api/operations`                                   |
| `/runs/$runId?comparison=&item=&variant=` | `runs.$runId.tsx`       | Review workspace                        | Router loader, `ssr: false` (`runs.$runId.tsx:31-47`)                         |
| `/pulls/$pullNumber?check=`               | `pulls.$pullNumber.tsx` | A status card, or a redirect to the run | `GET /api/pulls/:n?check=` in a client effect (`pulls.$pullNumber.tsx:47-58`) |
| Any other path                            | none                    | The text "Not Found"                    | none                                                                          |

### Header

`AppHeader` (`app-shell.tsx:21-71`) is a `ShellHeader` with `$height="sm"`, `$p={3}`, and `$border`. Each page shell sets `[--shell-header-step:calc(48px/14)]`, so the "sm" header is 48 px high.

- Start: a brand link (`<a href="/">`, Aperture icon, the word "visonaut." from the `lg` viewport width) and the repository name (shown only from the `xl` viewport width, `app-shell.tsx:37-41`).
- Center: a horizontal `Nav` with three `NavLink` rows: "Review queue", "Run history", "Service status" (`app-shell.tsx:15-19`, `46-65`). Labels hide below the `sm` width. Each row is a plain `<a href>`.
- End: supplied by the route. The dashboard passes the alerts bell and the account menu (`index.tsx:252-266`). The ready run page passes the account menu only (`runs.$runId.tsx:206-213`). The run loading, guest, and error shells, and the pull page, pass nothing (`runs.$runId.tsx:58`, `pulls.$pullNumber.tsx:152`).

Only the dashboard sets `active` (`index.tsx:250`). The run page and the pull page show no current item in the navigation.

### Review workspace shell

The ready run page does not use the route shell. `ReviewWorkspace` renders a second, larger shell (`review-workspace.tsx:528-1298`):

- `AppHeader` again (`:535`).
- A start `ShellSidebar`, `$width="md"` (16rem), `$show="5xl"`, with a "Screenshots" header and the item list (`:536-561`).
- `ShellMain` with a sticky `ShellMainHeader` (sidebar toggle, "Queue" link, run title, progress, `:563-608`), a `ShellMainIntro` strip (commit, attempt, baseline revision, run status, `:609-622`), and the body (item heading, variant links, view controls, viewer, sticky action bar, `:623-1140`).
- An end `ShellSidebar`, `$from="intro"`, for "Capture details" (`:1142-1171`).
- A `ShellFooter` with keyboard help, a shortcuts toggle, and "Recompare stored run" (`:1172-1205`).
- Below 1024 px the sidebars become modal dialogs. A JavaScript media query decides this (`:211-225`).

### Request sequences

A. Open `/` while signed in.

1. The browser requests `/`. The Worker has no API match and calls `render(request)` (`server.ts:118`). The response has `cache-control: no-store, private` and a CSP with a nonce (measured headers, `index.headers.txt`).
2. The HTML contains the header and the text "Checking access and loading runs…" (`index.tsx:275-278`). It contains no run data. Measured: 27,700 bytes, 5,498 bytes gzip, visible text `visonaut. Review queue Run history Service status Checking access and loading runs…`.
3. An inline head script sets `data-review-sidebar-open` on `<html>` (`__root.tsx:23-26`). This page does not use it.
4. The browser loads the stylesheet and the scripts. React hydrates.
5. A client effect runs `fetch("/api/runs", { cache: "no-store" })` (`index.tsx:176-184`).
6. The Worker runs the access check for this request: `createGitHubClient`, then `requireMaintainer` (`api/index.ts:191-205`). That function reads the session with `disableCookieCache: true`, runs one account query, and calls GitHub unless a per-isolate permission entry is younger than 60 s (`packages/security/src/authorization.ts:21`, `32-43`, `60-73`). Then `dashboard()` reads the runs (`api/review.ts:732-734`).
7. The client sets the state to `ready`. The header gets the repository name and the account menu. The alerts bell mounts and starts `fetch("/api/operations")` (`operations-attention/index.tsx:233`), which pays a second access check. The bell repeats this request each 60 s (`:280`).
8. A 401 answer shows the sign-in hero. A 403 answer shows an access card. Any other failure shows an error card (`index.tsx:185-206`).

B. Click a header link. The link is a plain anchor, so the browser loads a new document. Sequence A starts again from step 1.

C. Open a run from the queue. The card uses a router `<Link>` (`index.tsx:510`). The run route loader calls `GET /api/runs/:id` (`runs.$runId.tsx:37-47`). The queue stays on screen until the loader ends or 1 s passes. After 1 s the pending component replaces the page. Loader data is dropped when the route unmounts (`gcTime: 0`, `:35`).

D. Select an item or a variant. Sidebar rows and variant chips are router links to the same route with new `item` and `variant` search values (`item-list.tsx:205-214`, `review-workspace.tsx:750-758`). The loader does not run again, because `loaderDeps` contains only `comparison` (`runs.$runId.tsx:34`). Keyboard selection calls `navigate({ replace: true })` (`runs.$runId.tsx:118-131`).

E. Open a GitHub check link `/pulls/N?check=visonaut:pre:<sha>`. The page calls `GET /api/pulls/N?check=…`. If the answer has a `runId`, the page calls `navigate({ to: "/runs/$runId", replace: true })` (`pulls.$pullNumber.tsx:80-84`). Then sequence C runs. If the capture is pending, the page polls each 15 s while visible (`:105-119`).

F. Press the browser Back button from a run. The queue component mounts again, starts in `loading`, and repeats step 5 to step 7.

### Objects and where they appear

| Object             | Identity                                       | Where the UI shows it today                                                                    | Has a URL                                        |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Repository         | One per deployment (`api/dashboard.ts:141`)    | Header from 1280 px, and again as the page eyebrow                                             | No (not necessary)                               |
| Pull request       | Number, title from the last webhook            | Queue card, history row, and as a prefix inside the run title string (`api/review.ts:559-561`) | Only as a resolver with a check ID               |
| Run                | UUID, kind, tested SHA, state                  | Queue, history, workspace                                                                      | Yes, `/runs/<uuid>`                              |
| Attempt            | Integer on the run                             | Queue card, history row, workspace strip, details panel                                        | No. A new attempt is a new run                   |
| Comparison         | UUID, ordinal                                  | Details panel links                                                                            | `?comparison=<uuid>`                             |
| Item               | Key such as `dialog/open`, name                | Sidebar row, page `h1`                                                                         | `?item=dialog%2Fopen`                            |
| Variant            | Key, label parts                               | Chip row                                                                                       | `?variant=Dark`                                  |
| Decision           | Verdict, source, reviewer                      | Badge, action bar, details panel                                                               | No                                               |
| View mode and zoom | `side`, `diff`, `new`, `original`; `fit`, 1, 2 | Toolbar                                                                                        | No (local state, `review-workspace.tsx:197-198`) |
| Baseline           | Revision number                                | Queue footer, workspace strip                                                                  | No                                               |
| Service alert      | Kind, code, subject                            | Bell popover, service page                                                                     | `?view=service` for the list                     |
| Reviewer           | GitHub login                                   | Not shown. The menu says "Account"                                                             | No                                               |

## Findings

### SHELL-01 · Header links, the brand link, and the "Queue" button reload the whole document

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/components/app-shell.tsx:16-18`: `{ id: "history", href: "/?view=history", label: "Run history", icon: History },`
  - `apps/web/src/components/app-shell.tsx:29`: `<ControlButton $p={1} render={<a href="/" />} aria-label="Visonaut review queue">`
  - `apps/web/src/components/app-shell.tsx:53-58`: `<NavLink key={id} href={href} aria-label={label} aria-current={active === id ? "page" : undefined}>`. `NavLink` renders `ak.Role.a` (`components/ariakit/components/nav.ariakit.react.tsx:600-605`).
  - `apps/web/src/review/review-workspace.tsx:580`: `<Button $p={1} render={<a href="/" />}>`
  - `apps/web/src/review/review-workspace.tsx:474`: ``<a href={`/runs/${encodeURIComponent(model.run.id)}`}>Original comparison</a>`` (and `:476-479` for historical comparisons).
  - Contrast: `apps/web/src/routes/index.tsx:549`: `<Button className="sm:ml-auto" render={<Link to="/" search={{ view: "history" }} />}>`
  - Measurement M2 (real app). A marker on `window` shows if the document survived the click:

    | Action                                 | Document reload | Requests after the click (dev)                                              |
    | -------------------------------------- | --------------- | --------------------------------------------------------------------------- |
    | Header: Review queue to Run history    | yes             | `document /?view=history`, `fetch /api/runs` x2                             |
    | Header: Run history to Service status  | yes             | `document /?view=service`, `fetch /api/runs` x2, `fetch /api/operations` x2 |
    | Header: Service status to Review queue | yes             | `document /`, `fetch /api/runs` x2                                          |
    | In-page link "View history"            | no              | none                                                                        |
    | Brand link                             | yes             | `document /`, `fetch /api/runs` x2                                          |
    | Workspace "Queue" button               | yes             | `document /`, `fetch /api/runs` x2                                          |

    Each fetch shows two times because the TanStack Start dev entry uses `StrictMode`. Production sends one.
- What happens: Queue, history, and service are one route and one component. Queue and history use the same `/api/runs` answer. The header changes between them with a new document. The in-page "View history" link does the same change with zero requests.
- Impact: Each header click costs one document, all scripts, hydration, one `/api/runs` request with its access check, and one `/api/operations` request. The user sees "Checking access and loading runs…" each time. The navigation glider cannot animate, because the page is replaced.
- Recommendation: Render router links. The codebase already uses this pattern for variant chips (`review-workspace.tsx:748-759`).

  ```tsx
  <NavLink
    key={id}
    render={<Link to="/" search={view ? { view } : {}} />}
    aria-current={active === id ? "page" : undefined}
  >
  ```

- Alternatives:
  - Minimal: change the five anchors (three nav rows, the brand, the "Queue" button). Keep everything else.
  - Structural: give history and status their own routes below a layout route that keeps the run list in memory (see SHELL-16).
  - Keep the anchors, and make a reload cheap with server-rendered data (see SHELL-02).
- Maintainer decision needed: no.

### SHELL-02 · No page ships data from the server, and each mount starts again with "Checking access…"

- Kind: performance
- Severity: high. Confidence: high. Measured: yes (order of events and server HTML; no production times). Effort: M
- Evidence:
  - `apps/web/src/routes/index.tsx:161`: `const [state, setState] = useState<DashboardState>({ status: "loading" });`
  - `apps/web/src/routes/index.tsx:180-184`: `const response = await fetch("/api/runs", { credentials: "same-origin", cache: "no-store", signal: controller.signal });`
  - `apps/web/src/routes/runs.$runId.tsx:31-36`: `ssr: false,` … `gcTime: 0, staleTime: Infinity,`
  - `apps/web/src/routes/pulls.$pullNumber.tsx:43`: `const [state, setState] = useState<PageState>({ status: "loading" });`
  - `apps/web/src/router.tsx:8`: `return createRouter({ routeTree, scrollRestoration: true, ssr: { nonce: scriptNonce() } });` There is no `defaultPreload`, and no link sets `preload`.
  - Measurement M1 (server HTML, `curl`): the only body text of `/` is `visonaut. Review queue Run history Service status Checking access and loading runs…`. The run page has `Checking access and loading this run…`. The pull page has `Finding this pull request’s visual review…`.
  - Measurement M6 (real app, document load of a run): `request document` at 2 ms, `loading text visible` at 110 ms, `request fetch /api/runs/<id>` at 209 ms, `workspace visible` at 470 ms. The API request starts only after the scripts run.
  - Measurement M7 (real app, browser Back from a run to the queue, run list delayed by 800 ms): at 12 ms the page shows `Checking access and loading runs…` with `scrollY` 0. The scroll position before leaving was 250. Requests after Back: `fetch /api/runs` x2 (one in production). After the data arrives, `scrollY` is still 0.
- What happens: The server renders the loading text for each route. The data request starts after script download, parse, and hydration. Component state holds the answer, so each mount starts empty. This includes Back, a header click, and a return to a run that was open a moment ago.
- Impact: Time to content is document, plus scripts, plus one API round trip with an access check, in series. Not measured in production. Back loses the list scroll position, because the router restores scroll before the list exists. Hover or focus on a run link does not start its request.
- Recommendation: Move the reads into route loaders, keep their results for a short time, and preload on intent. Then decide separately if the loaders also run on the server.

  ```tsx
  // routes/index.tsx
  export const Route = createFileRoute("/")({
    loader: ({ abortController }) => loadDashboard(abortController.signal),
    staleTime: 30_000,
    pendingComponent: QueueSkeleton,
  });
  // router.tsx
  createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true, ssr: { nonce } });
  ```

- Alternatives:
  - Minimal: keep the effects, and add a module-level cache keyed by URL. Paint from the cache at once, then revalidate.
  - Server data: run the loaders during document render. The Worker already owns the session, D1, and the handlers. The HTML then contains the queue or the review model, and step 5 to step 7 of sequence A leave the critical path. This needs the session `Set-Cookie` headers on the document response.
  - Run route only: remove `gcTime: 0` and `ssr: false`, or keep `ssr: false` and add `pendingMs: 0` with a skeleton (see SHELL-04).
- Maintainer decision needed: yes. Can the document response contain private run data (it already has `cache-control: no-store, private`)? Can a review model that is some seconds old show while a fresh one loads? The comment at `apps/web/src/review/client.ts:364` says "Router loaders own reads; command sessions remain local to the review page."

### SHELL-03 · The alerts request waits for the run list, and the Service status page waits for a run list that it does not use

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:254-256`: `{state.status === "ready" && !state.preview && view !== "service" && (<OperationsAttention onAccessDenied={onAccessDenied} />)}`
  - `apps/web/src/routes/index.tsx:356`, `363-364`: `{state.status === "ready" && (` … `{view === "service" ? (<OperationsAttention onAccessDenied={onAccessDenied} layout="page" />`
  - Measurement M5 (fixture, each API answer delayed by 400 ms). On `/`: `/api/runs` started at 165 ms and ended at 567 ms; `/api/operations` started at 601 ms. On `/?view=service`: `/api/runs` 148 ms to 548 ms; `/api/operations` started at 565 ms.
- What happens: `OperationsAttention` mounts only after the run list is `ready`. On the service view the run list supplies only the repository name and the preview flag.
- Impact: The service page needs two serial round trips and two access checks before its first content. On the queue, the bell count arrives one round trip after the list.
- Recommendation: Start both requests at the same time. A layout route (SHELL-16) can own the alerts state, so the bell does not depend on the page.
- Alternatives:
  - Add a small alert summary (`count`, `hasMore`) to the `/api/runs` answer. Then the queue and the history need one request, and the full list loads when the popover opens.
  - Give the service view its own route and loader, with no run list.
- Maintainer decision needed: yes. Can the dashboard answer include an alert count?

### SHELL-04 · After a click on a run, the old page stays for up to 1 second with no feedback, then the page goes blank

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/runs.$runId.tsx:32-33`: `// Do not hold the hydrated loading shell after the model is ready.` `pendingMinMs: 0,` No `pendingMs` is set, and `router.tsx:8` sets no `defaultPendingMs`. The router default is 1000 ms.
  - `apps/web/src/routes/runs.$runId.tsx:55-64`: `RunShell` renders `<AppHeader />` with no repository and no account menu.
  - Measurement M8 (real app, `/api/runs/<id>` delayed by 3000 ms, click "Review changes"). The URL changed at once. `main` still showed the queue at 152 ms, 501 ms, and 902 ms. At 1301 ms it showed `Checking access and loading this run…`. At 3602 ms it showed the workspace.
  - Measurement M8, second case (delay 600 ms): the only two `main` contents were the queue and the workspace. No pending state showed.
  - Screenshots `real-queue-to-run-500ms-after-click.png` and `real-queue-to-run-1300ms-after-click.png`.
- What happens: The clicked button shows no pending state. For a load shorter than 1 s the app looks frozen. For a longer load the queue is replaced by an empty page with one line of text, and the header loses the repository name and the account menu.
- Impact: The wait feels longer than it is. The layout changes two times: queue, empty shell, workspace.
- Recommendation: Show the pending state at once, and make it look like the destination.

  ```tsx
  export const Route = createFileRoute("/runs/$runId")({
    pendingMs: 0,
    pendingMinMs: 0,
    pendingComponent: WorkspaceSkeleton, // sidebar rows, header bars, viewer frame
  });
  ```

- Alternatives:
  - Keep the queue on screen, and mark the clicked row as pending (TanStack `Link` exposes its transition state).
  - Preload on intent (SHELL-02), so the model is usually ready at click time.
- Maintainer decision needed: no.

### SHELL-05 · The dev stylesheet contains Tailwind and `ui.css` two times for the root, and four times on the run route

- Kind: performance
- Severity: medium. Confidence: medium. Measured: yes (dev server only). Effort: S
- Evidence:
  - `apps/web/src/styles.css:1-3`: `@import "./review.css";` `@import "tailwindcss";` `@import "./components/ariakit/styles/ui.css";`
  - `apps/web/src/review.css:1-2`: `@import "tailwindcss";` `@import "./components/ariakit/styles/ui.css";` The file has no other rule.
  - `apps/web/src/routes/__root.tsx:2`: `import "../styles.css";`. `apps/web/src/routes/runs.$runId.tsx:21` and `apps/web/src/review/review-workspace.tsx:66`: `import "../review.css";`
  - Measurement M9: `/@tanstack-start/styles.css?routes=__root__` is 883,047 bytes (118,332 gzip). It contains `@property --shell-header-step` 2 times and the `.ak-layer {` utility rule 2 times. The stylesheet for `__root__,/runs/$runId` is 1,625,503 bytes (214,705 gzip), with 4 copies of each.
- What happens: `styles.css` imports `review.css`, which imports Tailwind and `ui.css`. Then `styles.css` imports both again. The run route imports `review.css` one more time as a module.
- Impact: The render-blocking stylesheet is about two times the necessary size in dev. I did not build, so the production result is not known. A minifier does not always merge full duplicate layers.
- Recommendation: Delete `review.css`, its `@import` in `styles.css`, and the two TypeScript imports. One global stylesheet then loads from the root.
- Alternatives: Keep `review.css` for future review-only rules, but remove its two `@import` lines.
- Maintainer decision needed: no.

### SHELL-06 · The review workspace uses 408 px of a 900 px viewport before the first image pixel

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - Measurement M10 (fixture, 10 items, sidebar open). Top and height in px:

    | Band                                         | 1440 x 900 | 390 x 844 | Source                     |
    | -------------------------------------------- | ---------- | --------- | -------------------------- |
    | App header                                   | 0, 48      | 0, 48     | `review-workspace.tsx:535` |
    | Main header (toggle, Queue, title, progress) | 48, 48     | 48, 48    | `:563-608`                 |
    | Run identity strip                           | 96, 26     | 96, 26    | `:609-622`                 |
    | Item heading and pixel count                 | 154, 59    | 185, 54   | `:633-650`                 |
    | Variant chips                                | 233, 38    | 306, 38   | `:713-781`                 |
    | View and zoom controls                       | 286, 55    | 359, 92   | `:817-923`                 |
    | First image pixel                            | 408        | 518       | viewer captions add 67 px  |
    | Sticky action bar                            | 841, 61    | 755, 91   | `:1017-1139`               |

    The image band is 433 px (48% of the viewport) on desktop and 237 px (28%) on a phone.

  - Three links go to `/` in the top 96 px: the brand, "Review queue", and "Queue" (measurement M11, `linksToRoot`).
  - The same facts show more than one time. Run status: `review-workspace.tsx:620` (strip) and `:467` (details). Commit and attempt: `:613-615` (strip) and `:469-470` (details). Count of work: `:597` (header), each sidebar row (`item-list.tsx:256`), and the badge.
  - The strip uses `text-[10px] opacity-50` (`review-workspace.tsx:610`).
  - Screenshots `mock-run-dark-1440.png`, `mock-run-dark-390.png`, `mock-run-dark-1440-details-open.png`.
- What happens: Seven stacked bands come before the screenshot. Two of them are full-width headers that both point back to the queue.
- Impact: The screenshots are the product. They get less than half of a laptop viewport. The maintainer complaint "bloated with text" has its cause here: three header rows, a heading row, and repeated facts.
- Recommendation: Use one context bar on run pages, and move facts that do not change the decision into a popover or the details panel. See redesign ideas R1, R6, and C4. A first step that keeps the structure: remove the global navigation on run pages, put the run title and progress in the app header, and remove the identity strip.
- Alternatives:
  - Keep two bars, but merge the heading row, the variant chips, and the view controls into one toolbar row.
  - Make the header rows scroll away (`$sticky={false}`), and keep only the action bar sticky.
- Maintainer decision needed: yes. `docs/review-guide.md:17` says "Check the run identity above the images before you save a decision." Which facts must stay on screen during review: PR number and title, commit, attempt, baseline revision, run status?

### SHELL-07 · Each page has the document title "Visonaut"

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/__root.tsx:10`: `{ title: "Visonaut" },`. No other route has a `head` option (search for `head:` and `document.title` in `apps/web/src`, no other match).
  - Measurement M3 (real app): `/`, `/?view=history`, `/?view=service`, `/runs/<id>`, `/pulls/4817`, and `/nope` all return the title `Visonaut`.
- What happens: The queue, a run, a pull request card, and the not-found page have the same title.
- Impact: Tabs, bookmarks, and the history menu cannot tell pages apart. A reviewer with three runs open sees three tabs named "Visonaut". A screen reader announces the same title after each navigation.
- Recommendation: Set `head` on each route. Put the object first.

  ```tsx
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.model.run.title ?? "Run"} · Visonaut` }],
  }),
  ```

  Examples: `Review queue (2) · Visonaut`, `#4817 Fix Dialog focus restoration · Visonaut`, `Run history · Visonaut`, `Service status · Visonaut`.

- Alternatives: Set `document.title` in an effect until the pages have loaders.
- Maintainer decision needed: no.

### SHELL-08 · URL model: pages are a search parameter, a pull request link works only with a check ID, and view state is not in the URL

- Kind: ux
- Severity: medium. Confidence: high. Measured: no (code reading; two states confirmed by screenshot). Effort: M
- Evidence:
  - `apps/web/src/routes/index.tsx:40-42`: `validateSearch: (search): { view?: "history" | "service" } => ({ view: search.view === "history" || search.view === "service" ? search.view : undefined })`. Three pages live in one 752-line route file.
  - `apps/web/src/api/review.ts:739-741`: `if (!check || !/^visonaut:pre:[a-f0-9]{40}(?::[1-9][0-9]*)?$/.test(check)) { throw new SecurityError("not_found", 404, "The pull-request check was not found."); }`. So `/pulls/4817` without `check` always shows "Review unavailable".
  - `apps/web/src/routes/pulls.$pullNumber.tsx:70-72`: `throw new Error("This Visonaut check was not found. Open the latest check on GitHub.");` The error state offers only "Retry" (`:216-223`), with no GitHub link. Screenshot `mock-pull-missing-dark-1440.png`.
  - `apps/web/src/routes/pulls.$pullNumber.tsx:82`: `await navigate({ to: "/runs/$runId", params: { runId }, replace: true });` The pull number leaves the URL.
  - `apps/web/src/api/review.ts:561`: ``title: `#${pullRequestNumber} · ${…title || "Pull request visual review"}`,``. The run model has the pull number only inside a text. The dashboard answer has `pullRequestNumber` and `title` as two fields (`api/dashboard.ts:131-132`).
  - A search for `github.com` in `apps/web/src/review` finds no link. The workspace has no link to the pull request or the commit.
  - `apps/web/src/review/review-workspace.tsx:197-198`: `const [mode, setMode] = useState<ReviewMode>("side");` `const [zoom, setZoom] = useState<ReviewZoom>("fit");`
- What happens: The pull request is the object that a reviewer knows, but it has no stable URL and no page. A run is a UUID. A shared link always opens in "Compare" and "Fit".
- Impact: A reviewer cannot type or share "the visual review of PR 4817". From the workspace, the way back to the pull request on GitHub is manual. A link to "look at this diff" cannot carry the diff view.
- Recommendation: Use path segments for pages and objects, and search parameters for view state.

  | Object           | Today                                  | Option                                                             |
  | ---------------- | -------------------------------------- | ------------------------------------------------------------------ |
  | Queue            | `/`                                    | `/`                                                                |
  | History          | `/?view=history`                       | `/history?q=&state=`                                               |
  | Service          | `/?view=service`                       | `/status`                                                          |
  | Pull request     | `/pulls/4817?check=visonaut:pre:<sha>` | `/pulls/4817` opens the latest run; `?check=` selects an exact one |
  | Run              | `/runs/<uuid>`                         | Keep                                                               |
  | Item and variant | `?item=dialog%2Fopen&variant=Dark`     | Keep, or `/runs/<uuid>/dialog/open?variant=Dark`                   |
  | View             | not in the URL                         | `&mode=diff&zoom=2`                                                |

- Alternatives:
  - Minimal: keep the routes. Add `pullRequestNumber` and a GitHub URL to the run model, show them in the header, and put `mode` in the search parameters.
  - Add old-to-new redirects for `/?view=…` if the routes change, because the sign-in callback uses them (`index.tsx:218`).
- Maintainer decision needed: yes. Can `/pulls/:number` resolve the latest run without a check ID? Is the pull request, or the run, the primary object in the URL and the header?

### SHELL-09 · Item and variant links add history entries and scroll the page to the top; keyboard selection replaces the entry

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/item-list.tsx:205-214` and `apps/web/src/review/review-workspace.tsx:750-758`: `<Link to="/runs/$runId" params={{ runId: route.runId }} search={{ comparison: route.comparisonId, item: …, variant: … }} />` with no `replace` and no `resetScroll`.
  - `apps/web/src/routes/runs.$runId.tsx:120-129`: `void navigate({ to: "/runs/$runId", params: { runId }, search: { … }, replace: true });`
  - Measurement M2 (real app): variant link click, `history.length` 8 to 9, then 9 to 10. Keyboard ArrowRight, 10 to 10.
  - Measurement M12: on the real app, `scrollY` was 200 before a variant link click and 0 after it. Keyboard selection also ended at 0 (measurement M4: 223 to 0). In the harness without a router (`index.html`, local selection state), `scrollY` went from 200 to 149.
- What happens: A mouse click on an item or a variant pushes an entry. A key press or "Approve & next" replaces it. Both paths reset the window scroll, because the router resets scroll on each navigation.
- Impact: After a review with the mouse, Back steps through each visited variant before it leaves the run. A reviewer who scrolled down to inspect the lower part of a tall screenshot loses that position on each variant change, so the same region cannot be compared across variants.
- Recommendation: Use one rule for both inputs, and keep the scroll position inside a run.

  ```tsx
  <Link to="/runs/$runId" params={…} search={…} replace resetScroll={false} />
  // and in onSelect:
  navigate({ …, replace: true, resetScroll: false });
  ```

- Alternatives: Push for an item change and replace for a variant change. Then Back means "previous screenshot".
- Maintainer decision needed: yes. What must Back do inside a run: leave the run, go to the previous item, or go to the previous variant?

### SHELL-10 · An unknown URL shows the bare text "Not Found", a missing run offers only "Retry", and the root has no error component

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/__root.tsx:5-16`: the root route has `head` and `component` only. `apps/web/src/router.tsx:8` sets no `defaultNotFoundComponent` and no `defaultErrorComponent`.
  - Measurement M1: `GET /nope` returns HTTP 404 with `<body><p>Not Found</p>…`. The browser console prints: `A notFoundError was encountered on the route with ID "__root__", but a notFoundComponent option was not configured`. Screenshot `real-notfound-dark-1440.png`.
  - `apps/web/src/routes/runs.$runId.tsx:78-83`: the error text branches only on status 403. Each error gets the same "Retry" button (`:98-107`). Screenshot `mock-run-missing-dark-1440.png` shows "This run could not be opened. The run was not found. Retry".
  - `apps/web/src/routes/index.tsx:39-44` and `pulls.$pullNumber.tsx:23-28` set no `errorComponent`.
- What happens: A wrong path shows unstyled text at the top left, with no header and no link. A run that does not exist offers a retry that cannot succeed. A render error on the queue or the pull page shows the default TanStack error output (from code, not triggered).
- Impact: Dead ends. A mistyped or expired link gives no way back to the queue.
- Recommendation: Add a root `notFoundComponent` and `errorComponent` that render inside the shell. In `RunError`, branch on the status: 404 gets "Run not found" and a link to the queue; 403 gets "Use another account" (see SHELL-14).
- Alternatives: Minimal: set `defaultNotFoundComponent` on the router to a one-card page with a "Review queue" link.
- Maintainer decision needed: no.

### SHELL-11 · With a root font size above 16 px, the item list and the details panel cannot be opened between 1024 px and 64rem

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes (item list). Effort: S
- Evidence:
  - `apps/web/src/review/review-workspace.tsx:211-213`: `const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches);` A pixel threshold on the viewport.
  - `apps/web/src/review/review-workspace.tsx:538-540`, `570`: `$show="5xl"` on the sidebar and `className="@max-5xl/shell:hidden"` on its toggle. A 64rem threshold on the shell container (`components/ariakit/styles/shell.ts:407-408`).
  - `apps/web/src/review/review-workspace.tsx:559`: `{!narrow && itemNavigation}`, `:625`: `{narrow && (<Button … onClick={() => setItemsOpen(true)}>`, `:1149`: `open={detailsOpen && !narrow}`, `:1224`: `open={detailsOpen && narrow}`.
  - Measurement M13 (fixture, `html { font-size: 20px }`, which is what the Chrome "Large" font setting does):

    | Case                  | `narrow` | Sidebar visible | Toggle visible | "Screenshots" dialog button | Item links visible |
    | --------------------- | -------- | --------------- | -------------- | --------------------------- | ------------------ |
    | 16 px root, 1100 wide | false    | yes             | yes            | no                          | 3                  |
    | 20 px root, 1100 wide | false    | no              | no             | no                          | 0                  |
    | 20 px root, 1000 wide | true     | no              | no             | yes                         | 0 (dialog closed)  |

  - Screenshot `mock-run-dark-1100-root-20px.png`.
- What happens: Two different rules decide the same layout. CSS hides the sidebar below 64rem. JavaScript shows the dialog button below 1024 px. With a 20 px root font, 64rem is 1280 px. Between 1024 px and 1279 px neither control exists.
- Impact: A reviewer with a larger browser font size on a laptop-width window has no item list and no filter. Only the previous and next arrows and the arrow keys remain. The "Details" button has the same two conditions, so it should open nothing in that range (from code, not measured).
- Recommendation: Use one rule. The smallest change is a media query in the same unit:

  ```ts
  const media = window.matchMedia("(max-width: 63.999rem)");
  ```

- Alternatives: Let CSS decide both sides. Render the dialog trigger always, with `className="@5xl/shell:hidden"`, and read the layout from the shell element with a `ResizeObserver` when the dialog must open.
- Maintainer decision needed: no.

### SHELL-12 · The first Tab stop on a run page is the whole page, and there is no skip link

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/review-workspace.tsx:528-534`: `<Shell className="review-workspace …" ref={workspace} tabIndex={0} aria-label="Review workspace" $layer="canvas">`. `Shell` renders a `div` (`components/ariakit/components/shell.ariakit.react.tsx:81-84`).
  - Measurement M14 (fixture): after one Tab press, `document.activeElement` is `div.shell`, role `null`, `aria-label="Review workspace"`, size 1440 x 994, outline `auto 1px rgb(153, 200, 255)`. Screenshot `mock-run-dark-1440-first-tab-stop.png` shows no visible change.
  - Measurement M14, Tab order on a run: workspace `div`, brand, three nav links, account menu, sidebar search, selected item, "Accepted (1)", then the first control in `main` ("Collapse screenshots"). That is nine stops before `main`. On the dashboard, six stops come before `main`.
  - Measurement M11: `skipLink: false` on both pages. `labelledWithoutRole` lists `shell.isolate: Review workspace`.
- What happens: The first Tab press moves focus to a `div` that covers the page. Its 1 px outline sits on the viewport edge. ARIA does not allow a name on a generic `div`, so assistive technology can ignore the label.
- Impact: A keyboard user sees no focus after the first Tab. Each page load needs many Tab presses to reach the review controls.
- Recommendation: Use `tabIndex={-1}` for the programmatic focus that `focusWorkspace` needs (`review-workspace.tsx:247-248`). Move the name to the `main` landmark. Add a skip link as the first focusable element. Tests use `getByLabel("Review workspace")` (`review/__tests__/route.browser.test.ts:306`, `:493`), so they need the new target.
- Alternatives: Give the shell `role="region"` and keep the label, with `tabIndex={-1}`.
- Maintainer decision needed: no.

### SHELL-13 · Small muted text has a 3.96:1 contrast in the light scheme, uses pixel sizes that do not follow the user font size, and is muted in six different ways

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/review/review-workspace.tsx:610`: `<div className="flex flex-wrap items-center gap-4 py-2 text-[10px] opacity-50">`. `:551`: `<Text className="text-[11px] opacity-50">`. `:645`: `className="mt-2 text-xs opacity-55"`.
  - Measurement M15 (fixture, computed colors with opacity applied):

    | Text                                                   | Size  | Dark   | Light  |
    | ------------------------------------------------------ | ----- | ------ | ------ |
    | Run identity strip (commit, attempt, baseline, status) | 10 px | 5.34:1 | 3.96:1 |
    | Sidebar item count                                     | 11 px | 5.34:1 | 3.96:1 |
    | Changed pixels line                                    | 12 px | 6.25:1 | 4.74:1 |
    | "Screenshots" sidebar title                            | 10 px | 7.26:1 | 5.71:1 |

    WCAG AA needs 4.5:1 for text of this size.

  - Count in `routes`, `review`, and the shell components (`rg -N -o`): `ak-ink-60` 45, `opacity-60` 9, `opacity-50` 4, `opacity-55` 1, `ak-ink-50` 1, `ak-ink-40` 1.
  - Count of font sizes in the same files: `text-xs` 61, `text-sm` 36, `text-2xl` 9, `text-[10px]` 9, `text-3xl` 7, `text-[13px]` 6, `text-base` 4, `text-4xl` 4, `text-xl` 3, `text-[11px]` 3, `text-lg` 2, `text-5xl` 1, `text-[28px]` 1. That is 13 sizes.
  - Screenshot `mock-run-dark-1100-root-20px.png`: with a 20 px root font, rem text grows, but the 13 px header links, the 10 px strip, and the 48 px header do not.
  - The recipe guidance says: "Use `layer.$ink` for resting text strength … Each layer computes its own readable minimum against its background" (`~/.claude/skills/ariakit-ariakit-ui-styles/references/composition-and-variants.md`, "Inherited ink"). Upstream has the variant (`packages/ariakit-ui/src/styles/layer.ts:95`). The vendored `layer.ts` does not.
- What happens: `opacity-*` mutes text without the contrast floor that the ink utilities keep. The smallest text is also the most transparent. Pixel sizes ignore the browser font size.
- Impact: The run identity, which the review guide asks the reviewer to check, fails AA in the light scheme. The type has no clear scale, which adds to the "ugly" impression.
- Recommendation: Use ink for muted text, set a minimum size of 12 px for information, and take sizes from a short scale (for example 12, 13, 14, 16, 20, 28) in rem.
- Alternatives: Minimal: change `opacity-50` and `opacity-55` to `ak-ink-60`, and `text-[10px]` to `text-xs`.
- Maintainer decision needed: no.

### SHELL-14 · Sign-in, sign-out, and access errors exist three times, with different layout, copy, and recovery actions

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes (screenshots of each state). Effort: M
- Evidence:

  | Route                                                  | Guest heading and text                                                                                                              | Sign-in button                                 | 403 actions                       | Account menu                         |
  | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------- | ------------------------------------ |
  | `/` (`index.tsx:280-355`)                              | "Every change. A clear decision." hero, card "Review visual changes.", "Use a GitHub account with write access to this repository." | Primary, full width, arrow right               | "Retry" and "Use another account" | Shown for error and 403 (`:257-264`) |
  | `/runs/$runId` (`runs.$runId.tsx:76-111`, `217-246`)   | "Sign in to review this run", "This review is available to Ariakit maintainers."                                                    | Flat, 724 px wide, centered label, log-in icon | "Retry" only                      | None (`RunShell`, `:55-64`)          |
  | `/pulls/$pullNumber` (`pulls.$pullNumber.tsx:184-235`) | "Sign in to review pull request #N", two sentences                                                                                  | Primary, small, arrow up right                 | "Use another account" only        | None in any state (`:152`)           |
  - Sign-out differs: `index.tsx:234` sets the guest state, `runs.$runId.tsx:193` calls `window.location.assign("/")`, `pulls.$pullNumber.tsx:142` sets the guest state.
  - `createAuthClient()` is called at six places (`index.tsx:216`, `232`; `runs.$runId.tsx:175`, `191`; `pulls.$pullNumber.tsx:124`, `138`).
  - `apps/web/src/routes/index.tsx:189-193` shows "Your repository access changed. Write access to this repository is required." for each 403, also on a first visit.
  - Screenshots `mock-queue-guest-dark-1440.png`, `mock-run-guest-dark-1440.png`, `mock-pull-guest-dark-1440.png`, `mock-queue-forbidden-dark-1440.png`, `mock-run-forbidden-dark-1440.png`, `mock-pull-forbidden-dark-1440.png`.

- What happens: Each route owns its session handling and its gate screens.
- Impact: A user who is signed in with an account without access, and who opens a run link, has no account control on that page. The three sign-in screens look like three products. A guest on `/` sees the full navigation with "Review queue" selected, and each of its links leads to the same sign-in screen.
- Recommendation: One session source and one gate component, used by a layout route.

  ```tsx
  <Gate
    kind="sign-in" // or "no-access", "not-found", "error"
    title="Sign in to review pull request #4817"
    actions={<SignInButton callbackURL={location.href} />}
  />
  ```

- Alternatives: Minimal: pass `end={<UserMenu …/>}` to the header in `RunShell` and on the pull page, and add "Use another account" to the run 403 state.
- Maintainer decision needed: yes. Which sign-in layout and which sentence are the standard?

### SHELL-15 · The account menu never shows the signed-in user; the `login` prop and two identity endpoints have no caller

- Kind: dead-code
- Severity: medium. Confidence: high. Measured: no (search of the repository; screenshot of the menu). Effort: S
- Evidence:
  - `apps/web/src/components/user-menu.tsx:24`: ``const accountLabel = preview ? "Preview account" : login ? `@${login}` : "Account";``
  - Callers pass no `login`: `apps/web/src/routes/index.tsx:258-263` and `apps/web/src/routes/runs.$runId.tsx:207-212`. A search for `login=` in `apps/web/src` has no match.
  - `apps/web/src/server.ts:88-104`: `/api/me` returns `{ userId }`. `apps/web/src/api/review.ts:713-721`: `/api/session` returns `user: { id, githubUserId, login }`. A search for both paths in `apps/web/src` and `packages` finds no client call. Tests assert that `/api/me` is not requested (`review/__tests__/route.browser.test.ts:103`).
  - Screenshot `mock-queue-dark-1440-account-menu.png`: heading "Account", text "Manage your GitHub session.", one button "Sign out".
- What happens: The header says "Account" for each user. The popover has a heading and a sentence for one action.
- Impact: A reviewer cannot see which GitHub account will sign the decisions. The server already knows the login on each private request (`context.identity.login`).
- Recommendation: Add `viewer: { login }` to the `/api/runs` and `/api/runs/:id` answers, and pass it to the menu. No new request is necessary. Remove the endpoints that have no caller, or state who uses them.
- Alternatives: Call `/api/session` one time in a layout route. This adds a request, so it needs caching.
- Maintainer decision needed: yes. Can the two payloads include the login? Are `/api/me` and `/api/session` used outside this repository?

### SHELL-16 · There is no layout route; four call sites build their own shell and header, and the header differs between pages

- Kind: simplification
- Severity: medium. Confidence: high. Measured: yes (header geometry). Effort: M
- Evidence:
  - Four call sites: `apps/web/src/routes/index.tsx:248-267`, `apps/web/src/routes/pulls.$pullNumber.tsx:151-152`, `apps/web/src/routes/runs.$runId.tsx:57-58`, `apps/web/src/review/review-workspace.tsx:528-535`. Each repeats `[--shell-header-step:calc(48px/14)]`.
  - Only one has `text-sm`: `index.tsx:248`: `<Shell $layer="canvas" className="dashboard text-sm [--shell-header-step:calc(48px/14)]">`.
  - Measurement M16 (real app, 1440 wide):

    | Page                        | Shell font size | Header padding left | Nav box                           | Header end x |
    | --------------------------- | --------------- | ------------------- | --------------------------------- | ------------ |
    | `/`, `/?view=history`       | 14 px           | 10.5 px             | x 527.6, width 384.8, height 31.6 | 1274.7       |
    | `/runs/<id>`, `/pulls/4817` | 16 px           | 12 px               | x 526.4, width 387.3, height 32.5 | 1273.2       |

  - Measurement M17 (fixture): the header has 4 controls and no repository while the queue loads, and 6 controls and the repository when ready.
  - Measurement M1: the run page HTML has no `aria-current` in the navigation. The index HTML has one.
- What happens: The header is a per-route copy. Its spacing uses `em`, so the dashboard `text-sm` moves it by 1.5 px. Its content depends on what each route passes.
- Impact: The header jumps between pages and between loading and ready. Session, alerts, and the run list cannot be shared, which contributes to SHELL-02, SHELL-03, and SHELL-14.
- Recommendation: One pathless layout route owns the shell, the header, the session, and the alerts.

  ```text
  routes/
    __root.tsx                 html, head, not-found, error
    _app.tsx                   <Shell> + header + session + alerts + <Outlet />
    _app.index.tsx             queue
    _app.history.tsx           history
    _app.status.tsx            service status
    _app.pulls.$pullNumber.tsx
    _app.runs.$runId.tsx       may render a nested <Shell> for its sidebars
  ```

  Nested shells are a supported case (`components/ariakit/styles/shell.ts:36-47`, and the upstream "Dashboard" and "Nested shells" scenarios in `app/src/sandbox/ariakit-ui-shell/index.react.tsx:412-520`).

- Alternatives: Minimal: one `PageShell` component that sets the class, the font size, and the header, and that each route uses.
- Maintainer decision needed: yes. Is a layout route with shared session and alert state acceptable?

### SHELL-17 · Keyboard help sits in a page footer below the fold, next to a "Recompare stored run" button that can never be enabled

- Kind: dead-code
- Severity: medium. Confidence: high. Measured: yes (footer position). Effort: S
- Evidence:
  - `apps/web/src/review/review-workspace.tsx:1172-1205`: the `ShellFooter` holds `<ShortcutHelp />`, the "Shortcuts on/off" button, and "Recompare stored run".
  - Measurement M10: the footer top is at 954 px on a 900 px viewport, and at 1584 px on an 844 px phone viewport. Screenshot `mock-run-dark-1440-scrolled-to-footer.png`.
  - `apps/web/src/api/review.ts:592`: `recompareAllowed: false,` with no other value in the file. `apps/web/src/api/review.ts:101-102`: `"Server recomparison is retired. Capture a new complete run with trusted local Submit."`. The endpoint throws on each path (`:950-986`).
  - `apps/web/src/review/review-workspace.tsx:1186-1201`: the button and a `<p>{recompareDisabledReason}</p>` render for each run that is not a preview. `:979-989` ("Recompare now") and `use-review-session.ts:509` cannot run.
  - `docs/review-guide.md:88`: "**Recompare stored run** is retired."
- What happens: The entry to the shortcut list is not visible on any viewport without a scroll to the page end. In production the footer also shows a disabled button and a sentence that explains why it is disabled.
- Impact: The keyboard workflow, which is the fast path, is not discoverable. Retired UI adds text.
- Recommendation: Move keyboard help to a place that is always visible (header or a status bar, plus a `?` shortcut). Remove the recompare button, the reason text, the client command, and the endpoint.
- Alternatives: Keep the endpoint as a fixed 409 for old clients, and remove only the UI.
- Maintainer decision needed: yes. Confirm that the recompare UI and endpoint can be deleted.

### SHELL-18 · One object has several names in the navigation, and the review guide names controls that do not exist

- Kind: copy
- Severity: medium. Confidence: high. Measured: no (text search). Effort: S
- Evidence:

  | Object     | Names in the UI                                                                           | Where                                                                                |
  | ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
  | Item       | "Screenshots", "item(s)", "Review items", "Review navigation", "screenshot", "whole item" | `review-workspace.tsx:549`, `552`, `545`, `654`, `1280`; `item-list.tsx:300`         |
  | Variant    | "Variants", "view", "views", "Capture details", "Selected variant"                        | `review-workspace.tsx:728`, `1077`, `1055`, `1154`, `796`; `index.tsx:454`, `502`    |
  | Queue page | "Review queue", "Queue", "Visonaut review queue", "Your review queue."                    | `app-shell.tsx:16`, `29`; `review-workspace.tsx:584`; `index.tsx:433`                |
  | Alerts     | "Service status", "Service attention", "Operations", "operation alerts", "service alerts" | `app-shell.tsx:18`; `operations-attention/index.tsx:315`, `321`, `325`, `343`, `253` |
  - `docs/review-guide.md:15`: "The Runs page shows the run type…". No page has that name.
  - `docs/review-guide.md:92`: "Use **All runs** to return to the dashboard". A search for `All runs` in `apps/web/src` has no match. The control is "Queue".
  - `docs/review-guide.md:31-34` names "Side by side", "Pixel diff", "New only", "Original only". The buttons say "Compare", "Difference", "Current", "Baseline" (`review-workspace.tsx:845`, `860`, `874`, `888`). The help dialog uses the guide words (`:175`). The image labels say "Reference" and "New image" (measurement M11).

- What happens: The sidebar is titled "Screenshots", counts "items", and the action bar approves a "view" that the chip row calls a "variant".
- Impact: A new reviewer must learn that three words mean one thing. The guide and the app disagree.
- Recommendation: Choose one word for each object, and use it in the UI, the ARIA names, and the guide. The contract uses "item" and "variant" (`docs/current-contract.md:184`).
- Alternatives: Keep "screenshot" as the user word for item, and change the contract words in the UI only.
- Maintainer decision needed: yes. Which words are the standard: item or screenshot, variant or view, baseline and current or reference and candidate, service status or alerts?

### SHELL-19 · Shell parts are overridden with `!` classes, controls are hand-built where primitives exist, and two vendored components have no user

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: M
- Evidence:
  - Overrides: `review-workspace.tsx:557` (`overflow-hidden! pt-0!`), `:609` (`py-0! border-b border-(--ak-edge)`), `:623` (`pb-0!`), `:1175` (`flex! flex-wrap … min-h-10!`). The footer does not use its `start` and `end` parts (`components/ariakit/components/shell.ariakit.react.tsx:198-208`).
  - Extra wrappers: `app-shell.tsx:28` and `index.tsx:253` wrap bar content in `<div className="flex … items-center gap-…">`, but the bar part is already `flex items-center gap-2` (`styles/shell.ts:213-214`).
  - Hand-built controls: native `<progress>` (`review-workspace.tsx:599-604`), a separator `<div className="h-5 w-px bg-current/10" />` (`:1041`), four `ak.Dialog` with a `Frame` and a manual backdrop (`:155-158`, `:1206-1211`, `:1223-1230`, `:1242-1248`), `title=` as tooltip (`:575`, `:655`, `:666`), a raw `<input>` and `<select>` inside `Frame` (`index.tsx:646-687`).
  - The vendored copy is pinned to [`fc85b809`](https://github.com/ariakit/ariakit/commit/fc85b809f3b44d3bc72fa1eae927f785ce744f02) (`components/ariakit/NOTICE`). It has 13 components. Upstream has 27, with `dialog`, `tooltip`, `separator`, `progress`, `input`, `heading`, `link`, `combobox`, and `code`.
  - No file outside the vendored folder imports `kbd.ariakit.react.tsx` or `tabs.ariakit.react.tsx`.
  - The sidebar landmark is `aside` "Review navigation" around `nav` "Review items" (`review-workspace.tsx:543-545`, `item-list.tsx:299-300`). The upstream scenarios render the sidebar as the `nav` and put the `Nav` recipe on a `div` (`app/src/sandbox/ariakit-ui-shell/index.react.tsx:171-173`).
- What happens: The app fights some defaults of the shell parts, and it builds dialogs, tooltips, progress, and inputs by hand.
- Impact: More class text, less consistency, and behavior that the primitives already solve (overlay transitions, tooltip timing, focus).
- Recommendation: Update the vendored copy to current upstream before the redesign, then use `Dialog`, `Tooltip`, `Separator`, `Progress`, `Input`, `Heading`, and `Kbd`. Use `ShellFooter start/end` and part variants in place of `!` classes.
- Alternatives: Keep the pinned copy, and add only the missing components that the redesign needs.
- Maintainer decision needed: yes. Can the vendored copy move to current upstream?

### SHELL-20 · Visual details in the shell chrome

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence (measurement M18 unless stated):
  1. The "Capture details" panel header is 48 px high and starts at 96 px, beside the 26 px identity strip. Its lower border ends at 144 px, in the middle of the item heading. Cause: `$from="intro"` with `ShellSidebarHeader $height="sm"` (`review-workspace.tsx:1142-1153`). Screenshot `mock-run-dark-1440-details-open.png`.
  2. "Accepted (1)" in the sidebar is 16 px text. The item rows are 12 px (`item-list.tsx:377-379`, `:246`).
  3. The run loading text sits at x 336, y 60, not in the center. `className="min-h-[60dvh] items-center"` (`runs.$runId.tsx:60`) has no effect on a grid with `content-start`. The queue loading text sits at x 160 in a 70rem column, so the two loading states do not line up.
  4. Flat buttons that are grid children stretch to the column width with a centered label: "Sign in with GitHub" and "Retry" are 724 x 33 px on the run page (`runs.$runId.tsx:98-107`, `236-243`), and "Review queue" on the pull page is 592 x 33 px (`pulls.$pullNumber.tsx:155-160`). They look like centered text.
  5. The selected header link is 1.8 px wider than the same link when not selected (131.8 against 130.0 for "Review queue", measurement M16), because the weight changes. The other links move.
  6. The selected header link has a filled pill and an underline bar at the same time (`app-shell.tsx:49`, screenshot `mock-queue-dark-1440.png`).
  7. The favicon is a white "V" on `#647cff` (`apps/web/public/favicon.svg`). The header mark is the Lucide aperture icon on the brand layer (`app-shell.tsx:30-32`).
  8. The account popover covers the "Refresh runs" button (screenshot `mock-queue-dark-1440-account-menu.png`).
- What happens: Small misalignments and mixed sizes in the frame of the app.
- Impact: Each is minor. Together they make the chrome look unfinished.
- Recommendation: Fix them as part of the redesign. For item 1, start the details panel at the main header (`$from="main"`) or remove its header. For item 5, reserve the bold width or keep one weight.
- Alternatives: None for the list as a whole.
- Maintainer decision needed: no.

### SHELL-21 · Header controls are smaller than 24 px at a 390 px width, and shortcut letters show on touch layouts

- Kind: accessibility
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Measurement M19 (fixture, 390 x 844, touch): brand link 19 x 23 px, each nav link 32 x 32 px, alerts 36 x 36 px, account 29 x 29 px. In the workspace: "Queue" 68 x 23 px, previous and next 29 x 29 px.
  - `apps/web/src/components/app-shell.tsx:29` (`$p={1}`), `apps/web/src/components/user-menu.tsx:39` (`$p={2}`), `apps/web/src/review/review-workspace.tsx:580` (`$p={1}`).
  - Screenshot `mock-run-dark-390.png`: "Compare S", "Difference D", "Reject view X", "Approve & next A" show key letters on a touch layout.
  - `docs/review-guide.md:94`: "Launch review validation targets Chrome Desktop and keyboard operation. Mobile workflows … have separate validation scope."
- What happens: The brand link and the "Queue" link are below the 24 px minimum of WCAG 2.2 SC 2.5.8, unless its spacing exception applies.
- Impact: Hard to hit on a phone. Low priority while phones are out of the launch scope.
- Recommendation: Use at least `$p={2}` on icon-only controls, and hide `ButtonSlot $kind="shortcut"` when the pointer is coarse.
- Alternatives: None.
- Maintainer decision needed: yes. Is review on a phone in scope for the redesign?

### SHELL-22 · The sidebar preference script runs in the head of each page, but only a client-only route reads it

- Kind: simplification
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `apps/web/src/routes/__root.tsx:21-26`: `<html lang="en" className="[font-synthesis:none]" suppressHydrationWarning>` and `<script nonce={router.options.ssr?.nonce} dangerouslySetInnerHTML={{ __html: sidebarPreferenceScript }} />`.
  - `apps/web/src/review/sidebar-preference.ts:3-4`: "The run route renders on the client. Read this in the document head so its first render uses the saved layout".
  - `apps/web/src/review/review-workspace.tsx:202-206` is the only reader: `typeof document === "undefined" || document.documentElement.dataset.reviewSidebarOpen !== "false"`. No CSS reads the attribute (search for `review-sidebar-open`, no match).
  - `apps/web/src/routes/runs.$runId.tsx:31`: `ssr: false`.
- What happens: The workspace never renders on the server, so its state initializer can read `localStorage` directly. The script, the data attribute, and `suppressHydrationWarning` on `<html>` exist for a case that does not occur.
- Impact: One inline script on each document, also on the queue and the 404 page. Low cost. It is a trap for the next reader.
- Recommendation: Read storage in the initializer, and remove the script and the attribute.

  ```ts
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(sidebarStorageKey) !== "false";
    } catch {
      return true;
    }
  });
  ```

- Alternatives: Keep the script only if the workspace becomes server-rendered. Then let CSS read the attribute, so the first paint is correct without JavaScript.
- Maintainer decision needed: no.

## Screenshots

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-shell/screens/`. "real" means the preview-fixture app on port 4310. "mock" means the route fixture on port 4311 with mocked API answers (repository `ariakit/ariakit`, four actionable runs, ten history rows, two alerts, ten items).

Dashboard, ready state:

- `queue-dark-1440.png`: real queue, dark. "Preview fixtures" shows three times (header, note, eyebrow).
- `queue-light-1440.png`: real queue, light.
- `history-dark-1440.png`: real history, dark, one row.
- `service-dark-1440.png`: real service status, dark, no alerts.
- `mock-queue-dark-1440.png`: queue with realistic data. Two cards fill the 900 px viewport.
- `mock-queue-dark-1440-fullpage.png`: the same page, full height (1182 px for four runs).
- `mock-queue-light-1440.png`: the same page, light.
- `mock-queue-dark-1024.png`: queue at 1024 px. The repository name is gone from the header.
- `mock-queue-dark-768.png`: queue at 768 px. The brand word is gone.
- `mock-queue-dark-390.png`: queue on a phone. The first run starts at 400 px.
- `real-queue-light-390.png`: real queue on a phone, light.
- `mock-history-dark-1440.png`: history with ten rows. Two "Needs review" badges have different colors.
- `mock-history-dark-390.png`: history on a phone.
- `real-history-light-390.png`: real history on a phone, light.
- `mock-service-dark-1440.png`: service status with two alerts. The bell is not in the header on this view.
- `mock-service-dark-390.png`: service status on a phone.
- `mock-queue-dark-1440-alerts-popover.png`: alerts popover, titled "Service attention".
- `mock-queue-dark-1440-account-menu.png`: account popover: "Account", one sentence, "Sign out".
- `real-queue-dark-1440-user-menu.png`: preview account popover. It covers "Refresh runs".
- `real-queue-dark-390-user-menu.png`: preview account popover on a phone.

Dashboard, other states:

- `mock-queue-loading-dark-1440.png`: loading. Header without repository and account. One line of text.
- `mock-queue-loading-dark-390.png`: loading on a phone.
- `mock-queue-guest-dark-1440.png`: signed out. Hero and sign-in card. The navigation is fully visible.
- `mock-queue-guest-light-1440.png`: signed out, light.
- `mock-queue-guest-dark-390.png`: signed out on a phone.
- `mock-queue-forbidden-dark-1440.png`: 403. "Retry" and "Use another account".
- `mock-queue-forbidden-dark-390.png`: 403 on a phone.
- `mock-queue-error-dark-1440.png`: 503. "Retry".
- `mock-queue-empty-dark-1440.png`: empty queue. Three zero counters above "All reviews are complete."

Review workspace:

- `run-dark-1440.png`: real run, dark. The first image pixel is below 430 px.
- `real-run-light-1440.png`: real run, light.
- `real-run-dark-1440-fullpage.png`: real run, full page. The footer is at the end, below the action bar.
- `real-run-dark-1440-sidebar-closed-details-open.png`: sidebar closed, details panel open. The run ID is a full UUID.
- `real-run-dark-1024.png`: real run at 1024 px, sidebar visible.
- `real-run-dark-768.png`: real run at 768 px, "Screenshots" dialog button in place of the sidebar.
- `real-run-light-390.png`: real run on a phone, light.
- `mock-run-dark-1440.png`: run with ten items. No current item in the header navigation.
- `mock-run-light-1440.png`: the same, light.
- `mock-run-dark-1440-fullpage.png`: the same, full page.
- `mock-run-dark-1440-details-open.png`: details panel open. Its header does not align with the strip.
- `mock-run-dark-1440-sidebar-closed.png`: sidebar closed.
- `mock-run-dark-1440-scrolled-to-footer.png`: scrolled to the end. Keyboard help, "Shortcuts on", and "Recompare stored run".
- `mock-run-dark-1440-first-tab-stop.png`: after one Tab press. No visible focus.
- `mock-run-dark-1100.png`: run at 1100 px.
- `mock-run-dark-1100-root-20px.png`: run at 1100 px with a 20 px root font. No sidebar, no toggle, no dialog button.
- `mock-run-dark-390.png`: run on a phone. The image starts at 518 px.
- `mock-run-dark-390-fullpage.png`: run on a phone, full page (1624 px). Baseline and current stack.
- `mock-run-dark-390-items-dialog.png`: the "Screenshots" dialog on a phone.

Run page, other states:

- `mock-run-loading-dark-1440.png`: loading. One line at the top left.
- `mock-run-guest-dark-1440.png`: signed out. A card at the top with a full-width flat button.
- `mock-run-guest-dark-390.png`: signed out on a phone.
- `mock-run-forbidden-dark-1440.png`: 403. Only "Retry". No account menu.
- `mock-run-missing-dark-1440.png`: 404. "The run was not found." with "Retry".
- `mock-run-error-dark-1440.png`: 503 with a reference ID.
- `real-queue-to-run-500ms-after-click.png`: 500 ms after a click on "Review changes". The queue is still on screen.
- `real-queue-to-run-1300ms-after-click.png`: 1300 ms after the click. The pending page.

Pull request page:

- `mock-pull-loading-dark-1440.png`: loading card.
- `mock-pull-pending-dark-1440.png`: "Waiting for screenshots." The pull number shows two times. The back button is a centered label.
- `mock-pull-pending-dark-390.png`: the same on a phone.
- `mock-pull-failed-dark-1440.png`: "Visual capture failed." on a warning layer.
- `mock-pull-not-required-dark-1440.png`: "No visual review needed."
- `mock-pull-guest-dark-1440.png`: signed out.
- `mock-pull-forbidden-dark-1440.png`: 403. "Use another account".
- `mock-pull-missing-dark-1440.png`: 404. The text says to open GitHub, but there is no link.

Other:

- `real-notfound-dark-1440.png`: `/nope`. The text "Not Found" only.

## Redesign ideas

The maintainer does not require the current patterns. These ideas feed the design lab. R1 to R7 are whole shell and navigation models. C1 to C10 are component ideas that fit more than one model.

Facts about the Shell primitive that limit the options:

- Up to two sidebars on each side, and three nested shell levels (`styles/shell.ts:36-38`, `338-341`).
- Sidebar widths are `xs` 10rem, `sm` 12rem, `md` 16rem, `lg` 20rem, `xl` 24rem (`styles/shell.ts:346-382`). There is no rail preset. A 3.5rem rail needs custom `--shell-slot-width` and `--shell-start-1-width` values, or a new width upstream.
- Header heights are 14, 16, and 18 steps of `--shell-header-step` (`styles/shell.ts:179-183`). A 40 px bar is `[--shell-header-step:calc(40px/14)]` with `$height="sm"`.
- `ShellFooter` is always static (`styles/shell.ts:284-289`). A status bar that stays on screen must be a `sticky bottom-0` band in the body, as the action bar is today.
- The shell is a page-scroll grid. A layout where only the viewer scrolls (R4, R6) needs a check that the body can own the scroll.

### R1 · One context bar (breadcrumb shell)

- What changes: One 44 px bar replaces the app header, the main header, and the identity strip on run pages. The bar is a breadcrumb: mark, queue, pull request, item. Run facts move to a popover on the pull request crumb. History and status become two icon buttons at the end, with the alert count on the status icon. The queue page uses the same bar with a shorter trail.
- Why it is better: It removes 74 px of chrome (48 + 26) and two of the three links to the queue. The bar always says where the user is, which the current header does not do on run pages. Each crumb can open a list of its siblings.
- Sketch:

  ```text
  +------------------------------------------------------------------------------------+
  | (o) Queue / #4817 Fix Dialog focus restoration v / Success dialog    2/23  [?] (!2) @dh |  44
  +----------------+-------------------------------------------------------------------+
  | Filter...      | React Chromium Light v  | Compare  Diff  New  Old |   Fit 100 200 |  40
  | * Success dlg  +-------------------------------+-----------------------------------+
  | * Open menu    | Baseline 600x400              | Current 600x400                   |
  | o New item     |                               |                                   |
  | * Combobox...  |          (image)              |          (image)                  |
  | > Accepted 1   +-------------------------------+-----------------------------------+
  |                | Undo   All 7...                         Reject  X    Approve  A   |  48
  +----------------+-------------------------------------------------------------------+
  ```

  ```tsx
  <ShellHeader
    $height="sm"
    start={<Breadcrumb items={[queue, pullRequest, item]} />}
    end={
      <>
        <ReviewProgress />
        <ShortcutsButton />
        <AlertsButton />
        <AccountButton />
      </>
    }
  />
  ```

### R2 · Slim icon rail

- What changes: Global navigation moves to a narrow rail at the start edge: mark, queue (with a count badge), history, status (with an alert dot), and the account avatar at the end. There is no global top bar. Each page owns one header for its own content. Built as an outer `Shell` with a start `ShellSidebar` and an inner `Shell`, as in the upstream "Dashboard" scenario.
- Why it is better: Screenshots are wider than they are tall, so vertical space is worth more than horizontal space. The rail costs about 56 px of width and returns 48 px of height on each page. The navigation is identical on each page, so it cannot drift.
- Sketch:

  ```text
  +----+-----------------------------------------------------------------------------+
  | (o)| #4817 Fix Dialog focus restoration   9f8e7d6  attempt 2          2/23   [?]  |  44
  |    +---------------+-------------------------------------------------------------+
  | [Q]| Filter...     | Success dialog   Needs review     < >   React Light v  Diff v |
  |  2 | * Success dlg +------------------------------+------------------------------+
  | [H]| * Open menu   |                              |                              |
  | [S]| o New item    |          Baseline            |          Current             |
  |  . |               |                              |                              |
  |    | > Accepted 1  +------------------------------+------------------------------+
  | @dh|               | Undo  All 7...                        Reject X   Approve A  |
  +----+---------------+-------------------------------------------------------------+
  ```

### R3 · Split inbox (three panes)

- What changes: The queue is not a page. It is the first column. Column 1 lists pull requests and main runs, grouped as "To review", "In progress", "Needs attention". Column 2 lists the items of the selected run. Column 3 is the viewer. Two start sidebars are a supported case (upstream "Chat app" scenario). Column 1 collapses with `[`.
- Why it is better: Moving from one pull request to the next needs no page change and no loading page. The run list is loaded one time and stays on screen, so "Checking access…" can show at most one time for each session. It fits the real job: clear an inbox.
- Sketch:

  ```text
  +------------------------------------------------------------------------------------+
  | (o) visonaut   ariakit/ariakit                               [?]   (!2)   @dh      |  40
  +------------------+----------------+------------------------------------------------+
  | TO REVIEW   2    | #4817 . 21/23  | Success dialog      React Light v    Diff v    |
  | > #4821 Combo 14 | Filter...      +-----------------------+------------------------+
  |   #4817 Dialog 3 | * Success dlg  |                       |                        |
  | IN PROGRESS 1    | * Open menu    |       Baseline        |       Current          |
  |   main  comparing| o New item     |                       |                        |
  | ATTENTION   1    | * Combobox     +-----------------------+------------------------+
  |   #4809 recapture| > Accepted 1   | Undo  All 7...            Reject X   Approve A |
  | History ->       |                |                                                |
  +------------------+----------------+------------------------------------------------+
  ```

### R4 · Command first, almost no chrome

- What changes: One 40 px bar with the mark and a wide command field: "Jump to a pull request, item, or variant". The field is a `Combobox` (upstream primitive) that opens with Cmd or Ctrl plus K. It searches runs, items, variants, and actions (approve all, open on GitHub, toggle diff). No sidebar by default. A thin status line at the bottom shows position, save state, and key hints as `Kbd`.
- Why it is better: The app already has a complete keyboard model (`review-workspace.tsx:395-442`). This model makes it the main path and gives the viewer the whole window. Search replaces three navigation levels.
- Sketch:

  ```text
  +------------------------------------------------------------------------------------+
  | (o)  [ Jump to...   #4817 / Success dialog / React Light             Cmd K ]  @dh  |  40
  +------------------------------------------+-----------------------------------------+
  |                                          |                                         |
  |                Baseline                  |                Current                  |
  |                                          |                                         |
  +------------------------------------------+-----------------------------------------+
  | 3/10 items . 2/7 variants . Saved      [A] approve  [X] reject  [D] diff  [?] keys |  28
  +------------------------------------------------------------------------------------+
           +----------------------------------------------+
           | > dialog                                     |
           |   Item     Success dialog         7 pending  |
           |   Item     Dialog with form       unchanged  |
           |   Run      #4817 Fix Dialog focus...         |
           |   Action   Approve all 7 changed variants    |
           +----------------------------------------------+
  ```

### R5 · Pull request hub

- What changes: The pull request becomes a page: `/pulls/4817`. It shows the title, a link to GitHub, a row of attempts (commit, time, state) with the latest one selected, and a grid of item thumbnails with status. A click on a thumbnail opens the focused review. The run UUID stays in the URL only as a detail.
- Why it is better: It matches the object that reviewers and GitHub use. It gives an overview before the first decision (how many items, which ones changed, which attempts exist), which the current flow does not have: today the workspace opens on the first variant at once. It gives the GitHub check link a real destination while the capture is pending.
- Sketch:

  ```text
  +------------------------------------------------------------------------------------+
  | (o) Queue / #4817 Fix Dialog focus restoration             Open on GitHub ^   @dh  |
  +------------------------------------------------------------------------------------+
  |  Attempts:  ( 9f8e7d6  attempt 2  now )   ( 41c0aa2  attempt 1  replaced )         |
  |  21 of 23 need review   [ Start review  Enter ]   [ Approve all unchanged ]        |
  |                                                                                    |
  |  CHANGED 9                                                                         |
  |  +----------+  +----------+  +----------+  +----------+  +----------+              |
  |  | (thumb)  |  | (thumb)  |  | (thumb)  |  | (thumb)  |  | (thumb)  |              |
  |  | Success  |  | Open     |  | Combobox |  | Menu     |  | Tooltip  |              |
  |  | 7 of 7   |  | 2 of 2   |  | 2 of 2   |  | 2 of 2   |  | 2 of 2   |              |
  |  +----------+  +----------+  +----------+  +----------+  +----------+              |
  |  NEW 1         REMOVED 1         ACCEPTED 1                                        |
  +------------------------------------------------------------------------------------+
  ```

### R6 · Focus mode with a filmstrip

- What changes: Inside a run, the global header goes away. A floating chip at the top left goes back. Items move from the start sidebar to a filmstrip of thumbnails along the bottom, above the action bar. Variants become a segmented control in a single toolbar with the view modes.
- Why it is better: Both screenshots get the full window width, which matters for 1280 px captures side by side. Thumbnails say more than names for visual review. Items left to right and variants in the toolbar match the arrow keys in a more natural way (left and right for items, up and down or number keys for variants).
- Sketch:

  ```text
  +------------------------------------------------------------------------------------+
  | < #4817   Success dialog  Needs review    [React/Solid/Dark/...]  [Cmp/Diff/New/Old] |  40
  +------------------------------------------+-----------------------------------------+
  |                                          |                                         |
  |                Baseline                  |                Current                  |
  |                                          |                                         |
  +------------------------------------------+-----------------------------------------+
  | [#1*] [#2*] [#3 ] [#4*] [#5*] [#6*] [#7*] [#8*] [#9*] [#10]          3 / 10    ... |  64
  | Undo                                                      Reject X      Approve A  |  44
  +------------------------------------------------------------------------------------+
  ```

### R7 · Inbox with tabs in the page

- What changes: The header loses its center navigation. It keeps the mark, the repository, a status dot, and the account. The page has one heading row with `Tabs` (the vendored `Tabs` component has no user today): "To review 2", "In progress 1", "Needs attention 1", "History". Runs are dense table rows, not cards. Service status is a popover from the dot and a full page at `/status`.
- Why it is better: The three current header items are not equal. The queue is the home, history is a filter of the same list, and status is an indicator. Tabs put the list states where the list is. A row is about 44 px, where a card is 240 px today, so ten runs fit where two fit now.
- Sketch:

  ```text
  +------------------------------------------------------------------------------------+
  | (o) visonaut  ariakit/ariakit                                   (.) all good  @dh  |  44
  +------------------------------------------------------------------------------------+
  |  [ To review 2 ]  In progress 1   Needs attention 1   History        Search...     |
  |  ----------------------------------------------------------------------------------|
  |  #4821  Add virtualized list example to Combobox     14 pending   a1b2c3d   2h   > |
  |  #4817  Fix Dialog focus restoration in nested...     3 pending   9f8e7d6   5h   > |
  |                                                       1 rejected                   |
  |  Baseline revision 128                                                             |
  +------------------------------------------------------------------------------------+
  ```

### C1 · Brand and repository chip

- What changes: The mark, then the repository as a small `Badge` or text link to GitHub, at each width (not only from 1280 px). No word mark, or a word mark only on the sign-in page.
- Why it is better: The repository is the one fact that tells preview from production and one deployment from another. Today it hides below 1280 px and shows two times above it.
- Sketch: `(o)  ariakit/ariakit ^` as `<Button $kind="flat" render={<a href={githubUrl} />}>`.

### C2 · Alerts as a status dot

- What changes: A dot with a label, in place of a bell with a bordered box. Green and no text when there are no alerts. Red with a count when there are alerts. The popover lists titles only, and each title links to `/status`.
- Why it is better: A bordered bell with no count asks for attention when nothing is wrong. One name ("Status") replaces five (SHELL-18).
- Sketch: `(.)` or `(!) 2 alerts`, as `<PopoverDisclosure $kind="flat"><Badge $layer="danger">2</Badge></PopoverDisclosure>`.

### C3 · Account button with identity

- What changes: An avatar or initials with the login. The popover is a short menu: "@diegohaz", "Open GitHub profile", "Sign out". No heading and no sentence.
- Why it is better: It answers "who am I signing as". It removes the text "Manage your GitHub session."
- Sketch:

  ```text
  [ DH  @diegohaz v ]
     +------------------+
     | @diegohaz        |
     | Sign out         |
     +------------------+
  ```

  The current CSP allows images from `'self'` and `data:` only (`index.headers.txt`), so a GitHub avatar needs a CSP change or a proxy. Initials need neither.

### C4 · Run context in a popover

- What changes: The pull request title in the bar is a `PopoverDisclosure`. The popover holds commit (link), attempt, baseline revision, run status, comparison history, and "Open on GitHub". The identity strip and the top of the details panel go away.
- Why it is better: These facts are read one time for each run, not one time for each variant. They do not need 26 px on each screen. It also removes the 10 px text.
- Sketch:

  ```text
  #4817 Fix Dialog focus restoration v
     +---------------------------------------+
     | Commit     9f8e7d6  ^                 |
     | Attempt    2 of 2                     |
     | Baseline   revision 4                 |
     | Status     Changes need review        |
     | Open pull request on GitHub ^         |
     +---------------------------------------+
  ```

### C5 · Skeletons in place of "Checking access…"

- What changes: The loading state is the final layout with placeholder frames: the real header, sidebar rows, the toolbar, and two empty viewer frames. Text shows only after 1 s ("Still loading…"). The words "Checking access" go away.
- Why it is better: The layout does not jump (SHELL-04). "Checking access" describes the server, not the user's goal, and it suggests a gate on each click.
- Sketch:

  ```text
  +----------------+-------------------------------------------------+
  | [=======    ]  | [==========]            [===] [===] [===]       |
  | [=====      ]  +------------------------+------------------------+
  | [========   ]  |                        |                        |
  | [======     ]  |        (frame)         |        (frame)         |
  +----------------+------------------------+------------------------+
  ```

### C6 · One gate page for sign-in, no access, not found, and error

- What changes: One centered `Frame` with an icon, a title, one sentence, and at most two actions. The header shows the mark only. The same component serves `/`, a run, a pull request, and unknown paths.
- Why it is better: It replaces three sign-in designs and four error designs (SHELL-14, SHELL-10). A guest does not see navigation that cannot work.
- Sketch:

  ```text
  +--------------------------------------------------+
  | (o) visonaut                                     |
  +--------------------------------------------------+
  |               +--------------------------+       |
  |               |  (lock)                  |       |
  |               |  Sign in to review #4817 |       |
  |               |  Use a GitHub account    |       |
  |               |  with write access.      |       |
  |               |  [ Sign in with GitHub ] |       |
  |               +--------------------------+       |
  +--------------------------------------------------+
  ```

  ```tsx
  <Gate icon={<Lock />} title="Sign in to review #4817" actions={<SignInButton />}>
    Use a GitHub account with write access to ariakit/ariakit.
  </Gate>
  ```

### C7 · Status line

- What changes: A 28 px band at the bottom of the workspace, or the start of the action bar: position ("Item 3 of 10, variant 2 of 7"), save state ("Saved", "Sending 2…"), and a `?` button that opens the shortcut list. Key hints use `Kbd`.
- Why it is better: Keyboard help becomes visible (SHELL-17). Save state gets a fixed place, where today it adds a second row to the action bar when it appears (`review-workspace.tsx:1099-1137`).
- Sketch: `3/10 . 2/7 . Saved                         [?] Shortcuts   [[] Sidebar`

### C8 · Progress that shows state, not only a count

- What changes: A segmented bar or ring with three parts: approved, rejected, pending. The number shows on hover or beside it. Use the upstream `Progress` primitive.
- Why it is better: "21 of 23 need review" with a 64 px gray bar says little. Segments show at a glance if a run has rejections.
- Sketch: `[####/xx/..........]  2 approved, 1 rejected, 20 pending`

### C9 · Titles and favicon that carry state

- What changes: Titles as in SHELL-07. One mark for the favicon and the header. Optional: a dot on the favicon when the queue has runs to review.
- Why it is better: The tab becomes useful when the app is in the background.
- Sketch: tab text `(2) Review queue · Visonaut`, then `#4817 Fix Dialog focus… · Visonaut`.

### C10 · Sidebar header that is a filter, not a title

- What changes: Remove the "SCREENSHOTS, 10 items" header row. The filter field is the first row, and its placeholder carries the count ("Filter 10 screenshots"). Status filters are three small toggle chips with counts.
- Why it is better: It removes a 48 px row that repeats what the list shows. Counts move to the place where they filter.
- Sketch:

  ```text
  | [ Filter 10 screenshots      ] |
  | (9 pending) (1 rejected) (1 ok)|
  | * Success dialog          7/7  |
  ```

## Measurements

All scripts and raw outputs are in the scratch directory. Each script uses Chrome through Playwright from the repository's `node_modules`.

| ID  | Command                                                                                     | Raw result                                                                                                                                                                                                                                                                                                                                                                                                            | Limits                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `curl -s -D … http://127.0.0.1:4310/{,runs/<id>,pulls/123,nope}` then `node html-stats.mjs` | `index.html` 27,700 B (5,498 gzip), 30 class attributes, 20,717 B of class text (74.8%), visible text `visonaut. Review queue Run history Service status Checking access and loading runs…`. `run.html` 27,608 B, text ends `Checking access and loading this run…`, route flag `ssr:!1`. `pull.html` 31,567 B. `nope.html` 2,322 B, HTTP 404, body `<p>Not Found</p>`. All titles `Visonaut`.                        | Dev server HTML. Class text share is a property of the recipes and compresses well.                                                                                                   |
| M2  | `node capture.mjs measure` (`navigation` in `measurements.json`)                            | See the table in SHELL-01 and the history counts in SHELL-09.                                                                                                                                                                                                                                                                                                                                                         | Dev `StrictMode` doubles effect fetches.                                                                                                                                              |
| M3  | `node pending.mjs`                                                                          | Title `Visonaut` for `/`, `/?view=history`, `/?view=service`, `/runs/<id>`, `/pulls/4817`, `/nope`. On `/pulls/4817` one `fetch /api/pulls/4817?check=` never reported as finished.                                                                                                                                                                                                                                   | The open request is the 403 answer whose body the page does not read (`pulls.$pullNumber.tsx:63-68`). It made `networkidle` time out in Playwright. Effect in production not checked. |
| M4  | `node capture.mjs measure` (`scroll`)                                                       | Viewport 1440 x 700, page scrollable by 223 px. `scrollY` 223 before, 0 after a variant link click, 0 after a keyboard arrow.                                                                                                                                                                                                                                                                                         | Real preview app.                                                                                                                                                                     |
| M5  | `node capture.mjs measure` (`requestOrder`)                                                 | `/`: runs 165 to 567 ms, operations starts 601 ms. `/?view=service`: runs 148 to 548 ms, operations starts 565 ms.                                                                                                                                                                                                                                                                                                    | Fixture with 400 ms delay on each API answer.                                                                                                                                         |
| M6  | `node measure3.mjs` (`documentLoadRun`)                                                     | document request 2 ms, response 16 ms, loading text 110 ms, API request 209 ms, API response 218 ms, workspace 470 ms.                                                                                                                                                                                                                                                                                                | Dev server, local machine. Use the order only.                                                                                                                                        |
| M7  | `node measure5.mjs`                                                                         | Queue scrollable by 292 px, `scrollY` 250 before leaving. After Back: 12 ms `Checking access and loading runs…` at `scrollY` 0; 884 ms ready at `scrollY` 0. Requests: `fetch /api/runs` x2.                                                                                                                                                                                                                          | Run list delayed by 800 ms to sample the state.                                                                                                                                       |
| M8  | `node measure3.mjs` (`clientNavigationQueueToRun`, `…Fast`)                                 | 3000 ms API delay: queue visible at 152, 501, 902 ms; pending text at 1301, 2001, 2801 ms; workspace at 3602 ms. 600 ms delay: only queue, then workspace.                                                                                                                                                                                                                                                            | Real preview app.                                                                                                                                                                     |
| M9  | `curl` of the two dev stylesheets, then `node css-stats.mjs`                                | Root: 883,047 B, 118,332 gzip, 2 copies. Root plus run: 1,625,503 B, 214,705 gzip, 4 copies.                                                                                                                                                                                                                                                                                                                          | Dev output, not minified. No production build was run.                                                                                                                                |
| M10 | `node capture.mjs measure` (`chrome 1440x900`, `chrome 390x844`)                            | See the table in SHELL-06. Footer top 954 px and 1584 px.                                                                                                                                                                                                                                                                                                                                                             | Fixture, ten items, 600 x 400 images.                                                                                                                                                 |
| M11 | `node capture.mjs measure` (`structure dashboard`, `structure run`)                         | Run page: links to `/`: 3. `skipLink: false`. `div[aria-label]` without role: the shell and the two viewer panes. Headings: one visible `h1` (the item name), no `h2`. Landmarks: `header`, `nav` Main navigation, `aside` Review navigation, `nav` Review items, `main`, `header`, `nav` Variants, `section` Selected variant, `region` Review actions, `aside` Capture details, `nav` Comparison history, `footer`. | The `tabStopsBeforeMain` number in this file counts links with `tabindex="-1"`; use M14.                                                                                              |
| M12 | `node measure2.mjs` (`scrollLocalSelection`, `scrollRoutedSelection`)                       | No router: 200 to 149. Router: 200 to 0.                                                                                                                                                                                                                                                                                                                                                                              | The 149 is the new maximum scroll of a shorter page.                                                                                                                                  |
| M13 | `node measure7.mjs`                                                                         | See the table in SHELL-11.                                                                                                                                                                                                                                                                                                                                                                                            | The 20 px root is set with an injected `html { font-size: 20px }` rule.                                                                                                               |
| M14 | `node measure2.mjs` (`tabOrder …`, `firstTabStopOutline`)                                   | See SHELL-12.                                                                                                                                                                                                                                                                                                                                                                                                         | Chrome only.                                                                                                                                                                          |
| M15 | `node measure2.mjs` (`contrast dark`, `contrast light`)                                     | See the table in SHELL-13.                                                                                                                                                                                                                                                                                                                                                                                            | Colors mixed in sRGB with the element opacity. The row "repository in header" in the JSON matched the brand word, so it is not used.                                                  |
| M16 | `node measure4.mjs`                                                                         | See the table in SHELL-16. Selected "Review queue" 131.8 px, not selected 130.0 px.                                                                                                                                                                                                                                                                                                                                   | Real preview app.                                                                                                                                                                     |
| M17 | `node measure2.mjs` (`headerLoadingVsReady`)                                                | Loading: 4 header controls, text `visonaut.Review queueRun historyService status`. Ready: 6 controls, plus `ariakit/ariakit` and `Account`.                                                                                                                                                                                                                                                                           | Fixture.                                                                                                                                                                              |
| M18 | `node measure6.mjs`                                                                         | Accepted toggle 16 px; item label 12 px; strip 96 to 122; details header 96 to 144; run loading text at (336, 60); queue loading text at x 160; run guest button 724 x 33; pull back button 592 x 33; pull page header controls: 4.                                                                                                                                                                                   | Fixture, 1440 x 900.                                                                                                                                                                  |
| M19 | `node measure2.mjs` (`headerTargets390`, `workspaceTargets390`)                             | See SHELL-21.                                                                                                                                                                                                                                                                                                                                                                                                         | Fixture, touch emulation.                                                                                                                                                             |

Text counts in this report come from `rg -N -o` on `apps/web/src/routes`, `apps/web/src/review`, and the shell components, without tests.

## Open questions and items not verified

Not verified:

- Production times. Both servers are Vite dev servers. I did not run a build, as the lane rules say. The number of script chunks and the real time to content on Cloudflare are not known.
- The production stylesheet. SHELL-05 is measured in dev only.
- Real GitHub sign-in and sign-out. The guest, 403, 404, and 503 states come from mocked API answers in the fixture.
- The "Details" button in the dead zone of SHELL-11. The code has the same two conditions as the item list, but I measured only the item list.
- The default error component for a render error on the queue and pull routes (SHELL-10). I did not trigger one.
- Safari and Firefox. All captures use Chrome. The header glider depends on CSS anchor positioning.
- Screen reader output. SHELL-12 is from DOM facts, not from a screen reader.
- External callers of `/api/me` and `/api/session`. The search covers this repository only.
- If the Shell body can own the scroll for R4 and R6.

Questions for the maintainer:

1. Is the pull request or the run the primary object in the URL and in the header (SHELL-08)?
2. Which run facts must stay on screen during review (SHELL-06)?
3. Can the document response and the run-list answer carry more data: run data in HTML, the alert count, the reviewer login (SHELL-02, SHELL-03, SHELL-15)?
4. What must Back do inside a run (SHELL-09)?
5. Which words are the standard for item, variant, and alerts (SHELL-18)?
6. Can the vendored Ariakit UI copy move to current upstream before the redesign (SHELL-19)?
7. Is review on a phone in scope (SHELL-21)?

Notes for other lanes (seen during this audit, outside this lane):

- Queue and history: `stateLabel` maps `reviewing` and `needs-review` to "Needs review" (`routes/index.tsx:132`), but `stateColor` gives the warning color only to `needs-review` (`:144`). Two runs with the same label have different badge colors (`mock-history-dark-1440.png`).
- Preview fixtures: `createdAt: 0` shows as "Dec 31, 1969, 9:00 PM" on the first page (`review/preview-fixtures.ts:86`, `queue-dark-1440.png`).
- Pull page: the 404 text says "Open the latest check on GitHub", but the state has no link, because the repository is not known in the error state (`routes/pulls.$pullNumber.tsx:70-72`, `216-223`).
- The worktree shows `M pnpm-lock.yaml` and `?? apps/lab/` in `git status`. These come from another task. This lane did not write in the repository.
