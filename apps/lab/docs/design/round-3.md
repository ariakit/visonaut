# Design lab, round 3: the five choices are settled

Round 2 left five choices open. The maintainer answered all five on 2026-10-07, each with the recommended option, with no note and no mark. This file says what the answers are, what left the lab with them, and how the lab was checked. The plan of round 2 is in [round-2.md](./round-2.md).

The record revision is `r3`. `src/lab/record.ts` has 30 settled decisions: the 25 of round 1 and the 5 of round 2. No decision is open. This is the revision of the lab record. The audit document has a revision of its own, and `round-2.md` names that one where it says when the maintainer settled D-WORK-04 and D-RES-05.

- [The five answers](#the-five-answers)
- [What left the lab](#what-left-the-lab)
- [What changed in the files that stay](#what-changed-in-the-files-that-stay)
- [The lab with no open decision](#the-lab-with-no-open-decision)
- [Where the removed files are](#where-the-removed-files-are)
- [Checks](#checks)
- [What this round did not do](#what-this-round-did-not-do)

## The five answers

| Decision       | Question                                                            | Answer                             | Not picked                              | Now in                                          |
| -------------- | ------------------------------------------------------------------- | ---------------------------------- | --------------------------------------- | ----------------------------------------------- |
| UI-STAGE-BAR   | Does the one bar of the review stage float, or does it take a row?  | `pill`: Floating pill              | `dock`: Docked bar                      | Review workspace, the bar                       |
| UI-VARIANT-NAV | Which control moves between the variants of a screenshot?           | `stepper-cover`: Stepper and cover | `stepper`: Stepper. `tabs`: Folder tabs | Review workspace, the variant row and the cover |
| UI-HERO-LAYER  | Which layer has the card of the next run in the Queue?              | `brand-mix`: Brand at 15%          | `lighten`: Lighten                      | Queue, the card of the next run                 |
| UI-PULL-SCOPE  | Is the pull request page a waiting page, or does it list every run? | `wait`: Waiting page               | `all-runs`: All runs                    | Pull request                                    |
| UI-ROW-PICTURE | Does "No thumbnails" permit a picture that the stored images give?  | `picture`: Picture                 | `marks`: Marks only                     | Review workspace, the rows of the list          |

The answer to UI-ROW-PICTURE also keeps the preview pictures on the next run card of the Queue. Only the data mode All proposed fields has them.

Each page already had the recommended option as its default form. So the answers change no page. They remove what was not picked.

## What left the lab

The maintainer said in an earlier round that the lab can discard the choices and the directions that were not picked. So the options that were not picked are no longer in the lab.

- **The five choice surfaces.** `review-bar`, `review-variants`, `inbox-hero`, `pull-scope`, and `row-picture`, with the gallery group "Open choices" and the catalog file `src/lab/catalog-choices.ts`. The wrapper modules of the picked options left too: the page is the pick.
- **The six options that were not picked.** The docked bar, the stepper without the cover, the folder tabs, the next run card on the surface of a sheet, the pull request page that lists every commit and every attempt, and the list row with the marks only.
- **The props that selected an option.** `ReviewPage stageBar` and `variantNav`, `InboxPage heroLayer`, `PullPage scope`, `ReviewBar form`, `VariantNav form`, and `ScreenshotList row`.
- **The catalog fields of a choice.** `SurfaceEntry.of`, `SurfaceEntry.pages`, and `VariantEntry.recommendation`, with the "Recommended" labels, the "Still open" links of a decision panel, and the rule that kept a link inside a choice.

Removed files, with their paths below `apps/lab`:

| File                                                                                     | What it was                                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `src/lab/catalog-choices.ts`                                                             | The catalog entries of the five choices             |
| `src/explorations/pages/review-bar/pill.tsx`, `dock.tsx`                                 | The two options of UI-STAGE-BAR                     |
| `src/explorations/pages/review-variants/stepper-cover.tsx`, `stepper.tsx`, `tabs.tsx`    | The three options of UI-VARIANT-NAV                 |
| `src/explorations/pages/inbox-hero/brand-mix.tsx`, `lighten.tsx`                         | The two options of UI-HERO-LAYER                    |
| `src/explorations/pages/pull-scope/wait.tsx`, `all-runs.tsx`                             | The two options of UI-PULL-SCOPE                    |
| `src/explorations/components/row-picture/picture.tsx`, `marks.tsx`, `parts/row-list.tsx` | The two options of UI-ROW-PICTURE and their list    |
| `src/explorations/pages/pull/ariakit/all-runs.tsx` and the 6 files of `all-runs/`        | The pull request page of round 1                    |
| `src/explorations/kits/ariakit/variants/tabs.tsx`                                        | The folder tabs of the variant control              |
| `src/explorations/kits/ariakit/folder.tsx`                                               | `Folder`: a tab strip above a sheet                 |
| `src/explorations/kits/ariakit/progress.tsx`                                             | `SegmentedProgress` and `describeTally`             |
| `src/explorations/kits/ariakit/axis-marks.tsx`                                           | `AxisMarks`, `BrowserMark`, and `FrameworkMark`     |
| `src/fixtures/icons/` (5 SVG files, `LICENSE`, `README.md`)                              | The browser and framework icons of `axis-marks.tsx` |

That is 31 files.

## What changed in the files that stay

Each of these parts lost its last user with the options, so it left its file:

- `kits/ariakit/surfaces.tsx`: `Callout`. Only the pull request page of round 1 used it.
- `kits/ariakit/preview-well.tsx`: `PreviewWellSkeleton`, and the props `count` and `thumbnailClassName`. `PreviewWell` stays for the next run card.
- `kits/ariakit/list/`: the row form `marks`, the option `items` of `useScreenshotList`, and `matchesSearch`.
- `kits/ariakit/bar/bar.tsx`: the dock frame, and the classes that gave the two ends of a docked bar equal shares.
- `pages/review/ariakit/`: the folder shape of the loading state, the dock shape of the bar, the prop `clearBar` of the cover (the cover always has the bar now), and the two choice surfaces in the path check of `use-page-place.ts`.
- `pages/pull/ariakit/runs.ts`: `getReviewScenario`, `getTally`, and `getReviewCount`.
- No longer exported, because only their own file uses them: `getRunStatusName` (`status.tsx`), `formatPlaceHash` (`place.tsx`), `getTerms` (`list/model.ts`), and `findScenario` (`src/lab/surfaces.ts`).

The reference surface Bar states (`notice`) showed each state in the pill and in the docked bar. It shows the pill only now.

The catalog text of the Queue, of the pull request page, and of the review workspace states the settled form, and one tradeoff line for each answer says what was not picked.

## The lab with no open decision

- **Top bar.** The count reads "30 settled" with a check mark. A count of "0 / 0 answered" would look like an error.
- **Gallery.** Two groups: Pages (6) and Reference (4). Each card has the badge Settled.
- **Decisions menu.** One group, Settled, with the 10 decisions that have a surface. A last row, "All 30 settled decisions", opens `/feedback`.
- **Decision panel.** The badge names the round ("Settled in round 1"). The panel has the pick and the notes field. It has no link to a choice.
- **`/feedback`.** The header reads "No open decision · 30 settled · 0 changed since revision r3". The page has one table for each round: round 2 with what was not picked, and round 1 with the notes. It has no table of open decisions.
- **Continuation prompt.** With no change it names revision r3, lists no decision, and says "No decision is open." A note on a settled page is a change: the prompt then lists that decision with the state "settled".

The lab keeps the chrome of an open decision (the options, the marks, the table of open decisions). The catalog has no open surface, so none of it shows. A later round can add one.

## Where the removed files are

`apps/lab` is not tracked by git, so a removed file has no history. Each removed file has a copy in the scratch folder of the build session, with its path below `apps/lab`:

```text
/Users/diegohaz/.claude/jobs/f65a6229/tmp/design/parked-r3/
  src/...        The 31 removed files.
  changed/...    The version of round 2 of each file that round 3 changed and kept.
```

The scratch folder is deleted with the job. Copy it to another place before that, if the removed options must stay available.

## Checks

- **The six pages did not change.** Before the first change, each scenario of each page was captured in the data mode Decided API, dark and light, at 1440 by 900: 70 pictures. After the last change the same 70 pictures were taken again and compared pixel by pixel. 70 of 70 pairs are equal.
- **More pictures than the task asked.** The same pages in the data modes API today and All proposed fields, dark and light, at 1440 by 900, and in Decided API, dark, at 1280, 820, and 390 px: 245 more pairs, all equal. And 72 pictures of the pages after one action each (the cover, the menu of the bar, each view mode, a decision, the lists, a narrow window): 72 of 72 pairs are equal.
- **The reference surfaces.** 24 pictures (4 surfaces, 3 data modes, 2 themes). 18 are equal. The 6 pictures of Bar states differ, as intended: the docked bar is gone from each cell.
- **How the pictures were taken.** Chrome without GPU drawing, with animations and transitions off, and each picture is the first one that comes two times in a row. Two sets taken before the change were equal in all 339 pictures, so a difference after the change comes from the change.
- **The lab chrome.** The gallery, the Decisions menu, one page explorer, one reference explorer, and `/feedback` were loaded at 1440 px in both themes, in a new browser and in a browser with the saved feedback of round 2 (the five picks). No console error, no link to a removed surface, and 0 changed decisions in both browsers.
- **Code.** The type check, the lint, and the format check of the lab are clean, the lab builds, and the smoke check of each surface in each scenario and data mode finds no problem. Outside the copy of the primitives in `src/components/ariakit`, no file has an export that lost its last importer in this round.

An independent review then checked the result again, with its own scripts:

- **Pictures, same method.** Each scenario of the six pages in the three data modes, dark and light, at 1440 by 900, and in Decided API at 1280 by 800: 280 pictures, each load with no console error, no failed request, and no page that scrolls sideways. 245 of them have a picture from before the removal, and all 245 pairs are equal, byte for byte.
- **Pictures, against round 2.** The 140 Decided API pictures were also taken with the method of the round 2 final review (GPU drawing, animations on) and compared with the 140 final pictures of that round. 91 pairs are equal, and 20 differ by noise only: no pixel differs by more than 3%. 29 differ in a part that moves at the moment of the capture: a spinner, the pulse of a skeleton, or the fade of a list picture. Two takes of the same code, some minutes apart, differ in the same places.
- **Behavior.** One complete review of the scenario `changes` with the keys only (28 checks, dark and light), and one with the pointer only (55 checks, at 1440 and 1280 px): the view keys, the arrows, each decision, Undo, the cover, the menu, "Approve the run…", a pager mark with Cmd held, the stored view after a reload, the result page, and the next run. Each control of the Queue, History, Status, the pull request page, and Sign in was used one time (45 checks).
- **The notes of round 1.** Measured again in both themes (80 checks): the sign-in card is the sheet and its one brand surface is the button, a key in a control is text with no cap, the bar of the page nav ends on the header edge, the bar of the selected list row is on the edge of the sidebar and the panel, each pager mark is a link, and the view holds between screenshots, variants, runs, and a reload.
- **The lab chrome.** Each lab page at 1440 px and at 390 px in both themes, each of its 116 links, the Decisions menu, the decision panel of each of the 10 surfaces, and the feedback mechanics in a new browser and in a browser with the saved feedback of revision `r2`. An address of a removed surface shows "No page named …" or "No component named …" with a link to the gallery.
- **Unused code.** A search from the routes and the variant modules reaches each module of `src` outside `src/components/ariakit`, and the type check with the unused checks on finds nothing outside `src/components/ariakit`.

## What this round did not do

- It designed nothing. No page looks or behaves differently.
- It did not change the fixtures API. `usePull` still returns `commits` (type `PullCommit`), and `getVariantMatrix` and `formatAxisValue` still exist. Only the removed options read them in a page. `/dev/hooks`, `/dev/fixtures`, and `docs/fixtures.md` still show them.
- It did not change the records of round 1 in `docs/design/directions`, `docs/design/components`, and `docs/design/reviews`. They name the options of that round.
- It did not change the audit document or anything below `apps/lab/audit`.
- It did not change the two dev pages. `/dev/hooks` scrolls sideways at 1440 px, and its state dump of the Status hook prints `undefined` for an alert without a severity. Both are older than this round: `src/routes/dev.hooks.tsx` is the file of round 2.
