# Copy, microcopy, and terminology

Scope: every user-visible string in `apps/web/src/routes`, `apps/web/src/components` (not the vendored `ariakit` folder), and `apps/web/src/review`, plus the server text that reaches these screens. All source paths are relative to the repository root. Screenshot names are relative to `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-copy/screens/`.

## How it works (map)

The app has no string module and no translation layer. Copy lives in seven places.

| Mechanism                                                               | Where                                                                                                                                                                                                                                                                                 | Example                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Inline JSX text and attributes                                          | All route and component files                                                                                                                                                                                                                                                         | `apps/web/src/routes/index.tsx:433` `Your review queue.`                                                           |
| Label functions that map a state to words                               | `apps/web/src/routes/index.tsx:123-140` (`kindLabel`, `stateLabel`), `apps/web/src/review/use-review-session.ts:57-80` (`runStatusLabel`), `apps/web/src/review/navigation.ts:165-175` (`verdictLabel`), `apps/web/src/components/operations-attention/index.tsx:98-199` (`recovery`) | `if (state === "incomplete") return "Waiting for screenshots";`                                                    |
| `throw new Error("…")` in client parsers. The UI prints `error.message` | `apps/web/src/routes/index.tsx:75-121`, `apps/web/src/review/client.ts:15-66`, `apps/web/src/review/navigation.ts:96-133`                                                                                                                                                             | `The service returned an invalid numeric field.`                                                                   |
| Review model fields that the server fills with sentences                | `apps/web/src/api/review.ts:97-102`, `:538-549`, `:577-598`                                                                                                                                                                                                                           | `readOnlyReason`, `recompareDisabledReason`, `rejectDisabledReason`, `approveDisabledReason`, `threshold`, `error` |
| Server error bodies `{ error: { code, message, reference } }`           | `apps/web/src/api/index.ts:35-84`                                                                                                                                                                                                                                                     | `The service is temporarily unavailable.`                                                                          |
| Save-state sentences built with template strings                        | `apps/web/src/review/use-review-session.ts:217-539`                                                                                                                                                                                                                                   | `` `${n} variant${n === 1 ? "" : "s"} ${verdict}. Saved.` ``                                                       |
| Screen reader announcements                                             | `apps/web/src/components/operations-attention/index.tsx:250-275`, `apps/web/src/review/review-workspace.tsx:347-380`, `apps/web/src/review/use-review-session.ts:367-428`                                                                                                             | `Service attention: all alerts resolved.`                                                                          |

Size of the copy (see Measurements, M1):

| Surface                                  | Strings | Words |
| ---------------------------------------- | ------- | ----- |
| App header and account menu              | 17      | 40    |
| Dashboard: loading, sign-in, errors      | 21      | 125   |
| Dashboard: review queue                  | 42      | 133   |
| Dashboard: run history                   | 18      | 69    |
| Pull request page                        | 28      | 161   |
| Run page: loading, sign-in, errors       | 12      | 64    |
| Service status page and alerts popover   | 71      | 596   |
| Workspace: chrome, navigation, item list | 51      | 136   |
| Workspace: header, variants, viewer      | 87      | 370   |
| Workspace: actions, save state, dialogs  | 85      | 513   |
| Workspace: details panel                 | 19      | 49    |
| Server text that reaches the review UI   | 57      | 488   |
| Total                                    | 508     | 2,744 |

How server text reaches the screen:

1. A server module throws `SecurityError(code, status, message)`, `ConflictError(message)`, or `IncompleteError(message)`.
2. `errorResponse` (`apps/web/src/api/index.ts:35-84`) returns the message. `ConflictError` and `IncompleteError` both become HTTP 409. Every other exception becomes HTTP 503 with `The service is temporarily unavailable.` and a `reference`.
3. The review client (`apps/web/src/review/client.ts:263-281`) builds `ReviewCommandError(message + " Reference: <id>.")` and sets `conflict: response.status === 409`.
4. Run page load: HTTP 401 opens the sign-in card. HTTP 403 shows a fixed client sentence. Every other status prints the server message below `This run could not be opened` (`apps/web/src/routes/runs.$runId.tsx:76-111`).
5. Save, Undo, and refresh: `reportError` (`apps/web/src/review/use-review-session.ts:260-278`) prints `Conflict. ` or `Not saved. ` followed by the server message.
6. The model fields render as a banner (`apps/web/src/review/review-workspace.tsx:689-710`), a line above the viewer (`:799-804`), button `title` attributes (`:1071`, `:1089`, `:1192`), and a footer paragraph (`:1199-1201`).
7. The dashboard and the pull request page do not print server messages. They map the HTTP status to their own sentences (`apps/web/src/routes/index.tsx:185-196`, `apps/web/src/routes/pulls.$pullNumber.tsx:59-73`).

Other conventions:

- Plurals are hand-written ternaries, one for each string (`apps/web/src/routes/index.tsx:437`, `:502`; `apps/web/src/components/operations-attention/index.tsx:253`; `apps/web/src/review/item-list.tsx:250-256`; `apps/web/src/review/use-review-session.ts:310`).
- Dates are absolute and use the browser locale: `toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })` (`apps/web/src/routes/index.tsx:153-157`, `apps/web/src/components/operations-attention/index.tsx:205-207`).
- Uppercase labels are sentence-case strings with a CSS `uppercase` class.
- The browser tab title is the constant `Visonaut` (`apps/web/src/routes/__root.tsx:10`).

In the findings below, short file names stand for these paths: `index.tsx`, `pulls.$pullNumber.tsx`, `runs.$runId.tsx`, and `__root.tsx` are in `apps/web/src/routes/`. `app-shell.tsx`, `user-menu.tsx`, `screenshot-viewer.tsx`, and `operations-attention/index.tsx` are in `apps/web/src/components/`. `review-workspace.tsx`, `item-list.tsx`, `screenshot-filter.tsx`, `variant-summary.tsx`, `navigation.ts`, `use-review-session.ts`, `use-evidence.ts`, `client.ts`, and `preview-fixtures.ts` are in `apps/web/src/review/`. `api/review.ts`, `api/index.ts`, and `api/input.ts` are in `apps/web/src/`. `review-queue.ts` and `closed-summary.ts` are in `apps/web/src/operations/`.

## Findings

### COPY-01 · Every production run page shows a disabled "Recompare stored run" button and a 20-word pipeline sentence

- Kind: copy
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `api/review.ts:592-598`: `recompareAllowed: false,` and `recompareDisabledReason:` with three possible sentences. The sentence for an active run that used local comparison is `"Run trusted Submit again from the complete CI bundle, or capture a new run. Unchanged candidate images were not uploaded."`
  - `review-workspace.tsx:1186-1201`: the footer renders `<ButtonLabel>Recompare stored run</ButtonLabel>` with `disabled={!recompareAllowed || …}` and then `<p>{recompareDisabledReason}</p>`.
  - `api/review.ts:950-987`: every branch of `POST /api/runs/:id/recompare` throws.
  - `docs/review-guide.md:88`: `**Recompare stored run** is retired.`
  - Screens: `50-workspace-default-dark-1440-full.png`, `70-workspace-mobile-dark-390-full.png`, `58-workspace-archived-dark-1440-full.png`.
- What happens: The server always sends `recompareAllowed: false` and always sends a reason. The client therefore always renders a button that cannot be enabled, and always prints the reason as a plain paragraph in the footer. On a read-only run the page shows two explanations: the banner (`This run is already in the baseline…`) and the footer (`This closed review is read-only. Capture a new complete run.`).
- Impact: The reviewer reads a sentence about "trusted Submit", "CI bundle", and "candidate images" on every review. The sentence is not about the task. On a 390 px screen it takes three lines. It is the longest sentence on a normal review page.
- Recommendation: Remove the button, the footer paragraph, and the two model fields. Keep one read-only banner.

  ```tsx
  // review-workspace.tsx footer, after
  <ShellFooter $height="sm" $p={3}>
    <ShortcutHelp />
  </ShellFooter>
  ```

- Alternatives: (a) Minimal: keep the fields, and hide the button and the paragraph when `recompareAllowed` is false. (b) Move the reason into the details panel under a "Rerun" row. (c) Keep a footer text only for a run in the `needs-recompare` state, and write it for a reviewer: `This run is out of date. Rerun the visual tests in CI.`
- Maintainer decision needed: yes. Does any deployed client still read `recompareAllowed` or `recompareDisabledReason`?

### COPY-02 · One concept has two to five names

- Kind: inconsistency
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence (count of inventory strings that contain each word, see M3):
  - Unit of review: `view` 11, `variant` 16, `item` 11, `screenshot` 19, `capture` 22. One screen uses four of them: `Screenshots` and `4 items` (`review-workspace.tsx:549-552`), `Variants` (`:728`), `All {n} changed views…` and `Reject view` (`:1055`, `:1077`), `1 variant approved. Saved.` (`use-review-session.ts:364`). Screen: `56-workspace-saved-dark-1440.png`.
  - `view` has three meanings: a variant (`Reject view`), a display mode (`aria-label="Image view"`, `review-workspace.tsx:832`), and a page (`This view reports operation alerts.`, `operations-attention/index.tsx:442`).
  - Old image: `Baseline` (button and caption, `review-workspace.tsx:888`, `screenshot-viewer.tsx:38`), `Reference` (image `alt`, `screenshot-viewer.tsx:218`), `original` (`review-workspace.tsx:175`).
  - New image: `Current` (button and caption), `New image` (`alt`, `screenshot-viewer.tsx:229`), `candidate` (`use-evidence.ts:92`, `api/review.ts:597`).
  - Difference: `Difference` (button), `Pixel diff` (6 strings), `red pixel diff` (help dialog).
  - Side by side: `Compare` (button, `review-workspace.tsx:845`), `Side by side` (help dialog `:175` and `docs/review-guide.md:31`).
  - Verdict: `Approved` (badge, filter), `Accepted automatically` (badge), `Accepted (n)` (group, `item-list.tsx:378`), `This acceptance is already saved.` (`use-review-session.ts:349`).
  - Save unit: `decision` in 9 client strings, `command` in 6 client strings (`Retry same command`, `Undo your last saved command in this session.`).
  - Images: `evidence` in 13 client strings (`Image evidence unavailable`, `Check the evidence before saving a new command.`).
  - `capture` means a run (`Active captures: 5 of 12`, `operations-attention/index.tsx:388`), one image (`Capture details`), and a CI job (`Visual capture failed.`).
- What happens: Each file picked its own word. The visible labels, the accessible names, the help dialog, the save messages, and the guide do not agree.
- Impact: The reviewer must learn that "view", "variant", and "changed view" are the same thing, and that "Reference" is "Baseline". Documentation breaks: the guide says "Pixel diff" and the button says "Difference".
- Recommendation: Use one word for each concept. See "Terminology table". Put the shared labels in one module so that each word has one source.

  ```ts
  // apps/web/src/review/words.ts
  export const mode = {
    side: "Side by side",
    diff: "Diff",
    new: "Current",
    original: "Baseline",
  } as const;
  export const paneCaption = { reference: "Baseline", candidate: "Current", diff: "Diff" } as const;
  ```

- Alternatives: (a) Minimal: change only the four visible outliers (`Reject view`, `All n changed views…`, `Rejected views`, `views await approval`) to "variant" or "change". (b) Use "Before" and "After" for the two images. This removes the domain word "baseline" from the viewer.
- Maintainer decision needed: yes. Which word set do you want: "screenshot / variant / change" with "Baseline / Current", or another set?

### COPY-03 · The same run status has two or three different labels

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `index.tsx:130-140` (dashboard), `use-review-session.ts:57-80` (workspace strip), `review-workspace.tsx:134-145` and `:956-964` (viewer), `pulls.$pullNumber.tsx:257-268` (pull request page). Screens: `11-history-rich-dark-1440.png`, `59-workspace-needs-recompare-dark-1440-full.png`, `60-workspace-superseded-dark-1440.png`.

  | Status            | Dashboard badge         | Workspace strip                  | Workspace viewer title        | Pull request page        |
  | ----------------- | ----------------------- | -------------------------------- | ----------------------------- | ------------------------ |
  | `needs-review`    | Needs review            | Changes need review              |                               |                          |
  | `passed`          | Passed                  | Check passed                     |                               |                          |
  | `rejected`        | Changes rejected        | Rejected changes                 |                               |                          |
  | `incomplete`      | Waiting for screenshots | Waiting for the complete capture |                               | Waiting for screenshots. |
  | `comparing`       | Comparing images        | Comparing stored captures        |                               |                          |
  | `needs-recompare` | New capture needed      | A new comparison is required     | Comparison needs fresh Submit |                          |
  | `superseded`      | Replaced by a newer run | A newer attempt is active        | Comparison superseded         |                          |
  | `failed`          | Run failed              | Capture or comparison failed     | Comparison failed             | Visual capture failed.   |

- What happens: Two label functions and two inline tables map the same eight server states to different words. On the `needs-recompare` workspace screen the same fact appears as `A new comparison is required`, `Comparison needs fresh Submit`, and `This comparison is out of date. Run the trusted workflow again to submit a fresh comparison.`
- Impact: A run that the queue calls "New capture needed" opens a page that calls it "A new comparison is required". The reviewer cannot be sure that they are the same state.
- Recommendation: One map, used by the badge on every page.

  ```ts
  export const runStatus = {
    "needs-review": { label: "Needs review", tone: "warning" },
    rejected: { label: "Rejected", tone: "danger" },
    passed: { label: "Passed", tone: "success" },
    incomplete: { label: "Capturing", tone: "neutral" },
    comparing: { label: "Comparing", tone: "neutral" },
    "needs-recompare": { label: "Rerun needed", tone: "danger" },
    superseded: { label: "Replaced", tone: "neutral" },
    failed: { label: "Failed", tone: "danger" },
  } as const;
  ```

- Alternatives: (a) Minimal: make `runStatusLabel` call `stateLabel`. (b) Let the server send the label with the status. This moves copy to the server and makes it harder to change.
- Maintainer decision needed: no.

### COPY-04 · Variant labels repeat every part, and the accessible name is a raw token string

- Kind: ux
- Severity: high. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - The consumer builds the variant key from all other parts: `/Users/diegohaz/Developer/ariakit/app/src/test-utils/visual.ts:475-487` joins `[framework, testInfo.project.name, viewportName, styleName, media.colorScheme, media.contrast, media.forcedColors]` with `-`.
  - `api/review.ts:469-482` sends six `labelParts` and `label = labelParts.map((part) => part.value).join(" · ")`.
  - `variant-summary.tsx:84-87` hides a part from the text only when it equals a visible label. The key never equals one, so it always shows.
  - `review-workspace.tsx:776`: ``aria-label={`${index + 1}. ${entry.label}. ${verdictLabel(entry)}`}``.
  - Measured with a key in the consumer format (M5): pill widths `[413,406,408,410,390,392,401]` px in a 1,120 px nav. 2 of 7 variants fit. The accessible name is `1. react · chromium · light · no-preference · none · react-chrome-default-default-light-no-preference-none. Needs review`.
  - Screens: `76-workspace-real-variant-keys-dark-1440.png`, `76-workspace-real-variant-keys-dark-1440-batch.png`, `51-workspace-details-open-dark-1440.png`.
- What happens: Each pill shows three icons with words, two more icons for "no preference" and "none", and then the key. The key says the same seven things again and is cut with an ellipsis. The batch dialog and the details panel print the raw joined label. The screen reader name contains `no-preference` and `none` without the name of the setting.
- Impact: Only two variants are visible without horizontal scroll. The text that distinguishes variants is the part that is cut. Screen reader users hear about 20 tokens for each link.
- Recommendation: Show only the parts that differ between the variants of the item. Hide default values (`no-preference`, `none`). Move the key to a tooltip and to the details panel. Build the accessible name from named parts.

  ```tsx
  <NavLink aria-label="React, Chromium, light. Needs review">
    <VariantChip framework="react" browser="chromium" scheme="light" />
    <Kbd aria-hidden="true">1</Kbd>
  </NavLink>
  ```

- Alternatives: (a) Minimal: do not render the `key` part when the other parts already identify the variant within the item. (b) Replace the pill row with a small matrix (rows: framework, columns: browser and scheme). (c) Ask the adapter to send a short display name.
- Maintainer decision needed: yes. Assumption to confirm: production keys follow the consumer code above. I did not read production data.

### COPY-05 · The workspace puts seven text bands above the image and repeats the review state six times

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - Measured (M4): at 1440 × 900 the image starts 408 px below the top of the workspace (45% of the viewport). At 390 × 844 it starts at 518 px (61%). The bands above it are the app header, the run bar, the meta strip, the item heading, the variant row, the view controls, and the pane caption.
  - Measured (M2): the default workspace state has 198 words. The phrase "need(s) review" occurs 6 times: `9 of 11 need review` (`review-workspace.tsx:597`), `Changes need review` (`use-review-session.ts:62`), `Needs review` (badge, `navigation.ts:174`), and three sidebar rows (`item-list.tsx:256`). The batch dialog state has 13 occurrences.
  - `review-workspace.tsx:609-622`: the meta strip shows `{sha7}`, `Attempt {n}`, `Baseline revision {n}`, and the run status.
  - Screens: `50-workspace-default-dark-1440.png`, `70-workspace-mobile-dark-390-full.png`, `53-workspace-batch-dialog-dark-1440.png`.
- What happens: The page states the run, the item, the status, and the progress in separate rows. Each row adds labels that the next row repeats.
- Impact: Less than half of the first screen shows the two images that the reviewer came to compare. On a phone the first image starts in the lower 40% of the screen.
- Recommendation: One bar for run and progress, one row for item, status, and variants. Remove the meta strip. Put commit and attempt in the details panel.

  ```text
  ← Queue   #7731 Fix Combobox popover position        9 left ▓▓░░░░   Details
  Success dialog  ● Needs review  0.05% · 120 px     [React Chromium ☀] [Solid Chromium ☀] …
  [Side by side | Diff | Baseline | Current]                                Fit 100% 200%
  ```

- Alternatives: (a) Minimal: delete the meta strip and the `Changes need review` text. (b) Move the variant row into the sidebar as a second level under the selected item. (c) Make the header collapse on scroll.
- Maintainer decision needed: no.

### COPY-06 · The queue and history pages state each fact two or three times

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence (screens `10-queue-rich-dark-1440.png`, `11-history-rich-dark-1440.png`, `16-queue-empty-no-baseline-dark-1440.png`):
  - Repository name twice: header (`app-shell.tsx:37-41`) and page eyebrow (`index.tsx:429-431`).
  - Count of ready runs three times: `3 runs are ready for review.` (`index.tsx:437`), `3` with `Runs to review` (`:452`), and the `Ready to review` section (`:471`).
  - `View history` (`index.tsx:550`) repeats the `Run history` nav link. `Queue` (`review-workspace.tsx:584`) and `Review queue` (`pulls.$pullNumber.tsx:159`) repeat the `Review queue` nav link.
  - History limit three times: `Results for the latest 100 runs. …` (`index.tsx:634`), `Search loaded history…` (`:658`), `Search and filters apply to the loaded runs.` (`:748`).
  - `Attempt {n}` on every row: 6 times in the queue state and 20 times in the history state (M2).
  - `Baseline revision 27` in the queue footer (`index.tsx:547`).
  - The empty queue without a baseline has four statements of "nothing here": `No runs need a decision or recovery.`, three `0` stats, `No captures yet.`, and `No baseline yet`.
  - The `Main` card shows `Main` twice (`index.tsx:490` and `:499` both call `kindLabel(run.kind)`).
  - The queue capture with six runs is 1,515 px tall at 1440 px wide and 1,648 px tall at 390 px wide.
- What happens: The page has a header, an eyebrow, a title, a subtitle, a stat strip, and section headings. Each level restates the level below.
- Impact: The reviewer reads about 150 words to reach three links. Six runs need more than one and a half screens of scroll.
- Recommendation: One dense list. The row is the link. Counts move into the section headings.

  ```text
  To review · 3
  #7731  Fix Combobox popover position when the anchor scrolls   14 changes               20 min ago
  #7728  Update Dialog focus ring tokens                         6 changes · 2 rejected   3 h ago
  main   c3d4e5f                                                 1 change                 5 h ago
  In progress · 2          Needs attention · 1
  ```

- Alternatives: (a) Minimal: remove the eyebrow, the subtitle, the stat strip, `View history`, and the footer line. (b) Keep cards but show one line of meta: `14 changes · 20 min ago`. (c) Merge queue and history into one table with a "To review" filter that is on by default.
- Maintainer decision needed: yes. Does a reviewer use `Attempt` and `Baseline revision` on the dashboard? If not, they can move to the details panel and the status page.

### COPY-07 · Count strings have grammar and placeholder defects

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `index.tsx:502`: `{run.pending} view{run.pending === 1 ? "" : "s"} await approval`. It renders `1 view await approval.` Screen: `10-queue-rich-dark-1440.png` (third card).
  - `review-workspace.tsx:1055`: `All {targets.length} changed views…`. It renders `All 1 changed views…` and `All 0 changed views…`. Screens: `63-workspace-added-item-dark-1440.png`, `62-workspace-not-ready-dark-1440.png`.
  - `review-workspace.tsx:646-647`: `{variant.changedPixels?.toLocaleString() ?? "—"} changed pixels`. The count is optional (`api/review.ts:508`). Without a count the line is `— changed pixels`. Screen: `74-workspace-added-real-shape-dark-1440.png`. Assumption: additions and removals have no count, because there is no second image to compare. I did not verify this with production data.
  - `api/review.ts:525`: the threshold template leaves a trailing separator. Measured (M6): `{"threshold":0.2}` gives `"Color threshold 0.2; "` and `{"threshold":0.2,"maxDiffPixels":0}` gives `"Color threshold 0.2; maximum 0 pixels; "`. Screen: `51-workspace-details-open-dark-1440.png` (`maximum 0 pixels;`).
  - `review-workspace.tsx:469-471`: `Comparison {model.comparisonRevision}`. For a live run the value is the run revision (`api/review.ts:602`: `selectedComparison?.ordinal ?? run.revision`). Measured in the fixture (M7): the text changes from `Comparison 2` to `Comparison 4` after one approval. The comparison did not change. Screen: `77-workspace-details-after-save-dark-1440.png`.
- What happens: Hand-written plural logic covers the noun but not the verb. Fallback characters and separators are joined without a check.
- Impact: A visible grammar error on a real queue card (a run with one change). A wrong label in the details panel.
- Recommendation: One plural helper and explicit branches for "no value".

  ```ts
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  plural(run.pending, "change"); // "1 change", "14 changes"
  ```

  ```tsx
  {
    variant.kind === "added"
      ? "Added"
      : variant.kind === "removed"
        ? "Removed"
        : `${percent}% · ${pixels} px`;
  }
  ```

- Alternatives: (a) Use `Intl.PluralRules`. (b) Avoid sentences with counts: show `14` beside an icon with an accessible label.
- Maintainer decision needed: no.

### COPY-08 · Empty image panes and the pixel-diff hint make false or unneeded statements

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `screenshot-viewer.tsx:216-234`: the Baseline pane always gets `empty="New image, no reference"`. The Current pane gets `"Removed, no new image"` unless the image was matched locally. The text does not depend on `variant.kind`.
  - `use-evidence.ts:80-85`: a missing reference on a variant that is not `added` is an error: `Required reference evidence is unavailable in this comparison.`
  - Screen `69-workspace-missing-reference-dark-1440.png`: the alert says `Comparison evidence incomplete  Required reference evidence is unavailable in this comparison.` and the pane below says `New image, no reference`.
  - Screen `62-workspace-not-ready-dark-1440.png`: a pending comparison without images shows `Comparison is still running…`, `New image, no reference`, and `Removed, no new image` together.
  - `review-workspace.tsx:924-930`: `Pixel diff requires both a reference and a new image.` shows for every addition and removal, in every view mode. Screens: `63-workspace-added-item-dark-1440.png`, `64-workspace-removed-item-dark-1440.png`.
- What happens: The pane text assumes that a missing image means "added" or "removed". The hint about the pixel diff shows before the reviewer asks for a diff.
- Impact: In the error case the page says that the image is new when the image is missing. In the normal add and remove cases the page shows two sentences and an empty checkerboard pane for a fact that one badge can carry.
- Recommendation: Choose the text from `variant.kind`. Show the hint as a tooltip on the disabled Diff button.

  ```tsx
  const emptyBaseline = variant.kind === "added" ? "Added. No baseline." : "Baseline image missing";
  const emptyCurrent =
    variant.kind === "removed"
      ? "Removed"
      : variant.candidateOmitted
        ? "Not uploaded (no visible change)"
        : "Current image missing";
  ```

- Alternatives: (a) For an addition or a removal, show one full-width pane with an `Added` or `Removed` badge. (b) Minimal: remove only the always-on hint at `review-workspace.tsx:924-930`.
- Maintainer decision needed: no.

