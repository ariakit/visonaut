# Page load strategy (page-load)

Group: system
Question: What should a page show while its data loads?
Description: How the Queue and a run page fill in over time, replayed at a chosen latency in a shared Load stage over the same neutral pages.
Layout: stack

## Scenarios

- `queue-fast` (Queue, 0.3 s): Cold load of the Queue with the target backend: the list arrives in 300 ms, so nothing may flash.
- `run-fast` (Run, 0.3 s): Click on #4863 in the Queue: the run arrives in 300 ms and the first screenshot pair at 900 ms.
- `queue-slow` (Queue, 2.5 s): Cold load of the Queue at the wait that was measured today (1 to 3 s).
- `run-slow` (Run, 6 s): Click on the large run (120 screenshots, 600 variants) at the wait that was measured today (5 to 7 s); images need 600 ms more.
- `return` (Back to Queue): Back from a run: the list of 4 minutes ago is in memory, and the fresh list (one new run, one changed run) arrives in 2 s.
- `fails` (Fails at 3 s): The request ends after 3 s with a service error and the Error ID req_01JZ8Q2N5K.
- `signed-out` (Ends signed out): A check link opened without a session: the answer at 1.2 s is the sign-in step, so no app chrome may be promised.
- `phone` (Phone, 4 s): The check link of #4863 on a 390 px screen with a 4 s wait.

## Variant `hold-and-mark`: Hold and mark

The old page stays on screen with a 2 px line and a ring on the clicked row; a cold load shows the header and the line only.

Ideas:

- Minimal: no skeleton and no placeholder geometry to maintain.
- The clicked row carries the wait, so the eye stays where it clicked (SHELL-04 alternative).
- Back keeps the run on screen until the Queue is ready, then restores the scroll position.
- Words appear only after 3 s.

Tradeoffs:

- A cold load is still an empty page under the line for the whole wait (2.5 to 6 s today).
- A held page can look frozen if the reader misses the row ring.
- Esc as cancel is a new key meaning; it follows the browser Stop and does not touch rule K15.

### Spec

```text
click on a run row (run-*)          cold load (queue-*, phone)
+-------------------------------+   +-------------------------------+
| (o) Queue History Status  DH  |   | (o) Queue History Status  DH  |
|=====-      2 px line          |   |=====-                         |
| To review · 4                 |   |                               |
| * #4863 Migrate comp...  (o)  |   |    Still loading…    (3 s)    |
| * #4831 Update depend...  79  |   |    [ Reload ]       (12 s)    |
+-------------------------------+   +-------------------------------+
```

**Stage.** The shared Load stage of this surface (notes 2). L is the latency of the scenario.

**Build.**

- Line: `Progress` without `value`, `$thickness={0.5}`, `aria-label='Loading'`, `absolute inset-x-0 bottom-0` in a `relative` `ShellHeader`. It mounts at 150 ms.
- Pending row: the clicked `Button` row gets `aria-busy='true'` and `$lightnessOffset={1}`; its count becomes a `ButtonSlot` with `ProgressCircular $thickness={0.75}`.
- Long wait: `Text role='status' className='ak-ink-60 text-sm'`, then `Button $lightnessOffset $size='sm'`.
- Images: `Frame $darken` wells sized from `width` and `height`; the image goes from opacity 0 to 1 in 100 ms on decode.

**Copy.** `Still loading…` at 3 s. `Reload` at 12 s. Words: 0, then 2, then 3.

**Behavior and keys.** An in-app navigation never swaps to an empty page: the old page stays until the new one is ready. The old page stays usable, and a click on another row changes the target. `Esc` cancels the pending navigation. After the swap, focus goes to the page heading. `Approve` and `Reject` are `disabled` until both images decode.

**Scenarios.**

