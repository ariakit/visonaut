# Second-lens check 8: FE-03, FE-07, FE-08, HYG-01

Lens: platform facts, real impact, and fix feasibility. Read-only. Source: commit `f83fef6`, worktree `serialized-dazzling-pixel`.

Skills loaded: `ariakit-general-workflow` (the remote is `github.com/ariakit/visonaut`; no Visonaut-specific workflow skill is installed).

Scripts and raw output: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-8/`.

## Read this first

| ID     | Verdict          | Severity (mine) | Severity (lane) | One sentence                                                                                                                                                                                                                                                   |
| ------ | ---------------- | --------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-03  | Partly confirmed | high            | high            | The problem and the numbers are correct. The recommended snippet has three defects that I measured: it drops the unsent-decision guard, it marks two header links as current, and it throws in the 71 browser tests that mount the workspace without a router. |
| FE-07  | Partly confirmed | medium          | high            | The counts are correct. The claim that the loop "feels slow" is not supported on fast hardware (32 ms and 64 ms input handling). Two of the proposed fixes do less than the report says.                                                                       |
| FE-08  | Confirmed        | high            | high            | I measured the gain that the lane did not measure: on the production build, with 300 ms image latency, a preload moves key-to-ready from 389 ms to 122 ms (approve) and from 370 ms to 57 ms (ArrowDown), with no duplicate request.                           |
| HYG-01 | Confirmed        | medium          | high            | The 403 is real, but it is not on a production path. Two of the proposed alternatives have a platform problem that the lane did not find.                                                                                                                      |

Notes on the inputs:

- `report.md` and `verification.md` do not exist in `audit/frontend-perf/` or `audit/hygiene/`. I used `audit/frontend-perf/verify/recovered-report.md`, `audit/hygiene/verify/recovered-report.md`, and the raw files of the first verifier in the two `verify/` directories.
- Signed-in production timings come from the orchestrator's file `audit/live-authenticated.md`. I did not measure production.

### How these paths reach production

- `.github/workflows/deploy.yml:76` builds with `CLOUDFLARE_ENV: production`, and `:133` runs `wrangler deploy --config apps/web/dist/server/wrangler.json`. The client bundle is the same code as the local build (the lane found the same hashed file names on `https://visonaut.com/`).
- `apps/web/wrangler.jsonc:51` sets `"VISONAUT_ENVIRONMENT": "production"`. So `apps/web/src/server.ts:73` (`if (env.VISONAUT_ENVIRONMENT === "preview")`) is false in production, and a page request goes to `server.ts:118` (`return await render(request);`).

### Installed versions (from `apps/web/package.json` and `node_modules/.pnpm`)

| Package                                                                        | Version                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `@tanstack/react-router`                                                       | 1.170.38 (`@tanstack/router-core` 1.171.32, `@tanstack/history` 1.162.4) |
| `@tanstack/react-start`                                                        | 1.168.57                                                                 |
| `react`, `react-dom`                                                           | 19.3.0                                                                   |
| `@vitejs/plugin-react`                                                         | 6.1.1                                                                    |
| `@cloudflare/vite-plugin`                                                      | 1.57.1                                                                   |
| `wrangler`                                                                     | 4.136.1                                                                  |
| `better-auth`                                                                  | 1.7.5                                                                    |
| `oxc-transform-react`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler` | not installed                                                            |

---

## FE-03 · Header links and the `Queue` button are plain anchors

Verdict: **partly confirmed**. Severity: **high** for the three header tabs on the dashboard, **medium** for the `Queue` button and the header on the run page. Confidence: high for the problem, high for the three fix defects (each one measured).

### 1. Hot path

Verified facts:

- `apps/web/src/components/app-shell.tsx:15-19` and `:53-58`: `href: "/"`, `href: "/?view=history"`, `href: "/?view=service"`, rendered by `<NavLink key={id} href={href} ...>`. `:29`: `render={<a href="/" />}`.
- `apps/web/src/review/review-workspace.tsx:580`: `<Button $p={1} render={<a href="/" />}>`.
- `AppHeader` is on all three routes: `routes/index.tsx:249`, `routes/runs.$runId.tsx:58`, `routes/pulls.$pullNumber.tsx:152`, and inside the workspace at `review-workspace.tsx:535`.
- The three views are one route. `routes/index.tsx:40-42` reads `view` from the search. The data is in component state (`:161`), so a search-only navigation keeps it.

Sequence of one header click in production:

1. Document request. The Worker runs (`server.ts:118`). It does no access check. It renders the shell with the loading text.
2. One stylesheet and 8 or 9 scripts are revalidated. Cloudflare's default for static assets is `Cache-Control: public, max-age=0, must-revalidate` (https://developers.cloudflare.com/workers/static-assets/headers/). These requests do not start the Worker and are free ("Requests to static assets are free and unlimited", https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
3. React hydrates, then `fetch("/api/runs")` (`routes/index.tsx:180`). This is the access check: `api/index.ts:130` (`createAuth`), `:191` (`createGitHubClient`), `:194` (`requireMaintainer`). The auth lane counted 6 sequential D1 round trips for this request.
4. `OperationsAttention` mounts and requests `/api/operations` (`components/operations-attention/index.tsx:233`). The auth lane counted 9 D1 round trips.

Frequency: once for each click on a header link, the brand link, or `Queue`.

### 2. Magnitude

Measured by the lane and repeated by the first verifier on the local build (`frontend-perf/verify/nav-local.txt`):

```text
== Queue -> header 'Run history'
   done after 116 ms; document requests: 1; total requests: 12
