STATUS: report.md was NOT written. The Write tool refused it ("Subagents should return findings as text, not write report files. Include this content in your final response instead."). I did not bypass that guard. The full report text is below in this field. All evidence files exist in /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/ (screens/, sources/, measure*.mjs, measure-output.jsonl, measure-inbox-output.jsonl, capture-dashboard.mjs).

ABSTRACT: I compared the Visonaut review surfaces with Chromatic, Percy, Argos, Happo, Lost Pixel, reg-suit, BackstopJS, the Playwright report and UI Mode, the GitHub image diff, Vercel comments, Linear, GitHub notifications, and Graphite (first-party docs, public source, public issues, read 2026-10-05). Main results: (1) the run page gives the images 29.7% of a 1440x900 viewport and the first image pixel is at y=449; (2) the viewer has four modes and no overlay, swipe, or blink, while the stored diff mask is already transparent (pixelmatch diffMask) so those modes need no backend work; (3) zoomed panes scroll separately (measured); (4) the variant strip shows no verdict and fits 3 of 7 variants; (5) queue cards are 240 px for 22 words and history rows are 64 px for the same data; (6) batch scope stops at one item and nothing sorts by change size. Visonaut is ahead of the prior art in per-variant decisions, exact Undo, and input-safe shortcuts. The report has 14 findings, a 33-row pattern catalogue, and 23 ranked design ideas mapped to pages and components.

==================== FULL REPORT ====================

# Prior art: how other review tools design the same surfaces

