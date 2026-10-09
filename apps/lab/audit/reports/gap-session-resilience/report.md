# Long-open tabs and failure recovery: deploy skew, expired sessions, state that changes under the page, and the error-to-screen matrix

Lane `gap-session-resilience`, finding prefix `RESIL`. Read-only audit. All paths are relative to the worktree root unless they start with `/`. The scratch directory is `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-session-resilience/` (called `SCRATCH` below).

Summary: 23 findings: 4 high, 14 medium, 5 low. Each scenario of the lane ran in Chrome through Playwright, on the real route tree. The server answers are mocks that copy the shapes in `apps/web/src/api`. No request went to `visonaut.com` or to GitHub.

The three facts that matter most:

1. After a new sign-in, an open review tab cannot save again. The only button that the page offers cannot repair this. A browser reload is the only fix (RESIL-01).
2. The page tells the user "You can close this window" for a queued decision. If that decision fails later, no screen shows it. A reload forgets each receipt (RESIL-03).
3. A newer push replaces the run under an open tab. The page finds out only when a save fails, uses four different sentences for the one cause, and has no link to the newer run (RESIL-05).

## How it works (map)

### Data and timers of each page

| Surface                  | First read                                                                                  | Later reads                                                                  | Timer                                        | Hidden tab                                  | Source                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Queue, History           | `GET /api/runs` on mount                                                                    | Only "Refresh runs" (blanks the page)                                        | None                                         | No change                                   | `apps/web/src/routes/index.tsx:176-210`, `:242-245`                                           |
| Bell, Service page       | `GET /api/operations` on mount, after the run list is ready                                 | Each 60 s, and "Refresh alerts"                                              | `setTimeout(load, 60000)`                    | Continues                                   | `apps/web/src/components/operations-attention/index.tsx:228-289`                              |
| Pull page                | `GET /api/pulls/:n?check=`                                                                  | Each 15 s while `pending`                                                    | `setTimeout(refresh, 15_000)`                | Pauses, then reads on return                | `apps/web/src/routes/pulls.$pullNumber.tsx:47-119`                                            |
| Run page (ready run)     | `GET /api/runs/:id` in the route loader                                                     | Never. No control in the normal state                                        | None                                         | No change                                   | `apps/web/src/routes/runs.$runId.tsx:31-47`                                                   |
| Run page (run not ready) | Same                                                                                        | `GET /api/runs/:id/state` each 2 s, then one model read                      | `schedule(2000)`                             | Pauses, then reads on return                | `apps/web/src/review/use-review-session.ts:185-258`                                           |
| Save                     | `POST /api/review-sessions` one time for the tab, then `POST /api/comparisons/:id/commands` | `GET /api/commands/:id/queued` each 500 ms for each queued command, no bound | `setTimeout(resolve, 500)` in a `while` loop | Continues (no visibility check in the loop) | `apps/web/src/review/client.ts:293-337`                                                       |
| Images                   | `<img>` requests                                                                            | Only "Retry images"                                                          | None                                         | No change                                   | `apps/web/src/components/screenshot-viewer.tsx:49-160`, `apps/web/src/review/use-evidence.ts` |

Facts that follow from the table:

- No code listens for `online`, `offline`, `focus`, or `pageshow`. `rg` finds only two `visibilitychange` listeners (pull page, state poll), one `storage` listener (sidebar), and one `beforeunload` listener.
- No code reads `error.code`, `Retry-After`, or `X-Retry-After` in the client. `review/client.ts:269-281` reads `error.message`, `error.reference`, and the HTTP status. `conflict` is `response.status === 409`.
- No client storage holds pending decisions. `localStorage` holds only the sidebar preference.
- The router has no `defaultErrorComponent`, and the root route has no `errorComponent` (`apps/web/src/router.tsx:7-9`, `apps/web/src/routes/__root.tsx:5-16`). Only the run route has one (`runs.$runId.tsx:49`).

### One decision, step by step

1. The user presses `A`. `use-review-session.ts:402-442` builds a command with a new `commandId` and the expected revisions.
2. `save()` (`:279-401`) puts the command in a queue in memory, shows the new verdict at once, and moves to the next pending variant.
3. `client.ts:295-303` creates the review session one time. The promise is kept for the life of the page object. It is reset only if the request fails.

   ```ts
   sessionPromise ??= request("/api/review-sessions", {})
     .then((session) => string(record(session).reviewSessionId))
     .catch((error: unknown) => {
       sessionPromise = undefined;
       throw error;
     });
   ```

4. `POST …/commands` answers 202 `{ queued: true }`. The bar shows "1 queued on server. You can close this window." (`review-workspace.tsx:1112-1114`). The `beforeunload` prompt is now off (`use-review-session.ts:175-184`).
5. The client polls `GET /api/commands/:id/queued` each 500 ms until the answer is not `queued`.
6. Success: the bar shows "1 variant approved. Saved." Failure: `reportError` (`:260-278`) shows "Conflict. …" for each 409 and "Not saved. …" for all other errors. If the command was admitted and the error is not a 409, the text is replaced by "Could not confirm the queued decisions. The server will continue processing them. Retry to check their status." (`:380-388`).
7. Recovery controls exist only in the error and conflict states: "Retry same command", "Retry Undo", "Refresh current state" (`review-workspace.tsx:1115-1134`).

The server binds a review session to one auth session (`apps/web/src/api/review.ts:619-635`). A new sign-in creates a new auth session, so the old review session answers `409 review_session_expired`.

### Deploy skew path