== Queue -> 'View history' (router Link)
   done after 41 ms; document requests: 0; total requests: 1     (the 1 is /favicon.svg)
== Run -> 'Queue' button
   done after 72 ms; document requests: 1; total requests: 12
```

Production, signed in (orchestrator, `audit/live-authenticated.md`, 5 warm samples):

| Step of one header click          | Time from navigation start          |
| --------------------------------- | ----------------------------------- |
| Document first byte               | 41 to 119 ms (292 ms in one sample) |
| `/api/runs` request starts        | 240 to 595 ms                       |
| `/api/runs` server wait           | 865 to 1,967 ms                     |
| Content visible (`/api/runs` end) | 1,220 to 2,290 ms                   |
| `/api/operations` end             | 2,638 to 3,663 ms                   |

What a router link removes (derived from the two tables, not measured after a change):

- Queue ↔ history: the full chain. About 1.2 to 2.3 s of loading text for each click becomes a render with no request.
- To the service view: the document, the assets, and `/api/runs`. The new `OperationsAttention layout="page"` instance still requests `/api/operations` (1.2 to 1.3 s server wait).
- `Queue` button and header links on the run page: only the part before `/api/runs` starts, 240 to 595 ms. The dashboard mounts again and requests `/api/runs` (0.9 to 2.0 s). This is why I give this part a lower severity.

Uncertainty: one location, one day, 5 samples, background tab. The order of magnitude is clear. The exact gain is not.

### 3. Fix feasibility

The API exists and the pattern is already in the code: `NavLink ... render={<Link ... />}` at `review/item-list.tsx:197-215` and `review/review-workspace.tsx:733-760`, and `<Button render={<Link to="/" search={{}} />}>` at `routes/pulls.$pullNumber.tsx:155`. TanStack documents the same options (https://tanstack.com/router/latest/docs/framework/react/guide/navigation).

The report says "Maintainer decision needed: no". I do not agree. The snippet as written has three defects.

**Defect 1: a client navigation drops the guard for unsent decisions (measured).**

- `review/use-review-session.ts:175-184` adds a `beforeunload` handler while a decision is being sent and is not yet admitted by the server.
- `review/use-review-session.ts:165-174`: on unmount, `for (const entry of session.queue) { entry.controller?.abort(); }`.
- A plain anchor starts a document navigation, so the guard runs. A router `Link` calls `router.navigate` (`@tanstack/react-router/dist/esm/link.js:139-152`). No `beforeunload` event occurs, the session unmounts, and the command request is aborted.

Measurement (`node guard-experiment.mjs`, route fixture on port 4311, the command POST is held open, raw output in `guard-experiment.txt`):

```text
== A. current code: click the plain-anchor Queue button
  "saveStateBeforeLeaving": "Sending 1 decision…",
  "dialogs": [ { "type": "beforeunload" } ],
  "apiRequestsFailed": [],
  "pageAfter": { "workspace": true, "status": "Sending 1 decision… " }

== B. proposed router Link, simulated: router.navigate({ to: '/' })
  "dialogs": [],
  "apiRequestsFailed": [ { "path": "/api/comparisons/comparison-2/commands", "method": "POST", "error": "net::ERR_ABORTED" } ],
  "pageAfter": { "workspace": false, "heading": "Your review queue." }