Lane `ui-benchmark`. Finding prefix `BENCH`. Research date: 2026-10-05. Every external link in this report was read on that date. The checkout is the worktree `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel` at [`f83fef6`](https://github.com/ariakit/visonaut/commit/f83fef6). This lane changed no repository file.

Skills invoked for this lane: `ariakit-general-workflow`, `ariakit-general-markdown`. No repository-specific workflow skill exists for `ariakit/visonaut`.

Scope limits that apply to the whole report:

- I did not sign in to any other product. Their behavior comes from first-party documentation, public source code, and public issue trackers. I did not measure their pixel layout or their text density.
- Raw copies of every fetched page are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/sources/`.
- Visonaut facts come from the source files and from the two running dev servers. Measurements name their command.

## How it works (map)

### 1. The current Visonaut surfaces

All paths below are relative to `apps/web/src/` unless they start with another top-level folder.

A review session today, step by step:

1. The reviewer opens the GitHub check link. It goes to `/pulls/$pullNumber` (`routes/pulls.$pullNumber.tsx:159-284`). That page shows one card with a status line such as "Waiting for screenshots." and the buttons **Check again** and **Open on GitHub**. When the run exists, it opens `/runs/$runId`.
2. The dashboard `/` has three views in one route. `routes/index.tsx:41` reads `view: search.view === "history" || search.view === "service" ? search.view : undefined`.
3. The queue view (`routes/index.tsx:417-558`) renders, top to bottom: an uppercase repository label, the heading "Your review queue.", one sentence, a **Refresh runs** button, three stat tiles (`:450-464`), the section label "Ready to review", one 240 px card for each run (`:473-518`), the groups "In progress" and "Needs attention" as 64 px rows (`:542-543`, `:560-603`), then a footer with the baseline revision and **View history**.
4. The history view (`routes/index.tsx:605-750`) renders a search field, a result filter, and a three-column table (Run, Result, Created).
5. The service view renders a heading, two sentences, one card for each alert, a guide button, and the line "No external notifications are sent."
6. The run page is one component, `review/review-workspace.tsx`. Its rows, top to bottom at 1440 x 900, are: the app header, the run header with **Queue**, the title, and the progress text (`:563-608`), an identity row with commit, attempt, baseline revision, and run status (`:609-622`), the item heading with a status badge and the change ratio (`:634-650`), the variant strip (`:713-781`), the mode and zoom toolbar (`:826-925`), a caption above each pane (`components/screenshot-viewer.tsx:92-131`), the image panes (`components/screenshot-viewer.tsx:132-145`), a sticky action bar (`:1027-1100`), and a footer with keyboard help (`:1172-1205`).
7. The left sidebar lists items in two groups. `review/navigation.ts:34-47` puts an item in `accepted` only when every variant is unchanged or approved and no variant is `added`. Every other item is in `attention`. The order inside each group is the declared order.
8. The viewer has four modes and three zoom levels. `review/model.ts:2-3` reads `export type ReviewMode = "side" | "diff" | "new" | "original";` and `export type ReviewZoom = "fit" | 1 | 2;`.
9. A decision has two scopes: one variant, or all changed variants of one item. The whole-item command opens a confirmation dialog (`review/review-workspace.tsx:1251-1293`).
10. The keyboard map is one handler (`review/review-workspace.tsx:395-442`): Up and Down change the item, Left and Right change the variant, `1` to `6` select a variant, `A` and `X` approve and reject, `Shift+A` and `Shift+X` act on the whole item, `S` `D` `F` `G` select the image mode, `Cmd/Ctrl+Z` undoes, and `[` toggles the sidebar.

Three technical facts decide which prior-art patterns are cheap here:

- The diff image is a transparent mask, not a composite. `packages/cli/src/png-comparison.ts:68-75` calls `pixelmatch(..., { threshold: comparison.threshold, includeAA: false, diffMask: true })`. The pixelmatch 5.3.0 README says `diffMask` will "Draw the diff over a transparent background (a mask), rather than over the original image." The mask has the candidate dimensions (`packages/cli/src/png-comparison.ts:93-96`). An overlay, a tint, and a changed-region scan need no backend change.
- There is no mask when the image size changed. `packages/cli/src/png-comparison.ts:64-66` returns `sizeChanged: true` before the comparison.
- Variant axes are structured data. `apps/web/src/api/review.ts:469-481` builds `labelParts` with the kinds `framework`, `browser`, `colorScheme`, `contrast`, `forcedColors`, and `key`. A variant matrix or a grouped strip can use them directly.

What Visonaut already does that several other tools do not:

- A decision for one variant. Percy cannot do this: "it is not possible to approve individual screenshots taken on a specific browser for a specific width" ([Percy approval workflow](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)). Chromatic accepts all browsers of a baseline in one click ([Chromatic branches and baselines](https://www.chromatic.com/docs/branching-and-baselines/)).
- Undo bound to the exact saved command (`docs/review-guide.md:57-61`). BackstopJS users have asked for this since 2020 ([BackstopJS #1165](https://github.com/garris/BackstopJS/issues/1165)).
- Shortcut letters shown on the buttons, and shortcuts that do not fire in text fields (`review/review-workspace.tsx:88`, `:397`). The reg-cli report had that defect ([reg-cli-report-ui #22](https://github.com/reg-viz/reg-cli-report-ui/issues/22)).
- A decision waits until the images of the current selection decode (`docs/review-guide.md:41`).
- A URL for each item and variant (`review/review-workspace.tsx:749-758`).

### 2. How the other tools handle each dimension

#### 2.1 Queue or inbox model

| Tool                 | Model                                                                                                                                                                                                              | Source                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argos                | A **Builds** list. One row for each build. Filters for type, status, and build name.                                                                                                                               | [Builds list](https://argos-ci.com/docs/learn/review-workflow/builds-list)                                                                                                                                                   |
| Chromatic            | A build screen for UI Tests, and a separate **Reviews** tab for each pull request with an Activity tab and a Changeset tab.                                                                                        | [Quickstart](https://www.chromatic.com/docs/quickstart/), [UI Review](https://www.chromatic.com/docs/review/)                                                                                                                |
| Percy                | A build for each test run. Build states include "Receiving", "Processing", "Unreviewed", "Approved", and "Changes requested".                                                                                      | [Visual testing basics](https://www.browserstack.com/docs/percy/overview/visual-testing-basics), [Request changes](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/change-request) |
| Happo                | No queue page in the documentation. The entry is the commit status link to one comparison report.                                                                                                                  | [Continuous integration](https://docs.happo.io/docs/continuous-integration)                                                                                                                                                  |
| Lost Pixel           | A build with a GitHub status check. The product is closed: the repository is archived and the team announced the sunset on 2026-04-22.                                                                             | [Baseline flow](https://docs.lost-pixel.com/user-docs/recipes/lost-pixel-platform/working-with-baseline-images), [Announcement](https://www.lost-pixel.com/blog/lost-pixel-team-is-joining-figma)                            |
| reg-suit             | No queue. A static HTML report for each run, linked from a pull request comment.                                                                                                                                   | [reg-suit README](https://github.com/reg-viz/reg-suit)                                                                                                                                                                       |
| BackstopJS           | No queue. A local HTML report for the last test batch.                                                                                                                                                             | [BackstopJS README](https://github.com/garris/BackstopJS)                                                                                                                                                                    |
| Playwright           | No queue. An HTML report or UI Mode for each local or CI run.                                                                                                                                                      | [UI Mode](https://playwright.dev/docs/test-ui-mode)                                                                                                                                                                          |
| Graphite             | A pull request inbox with six default sections: "Needs your review", "Approved", "Returned to you", "Merging and recently merged", "Drafts", "Waiting for review". Sections are editable, sortable, and shareable. | [Pull Request Inbox](https://graphite.com/docs/use-pr-inbox)                                                                                                                                                                 |
| Linear               | An Inbox list with a **Priority** tab. A selected notification opens "in a special Inbox view". Snooze hides an entry until a chosen time.                                                                         | [Inbox](https://linear.app/docs/inbox)                                                                                                                                                                                       |
| Linear Triage        | A team queue with four verbs: accept, decline, mark as duplicate, snooze.                                                                                                                                          | [Triage](https://linear.app/docs/triage)                                                                                                                                                                                     |
| GitHub notifications | An inbox with the states Done, Saved, Unsubscribed, Read, and Unread, default filters, up to 15 custom filters, and multi-select triage.                                                                           | [Managing notifications from your inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)                                       |
| Vercel comments      | An **Inbox** inside the toolbar of the preview page. A badge shows new threads. Filters for page and for resolved status.                                                                                          | [Using comments](https://vercel.com/docs/comments/using-comments)                                                                                                                                                            |

#### 2.2 Build or run page layout

| Tool           | Layout                                                                                                                                                                                                       | Source                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Argos          | Baseline pane and changes pane side by side, a screenshot list, and a build sidebar with **Reviewers** and **Activity**. An optional **Journey** strip of step thumbnails opens above the panes.             | [Review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                                                                                                                                                           |
| Chromatic      | Two levels. The build screen has a "Tests" table. "Clicking on a story takes you to the snapshot page where you can compare the new snapshot to the baseline" (image caption). `Esc` goes back to the build. | [Quickstart](https://www.chromatic.com/docs/quickstart/)                                                                                                                                                                                   |
| Percy          | A snapshot list with thumbnails, a filter panel, and the comparison. "Configurable panels ... can easily be resized, and even be collapsed altogether for a clutter-free view".                              | [Visual Reviews 2.0, 2020-12-15](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/)                                                                                                                                        |
| Happo          | "Diffs are presented on the right, and on the left you have a sidebar with some filters and a "review" panel".                                                                                               | [Reviewing diffs](https://docs.happo.io/docs/reviewing-diffs)                                                                                                                                                                              |
| reg-cli report | A sidebar with the groups CHANGED, NEW, DELETED, and PASSED plus a "Filter by file name" field. A grid of items. A modal viewer for one item.                                                                | [SidebarInner.tsx](https://github.com/reg-viz/reg-cli-report-ui/blob/main/src/components/Sidebar/internal/SidebarInner/SidebarInner.tsx)                                                                                                   |
| BackstopJS     | A card list. Each card shows the reference, test, and diff images. A modal "scrubber" opens for one card. Settings hide each image column or the text.                                                       | [SettingsPopup.js](https://github.com/garris/BackstopJS/blob/master/compare/src/components/molecules/SettingsPopup.js), [ImageScrubber.js](https://github.com/garris/BackstopJS/blob/master/compare/src/components/atoms/ImageScrubber.js) |
| Playwright     | The failed test page has an image diff block for each screenshot. UI Mode shows the same block in the **Attachments** tab.                                                                                   | [imageDiffView.tsx](https://github.com/microsoft/playwright/blob/main/packages/web/src/shared/imageDiffView.tsx), [UI Mode](https://playwright.dev/docs/test-ui-mode)                                                                      |
| Graphite       | Pull request page with a file tree next to the diff. `F` collapses the tree. Status, review status, and checks sit in the top right.                                                                         | [PR page overview](https://graphite.com/docs/pr-page-overview)                                                                                                                                                                             |
| Visonaut       | Sidebar, then seven stacked rows above the first image pixel, then a sticky action bar, then a footer below the fold.                                                                                        | `review/review-workspace.tsx:563-1205`                                                                                                                                                                                                     |

#### 2.3 Diff modes

| Tool              | Modes                                                                                                                                                                                                                                                                         | Source                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub image diff | "2-up, swipe, and onion skin". 2-up is the default and shows the dimension change. Swipe has a draggable divider. Onion skin has an opacity slider.                                                                                                                           | [Working with non-code files](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files)                                                                                       |
| Playwright report | Tabs `Diff`, `Actual`, `Expected`, `Side by side`, `Slider`. `Diff` is the default when a diff exists. In side by side, a click on the right image switches it between Actual and Diff.                                                                                       | [imageDiffView.tsx lines 67 and 103-116](https://github.com/microsoft/playwright/blob/main/packages/web/src/shared/imageDiffView.tsx)                                                                                   |
| reg-cli report    | `Diff`, `Slide`, `2up`, `Blend`, `Toggle`.                                                                                                                                                                                                                                    | [ComparisonView.tsx](https://github.com/reg-viz/reg-cli-report-ui/blob/main/src/components/Viewer/internal/ComparisonView/ComparisonView.tsx)                                                                           |
| BackstopJS        | `REFERENCE`, `TEST`, `DIFF`, `SCRUBBER`, `DIVERGED`.                                                                                                                                                                                                                          | [ImageScrubber.js](https://github.com/garris/BackstopJS/blob/master/compare/src/components/atoms/ImageScrubber.js)                                                                                                      |
| Chromatic         | "Unified view (1 Up)" with the diff over the baseline, "Split view (2 Up)", a diff toggle, "Diff strobing" that toggles quickly between baseline and new, and a focus mode that "activates automatically when it senses minimal pixel variations" with a hover magnifier.     | [Diff Inspector](https://www.chromatic.com/docs/diff-inspector/)                                                                                                                                                        |
| Percy             | "Side-by-side mode" and "Overlay mode", a diff overlay toggle, a "diff highlighter" bar beside the new image, zoom buttons, and a "Diff Navigator" that "auto-zooms on each difference".                                                                                      | [Visual Reviews 2.0](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/), [Diff highlighter](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/diff-highlighter) |
| Argos             | Split view (default), single view, a changes overlay with selectable color and opacity, a highlighter that flashes changed regions and steps through them, fit or expand where "zoom and pan stay in sync between the baseline and changes panes", and an ARIA snapshot view. | [Review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                                                                                                                                        |
| Happo             | "Side-by-side visual comparisons" on the product page. The documentation does not list the view modes.                                                                                                                                                                        | [happo.io](https://happo.io/)                                                                                                                                                                                           |
| Visonaut          | Side by side, mask only, new only, original only. Zoom is Fit, 100%, or 200%.                                                                                                                                                                                                 | `review/model.ts:2-3`                                                                                                                                                                                                   |

#### 2.4 Batch approve and reject

| Tool       | Scope of one decision                                                                                                                                                                                                                                                      | Source                                                                                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Percy      | Three scopes: "Approve build", "Approve groups of matching visual changes", "Approve individual snapshots". A snapshot covers every browser and width. A group cannot be split: "approving or requesting changes for individual snapshots within a group is not possible". | [Approval workflow](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval), [Matching diffs](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/snapshot-grouping-with-matching-diffs) |
| Chromatic  | One test, or the batch operations "accept all", "deny all", and "mark all unreviewed". One accept covers all browsers of the baseline.                                                                                                                                     | [Ignore tests FAQ](https://www.chromatic.com/docs/ignore-tests/), [Branches and baselines](https://www.chromatic.com/docs/branching-and-baselines/)                                                                                                                        |
| Argos      | `Y` and `N` mark one change. The verdict that counts is one review for the whole build: Comment, Reject, or Approve.                                                                                                                                                       | [Review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                                                                                                                                                                                           |
| Happo      | The whole report: one Accept and Reject pair in the sidebar. One diff can be reported as flaky.                                                                                                                                                                            | [Reviewing diffs](https://docs.happo.io/docs/reviewing-diffs), [Reporting flake](https://docs.happo.io/docs/reporting-flake)                                                                                                                                               |
| Lost Pixel | One image: Remove, Approve, or Reject. The check is green when all images are approved.                                                                                                                                                                                    | [Baseline flow](https://docs.lost-pixel.com/user-docs/recipes/lost-pixel-platform/working-with-baseline-images)                                                                                                                                                            |
| reg-suit   | None in the report. The CLI flag `-U` copies all actual images to expected.                                                                                                                                                                                                | [reg-cli README](https://github.com/reg-viz/reg-cli)                                                                                                                                                                                                                       |
| BackstopJS | `backstop approve` promotes every changed image of the last batch. `--filter` limits it by file name. The web report can approve one scenario when `backstop remote` runs.                                                                                                 | [BackstopJS README](https://github.com/garris/BackstopJS)                                                                                                                                                                                                                  |
| Playwright | None in the report. `--update-snapshots` rewrites the files.                                                                                                                                                                                                               | [Visual comparisons](https://playwright.dev/docs/test-snapshots)                                                                                                                                                                                                           |
| Visonaut   | One variant, or all changed variants of one item.                                                                                                                                                                                                                          | `review/review-workspace.tsx:1055`, `:1251-1293`                                                                                                                                                                                                                           |

#### 2.5 Keyboard flows

"none" means that the documentation lists no key for the action.

| Action                   | Visonaut                    | Chromatic              | Percy                       | Argos                          | reg-cli report            |
| ------------------------ | --------------------------- | ---------------------- | --------------------------- | ------------------------------ | ------------------------- |
| Next or previous item    | Down, Up                    | `⌥ →`, `⌥ ←`           | Down, Up                    | Down, Up                       | Right or `l`, Left or `h` |
| Next or previous variant | Right, Left, `1` to `6`     | none                   | none                        | none                           | none                      |
| Approve                  | `A`, `Shift+A` for the item | `a`                    | `A`                         | `Y`                            | none                      |
| Reject                   | `X`, `Shift+X` for the item | `d`                    | none                        | `N`                            | none                      |
| Side by side             | `S`                         | `2`                    | none                        | `S`                            | none                      |
| Diff                     | `D` (mask only)             | `3` (toggle diff)      | `D` (toggle overlay)        | `D` (toggle overlay)           | none                      |
| Old only, new only       | `G`, `F`                    | `1` repeatedly, or `s` | Left, Right in Overlay mode | Left, Right                    | none                      |
| Next changed region      | none                        | none                   | `Shift+Left`, `Shift+Right` | `J`, `K`, and `H` to highlight | `m` toggles markers       |
| Fit to screen            | none                        | none                   | none                        | `Space`                        | none                      |
| Shortcut list            | none                        | none                   | none                        | `?`                            | none                      |
| Undo                     | `Cmd/Ctrl+Z`                | none                   | none                        | none                           | none                      |
| Toggle panel             | `[`                         | none                   | `[`                         | none                           | none                      |
| Back to the list         | none                        | `Esc`                  | none                        | none                           | `Escape`                  |
| Ignore a flaky change    | none                        | none                   | none                        | `I`                            | none                      |
| Comment                  | none                        | none                   | none                        | `C`                            | none                      |

Sources: `review/review-workspace.tsx:395-442`, [Chromatic quickstart](https://www.chromatic.com/docs/quickstart/), [Percy Visual Reviews 2.0](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/), [Percy diff highlighter](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/diff-highlighter), [Argos review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build), [reg-cli Viewer.tsx](https://github.com/reg-viz/reg-cli-report-ui/blob/main/src/components/Viewer/Viewer.tsx).

Keys in the inbox tools:

| Tool                 | Keys                                                                                                                                                    | Source                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Linear Inbox         | `G` then `I` opens the Inbox. `J` and `K` or the arrows move. `U` marks read or unread. `H` snoozes. `Backspace` deletes.                               | [Inbox](https://linear.app/docs/inbox)                                                                                       |
| Linear Triage        | `1` accept, `2` decline, `3` mark as duplicate, `H` snooze.                                                                                             | [Triage](https://linear.app/docs/triage)                                                                                     |
| GitHub notifications | `G` `N` opens notifications. `E` marks done. `Shift+U` unread. `Shift+I` read. `Shift+M` unsubscribe.                                                   | [Keyboard shortcuts](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)                                |
| Graphite             | `Cmd+K` search. On a pull request: `F` file tree, `R` then `A` approve, `R` then `N` request changes, `R` then `C` comment, `R` then `Y` quick approve. | [Pull Request Inbox](https://graphite.com/docs/use-pr-inbox), [PR page overview](https://graphite.com/docs/pr-page-overview) |
| Vercel comments      | `c` starts a comment. Up and down arrows in the inbox move between threads.                                                                             | [Using comments](https://vercel.com/docs/comments/using-comments)                                                            |

#### 2.6 How variants (browser, viewport, theme) are shown

| Tool       | Display                                                                                                                                                                                                       | Source                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Chromatic  | "Each test will be badged with the mode's name and have separate baselines and approvals." "When reviewing a build, the mode-specific tests will be grouped together." Browsers are below the baseline level. | [Modes](https://www.chromatic.com/docs/modes/), [Browsers](https://www.chromatic.com/docs/browsers/) |
| Percy      | A browser and width selector inside one snapshot. "A purple underline guides you precisely to the browser-width combo where a change has been detected."                                                      | [Visual Reviews 2.0](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/)              |
| Argos      | "The viewport and browser variants of one screen collapse into a single step, exactly as they do elsewhere in the review." The journey strip "stays on the variant you are reviewing".                        | [Review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                     |
| Happo      | One diff for each "component, variant, and target combination", for example "Button / default / Chrome".                                                                                                      | [Reporting flake](https://docs.happo.io/docs/reporting-flake)                                        |
| BackstopJS | One card for each scenario and viewport.                                                                                                                                                                      | [BackstopJS README](https://github.com/garris/BackstopJS)                                            |
| reg-cli    | No variant concept. File paths only. A 2018 proposal asked for image variants ([reg-cli #135](https://github.com/reg-viz/reg-cli/issues/135)).                                                                | [reg-cli README](https://github.com/reg-viz/reg-cli)                                                 |
| Visonaut   | A horizontal strip of pill links, one for each variant, with icons and labels for framework, browser, and scheme, plus the remaining parts as text.                                                           | `review/variant-summary.tsx:66-137`                                                                  |

#### 2.7 Status and progress

| Tool                 | Display                                                                                                                                                                                               | Source                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argos                | Build status words: "Auto-approved", "Changes approved", "Changes detected", "Changes rejected". A chip such as "2 / 3 reviewed". Reviewer states: Approved, Rejected, Commented, Pending, Dismissed. | [Builds list](https://argos-ci.com/docs/learn/review-workflow/builds-list), [Review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build)     |
| Chromatic            | The build is "unreviewed", then "Pass" or "Fail". A denied change fails the build at once.                                                                                                            | [Quickstart](https://www.chromatic.com/docs/quickstart/)                                                                                                         |
| Percy                | Counts in the form "1 Changed, 1 Unreviewed, and 0: Approved". Build states Unreviewed, Approved, Changes requested.                                                                                  | [Approval workflow](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)                                          |
| Pull request comment | Argos: one comment, edited in place, with a **Details** column such as `2 added` or `4 changed, 3 ignored`. Chromatic: one comment with change counts and review status.                              | [Argos PR comments](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments), [Chromatic PR comments](https://www.chromatic.com/docs/pr-comments/) |
| Visonaut             | Eight run state labels (`routes/index.tsx:130-140`), seven variant labels (`review/navigation.ts:165-175`), the text "N of M need review" in the sidebar and in the header, and a 64 px progress bar. | see paths                                                                                                                                                        |

#### 2.8 How changes are grouped and ordered

| Tool       | Grouping                                                                                                                                                                                                                                      | Source                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Percy      | Snapshots with the same diff are "grouped together at the top of your snapshot list". Sort by "Bugs (High to Low)" or "Diff % (High to Low)". Filter by status, width, and browser. Optional grouping by test case name.                      | [Matching diffs](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/snapshot-grouping-with-matching-diffs), [Visual Review Agent](https://www.browserstack.com/docs/percy/ai-agents/visual-review-agent/overview) |
| Argos      | Screenshots of one test form a journey. The list sorts large changes first since 2025 ([#1722](https://github.com/argos-ci/argos/issues/1722)). A diff fingerprint identifies "the same change" for the ignore feature. Tags filter the list. | [Review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build), [Flaky test detection](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection), [Tags](https://argos-ci.com/docs/learn/review-workflow/tags)   |
| Chromatic  | By component and story. Modes of one story stay together. "Actual changes appear at the top, while ignored tests are grouped separately in a collapsed section below."                                                                        | [Modes](https://www.chromatic.com/docs/modes/), [Flake filter](https://www.chromatic.com/docs/flake-filter/)                                                                                                                                             |
| reg-cli    | Four fixed groups: CHANGED, NEW, DELETED, PASSED.                                                                                                                                                                                             | [SidebarInner.tsx](https://github.com/reg-viz/reg-cli-report-ui/blob/main/src/components/Sidebar/internal/SidebarInner/SidebarInner.tsx)                                                                                                                 |
| BackstopJS | Filter buttons "all", "passed", "failed" with counts.                                                                                                                                                                                         | [FiltersSwitch.js](https://github.com/garris/BackstopJS/blob/master/compare/src/components/molecules/FiltersSwitch.js)                                                                                                                                   |
| Happo      | A list of diffs and an "Ignored diffs" entry in the sidebar.                                                                                                                                                                                  | [Reporting flake](https://docs.happo.io/docs/reporting-flake)                                                                                                                                                                                            |
| Visonaut   | Two groups, attention and "Accepted (N)". Declared order. A status filter with four values and a text search.                                                                                                                                 | `review/navigation.ts:34-47`, `review/screenshot-filter.tsx:17-22`                                                                                                                                                                                       |

#### 2.9 How much text is on screen

I could not measure the other products. The documentation describes what one list row contains.

| Tool                       | Text in one list entry                                                                                            | Source                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Argos builds list          | "Build number and status", "Change counts", pull request metadata, "Branch and commit", "Timestamp". No sentence. | [Builds list](https://argos-ci.com/docs/learn/review-workflow/builds-list)           |
| Argos pull request comment | Status, an Inspect link, and a count phrase such as `4 changed, 3 ignored`.                                       | [PR comments](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments) |
| Graphite inbox             | Section title, then one row for each pull request.                                                                | [Pull Request Inbox](https://graphite.com/docs/use-pr-inbox)                         |
| Visonaut queue card        | 21 to 24 words in a 240 px card (measured, see Measurements M3).                                                  | `routes/index.tsx:473-518`                                                           |
| Visonaut history row       | 11 to 18 words in a 64 px row (measured, M3).                                                                     | `routes/index.tsx:605-750`                                                           |

### 3. Known public complaints about review UX

| Tool           | Report                            | What the user said                                                                                                                                                                                                                             | State                                                            | Link                                                           |
| -------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Playwright     | Accept a snapshot from the report | "there is no tool to do so. You have to run the tests again with `--update-snapshots`, and the diffs will not be generated in this case." 58 thumbs up, 25 comments.                                                                           | Closed as not planned on 2026-05-12                              | [#24310](https://github.com/microsoft/playwright/issues/24310) |
| Playwright     | Update snapshot action in UI Mode | "accepting a change requires enabling it and running the test again, which can be slow, flaky, and interrupts the review flow". Also: "Because updating is run-level, other changed snapshots can be updated before users have reviewed them". | Open since 2026-08-25                                            | [#42393](https://github.com/microsoft/playwright/issues/42393) |
| Playwright     | Slider diff                       | "There are cases where the slider is more convenient than the pixel highlighting method, especially when the length of the expected and actual screenshots differs." 13 thumbs up.                                                             | Closed, shipped in 2022                                          | [#13176](https://github.com/microsoft/playwright/issues/13176) |
| Argos          | Sort by amount of change          | A build "had 248 files changed. Most of it were minor changes ... But, there were 3 major changes like this, which were difficult to find manually".                                                                                           | Closed, shipped ("all the large changes at the top of the list") | [#1722](https://github.com/argos-ci/argos/issues/1722)         |
| Argos          | List scroll resets                | "The scroll position is reset almost immediately after stopping scrolling. This makes it harder to skim through tests where there are many minor changes".                                                                                     | Closed                                                           | [#1721](https://github.com/argos-ci/argos/issues/1721)         |
| Argos          | Approvals lost on a new push      | "Suppose there are 100+ valid changes in a branch, I review each one of them and approve once. If there is another push to the same PR, then my previous review is discarded".                                                                 | Closed as completed                                              | [#1384](https://github.com/argos-ci/argos/issues/1384)         |
| Argos          | Screenshot variants               | "I want to mark multiple screenshot variations as valid for a diff to reduce the flaky tests." 8 thumbs up.                                                                                                                                    | Closed as completed                                              | [#1152](https://github.com/argos-ci/argos/issues/1152)         |
| Argos          | Group diffs                       | "Matches and groups screenshot diff that have the same visual change, saving you time and effort while reviewing builds."                                                                                                                      | Closed as completed                                              | [#884](https://github.com/argos-ci/argos/issues/884)           |
| Argos          | Highlight changes                 | "Highlight screenshots changes. Allow to navigate between changes".                                                                                                                                                                            | Closed as completed                                              | [#1242](https://github.com/argos-ci/argos/issues/1242)         |
| reg-suit       | Approve and reject in the report  | "Generated report should have button to approve/decline all or some snapshots that should post GitHub status check update." 11 thumbs up.                                                                                                      | Open since 2020                                                  | [#203](https://github.com/reg-viz/reg-suit/issues/203)         |
| reg-cli report | Shortcuts steal typed letters     | "'j' or 'k' letter are not reflected as the text value ... keyboard shortcut must not interrupt inputting search text."                                                                                                                        | Closed                                                           | [#22](https://github.com/reg-viz/reg-cli-report-ui/issues/22)  |
| reg-cli report | Smooth scroll is slow             | "Smooth scrolling adds an annoying and unnecessary delay when dealing with hundreds of regression screenshots."                                                                                                                                | Open since 2020                                                  | [#27](https://github.com/reg-viz/reg-cli-report-ui/issues/27)  |
| reg-cli report | Search is inconsistent            | "Filtering is both very strict (case sensitive) and very lenient (fuzzy)".                                                                                                                                                                     | Closed                                                           | [#29](https://github.com/reg-viz/reg-cli-report-ui/issues/29)  |
| BackstopJS     | No undo for approve               | "It would be nice to have a way to undo a reference image that was `Approve`d by mistake".                                                                                                                                                     | Open since 2020                                                  | [#1165](https://github.com/garris/BackstopJS/issues/1165)      |
| Lost Pixel     | No color scheme variants          | "it would be useful to specify `prefersColorScheme: ['light', 'dark']`".                                                                                                                                                                       | Open, repository archived                                        | [#406](https://github.com/lost-pixel/lost-pixel/issues/406)    |

I found no public issue tracker for the review UI of Chromatic, Percy, or Happo. Their CLI repositories contain no review UX reports (searched with `gh api search/issues` on 2026-10-05).

### 4. Pattern catalogue

| #   | Pattern                                                     | Who uses it                                                                        | It works when                                               | It fails when                                                                        | Link                                                                                                                                                    |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Row list of builds with a status badge, counts, and filters | Argos                                                                              | There are many builds and the reader scans                  | The reader needs a priority order and gets none                                      | [Argos builds list](https://argos-ci.com/docs/learn/review-workflow/builds-list)                                                                        |
| P2  | Inbox in named sections for each next action                | Graphite, GitHub default filters                                                   | Entries are in several states at one time                   | There are one to three entries and the sections are overhead                         | [Graphite inbox](https://graphite.com/docs/use-pr-inbox)                                                                                                |
| P3  | Split inbox: list on the left, detail on the right          | Linear, Vercel                                                                     | Entries are small and many                                  | The detail needs the full width, as an image comparison does                         | [Linear inbox](https://linear.app/docs/inbox)                                                                                                           |
| P4  | One key for each triage verb                                | Linear Triage, GitHub (`E`), Chromatic (`a`, `d`), Argos (`Y`, `N`)                | Volume is high and there is undo                            | A wrong key has a permanent effect                                                   | [Linear triage](https://linear.app/docs/triage)                                                                                                         |
| P5  | Overview first, then one item page                          | Chromatic (Tests table, then snapshot page), BackstopJS, reg-cli                   | The reviewer wants the size of the work before the detail   | Each item costs two navigations                                                      | [Chromatic quickstart](https://www.chromatic.com/docs/quickstart/)                                                                                      |
| P6  | Fixed three-zone workspace with collapsible panels          | Percy, Argos, Visonaut                                                             | Builds are large and the image needs the space              | Panels cannot be collapsed                                                           | [Percy Reviews 2.0](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/)                                                                  |
| P7  | Thumbnail strip above the panes                             | Argos Journey                                                                      | Screens have an order and the neighbors give context        | There is one screen                                                                  | [Argos review](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                                                                          |
| P8  | 2-up side by side                                           | All tools                                                                          | The change is large or the layout moved                     | The change is one or two pixels                                                      | [GitHub](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files)                                            |
| P9  | Diff overlay on the new image, with a toggle                | Chromatic, Percy, Argos                                                            | The reviewer must see where and what at the same time       | The overlay color is close to the UI color (Percy says this in the highlighter page) | [Chromatic Diff Inspector](https://www.chromatic.com/docs/diff-inspector/)                                                                              |
| P10 | Swipe or slider                                             | GitHub, Playwright, reg-cli, BackstopJS                                            | Sizes differ, or a color shift is local                     | The change is spread over the full image                                             | [Playwright #13176](https://github.com/microsoft/playwright/issues/13176)                                                                               |
| P11 | Onion skin or blend with an opacity slider                  | GitHub, reg-cli                                                                    | "elements move around by small, hard to notice amounts"     | Content changed and the two layers become unreadable                                 | [GitHub](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files)                                            |
| P12 | Blink in place between old and new                          | Chromatic (`1` repeatedly, strobe), reg-cli Toggle, Percy and Argos (Left, Right)  | A small shift is the question. The eye sees motion at once. | Images have different sizes                                                          | [Chromatic quickstart](https://www.chromatic.com/docs/quickstart/)                                                                                      |
| P13 | Mask only                                                   | Playwright, reg-cli, BackstopJS, Visonaut                                          | The reviewer needs the extent of the change                 | The reviewer needs to know what the changed pixels are                               | [Playwright source](https://github.com/microsoft/playwright/blob/main/packages/web/src/shared/imageDiffView.tsx)                                        |
| P14 | Jump to the next changed region with automatic zoom         | Percy Diff Navigator, Argos (`J`, `K`, `H`), reg-cli markers, Chromatic focus mode | Changes are small in tall screenshots                       | The mask is noise and gives hundreds of regions                                      | [Percy diff highlighter](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/diff-highlighter)                    |
| P15 | Change location bar beside the image                        | Percy diff highlighter                                                             | Full-page screenshots                                       | Component screenshots that fit the pane                                              | same                                                                                                                                                    |
| P16 | Zoom and pan in sync across panes                           | Argos                                                                              | Always, when two panes are zoomed                           | Images have different sizes and need an anchor rule                                  | [Argos review](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                                                                          |
| P17 | Canvas theme toggle for the viewer                          | Percy (`T`)                                                                        | The screenshot has the same color as the app background     | Never harmful                                                                        | [Percy Reviews 2.0](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/)                                                                  |
| P18 | Approve the whole build                                     | Percy, Chromatic, Happo, Argos                                                     | Most changes come from one intended edit                    | One regression hides in 200 intended changes                                         | [Percy approval](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)                                    |
| P19 | Group identical diffs and decide one time                   | Percy, Argos                                                                       | A token or font change touches many screenshots             | The group cannot be split (Percy)                                                    | [Percy matching diffs](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/snapshot-grouping-with-matching-diffs) |
| P20 | Approval unit above the variant                             | Percy (snapshot), Chromatic (baseline across browsers)                             | Variants always change together                             | One browser regresses and the others are correct                                     | [Percy approval](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)                                    |
| P21 | Carry approvals to the next build                           | Percy, Chromatic, Argos, Visonaut (contract C02)                                   | The same diff appears again after a new push                | The carried diff is not exactly the same                                             | [Percy approval](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)                                    |
| P22 | A third verdict for noise: ignore, flaky, quarantine        | Argos, Chromatic, Happo                                                            | The diff does not come from the change under review         | An old ignore hides a real regression (Argos lists occurrences to counter this)      | [Argos ignored changes](https://argos-ci.com/docs/learn/reliability-and-flakiness/ignored-changes)                                                      |
| P23 | `?` opens the shortcut list                                 | Argos                                                                              | Always                                                      | Never harmful                                                                        | [Argos review](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                                                                          |
| P24 | Shortcuts stay off in text fields                           | Visonaut. reg-cli fixed it after a report.                                         | Always                                                      | It is forgotten                                                                      | [reg-cli-report-ui #22](https://github.com/reg-viz/reg-cli-report-ui/issues/22)                                                                         |
| P25 | Mode badge on each test, modes grouped                      | Chromatic                                                                          | Few modes for each story                                    | Many axes multiply the rows                                                          | [Chromatic modes](https://www.chromatic.com/docs/modes/)                                                                                                |
| P26 | Variant selector that marks where the change is             | Percy purple underline, Argos dot on journey steps                                 | A snapshot has many variants and few changed                | The marker has no legend                                                             | [Percy Reviews 2.0](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/)                                                                  |
| P27 | One progress chip                                           | Argos "2 / 3 reviewed"                                                             | The reviewer needs one number                               | Rejected and approved must be told apart                                             | [Argos review](https://argos-ci.com/docs/learn/review-workflow/review-a-build)                                                                          |
| P28 | Collapsed section for low-priority entries                  | Chromatic "Unstable", reg-cli PASSED, Visonaut "Accepted"                          | The main list must stay short                               | The reviewer never opens the section                                                 | [Chromatic quarantine](https://www.chromatic.com/docs/quarantine-tests/)                                                                                |
| P29 | Sort by change size                                         | Argos, Percy                                                                       | A few large changes hide among many small ones              | Small changes are the regressions                                                    | [Argos #1722](https://github.com/argos-ci/argos/issues/1722)                                                                                            |
| P30 | Comment pinned to a pixel, with threads                     | Argos, Chromatic, Vercel                                                           | Several people review                                       | One maintainer decides alone                                                         | [Vercel comments](https://vercel.com/docs/comments/using-comments)                                                                                      |
| P31 | A rejection writes a comment for the author                 | Percy                                                                              | The author is not the reviewer                              | The conversation already lives in the pull request                                   | [Percy request changes](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/change-request)                       |
| P32 | One pull request comment, edited in place, with counts      | Argos, Chromatic                                                                   | The author stays in GitHub                                  | The comment adds noise to small pull requests                                        | [Argos PR comments](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments)                                                              |
| P33 | Review locked to the latest build of a branch               | Chromatic, Visonaut ("A superseded attempt cannot accept review commands")         | Always for baselines                                        | The lock is not explained                                                            | [Chromatic quickstart](https://www.chromatic.com/docs/quickstart/)                                                                                      |

## Findings

### BENCH-01 · The review page gives the screenshots less than a third of the viewport

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence: Measurement M1. At 1440 x 900 on `http://127.0.0.1:4310/runs/00000000-0000-4000-8000-000000000001` the first image pixel is at `y = 449`, the visible image area is 29.7% of the viewport, and the two pane boxes are 42.7%. At 1920 x 1080 the image area is 24.7%. The document is taller than the viewport (`scrollHeight` 1035 for 900). The pane height has a hard cap: `components/screenshot-viewer.tsx:134` has `className="review-image-viewport relative h-[min(56vh,650px)] min-h-80 overflow-auto p-4.5 ..."`. The rows above the image are `review/review-workspace.tsx:563` (`<ShellMainHeader $height="sm" $border>`), `:609` (`<ShellMainIntro className="py-0! border-b border-(--ak-edge)">`), `:634` (`review-result-heading`), `:728` (`aria-label="Variants"`), `:832` (`aria-label="Image view"`), and `components/screenshot-viewer.tsx:92-95` (the `figcaption` with `min-h-12`). Screenshots `screens/04-run-dark-1440.png` and `screens/05-workspace-fixture-dark-1440.png`.
- What happens: Seven rows of chrome come before the pixels: app header, run header, identity row, item heading, variant strip, toolbar, pane caption. A sticky action bar of about 60 px covers the bottom. The page also scrolls as a document, so the footer with keyboard help is below the fold.
- Impact: The product exists to compare pixels, and half of the first screen is labels. Each pane is 591 px wide at 1440, so a 1280 x 720 capture is scaled to about 555 px. Small regressions get harder to see. This matches the maintainer's statement that the UI is "bloated with text".
- Recommendation: Make the run page a fixed-height workspace where the viewer takes all remaining height. Merge the identity row, the item heading, and the toolbar into one bar. Remove the `min(56vh,650px)` cap.

  ```tsx
  // Sketch. One 40px bar replaces three rows. The viewer fills the rest.
  <ShellMain className="grid h-dvh grid-rows-[auto_auto_1fr_auto]">
    <RunBar /> {/* Queue · #5121 title · progress chip · details · help */}
    <ViewerBar /> {/* item › variant · 0.05% · modes · zoom · region 1/3 */}
    <ScreenshotViewer className="min-h-0" />
    <ActionBar />
  </ShellMain>
  ```

- Alternatives: (a) Minimal: remove the height cap and hide the identity row behind **Details**. (b) A focus mode key that hides the sidebar, the app header, and the variant strip. Percy does this with collapsible panels. (c) Keep the layout and move the item heading into the sidebar selection.
- Maintainer decision needed: yes. Contract row U02 selects "one review shell". Does a fixed-height workspace count as the same shell, and may the commit, attempt, and baseline revision move behind **Details**?

### BENCH-02 · The viewer cannot overlay, swipe, or blink the two images

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `review/model.ts:2` has `export type ReviewMode = "side" | "diff" | "new" | "original";`. The toolbar in `screens/05-workspace-fixture-dark-1440.png` shows the four buttons Compare, Difference, Current, Baseline. In diff mode the pane shows the mask alone: `components/screenshot-viewer.tsx:236` hides the candidate with `hidden={mode === "diff" || mode === "original"}`. The mask is transparent outside the changed pixels (`packages/cli/src/png-comparison.ts:74`, `diffMask: true`). Prior art in section 2.3: GitHub has swipe and onion skin, Playwright has Slider, reg-cli has Slide, Blend, and Toggle, Chromatic has 1 Up with diff overlay and strobe, Percy and Argos have a diff overlay toggle.
- What happens: To answer "what changed here", the reviewer must look at the mask, remember the place, switch to side by side, and find the place again in two panes. No mode shows the changed pixels on top of the page they belong to. No mode puts old and new in the same place.
- Impact: Shifts of one or two pixels and small color changes are the common regressions in a component library. Side by side is the weakest mode for them. Playwright users asked for a slider for this reason ([#13176](https://github.com/microsoft/playwright/issues/13176)).
- Recommendation: Add three modes in the design lab and compare them: overlay (mask tinted over Current, with an opacity control), swipe (one pane, a draggable divider), and blink (one pane, a key flips Baseline and Current). All three need only the three images that the API already returns.

  ```tsx
  // Overlay sketch. The mask alpha selects the changed pixels, so any tint works.
  <div className="relative">
    <img src={variant.candidate.url} alt="Current" />
    <div
      aria-hidden
      className="absolute inset-0 bg-(--diff-tint) opacity-(--diff-opacity)"
      style={{ maskImage: `url(${variant.diff.url})`, maskSize: "100% 100%" }}
    />
  </div>
  ```

- Alternatives: (a) Minimal: keep four modes and make `D` a toggle that draws the mask over Current instead of replacing it. (b) Replace the "Current" and "Baseline" single modes with one blink mode where Left and Right flip the image, as Percy and Argos do. This conflicts with the current Left and Right keys for variants. (c) Add all of GitHub's three modes and keep mask only.
- Maintainer decision needed: yes. Contract row P02 says "Load diff when selected". An overlay that is on by default loads the mask for every selected variant, one more image request for each selection. Is that acceptable?

### BENCH-03 · Zoomed panes scroll separately, so a zoomed comparison shows two different regions

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: Measurement M4. At 200% I clicked **Pan Reference right** and **Pan Reference down**. The reference pane moved to `scrollLeft: 296, scrollTop: 252`. The candidate pane stayed at `scrollLeft: 0, scrollTop: 0`. Screenshot `screens/24-workspace-200-after-pan-dark-1440.png` shows the Done button on the left and the top-left corner on the right. Code: each pane owns its position, `components/screenshot-viewer.tsx:35` `const position = useRef({ left: 0, top: 0 });`, and its own handler, `:138-144`. Zoom is three fixed steps, `review/model.ts:3`. Panning is four buttons for each pane, `components/screenshot-viewer.tsx:108-130`.
- What happens: After a zoom, the reviewer must pan each pane by hand to the same place. In side-by-side mode that is eight buttons. There is no drag to pan and no wheel or pinch zoom.
- Impact: Zoom is the tool for small changes, and it is the mode where the two panes stop matching. Argos documents the opposite behavior: "zoom and pan stay in sync between the baseline and changes panes" ([Review a build](https://argos-ci.com/docs/learn/review-workflow/review-a-build)).
- Recommendation: Keep one shared `{ x, y, scale }` state in `ScreenshotViewer` and apply it to every visible pane. Add drag to pan and `Ctrl`+wheel zoom at the pointer. Keep the pan buttons for keyboard users, one set for the viewer.

  ```tsx
  // Sketch. One transform for all panes.
  const [view, setView] = useState({ x: 0, y: 0, scale: "fit" as ReviewZoom });
  <ImagePane image={variant.reference} view={view} onViewChange={setView} />
  <ImagePane image={variant.candidate} view={view} onViewChange={setView} />
  ```

- Alternatives: (a) Minimal: mirror `scrollLeft` and `scrollTop` from the pane that scrolls to the other pane. (b) A "lock panes" toggle that is on by default. (c) Replace 2-up zoom with a magnifier lens that follows the pointer in both panes, as Chromatic does in focus mode.
- Maintainer decision needed: yes. Contract row U04 selects "Page-wide review arrows with pan buttons". May drag and wheel be added beside the buttons?

### BENCH-04 · Nothing shows where the change is inside the image

- Kind: ux
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence: The only numbers are location-free, in `review/review-workspace.tsx:643-648`: `{variant.ratio != null ? (variant.ratio * 100).toFixed(2) + "% changed · " : ""}` and `{variant.changedPixels?.toLocaleString() ?? "—"} changed pixels`. The fixture shows "0.05% changed · 120 changed pixels" (`screens/05-workspace-fixture-dark-1440.png`). No code reads the mask pixels: `rg -n -i "region|bounding|minimap" review components/screenshot-viewer.tsx --glob '!**/__tests__/**'` in `apps/web/src` matches only an ARIA `role="region"` (`review/review-workspace.tsx:1026`) and list scroll math (`review/item-list.tsx:161-162`). Prior art: Percy has a "static bar alongside a new image showing where changed areas are located" and a navigator that "auto-zooms on each difference". Argos has `H` to highlight and `J`, `K` to step. reg-cli has markers on `m`.
- What happens: The reviewer knows that 120 pixels changed and must find them by eye or by switching to the mask.
- Impact: A 120 pixel change in a 600 x 400 image is 0.05% of the area. In a 1280 x 720 capture the same change is a dot. Argos users asked for exactly this feature ([#1242](https://github.com/argos-ci/argos/issues/1242)).
- Recommendation: Scan the mask in the browser when it loads, merge changed pixels into a few boxes, and offer three things: an outline for each box, a "next change" key that centers and zooms the box, and a thin location rail beside the pane.

  ```ts
  // Sketch. Row and column scan of the mask alpha channel on a canvas.
  function changedRegions(mask: ImageData, gap = 12): DOMRect[] {
    // 1. collect rows that contain alpha > 0, 2. split at gaps > `gap`,
    // 3. for each row band repeat for columns, 4. return the boxes.
  }
  ```

- Alternatives: (a) Minimal: when the mask loads, fit the viewer to the one bounding box of all changed pixels with a margin. (b) Compute the boxes in the CLI at compare time and store them with the row. This needs a protocol change. (c) A pulse animation on the changed pixels for one second after selection, like Chromatic strobe.
- Maintainer decision needed: yes. Is the cost of one mask request for each selected variant acceptable (same question as BENCH-02), and which keys should step through regions? `J` and `K` are free today.

### BENCH-05 · The variant strip hides the verdict and holds three variants

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence: Measurement M5. In the fixture item with seven variants, the strip is 1120 px wide and its content is 2079 px wide. Three of seven pills are fully visible. Each pill is 265 to 307 px wide. `review/variant-summary.tsx:66-137` renders icons, labels, a title, and the index digit, and no status element. The verdict exists only in the tooltip and the accessible name: `review/review-workspace.tsx:747` ``title={`${entry.label} · ${verdictLabel(entry)}`}``. Screenshot `screens/17-workspace-after-approve-dark-1440.png` was taken after two approvals. Pills 1 and 2 (approved) look the same as pill 4 (pending). Every pill repeats "Chromium · Light · 1280 x 720" (`screens/14-workspace-variant-strip-dark-1440.png`). The digit keys stop at six: `review/review-workspace.tsx:424` `/^[1-6]$/.test(key)`.
- What happens: The reviewer cannot see which variants are done, which changed, or how many exist without scrolling the strip. Text that is the same for every variant fills most of each pill.
- Impact: Ariakit variants have five named axes plus a key (`apps/web/src/api/review.ts:469-481`). The strip does not scale to that. Percy solved the same problem with a marker: "A purple underline guides you precisely to the browser-width combo where a change has been detected" ([Visual Reviews 2.0](https://www.browserstack.com/blog/introducing-visual-reviews-2-0/)). Argos puts a dot on steps that need review.
- Recommendation: Put the state in the pill and remove the shared text. Show only the parts that differ between the variants of this item. Show the shared parts one time in the viewer bar.

  ```tsx
  // Sketch. `shared` and `differing` come from labelParts of all variants.
  <Nav $layout="horizontal" aria-label="Variants">
    {item.variants.map((entry, index) => (
      <NavLink key={entry.id} aria-current={entry.id === variant.id ? "page" : undefined}>
        <ButtonSlot><VerdictDot variant={entry} /></ButtonSlot>
        <ButtonLabel>{differing(entry).join(" · ")}</ButtonLabel>
        {index < 9 && <ButtonSlot $kind="shortcut">{index + 1}</ButtonSlot>}
      </NavLink>
    ))}
  </Nav>
  <Text className="text-xs ak-ink-60">{shared.join(" · ")}</Text>
  ```

- Alternatives: (a) Minimal: add a status dot and a count such as "3 of 7 done" to the strip. (b) A matrix: rows for framework and browser, columns for scheme and contrast, one status cell for each variant. (c) A vertical variant list as a second column of the sidebar. (d) A thumbnail filmstrip with a diff tint, like the Argos journey strip.
- Maintainer decision needed: yes. Contract row U03 selects "item links and variant tabs". May the tabs become a matrix or a filmstrip in the exploration?

### BENCH-06 · The queue uses a 240 px card for 22 words and states each count three times

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence: Measurement M3 with nine mocked runs. Each "Ready to review" card is 240 px high and holds 21 to 24 words. The first card starts at `y = 361`. Two cards are fully visible at 1440 x 900. The page is 1768 px for seven actionable runs. The history table shows the same runs at 64 px for each row, with nine rows visible. Code: `routes/index.tsx:475-484` `<Frame ... $rounded="2xl" $p={6} render={<article />} className="grid gap-5">`. The same fact appears in `:436-437` ("N runs are ready for review."), `:452` ("Runs to review"), and `:471` ("Ready to review"). The pending count appears in `:453` ("Awaiting approval") and `:502` ("N views await approval"). Screenshots `screens/18-inbox-many-runs-dark-1440.png` and `screens/01-inbox-dark-1440.png`.
- What happens: The first 361 px are a heading, a sentence, and three stat tiles. Then each run takes a quarter of the screen. The "In progress" and "Needs attention" rows already use a compact 64 px row with the same data.
- Impact: With four runs the reviewer scrolls to see the queue. The three tiles repeat the section counts. This is the "bloated with text" complaint in its clearest form. Argos lists one row for each build with a status, counts, pull request data, commit, and time. Graphite uses section titles as the counts.
- Recommendation: One dense row for each run, grouped in sections whose headers carry the counts. Remove the tiles and the sentence. Make the whole row the link.

  ```text
  Review queue                                     ariakit/ariakit · baseline 312
  NEEDS REVIEW  4
  ● #5121  Add Dialog focus trap option        14 to review              38 min
  ● #5118  Update Menu arrow placement          6 to review · 2 rejected  1 h  · attempt 3
  ● #5102  Refactor Combobox popover sizing    41 to review              2 h
  ✕ #5097  Tooltip delay tokens                 3 rejected                2 h
  RUNNING  2
  ◐ #5125  Tabs overflow scroll buttons        comparing                 3 h
  ◐ #5126  Select typeahead timeout            waiting for screenshots   4 h
  FAILED  1
  ! #5090  Checkbox indeterminate icon         run failed                5 h  · attempt 2
  ```

- Alternatives: (a) Minimal: reuse the existing `RunGroup` row (`routes/index.tsx:560-603`) for "Ready to review" and delete the tiles. (b) Merge the queue and the history into one table with a state filter that starts on "Needs review". (c) A split view with a preview of the top changed thumbnails for the selected run (pattern P3). (d) Keep cards and reduce each to two lines.
- Maintainer decision needed: yes. Contract row U05 selects "List review work first with a history view". Should the queue and the history stay two views, or become one list with a filter?

### BENCH-07 · The dashboard has no keyboard flow

- Kind: ux
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence: `rg -n 'onKeyDown|keydown|key ===' routes/index.tsx 'routes/pulls.$pullNumber.tsx' 'routes/runs.$runId.tsx' components/operations-attention review/item-list.tsx` in `apps/web/src` matches only `review/item-list.tsx:316-330` (M6). The other handler is `review/review-workspace.tsx:395-442`. The run page has `Queue` as a link (`review/review-workspace.tsx:580-585`) and no key for it.
- What happens: The review page is keyboard-first. The page before it needs Tab and Enter, or the mouse. There is no key to go back to the queue and no key to open the next run after the last decision.
- Impact: The keyboard flow breaks at each run boundary. Linear uses `J`, `K`, and `G` then `I`. GitHub uses `G` `N` and `E`. Chromatic uses `Esc` for "Back to build".
- Recommendation: Add `J` and `K` or the arrows to move in the queue, `Enter` to open, a key on the run page to return, and an "open next run" action when no variant is pending.
- Alternatives: (a) Minimal: focus the first run link on load, so `Enter` opens it. (b) A command palette on `Cmd+K`, as Graphite has. (c) Wrap the queue rows in an Ariakit composite, as `review/item-list.tsx:191` already does for items.
- Maintainer decision needed: yes. Contract row D10 says "Keep the component set, keyboard behavior". Are new keys on the dashboard inside that rule?

### BENCH-08 · One decision stops at one item, and equal diffs are not grouped

- Kind: ux
- Severity: medium. Confidence: medium. Measured: no. Effort: L
- Evidence: The widest scope is the item: `review/review-workspace.tsx:1055` `<ButtonLabel>All {targets.length} changed views…</ButtonLabel>` and `review/navigation.ts:49-54` `reviewTargets(item)`. The client command shape has one optional item key: `review/model.ts:115` `wholeItemKey?: string;`. I did not read the server validation of that field. Screenshot `screens/10-workspace-whole-item-menu-dark-1440.png`. No code compares diffs between variants or items. Prior art in section 2.4: Percy has three scopes and groups equal diffs at the top of the list, Chromatic has "accept all", "deny all", and "mark all unreviewed", Happo decides the whole report.
- What happens: A token change that moves 40 items by the same pixels needs 40 whole-item commands, each with a confirmation dialog.
- Impact: Large intended changes are slow to approve. The risk goes the other way too: a run-level approve can hide one regression. A Playwright user names that risk: "Because updating is run-level, other changed snapshots can be updated before users have reviewed them" ([#42393](https://github.com/microsoft/playwright/issues/42393)). Public demand for wider scope also exists ([Argos #1384](https://github.com/argos-ci/argos/issues/1384), [Argos #884](https://github.com/argos-ci/argos/issues/884), [reg-suit #203](https://github.com/reg-viz/reg-suit/issues/203)).
- Recommendation: Explore two things in the lab. First, a multi-select in the item list with one command for the selection. Second, a "same change" group: variants whose masks are equal share one mask digest, so the group is exact and needs no fuzzy matching.

  ```ts
  // Sketch. The mask image id is its digest, so equal masks share an id.
  const groups = Map.groupBy(
    items.flatMap((item) => item.variants.filter(needsReview)),
    (variant) => variant.diff?.digest ?? variant.id,
  );
  ```

- Alternatives: (a) Minimal: remove the confirmation dialog for `Shift+A` because Undo exists, and keep the dialog for the mouse path. (b) A run-level "Approve remaining (N)" that is enabled only after the reviewer has opened every item. (c) No change, and state in the guide that the item is the largest unit by design.
- Maintainer decision needed: yes. Is a decision wider than one item acceptable for baseline safety? This needs an API decision too. I did not verify that equal masks get equal digests across variants in production data.

### BENCH-09 · The item list cannot sort by change size or filter by kind or axis

- Kind: ux
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence: Order is the declared order inside two groups: `review/navigation.ts:37-41` loops `for (const [index, item] of items.entries())` and pushes in that order. The filter has four status values: `review/screenshot-filter.tsx:17-22` (`all`, `pending`, `approved`, `rejected`). The data for a sort is already in the model: `review/model.ts:37` `changedPixels?: number;` and `:40` `ratio?: number;`. The kinds are in `review/model.ts:28`.
- What happens: A run with many small changes and three large ones shows them in declared order. The reviewer cannot ask for "added only", "removed only", "Safari only", or "largest first".
- Impact: This is the exact report in [Argos #1722](https://github.com/argos-ci/argos/issues/1722): 248 changed files, "3 major changes ... difficult to find manually". Argos shipped the sort. Percy has "Diff % (High to Low)" and filters for width and browser.
- Recommendation: Add a sort control (Declared, Largest change, Name) and filter chips for kind (changed, added, removed) and for each axis value that exists in the run. Show the largest ratio of the item as a small bar in the row.
- Alternatives: (a) Minimal: sort the attention group by the largest `ratio` of each item and keep no control. (b) Keep the order and add a "jump to largest change" key. (c) A grid overview where tile tint shows change size.
- Maintainer decision needed: yes. Is the declared order part of the review contract (contract row U03), or can the default order change?

### BENCH-10 · The run page states the review status four times

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: Measurement M2, visible text of the preview run page: `Dialog | 2 of 2 need review | Queue | Dialog review example | 2 | of | 2 | need review | ... | Changes need review | Dialog | Needs review`. The four sources are `review/item-list.tsx:256` (`${pending} of ${entry.variants.length} need review`), `review/review-workspace.tsx:597` (`{pending} of {total} need review`), `:620` (`<span className="ml-auto">{runStatus}</span>`), and `:642` (`<ReviewStatus variant={variant} />`). A colored dot in the sidebar row (`review/item-list.tsx:270-272`) and a progress bar (`review/review-workspace.tsx:599-604`) repeat it two more times without words. The page has 97 visible words and 26 controls for a run with one item.
- What happens: Sidebar text, header text, identity row text, badge, dot, and bar all say "needs review".
- Impact: The reader cannot tell which status is for the run, the item, or the variant, and the screen looks busy. Argos uses one chip, "2 / 3 reviewed".
- Recommendation: One status for each level and one place for each. Run level: a segmented progress chip in the run bar. Item level: a count and a dot in the sidebar row. Variant level: the dot in the variant pill (BENCH-05). Remove the run status text in the identity row when it only repeats the chip.

  ```tsx
  // Sketch. Upstream has a Progress primitive that the vendored copy lacks.
  <Badge aria-label={`${done} of ${total} reviewed, ${rejected} rejected`}>
    <BadgeSlot>
      <SegmentBar approved={approved} rejected={rejected} total={total} />
    </BadgeSlot>
    <BadgeLabel className="tabular-nums">
      {done}/{total}
    </BadgeLabel>
  </Badge>
  ```

- Alternatives: (a) Minimal: delete the header text "N of M need review" and keep the bar with an accessible label. (b) Keep all and reduce contrast of the secondary ones. (c) Replace words with icons that have tooltips.
- Maintainer decision needed: no.

### BENCH-11 · Three vocabularies name the same four image modes, and the guide uses labels that the UI does not have

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: Buttons: `review/review-workspace.tsx:845` `Compare`, `:860` `Difference`, `:874` `Current`, `:888` `Baseline`. Help dialog: `:175` `Side by side, red pixel diff, new image only, or original only.` Pane labels for assistive technology: `components/screenshot-viewer.tsx:218` `label="Reference"`, `:229` `label="New image"`, `:245` `label="Pixel diff · red pixels changed"`. Visible captions: `:38` `"Baseline" ... "Current" ... "Difference"`. Guide: `docs/review-guide.md:31-34` `Side by side, S`, `Pixel diff, D`, `New only, F`, `Original only, G`. The guide also says `docs/review-guide.md:92` "Use **All runs** to return to the dashboard" where the UI says `Queue` (`review/review-workspace.tsx:584`), and `docs/review-guide.md:15` "The Runs page" where the UI says "Review queue" and "Run history". The shortcut letters `F` and `G` come from no label in use.
- What happens: A pane has the caption "Baseline" and the accessible name "Reference". The guide tells the reader to press a button that has another name.
- Impact: Low for a daily user. It costs a new maintainer time, and a screen reader user hears a different word than a sighted user reads. Other tools pick one pair and keep it: Argos "baseline" and "changes", Playwright "Expected" and "Actual", BackstopJS "Reference" and "Test".
- Recommendation: Choose one pair, for example Baseline and Current, and one name for each mode. Use them in buttons, captions, accessible names, the help dialog, and the guide.
- Alternatives: (a) Update only the guide. (b) Rename modes to the GitHub terms (2-up, swipe, onion skin) if those modes are added.
- Maintainer decision needed: yes. Which pair is canonical: Baseline and Current, or Reference and New image?

### BENCH-12 · `?` does not open the shortcut list, and its button is below the fold

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: Measurement M4. At 1440 x 900 the **Keyboard help** button is at `top: 985` in the fixture and `top: 996` in the preview app. The viewport is 900 high. The handler `review/review-workspace.tsx:395-442` has no branch for `?`, and `rg -n '"\?"|Kbd' review/review-workspace.tsx` has no match. The button is in the footer, `:1172-1178`. The list is plain `dt` text (`:165-181`). Screenshot `screens/11-workspace-full-page-dark-1440.png`.
- What happens: A new reviewer sees letters on some buttons and has no visible way to the full list. Arrow keys, `1` to `6`, `Shift+A`, `Cmd/Ctrl+Z`, and `[` are not shown on any control.
- Impact: The strongest feature of the page is hard to find. Argos documents "Press `?` on a build page to see the full list of shortcuts".
- Recommendation: Bind `?` to the help dialog and put a `?` button in the run bar. Use the vendored `Kbd` primitive in the list. Group the list by task: move, look, decide.
- Alternatives: (a) Minimal: bind `?` only. (b) Show a one-line key legend in the action bar. (c) A command palette that lists every action with its key.
- Maintainer decision needed: no.

### BENCH-13 · A rejection has no reason, and there is no place for a note

- Kind: ux
- Severity: low. Confidence: medium. Measured: no. Effort: L
- Evidence: `review/model.ts:109-120` defines `ReviewCommand` with `verdict`, `targets`, and revision fields. It has no text field. The reject button sends the verdict only (`review/review-workspace.tsx:1077`). Prior art: Percy creates "a time-stamped comment ... on your behalf" for a change request and suggests an @mention ([Request changes](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/change-request)). Argos has a review summary and comments pinned to a pixel. Chromatic pairs a deny with a discussion "pinned to a specific change". Lost Pixel described reject as "done for informational purposes to identify for future reviewers".
- What happens: The pull request author sees a failed check and "Rejected" on a variant. The reason must travel through another channel.
- Impact: Small for one maintainer who reviews their own work. Larger when the author is an outside contributor. I did not verify how often that is the case for Ariakit.
- Recommendation: Explore an optional one-line note on reject in the lab, shown beside the variant and in the check summary. Do not add threads.
- Alternatives: (a) No change, and rely on the pull request conversation. (b) A "copy link to this variant" button so the reviewer can paste it in a pull request comment (Argos has "Copy link" and "Copy embed as Markdown"). This needs no backend change because the URL already holds the item and the variant. (c) Pinned comments.
- Maintainer decision needed: yes. Should Visonaut store reviewer text at all? The guide says "Labels, verdicts, audit data ... remain private".

### BENCH-14 · Noise has no verdict of its own

- Kind: ux
- Severity: low. Confidence: medium. Measured: no. Effort: XL
- Evidence: `review/model.ts:1` has `export type ReviewVerdict = "approved" | "rejected";`. Prior art: Argos has **Ignore** on `I`, automatic ignore after a number of occurrences, and an **Ignored** tab with "Occurrences" and "Last seen". Chromatic has ignore for one build, automatic ignore by the flake filter, and quarantine, all in a collapsed "Unstable" section. Happo has "Report flake" and an "Ignored diffs" list.
- What happens: A diff that the change under review did not cause has two outcomes. Approve moves the baseline to the noisy image. Reject fails the check.
- Impact: I did not measure how often noise occurs in Ariakit runs. The adapter handles stability at capture time (`README.md:35` names "stability, and retries"), so the need can be small.
- Recommendation: Record this as a pattern that three products converged on. Decide after there is data on how many decisions in production are "approve to get rid of noise".
- Alternatives: (a) A read-only "seen before" hint when the same mask digest was approved in an earlier run. (b) A third verdict "skip for this run" that neither promotes nor fails. (c) No change.
- Maintainer decision needed: yes. Is a noise verdict in scope for Visonaut, given the capture-side stability work?

## Redesign ideas

The list is ranked. The order uses three tests: it answers a maintainer complaint, more than one product converged on it or public demand exists, and the lab can build it with fixture data. "Backend" marks an idea that the real app cannot ship without an API change.

### 1. Viewer-first workspace

- Maps to: run page layout. Findings BENCH-01, BENCH-10.
- What changes: A fixed-height page. One run bar, one viewer bar, the viewer, one action bar. No document scroll.
- Why it is better: The image area grows from about 30% to more than 60% of a 1440 x 900 viewport (estimate from the row heights, not measured). Percy and Argos use this shape.
- Sketch:

  ```text
  +--------------------------------------------------------------------------------+
  | < Queue   #5121 Add Dialog focus trap      [###--------] 3/11      Details   ? |  40
  +---------------+----------------------------------------------------------------+
  | NEEDS REVIEW 3| Success dialog > React  ● ○ ○ ○ ○ ○ ○     0.05%   change 1/3 > |  36
  | ▣ Success   7 | [2-up] Overlay  Swipe  Blink            Fit 100% 200%   canvas |  36
  | ▣ Open menu 2 +-------------------------------+--------------------------------+
  | ▣ New item  + | Baseline                      | Current                        |
  | ACCEPTED 1  > |                               |                                |  fills
  |               |                               |                                |
  |               +-------------------------------+--------------------------------+
  |               | Undo            Item (7) v              Reject  X    Approve A |  48
  +---------------+----------------------------------------------------------------+
  ```

### 2. Overlay mode with tint and opacity

- Maps to: screenshot viewer. Finding BENCH-02.
- What changes: The mask is drawn over Current. A slider sets opacity. A swatch sets the tint. `D` toggles the overlay in every mode.
- Why it is better: The reviewer sees where and what in one image. Chromatic, Percy, and Argos all have it. The stored mask already supports it.
- Sketch: see the JSX in BENCH-02.

### 3. Swipe mode

- Maps to: screenshot viewer. Finding BENCH-02.
- What changes: One pane. Baseline on the left of a divider, Current on the right. Drag the divider or use Left and Right on a focused slider.
- Why it is better: GitHub, Playwright, reg-cli, and BackstopJS use it. It works when sizes differ, where the mask does not exist.
- Sketch:

  ```tsx
  <div className="relative" style={{ "--split": `${split}%` } as CSSProperties}>
    <img src={reference.url} alt="Baseline" />
    <img
      src={candidate.url}
      alt="Current"
      className="absolute inset-0 [clip-path:inset(0_0_0_var(--split))]"
    />
    <input
      type="range"
      min={0}
      max={100}
      value={split}
      aria-label="Swipe position"
      onChange={(event) => setSplit(event.currentTarget.valueAsNumber)}
      className="absolute inset-x-0 top-0 h-full opacity-0 cursor-ew-resize"
    />
  </div>
  ```

### 4. Blink mode

- Maps to: screenshot viewer. Finding BENCH-02.
- What changes: One pane at full width. Hold a key to show Baseline, release to show Current. A small label in the corner names the image.
- Why it is better: Motion shows a one pixel shift at once. Chromatic ("Pressing 1 multiple times"), reg-cli Toggle, Percy, and Argos have it. It doubles the image size compared with 2-up.
- Sketch:

  ```text
  +--------------------------------------------------------------+
  | CURRENT                                     hold Space: base |
  |                                                              |
  |                  [ one image, full width ]                   |
  +--------------------------------------------------------------+
  ```

### 5. Changed-region navigator

- Maps to: screenshot viewer. Finding BENCH-04.
- What changes: Boxes around changed regions, a counter "change 1/3", keys to step, automatic zoom to the box, and a location rail at the pane edge.
- Why it is better: Percy and Argos both ship it, and Argos users asked for it. It removes the search for small changes.
- Sketch:

  ```text
  | Current                                     |#|   rail: one tick for each region
  |        +-------+                            | |
  |        | 1     |                            |#|
  |        +-------+                            | |
  |                              +----+         | |
  |                              | 2  |         |#|
  ```

### 6. One shared zoom and pan

- Maps to: screenshot viewer. Finding BENCH-03.
- What changes: One transform for all panes. Drag to pan. `Ctrl`+wheel to zoom at the pointer. Zoom steps Fit, 100%, 200%, 400%.
- Why it is better: The two panes always show the same region. Argos documents this behavior.
- Sketch: see the JSX in BENCH-03.

### 7. Dense queue rows in sections

- Maps to: dashboard queue. Finding BENCH-06.
- What changes: One 40 to 48 px row for each run. Section headers carry the counts. No tiles, no sentence.
- Why it is better: About five times more runs fit on one screen (240 px card against a 48 px row). Argos and Graphite use rows.
- Sketch: see the text block in BENCH-06, and:

  ```tsx
  <Table aria-label="Review queue">
    <TableRowGroup>
      {runs.map((run) => (
        <TableRow key={run.id}>
          <TableCell>
            <StateDot state={run.state} />
          </TableCell>
          <TableCell>
            <Text className="tabular-nums ak-ink-60">#{run.pullRequestNumber}</Text>
          </TableCell>
          <TableCell>
            <Link to="/runs/$runId" params={{ runId: run.id }}>
              {run.title}
            </Link>
          </TableCell>
          <TableCell>
            <Text className="tabular-nums">{run.pending} to review</Text>
          </TableCell>
          <TableCell>
            <Text render={<time />} className="ak-ink-60">
              {age(run.createdAt)}
            </Text>
          </TableCell>
        </TableRow>
      ))}
    </TableRowGroup>
  </Table>
  ```

### 8. Variant pills that carry state and drop shared text

- Maps to: variant tabs. Finding BENCH-05.
- What changes: A status dot in each pill. Only the differing parts as text. The shared parts one time in the viewer bar.
- Why it is better: Seven variants fit where three fit now. The reviewer sees progress inside the item. Percy and Argos mark the variants that changed.
- Sketch: see the JSX in BENCH-05, and:

  ```text
  Chromium · 1280 x 720     (● React Light 1) (✓ React Dark 2) (✓ Solid Light 3) (○ Solid Dark 4)
  ```

### 9. Variant matrix

- Maps to: variant selector, as an alternative to idea 8. Finding BENCH-05.
- What changes: A small grid. Rows are framework and browser. Columns are color scheme and contrast. Each cell is a status mark. Arrow keys move in two dimensions.
- Why it is better: The axes are already structured (`labelParts`). A matrix shows a pattern at a glance, for example "only Safari changed". No tool in this research has it, so it is a point where Visonaut can be better than the prior art.
- Sketch:

  ```text
                    Light   Dark   Contrast
  React  Chromium    ●       ✓       ○
  React  Safari      ○       ○       ○
  Solid  Chromium    ✓       ✓       ·        · = no capture
  ```

### 10. Contact sheet for an item or a run

- Maps to: a new overview state of the run page. Findings BENCH-08, BENCH-09.
- What changes: A grid of thumbnails with the mask tinted on top. Click opens the viewer. Shift-click selects several. A bar acts on the selection.
- Why it is better: reg-cli and BackstopJS start with a grid, and Chromatic starts with a table. It answers "how big is this run" before the first decision and gives a natural multi-select.
- Sketch:

  ```text
  Success dialog (7)                               [ Approve selected (3) ]
  +------+ +------+ +------+ +------+ +------+ +------+ +------+
  |▒ ●   | |▒ ●   | |  ✓   | |▒ ●   | |▒ ●   | |▒ ●   | |▒ ●   |
  +------+ +------+ +------+ +------+ +------+ +------+ +------+
   React    Solid    Dark     Contrast Firefox  WebKit   Wide
  ```

### 11. Sort by change size and filter chips

- Maps to: item list. Finding BENCH-09.
- What changes: A sort menu and chips for kind and axis. A two pixel bar in each row shows the relative change size.
- Why it is better: Argos shipped it on user demand. Percy has it. The data is in the model.
- Sketch:

  ```text
  [ Largest change v ]  (changed 9) (added 1) (removed 1)  (Safari) (Dark)
  ▣ Open menu        ██████░░  2
  ▣ Success dialog   █░░░░░░░  7
  ```

### 12. Scope picker in the action bar

- Maps to: action bar. Finding BENCH-08.
- What changes: One control that names the scope of the next decision: This variant, This item (7), Selected (3), Same change (6). The approve and reject buttons show the count.
- Why it is better: Percy names three scopes in its documentation. One place for scope removes the separate "All N changed views…" menu and its dialog.
- Sketch:

  ```tsx
  <ButtonGroup aria-label="Decision scope">
    <Button aria-pressed={scope === "variant"}><ButtonLabel>Variant</ButtonLabel></Button>
    <Button aria-pressed={scope === "item"}><ButtonLabel>Item ({targets.length})</ButtonLabel></Button>
    <Button aria-pressed={scope === "same"}><ButtonLabel>Same change ({same.length})</ButtonLabel></Button>
    <ButtonGlider />
  </ButtonGroup>
  <Button $layer="primary"><ButtonLabel>Approve {count}</ButtonLabel><ButtonSlot $kind="shortcut">A</ButtonSlot></Button>
  ```

### 13. Same-change groups

- Maps to: item list and action bar. Finding BENCH-08. Backend for decisions wider than one item.
- What changes: Variants with an equal mask form one group at the top of the list: "Same change in 6 variants".
- Why it is better: Percy and Argos both built it. One decision covers a token change.
- Sketch:

  ```text
  SAME CHANGE
  ▣▣▣ 2 px shift of the focus ring      6 variants in 3 items      [Review group]
  ```

### 14. One progress chip with segments

- Maps to: run bar. Finding BENCH-10.
- What changes: One chip, "3/11", with a bar in three colors for approved, rejected, and pending. It replaces the header text, the identity row status, and the plain progress bar.
- Why it is better: Argos uses one chip. The segments add the rejected count that a plain bar hides.
- Sketch: see the JSX in BENCH-10.

### 15. `?` help and a key legend

- Maps to: run page. Finding BENCH-12.
- What changes: `?` opens a grouped list built with `Kbd`. A `?` button sits in the run bar.
- Why it is better: Argos does it. The keys become easy to find.
- Sketch:

  ```tsx
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
    <dt>
      <Kbd>A</Kbd> <Kbd>X</Kbd>
    </dt>
    <dd>Approve or reject, then next pending</dd>
    <dt>
      <Kbd>Shift</Kbd> <Kbd>A</Kbd>
    </dt>
    <dd>Approve the item</dd>
    <dt>
      <Kbd>J</Kbd> <Kbd>K</Kbd>
    </dt>
    <dd>Next or previous change in the image</dd>
  </dl>
  ```

### 16. Keyboard queue

- Maps to: dashboard. Finding BENCH-07.
- What changes: `J` and `K` move, `Enter` opens, a key on the run page goes back, and the run page offers "Next run" when nothing is pending.
- Why it is better: Linear, GitHub, and Chromatic connect the list and the detail with keys.
- Sketch:

  ```text
  All 11 reviewed.   [ Next run: #5118 Update Menu arrow placement  Enter ]   [ Queue  Esc ]
  ```

### 17. Split queue with a run preview

- Maps to: dashboard, as an alternative to idea 7. Finding BENCH-06.
- What changes: The list on the left. The right side shows the selected run: counts and the six largest changes as thumbnails.
- Why it is better: Linear and Vercel use list plus detail. The reviewer sees the kind of work before opening it.
- Sketch:

  ```text
  +---------------------------+-----------------------------------------------+
  | ● #5121 Dialog focus  14  | #5121 Add Dialog focus trap option            |
  | ● #5118 Menu arrow     6  | 14 to review · 3 items · attempt 1 · 38 min   |
  | ● #5102 Combobox      41  | [thumb][thumb][thumb][thumb][thumb][thumb]    |
  | ◐ #5125 Tabs  comparing   |                         [ Review  Enter ]     |
  +---------------------------+-----------------------------------------------+
  ```

### 18. Four status words

- Maps to: badges on all pages. Finding BENCH-10.
- What changes: Run states collapse to four visible words with one icon and one color each: Review, Rejected, Passed, Running. Failed and superseded runs get a second line of detail, not a new badge word.
- Why it is better: Argos uses four build status phrases, Chromatic three. Visonaut has eight run labels (`routes/index.tsx:130-140`).
- Sketch:

  ```text
  ● Review    ✕ Rejected    ✓ Passed    ◐ Running (comparing | waiting for screenshots)
  ```

### 19. Canvas background toggle

- Maps to: screenshot viewer.
- What changes: A control for the pane background: checker, dark, light.
- Why it is better: Percy has a `T` key for this and gives the reason: "Use dark mode for lighter apps, and light mode for darker apps." In `screens/26-run-preview-light-1440.png` the checker is light and the capture is dark, which works. In `screens/04-run-dark-1440.png` a dark capture sits on a dark checker and its edge is hard to see.
- Sketch:

  ```tsx
  <ButtonGroup aria-label="Canvas">
    <Button aria-pressed={canvas === "checker"} aria-label="Checker canvas" />
    <Button aria-pressed={canvas === "dark"} aria-label="Dark canvas" />
    <Button aria-pressed={canvas === "light"} aria-label="Light canvas" />
  </ButtonGroup>
  ```

### 20. Copy link and optional reject note

- Maps to: action bar and details panel. Finding BENCH-13. Backend for the note.
- What changes: A "Copy link" action for the current item and variant. An optional one-line note field that appears after `X`.
- Why it is better: Argos has "Copy link" and "Copy embed as Markdown". Percy writes a comment on a change request.
- Sketch:

  ```text
  Rejected · React Light        [ Add a note for the author (optional)        ] [Copy link]
  ```

### 21. Size-change presentation

- Maps to: screenshot viewer.
- What changes: When the two images have different sizes, the viewer shows both sizes and the delta in the bar, aligns the images top-left, and marks the extra area.
- Why it is better: GitHub 2-up shows "the actual dimension change". The Playwright slider prints both sizes. Visonaut has no mask in this case (`packages/cli/src/png-comparison.ts:64-66`), so the viewer is the only help.
- Sketch:

  ```text
  Baseline 640 x 400   ->   Current 640 x 432   (+32 px height)
  ```

### 22. Pull request landing as one status line

- Maps to: `/pulls/$pullNumber`.
- What changes: The card (`screens/23-pull-pending-dark-1440.png`) becomes one row in the same style as the queue, with a spinner and "waiting for screenshots". It keeps **Open on GitHub**.
- Why it is better: The page then looks like a queue with one entry, and the reader learns one layout. Argos and Chromatic keep this state in the pull request comment.
- Sketch:

  ```text
  ◐ #7  ariakit/ariakit   waiting for screenshots · checks again automatically     [Open on GitHub]
  ```

### 23. Alerts as rows

- Maps to: service view.
- What changes: Each alert is one row with a severity mark, a title, the subject, and the age. The recovery text opens on selection.
- Why it is better: Inbox tools show one line for each entry and open detail on demand. Today each alert is a card with a paragraph (`screens/22-service-alerts-dark-1440.png`).
- Sketch:

  ```text
  ! Backup failed            2026-10-05T00Z      first seen 10 h ago · last 4 min ago     >
  ! GitHub check delivery    repository          first seen 90 min ago · last 2 min ago   >
  ```

## Screenshots

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/screens/`. I read every image after capture. Files 18 to 23 use the route fixture on port 4311 with API responses that `capture-dashboard.mjs` mocks in the browser. The mocked run counts follow the server rule that `pending` includes rejected rows (`packages/service/src/review-status.ts:34-38`).

| File                                         | Caption                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `01-inbox-dark-1440.png`                     | Queue, preview fixture, one run, dark, 1440 x 900. The count appears as a sentence, a tile, a section label, and a card sentence. |
| `02-history-dark-1440.png`                   | History, preview fixture, one run, dark.                                                                                          |
| `03-service-dark-1440.png`                   | Service view with no alerts, dark. Five lines of text for an empty state.                                                         |
| `04-run-dark-1440.png`                       | Run page in the preview app, dark. The first image pixel is at y = 449.                                                           |
| `05-workspace-fixture-dark-1440.png`         | Run page in the review fixture: four items, seven variants, dark.                                                                 |
| `06-workspace-fixture-light-1440.png`        | The same state in the light scheme.                                                                                               |
| `07-workspace-fixture-dark-390.png`          | The same state at 390 px wide, full page. Panes stack. The sticky action bar is drawn at its position in the first viewport.      |
| `08-workspace-fixture-diff-dark-1440.png`    | Difference mode. The fixture diff image is synthetic and opaque. A production mask is transparent outside the changed pixels.     |
| `09-workspace-details-dark-1440.png`         | Details panel open. It narrows both panes.                                                                                        |
| `10-workspace-whole-item-menu-dark-1440.png` | Whole-item dialog with seven rows and three buttons.                                                                              |
| `11-workspace-full-page-dark-1440.png`       | Full page. The footer with keyboard help is below the 900 px fold.                                                                |
| `12-inbox-light-390.png`                     | Queue at 390 px wide, light, one run.                                                                                             |
| `13-operations-fixture-dark-1440.png`        | Operations attention fixture with no mocked API: the bell button alone.                                                           |
| `14-workspace-variant-strip-dark-1440.png`   | Variant strip only. Three pills fit and the fourth is cut.                                                                        |
| `15-workspace-keyboard-help-dark-1440.png`   | Keyboard help dialog, opened after a scroll to the footer.                                                                        |
| `16-workspace-200-zoom-dark-1440.png`        | 200% zoom. Each pane has its own four pan buttons.                                                                                |
| `17-workspace-after-approve-dark-1440.png`   | After two approvals. Pills 1 and 2 look like the pending pills. The notice "1 variant approved. Saved." is under the action bar.  |
| `18-inbox-many-runs-dark-1440.png`           | Queue with seven actionable runs, full page, 1768 px high.                                                                        |
| `19-inbox-many-runs-light-1440.png`          | The same queue, light, first viewport. Two cards fit.                                                                             |
| `20-inbox-many-runs-dark-390.png`            | The same queue at 390 px wide, full page.                                                                                         |
| `21-history-many-runs-dark-1440.png`         | History with nine runs. Nine 64 px rows fit.                                                                                      |
| `22-service-alerts-dark-1440.png`            | Service view with three alerts.                                                                                                   |
| `23-pull-pending-dark-1440.png`              | Pull request page while the capture is pending.                                                                                   |
| `24-workspace-200-after-pan-dark-1440.png`   | 200% zoom after two pan clicks on the baseline pane. The two panes show different regions.                                        |
| `25-workspace-footer-position-dark-1440.png` | Fixture first viewport, captured with the footer position measurement.                                                            |
| `26-run-preview-light-1440.png`              | Run page in the preview app, light scheme.                                                                                        |

## Measurements (command, raw result, limits)

All scripts are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/`. They load pages and read the DOM. They write only to the scratch directory.

### M1 and M2 · Image area and visible text for each page

Command: `node measure.mjs > measure-output.jsonl`

```text
inbox        1440x900   scrollH=900   words=72   chars=403  interactive=8
history      1440x900   scrollH=900   words=66   chars=393  interactive=9
service      1440x900   scrollH=900   words=76   chars=495  interactive=7
run-preview  1440x900   scrollH=1035  words=97   chars=490  interactive=26  paneShare=0.427  imageShare=0.297  firstImageTop=449
run-fixture  1440x900   scrollH=1018  words=125  chars=576  interactive=34  paneShare=0.443  imageShare=0.316  firstImageTop=432
run-preview  1920x1080  scrollH=1136  words=97   chars=490  interactive=26  paneShare=0.485  imageShare=0.247  firstImageTop=449
run-fixture  1920x1080  scrollH=1119  words=135  chars=622  interactive=34  paneShare=0.485  imageShare=0.231  firstImageTop=432
```

Pane boxes at 1440 x 900 on the preview run page: `{"top":431,"bottom":935,"left":257,"right":848,"width":591,"height":504}` and `{"top":431,"bottom":935,"left":849,"right":1439,"width":591,"height":504}`.

Limits: `words` counts text nodes that intersect the first viewport. `imageShare` is the visible area of the `img` elements divided by the viewport area. It does not subtract the sticky action bar, so the true share is a little lower. The fixture page has a 24 px test label above the app. The numbers depend on the fixture data: one item with two variants in the preview app, four items in the fixture.

### M3 · Queue cards against history rows

Command: `node measure-inbox.mjs` (nine mocked runs, 1440 x 900).

```text
/               mainWords=162  scrollHeight=1768  articles: words 22,24,21,23  height 240 each  fully visible: 2
/?view=history  mainWords=194  scrollHeight=939   rows: words 18,17,17,16,17,17,16,11,15  height 64 (last 63)  fully visible: 9
```

Command: `node capture-dashboard.mjs` gives `"firstArticleTop":361` at 1440 x 900 and `398` at 390 x 844.

Limits: The run titles are invented. Real titles can be longer and wrap.

### M4 · Pan independence and help position

Command: `node shot.mjs --url http://127.0.0.1:4311/src/review/__tests__/index.html ... --steps '[click 200%, eval, click "Pan Reference right", click "Pan Reference down", eval]'`

```text
before: [{"label":"Reference. U","scrollLeft":0,"scrollTop":0,"scrollWidth":1236,"clientWidth":591},{"label":"New image. U","scrollLeft":0,"scrollTop":0,"scrollWidth":1236,"clientWidth":591}]
after:  [{"label":"Reference. U","scrollLeft":296,"scrollTop":252},{"label":"New image. U","scrollLeft":0,"scrollTop":0}]
```

Help position, fixture: `{"viewport":900,"scrollHeight":1018,"keyboardHelpTop":985,"keyboardHelpBottom":1011,"approveTop":854,"approveBottom":888}`. Preview app, light scheme: `{"viewport":900,"scrollHeight":1029,"keyboardHelpTop":996}`.

Limits: I tested the pan buttons. I did not test a trackpad scroll inside a pane, which uses the same per-pane scroll container.

### M5 · Variant strip capacity

Command: `node shot.mjs --url http://127.0.0.1:4311/src/review/__tests__/index.html --selector .review-variants --steps '[eval]'`

```text
{"navLeft":288,"navRight":1408,"navWidth":1120,"scrollWidth":2079,"total":7,"fullyVisible":3,
 "pills":[{"label":"1. React · Chromium · Light · 1280 × 720. Needs review","width":295,"fullyVisible":true},
          {"label":"2. Solid · Chromium · Light · 1280 × 720. Needs review","width":287,"fullyVisible":true},
          {"label":"3. Dark · Chromium · Light · 1280 × 720. Needs review","width":285,"fullyVisible":true},
          {"label":"4. Contrast · Chromium · Light · 1280 × 720. Needs review","width":307,"fullyVisible":false}, ...]}
```

Limits: The fixture labels are synthetic (`review/__tests__/fixture-model.ts:19`). Real labels come from `labelParts` and can be shorter, because parts with an icon show a short label.

### M6 · Code searches (run in `apps/web/src`)

- `rg -n 'onKeyDown|keydown|key ===' routes/index.tsx 'routes/pulls.$pullNumber.tsx' 'routes/runs.$runId.tsx' components/operations-attention review/item-list.tsx`: matches only in `review/item-list.tsx:316-330`.
- `rg -n "scrollLeft|scrollTop|scrollBy|scrollTo|wheel|onWheel|pointermove|drag" --glob '!**/__tests__/**' --glob '!components/ariakit/**' .`: matches only in `review/item-list.tsx:138,164,166` and `components/screenshot-viewer.tsx:46-47,76,141-142,151`. No file shares scroll state between panes.
- `rg -n '"\?"|Kbd' review/review-workspace.tsx`: no match.
- `rg -n -i "region|bounding|minimap" review components/screenshot-viewer.tsx --glob '!**/__tests__/**'`: `review/review-workspace.tsx:1026` (`role="region"`) and `review/item-list.tsx:161-162` (`getBoundingClientRect`).

### M7 · External sources

- `gh api repos/<owner>/<repo>/issues/<n>` for each issue in section 3 gave the titles, states, reaction counts, and quoted bodies. Example: `microsoft/playwright#24310` returned `"state":"closed","state_reason":"not_planned","thumbs":58,"comments":25,"closed_at":"2026-05-12T18:56:05Z"`.
- `gh api repos/lost-pixel/lost-pixel` returned `"archived":true,"pushed_at":"2026-04-22T17:12:49Z"`.
- Documentation pages were fetched with `fetch-text.mjs` or `curl` into `sources/`. Argos, Chromatic, Graphite, and Lost Pixel serve Markdown copies of their pages, which I used where they exist.

## Open questions and items not verified

- The report file `report.md` does not exist. The Write tool refused report files from a subagent. The orchestrator can save this text to `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/report.md` if it needs the file.
- I did not see any other product running. Layout statements about them are from documentation text, image captions, and source code. I made no claim about their pixel sizes or word counts.
- Happo does not document its diff view modes or any keyboard shortcut. The Happo rows in sections 2.3 and 2.5 are incomplete for that reason.
- The Percy keyboard list and the "purple underline" come from a blog post dated 2020-12-15. The current Percy documentation confirms the approval scopes, the matching-diff groups, and the Diff Navigator. I did not confirm that the 2020 keys are unchanged.
- The Chromatic documentation names the batch operations "accept all", "deny all", and "mark all unreviewed" in one FAQ answer. I did not find a page that shows where they are in the UI.
- Lost Pixel is closed. Its patterns are a record, not a living reference.
- I did not see a production diff mask in the viewer. The fixtures use an opaque synthetic image. The statement that the mask is transparent comes from the pixelmatch option in `packages/cli/src/png-comparison.ts:74` and the pixelmatch README.
- BENCH-08 assumes that two variants with the same changed pixels get the same mask digest. I did not test this on real data. Different image sizes always give different masks.
- The estimate "more than 60%" in idea 1 is arithmetic on row heights, not a measurement.
- I did not measure how often Ariakit runs contain noise (BENCH-14) or outside contributors (BENCH-13).
- Key conflicts to resolve if prior-art keys are adopted: Argos and Percy use Left and Right to flip old and new, and Visonaut uses them for variants. Chromatic uses `d` for deny, and Visonaut, Percy, and Argos use `D` for the diff. `J`, `K`, `H`, `Space`, `?`, and `Esc` are free in `review/review-workspace.tsx:395-442`.
- The contract rows U01 to U06, P02, and D10 select the current shell, tabs, arrows, and keyboard behavior (`docs/current-contract.md:54`, `:142-146`). The maintainer's request says that the current patterns do not need to be kept. Each finding names the row that a change would supersede, so the maintainer can decide it there.
- The vendored primitives do not include Progress, Tooltip, Checkbox, Separator, List, Dialog, or Combobox. Upstream has them at `/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components`. The JSX in this report is a sketch. I did not check each `$` prop against the recipes.
