# Verification of the lane "Shell, header, navigation, information architecture, and URL model"

This file checks `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-shell/report.md`, finding by finding. I did not write that report. This check is read-only. Repository paths are relative to `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. My scripts, raw outputs, and screenshots are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-shell/verify/`.

## Method

- I opened each cited file and compared each quote and line range.
- I ran my own Playwright scripts. I did not reuse the auditor's scripts.
- "Real app" is the preview-fixture server on port 4310. "Fixture" is the route fixture on port 4311 with `/api/**` answers that my scripts supply.
- A production build output already exists in `apps/web/dist` (written at 16:23 by another lane). I did not run a build. I read that output to settle the points that the auditor marked as "not known in production".
- Platform facts come from the installed packages (`@tanstack/react-router@1.170.38`, `@tanstack/router-core@1.171.32`) and from official documentation. Each URL is given where it is used.

| Script                  | Purpose                                                                                 | Raw output                       |
| ----------------------- | --------------------------------------------------------------------------------------- | -------------------------------- |
| `verify-real.mjs`       | Document reload, titles, history and scroll, pending timing, Back, header geometry, 404 | `verify-real.json`               |
| `verify-fixture.mjs`    | Request order, band geometry, footer, Tab order, root font size, contrast, target sizes | `verify-fixture.json`            |
| `verify-extra.mjs`      | Footer against viewport height, ink contrast, gate screens, account menu                | `verify-extra.json`              |
| `verify-history.mjs`    | Which inputs push a history entry                                                       | printed in SHELL-09              |
| `verify-scrollbar.mjs`  | Space-taking scrollbar with the default root font, and ink values                       | printed in SHELL-11 and SHELL-13 |
| `verify-chip-focus.mjs` | Page shortcuts while focus is on a variant chip                                         | printed in "Missed"              |
| `verify-focus-nav.mjs`  | Focus and announcements after a client navigation                                       | printed in "Missed"              |
| `dist-stats.mjs`        | Sizes and duplicate markers in the existing production build                            | printed in SHELL-05              |

## Summary

| ID       | Verdict          | Auditor severity | My severity | Main correction                                                                                                                                                |
| -------- | ---------------- | ---------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHELL-01 | confirmed        | high             | high        | None.                                                                                                                                                          |
| SHELL-02 | partly-confirmed | high             | high        | The sample loader runs on the server as written. One alternative shows a model that is never refreshed. The contract already selects router loaders (P03).     |
| SHELL-03 | confirmed        | medium           | medium      | The history view has the same order. Parallel requests on a cold isolate cause two GitHub permission calls.                                                    |
| SHELL-04 | partly-confirmed | medium           | medium      | The installed `Link` has no transition state.                                                                                                                  |
| SHELL-05 | partly-confirmed | medium           | low         | The quoted `styles.css` text does not exist. Production has one copy. The recommendation, as written, removes all styles.                                      |
| SHELL-06 | confirmed        | high             | high        | The contract decision U02 already selects one review shell. The current page is worse than the "before" number in that decision.                               |
| SHELL-07 | confirmed        | medium           | medium      | The sample code throws for the guest loader result.                                                                                                            |
| SHELL-08 | confirmed        | medium           | medium      | GitHub check links are an external contract for `/pulls/N?check=` and `/runs/<id>`.                                                                            |
| SHELL-09 | partly-confirmed | medium           | medium      | Arrow keys on a focused variant chip also push entries.                                                                                                        |
| SHELL-10 | confirmed        | medium           | medium      | A root `errorComponent` must render the document.                                                                                                              |
| SHELL-11 | partly-confirmed | medium           | medium      | The dead zone also exists with the default font size and a space-taking scrollbar (1024 px to 1038 px). The recommended one-line fix does not cover that case. |
| SHELL-12 | confirmed        | medium           | medium      | The test label is used in four test files, not two places.                                                                                                     |
| SHELL-13 | confirmed        | medium           | medium      | None. I measured the ink floor.                                                                                                                                |
| SHELL-14 | confirmed        | medium           | medium      | None.                                                                                                                                                          |
| SHELL-15 | partly-confirmed | medium           | low         | A runbook names `/api/me` as a probe. `/api/session` has no reference at all.                                                                                  |
| SHELL-16 | confirmed        | medium           | medium      | None.                                                                                                                                                          |
| SHELL-17 | partly-confirmed | medium           | medium      | The footer is visible at 1920 x 1200 and 2560 x 1440. The auditor's screenshot shows an enabled button, because the mock omits a production field.             |
| SHELL-18 | confirmed        | medium           | low         | None.                                                                                                                                                          |
| SHELL-19 | confirmed        | low              | low         | The contract keeps the unused components on purpose (D10). The contract says "variant tabs" (U03), but the code uses `Nav`.                                    |
| SHELL-20 | confirmed        | low              | low         | None.                                                                                                                                                          |
| SHELL-21 | confirmed        | low              | low         | None.                                                                                                                                                          |
| SHELL-22 | confirmed        | low              | low         | None.                                                                                                                                                          |

No finding is refuted in full. Seven findings are partly-confirmed: they need a correction to a fact or to a recommendation. Four confirmed findings (SHELL-06, SHELL-07, SHELL-12, SHELL-19) have a smaller correction or a contract note.

## SHELL-01 · Header links, the brand link, and the "Queue" button reload the whole document

- Verdict: confirmed.
- Severity: high.
- Proof:
  - `apps/web/src/components/app-shell.tsx:15-19`, `:29`, `:53-58` are as quoted. `NavLink` renders `ak.Role.a` (`components/ariakit/components/nav.ariakit.react.tsx:600-605`).
  - `apps/web/src/review/review-workspace.tsx:580` and `:474-479` are as quoted.
  - `node verify/verify-real.mjs`, section `shell01_reload`. A `window.__marker` value shows if the document survived:

    | Action                      | Document survived | Requests after the click (dev)                                              |
    | --------------------------- | ----------------- | --------------------------------------------------------------------------- |
    | Header "Run history"        | no                | `document /?view=history`, `fetch /api/runs` x2                             |
    | Header "Service status"     | no                | `document /?view=service`, `fetch /api/runs` x2, `fetch /api/operations` x2 |
    | Header "Review queue"       | no                | `document /`, `fetch /api/runs` x2                                          |
    | In-page "View history"      | yes               | none                                                                        |
    | Brand link                  | no                | `document /`, `fetch /api/runs` x2                                          |
    | Workspace "Queue"           | no                | `document /`, `fetch /api/runs` x2                                          |
    | Queue card "Review changes" | yes               | `fetch /api/runs/<id>` x1                                                   |

