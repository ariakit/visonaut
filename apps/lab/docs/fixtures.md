# Lab fixtures

The fixture layer gives every variant the same deterministic data in the shape of production. A review run has the 626 screenshots and 3,832 variants of the Ariakit consumer, with real Ariakit captures and real pixelmatch masks. It has no network access and no backend.

Import data and helpers from `src/fixtures/index.ts`, and state hooks from `src/fixtures/hooks/index.ts`. The words, the color roles, and the run helpers of [Labels, color roles, and formatters](#labels-color-roles-and-formatters), for example `getRunTitle` and `formatCount`, are in both modules. From `src/explorations/pages/<surface>/<variant>.tsx`, the paths are:

```tsx
import { getItemLabel, useInboxData, useReviewData } from "../../../fixtures/index.ts";
import type { ReviewItem, Run } from "../../../fixtures/index.ts";
import { useReviewSession } from "../../../fixtures/hooks/index.ts";
```

The live references are two routes:

- `/dev/fixtures` lists every dataset in the three data modes, the measured shape of a production run, every image sample, and the variant matrix. Add `?data=decided`, `?data=today`, or `?data=improved` to pin the data mode of the page.
- `/dev/hooks` drives each state hook with buttons and prints its state.

## Rules

- Do not call `Date.now()`, `new Date()` without an argument, `Math.random()`, or `toLocaleString()`. The server render and the browser render must match. Use `NOW` and the `format*` helpers.
- In a component, read data with a hook (`useInboxData`, `useReviewSession`, and so on). A hook follows the Data control. Do not call a getter at module level.
- A hook returns the same object for the same scenario and data mode. Do not mutate fixture objects. The state hooks keep the changes of a person, for example a verdict.
- Every optional field of a type can be absent. Write the code for the absent case first. The type checker reports each place that reads an optional field without a fallback.
- Do not branch on the data mode. Read the fields, and handle the absent case.
- Show the changed pixels and the ratio only for a variant with a mask (`variant.diff`). An added variant and a size change have the number of all pixels and a ratio of 1.
- A page must work with 626 screenshots. Do not render 626 rows with images at one time. See [Performance](#performance).
- The types are in `src/fixtures/types.ts`. Read the JSDoc there for the exact meaning of each field.

## The data mode

The Look menu of the lab has the control **Data** with three values. The lab saves the value, and each preview gets it in its URL as the `data` parameter (`data=decided`, `data=today`, or `data=improved`). The default is `decided`.

| Mode                             | Content                                                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decided` (Decided API)          | The fields of `today` and the fields that the audit answers add: every field with the JSDoc line `In the decided API.` D-UX-04 adds the fields that the service already holds, and D-RUN-02 puts the counts in the first response of a run.     |
| `today` (API today)              | Exactly the fields that production sends today. A pull request has no title. A screenshot has no display name and no thumbnail. A run has no author, no branch, no counts, and no previews. A variant has no viewport field and no style field. |
| `improved` (All proposed fields) | The same data with every proposed API addition: every field with the JSDoc line `Not in the API today.`                                                                                                                                         |

Every fixture hook reads the mode, so a variant shows each mode without code of its own. The settled design must look right in the `decided` mode. Test each variant in the three modes. A design that needs a field of the `improved` mode must list that field in the `tradeoffs` of its variant.

The `decided` mode adds these fields to the `today` mode, and nothing else:

| Record        | Added in `decided`                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `Run`         | `title`, `closedReason`, `closedState`                                                              |
| `PullRequest` | `title`, `headSha`                                                                                  |
| `ReviewRun`   | `run.title` with the real title, `pullRequest` with `number`, `title`, and `url` only, and `counts` |

A screenshot, a variant, a user, a baseline, an alert, and the sign-in data are the same in `decided` and `today`. A run of the two modes shares the objects of its screenshots.

```tsx
export default function Variant({ scenario }: VariantProps) {
  const data = useInboxData(scenario);
  if (data.status !== "ready") return <Text>{data.status}</Text>;
  return (
    <ul>
      {data.runs.map((run) => (
        // `today`: "#7754 · Pull request". `decided` and `improved`: "#7754 · Add a loading state…".
        <li key={run.id}>
          {run.pullRequestNumber ? `#${run.pullRequestNumber} · ` : ""}
          {getRunTitle(run)}
          {run.author ? ` · ${run.author.login}` : ""}
        </li>
      ))}
    </ul>
  );
}
```

What differs between the modes. A field in **bold** is also in the `decided` mode:

| Record          | In every mode                                                                                                                                                                                                                                                                          | Not in `today`                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Run`           | `id`, `kind`, `testedSha`, `state`, `attempt`, `createdAt`, `comparisonId`, `pullRequestNumber`, `pending`, `rejected`                                                                                                                                                                 | **`title`**, `author`, `branch`, `commitMessage`, `counts`, `progress`, `durationMs`, `updatedAt`, `reviewers`, `error`, **`closedReason`**, **`closedState`**, `previews`    |
| `ReviewRun`     | `run` (with the fixed title `#7751 · Pull request visual review`), `comparisonId`, `comparisonRevision`, `comparisonState`, `reviewReady`, `archived`, `readOnlyReason`, `baselineRevision`, `promotionId`, `items`                                                                    | **`run.title`** with the real title, `run.createdAt`, **`pullRequest`** (in `decided` without `author`, `branch`, and `baseBranch`), **`counts`**, `progress`, `supersededBy` |
| `ReviewItem`    | `key`, `name` (always equal to `key`), `variants`                                                                                                                                                                                                                                      | `displayName`, `family`, `group`, `leaf`                                                                                                                                      |
| `ReviewVariant` | `id`, `key`, `label`, `labelParts`, `kind`, `revision`, `verdict`, `source`, `reviewer`, `reference`, `candidate`, `diff`, `changedPixels`, `ratio`, `maskExpected`, `candidateOmitted`, `engine`, `codec`, `policy`, `threshold`, the two profiles, `error`, the two disabled reasons | `axes` (with `viewport` and `style`), `thumbnail`, `diffPreview`, `regions`, `reviewerLogin`, `decidedAt`                                                                     |
| `PullRequest`   | `number`, `repository`, `capture`, `runId`                                                                                                                                                                                                                                             | **`title`**, `author`, `branch`, `baseBranch`, `state`, `draft`, **`headSha`**, `createdAt`, `updatedAt`                                                                      |
| `ServiceAlert`  | `kind`, `code`, `subject`, `firstSeenAt`, `lastSeenAt`, `title`, `action`                                                                                                                                                                                                              | `severity`, `impact`, `occurrences`, `runId`                                                                                                                                  |
| `User`          | `id`, `githubUserId`, `login`                                                                                                                                                                                                                                                          | `name`, `avatarUrl`, `bot`                                                                                                                                                    |
| `Baseline`      | `revision`, `snapshotId`, `promotionId`                                                                                                                                                                                                                                                | `updatedAt`, `testedSha`, `screenshots`                                                                                                                                       |
| Sign-in data    | `status`, `message`, `reference`                                                                                                                                                                                                                                                       | `repository`, `user`                                                                                                                                                          |

The helpers in [Helpers that need no API change](#helpers-that-need-no-api-change) give a result in every mode. For example, `getItemLabel(item)` returns the display name in `improved` mode and the last key segment as words in the other two modes.

Other exports for the mode:

- `useDataMode()` returns `decided`, `today`, or `improved` for the calling component.
- `getDataMode()` returns the mode outside React, for example in an event handler. It does not follow later changes.
- `<DataModeProvider mode="today">` pins the mode for one part of the tree. Use it only to show the modes side by side.
- `dataModes` and `dataModeLabels` list the three modes and their names.

The server knows the mode only from the URL of a bare preview. On every other page, and in a bare preview without `data` in its URL, the server renders the default mode. When the saved mode is another one, the lab keeps each variant hidden until the browser has rendered it again in the saved mode. So a page never shows the data of the wrong mode, and a variant needs no code for this. The lab renders each variant in one element without a box (`display: contents`) for it, so the root of a page variant is not a direct child of `body`.

A screenshot script must put the mode in the URL (`&data=today`). A new browser context has no saved mode, so it shows the `decided` mode.

The builders make the `improved` records. `src/fixtures/data/today.ts` and `src/fixtures/data/decided.ts` remove the fields that a mode does not have.

## What real data does to a layout

These facts come from a census of the Ariakit consumer and from the audit of the app with that data. The lab fixtures have the same shape. Check each design against them.

**Names**

- A screenshot has no display name. Its name is its key: a path of 23 to 68 characters. The median is 37 characters and the 90th percentile is 48.
- 62.4% of the characters of a key are the family and the group. Only the last segment (the leaf) tells two rows apart. A leaf has a median of 13 characters, a 90th percentile of 22, and a maximum of 43.
- 536 keys have three segments (`ariakit-ui-button/page/default`), 60 have two, and 30 have four.
- 24 of the 26 families start with `ariakit-ui-`. Leaf names repeat across families: 84 leaf names cover 211 screenshots, and `default` is the leaf of 21.
- The longest key is `ariakit-ui-combobox/page/combobox-select-content-conditional-content`.
- In the app today, a name takes three lines in a 201 px wide row.

**Rows**

- A run has 626 screenshots in 26 families. The largest family has 106 screenshots, and the five largest hold 294.
- A normal pull request changes 3 of them. The other 623 are unchanged, and they are not work.
- The order is the order of the test files. It is not alphabetical. A removed screenshot comes last.
- In the app today, 9 rows of 76 px are visible in the list, and the 626 rows are 44,714 px tall (65 screens).
- A progress value that counts all variants starts at 99.77% for a normal pull request. Count the changes: 9, not 3,832.

**Variants and chips**

- 523 screenshots (83.5%) have 6 variants: 3 browsers by 2 color schemes. 58 have 4, 10 have 3, 34 have 12, and 1 has 24.
- A variant key has 40 to 54 characters, for example `react-chrome-desktop-light-light-no-preference-none`. The label that production builds has six parts and ends with the whole key.
- In the app today, a variant chip is 388 to 413 px wide. 2 of 6 chips fit in a 1,120 px strip. Six chips need 2,420 px, twelve need 4,666 px, and twenty-four need 9,484 px.
- The framework is `react` for 3,820 of 3,832 variants, and the contrast never changes inside a screenshot. A label needs only the axes that differ: `Chromium · Light`.
- The viewport and the style exist only inside the key text. Six screenshots have variants that differ only in them.
- When only WebKit changed, the first variant to review is the fifth of six.

**Images**

- 549 screenshots (88%) are card images of 416 or 432 px in width and 98 to 640 px in height. The median height is 170 px.
- 19 are small clips (317 × 80 to 345 × 282), 32 are wide cards (624, 1248, or 1264 px wide, up to 1,240 px tall), and 26 are viewport captures (1280 × 800, 1440 × 900, 560 × 400, and for two screenshots also 560 × 900).
- No screenshot is a full page, and no screenshot is a 390 px wide page.
- One image pixel is one CSS pixel, also for WebKit.
- In the app today, 89% of the screenshots show at a scale of 1, and the picture covers a median of 24% of its compare pane. No card fits a compare pane at a zoom of 2. In one full-width stage (1146 × 468), 406 screenshots fit at a zoom of 2 and 13 more at a zoom of 3.
- A real change is small: the median is 107, 265, and 230 changed pixels in `changes`, `large`, and `one-browser`. The mask is a few thin red fragments.
- An unchanged variant has one image, not two: `reference` and `candidate` are the same object.
- A size change has no mask. Its `ratio` is 1 and `changedPixels` is the number of all pixels, so the text `100% changed` is wrong for it. A real size change is small: the same picture, 2 px taller.
- Production sends no thumbnail.

**Runs**

- A run has no title. A queue card and a history row read `#7754 · Pull request`. A main run reads `Main`.
- 85 of the 100 history rows are closed attempts of pull requests, and all of them have the state `superseded` (`Replaced by a newer run`), also the last run of a merged pull request.
- Ariakit has no merge queue, so no run has the kind `merge_group`.

## Data hooks and getters

Each page surface has one data hook. It takes the scenario identifier of `VariantProps`, follows the Data control, and returns a union that you narrow on `status`. An unknown scenario returns the first scenario.

| Hook                       | Scenarios in the catalog                                                                                                      | Extra scenarios    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `useSignInData(scenario)`  | `guest`, `signing-in`, `forbidden`, `error`                                                                                   |                    |
| `useInboxData(scenario)`   | `busy`, `single`, `empty`, `first-run`, `loading`, `error`                                                                    |                    |
| `useHistoryData(scenario)` | `full`, `no-match`, `empty`, `loading`                                                                                        | `error`            |
| `useStatusData(scenario)`  | `healthy`, `alerts`, `loading`, `error`                                                                                       | `overflow`         |
| `usePullData(scenario)`    | `attempts`, `single`, `no-runs`, `waiting`, `capture-failed`, `loading`                                                       | `error`            |
| `useReviewData(scenario)`  | `changes`, `large`, `one-browser`, `problems`, `one-change`, `probes`, `clean`, `passed`, `read-only`, `comparing`, `loading` | `error`, `expired` |

The extra scenarios are not in the catalog. Use them in a component surface, or when a page must show that state.

```tsx
export default function Variant({ scenario }: VariantProps) {
  const data = useInboxData(scenario);
  if (data.status === "loading") return <Loading />;
  if (data.status === "error") return <Failure message={data.message} />;
  // data.status is "ready" here.
  return <Queue runs={data.runs} baseline={data.baseline} user={data.user} />;
}
```

| Hook             | Fields of the `ready` state                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useSignInData`  | No `ready` state. `guest` and `signing-in` have the optional `repository`. `forbidden` has `message` and the optional `user` and `repository`. `error` has `message` and `reference` |
| `useInboxData`   | `repository`, `baseline`, `runs` (the open runs), `recentRuns`, `alertCount`, `user`                                                                                                 |
| `useHistoryData` | `repository`, `runs`, `limit`, `query`, `filter`, `visibleRuns`, `user`                                                                                                              |
| `useStatusData`  | `alerts`, `hasMore`, `checkedAt`, `capacity`, `guideUrl`, `user`                                                                                                                     |
| `usePullData`    | `pull` (a `PullRequest`), `runs`, `user`                                                                                                                                             |
| `useReviewData`  | `review` (a `ReviewRun`), `selection`, `user`                                                                                                                                        |

For a page with state (selection, filters, decisions), use the state hooks: `useReviewSession`, `useInbox`, `useHistory`, `useStatus`, `usePull`, and `useSignIn`. See [State hooks](#state-hooks).

Each data hook has a pure getter with the mode as a required second argument: `getSignInData`, `getInboxData`, `getHistoryData`, `getStatusData`, `getPullData`, and `getReviewRun`. Use a getter only outside React, for example in a script. A getter in a component does not follow the Data control.

```ts
const data = getReviewRun("changes", "today");
```

Other exports: `currentUser`, `people`, `repository`, `NOW`, `ago({ minutes: 5 })`, `MINUTE`, `HOUR`, `DAY`. `currentUser` and `people` are the complete records. The `user` of a hook follows the data mode.

## What each scenario holds

The datasets describe one consistent world. The repository is `ariakit/ariakit`, the user is `diegohaz`, the baseline revision is 412, and `NOW` is 2026-10-05 15:30 UTC. A run is the same run in the inbox, in the history, on the pull request page, and in the review workspace.

### Review

Every run has the 626 screenshots and 3,832 variants of the census. Only the changed part differs. All runs share the objects of their unchanged screenshots.

| Scenario      | Run                              | Changed part                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `changes`     | #7751, attempt 1, `needs-review` | 9 changed variants in 3 screenshots of `ariakit-ui-button`: all 6 variants of `page/default`, the 2 WebKit variants of `page/pill`, and the Chromium dark variant of `page/segmented-control`. 9 undecided, 3,823 unchanged                                                                                                                                                                                                                                                    |
| `large`       | #7752, attempt 2, `needs-review` | 246 changed variants in 41 screenshots of 3 families: `badge` 24 (144 variants), `kbd` 12 (72), `prose` 5 (30). Every variant of each screenshot changed. 246 undecided                                                                                                                                                                                                                                                                                                        |
| `one-browser` | #7753, attempt 1, `needs-review` | 24 changed variants: the 2 WebKit variants of 12 `ariakit-ui-link` screenshots. The first variant to review is the fifth of six                                                                                                                                                                                                                                                                                                                                                |
| `problems`    | #7754, attempt 3, `rejected`     | 627 screenshots and 3,838 variants. 18 changed (2 approved by a person, 1 rejected, 15 undecided), 6 added (the new screenshot `ariakit-ui-button/page/loading`), 6 removed (`ariakit-ui-button/page/dimmed-button`, the last item), 2 with kind `error` (`ariakit-ui-button/page/danger`, Firefox), 3,806 unchanged. 3 of the changed variants are a size change without a mask (`page/brand`, light), and 6 are a 1280 × 800 viewport capture (`ariakit-ui-shell/docs-site`) |
| `one-change`  | #7756, attempt 1, `needs-review` | 1 changed variant: `ariakit-ui-button/page/segmented-control`, Chromium dark                                                                                                                                                                                                                                                                                                                                                                                                   |
| `clean`       | #7746, attempt 1, `superseded`   | No change: 3,832 unchanged variants. The run is closed and read-only (`archived`, `readOnlyReason`). This is the run that the audit observed in production                                                                                                                                                                                                                                                                                                                     |
| `passed`      | #7749, attempt 1, `passed`       | The 9 changes of `changes`, all approved by two people. The run is open                                                                                                                                                                                                                                                                                                                                                                                                        |
| `read-only`   | #7752, attempt 1, `superseded`   | The 246 changes of `large`: 12 approved, 6 rejected, 228 undecided. The run is closed (`archived`, `readOnlyReason`). In `improved` mode, `supersededBy` names the `large` run                                                                                                                                                                                                                                                                                                 |
| `comparing`   | #7755, attempt 1, `comparing`    | 9 changed, 2,333 unchanged, and 1,490 with kind `pending` (every variant from screenshot 381 on). `reviewReady` is false. In `improved` mode, `progress` is set                                                                                                                                                                                                                                                                                                                |
| `expired`     | #7702, attempt 1, `superseded`   | A closed run with `evidenceState: "summary"` and `imagesExpired: true`. Every image is null, and each variant has the two disabled reasons. 9 changed variants, all approved                                                                                                                                                                                                                                                                                                   |
| `probes`      | #7760, attempt 1, `needs-review` | 629 screenshots and 3,850 variants. 21 changed variants for the viewer: one screenshot for each image size with a change of 1 pixel, a change of 2 × 2 pixels, and a real change. 3 screenshots with the family `lab-only` have sizes that production does not send                                                                                                                                                                                                            |

Facts for every run:

- `run.title` is `#<number> · Pull request visual review` in `today` mode. In `decided` and `improved` mode it is `#<number> · <title>`. `pullRequest` has the number, the title, and the URL in `decided` mode, and also the author and the two branches in `improved` mode.
- `counts` exists in `decided` and `improved` mode. `countVariants(review.items)` gives the same numbers in every mode.
- `progress` and `supersededBy` exist in `improved` mode only.
- `selection` is the first changed variant without a verdict, else the first variant.
- Production sends the kinds `pending` and `error` only for runs of a retired engine. The lab keeps both, so a design has these states.
- A variant identifier has the production form: two UUIDs and a digest, 138 characters.

### Inbox

`busy` has 8 open runs, newest first:

| Run              | State                                                      | Pending             | Group of `useInbox` |
| ---------------- | ---------------------------------------------------------- | ------------------- | ------------------- |
| A main run       | `incomplete` (1,290 of 3,832 captured, in `improved` mode) | 0                   | In progress         |
| #7755            | `comparing`                                                | 0                   | In progress         |
| #7754, attempt 3 | `rejected`                                                 | 18, with 1 rejected | To review           |
| #7753            | `needs-review`                                             | 24                  | To review           |
| #7752, attempt 2 | `needs-review`                                             | 246                 | To review           |
| #7751            | `needs-review`                                             | 9                   | To review           |
| #7748, attempt 2 | `failed`                                                   | 0                   | Attention           |
| A main run       | `needs-recompare`                                          | 0                   | Attention           |

- `busy` also has `alertCount: 3` and 100 `recentRuns`.
- `single` has the `one-change` run (#7756) and 93 recent runs.
- `empty` has no open run, baseline revision 412, and 92 recent runs.
- `first-run` has no run and baseline revision 0.

In `improved` mode, #7755 has a title of 171 characters and a branch name of 75 characters.

### History

`full` has 100 runs over about 4.5 days, newest first: the 8 open runs, 1 open pull request run that passed (#7749), 85 closed pull request runs with the state `superseded`, and 6 main runs with the state `passed`. The 92 pull request rows belong to 33 pull requests with 1 to 7 runs each. Runs of one commit have the same `testedSha`.

In `today` mode, a row has no title: it reads `#7730 · Pull request`, and 85 rows read `Replaced by a newer run`. In `decided` and `improved` mode, a pull request run has its title, and a closed run has `closedReason` (`replaced` for 59 rows, `pull-request-closed` for 26) and `closedState` (the state before the run closed: `passed` 30, `needs-review` 40, `failed` 8, `rejected` 7).

`no-match` has the same runs, `query: "datepicker"`, and no `visibleRuns`. `groupRunsByPullRequest(runs)` puts the runs of one pull request in one group.

### Status

- `healthy` has no alert. The database has 5.5 MiB of 2,048 MiB, and 0 of 5 runs are active. These are the values of production.
- `alerts` has 3 alerts, most recently seen first: `check-delivery/exhausted`, `database-capacity/headroom-warning`, and `backup/backup-failed`. The database is above its warning size of 1,536 MiB. In `improved` mode, the first alert is `critical` and the other two are `warning`.
- `overflow` has 50 alerts and `hasMore: true`.

The `title` and the `action` of an alert are in every mode, because the app derives them from `kind` and `code`.

### Pull request

The app has no pull request page today: with a run, it opens the run at once. The pull request API returns only `number`, `repository`, `capture`, and `runId`, and in `decided` mode also `title` and `headSha`. The `runs` of the data come from the run list in `today` and `decided` mode, as a client can do today.

- `attempts` is #7754 with 3 runs of one commit: attempt 3 (`rejected`, 18 variants not accepted), and attempts 2 and 1 (`superseded`).
- `single` is #7749 with one `passed` run.
- `no-runs` is #7757, a documentation change with `capture: "not-required"`.
- `waiting` (#7758) has `capture: "pending"`, and `capture-failed` has `capture: "failed"`.

## Types in short

A field in parentheses is optional. A field after "Improved only" is absent in `today` mode. Of these, the `decided` mode has only the fields that [The data mode](#the-data-mode) lists.

- `Run`: `id`, `kind` (`main` or `pull_request`), `testedSha`, `state`, `attempt`, `createdAt`, `comparisonId`, (`pullRequestNumber`), `pending`, `rejected`. Improved only: `title`, `author`, `branch`, `commitMessage`, `counts`, `progress`, `durationMs`, `updatedAt`, `reviewers`, `error`, `closedReason`, `closedState`, `previews`.
- `RunState`: `incomplete`, `comparing`, `needs-review`, `rejected`, `passed`, `failed`, `superseded`, `needs-recompare`. A `rejected` run can still have undecided variants. `pending` counts every variant that is not accepted, and it includes the rejected ones. `superseded` is the state of every closed run that was not accepted.
- `RunCounts`: `items`, `total`, `changed`, `added`, `removed`, `unchanged`, `error`, `comparing`, `approved`, `rejected`, `undecided`. Every number counts variants.
- `RunPreview`: `itemKey`, `itemName`, `kind`, `image`, `thumbnail`.
- `ServiceAlert`: `kind`, `code`, `subject`, `firstSeenAt`, `lastSeenAt`, `title`, `action`. Improved only: `severity`, `impact`, `occurrences`, `runId`.
- `PullRequest`: `number`, `repository`, `capture`, `runId`. Improved only: `title`, `author`, `branch`, `baseBranch`, `state`, `draft`, `headSha`, `createdAt`, `updatedAt`.
- `ReviewRun`: `run` (`id`, `repository`, `kind`, `testedSha`, `attempt`, (`title`), `status`, (`error`)), `comparisonId`, `comparisonRevision`, `comparisonState`, `reviewReady`, (`archived`), (`readOnlyReason`), (`evidenceState`), (`imagesExpired`), `historicalComparisons`, `baselineRevision`, `promotionId`, `items`. Improved only: `run.createdAt`, `pullRequest`, `counts`, `progress`, `supersededBy`.
- `ReviewItem`: `key`, `name` (always equal to `key`), `variants`. Improved only: `displayName`, `family`, `group`, `leaf`.
- `ReviewVariant`: `id`, `key`, `label`, `labelParts`, `kind`, `revision`, `verdict`, `source`, (`reviewer`), `reference`, `candidate`, `diff`, (`changedPixels`), (`ratio`), (`maskExpected`), (`candidateOmitted`), (`engine`), (`codec`), (`policy`), (`threshold`), (`referenceProfile`), (`candidateProfile`), (`error`), (`rejectDisabledReason`), (`approveDisabledReason`). Improved only: `axes`, `thumbnail`, `diffPreview`, `regions`, `reviewerLogin`, `decidedAt`.
- `VariantKind`: `added`, `changed`, `removed`, `unchanged`, `pending`, `error`. An added variant has no `reference`. A removed variant has no `candidate`. Added and removed variants have an automatic approval (`source: "automatic"`).
- `VariantAxes`: `framework`, `browser`, `colorScheme`, `contrast`, `forcedColors`, (`viewport`), (`style`).
- `ReviewMode` (`side`, `diff`, `new`, `original`) and `ReviewZoom` (`fit`, `1`, `2`) are the viewer states of the app today. `ViewerMode` adds `overlay`, `swipe`, and `blink`. `ViewerZoom` adds `0.5`, `3`, and `4`.

What a variant has for each kind:

| Kind                                | `reference`  | `candidate`                    | `diff`   | `changedPixels` and `ratio`                 |
| ----------------------------------- | ------------ | ------------------------------ | -------- | ------------------------------------------- |
| `unchanged`                         | The image    | The same object as `reference` | null     | 0 and 0                                     |
| `unchanged` with `candidateOmitted` | The image    | null                           | null     | 0 and 0                                     |
| `changed`                           | The baseline | The current image              | The mask | The red pixels of the mask, and their share |
| `changed` with another size         | The baseline | The current image              | null     | All pixels of the candidate, and 1          |
| `added`                             | null         | The new image                  | null     | All pixels of the candidate, and 1          |
| `removed`                           | The baseline | null                           | null     | Absent                                      |
| `pending`, `error`                  | The baseline | The current image              | null     | Absent                                      |

## Images

Each image is a `ReviewImage`: `{ id, url, digest, width, height }`. The `url` is a PNG file under `/fixtures/`, which the lab serves from `apps/lab/public/fixtures` (2,462 files, 24 MB). One image pixel is one CSS pixel. Always size an image from `width` and `height`.

| Field         | Image                                                                                       | Note                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `reference`   | The baseline                                                                                | Null for `added`                                                                                                               |
| `candidate`   | The current image                                                                           | Null for `removed` and with `candidateOmitted`. The same object as `reference` for an unchanged variant                        |
| `diff`        | The pixelmatch mask: opaque red on a transparent background, with the size of the candidate | The API serves this today. Put it over the candidate, or on a checkerboard. Null for a size change                             |
| `diffPreview` | The mask over a faded copy of the candidate, as one picture                                 | Not in the API today                                                                                                           |
| `regions`     | Bounding boxes of the changed areas, in candidate pixels, from top to bottom                | Not in the API today. Changed areas that lie at most 8 px apart are one region, so the changed letters of one word are one box |
| `thumbnail`   | A small PNG of the candidate, or of the reference: at most 160 px on its longest side       | Not in the API today                                                                                                           |

```tsx
const { review } = data;
const item = review.items[0];
const variant = item?.variants[0];
if (item && variant?.candidate) {
  const { url, width, height } = variant.candidate;
  // 100% zoom: one image pixel is one CSS pixel.
  return <img src={url} width={width} height={height} alt={getVariantLabel(variant, item)} />;
}
```

Facts about the files:

- A baseline file is `/fixtures/baseline/<family>/<leaf>.<light or dark>.png`. The three browsers of one screenshot show the same picture, because the audit captured Chrome only. Each variant still has its own image object.
- The 123 screenshots that are not example cards show one real picture for each size, for example the same documentation page for every viewport capture.
- A changed picture is the real page with one injected CSS rule: a heavier button label (`changes`), a wider letter spacing of the card titles (`large`), or a move of the card titles by 1 px (`one-browser`).
- The current image of a size change is the baseline with one row of pixels repeated two times: the same card, 2 px taller (`/fixtures/current/resized/`).
- The new screenshot of `problems` (`page/loading`) shows the picture of the card that it copies (`page/danger`).
- The masks come from pixelmatch with the options of production. The number of red pixels is equal to `changedPixels`. A mask has 1 to 14 regions.
- A zoom above 1 shows the pixels of a PNG file. Use `image-rendering: pixelated` at a whole-number zoom.
- `brokenImageUrl` always fails to load. Use it to design an image error state.

### Samples

A component surface (a viewer, a thumbnail, a variant picker) needs one real case of each kind. `useReviewSample(id)` returns `{ id, title, scenario, item, variant, labOnly }` in the current data mode. `reviewSampleIds` lists every identifier, and `/dev/fixtures#images` shows each one.

```tsx
export default function Variant() {
  const { item, variant } = useReviewSample("size-change");
  const viewer = useViewer(variant);
  return <Text>{`${getItemLabel(item)} · ${viewer.effectiveMode}`}</Text>;
}
```

| Sample                                               | Content                                                                           | Image                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| `card`                                               | A changed card: 107 changed pixels in one region                                  | 416 × 136              |
| `card-dark`                                          | A changed card in the dark scheme with 4 regions                                  | 416 × 148              |
| `card-token`                                         | A card of the token change                                                        | 416 × 170              |
| `card-webkit`                                        | A card that changed only in WebKit: the fifth of six variants                     | 416 × 174              |
| `clip`                                               | A small clip with 249 changed pixels                                              | 317 × 80               |
| `wide-card`                                          | A wide card with a change of 2 × 2 pixels                                         | 1248 × 348             |
| `viewport`                                           | A viewport capture with 3,898 changed pixels in 12 regions                        | 1280 × 800             |
| `viewport-wide`                                      | A viewport capture with a change                                                  | 1440 × 900             |
| `viewport-narrow`                                    | A narrow viewport capture with 2,296 changed pixels                               | 560 × 900              |
| `one-pixel`, `four-pixels`                           | A card with 1 changed pixel, and with a change of 2 × 2 pixels                    | 416 × 136              |
| `size-change`                                        | A size change of 2 px: the same card, no mask, and a ratio of 1                   | 416 × 136 to 416 × 138 |
| `added`, `removed`                                   | A new screenshot, and a removed screenshot. The service approved both             | 416 × 136              |
| `approved`, `rejected`                               | A change with the verdict of a person                                             | 416 × 136              |
| `error`, `pending`                                   | A comparison without evidence, and a comparison that did not finish               | 416 × 136, 320 × 106   |
| `unchanged`                                          | An unchanged variant: one image object                                            | 416 × 136              |
| `candidate-omitted`                                  | An unchanged variant without a candidate                                          | 1440 × 900             |
| `three-variants`, `four-variants`, `twelve-variants` | Screenshots with 3 browsers, with 2 browsers by 2 schemes, and with forced colors |                        |
| `two-viewports`                                      | 12 variants: 1440 × 900 and 560 × 900                                             |                        |
| `twenty-four-variants`                               | 24 variants: framework, viewport, and style                                       |                        |
| `longest-name`                                       | The key of 68 characters, with 12 variants                                        | 416 × 352              |
| `tallest-image`                                      | The largest stored image                                                          | 1248 × 1240            |
| `phone-page`, `full-page`                            | Lab only: sizes that production does not send                                     | 390 × 844, 1280 × 1640 |

## Helpers that need no API change

These helpers derive what a design needs from the fields that production sends today. Each one gives the same result in every data mode, and each result is cached.

### `splitItemKey`, `getItemLabel`, `getFamilyLabels`

```ts
splitItemKey("ariakit-ui-button/page/segmented-control");
// { family: "ariakit-ui-button", group: "page", leaf: "segmented-control", segments: [...] }
splitItemKey("ariakit-ui-list/forced-colors/page/default").group; // "forced-colors/page"
splitItemKey("ariakit-tailwind-7466/focus-priority").group; // null

getItemLabel(item); // "Segmented control"
formatKeySegment("on-a-brand-layer"); // "On a brand layer"
getFamilyLabels(["ariakit-ui-button", "ariakit-ui-list", "previews"]).get("ariakit-ui-button");
// "button"
```

- `getItemLabel(item)` returns `item.displayName` when the API sends one, else the leaf as words. The result is the same for 603 of the 626 screenshots.
- `getFamilyLabels(families)` removes the prefix that most families share and that ends with a hyphen. A family without the prefix keeps its name. Pass the families of the whole run. The prefix of a part of the run can be another one: alone, `ariakit-tailwind-7466` gets the label `7466`.

### `groupItemsByFamily` and counts of changes by family

```tsx
const groups = groupItemsByFamily(review.items);
// [{ family: "ariakit-ui-button", label: "button", items, sections, counts }, ...]
const lines = groups.map((group) => {
  const { items, changedItems, undecided } = group.counts;
  // "button · 3 changed of 106 · 9 to review"
  return `${group.label} · ${changedItems} changed of ${items} · ${undecided} to review`;
});
```

- A `FamilyGroup` has `family`, `label`, `items`, `sections` (the screenshots by the group of their key, each with `group`, `items`, and `counts`), and `counts`.
- `counts` is a `VariantTally`: `items`, `changedItems`, `undecidedItems`, `variants`, `changed`, `added`, `removed`, `unchanged`, `error`, `comparing`, `approved`, `automatic`, `rejected`, `undecided`.
- The groups keep the order of the run. It works with `ReviewItem` and with `SessionItem`. `session.families` is this result for the visible items, with the labels of the whole run.
- For a part of a run, for example your own search result, pass the labels of the whole run: `groupItemsByFamily(part, { labels: getFamilyLabels(review.items.map((item) => splitItemKey(item.key).family)) })`.
- `getItemTally(item)` gives the same counts for one screenshot, and `countVariants(items)` gives the `RunCounts` of a run.

The families of a production run:

| Family                  | Label                 | Screenshots | Variants |
| ----------------------- | --------------------- | ----------- | -------- |
| `ariakit-tailwind-7466` | ariakit-tailwind-7466 | 10          | 30       |
| `ariakit-ui-badge`      | badge                 | 26          | 152      |
| `ariakit-ui-button`     | button                | 106         | 604      |
| `ariakit-ui-checkbox`   | checkbox              | 27          | 162      |
| `ariakit-ui-code`       | code                  | 12          | 72       |
| `ariakit-ui-combobox`   | combobox              | 37          | 394      |
| `ariakit-ui-dialog`     | dialog                | 13          | 78       |
| `ariakit-ui-disclosure` | disclosure            | 28          | 168      |
| `ariakit-ui-heading`    | heading               | 10          | 60       |
| `ariakit-ui-input`      | input                 | 32          | 192      |
| `ariakit-ui-kbd`        | kbd                   | 12          | 72       |
| `ariakit-ui-layer`      | layer                 | 1           | 6        |
| `ariakit-ui-link`       | link                  | 14          | 84       |
| `ariakit-ui-list`       | list                  | 60          | 300      |
| `ariakit-ui-nav`        | nav                   | 38          | 228      |
| `ariakit-ui-popover`    | popover               | 14          | 82       |
| `ariakit-ui-progress`   | progress              | 23          | 138      |
| `ariakit-ui-prose`      | prose                 | 5           | 30       |
| `ariakit-ui-radio`      | radio                 | 17          | 102      |
| `ariakit-ui-separator`  | separator             | 12          | 72       |
| `ariakit-ui-shell`      | shell                 | 23          | 154      |
| `ariakit-ui-table`      | table                 | 47          | 282      |
| `ariakit-ui-tabs`       | tabs                  | 43          | 244      |
| `ariakit-ui-text-frame` | text-frame            | 2           | 12       |
| `ariakit-ui-tooltip`    | tooltip               | 11          | 66       |
| `previews`              | previews              | 3           | 48       |

The group `page` holds 473 screenshots, and the groups `forced-colors` and `forced-colors/page` hold 60.

### `getVariantAxes`, `getVariantMatrix`, `getVariantLabel`

```tsx
getVariantAxes(variant);
// { framework: "react", browser: "chromium", colorScheme: "light", contrast: "no-preference",
//   forcedColors: "none", viewport: "desktop", style: "light" }

const matrix = getVariantMatrix(item);
matrix.columns; // ["chromium", "firefox", "webkit"]
matrix.rows.map((row) => row.label); // ["Light", "Dark"]
matrix.rows[0]?.cells; // [variant, variant, variant], or null for a missing combination
matrix.varying; // ["browser", "colorScheme"]
matrix.caption; // "React · Desktop"

getVariantLabel(variant, item); // "Chromium · Light"
variant.label;
// "react · chromium · light · no-preference · none · react-chrome-desktop-light-light-no-preference-none"
```

- `getVariantAxes(variant)` returns the typed axes. In `improved` mode they are `variant.axes`. In `today` mode the five fixed axes come from `labelParts`, and the viewport and the style are read from the key text, because the API does not send them. That rule fits the keys of the Ariakit consumer.
- `getVariantMatrix(item)` has the browsers as `columns` and one row for each combination of the other axes that differ. `varying` lists the axes with more than one value in the screenshot, `rowAxes` is `varying` without the browser, `constant` has the value of every other axis, `caption` is the constant values as words, and `labels` maps each variant key to its short label.
- `getVariantLabel(variant, item)` is the short label: only the axes that differ inside the screenshot. `formatAxisValue(axis, value)` gives one value as a word, and `getVariantWords(variant, axes?)` gives the words of chosen axes.
- The style is not an axis when it follows the color scheme, which is the case for 613 screenshots.
- A matrix with one row has an empty row label. This is the case for the 10 screenshots with 3 variants.
- The cells have the type of the variants of the item. With a `SessionItem`, a cell is a `SessionVariant` with `status` and `name`.

The matrix shapes of production:

| Axes that differ                         | Screenshots | Rows of the matrix                                                                             |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| Browser and color scheme                 | 581         | `Light`, `Dark`. 523 have 3 browsers, and 58 have 2                                            |
| Browser, color scheme, and forced colors | 29          | `Light`, `Dark`, `Light · Forced colors`, `Dark · Forced colors`                               |
| Browser only                             | 10          | One row                                                                                        |
| Browser, viewport, and color scheme      | 3           | `Wide · Light`, `Narrow · Light`, `Wide · Dark`, `Narrow · Dark`                               |
| Browser, viewport, and style             | 2           | `Desktop · Light style`, `Desktop · Dark style`, `Mobile · Light style`, `Mobile · Dark style` |
| Framework, browser, viewport, and style  | 1           | 8 rows, from `React · Desktop · Light style` to `Solid · Mobile · Dark style`                  |

### `getSizeClass` and `getFitZoom`

```ts
getSizeClass({ width: 416, height: 136 }); // "card"
sizeClasses.card; // { label: "Card", description: "...", labOnly: false }

// The largest whole-number zoom at which the image fits the stage.
getFitZoom({ width: 416, height: 136 }, { width: 1146, height: 468 }); // 2
// A fraction only when the image is larger than the stage.
getFitZoom({ width: 1280, height: 800 }, { width: 555, height: 468 }); // 0.43
getFitZoom(image, stage, { maximum: 3 });

isSizeChange(variant); // true when reference and candidate differ in size
```

| Size class   | Rule                                                  | Screenshots | Variants |
| ------------ | ----------------------------------------------------- | ----------- | -------- |
| `clip`       | Less than 400 px wide                                 | 19          | 114      |
| `card`       | 400 to 432 px wide                                    | 549         | 3,354    |
| `wide-card`  | Wider than 432 px                                     | 32          | 198      |
| `viewport`   | 1280 × 800, 1440 × 900, 560 × 400, or 560 × 900       | 26          | 166      |
| `phone-page` | 390 px wide and taller than 640 px. Lab only          | 0           | 0        |
| `full-page`  | 1280 or 1440 px wide and taller than 900 px. Lab only | 0           | 0        |

`getFitZoom` returns 1, 2, 3, or 4 for an image that fits, and the `maximum` option sets the largest value. The app today never enlarges an image. In a stage of 1146 × 468, the function gives 2 for 406 screenshots, 3 for 13, 1 for 140, and a fraction for 67.

### Runs

- `getRunTitle(run)` is the line that names a run: the title, else the commit message, else `Pull request` or `Main`. Put the number before it.
- `groupRunsByPullRequest(runs)` returns `[{ id, kind, pullRequestNumber, runs, latest, commits }]` in the order of the list. A main run is a group of its own. The full history gives 41 groups for 100 rows.
- `filterRuns(runs, { query, state })` matches the pull request number and the SHA. In `improved` mode it also matches the title, the branch, the author, and the commit message.

## Lab-only synthetic scenes

No page scenario uses these images. They are SVG data URIs for sizes that production does not have, for example a tall page of 800 × 1600. Use them only when a component surface must show such a size, and say so in the `tradeoffs` of the variant.

```tsx
const image = getScreenshot({ scene: "form", scheme: "dark", state: "current" });
const set = getScreenshotSet({ scene: "dialog", scheme: "light" });
// set.baseline, set.current, set.diff, set.diffPreview, set.regions,
// set.changedPixels, set.ratio, set.sizeChanged
```

- `state`: `baseline` (default), `current`, `diff` (the mask), `diffPreview`.
- `scheme`: `light` (default) or `dark`. Optional `contrast: "more"` and `forcedColors: "active"` change the palette.
- `scenes` lists the 14 scenes with `id`, `title`, `size`, `width`, `height`, `change`, and `regions`. The sizes are 320 × 120, 640 × 400, 1280 × 720, and 800 × 1600.
- A scene is sharp at every zoom, and its mask marks every pixel for a size change. A production image does neither.

## Text helpers

- Time: `formatRelativeTime(timestamp)` (`12 min ago`), `formatDateTime(timestamp)` (`Oct 5, 15:18`), `formatDate(timestamp)`, `formatDuration(milliseconds)` (`4m 12s`).
- Numbers: `formatRatio(ratio)` (`0.15%`, or `<0.01%`), `formatBytes(bytes)` (`5.5 MiB`), `shortSha(sha)`.
- Labels: `runStateLabel(state)`, `runKindLabel(kind)`, `variantStatusLabel(variant)`. A design can use its own words.

## State hooks

The state hooks make a variant interactive without logic of its own. Each hook takes the scenario identifier of `VariantProps`, reads the fixtures in the current data mode, and returns plain data and actions. The state is local React state: no network and no storage. Every hook renders on the server.

Import from `src/fixtures/hooks/index.ts`. From `src/explorations/pages/<surface>/<variant>.tsx`, the path is:

```tsx
import { useReviewSession, useReviewShortcuts } from "../../../fixtures/hooks/index.ts";
import type { SessionItem } from "../../../fixtures/hooks/index.ts";
```

The live reference is the `/dev/hooks` route. A query parameter opens a scenario: `/dev/hooks?review=large&inbox=empty&data=today`. The parameters are `review`, `inbox`, `history`, `status`, `pull`, `signIn`, and `data`.

| Hook                                    | Status values                                     | Main parts                                                                   |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `useReviewSession(scenario, options?)`  | `loading`, `error`, `ready`                       | Items, families, filters, selection, viewer, decisions, save, Undo, progress |
| `useReviewShortcuts(session, options?)` |                                                   | The review keys of the app, bound to a session                               |
| `useViewer(subject?, options?)`         |                                                   | Mode, zoom, overlay, swipe, blink, highlight                                 |
| `useInbox(scenario, options?)`          | `loading`, `error`, `ready`, `empty`, `first-use` | Runs in three sections, counts, text filter, refresh                         |
| `useHistory(scenario, options?)`        | `loading`, `error`, `ready`, `empty`              | Search, result filter, sorting, counts for each result                       |
| `useStatus(scenario, options?)`         | `loading`, `error`, `ready`                       | Alerts, acknowledge, dismiss, last check, refresh                            |
| `usePull(scenario, options?)`           | `loading`, `error`, `ready`                       | The pull request, runs by commit and attempt, the run to review              |
| `useSignIn(scenario, options?)`         | `guest`, `signing-in`, `forbidden`, `error`       | A sign-in action with a simulated wait                                       |
| `useSimulatedLoad(options?)`            | `idle`, `loading`, `ready`, `error`               | A fake request with a chosen latency                                         |

Rules for every hook:

- Narrow the result on `status` before you read the data.
- A new scenario, or a new data mode, resets the state of the hook. The component does not mount again.
- `refresh()` starts a simulated request and sets `refreshing` for 700 milliseconds (`refreshLatency`). The status does not change, so a design can keep the content on screen. The app today blanks the page: to copy that, treat `refreshing` as `loading`.
- A `loading` scenario stays in `loading`. For a load that ends, use `useSimulatedLoad`.
- A member with the note "not in the app today" has no backend yet. List it in the `tradeoffs` of your variant.
- `useReviewShortcuts` listens on the document. A component surface can show several variants in one document: pass `scope` there, or do not call the hook.

### `useReviewSession`

```ts
function useReviewSession(scenario: string, options?: ReviewSessionOptions): ReviewSession;

interface ReviewSessionOptions {
  /** `status` lists the items by group. `declared` keeps the run order. Default: `status`. */
  order?: "status" | "declared";
  /** After a decision, go to the next variant that needs review. Default: true. */
  autoAdvance?: boolean;
  /** Milliseconds in `saving` (450), in `saved` (1600), and of a refresh (700). */
  saveLatency?: number;
  savedDuration?: number;
  refreshLatency?: number;
}
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const session = useReviewSession(scenario);
  useReviewShortcuts(session);
  if (session.status !== "ready") return <Text>{session.status}</Text>;
  const { item, variant, progress, can, save } = session;
  return (
    <Frame $p={4} className="grid gap-3">
      <Text>{`${item?.label} · ${variant?.name} · ${progress.remaining} left · ${save.status}`}</Text>
      {variant?.candidate && <img src={variant.candidate.url} alt={variant.name} />}
      <Button disabled={!can.reject} onClick={() => session.reject()}>
        Reject
      </Button>
      <Button disabled={!can.approve} onClick={() => session.approve()}>
        Approve
      </Button>
      <Button disabled={!can.undo} onClick={session.undo}>
        Undo
      </Button>
    </Frame>
  );
}
```

The item list by family. Only a family with something to review renders its rows, so a run with 3 changed screenshots renders 26 family rows and 106 item rows:

<!-- prettier-ignore -->
```tsx
{session.families.map((family) => (
  <section key={family.family}>
    <Text>{`${family.label} · ${family.counts.changedItems} changed of ${family.counts.items}`}</Text>
    {family.counts.undecided > 0 &&
      family.items.map((item) => (
        <Button
          key={item.key}
          aria-current={item.key === session.item?.key ? "true" : undefined}
          onClick={() => session.selectItem(item.key)}
        >
          {`${item.label} · ${item.counts.undecided} of ${item.counts.reviewable}`}
        </Button>
      ))}
  </section>
))}
```

The `ready` result:

| Part       | Members                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run        | `review` (the `ReviewRun` with the local verdicts, and with the fields of the data mode: no `counts` in `today` mode), `run`, `user`, `counts` (`RunCounts`, in every data mode), `complete` (nothing waits for a verdict or a comparison)                        |
| Lists      | `items` (every item, run order), `visibleItems` (after the filters, navigation order), `groups` (six status groups with `id`, `items`, `total`), `families` (the visible items by family with counts), `queue` (the matching variants of the visible items, flat) |
| Item       | `SessionItem` is a `ReviewItem` with `index`, `status`, `counts` (`total`, `reviewable`, `undecided`, `approved`, `rejected`, `unchanged`, `problems`, `comparing`), `family`, `group`, `leaf`, `label`, `matches`, `attention`, and the optional `thumbnail`     |
| Variant    | `SessionVariant` is a `ReviewVariant` with `itemKey`, `itemName`, `index`, `name` (the short label, `Chromium · Dark`), `axes`, `status`, `reviewable`, `automatic`                                                                                               |
| Filters    | `filters` (`query`, `status`, `kind`, `browser`, `framework`, `colorScheme`, `family`), `filtered`, `facets` (the variant count behind each option), `setFilters(partial)`, `setQuery(text)`, `resetFilters()`                                                    |
| Selection  | `selection`, `item`, `variant`, `position` (`item`, `itemCount`, `variant`, `variantCount`, `queue`, `queueCount`), `select(target)`, `selectItem(itemKey)`, `selectVariant(key or position)`                                                                     |
| Navigation | `nextItem()`, `previousItem()`, `nextVariant()`, `previousVariant()`, `next()` and `previous()` (through `queue`, across items), `nextUndecided()`, `previousUndecided()`                                                                                         |
| Decisions  | `approve(targets?)`, `reject(targets?)`, `clear(targets?)`, `approveItem(itemKey?)`, `rejectItem(itemKey?)`, `approveRemaining("run" or "visible")`                                                                                                               |
| Abilities  | `can.decide`, `can.approve`, `can.reject`, `can.clear`, `can.approveItem`, `can.rejectItem`, `can.approveRemaining`, `can.undo`. Use them for `disabled`                                                                                                          |
| Save       | `save.status` (`idle`, `saving`, `saved`, `error`), `save.pending`, `save.failed`, `save.failsNext`, `failNextSave()`, `retrySave()`, `discardFailedSave()`                                                                                                       |
| Undo       | `history` (the commands, oldest first), `lastCommand`, `undo()`. A `ReviewCommand` has `action`, `scope`, `targets`, `selection`, `itemName`, `variantName`                                                                                                       |
| Progress   | `progress.total` (variants that take a verdict), `decided`, `approved`, `rejected`, `remaining`, `automatic`, `ratio` (0 to 1), `byKind.changed`, `byKind.added`, `byKind.removed`, `items` (`total`, `remaining`, `done`)                                        |
| Read-only  | `readOnly`, `readOnlyKind` (`archived`, `superseded`, `expired`, `comparing`, `failed`, `stale`), `readOnlyReason` (a sentence, or null)                                                                                                                          |
| Other      | `viewer` (see `useViewer`), `announcement` (the latest event as a sentence, for a live region), `shortcutsEnabled`, `setShortcutsEnabled(enabled)`, `refresh()`, `refreshing`                                                                                     |

What a session item and a session variant have in every data mode: `item.family`, `item.group`, `item.leaf`, `item.label`, `variant.name`, `variant.axes`, and `session.counts`. `item.displayName`, `item.thumbnail`, `variant.thumbnail`, `variant.regions`, and `variant.diffPreview` are optional, because `today` mode does not have them.

How it behaves:

- **Status.** A variant and an item have one `ReviewStatus`: `problem`, `needs-review`, `comparing`, `rejected`, `approved`, or `unchanged`. An item takes the first status in this order that one of its variants has. `reviewStatusOrder`, `reviewStatusLabels`, and `reviewStatusRoles` describe them. `groups` has one group for each status, in this order. Skip the empty groups. In a production run, the group `unchanged` has 623 items.
- **Decisions.** Only changed, added, and removed variants take a verdict. Each call is one command. A whole-item command also changes the variants that have a verdict, as in the app. A decision that changes nothing does nothing: use `can` to disable its control.
- **Selection after a decision.** When the decision covers the selection, the selection moves to the next variant in `queue` that needs review, and it wraps one time. If none is left, the selection stays. A decision on other variants, for example from a grid, leaves the selection in place: `session.approve(variant)`.
- **Save.** The verdict shows at once. `save.status` goes from `saving` to `saved`, then back to `idle`. Quick decisions save as one batch, and `save.pending` counts them.
- **Undo.** `undo()` takes back the last command and restores its verdicts and its selection.
- **Failed save.** After `failNextSave()`, the next save ends in `error`: the decisions are taken back, the selection returns, and new decisions are blocked until `retrySave()` or `discardFailedSave()`.
- **Filters.** `query` reads the key and the label of an item: every word must be in one of them. The other filters select variants, except `family`, which selects items. An item is visible when one of its variants matches, and `item.matches` has these variants. Each number in `facets` applies the other filters, so it is the size of the list after a click. `facets.family` has one entry for each family.
- **Read-only.** In a run that takes no decisions, every decision does nothing and `readOnlyReason` says why. The scenarios `clean`, `read-only`, and `expired` have the kind `superseded` or `expired`.
- **Run status.** `run.status` follows the local verdicts. It becomes `passed` when nothing is open.
- **Object identity.** An item object changes only when one of its verdicts changes. A row that is memoized by its item does not render again after a decision on another item. A filter that changes the matching variants of an item gives that item a new object.
- **First selection.** The selection starts at the first variant in `queue` that needs review. A run without such a variant starts at the first variant in `queue`. In `problems`, the first group is `problem`, and the selection starts in the next group: `page/default`, Firefox dark.
- **Failed comparisons.** A variant with the kind `error` or `pending` takes no verdict. `page/danger` in `problems` has the status `problem` and `counts.reviewable` of 0. To list every screenshot that is not unchanged, test `item.status !== "unchanged"`.
- **Family labels.** A family keeps its label under every filter.

Not in the app today:

- `clear` and `approveRemaining`.
- The filters `kind`, `browser`, `framework`, `colorScheme`, and `family`, the status filters other than needs review, approved, and rejected, and `facets`.
- A search that reads names only. The app also searches variant keys and labels, so `dark` matches 619 of 626 screenshots.
- Six groups, and `families`. The app has a main list and an `Accepted` section. `item.attention` is true for an item of the main list.
- Undo while a save runs. The app blocks Undo until the server confirms.
- A next variant inside the filters. The app searches the whole run in run order.
- `regions`, the viewer modes `overlay`, `swipe`, and `blink`, the zooms 50%, 300%, and 400%, and the highlight.

### `useReviewShortcuts`

```ts
function useReviewShortcuts(session: ReviewSession, options?: ReviewShortcutOptions): void;

interface ReviewShortcutOptions {
  /** Default: true. The keys are also off while `session.shortcutsEnabled` is false. */
  enabled?: boolean;
  /** Also binds the keys that only the lab has. Default: true. */
  labKeys?: boolean;
  /** Limits the keys to events from inside this element. Default: the document. */
  scope?: RefObject<HTMLElement | null>;
  /** More keys by lowercase `event.key`. They win over the built-in keys. */
  keys?: Record<string, (event: KeyboardEvent) => void>;
}
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const session = useReviewSession(scenario);
  const [sidebar, setSidebar] = useState(true);
  useReviewShortcuts(session, { keys: { "\\": () => setSidebar((open) => !open) } });
  if (session.status !== "ready") return null;
  return (
    <Frame $p={4} className="grid gap-2">
      <Button onClick={() => session.setShortcutsEnabled(!session.shortcutsEnabled)}>
        {session.shortcutsEnabled ? "Keys on" : "Keys off"}
      </Button>
      {sidebar &&
        reviewShortcuts.map((shortcut) => (
          <Text key={shortcut.id}>{`${shortcut.keys.join(" ")}: ${shortcut.label}`}</Text>
        ))}
    </Frame>
  );
}
```

`reviewShortcuts` lists every key with `id`, `keys`, `label`, `group` (`navigate`, `decide`, `view`), and `origin` (`app` or `lab`). Render a keyboard help from it.

| Keys                  | Action                                                           | In the app today |
| --------------------- | ---------------------------------------------------------------- | ---------------- |
| Up / Down             | Previous or next item in `visibleItems`. Stops at each end       | Yes              |
| Left / Right          | Previous or next variant of the item. Stops at each end          | Yes              |
| `1` to `9`            | The variant at that position                                     | `1` to `6`       |
| `A` / `X`             | Approve or reject, then go to the next variant that needs review | Yes              |
| `Shift+A` / `Shift+X` | Approve or reject the whole item                                 | Yes              |
| `S` / `D` / `F` / `G` | Side by side, pixel diff, new image only, baseline only          | Yes              |
| `Cmd/Ctrl+Z`          | Undo                                                             | Yes              |
| `J` / `K`             | Next or previous variant in `queue`                              | No               |
| `N` / `Shift+N`       | Next or previous variant that needs review                       | No               |
| `U`                   | Clear the verdict                                                | No               |
| `O` / `W` / `B`       | Overlay, swipe, blink                                            | No               |
| `H`                   | Highlight on or off                                              | No               |
| `+` / `-` / `0`       | Zoom in, zoom out, fit                                           | No               |

- A held key does not repeat. Keys with Alt do nothing. Text fields, selects, menus, list boxes, sliders, and dialogs keep their own keys. Add `data-shortcuts-ignore` to another element that must keep its keys.
- The keys `1` to `9` reach every variant of 591 screenshots. 35 screenshots have 12 or 24 variants.
- The app also binds `[` to collapse the screenshot sidebar. The lab uses `[` and `]` to change the variant, so the hook does not bind them. Bind another key with `keys`.
- The app ignores every review key while the focus is in its variant strip or in a tab list, so `A` does nothing after a click on a variant. The hook does not copy this: a widget that uses an arrow key prevents its default action, and the hook skips prevented events.

### `useViewer`

`session.viewer` is this state for the selected variant. Call the hook directly in a component surface that has no session.

```ts
function useViewer(subject?: ViewerSubject | null, options?: ViewerOptions): Viewer;

/** A `ReviewVariant` fits. For a `ScreenshotSet`, pass `baseline` and `current`. */
interface ViewerSubject {
  id?: string;
  reference: object | null;
  candidate: object | null;
  regions?: ChangedRegion[];
}
/** The first values: `mode`, `zoom`, `highlight`, `overlayOpacity`, `swipePosition`, `blinkInterval`. */
```

```tsx
export default function Variant() {
  const { variant } = useReviewSample("card");
  const viewer = useViewer(variant, { mode: "overlay" });
  const { candidate, diff } = variant;
  if (!candidate) return null;
  // The largest whole-number zoom at which the card fits a stage of 1146 x 468.
  const zoom = getFitZoom(candidate, { width: 1146, height: 468 });
  return (
    <div className="relative" style={{ width: candidate.width * zoom }}>
      <img src={candidate.url} alt="Current" className="w-full [image-rendering:pixelated]" />
      {viewer.effectiveMode === "overlay" && diff && (
        <img
          src={diff.url}
          alt=""
          className="absolute inset-0 size-full [image-rendering:pixelated]"
          style={{ opacity: viewer.overlayOpacity }}
        />
      )}
      <Button onClick={() => viewer.setOverlayOpacity(viewer.overlayOpacity - 0.2)}>Fade</Button>
    </div>
  );
}
```

| State                      | Meaning                                                                                                | Actions                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `mode`, `effectiveMode`    | `side`, `diff`, `new`, `original`, and for the lab `overlay`, `swipe`, `blink`. Render `effectiveMode` | `setMode(mode)`                                                   |
| `available`                | The modes that the images support. `diff`, `overlay`, `swipe`, and `blink` need both images            |                                                                   |
| `zoom`, `scale`            | `fit`, `0.5`, `1`, `2`, `3`, `4`. `scale` is the factor, or null for `fit`                             | `setZoom(zoom)`, `zoomIn()`, `zoomOut()`                          |
| `overlayOpacity`           | The opacity of the layer on top, from 0 to 1                                                           | `setOverlayOpacity(value)`                                        |
| `swipePosition`            | The divider from the start edge, from 0 to 1                                                           | `setSwipePosition(value)`                                         |
| `blinkSide`, `blinkPaused` | `reference` or `candidate`. It alternates by itself in `blink` mode, each `blinkInterval` milliseconds | `setBlinkPaused(paused)`, `flipBlink()`, `setBlinkInterval(time)` |
| `highlight`                | `none`, `mask` (draw `variant.diff`), or `regions` (draw `variant.regions`)                            | `setHighlight(kind)`, `toggleHighlight()`                         |
| `region`, `regionCount`    | The focused changed region, or null. A new subject clears it. `regionCount` is 0 in `today` mode       | `nextRegion()`, `previousRegion()`, `setRegion(index)`            |

Mode and zoom stay when the selection changes, as in the app. When the chosen mode needs an image that the variant does not have, `effectiveMode` is `side`, and `setMode` ignores a mode that is not available. `viewerModes` and `viewerZooms` list the values. `fit` has no scale of its own: the app today scales a large image down and never enlarges a small one. `getFitZoom(image, stage)` gives the zoom that also enlarges. `/dev/hooks` draws each technique from this state.

### `useInbox`

```ts
function useInbox(scenario: string, options?: { refreshLatency?: number }): Inbox;
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const inbox = useInbox(scenario);
  if (inbox.status === "loading") return <Text>Loading</Text>;
  if (inbox.status === "error") return <Button onClick={inbox.refresh}>{inbox.message}</Button>;
  if (inbox.status === "first-use") return <Text>No baseline yet</Text>;
  if (inbox.status === "empty") return <Text>All done</Text>;
  return (
    <div className="grid gap-3">
      <Input
        aria-label="Filter"
        value={inbox.query}
        onChange={(event) => inbox.setQuery(event.target.value)}
      />
      {inbox.groups.map((group) => (
        <Text key={group.id}>
          {`${inboxGroupLabels[group.id].plain} (${group.total}): ${group.runs.map(getRunTitle).join(", ")}`}
        </Text>
      ))}
      <Button disabled={inbox.refreshing} onClick={inbox.refresh}>
        Refresh
      </Button>
    </div>
  );
}
```

- `status`: `ready` (a run needs a decision or attention), `empty` (no run, and a baseline exists), `first-use` (no run and no baseline). These three have every member below.
- `groups`: `review` (`needs-review`, `rejected`), `progress` (`incomplete`, `comparing`), and `attention` (`failed`, `needs-recompare`), as in the app. Each has `runs` (after the text filter) and `total`. `getInboxGroup(run)`, `inboxGroupOrder`, and `inboxGroupLabels` describe them. The busy inbox has 4, 2, and 2 runs.
- `counts`: `runs`, `visible`, `review`, `progress`, `attention`, `pending` (variants that are not accepted), `rejected`.
- `query`, `setQuery(text)`, `filtered`, `visibleRuns`. The text filter is not in the app today. In `today` mode it matches only the number and the SHA.
- `runs`, `recentRuns`, `repository`, `baseline`, `user`, `alertCount`, `refresh()`, `refreshing`, `refreshCount`.

### `useHistory`

```ts
function useHistory(scenario: string, options?: { refreshLatency?: number }): History;
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const history = useHistory(scenario);
  if (history.status === "loading" || history.status === "error") {
    return <Text>{history.status}</Text>;
  }
  if (history.status === "empty") return <Text>No runs yet</Text>;
  return (
    <div className="grid gap-3">
      <Input
        aria-label="Search"
        value={history.query}
        onChange={(event) => history.setQuery(event.target.value)}
      />
      {history.states.map((state) => (
        <Button key={state} onClick={() => history.setFilter(state)}>
          {`${runStateLabels[state].short} ${history.counts[state]}`}
        </Button>
      ))}
      <Button onClick={() => history.toggleSort("changes")}>Most changes</Button>
      {history.noMatch && <Button onClick={history.resetFilters}>No match. Reset</Button>}
      {groupRunsByPullRequest(history.visibleRuns).map((group) => (
        <Text key={group.id}>
          {`${group.pullRequestNumber ? `#${group.pullRequestNumber} · ` : ""}${getRunTitle(group.latest)} · ${formatCount(group.runs.length, "run")}`}
        </Text>
      ))}
    </div>
  );
}
```

- `query` and `filter` (a `RunState` or `all`) start from the scenario: `no-match` starts with the query `datepicker`. `setQuery(text)`, `setFilter(state)`, `resetFilters()`, `filtered`, `noMatch`.
- `sort` is `{ key, direction }`. The keys are `created`, `title`, `state`, `changes`, and `duration`. `toggleSort(key)` sorts by a column, and a second call turns the direction around. `setSort(sort)` sets both. The app today has the order newest first only. In `today` mode a run has no title, no counts, and no duration: `changes` then sorts by `pending`, and `duration` keeps the time order.
- `visibleRuns` is `runs` after the query, the filter, and the sorting. `counts` has the number of runs for each result and for `all`, with the query applied. `states` lists the results that the loaded runs have.
- `groupRunsByDay(history.visibleRuns)` gives date headings (`Today`, `Yesterday`, `Oct 3`) for a list that is sorted by time. `groupRunsByPullRequest(history.visibleRuns)` gives one group for each pull request.

### `useStatus`

```ts
function useStatus(scenario: string, options?: { refreshLatency?: number }): Status;
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const status = useStatus(scenario);
  if (status.status !== "ready") return <Text>{status.status}</Text>;
  return (
    <div className="grid gap-3">
      <Text>{`${status.health} · checked ${formatRelativeTime(status.checkedAt)}`}</Text>
      {status.alerts.map((alert) => (
        <Frame
          key={alert.id}
          $layer={alert.role === "neutral" ? true : alert.role}
          $mix={15}
          $p={3}
        >
          <Text>{alert.title}</Text>
          <Button onClick={() => status.acknowledge(alert.id)}>Acknowledge</Button>
          <Button onClick={() => status.dismiss(alert.id)}>Dismiss</Button>
        </Frame>
      ))}
      <Button disabled={status.refreshing} onClick={status.refresh}>
        Check now
      </Button>
    </div>
  );
}
```

- `alerts`: each `StatusAlert` is a `ServiceAlert` with `id`, `role`, and `acknowledged`. `dismissed` has the alerts that a person hid. `role` is `danger` for a `critical` alert and `warning` for every other alert. The API today has no severity, so every alert is a `warning` in `today` mode.
- `health`: `critical`, `warning`, or `healthy`, from the alerts that are not acknowledged and not dismissed. It is never `critical` in `today` mode. `serviceHealthRoles` gives its color role.
- `acknowledge(id, acknowledged?)`, `acknowledgeAll()`, `dismiss(id)`, `restore(id?)`. They are local state and not in the app today: its alert list is read-only.
- `counts`: `total`, `critical`, `warning` (every alert that is not critical), `open`, `acknowledged`, `dismissed`.
- `checkedAt` is the time of the last check. `refresh()` sets it to the present. `hasMore`, `capacity`, `guideUrl`, `user`.

### `usePull`

```ts
function usePull(scenario: string, options?: { refreshLatency?: number }): Pull;
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const pull = usePull(scenario);
  if (pull.status !== "ready") return <Text>{pull.status}</Text>;
  const { reviewRun, commits, outcome } = pull;
  const title = pull.pull.title ?? "Pull request";
  return (
    <div className="grid gap-3">
      <Text>{`#${pull.pull.number} ${title} · ${pullOutcomeLabels[outcome].plain}`}</Text>
      {reviewRun && (
        <Button $layer="brand">{`Review ${formatCount(reviewRun.pending, "variant")}`}</Button>
      )}
      {commits.map((commit) => (
        <Text key={commit.sha}>
          {`${shortSha(commit.sha)}: ${commit.attempts.map((run) => runStateLabels[run.state].short).join(", ")}`}
        </Text>
      ))}
    </div>
  );
}
```

- `pull` is the `PullRequest`. In `today` mode it has only `number`, `repository`, `capture`, and `runId`.
- `runs` has every run, newest first, in every mode. In `today` and `decided` mode the runs come from the run list.
- `commits` groups the runs by tested commit, newest commit first. Each has `sha`, `head` (the current head commit), `attempts` (newest first), and `latest`.
- `latestRun` is the newest run or null. `reviewRun` is the newest run that takes decisions now (`needs-review` or `rejected`) or null. `earlierRuns` has every run but the newest.
- `outcome` is one state for the page: the state of the newest run, or `waiting`, `capture-failed`, or `not-required` without a run. `pullOutcomeLabels` and `pullOutcomeRoles` describe it.

### `useSignIn`

```ts
function useSignIn(scenario: string, options?: SignInOptions): SignIn;

interface SignInOptions {
  /** Milliseconds from `signIn()` to the redirect. Default: 1200. */
  latency?: number;
  /** Runs when the wait ends, where the app leaves for GitHub. */
  onRedirect?(): void;
}
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const router = useRouter();
  const inbox = useLabHref("inbox", "busy");
  const signIn = useSignIn(scenario, { onRedirect: () => router.navigate({ href: inbox }) });
  if (signIn.status === "forbidden") {
    const account = signIn.user
      ? `${signIn.user.login} has no access`
      : "This account has no access";
    return <Button onClick={signIn.switchAccount}>{account}</Button>;
  }
  if (signIn.status === "error") {
    return (
      <Button disabled={signIn.retrying} onClick={signIn.retry}>
        {signIn.message}
      </Button>
    );
  }
  return (
    <Button disabled={signIn.status === "signing-in"} onClick={signIn.signIn}>
      {signIn.status === "signing-in" ? "Opening GitHub" : "Sign in with GitHub"}
    </Button>
  );
}
```

- `signIn()` works from `guest`. The status becomes `signing-in`, and after the latency `redirected` becomes true and `onRedirect` runs. The status stays `signing-in`, as the app is on GitHub at this point.
- The `signing-in` scenario is a still state. It never redirects.
- `switchAccount()` goes from `forbidden` to `guest`. `retry()` sets `retrying` for the latency after an `error`. `reset()` returns to the first state of the scenario.
- `message` is present for `forbidden` and `error`, and `reference` for `error`. `repository` and `user` are present in `improved` mode only, because a request without access returns no data today.

### `useSimulatedLoad`

```ts
function useSimulatedLoad(options?: SimulatedLoadOptions): SimulatedLoad;

interface SimulatedLoadOptions {
  /** Milliseconds from the start to the result. Default: 800. */
  latency?: number;
  /** Start on mount. With false, the status is `idle` until `restart()`. Default: true. */
  autoStart?: boolean;
  /** End with `error` instead of `ready`. */
  fail?: boolean;
}
```

```tsx
export default function Variant({ scenario }: VariantProps) {
  const load = useSimulatedLoad({ latency: 1200 });
  const inbox = useInbox(load.status === "ready" ? scenario : "loading");
  if (load.status === "error") return <Button onClick={load.restart}>Retry</Button>;
  if (inbox.status === "loading") return <Text>Loading</Text>;
  return <Button onClick={load.restart}>{`Loaded as ${inbox.status}. Load again`}</Button>;
}
```

The result has `status` (`idle`, `loading`, `ready`, `error`), `attempt` (the number of loads that started), `restart()` (starts a load from any state), and `reset()` (back to `idle`). The server render shows `loading` when `autoStart` is on. The hook has no data: pair it with a data hook or a state hook, as the example does. The real run page takes 6.7 to 7.8 seconds to show content.

### Labels, color roles, and formatters

The hooks module exports these pure helpers, and `src/fixtures/index.ts` exports them too (all but `sortRuns`). The hooks module also exports `formatRelativeTime` and `shortSha` again. So one import is enough for a page with a data hook, and for a page with a state hook.

| Export                                                          | Result                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `formatCount(count, singular?, plural?)`                        | `formatCount(3832)` gives `3,832`. `formatCount(9, "variant")` gives `9 variants`. It does not read the locale         |
| `runStateLabels[state]`                                         | `{ short, plain }`, for example `Replaced` and `Replaced by a newer run`. `short` fits a badge                         |
| `runStateRoles[state]`                                          | A `ColorRole`: `success`, `warning`, `danger`, or `neutral`                                                            |
| `runStateOrder`                                                 | The run states in the order of a filter or a legend                                                                    |
| `runKindLabels[kind]`                                           | `PR` and `Pull request`, `Main` and `Main branch`                                                                      |
| `variantKindLabels[kind]`, `variantKindRoles[kind]`             | `Changed`, `New`, `Removed`, `Same`, `Comparing`, `Error`. New is `success`, removed is `danger`, changed is `warning` |
| `reviewStatusLabels[status]`, `reviewStatusRoles[status]`       | The review status of a variant or an item. `getVariantStatus(variant)` computes it for a plain `ReviewVariant`         |
| `alertSeverityLabels[severity]`, `alertSeverityRoles[severity]` | `Critical` is `danger`. `Warning` is `warning`                                                                         |
| `getRunTitle(run)`                                              | The title, else the first line of the commit message, else `Pull request` or `Main`                                    |
| `getRunChangeCount(run)`                                        | Changed, added, and removed variants, or null without counts (always null in `today` mode)                             |
| `groupRunsByDay(runs)`                                          | `[{ id, label, runs }]` by UTC day, with the labels `Today`, `Yesterday`, or a date                                    |
| `groupRunsByPullRequest(runs)`                                  | `[{ id, kind, pullRequestNumber, runs, latest, commits }]`, one group for each pull request                            |
| `sortRuns(runs, sort)`                                          | A sorted copy, with the sort of `useHistory`                                                                           |

For a layer prop, map the neutral role to the parent color: `$layer={role === "neutral" ? true : role}`.

## Performance

The fixture layer stays fast with 626 screenshots and 3,832 variants. These numbers are from one machine, with Node 24 for the model and Chrome with the development build of React for the pages.

| Measure                                                             | Result                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| First build of a run in one data mode (626 items, 3,832 variants)   | 9 ms in `improved` mode, 5 ms in `today` mode                    |
| Each later run in the same mode                                     | 0.1 to 2.3 ms                                                    |
| First session state of `useReviewSession`                           | 6 to 8 ms                                                        |
| One selection, in the model                                         | Less than 0.01 ms                                                |
| One decision or one Undo, in the model                              | 0.3 to 0.5 ms                                                    |
| One filter change, in the model                                     | 0.2 to 1.1 ms                                                    |
| Server render of a page with one plain row for each screenshot      | 16 ms. The same route without a run takes 10 ms                  |
| First client render of 626 plain rows, with the run and the session | 32 to 40 ms                                                      |
| One decision on that page, from the key press to the commit         | 4 to 13 ms. The list renders one time, and one row renders again |
| One selection on that page                                          | 1 to 14 ms. Two rows render again                                |
| A filter change that adds 500 rows to that page                     | 4 to 28 ms                                                       |
| JavaScript of the fixtures and the hooks, minified                  | 248 KB (65 KB with gzip). The generated census is 134 KB of it   |

What this means for a design:

- The fixtures are not the cost. The rows are. A list with one memoized plain row for each screenshot spends about 10 ms for each decision, because React compares 626 rows. It spends much more when a row is not memoized, or has an image or several primitives.
- Group the screenshots by family and keep the families without changes closed, or render only the rows in view. `session.families` and `session.groups` give the groups.
- Memoize a row by its item. An item object changes only when one of its verdicts changes.
- Do not put 626 `img` elements in the document. Load an image when its row is in view (`loading="lazy"`), and give each `img` its `width` and `height`.
- `useReviewSession` returns a new object for each render. Pass `session.item`, `session.variant`, and the action functions to children, not the whole session. The action functions of the session (`approve`, `selectItem`, and so on) keep their identity. `refresh` and the actions of `viewer` do not.
- The component that calls `useReviewSession` renders three times for one decision: at the decision, when the save ends (450 ms), and when `saved` returns to `idle` (1.6 s). In `blink` mode it renders at each blink. Keep the list in a memoized child.

`/dev/fixtures?view=list&scenario=changes` is a plain page with one row for each screenshot. The server number is from that page. The browser numbers are from a page of the same kind with a memoized row.

## How the data is made

`apps/lab/src/fixtures/real/generate.mjs` reads the data of the audit lane `gap-real-data` (the census of the Ariakit consumer, six run answers in the wire format of the API, and the image files) and writes:

- `apps/lab/public/fixtures`: the baseline images, the current images, the masks, the diff previews, and the thumbnails.
- `src/fixtures/real/census.ts`: the 626 screenshots, their 66 distinct variant keys, and the image table.
- `src/fixtures/real/changes.ts`: the changed part of each run, and the regions of each mask.

A run answer of the API has 5 MB, and 99% of it is the same unchanged inventory. The lab keeps the inventory one time and each run as a short list of changes. `src/fixtures/data/review-base.ts` and `src/fixtures/data/review.ts` build the runs from them.

```sh
node apps/lab/src/fixtures/real/generate.mjs --source <the gap-real-data directory>
pnpm exec oxfmt apps/lab/src/fixtures/real
```

Limits of the data:

- The pictures are Chrome captures on macOS. Firefox and WebKit variants show the Chrome picture, and forced-colors variants show the normal picture.
- The audit data shows a size change with the picture of the other color scheme. The generator replaces it: the current image is the baseline with its middle row repeated.
- The changes are injected CSS rules, not real pull requests.
- The order of the screenshots is the order that the audit inferred from the consumer. Only the first screenshot is confirmed.
- Identifiers and digests are synthetic. The identifier of a variant is the same in every scenario.
- The share of closed attempts in the history, and the titles, the authors, and the counts of the `improved` mode, are invented.