- `queue-fast`: header at 0, list at 0.3 s. The line shows for about 150 ms.
- `run-fast`: the Queue stays, row ring for 0.3 s, swap, empty wells until 0.9 s.
- `queue-slow`: header and line. The main area is empty for 2.5 s.
- `run-slow`: the Queue is usable for 6 s. At 3 s the row count reads `Still loading…`.
- `return`: the run stays under the line for 2 s, then the Queue shows at its old scroll position.
- `fails`: the line ends. `Could not load runs`, `Try again`, and the Error ID.
- `signed-out`: mark-only header and line, then the sign-in step at 1.2 s.
- `phone`: mark and line, `Still loading…` at 3 s, the page at 4 s.

## Variant `skeleton-shell`: Destination skeleton

The final layout appears at once with real static chrome and placeholder blocks, then content replaces the blocks in place.

Ideas:

- The layout never jumps: one shell for loading and ready (SHELL-C5, PRIM-R12, DASH-C6).
- Blocks wait 150 ms, so a 300 ms answer shows almost no skeleton.
- The Queue remembers its last row count, so the skeleton has the right length.

Tradeoffs:

- A 6 s skeleton is still 6 s without content.
- When the wait ends at the sign-in step, the skeleton promised a page; the session hint limits this to expired sessions.
- Each page needs a skeleton that follows its layout.

### Spec

```text
+--------------------------------------------------------+
| (o) / Queue / [=========]                 [==]   (DH)  |
+-------------+------------------------------------------+
| [=======  ] | [=====]     Side by side · Diff    Fit   |
| [=====    ] +--------------------+---------------------+
| [======== ] |                    |                     |
| [====     ] |     16:9 well      |      16:9 well      |
| [=======  ] |                    |                     |
| [=====    ] +--------------------+---------------------+
| [======   ] | Undo                 Reject X  Approve A |
+-------------+------------------------------------------+
```

**Stage.** The shared Load stage (notes 2). L is the latency.

**Build.**

- Real from 0 ms: the `Shell`, the mark, the nav labels and the account button (session hint, notes 3), the mode names, and the disabled `Undo`, `Reject`, `Approve`.
- Placeholders: the picked `skeleton` variant. Default: `Frame $lightnessOffset={1} $rounded='sm'` blocks with `animate-pulse motion-reduce:animate-none`.
- The loading region has `aria-busy='true'` and `aria-label='Loading run'`. Blocks are `aria-hidden`.
- Counts: Queue rows = the last row count from `localStorage` (default 6, at most 12). Sidebar = 12 rows. Wells are `aspect-video` until the sizes are known.

**Copy.** None. `Still loading…` at 3 s in the decision bar slot (run) or under the last row (Queue). `Reload` at 12 s. Words: 0, then 2.

**Behavior and keys.** Shell at 0 ms. Blocks fade in at 150 ms. Content replaces blocks region by region with a 120 ms opacity change and no movement. The router shows this state at once (`pendingMs: 0`). Tab reaches only real controls. Focus goes to the page heading when content arrives.

**Scenarios.**

- `queue-fast`: shell at 0, at most 150 ms of faint blocks, list at 0.3 s.
- `run-fast`: the workspace skeleton replaces the Queue at once; list at 0.3 s; images fade into the wells at 0.9 s.
- `queue-slow`: 6 skeleton rows for 2.5 s.
- `run-slow`: workspace skeleton for 6 s; `Still loading…` at 3 s; the wells take the real ratio at 6 s.
- `return`: 8 remembered skeleton rows for 2 s; the scroll position returns with the content.
- `fails`: blocks stop pulsing; the error state replaces the main region; the header stays.
- `signed-out`: no hint, so the mark and three neutral lines only; the sign-in step at 1.2 s.
- `phone`: header, variant row, two stacked wells, decision bar; content at 4 s.

## Variant `cached-first`: Last known, then fresh

The page paints the data that it last had in this tab at once, says how old it is, and marks what changed when the fresh answer arrives.

Ideas:

- Back and reopen are instant (SHELL-02 minimal alternative; RESIL idea 6, the stale-data mark).
- New runs wait behind a `1 new run · Show` pill, so rows never move under the pointer.
- On a stale run, Approve and Reject wait for the fresh answer, because a stale model has stale revisions.
- A failed refresh keeps the list and turns the age text into the warning.

