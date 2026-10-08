# Error state (error-state)

Group: system
Question: How should a failed load look?
Description: A page, a list, or an image that did not load, in a 360 px cell: the cause in plain words, what happened to the work, and the one action that can help.
Layout: row

## Scenarios

- `unavailable` (Service problem): The Queue did not load: a 503 with the Error ID req_01JZ8Q2N5K; the page tries again in 5 s.
- `offline` (Offline): No connection; the load starts again when the connection returns.
- `stale-list` (Refresh failed): The Queue is on screen with data of 4 minutes ago and a refresh failed; the list must stay.
- `out-of-date` (App updated): A deploy changed the app under an open tab; Reload is the only action that helps.
- `image` (Image failed): The current image of the selected variant did not load, so Approve and Reject are off.
- `images-expired` (Images expired): A closed run whose images are deleted: a permanent state that must not offer Retry.
- `run-failed` (Run failed): The run failed in CI; the fix is on GitHub, not in the app.
- `crash` (Crash): A render error with a long technical message; the page shell may be gone.

## Variant `plain-line`: Plain line

An icon, one sentence, and one text action on one or two lines; no card and no color field.

Ideas:

- Ten words or fewer for each state.
- A permanent state has no Retry (RESIL-18).
- The Error ID is a labeled field with a copy button, not part of a sentence.

Tradeoffs:

- Easy to miss on a large empty page.
- No room to say what happened to the work.
- The automatic retry is visible only as a number in the action.

### Spec

```text
 !  Could not load runs               Try now (5)
    Error ID  req_01JZ8Q2N5K  [copy]
```

**Build.** `grid w-[22.5rem] gap-1`, `role='alert'` (`role='status'` for `stale-list` and `images-expired`).

- Row: the icon in `Text $text='warning'` (`flex h-lh items-center`; `danger` for `run-failed` and `crash`), the title `Text className='flex-1 text-sm font-medium'`, the action as `Link` rendered as `button`.
- Error ID row: `Text className='ak-ink-60 text-xs'`, `Code`, and `Button $size='xs' aria-label='Copy the Error ID'` with a `Copy` slot.

**Copy map (all variants of this surface).**

| Scenario         | Icon            | Title                              | Second line                                                  | Action                 |
| ---------------- | --------------- | ---------------------------------- | ------------------------------------------------------------ | ---------------------- |
| `unavailable`    | `CloudOff`      | `Could not load runs`              | `Trying again in 5 s`                                        | `Try now`              |
| `offline`        | `WifiOff`       | `You are offline`                  | `Loads when the connection returns`                          | `Try now`              |
| `stale-list`     | `TriangleAlert` | `Could not refresh`                | `Showing the list from 4 min ago`                            | `Try again`            |
| `out-of-date`    | `RefreshCw`     | `Visonaut was updated`             | `Reload to continue`                                         | `Reload`               |
| `image`          | `ImageOff`      | `Could not load the current image` | `Decisions wait for the image`                               | `Retry`                |
| `images-expired` | `ImageOff`      | `Images expired`                   | `The images for this run are deleted. The decisions remain.` | none; link `Queue`     |
| `run-failed`     | `CircleX`       | `Run failed`                       | `Rerun the visual tests in CI`                               | `Open on GitHub`       |
| `crash`          | `TriangleAlert` | `Something went wrong`             | `Reload the page`                                            | `Reload`; link `Queue` |

The field label is `Error ID`. Words: 3 to 10.

**Behavior and keys.** When the error replaces a page, the action gets focus, so Enter retries. `unavailable` retries by itself after 5, 15, then 30 s and shows the seconds in the action. `offline` retries on the `online` event. No letter keys.

**Scenarios.** One row for each state with its icon, title, and action. This variant leaves out the second line, except in `images-expired`. `stale-list`: the row sits above three real rows at full strength. `image`: the row sits in the image well, which keeps its size. `crash`: a `Disclosure` with the button `Details` holds the technical message in `Code`.

## Variant `cause-work-action`: Cause, work, action

A card with three fixed parts: what failed, what happened to the reviewer's work, and one button, plus the Error ID.

Ideas:

- One rule for every failure (RESIL idea 5).
- The work line always answers `did I lose anything?`.
- The button counts down the automatic retry.
- Technical text sits behind Details.

Tradeoffs:

- A card with up to 30 words is heavy for a failed refresh.
- The work line is filler when no work exists (a first load).

### Spec

```text
+----------------------------------------+
| (cloud-off)  Could not load runs       |
|              Trying again in 5 s.      |
|              Nothing was lost.         |
| Error ID  req_01JZ8Q2N5K        [copy] |
| [ Try now (5) ]              Details v |
+----------------------------------------+
```

**Build.** `Frame $lighten $border $rounded='2xl' $p='1rem' role='alert'`, `grid w-[22.5rem] gap-3`.