- What I searched for to refute it: a test or a contract rule that requires plain anchors. `rg "Main navigation|toHaveAttribute\(\"href\""` in the tests finds only variant link checks. `docs/current-contract.md` has no rule for header links. The file has one commit (`f83fef6`). I found no reason for the anchors.
- Recommendation check: `NavLink render={<Link … />}` is feasible. The same pattern is in `review-workspace.tsx:748-759` and `item-list.tsx:197-214`.
- Corrections:
  - "The TanStack Start dev entry uses `StrictMode`" is not exact. The default client entry is the same in production (the string `StrictMode` is in `dist/client/assets/index-MxeSnhFR.js`). React runs effects two times only in development. The conclusion "production sends one" stays correct.
  - The real app is in preview mode, which hides the alerts bell (`routes/index.tsx:254`). In production, a header click to the queue or the history also sends `/api/operations` (fixture measurement in SHELL-03).

## SHELL-02 · No page ships data from the server, and each mount starts again with "Checking access…"

- Verdict: partly-confirmed. The finding is correct. Two parts of the recommendation need a correction.
- Severity: high.
- Proof:
  - `routes/index.tsx:161`, `:176-184`; `routes/runs.$runId.tsx:31-36`; `routes/pulls.$pullNumber.tsx:43`; `router.tsx:8` are as quoted. `rg "preload|defaultPreload"` in `apps/web/src` (no tests, no vendored code) has no match.
  - Server HTML (`curl`, then `rg -a`): `index.html` has `Checking access and loading runs…`. `run.html` has `Checking access and loading this run…` and the flag `ssr:!1`. `pull.html` has `Finding this pull request’s visual review…`. No run data is in the HTML (`rg -a -c "Preview dialog|Dialog review example"` gives no match).
  - `verify-real.mjs`, section `shell02_back` (run list delayed by 800 ms): scroll before leaving 212. After Back: 31 ms `Checking access and loading runs…` at `scrollY` 0; 1201 ms ready at `scrollY` 0. Requests after Back: `fetch /api/runs` x2 (one in production).
- Contract check: the contract supports this finding. `docs/current-contract.md:150` lists "P03: Use the existing router loaders". The decision text is in `docs/simplification-audit/audit-data.json` (P03, settled `router-loaders`): "Use the existing router loaders to own page reads and cancellation." Only the run route has a loader today. The queue and the pull page still use effects. The auditor did not cite P03.
- Corrections:
  1. The sample `loader: ({ abortController }) => loadDashboard(abortController.signal)` has no `ssr` option. TanStack Start runs loaders on the server for the document request by default. In the Worker, `fetch("/api/runs")` has no base URL and no cookies. The sample needs `ssr: false` (as the run route has) or a server function. `ssr` accepts `boolean | 'data-only'` (`router-core/dist/esm/router.d.ts:42`).
  2. The alternative "remove `gcTime: 0`" is not safe alone. The route also has `staleTime: Infinity` (`runs.$runId.tsx:36`). Decisions live in `useReviewSession` state, not in loader data. A return to the run inside the cache time then shows the first model, without the decisions from the earlier visit, and it never reloads. This alternative needs a finite `staleTime` or an invalidation after each command.
  3. `defaultPreload: "intent"` works with the current run route. Preloaded matches use `preloadStaleTime` (default 30 s) and `preloadGcTime` (default 5 min), not `gcTime` (`router-core/dist/esm/load-client.js:330`, `:783`). Each hover then costs one `GET /api/runs/:id` with its access check.
- Added fact (production build, not a time): each document needs one stylesheet of 464,666 bytes (60,125 gzip). The build has 747,759 bytes of script in all chunks (238,855 gzip). A page loads a subset of them. The entry chunk alone is 319,611 bytes (101,315 gzip), and the run route chunk is 137,841 bytes (44,074 gzip). The API request of the page starts after these scripts run. Command: `node verify/dist-stats.mjs`.

## SHELL-03 · The alerts request waits for the run list, and the Service status page waits for a run list that it does not use

- Verdict: confirmed.
- Severity: medium.
- Proof:
  - `routes/index.tsx:254-256`, `:356`, `:363-364` are as quoted.
  - `verify-fixture.mjs`, section `shell03_order` (each API answer delayed by 400 ms):

    ```text
    /               /api/runs 162->563   /api/operations 594->996
    /?view=service  /api/runs 190->591   /api/operations 607->1008
    /?view=history  /api/runs 137->538   /api/operations 570->971
    ```

- Additions:
  - The history view has the same serial order.
  - "Start both requests at the same time" has a cost that the report does not state. The permission cache stores only resolved results (`packages/security/src/authorization.ts:60-82`). Two requests that start together on a cold isolate each call GitHub. In the serial order of today, the second request can use the 60 s entry of the first. The alternative "add an alert count to `/api/runs`" does not have this cost.

## SHELL-04 · After a click on a run, the old page stays for up to 1 second with no feedback, then the page goes blank

- Verdict: partly-confirmed. The behavior is confirmed. One alternative names an API that the installed version does not have.
- Severity: medium.
- Proof:
  - `routes/runs.$runId.tsx:32-33` and `:55-64` are as quoted.
  - Default values: `router-core/dist/esm/router.js:626-627`: `defaultPendingMs: 1e3, defaultPendingMinMs: 500`. The official page agrees: <https://tanstack.com/router/latest/docs/framework/react/api/router/RouterOptionsType>.
  - `verify-real.mjs`, section `shell04_pending`. With a 3000 ms delay, `main` shows the queue at 101, 401, 701, and 951 ms. It shows `Checking access and loading this run…` at 1151 ms, with 4 header controls in place of 5. It shows the workspace at 3601 ms. With a 600 ms delay, only the queue and then the workspace show.
  - Screenshot `screens/real-queue-to-run-1300ms-after-click.png` shows what the caption says.