Tradeoffs:

- Reopens P03: the maintainer rejected a query cache layer (`query-layer`) and chose router loaders.
- Open question of SHELL-02: may a review model that is some minutes old show while a fresh one loads?
- Memory only: the first load of a tab has no cache and falls back to the skeleton.
- Private data must leave the screen at once when the fresh answer is a 401.

### Spec

```text
+--------------------------------------------------------+
| (o) Queue History Status      Updated 4 min ago (@) DH |
+--------------------------------------------------------+
|                 ( 1 new run · Show )                   |
| To review · 4                                          |
| * #4863 Migrate component examples...     24   12 min  |
| * #4831 Update dependency @playwri...  o  61    1 h    |
|                                        ^ Updated       |
+--------------------------------------------------------+
```

**Stage.** The shared Load stage (notes 2).

**Build.**

- Age control in `ShellHeader` `end`: `ButtonGroup $size='sm'` with `TextFrame $ink={60} className='tabular-nums'` and a refresh `Button` (`RotateCw`, `animate-spin motion-reduce:animate-none` while it updates, `aria-label='Refresh'`).
- New rows: `Button $layer='brand' $mix={20} $rounded='full' $size='sm'`, `sticky top-2`, centered above the list.
- Changed row: `Badge $layer='brand' $forceRounded` with `BadgeLabel` `Updated` for 4 s, then a dot with a `Tooltip`.
- Stale run: `Approve` and `Reject` are `disabled` with a `ProgressCircular` slot and the `Tooltip` `Checking for a newer run`.
- No cache: the blocks of `skeleton-shell`.

**Copy.** `Updated 4 min ago` · `Updating…` · `Updated just now` · `1 new run · Show` · `Could not update · Try again`. Words: 3 to 5.

**Behavior and keys.** The cache is in memory for the life of the tab. Nothing is written to storage. Rows never reorder by themselves: new runs wait behind the pill, and a run that left the list stays, struck through with `Replaced`, until the next visit. A 401 answer removes cached content at once. The page reads again when the tab becomes visible and the data is older than 1 min. No letter key: the refresh button is a Tab stop.

**Scenarios.**

- `queue-fast`, `queue-slow`, `phone`: no cache, so skeleton blocks, then content with `Updated just now`.
- `run-fast`: first open. Title and `24 changes` come from the Queue row at 0 ms; list and wells are blocks until 0.3 s.
- `run-slow`: a reopened run. The whole workspace shows at 0 ms at the last selection, with images from the HTTP cache. `Updating…` for 6 s with decisions off, then `Updated just now`.
- `return`: the full list at 0 ms at the old scroll position; `Updating…` for 2 s; then the pill, and #4831 gets `Updated` (79 to 61 changes).
- `fails`: the list stays. The age text takes the warning color: `Could not update · Try again`.
- `signed-out`: no cache for a guest: neutral lines, then the sign-in step.

## Variant `outside-in`: Progressive regions

Title, summary, list, and images resolve on their own clocks, each with its own placeholder, from the outside of the page to the picture.

Ideas:

- The run title comes from the clicked row at 0 ms.
- Counts arrive before rows, and the rows that need review arrive before the unchanged ones.
- The image well takes its exact size from the model and shows the thumbnail blurred until the full image decodes (VIEW-C4).
- A failure hits one region; the regions that loaded stay.

Tradeoffs:

- Reopens P01: the maintainer chose one compact complete model and rejected `summary-detail`.
- Not in the API today: a summary answer and a paged list.
- Several small arrivals can feel busy at 1 s.

### Spec

```text
0 ms    | (o) / Queue / #4863 Migrate component ex...    |
0.3 s   | 22 of 40 need review  [#####.........]         |
        +--------------+---------------------------------+
0.5 L   | Dialog wit.. | React · Chromium · Dark         |
        | Combobox w.. | +-----------+ +-----------+     |
        | Actions menu | | thumbnail | | thumbnail |     |
L       | [=======]    | |  (blur)   | |  (blur)   |     |
        | [=====]      | +-----------+ +-----------+     |
+0.6 s  |              | Undo        Reject X  Approve A |
```