```

Scenario B calls `router.navigate({ to: "/" })` on the fixture's router, because I cannot edit the code. That is the call a `Link` makes.

Contract: `docs/current-contract.md:196` says "Unsent decisions still require the browser." and "The UI must preserve multiple rapid decisions, pending overlays, newer route-model handling, Retry, Undo, focus, and navigation." Line 53 (D08/D09) lists "navigation" in the behavior to preserve. A likely user flow reaches this window: approve the last variant, then click `Queue`.

What happens to the aborted request on the server is not certain. Cloudflare says "When the client disconnects or the response is complete, tasks associated with that request may be canceled" (https://developers.cloudflare.com/workers/platform/limits/). So the decision can be lost with no message.

The matching API exists: `useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver })` (`@tanstack/react-router/dist/esm/useBlocker.d.ts:34-44`; https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking). It needs a router, so it must be in `routes/runs.$runId.tsx`, and `useReviewSession` must report the "unsent" state (today the condition is private, lines 176-178).

**Defect 2: two header links are "current" on the history and service views (measured).**

- `link.js:38-40`: search matching is on by default and is partial (`deepEqual(location.search, next.search, !activeOptions?.exact, ...)`). `link.js:221-224`: an active link always gets `props["aria-current"] = "page"`.
- `<Link to="/" search={{}}>` is a partial match of `/?view=history`.
- The vendored styles select on `[aria-current]:not([aria-current="false"])` (`components/ariakit/styles/ui.css:1178-1284`), so the nav shows two selected links.

Measurement (`node link-active.mjs`, same search validator as `routes/index.tsx:40-42`, output in `link-active.txt`):

```text
location /?view=history
  default activeOptions        queue: aria-current="page"   history: aria-current="page"   service: null
  activeOptions {exact: true}  queue: null                  history: aria-current="page"   service: null
```

The same matching rule applies to a brand link written as `<Link to="/" />`: it is a partial match of each dashboard view. I did not measure the brand link.

**Defect 3: `Link` throws without a `RouterProvider` (measured).**

```text
$ node link-without-router.mjs
@tanstack/react-router 1.170.38
threw: TypeError Cannot read properties of null (reading 'protocolAllowlist')
warnings: [ 'Warning: useRouter must be used inside a <RouterProvider> component!' ]
```

`AppHeader` and the `Queue` button are inside `ReviewWorkspace`. `src/review/__tests__/fixture.tsx:154` and `tooling/review-scale/fixture.jsx:75` mount `ReviewWorkspace` with no router. `review.browser.test.ts` (62 tests) and `scale.browser.test.ts` (9 tests) open that fixture (`page.goto("/src/review/__tests__/index.html")`). The existing code already guards for this: `review-workspace.tsx:749` uses `route ? (<Link ... />) : undefined`.

**A scope that avoids all three (sketch, not run):**

```tsx
// src/components/app-shell.tsx: the caller selects the link type.
<NavLink
  key={id}
  aria-label={label}
  aria-current={active === id ? "page" : undefined}
  render={
    router ? (
      // exact: without it the Queue link is also current on ?view=history.
      <Link to="/" search={view ? { view } : {}} activeOptions={{ exact: true }} />
    ) : (
      <a href={href} />
    )
  }