### COPY-09 · Three sign-in texts, three access-denied texts, three loading texts

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:

  | State          | Dashboard (`index.tsx`)                                                                                                                                                                                                                        | Pull request page (`pulls.$pullNumber.tsx`)                                                                                                                         | Run page (`runs.$runId.tsx`)                                                                                                  |
  | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | Loading        | `Checking access and loading runs…` (`:277`)                                                                                                                                                                                                   | `Finding this pull request’s visual review…` (`:181`)                                                                                                               | `Checking access and loading this run…` (`:70`)                                                                               |
  | Signed out     | `Visual regression review` / `Every change. A clear decision.` / `Compare screenshots and approve expected changes in your repository.` / `Review visual changes.` / `Use a GitHub account with write access to this repository.` (`:287-308`) | `Sign in to review pull request #{n}` / `Compare screenshots and approve expected changes. Use a GitHub account with write access to this repository.` (`:187-191`) | `Sign in to review this run` / `This review is available to Ariakit maintainers.` (`:228-230`)                                |
  | HTTP 403       | `Repository access required` / `Your repository access changed. Write access to this repository is required.` (`:192`, `:334`). Buttons `Retry` and `Use another account`                                                                      | `Repository access required` / `Write access to this repository is required to open its review.` (`:66`). Button `Use another account`                              | `This run could not be opened` / `Write access to this repository is required to open this run.` (`:80`). Button `Retry` only |
  | Sign-in failed | `Sign-in could not start. Please try again.` (`:220`)                                                                                                                                                                                          | `Sign-in could not start. Please retry.` (`:130`)                                                                                                                   | `Sign-in could not start. Please try again.` (`:179`)                                                                         |
  - `index.tsx:189-193`: the first HTTP 403 response also prints `Your repository access changed.` The code does not know that access changed.
  - `index.tsx:333-335`: the error heading is `The review queue could not be loaded` on `/?view=history` and `/?view=service` too.
  - `runs.$runId.tsx:230` names `Ariakit`. Every other string says `this repository`.
  - The sign-in button has three icons: `ArrowRightIcon` (`index.tsx:315`), `ArrowUpRightIcon` (`pulls.$pullNumber.tsx:201`), `LogIn` (`runs.$runId.tsx:238`).
  - Screens: `19-guest-dark-1440.png`, `33-pull-guest-dark-1440.png`, `40-run-guest-dark-1440.png`, `20-forbidden-dark-1440.png`, `34-pull-forbidden-dark-1440.png`, `41-run-forbidden-dark-1440.png`, `22-loading-dark-1440.png`, `36-pull-loading-dark-1440.png`, `43-run-loading-dark-1440.png`.

- What happens: Each route owns its own gate. The dashboard gate is a marketing hero with five text blocks for one button.
- Impact: The words "Checking access" name an internal step on every page load. This matches the complaint about the wait for access checks. A user without access gets a different button set on each page. On the run page that user gets only `Retry`.
- Recommendation: One gate component for the three routes, with one sentence for each state.

  ```tsx
  <AccessGate state="guest" subject="pull request #7731" repository="ariakit/ariakit" />
  // Loading:   skeleton, no sentence
  // Guest:     "Sign in to review pull request #7731"  [Sign in with GitHub]
  // Forbidden: "You need write access to ariakit/ariakit."  [Use another account]
  // Error:     "Could not load. Try again."  [Retry]
  ```

- Alternatives: (a) Minimal: change the three loading strings to `Loading…` and align the three HTTP 403 sentences. (b) Keep the dashboard hero but cut it to one heading and the button.
- Maintainer decision needed: yes. Do you want to keep the marketing lines on the signed-out dashboard?

### COPY-10 · Error prefixes mislabel server responses, and one user message never arrives

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `client.ts:274-276`: `conflict: response.status === 409`. `use-review-session.ts:274`: `` `${conflict ? "Conflict. " : "Not saved. "}${message}${reviewer}` ``.
  - `api/index.ts:55-66`: `ConflictError` and `IncompleteError` both return HTTP 409. `api/review.ts:628-632` returns HTTP 409 for an expired review session. `api/review.ts:675-679` and `:954-958` return HTTP 409 for closed history.
  - Measured with a mocked API (M8): HTTP 409 with `Start a new review session after signing in.` renders `Conflict. Start a new review session after signing in.` with one button, `Refresh current state`. HTTP 409 with `The requested record does not exist.` renders `Conflict. The requested record does not exist.` HTTP 401 renders `Not saved. Sign in with GitHub.` with `Retry same command` and `Refresh current state`. No sign-in control exists.
  - `review-queue.ts:35-39`: `throw new Error("The previous decision has not reached the server. Retry the unsent decisions.")`. A plain `Error` is not one of the classes that `errorResponse` passes through (`api/index.ts:36-66`), so the browser gets `The service is temporarily unavailable.` with a reference.
  - Screens: `81-save-409-session-expired-dark-1440.png`, `82-save-401-signed-out-dark-1440.png`, `83-save-409-record-missing-dark-1440.png`.
- What happens: The client uses the HTTP status as the meaning. The server uses 409 for four different conditions.
- Impact: The word "Conflict" tells the reviewer that another person changed the decision. In three of the four cases that is false. The 401 case tells the reviewer to sign in and offers two buttons that cannot help.
- Recommendation: Branch on `error.code`, not on the status. Give each code one sentence and one action.

  ```ts
  const action = {
    conflict: { text: `Changed by ${reviewer}.`, button: "Reload" },
    review_session_expired: { text: "Your session changed.", button: "Reload" },
    sign_in_required: { text: "Your session ended.", button: "Sign in" },
    history_closed: { text: "This run is closed.", button: "Reload" },
  }[error.code] ?? { text: "Not saved.", button: "Retry" };
  ```

- Alternatives: (a) Minimal: drop the `Conflict. ` prefix and always print `Not saved. `. (b) Server side: return distinct statuses (401, 409, 410, 404) and keep the client rule.
- Maintainer decision needed: yes. Should the queue predecessor error in `review-queue.ts:37` reach the user as written? If yes, it needs an error class that `errorResponse` passes through.

### COPY-11 · Pipeline and storage words reach the reviewer

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence (all strings are in the inventory):
  - Identity counters: `Attempt {n}` (`index.tsx:404`, `:589`, `:717`; `review-workspace.tsx:469`, `:615`), `Baseline revision {n}` (`index.tsx:547`; `review-workspace.tsx:618`), `Comparison {n}` and `decision revision {n}` (`review-workspace.tsx:471`, `:520`).
  - Pipeline: `sealed` (`review-workspace.tsx:702`), `trusted Submit`, `CI bundle`, `trusted workflow` (`api/review.ts:102`, `:597`; `review-workspace.tsx:139`, `:960`), `Promoted history` (`api/review.ts:547`), `Server recomparison is retired` (`api/review.ts:102`).
  - Storage: `image bytes` (`review-workspace.tsx:811`), `Image replay has ended` (`closed-summary.ts:18`), `Stored representatives cannot replace omitted candidate bytes` (`api/review.ts:972`), `database cutover` (`api/review.ts:583`).
  - Proof words: `evidence` in 13 client strings and 4 server strings (M3).
  - Details panel (`review-workspace.tsx:490-522`): `Engine / codec`, `Policy / threshold` with a 71-character `sha256:` digest, `Capture profiles` with two digests, and `Comparison` with three internal IDs. Screen: `51-workspace-details-open-dark-1440.png`.
  - `Original comparison` (`review-workspace.tsx:474`) is a link that is always present, including when no other comparison exists.
- What happens: Server and service vocabulary is printed without translation into the task of the reviewer.
- Impact: The reviewer must know the capture pipeline to read a status line. The details panel uses most of its height for hashes.
- Recommendation: Rewrite these strings for the reviewer (see "Rewrite table"). In the details panel, show human values first and put IDs behind one "Copy debug info" action.

  ```text
  Changed      120 px (0.05%)
  Size         600 × 400
  Tolerance    threshold 0.2, max 0 px
  Environment  Same as baseline
  Commit       aabbccd ↗
  [Copy debug info]
  ```

- Alternatives: (a) Minimal: hide `Attempt` when it is 1, hide `Capture profiles` when both sides are equal, hide `Original comparison` when the run has no historical comparison. (b) Keep all fields but collapse them under a "Technical details" disclosure, as the alerts already do.
- Maintainer decision needed: yes. Which of these identifiers do you use during a review, and which only during an incident?

### COPY-12 · The service status copy has five names for the feature and operator runbook text in every alert

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence (all line numbers are in `operations-attention/index.tsx`):
  - Names: `Operations` (eyebrow, `:315`), `Service status` (nav and h1, `:321`), `Service attention` (popover heading and 12 strings, `:325`), `operation alerts` (9 strings, `:343`), `service alerts` (3 announcements, `:253`).
  - Refresh rule three times on the page: `This page checks for updates every minute.` (`:331`), `Last checked {date}.` (`:343`), `Refresh alerts` (`:360`). Plus `No external notifications are sent.` (`:465`) and, in the popover, the same sentence at `:336`.
  - The error state says the same thing twice: `No current alert data.` (`:346`) and `Operation alerts are temporarily unavailable. The current alert state is unknown.` (`:243`, `:372`). Screen: `24-service-error-dark-1440.png`.
  - The empty state adds a disclaimer: `This view reports operation alerts. It does not test every service dependency.` (`:442`).
  - 9 of 12 alert titles end with `needs attention` (`:101-195`).
  - The 15 alert bodies have 12 to 33 words each (`:104-197`, longest at `:121`) and use runbook language: `inspect the backup row state`, `a failed set is terminal`, `staged bytes`, `upload of every shard`, `retention pins`.
  - This surface holds 596 of the 2,256 client words (26%) (M1).
  - `Active captures: 5 of 12` (`:388`) counts runs (`activeRuns`, `maximumActiveRuns`).
  - Screens: `12-service-alerts-dark-1440.png`, `13-queue-ops-popover-dark-1440.png`, `23-service-empty-dark-1440.png`.
- What happens: The panel explains its own mechanics and embeds the recovery guide in each card. The same panel is reused as a popover, so the popover is a 460 px column of paragraphs.
- Impact: A reviewer who opens the bell cannot tell quickly whether reviews are affected. An operator still needs the guide.
- Recommendation: One name ("Status" for the page, "alerts" for the items). Each alert is a title, one action sentence, a relative time, and a link to the matching guide section.

  ```text
  Status                                            checked 2 min ago  ⟳
  Database 412 of 800 MiB ▓▓▓▓▓░░░░     Active runs 5 of 12 ▓▓▓▓░░░░░
  ● Backup            Check backup access and storage.            3 d   Guide ↗
  ● GitHub webhook    Redeliver the failed delivery in GitHub.    2 h   Guide ↗
  ```

- Alternatives: (a) Minimal: remove the five mechanical sentences listed above and shorten the button to `Recovery guide`. (b) Keep long bodies behind the existing `Technical details` disclosure. (c) The popover shows only titles and a link to the page.
- Maintainer decision needed: yes. Is the alert body the runbook of record, or can the detail live only in `apps/web/src/operations/README.md`?

### COPY-13 · Accessible names differ from visible labels, and shortcut letters are part of button names

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence (M9):
  - Pane captions are `Baseline` and `Current`. The images in them have `alt="Reference"` and `alt="New image"` (`screenshot-viewer.tsx:38`, `:218`, `:229`). The diff image has `alt="Pixel diff · red pixels changed"` under the caption `Difference` (`:245`).
  - One pan button has `aria-label="Pan Reference left"` and `title="Pan baseline left"` (`screenshot-viewer.tsx:120-121`).
  - Button names include the shortcut letter: `Compare S`, `Difference D`, `Current F`, `Baseline G`, `Reject viewX`, `Approve & nextA` (`review-workspace.tsx:845-889`, `:1077-1096`). The tests depend on this, for example `getByRole("button", { name: "Approve & next A", exact: true })` in `apps/web/src/review/__tests__/review.browser.test.ts`.
  - The sidebar is visibly `Screenshots`. Its landmarks are `aside: Review navigation` and `nav: Review items` (`review-workspace.tsx:545`, `item-list.tsx:300`).
  - The button says `Details` and opens a panel named `Capture details` (`review-workspace.tsx:685`, `:1155`).
  - Every alert announcement starts with `Service attention:` (`operations-attention/index.tsx:253-274`).
- What happens: Visible captions were renamed and the accessible names kept the old words. Shortcut hints are text children of the buttons.
- Impact: A screen reader announces "Reference" for the pane that sighted users call "Baseline". It reads "Approve and next A" for the main action. A user who hears "Review items" cannot match it to the visible "Screenshots" title when a sighted colleague describes the page.
- Recommendation: Use the caption for `alt` and for the pan button names. Hide shortcut hints from the name and declare them with `aria-keyshortcuts`.

  ```tsx
  <Button aria-keyshortcuts="A" onClick={() => review("approved")}>
    <ButtonLabel>Approve</ButtonLabel>
    <ButtonSlot $kind="shortcut" aria-hidden="true">
      A
    </ButtonSlot>
  </Button>
  ```

- Alternatives: (a) Minimal: change only the three `label` props in `screenshot-viewer.tsx:218`, `:229`, `:245`. (b) Move shortcut hints into tooltips (the upstream `Tooltip` primitive with `Kbd`).
- Maintainer decision needed: no.

### COPY-14 · Heading punctuation and capitalization are inconsistent

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - 11 headings and status titles end with a period: `Your review queue.` (`index.tsx:433`), `Run history.` (`:631`), `Service status.` (`operations-attention/index.tsx:321`), `Every change. A clear decision.` (`index.tsx:293`), `Review visual changes.` (`:305`), `All reviews are complete.` and `No captures yet.` (`:533`), `No unresolved alerts.` (`operations-attention/index.tsx:439`), `Waiting for screenshots.`, `Visual capture failed.`, `No visual review needed.` (`pulls.$pullNumber.tsx:258-261`).
  - The other headings have no period, for example `Repository access required` (`index.tsx:334`), `This run could not be opened` (`runs.$runId.tsx:95`), `No matching runs` (`index.tsx:738`), `Review all changed views` (`review-workspace.tsx:1251`), and the 12 alert titles.
  - Capitals in the middle of a label: `Retry Undo` (`review-workspace.tsx:1127`), `Saving Undo…` (`use-review-session.ts:456`), `Comparison needs fresh Submit` (`review-workspace.tsx:960`).
  - `Approve & next` uses an ampersand (`review-workspace.tsx:1095`).
  - Retry phrasing has five forms: `Please retry.`, `Please try again.`, `Retry loading the page.`, `Check your connection and retry.`, `Refresh before reviewing.`
- What happens: No style rule exists, so each author chose.
- Impact: Small. It adds to the unfinished look that the maintainer reports.
- Recommendation: Sentence case. No period in headings, labels, and buttons. Periods only in full sentences. No "please". One retry sentence: `Try again.`
- Alternatives: Keep periods in page titles as a brand style, and then add them to every page title.
- Maintainer decision needed: yes. Is the period after page titles (`Your review queue.`) a deliberate brand style?

### COPY-15 · The UI does not say who is signed in or which run a tab holds

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `user-menu.tsx:24`: ``const accountLabel = preview ? "Preview account" : login ? `@${login}` : "Account";``. The two callers do not pass `login` (`index.tsx:258-263`, `runs.$runId.tsx:207-212`). `GET /api/session` returns the login (`api/review.ts:713-721`) and no client code calls it.
  - The popover therefore shows `Account`, `Manage your GitHub session.`, and `Sign out`. Screen: `14-queue-user-menu-dark-1440.png`.
  - `__root.tsx:10`: `{ title: "Visonaut" }`. No route sets another title.
  - From the code, not observed: a conflict prints `Updated by {reviewer}.` (`use-review-session.ts:271`), and the details panel prints the reviewer (`review-workspace.tsx:465`). The value is the GitHub user ID, not the login (`api/review.ts:500`: `{ reviewer: effective.actor_id }`; `:857`: `actorId: context.identity.githubUserId,`).
- What happens: Identity data exists on the server but does not reach the labels.
- Impact: A maintainer with two GitHub accounts cannot see which one is active. Several run tabs look the same in the tab bar. A conflict names a number, not a person.
- Recommendation: Return `login` with the first protected response and show `@login` in the button. Set the document title for each route.

  ```tsx
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData.model.run.title ?? "Run"} · Visonaut` }],
  });
  ```

- Alternatives: (a) Minimal: remove `Manage your GitHub session.` and show only the `Sign out` button. (b) Show the GitHub avatar in place of the user icon.
- Maintainer decision needed: no.

### COPY-16 · The preview shows dates from 1969 and says "Preview fixtures" four times on one screen

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `preview-fixtures.ts:86`: `createdAt: 0,` and `:107`: `{ events: [], checkedAt: 0, hasMore: false }`.
  - Screens `01-queue-preview-dark-1440.png` and `02-history-preview-dark-1440.png` show `Dec 31, 1969, 9:00 PM`. Screen `03-service-preview-dark-1440.png` shows `Last checked Dec 31, 1969, 9:00 PM.` The capture machine is three hours behind UTC.
  - The queue screen shows `Preview fixtures` in the header, `Preview fixtures · GitHub login is disabled` above the title, `PREVIEW FIXTURES` as the eyebrow, and `Preview account` in the account button.
  - The run screen adds `Preview fixtures are read-only. GitHub login is disabled.` as a banner (`preview-fixtures.ts:6`). Screen: `04-run-preview-dark-1440.png`.
- What happens: The fixture uses 0 for timestamps and uses the label "Preview fixtures" as the repository name.
- Impact: The public preview is the first thing that a visitor sees. It shows an epoch date and repeats an internal word ("fixtures").
- Recommendation: Use `Date.now()` minus a fixed offset in the fixture. Show one `Preview` badge in the header and remove the other three labels.
- Alternatives: Hide dates in the preview.
- Maintainer decision needed: no.

### COPY-17 · The review guide names controls that the UI does not have

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `docs/review-guide.md:31-34` and `:76-77`: `Side by side`, `Pixel diff`, `New only`, `Original only`. The buttons are `Compare`, `Difference`, `Current`, `Baseline` (`review-workspace.tsx:845-888`).
  - `docs/review-guide.md:92`: `Use **All runs** to return to the dashboard`. The control is `Queue` (`review-workspace.tsx:584`).
  - `docs/review-guide.md:15`: `The Runs page`. The pages are `Review queue` and `Run history`.
  - `docs/review-guide.md:39`: `shows an error and **Retry**`. The button is `Retry images` (`review-workspace.tsx:976`).
  - `docs/review-guide.md:41`: the details panel provides `digests`. The panel has no image digest row (`review-workspace.tsx:490-522`).
  - `docs/review-guide.md:88`: `**Recompare stored run** is retired.` The button still renders (COPY-01).
- What happens: The guide kept the old control names.
- Impact: A new maintainer who follows the guide looks for controls that do not exist.
- Recommendation: Update the guide in the same change that fixes the terminology (COPY-02), from the same word list.
- Alternatives: Link the guide to the in-app keyboard dialog and remove the control tables from the guide.
- Maintainer decision needed: no.

### COPY-18 · Twelve strings cannot be shown by the production code path

- Kind: dead-code
- Severity: low. Confidence: medium. Measured: no. Effort: S
- Evidence:
  - Recompare flow. `use-review-session.ts:509`: `if (!recompareAllowed) return;` and the server always sends `false` (`api/review.ts:592`). Unreachable: `Creating a new comparison from stored captures…` (`use-review-session.ts:515`), `The new comparison failed.` (`:538`), `New comparison requested. Results will open when comparison completes.` (`:539`), the banner `A new comparison is being prepared from stored captures. …` (`review-workspace.tsx:705-710`), and the button `Recompare now` (`:979-989`).
  - Server recompare errors that only a hand-made request can reach: `api/review.ts:957` and `:984` (same text) and `:972`.
  - Fallbacks that the server always overrides: `This closed run is read-only. Its review history remains available.` (`review-workspace.tsx:697`; `api/review.ts:577-588` always sets `readOnlyReason` with `archived`), and `This closed review is read-only. Capture a new complete run.` (`review-workspace.tsx:331`; `api/review.ts:593-598` always sets the reason).
  - No-op result. `use-review-session.ts:340-353` prints `This acceptance is already saved.` when `result.noop` is true. A search of `packages` and `apps/web/src` (tests excluded) finds no code that sets `noop` (M10).
  - `@{login}` (`user-menu.tsx:24`), see COPY-15.
  - `Choose approved or rejected.` (`api/review.ts:845`): the client can send only these two values.
- What happens: The copy for retired features and defensive branches stayed.
- Impact: About 100 words that need maintenance for no visible effect. The fixture tests keep some of these branches alive (for example `model.recompareAllowed = true;` in `apps/web/src/review/__tests__/review.browser.test.ts:899`).
- Recommendation: Remove the strings together with their branches when COPY-01 is done.
- Alternatives: Keep the defensive fallbacks and shorten them to one shared sentence.
- Maintainer decision needed: yes. Can stored command results from older releases still carry `noop: true`? I did not read production data.

## Measurements (command, raw result, limits)

All scripts are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-copy/`. They read the repository and write only to that folder. Run each with `node <script>`.

- M1. Inventory size. Command: `node build-inventory.mjs`. Raw result: `{"total":508,"totalWords":2744}`, then one line for each surface (`strings words title`): `17 40 App header and account menu`, `21 125 Dashboard: loading, sign-in, and errors`, `42 133 Dashboard: review queue`, `18 69 Dashboard: run history`, `28 161 Pull request page`, `12 64 Run page: loading, sign-in, and errors`, `71 596 Service status page and alerts popover`, `51 136 Review workspace: chrome, navigation, and item list`, `87 370 Review workspace: item header, variants, and viewer`, `85 513 Review workspace: actions, save state, and dialogs`, `19 49 Review workspace: details panel`, `57 488 Server text that reaches the review UI`. The script also checks that a literal fragment of each string exists near the cited line: 501 of 508 matched. I checked the other 7 by hand. They are strings that the code assembles from parts (`index.tsx:293`, `:437`, `:502`; `review-workspace.tsx:647`, `:917`, `:1113`, `:1184`). Limits: I curated the inventory from an AST extraction (`node extract.mjs` gave 754 candidates in 36 files). A placeholder counts as one word. A string that occurs on several lines is listed once, with the other lines in the "Where it shows" column.
- M2. Visible words for each captured state. Command: `node measure.mjs` (reads `texts.json`, which holds `document.body.innerText` for each capture). Selected raw rows (`state words "need(s) review" "Attempt N" "Baseline revision"`): `10-queue-rich-dark-1440 149 2 6 1`, `11-history-rich-dark-1440 378 3 20 0`, `12-service-alerts-dark-1440 208 0 0 0`, `13-queue-ops-popover-dark-1440 334 2 6 1`, `19-guest-dark-1440 41 0 0 0`, `50-workspace-default-dark-1440 198 6 1 1`, `51-workspace-details-open-dark-1440 253 8 2 1`, `52-workspace-keyboard-help-dark-1440 304 6 1 1`, `53-workspace-batch-dialog-dark-1440 284 13 1 1`, `62-workspace-not-ready-dark-1440 241 3 1 1`. Limits: `innerText` includes text that is hidden visually for screen readers (each variant link repeats its label). The data is mock data that I wrote.
- M3. Competing terms. Command: `node terms.mjs`. Raw result (`term client-strings server-strings`): `view 11 0`, `variant 16 1`, `item 11 1`, `screenshot 19 0`, `capture 22 10`, `baseline 8 3`, `reference 6 1`, `original 5 0`, `current 10 1`, `new image 8 0`, `candidate 1 2`, `difference 2 0`, `pixel diff 6 0`, `approved 5 1`, `accepted 2 0`, `acceptance 1 0`, `decision 9 10`, `command 6 9`, `evidence 13 4`, `attempt 7 0`, `comparison 44 10`, `submit 3 3`, `service attention 12 0`, `operation alert 9 0`, `service alert 3 0`, `retry 20 1`, `try again 5 0`, `refresh 19 0`. Also: `strings over 12 words: 38; over 20 words: 7; total: 508`. Limits: the counts are strings in the inventory, not occurrences on screen. The match is at a word start, so `view` matches `views` and does not match `review` or `preview`.
- M4. Text bands above the image. Command: `node bands.mjs` (default fixture at `http://127.0.0.1:4311/src/review/__tests__/index.html`). Raw result at 1440 × 900: `"appHeader":{"top":0,"height":48},"resultHeading":{"top":154,"height":59},"variants":{"top":233,"height":38},"viewControls":{"top":286,"height":55},"paneCaption":{"top":342,"height":48},"imageTop":408,"imageHeight":370,"actions":{"top":817,"height":61},"footer":{"top":954,"height":40},"wordsAboveImage":89`. At 390 × 844: `"imageTop":518,"imageHeight":235,"viewControls":{"top":359,"height":92},"actions":{"top":731,"height":91},"wordsAboveImage":80`. Limits: the fixture image is 600 × 400. Offsets are relative to the workspace root, so the test-only "Outside search" row is excluded. `wordsAboveImage` excludes the sidebar.
- M5. Variant pills with keys in the consumer format. Command: `node capture.mjs 76-workspace`. Raw result: `{"variants":7,"navWidth":1120,"pillWidths":[413,406,408,410,390,392,401],"fullyVisible":2,"firstPillAccessibleName":"1. react · chromium · light · no-preference · none · react-chrome-default-default-light-no-preference-none. Needs review"}`. Limits: I built the keys from the consumer source, with `default` for viewport and style. Real keys can be longer or shorter. Three rows in the batch dialog capture look identical because my fixture mapping gives three variants the same parts. That is a fixture artifact.
- M6. Threshold label. Command: `node threshold.mjs` (a copy of the template at `api/review.ts:525`). Raw result: `{"threshold":0.2} => "Color threshold 0.2; "`, `{"threshold":0.2,"maxDiffPixels":0} => "Color threshold 0.2; maximum 0 pixels; "`, `{"threshold":0.2,"maxDiffPixelRatio":0.0005} => "Color threshold 0.2; ratio 0.0005"`, `{"threshold":0.2,"maxDiffPixels":5,"maxDiffPixelRatio":0.0005} => "Color threshold 0.2; maximum 5 pixels; ratio 0.0005"`, `legacy {} => "Channel threshold unknown; ratio unknown."`.
- M7. "Comparison N" label. Command: `node capture.mjs 77-workspace`. Raw result: `{"before":"Run run-42 · Attempt 2 · Commit aabbccddeeff · Comparison 2","after":"Run run-42 · Attempt 2 · Commit aabbccddeeff · Comparison 4"}`. Limits: the fixture adds 2 to the revision for each save. The service adds 1 (`packages/service/src/review-commands.ts:225`: `runRevision: run.revision + 1,`).
- M8. Save-state text for server errors. Commands: `node capture.mjs 81-save`, `node capture.mjs 82-save`, `node capture.mjs 83-save` (route fixture, API mocked with `page.route`). Raw results: `"Conflict. Start a new review session after signing in. Refresh current state"`, `"Not saved. Sign in with GitHub. Retry same command Refresh current state"`, `"Conflict. The requested record does not exist. Refresh current state"`. Limits: the response bodies are mocks that copy the server messages. I did not run the real server.
- M9. Accessible names. Command: `node capture.mjs 84-accessible`. Raw result: `"images":["Reference","New image"]`, `"captions":["Baseline600 × 400","Current600 × 400"]`, `"actionButtons":["Compare S","Difference D","Current F","Baseline G","Fit","100%","200%","Undo","All 7 changed views…","Reject viewX","Approve & nextA"]`, landmarks `nav: Main navigation`, `aside: Review navigation`, `div: Search and filter screenshots`, `nav: Review items`, `nav: Variants`, `section: Selected variant`, `div: Image view`, `div: Image zoom`, `div: Review actions`, `aside: Capture details`, `nav: Comparison history`, and `[{"ariaLabel":"Pan Reference left","title":"Pan baseline left"},{"ariaLabel":"Pan Reference right","title":"Pan baseline right"}]`. Limits: names come from `aria-label`, `alt`, or text content. I did not run a screen reader.
- M10. Producers of `noop`. Command: `rg -n "noop" --glob '!*.test.ts' --glob '!**/__tests__/**' --glob '!node_modules' packages apps/web/src`. Raw result: `packages/service/src/types.ts:170`, `apps/web/src/api/review.ts:880`, `apps/web/src/api/review.ts:882`, `apps/web/src/review/use-review-session.ts:340`, `apps/web/src/review/client.ts:231`, `apps/web/src/review/client.ts:249`, `apps/web/src/review/navigation.ts:91`, `apps/web/src/review/model.ts:132`, `apps/web/src/review/model.ts:144`. No line assigns `noop: true`.
- M11. Full-page capture sizes. Command: `sips -g pixelWidth -g pixelHeight <file>`. Raw result: `10-queue-rich-dark-1440.png 1440 × 1515`, `10-queue-rich-dark-390.png 390 × 1648`, `11-history-rich-dark-1440.png 1440 × 1643`, `11-history-rich-dark-390.png 390 × 2422`, `70-workspace-mobile-dark-390-full.png 390 × 1713`.
- M12. Screenshots. Command: `node capture.mjs` (75 PNG files). I read every file. Limits: the dashboard, pull request, and run-gate states use the route fixture with a mocked API. The workspace states use the browser-test fixture with labels and reasons that I copied from `api/review.ts`. The four files that start with `01` to `04` come from the real preview server on port 4310.

