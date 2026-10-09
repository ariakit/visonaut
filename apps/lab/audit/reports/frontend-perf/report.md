# Frontend build and runtime performance

Source: [`f83fef6`](https://github.com/ariakit/visonaut/commit/f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90), `apps/web`. All paths below are relative to `apps/web` unless they start with `packages/` or `docs/`. Production serves the same build: the public HTML at `https://visonaut.com/` names `index-CXm4JU5N.css` and `index-MxeSnhFR.js`, the same hashed files that the local build produced.

## How it works (map)

### Build output

One `vite build` (Vite 8.3.0, Rolldown, `@cloudflare/vite-plugin`, TanStack Start) writes `dist/client` (1,250,721 bytes) and `dist/server`. The client has 1 stylesheet, 11 script chunks, and 1 image.

| File                              |     Raw | gzip -9 | brotli -11 | Content (from the `//#region` markers of the matching server chunk)                                                          |
| --------------------------------- | ------: | ------: | ---------: | ---------------------------------------------------------------------------------------------------------------------------- |
| `index-CXm4JU5N.css`              | 464,666 |  59,500 |     32,868 | Tailwind 4 + `@ariakit/tailwind` + vendored `ui.css`. 426 kB is `@layer utilities`.                                          |
| `index-MxeSnhFR.js` (entry)       | 319,611 | 101,143 |     88,286 | `react-dom`, TanStack Router and Start client, seroval, route definitions, `src/review/client.ts`.                           |
| `app-shell-rQLLgOsf.js`           | 139,641 |  40,104 |     35,550 | clava, `@ariakit/utils`, `@ariakit/store`, vendored shell, nav, control, layer, frame, text, button recipes, 5 lucide icons. |
| `runs._runId-QUJlDVZ1.js`         | 137,841 |  43,996 |     38,500 | Review workspace, item list, viewer, Ariakit Combobox, Composite, CollectionRenderer, Tag, Dialog.                           |
| `badge.ariakit.react-CyMRzBLT.js` |  53,323 |  19,375 |     17,471 | Ariakit Popover, Portal, Dialog utilities, Floating UI, `user-menu.tsx`, badge.                                              |
| `routes-DOmkFmT0.js`              |  41,664 |  11,994 |     10,757 | Dashboard component, `operations-attention`, table recipe.                                                                   |
| `firefox-B8Bz3Pw-.svg`            |  38,092 |  10,533 |      8,773 | Browser icon for variant labels.                                                                                             |
| `react-Dfu8Q4go.js`               |  31,168 |  11,684 |     10,453 | The better-auth client and nanostores. The name is misleading.                                                               |
| `preload-helper-B-8p3_4s.js`      |  15,947 |   6,536 |      5,951 | TanStack link and preload helpers.                                                                                           |
| `pulls._pullNumber-pnMUd0Nl.js`   |   6,716 |   2,390 |      2,070 | Pull request landing page.                                                                                                   |
| 4 small chunks                    |   1,848 |   1,247 |      1,097 | `runs._runId-6tHAE8eb.js` (error component, 941 B) and three lucide icon chunks of 199, 234, and 474 B.                      |

Initial JavaScript per route (from `dist/server/assets/_tanstack-start-manifest_v-*.js`, summed by `route-totals.mjs`):

| Route                                          | Script files |     Raw | gzip -9 | brotli -11 |
| ---------------------------------------------- | -----------: | ------: | ------: | ---------: |
| Every route (entry, app-shell, preload-helper) |            3 | 475,199 | 147,783 |    129,787 |
| `/`                                            |            8 | 602,062 | 191,351 |    168,946 |
| `/pulls/$pullNumber`                           |            7 | 513,756 | 162,348 |    142,765 |
| `/runs/$runId`                                 |            9 | 698,905 | 223,775 |    197,009 |

Every route also loads the one render-blocking stylesheet. Route-level code splitting works: TanStack splits each route `component` and `errorComponent`, and the server HTML has a `modulepreload` link for each chunk of the matched route. There are no font files and no `@font-face` rule. lucide-react is tree-shaken to single icons.

### Request sequence: dashboard (`/`)

1. `GET /`. `src/server.ts:118` calls `render(request)`. The route has no loader (`src/routes/index.tsx:39-44`). The server renders `Index` with `useState({ status: "loading" })` (`src/routes/index.tsx:161`). The HTML is 28,538 bytes (4,852 brotli) and its only content is the header and `Checking access and loading runs…` (`src/routes/index.tsx:275-279`). The response has `Cache-Control: no-store, private` and a CSP with a nonce for each request (`packages/security/src/http.ts:31-50`, `src/router.tsx:5-9`, `src/server.ts:23-28`).
2. The browser loads the stylesheet (render-blocking) and 8 scripts (`modulepreload` plus one `async` module script).
3. React hydrates. Then `useEffect` runs `fetch("/api/runs")` (`src/routes/index.tsx:176-210`). This is the first time that the data request can start.
4. The response sets `ready`, `guest`, `forbidden`, or `error`. Only then the page shows the queue or the sign-in panel.
5. When the state is `ready` and not preview, `OperationsAttention` mounts and requests `/api/operations` (`src/routes/index.tsx:254-256`, `src/components/operations-attention/index.tsx:233`). It repeats every 60 seconds (`:280`).

### Request sequence: run (`/runs/$runId`)

1. `GET /runs/<id>`. The route has `ssr: false` (`src/routes/runs.$runId.tsx:31`). The server sends the root shell and the pending component: `Checking access and loading this run…` (`:66-74`). The dehydrated match is `s:"pending", ssr:!1`.
2. The browser loads the stylesheet and 9 scripts.
3. The entry runs the client loader: `loadReviewModel` requests `/api/runs/<id>` (`:37-47`, `src/review/client.ts:365-373`). `staleTime: Infinity`, `gcTime: 0`, and `loaderDeps` on `comparison` only (`:34-36`). A selection change does not refetch (verified: 1 model request for 5 selections).
4. `parseReviewModel` validates the whole model on the main thread (`src/review/client.ts:155-207`). `ReviewWorkspace` renders. The item list is virtualized with `CompositeRenderer` (`src/review/item-list.tsx:344-354`); 20 rows are in the DOM for 1,000 items.
5. The viewer mounts `<img>` elements for the reference and the candidate (`src/components/screenshot-viewer.tsx:146-164`). Each image stays `invisible` until `decode()` resolves and its dimensions match (`:49-72`). The diff image mounts only after the first switch to the difference view (`:205-208`, `:242-262`).
6. Each selection writes `item` and `variant` to the URL with `navigate({ replace: true })` (`src/routes/runs.$runId.tsx:118-132`). Verified: 1 `history.replaceState` for each selection.

### Navigation

- Router links (client navigation): `Review changes`, `Open run`, `View history`, history rows, variant links, item rows.
- Plain anchors (full document load): the brand link, the three header links, and the `Queue` button on the run page (`src/components/app-shell.tsx:15-19`, `:29`, `:53-58`; `src/review/review-workspace.tsx:580`).
- Router options: `createRouter({ routeTree, scrollRestoration: true, ssr: { nonce } })` (`src/router.tsx:8`). No `defaultPreload`, `defaultPendingMs`, `defaultStaleTime`, or default error and not-found components. The installed defaults are `defaultPendingMs: 1e3` and `defaultPendingMinMs: 500` (`@tanstack/router-core@1.171.32/dist/esm/router.js:625-627`).

### Auth client, images, static assets

- `createAuthClient()` from `better-auth/react` is called inside click handlers only, one new client for each click, in three routes (`src/routes/index.tsx:216`, `:232`; `src/routes/runs.$runId.tsx:175`, `:191`; `src/routes/pulls.$pullNumber.tsx:124`, `:138`). `useSession` is not used, so no session request starts on load. The module is a static import, so its chunk is preloaded on every route.
- Images come from `GET /images/<id>` with `Cache-Control: public, max-age=31536000, immutable` (`src/api/images.ts:52`). Thumbnails are separate small images (`src/api/review.ts:505-506`) and use `loading="lazy"` (`src/review/item-list.tsx:233-238`).
- Static assets come from Workers Static Assets (`dist/server/wrangler.json`: `"assets":{"directory":"../client"}`). There is no `_headers` file. Production sends `cache-control: public, max-age=0, must-revalidate` for hashed assets.
- CSP nonce: the nonce is created for each server router (`src/router.tsx:5`), set on the inline sidebar script (`src/routes/__root.tsx:22-25`) and on the TanStack scripts, and sent in the header by `securePrivateResponse`. The load measurements show no console error or warning in dev or in the build. `style-src` keeps `'unsafe-inline'` because the primitives write inline `style` attributes (14,792 bytes on the run page).

## Findings

### FE-01 · The dashboard requests its data only after JavaScript loads and hydrates

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `src/routes/index.tsx:161`: `const [state, setState] = useState<DashboardState>({ status: "loading" });`
  - `src/routes/index.tsx:176-180`: `useEffect(() => { ... const response = await fetch("/api/runs", {`
  - `src/routes/index.tsx:275-278`: `{state.status === "loading" && ( <Text render={<p />} className="py-12 ak-ink-60" role="status"> Checking access and loading runs…`
  - Built HTML for `/` (28,538 bytes): the only body text is `Checking access and loading runs…`.
  - Build, 150 ms latency and 9 Mbps: HTML parsed at about 160 ms, scripts end at 507 to 553 ms, `/api/runs` starts at 564 ms and ends at 717 ms, queue visible at 752 ms. First contentful paint is 476 ms.
  - Production, anonymous, 3 cold loads: first contentful paint 504 ms, loading text 481 ms, sign-in panel 1,068 ms (985 to 1,109). Production `GET /api/runs` without a session answers in 339 to 395 ms. `GET /health` answers in 32 ms on the same connection.
- What happens: The server already has the request cookie, but it sends a page that only says that it is loading. The browser must download and run about 600 kB of JavaScript (169 kB brotli) before it can ask for the run list. The API time is added after the asset time. They do not overlap.
- Impact: Every dashboard load shows `Checking access and loading runs…` for at least one API round trip after the scripts are ready. In production this was about 560 ms of loading text for an anonymous visitor. A signed-in maintainer has a slower API path (session, GitHub permission, D1), so the wait is longer. This is the main frontend part of the "wait around checking access" complaint.
- Recommendation: Load the dashboard data in a route `loader` that runs during server rendering, so the first HTML contains the queue or the sign-in panel. A sketch (not run):

  ```tsx
  // src/routes/index.tsx
  import { createServerFn } from "@tanstack/react-start";
  import { getRequest } from "@tanstack/react-start/server";

  const loadDashboard = createServerFn({ method: "GET" }).handler(async () => {
    // Use the same access check and query as GET /api/runs.
    return readDashboard(getRequest());
  });

  export const Route = createFileRoute("/")({
    validateSearch,
    loader: () => loadDashboard(),
    staleTime: 30_000,
    component: Index,
  });
  ```

  The server function must keep the preview fixture path and the `401` and `403` outcomes that the client code handles today. Server time moves into the document response, so the access check itself must be fast or the loader must stream.

- Alternatives:
  - Minimal: start the request from the document head, before the scripts load. Add one more nonce script next to `sidebarPreferenceScript` that stores `window.__runs = fetch("/api/runs", { credentials: "same-origin", cache: "no-store" })` on `/`. `Index` then awaits that promise. In the 150 ms profile the request would start near 165 ms, not 564 ms. This number is derived from the measured timestamps. It is not measured.
  - Middle: a client-only loader on the route (as the run route has). The request then starts when the entry script runs, not after hydration and effects. This saves less.
  - Keep the fetch, and make the access check cheaper on the server. That is a backend change and it does not remove the sequence.
- Maintainer decision needed: yes. Do you want dashboard data in the server-rendered HTML (server function plus loader), or only an earlier client request?

### FE-02 · The run page requests the review model only after the entry JavaScript runs

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `src/routes/runs.$runId.tsx:31`: `ssr: false,`
  - `src/routes/runs.$runId.tsx:37-39`: `loader: async ({ params, deps, abortController }) => { ... const model = await loadReviewModel(params.runId, deps.comparison, abortController.signal);`
  - Built HTML for the run route: `matches:[...{i:" runs $runId ...",s:"pending",ssr:!1}]` and the text `Checking access and loading this run…`.
  - Build, 150 ms latency and 9 Mbps, 5 runs: loading text 445 ms, `/api/runs/<id>` starts at 520 ms and ends at 679 ms, workspace in the DOM at 792 ms, first screenshot decoded at 814 ms. At 40 ms and 20 Mbps: request 220 to 265 ms, workspace 380 ms, first screenshot 402 ms.
  - After the response, one long task of 106 to 114 ms renders the workspace for a model with 1 item and 2 variants. With 4x CPU throttling and a 1,000-item model the first render is a 682 to 728 ms long task.
- What happens: The run page is a client-only route. The model request starts when the 320 kB entry chunk has run. The image requests start only after the model arrives and the workspace renders. The chain is: HTML, then scripts, then model, then render, then images.
- Impact: Time to the first screenshot is the sum of four sequential steps. The reviewer sees the loading text for the whole model request, and then `Loading image…`.
- Recommendation: Start the model request in parallel with the scripts. The smallest change is a nonce script in the head that starts the request from `location.pathname` and `location.search`, and a loader that uses that promise when it exists:

  ```ts
  // loader in src/routes/runs.$runId.tsx (sketch)
  const early = window.__reviewModel;
  window.__reviewModel = undefined;
  const model = early?.key === key ? parseReviewModel(await early.promise) : await loadReviewModel(...);
  ```

- Alternatives:
  - `ssr: "data-only"` (supported by the installed router: `load-server.js` and `load-client.js` contain `data-only`). The server runs the loader and the client renders. The model then travels inside the HTML stream. For a large run this adds megabytes to the document, so measure before you select it.
  - Full server rendering of the workspace. This is the largest change and the workspace depends on `window` and `localStorage` state.
  - Minimal: keep the sequence and only reduce the first render cost (see FE-07 and FE-11).
- Maintainer decision needed: yes. Is an inline early request acceptable for a client-only route, or do you prefer server data loading for runs?

### FE-03 · The header links and the `Queue` button are plain anchors, so each click reloads the document

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `src/components/app-shell.tsx:15-19`: `{ id: "queue", href: "/", ... }, { id: "history", href: "/?view=history", ... }, { id: "service", href: "/?view=service", ... }`
  - `src/components/app-shell.tsx:53-58`: `<NavLink key={id} href={href} aria-label={label} aria-current={active === id ? "page" : undefined}>`
  - `src/components/app-shell.tsx:29`: `<ControlButton $p={1} render={<a href="/" />} aria-label="Visonaut review queue">`
  - `src/review/review-workspace.tsx:580`: `<Button $p={1} render={<a href="/" />}>`
  - `src/components/ariakit/components/nav.ariakit.react.tsx:602-608`: `NavLink` renders `<ak.Role.a ... />`, a plain anchor. It accepts `render`.
  - Build, `measure-nav.mjs`: `Queue -> header 'Run history'`: 1 document request, 12 requests in total (document, stylesheet, 8 scripts, favicon, `/api/runs`). `Run -> 'Queue' button`: 1 document request, 12 requests. `Queue -> 'View history' (router Link)`: 0 document requests, 0 API requests, done in 49 ms.
  - With a 1,500 ms API delay: the header link shows `Checking access and loading runs…` from 103 ms to 1,627 ms. The router link to the same view shows the history at once.
- What happens: Queue, history, and service are one route with a `view` search parameter and the same `/api/runs` data. The header changes between them with full page loads. The run page returns to the queue with a full page load too.
- Impact: Each tab click repeats the complete load: document, 9 asset revalidations (see FE-05), hydration, and the access-checked API request. The data that the page already had is discarded.
- Recommendation: Render the header links and the two `href="/"` buttons with the router `Link`, as the workspace already does for variant links:

  ```tsx
  <NavLink
    key={id}
    aria-label={label}
    aria-current={active === id ? "page" : undefined}
    render={<Link to="/" search={view ? { view } : {}} />}
  >
  ```

  `AppHeader` is also used on `/runs/$runId` and `/pulls/$pullNumber`, so these links become client navigations to `/` there (see FE-04 for the data refetch on mount).

- Alternatives:
  - Minimal: change only the three header links.
  - Keep anchors, and make the full load cheap (FE-01, FE-05). The reload stays visible.
- Maintainer decision needed: no.

### FE-04 · Dashboard data lives in component state, so each mount and each refresh shows the loading text again

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `src/routes/index.tsx:161-162` and `:176-210`: the run list is `useState` plus an effect keyed on `reload`. There is no loader, no `staleTime`, and no cache.
  - `src/routes/index.tsx:242-245`: `const refresh = () => { setState({ status: "loading" }); setReload((value) => value + 1); };`
  - Build with a 1,500 ms API delay, `Run -> browser Back`: 0 document requests, 1 `/api/runs` request, and the screen shows `Checking access and loading runs…` from 102 ms to 1,530 ms.
- What happens: The dashboard forgets its data when it unmounts. A return from a run (Back, or a router link after FE-03) starts from the loading text. `Refresh runs` also replaces the visible list with the loading text.
- Impact: The reviewer loop is queue, run, queue, run. Each return to the queue waits for the full API time with an empty page.
- Recommendation: Keep the last successful run list and show it while a new request runs. With a loader (FE-01) this is `staleTime` plus `router.invalidate()` for the refresh button. Without a loader, keep the previous `ready` state during a refresh:

  ```tsx
  const refresh = () => setReload((value) => value + 1);
  // Show a small "Refreshing…" status. Do not replace state with { status: "loading" }.
  ```

- Alternatives:
  - A module-level variable with the last response and its time. This is a small cache without a store. The contract excludes a new global store (docs/current-contract.md, D08/D09), so keep it local to the route module if you select it.
  - Minimal: only stop `refresh` from clearing the list.
- Maintainer decision needed: yes. How old can a visible run list be while the new list loads?

### FE-05 · Hashed static assets are served with `max-age=0, must-revalidate`

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Production: `curl -sI https://visonaut.com/assets/index-CXm4JU5N.css` returns `cache-control: public, max-age=0, must-revalidate`, `cf-cache-status: HIT`, `content-encoding: br`. The same header is on `index-MxeSnhFR.js`. A request with `If-None-Match` returns `304`.
  - Build served by Miniflare, reload of `/`: all 9 assets return `304` with `cache-control="public, max-age=0, must-revalidate"`.
  - `public/` contains only `favicon.svg`. There is no `_headers` file.
  - Check in the scratch directory: a copy of `dist/client` with a `_headers` file returns `cache-control: public, max-age=31536000, immutable` for the same asset.
- What happens: Workers Static Assets uses its default header. The file names contain a content hash, but the browser must ask the edge for each file on each document load.
- Impact: Each document load sends 9 or 10 conditional requests before it can use the stylesheet and the scripts. That is one extra network round trip on each load. With FE-03 it repeats on each header click.
- Recommendation: Add `public/_headers`:

  ```text
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```

- Alternatives: None that are smaller. A service worker cache is larger and not needed.
- Maintainer decision needed: no.

### FE-06 · A click on a run gives no feedback for 1 second, and nothing is preloaded

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `src/router.tsx:8`: `createRouter({ routeTree, scrollRestoration: true, ssr: { nonce: scriptNonce() } })`. No `defaultPendingMs` and no `defaultPreload`.
  - `@tanstack/router-core@1.171.32/dist/esm/router.js:626`: `defaultPendingMs: 1e3`.
  - `src/routes/runs.$runId.tsx:33`: `pendingMinMs: 0,`
  - Build with a 1,500 ms API delay, `Queue -> 'Review changes'`: the URL changes at 102 ms, the screen still shows `Your review queue.` until 1,123 ms, then `Checking access and loading this run…` until 1,631 ms, then the workspace.
  - The run chunk (137,841 bytes, 38,500 brotli) is requested only after the click.
- What happens: The router waits 1,000 ms before it shows a pending component. During that time the old page stays and no control changes.
- Impact: When the model request takes more than about 100 ms, the click looks ignored. A second click is likely.
- Recommendation: Set a short pending delay and warm the run chunk:

  ```ts
  createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPendingMs: 100,
    ssr: { nonce: scriptNonce() },
  });
  ```

- Alternatives:
  - `defaultPreload: "intent"` also runs the loader on hover. For runs this downloads a full review model for each hovered row, so it has an API cost. A code-only warm-up (`router.loadRouteChunk` in an idle callback, or a `modulepreload` link on `/`) has no API cost.
  - Keep the delay and add a thin progress bar in the header while `router.state.isLoading` is true.
- Maintainer decision needed: yes. Is data preload on hover acceptable for run links, or only code preload?

### FE-07 · Each review action re-renders the whole workspace several times

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - Build, synthetic run with 1,000 items and 6 variants each, 1,121 mounted components, 753 elements, 1x CPU, medians for each key press:

    | Action                           |  Commits | Component renders | `keydown` duration | Main-thread task time | Longest task |
    | -------------------------------- | -------: | ----------------: | -----------------: | --------------------: | -----------: |
    | ArrowDown (next item)            |        7 |             3,442 |              32 ms |           68 to 72 ms |  under 50 ms |
    | `A` (approve and next)           | 10 to 12 |    6,106 to 7,106 |        64 to 80 ms |         138 to 155 ms | 89 to 100 ms |
    | One character in the list search |        3 |             1,523 |        16 to 24 ms |           21 to 29 ms |  under 50 ms |

  - The same run with 4x CPU throttling: ArrowDown `keydown` 120 to 128 ms; approve `keydown` 256 to 264 ms, task time 508 to 548 ms, longest task 414 to 417 ms.
  - The cost does not change with the number of items: 50 items give the same 7 commits and 3,442 renders.
  - Dev fixture (component names): ArrowDown renders `[996, 313, 976, 12]` components in its 4 commits, of 995 mounted. `S` (view mode) renders `[991, 12]`. Approve renders `[980, 980, 12, 980, 980, 12, 976, 12]`.
  - No `memo`, no React Compiler, no transition: `rg "memo\(|startTransition|useDeferredValue|reactCompiler" src vite.config.ts` has no result except `useMemo`.
  - Causes in the code:
    - All state is in one component: `src/review/review-workspace.tsx:196-213` (`mode`, `zoom`, `announcement`, `sidebarOpen`, `order`, ...), `:253-260` (`useReviewSession`), `:296-301` (`useEvidence`). Each image decode calls `report`, which sets state at this level (`src/review/use-evidence.ts:54-62`).
    - `src/review/item-list.tsx:102-104`: `useLayoutEffect(() => { onOrderChange?.(order); }, [onOrderChange, order]);` with `onOrderChange={setOrder}` (`src/review/review-workspace.tsx:453`). `order` is a new array for each model change (`src/review/item-list.tsx:91-101`), so each model change causes a second full render.
    - `src/review/navigation.ts:64-73`: `applyPendingReviews` returns `items: model.items.map((item) => ({ ...item, variants: item.variants.map(...) }))`. Every item gets a new identity, also when no command is pending.
    - `src/routes/runs.$runId.tsx:133-138`: `const route: ReviewRoute = { runId, comparisonId: comparison, selection: ..., onSelect };` is a new object for each render, and each selection is a router navigation.
- What happens: A key press changes a small part of the screen, but React runs almost every component 3 to 6 times. Each commit also causes style and layout work (13 style recalculations and 8 layouts for one ArrowDown).
- Impact: On a fast laptop the approve action already takes 64 to 80 ms of input handling. On a machine that is four times slower it takes more than 250 ms, with a 400 ms long task. The main review loop feels slow, and rapid decisions queue behind long tasks.
- Recommendation: Reduce the number of full renders first, then limit what each render touches.

  ```ts
  // src/review/navigation.ts: keep identities when nothing changes.
  export function applyPendingReviews(model: ReviewModel, commands: ReviewCommand[]): ReviewModel {
    if (!commands.length) return model;
    // ...build `changes`...
    const items = model.items.map((item) => {
      if (!item.variants.some((variant) => changes.has(variant.id))) return item;
      return { ...item, variants: item.variants.map(/* as today */) };
    });
    return { ...model, items };
  }
  ```

  ```tsx
  // src/review/review-workspace.tsx: ignore an order with the same content.
  const updateOrder = useCallback((next: number[]) => {
    setOrder((current) =>
      current.length === next.length && current.every((value, i) => value === next[i])
        ? current
        : next,
    );
  }, []);
  ```

  Then move `useEvidence` into the viewer subtree, and wrap `ItemList`, the item row, `ScreenshotViewer`, `AppHeader`, and the dialogs in `memo` with stable props. These changes keep the current command, queue, Undo, focus, and navigation behavior that D08 and D09 protect.

- Alternatives:
  - React Compiler. `@vitejs/plugin-react` 6 supports `react({ compiler: true })` with `oxc-transform-react` (marked experimental in its README) or the Babel preset `reactCompilerPreset`. It memoizes components without manual `memo`. It needs a trial run of the 36 browser tests.
  - Keep the selection in component state and write the URL after the render (`history.replaceState`), so a selection is not a router navigation. This removes about 3 commits for each selection, but changes how deep links update.
  - Minimal: only the two identity fixes above. They remove the duplicate full renders after each model change.
- Maintainer decision needed: yes. Manual memo boundaries, or a React Compiler trial?

### FE-08 · The next screenshot is not preloaded

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `src/components/screenshot-viewer.tsx:146-150`: `<img key={identity} src={image.url} ...>` is the only place that requests a full image. There is no `new Image()`, no `rel="preload"`, and no `fetchpriority` in `src`.
  - `src/components/screenshot-viewer.tsx:205-208` and `:242`: the diff pane mounts only when `mode === "diff"` has been opened.
  - Build, synthetic run: for each ArrowDown, 2 full-image requests start 26 to 29 ms after the key press. None start before it.
  - With a 300 ms delay on each image response: ArrowDown to decoded images is 355 ms, approve to decoded images is 393 ms. Without the delay: 63 ms and 126 ms.
  - `src/api/images.ts:52`: `"Cache-Control": "public, max-age=31536000, immutable"`, so a preloaded image is reused from the HTTP cache.
- What happens: The reviewer approves, the selection moves, and only then the browser asks for the two images of the next variant. The wait for each step is the image round trip plus decode.
- Impact: Each of the many steps in a review pays the network time of two full PNG files. The target of `Approve & next` is known in advance (`nextPending`, `src/review/navigation.ts:144-163`), so this wait is avoidable.
- Recommendation: Preload the reference and candidate images of the next target after the current evidence is ready:

  ```tsx
  // src/review/review-workspace.tsx (sketch)
  const upcoming = useMemo(() => nextPending(model.items, selection), [model.items, selection]);
  useEffect(() => {
    if (evidence.status !== "ready" || !upcoming) return;
    const item = model.items.find((entry) => entry.key === upcoming.itemKey);
    const variant = item?.variants.find((entry) => entry.key === upcoming.variantKey);
    const preloads = [variant?.reference, variant?.candidate].flatMap((image) => {
      if (!image) return [];
      const element = new Image();
      element.decoding = "async";
      element.src = image.url;
      return [element];
    });
    return () => {
      for (const element of preloads) element.src = "";
    };
  }, [evidence.status, model.items, upcoming]);
  ```

  `nextPending` builds one object for each variant on each call, so memoize it as shown. Each preload is one Worker request with a D1 read and an R2 read (`src/api/images.ts:24-40`), so keep it to one target.

- Alternatives:
  - Also preload the next item in list order (the ArrowDown target) and the current diff image. More requests, fewer waits.
  - Minimal: preload only the diff image of the current variant when the two main images are ready, so the `D` key is immediate.
  - Keep the previous images visible until the next images decode. This hides the wait but shows old evidence during it, which is a review risk.
- Maintainer decision needed: yes. How many images ahead is an acceptable R2 and Worker cost?

### FE-09 · Tailwind compiles the stylesheet twice

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `src/styles.css:1`: `@import "./review.css";` and `src/review.css:1-2`: `@import "tailwindcss"; @import "./components/ariakit/styles/ui.css";`
  - Three script imports of two CSS modules: `src/routes/__root.tsx:2` (`import "../styles.css";`), `src/routes/runs.$runId.tsx:21` and `src/review/review-workspace.tsx:66` (`import "../review.css";`).
  - Dev server: the page has two `<style>` elements, `src/styles.css` and `src/review.css`, each with 260 rules and 371,158 bytes. The dev stylesheet from the server is 883,047 bytes.
  - Build: `css-dupes.mjs` finds 1,796 utility rules, 1,542 unique, 254 exact duplicates with 128,286 bytes. `css-dupes2.mjs`: 240 of the duplicates are inside at-rules (`@container` 186, `@supports` 29, `@media` 23), and each has exactly 2 copies. The minifier merges plain duplicate rules but not rules inside at-rules.
  - The built file without the duplicates: 336,380 raw, 46,448 gzip, 32,271 brotli (from 464,666, 59,500, 32,868).
- What happens: The same Tailwind entry is compiled once as `styles.css` and once as `review.css`. The build joins both results, and 128 kB of duplicates stay in the file.
- Impact: 28% of the stylesheet is duplicate text. The wire cost is small with brotli (0.6 kB) and larger with gzip (13 kB). The browser parses and stores the duplicate rules. In dev, each page has the full Tailwind output twice.
- Recommendation: Keep one CSS entry and import it once:

  ```css
  /* src/styles.css */
  @import "tailwindcss";
  @import "./components/ariakit/styles/ui.css";
  ```

  Remove the two `import "../review.css"` lines and the file. The fixture pages that mount `ReviewWorkspace` without the root route (`src/review/__tests__/fixture.tsx`, `tooling/review-scale/fixture.jsx`) then need their own `import "../../styles.css"`.

- Alternatives: Keep both files and make `review.css` the only import everywhere (remove `styles.css`). The result is the same.
- Maintainer decision needed: no.

### FE-10 · A large part of the stylesheet is for classes that the app never applies

- Kind: performance
- Severity: medium. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - The stylesheet is 464,666 bytes for three pages. Structure: 3,484 rule blocks, 644 `:has(`, 592 `@container`, 245 `@property`, 85 `@supports`.
  - `measure-unused-css.mjs` records every class token that appears in the DOM during a broad session on the build (queue, account menu, history, service, pull page, run page with all view modes, details, zoom, help dialog, search, narrow viewport). 825 distinct classes appear. Of 1,542 unique utility rules (297,711 bytes), 729 rules with 123,735 bytes (41.6%) belong to classes that never appear.
  - The largest never-seen classes come from recipes that the app does not use: `ui-folder` (4,219 B), `ui-bevel-button` (2,641 B), `ui-selected:ui-bevel-button` (3,585 B), `ui-tabs-well`, `tabs`, the `--kbd-light-face` gradient, the `prose` rules.
  - `src/components/ariakit/components/tabs.ariakit.react.tsx` (38,309 bytes) and `kbd.ariakit.react.tsx` (4,837 bytes) have no importer in `src`. Tailwind scans them because it scans every source file.
- What happens: Tailwind generates a rule for each class-like token in the project, including vendored recipes and variants that no page renders.
- Impact: More bytes on the first load (46 kB over the wire in production for the stylesheet) and more selectors for the browser to match. The 41.6% value is an upper bound: classes for states that the session did not reach (errors, sign-in, rare badges) are counted as never seen.
- Recommendation: Tell Tailwind which sources to scan, and exclude vendored files that have no importer:

  ```css
  @import "tailwindcss";
  @source not "./components/ariakit/components/tabs.ariakit.react.tsx";
  @source not "./components/ariakit/components/kbd.ariakit.react.tsx";
  @source not "./**/__tests__";
  ```

- Alternatives:
  - Delete the unused vendored components. The contract says to keep the copied component set (docs/current-contract.md, D10), so this needs an explicit decision.
  - Accept the size. The cost is mostly one cached download after FE-05.
- Maintainer decision needed: yes. Does D10 allow exclusion of unused vendored files from the Tailwind scan?

### FE-11 · Class attributes dominate the markup

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: XL
- Evidence:
  - Server HTML for `/`: 28,538 bytes, of which 20,957 bytes (73%) are `class` attributes. The visible content is a header with three links and one sentence.
  - Run page with 1 item and 2 variants: 436 elements, 180,122 bytes of markup, 119,448 bytes of class attributes, 14,792 bytes of inline `style`.
  - History view with 100 runs: 1,688 elements, 1,009,609 bytes of markup, 874,106 bytes of class attributes. Each `<td>` has 1,683 bytes of classes on average, each `<tr>` 1,415 bytes, each control link about 1,700 bytes (`class-stats.mjs`).
  - Cost: the first render of the run page is one long task of 106 ms on an M4 Pro (script 102 ms, including 30 ms of forced style recalculation and 32 ms of forced layout). History with 100 runs at 4x CPU: long tasks of 139 ms and 163 ms; each search key re-renders 2,038 components and takes 72 to 104 ms.
- What happens: The vendored primitives build each element's class list at run time with clava. A button or a table cell gets 1.4 to 1.8 kB of utility classes, many with long arbitrary selectors. React writes these strings and the browser matches them against a stylesheet with 644 `:has()` selectors and 592 container queries.
- Impact: Render time and memory grow with the number of elements much faster than the visible content suggests. This limits server rendering too: a server-rendered history page would be about 1 MB of HTML before compression.
- Recommendation: This is a property of the primitive design, so the options are structural. For repeated elements (table rows and cells, list rows, badges), prefer one short recipe class that the stylesheet defines, in place of the full utility list on each element. Reduce the repeated element count where the design allows it (fewer wrapper elements for each row, fewer rows on screen).
- Alternatives:
  - Page or virtualize the history table (25 rows on screen). This divides the cost by four without a change to the primitives.
  - Use `useDeferredValue` for the history search so typing stays responsive.
  - Accept it for the workspace, because the list is already virtualized, and fix only the history view.
- Maintainer decision needed: yes. Is a change to how the primitives emit classes in scope for the UI redesign, or should the app only reduce element counts?

### FE-12 · Route chunks preload code that only a click needs

- Kind: performance
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `src/routes/index.tsx:2`, `src/routes/runs.$runId.tsx:2`, `src/routes/pulls.$pullNumber.tsx:2`: `import { createAuthClient } from "better-auth/react";`. The six call sites are inside `signIn`, `signOut`, and `switchAccount` handlers.
  - The manifest preloads `/assets/react-Dfu8Q4go.js` (the better-auth client: 31,168 raw, 11,684 gzip; 12,356 bytes over the wire in production) on all three routes.
  - `/assets/badge.ariakit.react-CyMRzBLT.js` (53,323 raw, 19,375 gzip; Popover, Portal, Floating UI) is preloaded on `/` and `/runs/$runId` for the account menu and the alerts popover.
  - The sign-in and sign-out code exists three times with small differences.
- What happens: Every visitor downloads the auth client and the popover engine before the page can hydrate, but the code runs only after a click on `Sign in`, `Sign out`, or the account button.
- Impact: About 84 kB raw (31 kB gzip) of the initial route JavaScript. It is a small share of the total, so the gain is small.
- Recommendation: Put sign-in and sign-out in one module and load the client on demand:

  ```ts
  // src/auth-actions.ts (sketch)
  export async function signInWithGitHub(callbackURL: string) {
    const { createAuthClient } = await import("better-auth/react");
    const result = await createAuthClient().signIn.social({ provider: "github", callbackURL });
    if (result.error) throw new Error("Sign-in could not start. Please try again.");
  }
  ```

- Alternatives:
  - Two plain `fetch` calls to the auth endpoints, with no client library in the browser. This couples the page to the endpoint contract of better-auth.
  - Lazy-load the popover content on the first open. This is more work because the trigger must render before the popover code exists.
- Maintainer decision needed: no.

### FE-13 · The Service status view waits for `/api/runs` before it requests `/api/operations`

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `src/routes/index.tsx:356` and `:363-364`: `{state.status === "ready" && ( ... {view === "service" ? ( <OperationsAttention onAccessDenied={onAccessDenied} layout="page" />`
  - `src/routes/index.tsx:254-256`: the header alert button also mounts only when `state.status === "ready"`.
  - Build, `History -> header 'Service status'`: `59ms Fetch /api/runs | 72ms Fetch /api/operations`. The second request starts after the first response.
- What happens: The service view does not show the run list, but it renders only after the run list has loaded. Then it starts its own request. Both requests pass the access check on the server.
- Impact: The Service status page needs two sequential API round trips. The alert count in the header on the queue view is always one round trip late.
- Recommendation: Start both requests together. `OperationsAttention` already reports `401` and `403` through `onAccessDenied`, so the service view can mount it without the run list.
- Alternatives: One endpoint that returns both payloads for the dashboard. This is a backend change.
- Maintainer decision needed: no.

### FE-14 · Operations polling does not stop when the tab is hidden

- Kind: cost
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `src/components/operations-attention/index.tsx:278-281`: `if (!controller.signal.aborted) { setLoading(false); timeout = setTimeout(load, 60000); }`. The file has no `visibilityState` check.
  - The other two polls check visibility: `src/review/use-review-session.ts:195` (`if (document.visibilityState !== "visible") return;`) and `src/routes/pulls.$pullNumber.tsx:111-114`.
- What happens: Each open dashboard tab requests `/api/operations` every 60 seconds for as long as it is open, also in the background.
- Impact: 1,440 authenticated requests for each tab for each day (60 × 24, from the code). Each request runs the maintainer access check and D1 reads. The three polls in the app follow two different rules.
- Recommendation: Use the same visibility rule as the review poll: do not schedule while hidden, and refresh on `visibilitychange` when the tab becomes visible.
- Alternatives: A longer interval while hidden (for example 10 minutes), if background alert announcements are wanted.
- Maintainer decision needed: no.

### FE-15 · Build and dev hygiene: micro-chunks, misleading chunk names, heavy dev pages

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Three chunks hold one lucide icon each: `arrow-left-D1LfnDKV.js` (199 B), `rotate-ccw-DxwNi5rf.js` (234 B), `git-pull-request-DhyqwrD4.js` (474 B). Each is a separate request and a `modulepreload` link.
  - `react-Dfu8Q4go.js` contains the better-auth client, not React. `badge.ariakit.react-CyMRzBLT.js` contains Popover and Floating UI. `app-shell-rQLLgOsf.js` contains clava and Ariakit utilities.
  - `vite.config.ts` has no `build` options.
  - Dev server, `/`: 226 requests and 17,425,118 bytes. The largest are `lucide-react.js` (5,396,776 bytes, the whole icon set), `react-dom_client.js` (3,132,776), `@ariakit_react.js` (1,809,378), and the duplicated styles (FE-09).
- What happens: The default chunking makes shared modules into separate chunks without a minimum size, and names each chunk after one of its modules.
- Impact: Three extra requests of about 500 bytes each (with headers) on first loads, and chunk names that mislead a reader of the network panel. The dev page parses 17 MB of script.
- Recommendation: Group the vendor code with explicit names (Rolldown `advancedChunks` groups for `react`, `router`, `ariakit`, `auth`) and a minimum chunk size. Treat this as optional polish.
- Alternatives: Leave it. After FE-05 the cost is paid once for each deploy.
- Maintainer decision needed: no.

### FE-16 · The font stack names `Inter Variable`, but no font file ships

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `src/components/ariakit/styles/ui.css:12-13`: `--font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif, ...`
  - The built stylesheet has 0 `@font-face` rules, and `dist/client` has no font file. The CSP has `font-src 'self'`.
- What happens: The page uses Inter only on a machine that has `Inter Variable` installed. Other machines use the system font. The primitives use variable weights such as `font-[calc(500+var(--contrast))]`.
- Impact: No performance cost (zero font bytes, no font swap). The text looks different between machines, which matters for a design review.
- Recommendation: Select one: remove `"Inter Variable"` from the stack, or self-host one variable `woff2` file with `font-display: swap` and a `preload` link.
- Alternatives: None.
- Maintainer decision needed: yes. System font, or a self-hosted Inter file (one more request of a few hundred kB on the first load)?

### FE-17 · `firefox.svg` is 38 kB for a 16-pixel icon

- Kind: performance
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: `src/review/icons/firefox.svg` is 38,092 bytes (10,533 gzip). `chrome.svg` is 3,380, `safari.svg` 3,186, `react.svg` 2,387, `solid.svg` 2,314. It is used at icon size in `src/review/variant-summary.tsx:20`.
- What happens: The full-detail Firefox logo is a separate asset request on each run page that has a Firefox variant. The other icons are small enough to be inlined in the script chunk.
- Impact: One extra request of about 9 to 10 kB compressed on those pages.
- Recommendation: Replace it with a simplified icon of a similar size to the others.
- Alternatives: Leave it. It is cached after FE-05.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

Environment: Apple M4 Pro, macOS Darwin 25.6.0, Node 24.18.0, Chrome 154.0.8037.98 headless through Playwright 1.63.0, viewport 1440 × 900, device scale factor 1, dark scheme. A new browser context for each cold sample. Scripts and raw output are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/frontend-perf/`.

Build hashes: `index-CXm4JU5N.css` sha256 `2c9b59a2…17b12c`, `index-MxeSnhFR.js` sha256 `5fb96a67…f2e49c`. The build ran once: `pnpm --filter @visonaut/web build` (client 2,386 modules in 569 ms, server 3,261 modules in 561 ms; log in `build.log`). `git status --short` was empty after the build.

General limits: all local timings are from a developer laptop on localhost. They are a proxy, not a Core Web Vitals result, a production speed claim, or a budget (docs/development.md, "Performance checks"). The historical E07 record in `docs/evidence/review-scale/` is unchanged and is not replaced by these values.

### M1. Build sizes

Command: `node sizes.mjs` (gzip level 9, brotli quality 11) and `node route-totals.mjs`. Results: the two tables in the map. Limit: production compresses with a lower level. Measured production sizes: stylesheet 43,803 bytes (curl, brotli) and 46,261 bytes (Chrome); entry script 102,767 bytes (curl) and 105,153 bytes (Chrome).

Chunk content: `node regions.mjs <server chunk>` sums the bytes between `//#region <module>` markers in the unminified server chunks with the same names. Limit: it is a proxy for the minified client chunks.

### M2. Cold load, production build served locally

Server: `node serve-build.mjs --port 4391`. Miniflare runs `dist/server/index.js` with `dist/client` assets in preview-fixture mode. A Node front server adds brotli (quality 5). Nothing is written to the repository.

Command: `node measure-load.mjs --base http://127.0.0.1:4391 --path <path> --milestone <queue|evidence> --runs 5 [--latency <ms> --down <Mbps>]`. Milestone times are the second animation frame after a mutation observer sees the element. Medians of 5 runs, in ms:

| Page                 | Profile        | First contentful paint | Loading text | Data request start to end | Content | First screenshot decoded |
| -------------------- | -------------- | ---------------------: | -----------: | ------------------------: | ------: | -----------------------: |
| `/`                  | none           |                     68 |           65 |                  78 to 81 |     111 |                      n/a |
| `/`                  | 40 ms, 20 Mbps |                    192 |          173 |                213 to 255 |     283 |                      n/a |
| `/`                  | 150 ms, 9 Mbps |                    476 |          471 |                564 to 717 |     752 |                      n/a |
| `/runs/<preview id>` | none           |                     56 |           58 |                  59 to 63 |     186 |                      216 |
| `/runs/<preview id>` | 40 ms, 20 Mbps |                    172 |          162 |                220 to 265 |     380 |                      402 |
| `/runs/<preview id>` | 150 ms, 9 Mbps |                    460 |          445 |                520 to 679 |     792 |                      814 |

Requests and bytes (encoded): `/` 12 requests, 233,196 bytes (document 5,962; stylesheet 38,727; 8 scripts 187,108). Run page 17 requests, 265,221 bytes (9 scripts 218,462; the 4 images are `data:` URLs in the fixture). CPU time for the run page load: script 78 ms, style 70 ms, layout 9 ms, one long task of 107 ms.

Limits: Chrome network emulation adds latency for each request and does not model connection setup. The preview fixture API answers in about 3 ms, so the data request time here is only the emulated latency. The preview run has 1 item, 2 variants, and `data:` images.

### M3. Chrome trace of the cold load

Command: `node measure-trace.mjs --url http://127.0.0.1:4391/runs/00000000-0000-4000-8000-000000000001 --milestone evidence`. Result: `long task 105.8 ms: {"FunctionCall":102.1,"MinorGC":2.1,"UpdateLayoutTree":29.7,"Layout":31.9}`; `ParseAuthorStyleSheet` 2.2 ms; two style recalculations of 340 elements, 13.6 and 14.9 ms. Dashboard: no long task, `FunctionCall` 24.9 ms, `Layout` 23.1 ms. Limit: tracing adds overhead.

### M4. Production, anonymous

About 49 anonymous GET requests in total: 7 with curl and 3 page loads.

- `curl -s -D - -H "Accept-Encoding: br, gzip" https://visonaut.com/`: `200`, 5,854 bytes (brotli of 28,538), `cache-control: no-store, private`, `cf-ray: …-GRU`.
- `curl` of `/assets/index-CXm4JU5N.css`: `cache-control: public, max-age=0, must-revalidate`, `cf-cache-status: HIT`, `content-encoding: br`, 43,803 bytes. With `If-None-Match`: `304`.
- `curl` of `/assets/index-MxeSnhFR.js`: same cache header, 102,767 bytes.
- `curl` with a reused connection: `/api/runs` `401` with time to first byte 0.395 s and 0.339 s; `/health` `200` in 0.032 s.
- `node measure-load.mjs --base https://visonaut.com --path / --milestone guest --runs 3`: time to first byte 359 ms, first contentful paint 504 ms, loading text 481 ms (382 to 682), sign-in panel 1,068 ms (985 to 1,109), 14 requests, 268,613 bytes (stylesheet 46,598; 9 scripts 213,635, including the Cloudflare beacon).

Limits: one location (edge GRU), 3 samples, anonymous only. The signed-in path was not measured.

### M5. Navigation on the build

Command: `node measure-nav.mjs` and `node measure-nav.mjs --api-delay 1500`. Raw output in `nav-local.txt` and `nav-api-delay-1500.txt`. Key lines:

```text
== Queue -> header 'Run history'
   done after 119 ms; document requests: 1; total requests: 12
== Queue -> 'View history' (router Link)
   done after 49 ms; document requests: 0; total requests: 1
== Run -> 'Queue' button
   done after 96 ms; document requests: 1; total requests: 12
== reload: asset responses
   304 fromDiskCache=false cache-control="public, max-age=0, must-revalidate" /assets/index-CXm4JU5N.css   (and 8 more)
```

With the 1,500 ms API delay:

```text
== Queue -> 'Review changes' (router Link to the run)
   screen over time: 0ms [/] h1="Your review queue."  ->  102ms [/runs/…] h1="Your review queue."  ->  1123ms h1=null status="Checking access and loading this run…"  ->  1631ms h1="Dialog" evidence=loading  ->  1758ms evidence=ready
== Run -> browser Back
   requests: 5ms Fetch /api/runs
   screen over time: 0ms [/runs/…]  ->  102ms [/] status="Checking access and loading runs…"  ->  1530ms h1="Your review queue."
```

Limits: the screen state is sampled every 100 ms. The delay is added by Playwright request interception.

### M6. Review interactions on the build, synthetic model

Command: `node measure-interaction.mjs --items <n> --variants 6 [--cpu 4] [--image-delay 300]`. Playwright fulfills `/api/runs/<id>`, `/api/review-sessions`, the command endpoint, and `/images/*` (real 1280 × 800 PNG files of 249,024 bytes). A script installed before React counts commits and component functions that ran (fiber flag `PerformedWork`) through the DevTools hook. Key press durations come from the Event Timing API. Times to decoded images are in-page timestamps.

```text
model: 1000 items x 6 variants, JSON 6537544 bytes; cpu 1x
A. initial load {"commits":20,"componentRenders":4679,"mounted":{"components":1121,"host":729},"elements":753,"listRowsInDom":20,"classBytes":218482,"htmlBytes":336803,"longTasks":[{"start":193,"duration":157}],"imageRequestsSoFar":{"full":2,"thumbnails":19}}
B. ArrowDown x12 (median) {"commits":7,"componentRenders":3442,"keydownDurationMs":32,"scriptMs":36,"styleMs":15,"layoutMs":13,"taskMs":72,"styleCount":13,"layoutCount":8,"evidenceReadyMs":63,"firstImageRequestAfterPressMs":29,"newFullImageRequests":2}
C. Approve & next x8 (median) {"commits":10,"componentRenders":6106,"keydownDurationMs":64,"scriptMs":61,"styleMs":52,"layoutMs":8,"taskMs":138,"evidenceReadyMs":126,"longTaskMaxMs":100}
D. Search typing x10 (median) {"commits":3,"componentRenders":1523,"eventMs":16,"taskMs":21}

model: 1000 items x 6 variants; cpu 4x
A. initial load {"longTasks":[{"start":320,"duration":682},{"start":1004,"duration":122}]}
B. ArrowDown {"commits":7,"componentRenders":3442,"keydownDurationMs":120,"taskMs":235,"evidenceReadyMs":218}
C. Approve & next {"commits":10,"componentRenders":6106,"keydownDurationMs":256,"taskMs":508,"evidenceReadyMs":472,"longTaskMaxMs":417}
D. Search typing {"commits":3,"componentRenders":1523,"eventMs":72,"taskMs":73}

model: 50 items x 6 variants; cpu 1x; image delay 300 ms
B. ArrowDown {"commits":7,"componentRenders":3442,"keydownDurationMs":32,"evidenceReadyMs":355,"firstImageRequestAfterPressMs":28}
C. Approve & next {"commits":12,"componentRenders":7114,"keydownDurationMs":72,"evidenceReadyMs":393}
```

An earlier run of the same script gave the ranges in FE-07 (approve: 10 to 12 commits, 64 to 80 ms). Component names per commit: `node measure-renders-dev.mjs` against the dev fixture on port 4311 (`renders-dev.txt`). Style scope: `node measure-trace-interaction.mjs` (`trace-interaction.txt`): one approve causes 9 layouts with 2 to 31 dirty objects of about 740.

Limits: synthetic data and instant API answers. The command endpoint always succeeds. Dev-fixture counts use development React and a model without the router. The render counter counts function and class components, not host elements.

### M7. Stylesheet

Commands: `node css-stats.mjs`, `node css-dupes.mjs`, `node css-dupes2.mjs`, `node measure-unused-css.mjs`. Results are in FE-09 and FE-10. Limits: the deduplicated size is a simulation that removes exact duplicate rules from the built file; a single compile can differ by a few bytes. The never-seen share is an upper bound. Chrome CSS coverage was not usable here: it reports the whole `@layer utilities` block as used (94.5%).

### M8. Dashboard with a full list

Command: `node measure-history.mjs 1` and `node measure-history.mjs 4` (Playwright fulfills `/api/runs` with 100 runs, 12 actionable) and `node class-stats.mjs`. Results are in FE-11. Raw output in `history.txt` and `class-stats.txt`.

### M9. Dev server (port 4310)

Command: `node measure-load.mjs --base http://127.0.0.1:4310 --path / --milestone queue --runs 3`. Result: 226 requests, 17,425,118 bytes, queue visible at 311 ms, two `<style>` elements of 371,158 bytes each, `/api/runs` requested twice (the first is aborted; development Strict Mode runs effects twice). No console error or warning. Limit: unbundled development modules; sizes are indicative only.

### M10. Other checks

- `node check-loader-reruns.mjs`: `after 5 ArrowDown: model requests 1 history {"replace":5,"push":0}` and 5 plain anchors to dashboard views on the run page.
- `_headers` check: a scratch copy of `dist/client` with a `_headers` file, served by `node serve-build.mjs --port 4395 --assets <copy>`, returns `cache-control: public, max-age=31536000, immutable` for `/assets/index-CXm4JU5N.css`.

## Open questions and items not verified

- The signed-in production path was not measured. The real time of an authenticated `/api/runs` and `/api/runs/<id>`, and the real size of a production review model, come from other lanes. FE-01 and FE-02 give the request start times; add the real API time to them.
- The anonymous production `/api/runs` takes 339 to 395 ms while `/health` takes 32 ms. `src/api/index.ts:130` and `:191` create the auth object and the GitHub client before the session check. The cause was not investigated in this lane.
- Back/forward cache: documents are `no-store`, which usually excludes them from the cache. Playwright starts Chrome with the back/forward cache disabled, so this was not tested.
- The expected gains of FE-07 and FE-08 are not measured. They need a branch with the change and the same scripts.
- The effect of React Compiler on this code (render-phase state updates, `useEffectEvent`, refs) is not tested.
- The exact cause of the 1.4 to 1.8 kB class lists (which recipe variants add the most) was not broken down by recipe.
- Tailwind source detection: the share of the stylesheet that comes from test files, `tooling/`, and Markdown was not separated from the share that comes from vendored recipes.
- Safari limits `history.replaceState` calls in a short period. Each selection is one call (verified in Chrome). A limit was not tested in Safari.
- Firefox and Safari were not measured. Anchor positioning, container style queries, and `:has()` cost can differ there.
- The working tree later showed ` M pnpm-lock.yaml` and `?? apps/lab/`. These come from another task in the same worktree, not from this lane.