>
```

```tsx
// src/routes/index.tsx: only the dashboard uses router links.
<AppHeader router active={...} />
```

This gives the large gain (the tabs on `/`) and does not change the run page. Router links on the run page need a blocker first:

```tsx
// src/routes/runs.$runId.tsx (sketch, not run). `unsent` must come from useReviewSession.
useBlocker({
  shouldBlockFn: () => unsent && !window.confirm("A decision is still being sent. Leave this run?"),
  enableBeforeUnload: () => unsent,
});
```

Other effects of the change:

- Security contract: no server change. Each data request keeps its access check. The run list stays on screen across tab changes with no new `/api/runs` request. `OperationsAttention` still requests `/api/operations` each 60 s and calls `onAccessDenied` on 401 or 403 (`operations-attention/index.tsx:239-241`, `:280`), so a revoked session changes the screen in 60 s or less. `docs/current-contract.md:186` already permits 60 s for read permission.
- Data freshness: today each tab click is also a refresh of the run list. After the change only `Refresh runs` or a remount loads new runs.
- The two "comparison history" anchors (`review-workspace.tsx:474-478`) are also plain anchors. They are not in the report. A document navigation is correct there for the same guard reason until a blocker exists.

### 4. Strongest counter-argument

Most of the wait for each click is `/api/runs` (0.9 to 2.0 s), not the reload. FE-01 and the auth-lane fixes reduce that for every load, also for the first one. When the API answers in about 200 ms, a full reload costs about 0.5 s, and a tab change is rare in a tool where the work is inside one run page. The header is also one commit old (`git log -- apps/web/src/components/app-shell.tsx` shows only `f83fef6`), and the UI pass can replace it. A small change that is done wrong here can lose a review decision, which is worse than a slow tab.

---

## FE-07 · Each review action re-renders the whole workspace several times

Verdict: **partly confirmed**. Severity: **medium** (lane: high). Confidence: high for the counts, medium for the real impact.

### 1. Hot path

- `review-workspace.tsx:443-448` registers one `keydown` listener on the document. `:416-429` maps keys to `selectItem`, `selectVariant`, and `review`.
- In production the workspace always has a `route`. A selection is a router navigation: `routes/runs.$runId.tsx:118-132` (`void navigate({ ..., replace: true })`).
- The path is client code only. The production bundle is the same as the measured build.
- Frequency: each key press in the review loop. A run in production has 626 items and 3,832 variants (`audit/live-authenticated.md`), so a review is tens to hundreds of key presses.

### 2. Magnitude

Lane numbers, repeated by the first verifier (`frontend-perf/verify/interaction-1000x6.txt`, production build, 1,000 items × 6 variants, Apple M4 Pro):

| Action                 |  Commits | Component renders | `keydown` duration, 1x CPU | `keydown` duration, 4x CPU |
| ---------------------- | -------: | ----------------: | -------------------------: | -------------------------: |
| ArrowDown              |        7 |             3,442 |                      32 ms |              120 to 128 ms |
| `A` (approve and next) | 10 to 12 |    6,106 to 7,106 |                64 to 80 ms |              256 to 264 ms |

How to read them:

- INP is "good" at 200 ms or less and "needs improvement" from 200 to 500 ms (https://web.dev/articles/inp). At 1x both actions are far below 200 ms. At 4x, approve is in the "needs improvement" band. No value is in the "poor" band.
- The users are a small number of maintainers. Their hardware is not known. An M4 Pro at 4x is a slow laptop, not a typical one.
- In the same loop the image wait is larger: at least about 150 ms for each image in production (the review-load lane measured 151 to 157 ms for the D1 lookup alone on the `/images/<unknown id>` path), and I measured 389 ms against 122 ms for one step with 300 ms image latency (FE-08). The model load is 5.3 to 5.7 s.

So the report's impact sentence ("The main review loop feels slow") is supported only for a machine that is about four times slower than the test machine. The wasted work is real. Its user-visible cost on fast hardware is small.

### 3. Fix feasibility

**The two "identity fixes".** They are safe, but the description needs two corrections.

- `review/use-review-session.ts:133-136` already memoizes the model on `[savedModel, pendingReviews]`. An ArrowDown does not change either value, so `applyPendingReviews` does not run for it. The identity fix helps the approve path only.
- `applySavedReview` has the same full rebuild and is not in the report: `review/navigation.ts:116-118`, `const items = model.items.map((item) => ({ ...item, variants: item.variants.map((variant) => {`. It runs for each confirmed save. Each item gets a new identity again.
- The `updateOrder` content check is correct and is the part that removes one full render for each model change (`item-list.tsx:102-104` with `review-workspace.tsx:453`). The gain is not measured.

**`memo`.** React says `memo` "is completely useless if the props passed to your component are always different" (https://react.dev/reference/react/memo). These props are new on each render today:

- `route`: `routes/runs.$runId.tsx:133-138` (a new object).
- `selectItem` and `variantKeyForItem`: `review-workspace.tsx:355-368` and `:457` (new functions).
- `headerEnd`: `routes/runs.$runId.tsx:206-213` (new JSX).
- Rows are not components. `item-list.tsx:178-278` is an inline `renderItem` function, and `item-list.tsx:94-97` builds new entry objects (`{ ...entry, position }`).

So the `memo` step needs these changes first. The lane's effort "L" is correct. The behavior that D08 and D09 protect (`docs/current-contract.md:53`) is in the same files.

**React Compiler.** The option exists: `@vitejs/plugin-react` 6.1.1 README lines 85-99 (`react({ compiler: true })`, "Native React Compiler support is experimental") and lines 115-136 (`reactCompilerPreset` with `@rolldown/plugin-babel`). None of the needed packages is installed. I ran `babel-plugin-react-compiler` 1.0.0 from my scratch directory over the app's components (`compiler/probe.mjs`, output in `compiler/probe.txt`):

```text
review/review-workspace.tsx   compiled (3): ShortcutHelp, ReviewWorkspace, ReviewSession
review/item-list.tsx          compiled (1): ItemList
components/screenshot-viewer.tsx  compiled (1): ScreenshotViewer
  CompileError (function at line 23, ...): Support value blocks ... within a try/catch statement
review/use-evidence.ts
  CompileError (function at line 40, error at line 83): Handle ??= operators in AssignmentExpression
review/use-review-session.ts
  CompileError (function at line 113, error at line 205): Handle TryStatement with a finalizer ('finally') clause
total: 21 functions compiled
```

- 21 functions compile, and these include `ReviewSession`, `ItemList`, `ScreenshotViewer`, `AppHeader`, and `Run`.
- 7 functions do not compile: `useEvidence`, `useReviewSession`, `ImagePane`, `RunPage`, `Index`, the pull request page, and `OperationsAttention`. The causes are compiler limits (`??=`, `try`/`finally`, `throw` in `try`), not rule violations.
- `useReviewSession` returns new functions on each render (`save`, `review`, `undo`). While it does not compile, the compiled callers still get changed inputs.
- Limits: this is the Babel compiler with default options, outside the Vite build. It shows what compiles. It does not show the gain or the effect on the browser suite (98 top-level `test(` calls in 5 files).

**The alternative "write the URL with `history.replaceState`".** It does not work as written. `@tanstack/history@1.162.4/dist/esm/index.js:338-340` replaces `window.history.replaceState` and calls `onPushPop("REPLACE")`, which notifies the router. `Route.useSearch()` then renders `Run` again. The router commits stay.

Security contract: no effect. This is client rendering only.

### 4. Strongest counter-argument

On the hardware that was measured, input handling is 32 ms and 64 to 80 ms, and no long task is over 100 ms. No complaint from the maintainer is about key latency. The fix that helps most (`memo` boundaries or the compiler) changes the files that hold the save queue, Undo, focus, and selection, which the contract protects and 62 browser tests cover. FE-08 removes more wait for each step with less risk, and the two small identity fixes are available without the larger refactor. No measurement on a real slow machine exists that shows a need for the larger refactor.

---

## FE-08 · The next screenshot is not preloaded

Verdict: **confirmed**. Severity: **high**. Confidence: high for the mechanism and the gain on the build, medium for the size of the gain in production (the real image latency is not measured).

### 1. Hot path

- `components/screenshot-viewer.tsx:146-149`: `<img key={identity} src={image.url} ...>` is the only request for a full image. It mounts after the selection changes.
- The reviewer cannot decide before the images decode. `review-workspace.tsx:302-307`: `const ready = ... && evidence.status === "ready";`. `:385-386`: `const review = (...) => { if (!ready) return;`. An approve or reject key press during the wait is dropped. It is not queued.
- Production path of each image: `server.ts:106-112` → `api/index.ts:113-115` (`publicImage`, before any session work) → `api/images.ts:24-28` (1 D1 read) → `:39-40` (1 R2 `get`) → `:52` `"Cache-Control": "public, max-age=31536000, immutable"`.
- The response is not cached at the edge. "Cloudflare Workers run before the cache" and the Cache API "is local to a data center" (https://developers.cloudflare.com/workers/reference/how-the-cache-works/). The code does not use the Cache API. So the first view of each image in a browser always costs one Worker request, one D1 round trip, and one R2 read.
- D1 is in one location by default: "D1 routes all queries (both read and write) to a specific database instance in one location in the world" and "Users located further away from the primary database instance experience longer request latency" (https://developers.cloudflare.com/d1/best-practices/read-replication/). No code calls `withSession`.
- Frequency: each step to a variant that this browser has not shown. In a first review pass, each candidate image is new by definition. A changed variant needs 2 images.

### 2. Magnitude

Production: the real first-view time of an image is **not measured** (the orchestrator's sample was a browser cache hit). The lower bound is the review-load lane's measurement of the D1 lookup alone: 151 to 157 ms for `/images/<unknown id>`. A real image adds the R2 read and the transfer.

Build, with emulated latency. I repeated the lane's baseline and added the preload case that the lane lists as "not measured". Method (`node preload-build.mjs 300`, output in `preload-build-300.txt`):

- Miniflare serves `apps/web/dist` (the lane's build). A Node front server answers `/api/*` and `/images/*`. Each full image waits 300 ms and has the production cache header. The PNG is 249,024 bytes (the lane's synthetic 1280 × 800 file).
- No Playwright request interception, because interception turns the browser HTTP cache off.
- "Preload" runs: when evidence is ready, the page runs `new Image().src = url` for the reference and the candidate of the next target. Then it waits (reviewer think time) and presses the key.

| Run (8 steps each, median) | Think time | Key press to ready evidence | Full-image requests | Images requested twice |
| -------------------------- | ---------: | --------------------------: | ------------------: | ---------------------: |
| `A`, baseline              |   1,000 ms |                      389 ms |                  18 |                      0 |
| `A`, preload               |   1,000 ms |                  **122 ms** |                  18 |                      0 |
| `A`, preload               |     100 ms |                      227 ms |                  18 |                      0 |
| ArrowDown, baseline        |   1,000 ms |                      370 ms |                  18 |                      0 |
| ArrowDown, preload         |   1,000 ms |                   **57 ms** |                  18 |                      0 |
| ArrowDown, preload         |     100 ms |                      227 ms |                  18 |                      0 |

Facts from this table:

- The baselines agree with the lane (393 ms and 355 ms).
- With a preload, the step time is the CPU floor (the lane measured 126 ms and 63 ms with no image delay). The full image latency is removed.
- With a think time shorter than the latency, the `<img>` joins the request that is in flight. The gain is the think time.
- The page CSP was active (`img-src 'self' data:`, read from the document response). No console error occurred. Each image was requested one time, so the `<img>` used the preloaded response.

Limits: emulated latency, one synthetic image size, Chrome 154, local machine. An earlier try on the dev fixture (`preload-experiment-300.txt`) is not usable: development React takes about 400 ms for each approve, which hides the image time.

Cost of the fix in production: a preload moves two requests to an earlier time. It adds requests only when the reviewer does not go to the predicted target, at most 2 for each selection. Prices: Workers $0.30 for each million requests after 10 million (https://developers.cloudflare.com/workers/platform/pricing/); D1 $0.001 for each million rows read after 25 billion (same page); R2 Class B (`GetObject`) $0.36 for each million after 10 million, and egress is free (https://developers.cloudflare.com/r2/pricing/). The cost is not a factor.

### 3. Fix feasibility

- `new Image()` and the cache header are web platform features. `immutable` "indicates that the response will not be updated while it's fresh" (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control). The measurement above shows the reuse in Chrome under the production CSP (`packages/security/src/http.ts:43`).
- The image response is not wrapped by `securePrivateResponse` (`api/index.ts:113-115` returns it directly), so the cache header is not replaced by `no-store`.
- Security contract: none of it changes. Images are public by decision D16 (`docs/current-contract.md:59`: "A URL is not authorization"). The approve gate stays, because the real `<img>` must still load and decode before `evidence.status` is `ready` (`use-evidence.ts:104-114`, `screenshot-viewer.tsx:49-63`).
- Decision P02 (`docs/current-contract.md:149`, "Load diff when selected"): the main recommendation loads only the reference and the candidate, so it agrees with P02. The lane's "minimal" alternative (preload the diff image) reverses P02 in part and needs a maintainer decision.

Two defects in the lane's sketch (from the code, not measured):

1. `useMemo(() => nextPending(model.items, selection), [model.items, selection])` does not memoize. `selection` is a new object on each render (`review-workspace.tsx:286-290`). `nextPending` builds one object for each variant (`navigation.ts:145-151`), which is 3,832 objects for each render in production. Use the two keys as dependencies.
2. The effect depends on `model.items` and the cleanup sets `element.src = ""`. `model.items` gets a new identity for each pending overlay and each confirmed save (`navigation.ts:64-73`, `:116-130`). So a save confirmation cancels a preload that is in flight and starts it again. Make the effect depend on the two URL strings:

```tsx
// src/review/review-workspace.tsx (sketch, not run)
const upcoming = useMemo(
  () => nextPending(model.items, { itemKey: selection.itemKey, variantKey: selection.variantKey }),
  [model.items, selection.itemKey, selection.variantKey],
);
const upcomingVariant = model.items
  .find((entry) => entry.key === upcoming?.itemKey)
  ?.variants.find((entry) => entry.key === upcoming?.variantKey);
const referenceUrl = upcomingVariant?.reference?.url;
const candidateUrl = upcomingVariant?.candidate?.url;
const evidenceReady = evidence.status === "ready";
useEffect(() => {
  if (!evidenceReady) return;
  // Keep the elements alive until the target changes. Do not cancel on a model update.
  const preloads = [referenceUrl, candidateUrl].flatMap((url) => {
    if (!url) return [];
    const element = new Image();
    element.decoding = "async";
    element.src = url;
    return [element];
  });
  return () => {
    for (const element of preloads) element.src = "";
  };
}, [evidenceReady, referenceUrl, candidateUrl]);
```

What can go wrong:

- The effect above still cancels when `evidenceReady` becomes false, which is the moment the reviewer moves to the target. In my measurement the real `<img>` joined the request in flight (227 ms with a 100 ms think time), but my simulation did not clear `src`. Test this case before you keep the cleanup.
- The preload predicts the `Approve & next` target. ArrowDown goes to the next item in list order, which can be a different variant. The table shows the gain for each key when the prediction is correct.
- Full-page screenshots can be much larger than the 249 kB test file. A wrong prediction then costs bandwidth for the reviewer.
- Safari and Firefox were not measured.

### 4. Strongest counter-argument

The production image latency is not measured. If a first view takes about 100 ms, the gain for each step is small, and the code adds a second image-loading path to the review screen. A different fix helps every image, also the ones that are not predicted: remove the D1 lookup for each image (the review-load lane's REVIEW-08, about 150 ms of each first view). One Workers trace of a real `/images/<id>` request (tracing is on, `apps/web/wrangler.jsonc:15-20`) gives the missing number before a decision.

---

## HYG-01 · `pnpm dev` returns HTTP 403 for every page

Verdict: **confirmed**. Severity: **medium** (lane: high). Confidence: high.

### 1. Hot path

- This is not a production path. `apps/web/wrangler.jsonc:51` sets `VISONAUT_ENVIRONMENT` to `production` for `env.production`, so `server.ts:73-76` does not run there.
- The check runs in two places:
  - Local `vite dev` and `vite preview`. The Vite plugin uses the top-level configuration when `CLOUDFLARE_ENV` is not set ("Running `vite dev` or `vite build` without providing `CLOUDFLARE_ENV` will use the default top-level Cloudflare environment", https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/). That configuration is the preview (`wrangler.jsonc:22-25`).
  - The deployed `visonaut-preview` Worker, where it closes the `workers.dev` host. `/health` is before the check (`server.ts:60-71`).
- Frequency: each request of each local session until the developer adds a private override.

### 2. Magnitude

Repeated on the running dev server (it has the orchestrator's `apps/web/.dev.vars` with `VISONAUT_ORIGIN=http://127.0.0.1:4310`):

```text
Host 127.0.0.1:4310        -> 200 (27700 bytes)
Host localhost:4310        -> 403 (0 bytes)
Host 127.0.0.1:5173        -> 403 (0 bytes)
Host preview.visonaut.com  -> 403 (158 bytes)
/health Host localhost:4310 -> 200
```

One correction to the lane's evidence: the `preview.visonaut.com` result is not from `server.ts`. The body is `Blocked request. This host ("preview.visonaut.com") is not allowed.` That is Vite's `server.allowedHosts` check. The other probes are valid.

The cost is developer time: a blank page with no message on the first run of the documented command (`README.md:55`). The workaround is one line in a git-ignored file. No user of the service is affected. This is why I lower the severity.

### 3. Fix feasibility

**Recommended fix (accept loopback hosts in preview mode).** It works for `vite dev` and `vite preview`, and needs no private file.

- Security contract: the preview is public by design. `docs/current-contract.md:188`: "The public preview serves synthetic read-only fixtures and inline SVG images. Its source configuration has no D1, R2, comparator service, or queue bindings." `wrangler.jsonc:31-37` confirms the empty bindings. The check protects no data. It keeps the demo on one host.
- Assumption, not verified: a request cannot reach the deployed Worker with a loopback host name, because Cloudflare routes by the host of the route (`preview.visonaut.com` or `workers.dev`). If the assumption is wrong, the result is only that public fixtures show on one more host.
- What can go wrong: the helper must not be used in the production branches (`server.ts:83`, `:89`, `api/index.ts:110`). There the origin check is part of the cookie security. `packages/security/src/http.ts:5-8` already limits a loopback origin to `environment === "local"`. Keep the new rule inside the `preview` branch and add the two tests that the lane proposes (`server.test.ts` has no preview test today).

**Alternative 1 and 3 (a `.dev.vars` line).** They work for `pnpm dev` and fail for `vite preview`. The lane did not find this.

- `apps/web/wrangler.jsonc:124`: `"secrets": { "required": [] }`.
- Cloudflare: "When defined, only the keys listed in `secrets.required` are loaded from `.dev.vars` or `.env`. Additional keys are excluded" (https://developers.cloudflare.com/workers/configuration/secrets/).
- Installed Wrangler (`wrangler-dist/cli.js:181169-181176`): `if (key in result || requiredSecrets.includes(key))`. A key loads when it is also in `vars`. The dev path passes `config.vars`. The preview path passes an empty object (`@cloudflare/vite-plugin/dist/index.mjs:76068`: `unstable_getVarsForDev(config.configPath, void 0, {}, cloudflareEnv, false, config.secrets)`).

Measurement (`node dev-vars-check.mjs`, output in `dev-vars-check.txt`):

```text
wrangler 4.136.1
config.secrets {"required":[]}
dev shape (vars = config.vars, secrets = config.secrets):     VISONAUT_ORIGIN = http://127.0.0.1:4310
preview shape (vars = {}, secrets = config.secrets):          {}
preview shape if `secrets` were not declared (vars = {}):     VISONAUT_ORIGIN = http://127.0.0.1:4310
```

So:

- The override works in `vite dev` only because the key is also in `vars`. The documentation does not promise this. A Wrangler update can remove it.
- The override is not copied for `vite preview` (`apps/web/package.json:9`). That command stays at 403. `apps/web/dist/server/` has no `.dev.vars` file, which agrees.
- `VISONAUT_ORIGIN` cannot be added to `secrets.required`, because the name is also a `vars` key. The configuration check puts `vars` and `secrets.required` in one name table and reports a name in two groups as an error (`index.mjs:42062`, `:43946-43972`: `` `${bindingName} assigned to ${...} bindings.` ``). I read this in the code. I did not run it.
- Cloudflare also says "The `.dev.vars` and `.env` files should not be committed to git" (same page). An example file needs the `.gitignore` exception that the lane names (`git check-ignore` confirms that `.dev.vars.example` is ignored today).
- `localhost` and `127.0.0.1` are different origins, so the port and the host must both be fixed (`--port 5173 --strictPort`).

**Alternative 2 (remove the check and set `workers_dev: false`).** The key exists ("Enables use of `*.workers.dev` subdomain to deploy your Worker", https://developers.cloudflare.com/workers/wrangler/configuration/). But the deploy workflow requires the current value: `.github/workflows/deploy.yml:360`, `assert.equal(configuration.workers_dev, true);`. This alternative must change that guard too. The reason for the explicit `true` is not in the documents that I read.

**One more option that the lane does not list: a committed local environment.** `CLOUDFLARE_ENV=local vite dev` with an `env.local` block in `wrangler.jsonc` that sets `VISONAUT_ORIGIN` to the pinned local origin. `vars` is not inherited by an environment (https://developers.cloudflare.com/workers/wrangler/configuration/), so the block must repeat the eight preview variables. It works for dev and for build plus preview (the environment is fixed at build time), and it needs no private file and no code change. The lane's HYG-02 proposes a similar block for a seeded real backend.

### 4. Strongest counter-argument

The working UI loop of this repository is the browser-test fixture server, not `pnpm dev`. `pnpm dev` shows one synthetic run with 1 item and 2 variants (`review/preview-fixtures.ts`), so it has little value for UI work also when it works. The maintainers' own records use `wrangler dev ... --var VISONAUT_ORIGIN:...`. The repository has one or two human contributors. A relaxed origin rule is one more branch in a file that is reviewed for security. A corrected `README.md:55` sentence removes the false promise with no code change.

---

## Items that the lanes missed

1. FE-03: a router link on the run page removes the `beforeunload` guard for unsent decisions and aborts the command request (measured; contract line 196).
2. FE-03: the snippet marks the Queue link as current on the history and service views; `activeOptions={{ exact: true }}` corrects it (measured).
3. FE-03: `Link` throws without a router; 71 browser tests and the review-scale fixture mount the workspace without one (measured).
4. FE-07: `applySavedReview` rebuilds each item too (`navigation.ts:116-130`); the `history.replaceState` alternative still notifies the router (`@tanstack/history` `index.js:338-340`).
5. FE-07: React Compiler 1.0.0 compiles the main components but not `useReviewSession` and `useEvidence` (probe output).
6. FE-08: the sketch's `useMemo` does not memoize, and its cleanup restarts a preload on each model update.
7. HYG-01: a `.dev.vars` override does not reach `vite preview` while `secrets.required` is declared, and it works in `vite dev` only through undocumented behavior (measured).
8. HYG-01: `workers_dev: false` conflicts with the guard at `deploy.yml:360`. The `preview.visonaut.com` probe result comes from Vite, not from the Worker.

## Evidence files

All in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-8/`:

| File                                                                               | Content                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `guard-experiment.mjs`, `.txt`                                                     | FE-03: anchor against client navigation while a decision is being sent         |
| `link-active.mjs`, `.txt`                                                          | FE-03: `aria-current` for each header link and view                            |
| `link-without-router.mjs`, `.txt`                                                  | FE-03: `Link` without a `RouterProvider`                                       |
| `compiler/probe.mjs`, `compiler/probe.txt`                                         | FE-07: React Compiler probe (packages installed in the scratch directory only) |
| `preload-build.mjs`, `preload-build-300.txt`                                       | FE-08: preload gain on the production build                                    |
| `preload-experiment.mjs`, `preload-experiment-300.txt`, `preload-experiment-0.txt` | FE-08: dev-fixture try, not usable (development React hides the image time)    |
| `dev-vars-check.mjs`, `.txt`                                                       | HYG-01: how the installed Wrangler loads a `.dev.vars` override                |

The repository was not changed. `git status --short` shows only ` M pnpm-lock.yaml` and `?? apps/lab/`, which were present at the start and come from another task.