- Head: the icon in `Text $text='warning'` (`danger` for `run-failed` and `crash`), `Heading className='mt-0 mb-0 text-base'`, and two `Text className='ak-ink-70 text-sm'` lines (cause, work).
- ID row: `Text className='ak-ink-60 text-sm'`, `Code`, and a copy `Button $size='sm'` with `aria-label='Copy the Error ID'`.
- Actions: `Button $layer='brand' $size='sm' autoFocus`, an optional `Button $size='sm'` link, and `Disclosure` with the button `Details`.

**Copy.** Icon, title, second line (cause), and action from the copy map in `plain-line`. Work line by scenario: `unavailable` and `offline`: `Nothing was lost.` · `stale-list`: `The list below is 4 min old.` · `out-of-date` and `crash`: `Saved decisions are safe.` · `image`: `No decision was sent.` · `images-expired`: none (the second line says it) · `run-failed`: `Nothing can be reviewed here.` Words: 12 to 30.

**Behavior and keys.** Focus goes to the button. The countdown runs in the label (`Try now (5)`, `tabular-nums`). `offline` retries on the `online` event.

**Scenarios.**

- `unavailable`: as sketched.
- `offline`: no Error ID row.
- `stale-list`: `role='status'`; the card sits above the list, which stays.
- `out-of-date`: one button, `Reload`.
- `image`: the card is centered in the image well.
- `images-expired`: no button; link `Queue`; `role='status'`.
- `run-failed`: button `Open on GitHub` with `ArrowUpRight`; link `Queue`.
- `crash`: `Reload`, link `Queue`, and `Details` with the long message in `Code` (`break-all`).

## Variant `in-place`: In place

The failed region keeps its shape: its content or its skeleton stays, dimmed, under a slim band that names the failure and the action.

Ideas:

- An error is a state of a region, not a new page: the header, the list, and the scroll position stay (DASH-C6 stale, RESIL idea 5 b).
- Stale rows stay readable and stay links.
- The band has one height for every state, so nothing jumps.

Tradeoffs:

- Dimmed stale content can be taken for current content.
- With no earlier content, a frozen skeleton under a band is an odd picture.
- One line limits the text to about eight words.

### Spec

```text
+----------------------------------------+
| ! Could not refresh · 4 min old  [Try] |
+----------------------------------------+
| * #4863 Migrate comp...    24   12 min |   (60 % ink)
| * #4831 Update depend...   79    1 h   |
| * #4819 Fix a regress...   12    2 h   |
+----------------------------------------+
```

**Build.** `grid w-[22.5rem] gap-2`.

- Band: `Frame $layer='warning' $mix={15} $border $edge='warning' $rounded='lg' $p={2}` (`danger` for `run-failed` and `crash`), `sticky top-0 flex items-center gap-2 text-sm`: icon, `Text className='flex-1 truncate'`, one `Button $size='sm' $border`. `role='alert'`; `role='status'` for `stale-list` and `images-expired`.
- Region below: the earlier content with `ak-ink-60`, or the frozen skeleton (`skeleton` / `still-blocks`, no motion) when nothing loaded. Rows stay links.
- The Error ID is in a `Tooltip` of the band and in a small `Code` at the end of the band when it fits.

**Copy.** The title and the action from the copy map in `plain-line`, joined with a short second part by `·`: `Could not load runs · trying again in 5 s`. Words: 4 to 9.

**Behavior and keys.** Focus does not move when content stays. It moves to the band button when the region is empty. The band button counts down the retry.

**Scenarios.**

- `unavailable`: the band over 5 frozen skeleton rows.
- `offline`: `You are offline · loads when the connection returns`; frozen skeleton.
- `stale-list`: as sketched.
- `out-of-date`: a brand band (`$layer='brand' $mix={15}`): `Visonaut was updated` and `Reload`; the content below stays at full strength.
- `image`: the band sits at the top edge inside the image well; the well keeps its size and shows the `thumbnail` dimmed.
- `images-expired`: `Images expired · the decisions remain`; wells with the ratio and no picture; no button.
- `run-failed`: `Run failed · rerun the visual tests in CI` and `Open on GitHub`.
- `crash`: the band only, with `Reload`; the region below is empty.

## Variant `status-chip`: Status chip

A chip in the header names the app-wide state; a popover holds the sentence and the action, and the page stays as it is.

Ideas:

- One fixed place for offline, service problem, and updated (RESIL idea 1).
- The page body spends no space on the failure.
- A count on the chip shows held decisions.

Tradeoffs:

- A chip is easy to miss when the page below is empty, so a first load also needs one line in the body.
- Failures of one region (one image, one run) fit a global chip badly.
- Two clicks to the action.

### Spec

```text
| (o) Queue History        [ wifi-off Offline 3 ] (DH) |
                           +---------------------------+
                           | You are offline           |
                           | 3 decisions are held in   |
                           | this tab.                 |
                           | [ Try now ]               |
                           +---------------------------+
```