- Correction: "TanStack `Link` exposes its transition state" is not true for `@tanstack/react-router@1.170.38`. The children function gets only `{ isActive: boolean }` (`dist/esm/link.d.ts:38-42`). `rg "isTransitioning|data-transitioning"` in `dist/esm` has no match. My samples found zero elements with `[data-transitioning]` during the wait. Use the router state:

  ```tsx
  const pending = useRouterState({ select: (s) => s.status === "pending" });
  // router-core/dist/esm/router.d.ts:399-400: status: 'pending' | 'idle'; isLoading: boolean;
  ```

- Note: `pendingMs: 0` shows the skeleton also for a 100 ms load. That is acceptable only if the skeleton has the layout of the destination, as the report recommends.

## SHELL-05 · The dev stylesheet contains Tailwind and `ui.css` two times for the root, and four times on the run route

- Verdict: partly-confirmed. The dev measurement is correct. The cited source text, the cause, and the recommendation are wrong. Production does not have the problem.
- Severity: low (development only).
- Proof:
  - The report quotes `apps/web/src/styles.css:1-3` as three `@import` lines. The file has one line (`wc -l` gives 1, `git show HEAD:apps/web/src/styles.css` gives the same):

    ```css
    @import "./review.css";
    ```

    `apps/web/src/review.css` has the two lines `@import "tailwindcss";` and `@import "./components/ariakit/styles/ui.css";`.

  - Dev measurement reproduced: `curl "http://127.0.0.1:4310/@tanstack-start/styles.css?routes=__root__"` gives 883,047 bytes with 2 matches of `@property --shell-header-step`. The stylesheet for `__root__,/runs/$runId` gives 1,625,503 bytes with 4 matches.
  - Real cause: the dev stylesheet endpoint adds each CSS module of the module graph, also the CSS files that another CSS file imports. The section comments in the output show it: `/* /src/styles.css */`, `/* /@fs/…/apps/web/src/review.css */`, `/* /@fs/…/tailwindcss/index.css */`. The run route adds `/src/review.css` and `/@fs/…/styles.css` again.
  - Production: `node verify/dist-stats.mjs` on the existing build gives one stylesheet, `index-CXm4JU5N.css`, 464,666 bytes, 60,125 gzip, 32,868 brotli, with `{"propertyShellHeaderStep":1,"tailwindBanner":1,"layerProperties":1}`. No second stylesheet exists in `dist/client/assets`.
- Corrections:
  - Impact: none in production. The dev server sends 0.9 MB to 1.6 MB of CSS.
  - The recommendation "delete `review.css` and its `@import` in `styles.css`" leaves `styles.css` empty. The app then has no Tailwind and no `ui.css`. A correct change: move the two `@import` lines into `styles.css`, then delete `review.css` and the two TypeScript imports (`routes/runs.$runId.tsx:21`, `review/review-workspace.tsx:66`).

## SHELL-06 · The review workspace uses 408 px of a 900 px viewport before the first image pixel

- Verdict: confirmed. The numbers are facts. The choice of redesign is a judgment.
- Severity: high.
- Proof (`verify-fixture.mjs`, sections `shell06_bands_1440` and `shell06_bands_390`, top and height in px):

  | Band                   | 1440 x 900  | 390 x 844   |
  | ---------------------- | ----------- | ----------- |
  | App header             | 0, 48       | 0, 48       |
  | Main header            | 48, 48      | 48, 48      |
  | Run identity strip     | 96, 26      | 96, 26      |
  | Item heading           | 154, 59.3   | 185.5, 54   |
  | Variant chips          | 233.3, 38   | 306, 38     |
  | View and zoom controls | 286.3, 55   | 359, 92     |
  | First image pixel      | 408.3       | 518         |
  | Sticky action bar      | 840.5, 60.5 | 754.5, 90.5 |

  `linksToRoot`: `Visonaut review queue`, `Review queue`, `Queue`. The repeated facts are at the cited lines (`review-workspace.tsx:620` and `:467`; `:613-615` and `:469-470`; `:597` and `item-list.tsx:256`).

- Contract check, which the auditor did not make: the contract already selects a fix. `docs/current-contract.md:143` lists "U02: Use one review shell". The decision text (`docs/simplification-audit/audit-data.json`, U02, settled `single-shell`) says: "One compact ShellHeader for project/run context; sidebar for items; ShellMainHeader for selected variant, Approve/Reject, save state and Undo. Image evidence takes the remaining main area. Move run IDs, policy and comparison history to a Details disclosure." The problem statement of U02 gave "image content at y385" in a 1000 px viewport as the bad state. The current page starts the image at 408 px in a 900 px viewport. So the selected decision is not delivered.
- Effect on the report: the question "which run facts must stay on screen" has a recorded answer in U02 (run IDs, policy, and comparison history go to Details). `docs/review-guide.md:17` still asks the reviewer to check the run identity "above the images", so the two documents must be read together.

## SHELL-07 · Each page has the document title "Visonaut"