1. The route components are separate chunks. The build in `apps/web/dist/client/assets` has `routes-*.js` (queue), `pulls._pullNumber-*.js`, `runs._runId-QUJlDVZ1.js` (run page), and `runs._runId-6tHAE8eb.js` (the run route's error component, 941 bytes).
2. In-app navigation that loads a new chunk: queue or history to a run (`<Link>`), pull page to a run (`navigate`), pull page to the queue (`<Link>`). All header links and the "Queue" button are plain anchors and load a new document.
3. A failed chunk import reaches `lazyRouteComponent` of TanStack Router (`@tanstack/react-router/src/lazyRouteComponent.tsx:52-71`). If the message starts with "Failed to fetch dynamically imported module", the router reloads the document one time for each failed URL. It stores `tanstack_router_reload:<message>` in `sessionStorage`. A second failure of the same URL is thrown to the nearest error boundary.
4. The run route's error component is a lazy chunk too. The index and pull routes have none. So a chunk that stays missing ends in the router's default error screen.

### Error-to-screen matrix

Method: `SCRATCH/s08-matrix.mjs` loads each surface on `route-fixture.html`, answers one endpoint with one error, drives the surface, and records the headings, the alert text, the bar text, the enabled controls, the focus, and each live-region change. 139 cells ran (`SCRATCH/s08-matrix.json`, `s08-matrix.out.txt`). The verdict in each cell is my judgment of the measured text.

Legend for verdicts: `ok` = the text matches the cause. `wrong` = the text names a different cause. `dead` = no offered control leads to recovery, or the needed action (sign in, reload, switch account, open another URL) is not offered. `silent` = the screen changes and no text or announcement says why. `raw` = the browser's own error text. `no ref` = the server sent a reference and the screen drops it. `(n/r)` = the server cannot send this answer to this surface in a normal flow; the code shows the measured fallback. `–` = not applicable.

| Server answer or client failure                        | Queue               | History             | Service page     | Bell             | Pull page           | Run load         | Save             | Undo             | Receipt poll     | State poll    | Image            |
| ------------------------------------------------------ | ------------------- | ------------------- | ---------------- | ---------------- | ------------------- | ---------------- | ---------------- | ---------------- | ---------------- | ------------- | ---------------- |
| 400 `invalid_body`, `invalid_id`                       | D1 (n/r)            | D1 (n/r)            | O1 (n/r)         | O1 (n/r)         | P1 (n/r)            | L1 · ok, dead    | N1 · ok, dead    | N1 · ok, dead    | R1 (n/r)         | T1 (n/r)      | –                |
| 401 `sign_in_required`                                 | G1 · ok, silent     | G1 · ok, silent     | G1 · ok, silent  | G1 · ok, silent  | G2 · ok, silent     | G3 · ok          | N1 · ok, dead    | N1 · ok, dead    | R1 · wrong, dead | T1 · ok, dead | –                |
| 403 `not_maintainer`                                   | F1 · ok             | F1 · ok             | F1 · ok          | F1 · ok          | F2 · ok             | F3 · ok          | N1 · ok          | N1 · ok          | R1 · wrong       | T1 · ok       | –                |
| 403 `invalid_identity`                                 | F1 · wrong          | F1 · wrong          | F1 · wrong       | F1 · wrong       | F2 · wrong          | F3 · wrong, dead | N1 · ok, dead    | N1 · ok, dead    | R1 · wrong       | T1 · ok, dead | –                |
| 403 `wrong_origin`                                     | F1 · wrong, dead    | F1 · wrong, dead    | F1 · wrong, dead | F1 · wrong, dead | F2 · wrong, dead    | F3 · wrong, dead | N1 (n/r)         | N1 (n/r)         | R1 (n/r)         | T1 (n/r)      | –                |
| 404 `not_found`                                        | D1 (n/r)            | D1 (n/r)            | O1 (n/r)         | O1 (n/r)         | P2 · ok, dead       | L1 · ok, dead    | N1 (n/r)         | N1 · ok, dead    | R1 · wrong       | T1 (n/r)      | –                |
| 409 `incomplete` (record missing)                      | D1 · wrong          | D1 · wrong          | O1 (n/r)         | O1 (n/r)         | P1 (n/r)            | L1 · ok, dead    | C1 (n/r)         | C1 (n/r)         | C1 (n/r)         | T1 (n/r)      | –                |
| 409 `conflict` with model                              | –                   | –                   | –                | –                | –                   | –                | C1 · ok          | C1 · ok          | C1 · ok          | –             | –                |
| 409 `review_session_expired`                           | –                   | –                   | –                | –                | –                   | –                | C1 · wrong, dead | C1 · wrong, dead | –                | –             | –                |
| 409 `history_closed`                                   | –                   | –                   | –                | –                | –                   | –                | C1 · wrong       | C1 · wrong       | –                | –             | –                |
| 503 `service_unavailable`, reference, `Retry-After: 1` | D1 · ok, no ref     | D1 · ok, no ref     | O1 · ok, no ref  | O1 · ok, no ref  | P1 · ok, no ref     | L1 · ok          | N1 · ok          | N1 · ok          | R1 · ok          | T1 · ok       | –                |
| 503 `github_unavailable`, `Retry-After: 1`             | D1 · ok             | D1 · ok             | O1 · ok          | O1 · ok          | P1 · ok             | L1 · ok          | N1 · ok          | N1 · ok          | R1 · ok          | T1 · ok       | –                |
| 5xx that is not JSON (502 HTML, maintenance 503 text)  | D1 · ok             | D1 · ok             | O1 · ok          | O1 · ok          | P1 · ok             | L2 · wrong       | N2 · wrong       | N2 · wrong       | R1 · ok          | T1 · wrong    | –                |
| Network error (`fetch` rejects)                        | D2 · ok, raw        | D2 · ok, raw        | O2 · ok, raw     | O2 · ok, raw     | P3 · ok, raw        | L3 · ok, raw     | N3 · ok, raw     | N3 · ok, raw     | R1 · ok          | T1 · ok, raw  | –                |
| 200 with an unknown shape (newer API format)           | D3 · ok, dead       | D3 · ok, dead       | O3 · ok, dead    | O3 · ok, dead    | P4 · ok, dead       | L4 · ok, dead    | N4 · wrong, dead | N4 · wrong, dead | R1 · wrong, dead | T1 · ok, dead | –                |
| Image request fails: offline                           | –                   | –                   | –                | –                | –                   | –                | –                | –                | –                | –             | I1 · ok          |
| Image request fails: HTTP 404                          | –                   | –                   | –                | –                | –                   | –                | –                | –                | –                | –             | I1 · wrong, dead |
| Image has other dimensions                             | –                   | –                   | –                | –                | –                   | –                | –                | –                | –                | –             | I2 · ok, dead    |
| Image decode fails (derived, not run)                  | –                   | –                   | –                | –                | –                   | –                | –                | –                | –                | –             | I3 · ok          |
| Route chunk missing one time (after a deploy)          | reload · ok, silent | reload · ok, silent | –                | –                | reload · ok, silent | –                | –                | –                | –                | –             | –                |
| Route chunk still missing after the reload             | X1 · wrong, dead    | X1 · wrong, dead    | –                | –                | X1 · wrong, dead    | –                | –                | –                | –                | –             | –                |
| Route chunk request fails: offline                     | browser page · dead | browser page · dead | –                | –                | browser page · dead | –                | –                | –                | –                | –             | –                |
| Request aborted by navigation (derived, not run)       | none · ok           | none · ok           | none · ok        | none · ok        | none · ok           | none · ok        | –                | –                | none · ok        | none · ok     | –                |

Count for the 15 HTTP and payload rows: 103 realistic cells. 35 are fully correct. 29 name the wrong cause. 33 have no way forward. 5 are silent. 24 more cells are `(n/r)`.

The auth endpoints have their own row set (measured, see RESIL-19 and RESIL-20):

| Answer                                                               | Dashboard sign-in                                   | Pull page sign-in      | Run page sign-in | Account menu sign-out |
| -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------- | ---------------- | --------------------- |
| 429 from `/api/auth/sign-in/social` or `/sign-out` (`X-Retry-After`) | A1 · wrong (no wait named)                          | A2 · wrong, extra step | A1 · wrong       | A3 · wrong            |
| 403 on a wrong origin (derived for sign-in; run for sign-out)        | A1                                                  | A2                     | A1               | A3 · wrong, dead      |
| GitHub answers an error to the callback                              | Better Auth page, or `/` with no message (RESIL-19) | Same                   | Same             | –                     |

Screen codes (exact text, then the controls):

| Code | Heading and text                                                                                                                              | Controls                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| G1   | The landing page: "Every change. A clear decision." / "Review visual changes."                                                                | Sign in with GitHub                                                                               |
| G2   | "Sign in to review pull request #7"                                                                                                           | Sign in with GitHub                                                                               |
| G3   | "Sign in to review this run" / "This review is available to Ariakit maintainers."                                                             | Sign in with GitHub                                                                               |
| F1   | "Repository access required" / "Your repository access changed. Write access to this repository is required."                                 | Retry, Use another account                                                                        |
| F2   | "Repository access required" / "Write access to this repository is required to open its review."                                              | Use another account (no Retry)                                                                    |
| F3   | "This run could not be opened" / "Write access to this repository is required to open this run."                                              | Retry (no account control, no account menu)                                                       |
| D1   | "The review queue could not be loaded" / "The run list is temporarily unavailable. Please retry."                                             | Retry                                                                                             |
| D2   | Same heading / "Failed to fetch"                                                                                                              | Retry                                                                                             |
| D3   | Same heading / "The run list could not be read. Retry loading the page."                                                                      | Retry (reads again, does not reload)                                                              |
| O1   | "Operation alerts are temporarily unavailable. The current alert state is unknown." Bell label: "Service attention: alert status unavailable" | Retry alerts                                                                                      |
| O2   | "Failed to fetch The current alert state is unknown."                                                                                         | Retry alerts                                                                                      |
| O3   | "Operation alerts could not be read. Retry loading them. The current alert state is unknown."                                                 | Retry alerts                                                                                      |
| P1   | "Review unavailable" / "The pull request could not be loaded. Please retry."                                                                  | Retry                                                                                             |
| P2   | "Review unavailable" / "This Visonaut check was not found. Open the latest check on GitHub."                                                  | Retry (no GitHub link)                                                                            |
| P3   | "Review unavailable" / "Failed to fetch"                                                                                                      | Retry                                                                                             |
| P4   | "Review unavailable" / "Invalid response."                                                                                                    | Retry                                                                                             |
| L1   | "This run could not be opened" / the server message, plus " Reference: <id>." if present                                                      | Retry                                                                                             |
| L2   | Same heading / "The service did not return review data. Check your connection and refresh."                                                   | Retry                                                                                             |
| L3   | Same heading / "Failed to fetch"                                                                                                              | Retry                                                                                             |
| L4   | Same heading / "This review format has changed. Refresh before reviewing."                                                                    | Retry                                                                                             |
| N1   | Bar: "Not saved. " + the server message + reference                                                                                           | Retry same command (or Retry Undo), Refresh current state. Approve, Reject, and Undo are disabled |
| N2   | Bar: "Not saved. The service did not return review data. Check your connection and refresh."                                                  | Same as N1                                                                                        |
| N3   | Bar: "Not saved. Failed to fetch"                                                                                                             | Same as N1                                                                                        |
| N4   | Bar: "Not saved. The service returned an invalid text field." (or "… an invalid response. Refresh before reviewing.")                         | Same as N1                                                                                        |
| C1   | Bar: "Conflict. " + the server message + " Updated by <numeric id>." if present                                                               | Refresh current state. Approve and Reject stay enabled                                            |
| R1   | Bar: "Could not confirm the queued decisions. The server will continue processing them. Retry to check their status." + reference             | Retry same command (sends the POST again), Refresh current state                                  |
| T1   | Bar, `role="status"`, gray: "Waiting for the new comparison. " + the error message                                                            | None. The poll runs again after 2 s                                                               |
| I1   | "Image evidence unavailable" / "The image could not be loaded. Check your connection and retry." Each pane: "Image could not be verified."    | Retry images. Approve and Reject are disabled                                                     |
| I2   | "Comparison evidence incomplete" / "The image dimensions do not match this comparison."                                                       | None (`recompareAllowed` is always `false`, `api/review.ts:592`)                                  |
| I3   | "Image evidence unavailable" / "The image could not be decoded. Retry loading the evidence."                                                  | Retry images                                                                                      |
| X1   | No app shell. "Something went wrong!" / [Hide Error] / red monospace "Failed to fetch dynamically imported module: <module URL>"              | Hide Error only                                                                                   |
| A1   | "Sign-in could not start. Please try again."                                                                                                  | Sign in with GitHub (enabled at once)                                                             |
| A2   | The card changes to "Review unavailable" / "Sign-in could not start. Please retry."                                                           | Retry (reads the pull request again, then shows the sign-in card)                                 |
| A3   | Account popover: "Sign-out failed. Please try again."                                                                                         | Sign out                                                                                          |

## Findings

Raw results for each "Measured: yes" are in `SCRATCH/*.json` and are quoted in "Measurements". Related findings of earlier lanes are named so that the maintainer can join them.

### RESIL-01 · After a new sign-in, an open review tab cannot save again, and "Refresh current state" cannot repair it

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/client.ts:293-303`: `sessionPromise ??= request("/api/review-sessions", {})…`. The promise is cleared only in its own `.catch`.
  - `apps/web/src/review/client.ts:349-351`: `async refresh() { return parseReviewModel(await request(selectedPath())); }`. It does not touch the session.
  - `apps/web/src/api/review.ts:619-635`: the row must match `auth_session_id = ?`. If not: `SecurityError("review_session_expired", 409, "Start a new review session after signing in.")`.
  - `apps/web/src/review/client.ts:275`: `conflict: response.status === 409`. `use-review-session.ts:272-276`: a conflict drops `failed`, so "Retry same command" is not rendered.
  - Run `SCRATCH/s02-session.mjs`, scenario 2b: 1 `POST /api/review-sessions` in total; `reviewSessionId` of each command is `session-1`; three cycles of "Refresh current state" then Approve give the same alert each time.
- What happens: a maintainer has a review tab open. The auth session changes (sign-out and sign-in in another tab, "Use another account", a restore that clears sessions, or 7 days with no request). The next Approve shows `Conflict. Start a new review session after signing in.` and one button, "Refresh current state". That button reads the model and shows "Current state loaded. Check the evidence before saving a new command." The next Approve fails in the same way, without end. Only a browser reload creates a new review session. Undo has the same fault, and the Undo history entry is removed (`use-review-session.ts:473-475`).
- Impact: the review cannot continue, and the page gives an instruction ("Start a new review session") that has no control. The label "Conflict." names the wrong cause. The decision that the user made is dropped from the screen.
- Recommendation: treat `review_session_expired` as a session fault, not as a conflict. Clear the session, create a new one, and send the same command one more time.

  ```ts
  // client.ts, in save() and undo()
  try {
    return await send(await reviewSession());
  } catch (error) {
    if (!(error instanceof ReviewCommandError) || error.code !== "review_session_expired")
      throw error;
    sessionPromise = undefined; // the old session belongs to an older sign-in
    return await send(await reviewSession()); // same commandId, so the retry is safe
  }
  ```

  This needs `code` on `ReviewCommandError` (see RESIL-08).

- Alternatives: (a) minimal: clear `sessionPromise` in `refresh()`, so the existing button works. (b) create the review session for each command and remove the cached promise. This costs one more request for each decision. (c) remove the review-session concept and bind commands to the auth session on the server. This changes the contract ("predecessor ordering within the same actor/session/comparison").
- Maintainer decision needed: yes. Is an automatic new review session acceptable, or must the user confirm it because Undo is limited to "your saved command in this review session"?

### RESIL-02 · An expired session during a review shows "Not saved. Sign in with GitHub." with no way to sign in, and "Refresh current state" then drops the decision

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Run `s02-session.mjs`, scenario 2a. After Approve with a 401: alert `Not saved. Sign in with GitHub.`, controls "Retry same command" and "Refresh current state". "Sign in with GitHub." is the server message (`packages/security/src/authorization.ts:38`). It is plain text, not a control.
  - The same run, step 3: after "Refresh current state" with the session still expired, the alert is `Not saved. Sign in with GitHub.` and the only control is "Refresh current state". `use-review-session.ts:484-488` clears the queue before the read (`session.queue = []; setPendingReviews([])`), and `:502` calls `reportError(error)` with no command.
  - `review-workspace.tsx:1031-1097`: Approve, Reject, Undo, and "All N changed views…" are disabled while `saveState.status === "error"`.
  - `apps/web/src/components/user-menu.tsx:70-77`: the account menu has only "Sign out".
  - Screens: `screens/02a-save-401-review-session-dark.png`, `screens/02a-save-401-after-refresh-dark.png`.
- What happens: the session ends while the user reviews. The bar shows small gray text. Retry gives the same text. If the user presses "Refresh current state", the held decision is gone, each review control is disabled, and the page still has no sign-in control. The user must find out alone that a new tab, a sign-in there, and a return to this tab are necessary. After that, see RESIL-01.
- Impact: lost work (the held decisions) and a dead end in the main flow. The receipt poll hides the cause fully: a 401 there shows "Could not confirm the queued decisions. The server will continue processing them." (`screens/02c-receipt-poll-401-dark.png`).
- Recommendation: one "session ended" state for the workspace. Keep the held commands. Offer "Sign in again" in place (a popup or a new tab that posts back), then send the held commands with a new review session. See redesign idea 4.

  ```ts
  if (error.status === 401) {
    setSaveState({ status: "signed-out", held: session.queue.map((entry) => entry.command) });
    return; // do not clear the queue, do not offer "Refresh current state"
  }
  ```

- Alternatives: (a) minimal: on 401, show a "Sign in again" link that opens `/` in a new tab, and do not clear the queue in `refresh()` when the read fails. (b) redirect to the sign-in flow with a `callbackURL` to the same item and variant, and store the held commands in `sessionStorage` for the return. (c) keep the present flow and only change the copy. This leaves the dead end.
- Maintainer decision needed: yes. Popup sign-in in place, or a full redirect with stored commands?

### RESIL-03 · The page says "You can close this window", but a queued decision that fails later is never shown, and a reload forgets each receipt

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `review-workspace.tsx:1113`: `` `${queuedCount} queued on server.${sendingCount ? "" : " You can close this window."}` ``.
  - `docs/current-contract.md:196`: "Admitted commands survive its closure, and failed commands remain visible through their receipts."
  - The receipt read needs the command ID: `apps/web/src/api/review.ts:799-836` (`/api/commands/:id/queued`). No route lists the receipts of a user. The client keeps the IDs only in React state and in a `useRef` (`use-review-session.ts:123-132`).
  - Run `SCRATCH/s07-network.mjs`, scenario 10c: a decision is queued, the tab closes, another reviewer changes the variant, the queued command becomes stale. On return the page makes one request (`GET /api/runs/run-42`), the bar is empty, and there is no alert. The variant shows the other reviewer's verdict.
  - Same script, scenario 10: three decisions are queued, then the page reloads. No `beforeunload` prompt (by design, `use-review-session.ts:177`). After the reload the three variants show "Needs review" and no pending mark (`screens/10-after-reload-queued-decisions-not-shown-dark.png`).
- What happens: the queue is durable on the server, but the user's view of it lives only in the open tab. After a close or a reload, a pending decision looks like "no decision", and a failed decision leaves no trace.
- Impact: a maintainer believes that a decision is saved because the page said that the window can be closed. The run then stays in "needs review", or holds another person's verdict, with no notice. After a reload the user decides the same variants again; the second command then conflicts with the first one (derived from the revision check in `packages/service/src/review-commands.ts:190`).
- Recommendation: make receipts a server-backed list for the actor and the run, and show it. For example `GET /api/runs/:id/receipts` returns the actor's queued and failed commands. The model can also mark each variant that has a queued command. The page then shows "3 decisions pending" and "1 decision was not applied" after any load. See redesign idea 7.
- Alternatives: (a) minimal: store `{ runId, commandId, selection, verdict }` in `sessionStorage` or `localStorage` at admission, read the receipts on load, and remove each entry when it is final. This covers reload and return in the same browser. (b) remove "You can close this window." and keep the `beforeunload` prompt until each receipt is final. This is honest but removes the feature. (c) change the contract sentence to say that receipts are visible only while the tab is open.
- Maintainer decision needed: yes. Is the contract sentence a requirement for the UI (then a list endpoint or client storage is necessary), or only for the server data?

### RESIL-04 · A queued decision that never completes shows the same line without end, and each queued decision polls 2 times each second with no bound

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/client.ts:326-336`: `while (result.queued === true) { …; await new Promise((resolve) => setTimeout(resolve, 500)); result = record(await request(…/queued…)); }`. No counter, no backoff, no visibility check.
  - Run `s07-network.mjs`, scenario 9: after 30 s of real time the bar is `1 queued on server. You can close this window.` and 60 receipt requests were sent. After 5 minutes of page time the bar has the same text and 600 requests were sent. With 3 queued decisions, 6 requests go out in 1.2 s. Screen: `screens/09-receipt-never-completes-5min-dark.png`.
  - Undo is disabled for the whole time (`review-workspace.tsx:1033`, `busy`).
- What happens: if the operations consumer is slow or stopped, the page does not say so. It gives no elapsed time, no "this takes longer than usual", and no link to Service status. The tab sends 2 authenticated requests each second for each queued command for as long as it is open, also when it is hidden.
- Impact: the user cannot tell "slow" from "stuck". The request load grows with the number of open tabs and queued commands, at the moment when the service is already in trouble.
- Recommendation: one poll loop for all queued commands of the page, with backoff (for example 0.5 s, 1 s, 2 s, then 5 s), a pause while the tab is hidden, and a state change after a limit: "Still queued after 30 s. The server keeps it. Open Service status." Keep Undo disabled only for the commands that are still queued.
- Alternatives: (a) minimal: add backoff and the visibility pause, no new copy. (b) return all receipts of the run in one request (see RESIL-03) and poll that. (c) push the result with a server-sent event stream; this is a larger change on Workers.
- Maintainer decision needed: no.

### RESIL-05 · A newer push replaces the run under an open tab: the page finds out only when a save fails, uses four sentences for one cause, and has no link to the newer run

- Kind: ux
- Severity: high. Confidence: high. Measured: yes (the 409 text is taken from `packages/service/src/review-commands.ts:211`; the model flags from `api/review.ts:577-598`). Effort: M
- Evidence:
  - Run `SCRATCH/s04-state-changes.mjs`, scenario 4a. 3 s after the run is superseded: 0 requests, the page still shows "Needs review" and an enabled Approve.
  - After Approve, the screen has these texts at the same time (`screens/04a-superseded-during-review-dark.png`):
    - header, 10 px gray: `A newer attempt is active` (`use-review-session.ts:73-74`)
    - plain line above the variants: `This run is archived. Decisions show the state at archive time and are read-only.` (`api/review.ts:98`)
    - above the images: `Comparison superseded` `A newer attempt replaced this comparison. Its evidence cannot be reviewed.` (`review-workspace.tsx:134-137`, `:957-958`)
    - bar: `Conflict. Only the active complete comparison can be reviewed.` + "Refresh current state"
    - The queue calls the same state `Replaced by a newer run` (`routes/index.tsx:138`).
  - Links to a run on that screen: only `/runs/run-42`, the run itself. `ReviewModel` (`apps/web/src/review/model.ts:68-95`) has no field for the newer run.
  - "Refresh current state" then shows `Current state loaded. Check the evidence before saving a new command.` on a run that accepts no command (`use-review-session.ts:498`, `screens/04a-superseded-after-refresh-dark.png`).
  - "Approve & next" is disabled but keeps its brand fill (measured colors in `s04-state-changes.json`; this is WORK-06).
  - Queue: the stale list still shows the run as "Needs review" with "Review changes" (scenario 4b). History shows two rows with the same title, one "Needs review" and one "Replaced by a newer run", with no link between them (`screens/04c-history-with-superseded-run-dark.png`).
  - Pull page, derived: the check ID in the URL holds the commit (`visonaut:pre:<sha>`, `api/review.ts:739-771`). An old link from GitHub therefore opens the old, replaced run.
- What happens: pushes to a pull request are frequent. A reviewer who opened the run before the push reads images that no longer count. The first save fails with "Conflict.". The page then says in four ways that the run is over and does not say where the current run is.
- Impact: wasted review time on each push, and no direct path to the work that needs the decision. "Its evidence cannot be reviewed." stands above images that are fully visible, which reads as a fault.
- Recommendation: (1) the server adds the successor to the model and to the state answer, for example `supersededBy: { runId, attempt, testedSha }`. (2) The page checks the cheap state endpoint on `visibilitychange` and each 30 to 60 s while visible. (3) One banner replaces the four texts and the decision bar: "A newer run replaced this one. Open run 3." See redesign idea 2.

  ```tsx
  {
    model.run.status === "superseded" && <NewerRunBanner to={model.supersededBy} />;
  }
  ```

- Alternatives: (a) minimal: no new field; the banner links to the pull request page or to the queue ("Open the review queue"), and the four texts become one. (b) redirect to the newer run automatically when the user has made no decision in this tab. (c) keep the page as it is and only poll, so that the user learns earlier.
- Maintainer decision needed: yes. May a run page move the user to the newer run by itself, or must it always ask?

### RESIL-06 · Decisions of another reviewer or another tab appear only after a failed save, and the conflict names the person by a numeric ID

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Run `s04-state-changes.mjs`, scenario 5: 2.5 s after another reviewer decided two variants, the open page still shows "Needs review" for both. After Approve: `Conflict. A target changed or belongs to another comparison. Updated by 5550002.` (`screens/05-other-reviewer-conflict-dark.png`).
  - The reviewer value is the GitHub user ID: `api/review.ts:500` `reviewer: effective.actor_id`, `:902` `reviewer: context.identity.githubUserId`. The client prints it as it is (`use-review-session.ts:270-271`).
  - The 409 body carries the current model, and the page applies it at once (`:265-268`). So the chips already show "Rejected" and "Approved" when the alert appears. "Refresh current state" then sends one more `GET` and changes only the bar text.
  - Scenario 6, two tabs of one user: tab 2 gets `… Updated by 5550001.`, which is the user's own ID. Tab 1 never shows the decision that tab 2 saved.
  - In the conflict state Approve and Reject stay enabled, so the user can overwrite the other verdict with the next key press. The alert does not say which verdict the other person gave.
- What happens: the page has no read between load and save. The first sign of another reviewer is an error on the user's own decision. The error says "A target changed or belongs to another comparison", gives a number, and offers a button that does nothing visible.
- Impact: two maintainers who review the same run work against each other without knowing. The message does not help to decide between "they already approved, move on" and "they rejected, look again".
- Recommendation: say what happened in terms of the variant: "@octocat rejected this variant 2 minutes ago. Your approval was not applied." with "Keep their decision" (clear the alert and move on) and "Decide again". Send the login with the model, not the numeric ID. Hide "Refresh current state" when the 409 already carried the model. Use the state poll of RESIL-05 to show other reviewers' decisions before a save.
- Alternatives: (a) minimal: map the ID to a login on the server and change the sentence. (b) treat "same verdict by another person" as success and do not show a conflict. (c) share saved decisions between the tabs of one browser with a `BroadcastChannel`.
- Maintainer decision needed: yes. If the other reviewer gave the same verdict, is that a conflict or a success?

### RESIL-07 · A ready run page never reads again and has no refresh control; the queue never updates; no surface shows the age of its data

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/routes/runs.$runId.tsx:34-36`: `loaderDeps: ({ search }) => ({ comparison: search.comparison }), gcTime: 0, staleTime: Infinity`.
  - "Refresh current state" is rendered only in the error and conflict states (`review-workspace.tsx:1130-1134`).
  - Run `s07-network.mjs`, scenario 12: a dashboard that is hidden for 10 minutes sends 10 requests to `/api/operations` and 0 to `/api/runs`. After it becomes visible again: 0 more requests. No text on the page says when the list was read (`ageTextOnScreen: null`). Dates are absolute ("Oct 5, 2026, 2:00 PM").
  - A run page that waits for a comparison behaves well: 5 state polls in 10 s while visible, 0 in 10 minutes while hidden, and 1 state poll plus 1 model read at once on return.
- What happens: the service alerts stay fresh in a tab that nobody looks at, and the run list, which is the main content, stays as old as the tab. The bell popover has "Last checked <time>"; the queue has nothing.
- Impact: a maintainer who returns to a tab after lunch sees a queue that can be hours old with no sign of age. This is the cause behind RESIL-05 and RESIL-06, and DASH-19 for the queue.
- Recommendation: one freshness rule for all surfaces: read again when the tab becomes visible and the data is older than N seconds; stop timers while hidden; show "Updated 4 min ago" beside a refresh control that does not blank the page. See redesign idea 6.
- Alternatives: (a) minimal: add the `visibilitychange` read to the queue and a small "Refresh" control to the run page header. (b) adopt TanStack Query (or router loaders with `staleTime` and `refetchOnWindowFocus`) for all reads. (c) no automatic reads; only add the age text.
- Maintainer decision needed: no.

### RESIL-08 · The client ignores `error.code`: each 409 is "Conflict", each 403 is "write access", each other error is "Not saved" or "temporarily unavailable"

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `review/client.ts:269-281` builds the error from `error.message`, `error.reference`, and `response.status`. `routes/index.tsx:185-196` and `routes/pulls.$pullNumber.tsx:59-73` look only at the status and use fixed texts.
  - Matrix: of 103 realistic cells, 29 name the wrong cause and 33 have no way forward. Examples, all measured:
    - `409 review_session_expired` shows "Conflict. Start a new review session after signing in." (RESIL-01).
    - `409 history_closed` shows "Conflict. Command replay has ended. The permanent decision summary remains available."
    - `403 wrong_origin` and `403 invalid_identity` show "Your repository access changed. Write access to this repository is required." on the dashboard (RESIL-09).
    - A 401, 403, or 404 from the receipt poll shows "Could not confirm the queued decisions. The server will continue processing them." For the 404 ("The queued decision was not found.") the sentence is false.
    - A failed read through "Refresh current state" shows "Not saved. …" although nothing was sent to save.
  - The dashboard drops the server message and the reference of each error (D1). The run page prints the server message as it is (L1).
- What happens: the server sends a specific code for each state (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/api/errors.result.json`). Three client call sites each map the status in a different way, and none uses the code.
- Impact: the text on screen is often about another problem, and the offered action follows the text, not the cause.
- Recommendation: one function maps `(status, code)` to `{ kind, title, text, action }`. All surfaces render its result with one error component (redesign idea 5).

  ```ts
  type Recovery =
    | "retry"
    | "sign-in"
    | "switch-account"
    | "reload-page"
    | "open-queue"
    | "open-newer-run"
    | "none";
  function describeError(error: ApiError): {
    kind: string;
    title: string;
    text: string;
    recovery: Recovery;
  } {
    switch (error.code) {
      case "sign_in_required":
        return { kind: "signed-out", /* … */ recovery: "sign-in" };
      case "review_session_expired":
        return { kind: "signed-out", /* … */ recovery: "retry" };
      case "not_maintainer":
        return { kind: "no-access", /* … */ recovery: "switch-account" };
      case "wrong_origin":
        return { kind: "wrong-address", /* … */ recovery: "none" };
      case "incomplete":
      case "not_found":
        return { kind: "not-found", /* … */ recovery: "open-queue" };
      // …
    }
  }
  ```