## Open questions and items not verified

- I did not see production data. The variant key shape in COPY-04 comes from the consumer source. The share of runs with `Attempt` above 1 is unknown.
- I did not verify which `recompareDisabledReason` production runs receive. The code selects the 20-word sentence for a run with an inventory key or a `local-v1` capture (`api/review.ts:315-322`, `:596-598`). New runs must use `local-v1` (`docs/current-contract.md:77`).
- The missing-image states in COPY-08 (captures `62` and `69`) set images to `null` in the fixture. I did not find how often a production row has a missing image record.
- `Updated by {reviewer}` prints `actor_id`. I read that it is the GitHub user ID. I did not see it on a real conflict.
- I did not test with a screen reader. COPY-13 uses DOM attributes.
- The better-auth pages and the GitHub OAuth screens are outside this lane.
- The alert bodies in COPY-12 may be the only place where some recovery steps are written. I did not compare each body with `apps/web/src/operations/README.md`.
- A popover capture taken immediately after it opens is semi-transparent (opening transition). I captured again after 900 ms. This is not a finding.
- The rewrite table proposes text. It does not check string length against the final layout of the design lab.
- The file-write tool refused the file name `report.md` for a subagent. The workflow needs that path, so `assemble.mjs` builds `report.md` from the files in `parts/` and from `inventory.md`.

## Screenshots

Base folder: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-copy/screens/`. "Excess" marks the text that the findings propose to cut.

| File                                                  | Caption                                                                                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-queue-preview-dark-1440.png`                      | Real preview, queue. Excess: "Preview fixtures" three times, `1 run is ready for review.` plus `1 Runs to review` plus `READY TO REVIEW`, `Attempt 1`, date `Dec 31, 1969`, `No baseline yet`, `View history`. |
| `02-history-preview-dark-1440.png`                    | Real preview, history. Excess: the 100-run limit stated three times, `Attempt 1`, the 1969 date.                                                                                                               |
| `03-service-preview-dark-1440.png`                    | Real preview, service status. Excess: `OPERATIONS`, intro sentence, `Last checked Dec 31, 1969`, disclaimer, `No external notifications are sent.`                                                             |
| `04-run-preview-dark-1440.png`                        | Real preview, run. Excess: meta strip (`0000000`, `Attempt 1`, `Baseline revision 0`, `Changes need review`), read-only banner.                                                                                |
| `10-queue-rich-dark-1440.png`                         | Queue with 6 mocked runs, dark. Excess: repository twice, subtitle, stat strip, `Attempt` six times, `Baseline revision 27`, `View history`. Defects: `1 view await approval.`, `Main` twice.                  |
| `10-queue-rich-light-1440.png`                        | Same state, light.                                                                                                                                                                                             |
| `10-queue-rich-dark-390.png`                          | Same state, 390 px. The page is 1,648 px tall for six runs.                                                                                                                                                    |
| `11-history-rich-dark-1440.png`                       | History with 20 mocked runs, dark. Excess: subtitle, `Attempt` twenty times, footer note. Shows all eight status labels.                                                                                       |
| `11-history-rich-light-1440.png`                      | Same state, light.                                                                                                                                                                                             |
| `11-history-rich-dark-390.png`                        | Same state, 390 px. Status badges wrap to two lines.                                                                                                                                                           |
| `12-service-alerts-dark-1440.png`                     | Status page with 4 mocked alerts and capacity. Excess: intro, long bodies, `No external notifications are sent.`, a 6-word guide button.                                                                       |
| `12-service-alerts-light-1440.png`                    | Same state, light.                                                                                                                                                                                             |
| `12-service-alerts-dark-390.png`                      | Same state, 390 px.                                                                                                                                                                                            |
| `13-queue-ops-popover-dark-1440.png`                  | Alerts popover over the queue (captured 900 ms after it opens). 334 words on screen.                                                                                                                           |
| `14-queue-user-menu-dark-1440.png`                    | Account popover: `Account`, `Manage your GitHub session.`, `Sign out`. No login name.                                                                                                                          |
| `15-queue-empty-baseline-dark-1440.png`               | Empty queue with a baseline. Excess: subtitle, three `0` stats, footer line.                                                                                                                                   |
| `16-queue-empty-no-baseline-dark-1440.png`            | Empty queue without a baseline. Four statements of "nothing here".                                                                                                                                             |
| `17-queue-in-progress-only-dark-1440.png`             | Queue with only in-progress and attention rows. The subtitle explains the page.                                                                                                                                |
| `18-history-empty-filter-dark-1440.png`               | History filter with no match. Two hints about the filter.                                                                                                                                                      |
| `19-guest-dark-1440.png`                              | Signed-out dashboard, dark. Five text blocks for one button.                                                                                                                                                   |
| `19-guest-light-1440.png`                             | Same state, light.                                                                                                                                                                                             |
| `19-guest-dark-390.png`                               | Same state, 390 px.                                                                                                                                                                                            |
| `20-forbidden-dark-1440.png`                          | Dashboard, HTTP 403. `Your repository access changed.` on a first load.                                                                                                                                        |
| `21-error-dark-1440.png`                              | Dashboard, HTTP 503. The heading says "review queue" and the body says "run list".                                                                                                                             |
| `22-loading-dark-1440.png`                            | Dashboard, loading: `Checking access and loading runs…`                                                                                                                                                        |
| `23-service-empty-dark-1440.png`                      | Status page, no alerts. Excess: intro, disclaimer, notification note.                                                                                                                                          |
| `24-service-error-dark-1440.png`                      | Status page, load error. `No current alert data.` and the alert sentence say the same thing.                                                                                                                   |
| `30-pull-pending-dark-1440.png`                       | Pull request page, waiting. The PR number is in the eyebrow and in the heading.                                                                                                                                |
| `30-pull-pending-dark-390.png`                        | Same state, 390 px.                                                                                                                                                                                            |
| `31-pull-failed-dark-1440.png`                        | Pull request page, capture failed.                                                                                                                                                                             |
| `32-pull-not-required-dark-1440.png`                  | Pull request page, no review needed.                                                                                                                                                                           |
| `33-pull-guest-dark-1440.png`                         | Pull request page, signed out. Second sign-in wording.                                                                                                                                                         |
| `34-pull-forbidden-dark-1440.png`                     | Pull request page, HTTP 403. Second access wording.                                                                                                                                                            |
| `35-pull-not-found-dark-1440.png`                     | Pull request page, HTTP 404. The text says "Open the latest check on GitHub" and the only button is `Retry`.                                                                                                   |
| `36-pull-loading-dark-1440.png`                       | Pull request page, loading. Third loading wording.                                                                                                                                                             |
| `40-run-guest-dark-1440.png`                          | Run page, signed out. Third sign-in wording. It names "Ariakit".                                                                                                                                               |
| `41-run-forbidden-dark-1440.png`                      | Run page, HTTP 403. Third access wording, `Retry` only.                                                                                                                                                        |
| `42-run-error-503-dark-1440.png`                      | Run page, HTTP 503 with `Reference: <uuid>.`                                                                                                                                                                   |
| `43-run-loading-dark-1440.png`                        | Run page, loading.                                                                                                                                                                                             |
| `50-workspace-default-dark-1440.png`                  | Workspace with production-shaped labels, dark, first viewport. Six "need(s) review", seven bands above the image.                                                                                              |
| `50-workspace-default-dark-1440-full.png`             | Same state, full page. Excess: footer `Recompare stored run` and the 20-word sentence.                                                                                                                         |
| `50-workspace-default-light-1440-full.png`            | Same state, light.                                                                                                                                                                                             |
| `51-workspace-details-open-dark-1440.png`             | Details panel open. Excess: raw label line, digests, equal profiles, `Comparison` twice, `maximum 0 pixels;` with a trailing separator.                                                                        |
| `52-workspace-keyboard-help-dark-1440.png`            | Keyboard dialog. A 24-word intro. The mode names differ from the buttons.                                                                                                                                      |
| `53-workspace-batch-dialog-dark-1440.png`             | Batch dialog. "views" in the heading, "whole item" in the buttons, raw labels in the rows.                                                                                                                     |
| `54-workspace-not-saved-dark-1440.png`                | Save failed: `Not saved. Connection lost.` with `Retry same command` and `Refresh current state`.                                                                                                              |
| `55-workspace-conflict-dark-1440.png`                 | Conflict: `Conflict. The decision changed. Refresh and review the current evidence. Updated by octocat.`                                                                                                       |
| `56-workspace-saved-dark-1440.png`                    | Saved: `1 variant approved. Saved.` beside the buttons `Reject view` and `All 7 changed views…`                                                                                                                |
| `57-workspace-saving-queued-dark-1440.png`            | Queued: `1 queued on server. You can close this window.`                                                                                                                                                       |
| `58-workspace-archived-dark-1440-full.png`            | Read-only run. Two explanations: the banner and the footer.                                                                                                                                                    |
| `59-workspace-needs-recompare-dark-1440-full.png`     | `needs-recompare`. Three wordings of one state, plus the footer sentence.                                                                                                                                      |
| `60-workspace-superseded-dark-1440.png`               | `superseded`. `A newer attempt is active` and `Comparison superseded`.                                                                                                                                         |
| `61-workspace-summary-expired-dark-1440-full.png`     | Closed summary. `Image history expired`, "image bytes", and two more read-only sentences.                                                                                                                      |
| `62-workspace-not-ready-dark-1440.png`                | Pending comparison without images. Six status sentences. Two are false (`New image, no reference`, `Removed, no new image`). Also `All 0 changed views…`                                                       |
| `63-workspace-added-item-dark-1440.png`               | Addition. Always-on pixel-diff hint, empty pane sentence, `All 1 changed views…`                                                                                                                               |
| `64-workspace-removed-item-dark-1440.png`             | Removal. Same pattern, plus the `Removed` badge in the list.                                                                                                                                                   |
| `65-workspace-diff-zoom-dark-1440.png`                | 200% zoom with pan buttons in each caption.                                                                                                                                                                    |
| `66-workspace-filter-popover-dark-1440.png`           | Filter popover: `REVIEW STATUS`, `All`, `Needs review`, `Approved`, `Rejected`.                                                                                                                                |
| `67-workspace-image-error-dark-1440.png`              | Image load error: `Image evidence unavailable`, a sentence, `Retry images`, and `Image could not be verified.` in the pane.                                                                                    |
| `68-workspace-local-comparison-dark-1440.png`         | Fixture labels without `labelParts` (`?localComparison`).                                                                                                                                                      |
| `69-workspace-missing-reference-dark-1440.png`        | Missing baseline on a changed variant. The alert and the pane text contradict each other.                                                                                                                      |
| `70-workspace-mobile-dark-390-full.png`               | Workspace, 390 px, dark. The image starts at 61% of the viewport. The footer sentence takes three lines.                                                                                                       |
| `70-workspace-mobile-light-390-full.png`              | Same state, light.                                                                                                                                                                                             |
| `71-workspace-mobile-screenshots-dialog-dark-390.png` | Screenshot list dialog, 390 px.                                                                                                                                                                                |
| `72-workspace-mobile-details-dialog-dark-390.png`     | Details dialog, 390 px. Most of it is digests.                                                                                                                                                                 |
| `73-workspace-mobile-archived-dark-390-full.png`      | Read-only run, 390 px.                                                                                                                                                                                         |
| `74-workspace-added-real-shape-dark-1440.png`         | Addition without a pixel count: `— changed pixels`.                                                                                                                                                            |
| `75-workspace-diff-tolerated-dark-1440.png`           | Diff mode. Caption `Difference`.                                                                                                                                                                               |
| `76-workspace-real-variant-keys-dark-1440.png`        | Variant keys in the consumer format. 2 of 7 pills fit. The keys are cut.                                                                                                                                       |
| `76-workspace-real-variant-keys-dark-1440-batch.png`  | Batch dialog with those keys. Two lines of tokens for each row.                                                                                                                                                |
| `77-workspace-details-after-save-dark-1440.png`       | Details after one approval: `Comparison 4` (it was `Comparison 2`).                                                                                                                                            |
| `80-operations-popover-fixture-dark-1440.png`         | Alerts popover in its own fixture.                                                                                                                                                                             |
| `81-save-409-session-expired-dark-1440.png`           | HTTP 409 for an expired session, shown as `Conflict. Start a new review session after signing in.`                                                                                                             |
| `82-save-401-signed-out-dark-1440.png`                | HTTP 401, shown as `Not saved. Sign in with GitHub.` with no sign-in button.                                                                                                                                   |
| `83-save-409-record-missing-dark-1440.png`            | HTTP 409 for a missing record, shown as `Conflict. The requested record does not exist.`                                                                                                                       |

## Redesign ideas