**Stage.** The shared Load stage (notes 2). L is the latency.

**Build.** Each region is one boundary with one placeholder.

- Title: real `Text` at 0 ms from the clicked row. A cold load shows a `Frame` bar.
- Summary: `Text` and `Progress value` (`aria-label='Reviewed'`).
- List: `Nav` with `NavLink` rows. Rows that did not arrive yet are skeleton rows.
- Stage: `Frame $darken overflow-clip` sized from `width` and `height`. The `thumbnail` shows first (`blur-md scale-105`), then the full image fades in over 150 ms.
- Decision bar: real buttons, `disabled` until both images decode.
- `aria-busy` on each pending region. One `role='status'` text says `Run loaded` at L.

**Copy.** None while loading. At 3 s the slowest pending region shows `Still loading…` in place. Words: 0, then 2.

**Behavior and keys.** Lab clock: title 0; summary at the smaller of 300 ms and 0.3 L; first 20 rows and thumbnails at 0.5 L; full image 600 ms later; all rows at L. Arrivals change opacity only. Arrow keys work on the rows that exist. `A` and `X` work when the pair is sharp.

**Scenarios.**

- `queue-fast`: title at 0, all rows at 0.3 s. No stage is visible.
- `run-fast`: title 0, summary 0.1 s, rows 0.15 s, sharp pair 0.9 s.
- `queue-slow`: group headings with counts (`To review · 4`) at 0.3 s, the `To review` rows at 1.25 s, the other groups at 2.5 s.
- `run-slow`: summary 0.3 s; first 20 rows and the blurred pair at 3 s; sharp pair and live decisions at 3.6 s; the other 100 rows at 6 s.
- `return`: headings at 0, rows at 1 s, the rest at 2 s.
- `fails`: the regions that loaded stay. The failed region shows the inline error state.
- `signed-out`: nothing is known, so a title bar only; the sign-in step at 1.2 s.
- `phone`: title, summary, then the stacked pair. The list button shows a ring until L.

## Variant `picture-first`: Picture first

The first changed screenshot pair and the decision bar load before everything else; the list fills in beside them.

Ideas:

- A reviewer from a GitHub check can decide on the first change seconds before the list exists.
- No skeleton: the empty stage is the canvas, and the list column is reserved so the stage never moves.
- The Queue shows one Next up row with four change previews first.
- Not proposed by the audit lanes.

Tradeoffs:

- Reopens P01 (`summary-detail` was rejected). Needs a small first-view answer. Not in the API today.
- `previews` on a run is not in the API today.
- Arrow keys have no list for some seconds; the design must say so when a key is pressed.
- The first screen shows no overview of the run except one count.

### Spec

```text
at 0.3 L                              at L
+--------+--------------------------+ +--------+--------------------------+
|        | (o) #4863        1 of 22 | | Dialog | (o) #4863        1 of 22 |
|        |                          | | Combob |                          |
| (empty | +---------+ +---------+  | | Action | +---------+ +---------+  |
|  list  | | baseline| | current |  | | Tabs   | | baseline| | current |  |
| column)| +---------+ +---------+  | | Select | +---------+ +---------+  |
|        |                          | | Toolti |                          |
|        | Undo  Reject X Approve A | | ...    | Undo  Reject X Approve A |
+--------+--------------------------+ +--------+--------------------------+
```

**Stage.** The shared Load stage (notes 2). L is the latency.

**Build.**

- Two requests start together: a first view (title, counts, the first three variants that need review with image sizes) and the full run.
- Stage: `Frame $darken` wells sized from `width` and `height`; the `thumbnail` blurred, then the sharp image.
- Decision bar: live when both images decode (rule I1).
- List column: `ShellSidebar $width='md'` reserved and empty from 0 ms, with no placeholder. Rows fade in at L. Until then a `Badge` in the header reads `1 of 22`.
- Queue: one Next up row first: `Button $lightnessOffset $rounded='xl' $p={3}` with the title, `24 changes`, and four `previews` thumbnails. The other rows follow.