- Alternatives: (a) minimal: add `code` to `ReviewCommandError` and fix only the worst rows (`review_session_expired`, `incomplete`, `wrong_origin`). (b) change the server statuses so that the status alone is enough (404 for a missing run, 401 for an expired review session). `docs/current-contract.md:83` says that known responses "keep their current status, message, and retry semantics", so this needs a contract change.
- Maintainer decision needed: yes. Client mapping by code (no contract change) or new statuses on the server?

### RESIL-09 · The three "no access" screens differ, and two are dead ends

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence (run `s04-state-changes.mjs`, scenario 3, and the matrix):
  - Dashboard (F1): "Retry" and "Use another account". Pull page (F2): only "Use another account" (`pulls.$pullNumber.tsx:216-233`). Run page (F3): only "Retry", and the header has no account menu because `RunError` renders `AppHeader` with no `end` (`runs.$runId.tsx:55-63`, `:76-111`). Screens: `screens/03-dashboard-403-wrong-origin-dark.png`, `screens/03-pull-page-403-invalid-identity-dark.png`, `screens/03-run-page-403-invalid-identity-dark.png`.
  - Wrong origin: "Use another account" calls sign-out, which also answers 403 (`apps/web/src/server.ts:82-84`). The account popover opens by itself with "Sign-out failed. Please try again." and focus moves to "Sign out" there. "Retry" gives the same screen (`screens/03-dashboard-403-use-another-account-fails-dark.png`).
  - A background 403 on the dashboard (the 60 s alerts poll) replaces the queue with F1 and announces the alert text. The run list is removed from the screen.
- What happens: a user with the wrong account who opens a run link cannot sign out from that page. A user on a non-canonical host (AUTH-10 says that production also answers on `workers.dev`) is told that write access is missing and is offered an action that fails.
- Impact: dead ends on the entry path from GitHub. This extends SHELL-14, which lists the three copies.
- Recommendation: one access screen with the same three parts on each route: who is signed in, why access failed (by code), and the valid action. For `wrong_origin`: "Open Visonaut at <canonical origin>" as a link, no account action.
- Alternatives: (a) minimal: add "Use another account" and the account menu to the run error screen, and "Retry" to the pull page. (b) redirect a wrong origin to the canonical origin in the Worker, so that this state cannot reach the UI.
- Maintainer decision needed: no.

### RESIL-10 · When a background poll gets a 401, the dashboard silently becomes the public landing page

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `routes/index.tsx:165-174`: `onAccessDenied` sets `{ status: "guest" }`. The guest view is the landing page (`:280-320`).
  - Run `s02-session.mjs`, scenario 2e: the History view with a typed search is open. After the next alerts poll (401) the page shows "Every change. A clear decision." The live-region log has no new entry. Focus moved from the search field to `body`. Screen: `screens/02e-history-after-session-end-dark.png`. The pull page does the same with its own sign-in card (2f).
- What happens: the content disappears and a marketing headline takes its place. No text says "Your session ended". The search text and the filter are lost. After sign-in the user returns to `/?view=history` with an empty search.
- Impact: looks like a fault or a wrong page. A screen-reader user gets no announcement and loses focus.
- Recommendation: keep the page frame and show a "session ended" notice with "Sign in again" above the stale content (dimmed), or use the gate component of SHELL C6 with the reason "Your session ended". Announce it. Keep the view state in the URL (SHELL-08).
- Alternatives: (a) minimal: pass a reason to the guest view and print one line: "Your session ended. Sign in again to continue." (b) make the poll failure passive: mark the bell as "signed out" and wait for the next user action.
- Maintainer decision needed: no.

### RESIL-11 · Offline: no automatic retry for saves or images, the browser's raw error text, and no connection state

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence (run `s07-network.mjs`, scenarios 7a and 7b):
  - Offline save: alert `Not saved. Failed to fetch` with "Retry same command" and "Refresh current state". "Failed to fetch" is Chrome's `TypeError` text; other browsers use other words (see the gap-cross-browser lane). Screens: `screens/07a-offline-save-dark.png`, `-light.png`, `-mobile.png`.
  - 5 s after the connection returned: 0 requests, same alert, `navigator.onLine` is `true`. `rg` finds no `online` listener and no use of `navigator.onLine` in `apps/web/src`.
  - "Retry same command" then works and sends the same `commandId` (1 command posted). The held decisions survive in memory (`use-review-session.ts:378`), but the bar does not say how many are held.
  - While the error is shown, `A` and `X` do nothing visible. The only feedback is a screen-reader-only line: "Resolve the unsaved command before saving another review." (`use-review-session.ts:409-412`, `review-workspace.tsx:1202-1204`).
  - Offline image load: "Image evidence unavailable / The image could not be loaded. Check your connection and retry." with "Retry images"; 0 image requests in 5 s after the connection returned (`screens/07b-offline-image-load-dark.png`).
- What happens: a short network loss (a laptop that wakes up, a train) stops the review until the user finds a small text button in the bar. Nothing on the page shows that the cause is the connection, and nothing recovers when it returns.
- Impact: this is the most frequent failure of a long-open tab, and it needs manual work each time.
- Recommendation: one connection state for the app (redesign idea 1). While offline: keep accepting decisions into the held queue, show "Offline. 3 decisions are held and will be sent when the connection returns." On `online` or on the next successful request: send the held commands with the same IDs, load the failed images again. Replace raw `fetch` messages with one sentence.
- Alternatives: (a) minimal: on the `online` event, call the existing retry one time for saves and images, and map `TypeError` to "No connection." (b) retry with backoff without waiting for `online` (3 tries). (c) keep manual retry and only fix the copy and the visible feedback for blocked keys.
- Maintainer decision needed: yes. May the page accept more decisions while offline (a longer held queue), or must it stop at the first failure as today?