Each idea names the primitives that the design lab can use. The sketches are rough. `Tooltip`, `Progress`, `Dialog`, `Heading`, `Link`, `Separator`, `Input`, and `Combobox` exist only in the upstream package (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components`). `Kbd`, `Badge`, `Nav`, `Table`, `Tabs`, `Disclosure`, `Popover`, and `TextFrame` are already vendored.

### R1 · One status word set and one status badge

- What changes: A single `runStatus` map (see COPY-03) and a single `StatusBadge` for the queue, the history, the pull request page, and the workspace.
- Why it is better: Eight states, eight labels, one place to change them. The longest label is two words.
- Sketch:

  ```tsx
  <Badge $layer={tone[status]} $rounded="full">
    <BadgeSlot>
      <Icon />
    </BadgeSlot>
    <BadgeLabel>{runStatus[status].label}</BadgeLabel>
  </Badge>
  // Needs review · Rejected · Passed · Capturing · Comparing · Rerun needed · Replaced · Failed
  ```

### R2 · Variant chips without the key

- What changes: A chip shows only the parts that differ inside the item. Default values are hidden. The key moves to a tooltip. Three lab variants: (a) chips with an icon and a word, (b) icon-only chips with a tooltip, (c) a matrix with frameworks as rows and with browser and scheme as columns.
- Why it is better: Seven variants fit in one row at 1440 px. The cut text disappears. The accessible name is short.
- Sketch:

  ```text
  (a) [⚛ React ◐ Chromium ☀ 1] [◆ Solid ◐ Chromium ☀ 2] [⚛ React ◐ Chromium ☾ 3] [⚛ React 🦊 Firefox ☀ 4]
  (c)           Chromium ☀  Chromium ☾  Firefox ☀  WebKit ☀
      React        ●           ●           ✓          ●
      Solid        ●           –           –          –
  ```

### R3 · One workspace header row

- What changes: Merge the run bar, the meta strip, and the item heading. Commit, attempt, and baseline move to the details panel. The progress text becomes `9 left`.
- Why it is better: Three of the seven bands go away. The image starts about 100 px higher.
- Sketch:

  ```tsx
  <ShellMainHeader $height="sm" $border>
    <Button render={<a href="/" />}>← Queue</Button>
    <Text className="truncate">#7731 Fix Combobox popover position</Text>
    <Text className="ak-ink-60">9 left</Text>
    <Progress value={2} max={11} aria-label="Review progress" />
    <Button aria-expanded={detailsOpen}>Details</Button>
  </ShellMainHeader>
  ```

### R4 · A two-word action bar and a quiet save state

- What changes: Buttons `Reject` and `Approve`. A menu button `All 7` replaces `All 7 changed views…`. The save state is one or two words beside Undo: `Saving…`, `Saved`, or `Not saved` with one `Retry` button. Shortcut hints are `Kbd` elements that are hidden from the accessible name.
- Why it is better: The primary action is one word. A normal save produces no sentence.
- Sketch:

  ```text
  ↶ Undo   Saved                                [All 7 ▾]   [✕ Reject  X]   [✓ Approve  A]
  ↶ Undo   Not saved  [Retry]                   [All 7 ▾]   [✕ Reject  X]   [✓ Approve  A]
  ```

### R5 · One read-only line

- What changes: A single line below the header: an icon, a two-word state, and one short reason. No footer text. The disabled Approve and Reject buttons point to this line with `aria-describedby`.
- Why it is better: One explanation in one place. Keyboard and touch users can read it. A `title` on a disabled button is not reachable for them.
- Sketch:

  ```tsx
  <Frame id="read-only" $layer="warning" $p={2} role="status">
    <Text>Read-only · This run is already the baseline.</Text>
  </Frame>
  ```

### R6 · Queue as a dense list

- What changes: Replace cards, stats, eyebrow, and subtitle with grouped rows. The whole row is a link. Section headings carry the counts. Time is relative.
- Why it is better: Six runs fit in about 300 px. Each fact appears once.
- Sketch:

  ```tsx
  <Text render={<h2 />}>To review · 3</Text>
  <Nav aria-label="Runs to review" $layout="vertical">
    <NavLink href="/runs/…">
      <Text className="tabular-nums ak-ink-60">#7731</Text>
      <ButtonLabel>Fix Combobox popover position when the anchor scrolls</ButtonLabel>
      <Badge><BadgeLabel>14 changes</BadgeLabel></Badge>
      <time dateTime={iso} title={absolute}>20 min ago</time>
    </NavLink>
  </Nav>
  ```

  Lab variants: (a) list rows, (b) compact cards with one meta line, (c) a single list in which the status badge replaces the sections.

### R7 · History table with three plain columns

- What changes: Columns `Run`, `Status`, `When`. Attempt shows only when it is above 1. The search placeholder is `Search runs…`. The status filter is a row of toggle chips with counts.
- Why it is better: No sentence explains the 100-run limit. The table caption `Latest 100 runs` can be the only mention.
- Sketch:

  ```text
  History · latest 100       [Search runs…]   All 20 · Passed 9 · Failed 3 · Replaced 3 …
  #7731 Fix Combobox popover position   ● Needs review   20 min ago
  main  c3d4e5f                         ✓ Passed         3 d ago
  ```

### R8 · One access gate for all routes

- What changes: A shared `AccessGate` with four states (see COPY-09). Loading is a skeleton of the target page, not a sentence.
- Why it is better: One sentence for each state. The wait for the access check has no text that names it.
- Sketch:

  ```text
  ┌──────────────────────────────────────────┐
  │ Sign in to review pull request #7731     │
  │ You need write access to ariakit/ariakit │
  │ [ Sign in with GitHub ]                  │
  └──────────────────────────────────────────┘
  ```

### R9 · Status page as rows with meters

- What changes: Capacity becomes two `Progress` meters. Each alert is a row: title, one action sentence, relative time, guide link. The refresh control is an icon button beside `checked 2 min ago`.
- Why it is better: The page answers "is something wrong?" in one line for each alert. The runbook stays in the guide.
- Sketch:

  ```tsx
  <Frame render={<li />} $layer $border $rounded="xl" $p={3} className="flex items-center gap-3">
    <Badge $layer="danger">
      <BadgeLabel>Backup</BadgeLabel>
    </Badge>
    <Text className="flex-1">Check backup access and storage.</Text>
    <time dateTime={iso} title={absolute} className="ak-ink-60">
      3 d
    </time>
    <Button render={<a href={guide + "#backup"} />}>Guide</Button>
  </Frame>
  ```

### R10 · Details as a short definition list

- What changes: Plain labels (`Changed`, `Size`, `Tolerance`, `Environment`, `Commit`), human values, and one `Copy debug info` button for IDs and digests.
- Why it is better: The panel fits without scroll. Hashes are one click away for an incident.
- Sketch:

  ```text
  DETAILS                                ✕
  React · Chromium · light   ● Needs review
  Changed      120 px (0.05%)
  Size         600 × 400
  Tolerance    threshold 0.2, max 0 px
  Environment  Same as baseline
  Commit       aabbccd ↗
  [Copy debug info]
  ```

### R11 · Keyboard dialog with `Kbd` and short rows

- What changes: Two columns, one to four words for each row, mode names equal to the buttons. No intro paragraph. The `Shortcuts on/off` button becomes a switch inside this dialog.
- Why it is better: About 40 words in place of about 100. The footer loses a control.
- Sketch:

  ```tsx
  <dl>
    <dt>
      <Kbd>↑</Kbd> <Kbd>↓</Kbd>
    </dt>
    <dd>Previous / next screenshot</dd>
    <dt>
      <Kbd>←</Kbd> <Kbd>→</Kbd>
    </dt>
    <dd>Previous / next variant</dd>
    <dt>
      <Kbd>A</Kbd> <Kbd>X</Kbd>
    </dt>
    <dd>Approve / reject</dd>
    <dt>
      <Kbd>⇧A</Kbd> <Kbd>⇧X</Kbd>
    </dt>
    <dd>Approve / reject all variants</dd>
    <dt>
      <Kbd>S</Kbd> <Kbd>D</Kbd> <Kbd>G</Kbd> <Kbd>F</Kbd>
    </dt>
    <dd>Side by side / Diff / Baseline / Current</dd>
    <dt>
      <Kbd>⌘Z</Kbd>
    </dt>
    <dd>Undo</dd>
  </dl>
  ```

### R12 · One pane for additions and removals

- What changes: When a variant has only one image, show one centered pane with an `Added` or `Removed` badge in the caption. The Diff button is disabled and has a tooltip.
- Why it is better: No empty checkerboard, no "New image, no reference", no always-on hint.
- Sketch:

  ```text
  [Side by side | Diff (off) | Baseline | Current]
  ┌──────────────── Current · Added ────────────────┐
  │                    (image)                       │
  └──────────────────────────────────────────────────┘
  ```

### R13 · Relative time with an absolute tooltip

- What changes: `20 min ago`, `3 h ago`, `Sep 19` in place of `Oct 5, 2026, 11:10 AM`. The `time` element keeps the absolute value in `title` and `dateTime`.
- Why it is better: Two or three words in place of five on every row. A wrong date (such as the 1969 preview date) reads as "56 years ago" and is found during development.
- Sketch:

  ```tsx
  <Text render={<time dateTime={iso} title={absolute} />} className="ak-ink-60">
    20 min ago
  </Text>
  ```

### R14 · Sidebar rows with counts, not sentences

- What changes: A row shows the name and a compact count (`7`, or `5/7`). The state dot keeps the color and gets a text alternative. The group `Accepted (1)` becomes `Done · 1`.
- Why it is better: The phrase "need review" leaves the list. The row height can drop.
- Sketch:

  ```text
  SCREENSHOTS  4          [All ▾] Search…
  ▣ Success dialog      7 ●
  ▣ Open menu           2 ●
  ▣ New item        Added ✓
  › Done · 1
  ```

## Terminology table

One word for each concept. "Retire" lists the words that the UI and the server messages use today for the same thing. The proposed words are options for the maintainer (see COPY-02).

| Concept                                                             | Proposed word                                                                        | Retire                                                                                              | Notes                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A named thing that the tests capture (for example "Success dialog") | screenshot                                                                           | item, review item, comparison item, capture                                                         | The sidebar title already says `Screenshots`. The protocol can keep `itemKey`. |
| One rendering of a screenshot (framework, browser, color scheme)    | variant                                                                              | view, changed view, target, row                                                                     | `view` stays free for display modes.                                           |
| A variant that differs from the baseline and needs a verdict        | change                                                                               | view awaiting approval, pending variant, review work                                                | Use it for counts: `14 changes`.                                               |
| One CI capture of one commit                                        | run                                                                                  | capture, capture run, visual capture, comparison (when it means the run), attempt (as a synonym)    | Show `Attempt n` only when n is above 1, and only in details.                  |
| The accepted image                                                  | baseline                                                                             | reference, original                                                                                 | Also the caption and the image `alt`.                                          |
| The image from this run                                             | current                                                                              | new image, candidate                                                                                | Design lab alternative: Before / After.                                        |
| The red overlay                                                     | diff                                                                                 | difference, pixel diff, red pixel diff, mask, diff evidence                                         | Button `Diff`, caption `Diff`.                                                 |
| Two images next to each other                                       | side by side                                                                         | compare                                                                                             | "Compare" describes every mode.                                                |
| A new screenshot or variant                                         | added                                                                                | new image, addition                                                                                 | Badge `Added`.                                                                 |
| A deleted screenshot or variant                                     | removed                                                                              | removal                                                                                             | Badge `Removed`.                                                               |
| The reviewer action and its result                                  | approve / approved, reject / rejected                                                | accept, accepted, acceptance                                                                        | `Auto-approved` for `Accepted automatically`.                                  |
| No verdict yet                                                      | needs review                                                                         | pending, awaiting approval                                                                          |                                                                                |
| One saved verdict (single or batch)                                 | decision                                                                             | command, review (as a noun for a save), target list                                                 | `Undo` needs no object.                                                        |
| The images that support a decision                                  | images                                                                               | evidence, bytes, image bytes, representatives                                                       |                                                                                |
| Run state words                                                     | Needs review, Rejected, Passed, Capturing, Comparing, Rerun needed, Replaced, Failed | The 20 labels in the COPY-03 table                                                                  | One map for all pages.                                                         |
| The page that lists runs to review                                  | Queue                                                                                | review queue, run list, Runs page, "All runs"                                                       | The nav and the back link use the same word.                                   |
| The page that lists past runs                                       | History                                                                              | run history, loaded history, "View history"                                                         |                                                                                |
| The page with system health                                         | Status                                                                               | Operations, Service status, Service attention                                                       |                                                                                |
| One health problem                                                  | alert                                                                                | operation alert, service alert                                                                      |                                                                                |
| Read-only state                                                     | read-only                                                                            | archived, closed, promoted history, historical                                                      | One reason sentence for each cause.                                            |
| Running the tests again                                             | rerun the visual tests in CI                                                         | trusted Submit, trusted workflow, fresh Submit, recompare, recomparison, capture a new complete run |                                                                                |
| The run is not complete                                             | CI is still uploading                                                                | sealed, complete capture, complete run is processed                                                 |                                                                                |
| Access rule                                                         | write access to {repository}                                                         | repository write permission, Ariakit maintainers, repository access                                 |                                                                                |
| Sign-in                                                             | Sign in with GitHub                                                                  | GitHub login, GitHub session                                                                        |                                                                                |
| Support identifier                                                  | Error ID                                                                             | Reference                                                                                           |                                                                                |

## Rewrite table

"After" is a proposal for the maintainer and for the design lab. An empty "After" cell means that the string has no replacement. Those strings are also in "Removal candidates". A string that is not in this table can stay. File names are the short names from "How it works".

### Header and account

| Before                                                            | After                            | File:line             |
| ----------------------------------------------------------------- | -------------------------------- | --------------------- |
| `Visonaut` (tab title on every page)                              | `{page or run title} · Visonaut` | `__root.tsx:10`       |
| `Review queue` / `Run history` / `Service status` (nav)           | `Queue` / `History` / `Status`   | `app-shell.tsx:16-18` |
| `Visonaut review queue` (logo name)                               | `Visonaut`                       | `app-shell.tsx:29`    |
| `Account`                                                         | `@{login}`                       | `user-menu.tsx:24`    |
| `Manage your GitHub session.`                                     |                                  | `user-menu.tsx:62`    |
| `This preview uses sample data. Account actions are unavailable.` | `Sample data. Sign-in is off.`   | `user-menu.tsx:61`    |

### Dashboard

All rows are in `index.tsx`.

| Before                                                                                        | After                                                     | Line                   |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------- |
| `Checking access and loading runs…`                                                           | A skeleton, or `Loading…`                                 | `:277`                 |
| `Visual regression review`                                                                    |                                                           | `:287`                 |
| `Every change. A clear decision.`                                                             |                                                           | `:293`                 |
| `Compare screenshots and approve expected changes in your repository.`                        |                                                           | `:297`                 |
| `Review visual changes.`                                                                      | `Sign in to Visonaut`                                     | `:305`                 |
| `Use a GitHub account with write access to this repository.`                                  | `You need write access to {repository}.`                  | `:308`                 |
| `Sign-in could not start. Please try again.`                                                  | `Sign-in failed. Try again.`                              | `:220`                 |
| `Sign-out failed. Please try again.`                                                          | `Sign-out failed. Try again.`                             | `:233`                 |
| `Repository access required`                                                                  | `No access`                                               | `:334`                 |
| `Your repository access changed. Write access to this repository is required.`                | `You need write access to {repository}.`                  | `:171`, `:192`         |
| `The review queue could not be loaded`                                                        | `Could not load runs`                                     | `:335`                 |
| `The run list is temporarily unavailable. Please retry.`                                      | `Try again in a moment.`                                  | `:196`                 |
| `The service is temporarily unavailable.`                                                     | `Try again in a moment.`                                  | `:204`                 |
| `The run list could not be read. Retry loading the page.`                                     | `Unexpected response. Reload the page.`                   | `:77`                  |
| `The service returned an invalid run. Retry loading the page.`                                | `Unexpected response. Reload the page.`                   | `:89`                  |
| `The baseline state could not be read.`                                                       | `Unexpected response. Reload the page.`                   | `:111`                 |
| `Preview fixtures · GitHub login is disabled`                                                 | One `Preview` badge in the header                         | `:360`                 |
| `{repository}` (eyebrow)                                                                      |                                                           | `:430`, `:628`         |
| `Your review queue.`                                                                          | `Queue` (or no page title)                                | `:433`                 |
| `{n} runs are ready for review.`                                                              |                                                           | `:437`                 |
| `Captures in progress and runs that need attention appear here.`                              |                                                           | `:439`                 |
| `No runs need a decision or recovery.`                                                        |                                                           | `:440`                 |
| `Refresh runs`                                                                                | `Refresh`                                                 | `:447`, `:642`         |
| `Runs to review` / `Awaiting approval` / `Rejected views`                                     | Remove the strip, or `To review` / `Changes` / `Rejected` | `:452-454`             |
| `Ready to review`                                                                             | `To review · {n}`                                         | `:471`                 |
| `New capture needed`                                                                          | `Rerun needed`                                            | `:131`                 |
| `Waiting for screenshots`                                                                     | `Capturing`                                               | `:133`                 |
| `Comparing images`                                                                            | `Comparing`                                               | `:134`                 |
| `Changes rejected`                                                                            | `Rejected`                                                | `:136`                 |
| `Run failed`                                                                                  | `Failed`                                                  | `:137`                 |
| `Replaced by a newer run`                                                                     | `Replaced`                                                | `:138`                 |
| `{n} view await approval.` / `{n} views await approval.`                                      | `{n} change` / `{n} changes`                              | `:502`                 |
| `, including {n} rejected.`                                                                   | ` · {n} rejected`                                         | `:503`                 |
| `Attempt {n}`                                                                                 | Show it only when n is above 1                            | `:404`, `:589`, `:717` |
| `{date}` as `Oct 5, 2026, 11:10 AM`                                                           | `20 min ago`, with the full date in `title`               | `:156`                 |
| `Review changes`                                                                              | `Review`                                                  | `:512`                 |
| `All reviews are complete.`                                                                   | `All caught up`                                           | `:533`                 |
| `New visual changes will appear here.`                                                        |                                                           | `:537`                 |
| `No captures yet.`                                                                            | `No runs yet`                                             | `:533`                 |
| `Run the visual test workflow to create your first baseline.`                                 | `Run the visual tests in CI to create the baseline.`      | `:538`                 |
| `In progress` / `Needs attention`                                                             | `In progress · {n}` / `Needs attention · {n}`             | `:542-543`             |
| `Open run`                                                                                    | Make the row a link                                       | `:593`                 |
| `Baseline revision {n}` / `No baseline yet`                                                   |                                                           | `:547`                 |
| `View history`                                                                                |                                                           | `:550`                 |
| `Run history.`                                                                                | `History`                                                 | `:631`                 |
| `Results for the latest 100 runs. Older work that needs attention stays in the review queue.` | `Latest 100 runs`                                         | `:634`                 |
| `Search loaded history…` (placeholder) and `Search loaded history` (name)                     | `Search runs…` / `Search runs`                            | `:657-658`             |
| `Result` + `All results` + name `Filter history by result`                                    | `Status` + `All`                                          | `:673-680`             |
| Column `Result`                                                                               | `Status`                                                  | `:699`                 |
| Column `Created`                                                                              | `When`                                                    | `:700`                 |
| `Change the search or result filter.`                                                         | A `Clear filters` button                                  | `:742`                 |
| `The first capture run will appear here.`                                                     |                                                           | `:743`                 |
| `Search and filters apply to the loaded runs.`                                                |                                                           | `:748`                 |

### Pull request page

All rows are in `pulls.$pullNumber.tsx`.

| Before                                                                                                         | After                                                                                      | Line                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------- |
| `Visual review · Pull request #{n}`                                                                            |                                                                                            | `:177`                     |
| `Finding this pull request’s visual review…`                                                                   | A skeleton, or `Loading…`                                                                  | `:181`                     |
| `Compare screenshots and approve expected changes. Use a GitHub account with write access to this repository.` | `You need write access to {repository}.`                                                   | `:190`                     |
| `Write access to this repository is required to open its review.`                                              | `You need write access to {repository}.`                                                   | `:66`                      |
| `Review unavailable`                                                                                           | `Could not load the review`                                                                | `:211`                     |
| `This Visonaut check was not found. Open the latest check on GitHub.`                                          | `Check not found. Open the latest check on GitHub.` with a GitHub link in place of `Retry` | `:71`                      |
| `The pull request could not be loaded. Please retry.`                                                          | `Try again in a moment.`                                                                   | `:73`                      |
| `Invalid response.`                                                                                            | `Unexpected response. Reload the page.`                                                    | `:75`, `:78`, `:86`, `:88` |
| `The service is unavailable.`                                                                                  | `Try again in a moment.`                                                                   | `:97`                      |
| `Sign-in could not start. Please retry.`                                                                       | `Sign-in failed. Try again.`                                                               | `:130`                     |
| `Waiting for screenshots.`                                                                                     | `Waiting for CI`                                                                           | `:261`                     |
| `The visual capture has not reached Visonaut yet. This page updates automatically when the review is ready.`   | `This page opens the review when the screenshots arrive.`                                  | `:268`                     |
| `Visual capture failed.`                                                                                       | `Visual tests failed`                                                                      | `:260`                     |
| `No review is ready. Open the pull request on GitHub to inspect the failing check.`                            | `Open the failing check on GitHub.`                                                        | `:267`                     |
| `No visual review needed.`                                                                                     | `Nothing to review`                                                                        | `:258`                     |
| `This pull request does not require a visual capture.`                                                         | `This pull request does not need visual tests.`                                            | `:265`                     |
| `Check again`                                                                                                  | `Refresh`                                                                                  | `:275`                     |

### Run page gate

All rows are in `runs.$runId.tsx`.

| Before                                                          | After                                                                        | Line   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| `Checking access and loading this run…`                         | A skeleton, or `Loading…`                                                    | `:70`  |
| `This run could not be opened`                                  | `Could not open this run`                                                    | `:95`  |
| `Write access to this repository is required to open this run.` | `You need write access to {repository}.` with a `Use another account` button | `:80`  |
| `The run could not be loaded. Please retry.`                    | `Try again in a moment.`                                                     | `:83`  |
| `This review is available to Ariakit maintainers.`              | `You need write access to {repository}.`                                     | `:230` |

### Service status

All rows are in `operations-attention/index.tsx`.

| Before                                                                                                                                                                                                     | After                                                                                                                  | Line                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `Operations`                                                                                                                                                                                               |                                                                                                                        | `:315`                      |
| `Service status.`                                                                                                                                                                                          | `Status`                                                                                                               | `:321`                      |
| `Service attention` (popover heading)                                                                                                                                                                      | `Alerts`                                                                                                               | `:325`                      |
| `Service attention: {n} alert(s)` and the 5 other bell names                                                                                                                                               | `{n} alerts` / `No alerts` / `Checking alerts` / `Alerts unavailable`                                                  | `:294-300`                  |
| `Unresolved alerts and what they mean for your reviews. This page checks for updates every minute.`                                                                                                        |                                                                                                                        | `:331`                      |
| `Alerts refresh every minute while this dashboard is open. No external notifications are sent.`                                                                                                            |                                                                                                                        | `:336`                      |
| `{n} unresolved operation alert(s). Last checked {date}.`                                                                                                                                                  | `{n} alerts · checked {relative time}`                                                                                 | `:343`                      |
| `No unresolved operation alerts. Last checked {date}.`                                                                                                                                                     | `No alerts · checked {relative time}`                                                                                  | `:343`                      |
| `Checking for unresolved operation alerts…`                                                                                                                                                                | `Checking…`                                                                                                            | `:345`                      |
| `No current alert data.`                                                                                                                                                                                   |                                                                                                                        | `:346`                      |
| `Refresh alerts` / `Checking alerts…` / `Retry alerts`                                                                                                                                                     | `Refresh` / `Checking…` / `Retry`                                                                                      | `:360`                      |
| `Operation alerts are temporarily unavailable.` + `The current alert state is unknown.`                                                                                                                    | `Could not load alerts.`                                                                                               | `:243`, `:372`              |
| `Operation alerts could not be loaded.` / `Operation alerts could not be read. Retry loading them.` / `An operation alert could not be read. Retry loading them.` / `Database capacity could not be read.` | `Could not load alerts.`                                                                                               | `:276`, `:45`, `:64`, `:78` |
| `Shown alerts may be out of date.`                                                                                                                                                                         | `These alerts may be out of date.`                                                                                     | `:372`                      |
| `Database: {n} MiB used; {n} MiB before new runs pause.`                                                                                                                                                   | `Database {used} of {limit} MiB` with a meter                                                                          | `:384`                      |
| `Active captures: {n} of {n}. Capacity sampled {date}.`                                                                                                                                                    | `Active runs {n} of {n}` with a meter                                                                                  | `:388`                      |
| `GitHub webhook delivery needs attention`                                                                                                                                                                  | `GitHub webhook`                                                                                                       | `:101`                      |
| `Database capacity needs attention`                                                                                                                                                                        | `Database capacity`                                                                                                    | `:112`                      |
| `A backup needs attention`                                                                                                                                                                                 | `Backup`                                                                                                               | `:119`                      |
| `A GitHub check needs attention`                                                                                                                                                                           | `GitHub check`                                                                                                         | `:130`                      |
| `A comparison could not enter the queue`                                                                                                                                                                   | `Comparison queue`                                                                                                     | `:139`                      |
| `A comparison exhausted its retries`                                                                                                                                                                       | `Comparison retries`                                                                                                   | `:146`                      |
| `A comparison could not finish`                                                                                                                                                                            | `Comparison`                                                                                                           | `:153`                      |
| `A signed capture run needs attention`                                                                                                                                                                     | `Capture run`                                                                                                          | `:160`                      |
| `A baseline update needs attention`                                                                                                                                                                        | `Baseline update`                                                                                                      | `:167`                      |
| `Storage cleanup needs attention`                                                                                                                                                                          | `Storage cleanup`                                                                                                      | `:182`                      |
| `A restored deployment needs attention`                                                                                                                                                                    | `Restore`                                                                                                              | `:189`                      |
| `A service operation needs attention`                                                                                                                                                                      | `Service operation`                                                                                                    | `:195`                      |
| The 15 alert bodies (12 to 33 words each)                                                                                                                                                                  | The first action sentence (for example `Check backup access and storage.`) plus a `Guide` link to the matching section | `:104-197`                  |
| `Technical details`                                                                                                                                                                                        | `Details`                                                                                                              | `:415`                      |
| `No unresolved alerts.`                                                                                                                                                                                    | `No alerts`                                                                                                            | `:439`                      |
| `This view reports operation alerts. It does not test every service dependency.`                                                                                                                           |                                                                                                                        | `:442`                      |
| `Showing the 50 most recently reported unresolved alerts.`                                                                                                                                                 | `Showing the latest 50`                                                                                                | `:448`                      |
| `Open the operations and recovery guide`                                                                                                                                                                   | `Recovery guide`                                                                                                       | `:460`                      |
| `No external notifications are sent.`                                                                                                                                                                      |                                                                                                                        | `:465`                      |
| `Service attention: {n} unresolved service alert(s).`                                                                                                                                                      | `{n} alerts.`                                                                                                          | `:253`                      |
| `Service attention: no unresolved service alerts.`                                                                                                                                                         | `No alerts.`                                                                                                           | `:254`                      |
| `Service alert update {n}: {n} alert(s) now visible. {title}.`                                                                                                                                             | `New alert: {title}.`                                                                                                  | `:259`                      |
| `Service attention: all alerts resolved.`                                                                                                                                                                  | `All alerts resolved.`                                                                                                 | `:262`                      |
| `Service attention: alerts refreshed.`                                                                                                                                                                     | `Alerts refreshed.`                                                                                                    | `:264`                      |
| `Service attention: alert refresh failed. Cached alerts may be out of date.`                                                                                                                               | `Could not refresh alerts.`                                                                                            | `:274`                      |

### Workspace: navigation and list

| Before                                                                                                                                                                                                                                                 | After                                                         | File:line                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| `Review navigation` (sidebar name)                                                                                                                                                                                                                     | `Screenshots`                                                 | `review-workspace.tsx:545`                          |
| `{n} items`                                                                                                                                                                                                                                            | `{n}`                                                         | `review-workspace.tsx:552`                          |
| `Review items` (list name)                                                                                                                                                                                                                             | `Screenshot list`                                             | `item-list.tsx:300`                                 |
| `Active review status`                                                                                                                                                                                                                                 | `Status filter`                                               | `screenshot-filter.tsx:77`                          |
| `Review status: {label}`                                                                                                                                                                                                                               | `Status: {label}`                                             | `screenshot-filter.tsx:81`                          |
| `Review status` (popover name and heading)                                                                                                                                                                                                             | `Status`                                                      | `screenshot-filter.tsx:134`, `:147`                 |
| `{n} of {n} need review` (row)                                                                                                                                                                                                                         | `{n}` or `{n}/{m}`, with the text alternative `{n} to review` | `item-list.tsx:256`                                 |
| `{n} rejected variant(s)`                                                                                                                                                                                                                              | `{n} rejected`                                                | `item-list.tsx:255`                                 |
| `{n} comparison(s) running`                                                                                                                                                                                                                            | `Comparing`                                                   | `item-list.tsx:253`                                 |
| `{n} comparison error(s)`                                                                                                                                                                                                                              | `{n} failed`                                                  | `item-list.tsx:251`                                 |
| `Item {n} of {n}`                                                                                                                                                                                                                                      | `Screenshot {n} of {n}`                                       | `item-list.tsx:267`                                 |
| `No screenshots match. Change the search or filter.`                                                                                                                                                                                                   | `No matches`                                                  | `item-list.tsx:358`                                 |
| `No screenshots in this comparison.`                                                                                                                                                                                                                   | `No screenshots`                                              | `item-list.tsx:359`                                 |
| `Accepted ({n})`                                                                                                                                                                                                                                       | `Done · {n}`                                                  | `item-list.tsx:378`                                 |
| `Collapse screenshots` / `Expand screenshots`                                                                                                                                                                                                          | `Hide screenshot list` / `Show screenshot list`               | `review-workspace.tsx:571`                          |
| `Toggle screenshots ([)` (title)                                                                                                                                                                                                                       | A tooltip `Screenshot list` with `Kbd` `[`                    | `review-workspace.tsx:575`                          |
| `Main visual review` / `Merge queue visual review` / `Pull request visual review`                                                                                                                                                                      | `main` / `Merge queue` / `Pull request`                       | `review-workspace.tsx:589-592`, `api/review.ts:561` |
| `{n} of {n} need review` (run bar)                                                                                                                                                                                                                     | `{n} left`                                                    | `review-workspace.tsx:597`                          |
| `Attempt {n}` / `Baseline revision {n}` / `{run status}` (meta strip)                                                                                                                                                                                  | Move the values to the details panel                          | `review-workspace.tsx:613-620`                      |
| `Comparison complete` / `Changes need review` / `Check passed` / `Rejected changes` / `Waiting for the complete capture` / `Comparing stored captures` / `A new comparison is required` / `A newer attempt is active` / `Capture or comparison failed` | The shared status labels (COPY-03)                            | `use-review-session.ts:60-76`                       |

### Workspace: header, variants, viewer

| Before                                                                                          | After                                                                                 | File:line                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `Visual review` (h1 fallback)                                                                   | `No screenshots`                                                                      | `review-workspace.tsx:640`                             |
| `Accepted automatically`                                                                        | `Auto-approved`                                                                       | `navigation.ts:171`                                    |
| `Comparison error`                                                                              | `Failed`                                                                              | `navigation.ts:166`                                    |
| `{n}% changed · {n} changed pixels`                                                             | `{n}% · {n} px`                                                                       | `review-workspace.tsx:646`                             |
| `— changed pixels`                                                                              | `Added` / `Removed`                                                                   | `review-workspace.tsx:647`                             |
| `Capture details` (panel)                                                                       | `Details`                                                                             | `review-workspace.tsx:1151`, `:1155`, `:1233`          |
| `Close capture details`                                                                         | `Close details`                                                                       | `review-workspace.tsx:1159`, `:1234`                   |
| `Review is unavailable until the run is sealed and all comparisons are complete.`               | `CI is still uploading screenshots. You can review when the run is complete.`         | `review-workspace.tsx:702`                             |
| `{index}. {raw label}. {status}` (variant name)                                                 | `{Framework}, {Browser}, {scheme}. {status}`                                          | `review-workspace.tsx:776`                             |
| `{raw label} · {status}` (variant `title`)                                                      | A tooltip with the variant key                                                        | `review-workspace.tsx:747`                             |
| `{variant key}` in the pill                                                                     | Hide it when the other parts identify the variant                                     | `variant-summary.tsx:121`                              |
| `Selected variant` (section name)                                                               | `Comparison`                                                                          | `review-workspace.tsx:796`                             |
| `Image history expired`                                                                         | `Images expired`                                                                      | `review-workspace.tsx:808`                             |
| `Closed review summary`                                                                         | `Summary only`                                                                        | `review-workspace.tsx:808`                             |
| `Review results and capture identity remain available. This view does not contain image bytes.` | `The images for this run are deleted. The decisions remain.`                          | `review-workspace.tsx:811`                             |
| `Image view` (group name)                                                                       | `View mode`                                                                           | `review-workspace.tsx:832`                             |
| `Compare`                                                                                       | `Side by side`                                                                        | `review-workspace.tsx:845`                             |
| `Difference`                                                                                    | `Diff`                                                                                | `review-workspace.tsx:860`, `screenshot-viewer.tsx:38` |
| `Image zoom`                                                                                    | `Zoom`                                                                                | `review-workspace.tsx:899`                             |
| `Matched locally. The new image was not uploaded.`                                              | `No visible change. CI did not upload this image.`                                    | `review-workspace.tsx:927`                             |
| `Pixel diff requires both a reference and a new image.`                                         | A tooltip on the disabled `Diff` button: `No diff for an added or removed screenshot` | `review-workspace.tsx:928`                             |
| `Comparison is still running…`                                                                  | `Comparing…`                                                                          | `review-workspace.tsx:946`                             |
| `Loading this comparison’s images…`                                                             | `Loading images…`                                                                     | `review-workspace.tsx:947`                             |
| `Comparison superseded`                                                                         | `Replaced by a newer run`                                                             | `review-workspace.tsx:958`                             |
| `A newer attempt replaced this comparison. Its evidence cannot be reviewed.`                    | `Open the newer run to review.`                                                       | `review-workspace.tsx:137`                             |
| `Comparison needs fresh Submit`                                                                 | `Rerun needed`                                                                        | `review-workspace.tsx:960`                             |
| `This comparison is out of date. Run the trusted workflow again to submit a fresh comparison.`  | `This run is out of date. Rerun the visual tests in CI.`                              | `review-workspace.tsx:139`                             |
| `Comparison failed`                                                                             | `Run failed`                                                                          | `review-workspace.tsx:961`                             |
| `This capture or comparison failed. Its evidence cannot be reviewed.`                           | `Rerun the visual tests in CI.`                                                       | `review-workspace.tsx:141`                             |
| `This comparison was invalidated. Its evidence cannot be reviewed.`                             | `This run is out of date. Rerun the visual tests in CI.`                              | `review-workspace.tsx:143`                             |
| `Image evidence unavailable`                                                                    | `Could not load the images`                                                           | `review-workspace.tsx:963`                             |
| `Comparison evidence incomplete`                                                                | `Images are missing`                                                                  | `review-workspace.tsx:964`                             |
| `Required reference evidence is unavailable in this comparison.`                                | `The baseline image is missing.`                                                      | `use-evidence.ts:83`                                   |
| `Required candidate evidence is unavailable in this comparison.`                                | `The current image is missing.`                                                       | `use-evidence.ts:92`                                   |
| `Required diff evidence is unavailable in this comparison.`                                     | `The diff image is missing.`                                                          | `use-evidence.ts:99`                                   |
| `The image dimensions do not match this comparison.`                                            | `The image size does not match the recorded size.`                                    | `screenshot-viewer.tsx:58`                             |
| `The image could not be decoded. Retry loading the evidence.`                                   | `The image is damaged. Try again.`                                                    | `screenshot-viewer.tsx:68`                             |
| `The image could not be loaded. Check your connection and retry.`                               | `Check your connection, then try again.`                                              | `screenshot-viewer.tsx:158`                            |
| `Retry images`                                                                                  | `Retry`                                                                               | `review-workspace.tsx:976`                             |
| `Reference` (image `alt` and pane name)                                                         | `Baseline`                                                                            | `screenshot-viewer.tsx:218`                            |
| `New image` (image `alt` and pane name)                                                         | `Current`                                                                             | `screenshot-viewer.tsx:229`                            |
| `Pixel diff · red pixels changed`                                                               | `Diff. Changed pixels are red.`                                                       | `screenshot-viewer.tsx:245`                            |
| `{label}. Use pan controls or scroll to inspect the image.`                                     | `{caption} image, scrollable`                                                         | `screenshot-viewer.tsx:136`                            |
| `Pan {label} {direction}` (name) and `Pan {caption} {direction}` (title)                        | `Pan {caption} {direction}` for both                                                  | `screenshot-viewer.tsx:120-121`                        |
| `New image, no reference`                                                                       | `Added. No baseline.` (only for `added`), else `Baseline image missing`               | `screenshot-viewer.tsx:219`                            |
| `Removed, no new image`                                                                         | `Removed` (only for `removed`), else `Current image missing`                          | `screenshot-viewer.tsx:233`                            |
| `New image not uploaded`                                                                        | `Not uploaded (no visible change)`                                                    | `screenshot-viewer.tsx:232`                            |
| `Pixel diff is not available for review.`                                                       | `Diff not ready`                                                                      | `screenshot-viewer.tsx:248`                            |
| `Pixel changes are within the comparison tolerance.`                                            | `Changes are within tolerance.`                                                       | `screenshot-viewer.tsx:252`                            |
| `Pixel diff unavailable`                                                                        | `No diff image`                                                                       | `screenshot-viewer.tsx:253`                            |
| `Image could not be verified.`                                                                  | `Could not load`                                                                      | `screenshot-viewer.tsx:178`                            |
| `No comparison items`                                                                           | `No screenshots`                                                                      | `review-workspace.tsx:1009`                            |
| `This run contains no review items.`                                                            | `This run has no screenshots.`                                                        | `review-workspace.tsx:1012`                            |
| `Images will appear after the complete run is processed.`                                       | `Screenshots appear when CI finishes.`                                                | `review-workspace.tsx:1013`                            |

### Workspace: actions, save state, dialogs, details

| Before                                                                                                                                           | After                                                                                                   | File:line                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `All {n} changed views…`                                                                                                                         | `All {n}` (hidden when n is 1 or less)                                                                  | `review-workspace.tsx:1055`                |
| `Reject view`                                                                                                                                    | `Reject`                                                                                                | `review-workspace.tsx:1077`                |
| `Approve & next`                                                                                                                                 | `Approve`                                                                                               | `review-workspace.tsx:1095`                |
| `Saving {n} decision(s)…`                                                                                                                        | `Saving…`                                                                                               | `use-review-session.ts:310`, `:363`        |
| `Sending {n} decision(s)…`                                                                                                                       | `Saving {n}…`                                                                                           | `review-workspace.tsx:1113`                |
| `{n} queued on server. You can close this window.`                                                                                               | `{n} saving in the background`                                                                          | `review-workspace.tsx:1113`                |
| `{n} variant(s) approved. Saved.`                                                                                                                | `Approved` / `Approved {n} variants`                                                                    | `use-review-session.ts:364`                |
| `Later queued decisions were not saved. Review them again.`                                                                                      | `Later decisions were not saved. Review them again.`                                                    | `use-review-session.ts:349`, `:392`        |
| `Conflict. {message}`                                                                                                                            | Only for a real conflict: `Changed by {reviewer}. Reload to see the latest.`                            | `use-review-session.ts:274`                |
| `The command could not be saved. Check your connection.`                                                                                         | `Check your connection.`                                                                                | `use-review-session.ts:264`                |
| `Reference: {id}.`                                                                                                                               | `Error ID: {id}`                                                                                        | `client.ts:273`                            |
| `Could not confirm the queued decisions. The server will continue processing them. Retry to check their status.`                                 | `Could not confirm the save. The server keeps processing it. Retry to check.`                           | `use-review-session.ts:386`                |
| `The decision has not been submitted.`                                                                                                           | `Not sent. Retry.`                                                                                      | `use-review-session.ts:329`                |
| `Saving Undo…`                                                                                                                                   | `Undoing…`                                                                                              | `use-review-session.ts:456`                |
| `Undo saved. The original selection and verdicts were restored.`                                                                                 | `Undone`                                                                                                | `use-review-session.ts:468`                |
| `Refreshing the current comparison…`                                                                                                             | `Reloading…`                                                                                            | `use-review-session.ts:490`                |
| `Current state loaded. Check the evidence before saving a new command.`                                                                          | `Reloaded. Check the images before you decide.`                                                         | `use-review-session.ts:498`                |
| `The new comparison is ready.`                                                                                                                   | `Ready to review`                                                                                       | `use-review-session.ts:220`                |
| `{run status}. Review actions are unavailable until it is ready.`                                                                                | `{run status}…`                                                                                         | `use-review-session.ts:228`                |
| `Waiting for the new comparison. {message}`                                                                                                      | `Waiting for CI. {message}`                                                                             | `use-review-session.ts:236-237`            |
| `Retry same command`                                                                                                                             | `Retry`                                                                                                 | `review-workspace.tsx:1122`                |
| `Retry Undo`                                                                                                                                     | `Retry undo`                                                                                            | `review-workspace.tsx:1127`                |
| `Refresh current state`                                                                                                                          | `Reload`                                                                                                | `review-workspace.tsx:1132`                |
| The 10 client parser errors (`The service returned an invalid text field.` and others)                                                           | `Unexpected response. Reload the page.`                                                                 | `client.ts:17-158`, `:265`                 |
| The 5 saved-review errors (`The saved review returned an unexpected revision. Refresh before reviewing.` and others)                             | `Unexpected response. Reload the page.`                                                                 | `navigation.ts:97-132`                     |
| `Review all changed views`                                                                                                                       | `All {n} variants of {screenshot}`                                                                      | `review-workspace.tsx:1251`                |
| `This decision applies to all {n} changed views in {item}, including views with a previous decision.`                                            | `This also replaces earlier decisions.`                                                                 | `review-workspace.tsx:1254`                |
| `Reject whole item ({n})`                                                                                                                        | `Reject all {n}`                                                                                        | `review-workspace.tsx:1280`                |
| `Approve whole item ({n})`                                                                                                                       | `Approve all {n}`                                                                                       | `review-workspace.tsx:1293`                |
| The raw variant label in each dialog row                                                                                                         | The variant chip (icons and words)                                                                      | `review-workspace.tsx:1260`                |
| `Keyboard help` / `Review with the keyboard`                                                                                                     | `Keyboard shortcuts`                                                                                    | `review-workspace.tsx:150`, `:160`         |
| `Shortcuts work across this page. Text fields, tabs, menus, and dialogs keep their own keys. Use the visible pan buttons to move zoomed images.` |                                                                                                         | `review-workspace.tsx:162`                 |
| `Previous or next item. Stop at either end.`                                                                                                     | `Previous / next screenshot`                                                                            | `review-workspace.tsx:167`                 |
| `Select a variant.`                                                                                                                              | `Previous / next variant, or jump to 1–6`                                                               | `review-workspace.tsx:169`                 |
| `Approve or reject, then move to the next pending variant.`                                                                                      | `Approve / reject`                                                                                      | `review-workspace.tsx:171`                 |
| `Review all changed variants in this item as one command.`                                                                                       | `Approve / reject all variants`                                                                         | `review-workspace.tsx:173`                 |
| `Side by side, red pixel diff, new image only, or original only.`                                                                                | `Side by side / Diff / Current / Baseline`                                                              | `review-workspace.tsx:175`                 |
| `Undo your last saved command in this session.`                                                                                                  | `Undo`                                                                                                  | `review-workspace.tsx:177`                 |
| `Collapse or expand the screenshot sidebar.`                                                                                                     | `Show or hide the screenshot list`                                                                      | `review-workspace.tsx:179`                 |
| `Move to controls or close this help.`                                                                                                           |                                                                                                         | `review-workspace.tsx:181`                 |
| `Close help`                                                                                                                                     | `Close`                                                                                                 | `review-workspace.tsx:184`                 |
| `Shortcuts on` / `Shortcuts off`                                                                                                                 | A `Shortcuts` switch inside the keyboard dialog                                                         | `review-workspace.tsx:1184`                |
| `The remembered variant is unavailable. Selected {label}.`                                                                                       | `Selected {label}.`                                                                                     | `review-workspace.tsx:347`, `:366`         |
| `Pixel diff requires both a reference and a new image. The current view has not changed.`                                                        | `No diff for this screenshot.`                                                                          | `review-workspace.tsx:379`                 |
| `Review complete. No variants need review.`                                                                                                      | `All reviewed.`                                                                                         | `use-review-session.ts:367`                |
| `Resolve the unsaved command before saving another review.`                                                                                      | `Retry or reload the failed save first.`                                                                | `use-review-session.ts:410`                |
| `{reason} No variants were changed.`                                                                                                             | `{reason} Nothing changed.`                                                                             | `use-review-session.ts:426`                |
| `Select an eligible variant and review it individually.`                                                                                         | `Review the variants one by one.`                                                                       | `use-review-session.ts:426`                |
| `{raw label} · {status} · {reviewer}` (details, line 1)                                                                                          | The variant chip, the status badge, and `by @{login}`                                                   | `review-workspace.tsx:464`                 |
| `Run {id} · Attempt {n} · Commit {sha} · Comparison {n}`                                                                                         | Rows `Commit {sha}` (GitHub link) and `Run {short id}`. `Attempt {n}` only above 1. No `Comparison {n}` | `review-workspace.tsx:469-471`             |
| `Original comparison`                                                                                                                            | Hide it when the run has no older comparison, else `Latest`                                             | `review-workspace.tsx:474`                 |
| `Historical comparison {n} · Complete / Failed / Comparing`                                                                                      | `Older comparison {n} · {state}`                                                                        | `review-workspace.tsx:481-486`             |
| `Changed pixels` + `{n} ({n}%)` with four decimals                                                                                               | `Changed` + `{n} px ({n}%)` with two decimals                                                           | `review-workspace.tsx:491-494`             |
| `Dimensions`                                                                                                                                     | `Size`                                                                                                  | `review-workspace.tsx:496`                 |
| `Absent`                                                                                                                                         | `None`                                                                                                  | `review-workspace.tsx:500`, `:504`, `:516` |
| `Engine / codec`                                                                                                                                 | `Compared with` (inside "Copy debug info")                                                              | `review-workspace.tsx:506`                 |
| `Policy / threshold` + digest + sentence                                                                                                         | `Tolerance` + `threshold 0.2, max 0 px`                                                                 | `review-workspace.tsx:510`                 |
| `Capture profiles` + two digests                                                                                                                 | `Environment` + `Same as baseline` or `Differs from baseline`                                           | `review-workspace.tsx:514`                 |
| `Comparison` + `{comparison id} · {row id} · decision revision {n}`                                                                              | Inside "Copy debug info"                                                                                | `review-workspace.tsx:518-520`             |

### Server text

| Before                                                                                                                                       | After                                                                                                     | File:line                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `This run is archived. Decisions show the state at archive time and are read-only.`                                                          | `Read-only. This run is closed.`                                                                          | `api/review.ts:98`                                                                 |
| `This closed review has a permanent decision summary. Image replay has ended. Capture a new run for review.`                                 | `Read-only. The images for this run are deleted.`                                                         | `closed-summary.ts:18`                                                             |
| `This historical comparison is read-only. It does not affect the live review or required check.`                                             | `Read-only. This is an older comparison of this run.`                                                     | `api/review.ts:581`                                                                |
| `This baseline was imported. Previous comparison details were discarded during the database cutover. Capture a new complete run for review.` | `Read-only. This baseline was imported without its review details.`                                       | `api/review.ts:583`                                                                |
| `This run is already in the baseline. Capture a correction in a new complete main run.`                                                      | `Read-only. This run is already the baseline. To correct it, land a change on main.`                      | `api/review.ts:546`, `:585`                                                        |
| `Promoted history is read-only.`                                                                                                             | The same sentence as the Reject reason                                                                    | `api/review.ts:547`                                                                |
| `This closed review is read-only. Capture a new complete run.`                                                                               |                                                                                                           | `api/review.ts:595`                                                                |
| `Run trusted Submit again from the complete CI bundle, or capture a new run. Unchanged candidate images were not uploaded.`                  |                                                                                                           | `api/review.ts:597`                                                                |
| `Server recomparison is retired. Capture a new complete run with trusted local Submit.`                                                      |                                                                                                           | `api/review.ts:102`                                                                |
| `Historical comparison failed. Required comparison evidence or its reference is unavailable. Capture a new complete run for a new result.`   | `This older comparison failed. Its images are missing.`                                                   | `api/review.ts:100`                                                                |
| `Comparison stopped before evidence was available.`                                                                                          | `The comparison stopped before it produced images.`                                                       | `api/review.ts:534`                                                                |
| `Comparison evidence is unavailable.`                                                                                                        | `The comparison failed.`                                                                                  | `api/review.ts:536`                                                                |
| `Color threshold {n}; maximum {n} pixels; ratio {n}` (with a trailing `; ` in two cases)                                                     | Send numbers, or `threshold {n}, max {n} px, max ratio {n}` joined without a trailing separator           | `api/review.ts:525`                                                                |
| `Channel threshold {n}; maximum {n} changed pixels; ratio {n}.`                                                                              | The same format as above                                                                                  | `api/review.ts:413`                                                                |
| `Preview fixtures are read-only. GitHub login is disabled.`                                                                                  | `Preview. Sample data, read-only.`                                                                        | `preview-fixtures.ts:6`                                                            |
| `Preview fixtures` (as the repository name)                                                                                                  | `Preview`                                                                                                 | `preview-fixtures.ts:25`, `:96`                                                    |
| `The service is temporarily unavailable.`                                                                                                    | `Something went wrong. Try again.`                                                                        | `api/index.ts:78`                                                                  |
| `Sign in with GitHub.` (after a failed save)                                                                                                 | Client text for the code `sign_in_required`: `Your session ended.` with a `Sign in` button                | `packages/security/src/authorization.ts:38`                                        |
| `A GitHub identity is required.` / `Repository write permission is required.`                                                                | `You need write access to {repository}.`                                                                  | `packages/security/src/authorization.ts:46`, `packages/security/src/github.ts:227` |
| `GitHub verification is temporarily unavailable.`                                                                                            | `Could not check your GitHub access. Try again.`                                                          | `packages/security/src/github.ts:25`                                               |
| `The run was not found.` / `The resource identity is invalid.` / `The requested record does not exist.`                                      | `Run not found.`                                                                                          | `api/review.ts:92`, `api/input.ts:43`, `packages/service/src/service.ts:95`        |
| `Closed history is being converted to a decision summary.`                                                                                   | `This run is being archived. Try again in a few minutes.`                                                 | `api/review.ts:247`                                                                |
| `The historical comparison archive is unavailable.`                                                                                          | `The archive for this comparison is unavailable.`                                                         | `api/review.ts:260`                                                                |
| `Start a new review session after signing in.`                                                                                               | `Your session changed. Reload the page.`                                                                  | `api/review.ts:631`                                                                |
| `Command replay has ended. The permanent decision summary remains available.`                                                                | `This run is closed. Reload to see the final decisions.`                                                  | `api/review.ts:678`                                                                |
| `The queued decision was not found.`                                                                                                         | `Save not found. Reload the page.`                                                                        | `api/review.ts:803`, `:807`                                                        |
| `The queued decision could not be processed. Review it again.`                                                                               | `Not saved. Review it again.`                                                                             | `api/review.ts:825`                                                                |
| `Your command was not found.`                                                                                                                | `Nothing to undo.`                                                                                        | `api/review.ts:923`                                                                |
| `This command ID already belongs to another decision.` / `The command ID already belongs to another request.`                                | `Duplicate request. Reload the page.`                                                                     | `review-queue.ts:30`, `packages/service/src/review-commands.ts:82`                 |
| `The previous decision has not reached the server. Retry the unsent decisions.`                                                              | `An earlier decision did not reach the server. Retry.` (and send it with a class that reaches the client) | `review-queue.ts:37`                                                               |
| `The previous decision belongs to another review session.`                                                                                   | `Your session changed. Reload the page.`                                                                  | `review-queue.ts:46`                                                               |
| `An earlier queued decision failed. Review the current evidence again.`                                                                      | `An earlier decision failed. Review the images again.`                                                    | `review-queue.ts:114`                                                              |
| `A review command requires a maintainer, session, and unique targets.`                                                                       | `Invalid request. Reload the page.`                                                                       | `packages/service/src/review-commands.ts:142`                                      |
| `Archived history is read-only.`                                                                                                             | `This run is closed.`                                                                                     | `packages/service/src/review-commands.ts:184`                                      |
| `A target changed or belongs to another comparison.`                                                                                         | `Someone else changed this. Reload to see the latest.`                                                    | `packages/service/src/review-commands.ts:190`                                      |
| `The whole-item target list must include every changed variant.`                                                                             | `The variant list changed. Reload the page.`                                                              | `packages/service/src/review-commands.ts:202`                                      |
| `Promoted history is read-only. Capture a correction in a new complete main run.`                                                            | `This run is already the baseline.`                                                                       | `packages/service/src/review-commands.ts:207`, `:363`                              |
| `Only the active complete comparison can be reviewed.`                                                                                       | `This run is not open for review.`                                                                        | `packages/service/src/review-commands.ts:211`                                      |
| `Only your saved command in this review session can be undone.`                                                                              | `You can undo only your own last decision.`                                                               | `packages/service/src/review-commands.ts:346`                                      |
| `The baseline changed after this command.`                                                                                                   | `The baseline changed. Undo is not available.`                                                            | `packages/service/src/review-commands.ts:354`                                      |
| `The command no longer targets the active comparison.`                                                                                       | `This run changed. Undo is not available.`                                                                | `packages/service/src/review-commands.ts:366`                                      |
| `The saved command does not contain its prior verdict.`                                                                                      | `Undo is not available for this decision.`                                                                | `packages/service/src/review-commands.ts:387`                                      |

## Removal candidates

These strings have no proposed replacement. The first group is visible today. The second group cannot be shown by the production code path (COPY-18). The maintainer decides.

Visible today:

| String                                                                                                                                           | File:line                                                             | Reason                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Recompare stored run`                                                                                                                           | `review-workspace.tsx:1195`                                           | The feature is retired (COPY-01)                                    |
| `{recompareDisabledReason}` footer paragraph and its three server sentences                                                                      | `review-workspace.tsx:1199-1201`, `api/review.ts:102`, `:595`, `:597` | It explains a retired control                                       |
| `Visual regression review`                                                                                                                       | `index.tsx:287`                                                       | Marketing eyebrow on a sign-in page                                 |
| `Every change. A clear decision.`                                                                                                                | `index.tsx:293`                                                       | Marketing line                                                      |
| `Compare screenshots and approve expected changes in your repository.`                                                                           | `index.tsx:297`                                                       | It explains the product to a maintainer                             |
| `{repository}` page eyebrow                                                                                                                      | `index.tsx:430`, `:628`                                               | The header shows it                                                 |
| `{n} runs are ready for review.`                                                                                                                 | `index.tsx:437`                                                       | The section heading shows the count                                 |
| `Captures in progress and runs that need attention appear here.`                                                                                 | `index.tsx:439`                                                       | The sections below say it                                           |
| `No runs need a decision or recovery.`                                                                                                           | `index.tsx:440`                                                       | The empty state says it                                             |
| `New visual changes will appear here.`                                                                                                           | `index.tsx:537`                                                       | Filler                                                              |
| `Baseline revision {n}` and `No baseline yet`                                                                                                    | `index.tsx:547`                                                       | Internal counter. The empty state covers the second case            |
| `View history`                                                                                                                                   | `index.tsx:550`                                                       | The nav has the link                                                |
| `The first capture run will appear here.`                                                                                                        | `index.tsx:743`                                                       | Filler                                                              |
| `Search and filters apply to the loaded runs.`                                                                                                   | `index.tsx:748`                                                       | Third statement of the limit                                        |
| `Visual review · Pull request #{n}`                                                                                                              | `pulls.$pullNumber.tsx:177`                                           | The heading below repeats it                                        |
| `Manage your GitHub session.`                                                                                                                    | `user-menu.tsx:62`                                                    | It describes one visible button                                     |
| `Operations`                                                                                                                                     | `operations-attention/index.tsx:315`                                  | Second name for the page                                            |
| `Unresolved alerts and what they mean for your reviews. This page checks for updates every minute.`                                              | `operations-attention/index.tsx:331`                                  | It explains the page                                                |
| `Alerts refresh every minute while this dashboard is open. No external notifications are sent.`                                                  | `operations-attention/index.tsx:336`                                  | It explains the popover                                             |
| `No current alert data.`                                                                                                                         | `operations-attention/index.tsx:346`                                  | The alert sentence below says it                                    |
| `This view reports operation alerts. It does not test every service dependency.`                                                                 | `operations-attention/index.tsx:442`                                  | Disclaimer                                                          |
| `No external notifications are sent.`                                                                                                            | `operations-attention/index.tsx:465`                                  | Mechanics                                                           |
| Meta strip `Attempt {n}` / `Baseline revision {n}` / `{run status}`                                                                              | `review-workspace.tsx:609-622`                                        | It repeats the header and the badge. The values can move to details |
| `Pixel diff requires both a reference and a new image.` (inline)                                                                                 | `review-workspace.tsx:928`                                            | Shown before the reviewer asks for a diff                           |
| `Shortcuts work across this page. Text fields, tabs, menus, and dialogs keep their own keys. Use the visible pan buttons to move zoomed images.` | `review-workspace.tsx:162`                                            | 24 words above the key list                                         |
| `Move to controls or close this help.`                                                                                                           | `review-workspace.tsx:181`                                            | Standard keys                                                       |
| `Comparison {n}` in the details identity line                                                                                                    | `review-workspace.tsx:471`                                            | It is the run revision (COPY-07)                                    |
| `{run status}` second line in the details panel                                                                                                  | `review-workspace.tsx:467`                                            | It repeats the status                                               |

Not reachable in production:

| String                                                                                                                                       | File:line                   | Reason                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `Recompare now`                                                                                                                              | `review-workspace.tsx:987`  | `recompareAllowed` is always false                                 |
| `A new comparison is being prepared from stored captures. The previous comparison remains visible until the new evidence is ready.`          | `review-workspace.tsx:707`  | Set only by the retired recompare flow                             |
| `Creating a new comparison from stored captures…`                                                                                            | `use-review-session.ts:515` | Same                                                               |
| `The new comparison failed.`                                                                                                                 | `use-review-session.ts:538` | Same                                                               |
| `New comparison requested. Results will open when comparison completes.`                                                                     | `use-review-session.ts:539` | Same                                                               |
| `This closed run is read-only. Its review history remains available.`                                                                        | `review-workspace.tsx:697`  | The server always sends a reason                                   |
| `This closed review is read-only. Capture a new complete run.` (client fallback)                                                             | `review-workspace.tsx:331`  | The server always sends a reason                                   |
| `This acceptance is already saved.`                                                                                                          | `use-review-session.ts:349` | No code sets `noop`                                                |
| `@{login}`                                                                                                                                   | `user-menu.tsx:24`          | No caller passes `login`. The other option is to pass it (COPY-15) |
| `Closed history is read-only. Capture a new complete run.`                                                                                   | `api/review.ts:957`, `:984` | The UI cannot call recompare                                       |
| `Run trusted Submit again from the complete CI bundle, or capture a new run. Stored representatives cannot replace omitted candidate bytes.` | `api/review.ts:972`         | Same                                                               |
| `Choose approved or rejected.`                                                                                                               | `api/review.ts:845`         | The UI sends only these two values                                 |

## String inventory

508 strings and 2,744 words. `{…}` marks a dynamic part and counts as one word. A string that the code builds from parts is listed once, in its rendered form. Paths are relative to the repository root.

### App header and account menu

| String                                                          | File:line                                  | Where it shows                                                       | Words |
| --------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ----- |
| Visonaut                                                        | `apps/web/src/routes/__root.tsx:10`        | Browser tab title on every page (never changes with the page or run) | 1     |
| Visonaut review queue                                           | `apps/web/src/components/app-shell.tsx:29` | Logo link, aria-label                                                | 3     |
| visonaut.                                                       | `apps/web/src/components/app-shell.tsx:34` | Logo wordmark (1024px and wider)                                     | 1     |
| {repository}                                                    | `apps/web/src/components/app-shell.tsx:39` | Header, beside the logo (1280px and wider)                           | 1     |
| Main navigation                                                 | `apps/web/src/components/app-shell.tsx:47` | Header nav, aria-label                                               | 2     |
| Review queue                                                    | `apps/web/src/components/app-shell.tsx:16` | Header nav link (label and aria-label)                               | 2     |
| Run history                                                     | `apps/web/src/components/app-shell.tsx:17` | Header nav link (label and aria-label)                               | 2     |
| Service status                                                  | `apps/web/src/components/app-shell.tsx:18` | Header nav link (label and aria-label)                               | 2     |
| Account                                                         | `apps/web/src/components/user-menu.tsx:24` | Account button label and popover heading                             | 1     |
| Preview account                                                 | `apps/web/src/components/user-menu.tsx:24` | Account button label and popover heading (preview)                   | 2     |
| @{login}                                                        | `apps/web/src/components/user-menu.tsx:24` | Account button label. No caller passes `login`, so it never renders  | 1     |
| Account menu                                                    | `apps/web/src/components/user-menu.tsx:40` | Account button, aria-label                                           | 2     |
| Preview account menu                                            | `apps/web/src/components/user-menu.tsx:40` | Account button, aria-label (preview)                                 | 3     |
| Manage your GitHub session.                                     | `apps/web/src/components/user-menu.tsx:62` | Account popover description                                          | 4     |
| This preview uses sample data. Account actions are unavailable. | `apps/web/src/components/user-menu.tsx:61` | Account popover description (preview)                                | 9     |
| Sign out                                                        | `apps/web/src/components/user-menu.tsx:75` | Account popover button                                               | 2     |
| Signing out…                                                    | `apps/web/src/components/user-menu.tsx:75` | Account popover button while the request runs                        | 2     |

### Dashboard: loading, sign-in, and errors

| String                                                                       | File:line                           | Where it shows                                             | Words |
| ---------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- | ----- |
| Checking access and loading runs…                                            | `apps/web/src/routes/index.tsx:277` | Whole page while `/api/runs` loads                         | 5     |
| Visual regression review                                                     | `apps/web/src/routes/index.tsx:287` | Signed-out page, eyebrow                                   | 3     |
| Every change. A clear decision.                                              | `apps/web/src/routes/index.tsx:293` | Signed-out page, h1                                        | 5     |
| Compare screenshots and approve expected changes in your repository.         | `apps/web/src/routes/index.tsx:297` | Signed-out page, paragraph                                 | 9     |
| Review visual changes.                                                       | `apps/web/src/routes/index.tsx:305` | Signed-out page, card h2                                   | 3     |
| Use a GitHub account with write access to this repository.                   | `apps/web/src/routes/index.tsx:308` | Signed-out page, card paragraph                            | 10    |
| Sign in with GitHub                                                          | `apps/web/src/routes/index.tsx:312` | Signed-out page, primary button                            | 4     |
| Opening GitHub…                                                              | `apps/web/src/routes/index.tsx:312` | Signed-out page, button while sign-in starts               | 2     |
| Sign-in could not start. Please try again.                                   | `apps/web/src/routes/index.tsx:220` | Alert above the page content                               | 7     |
| Sign-out failed. Please try again.                                           | `apps/web/src/routes/index.tsx:233` | Alert in the account popover                               | 5     |
| Repository access required                                                   | `apps/web/src/routes/index.tsx:334` | Error card h1 (403)                                        | 3     |
| Your repository access changed. Write access to this repository is required. | `apps/web/src/routes/index.tsx:192` | Error card paragraph (403; also at IDX:171)                | 11    |
| The review queue could not be loaded                                         | `apps/web/src/routes/index.tsx:335` | Error card h1. Also shown on the history and service views | 7     |
| The run list is temporarily unavailable. Please retry.                       | `apps/web/src/routes/index.tsx:196` | Error card paragraph (non-2xx response)                    | 8     |
| The service is temporarily unavailable.                                      | `apps/web/src/routes/index.tsx:204` | Error card paragraph (non-Error throw)                     | 5     |
| The run list could not be read. Retry loading the page.                      | `apps/web/src/routes/index.tsx:77`  | Error card paragraph (malformed response)                  | 11    |
| The service returned an invalid run. Retry loading the page.                 | `apps/web/src/routes/index.tsx:89`  | Error card paragraph (malformed run)                       | 10    |
| The baseline state could not be read.                                        | `apps/web/src/routes/index.tsx:111` | Error card paragraph (malformed project)                   | 7     |
| Retry                                                                        | `apps/web/src/routes/index.tsx:342` | Error card button                                          | 1     |
| Use another account                                                          | `apps/web/src/routes/index.tsx:350` | Error card button (403)                                    | 3     |
| Preview fixtures · GitHub login is disabled                                  | `apps/web/src/routes/index.tsx:360` | Line above the page heading (preview)                      | 6     |

### Dashboard: review queue

| String                                                         | File:line                           | Where it shows                                          | Words |
| -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- | ----- |
| {repository}                                                   | `apps/web/src/routes/index.tsx:430` | Eyebrow above the h1 (repeats the header)               | 1     |
| Your review queue.                                             | `apps/web/src/routes/index.tsx:433` | h1                                                      | 3     |
| {n} run is ready for review. / {n} runs are ready for review.  | `apps/web/src/routes/index.tsx:437` | Subtitle                                                | 12    |
| Captures in progress and runs that need attention appear here. | `apps/web/src/routes/index.tsx:439` | Subtitle when no run is ready                           | 10    |
| No runs need a decision or recovery.                           | `apps/web/src/routes/index.tsx:440` | Subtitle when the queue is empty                        | 7     |
| Refresh runs                                                   | `apps/web/src/routes/index.tsx:447` | Button beside the h1                                    | 2     |
| Runs to review                                                 | `apps/web/src/routes/index.tsx:452` | Stat label                                              | 3     |
| Awaiting approval                                              | `apps/web/src/routes/index.tsx:453` | Stat label                                              | 2     |
| Rejected views                                                 | `apps/web/src/routes/index.tsx:454` | Stat label                                              | 2     |
| Ready to review                                                | `apps/web/src/routes/index.tsx:471` | Section heading (uppercase by CSS)                      | 3     |
| #{pullRequestNumber}                                           | `apps/web/src/routes/index.tsx:490` | Run card, top line                                      | 1     |
| Main                                                           | `apps/web/src/routes/index.tsx:124` | Run card top line and title fallback; history row title | 1     |
| Pull request                                                   | `apps/web/src/routes/index.tsx:125` | Run card top line and title fallback; history row title | 2     |
| Merge queue                                                    | `apps/web/src/routes/index.tsx:126` | Run card top line and title fallback; history row title | 2     |
| New capture needed                                             | `apps/web/src/routes/index.tsx:131` | Run status badge (needs-recompare)                      | 3     |
| Needs review                                                   | `apps/web/src/routes/index.tsx:132` | Run status badge (needs-review, reviewing)              | 2     |
| Waiting for screenshots                                        | `apps/web/src/routes/index.tsx:133` | Run status badge (incomplete)                           | 3     |
| Comparing images                                               | `apps/web/src/routes/index.tsx:134` | Run status badge (comparing)                            | 2     |
| Passed                                                         | `apps/web/src/routes/index.tsx:135` | Run status badge (passed)                               | 1     |
| Changes rejected                                               | `apps/web/src/routes/index.tsx:136` | Run status badge (rejected)                             | 2     |
| Run failed                                                     | `apps/web/src/routes/index.tsx:137` | Run status badge (failed)                               | 2     |
| Replaced by a newer run                                        | `apps/web/src/routes/index.tsx:138` | Run status badge (superseded)                           | 5     |
| {state with dashes replaced by spaces}                         | `apps/web/src/routes/index.tsx:139` | Run status badge for an unknown state                   | 1     |
| {n} view await approval. / {n} views await approval.           | `apps/web/src/routes/index.tsx:502` | Run card paragraph                                      | 8     |
| , including {n} rejected.                                      | `apps/web/src/routes/index.tsx:503` | Run card paragraph suffix                               | 3     |
| {12-character commit}                                          | `apps/web/src/routes/index.tsx:402` | Run card meta line; `title` holds the full commit       | 1     |
| Attempt {n}                                                    | `apps/web/src/routes/index.tsx:404` | Run card meta line                                      | 2     |
| {date}                                                         | `apps/web/src/routes/index.tsx:405` | Run card meta line, for example `Oct 5, 2026, 11:10 AM` | 1     |
| Date unavailable                                               | `apps/web/src/routes/index.tsx:155` | Run card meta line for an invalid date                  | 2     |
| Review changes                                                 | `apps/web/src/routes/index.tsx:512` | Run card primary button                                 | 2     |
| All reviews are complete.                                      | `apps/web/src/routes/index.tsx:533` | Empty state h2 (a baseline exists)                      | 4     |
| New visual changes will appear here.                           | `apps/web/src/routes/index.tsx:537` | Empty state paragraph                                   | 6     |
| No captures yet.                                               | `apps/web/src/routes/index.tsx:533` | Empty state h2 (no baseline)                            | 3     |
| Run the visual test workflow to create your first baseline.    | `apps/web/src/routes/index.tsx:538` | Empty state paragraph                                   | 10    |
| In progress                                                    | `apps/web/src/routes/index.tsx:542` | Section heading and section aria-label                  | 2     |
| Needs attention                                                | `apps/web/src/routes/index.tsx:543` | Section heading and section aria-label                  | 2     |
| #{pullRequestNumber} · {title}                                 | `apps/web/src/routes/index.tsx:585` | Compact run row title                                   | 2     |
| {status} · Attempt {n}                                         | `apps/web/src/routes/index.tsx:589` | Compact run row second line                             | 3     |
| Open run                                                       | `apps/web/src/routes/index.tsx:593` | Compact run row button                                  | 2     |
| Baseline revision {n}                                          | `apps/web/src/routes/index.tsx:547` | Page footer line                                        | 3     |
| No baseline yet                                                | `apps/web/src/routes/index.tsx:547` | Page footer line                                        | 3     |
| View history                                                   | `apps/web/src/routes/index.tsx:550` | Page footer link (repeats the header nav)               | 2     |

### Dashboard: run history

| String                                                                                      | File:line                           | Where it shows                      | Words |
| ------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------- | ----- |
| Run history.                                                                                | `apps/web/src/routes/index.tsx:631` | h1                                  | 2     |
| Results for the latest 100 runs. Older work that needs attention stays in the review queue. | `apps/web/src/routes/index.tsx:634` | Subtitle                            | 16    |
| Refresh runs                                                                                | `apps/web/src/routes/index.tsx:642` | Button beside the h1                | 2     |
| Search loaded history                                                                       | `apps/web/src/routes/index.tsx:657` | Search input, aria-label            | 3     |
| Search loaded history…                                                                      | `apps/web/src/routes/index.tsx:658` | Search input, placeholder           | 3     |
| Result                                                                                      | `apps/web/src/routes/index.tsx:673` | Filter label                        | 1     |
| Filter history by result                                                                    | `apps/web/src/routes/index.tsx:675` | Filter select, aria-label           | 4     |
| All results                                                                                 | `apps/web/src/routes/index.tsx:680` | Filter option                       | 2     |
| Latest 100 runs                                                                             | `apps/web/src/routes/index.tsx:691` | Table caption (screen readers only) | 3     |
| Run                                                                                         | `apps/web/src/routes/index.tsx:698` | Table column header                 | 1     |
| Result                                                                                      | `apps/web/src/routes/index.tsx:699` | Table column header                 | 1     |
| Created                                                                                     | `apps/web/src/routes/index.tsx:700` | Table column header                 | 1     |
| {12-character commit} · Attempt {n}                                                         | `apps/web/src/routes/index.tsx:717` | Table row second line               | 3     |
| No matching runs                                                                            | `apps/web/src/routes/index.tsx:738` | Empty state h2                      | 3     |
| Change the search or result filter.                                                         | `apps/web/src/routes/index.tsx:742` | Empty state paragraph               | 6     |
| No runs yet                                                                                 | `apps/web/src/routes/index.tsx:738` | Empty state h2                      | 3     |
| The first capture run will appear here.                                                     | `apps/web/src/routes/index.tsx:743` | Empty state paragraph               | 7     |
| Search and filters apply to the loaded runs.                                                | `apps/web/src/routes/index.tsx:748` | Note below the table                | 8     |

### Pull request page

| String                                                                                                       | File:line                                       | Where it shows                                           | Words |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------- | ----- |
| Review queue                                                                                                 | `apps/web/src/routes/pulls.$pullNumber.tsx:159` | Back link above the card                                 | 2     |
| Visual review · Pull request #{n}                                                                            | `apps/web/src/routes/pulls.$pullNumber.tsx:177` | Card eyebrow (uppercase by CSS)                          | 5     |
| Finding this pull request’s visual review…                                                                   | `apps/web/src/routes/pulls.$pullNumber.tsx:181` | Card, loading status                                     | 6     |
| Sign in to review pull request #{n}                                                                          | `apps/web/src/routes/pulls.$pullNumber.tsx:187` | Card h1 (401)                                            | 7     |
| Compare screenshots and approve expected changes. Use a GitHub account with write access to this repository. | `apps/web/src/routes/pulls.$pullNumber.tsx:190` | Card paragraph (401)                                     | 16    |
| Sign in with GitHub                                                                                          | `apps/web/src/routes/pulls.$pullNumber.tsx:199` | Card primary button                                      | 4     |
| Opening GitHub…                                                                                              | `apps/web/src/routes/pulls.$pullNumber.tsx:199` | Card primary button while sign-in starts                 | 2     |
| Repository access required                                                                                   | `apps/web/src/routes/pulls.$pullNumber.tsx:210` | Card h1 (403)                                            | 3     |
| Write access to this repository is required to open its review.                                              | `apps/web/src/routes/pulls.$pullNumber.tsx:66`  | Card paragraph (403)                                     | 11    |
| Use another account                                                                                          | `apps/web/src/routes/pulls.$pullNumber.tsx:231` | Card button (403)                                        | 3     |
| Signing out…                                                                                                 | `apps/web/src/routes/pulls.$pullNumber.tsx:231` | Card button while sign-out runs                          | 2     |
| Review unavailable                                                                                           | `apps/web/src/routes/pulls.$pullNumber.tsx:211` | Card h1 (other errors)                                   | 2     |
| This Visonaut check was not found. Open the latest check on GitHub.                                          | `apps/web/src/routes/pulls.$pullNumber.tsx:71`  | Card paragraph (404)                                     | 12    |
| The pull request could not be loaded. Please retry.                                                          | `apps/web/src/routes/pulls.$pullNumber.tsx:73`  | Card paragraph (non-2xx response)                        | 9     |
| Invalid response.                                                                                            | `apps/web/src/routes/pulls.$pullNumber.tsx:75`  | Card paragraph (malformed response; also PUL:78, 86, 88) | 2     |
| The service is unavailable.                                                                                  | `apps/web/src/routes/pulls.$pullNumber.tsx:97`  | Card paragraph (non-Error throw)                         | 4     |
| Sign-in could not start. Please retry.                                                                       | `apps/web/src/routes/pulls.$pullNumber.tsx:130` | Card paragraph after a failed sign-in                    | 6     |
| Sign-out failed. Please try again.                                                                           | `apps/web/src/routes/pulls.$pullNumber.tsx:144` | Card paragraph after a failed sign-out                   | 5     |
| Retry                                                                                                        | `apps/web/src/routes/pulls.$pullNumber.tsx:222` | Card button (errors)                                     | 1     |
| Pull request #{n}                                                                                            | `apps/web/src/routes/pulls.$pullNumber.tsx:239` | Card h1 (no run yet)                                     | 3     |
| Waiting for screenshots.                                                                                     | `apps/web/src/routes/pulls.$pullNumber.tsx:261` | Status box title (pending)                               | 3     |
| The visual capture has not reached Visonaut yet. This page updates automatically when the review is ready.   | `apps/web/src/routes/pulls.$pullNumber.tsx:268` | Status box paragraph (pending)                           | 17    |
| Visual capture failed.                                                                                       | `apps/web/src/routes/pulls.$pullNumber.tsx:260` | Status box title (failed)                                | 3     |
| No review is ready. Open the pull request on GitHub to inspect the failing check.                            | `apps/web/src/routes/pulls.$pullNumber.tsx:267` | Status box paragraph (failed)                            | 15    |
| No visual review needed.                                                                                     | `apps/web/src/routes/pulls.$pullNumber.tsx:258` | Status box title (not required)                          | 4     |
| This pull request does not require a visual capture.                                                         | `apps/web/src/routes/pulls.$pullNumber.tsx:265` | Status box paragraph (not required)                      | 9     |
| Check again                                                                                                  | `apps/web/src/routes/pulls.$pullNumber.tsx:275` | Button below the status box                              | 2     |
| Open on GitHub                                                                                               | `apps/web/src/routes/pulls.$pullNumber.tsx:284` | Link button below the status box                         | 3     |

### Run page: loading, sign-in, and errors

| String                                                        | File:line                                 | Where it shows                                   | Words |
| ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ | ----- |
| Checking access and loading this run…                         | `apps/web/src/routes/runs.$runId.tsx:70`  | Whole page while the run loads                   | 6     |
| This run could not be opened                                  | `apps/web/src/routes/runs.$runId.tsx:95`  | Error card h1                                    | 6     |
| Write access to this repository is required to open this run. | `apps/web/src/routes/runs.$runId.tsx:80`  | Error card paragraph (every 403)                 | 11    |
| The run could not be loaded. Please retry.                    | `apps/web/src/routes/runs.$runId.tsx:83`  | Error card paragraph (non-Error throw)           | 8     |
| {server error message}                                        | `apps/web/src/routes/runs.$runId.tsx:82`  | Error card paragraph (see the server rows below) | 1     |
| Retry                                                         | `apps/web/src/routes/runs.$runId.tsx:106` | Error card button                                | 1     |
| Sign in to review this run                                    | `apps/web/src/routes/runs.$runId.tsx:228` | Sign-in card h1 (401)                            | 6     |
| This review is available to Ariakit maintainers.              | `apps/web/src/routes/runs.$runId.tsx:230` | Sign-in card paragraph                           | 7     |
| Sign in with GitHub                                           | `apps/web/src/routes/runs.$runId.tsx:241` | Sign-in card button                              | 4     |
| Opening GitHub…                                               | `apps/web/src/routes/runs.$runId.tsx:241` | Sign-in card button while sign-in starts         | 2     |
| Sign-in could not start. Please try again.                    | `apps/web/src/routes/runs.$runId.tsx:179` | Sign-in card alert                               | 7     |
| Sign-out failed. Please try again.                            | `apps/web/src/routes/runs.$runId.tsx:192` | Account popover alert                            | 5     |

### Service status page and alerts popover

| String                                                                                                                                                                                             | File:line                                                    | Where it shows                                        | Words |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | ----- |
| Service attention: {n} alert(s)                                                                                                                                                                    | `apps/web/src/components/operations-attention/index.tsx:299` | Bell button, aria-label                               | 4     |
| Service attention: at least {n} alert(s)                                                                                                                                                           | `apps/web/src/components/operations-attention/index.tsx:299` | Bell button, aria-label (more than 50 alerts)         | 6     |
| Service attention: no alerts                                                                                                                                                                       | `apps/web/src/components/operations-attention/index.tsx:300` | Bell button, aria-label                               | 4     |
| Service attention: checking alerts                                                                                                                                                                 | `apps/web/src/components/operations-attention/index.tsx:297` | Bell button, aria-label while loading                 | 4     |
| Service attention: {n} cached alert(s); refresh failed                                                                                                                                             | `apps/web/src/components/operations-attention/index.tsx:294` | Bell button, aria-label after a failed refresh        | 7     |
| Service attention: alert status unavailable                                                                                                                                                        | `apps/web/src/components/operations-attention/index.tsx:295` | Bell button, aria-label after a failed first load     | 5     |
| {n} / {n}+                                                                                                                                                                                         | `apps/web/src/components/operations-attention/index.tsx:496` | Bell badge (hidden from screen readers)               | 2     |
| !                                                                                                                                                                                                  | `apps/web/src/components/operations-attention/index.tsx:504` | Bell error mark (hidden from screen readers)          | 0     |
| Service attention: {n} unresolved service alert(s).                                                                                                                                                | `apps/web/src/components/operations-attention/index.tsx:253` | Screen reader announcement after the first load       | 6     |
| Service attention: no unresolved service alerts.                                                                                                                                                   | `apps/web/src/components/operations-attention/index.tsx:254` | Screen reader announcement after the first load       | 6     |
| Service alert update {n}: {n} alert(s) now visible. {alert title}.                                                                                                                                 | `apps/web/src/components/operations-attention/index.tsx:259` | Screen reader announcement for new alerts             | 9     |
| Service attention: all alerts resolved.                                                                                                                                                            | `apps/web/src/components/operations-attention/index.tsx:262` | Screen reader announcement                            | 5     |
| Service attention: alerts refreshed.                                                                                                                                                               | `apps/web/src/components/operations-attention/index.tsx:264` | Screen reader announcement after a recovered refresh  | 4     |
| Service attention: alert refresh failed. Cached alerts may be out of date.                                                                                                                         | `apps/web/src/components/operations-attention/index.tsx:274` | Screen reader announcement                            | 12    |
| Operations                                                                                                                                                                                         | `apps/web/src/components/operations-attention/index.tsx:315` | Page eyebrow (uppercase by CSS)                       | 1     |
| Service status.                                                                                                                                                                                    | `apps/web/src/components/operations-attention/index.tsx:321` | Page h1                                               | 2     |
| Service attention                                                                                                                                                                                  | `apps/web/src/components/operations-attention/index.tsx:325` | Popover heading                                       | 2     |
| Unresolved alerts and what they mean for your reviews. This page checks for updates every minute.                                                                                                  | `apps/web/src/components/operations-attention/index.tsx:331` | Page intro                                            | 16    |
| Alerts refresh every minute while this dashboard is open. No external notifications are sent.                                                                                                      | `apps/web/src/components/operations-attention/index.tsx:336` | Popover description                                   | 14    |
| {n} unresolved operation alert(s). Last checked {date}.                                                                                                                                            | `apps/web/src/components/operations-attention/index.tsx:343` | Status line                                           | 7     |
| At least {n} unresolved operation alerts. Last checked {date}.                                                                                                                                     | `apps/web/src/components/operations-attention/index.tsx:343` | Status line (more than 50 alerts)                     | 9     |
| No unresolved operation alerts. Last checked {date}.                                                                                                                                               | `apps/web/src/components/operations-attention/index.tsx:343` | Status line                                           | 7     |
| Checking for unresolved operation alerts…                                                                                                                                                          | `apps/web/src/components/operations-attention/index.tsx:345` | Status line while loading                             | 5     |
| No current alert data.                                                                                                                                                                             | `apps/web/src/components/operations-attention/index.tsx:346` | Status line after a failed first load                 | 4     |
| Refresh alerts                                                                                                                                                                                     | `apps/web/src/components/operations-attention/index.tsx:360` | Button beside the status line                         | 2     |
| Checking alerts…                                                                                                                                                                                   | `apps/web/src/components/operations-attention/index.tsx:360` | Button while loading                                  | 2     |
| Retry alerts                                                                                                                                                                                       | `apps/web/src/components/operations-attention/index.tsx:360` | Button after an error                                 | 2     |
| Operation alerts are temporarily unavailable.                                                                                                                                                      | `apps/web/src/components/operations-attention/index.tsx:243` | Alert paragraph (non-2xx response)                    | 5     |
| Operation alerts could not be loaded.                                                                                                                                                              | `apps/web/src/components/operations-attention/index.tsx:276` | Alert paragraph (non-Error throw)                     | 6     |
| Operation alerts could not be read. Retry loading them.                                                                                                                                            | `apps/web/src/components/operations-attention/index.tsx:45`  | Alert paragraph (malformed response)                  | 9     |
| An operation alert could not be read. Retry loading them.                                                                                                                                          | `apps/web/src/components/operations-attention/index.tsx:64`  | Alert paragraph (malformed alert)                     | 10    |
| Database capacity could not be read.                                                                                                                                                               | `apps/web/src/components/operations-attention/index.tsx:78`  | Alert paragraph (malformed capacity; also OPS:80, 83) | 6     |
| Shown alerts may be out of date.                                                                                                                                                                   | `apps/web/src/components/operations-attention/index.tsx:372` | Alert paragraph suffix (stale data kept)              | 7     |
| The current alert state is unknown.                                                                                                                                                                | `apps/web/src/components/operations-attention/index.tsx:372` | Alert paragraph suffix (no data)                      | 6     |
| Database: {n} MiB used; {n} MiB before new runs pause.                                                                                                                                             | `apps/web/src/components/operations-attention/index.tsx:384` | Capacity box, line 1                                  | 10    |
| Active captures: {n} of {n}. Capacity sampled {date}.                                                                                                                                              | `apps/web/src/components/operations-attention/index.tsx:388` | Capacity box, line 2                                  | 8     |
| GitHub webhook delivery needs attention                                                                                                                                                            | `apps/web/src/components/operations-attention/index.tsx:101` | Alert title (upstream-webhook)                        | 5     |
| Set the GitHub App webhook URL to the production /v1/webhooks receiver after preview sessions are retired. Verify the signed ping and authorization revocation delivery.                           | `apps/web/src/components/operations-attention/index.tsx:104` | Alert body (production-receiver-mismatch)             | 24    |
| Inspect this delivery ID in the GitHub App settings. Fix the receiver, request manual redelivery, then verify its receipt in Visonaut.                                                             | `apps/web/src/components/operations-attention/index.tsx:106` | Alert body (redelivery-exhausted)                     | 21    |
| Check GitHub App credentials and GitHub availability. The scheduler retries delivery recovery automatically.                                                                                       | `apps/web/src/components/operations-attention/index.tsx:107` | Alert body (other webhook codes)                      | 13    |
| Database capacity needs attention                                                                                                                                                                  | `apps/web/src/components/operations-attention/index.tsx:112` | Alert title (database-capacity)                       | 4     |
| New capture runs pause at the admission limit. Let existing runs finish, then review database size and retained history. Preserve identity and review history.                                     | `apps/web/src/components/operations-attention/index.tsx:114` | Alert body (database-capacity)                        | 24    |
| A backup needs attention                                                                                                                                                                           | `apps/web/src/components/operations-attention/index.tsx:119` | Alert title (backup)                                  | 4     |
| Check backup access and storage, then inspect the backup row state. An exporting or copying set may continue after the fault is fixed; a failed set is terminal and needs another recovery source. | `apps/web/src/components/operations-attention/index.tsx:121` | Alert body (backup)                                   | 33    |
| A GitHub check needs attention                                                                                                                                                                     | `apps/web/src/components/operations-attention/index.tsx:130` | Alert title (check-creation, check-delivery, checks)  | 5     |
| Follow the recovery guide to reconcile the check for this exact commit before retrying its delivery.                                                                                               | `apps/web/src/components/operations-attention/index.tsx:133` | Alert body (ambiguous check)                          | 16    |
| Check GitHub App access and service availability, then follow the recovery guide to resume the check.                                                                                              | `apps/web/src/components/operations-attention/index.tsx:134` | Alert body (other check codes)                        | 16    |
| A comparison could not enter the queue                                                                                                                                                             | `apps/web/src/components/operations-attention/index.tsx:139` | Alert title (comparison-publication)                  | 7     |
| Check queue access and service availability. The scheduler retries pending work automatically.                                                                                                     | `apps/web/src/components/operations-attention/index.tsx:141` | Alert body (comparison-publication)                   | 12    |
| A comparison exhausted its retries                                                                                                                                                                 | `apps/web/src/components/operations-attention/index.tsx:146` | Alert title (comparison-task)                         | 5     |
| Check the original images and comparison service. Correct the failure, then compare the retained run again.                                                                                        | `apps/web/src/components/operations-attention/index.tsx:148` | Alert body (comparison-task)                          | 16    |
| A comparison could not finish                                                                                                                                                                      | `apps/web/src/components/operations-attention/index.tsx:153` | Alert title (comparison-finalization)                 | 5     |
| Check the comparison results and database access, then resume the scheduled service operations.                                                                                                    | `apps/web/src/components/operations-attention/index.tsx:155` | Alert body (comparison-finalization)                  | 13    |
| A signed capture run needs attention                                                                                                                                                               | `apps/web/src/components/operations-attention/index.tsx:160` | Alert title (staged-reconciliation)                   | 6     |
| Check this GitHub workflow run and its staged images. The service retries each hour. If a restore removed staged bytes, run a fresh signed capture and upload of every shard.                      | `apps/web/src/components/operations-attention/index.tsx:162` | Alert body (staged-reconciliation)                    | 30    |
| A baseline update needs attention                                                                                                                                                                  | `apps/web/src/components/operations-attention/index.tsx:167` | Alert title (promotion)                               | 5     |
| Check the current run and required original images. Follow the recovery guide before retrying promotion.                                                                                           | `apps/web/src/components/operations-attention/index.tsx:169` | Alert body (promotion)                                | 15    |
| Storage cleanup needs attention                                                                                                                                                                    | `apps/web/src/components/operations-attention/index.tsx:182` | Alert title (five retention kinds)                    | 4     |
| Check storage access and the affected run's retention pins. Preserve required review and recovery images.                                                                                          | `apps/web/src/components/operations-attention/index.tsx:184` | Alert body (retention)                                | 15    |
| A restored deployment needs attention                                                                                                                                                              | `apps/web/src/components/operations-attention/index.tsx:189` | Alert title (restore)                                 | 5     |
| Complete the restore guide, including secret rotation and current access checks, before activation.                                                                                                | `apps/web/src/components/operations-attention/index.tsx:191` | Alert body (restore)                                  | 13    |
| A service operation needs attention                                                                                                                                                                | `apps/web/src/components/operations-attention/index.tsx:195` | Alert title (unknown kind)                            | 5     |
| Check the deployment configuration and service availability. Use the recovery guide to resume the affected operation.                                                                              | `apps/web/src/components/operations-attention/index.tsx:197` | Alert body (unknown kind)                             | 16    |
| Technical details                                                                                                                                                                                  | `apps/web/src/components/operations-attention/index.tsx:415` | Alert disclosure summary                              | 2     |
| {kind} · {code} · {subject}                                                                                                                                                                        | `apps/web/src/components/operations-attention/index.tsx:418` | Alert disclosure content, line 1 (raw identifiers)    | 3     |
| First seen {date} · Last seen {date}                                                                                                                                                               | `apps/web/src/components/operations-attention/index.tsx:420` | Alert disclosure content, line 2                      | 6     |
| No unresolved alerts.                                                                                                                                                                              | `apps/web/src/components/operations-attention/index.tsx:439` | Page empty state h2                                   | 3     |
| This view reports operation alerts. It does not test every service dependency.                                                                                                                     | `apps/web/src/components/operations-attention/index.tsx:442` | Page empty state paragraph                            | 12    |
| Showing the 50 most recently reported unresolved alerts.                                                                                                                                           | `apps/web/src/components/operations-attention/index.tsx:448` | Note below the list (more than 50 alerts)             | 8     |
| Open the operations and recovery guide                                                                                                                                                             | `apps/web/src/components/operations-attention/index.tsx:460` | Link button below the list                            | 6     |
| No external notifications are sent.                                                                                                                                                                | `apps/web/src/components/operations-attention/index.tsx:465` | Page footer note                                      | 5     |

### Review workspace: chrome, navigation, and item list

| String                                             | File:line                                       | Where it shows                                        | Words |
| -------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ----- |
| Review workspace                                   | `apps/web/src/review/review-workspace.tsx:532`  | Workspace root, aria-label                            | 2     |
| Review navigation                                  | `apps/web/src/review/review-workspace.tsx:545`  | Left sidebar, aria-label                              | 2     |
| Screenshots                                        | `apps/web/src/review/review-workspace.tsx:549`  | Left sidebar header (uppercase by CSS)                | 1     |
| {n} item / {n} items                               | `apps/web/src/review/review-workspace.tsx:552`  | Left sidebar header, right side                       | 4     |
| Search and filter screenshots                      | `apps/web/src/review/screenshot-filter.tsx:64`  | Filter control group, aria-label                      | 4     |
| Active review status                               | `apps/web/src/review/screenshot-filter.tsx:77`  | Filter tag list, aria-label                           | 3     |
| Review status: {label}                             | `apps/web/src/review/screenshot-filter.tsx:81`  | Filter tag, aria-label                                | 3     |
| All                                                | `apps/web/src/review/screenshot-filter.tsx:18`  | Filter tag and option                                 | 1     |
| Needs review                                       | `apps/web/src/review/screenshot-filter.tsx:19`  | Filter tag and option                                 | 2     |
| Approved                                           | `apps/web/src/review/screenshot-filter.tsx:20`  | Filter tag and option                                 | 1     |
| Rejected                                           | `apps/web/src/review/screenshot-filter.tsx:21`  | Filter tag and option                                 | 1     |
| Search screenshots                                 | `apps/web/src/review/screenshot-filter.tsx:107` | Filter input, aria-label                              | 2     |
| Search…                                            | `apps/web/src/review/screenshot-filter.tsx:108` | Filter input, placeholder                             | 1     |
| Clear search                                       | `apps/web/src/review/screenshot-filter.tsx:117` | Filter clear button, aria-label                       | 2     |
| Review status                                      | `apps/web/src/review/screenshot-filter.tsx:134` | Filter popover, aria-label                            | 2     |
| Review status                                      | `apps/web/src/review/screenshot-filter.tsx:147` | Filter popover heading (uppercase by CSS)             | 2     |
| Review items                                       | `apps/web/src/review/item-list.tsx:300`         | Item list nav, aria-label                             | 2     |
| {n} of {n} need review                             | `apps/web/src/review/item-list.tsx:256`         | Item row second line                                  | 5     |
| {n} rejected variant(s)                            | `apps/web/src/review/item-list.tsx:255`         | Item row second line                                  | 3     |
| {n} comparison(s) running                          | `apps/web/src/review/item-list.tsx:253`         | Item row second line                                  | 3     |
| {n} comparison error(s)                            | `apps/web/src/review/item-list.tsx:251`         | Item row second line                                  | 3     |
| Removed                                            | `apps/web/src/review/item-list.tsx:263`         | Item row badge (every variant removed)                | 1     |
| Item {n} of {n}                                    | `apps/web/src/review/item-list.tsx:267`         | Item row description (screen readers only)            | 4     |
| —                                                  | `apps/web/src/review/item-list.tsx:241`         | Item row thumbnail placeholder                        | 0     |
| No screenshots match. Change the search or filter. | `apps/web/src/review/item-list.tsx:358`         | Item list empty state                                 | 8     |
| No screenshots in this comparison.                 | `apps/web/src/review/item-list.tsx:359`         | Item list empty state                                 | 5     |
| Accepted ({n})                                     | `apps/web/src/review/item-list.tsx:378`         | Collapsed group toggle at the bottom of the list      | 2     |
| Collapse screenshots / Expand screenshots          | `apps/web/src/review/review-workspace.tsx:571`  | Sidebar toggle, aria-label                            | 4     |
| Toggle screenshots ([)                             | `apps/web/src/review/review-workspace.tsx:575`  | Sidebar toggle, title tooltip                         | 2     |
| Queue                                              | `apps/web/src/review/review-workspace.tsx:584`  | Back link in the run bar                              | 1     |
| {run title}                                        | `apps/web/src/review/review-workspace.tsx:587`  | Run bar, for example `#7731 · Fix Combobox popover…`  | 1     |
| Main visual review                                 | `apps/web/src/review/review-workspace.tsx:589`  | Run bar title fallback (main)                         | 3     |
| Merge queue visual review                          | `apps/web/src/review/review-workspace.tsx:591`  | Run bar title fallback (merge queue)                  | 4     |
| Pull request visual review                         | `apps/web/src/review/review-workspace.tsx:592`  | Run bar title fallback (pull request; also AR:561)    | 4     |
| {n} of {n} need review                             | `apps/web/src/review/review-workspace.tsx:597`  | Run bar, right side                                   | 5     |
| Review progress                                    | `apps/web/src/review/review-workspace.tsx:600`  | Progress bar, aria-label                              | 2     |
| {7-character commit}                               | `apps/web/src/review/review-workspace.tsx:613`  | Meta strip below the run bar                          | 1     |
| Attempt {n}                                        | `apps/web/src/review/review-workspace.tsx:615`  | Meta strip                                            | 2     |
| Baseline revision {n}                              | `apps/web/src/review/review-workspace.tsx:618`  | Meta strip                                            | 3     |
| Comparison complete                                | `apps/web/src/review/use-review-session.ts:60`  | Meta strip, right side (compared)                     | 2     |
| Changes need review                                | `apps/web/src/review/use-review-session.ts:62`  | Meta strip, right side (needs-review)                 | 3     |
| Check passed                                       | `apps/web/src/review/use-review-session.ts:64`  | Meta strip, right side (passed)                       | 2     |
| Rejected changes                                   | `apps/web/src/review/use-review-session.ts:66`  | Meta strip, right side (rejected)                     | 2     |
| Waiting for the complete capture                   | `apps/web/src/review/use-review-session.ts:68`  | Meta strip, right side (incomplete)                   | 5     |
| Comparing stored captures                          | `apps/web/src/review/use-review-session.ts:70`  | Meta strip, right side (comparing)                    | 3     |
| A new comparison is required                       | `apps/web/src/review/use-review-session.ts:72`  | Meta strip, right side (needs-recompare)              | 5     |
| A newer attempt is active                          | `apps/web/src/review/use-review-session.ts:74`  | Meta strip, right side (superseded)                   | 5     |
| Capture or comparison failed                       | `apps/web/src/review/use-review-session.ts:76`  | Meta strip, right side (failed)                       | 4     |
| Screenshots                                        | `apps/web/src/review/review-workspace.tsx:627`  | Button that opens the item list dialog (below 1024px) | 1     |
| Screenshots                                        | `apps/web/src/review/review-workspace.tsx:1214` | Item list dialog heading (below 1024px)               | 1     |
| Close screenshots                                  | `apps/web/src/review/review-workspace.tsx:1215` | Item list dialog close button, aria-label             | 2     |

### Review workspace: item header, variants, and viewer

| String                                                                                                                            | File:line                                           | Where it shows                                                                       | Words |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| {item name}                                                                                                                       | `apps/web/src/review/review-workspace.tsx:640`      | h1                                                                                   | 1     |
| Visual review                                                                                                                     | `apps/web/src/review/review-workspace.tsx:640`      | h1 fallback when the run has no item                                                 | 2     |
| Needs review                                                                                                                      | `apps/web/src/review/navigation.ts:174`             | Variant status badge; batch dialog rows; variant link names                          | 2     |
| Approved                                                                                                                          | `apps/web/src/review/navigation.ts:173`             | Variant status badge                                                                 | 1     |
| Accepted automatically                                                                                                            | `apps/web/src/review/navigation.ts:171`             | Variant status badge                                                                 | 2     |
| Rejected                                                                                                                          | `apps/web/src/review/navigation.ts:169`             | Variant status badge                                                                 | 1     |
| Unchanged                                                                                                                         | `apps/web/src/review/navigation.ts:168`             | Variant status badge                                                                 | 1     |
| Comparing                                                                                                                         | `apps/web/src/review/navigation.ts:167`             | Variant status badge                                                                 | 1     |
| Comparison error                                                                                                                  | `apps/web/src/review/navigation.ts:166`             | Variant status badge                                                                 | 2     |
| {n}% changed · {n} changed pixels                                                                                                 | `apps/web/src/review/review-workspace.tsx:646`      | Line below the h1                                                                    | 5     |
| — changed pixels                                                                                                                  | `apps/web/src/review/review-workspace.tsx:647`      | Line below the h1 when the count is unknown (additions, removals)                    | 2     |
| Previous screenshot                                                                                                               | `apps/web/src/review/review-workspace.tsx:654`      | Arrow button, aria-label                                                             | 2     |
| Previous screenshot (↑)                                                                                                           | `apps/web/src/review/review-workspace.tsx:655`      | Arrow button, title tooltip                                                          | 2     |
| Next screenshot                                                                                                                   | `apps/web/src/review/review-workspace.tsx:665`      | Arrow button, aria-label                                                             | 2     |
| Next screenshot (↓)                                                                                                               | `apps/web/src/review/review-workspace.tsx:666`      | Arrow button, title tooltip                                                          | 2     |
| Details                                                                                                                           | `apps/web/src/review/review-workspace.tsx:685`      | Button (label and aria-label, RW:677)                                                | 1     |
| {run.error}                                                                                                                       | `apps/web/src/review/review-workspace.tsx:691`      | Warning banner (server text, see AR:100)                                             | 1     |
| {readOnlyReason}                                                                                                                  | `apps/web/src/review/review-workspace.tsx:696`      | Warning banner for a read-only run (server text)                                     | 1     |
| This closed run is read-only. Its review history remains available.                                                               | `apps/web/src/review/review-workspace.tsx:697`      | Warning banner fallback. The server always sends a reason                            | 10    |
| Review is unavailable until the run is sealed and all comparisons are complete.                                                   | `apps/web/src/review/review-workspace.tsx:702`      | Warning banner while the run is not ready                                            | 13    |
| A new comparison is being prepared from stored captures. The previous comparison remains visible until the new evidence is ready. | `apps/web/src/review/review-workspace.tsx:707`      | Warning banner after Recompare. Unreachable (recompare is retired)                   | 20    |
| Variants                                                                                                                          | `apps/web/src/review/review-workspace.tsx:728`      | Variant nav, aria-label                                                              | 1     |
| {index}. {variant label}. {status}                                                                                                | `apps/web/src/review/review-workspace.tsx:776`      | Variant link, aria-label                                                             | 3     |
| {variant label} · {status}                                                                                                        | `apps/web/src/review/review-workspace.tsx:747`      | Variant link, title tooltip                                                          | 2     |
| React / Solid / Chromium / Firefox / Safari / WebKit / Light / Dark / System                                                      | `apps/web/src/review/variant-summary.tsx:53`        | Variant link, visible part labels                                                    | 9     |
| Forced colors: none                                                                                                               | `apps/web/src/review/variant-summary.tsx:47`        | Variant link icon, title tooltip                                                     | 3     |
| Color scheme: no preference                                                                                                       | `apps/web/src/review/variant-summary.tsx:48`        | Variant link icon, title tooltip                                                     | 4     |
| Contrast: no preference                                                                                                           | `apps/web/src/review/variant-summary.tsx:49`        | Variant link icon, title tooltip                                                     | 3     |
| {variant key}                                                                                                                     | `apps/web/src/review/variant-summary.tsx:121`       | Variant link, truncated text after the icons                                         | 1     |
| {1-6}                                                                                                                             | `apps/web/src/review/variant-summary.tsx:131`       | Variant link shortcut hint                                                           | 1     |
| Selected variant                                                                                                                  | `apps/web/src/review/review-workspace.tsx:796`      | Viewer section, aria-label                                                           | 2     |
| {rejectDisabledReason or approveDisabledReason}                                                                                   | `apps/web/src/review/review-workspace.tsx:802`      | Line above the viewer controls (active run, server text)                             | 1     |
| Image history expired                                                                                                             | `apps/web/src/review/review-workspace.tsx:808`      | Summary box h3                                                                       | 3     |
| Closed review summary                                                                                                             | `apps/web/src/review/review-workspace.tsx:808`      | Summary box h3                                                                       | 3     |
| Review results and capture identity remain available. This view does not contain image bytes.                                     | `apps/web/src/review/review-workspace.tsx:811`      | Summary box paragraph                                                                | 14    |
| Image view                                                                                                                        | `apps/web/src/review/review-workspace.tsx:832`      | View mode group, aria-label                                                          | 2     |
| Compare                                                                                                                           | `apps/web/src/review/review-workspace.tsx:845`      | View mode button (accessible name `Compare S`)                                       | 1     |
| Difference                                                                                                                        | `apps/web/src/review/review-workspace.tsx:860`      | View mode button (accessible name `Difference D`)                                    | 1     |
| Current                                                                                                                           | `apps/web/src/review/review-workspace.tsx:874`      | View mode button (accessible name `Current F`)                                       | 1     |
| Baseline                                                                                                                          | `apps/web/src/review/review-workspace.tsx:888`      | View mode button (accessible name `Baseline G`)                                      | 1     |
| S / D / F / G                                                                                                                     | `apps/web/src/review/review-workspace.tsx:846`      | View mode shortcut hints (part of each button name)                                  | 4     |
| Image zoom                                                                                                                        | `apps/web/src/review/review-workspace.tsx:899`      | Zoom group, aria-label                                                               | 2     |
| Fit / 100% / 200%                                                                                                                 | `apps/web/src/review/review-workspace.tsx:917`      | Zoom buttons                                                                         | 3     |
| Matched locally. The new image was not uploaded.                                                                                  | `apps/web/src/review/review-workspace.tsx:927`      | Line below the viewer controls                                                       | 8     |
| Pixel diff requires both a reference and a new image.                                                                             | `apps/web/src/review/review-workspace.tsx:928`      | Line below the viewer controls for every addition and removal                        | 10    |
| Comparison is still running…                                                                                                      | `apps/web/src/review/review-workspace.tsx:946`      | Viewer status                                                                        | 4     |
| Loading this comparison’s images…                                                                                                 | `apps/web/src/review/review-workspace.tsx:947`      | Viewer status                                                                        | 4     |
| Comparison superseded                                                                                                             | `apps/web/src/review/review-workspace.tsx:958`      | Viewer status title                                                                  | 2     |
| Comparison needs fresh Submit                                                                                                     | `apps/web/src/review/review-workspace.tsx:960`      | Viewer status title                                                                  | 4     |
| Comparison failed                                                                                                                 | `apps/web/src/review/review-workspace.tsx:961`      | Viewer status title                                                                  | 2     |
| Image evidence unavailable                                                                                                        | `apps/web/src/review/review-workspace.tsx:963`      | Viewer alert title                                                                   | 3     |
| Comparison evidence incomplete                                                                                                    | `apps/web/src/review/review-workspace.tsx:964`      | Viewer alert title                                                                   | 3     |
| A newer attempt replaced this comparison. Its evidence cannot be reviewed.                                                        | `apps/web/src/review/review-workspace.tsx:137`      | Viewer status body                                                                   | 11    |
| This comparison is out of date. Run the trusted workflow again to submit a fresh comparison.                                      | `apps/web/src/review/review-workspace.tsx:139`      | Viewer status body                                                                   | 16    |
| This capture or comparison failed. Its evidence cannot be reviewed.                                                               | `apps/web/src/review/review-workspace.tsx:141`      | Viewer status body                                                                   | 10    |
| This comparison was invalidated. Its evidence cannot be reviewed.                                                                 | `apps/web/src/review/review-workspace.tsx:143`      | Viewer status body                                                                   | 9     |
| Required reference evidence is unavailable in this comparison.                                                                    | `apps/web/src/review/use-evidence.ts:83`            | Viewer alert body                                                                    | 8     |
| Required candidate evidence is unavailable in this comparison.                                                                    | `apps/web/src/review/use-evidence.ts:92`            | Viewer alert body                                                                    | 8     |
| Required diff evidence is unavailable in this comparison.                                                                         | `apps/web/src/review/use-evidence.ts:99`            | Viewer alert body                                                                    | 8     |
| The image dimensions do not match this comparison.                                                                                | `apps/web/src/components/screenshot-viewer.tsx:58`  | Viewer alert body                                                                    | 8     |
| The image could not be decoded. Retry loading the evidence.                                                                       | `apps/web/src/components/screenshot-viewer.tsx:68`  | Viewer alert body                                                                    | 10    |
| The image could not be loaded. Check your connection and retry.                                                                   | `apps/web/src/components/screenshot-viewer.tsx:158` | Viewer alert body                                                                    | 11    |
| Retry images                                                                                                                      | `apps/web/src/review/review-workspace.tsx:976`      | Viewer alert button                                                                  | 2     |
| Recompare now                                                                                                                     | `apps/web/src/review/review-workspace.tsx:987`      | Viewer alert button. Unreachable (the server always sends `recompareAllowed: false`) | 2     |
| Baseline                                                                                                                          | `apps/web/src/components/screenshot-viewer.tsx:38`  | Image pane caption                                                                   | 1     |
| Current                                                                                                                           | `apps/web/src/components/screenshot-viewer.tsx:38`  | Image pane caption                                                                   | 1     |
| Difference                                                                                                                        | `apps/web/src/components/screenshot-viewer.tsx:38`  | Image pane caption                                                                   | 1     |
| {width} × {height}                                                                                                                | `apps/web/src/components/screenshot-viewer.tsx:104` | Image pane caption                                                                   | 2     |
| Reference                                                                                                                         | `apps/web/src/components/screenshot-viewer.tsx:218` | Image alt and pane accessible name (caption says Baseline)                           | 1     |
| New image                                                                                                                         | `apps/web/src/components/screenshot-viewer.tsx:229` | Image alt and pane accessible name (caption says Current)                            | 2     |
| Pixel diff · red pixels changed                                                                                                   | `apps/web/src/components/screenshot-viewer.tsx:245` | Image alt and pane accessible name (caption says Difference)                         | 5     |
| {label}. Use pan controls or scroll to inspect the image.                                                                         | `apps/web/src/components/screenshot-viewer.tsx:136` | Image scroll area, aria-label                                                        | 10    |
| Pan {label}                                                                                                                       | `apps/web/src/components/screenshot-viewer.tsx:109` | Pan button group, aria-label                                                         | 2     |
| Pan {label} {direction}                                                                                                           | `apps/web/src/components/screenshot-viewer.tsx:120` | Pan button, aria-label, for example `Pan Reference left`                             | 3     |
| Pan {caption} {direction}                                                                                                         | `apps/web/src/components/screenshot-viewer.tsx:121` | Pan button, title tooltip, for example `Pan baseline left`                           | 3     |
| New image, no reference                                                                                                           | `apps/web/src/components/screenshot-viewer.tsx:219` | Baseline pane when there is no reference image                                       | 4     |
| Removed, no new image                                                                                                             | `apps/web/src/components/screenshot-viewer.tsx:233` | Current pane when there is no new image                                              | 4     |
| New image not uploaded                                                                                                            | `apps/web/src/components/screenshot-viewer.tsx:232` | Current pane for a locally matched image                                             | 4     |
| Pixel diff is not available for review.                                                                                           | `apps/web/src/components/screenshot-viewer.tsx:248` | Difference pane                                                                      | 7     |
| No pixels changed.                                                                                                                | `apps/web/src/components/screenshot-viewer.tsx:250` | Difference pane                                                                      | 3     |
| Pixel changes are within the comparison tolerance.                                                                                | `apps/web/src/components/screenshot-viewer.tsx:252` | Difference pane                                                                      | 7     |
| Pixel diff unavailable                                                                                                            | `apps/web/src/components/screenshot-viewer.tsx:253` | Difference pane                                                                      | 3     |
| Loading image…                                                                                                                    | `apps/web/src/components/screenshot-viewer.tsx:178` | Image pane overlay                                                                   | 2     |
| Image could not be verified.                                                                                                      | `apps/web/src/components/screenshot-viewer.tsx:178` | Image pane overlay                                                                   | 5     |
| No comparison items                                                                                                               | `apps/web/src/review/review-workspace.tsx:1009`     | Empty run h2                                                                         | 3     |
| This run contains no review items.                                                                                                | `apps/web/src/review/review-workspace.tsx:1012`     | Empty run paragraph                                                                  | 6     |
| Images will appear after the complete run is processed.                                                                           | `apps/web/src/review/review-workspace.tsx:1013`     | Empty run paragraph                                                                  | 9     |

### Review workspace: actions, save state, and dialogs

| String                                                                                                                                         | File:line                                       | Where it shows                                                              | Words |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- | ----- |
| Review actions                                                                                                                                 | `apps/web/src/review/review-workspace.tsx:1027` | Action bar, aria-label                                                      | 2     |
| Undo                                                                                                                                           | `apps/web/src/review/review-workspace.tsx:1039` | Action bar button                                                           | 1     |
| All {n} changed views…                                                                                                                         | `apps/web/src/review/review-workspace.tsx:1055` | Action bar button that opens the batch dialog                               | 4     |
| Reject view                                                                                                                                    | `apps/web/src/review/review-workspace.tsx:1077` | Action bar button (accessible name `Reject view X`)                         | 2     |
| Approve & next                                                                                                                                 | `apps/web/src/review/review-workspace.tsx:1095` | Action bar primary button (accessible name `Approve & next A`)              | 2     |
| X / A                                                                                                                                          | `apps/web/src/review/review-workspace.tsx:1078` | Action bar shortcut hints (part of each button name)                        | 2     |
| {rejectDisabledReason} / {approveDisabledReason}                                                                                               | `apps/web/src/review/review-workspace.tsx:1071` | Action bar button title tooltips (server text)                              | 2     |
| Saving {n} decision(s)…                                                                                                                        | `apps/web/src/review/use-review-session.ts:310` | Save state line (also URS:363)                                              | 3     |
| Sending {n} decision(s)…                                                                                                                       | `apps/web/src/review/review-workspace.tsx:1113` | Save state line                                                             | 3     |
| {n} queued on server. You can close this window.                                                                                               | `apps/web/src/review/review-workspace.tsx:1113` | Save state line                                                             | 9     |
| {n} variant(s) approved. Saved. / {n} variant(s) rejected. Saved.                                                                              | `apps/web/src/review/use-review-session.ts:364` | Save state line                                                             | 8     |
| This acceptance is already saved.                                                                                                              | `apps/web/src/review/use-review-session.ts:349` | Save state line for a no-op result. No server code sets `noop`              | 5     |
| Later queued decisions were not saved. Review them again.                                                                                      | `apps/web/src/review/use-review-session.ts:349` | Save state suffix (also URS:392)                                            | 9     |
| Not saved. {message}                                                                                                                           | `apps/web/src/review/use-review-session.ts:274` | Save state alert                                                            | 3     |
| Conflict. {message}                                                                                                                            | `apps/web/src/review/use-review-session.ts:274` | Save state alert for every HTTP 409                                         | 2     |
| Updated by {reviewer}.                                                                                                                         | `apps/web/src/review/use-review-session.ts:271` | Save state alert suffix                                                     | 3     |
| The command could not be saved. Check your connection.                                                                                         | `apps/web/src/review/use-review-session.ts:264` | Save state alert body (non-Error throw)                                     | 9     |
| Reference: {id}.                                                                                                                               | `apps/web/src/review/client.ts:273`             | Save state alert suffix and run error suffix (also URS:386)                 | 2     |
| Could not confirm the queued decisions. The server will continue processing them. Retry to check their status.                                 | `apps/web/src/review/use-review-session.ts:386` | Save state alert                                                            | 17    |
| The decision has not been submitted.                                                                                                           | `apps/web/src/review/use-review-session.ts:329` | Save state alert body (internal guard)                                      | 6     |
| Saving Undo…                                                                                                                                   | `apps/web/src/review/use-review-session.ts:456` | Save state line                                                             | 2     |
| Undo saved. The original selection and verdicts were restored.                                                                                 | `apps/web/src/review/use-review-session.ts:468` | Save state line                                                             | 9     |
| Refreshing the current comparison…                                                                                                             | `apps/web/src/review/use-review-session.ts:490` | Save state line                                                             | 4     |
| Current state loaded. Check the evidence before saving a new command.                                                                          | `apps/web/src/review/use-review-session.ts:498` | Save state line                                                             | 11    |
| The new comparison is ready.                                                                                                                   | `apps/web/src/review/use-review-session.ts:220` | Save state line after polling                                               | 5     |
| {run status}. Review actions are unavailable until it is ready.                                                                                | `apps/web/src/review/use-review-session.ts:228` | Save state line while polling                                               | 9     |
| Waiting for the new comparison. {message}                                                                                                      | `apps/web/src/review/use-review-session.ts:236` | Save state line after a failed poll                                         | 6     |
| Waiting for the new comparison. The service is unavailable.                                                                                    | `apps/web/src/review/use-review-session.ts:237` | Save state line after a failed poll                                         | 9     |
| Creating a new comparison from stored captures…                                                                                                | `apps/web/src/review/use-review-session.ts:515` | Save state line. Unreachable (recompare is retired)                         | 7     |
| New comparison requested. Results will open when comparison completes.                                                                         | `apps/web/src/review/use-review-session.ts:539` | Save state line. Unreachable                                                | 9     |
| The new comparison failed.                                                                                                                     | `apps/web/src/review/use-review-session.ts:538` | Save state line. Unreachable                                                | 4     |
| Retry same command                                                                                                                             | `apps/web/src/review/review-workspace.tsx:1122` | Save state button                                                           | 3     |
| Retry Undo                                                                                                                                     | `apps/web/src/review/review-workspace.tsx:1127` | Save state button                                                           | 2     |
| Refresh current state                                                                                                                          | `apps/web/src/review/review-workspace.tsx:1132` | Save state button                                                           | 3     |
| The service did not return review data. Check your connection and refresh.                                                                     | `apps/web/src/review/client.ts:265`             | Save state alert body or run error (non-JSON response)                      | 12    |
| The service returned an invalid response. Refresh before reviewing.                                                                            | `apps/web/src/review/client.ts:17`              | Save state alert body or run error (malformed data)                         | 9     |
| The service returned an invalid text field.                                                                                                    | `apps/web/src/review/client.ts:24`              | Save state alert body or run error                                          | 7     |
| The service returned an invalid numeric field.                                                                                                 | `apps/web/src/review/client.ts:35`              | Save state alert body or run error                                          | 7     |
| The service returned an invalid state field.                                                                                                   | `apps/web/src/review/client.ts:46`              | Save state alert body or run error                                          | 7     |
| The service returned an invalid list.                                                                                                          | `apps/web/src/review/client.ts:53`              | Save state alert body or run error                                          | 6     |
| The service returned an unsupported review state.                                                                                              | `apps/web/src/review/client.ts:65`              | Save state alert body or run error                                          | 7     |
| The service returned invalid review metadata. Refresh before reviewing.                                                                        | `apps/web/src/review/client.ts:105`             | Save state alert body or run error                                          | 9     |
| The service returned invalid image evidence. Refresh before reviewing.                                                                         | `apps/web/src/review/client.ts:112`             | Save state alert body or run error                                          | 9     |
| This review format has changed. Refresh before reviewing.                                                                                      | `apps/web/src/review/client.ts:158`             | Save state alert body or run error                                          | 8     |
| The saved review is incomplete. Refresh before reviewing.                                                                                      | `apps/web/src/review/navigation.ts:97`          | Save state alert body                                                       | 8     |
| The saved review does not match this comparison. Refresh before reviewing.                                                                     | `apps/web/src/review/navigation.ts:100`         | Save state alert body                                                       | 11    |
| The saved review returned an incomplete target list. Refresh before reviewing.                                                                 | `apps/web/src/review/navigation.ts:105`         | Save state alert body                                                       | 11    |
| The saved review returned an unexpected revision. Refresh before reviewing.                                                                    | `apps/web/src/review/navigation.ts:111`         | Save state alert body                                                       | 10    |
| The saved review changed unknown evidence. Refresh before reviewing.                                                                           | `apps/web/src/review/navigation.ts:132`         | Save state alert body                                                       | 9     |
| Review all changed views                                                                                                                       | `apps/web/src/review/review-workspace.tsx:1251` | Batch dialog heading                                                        | 4     |
| This decision applies to all {n} changed views in {item}, including views with a previous decision.                                            | `apps/web/src/review/review-workspace.tsx:1254` | Batch dialog description                                                    | 16    |
| {variant label}                                                                                                                                | `apps/web/src/review/review-workspace.tsx:1260` | Batch dialog row, raw joined label                                          | 1     |
| Cancel                                                                                                                                         | `apps/web/src/review/review-workspace.tsx:1267` | Batch dialog button                                                         | 1     |
| Reject whole item ({n})                                                                                                                        | `apps/web/src/review/review-workspace.tsx:1280` | Batch dialog button                                                         | 4     |
| Approve whole item ({n})                                                                                                                       | `apps/web/src/review/review-workspace.tsx:1293` | Batch dialog primary button                                                 | 4     |
| Keyboard help                                                                                                                                  | `apps/web/src/review/review-workspace.tsx:150`  | Footer icon button, aria-label                                              | 2     |
| Review with the keyboard                                                                                                                       | `apps/web/src/review/review-workspace.tsx:160`  | Help dialog heading                                                         | 4     |
| Shortcuts work across this page. Text fields, tabs, menus, and dialogs keep their own keys. Use the visible pan buttons to move zoomed images. | `apps/web/src/review/review-workspace.tsx:162`  | Help dialog description                                                     | 24    |
| ↑ / ↓                                                                                                                                          | `apps/web/src/review/review-workspace.tsx:166`  | Help dialog key                                                             | 0     |
| Previous or next item. Stop at either end.                                                                                                     | `apps/web/src/review/review-workspace.tsx:167`  | Help dialog row                                                             | 8     |
| ← / → · 1–6                                                                                                                                    | `apps/web/src/review/review-workspace.tsx:168`  | Help dialog key                                                             | 1     |
| Select a variant.                                                                                                                              | `apps/web/src/review/review-workspace.tsx:169`  | Help dialog row                                                             | 3     |
| A / X                                                                                                                                          | `apps/web/src/review/review-workspace.tsx:170`  | Help dialog key                                                             | 2     |
| Approve or reject, then move to the next pending variant.                                                                                      | `apps/web/src/review/review-workspace.tsx:171`  | Help dialog row                                                             | 10    |
| Shift+A / Shift+X                                                                                                                              | `apps/web/src/review/review-workspace.tsx:172`  | Help dialog key                                                             | 2     |
| Review all changed variants in this item as one command.                                                                                       | `apps/web/src/review/review-workspace.tsx:173`  | Help dialog row                                                             | 10    |
| S / D / F / G                                                                                                                                  | `apps/web/src/review/review-workspace.tsx:174`  | Help dialog key                                                             | 4     |
| Side by side, red pixel diff, new image only, or original only.                                                                                | `apps/web/src/review/review-workspace.tsx:175`  | Help dialog row                                                             | 12    |
| Cmd/Ctrl+Z                                                                                                                                     | `apps/web/src/review/review-workspace.tsx:176`  | Help dialog key                                                             | 1     |
| Undo your last saved command in this session.                                                                                                  | `apps/web/src/review/review-workspace.tsx:177`  | Help dialog row                                                             | 8     |
| [                                                                                                                                              | `apps/web/src/review/review-workspace.tsx:178`  | Help dialog key                                                             | 0     |
| Collapse or expand the screenshot sidebar.                                                                                                     | `apps/web/src/review/review-workspace.tsx:179`  | Help dialog row                                                             | 6     |
| Tab / Escape                                                                                                                                   | `apps/web/src/review/review-workspace.tsx:180`  | Help dialog key                                                             | 2     |
| Move to controls or close this help.                                                                                                           | `apps/web/src/review/review-workspace.tsx:181`  | Help dialog row                                                             | 7     |
| Close help                                                                                                                                     | `apps/web/src/review/review-workspace.tsx:184`  | Help dialog button                                                          | 2     |
| Shortcuts on / Shortcuts off                                                                                                                   | `apps/web/src/review/review-workspace.tsx:1184` | Footer toggle button                                                        | 4     |
| Recompare stored run                                                                                                                           | `apps/web/src/review/review-workspace.tsx:1195` | Footer button. Always disabled in production                                | 3     |
| {recompareDisabledReason}                                                                                                                      | `apps/web/src/review/review-workspace.tsx:1200` | Footer paragraph and button title (server text). Always shown in production | 1     |
| This closed review is read-only. Capture a new complete run.                                                                                   | `apps/web/src/review/review-workspace.tsx:331`  | Footer paragraph fallback. The server always sends a reason                 | 10    |
| The remembered variant is unavailable. Selected {variant label}.                                                                               | `apps/web/src/review/review-workspace.tsx:347`  | Screen reader announcement (also RW:366)                                    | 7     |
| Pixel diff requires both a reference and a new image. The current view has not changed.                                                        | `apps/web/src/review/review-workspace.tsx:379`  | Screen reader announcement                                                  | 16    |
| Review complete. No variants need review.                                                                                                      | `apps/web/src/review/use-review-session.ts:367` | Screen reader announcement                                                  | 6     |
| Resolve the unsaved command before saving another review.                                                                                      | `apps/web/src/review/use-review-session.ts:410` | Screen reader announcement                                                  | 8     |
| {reason} No variants were changed.                                                                                                             | `apps/web/src/review/use-review-session.ts:426` | Screen reader announcement                                                  | 5     |
| Select an eligible variant and review it individually.                                                                                         | `apps/web/src/review/use-review-session.ts:426` | Screen reader announcement suffix                                           | 8     |

### Review workspace: details panel

| String                                                                 | File:line                                       | Where it shows                                                          | Words |
| ---------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- | ----- |
| Capture details                                                        | `apps/web/src/review/review-workspace.tsx:1155` | Right sidebar header and aria-label (RW:1151); dialog heading (RW:1233) | 2     |
| Close capture details                                                  | `apps/web/src/review/review-workspace.tsx:1159` | Close button, aria-label (also RW:1234)                                 | 3     |
| {variant label} · {status} · {reviewer}                                | `apps/web/src/review/review-workspace.tsx:464`  | First line, raw joined label                                            | 3     |
| {run status}                                                           | `apps/web/src/review/review-workspace.tsx:467`  | Second line (repeats the meta strip)                                    | 1     |
| Run {id} · Attempt {n} · Commit {12-character commit} · Comparison {n} | `apps/web/src/review/review-workspace.tsx:469`  | Third line                                                              | 8     |
| Comparison history                                                     | `apps/web/src/review/review-workspace.tsx:473`  | Link list, aria-label                                                   | 2     |
| Original comparison                                                    | `apps/web/src/review/review-workspace.tsx:474`  | Link (always present)                                                   | 2     |
| Historical comparison {n} · Complete / Failed / Comparing              | `apps/web/src/review/review-workspace.tsx:481`  | Links (legacy runs only)                                                | 6     |
| Changed pixels                                                         | `apps/web/src/review/review-workspace.tsx:491`  | Field label                                                             | 2     |
| {n} ({n}%)                                                             | `apps/web/src/review/review-workspace.tsx:493`  | Field value, four decimals                                              | 2     |
| Dimensions                                                             | `apps/web/src/review/review-workspace.tsx:496`  | Field label                                                             | 1     |
| {w} × {h} → {w} × {h}                                                  | `apps/web/src/review/review-workspace.tsx:499`  | Field value                                                             | 4     |
| Absent                                                                 | `apps/web/src/review/review-workspace.tsx:500`  | Field value for a missing side (also RW:504, 516)                       | 1     |
| Engine / codec                                                         | `apps/web/src/review/review-workspace.tsx:506`  | Field label                                                             | 2     |
| Policy / threshold                                                     | `apps/web/src/review/review-workspace.tsx:510`  | Field label                                                             | 2     |
| Capture profiles                                                       | `apps/web/src/review/review-workspace.tsx:514`  | Field label                                                             | 2     |
| Comparison                                                             | `apps/web/src/review/review-workspace.tsx:518`  | Field label                                                             | 1     |
| {comparison id} · {row id} · decision revision {n}                     | `apps/web/src/review/review-workspace.tsx:520`  | Field value                                                             | 5     |
| —                                                                      | `apps/web/src/review/review-workspace.tsx:493`  | Field value for an unknown number or name (also RW:508, 512)            | 0     |

### Server text that reaches the review UI

| String                                                                                                                                     | File:line                                      | Where it shows                                                                       | Words |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| This run is archived. Decisions show the state at archive time and are read-only.                                                          | `apps/web/src/api/review.ts:98`                | Read-only banner and button titles (archived run without a summary reason)           | 14    |
| This closed review has a permanent decision summary. Image replay has ended. Capture a new run for review.                                 | `apps/web/src/operations/closed-summary.ts:18` | Read-only banner and button titles (closed summary)                                  | 18    |
| This historical comparison is read-only. It does not affect the live review or required check.                                             | `apps/web/src/api/review.ts:581`               | Read-only banner (historical comparison)                                             | 15    |
| This baseline was imported. Previous comparison details were discarded during the database cutover. Capture a new complete run for review. | `apps/web/src/api/review.ts:583`               | Read-only banner (imported baseline)                                                 | 20    |
| This run is already in the baseline. Capture a correction in a new complete main run.                                                      | `apps/web/src/api/review.ts:585`               | Read-only banner (accepted run); Reject button title (AR:546)                        | 16    |
| Promoted history is read-only.                                                                                                             | `apps/web/src/api/review.ts:547`               | Approve button title                                                                 | 4     |
| This closed review is read-only. Capture a new complete run.                                                                               | `apps/web/src/api/review.ts:595`               | Footer paragraph (closed run)                                                        | 10    |
| Run trusted Submit again from the complete CI bundle, or capture a new run. Unchanged candidate images were not uploaded.                  | `apps/web/src/api/review.ts:597`               | Footer paragraph on every active run that used local comparison                      | 20    |
| Server recomparison is retired. Capture a new complete run with trusted local Submit.                                                      | `apps/web/src/api/review.ts:102`               | Footer paragraph on every other active run                                           | 13    |
| Historical comparison failed. Required comparison evidence or its reference is unavailable. Capture a new complete run for a new result.   | `apps/web/src/api/review.ts:100`               | Warning banner (failed historical comparison)                                        | 20    |
| Comparison stopped before evidence was available.                                                                                          | `apps/web/src/api/review.ts:534`               | Viewer status body (variant error)                                                   | 6     |
| Comparison evidence is unavailable.                                                                                                        | `apps/web/src/api/review.ts:536`               | Viewer alert body (variant error)                                                    | 4     |
| Color threshold {n}; maximum {n} pixels; ratio {n}                                                                                         | `apps/web/src/api/review.ts:525`               | Details panel, Policy / threshold value (local comparison)                           | 8     |
| Channel threshold {n}; maximum {n} changed pixels; ratio {n}.                                                                              | `apps/web/src/api/review.ts:413`               | Details panel, Policy / threshold value (legacy comparison)                          | 9     |
| #{n} · {pull request title}                                                                                                                | `apps/web/src/api/review.ts:561`               | Run bar title                                                                        | 2     |
| Preview fixtures are read-only. GitHub login is disabled.                                                                                  | `apps/web/src/review/preview-fixtures.ts:6`    | Read-only banner, button titles, and footer reason (preview)                         | 8     |
| Preview fixtures                                                                                                                           | `apps/web/src/review/preview-fixtures.ts:25`   | Header and page eyebrow as the repository name (preview)                             | 2     |
| Dialog review example                                                                                                                      | `apps/web/src/review/preview-fixtures.ts:29`   | Run title (preview)                                                                  | 3     |
| The service is temporarily unavailable.                                                                                                    | `apps/web/src/api/index.ts:78`                 | Run error paragraph or save state alert (HTTP 503), followed by `Reference: {id}.`   | 5     |
| The application origin is not allowed.                                                                                                     | `apps/web/src/api/index.ts:111`                | Save state alert (HTTP 403). The run page replaces every 403 with its own text       | 6     |
| The endpoint was not found.                                                                                                                | `apps/web/src/api/index.ts:217`                | Save state alert (HTTP 404)                                                          | 5     |
| Sign in with GitHub.                                                                                                                       | `packages/security/src/authorization.ts:38`    | Save state alert as `Not saved. Sign in with GitHub.` (HTTP 401 during a save)       | 4     |
| A GitHub identity is required.                                                                                                             | `packages/security/src/authorization.ts:46`    | Save state alert (HTTP 403)                                                          | 5     |
| Repository write permission is required.                                                                                                   | `packages/security/src/github.ts:227`          | Save state alert (HTTP 403)                                                          | 5     |
| GitHub verification is temporarily unavailable.                                                                                            | `packages/security/src/github.ts:25`           | Run error paragraph or save state alert (HTTP 503)                                   | 5     |
| The request origin is not allowed.                                                                                                         | `packages/security/src/http.ts:23`             | Save state alert (HTTP 403)                                                          | 6     |
| The configured repository does not match this project.                                                                                     | `apps/web/src/api/context.ts:137`              | Run error paragraph or save state alert (HTTP 503)                                   | 8     |
| The run was not found.                                                                                                                     | `apps/web/src/api/review.ts:92`                | Run error paragraph (HTTP 404)                                                       | 5     |
| The historical comparison was not found.                                                                                                   | `apps/web/src/api/review.ts:117`               | Run error paragraph (HTTP 404; also AR:240)                                          | 6     |
| Closed history is being converted to a decision summary.                                                                                   | `apps/web/src/api/review.ts:247`               | Run error paragraph (HTTP 503)                                                       | 9     |
| The historical comparison archive is unavailable.                                                                                          | `apps/web/src/api/review.ts:260`               | Run error paragraph (HTTP 503)                                                       | 6     |
| The resource identity is invalid.                                                                                                          | `apps/web/src/api/input.ts:43`                 | Run error paragraph for a malformed run ID in the URL (HTTP 400)                     | 5     |
| The requested record does not exist.                                                                                                       | `packages/service/src/service.ts:95`           | Run error paragraph, or `Conflict. …` in the save state (HTTP 409; also SRC:21, 181) | 6     |
| Start a new review session after signing in.                                                                                               | `apps/web/src/api/review.ts:631`               | Save state alert as `Conflict. …` (HTTP 409)                                         | 8     |
| Command replay has ended. The permanent decision summary remains available.                                                                | `apps/web/src/api/review.ts:678`               | Save state alert as `Conflict. …` (HTTP 409)                                         | 10    |
| The queued decision was not found.                                                                                                         | `apps/web/src/api/review.ts:803`               | Save state alert (HTTP 404)                                                          | 6     |
| The queued decision could not be processed. Review it again.                                                                               | `apps/web/src/api/review.ts:825`               | Save state alert as `Conflict. …`                                                    | 10    |
| Choose approved or rejected.                                                                                                               | `apps/web/src/api/review.ts:845`               | Save state alert (HTTP 400; the UI cannot send another value)                        | 4     |
| The review targets are invalid.                                                                                                            | `apps/web/src/api/review.ts:851`               | Save state alert (HTTP 400)                                                          | 5     |
| Your command was not found.                                                                                                                | `apps/web/src/api/review.ts:923`               | Save state alert after Undo (HTTP 404)                                               | 5     |
| Closed history is read-only. Capture a new complete run.                                                                                   | `apps/web/src/api/review.ts:957`               | Recompare error. Unreachable from the UI                                             | 9     |
| Run trusted Submit again from the complete CI bundle, or capture a new run. Stored representatives cannot replace omitted candidate bytes. | `apps/web/src/api/review.ts:972`               | Recompare error. Unreachable from the UI                                             | 21    |
| This command ID already belongs to another decision.                                                                                       | `apps/web/src/operations/review-queue.ts:30`   | Save state alert as `Conflict. …`                                                    | 8     |
| The previous decision has not reached the server. Retry the unsent decisions.                                                              | `apps/web/src/operations/review-queue.ts:37`   | Never shown. A plain Error becomes the generic HTTP 503 text                         | 12    |
| The previous decision belongs to another review session.                                                                                   | `apps/web/src/operations/review-queue.ts:46`   | Save state alert as `Conflict. …`                                                    | 8     |
| An earlier queued decision failed. Review the current evidence again.                                                                      | `apps/web/src/operations/review-queue.ts:114`  | Save state alert as `Conflict. …`                                                    | 10    |
| The command ID already belongs to another request.                                                                                         | `packages/service/src/review-commands.ts:82`   | Save state alert as `Conflict. …`                                                    | 8     |
| A review command requires a maintainer, session, and unique targets.                                                                       | `packages/service/src/review-commands.ts:142`  | Save state alert as `Conflict. …`                                                    | 10    |
| Archived history is read-only.                                                                                                             | `packages/service/src/review-commands.ts:184`  | Save state alert as `Conflict. …`                                                    | 4     |
| A target changed or belongs to another comparison.                                                                                         | `packages/service/src/review-commands.ts:190`  | Save state alert as `Conflict. …`, followed by `Updated by {reviewer}.`              | 8     |
| The whole-item target list must include every changed variant.                                                                             | `packages/service/src/review-commands.ts:202`  | Save state alert as `Conflict. …`                                                    | 9     |
| Promoted history is read-only. Capture a correction in a new complete main run.                                                            | `packages/service/src/review-commands.ts:207`  | Save state alert as `Conflict. …` (also SRC:363)                                     | 13    |
| Only the active complete comparison can be reviewed.                                                                                       | `packages/service/src/review-commands.ts:211`  | Save state alert as `Conflict. …`                                                    | 8     |
| Only your saved command in this review session can be undone.                                                                              | `packages/service/src/review-commands.ts:346`  | Save state alert after Undo as `Conflict. …`                                         | 11    |
| The baseline changed after this command.                                                                                                   | `packages/service/src/review-commands.ts:354`  | Save state alert after Undo as `Conflict. …`                                         | 6     |
| The command no longer targets the active comparison.                                                                                       | `packages/service/src/review-commands.ts:366`  | Save state alert after Undo as `Conflict. …`                                         | 8     |
| The saved command does not contain its prior verdict.                                                                                      | `packages/service/src/review-commands.ts:387`  | Save state alert after Undo as `Conflict. …`                                         | 9     |