**Build.** Cell `w-[22.5rem]`: a header strip, the open popover, and a body area.

- Chip: `PopoverDisclosure $size='sm' $text='warning'` with an icon slot, `ButtonLabel`, and an optional `ButtonSlot $kind='badge' $p='md' $layer='warning'`.
- Popover: `Popover portal` with `grid max-w-72 gap-2`: `PopoverHeading`, `PopoverDescription`, `Button $lightnessOffset $size='sm'`, and the Error ID row (`Code`). In the lab the popover is open in every cell.
- Body: the earlier content unchanged, or one `Text className='ak-ink-60 text-sm'` line with the title when nothing loaded.
- Local failures: the chip sits in the toolbar of the region (the viewer toolbar for `image`).

**Copy.** Chip labels: `Service problem` · `Offline` · `Not refreshed` · `Update ready` · `Image failed` · `Images expired` · `Run failed` · `Error`. Popover: title, second line, and action from the copy map in `plain-line`. Words: 1 or 2 on the chip, up to 14 in the popover.

**Behavior and keys.** A new blocking state opens the popover one time and moves focus to its action. `Esc` closes it; the chip stays. The chip is hidden when all is well.

**Scenarios.**

- `unavailable`: chip `Service problem`; popover with the countdown and the Error ID; body line `Could not load runs`.
- `offline`: as sketched.
- `stale-list`: chip `Not refreshed`; the list stays at full strength.
- `out-of-date`: chip `Update ready` in the brand color; popover `Reload`.
- `image`: chip `Image failed` in the viewer toolbar; popover `Retry`.
- `images-expired`: chip `Images expired`; the popover has no action.
- `run-failed`: chip `Run failed` beside the run title; popover `Open on GitHub`.
- `crash`: no header may exist, so the cell shows the popover content as a plain card with `Reload`.

## Variant `failed-pane`: Failed pane

The failure is drawn as a screenshot pane: a dashed, hatched well with a pane caption, and the action in the place of the decision bar.

Ideas:

- The product's own picture language: a pane that did not arrive.
- For an image failure it is literal: the well keeps the exact size of the missing image.
- The action sits where Approve sits, so the hand is already there.
- Not proposed by the audit lanes.

Tradeoffs:

- A metaphor: a hatched pane for a failed list needs the caption to be understood.
- It uses the most space of all variants.
- The hatch needs a repeating gradient that takes its color from the layer ink.

### Spec

```text
 Queue · did not load
+ - - - - - - - - - - - - - - - - - - - +
| / / / / / / / / / / / / / / / / / / / |
| / / / /    (cloud-off)    / / / / / / |
| / / / / / / / / / / / / / / / / / / / |
+ - - - - - - - - - - - - - - - - - - - +
 Error ID req_01JZ8Q2N5K     [ Try now (5) ↵ ]
```

**Build.** `grid w-[22.5rem] gap-2`, `role='alert'` (`role='status'` for `stale-list` and `images-expired`).

- Caption: `Text className='text-xs ak-ink-70'` as a pane label: the region name, `·`, the state.
- Pane: `Frame $border $borderType='dashed' $rounded='lg'` with `relative grid h-40 place-items-center overflow-clip`. Hatch: an inner `div` with `absolute inset-0 ak-ink-20 bg-[repeating-linear-gradient(135deg,transparent_0_6px,currentColor_6px_7px)]`, so the color comes from the layer ink. For `image` the pane has the ratio of the image, not `h-40`.
- Center: the icon in a `Frame $layer $rounded='full' $forceRounded $p={2}` that covers the hatch.
- Bar: `flex items-center justify-between gap-2`: `Text className='ak-ink-60 text-xs'` with `Code`, and `Button $layer='brand' $size='sm' autoFocus` with a `kbd` `↵` slot.

**Copy.** Captions: `Queue · did not load` · `Queue · offline` · `Queue · 4 min old` · `Visonaut · updated` · `Current · did not load` · `Images · expired` · `Run · failed` · `Page · error`. Actions and icons from the copy map in `plain-line`. Words: 4 to 8.

**Behavior and keys.** Enter on the focused action. The countdown runs in the action label.

**Scenarios.**

- `unavailable`: as sketched.
- `offline`: no Error ID.
- `stale-list`: the pane is a 2 rem strip above the real rows; the rows stay.
- `out-of-date`: no hatch; a brand dashed pane with `RefreshCw`; action `Reload`.
- `image`: the hatched pane takes the place of the current image beside the real baseline image.
- `images-expired`: two hatched panes `Baseline · expired` and `Current · expired`; link `Queue`, no button.
- `run-failed`: action `Open on GitHub`.
- `crash`: actions `Reload` and the link `Queue`; a `Disclosure` `Details` under the bar.