### RESIL-12 · A click on a run while offline replaces the app with the browser's offline page

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes (dev server on port 4310, where route modules load on demand). Effort: S
- Evidence:
  - `@tanstack/react-router/src/lazyRouteComponent.tsx:57-68`: for a "module not found" error the router calls `window.location.reload()`. The check is only the message prefix (`@tanstack/router-core/src/utils.ts:507-517`).
  - Run `SCRATCH/s01-deploy-skew.mjs`, case 1c: the queue is loaded, the network goes offline, the user clicks "Review changes". Requests: the run chunk fails, the error-component chunk fails, the document navigates to `chrome-error://chromewebdata/`. Body text: "Press space to play … ERR_INTERNET_DISCONNECTED" (`screens/01c-offline-click-run-dark.png`).
- What happens: the router cannot tell "the chunk is gone after a deploy" from "the network is down". It reloads in both cases. Offline, the reload destroys the loaded queue.
- Impact: the user loses a working page because of one click during a network gap. Chrome reloads the page when the connection returns; other browsers may not.
- Recommendation: preload the route chunks when the app is idle (`router.preloadRoute` or `defaultPreload: "intent"` plus an idle preload of the three route chunks; they are small). Then a later click needs no network for code. Also handle `vite:preloadError` and skip the reload when `navigator.onLine` is `false`.
- Alternatives: (a) minimal: do not split the routes (`autoCodeSplitting: false`); the app has three routes. This also removes RESIL-13. (b) keep the split and add an offline check before the reload in a custom wrapper.
- Maintainer decision needed: yes. Keep route code splitting for three routes, or ship one client bundle?

### RESIL-13 · A chunk that stays missing after the automatic reload ends in the router's bare "Something went wrong!" screen