- Verdict: confirmed.
- Severity: medium.
- Proof: `routes/__root.tsx:10`. `rg "head:|document.title"` in `apps/web/src` (no tests) finds only `__root.tsx:6`. `verify-real.mjs`, section `shell07_titles`: `/`, `/?view=history`, `/?view=service`, `/runs/<id>`, `/pulls/4817`, and `/nope` all give `Visonaut`.
- Correction to the sample: the loader can return `{ status: "guest" }` (`runs.$runId.tsx:43`). Then `loaderData?.model.run.title` throws. Use optional chaining on `model` too:

  ```tsx
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.model?.run.title ?? "Run"} · Visonaut` }],
  }),
  ```

  The queue and the pull page have no loader, so their titles need `document.title` in an effect until SHELL-02 is done.

## SHELL-08 · URL model: pages are a search parameter, a pull request link works only with a check ID, and view state is not in the URL

- Verdict: confirmed for each fact. The preferred URL model is a judgment.
- Severity: medium.
- Proof:
  - `routes/index.tsx:40-42`; the file has 752 lines.
  - `api/review.ts:739`: `if (!check || !/^visonaut:pre:[a-f0-9]{40}(?::[1-9][0-9]*)?$/.test(check)) {`, then a 404.
  - `routes/pulls.$pullNumber.tsx:70-72`, `:82`, `:216-223`. `verify-extra.mjs`, case `pull no check`: heading `Review unavailable`, text `This Visonaut check was not found. Open the latest check on GitHub.`, buttons `Review queue` and `Retry`. There is no GitHub link.
  - `api/review.ts:561` (title string), `api/dashboard.ts:131-133` (two fields), `review-workspace.tsx:197-198` (local view state).
  - `rg "github.com" apps/web/src/review` (no tests) finds only an icon README.
- Addition: the two URL shapes are stored on GitHub. `api/pre-run-checks.ts:261` builds `…/runs/<id>` and `:508-511` builds `/pulls/<n>?check=<external_id>` as the check `details_url`. The code compares the stored value (`:328`, `:369`). Any new URL model must keep both shapes working. The table in the report keeps them, so the recommendation is feasible.
- The contract does not require the `check` parameter for a human visit. I found no rule about it in `docs/current-contract.md`.

## SHELL-09 · Item and variant links add history entries and scroll the page to the top; keyboard selection replaces the entry

- Verdict: partly-confirmed. "Keyboard selection replaces the entry" is true only when focus is outside the variant row.
- Severity: medium.
- Proof (`node verify/verify-history.mjs`, real app, 1440 x 600):

  ```text
  loaded                                    history.length 2
  A. workspace focused, ArrowRight          2  (replace)   variant=Dark
  A. workspace focused, ArrowLeft           2  (replace)   variant=Light
  B. mouse click chip 2                     3  (push)      focus stays on the chip, scrollY 150 -> 0
  B. then ArrowLeft (focus still on chip)   4  (push)
  B. then ArrowRight (focus still on chip)  5  (push)
  C. key 1 with focus on chip               5  (no change of variant)
  ```

  `verify-real.mjs`, section `shell09_history_scroll`: `scrollY` 200 before a variant link click and 0 after it.

- Cause of the extra pushes: `followVariantLink` (`review-workspace.tsx:99-121`) handles the arrow keys in the chip row and calls `next.click()` on the link. The link has no `replace`. This is the contract decision U06 ("Open the focused variant immediately", `docs/current-contract.md:145`).
- Corrections:
  - After one mouse click on a chip, each arrow key press adds a history entry. The mouse and keyboard paths are less different than the report says, and the Back problem is larger.
  - The recommended `replace resetScroll={false}` on the `Link` fixes this path too, because `click()` goes through the same link. `replace` and `resetScroll` exist in the installed types (`react-router/dist/esm/link.js:53`, `router-core/dist/esm/link.d.ts:62`).
  - See "Missed" item 1 for a related defect: page shortcuts do not work while focus is on a chip.

## SHELL-10 · An unknown URL shows the bare text "Not Found", a missing run offers only "Retry", and the root has no error component

- Verdict: confirmed.
- Severity: medium.
- Proof:
  - `routes/__root.tsx:5-16` and `router.tsx:8` are as quoted.
  - `curl -D - http://127.0.0.1:4310/nope`: `HTTP/1.1 404 Not Found`, body `<p>Not Found</p>`.
  - `verify-real.mjs`, section `shell10_notfound`: status 404, body text `Not Found`, 0 links, console warning `A notFoundError was encountered on the route with ID "__root__", but a notFoundComponent option was not configured…`.
  - `verify-extra.mjs`, case `run 404`: `This run could not be opened The run was not found. Retry`. Case `run 403`: only `Retry`.
  - Production path: `apps/web/dist/server/wrangler.json` has `"assets":{"directory":"../client"}` with no `not_found_handling`, so the Worker renders unknown paths (`server.ts:118`).
- Addition: the root component renders `<html>` (`__root.tsx:21`). A root `errorComponent` replaces the root component, so it must render the document, or the root must move the document to `shellComponent` (the option exists: `router-core/dist/esm/route.d.ts:380`). A root `notFoundComponent` renders inside the outlet and has no such limit.
- The render error on the queue and pull routes stays not triggered, as the report says.

## SHELL-11 · With a root font size above 16 px, the item list and the details panel cannot be opened between 1024 px and 64rem

- Verdict: partly-confirmed. The defect is real and I also measured the details panel. The scope is wider than the title, and the "smallest change" does not fix the wider case.
- Severity: medium.
- Proof:
  - `review-workspace.tsx:211-213`, `:538-540`, `:570`, `:559`, `:625`, `:1149`, `:1224`; `components/ariakit/styles/shell.ts:407-408` are as quoted.
  - `verify-fixture.mjs`, section `shell11_rootfont`:

    | Root font, width | `narrow` | Sidebar | Toggle | Dialog button | Details after click              |
    | ---------------- | -------- | ------- | ------ | ------------- | -------------------------------- |
    | 16 px, 1100      | false    | yes     | yes    | no            | sidebar                          |
    | 20 px, 1100      | false    | no      | no     | no            | nothing (`aria-expanded="true"`) |
    | 20 px, 1279      | false    | no      | no     | no            | nothing                          |
    | 20 px, 1281      | false    | yes     | yes    | no            | sidebar                          |
    | 20 px, 1000      | true     | no      | no     | yes           | dialog                           |

    So the "from code, not measured" claim about the details panel is now measured.

  - Screenshot `screens/mock-run-dark-1100-root-20px.png` shows what the caption says.
- New case (`node verify/verify-scrollbar.mjs`, default 16 px root, a scrollbar that takes 15 px of layout width, as a classic Windows or Linux scrollbar does):

  ```text
  innerWidth 1024  shell 1009  narrow false  sidebar no   toggle no   dialog button no   item links 0
  innerWidth 1030  shell 1015  narrow false  sidebar no   toggle no   dialog button no   item links 0
  innerWidth 1038  shell 1023  narrow false  sidebar no   toggle no   dialog button no   item links 0
  innerWidth 1039  shell 1024  narrow false  sidebar yes  toggle yes  dialog button no   item links 3
  ```

  The media query measures the viewport with the scrollbar. The container query measures the shell without it. The run page scrolls at 900 px height, so the scrollbar is present. Limit: I forced the scrollbar width with `::-webkit-scrollbar` in headless Chrome on macOS. I did not test Chrome on Windows.

- Corrections:
  - The dead zone is not only a large-font case. With the default font it is 1024 px to 1038 px of window width when the scrollbar takes space.
  - `window.matchMedia("(max-width: 63.999rem)")` fixes the font case only. A media query cannot match a container query when a scrollbar takes width. The listed alternative is the correct fix: let CSS decide both sides with the same container query (dialog trigger with `className="@5xl/shell:hidden"`), or measure the shell element.

## SHELL-12 · The first Tab stop on a run page is the whole page, and there is no skip link

- Verdict: confirmed.
- Severity: medium.
- Proof:
  - `review-workspace.tsx:528-534` and `components/ariakit/components/shell.ariakit.react.tsx:81-84` are as quoted.
  - `verify-fixture.mjs`, section `shell12_tab`. First stop: `div`, role `null`, name `Review workspace`, size `1440x994`, outline `auto 1px rgb(153, 200, 255)`. Then: brand, three nav links, account menu, search, selected item, `Accepted (1)`, and `Collapse screenshots` as the first stop in `main`. That is nine stops before `main`. The dashboard has six.
  - `skipLink: false` on both pages.
  - Screenshot `screens/mock-run-dark-1440-first-tab-stop.png` shows no visible ring.
- Recommendation check: `tabIndex={-1}` is feasible. The key handler is on the document (`review-workspace.tsx:443-448`), which is the contract decision U04 ("Page-wide review arrows", `docs/current-contract.md:146`). The shortcuts do not need focus on the shell.
- Correction: the label `Review workspace` is used by tests in four files, not at two places: `route.browser.test.ts:306`, `:493`; `pulls.browser.test.ts:27`; `scale.browser.test.ts:90`, `:99`, `:162`; `review.browser.test.ts:6`, `:361`, `:446`, `:1205`, `:1817`.

## SHELL-13 · Small muted text has a 3.96:1 contrast in the light scheme, uses pixel sizes that do not follow the user font size, and is muted in six different ways

- Verdict: confirmed.
- Severity: medium.
- Proof:
  - `review-workspace.tsx:610`, `:551`, `:645` are as quoted.
  - `verify-fixture.mjs`, section `shell13_contrast` (ancestor opacity applied, sRGB mix):

    | Text                | Size  | Dark | Light |
    | ------------------- | ----- | ---- | ----- |
    | Run identity strip  | 10 px | 5.34 | 3.96  |
    | Sidebar item count  | 11 px | 5.34 | 3.96  |
    | Changed pixels line | 12 px | 6.25 | 4.74  |
    | "Screenshots" title | 10 px | 7.26 | 5.71  |

  - Counts reproduced with `rg -N -o` on `routes`, `review`, `components/app-shell.tsx`, `components/user-menu.tsx`, `components/control-button.tsx`, `components/operations-attention`, and `components/screenshot-viewer.tsx`: `ak-ink-60` 45, `opacity-60` 9, `opacity-50` 4, `opacity-55` 1, `ak-ink-50` 1, `ak-ink-40` 1. Font sizes: 13 different values, with the same counts as the report.
  - The "contrast floor" claim is true. `verify-scrollbar.mjs` reads the computed color of test elements on the canvas:

    ```text
    light: ak-ink-60 oklch(0 0 0 / 0.6)   ak-ink-50 oklch(0 0 0 / 0.541843)   ak-ink-40 oklch(0 0 0 / 0.541843)   opacity-50: opacity 0.5
    dark:  ak-ink-60 oklch(1 0 0 / 0.6)   ak-ink-50 oklch(1 0 0 / 0.5)        ak-ink-40 oklch(1 0 0 / 0.496943)
    ```

    `ak-ink-60` gives 5.71:1 in light and 7.26:1 in dark (`verify-extra.mjs`, section `ink60_contrast`). So the minimal alternative passes AA.

  - `packages/ariakit-ui/src/styles/layer.ts:95` (upstream) has `$ink`. The vendored `layer.ts` has no match for `ink`.

## SHELL-14 · Sign-in, sign-out, and access errors exist three times, with different layout, copy, and recovery actions

- Verdict: confirmed.
- Severity: medium.
- Proof:
  - Each line range in the table is as quoted. Sign-out: `routes/index.tsx:234`, `routes/runs.$runId.tsx:193`, `routes/pulls.$pullNumber.tsx:142`. `createAuthClient()` at the six cited lines.
  - `verify-extra.mjs`, section `gates`:

    | Case        | Header controls       | Buttons in `main`                                       |
    | ----------- | --------------------- | ------------------------------------------------------- |
    | queue guest | 4                     | `Sign in with GitHub` 369 x 33                          |
    | queue 403   | 5 (with account menu) | `Retry`, `Use another account`                          |
    | run guest   | 4                     | `Sign in with GitHub` 724 x 33                          |
    | run 403     | 4                     | `Retry` 724 x 33                                        |
    | pull guest  | 4                     | `Review queue` 592 x 33, `Sign in with GitHub` 161 x 33 |
    | pull 403    | 4                     | `Review queue` 592 x 33, `Use another account` 152 x 33 |

  - Screenshots `screens/mock-queue-guest-dark-1440.png`, `screens/mock-run-guest-dark-1440.png`, and `screens/mock-pull-guest-dark-1440.png` show three different designs.

## SHELL-15 · The account menu never shows the signed-in user; the `login` prop and two identity endpoints have no caller

- Verdict: partly-confirmed. The UI part is confirmed. "No caller" needs a limit for `/api/me`.
- Severity: low.
- Proof:
  - `components/user-menu.tsx:24`. `rg "login=|login:" apps/web/src --glob '*.tsx'` has no match. The callers are `routes/index.tsx:258-263` and `routes/runs.$runId.tsx:207-212`.
  - `server.ts:88-104` and `api/review.ts:713-721` are as quoted. `context.identity.login` has one use (`api/review.ts:718`).
  - Screenshot `screens/mock-queue-dark-1440-account-menu.png`: "Account", "Manage your GitHub session.", "Sign out".
- Corrections:
  - `/api/session`: `rg "api/session"` in the whole repository finds only its definition. No client, no test, no document.
  - `/api/me`: no client code calls it, and four tests assert that the page does not request it (`review/__tests__/route.browser.test.ts:103`, `:115`, `:182`, `:309`). But `docs/operations/retire-preview-auth-at-cutover.md:59` names `/api/me` as a manual probe target, and `docs/evidence/deployed-review-readonly.json:52` records it. A removal must update that runbook. `docs/review-evidence-plan.md:62` still says the routes call `GET /api/me` first, which is not true now.

## SHELL-16 · There is no layout route; four call sites build their own shell and header, and the header differs between pages

- Verdict: confirmed.
- Severity: medium.
- Proof:
  - Call sites: `routes/index.tsx:248-267`, `routes/pulls.$pullNumber.tsx:151-152`, `routes/runs.$runId.tsx:57-58`, `review/review-workspace.tsx:528-535`. `routeTree.gen.ts:16-30` is flat.
  - `verify-real.mjs`, section `shell16_header`:

    | Page                  | Shell font | Header padding left | Nav x, width, height | Controls |
    | --------------------- | ---------- | ------------------- | -------------------- | -------- |
    | `/`, `/?view=history` | 14 px      | 10.5 px             | 527.6, 384.8, 31.6   | 5        |
    | `/runs/<id>`          | 16 px      | 12 px               | 526.4, 387.3, 32.5   | 5        |
    | `/pulls/4817`         | 16 px      | 12 px               | 526.4, 387.3, 32.5   | 4        |

  - Server HTML: `aria-current="page"` is in `index.html` and not in `run.html`.
- Recommendation check: a pathless layout route (`_app.tsx`) is standard TanStack file routing. The shell recipe supports three nested levels (`components/ariakit/styles/shell.ts:36-47`).

## SHELL-17 · Keyboard help sits in a page footer below the fold, next to a "Recompare stored run" button that can never be enabled

- Verdict: partly-confirmed. The dead control is confirmed. "Not visible on any viewport" is too strong. The auditor's screenshot does not show the production state.
- Severity: medium.
- Proof:
  - `api/review.ts:592`: `recompareAllowed: false,` is the only value. `api/review.ts:950-986` throws on each path. `review-workspace.tsx:328`, `:979-989`, `:1186-1201` are as quoted. `docs/review-guide.md:88`: "**Recompare stored run** is retired."
  - Footer position (`verify-extra.mjs`, section `footer_vs_viewport`). The script mocks `/api/**` on both servers, so each row uses the fixture model with 600 x 400 images. The rows for port 4310 and port 4311 are equal:

    | Viewport    | Footer top to bottom | Visible without scroll |
    | ----------- | -------------------- | ---------------------- |
    | 1440 x 900  | 954 to 994           | no                     |
    | 1440 x 1100 | 1066 to 1106         | no                     |
    | 1920 x 1200 | 1160 to 1200         | yes                    |
    | 2560 x 1440 | 1400 to 1440         | yes                    |

  - The `?` key does not open the help (`questionMarkOpensHelp: false`), and no help trigger exists outside the footer.
- Corrections:
  - The footer is below the fold on laptop viewports. It is visible on large monitors.
  - `screens/mock-run-dark-1440-scrolled-to-footer.png` shows "Recompare stored run" as an enabled button with no sentence. The auditor's mock model has no `recompareAllowed` field, so the client used its default `true` (`review-workspace.tsx:328`). With the fields that the server always sends, the button is disabled and the footer shows the sentence at 16 px, which is larger than all other chrome text. See `verify/screens/v-mock-run-footer-production-shape.png`. Footer text: `Shortcuts on Recompare stored run Server recomparison is retired. Capture a new complete run with trusted local Submit.`
  - A removal of the endpoint changes tested behavior. `api/api.test.ts:1621-1740`, `api/history-review.test.ts:222`, and `api/workflow-owned.test.ts:2227` assert the 409 codes. `docs/current-contract.md:33` and `:77` require that stored recomparison is rejected. They do not require the UI. The alternative "keep the endpoint as a fixed 409, remove only the UI" has no contract risk.

## SHELL-18 · One object has several names in the navigation, and the review guide names controls that do not exist

- Verdict: confirmed.
- Severity: low.
- Proof: each cited line has the quoted text (`review-workspace.tsx:545`, `:549`, `:552`, `:654`, `:728`, `:796`, `:1055`, `:1077`, `:1154`, `:1280`; `item-list.tsx:300`; `routes/index.tsx:433`, `:454`, `:502`; `components/operations-attention/index.tsx:253`, `:315`, `:321`, `:325`, `:343`). `docs/review-guide.md:15` ("The Runs page"), `:31-34` (four view names), `:92` ("All runs"). `rg "All runs" apps/web/src` has no match. `components/screenshot-viewer.tsx:38` gives the visible captions "Baseline" and "Current"; `:218` and `:229` give the labels "Reference" and "New image".
- Addition: `docs/review-guide.md:45` says "Choose **Approve** or **Reject**". The buttons say "Approve & next" and "Reject view".

## SHELL-19 · Shell parts are overridden with `!` classes, controls are hand-built where primitives exist, and two vendored components have no user

- Verdict: confirmed. Two contract decisions change how to read it.
- Severity: low.
- Proof:
  - Overrides at `review-workspace.tsx:557`, `:609`, `:623`, `:1175`. Hand-built controls at the cited lines. Four `ak.Dialog` uses at `:155-158`, `:1206-1211`, `:1223-1230`, `:1242-1248`.
  - The vendored folder has 13 component files. Upstream `packages/ariakit-ui/src/components` has 27.
  - `rg -o "ariakit/components/[a-z-]+\.ariakit"` outside the vendored folder finds `button`, `frame`, `popover`, `nav`, `text`, `shell`, `badge`, `table`, and `layer`. `kbd` and `tabs` have no user. The `TextFrame` component also has no direct user, but its recipe is used by `styles/control.ts:6`.
  - Upstream `app/src/sandbox/ariakit-ui-shell/index.react.tsx:171-173` is as described.
- Contract checks, which the auditor did not make:
  - `docs/current-contract.md:54`, rule D10: "Keep the component set, keyboard behavior, license, and source notice. No pruning or replacement is selected." So the two unused components are kept on purpose. An update of the vendored copy to current upstream changes this rule, so it needs the maintainer decision that the report asks for.
  - `docs/current-contract.md:144`, U03: "Use item links and variant tabs". The decision text says "URL-selected Ariakit tabs rendered as links through Tab.render". The code uses `Nav` and `NavLink` with `aria-current="page"` (`review-workspace.tsx:713-781`), and the vendored `Tabs` has no user. This is drift between the contract and the code.

## SHELL-20 · Visual details in the shell chrome

- Verdict: confirmed. Each item is a small fact. The weight of the list is a judgment.
- Severity: low.
- Proof:
  1. `verify-fixture.mjs`, section `shell20_details`: strip 96 to 122, details header 96 to 144. Screenshot `screens/mock-run-dark-1440-details-open.png`.
  2. `Accepted (1)` is 16 px; the item label is 12 px.
  3. `verify-extra.mjs`: run loading text at (336, 60); queue loading text at (160, 69). `shell.ts:721` has `content-start` on the body.
  4. `Sign in with GitHub` and `Retry` are 724 x 33 on the run page; `Review queue` is 592 x 33 on the pull page.
  5. `verify-real.mjs`: "Review queue" is 131.8 px when current (weight 500) and 130.0 px when not (weight 400).
  6. Screenshot `verify/screens/v-account-menu.png`: the current link has a filled pill and an underline bar.
  7. `apps/web/public/favicon.svg`: white "V" path on `#647cff`. The header uses the Lucide `Aperture` icon (`app-shell.tsx:30-32`).
  8. The same screenshot: the account popover covers "Refresh runs".

## SHELL-21 · Header controls are smaller than 24 px at a 390 px width, and shortcut letters show on touch layouts

- Verdict: confirmed.
- Severity: low.
- Proof: `verify-fixture.mjs`, section `shell06_bands_390`, `targets`: brand 19 x 23, nav links 33 x 33, account 29 x 29, "Queue" 68 x 23, previous and next 29 x 29. Visible button text: `Compare S`, `Difference D`, `Current F`, `Baseline G`, `Reject view X`, `Approve & next A`. Screenshot `screens/mock-run-dark-390.png`.
- Platform check: SC 2.5.8 requires 24 by 24 CSS pixels, with a spacing exception (<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>). The report states the exception correctly. `docs/review-guide.md:94` puts mobile outside the launch scope.
- Addition: in the same screenshot the fourth view button is cut at the right edge ("Baselin"). The group scrolls horizontally with no sign that more content exists.

## SHELL-22 · The sidebar preference script runs in the head of each page, but only a client-only route reads it

- Verdict: confirmed.
- Severity: low.
- Proof: `routes/__root.tsx:21-26`; `review/sidebar-preference.ts:3-8`; `review/review-workspace.tsx:202-206` (read) and `:227` (write); `routes/runs.$runId.tsx:31` (`ssr: false`). `rg "review-sidebar-open|reviewSidebarOpen" apps/web/src packages` finds only those lines. No CSS and no test reads the attribute. The script is in the 404 document too (`verify/nope.html`).
- Recommendation check: the workspace never renders on the server, so the initializer can read `localStorage`. The `typeof document === "undefined"` branch at `:204` cannot run.

## Screenshots

Auditor screenshots that I opened and compared with their captions (all in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-shell/screens/`):

- `mock-run-dark-1440-first-tab-stop.png`: correct. No visible focus after one Tab press.
- `mock-run-dark-1440-details-open.png`: correct. The details header ends at 144 px, the strip at 122 px.
- `mock-run-dark-1100-root-20px.png`: correct. No sidebar, no toggle, no dialog button.
- `mock-run-dark-1440-scrolled-to-footer.png`: not the production state. The recompare button is enabled, because the mock has no `recompareAllowed: false`.
- `run-dark-1440.png`: correct. In the real app the first image pixel is at about 449 px, because the preview note adds a row.
- `real-queue-to-run-1300ms-after-click.png`: correct. The pending page, with a header that has no repository and no account menu.
- `mock-queue-dark-1440-account-menu.png`: correct. It also shows two "Needs review" badges with different colors.
- `real-notfound-dark-1440.png`: correct. The text "Not Found" at the top left.
- `mock-run-missing-dark-1440.png`: correct. "The run was not found." with a full-width "Retry".
- `mock-run-dark-390.png`: correct. The image starts at 518 px. Shortcut letters show.
- `mock-run-guest-dark-1440.png`, `mock-pull-guest-dark-1440.png`, `mock-queue-guest-dark-1440.png`: correct. Three different sign-in designs.

New screenshots (all in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-shell/verify/screens/`):

- `v-mock-run-footer-production-shape.png`: run page scrolled to the end, with the fields that the server always sends. The recompare button is disabled and a 16 px sentence explains why.
- `v-run-1100-root-20-details-clicked.png`: 1100 px wide, 20 px root font, after a click on "Details". Nothing opens.
- `v-run-1030-classic-scrollbar.png`: 1030 px wide, default font, a scrollbar that takes 15 px. No sidebar, no toggle, no dialog button.
- `v-mock-run-dark-1440.png` and `v-mock-run-dark-390.png`: the pages that I measured for SHELL-06.
- `v-mock-run-details-open.png`: details panel open, for SHELL-20 item 1.
- `v-first-tab-stop.png`: after one Tab press, for SHELL-12.
- `v-account-menu.png`: account popover over "Refresh runs", and the current link with pill and bar.
- `v-real-run-1920x1200.png`: run page of the port 4310 app at 1920 x 1200, with mocked API answers. The footer is visible at the bottom. The recompare button is enabled here, because this mock also has no `recompareAllowed: false`.
- `v-real-notfound.png`: `/nope` on the real app.
- `v-gate-queue-guest.png`, `v-gate-queue-403.png`, `v-gate-queue-loading.png`, `v-gate-run-guest.png`, `v-gate-run-403.png`, `v-gate-run-404.png`, `v-gate-run-loading.png`, `v-gate-pull-guest.png`, `v-gate-pull-403.png`, `v-gate-pull-404.png`, `v-gate-pull-pending.png`, `v-gate-pull-no-check.png`: each gate state, for SHELL-14 and SHELL-08.

## Redesign ideas

The auditor's ideas R1 to R7 and C1 to C10 are design proposals. I did not try to refute taste. I checked their factual parts and found them correct (sidebar widths at `shell.ts:346-382`, header steps at `:179-183`, static footer at `:284-289`, three shell levels at `:36-38`, CSP `img-src 'self' data:` in the response headers).

The contract has recorded UI decisions that some ideas change. The maintainer said that the current patterns are not required, so these are notes, not objections:

| Idea                                             | Contract decision that it touches                        |
| ------------------------------------------------ | -------------------------------------------------------- |
| R1, R2, C4 (one context bar, facts in a popover) | In line with U02 ("one review shell", facts to Details). |
| R4 (no sidebar by default)                       | U02 names a sidebar for items.                           |
| R6 (items left and right, variants up and down)  | U04 and D10 ("keep … keyboard behavior").                |
| R6, R7 (variants as a segmented control or tabs) | In line with U03 ("variant tabs").                       |
| C7 (status line with `?`)                        | In line with U04 (page-wide shortcuts).                  |

Three more ideas come from this verification.

### V1 · One owner for the narrow layout

- What changes: CSS decides if the item list is a sidebar or a dialog. The dialog trigger is always rendered, and the same container query that hides the sidebar shows it. JavaScript reads the state from the shell element only when it must open the dialog.
- Why it is better: the two rules cannot disagree. It fixes the large-font case and the scrollbar case of SHELL-11 with one rule.
- Sketch:

  ```tsx
  <Button className="@5xl/shell:hidden" onClick={() => setItemsOpen(true)}>Screenshots</Button>
  <ShellSidebar $show="5xl" …>{itemNavigation}</ShellSidebar>
  // No matchMedia. The dialog renders the same list when it opens.
  ```

### V2 · Variant row that does not hold the keyboard

- What changes: the variant row is a real tab list (the vendored `Tabs`, as U03 selected) or a `Nav` whose links use `replace` and `resetScroll={false}`. A click on a variant returns focus to the workspace, or the page shortcuts stay active while focus is in the row.
- Why it is better: today a mouse click on a chip leaves focus in the row. Then A, X, S, D, F, G, the number keys, and `[` do nothing, and each arrow key adds a history entry (see SHELL-09 and "Missed" item 1).
- Sketch:

  ```text
  [ React Light ] [ Solid Light ] [ Dark ] …      <- click selects, focus goes back to the page
  A approve   X reject   D diff   1-6 variant     <- keys work at once
  Back                                            <- leaves the run (one entry for each run)
  ```

### V3 · Announce and focus the new page

- What changes: after a client navigation, focus moves to the `h1` (or to `main`) of the new page, and the title changes (SHELL-07).
- Why it is better: today focus falls to `body` and nothing is announced (see "Missed" item 5).
- Sketch:

  ```tsx
  // In the layout route of SHELL-16
  const pathname = useLocation({ select: (l) => l.pathname });
  useEffect(() => { mainRef.current?.focus({ preventScroll: true }); }, [pathname]);
  <ShellMain ref={mainRef} tabIndex={-1} aria-labelledby="page-title">
  ```

## Missed

Important items in this lane scope that the report does not have. Each has one line of proof.

1. Page shortcuts do not work while focus is on a variant chip, which is where a mouse click leaves it. `excludesShortcuts` lists `.review-variants` (`review-workspace.tsx:94-96`). `node verify/verify-chip-focus.mjs`: after a click on chip 2, `D`, `F`, and `[` change nothing; after a click in the image area, `D` works. The same exclusion blocks `A` and `X`. The contract decision U04 selects page-wide shortcuts.
2. Hashed assets have no long-lived cache rule. `apps/web/public` has only `favicon.svg`, so there is no `_headers` file. Workers Static Assets then send `Cache-Control: public, max-age=0, must-revalidate` (<https://developers.cloudflare.com/workers/static-assets/headers/>). Each full document load (SHELL-01) revalidates the stylesheet and each script chunk. Not measured against production.
3. Production payload, measured from the existing build (`node verify/dist-stats.mjs`): one render-blocking stylesheet of 464,666 bytes (60,125 gzip, 32,868 brotli) for all routes, and 747,759 bytes of script in all chunks (238,855 gzip), with a 319,611-byte entry chunk (101,315 gzip). The report states that these numbers are not known.
4. The contract decisions U02, U03, and P03 are not delivered in full: the image starts lower than the U02 "before" number (SHELL-06), variants are `Nav` links and not tabs (SHELL-19), and only the run route uses a loader (SHELL-02). The report cites none of them.
5. A client navigation drops keyboard focus to `body`, keeps the title, and announces nothing. `node verify/verify-focus-nav.mjs`: after Enter on "Review changes", on Back, and on "View history", `document.activeElement` is `BODY` and no live region has page text.
6. The item list and the details panel cannot be opened with the default font size on windows from 1024 px to 1038 px wide when the scrollbar takes space (details in SHELL-11).
7. The footer sentence for the disabled recompare button is unstyled 16 px text, larger than all other chrome text (`review-workspace.tsx:1199-1201`, screenshot `v-mock-run-footer-production-shape.png`).
8. The auditor's review mock omits fields that the server always sends (`recompareAllowed: false`, `recompareDisabledReason`), so screenshots of the workspace footer do not show the production state. Other lanes that reuse `capture.mjs` have the same gap.
9. On a 390 px viewport the view-mode group is cut at the right edge ("Baselin"), with no sign that it scrolls (`screens/mock-run-dark-390.png`).
10. `docs/review-evidence-plan.md:62` says the routes call `GET /api/me` before they load data. No route does (SHELL-15).
