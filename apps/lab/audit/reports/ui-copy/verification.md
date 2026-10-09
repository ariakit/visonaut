# Verification: Copy, microcopy, and terminology

This file checks `report.md` in this folder, finding by finding. I did not write that report.

How I checked:

- I opened each cited file and compared the quoted text with the lines.
- I ran the auditor scripts again (`build-inventory.mjs`, `terms.mjs`, `measure.mjs`, `threshold.mjs`). The output is the same as in the report.
- I wrote two new scripts and ran them: `verify/verify.mjs` and `verify/session.mjs`. The raw output is quoted below. New screenshots are in `verify/screens/`.
- I read the binding contract. `docs/current-contract.md:7` says: "Every saved issue #1 requirement remains binding unless an explicit approved rule below supersedes it." The saved requirements are in `docs/simplification-audit/contract-issue-1.md`. The report does not cite that file. Its section "Review UI and keyboard behavior" (lines 245-280) and line 292 change several findings. See COPY-02, COPY-04, COPY-05, COPY-08, COPY-11, and "Missed".
- I opened the cited screenshots with the image reader.

Short paths: `web/` means `apps/web/src/`. `issue-1` means `docs/simplification-audit/contract-issue-1.md`. Repository root: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`.

Verdict summary:

| ID      | Verdict                                    | Auditor severity | My severity |
| ------- | ------------------------------------------ | ---------------- | ----------- |
| COPY-01 | confirmed                                  | high             | medium      |
| COPY-02 | confirmed (facts), word choice is judgment | high             | medium      |
| COPY-03 | confirmed                                  | medium           | medium      |
| COPY-04 | confirmed, and worse than reported         | high             | high        |
| COPY-05 | partly-confirmed                           | high             | high        |
| COPY-06 | confirmed (facts), layout is judgment      | medium           | medium      |
| COPY-07 | partly-confirmed                           | medium           | medium      |
| COPY-08 | partly-confirmed                           | medium           | medium      |
| COPY-09 | confirmed                                  | medium           | medium      |
| COPY-10 | confirmed, and worse than reported         | medium           | medium      |
| COPY-11 | partly-confirmed                           | medium           | low         |
| COPY-12 | partly-confirmed                           | medium           | medium      |
| COPY-13 | confirmed                                  | medium           | low         |
| COPY-14 | confirmed (facts), style is judgment       | low              | low         |
| COPY-15 | confirmed                                  | low              | low         |
| COPY-16 | partly-confirmed                           | low              | low         |
| COPY-17 | confirmed                                  | low              | low         |
| COPY-18 | confirmed                                  | low              | low         |

No finding is refuted. Six findings have a wrong detail or a recommendation that is not correct as written.

## COPY-01

- Verdict: confirmed.
- Severity: medium (auditor: high). The control is disabled and is in the page footer, below the first viewport at 1440 × 900. It does not block a task.
- Proof:
  - `web/api/review.ts:592-598`: `recompareAllowed: false,` with no condition, and a reason string in each branch.
  - `web/review/client.ts:355-360`: the production command object always has `recompare`. `web/routes/runs.$runId.tsx:161` uses it. So `commands.recompare && !model.preview` is true for each production run.
  - `web/review/review-workspace.tsx:1186-1201`: the button and `<p>{recompareDisabledReason}</p>`.
  - `web/api/review.ts:950-987`: each branch of `POST /api/runs/:id/recompare` throws.
  - `docs/current-contract.md:77`: "Stored recomparison is disabled, including for active legacy runs." `docs/review-guide.md:88`: "**Recompare stored run** is retired."
  - Screens `50-workspace-default-dark-1440-full.png`, `58-workspace-archived-dark-1440-full.png`, `70-workspace-mobile-dark-390-full.png` show the button and the sentence. I counted the words of the sentence: 20.
- Corrections:
  1. The title says that each run page shows the 20-word sentence. That is true only for an active local run. A closed run shows `This closed review is read-only. Capture a new complete run.` (10 words). An active legacy run shows `Server recomparison is retired. Capture a new complete run with trusted local Submit.`
  2. Do not remove the two model fields in the same release as the button. The client treats a missing field as "allowed":

     ```ts
     // web/review/review-workspace.tsx:328 and web/review/use-review-session.ts:150
     const recompareAllowed = !model.archived && (model.recompareAllowed ?? true);
     ```

     A browser tab with the old bundle and a new API response without the field would enable `Recompare stored run`. Remove the client code first. Remove the server fields in a later release, or continue to send `false`. `docs/operations/retire-server-comparison.md:17` also names the field ("Review models set `recompareAllowed: false`").

  3. The footer `<p>` has no class. In the screenshots it is larger than the 12 px buttons beside it.
  4. Three browser tests set `recompareAllowed` to `true` and must change with the removal: `web/review/__tests__/route.browser.test.ts:301`, `web/review/__tests__/review.browser.test.ts:899` and `:1516`.

## COPY-02

- Verdict: confirmed for the facts. The choice of the word set is a judgment.
- Severity: medium (auditor: high). It is an inconsistency. It does not cause a wrong action.
- Proof: each cited line exists and has the quoted word. Examples: `review-workspace.tsx:549-552` (`Screenshots`, `items`), `:728` (`Variants`), `:832` (`Image view`), `:1055` (`changed views`), `:1077` (`Reject view`), `use-review-session.ts:364` (`variant… Saved.`), `screenshot-viewer.tsx:38` (`Baseline`/`Current`/`Difference`), `:218` (`Reference`), `:229` (`New image`), `item-list.tsx:378` (`Accepted (n)`), `operations-attention/index.tsx:388` (`Active captures`). `node terms.mjs` gives the same counts as M3. Screen `77-workspace-details-after-save-dark-1440.png` shows `1 variant approved. Saved.` beside `Reject view` and `All 7 changed views…`.
- Corrections:
  1. Some of the "competing" words are binding contract words. A rename needs an explicit approved change in `docs/current-contract.md`, not only a string edit.
     - `issue-1:263`: "Automatically accepted additions/removals remain visible, marked “Accepted automatically”". The terminology table proposes `Auto-approved`.
     - `docs/current-contract.md:194`: "Ordinary accepted and unchanged items stay under **Accepted**." Idea R14 proposes `Done · 1`.
     - `issue-1:264` and `:276`: the mode names are "Side-by-side", "Pixel diff", "New-only". The help dialog and the guide use these words. The buttons `Compare`, `Difference`, `Current`, `Baseline` are the outliers.
     - `issue-1:277`: "Undo the last eligible saved command". The word "command" comes from the contract.
  2. The cause of the drift is known. Commit `f83fef6` (PR #252, "Implement the Inbox review interface", 2026-10-05) changed 21 UI files and did not change `docs/review-guide.md` (last change: PR #228).

## COPY-03

- Verdict: confirmed.
- Severity: medium.
- Proof: I compared the table with the code, row by row. `web/routes/index.tsx:130-140` (`stateLabel`), `web/review/use-review-session.ts:57-80` (`runStatusLabel`), `web/review/review-workspace.tsx:134-145` and `:956-964`, `web/routes/pulls.$pullNumber.tsx:257-261`. All 20 labels match. The dashboard and the workspace use the same status values (`packages/service/src/review-status.ts:76-95`). Screen `59-workspace-needs-recompare-dark-1440-full.png` shows three wordings on one page, and the footer sentence is a fourth.
- Corrections:
  1. The proposed map must keep two more keys. `compared` is the status of a historical comparison (`web/api/review.ts:566-572`). `reviewing` is in the preview fixture (`web/review/preview-fixtures.ts:84`).
  2. The pull request page shows a check state (`pending`, `failed`, `not-required`), not a run status. Its `pending` covers "no run yet" and "run not sealed" (`web/api/review.ts:773-777`).

## COPY-04

- Verdict: confirmed. The real case is worse than the report says.
- Severity: high. Confidence: high for the code path. I did not see production data.
- Proof:
  - Consumer key: `/Users/diegohaz/Developer/ariakit/app/src/test-utils/visual.ts:477-487`.
  - Server label: `web/api/review.ts:469-482`. Pill text: `web/review/variant-summary.tsx:84-87` and `:117` (`max-w-48 truncate`). Accessible name: `web/review/review-workspace.tsx:776`.
  - Screens `76-workspace-real-variant-keys-dark-1440.png` and `-batch.png` show what the report says.
- Corrections:
  1. The report built keys with `default-default`. The consumer default is different. `visual.ts:413-414` sets `viewports = { default: … }` and `styles = defaultStyles`, and `defaultStyles` is `{ light, dark }` (`visual.ts:91-94`). So a normal key is `react-chrome-default-light-light-no-preference-none` or `react-chrome-default-dark-light-no-preference-none`.
  2. `withStyles` (`visual.ts:263-293`) sets CSS variables only. It does not emulate a dark color scheme. So `media.colorScheme` is `light` for the `light` style and for the `dark` style. The five label parts are then equal, and only the key is different.
  3. I measured this case (`node verify.mjs m5`):

     ```text
     "pillWidths": [413, 410, 406, 406, 390, 390, 384], "navWidth": 1120, "fullyVisible": 2
     "visibleIconText": ["React Chromium Light", "React Chromium Light"]
     M5 visible key prefix {"clientWidth":144,"visibleCharacters":21,"visible":"react-chrome-default-"}
     ```

     The key is cut after `react-chrome-default-`. The word `light` or `dark` comes after the cut. Pills 1 and 2 show the same text. See `verify/screens/m5-real-style-keys.png`. A reviewer cannot tell the light style from the dark style in the pill row.

  4. The recommendation "show only the parts that differ" is not sufficient. The five parts do not differ. The data that differs is `variant.dimensions` (`project`, `viewport`, `style`), which the consumer sends (`visual.ts:491-495`) and the protocol accepts (`packages/protocol/src/types.ts:20`). The server does not put it in `labelParts`:

     ```ts
     // web/api/review.ts:470-477: no entry for variant.dimensions
     ["framework", variant.framework], ["browser", variant.browser], ["colorScheme", variant.colorScheme],
     ["contrast", variant.contrast], ["forcedColors", variant.forcedColors], ["key", row.variant_key],
     ```

     A chip design needs `dimensions.style` and `dimensions.viewport` as parts.

  5. `issue-1:261` requires "full variant label" as the third priority after run identity and item name. `docs/review-guide.md:23` says "The full variant label and result appear above the image controls." The current pill already fails this (the label is cut). A design that moves the key to a tooltip changes a binding requirement and needs an explicit approval.

## COPY-05

- Verdict: partly-confirmed. The measurements are correct. Part of the recommendation conflicts with the binding contract.
- Severity: high.
- Proof (`node verify.mjs m4`):

  ```text
  M4 1440x900 {"resultHeading":{"top":154,"height":59},"variants":{"top":233,"height":38},"viewControls":{"top":286,"height":55},"paneCaption":{"top":342,"height":48},"imageTop":408,"imageHeight":370,"actions":{"top":817,"height":61}}
  needs-review occurrences 6
  M4 390x844 {"viewControls":{"top":359,"height":92},"paneCaption":{"top":452,"height":48},"imageTop":518,"imageHeight":235,"actions":{"top":731,"height":91}}
  ```

  408 / 900 = 45%. 518 / 844 = 61%. The offsets are relative to the workspace root, so the 24 px test row is not included. At 1440 × 900 the image area between the caption and the sticky action bar is 409 px high.

- Corrections:
  1. The meta strip is deliberate. `issue-1:260`: "Item list on the left; selected images in the center; review actions next to the result; commit/run identity above." `issue-1:261`: "Prioritize run identity, item name, full variant label, review state, image evidence, then secondary metadata." `docs/review-guide.md:17`: "Check the run identity above the images before you save a decision. A new workflow attempt is a separate run." The recommendation "Remove the meta strip. Put commit and attempt in the details panel" removes the commit and the attempt from above the images. That needs an explicit approved change. A merged header that keeps the commit and the attempt in the run bar satisfies the contract and removes one band.
  2. The phrase "need review" is contract wording. `issue-1:261`: "Show counts such as “2 of 6 need review,” not only “changed.” Counts and text must accompany color." Three of the six occurrences (the sidebar rows) and the run bar count implement this line. The other two (`Changes need review` and the badge) are the true repeats.
  3. `Baseline revision {n}` is not in those contract lines. Its removal from the strip has no contract conflict.

## COPY-06

- Verdict: confirmed for the facts. "One dense list" is a judgment.
- Severity: medium.
- Proof: `node verify.mjs copy07` with one mocked `main` run:

  ```text
  COPY-06 header text "ARIAKIT/ARIAKIT Your review queue. 1 run is ready for review. Refresh runs 1 Runs to review 1 Awaiting approval 0 Rejected views READY TO REVIEW Main Needs review Main 1 view await approval. c3d4e5f6c3d4 Attempt 1 Oct 5, 2026, 6:30 AM Review changes Baseline revision 27 View history"
  ```

  `sips` gives 1440 × 1515 and 390 × 1648 for the queue captures, as reported. `node measure.mjs` gives 149 words, 6 × `Attempt`, and 20 × `Attempt` for history. `web/api/dashboard.ts:57-62` sets `title` only for pull request runs, so a `main` run and a merge queue run always show the kind label twice (`web/routes/index.tsx:490` and `:499`).

- Corrections:
  1. "Count of ready runs three times" is two counts (`:437` and `:452`) and one section heading without a number (`:471`).
  2. The repository name is in the header only at 1280 px and wider (`web/components/app-shell.tsx:38`: `hidden xl:block`).
  3. The history caption `Latest 100 runs` (`index.tsx:691`, screen reader only) is a fourth statement of the limit.

## COPY-07

- Verdict: partly-confirmed. Four of five items are correct. One assumption is wrong for additions.
- Severity: medium.
- Proof:
  - `1 view await approval.`: measured, see the output in COPY-06. Code: `web/routes/index.tsx:502`.
  - `All 1 changed views…` and `All 0 changed views…`: `web/review/review-workspace.tsx:1055`, screens `63-…png` and `62-…png`.
  - Threshold: `node threshold.mjs` gives `{"threshold":0.2,"maxDiffPixels":0} => "Color threshold 0.2; maximum 0 pixels; "`.
  - `Comparison {n}`: `web/api/review.ts:602` (`selectedComparison?.ordinal ?? run.revision`), `packages/service/src/review-commands.ts:225` (`runRevision: run.revision + 1,`), `web/review/navigation.ts:137` (`comparisonRevision: result.runRevision,`). The number changes with each saved decision.
- Corrections:
  1. The trailing `; ` is the normal production text, not an edge case. The Ariakit configuration is `threshold: 0.2, maxDiffPixels: 0` (`/Users/diegohaz/Developer/ariakit/app/playwright.config.ts:54-55`). The adapter also adds `maxDiffPixels: 0` when no limit is set (`packages/playwright/src/comparison.ts:68-69`).
  2. `— changed pixels` is true for removals and false for additions.
     - Removal: the row has no result. `packages/service/src/local-comparison.ts:247`: `resultJson: null,`. So `changedPixels` is undefined and the heading is `— changed pixels`.
     - Addition: the CLI records the full image area. `packages/cli/src/local-comparison.ts:245-252`: `changedPixels: candidate.width * candidate.height, ratio: 1,`. The server requires `ratio` to be 1 when there is no reference (`web/api/local-comparison.ts:570`). The heading is then `100.00% changed · 240,000 changed pixels` for a 600 × 400 image. Screen `74-workspace-added-real-shape-dark-1440.png` does not show the production shape of an addition. The production text is a different defect: a new screenshot reads as "100% changed".
  3. The proposed `variant.kind` branches fix both cases.

## COPY-08

- Verdict: partly-confirmed.
- Severity: medium.
- Proof:
  - `web/components/screenshot-viewer.tsx:219`: `empty="New image, no reference"` with no condition. `:230-234`: `Removed, no new image` unless `variant.kind === "unchanged" && variant.candidateOmitted`.
  - `web/review/use-evidence.ts:80-85`: a missing reference on a variant that is not `added` sets `Required reference evidence is unavailable in this comparison.`
  - `web/review/review-workspace.tsx:924-930`: the hint has no mode condition.
  - Screens `63`, `64`, `69` show the texts.
- Corrections:
  1. "The text does not depend on `variant.kind`" is not exact. The Current pane text depends on `kind === "unchanged"`. It does not separate `added`, `removed`, and the error case. That is the defect.
  2. Screen `62` (both panes empty on a pending variant) is a fixture state. I found no production path that gives a pending row without both images. With local comparison the rows are inserted with their final outcome (`packages/service/src/local-comparison.ts:325-327`). Do not count `62` as proof of a false statement. Screen `69` is a real error path.
  3. The two strings are contract text. `issue-1:265`: "For a new image, distinguish an intentionally absent reference from a reference-load error. For a removal, F shows “Removed, no new image”; S shows the old image and a labeled empty pane. D is unavailable when either paired image is absent; keep the current view and explain why." `docs/review-guide.md:39` quotes both strings. This has two effects:
     - The defect is stronger than reported. Screen `69` shows `New image, no reference` for a missing reference. That does not "distinguish an intentionally absent reference from a reference-load error".
     - The rewrite `Removed` for `Removed, no new image` changes a string that the contract names. It needs an approved change and a guide edit.
  4. Alternative (b), "remove only the always-on hint", removes the only visible explanation. When the user presses `D` or clicks `Difference`, the explanation goes to a screen-reader-only element:

     ```tsx
     // web/review/review-workspace.tsx:377-381 and :1202
     setAnnouncement(
       "Pixel diff requires both a reference and a new image. The current view has not changed.",
     );
     <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
       {announcement}
     </p>;
     ```

     The contract says "explain why". A tooltip on the button (the main recommendation) keeps a visible explanation. The button uses `aria-disabled`, not `disabled` (`:854`), so it can take focus and a tooltip is feasible.

## COPY-09

- Verdict: confirmed.
- Severity: medium.
- Proof: I compared each cell of the table with the code. `web/routes/index.tsx:277`, `:287-308`, `:192`, `:220`, `:315`, `:333-335`; `web/routes/pulls.$pullNumber.tsx:66`, `:130`, `:181`, `:187-191`, `:201`; `web/routes/runs.$runId.tsx:70`, `:80`, `:95`, `:179`, `:228-230`, `:238`. All match. Measured (`node verify.mjs copy09`, HTTP 403 on the first load of `/?view=history`):

  ```text
  copy09-dashboard-403 "Repository access required Your repository access changed. Write access to this repository is required. Retry Use another account"
  ```

  Screens `19`, `40`, `41` show the texts. On the run page the header has no account control (`runs.$runId.tsx:58`: `<AppHeader />`), so a signed-in user without access cannot sign out there.

- Corrections:
  1. The sketch uses `repository="ariakit/ariakit"` for the guest state and the forbidden state. The client does not know the repository in these states. HTTP 401 and HTTP 403 bodies are `{ error: { code, message } }` (`web/api/index.ts:38-44`). The repository comes only with a successful `/api/runs` or `/api/runs/:id` response. The gate needs a server change, or it must say "this repository".
  2. The three pages map each HTTP 403 to the write-access sentence. The server has four different 403 codes for a browser request: `not_maintainer` (`packages/security/src/github.ts:227`), `invalid_identity` (`packages/security/src/authorization.ts:46`), `wrong_origin` (`web/api/index.ts:111`), `invalid_origin` (`packages/security/src/http.ts:23`). A wrong origin (a deployment fault) shows `Repository access required`. See "Missed" item 5.
  3. "Loading: skeleton, no sentence" must keep a status for assistive technology. The three loading texts have `role="status"` today.

## COPY-10

- Verdict: confirmed. One state is worse than reported.
- Severity: medium.
- Proof (`node verify.mjs copy10`, route fixture, mocked API):

  ```text
  COPY-10 409 review_session_expired => "Conflict. Start a new review session after signing in. Refresh current state"
  COPY-10 401 sign_in_required => "Not saved. Sign in with GitHub. Retry same command Refresh current state"
  COPY-10 409 incomplete => "Conflict. The requested record does not exist. Refresh current state"
  COPY-10 409 history_closed => "Conflict. Command replay has ended. The permanent decision summary remains available. Refresh current state"
  COPY-10 503 predecessor (plain Error on the server) => "Not saved. The service is temporarily unavailable. Reference: 11111111-2222-4333-8444-555555555555. Retry same command Refresh current state"
  ```

  Code: `web/review/client.ts:275`, `web/review/use-review-session.ts:274`, `web/api/index.ts:55-66`, `web/api/review.ts:628-632` and `:675-679`, `web/operations/review-queue.ts:35-39` (plain `Error`, caught only by the generic branch at `web/api/index.ts:67-83`).

- Corrections:
  1. The button `Refresh current state` cannot repair an expired review session. The client keeps the first session promise (`web/review/client.ts:293-303`). `refresh()` does not clear it (`:349-351`). Measured (`node session.mjs`):

     ```text
     first Conflict. Start a new review session after signing in. Refresh current state
     second Conflict. Start a new review session after signing in. Refresh current state
     {"sessionRequests":1,"commandSessions":["session-1","session-1"]}
     ```

     After the refresh, the second save sends the same `reviewSessionId` and fails again. Only a page reload recovers. A fix needs `sessionPromise = undefined` on this error code, or a real page reload behind the proposed `Reload` button.

  2. Alternative (b), "return distinct statuses", changes the API contract. `docs/current-contract.md:83`: "Known authorization, validation, incomplete-capture, and conflict responses keep their current status, message, and retry semantics without a support reference." The main recommendation (branch on `error.code` in the client) has no contract conflict.
  3. The code `conflict` does not always mean "another reviewer changed it". `ConflictError` also carries `This command ID already belongs to another decision.`, `The previous decision belongs to another review session.` (`review-queue.ts:30`, `:46`), and `Promoted history is read-only. …` (`packages/service/src/review-commands.ts:206-208`). The text `Changed by ${reviewer}.` is correct only when the response has `reviewer`.
  4. The client must first keep the code. `ReviewCommandError` has no `code` field today (`client.ts:274-280`).

## COPY-11

- Verdict: partly-confirmed. The strings exist. One detail is wrong, and the proposed panel removes fields that the contract requires.
- Severity: low (auditor: medium). Most of these strings are in a panel that is closed by default, or in rare states.
- Proof: all cited lines match (`web/routes/index.tsx:404`, `:547`, `:589`, `:717-718`; `web/review/review-workspace.tsx:139`, `:469-474`, `:490-522`, `:615-618`, `:702`, `:811-812`, `:960`; `web/api/review.ts:102`, `:547`, `:583`, `:597`, `:972`; `web/operations/closed-summary.ts:17-18`). `Original comparison` has no condition (`review-workspace.tsx:474`).
- Corrections:
  1. A digest is 64 hexadecimal characters with no `sha256:` prefix (`packages/protocol/src/hash.ts:46-49`). The "71-character" value is from the auditor's fixture.
  2. `issue-1:292`: "Show changed pixel count, ratio, dimensions, engine, and threshold." The sketch in the recommendation and in idea R10 has no engine row. "Copy debug info" does not show it. Alternative (b), a "Technical details" disclosure, keeps the field visible on request.
  3. `Attempt` and the commit are run identity, which the contract puts above the images (see COPY-05). `Baseline revision`, `Comparison {n}`, and `decision revision {n}` are not in the contract lines.

## COPY-12

- Verdict: partly-confirmed. The texts and counts are correct. The recommendation is not feasible as written.
- Severity: medium.
- Proof: all line numbers are in `web/components/operations-attention/index.tsx` and match. I counted the titles: 9 of 12 end with `needs attention`. I counted the bodies: 15, from 12 words (`:141`) to 33 words (`:121`). `activeRuns` is under the label `Active captures` (`:388`). Screens `12`, `13`, `23`, `24` show the texts.
- Corrections:
  1. The recommendation says "a link to the matching guide section" and uses `guide + "#backup"`. The guide has no such sections. `apps/web/src/operations/README.md` has 92 lines and five headings: "Durable decisions and sealed recovery", "Baselines and closed history", "Conversion before deployment", "Manual evidence export", "Native database recovery". I counted these words in it: `webhook` 0, `redeliver` 0, `backup row` 0, `admission limit` 0, `shard` 0. So the alert bodies are the only place for the webhook, backup, capacity, and staged-capture steps. This answers the auditor's open question. The text must move into the guide before the bodies can be cut.
  2. `docs/review-guide.md:7` says: "Each alert gives a recovery action, the affected subject, and first-seen and last-seen times." A design that shows only a relative time must keep both times available.
  3. "Refresh rule three times" is too strong. The page has one sentence about the automatic check (`:331`), one time stamp (`:343`), and one button (`:360`). Only `No external notifications are sent.` is a true repeat (popover `:336`, page `:465`, and `README.md:17`).
  4. The empty state says "no alerts" twice: `No unresolved operation alerts. Last checked …` (`:343`) and `No unresolved alerts.` (`:439`). The report does not list this.

## COPY-13

- Verdict: confirmed.
- Severity: low (auditor: medium). These are consistency problems. They are not WCAG failures.
- Proof (`node verify.mjs m9`, Playwright accessibility snapshot):

  ```text
  - group "Image view":
    - button "Compare S" [pressed]
    - button "Difference D"
    - button "Current F"
    - button "Baseline G"
  - region "Review actions":
    - button "Reject view X"
    - button "Approve & next A"
  - figure "Baseline 600 × 400":
    - img "Reference"
  - figure "Current 600 × 400":
    - img "New image"
  ```

  Code: `web/components/screenshot-viewer.tsx:38`, `:120-121`, `:218`, `:229`, `:245`.

- Corrections:
  1. WCAG 2.5.3 (Label in Name) applies to controls with a visible text label, and asks that "the name contains the text that is presented visually" (https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html). `Approve & next A` contains `Approve & next`, so it passes. An image `alt` under a caption is not a control label.
  2. "Every alert announcement starts with `Service attention:`" is not exact. One starts with `Service alert update {n}:` (`operations-attention/index.tsx:259`).
  3. The recommendation is feasible, and the repository already has both parts. `aria-keyshortcuts` is on the sidebar button (`review-workspace.tsx:574`). An `aria-hidden` shortcut hint is on the variant index (`variant-summary.tsx:129`). MDN says that the attribute "has no effect on the functionality of the page" and that shortcuts must stay "visible to sighted users" (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts). So keep the visible letter.
  4. The change breaks at least ten test locators such as `getByRole("button", { name: "Approve & next A", exact: true })` (`route.browser.test.ts:74`, `:315`, `:586`, `:671-672`; `review.browser.test.ts:242`, `:253`, `:444`, `:475`; `scale.browser.test.ts:228`).

## COPY-14

- Verdict: confirmed for the facts. The style rule is a judgment.
- Severity: low.
- Proof: I checked the 11 titles with a period and the titles without one. All cited lines match.
- Corrections: the report asks if the period is a brand style. One more piece of evidence: the logo text is `visonaut.` with a period (`web/components/app-shell.tsx:34`). The three page titles and the hero follow the logo. The status titles on the pull request page and the empty states are the mixed cases.

## COPY-15

- Verdict: confirmed.
- Severity: low.
- Proof: `web/components/user-menu.tsx:24`; no caller passes `login` (`web/routes/index.tsx:258-263`, `web/routes/runs.$runId.tsx:207-212`); `rg "/api/session" apps/web/src` finds only the server route (`web/api/review.ts:713`); the only `head` is in `web/routes/__root.tsx:6-10`. The reviewer value is the numeric GitHub user ID: `web/api/review.ts:500` (`reviewer: effective.actor_id`), `:857`, `:902`, and `packages/security/src/authorization.ts:48` (`numericId(account.accountId)`). Screen `14-queue-user-menu-dark-1440.png` shows `Account`.
- Corrections:
  1. The `head` sample does not type-check. `loaderData` is optional (`node_modules/.pnpm/@tanstack+router-core@1.171.32/node_modules/@tanstack/router-core/dist/esm/route.d.ts:307`: `loaderData?: ResolveLoaderData<TLoaderFn>;`), and the run loader returns a union (`runs.$runId.tsx:37-47`). A correct form:

     ```tsx
     head: ({ loaderData }) => ({
       meta: [{
         title: loaderData?.status === "ready"
           ? `${loaderData.model.run.title ?? "Run"} · Visonaut`
           : "Visonaut",
       }],
     }),
     ```

     A child title replaces the root title: "title tags defined in nested routes will override a title tag defined in a parent route" (https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management).

  2. The dashboard route and the pull request route have no loader. They load data in an effect. They need `document.title` in that effect, or a loader.

## COPY-16

- Verdict: partly-confirmed.
- Severity: low.
- Proof (`node verify.mjs copy16`, real preview on port 4310):

  ```text
  COPY-16 body "visonaut. Preview fixtures Review queue Run history Service status Preview account Preview fixtures · GitHub login is disabled PREVIEW FIXTURES Your review queue. … Attempt 1 Dec 31, 1969, 9:00 PM Review changes No baseline yet View history"
  COPY-16 'Preview fixtures' count 3
  COPY-16 timezone America/Sao_Paulo Wed Dec 31 1969 21:00:00 GMT-0300 (Brasilia Standard Time)
  ```

  Code: `web/review/preview-fixtures.ts:86` (`createdAt: 0,`) and `:107` (`checkedAt: 0`).

- Corrections:
  1. `Preview fixtures` is on the queue screen three times, not four. The fourth item is `Preview account`. The report's own screenshot table says "three times".
  2. The year depends on the time zone. In UTC and to the east of it the text is `Jan 1, 1970`.
  3. Two strings are test-enforced: `route.browser.test.ts:568` (`Preview fixtures · GitHub login is disabled`) and `:583` (the banner, exact text).

## COPY-17

- Verdict: confirmed. One of the six items is weak.
- Severity: low.
- Proof: `docs/review-guide.md:15`, `:31-34`, `:39`, `:76-77`, `:88`, `:92` have the quoted names. The buttons are at `web/review/review-workspace.tsx:584`, `:845-888`, `:976`.
- Corrections:
  1. The "digests" item is weak. The guide says "the image dimensions, digests, profiles, comparison engine, policy, and threshold". The panel shows the policy digest and two profile digests (`review-workspace.tsx:510-517`). Only an image digest row is absent.
  2. The guide uses the contract names (see COPY-02). So "update the guide" is one option. The other option is to change the buttons back to the contract names.
  3. More drift that the report does not list:
     - `docs/review-guide.md:45`: "Choose **Approve** or **Reject**". The buttons are `Approve & next` and `Reject view`.
     - The guide key table (`:69-80`) has no `[` row. The help dialog has it (`review-workspace.tsx:178-179`).
     - `docs/review-guide.md:82`: "A first visit uses the first variant." The code selects the first variant that needs review (`review-workspace.tsx:359-362`). `issue-1:271` has the same rule ("First visit uses its first variant"). This is a behavior difference, not a copy difference.

## COPY-18

- Verdict: confirmed.
- Severity: low.
- Proof: I checked each of the twelve strings.
  - `pendingComparison` becomes true only in `recompare()` (`web/review/use-review-session.ts:532`), and `recompare()` returns at `:509`.
  - `rg -n "noop" …` gives the same nine lines as M10. No line assigns `noop: true`.
  - The server always sends `readOnlyReason` with `archived` (`web/api/review.ts:577-588`) and always sends `recompareDisabledReason` (`:593-598`).
- Corrections:
  1. The open question about `noop` has an answer. `git log -S"noop: true" -- packages apps/web/src` shows two commits: `43552ce` added the producer and `5712036` (PR #155) removed it. A stored result with `noop: true` can exist in the database. The service returns a stored result only for the same command ID with the same request JSON (`packages/service/src/review-commands.ts:98-101`). A new page makes new random IDs (`use-review-session.ts:431`). So the branch is not reachable from the current client.
  2. The string `This closed review is read-only. Capture a new complete run.` is still visible in production. It comes from the server (`web/api/review.ts:595`). Only the client copy at `review-workspace.tsx:331` is dead.

## Missed

1. Binding contract text for the review UI. The report never cites `docs/simplification-audit/contract-issue-1.md:260-265`, `:280`, `:292`, or `docs/current-contract.md:7`, `:83`, `:194`. Five rewrites change strings or fields that these lines name: `Accepted automatically`, `Accepted`, `Removed, no new image`, `{n} of {m} need review`, and the engine row. Idea R11 moves the shortcut toggle into a dialog; `issue-1:280` says "Provide visible buttons and a shortcut toggle."
2. Light and dark style variants look the same in the variant row with the consumer's default keys. The server has `variant.dimensions` and does not send it (`web/api/review.ts:470-477`). Measured in COPY-04.
3. An added screenshot shows `100.00% changed · {full image area} changed pixels` (`packages/cli/src/local-comparison.ts:245-252`, `web/review/review-workspace.tsx:646-647`).
4. After `review_session_expired`, `Refresh current state` cannot recover, because the client keeps the old session ID (`web/review/client.ts:293-303`). Measured in COPY-10.
5. The three pages map every HTTP 403 to "write access required". `wrong_origin`, `invalid_origin`, and `invalid_identity` get the same text as `not_maintainer`.
6. An unknown run ID gives HTTP 409 and the page `This run could not be opened` / `The requested record does not exist.` with a `Retry` button (`packages/service/src/service.ts:92-98`, `web/api/index.ts:55-66`, `web/routes/runs.$runId.tsx:76-111`). A "not found" state looks like a temporary error.
7. The explanation for an unavailable pixel diff goes only to a screen-reader element when the user presses `D` (`web/review/review-workspace.tsx:377-381`, `:1202`). A sighted keyboard user gets no feedback at that moment.
8. The disabled `Approve & next` button keeps its full brand color. `Reject view` beside it is dimmed. See screens `04`, `58`, `59`, `62`. On a read-only run, text is the only cue. This belongs to the visual lane.
9. The operations guide has no text for the webhook, backup, capacity, and staged-capture alerts. Measured in COPY-12.
10. The pull request page says `Open the latest check on GitHub` for HTTP 404 and offers only `Retry` (`web/routes/pulls.$pullNumber.tsx:71`, `:216-223`). The report has this only in a screenshot caption.
11. The service status empty state says "no alerts" twice (`web/components/operations-attention/index.tsx:343`, `:439`). The page column also changes width between the alert state and the empty state (screens `12` and `23`).
12. Dates use the browser locale (`toLocaleString(undefined, …)`) in an English-only UI. A reviewer with a `pt-BR` browser gets Portuguese dates between English words.