- Kind: bug
- Severity: medium. Confidence: high for the dev measurement, medium for production (derived from the chunk list, no build was run). Measured: yes. Effort: S
- Evidence:
  - Case 1a (chunk missing one time): the router reloads the document; the user sees "Checking access and loading this run…" and then the run. `sessionStorage` holds `tanstack_router_reload:Failed to fetch dynamically imported module: …runs.$runId.tsx?tsr-split=component`. This is the good path, and it is silent (`screens/01a-deploy-skew-150ms-after-click-dark.png`).
  - Case 1b (chunk still missing): 6 failed module requests and 2 automatic reloads (one for the component URL, one for the error-component URL). Then the screen is: no header, "Something went wrong!", a "Hide Error" button, and red monospace text `Failed to fetch dynamically imported module: http://127.0.0.1:4310/src/routes/runs.$runId.tsx?tsr-split=errorComponent` (`screens/01b-deploy-skew-module-still-missing-dark.png`). Case 1e gives the same screen for the queue chunk from the pull page (`screens/01e-pull-to-queue-index-module-missing-dark.png`).
  - The production build splits the same way: `apps/web/dist/client/assets/index-MxeSnhFR.js` has `errorComponent: pe(()=>_e(()=>import("./runs._runId-6tHAE8eb.js")…` and `component: pe(()=>_e(()=>import("./runs._runId-QUJlDVZ1.js")…`.
  - `rg "preloadError|defaultErrorComponent|notFoundComponent" apps/web/src` finds nothing. Production answers a missing hashed asset with 404 and `text/html` (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live/curl-prod-missing-asset.jsonl`).
- What happens: the designed error screen of the run route is itself a chunk, so it cannot show when chunks fail. The fallback is a developer screen with a module URL. It has no navigation and no reload control. This state needs a chunk that fails two times: a rollout that serves mixed versions, an asset or CDN fault, or a blocked request.
- Impact: low frequency, but the result is the worst screen of the app, and it is the only screen for any render error on the queue and pull routes (SHELL-10).
- Recommendation: give the router a `defaultErrorComponent` and the root route a `notFoundComponent`, both in the main bundle and built from the app shell. For a chunk error, show "Visonaut was updated. Reload to continue." with one "Reload" button (redesign idea 3). Keep the run route's `errorComponent` in the main bundle (through the code-splitting options of the router plugin; check the option name in the installed version).
- Alternatives: (a) minimal: add only `defaultErrorComponent` with a reload button. (b) remove the split (RESIL-12, alternative a). (c) keep old assets available for some days after a deploy, so that old tabs keep working.
- Maintainer decision needed: no.

### RESIL-14 · A tab cannot detect a deploy, and an API format change gives messages that hide the cause and a button that cannot help

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review/client.ts:157-159`: `if (data.format !== "compact-review-1") { throw new Error("This review format has changed. Refresh before reviewing."); }`.
  - Run `SCRATCH/s21-recovery.mjs`, "API format skew": an old tab approves, the server applies the decision (`serverVerdict: "approved"`) and answers the receipt with a newer format. The bar shows `Could not confirm the queued decisions. The server will continue processing them. Retry to check their status.` "Retry same command" sends the POST and the poll again and shows the same text. "Refresh current state" shows `Not saved. This review format has changed. Refresh before reviewing.` and leaves one control, "Refresh current state", which fails again.
  - The dashboard is similar: "The run list could not be read. Retry loading the page." with "Retry", which reads the API again and does not reload the page (D3).
  - `/health` returns no build or version (`apps/web/src/server.ts:62-72`). No response header carries one.
- What happens: after a deploy that changes a response shape, an old tab can only be repaired by a browser reload. The text says "Refresh", and the button beside it is named "Refresh current state" and does something else. The decision was saved, and the page says "Not saved."
- Impact: rare (it needs a format change), but then each open tab is affected at the same time, and the page misleads about a saved decision.
- Recommendation: send a build ID with each API response (a header, or a field in the envelope) and bake the same ID into the client. When they differ, show one prompt: "Visonaut was updated. Reload to continue." (redesign idea 3). Map a parse failure to the same prompt.
- Alternatives: (a) minimal: change the two messages to "Reload this page" and render a "Reload page" button for parse errors. (b) keep responses backward compatible for one release and never fail on unknown formats.
- Maintainer decision needed: no.

### RESIL-15 · A 5xx answer that is not JSON tells the user to check the connection; the maintenance text and its `Retry-After: 60` are dropped

- Kind: copy
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review/client.ts:263-267`: if the content type is not JSON: `"The service did not return review data. Check your connection and refresh."`.
  - `apps/web/src/cutover-fence.ts:4-8`: maintenance answers each request with 503, plain text "Visonaut is temporarily unavailable during maintenance.", and `Retry-After: 60`.
  - Run `SCRATCH/s20-extra.mjs`: with that answer the queue shows "The run list is temporarily unavailable. Please retry.", the run page shows "The service did not return review data. Check your connection and refresh.", and a save shows "Not saved. The service did not return review data. Check your connection and refresh."
- What happens: during planned maintenance, or behind a gateway error page, the review surfaces blame the user's connection. The server's own sentence is not shown.
- Impact: wrong cause. This row is the one that the user is most likely to see during a cutover.
- Recommendation: for a non-JSON answer, branch on the status: 5xx gives "Visonaut is not available now." plus the wait from `Retry-After` when present. Use "Check your connection" only when `fetch` rejects.
- Alternatives: (a) make the maintenance Worker answer JSON in the normal envelope with a `maintenance` code. (b) keep the text and remove "Check your connection".
- Maintainer decision needed: no.

### RESIL-16 · 503 handling differs on each surface: the reference is dropped on five of ten, `Retry-After` is never read, and the retry policy is one of four

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence (matrix row "503 `service_unavailable`", and run `s21-recovery.mjs`):

  | Endpoint              | Text                                                                                                           | Reference shown | Automatic retry                                        |
  | --------------------- | -------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------ |
  | `/api/runs`           | "The run list is temporarily unavailable. Please retry."                                                       | No              | None (1 request in 3.5 s)                              |
  | `/api/operations`     | "Operation alerts are temporarily unavailable. …"                                                              | No              | Fixed 60 s                                             |
  | `/api/pulls/:n`       | "The pull request could not be loaded. Please retry."                                                          | No              | None; a failed poll also stops the 15 s wait (PULL-05) |
  | `/api/runs/:id`       | "The service is temporarily unavailable. Reference: <id>."                                                     | Yes             | None                                                   |
  | `/api/runs/:id/state` | "Waiting for the new comparison. The service is temporarily unavailable. Reference: <id>." in gray status text | Yes             | Fixed 2 s                                              |
  | command, undo         | "Not saved. The service is temporarily unavailable. Reference: <id>."                                          | Yes             | None                                                   |
  | receipt poll          | "Could not confirm the queued decisions. … Reference: <id>."                                                   | Yes             | None; the 500 ms loop ends at the first error          |
  - `apps/web/src/api/index.ts:42`, `:82`: each 503 has `Retry-After: 1`. `rg -i "retry-after" apps/web/src` finds only server files and tests.
  - The reference is a 36-character UUID in the sentence. It has no copy control and no label that says what it is for. `docs/current-contract.md:81-83` requires the reference in the review client only.
  - The 60 s alerts poll announces a failure one time for 4 failed polls (`failureAnnouncements: 1`), and the bell label changes to "1 cached alert; refresh failed" (`screens/08-bell-cached-alerts-refresh-failed-dark.png`). This part works well.

- What happens: the same outage reads as four different problems, and the user must press Retry by hand on the page loads and the saves, although the server says "try again in 1 second".
- Impact: a transient D1 or GitHub fault, which the server already marks as retryable, becomes a manual step. A support report from the queue or the pull page has no reference.
- Recommendation: one fetch wrapper for all reads and commands: on 503 with `Retry-After`, retry up to 2 times with that delay before any error is shown (commands are idempotent by `commandId`). When the error is shown, use the error block of redesign idea 5 with the reference and a copy button on every surface.
- Alternatives: (a) minimal: show the reference on the dashboard and the pull page. (b) retry only GET requests. (c) remove `Retry-After: 1` from the server if no client is meant to use it.
- Maintainer decision needed: yes. Is a silent automatic retry of a review command acceptable (it is safe by `commandId`, but it delays the error by 1 to 2 s)?

### RESIL-17 · The Service status page cannot open while `/api/runs` fails

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `routes/index.tsx:356-364`: the status view renders only inside `state.status === "ready"`, and that state comes from the run list read.
  - Run `s07-network.mjs`, last case: `/?view=service` with a 503 from `/api/runs` shows "The review queue could not be loaded / The run list is temporarily unavailable. Please retry." under a selected "Service status" tab. Requests to `/api/operations`: 0. Screen: `screens/08-service-page-blocked-by-run-list-503-dark.png`.
- What happens: the page that explains service problems depends on the request that is most likely to fail in a service problem. The heading names the queue although the user asked for the status.
- Impact: during an incident the maintainer cannot read the alerts or reach the recovery guide link. SHELL-03 found the same coupling as a delay; here it is a failure.
- Recommendation: load the status page from `/api/operations` alone. The repository name can come from the operations answer or can be absent.
- Alternatives: (a) minimal: when the run list fails, still render the alerts panel under the error block. (b) a separate `/status` route.
- Maintainer decision needed: no.

### RESIL-18 · Permanent states offer "Retry", and evidence errors offer nothing

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Unknown run ID: the server answers `409 incomplete` "The requested record does not exist." (`packages/service/src/service.ts:92-98`, `apps/web/src/api/index.ts:55-66`). Run `s21-recovery.mjs`: the page shows "This run could not be opened / The requested record does not exist." with "Retry". 3 clicks give 3 more requests and the same screen. No link to the queue is in the card.
  - Missing check: "This Visonaut check was not found. Open the latest check on GitHub." with "Retry" and no GitHub link (P2; PULL-07 has the detail).
  - Image answers 404: "The image could not be loaded. Check your connection and retry." with "Retry images"; the retry sends 2 requests and fails again (`s07-network.json`, "image answers 404").
  - Image with other dimensions: "Comparison evidence incomplete / The image dimensions do not match this comparison." with no control. Approve and Reject are disabled. "Recompare now" needs `recompareAllowed`, which the server always sets to `false` (`api/review.ts:592`). Screen: `screens/07b-image-dimensions-dark.png`.
  - A bad `comparison` value in the URL gives 400 `invalid_id` (`api/input.ts:43`) and the same card with "Retry" (derived).
- What happens: the only recovery control of the page-level error cards is "Retry", also for states that cannot change. Evidence errors block the decision for a variant and name no next step.
- Impact: dead ends. For evidence errors the run cannot be completed in the UI, and the page does not say what the maintainer must do (run the capture again).
- Recommendation: classify each error as transient or permanent (RESIL-08). Permanent: no Retry; show the valid exit ("Open the review queue", "Open the pull request on GitHub", "Open the current comparison"). Evidence errors: say what fixes them ("Run the visual workflow again for this commit") and link to the workflow run when the model has it.
- Alternatives: (a) minimal: add "Open the review queue" to the run error card and remove "Check your connection" from the image text when the status is 404. (b) return 404 for a missing run (contract change, see RESIL-08).
- Maintainer decision needed: no.

### RESIL-19 · A sign-in that fails at GitHub leaves the app: the user gets Better Auth's default error page, or the landing page with no message, and the deep link is lost

- Kind: ux
- Severity: medium. Confidence: high for the two branches, low for which branch production uses (not verified, see "Open questions"). Measured: yes (local handler, no network). Effort: S
- Evidence:
  - The three sign-in calls pass only `provider` and `callbackURL` (`routes/index.tsx:216-219`, `routes/runs.$runId.tsx:175-178`, `routes/pulls.$pullNumber.tsx:124-127`). `packages/security/src/auth.ts:21-79` sets no `onAPIError`.
  - `better-auth/dist/api/routes/callback.mjs:37`, `:80-86`: on an error the callback redirects to `errorURL ?? `${baseURL}/error``.
  - `better-auth/dist/api/routes/error.mjs:380-384`: `if (isProduction && !options.onAPIError?.customizeDefaultErrorPage)` redirect to `/?error=…`; if not, render the built-in HTML page. `isProduction` is `env.NODE_ENV === "production"`, read at module load (`@better-auth/core/dist/env/env-impl.mjs`).
  - Run `SCRATCH/auth-probe.mjs` (the real `createAuth` with a local SQLite database):
    - user presses Cancel on GitHub: `302 /api/auth/error?error=access_denied&error_description=The+user+has+denied+your+application+access.`
    - the same state a second time, an unknown state, or a state older than 10 minutes: `302 /api/auth/error?error=state_mismatch`
    - GitHub cannot be reached for the code exchange: `302 /api/auth/error?error=invalid_code`
    - `GET /api/auth/error` with `NODE_ENV` not set: 200, `text/html`, 9,340 bytes. With `NODE_ENV=production`: `302 /?error=access_denied&error_description=…`.
  - The built-in page under the app's CSP (run `SCRATCH/s14-auth-screens.mjs`): "ERROR / Something went wrong / CODE: access_denied / The user has denied your application access." with "Go Home" and "Ask AI". "Ask AI" links to `https://better-auth.com/docs/reference/errors/access_denied?askai=…`. Screens: `screens/14a-better-auth-error-page-dark.png`, `-light.png`, `-mobile.png`.
  - The redirect branch: the landing page with `?error=access_denied` in the URL shows no text about the failure (`mentionsTheFailure: false`). `routes/index.tsx:40-42` drops unknown search values.
- What happens: in both branches the user does not return to the run or pull request link, because `callbackURL` is used only on success. In one branch the user sees a page with another visual design and a link to a third-party site. In the other branch nothing says that sign-in failed.
- Impact: the entry path from a GitHub check ends on a foreign page or a silent landing page. A wait of more than 10 minutes on GitHub's page (2FA, account choice) is enough to cause `state_mismatch`.
- Recommendation: pass `errorCallbackURL` with the same path as `callbackURL`, and render the failure in the app: "Sign-in did not finish. <reason in plain words>. Try again." Map `access_denied`, `state_mismatch`, and `invalid_code` to three sentences. Set `onAPIError.errorURL` as a second line of defense so that the built-in page can never show.

  ```ts
  createAuthClient().signIn.social({
    provider: "github",
    callbackURL: path,
    errorCallbackURL: path,
  });
  // route: validateSearch keeps `error`; the sign-in card shows the reason and the button
  ```

- Alternatives: (a) minimal: only `onAPIError: { errorURL: "/" }` in `auth.ts` and one message on the landing page. (b) a small `/auth-error` route with the app shell.
- Maintainer decision needed: no.

### RESIL-20 · The auth rate limit answers 429 after three sign-in starts in 10 seconds; the page says "could not start, try again" and enables the button at once

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/auth.ts:52`: `rateLimit: { enabled: true, storage: "database", window: 60, max: 60 }`. Better Auth adds its own rule for paths that start with `/sign-in`: `window: 10, max: 3` (`better-auth/dist/api/rate-limiter/index.mjs:302-308`).
  - Run `auth-probe.mjs`: five `POST /api/auth/sign-in/social` in a row from one address give `200, 200, 200, 429, 429`. The 429 has `X-Retry-After: 10`, `content-type: text/plain`, and the body `{"message":"Too many requests. Please try again later."}`. `POST /sign-out` gives the first 429 at request 61. `GET /callback/github` gives the first 429 at request 61; that request is a document navigation, so the browser would show the raw JSON text (derived).
  - Without a client address header, all users share one bucket for each path (`five POST … without a client address header: 200, 200, 200, 429, 429`). AUTH-14 has the detail.
  - Run `s14-auth-screens.mjs`: the dashboard and the run page show "Sign-in could not start. Please try again." and the button is enabled at once; a second click inside the window sends a second request that fails again. On the dashboard the message is at the top left of the page, far from the button (`screens/15-sign-in-429-dashboard-dark.png`). The pull page replaces the whole card with "Review unavailable / Sign-in could not start. Please retry." and "Retry", which reads the pull request again and then shows the sign-in card again (`screens/15-sign-in-429-pull-page-dark.png`). Sign-out: "Sign-out failed. Please try again." in the account popover (`screens/15-sign-out-429-dashboard-dark.png`).
- What happens: the limit of 3 in 10 s is low enough for a user who clicks again after a slow start, or for several maintainers behind one address. The page does not name the limit or the wait.
- Impact: a short loop of failed clicks. Low frequency.
- Recommendation: read `X-Retry-After` on a 429, disable the button for that time, and show "Too many sign-in attempts. Try again in 10 s." Keep the message beside the button on all three surfaces.
- Alternatives: (a) raise the limit for `/sign-in/social` with a custom rule. (b) keep the limit and only change the copy to name the wait.
- Maintainer decision needed: no.

### RESIL-21 · A historical comparison is marked by one unstyled sentence; counts and badges still say "need review", and the decision keys do nothing with no feedback

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence (run `s04-state-changes.mjs`, scenario 11; screens `screens/11-historical-comparison-dark.png`, `-mobile.png`, `-details-dark.png`):
  - Marks of the historical state: the line "This historical comparison is read-only. It does not affect the live review or required check." (plain text, no background; WORK-09), the 10 px header text "Comparison complete", and `?comparison=` in the URL. The document title does not change (SHELL-07).
  - The header still shows "9 of 11 need review" with a progress bar, the badge "Needs review", and the sidebar counts "7 of 7 need review".
  - Approve, Reject, Undo, and "All 7 changed views…" are disabled. "Approve & next" keeps its brand fill. The view modes, zoom, navigation, filter, and Details work.
  - Key `A`: no request, no bar text, no live-region entry. `review()` returns at `!ready` (`review-workspace.tsx:385-389`).
  - Details lists "Original comparison", "Historical comparison 1 · Complete", "Historical comparison 2 · Failed" as plain text links. The current one has `aria-current` and no visible mark. The links are plain anchors and reload the document (WORK-28).
  - The server sets `recompareAllowed: false` for all runs, so no new historical comparison can be made today (WORK-18). Existing ones can still be opened.
- What happens: a read-only view of the past looks like a live review with broken buttons.
- Impact: low traffic today. The same weak marking applies to each archived or replaced run (RESIL-05), which is frequent.
- Recommendation: one read-only treatment for all non-live views: a header chip ("Historical comparison 1 of 2", "Replaced", "Archived"), no decision bar, no "need review" counts, and a link "Open the current comparison". Announce "This view is read-only." when a decision key is pressed.
- Alternatives: (a) minimal: hide the decision bar when `model.archived` and give the status line the callout style. (b) remove the historical comparison view if server recomparison stays retired.
- Maintainer decision needed: yes. Does the historical comparison view stay in the product?

### RESIL-22 · Recovery moves focus to `body`, alerts read their button labels as text, and one blocking message exists only for screen readers

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Focus after recovery is `body` in each measured case: "Retry" on the queue, pull page, and run page (`s21-recovery.json`), "Refresh current state" (`s02-session.json`, `s04-state-changes.json`), and the session end on the dashboard (`s02-session.json`, 2e). The control that had focus is removed, and nothing takes focus.
  - The bar is one element whose role changes between `status` and `alert` (`review-workspace.tsx:1104-1110`), and the buttons are inside it. The recorded live text is `Not saved. Failed to fetchRetry same commandRefresh current state`. The evidence alert has the same form: `Image evidence unavailableThe image could not be loaded. Check your connection and retry.Retry images`.
  - While a save error is shown, `A` and `X` give only the screen-reader line "Resolve the unsaved command before saving another review." (`s21-recovery.json`). A sighted keyboard user sees no change.
  - The session end on the dashboard and on the pull page adds no live-region entry (2e, 2f).
  - The bar gets no focus when an error appears. The measured focus after a failed Approve is the workspace root (`div[Review workspace]`). The bar is after all other controls in the Tab order (derived from WORK-29).
- What happens: an error appears at the bottom of the page in small gray text (WORK-10), focus does not go to it, and after the recovery action focus is lost.
- Impact: keyboard and screen-reader users must search for the recovery control, then lose their place when they use it.
- Recommendation: keep the message text and the action buttons as siblings; only the text is the live region. Move focus to the first recovery control when a blocking error appears, and back to the workspace (or the page heading) when it is solved. Show the "resolve first" message in the bar for everyone.
- Alternatives: (a) minimal: after "Retry" and "Refresh current state", call the existing `focusWorkspace()`; on the page-level cards, focus the heading of the new content. (b) a non-modal dialog for blocking errors, which gives focus handling for free.
- Maintainer decision needed: no.

### RESIL-23 · After a sign-out in another tab, an open run page keeps its content and all its controls

- Kind: security
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Run `s04-state-changes.mjs`, scenario 13: 5 s after the session ended elsewhere, the run page shows the same content, the account menu, and enabled decision buttons; 0 requests. Selecting another variant makes 0 API requests. Back to the queue reads `/api/runs`, gets 401, and shows the landing page. Forward to the run runs the loader again (`gcTime: 0`) and shows "Sign in to review this run".
  - No code shares the sign-out between tabs (`rg "BroadcastChannel|storage" apps/web/src` finds only the sidebar preference).
  - Sign-out in the same tab leaves the page: `window.location.assign("/")` on the run page (`runs.$runId.tsx:193`), `setState({ status: "guest" })` on the dashboard (`index.tsx:234`).
- What happens: the other tabs of the browser do not learn about the sign-out. They keep private content on screen until a request fails. The first save then fails with RESIL-02.
- Impact: on a shared machine, screenshots of unreleased UI stay visible after sign-out. For the normal single-user case the effect is the confusing first save.
- Recommendation: broadcast sign-out and sign-in with a `BroadcastChannel` (or a `storage` event). Other tabs then show the "session ended" state of RESIL-10 at once, and after a new sign-in they renew their review session (RESIL-01).
- Alternatives: (a) check the session when the tab becomes visible (one cheap request, combined with RESIL-07). (b) accept the state and only fix the save path.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All scripts are in `SCRATCH`. They use Chrome through Playwright (`chromium.launch({ channel: "chrome" })`). `lib.mjs` has the shared helpers: an in-memory stand-in for the private API (`createApi`), a recorder for live regions, and `observe()`, which returns headings, alerts, bar text, enabled and disabled controls, links, and focus. Each script writes a JSON file with the same name.

General limits:

- The API answers are mocks. Their shapes and texts are copied from `apps/web/src/api/index.ts:35-84`, `api/review.ts`, `packages/security/src`, and `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/api/errors.result.json`. The mock model sets `recompareAllowed: false` for each run and `archived: true` for a replaced run, as `api/review.ts:577-598` does.
- Scenarios 2 to 13 ran on `http://127.0.0.1:4311/src/review/__tests__/route-fixture.html?entry=<path>`: the real route tree on a memory history. This harness imports the routes directly, so it has no lazy route chunks. Scenario 1 therefore ran on `http://127.0.0.1:4310`, the real dev app, where each route component is a separate request.
- "Hidden tab" was simulated: the script sets `document.visibilityState` and sends `visibilitychange`. Timer throttling of a real background tab was not measured.
- No timing in this report is a production number.

### M1. Lazy route modules exist in the dev app

Command: `node s01-discover.mjs`

Raw result (requests after a click on "Review changes" on `/`):

```text
script /src/routes/runs.$runId.tsx?tsr-split=component
fetch  /api/runs/00000000-0000-4000-8000-000000000001
script /src/review/review-workspace.tsx  (and 13 more review modules)
```

### M2. Scenario 1, deploy skew

Command: `node s01-deploy-skew.mjs`. The run-route module answers `404` with `content-type: text/html; charset=utf-8`.

```text
1a queue -> run, module missing one time
   failuresServed 1; events: request component (404) -> request errorComponent -> document navigated (reload) -> load -> request component (200)
   during: status "Checking access and loading this run…"   after: run page
   sessionStorage: "tanstack_router_reload:Failed to fetch dynamically imported module: http://127.0.0.1:4310/src/routes/runs.$runId.tsx?tsr-split=component": "1"
1b queue -> run, module still missing
   failuresServed 6; document loads: 3 (2 automatic reloads)
   bodyText: "Something went wrong! Hide Error Failed to fetch dynamically imported module: http://127.0.0.1:4310/src/routes/runs.$runId.tsx?tsr-split=errorComponent"
   enabled controls: ["Hide Error"]
1c offline, click a run
   url: chrome-error://chromewebdata/   bodyText: "Press space to play Try: Checking the network cables, modem, and router Reconnecting to Wi-Fi ERR_INTERNET_DISCONNECTED"
   3 s after the connection returned: the run page (Chrome loaded the URL again)
1d pull page -> run, module missing one time: failuresServed 1; reload; run page; same sessionStorage key
1e pull page -> queue, queue module still missing: failuresServed 2; "Something went wrong! Hide Error Failed to fetch dynamically imported module: …/src/routes/index.tsx?tsr-split=component"
```

Limits: dev server, not a production build. For production the result is derived from the chunk list in `apps/web/dist/client/assets` (the same four route chunks, and the same lazy `errorComponent`) and from the router source. No build was run.

### M3. Scenario 2, session expires during a review

Command: `node s02-session.mjs`

```text
2a 401 from /api/review-sessions
   approve              -> alert "Not saved. Sign in with GitHub."  controls: Retry same command, Refresh current state  focus: div[Review workspace]
   Retry same command   -> same alert
   Refresh current state (still expired) -> alert "Not saved. Sign in with GitHub."  controls: Refresh current state  focus: body
                           disabled: Undo, All 7 changed views…, Reject view X, Approve & next A
   signed in again elsewhere; Refresh current state -> "Current state loaded. Check the evidence before saving a new command."
   approve again        -> POST /api/review-sessions, POST commands, GET queued -> "1 variant approved. Saved."
2b 401 from the command endpoint, then a new sign-in
   Retry same command   -> alert "Conflict. Start a new review session after signing in."  controls: Refresh current state
   Refresh current state -> "Current state loaded. …"  (GET /api/runs/run-42)
   approve again        -> alert "Conflict. Start a new review session after signing in."   (repeated 2 times, same result)
   review-session requests in total: 1     reviewSessionId of each POST commands: ["session-1"]
   after a browser reload, approve -> POST /api/review-sessions -> "Saved."   reviewSessionIds: ["session-1","session-2"]
2c 202 admitted, then 401 from the receipt poll
   alert "Could not confirm the queued decisions. The server will continue processing them. Retry to check their status."
   Retry same command (still expired) -> request: POST /api/comparisons/comparison-2/commands -> same alert
   signed in again elsewhere; Retry -> "Conflict. Start a new review session after signing in."
   Refresh current state -> first variant "Approved" (the server had applied the command)
2d Undo, 401 -> "Not saved. Sign in with GitHub." [Retry Undo]; after a new sign-in: "Conflict. Start a new review session after signing in."; Undo disabled
2e History view with a typed search; the 60 s alerts poll answers 401
   after: headings ["Every change. A clear decision.","Review visual changes."]  alerts: []  focus: body  new live-region entries: 0
2f pull page waiting; the 15 s poll answers 401 -> "Sign in to review pull request #7"; new live-region entries: 0
```

### M4. Scenarios 3, 4, 5, 6, 11, 13

Command: `node s04-state-changes.mjs`

```text
4a run replaced while the page is open
   3 s later, no user action: requests [], Approve enabled, variant "Needs review"
   approve -> alert "Conflict. Only the active complete comparison can be reviewed."  controls: Refresh current state
   status texts on screen: "This run is archived. Decisions show the state at archive time and are read-only." |
                           "Comparison superseded A newer attempt replaced this comparison. Its evidence cannot be reviewed."
   run links on screen: ["/runs/run-42"]
   Approve button enabled:  background oklch(0.515341 0.1546 248.516), color oklch(1 0 0)
   Approve button disabled: background oklch(0.515341 0.1546 248.516), color oklch(1 0 0 / 0.733357)
   Refresh current state -> "Current state loaded. Check the evidence before saving a new command."  focus: body
4b stale queue: "#104 Needs review Dialog focus styles 12 views await approval. … Review changes" -> opens the replaced run
4c history rows: "#104 · Dialog focus styles … Needs review" and "#104 · Dialog focus styles … Replaced by a newer run"
5  another reviewer decided React (rejected) and Solid (approved)
   2.5 s later, no user action: all three chips "Needs review"
   approve React -> alert "Conflict. A target changed or belongs to another comparison. Updated by 5550002."
                    chips now: React "Rejected", Solid "Approved"; Approve and Reject enabled
   Refresh current state -> 1 request (GET /api/runs/run-42); chips unchanged; focus: body
6  two tabs: tab 2 approves React after tab 1 -> "… Updated by 5550001." (the same user)
   tab 2 approves Dark -> "Saved."; tab 1 still shows Dark "Needs review" 2.5 s later; review sessions created: 2
3  dashboard, alerts poll answers 403 wrong_origin -> "Repository access required" [Retry][Use another account]
   Use another account (sign-out answers 403) -> account popover opens: "Sign-out failed. Please try again."; focus: button "Sign out"
   pull page, 403 invalid_identity -> controls: Use another account     run page, 403 invalid_identity -> controls: Retry
11 historical comparison: status "This historical comparison is read-only. It does not affect the live review or required check."
   header: "Queue | Dialog focus styles | 9 of 11 need review | aabbccd | Attempt 2 | Baseline revision 4 | Comparison complete"
   disabled: Undo, All 7 changed views…, Reject view X, Approve & next A, Recompare stored run
   press A -> bar "", requests []
13 run page 5 s after a sign-out elsewhere: content visible, requests []; Back -> GET /api/runs (401) -> landing page; Forward -> "Sign in to review this run"
```

### M5. Scenarios 7, 9, 10, 12, and the status page

Command: `node s07-network.mjs`

```text
7a offline, approve -> alert "Not saved. Failed to fetch"  requests: [POST /api/review-sessions]
   5 s later, still offline: requests []      5 s after the connection returned: requests [], navigator.onLine true
   Retry same command -> POST /api/review-sessions, POST commands, GET queued -> "1 variant approved. Saved."  commands posted: 1
7b offline, next variant -> alert "Image evidence unavailable The image could not be loaded. Check your connection and retry." [Retry images]
   5 s after the connection returned: image requests 0, evidence "error"      Retry images -> 2 requests -> "ready"
   image answers 404 -> the same alert; Retry images -> 2 requests, the same alert
   image has other dimensions -> alert "Comparison evidence incomplete The image dimensions do not match this comparison."  controls: none
9  receipt never completes
   after the 202:  "1 queued on server. You can close this window."   disabled: Undo
   after 30 s:     the same text; receipt polls 60
   after 5 min of page time: the same text; receipt polls 600
   three queued decisions: "3 queued on server. You can close this window."; 6 receipt polls in 1.2 s
10 reload while three decisions are queued: beforeunload prompt: none; after the reload the three chips say "Needs review"; bar ""; requests after the reload: GET /api/runs/run-42 only
10b beforeunload prompt: sending -> yes | queued (202) -> no | "Not saved" (503 from POST) -> yes | "Could not confirm" -> no | "Conflict" -> no
10c queued, tab closed, the command becomes stale on the server; on return: bar "", alerts [], requests [GET /api/runs/run-42]
12 dashboard hidden for 10 minutes: /api/operations 1 -> 11 requests, /api/runs 1 -> 1; visible again: no new request; age text on screen: none
   run page that waits for a comparison: 5 state polls in 10 s visible; 0 in 10 minutes hidden; on return 1 state poll + 1 model read -> "The new comparison is ready."
   /?view=service while /api/runs answers 503 -> "The review queue could not be loaded"; /api/operations requests: 0
```

Limit for scenario 9: the first 30 s are real time. The time to 5 minutes was advanced with the Playwright clock in 540 steps of 500 ms, and each step waited for its poll answer.

### M6. The matrix

Command: `node s08-matrix.mjs > s08-matrix.out.txt`, then `node matrix-table.mjs`. 139 cells: 11 surface drivers and 15 answers. Raw rows have the form:

```text
[run load] [503 service_unavailable with reference] H: This run could not be opened  ·  ALERT: The service is temporarily unavailable. Reference: af4a9c01-3e33-4faa-903c-31c1b20d2bac.  ·  DO: Retry  ·  calls=1
[save: command] [409 review_session_expired] H: Success dialog  ·  ALERT: Conflict. Start a new review session after signing in. Refresh current state  ·  DO: Refresh current state  ·  calls=1
[state poll] [401 sign_in_required] H: Success dialog  ·  BAR: Waiting for the new comparison. Sign in with GitHub.  ·  DO: none  ·  calls=1
```

Limit: each cell is the first screen after the error. The image rows and the route-chunk rows come from M2 and M5. Two rows are derived from code and were not run: "Image decode fails" and "Request aborted by navigation".

### M7. Recovery controls and API format skew

Command: `node s21-recovery.mjs`

```text
Retry after 503 on the queue / pull page / run load: requests in 3.5 s with no user action: 1; after Retry: content loads; focus: body
unknown run ID (409 incomplete): alert "The requested record does not exist."; controls: Retry; 3 clicks -> 4 requests, same screen
keys A and X while a save has failed: new live-region entries: ["status: Resolve the unsaved command before saving another review."]; visible bar unchanged; command requests: 0
API format skew: approve -> "Could not confirm the queued decisions. …" (the server applied the decision)
   Retry same command -> POST commands, GET queued -> same alert
   Refresh current state -> alert "Not saved. This review format has changed. Refresh before reviewing."  controls: Refresh current state
```

Command: `node s20-extra.mjs`

```text
bell, cached alerts then failed polls: label "Service attention: 1 alert" -> "Service attention: 1 cached alert; refresh failed"
   popover: "… 1 unresolved operation alert. Last checked Oct 5, 2026, 3:00 PM. Retry alerts Operation alerts are temporarily unavailable. Shown alerts may be out of date. …"
   4 failed polls -> 1 failure announcement
maintenance answer (503 text/plain, Retry-After: 60): queue "The run list is temporarily unavailable. Please retry." |
   run load "The service did not return review data. Check your connection and refresh." | save "Not saved. The service did not return review data. Check your connection and refresh."
```

### M8. Scenarios 14 and 15 at the auth boundary

Command: `node --experimental-transform-types --no-warnings auth-probe.mjs`, and the same with `NODE_ENV=production`. The probe calls `createAuth` from `packages/security/src/auth.ts` with the `production` environment and an in-memory SQLite database that has the repository migrations. `fetch` is replaced, so no request leaves the process; the one attempt (`https://github.com/login/oauth/access_token`) was recorded and rejected.

```text
POST /sign-in/social -> 200, authorize host github.com, cookie "__Secure-visonaut-production.state"
callback, user denied access            -> 302 /api/auth/error?error=access_denied&error_description=The+user+has+denied+your+application+access.
callback, same state a second time      -> 302 /api/auth/error?error=state_mismatch
callback, no state                      -> 302 /api/auth/error?error=state_not_found
callback, valid state, GitHub unreachable -> 302 /api/auth/error?error=invalid_code
callback, 11 minutes after sign-in started -> 302 /api/auth/error?error=state_mismatch
GET /api/auth/error, NODE_ENV not set   -> 200 text/html, 9340 bytes, headings ["ERROR","Something went wrong"], links ["/", "https://better-auth.com/docs/reference/errors/access_denied?askai=…"]
GET /api/auth/error, NODE_ENV=production -> 302 /?error=access_denied&error_description=The+user+has+denied+your+application+access.
five POST /sign-in/social, one address  -> 200, 200, 200, 429 x-retry-after=10, 429 x-retry-after=10
the 429 answer: content-type text/plain;charset=UTF-8, body {"message":"Too many requests. Please try again later."}
five POST /sign-in/social, no client address header -> 200, 200, 200, 429, 429
62 POST /sign-out, one address -> first 429 at request 61       62 GET /callback/github -> first 429 at request 61
session lifetime (hours until expiry): at creation 168 | 1 day later at the first request 168 | 6 more days later 168 | after 8 days with no request: no session
```

Command: `node s14-auth-screens.mjs` (the saved Better Auth page served with the app's CSP; the three sign-in surfaces with a 429 from `/api/auth/sign-in/social`).

```text
Better Auth page: text "ERROR Something went wrong CODE: access_denied The user has denied your application access. Go Home Ask AI"; CSP violations: []
landing page at /?error=access_denied: mentions the failure: false
sign-in 429, dashboard: alert "Sign-in could not start. Please try again."; button enabled; second click -> 2 requests
sign-in 429, pull page: heading "Review unavailable", alert "Sign-in could not start. Please retry.", controls: Retry
sign-out 429: alert "Sign-out failed. Please try again."
```

Limits: the probe proves what the library does with this repository's options. It does not prove which branch of `/api/auth/error` the deployed Worker takes, because that depends on `process.env.NODE_ENV` at runtime.

### M9. Static checks

```text
rg -n 'addEventListener\(\s*"(online|offline|visibilitychange|focus|pageshow|storage|beforeunload|vite:preloadError)"' apps/web/src   (no tests, no vendored primitives)
  routes/pulls.$pullNumber.tsx:113 visibilitychange | review/review-workspace.tsx:239 storage | review/use-review-session.ts:182 beforeunload | review/use-review-session.ts:251 visibilitychange
rg -n 'navigator\.onLine|BroadcastChannel|localStorage|sessionStorage' apps/web/src   -> review-workspace.tsx:229 and sidebar-preference.ts:7 only
rg -n 'preloadError|errorComponent|notFoundComponent|defaultErrorComponent' apps/web/src   -> routes/runs.$runId.tsx:49 only
rg -n -i 'retry-after' apps/web/src   -> server.ts, cutover-fence.ts, and tests only
rg -n 'errorCallbackURL|errorURL|onAPIError' apps/web/src packages/security/src   -> no result
```

### Scenario results in one table

| #   | Scenario                               | What the screen shows                                                         | Controls                                                                     | Decision or selection lost                         | Focus after        | Live region               | Finding            |
| --- | -------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- | ------------------ | ------------------------- | ------------------ |
| 1   | Deploy skew, chunk missing one time    | "Checking access and loading this run…", then the run after a document reload | None needed                                                                  | Queue view state (reload)                          | `body`             | The loading status        | RESIL-13           |
| 1   | Chunk still missing                    | "Something went wrong!" and a module URL, no app shell                        | Hide Error                                                                   | The page                                           | `body`             | None                      | RESIL-13           |
| 1   | Offline click on a run                 | The browser's offline page                                                    | None                                                                         | The page                                           | –                  | None                      | RESIL-12           |
| 2   | 401 at the first save                  | "Not saved. Sign in with GitHub."                                             | Retry same command, Refresh current state                                    | Lost if the user presses Refresh                   | Workspace root     | Alert, with button labels | RESIL-02           |
| 2   | New sign-in, then save                 | "Conflict. Start a new review session after signing in."                      | Refresh current state (no effect on the cause)                               | Decision dropped                                   | Workspace root     | Alert                     | RESIL-01           |
| 2   | 401 at the receipt poll                | "Could not confirm the queued decisions. …"                                   | Retry same command, Refresh current state                                    | Decision is applied on the server                  | Workspace root     | Alert                     | RESIL-02, RESIL-08 |
| 3   | 403, each code                         | One text for each page, the same for all three codes                          | Dashboard: Retry, Use another account. Pull: Use another account. Run: Retry | Queue content removed                              | `body`             | Alert on the dashboard    | RESIL-09           |
| 4   | Run replaced                           | Four texts, "Conflict. Only the active complete comparison can be reviewed."  | Refresh current state                                                        | Decision dropped; selection kept                   | Workspace root     | Status and alert          | RESIL-05           |
| 5   | Another reviewer                       | "Conflict. … Updated by 5550002."                                             | Refresh current state; Approve and Reject enabled                            | Decision dropped; selection returns to the variant | Workspace root     | Alert                     | RESIL-06           |
| 6   | Two tabs                               | The same, with the user's own ID                                              | The same                                                                     | The same                                           | Workspace root     | Alert                     | RESIL-06           |
| 7   | Offline save                           | "Not saved. Failed to fetch"                                                  | Retry same command, Refresh current state                                    | Held in memory until Retry                         | Workspace root     | Alert                     | RESIL-11           |
| 7   | Offline image                          | "Image evidence unavailable …"                                                | Retry images                                                                 | None                                               | Unchanged          | Alert                     | RESIL-11           |
| 8   | 503 on each endpoint                   | See RESIL-16                                                                  | Retry on loads and saves; none on polls                                      | None                                               | `body` after Retry | Alert or status           | RESIL-16           |
| 9   | Receipt never completes                | "1 queued on server. You can close this window." without end                  | None; Undo disabled                                                          | None                                               | Workspace root     | Status, one time          | RESIL-04           |
| 10  | Reload with queued or failed decisions | The run as the server has it; no pending mark, no receipt                     | None                                                                         | Pending marks; a failed decision leaves no trace   | `body`             | None                      | RESIL-03           |
| 11  | Historical comparison                  | One plain sentence; counts still say "need review"                            | View controls only                                                           | –                                                  | `body`             | Status                    | RESIL-21           |
| 12  | Hidden tab                             | Alerts keep polling; run list and ready run never read again; no age text     | Refresh runs                                                                 | –                                                  | –                  | –                         | RESIL-07           |
| 13  | Sign-out elsewhere, then Back          | Run stays on screen; Back shows the landing page                              | Sign in with GitHub                                                          | –                                                  | `body`             | None                      | RESIL-23           |
| 14  | Sign-in fails at GitHub                | Better Auth page, or `/` with no message                                      | Go Home, Ask AI; or Sign in with GitHub                                      | The deep link                                      | –                  | None                      | RESIL-19           |
| 15  | Auth 429                               | "Sign-in could not start. Please try again."                                  | Sign in (enabled at once); pull page: Retry                                  | None                                               | `body`             | Alert                     | RESIL-20           |

## Screenshots

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-session-resilience/screens/`. Dark files are 1440 x 900. Light files are 1440 x 900. Mobile files are 390 x 844, dark. I read each image after capture. The six worst cases have dark, light, and mobile versions: run replaced (04a), another reviewer (05), offline save (07a), new sign-in dead end (02b), access screen on a wrong origin (03), and the Better Auth error page (14a).

| File                                                  | Caption                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01a-deploy-skew-150ms-after-click-dark.png`          | 150 ms after a click on a run whose chunk answers 404: the document reloads and shows "Checking access and loading this run…" under an empty header.                                                                                                                      |
| `01b-deploy-skew-module-still-missing-dark.png`       | The chunk stays missing: no app shell, "Something went wrong!", "Hide Error", and a red module URL.                                                                                                                                                                       |
| `01c-offline-click-run-dark.png`                      | A click on a run while offline: the router reloads the document, and Chrome shows its offline page.                                                                                                                                                                       |
| `01e-pull-to-queue-index-module-missing-dark.png`     | The same bare error screen for the queue chunk, reached from the pull page.                                                                                                                                                                                               |
| `02a-save-401-review-session-dark.png`                | Session expired at the first save: "Not saved. Sign in with GitHub." in 12 px gray text, with two text buttons. No sign-in control.                                                                                                                                       |
| `02a-save-401-after-refresh-dark.png`                 | After "Refresh current state" with the session still expired: the Retry button is gone, each review control is disabled.                                                                                                                                                  |
| `02b-second-approve-still-conflict-dark.png`          | After a new sign-in: "Conflict. Start a new review session after signing in." The only button is "Refresh current state". Approve and Reject look ready.                                                                                                                  |
| `02b-second-approve-still-conflict-light.png`         | The same state in the light scheme.                                                                                                                                                                                                                                       |
| `02b-second-approve-still-conflict-mobile.png`        | The same state at 390 px: the message wraps under the decision buttons.                                                                                                                                                                                                   |
| `02c-receipt-poll-401-dark.png`                       | A 401 on the receipt poll: "Could not confirm the queued decisions. The server will continue processing them. Retry to check their status." The cause (signed out) is not named.                                                                                          |
| `02e-history-after-session-end-dark.png`              | The History view after a background 401: the landing page "Every change. A clear decision." with the History tab still selected.                                                                                                                                          |
| `02f-pull-waiting-session-end-dark.png`               | The pull page after a background 401: the sign-in card, with no text about the ended session.                                                                                                                                                                             |
| `03-dashboard-403-wrong-origin-dark.png`              | A 403 `wrong_origin` on the dashboard: "Repository access required / Your repository access changed. Write access to this repository is required."                                                                                                                        |
| `03-dashboard-403-wrong-origin-light.png`             | The same in the light scheme.                                                                                                                                                                                                                                             |
| `03-dashboard-403-wrong-origin-mobile.png`            | The same at 390 px.                                                                                                                                                                                                                                                       |
| `03-dashboard-403-use-another-account-fails-dark.png` | After "Use another account" on a wrong origin: the account popover opens by itself with "Sign-out failed. Please try again."                                                                                                                                              |
| `03-pull-page-403-invalid-identity-dark.png`          | The pull page 403: only "Use another account", no Retry.                                                                                                                                                                                                                  |
| `03-run-page-403-invalid-identity-dark.png`           | The run page 403: only "Retry", centered in a wide card; the header has no account menu.                                                                                                                                                                                  |
| `04a-superseded-during-review-dark.png`               | Run replaced, after a failed Approve: four texts for one cause ("A newer attempt is active", "This run is archived…", "Comparison superseded…", "Conflict. Only the active complete comparison can be reviewed."). No link to the newer run. Approve keeps its blue fill. |
| `04a-superseded-during-review-light.png`              | The same in the light scheme. The archive line has no background.                                                                                                                                                                                                         |
| `04a-superseded-during-review-mobile.png`             | The same at 390 px: the texts take most of the first screen, and the image starts near 690 px of 844.                                                                                                                                                                     |
| `04a-superseded-after-refresh-dark.png`               | After "Refresh current state": "Current state loaded. Check the evidence before saving a new command." on a read-only run.                                                                                                                                                |
| `04b-open-superseded-run-from-stale-queue-dark.png`   | The replaced run opened from a stale queue: the same texts, with a decision bar that cannot be used.                                                                                                                                                                      |
| `04c-history-with-superseded-run-dark.png`            | History: two rows with the same title, "Needs review" and "Replaced by a newer run", with no link between them.                                                                                                                                                           |
| `05-other-reviewer-conflict-dark.png`                 | Another reviewer decided first: "Conflict. A target changed or belongs to another comparison. Updated by 5550002." The chips already show the new verdicts.                                                                                                               |
| `05-other-reviewer-conflict-light.png`                | The same in the light scheme.                                                                                                                                                                                                                                             |
| `05-other-reviewer-conflict-mobile.png`               | The same at 390 px.                                                                                                                                                                                                                                                       |
| `06-two-tabs-same-variant-conflict-dark.png`          | Two tabs of one user: the conflict names the user's own numeric ID ("Updated by 5550001.").                                                                                                                                                                               |
| `07a-offline-save-dark.png`                           | Offline save: "Not saved. Failed to fetch" with "Retry same command" and "Refresh current state".                                                                                                                                                                         |
| `07a-offline-save-light.png`                          | The same in the light scheme.                                                                                                                                                                                                                                             |
| `07a-offline-save-mobile.png`                         | The same at 390 px: the two text buttons wrap to two lines.                                                                                                                                                                                                               |
| `07b-offline-image-load-dark.png`                     | Offline image load: a text line above the viewer and "Image could not be verified." in each empty pane.                                                                                                                                                                   |
| `07b-image-dimensions-dark.png`                       | Image with other dimensions: "Comparison evidence incomplete" with no control; the decision buttons are disabled.                                                                                                                                                         |
| `08-bell-cached-alerts-refresh-failed-dark.png`       | The bell after a failed poll: count and "!" mark, "Shown alerts may be out of date.", "Last checked" time, "Retry alerts". This is the best stale-data treatment in the app.                                                                                              |
| `08-service-page-blocked-by-run-list-503-dark.png`    | The Service status tab is selected, and the page shows "The review queue could not be loaded".                                                                                                                                                                            |
| `09-receipt-never-completes-5min-dark.png`            | A queued decision after 5 minutes: still "1 queued on server. You can close this window."                                                                                                                                                                                 |
| `10-after-reload-queued-decisions-not-shown-dark.png` | After a reload with three queued decisions: the page shows no pending mark and no receipt.                                                                                                                                                                                |
| `11-historical-comparison-dark.png`                   | A historical comparison: one plain sentence marks it; "9 of 11 need review" and "Needs review" still show; Approve keeps its fill.                                                                                                                                        |
| `11-historical-comparison-details-dark.png`           | Details for a historical comparison: three comparison links as plain text, the current one has no mark.                                                                                                                                                                   |
| `11-historical-comparison-mobile.png`                 | The same view at 390 px.                                                                                                                                                                                                                                                  |
| `14a-better-auth-error-page-dark.png`                 | The Better Auth default error page for `access_denied`, as rendered under the app's CSP: "ERROR", "Go Home", "Ask AI".                                                                                                                                                    |
| `14a-better-auth-error-page-light.png`                | The same in the light scheme.                                                                                                                                                                                                                                             |
| `14a-better-auth-error-page-mobile.png`               | The same at 390 px.                                                                                                                                                                                                                                                       |
| `15-sign-in-429-dashboard-dark.png`                   | Sign-in rate limit on the dashboard: the message is at the top left, far from the sign-in card, and names no wait.                                                                                                                                                        |
| `15-sign-in-429-pull-page-dark.png`                   | Sign-in rate limit on the pull page: the card becomes "Review unavailable" with "Retry".                                                                                                                                                                                  |
| `15-sign-out-429-dashboard-dark.png`                  | Sign-out rate limit: "Sign-out failed. Please try again." in the account popover.                                                                                                                                                                                         |

## Redesign ideas

The sketches use the lab primitives. I checked each prop against `apps/lab/docs/primitives.md` ("Pitfalls to know first" and the recipes): no `"primary"` color, text in `*Label` parts, `ak-ink-*` classes on `Text`, `$forceRounded` for badges in small frames, `mt-0 mb-0` on headings in rows, `portal` on popovers. Icons are from `lucide-react`. All ideas need mock states only; the backend does not need to work.

One rule connects the ideas: **each failure state shows three things, in this order: the cause in plain words, what happened to the user's work, and one valid action.** The present UI shows a server sentence and a generic button.

### Idea 1 · One connection and session indicator

- What changes: a small state chip in the app header, on each page. It has five states: hidden (all is well), `Offline`, `Reconnecting…`, `Signed out`, and `Service problem`. A count shows held decisions. A popover explains the state and has the one action.
- Why it is better: today the same cause shows as "Failed to fetch", "Not saved.", "Could not confirm…", or nothing, at the bottom of one page. One indicator in a fixed place names the cause for the whole app, and the decision bar can stay short. It replaces the missing `online` handling (RESIL-11) and the silent session end (RESIL-10).
- Variants for the lab: (a) chip in the header, (b) a 2 px colored line under the header plus text in the decision bar, (c) a slim band above the page content, (d) only a dot on the account button.

```tsx
<PopoverProvider placement="bottom-end">
  <PopoverDisclosure $size="sm" $text="warning" aria-label="Offline. 3 decisions are held.">
    <ButtonSlot>
      <WifiOff />
    </ButtonSlot>
    <ButtonLabel>Offline</ButtonLabel>
    <ButtonSlot $kind="badge" $p="md" $layer="warning">
      3
    </ButtonSlot>
  </PopoverDisclosure>
  <Popover portal className="grid max-w-72 gap-2">
    <PopoverHeading>No connection</PopoverHeading>
    <PopoverDescription>
      3 decisions are held in this tab. They are sent when the connection returns.
    </PopoverDescription>
    <Button $lightnessOffset $size="sm">
      Try now
    </Button>
  </Popover>
</PopoverProvider>
```

### Idea 2 · "A newer run exists" banner

- What changes: when the run is replaced, one callout takes the place of the four texts and of the decision bar. It names the newer run and links to it. The images stay visible and get a "Replaced" mark. The same callout shape serves "Historical comparison" and "Archived" with other words (RESIL-21).
- Why it is better: the user gets the next step in one click. No sentence says "cannot be reviewed" above visible images, and no enabled-looking Approve button remains (RESIL-05).
- Variants for the lab: (a) callout above the viewer, (b) the decision bar becomes the banner (same place where the user's eyes are), (c) a modal prompt when the user has made no decision yet: "Open the newer run?".

```tsx
<Frame
  $layer="warning"
  $mix={12}
  $border
  $edge="warning"
  $rounded="xl"
  $p={3}
  role="status"
  className="flex w-full items-start gap-3"
>
  <Text $text="warning" className="flex h-lh items-center">
    <GitCommitHorizontal className="size-[1.25em]" />
  </Text>
  <div className="grid flex-1 gap-0.5">
    <Text className="font-medium">A newer run replaced this one</Text>
    <Text className="ak-ink-70 text-sm">
      Attempt 3 for commit 9f2c1ab arrived 4 minutes ago. Decisions here do not change the check.
    </Text>
  </div>
  <Button
    $layer="brand"
    $size="sm"
    render={<RouterLink to="/runs/$runId" params={{ runId: next }} />}
  >
    <ButtonLabel>Open attempt 3</ButtonLabel>
    <ButtonSlot>
      <ArrowRight />
    </ButtonSlot>
  </Button>
</Frame>
```

### Idea 3 · "This page is out of date" prompt after a deploy

- What changes: the client compares its build ID with the one on API responses. On a difference, on a chunk error, or on an unknown response format, a slim band appears under the header. It does not block reading. Decision controls stay enabled unless a response could not be read. If decisions are still in flight, the band says so and the button waits for them.
- Why it is better: one honest sentence and one button replace "Something went wrong!" with a module URL (RESIL-13), "This review format has changed. Refresh before reviewing." (RESIL-14), and the silent automatic reload.
- Variants for the lab: (a) band under the header, (b) toast at the bottom left, (c) a full error block only when the page cannot continue.

```tsx
<Frame
  $layer="brand"
  $mix={15}
  $p={2}
  role="status"
  className="flex items-center justify-center gap-3 border-b text-sm"
>
  <Text className="flex items-center gap-2">
    <RefreshCw className="size-[1em]" />
    Visonaut was updated. Reload to get the new version.
  </Text>
  <Button $layer="brand" $size="sm">
    <ButtonLabel>Reload</ButtonLabel>
  </Button>
  <Button $size="sm">
    <ButtonLabel>Later</ButtonLabel>
  </Button>
</Frame>
```

### Idea 4 · Sign in again in place, with the held decisions kept

- What changes: on a 401 during a review, a dialog opens over the workspace. It lists the decisions that were not sent. "Sign in again" opens the GitHub flow in a new window. When it reports back, the page creates a new review session and sends the held commands with their IDs. The dialog then closes and the bar says "3 decisions saved."
- Why it is better: no lost work, no second tab to find, and no "Start a new review session" instruction without a control (RESIL-01, RESIL-02).
- Variants for the lab: (a) modal dialog, (b) the decision bar turns into a sign-in bar and the page behind it is dimmed, (c) full-page gate that shows the held decisions.

```tsx
<DialogProvider open>
  <Dialog className="grid max-w-88 gap-4">
    <DialogHeading>Your session ended</DialogHeading>
    <DialogDescription>
      3 decisions are held in this tab. Sign in again to save them.
    </DialogDescription>
    <ButtonGroup aria-label="Held decisions" $layout="vertical" $border $p={1}>
      <Button $p={2} className="justify-start text-start">
        <ButtonSlot $kind="avatar" $layer="success" $mix={20}>
          <Check className="size-1/2" />
        </ButtonSlot>
        <ButtonContent>
          <ButtonLabel>Success dialog · React</ButtonLabel>
          <ButtonDescription>Approve · not sent</ButtonDescription>
        </ButtonContent>
      </Button>
      {/* two more rows */}
    </ButtonGroup>
    <div className="flex justify-end gap-2">
      <Button>
        <ButtonLabel>Discard and leave</ButtonLabel>
      </Button>
      <Button $layer="brand">
        <ButtonSlot>
          <LogIn />
        </ButtonSlot>
        <ButtonLabel>Sign in again</ButtonLabel>
      </Button>
    </div>
  </Dialog>
</DialogProvider>
```

### Idea 5 · One error block: cause, reference, and the one valid action

- What changes: one component for each failed load and each failed command. Its content comes from one mapping of `(status, code)` (RESIL-08). Kinds: signed out, no access, wrong address, not found, replaced, unavailable (with a countdown from `Retry-After` and an automatic retry), offline, out of date, evidence missing. Each kind has one primary action. The support reference is a labeled field with a copy button. Technical text is behind "Details".
- Why it is better: the queue, the pull page, the run page, and the decision bar today have ten texts and four control sets for the same answers (matrix). A permanent state never shows "Retry" (RESIL-18).
- Variants for the lab: (a) card in the page center, (b) inline band inside the content area with the stale content dimmed below it, (c) compact one-line form for the decision bar.

```tsx
<Frame $lighten $border $rounded="2xl" $p="1rem" role="alert" className="grid max-w-md gap-3">
  <div className="flex items-start gap-3">
    <Text $text="warning" className="flex h-lh items-center">
      <CloudOff className="size-[1.25em]" />
    </Text>
    <div className="grid gap-1">
      <Heading className="mt-0 mb-0 text-base">Visonaut cannot load this run now</Heading>
      <Text className="ak-ink-70 text-sm">
        The service did not answer. The page tries again in 3 s.
      </Text>
    </div>
  </div>
  <div className="flex items-center gap-2 text-sm">
    <Text className="ak-ink-60">Reference</Text>
    <Code>af4a9c01</Code>
    <Button $size="sm" aria-label="Copy the full reference">
      <ButtonSlot>
        <Copy />
      </ButtonSlot>
    </Button>
  </div>
  <div className="flex gap-2">
    <Button $layer="brand" $size="sm">
      <ButtonLabel>Try now</ButtonLabel>
    </Button>
    <Button $size="sm" render={<RouterLink to="/" />}>
      <ButtonLabel>Review queue</ButtonLabel>
    </Button>
  </div>
</Frame>
```

Rows of the mapping, as content for the lab states:

```text
kind           title                               one action
signed-out     Your session ended                  Sign in again
no-access      You need write access to <repo>     Use another account   (shows the signed-in login)
wrong-address  Open Visonaut at visonaut.com       Open visonaut.com
not-found      This run does not exist             Open the review queue
replaced       A newer run replaced this one       Open attempt N
unavailable    Visonaut cannot load this now       Try now   (automatic retry with countdown, reference)
offline        No connection                       (automatic; "Try now")
out-of-date    Visonaut was updated                Reload
evidence       An image for this variant is gone   Open the workflow run
```

### Idea 6 · Stale-data mark: "Updated 4 min ago"

- What changes: each list and each run header has one small freshness control: relative time plus a refresh button. A refresh keeps the old content on screen and marks changed rows. The page reads again by itself when the tab becomes visible and the data is older than one minute. When a read fails, the text becomes "Updated 12 min ago · refresh failed" in the warning color. The bell already does this in words (RESIL-16).
- Why it is better: the user can trust or distrust what is on screen. The queue stops being silently hours old (RESIL-07), and "Refresh runs" no longer blanks the page (DASH-03).
- Variants for the lab: (a) text plus icon button in the page header, (b) inside the status line at the bottom, (c) a "3 new runs · Show" pill above the list (no automatic reorder under the pointer).

```tsx
<ButtonGroup aria-label="Data freshness" $size="sm" className="items-center">
  <TextFrame $p={2} $ink={60} className="text-sm tabular-nums">
    Updated 4 min ago
  </TextFrame>
  <Button aria-label="Refresh the run list">
    <ButtonSlot>
      <RotateCw />
    </ButtonSlot>
  </Button>
</ButtonGroup>
```

### Idea 7 · Receipt list for queued and failed decisions

- What changes: the decision bar has one summary control: "2 pending · 1 not applied". It opens a list of the user's decisions for this run with their state: sending, queued (with elapsed time), saved, not applied (with the reason in plain words). Each row jumps to its variant. A failed row has "Decide again". The list is built from the server after each load, so it survives a reload and a closed tab (RESIL-03). Variants in the sidebar and the chips show a small "pending" mark.
- Why it is better: "You can close this window" becomes true for the user and not only for the server. A queue that does not move becomes visible ("queued for 2 min"), with a link to Service status (RESIL-04).
- Variants for the lab: (a) popover from the bar, (b) a panel in the end sidebar beside Details, (c) an "Activity" tab that also shows other reviewers' decisions (RESIL-06).

```tsx
<PopoverProvider placement="top-start">
  <PopoverDisclosure $size="sm">
    <ButtonSlot>
      <ListChecks />
    </ButtonSlot>
    <ButtonLabel>2 pending</ButtonLabel>
    <ButtonSlot $kind="badge" $p="md" $layer="danger">
      1
    </ButtonSlot>
  </PopoverDisclosure>
  <Popover portal $p={2} className="grid w-80 gap-2">
    <PopoverHeading className="px-2 text-sm">Your decisions in this run</PopoverHeading>
    <ButtonGroup aria-label="Decisions" $layout="vertical" $p="none">
      <Button $p={2} className="justify-start text-start">
        <ButtonSlot $kind="avatar" $layer="danger" $mix={20}>
          <TriangleAlert className="size-1/2" />
        </ButtonSlot>
        <ButtonContent>
          <ButtonLabel>Open menu · Dark</ButtonLabel>
          <ButtonDescription>Not applied. octocat rejected it first.</ButtonDescription>
        </ButtonContent>
        <ButtonSlot $ink={40}>
          <ChevronRight />
        </ButtonSlot>
      </Button>
      <Button $p={2} className="justify-start text-start">
        <ButtonSlot $kind="avatar" $layer="brand" $mix={20}>
          <Clock className="size-1/2" />
        </ButtonSlot>
        <ButtonContent>
          <ButtonLabel>Success dialog · Solid</ButtonLabel>
          <ButtonDescription>Approve · queued for 12 s</ButtonDescription>
        </ButtonContent>
      </Button>
      <ButtonGlider $state="hover" />
      <ButtonGlider $state="focus" />
    </ButtonGroup>
  </Popover>
</PopoverProvider>
```

### Idea 8 · Decision bar with one message slot and one action

- What changes: the bar has a fixed layout: state icon, one sentence, at most one action, then the decision buttons. The sentence and the action come from the mapping of idea 5. Success fades after 3 s. A blocking state moves focus to the action and disables the decision buttons with a visible reason. A conflict says what the other person did.
- Why it is better: today the bar mixes status and alert roles, puts button labels inside the alert text, uses the same gray for success and failure (WORK-10), and shows two buttons of which one is often useless.

```text
saved      ✓  Approved. 8 left.                                   [Undo]        [Reject X] [Approve A]
queued     ◌  2 decisions queued (12 s)                           [Show]        [Reject X] [Approve A]
offline    ⚠  Offline. 3 decisions held.                          [Try now]     [Reject X] [Approve A]
conflict   ⚠  octocat rejected this variant 2 min ago.            [Decide again] [Keep theirs]
signed out ⚠  Your session ended. 1 decision held.                [Sign in again]
replaced   ⚠  A newer run replaced this one.                      [Open attempt 3]
read-only  🔒 Historical comparison 1 of 2. Read-only.            [Open the current comparison]
```

### Idea 9 · Sign-in failure inside the app

- What changes: a failed or cancelled GitHub sign-in returns to the page that the user came from, and the sign-in card shows the reason in one sentence. For a rate limit, the button is disabled with a countdown.
- Why it is better: the user stays in the product, keeps the deep link, and knows what to do (RESIL-19, RESIL-20). No third-party "Ask AI" link.

```tsx
<Frame $lighten $border $rounded="2xl" $p="1rem" className="grid max-w-sm gap-3">
  <Heading className="mt-0 mb-0 text-base">Sign in to review pull request #7</Heading>
  <Frame
    $layer="danger"
    $mix={12}
    $border
    $edge="danger"
    $rounded="lg"
    $p={2}
    role="alert"
    className="text-sm"
  >
    Sign-in did not finish: GitHub access was cancelled.
  </Frame>
  <Button $layer="brand" disabled>
    <ButtonSlot>
      <LogIn />
    </ButtonSlot>
    <ButtonLabel>Sign in with GitHub (8 s)</ButtonLabel>
  </Button>
</Frame>
```

## Open questions and items not verified

1. **Which branch of `/api/auth/error` does production take?** It depends on `process.env.NODE_ENV` inside the Worker at module load. `apps/web/wrangler.jsonc` sets no `NODE_ENV`, and the built chunk reads it at runtime (`apps/web/dist/server/assets/error-CzdqHglb.js:30-32`: `var nodeENV = env.NODE_ENV ?? ""; var isProduction = nodeENV === "production";`). My assumption is that it is not set, so the Better Auth HTML page is served. I did not send a request to production. One read-only check settles it: `curl -sI 'https://visonaut.com/api/auth/error?error=access_denied'`. A `200` with `text/html` is the built-in page. A `302` with `Location: /?error=…` is the silent redirect. RESIL-19 holds in both cases.
2. **Deploy skew in a production build.** Scenario 1 ran on the dev server. For production I derived the result from the chunk list and from the router source. I did not run a build, and I did not test a rollout that serves two versions at the same time. I also did not check if old hashed assets stay available after a deploy; if they do, old tabs keep working and RESIL-13 is rarer.
3. **The exact 409 text for a replaced run.** I used "Only the active complete comparison can be reviewed." (`packages/service/src/review-commands.ts:211`). A run with archived detail can answer "Archived history is read-only." (`:184`). The screen behavior is the same; the sentence in the bar can differ.
4. **Data for the "newer run" link.** `ReviewModel` has no successor field. I assume that the server can find the newer run from `lineage_key` and `attempt` in `visonaut_runs` (used in `api/review.ts:757-771`). I did not check the query or its cost.
5. **A second decision after a reload** (RESIL-03): I derived that it conflicts with the queued first decision. I did not run this against the real service.
6. **A re-POST after a 404 receipt**: the matrix marks "Retry same command" as a working recovery there, because the POST admits the command again by `commandId`. This is derived from `api/review.ts:872-878`, not run against the real queue.
7. **Real background tabs.** I simulated `visibilitychange`. Browsers also throttle timers in hidden tabs, so the 60 s alerts poll and the 500 ms receipt poll run less often there than my counts show. The direction of the findings does not change.
8. **Other browsers.** All runs used Chrome. The raw network text ("Failed to fetch") and the chunk error text differ in Firefox and Safari. The router checks three message prefixes (`router-core/src/utils.ts:507-517`). The gap-cross-browser lane owns this.
9. **`403 invalid_identity` for a real user.** The server sends it when the user has not exactly one linked GitHub account (`packages/security/src/authorization.ts:44-47`). I do not know if a real account can reach this state.
10. **The client address for the auth rate limit.** If Workers do not pass `X-Forwarded-For` to the handler, all users share one bucket of 3 sign-in starts in 10 s for each path. AUTH-14 owns this; I only measured the library behavior.
11. **Images after sign-out.** The fixture uses `data:` image URLs. I did not check if `/images/<id>` stays readable in a signed-out tab (`api/index.ts:113-116` serves images before the session check).
12. **Back across documents.** Scenario 13 used the router history inside one document. A browser Back to an earlier document depends on the back/forward cache and on `Cache-Control: no-store`. The gap-cross-browser lane has a probe for it.
13. **Session lifetime in practice.** The probe shows a sliding 7-day session that each request after 1 day renews. An open dashboard polls each minute, so its session does not end by time. The realistic causes of RESIL-01 and RESIL-02 are a sign-out or account change in another tab, a restore (`apps/web/src/operations/recovery.ts:35` clears `session` and `ingest_review_sessions`), and a machine that sleeps for more than 7 days.
14. **Matrix verdicts.** The texts and controls in each cell are measured. The verdict words (`ok`, `wrong`, `dead`, `silent`) are my reading. `(n/r)` marks are my judgment from the server code about what each endpoint can answer.