**Copy.** `1 of 22` · `Next up` · `List still loading` (announcement and `Tooltip`). `Still loading…` at 3 s only when no picture is on screen. Words: 0 to 3.

**Behavior and keys.** `A` and `X` work from the first sharp pair, and the selection moves through the three variants of the first view. After the third, the stage shows wells until the run arrives. Up and Down do nothing before L: the previous and next buttons are `aria-disabled`, and a press announces `List still loading`.

**Scenarios.**

- `queue-fast`: Next up row and list together at 0.3 s.
- `run-fast`: wells at 0.1 s, sharp pair by 0.9 s, list at 0.3 s.
- `queue-slow`: Next up row with previews at 0.75 s; the list at 2.5 s.
- `run-slow`: wells at 1.8 s, sharp pair at 2.4 s. Decisions are possible 3.6 s before the list (6 s).
- `return`: Next up at 0.6 s, list at 2 s.
- `fails`: if the first view arrived, the stage stays usable and the list column shows the inline error. If not, the full error state.
- `signed-out`: an empty canvas with the mark; the sign-in step at 1.2 s.
- `phone`: the stacked pair first; the list button appears at L.

## Variant `counted-line`: Counted status line

A status line at the bottom shows a determinate bar and real counts while rows stream into the list; the same line later holds position, save state, and keys.

Ideas:

- Honest numbers in place of a shimmer: `412 of 600 variants`.
- The slot is permanent, so nothing appears or disappears when the load ends.
- The bar is hidden for the first 400 ms; a fast load never shows it.
- Not proposed by the audit lanes.

Tradeoffs:

- Not in the API today: a streamed answer with a known total.
- Reopens P01 if the stream is delivered in parts.
- A permanent line costs 28 px of height on every page.
- Numbers that move fast can distract.

### Spec

```text
+--------------------------------------------------------+
| (o) / Queue / #4863 Migrate component examples...      |
+-------------+------------------------------------------+
| Dialog wi.. |                                          |
| Combobox .. |           (stage: empty well)            |
| Actions m.. |                                          |
| Tabs        |                                          |
| (rows keep arriving)                                   |
+-------------+------------------------------------------+
| [##########......]  412 of 600 variants · 4.1 of 5.9 MB|
+--------------------------------------------------------+
```

**Stage.** The shared Load stage (notes 2). L is the latency.

**Build.**

- Status line: `Frame $layer $p={2}` band, `sticky bottom-0 border-t text-xs`, `role='status'`. Inside: `Progress value={received / total} $thickness={1}` (`aria-label='Loading run'`, `w-40`) and `Text className='font-mono tabular-nums ak-ink-70'`.
- Rows append to the `Nav` as the answer streams. Lab: 15 equal batches over L.
- No skeleton blocks. The stage well is empty until the first image.
- After the load the same line shows position, save state, and the key legend with `Kbd`.

**Copy.** `412 of 600 variants · 4.1 of 5.9 MB` · Queue: `5 of 8 runs` · done, for 2 s: `600 variants · 6.0 s` · then `↑↓ screenshot  ←→ variant  A approve  X reject  ? keys`.

**Behavior and keys.** The bar and the counts stay hidden for the first 400 ms. The live region speaks only at the start (`Loading run`) and at the end. Keys work on the rows that exist. `?` opens the key list.

**Scenarios.**

- `queue-fast`, `run-fast`: no bar. The line shows the legend at once.
- `queue-slow`: `3 of 8 runs` counts up; rows appear in order.
- `run-slow`: the bar runs for 6 s; the first rows are usable from 0.4 s; the first pair loads when its row arrives.
- `return`: `Loading · 3 of 8 runs` while the rows stream in again.
- `fails`: the bar stops and takes the danger color: `Stopped at 212 of 600 · Try again`. Loaded rows stay.
- `signed-out`: an empty page and the line `Loading…`; the sign-in step at 1.2 s.
- `phone`: the line is the only chrome at the bottom; counts only, no MB.
